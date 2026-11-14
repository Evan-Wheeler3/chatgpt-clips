// Stands in for tools/narration/local/clone_worker.py in tests: same request/response protocol, a sine tone instead of speech.
// Supports only "top_p", so other settings are reported as ignored (as the real worker does for unsupported ones).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const request = JSON.parse(readFileSync(process.argv[process.argv.indexOf('--request') + 1], 'utf8'));
if (process.env.FAKE_WORKER_FAIL) { console.error(JSON.stringify({error:'RuntimeError: model exploded'})); process.exit(1); }
const items = request.items.map(item => {
  const seconds = Math.max(1, item.text.length / 15);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=200:duration=${seconds}`, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', item.out]);
  const settings = item.settings ?? {};
  return {out:item.out, sampleRate:24000, audioSec:seconds, generateSec:0.1, realTimeFactor:0.02,
    applied:Object.fromEntries(Object.entries(settings).filter(([k]) => k === 'top_p')), ignored:Object.keys(settings).filter(k => k !== 'top_p'), text:item.text, refText:request.refText};
});
console.log(JSON.stringify({engine:'fake', engineVersion:'0.0-test', model:request.model, loadSec:0, supportedSettings:['top_p'], items}));
