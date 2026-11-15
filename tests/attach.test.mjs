import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { Vector3 } from 'three';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { socketFrame } from '../tools/storyboard/sockets.mjs';
import { frameQuaternion } from '../tools/convert/derive-model.mjs';

// Fixture models with real socket nodes: a 1 m "body" box with a "port" socket on its +x face (axis into the box), a
// thin "rod" (a spout) with a "tip" socket at its end and a "tail" socket, and a "post" with a hose "outlet"
async function model(path, boxes, sockets) {
  const doc = new Document(), buffer = doc.createBuffer(), scene = doc.createScene();
  for (const [name, [x0, y0, z0], [x1, y1, z1]] of boxes) {
    const c = [[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]];
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(c.flat())).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 2, 3, 0, 3, 1, 4, 5, 7, 4, 7, 6, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3])).setBuffer(buffer))
      .setMaterial(doc.createMaterial(name));
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim)));
  }
  for (const [name, position, axis, up] of sockets) scene.addChild(doc.createNode(`socket/${name}`).setTranslation(position).setRotation(frameQuaternion(axis, up)));
  await writeFile(path, await new NodeIO().writeBinary(doc));
}

async function world() {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-attach-'));
  await mkdir(join(dir, 'assets/library'), {recursive:true});
  await model(join(dir, 'assets/library/body.glb'), [['body', [-0.5, 0, -0.5], [0.5, 1, 0.5]]], [['port', [0.5, 0.6, 0], [-1, -0.3, 0], [0, 1, 0]]]);
  await model(join(dir, 'assets/library/rod.glb'), [['rod', [-0.3, -0.01, -0.01], [0, 0.01, 0.01]]], [['tip', [-0.3, 0, 0], [-1, 0, 0], [0, 1, 0]], ['tipflipped', [-0.3, 0, 0], [-1, 0, 0], [0, -1, 0]], ['tail', [0, 0, 0], [1, 0, 0], [0, 1, 0]]]);
  await model(join(dir, 'assets/library/post.glb'), [['post', [-0.1, 0, -0.1], [0.1, 2, 0.1]]], [['outlet', [0, 2, 0], [0, -1, 0], [1, 0, 0]]]);
  const entry = id => ({id, name:id, description:'fixture', tags:[id], style:'stylized', localPath:`assets/library/${id}.glb`, sourceUrl:'https://example.org/x', license:'CC0-1.0', creator:'Test'});
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({version:1, assets:['body', 'rod', 'post'].map(entry)}));
  return dir;
}
const WORDS = {words:'one two three'.split(' ').map((text, i) => ({i, text, start:0.5 + i * 0.6, end:0.9 + i * 0.6})), audio:{durationSec:2.2}};
const story = (rod = {}, extra = {}) => ({version:1, slug:'attach-test', fps:30, captions:false, narration:{script:'one two three'},
  props:[{id:'body', asset:{query:'body'}, position:[0, 0, 0], holes:[{socket:'port', size:[0.12, 0.12], from:-0.02, to:0.2}]},
    {id:'rod', asset:{query:'rod'}, attach:{to:'body', socket:'port', via:'tip', depth:0.06, clearOf:['body']}, ...rod},
    {id:'post', asset:{query:'post'}, position:[2, 0, 0]}],
  effects:[{id:'hose', type:'hose', params:{from:{prop:'post', socket:'outlet'}, to:{prop:'rod', socket:'tail'}, radius:0.01, clearOf:['body']}}],
  beats:[{id:'b', purpose:'test', shots:[{id:'s', purpose:'test', subject:'body', camera:{move:'hold', framing:'wide', azimuth:30, elevation:10}}]}], ...extra});
const codes = plan => validatePlan(plan).errors.map(e => e.code);

test('attachment: the prop is placed from its sockets (tip on the port, pushed along the axis), and every contact check passes', async () => {
  const dir = await world();
  try {
    const plan = await compileStory(story(), WORDS, {catalogPath:join(dir, 'catalog.json'), rootDir:dir});
    const P = Object.fromEntries(plan.props.map(p => [p.id, p]));
    const port = socketFrame(P.body, 'port'), tip = socketFrame(P.rod, 'tip');
    const expected = new Vector3(...port.position).addScaledVector(new Vector3(...port.axis), 0.06);
    assert.ok(new Vector3(...tip.position).distanceTo(expected) < 1e-4, 'the tip sits 6 cm into the port, along its axis');
    assert.ok(new Vector3(...tip.axis).angleTo(new Vector3(...port.axis)) < 1e-3, 'the rod is aligned with the port axis');
    const [attach, hose] = plan.contacts;
    assert.equal(attach.pass, true, JSON.stringify(attach)); assert.equal(attach.intersections[0].count, 0);
    assert.equal(hose.pass, true, JSON.stringify(hose)); assert.deepEqual(hose.endGapsM, [0, 0]);
    assert.ok(!codes(plan).some(c => /ATTACH|HOSE/.test(c)), codes(plan).join());
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('attachment checks catch wrong depth, a body cut outside the opening, an upside-down part and a hose through the body', async () => {
  const dir = await world();
  const compile = s => compileStory(s, WORDS, {catalogPath:join(dir, 'catalog.json'), rootDir:dir});
  try {
    assert.ok(codes(await compile(story({attach:{to:'body', socket:'port', via:'tip', depth:0.25, clearOf:['body']}}))).includes('ATTACH_DEPTH'));
    // Without the opening (no hole in the body), the inserted rod cuts the body panel
    const noHole = story(); delete noHole.props[0].holes;
    const plan = await compile(noHole);
    assert.ok(codes(plan).includes('ATTACH_INTERSECTS'), codes(plan).join());
    assert.ok(codes(await compile(story({attach:{to:'body', socket:'port', via:'tipflipped', depth:0.06, clearOf:['body']}}))).includes('ATTACH_ORIENTATION'));
    // A hose routed from the far side of the body has to pass through it
    const through = story(); through.props[2].position = [-2, 0, 0]; through.effects[0].params.slack = 0;
    assert.ok(codes(await compile(through)).includes('HOSE_CLIPS'));
    // Sockets are required, never guessed
    const bad = story({attach:{to:'body', socket:'nope', via:'tip'}});
    await assert.rejects(compile(bad), /no socket "nope"/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
