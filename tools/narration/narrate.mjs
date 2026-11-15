import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { alignWords, spokenText } from './align.mjs';
import { transcribeIslands } from './whisper.mjs';
import { speechIslands } from './vad.mjs';
import { createProvider, narratorFor, synthesize } from './tts.mjs';
import { forcedAlign, forcedAlignerAvailable } from './forced-align.mjs';
import { markedPauses, plainText } from './markup.mjs';

const run = promisify(execFile);

export async function audioDuration(path) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return Number(stdout.trim());
}

export async function whisperWords(wav16) {
  const {stdout:pcm} = await run('ffmpeg', ['-loglevel', 'error', '-i', wav16, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], {encoding:'buffer', maxBuffer:512 * 1024 * 1024});
  const {islands, threshold} = speechIslands(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), 16000);
  if (!islands.length) throw new Error('No speech found in the narration audio');
  const {words, engine} = await transcribeIslands(wav16, islands, {durationSec:await audioDuration(wav16)});
  return {words, engine, islands, threshold};
}

// Mean absolute difference between two word timelines over the words both aligned exactly (seconds)
export function timingAgreement(a, b) {
  const pairs = a.map((w, i) => [w, b[i]]).filter(([x, y]) => x?.match === 'exact' && y?.match === 'exact');
  const diffs = pairs.flatMap(([x, y]) => [Math.abs(x.start - y.start), Math.abs(x.end - y.end)]);
  return {words:pairs.length, meanAbsSec:diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null, maxAbsSec:diffs.length ? Math.max(...diffs) : null};
}

// How much of each intentionally marked pause survived delivery (measured silence between the two words)
export function pauseReport(script, words) {
  return markedPauses(script).filter(p => words[p.afterWord + 1]).map(p => ({after:words[p.afterWord].text, markedMs:p.ms, measuredMs:Math.round((words[p.afterWord + 1].start - words[p.afterWord].end) * 1000)}));
}

/*
 * One narration take: synthesize (or import) audio, measure word timing, and make it the story's active narration.
 * Writes production/<slug>/takes/<take>/{narration.wav, words.json} and copies both to production/<slug>/ (active).
 * Timing is always measured: the provider's alignment when it returns one, otherwise whisper.cpp; never estimated from text.
 */
// Is the last word cut off? Loudness of the file's final 20 ms (PCM16 WAV) and the room left after the last word.
// A natural ending has decayed well below speech level before the file ends.
export const ENDING_CUT_DB = -45;
export function endingReport(wav, words) {
  let rate = 48000, p = 12, data = null;
  while (p + 8 <= wav.length) {
    const id = wav.toString('ascii', p, p + 4), size = wav.readUInt32LE(p + 4);
    if (id === 'fmt ') rate = wav.readUInt32LE(p + 12);
    if (id === 'data') { data = wav.subarray(p + 8, Math.min(wav.length, p + 8 + size)); break; }
    p += 8 + size + (size % 2);
  }
  if (!data) throw new Error('No PCM data chunk in narration WAV');
  const samples = data.length >> 1, n = Math.min(samples, Math.round(rate * 0.02));
  let sum = 0;
  for (let i = samples - n; i < samples; i++) { const v = data.readInt16LE(i * 2) / 32768; sum += v * v; }
  const finalDb = +(10 * Math.log10(sum / Math.max(1, n) + 1e-12)).toFixed(1), fileEndSec = +(samples / rate).toFixed(3);
  const lastWordEndSec = words.at(-1)?.end ?? 0;
  return {lastWordEndSec, fileEndSec, silenceAfterLastWordSec:+(fileEndSec - lastWordEndSec).toFixed(3), finalDb, cut:finalDb > ENDING_CUT_DB};
}

export async function narrate({slug, narration, outDir, audioPath = null, profile = null, authorization = null, verifyAlignment = false, take = null}) {
  await mkdir(outDir, {recursive:true});
  const work = await mkdtemp(join(tmpdir(), 'hold-up-narrate-'));
  try {
    const voice = audioPath ? {profile:{id:'recording', provider:'recorded', file:audioPath, delivery:{}}, reason:'supplied recording'} : profile ? {profile, reason:'requested profile'} : await narratorFor(narration);
    const provider = await createProvider(voice.profile.provider);
    const synth = await synthesize({provider, profile:voice.profile, script:narration.script}, {authorization});
    const input = synth.audioPath;
    const takeId = take ?? `${voice.profile.id}-${synth.key.slice(0, 8)}`;
    const takeDir = join(outDir, 'takes', takeId);
    await mkdir(takeDir, {recursive:true});
    const wav = join(takeDir, 'narration.wav'), wav16 = join(work, 'narration-16k.wav');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav16]);

    let words, quality, aligner, islands = null, recognized;
    let whisper = null;
    if (synth.words?.length) {
      recognized = synth.words;
      ({words, quality} = alignWords(narration.script, recognized));
      aligner = {engine:`${provider.id}-alignment`, note:'character timestamps returned with the audio'};
      if (verifyAlignment) whisper = await whisperWords(wav16);
    } else if (await forcedAlignerAvailable()) {
      // Forced alignment of the known script (measured); whisper only when asked to cross-check
      const forced = await forcedAlign(wav16, plainText(narration.script));
      recognized = forced.words;
      ({words, quality} = alignWords(narration.script, recognized));
      aligner = forced.engine;
      if (verifyAlignment) whisper = await whisperWords(wav16);
    } else {
      whisper = await whisperWords(wav16);
      recognized = whisper.words; islands = whisper.islands;
      ({words, quality} = alignWords(narration.script, recognized));
      aligner = {...whisper.engine, silenceThreshold:Math.round(whisper.threshold)};
    }
    const crossCheck = whisper && recognized !== whisper.words ? timingAgreement(words, alignWords(narration.script, whisper.words).words) : null;
    const data = await readFile(wav);
    const result = {
      version:1, slug, take:takeId, script:spokenText(narration.script).replace(/\s+/g, ' ').trim(),
      audio:{file:'narration.wav', sha256:createHash('sha256').update(data).digest('hex'), durationSec:await audioDuration(wav), sampleRate:48000},
      source:{engine:provider.id, profile:voice.profile.id, reason:voice.reason, voiceId:voice.profile.voiceId ?? null, modelId:voice.profile.modelId ?? null, settings:voice.profile.settings ?? null,
        renderedText:synth.renderedText, cached:synth.cached, costUsd:synth.costUsd, cacheKey:synth.key},
      aligner, alignmentCrossCheck:crossCheck, quality, pauses:pauseReport(narration.script, words), ending:endingReport(data, words), islands, recognized, words
    };
    await writeFile(join(takeDir, 'words.json'), JSON.stringify(result, null, 2) + '\n');
    await copyFile(wav, join(outDir, 'narration.wav'));
    await copyFile(join(takeDir, 'words.json'), join(outDir, 'words.json'));
    return result;
  } finally { await rm(work, {recursive:true, force:true}); }
}
