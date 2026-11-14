import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate } from './narration/narrate.mjs';
import { compileFiles } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { renderAnimatic } from './storyboard/animatic.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = path => access(path).then(() => true, () => false);

// Voice first: narrate once, then iterate on story.json (cuts, moves, events) and re-run without touching models
async function main(args) {
  let storyPath, audioPath, narrateNow = false, render = false, scale = 1 / 3, strict = false;
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--story') storyPath=args[++i];
    else if (args[i] === '--narrate') narrateNow=true;
    else if (args[i] === '--audio') { audioPath=resolve(process.cwd(), args[++i]); narrateNow=true; }
    else if (args[i] === '--render') render=true;
    else if (args[i] === '--scale') scale=Number(args[++i]);
    else if (args[i] === '--strict') strict=true;
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!storyPath) throw new Error('Provide --story stories/<slug>/story.json');
  const story = JSON.parse(await readFile(resolve(process.cwd(), storyPath), 'utf8'));
  const outDir = resolve(root, 'production', story.slug);
  await mkdir(outDir, {recursive:true});
  const wordsPath = join(outDir, 'words.json');
  if (narrateNow) {
    const words = await narrate({slug:story.slug, narration:story.narration, outDir, audioPath});
    console.error(`narration: ${words.audio.durationSec.toFixed(2)} s, ${words.quality.exact}/${words.quality.scriptWords} words matched exactly`);
  } else if (!await exists(wordsPath)) throw new Error(`No ${relative(process.cwd(), wordsPath)}; run once with --narrate (or --audio <file>)`);

  const plan = await compileFiles(resolve(process.cwd(), storyPath), wordsPath);
  const validation = validatePlan(plan);
  await writeFile(join(outDir, 'shots.json'), JSON.stringify(plan, null, 2) + '\n');
  await writeFile(join(outDir, 'validation.json'), JSON.stringify(validation, null, 2) + '\n');
  let animatic = null;
  if (render) {
    animatic = await renderAnimatic(plan, {outDir, audioPath:join(outDir, 'narration.wav'), scale, issues:[...validation.errors, ...validation.warnings],
      onProgress:(done, total) => process.stderr.write(`\rrendering ${done}/${total}`)});
    process.stderr.write('\n');
  }
  const rel = path => relative(process.cwd(), path);
  process.stdout.write(JSON.stringify({
    status:validation.status, stats:validation.stats,
    errors:validation.errors.map(e => `${e.code} ${e.shot ?? e.prop ?? ''}${e.frames ? ` f${e.frames.join('-')}` : ''}: ${e.message}`),
    warnings:validation.warnings.map(w => `${w.code} ${w.shot ?? w.prop ?? ''}${w.frames ? ` f${w.frames.join('-')}` : ''}: ${w.message}`),
    missingAssets:plan.missingAssets,
    shots:plan.shots.map(s => `${s.id} ${(s.startFrame / plan.fps).toFixed(2)}-${(s.endFrame / plan.fps).toFixed(2)}s ${s.transition.type}->${s.camera.behavior} move f${s.camera.window.join('-')}`),
    outputs:{plan:rel(join(outDir, 'shots.json')), validation:rel(join(outDir, 'validation.json')), ...(animatic && {animatic:rel(animatic.video), storyboard:rel(animatic.sheet), size:animatic.size, renderMs:animatic.renderMs})}
  }, null, 2) + '\n');
  if (strict && validation.status !== 'pass') process.exitCode = 1;
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
