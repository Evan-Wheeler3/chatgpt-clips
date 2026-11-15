#!/usr/bin/env node
/*
 * Sound mix for hand-directed episodes (tools/episode/render.mjs). Same rules as the storyboard mixer
 * (tools/audio/mix.mjs): narration normalised to -16 LUFS and kept on top, effects ducked 3 dB under speech,
 * catalogued assets only (audio/catalog.json), master to -14 LUFS / -1.5 dBTP. Cues are word anchors or shot offsets.
 *   node tools/episode/mix.mjs stories/<slug>/story.json     -> production/<slug>/mix.wav + audio-report.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, join } from 'node:path';
import { SAMPLE_RATE, dbToGain, add } from '../audio/dsp.mjs';
import { writeWav, decodeAudio } from '../audio/wav.mjs';
import { loadCatalog, usableAsset, ROOT } from '../audio/catalog.mjs';
import { measureLoudness, duckCurve, TARGETS } from '../audio/mix.mjs';
import { resolveAnchor } from '../storyboard/anchors.mjs';
import { buildPlan } from './render.mjs';

const run = promisify(execFile);
const plan = await buildPlan(resolve(process.argv[2])), story = plan.story, out = plan.outDir;
const catalog = await loadCatalog(), n = Math.round(plan.durationSec * SAMPLE_RATE);
const shot = id => plan.shots.find(s => s.id === id) ?? (() => { throw new Error(`Unknown shot ${id}`); })();
const when = at => typeof at === 'number' ? at : at.shot ? shot(at.shot).startSec + (at.offset ?? 0) : resolveAnchor(plan.words, at, plan.fps).time;
const load = async id => { const a = usableAsset(catalog, id); const [x] = await decodeAudio(join(ROOT, a.file)); return {a, x}; };

// narration at its target loudness
const narr = (await decodeAudio(join(out, 'narration.wav')))[0], nl = await measureLoudness(join(out, 'narration.wav'));
const voice = new Float32Array(n); add(voice, narr, 0, dbToGain(TARGETS.narrationLufs - nl.integratedLufs));
// effects on word anchors and shot offsets, ducked under speech
const sfx = new Float32Array(n), cues = [];
for (const cue of story.audio?.sfx ?? []) {
  const {a, x} = await load(cue.asset), t = when(cue.at), g = cue.gainDb ?? a.gainDb ?? -12;
  add(sfx, x, t, dbToGain(g)); cues.push({asset:cue.asset, timeSec:+t.toFixed(3), gainDb:g, license:a.license, reason:cue.reason ?? null});
}
const duck = duckCurve(plan.words, n); for (let i = 0; i < n; i++) sfx[i] *= 1 + (dbToGain(TARGETS.sfxDuckDb) - 1) * duck[i];
// ambience per shot, with short fades across cuts
const amb = new Float32Array(n), F = Math.round(0.15 * SAMPLE_RATE);
for (const bed of story.audio?.ambience ?? []) {
  const {x} = await load(bed.asset), g = dbToGain(bed.gainDb ?? -28);
  for (const id of bed.shots) { const s = shot(id), i0 = Math.round(s.startSec * SAMPLE_RATE), i1 = Math.min(n, Math.round(s.endSec * SAMPLE_RATE)); for (let i = i0; i < i1; i++) amb[i] += x[i % x.length] * g * Math.min(1, (i - i0) / F, (i1 - i) / F); }
}
const mixed = new Float32Array(n); for (let i = 0; i < n; i++) mixed[i] = voice[i] + sfx[i] + amb[i];
const tail = Math.round(0.25 * SAMPLE_RATE); for (let i = 0; i < tail; i++) mixed[n - 1 - i] *= i / tail;
await writeWav(join(out, 'mix-premaster.wav'), [mixed, mixed], {float:true});
await writeWav(join(out, 'stem-sfx.wav'), sfx); await writeWav(join(out, 'stem-voice.wav'), voice);
await run('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(out, 'mix-premaster.wav'), '-af', `loudnorm=I=${TARGETS.lufs}:TP=${TARGETS.truePeakDb}:LRA=${TARGETS.lra}`, '-ar', String(SAMPLE_RATE), join(out, 'mix.wav')]);
const m = await measureLoudness(join(out, 'mix.wav')), v = await measureLoudness(join(out, 'stem-voice.wav')), e = await measureLoudness(join(out, 'stem-sfx.wav'));
const report = {standInNarration:plan.standIn, target:{lufs:TARGETS.lufs, truePeakDb:TARGETS.truePeakDb}, mix:m, voiceStemLufs:v.integratedLufs, sfxStemLufs:e.integratedLufs, cues};
await writeFile(join(out, 'audio-report.json'), JSON.stringify(report, null, 1));
console.log(`mix -> ${join(out, 'mix.wav')}  ${m.integratedLufs} LUFS, peak ${m.truePeakDb} dB; voice stem ${v.integratedLufs} LUFS, effects stem ${e.integratedLufs} LUFS, ${cues.length} cues`);
