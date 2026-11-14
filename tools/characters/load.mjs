import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

// Characters live either as characters/<id>.json (Phase 5 designs, legacy Bram) or as a folder,
// characters/<id>/character.json, next to their reference, approved renders and regression baselines (the master cooper)
export async function characterFile(rootDir, id) {
  const folder = resolve(rootDir, 'characters', id, 'character.json');
  try { await access(folder); return folder; } catch { return resolve(rootDir, 'characters', `${id}.json`); }
}

export async function loadCharacter(rootDir, id) {
  return JSON.parse(await readFile(await characterFile(rootDir, id), 'utf8'));
}
