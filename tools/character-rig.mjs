import { writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileStory } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { castTracks } from './storyboard/sample.mjs';
import { openRenderer, renderAnimatic } from './storyboard/animatic.mjs';
import { validateDefinition } from './characters/validate.mjs';
import { judgeCharacterMetrics } from './characters/metrics.mjs';
import { figureIssues, figureMeasures } from './characters/rig-checks.mjs';
import { loadCharacter } from './characters/load.mjs';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

/*
 * Phase 5.3 review renders for one vector character: studio stills (neutral, expressions, beside the barrel), one
 * cooperage still, and the five-second rig test in the cooperage. Studio stills use a synthetic beat timeline;
 * invisible props give the camera something to frame.
 */
export const ticks = seconds => Array.from({length:seconds * 4}, (_, i) => ({i, text:`t${i}`, start:i * 0.25, end:i * 0.25 + 0.2}));
const STUDIO = {background:'#c9c3b9', ground:{color:'#d8d2c8'}, light:{key:'#fff3e2', keyIntensity:2.4, keyPosition:[2, 4, 3], sky:'#e6ebf2', bounce:'#7a7268', ambient:1.0, environment:0.5}};
export const EXPRESSIONS = ['neutral', 'happy', 'surprised', 'concerned'];

export function studioStory(character) {
  const close = (face, i) => ({id:`face-${face}`, start:`t${4 + i * 4}`, purpose:`Head and shoulders, ${face}`, subject:'frame-head', transition:{type:'cut', motivation:'Expression'},
    camera:{move:'hold', framing:'medium', azimuth:12, elevation:2}, events:[{character:'lead', at:'shot-start', do:'expression', params:{face}}]});
  return {
    version:1, slug:'character-rig', fps:30, size:{width:1080, height:1920}, stage:STUDIO,
    props:[
      {id:'frame-body', asset:{query:'wooden barrel'}, position:[0, 0, -0.6], visible:false},
      {id:'frame-head', asset:{query:'wooden barrel'}, position:[-0.03, 1.08, -0.05], scale:0.62, grounded:false, visible:false},
      {id:'barrel', asset:{query:'wooden barrel'}, position:[0.66, 0, 0], rotation:[0, 15, 0], visible:false}
    ],
    cast:[{id:'lead', character, start:{position:[0, 0], face:[1, 0, 0.35]}}],
    beats:[{id:'stills', purpose:'Character rig stills', shots:[
      {id:'full', purpose:'Full-body neutral', subject:'frame-body', camera:{move:'hold', framing:'wide', azimuth:12, elevation:4, focus:[0, 0.32, 0]}},
      ...EXPRESSIONS.map(close),
      {id:'barrel', start:'t20', purpose:'Full body beside the real barrel', subject:'barrel', transition:{type:'cut', motivation:'Prop'}, camera:{move:'hold', framing:'wide', azimuth:10, elevation:5, focus:[-0.33, 0.25, 0]},
        events:[
          {at:'shot-start', prop:'barrel', do:'appear'},
          {character:'lead', at:'shot-start', do:'place', params:{position:[0, 0], face:'barrel'}},
          {character:'lead', at:'shot-start', do:'expression', params:{face:'neutral'}}
        ]}
    ]}]
  };
}

// The five-second rig test: neutral, look at the barrel, raise an arm, hand on the barrel, back to neutral
export function rigTestStory(character) {
  return {
    version:1, slug:'character-rig-test', fps:30, size:{width:1080, height:1920},
    // Exactly five seconds (the synthetic audio is 5 s long, so no tail); one held shot is intended
    timing:{tailSec:0, maxShotSec:6},
    environment:{id:'cooperage-storehouse'}, style:{id:'hold-up'},
    stage:{background:'#2a231c', fog:{near:5, far:14}, ground:{color:'#6b5440'}, light:{key:'#ffdcae', keyIntensity:3.2, keyPosition:[2.2, 3.6, 2.8], sky:'#d3dcea', bounce:'#5a4430', ambient:0.9, environment:0.6, exposure:1.25}},
    props:[{id:'barrel', asset:{query:'wooden barrel', style:'realistic'}, position:[0, 0, 0], rotation:[0, 15, 0]}],
    cast:[{id:'cooper', character, start:{position:[-0.62, 0.02], face:'barrel'}}],
    beats:[{id:'rig-test', purpose:'Rig test', shots:[
      {id:'two-shot', purpose:'The cooper beside the barrel: look, raise, touch, release', subject:'barrel', camera:{move:'hold', framing:'wide', azimuth:8, elevation:6, focus:[-0.36, 0.2, 0]},
        events:[
          {character:'cooper', at:'t4', do:'look', params:{at:'barrel'}},
          {character:'cooper', at:'t8', until:'t16', do:'pose', params:{preset:'present', target:'barrel', frames:16, ease:'sine', release:18}},
          {character:'cooper', at:'t8', do:'expression', params:{face:'neutral'}},
          {character:'cooper', at:'t12', until:'t16', do:'touch', params:{prop:'barrel', frames:16, release:18}},
          {character:'cooper', at:'t16', do:'look', params:{at:'camera'}}
        ]}
    ]}]
  };
}

async function label(input, output, text, width) {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${width}:-1,drawtext=fontfile=${FONT}:text='${text.replace(/'/g, '’').replace(/:/g, '\\:')}':x=10:y=10:fontsize=${Math.max(16, Math.round(width / 22))}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`, output]);
}
const save = (file, image) => writeFile(file, Buffer.from(image.split(',')[1], 'base64'));

// Pure checks over every frame of a plan: painted joints, constant limb lengths, deterministic tracks
export function rigChecks(plan, castId) {
  const member = plan.cast.find(m => m.id === castId), def = member.definition;
  const track = castTracks(plan).get(castId), again = castTracks(plan).get(castId);
  const issues = [];
  let ranges = null;
  for (const state of track) {
    const {figure, issues:found} = figureIssues(def, state);
    for (const issue of found) issues.push({frame:state.frame, ...issue});
    const m = figureMeasures(figure);
    ranges ??= Object.fromEntries(Object.keys(m).map(k => [k, [Infinity, -Infinity]]));
    for (const [k, v] of Object.entries(m)) ranges[k] = [Math.min(ranges[k][0], v), Math.max(ranges[k][1], v)];
  }
  const drift = Object.fromEntries(Object.entries(ranges).map(([k, [lo, hi]]) => [k, Math.round((hi - lo) * 1000) / 1000]));
  return {frames:track.length, issues, lengthDriftMm:drift, deterministic:JSON.stringify(track) === JSON.stringify(again)};
}

export async function runRigReview({character = 'cooper', outDir, quality = 'production'}) {
  const started = Date.now();
  const tmp = join(outDir, 'tmp');
  await mkdir(tmp, {recursive:true});
  const def = await loadCharacter(root, character);
  const report = {character, reference:def.reference, quality, generatedAt:new Date().toISOString(), definition:validateDefinition(def)};

  // Studio stills
  const studio = await compileStory(studioStory(character), {words:ticks(6), audio:{durationSec:6}});
  const shotFrame = id => { const s = studio.shots.find(x => x.id === id); return Math.round((s.startFrame + s.endFrame) / 2); };
  const frames = {neutral:shotFrame('full'), barrel:shotFrame('barrel'), ...Object.fromEntries(EXPRESSIONS.map(e => [`face-${e}`, shotFrame(`face-${e}`)]))};
  let r = await openRenderer(studio, {quality});
  const stills = {};
  try {
    const order = Object.keys(frames);
    const images = await r.page.evaluate(list => window.renderFrames(list, 'image/png'), order.map(k => frames[k]));
    for (const [i, k] of order.entries()) { stills[k] = join(tmp, `studio-${k}.png`); await save(stills[k], images[i]); }
    const raw = await r.page.evaluate(list => window.characterMetrics(list), order.map(k => frames[k]));
    report.studioMetrics = judgeCharacterMetrics(raw);
    report.studioMetrics.neutralBox = raw[0].characters[0].bbox;
    report.studioProblems = r.problems;
    const joints = await r.page.evaluate(list => window.characterJoints(list), order.map(k => frames[k]));
    for (const [i, k] of order.entries()) stills[`${k}:screen`] = joints[i].characters[0].screen;
    report.renderer = {gpu:r.gpu, chrome:r.chrome, size:[r.size.width, r.size.height]};
  } finally { await r.close(); }
  report.studioValidation = summarize(validatePlan(studio));

  // The rig test in the cooperage: one production still, then the video
  const test = await compileStory(rigTestStory(character), {words:ticks(5), audio:{durationSec:5}});
  report.rigTestValidation = summarize(validatePlan(test));
  report.rigChecks = rigChecks(test, 'cooper');
  r = await openRenderer(test, {quality});
  try {
    const [env] = await r.page.evaluate(() => window.renderFrames([15], 'image/png'));
    await save(join(outDir, 'in-environment.png'), env);
    report.environmentMetrics = judgeCharacterMetrics(await r.page.evaluate(() => window.characterMetrics([15, 45, 75, 105, 135])));
    // Contact: the painted palm against the barrel point the solver aimed at, on every frame with contact
    const joints = await r.page.evaluate(n => window.characterJoints(Array.from({length:n}, (_, i) => i)), test.durationFrames);
    const contacts = joints.map(j => j.characters[0]).filter(c => c.contact);
    report.contact = {frames:contacts.length, firstFrame:contacts[0] ? joints.find(j => j.characters[0].contact).frame : null,
      maxShortfallM:Math.max(0, ...contacts.map(c => c.contact.shortfallM)),
      // Painted palm vs. the solved contact point on screen, in pixels at 1080 px width
      maxPalmOffsetPx:Math.max(0, ...contacts.map(c => c.contactPx))};
    const feet = joints.map(j => j.characters[0].joints).map(J => Math.min(J.heelF[1], J.toeF[1], J.heelB[1], J.toeB[1]));
    report.ground = {minFootY:Math.min(...feet), maxFootY:Math.max(...feet)};
    report.rigTestProblems = r.problems;
  } finally { await r.close(); }
  const video = await renderAnimatic(test, {outDir, quality, name:'rig-test'});
  report.video = {file:'rig-test.mp4', frames:video.frames, seconds:video.frames / test.fps, renderMs:video.renderMs};
  await rm(video.sheet, {force:true});

  report.colorAccuracy = await colorAccuracy(def, stills.neutral, stills['neutral:screen']);

  // Deliverable sheets
  await run('cp', [stills.neutral, join(outDir, 'neutral.png')]);
  await run('cp', [stills.barrel, join(outDir, 'with-barrel.png')]);
  const size = report.renderer.size;
  const heads = [];
  for (const e of EXPRESSIONS) {
    const out = join(tmp, `head-${e}.png`);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', stills[`face-${e}`], '-vf', headCrop(stills[`face-${e}:screen`], 3.4, size), join(tmp, `sq-${e}.png`)]);
    await label(join(tmp, `sq-${e}.png`), out, e[0].toUpperCase() + e.slice(1), 540);
    heads.push(out);
  }
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...heads.flatMap(f => ['-i', f]), '-filter_complex', '[0][1]hstack[a];[2][3]hstack[b];[a][b]vstack', join(outDir, 'expressions.png')]);
  await referenceComparison(def, stills, report.studioMetrics, tmp, join(outDir, 'reference-comparison.png'), size, quality);
  report.timeSec = Math.round((Date.now() - started) / 100) / 10;
  await writeFile(join(outDir, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
  await rm(tmp, {recursive:true, force:true});
  return report;
}

// A square crop around the painted head: from the cap top (about 1.5 neck-to-centre lengths up) to below the chin
function headCrop(screen, size, [W, H] = [1080, 1920]) {
  const [cx, cy] = screen.headCenter, d = Math.hypot(cx - screen.neck[0], cy - screen.neck[1]), side = Math.min(W, Math.round(d * size));
  const clamp = (v, max) => Math.max(0, Math.min(max - side, Math.round(v)));
  return `crop=${side}:${side}:${clamp(cx - side / 2, W)}:${clamp(cy - d * 0.4 - side / 2, H)}`;
}

// Rendered colour vs. the definition's palette (CIE76 ΔE) at points inside large flat areas of the neutral still
const lab = ([r, g, b]) => {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const [R, G, B] = [lin(r), lin(g), lin(b)], f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
const hexRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
async function colorAccuracy(def, file, screen) {
  const points = {skin:'cheekSample', shirt:'shoulderB', apron:'apronSample', trousers:'kneeB', cap:'capSample', hair:'hairSample'};
  const out = {};
  for (const [key, joint] of Object.entries(points)) {
    const [x, y] = screen[joint].map(Math.round);
    const {stdout} = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-vf', `crop=5:5:${x - 2}:${y - 2}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {encoding:'buffer'});
    const px = Array.from({length:25}, (_, i) => [stdout[i * 3], stdout[i * 3 + 1], stdout[i * 3 + 2]]);
    const rendered = [0, 1, 2].map(c => px.map(p => p[c]).sort((a, b) => a - b)[12]);
    const [a, b] = [lab(rendered), lab(hexRgb(def.palette[key]))];
    out[key] = {palette:def.palette[key], rendered:'#' + rendered.map(v => v.toString(16).padStart(2, '0')).join(''), deltaE:Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 10) / 10};
  }
  return out;
}

function summarize(v) {
  const count = list => list.reduce((a, i) => ({...a, [i.code]:(a[i.code] ?? 0) + 1}), {});
  return {errors:count(v.errors ?? []), warnings:count(v.warnings ?? [])};
}

// Reference crops (3/4 turnaround figure and the four core expressions) beside the rendered rig, at matching sizes
async function referenceComparison(def, stills, metrics, tmp, out, size, quality) {
  const ref = join(root, def.reference);
  const H = 900;
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', ref, '-vf', `crop=135:380:517:122,scale=-1:${H}:flags=lanczos,pad=iw+40:ih+40:20:20:color=#efe8dd`, join(tmp, 'ref-figure.png')]);
  const [x0, y0, x1, y1] = metrics.neutralBox;
  const pad = 30, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2;
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', stills.neutral, '-vf', `crop=${w}:${h}:${x0 - pad}:${y0 - pad},scale=-1:${H}:flags=lanczos,pad=iw+40:ih+40:20:20:color=#efe8dd`, join(tmp, 'rig-figure.png')]);
  const refFaces = {neutral:[955, 52], happy:[1187, 52], surprised:[1302, 52], concerned:[1416, 52]};
  const faceIn = [], faceOut = [];
  for (const [e, [x, y]] of Object.entries(refFaces)) {
    faceIn.push(join(tmp, `ref-${e}.png`));
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', ref, '-vf', `crop=112:112:${x}:${y},scale=220:220:flags=lanczos`, faceIn.at(-1)]);
    faceOut.push(join(tmp, `rig-${e}.png`));
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', stills[`face-${e}`], '-vf', `${headCrop(stills[`face-${e}:screen`], 2.6, size)},scale=220:220`, faceOut.at(-1)]);
  }
  const col = async (figure, faces, title, file) => {
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', figure, ...faces.flatMap(f => ['-i', f]), '-filter_complex',
      `[1][2]hstack[t];[3][4]hstack[b];[t][b]vstack,pad=iw+20:${H + 40}:10:(oh-ih)/2:color=#efe8dd[f];[0]scale=-1:${H + 40}[g];[g][f]hstack,pad=iw:ih+70:0:70:color=#efe8dd,drawtext=fontfile=${FONT}:text='${title}':x=20:y=18:fontsize=34:fontcolor=#1e1a16`, file]);
  };
  await col(join(tmp, 'ref-figure.png'), faceIn, 'Approved reference (sheet crops)', join(tmp, 'col-ref.png'));
  await col(join(tmp, 'rig-figure.png'), faceOut, `Rendered rig (Three.js, ${quality})`, join(tmp, 'col-rig.png'));
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(tmp, 'col-ref.png'), '-i', join(tmp, 'col-rig.png'), '-filter_complex', '[0][1]hstack', out]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const character = opt('--character') ?? 'cooper';
  const outDir = resolve(root, opt('--out') ?? `production/character-rig/${character}`);
  await mkdir(outDir, {recursive:true});
  runRigReview({character, outDir, quality:opt('--quality') ?? 'production'})
    .then(r => process.stdout.write(JSON.stringify({definition:r.definition.status, rigChecks:{issues:r.rigChecks.issues.length, drift:r.rigChecks.lengthDriftMm, deterministic:r.rigChecks.deterministic},
      contact:r.contact, ground:r.ground, studio:r.studioValidation, rigTest:r.rigTestValidation, metrics:r.studioMetrics.summary, env:r.environmentMetrics.summary, warnings:[...r.studioMetrics.warnings, ...r.environmentMetrics.warnings].map(w => w.code), timeSec:r.timeSec}, null, 2) + '\n'))
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
}
