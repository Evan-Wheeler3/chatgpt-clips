import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Minimal .env loader (KEY=value lines; no dependency). Values never leave this process: callers get only what they ask for,
// and secrets are never echoed in logs or errors
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function loadEnv(file = resolve(root, '.env'), env = process.env) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return env; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (env[m[1]] === undefined) env[m[1]] = value;
  }
  return env;
}
export const redact = key => key ? `${'*'.repeat(Math.max(0, key.length - 4))}${key.slice(-4)}` : '(not set)';
