import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve, dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreModel } from './polyhaven.mjs';
import { extractZip, safeRelPath } from './zip.mjs';

/*
 * Sketchfab provider (Data API v3, https://docs.sketchfab.com/data-api/v3/swagger.json).
 *   search       public, no token: /v3/search?type=models&downloadable=true&license=<slug>; every candidate's license is
 *                re-verified from its own model record (/v3/models/{uid}) before it is returned
 *   fetchModel   /v3/models/{uid}/download with the owner's personal API token ("Authorization: Token ...", a free
 *                account's token from sketchfab.com/settings/password), read from SKETCHFAB_API_TOKEN; never stored
 * Only downloadable models under CC0 or CC BY 4.0 are accepted. Standard, Free Standard and Editorial (Sketchfab's own
 * licenses), NonCommercial, NoDerivatives and ShareAlike, view-only and age-restricted models are refused before any
 * download request is made. The license is checked again at download time and recorded with the attribution text.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const API = 'https://api.sketchfab.com/v3';
const API_HOSTS = ['api.sketchfab.com'];
// Download links are short-lived pre-signed URLs on Sketchfab's media storage; any other host is refused (add after review)
const DOWNLOAD_HOSTS = ['sketchfab-prod-media.s3.amazonaws.com', 'media.sketchfab.com'];
const MAX_REDIRECTS = 5;
export const TERMS_URL = 'https://sketchfab.com/terms';
export const CREDIT = 'Models from Sketchfab (https://sketchfab.com)';
// Sketchfab license slug -> catalog license id; the record's license URL must match too
export const LICENSES = {
  cc0:{id:'CC0-1.0', name:'CC0 1.0', url:'creativecommons.org/publicdomain/zero/1.0', attribution:false},
  by:{id:'CC-BY-4.0', name:'CC BY 4.0', url:'creativecommons.org/licenses/by/4.0', attribution:true}
};
// CC licenses do not clear trademarks: names/tags that look like real brands are flagged for review
const BRANDS = /\b(shell|exxon|mobil|texaco|chevron|wawa|racetrac|petron|pemex|bp|esso|sunoco|citgo|marathon|valero|bmw|ford|mustang|fiat|cadillac|toyota|honda|chevrolet|dodge|tesla|porsche|ferrari|audi|mercedes|volkswagen|nissan|coca[- ]?cola|pepsi)\b/i;

const normalUrl = url => String(url ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');

// Why a model may not be used, or null when it is downloadable under an allowed license
export function licenseProblem(model) {
  if (!model || typeof model !== 'object') return 'no model record';
  if (model.isDownloadable !== true) return 'not downloadable (view-only)';
  if (model.isAgeRestricted) return 'age-restricted';
  if (model.price) return 'sold in a store';
  const slug = model.license?.slug;
  const allowed = LICENSES[slug];
  if (!allowed) return `license "${model.license?.label ?? slug ?? 'unknown'}" is not allowed (only CC0 and CC BY 4.0)`;
  if (normalUrl(model.license.url) !== allowed.url) return `license URL ${model.license.url} does not match ${allowed.name}`;
  return null;
}

// TASL attribution (title, author, source, license), as CC BY 4.0 section 3(a) asks
export function attributionText(model) {
  const allowed = LICENSES[model.license?.slug];
  const author = model.user?.displayName || model.user?.username;
  return `"${model.name}" by ${author} (${model.user?.profileUrl ?? `https://sketchfab.com/${model.user?.username}`}), ${model.viewerUrl}, licensed under ${allowed?.name ?? model.license?.label} (https://${allowed?.url ?? normalUrl(model.license?.url)}/)`;
}

export function toCandidate(request, model, {score = null, matchedTerms = [], coverage = null} = {}) {
  const allowed = LICENSES[model.license?.slug];
  const warnings = ['CC licenses do not clear trademarks or brand designs: review the model for logos and real products'];
  if (BRANDS.test([model.name, ...(model.tags ?? []).map(t => t.name ?? t)].join(' '))) warnings.push('Possible real brand in the name or tags: excluded unless the branding is removed');
  if (allowed?.attribution) warnings.push('Attribution required: the credit line must appear with the published video');
  const thumbs = [...(model.thumbnails?.images ?? [])].sort((a, b) => b.width - a.width);
  return {
    provider:'sketchfab', id:model.uid, name:model.name, score, matchedTerms, coverage,
    sourceUrl:model.viewerUrl, license:allowed?.id ?? null, licenseEvidence:`${API}/models/${model.uid} (license.slug "${model.license?.slug}", ${model.license?.url})`,
    licenseVerified:!licenseProblem(model), attributionRequired:!!allowed?.attribution, credit:attributionText(model),
    creator:model.user?.displayName || model.user?.username || null, creatorUrl:model.user?.profileUrl ?? null,
    style:null, tags:(model.tags ?? []).map(t => t.name ?? t), category:(model.categories ?? []).map(c => c.name ?? c).join(', ') || null,
    polycount:model.faceCount ?? null, dimensions:null, thumbnailUrl:(thumbs.find(t => t.width <= 1024) ?? thumbs[0])?.url ?? null,
    updatedAt:model.updatedAt ?? model.publishedAt ?? null, downloaded:false, warnings
  };
}

export function createSketchfabProvider({
  fetch:fetchImpl = globalThis.fetch,
  cacheDir = resolve(root, 'assets/cache'),
  userAgent = 'hold-up-animation-v2/0.1.0',
  token = process.env.SKETCHFAB_API_TOKEN,
  now = () => Date.now(),
  timeoutMs = 30000,
  downloadTimeoutMs = 10 * 60 * 1000
} = {}) {
  const providerDir = join(cacheDir, 'sketchfab');

  // Every hop must be HTTPS on an approved host; the token is only ever attached to API hosts
  async function safeFetch(url, allowedHosts, ms, {auth = false} = {}) {
    const signal = AbortSignal.timeout(ms);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !allowedHosts.includes(parsed.hostname)) throw new Error(`Refusing request to unapproved host: ${parsed.protocol}//${parsed.hostname}`);
      const headers = {'User-Agent':userAgent};
      if (auth && API_HOSTS.includes(parsed.hostname)) headers.Authorization = `Token ${token}`;
      const response = await fetchImpl(url, {headers, signal, redirect:'manual'});
      if (response.url && !allowedHosts.includes(new URL(response.url).hostname)) {
        await response.body?.cancel();
        throw new Error(`Refusing response from unapproved host: ${new URL(response.url).hostname}`);
      }
      if (response.status < 300 || response.status > 399) return response;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw new Error('Redirect without Location');
      url = new URL(location, url).href;
    }
    throw new Error('Too many redirects');
  }

  async function getJson(path, {auth = false} = {}) {
    const response = await safeFetch(`${API}${path}`, API_HOSTS, timeoutMs, {auth});
    if (response.ok) return response.json();
    await response.body?.cancel();
    const reason = {400:'the model is not downloadable', 401:'the API token is missing or invalid', 403:'permission denied',
      404:'not found', 429:'rate limited by Sketchfab; wait before retrying'}[response.status] ?? 'request failed';
    throw new Error(`Sketchfab API ${response.status} for ${path.split('?')[0]}: ${reason}`);
  }

  const modelRecord = uid => getJson(`/models/${uid}`);

  async function search(request, {limit = 5, perLicense = 24} = {}) {
    if (!request?.query) throw new Error('Search request needs a query');
    const found = new Map();
    for (const slug of Object.keys(LICENSES)) { // Sequential: gentle on the API
      const params = new URLSearchParams({type:'models', downloadable:'true', license:slug, q:request.query, count:String(perLicense)});
      for (const model of (await getJson(`/search?${params}`)).results ?? []) found.set(model.uid, model);
    }
    const ranked = [...found.values()]
      .map(model => ({model, match:scoreModel(request, {id:model.uid, name:model.name, tags:(model.tags ?? []).map(t => t.name ?? t), description:model.description ?? ''})}))
      .filter(({match}) => match.score > 0)
      .sort((a, b) => b.match.coverage - a.match.coverage || b.match.score - a.match.score || (b.model.likeCount ?? 0) - (a.model.likeCount ?? 0) || a.model.uid.localeCompare(b.model.uid));
    // Search results are not license evidence: each candidate's own record is checked before it is offered
    const candidates = [];
    for (const {model, match} of ranked) {
      if (candidates.length >= limit) break;
      const record = await modelRecord(model.uid);
      if (!licenseProblem(record)) candidates.push(toCandidate(request, record, match));
    }
    return candidates;
  }

  async function sha256File(path) {
    const hash = createHash('sha256');
    await pipeline(createReadStream(path), hash);
    return hash.digest('hex');
  }

  async function cacheProblem(dest) {
    let provenance;
    try { provenance = JSON.parse(await readFile(join(dest, 'provenance.json'), 'utf8')); }
    catch { return 'missing or unreadable provenance.json'; }
    if (!provenance.files?.length) return 'provenance lists no files';
    for (const file of provenance.files) {
      const path = join(dest, file.path);
      try { if ((await stat(path)).size !== file.size) return `size mismatch for ${file.path}`; }
      catch { return `missing ${file.path}`; }
      if (await sha256File(path) !== file.sha256) return `SHA-256 mismatch for ${file.path}`;
    }
    return null;
  }

  // Streams the archive to disk, hashing it, and aborts as soon as it exceeds the size the API declared
  async function downloadArchive(url, size, target) {
    const response = await safeFetch(url, DOWNLOAD_HOSTS, downloadTimeoutMs);
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`Archive download failed (${response.status})`); }
    const sha256 = createHash('sha256');
    let received = 0;
    const meter = new Transform({transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (size && received > size) return callback(new Error(`Archive is larger than the ${size} bytes Sketchfab declared`));
      sha256.update(chunk);
      callback(null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(target));
    if (size && received !== size) throw new Error(`Archive size mismatch: expected ${size}, got ${received}`);
    return {size:received, sha256:sha256.digest('hex')};
  }

  async function fetchModel(uid, {maxBytes = 200 * 1024 * 1024} = {}) {
    if (!/^[0-9a-f]{32}$/.test(String(uid))) throw new Error(`Invalid Sketchfab model uid: ${uid}`);
    const record = await modelRecord(uid);
    const problem = licenseProblem(record);
    if (problem) throw new Error(`Sketchfab model ${uid} refused: ${problem}`);
    const version = String(record.updatedAt ?? record.publishedAt ?? 'unversioned').replace(/[^0-9A-Za-z]/g, '');
    const dest = join(providerDir, uid, version);
    const cached = await stat(dest).then(() => true, () => false);
    const repaired = cached ? await cacheProblem(dest) : null;
    if (cached && !repaired) return {status:'cached', dir:dest, provenance:JSON.parse(await readFile(join(dest, 'provenance.json'), 'utf8'))};

    if (!token) throw new Error('Downloading from Sketchfab needs the owner\'s personal API token in SKETCHFAB_API_TOKEN (free account: sketchfab.com/settings/password). Search works without it.');
    const links = await getJson(`/models/${uid}/download`, {auth:true});
    const pick = links.glb?.url ? {format:'glb', ...links.glb} : links.gltf?.url ? {format:'gltf', ...links.gltf} : null;
    if (!pick) throw new Error(`Sketchfab returned no glTF/GLB download for ${uid}`);
    if (pick.size && pick.size > maxBytes) throw new Error(`${uid} archive is ${pick.size} bytes, over the ${maxBytes} byte limit`);

    const partial = join(providerDir, '.partial', `${uid}-${version}-${process.pid}`);
    await rm(partial, {recursive:true, force:true});
    await mkdir(join(partial, 'files'), {recursive:true});
    try {
      const archivePath = join(partial, pick.format === 'glb' ? 'model.glb' : 'archive.zip');
      const archive = await downloadArchive(pick.url, pick.size, archivePath);
      let files, entry;
      if (pick.format === 'glb') {
        await rename(archivePath, join(partial, 'files', 'model.glb'));
        files = [{path:'model.glb', size:archive.size, sha256:archive.sha256}];
        entry = 'model.glb';
      } else {
        files = await extractZip(archivePath, join(partial, 'files'), {maxBytes});
        await rm(archivePath);
        const scenes = files.map(f => f.path).filter(p => /\.(gltf|glb)$/i.test(p));
        entry = scenes.find(p => p === 'scene.gltf') ?? (scenes.length === 1 ? scenes[0] : null);
        if (!entry) throw new Error(`Archive for ${uid} has no single glTF scene (found: ${scenes.join(', ') || 'none'})`);
      }
      for (const file of files) if (!safeRelPath(file.path)) throw new Error(`Unsafe file path: ${file.path}`);
      // The archive's own license/readme text is kept verbatim as part of the attribution evidence
      let archiveLicenseText = null;
      const licenseFile = files.find(f => /(^|\/)(license|licence|readme)[^/]*\.txt$/i.test(f.path) && f.size < 64 * 1024);
      if (licenseFile) archiveLicenseText = await readFile(join(partial, 'files', licenseFile.path), 'utf8');
      const candidate = toCandidate({}, record);
      const allowed = LICENSES[record.license.slug];
      const provenance = {
        version:1, provider:'sketchfab', id:uid, name:record.name, sourceUrl:record.viewerUrl,
        license:allowed.id, licenseSlug:record.license.slug, licenseLabel:record.license.label, licenseUrl:record.license.url,
        licenseRequirements:record.license.requirements ?? null, licenseEvidence:candidate.licenseEvidence,
        licenseCheckedAt:new Date(now()).toISOString(),
        creator:candidate.creator, creatorUsername:record.user?.username ?? null, creatorUrl:candidate.creatorUrl,
        attribution:{required:allowed.attribution, text:candidate.credit}, archiveLicenseText,
        modelVersion:version, retrievedAt:new Date(now()).toISOString(), archive:{format:pick.format, ...archive}, entry,
        description:record.description ?? '', tags:candidate.tags, category:candidate.category,
        apiTerms:TERMS_URL, providerCredit:CREDIT, warnings:candidate.warnings, files
      };
      await writeFile(join(partial, 'files', 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
      await mkdir(dirname(dest), {recursive:true});
      if (repaired) await rm(dest, {recursive:true, force:true}); // Replace a corrupted copy only after a verified redownload
      await rename(join(partial, 'files'), dest);
      await rm(partial, {recursive:true, force:true});
      return {status:'downloaded', dir:dest, provenance, ...(repaired && {repaired})};
    } catch (err) {
      await rm(partial, {recursive:true, force:true});
      throw err;
    }
  }

  // Fetches (or revalidates) a model and describes it in the provider-agnostic conversion source contract
  async function conversionSource(uid, options = {}) {
    const fetched = await fetchModel(uid, options);
    const p = fetched.provenance;
    return {
      provider:'sketchfab', id:uid, version:p.modelVersion, dir:fetched.dir, entry:p.entry, fetchStatus:fetched.status,
      files:p.files.map(({path, size, sha256}) => ({path, size, sha256})),
      attribution:{name:p.name, sourceUrl:p.sourceUrl, license:p.license, licenseEvidence:p.licenseEvidence, creator:p.creator,
        credit:p.attribution.text, attributionRequired:p.attribution.required},
      // Style is left to the reviewer at registration (--style); Sketchfab publishes no real-world dimensions
      metadata:{name:p.name, description:p.description, tags:p.tags, category:p.category, warnings:p.warnings},
      expected:null
    };
  }

  return {name:'sketchfab', credit:CREDIT, search, fetchModel, conversionSource};
}
