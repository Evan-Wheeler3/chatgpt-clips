import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { findChrome } from '../convert/preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const threeDir = resolve(root, 'node_modules/three');
const BROWSER_MODULES = new Set(['easing.mjs', 'actions.mjs', 'camera.mjs', 'sample.mjs']);
const BATCH = 12;

const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { samplePlan } from '/sb/sample.mjs';
import { propWorldPoints } from '/sb/actions.mjs';
let plan, renderer, scene, camera, out, ctx, groups = new Map(), shadows = new Map(), W, H, issues = [];

window.setup = async (planJson, size, issueList) => {
  plan = planJson; W = size.width; H = size.height; issues = issueList;
  renderer = new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = plan.stage?.light?.exposure ?? 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const stage = plan.stage ?? {};
  scene = new THREE.Scene();
  const background = new THREE.Color(stage.background ?? '#1d1b19');
  scene.background = background;
  if (stage.fog) scene.fog = new THREE.Fog(background, stage.fog.near ?? 4, stage.fog.far ?? 12);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = stage.light?.environment ?? 0.35;
  scene.add(new THREE.HemisphereLight(stage.light?.sky ?? '#cfd8e6', stage.light?.bounce ?? '#4a3a2a', stage.light?.ambient ?? 0.6));
  const key = new THREE.DirectionalLight(stage.light?.key ?? '#ffe2b8', stage.light?.keyIntensity ?? 2.2);
  key.position.set(...(stage.light?.keyPosition ?? [2.5, 4, 3]));
  key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {left:-4, right:4, top:4, bottom:-4, near:0.5, far:15});
  key.shadow.bias = -0.0005;
  scene.add(key);
  // The ground is part of the declared stage, not a stand-in for any requested asset
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color:stage.ground?.color ?? '#5b4a3a', roughness:0.95}));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
  camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 100);
  const loader = new GLTFLoader(), loaded = new Map();
  for (const prop of plan.props) {
    if (prop.missing) continue;
    if (!loaded.has(prop.asset.id)) loaded.set(prop.asset.id, await loader.loadAsync('/asset/' + prop.asset.id + '.glb'));
    const model = loaded.get(prop.asset.id).scene.clone(true);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    const group = new THREE.Group(); group.add(model); scene.add(group);
    groups.set(prop.id, group);
    if (prop.base.grounded !== false && stage.contactShadows !== false) shadows.set(prop.id, [contactLayer(0.35), contactLayer(0.7)]);
  }
  out = document.createElement('canvas'); out.width = W; out.height = H;
  ctx = out.getContext('2d');
  return {props:groups.size, missing:plan.props.filter(p => p.missing).map(p => p.id)};
};

// Contact shadows: a soft ambient-occlusion pool under the footprint and a tight dark patch where the silhouette meets the floor
let blobTexture;
function contactLayer(opacity) {
  if (!blobTexture) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    blobTexture = new THREE.CanvasTexture(c);
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map:blobTexture, color:0x000000, transparent:true, opacity, depthWrite:false}));
  mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1; mesh.userData.opacity = opacity;
  scene.add(mesh);
  return mesh;
}

function placeContactShadows(frame) {
  for (const prop of plan.props) {
    const layers = shadows.get(prop.id);
    if (!layers) continue;
    const points = propWorldPoints(prop, frame);
    const minY = Math.min(...points.map(p => p.y)), height = Math.max(...points.map(p => p.y)) - minY;
    const fade = Math.max(0, 1 - minY / Math.max(0.05, height * 0.25));
    const footprint = new THREE.Box3().setFromPoints(points);
    const contact = new THREE.Box3().setFromPoints(points.filter(p => p.y <= minY + Math.max(0.01, height * 0.06)));
    [[footprint, 1.25, 0], [contact, 1, 0.08]].forEach(([box, grow, pad], k) => {
      const layer = layers[k], size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      layer.position.set(center.x, 0.002 + k * 0.001, center.z);
      layer.scale.set(size.x * grow + pad, size.z * grow + pad, 1);
      layer.material.opacity = layer.userData.opacity * fade;
      layer.visible = groups.get(prop.id).visible;
    });
  }
}

function draw(frame) {
  const s = samplePlan(plan, frame);
  for (const p of s.props) {
    const group = groups.get(p.id);
    if (!group) continue;
    group.position.copy(p.position);
    group.quaternion.copy(p.quaternion).multiply(p.wobble);
    group.scale.setScalar(p.scale);
    group.visible = p.visible;
  }
  placeContactShadows(frame);
  camera.fov = s.camera.fov; camera.updateProjectionMatrix();
  camera.position.copy(s.camera.position); camera.lookAt(s.camera.target);
  renderer.render(scene, camera);
  return s;
}

function wrap(text, width) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (ctx.measureText(line + ' ' + word).width > width && line) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  return line ? [...lines, line] : lines;
}

function hud(s, frame) {
  const u = W / 360;
  ctx.font = (11 * u) + 'px sans-serif'; ctx.textBaseline = 'top';
  const label = (text, x, y, color = '#fff', align = 'left') => {
    ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.55)';
    const w = ctx.measureText(text).width; ctx.fillRect(align === 'left' ? x - 3 * u : x - w - 3 * u, y - 2 * u, w + 6 * u, 15 * u);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  label(s.shot.id + ' · ' + s.shot.camera.behavior + (s.camera.whip ? ' (whip)' : ''), 8 * u, 8 * u);
  label('beat: ' + s.shot.beat, 8 * u, 25 * u, '#cbd5e1');
  label((frame / plan.fps).toFixed(2) + 's  f' + frame, W - 8 * u, 8 * u, '#fff', 'right');
  // Safe-area guide
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([4 * u, 4 * u]);
  ctx.strokeRect(W * 0.1, H * 0.12, W * 0.8, H * 0.63); ctx.setLineDash([]);
  // Caption: the current sentence, with the spoken word highlighted
  const words = plan.words, current = s.word;
  if (current) {
    let a = current.i, b = current.i;
    while (a > 0 && !/[.?!:]$/.test(words[a - 1].text)) a--;
    while (b < words.length - 1 && !/[.?!:]$/.test(words[b].text)) b++;
    ctx.font = 'bold ' + (15 * u) + 'px sans-serif'; ctx.textAlign = 'center';
    const lines = wrap(words.slice(a, b + 1).map(w => w.text).join(' '), W * 0.8);
    let y = H * 0.79, k = a;
    for (const line of lines) {
      const tokens = line.split(' '); let x = W / 2 - ctx.measureText(line).width / 2;
      ctx.textAlign = 'left';
      for (const t of tokens) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(t, x + u, y + u);
        ctx.fillStyle = k === current.i ? '#facc15' : '#fff'; ctx.fillText(t, x, y);
        x += ctx.measureText(t + ' ').width; k++;
      }
      y += 19 * u;
    }
  }
  // Missing assets are flagged where they should be, never drawn as substitute geometry
  ctx.font = 'bold ' + (11 * u) + 'px sans-serif';
  for (const prop of plan.props.filter(p => p.missing)) {
    const v = new THREE.Vector3(...prop.base.position).add(new THREE.Vector3(0, (prop.sizeHint?.[1] ?? 0.5) / 2, 0)).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { label('MISSING ASSET: ' + prop.query + ' (off-screen)', 8 * u, 42 * u, '#f87171'); continue; }
    label('MISSING ASSET: ' + prop.query, (v.x + 1) / 2 * W, (1 - v.y) / 2 * H, '#f87171', 'left');
  }
  const active = issues.filter(i => i.frames && frame >= i.frames[0] && frame <= i.frames[1] && i.shot === s.shot.id);
  active.slice(0, 2).forEach((issue, n) => label('⚠ ' + issue.code, 8 * u, (42 + 17 * n) * u, '#fb923c'));
}

function compose(frame) {
  const s = draw(frame);
  ctx.globalAlpha = 1; ctx.drawImage(renderer.domElement, 0, 0);
  if (s.camera.whip) {
    // Whip pans get real motion blur: average sub-frame renders across the shutter
    const n = 6;
    for (let k = 1; k < n; k++) { draw(frame + k / n); ctx.globalAlpha = 1 / (k + 1); ctx.drawImage(renderer.domElement, 0, 0); }
    ctx.globalAlpha = 1; draw(frame);
  }
  hud(s, frame);
  return s;
}

window.renderFrames = frames => frames.map(frame => { compose(frame); return out.toDataURL('image/jpeg', 0.86); });

window.renderSheet = (entries, columns) => {
  const tw = W, th = H, band = 90 * W / 360;
  const rows = Math.ceil(entries.length / columns);
  const sheet = document.createElement('canvas'); sheet.width = tw * columns; sheet.height = (th + band) * rows;
  const sc = sheet.getContext('2d'); sc.fillStyle = '#111'; sc.fillRect(0, 0, sheet.width, sheet.height);
  entries.forEach((entry, i) => {
    compose(entry.frame);
    const x = (i % columns) * tw, y = Math.floor(i / columns) * (th + band);
    sc.drawImage(out, x, y);
    sc.fillStyle = '#fff'; sc.font = 'bold ' + (13 * W / 360) + 'px sans-serif'; sc.textBaseline = 'top';
    sc.fillText(entry.title, x + 8, y + th + 6);
    sc.font = (11 * W / 360) + 'px sans-serif'; sc.fillStyle = '#cbd5e1';
    const words = entry.purpose.split(' '); let line = '', ly = y + th + 26 * W / 360;
    for (const w of words) { if (sc.measureText(line + ' ' + w).width > tw - 16 && line) { sc.fillText(line, x + 8, ly); ly += 14 * W / 360; line = w; } else line = line ? line + ' ' + w : w; }
    if (ly < y + th + band - 12) sc.fillText(line, x + 8, ly);
  });
  return sheet.toDataURL('image/png');
};
window.ready = true;
</script>`;

function serve(plan) {
  const assets = new Map(plan.props.filter(prop => !prop.missing).map(prop => [prop.asset.id, resolve(root, prop.asset.localPath)]));
  const server = createServer(async (request, response) => {
    try {
      const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      let body, type;
      if (path === '/') [body, type] = [PAGE, 'text/html'];
      else if (path === '/favicon.ico') return response.writeHead(204).end();
      else if (path.startsWith('/sb/') && BROWSER_MODULES.has(path.slice(4))) [body, type] = [await readFile(join(root, 'tools/storyboard', path.slice(4))), 'text/javascript'];
      else if (path.startsWith('/asset/') && assets.has(path.slice(7, -4))) [body, type] = [await readFile(assets.get(path.slice(7, -4))), 'model/gltf-binary'];
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

// Representative frame per shot for the storyboard sheet: its first focus word, else where its move lands
const sheetFrame = shot => shot.focus[0]?.frame ?? Math.min(shot.endFrame - 1, shot.camera.window[1]);

export async function renderAnimatic(plan, {outDir, audioPath, scale = 1 / 3, issues = [], chromePath, onProgress} = {}) {
  const executablePath = chromePath ?? await findChrome();
  if (!executablePath) throw new Error('No Chrome/Chromium found for the animatic; set CHROME_PATH');
  const size = {width:Math.round(plan.size.width * scale / 2) * 2, height:Math.round(plan.size.height * scale / 2) * 2};
  const started = Date.now();
  const server = await serve(plan);
  const browser = await puppeteer.launch({executablePath, headless:true, args:['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check']});
  const problems = [];
  try {
    const page = await browser.newPage();
    page.on('console', message => { if (message.type() === 'error') problems.push(message.text()); });
    page.on('pageerror', err => problems.push(err.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction('window.ready === true', {timeout:30000});
    const setup = await page.evaluate((p, s, i) => window.setup(p, s, i), plan, size, issues);
    if (problems.length) throw new Error(`Animatic page errors: ${problems.join('; ')}`);

    const video = join(outDir, 'animatic.mp4');
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(plan.fps), '-c:v', 'mjpeg', '-i', '-'];
    if (audioPath) args.push('-i', audioPath, '-c:a', 'aac', '-b:a', '128k');
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', (plan.durationFrames / plan.fps).toFixed(3), video);
    const ffmpeg = spawn('ffmpeg', args, {stdio:['pipe', 'ignore', 'pipe']});
    let ffmpegError = '';
    ffmpeg.stderr.on('data', chunk => { ffmpegError += chunk; });
    const finished = new Promise((done, fail) => ffmpeg.on('close', code => code === 0 ? done() : fail(new Error(`ffmpeg failed: ${ffmpegError}`))));
    for (let frame = 0; frame < plan.durationFrames; frame += BATCH) {
      const frames = Array.from({length:Math.min(BATCH, plan.durationFrames - frame)}, (_, k) => frame + k);
      const images = await page.evaluate(list => window.renderFrames(list), frames);
      for (const image of images) {
        if (!ffmpeg.stdin.write(Buffer.from(image.split(',')[1], 'base64'))) await new Promise(done => ffmpeg.stdin.once('drain', done));
      }
      onProgress?.(Math.min(plan.durationFrames, frame + BATCH), plan.durationFrames);
    }
    ffmpeg.stdin.end();
    await finished;
    if (problems.length) throw new Error(`Animatic page errors: ${problems.join('; ')}`);

    const entries = plan.shots.map((shot, i) => ({frame:sheetFrame(shot), title:`${i + 1}. ${shot.id} · ${shot.camera.behavior} · ${(shot.startFrame / plan.fps).toFixed(2)}–${(shot.endFrame / plan.fps).toFixed(2)}s`, purpose:shot.purpose}));
    const sheet = join(outDir, 'storyboard.png');
    const png = await page.evaluate((e, c) => window.renderSheet(e, c), entries, Math.min(3, entries.length));
    await writeFile(sheet, Buffer.from(png.split(',')[1], 'base64'));
    return {video, sheet, size, frames:plan.durationFrames, renderMs:Date.now() - started, chrome:await browser.version(), loadedProps:setup.props, missingProps:setup.missing};
  } finally {
    await browser.close();
    await new Promise(done => server.close(done));
  }
}
