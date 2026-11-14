import { createPolyHavenProvider } from './providers/polyhaven.mjs';
import { registerTexture } from './materials/textures.mjs';

// Fetches (cache-validated) a Poly Haven texture set and registers it after explicit review
async function main(args) {
  let provider, id, resolution = '1k', approve = false, approvedBy;
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--provider') provider=args[++i];
    else if (args[i] === '--id') id=args[++i];
    else if (args[i] === '--resolution') resolution=args[++i];
    else if (args[i] === '--approve') approve=true;
    else if (args[i] === '--approved-by') approvedBy=args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (provider !== 'polyhaven') throw new Error('Supported providers: polyhaven');
  if (!id) throw new Error('Provide --id');
  const fetched = await createPolyHavenProvider().fetchTexture(id, {resolution});
  if (!approve) {
    process.stdout.write(JSON.stringify({status:'fetched-not-registered', dir:fetched.dir, realSizeM:fetched.provenance.realSizeM,
      next:'Review the maps, then rerun with --approve --approved-by "<reviewer>"'}, null, 2) + '\n');
    return;
  }
  process.stdout.write(JSON.stringify(await registerTexture(fetched, {approve, approvedBy}), null, 2) + '\n');
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
