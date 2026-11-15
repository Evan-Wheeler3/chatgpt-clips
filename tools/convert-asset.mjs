import { relative } from 'node:path';
import { createPolyHavenProvider } from './providers/polyhaven.mjs';
import { createSketchfabProvider } from './providers/sketchfab.mjs';
import { createGeneratedProvider } from './providers/generated.mjs';
import { createDerivedProvider } from './providers/derived.mjs';
import { loadSecrets } from './env.mjs';
import { convertAsset } from './convert/pipeline.mjs';

const PROVIDERS = {polyhaven:createPolyHavenProvider, sketchfab:createSketchfabProvider, generated:createGeneratedProvider, derived:createDerivedProvider};

// Fetches (cache-validated) and converts one provider asset to a validated GLB with a Three.js preview
async function main(args) {
  await loadSecrets(['SKETCHFAB_API_TOKEN']); // From the gitignored .env if not exported; never printed
  let provider, id, resolution = '1k', quantize = false, preview = true, force = false;
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--provider') provider=args[++i];
    else if (args[i] === '--id') id=args[++i];
    else if (args[i] === '--resolution') resolution=args[++i];
    else if (args[i] === '--quantize') quantize=true;
    else if (args[i] === '--no-preview') preview=false;
    else if (args[i] === '--force') force=true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!PROVIDERS[provider]) throw new Error(`Supported providers: ${Object.keys(PROVIDERS).join(', ')}`);
  if (!id) throw new Error('Provide --id');
  const source = await PROVIDERS[provider]().conversionSource(id, {resolution});
  const result = await convertAsset(source, {quantize, preview, force});
  const {report} = result;
  process.stdout.write(JSON.stringify({
    status:result.status, fetchStatus:source.fetchStatus, dir:relative(process.cwd(), result.dir),
    report:relative(process.cwd(), `${result.dir}/report.json`),
    validation:{status:report.validation.status, errors:report.validation.errors, warnings:report.validation.warnings},
    glb:report.glb, conversion:report.conversion, preview:report.preview,
    threejs:report.threejs && {revision:report.threejs.threeRevision, meshes:report.threejs.meshes.length, triangles:report.threejs.triangles, textures:report.threejs.textures}
  }, null, 2) + '\n');
  if (report.status !== 'passed') process.exitCode = 1;
}

main(process.argv.slice(2)).catch(err=>{console.error(err.code ? `${err.code}: ${err.message}` : err.message);process.exitCode=1;});
