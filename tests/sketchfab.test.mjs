import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { createSketchfabProvider, licenseProblem, attributionText } from '../tools/providers/sketchfab.mjs';
import { listZip, extractZip } from '../tools/providers/zip.mjs';

const NOW = Date.parse('2026-11-14T00:00:00Z');
const UID = '5343a980106c41609a4ba34786d8a088', OTHER = '0f33ac7f1d0b4e8ab6127cb50f7f5963';
const LIC = {
  by:{slug:'by', label:'CC Attribution', url:'http://creativecommons.org/licenses/by/4.0/', requirements:'Author must be credited. Commercial use is allowed.'},
  cc0:{slug:'cc0', label:'CC0 Public Domain', url:'http://creativecommons.org/publicdomain/zero/1.0/'},
  st:{slug:'st', label:'Standard', url:'https://sketchfab.com/licenses'},
  ed:{slug:'ed', label:'Editorial', url:'https://sketchfab.com/licenses'},
  'free-st':{slug:'free-st', label:'Free Standard', url:'https://sketchfab.com/licenses'},
  'by-nc':{slug:'by-nc', label:'CC Attribution-NonCommercial', url:'http://creativecommons.org/licenses/by-nc/4.0/'},
  'by-nd':{slug:'by-nd', label:'CC Attribution-NoDerivs', url:'http://creativecommons.org/licenses/by-nd/4.0/'},
  'by-sa':{slug:'by-sa', label:'CC Attribution-ShareAlike', url:'http://creativecommons.org/licenses/by-sa/4.0/'}
};
const record = (overrides = {}) => ({
  uid:UID, name:'Gas Pump Nozzle', viewerUrl:`https://sketchfab.com/3d-models/gas-pump-nozzle-${UID}`,
  isDownloadable:true, isAgeRestricted:false, price:null, license:LIC.by, updatedAt:'2021-10-24T10:00:00.000Z',
  user:{username:'ghostbusterjeffrey', displayName:'ghostbusterjeffrey', profileUrl:'https://sketchfab.com/ghostbusterjeffrey'},
  tags:[{name:'gas'}, {name:'nozzle'}], categories:[], faceCount:10214, description:'A fuel nozzle.', likeCount:50,
  thumbnails:{images:[{width:1024, url:'https://media.sketchfab.com/t/1024.jpeg'}]}, ...overrides
});

// Minimal ZIP writer for fixtures: stored or deflated entries, optional unix mode and forced bad CRC
function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const {name, data = Buffer.alloc(0), deflate = true, mode = 0o100644, badCrc = false, flags = 0} of entries) {
    const body = deflate ? deflateRawSync(data) : data, nameBuf = Buffer.from(name);
    const crc = badCrc ? (crc32(data) ^ 1) >>> 0 : crc32(data), method = deflate ? 8 : 0;
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE((3 << 8) | 20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16); central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body); centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
const gltf = Buffer.from('{"asset":{"version":"2.0"},"buffers":[{"uri":"scene.bin","byteLength":4}]}');
const goodZip = () => makeZip([{name:'scene.gltf', data:gltf}, {name:'scene.bin', data:Buffer.from([1, 2, 3, 4])},
  {name:'textures/', data:Buffer.alloc(0), deflate:false}, {name:'textures/base.png', data:Buffer.from('png-bytes')},
  {name:'license.txt', data:Buffer.from('Model by ghostbusterjeffrey, CC-BY-4.0')}]);

const ARCHIVE = 'https://sketchfab-prod-media.s3.amazonaws.com/archives/x/gltf.zip?sig=abc';
function fakeFetch({records = {[UID]:record()}, searches = {}, download = {gltf:{url:ARCHIVE, size:null, expires:300}}, archive = goodZip(), status = {}} = {}) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({url, auth:options?.headers?.Authorization ?? null, redirect:options?.redirect});
    const json = data => new Response(JSON.stringify(data), {status:200});
    const u = new URL(url);
    if (u.hostname === 'api.sketchfab.com' && u.pathname === '/v3/search') return json({results:searches[u.searchParams.get('license')] ?? []});
    const dl = u.pathname.match(/^\/v3\/models\/([0-9a-f]{32})\/download$/);
    if (dl) {
      if (status.download) return new Response('{}', {status:status.download});
      if (!options?.headers?.Authorization) return new Response('{"detail":"Authentication credentials were not provided."}', {status:401});
      return json({...download, gltf:download.gltf && {...download.gltf, size:download.gltf.size ?? archive.length}});
    }
    const m = u.pathname.match(/^\/v3\/models\/([0-9a-f]{32})$/);
    if (m) return records[m[1]] ? json(records[m[1]]) : new Response('{}', {status:404});
    if (url === ARCHIVE || u.hostname === 'evil.example') return new Response(archive);
    return new Response('missing', {status:404});
  };
  return {fetch, calls};
}

async function withProvider(options, run) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'hold-up-sketchfab-'));
  try { await run(createSketchfabProvider({cacheDir, now:() => NOW, token:'test-token', ...options}), cacheDir); }
  finally { await rm(cacheDir, {recursive:true, force:true}); }
}

test('license gate: only downloadable CC0 and CC BY 4.0 models pass; everything restricted is refused', () => {
  assert.equal(licenseProblem(record()), null);
  assert.equal(licenseProblem(record({license:LIC.cc0})), null);
  for (const slug of ['st', 'ed', 'free-st', 'by-nc', 'by-nd', 'by-sa']) assert.match(licenseProblem(record({license:LIC[slug]})), /not allowed/, slug);
  assert.match(licenseProblem(record({isDownloadable:false})), /view-only/);
  assert.match(licenseProblem(record({isAgeRestricted:true})), /age-restricted/);
  assert.match(licenseProblem(record({price:4.99})), /store/);
  assert.match(licenseProblem(record({license:{...LIC.by, url:'http://creativecommons.org/licenses/by/3.0/'}})), /does not match/);
  assert.match(licenseProblem(record({license:null})), /not allowed/);
});

test('attribution text names title, author, source and license (CC BY 4.0 section 3(a))', () => {
  assert.equal(attributionText(record()),
    `"Gas Pump Nozzle" by ghostbusterjeffrey (https://sketchfab.com/ghostbusterjeffrey), https://sketchfab.com/3d-models/gas-pump-nozzle-${UID}, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)`);
});

test('search needs no token, filters to CC0/CC BY and re-verifies each candidate from its own record', async () => {
  const restricted = record({uid:OTHER, name:'Gas Pump Nozzle Pro', license:LIC.st});
  const {fetch, calls} = fakeFetch({records:{[UID]:record(), [OTHER]:restricted},
    searches:{by:[record(), restricted /* a stale search hit whose record says Standard */]}});
  await withProvider({fetch, token:undefined}, async provider => {
    const found = await provider.search({query:'gas nozzle'});
    assert.deepEqual(found.map(c => c.id), [UID]);
    const [c] = found;
    assert.equal(c.license, 'CC-BY-4.0'); assert.equal(c.licenseVerified, true); assert.equal(c.attributionRequired, true);
    assert.match(c.credit, /ghostbusterjeffrey/); assert.ok(c.warnings.some(w => /Attribution required/.test(w)));
    const searchCalls = calls.filter(call => call.url.includes('/v3/search'));
    assert.deepEqual(searchCalls.map(call => new URL(call.url).searchParams.get('license')), ['cc0', 'by']);
    assert.ok(searchCalls.every(call => new URL(call.url).searchParams.get('downloadable') === 'true'));
    assert.ok(calls.every(call => call.auth === null), 'search never sends the token');
  });
});

test('brand names are flagged', async () => {
  const shell = record({name:'Shell Self-Service Gas Pump'});
  const {fetch} = fakeFetch({records:{[UID]:shell}, searches:{by:[shell]}});
  await withProvider({fetch}, async provider => {
    const [c] = await provider.search({query:'gas pump'});
    assert.ok(c.warnings.some(w => /real brand/.test(w)));
  });
});

test('restricted models are refused before any download request', async () => {
  for (const overrides of [{license:LIC.st}, {license:LIC.ed}, {isDownloadable:false}, {license:LIC['by-nc']}]) {
    const {fetch, calls} = fakeFetch({records:{[UID]:record(overrides)}});
    await withProvider({fetch}, async provider => {
      await assert.rejects(provider.fetchModel(UID), /refused/);
      assert.ok(!calls.some(call => call.url.includes('/download')), 'no download endpoint call');
    });
  }
});

test('download needs a token; without one nothing is requested', async () => {
  const {fetch, calls} = fakeFetch();
  await withProvider({fetch, token:undefined}, async provider => {
    await assert.rejects(provider.fetchModel(UID), /SKETCHFAB_API_TOKEN/);
    assert.ok(!calls.some(call => call.url.includes('/download')));
  });
});

test('fetch extracts a verified archive with provenance, attribution and license evidence, then serves the cache', async () => {
  const {fetch, calls} = fakeFetch();
  await withProvider({fetch}, async (provider, cacheDir) => {
    const first = await provider.fetchModel(UID);
    assert.equal(first.status, 'downloaded');
    const p = first.provenance;
    assert.equal(p.license, 'CC-BY-4.0'); assert.equal(p.licenseSlug, 'by'); assert.equal(p.entry, 'scene.gltf');
    assert.equal(p.attribution.required, true); assert.match(p.attribution.text, /CC BY 4.0/);
    assert.equal(p.archiveLicenseText, 'Model by ghostbusterjeffrey, CC-BY-4.0');
    assert.deepEqual(p.files.map(f => f.path).sort(), ['license.txt', 'scene.bin', 'scene.gltf', 'textures/base.png']);
    assert.ok(p.files.every(f => /^[0-9a-f]{64}$/.test(f.sha256)));
    assert.match(p.archive.sha256, /^[0-9a-f]{64}$/);
    // The token goes to the API only; the pre-signed archive URL gets no Authorization header
    assert.equal(calls.find(c => c.url.endsWith('/download')).auth, 'Token test-token');
    assert.equal(calls.find(c => c.url === ARCHIVE).auth, null);
    assert.deepEqual(await readdir(join(cacheDir, 'sketchfab', '.partial')), []);
    assert.ok(!JSON.stringify(p).includes('test-token'), 'token never recorded');

    const source = await provider.conversionSource(UID);
    assert.equal(source.fetchStatus, 'cached');
    assert.equal(source.attribution.credit, p.attribution.text);
    assert.equal(source.attribution.license, 'CC-BY-4.0');
    assert.equal(calls.filter(c => c.url === ARCHIVE).length, 1, 'cache hit downloads nothing');

    // Tampering is detected and repaired from a verified redownload
    await writeFile(join(first.dir, 'scene.bin'), 'tampered');
    const repaired = await provider.fetchModel(UID);
    assert.equal(repaired.status, 'downloaded'); assert.match(repaired.repaired, /mismatch/);
    assert.deepEqual([...await readFile(join(first.dir, 'scene.bin'))], [1, 2, 3, 4]);
  });
});

test('API errors and off-host download links are refused', async () => {
  for (const [code, pattern] of [[400, /not downloadable/], [401, /token/], [429, /rate limited/]]) {
    const {fetch} = fakeFetch({status:{download:code}});
    await withProvider({fetch}, async provider => { await assert.rejects(provider.fetchModel(UID), pattern); });
  }
  const {fetch} = fakeFetch({download:{gltf:{url:'https://evil.example/a.zip', size:10}}});
  await withProvider({fetch}, async (provider, cacheDir) => {
    await assert.rejects(provider.fetchModel(UID), /unapproved host/);
    assert.deepEqual(await readdir(join(cacheDir, 'sketchfab', '.partial')), []);
  });
  await withProvider({fetch:fakeFetch().fetch}, async provider => { await assert.rejects(provider.fetchModel('../etc'), /Invalid/); });
});

test('archives with a declared size the download exceeds are rejected', async () => {
  const {fetch} = fakeFetch({download:{gltf:{url:ARCHIVE, size:10}}});
  await withProvider({fetch}, async provider => { await assert.rejects(provider.fetchModel(UID), /larger than/); });
});

test('zip extraction refuses unsafe archives', async () => {
  const bad = [
    [[{name:'../evil.txt', data:Buffer.from('x')}], /Unsafe path/],
    [[{name:'/abs.txt', data:Buffer.from('x')}], /Unsafe path/],
    [[{name:'a\\b.txt', data:Buffer.from('x')}], /Unsafe path/],
    [[{name:'link', data:Buffer.from('/etc/passwd'), mode:0o120777}], /Symbolic link/],
    [[{name:'a.txt', data:Buffer.from('x')}, {name:'A.TXT', data:Buffer.from('y')}], /Duplicate/],
    [[{name:'a.txt', data:Buffer.from('x'), flags:1}], /Encrypted/],
    [[{name:'bomb.bin', data:Buffer.alloc(4 * 1024 * 1024)}], /zip bomb/]
  ];
  for (const [entries, pattern] of bad) assert.throws(() => listZip(makeZip(entries)), pattern);
  assert.throws(() => listZip(makeZip([{name:'big.bin', data:Buffer.alloc(2048), deflate:false}]), {maxBytes:1024}), /limit/);
  assert.throws(() => listZip(Buffer.from('not a zip at all, definitely not')), /Not a ZIP/);
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-zip-'));
  try {
    await writeFile(join(dir, 'crc.zip'), makeZip([{name:'a.txt', data:Buffer.from('hello'), badCrc:true}]));
    await assert.rejects(extractZip(join(dir, 'crc.zip'), join(dir, 'out')), /CRC mismatch/);
    await writeFile(join(dir, 'ok.zip'), goodZip());
    const files = await extractZip(join(dir, 'ok.zip'), join(dir, 'ok'));
    assert.equal(files.length, 4);
    assert.equal(await readFile(join(dir, 'ok', 'scene.gltf'), 'utf8'), gltf.toString());
  } finally { await rm(dir, {recursive:true, force:true}); }
});
