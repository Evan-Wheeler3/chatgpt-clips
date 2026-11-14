import {test} from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, access, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPolyHavenProvider, scoreModel } from '../tools/providers/polyhaven.mjs';
import { resolveAssets } from '../tools/asset-resolver.mjs';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const model = (overrides = {}) => ({
  name:'Wooden Stool 01', type:2, categories:['furniture','seating'], category:'Furniture/Seating/Stools',
  tags:['stool','wood','rustic'], authors:{'Example Artist':'All'}, description:'Free (CC0) worn wooden stool.',
  date_published:1600000000, files_hash:'abc123', polycount:900, dimensions:[400,400,450], ...overrides
});
const models = {
  wooden_stool_01:model(),
  bar_chair_round_01:model({name:'Bar Chair Round 01', tags:['chair','metal'], category:'Furniture/Seating/Chairs'}),
  Camera_01:model({name:'Camera 01', tags:['camera','vintage'], categories:['electronics'], category:'Electronics', tmwarn:true}),
  moon_rock_01:model({name:'Moon Rock 01', tags:['rock','stool']}),
  future_stool:model({name:'Future Stool', date_published:NOW/1000 + 86400}),
  stool_texture:model({name:'Stool Texture', type:1})
};
const vaults = {moon:{status:'locked', assets:['moon_rock_01']}};
const body = Buffer.from('{"asset":{"version":"2.0"}}');
const texture = Buffer.from('fake-jpeg-bytes');
const md5 = data => createHash('md5').update(data).digest('hex');
const DL = 'https://dl.polyhaven.org/file/ph-assets/Models';
const files = (include = {'textures/stool_diff_1k.jpg':{url:`${DL}/jpg/1k/stool_diff_1k.jpg`, size:texture.length, md5:md5(texture)}}) => ({
  gltf:{'1k':{gltf:{url:`${DL}/gltf/1k/wooden_stool_01/wooden_stool_01_1k.gltf`, size:body.length, md5:md5(body), include}}}
});

function fakeFetch({fileTree = files(), blobs = {}, routes = {}} = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({url, userAgent:options?.headers?.['User-Agent'], redirect:options?.redirect});
    if (routes[url]) return routes[url]();
    const json = data => new Response(JSON.stringify(data), {status:200});
    if (url === 'https://api.polyhaven.com/assets?type=models') return json(models);
    if (url === 'https://api.polyhaven.com/vaults') return json(vaults);
    if (url === 'https://api.polyhaven.com/info/wooden_stool_01') return json(models.wooden_stool_01);
    if (url === 'https://api.polyhaven.com/files/wooden_stool_01') return json(fileTree);
    if (url.endsWith('.gltf')) return new Response(body);
    if (url.endsWith('.jpg')) return new Response(blobs[url] ?? texture);
    return new Response('missing', {status:404});
  };
  return {fetch, calls};
}

async function withProvider(options, run) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'hold-up-polyhaven-'));
  try { await run(createPolyHavenProvider({cacheDir, now:() => NOW, ...options}), cacheDir); }
  finally { await rm(cacheDir, {recursive:true, force:true}); }
}

test('scoring prefers name hits, handles simple plurals and requires a query hit', () => {
  const stool = {...model(), id:'wooden_stool_01'};
  assert.deepEqual(scoreModel({query:'wooden stools'}, stool), {score:8, matchedTerms:['wooden','stool'], coverage:1});
  assert.equal(scoreModel({query:'bar stool'}, stool).coverage, 0.5);
  assert.equal(scoreModel({query:'spaceship'}, stool).score, 0);
  assert.equal(scoreModel({query:'spaceship', tags:['rustic']}, stool).score, 0);
});

test('search excludes locked, unpublished and non-model assets and labels provenance', async () => {
  const {fetch, calls} = fakeFetch();
  await withProvider({fetch}, async provider => {
    const results = await provider.search({query:'stool', style:'stylized'});
    assert.deepEqual(results.map(r => r.id), ['wooden_stool_01']);
    const [hit] = results;
    assert.equal(hit.license, 'CC0-1.0');
    assert.equal(hit.licenseEvidence, 'https://polyhaven.com/license');
    assert.equal(hit.sourceUrl, 'https://polyhaven.com/a/wooden_stool_01');
    assert.equal(hit.creator, 'Example Artist');
    assert.match(hit.warnings.join(), /Style review/);
    assert.ok(calls.every(call => call.userAgent?.startsWith('hold-up-animation-v2')));
  });
});

test('search flags trademark warnings and ignores description-only matches', async () => {
  const {fetch} = fakeFetch();
  await withProvider({fetch}, async provider => {
    const [camera] = await provider.search({query:'vintage camera', style:'realistic'});
    assert.equal(camera.id, 'Camera_01');
    assert.match(camera.warnings.join(), /Trademark/);
    assert.deepEqual(await provider.search({query:'worn'}), []);
  });
});

test('model index is cached on disk and reused', async () => {
  const {fetch, calls} = fakeFetch();
  await withProvider({fetch}, async (provider, cacheDir) => {
    await provider.search({query:'stool'});
    const again = createPolyHavenProvider({fetch, cacheDir, now:() => NOW + 3600 * 1000});
    await again.search({query:'stool'});
    assert.equal(calls.filter(call => call.url.includes('/assets')).length, 1);
  });
});

test('fetchModel verifies checksums and writes provenance', async () => {
  const {fetch} = fakeFetch();
  await withProvider({fetch}, async (provider, cacheDir) => {
    const result = await provider.fetchModel('wooden_stool_01');
    assert.equal(result.status, 'downloaded');
    assert.equal(result.dir, join(cacheDir, 'polyhaven', 'wooden_stool_01', 'abc123', '1k'));
    const provenance = JSON.parse(await readFile(join(result.dir, 'provenance.json'), 'utf8'));
    assert.equal(provenance.license, 'CC0-1.0');
    assert.equal(provenance.entry, 'wooden_stool_01_1k.gltf');
    assert.equal(provenance.files.length, 2);
    assert.ok(provenance.files.every(file => /^[0-9a-f]{64}$/.test(file.sha256)));
    assert.deepEqual(await readFile(join(result.dir, 'textures/stool_diff_1k.jpg')), texture);
    assert.equal((await provider.fetchModel('wooden_stool_01')).status, 'cached');
  });
});

test('fetchModel rejects tampered files, unapproved hosts and unsafe paths without leaving files', async () => {
  const cases = [
    [fakeFetch({blobs:{[`${DL}/jpg/1k/stool_diff_1k.jpg`]:Buffer.from('fake-jpeg-byteX')}}), /MD5 mismatch/],
    [fakeFetch({fileTree:files({'tex.jpg':{url:'https://evil.example/tex.jpg', size:1, md5:'x'}})}), /unapproved host/],
    [fakeFetch({fileTree:files({'../escape.jpg':{url:`${DL}/x.jpg`, size:1, md5:'x'}})}), /Unsafe file path/]
  ];
  for (const [{fetch}, error] of cases) {
    await withProvider({fetch}, async (provider, cacheDir) => {
      await assert.rejects(provider.fetchModel('wooden_stool_01'), error);
      await assert.rejects(access(join(cacheDir, 'polyhaven', 'wooden_stool_01')));
    });
  }
  const {fetch} = fakeFetch();
  await withProvider({fetch}, async provider => {
    await assert.rejects(provider.fetchModel('wooden_stool_01', {maxBytes:10}), /over the 10 byte limit/);
    await assert.rejects(provider.fetchModel('wooden_stool_01', {resolution:'8k'}), /available: 1k/);
    await assert.rejects(provider.fetchModel('../etc'), /Invalid Poly Haven asset id/);
  });
});

test('resolver attaches external candidates only to local misses', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-assets-'));
  try {
    const catalogPath = join(dir, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify({version:1, assets:[]}));
    const provider = {credit:'test', search:async request => [{provider:'fake', id:`${request.id}-hit`}]};
    const [result] = await resolveAssets([{id:'stool', query:'stool'}], {catalogPath, providers:[provider]});
    assert.equal(result.status, 'not_found');
    assert.deepEqual(result.externalCandidates, [{provider:'fake', id:'stool-hit'}]);
    const [plain] = await resolveAssets([{id:'stool', query:'stool'}], {catalogPath});
    assert.equal(plain.externalCandidates, undefined);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

const TEXTURE_URL = `${DL}/jpg/1k/stool_diff_1k.jpg`;
const redirect = location => () => new Response(null, {status:302, headers:{location}});

test('cached assets are revalidated and corrupted or incomplete copies are redownloaded', async () => {
  const corruptions = [
    [path => writeFile(path, Buffer.from('fake-jpeg-byteX')), /SHA-256 mismatch/], // Same size, different bytes
    [path => writeFile(path, Buffer.from('fake')), /size mismatch/],
    [path => unlink(path), /missing textures/]
  ];
  for (const [corrupt, reason] of corruptions) {
    const {fetch, calls} = fakeFetch();
    await withProvider({fetch}, async provider => {
      const first = await provider.fetchModel('wooden_stool_01');
      await corrupt(join(first.dir, 'textures/stool_diff_1k.jpg'));
      const before = calls.length;
      const repaired = await provider.fetchModel('wooden_stool_01');
      assert.equal(repaired.status, 'downloaded');
      assert.match(repaired.repaired, reason);
      assert.ok(calls.slice(before).some(call => call.url === TEXTURE_URL));
      assert.deepEqual(await readFile(join(repaired.dir, 'textures/stool_diff_1k.jpg')), texture);
      assert.equal((await provider.fetchModel('wooden_stool_01')).status, 'cached');
    });
  }
});

test('cache revalidation rejects tampered provenance records', async () => {
  const {fetch} = fakeFetch();
  await withProvider({fetch}, async provider => {
    const first = await provider.fetchModel('wooden_stool_01');
    const path = join(first.dir, 'provenance.json');
    const provenance = JSON.parse(await readFile(path, 'utf8'));
    provenance.files[1].sha256 = '0'.repeat(64);
    await writeFile(path, JSON.stringify(provenance));
    assert.match((await provider.fetchModel('wooden_stool_01')).repaired, /SHA-256 mismatch/);
    await writeFile(path, 'not json');
    assert.match((await provider.fetchModel('wooden_stool_01')).repaired, /provenance/);
  });
});

test('redirects are followed manually and only to approved HTTPS hosts', async () => {
  const mirror = `${DL}/mirror/stool_diff_1k.jpg`;
  const {fetch, calls} = fakeFetch({routes:{[TEXTURE_URL]:redirect(mirror), [mirror]:() => new Response(texture)}});
  await withProvider({fetch}, async provider => {
    assert.equal((await provider.fetchModel('wooden_stool_01')).status, 'downloaded');
    assert.ok(calls.some(call => call.url === mirror));
    assert.ok(calls.every(call => call.redirect === 'manual'));
  });
  const unsafe = [
    [{[TEXTURE_URL]:redirect('https://evil.example/stool.jpg')}, /unapproved host: https:\/\/evil/],
    [{[TEXTURE_URL]:redirect('http://dl.polyhaven.org/stool.jpg')}, /unapproved host: http:/],
    [{[TEXTURE_URL]:redirect(TEXTURE_URL)}, /Too many redirects/],
    [{'https://api.polyhaven.com/files/wooden_stool_01':redirect('https://evil.example/files.json')}, /unapproved host/]
  ];
  for (const [routes, error] of unsafe) {
    const {fetch, calls} = fakeFetch({routes});
    await withProvider({fetch}, async (provider, cacheDir) => {
      await assert.rejects(provider.fetchModel('wooden_stool_01'), error);
      assert.ok(!calls.some(call => call.url.includes('evil.example')));
      await assert.rejects(access(join(cacheDir, 'polyhaven', 'wooden_stool_01')));
    });
  }
  // A fetch implementation that silently followed a redirect off-host is caught via response.url
  const followed = Object.defineProperty(new Response(texture), 'url', {value:'https://evil.example/stool.jpg'});
  const offHost = fakeFetch({routes:{[TEXTURE_URL]:() => followed}});
  await withProvider({fetch:offHost.fetch}, async provider => {
    await assert.rejects(provider.fetchModel('wooden_stool_01'), /unapproved host/);
  });
});

test('downloads stream and abort oversized bodies without buffering them', async () => {
  let pulls = 0;
  const endless = () => new Response(new ReadableStream({pull(controller) { pulls++; controller.enqueue(new Uint8Array(4096)); }}));
  const {fetch} = fakeFetch({routes:{[TEXTURE_URL]:endless}});
  await withProvider({fetch}, async (provider, cacheDir) => {
    await assert.rejects(provider.fetchModel('wooden_stool_01'), /more than \d+ bytes received/);
    assert.ok(pulls < 10, `stream was read past the size limit (${pulls} chunks)`);
    await assert.rejects(access(join(cacheDir, 'polyhaven', 'wooden_stool_01')));
  });
  const declared = () => new Response(texture, {headers:{'content-length':'999999'}});
  const second = fakeFetch({routes:{[TEXTURE_URL]:declared}});
  await withProvider({fetch:second.fetch}, async provider => {
    await assert.rejects(provider.fetchModel('wooden_stool_01'), /server declared 999999/);
  });
});

test('multi-chunk streamed downloads are written and hashed correctly', async () => {
  const big = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
  const chunked = () => new Response(new ReadableStream({start(controller) {
    for (let i = 0; i < big.length; i += 65536) controller.enqueue(big.subarray(i, i + 65536));
    controller.close();
  }}));
  const fileTree = files({'textures/big.jpg':{url:TEXTURE_URL, size:big.length, md5:md5(big)}});
  const {fetch} = fakeFetch({fileTree, routes:{[TEXTURE_URL]:chunked}});
  await withProvider({fetch}, async provider => {
    const result = await provider.fetchModel('wooden_stool_01');
    const [, record] = result.provenance.files;
    assert.equal(record.sha256, createHash('sha256').update(big).digest('hex'));
    assert.deepEqual(await readFile(join(result.dir, 'textures/big.jpg')), big);
  });
});
