import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tokens } from '../asset-resolver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.polyhaven.com';
const API_HOSTS = ['api.polyhaven.com'];
const DOWNLOAD_HOSTS = ['dl.polyhaven.org'];
const MAX_REDIRECTS = 5;
const INDEX_TTL_MS = 12 * 3600 * 1000; // Matches the API's cache-control max-age
const MODEL_TYPE = 2;
// The API has no per-asset license field; this site-wide statement is the license evidence
export const LICENSE = {id:'CC0-1.0', evidenceUrl:'https://polyhaven.com/license'};
// API ToS 2.5 requires surfacing where content comes from when served via the live API
export const CREDIT = 'Powered by Poly Haven (https://polyhaven.com)';
export const TERMS_URL = 'https://github.com/Poly-Haven/Public-API/blob/master/ToS.md';

const stem = word => word.length > 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
const words = value => new Set(tokens(value).map(stem));

export function scoreModel(request, model) {
  const queryWords = words(request.query);
  const wanted = new Set([...queryWords, ...words((request.tags ?? []).join(' '))]);
  const name = words(`${model.id} ${model.name}`);
  const tags = words([...(model.tags ?? []), ...(model.categories ?? []), model.category ?? ''].join(' '));
  const description = words(model.description);
  let score = 0;
  const matchedTerms = [];
  for (const word of wanted) {
    const points = name.has(word) ? 4 : tags.has(word) ? 3 : description.has(word) ? 1 : 0;
    score += points;
    if (points >= 3 && queryWords.has(word)) matchedTerms.push(word);
  }
  // Request tags only boost; a candidate needs a name/tag hit on the query itself
  if (!matchedTerms.length) return {score:0, matchedTerms, coverage:0};
  return {score, matchedTerms, coverage:Math.round(matchedTerms.length / queryWords.size * 100) / 100};
}

export function toCandidate(request, model, {score = null, matchedTerms = [], coverage = null} = {}) {
  const warnings = [];
  if (model.tmwarn) warnings.push('Trademark warning from Poly Haven: CC0 does not clear trademarks or brand designs');
  if (request.style && request.style !== 'realistic') warnings.push(`Style review: requested "${request.style}", Poly Haven models are realistic PBR scans/models`);
  return {
    provider:'polyhaven', id:model.id, name:model.name, score, matchedTerms, coverage,
    sourceUrl:`https://polyhaven.com/a/${model.id}`,
    license:LICENSE.id, licenseEvidence:LICENSE.evidenceUrl,
    creator:Object.keys(model.authors ?? {}).join(', '),
    style:'realistic', tags:model.tags ?? [], category:model.category ?? null,
    polycount:model.polycount ?? null, dimensions:model.dimensions ?? null,
    thumbnailUrl:model.thumbnail_url ?? null, filesHash:model.files_hash ?? null,
    downloaded:false, warnings
  };
}

const safeRelPath = path => typeof path === 'string' && path && !path.includes('\\') && !posix.isAbsolute(path)
  && posix.normalize(path) === path && !path.split('/').includes('..');

export function createPolyHavenProvider({
  fetch:fetchImpl = globalThis.fetch,
  cacheDir = resolve(root, 'assets/cache'),
  userAgent = 'hold-up-animation-v2/0.1.0',
  now = () => Date.now(),
  timeoutMs = 30000,
  downloadTimeoutMs = 10 * 60 * 1000
} = {}) {
  const headers = {'User-Agent':userAgent};
  const providerDir = join(cacheDir, 'polyhaven');
  let indexPromise;

  // Follows redirects by hand so that every hop, not just the first URL, must be an approved HTTPS host
  async function safeFetch(url, allowedHosts, ms) {
    const signal = AbortSignal.timeout(ms);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) throw new Error(`Refusing request to unapproved host: ${url}`);
      const response = await fetchImpl(url, {headers, signal, redirect:'manual'});
      if (response.url && !allowedHosts.includes(new URL(response.url).hostname)) {
        await response.body?.cancel();
        throw new Error(`Refusing response from unapproved host: ${response.url}`);
      }
      if (response.status < 300 || response.status > 399) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error(`Redirect without Location from ${url}`);
      url = new URL(location, url).href;
    }
    throw new Error(`Too many redirects starting from ${url}`);
  }

  async function getJson(path) {
    const response = await safeFetch(`${API}${path}`, API_HOSTS, timeoutMs);
    if (!response.ok) throw new Error(`Poly Haven API ${response.status} for ${path}`);
    return response.json();
  }

  async function loadIndex() {
    const indexPath = join(providerDir, 'models-index.json');
    try {
      const cached = JSON.parse(await readFile(indexPath, 'utf8'));
      if (now() - cached.fetchedAt < INDEX_TTL_MS) return cached;
    } catch { /* Missing or unreadable index is refetched */ }
    const [assets, vaults] = await Promise.all([getJson('/assets?type=models'), getJson('/vaults')]);
    const lockedIds = Object.values(vaults).filter(vault => vault.status !== 'unlocked').flatMap(vault => vault.assets ?? []);
    const index = {fetchedAt:now(), models:assets, lockedIds};
    await mkdir(providerDir, {recursive:true});
    await writeFile(indexPath, JSON.stringify(index));
    return index;
  }

  function index() {
    indexPromise ??= loadIndex().catch(err => { indexPromise = undefined; throw err; });
    return indexPromise;
  }

  function unavailable(id, model, lockedIds) {
    if (model.type !== MODEL_TYPE) return 'not a model';
    if (lockedIds.includes(id)) return 'in a locked Poly Haven vault';
    if (model.date_published * 1000 > now()) return 'not yet published';
    return null;
  }

  async function search(request, {limit = 5} = {}) {
    if (!request?.query) throw new Error('Search request needs a query');
    const {models, lockedIds} = await index();
    return Object.entries(models)
      .filter(([id, model]) => !unavailable(id, model, lockedIds))
      .map(([id, model]) => ({model:{...model, id}, match:scoreModel(request, {...model, id})}))
      .filter(({match}) => match.score > 0)
      .sort((a, b) => b.match.coverage - a.match.coverage || b.match.score - a.match.score || a.model.id.localeCompare(b.model.id))
      .slice(0, limit)
      .map(({model, match}) => toCandidate(request, model, match));
  }

  // Streams to disk, hashing as it goes, and aborts as soon as the body exceeds the expected size
  async function download(file, dest) {
    const response = await safeFetch(file.url, DOWNLOAD_HOSTS, downloadTimeoutMs);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(`Download ${response.status} for ${file.url}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (declared && declared !== file.size) {
      await response.body.cancel();
      throw new Error(`Size mismatch for ${file.path}: expected ${file.size}, server declared ${declared}`);
    }
    const md5 = createHash('md5'), sha256 = createHash('sha256');
    let size = 0;
    const meter = new Transform({transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > file.size) return callback(new Error(`Size mismatch for ${file.path}: more than ${file.size} bytes received`));
      md5.update(chunk); sha256.update(chunk);
      callback(null, chunk);
    }});
    const target = join(dest, file.path);
    await mkdir(dirname(target), {recursive:true});
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target));
    if (size !== file.size) throw new Error(`Size mismatch for ${file.path}: expected ${file.size}, got ${size}`);
    const digest = md5.digest('hex');
    if (digest !== file.md5) throw new Error(`MD5 mismatch for ${file.path}`);
    return {path:file.path, url:file.url, size, md5:digest, sha256:sha256.digest('hex')};
  }

  async function sha256File(path) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  }

  // Returns null when the cached copy matches the expected file list and every recorded size/SHA-256, else the problem
  async function cacheProblem(dest, list) {
    let provenance;
    try { provenance = JSON.parse(await readFile(join(dest, 'provenance.json'), 'utf8')); }
    catch { return 'missing or unreadable provenance.json'; }
    const recorded = new Map((provenance.files ?? []).map(file => [file.path, file]));
    if (recorded.size !== list.length) return 'file list differs from the API';
    for (const file of list) {
      const entry = recorded.get(file.path);
      if (!entry || entry.size !== file.size || entry.md5 !== file.md5 || !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '')) return `provenance does not match the API for ${file.path}`;
      const path = join(dest, file.path);
      try { if ((await stat(path)).size !== entry.size) return `size mismatch for ${file.path}`; }
      catch { return `missing ${file.path}`; }
      if (await sha256File(path) !== entry.sha256) return `SHA-256 mismatch for ${file.path}`;
    }
    return null;
  }

  async function fetchModel(id, {resolution = '1k', maxBytes = 200 * 1024 * 1024} = {}) {
    if (!/^[A-Za-z0-9_-]+$/.test(String(id))) throw new Error(`Invalid Poly Haven asset id: ${id}`);
    const [info, files, {lockedIds}] = await Promise.all([getJson(`/info/${id}`), getJson(`/files/${id}`), index()]);
    const reason = unavailable(id, info, lockedIds);
    if (reason) throw new Error(`Poly Haven asset ${id} is ${reason}`);
    const entry = files.gltf?.[resolution]?.gltf;
    if (!entry) throw new Error(`No glTF at ${resolution} for ${id}; available: ${Object.keys(files.gltf ?? {}).join(', ') || 'none'}`);
    const main = {path:posix.basename(new URL(entry.url).pathname), url:entry.url, size:entry.size, md5:entry.md5};
    const list = [main, ...Object.entries(entry.include ?? {}).map(([path, file]) => ({path, ...file}))];
    for (const file of list) if (!safeRelPath(file.path)) throw new Error(`Unsafe file path in ${id}: ${file.path}`);
    const total = list.reduce((sum, file) => sum + file.size, 0);
    if (total > maxBytes) throw new Error(`${id} at ${resolution} is ${total} bytes, over the ${maxBytes} byte limit`);

    const dest = join(providerDir, id, info.files_hash, resolution);
    const cached = await stat(dest).then(() => true, () => false);
    const repaired = cached ? await cacheProblem(dest, list) : null;
    if (cached && !repaired) return {status:'cached', dir:dest, provenance:JSON.parse(await readFile(join(dest, 'provenance.json'), 'utf8'))};

    const partial = join(providerDir, '.partial', `${id}-${info.files_hash}-${resolution}-${process.pid}`);
    await rm(partial, {recursive:true, force:true});
    try {
      const downloaded = [];
      for (const file of list) downloaded.push(await download(file, partial)); // Sequential to stay gentle on the CDN
      const candidate = toCandidate({}, {...info, id});
      const provenance = {
        version:1, provider:'polyhaven', id, name:info.name,
        sourceUrl:candidate.sourceUrl, license:LICENSE.id, licenseEvidence:LICENSE.evidenceUrl,
        creator:candidate.creator, filesHash:info.files_hash, resolution, format:'gltf',
        entry:main.path, retrievedAt:new Date(now()).toISOString(),
        apiTerms:TERMS_URL, apiCredit:CREDIT, warnings:candidate.warnings, files:downloaded
      };
      await writeFile(join(partial, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
      await mkdir(dirname(dest), {recursive:true});
      if (repaired) await rm(dest, {recursive:true, force:true}); // Replace the corrupted copy only after a verified redownload
      await rename(partial, dest);
      return {status:'downloaded', dir:dest, provenance, ...(repaired && {repaired})};
    } catch (err) {
      await rm(partial, {recursive:true, force:true});
      throw err;
    }
  }

  // Fetches (or revalidates) a model and describes it in the provider-agnostic conversion source contract
  async function conversionSource(id, options = {}) {
    const fetched = await fetchModel(id, options);
    const model = (await index()).models[id] ?? {};
    const provenance = fetched.provenance;
    const dims = model.dimensions;
    return {
      provider:'polyhaven', id, version:provenance.filesHash, resolution:provenance.resolution,
      dir:fetched.dir, entry:provenance.entry, fetchStatus:fetched.status,
      files:provenance.files.map(({path, size, sha256}) => ({path, size, sha256})),
      attribution:{name:provenance.name, sourceUrl:provenance.sourceUrl, license:provenance.license,
        licenseEvidence:provenance.licenseEvidence, creator:provenance.creator, credit:CREDIT},
      metadata:{name:provenance.name, description:model.description ?? '', tags:model.tags ?? [],
        category:model.category ?? null, style:'realistic', warnings:provenance.warnings ?? []},
      // Poly Haven reports Blender Z-up millimetres [x, depth, height]; glTF is Y-up metres [x, height, depth]
      expected:Array.isArray(dims) && dims.length === 3 ? {extentsM:[dims[0] / 1000, dims[2] / 1000, dims[1] / 1000]} : null
    };
  }

  return {name:'polyhaven', credit:CREDIT, search, fetchModel, conversionSource};
}
