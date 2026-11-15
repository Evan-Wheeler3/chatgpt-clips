import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Document, NodeIO } from '@gltf-transform/core';
import { getBounds } from '@gltf-transform/functions';
import { deriveModel } from '../tools/convert/derive-model.mjs';
import { createDerivedProvider } from '../tools/providers/derived.mjs';

const run = promisify(execFile);
// Two textured quads (separate UV islands): the left half of the texture is red with a small white "logo", the right half blue
async function texturedModel(dir) {
  const png = join(dir, 'tex.png');
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-f', 'lavfi', '-i', 'color=c=blue:s=32x64', '-f', 'lavfi', '-i', 'color=c=white:s=6x6',
    '-filter_complex', '[0][1]overlay=32:0[a];[a][2]overlay=10:28', '-frames:v', '1', png]);
  const doc = new Document(), buffer = doc.createBuffer(), image = await readFile(png);
  const texture = doc.createTexture('atlas').setImage(image).setMimeType('image/png');
  const quad = (name, x, u0, u1, extra = {}) => {
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([x, 0, 0, x + 1, 0, 0, x + 1, 1, 0, x, 1, 0])).setBuffer(buffer))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array([u0, 1, u1, 1, u1, 0, u0, 0])).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint16Array([0, 1, 2, 0, 2, 3])).setBuffer(buffer))
      .setMaterial(doc.createMaterial(extra.material ?? 'atlas').setBaseColorTexture(texture).setMetallicFactor(1).setEmissiveTexture(extra.emissive ? texture : null));
    return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(prim));
  };
  const group = doc.createNode('Sign Group');
  group.addChild(quad('left', 0, 0, 0.5)); group.addChild(quad('right', 1.2, 0.5, 1));
  const car = doc.createNode('Car Body'); car.addChild(quad('Wheel', 3, 0, 0.1, {material:'sign', emissive:true}));
  doc.createScene().addChild(group).addChild(car).addChild(quad('Wheel', 20, 0, 0.1));
  const file = join(dir, 'src.glb');
  await writeFile(file, await new NodeIO().writeBinary(doc));
  return file;
}

test('derive: flatten removes baked detail (one palette colour per UV island); keep/inside, rename, recolor and fit behave', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-derive-'));
  try {
    const src = await texturedModel(dir);
    const read = async bytes => new NodeIO().readBinary(bytes);
    // Flatten with a palette: the red island (with its white "logo") becomes pure palette red, the blue island palette blue
    const flat = await read((await deriveModel(src, [{keep:['Sign Group']}, {flatten:{palette:['#CC2222', '#2244CC', '#EEEEEE']}}])).bytes);
    const colours = Object.fromEntries(flat.getRoot().listNodes().filter(n => n.getMesh()).map(n => [n.getName(), [...n.getMesh().listPrimitives()[0].getAttribute('COLOR_0').getElement(0, [])].slice(0, 3)]));
    assert.deepEqual(Object.keys(colours).sort(), ['left', 'right']);
    assert.ok(colours.left[0] > 0.5 && colours.left[2] < 0.1, `left is red, not white: ${colours.left}`);
    assert.ok(colours.right[2] > 0.5 && colours.right[0] < 0.1, `right is blue: ${colours.right}`);
    assert.equal(flat.getRoot().listTextures().length, 0, 'no textures remain');
    // keep {inside}: only the Wheel within the car body survives; rename; recolor clears emissive and metal; fit/ground/center
    const out = await deriveModel(src, [{keep:['Car Body', {name:'Wheel', inside:'Car Body', margin:0.5}]}, {rename:{'Car Body':'car'}}, {recolor:{sign:'#336699'}}, {fit:{axis:'x', length:2}, ground:true, center:true}]);
    const car = await read(out.bytes), scene = car.getRoot().listScenes()[0], b = getBounds(scene);
    assert.deepEqual(car.getRoot().listNodes().map(n => n.getName()).filter(n => n !== 'holdup-adapt').sort(), ['Wheel', 'car']);
    assert.ok(Math.abs((b.max[0] - b.min[0]) - 2) < 1e-6 && Math.abs(b.min[1]) < 1e-6 && Math.abs(b.min[0] + b.max[0]) < 1e-6, JSON.stringify(b));
    const m = car.getRoot().listMaterials()[0];
    assert.equal(m.getEmissiveTexture(), null); assert.deepEqual(m.getEmissiveFactor(), [0, 0, 0]); assert.equal(m.getMetallicFactor(), 0);
    assert.match(out.log.join('; '), /kept Car Body, Wheel; renamed parts; recoloured sign; scaled/);
    await assert.rejects(deriveModel(src, [{keep:['Nope']}]), /no node "Nope"/);
    await assert.rejects(deriveModel(src, [{wobble:true}]), /Unknown derive operation/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('derived provider: the adapted model keeps the source license and creator; its credit lists every modification', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-derived-'));
  try {
    const src = await texturedModel(dir), conv = join(dir, 'converted/sketchfab/abc/k1');
    await mkdir(conv, {recursive:true});
    await writeFile(join(conv, 'model.glb'), await readFile(src));
    const sha = (await import('node:crypto')).createHash('sha256').update(await readFile(src)).digest('hex');
    await writeFile(join(conv, 'report.json'), JSON.stringify({status:'passed', convertedAt:'2026-11-14T00:00:00Z', glb:{file:'model.glb', sha256:sha},
      attribution:{name:'Sign', sourceUrl:'https://sketchfab.com/3d-models/abc', license:'CC-BY-4.0', licenseEvidence:'record', creator:'Author', credit:'"Sign" by Author, CC BY 4.0'}}));
    await mkdir(join(dir, 'recipes'), {recursive:true});
    await writeFile(join(dir, 'recipes/holdup-sign.json'), JSON.stringify({id:'holdup-sign', name:'Plain sign (Hold Up)', description:'test', tags:['sign'], style:'stylized',
      from:{provider:'sketchfab', id:'abc'}, ops:[{keep:['Sign Group']}, {flatten:{}}]}));
    const provider = createDerivedProvider({cacheDir:join(dir, 'cache'), recipesDir:join(dir, 'recipes'), convertedDir:join(dir, 'converted')});
    const source = await provider.conversionSource('holdup-sign');
    assert.equal(source.attribution.license, 'CC-BY-4.0'); assert.equal(source.attribution.creator, 'Author'); assert.equal(source.attribution.sourceUrl, 'https://sketchfab.com/3d-models/abc');
    assert.match(source.attribution.credit, /^"Sign" by Author, CC BY 4\.0; modified by Hold Up: kept Sign Group; textures flattened/);
    assert.equal((await provider.fetchModel('holdup-sign')).status, 'cached');
  } finally { await rm(dir, {recursive:true, force:true}); }
});
