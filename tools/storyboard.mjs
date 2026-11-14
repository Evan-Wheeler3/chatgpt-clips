import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { narrate } from './narration/narrate.mjs';
import { loadVoiceProfile, authorize } from './narration/tts.mjs';
import { narrationSync } from './narration/sync.mjs';
import { mixStory, audioQA } from './audio/mix.mjs';
import { captionQA } from './captions/qa.mjs';
import { compileStory } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { renderAnimatic } from './storyboard/animatic.mjs';
import { renderQA } from './render/qa.mjs';
import { compareRenders } from './render/compare.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = path => access(path).then(() => true, () => false);

// Voice first: narrate once, then iterate on story.json (cuts, moves, events) and re-run without touching models
async function main(args) {
  let useTake = null, voice = null, approveSpend = null, approvedBy = null, verifyAlignment = false, take = null;
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
    // Narration: --voice <profile> (default: the approved Hold Up narrator); paid voices also need --approve-spend <usd> --approved-by "<name>"
    else if (args[i] === '--voice') { voice=args[++i]; narrateNow=true; }
    else if (args[i] === '--approve-spend') approveSpend=Number(args[++i]);
    else if (args[i] === '--approved-by') approvedBy=args[++i];
    else if (args[i] === '--verify-alignment') verifyAlignment=true;
    else if (args[i] === '--take') take=args[++i];
    // --use-take <id> makes an earlier narration take active again (no synthesis, no cost)
    else if (args[i] === '--use-take') useTake=args[++i];
    else throw new Error(`Unknown argument: ${args[i]}`);
  }
  if (!storyPath) throw new Error('Provide --story stories/<slug>/story.json');
  const story = JSON.parse(await readFile(resolve(process.cwd(), storyPath), 'utf8'));
  const outDir = resolve(root, 'production', story.slug);
  await mkdir(outDir, {recursive:true});
  const wordsPath = join(outDir, 'words.json');
  let syncReport = null;
  if (useTake) {
    const dir = join(outDir, 'takes', useTake);
    if (!await exists(join(dir, 'words.json'))) throw new Error(`No narration take "${useTake}" in ${relative(process.cwd(), join(outDir, 'takes'))}`);
    const previous = await exists(wordsPath) ? JSON.parse(await readFile(wordsPath, 'utf8')) : null;
    await copyFile(join(dir, 'narration.wav'), join(outDir, 'narration.wav'));
    await copyFile(join(dir, 'words.json'), wordsPath);
    if (previous) { syncReport = await narrationSync(story, previous, JSON.parse(await readFile(wordsPath, 'utf8'))); await writeFile(join(outDir, 'narration-sync.json'), JSON.stringify(syncReport, null, 2) + '\n'); }
  }
  if (narrateNow) {
    const previous = await exists(wordsPath) ? JSON.parse(await readFile(wordsPath, 'utf8')) : null;
    const profile = voice ? await loadVoiceProfile(voice) : null;
    const authorization = approveSpend ? authorize({by:approvedBy, maxUsd:approveSpend}) : null;
    const words = await narrate({slug:story.slug, narration:story.narration, outDir, audioPath, profile, authorization, verifyAlignment, take});
    console.error(`narration: ${words.source.engine} (${words.source.profile}), ${words.audio.durationSec.toFixed(2)} s, ${words.quality.exact}/${words.quality.scriptWords} words matched exactly, ${words.source.cached ? 'cached' : `$${words.source.costUsd}`}`);
    // New narration retimes everything through word anchors; report what moved and what needs an editorial decision
    if (previous) {
      syncReport = await narrationSync(story, previous, words);
      await writeFile(join(outDir, 'narration-sync.json'), JSON.stringify(syncReport, null, 2) + '\n');
      console.error(`narration sync: ${syncReport.status}${syncReport.conflicts.length ? ` (${syncReport.conflicts.map(c => c.code).join(', ')})` : ''}`);
      if (syncReport.status === 'blocked') throw new Error(`The new narration does not fit the storyboard: ${syncReport.conflicts.filter(c => c.severity === 'error').map(c => c.message).join('; ')}`);
    }
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
  let mix = null, mixQA = null, captionReport = null;
  if (render) {
    // Stories with an audio block render with their mix (narration + effects + ambience + music); others with narration only
    const base = name ?? (quality === 'animatic' ? 'animatic' : quality);
    if (story.audio) {
      mix = await mixStory({plan, story, narrationFile:join(outDir, 'narration.wav'), outDir:join(outDir, 'audio', base)});
      console.error(`mix: ${mix.report.events.length} effects${mix.report.ambience ? `, ambience ${mix.report.ambience.profile}` : ''}${mix.report.music ? `, music ${mix.report.music.asset}` : ''}`);
    }
    animatic = await renderAnimatic(plan, {outDir, audioPath:mix?.file ?? join(outDir, 'narration.wav'), scale, quality, name, issues:[...validation.errors, ...validation.warnings],
      onProgress:(done, total) => process.stderr.write(`\rrendering ${done}/${total}`)});
    process.stderr.write('\n');
    if (mix) {
      mixQA = await audioQA({mixFile:mix.file, stems:mix.stems, plan, videoFile:animatic.video});
      await writeFile(join(outDir, `qa-audio-${base}.json`), JSON.stringify(mixQA, null, 2) + '\n');
    }
    if (plan.captions?.enabled) {
      captionReport = await captionQA(plan, {quality});
      await writeFile(join(outDir, `qa-captions-${base}.json`), JSON.stringify(captionReport, null, 2) + '\n');
    }
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
    audioQA:mixQA && {status:mixQA.status, integratedLufs:mixQA.integratedLufs, truePeakDb:mixQA.truePeakDb, narrationClarityDb:mixQA.narrationClarityDb, video:mixQA.video, issues:mixQA.issues.map(i => i.code)},
    captionQA:captionReport && {status:captionReport.status, issues:captionReport.issues.map(i => `${i.code}: ${i.message}`), warnings:captionReport.warnings.map(w => `${w.code}: ${w.message}`)},
    narrationSync:syncReport && {status:syncReport.status, durationSec:syncReport.durationSec, conflicts:syncReport.conflicts.map(c => `${c.code} ${c.shot ?? ''}: ${c.message}`)},
    qa:qaReport && {status:qaReport.status, summary:qaReport.summary, warnings:qaReport.warnings.map(w => `${w.code} ${w.shot ?? ''}: ${w.message}`), ms:qaReport.ms},
    outputs:{plan:rel(join(outDir, `shots${suffix}.json`)), validation:rel(join(outDir, `validation${suffix}.json`)),
      ...(animatic && {video:rel(animatic.video), storyboard:rel(animatic.sheet), quality:animatic.quality, gpu:animatic.gpu, size:animatic.size, renderMs:animatic.renderMs}),
      ...(comparison && {comparisonVideo:rel(comparison.video), comparisonStills:rel(comparison.stills)})}
  }, null, 2) + '\n');
  if (strict && validation.status !== 'pass') process.exitCode = 1;
}

main(process.argv.slice(2)).catch(err=>{console.error(err.message);process.exitCode=1;});
