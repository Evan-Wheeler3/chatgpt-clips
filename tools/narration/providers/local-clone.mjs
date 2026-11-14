import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderScript } from '../markup.mjs';
import { ENGINES, DEFAULT_ENGINE, WORKER, paths, manifest, loadVoice } from '../voice.mjs';

const run = promisify(execFile);

/*
 * Local voice cloning (free, offline after install): the enrolled reference voice speaks the script through the installed
 * engine (tools/narration/local/clone_worker.py). Output is WAV; word timing comes from whisper.cpp alignment.
 * Profile: {provider:'local-clone', engine, voice:<enrolled id>, settings:{...sampling settings}, seed, delivery}
 */
export function createLocalClone({python = null, worker = WORKER, voiceDir, privateDir, runner = run} = {}) {
  const ready = async () => {
    const m = await manifest(voiceDir);
    if (!m) throw Object.assign(new Error('The local voice engine is not installed: run `node tools/narration/voice.mjs install` (it shows the download size first)'), {code:'not-installed'});
    return m;
  };
  return {
    id:'local-clone', paid:false,
    render:(script, profile) => renderScript(script, 'punctuation', profile.delivery),
    estimate:text => ({characters:text.length, usd:0}),
    // The cache key covers everything that changes the audio: engine build, model, the exact reference recording, settings, text
    cacheKey:(text, profile) => ({provider:'local-clone', engine:profile.engine ?? DEFAULT_ENGINE, voice:profile.voice, referenceSha256:profile.referenceSha256 ?? null,
      model:profile.model ?? ENGINES[profile.engine ?? DEFAULT_ENGINE].repo, engineVersion:profile.engineVersion ?? null, settings:profile.settings ?? {}, seed:profile.seed ?? null, text}),
    async prepare(profile) {
      const m = await ready(), voice = await loadVoice(profile.voice, privateDir);
      return {...profile, referenceSha256:voice.reference.sha256, engineVersion:m.packages?.['mlx-audio'] ?? null, model:m.repo};
    },
    async synthesize(text, profile) {
      const m = await ready(), voice = await loadVoice(profile.voice, privateDir);
      const dir = await mkdtemp(join(tmpdir(), 'hold-up-clone-'));
      try {
        const out = join(dir, 'out.wav'), request = join(dir, 'request.json');
        await writeFile(request, JSON.stringify({model:m.modelDir, refAudio:voice.referencePath, refText:voice.transcript, seed:profile.seed ?? null, items:[{text, out, settings:profile.settings ?? {}}]}));
        let stdout;
        try { ({stdout} = await runner(python ?? paths(voiceDir).python, [worker, '--request', request], {maxBuffer:64 * 1024 * 1024, timeout:15 * 60 * 1000})); }
        catch (err) {
          const detail = (() => { try { return JSON.parse(String(err.stderr).trim().split('\n').at(-1)).error; } catch { return String(err.stderr || err.message).slice(-400); } })();
          throw Object.assign(new Error(`Local voice generation failed: ${detail}`), {code:'engine-error'});
        }
        const report = JSON.parse(String(stdout).trim().split('\n').at(-1));
        return {audio:await readFile(out), extension:'wav', words:null, response:{engine:report.engine, engineVersion:report.engineVersion, loadSec:report.loadSec, supportedSettings:report.supportedSettings, ...report.items[0]}};
      } finally { await rm(dir, {recursive:true, force:true}); }
    }
  };
}
