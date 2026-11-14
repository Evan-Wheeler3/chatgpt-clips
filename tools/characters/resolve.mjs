import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCatalog, ROOT } from './library.mjs';

/*
 * Character resolver: for each role a script needs, decide between
 *   reuse    an approved character is this person (same role or alias), in period, with an approved outfit that fits
 *   variant  it is the same person, but the script needs an outfit or accessory variant that has no approved artwork yet
 *   new      no approved character can honestly play the part: request new artwork through intake
 * Hard constraints (never relaxed to avoid making a character): role identity, era, and age band.
 * A family match (two tradespeople) is reported for context but never makes one character stand in for another.
 */

// What the vector figure (tools/characters/figure.mjs) can already paint from forms; anything else needs new
// artwork as an attachment layer (outfit or accessory) or new forms
export const BUILT_IN_FORMS = {
  'round cartoon head': 'head', 'curly hair': 'hair', 'newsboy cap': 'cap', 'work shirt with rolled sleeves': 'torso + sleeves + cuffs',
  'open collar': 'collar', 'bib apron with straps': 'apron + straps', 'trousers': 'legs', 'jeans': 'legs, recoloured', 'boots': 'boot', 'mitten hands': 'hands'
};
// "wool trousers" is the trousers form in another colour: match a built-in form by its last words
const builtIn = garment => { const g = lower(garment); return Object.keys(BUILT_IN_FORMS).find(k => g === k || g.endsWith(' ' + k)); };
// Shared systems every vector character reuses unchanged
export const SHARED_RIG = ['skeleton and pose engine (tools/storyboard/character.mjs)', 'pose presets with anticipation', 'walk cycle', 'push and touch IK (object interaction)',
  'expression system (face data + faceMap)', 'blinks, gaze and head turn', 'feet grounding', 'painter, card renderer and silhouette shadow', 'palette compensation', 'attachment layers on any bone (outfits, accessories)',
  'rig checks, visual regression and approval gates'];

const lower = s => (s ?? '').toLowerCase().trim();

export async function loadRoles(root = ROOT) { return JSON.parse(await readFile(join(root, 'characters', 'roles.json'), 'utf8')); }

export function normalizeRole(role, roles) {
  const r = lower(role), canonical = roles.aliases[r] ?? r;
  const family = Object.entries(roles.families).find(([, list]) => list.includes(canonical))?.[0] ?? null;
  return {role:canonical, family, ordinary:roles.ordinary.includes(family)};
}

const yearsOf = era => era == null ? null : typeof era === 'number' ? [era, era] : [era.from ?? era.year, era.to ?? era.year];
const overlaps = (a, b) => !a || !b || (a[0] <= b[1] && b[0] <= a[1]);
const ageBand = age => /child|kid|boy|girl/i.test(age ?? '') ? 'child' : /teen/i.test(age ?? '') ? 'teen' : 'adult';

export function resolveRole(request, catalog, roles) {
  const want = normalizeRole(request.role, roles), years = yearsOf(request.era), considered = [];
  const reasons = (c, list) => considered.push({id:c.id, status:c.status, outcome:list.length ? 'rejected' : 'candidate', reasons:list});
  let best = null;
  for (const c of catalog.characters) {
    if (c.kind !== 'managed') continue; // legacy and intake designs are never offered
    const r = [];
    if (!['rig-approved', 'production-approved'].includes(c.status)) r.push(`not approved for use (${c.status})`);
    const roleSet = c.roles.map(x => normalizeRole(x, roles).role);
    if (!roleSet.includes(want.role)) r.push(c.family && c.family === want.family
      ? `same family (${want.family}) but a different person: ${c.roles.join('/')} is not a ${want.role}`
      : `role mismatch: ${c.roles.join('/')} (${c.family ?? 'no family'}) is not a ${want.role} (${want.family ?? 'unlisted role'})`);
    if (!overlaps(years, yearsOf(c.era))) r.push(`era mismatch: needs ${years.join('-')}, character is ${yearsOf(c.era).join('-')}`);
    if (ageBand(request.age) !== ageBand(c.age)) r.push(`age mismatch: needs ${request.age}, character is ${c.age}`);
    reasons(c, r);
    if (r.length) continue;
    // Same person: does an approved outfit fit the scene's period and needs, and are the accessories there?
    const outfits = Object.entries(c.outfits).filter(([, o]) => o.status === 'approved');
    const fitting = outfits.filter(([, o]) => overlaps(yearsOf(request.outfit?.era ?? request.era), yearsOf(o.era)) && (request.outfit?.tags ?? []).every(t => o.tags.includes(t)));
    const missingAccessories = (request.accessories ?? []).filter(a => !c.accessories.includes(a));
    best = {id:c.id, outfit:fitting[0]?.[0] ?? null, missingOutfit:!fitting.length, missingAccessories};
    break;
  }
  const garments = request.garments ?? [];
  const rig = {reuse:SHARED_RIG, reusableForms:garments.filter(builtIn).map(g => `${g} (${BUILT_IN_FORMS[builtIn(g)]})`), newArtwork:[...garments.filter(g => !builtIn(g)), ...(request.accessories ?? []).map(a => `${a} (accessory layer)`)]};
  if (!best) return {slot:request.slot, role:want.role, family:want.family, decision:'new', reason:'No approved character can play this role without changing who they are or when they live', considered, rig};
  if (best.missingOutfit || best.missingAccessories.length) {
    return {slot:request.slot, role:want.role, decision:'variant', character:best.id, needs:{outfit:best.missingOutfit ? request.outfit ?? {} : null, accessories:best.missingAccessories},
      reason:'The right person exists; the scene needs variant artwork for them', considered, rig};
  }
  return {slot:request.slot, role:want.role, decision:'reuse', character:best.id, outfit:best.outfit, considered, rig};
}

export async function resolveCast(requests, root = ROOT) {
  const [catalog, roles] = await Promise.all([buildCatalog(root), loadRoles(root)]);
  return requests.map(r => resolveRole(r, catalog, roles));
}
