import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * Reads named secrets from the repository's gitignored .env file into process.env, without overriding values already
 * exported in the shell. Only the names asked for are read; values are never printed, logged or returned.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text, names) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || !names.includes(m[1])) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (value) out[m[1]] = value;
  }
  return out;
}

export async function loadSecrets(names, {file = resolve(root, '.env'), env = process.env} = {}) {
  let text;
  try { text = await readFile(file, 'utf8'); } catch { return; } // No .env: rely on the shell
  for (const [name, value] of Object.entries(parseEnv(text, names))) if (!env[name]) env[name] = value;
}
