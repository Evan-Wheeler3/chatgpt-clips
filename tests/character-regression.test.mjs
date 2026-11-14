import {test} from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkCharacter, figureSnapshot, flatSheets, compareImages, LIMITS } from '../tools/characters/regression.mjs';
import { lockStatus } from '../tools/characters/lock.mjs';
import { loadCharacter } from '../tools/characters/load.mjs';
import { findChrome } from '../tools/convert/preview.mjs';

const repo = new URL('..', import.meta.url).pathname;

test('the approved cooper is locked: definition, reference and baselines match metadata.json', async () => {
  const status = await lockStatus('cooper');
  assert.equal(status.versionMatches, true, `design ${status.designVersion} vs locked ${status.lockedVersion}`);
  assert.deepEqual(status.changed, [], 'locked files changed without a design version bump and relock');
});

test('painted geometry matches the approved snapshot, and small edits are caught', async () => {
  const result = await checkCharacter('cooper', {levels:['snapshot']});
  assert.deepEqual(result.levels.snapshot.changed, []);
  const def = await loadCharacter(repo, 'cooper');
  const before = figureSnapshot(def);
  for (const mutate of [d => { d.face.brows.y += 2; }, d => { d.palette.apron = '#A5662E'; }, d => { d.rig.forearm += 1; }]) {
    const changed = structuredClone(def); mutate(changed);
    assert.notDeepEqual(figureSnapshot(changed), before);
  }
});

test('flat painting and the in-scene render match the approved baselines', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const result = await checkCharacter('cooper', {levels:['flat', 'scene']});
  for (const [name, sheet] of Object.entries(result.levels.flat.sheets)) assert.ok(sheet.pass, `flat ${name}: ${JSON.stringify(sheet)}`);
  assert.ok(result.levels.scene.pass, `scene: ${JSON.stringify(result.levels.scene)}`);
});

test('the pixel comparison notices a visible face change', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const def = await loadCharacter(repo, 'cooper');
  def.face.brows.y += 8; def.expressions.neutral.mouth.w += 12;
  const dir = await mkdtemp(join(tmpdir(), 'holdup-regression-'));
  try {
    const {faces} = await flatSheets(def);
    await writeFile(join(dir, 'faces.png'), Buffer.from(faces.split(',')[1], 'base64'));
    const cmp = await compareImages(join(repo, 'characters/cooper/regression/flat-faces.png'), join(dir, 'faces.png'));
    assert.ok(cmp.changedFraction > LIMITS.flat.changedFraction, `changed ${cmp.changedFraction}`);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('production post clamps extreme pixels before bloom', async () => {
  const src = await (await import('node:fs/promises')).readFile(join(repo, 'tools/render/post.mjs'), 'utf8');
  assert.ok(src.indexOf('SanitizeShader)') > 0 && src.indexOf('SanitizeShader)') < src.indexOf('new UnrealBloomPass'));
});
