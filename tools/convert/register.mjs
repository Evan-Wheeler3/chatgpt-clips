import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, rename, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../asset-resolver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const toPosix = path => path.split(sep).join('/');
async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export const defaultCatalogId = report => `${report.source.provider}-${report.source.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function catalogTags(report, extra) {
  const category = (report.metadata.category ?? '').split('/').map(part => part.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...(report.metadata.tags ?? []), ...category, ...extra].map(tag => tag.toLowerCase()))];
}

// Copies an approved, validated GLB into the library and records it in the catalog; refuses anything unreviewed
export async function registerAsset(reportPath, {
  approve = false, approvedBy, catalogId, style, tags = [], replace = false,
  catalogPath = resolve(root, 'assets/catalog.json'), libraryDir = resolve(root, 'assets/library'), rootDir = root,
  now = () => Date.now()
} = {}) {
  if (approve !== true) throw new Error('Registration requires explicit approval after reviewing preview.png (--approve)');
  if (typeof approvedBy !== 'string' || !approvedBy.trim()) throw new Error('Registration requires --approved-by <reviewer>');
  const reportDir = dirname(reportPath);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  if (report.status !== 'passed') throw new Error(`Conversion report status is ${report.status}; only passed conversions can be registered`);
  if (!report.preview) throw new Error('Conversion has no Three.js preview to review; rerun conversion with previews enabled');
  await stat(join(reportDir, report.preview.file));
  const glbPath = join(reportDir, report.glb.file);
  if (await sha256File(glbPath) !== report.glb.sha256) throw new Error('Converted GLB does not match the SHA-256 in its report');

  const id = catalogId ?? defaultCatalogId(report);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid catalog id: ${id}`);
  const libraryPath = join(libraryDir, `${id}.glb`);
  const localPath = toPosix(relative(rootDir, libraryPath));
  const {source, attribution, validation} = report;
  const entry = {
    id, name:report.metadata.name ?? attribution.name ?? source.id, description:report.metadata.description ?? '',
    tags:catalogTags(report, tags), style:style ?? report.metadata.style, localPath,
    sourceUrl:attribution.sourceUrl, license:attribution.license, licenseEvidence:attribution.licenseEvidence ?? null, creator:attribution.creator,
    provider:{name:source.provider, id:source.id, version:source.version, resolution:source.resolution},
    sha256:report.glb.sha256, bytes:report.glb.bytes,
    dimensionsM:validation.checks.bounds.extentsM, triangles:validation.checks.geometry.triangles,
    conversion:{key:report.key, converterVersion:report.converterVersion, report:toPosix(relative(rootDir, reportPath))},
    review:{approvedBy:approvedBy.trim(), approvedAt:new Date(now()).toISOString(), warnings:validation.warnings}
  };
  if (!entry.style) throw new Error('Catalog entries need a style (--style)');

  const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
  const existing = catalog.assets.findIndex(asset => asset.id === id);
  if (existing >= 0 && catalog.assets[existing].sha256 === entry.sha256) {
    const current = await sha256File(resolve(rootDir, catalog.assets[existing].localPath)).catch(() => null);
    if (current === entry.sha256) return {status:'unchanged', entry:catalog.assets[existing]};
  } else if (existing >= 0 && !replace) {
    throw new Error(`Catalog already has ${id} with a different GLB; pass --replace to update it`);
  }

  await mkdir(libraryDir, {recursive:true});
  const temp = `${libraryPath}.tmp-${process.pid}`;
  await copyFile(glbPath, temp);
  if (await sha256File(temp) !== entry.sha256) throw new Error('Library copy failed SHA-256 verification');
  await rename(temp, libraryPath);
  const assets = existing >= 0 ? catalog.assets.map((asset, i) => i === existing ? entry : asset) : [...catalog.assets, entry];
  const next = validateCatalog({...catalog, assets:assets.sort((a, b) => a.id.localeCompare(b.id))}, rootDir);
  await writeFile(catalogPath, JSON.stringify(next, null, 2) + '\n');
  return {status:existing >= 0 ? 'replaced' : 'registered', entry};
}
