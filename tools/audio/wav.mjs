import { readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SAMPLE_RATE } from './dsp.mjs';

const run = promisify(execFile);

// Write mono or multichannel float data as a PCM WAV (16-bit, or 32-bit float for intermediate mixes)
export async function writeWav(file, channels, {sampleRate = SAMPLE_RATE, float = false} = {}) {
  const chans = Array.isArray(channels) ? channels : [channels], n = chans[0].length, c = chans.length, bytes = float ? 4 : 2;
  const data = Buffer.alloc(n * c * bytes);
  for (let i = 0; i < n; i++) for (let k = 0; k < c; k++) {
    const v = chans[k][i], o = (i * c + k) * bytes;
    if (float) data.writeFloatLE(v, o); else data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), o);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(float ? 3 : 1, 20); header.writeUInt16LE(c, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * c * bytes, 28); header.writeUInt16LE(c * bytes, 32); header.writeUInt16LE(bytes * 8, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([header, data]));
}

// Decode any audio file to float channels at the mix rate (ffmpeg does the format work)
export async function decodeAudio(file, {channels = 1, sampleRate = SAMPLE_RATE} = {}) {
  const {stdout} = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', String(channels), '-ar', String(sampleRate), '-'], {encoding:'buffer', maxBuffer:1024 * 1024 * 1024});
  const all = new Float32Array(stdout.buffer, stdout.byteOffset, stdout.length / 4);
  const n = all.length / channels;
  return Array.from({length:channels}, (_, k) => { const ch = new Float32Array(n); for (let i = 0; i < n; i++) ch[i] = all[i * channels + k]; return ch; });
}

export async function probeDuration(file) {
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(stdout.trim());
}

export { readFile };
