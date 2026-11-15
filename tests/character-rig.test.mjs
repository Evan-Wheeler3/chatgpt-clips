import {test} from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFigure, resolveExpression } from '../tools/characters/figure.mjs';
import { figureIssues, figureMeasures, REQUIRED_ITEMS } from '../tools/characters/rig-checks.mjs';
import { validateDefinition, NEUTRAL_STATE } from '../tools/characters/validate.mjs';
import { compensate, displayed, hexToRgb } from '../tools/characters/display.mjs';
import { POSE_PRESETS, FACES } from '../tools/storyboard/character.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { castTracks } from '../tools/storyboard/sample.mjs';
import { openRenderer } from '../tools/storyboard/animatic.mjs';
import { findChrome } from '../tools/convert/preview.mjs';
import { judgeCharacterMetrics } from '../tools/characters/metrics.mjs';
import { rigTestStory, studioStory, rigChecks, ticks } from '../tools/character-rig.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cooper = async () => JSON.parse(await readFile(join(repo, 'characters/cooper/character.json'), 'utf8'));
const NEUTRAL = NEUTRAL_STATE.pose;
const presetPose = name => ({...NEUTRAL, ...Object.fromEntries(Object.entries(POSE_PRESETS[name]).filter(([k]) => k in NEUTRAL))});

test('the cooper rig has every part, a complete expression set, and passes definition checks', async () => {
  const def = await cooper();
  const report = validateDefinition(def);
  assert.equal(report.status, 'pass', JSON.stringify(report.errors));
  const figure = buildFigure(def, NEUTRAL_STATE);
  for (const id of REQUIRED_ITEMS) assert.ok(figure.items.some(it => it.id === id), `${id} is painted`);
  for (const joint of ['hip', 'neck', 'headCenter', 'shoulderF', 'elbowF', 'wristF', 'handF', 'shoulderB', 'elbowB', 'wristB', 'handB', 'hipF', 'kneeF', 'ankleF', 'hipB', 'kneeB', 'ankleB']) assert.ok(figure.joints[joint], joint);
  // Every storyboard face resolves to one of the approved expressions
  for (const face of Object.keys(FACES)) assert.ok(def.expressions[resolveExpression(def, face).name], face);
  // Faces added after the cooper was approved fall back to his existing art (his definition is untouched)
  assert.equal(resolveExpression(def, 'relieved').name, 'happy');
});

test('definition checks catch missing forms, missing expressions and detached joints', async () => {
  const def = await cooper();
  const noApron = structuredClone(def); delete noApron.forms.apron;
  assert.ok(validateDefinition(noApron).errors.some(e => e.code === 'MISSING_FORM'));
  const noFace = structuredClone(def); delete noFace.expressions.concerned;
  assert.ok(validateDefinition(noFace).errors.some(e => e.code === 'MISSING_EXPRESSION'));
  const detached = structuredClone(def); detached.rig.shoulderF = [400, 0];
  assert.ok(validateDefinition(detached).errors.some(e => e.code === 'JOINT_GAP' && /shoulder F/.test(e.message)));
  const shortBoot = structuredClone(def); shortBoot.rig.ankle = 140;
  assert.ok(figureIssues(shortBoot, NEUTRAL_STATE).issues.some(e => e.code === 'JOINT_GAP' && /ankle/.test(e.message)));
});

test('joints stay covered and limb lengths stay fixed in every pose preset, walk phase and expression', async () => {
  const def = await cooper();
  const base = figureMeasures(buildFigure(def, NEUTRAL_STATE));
  const poses = Object.keys(POSE_PRESETS).map(presetPose);
  for (const s of [-1, -0.5, 0.5, 1]) poses.push({...NEUTRAL, legF:[3 + 26 * s, 3 + 28 * Math.max(0, -s)], legB:[-3 - 26 * s, 3 + 28 * Math.max(0, s)], armF:[8 - 18 * s, 14], armB:[-6 + 18 * s, 12], torso:8});
  for (const pose of poses) for (const face of Object.keys(def.expressions)) for (const gaze of [[0, 0], [1, -1], [-1, 1]]) {
    const {figure, issues} = figureIssues(def, {pose, face, blink:0, gaze});
    assert.deepEqual(issues, [], JSON.stringify({pose, face, gaze}));
    for (const [k, v] of Object.entries(figureMeasures(figure))) assert.ok(Math.abs(v - base[k]) < 1e-6, `${k} changed (${v} vs ${base[k]})`);
  }
});

test('expressions switch the painted face, and blinking closes the eyes', async () => {
  const def = await cooper();
  const face = name => JSON.stringify(buildFigure(def, {...NEUTRAL_STATE, face:name}).items.filter(it => ['eyes', 'brows', 'mouth', 'tongue'].includes(it.id)));
  const faces = Object.keys(def.expressions).map(face);
  assert.equal(new Set(faces).size, faces.length, 'every expression paints a different face');
  const open = buildFigure(def, NEUTRAL_STATE).items.find(it => it.id === 'eyes').shapes[0];
  const shut = buildFigure(def, {...NEUTRAL_STATE, blink:1}).items.find(it => it.id === 'eyes').shapes[0];
  assert.ok(open.fill && shut.stroke, 'a full blink draws the eye as a line');
  // Through the storyboard: an expression event changes the sampled face
  const plan = await compileStory(studioStory('cooper'), {words:ticks(6), audio:{durationSec:6}});
  const track = castTracks(plan).get('lead');
  const surprised = plan.shots.find(s => s.id === 'face-surprised');
  assert.equal(track[surprised.startFrame + 2].face, 'surprised');
  assert.notEqual(face(track[surprised.startFrame + 2].face), face(track[0].face));
});

test('the rig test is deterministic, valid, and puts the palm on the barrel', async () => {
  const plan = await compileStory(rigTestStory('cooper'), {words:ticks(5), audio:{durationSec:5}});
  assert.equal(plan.durationFrames, 150);
  const v = validatePlan(plan);
  assert.deepEqual(v.errors, []);
  const checks = rigChecks(plan, 'cooper');
  assert.equal(checks.deterministic, true);
  assert.deepEqual(checks.issues, []);
  for (const [k, drift] of Object.entries(checks.lengthDriftMm)) assert.ok(drift < 1e-3, `${k} drifts ${drift} mm`);
  const track = castTracks(plan).get('cooper');
  const touching = track.filter(s => s.contact);
  assert.ok(touching.length >= 15, `contact held for ${touching.length} frames`);
  assert.ok(touching.every(s => s.contact.prop === 'barrel' && s.contact.shortfallM === 0));
  // Contact begins after the reach (about 3 s + 16 frames), holds to the end of the 4 s beat, then releases to neutral
  assert.ok(touching[0].frame > 90 && touching.at(-1).frame < 130, `contact ${touching[0].frame}-${touching.at(-1).frame}`);
  assert.deepEqual(track.at(-1).pose.armF.map(Math.round), [8, 14]);
  // The gaze eases toward the barrel instead of snapping
  const look = plan.cast[0].actions.find(a => a.type === 'look').startFrame;
  assert.ok(Math.abs(track[look].gaze[0]) < Math.abs(track[look + 8].gaze[0]));
});

test('a touch that cannot reach the prop is reported, not faked', async () => {
  const story = rigTestStory('cooper');
  story.cast[0].start.position = [-1.6, 0.02];
  const plan = await compileStory(story, {words:ticks(5), audio:{durationSec:5}});
  assert.ok(validatePlan(plan).errors.some(e => e.code === 'CHARACTER_NO_CONTACT'));
});

test('palette compensation shows authored colours through tone mapping and grade', async () => {
  const def = await cooper();
  const style = JSON.parse(await readFile(join(repo, 'styles/hold-up.json'), 'utf8'));
  const display = {grade:style.grade, shadowTint:style.palette.shadowTint, highlightTint:style.palette.highlightTint};
  for (const key of ['skin', 'shirt', 'cap', 'hair', 'apron', 'trousers', 'buttons']) {
    const target = hexToRgb(def.palette[key]), {rgb, deltaE} = compensate(target, display);
    assert.ok(deltaE < 1, `${key} ΔE ${deltaE}`);
    assert.ok(displayed(rgb, display).every((v, i) => Math.abs(v - target[i]) < 0.01));
  }
});

test('the vector rig renders in Three.js as one piece, grounded, with the palm on the barrel', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const gpu = process.env.HOLDUP_GPU;
  process.env.HOLDUP_GPU = gpu ?? 'swiftshader';
  try {
    const plan = await compileStory(rigTestStory('cooper'), {words:ticks(5), audio:{durationSec:5}});
    const r = await openRenderer(plan, {quality:'preview'});
    try {
      const frames = [10, 70, 110, 145];
      const metrics = judgeCharacterMetrics(await r.page.evaluate(list => window.characterMetrics(list), frames)).summary.cooper;
      assert.equal(metrics.maxPieces, 1);
      const joints = await r.page.evaluate(list => window.characterJoints(list), frames);
      for (const j of joints) {
        const c = j.characters[0], feet = ['heelF', 'toeF', 'heelB', 'toeB'].map(k => c.joints[k][1]);
        assert.ok(Math.min(...feet) > -0.005 && Math.min(...feet) < 0.01, `feet on the ground at frame ${j.frame}`);
      }
      const touch = joints.find(j => j.frame === 110).characters[0];
      assert.ok(touch.contact && touch.contactPx < 12, `palm ${touch.contactPx?.toFixed(1)} px from the contact point`);
      assert.deepEqual(r.problems, []);
    } finally { await r.close(); }
  } finally { if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu; }
});

test('barrel-bilge stars the approved cooper: feet planted, contact made, heads only cropped by camera-move entrances', async t => {
  const { compileFiles } = await import('../tools/storyboard/compile.mjs');
  // Measured narration timing is generated locally (production/ is not in git)
  const words = join(repo, 'production/barrel-bilge/words.json');
  if (!await readFile(words).then(() => true, () => false)) return t.skip('No production/barrel-bilge/words.json; run the storyboard with --narrate first');
  const plan = await compileFiles(join(repo, 'stories/barrel-bilge/story.json'), words);
  assert.deepEqual(plan.cast.map(m => m.definition.id), ['cooper']);
  assert.equal(plan.cast[0].definition.design.status, 'approved-master');
  const v = validatePlan(plan);
  assert.deepEqual(v.errors, []);
  // Only the two camera-move entrances are cropped (reveal rising from the floor, profile orbiting him into frame)
  const crops = v.warnings.filter(w => w.code === 'CHARACTER_HEAD_CROPPED' || w.code === 'CHARACTER_STRAY_LIMB');
  assert.deepEqual([...new Set(crops.map(w => w.shot))].sort(), ['profile', 'reveal']);
  // ...and only while that shot's camera move is bringing him into frame (any narration take: frames follow the words)
  for (const w of crops) {
    const [from, to] = plan.shots.find(x => x.id === w.shot).camera.window;
    assert.ok(w.frames[0] >= from && w.frames[1] <= to, `${w.code} ${w.shot} f${w.frames.join('-')} outside the camera move f${from}-${to}`);
  }
  const def = plan.cast[0].definition, units = def.heightM / def.rig.heightMm, track = castTracks(plan).get('cooper');
  for (const state of track) {
    const J = buildFigure(def, state).joints, foot = Math.min(J.heelF[1], J.toeF[1], J.heelB[1], J.toeB[1]) * units;
    assert.ok(Math.abs(foot) < 0.0025, `frame ${state.frame}: lowest foot ${foot.toFixed(4)} m`);
  }
  const shoves = track.filter(s => s.contact);
  assert.ok(shoves.length >= 4 && shoves.every(s => s.contact.prop === 'barrel' && s.contact.shortfallM <= 0.03));
});

test('cropped-head and stray-limb checks fire when the framing cuts the character', async () => {
  const plan = await compileStory(rigTestStory('cooper'), {words:ticks(5), audio:{durationSec:5}});
  assert.ok(!validatePlan(plan).warnings.some(w => w.code === 'CHARACTER_HEAD_CROPPED'));
  const tight = rigTestStory('cooper');
  tight.beats[0].shots[0].camera = {move:'hold', framing:'close', azimuth:8, elevation:6, focus:[-0.45, 0.25, 0]};
  const cut = await compileStory(tight, {words:ticks(5), audio:{durationSec:5}});
  assert.ok(validatePlan(cut).warnings.some(w => w.code === 'CHARACTER_HEAD_CROPPED'));
});
