import {test} from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefinition, FAMILIES } from '../tools/characters/design.mjs';
import { validateDefinition, REQUIRED_PARTS } from '../tools/characters/validate.mjs';
import { judgeCharacterMetrics } from '../tools/characters/metrics.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { castTracks } from '../tools/storyboard/sample.mjs';
import { openRenderer } from '../tools/storyboard/animatic.mjs';
import { findChrome } from '../tools/convert/preview.mjs';
import { labStory } from '../tools/character-lab.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const specs = async () => Promise.all((await readdir(join(repo, 'characters/specs'))).map(async f => JSON.parse(await readFile(join(repo, 'characters/specs', f), 'utf8'))));
const archetypes = async () => Promise.all((await readdir(join(repo, 'characters/archetypes'))).map(async f => ({id:f.slice(0, -5), ...JSON.parse(await readFile(join(repo, 'characters/archetypes', f), 'utf8'))})));

test('the three candidate directions build complete, rig-compatible, clean definitions', async () => {
  const built = (await specs()).map(s => buildDefinition(s.family, s.person));
  assert.deepEqual(built.map(d => d.family).sort(), ['cutout', 'editorial', 'storyteller']);
  for (const def of built) {
    for (const part of REQUIRED_PARTS) assert.ok(def.parts[part], `${def.id} ${part}`);
    const report = validateDefinition(def);
    assert.equal(report.status, 'pass', `${def.id}: ${JSON.stringify([...report.errors, ...report.warnings])}`);
    assert.ok(report.metrics.headRatio >= 3.3, `${def.id} adult proportions`);
    assert.equal(def.render.mode, 'flat-tinted');
  }
  // Genuinely different designs, not recolours: proportions, line and outline differ
  const ratios = built.map(d => validateDefinition(d).metrics.headRatio);
  assert.ok(Math.max(...ratios) - Math.min(...ratios) > 1, `head ratios ${ratios}`);
  assert.equal(new Set(built.map(d => d.render.outlinePx)).size, 3);
  // Committed definitions match what the specs generate (no hand edits drifting from the system)
  for (const def of built) assert.deepEqual(JSON.parse(await readFile(join(repo, 'characters', `${def.id}.json`), 'utf8')), JSON.parse(JSON.stringify(def)));
});

test('archetypes cover different ages, bodies and garments in every family without joint gaps', async () => {
  for (const person of await archetypes()) for (const family of Object.keys(FAMILIES)) {
    const def = buildDefinition(family, {...person, id:`${family}-${person.id}`});
    const report = validateDefinition(def);
    assert.deepEqual(report.errors, [], `${def.id}`);
  }
  const scholar = buildDefinition('editorial', {...(await archetypes()).find(a => a.id === 'scholar'), id:'s'});
  assert.equal(scholar.parts.thighF.shapes.length, 0, 'a long skirt hides the thighs');
  const heights = (await archetypes()).map(a => a.heightMm);
  assert.ok(Math.max(...heights) - Math.min(...heights) >= 200, 'height range');
});

test('definition checks catch missing parts, unknown colours, joint gaps, childish proportions and colour problems', async () => {
  const [spec] = (await specs()).filter(s => s.family === 'editorial');
  const def = () => buildDefinition(spec.family, structuredClone(spec.person));
  const codes = d => [...validateDefinition(d).errors, ...validateDefinition(d).warnings].map(i => i.code);
  const a = def(); delete a.parts['mouth:oh']; assert.ok(codes(a).includes('MISSING_PART'));
  const b = def(); b.parts.torso.shapes[0].fill = 'neon'; assert.ok(codes(b).includes('UNKNOWN_COLOR'));
  const c = def(); c.rig.upperArm += 200; assert.ok(codes(c).includes('JOINT_GAP'));
  const d = buildDefinition(spec.family, {...structuredClone(spec.person), headRatio:2.6}); assert.ok(codes(d).includes('CHILDLIKE_PROPORTIONS'));
  const e = buildDefinition(spec.family, {...structuredClone(spec.person), palette:{...spec.person.palette, apron:'#ff0000', trousers:'#00ff00', accent:'#0000ff', hat:'#ffff00'}, hat:'bowler', clothing:{...spec.person.clothing, neckerchief:true}});
  assert.ok(codes(e).includes('SATURATED_COLOR'));
  assert.ok(codes(e).includes('TOO_MANY_COLORS'));
  const f = buildDefinition(spec.family, {...structuredClone(spec.person), palette:{...spec.person.palette, trousers:spec.person.palette.apron}}); assert.ok(codes(f).includes('LOW_VALUE_SEPARATION'));
  const bram = JSON.parse(await readFile(join(repo, 'characters/bram.json'), 'utf8'));
  assert.ok(codes(bram).includes('JOINT_GAP'), 'the audit finding on Bram (ankles) is detected');
});

test('pixel metric judge flags weak silhouettes, blending, detached parts, tiny faces and colour shifts', () => {
  const c = (over = {}) => ({id:'lead', visible:true, edgeContrast:0.5, colorContrast:30, pieces:1, headPoints:40, lab:[50, 10, 20], ...over});
  assert.equal(judgeCharacterMetrics([{frame:1, shot:'a', characters:[c()]}, {frame:2, shot:'b', characters:[c()]}]).status, 'pass');
  const codes = judgeCharacterMetrics([
    {frame:1, shot:'a', characters:[c({edgeContrast:0.02, colorContrast:4, pieces:2, headPoints:8})]},
    {frame:2, shot:'b', characters:[c({lab:[75, 10, 20]})]}
  ]).warnings.map(w => w.code);
  for (const code of ['CHARACTER_WEAK_SILHOUETTE', 'CHARACTER_BLENDS_IN', 'CHARACTER_DETACHED_PARTS', 'FACE_TOO_SMALL_ON_PHONE', 'CHARACTER_COLOR_SHIFT']) assert.ok(codes.includes(code), code);
});

test('poses scale with body size and pushes adapt (lean, crouch, step-in) so tall designs reach the prop', async () => {
  for (const id of ['cooper-editorial', 'cooper-storyteller', 'cooper-cutout', 'bram']) {
    const plan = await compileStory(labStory(id), {words:Array.from({length:48}, (_, i) => ({i, text:`t${i}`, start:i * 0.25, end:i * 0.25 + 0.2})), audio:{durationSec:12}});
    const v = validatePlan(plan);
    assert.ok(!v.errors.some(e => e.code === 'CHARACTER_NO_CONTACT'), `${id}: ${JSON.stringify(v.errors)}`);
    const track = castTracks(plan).get('lead');
    const push = plan.cast[0].actions.find(a => a.type === 'push');
    assert.ok(track[push.startFrame].contact.shortfallM < 0.03, `${id} hands on the barrel`);
    const crouch = track[push.startFrame - 2].pose.hipDrop / plan.cast[0].definition.rig.hipY;
    assert.ok(crouch > 0.08, `${id} crouches in proportion (${crouch.toFixed(2)})`);
  }
});

test('a flat-tinted candidate renders in one piece with a readable silhouette and stable colour', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const gpu = process.env.HOLDUP_GPU;
  process.env.HOLDUP_GPU = gpu ?? 'swiftshader';
  try {
    const plan = await compileStory(labStory('cooper-cutout'), {words:Array.from({length:48}, (_, i) => ({i, text:`t${i}`, start:i * 0.25, end:i * 0.25 + 0.2})), audio:{durationSec:12}});
    const r = await openRenderer(plan, {quality:'preview'});
    try {
      const frames = await r.page.evaluate(() => window.characterMetrics([27, 84, 122]));
      const verdict = judgeCharacterMetrics(frames);
      const s = verdict.summary.lead;
      assert.equal(s.maxPieces, 1);
      assert.ok(s.edgeContrast > 0.2, `edge ${s.edgeContrast}`);
      assert.ok(s.colorDriftBetweenShots < 10, `drift ${s.colorDriftBetweenShots}`);
      assert.deepEqual(r.problems, []);
    } finally { await r.close(); }
  } finally { if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu; }
});
