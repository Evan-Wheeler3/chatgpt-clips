import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/*
 * Audio asset catalog (audio/catalog.json): every sound effect, ambience and music file the mixer may use, with source,
 * license and review status. The mixer only uses approved assets with an allowed license; imports start as pending-review.
 */
const run = promisify(execFile);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CATALOG = join(ROOT, 'audio/catalog.json');
// Licenses that allow commercial use in a video; attribution licenses carry their credit line
export const ALLOWED_LICENSES = {'CC0-1.0':{attribution:false}, 'CC-BY-4.0':{attribution:true}, 'CC-BY-3.0':{attribution:true}};
export const CATEGORIES = ['impact', 'wood', 'movement', 'footsteps', 'clothing', 'transition', 'comedic', 'ambience', 'music', 'environment', 'other'];
const REQUIRED = ['id', 'description', 'category', 'file', 'durationSec', 'source', 'license', 'licenseEvidence', 'status', 'gainDb', 'sha256'];
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');

export async function loadCatalog(file = CATALOG) { return JSON.parse(await readFile(file, 'utf8')); }

export async function validateCatalog(catalog, {root = ROOT} = {}) {
  const problems = [], ids = new Set();
  for (const a of catalog.assets) {
    const where = a.id ?? '(no id)';
    for (const key of REQUIRED) if (a[key] === undefined || a[key] === null || a[key] === '') problems.push({code:'MISSING_FIELD', asset:where, message:`${where} has no ${key}`});
    if (ids.has(a.id)) problems.push({code:'DUPLICATE_ID', asset:where, message:`${where} appears twice`});
    ids.add(a.id);
    if (!ALLOWED_LICENSES[a.license]) problems.push({code:'LICENSE_NOT_ALLOWED', asset:where, message:`${where}: license "${a.license}" is not on the allowed list (${Object.keys(ALLOWED_LICENSES).join(', ')})`});
    if (ALLOWED_LICENSES[a.license]?.attribution && !a.attribution) problems.push({code:'ATTRIBUTION_MISSING', asset:where, message:`${where}: ${a.license} needs an attribution line`});
    if (a.category && !CATEGORIES.includes(a.category)) problems.push({code:'UNKNOWN_CATEGORY', asset:where, message:`${where}: category "${a.category}"`});
    const file = join(root, a.file ?? '');
    if (!await access(file).then(() => true, () => false)) { problems.push({code:'MISSING_FILE', asset:where, message:`${where}: ${a.file} does not exist`}); continue; }
    if (a.sha256 && await sha256(file) !== a.sha256) problems.push({code:'CHECKSUM_MISMATCH', asset:where, message:`${where}: ${a.file} changed since it was catalogued`});
  }
  return problems;
}

// The asset the mixer may use, or a clear reason it may not
export function usableAsset(catalog, id) {
  const a = catalog.assets.find(x => x.id === id);
  if (!a) throw new Error(`Sound asset "${id}" is not in the audio catalog; add it (tools/audio/synth.mjs or tools/audio/import.mjs) instead of substituting another sound`);
  if (a.status !== 'approved') throw new Error(`Sound asset "${id}" is ${a.status}; approve it first (node tools/audio/import.mjs approve ${id} --by "<name>")`);
  if (!ALLOWED_LICENSES[a.license]) throw new Error(`Sound asset "${id}" has license ${a.license}, which is not allowed`);
  return a;
}

/*
 * Import a recording from a free library. Needs the license (on the allowed list), the source page and the author;
 * attribution licenses also need the credit line. The file is converted to 48 kHz WAV and starts as pending-review.
 */
export async function importAsset({file, id, category, description, license, sourceUrl, author, evidence, attribution = null, gainDb = -18, loop = false, root = ROOT, catalogFile = CATALOG}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) throw new Error('--id must be lowercase letters, digits and dashes');
  if (!ALLOWED_LICENSES[license]) throw new Error(`--license must be one of ${Object.keys(ALLOWED_LICENSES).join(', ')} (got "${license}"); unknown or non-commercial licenses cannot be imported`);
  if (!/^https?:\/\//.test(sourceUrl ?? '')) throw new Error('--source-url must be the page the recording came from');
  if (!author || !evidence) throw new Error('--author and --evidence (where the license is stated) are required; never infer a license from a title');
  if (ALLOWED_LICENSES[license].attribution && !attribution) throw new Error(`${license} requires --attribution "<credit line>"`);
  if (!CATEGORIES.includes(category)) throw new Error(`--category must be one of ${CATEGORIES.join(', ')}`);
  const catalog = await loadCatalog(catalogFile);
  if (catalog.assets.some(a => a.id === id)) throw new Error(`${id} is already catalogued`);
  const target = join(root, 'audio/sfx', `${id}.wav`);
  await mkdir(dirname(target), {recursive:true});
  try { await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', file, '-ar', '48000', '-c:a', 'pcm_s16le', target]); }
  catch { throw new Error(`${file} is not a readable audio file`); }
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=channels', '-of', 'json', target]);
  const info = JSON.parse(stdout);
  const asset = {id, description, category, file:`audio/sfx/${id}.wav`, durationSec:+Number(info.format.duration).toFixed(3), sampleRate:48000, channels:info.streams[0].channels,
    source:{type:'imported', url:sourceUrl, originalFile:file.split('/').pop()}, author, license, licenseEvidence:evidence, attribution, status:'pending-review', review:null,
    gainDb, loop:loop ? {seamless:false} : null, sha256:await sha256(target)};
  catalog.assets.push(asset);
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  return asset;
}

export async function approveAsset(id, {by, notes = '', catalogFile = CATALOG} = {}) {
  if (NOT_A_PERSON.test(String(by ?? '').trim())) throw new Error('Approving a sound needs the name of the person who listened to it');
  const catalog = await loadCatalog(catalogFile), a = catalog.assets.find(x => x.id === id);
  if (!a) throw new Error(`No asset ${id}`);
  a.status = 'approved'; a.review = `Approved by ${String(by).trim()} on ${new Date().toISOString().slice(0, 10)}${notes ? `: ${notes}` : ''}`;
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  return a;
}
