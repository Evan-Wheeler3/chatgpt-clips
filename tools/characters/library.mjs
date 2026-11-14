import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The Hold Up character library.
 *   characters/<id>/            managed characters: character.json, reference, metadata.json (library record + approvals)
 *   characters/intake/<id>/     requested characters: brief, imported artwork, design approval (see tools/characters/intake.mjs)
 *   characters/<id>.json        legacy and experimental designs (Bram, Phase 5.1 candidates): never offered for reuse
 * Approvals are per design version and bound to the definition's SHA-256, so editing an approved character
 * silently voids its approvals. Only a named human can approve; the pipeline never approves its own work.
 */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STAGES = ['design', 'rig', 'production'];
const exists = path => access(path).then(() => true, () => false);
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
// Approvals must come from a person. These names are what an automated step would write
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;

export async function managedIds(root = ROOT) {
  const ids = [];
  for (const entry of await readdir(join(root, 'characters'), {withFileTypes:true})) {
    if (entry.isDirectory() && entry.name !== 'intake' && await exists(join(root, 'characters', entry.name, 'metadata.json'))) ids.push(entry.name);
  }
  return ids.sort();
}

export async function approvalState(id, root = ROOT) {
  const dir = join(root, 'characters', id), meta = await readJson(join(dir, 'metadata.json'));
  const def = await readJson(join(dir, 'character.json')), version = def.design?.version;
  const record = meta.approvals?.[version] ?? {};
  const definitionMatches = record.definitionSha256 === await sha256(join(dir, 'character.json'));
  const stage = name => ({status:definitionMatches ? record[name]?.status ?? 'pending' : 'void', by:record[name]?.by ?? null, on:record[name]?.on ?? null});
  return {id, version, definitionMatches, ...Object.fromEntries(STAGES.map(s => [s, stage(s)]))};
}

// storyboard and review renders need design + rig approval; final delivery also needs production approval
export async function usableFor(id, purpose = 'storyboard', root = ROOT) {
  const state = await approvalState(id, root);
  const needed = purpose === 'final' ? STAGES : ['design', 'rig'];
  const missing = needed.filter(s => state[s].status !== 'approved');
  return {usable:missing.length === 0, missing, state};
}

export async function recordDecision(id, stage, decision, {by, evidence = '', on = new Date().toISOString().slice(0, 10), root = ROOT} = {}) {
  if (!STAGES.includes(stage)) throw new Error(`Unknown approval stage "${stage}" (${STAGES.join(', ')})`);
  if (!['approved', 'rejected'].includes(decision)) throw new Error(`Unknown decision "${decision}"`);
  if (NOT_A_PERSON.test((by ?? '').trim())) throw new Error(`Approvals need the name of the human reviewer (got "${by ?? ''}"); the pipeline cannot approve its own work`);
  const dir = join(root, 'characters', id), path = join(dir, 'metadata.json'), meta = await readJson(path);
  const def = await readJson(join(dir, 'character.json')), version = def.design?.version;
  if (!version) throw new Error(`${id}: character.json has no design.version`);
  const definitionSha256 = await sha256(join(dir, 'character.json'));
  meta.approvals ??= {};
  const record = meta.approvals[version] ??= {definitionSha256};
  if (record.definitionSha256 !== definitionSha256) {
    // The definition changed since the last decision on this version: start this version's record again
    meta.approvals[version] = {definitionSha256};
  }
  const earlier = STAGES.slice(0, STAGES.indexOf(stage)).filter(s => meta.approvals[version][s]?.status !== 'approved');
  if (decision === 'approved' && earlier.length) throw new Error(`${id} ${version}: approve ${earlier.join(' and ')} before ${stage}`);
  const previous = meta.approvals[version][stage]?.status ?? 'pending';
  meta.approvals[version][stage] = {status:decision, by:by.trim(), on, evidence};
  // Append-only audit trail: every decision, including what it replaced
  (meta.approvalLog ??= []).push({version, stage, decision, previous, by:by.trim(), on, evidence, definitionSha256});
  await writeFile(path, JSON.stringify(meta, null, 2) + '\n');
  return approvalState(id, root);
}

async function intakeEntries(root) {
  const dir = join(root, 'characters', 'intake');
  if (!await exists(dir)) return [];
  const out = [];
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const file = join(dir, entry.name, 'intake.json');
    if (entry.isDirectory() && await exists(file)) out.push(await readJson(file));
  }
  return out;
}

// The catalog: one discoverable index of every character the pipeline knows, generated from the folders
export async function buildCatalog(root = ROOT) {
  const characters = [];
  for (const id of await managedIds(root)) {
    const dir = join(root, 'characters', id), meta = await readJson(join(dir, 'metadata.json')), def = await readJson(join(dir, 'character.json'));
    const state = await approvalState(id, root), lib = meta.library ?? {};
    characters.push({
      id, name:def.name, kind:'managed', version:state.version,
      status:STAGES.every(s => state[s].status === 'approved') ? 'production-approved' : state.design.status === 'approved' && state.rig.status === 'approved' ? 'rig-approved' : state.design.status === 'approved' ? 'design-approved' : 'unapproved',
      approvals:Object.fromEntries(STAGES.map(s => [s, state[s].status])),
      roles:lib.roles ?? [], family:lib.family ?? null, description:lib.description ?? def.description, personality:lib.personality ?? null,
      historicalContext:lib.historicalContext ?? null, era:lib.era ?? null, regions:lib.regions ?? [], age:lib.age ?? null, build:lib.build ?? null, settings:lib.settings ?? [],
      outfits:Object.fromEntries(Object.entries(lib.outfits ?? {}).map(([k, o]) => [k, {status:o.status, default:!!o.default, era:o.era ?? null, tags:o.tags ?? []}])),
      accessories:Object.keys(lib.accessories ?? {}), expressions:Object.keys(def.expressions ?? {}),
      rig:{mode:def.render?.mode, heightM:def.heightM, heightMm:def.rig?.heightMm},
      rights:lib.rights ?? null,
      files:{definition:`characters/${id}/character.json`, reference:def.reference ?? null, metadata:`characters/${id}/metadata.json`}
    });
  }
  for (const intake of (await intakeEntries(root)).filter(i => i.status !== 'promoted')) {
    characters.push({id:intake.id, name:intake.name, kind:'intake', status:intake.status, roles:intake.request?.roles ?? [], family:intake.request?.family ?? null,
      era:intake.request?.era ?? null, regions:intake.request?.regions ?? [], description:intake.request?.description ?? null,
      approvals:{design:intake.approvals?.design?.status ?? 'pending', rig:'pending', production:'pending'}, files:{intake:`characters/intake/${intake.id}/intake.json`}});
  }
  for (const entry of await readdir(join(root, 'characters'))) {
    if (!entry.endsWith('.json') || ['catalog.json', 'roles.json', 'style-guide.json'].includes(entry)) continue;
    const def = await readJson(join(root, 'characters', entry));
    if (!def.rig) continue;
    characters.push({id:def.id, name:def.name, kind:'legacy', status:def.status === 'legacy' ? 'legacy' : 'experimental', note:'Not offered for reuse: a retired or unapproved design kept for reference', files:{definition:`characters/${entry}`}});
  }
  return {note:'Generated by `node tools/characters/library.mjs catalog`. Edit characters/<id>/metadata.json, not this file.', characters};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, id, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  const run = async () => {
    if (command === 'catalog') { const c = await buildCatalog(); await writeFile(join(ROOT, 'characters', 'catalog.json'), JSON.stringify(c, null, 2) + '\n'); return print(c.characters.map(x => `${x.id} (${x.kind}, ${x.status})`)); }
    if (command === 'list') return print((await buildCatalog()).characters.map(x => ({id:x.id, kind:x.kind, status:x.status, roles:x.roles})));
    if (command === 'status') return print(await approvalState(id));
    if (command === 'approve' || command === 'reject') return print(await recordDecision(id, opt('--stage'), command === 'approve' ? 'approved' : 'rejected', {by:opt('--by'), evidence:opt('--evidence') ?? ''}));
    throw new Error('Usage: library.mjs catalog | list | status <id> | approve <id> --stage design|rig|production --by "<reviewer>" [--evidence "<note>"] | reject <id> --stage ... --by ...');
  };
  run().catch(err => { console.error(err.message); process.exitCode = 1; });
}
