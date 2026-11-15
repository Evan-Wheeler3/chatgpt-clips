import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { resolve, dirname, join, extname, posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, quantize as quantizeMesh, unpartition } from '@gltf-transform/functions';
import { validateDocument } from './validate.mjs';
import { renderPreview } from './preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Bump when conversion output or report semantics change, so cached results are rebuilt
export const CONVERTER_VERSION = 2;
const TOOL_PACKAGES = ['@gltf-transform/core', '@gltf-transform/functions', 'gltf-validator', 'three'];

/*
 * Provider-agnostic source contract (see docs/ASSET_PIPELINE.md):
 * {provider, id, version, resolution?, dir, entry, files:[{path, size, sha256}],
 *  attribution:{name, sourceUrl, license, licenseEvidence, creator, credit?},
 *  metadata:{name, description, tags, category, style, warnings}, expected:{extentsM:[x,y,z]} | null}
 */
const CONVERTERS = {
  '.gltf':convertWithGltfTransform,
  '.glb':convertWithGltfTransform
};
const BLENDER_FORMATS = new Set(['.fbx', '.obj', '.blend', '.dae', '.3ds', '.stl', '.usd', '.usdz', '.usdc']);

const safeRelPath = path => typeof path === 'string' && path && !path.includes('\\') && !posix.isAbsolute(path)
  && posix.normalize(path) === path && !path.split('/').includes('..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

// Keeps gltf-transform's progress output off stdout and records it in the conversion report instead
class CollectingLogger extends Logger {
  constructor() { super(Logger.Verbosity.INFO); this.messages = []; }
  debug() {}
  info(text) { this.messages.push(`info: ${text}`); }
  warn(text) { this.messages.push(`warn: ${text}`); }
  error(text) { this.messages.push(`error: ${text}`); }
}

export class ConversionError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function validateSource(source) {
  for (const field of ['provider', 'id', 'version', 'dir', 'entry']) {
    if (typeof source?.[field] !== 'string' || !source[field]) throw new ConversionError(`Source is missing ${field}`, 'INVALID_SOURCE');
  }
  if (!/^[A-Za-z0-9_.-]+$/.test(source.provider) || !/^[A-Za-z0-9_.-]+$/.test(source.id)) throw new ConversionError('Source provider/id must be filesystem-safe', 'INVALID_SOURCE');
  for (const field of ['sourceUrl', 'license', 'creator']) {
    if (typeof source.attribution?.[field] !== 'string' || !source.attribution[field]) throw new ConversionError(`Source attribution is missing ${field}`, 'INVALID_SOURCE');
  }
  if (!Array.isArray(source.files) || !source.files.length) throw new ConversionError('Source lists no files', 'INVALID_SOURCE');
  for (const file of source.files) {
    if (!safeRelPath(file.path) || !/^[0-9a-f]{64}$/.test(file.sha256 ?? '')) throw new ConversionError(`Source file record is invalid: ${file.path}`, 'INVALID_SOURCE');
  }
  if (!source.files.some(file => file.path === source.entry)) throw new ConversionError(`Entry ${source.entry} is not in the source file list`, 'INVALID_SOURCE');
  const format = extname(source.entry).toLowerCase();
  if (BLENDER_FORMATS.has(format)) throw new ConversionError(`${format} needs the Blender conversion path, which is not implemented yet`, 'NEEDS_BLENDER');
  if (!CONVERTERS[format]) throw new ConversionError(`Unsupported source format: ${format}`, 'UNSUPPORTED_FORMAT');
  return format;
}

// Every external URI must be a relative path to a file whose hash the provider recorded
async function checkReferences(source) {
  const known = new Map(source.files.map(file => [file.path, file]));
  for (const file of source.files) {
    const actual = await sha256File(join(source.dir, file.path)).catch(() => null);
    if (actual !== file.sha256) throw new ConversionError(`Source file ${file.path} is missing or does not match its recorded SHA-256`, 'SOURCE_INTEGRITY');
  }
  if (extname(source.entry).toLowerCase() !== '.gltf') return;
  const json = JSON.parse(await readFile(join(source.dir, source.entry), 'utf8'));
  for (const {uri} of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (uri === undefined || uri.startsWith('data:')) continue;
    const path = posix.normalize(posix.join(posix.dirname(source.entry), decodeURIComponent(uri)));
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || !safeRelPath(path)) throw new ConversionError(`Unsafe or remote resource URI in ${source.entry}: ${uri}`, 'UNSAFE_REFERENCE');
    if (!known.has(path)) throw new ConversionError(`${source.entry} references ${uri}, which is not a verified source file`, 'MISSING_REFERENCE');
  }
}

async function convertWithGltfTransform(source, {quantize}) {
  const logger = new CollectingLogger();
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(logger);
  const document = (await io.read(join(source.dir, source.entry))).setLogger(logger);
  // Lossless by default: dedup/prune/weld only remove exact duplicates and unused data; images are embedded byte-for-byte
  // keepLeaves: empty nodes can be attachment sockets ("socket/<name>"), which must survive conversion
  const steps = [dedup(), prune({keepSolidTextures:true, keepLeaves:true}), weld()];
  if (quantize) steps.push(quantizeMesh());
  steps.push(unpartition());
  await document.transform(...steps);
  const asset = document.getRoot().getAsset();
  const {attribution} = source;
  asset.copyright = `${attribution.name ?? source.id} by ${attribution.creator}, ${attribution.license} (${attribution.sourceUrl})`;
  asset.extras = {...asset.extras, holdUp:{provider:source.provider, id:source.id, version:source.version,
    sourceUrl:attribution.sourceUrl, license:attribution.license, licenseEvidence:attribution.licenseEvidence ?? null, creator:attribution.creator}};
  return {glb:await io.writeBinary(document), log:logger.messages, operations:['dedup', 'prune', 'weld', ...(quantize ? ['quantize'] : []), 'unpartition']};
}

async function toolVersions() {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  return Object.fromEntries(TOOL_PACKAGES.map(name => [name, manifest.dependencies?.[name] ?? null]));
}

export async function conversionKey(source, options) {
  const files = [...source.files].sort((a, b) => a.path.localeCompare(b.path)).map(file => [file.path, file.sha256]);
  // Validation inputs (expected size) are part of the key, so a changed expectation is re-checked, not served from cache
  const material = {converter:CONVERTER_VERSION, tools:await toolVersions(), options, provider:source.provider, id:source.id, version:source.version, entry:source.entry, files, expected:source.expected ?? null};
  return sha256(JSON.stringify(material)).slice(0, 16);
}

async function cachedResult(outDir, wantPreview) {
  try {
    const report = JSON.parse(await readFile(join(outDir, 'report.json'), 'utf8'));
    if (report.status !== 'passed') return null; // Failed conversions are always retried
    if (await sha256File(join(outDir, 'model.glb')) !== report.glb.sha256) return null;
    if (wantPreview && !report.preview) return null;
    if (report.preview) await stat(join(outDir, report.preview.file));
    return report;
  } catch { return null; }
}

export async function convertAsset(source, {
  outRoot = resolve(root, 'assets/converted'), quantize = false, preview = true, force = false,
  render = renderPreview, now = () => Date.now()
} = {}) {
  const format = validateSource(source);
  await checkReferences(source);
  const options = {quantize};
  const key = await conversionKey(source, options);
  const outDir = join(outRoot, source.provider, source.id, key);
  if (!force) {
    const report = await cachedResult(outDir, preview);
    if (report) return {status:'cached', dir:outDir, report};
  }

  const started = now();
  const {glb, operations, log} = await CONVERTERS[format](source, options);
  // Validate what was actually written, not the in-memory document it came from
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new CollectingLogger()).readBinary(glb);
  const sourceBytes = source.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const validation = await validateDocument(document, glb, {expected:source.expected});
  const partial = join(outRoot, '.partial', `${source.provider}-${source.id}-${key}-${process.pid}`);
  await rm(partial, {recursive:true, force:true});
  await mkdir(partial, {recursive:true});
  try {
    await writeFile(join(partial, 'model.glb'), glb);
    let threejs = null;
    if (preview && validation.status === 'passed') {
      try { threejs = await render(join(partial, 'model.glb'), {outPath:join(partial, 'preview.png')}); }
      catch (err) { validation.status = 'failed'; validation.errors.push(err.message); }
    }
    const report = {
      version:1, key, status:validation.status, converterVersion:CONVERTER_VERSION, tools:await toolVersions(),
      convertedAt:new Date(started).toISOString(), durationMs:now() - started,
      source:{provider:source.provider, id:source.id, version:source.version, resolution:source.resolution ?? null, entry:source.entry, files:source.files},
      attribution:source.attribution, metadata:source.metadata ?? {},
      conversion:{tool:'gltf-transform', format, options, operations, log, blenderUsed:false,
        sourceBytes, glbBytes:glb.byteLength, sizeRatio:sourceBytes ? Math.round(glb.byteLength / sourceBytes * 1000) / 1000 : null},
      glb:{file:'model.glb', ...validation.checks.glb},
      preview:threejs ? {file:'preview.png', views:['three-quarter', 'front', 'side', 'top']} : null,
      threejs, validation
    };
    await writeFile(join(partial, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    await rm(outDir, {recursive:true, force:true});
    await mkdir(dirname(outDir), {recursive:true});
    await rename(partial, outDir);
    return {status:validation.status === 'passed' ? 'converted' : 'failed', dir:outDir, report};
  } catch (err) {
    await rm(partial, {recursive:true, force:true});
    throw err;
  }
}
