import {test} from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { Vector3 } from 'three';
import { validateTextureCatalog, registerTexture, resolveTexture } from '../tools/materials/textures.mjs';
import { createPolyHavenProvider } from '../tools/providers/polyhaven.mjs';
import { compileEnvironment } from '../tools/environment/compile.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { validatePlan } from '../tools/storyboard/validate.mjs';
import { samplePlan, castTracks } from '../tools/storyboard/sample.mjs';
import { judgeQA } from '../tools/render/qa.mjs';
import { openRenderer } from '../tools/storyboard/animatic.mjs';
import { findChrome } from '../tools/convert/preview.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const md5 = data => createHash('md5').update(data).digest('hex');
const CRC = Array.from({length:256}, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgb) {
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type), data]); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, c]); };
  const h = Buffer.alloc(13); h.writeUInt32BE(4, 0); h.writeUInt32BE(4, 4); h[8] = 8; h[9] = 2;
  const rows = Buffer.concat(Array.from({length:4}, (_, y) => Buffer.from([0, ...Array.from({length:4}, (_, x) => (x + y) % 2 ? rgb : rgb.map(c => c * 0.7)).flat()])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', h), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const CORNERS = (sx, sy, sz) => [-sx / 2, sx / 2].flatMap(x => [0, sy].flatMap(y => [-sz / 2, sz / 2].map(z => [x, y, z])));

async function boxGlb(path, [sx, sy, sz], color = [0.6, 0.4, 0.2, 1]) {
  const document = new Document(), buffer = document.createBuffer();
  const positions = new Float32Array(CORNERS(sx, sy, sz).flat());
  const indices = new Uint16Array([0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6]);
  const normals = new Float32Array(CORNERS(sx, sy, sz).flatMap(([x, y, z]) => new Vector3(x, y - sy / 2, z).normalize().toArray()));
  const prim = document.createPrimitive()
    .setAttribute('POSITION', document.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
    .setAttribute('NORMAL', document.createAccessor().setType('VEC3').setArray(normals).setBuffer(buffer))
    .setIndices(document.createAccessor().setType('SCALAR').setArray(indices).setBuffer(buffer))
    .setMaterial(document.createMaterial('m').setBaseColorFactor(color).setRoughnessFactor(0.8));
  document.createScene().addChild(document.createNode().setMesh(document.createMesh().addPrimitive(prim)));
  const bytes = await new NodeIO().writeBinary(document);
  await mkdir(dirname(path), {recursive:true});
  await writeFile(path, bytes);
  return sha256(bytes);
}

// A tiny but complete world: catalog models, a texture catalog, an environment spec, a style and the Bram character
async function world({missingTexture = false, dressingInActionArea = false} = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-phase5-'));
  const assets = [];
  for (const [id, size] of [['barrel', [0.7, 0.9, 0.7]], ['crate', [0.8, 0.4, 0.5]]]) {
    const sha = await boxGlb(join(dir, `assets/library/${id}.glb`), size);
    assets.push({id, name:`Wooden ${id}`, description:'fixture', tags:[id, 'wooden'], style:'realistic', localPath:`assets/library/${id}.glb`,
      sourceUrl:'https://example.org/a', license:'CC0-1.0', creator:'Fixture', sha256:sha, triangles:12});
  }
  await writeFile(join(dir, 'assets/catalog.json'), JSON.stringify({version:1, assets}));
  const image = png([180, 120, 80]);
  await mkdir(join(dir, 'assets/library/textures/brick'), {recursive:true});
  await writeFile(join(dir, 'assets/library/textures/brick/color.jpg'), image);
  const texture = {id:'brick', name:'Brick', sourceUrl:'https://example.org/t', license:'CC0-1.0', creator:'Fixture', realSizeM:[2, 2],
    maps:{color:{localPath:'assets/library/textures/brick/color.jpg', sha256:sha256(image)}}};
  await writeFile(join(dir, 'assets/texture-catalog.json'), JSON.stringify({version:1, textures:missingTexture ? [] : [texture]}));
  await mkdir(join(dir, 'environments'), {recursive:true});
  const env = {
    version:1, id:'test-room', name:'Test room', period:'any', location:'fixture', bounds:{min:[-4, 0, -4], max:[4, 3, 9]},
    keepClear:[{center:[0, 0, 0], radius:1.2}],
    materials:{brick:{texture:'brick', tint:'#ffffff'}, timber:{color:'#7a5030'}, planks:{color:'#5a4030'}, iron:{color:'#333333', metalness:0.5}},
    architecture:[{type:'floor', material:'brick'}, {type:'walls', material:'brick', height:3, sides:['back', 'left', 'right'], openings:[{side:'back', type:'window', center:[0, 1.8], size:[0.8, 1.2]}]},
      {type:'rack', material:'timber', from:[-3.5, -3.5], to:[-3.5, 3], axis:'x', load:{asset:'barrel', spacing:0.8, tiers:2, skip:[0]}}],
    dressing:[{asset:'crate', position:dressingInActionArea ? [0.5, 0, 0.3] : [2.8, 0, -2.8], rotation:[0, 20, 0], layer:'midground'}],
    lighting:{key:{type:'sun', direction:[0.2, -0.5, 0.8], color:'key', intensity:3, shadow:true}, practicals:[{position:[2.5, 1.5, -2.5], color:'#ffaa55', intensity:3, distance:4, flicker:0.05, glow:0.06}],
      ambient:{sky:'ambientSky', ground:'ambientGround', intensity:1}, environment:0.3},
    atmosphere:{fog:{color:'fog', density:0.03}, shafts:[{window:0, length:5, radius:[0.4, 1], opacity:0.15}], dust:{min:[-2, 0.2, -3], max:[2, 2.5, 1], size:0.012}}
  };
  await writeFile(join(dir, 'environments/test-room.json'), JSON.stringify(env));
  await mkdir(join(dir, 'characters'), {recursive:true});
  await copyFile(join(repo, 'characters/bram.json'), join(dir, 'characters/bram.json'));
  return dir;
}

const WORDS = 'Look at this barrel. Bram gives it a push and it rolls away.'.split(' ').map((text, i) => ({i, text, start:0.2 + i * 0.3, end:0.45 + i * 0.3}));
const WORDS_DOC = {words:WORDS, audio:{durationSec:WORDS.at(-1).end + 0.3}};
function story(overrides = {}) {
  return {
    version:1, slug:'phase5-fixture', fps:30, environment:{id:'test-room'},
    props:[{id:'barrel', asset:{query:'wooden barrel'}, position:[0, 0, 0]}],
    cast:[{id:'bram', character:'bram', start:{position:[-1.0, 0.4], face:'barrel'}}],
    beats:[{id:'b', purpose:'p', shots:[
      {id:'look', purpose:'Bram considers the barrel', subject:'barrel', camera:{move:'hold', framing:'wide', azimuth:10, elevation:10},
        events:[{character:'bram', at:'Look', do:'pose', params:{preset:'think', target:'barrel'}}]},
      {id:'shove', start:'Bram', purpose:'The push', subject:'barrel', transition:{type:'cut', motivation:'Action'}, camera:{move:'follow', framing:'wide', azimuth:20, elevation:12, params:{lag:0.15}},
        events:[
          {character:'bram', at:'shot-start', do:'place', params:{near:'barrel', side:[-1, 0, 0], gap:0.12, face:'barrel'}},
          {character:'bram', at:'push', do:'push', params:{prop:'barrel'}, duration:0.3},
          {at:'push', prop:'barrel', do:'move', params:{to:[1.2, 0, 0]}, until:'away.', ease:'out'}
        ]}
    ]}],
    ...overrides
  };
}
const compile = (s, dir) => compileStory(s, WORDS_DOC, {catalogPath:join(dir, 'assets/catalog.json'), rootDir:dir});

test('texture catalog validates real-world size and paths, and registration needs explicit approval', async () => {
  assert.throws(() => validateTextureCatalog({version:1, textures:[{id:'t', name:'n', sourceUrl:'https://e.org', license:'CC0-1.0', creator:'c', realSizeM:[0, 1], maps:{color:{localPath:'a.jpg', sha256:'0'.repeat(64)}}}]}), /realSizeM/);
  assert.throws(() => validateTextureCatalog({version:1, textures:[{id:'t', name:'n', sourceUrl:'https://e.org', license:'CC0-1.0', creator:'c', realSizeM:[1, 1], maps:{color:{localPath:'../x.jpg', sha256:'0'.repeat(64)}}}]}), /unsafe/);
  await assert.rejects(registerTexture({provenance:{}}, {approvedBy:'x'}), /explicit approval/);
  const dir = await world();
  try {
    assert.ok(await resolveTexture('brick', {catalogPath:join(dir, 'assets/texture-catalog.json'), rootDir:dir}));
    await rm(join(dir, 'assets/library/textures/brick/color.jpg'));
    assert.equal(await resolveTexture('brick', {catalogPath:join(dir, 'assets/texture-catalog.json'), rootDir:dir}), null);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('Poly Haven textures download colour/normal/ARM maps with real-world size, and models are rejected as textures', async () => {
  const jpg = Buffer.from('fake-jpeg');
  const DL = 'https://dl.polyhaven.org/file/ph-assets/Textures';
  const fetch = async url => {
    const json = data => new Response(JSON.stringify(data));
    if (url.endsWith('/assets?type=models')) return json({});
    if (url.endsWith('/vaults')) return json({});
    if (url.endsWith('/info/old_brick')) return json({name:'Old Brick', type:1, authors:{Artist:'All'}, files_hash:'h1', date_published:1600000000, dimensions:[2500, 2500], tags:['brick']});
    if (url.endsWith('/files/old_brick')) return json(Object.fromEntries(['Diffuse', 'nor_gl', 'arm'].map(m => [m, {'1k':{jpg:{url:`${DL}/${m}.jpg`, size:jpg.length, md5:md5(jpg)}}}])));
    if (url.endsWith('/info/a_model')) return json({name:'A model', type:2, files_hash:'h2', date_published:1600000000});
    if (url.endsWith('/files/a_model')) return json({});
    if (url.startsWith(DL)) return new Response(jpg);
    return new Response('missing', {status:404});
  };
  const cacheDir = await mkdtemp(join(tmpdir(), 'hold-up-tex-'));
  try {
    const provider = createPolyHavenProvider({fetch, cacheDir});
    const result = await provider.fetchTexture('old_brick');
    assert.equal(result.provenance.format, 'texture');
    assert.deepEqual(result.provenance.realSizeM, [2.5, 2.5]);
    assert.deepEqual(result.provenance.files.map(f => f.path).sort(), ['Diffuse.jpg', 'arm.jpg', 'nor_gl.jpg']);
    assert.equal((await provider.fetchTexture('old_brick')).status, 'cached');
    await assert.rejects(provider.fetchTexture('a_model'), /not a texture/);
  } finally { await rm(cacheDir, {recursive:true, force:true}); }
});

test('environments compile from catalogs: racks expand, misses are recorded not substituted, action-area intrusion is flagged, builds are cached', async () => {
  const dir = await world();
  try {
    const env = await compileEnvironment('test-room', {catalogPath:join(dir, 'assets/catalog.json'), textureCatalogPath:join(dir, 'assets/texture-catalog.json'), rootDir:dir, cacheDir:join(dir, '.cache')});
    assert.equal(env.cache, 'miss');
    const rack = env.instances.filter(i => i.source === 'rack');
    assert.ok(rack.length >= 10 && rack.every(i => i.castShadow === false), `rack instances: ${rack.length}`);
    assert.ok(rack.every(i => Math.abs(i.position[2]) > 0.4), 'skip gaps are honoured');
    assert.ok(rack.every(i => i.box.min[1] >= 0.2), 'barrels rest on the rails');
    assert.deepEqual(env.missing, []);
    assert.deepEqual(env.intrusions, []);
    assert.equal(env.materials.brick.texture.realSizeM[0], 2);
    const again = await compileEnvironment('test-room', {catalogPath:join(dir, 'assets/catalog.json'), textureCatalogPath:join(dir, 'assets/texture-catalog.json'), rootDir:dir, cacheDir:join(dir, '.cache')});
    assert.equal(again.cache, 'hit');
  } finally { await rm(dir, {recursive:true, force:true}); }
  const broken = await world({missingTexture:true, dressingInActionArea:true});
  try {
    const env = await compileEnvironment('test-room', {catalogPath:join(broken, 'assets/catalog.json'), textureCatalogPath:join(broken, 'assets/texture-catalog.json'), rootDir:broken, cacheDir:join(broken, '.cache')});
    assert.deepEqual(env.missing, [{kind:'texture', id:'brick', material:'brick'}]);
    assert.equal(env.materials.brick.texture, null);
    assert.equal(env.intrusions.length, 1);
  } finally { await rm(broken, {recursive:true, force:true}); }
});

test('characters: cuts snap facing, walks are stride-locked, pushes reach the prop with anticipation, blinks are deterministic', async () => {
  const dir = await world();
  try {
    const s = story();
    s.beats[0].shots[0].events.push({character:'bram', at:'this', do:'walk', params:{to:[-1.6, 0.6]}, until:'barrel.'});
    const plan = await compile(s, dir);
    const track = castTracks(plan).get('bram');
    const shove = plan.shots[1];
    assert.equal(track[shove.startFrame].turnScale, 1, 'no turn animation on the cut frame');
    assert.ok(track.every(state => state.position[1] === 0), 'feet stay on the ground');
    const push = plan.cast[0].actions.find(a => a.type === 'push');
    const contact = track.slice(push.startFrame, push.endFrame).filter(state => state.contact);
    assert.ok(contact.length > 0 && contact.every(state => state.contact.shortfallM < 0.03), `hands reach the barrel: ${contact.map(c => c.contact.shortfallM.toFixed(3)).join(',')} pos ${JSON.stringify(track[push.startFrame].position)}`);
    assert.ok(track[push.startFrame - 3].pose.hipDrop > track[push.startFrame - 12].pose.hipDrop + 10, 'crouches in anticipation');
    const again = castTracks(await compile(story({...s}), dir)).get('bram');
    assert.deepEqual(again.map(state => state.blink), track.map(state => state.blink));
    const walk = plan.cast[0].actions.find(a => a.type === 'walk');
    const dist = new Vector3(...track[walk.endFrame].position).distanceTo(new Vector3(...track[walk.startFrame].position));
    assert.ok(dist > 0.5, 'walk travels');
    assert.ok(track.every(state => state.pose.squash >= 0.85 && state.pose.squash <= 1.15), 'stays on model');
    assert.equal(validatePlan(plan).status, 'pass', JSON.stringify(validatePlan(plan).errors));
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('validation catches character clipping, mid-shot teleports, unreachable pushes, unsynced pushes, cameras outside the room and missing textures', async () => {
  const dir = await world();
  try {
    const codes = async fn => { const s = story(); fn(s); const v = validatePlan(await compile(s, dir)); return [...v.errors, ...v.warnings].map(i => i.code); };
    assert.ok((await codes(s => { s.cast[0].start.position = [0, 0]; })).includes('CHARACTER_CLIPPING'));
    assert.ok((await codes(s => { s.beats[0].shots[1].events.push({character:'bram', at:'it#1', do:'place', params:{position:[-2, 1]}}); })).includes('PLACE_NOT_ON_CUT'));
    assert.ok((await codes(s => { s.beats[0].shots[1].events[0].params.gap = 1.5; })).includes('CHARACTER_NO_CONTACT'));
    assert.ok((await codes(s => { s.beats[0].shots[1].events[2].at = 'away.'; s.beats[0].shots[1].events[2].until = undefined; s.beats[0].shots[1].events[2].duration = 0.2; })).includes('PUSH_NOT_SYNCED'));
    assert.ok((await codes(s => { s.beats[0].shots[0].camera = {move:'hold', framing:'wide', azimuth:10, elevation:10, lens:'wide'}; s.props[0].scale = 3; })).includes('CAMERA_OUTSIDE_ROOM'));
  } finally { await rm(dir, {recursive:true, force:true}); }
  const missing = await world({missingTexture:true});
  try {
    const v = validatePlan(await compile(story(), missing));
    assert.ok(v.errors.some(e => e.code === 'ENV_MISSING_TEXTURE'));
  } finally { await rm(missing, {recursive:true, force:true}); }
});

test('pixel QA turns rendered-frame statistics into review warnings', () => {
  const frame = (over = {}) => ({frame:1, shot:'s', meanLuma:0.25, clippedHigh:0, crushedLow:0.01, subject:{luma:0.3, ring:0.2, contrast:0.1}, characters:[{id:'bram', rect:[0, 0, 10, 10], luma:0.4, ring:0.2, contrast:0.2}], renderer:{calls:100, triangles:1000, textures:10}, ...over});
  const budget = {triangles:5000, drawCalls:200};
  assert.equal(judgeQA({}, [frame()], budget).status, 'pass');
  const codes = judgeQA({}, [frame({meanLuma:0.05, crushedLow:0.3}), frame({clippedHigh:0.1, meanLuma:0.7}), frame({subject:{luma:0.2, ring:0.2, contrast:0.001}}),
    frame({characters:[{id:'bram', rect:[0, 0, 5, 5], luma:0.2, ring:0.2, contrast:0}]}), frame({renderer:{calls:500, triangles:9000, textures:1}})], budget).warnings.map(w => w.code);
  for (const code of ['FRAME_TOO_DARK', 'FRAME_CRUSHED', 'FRAME_BLOWN', 'FRAME_TOO_BRIGHT', 'SUBJECT_LOW_CONTRAST', 'CHARACTER_LOW_CONTRAST', 'RENDER_OVER_BUDGET']) assert.ok(codes.includes(code), code);
});

test('styled preview renders an environment and a 2D character in headless Chrome without shader or load errors', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const dir = await world();
  const gpu = process.env.HOLDUP_GPU;
  process.env.HOLDUP_GPU = gpu ?? 'swiftshader';
  try {
    const plan = await compile(story(), dir);
    for (const prop of plan.props) if (prop.asset) prop.asset.localPath = join(dir, prop.asset.localPath);
    for (const asset of Object.values(plan.environment.assets)) asset.localPath = join(dir, asset.localPath);
    for (const m of Object.values(plan.environment.materials)) if (m.texture) m.texture.maps = Object.fromEntries(Object.entries(m.texture.maps).map(([k, v]) => [k, join(dir, v)]));
    const r = await openRenderer(plan, {quality:'preview', scale:0.15});
    try {
      assert.equal(r.setup.environment, 'test-room');
      assert.equal(r.setup.characters, 1);
      assert.deepEqual(r.setup.flags, []);
      const [stats] = await r.page.evaluate(() => window.qaFrames([20]));
      assert.ok(stats.renderer.calls > 20 && stats.renderer.triangles > 100);
      assert.ok(stats.meanLuma > 0.03, `mean luma ${stats.meanLuma}`);
      assert.ok(stats.characters[0].rect, 'character is on screen');
      assert.deepEqual(r.problems, []);
    } finally { await r.close(); }
  } finally {
    if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu;
    await rm(dir, {recursive:true, force:true});
  }
});

test('outdoor environments: no walls, a gradient sky dome that also lights reflections (headless Chrome)', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const dir = await world();
  const gpu = process.env.HOLDUP_GPU;
  process.env.HOLDUP_GPU = gpu ?? 'swiftshader';
  try {
    const yard = {version:1, id:'test-yard', name:'Test yard', period:'modern', location:'fixture', bounds:{min:[-20, 0, -20], max:[20, 10, 20]}, keepClear:[],
      materials:{brick:{texture:'brick', tint:'#9a9a9a'}}, architecture:[{type:'floor', material:'brick'}],
      dressing:[{asset:'crate', position:[3, 0, -3], rotation:[0, 20, 0], layer:'midground'}],
      lighting:{key:{type:'sun', direction:[0.3, -0.6, 0.5], color:'#fff4e2', intensity:3, shadow:true}, practicals:[], ambient:{sky:'#cfe0f2', ground:'#7d7a74', intensity:1}, environment:0.6},
      atmosphere:{sky:{top:'#5d8fd0', horizon:'#d8e6f2', ground:'#8a8478'}}};
    await writeFile(join(dir, 'environments/test-yard.json'), JSON.stringify(yard));
    const s = story({environment:{id:'test-yard'}});
    s.beats[0].shots = [{...s.beats[0].shots[0], camera:{move:'hold', framing:'wide', azimuth:10, elevation:4}}];
    s.beats = [s.beats[0]];
    const plan = await compile(s, dir);
    assert.ok(plan.environment.atmosphere.sky, 'the sky survives compilation');
    for (const prop of plan.props) if (prop.asset) prop.asset.localPath = join(dir, prop.asset.localPath);
    for (const asset of Object.values(plan.environment.assets)) asset.localPath = join(dir, asset.localPath);
    for (const m of Object.values(plan.environment.materials)) if (m.texture) m.texture.maps = Object.fromEntries(Object.entries(m.texture.maps).map(([k, v]) => [k, join(dir, v)]));
    const r = await openRenderer(plan, {quality:'preview', scale:0.15});
    try {
      // The top of the frame is sky: blue-dominant and bright, not the black clear colour
      const top = await r.page.evaluate(async () => {
        const [url] = window.renderFrames([10], 'image/png', false);
        const img = new Image(); img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, Math.round(c.height * 0.1)).data;
        let R = 0, G = 0, B = 0; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; }
        const n = d.length / 4; return [R / n, G / n, B / n];
      });
      assert.ok(top[2] > 120 && top[2] > top[0], `sky colour at the top of frame: ${top.map(Math.round)}`);
      assert.deepEqual(r.problems, []);
    } finally { await r.close(); }
  } finally {
    if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu;
    await rm(dir, {recursive:true, force:true});
  }
});
