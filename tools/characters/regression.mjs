import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import puppeteer from 'puppeteer-core';
import { buildFigure } from './figure.mjs';
import { NEUTRAL_STATE } from './validate.mjs';
import { characterFile, loadCharacter } from './load.mjs';
import { POSE_PRESETS } from '../storyboard/character.mjs';
import { findChrome } from '../convert/preview.mjs';

/*
 * Visual regression for an approved character. Three levels, each against baselines in characters/<id>/regression/:
 *   1. figure snapshot: a hash of the painted geometry for canonical states (pure, exact; catches any shape change)
 *   2. flat sheets: those states painted by Chrome's 2D canvas (catches painter changes)
 *   3. scene stills: the studio stills rendered in Three.js on SwiftShader (catches card, outline and colour changes)
 * Baselines are only written with --update, which is a deliberate act after a human approves a new design version.
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LIMITS = {flat:{changedFraction:0.002, meanDiff:0.5}, scene:{changedFraction:0.005, meanDiff:1.0}, pixelDelta:32};

export function canonicalStates(def) {
  const N = NEUTRAL_STATE.pose, states = {neutral:NEUTRAL_STATE};
  for (const face of Object.keys(def.expressions)) states[`face-${face}`] = {...NEUTRAL_STATE, face};
  for (const [name, preset] of Object.entries(POSE_PRESETS)) states[`pose-${name}`] = {...NEUTRAL_STATE, pose:{...N, ...Object.fromEntries(Object.entries(preset).filter(([k]) => k in N))}};
  states.blink = {...NEUTRAL_STATE, blink:1};
  states['gaze-turn'] = {...NEUTRAL_STATE, gaze:[0.8, -0.5]};
  states['walk-stride'] = {...NEUTRAL_STATE, pose:{...N, legF:[29, 3], legB:[-29, 31], armF:[-10, 14], armB:[12, 12], torso:8}};
  return states;
}

const round = value => JSON.stringify(value, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v);
export function figureSnapshot(def) {
  return Object.fromEntries(Object.entries(canonicalStates(def)).map(([name, state]) => [name, createHash('sha256').update(round(buildFigure(def, state).items)).digest('hex').slice(0, 16)]));
}
export const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');

// Flat sheets: every canonical state as a full figure, and every expression as a head close-up
export async function flatSheets(def) {
  const source = (await readFile(join(root, 'tools/characters/figure.mjs'), 'utf8')).replace(/^export /gm, '') + '\nwindow.F = {buildFigure, paintFigure};';
  const browser = await puppeteer.launch({executablePath:await findChrome(), headless:true, args:['--force-color-profile=srgb']});
  try {
    const page = await browser.newPage();
    await page.setContent('<canvas id=c></canvas>');
    await page.addScriptTag({content:source, type:'module'});
    await page.waitForFunction(() => window.F);
    return await page.evaluate((def, states) => {
      const sheet = (entries, {cols, cellW, cellH, scale, origin, outline}) => {
        const c = document.createElement('canvas'); c.width = cols * cellW; c.height = Math.ceil(entries.length / cols) * cellH;
        const g = c.getContext('2d'); g.fillStyle = '#efe8dd'; g.fillRect(0, 0, c.width, c.height);
        entries.forEach(([, state], i) => {
          const x = (i % cols) * cellW, y = Math.floor(i / cols) * cellH;
          g.save(); g.beginPath(); g.rect(x, y, cellW, cellH); g.clip();
          g.translate(x + origin[0], y + origin[1]); g.scale(scale, -scale);
          window.F.paintFigure(g, window.F.buildFigure(def, state), outline, def.palette.line); g.restore();
        });
        return c.toDataURL('image/png');
      };
      const all = Object.entries(states), faces = all.filter(([n]) => n.startsWith('face-') || n === 'blink' || n === 'gaze-turn');
      return {
        figures:sheet(all, {cols:8, cellW:340, cellH:500, scale:0.3, origin:[150, 485], outline:12}),
        // Head close-ups: the head centre sits about 1230 mm up in the neutral pose
        faces:sheet(faces, {cols:6, cellW:360, cellH:360, scale:0.62, origin:[170, 215 + 1230 * 0.62], outline:10})
      };
    }, def, canonicalStates(def));
  } finally { await browser.close(); }
}

// Scene stills: the Phase 5.3 studio stills (neutral, four expressions, beside the barrel) on SwiftShader at preview size
async function sceneStrip(character, outFile) {
  const { compileStory } = await import('../storyboard/compile.mjs');
  const { openRenderer } = await import('../storyboard/animatic.mjs');
  const { studioStory, ticks } = await import('../character-rig.mjs');
  const plan = await compileStory(studioStory(character), {words:ticks(6), audio:{durationSec:6}});
  const mid = id => { const s = plan.shots.find(x => x.id === id); return Math.round((s.startFrame + s.endFrame) / 2); };
  const frames = ['full', 'face-neutral', 'face-happy', 'face-surprised', 'face-concerned', 'barrel'].map(mid);
  const gpu = process.env.HOLDUP_GPU;
  process.env.HOLDUP_GPU = 'swiftshader';
  try {
    const r = await openRenderer(plan, {quality:'preview'});
    try {
      const images = await r.page.evaluate(list => window.renderFrames(list, 'image/png'), frames);
      const tmp = await Promise.all(images.map(async (image, i) => { const f = `${outFile}.${i}.png`; await writeFile(f, Buffer.from(image.split(',')[1], 'base64')); return f; }));
      await run('ffmpeg', ['-loglevel', 'error', '-y', ...tmp.flatMap(f => ['-i', f]), '-filter_complex', `hstack=inputs=${tmp.length}`, outFile]);
      await Promise.all(tmp.map(f => import('node:fs/promises').then(fs => fs.rm(f))));
      if (r.problems.length) throw new Error(`Renderer page errors: ${r.problems.join('; ')}`);
      return {chrome:r.chrome, gpu:r.gpu};
    } finally { await r.close(); }
  } finally { if (gpu === undefined) delete process.env.HOLDUP_GPU; else process.env.HOLDUP_GPU = gpu; }
}

async function rgba(file) {
  const {stdout:probe} = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]);
  const [width, height] = probe.trim().split(',').map(Number);
  const {stdout} = await run('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {encoding:'buffer', maxBuffer:256 * 1024 * 1024});
  return {width, height, data:stdout};
}

// Pixel comparison: share of pixels where any channel moved more than LIMITS.pixelDelta, and the mean channel difference.
// Optionally writes a diff image (changed pixels in red over a faded copy of the baseline).
export async function compareImages(baselineFile, currentFile, diffFile = null) {
  const [a, b] = await Promise.all([rgba(baselineFile), rgba(currentFile)]);
  if (a.width !== b.width || a.height !== b.height) return {sizeMismatch:true, changedFraction:1, meanDiff:255, baseline:[a.width, a.height], current:[b.width, b.height]};
  let changed = 0, sum = 0;
  const diff = diffFile ? Buffer.alloc(a.data.length) : null;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    sum += (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])) / 3;
    if (d > LIMITS.pixelDelta) changed++;
    if (diff) {
      const hot = d > LIMITS.pixelDelta, fade = v => 200 + v * 0.2;
      diff[i] = hot ? 230 : fade(a.data[i]); diff[i + 1] = hot ? 30 : fade(a.data[i + 1]); diff[i + 2] = hot ? 30 : fade(a.data[i + 2]); diff[i + 3] = 255;
    }
  }
  if (diffFile) {
    const raw = `${diffFile}.rgba`;
    await writeFile(raw, diff);
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${a.width}x${a.height}`, '-i', raw, diffFile]);
    await import('node:fs/promises').then(fs => fs.rm(raw));
  }
  const pixels = a.data.length / 4;
  return {changedFraction:changed / pixels, meanDiff:sum / pixels};
}

/*
 * Compare the character's current rendering with its baselines (or write them with update: true).
 * Returns per-level results and whether everything is within LIMITS.
 */
export async function checkCharacter(character, {update = false, outDir = null, levels = ['snapshot', 'flat', 'scene']} = {}) {
  const def = await loadCharacter(root, character);
  const dir = join(dirname(await characterFile(root, character)), 'regression');
  const work = outDir ?? join(root, 'production', 'character-regression', character);
  await mkdir(work, {recursive:true});
  if (update) await mkdir(dir, {recursive:true});
  const result = {character, designVersion:def.design?.version ?? null, levels:{}};

  if (levels.includes('snapshot')) {
    const current = figureSnapshot(def), file = join(dir, 'figure-snapshot.json');
    if (update) await writeFile(file, JSON.stringify({designVersion:def.design?.version, states:current}, null, 2) + '\n');
    const baseline = JSON.parse(await readFile(file, 'utf8')).states;
    const changed = Object.keys({...baseline, ...current}).filter(k => baseline[k] !== current[k]);
    result.levels.snapshot = {states:Object.keys(current).length, changed, pass:changed.length === 0};
  }
  if (levels.includes('flat')) {
    const sheets = await flatSheets(def);
    result.levels.flat = {pass:true, sheets:{}};
    for (const [name, png] of Object.entries(sheets)) {
      const current = join(work, `flat-${name}.png`), baseline = join(dir, `flat-${name}.png`);
      await writeFile(current, Buffer.from(png.split(',')[1], 'base64'));
      if (update) await writeFile(baseline, Buffer.from(png.split(',')[1], 'base64'));
      const cmp = await compareImages(baseline, current, join(work, `flat-${name}-diff.png`));
      const pass = cmp.changedFraction <= LIMITS.flat.changedFraction && cmp.meanDiff <= LIMITS.flat.meanDiff;
      result.levels.flat.sheets[name] = {...cmp, pass, baseline:baseline.replace(root + '/', ''), current:current.replace(root + '/', '')};
      result.levels.flat.pass &&= pass;
    }
  }
  if (levels.includes('scene')) {
    const current = join(work, 'scene-strip.png'), baseline = join(dir, 'scene-strip.png');
    const renderer = await sceneStrip(character, current);
    if (update) await writeFile(baseline, await readFile(current));
    const cmp = await compareImages(baseline, current, join(work, 'scene-strip-diff.png'));
    const pass = cmp.changedFraction <= LIMITS.scene.changedFraction && cmp.meanDiff <= LIMITS.scene.meanDiff;
    result.levels.scene = {...cmp, pass, renderer, baseline:baseline.replace(root + '/', ''), current:current.replace(root + '/', '')};
  }
  result.pass = Object.values(result.levels).every(l => l.pass);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  checkCharacter(opt('--character') ?? 'cooper', {update:args.includes('--update')})
    .then(r => { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); if (!r.pass) process.exitCode = 1; })
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
}
