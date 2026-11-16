/*
 * What if everyone bought GTA 6 at one store? Hand-directed scene (tools/episode/render.mjs).
 * Reuses the owner's gta-one-shop sets (street with baked night lighting, living room, Egypt, future city), imported by
 * tools/episode/import_npz_meshes.py into production/gta-one-shop/assets (gitignored). Characters are Hold Up vector rigs.
 * Signs and screens are our own: no game logos or artwork.
 */
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);
const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a)), sseg = (t, a, b) => smooth(seg(t, a, b));
const eout = x => 1 - (1 - x) ** 3, back = x => { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const pop = (t, a, d = 0.3) => t < a ? 0 : back(clamp((t - a) / d));
const mix = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
const ASSETS = '/production/gta-one-shop/assets/';

export async function build(ctx) {
  const { THREE, scene, camera, stylize, quality, plan, makeFigureCard } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  scene.environment = new THREE.PMREMGenerator(ctx.renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.25;
  const manifest = await (await fetch(ASSETS + 'manifest.json')).json();
  let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.7, metalness: o.m ?? 0, map: o.map ?? null, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1 });
  const mesh = (geo, mat, p = [0, 0, 0], r = [0, 0, 0], parent = null, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.castShadow = shadow; m.receiveShadow = true; parent?.add(m); return m; };

  // ---------------------------------------------------------------- imported meshes
  async function verts(name) { return new Float32Array(await (await fetch(ASSETS + name + '.bin')).arrayBuffer()); }
  // 12-float layout: position normal uv colour kind. kind 4 = self-lit (windows, screens, neon)
  async function propSet(name) {
    const v = await verts(name), n = v.length / 12, g = new THREE.Group(), parts = { lit: [], glow: [] };
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) (v[i * 12 + 11] > 3.5 ? parts.glow : parts.lit).push(i);
    for (const [k, idx] of Object.entries(parts)) {
      if (!idx.length) continue;
      const P = new Float32Array(idx.length * 3), N = new Float32Array(idx.length * 3), C = new Float32Array(idx.length * 3);
      idx.forEach((i, j) => { const o = i * 12; P.set(v.subarray(o, o + 3), j * 3); N.set(v.subarray(o + 3, o + 6), j * 3); c.setRGB(v[o + 8], v[o + 9], v[o + 10], THREE.SRGBColorSpace); C.set([c.r, c.g, c.b], j * 3); });
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('color', new THREE.BufferAttribute(C, 3));
      const m = new THREE.Mesh(geo, k === 'glow' ? new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78 }));
      m.castShadow = k !== 'glow'; m.receiveShadow = true; g.add(m);
      if (k === 'glow') m.material.color.setScalar(1.6);
    }
    return g;
  }
  // 8-float layout with a baked lighting atlas (the night street)
  async function bakedSet(name, atlas) {
    const v = await verts(name), n = v.length / 8, P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { P.set(v.subarray(i * 8, i * 8 + 3), i * 3); N.set(v.subarray(i * 8 + 3, i * 8 + 6), i * 3); U.set(v.subarray(i * 8 + 6, i * 8 + 8), i * 2); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    const tex = await new THREE.TextureLoader().loadAsync(ASSETS + atlas); tex.flipY = true; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); m.frustumCulled = false;
    return m;
  }
  const street = await bakedSet('vertices', 'street-atlas.png');
  const sets = { street: new THREE.Group(), room: await propSet('room'), egypt: await propSet('egypt'), future: await propSet('future'), space: new THREE.Group() };
  sets.street.add(street); for (const g of Object.values(sets)) scene.add(g);
  stylize(sets.room, 'set'); stylize(sets.egypt, 'set', { outlineScale: 1.5 });
  const futureLayer = sets.future; // drawn together with the street for 5451 AD

  // ---------------------------------------------------------------- our signs over the shop window (no game logos)
  const signTex = (top, mid, small, col) => canvasTex(1024, 560, (g, w, h) => {
    g.fillStyle = '#0d1424'; g.fillRect(0, 0, w, h); g.strokeStyle = col; g.lineWidth = 14; g.strokeRect(20, 20, w - 40, h - 40);
    g.textAlign = 'center'; g.fillStyle = col; g.font = '900 170px "Inter", Arial'; g.fillText(top, w / 2, 230); g.fillStyle = '#f4efe6'; g.font = '900 96px "Inter", Arial'; g.fillText(mid, w / 2, 360); g.font = '700 46px "Inter", Arial'; g.fillStyle = '#9fb3c8'; g.fillText(small, w / 2, 450);
  });
  const sign = mesh(new THREE.PlaneGeometry(4.15, 2.23), new THREE.MeshBasicMaterial({ map: signTex('GTA 6', 'MIDNIGHT LAUNCH', 'PREORDERS: PICK UP HERE', '#ff8fb4'), toneMapped: false }), [-4.38, 1.965, -1.225], [0, Math.PI / 2, 0], sets.street, false);
  const signNow = sign.material.map, signFuture = signTex('GTA 7', 'COMING SOON', 'RELEASE DATE: TBA', '#6aeddc');

  // ---------------------------------------------------------------- characters (Hold Up vector rigs)
  const P = plan.character, F = P.forms;
  const variant = (pal, hair, edit = null) => makeFigureCard({ ...P, palette: { ...P.palette, ...pal }, forms: hair ? { ...F, hair: { shape: hair, smooth: 2, sample: [-120, 60] } } : F }, { canvasPx: 1536, edit });
  const LONG = [[-168, -150], [-176, 40], [-160, 150], [-110, 205], [-150, 240], [-188, 232], [-196, 190], [-170, 160], [-130, 200], [-20, 222], [70, 212], [130, 180], [165, 120], [168, 60], [138, 98], [80, 128], [20, 135], [-40, 120], [-90, 80], [-120, 20], [-132, -80], [-150, -150]];
  const SHORT = [[-168, -10], [-171, 70], [-152, 142], [-104, 192], [-20, 214], [62, 206], [122, 180], [160, 128], [168, 86], [140, 104], [92, 132], [30, 142], [-30, 132], [-80, 96], [-110, 40], [-124, -20], [-140, -58], [-160, -50]];
  const BEANIE = [[-176, -30], [-172, 60], [-160, 140], [-110, 215], [-20, 244], [80, 236], [150, 194], [174, 122], [174, 66], [100, 76], [0, 80], [-100, 72], [-150, 40], [-160, -20]];
  const NEMES = [[-182, -190], [-188, 40], [-160, 162], [-90, 216], [0, 232], [90, 216], [150, 170], [172, 100], [176, 40], [150, 60], [100, 92], [30, 100], [-40, 92], [-100, 44], [-122, -60], [-140, -190]];
  const headPt = (fig, st, x, y) => { const hc = fig.joints.headCenter, a = -(st.pose.torso + st.pose.head) * Math.PI / 180; return [hc[0] + x * Math.cos(a) - y * Math.sin(a), hc[1] + x * Math.sin(a) + y * Math.cos(a)]; };
  const rect = (c, w, h, a = 0) => [[-w, -h], [w, -h], [w, h], [-w, h]].map(([x, y]) => [c[0] + x * Math.cos(a) - y * Math.sin(a), c[1] + x * Math.sin(a) + y * Math.cos(a)]);
  const held = { phone: false, pad: false };
  const props2d = (fig) => {
    if (held.phone) { const h = fig.joints.handF; fig.items.push({ id: 'phone', outline: true, shapes: [{ pts: rect([h[0], h[1] + 40], 42, 74, 0.25), closed: true, fill: '#2a2f36' }, { pts: rect([h[0], h[1] + 40], 32, 62, 0.25), closed: true, fill: '#6fa6c9' }] }); }
    if (held.pad) { const a = fig.joints.handF, b = fig.joints.handB, c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 10]; fig.items.push({ id: 'pad', outline: true, shapes: [{ pts: rect(c, 95, 42), closed: true, fill: '#23262c' }, { pts: rect([c[0] + 40, c[1] + 8], 12, 12), closed: true, fill: '#6aeddc' }] }); }
    return fig;
  };
  const hero = makeFigureCard(P, { canvasPx: 2048, edit: props2d });
  const friend = variant({ shirt: '#5b6a3f', apron: '#f2efe6', trousers: '#2e2b2a', boots: '#6b7a4a', hair: '#2a1d16', skin: '#C08A64' }, LONG, props2d);
  const pharaoh = variant({ shirt: '#B9805A', apron: '#f1e9d6', trousers: '#f1e9d6', boots: '#a07a3a', hair: '#d9a33a', skin: '#B9805A' }, NEMES, (fig, def, st) => {
    const stripe = y => ({ pts: [headPt(fig, st, -170, y), headPt(fig, st, -60, y + 10), headPt(fig, st, 60, y + 8), headPt(fig, st, 150, y - 10)], closed: false, stroke: '#2f4f8f', width: 14 });
    fig.items.push({ id: 'nemes', outline: false, shapes: [stripe(185), stripe(140)] });
    const h = fig.joints.handF; fig.items.push({ id: 'crook', outline: true, shapes: [{ pts: [[h[0], h[1] - 300], [h[0], h[1] + 380], [h[0] + 30, h[1] + 450], [h[0] + 80, h[1] + 440]], closed: false, stroke: '#d9a33a', width: 20 }] });
    const n = fig.joints.neck; fig.items.push({ id: 'collar', outline: true, shapes: [{ pts: rect([n[0] + 10, n[1] - 40], 120, 34), closed: true, fill: '#2f6f8f' }, { pts: rect([n[0] + 10, n[1] - 40], 120, 12), closed: true, fill: '#d9a33a' }] });
    return fig;
  });
  const scribe = variant({ shirt: '#efe6d0', apron: '#efe6d0', trousers: '#efe6d0', boots: '#8a5a34', hair: '#2a1d16', skin: '#C9946C' }, SHORT, (fig) => { const h = fig.joints.handF; fig.items.push({ id: 'scroll', outline: true, shapes: [{ pts: rect([h[0] + 10, h[1] + 60], 70, 95, 0.15), closed: true, fill: '#e8d6a8' }] }); return fig; });
  const skeleton = variant({ skin: '#efe9dc' }, null, (fig, def, st) => {
    fig.items = fig.items.filter(it => !['eyes', 'brows', 'mouth', 'tongue', 'hair'].includes(it.id));
    const ring = (cx, cy, rx, ry) => Array.from({ length: 22 }, (_, i) => headPt(fig, st, cx + Math.cos(i / 22 * 6.283) * rx, cy + Math.sin(i / 22 * 6.283) * ry));
    fig.items.push({ id: 'skull', outline: false, shapes: [{ pts: ring(30, 40, 40, 46), closed: true, fill: '#2a2420' }, { pts: ring(122, 40, 36, 44), closed: true, fill: '#2a2420' }, { pts: [headPt(fig, st, 70, -10), headPt(fig, st, 86, -40), headPt(fig, st, 58, -40)], closed: true, fill: '#2a2420' },
      ...[0, 1, 2, 3, 4].map(k => ({ pts: [headPt(fig, st, 22 + k * 26, -78), headPt(fig, st, 22 + k * 26, -108)], closed: false, stroke: '#2a2420', width: 7 })), { pts: [headPt(fig, st, 10, -92), headPt(fig, st, 140, -92)], closed: false, stroke: '#2a2420', width: 6 }] });
    if (held.pad) props2d(fig);
    return fig;
  });
  for (const c of [hero, friend, pharaoh, scribe, skeleton]) scene.add(c.group);
  const STAND = { hipDrop: 0, torso: 3, head: 0, armF: [8, 14], armB: [-6, 12], legF: [3, 3], legB: [-3, 3], handF: 'open', handB: 'open', squash: 1 };
  const SEAT = { hipDrop: 0, torso: 8, head: 4, legF: [82, 78], legB: [88, 82], armF: [52, 74], armB: [44, 80], handF: 'fist', handB: 'fist', squash: 1 };
  const pending = [];
  const place = (card, pos, state, o = {}) => pending.push([card, pos, state, o]);
  function placeNow(card, pos, state, { mirror = 1, hipY = 0.94, tint = [1, 0.975, 0.94] } = {}) {
    card.group.visible = true; card.group.position.set(...pos); card.group.rotation.y = Math.atan2(camera.position.x - pos[0], camera.position.z - pos[2]);
    card.set({ blink: 0, gaze: [0, 0], ...state }, { hip: [0, hipY, 0], mirror, outlineMm: 7, tint: new THREE.Color(...tint) });
  }
  // the queue: a few looks painted once, then instanced along the street (and beyond it, into the night)
  const looks = [
    { shirt: '#2e3036', apron: '#4f8c87', hair: '#3b2a20' }, { shirt: '#7a4f2e', apron: '#f2efe6', hair: '#1d1714', skin: '#8D5A3C' },
    { shirt: '#5b6a3f', apron: '#f2efe6', hair: '#2a1d16', skin: '#C08A64', h: LONG }, { shirt: '#4f6f6c', apron: '#1d1d1f', hair: '#3a3d42', h: BEANIE },
    { shirt: '#6b3a4a', apron: '#e9e2d4', hair: '#4b2d1f', skin: '#E8B998', h: SHORT }, { shirt: '#3f4a5c', apron: '#ece6d8', hair: '#2a201a', skin: '#C98E66', h: SHORT }];
  const people = await (await fetch(ASSETS + 'people.json')).json();
  const spots = people.map(p => [p.position[0], -p.position[1]]);          // their Z-up (x, y) -> our (x, -z)
  for (let z = -4.6; z > -95; z -= 0.92) spots.push([-1.75 + 0.08 * Math.sin(z * 1.7), z]);
  const crowd = looks.map((L, k) => {
    const card = variant({ shirt: L.shirt, apron: L.apron, hair: L.hair, skin: L.skin ?? P.palette.skin, trousers: ['#2b3446', '#2e2b2a', '#3a3a3e'][k % 3] }, L.h ?? null);
    card.set({ pose: { ...STAND, head: (k % 3 - 1) * 6, armF: k % 2 ? [40, 100] : [8, 14], handF: k % 2 ? 'fist' : 'open' }, face: ['neutral', 'thinking', 'curious'][k % 3], gaze: [0, 0], blink: 0 }, { hip: [0, 0.94, 0], mirror: 1, outlineMm: 7 });
    const m = card.group.children[0]; m.updateMatrix();
    const geo = m.geometry.clone().applyMatrix4(m.matrix);
    const mine = spots.filter((_, i) => i % looks.length === k);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: m.material.uniforms.map.value, alphaTest: 0.5, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(0.82, 0.84, 0.95) }), mine.length);
    im.frustumCulled = false; sets.street.add(im);
    return { im, mine, k };
  });
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), Y = V(0, 1, 0);
  function updateCrowd(t, sway = 1) {
    for (const { im, mine, k } of crowd) mine.forEach(([x, z], i) => {
      const yaw = Math.atan2(camera.position.x - x, camera.position.z - z); Q.setFromAxisAngle(Y, yaw);
      const s = 0.96 + 0.08 * ((i * 7 + k) % 5) / 4, mir = (i + k) % 2 ? 1 : -1;
      M4.compose(V(x, 0.22 + 0.006 * sway * Math.sin(t * 2 + i), z), Q, V(mir * s, s, s)); im.setMatrixAt(i, M4);
    });
    crowd.forEach(c => (c.im.instanceMatrix.needsUpdate = true));
  }

  // ---------------------------------------------------------------- the globe (Natural Earth coastlines, public domain)
  const land = await (await fetch(ASSETS + 'land.json')).json();
  const earthTex = canvasTex(2048, 1024, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#16304f'); gr.addColorStop(0.5, '#1d4166'); gr.addColorStop(1, '#16304f'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = '#5f7d52'; g.strokeStyle = '#2a3a28'; g.lineWidth = 2;
    for (const poly of land) { g.beginPath(); poly.forEach(([lo, la], i) => { const x = (lo + 180) / 360 * w, y = (90 - la) / 180 * h; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fill(); g.stroke(); }
    g.fillStyle = 'rgba(240,240,232,0.85)'; g.fillRect(0, 0, w, h * 0.045); g.fillRect(0, h * 0.94, w, h * 0.06);
  });
  const globe = new THREE.Group(); sets.space.add(globe); sets.space.position.set(0, 0, -600);
  const R = 3;
  mesh(new THREE.SphereGeometry(R, 96, 64), std(0xffffff, { map: earthTex, r: 0.85 }), [0, 0, 0], [0, 0, 0], globe, false);
  mesh(new THREE.SphereGeometry(R * 1.04, 64, 48), new THREE.MeshBasicMaterial({ color: 0x6fb6ff, transparent: true, opacity: 0.12, side: THREE.BackSide, depthWrite: false }), [0, 0, 0], [0, 0, 0], globe, false);
  const ll = (lat, lon, r = R) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return V(r * Math.cos(a) * Math.sin(b), r * Math.sin(a), r * Math.cos(a) * Math.cos(b)); };
  // the line: from a store in the middle of the US, east along a great circle for 5,682 miles (82.2 degrees of arc)
  const start = ll(37, -96).normalize(), east = V(0, 1, 0).cross(start).normalize(), axis = start.clone().cross(east).normalize();
  const arcPts = n => Array.from({ length: n + 1 }, (_, i) => start.clone().applyAxisAngle(axis, i / n * 82.2 * Math.PI / 180).multiplyScalar(R * 1.012));
  const arcMat = new THREE.MeshBasicMaterial({ color: 0xffb547, toneMapped: false });
  let arc = null;
  const starsTex = canvasTex(1024, 1024, (g, w, h) => { g.fillStyle = '#04070f'; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(255,255,255,${0.2 + 0.6 * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 1.2, 1.2); } });
  mesh(new THREE.SphereGeometry(200, 24, 16), new THREE.MeshBasicMaterial({ map: starsTex, side: THREE.BackSide, toneMapped: false }), [0, 0, 0], [0, 0, 0], sets.space, false);

  // ---------------------------------------------------------------- pennies (US cent: 19.05 mm x 1.52 mm)
  const copper = canvasTex(512, 512, (g, w, h) => { const r = g.createRadialGradient(w * 0.4, h * 0.4, 10, w / 2, h / 2, w / 2); r.addColorStop(0, '#e59a5c'); r.addColorStop(1, '#a3582c'); g.fillStyle = r; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(80,36,14,0.6)'; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 22, 0, 7); g.stroke(); g.fillStyle = 'rgba(90,40,16,0.75)'; g.textAlign = 'center'; g.font = '900 210px Georgia, serif'; g.fillText('1', w / 2, h / 2 + 50); g.font = '700 46px Georgia, serif'; g.fillText('ONE CENT', w / 2, h / 2 + 140); });
  const coin = new THREE.Group(); sets.space.add(coin); coin.position.set(0, 0, 40);
  mesh(new THREE.CylinderGeometry(1, 1, 0.16, 64), [std(0xb8673a, { m: 0.65, r: 0.32 }), std(0xffffff, { map: copper, m: 0.6, r: 0.3 }), std(0xffffff, { map: copper, m: 0.6, r: 0.3 })], [0, 0, 0], [Math.PI / 2, 0, 0], coin, false);
  const stackTex = canvasTex(512, 512, (g, w, h) => { for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 32) { const v = 0.8 + 0.2 * rnd(); g.fillStyle = `rgb(${200 * v | 0},${110 * v | 0},${60 * v | 0})`; g.fillRect(x + 1, y + 1, 30, 6); } });
  stackTex.wrapS = stackTex.wrapT = THREE.RepeatWrapping; stackTex.repeat.set(10, 10);
  const cube = mesh(new THREE.BoxGeometry(1, 1, 1), std(0xffffff, { map: stackTex, m: 0.5, r: 0.38 }), [0, 0, 0], [0, 0, 0], sets.street);
  const SIDE = 35.34;            // metres: 80 billion pennies stacked in square columns
  const ruler = new THREE.Group(); sets.street.add(ruler);
  mesh(new THREE.BoxGeometry(0.25, 1, 0.25), new THREE.MeshBasicMaterial({ color: 0x6aeddc, toneMapped: false }), [0, 0.5, 0], [0, 0, 0], ruler, false);

  // ---------------------------------------------------------------- the TV game screen (an original driving scene)
  const tvC = document.createElement('canvas'); tvC.width = 480; tvC.height = 270; const tvG = tvC.getContext('2d'), tvTex = new THREE.CanvasTexture(tvC); tvTex.colorSpace = THREE.SRGBColorSpace;
  mesh(new THREE.PlaneGeometry(3.4, 1.78), new THREE.MeshBasicMaterial({ map: tvTex, toneMapped: false }), [-2.975, 1.7, -1.8], [0, Math.PI / 2, 0], sets.room, false);
  function drawTV(t) {
    const g = tvG; g.fillStyle = '#ff9a6a'; g.fillRect(0, 0, 480, 150); const sk = g.createLinearGradient(0, 0, 0, 150); sk.addColorStop(0, '#2b2a6b'); sk.addColorStop(1, '#ff8a6a'); g.fillStyle = sk; g.fillRect(0, 0, 480, 150);
    for (let j = 0; j < 14; j++) { const x = ((j * 41 - t * 30) % 520 + 520) % 520 - 20, hh = 30 + (j % 4) * 20; g.fillStyle = '#1c1f3a'; g.fillRect(x, 150 - hh, 26, hh); }
    g.fillStyle = '#2b2b33'; g.fillRect(0, 150, 480, 120); g.fillStyle = '#4a4a55'; g.beginPath(); g.moveTo(215, 150); g.lineTo(265, 150); g.lineTo(440, 270); g.lineTo(40, 270); g.fill();
    for (let j = 0; j < 8; j++) { const y = 150 + ((j * 22 + t * 90) % 120), s = (y - 150) * 0.9; g.fillStyle = '#f3b83d'; g.fillRect(238 - s * 0.02, y, 4 + s * 0.04, 8 + s * 0.06); }
    g.fillStyle = '#6aeddc'; g.beginPath(); g.roundRect(206 + 8 * Math.sin(t * 2), 214, 68, 38, 8); g.fill(); g.fillStyle = '#f4efe6'; g.font = '700 18px Inter, Arial'; g.fillText('03:00:00', 380, 26);
    tvTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- a little robot and hover cars for 5451 AD
  const robot = new THREE.Group(); sets.future.add(robot);
  mesh(new THREE.SphereGeometry(0.32, 24, 16), std(0xe4dccb, { r: 0.4 }), [0, 0, 0], [0, 0, 0], robot);
  const face = mesh(new THREE.BoxGeometry(0.42, 0.24, 0.06), std(0x1d2026, { r: 0.3 }), [0, 0.12, 0.27], [0, 0, 0], robot, false);
  for (const x of [-0.09, 0.09]) mesh(new THREE.BoxGeometry(0.06, 0.1, 0.02), new THREE.MeshBasicMaterial({ color: 0x6aeddc, toneMapped: false }), [x, 0.12, 0.31], [0, 0, 0], robot, false);
  mesh(new THREE.CylinderGeometry(0.12, 0.06, 0.12, 16), new THREE.MeshBasicMaterial({ color: 0x9ff2ff, toneMapped: false, transparent: true, opacity: 0.7 }), [0, -0.38, 0], [0, 0, 0], robot, false);
  stylize(robot, 'hero', { outlineScale: 0.8 });
  const bone = new THREE.Group(); sets.future.add(bone); mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10), std(0xefe9dc), [0, 0, 0], [0, 0, Math.PI / 2], bone); for (const x of [-0.2, 0.2]) mesh(new THREE.SphereGeometry(0.06, 10, 8), std(0xefe9dc), [x, 0, 0], [0, 0, 0], bone);
  const cars = Array.from({ length: 6 }, (_, j) => { const c = new THREE.Group(); sets.future.add(c); mesh(new THREE.CapsuleGeometry(0.7, 2.2, 6, 12), std([0xd8d2c4, 0x2f3a4a, 0xb04a5a][j % 3], { r: 0.35, m: 0.3 }), [0, 0, 0], [Math.PI / 2, 0, 0], c); mesh(new THREE.BoxGeometry(1.2, 0.08, 3.2), new THREE.MeshBasicMaterial({ color: 0x6aeddc, toneMapped: false }), [0, -0.62, 0], [0, 0, 0], c, false); return c; });

  // ---------------------------------------------------------------- lights, camera, overlays
  const hemi = new THREE.HemisphereLight(0x8fa6c8, 0x2a2420, 0.9); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd8a0, 2.6); sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowMap * 2, quality.shadowMap * 2); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; scene.add(sun, sun.target);
  function light(at, from, { k = 2.6, kc = 0xffd8a0, h = 0.9, hs = 0x8fa6c8, hg = 0x2a2420, size = 20 } = {}) {
    sun.target.position.set(...at); sun.position.set(at[0] + from[0], at[1] + from[1], at[2] + from[2]); sun.intensity = k; sun.color.set(kc); hemi.intensity = h; hemi.color.set(hs); hemi.groundColor.set(hg);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 1; sc.far = 200; sc.updateProjectionMatrix();
  }
  const cam = (p, l, fov, shake = 0, t = 0) => { camera.fov = fov; camera.position.set(p[0] + shake * Math.sin(t * 83), p[1] + shake * Math.sin(t * 107), p[2]); camera.lookAt(...l); };
  const bg = new THREE.Color(); scene.background = bg;
  function show(...names) { for (const [k, g] of Object.entries(sets)) g.visible = names.includes(k); for (const c of [hero, friend, pharaoh, scribe, skeleton]) c.group.visible = false; }
  const norm = w => w.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
  const W = (a, edge = 'start') => { const [txt, n] = a.split('#'), hits = plan.words.filter(w => norm(w.text) === norm(txt)), w = hits[(Number(n) || 1) - 1]; if (!w) throw new Error(`word ${a}`); return w[edge]; };
  const blinkAt = t => { const p = (t + 0.3) % 2.9; return p < 0.12 ? Math.sin(p / 0.12 * Math.PI) : 0; };
  const fmt = n => Math.round(n).toLocaleString('en-US');
  // big on-screen numbers at the top (the captions sit lower): a kicker, a white line and an amber line
  const hud = (kick, a, b, s = 1, small = '') => (g, Wd, Hd) => {
    if (s <= 0.001) return;
    const u = Wd / 1080; g.save(); g.translate(Wd / 2, 0); g.globalAlpha = Math.min(1, s); g.textAlign = 'center'; g.lineJoin = 'round';
    const line = (txt, y, size, col) => { g.font = `900 ${size * u}px "Inter", Arial`; const fit = Math.min(1, 940 * u / g.measureText(txt).width); size *= fit; g.font = `900 ${size * u}px "Inter", Arial`; g.strokeStyle = '#0b1222'; g.lineWidth = size * 0.2 * u; g.strokeText(txt, 0, y * u); g.fillStyle = col; g.fillText(txt, 0, y * u); };
    if (kick) { g.font = `800 ${30 * u}px "Inter", Arial`; g.fillStyle = '#6aeddc'; g.fillText(kick, 0, 205 * u); }
    g.scale(0.85 + 0.15 * s, 0.85 + 0.15 * s); line(a, 300, 92, '#f4efe6'); if (b) line(b, 410, 112, '#ffc547'); if (small) { g.font = `700 ${30 * u}px "Inter", Arial`; g.fillStyle = '#c9d4e2'; g.fillText(small, 0, 470 * u); }
    g.restore();
  };
  const tintNight = [0.8, 0.83, 0.98];

  // ================================================================= the shots
  const shots = {
    hook(t, T, d) {
      show('street'); bg.set('#060a14'); scene.fog = new THREE.FogExp2(0x060a14, 0.012); sign.material.map = signNow;
      held.phone = true; updateCrowd(T);
      place(hero, [1.4, 0.22, 3.2], { pose: { ...STAND, armF: [40, 102], handF: 'fist', head: 12 }, face: 'curious', gaze: [0, -0.7], blink: blinkAt(T) }, { mirror: -1, tint: tintNight });
      const u = sseg(t, 0, d);
      cam(mix([10, 5.7, 14], [7.8, 4.2, 10.5], u), [-2.5, 2.4, -1.5], 52);
      return { paint: hud('ONE SHOP. EVERY GTA 6 BUYER.', 'What if everyone', 'shopped HERE?', pop(t, 0.35, 0.4)) };
    },
    line(t, T, d) {
      show('street'); bg.set('#060a14'); scene.fog = new THREE.FogExp2(0x060a14, 0.006); sign.material.map = signNow; updateCrowd(T);
      const u = sseg(t, 0, d);
      cam(mix([8.4, 4.6, 11.3], [5.5, 15, 6], u), mix([-3, 2.3, -2], [-2, 0.5, -34], u), 62);
      const n = Math.min(1, eout(seg(T, W('stretch') - 0.1, W('miles') + 0.3)));
      return { paint: hud('ESTIMATED PREORDERS, THIRD-PARTY REPORT', '10 MILLION PEOPLE', '~' + fmt(5700 * n) + ' MILES', pop(t, 0.6, 0.4), 'At 3 feet per person') };
    },
    globe(t, T, d) {
      show('space'); bg.set('#04070f'); scene.fog = null; coin.visible = false; globe.visible = true;
      light([0, 0, -600], [-6, 3, 8], { k: 3.2, kc: 0xfff2e0, h: 0.35, hs: 0x8fa6c8, hg: 0x000000 });
      const u = eout(seg(t, 0.2, d - 0.6)), n = Math.max(2, Math.round(120 * u));
      if (arc) { globe.remove(arc); arc.geometry.dispose(); }
      arc = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(arcPts(n)), n * 2, 0.035, 8), arcMat, [0, 0, 0], [0, 0, 0], globe, false);
      globe.rotation.y = -0.2 - 0.55 * smooth(seg(t, 0, d)); globe.rotation.x = 0.35;
      cam([0, 1.2, -600 + 10.5], [0, -0.4, -600], 38);
      return { paint: hud('THE QUEUE, AT PLANET SCALE', 'Almost ¼ of Earth', 'ONE GAME SHOP.', pop(t, 0.2, 0.4)) };
    },
    penny(t, T, d) {
      show('space'); bg.set('#0b1222'); scene.fog = null; globe.visible = false; coin.visible = true;
      light([0, 0, -560], [-4, 5, 6], { k: 3.4, kc: 0xffe2c0, h: 0.6 });
      coin.rotation.set(0.25 * Math.sin(T), T * 1.6, 0); coin.position.y = 0.06 * Math.sin(T * 2);
      cam([0, 0.3, -560 + 4.6], [0, 0, -560], 36);
      return { paint: hud('10 MILLION BUYERS × $80 PER COPY', '$800 MILLION', 'IN PENNIES?', pop(t, 0.25, 0.4)) };
    },
    cube(t, T, d) {
      show('street'); bg.set('#060a14'); scene.fog = new THREE.FogExp2(0x060a14, 0.0035); sign.material.map = signNow; updateCrowd(T, 0);
      light([42, 0, -42], [-30, 50, 40], { k: 3.0, kc: 0xc8d4ff, h: 1.3, size: 45 });
      const h = Math.max(0.02, SIDE * eout(seg(T, W('build') - 0.2, W('tall') + 0.25)));
      cube.position.set(25 + SIDE / 2, h / 2, -25 - SIDE / 2); cube.scale.set(SIDE, h, SIDE); cube.material.map.repeat.set(SIDE / 3.2, h / 3.2);
      ruler.position.set(21, 0, -22); ruler.scale.set(1, h, 1);
      const u = sseg(t, 0, d);
      cam(mix([50, 35, 75], [86, 70, 128], u), [12, 13, -16], 55);
      return { paint: hud('10 MILLION BUYERS × $80 PER COPY', '80 BILLION PENNIES', fmt(116 * h / SIDE) + ' FEET TALL', pop(t, 0.3, 0.4), 'A cube 116 feet wide, deep and tall') };
    },
    couch(t, T, d) {
      show('room'); bg.set('#081016'); scene.fog = null; held.pad = true; held.phone = false; drawTV(T);
      light([0.2, 1, -1.7], [3, 5, 4], { k: 1.0, kc: 0xffd2a0, h: 0.7, hs: 0x6aa0c0, hg: 0x20160e, size: 8 });
      const bob = k => 3 * Math.sin(T * 4 + k);
      place(hero, [1.25, 0.0, -1.42], { pose: { ...SEAT, torso: 10 + bob(0) * 0.6 }, face: 'determined', gaze: [0.6, 0], blink: blinkAt(T) }, { mirror: -1, hipY: 0.62, tint: [0.92, 0.94, 1] });
      place(friend, [-0.05, 0.0, -1.6], { pose: { ...SEAT, torso: 12 + bob(1) * 0.6 }, face: 'happy', gaze: [0.6, 0], blink: blinkAt(T + 1) }, { mirror: -1, hipY: 0.62, tint: [0.92, 0.94, 1] });
      const u = sseg(t, 0, d);
      cam(mix([5.8, 3.4, 5.5], [4.8, 2.8, 4.0], u), [0.2, 1.15, -1.7], 58);
      return { paint: hud('OPENING NIGHT', '10,000,000 PLAYERS', 'JUST 3 HOURS EACH', pop(t, 0.3, 0.4)) };
    },
    years(t, T, d) {
      show('room'); bg.set('#081016'); scene.fog = null; held.pad = true; drawTV(T);
      light([0.2, 1, -1.7], [3, 5, 4], { k: 1.0, kc: 0xffd2a0, h: 0.7, hs: 0x6aa0c0, hg: 0x20160e, size: 8 });
      place(hero, [1.25, 0.0, -1.42], { pose: { ...SEAT, torso: 10 }, face: 'surprised', gaze: [0.2, 0.2], blink: 0 }, { mirror: -1, hipY: 0.62, tint: [0.92, 0.94, 1] });
      place(friend, [-0.05, 0.0, -1.6], { pose: { ...SEAT, torso: 12 }, face: 'happy', gaze: [0.6, 0], blink: blinkAt(T) }, { mirror: -1, hipY: 0.62, tint: [0.92, 0.94, 1] });
      cam([4, 2.25, 3.4], [0.2, 1.15, -1.7], 50);
      const n = eout(seg(T, W('over#2') - 0.1, W('years') + 0.4)), flip = T > W('years') + 0.4;
      return { paint: flip ? hud('COMBINED PLAYING TIME', '3,425 YEARS', 'ON OPENING NIGHT', 1, 'Total player-hours, not elapsed time') : hud('COMBINED PLAYING TIME', fmt(30000000 * n) + ' HOURS', '', pop(t, 0.1, 0.3)) };
    },
    egypt(t, T, d) {
      show('egypt'); bg.set('#b08a58'); scene.fog = new THREE.FogExp2(0xd8b47e, 0.007); held.pad = false; held.phone = false;
      light([0, 0, -5], [-20, 26, 18], { k: 3.0, kc: 0xffd29a, h: 1.0, hs: 0xf2d6a8, hg: 0x6a4a2a, size: 20 });
      place(scribe, [2.2, 0.05, -3.5], { pose: { ...STAND, armF: [40, 90], handF: 'open', head: 10 }, face: 'thinking', gaze: [0, -0.5], blink: blinkAt(T) }, { mirror: -1 });
      place(pharaoh, [1, 0.03, -0.8], { pose: { ...STAND, armF: [20, 80], handF: 'fist', head: -4 }, face: 'determined', gaze: [0.2, 0.1], blink: blinkAt(T + 1) }, { mirror: -1 });
      const u = sseg(t, 0, d);
      cam(mix([6.4, 2.6, 4.6], [5.2, 2.3, 3.2], u), [1.4, 1.6, -2.2], 50);
      return { paint: hud('GO BACK 3,425 YEARS…', 'ANCIENT EGYPT', 'c. 1400 BC', pop(t, 0.2, 0.4)) };
    },
    future(t, T, d) { return futureShot(t, T, d, false); },
    waiting(t, T, d) { return futureShot(t, T, d, true); }
  };
  function futureShot(t, T, d, close) {
    show('street', 'future'); bg.set('#050a1a'); scene.fog = new THREE.FogExp2(0x050a1a, 0.006); sign.material.map = signFuture; held.phone = false; held.pad = false;
    light([0, 0, 0], [10, 30, 20], { k: 0.8, kc: 0x9fd8ff, h: 0.7, hs: 0x6aa0ff, hg: 0x101020, size: 25 });
    for (const c of crowd) c.im.visible = false;
    cars.forEach((c, j) => c.position.set(4 + (j % 2) * 4, 9 + (j % 3) * 3, -(((T * 6 + j * 21) % 100) - 20)));
    const a = S.future.startSec, gag = T - W('GTA#2', 'end');
    robot.position.set(lerp(5.4, 3.8, sseg(T, a + 0.5, a + 2)), 0.6 + 0.05 * Math.sin(T * 3), 2.9);
    bone.visible = gag > 0; if (gag > 0) { const f = eout(clamp(gag / 0.5)); bone.position.set(2.5 + 0.6 * f, 1.2 * (1 - f) + 0.08, 4.05); bone.rotation.z = f * 3; }
    place(skeleton, [2.7, 0.055, 4], { pose: { ...STAND, torso: 5, head: close ? 10 : 6, armF: [20, 40], armB: [-4, 20] }, face: 'neutral', blink: 0 }, { mirror: -1, tint: [0.85, 0.9, 1] });
    const u = sseg(T, a, S.waiting.endSec);
    if (!close) cam(mix([12, 8, 16], [8.5, 4.6, 12], u), [-2, 3.3, -3], 58);
    else cam(mix([6.2, 2.0, 8.2], [5.4, 1.8, 7.1], sseg(t, 0, d)), [2.4, 1.4, 3.2], 44);
    return { paint: hud('NOW GO FORWARD 3,425 YEARS…', '5451 AD', close ? 'STILL WAITING.' : '', pop(T - a, 0.3, 0.4)), fade: close ? sseg(t, d - 0.45, d - 0.05) : 0 };
  }
  const S = Object.fromEntries(plan.shots.map(s => [s.id, s]));

  return {
    update({ time, shot, t, d }) {
      camera.up.set(0, 1, 0); pending.length = 0;
      for (const c of crowd) c.im.visible = true;
      const fx = shots[shot.id](t, time, d) ?? {};
      camera.updateMatrixWorld();
      for (const a of pending) placeNow(...a);
      return fx;
    }
  };
}
