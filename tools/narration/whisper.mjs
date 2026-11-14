import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, readFile, mkdtemp } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { placeInIsland } from './vad.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Pinned to an immutable revision of the official whisper.cpp model repo (MIT); hash from its Git LFS record
export const WHISPER_MODELS = {
  'base.en':{
    url:'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
    size:147964211, sha256:'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002', license:'MIT'
  }
};

async function sha256File(path) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function ensureWhisperModel(name = 'base.en', {cacheDir = resolve(root, '.cache/whisper'), fetch:fetchImpl = globalThis.fetch} = {}) {
  const model = WHISPER_MODELS[name];
  if (!model) throw new Error(`Unknown whisper model: ${name}`);
  const path = join(cacheDir, `ggml-${name}.bin`);
  const existing = await stat(path).catch(() => null);
  if (existing?.size === model.size && await sha256File(path) === model.sha256) return path;
  await mkdir(cacheDir, {recursive:true});
  const partial = `${path}.partial-${process.pid}`;
  try {
    const response = await fetchImpl(model.url, {headers:{'User-Agent':'hold-up-animation-v2/0.1.0'}});
    if (!response.ok || !response.body) throw new Error(`Whisper model download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if (await sha256File(partial) !== model.sha256) throw new Error('Whisper model failed SHA-256 verification');
    await rename(partial, path);
    return path;
  } catch (err) {
    await rm(partial, {force:true});
    throw err;
  }
}

async function whisperVersion(binary) {
  const {stdout} = await run('sh', ['-c', `realpath "$(command -v ${binary})"`]).catch(() => ({stdout:''}));
  return stdout.match(/whisper[.-]cpp\/([\d.]+)/)?.[1] ?? null;
}

async function transcribeFile(binary, modelPath, model, wavPath, outBase) {
  // One segment per word (-ml 1 -sow); DTW token alignment for tighter word boundaries
  await run(binary, ['-m', modelPath, '-f', wavPath, '-ml', '1', '-sow', '-oj', '-of', outBase, '-dtw', model, '-l', 'en', '-np'], {timeout:300000, maxBuffer:64 * 1024 * 1024});
  const json = JSON.parse(await readFile(`${outBase}.json`, 'utf8'));
  return json.transcription
    .map(segment => ({text:segment.text.trim(), start:segment.offsets.from / 1000, end:segment.offsets.to / 1000}))
    .filter(word => /[A-Za-z0-9]/.test(word.text));
}

// Transcribes each measured speech island separately and returns words with absolute times in seconds
export async function transcribeIslands(wav16kPath, islands, {model = 'base.en', binary = 'whisper-cli', padSec = 0.05, durationSec} = {}) {
  const modelPath = await ensureWhisperModel(model);
  const work = await mkdtemp(join(tmpdir(), 'hold-up-whisper-'));
  try {
    const words = [];
    for (const [n, island] of islands.entries()) {
      const from = Math.max(0, island.start - padSec);
      const to = Math.min(durationSec ?? Infinity, island.end + padSec);
      const chunk = join(work, `island-${n}.wav`);
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav16kPath, '-ss', from.toFixed(3), '-to', to.toFixed(3), '-c:a', 'pcm_s16le', chunk]);
      const found = await transcribeFile(binary, modelPath, model, chunk, join(work, `island-${n}`));
      words.push(...placeInIsland(found, island, from).map(word => ({...word, island:n})));
    }
    return {words, engine:{name:'whisper.cpp', binary, version:await whisperVersion(binary), model:`ggml-${model}`,
      modelSha256:WHISPER_MODELS[model].sha256, method:'energy-segmented islands, DTW word timestamps per island'}};
  } finally { await rm(work, {recursive:true, force:true}); }
}
