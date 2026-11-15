import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { buildMechanism, PARTS, DEFAULTS } from '../tools/models/nozzle-internals.mjs';
import { createGeneratedProvider } from '../tools/providers/generated.mjs';
import { convertAsset } from '../tools/convert/pipeline.mjs';

test('nozzle internals: every mechanism part is a named node, the spring and diaphragm have morphs, the pivot rides on the plunger', async () => {
  const {parts, params} = buildMechanism();
  assert.deepEqual(parts.map(p => p.name).sort(), [...PARTS].sort());
  assert.equal(params.bore, DEFAULTS.bore);
  assert.equal(parts.find(p => p.name === 'nozzle/pivot').parent, 'nozzle/plunger');
  // The poppet rests open above its seat by the valve travel; closing moves it down onto the seat
  assert.ok(Math.abs(parts.find(p => p.name === 'nozzle/poppet').origin[1] - (DEFAULTS.valve.seatY + DEFAULTS.valve.open)) < 1e-9);
  // Fitting changes geometry, not the part list
  const fitted = buildMechanism({bore:0.009, chamber:{r:0.015}});
  assert.deepEqual(fitted.parts.map(p => p.name), parts.map(p => p.name));
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-models-'));
  try {
    const provider = createGeneratedProvider({cacheDir:dir});
    const first = await provider.fetchModel('nozzle-internals');
    assert.equal(first.status, 'generated');
    assert.equal(first.provenance.license, 'CC0-1.0'); assert.match(first.provenance.sourceUrl, /^https:\/\/github\.com\/.+nozzle-internals\.mjs$/);
    assert.equal((await provider.fetchModel('nozzle-internals')).status, 'cached');
    const doc = await new NodeIO().read(join(first.dir, 'model.gltf'));
    const names = doc.getRoot().listNodes().map(n => n.getName());
    for (const part of PARTS) assert.ok(names.includes(part), part);
    const morphs = Object.fromEntries(doc.getRoot().listMeshes().filter(m => m.getExtras().targetNames).map(m => [m.getName(), m.getExtras().targetNames]));
    assert.deepEqual(morphs, {'nozzle/spring':['extended'], 'nozzle/diaphragm':['flex']});
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) assert.ok(prim.getAttribute('NORMAL'), `${mesh.getName()} has normals`);
    // It passes the same converter and Khronos validation as downloaded assets
    const converted = await convertAsset(await provider.conversionSource('nozzle-internals'), {outRoot:join(dir, 'converted'), preview:false});
    assert.deepEqual(converted.report.validation.errors, []);
    await assert.rejects(provider.fetchModel('teapot'), /No generator/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
