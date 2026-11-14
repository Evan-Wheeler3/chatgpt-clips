import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STOP = new Set(['a','an','the','of','for','in','with','and','to','on','old','3d','model']);
const tokens = value => [...new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]+/g)?.filter(w => !STOP.has(w)) ?? [])];
const normalize = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
  return value.trim();
};

export function validateCatalog(catalog) {
  if (catalog?.version !== 1 || !Array.isArray(catalog.assets)) throw new Error('Invalid asset catalog version/shape');
  const ids = new Set();
  for (const item of catalog.assets) {
    for (const field of ['id','name','style','localPath','sourceUrl','license','creator']) normalize(item[field], field);
    if (ids.has(item.id)) throw new Error(`Duplicate asset id: ${item.id}`);
    ids.add(item.id);
    if (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string')) throw new Error(`Invalid tags: ${item.id}`);
    if (!/^https:\/\//.test(item.sourceUrl)) throw new Error(`Invalid sourceUrl: ${item.id}`);
    if (isAbsolute(item.localPath) || item.localPath.includes('\\')) throw new Error(`Invalid localPath: ${item.id}`);
    const full = resolve(root, item.localPath);
    if (relative(root, full).startsWith('..' + sep) || relative(root, full) === '..') throw new Error(`Path escapes repository: ${item.id}`);
    if (!/\.glb$/i.test(full)) throw new Error(`Asset is not GLB: ${item.id}`);
  }
  return catalog;
}

export function scoreAsset(request, asset) {
  const wanted = tokens([request.query, ...(request.tags ?? [])].join(' '));
  const title = new Set(tokens(asset.name));
  const tags = new Set(tokens((asset.tags ?? []).join(' ')));
  const description = new Set(tokens(asset.description));
  let score = 0;
  for (const word of wanted) score += title.has(word) ? 4 : tags.has(word) ? 3 : description.has(word) ? 1 : 0;
  if (request.style && asset.style === request.style) score += 3;
  if (request.style && asset.style !== request.style) score -= 6;
  return score;
}

export async function resolveAssets(requests, {catalogPath = resolve(root,'assets/catalog.json')} = {}) {
  const catalog = validateCatalog(JSON.parse(await readFile(catalogPath,'utf8')));
  if (!Array.isArray(requests)) throw new Error('requests must be an array');
  const installed = [];
  for (const asset of catalog.assets) {
    try { await access(resolve(root, asset.localPath)); installed.push(asset); }
    catch { /* A catalog record does not prove that a local asset exists */ }
  }
  return Promise.all(requests.map(async request => {
    if (!request?.id || !request?.query) throw new Error('Every request needs id and query');
    const candidates = installed.map(asset => ({asset, score:scoreAsset(request,asset)}))
      .filter(candidate => candidate.score > 0 && (!request.style || candidate.asset.style === request.style))
      .sort((a,b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id))
      .map(candidate => ({...candidate.asset, score:candidate.score}));
    return {requestId:request.id, query:request.query, status:candidates.length ? 'found' : 'not_found', candidates};
  }));
}

async function main(args) {
  let query, requestFile, outFile;
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--query') query=args[++i];
    else if (args[i] === '--request') requestFile=args[++i];
    else if (args[i] === '--out') outFile=args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!!query === !!requestFile) throw new Error('Provide exactly one of --query or --request');
  const requests = query ? [{id:'ad-hoc',query}] : JSON.parse(await readFile(resolve(process.cwd(),requestFile),'utf8')).requests;
  const result = {version:1,results:await resolveAssets(requests)};
  const output=JSON.stringify(result,null,2)+'\n';
  if (outFile) {
    const full=resolve(process.cwd(),outFile);
    await mkdir(dirname(full),{recursive:true});
    await writeFile(full,output);
  }
  process.stdout.write(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
}
