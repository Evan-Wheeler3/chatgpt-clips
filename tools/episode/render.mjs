#!/usr/bin/env node
/*
 * Episode renderer for hand-directed scenes. A story may ship its own Three.js scene module
 * (stories/<slug>/scene.mjs) when its action is beyond the declarative storyboard actions (a seated character,
 * a belt held in the hand, a mechanism cutaway). Timing still comes only from measured narration words: shots start
 * on word anchors, and the scene receives the measured words to key its action to.
 * Shared with the storyboard renderer: the Hold Up style and grade (styles/, tools/render/post.mjs, stylize.mjs), the
 * vector character painter (tools/characters/figure.mjs), burned-in captions (tools/render/captions.mjs + caption styles).
 *
 *   node tools/episode/render.mjs stories/<slug>/story.json [--quality preview|production] [--stills 12,3.5s,...] [--shots a,b] [--out name] [--no-captions] [--scale n]
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../convert/preview.mjs';
import { resolveAnchor } from '../storyboard/anchors.mjs';
import { resolveStyle } from '../captions/styles.mjs';
import { groupWords } from '../captions/plan.mjs';
import { normalizeWord } from '../narration/align.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const QUALITY = {
  preview:{name:'preview', scale:0.5, post:'grade', msaa:0, shadowMap:1024, captions:true},
  production:{name:'production', scale:1, post:'full', msaa:4, shadowMap:2048, captions:true}
};

export async function buildPlan(storyPath) {
  const story = JSON.parse(await readFile(storyPath, 'utf8')), slug = story.slug, fps = story.fps;
  const outDir = join(root, 'production', slug);
  const wordsDoc = JSON.parse(await readFile(join(outDir, 'words.json'), 'utf8')), words = wordsDoc.words;
  const durationSec = (wordsDoc.durationSec ?? words.at(-1).end) + (story.tailSec ?? 0.6);
  const durationFrames = Math.round(durationSec * fps), cutLead = story.timing?.cutLeadSec ?? 0.1;
  const starts = story.shots.map(s => s.start === 0 ? 0 : Math.max(0, Math.round((resolveAnchor(words, s.start, fps).time - cutLead) * fps)));
  const shots = story.shots.map((s, i) => ({...s, startFrame:starts[i], endFrame:starts[i + 1] ?? durationFrames, startSec:starts[i] / fps, endSec:(starts[i + 1] ?? durationFrames) / fps}));
  // Captions: the shared grouping and style; one band per shot, pinned in the story
  const style = resolveStyle(story.captions ?? {}), t = style.timing, lists = groupWords(words, style.grouping);
  const emph = new Set((story.captions?.emphasize ?? []).map(normalizeWord));
  const groups = lists.map((list, n) => {
    const first = words[list[0]], last = words[list.at(-1)], next = lists[n + 1] ? words[lists[n + 1][0]] : null, prev = n ? words[lists[n - 1].at(-1)] : null;
    const lead = (word, before) => before ? Math.max(word.start - t.leadSec, (before.start + before.end) / 2 + 1 / fps) : word.start - t.leadSec;
    const start = Math.max(0, lead(first, prev)), naturalEnd = last.end + t.holdSec;
    const end = next ? (next.start - last.end > t.gapHideSec ? naturalEnd : lead(next, last)) : Math.min(naturalEnd, durationSec);
    const shot = shots.find(s => first.start >= s.startSec - 1e-6 && first.start < s.endSec) ?? shots.at(-1), band = shot.captions ?? style.layout.default;
    return {n, text:list.map(k => words[k].text).join(' '), shot:shot.id, start:+start.toFixed(3), end:+end.toFixed(3), band, y:style.layout.bands[band],
      words:list.map(k => ({i:words[k].i, text:words[k].text, start:words[k].start, end:words[k].end, emphasis:emph.has(normalizeWord(words[k].text))}))};
  });
  const styleDoc = JSON.parse(await readFile(join(root, 'styles/hold-up.json'), 'utf8'));
  const character = JSON.parse(await readFile(join(root, 'characters/hold-up-protagonist/character.json'), 'utf8'));
  return {slug, fps, size:story.size, durationSec, durationFrames, shots, words, standIn:!!wordsDoc.standIn, captions:{enabled:story.captions !== false, style, groups}, style:styleDoc, character, outDir, story};
}

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">import '/tools/episode/page.mjs';</script>`;
const SERVED = [/^tools\/(episode|render|characters|storyboard|captions)\/[\w.-]+\.mjs$/, /^stories\/[\w-]+\/[\w.-]+\.mjs$/];

function serve() {
  const threeDir = resolve(root, 'node_modules/three');
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).slice(1);
      let body, type = 'text/javascript';
      if (path === '') [body, type] = [PAGE, 'text/html'];
      else if (path === 'favicon.ico') return response.writeHead(204).end();
      else if (SERVED.some(re => re.test(path))) body = await readFile(join(root, path));
      else if (path.startsWith('three/')) {
        const file = normalize(join(threeDir, path.slice(6)));
        if (!file.startsWith(threeDir + sep) || !file.endsWith('.js')) return response.writeHead(404).end();
        body = await readFile(file);
      } else return response.writeHead(404).end();
      response.writeHead(200, {'content-type':type, 'cache-control':'no-store'}).end(body);
    } catch { response.writeHead(404).end(); }
  });
  return new Promise(done => server.listen(0, '127.0.0.1', () => done(server)));
}

async function main() {
  const storyPath = resolve(args[0]), plan = await buildPlan(storyPath), quality = QUALITY[opt('quality', 'preview')];
  if (!quality) throw new Error('quality: preview | production');
  if (args.includes('--no-captions')) quality.captions = false;   // clean frames, e.g. for a thumbnail
  const scale = parseFloat(opt('scale', quality.scale));
  const size = {width:Math.round(plan.size.width * scale / 2) * 2, height:Math.round(plan.size.height * scale / 2) * 2};
  await mkdir(plan.outDir, {recursive:true});
  await writeFile(join(plan.outDir, 'shots.json'), JSON.stringify({fps:plan.fps, durationSec:plan.durationSec, standInNarration:plan.standIn, shots:plan.shots.map(({id, startFrame, endFrame, startSec, endSec, purpose}) => ({id, startFrame, endFrame, startSec, endSec, purpose})), captions:plan.captions.groups.map(g => ({text:g.text, start:g.start, end:g.end, band:g.band}))}, null, 1));
  const executablePath = process.env.CHROME_PATH ?? await findChrome();
  if (!executablePath) throw new Error('No Chrome/Chromium found; set CHROME_PATH');
  const gpu = process.env.HOLDUP_GPU ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
  const gpuArgs = gpu === 'metal' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
  const server = await serve();
  const browser = await puppeteer.launch({executablePath, headless:true, protocolTimeout:1800000, args:[...gpuArgs, '--no-first-run', '--no-default-browser-check', '--no-sandbox']});
  const problems = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({width:size.width, height:size.height});
    page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
    page.on('pageerror', e => problems.push(e.message));
    page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.ready === true || window.failed', {timeout:120000});
    const {outDir, story, ...sendable} = plan;
    const setup = await page.evaluate((p, s, q) => window.setup(p, s, q), sendable, size, quality).catch(e => { throw new Error(`setup failed: ${e.message}\n${problems.join('\n')}`); });
    if (problems.length) throw new Error(`Renderer page errors: ${problems.join('; ')}`);
    const toFrame = v => String(v).endsWith('s') ? Math.round(parseFloat(v) * plan.fps) : Number(v);
    if (opt('stills')) {
      const dir = join(plan.outDir, opt('out', 'stills')); await mkdir(dir, {recursive:true});
      const frames = opt('stills') === 'sheet' ? plan.shots.flatMap(s => [0.08, 0.5, 0.92].map(u => Math.round(s.startFrame + u * (s.endFrame - 1 - s.startFrame)))) : opt('stills').split(',').map(toFrame);
      for (const f of frames) {
        const [image] = await page.evaluate(list => window.renderFrames(list), [f]);
        await writeFile(join(dir, `f${String(f).padStart(4, '0')}.jpg`), Buffer.from(image.split(',')[1], 'base64'));
      }
      console.log(`stills (${frames.join(',')}) -> ${dir}`);
    } else {
      const only = opt('shots') ? plan.shots.filter(s => opt('shots').split(',').includes(s.id)) : null;
      const from = only ? only[0].startFrame : 0, to = only ? only.at(-1).endFrame : plan.durationFrames;
      const video = join(plan.outDir, `${opt('out', quality.name === 'production' ? 'picture' : 'preview')}.mp4`);
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', quality.name === 'production' ? 'medium' : 'veryfast', '-crf', quality.name === 'production' ? '16' : '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video], {stdio:['pipe', 'ignore', 'inherit']});
      const finished = new Promise((done, fail) => ff.on('close', c => c === 0 ? done() : fail(new Error('ffmpeg failed'))));
      const started = Date.now();
      for (let f = from; f < to; f += 6) {
        const images = await page.evaluate(list => window.renderFrames(list), Array.from({length:Math.min(6, to - f)}, (_, k) => f + k));
        for (const image of images) if (!ff.stdin.write(Buffer.from(image.split(',')[1], 'base64'))) await new Promise(done => ff.stdin.once('drain', done));
        if ((f - from) % 60 === 0) process.stderr.write(`  ${f - from}/${to - from} frames, ${((f - from + 6) / ((Date.now() - started) / 1000)).toFixed(2)} fps\n`);
      }
      ff.stdin.end(); await finished;
      if (problems.length) throw new Error(`Renderer page errors: ${problems.join('; ')}`);
      console.log(`picture -> ${video} (${to - from} frames, ${((Date.now() - started) / 1000).toFixed(0)} s, ${setup.gpu})`);
    }
  } finally { await browser.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exit(1); });
