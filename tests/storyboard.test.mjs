import {test} from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { Vector3, PerspectiveCamera, MathUtils } from 'three';
import { resolveAnchor } from '../tools/storyboard/anchors.mjs';
import { EASINGS, ease } from '../tools/storyboard/easing.mjs';
import { framedPose, FRAMING, LENSES } from '../tools/storyboard/camera.mjs';
import { propStateAt, propWorldBox } from '../tools/storyboard/actions.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { samplePlan } from '../tools/storyboard/sample.mjs';
import { renderAnimatic } from '../tools/storyboard/animatic.mjs';
import { findChrome } from '../tools/convert/preview.mjs';
import { Box3 } from 'three';

const run = promisify(execFile);
const FPS = 30;
// Measured-looking timings for a short original line; tests never derive timing from text
const TEXT = 'Look at this crate. It slides across the floor and stops right here.';
const WORDS = TEXT.split(' ').map((text, i) => ({i, text, start:0.2 + i * 0.32 + (i > 3 ? 0.3 : 0), end:0.2 + i * 0.32 + (i > 3 ? 0.3 : 0) + 0.28}));
const WORDS_DOC = {words:WORDS, audio:{durationSec:WORDS.at(-1).end + 0.2, file:'narration.wav', sha256:'0'.repeat(64)}};

// A 1 x 0.6 x 0.8 m crate-shaped shape, with silhouette points at its corners
const BOX = {min:[-0.5, 0, -0.4], max:[0.5, 0.6, 0.4]};
const CORNERS = [BOX.min[0], BOX.max[0]].flatMap(x => [BOX.min[1], BOX.max[1]].flatMap(y => [BOX.min[2], BOX.max[2]].map(z => [x, y, z])));
const shapeOf = async () => ({...BOX, points:CORNERS});

async function catalogDir(entries = ['crate']) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-story-'));
  await mkdir(join(dir, 'assets/library'), {recursive:true});
  const assets = [];
  for (const name of entries) {
    await writeFile(join(dir, `assets/library/${name}.glb`), 'stub');
    assets.push({id:name, name:`Wooden ${name}`, description:'test', tags:[name, 'wood'], style:'realistic', localPath:`assets/library/${name}.glb`,
      sourceUrl:'https://example.org/asset', license:'CC0-1.0', creator:'Test'});
  }
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({version:1, assets}));
  return dir;
}

const baseStory = (overrides = {}) => ({
  version:1, slug:'crate-test', fps:FPS, size:{width:1080, height:1920},
  props:[{id:'crate', asset:{query:'wooden crate', style:'realistic'}, position:[0, 0, 0]}],
  beats:[
    {id:'intro', purpose:'Introduce the crate', shots:[
      {id:'establish', purpose:'Show the crate on its own', subject:'crate', camera:{move:'push-in', framing:'wide', azimuth:20, elevation:10, to:{framing:'medium'}, during:{from:'Look', to:'crate.'}}, focus:['crate.']}
    ]},
    {id:'action', purpose:'Make it move', shots:[
      {id:'slide', start:'It', purpose:'Follow the slide so the motion is felt', subject:'crate', transition:{type:'cut', motivation:'Action begins'},
        camera:{move:'follow', framing:'medium', azimuth:-30, elevation:14, params:{lag:0.15}},
        events:[{at:'slides', prop:'crate', do:'move', until:'floor', params:{to:[1.2, 0, 0]}, ease:'cubic'}]},
      {id:'land', start:'stops', purpose:'Rise to show where it stopped', subject:'crate', transition:{type:'cut', motivation:'Result of the action'},
        camera:{move:'pullback', framing:'close', azimuth:40, elevation:20, to:{framing:'medium', elevation:35}, during:{from:'stops', to:'here.'}, ease:'settle'}}
    ]}
  ],
  ...overrides
});

async function compile(story, dir, words = WORDS_DOC) {
  return compileStory(story, words, {catalogPath:join(dir, 'catalog.json'), rootDir:dir, shapeOf});
}

test('anchors resolve words, occurrences and phrases from measured timing, and reject ambiguity', () => {
  const words = [{text:'And', start:1, end:1.2}, {text:'the', start:1.2, end:1.3}, {text:'bulge', start:1.3, end:1.6}, {text:'and', start:2, end:2.1}, {text:'the', start:2.1, end:2.2}, {text:'spot.', start:2.2, end:2.6}];
  assert.equal(resolveAnchor(words, 'bulge', 30).frame, 39);
  assert.equal(resolveAnchor(words, 'and#2', 30).wordIndex, 3);
  assert.equal(resolveAnchor(words, 'the spot', 30).wordIndex, 4);
  assert.equal(resolveAnchor(words, {at:'the spot', edge:'end'}, 30).time, 2.6);
  assert.equal(resolveAnchor(words, {at:'bulge', offset:-0.1}, 30).frame, 36);
  assert.throws(() => resolveAnchor(words, 'the', 30), /occurs 2 times/);
  assert.throws(() => resolveAnchor(words, 'barrel', 30), /not in the narration/);
  assert.throws(() => resolveAnchor(words, 'and#3', 30), /only 2/);
});

test('easings start at 0, end at 1, and camera eases start from rest', () => {
  for (const [name, fn] of Object.entries(EASINGS)) {
    assert.ok(Math.abs(fn(0)) < 1e-6 && Math.abs(fn(1) - 1) < 1e-3, name);
  }
  assert.ok(Math.max(...Array.from({length:101}, (_, i) => ease('settle', i / 100))) > 1.01, 'settle overshoots');
  for (const name of ['settle', 'dolly', 'cubic', 'sine', 'whip']) assert.ok(ease(name, 0.01) < 0.01, `${name} starts from rest`);
  assert.throws(() => ease('bouncy', 0.5), /Unknown easing/);
});

test('framing solves a distance where the silhouette fills the requested share of the vertical frame', () => {
  const box = new Box3(new Vector3(-0.5, 0, -0.4), new Vector3(0.5, 0.6, 0.4));
  const aspect = 9 / 16;
  for (const framing of ['wide', 'medium', 'close']) {
    const pose = framedPose(box, {framing, azimuth:0, elevation:0, fov:LENSES.normal}, aspect);
    const halfWidth = Math.tan(MathUtils.degToRad(LENSES.normal / 2)) * aspect * (pose.distance - 0.4);
    assert.ok(Math.abs(0.5 / halfWidth - FRAMING[framing]) < 0.01, framing);
  }
  const near = framedPose(box, {framing:'close'}, aspect), far = framedPose(box, {framing:'wide'}, aspect);
  assert.ok(near.distance < far.distance);
});

test('prop actions: move, roll without bobbing, pivot and wobble are deterministic', () => {
  // A cylinder-like silhouette lying on its side rolls on a constant radius
  const ring = Array.from({length:24}, (_, k) => [Math.cos(k / 24 * 2 * Math.PI) * 0.35, 0.45 + Math.sin(k / 24 * 2 * Math.PI) * 0.35, 0]);
  const points = [...ring.map(([x, y]) => [x, y, -0.4]), ...ring.map(([x, y]) => [x, y, 0.4])].map(([x, y, z]) => [x, z + 0.4, y - 0.45]);
  const prop = {bounds:{min:[-0.35, 0, -0.35], max:[0.35, 0.8, 0.35]}, points, base:{position:[0, 0, 0], rotation:[90, 0, 0]},
    actions:[{type:'roll', startFrame:10, endFrame:40, params:{distance:2, direction:[1, 0, 0]}, ease:'cubic'}]};
  const heights = [];
  for (let frame = 0; frame <= 50; frame += 5) heights.push(propWorldBox(prop, frame).min.y);
  assert.ok(heights.every(h => Math.abs(h) < 1e-6), 'stays grounded without bobbing');
  assert.ok(Math.abs(propStateAt(prop, 40).position.x - propStateAt(prop, 0).position.x - 2) < 1e-9);
  assert.deepEqual(propStateAt(prop, 23).position.toArray(), propStateAt(prop, 23).position.toArray());
  const pivot = {bounds:BOX, points:CORNERS, base:{position:[0, 0, 0]}, actions:[{type:'pivot', startFrame:0, endFrame:10, params:{degrees:90}, ease:'cubic'}]};
  const forward = new Vector3(1, 0, 0).applyQuaternion(propStateAt(pivot, 10).quaternion);
  assert.ok(forward.distanceTo(new Vector3(0, 0, -1)) < 1e-6);
});

test('compiles a story into contiguous frame-exact shots anchored to measured words', async () => {
  const dir = await catalogDir();
  try {
    const plan = await compile(baseStory(), dir);
    assert.deepEqual(plan.shots.map(s => s.id), ['establish', 'slide', 'land']);
    assert.equal(plan.shots[0].startFrame, 0);
    const it = WORDS.find(w => w.text === 'It');
    assert.equal(plan.shots[1].startFrame, Math.round((it.start - 0.1) * FPS)); // Cuts lead the word slightly
    plan.shots.slice(1).forEach((shot, i) => assert.equal(shot.startFrame, plan.shots[i].endFrame));
    assert.equal(plan.shots.at(-1).endFrame, plan.durationFrames);
    const move = plan.props[0].actions[0];
    assert.equal(move.type, 'move');
    assert.equal(move.anchor.word, 'slides');
    assert.ok(move.startFrame <= move.anchor.wordFrame && move.anchor.wordFrame - move.startFrame <= 3);
    assert.equal(plan.props[0].asset.license, 'CC0-1.0');
    const validation = validatePlan(plan);
    assert.equal(validation.status, 'pass', JSON.stringify(validation.errors));
    assert.deepEqual(validation.stats.behaviors, {'push-in':1, follow:1, pullback:1});
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('missing assets are flagged and never replaced with stand-in geometry', async () => {
  const dir = await catalogDir();
  try {
    const story = baseStory();
    story.props.push({id:'lantern', asset:{query:'brass lantern', style:'realistic'}, position:[1, 0, -1], sizeHint:[0.2, 0.4, 0.2]});
    const plan = await compile(story, dir);
    const lantern = plan.props.find(p => p.id === 'lantern');
    assert.equal(lantern.missing, true);
    assert.equal(lantern.asset, null);
    assert.equal(lantern.bounds, null);
    assert.deepEqual(plan.missingAssets, [{prop:'lantern', query:'brass lantern', style:'realistic'}]);
    const validation = validatePlan(plan);
    assert.equal(validation.status, 'needs-revision');
    assert.ok(validation.errors.some(e => e.code === 'MISSING_ASSET' && e.prop === 'lantern'));
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('authoring errors fail compilation with a clear reason', async () => {
  const dir = await catalogDir();
  try {
    const mutate = fn => { const story = structuredClone(baseStory()); fn(story); return compile(story, dir); };
    await assert.rejects(mutate(s => { s.beats[0].shots[0].camera.move = 'dolly-zoom'; }), /unknown camera move/);
    await assert.rejects(mutate(s => { s.beats[0].shots[0].subject = 'ghost'; }), /unknown subject/);
    await assert.rejects(mutate(s => { s.beats[1].shots[0].start = 'barrel'; }), /not in the narration/);
    await assert.rejects(mutate(s => { s.beats[1].shots[1].start = 'It'; }), /no duration/);
    await assert.rejects(mutate(s => { s.beats[1].shots[0].camera.ease = 'bouncy'; }), /unknown easing/);
    await assert.rejects(mutate(s => { s.beats[1].shots[0].events[0].until = undefined; }), /needs "until" or "duration"/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('validation catches weak direction: unmotivated cuts, missing purpose, drift, zoom chains, static holds and jolts', async () => {
  const dir = await catalogDir();
  try {
    const codes = async fn => {
      const story = structuredClone(baseStory()); fn(story);
      const v = validatePlan(await compile(story, dir));
      return [...v.errors, ...v.warnings].map(i => i.code);
    };
    assert.ok((await codes(s => { s.beats[1].shots[0].transition.motivation = null; })).includes('UNMOTIVATED_CUT'));
    assert.ok((await codes(s => { s.beats[1].shots[1].purpose = ' '; })).includes('NO_PURPOSE'));
    assert.ok((await codes(s => { Object.assign(s.beats[1].shots[1].camera, {ease:'linear', during:undefined}); })).includes('MECHANICAL_DRIFT'));
    assert.ok((await codes(s => {
      s.beats[1].shots[0].camera = {move:'push-in', framing:'wide', azimuth:-30, to:{framing:'medium'}};
      s.beats[1].shots[1].camera = {move:'push-in', framing:'medium', azimuth:40, elevation:20, to:{framing:'close'}};
    })).includes('PERPETUAL_ZOOM'));
    assert.ok((await codes(s => { s.beats[1].shots[1].camera = {move:'hold', framing:'medium', azimuth:40, elevation:20}; s.beats[1].shots[1].start = 'floor'; })).includes('STATIC_SHOT'));
    assert.ok((await codes(s => { s.beats[1].shots[1].camera.ease = 'out'; })).includes('CAMERA_JERK'));
    assert.ok((await codes(s => { s.beats[1].shots[0].camera.move = 'push-in'; s.beats[1].shots[0].camera.to = {framing:'wide'}; })).includes('MOVE_DIRECTION'));
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('validation catches collisions, fog, tiny subjects, pops, off-frame focus words and late actions', async () => {
  const dir = await catalogDir(['crate', 'wall']);
  try {
    const result = async fn => {
      const story = structuredClone(baseStory()); fn(story);
      const v = validatePlan(await compile(story, dir));
      return [...v.errors, ...v.warnings].map(i => i.code);
    };
    // A second prop placed where the establishing camera stands
    const plan = await compile(baseStory(), dir);
    const cam = samplePlan(plan, 5).camera.position;
    assert.ok((await result(s => { s.props.push({id:'wall', asset:{query:'wooden wall'}, position:[cam.x, cam.y - 0.3, cam.z], grounded:false}); })).includes('CAMERA_COLLISION'));
    assert.ok((await result(s => { s.stage = {fog:{near:1, far:3}}; s.beats[1].shots[1].camera.to.framing = 'wide'; })).includes('SUBJECT_IN_FOG'));
    // Framing re-solves for the real subject size, so only a too-loose preset can shrink it; simulate one
    const wide = FRAMING.wide;
    FRAMING.wide = 0.05;
    try { assert.ok((await result(s => { s.stage = {}; })).includes('SUBJECT_TOO_SMALL')); } finally { FRAMING.wide = wide; }
    assert.ok((await result(s => { s.beats[1].shots[0].events.push({at:'across', prop:'crate', do:'set', params:{position:[0, 0, 2]}}); })).includes('CONTINUITY_POP'));
    // A parallel track that slides 3 m sideways leaves the subject behind exactly when its word lands
    assert.ok((await result(s => { s.beats[0].shots[0].camera = {move:'track', framing:'medium', azimuth:20, elevation:10, params:{distance:6}, during:{from:'Look', to:'crate.'}}; })).includes('FOCUS_NOT_FRAMED'));
    assert.ok((await result(s => { s.beats[1].shots[0].events[0].at = {at:'slides', offset:0.3}; })).includes('SYNC_LATE'));
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('whip transitions start looking where the previous shot ended and blur only during the whip', async () => {
  const dir = await catalogDir(['crate', 'wall']);
  try {
    const story = baseStory();
    // Whip from a different subject so the look direction really has to swing
    story.props.push({id:'wall', asset:{query:'wooden wall'}, position:[-2.5, 0, -1.5]});
    story.beats[0].shots[0].subject = 'wall';
    story.beats[1].shots[0].transition = {type:'whip'};
    const plan = await compile(story, dir);
    const slide = plan.shots[1];
    const before = samplePlan(plan, slide.startFrame - 1).camera;
    const first = samplePlan(plan, slide.startFrame).camera;
    const after = samplePlan(plan, slide.startFrame + 10).camera;
    assert.equal(first.whip, true);
    assert.equal(after.whip, false);
    const look = c => c.target.clone().sub(c.position).normalize();
    assert.ok(look(first).angleTo(look(before)) < look(after).angleTo(look(before)), 'first whip frame points back toward the previous subject direction');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('animatic renders a vertical MP4 and storyboard sheet in headless Chrome with real Three.js', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const dir = await catalogDir([]);
  try {
    // A real GLB so the browser actually loads geometry through GLTFLoader
    const document = new Document();
    const buffer = document.createBuffer();
    const positions = new Float32Array(CORNERS.flat());
    const indices = new Uint16Array([0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6]);
    const prim = document.createPrimitive().setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer)).setMaterial(document.createMaterial('wood').setBaseColorFactor([0.6, 0.4, 0.2, 1]));
    document.createScene().addChild(document.createNode('crate').setMesh(document.createMesh().addPrimitive(prim)));
    await writeFile(join(dir, 'assets/library/crate.glb'), await new NodeIO().writeBinary(document));
    await writeFile(join(dir, 'catalog.json'), JSON.stringify({version:1, assets:[{id:'crate', name:'Wooden crate', description:'test', tags:['crate'], style:'realistic',
      localPath:'assets/library/crate.glb', sourceUrl:'https://example.org/crate', license:'CC0-1.0', creator:'Test'}]}));
    const story = baseStory();
    story.props.push({id:'lantern', asset:{query:'brass lantern'}, position:[0.8, 0, -0.5]});
    const plan = await compileStory(story, WORDS_DOC, {catalogPath:join(dir, 'catalog.json'), rootDir:dir});
    plan.props.forEach(prop => { if (prop.asset) prop.asset.localPath = join(dir, prop.asset.localPath); });
    const result = await renderAnimatic(plan, {outDir:dir, scale:0.1});
    assert.deepEqual(result.size, {width:108, height:192});
    assert.equal(result.loadedProps, 1);
    assert.deepEqual(result.missingProps, ['lantern']);
    const {stdout} = await run('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'csv=p=0', result.video]);
    assert.equal(stdout.trim(), `108,192,${plan.durationFrames}`);
    assert.ok((await stat(result.sheet)).size > 1000);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('cut continuity: abrupt scale jumps and dead starts are flagged, matched or declared-contrast cuts are not', async () => {
  const dir = await catalogDir();
  try {
    const check = async fn => {
      const story = structuredClone(baseStory()); fn(story);
      const v = validatePlan(await compile(story, dir));
      return {codes:[...v.errors, ...v.warnings].map(i => i.code), slide:[...v.errors, ...v.warnings].filter(i => i.shot === 'slide').map(i => i.code), cuts:v.cuts};
    };
    // Baseline cuts in the fixture keep size and position steady
    const base = await check(() => {});
    assert.ok(!base.codes.some(code => code.startsWith('CUT_')), base.codes.join());
    assert.ok(base.cuts.every(cut => cut.scaleRatio < 2));
    // Ending the first shot extremely close and cutting to a wide follow is a scale jump
    const jump = s => {
      s.beats[0].shots[0].camera = {move:'push-in', framing:'medium', azimuth:20, elevation:10, to:{framing:'detail'}, during:{from:'Look', to:'crate.'}};
      s.beats[1].shots[0].camera = {move:'follow', framing:'wide', azimuth:-60, elevation:30, params:{lag:0.15}};
    };
    const abrupt = await check(jump);
    assert.ok(abrupt.slide.includes('CUT_SCALE_JUMP'), abrupt.slide.join());
    // The same cut declared as a deliberate contrast cut is allowed
    const contrast = await check(s => { jump(s); s.beats[1].shots[0].transition.intent = 'contrast'; });
    assert.ok(!contrast.slide.some(code => code.startsWith('CUT_SCALE') || code === 'CUT_DISORIENTING' || code === 'CUT_POSITION_JUMP'), contrast.slide.join());
    assert.equal(contrast.cuts[0].intent, 'contrast');
    // A follow shot whose action begins long after the cut leaves dead frames
    const dead = await check(s => { s.beats[1].shots[0].events[0].at = 'across'; });
    assert.ok(dead.slide.includes('CUT_DEAD_START'));
    // Starting the action on the cut itself is supported directly
    const story = structuredClone(baseStory());
    story.beats[1].shots[0].events[0].at = 'shot-start';
    const plan = await compile(story, dir);
    assert.equal(plan.props[0].actions[0].startFrame, plan.shots[1].startFrame);
    await assert.rejects(compile(Object.assign(structuredClone(baseStory()), {beats:[baseStory().beats[0], {...baseStory().beats[1], shots:[{...baseStory().beats[1].shots[0], transition:{type:'cut', motivation:'x', intent:'smash'}}]}]}), dir), /intent must be/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('silhouette sampling grounds a rolling round mesh within a millimetre', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-shape-'));
  try {
    // A 64-sided barrel-like solid: radius bulges from 0.3 at the ends to 0.37 at the middle
    const document = new Document();
    const buffer = document.createBuffer();
    const rings = 9, sides = 64, positions = [], indices = [];
    for (let r = 0; r < rings; r++) {
      const y = r / (rings - 1) * 0.9, radius = 0.3 + 0.07 * Math.sin(Math.PI * r / (rings - 1));
      for (let k = 0; k < sides; k++) positions.push(Math.cos(k / sides * 2 * Math.PI) * radius, y, Math.sin(k / sides * 2 * Math.PI) * radius);
    }
    for (let r = 0; r < rings - 1; r++) for (let k = 0; k < sides; k++) {
      const a = r * sides + k, b = r * sides + (k + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
    const prim = document.createPrimitive()
      .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
      .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer));
    document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(prim)));
    const path = join(dir, 'barrel.glb');
    await writeFile(path, await new NodeIO().writeBinary(document));
    const {readGlbShape} = await import('../tools/storyboard/compile.mjs');
    const shape = await readGlbShape(path);
    const prop = {...shape, bounds:{min:shape.min, max:shape.max}, base:{position:[0, 0, 0], rotation:[90, 0, 0]},
      actions:[{type:'roll', startFrame:0, endFrame:100, params:{distance:2.3, direction:[1, 0, 0]}, ease:'linear'}]};
    const all = [];
    for (let i = 0; i < positions.length; i += 3) all.push(new Vector3(positions[i], positions[i + 1], positions[i + 2]));
    let worst = 0;
    for (let frame = 0; frame <= 100; frame += 2) {
      const state = propStateAt(prop, frame);
      const trueMin = Math.min(...all.map(p => p.clone().applyQuaternion(state.quaternion).add(state.position).y));
      worst = Math.max(worst, Math.abs(trueMin));
    }
    assert.ok(worst < 0.001, `mesh leaves or sinks into the floor by ${(worst * 1000).toFixed(2)} mm`);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('cutting from frame-left to frame-right is a position jump; keeping the subject on the same side is not', async () => {
  const dir = await catalogDir();
  try {
    const twoHolds = (fa, fb) => ({...baseStory(), beats:[{id:'a', purpose:'p', shots:[
      {id:'one', purpose:'Subject on one side', subject:'crate', camera:{move:'hold', framing:'close', azimuth:0, elevation:5, focus:[fa, 0, 0]}},
      {id:'two', start:'It', purpose:'Cut in', subject:'crate', transition:{type:'cut', motivation:'Detail'}, camera:{move:'hold', framing:'close', azimuth:30, elevation:5, focus:[fb, 0, 0]}}]}]});
    const flipped = validatePlan(await compile(twoHolds(-0.45, 0.45), dir));
    assert.ok(flipped.warnings.some(w => w.code === 'CUT_POSITION_JUMP' && w.shot === 'two'));
    const sameSide = validatePlan(await compile(twoHolds(-0.45, -0.45), dir));
    assert.ok(!sameSide.warnings.some(w => w.code === 'CUT_POSITION_JUMP'));
    assert.ok(sameSide.cuts[0].shiftNdc < flipped.cuts[0].shiftNdc / 2);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('track direction "left" slides the subject the opposite way on screen to "right"', async () => {
  const dir = await catalogDir();
  try {
    const screenX = async direction => {
      const story = baseStory();
      story.beats[0].shots[0].camera = {move:'track', framing:'medium', azimuth:0, elevation:5, params:{distance:0.6, direction}, during:{from:'Look', to:'crate.'}};
      const plan = await compile(story, dir);
      const [a, b] = plan.shots[0].camera.window;
      const x = frame => { const c = samplePlan(plan, frame).camera; const cam = new PerspectiveCamera(c.fov, 9 / 16, 0.02, 100); cam.position.copy(c.position); cam.lookAt(c.target); cam.updateMatrixWorld(); return new Vector3(0, 0.3, 0).project(cam).x; };
      return x(b) - x(a);
    };
    const right = await screenX('right'), left = await screenX('left');
    assert.ok(right < -0.05 && left > 0.05, `right ${right}, left ${left}`);
    const story = baseStory();
    story.beats[0].shots[0].camera = {move:'track', framing:'medium', params:{distance:0.5, direction:'up'}};
    assert.ok(validatePlan(await compile(story, dir)).errors.some(e => e.code === 'MOVE_DIRECTION'));
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('whip-in transitions pan (never tilt) 45-90 degrees and are fastest on the cut', async () => {
  const {whipStartDirection} = await import('../tools/storyboard/camera.mjs');
  const to = new Vector3(0, -0.1, -1).normalize();
  for (const from of [new Vector3(1, -0.6, 0).normalize(), new Vector3(-0.2, 0.3, -1).normalize(), to.clone()]) {
    const start = whipStartDirection(from, to);
    assert.ok(Math.abs(start.y - to.y) < 1e-9, 'yaw only: pitch is unchanged');
    const flat = v => new Vector3(v.x, 0, v.z).normalize();
    const degrees = MathUtils.radToDeg(flat(start).angleTo(flat(to))); // Heading change, measured in the ground plane
    assert.ok(degrees >= 44.9 && degrees <= 90.1, `swing ${degrees}`);
  }
  const dir = await catalogDir(['crate', 'wall']);
  try {
    const story = baseStory();
    story.props.push({id:'wall', asset:{query:'wooden wall'}, position:[-2.5, 0, -1.5]});
    story.beats[0].shots[0].subject = 'wall';
    story.beats[1].shots[0].transition = {type:'whip'};
    const plan = await compile(story, dir);
    const start = plan.shots[1].startFrame;
    const look = frame => { const c = samplePlan(plan, frame).camera; return c.target.clone().sub(c.position).normalize(); };
    const steps = Array.from({length:7}, (_, k) => MathUtils.radToDeg(look(start + k).angleTo(look(start + k + 1))));
    assert.ok(steps.every((step, k) => k === 0 || step <= steps[k - 1] + 1e-6), `decelerating: ${steps.map(s => s.toFixed(1))}`);
    assert.ok(steps[0] > 10, 'already moving fast on the first frame after the cut');
  } finally { await rm(dir, {recursive:true, force:true}); }
});
