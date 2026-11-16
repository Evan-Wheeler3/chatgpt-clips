/*
 * Why are school buses yellow? Hand-directed scene (tools/episode/render.mjs).
 * Look development so far: the 1939 flashback only. A tree-lined road past a brick schoolhouse; four 1930s
 * conventional-cab school buses in four different colours roll toward camera in the right-hand lane.
 * Buses face +Z (toward camera). Everything is built here: no downloaded models or textures.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);

export async function build(ctx) {
  const { THREE, scene, camera, stylize, quality, plan, makeFigureCard } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  scene.environment = new THREE.PMREMGenerator(ctx.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.3;

  // ---------------------------------------------------------------- painted textures
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function canvasTex(w, h, draw, { repeat = null } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    return t;
  }
  const grain = (g, w, h, base, amt, n, size = 1.6) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${amt * rnd()})`; g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd())); } };
  const brick = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#cdbca4'; g.fillRect(0, 0, w, h);
    const bw = 64, bh = 24;
    for (let r = 0; r < h / bh; r++) for (let c = -1; c < w / bw + 1; c++) {
      const x = c * bw + (r % 2) * bw / 2, y = r * bh, v = rnd();
      g.fillStyle = `rgb(${150 + v * 34 | 0},${70 + v * 22 | 0},${52 + v * 16 | 0})`; g.fillRect(x + 2, y + 2, bw - 4, bh - 4);
      g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(x + 2, y + bh - 6, bw - 4, 4);
    }
  }, { repeat: [5, 3] });
  const asphalt = canvasTex(512, 512, (g, w, h) => {
    grain(g, w, h, '#5d5a55', 0.12, 26000, 1.8);
    for (let i = 0; i < 18; i++) { g.strokeStyle = 'rgba(25,22,20,0.35)'; g.lineWidth = 1.5; g.beginPath(); let x = rnd() * w, y = rnd() * h; g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 40; y += rnd() * 30; g.lineTo(x, y); } g.stroke(); }
  }, { repeat: [1, 14] });
  const grass = canvasTex(512, 512, (g, w, h) => { grain(g, w, h, '#7f8f4c', 0.14, 30000, 2.4); for (let i = 0; i < 60; i++) { g.fillStyle = `rgba(${rnd() > 0.5 ? '160,150,80' : '70,90,40'},0.18)`; g.beginPath(); g.ellipse(rnd() * w, rnd() * h, 30 + rnd() * 60, 14 + rnd() * 30, 0, 0, 7); g.fill(); } }, { repeat: [12, 12] });
  const concrete = canvasTex(256, 256, (g, w, h) => { grain(g, w, h, '#c7bfae', 0.07, 9000, 1.6); g.strokeStyle = 'rgba(60,50,40,0.35)'; g.lineWidth = 2; g.beginPath(); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke(); }, { repeat: [1, 12] });
  const skyTex = canvasTex(1024, 512, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#6f9fc4'); gr.addColorStop(0.42, '#a9c7d6'); gr.addColorStop(0.5, '#f4dcae'); gr.addColorStop(1, '#f2c98e'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.filter = 'blur(5px)';
    for (let i = 0; i < 26; i++) { const x = rnd() * w, y = 60 + rnd() * 170; g.fillStyle = `rgba(255,248,236,${0.45 + 0.35 * rnd()})`; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + k * 22 * (rnd() - 0.3), y + (rnd() - 0.5) * 10, 34 + rnd() * 40, 12 + rnd() * 12, 0, 0, 7); g.fill(); } }
    g.filter = 'none';
  });
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.8, metalness: o.m ?? 0, map: o.map ?? null, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, side: o.side ?? THREE.FrontSide });
  const mesh = (geo, mat, p = [0, 0, 0], r = [0, 0, 0], parent = null, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.castShadow = shadow; m.receiveShadow = true; parent?.add(m); return m; };
  const rbox = (w, h, d, r = 0.05, s = 3) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const cyl = (r, h, n = 24, r2 = r) => new THREE.CylinderGeometry(r2, r, h, n);
  function labelTex(text, { fg = '#1d1a17', bg = null, w = 1024, h = 160, font = '900 118px "Inter", "Helvetica Neue", Arial', stretch = 1 } = {}) {
    return canvasTex(w, h, (g) => { if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); } g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.save(); g.translate(w / 2, h / 2 + 6); g.scale(stretch, 1); g.fillText(text, 0, 0); g.restore(); });
  }

  // ---------------------------------------------------------------- a 1930s conventional school bus
  const chrome = std(0xd8d4cc, { m: 0.85, r: 0.3 }), black = std(0x1d1c1b, { r: 0.55 }), tyre = std(0x1a1918, { r: 0.92 });
  const glass = std(0x2c3a44, { r: 0.12, m: 0.4 }), lamp = std(0xfff1cf, { e: 0xffe2a6, ei: 0.35, r: 0.2 });
  function bus(paint, trim, sideText, o = {}) {
    const g = new THREE.Group(), P = std(paint, { r: 0.42, m: 0.05 }), T = std(trim, { r: 0.5 });
    const L0 = o.L0 ?? -4.6, L1 = 1.6, BW = o.BW ?? 2.3, Y0 = 0.82, Y1 = o.Y1 ?? 2.85;          // body box (z from L0 to L1); varies by bus
    mesh(rbox(BW, Y1 - Y0, L1 - L0, 0.26, 4), P, [0, (Y0 + Y1) / 2, (L0 + L1) / 2], [0, 0, 0], g);
    mesh(rbox(BW + 0.04, 0.12, L1 - L0 + 0.02, 0.05), black, [0, Y0 + 0.02, (L0 + L1) / 2], [0, 0, 0], g);   // skirt rail
    mesh(rbox(BW - 0.3, 0.06, L1 - L0 - 0.4, 0.03), T, [0, Y1 + 0.02, (L0 + L1) / 2], [0, 0, 0], g);            // roof ridge
    // window band: glass panes with paint-coloured posts, both sides; belt rail and drip rail in trim
    const nW = o.nW ?? 7, wy0 = 1.88, wy1 = 2.5, span = (L1 - 0.45) - (L0 + 0.35), pitch = span / nW;
    for (const s of [-1, 1]) {
      for (let i = 0; i < nW; i++) { const z = L0 + 0.35 + pitch * (i + 0.5); mesh(rbox(0.04, wy1 - wy0, pitch - 0.14, 0.04), glass, [s * (BW / 2 + 0.005), (wy0 + wy1) / 2, z], [0, 0, 0], g, false); mesh(new THREE.BoxGeometry(0.03, 0.04, pitch - 0.16), chrome, [s * (BW / 2 + 0.02), (wy0 + wy1) / 2 + 0.02, z], [0, 0, 0], g, false); }
      for (const [y, h] of [[1.78, 0.07], [2.6, 0.05], [1.18, 0.05]]) mesh(rbox(0.05, h, L1 - L0 - 0.2, 0.02), T, [s * (BW / 2 + 0.01), y, (L0 + L1) / 2], [0, 0, 0], g);
      const lt = labelTex(sideText, { fg: '#1d1a17', font: '900 104px "Inter", "Helvetica Neue", Arial', stretch: 0.9 });
      mesh(new THREE.PlaneGeometry(3.6, 0.38), new THREE.MeshStandardMaterial({ map: lt, transparent: true, roughness: 0.6, depthWrite: false }), [s * (BW / 2 + 0.012), 1.48, (L0 + L1) / 2 - 0.3], [0, s * Math.PI / 2, 0], g, false);
    }
    // rear wheel arches and dual rear wheels
    const wheel = (z, x, r = 0.52, w = 0.3) => { const wg = new THREE.Group(); wg.position.set(x, r, z); g.add(wg); mesh(cyl(r, w, 28), tyre, [0, 0, 0], [0, 0, Math.PI / 2], wg); mesh(cyl(r * 0.55, w + 0.02, 24), std(0x2a2826, { r: 0.6 }), [0, 0, 0], [0, 0, Math.PI / 2], wg); mesh(cyl(r * 0.32, w + 0.05, 20), chrome, [0, 0, 0], [0, 0, Math.PI / 2], wg); return wg; };
    const rz = L0 + 1.6; for (const s of [-1, 1]) { wheel(rz, s * 0.92); wheel(rz, s * 0.6); mesh(rbox(0.12, 0.42, 1.3, 0.05), black, [s * (BW / 2 - 0.02), 0.97, rz], [0, 0, 0], g); }
    // front: cowl, windshield, roof header with the SCHOOL BUS sign
    const front = L1;
    mesh(rbox(BW - 0.02, 0.62, 0.16, 0.05), glass, [0, 2.2, front + 0.02], [0, 0, 0], g, false);
    mesh(new THREE.BoxGeometry(0.08, 0.66, 0.06), P, [0, 2.2, front + 0.1], [0, 0, 0], g, false);
    const sign = labelTex('SCHOOL BUS', { fg: '#1d1a17', bg: '#efe2c0', font: '900 112px "Inter", "Helvetica Neue", Arial', stretch: 0.92 });
    mesh(rbox(1.9, 0.34, 0.06, 0.04), std(0xefe2c0, { r: 0.6 }), [0, Y1 - 0.12, front + 0.12], [0, 0, 0], g);
    mesh(new THREE.PlaneGeometry(1.84, 0.29), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }), [0, Y1 - 0.12, front + 0.152], [0, 0, 0], g, false);
    for (const x of [-0.82, 0.82]) mesh(new THREE.SphereGeometry(0.075, 14, 10), std(0xd04a2e, { e: 0x6a1c0c, ei: 0.6, r: 0.35 }), [x, Y1 - 0.12, front + 0.18], [0, 0, 0], g, false);
    // hood, cowl, grille
    const H0 = front, H1 = front + 1.75;
    mesh(rbox(1.22, 0.78, H1 - H0 + 0.1, 0.22, 4), P, [0, 1.36, (H0 + H1) / 2], [0, 0, 0], g);
    for (const s of [-1, 1]) for (let k = 0; k < 5; k++) mesh(new THREE.BoxGeometry(0.02, 0.32, 0.05), black, [s * 0.615, 1.36, H0 + 0.5 + k * 0.16], [0, 0, 0], g, false);  // louvres
    const shield = new THREE.Shape(); shield.moveTo(-0.42, -0.42); shield.lineTo(0.42, -0.42); shield.lineTo(0.48, 0.2); shield.quadraticCurveTo(0.42, 0.52, 0, 0.56); shield.quadraticCurveTo(-0.42, 0.52, -0.48, 0.2); shield.lineTo(-0.42, -0.42);
    mesh(new THREE.ExtrudeGeometry(shield, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 }), chrome, [0, 1.32, H1 + 0.02], [0, 0, 0], g);
    for (let k = -4; k <= 4; k++) mesh(new THREE.BoxGeometry(0.035, 0.78, 0.03), std(0x34312d, { r: 0.4, m: 0.5 }), [k * 0.085, 1.33, H1 + 0.13], [0, 0, 0], g, false);
    // front fenders: an arch over each wheel sweeping down toward the bumper
    const arch = new THREE.Shape(), R0 = 0.6, R1 = 0.68;
    arch.moveTo(R1, 0); for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI; arch.lineTo(Math.cos(a) * R1, Math.sin(a) * R1 + (a < 1.2 ? (1.2 - a) * 0 : 0)); }
    arch.lineTo(-R1 - 0.55, -0.05); arch.lineTo(-R1 - 0.55, -0.12); for (let i = 20; i >= 0; i--) { const a = i / 20 * Math.PI; arch.lineTo(Math.cos(a) * R0, Math.sin(a) * R0); } arch.lineTo(R0 + 0.32, -0.32); arch.lineTo(R1 + 0.36, -0.28);
    const fz = H0 + 1.05;
    for (const s of [-1, 1]) {
      const f = mesh(new THREE.ExtrudeGeometry(arch, { depth: 0.44, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }), black, [s > 0 ? s * 1.06 : s * 0.62, 0.55, fz], [0, -Math.PI / 2, 0], g);
      wheel(fz, s * 0.86, 0.5, 0.28);
      // headlamp on a bar beside the grille
      const hl = new THREE.Group(); hl.position.set(s * 0.72, 1.32, H1 - 0.05); g.add(hl);
      mesh(new THREE.SphereGeometry(0.17, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), chrome, [0, 0, -0.02], [-Math.PI / 2, 0, 0], hl);
      mesh(cyl(0.165, 0.04, 22), lamp, [0, 0, 0.02], [Math.PI / 2, 0, 0], hl, false);
      mesh(new THREE.BoxGeometry(0.06, 0.06, 0.4), chrome, [-s * 0.18, -0.08, -0.2], [0, 0, 0], hl, false);
      // step / running board under the cab
      mesh(rbox(0.38, 0.06, 1.0, 0.02), black, [s * 0.92, 0.62, H0 + 0.25], [0, 0, 0], g);
    }
    mesh(rbox(2.1, 0.13, 0.12, 0.05), chrome, [0, 0.6, H1 + 0.32], [0, 0, 0], g);                   // bumper
    for (const x of [-0.75, 0.75]) mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), black, [x, 0.6, H1 + 0.17], [0, 0, 0], g, false);
    mesh(new THREE.BoxGeometry(1.7, 0.2, L1 - L0 + 1.8), black, [0, 0.55, (L0 + H1) / 2], [0, 0, 0], g);   // chassis frame
    for (const s of [-1, 1]) { const m = mesh(new THREE.BoxGeometry(0.03, 0.22, 0.3), chrome, [s * (BW / 2 + 0.16), 2.05, front - 0.05], [0, s * 0.2, 0], g, false); mesh(new THREE.BoxGeometry(0.03, 0.03, 0.18), black, [s * (BW / 2 + 0.07), 2.05, front - 0.05], [0, 0, 0], g, false); }
    stylize(g, 'hero', { outlineScale: 1.4 });
    return g;
  }

  // ---------------------------------------------------------------- the street
  const world = new THREE.Group(); scene.add(world);
  const A = new THREE.Group(), B = new THREE.Group(); world.add(A, B);
  mesh(new THREE.PlaneGeometry(400, 400), std(0xffffff, { map: grass, r: 1 }), [0, 0, 0], [-Math.PI / 2, 0, 0], A);
  mesh(new THREE.PlaneGeometry(7.2, 160), std(0xffffff, { map: asphalt, r: 0.95 }), [0, 0.012, -40], [-Math.PI / 2, 0, 0], A);
  for (let z = 30; z > -120; z -= 6) mesh(new THREE.PlaneGeometry(0.12, 2.6), std(0xd9cc9f, { r: 0.9 }), [0, 0.016, z], [-Math.PI / 2, 0, 0], A, false);
  for (const x of [-4.6, 4.6]) { mesh(new THREE.BoxGeometry(2.2, 0.12, 160), std(0xffffff, { map: concrete, r: 0.9 }), [x, 0.06, -40], [0, 0, 0], A); mesh(new THREE.BoxGeometry(0.2, 0.16, 160), std(0xb6ad9c, { r: 0.9 }), [x - Math.sign(x) * 1.15, 0.08, -40], [0, 0, 0], A); }
  // the schoolhouse, on the far side of the road
  {
    const S = new THREE.Group(); S.position.set(-17, 0, -27); S.rotation.y = Math.PI / 2; B.add(S);     // faces +X, toward the road
    const brickM = std(0xffffff, { map: brick, r: 0.88 }), stone = std(0xe4d8bd, { r: 0.85 }), win = std(0x34404a, { r: 0.2, m: 0.3 }), frame = std(0xf2ead8, { r: 0.7 });
    const wing = (x, w, h) => { mesh(new THREE.BoxGeometry(w, h, 9), brickM, [x, h / 2, 0], [0, 0, 0], S); mesh(rbox(w + 0.5, 0.5, 9.5, 0.08), stone, [x, h + 0.2, 0], [0, 0, 0], S); mesh(rbox(w + 0.3, 0.4, 9.3, 0.05), stone, [x, 0.2, 0], [0, 0, 0], S); };
    wing(-8, 12, 7.5); wing(8, 12, 7.5); wing(0, 6, 9);
    for (const side of [-8, 8]) for (const row of [0, 1]) for (let k = -2; k <= 2; k++) {
      const x = side + k * 2.3, y = 2.4 + row * 3.1;
      mesh(new THREE.BoxGeometry(1.5, 2.2, 0.1), frame, [x, y, 4.52], [0, 0, 0], S, false);
      mesh(new THREE.BoxGeometry(1.3, 2.0, 0.1), win, [x, y, 4.56], [0, 0, 0], S, false);
      mesh(new THREE.BoxGeometry(0.06, 2.0, 0.12), frame, [x, y, 4.6], [0, 0, 0], S, false); for (const dy of [-0.35, 0.35]) mesh(new THREE.BoxGeometry(1.3, 0.06, 0.12), frame, [x, y + dy, 4.6], [0, 0, 0], S, false);
      mesh(new THREE.BoxGeometry(1.7, 0.18, 0.3), stone, [x, y - 1.15, 4.6], [0, 0, 0], S, false);
    }
    // entrance: steps, columns, pediment, the words PUBLIC SCHOOL, a little bell tower
    for (let i = 0; i < 4; i++) mesh(new THREE.BoxGeometry(5.2 - i * 0.3, 0.2, 2.4 - i * 0.35), stone, [0, 0.1 + i * 0.2, 5.6 - i * 0.18], [0, 0, 0], S);
    for (const x of [-1.8, -0.6, 0.6, 1.8]) mesh(cyl(0.2, 4.2, 16, 0.18), stone, [x, 2.9, 5.4], [0, 0, 0], S);
    mesh(new THREE.BoxGeometry(4.8, 0.5, 1.6), stone, [0, 5.15, 5.2], [0, 0, 0], S);
    const ped = new THREE.Shape(); ped.moveTo(-2.6, 0); ped.lineTo(2.6, 0); ped.lineTo(0, 1.1); ped.lineTo(-2.6, 0);
    mesh(new THREE.ExtrudeGeometry(ped, { depth: 1.5, bevelEnabled: false }), stone, [0, 5.4, 4.45], [0, 0, 0], S);
    mesh(new THREE.BoxGeometry(1.5, 2.6, 0.12), std(0x5a3d2a, { r: 0.7 }), [0, 2.1, 4.52], [0, 0, 0], S);
    const words = labelTex('PUBLIC SCHOOL', { fg: '#5b4a36', w: 1024, h: 140, font: '700 100px Georgia, "DejaVu Serif", serif' });
    mesh(new THREE.PlaneGeometry(4.2, 0.55), new THREE.MeshStandardMaterial({ map: words, transparent: true, roughness: 0.8 }), [0, 7.9, 4.53], [0, 0, 0], S, false);
    mesh(rbox(1.8, 1.8, 1.8, 0.06), std(0xf0e8d6, { r: 0.8 }), [0, 10.1, 0], [0, 0, 0], S);
    mesh(cyl(1.4, 2.0, 4, 0.01), std(0x5b6b72, { r: 0.6, m: 0.3 }), [0, 11.9, 0], [0, Math.PI / 4, 0], S);
    // flagpole in front
    mesh(cyl(0.06, 10, 10, 0.04), std(0xe8e4dc, { m: 0.5, r: 0.4 }), [6, 5, 9], [0, 0, 0], S);
    const flag = canvasTex(256, 136, (g, w, h) => { for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f3efe6' : '#b23a33'; g.fillRect(0, i * h / 13, w, h / 13 + 1); } g.fillStyle = '#2f3f6b'; g.fillRect(0, 0, w * 0.4, h * 7 / 13); g.fillStyle = '#f3efe6'; for (let r = 0; r < 6; r++) for (let c = 0; c < 8; c++) { g.beginPath(); g.arc(8 + c * 12.5, 6 + r * 11.5, 2.4, 0, 7); g.fill(); } });
    const fg = new THREE.PlaneGeometry(2.4, 1.3, 16, 4); const fp = fg.attributes.position; for (let i = 0; i < fp.count; i++) { const x = fp.getX(i) + 1.2; fp.setZ(i, Math.sin(x * 2.6) * 0.12 * x / 2.4); } fg.computeVertexNormals();
    mesh(fg, new THREE.MeshStandardMaterial({ map: flag, side: THREE.DoubleSide, roughness: 0.85 }), [7.2, 9.2, 9], [0, 0, 0], S, false);
    // hedges along the front
    for (let k = -6; k <= 6; k++) if (Math.abs(k) > 1) { const h = mesh(new THREE.IcosahedronGeometry(0.9, 1), std(0x5d7340, { r: 0.95 }), [k * 1.75, 0.6, 5.4], [0, k, 0], S); h.scale.set(1.2, 0.75, 0.9); }
  }
  // trees: rounded canopies, a mix of late-summer greens and early autumn ambers
  const leafCols = [0x7d9150, 0x6c8546, 0x9aa25a, 0xc0a052, 0xb98b46, 0x86924e];
  function tree(x, z, s = 1, k = 0, parent = B) {
    const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); parent.add(t);
    mesh(cyl(0.22, 3.2, 8, 0.15), std(0x5b4636, { r: 0.95 }), [0, 1.6, 0], [0, 0, 0.04 * (k % 3 - 1)], t);
    const c = std(leafCols[k % leafCols.length], { r: 0.95 });
    for (let i = 0; i < 6; i++) { const m = mesh(new THREE.IcosahedronGeometry(1.25 + 0.4 * ((i * 7 + k) % 3) / 2, 1), c, [Math.cos(i * 1.7 + k) * 1.1, 3.6 + (i % 3) * 0.7, Math.sin(i * 1.7 + k) * 1.1], [i, k, 0], t); m.scale.y = 0.85; }
    return t;
  }
  let k = 0;
  for (let z = 22; z > -110; z -= 9) { if (z > -6 || z < -46) tree(-7.8 + (k % 2) * 0.6, z + (k % 3), 0.85 + 0.2 * ((k * 5) % 3) / 2, k); k++; if (z < -2) tree(8.8 + (k % 2) * 0.8, z - 3, 0.95 + 0.2 * (k % 2), k + 2); k++; }
  for (let i = 0; i < 26; i++) tree(-40 + (i % 7) * 7 + (i * 3 % 5), -44 - Math.floor(i / 7) * 9 + (i % 3) * 2, 1.2 + (i % 3) * 0.2, i + 4);
  for (const [x, z] of [[-31, -16], [-30, -38], [-9.5, -14], [-9.5, -41]]) tree(x, z, 1.05, Math.abs(x + z) | 0);
  // wooden telephone poles and sagging wires on the near side
  {
    const wood = std(0x6a5340, { r: 0.95 }), wire = std(0x26221f, { r: 0.6 }), poles = [];
    for (let z = 24; z > -110; z -= 16) { const p = V(6.2, 0, z); poles.push(p); mesh(cyl(0.14, 9.5, 8, 0.11), wood, [p.x, 4.75, p.z], [0, 0, 0], B); mesh(new THREE.BoxGeometry(2.0, 0.14, 0.14), wood, [p.x, 9.0, p.z], [0, 0, 0], B); for (const dx of [-0.8, -0.3, 0.3, 0.8]) mesh(cyl(0.04, 0.16, 6), std(0x6f8f86, { r: 0.4 }), [p.x + dx, 9.15, p.z], [0, 0, 0], B, false); }
    for (let i = 0; i + 1 < poles.length; i++) for (const dx of [-0.8, -0.3, 0.3, 0.8]) { const a = V(poles[i].x + dx, 9.22, poles[i].z), b = V(poles[i + 1].x + dx, 9.22, poles[i + 1].z), m = a.clone().lerp(b, 0.5); m.y -= 0.55; mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 16, 0.012, 4), wire, [0, 0, 0], [0, 0, 0], B, false); }
  }
  // sky dome and a distant tree line
  const sky = mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, toneMapped: false, fog: false }), [0, -40, 0], [0, 0, 0], world, false);
  for (let i = 0; i < 30; i++) { const m = mesh(new THREE.IcosahedronGeometry(9, 1), std(0x77815a, { r: 1 }), [-90 + i * 7, 2, -140 - (i % 4) * 8], [i, i, 0], A, false); m.scale.y = 0.55; }
  scene.fog = new THREE.Fog(0xe8d4b0, 40, 170);
  stylize(B, 'set'); stylize(A, 'architecture');

  // ---------------------------------------------------------------- the buses: four colours, no two alike
  const fleet1939Ref = [
    { paint: 0xa93a2a, trim: 0xe8dcc0, text: 'SCHOOL DIST. 7', z: 1.5 },
    { paint: 0x4c7a4a, trim: 0xe8dcc0, text: 'UNION SCHOOLS', z: -9.5, o: { L0: -3.6, nW: 5 } },
    { paint: 0x3a6496, trim: 0xe8dcc0, text: 'COUNTY SCHOOLS', z: -20.5, o: { L0: -5.2, nW: 8, Y1: 2.95 } },
    { paint: 0xe2d3ae, trim: 0x6f5a3e, text: 'TOWNSHIP SCHOOL', z: -31.5, o: { L0: -4.0, nW: 6, BW: 2.15 } }
  ].map(f => { const b = bus(f.paint, f.trim, f.text, f.o); b.position.set(-1.75, 0.02, f.z); world.add(b); return { ...f, b }; });

  const set1939 = world;

  // ================================================================= shared: modern school bus (Type C, generic)
  const BUS_YELLOW = 0xf5ad1b;                           // the yellow-orange used for every modern bus and the chosen swatch
  function modernBus({ styled = true, number = '12', district = 'UNIFIED SCHOOL DISTRICT' } = {}) {
    const g = new THREE.Group(), Y = std(BUS_YELLOW, { r: 0.32, m: 0.05 }), K = std(0x1b1a19, { r: 0.5 }), G = std(0x22303a, { r: 0.08, m: 0.5 });
    const B0 = -8.2, B1 = 0.9, BW = 2.44, Y0 = 0.95, Y1 = 3.15;
    mesh(rbox(BW, Y1 - Y0, B1 - B0, 0.2, 4), Y, [0, (Y0 + Y1) / 2, (B0 + B1) / 2], [0, 0, 0], g);
    mesh(rbox(BW - 0.5, 0.05, B1 - B0 - 0.6, 0.02), std(0xf3efe4, { r: 0.6 }), [0, Y1 + 0.005, (B0 + B1) / 2], [0, 0, 0], g);   // white roof panel
    // window band: black band, glass panes with split sashes, both sides
    const nW = 9, wz0 = B0 + 0.5, wz1 = B1 - 1.25, pitch = (wz1 - wz0) / nW;
    for (const s of [-1, 1]) {
      mesh(rbox(0.04, 0.82, wz1 - wz0 + 0.1, 0.03), K, [s * (BW / 2 + 0.002), 2.27, (wz0 + wz1) / 2], [0, 0, 0], g, false);
      for (let i = 0; i < nW; i++) { const z = wz0 + pitch * (i + 0.5); mesh(rbox(0.04, 0.7, pitch - 0.1, 0.04), G, [s * (BW / 2 + 0.012), 2.27, z], [0, 0, 0], g, false); mesh(new THREE.BoxGeometry(0.03, 0.05, pitch - 0.1), K, [s * (BW / 2 + 0.03), 2.42, z], [0, 0, 0], g, false); }
      for (const y of [1.05, 1.42, 1.78]) mesh(rbox(0.05, 0.075, B1 - B0 - 0.1, 0.02), K, [s * (BW / 2 + 0.012), y, (B0 + B1) / 2], [0, 0, 0], g);
      const lt = labelTex(district, { font: '900 96px "Inter", "Helvetica Neue", Arial', stretch: 0.88 });
      mesh(new THREE.PlaneGeometry(4.6, 0.26), new THREE.MeshStandardMaterial({ map: lt, transparent: true, roughness: 0.5, depthWrite: false }), [s * (BW / 2 + 0.014), 2.86, (B0 + B1) / 2 - 0.6], [0, s * Math.PI / 2, 0], g, false);
      const nt = labelTex(number, { w: 256, h: 160, font: '900 140px "Inter", Arial' });
      mesh(new THREE.PlaneGeometry(0.5, 0.31), new THREE.MeshStandardMaterial({ map: nt, transparent: true, roughness: 0.5, depthWrite: false }), [s * (BW / 2 + 0.014), 1.6, B1 - 1.0], [0, s * Math.PI / 2, 0], g, false);
      // rear wheel arch, dual rear wheels
      const wz = B0 + 2.2;
      for (const x of [0.92, 0.62]) { const w = new THREE.Group(); w.position.set(s * x, 0.52, wz); g.add(w); mesh(cyl(0.52, 0.3, 28), std(0x1a1918, { r: 0.92 }), [0, 0, 0], [0, 0, Math.PI / 2], w); mesh(cyl(0.3, 0.32, 20), std(0xc9ccd0, { m: 0.8, r: 0.3 }), [0, 0, 0], [0, 0, Math.PI / 2], w); }
      mesh(rbox(0.1, 0.36, 1.5, 0.05), K, [s * (BW / 2 - 0.02), 1.02, wz], [0, 0, 0], g);
    }
    // stop arm folded against the driver's side (+X), entrance doors on the right (-X)
    const oct = new THREE.Shape(); for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; i ? oct.lineTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3) : oct.moveTo(Math.cos(a) * 0.3, Math.sin(a) * 0.3); }
    const stopT = labelTex('STOP', { fg: '#ffffff', bg: '#c4271f', w: 256, h: 256, font: '900 92px "Inter", Arial' });
    const so = mesh(new THREE.ShapeGeometry(oct), new THREE.MeshStandardMaterial({ map: stopT, roughness: 0.5 }), [BW / 2 + 0.07, 2.0, B1 - 1.9], [0, Math.PI / 2, 0], g, false);
    so.geometry.attributes.uv.array.forEach((v, i, a) => { a[i] = v / 0.6 + 0.5; }); so.geometry.attributes.uv.needsUpdate = true;
    mesh(new THREE.BoxGeometry(0.05, 0.18, 0.18), K, [BW / 2 + 0.04, 2.0, B1 - 1.55], [0, 0, 0], g, false);
    for (const z of [B1 - 0.35, B1 - 0.82]) { mesh(rbox(0.04, 1.9, 0.44, 0.03), K, [-(BW / 2 + 0.01), 1.95, z], [0, 0, 0], g, false); for (const y of [1.55, 2.4]) mesh(rbox(0.04, y > 2 ? 0.75 : 0.62, 0.34, 0.02), G, [-(BW / 2 + 0.025), y, z], [0, 0, 0], g, false); }
    // front: windshield, roof cap with lights and the sign
    mesh(rbox(BW - 0.12, 0.98, 0.1, 0.06), G, [0, 2.3, B1 + 0.01], [0, 0, 0], g, false);
    mesh(new THREE.BoxGeometry(0.08, 1.0, 0.06), K, [0, 2.3, B1 + 0.06], [0, 0, 0], g, false);
    mesh(rbox(BW - 0.04, 0.36, 0.12, 0.05), Y, [0, Y1 - 0.15, B1 + 0.05], [0, 0, 0], g);
    const sign = labelTex('SCHOOL BUS', { w: 1024, h: 150, font: '900 122px "Inter", Arial', stretch: 0.94 });
    mesh(new THREE.PlaneGeometry(1.3, 0.2), new THREE.MeshStandardMaterial({ map: sign, transparent: true, roughness: 0.5, depthWrite: false }), [0, Y1 - 0.15, B1 + 0.115], [0, 0, 0], g, false);
    const amber = std(0xffb43a, { e: 0xff9a1e, ei: 0.25, r: 0.3 }), red = std(0xd8352a, { e: 0xa01810, ei: 0.25, r: 0.3 });
    for (const s of [-1, 1]) { mesh(cyl(0.085, 0.06, 18), amber, [s * 0.82, Y1 - 0.15, B1 + 0.12], [Math.PI / 2, 0, 0], g, false); mesh(cyl(0.085, 0.06, 18), red, [s * 1.05, Y1 - 0.15, B1 + 0.12], [Math.PI / 2, 0, 0], g, false); }
    g.userData.lights = { amber, red };
    // hood, grille, bumper, headlamps, fenders, crossview mirrors
    const H0 = B1, H1 = B1 + 2.05;
    const hood = new THREE.Shape(); hood.moveTo(0, 0); hood.lineTo(H1 - H0, 0); hood.lineTo(H1 - H0, 0.62); hood.quadraticCurveTo(H1 - H0 - 0.05, 0.86, H1 - H0 - 0.5, 0.9); hood.lineTo(0, 1.02); hood.lineTo(0, 0);
    mesh(new THREE.ExtrudeGeometry(hood, { depth: 1.95, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3 }), Y, [0.975, 0.92, H0], [0, -Math.PI / 2, 0], g);
    mesh(rbox(1.5, 0.6, 0.08, 0.05), K, [0, 1.24, H1 + 0.06], [0, 0, 0], g);
    for (let k = 0; k < 6; k++) mesh(new THREE.BoxGeometry(1.36, 0.035, 0.03), std(0x5a5c60, { m: 0.6, r: 0.4 }), [0, 1.02 + k * 0.088, H1 + 0.11], [0, 0, 0], g, false);
    mesh(rbox(BW + 0.04, 0.3, 0.22, 0.06), K, [0, 0.72, H1 + 0.2], [0, 0, 0], g);
    for (const s of [-1, 1]) {
      const hl = mesh(rbox(0.36, 0.24, 0.06, 0.04), std(0xfff4dc, { e: 0xffeac0, ei: 0.4, r: 0.2 }), [s * 0.83, 1.28, H1 + 0.05], [0, 0, 0], g, false); g.userData.head = (g.userData.head ?? []).concat(hl.material);
      mesh(rbox(0.36, 1.15, 1.5, 0.25), K, [s * 1.03, 1.02, H1 - 0.75], [0, 0, 0], g);
      const w = new THREE.Group(); w.position.set(s * 0.92, 0.52, H1 - 0.85); g.add(w); mesh(cyl(0.52, 0.3, 28), std(0x1a1918, { r: 0.92 }), [0, 0, 0], [0, 0, Math.PI / 2], w); mesh(cyl(0.3, 0.32, 20), std(0xc9ccd0, { m: 0.8, r: 0.3 }), [0, 0, 0], [0, 0, Math.PI / 2], w);
      mesh(cyl(0.015, 0.7, 6), K, [s * 1.15, 1.9, H1 - 0.2], [0, 0, 0], g, false); mesh(new THREE.SphereGeometry(0.12, 14, 10), K, [s * 1.15, 2.25, H1 - 0.12], [0, 0, 0], g, false);
      mesh(rbox(0.06, 0.4, 0.22, 0.03), K, [s * (BW / 2 + 0.25), 2.25, B1 + 0.1], [0, 0, 0], g, false); mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), K, [s * (BW / 2 + 0.12), 2.25, B1 + 0.1], [0, 0, 0], g, false);
    }
    // rear: emergency door and tail lamps
    mesh(rbox(0.9, 1.9, 0.05, 0.04), K, [0, 1.95, B0 - 0.005], [0, 0, 0], g, false); mesh(rbox(0.7, 0.9, 0.05, 0.03), G, [0, 2.35, B0 - 0.02], [0, 0, 0], g, false);
    for (const s of [-1, 1]) mesh(cyl(0.1, 0.05, 18), red, [s * 0.95, 1.4, B0 - 0.02], [Math.PI / 2, 0, 0], g, false);
    mesh(new THREE.BoxGeometry(2.0, 0.22, 10.6), K, [0, 0.62, (B0 + H1) / 2], [0, 0, 0], g);
    if (styled) stylize(g, 'hero', { outlineScale: 1.4 });
    g.userData.side = -BW / 2;                     // the right (door) side's X
    return g;
  }
  // many identical buses: merge each material's meshes once, then instance them (one draw per material)
  function fleet(template, transforms, parent) {
    template.updateMatrixWorld(true);
    const buckets = new Map();
    template.traverse(m => {
      if (!m.isMesh) return;
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
      if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      geo.applyMatrix4(m.matrixWorld);
      const key = m.material.uuid; if (!buckets.has(key)) buckets.set(key, { mat: m.material, geos: [], shadow: m.castShadow }); buckets.get(key).geos.push(geo);
    });
    const group = new THREE.Group(); parent.add(group); const M = new THREE.Matrix4();
    for (const { mat, geos, shadow } of buckets.values()) {
      const merged = mergeGeometries(geos, false); if (!merged) continue;
      const im = new THREE.InstancedMesh(merged, mat, transforms.length); im.castShadow = shadow; im.receiveShadow = true;
      transforms.forEach(([x, z, ry], i) => { M.makeRotationY(ry); M.setPosition(x, 0.02, z); im.setMatrixAt(i, M); });
      group.add(im);
    }
    stylize(group, 'hero', { outlineScale: 1.4 });
    return group;
  }
  // a plain sedan and a pickup for the fog shots (deliberately dull colours)
  function car(color, pickup = false) {
    const g = new THREE.Group(), P = std(color, { r: 0.45, m: 0.1 }), G = std(0x2a3640, { r: 0.1, m: 0.5 }), K = std(0x1d1c1b, { r: 0.6 });
    mesh(rbox(1.8, 0.62, 4.5, 0.22, 4), P, [0, 0.72, 0], [0, 0, 0], g);
    if (pickup) mesh(rbox(1.74, 0.62, 1.7, 0.18), P, [0, 1.3, 0.55], [0, 0, 0], g); else mesh(rbox(1.62, 0.56, 2.3, 0.28, 4), P, [0, 1.26, -0.2], [0, 0, 0], g);
    mesh(rbox(1.66, 0.42, pickup ? 1.6 : 2.2, 0.16), G, [0, pickup ? 1.32 : 1.27, pickup ? 0.55 : -0.2], [0, 0, 0], g, false);
    for (const s of [-1, 1]) { for (const z of [1.45, -1.45]) mesh(cyl(0.34, 0.24, 22), K, [s * 0.82, 0.36, z], [0, 0, Math.PI / 2], g); const hl = mesh(rbox(0.32, 0.14, 0.05, 0.03), std(0xfff3d8, { e: 0xffe6b8, ei: 0.15 }), [s * 0.6, 0.82, 2.25], [0, 0, 0], g, false); g.userData.head = (g.userData.head ?? []).concat(hl.material); mesh(rbox(0.28, 0.12, 0.05, 0.03), std(0xb02a20, { e: 0x601008, ei: 0.4 }), [s * 0.65, 0.84, -2.25], [0, 0, 0], g, false); }
    stylize(g, 'set', { outlineScale: 1.2 });
    return g;
  }
  function house(parent, x, z, ry, col, roof) {
    const h = new THREE.Group(); h.position.set(x, 0, z); h.rotation.y = ry; parent.add(h);
    mesh(new THREE.BoxGeometry(8, 3.2, 6), std(col, { r: 0.85 }), [0, 1.6, 0], [0, 0, 0], h);
    const rf = new THREE.Shape(); rf.moveTo(-4.6, 0); rf.lineTo(4.6, 0); rf.lineTo(0, 2.4); rf.lineTo(-4.6, 0);
    mesh(new THREE.ExtrudeGeometry(rf, { depth: 6.8, bevelEnabled: false }), std(roof, { r: 0.85 }), [0, 3.2, -3.4], [0, 0, 0], h);
    for (const wx of [-2.4, 2.4]) { mesh(new THREE.BoxGeometry(1.3, 1.2, 0.1), std(0xf4efe6, { r: 0.7 }), [wx, 1.8, 3.02], [0, 0, 0], h, false); mesh(new THREE.BoxGeometry(1.1, 1.0, 0.1), std(0x3c4a55, { r: 0.2, m: 0.3 }), [wx, 1.8, 3.06], [0, 0, 0], h, false); }
    mesh(new THREE.BoxGeometry(1.1, 2.1, 0.1), std(0x6b4a34, { r: 0.7 }), [0, 1.05, 3.04], [0, 0, 0], h, false);
    return h;
  }

  // ================================================================= SET: today's street with the bus stop (x = -400)
  const MOD = -400, modern = new THREE.Group(); modern.position.x = MOD; scene.add(modern);
  const modBus = modernBus(); modBus.position.set(-1.75, 0.02, 2.45); modern.add(modBus);
  {
    const A2 = new THREE.Group(), B2 = new THREE.Group(); modern.add(A2, B2);
    const grass2 = grass.clone(); grass2.needsUpdate = true;
    mesh(new THREE.PlaneGeometry(400, 400), std(0x9fb267, { map: grass, r: 1 }), [0, 0, 0], [-Math.PI / 2, 0, 0], A2);
    mesh(new THREE.PlaneGeometry(7.2, 220), std(0x7e7b78, { map: asphalt, r: 0.95 }), [0, 0.012, -60], [-Math.PI / 2, 0, 0], A2);
    for (const dx of [-0.1, 0.1]) mesh(new THREE.PlaneGeometry(0.1, 220), std(0xf2c230, { r: 0.8 }), [dx, 0.016, -60], [-Math.PI / 2, 0, 0], A2, false);
    for (const x of [-3.4, 3.4]) mesh(new THREE.PlaneGeometry(0.12, 220), std(0xf4f1ea, { r: 0.8 }), [x, 0.016, -60], [-Math.PI / 2, 0, 0], A2, false);
    for (const x of [-4.6, 4.6]) { mesh(new THREE.BoxGeometry(2.2, 0.12, 220), std(0xffffff, { map: concrete, r: 0.9 }), [x, 0.06, -60], [0, 0, 0], A2); mesh(new THREE.BoxGeometry(0.2, 0.16, 220), std(0xc8c2b6, { r: 0.9 }), [x - Math.sign(x) * 1.15, 0.08, -60], [0, 0, 0], A2); }
    // the stop: a pole with a sign, a bench
    mesh(cyl(0.04, 2.8, 10), std(0x9aa0a6, { m: 0.6, r: 0.4 }), [-5.4, 1.4, 4.6], [0, 0, 0], B2);
    const st = labelTex('BUS STOP', { fg: '#ffffff', bg: '#2c5c8f', w: 512, h: 220, font: '900 120px "Inter", Arial' });
    mesh(rbox(0.66, 0.3, 0.03, 0.02), new THREE.MeshStandardMaterial({ map: st, roughness: 0.5 }), [-5.4, 2.55, 4.62], [0, Math.PI / 2, 0], B2);
    mesh(rbox(1.8, 0.08, 0.45, 0.03), std(0x6c5236, { r: 0.8 }), [-5.25, 0.55, 7.2], [0, Math.PI / 2, 0], B2); mesh(rbox(1.8, 0.4, 0.06, 0.03), std(0x6c5236, { r: 0.8 }), [-5.45, 0.85, 7.2], [0, Math.PI / 2, 0], B2);
    for (const z of [6.5, 7.9]) mesh(new THREE.BoxGeometry(0.4, 0.5, 0.06), std(0x3a3d40, { m: 0.5, r: 0.5 }), [-5.25, 0.3, z], [0, 0, 0], B2);
    // houses and trees on both sides, lit windows off
    const cols = [[0xe9dfcc, 0x6b4f43], [0xc9d4d8, 0x4f5660], [0xe8d2b0, 0x7a4b3a], [0xdcc9b6, 0x5b5a60], [0xb7c6b0, 0x6b4f43]];
    let n = 0;
    for (let z = 22; z > -120; z -= 13) { const c = cols[n % cols.length]; house(B2, -15 - (n % 2) * 2, z, Math.PI / 2, c[0], c[1]); house(B2, 15 + (n % 3), z - 6, -Math.PI / 2, cols[(n + 2) % 5][0], cols[(n + 2) % 5][1]); n++; }
    let kk = 0;
    for (let z = 26; z > -120; z -= 8) { if (Math.abs(z - 4) > 6) tree(-8.2 + (kk % 2) * 0.5, z, 0.9 + 0.15 * (kk % 3), kk + 1, B2); tree(8.4, z - 3, 0.9 + 0.12 * (kk % 2), kk + 3, B2); kk++; }
    const sky2 = canvasTex(1024, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5f9ad0'); gr.addColorStop(0.45, '#a8cde6'); gr.addColorStop(0.52, '#f6e3c2'); gr.addColorStop(1, '#efd2a6'); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.filter = 'blur(5px)'; for (let i = 0; i < 22; i++) { const x = rnd() * w, y = 50 + rnd() * 160; g.fillStyle = `rgba(255,255,255,${0.55 + 0.3 * rnd()})`; for (let k = 0; k < 5; k++) { g.beginPath(); g.ellipse(x + k * 24 * (rnd() - 0.3), y, 36 + rnd() * 40, 12 + rnd() * 12, 0, 0, 7); g.fill(); } } g.filter = 'none'; });
    mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: sky2, side: THREE.BackSide, toneMapped: false, fog: false }), [0, -40, 0], [0, 0, 0], modern, false);
    stylize(B2, 'set'); stylize(A2, 'architecture');
  }
  // the protagonist, unchanged; a phone drawn into his hand when he is looking at it
  let phoneOn = false;
  const hero = makeFigureCard(plan.character, { canvasPx: 2048, edit(fig) { if (!phoneOn) return fig; const h = fig.joints.handF ?? fig.joints.wristF; const r = (w, hh, a) => [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([x, y]) => [h[0] + x * Math.cos(a) - y * Math.sin(a), h[1] + 40 + x * Math.sin(a) + y * Math.cos(a)]); fig.items.push({ id: 'phone', outline: true, shapes: [{ pts: r(42, 74, 0.25), closed: true, fill: '#2a2f36' }, { pts: r(32, 62, 0.25), closed: true, fill: '#6fa6c9' }] }); return fig; } });
  modern.add(hero.group);
  const STAND = { hipDrop: 0, torso: 3, head: 0, armF: [8, 14], armB: [-6, 12], legF: [3, 3], legB: [-3, 3], handF: 'open', handB: 'open', squash: 1 };
  const pending = [];
  function placeCard(...a) { pending.push(a); }
  function placeNow(card, pos, state, { mirror = 1, hipY = 0.94, outline = 7, tint = [1, 0.975, 0.94] } = {}) {
    card.group.position.set(...pos); card.group.rotation.y = Math.atan2(camera.position.x - (card.group.parent?.position.x ?? 0) - pos[0], camera.position.z - pos[2]);
    card.set({ blink: 0, gaze: [0, 0], ...state }, { hip: [0, hipY, 0], mirror, outlineMm: outline, tint: new THREE.Color(...tint) });
  }

  // ================================================================= SET: the 1939 conference room (x = 400)
  const CON = 400, room = new THREE.Group(); room.position.x = CON; scene.add(room);
  const cards = [], cups = [];
  let clockHand, roomSun, chosenCard;
  {
    const C = new THREE.Group(), D = new THREE.Group(); room.add(C, D);
    const plank = canvasTex(512, 512, (g, w, h) => { for (let i = 0; i < 8; i++) { const v = rnd(); g.fillStyle = `rgb(${120 + v * 30 | 0},${80 + v * 18 | 0},${50 + v * 12 | 0})`; g.fillRect(0, i * 64, w, 64); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, i * 64, w, 3); for (let k = 0; k < 40; k++) { g.fillStyle = `rgba(60,35,20,${0.15 * rnd()})`; g.fillRect(rnd() * w, i * 64 + rnd() * 60, 40 + rnd() * 120, 1.5); } } }, { repeat: [4, 6] });
    const wall = canvasTex(256, 256, (g, w, h) => grain(g, w, h, '#d8c9a8', 0.05, 6000, 1.6), { repeat: [4, 2] });
    mesh(new THREE.PlaneGeometry(14, 12), std(0xffffff, { map: plank, r: 0.75 }), [0, 0, 0], [-Math.PI / 2, 0, 0], C);
    mesh(new THREE.PlaneGeometry(14, 5), std(0xffffff, { map: wall, r: 0.9 }), [0, 2.5, -3.2], [0, 0, 0], C);
    mesh(new THREE.PlaneGeometry(12, 5), std(0xffffff, { map: wall, r: 0.9 }), [-5, 2.5, 0], [0, Math.PI / 2, 0], C);
    mesh(new THREE.BoxGeometry(14, 1.1, 0.06), std(0x6e4a30, { r: 0.6 }), [0, 0.55, -3.15], [0, 0, 0], C);           // wainscot
    mesh(new THREE.BoxGeometry(14, 0.08, 0.1), std(0x5a3a24, { r: 0.6 }), [0, 1.12, -3.12], [0, 0, 0], C);
    // tall windows with the sun pouring in
    for (const x of [2.75, 4.3]) { mesh(new THREE.BoxGeometry(1.2, 2.6, 0.08), std(0xf4ead2, { r: 0.6 }), [x, 2.6, -3.14], [0, 0, 0], C, false); mesh(new THREE.BoxGeometry(1.0, 2.4, 0.06), std(0xfff3d6, { e: 0xffe9bf, ei: 1.4 }), [x, 2.6, -3.1], [0, 0, 0], C, false); for (const y of [2.0, 2.8]) mesh(new THREE.BoxGeometry(1.0, 0.05, 0.08), std(0xf4ead2), [x, y, -3.06], [0, 0, 0], C, false); }
    // chalkboard
    const chalk = canvasTex(1024, 512, (g, w, h) => { g.fillStyle = '#2f3a33'; g.fillRect(0, 0, w, h); for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(255,255,255,${0.03 * rnd()})`; g.fillRect(rnd() * w, rnd() * h, 6, 1); } g.fillStyle = 'rgba(240,236,224,0.9)'; g.font = '700 58px Georgia, "DejaVu Serif", serif'; g.fillText('SCHOOL BUS STANDARDS', 60, 250); g.font = '600 44px Georgia, "DejaVu Serif", serif'; g.fillText('Height   Width   Seats   Doors', 60, 335); g.fillStyle = 'rgba(255,214,120,0.95)'; g.font = '700 60px Georgia, "DejaVu Serif", serif'; g.fillText('COLOR = ?', 60, 440); });
    mesh(new THREE.BoxGeometry(3.0, 1.5, 0.08), std(0x6e4a30, { r: 0.6 }), [0.45, 2.3, -3.12], [0, 0, 0], C);
    mesh(new THREE.PlaneGeometry(2.84, 1.36), new THREE.MeshStandardMaterial({ map: chalk, roughness: 0.95 }), [0.45, 2.3, -3.07], [0, 0, 0], C, false);
    // wall clock
    const face = canvasTex(256, 256, (g, w) => { g.fillStyle = '#f4efe2'; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.fill(); g.fillStyle = '#2a2622'; for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.fillRect(128 + Math.sin(a) * 100 - 4, 128 - Math.cos(a) * 100 - 10, 8, 20); } });
    mesh(cyl(0.3, 0.06, 32), std(0x5a3a24, { r: 0.5 }), [-2.4, 3.2, -3.1], [Math.PI / 2, 0, 0], C, false);
    mesh(new THREE.CircleGeometry(0.27, 32), new THREE.MeshStandardMaterial({ map: face, roughness: 0.6 }), [-2.4, 3.2, -3.06], [0, 0, 0], C, false);
    clockHand = new THREE.Group(); clockHand.position.set(-2.4, 3.2, -3.04); C.add(clockHand); mesh(new THREE.BoxGeometry(0.025, 0.22, 0.01), std(0x1d1a17), [0, 0.1, 0], [0, 0, 0], clockHand, false);
    // the table, chairs behind it, a name card, a lamp
    const wood = std(0xffffff, { map: plank, r: 0.55 });
    mesh(rbox(3.0, 0.07, 1.5, 0.03), wood, [0.1, 0.76, 0], [0, 0, 0], D);
    for (const x of [-1.25, 1.45]) for (const z of [-0.62, 0.62]) mesh(rbox(0.08, 0.74, 0.08, 0.02), std(0x4a2e1c, { r: 0.6 }), [x, 0.37, z], [0, 0, 0], D);
    for (const x of [-0.75, 0.15, 1.05]) { mesh(rbox(0.5, 0.06, 0.48, 0.02), std(0x5b3a24, { r: 0.6 }), [x, 0.47, -1.05], [0, 0, 0], D); mesh(rbox(0.5, 0.75, 0.06, 0.02), std(0x5b3a24, { r: 0.6 }), [x, 0.85, -1.32], [0, 0, 0], D); }
    const nt = labelTex('PROF. F. CYR', { fg: '#2a2420', bg: '#efe6d0', w: 512, h: 128, font: '700 64px Georgia, "DejaVu Serif", serif' });
    const tent = new THREE.Group(); tent.position.set(-1.0, 0.86, 0.4); D.add(tent); mesh(new THREE.BoxGeometry(0.34, 0.11, 0.004), new THREE.MeshStandardMaterial({ map: nt, roughness: 0.7 }), [0, 0, 0.02], [-0.35, 0, 0], tent, false);
    mesh(cyl(0.09, 0.03, 16), std(0x2c4a3a, { m: 0.4, r: 0.4 }), [1.45, 0.8, -0.4], [0, 0, 0], D); mesh(cyl(0.015, 0.4, 8), std(0xb88a3e, { m: 0.8, r: 0.3 }), [1.45, 1.0, -0.4], [0, 0, 0], D);
    mesh(cyl(0.18, 0.16, 18, 0.08), std(0x2c5a40, { e: 0x0, r: 0.4 }), [1.45, 1.22, -0.4], [0, 0, 0], D);
    // fifty swatches, lemon to orange-red; the chosen yellow-orange sits in the middle
    for (let i = 0; i < 50; i++) {
      const r = Math.floor(i / 10), c = i % 10, u = i / 49;
      const col = new THREE.Color().setHSL(lerp(56, 16, u) / 360, lerp(0.95, 0.85, u), lerp(0.66, 0.5, u));
      const chosen = i === 24;
      const m = mesh(rbox(0.15, 0.008, 0.21, 0.003, 2), new THREE.MeshStandardMaterial({ color: chosen ? BUS_YELLOW : col, roughness: 0.7 }), [0, 0, 0], [0, 0, 0], D);
      m.userData = { home: V(-0.75 + c * 0.19, 0.8 + r * 0.0005, -0.48 + r * 0.24), rot: (rnd() - 0.5) * 0.25, order: rnd(), chosen, dir: (rnd() - 0.5) };
      cards.push(m); if (chosen) chosenCard = m;
    }
    for (let i = 0; i < 6; i++) { const cg = new THREE.Group(); cg.position.set(-1.1 + (i % 3) * 1.1 + (i > 2 ? 0.4 : 0), 0.8, i > 2 ? -0.62 : 0.6); D.add(cg); mesh(cyl(0.045, 0.1, 14, 0.04), std(0xf2ede2, { r: 0.4 }), [0, 0.05, 0], [0, 0, 0], cg); mesh(cyl(0.04, 0.005, 14), std(0x3a2416, { r: 0.3 }), [0, 0.1, 0], [0, 0, 0], cg, false); cups.push(cg); }
    stylize(D, 'hero', { outlineScale: 0.8 }); stylize(C, 'architecture');
    roomSun = new THREE.SpotLight(0xffd9a0, 0, 20, 0.5, 0.6, 1.2); roomSun.position.set(4.5, 5, -6); roomSun.target.position.set(0.2, 0.7, 0); roomSun.castShadow = true; roomSun.shadow.mapSize.set(1024, 1024); room.add(roomSun, roomSun.target);
  }
  // the professor and three colleagues: the approved rig, redrawn with period hair, suits and (for him) glasses
  const SHORT = [[-168, -10], [-171, 70], [-152, 142], [-104, 192], [-20, 214], [62, 206], [122, 180], [160, 128], [168, 86], [140, 104], [92, 132], [30, 142], [-30, 132], [-80, 96], [-110, 40], [-124, -20], [-140, -58], [-160, -50]];
  const FRINGE = [[-168, -30], [-171, 60], [-150, 118], [-126, 104], [-134, 40], [-140, -40]];
  const person = (pal, hair, glasses = false, tie = '#7a3a2c') => makeFigureCard({ ...plan.character, palette: { ...plan.character.palette, ...pal }, forms: { ...plan.character.forms, hair: { shape: hair, smooth: 2, sample: [-120, 60] } } }, { canvasPx: 1536, edit(fig, def, state) {
    const J = fig.joints, p = state.pose, rad = Math.PI / 180, hip = J.hip;
    const T = q => { const a = -p.torso * rad; return [hip[0] + q[0] * Math.cos(a) - q[1] * Math.sin(a), hip[1] + q[0] * Math.sin(a) + q[1] * Math.cos(a)]; };
    const at = fig.items.findIndex(it => it.id === 'collar');
    fig.items.splice(at, 0, { id: 'tie', outline: true, shapes: [{ pts: [[26, 528], [44, 528], [48, 470], [42, 300], [35, 270], [28, 300], [22, 470]].map(T), closed: true, fill: tie }] });
    if (glasses) { const hc = J.headCenter, a = -(p.torso + p.head) * rad, R = (x, y) => [hc[0] + x * Math.cos(a) - y * Math.sin(a), hc[1] + x * Math.sin(a) + y * Math.cos(a)]; const ring = (cx, cy, r) => Array.from({ length: 24 }, (_, i) => R(cx + Math.cos(i / 24 * 6.283) * r, cy + Math.sin(i / 24 * 6.283) * r)); fig.items.push({ id: 'glasses', outline: false, shapes: [{ pts: ring(26, 42, 36), closed: true, stroke: '#2a2420', width: 9 }, { pts: ring(118, 42, 36), closed: true, stroke: '#2a2420', width: 9 }, { pts: [R(62, 48), R(82, 48)], closed: false, stroke: '#2a2420', width: 8 }, { pts: [R(-10, 46), R(-80, 52)], closed: false, stroke: '#2a2420', width: 8 }] }); }
    return fig;
  } });
  const cyr = person({ shirt: '#6a5d50', apron: '#f3efe6', trousers: '#5a5148', boots: '#3a2e26', hair: '#8f8a84' }, SHORT, true);
  const experts = [
    person({ shirt: '#3f4a5c', apron: '#ece6d8', trousers: '#3a4150', boots: '#2a2420', hair: '#3b2a20', skin: '#E8B998' }, SHORT, false, '#2e3f5a'),
    person({ shirt: '#7a6a52', apron: '#f1ebdf', trousers: '#5d5244', boots: '#2a2420', hair: '#cfc8bd', skin: '#F2C8A6' }, FRINGE, true, '#5a3a2a'),
    person({ shirt: '#4b5a4a', apron: '#ece6d8', trousers: '#40483f', boots: '#2a2420', hair: '#2a201a', skin: '#C98E66' }, SHORT, false, '#6a5a2a')
  ];
  for (const p of [cyr, ...experts]) room.add(p.group);
  const SEAT = { hipDrop: 0, torso: 6, head: 2, legF: [80, 70], legB: [86, 74], armF: [62, 70], armB: [70, 64], handF: 'open', handB: 'open', squash: 1 };

  // ================================================================= SET: the fog road (x = 800)
  const FOG = 800, fogSet = new THREE.Group(); fogSet.position.x = FOG; scene.add(fogSet);
  const fogBus = modernBus({ number: '7' }); fogSet.add(fogBus);
  const greyCar = car(0x7f8388), brownTruck = car(0x6b5b4b, true); fogSet.add(greyCar, brownTruck);
  {
    const A3 = new THREE.Group(), B3 = new THREE.Group(); fogSet.add(A3, B3);
    mesh(new THREE.PlaneGeometry(400, 400), std(0x8a9065, { map: grass, r: 1 }), [0, 0, 0], [-Math.PI / 2, 0, 0], A3);
    mesh(new THREE.PlaneGeometry(7.2, 300), std(0x77746f, { map: asphalt, r: 0.95 }), [0, 0.012, -80], [-Math.PI / 2, 0, 0], A3);
    for (const dx of [-0.1, 0.1]) mesh(new THREE.PlaneGeometry(0.1, 300), std(0xe2b52c, { r: 0.8 }), [dx, 0.016, -80], [-Math.PI / 2, 0, 0], A3, false);
    for (const x of [-3.4, 3.4]) mesh(new THREE.PlaneGeometry(0.12, 300), std(0xeeebe2, { r: 0.8 }), [x, 0.016, -80], [-Math.PI / 2, 0, 0], A3, false);
    const post = std(0x6a5644, { r: 0.95 });
    for (let z = 30; z > -150; z -= 4) { mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), post, [6.2, 0.55, z], [0, 0, 0], B3); mesh(new THREE.BoxGeometry(0.05, 0.08, 4), post, [6.2, 0.9, z - 2], [0, 0, 0], B3); }
    for (let z = 20; z > -150; z -= 22) { mesh(cyl(0.14, 9, 8, 0.11), std(0x5c4a3a, { r: 0.95 }), [-6.5, 4.5, z], [0, 0, 0], B3); mesh(new THREE.BoxGeometry(2, 0.14, 0.14), std(0x5c4a3a), [-6.5, 8.6, z], [0, 0, 0], B3); }
    for (let i = 0; i < 16; i++) { const t = tree((i % 2 ? 1 : -1) * (10 + (i * 7) % 9), 10 - i * 11, 1.1, i, B3); t.children.forEach((c, k) => { if (k) c.material = std(0x4f5a44, { r: 1 }); }); }
    stylize(B3, 'set'); stylize(A3, 'architecture');
  }

  // ================================================================= SET: the depot at sunrise (x = 1200)
  const LOT = 1200, lot = new THREE.Group(); lot.position.x = LOT; scene.add(lot);
  let paintCan, canLid;
  {
    const A4 = new THREE.Group(), B4 = new THREE.Group(); lot.add(A4, B4);
    mesh(new THREE.PlaneGeometry(400, 400), std(0x8f9a5c, { map: grass, r: 1 }), [0, 0, 0], [-Math.PI / 2, 0, 0], A4);
    mesh(new THREE.PlaneGeometry(64, 70), std(0x6f6c69, { map: asphalt, r: 0.95 }), [0, 0.012, -20], [-Math.PI / 2, 0, 0], A4);
    const slots = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 9; i++) slots.push([-16 + i * 4.0, -2 - row * 15, 0]);
    for (const [x, z] of slots) for (const dx of [-2, 2]) mesh(new THREE.PlaneGeometry(0.12, 12), std(0xf2efe6, { r: 0.8 }), [x + dx, 0.016, z - 3], [-Math.PI / 2, 0, 0], A4, false);
    fleet(modernBus({ styled: false }), slots, lot);
    // the school behind: long, low, modern brick
    mesh(new THREE.BoxGeometry(70, 6, 12), std(0xffffff, { map: brick, r: 0.9 }), [0, 3, -64], [0, 0, 0], B4);
    for (let i = 0; i < 20; i++) mesh(new THREE.BoxGeometry(2.2, 1.6, 0.1), std(0x3c4a55, { r: 0.2, m: 0.3 }), [-32 + i * 3.4, 3.4, -57.95], [0, 0, 0], B4, false);
    mesh(new THREE.BoxGeometry(71, 0.6, 12.6), std(0xd8d0c0, { r: 0.8 }), [0, 6.2, -64], [0, 0, 0], B4);
    for (let i = 0; i < 18; i++) tree(-44 + i * 5.3, -76 + (i % 3) * 2, 1.4 + (i % 2) * 0.3, i + 7, B4);
    for (let i = 0; i < 8; i++) tree((i % 2 ? 1 : -1) * (26 + (i % 3) * 3), 6 - i * 9, 1.2, i + 2, B4);
    // the paint can in front of the first bus
    paintCan = new THREE.Group(); paintCan.position.set(-12.2, 0, 6.2); lot.add(paintCan);
    const label = canvasTex(1024, 512, (g, w, h) => { g.fillStyle = '#f2ead6'; g.fillRect(0, 0, w, h); g.fillStyle = '#1e2a44'; g.fillRect(0, 0, w, 70); g.fillRect(0, h - 70, w, 70); g.fillStyle = '#f5ad1b'; g.fillRect(70, 150, 230, 230); g.strokeStyle = '#1e2a44'; g.lineWidth = 6; g.strokeRect(70, 150, 230, 230); g.fillStyle = '#1e2a44'; g.font = '900 64px "Inter", Arial'; g.fillText('NATIONAL', 350, 205); g.fillText('SCHOOL BUS', 350, 280); g.fillText('GLOSSY YELLOW', 350, 355); g.font = '700 30px "Inter", Arial'; g.fillStyle = '#f2ead6'; g.fillText('ENAMEL  ·  ONE GALLON', 340, 48); });
    label.wrapS = THREE.RepeatWrapping; label.repeat.set(2, 1); label.offset.x = 0.3;
    mesh(cyl(0.3, 0.6, 40), [new THREE.MeshStandardMaterial({ map: label, roughness: 0.45 }), std(0xc9ccd0, { m: 0.8, r: 0.3 }), std(0xc9ccd0, { m: 0.8, r: 0.3 })], [0, 0.3, 0], [0, 0, 0], paintCan);
    for (const y of [0.02, 0.58]) mesh(new THREE.TorusGeometry(0.3, 0.012, 8, 40), std(0xc9ccd0, { m: 0.8, r: 0.3 }), [0, y, 0], [Math.PI / 2, 0, 0], paintCan, false);
    mesh(cyl(0.28, 0.01, 40), std(BUS_YELLOW, { r: 0.12, m: 0.05 }), [0, 0.6, 0], [0, 0, 0], paintCan, false);
    canLid = new THREE.Group(); canLid.position.set(0, 0.61, 0); paintCan.add(canLid); mesh(cyl(0.305, 0.03, 40), std(0xbfc3c8, { m: 0.85, r: 0.28 }), [0, 0, 0], [0, 0, 0], canLid);
    mesh(new THREE.TorusGeometry(0.3, 0.008, 6, 30, Math.PI), std(0x9a9ea4, { m: 0.8, r: 0.3 }), [0, 0.6, 0], [0, 0, 0], paintCan, false);
    stylize(paintCan, 'hero', { outlineScale: 0.6 }); stylize(B4, 'set'); stylize(A4, 'architecture');
  }
  const skyDawn = canvasTex(1024, 512, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#4f6f9c'); gr.addColorStop(0.35, '#c99a88'); gr.addColorStop(0.5, '#ffcf8a'); gr.addColorStop(1, '#f2b46f'); g.fillStyle = gr; g.fillRect(0, 0, w, h); const s = g.createRadialGradient(w * 0.3, h * 0.5, 4, w * 0.3, h * 0.5, 140); s.addColorStop(0, 'rgba(255,248,220,1)'); s.addColorStop(1, 'rgba(255,220,150,0)'); g.fillStyle = s; g.fillRect(0, 0, w, h); });
  mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.MeshBasicMaterial({ map: skyDawn, side: THREE.BackSide, toneMapped: false, fog: false }), [0, -30, 0], [0, 0, 0], lot, false);

  // ================================================================= lights, looks, helpers
  const hemi = new THREE.HemisphereLight(0xbfd2e0, 0x6a5a3c, 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd8a0, 3.4); sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowMap * 2, quality.shadowMap * 2); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x9fb4d0, 0.7); scene.add(fill, fill.target);
  function light(ox, { from = [-34, 26, 22], at = [-2, 0, -14], k = 3.4, kc = 0xffd8a0, h = 1.1, hs = 0xbfd2e0, hg = 0x6a5a3c, f = 0.7, size = 34 } = {}) {
    sun.position.set(ox + from[0], from[1], from[2]); sun.target.position.set(ox + at[0], at[1], at[2]); sun.intensity = k; sun.color.set(kc);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 1; sc.far = 140; sc.updateProjectionMatrix();
    hemi.intensity = h; hemi.color.set(hs); hemi.groundColor.set(hg); fill.intensity = f; fill.position.set(ox + 30, 12, 30); fill.target.position.set(ox, 0, 0);
  }
  const cam = (o, p, l, fov, shake = 0, t = 0) => { camera.fov = fov; camera.position.set(o + p[0] + shake * Math.sin(t * 83), p[1] + shake * Math.sin(t * 107 + 1), p[2]); camera.lookAt(o + l[0], l[1], l[2]); };
  const mix = (a, b, u) => a.map((v, i) => lerp(v, b[i], u));
  const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a)), sseg = (t, a, b) => smooth(seg(t, a, b)), eout = x => 1 - (1 - x) ** 3, back = x => { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
  const pop = (t, a, d = 0.3) => t < a ? 0 : back(clamp((t - a) / d));
  const norm = w => w.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
  const W = (a, edge = 'start') => { const [txt, n] = a.split('#'), hits = plan.words.filter(w => norm(w.text) === norm(txt)), w = hits[(Number(n) || 1) - 1]; if (!w) throw new Error(`word ${a}`); return w[edge]; };
  const blinkAt = t => { const p = (t + 0.3) % 2.9; return p < 0.12 ? Math.sin(p / 0.12 * Math.PI) : 0; };
  // a soft blurred, darkened periphery (what you see "out of the corner of your eye")
  const periphery = amount => (g, Wd, Hd) => {
    if (amount <= 0.01) return;
    g.save(); g.beginPath(); g.rect(0, 0, Wd, Hd); g.ellipse(Wd * 0.5, Hd * 0.5, Wd * lerp(0.9, 0.33, amount), Hd * lerp(0.9, 0.3, amount), 0, 0, Math.PI * 2, true); g.clip('evenodd');
    g.filter = `blur(${Math.round(16 * amount * Wd / 1080)}px)`; g.drawImage(g.canvas, 0, 0); g.filter = 'none';
    g.fillStyle = `rgba(20,16,12,${0.28 * amount})`; g.fillRect(0, 0, Wd, Hd); g.restore();
  };
  const both = (...fx) => ({ filter: fx.find(f => f.filter)?.filter, paint: (g, a, b) => fx.forEach(f => f.paint?.(g, a, b)), fade: Math.max(...fx.map(f => f.fade ?? 0)), fadeColor: fx.find(f => f.fadeColor)?.fadeColor });
  const bg = new THREE.Color(); scene.background = bg;
  const SETS = { modern, set1939, room, fogSet, lot };
  function show(name) { for (const [k, g] of Object.entries(SETS)) g.visible = k === name; }

  // period look: a warm, slightly faded print with soft vignette and a few specks of dust (amount 0..1)
  const specks = Array.from({ length: 22 }, () => [rnd(), rnd(), 0.6 + rnd() * 1.8, rnd()]);
  const vintage = (amount, frame) => amount <= 0.002 ? {} : ({
    filter: `sepia(${0.16 * amount}) saturate(${1 - 0.04 * amount}) contrast(${1 + 0.04 * amount})`,
    paint(g, W, H) {
      const v = g.createRadialGradient(W / 2, H * 0.48, H * 0.25, W / 2, H * 0.5, H * 0.72); v.addColorStop(0, 'rgba(40,24,10,0)'); v.addColorStop(1, `rgba(40,24,10,${0.34 * amount})`); g.fillStyle = v; g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(255,236,200,${0.05 * amount})`; g.fillRect(0, 0, W, H);
      for (const [x, y, r, a] of specks) if ((Math.floor(frame / 2) + Math.round(a * 9)) % 7 === 0) { g.fillStyle = `rgba(30,20,10,${0.35 * amount})`; g.beginPath(); g.arc(x * W, y * H, r * W / 1080, 0, 7); g.fill(); }
    }
  });
  // ================================================================= the shots
  // the bus pulling up at the stop: rolls in and settles with a little nose dip
  function busArrive(T, tStop, from = 20) { const u = seg(T, tStop - 2.2, tStop); modBus.position.z = 2.45 - from * (1 - eout(u)); modBus.rotation.x = u >= 1 ? 0.012 * Math.exp(-(T - tStop) * 6) * Math.sin((T - tStop) * 18) : 0; }
  function heroAt(state, o = {}) { placeCard(hero, [-4.35, 0.12, o.z ?? 4.1], { ...state }, { mirror: o.mirror ?? 1, hipY: 0.94 }); }
  const shots = {
    hook(t, T, d) {
      show('modern'); light(MOD, { from: [-30, 22, 26], at: [-2, 0, 0] }); scene.fog = new THREE.Fog(0xe9d9bc, 60, 220); bg.set('#e9d9bc');
      busArrive(T, 1.15, 16); phoneOn = false;
      heroAt({ pose: { ...STAND, head: -6 }, face: 'curious', gaze: [0.6, 0.5], blink: blinkAt(T) }, { mirror: 1, z: 7.4 });
      const u = sseg(t, 0.2, d);
      cam(MOD, mix([-6.4, 0.45, 14.2], [-5.2, 0.7, 11.2], u), mix([-2.0, 2.7, 3.6], [-1.75, 3.0, 3.4], u), lerp(42, 30, u));
      return {};
    },
    always(t, T, d) {
      show('modern'); light(MOD, { from: [-30, 22, 26], at: [-2, 0, 0] }); scene.fog = new THREE.Fog(0xe9d9bc, 60, 220); bg.set('#e9d9bc');
      modBus.position.z = 2.45; modBus.rotation.x = 0; phoneOn = false;
      const v = sseg(t, 0.35, d - 0.1);
      heroAt({ pose: { ...STAND, head: -8 + 4 * v }, face: v > 0.5 ? 'thinking' : 'curious', gaze: [0.7, 0.45], blink: blinkAt(T + 0.7) }, { mirror: 1, z: 7.4 });
      cam(MOD, mix([-7.4, 1.6, 12.6], [-7.1, 1.62, 12.0], smooth(seg(t, 0, d))), [-3.2, 1.7, 5.4], 32);
      return both(vintage(v, Math.floor(T * 30)), { fade: Math.max(0, 1 - Math.abs(t - d) / 0.12) * 0.85, fadeColor: '255,244,220' });
    },
    'flashback-1939'(t, T, d) {
      show('set1939'); light(0, {}); scene.fog = new THREE.Fog(0xe8d4b0, 40, 170); bg.set('#e8d4b0');
      const u = clamp(t / Math.max(0.5, d));
      for (const f of fleet1939) f.b.position.z = f.z + 3.2 * u;
      camera.fov = 32; camera.position.set(lerp(4.4, 4.1, smooth(u)), 2.55, lerp(24.0, 23.3, smooth(u))); camera.lookAt(-3.0, 2.85, -8);
      return both(vintage(1, Math.floor(T * 30)), { fade: Math.max(0, 1 - t / 0.18) * 0.85, fadeColor: '255,244,220' });
    },
    standard(t, T, d) {
      show('set1939'); light(0, {}); scene.fog = new THREE.Fog(0xe8d4b0, 50, 190); bg.set('#e8d4b0');
      for (const f of fleet1939) f.b.position.z = f.z + 3.2 + 1.6 * t;
      const u = sseg(t, 0, d);
      cam(0, mix([7.5, 13, 9], [7.0, 12, 7.6], u), [-1.75, 0.8, -12.5], 40);
      return vintage(1, Math.floor(T * 30));
    },
    conference(t, T, d) {
      show('room'); light(CON, { from: [8, 9, 6], at: [0, 0.8, -1], k: 1.6, kc: 0xffd9a8, h: 1.25, hs: 0xf2e2c4, hg: 0x6a4a30, f: 0.5, size: 6 }); scene.fog = null; bg.set('#3a2a1e');
      roomSun.intensity = 16; resetCards(); cups.forEach(c => (c.visible = false)); clockHand.rotation.z = -0.6;
      const g = W('gathered') - 0.2, gesture = sseg(T, W('settle') - 0.3, W('settle') + 0.2) * (1 - sseg(T, W('color', 'end'), W('color', 'end') + 0.4));
      placeCard(cyr, [-1.45, 0, -0.1], { pose: { ...STAND, torso: 2, armF: [lerp(14, 52, gesture), lerp(30, 40, gesture)], handF: 'open', armB: [-6, 18] }, face: T < g ? 'speaking' : gesture > 0.4 ? 'determined' : 'speaking', blink: blinkAt(T) }, { mirror: 1 });
      experts.forEach((p, i) => placeCard(p, [-0.75 + i * 0.9, 0, -1.02], { pose: { ...SEAT, head: 2 + 3 * Math.sin(T * 1.3 + i) }, face: ['thinking', 'curious', 'concerned'][i], gaze: [-0.4, 0.05], blink: blinkAt(T + i) }, { mirror: -1, hipY: 0.5 }));
      const u = sseg(T, g, W('country', 'end') + 0.1), pre = sseg(t, 0, g - (T - t));
      cam(CON, mix(mix([-1.3, 1.6, 3.6], [-1.25, 1.58, 3.2], pre), [0.0, 2.0, 7.6], u), mix([-1.45, 1.42, -0.2], [-0.25, 1.35, -0.6], u), lerp(30, 42, u));
      return vintage(1, Math.floor(T * 30));
    },
    fifty(t, T, d) {
      show('room'); light(CON, { from: [8, 9, 6], at: [0, 0.8, -1], k: 1.6, kc: 0xffd9a8, h: 1.25, hs: 0xf2e2c4, hg: 0x6a4a30, f: 0.5, size: 6 }); scene.fog = null; bg.set('#3a2a1e');
      roomSun.intensity = 16; cups.forEach(c => (c.visible = false)); clockHand.rotation.z = -0.6;
      const a = W('brought') - 0.05, b = W('shades') + 0.2;
      cards.forEach((m, i) => { const s = pop(T, a + (i / 49) * (b - a), 0.22), h = m.userData.home; m.visible = s > 0.001; m.position.set(h.x, h.y + 0.25 * (1 - eout(clamp((T - a - (i / 49) * (b - a)) / 0.22))), h.z); m.rotation.set(0, m.userData.rot, 0); m.scale.setScalar(Math.max(0.001, s)); });
      seatExperts(T, 'curious');
      const u = sseg(t, 0, d);
      cam(CON, mix([0.15, 2.75, 2.25], [0.12, 2.55, 1.95], u), [0.12, 0.78, -0.12], 40);
      return vintage(1, Math.floor(T * 30));
    },
    debate(t, T, d) {
      show('room'); scene.fog = null; bg.set('#3a2a1e');
      // days pass: the light swings from morning to night and back, three times, while the clock spins and cups pile up
      const one = W('one#2') - 0.1, days = clamp((T - W('After')) / Math.max(0.5, one - 0.4 - W('After'))), ph = days * 3;
      const lightness = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
      light(CON, { from: [8, 9, 6], at: [0, 0.8, -1], k: lerp(0.4, 1.6, lightness), kc: 0xffd9a8, h: lerp(0.55, 1.25, lightness), hs: 0xf2e2c4, hg: 0x6a4a30, f: 0.5, size: 6 });
      roomSun.intensity = 16 * lightness; clockHand.rotation.z = -0.6 - days * 3 * Math.PI * 4;
      cups.forEach((c, i) => { c.visible = days > 0.12 + i * 0.13; c.scale.setScalar(Math.max(0.001, pop(days * 3, (0.12 + i * 0.13) * 3, 0.3))); });
      const sorted = [...cards].sort((x, y) => x.userData.order - y.userData.order);
      sorted.filter(m => !m.userData.chosen).forEach((m, k) => {
        const at = 0.08 + 0.82 * k / 49, u = clamp((days - at) / 0.08), h = m.userData.home;
        m.visible = u < 1; m.position.set(h.x + m.userData.dir * 0.9 * eout(u), h.y + 0.35 * Math.sin(u * Math.PI), h.z + 0.9 * eout(u)); m.rotation.set(0.6 * u, m.userData.rot + 2 * u * m.userData.dir, 0); m.scale.setScalar(Math.max(0.001, 1 - u));
      });
      // the last one lifts and turns to camera
      const lift = sseg(T, one - 0.15, d + 0.05), h = chosenCard.userData.home, camP = V(CON + 0.12, 2.55, 1.95);
      const target = V(CON + 0.12, 1.75, 1.15);
      chosenCard.visible = true; chosenCard.position.set(lerp(h.x, target.x - CON, lift), lerp(h.y, target.y, lift), lerp(h.z, target.z, lift));
      chosenCard.rotation.set(lerp(0, Math.PI / 2 - 0.62, lift), lerp(chosenCard.userData.rot, 0, lift), 0); chosenCard.scale.setScalar(1 + 0.3 * lift); chosenCard.material.emissive.set(BUS_YELLOW); chosenCard.material.emissiveIntensity = 0.12 * lift;
      seatExperts(T, days > 0.85 ? 'happy' : ['concerned', 'determined', 'thinking'][Math.floor(days * 9) % 3]);
      cam(CON, mix([0.12, 2.55, 1.95], [0.12, 2.25, 1.75], sseg(T, one - 0.2, d)), mix([0.12, 0.78, -0.12], [0.12, 1.55, 0.6], sseg(T, one - 0.2, d)), 40);
      return vintage(1, Math.floor(T * 30));
    },
    why(t, T, d) {
      show('modern'); light(MOD, { from: [-30, 22, 26], at: [-2, 0, 0] }); scene.fog = new THREE.Fog(0xe9d9bc, 60, 220); bg.set('#e9d9bc');
      modBus.position.z = 2.45; modBus.rotation.x = 0; phoneOn = false;
      // the chosen card held flat against the bus side, then the camera pulls back to the whole bus
      chosenCard.visible = false;
      swatch.visible = true; swatch.position.set(-2.985, 1.6, -1.8); swatch.rotation.set(0, -Math.PI / 2, 0.06);
      heroAt({ pose: { ...STAND, head: -4 }, face: 'curious', gaze: [0.5, 0.3], blink: blinkAt(T + 0.4) }, { mirror: 1, z: -3.6 });
      const u = sseg(t, 0.15, d);
      cam(MOD, mix([-3.6, 1.62, -1.75], [-13.5, 2.1, 4.2], eout(u)), mix([-2.985, 1.6, -1.8], [-2.6, 1.7, -2.4], u), lerp(30, 38, u));
      return {};
    },
    eyes(t, T, d) {
      show('modern'); light(MOD, { from: [-30, 22, 26], at: [-2, 0, 0] }); scene.fog = new THREE.Fog(0xe9d9bc, 60, 220); bg.set('#e9d9bc');
      swatch.visible = false; phoneOn = true;
      // the bus comes up the road behind his shoulder, at the edge of the frame; he looks up on "corner"
      const look = sseg(T, W('corner') - 0.15, W('corner') + 0.25), arr = W('even') + 0.9;
      busArrive(T, arr + 1.4, 34);
      heroAt({ pose: { ...STAND, armF: [lerp(40, 20, look), lerp(102, 60, look)], handF: 'fist', head: lerp(14, -6, look), torso: 3 }, face: look > 0.5 ? 'surprised' : 'neutral', gaze: [lerp(0, -0.9, look), lerp(-0.7, 0.1, look)], blink: look > 0.1 ? 0 : blinkAt(T) }, { mirror: -1, z: 6.4 });
      if (look < 0.5) { /* phone drawn by edit */ } else phoneOn = look < 0.95;
      cam(MOD, mix([-8.6, 1.75, 9.6], [-8.2, 1.75, 9.2], sseg(t, 0, d)), [-4.0, 1.5, 6.4], 30);
      const per = sseg(t, 0.25, 0.9) * (1 - sseg(T, W('corner') + 0.3, W('corner') + 0.9) * 0.6);
      return { paint: periphery(per) };
    },
    orange(t, T, d) {
      show('fogSet'); light(FOG, { from: [-20, 18, 30], at: [0, 0, -10], k: 0.9, kc: 0xd8dde4, h: 1.0, hs: 0xc4ccd4, hg: 0x5c5a52, f: 0.3 }); scene.fog = new THREE.FogExp2(0xaeb6bc, 0.03); bg.set('#aeb6bc');
      // a grey car, a brown truck, then the bus, all heading toward camera in the far lane
      const v = 6.5;
      greyCar.position.set(1.75, 0, 6 - v * t); greyCar.rotation.y = Math.PI; brownTruck.position.set(1.75, 0, -14 - v * t); brownTruck.rotation.y = Math.PI;
      fogBus.position.set(-1.75, 0.02, -40 + 5.2 * t); fogBus.rotation.y = 0;
      for (const c of [greyCar, brownTruck]) (c.userData.head ?? []).forEach(m => (m.emissiveIntensity = 0.4));
      fogBus.userData.head.forEach(m => (m.emissiveIntensity = 1.2)); flash(fogBus, T); glowAt(fogBus, 0.5);
      cam(FOG, [4.3, 1.5, 14], [-0.9, 1.8, -8], 32);
      return {};
    },
    foggy(t, T, d) {
      show('fogSet'); light(FOG, { from: [-20, 18, 30], at: [0, 0, -10], k: 0.25, kc: 0xa8b4c8, h: 0.5, hs: 0x8090a8, hg: 0x2c2c30, f: 0.15 }); scene.fog = new THREE.FogExp2(0x5d6878, 0.055); bg.set('#5d6878');
      greyCar.position.set(40, 0, 0); brownTruck.position.set(40, 0, 0);
      fogBus.position.set(-1.75, 0.02, -30 + 8.2 * t); fogBus.userData.head.forEach(m => (m.emissiveIntensity = 3)); flash(fogBus, T); glowAt(fogBus, 1);
      cam(FOG, [2.9, 1.2, 10], [-1.2, 1.9, -4], 34);
      return {};
    },
    glossy(t, T, d) {
      show('lot'); light(LOT, { from: [-40, 10, 18], at: [-10, 0, 0], k: 2.6, kc: 0xffc584, h: 0.9, hs: 0xb8c4d8, hg: 0x5a4632, f: 0.4, size: 30 }); scene.fog = new THREE.Fog(0xf0c896, 60, 200); bg.set('#f0c896');
      const p = W('known') - 0.05, lid = eout(seg(T, p, p + 0.35));
      canLid.position.set(lid * 0.35, 0.61 + 0.5 * Math.sin(lid * Math.PI) * (1 - 0.4 * lid), lid * 0.12); canLid.rotation.set(0, 0, -lid * 1.1);
      const u = sseg(t, 0, d);
      cam(LOT, mix([-12.0, 1.1, 8.6], [-12.05, 1.25, 7.9], u), mix([-12.2, 0.75, 6.0], [-12.2, 0.6, 6.1], u), lerp(36, 32, u));
      return {};
    },
    still(t, T, d) {
      show('lot'); light(LOT, { from: [-40, 10, 18], at: [-10, 0, 0], k: 2.6, kc: 0xffc584, h: 0.9, hs: 0xb8c4d8, hg: 0x5a4632, f: 0.4, size: 40 }); scene.fog = new THREE.Fog(0xf0c896, 70, 220); bg.set('#f0c896');
      canLid.position.set(0.35, 0.61, 0.12); canLid.rotation.set(0, 0, -1.1);
      const u = smooth(seg(t, 0, d - 0.3));
      cam(LOT, mix([-12.0, 1.3, 7.8], [12, 24, 24], u), mix([-12.2, 0.7, 6.0], [-1, 0, -16], u), lerp(32, 46, u));
      return { fade: sseg(t, d - 0.5, d - 0.05) };
    }
  };
  // the chosen swatch, outside the room, for the match against today's bus
  const swatch = mesh(rbox(0.3, 0.21, 0.01, 0.004, 2), new THREE.MeshStandardMaterial({ color: BUS_YELLOW, roughness: 0.32, metalness: 0.05 }), [0, 0, 0], [0, 0, 0], modern, false);
  addOutlineHull(swatch);
  function addOutlineHull(m) { ctx.addOutline?.(m, 0.006, ctx.style.palette.outline); }
  function resetCards() { cards.forEach(m => { const h = m.userData.home; m.visible = true; if (m.material.emissive) m.material.emissiveIntensity = 0; m.position.copy(h); m.rotation.set(0, m.userData.rot, 0); m.scale.setScalar(1); }); }
  function seatExperts(T, face) {
    placeCard(cyr, [-1.45, 0, -0.1], { pose: { ...STAND, torso: 6, head: 8, armF: [30, 50], armB: [-6, 18] }, face: 'thinking', gaze: [0.3, -0.4], blink: blinkAt(T) }, { mirror: 1 });
    experts.forEach((p, i) => placeCard(p, [-0.75 + i * 0.9, 0, -1.02], { pose: { ...SEAT, torso: 14, head: 10 + 3 * Math.sin(T * 1.7 + i) }, face, gaze: [-0.2, -0.6], blink: blinkAt(T + i * 0.7) }, { mirror: -1, hipY: 0.5 }));
  }
  // soft headlamp halos in fog (additive sprites, part of the fog set only)
  const haloTex = canvasTex(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,240,205,1)'); r.addColorStop(0.25, 'rgba(255,225,170,0.45)'); r.addColorStop(1, 'rgba(255,215,150,0)'); g.fillStyle = r; g.fillRect(0, 0, 128, 128); });
  const halos = [-0.83, 0.83].map(x => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })); sp.position.set(x, 1.28, 3.25); fogBus.add(sp); return sp; });
  function glowAt(b, k) { const dz = Math.max(4, (camera.position.z - b.position.z)); halos.forEach(h => { h.scale.setScalar(1.6 + dz * 0.05); h.material.opacity = k * clamp(1.4 - dz / 40); }); }
  function flash(b, T) { const on = Math.floor(T * 2.4) % 2; b.userData.lights.amber.emissiveIntensity = on ? 2.4 : 0.15; }
  const fleet1939 = fleet1939Ref;

  return {
    update({ frame, time, shot, t, d }) {
      camera.up.set(0, 1, 0); pending.length = 0;
      for (const c of [hero, cyr, ...experts]) c.group.visible = false;
      const fx = shots[shot.id](t, time, d) ?? {};
      camera.updateMatrixWorld();
      for (const a of pending) { a[0].group.visible = true; placeNow(...a); }
      return fx;
    }
  };
}
