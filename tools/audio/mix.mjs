import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SAMPLE_RATE, dbToGain, gainToDb, rms } from './dsp.mjs';
import { writeWav, decodeAudio } from './wav.mjs';
import { loadCatalog, usableAsset, ROOT } from './catalog.mjs';
import { scheduleSfx } from './schedule.mjs';

/*
 * Multitrack mix for a story: narration, sound effects, ambience and optional music, mixed locally and mastered for
 * online video. The narration file is never modified: it is decoded, loudness-matched and placed at time zero, so the
 * mix stays frame-locked to the video.
 *   narration   matched to TARGETS.narrationLufs, centred
 *   sfx         scheduled events (tools/audio/schedule.mjs), constant-power pan, speed-following envelopes, -3 dB under speech
 *   ambience    profile layers looped with crossfades, faded in and out, ducked under speech
 *   music       optional, trimmed and faded, ducked well under speech (TARGETS.musicDuckDb)
 *   master      two-pass loudnorm to TARGETS.lufs / TARGETS.truePeakDb, 48 kHz stereo
 */
const run = promisify(execFile);
export const TARGETS = {lufs:-14, truePeakDb:-1.5, lra:11, narrationLufs:-16, sfxDuckDb:-3, musicDuckDb:-12, duckAttackSec:0.08, duckReleaseSec:0.35, speechPadSec:0.12};

export async function measureLoudness(file) {
  const {stderr} = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {maxBuffer:64 * 1024 * 1024});
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const num = re => { const m = summary.match(re); return m ? Number(m[1]) : null; };
  return {integratedLufs:num(/I:\s+(-?[\d.]+) LUFS/), lra:num(/LRA:\s+(-?[\d.]+) LU/), truePeakDb:num(/Peak:\s+(-?[\d.inf]+) dBFS/)};
}

// Speech presence (0..1) per sample from the measured words, smoothed into a ducking curve
export function duckCurve(words, length, {attackSec = TARGETS.duckAttackSec, releaseSec = TARGETS.duckReleaseSec, padSec = TARGETS.speechPadSec} = {}) {
  const speech = new Float32Array(length);
  for (const w of words) for (let i = Math.max(0, Math.floor((w.start - padSec) * SAMPLE_RATE)); i < Math.min(length, Math.ceil((w.end + padSec) * SAMPLE_RATE)); i++) speech[i] = 1;
  const out = new Float32Array(length), up = 1 - Math.exp(-1 / (attackSec * SAMPLE_RATE)), down = 1 - Math.exp(-1 / (releaseSec * SAMPLE_RATE));
  let y = 0;
  for (let i = 0; i < length; i++) { y += (speech[i] - y) * (speech[i] > y ? up : down); out[i] = y; }
  return out;
}

const panGains = pan => { const a = (Math.max(-1, Math.min(1, pan)) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; };
// Envelope points [[sec, gain]...] -> per-sample gain (linear interpolation, holds at the ends)
function envelopeAt(points, i) {
  if (!points?.length) return 1;
  const t = i / SAMPLE_RATE;
  if (t <= points[0][0]) return points[0][1];
  for (let k = 1; k < points.length; k++) if (t <= points[k][0]) { const [t0, g0] = points[k - 1], [t1, g1] = points[k]; return g0 + (g1 - g0) * (t - t0) / Math.max(1e-6, t1 - t0); }
  return points.at(-1)[1];
}

export async function mixStory({plan, story, narrationFile, outDir, catalog = null, ambienceFile = join(ROOT, 'audio/ambience.json'), root = ROOT}) {
  catalog ??= await loadCatalog();
  await mkdir(outDir, {recursive:true});
  const audio = story.audio ?? {}, durationSec = plan.durationFrames / plan.fps, length = Math.round(durationSec * SAMPLE_RATE);
  const cache = new Map();
  const load = async id => { if (!cache.has(id)) { const a = usableAsset(catalog, id); cache.set(id, {asset:a, data:(await decodeAudio(join(root, a.file), {channels:1}))[0]}); } return cache.get(id); };
  const stems = {narration:[new Float32Array(length), new Float32Array(length)], sfx:[new Float32Array(length), new Float32Array(length)], ambience:[new Float32Array(length), new Float32Array(length)], music:[new Float32Array(length), new Float32Array(length)]};
  const duck = duckCurve(plan.words, length);

  // Narration: loudness-matched copy at time zero (the source file is untouched)
  const narrationLoudness = await measureLoudness(narrationFile);
  const narrationGain = dbToGain(TARGETS.narrationLufs - narrationLoudness.integratedLufs);
  const [voice] = await decodeAudio(narrationFile, {channels:1});
  for (let i = 0; i < Math.min(length, voice.length); i++) { const v = voice[i] * narrationGain * Math.SQRT1_2; stems.narration[0][i] = v; stems.narration[1][i] = v; }

  // Sound effects
  const events = scheduleSfx(plan, story), sfxGain = dbToGain(audio.gainDb?.sfx ?? 0);
  for (const e of events) {
    const {asset, data} = await load(e.asset), [gl, gr] = panGains(e.pan ?? 0), start = Math.round(e.time * SAMPLE_RATE);
    const n = e.durationSec ? Math.round(e.durationSec * SAMPLE_RATE) : data.length, base = dbToGain(asset.gainDb + (e.gainDb ?? 0)) * sfxGain;
    const fadeOut = e.durationSec ? Math.round(0.25 * SAMPLE_RATE) : 0;
    for (let k = 0; k < n && start + k < length; k++) {
      const i = start + k; if (i < 0) continue;
      const src = asset.loop ? data[k % data.length] : data[k]; if (src === undefined) break;
      const tail = fadeOut && k > n - fadeOut ? (n - k) / fadeOut : 1;
      const g = base * envelopeAt(e.envelope, k) * tail * dbToGain(TARGETS.sfxDuckDb * duck[i]);
      stems.sfx[0][i] += src * g * gl; stems.sfx[1][i] += src * g * gr;
    }
  }

  // Ambience: a profile's layers looped across the whole video, faded, ducked under speech
  let ambience = null;
  if (audio.ambience) {
    const profiles = JSON.parse(await readFile(ambienceFile, 'utf8')).profiles;
    const profile = profiles[audio.ambience.profile];
    if (!profile) throw new Error(`Unknown ambience profile "${audio.ambience.profile}" (${Object.keys(profiles).join(', ')})`);
    ambience = {profile:audio.ambience.profile, layers:[]};
    for (const layer of profile.layers) {
      const {asset, data} = await load(layer.asset), g = dbToGain(asset.gainDb + (layer.gainDb ?? 0) + (audio.ambience.gainDb ?? 0));
      const fi = (layer.fadeInSec ?? 1) * SAMPLE_RATE, fo = (layer.fadeOutSec ?? 1) * SAMPLE_RATE, xf = Math.round(0.5 * SAMPLE_RATE);
      for (let i = 0; i < length; i++) {
        // Loop with a short equal-power crossfade at each wrap, so repeats have no seam
        const k = i % data.length, wrapIn = i >= data.length && k < xf ? Math.sin(k / xf * Math.PI / 2) : 1;
        const src = data[k] * wrapIn + (i >= data.length && k < xf ? data[data.length - xf + k] * Math.cos(k / xf * Math.PI / 2) : 0);
        const v = src * g * Math.min(1, i / fi, (length - 1 - i) / fo) * dbToGain((layer.duckDb ?? -3) * duck[i]) * Math.SQRT1_2;
        stems.ambience[0][i] += v; stems.ambience[1][i] += v;
      }
      ambience.layers.push({asset:layer.asset, gainDb:asset.gainDb + (layer.gainDb ?? 0)});
    }
  }

  // Music (optional): only approved, licensed assets; trimmed, faded and ducked well under speech
  let music = null;
  if (audio.music) {
    const m = audio.music, {asset} = await load(m.asset), [left, right] = await decodeAudio(join(root, asset.file), {channels:2});
    const from = Math.round((m.startSec ?? 0) * SAMPLE_RATE), to = Math.min(length, Math.round((m.endSec ?? durationSec) * SAMPLE_RATE)), offset = Math.round((m.offsetSec ?? 0) * SAMPLE_RATE);
    const fi = (m.fadeInSec ?? 1.5) * SAMPLE_RATE, fo = (m.fadeOutSec ?? 2) * SAMPLE_RATE, g = dbToGain(asset.gainDb + (m.gainDb ?? 0));
    for (let i = from; i < to; i++) {
      const k = i - from + offset; if (k >= left.length) break;
      const v = g * Math.min(1, (i - from) / fi, (to - 1 - i) / fo) * dbToGain((m.duckDb ?? TARGETS.musicDuckDb) * duck[i]);
      stems.music[0][i] += left[k] * v; stems.music[1][i] += right[k] * v;
    }
    music = {asset:m.asset, attribution:asset.attribution ?? null};
  }

  // Pre-master sum (float), then two-pass loudness normalisation with a true-peak ceiling
  const sum = [0, 1].map(c => { const out = new Float32Array(length); for (const s of Object.values(stems)) for (let i = 0; i < length; i++) out[i] += s[c][i]; return out; });
  const tmp = join(outDir, 'tmp'); await mkdir(tmp, {recursive:true});
  const premaster = join(tmp, 'premaster.wav'), final = join(outDir, 'mix.wav');
  await writeWav(premaster, sum, {float:true});
  const {stderr} = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', premaster, '-af', `loudnorm=I=${TARGETS.lufs}:TP=${TARGETS.truePeakDb}:LRA=${TARGETS.lra}:print_format=json`, '-f', 'null', '-'], {maxBuffer:64 * 1024 * 1024});
  const first = JSON.parse(stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1));
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', premaster, '-af',
    `loudnorm=I=${TARGETS.lufs}:TP=${TARGETS.truePeakDb}:LRA=${TARGETS.lra}:measured_I=${first.input_i}:measured_TP=${first.input_tp}:measured_LRA=${first.input_lra}:measured_thresh=${first.input_thresh}:offset=${first.target_offset}:linear=true`,
    '-ar', String(SAMPLE_RATE), '-ac', '2', '-c:a', 'pcm_s24le', final]);
  for (const [name, s] of Object.entries(stems)) await writeWav(join(outDir, `stem-${name}.wav`), s, {float:true});
  await rm(tmp, {recursive:true, force:true});
  const report = {durationSec, narration:{file:narrationFile, measuredLufs:narrationLoudness.integratedLufs, gainDb:+gainToDb(narrationGain).toFixed(2)}, events, ambience, music,
    master:{targets:TARGETS, firstPass:{inputI:Number(first.input_i), inputTp:Number(first.input_tp), normalizationType:first.normalization_type}}};
  await writeFile(join(outDir, 'schedule.json'), JSON.stringify(report, null, 2) + '\n');
  return {file:final, stemsDir:outDir, report, stems};
}

// Audio QA on a finished mix (and optionally the muxed video): loudness, peaks, clipping, speech clarity, silence, sync
export async function audioQA({mixFile, stems, plan, videoFile = null}) {
  const loud = await measureLoudness(mixFile), issues = [];
  const [l, r] = await decodeAudio(mixFile, {channels:2});
  let clipped = 0; for (const ch of [l, r]) for (const v of ch) if (Math.abs(v) >= 0.999) clipped++;
  // Speech clarity: narration level vs everything else inside speech, in dB (before mastering gain, which is shared)
  const length = stems.narration[0].length, speechIdx = [];
  for (const w of plan.words) speechIdx.push([Math.floor(w.start * SAMPLE_RATE), Math.min(length, Math.ceil(w.end * SAMPLE_RATE))]);
  const level = chans => { let s = 0, n = 0; for (const [a, b] of speechIdx) for (let i = a; i < b; i++) { const v = chans[0][i] + chans[1][i]; s += v * v; n++; } return Math.sqrt(s / Math.max(1, n)); };
  const bed = [0, 1].map(c => { const o = new Float32Array(length); for (const k of ['sfx', 'ambience', 'music']) for (let i = 0; i < length; i++) o[i] += stems[k][c][i]; return o; });
  const clarityDb = +gainToDb(level(stems.narration) / Math.max(1e-9, level(bed))).toFixed(1);
  // Silence: stretches longer than 1.5 s quieter than -55 dBFS inside the video (beds should keep the room alive)
  const win = Math.round(0.05 * SAMPLE_RATE); let quiet = 0, longest = 0;
  for (let i = 0; i + win <= l.length; i += win) { if (gainToDb(rms(l, i, i + win)) < -55) { quiet += 0.05; longest = Math.max(longest, quiet); } else quiet = 0; }
  if (loud.integratedLufs === null || Math.abs(loud.integratedLufs - TARGETS.lufs) > 1) issues.push({code:'LOUDNESS_OFF_TARGET', message:`Integrated ${loud.integratedLufs} LUFS (target ${TARGETS.lufs})`});
  if (loud.truePeakDb > TARGETS.truePeakDb + 0.5) issues.push({code:'TRUE_PEAK_HIGH', message:`True peak ${loud.truePeakDb} dBTP (ceiling ${TARGETS.truePeakDb})`});
  if (clipped) issues.push({code:'CLIPPING', message:`${clipped} clipped samples`});
  if (clarityDb < 12) issues.push({code:'NARRATION_NOT_DOMINANT', message:`Narration is only ${clarityDb} dB above the rest during speech (want 12+)`});
  if (longest > 1.5) issues.push({code:'DEAD_AIR', message:`${longest.toFixed(1)} s of near silence`});
  const result = {integratedLufs:loud.integratedLufs, truePeakDb:loud.truePeakDb, lra:loud.lra, clippedSamples:clipped, narrationClarityDb:clarityDb, longestSilenceSec:+longest.toFixed(2), durationSec:+(l.length / SAMPLE_RATE).toFixed(3)};
  if (videoFile) {
    const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,duration,sample_rate,channels', '-of', 'json', videoFile]);
    const streams = JSON.parse(stdout).streams, v = streams.find(s => s.codec_type === 'video'), a = streams.find(s => s.codec_type === 'audio');
    const drift = Math.abs(Number(a?.duration ?? 0) - Number(v?.duration ?? 0));
    // Sync: the first spoken word's onset in the video's audio must match its measured time
    const [va] = await decodeAudio(videoFile, {channels:1});
    const first = plan.words[0], from = Math.max(0, Math.floor((first.start - 0.4) * SAMPLE_RATE)), to = Math.floor((first.start + 0.4) * SAMPLE_RATE);
    const narr = stems.narration[0];
    // Cross-correlate the video's audio against the narration stem around that onset (+-60 ms)
    let best = 0, bestLag = 0;
    for (let lag = -Math.round(0.06 * SAMPLE_RATE); lag <= Math.round(0.06 * SAMPLE_RATE); lag += 24) {
      let s = 0; for (let i = from; i < to; i += 4) s += narr[i] * (va[i + lag] ?? 0);
      if (s > best) { best = s; bestLag = lag; }
    }
    result.video = {audioStream:!!a, sampleRate:a ? Number(a.sample_rate) : null, channels:a ? Number(a.channels) : null, durationDriftSec:+drift.toFixed(3), narrationOffsetMs:+(bestLag / SAMPLE_RATE * 1000).toFixed(1)};
    if (!a) issues.push({code:'NO_AUDIO_STREAM', message:'The video has no audio'});
    if (drift > 1 / plan.fps + 0.03) issues.push({code:'AV_DURATION_MISMATCH', message:`Audio and video durations differ by ${drift.toFixed(3)} s`});
    if (Math.abs(result.video.narrationOffsetMs) > 20) issues.push({code:'AV_SYNC_OFFSET', message:`Narration is ${result.video.narrationOffsetMs} ms off its words`});
  }
  return {status:issues.length ? 'review' : 'pass', ...result, issues};
}
