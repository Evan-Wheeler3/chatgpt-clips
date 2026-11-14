import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, symlink, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCatalog, approvalState, recordDecision, usableFor } from '../tools/characters/library.mjs';
import { resolveRole, loadRoles } from '../tools/characters/resolve.mjs';
import { createBriefs, importArtwork, decideDesign, promote, readIntake } from '../tools/characters/intake.mjs';
import { lockStatus } from '../tools/characters/lock.mjs';
import { buildFigure } from '../tools/characters/figure.mjs';
import { figureIssues, figureMeasures } from '../tools/characters/rig-checks.mjs';
import { NEUTRAL_STATE } from '../tools/characters/validate.mjs';
import { POSE_PRESETS } from '../tools/storyboard/character.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { studioStory, ticks } from '../tools/character-rig.mjs';

const run = promisify(execFile);
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const cooperDef = () => readJson(join(repo, 'characters/cooper/character.json'));

// A disposable copy of the library (assets, environments and styles linked), so approvals and imports never touch the repo
async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), 'holdup-library-'));
  await cp(join(repo, 'characters'), join(root, 'characters'), {recursive:true, filter:src => !src.includes('/intake/')});
  for (const dir of ['assets', 'environments', 'styles', 'stories']) await symlink(join(repo, dir), join(root, dir));
  return root;
}
const request = (role, era, extra = {}) => ({slot:'test', role, era, age:'young adult', ...extra});

test('the catalog lists managed, intake and legacy characters; only approved managed ones are reusable', async () => {
  const catalog = await buildCatalog(repo);
  const cooper = catalog.characters.find(c => c.id === 'cooper');
  assert.equal(cooper.kind, 'managed');
  assert.equal(cooper.status, 'production-approved');
  assert.equal(cooper.rights.confirmed, false, 'visual approval does not confirm commercial rights');
  assert.ok(cooper.expressions.length >= 10 && cooper.outfits.workshop.status === 'approved');
  assert.equal(catalog.characters.find(c => c.id === 'bram').kind, 'legacy');
  const stored = await readJson(join(repo, 'characters/catalog.json'));
  assert.deepEqual(stored.characters.map(c => [c.id, c.status]), catalog.characters.map(c => [c.id, c.status]), 'characters/catalog.json is up to date (run library.mjs catalog)');
});

test('the resolver reuses the cooper only as himself, in period, and asks for variants or new characters otherwise', async () => {
  const [catalog, roles] = await Promise.all([buildCatalog(repo), loadRoles(repo)]);
  const reuse = resolveRole(request('barrel maker', 1858), catalog, roles);
  assert.equal(reuse.decision, 'reuse'); assert.equal(reuse.character, 'cooper'); assert.equal(reuse.outfit, 'workshop');
  const tool = resolveRole(request('cooper', 1858, {accessories:['mallet']}), catalog, roles);
  assert.equal(tool.decision, 'variant'); assert.deepEqual(tool.needs.accessories, ['mallet']);
  const winter = resolveRole(request('cooper', 1858, {outfit:{era:1858, tags:['winter coat']}}), catalog, roles);
  assert.equal(winter.decision, 'variant'); assert.ok(winter.needs.outfit);
  // Never a stand-in: a different person in the same trade family, another role, another era or another age band
  for (const [req, why] of [[request('blacksmith', 1858), /same family/], [request('gunfighter', 1873), /role mismatch/], [request('cooper', 1950), /era mismatch/], [request('cooper', 1858, {age:'child'}), /age mismatch/]]) {
    const r = resolveRole(req, catalog, roles);
    assert.equal(r.decision, 'new', JSON.stringify(req));
    assert.match(r.considered.find(c => c.id === 'cooper').reasons.join(' '), why);
  }
  assert.ok(!reuse.considered.some(c => c.id === 'bram'), 'legacy designs are never considered');
});

test('approval gates: human-only, in order, bound to the exact definition, and enforced by plan validation', async () => {
  const root = await sandbox();
  try {
    const before = await lockStatus('cooper');
    // A fresh version with no approvals yet
    const defFile = join(root, 'characters/cooper/character.json'), def = await readJson(defFile);
    def.design.version = '1.1.0'; await writeFile(defFile, JSON.stringify(def, null, 2) + '\n');
    const plan = () => compileStory(studioStory('cooper'), {words:ticks(6), audio:{durationSec:6}}, {rootDir:root, catalogPath:join(repo, 'assets/catalog.json')});
    assert.ok(validatePlan(await plan()).errors.some(e => e.code === 'CHARACTER_NOT_APPROVED'));
    await assert.rejects(recordDecision('cooper', 'design', 'approved', {by:'Claude', root}), /human reviewer/);
    await assert.rejects(recordDecision('cooper', 'design', 'approved', {by:'', root}), /human reviewer/);
    await assert.rejects(recordDecision('cooper', 'rig', 'approved', {by:'Ada Reviewer', root}), /approve design before rig/);
    await recordDecision('cooper', 'design', 'approved', {by:'Ada Reviewer', root});
    await recordDecision('cooper', 'rig', 'approved', {by:'Ada Reviewer', root});
    const v = validatePlan(await plan());
    assert.ok(!v.errors.some(e => e.code === 'CHARACTER_NOT_APPROVED'));
    assert.ok(v.warnings.some(w => w.code === 'CHARACTER_PRODUCTION_PENDING'));
    assert.equal((await usableFor('cooper', 'final', root)).usable, false);
    const meta = await readJson(join(root, 'characters/cooper/metadata.json'));
    assert.deepEqual(meta.approvalLog.slice(-2).map(e => [e.version, e.stage, e.decision]), [['1.1.0', 'design', 'approved'], ['1.1.0', 'rig', 'approved']]);
    assert.equal(meta.approvals['1.0.0'].production.status, 'approved', 'earlier versions keep their record');
    // Editing the definition voids the approvals of its version
    def.heightM = 1.41; await writeFile(defFile, JSON.stringify(def, null, 2) + '\n');
    const state = await approvalState('cooper', root);
    assert.equal(state.definitionMatches, false); assert.equal(state.rig.status, 'void');
    assert.ok(validatePlan(await plan()).errors.some(e => e.code === 'CHARACTER_NOT_APPROVED'));
    assert.deepEqual(before.changed, [], 'the repository copy stayed locked');
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('outfits and accessories need artwork files and approval before a story can use them', async () => {
  const root = await sandbox();
  try {
    const story = studioStory('cooper');
    story.cast[0].outfit = 'winter';
    const compile = () => compileStory(story, {words:ticks(6), audio:{durationSec:6}}, {rootDir:root, catalogPath:join(repo, 'assets/catalog.json')});
    await assert.rejects(compile(), /outfit "winter" has no artwork/);
    await mkdir(join(root, 'characters/cooper/outfits'), {recursive:true});
    await writeFile(join(root, 'characters/cooper/outfits/winter.json'), JSON.stringify({hide:[], layers:[]}));
    assert.ok(validatePlan(await compile()).errors.some(e => e.code === 'CHARACTER_VARIANT_NOT_APPROVED'));
  } finally { await rm(root, {recursive:true, force:true}); }
});

test('attachment layers follow their bones, outfits can hide built-in garments, and the default cooper is unchanged', async () => {
  const def = await cooperDef();
  const plain = JSON.stringify(buildFigure(def, NEUTRAL_STATE).items);
  assert.equal(JSON.stringify(buildFigure({...def, wearing:{}}, NEUTRAL_STATE).items), plain);
  const tool = {name:'test-block', palette:{steel:'#8a8f96'}, layers:[{id:'test-block', bone:'handF', slot:'heldF', shapes:[{points:[[0, 0], [20, 0], [20, -60], [0, -60]], fill:'steel'}]}]};
  const outfit = {name:'test-outfit', hide:['apron', 'straps', 'buttons', 'pocket'], layers:[]};
  const pose = {...NEUTRAL_STATE.pose, ...Object.fromEntries(Object.entries(POSE_PRESETS.point).filter(([k]) => k in NEUTRAL_STATE.pose))};
  const fig = buildFigure({...def, wearing:{outfit, accessories:[tool]}}, {...NEUTRAL_STATE, pose});
  const layer = fig.items.find(i => i.id === 'test-block');
  assert.ok(layer, 'the accessory is painted');
  assert.deepEqual(layer.shapes[0].pts[0].map(v => Math.round(v * 1000)), fig.joints.wristF.map(v => Math.round(v * 1000)), 'its origin is the wrist');
  assert.equal(layer.shapes[0].fill, '#8a8f96');
  const order = fig.items.map(i => i.id);
  assert.ok(order.indexOf('test-block') > order.indexOf('forearmF') && order.indexOf('test-block') < order.indexOf('torso'), 'held in the far hand, behind the body');
  assert.ok(!order.includes('apron') && !order.includes('straps'), 'the outfit hides the apron');
  assert.throws(() => buildFigure({...def, wearing:{accessories:[{layers:[{id:'x', bone:'tail', shapes:[]}]}]}}, NEUTRAL_STATE), /unknown bone "tail"/);
});

test('the rig adapts to other proportions without new animation code', async () => {
  const def = await cooperDef();
  const tall = structuredClone(def);
  const k = 1.18;
  for (const key of ['upperArm', 'forearm', 'thigh', 'shin', 'hipY', 'shoulderHeight', 'neckHeight']) tall.rig[key] = Math.round(tall.rig[key] * k);
  tall.rig.heightMm = Math.round(def.rig.heightMm * 1.12);
  tall.forms.torso = def.forms.torso.map(([x, y]) => [x, Math.round(y * k)]);
  tall.forms.apron.outline = def.forms.apron.outline.map(([x, y]) => [x, Math.round(y * k)]);
  for (const name of Object.keys(POSE_PRESETS)) {
    const pose = {...NEUTRAL_STATE.pose, ...Object.fromEntries(Object.entries(POSE_PRESETS[name]).filter(([key]) => key in NEUTRAL_STATE.pose))};
    for (const d of [def, tall]) {
      const {figure, issues} = figureIssues(d, {...NEUTRAL_STATE, pose});
      assert.deepEqual(issues.filter(i => i.code === 'JOINT_GAP' && !/shoulder|neck/.test(i.message)), [], `${d === tall ? 'tall' : 'cooper'} ${name}`);
      assert.ok(Math.abs(figureMeasures(figure).thighF - d.rig.thigh) < 1e-6);
    }
  }
});

test('intake: briefs for missing roles, guarded imports, human design approval, promotion only with a built definition', async () => {
  const root = await sandbox();
  try {
    const {created} = await createBriefs('stories/saloon-1873/characters.json', {root});
    assert.deepEqual(created.map(c => [c.slot, c.decision, c.status]), [['protagonist', 'new', 'awaiting-artwork'], ['gunfighter', 'new', 'awaiting-artwork']]);
    const id = 'saloon-1873-gunfighter', brief = await readJson(join(root, 'characters/intake', id, 'brief.json'));
    assert.match(brief.artworkRequest, /1873/); assert.match(brief.artworkRequest, /Do not imitate/);
    assert.ok(brief.rig.newArtwork.some(a => /hat/.test(a)) && brief.rig.reusableForms.some(f => /boots/.test(f)));
    // Imports: rights, format and size are checked; a real image of the right size goes in
    const big = join(root, 'sheet.png'), small = join(root, 'small.png'), text = join(root, 'notes.png');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#efe8dd:s=1600x1100', '-frames:v', '1', big]);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#efe8dd:s=640x480', '-frames:v', '1', small]);
    await writeFile(text, 'not an image');
    await assert.rejects(importArtwork(id, {image:big, source:'chatgpt-image', rights:'unknown', root}), /rights/);
    await assert.rejects(importArtwork(id, {image:small, source:'chatgpt-image', rights:'Owned by the channel', root}), /at least/);
    await assert.rejects(importArtwork(id, {image:text, source:'chatgpt-image', rights:'Owned by the channel', root}), /not a readable image/);
    await assert.rejects(decideDesign(id, 'approved', {by:'Ada Reviewer', root}), /no artwork/);
    await importArtwork(id, {image:big, source:'chatgpt-image', rights:'Generated for Hold Up by the channel owner', root});
    await assert.rejects(importArtwork(id, {image:big, source:'chatgpt-image', rights:'x', root}), /already imported/);
    await assert.rejects(decideDesign(id, 'approved', {by:'claude', root}), /human reviewer/);
    await assert.rejects(promote(id, {root}), /only an approved design/);
    await decideDesign(id, 'approved', {by:'Ada Reviewer', root});
    await assert.rejects(promote(id, {root}), /no vector definition yet/);
    // The developer rebuilds the approved sheet as a definition (here: a renamed copy, only to exercise the plumbing)
    const def = {...await cooperDef(), id:'test-gunfighter', name:'Test gunfighter', design:{version:'1.0.0'}};
    await writeFile(join(root, 'characters/intake', id, 'character.json'), JSON.stringify(def));
    const result = await promote(id, {root});
    assert.equal(result.id, 'test-gunfighter');
    const state = await approvalState('test-gunfighter', root);
    assert.deepEqual([state.design.status, state.rig.status, state.production.status], ['approved', 'pending', 'pending']);
    assert.equal((await readIntake(id, root)).status, 'promoted');
    const catalog = await buildCatalog(root);
    assert.equal(catalog.characters.find(c => c.id === 'test-gunfighter').status, 'design-approved');
    const r = resolveRole(request('gunfighter', 1873, {age:'adult'}), catalog, await loadRoles(root));
    assert.equal(r.decision, 'new', 'a design without rig approval is not offered for production');
  } finally { await rm(root, {recursive:true, force:true}); }
});
