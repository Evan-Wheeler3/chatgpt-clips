#!/usr/bin/env node
/*
 * Motion QA sampler for the Runaway Ore Cart test. Loads the production scene in the same browser page as the episode
 * renderer, evaluates every delivered frame (no pixels) and checks the contact and camera rules from docs/MOTION-QA.md:
 *   camera clearance, camera velocity / acceleration / angular-velocity spikes, wheel-rail contact, wheel spin vs travel,
 *   bumper-gate contact at and after the hit, planted-foot drift, hand-on-grip error (screen space), subject on screen.
 *
 *   node stories/mine-cart-motion-test/qa.mjs [--json production/mine-cart-motion-test/qa.json] [--trace]
 */
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { buildPlan } from '../../tools/episode/render.mjs';
import { findChrome } from '../../tools/convert/preview.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i < 0 ? d : args[i + 1]; };
const PAGE = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000">
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">import '/tools/episode/page.mjs';</script>`;

const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1);
  try {
    if (path === 'favicon.ico') return res.writeHead(204).end();
    if (path === '') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE);
    let file = join(root, path);
    if (path.startsWith('three/')) { const d = resolve(root, 'node_modules/three'); file = normalize(join(d, path.slice(6))); if (!file.startsWith(d + sep)) throw 0; }
    const type = file.endsWith('.json') ? 'application/json' : file.endsWith('.bin') ? 'application/octet-stream' : 'text/javascript';
    const body = await readFile(file); res.writeHead(200, { 'content-type': type }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const plan = await buildPlan(join(root, 'stories/mine-cart-motion-test/story.json'));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? await findChrome(), headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
let data;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 270, height: 480 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction('window.ready === true');
  const { outDir, story, ...sendable } = plan;
  await page.evaluate((p) => window.setup(p, { width: 270, height: 480 }, { name: 'preview', scale: 0.25, post: 'grade', msaa: 0, shadowMap: 256, captions: false }), sendable);
  data = await page.evaluate((fps, n) => window.mineCartQA(fps, n), plan.fps, plan.durationFrames);
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await browser.close(); server.close(); }

// ------------------------------------------------------------------ checks
const F = data.frames, fps = plan.fps, findings = [];
const flag = (area, f, msg) => findings.push({ area, frame: f, tc: (f / fps).toFixed(2) + 's', msg });
const sub = (a, b) => a.map((v, i) => v - b[i]), len = a => Math.hypot(...a);
// camera speed, acceleration and angular velocity
const vel = F.slice(1).map((r, i) => sub(r.cam, F[i].cam).map(v => v * fps));
const speed = vel.map(len), acc = vel.slice(1).map((v, i) => len(sub(v, vel[i])) * fps);
const qang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, v, i) => s + v * b[i], 0)))) * 180 / Math.PI;
const angv = F.slice(1).map((r, i) => qang(r.quat, F[i].quat) * fps), angacc = angv.slice(1).map((v, i) => Math.abs(v - angv[i]) * fps);
const jerk = acc.slice(1).map((a, i) => Math.abs(a - acc[i]) * fps);
const maxIdx = arr => arr.reduce((m, v, i) => v > arr[m] ? i : m, 0);
speed.forEach((s, i) => { if (s < 0.05) flag('camera', i + 1, `near-stop ${s.toFixed(3)} m/s`); });
acc.forEach((a, i) => { if (a > 6) flag('camera', i + 1, `acceleration spike ${a.toFixed(2)} m/s²`); });
angv.forEach((w, i) => { if (w > 60) flag('camera', i + 1, `fast rotation ${w.toFixed(1)}°/s`); });
angacc.forEach((w, i) => { if (w > 260) flag('camera', i + 1, `rotation acceleration spike ${w.toFixed(0)}°/s²`); });
F.forEach(r => { if (r.camClear < 0.25) flag('clearance', r.f, `camera ${r.camClear} m from geometry`); });
// wheels on the rails while rolling (before the hit); wheel spin tied to travel
F.forEach(r => { if (r.t < 4.45 && r.wheelGap.some(g => Math.abs(g) > 0.002)) flag('wheels', r.f, `wheel-rail gap ${r.wheelGap}`); });
F.forEach(r => { const want = -(r.cartX - F[0].cartX) / 0.27; if (Math.abs(want - r.wheelSpin) > 1e-3) flag('wheels', r.f, `spin ${r.wheelSpin} vs travel ${want.toFixed(4)}`); });
F.forEach(r => { if (r.bumperGap < -0.004) flag('bumper', r.f, `bumper passes through gate by ${(-r.bumperGap * 1000).toFixed(1)} mm`); if (r.t >= 4.45 && Math.abs(r.bumperGap) > 0.004 && r.t < 5.25) flag('bumper', r.f, `bumper off the pad ${r.bumperGap}`); });
// planted feet: drift from the plant point and height off the deck
for (const s of ['B', 'F']) F.forEach(r => { const ft = r.feet?.[s]; if (ft?.planted && (Math.abs(ft.dx) > 0.006 || Math.abs(ft.y - 0.005) > 0.006)) flag('feet', r.f, `${s} foot off its plant: dx ${ft.dx} m, y ${ft.y}`); });
const handSeen = r => r.screen.hand && Math.abs(r.screen.hand[0]) < 1.05 && Math.abs(r.screen.hand[1]) < 1.05;
F.forEach(r => { if (r.hand && handSeen(r) && r.t > 2.82 && r.t < 5.6 && r.hand.B > 0.012) flag('grip', r.f, `near hand ${(r.hand.B * 1000).toFixed(0)} mm off the grip`); });
F.forEach(r => { if (r.hand && handSeen(r) && r.t > 2.82 && r.t < 5.6 && r.hand.F > 0.02) flag('grip', r.f, `far hand ${(r.hand.F * 1000).toFixed(0)} mm off the lever`); });
// Character entrances: the worker must never appear (or vanish) while his body is inside the frame
F.forEach((r, i) => { if (i && r.workerVisible !== F[i - 1].workerVisible && r.screen.worker && Math.abs(r.screen.worker[0]) < 1.1 && Math.abs(r.screen.worker[1]) < 1.1) flag('entrance', r.f, `worker ${r.workerVisible ? 'appears' : 'vanishes'} inside the frame at ${r.screen.worker}`); });
// Pose speed: limb and torso rotation rates (deg/s). Fast gestures read as robotic snaps on a flat card
const RATE = { arm: 420, torso: 160 }, dAng = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
F.forEach((r, i) => { const p = F[i - 1]; if (!i || !r.pose || !p?.pose) return;
  for (const k of ['armF', 'armB']) { const w = dAng(r.pose[k][0], p.pose[k][0]) * fps; if (w > RATE.arm) flag('pose-speed', r.f, `${k} swings ${w.toFixed(0)}°/s (> ${RATE.arm})`); }
  const wt = dAng(r.pose.torso, p.pose.torso) * fps; if (wt > RATE.torso) flag('pose-speed', r.f, `torso ${wt.toFixed(0)}°/s (> ${RATE.torso})`); });
const inFrame = p => p && Math.abs(p[0]) < 0.95 && Math.abs(p[1]) < 0.95;
F.forEach(r => { if (r.t < 4.6 && !inFrame(r.screen.cartFront)) flag('framing', r.f, `cart front off screen ${r.screen.cartFront}`); });

const summary = { frames: F.length, XS: data.XS, vHit: data.VHIT,
  camera: { maxSpeed: Math.max(...speed).toFixed(2) + ` m/s @${(maxIdx(speed) + 1)}`, minSpeed: Math.min(...speed).toFixed(3) + ` m/s @${speed.indexOf(Math.min(...speed)) + 1}`,
    maxAcc: Math.max(...acc).toFixed(2) + ` m/s² @${maxIdx(acc) + 1}`, maxJerk: Math.max(...jerk).toFixed(1) + ` @${maxIdx(jerk) + 2}`, maxAngVel: Math.max(...angv).toFixed(1) + ` °/s @${maxIdx(angv) + 1}`,
    maxAngAcc: Math.max(...angacc).toFixed(0) + ` °/s² @${maxIdx(angacc) + 1}`, minClearance: Math.min(...F.map(r => r.camClear)) + ' m' },
  worstNearHandOnScreen: Math.max(0, ...F.filter(r => r.hand && handSeen(r) && r.t > 2.82 && r.t < 5.6).map(r => r.hand.B)),
  worstFarHandOnScreen: Math.max(0, ...F.filter(r => r.hand && handSeen(r) && r.t > 2.82 && r.t < 5.6).map(r => r.hand.F)),
  worstPlantDrift: Math.max(0, ...F.flatMap(r => ['B', 'F'].map(s => r.feet?.[s]?.planted ? Math.abs(r.feet[s].dx) : 0))),
  findings: findings.length };
console.log(JSON.stringify(summary, null, 1));
const byArea = {}; for (const f of findings) (byArea[f.area] ??= []).push(f);
for (const [a, list] of Object.entries(byArea)) console.log(`${a}: ${list.length} — e.g. ${list.slice(0, 4).map(f => `${f.tc} ${f.msg}`).join(' | ')}`);
if (args.includes('--trace')) for (const r of F.filter(r => r.f % 6 === 0)) console.log(r.t.toFixed(2), 'cam', r.cam.map(v => v.toFixed(2)).join(','), 'cart', r.screen.cart, 'end', r.screen.trackEnd, 'wrk', r.screen.worker, 'ore', r.screen.ore, 'gate', r.screen.gate, 'clr', r.camClear);
if (opt('json')) await writeFile(resolve(opt('json')), JSON.stringify({ summary, findings, frames: F }, null, 1));
