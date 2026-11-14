import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { paths, manifest, VOICE_DIR } from './voice.mjs';

/*
 * Forced word alignment (Qwen3-ForcedAligner 0.6B, Apache-2.0, via mlx-audio; offline). It measures where each word of the
 * known script is spoken, so it cannot drift onto the wrong words or collapse the end of a take the way free transcription
 * timestamps can. It reports times on a fixed step (0.08 s); words shorter than one step come back with zero length.
 */
const run = promisify(execFile);
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), 'local/align_worker.py');
export const ALIGNER_STEP_SEC = 0.08;

export async function forcedAlignerAvailable(voiceDir = VOICE_DIR) {
  const m = await manifest(voiceDir);
  return m?.aligner?.modelDir ? m : null;
}

/*
 * A word shorter than the aligner's step shares the step with the word it touches: it takes up to half of the next word's
 * first step (or, at the end, the previous word's last). Every word then has a span, and no boundary moves by more
 * than half a step (40 ms), inside the aligner's own resolution. Such words are marked timing: 'within-aligner-step'.
 */
export function resolveSubStepWords(words, step = ALIGNER_STEP_SEC) {
  const out = words.map(w => ({...w}));
  for (let i = 0; i < out.length; i++) {
    const w = out[i];
    if (w.end - w.start > 1e-6) continue;
    const next = out[i + 1], prev = out[i - 1];
    if (next && next.start <= w.end + 1e-6 && next.end - next.start > 1e-6) {
      const share = Math.min(step / 2, (next.end - next.start) / 2);
      w.end = +(w.start + share).toFixed(3); next.start = w.end;
    } else if (prev && prev.end >= w.start - 1e-6 && prev.end - prev.start > 1e-6) {
      const share = Math.min(step / 2, (prev.end - prev.start) / 2);
      w.start = +(w.end - share).toFixed(3); prev.end = w.start;
    } else continue;
    w.timing = 'within-aligner-step';
  }
  return out;
}

export async function forcedAlign(wavPath, text, {voiceDir = VOICE_DIR, python = null, worker = WORKER, runner = run} = {}) {
  const m = await forcedAlignerAvailable(voiceDir);
  if (!m) throw new Error('The forced aligner is not installed (node tools/narration/voice.mjs install --aligner)');
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-align-'));
  try {
    const request = join(dir, 'request.json');
    await writeFile(request, JSON.stringify({model:m.aligner.modelDir, audio:wavPath, text, language:'English'}));
    let stdout;
    try { ({stdout} = await runner(python ?? paths(voiceDir).python, [worker, '--request', request], {maxBuffer:64 * 1024 * 1024, timeout:10 * 60 * 1000})); }
    catch (err) { throw new Error(`Forced alignment failed: ${String(err.stderr || err.message).trim().split('\n').at(-1)}`); }
    const report = JSON.parse(String(stdout).trim().split('\n').at(-1));
    return {words:resolveSubStepWords(report.words), engine:{name:'qwen3-forced-aligner', model:m.aligner.repo, version:report.engineVersion, stepSec:ALIGNER_STEP_SEC,
      method:'forced alignment of the known script; sub-step words share a step with their neighbour'}};
  } finally { await rm(dir, {recursive:true, force:true}); }
}
