import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, rename, access } from 'node:fs/promises';
import { resolve, dirname, join, relative, sep, isAbsolute } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TEXTURE_CATALOG = resolve(root, 'assets/texture-catalog.json');
const MAP_ROLES = {Diffuse:'color', nor_gl:'normal', arm:'arm'};
const toPosix = path => path.split(sep).join('/');
async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export function validateTextureCatalog(catalog, rootDir = root) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.textures)) throw new Error('Invalid texture catalog version/shape');
  const ids = new Set();
  for (const item of catalog.textures) {
    for (const field of ['id', 'name', 'sourceUrl', 'license', 'creator']) if (typeof item[field] !== 'string' || !item[field].trim()) throw new Error(`Texture ${item.id}: missing ${field}`);
    if (ids.has(item.id)) throw new Error(`Duplicate texture id: ${item.id}`);
    ids.add(item.id);
    if (!/^https:\/\//.test(item.sourceUrl)) throw new Error(`Texture ${item.id}: invalid sourceUrl`);
    if (!Array.isArray(item.realSizeM) || item.realSizeM.length !== 2 || item.realSizeM.some(v => !(v > 0))) throw new Error(`Texture ${item.id}: realSizeM must be [width, height] in metres`);
    if (!item.maps?.color) throw new Error(`Texture ${item.id}: needs a color map`);
    for (const [role, map] of Object.entries(item.maps)) {
      if (isAbsolute(map.localPath) || map.localPath.includes('\\') || relative(rootDir, resolve(rootDir, map.localPath)).startsWith('..')) throw new Error(`Texture ${item.id}: unsafe ${role} path`);
      if (!/^[0-9a-f]{64}$/.test(map.sha256 ?? '')) throw new Error(`Texture ${item.id}: ${role} needs a sha256`);
    }
  }
  return catalog;
}

export async function loadTextureCatalog(path = TEXTURE_CATALOG, rootDir = root) {
  try { return validateTextureCatalog(JSON.parse(await readFile(path, 'utf8')), rootDir); }
  catch (err) { if (err.code === 'ENOENT') return {version:1, textures:[]}; throw err; }
}

// Returns the entry only when every map file exists locally; a catalog record alone proves nothing
export async function resolveTexture(id, {catalogPath = TEXTURE_CATALOG, rootDir = root} = {}) {
  const entry = (await loadTextureCatalog(catalogPath, rootDir)).textures.find(item => item.id === id);
  if (!entry) return null;
  for (const map of Object.values(entry.maps)) {
    try { await access(resolve(rootDir, map.localPath)); } catch { return null; }
  }
  return entry;
}

// Copies a verified provider download into the texture library after explicit review
export async function registerTexture(fetched, {approve = false, approvedBy, id, catalogPath = TEXTURE_CATALOG, libraryDir = resolve(root, 'assets/library/textures'), rootDir = root, now = () => Date.now()} = {}) {
  if (approve !== true) throw new Error('Texture registration requires explicit approval after reviewing the swatch (--approve)');
  if (typeof approvedBy !== 'string' || !approvedBy.trim()) throw new Error('Texture registration requires --approved-by <reviewer>');
  const p = fetched.provenance;
  if (p.format !== 'texture' || !p.realSizeM) throw new Error('Not a texture download with a real-world size');
  const catalogId = id ?? `${p.provider}-${p.id}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const maps = {};
  await mkdir(join(libraryDir, catalogId), {recursive:true});
  for (const file of p.files) {
    const role = MAP_ROLES[file.path.replace(/\.jpg$/, '')];
    if (!role) continue;
    const target = join(libraryDir, catalogId, `${role}.jpg`);
    await copyFile(join(fetched.dir, file.path), `${target}.tmp`);
    if (await sha256File(`${target}.tmp`) !== file.sha256) throw new Error(`${file.path} failed SHA-256 verification on copy`);
    await rename(`${target}.tmp`, target);
    maps[role] = {localPath:toPosix(relative(rootDir, target)), sha256:file.sha256, bytes:file.size};
  }
  const entry = {
    id:catalogId, name:p.name, provider:{name:p.provider, id:p.id, version:p.filesHash, resolution:p.resolution},
    sourceUrl:p.sourceUrl, license:p.license, licenseEvidence:p.licenseEvidence, creator:p.creator,
    realSizeM:p.realSizeM, tags:p.tags ?? [], maps,
    review:{approvedBy:approvedBy.trim(), approvedAt:new Date(now()).toISOString()}
  };
  const catalog = await loadTextureCatalog(catalogPath, rootDir);
  const textures = [...catalog.textures.filter(item => item.id !== catalogId), entry].sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(catalogPath, JSON.stringify(validateTextureCatalog({version:1, textures}, rootDir), null, 2) + '\n');
  return entry;
}
