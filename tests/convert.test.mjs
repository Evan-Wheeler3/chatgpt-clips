import {test} from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { convertAsset } from '../tools/convert/pipeline.mjs';
import { findChrome, renderPreview } from '../tools/convert/preview.mjs';
import { registerAsset } from '../tools/convert/register.mjs';
import { resolveAssets } from '../tools/asset-resolver.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const CRC = Array.from({length:256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  // Checkerboard of rgb and its inverse, so the texture is not a solid colour
  const rows = Buffer.concat(Array.from({length:height}, (_, y) => Buffer.from([0, ...Array.from({length:width}, (_, x) => (x + y) % 2 ? rgb.map(c => 255 - c) : rgb).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const TEXTURE = png(4, 4, [200, 120, 40]);

// A grounded, textured 0.4 x 0.6 x 0.2 m box written as .gltf + .bin + .png
async function writeFixture(dir, {size = [0.4, 0.6, 0.2], groundY = 0} = {}) {
  const [x, y, z] = size.map(value => value / 2);
  const document = new Document();
  const buffer = document.createBuffer('box');
  const corners = [];
  const normals = [], uvs = [], indices = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [axis, sign] of faces) {
    const base = corners.length / 3;
    const [u, v] = [0, 1, 2].filter(a => a !== axis);
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const point = [0, 0, 0];
      point[axis] = sign; point[u] = a; point[v] = b;
      corners.push(point[0] * x, point[1] * y + y + groundY, point[2] * z);
      const normal = [0, 0, 0]; normal[axis] = sign; normals.push(...normal);
      uvs.push((a + 1) / 2, (b + 1) / 2);
    }
    indices.push(...(sign > 0 === (axis !== 1) ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]).map(i => base + i));
  }
  const texture = document.createTexture('paint').setImage(TEXTURE).setMimeType('image/png').setURI('textures/paint.png');
  const material = document.createMaterial('painted').setBaseColorTexture(texture).setRoughnessFactor(0.8);
  const prim = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(new Float32Array(corners)).setBuffer(buffer))
    .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    .setAttribute('TEXCOORD_0', document.createAccessor().setType('VEC2').setArray(new Float32Array(uvs)).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  const mesh = document.createMesh('box').addPrimitive(prim);
  document.createScene('scene').addChild(document.createNode('box').setMesh(mesh));
  buffer.setURI('box.bin');
  await mkdir(dir, {recursive:true});
  await new NodeIO().write(join(dir, 'box.gltf'), document);
  return sourceFor(dir, size);
}

async function sourceFor(dir, size, overrides = {}) {
  const paths = ['box.gltf', 'box.bin', 'textures/paint.png'];
  const files = await Promise.all(paths.map(async path => {
    const data = await readFile(join(dir, path));
    return {path, size:data.length, sha256:sha256(data)};
  }));
  return {
    provider:'fixture', id:'painted_box', version:'v1', resolution:'1k', dir, entry:'box.gltf', files,
    attribution:{name:'Painted Box', sourceUrl:'https://example.org/painted-box', license:'CC0-1.0', licenseEvidence:'https://example.org/license', creator:'Fixture Author'},
    metadata:{name:'Painted Box', description:'Test box', tags:['box','crate'], category:'Props/Containers', style:'realistic'},
    expected:{extentsM:size}, ...overrides
  };
}

const fakePreview = async (glbPath, {outPath}) => {
  await writeFile(outPath, png(2, 2, [0, 0, 0]));
  return {threeRevision:'test', meshes:[{name:'box', triangles:12}], textures:[{slot:'map', width:4, height:4}], triangles:12};
};

async function workspace(run) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-convert-'));
  try {
    const sourceDir = join(dir, 'source');
    const source = await writeFixture(sourceDir);
    await run({dir, sourceDir, source, outRoot:join(dir, 'converted')});
  } finally { await rm(dir, {recursive:true, force:true}); }
}

test('converts a glTF bundle to a self-contained, attributed GLB with textures preserved byte-for-byte', async () => {
  await workspace(async ({source, outRoot}) => {
    const result = await convertAsset(source, {outRoot, render:fakePreview});
    assert.equal(result.status, 'converted');
    assert.equal(result.report.validation.status, 'passed', result.report.validation.errors.join('; '));
    const glb = await readFile(join(result.dir, 'model.glb'));
    assert.equal(glb.subarray(0, 4).toString(), 'glTF');
    const document = await new NodeIO().readBinary(glb);
    const root = document.getRoot();
    assert.equal(root.listBuffers().length, 1);
    assert.equal(root.listBuffers()[0].getURI(), '');
    assert.deepEqual(Buffer.from(root.listTextures()[0].getImage()), TEXTURE);
    assert.equal(root.listMaterials()[0].getBaseColorTexture(), root.listTextures()[0]);
    assert.equal(root.listMaterials()[0].getRoughnessFactor(), 0.8);
    assert.match(root.getAsset().copyright, /Painted Box by Fixture Author, CC0-1.0/);
    assert.equal(root.getAsset().extras.holdUp.sourceUrl, 'https://example.org/painted-box');
    const {checks} = result.report.validation;
    assert.equal(checks.geometry.triangles, 12);
    assert.equal(checks.scale.maxRelativeError, 0);
    assert.equal(checks.khronos.errors, 0);
    assert.equal(result.report.conversion.blenderUsed, false);
    assert.ok(result.report.preview);
  });
});

test('conversion is deterministic and cached by source hashes and options', async () => {
  await workspace(async ({dir, sourceDir, source, outRoot}) => {
    const first = await convertAsset(source, {outRoot, render:fakePreview});
    const again = await convertAsset(source, {outRoot, render:fakePreview, force:true});
    assert.equal(again.report.glb.sha256, first.report.glb.sha256);
    let renders = 0;
    const counting = async (...args) => { renders++; return fakePreview(...args); };
    assert.equal((await convertAsset(source, {outRoot, render:counting})).status, 'cached');
    assert.equal(renders, 0);
    await writeFile(join(first.dir, 'model.glb'), 'corrupt');
    assert.equal((await convertAsset(source, {outRoot, render:counting})).status, 'converted');
    const quantized = await convertAsset(source, {outRoot, render:fakePreview, quantize:true});
    assert.notEqual(quantized.dir, first.dir);
    await writeFile(join(sourceDir, 'textures/paint.png'), png(4, 4, [10, 10, 10]));
    const changed = await convertAsset(await sourceFor(sourceDir, [0.4, 0.6, 0.2]), {outRoot, render:fakePreview});
    assert.notEqual(changed.dir, first.dir);
    assert.deepEqual((await readdir(join(outRoot, '.partial'))), []);
  });
});

test('validation fails on wrong scale or swapped axes and warns when not grounded', async () => {
  await workspace(async ({source, outRoot}) => {
    const wrongScale = await convertAsset({...source, expected:{extentsM:[40, 60, 20]}}, {outRoot, preview:false});
    assert.equal(wrongScale.status, 'failed');
    assert.match(wrongScale.report.validation.errors.join(), /Size differs/);
    const swapped = await convertAsset({...source, expected:{extentsM:[0.4, 0.2, 0.6]}}, {outRoot, preview:false});
    assert.match(swapped.report.validation.errors.join(), /Axis order differs/);
    assert.equal((await convertAsset({...source, expected:{extentsM:[0.4, 0.2, 0.6]}}, {outRoot, preview:false})).status, 'failed'); // Failed results are not cached
  });
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-convert-'));
  try {
    const floating = await writeFixture(join(dir, 'source'), {groundY:0.5});
    const result = await convertAsset(floating, {outRoot:join(dir, 'out'), preview:false});
    assert.equal(result.status, 'converted');
    assert.match(result.report.validation.warnings.join(), /base is 0.5 m from y=0/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('sources must be complete, verified, local and in a supported format', async () => {
  await workspace(async ({sourceDir, source, outRoot}) => {
    const reject = (candidate, code) => assert.rejects(convertAsset(candidate, {outRoot, preview:false}), error => error.code === code);
    await reject({...source, files:source.files.filter(file => file.path !== 'box.bin')}, 'MISSING_REFERENCE');
    await reject({...source, files:source.files.map(file => file.path === 'box.bin' ? {...file, sha256:'0'.repeat(64)} : file)}, 'SOURCE_INTEGRITY');
    await reject({...source, entry:'model.fbx', files:[...source.files, {path:'model.fbx', size:1, sha256:'0'.repeat(64)}]}, 'NEEDS_BLENDER');
    await reject({...source, attribution:{...source.attribution, license:''}}, 'INVALID_SOURCE');
    await reject({...source, files:[...source.files, {path:'../outside.bin', size:1, sha256:'0'.repeat(64)}]}, 'INVALID_SOURCE');
    const gltf = JSON.parse(await readFile(join(sourceDir, 'box.gltf'), 'utf8'));
    gltf.images[0].uri = 'https://example.org/paint.png';
    await writeFile(join(sourceDir, 'box.gltf'), JSON.stringify(gltf));
    await reject(await sourceFor(sourceDir, [0.4, 0.6, 0.2]), 'UNSAFE_REFERENCE');
  });
});

test('a failing Three.js preview fails the conversion', async () => {
  await workspace(async ({source, outRoot}) => {
    const result = await convertAsset(source, {outRoot, render:async () => { throw new Error('Three.js preview failed: texture missing'); }});
    assert.equal(result.status, 'failed');
    assert.match(result.report.validation.errors.join(), /texture missing/);
  });
});

test('registration requires approval and a passed preview, then the resolver finds the asset', async () => {
  await workspace(async ({dir, source, outRoot}) => {
    const catalogPath = join(dir, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify({version:1, assets:[]}));
    const options = {catalogPath, libraryDir:join(dir, 'assets/library'), rootDir:dir};
    const converted = await convertAsset(source, {outRoot, render:fakePreview});
    const reportPath = join(converted.dir, 'report.json');
    await assert.rejects(registerAsset(reportPath, {...options, approvedBy:'Reviewer'}), /explicit approval/);
    await assert.rejects(registerAsset(reportPath, {...options, approve:true}), /approved-by/);
    const failed = await convertAsset({...source, expected:{extentsM:[1, 1, 1]}}, {outRoot, preview:false});
    await assert.rejects(registerAsset(join(failed.dir, 'report.json'), {...options, approve:true, approvedBy:'Reviewer'}), /status is failed/);

    const registered = await registerAsset(reportPath, {...options, approve:true, approvedBy:'Reviewer'});
    assert.equal(registered.status, 'registered');
    assert.equal(registered.entry.id, 'fixture-painted-box');
    assert.equal(registered.entry.localPath, 'assets/library/fixture-painted-box.glb');
    assert.equal(registered.entry.license, 'CC0-1.0');
    assert.equal(registered.entry.sha256, converted.report.glb.sha256);
    assert.ok(registered.entry.tags.includes('containers'));
    assert.equal((await registerAsset(reportPath, {...options, approve:true, approvedBy:'Reviewer'})).status, 'unchanged');

    const [result] = await resolveAssets([{id:'box', query:'painted box', style:'realistic'}], {catalogPath, rootDir:dir});
    assert.equal(result.status, 'found');
    assert.equal(result.candidates[0].id, 'fixture-painted-box');

    const other = await convertAsset(source, {outRoot, render:fakePreview, quantize:true});
    await assert.rejects(registerAsset(join(other.dir, 'report.json'), {...options, approve:true, approvedBy:'Reviewer'}), /--replace/);
    assert.equal((await registerAsset(join(other.dir, 'report.json'), {...options, approve:true, approvedBy:'Reviewer', replace:true})).status, 'replaced');
  });
});

test('registration enforces the model license allow-list and keeps the credit line for attribution licenses', async () => {
  await workspace(async ({dir, source, outRoot}) => {
    const catalogPath = join(dir, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify({version:1, assets:[]}));
    const options = {catalogPath, libraryDir:join(dir, 'assets/library'), rootDir:dir, approve:true, approvedBy:'Reviewer'};
    const convert = async (attribution, id) => join((await convertAsset({...source, id, attribution:{...source.attribution, ...attribution}}, {outRoot, render:fakePreview})).dir, 'report.json');
    await assert.rejects(registerAsset(await convert({license:'CC-BY-NC-4.0'}, 'nc_box'), options), /not allowed/);
    await assert.rejects(registerAsset(await convert({license:'CC-BY-4.0'}, 'uncredited_box'), options), /requires attribution/);
    const credit = '"Painted Box" by Fixture Author (https://example.org/a), https://example.org/painted-box, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)';
    const {entry} = await registerAsset(await convert({license:'CC-BY-4.0', credit}, 'credited_box'), options);
    assert.deepEqual(entry.attribution, {required:true, credit});
  });
});

test('converted GLB loads and renders in Three.js (headless Chrome)', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH to run the Three.js load test');
  await workspace(async ({source, outRoot}) => {
    const result = await convertAsset(source, {outRoot});
    assert.equal(result.status, 'converted', result.report.validation.errors.join('; '));
    const stats = result.report.threejs;
    assert.equal(stats.meshes.length, 1);
    assert.equal(stats.triangles, 12);
    assert.deepEqual(stats.textures.map(({slot, width, height, colorSpace}) => ({slot, width, height, colorSpace})), [{slot:'map', width:4, height:4, colorSpace:'srgb'}]);
    const preview = await readFile(join(result.dir, 'preview.png'));
    assert.equal(preview.subarray(1, 4).toString(), 'PNG');
    await assert.rejects(renderPreview(join(result.dir, 'missing.glb')), /Three.js preview failed/);
  });
});
