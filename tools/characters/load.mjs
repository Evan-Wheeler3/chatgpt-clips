import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Characters live either as characters/<id>.json (Phase 5 designs, legacy Bram) or as a folder,
// characters/<id>/character.json, next to their reference, approved renders and regression baselines (the master cooper)
export async function characterFile(rootDir, id) {
  const folder = resolve(rootDir, 'characters', id, 'character.json');
  try { await access(folder); return folder; } catch { return resolve(rootDir, 'characters', `${id}.json`); }
}

export async function loadCharacter(rootDir, id) {
  return JSON.parse(await readFile(await characterFile(rootDir, id), 'utf8'));
}

// Outfit and accessory variants live beside a managed character (characters/<id>/outfits/<name>.json,
// characters/<id>/accessories/<name>.json) so the approved character.json never changes. Missing files are errors:
// a story that needs artwork nobody has made must not render with something else in its place.
export async function loadWearing(rootDir, id, {outfit, accessories = []} = {}) {
  const dir = resolve(rootDir, 'characters', id);
  const read = async (kind, name) => {
    const file = resolve(dir, kind, `${name}.json`);
    try { await access(file); } catch { throw new Error(`Character ${id}: ${kind.slice(0, -1)} "${name}" has no artwork (${file.replace(rootDir + '/', '')} is missing); request it through the intake workflow`); }
    return {name, ...JSON.parse(await readFile(file, 'utf8'))};
  };
  const wearing = {};
  if (outfit) wearing.outfit = await read('outfits', outfit);
  if (accessories.length) wearing.accessories = await Promise.all(accessories.map(a => read('accessories', a)));
  return wearing;
}

// Approval facts for a cast member, gathered at compile time so plan validation stays synchronous
export async function castApproval(rootDir, id, {outfit, accessories = []} = {}) {
  const metaFile = resolve(rootDir, 'characters', id, 'metadata.json');
  try { await access(metaFile); } catch { return {managed:false}; }
  const { approvalState } = await import('./library.mjs');
  const state = await approvalState(id, rootDir), lib = JSON.parse(await readFile(metaFile, 'utf8')).library ?? {};
  const variants = [...(outfit ? [['outfit', outfit, lib.outfits?.[outfit]]] : []), ...accessories.map(a => ['accessory', a, lib.accessories?.[a]])];
  return {managed:true, version:state.version, definitionMatches:state.definitionMatches, design:state.design.status, rig:state.rig.status, production:state.production.status,
    variants:variants.map(([kind, name, record]) => ({kind, name, status:record?.builtIn ? 'approved' : record?.status ?? 'unregistered'}))};
}
