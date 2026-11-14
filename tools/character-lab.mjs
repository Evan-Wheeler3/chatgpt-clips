import { writeFile, mkdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileStory } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { openRenderer } from './storyboard/animatic.mjs';
import { validateDefinition } from './characters/validate.mjs';
import { judgeCharacterMetrics } from './characters/metrics.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const exists = path => access(path).then(() => true, () => false);

// Design-review scene, not a production: a synthetic beat timeline (no narration) on a neutral studio stage
const TICKS = Array.from({length:48}, (_, i) => ({i, text:`t${i}`, start:i * 0.25, end:i * 0.25 + 0.2}));
const STUDIO = {background:'#6d7076', ground:{color:'#8a8d92'}, light:{key:'#fff3e2', keyIntensity:2.6, keyPosition:[2, 4, 3], sky:'#dfe6ef', bounce:'#6a6258', ambient:0.95, environment:0.5}};
export const POSES = [
  {id:'neutral', label:'Neutral', frame:27},
  {id:'three-quarter', label:'Three-quarter + gesture', frame:84},
  {id:'reaction', label:'Reaction', frame:122},
  {id:'interaction', label:'Pushes the barrel', frame:153}
];

export function labStory(character) {
  return {
    version:1, slug:'character-lab', captions:false, fps:30, size:{width:1080, height:1920}, stage:STUDIO,
    props:[{id:'barrel', asset:{query:'wooden barrel', style:'realistic'}, position:[0, 0, 0], rotation:[0, 15, 0]}],
    cast:[{id:'lead', character, start:{position:[-0.95, 0.25], face:[1, 0.25]}}],
    beats:[{id:'lab', purpose:'Character design review', shots:[
      {id:'neutral', purpose:'Full-body neutral', subject:'barrel', camera:{move:'hold', framing:'wide', azimuth:-12, elevation:5, focus:[-0.9, 0.2, 0]}},
      {id:'three-quarter', start:'t6', purpose:'Three-quarter angle with a presenting gesture', subject:'barrel', transition:{type:'cut', motivation:'New angle'},
        camera:{move:'hold', framing:'wide', azimuth:-48, elevation:8, focus:[-0.9, 0.2, 0]},
        events:[{character:'lead', at:'t7', do:'pose', params:{preset:'present', target:'barrel'}}]},
      {id:'reaction', start:'t12', purpose:'Expressive reaction', subject:'barrel', transition:{type:'cut', motivation:'Reaction'},
        camera:{move:'hold', framing:'medium', azimuth:-30, elevation:6, focus:[-1.0, 0.45, 0]},
        events:[{character:'lead', at:'t13', do:'pose', params:{preset:'surprised', target:'camera'}}]},
      {id:'interaction', start:'t18', purpose:'Physical interaction', subject:'barrel', transition:{type:'cut', motivation:'Action'},
        camera:{move:'hold', framing:'wide', azimuth:30, elevation:8, focus:[-0.6, 0, 0]},
        events:[
          {at:'shot-start', prop:'barrel', do:'set', params:{position:[0.1, 0, -0.45], rotation:[90, 330, 0]}},
          {character:'lead', at:'shot-start', do:'place', params:{position:[-0.75, 0.05], face:'barrel'}},
          {character:'lead', at:'shot-start', do:'pose', params:{preset:'ready', target:'barrel'}},
          {character:'lead', at:'t20', do:'push', params:{prop:'barrel'}, duration:0.35},
          {at:'t20', prop:'barrel', do:'roll', until:'t25', params:{distance:1.2, direction:[1, 0, 0]}, ease:'out'}
        ]}
    ]}]
  };
}

async function label(input, output, text, width) {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:-1,drawtext=fontfile=${FONT}:text='${text.replace(/'/g, '’').replace(/:/g, '\\:')}':x=10:y=10:fontsize=${Math.round(width / 18)}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`, output]);
}

async function grid(rows, output) {
  // rows: [[file, file, ...], ...] all the same size
  const inputs = rows.flat();
  const cols = rows[0].length;
  const filter = rows.map((row, r) => row.map((_, c) => `[${r * cols + c}:v]`).join('') + `hstack=inputs=${cols}[r${r}]`).join(';') + ';' + rows.map((_, r) => `[r${r}]`).join('') + `vstack=inputs=${rows.length}`;
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...inputs.flatMap(f => ['-i', f]), '-filter_complex', filter, output], {maxBuffer:64 * 1024 * 1024});
}

export async function runLab({candidates, outDir = join(root, 'production/character-lab'), quality = 'production', envFrames = [60, 124, 236, 252, 375]}) {
  await mkdir(join(outDir, 'frames'), {recursive:true});
  const report = {generatedAt:new Date().toISOString(), note:'Design review renders through the real character system. Studio scenes use a synthetic beat timeline, not narration.', candidates:[]};
  const sheetRows = [], envRows = [];
  for (const id of candidates) {
    const def = JSON.parse(await readFile(join(root, 'characters', `${id}.json`), 'utf8'));
    const plan = await compileStory(labStory(id), {words:TICKS, audio:{durationSec:12}});
    const validation = validatePlan(plan);
    const r = await openRenderer(plan, {quality});
    const row = [];
    let metrics;
    try {
      const images = await r.page.evaluate(list => window.renderFrames(list, 'image/png'), POSES.map(p => p.frame));
      for (const [k, image] of images.entries()) {
        const raw = join(outDir, 'frames', `${id}-${POSES[k].id}.png`);
        await writeFile(raw, Buffer.from(image.split(',')[1], 'base64'));
        const labelled = join(outDir, 'frames', `${id}-${POSES[k].id}-label.png`);
        await label(raw, labelled, `${def.generated?.family ?? 'Current: Bram (Phase 5)'} · ${POSES[k].label}`, 400);
        row.push(labelled);
      }
      metrics = await r.page.evaluate(list => window.characterMetrics(list), POSES.map(p => p.frame));
    } finally { await r.close(); }
    sheetRows.push(row);

    // Environment: the real barrel-bilge production render recast with this design (rendered separately via --recast)
    const video = join(root, 'production/barrel-bilge', id === 'bram' ? 'production.mp4' : `production-${id}.mp4`);
    if (await exists(video)) {
      const envRow = [];
      for (const f of envFrames) {
        const still = join(outDir, 'frames', `${id}-env-${f}.png`);
        await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-vf', `select='eq(n\\,${f})'`, '-frames:v', '1', still]);
        // Phone size: a 1080×1920 Short is shown about 390 points wide; judge legibility at that size
        const mobile = join(outDir, 'frames', `${id}-env-${f}-mobile.png`);
        await label(still, mobile, `${def.generated?.family ?? 'Current: Bram'} · f${f}`, 390);
        envRow.push(mobile);
      }
      envRows.push(envRow);
    }
    report.candidates.push({id, name:def.name, family:def.generated?.family ?? 'Phase 5 baseline', definition:validateDefinition(def),
      studioValidation:{status:validation.status, errors:validation.errors.map(e => e.code), warnings:validation.warnings.map(w => w.code)},
      metrics:judgeCharacterMetrics(metrics), frames:metrics});
  }
  const sheet = join(outDir, 'character-comparison.png');
  await grid(sheetRows, sheet);
  let envSheet = null;
  if (envRows.length) { envSheet = join(outDir, 'environment-comparison-mobile.png'); await grid(envRows, envSheet); }
  // Animated preview: the same production shots for every design, side by side at phone size with the narration
  const videos = [];
  for (const id of candidates) {
    const video = join(root, 'production/barrel-bilge', id === 'bram' ? 'production.mp4' : `production-${id}.mp4`);
    if (await exists(video)) videos.push({id, video, label:report.candidates.find(c => c.id === id).family});
  }
  let preview = null;
  if (videos.length > 1) {
    preview = join(outDir, 'animated-comparison.mp4');
    const filter = videos.map((v, i) => `[${i}:v]scale=390:-2,drawtext=fontfile=${FONT}:text='${v.label.replace(/'/g, '’').replace(/:/g, '\\:')}':x=8:y=8:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5[v${i}]`).join(';')
      + ';' + videos.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${videos.length}[v]`;
    await run('ffmpeg', ['-loglevel', 'error', '-y', ...videos.flatMap(v => ['-i', v.video]), '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '12.833', preview], {maxBuffer:64 * 1024 * 1024});
  }
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return {sheet, envSheet, preview, report};
}

// Range check for the design system: every archetype in every family, neutral pose, same studio camera
export async function runLineup({families = ['editorial', 'storyteller', 'cutout'], outDir = join(root, 'production/character-lab'), quality = 'production'} = {}) {
  const { buildDefinition, FAMILIES } = await import('./characters/design.mjs');
  const { readdir } = await import('node:fs/promises');
  const archetypes = (await readdir(join(root, 'characters/archetypes'))).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
  await mkdir(join(root, 'characters/archetype-previews'), {recursive:true});
  await mkdir(join(outDir, 'frames'), {recursive:true});
  const rows = [], checks = [];
  for (const family of families) {
    const row = [];
    for (const archetype of archetypes) {
      const person = {...JSON.parse(await readFile(join(root, 'characters/archetypes', `${archetype}.json`), 'utf8')), id:`${family}-${archetype}`};
      const def = buildDefinition(family, person);
      await writeFile(join(root, 'characters/archetype-previews', `${def.id}.json`), JSON.stringify(def));
      checks.push({id:def.id, ...validateDefinition(def)});
      const plan = await compileStory(labStory(`archetype-previews/${def.id}`), {words:TICKS, audio:{durationSec:12}});
      const r = await openRenderer(plan, {quality});
      try {
        const [image] = await r.page.evaluate(() => window.renderFrames([27], 'image/png'));
        const raw = join(outDir, 'frames', `lineup-${def.id}.png`), labelled = join(outDir, 'frames', `lineup-${def.id}-label.png`);
        await writeFile(raw, Buffer.from(image.split(',')[1], 'base64'));
        await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-vf', `crop=820:1500:10:120,scale=300:-1,drawtext=fontfile=${FONT}:text='${FAMILIES[family].label.split('·')[0].trim()} · ${person.name.replace(/'/g, '’')}':x=6:y=6:fontsize=15:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=4`, labelled]);
        row.push(labelled);
      } finally { await r.close(); }
    }
    rows.push(row);
  }
  const sheet = join(outDir, 'archetype-lineup.png');
  await grid(rows, sheet);
  return {sheet, checks};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--lineup')) {
  runLineup().then(r => process.stdout.write(JSON.stringify({sheet:r.sheet, checks:r.checks.map(c => ({id:c.id, status:c.status, warnings:c.warnings.map(w => w.code), errors:c.errors.map(e => e.message)}))}, null, 2) + '\n'))
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
} else if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const candidates = (args[args.indexOf('--candidates') + 1] ?? 'bram,cooper-editorial,cooper-storyteller,cooper-cutout').split(',');
  runLab({candidates}).then(r => process.stdout.write(JSON.stringify({sheet:r.sheet, envSheet:r.envSheet, preview:r.preview,
    summary:r.report.candidates.map(c => ({id:c.id, definition:c.definition.status, studio:c.studioValidation.status, metrics:c.metrics.summary, warnings:c.metrics.warnings.map(w => w.code)}))}, null, 2) + '\n'))
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
}
