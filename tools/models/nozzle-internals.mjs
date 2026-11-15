import { Document, NodeIO } from '@gltf-transform/core';

/*
 * The automatic nozzle's internal shut-off mechanism, as original parametric geometry (Hold Up, dedicated CC0).
 * The exterior shell, spout and lever come from the sourced nozzle model; only what no free model shows is built here.
 * Every moving part is its own named node, so stories animate it with "part" actions (and morphs for the spring and
 * the diaphragm). The layout follows the verified mechanism (stories/gas-pump-shutoff/research.md):
 *   main valve: poppet on its seat, a closing spring above it, a stem down to the lever
 *   venturi throat downstream of the seat, with a suction port up to the diaphragm chamber
 *   sensing tube from the chamber down the spout to the hole near the tip
 *   latch: a pin hanging from the diaphragm through a plunger whose two balls lock it; the plunger carries the
 *   lever's pivot, so when the balls slip inward the plunger and pivot drop and the spring closes the valve
 * Nozzle-local frame, metres: x along the flow (hose inlet at -x, spout at +x), y up, z toward the viewer; the
 * section plane is z = 0. DEFAULTS are a generic proportioned nozzle; `fit` replaces them with the sourced shell's
 * measured interior before production.
 */
export const VERSION = 1;
export const DEFAULTS = {
  bore:0.011,
  valve:{x:-0.045, seatY:0, poppetR:0.0125, open:0.008, springTurns:6, springR:0.009, springWire:0.0012, springTop:0.04},
  venturi:{x:0.012, throat:0.0065, length:0.018},
  chamber:{x:-0.004, y:0.034, r:0.019, h:0.012},
  latch:{ballR:0.0032, plungerR:0.0062, plungerTop:0.026, plungerBottom:-0.03, pinR:0.0018},
  spout:{path:[[0.024, 0.02, 0], [0.05, 0.004, 0], [0.12, -0.022, 0], [0.215, -0.062, 0]], tubeR:0.0015, holeR:0.0022, holeDrop:0.0033}
};
export const PARTS = ['nozzle/seat', 'nozzle/poppet', 'nozzle/spring', 'nozzle/stem', 'nozzle/venturi', 'nozzle/port', 'nozzle/chamber', 'nozzle/diaphragm',
  'nozzle/pin', 'nozzle/ball-1', 'nozzle/ball-2', 'nozzle/plunger', 'nozzle/pivot', 'nozzle/tube', 'nozzle/hole'];
export const COLORS = {moving:[0.78, 0.8, 0.83, 1], fixed:[0.55, 0.58, 0.62, 1], rubber:[0.2, 0.2, 0.23, 1], spring:[0.84, 0.86, 0.88, 1], tube:[0.62, 0.66, 0.7, 1]};

// --- Mesh building: indexed grids with smooth normals -------------------------------------------------------------
export function grid(rows, cols, at, {closeCols = true} = {}) {
  const positions = [], indices = [];
  for (let i = 0; i <= rows; i++) for (let j = 0; j <= cols; j++) positions.push(...at(i / rows, j / cols));
  const w = cols + 1;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = i * w + j, b = a + 1, c = a + w, d = c + 1;
    indices.push(a, c, b, b, c, d);
  }
  return weld({positions, indices}, closeCols ? cols : null);
}
// Merge the seam column of a wrapped grid so normals are smooth across it
function weld(mesh, cols) {
  if (cols === null) return mesh;
  const w = cols + 1, remap = new Map();
  for (let v = 0; v < mesh.positions.length / 3; v++) if (v % w === cols) remap.set(v, v - cols);
  return {positions:mesh.positions, indices:mesh.indices.map(i => remap.get(i) ?? i)};
}
export function normalsOf({positions, indices}) {
  const n = new Float32Array(positions.length);
  for (let k = 0; k < indices.length; k += 3) {
    const [a, b, c] = [indices[k], indices[k + 1], indices[k + 2]].map(i => i * 3);
    const u = [0, 1, 2].map(x => positions[b + x] - positions[a + x]), v = [0, 1, 2].map(x => positions[c + x] - positions[a + x]);
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    for (const i of [a, b, c]) for (let x = 0; x < 3; x++) n[i + x] += f[x];
  }
  for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
  return n;
}
// Surface of revolution about Y from a profile [[radius, y], ...] (outer surface, closed ends via r = 0 points)
export const lathe = (profile, seg = 40) => grid(profile.length - 1, seg, (u, v) => {
  const k = Math.round(u * (profile.length - 1)), [r, y] = profile[k], a = v * Math.PI * 2;
  return [r * Math.cos(a), y, r * Math.sin(a)];
});
export const cylinder = (r, y0, y1, seg = 24) => lathe([[0, y0], [r, y0], [r, y1], [0, y1]], seg);
const sphere = (r, seg = 20) => grid(seg, seg, (u, v) => { const t = u * Math.PI, a = v * Math.PI * 2; return [r * Math.sin(t) * Math.cos(a), -r * Math.cos(t), r * Math.sin(t) * Math.sin(a)]; });
const torus = (R, r, seg = 40) => grid(seg, 16, (u, v) => { const a = u * Math.PI * 2, b = v * Math.PI * 2; return [(R + r * Math.cos(b)) * Math.cos(a), r * Math.sin(b), (R + r * Math.cos(b)) * Math.sin(a)]; });
// A round tube along a polyline (Catmull-Rom smoothed), with parallel-transport frames
function tube(points, r, seg = 64, radial = 10) {
  const cr = t => {
    const n = points.length - 1, x = Math.min(n - 1e-9, t * n), i = Math.floor(x), f = x - i;
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(n, i + 2)];
    return [0, 1, 2].map(k => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * f + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f ** 3));
  };
  const centers = Array.from({length:seg + 1}, (_, i) => cr(i / seg));
  const frames = [];
  let normal = null;
  for (let i = 0; i <= seg; i++) {
    const a = centers[Math.max(0, i - 1)], b = centers[Math.min(seg, i + 1)], t = [0, 1, 2].map(k => b[k] - a[k]), l = Math.hypot(...t), T = t.map(x => x / l);
    if (!normal) normal = Math.abs(T[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const d = normal[0] * T[0] + normal[1] * T[1] + normal[2] * T[2];
    let N = normal.map((x, k) => x - d * T[k]); const nl = Math.hypot(...N); N = N.map(x => x / nl); normal = N;
    const B = [T[1] * N[2] - T[2] * N[1], T[2] * N[0] - T[0] * N[2], T[0] * N[1] - T[1] * N[0]];
    frames.push({N, B});
  }
  return grid(seg, radial, (u, v) => {
    const i = Math.round(u * seg), a = v * Math.PI * 2, {N, B} = frames[i], c = centers[i];
    return [0, 1, 2].map(k => c[k] + r * (Math.cos(a) * N[k] + Math.sin(a) * B[k]));
  });
}
const helix = (R, y0, y1, turns, wire) => tube(Array.from({length:turns * 16 + 1}, (_, i) => { const t = i / (turns * 16), a = t * turns * Math.PI * 2; return [R * Math.cos(a), y0 + (y1 - y0) * t, R * Math.sin(a)]; }), wire, turns * 24, 8);
const rotateZ = (mesh, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1]; p[i] = x * c - y * s; p[i + 1] = x * s + y * c; } return {...mesh, positions:p}; };
const translate = (mesh, [dx, dy, dz]) => { const p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; } return {...mesh, positions:p}; };

// --- The mechanism -----------------------------------------------------------------------------------------------
export function buildMechanism(params = {}) {
  const P = {...DEFAULTS, ...params, valve:{...DEFAULTS.valve, ...params.valve}, venturi:{...DEFAULTS.venturi, ...params.venturi},
    chamber:{...DEFAULTS.chamber, ...params.chamber}, latch:{...DEFAULTS.latch, ...params.latch}, spout:{...DEFAULTS.spout, ...params.spout}};
  const {bore, valve:V, venturi:Q, chamber:C, latch:L, spout:S} = P;
  const parts = [];
  const add = (name, mesh, color, origin = [0, 0, 0], extra = {}) => parts.push({name, mesh, color, origin, ...extra});
  // Main valve: the seat ring, the poppet resting OPEN above it (closing = move down by `open`), a spring that is compressed
  // while the valve is open (morph "extended" = closed), a stem down to the lever
  add('nozzle/seat', torus(V.poppetR * 0.92, bore * 0.16), COLORS.fixed, [V.x, V.seatY, 0]);
  add('nozzle/poppet', lathe([[0, 0.006], [V.poppetR * 0.55, 0.006], [V.poppetR, 0.001], [V.poppetR * 0.7, -0.002], [0, -0.002]]), COLORS.moving, [V.x, V.seatY + V.open, 0]);
  const springBase = V.seatY + V.open + 0.006;
  add('nozzle/spring', helix(V.springR, 0, V.springTop - springBase, V.springTurns, V.springWire), COLORS.spring, [V.x, springBase, 0],
    {morph:{name:'extended', delta:helix(V.springR, -V.open, V.springTop - springBase, V.springTurns, V.springWire)}});
  add('nozzle/stem', cylinder(0.0022, -(V.seatY + V.open - L.plungerBottom) + 0.004, -0.002), COLORS.moving, [V.x, V.seatY + V.open, 0]);
  // Venturi: a ring narrowing the bore to the throat, around the flow axis (x)
  const ring = lathe([[bore, -Q.length / 2], [bore * 0.98, -Q.length / 4], [Q.throat, 0], [bore * 0.98, Q.length / 4], [bore, Q.length / 2], [bore * 1.25, Q.length / 2], [bore * 1.25, -Q.length / 2], [bore, -Q.length / 2]], 40);
  add('nozzle/venturi', rotateZ(ring, -90), COLORS.fixed, [Q.x, 0, 0]);
  // Suction port: a small passage from the throat up to the diaphragm chamber
  add('nozzle/port', cylinder(0.0012, 0, 1), COLORS.tube, [Q.x, Q.throat, 0], {scaleY:C.y - C.h / 2 - Q.throat});
  // Diaphragm chamber (a short cylinder) and the diaphragm at its floor, which flexes UP toward the suction
  add('nozzle/chamber', cylinder(C.r, 0, C.h, 40), COLORS.fixed, [C.x, C.y - C.h / 2, 0]);
  const disc = h => lathe([[0, h], [C.r * 0.5, h * 0.75], [C.r * 0.97, 0], [C.r * 0.97, -0.0012], [0, -0.0012 + h]], 40);
  add('nozzle/diaphragm', disc(0), COLORS.rubber, [C.x, C.y - C.h / 2, 0], {morph:{name:'flex', delta:disc(0.0045)}});
  // Latch: the pin hangs from the diaphragm (moves up with it); two balls lock the plunger; the plunger carries the pivot
  add('nozzle/pin', lathe([[0, 0], [L.pinR, 0], [L.pinR, -0.006], [L.pinR * 1.9, -0.009], [L.pinR * 1.9, -0.015], [L.pinR, -0.018], [L.pinR, -0.03], [0, -0.03]], 20), COLORS.moving, [C.x, C.y - C.h / 2, 0]);
  const ballY = C.y - C.h / 2 - 0.012;
  add('nozzle/ball-1', sphere(L.ballR), COLORS.moving, [C.x - L.plungerR - L.ballR * 0.35, ballY, 0]);
  add('nozzle/ball-2', sphere(L.ballR), COLORS.moving, [C.x + L.plungerR + L.ballR * 0.35, ballY, 0]);
  add('nozzle/plunger', lathe([[0, L.plungerTop - 0.01], [L.plungerR, L.plungerTop - 0.01], [L.plungerR, -0.004], [L.plungerR * 0.8, -0.006], [L.plungerR * 0.8, L.plungerBottom - ballY + 0.004], [0, L.plungerBottom - ballY + 0.004]], 32), COLORS.moving, [C.x, ballY, 0]);
  // The lever's pivot: a cross pin (along z) at the plunger's foot, a child of the plunger so it drops with it
  add('nozzle/pivot', rotateX90(cylinder(0.0025, -0.012, 0.012)), COLORS.moving, [C.x, L.plungerBottom, 0], {parent:'nozzle/plunger'});
  // Sensing tube: from the chamber, down the spout, to the hole near the tip; the hole is a small ring on the spout wall
  const start = [C.x + C.r * 0.8, C.y - C.h / 2, 0];
  add('nozzle/tube', tube([start, ...S.path], S.tubeR), COLORS.tube);
  const tip = S.path.at(-1);
  add('nozzle/hole', torus(S.holeR, S.holeR * 0.35, 24), [0.95, 0.85, 0.55, 1], [tip[0] - 0.006, tip[1] - S.holeDrop, 0]);
  return {params:P, parts};
}
function rotateX90(mesh) { const p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { const y = p[i + 1], z = p[i + 2]; p[i + 1] = -z; p[i + 2] = y; } return {...mesh, positions:p}; }

export async function writeMechanismGlb(file, params = {}) {
  const {parts, params:P} = buildMechanism(params);
  const doc = new Document(), buffer = doc.createBuffer();
  doc.getRoot().getAsset().copyright = 'Hold Up original geometry (tools/models/nozzle-internals.mjs), dedicated to the public domain under CC0 1.0';
  const materials = new Map();
  const material = rgba => { const key = rgba.join(); if (!materials.has(key)) materials.set(key, doc.createMaterial(`m${materials.size}`).setBaseColorFactor(rgba).setRoughnessFactor(0.45).setMetallicFactor(rgba === COLORS.rubber ? 0 : 0.6)); return materials.get(key); };
  const root = doc.createNode('nozzle/internals'), nodes = new Map();
  for (const part of parts) {
    let mesh = part.mesh;
    if (part.scaleY) { const p = mesh.positions.slice(); for (let i = 1; i < p.length; i += 3) p[i] *= part.scaleY; mesh = {...mesh, positions:p}; }
    const positions = new Float32Array(mesh.positions);
    const prim = doc.createPrimitive().setMaterial(material(part.color))
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(positions).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(normalsOf(mesh)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(mesh.indices)).setBuffer(buffer));
    const gltfMesh = doc.createMesh(part.name).addPrimitive(prim);
    if (part.morph) {
      const target = new Float32Array(part.morph.delta.positions.map((v, i) => v - mesh.positions[i]));
      prim.addTarget(doc.createPrimitiveTarget(part.morph.name).setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(target).setBuffer(buffer)));
      gltfMesh.setWeights([0]).setExtras({targetNames:[part.morph.name]});
    }
    const node = doc.createNode(part.name).setMesh(gltfMesh);
    const parent = part.parent ? nodes.get(part.parent) : null;
    const origin = parent ? part.origin.map((v, i) => v - parts.find(p => p.name === part.parent).origin[i]) : part.origin;
    node.setTranslation(origin);
    (parent ?? root).addChild(node);
    nodes.set(part.name, node);
  }
  // Mount socket: the internals' origin, +Z along the flow toward the spout (local +x), +Y up
  root.addChild(doc.createNode('socket/mount').setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]));
  doc.createScene('nozzle internals').addChild(root);
  await new NodeIO().write(file, doc);
  return {parts:parts.map(p => p.name), params:P};
}
