import { relative } from 'node:path';
import { createPolyHavenProvider } from './providers/polyhaven.mjs';
import { createSketchfabProvider } from './providers/sketchfab.mjs';
import { createGeneratedProvider } from './providers/generated.mjs';
import { loadSecrets } from './env.mjs';

const PROVIDERS = {polyhaven:createPolyHavenProvider, sketchfab:createSketchfabProvider, generated:createGeneratedProvider};

// Explicit, per-asset download into assets/cache; it never edits assets/catalog.json
async function main(args) {
  await loadSecrets(['SKETCHFAB_API_TOKEN']); // From the gitignored .env if not exported; never printed
  let provider, id, resolution = '1k';
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--provider') provider=args[++i];
    else if (args[i] === '--id') id=args[++i];
    else if (args[i] === '--resolution') resolution=args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!PROVIDERS[provider]) throw new Error(`Supported providers: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!id) throw new Error('Provide --id');
  const result = await PROVIDERS[provider]().fetchModel(id, {resolution});
  process.stdout.write(JSON.stringify({...result, dir:relative(process.cwd(), result.dir)}, null, 2) + '\n');
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
