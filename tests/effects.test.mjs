import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { samplePlan } from '../tools/storyboard/sample.mjs';
import { propStateAt } from '../tools/storyboard/actions.mjs';
import { effectStateAt } from '../tools/storyboard/effects.mjs';

import { partsModel, effectsStory, WORDS } from './fixtures/effects-fixture.mjs';

async function compileFixture(story = effectsStory()) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-effects-'));
  await partsModel(dir);
  try { return await compileStory(story, WORDS, {catalogPath:join(dir, 'catalog.json'), rootDir:dir}); }
  finally { await rm(dir, {recursive:true, force:true}); }
}

test('part actions move named GLB nodes from rest, and unknown parts are rejected', async () => {
  const plan = await compileFixture(), nozzle = plan.props[0];
  assert.deepEqual(nozzle.nodes, ['nozzle', 'body', 'lever']);
  const action = nozzle.actions.find(a => a.type === 'part'), mid = Math.round((action.startFrame + action.endFrame) / 2);
  assert.deepEqual(propStateAt(nozzle, action.startFrame - 1).parts, {});
  const half = propStateAt(nozzle, mid).parts.lever.rotation[2];
  assert.ok(half < -4 && half > -8, `half-way rotation ${half}`);
  assert.deepEqual(propStateAt(nozzle, action.endFrame + 5).parts.lever.rotation, [0, 0, -12]);
  const bad = effectsStory(); bad.beats[0].shots[0].events[1].params.part = 'trigger';
  await assert.rejects(compileFixture(bad), /has no part "trigger"/);
});

test('material state: x-ray eases, kept parts and the section switch on at the action start', async () => {
  const plan = await compileFixture(), nozzle = plan.props[0], action = nozzle.actions.find(a => a.type === 'material');
  assert.equal(propStateAt(nozzle, action.startFrame - 1).material.xray, 0);
  const m = propStateAt(nozzle, action.endFrame);
  assert.equal(m.material.xray, 1); assert.deepEqual(m.material.keep, ['lever']); assert.deepEqual(m.material.section, {normal:[0, 0, -1], constant:0});
  const bad = effectsStory(); bad.beats[0].shots[1].events[2].params.xray = 2;
  await assert.rejects(compileFixture(bad), /between 0 and 1/);
});

test('effects: channels ease along word-anchored keys; the rewind replays the forward states in reverse', async () => {
  const plan = await compileFixture(), spill = plan.effects.find(e => e.id === 'spill');
  const [grow, rewind] = spill.keys;
  assert.equal(effectStateAt(spill, grow.startFrame).progress, 0);
  assert.equal(effectStateAt(spill, grow.endFrame).progress, 1);
  assert.equal(effectStateAt(spill, rewind.endFrame).progress, 0);
  // Every rewind value is a value the forward growth passed through, in decreasing order
  let last = 1;
  for (let f = rewind.startFrame; f <= rewind.endFrame; f++) { const v = effectStateAt(spill, f).progress; assert.ok(v <= last + 1e-9 && v >= 0); last = v; }
  const bad = effectsStory(); bad.beats[0].shots[0].events[0].set = {volume:1};
  await assert.rejects(compileFixture(bad), /has no channel "volume"/);
  const unknown = effectsStory(); unknown.effects[0].type = 'lava';
  await assert.rejects(compileFixture(unknown), /unknown type "lava"/);
});

test('freeze holds the whole scene for its frames while time runs on; shake jolts the camera briefly', async () => {
  const plan = await compileFixture();
  const [freeze] = plan.freezes, [shake] = plan.shakes;
  assert.equal(freeze.frames, 3); assert.equal(freeze.startFrame, plan.shots[1].startFrame);
  const held = samplePlan(plan, freeze.startFrame + 2), first = samplePlan(plan, freeze.startFrame);
  assert.equal(held.sceneFrame, freeze.startFrame); assert.equal(held.time, (freeze.startFrame + 2) / 30);
  assert.deepEqual(held.effects, first.effects);
  assert.equal(samplePlan(plan, freeze.startFrame + 3).sceneFrame, freeze.startFrame + 3);
  const before = samplePlan(plan, shake.startFrame - 1).camera.position, during = samplePlan(plan, shake.startFrame + 1).camera.position, after = samplePlan(plan, shake.startFrame + 3).camera.position;
  assert.ok(during.distanceTo(before) > 0.001, 'the camera jolts'); assert.ok(after.distanceTo(before) < 1e-9, 'and settles back');
  const bad = effectsStory(); bad.beats[0].shots[1].camera.shake.amplitude = 0.5;
  await assert.rejects(compileFixture(bad), /amplitude/);
});

test('render: effects, part motion, x-ray and freeze are visible in real Three.js frames (headless Chrome)', async t => {
  const { findChrome } = await import('../tools/convert/preview.mjs');
  const { openRenderer } = await import('../tools/storyboard/animatic.mjs');
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-effects-render-'));
  try {
    await partsModel(dir);
    const plan = await compileStory(effectsStory(), WORDS, {catalogPath:join(dir, 'catalog.json'), rootDir:dir});
    plan.props.forEach(prop => { if (prop.asset) prop.asset.localPath = join(dir, prop.asset.localPath); });
    const r = await openRenderer(plan, {quality:'animatic', scale:0.25});
    try {
      // Per frame: PNG data (exact comparisons), amber fuel pixels, red body pixels
      const measure = frames => r.page.evaluate(async list => {
        const urls = window.renderFrames(list, 'image/png', false), out = [];
        for (const url of urls) {
          const img = new Image(); img.src = url; await img.decode();
          const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
          const g = c.getContext('2d'); g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          let amber = 0, red = 0;
          for (let i = 0; i < d.length; i += 4) {
            const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
            if (R > 170 && G > 90 && G < 210 && B < 120 && R - B > 90) amber++;
            if (R > 120 && G < 70 && B < 70) red++;
          }
          out.push({url, amber, red});
        }
        return out;
      }, frames);
      const spill = plan.effects.find(e => e.id === 'spill'), [grow, rewind] = spill.keys;
      const freeze = plan.freezes[0], xray = plan.props[0].actions.find(a => a.type === 'material'), lever = plan.props[0].actions.find(a => a.type === 'part');
      const [before, grown, rewound] = await measure([grow.startFrame - 1, grow.endFrame + 2, rewind.endFrame + 2]);
      assert.ok(grown.amber > before.amber + 200, `the overflow appears (${before.amber} -> ${grown.amber} amber px)`);
      assert.ok(rewound.amber < grown.amber / 4, `the rewind takes it back (${rewound.amber} amber px)`);
      const [restLever, movedLever] = await measure([lever.startFrame - 1, lever.endFrame + 1]);
      assert.notEqual(restLever.url, movedLever.url, 'the named part moves');
      const held = await measure([freeze.startFrame, freeze.startFrame + 1, freeze.startFrame + 2]);
      assert.ok(held.every(h => h.url === held[0].url), 'freeze frames are identical');
      const [solid, ghosted] = await measure([xray.startFrame - 1, xray.endFrame + 1]);
      assert.ok(ghosted.red < solid.red / 3, `x-ray ghosts the solid red body (${solid.red} -> ${ghosted.red} red px)`);
      assert.deepEqual(r.problems, []);
    } finally { await r.close(); }
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('render rig: parts are found by their glTF names even though GLTFLoader strips "/" from node names', async () => {
  const { Document, NodeIO } = await import('@gltf-transform/core');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { partRig, partNamed } = await import('../tools/render/effects.mjs');
  const doc = new Document(); doc.createBuffer();
  doc.createScene().addChild(doc.createNode('nozzle/body').addChild(doc.createNode('nozzle/lever').setTranslation([0.1, 0, 0])));
  const glb = await new NodeIO().writeBinary(doc);
  const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '', ok, fail));
  const lever = partNamed(gltf.scene, 'nozzle/lever');
  assert.ok(lever, 'found by the original name'); assert.equal(lever.name, 'nozzlelever', 'three.js sanitized the node name');
  partRig(gltf.scene)({'nozzle/lever':{position:[0, -0.01, 0], rotation:[0, 0, 0], scale:0.5, morph:{}}});
  assert.deepEqual(lever.position.toArray().map(v => +v.toFixed(6)), [0.1, -0.01, 0]); assert.equal(lever.scale.x, 0.5);
});

test('overlapping actions on different parts of one prop are allowed; on the same part they are an error', async () => {
  const { validatePlan } = await import('../tools/storyboard/validate.mjs');
  const parallel = effectsStory(), lever = parallel.beats[0].shots[0].events[1];
  parallel.beats[0].shots[0].events.push({...lever, params:{part:'body', position:[0, 0.01, 0]}});
  assert.ok(!validatePlan(await compileFixture(parallel)).errors.some(e => e.code === 'ACTION_OVERLAP'));
  const clash = effectsStory();
  clash.beats[0].shots[0].events.push({...lever, params:{part:'lever', rotation:[0, 0, 5]}});
  assert.ok(validatePlan(await compileFixture(clash)).errors.some(e => e.code === 'ACTION_OVERLAP'));
});
