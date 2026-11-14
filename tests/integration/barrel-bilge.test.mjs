import {test} from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate } from '../../tools/narration/narrate.mjs';
import { compileStory } from '../../tools/storyboard/compile.mjs';
import { validatePlan } from '../../tools/storyboard/validate.mjs';
import { renderAnimatic } from '../../tools/storyboard/animatic.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.HOLDUP_INTEGRATION === '1';

// Real demo: macOS TTS, whisper.cpp alignment, catalog GLBs (run assets:convert/register first), Chrome render
test('barrel-bilge: narrate, align, compile, validate and render the animatic', {skip:!enabled && 'set HOLDUP_INTEGRATION=1 (npm run test:integration)', timeout:600000}, async () => {
  const story = JSON.parse(await readFile(join(root, 'stories/barrel-bilge/story.json'), 'utf8'));
  for (const id of ['polyhaven-wine-barrel-01', 'polyhaven-wooden-crate-01', 'polyhaven-wooden-bucket-01']) {
    await access(join(root, `assets/library/${id}.glb`)).catch(() => assert.fail(`${id}.glb is not in assets/library; convert and register it first`));
  }
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-demo-'));
  try {
    const words = await narrate({slug:story.slug, narration:story.narration, outDir:dir});
    assert.ok(words.quality.exactRatio >= 0.9, JSON.stringify(words.quality));
    assert.equal(words.quality.unaligned, 0);
    assert.ok(words.audio.durationSec >= 10 && words.audio.durationSec <= 15);
    for (const word of words.words) assert.ok(words.islands.some(island => word.start >= island.start && word.end <= island.end), `${word.text} is inside measured speech`);

    const plan = await compileStory(story, words);
    const validation = validatePlan(plan);
    assert.equal(validation.status, 'pass', JSON.stringify(validation.errors));
    assert.deepEqual(plan.missingAssets, []);

    const result = await renderAnimatic(plan, {outDir:dir, audioPath:join(dir, 'narration.wav'), scale:1 / 6});
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', result.video]);
    assert.deepEqual(stdout.trim().split('\n').sort(), ['audio', 'video']);
    assert.equal(result.loadedProps, 3);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
