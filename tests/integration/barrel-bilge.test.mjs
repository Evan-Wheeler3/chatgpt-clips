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
import { renderQA } from '../../tools/render/qa.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const enabled = process.env.HOLDUP_INTEGRATION === '1';

// Real demo: macOS TTS, whisper.cpp alignment, catalog GLBs (run assets:convert/register first), Chrome render
test('barrel-bilge: narrate, align, compile, validate and render the animatic', {skip:!enabled && 'set HOLDUP_INTEGRATION=1 (npm run test:integration)', timeout:600000}, async () => {
  const story = JSON.parse(await readFile(join(root, 'stories/barrel-bilge/story.json'), 'utf8'));
  for (const id of ['polyhaven-wine-barrel-01', 'polyhaven-wooden-crate-01', 'polyhaven-wooden-bucket-01', 'polyhaven-wooden-lantern-01', 'polyhaven-woodentable-01', 'polyhaven-wooden-ladder-02']) {
    await access(join(root, `assets/library/${id}.glb`)).catch(() => assert.fail(`${id}.glb is not in assets/library; convert and register it first`));
  }
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-demo-'));
  try {
    const words = await narrate({slug:story.slug, narration:story.narration, outDir:dir});
    assert.ok(words.quality.exactRatio >= 0.9, JSON.stringify(words.quality));
    assert.equal(words.quality.unaligned, 0);
    assert.ok(words.audio.durationSec >= 10 && words.audio.durationSec <= 15);
    // Whisper reports speech islands; the forced aligner (Phase 6.1) times the known script directly, so check its bounds instead
    if (words.islands) for (const word of words.words) assert.ok(words.islands.some(island => word.start >= island.start && word.end <= island.end), `${word.text} is inside measured speech`);
    else {
      assert.equal(words.aligner.name, 'qwen3-forced-aligner');
      words.words.forEach((word, i) => assert.ok(word.start >= 0 && word.end > word.start && word.end <= words.audio.durationSec + 1e-6 && (!i || word.start >= words.words[i - 1].start), `${word.text} is timed inside the audio`));
    }

    const plan = await compileStory(story, words);
    const validation = validatePlan(plan);
    assert.equal(validation.status, 'pass', JSON.stringify(validation.errors));
    // Regressions from the animatic reviews: no cut jumps (contact->roll, profile->hoops) and no dead starts (roll, turn).
    // The approved cooper production (Phases 5.4-6.2) renders with exactly these reviewed character framing warnings;
    // anything new fails the regression
    assert.deepEqual(validation.warnings.map(w => `${w.code}:${w.shot}`), ['CHARACTER_HEAD_CROPPED:reveal', 'CHARACTER_STRAY_LIMB:profile', 'CHARACTER_HEAD_CROPPED:profile']);
    for (const cut of validation.cuts) assert.ok(cut.scaleRatio <= 1.5 && cut.shiftNdc <= 0.35, JSON.stringify(cut));
    for (const id of ['roll', 'turn']) {
      const shot = plan.shots.find(s => s.id === id);
      assert.equal(plan.props[0].actions.find(a => a.shot === id && a.type !== 'set').startFrame, shot.startFrame, `${id} action starts on its cut`);
    }
    assert.deepEqual(plan.missingAssets, []);

    const result = await renderAnimatic(plan, {outDir:dir, audioPath:join(dir, 'narration.wav'), scale:1 / 6});
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', result.video]);
    assert.deepEqual(stdout.trim().split('\n').sort(), ['audio', 'video']);
    assert.equal(result.loadedProps, 3);
    assert.equal(result.characters, 1);

    // Phase 5: the styled preview builds the environment and character without load errors and within budget
    assert.equal(plan.environment.id, 'cooperage-storehouse');
    assert.deepEqual(plan.environment.missing, []);
    const qa = await renderQA(plan, {quality:'preview'});
    assert.notEqual(qa.status, 'failed', JSON.stringify(qa.errors));
    assert.ok(qa.summary.maxTriangles <= qa.summary.budget.triangles && qa.summary.maxDrawCalls <= qa.summary.budget.drawCalls, JSON.stringify(qa.summary));
    assert.ok(qa.summary.lumaMin > 0.12, `darkest sampled frame ${qa.summary.lumaMin}`);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
