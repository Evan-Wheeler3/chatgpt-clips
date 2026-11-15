import { Document, NodeIO } from '@gltf-transform/core';
import { lathe, normalsOf } from './nozzle-internals.mjs';

/*
 * A car's fuel-filler assembly as original parametric geometry (Hold Up, dedicated CC0): a bezel on the body panel, a
 * recessed pocket, a hollow filler neck angled down into the car with a dark opening, and an open fuel door.
 * Frame ("mount"): origin on the panel surface at the pocket centre, +Z into the car (the panel's inward normal), +Y up.
 * The car's body is opened behind the pocket by a clip box (story prop "holes"), so the recess is real, not painted.
 * Sockets: "mount" (attach this to the car's panel socket) and "neck" (the opening a nozzle spout enters, on the neck axis).
 */
export const VERSION = 1;
export const DEFAULTS = {pocket:0.13, bezel:0.018, depth:0.045, neckR:0.026, neckLength:0.09, neckTilt:25, mouthR:0.02, door:0.128, doorOpen:70}; // doorOpen > 0 swings the door out of the car (real fuel doors open about 70-90°)
export const PARTS = ['filler/bezel', 'filler/pocket', 'filler/neck', 'filler/opening', 'filler/collar', 'filler/door'];
const COLORS = {body:[0.22, 0.31, 0.42, 1], pocket:[0.16, 0.17, 0.19, 1], neck:[0.33, 0.34, 0.36, 1], opening:[0.01, 0.01, 0.012, 1], collar:[0.62, 0.64, 0.67, 1], door:[0.22, 0.31, 0.42, 1]};

// Axis-aligned box mesh (min, max) with flat normals per face
function box(min, max) {
  const [x0, y0, z0] = min, [x1, y1, z1] = max, positions = [], indices = [];
  const faces = [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]],
    [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]];
  for (const f of faces) { const b = positions.length / 3; positions.push(...f.flat()); indices.push(b, b + 1, b + 2, b, b + 2, b + 3); }
  return {positions, indices, flat:true};
}
const translate = (mesh, [x, y, z]) => { const p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { p[i] += x; p[i + 1] += y; p[i + 2] += z; } return {...mesh, positions:p}; };
const merge = meshes => { const positions = [], indices = []; for (const m of meshes) { const b = positions.length / 3; positions.push(...m.positions); indices.push(...m.indices.map(i => i + b)); } return {positions, indices, flat:meshes.every(m => m.flat)}; };
// Rotate a mesh about X by deg (neck tilt), then translate
const rotX = (mesh, deg, [tx, ty, tz] = [0, 0, 0]) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { const y = p[i + 1], z = p[i + 2]; p[i] += tx; p[i + 1] = y * c - z * s + ty; p[i + 2] = y * s + z * c + tz; } return {...mesh, positions:p}; };
// Lathe meshes run along Y; turn them to run along +Z
const yToZ = mesh => { const p = mesh.positions.slice(); for (let i = 0; i < p.length; i += 3) { const y = p[i + 1], z = p[i + 2]; p[i + 1] = -z; p[i + 2] = y; } return {...mesh, positions:p}; };
// Face normals for flat-shaded boxes (shared vertices would smooth the edges)
function flatNormals(mesh) {
  const n = new Float32Array(mesh.positions.length), p = mesh.positions;
  for (let k = 0; k < mesh.indices.length; k += 3) {
    const [a, b, c] = [mesh.indices[k], mesh.indices[k + 1], mesh.indices[k + 2]].map(i => i * 3);
    const u = [0, 1, 2].map(x => p[b + x] - p[a + x]), v = [0, 1, 2].map(x => p[c + x] - p[a + x]);
    const f = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...f) || 1;
    for (const i of [a, b, c]) for (let x = 0; x < 3; x++) n[i + x] = f[x] / l;
  }
  return n;
}

export function buildFiller(params = {}) {
  const P = {...DEFAULTS, ...params}, h = P.pocket / 2, o = h + P.bezel, d = P.depth, t = P.neckTilt;
  const parts = [];
  // Bezel: a raised frame on the panel (slightly outside it, z < 0) that hides the cut edge of the body
  parts.push({name:'filler/bezel', color:COLORS.body, mesh:merge([box([-o, h, -0.004], [o, o, 0.002]), box([-o, -o, -0.004], [o, -h, 0.002]), box([-o, -h, -0.004], [-h, h, 0.002]), box([h, -h, -0.004], [o, h, 0.002])])});
  // Pocket: four inner walls and a back wall, recessed into the car
  const w = 0.003;
  parts.push({name:'filler/pocket', color:COLORS.pocket, mesh:merge([box([-h, h - w, 0], [h, h, d]), box([-h, -h, 0], [h, -h + w, d]), box([-h, -h, 0], [-h + w, h, d]), box([h - w, -h, 0], [h, h, d]), box([-h, -h, d], [h, h, d + w])])});
  // Neck: a hollow tube from the back wall, tilted down into the car; a dark opening disc just inside its mouth
  const tube = yToZ(lathe([[P.neckR, 0], [P.neckR, P.neckLength], [P.mouthR, P.neckLength], [P.mouthR, 0], [P.neckR, 0]], 32));
  // The neck starts behind the back wall (nothing protrudes); the visible opening is a dark disc flush on the wall with a
  // light collar, so a spout reads as going through the middle of the hole
  parts.push({name:'filler/neck', color:COLORS.neck, mesh:rotX(tube, t, [0, 0, d + w])});
  const disc = yToZ(lathe([[0, -0.0004], [P.mouthR * 1.1, -0.0004], [P.mouthR * 1.1, 0], [0, 0]], 40));
  parts.push({name:'filler/opening', color:COLORS.opening, mesh:translate(disc, [0, 0, d - 0.0006])});
  const collar = yToZ(lathe([[P.mouthR * 1.1, -0.0012], [P.mouthR * 1.45, -0.0012], [P.mouthR * 1.45, 0], [P.mouthR * 1.1, 0]], 40));
  parts.push({name:'filler/collar', color:COLORS.collar, mesh:translate(collar, [0, 0, d - 0.0004])});
  // Door: hinged at its front edge (-X, toward the car's front), swung open outward
  const s = P.door / 2;
  parts.push({name:'filler/door', color:COLORS.door, mesh:box([0, -s, -0.006], [P.door, s, -0.001]), origin:[-o + 0.004, 0, -0.004], rotationY:P.doorOpen});
  // Neck socket: at the mouth on the neck axis (+Z along the neck, +Y perpendicular, up-ish)
  const a = t * Math.PI / 180;
  const sockets = {mount:{position:[0, 0, 0], axis:[0, 0, 1], up:[0, 1, 0]},
    neck:{position:[0, 0, d - 0.002], axis:[0, -Math.sin(a), Math.cos(a)], up:[0, Math.cos(a), Math.sin(a)]}};
  return {params:P, parts, sockets};
}

function quatFrom(axis, up) {
  const z = axis, x = [up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]], y = up;
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], tr = m00 + m11 + m22;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
}

export async function writeFillerGlb(file, params = {}) {
  const {parts, params:P, sockets} = buildFiller(params);
  const doc = new Document(), buffer = doc.createBuffer();
  doc.getRoot().getAsset().copyright = 'Hold Up original geometry (tools/models/fuel-filler.mjs), dedicated to the public domain under CC0 1.0';
  const root = doc.createNode('filler/assembly');
  for (const part of parts) {
    const prim = doc.createPrimitive().setMaterial(doc.createMaterial(part.name).setBaseColorFactor(part.color).setRoughnessFactor(0.55).setMetallicFactor(0))
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(part.mesh.positions)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(part.mesh.flat ? flatNormals(part.mesh) : normalsOf(part.mesh)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(part.mesh.indices)).setBuffer(buffer));
    const node = doc.createNode(part.name).setMesh(doc.createMesh(part.name).addPrimitive(prim));
    if (part.origin) node.setTranslation(part.origin);
    if (part.rotationY) { const a = part.rotationY * Math.PI / 360; node.setRotation([0, Math.sin(a), 0, Math.cos(a)]); }
    root.addChild(node);
  }
  for (const [name, s] of Object.entries(sockets)) root.addChild(doc.createNode(`socket/${name}`).setTranslation(s.position).setRotation(quatFrom(s.axis, s.up)));
  doc.createScene('fuel filler').addChild(root);
  await new NodeIO().write(file, doc);
  return {parts:parts.map(p => p.name), params:P, sockets:Object.keys(sockets)};
}
