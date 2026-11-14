import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { createPolyHavenProvider } from '../../tools/providers/polyhaven.mjs';
import { convertAsset } from '../../tools/convert/pipeline.mjs';
import { findChrome } from '../../tools/convert/preview.mjs';
import { registerAsset } from '../../tools/convert/register.mjs';
import { resolveAssets } from '../../tools/asset-resolver.mjs';

// Real end-to-end run: live Poly Haven API (or the verified local cache), real conversion, real Three.js in Chrome
const enabled = process.env.HOLDUP_INTEGRATION === '1';

test('painted_wooden_stool: fetch, convert, validate, render in Three.js, register, resolve', {skip:!enabled && 'set HOLDUP_INTEGRATION=1 (npm run test:integration)', timeout:180000}, async () => {
  assert.ok(await findChrome(), 'Chrome/Chromium is required; set CHROME_PATH');
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-integration-'));
  try {
    const source = await createPolyHavenProvider().conversionSource('painted_wooden_stool', {resolution:'1k'});
    assert.equal(source.attribution.license, 'CC0-1.0');
    const result = await convertAsset(source, {outRoot:join(dir, 'converted'), force:true});
    const {report} = result;
    assert.equal(result.status, 'converted', report.validation.errors.join('; '));
    assert.equal(report.validation.checks.khronos.errors, 0);
    assert.ok(report.validation.checks.scale.maxRelativeError < 0.02);
    assert.ok(Math.abs(report.validation.checks.orientation.groundOffsetM) < 0.01);

    const document = await new NodeIO().readBinary(await readFile(join(result.dir, 'model.glb')));
    const root = document.getRoot();
    assert.equal(root.listTextures().length, 3);
    assert.ok(root.listTextures().every(texture => texture.getImage()?.byteLength > 0 && !texture.getURI()));
    assert.equal(root.getAsset().extras.holdUp.sourceUrl, 'https://polyhaven.com/a/painted_wooden_stool');

    const three = report.threejs;
    assert.equal(three.triangles, report.validation.checks.geometry.triangles);
    assert.deepEqual(three.textures.map(texture => texture.slot).sort(), ['map', 'metalnessMap', 'normalMap', 'roughnessMap']);
    assert.ok(three.textures.every(texture => texture.width === 1024 && texture.height === 1024));
    assert.equal(three.textures.find(texture => texture.slot === 'map').colorSpace, 'srgb');

    const catalogPath = join(dir, 'catalog.json');
    await writeFile(catalogPath, JSON.stringify({version:1, assets:[]}));
    const registered = await registerAsset(join(result.dir, 'report.json'), {approve:true, approvedBy:'integration test', catalogPath, libraryDir:join(dir, 'assets/library'), rootDir:dir});
    assert.equal(registered.entry.creator, 'Kirill Sannikov');
    const [resolved] = await resolveAssets([{id:'stool', query:'painted wooden stool', style:'realistic'}], {catalogPath, rootDir:dir});
    assert.equal(resolved.status, 'found');
    assert.equal(resolved.candidates[0].id, 'polyhaven-painted-wooden-stool');
  } finally { await rm(dir, {recursive:true, force:true}); }
});
