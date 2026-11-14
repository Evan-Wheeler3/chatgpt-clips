import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate } from './narration/narrate.mjs';
import { compileStory } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { renderAnimatic } from './storyboard/animatic.mjs';
import { renderQA } from './render/qa.mjs';
import { compareRenders } from './render/compare.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = path => access(path).then(() => true, () => false);

// Voice first: narrate once, then iterate on story.json (cuts, moves, events) and re-run without touching models
async function main(args) {
  let storyPath, audioPath, narrateNow = false, render = false, scale, strict = false, quality = 'animatic', qa = false, compare = null, name;
  const recast = {};
  for (let i=0; i<args.length; i++) {
    if (args[i] === '--story') storyPath=args[++i];
    else if (args[i] === '--narrate') narrateNow=true;
    else if (args[i] === '--audio') { audioPath=resolve(process.cwd(), args[++i]); narrateNow=true; }
    else if (args[i] === '--render') render=true;
    else if (args[i] === '--scale') scale=Number(args[++i]);
    else if (args[i] === '--strict') strict=true;
    else if (args[i] === '--quality') quality=args[++i];
    else if (args[i] === '--qa') qa=true;
    else if (args[i] === '--compare') compare=args[++i].split(',');
    // --recast bram=cooper-editorial renders the same story with another character design (story.json is untouched)
    else if (args[i] === '--recast') { const [id, character] = args[++i].split('='); recast[id] = character; }
    else if (args[i] === '--name') name=args[++i];
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

  for (const [id, character] of Object.entries(recast)) {
    const member = story.cast?.find(m => m.id === id);
    if (!member) throw new Error(`--recast: no cast member "${id}"`);
    member.character = character;
  }
  const [storyBytes, wordsBytes] = await Promise.all([readFile(resolve(process.cwd(), storyPath)), readFile(wordsPath)]);
  const plan = await compileStory(story, JSON.parse(wordsBytes), {storyBytes, wordsBytes});
  const validation = validatePlan(plan);
  // Recast renders are comparisons: they never overwrite the story's own plan and validation
  const suffix = Object.keys(recast).length ? `-${Object.values(recast).join('-')}` : '';
  await writeFile(join(outDir, `shots${suffix}.json`), JSON.stringify(plan, null, 2) + '\n');
  await writeFile(join(outDir, `validation${suffix}.json`), JSON.stringify(validation, null, 2) + '\n');
  let animatic = null;
  if (render) {
    animatic = await renderAnimatic(plan, {outDir, audioPath:join(outDir, 'narration.wav'), scale, quality, name, issues:[...validation.errors, ...validation.warnings],
      onProgress:(done, total) => process.stderr.write(`\rrendering ${done}/${total}`)});
    process.stderr.write('\n');
  }
  let qaReport = null;
  if (qa) {
    qaReport = await renderQA(plan, {quality:quality === 'animatic' ? 'preview' : quality});
    await writeFile(join(outDir, `qa-${qaReport.quality}.json`), JSON.stringify(qaReport, null, 2) + '\n');
  }
  let comparison = null;
  if (compare) comparison = await compareRenders(plan, {outDir, videos:compare});
  const rel = path => relative(process.cwd(), path);
  process.stdout.write(JSON.stringify({
    status:validation.status, stats:validation.stats,
    errors:validation.errors.map(e => `${e.code} ${e.shot ?? e.prop ?? ''}${e.frames ? ` f${e.frames.join('-')}` : ''}: ${e.message}`),
    warnings:validation.warnings.map(w => `${w.code} ${w.shot ?? w.prop ?? ''}${w.frames ? ` f${w.frames.join('-')}` : ''}: ${w.message}`),
    missingAssets:plan.missingAssets,
    shots:plan.shots.map(s => `${s.id} ${(s.startFrame / plan.fps).toFixed(2)}-${(s.endFrame / plan.fps).toFixed(2)}s ${s.transition.type}->${s.camera.behavior} move f${s.camera.window.join('-')}`),
    environment:plan.environment && {id:plan.environment.id, cache:plan.environment.cache, budget:plan.environment.budget, missing:plan.environment.missing},
    cast:(plan.cast ?? []).map(member => member.id),
    qa:qaReport && {status:qaReport.status, summary:qaReport.summary, warnings:qaReport.warnings.map(w => `${w.code} ${w.shot ?? ''}: ${w.message}`), ms:qaReport.ms},
    outputs:{plan:rel(join(outDir, `shots${suffix}.json`)), validation:rel(join(outDir, `validation${suffix}.json`)),
      ...(animatic && {video:rel(animatic.video), storyboard:rel(animatic.sheet), quality:animatic.quality, gpu:animatic.gpu, size:animatic.size, renderMs:animatic.renderMs}),
      ...(comparison && {comparisonVideo:rel(comparison.video), comparisonStills:rel(comparison.stills)})}
  }, null, 2) + '\n');
  if (strict && validation.status !== 'pass') process.exitCode = 1;
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
