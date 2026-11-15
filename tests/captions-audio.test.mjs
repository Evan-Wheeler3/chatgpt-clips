import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { groupWords, planCaptions, estimateBlock } from '../tools/captions/plan.mjs';
import { resolveStyle, CAPTION_STYLES } from '../tools/captions/styles.mjs';
import { captionQA, checkPlanCoverage } from '../tools/captions/qa.mjs';
import { compileStory } from '../tools/storyboard/compile.mjs';
import { loadCatalog, validateCatalog, usableAsset, importAsset, approveAsset } from '../tools/audio/catalog.mjs';
import { LIBRARY, buildLibrary } from '../tools/audio/synth.mjs';
import { scheduleSfx } from '../tools/audio/schedule.mjs';
import { mixStory, audioQA, duckCurve, measureLoudness, TARGETS } from '../tools/audio/mix.mjs';
import { writeWav, decodeAudio } from '../tools/audio/wav.mjs';
import { SAMPLE_RATE, rms, gainToDb, rng } from '../tools/audio/dsp.mjs';
import { findChrome } from '../tools/convert/preview.mjs';
import { studioStory, ticks } from '../tools/character-rig.mjs';

const run = promisify(execFile);
const repo = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const temp = () => mkdtemp(join(tmpdir(), 'holdup-6-2-'));
const barrelWords = () => readJson(join(repo, 'production/barrel-bilge/words.json')).catch(() => null);
const barrelStory = () => readJson(join(repo, 'stories/barrel-bilge/story.json'));
// Words of a sentence at a steady pace (for tests that do not need real narration)
const spoken = (text, {start = 0.5, word = 0.28, gap = 0.04} = {}) => text.split(' ').map((t, i) => ({i, text:t, start:+(start + i * (word + gap)).toFixed(3), end:+(start + i * (word + gap) + word).toFixed(3)}));

test('caption grouping: every word once and in order, 2-5 words, sentence breaks, no weak endings mid-sentence', () => {
  const g = resolveStyle({}).grouping;
  const words = spoken('Why do wooden barrels bulge in the middle? That curve has a name: the bilge. And the bulge makes a heavy barrel easy to roll and easy to turn, right on the spot.');
  const groups = groupWords(words, g), flat = groups.flat();
  assert.deepEqual(flat, words.map((_, i) => i));
  assert.ok(groups.every(x => x.length >= 1 && x.length <= g.maxWords));
  assert.ok(groups.filter(x => x.length < g.minWords).length <= 1, 'at most an unavoidable single');
  for (const x of groups) {
    const last = words[x.at(-1)].text.toLowerCase().replace(/[^a-z]/g, '');
    const endsSentence = /[.?!:,]$/.test(words[x.at(-1)].text) || x.at(-1) === words.length - 1;
    if (!endsSentence) assert.ok(!g.weakEndings.includes(last), `group ends on "${last}"`);
  }
  for (const [k, w] of words.entries()) if (/[.?!]$/.test(w.text) && k < words.length - 1) assert.ok(groups.some(x => x.at(-1) === k), `a sentence ends inside a group at "${w.text}"`);
  const legacy = groupWords(words, CAPTION_STYLES['legacy-hud'].grouping);
  assert.ok(legacy.length < groups.length, 'the legacy style shows whole sentences');
});

test('captions on the approved narration: synced timing, emphasis from the script, one band per shot, backward compatible', async () => {
  const words = await barrelWords(); if (!words) return;
  const story = await barrelStory(), plan = await compileStory(story, words), c = plan.captions;
  assert.equal(c.enabled, true); assert.equal(c.style.name, 'hold-up');
  const cov = checkPlanCoverage(plan);
  assert.deepEqual([cov.missing, cov.repeated, cov.outOfOrder], [[], [], false]);
  for (const [n, g] of c.groups.entries()) {
    // Shown before its first word, and at least through the middle of its last word (the next group may lead in)
    const last = g.words.at(-1);
    assert.ok(g.start <= g.words[0].start && g.end >= (last.start + last.end) / 2, `group ${n} covers its words`);
    if (c.groups[n + 1]) assert.ok(g.end <= c.groups[n + 1].start + 1e-6, `groups ${n} and ${n + 1} overlap`);
  }
  const emphasized = c.groups.flatMap(g => g.words).filter(w => w.emphasis).map(w => w.text.replace(/[^a-z]/gi, '').toLowerCase());
  assert.ok(emphasized.includes('bilge'), 'the script\'s [[emph +]] word'); assert.ok(emphasized.includes('roll') && emphasized.includes('turn'));
  for (const shot of new Set(c.groups.map(g => g.shot))) assert.equal(new Set(c.groups.filter(g => g.shot === shot).map(g => g.band)).size, 1, `${shot} keeps one caption band`);
  const pinned = structuredClone(story); pinned.beats.flatMap(b => b.shots).find(s => s.id === 'roll').captions = {position:'upper'};
  assert.ok((await compileStory(pinned, words)).captions.groups.filter(g => g.shot === 'roll').every(g => g.band === 'upper' && g.pinned));
  const old = structuredClone(story); delete old.captions; delete old.audio;
  assert.equal((await compileStory(old, words)).captions.style.name, 'hold-up', 'older stories get the default captions');
  assert.equal((await compileStory({...old, captions:false}, words)).captions.enabled, false);
  for (const g of c.groups) { const b = estimateBlock(g.text, c.style, g.band, plan.size), s = c.style.layout.safe; assert.ok(b[1] >= s.top && b[3] <= s.bottom, `group ${g.n} band inside the safe area`); }
});

test('drawn captions: highlighted while spoken, inside the safe area, consistent entrances (renderer)', async t => {
  if (!await findChrome()) return t.skip('No Chrome/Chromium available; set CHROME_PATH');
  const gpu = process.env.HOLDUP_GPU; process.env.HOLDUP_GPU = gpu ?? 'swiftshader';
  try {
    const story = {...studioStory('cooper'), captions:{style:'hold-up', emphasize:['barrel']}};
    story.beats[0].shots = [story.beats[0].shots[0]]; // one held shot, no beat anchors
    const words = spoken('Here is the cooper. He stands beside a wooden barrel, and it is heavy.', {start:0.4, word:0.24, gap:0.06});
    const plan = await compileStory(story, {words, audio:{durationSec:6}});
    const report = await captionQA(plan, {quality:'animatic'});
    assert.deepEqual(report.issues, [], JSON.stringify(report.issues));
    assert.ok(!report.warnings.some(w => w.code === 'CAPTION_ENTRANCE_INCONSISTENT'));
  } finally { if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu; }
});

test('audio catalog: complete, allowed licenses, files match their checksums; generated assets are reproducible', async () => {
  const catalog = await loadCatalog();
  assert.deepEqual(await validateCatalog(catalog), []);
  assert.ok(catalog.assets.every(a => a.license === 'CC0-1.0' || a.attribution));
  const dir = await temp();
  try {
    const rebuilt = await buildLibrary({dir:join(dir, 'audio'), catalogFile:join(dir, 'catalog.json')});
    for (const a of rebuilt.assets) assert.equal(a.sha256, catalog.assets.find(x => x.id === a.id).sha256, `${a.id} is reproducible from its generator`);
    // Problems are caught: a disallowed license, a missing file, a changed file, a CC-BY asset without a credit line
    const broken = structuredClone(catalog);
    broken.assets[0].license = 'CC-BY-NC-4.0'; broken.assets[1].file = 'audio/sfx/nope.wav'; broken.assets[2].sha256 = '0'.repeat(64);
    broken.assets[3].license = 'CC-BY-4.0';
    const codes = (await validateCatalog(broken)).map(p => p.code);
    for (const code of ['LICENSE_NOT_ALLOWED', 'MISSING_FILE', 'CHECKSUM_MISMATCH', 'ATTRIBUTION_MISSING']) assert.ok(codes.includes(code), code);
    assert.equal(LIBRARY.length, catalog.assets.filter(a => a.source.type === 'generated').length);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('imports need a real license and evidence, start as pending-review, and only a person can approve them', async () => {
  const dir = await temp();
  try {
    const catalogFile = join(dir, 'catalog.json'), src = join(dir, 'rec.wav');
    await writeFile(catalogFile, JSON.stringify({assets:[]}));
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=d=0.5:a=0.2', src]);
    const base = {file:src, id:'door-creak', category:'wood', description:'An old door', license:'CC0-1.0', sourceUrl:'https://example.org/sound/1', author:'A. Recordist', evidence:'License: CC0 on the source page', root:dir, catalogFile};
    await assert.rejects(importAsset({...base, license:'CC-BY-NC-4.0'}), /cannot be imported/);
    await assert.rejects(importAsset({...base, evidence:''}), /evidence/);
    await assert.rejects(importAsset({...base, license:'CC-BY-4.0'}), /attribution/);
    await assert.rejects(importAsset({...base, file:join(dir, 'missing.wav')}), /not a readable audio file/);
    const asset = await importAsset(base);
    assert.equal(asset.status, 'pending-review');
    const catalog = await loadCatalog(catalogFile);
    assert.throws(() => usableAsset(catalog, 'door-creak'), /pending-review/);
    assert.throws(() => usableAsset(catalog, 'nonexistent'), /not in the audio catalog/);
    await assert.rejects(approveAsset('door-creak', {by:'Claude', catalogFile}), /person/);
    await approveAsset('door-creak', {by:'Ada Reviewer', catalogFile});
    assert.equal(usableAsset(await loadCatalog(catalogFile), 'door-creak').status, 'approved');
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('sound effects follow the animation: rolls, pivots, wobbles, steps, the whip and manual cues land on their frames', async () => {
  const words = await barrelWords(); if (!words) return;
  const story = await barrelStory(), plan = await compileStory(story, words), events = scheduleSfx(plan, story);
  const barrel = plan.props.find(p => p.id === 'barrel'), action = type => barrel.actions.find(a => a.type === type);
  assert.ok(events.some(e => e.asset === 'barrel-thud' && e.frame === action('roll').startFrame), 'thud on the shove');
  const roll = events.find(e => e.asset === 'barrel-roll-loop');
  assert.equal(roll.frame, action('roll').startFrame); assert.ok(roll.envelope.every(([, g]) => g >= 0 && g <= 1));
  assert.ok(events.some(e => e.asset === 'barrel-scrape' && e.frame === action('pivot').startFrame));
  assert.ok(events.some(e => e.rule === 'wobble' && e.frame === action('wobble').startFrame));
  const walk = plan.cast[0].actions.find(a => a.type === 'walk'), steps = events.filter(e => e.rule === 'walk');
  assert.ok(steps.length >= 2 && steps.every(e => e.frame > walk.startFrame && e.frame <= walk.endFrame));
  const whipShot = plan.shots.find(s => s.transition?.type === 'whip');
  assert.ok(events.some(e => e.rule === 'whip' && Math.abs(e.frame - whipShot.startFrame) <= plan.fps * 0.5));
  const squeeze = plan.words.find(w => w.text.toLowerCase().startsWith('squeeze'));
  assert.equal(events.find(e => e.id === 'staves-tension').time, +squeeze.start.toFixed(3), 'manual cue on its word');
  assert.equal(scheduleSfx(plan, {...story, audio:{...story.audio, auto:false}}).filter(e => e.rule !== 'manual').length, 0);
  assert.ok(!scheduleSfx(plan, {...story, audio:{...story.audio, mute:['staves-tension']}}).some(e => e.id === 'staves-tension'));
  assert.equal(scheduleSfx(plan, {...story, audio:{...story.audio, auto:{exclude:['walk']}}}).filter(e => e.rule === 'walk').length, 0);
});

test('mixer: loudness target, true-peak ceiling, no clipping, music ducked under speech, narration untouched, A/V sync checked', async () => {
  const dir = await temp();
  try {
    // A synthetic narration: tone bursts at the words' times; a CC0 test "music" bed
    const words = spoken('one two three', {start:1, word:0.6, gap:1.8}), fps = 30, durationSec = 8;
    const voice = new Float32Array(durationSec * SAMPLE_RATE);
    // Aperiodic bursts, like speech (a pure tone repeats every cycle, so its timing could not be measured by correlation)
    const noise = rng(7);
    for (const w of words) for (let i = Math.floor(w.start * SAMPLE_RATE); i < w.end * SAMPLE_RATE; i++) voice[i] = 0.3 * (noise() * 2 - 1);
    const narration = join(dir, 'narration.wav'); await writeWav(narration, voice);
    const before = createHash('sha256').update(await readFile(narration)).digest('hex');
    const music = new Float32Array(durationSec * SAMPLE_RATE).map((_, i) => 0.4 * Math.sin(2 * Math.PI * 330 * i / SAMPLE_RATE));
    await mkdir(join(dir, 'audio/sfx'), {recursive:true}); await writeWav(join(dir, 'audio/sfx/test-music.wav'), [music, music]);
    const catalog = await loadCatalog();
    catalog.assets.push({id:'test-music', description:'test bed', category:'music', file:'audio/sfx/test-music.wav', durationSec, source:{type:'generated'}, license:'CC0-1.0', licenseEvidence:'test', status:'approved', gainDb:-10, sha256:'x'});
    await cp(join(repo, 'audio/sfx'), join(dir, 'audio/sfx'), {recursive:true, force:false});
    const plan = {fps, durationFrames:durationSec * fps, size:{width:1080, height:1920}, words, props:[], cast:[], shots:[]};
    const story = {audio:{auto:false, sfx:[{id:'hit', at:4.5, asset:'barrel-thud'}], ambience:{profile:'workshop'}, music:{asset:'test-music', fadeInSec:0.5, fadeOutSec:0.5}}};
    const mix = await mixStory({plan, story, narrationFile:narration, outDir:join(dir, 'out'), catalog, root:dir});
    assert.equal(createHash('sha256').update(await readFile(narration)).digest('hex'), before, 'the narration file is never modified');
    const qa = await audioQA({mixFile:mix.file, stems:mix.stems, plan});
    assert.ok(Math.abs(qa.integratedLufs - TARGETS.lufs) <= 1, `loudness ${qa.integratedLufs}`);
    assert.ok(qa.truePeakDb <= TARGETS.truePeakDb + 0.5, `true peak ${qa.truePeakDb}`); assert.equal(qa.clippedSamples, 0);
    assert.ok(qa.durationSec >= durationSec - 0.01 && qa.durationSec <= durationSec + 0.01, 'the mix lasts exactly as long as the video');
    // Ducking: the music is at least 9 dB lower while the narrator speaks than in the pauses
    const m = mix.stems.music[0], inWord = (w) => rms(m, Math.floor((w.start + 0.15) * SAMPLE_RATE), Math.floor((w.end - 0.05) * SAMPLE_RATE));
    const between = (a, b) => rms(m, Math.floor((a.end + 1.2) * SAMPLE_RATE), Math.floor((b.start - 0.2) * SAMPLE_RATE));
    assert.ok(gainToDb(between(words[1], words[2]) / inWord(words[2])) >= 9, 'music ducks under speech');
    // The manual effect starts on its time
    const sfx = mix.stems.sfx[0]; let onset = 0; while (onset < sfx.length && Math.abs(sfx[onset]) < 1e-4) onset++;
    assert.ok(Math.abs(onset / SAMPLE_RATE - 4.5) < 0.005, `effect at ${(onset / SAMPLE_RATE).toFixed(3)} s`);
    // A/V: muxed with a test video it is in sync; delayed by 100 ms it is flagged
    const video = join(dir, 'v.mp4'), late = join(dir, 'late.mp4');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=108x192:r=30:d=${durationSec}`, '-i', mix.file, '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
    const synced = await audioQA({mixFile:mix.file, stems:mix.stems, plan, videoFile:video});
    assert.deepEqual(synced.issues, [], JSON.stringify(synced.video));
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `color=c=gray:s=108x192:r=30:d=${durationSec}`, '-i', mix.file, '-af', 'adelay=100|100', '-c:v', 'libx264', '-c:a', 'aac', '-t', String(durationSec), late]);
    assert.ok((await audioQA({mixFile:mix.file, stems:mix.stems, plan, videoFile:late})).issues.some(i => i.code === 'AV_SYNC_OFFSET'));
    // Unlicensed or unknown sounds stop the mix instead of being swapped for something else
    await assert.rejects(mixStory({plan, story:{audio:{auto:false, sfx:[{at:1, asset:'mystery-boom'}]}}, narrationFile:narration, outDir:join(dir, 'out2'), catalog, root:dir}), /not in the audio catalog/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('audio QA flags clipping, loudness off target and a narrator buried under effects', async () => {
  const dir = await temp();
  try {
    const n = 4 * SAMPLE_RATE, loud = new Float32Array(n).map((_, i) => Math.sin(2 * Math.PI * 100 * i / SAMPLE_RATE));
    const file = join(dir, 'hot.wav'); await writeWav(file, [loud, loud]);
    const words = spoken('a b c', {start:0.5, word:0.5, gap:0.2});
    const quietVoice = new Float32Array(n).map((_, i) => 0.001 * Math.sin(i / 10)), bed = [loud, loud];
    const stems = {narration:[quietVoice, quietVoice], sfx:bed, ambience:[new Float32Array(n), new Float32Array(n)], music:[new Float32Array(n), new Float32Array(n)]};
    const codes = (await audioQA({mixFile:file, stems, plan:{words, fps:30}})).issues.map(i => i.code);
    for (const code of ['CLIPPING', 'LOUDNESS_OFF_TARGET', 'NARRATION_NOT_DOMINANT']) assert.ok(codes.includes(code), code);
    const curve = duckCurve(words, n);
    assert.ok(curve[Math.floor(0.75 * SAMPLE_RATE)] > 0.9 && curve[Math.floor(3.9 * SAMPLE_RATE)] < 0.05, 'speech presence rises in words and releases after');
    assert.ok((await measureLoudness(file)).integratedLufs > -6);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('mixer additions: effects that run until a cue and stop dead, per-shot ambience levels and ambience dips', async () => {
  const { ambienceLevel, HARD_STOP_SEC } = await import('../tools/audio/mix.mjs');
  const { dbToGain } = await import('../tools/audio/dsp.mjs');
  const words = spoken('one two three', {start:1, word:0.6, gap:1.8}), fps = 30, durationSec = 8;
  const plan = {fps, durationFrames:durationSec * fps, size:{width:1080, height:1920}, words, props:[], cast:[],
    shots:[{id:'outside', startFrame:0, endFrame:120}, {id:'inside', startFrame:120, endFrame:240}]};
  const story = {audio:{auto:false, sfx:[{id:'bed', at:1, until:{at:'two', offset:-0.1}, stop:'hard', asset:'barrel-roll-loop'}],
    ambience:{profile:'workshop', shots:{inside:-6}, dips:[{at:'three', durationSec:0.15, db:-6}]}}};
  // Schedule: "until" sets the length from the spoken word; the stop is hard
  const [bed] = scheduleSfx(plan, story);
  assert.equal(bed.durationSec, +(words[1].start - 0.1 - 1).toFixed(3)); assert.equal(bed.hardStop, true);
  assert.throws(() => scheduleSfx(plan, {audio:{auto:false, sfx:[{id:'x', at:'two', until:'one', asset:'barrel-thud'}]}}), /must come after/);
  assert.throws(() => scheduleSfx(plan, {audio:{auto:false, sfx:[{id:'x', at:1, stop:'abrupt', asset:'barrel-thud'}]}}), /stop must be/);
  // Ambience level: 0 dB outside, -6 dB inside (smooth across the cut), a further -6 dB dip at "three"
  const length = durationSec * SAMPLE_RATE, {gain, dips} = ambienceLevel(plan, story.audio.ambience, length), at = s => gain[Math.round(s * SAMPLE_RATE)];
  assert.ok(Math.abs(at(2) - 1) < 1e-6 && Math.abs(at(5) - dbToGain(-6)) < 1e-6);
  assert.ok(at(4) < 1 && at(4) > dbToGain(-6), 'the level eases across the cut');
  assert.ok(Math.abs(at(words[2].start + 0.05) - dbToGain(-12)) < 1e-6, 'the dip stacks on the shot level');
  assert.ok(Math.abs(at(words[2].start + 0.5) - dbToGain(-6)) < 1e-6, 'the dip recovers');
  assert.equal(dips.length, 1);
  assert.throws(() => ambienceLevel(plan, {shots:{nowhere:-3}}, length), /unknown shot/);
  // Mix: the bed is audible right up to its cue and silent a few milliseconds after it
  const dir = await temp();
  try {
    const voice = new Float32Array(length); const noise = rng(3);
    for (const w of words) for (let i = Math.floor(w.start * SAMPLE_RATE); i < w.end * SAMPLE_RATE; i++) voice[i] = 0.3 * (noise() * 2 - 1);
    const narration = join(dir, 'narration.wav'); await writeWav(narration, voice);
    const mix = await mixStory({plan, story, narrationFile:narration, outDir:join(dir, 'out')});
    const sfx = mix.stems.sfx[0], stop = words[1].start - 0.1;
    assert.ok(rms(sfx, Math.floor((stop - 0.2) * SAMPLE_RATE), Math.floor((stop - 0.01) * SAMPLE_RATE)) > 1e-3, 'audible before the stop');
    assert.equal(rms(sfx, Math.ceil((stop + HARD_STOP_SEC + 0.002) * SAMPLE_RATE), Math.floor((stop + 0.3) * SAMPLE_RATE)), 0, 'silent right after the stop');
    assert.equal(mix.report.ambience.dips.length, 1);
  } finally { await rm(dir, {recursive:true, force:true}); }
});

test('derived sounds: recorded operations, inherited license, provenance and checksum', async () => {
  const { applyOps, deriveAsset } = await import('../tools/audio/derive.mjs');
  const ramp = Float32Array.from({length:SAMPLE_RATE}, (_, i) => i / SAMPLE_RATE);
  const out = applyOps(ramp, [{trim:[0.5, 1]}, {reverse:true}, {speed:2}]);
  assert.equal(out.length, Math.floor((SAMPLE_RATE / 2 - 1) / 2));
  assert.ok(out[0] > out[out.length - 1], 'reversed');
  assert.throws(() => applyOps(ramp, [{trim:[0.5, 2]}]), /outside the source/);
  assert.throws(() => applyOps(ramp, [{wobble:1}]), /Unknown derive operation/);
  const dir = await temp();
  try {
    await mkdir(join(dir, 'audio/sfx'), {recursive:true});
    await writeWav(join(dir, 'audio/sfx/src.wav'), ramp.map(v => v * 0.5));
    const sha = createHash('sha256').update(await readFile(join(dir, 'audio/sfx/src.wav'))).digest('hex');
    const catalogFile = join(dir, 'catalog.json');
    await writeFile(catalogFile, JSON.stringify({assets:[{id:'src', description:'a pour', category:'liquid', file:'audio/sfx/src.wav', durationSec:1, source:{type:'recorded', url:'https://example.org/s'},
      license:'CC-BY-4.0', licenseEvidence:'https://example.org/s', attribution:'"Pour" by Someone (CC BY 4.0)', author:'Someone', status:'approved', gainDb:-12, sha256:sha}]}));
    const a = await deriveAsset({from:'src', id:'src-reversed', ops:[{reverse:true}], root:dir, catalogFile});
    assert.equal(a.license, 'CC-BY-4.0'); assert.equal(a.attribution, '"Pour" by Someone (CC BY 4.0)'); assert.equal(a.author, 'Someone');
    assert.deepEqual(a.source, {type:'derived', from:'src', fromSha256:sha, ops:[{reverse:true}]});
    await assert.rejects(deriveAsset({from:'missing', id:'x', ops:[], root:dir, catalogFile}), /No source asset/);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
