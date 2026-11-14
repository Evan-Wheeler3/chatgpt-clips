import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../convert/preview.mjs';
import { qualityPreset } from '../render/quality.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const threeDir = resolve(root, 'node_modules/three');
// Only these browser modules are served; everything else under tools/ stays private
const BROWSER_MODULES = new Set([
  'tools/storyboard/easing.mjs', 'tools/storyboard/actions.mjs', 'tools/storyboard/camera.mjs', 'tools/storyboard/sample.mjs', 'tools/storyboard/character.mjs',
  'tools/render/page.mjs', 'tools/render/quality.mjs', 'tools/render/stylize.mjs', 'tools/render/post.mjs', 'tools/render/environment.mjs', 'tools/render/character-rig.mjs', 'tools/render/character-hybrid.mjs', 'tools/render/character-vector.mjs', 'tools/characters/figure.mjs', 'tools/characters/display.mjs', 'tools/render/captions.mjs'
]);
const BATCH = 12;
const GPU_ARGS = {
  swiftshader:['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  metal:['--use-angle=metal', '--ignore-gpu-blocklist']
};

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">import '/tools/render/page.mjs';</script>`;

function serve(plan) {
  // Whitelists: story prop and environment GLBs by catalog id, and environment texture maps by path
  const assets = new Map(plan.props.filter(prop => !prop.missing).map(prop => [prop.asset.id, resolve(root, prop.asset.localPath)]));
  for (const asset of Object.values(plan.environment?.assets ?? {})) assets.set(asset.id, resolve(root, asset.localPath));
  const textures = new Set(Object.values(plan.environment?.materials ?? {}).flatMap(m => Object.values(m.texture?.maps ?? {})));
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let body, type;
      if (path === '/') [body, type] = [PAGE, 'text/html'];
      else if (path === '/favicon.ico') return response.writeHead(204).end();
      else if (BROWSER_MODULES.has(path.slice(1))) [body, type] = [await readFile(join(root, path.slice(1))), 'text/javascript'];
      else if (path.startsWith('/asset/') && assets.has(path.slice(7, -4))) [body, type] = [await readFile(assets.get(path.slice(7, -4))), 'model/gltf-binary'];
      else if (path.startsWith('/tex/') && textures.has(path.slice(5))) [body, type] = [await readFile(resolve(root, path.slice(5))), 'image/jpeg'];
      else if (path.startsWith('/three/')) {
        const file = normalize(join(threeDir, path.slice(7)));
        if (![join(threeDir, 'build') + sep, join(threeDir, 'examples', 'jsm') + sep].some(dir => file.startsWith(dir)) || !file.endsWith('.js')) return response.writeHead(404).end();
        [body, type] = [await readFile(file), 'text/javascript'];
      } else return response.writeHead(404).end();
      response.writeHead(200, {'content-type':type}).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

// Opens the renderer page for a plan at a quality; the caller drives it and must call close()
export async function openRenderer(plan, {quality:qualityName = 'animatic', scale, issues = [], chromePath} = {}) {
  const quality = qualityPreset(qualityName);
  const executablePath = chromePath ?? await findChrome();
  if (!executablePath) throw new Error('No Chrome/Chromium found for rendering; set CHROME_PATH');
  const s = scale ?? quality.scale;
  const size = {width:Math.round(plan.size.width * s / 2) * 2, height:Math.round(plan.size.height * s / 2) * 2};
  const server = await serve(plan);
  // HOLDUP_GPU=swiftshader forces CPU rendering (CI, machines without Metal); otherwise the quality preset decides
  const gpu = process.env.HOLDUP_GPU ?? quality.gpu;
  if (!GPU_ARGS[gpu]) throw new Error(`Unknown GPU mode ${gpu}`);
  const browser = await puppeteer.launch({executablePath, headless:true, protocolTimeout:600000, args:[...GPU_ARGS[gpu], '--no-first-run', '--no-default-browser-check']});
  const problems = [];
  const close = async () => { await browser.close(); await new Promise(done => server.close(done)); };
  try {
    const page = await browser.newPage();
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', err => problems.push(err.message));
    page.on('requestfailed', req => problems.push(`requestfailed: ${req.url()}`));
    page.on('response', res => { if (res.status() >= 400) problems.push(`http ${res.status()}: ${res.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.ready === true', {timeout:60000});
    const setup = await page.evaluate((p, sz, i, q) => window.setup(p, sz, i, q), plan, size, issues, qualityName);
    const gpu = await page.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const d = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(d.UNMASKED_RENDERER_WEBGL); });
    if (problems.length) throw new Error(`Renderer page errors: ${problems.join('; ')}`);
    return {page, size, setup, gpu, quality, problems, close, chrome:await browser.version()};
  } catch (err) {
    await close();
    throw err;
  }
}

// Representative frame per shot for the storyboard sheet: its first focus word, else where its move lands
export const sheetFrame = shot => shot.focus[0]?.frame ?? Math.min(shot.endFrame - 1, shot.camera.window[1]);

export async function renderAnimatic(plan, {outDir, audioPath, scale, quality = 'animatic', issues = [], chromePath, onProgress, name} = {}) {
  const started = Date.now();
  const r = await openRenderer(plan, {quality, scale, issues, chromePath});
  try {
    const base = name ?? (quality === 'animatic' ? 'animatic' : quality);
    const video = join(outDir, `${base}.mp4`);
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-'];
    if (audioPath) args.push('-i', audioPath, '-c:a', 'aac', '-b:a', '128k');
    args.push('-c:v', 'libx264', '-preset', quality === 'production' ? 'medium' : 'veryfast', '-crf', quality === 'production' ? '18' : '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', (plan.durationFrames / plan.fps).toFixed(3), video);
    const ffmpeg = spawn('ffmpeg', args, {stdio:['pipe', 'ignore', 'pipe']});
    let ffmpegError = '';
    ffmpeg.stderr.on('data', chunk => { ffmpegError += chunk; });
    const finished = new Promise((done, fail) => ffmpeg.on('close', code => code === 0 ? done() : fail(new Error(`ffmpeg failed: ${ffmpegError}`))));
    for (let frame = 0; frame < plan.durationFrames; frame += BATCH) {
      const frames = Array.from({length:Math.min(BATCH, plan.durationFrames - frame)}, (_, k) => frame + k);
      const images = await r.page.evaluate(list => window.renderFrames(list), frames);
      for (const image of images) {
        if (!ffmpeg.stdin.write(Buffer.from(image.split(',')[1], 'base64'))) await new Promise(done => ffmpeg.stdin.once('drain', done));
      }
      onProgress?.(Math.min(plan.durationFrames, frame + BATCH), plan.durationFrames);
    }
    ffmpeg.stdin.end();
    await finished;
    if (r.problems.length) throw new Error(`Renderer page errors: ${r.problems.join('; ')}`);

    const entries = plan.shots.map((shot, i) => ({frame:sheetFrame(shot), title:`${i + 1}. ${shot.id} · ${shot.camera.behavior} · ${(shot.startFrame / plan.fps).toFixed(2)}–${(shot.endFrame / plan.fps).toFixed(2)}s`, purpose:shot.purpose}));
    const sheet = join(outDir, quality === 'animatic' ? 'storyboard.png' : `storyboard-${base}.png`);
    const png = await r.page.evaluate((e, c) => window.renderSheet(e, c), entries, Math.min(3, entries.length));
    await writeFile(sheet, Buffer.from(png.split(',')[1], 'base64'));
    return {video, sheet, size:r.size, frames:plan.durationFrames, renderMs:Date.now() - started, chrome:r.chrome, gpu:r.gpu, quality,
      loadedProps:r.setup.props, missingProps:r.setup.missing, characters:r.setup.characters, environment:r.setup.environment, flags:r.setup.flags};
  } finally {
    await r.close();
  }
}
