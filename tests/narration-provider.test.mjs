import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseScript, renderScript, spokenWords, markedPauses } from '../tools/narration/markup.mjs';
import { createLocalClone } from '../tools/narration/providers/local-clone.mjs';
import { synthesize, authorize, SpendNotAuthorized, narratorFor, createProvider, loadVoiceProfile } from '../tools/narration/tts.mjs';
import { installPlan, install, enroll, loadVoice, ENGINES } from '../tools/narration/voice.mjs';
import { alignWords, scriptWords } from '../tools/narration/align.mjs';
import { timingAgreement, pauseReport } from '../tools/narration/narrate.mjs';
import { narrationSync } from '../tools/narration/sync.mjs';
import { prepare, generate, select } from '../tools/narration/audition.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { wordAt } from '../tools/storyboard/sample.mjs';

const run = promisify(execFile);
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const FAKE_WORKER = join(repo, 'tests/fixtures/fake-clone-worker.mjs');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const temp = () => mkdtemp(join(tmpdir(), 'holdup-narration-'));
const story = () => readJson(join(repo, 'stories/barrel-bilge/story.json'));
const tone = async (file, seconds) => run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=180:duration=${seconds}`, '-ac', '1', file]);

// A sandbox with an "installed" engine (manifest only) and an enrolled voice, driven by the fake worker
async function sandbox() {
  const dir = await temp(), voiceDir = join(dir, 'voice'), privateDir = join(dir, 'private');
  await mkdir(voiceDir, {recursive:true});
  await writeFile(join(voiceDir, 'manifest.json'), JSON.stringify({engine:'qwen3-tts', repo:ENGINES['qwen3-tts'].repo, modelDir:join(voiceDir, 'models/x'), packages:{'mlx-audio':'0.0-test'}}));
  const audio = join(dir, 'me.wav');
  await tone(audio, 12);
  await enroll({id:'owner', audio, owner:'Ada Reviewer', consent:'I am Ada; this is my own voice and I permit cloning it', transcript:'This is what my voice sounds like.', privateDir});
  const provider = createLocalClone({python:process.execPath, worker:FAKE_WORKER, voiceDir, privateDir});
  return {dir, voiceDir, privateDir, provider};
}
const PROFILE = {id:'owner', provider:'local-clone', engine:'qwen3-tts', voice:'owner', seed:1873, settings:{temperature:0.8, top_p:0.9}, delivery:{minPauseMs:100}};

test('delivery markup keeps the words; local engines get punctuation beats, the macOS fallback its own markup', async () => {
  const s = (await story()).narration.script;
  assert.deepEqual(spokenWords(s), scriptWords(s), 'markup never changes the spoken words');
  assert.equal(renderScript(s, 'macos-say'), s.replace(/\s+/g, ' ').trim(), 'the development fallback renders the original script');
  assert.equal(renderScript(s, 'punctuation', {minPauseMs:100000}), spokenWords(s).join(' '), 'no added beats: the script as written');
  const beats = renderScript(s, 'punctuation', {minPauseMs:100});
  assert.match(beats, /a name… the bilge\./); assert.match(beats, /easy to roll… and easy/);
  assert.equal((beats.match(/…/g) ?? []).length, 2, 'beats after sentence ends add nothing');
  assert.ok(!/slnc|emph|tone|\[|</.test(beats));
  assert.equal(renderScript('So [[tone amused]] it rolls.', 'punctuation'), 'So it rolls.', 'tones are dropped where the engine has no style control');
  assert.deepEqual(markedPauses(s).map(p => p.ms), [350, 150, 350, 250, 150]);
  assert.equal(parseScript('[[emph +]] big deal').find(t => t.type === 'word').emphasis, true);
});

test('local cloning: the worker gets the reference, transcript, seed and text; unsupported settings are reported, not assumed', async () => {
  const {dir, provider, privateDir} = await sandbox();
  try {
    const out = await synthesize({provider, profile:PROFILE, script:'That curve has a name: [[slnc 150]] the bilge.'}, {cacheDir:join(dir, 'cache'), usageLog:join(dir, 'usage.jsonl')});
    assert.equal(out.cached, false); assert.equal(out.costUsd, 0); assert.match(out.audioPath, /\.wav$/);
    assert.equal(out.renderedText, 'That curve has a name… the bilge.');
    assert.deepEqual(out.response.applied, {top_p:0.9}); assert.deepEqual(out.response.ignored, ['temperature']);
    assert.equal(out.response.refText, 'This is what my voice sounds like.');
    const voice = await loadVoice('owner', privateDir);
    assert.equal(out.request.referenceSha256, voice.reference.sha256, 'the cache key covers the exact reference recording');
    assert.equal(out.request.engineVersion, '0.0-test');
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate', '-of', 'csv=p=0', out.audioPath]);
    assert.equal(stdout.trim(), 'pcm_s16le,24000');
    // Cache: the same request is free and instant; a different setting is a new generation
    const again = await synthesize({provider, profile:PROFILE, script:'That curve has a name: [[slnc 150]] the bilge.'}, {cacheDir:join(dir, 'cache')});
    assert.equal(again.cached, true); assert.equal(again.key, out.key);
    const other = await synthesize({provider, profile:{...PROFILE, settings:{top_p:0.5}}, script:'That curve has a name: [[slnc 150]] the bilge.'}, {cacheDir:join(dir, 'cache')});
    assert.notEqual(other.key, out.key);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('local cloning fails clearly without the engine, without an enrolled voice, or when the model errors', async () => {
  const dir = await temp();
  const {provider, dir:sandboxDir} = await sandbox();
  try {
    const bare = createLocalClone({python:process.execPath, worker:FAKE_WORKER, voiceDir:join(dir, 'none'), privateDir:join(dir, 'private')});
    await assert.rejects(bare.synthesize('hi', PROFILE), /not installed.*voice\.mjs install/);
    await assert.rejects(provider.synthesize('hi', {...PROFILE, voice:'stranger'}), /No enrolled voice "stranger"/);
    process.env.FAKE_WORKER_FAIL = '1';
    try { await assert.rejects(provider.synthesize('hi', PROFILE), /Local voice generation failed: RuntimeError: model exploded/); }
    finally { delete process.env.FAKE_WORKER_FAIL; }
  } finally { await rm(dir, {recursive:true, force:true}); await rm(sandboxDir, {recursive:true, force:true}); }
});

test('enrollment: only the owner\'s voice, with consent, a usable length and a transcript; nothing private is tracked by git', async () => {
  const dir = await temp();
  try {
    const short = join(dir, 'short.wav'), good = join(dir, 'good.wav'), privateDir = join(dir, 'private');
    await tone(short, 2); await tone(good, 8);
    const base = {id:'owner', audio:good, owner:'Ada Reviewer', consent:'This is my own voice and I permit cloning it', transcript:'Hello there.', privateDir};
    await assert.rejects(enroll({...base, owner:'Claude'}), /owner must name/);
    await assert.rejects(enroll({...base, consent:'ok'}), /consent/);
    await assert.rejects(enroll({...base, audio:short}), /use 3-60 s/);
    await assert.rejects(enroll({...base, audio:join(dir, 'missing.wav')}), /not a readable audio/);
    await assert.rejects(enroll({...base, transcript:null}), /--transcript/);
    const voice = await enroll(base);
    assert.equal(voice.reference.sampleRate, 24000); assert.equal(voice.owner, 'Ada Reviewer');
    assert.match(voice.warnings[0], /Short reference/);
    const viaWhisper = await enroll({...base, id:'second', transcript:null, transcribe:async () => 'hello there'});
    assert.match(viaWhisper.transcriptSource, /whisper/);
    assert.equal((await loadVoiceProfile('owner', dir)).provider, 'local-clone', 'enrolled voices are usable profiles');
    const {stdout} = await run('git', ['check-ignore', 'voices/private/owner/reference.wav', '.cache/voice/manifest.json', 'production/narration/auditions/voice-01.wav'], {cwd:repo});
    assert.equal(stdout.trim().split('\n').length, 3, 'recordings, models and generated audio are gitignored');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('install shows the plan and needs --yes', async () => {
  const dir = await temp();
  try {
    const plan = await installPlan('qwen3-tts', {voiceDir:join(dir, 'voice')});
    assert.equal(plan.needGB, +(ENGINES['qwen3-tts'].downloadGB + ENGINES['qwen3-tts'].environmentGB).toFixed(1));
    assert.match(plan.license.weights, /Apache-2\.0/); assert.equal(plan.installed, false);
    const dry = await install({voiceDir:join(dir, 'voice')});
    assert.equal(dry.status, 'plan-only', 'nothing is downloaded without --yes');
    await assert.rejects(installPlan('voxcpm-huge'), /Unknown engine/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('no paid service can run without a named approver and a cap (safety net), and refusals never call it', async () => {
  const dir = await temp();
  let calls = 0;
  const paid = {id:'hypothetical-paid', paid:true, render:s => s, estimate:t => ({characters:t.length, usd:t.length / 1000 * 0.08}), cacheKey:t => ({p:'paid', t}),
    synthesize:async () => { calls++; return {audio:Buffer.from('x'), extension:'wav', words:null, response:null}; }};
  try {
    const opts = {cacheDir:join(dir, 'c'), usageLog:join(dir, 'u.jsonl'), env:{}};
    await assert.rejects(synthesize({provider:paid, profile:{id:'p'}, script:'hello world'}, opts), SpendNotAuthorized);
    assert.throws(() => authorize({by:'Claude', maxUsd:1}), /person/);
    await assert.rejects(synthesize({provider:paid, profile:{id:'p'}, script:'hello world'}, {...opts, authorization:authorize({by:'Ada Reviewer', maxUsd:0.00001})}), /cap/);
    await assert.rejects(synthesize({provider:paid, profile:{id:'p'}, script:'hello world'}, {...opts, env:{HOLDUP_BLOCK_PAID_TTS:'1'}, authorization:authorize({by:'Ada Reviewer', maxUsd:1})}), /blocked/);
    assert.equal(calls, 0);
    await assert.rejects(createProvider('elevenlabs'), /Unknown narration provider/, 'no paid provider is registered');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('the approved narrator is the default voice; until then stories fall back to their development voice', async () => {
  const dir = await temp();
  try {
    await cp(join(repo, 'voices'), dir, {recursive:true, filter:src => !src.includes('/private')});
    const narration = (await story()).narration;
    // Start from an unselected narrator, whatever the repository's current choice is
    const unselected = {...await readJson(join(dir, 'hold-up-narrator.json')), status:'unselected', provider:null, approval:null};
    await writeFile(join(dir, 'hold-up-narrator.json'), JSON.stringify(unselected));
    assert.equal((await narratorFor(narration, dir)).profile.provider, 'macos-say', 'no narrator approved yet');
    await assert.rejects(narratorFor({script:'x'}, dir), /No approved Hold Up narrator/);
    const narrator = await readJson(join(dir, 'hold-up-narrator.json'));
    await writeFile(join(dir, 'hold-up-narrator.json'), JSON.stringify({...narrator, status:'approved', provider:'local-clone', engine:'qwen3-tts', voice:'owner'}));
    const chosen = await narratorFor(narration, dir);
    assert.equal(chosen.profile.voice, 'owner'); assert.match(chosen.reason, /approved Hold Up narrator/);
    await writeFile(join(dir, 'other.json'), JSON.stringify({provider:'macos-say', voiceId:'Alex'}));
    assert.equal((await narratorFor({...narration, voice:{profile:'other'}}, dir)).profile.voiceId, 'Alex', 'a story can name its own voice');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('new narration retimes the storyboard through its word anchors and flags editorial conflicts', async () => {
  const s = await story(), words = await readJson(join(repo, 'production/barrel-bilge/words.json')).catch(() => null);
  if (!words) return; // narration is generated locally (production/ is not in git)
  assert.equal((await narrationSync(s, words, words)).status, 'in-sync');
  // A different delivery: faster overall, but a long pause before "Iron" (not a uniform scale)
  const faster = structuredClone(words), iron = faster.words.findIndex(w => w.text === 'Iron');
  faster.words = words.words.map((w, i) => { const k = 0.85, shift = i >= iron ? 0.6 : 0; return {...w, start:w.start * k + shift, end:w.end * k + shift}; });
  faster.audio = {...words.audio, durationSec:words.audio.durationSec * 0.85 + 0.6};
  const plan = await compileStory(s, faster), report = await narrationSync(s, words, faster);
  const hoops = plan.shots.find(x => x.id === 'hoops'), ironFrame = plan.words[iron].startFrame;
  assert.ok(Math.abs(hoops.startFrame - ironFrame) <= 4, 'the hoops cut follows "Iron", not a uniform rescale');
  assert.notEqual(report.shots.find(x => x.id === 'hoops').ratio, report.shots.find(x => x.id === 'reveal').ratio);
  for (const w of plan.words) assert.equal(wordAt(plan, (w.start + w.end) / 2 * plan.fps).i, w.i, 'captions show each word while it is spoken');
  // (a half-second point on "bilge" fits its shot; a take that rushes from "bilge" into "Iron" pulls the cut inside it)
  const tight = structuredClone(s);
  tight.beats.flatMap(b => b.shots).find(x => x.id === 'profile').events.find(e => e.do === 'pose').duration = 0.5;
  const squeezed = structuredClone(words), bilge = squeezed.words.findIndex(w => w.norm === 'bilge');
  const gap = words.words[bilge + 1].start - words.words[bilge].end;
  squeezed.words = words.words.map((w, i) => i > bilge ? {...w, start:w.start - (gap - 0.04), end:w.end - (gap - 0.04)} : w);
  squeezed.pauses = [{after:'bilge.', markedMs:350, measuredMs:40}];
  assert.ok(!(await narrationSync(tight, words, words)).conflicts.length);
  const squeezedReport = await narrationSync(tight, words, squeezed);
  assert.ok(squeezedReport.conflicts.some(c => c.code === 'ACTION_CROSSES_CUT' && c.shot === 'profile'), JSON.stringify(squeezedReport.conflicts));
  assert.ok(squeezedReport.conflicts.some(c => c.code === 'BEAT_LOST'));
  const edited = structuredClone(words);
  edited.words = words.words.map(w => w.norm === 'iron' ? {...w, text:'Steel', norm:'steel'} : w);
  edited.script = edited.script.replace('Iron', 'Steel');
  const blocked = await narrationSync(s, words, edited);
  assert.equal(blocked.status, 'blocked'); assert.ok(blocked.conflicts.some(c => c.code === 'ANCHOR_MISSING'));
});

test('alignment cross-check, word timestamp integrity and pause measurements', () => {
  const a = [{text:'a', start:0, end:0.2, match:'exact'}, {text:'b', start:0.5, end:0.7, match:'exact'}];
  const b = [{text:'a', start:0.02, end:0.2, match:'exact'}, {text:'b', start:0.5, end:0.74, match:'exact'}];
  const agree = timingAgreement(a, b);
  assert.equal(agree.words, 2); assert.ok(Math.abs(agree.meanAbsSec - 0.015) < 1e-9); assert.ok(Math.abs(agree.maxAbsSec - 0.04) < 1e-9);
  const words = alignWords('Wait [[slnc 400]] for it', [{text:'Wait', start:0, end:0.3}, {text:'for', start:0.75, end:0.9}, {text:'it', start:0.9, end:1}]).words;
  assert.ok(words.every((w, i) => w.start <= w.end && (i === 0 || w.start >= words[i - 1].end)));
  assert.deepEqual(pauseReport('Wait [[slnc 400]] for it', words), [{after:'Wait', markedMs:400, measuredMs:450}]);
});

test('audition: one cloned voice, three delivery variants, honest settings reports; only a person selects the narrator', async () => {
  const {dir, provider, voiceDir, privateDir} = await sandbox();
  const repoNarrator = await readFile(join(repo, 'voices/hold-up-narrator.json'), 'utf8');
  try {
    const out = join(dir, 'auditions'), voicesDir = join(dir, 'voices');
    await cp(join(repo, 'voices'), voicesDir, {recursive:true, filter:src => !src.includes('/private')});
    const waiting = await prepare({outDir:out, voiceDir:join(dir, 'nothing'), privateDir:join(dir, 'nobody')});
    assert.equal(waiting.status, 'waiting'); assert.equal(waiting.missing.length, 2, 'engine and voice both reported missing');
    await assert.rejects(generate({outDir:out, voiceDir:join(dir, 'nothing'), privateDir:join(dir, 'nobody')}), /cannot run yet/);
    const ready = await prepare({outDir:out, provider, voiceDir, privateDir});
    assert.equal(ready.status, 'ready'); assert.equal(ready.costUsd, 0);
    assert.equal(new Set(ready.takes.map(t => t.renderedText)).size, 2, 'the expressive take adds beats; the other two keep the script as written');
    await assert.rejects(select({n:1, by:'Ada Reviewer', outDir:out, voicesDir}), /Generate and listen/);
    const measureTake = async () => ({durationSec:10, wordsPerMinute:180, alignment:{exact:40, scriptWords:40}, beats:[]});
    const report = await generate({outDir:out, provider, voiceDir, privateDir, cacheDir:join(dir, 'cache'), measureTake});
    assert.equal(report.status, 'generated'); assert.equal(report.selection, null, 'generation never selects');
    assert.deepEqual(report.takes.map(t => t.file), ['voice-01.wav', 'voice-02.wav', 'voice-03.wav']);
    assert.deepEqual(report.takes[1].settingsIgnored, ['temperature'], 'an engine without temperature says so');
    assert.match(await readFile(join(out, 'README.md'), 'utf8'), /ignored: temperature/);
    await assert.rejects(select({n:3, by:'claude', outDir:out, voicesDir}), /person/);
    const chosen = await select({n:3, by:'Ada Reviewer', outDir:out, voicesDir});
    assert.equal(chosen.status, 'approved'); assert.equal(chosen.voice, 'owner'); assert.equal(chosen.variant, 'Expressive, comedic timing');
    assert.equal(await readFile(join(repo, 'voices/hold-up-narrator.json'), 'utf8'), repoNarrator, 'the audition sandbox never touches the repository narrator');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('the committed Hold Up narrator, once approved, names its approver and has a sensible pause threshold', async () => {
  const narrator = await readJson(join(repo, 'voices/hold-up-narrator.json'));
  if (narrator.status !== 'approved') return;
  assert.ok(narrator.approval?.by && narrator.approval.takeSha256, 'a person approved a specific audition take');
  assert.equal(narrator.provider, 'local-clone'); assert.ok(narrator.voice);
  // minPauseMs: marked beats at least this long become spoken pauses; conversational values sit between quick beats and long silences
  assert.ok(narrator.delivery.minPauseMs >= 150 && narrator.delivery.minPauseMs <= 1000, `delivery.minPauseMs ${narrator.delivery.minPauseMs} ms`);
});

test('forced alignment: the known script is measured, and words shorter than the aligner step still get a span', async () => {
  const { resolveSubStepWords, forcedAlign, ALIGNER_STEP_SEC } = await import('../tools/narration/forced-align.mjs');
  // "a" comes back with zero length between "has" and "name" (the aligner reports on a 0.08 s step)
  const fixed = resolveSubStepWords([{text:'has', start:3.52, end:3.68}, {text:'a', start:3.68, end:3.68}, {text:'name', start:3.68, end:4.16}]);
  assert.deepEqual(fixed.map(w => [w.text, w.start, w.end]), [['has', 3.52, 3.68], ['a', 3.68, 3.72], ['name', 3.72, 4.16]]);
  assert.equal(fixed[1].timing, 'within-aligner-step');
  assert.ok(Math.abs(fixed[2].start - 3.68) <= ALIGNER_STEP_SEC / 2 + 1e-9, 'no boundary moves more than half a step');
  const last = resolveSubStepWords([{text:'the', start:11.68, end:11.76}, {text:'spot', start:11.76, end:11.76}]);
  assert.deepEqual(last.map(w => [w.start, w.end]), [[11.68, 11.72], [11.72, 11.76]], 'a final zero-length word borrows from the word before');
  // Worker protocol: request with the local model and the plain script; JSON words back; errors surface clearly
  const dir = await temp();
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({aligner:{repo:'mlx-community/Qwen3-ForcedAligner-0.6B-8bit', modelDir:'/models/aligner'}}));
    let seen;
    const runner = async (python, args) => { seen = JSON.parse(await readFile(args[2], 'utf8')); return {stdout:JSON.stringify({engineVersion:'0.0-test', words:[{text:'Hi', start:0.08, end:0.24}, {text:'a', start:0.24, end:0.24}, {text:'there', start:0.24, end:0.56}]})}; };
    const result = await forcedAlign('/tmp/a.wav', 'Hi a there', {voiceDir:dir, python:'python', runner});
    assert.deepEqual(seen, {model:'/models/aligner', audio:'/tmp/a.wav', text:'Hi a there', language:'English'});
    assert.ok(result.words.every(w => w.end > w.start), 'every word has a span');
    assert.equal(result.engine.name, 'qwen3-forced-aligner');
    await assert.rejects(forcedAlign('/tmp/a.wav', 'x', {voiceDir:dir, python:'python', runner:async () => { throw Object.assign(new Error('boom'), {stderr:'{"error":"RuntimeError: bad audio"}'}); }}), /Forced alignment failed/);
    await assert.rejects(forcedAlign('/tmp/a.wav', 'x', {voiceDir:join(dir, 'none')}), /not installed/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
