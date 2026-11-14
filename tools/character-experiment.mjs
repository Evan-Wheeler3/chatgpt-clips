import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileStory } from './storyboard/compile.mjs';
import { openRenderer } from './storyboard/animatic.mjs';
import { validateDefinition } from './characters/validate.mjs';
import { judgeCharacterMetrics } from './characters/metrics.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

// Design-review stills only (no video). The studio uses a synthetic beat timeline, not narration;
// invisible props give the camera something to frame (full body, head and shoulders).
const TICKS = Array.from({length:24}, (_, i) => ({i, text:`t${i}`, start:i * 0.25, end:i * 0.25 + 0.2}));
const STUDIO = {background:'#8e9196', ground:{color:'#a3a6aa'}, light:{key:'#fff3e2', keyIntensity:2.4, keyPosition:[2, 4, 3], sky:'#e6ebf2', bounce:'#7a7268', ambient:1.0, environment:0.5}};
export const STILLS = [
  {id:'1-full-body-neutral', label:'Full body · neutral', frame:20},
  {id:'2-closeup-neutral', label:'Head & shoulders · neutral', frame:50},
  {id:'3-closeup-surprised', label:'Head & shoulders · surprised', frame:80},
  {id:'4-with-barrel', label:'Full body · with the 3D barrel', frame:110},
  {id:'5-cooperage', label:'Cooperage · production lighting', frame:null}
];

export function studioStory(character) {
  return {
    version:1, slug:'character-experiment', captions:false, fps:30, size:{width:1080, height:1920}, stage:STUDIO,
    props:[
      {id:'frame-body', asset:{query:'wooden barrel'}, position:[0, 0, -0.7], visible:false},
      {id:'frame-head', asset:{query:'wooden barrel'}, position:[0, 1.02, -0.05], scale:0.42, grounded:false, visible:false},
      {id:'barrel', asset:{query:'wooden barrel'}, position:[0.72, 0, 0.05], rotation:[0, 15, 0], visible:false}
    ],
    cast:[{id:'lead', character, start:{position:[0, 0], face:[1, 0, 0.55]}}],
    beats:[{id:'stills', purpose:'Character design stills', shots:[
      {id:'full', purpose:'Full-body neutral', subject:'frame-body', camera:{move:'hold', framing:'wide', azimuth:22, elevation:4, focus:[0, 0.38, 0]}},
      {id:'close', start:'t4', purpose:'Head and shoulders, neutral', subject:'frame-head', transition:{type:'cut', motivation:'Close-up'}, camera:{move:'hold', framing:'medium', azimuth:22, elevation:2}},
      {id:'surprised', start:'t8', purpose:'Head and shoulders, surprised', subject:'frame-head', transition:{type:'cut', motivation:'Reaction'}, camera:{move:'hold', framing:'medium', azimuth:22, elevation:2},
        events:[{character:'lead', at:'shot-start', do:'expression', params:{face:'surprised'}}]},
      {id:'barrel', start:'t12', purpose:'Full body beside the real barrel', subject:'barrel', transition:{type:'cut', motivation:'Prop'}, camera:{move:'hold', framing:'wide', azimuth:18, elevation:5, focus:[-0.75, 0.3, 0]},
        events:[
          {at:'shot-start', prop:'barrel', do:'appear'},
          {character:'lead', at:'shot-start', do:'place', params:{position:[0, 0], face:'barrel'}},
          {character:'lead', at:'shot-start', do:'expression', params:{face:'neutral'}},
          {character:'lead', at:'t13', do:'pose', params:{preset:'present', target:'barrel'}}
        ]}
    ]}]
  };
}

async function label(input, output, text, width) {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:-1,drawtext=fontfile=${FONT}:text='${text.replace(/'/g, '’').replace(/:/g, '\\:')}':x=8:y=8:fontsize=${Math.max(14, Math.round(width / 22))}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=5`, output]);
}

async function renderStills(character, outDir, prefix) {
  const plan = await compileStory(studioStory(character), {words:TICKS, audio:{durationSec:6}});
  const files = [];
  const r = await openRenderer(plan, {quality:'production'});
  let metrics;
  try {
    const frames = STILLS.filter(s => s.frame !== null).map(s => s.frame);
    const images = await r.page.evaluate(list => window.renderFrames(list, 'image/png'), frames);
    for (const [k, image] of images.entries()) {
      const file = join(outDir, `${prefix}-${STILLS[k].id}.png`);
      await writeFile(file, Buffer.from(image.split(',')[1], 'base64'));
      files.push(file);
    }
    metrics = await r.page.evaluate(list => window.characterMetrics(list), frames);
  } finally { await r.close(); }
  // The real barrel-bilge staging, production lighting, one still (no video)
  const story = JSON.parse(await readFile(join(root, 'stories/barrel-bilge/story.json'), 'utf8'));
  story.cast[0].character = character;
  const words = JSON.parse(await readFile(join(root, 'production/barrel-bilge/words.json'), 'utf8'));
  const envPlan = await compileStory(story, words);
  const e = await openRenderer(envPlan, {quality:'production'});
  try {
    const [image] = await e.page.evaluate(() => window.renderFrames([60], 'image/png'));
    const file = join(outDir, `${prefix}-${STILLS[4].id}.png`);
    await writeFile(file, Buffer.from(image.split(',')[1], 'base64'));
    files.push(file);
    metrics.push(...await e.page.evaluate(() => window.characterMetrics([60])));
  } finally { await e.close(); }
  return {files, metrics};
}

export async function runExperiment({character, baseline = 'bram', outDir}) {
  await mkdir(join(outDir, 'baseline'), {recursive:true});
  await mkdir(join(outDir, 'tmp'), {recursive:true});
  const def = JSON.parse(await readFile(join(root, 'characters', `${character}.json`), 'utf8'));
  const exp = await renderStills(character, outDir, 'experiment');
  const base = await renderStills(baseline, join(outDir, 'baseline'), 'bram');
  // Comparison sheet: inspection size (540 px panels) and phone size (a full-screen Short is ~390 pt wide)
  const sheets = {};
  for (const [name, width] of [['comparison', 540], ['comparison-phone', 390]]) {
    const rows = [];
    for (const [title, set] of [['Bram (Phase 5)', base.files], [def.name, exp.files]]) {
      const row = [];
      for (const [k, file] of set.entries()) {
        const out = join(outDir, 'tmp', `${name}-${title.replace(/\W+/g, '')}-${k}.png`);
        await label(file, out, `${title} · ${STILLS[k].label}`, width);
        row.push(out);
      }
      rows.push(row);
    }
    const inputs = rows.flat();
    const filter = rows.map((row, r) => row.map((_, c) => `[${r * row.length + c}:v]`).join('') + `hstack=inputs=${row.length}[r${r}]`).join(';') + `;[r0][r1]vstack=inputs=2`;
    sheets[name] = join(outDir, `${name}.png`);
    await run('ffmpeg', ['-loglevel', 'error', '-y', ...inputs.flatMap(f => ['-i', f]), '-filter_complex', filter, sheets[name]], {maxBuffer:64 * 1024 * 1024});
  }
  const report = {
    character, baseline, note:'Static stills only. Studio stills use a synthetic beat timeline; the cooperage still is frame 60 of the barrel-bilge staging under production lighting.',
    stills:exp.files.map(f => f.replace(root + '/', '')), baselineStills:base.files.map(f => f.replace(root + '/', '')), sheets:Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.replace(root + '/', '')])),
    definition:validateDefinition(def), metrics:judgeCharacterMetrics(exp.metrics), baselineMetrics:judgeCharacterMetrics(base.metrics)
  };
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const character = args[args.indexOf('--character') + 1];
  const outDir = resolve(root, args.includes('--out') ? args[args.indexOf('--out') + 1] : 'production/character-experiments/experiment-01');
  runExperiment({character, outDir}).then(r => process.stdout.write(JSON.stringify({stills:r.stills, sheets:r.sheets, definition:r.definition.status, metrics:r.metrics.summary, warnings:r.metrics.warnings.map(w => w.code), baseline:r.baselineMetrics.summary}, null, 2) + '\n'))
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
}
