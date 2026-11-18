/*
 * Runaway Ore Cart: a 10-second silent motion test. Hand-directed scene (tools/episode/render.mjs).
 * One continuous shot: a loaded cart rolls along a canyon trestle toward the end of the rails, the worker (the approved
 * Cooper rig) throws the red lever, the yellow catch gate swings up, the cart slams into it, and one loose chunk of ore
 * keeps going over the edge.
 *
 * Assets: the four GLBs from the Runaway Ore Cart pack, copied byte-for-byte into the gitignored
 * production/mine-cart-motion-test/assets/ as .bin (see README.md). All four scene roots stay at identity and the
 * moving parts are driven by node name. Units are metres; +X runs down the track, +Y up, +Z is the camera side.
 *
 * Everything here is a pure function of time, so any frame renders identically in isolation (stills, partial
 * renders and the QA sampler all agree). window.mineCartQA() samples the evaluated scene for the motion checks.
 */
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = x => x * x * (3 - 2 * x);
const smoother = x => x * x * x * (x * (x * 6 - 15) + 10);
const seg = (t, a, b) => clamp((t - a) / Math.max(1e-6, b - a));
const sseg = (t, a, b) => smoother(seg(t, a, b));
const rad = d => d * Math.PI / 180;
const ASSETS = '/production/mine-cart-motion-test/assets/';

// ------------------------------------------------------------------ timing (seconds) — the shot's choreography targets
export const T = {
  workerIn: 1.70,      // first step of the worker's entrance (he is off frame left until ~1.95)
  grab: 2.80,          // hands close on the lever grip
  throwA: 2.98,        // anticipation ends, pull begins
  throwB: 3.36,        // lever reaches the +22° stop
  gateA: 3.62,         // linkage trips the gate
  gateB: 3.92,         // gate upright (with a small overshoot settling to 78°)
  hit: 4.45,           // bumper meets the gate pad
  settle: 5.20,        // cart at rest
  release: 5.62,       // worker lets go of the lever
  walkEnd: 7.30,       // worker arrives at the end of the deck
  recoil: 7.50,        // he jolts back at the drop
  lookDown: 8.25       // and then leans in to look over
};

// Cart travel: already rolling at frame 0, a slight build in speed (runaway), dead stop at the gate
const X0 = -7.6, V0 = 1.42;

export async function build(ctx) {
  const { THREE, scene, camera, stylize, makeFigureCard, solveArm } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  // ---------------------------------------------------------------- set and props: the supplied GLBs, untouched
  const loader = new GLTFLoader();
  const [trackG, cartG, gateG, leverG] = await Promise.all(['canyon-track', 'ore-cart', 'catch-gate', 'control-lever']
    .map(n => loader.loadAsync(ASSETS + n + '.bin')));
  for (const g of [trackG, cartG, gateG, leverG]) scene.add(g.scene);
  const node = (g, name) => { const o = g.scene.getObjectByName(name); if (!o) throw new Error(`missing node ${name}`); return o; };

  // Shading: Hold Up roles. Landforms take the architecture role (no ink); trestle, rails and dressing the set role;
  // the cart, gate and lever are hero props with the heavier ink so rims, lever and gate read at phone scale.
  const LAND = /^(Main_canyon|Tall_warm|Sandstone_spire|East_canyon|Layered_chasm|Distant|Chasm_floor|Dusty_chasm)/;
  const landform = new THREE.Group(), setPieces = new THREE.Group();
  for (const child of [...trackG.scene.children]) (LAND.test(child.name) ? landform : setPieces).add(child);
  trackG.scene.add(landform, setPieces);
  stylize(landform, 'architecture'); stylize(setPieces, 'set', { outlineScale: 1.2 });
  stylize(cartG.scene, 'hero', { outlineScale: 1.4 }); stylize(gateG.scene, 'hero', { outlineScale: 1.4 }); stylize(leverG.scene, 'hero', { outlineScale: 1.4 });
  for (const g of [trackG, cartG, gateG, leverG]) g.scene.traverse(o => { if (o.isMesh && o.userData.outlineOf === undefined) { o.castShadow = !LAND.test(o.name) || /spire|Tall/.test(o.name); o.receiveShadow = true; } });

  // ---------------------------------------------------------------- cart rig
  const cart = node(cartG, 'Cart_Root');
  const wheels = ['Wheel_Front_Near', 'Wheel_Front_Far', 'Wheel_Rear_Near', 'Wheel_Rear_Far'].map(n => node(cartG, n));
  const body = new THREE.Group(); body.name = 'Cart_Body';                // everything but the axles: rattles and pitches
  for (const c of [...cart.children]) if (!/^Axle_/.test(c.name)) body.add(c);
  cart.add(body);
  const bumper = node(cartG, 'Cart_Bumper_Contact');
  const heroOre = node(cartG, 'Hero_Ore'), heroLocal = heroOre.matrix.clone();
  const chunks = body.children.filter(c => /^Ore_load_chunk/.test(c.name)).map((c, i) => ({ o: c, p: c.position.clone(), r: c.rotation.clone(), k: i }));
  scene.add(heroOre);                                                      // world-space from here on (see orePose)

  // ---------------------------------------------------------------- gate and lever
  const gatePivot = node(gateG, 'Gate_Pivot'), gateContact = node(gateG, 'Gate_Contact');
  const leverPivot = node(leverG, 'Lever_Pivot'), grip = node(leverG, 'Grip_Target');
  // Solve the stop: the bumper face meets the gate pad when the gate is at its 78° working angle
  const GATE_UP = 78;
  gatePivot.rotation.z = rad(GATE_UP); gateG.scene.updateMatrixWorld(true); cartG.scene.updateMatrixWorld(true);
  const gateHit = gateContact.getWorldPosition(V(0, 0, 0)), bumperLocal = bumper.position.clone();
  const XS = gateHit.x - bumperLocal.x;                                    // ≈ −0.465
  const A = 2 * (XS - X0 - V0 * T.hit) / (T.hit * T.hit), VHIT = V0 + A * T.hit;
  gatePivot.rotation.z = 0;
  const gateBase = gatePivot.getWorldPosition(V(0, 0, 0)), gc = gateContact.position.clone();
  const gateContactX = th => gateBase.x + gc.x * Math.cos(th) - gc.y * Math.sin(th);

  // ---------------------------------------------------------------- cart state as a function of time
  const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const vnoise = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };
  const cartX = t => t < T.hit ? X0 + V0 * t + 0.5 * A * t * t : XS;
  const cartV = t => t < T.hit ? V0 + A * t : 0;
  // impact: the rear lifts and drops back onto the rails twice (nose-down pitch about the front wheels' rail contact)
  const pitchAt = t => { const u = t - T.hit; return u <= 0 ? 0 : -rad(2.4) * Math.exp(-u / 0.2) * Math.abs(Math.sin(Math.PI * u / 0.21)); };
  const PIVOT = V(0.63, 0.18, 0);
  function poseCart(t) {
    const x = cartX(t), v = cartV(t), th = pitchAt(t);
    cart.rotation.set(0, 0, th);
    // rotate about PIVOT: root = x + P − R·P
    const c = Math.cos(th), s = Math.sin(th);
    cart.position.set(x + PIVOT.x - (PIVOT.x * c - PIVOT.y * s), PIVOT.y - (PIVOT.x * s + PIVOT.y * c), 0);
    const spin = -(x - X0) / 0.27;                                         // rolling without slip on 0.27 m treads
    for (const w of wheels) w.rotation.z = spin;
    // running rattle: the body chatters on its springs in proportion to speed; the load hops in the tub
    const rv = clamp(v / 1.7), u = t - T.hit, jolt = u > 0 ? Math.exp(-u / 0.16) : 0;
    body.position.set(0, 0.006 * rv * vnoise(t * 23) + 0.004 * rv * Math.abs(Math.sin(x / 0.59 * Math.PI)), 0);
    body.rotation.set(rad(0.5) * rv * vnoise(t * 17 + 3), 0, rad(0.35) * rv * vnoise(t * 19 + 7));
    for (const ch of chunks) {
      const hop = 0.014 * rv * Math.max(0, vnoise(t * 14 + ch.k * 1.7)) ** 1.5;
      const surge = u > 0 ? 0.05 * (1 - Math.exp(-u / 0.06)) * Math.exp(-u / 0.5) * (0.6 + 0.4 * hash(ch.k)) : 0;
      ch.o.position.set(ch.p.x + surge, ch.p.y + hop + 0.03 * jolt * hash(ch.k + 9), ch.p.z);
      ch.o.rotation.set(ch.r.x + 0.12 * rv * vnoise(t * 9 + ch.k), ch.r.y, ch.r.z + 0.1 * rv * vnoise(t * 8 + ch.k * 3) - 0.25 * surge * 4);
    }
  }

  // ---------------------------------------------------------------- the loose ore: carried, then ballistic
  // At the hit it rides up over the tub's front rim (its forward speed bleeds into the rim), lobs over the raised gate,
  // lands on the last plank, skips once and falls clear of the deck end into the canyon.
  poseCart(T.hit); cartG.scene.updateMatrixWorld(true);
  const releaseM = body.matrixWorld.clone().multiply(heroLocal);
  const P0 = V(0, 0, 0).setFromMatrixPosition(releaseM), Q0 = new THREE.Quaternion().setFromRotationMatrix(releaseM);
  const S0 = V(0, 0, 0).setFromMatrixScale(releaseM);
  const G = 9.81, ORE_R = 0.15, LAND_Y = 0.005 + ORE_R, LAND_X = 0.93;
  const VY0 = 2.45, tLand = (VY0 + Math.sqrt(VY0 * VY0 + 2 * G * (P0.y - LAND_Y))) / G;
  const VX0 = (LAND_X - P0.x) / tLand, VZ = 0.09;
  const VY1 = 0.3 * (G * tLand - VY0), VX1 = 0.95;                         // the skip off the last plank
  const ORE = { tLand: T.hit + tLand };
  const spinAxis = V(0.25, 0.1, -1).normalize();
  function orePos(t, out = V(0, 0, 0)) {
    const u = t - T.hit;
    if (u < tLand) return out.set(P0.x + VX0 * u, P0.y + VY0 * u - 0.5 * G * u * u, P0.z + VZ * u);
    const w = u - tLand;
    return out.set(LAND_X + VX1 * w, LAND_Y + VY1 * w - 0.5 * G * w * w, P0.z + VZ * u);
  }
  function poseOre(t) {
    if (t < T.hit) {
      const m = body.matrixWorld.clone().multiply(heroLocal);
      m.decompose(heroOre.position, heroOre.quaternion, heroOre.scale);
      return;
    }
    orePos(t, heroOre.position);
    const u = t - T.hit, ang = u < tLand ? 7.5 * u : 7.5 * tLand + 11 * (u - tLand);
    heroOre.quaternion.setFromAxisAngle(spinAxis, -ang).multiply(Q0); heroOre.scale.copy(S0);
  }

  // ---------------------------------------------------------------- lever and gate as functions of time
  const back = x => { const c = 1.9; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
  function leverAngle(t) {                                                 // degrees, −22 (set) → +22 (thrown)
    const ant = sseg(t, T.grab - 0.05, T.throwA) * (1 - sseg(t, T.throwA, T.throwA + 0.12));
    const pull = t < T.throwA ? 0 : back(seg(t, T.throwA, T.throwB) ** 1.35);
    return -22 - 3 * ant + 44 * Math.min(pull, 1.04);
  }
  function gateAngle(t) {                                                  // degrees, 0 (stowed) → 78
    if (t < T.gateA) return 0;
    let a = GATE_UP * back(seg(t, T.gateA, T.gateB));
    if (t > T.gateB) a = GATE_UP + 3.5 * Math.exp(-(t - T.gateB) / 0.09) * Math.cos((t - T.gateB) * 40);
    return a;
  }
  function poseGate(t) {
    let th = rad(gateAngle(t));
    if (t >= T.hit) {                                                      // keep the pad on the bumper face through the settle
      const bx = bumper.getWorldPosition(V(0, 0, 0)).x;
      const target = Math.max(bx, gateHit.x);
      for (let k = 0; k < 4; k++) th += (gateContactX(th) - target) / (0.514 * Math.sin(th) + 0.088 * Math.cos(th));
    }
    gatePivot.rotation.z = th;
  }

  // ---------------------------------------------------------------- the worker: approved Cooper on a card
  const cooper = await (await fetch(ASSETS + 'cooper.json')).json();
  const worker = makeFigureCard(cooper, { canvasPx: 2048 });
  scene.add(worker.group);
  const def = worker.def, R = def.rig, U = worker.units;                   // metres per rig millimetre
  const PLANE_Z = 1.80;                                                    // his walking line on the near deck, clear of the lever base (z ≤ 1.65)
  const DECK_Y = 0.005;
  const L1 = R.thigh, L2 = R.shin, ANK = R.ankle;
  // Feet: planted intervals [from, to, ankle X] with swings between them. B is the near (camera-side) leg.
  // walk(): alternating landings, the back foot first, evenly spaced up to the final stance; swing takes 80% of a step.
  function walk(plan, t0, t1, n, finalBack, finalFront) {
    const { B, F } = plan;
    let back = B.at(-1)[2] < F.at(-1)[2] ? 'B' : 'F';
    const front0 = Math.max(B.at(-1)[2], F.at(-1)[2]), dt = (t1 - t0) / n;
    for (let k = 1; k <= n; k++) {
      const foot = plan[back], x = k === n ? finalFront : k === n - 1 ? finalBack : lerp(front0, finalBack, k / (n - 1));
      const lift = t0 + (k - 1) * dt, land = lift + dt * 0.8;
      foot.at(-1)[1] = lift; foot.push([land, 99, x]);
      back = back === 'B' ? 'F' : 'B';
    }
  }
  const steps = { B: [[-99, 99, -3.12]], F: [[-99, 99, -2.80]] };
  walk(steps, 1.78, 2.95, 6, -1.76, -1.34);                                 // entrance: brisk short steps up to the lever
  steps.B.at(-1)[1] = 2.99; steps.B.push([3.15, 99, -1.92]);                 // the brace: back foot drives back as he heaves
  walk(steps, T.release + 0.08, T.walkEnd, 7, 0.28, 0.72);                  // hurry to the end of the deck
  const recoilFoot = steps.B.at(-1)[2] > steps.F.at(-1)[2] ? steps.B : steps.F;
  recoilFoot.at(-1)[1] = T.recoil + 0.02; recoilFoot.push([T.recoil + 0.2, 99, recoilFoot.at(-1)[2] - 0.2]);   // recoil: front foot snaps back
  function footAt(side, t) {                                               // [ankle x, lift height, swing phase]
    const s = steps[side];
    for (let i = 0; i < s.length; i++) {
      const [a, b, x] = s[i];
      if (t >= a && t <= b) return [x, 0, 0];
      const n = s[i + 1];
      if (n && t > b && t < n[0]) {
        const u = (t - b) / (n[0] - b), e = smooth(u);
        return [lerp(x, n[2], e), Math.sin(Math.PI * u) * clamp(Math.abs(n[2] - x) * 0.22, 0.03, 0.1), u];
      }
    }
    return [s.at(-1)[2], 0, 0];
  }
  // Pelvis rides over the feet (their mean) plus an authored shift: forward into the reach, back through the heave,
  // forward into the walk, back at the recoil and forward again to look over
  const hipShift = t => 0.05 * (t < T.grab ? sseg(t, 1.7, 1.9) : 0)
    + 0.08 * sseg(t, T.grab - 0.3, T.grab) * (1 - sseg(t, T.throwA, T.throwB))
    - 0.03 * sseg(t, T.throwA, T.throwB) * (1 - sseg(t, T.release, T.release + 0.2))
    + 0.05 * sseg(t, T.release, T.release + 0.25) * (1 - sseg(t, T.walkEnd - 0.2, T.walkEnd))
    - 0.07 * sseg(t, T.recoil, T.recoil + 0.15) * (1 - sseg(t, T.recoil + 0.4, T.lookDown + 0.3))
    + 0.07 * sseg(t, T.lookDown, T.lookDown + 0.7);
  const hipX = t => (footAt('B', t)[0] + footAt('F', t)[0]) / 2 + hipShift(t);
  const hermite = keys => t => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys.at(-1)[0]) return keys.at(-1)[1];
    let i = keys.findIndex(k => k[0] > t) - 1;
    const [t0, v0] = keys[i], [t1, v1] = keys[i + 1], h = t1 - t0, u = (t - t0) / h;
    const tan = j => { const a = keys[Math.max(0, j - 1)], b = keys[Math.min(keys.length - 1, j + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); };
    const m0 = tan(i) * h, m1 = tan(i + 1) * h;
    return (2 * u ** 3 - 3 * u * u + 1) * v0 + (u ** 3 - 2 * u * u + u) * m0 + (-2 * u ** 3 + 3 * u * u) * v1 + (u ** 3 - u * u) * m1;
  };
  // Two-bone leg solve in rig millimetres: knee forward (toward +x), returns [thigh, knee]
  function solveLeg(top, ankle) {
    const dx = ankle[0] - top[0], dy = ankle[1] - top[1];
    const d = Math.min(L1 + L2 - 0.5, Math.max(Math.abs(L1 - L2) + 1, Math.hypot(dx, dy)));
    const phi = Math.atan2(dx, -dy) * 180 / Math.PI;
    const a = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) * 180 / Math.PI;
    const inner = Math.acos((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2)) * 180 / Math.PI;
    return [phi + a, 180 - inner];
  }
  const reachHip = (foot, hipx, side) => { const dx = (foot[0] - hipx) / U - R[`hip${side}`][0]; const L = (L1 + L2) * 0.985; return foot[1] / U + ANK + Math.sqrt(Math.max(0, L * L - dx * dx)); };
  const faceAt = t => t < T.grab - 0.3 ? 'concerned' : t < T.hit ? 'determined' : t < T.settle + 0.05 ? 'happy' : t < T.recoil ? 'surprised' : t < T.lookDown ? 'surprised' : 'concerned';
  const camRay = new THREE.Vector3();
  // world point -> as seen from the camera, where it falls on the worker's card plane
  const onPlane = (p, out = V(0, 0, 0)) => { camRay.subVectors(p, camera.position); const k = (PLANE_Z - camera.position.z) / camRay.z; return out.copy(camera.position).addScaledVector(camRay, k); };
  const gripW = V(0, 0, 0), shaftW = V(0, 0, 0), handTarget = V(0, 0, 0), shaftTarget = V(0, 0, 0);
  const shaftLocal = V(0, 0.5, 0.06);
  const qa = { hands: null, feet: {} };
  // On the lever the pelvis is nudged along the walking line (feet stay planted; the legs absorb it) until the near
  // hand can actually reach the grip as the camera sees it.
  function poseWorker(t) {
    const show = t >= T.workerIn - 0.2;
    worker.group.visible = show; if (!show) return;
    let dx = 0;
    for (let i = 0; i < 4; i++) {
      const e = poseWorkerAt(t, dx);
      if (e === null || Math.abs(e) < 0.002) break;
      // never at the cost of a planted foot: keep the pelvis within leg reach of both feet at a 300 mm hip height
      const reachX = Math.sqrt(((L1 + L2) * 0.985) ** 2 - (300 - ANK) ** 2) * U, h0 = hipX(t);
      const lo = Math.max(footAt('B', t)[0] - R.hipB[0] * U, footAt('F', t)[0] - R.hipF[0] * U) - reachX - h0;
      const hi = Math.min(footAt('B', t)[0] - R.hipB[0] * U, footAt('F', t)[0] - R.hipF[0] * U) + reachX - h0;
      dx = clamp(dx + e, Math.max(-0.2, lo), Math.min(0.2, hi));
    }
  }
  function poseWorkerAt(t, dx) {
    const fB = footAt('B', t), fF = footAt('F', t), hx = hipX(t) + dx;
    // Pelvis height: authored crouch for the pull and the look-down, capped by what both legs can reach
    const crouch = 40 * sseg(t, T.grab - 0.25, T.grab) * (1 - sseg(t, T.settle, T.release)) + 30 * sseg(t, T.throwA, T.throwB) * (1 - sseg(t, T.throwB + 0.1, T.throwB + 0.5))
      + 30 * sseg(t, T.lookDown, T.lookDown + 0.6) - 15 * sseg(t, T.recoil, T.recoil + 0.12) * (1 - sseg(t, T.recoil + 0.3, T.recoil + 0.6));
    const swing = Math.max(fB[2] ? Math.sin(Math.PI * fB[2]) : 0, fF[2] ? Math.sin(Math.PI * fF[2]) : 0);
    const bob = 12 * swing;
    let hipMm = R.hipY - 12 - crouch - bob;
    hipMm = Math.min(hipMm, reachHip(fB, hx, 'B'), reachHip(fF, hx, 'F'));
    const hipDrop = R.hipY - hipMm;
    const hipW = [hx, DECK_Y + hipMm * U, PLANE_Z];
    // Torso: forward lean into the walk and the reach, hard back-lean through the pull, recoil, then lean over the edge
    const walkLean = 8 * sseg(t, 1.7, 1.9) * (1 - sseg(t, T.grab - 0.3, T.grab)) + 10 * sseg(t, T.release, T.release + 0.3) * (1 - sseg(t, T.walkEnd - 0.1, T.recoil));
    const torso = walkLean + 14 * sseg(t, T.grab - 0.3, T.grab) * (1 - sseg(t, T.throwA - 0.05, T.throwA + 0.1))
      - 16 * sseg(t, T.throwA, T.throwB + 0.05) * (1 - 0.6 * sseg(t, T.throwB + 0.1, T.throwB + 0.6)) * (1 - sseg(t, T.release - 0.1, T.release + 0.2)) + 4 * Math.sin(Math.max(0, t - T.hit) * 18) * Math.exp(-Math.max(0, t - T.hit) / 0.18) * (t > T.hit ? 1 : 0)
      - 22 * sseg(t, T.recoil, T.recoil + 0.12) * (1 - sseg(t, T.recoil + 0.35, T.lookDown + 0.2)) + 24 * sseg(t, T.lookDown, T.lookDown + 0.7);
    const head = -4 * sseg(t, T.throwA, T.throwB) * (1 - sseg(t, T.hit, T.release)) + 10 * sseg(t, T.lookDown + 0.2, T.lookDown + 0.9);
    const pose = { hipDrop, torso, head, handF: 'open', handB: 'open', squash: 1, armF: [10, 12], armB: [-8, 12] };
    // legs: ankle targets in rig mm (rig x from the hip, y from the deck)
    const rigPt = (wx, wy) => [(wx - hx) / U, (wy - DECK_Y) / U];
    pose.legB = solveLeg([R.hipB[0], hipMm], [(fB[0] - hx) / U, ANK + fB[1] / U]);
    pose.legF = solveLeg([R.hipF[0], hipMm], [(fF[0] - hx) / U, ANK + fF[1] / U]);
    // arms: walk swing; both hands on the lever from the grab to the release; recoil throws them up; then hands on knees
    const walking = (t < T.grab - 0.15) || (t > T.release + 0.15 && t < T.walkEnd + 0.1);
    const ph = clamp((fF[0] - fB[0]) / 0.45, -1, 1);   // arms swing against the legs
    if (walking) { pose.armF = [10 - 30 * ph, 24]; pose.armB = [-6 + 30 * ph, 24]; pose.handF = pose.handB = 'fist'; }
    const onLever = t >= T.grab - 0.2 && t <= T.release + 0.12;
    if (onLever) {
      leverPivot.updateWorldMatrix(true, true);
      grip.getWorldPosition(gripW); leverPivot.localToWorld(shaftW.copy(shaftLocal));
      onPlane(gripW, handTarget); onPlane(shaftW, shaftTarget);
      const reach = sseg(t, T.grab - 0.2, T.grab) * (1 - sseg(t, T.release, T.release + 0.12));
      const solvedB = solveArm(def, pose, 'B', rigPt(handTarget.x, handTarget.y)), solvedF = solveArm(def, pose, 'F', rigPt(shaftTarget.x, shaftTarget.y));
      pose.armB = [lerp(pose.armB[0], solvedB[0], reach), lerp(pose.armB[1], solvedB[1], reach)];
      pose.armF = [lerp(pose.armF[0], solvedF[0], reach), lerp(pose.armF[1], solvedF[1], reach)];
      if (reach > 0.85) pose.handF = pose.handB = 'fist';
    }
    if (t > T.recoil - 0.05) {
      const up = sseg(t, T.recoil - 0.05, T.recoil + 0.1) * (1 - sseg(t, T.recoil + 0.45, T.lookDown + 0.1));
      pose.armF = [lerp(pose.armF[0], 128, up), lerp(pose.armF[1], 30, up)]; pose.armB = [lerp(pose.armB[0], 104, up), lerp(pose.armB[1], 40, up)];
      pose.handF = pose.handB = up > 0.3 ? 'open' : pose.handB;
      const knees = sseg(t, T.lookDown + 0.1, T.lookDown + 0.7);
      if (knees > 0) {
        worker.set({ pose, face: 'concerned', gaze: [0, 0], blink: 0 }, { hip: hipW, mirror: 1, outlineMm: 7 });
        const kF = worker.joint('kneeF'), kB = worker.joint('kneeB');
        const sF = solveArm(def, pose, 'F', rigPt(kF.x + 0.05, kF.y + 0.06)), sB = solveArm(def, pose, 'B', rigPt(kB.x + 0.04, kB.y + 0.07));
        pose.armF = [lerp(pose.armF[0], sF[0], knees), lerp(pose.armF[1], sF[1], knees)]; pose.armB = [lerp(pose.armB[0], sB[0], knees), lerp(pose.armB[1], sB[1], knees)];
      }
    }
    // eyes: on the lever, then the cart, the flying ore, and down into the canyon
    const oreSeen = sseg(t, T.hit + 0.15, T.hit + 0.35);
    let gaze = [0.25, -0.35];
    if (t > T.hit) gaze = [lerp(0.2, 0.6, oreSeen), lerp(-0.2, 0.35, oreSeen) - 0.6 * sseg(t, ORE.tLand - 0.1, ORE.tLand + 0.4)];
    if (t > T.lookDown) gaze = [lerp(gaze[0], 0.3, sseg(t, T.lookDown, T.lookDown + 0.5)), lerp(gaze[1], -1, sseg(t, T.lookDown, T.lookDown + 0.5))];
    const blink = [3.1, 5.0, 6.8, 9.2].some(b => Math.abs(t - b) < 0.06) ? 1 : 0;
    worker.set({ pose, face: faceAt(t), gaze, blink }, { hip: hipW, mirror: 1, outlineMm: 7, tint: new THREE.Color(1, 0.975, 0.94) });
    // contact evidence for the QA sampler
    if (onLever) qa.hands = { t, B: worker.joint('handB'), target: handTarget.clone(), F: worker.joint('handF'), shaft: shaftTarget.clone() };
    else qa.hands = null;
    for (const s of ['B', 'F']) {
      const f = s === 'B' ? fB : fF, ank = worker.joint(`ankle${s}`);
      qa.feet[s] = { planted: f[1] === 0 && f[2] === 0, target: f[0], x: ank.x, y: ank.y - ANK * U };
    }
    // contact shadows under the feet
    for (const [s, f] of [['B', fB], ['F', fF]]) {
      const sh = footShadow[s], a = worker.joint(`ankle${s}`);
      sh.position.set(a.x + 0.03, DECK_Y + 0.004, PLANE_Z - 0.02); sh.material.opacity = 0.42 * (1 - clamp(f[1] / 0.12));
    }
    bodyShadow.position.set(hx + 0.02, DECK_Y + 0.003, PLANE_Z - 0.04);
    if (!qa.hands || t < T.grab || t > T.release) return null;
    return qa.hands.target.x - qa.hands.B.x;
  }
  const shadowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(30,18,10,1)'); gr.addColorStop(1, 'rgba(30,18,10,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const blob = (w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.4 })); m.rotation.x = -Math.PI / 2; m.renderOrder = 2; scene.add(m); return m; };
  const footShadow = { B: blob(0.26, 0.12), F: blob(0.26, 0.12) }, bodyShadow = blob(0.55, 0.22); bodyShadow.material.opacity = 0.28;

  // ---------------------------------------------------------------- light and air
  scene.background = new THREE.Color('#a9bccb');
  scene.fog = new THREE.Fog('#dcc4a6', 9, 58);                         // warm haze: separates the deck from the far canyon and sells the depth
  const hemi = new THREE.HemisphereLight('#c7d6e6', '#8a5a3c', 1.25); scene.add(hemi);
  const key = new THREE.DirectionalLight('#ffd7a8', 3.4); key.position.set(-6.5, 11, 9); key.target.position.set(-3, 0, 0);
  key.castShadow = true; key.shadow.mapSize.set(ctx.quality.shadowMap * 2, ctx.quality.shadowMap * 2);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -7, near: 1, far: 40 }); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight('#9fb4d6', 0.9); fill.position.set(6, 4, 6); scene.add(fill);

  // ---------------------------------------------------------------- camera: one continuous move
  // Position and aim are C2 cubic splines keyed in time, so velocity and acceleration carry through every key. Aim is a blend of the authored target and the live subject (the flying ore) with a smooth weight.
  const camKeys = [
    // t      position              aim                    fov
    [0.00, [-7.05, 1.05, 3.20], [-7.45, 0.95, 0.00], 60],   // low, alongside, a touch ahead: cart, wheel and rim fill the frame; a post wipes past
    [0.75, [-6.10, 1.50, 3.15], [-5.40, 0.75, 0.00], 60],   // the cart starts to pull ahead as the camera lifts
    [1.35, [-6.30, 2.75, 3.45], [-3.00, -0.10, -0.15], 61], // rise and turn down the line
    [2.00, [-6.35, 3.70, 3.75], [-1.30, -0.90, -0.30], 62], // crest: rails end at the drop, trestle legs fall away below, cart heading there
    [3.05, [-3.70, 1.80, 5.10], [-1.60, 0.72, 0.80], 52],   // his reach and the lever, cart closing behind him
    [3.65, [-1.90, 1.35, 4.30], [-0.70, 0.62, 0.40], 48],   // lever thrown; arc right toward the gate
    [4.45, [-0.60, 1.05, 3.70], [0.30, 0.60, 0.10], 46],    // the hit: wheel, bumper and gate side-on
    [5.25, [0.35, 1.10, 3.60], [0.85, 0.50, 0.20], 46],     // settle; the loose chunk is airborne
    [6.15, [1.30, 1.60, 3.75], [1.25, -0.55, 0.40], 48],    // follow it to the last plank and over the lip
    [6.80, [1.55, 1.80, 4.00], [1.10, -0.95, 0.70], 48],    // dip: a glimpse of the depth it falls into
    [7.70, [1.60, 1.70, 4.30], [0.42, 0.42, 1.30], 48],     // back up as the worker arrives at the edge and recoils
    [8.80, [1.75, 1.85, 4.45], [0.62, 0.30, 1.25], 52],     // widen: worker, the stopped cart, the rail end and the drop
    [10.0, [1.80, 1.90, 4.50], [0.66, 0.26, 1.25], 52]      // settle on him looking over the edge
  ];

  // C2 natural cubic spline through timed keys: position, velocity and acceleration all continuous (no jerk at keys)
  const spline = keys => {
    const n = keys.length, x = keys.map(k => k[0]), y = keys.map(k => k[1]), h = x.slice(1).map((v, i) => v - x[i]);
    const M = new Array(n).fill(0), a = [], b = [], c = [], d = [];
    for (let i = 1; i < n - 1; i++) { a.push(h[i - 1]); b.push(2 * (h[i - 1] + h[i])); c.push(h[i]); d.push(6 * ((y[i + 1] - y[i]) / h[i] - (y[i] - y[i - 1]) / h[i - 1])); }
    for (let i = 1; i < d.length; i++) { const w = a[i] / b[i - 1]; b[i] -= w * c[i - 1]; d[i] -= w * d[i - 1]; }
    for (let i = d.length - 1; i >= 0; i--) M[i + 1] = (d[i] - (i < d.length - 1 ? c[i] * M[i + 2] : 0)) / b[i];
    return t => {
      const tt = clamp(t, x[0], x[n - 1]); let i = 0; while (i < n - 2 && tt > x[i + 1]) i++;
      const A = (x[i + 1] - tt) / h[i], B = (tt - x[i]) / h[i];
      return A * y[i] + B * y[i + 1] + ((A ** 3 - A) * M[i] + (B ** 3 - B) * M[i + 1]) * h[i] * h[i] / 6;
    };
  };
  const tracks = [0, 1, 2].map(axis => spline(camKeys.map(k => [k[0], k[1][axis]])));
  const aims = [0, 1, 2].map(axis => spline(camKeys.map(k => [k[0], k[2][axis]])));
  const fovT = spline(camKeys.map(k => [k[0], k[3]]));
  const oreTmp = V(0, 0, 0), aimV = V(0, 0, 0);
  function poseCamera(t) {
    camera.position.set(tracks[0](t), tracks[1](t), tracks[2](t));
    aimV.set(aims[0](t), aims[1](t), aims[2](t));
    const follow = 0.5 * sseg(t, T.hit + 0.3, T.hit + 1.0) * (1 - sseg(t, 7.0, 7.9));
    if (follow > 0) {                                                     // a lagged, low-passed read of the ore: no snap at the bounce
      oreTmp.set(0, 0, 0); const n = 9;
      for (let k = 0; k < n; k++) { const p = orePos(Math.max(T.hit, t - 0.12 - k * 0.04)); p.y = Math.max(p.y, -2.4); oreTmp.addScaledVector(p, 1 / n); }
      aimV.lerp(oreTmp, follow);
    }
    camera.fov = fovT(t); camera.lookAt(aimV);
  }

  // ---------------------------------------------------------------- per-frame update
  function update({ time }) {
    const t = time;
    leverPivot.rotation.z = rad(leverAngle(t));
    poseCart(t); cartG.scene.updateMatrixWorld(true);
    poseGate(t); gateG.scene.updateMatrixWorld(true);
    poseOre(t);
    poseCamera(t); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    poseWorker(t);
    return {};
  }

  // ---------------------------------------------------------------- motion QA sampler (evaluated scene, every frame)
  window.mineCartQA = (fps = 30, frames = 300) => {
    const out = { XS, VHIT, frames: [], setBoxes: 0 };
    const boxes = [];
    for (const g of [trackG, gateG, leverG]) g.scene.traverse(o => { if (o.isMesh && o.userData.outlineOf === undefined) boxes.push(new THREE.Box3().setFromObject(o)); });
    out.setBoxes = boxes.length;
    const wheelC = V(0, 0, 0), near = [];
    for (let f = 0; f < frames; f++) {
      const t = f / fps; update({ time: t });
      const cam = camera.position.clone();
      let minD = Infinity; for (const b of boxes) minD = Math.min(minD, b.distanceToPoint(cam));
      const cartBox = new THREE.Box3().setFromObject(body); minD = Math.min(minD, cartBox.distanceToPoint(cam));
      // wheel contact: lowest tread point of each wheel vs railhead (0.18)
      const wh = wheels.map(w => { w.getWorldPosition(wheelC); return +(wheelC.y - 0.27 - 0.18).toFixed(4); });
      const bx = bumper.getWorldPosition(V(0, 0, 0)).x, gx = gateContact.getWorldPosition(V(0, 0, 0)).x;
      const q = new THREE.Quaternion().copy(camera.quaternion);
      const rec = { f, t: +t.toFixed(3), cam: cam.toArray().map(v => +v.toFixed(4)), quat: q.toArray().map(v => +v.toFixed(9)), fov: camera.fov,
        camClear: +minD.toFixed(3), wheelGap: wh, wheelSpin: +wheels[2].rotation.z.toFixed(4), cartX: +cartX(t).toFixed(4),
        bumperGap: +(gx - bx).toFixed(4), gate: +(gatePivot.rotation.z * 180 / Math.PI).toFixed(2), lever: +leverAngle(t).toFixed(2),
        ore: heroOre.position.toArray().map(v => +v.toFixed(3)) };
      if (qa.hands) rec.hand = { B: +qa.hands.B.distanceTo(qa.hands.target).toFixed(4), F: +qa.hands.F.distanceTo(qa.hands.shaft).toFixed(4) };
      rec.feet = Object.fromEntries(Object.entries(qa.feet).map(([s, v]) => [s, { planted: v.planted, dx: +(v.x - v.target).toFixed(4), y: +v.y.toFixed(4), x: +v.x.toFixed(4) }]));
      // screen projections of the focal subjects (NDC)
      const ndc = p => { const v = p.clone().project(camera); return [+v.x.toFixed(3), +v.y.toFixed(3)]; };
      rec.screen = { cart: ndc(V(cartX(t), 0.9, 0)), cartFront: ndc(V(cartX(t) + 0.8, 1.0, 0.3)), wheelNear: ndc(wheels[2].getWorldPosition(V(0, 0, 0))), trackEnd: ndc(V(1.2, 0.18, 0)), ore: ndc(heroOre.position),
        worker: worker.group.visible ? ndc(V(hipX(t), 0.8, PLANE_Z)) : null, gate: ndc(gateHit), hand: qa.hands ? ndc(qa.hands.B) : null };
      out.frames.push(rec);
    }
    return out;
  };

  return { update };
}
