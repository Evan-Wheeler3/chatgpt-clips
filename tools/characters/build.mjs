import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDefinition } from './design.mjs';
import { validateDefinition } from './validate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Builds characters/<id>.json from characters/specs/*.json (family × person); generated files are committed for review
export async function buildSpecs({specDir = join(root, 'characters/specs'), outDir = join(root, 'characters')} = {}) {
  const built = [];
  for (const file of (await readdir(specDir)).filter(f => f.endsWith('.json')).sort()) {
    const spec = JSON.parse(await readFile(join(specDir, file), 'utf8'));
    const person = spec.archetype ? {...JSON.parse(await readFile(join(root, 'characters/archetypes', `${spec.archetype}.json`), 'utf8')), ...spec.person} : spec.person;
    const def = buildDefinition(spec.family, person);
    const report = validateDefinition(def);
    await writeFile(join(outDir, `${def.id}.json`), JSON.stringify(def, null, 1) + '\n');
    built.push({id:def.id, family:spec.family, ...report});
  }
  return built;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildSpecs().then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(err => { console.error(err.message); process.exitCode = 1; });
}
