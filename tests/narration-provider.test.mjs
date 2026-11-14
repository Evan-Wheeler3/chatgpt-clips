import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, mkdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnv, redact } from '../tools/narration/env.mjs';
import { parseScript, renderScript, spokenWords, markedPauses } from '../tools/narration/markup.mjs';
import { createElevenLabs, wordsFromAlignment, ProviderError, markupTarget, PRICING } from '../tools/narration/providers/elevenlabs.mjs';
import { synthesize, authorize, SpendNotAuthorized, narratorFor, createProvider } from '../tools/narration/tts.mjs';
import { alignWords, scriptWords } from '../tools/narration/align.mjs';
import { timingAgreement, pauseReport } from '../tools/narration/narrate.mjs';
import { narrationSync } from '../tools/narration/sync.mjs';
import { prepare, generate, select } from '../tools/narration/audition.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { wordAt } from '../tools/storyboard/sample.mjs';

const run = promisify(execFile);
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const temp = () => mkdtemp(join(tmpdir(), 'holdup-narration-'));
const story = () => readJson(join(repo, 'stories/barrel-bilge/story.json'));
const PROFILE = {id:'audition-01', provider:'elevenlabs', voiceId:'voice123', modelId:'eleven_multilingual_v2', settings:{stability:0.4, similarity_boost:0.75, style:0.3, use_speaker_boost:true, speed:1}, delivery:{minPauseMs:300, pauseScale:0.6}};

// ElevenLabs-shaped character alignment for a text, at a steady pace, with markup characters included
function fakeAlignment(text, perChar = 0.05) {
  const characters = [...text];
  return {characters, character_start_times_seconds:characters.map((_, i) => +(i * perChar).toFixed(3)), character_end_times_seconds:characters.map((_, i) => +((i + 1) * perChar).toFixed(3))};
}
// A mock fetch that records calls and answers like the API
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => { calls.push({url, init}); return handler(url, init, calls.length); };
  fn.calls = calls;
  return fn;
}
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json', ...headers}});
let mp3;
async function realMp3() {
  if (mp3) return mp3;
  const dir = await temp(), file = join(dir, 'tone.mp3');
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=2', '-ac', '1', file]);
  mp3 = await readFile(file); await rm(dir, {recursive:true, force:true});
  return mp3;
}
const ttsOk = async (url, init) => {
  const body = JSON.parse(init.body);
  return json(200, {audio_base64:(await realMp3()).toString('base64'), alignment:fakeAlignment(body.text)}, {'request-id':'req-1', 'character-cost':String(body.text.length)});
};

test('configuration: .env loading, redaction, and a clear missing-key error', async () => {
  const dir = await temp();
  try {
    await writeFile(join(dir, '.env'), '# comment\nELEVENLABS_API_KEY="sk_test_123456"\nOTHER=1\n');
    const env = {OTHER:'keep'};
    await loadEnv(join(dir, '.env'), env);
    assert.equal(env.ELEVENLABS_API_KEY, 'sk_test_123456'); assert.equal(env.OTHER, 'keep', 'existing variables win');
    assert.equal(redact('sk_test_123456'), '**********3456'); assert.equal(redact(undefined), '(not set)');
    const fetch = mockFetch(ttsOk);
    const provider = createElevenLabs({apiKey:undefined, fetch});
    await assert.rejects(provider.synthesize('hello', PROFILE), e => e.code === 'missing-key' && /\.env/.test(e.message));
    assert.equal(fetch.calls.length, 0);
    await assert.rejects(createProvider('nope'), /Unknown narration provider/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('delivery markup keeps the words and renders pauses, emphasis and tones per provider', async () => {
  const s = (await story()).narration.script;
  assert.deepEqual(spokenWords(s), scriptWords(s), 'markup never changes the spoken words');
  assert.equal(renderScript(s, 'macos-say'), s.replace(/\s+/g, ' ').trim(), 'the macOS fallback renders the original script');
  const ssml = renderScript(s, 'ssml-break', {minPauseMs:300, pauseScale:0.6});
  assert.equal((ssml.match(/<break time="0\.21s" \/>/g) ?? []).length, 2, 'only the deliberate 350 ms pauses survive, scaled');
  assert.ok(!/slnc|emph/.test(ssml));
  const tagged = renderScript('So [[tone amused]] it rolls. [[slnc 600]] Easy.', 'audio-tags');
  assert.equal(tagged, 'So [amused] it rolls.… Easy.'.replace('rolls.…', 'rolls.'), 'v3/v4: audio tags, no break tags, sentence punctuation left alone');
  assert.equal(renderScript('Wait [[slnc 600]] for it.', 'audio-tags'), 'Wait… for it.');
  assert.equal(markupTarget('eleven_v3'), 'audio-tags'); assert.equal(markupTarget('eleven_multilingual_v2'), 'ssml-break');
  assert.deepEqual(markedPauses(s).map(p => p.ms), [350, 150, 350, 250, 150]);
  assert.equal(parseScript('[[emph +]] big deal').find(t => t.type === 'word').emphasis, true);
});

test('ElevenLabs requests follow the documented endpoint, and character timestamps become word timestamps', async () => {
  const fetch = mockFetch(ttsOk);
  const provider = createElevenLabs({apiKey:'sk_test_123456', fetch});
  const text = provider.render((await story()).narration.script, PROFILE);
  const result = await provider.synthesize(text, PROFILE);
  const {url, init} = fetch.calls[0];
  assert.equal(url, 'https://api.elevenlabs.io/v1/text-to-speech/voice123/with-timestamps?output_format=mp3_44100_128');
  assert.equal(init.method, 'POST'); assert.equal(init.headers['xi-api-key'], 'sk_test_123456');
  const body = JSON.parse(init.body);
  assert.equal(body.model_id, 'eleven_multilingual_v2'); assert.equal(body.text, text);
  assert.deepEqual(body.voice_settings, PROFILE.settings);
  assert.equal(result.response.requestId, 'req-1');
  // Break tags are not words; every script word is aligned exactly, in order, with start <= end
  assert.ok(!result.words.some(w => /break|time=/.test(w.text)));
  const aligned = alignWords((await story()).narration.script, result.words);
  assert.equal(aligned.quality.exact, aligned.quality.scriptWords);
  assert.ok(aligned.words.every((w, i) => w.start <= w.end && (i === 0 || w.start >= aligned.words[i - 1].end)));
  // Alignment accuracy: word boundaries equal the characters' measured times
  const words = wordsFromAlignment(fakeAlignment('Hi [amused] there <break time="0.2s" /> friend', 0.1));
  assert.deepEqual(words.map(w => [w.text, w.start, w.end]), [['Hi', 0, 0.2], ['there', 1.2, 1.7], ['friend', 4, 4.6]]);
});

test('provider errors are explained, retryable where it makes sense, and never echo the key', async () => {
  const cases = [
    [401, {detail:{status:'invalid_api_key', message:'Invalid API key'}}, 'auth', false],
    [422, {detail:[{loc:['body', 'text'], msg:'field required', type:'missing'}]}, 'validation', false],
    [429, {detail:{status:'too_many_concurrent_requests', message:'Too many requests'}}, 'rate-limit', true],
    [401, {detail:{status:'quota_exceeded', message:'This request exceeds your quota of credits'}}, 'quota', true],
    [503, {detail:'unavailable'}, 'server', true]
  ];
  for (const [status, body, code, retryable] of cases) {
    const provider = createElevenLabs({apiKey:'sk_secret_9999', fetch:mockFetch(() => json(status, body))});
    const error = await provider.synthesize('hi', PROFILE).catch(e => e);
    assert.ok(error instanceof ProviderError, `${status}`);
    if (code !== 'quota') assert.equal(error.code, code); else assert.ok(['quota', 'auth'].includes(error.code));
    if (code !== 'quota') assert.equal(error.retryable, retryable);
    assert.ok(!error.message.includes('sk_secret_9999'));
  }
  const offline = createElevenLabs({apiKey:'k', fetch:async () => { throw new Error('ENOTFOUND'); }});
  assert.equal((await offline.synthesize('hi', PROFILE).catch(e => e)).code, 'network');
  assert.throws(() => createElevenLabs({apiKey:'k'}).estimate('hi', {...PROFILE, modelId:'eleven_mystery'}), /No published price/);
});

test('paid requests need a named approver and a cap; refusals never reach the network; the cache makes repeats free', async () => {
  const dir = await temp();
  try {
    const fetch = mockFetch(ttsOk);
    const provider = createElevenLabs({apiKey:'sk_test', fetch});
    const req = {provider, profile:PROFILE, script:'Why do wooden barrels bulge in the middle?'};
    const opts = {cacheDir:join(dir, 'cache'), usageLog:join(dir, 'usage.jsonl'), env:{}};
    await assert.rejects(synthesize(req, opts), SpendNotAuthorized);
    assert.throws(() => authorize({by:'Claude', maxUsd:1}), /person/);
    assert.throws(() => authorize({by:'Ada Reviewer', maxUsd:0}), /cap/);
    await assert.rejects(synthesize(req, {...opts, authorization:authorize({by:'Ada Reviewer', maxUsd:0.0001})}), /exceed the approved cap/);
    await assert.rejects(synthesize(req, {...opts, env:{HOLDUP_BLOCK_PAID_TTS:'1'}, authorization:authorize({by:'Ada Reviewer', maxUsd:1})}), /blocked/);
    assert.equal(fetch.calls.length, 0, 'no refused request reached ElevenLabs');
    const authorization = authorize({by:'Ada Reviewer', maxUsd:0.05});
    const first = await synthesize(req, {...opts, authorization});
    assert.equal(fetch.calls.length, 1); assert.equal(first.cached, false);
    assert.equal(first.estimate.usd, +(req.script.length / 1000 * PRICING.usdPer1kChars.eleven_multilingual_v2).toFixed(4));
    assert.ok(authorization.spentUsd > 0);
    const log = (await readFile(opts.usageLog, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(log.length, 1); assert.equal(log[0].approvedBy, 'Ada Reviewer'); assert.equal(log[0].characterCostHeader, String(req.script.length));
    const again = await synthesize(req, opts); // no authorization needed for a cache hit
    assert.equal(again.cached, true); assert.equal(again.costUsd, 0); assert.equal(fetch.calls.length, 1);
    assert.deepEqual(again.words, first.words);
    const changed = await synthesize({...req, profile:{...PROFILE, settings:{...PROFILE.settings, stability:0.6}}}, opts).catch(e => e);
    assert.ok(changed instanceof SpendNotAuthorized, 'new settings are a new paid request');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('the approved narrator is the default voice; until then stories fall back to their development voice', async () => {
  const dir = await temp();
  try {
    await cp(join(repo, 'voices'), dir, {recursive:true});
    const narration = (await story()).narration;
    assert.equal((await narratorFor(narration, dir)).profile.provider, 'macos-say', 'no narrator approved yet');
    await assert.rejects(narratorFor({script:'x'}, dir), /No approved Hold Up narrator/);
    const narrator = await readJson(join(dir, 'hold-up-narrator.json'));
    await writeFile(join(dir, 'hold-up-narrator.json'), JSON.stringify({...narrator, status:'approved', provider:'elevenlabs', voiceId:'v1', modelId:'eleven_multilingual_v2'}));
    const chosen = await narratorFor(narration, dir);
    assert.equal(chosen.profile.voiceId, 'v1'); assert.match(chosen.reason, /approved Hold Up narrator/);
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
  // Captions: the caption word at each word's midpoint is that word
  for (const w of plan.words) assert.equal(wordAt(plan, (w.start + w.end) / 2 * plan.fps).i, w.i);
  // Conflicts: a crushed beat, a shot squeezed so its pointing pose runs over the cut, and a script edit that removes an anchor
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

test('alignment cross-check and pause measurements', () => {
  const a = [{text:'a', start:0, end:0.2, match:'exact'}, {text:'b', start:0.5, end:0.7, match:'exact'}];
  const b = [{text:'a', start:0.02, end:0.2, match:'exact'}, {text:'b', start:0.5, end:0.74, match:'exact'}];
  const agree = timingAgreement(a, b);
  assert.equal(agree.words, 2); assert.ok(Math.abs(agree.meanAbsSec - 0.015) < 1e-9); assert.ok(Math.abs(agree.maxAbsSec - 0.04) < 1e-9);
  const words = alignWords('Wait [[slnc 400]] for it', [{text:'Wait', start:0, end:0.3}, {text:'for', start:0.75, end:0.9}, {text:'it', start:0.9, end:1}]).words;
  assert.deepEqual(pauseReport('Wait [[slnc 400]] for it', words), [{after:'Wait', markedMs:400, measuredMs:450}]);
});

test('audition: prepared without a key or spending; generation needs approval; only a person selects the narrator', async () => {
  const dir = await temp();
  try {
    const out = join(dir, 'auditions'), voicesDir = join(dir, 'voices');
    await cp(join(repo, 'voices'), voicesDir, {recursive:true});
    const fetch = mockFetch(ttsOk), provider = createElevenLabs({apiKey:undefined, fetch});
    const prepared = await prepare({outDir:out, provider, env:{}});
    assert.equal(prepared.status, 'prepared'); assert.equal(prepared.candidates.length, 3);
    assert.ok(prepared.candidates.every(c => c.renderedText === prepared.candidates[0].renderedText && c.modelId === prepared.modelId), 'same text and settings for every voice');
    assert.ok(prepared.estimatedTotalUsd > 0 && prepared.estimatedTotalUsd < 0.1);
    assert.match(await readFile(join(out, 'README.md'), 'utf8'), /No voice selected/);
    await assert.rejects(generate({outDir:out, provider, approvedBy:'Claude', approveSpendUsd:1, env:{}}), /person/);
    await assert.rejects(generate({outDir:out, provider, approvedBy:'Ada Reviewer', approveSpendUsd:0.001, env:{}}), /estimated/);
    await assert.rejects(select({n:1, by:'Ada Reviewer', outDir:out, voicesDir}), /Generate and listen/);
    assert.equal(fetch.calls.length, 0);
    const keyed = createElevenLabs({apiKey:'sk_test', fetch});
    const report = await generate({outDir:out, provider:keyed, approvedBy:'Ada Reviewer', approveSpendUsd:0.1, env:{}, cacheDir:join(dir, 'cache')});
    assert.equal(fetch.calls.length, 3); assert.equal(report.status, 'generated');
    assert.ok(report.candidates.every(c => c.measurements.alignment.exact === c.measurements.alignment.scriptWords && c.measurements.wordsPerMinute > 0));
    assert.equal(report.selection, null, 'generation never selects a voice');
    await assert.rejects(select({n:2, by:'claude', outDir:out, voicesDir}), /person/);
    const chosen = await select({n:2, by:'Ada Reviewer', outDir:out, voicesDir});
    assert.equal(chosen.status, 'approved'); assert.equal(chosen.voiceId, prepared.candidates[1].voiceId); assert.equal(chosen.approval.by, 'Ada Reviewer');
    assert.equal((await readJson(join(repo, 'voices/hold-up-narrator.json'))).status, 'unselected', 'the repository narrator stays unselected');
  } finally { await rm(dir, {recursive:true, force:true}); }
});
