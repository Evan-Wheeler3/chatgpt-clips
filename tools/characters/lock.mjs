import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Locked files of an approved character folder; metadata.json records their SHA-256 so any change is deliberate
export const LOCKED_FILES = ['character.json', 'reference.png', 'regression/figure-snapshot.json', 'regression/flat-figures.png', 'regression/flat-faces.png', 'regression/scene-strip.png'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');

export async function lockStatus(id) {
  const dir = join(root, 'characters', id), meta = JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8'));
  const def = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'));
  const changed = [];
  for (const file of LOCKED_FILES) if (await sha256(join(dir, file)) !== meta.files[file]) changed.push(file);
  return {id, designVersion:def.design?.version, lockedVersion:meta.designVersion, versionMatches:def.design?.version === meta.designVersion, changed};
}

// Re-record the hashes (after a human-approved design change and a version bump)
export async function relock(id) {
  const dir = join(root, 'characters', id), path = join(dir, 'metadata.json'), meta = JSON.parse(await readFile(path, 'utf8'));
  const def = JSON.parse(await readFile(join(dir, 'character.json'), 'utf8'));
  meta.designVersion = def.design.version;
  for (const file of LOCKED_FILES) meta.files[file] = await sha256(join(dir, file));
  await writeFile(path, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const id = process.argv[2] ?? 'cooper';
  relock(id).then(m => process.stdout.write(JSON.stringify({id, designVersion:m.designVersion, files:m.files}, null, 2) + '\n'));
}
