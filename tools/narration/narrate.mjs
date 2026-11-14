import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { alignWords, spokenText } from './align.mjs';
import { transcribeIslands } from './whisper.mjs';
import { speechIslands } from './vad.mjs';

const run = promisify(execFile);

export async function audioDuration(path) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path]);
  return Number(stdout.trim());
}

// macOS `say` is a real local TTS engine; its embedded commands ([[slnc 250]], [[emph +]]) shape pauses and stress
async function synthesizeSay(script, {voice = 'Samantha', rate = 170}, outAiff) {
  if (process.platform !== 'darwin') throw new Error('The macos-say narration engine needs macOS; provide recorded audio with --audio instead');
  await run('say', ['-v', voice, '-r', String(rate), '-o', outAiff, script]);
}

// Produces narration.wav (48 kHz mono) and words.json with measured word timing; never estimates timing from text
export async function narrate({slug, narration, outDir, audioPath = null}) {
  await mkdir(outDir, {recursive:true});
  const work = await mkdtemp(join(tmpdir(), 'hold-up-narrate-'));
  try {
    let input = audioPath, source;
    if (!input) {
      if (narration.voice?.engine !== 'macos-say') throw new Error(`Unsupported narration engine: ${narration.voice?.engine}; provide recorded audio with --audio`);
      input = join(work, 'say.aiff');
      await synthesizeSay(narration.script, narration.voice, input);
      const {stdout} = await run('sw_vers', ['-productVersion']).catch(() => ({stdout:''}));
      source = {engine:'macos-say', voice:narration.voice.voice ?? 'Samantha', rate:narration.voice.rate ?? 170, macos:stdout.trim() || null};
    } else source = {engine:'provided', file:audioPath};
    const wav = join(outDir, 'narration.wav');
    const wav16 = join(work, 'narration-16k.wav');
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', wav]);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav16]);
    const {stdout:pcm} = await run('ffmpeg', ['-loglevel', 'error', '-i', wav16, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], {encoding:'buffer', maxBuffer:512 * 1024 * 1024});
    const {islands, threshold} = speechIslands(new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2), 16000);
    if (!islands.length) throw new Error('No speech found in the narration audio');
    const durationSec = await audioDuration(wav16);
    const {words:recognized, engine} = await transcribeIslands(wav16, islands, {durationSec});
    const {words, quality} = alignWords(narration.script, recognized);
    const data = await readFile(wav);
    const result = {
      version:1, slug, script:spokenText(narration.script).replace(/\s+/g, ' ').trim(),
      audio:{file:'narration.wav', sha256:createHash('sha256').update(data).digest('hex'), durationSec:await audioDuration(wav), sampleRate:48000},
      source, aligner:{...engine, silenceThreshold:Math.round(threshold)}, quality, islands, recognized, words
    };
    await writeFile(join(outDir, 'words.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { await rm(work, {recursive:true, force:true}); }
}
