/*
 * Why are school buses yellow? Hand-directed scene (tools/episode/render.mjs).
 * Look development so far: the 1939 flashback only. A tree-lined road past a brick schoolhouse; four 1930s
 * conventional-cab school buses in four different colours roll toward camera in the right-hand lane.
 * Buses face +Z (toward camera). Everything is built here: no downloaded models or textures.
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);

export async function build(ctx) {
  const { THREE, scene, camera, stylize, quality } = ctx;
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
  function bus(paint, trim, sideText) {
    const g = new THREE.Group(), P = std(paint, { r: 0.42, m: 0.05 }), T = std(trim, { r: 0.5 });
    const L0 = -4.6, L1 = 1.6, BW = 2.3, Y0 = 0.82, Y1 = 2.85;          // body box (z from L0 to L1)
    mesh(rbox(BW, Y1 - Y0, L1 - L0, 0.26, 4), P, [0, (Y0 + Y1) / 2, (L0 + L1) / 2], [0, 0, 0], g);
    mesh(rbox(BW + 0.04, 0.12, L1 - L0 + 0.02, 0.05), black, [0, Y0 + 0.02, (L0 + L1) / 2], [0, 0, 0], g);   // skirt rail
    mesh(rbox(BW - 0.3, 0.06, L1 - L0 - 0.4, 0.03), T, [0, Y1 + 0.02, (L0 + L1) / 2], [0, 0, 0], g);            // roof ridge
    // window band: glass panes with paint-coloured posts, both sides; belt rail and drip rail in trim
    const nW = 7, wy0 = 1.88, wy1 = 2.5, span = (L1 - 0.45) - (L0 + 0.35), pitch = span / nW;
    for (const s of [-1, 1]) {
      for (let i = 0; i < nW; i++) { const z = L0 + 0.35 + pitch * (i + 0.5); mesh(rbox(0.04, wy1 - wy0, pitch - 0.14, 0.04), glass, [s * (BW / 2 + 0.005), (wy0 + wy1) / 2, z], [0, 0, 0], g, false); mesh(new THREE.BoxGeometry(0.03, 0.04, pitch - 0.16), chrome, [s * (BW / 2 + 0.02), (wy0 + wy1) / 2 + 0.02, z], [0, 0, 0], g, false); }
      for (const [y, h] of [[1.78, 0.07], [2.6, 0.05], [1.18, 0.05]]) mesh(rbox(0.05, h, L1 - L0 - 0.2, 0.02), T, [s * (BW / 2 + 0.01), y, (L0 + L1) / 2], [0, 0, 0], g);
      const lt = labelTex(sideText, { fg: '#1d1a17', font: '900 104px "Inter", "Helvetica Neue", Arial', stretch: 0.9 });
      mesh(new THREE.PlaneGeometry(3.6, 0.38), new THREE.MeshStandardMaterial({ map: lt, transparent: true, roughness: 0.6, depthWrite: false }), [s * (BW / 2 + 0.012), 1.48, (L0 + L1) / 2 - 0.3], [0, s * Math.PI / 2, 0], g, false);
    }
    // rear wheel arches and dual rear wheels
    const wheel = (z, x, r = 0.52, w = 0.3) => { const wg = new THREE.Group(); wg.position.set(x, r, z); g.add(wg); mesh(cyl(r, w, 28), tyre, [0, 0, 0], [0, 0, Math.PI / 2], wg); mesh(cyl(r * 0.55, w + 0.02, 24), std(0x2a2826, { r: 0.6 }), [0, 0, 0], [0, 0, Math.PI / 2], wg); mesh(cyl(r * 0.32, w + 0.05, 20), chrome, [0, 0, 0], [0, 0, Math.PI / 2], wg); return wg; };
    for (const s of [-1, 1]) { wheel(-3.0, s * 0.92); wheel(-3.0, s * 0.6); mesh(rbox(0.12, 0.42, 1.3, 0.05), black, [s * (BW / 2 - 0.02), 0.97, -3.0], [0, 0, 0], g); }
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
  function tree(x, z, s = 1, k = 0) {
    const t = new THREE.Group(); t.position.set(x, 0, z); t.scale.setScalar(s); B.add(t);
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
  const fleet = [
    { paint: 0xa93a2a, trim: 0xe8dcc0, text: 'SCHOOL DIST. 7', z: 1.5 },
    { paint: 0x4c7a4a, trim: 0xe8dcc0, text: 'UNION SCHOOLS', z: -9.5 },
    { paint: 0x3a6496, trim: 0xe8dcc0, text: 'COUNTY SCHOOLS', z: -20.5 },
    { paint: 0xe2d3ae, trim: 0x6f5a3e, text: 'TOWNSHIP SCHOOL', z: -31.5 }
  ].map(f => { const b = bus(f.paint, f.trim, f.text); b.position.set(-1.75, 0.02, f.z); world.add(b); return { ...f, b }; });

  // ---------------------------------------------------------------- light: warm late-afternoon sun from camera-left
  const hemi = new THREE.HemisphereLight(0xbfd2e0, 0x6a5a3c, 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd8a0, 3.4); sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowMap * 2, quality.shadowMap * 2); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
  sun.position.set(-34, 26, 22); sun.target.position.set(-2, 0, -14); scene.add(sun, sun.target);
  const sc = sun.shadow.camera; sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 120; sc.updateProjectionMatrix();
  const fill = new THREE.DirectionalLight(0x9fb4d0, 0.7); fill.position.set(30, 12, 30); scene.add(fill);
  scene.background = new THREE.Color('#e8d4b0');

  // period look: a warm, slightly faded print with soft vignette and a few specks of dust
  const specks = Array.from({ length: 22 }, () => [rnd(), rnd(), 0.6 + rnd() * 1.8, rnd()]);
  const vintage = (amount, frame) => ({
    filter: `sepia(${0.16 * amount}) saturate(${1 - 0.04 * amount}) contrast(${1 + 0.04 * amount})`,
    paint(g, W, H) {
      const v = g.createRadialGradient(W / 2, H * 0.48, H * 0.25, W / 2, H * 0.5, H * 0.72); v.addColorStop(0, 'rgba(40,24,10,0)'); v.addColorStop(1, `rgba(40,24,10,${0.34 * amount})`); g.fillStyle = v; g.fillRect(0, 0, W, H);
      g.fillStyle = `rgba(255,236,200,${0.05 * amount})`; g.fillRect(0, 0, W, H);
      for (const [x, y, r, a] of specks) if ((Math.floor(frame / 2) + Math.round(a * 9)) % 7 === 0) { g.fillStyle = `rgba(30,20,10,${0.35 * amount})`; g.beginPath(); g.arc(x * W, y * H, r * W / 1080, 0, 7); g.fill(); }
    }
  });

  return {
    update({ frame, shot, t, d }) {
      // the buses roll toward camera, the lead one nearest; camera drifts with them
      const u = clamp(t / Math.max(0.5, d));
      for (const f of fleet) { f.b.position.z = f.z + 3.2 * u; f.b.children.forEach(() => {}); }
      camera.fov = 36;
      camera.position.set(lerp(4.4, 4.1, smooth(u)), 2.55, lerp(24.0, 23.3, smooth(u)));
      camera.lookAt(-3.0, 2.85, -8);
      return vintage(1, frame);
    }
  };
}
