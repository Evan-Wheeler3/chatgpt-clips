/*
 * Seatbelt locking: the hand-directed scene (see tools/episode/render.mjs).
 * Three sets share one scene, far apart: the car interior, the crash-test sled, the retractor cutaway.
 * Convention: the car faces -X (screen left), the camera sits on the driver's-door side (+Z), so the shoulder belt
 * comes off the B-pillar in the foreground and crosses in front of the 2D driver.
 * Everything is a pure function of time; action is keyed to measured narration words through W().
 */
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a));
const smooth = x => x * x * (3 - 2 * x);
const sseg = (t, a, b) => smooth(seg(t, a, b));
const easeOut = x => 1 - (1 - x) ** 3;
const easeIn = x => x * x * x;
const backOut = x => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const pulse = (t, a, b, e = 0.12) => Math.min(sseg(t, a, a + e), 1 - sseg(t, b - e, b));
const damped = (t, hz = 9, decay = 9) => t < 0 ? 0 : Math.exp(-t * decay) * Math.sin(t * hz * Math.PI * 2);
const mixA = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const LAB_X = 60, RET_X = 120;

export async function build(ctx) {
  const { THREE, scene, camera, plan, makeFigureCard, solveArm, stylize, W: FW, H: FH } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // soft studio reflections so metal and leather are not flat (no downloaded HDRI)
  scene.environment = new THREE.PMREMGenerator(ctx.renderer).fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.28;
  // ---------------------------------------------------------------- timing from measured words
  const norm = w => w.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
  function W(anchor, edge = 'start') {
    const [text, nth] = anchor.split('#'), hits = plan.words.filter(w => norm(w.text) === norm(text));
    const w = hits[(Number(nth) || 1) - 1]; if (!w) throw new Error(`word "${anchor}" not in narration`);
    return w[edge];
  }
  const S = Object.fromEntries(plan.shots.map(s => [s.id, s]));

  // ---------------------------------------------------------------- textures (drawn, never downloaded)
  function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
    t.anisotropy = 8; return t;
  }
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const grain = (g, w, h, base, amt, n = 9000, size = 1.6) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < n; i++) { const v = rnd(); g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${amt * rnd()})`; g.fillRect(rnd() * w, rnd() * h, size * (0.5 + rnd()), size * (0.5 + rnd())); } };
  const leatherTex = (base, stitch) => canvasTex(512, 512, (g, w, h) => {
    grain(g, w, h, base, 0.07, 16000, 2.2);
    for (let i = 0; i < 260; i++) { g.strokeStyle = `rgba(0,0,0,${0.03 + 0.04 * rnd()})`; g.lineWidth = 0.8; g.beginPath(); const x = rnd() * w, y = rnd() * h; g.moveTo(x, y); g.quadraticCurveTo(x + 14 * (rnd() - 0.5), y + 14 * (rnd() - 0.5), x + 26 * (rnd() - 0.5), y + 26 * (rnd() - 0.5)); g.stroke(); }
    if (stitch) { g.strokeStyle = stitch; g.lineWidth = 3; g.setLineDash([9, 7]); for (const x of [w * 0.2, w * 0.8]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); } g.setLineDash([]); g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 5; for (const y of [h * 0.25, h * 0.5, h * 0.75]) { g.beginPath(); g.moveTo(w * 0.2, y); g.lineTo(w * 0.8, y); g.stroke(); } }
  });
  const plasticTex = base => canvasTex(256, 256, (g, w, h) => grain(g, w, h, base, 0.06, 9000, 1.3), { repeat: [3, 3] });
  const carpetTex = canvasTex(256, 256, (g, w, h) => grain(g, w, h, '#2f2a27', 0.16, 14000, 1.6), { repeat: [6, 6] });
  const webTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = '#565a63'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 8) { g.strokeStyle = (x / 8 + y / 8) % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.22)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + ((x / 8) % 2 ? 8 : 0)); g.lineTo(x + 8, y + ((x / 8) % 2 ? 0 : 8)); g.stroke(); }
    g.fillStyle = '#34363d'; g.fillRect(0, 0, 5, h); g.fillRect(w - 5, 0, 5, h); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(8, 0, 2, h); g.fillRect(w - 10, 0, 2, h);
  });
  webTex.wrapS = webTex.wrapT = THREE.RepeatWrapping;
  const metalTex = base => canvasTex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.strokeStyle = `rgba(${rnd() > 0.5 ? '255,255,255' : '0,0,0'},${0.05 * rnd()})`; g.lineWidth = 1; const y = rnd() * h; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + 3 * (rnd() - 0.5)); g.stroke(); } }, { repeat: [1, 1] });
  const concreteTex = canvasTex(1024, 512, (g, w, h) => {
    grain(g, w, h, '#a9a59d', 0.08, 30000, 2.4);
    for (let i = 0; i < 30; i++) { const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${rnd() > 0.5 ? '255,250,240' : '40,36,32'},0.07)`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.strokeStyle = 'rgba(40,36,32,0.35)'; g.lineWidth = 3; for (const x of [0, w / 2]) { g.beginPath(); g.moveTo(x + 2, 0); g.lineTo(x + 2, h); g.stroke(); } g.beginPath(); g.moveTo(0, 2); g.lineTo(w, 2); g.stroke();
  }, { repeat: [5, 3] });
  const hazardTex = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#e9b23a'; g.fillRect(0, 0, w, h); g.fillStyle = '#1e1c1a'; for (let x = -h; x < w + h; x += 64) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + h, 0); g.lineTo(x + h + 32, 0); g.lineTo(x + 32, h); g.fill(); } }, { repeat: [10, 1] });

  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: o.r ?? 0.82, metalness: o.m ?? 0, map: o.map ?? null, emissive: o.e ?? 0x000000, emissiveIntensity: o.ei ?? 1, transparent: !!o.opacity, opacity: o.opacity ?? 1, side: o.side ?? THREE.FrontSide });
  const mesh = (geo, mat, p = [0, 0, 0], r = [0, 0, 0], parent = null, shadow = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.set(...r); m.castShadow = shadow; m.receiveShadow = true; parent?.add(m); return m; };
  const rbox = (w, h, d, r = 0.03, s = 4) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const cyl = (r, h, n = 24, r2 = r) => new THREE.CylinderGeometry(r2, r, h, n);

  // ---------------------------------------------------------------- shared pieces
  function buildSeat(leather, piping, o = {}) {
    const g = new THREE.Group(), L = std(0xffffff, { map: leather, r: 0.62 }), P = std(piping, { r: 0.7 }), D = std(0x2a2826, { r: 0.6, m: 0.2 });
    mesh(rbox(0.6, 0.16, 0.56, 0.07), L, [-0.1, 0.33, 0], [0, 0, 0], g);                               // cushion
    for (const z of [-0.27, 0.27]) mesh(new THREE.CapsuleGeometry(0.055, 0.46, 6, 12), P, [-0.1, 0.36, z], [0, 0, Math.PI / 2], g);
    const back = new THREE.Group(); back.position.set(0.2, 0.36, 0); back.rotation.z = -0.26; g.add(back);
    mesh(rbox(0.15, 0.78, 0.54, 0.07), L, [0.03, 0.39, 0], [0, 0, 0], back);
    mesh(rbox(0.05, 0.6, 0.34, 0.02), std(0xffffff, { map: leather, r: 0.7, e: 0x1a0f08 }), [-0.06, 0.4, 0], [0, 0, 0], back);
    for (const z of [-0.27, 0.27]) mesh(new THREE.CapsuleGeometry(0.06, 0.6, 6, 12), P, [-0.01, 0.4, z], [0, 0, 0], back);
    for (const z of [-0.08, 0.08]) mesh(cyl(0.012, 0.16, 8), std(0xb8bcc4, { m: 0.9, r: 0.35 }), [0.03, 0.84, z], [0, 0, 0], back);
    mesh(rbox(0.14, 0.24, 0.3, 0.06), L, [0.02, 1.0, 0], [0, 0, 0.12], back);                          // headrest
    mesh(rbox(0.5, 0.1, 0.46, 0.03), D, [-0.08, 0.2, 0], [0, 0, 0], g);                                // base
    if (!o.noRails) for (const z of [-0.2, 0.2]) mesh(new THREE.BoxGeometry(0.72, 0.03, 0.04), D, [-0.08, 0.145, z], [0, 0, 0], g);
    return g;
  }
  function buildWheel(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.z = 0.36; parent.add(g);        // wheel plane normal along local X
    const rim = std(0x2b2724, { r: 0.55 }), spoke = std(0x3a3532, { r: 0.5 });
    mesh(new THREE.TorusGeometry(0.19, 0.024, 12, 40), rim, [0, 0, 0], [0, Math.PI / 2, 0], g);
    mesh(rbox(0.05, 0.11, 0.13, 0.03), spoke, [0.01, 0, 0], [0, 0, 0], g);
    for (const a of [0, 2.1, -2.1]) { const s = mesh(rbox(0.022, 0.18, 0.045, 0.01), spoke, [0, 0, 0], [a + Math.PI / 2, 0, 0], g); s.translateY(0.1); }
    mesh(cyl(0.035, 0.34, 12), std(0x2a2826, { r: 0.6 }), [-0.17, 0, 0], [0, 0, Math.PI / 2], g);     // column
    return g;
  }
  // A flat band of webbing along a path, facing the camera (+Z). update(points) rebuilds it; `feed` scrolls the weave
  function makeRibbon(parent, width = 0.05, N = 36) {
    const geo = new THREE.BufferGeometry(), pos = new Float32Array((N + 1) * 6), uv = new Float32Array((N + 1) * 4), idx = [];
    for (let i = 0; i < N; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(idx);
    const tex = webTex.clone(); tex.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
    const edgeGeo = geo.clone(), edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0x14100d, side: THREE.DoubleSide }));
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.frustumCulled = edge.frustumCulled = false; parent.add(edge, m);
    const Z = V(0, 0, 1), T = V(0, 0, 0), Wd = V(0, 0, 0), last = V(0, 1, 0);
    return { mesh: m, edge, update(points, { feed = 0, sag = 0, w = width, inkPx = 0.008 } = {}) {
      const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5), len = curve.getLength(), ep = edgeGeo.attributes.position.array;
      for (let i = 0; i <= N; i++) {
        const u = i / N, p = curve.getPoint(u); curve.getTangent(u, T);
        p.y -= sag * Math.sin(u * Math.PI);
        Wd.crossVectors(T, Z); if (Wd.lengthSq() < 0.02) Wd.copy(last); else { Wd.normalize(); last.copy(Wd); }
        for (const [k, s] of [[0, -1], [1, 1]]) {
          pos.set([p.x + Wd.x * w / 2 * s, p.y + Wd.y * w / 2 * s, p.z], (i * 2 + k) * 3);
          ep.set([p.x + Wd.x * (w / 2 + inkPx) * s, p.y + Wd.y * (w / 2 + inkPx) * s, p.z - 0.004], (i * 2 + k) * 3);
          uv.set([k, (u * len + feed) / 0.1], (i * 2 + k) * 2);
        }
      }
      geo.attributes.position.needsUpdate = geo.attributes.uv.needsUpdate = edgeGeo.attributes.position.needsUpdate = true; geo.computeVertexNormals();
      return len;
    } };
  }
  function buildDRing(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    mesh(rbox(0.075, 0.1, 0.03, 0.012), std(0x3a3532, { r: 0.6 }), [0, 0.03, -0.012], [0, 0, 0], g);
    mesh(new THREE.TorusGeometry(0.034, 0.008, 8, 20), std(0xc9ccd2, { m: 0.9, r: 0.3 }), [0, -0.03, 0.006], [0, 0, 0], g).scale.set(1.15, 0.7, 1);
    mesh(cyl(0.014, 0.012, 12), std(0xb8bcc4, { m: 0.9, r: 0.35 }), [0, 0.04, 0.008], [Math.PI / 2, 0, 0], g);
    return g;
  }
  function buildTongue(parent) {
    const g = new THREE.Group(); parent.add(g);
    mesh(rbox(0.05, 0.05, 0.016, 0.008), std(0x2a2826, { r: 0.6 }), [0, 0.012, 0], [0, 0, 0], g);
    mesh(rbox(0.032, 0.05, 0.005, 0.002), std(0xd0d3d8, { m: 0.95, r: 0.28 }), [0, -0.035, 0], [0, 0, 0], g);
    return g;
  }
  function buildBuckle(parent, x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
    mesh(rbox(0.03, 0.2, 0.02, 0.008), std(0x2a2826, { r: 0.7 }), [0.01, -0.12, 0], [0, 0, 0.12], g);
    mesh(rbox(0.058, 0.085, 0.036, 0.012), std(0x2a2826, { r: 0.55 }), [0, 0, 0], [0, 0, 0], g);
    mesh(rbox(0.036, 0.022, 0.03, 0.006), std(0xd8482f, { r: 0.5, e: 0x4a1208 }), [0, 0.034, 0.006], [0, 0, 0], g);
    return g;
  }

  // ================================================================= SET 1: the car (cutaway on the driver's-door side)
  const car = new THREE.Group(); scene.add(car);
  const leather = leatherTex('#b0703f', 'rgba(244,226,196,0.85)'), trim = plasticTex('#7a6c60'), dashTex = plasticTex('#5d544d');
  const FLOOR = 0.2;
  {
    const A = new THREE.Group(), B = new THREE.Group(); car.add(A, B);          // A: architecture (no outline), B: set dressing
    mesh(new THREE.BoxGeometry(4.2, 0.2, 2.4), std(0xffffff, { map: carpetTex, r: 1 }), [-0.2, FLOOR - 0.1, -0.45], [0, 0, 0], A);
    const seatD = buildSeat(leather, 0x7a4a28); B.add(seatD);
    const seatP = buildSeat(leather, 0x7a4a28); seatP.position.z = -0.86; B.add(seatP);
    const rear = mesh(rbox(0.5, 1.05, 1.5, 0.1), std(0xffffff, { map: leather, r: 0.7 }), [1.25, 0.72, -0.45], [0, 0, -0.2], B);
    // centre console and gear lever (far side of the driver, behind the card)
    mesh(rbox(1.0, 0.3, 0.26, 0.05), std(0xffffff, { map: dashTex, r: 0.6 }), [-0.42, 0.34, -0.43], [0, 0, 0], B);
    mesh(rbox(0.36, 0.08, 0.24, 0.035), std(0xffffff, { map: leather, r: 0.65 }), [0.02, 0.53, -0.43], [0, 0, 0], B);
    mesh(cyl(0.012, 0.14, 8), std(0xb8bcc4, { m: 0.9, r: 0.3 }), [-0.5, 0.55, -0.43], [0, 0, 0.25], B);
    mesh(new THREE.SphereGeometry(0.03, 14, 10), std(0x2a2826, { r: 0.4 }), [-0.52, 0.63, -0.43], [0, 0, 0], B);
    // dashboard, binnacle, screen, vents
    const dash = std(0xffffff, { map: dashTex, r: 0.62 });
    mesh(rbox(0.5, 0.5, 2.3, 0.1), dash, [-1.05, 0.82, -0.45], [0, 0, 0.1], B);
    mesh(rbox(0.62, 0.08, 2.34, 0.035), std(0x2c2725, { r: 0.75 }), [-1.05, 1.08, -0.45], [0, 0, 0.06], B);
    mesh(rbox(0.26, 0.15, 0.44, 0.05), std(0x2c2725, { r: 0.7 }), [-0.85, 1.14, 0], [0, 0, 0.1], B);
    mesh(rbox(0.02, 0.09, 0.3, 0.008), std(0x10151c, { r: 0.3, e: 0x7fb6d8, ei: 0.55 }), [-0.74, 1.13, 0], [0, 0, 0.1], B, false);
    mesh(rbox(0.03, 0.24, 0.38, 0.01), std(0x10151c, { r: 0.25, e: 0x3c6f93, ei: 0.5 }), [-0.83, 0.98, -0.45], [0, 0, 0.18], B, false);
    for (const z of [-0.2, -0.7, -1.2]) mesh(rbox(0.03, 0.06, 0.16, 0.008), std(0x1c1a19, { r: 0.5 }), [-0.82, 1.02, z + (z === -0.2 ? 0.03 : 0)], [0, 0, 0.14], B);
    mesh(rbox(0.3, 0.26, 2.3, 0.06), std(0x2c2725, { r: 0.8 }), [-0.95, 0.42, -0.45], [0, 0, 0], B);       // lower dash / footwell
    buildWheel(B, -0.6, 1.0, 0);
    for (const [x, y] of [[-0.74, 0.3], [-0.78, 0.33]]) mesh(rbox(0.03, 0.12, 0.06, 0.01), std(0x1c1a19, { r: 0.5, m: 0.4 }), [x, y, x === -0.74 ? 0.06 : -0.08], [0, 0, 0.5], B);
    // far (passenger) door: panel, armrest, window, pillars; this is what the camera sees past him
    const DZ = -1.5, door = std(0xffffff, { map: trim, r: 0.7 });
    mesh(rbox(1.75, 0.8, 0.1, 0.04), door, [-0.25, 0.62, DZ], [0, 0, 0], B);
    mesh(rbox(0.8, 0.07, 0.12, 0.03), std(0xffffff, { map: leather, r: 0.65 }), [-0.2, 0.78, DZ + 0.09], [0, 0, 0], B);
    mesh(cyl(0.11, 0.02, 24), std(0x26221f, { r: 0.9 }), [-0.75, 0.45, DZ + 0.055], [Math.PI / 2, 0, 0], B);
    mesh(rbox(0.16, 0.035, 0.03, 0.012), std(0xc9ccd2, { m: 0.9, r: 0.3 }), [-0.35, 0.92, DZ + 0.07], [0, 0, 0], B);
    mesh(rbox(1.8, 0.05, 0.12, 0.02), std(0x2c2725, { r: 0.6 }), [-0.25, 1.04, DZ], [0, 0, 0], B);         // sill
    mesh(rbox(1.6, 0.8, 0.1, 0.04), door, [1.55, 0.62, DZ], [0, 0, 0], B);                                 // rear door
    const pillar = std(0xd9cfbd, { r: 0.85 });
    mesh(rbox(0.14, 1.75, 0.12, 0.04), pillar, [0.68, 1.05, DZ], [0, 0, 0], B);                            // far B-pillar
    mesh(rbox(0.12, 1.1, 0.12, 0.04), pillar, [-1.02, 1.5, DZ], [0, 0, 0.62], B);                          // far A-pillar
    mesh(rbox(3.6, 0.1, 0.14, 0.04), pillar, [0.4, 1.9, DZ], [0, 0, 0], B);                                // roof rail
    mesh(new THREE.BoxGeometry(4.6, 1.2, 2.6), std(0xe3dac8, { r: 0.95, e: 0x6b6253, ei: 0.5 }), [0.3, 2.56, -0.75], [0, 0, 0], A);   // roof and headliner
    mesh(rbox(0.03, 0.07, 0.2, 0.012), std(0x2a2826, { r: 0.4 }), [-0.62, 1.72, -0.45], [0, 0, 0.2], B);   // mirror
    const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe6f2, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false });
    mesh(new THREE.PlaneGeometry(1.75, 0.84), glass, [-0.25, 1.46, DZ], [0, 0, 0], A, false);
    mesh(new THREE.PlaneGeometry(1.5, 0.84), glass, [1.5, 1.46, DZ], [0, 0, 0], A, false);
    // near (driver's) B-pillar in the foreground: the belt's home. Cut short above the D-ring so the frame stays open
    mesh(rbox(0.13, 1.42, 0.1, 0.04), pillar, [0.5, 0.86, 0.52], [0, 0, 0], B);
    mesh(rbox(0.16, 0.22, 0.13, 0.03), std(0x3a3532, { r: 0.6 }), [0.5, 0.3, 0.52], [0, 0, 0], B);         // retractor cover at the base
    // outside: a soft painted backdrop (parking lot at golden hour), far beyond the far windows and the windscreen
    const sky = canvasTex(1024, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#8fc0e6'); gr.addColorStop(0.5, '#f6d9b0'); gr.addColorStop(0.62, '#f2c58f'); gr.addColorStop(0.63, '#8a8f7a'); gr.addColorStop(1, '#6f6a62'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.filter = 'blur(6px)';
      for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(255,250,240,${0.35 + 0.3 * rnd()})`; g.beginPath(); g.ellipse(rnd() * w, 40 + rnd() * 150, 60 + rnd() * 90, 14 + rnd() * 16, 0, 0, 7); g.fill(); }
      for (let i = 0; i < 16; i++) { const x = rnd() * w, bw = 50 + rnd() * 110, bh = 40 + rnd() * 120; g.fillStyle = ['#c9b79f', '#b9a58f', '#d6c6ad', '#a89684'][i % 4]; g.fillRect(x, h * 0.63 - bh, bw, bh); g.fillStyle = 'rgba(255,240,210,0.5)'; for (let k = 0; k < 6; k++) g.fillRect(x + 8 + (k % 3) * (bw / 3.4), h * 0.63 - bh + 10 + Math.floor(k / 3) * 26, bw / 6, 12); }
      for (let i = 0; i < 26; i++) { g.fillStyle = ['#5f7f4f', '#6d8c57', '#4f6f47'][i % 3]; g.beginPath(); g.ellipse(rnd() * w, h * 0.61 + rnd() * 8, 26 + rnd() * 30, 22 + rnd() * 20, 0, 0, 7); g.fill(); }
      for (let i = 0; i < 7; i++) { const x = rnd() * w; g.fillStyle = ['#8fa3b8', '#c9a27a', '#d9d4c8', '#7d8f85'][i % 4]; g.beginPath(); g.roundRect(x, h * 0.66, 120, 30, 12); g.fill(); g.beginPath(); g.roundRect(x + 24, h * 0.62, 70, 26, 12); g.fill(); }
      g.filter = 'none';
    });
    const back = mesh(new THREE.PlaneGeometry(34, 17), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false, fog: false }), [-2, 2.2, -13], [0, 0, 0], A, false);
    const front = mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: sky, toneMapped: false }), [-12, 2.2, -3], [0, Math.PI / 2, 0], A, false);
    stylize(B, 'set'); stylize(A, 'architecture');
    for (const m of [back, front]) { m.material.onBeforeCompile = () => {}; m.material.color.set(0xffffff); m.material.needsUpdate = true; }
  }
  const carDRing = buildDRing(car, 0.5, 1.26, 0.585), carTongue = buildTongue(car), carBuckle = buildBuckle(car, -0.2, 0.57, -0.2);
  stylize(carDRing, 'hero'); stylize(carTongue, 'hero', { outlineScale: 0.5 }); stylize(carBuckle, 'hero', { outlineScale: 0.6 });
  const carBeltA = makeRibbon(car), carBeltB = makeRibbon(car);
  const hero = makeFigureCard(plan.character, { canvasPx: 3072 }); car.add(hero.group);

  // ================================================================= SET 2: the crash-test sled
  const lab = new THREE.Group(); lab.position.x = LAB_X; scene.add(lab);
  const sled = new THREE.Group(); lab.add(sled);
  let labWallMat;
  {
    const A = new THREE.Group(), B = new THREE.Group(); lab.add(A, B);
    mesh(new THREE.PlaneGeometry(30, 12), std(0xffffff, { map: concreteTex, r: 0.9 }), [0, 0, -1], [-Math.PI / 2, 0, 0], A);
    for (const z of [0.95, -1.35]) mesh(new THREE.PlaneGeometry(30, 0.16), std(0xffffff, { map: hazardTex, r: 0.8 }), [0, 0.004, z], [-Math.PI / 2, 0, 0], A, false);
    for (const z of [-0.5, 0.1]) mesh(new THREE.BoxGeometry(30, 0.06, 0.07), std(0xffffff, { map: metalTex('#7d858e'), m: 0.8, r: 0.4 }), [0, 0.03, z], [0, 0, 0], B);
    const wall = canvasTex(2048, 512, (g, w, h) => {
      grain(g, w, h, '#d9d5cc', 0.04, 26000, 2.2);
      g.fillStyle = '#c4bfb4'; for (let x = 0; x < w; x += 256) g.fillRect(x, 0, 4, h);
      g.fillStyle = '#9aa3ad'; g.fillRect(0, h * 0.8, w, 46);
      for (let i = 0; i < 8; i++) { const x = 140 + i * 256, y = 392; for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) { g.fillStyle = (a + b) % 2 ? '#1e1c1a' : '#e9b23a'; g.fillRect(x + a * 22 - 22, y + b * 22 - 22, 22, 22); } }
    }, { repeat: [1, 1] });
    labWallMat = new THREE.MeshStandardMaterial({ map: wall, roughness: 0.95 });
    mesh(new THREE.PlaneGeometry(30, 7.5), labWallMat, [0, 3.75, -3.2], [0, 0, 0], A);
    for (const x of [-9, -3, 3, 9]) mesh(rbox(1.6, 0.08, 0.3, 0.03), std(0xfff3d6, { e: 0xffe2a8, ei: 2.2 }), [x, 4.2, -2.6], [0, 0, 0], B, false);
    // the barrier the sled runs into (screen left)
    const barrier = new THREE.Group(); barrier.position.set(-2.3, 0, -0.2); B.add(barrier);
    mesh(rbox(0.7, 1.5, 1.7, 0.06), std(0x6d747c, { r: 0.7, m: 0.3 }), [-0.4, 0.75, 0], [0, 0, 0], barrier);
    mesh(rbox(0.16, 0.7, 1.5, 0.06), std(0xe9b23a, { r: 0.7 }), [0.02, 0.5, 0], [0, 0, 0], barrier);
    mesh(rbox(0.5, 0.5, 0.5, 0.05), std(0x545a61, { r: 0.7, m: 0.3 }), [-0.75, 0.25, 0.4], [0, 0, 0.5], barrier);
    stylize(B, 'set'); stylize(A, 'architecture');
    // the sled: platform, seat, B-post with guide loop and retractor, wheel on a stub
    const steel = std(0xffffff, { map: metalTex('#8a929b'), m: 0.75, r: 0.42 }), dark = std(0x34373c, { r: 0.6, m: 0.3 });
    mesh(rbox(2.2, 0.12, 1.25, 0.03), std(0x4a4f56, { r: 0.6, m: 0.4 }), [-0.2, FLOOR - 0.06, -0.2], [0, 0, 0], sled);
    mesh(new THREE.PlaneGeometry(2.2, 0.1), std(0xffffff, { map: hazardTex, r: 0.8 }), [-0.2, FLOOR - 0.06, 0.428], [0, 0, 0], sled, false);
    for (const x of [-1.0, 0.6]) for (const z of [-0.5, 0.1]) mesh(rbox(0.22, 0.1, 0.12, 0.02), dark, [x, 0.09, z], [0, 0, 0], sled);
    sled.add(buildSeat(leatherTex('#6f7680', 'rgba(230,232,236,0.7)'), 0x4c525a, { noRails: true }));
    mesh(rbox(0.08, 1.2, 0.08, 0.015), steel, [0.5, FLOOR + 0.6, 0.5], [0, 0, 0], sled);                 // B-post
    mesh(rbox(0.06, 0.06, 0.9, 0.01), steel, [0.5, FLOOR + 0.03, 0.1], [0, 0, 0], sled);
    mesh(rbox(0.5, 0.08, 0.08, 0.015), steel, [0.28, FLOOR + 0.5, 0.5], [0, 0, -0.9], sled);
    mesh(rbox(0.1, 0.7, 0.1, 0.02), steel, [-0.98, FLOOR + 0.35, 0], [0, 0, 0], sled);                    // wheel stub
    mesh(rbox(0.3, 0.3, 0.5, 0.06), std(0x2c2f34, { r: 0.75 }), [-0.98, FLOOR + 0.82, 0], [0, 0, 0.1], sled);
    buildWheel(sled, -0.66, 1.0, 0);
    stylize(sled, 'hero');
  }
  // the retractor on the post: a housing whose reel visibly turns as webbing pays out
  const labRetractor = new THREE.Group(); labRetractor.position.set(0.5, FLOOR + 0.2, 0.585); sled.add(labRetractor);
  mesh(rbox(0.15, 0.17, 0.09, 0.02), std(0x2f3338, { r: 0.5, m: 0.5 }), [0, 0, -0.03], [0, 0, 0], labRetractor);
  const labReel = mesh(cyl(0.042, 0.03, 20), std(0xd9a441, { r: 0.5, m: 0.2 }), [0, -0.01, 0.025], [Math.PI / 2, 0, 0], labRetractor);
  mesh(rbox(0.012, 0.09, 0.012, 0.004), std(0x2a2826, { r: 0.5 }), [0, 0, 0.016], [0, 0, 0], labReel);
  stylize(labRetractor, 'hero', { outlineScale: 0.7 });
  const labDRing = buildDRing(sled, 0.5, 1.26, 0.56), labBuckle = buildBuckle(sled, -0.2, 0.57, -0.2); stylize(labDRing, 'hero'); stylize(labBuckle, 'hero', { outlineScale: 0.6 });
  const labBeltA = makeRibbon(sled, 0.05, 12), labBeltB = makeRibbon(sled, 0.05, 16), labBeltC = makeRibbon(sled, 0.05, 8), labBeltD = makeRibbon(sled);
  // the dummy: the same rig drawn as an instrumented test dummy (no face, no clothes, joint and head targets)
  const DUMMY = { skin: '#EDB63E', shirt: '#EDB63E', trousers: '#EDB63E', boots: '#3B3F45', hair: '#EDB63E', apron: '#EDB63E', line: plan.character.palette.line, buttons: '#EDB63E', mouth: '#EDB63E', tongue: '#EDB63E', cap: '#EDB63E' };
  const circle = (c, r, n = 28) => Array.from({ length: n }, (_, i) => [c[0] + Math.cos(i / n * 6.2832) * r, c[1] + Math.sin(i / n * 6.2832) * r]);
  const wedge = (c, r, a0) => [c, ...Array.from({ length: 9 }, (_, i) => [c[0] + Math.cos(a0 + i / 8 * 1.5708) * r, c[1] + Math.sin(a0 + i / 8 * 1.5708) * r])];
  const dummy = makeFigureCard({ ...plan.character, palette: DUMMY }, { canvasPx: 2048, edit(figure, def, state) {
    const drop = new Set(['hair', 'eyes', 'brows', 'mouth', 'tongue', 'collar', 'apron', 'straps', 'buttons', 'pocket', 'spark', 'cuffF', 'cuffB']);
    figure.items = figure.items.filter(it => !drop.has(it.id));
    const J = figure.joints, hc = J.headCenter, a = -(state.pose.torso + state.pose.head) * Math.PI / 180, dark = '#2a2623';
    figure.items.push({ id: 'target', outline: true, shapes: [{ pts: circle(hc, 62), closed: true, fill: '#f4efe4' }] });
    figure.items.push({ id: 'targetQ', outline: false, shapes: [0, Math.PI].map(q => ({ pts: wedge(hc, 60, a + q), closed: true, fill: dark })) });
    for (const j of ['shoulderB', 'elbowB', 'hipB', 'kneeB']) figure.items.push({ id: 'pin' + j, outline: false, shapes: [{ pts: circle(J[j], 24), closed: true, fill: dark }, { pts: circle(J[j], 10), closed: true, fill: '#f4efe4' }] });
    return figure;
  } });
  sled.add(dummy.group);

  // ================================================================= SET 3: inside the retractor (10x life size)
  const ret = new THREE.Group(); ret.position.set(RET_X, 2, 0); scene.add(ret);
  const RT = { teeth: 16, tipR: 0.86, rootR: 1.0 };
  const retSpool = new THREE.Group(), retInertia = new THREE.Group(), retPawlPivot = new THREE.Group();
  let retWeb, retWebTex, retSpring, pawlMat;
  {
    const steelT = metalTex('#93a3b5'), frame = std(0xffffff, { map: steelT, m: 0.3, r: 0.5 }), darkSteel = std(0x7f8fa3, { m: 0.3, r: 0.5 });
    const G = new THREE.Group(); ret.add(G);
    // U-frame: back plate, far side plate, and the near side plate whose opening carries the fixed ratchet teeth
    mesh(rbox(0.16, 3.2, 1.9, 0.05), frame, [1.45, 0, -0.75], [0, 0, 0], G);
    mesh(rbox(2.9, 3.0, 0.1, 0.04), frame, [0, 0, -1.6], [0, 0, 0], G);
    const plate = new THREE.Shape(); const hw = 1.45, hh = 1.5, cr = 0.22;
    plate.moveTo(-hw + cr, -hh); plate.lineTo(hw - cr, -hh); plate.quadraticCurveTo(hw, -hh, hw, -hh + cr); plate.lineTo(hw, hh - cr); plate.quadraticCurveTo(hw, hh, hw - cr, hh); plate.lineTo(-hw + cr, hh); plate.quadraticCurveTo(-hw, hh, -hw, hh - cr); plate.lineTo(-hw, -hh + cr); plate.quadraticCurveTo(-hw, -hh, -hw + cr, -hh);
    // ratchet opening: each tooth has a radial stop face and a long ramp, so the pawl catches in the pay-out direction only
    const hole = new THREE.Path(), N = RT.teeth;
    for (let i = 0; i < N; i++) { const a0 = i / N * Math.PI * 2, a1 = (i + 1) / N * Math.PI * 2; const p = (r, a) => [Math.cos(a) * r, Math.sin(a) * r]; const [x0, y0] = p(RT.rootR, a0), [x1, y1] = p(RT.tipR, a1), [x2, y2] = p(RT.rootR, a1); if (!i) hole.moveTo(x0, y0); hole.lineTo(x1, y1); hole.lineTo(x2, y2); }
    plate.holes.push(hole);
    mesh(new THREE.ExtrudeGeometry(plate, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 10 }), darkSteel, [0, 0, 0], [0, 0, 0], G);
    for (const [x, y] of [[-1.2, 1.25], [1.2, 1.25], [-1.2, -1.25], [1.2, -1.25]]) mesh(cyl(0.09, 0.08, 6), std(0xc9ccd2, { m: 0.9, r: 0.3 }), [x, y, 0.17], [Math.PI / 2, 0, 0], G);
    stylize(G, 'set', { outlineScale: 2.2 });
    // the spool: webbing roll on a shaft, with the lock carrier on its near end
    ret.add(retSpool);
    retWebTex = webTex.clone(); retWebTex.needsUpdate = true; retWebTex.repeat.set(1, 9); retWebTex.rotation = Math.PI / 2; retWebTex.center.set(0.5, 0.5);
    mesh(cyl(0.7, 1.3, 40), std(0xffffff, { map: retWebTex, r: 0.9 }), [0, 0, -0.78], [Math.PI / 2, 0, 0], retSpool);
    for (const z of [-0.1, -1.46]) mesh(cyl(0.8, 0.06, 40), std(0x39424d, { r: 0.6 }), [0, 0, z], [Math.PI / 2, 0, 0], retSpool);
    const carrier = mesh(cyl(0.74, 0.1, 40), std(0x3f78b8, { r: 0.55, m: 0.1 }), [0, 0, 0.07], [Math.PI / 2, 0, 0], retSpool);
    for (let i = 0; i < 3; i++) mesh(cyl(0.07, 0.11, 16), std(0x2f5f96, { r: 0.5, m: 0.1 }), [Math.cos(i * 2.094 + 1) * 0.5, Math.sin(i * 2.094 + 1) * 0.5, 0.075], [Math.PI / 2, 0, 0], retSpool);
    mesh(cyl(0.13, 0.5, 20), std(0xc9ccd2, { m: 0.9, r: 0.3 }), [0, 0, 0.2], [Math.PI / 2, 0, 0], retSpool);
    // the pawl: pivots on the carrier, tucked by a spring; its tip swings out into the fixed teeth
    retPawlPivot.position.set(0.52, 0.0, 0.2); retSpool.add(retPawlPivot);
    const pawl = new THREE.Shape(); pawl.moveTo(-0.1, -0.1); pawl.quadraticCurveTo(-0.16, 0.0, -0.1, 0.1); pawl.lineTo(0.02, 0.42); pawl.quadraticCurveTo(0.08, 0.56, 0.2, 0.5); pawl.lineTo(0.22, 0.4); pawl.lineTo(0.12, 0.36); pawl.lineTo(0.1, 0.05); pawl.quadraticCurveTo(0.12, -0.1, 0.0, -0.14); pawl.quadraticCurveTo(-0.06, -0.14, -0.1, -0.1);
    pawlMat = std(0xf0a63a, { r: 0.4, m: 0.45, e: 0xff8a1e, ei: 0 });
    mesh(new THREE.ExtrudeGeometry(pawl, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 }), pawlMat, [0, 0, 0], [0, 0, 0], retPawlPivot);
    mesh(cyl(0.05, 0.14, 14), std(0xc9ccd2, { m: 0.9, r: 0.3 }), [0, 0, 0.06], [Math.PI / 2, 0, 0], retPawlPivot);
    retSpring = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 60 }, (_, i) => V(i / 59, Math.sin(i / 59 * Math.PI * 14) * 0.045, Math.cos(i / 59 * Math.PI * 14) * 0.045)), false), 120, 0.012, 6), std(0xdadde2, { m: 0.9, r: 0.3 }), [0, 0, 0], [0, 0, 0], retSpool);
    // the inertia disc: free on the shaft, dragged round by a light spring, so it lags when the spool jerks
    retInertia.position.z = 0.36; ret.add(retInertia);
    const ring = new THREE.Shape(); ring.absarc(0, 0, 0.44, 0, Math.PI * 2); const rh = new THREE.Path(); rh.absarc(0, 0, 0.2, 0, Math.PI * 2, true); ring.holes.push(rh);
    for (let i = 0; i < 3; i++) { const h2 = new THREE.Path(); h2.absarc(Math.cos(i * 2.094) * 0.32, Math.sin(i * 2.094) * 0.32, 0.07, 0, Math.PI * 2, true); ring.holes.push(h2); }
    mesh(new THREE.ExtrudeGeometry(ring, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 24 }), std(0xf4ecd8, { r: 0.6, e: 0x3a352c, ei: 0.5 }), [0, 0, 0], [0, 0, 0], retInertia);
    mesh(cyl(0.05, 0.14, 14), std(0xd8482f, { r: 0.5, e: 0x5a1408 }), [0.36, 0.2, 0.06], [Math.PI / 2, 0, 0], retInertia);   // the cam pin that pushes the pawl
    mesh(rbox(0.3, 0.1, 0.06, 0.02), std(0xd8482f, { r: 0.5, e: 0x5a1408 }), [0.3, 0.1, 0.05], [0, 0, 0.6], retInertia);
    stylize(retSpool, 'hero', { outlineScale: 2.2 }); stylize(retInertia, 'hero', { outlineScale: 2.2 });
    // webbing leaving the top of the roll, straight up out of frame (a 3D band: its width runs along the spool axis)
    const wt = webTex.clone(); wt.needsUpdate = true; wt.repeat.set(1, 6);
    retWeb = mesh(new THREE.BoxGeometry(0.03, 6, 1.18), [std(0x14100d), std(0x14100d), std(0x14100d), std(0x14100d), std(0x14100d), std(0x14100d)], [-0.715, 3.0, -0.78], [0, 0, 0], ret);
    const face = mesh(new THREE.PlaneGeometry(1.14, 6), std(0xffffff, { map: wt, r: 0.9 }), [-0.735, 3.0, -0.78], [0, -Math.PI / 2, 0], ret, false); retWeb.userData.tex = wt; retWeb.userData.face = face;
    // backdrop: a soft warm card
    const bd = canvasTex(512, 512, (g, w, h) => { const gr = g.createRadialGradient(w * 0.42, h * 0.45, 20, w * 0.5, h * 0.5, w * 0.75); gr.addColorStop(0, '#6f5646'); gr.addColorStop(0.6, '#3f3029'); gr.addColorStop(1, '#221a17'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
    mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: bd, toneMapped: false }), [0, 0, -6], [0, 0, 0], ret, false);
  }

  // ---------------------------------------------------------------- lights
  const hemi = new THREE.HemisphereLight(ctx.style.palette.ambientSky, ctx.style.palette.ambientGround, 0.9); scene.add(hemi);
  const key = new THREE.DirectionalLight(ctx.style.palette.key, 3.2); key.castShadow = true; key.shadow.mapSize.set(ctx.quality.shadowMap, ctx.quality.shadowMap); key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02; scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(ctx.style.palette.fill, 0.9); scene.add(fill, fill.target);
  const cabin = new THREE.PointLight(0xffd9b0, 0, 6, 1.6); scene.add(cabin);
  function light(center, dir, size, { k = 3.2, f = 0.9, h = 0.9, fillDir = [0.4, 0.5, 1] } = {}) {
    key.target.position.set(...center); key.position.set(center[0] + dir[0] * 12, center[1] + dir[1] * 12, center[2] + dir[2] * 12); key.intensity = k;
    const sc = key.shadow.camera; sc.left = sc.bottom = -size; sc.right = sc.top = size; sc.near = 0.5; sc.far = 40; sc.updateProjectionMatrix();
    fill.target.position.set(...center); fill.position.set(center[0] + fillDir[0] * 8, center[1] + fillDir[1] * 8, center[2] + fillDir[2] * 8); fill.intensity = f; hemi.intensity = h;
  }
  function cam(p, l, fov, shake = 0, t = 0) {
    camera.fov = fov; camera.position.set(p[0] + shake * Math.sin(t * 83), p[1] + shake * Math.sin(t * 107 + 1), p[2]); camera.lookAt(l[0], l[1], l[2]);
  }
  const bg = new THREE.Color(); scene.background = bg;

  // ---------------------------------------------------------------- the driver
  const HIP = [0, 0.47, 0.02], U = hero.units;
  const SIT = { hipDrop: 0, torso: -9, head: 5, legF: [80, 66], legB: [86, 72], armF: [60, 40], armB: [20, 60], handF: 'fist', handB: 'fist', squash: 1 };
  // world (x, y) -> rig millimetres for a mirrored, seated figure whose hip sits on HIP
  const toRig = (def, pose, hipW, x, y) => [-(x - hipW[0]) / U, def.rig.hipY - (pose.hipDrop ?? 0) + (y - hipW[1]) / U];
  function poseDriver({ hand, handF = [-0.47, 1.08], torso = SIT.torso, head = SIT.head, face = 'neutral', gaze = [0, 0], blink = 0, hipShift = 0, grip = 'fist' }) {
    const pose = { ...SIT, torso, head, handB: grip }, hipW = [HIP[0] + hipShift, HIP[1], HIP[2]];
    pose.armB = solveArm(hero.def, pose, 'B', toRig(hero.def, pose, hipW, hand[0], hand[1]));
    pose.armF = solveArm(hero.def, pose, 'F', toRig(hero.def, pose, hipW, handF[0], handF[1]));
    hero.set({ pose, face, gaze, blink }, { hip: hipW, mirror: -1, outlineMm: 7.5, tint: new THREE.Color(1, 0.975, 0.94) });
    return hero.joint('handB');
  }
  const blinkAt = t => { const p = (t + 0.4) % 2.7; return p < 0.12 ? Math.sin(p / 0.12 * Math.PI) : 0; };
  const DR = V(0.5, 1.2, 0.6), ANCHOR = V(0.5, 0.36, 0.6), STOW = [0.47, 1.0];
  // The belt in the car. `hand`: the tongue's position (world), `buckled` 0..1 pulls the lap part down across him
  function carBelt(hand, { feed = 0, taut = 1, buckled = 0, twang = 0 } = {}) {
    const h = V(hand.x, hand.y, lerp(0.3, 0.1, buckled));
    carTongue.position.copy(h); carTongue.rotation.z = lerp(-0.5, 0.25, buckled);
    const mid = V(lerp(DR.x, h.x, 0.5), lerp(DR.y, h.y, 0.5) + twang, lerp(DR.z, h.z, 0.45));
    carBeltA.update([DR, mid, h], { feed, sag: (1 - taut) * 0.05 });
    const hipFront = V(-0.02, 0.5, 0.2);
    carBeltB.update(buckled > 0.5 ? [h, hipFront, V(0.3, 0.42, 0.45), ANCHOR] : [h, V(lerp(h.x, ANCHOR.x, 0.55) + 0.04, lerp(h.y, ANCHOR.y, 0.5) - (1 - taut) * 0.03, lerp(h.z, ANCHOR.z, 0.6)), ANCHOR], { feed: -feed, sag: (1 - taut) * 0.04 });
  }

  // ---------------------------------------------------------------- the dummy on the sled
  const DSIT = { ...SIT, torso: -9, head: 4, handF: 'open', handB: 'open' };
  // lurch 0..1 is how far he is thrown; `locked` decides how far that is. Returns the shoulder point the belt rides over
  function poseDummy(lurch, locked, t, held = 15) {
    const far = locked ? held : 41, torso = DSIT.torso + far * lurch, slide = (locked ? 0.025 : 0.09) * lurch;
    const pose = { ...DSIT, torso, head: DSIT.head + (locked ? 16 : 26) * lurch, armB: [20 + (locked ? 46 : 96) * lurch, 60 - 44 * lurch], armF: [30 + (locked ? 40 : 88) * lurch, 50 - 36 * lurch], legB: [86 - 4 * lurch, 72 - 26 * lurch * (locked ? 0.4 : 1)], legF: [80 - 4 * lurch, 66 - 22 * lurch * (locked ? 0.4 : 1)] };
    dummy.set({ pose, face: 'neutral', gaze: [0, 0], blink: 0 }, { hip: [HIP[0] - slide, HIP[1], HIP[2]], mirror: -1, outlineMm: 7.5, tint: new THREE.Color(1, 0.98, 0.95) });
    const sh = dummy.joint('shoulderB'), nk = dummy.joint('neck');
    return V(lerp(sh.x, nk.x, 0.45), lerp(sh.y, nk.y, 0.6) + 0.035, 0.12);
  }
  const LDR = V(0.5, 1.2, 0.575), LBK = V(-0.2, 0.6, 0.1), LRET = V(0.5, FLOOR + 0.27, 0.575);
  function labBelt(shoulder, { feed = 0, twang = 0, slack = 0 } = {}) {
    const mid = V(lerp(LDR.x, shoulder.x, 0.5), lerp(LDR.y, shoulder.y, 0.5) + twang - slack * 0.03, lerp(LDR.z, shoulder.z, 0.5));
    labBeltA.update([LDR, mid, shoulder], { feed, sag: slack * 0.02 });
    labBeltB.update([shoulder, V(lerp(shoulder.x, LBK.x, 0.5) - 0.012, lerp(shoulder.y, LBK.y, 0.5), 0.14), LBK], { feed });
    labBeltD.update([LBK, V(0.0, 0.52, 0.2), V(0.3, 0.42, 0.45), V(0.5, FLOOR + 0.12, 0.56)], {});
    labBeltC.update([LRET, V(0.5, 0.8, 0.585), V(0.5, 1.17, 0.585)], { feed: -feed, w: 0.046 });
    labReel.rotation.y = feed / 0.05;
  }
  // The sled runs in from screen right and stops dead against the barrier at `tHit`. After the hit, time runs slow
  function crash(t, tHit, locked, { slow = 0.32, speed = 7, held = 15 } = {}) {
    const stopX = -0.72, x = t < tHit ? stopX + speed * (tHit - t) * (1 - 0.0) : stopX + 0.03 * damped(t - tHit, 7, 10);
    sled.position.x = x;
    const u = Math.max(0, t - tHit) * slow;                         // slowed time since the hit
    // thrown forward, then (locked) held with a small rebound, or (no lock) still going
    const lurch = locked ? easeOut(seg(u, 0, 0.11)) * (1 - 0.3 * sseg(u, 0.11, 0.32)) + 0.05 * damped(u - 0.11, 6, 9) : easeOut(seg(u, 0, 0.42));
    const shoulder = poseDummy(lurch, locked, t, held);
    const payout = locked ? 0.02 * Math.min(1, lurch * 3) : 0.52 * lurch;
    labBelt(shoulder, { feed: payout, twang: locked ? 0.012 * damped(u - 0.1, 14, 16) : 0, slack: locked ? 0 : lurch });
    return { x, u, lurch };
  }

  // ---------------------------------------------------------------- retractor animation
  // The spool turns clockwise (seen from the camera) as webbing pays out upward on the left
  function retractor(spoolAngle, lag, engage, feed) {
    retSpool.rotation.z = -spoolAngle; retInertia.rotation.z = -(spoolAngle - lag);
    retPawlPivot.rotation.z = lerp(0.62, -0.02, engage);                 // tucked -> swung out into the teeth
    const tail = V(0.52 - 0.1, -0.02, 0.3), post = V(0.1, -0.42, 0.3);
    retSpring.position.copy(post); retSpring.scale.set(tail.distanceTo(post) * (1 + 0.12 * engage), 1, 1); retSpring.rotation.z = Math.atan2(tail.y - post.y, tail.x - post.x);
    retWeb.userData.tex.offset.y = -feed / 1.0; retWebTex.offset.x = feed / 4.4;
  }

  // ================================================================= the shots
  const shots = {
    // 1. He grabs the belt, yanks, and it stops dead
    yank(t, T) {
      const grab = W('grab') - 0.1, yank = W('yank') - 0.03, lock = yank + 0.11;
      const up = easeOut(seg(T, grab - 0.42, grab)), draw = sseg(T, grab + 0.1, yank - 0.08), snap = easeIn(seg(T, yank, lock)), after = T - lock;
      // hand path: lap -> up to the stowed tongue -> draws it out -> yank, stopped short
      let hx = lerp(lerp(-0.12, STOW[0] - 0.09, up), 0.02, draw), hy = lerp(lerp(0.62, STOW[1] + 0.04, up), 0.95, draw);
      hx = lerp(hx, -0.2, snap); hy = lerp(hy, 0.8, snap);
      const jerk = after > 0 ? damped(after, 7, 7) : 0, tug = after > 0.55 ? 0.018 * Math.max(0, Math.sin((after - 0.55) * 11)) * (1 - seg(after, 0.55, 1.5)) : 0;
      hx += 0.03 * jerk - tug; hy += 0.012 * jerk;
      const face = T < grab - 0.3 ? 'determined' : after < 0 ? 'determined' : after < 0.45 ? 'surprised' : 'confused';
      const hand = poseDriver({ hand: [hx, hy], torso: SIT.torso + 5 * (1 - up) + 3 * draw - 7 * snap + 5 * jerk, head: SIT.head - 6 * up + 8 * snap - 6 * jerk, face, gaze: [after > 0.5 ? -0.7 : lerp(0.2, -0.5, up), after > 0.5 ? -0.3 : 0.1], blink: blinkAt(T), handF: T < grab - 0.5 ? [-0.42, 0.98] : [-0.47, 1.08] });
      const held = up >= 1;
      carBelt(held ? hand : V(STOW[0], STOW[1], 0.6), { feed: (0.42 * draw + 0.2 * snap), taut: held ? lerp(0.5, 1, snap) : 1, twang: after > 0 ? 0.02 * damped(after, 13, 9) : 0 });
      const push = sseg(T, yank - 0.3, lock + 0.2);
      cam([lerp(0.06, 0.02, push), lerp(1.36, 1.33, push), lerp(4.05, 3.75, push)], [-0.04, lerp(1.3, 1.27, push), 0], 30, after > 0 && after < 0.14 ? 0.012 : 0, T);
      return {};
    },
    // 2. Clank, clank, clank: three more yanks, three locks
    clanks(t, T) {
      const c = [W('Clank#1'), W('Clank#2'), W('Clank#3')], rest = [0.02, 0.95], stop = [[-0.2, 0.8], [-0.23, 0.78], [-0.27, 0.75]];
      let hand = rest, torso = SIT.torso, head = SIT.head, face = 'confused', twang = 0, feed = 0.42, shake = 0;
      for (let i = 0; i < 3; i++) {
        const lock = c[i] + 0.02, go = lock - 0.12, back = lock + 0.3, next = i < 2 ? c[i + 1] - 0.14 : S.clanks.endSec + 0.2;
        if (T < go) continue;
        const snap = easeIn(seg(T, go, lock)), relax = sseg(T, back, Math.min(back + 0.32, next)), after = T - lock, amp = 1 + i * 0.35;
        hand = mixA(mixA(rest, stop[i], snap), rest, relax);
        const jerk = after > 0 ? damped(after, 7, 8) * amp : 0;
        hand = [hand[0] + 0.03 * jerk, hand[1] + 0.01 * jerk];
        torso = SIT.torso - (4 + 3 * i) * snap * (1 - relax) + 5 * jerk; head = SIT.head + 7 * snap * (1 - relax) - 7 * jerk;
        face = ['confused', 'determined', 'surprised'][i]; if (i === 1 && after < 0) face = 'concerned';
        twang = after > 0 ? 0.02 * damped(after, 13, 10) * amp : 0; feed = 0.42 + 0.2 * snap * (1 - relax);
        shake = after > 0 && after < 0.12 ? 0.008 + 0.004 * i : 0;
      }
      const h = poseDriver({ hand, torso, head, face, gaze: [-0.6, -0.2], blink: 0 });
      carBelt(h, { feed, taut: 1, twang });
      const push = sseg(T, c[0] - 0.3, c[2] + 0.4);
      cam([0.02, lerp(1.33, 1.31, push), lerp(3.75, 3.3, push)], [-0.04, lerp(1.27, 1.25, push), 0], 30, shake, T);
      return {};
    },
    // 3. He glares at it; the camera pushes onto the webbing and the mood turns
    twist(t, T) {
      const a = W('Annoying'), b = W('But') - 0.1, e = S.twist.endSec;
      const slump = sseg(T, a - 0.1, a + 0.4), look = sseg(T, a + 0.25, a + 0.6);
      const h = poseDriver({ hand: [lerp(0.02, -0.08, slump), lerp(0.95, 0.86, slump)], torso: SIT.torso + 4 * slump, head: SIT.head + 6 * slump, face: T < a + 0.2 ? 'surprised' : 'disappointed', gaze: [lerp(-0.6, 0.15, look) - 0.5 * sseg(T, b, b + 0.4), -0.25], blink: T < b ? blinkAt(T + 1.1) : 0 });
      carBelt(h, { feed: 0.36, taut: 0.85 });
      const push = smooth(seg(T, b, e - 0.05)), p2 = push * push;
      cam([lerp(0.02, h.x + 0.14, p2), lerp(1.31, h.y + 0.1, p2), lerp(3.3, 0.75, p2)], [lerp(-0.04, h.x + 0.16, push), lerp(1.25, h.y + 0.1, push), 0.2 * push], 30);
      hero.material.uniforms.tint.value.setRGB(lerp(1, 0.78, push), lerp(0.975, 0.8, push), lerp(0.94, 0.9, push));
      return { grade: push, fade: sseg(T, e - 0.2, e) };
    },
    // 4. The sled hits the barrier; the dummy keeps going (slow motion after the hit)
    crash(t, T) {
      const hit = W('crash') + 0.08, st = crash(T, hit, true, { slow: 0.22, held: 30 });
      cam([LAB_X - 1.3, 1.6, 7.0], [LAB_X - 1.3, 1.45, 0], 30, T > hit && T < hit + 0.16 ? 0.02 : 0, T);
      return { fade: 1 - sseg(T, S.crash.startSec, S.crash.startSec + 0.16) };
    },
    // 5. The taut webbing, up over the guide loop and down the post to the retractor
    tension(t, T) {
      const a = S.tension.startSec, e = S.tension.endSec, hold = crash(100, 0, true);
      sled.position.x = -0.72;
      const sh = poseDummy(0.7, true, T, 30); labBelt(sh, { feed: 0.02, twang: 0.006 * Math.sin(T * 40) * (1 - seg(T, a, a + 0.6)) });
      const X = LAB_X + sled.position.x, u1 = smooth(seg(T, a + 0.5, W('lock') + 0.1)), u2 = smooth(seg(T, W('lock') + 0.1, e));
      const look = [X + lerp(lerp(sh.x + 0.1, 0.5, u1), 0.5, u2), lerp(lerp(sh.y - 0.16, 1.14, u1), FLOOR + 0.3, u2), 0.5];
      cam([look[0] - 0.1 + 0.25 * u2, look[1] + 0.05, lerp(lerp(2.5, 2.1, u1), 1.5, u2)], look, 30);
      labReel.rotation.y = 0;
      return {};
    },
    // 6. Inside: a slow pull turns freely; a fast jerk leaves the inertia disc behind, the pawl swings out, the spool stops
    retractor(t, T) {
      const a = S.retractor.startSec, jerk = W('jerk') - 0.06, e = S.retractor.endSec, pitch = Math.PI * 2 / RT.teeth;
      // free, unhurried turning first (about 1.3 turns), then a short pause, then the jerk
      const free = 2.2 * Math.PI * smooth(seg(T, a + 0.15, jerk - 0.35));
      const j = seg(T, jerk, jerk + 0.13), locked = T >= jerk + 0.13;
      // the jerk carries the spool on to the next tooth stop; choose it so the pawl lands square on a stop face
      const stopAngle = Math.ceil((free + 0.55) / pitch) * pitch + 0.12, angle = locked ? stopAngle - 0.018 * damped(T - jerk - 0.13, 9, 11) : lerp(free, stopAngle, easeIn(j) * 0.4 + j * 0.6);
      const lag = locked ? 0.4 * (1 - 0.25 * sseg(T, jerk + 0.13, jerk + 0.5)) : 0.4 * sseg(T, jerk, jerk + 0.09);
      const engage = locked ? 1 : sseg(T, jerk + 0.03, jerk + 0.12);
      retractor(angle, lag, engage, angle * 0.7);
      const flash = locked ? Math.max(0, 1 - (T - jerk - 0.13) / 0.25) : 0; pawlMat.emissiveIntensity = 0.9 * flash;
      // webbing: tugged hard after the lock ("stops the belt from feeding out"), but the spool does not give
      const tug = T > W('stops') - 0.05 ? 0.012 * Math.abs(Math.sin((T - W('stops')) * 9)) * (1 - seg(T, W('out'), e)) : 0;
      retWeb.position.x = -0.715 + (locked ? 0.01 * damped(T - jerk - 0.13, 16, 10) : 0); retWeb.userData.face.position.x = retWeb.position.x - 0.02; retWeb.position.y = 3 + tug; retWeb.userData.face.position.y = 3 + tug;
      const push = smooth(seg(T, a, e)), bump = locked && T < jerk + 0.25 ? 0.03 : 0;
      cam([RET_X + lerp(-3.0, -2.4, push), 2 + lerp(1.4, 1.15, push), lerp(9.4, 8.2, push)], [RET_X + 0.3, 2.55, -0.3], 30, bump, T);
      return { fade: 1 - sseg(T, a, a + 0.12) };
    },
    // 7. No lock: the webbing pays out and he keeps going
    'no-lock'(t, T) {
      const hit = S['no-lock'].startSec + 0.34, st = crash(T, hit, false, { slow: 0.3 });
      cam([LAB_X - 1.02, 1.42, 5.3], [LAB_X - 1.02, 1.32, 0], 30, T > hit && T < hit + 0.14 ? 0.016 : 0, T);
      return { danger: sseg(st.u, 0.15, 0.4) };
    },
    // 8. With the lock: same framing, the belt goes taut and holds him
    'with-lock'(t, T) {
      const hit = S['with-lock'].startSec + 0.34, st = crash(T, hit, true, { slow: 0.3 });
      cam([LAB_X - 1.02, 1.42, 5.3], [LAB_X - 1.02, 1.32, 0], 30, T > hit && T < hit + 0.14 ? 0.016 : 0, T);
      return { fade: sseg(T, S['with-lock'].endSec - 0.14, S['with-lock'].endSec) * 0.9 };
    },
    // 9. Back in the car: a smooth pull, the click, a small satisfied look
    closure(t, T) {
      const a = S.closure.startSec, click = a + 1.15, u = smooth(seg(T, a + 0.05, click)), done = T >= click, settle = sseg(T, click + 0.15, click + 0.8);
      const path = u < 0.5 ? mixA([0.36, 1.04], [0.02, 0.92], smooth(u * 2)) : mixA([0.02, 0.92], [-0.19, 0.64], smooth(u * 2 - 1));
      const hand = done ? mixA([-0.19, 0.64], [-0.42, 0.98], settle) : path;
      const h = poseDriver({ hand, handF: [-0.47, 1.08], torso: SIT.torso + 4 * u * (1 - settle), head: SIT.head + 3 * u - 4 * settle, face: done && T > click + 0.12 ? 'relieved' : 'neutral', gaze: done ? [lerp(-0.4, 0.2, settle), 0] : [-0.4, -0.5 * u], blink: blinkAt(T + 0.9), grip: done && settle > 0.5 ? 'fist' : 'fist' });
      const tongue = done ? V(-0.2, 0.635, 0.1) : h;
      carBelt(tongue, { feed: 0.5 * u, taut: 1, buckled: sseg(T, click - 0.25, click), twang: done ? 0.006 * damped(T - click, 12, 12) : 0 });
      if (done) carTongue.rotation.z = 0.12;
      const push = smooth(seg(T, a, S.closure.endSec));
      cam([0.02, 1.34, lerp(3.95, 3.75, push)], [-0.04, 1.28, 0], 30, done && T < click + 0.08 ? 0.004 : 0, T);
      return { fade: 1 - sseg(T, a, a + 0.14), fadeColor: '8,6,5' };
    }
  };

  const CAR_SHOTS = new Set(['yank', 'clanks', 'twist', 'closure']), LAB_SHOTS = new Set(['crash', 'tension', 'no-lock', 'with-lock']);
  return {
    update({ time, shot, t }) {
      const id = shot.id; car.visible = CAR_SHOTS.has(id); lab.visible = LAB_SHOTS.has(id); ret.visible = id === 'retractor';
      hero.material.uniforms.tint.value.setRGB(1, 0.975, 0.94); cabin.intensity = 0;
      let fx;
      if (car.visible) {
        bg.set('#d8c9b0'); light([0, 1, -0.3], [-0.55, 0.62, -0.5], 3.2, { k: 3.5, f: 0.9, h: 0.95 });
        cabin.position.set(-0.3, 1.5, 1.8); cabin.intensity = 4.5;
      } else if (lab.visible) {
        bg.set('#8a857d'); light([LAB_X - 0.8, 1, 0], [-0.35, 0.8, 0.55], 4.6, { k: 3.0, f: 0.9, h: 0.95, fillDir: [0.7, 0.3, 0.8] });
      } else {
        bg.set('#2a211d'); light([RET_X, 2, 0], [-0.4, 0.6, 0.7], 3.4, { k: 3.0, f: 0.9, h: 0.8, fillDir: [0.9, -0.1, 0.5] });
      }
      fx = shots[id](t, time) ?? {};
      if (lab.visible) { const d = fx.danger ?? 0; labWallMat.color.setRGB(1, 1 - 0.22 * d, 1 - 0.26 * d); }
      if (fx.grade) { key.intensity *= 1 - 0.45 * fx.grade; hemi.intensity *= 1 - 0.3 * fx.grade; }
      return fx;
    }
  };
}
