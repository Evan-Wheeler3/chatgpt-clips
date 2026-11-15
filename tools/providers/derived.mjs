import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveModel } from '../convert/derive-model.mjs';

/*
 * Adapted versions of approved source models, built from recipes in assets/recipes/<id>.json (committed, reproducible):
 *   {id, name, description, tags, style, from:{provider, id}, ops:[...], approval:{by, on, note}}
 * The source is the validated, converted GLB of that provider asset. The derived model keeps the source's license,
 * creator and source URL; its credit is the source credit plus the list of modifications (CC BY 4.0 section 3(a)(1)(B)).
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function loadRecipe(id, recipesDir = resolve(root, 'assets/recipes')) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Invalid recipe id: ${id}`);
  return JSON.parse(await readFile(join(recipesDir, `${id}.json`), 'utf8'));
}

// The latest passed conversion of a provider asset (its report records the source attribution)
export async function convertedSource(provider, id, convertedDir = resolve(root, 'assets/converted')) {
  const dir = join(convertedDir, provider, id);
  const reports = [];
  for (const key of await readdir(dir).catch(() => [])) {
    try { const report = JSON.parse(await readFile(join(dir, key, 'report.json'), 'utf8')); if (report.status === 'passed') reports.push({key, report, at:report.convertedAt ?? ''}); } catch { /* Incomplete */ }
  }
  if (!reports.length) throw new Error(`No passed conversion of ${provider}/${id}; convert it first`);
  reports.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const {key, report} = reports[0];
  return {glb:join(dir, key, report.glb.file), report};
}

export function createDerivedProvider({cacheDir = resolve(root, 'assets/cache'), recipesDir, convertedDir} = {}) {
  async function fetchModel(id) {
    const recipe = await loadRecipe(id, recipesDir);
    const source = await convertedSource(recipe.from.provider, recipe.from.id, convertedDir);
    const version = sha256(JSON.stringify({recipe, source:source.report.glb.sha256, tool:sha256(await readFile(resolve(root, 'tools/convert/derive-model.mjs')))})).slice(0, 12);
    const dest = join(cacheDir, 'derived', id, version);
    try {
      const provenance = JSON.parse(await readFile(join(dest, 'provenance.json'), 'utf8'));
      if (sha256(await readFile(join(dest, provenance.entry))) === provenance.files[0].sha256) return {status:'cached', dir:dest, provenance};
    } catch { /* Build below */ }
    const {bytes, log} = await deriveModel(source.glb, recipe.ops);
    const a = source.report.attribution;
    const credit = a.credit ? `${a.credit}; modified by Hold Up: ${log.join('; ')}` : null;
    const provenance = {version:1, provider:'derived', id, name:recipe.name, modelVersion:version, recipe,
      from:{provider:recipe.from.provider, id:recipe.from.id, glbSha256:source.report.glb.sha256, name:a.name},
      sourceUrl:a.sourceUrl, license:a.license, licenseEvidence:a.licenseEvidence, creator:a.creator, credit, modifications:log,
      entry:'model.glb', files:[{path:'model.glb', size:bytes.length, sha256:sha256(bytes)}]};
    const partial = `${dest}.partial-${process.pid}`;
    await rm(partial, {recursive:true, force:true}); await mkdir(partial, {recursive:true});
    await writeFile(join(partial, 'model.glb'), bytes);
    await writeFile(join(partial, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
    await mkdir(dirname(dest), {recursive:true}); await rm(dest, {recursive:true, force:true}); await rename(partial, dest);
    return {status:'derived', dir:dest, provenance};
  }

  async function conversionSource(id) {
    const fetched = await fetchModel(id), p = fetched.provenance, recipe = p.recipe;
    return {provider:'derived', id, version:p.modelVersion, dir:fetched.dir, entry:p.entry, fetchStatus:fetched.status, files:p.files,
      attribution:{name:`${recipe.name} (adapted from "${p.from.name}")`, sourceUrl:p.sourceUrl, license:p.license, licenseEvidence:p.licenseEvidence, creator:p.creator, ...(p.credit && {credit:p.credit})},
      metadata:{name:recipe.name, description:recipe.description, tags:recipe.tags, category:recipe.category ?? null, style:recipe.style, warnings:[]}, expected:null};
  }
  return {name:'derived', search:async () => [], fetchModel, conversionSource};
}
