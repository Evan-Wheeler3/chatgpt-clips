import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderScript } from '../markup.mjs';

const run = promisify(execFile);

// macOS `say`: the original development narrator, kept as a free fallback (no word timestamps: whisper aligns it)
export function createMacSay() {
  return {
    id:'macos-say', paid:false,
    render:(script, profile) => renderScript(script, 'macos-say', profile.delivery),
    estimate:text => ({characters:text.length, usd:0}),
    cacheKey:(text, profile) => ({provider:'macos-say', voice:profile.voiceId ?? 'Samantha', rate:profile.settings?.rate ?? 170, text}),
    async synthesize(text, profile) {
      if (process.platform !== 'darwin') throw new Error('The macos-say narrator needs macOS; use another voice profile or a recording');
      const dir = await mkdtemp(join(tmpdir(), 'hold-up-say-'));
      try {
        const out = join(dir, 'say.aiff');
        await run('say', ['-v', profile.voiceId ?? 'Samantha', '-r', String(profile.settings?.rate ?? 170), '-o', out, text]);
        return {audio:await readFile(out), extension:'aiff', words:null, response:null};
      } finally { await rm(dir, {recursive:true, force:true}); }
    }
  };
}

// A human recording (or any supplied audio file): free; timing comes from whisper alignment against the script
export function createRecorded() {
  return {
    id:'recorded', paid:false,
    render:script => renderScript(script, 'plain'),
    estimate:text => ({characters:text.length, usd:0}),
    cacheKey:(text, profile) => ({provider:'recorded', file:profile.file, text}),
    async synthesize(text, profile) {
      if (!profile.file) throw new Error('A recorded narration needs a file (--audio <file>)');
      return {audio:await readFile(profile.file), extension:extname(profile.file).slice(1) || 'wav', words:null, response:null};
    }
  };
}
