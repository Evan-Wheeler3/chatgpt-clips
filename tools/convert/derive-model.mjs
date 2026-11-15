import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds, prune, dedup } from '@gltf-transform/functions';

/*
 * Derived models: an approved source model adapted by a recorded recipe (tools/providers/derived.mjs), so every change
 * to licensed work is reproducible and listed in the credit ("modified: ..."). Operations, applied in order:
 *   keep:[name | {name, inside, margin}]  keep only these nodes (with subtrees and ancestors); {inside} keeps only matches
 *                       whose centre lies within that node's bounds (packs reuse names, e.g. every car's "Wheel_A")
 *   drop:[names]        remove these nodes and their subtrees
 *   rename:{old:new}    rename nodes (stable part names for animation, e.g. "nozzle/lever")
 *   flatten:{materials?, palette?}  replace textures by one flat colour per UV island (its average texel colour,
 *                       optionally snapped to a palette): removes baked text, stickers and logos, keeps the panel layout
 *   recolor:{material:hex | {color, roughness, metalness}}  set a material's flat colour (textures removed)
 *   emit:{material:hex}             make a material glow (lamps)
 *   scale:k | fit:{axis, length}    uniform scale, or scale so the model's extent along x|y|z equals length (m)
 *   ground:true          move the model so its lowest point is at y = 0;   center:true  centre it on x/z
 * Sockets: named attachment frames stored as empty nodes "socket/<name>" (local +Z = the socket's axis, +Y = up), used to
 * attach props to each other (a spout into a filler neck, a hose to its outlet). Positions are in final model space, so
 * socket operations come after any scale/ground/center:
 *   socket:{name, position, axis, up}                       an explicit frame
 *   socketOnSurface:{name, origin, direction, up, tilt}     raycast the model's triangles from origin along direction;
 *                       the frame sits on the hit, its axis points into the surface, tilted by {deg, toward:[x,y,z]}
 *   socketFromTip:{name, node, along, back, up}             the end of a tube-like part: the tip is the centroid of the
 *                       vertices at the extreme along "along"; the axis runs from the slice "back" metres behind it to the tip
 */
const run = promisify(execFile);
const hexToLinear = hex => { const n = parseInt(hex.replace('#', ''), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => v / 255); return c.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); };
const srgbToLinear = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

async function decodeImage(bytes) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-tex-'));
  try {
    await writeFile(join(dir, 'in'), bytes);
    const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', join(dir, 'in')])).stdout).streams[0];
    const {stdout} = await run('ffmpeg', ['-v', 'error', '-i', join(dir, 'in'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {encoding:'buffer', maxBuffer:256 * 1024 * 1024});
    return {width:probe.width, height:probe.height, data:stdout};
  } finally { await rm(dir, {recursive:true, force:true}); }
}

// Average texel colour per UV island (vertex-connected triangles), in linear RGB, area-weighted over sample points
async function islandColors(prim, texture, cache) {
  if (!cache.has(texture)) cache.set(texture, await decodeImage(texture.getImage()));
  const img = cache.get(texture), uv = prim.getAttribute('TEXCOORD_0'), pos = prim.getAttribute('POSITION');
  const count = pos.getCount(), idx = prim.getIndices()?.getArray() ?? Uint32Array.from({length:count}, (_, i) => i);
  const parent = Int32Array.from({length:count}, (_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  for (let k = 0; k < idx.length; k += 3) { const a = find(idx[k]), b = find(idx[k + 1]), c = find(idx[k + 2]); parent[b] = a; parent[find(c)] = a; }
  const texel = (u, v) => {
    const x = Math.min(img.width - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * img.width))), y = Math.min(img.height - 1, Math.max(0, Math.floor(((v % 1) + 1) % 1 * img.height)));
    const o = (y * img.width + x) * 4; return [img.data[o], img.data[o + 1], img.data[o + 2]].map(c => srgbToLinear(c / 255));
  };
  const sums = new Map(), t = [[], [], []];
  for (let k = 0; k < idx.length; k += 3) {
    for (let j = 0; j < 3; j++) uv.getElement(idx[k + j], t[j]);
    const area = Math.abs((t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[2][0] - t[0][0]) * (t[1][1] - t[0][1])) / 2 + 1e-9;
    const root = find(idx[k]), s = sums.get(root) ?? [0, 0, 0, 0];
    // Centroid plus edge midpoints: enough samples to average out lettering inside a panel
    for (const [w0, w1, w2] of [[1 / 3, 1 / 3, 1 / 3], [0.5, 0.5, 0], [0, 0.5, 0.5], [0.5, 0, 0.5]]) {
      const c = texel(w0 * t[0][0] + w1 * t[1][0] + w2 * t[2][0], w0 * t[0][1] + w1 * t[1][1] + w2 * t[2][1]);
      s[0] += c[0] * area; s[1] += c[1] * area; s[2] += c[2] * area; s[3] += area;
    }
    sums.set(root, s);
  }
  const colorOf = new Map([...sums].map(([r, s]) => [r, [s[0] / s[3], s[1] / s[3], s[2] / s[3]]]));
  return {count, island:i => find(i), colorOf};
}

// --- Socket math -------------------------------------------------------------------------------------------------
const sub = (a, b) => a.map((v, i) => v - b[i]), add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map(v => v * k);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a); if (!l) throw new Error('Zero-length socket vector'); return a.map(v => v / l); };
const applyMatrix = (m, v) => [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]];
// Rodrigues rotation of v about a unit axis k by deg
const rotate = (v, k, deg) => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))); };
// Orthonormal frame from an axis (+Z) and an approximate up (+Y), as a quaternion [x, y, z, w]
export function frameQuaternion(axis, up) {
  const z = norm(axis), y = norm(sub(up, mul(z, dot(up, z)))), x = cross(y, z);
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]], tr = m00 + m11 + m22;
  let q;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  const l = Math.hypot(...q); return q.map(v => v / l);
}
// Every triangle (and every vertex) of a node subtree in model space
function geometryOf(node) {
  const tris = [], verts = [];
  node.traverse(n => {
    const mesh = n.getMesh(); if (!mesh) return;
    const m = n.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), count = pos.getCount(), idx = prim.getIndices()?.getArray() ?? Uint32Array.from({length:count}, (_, i) => i);
      const world = Array.from({length:count}, (_, i) => applyMatrix(m, pos.getElement(i, [])));
      verts.push(...world);
      for (let k = 0; k < idx.length; k += 3) tris.push([world[idx[k]], world[idx[k + 1]], world[idx[k + 2]]]);
    }
  });
  return {tris, verts};
}
// Möller–Trumbore: nearest hit along a ray, with the triangle's normal facing the ray origin
function raycast(tris, origin, dir) {
  let best = null;
  for (const [a, b, c] of tris) {
    const e1 = sub(b, a), e2 = sub(c, a), p = cross(dir, e2), det = dot(e1, p);
    if (Math.abs(det) < 1e-12) continue;
    const t0 = sub(origin, a), u = dot(t0, p) / det; if (u < 0 || u > 1) continue;
    const q = cross(t0, e1), v = dot(dir, q) / det; if (v < 0 || u + v > 1) continue;
    const t = dot(e2, q) / det;
    if (t > 1e-6 && (!best || t < best.t)) { let n = norm(cross(e1, e2)); if (dot(n, dir) > 0) n = mul(n, -1); best = {t, point:add(origin, mul(dir, t)), normal:n}; }
  }
  return best;
}
function addSocket(doc, scene, name, position, axis, up) {
  const node = doc.createNode(`socket/${name}`).setTranslation(position).setRotation(frameQuaternion(axis, up));
  scene.addChild(node);
  return node;
}

const nearest = (c, palette) => palette.reduce((best, p) => { const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2; return d < best.d ? {d, p} : best; }, {d:Infinity, p:c}).p;

export async function deriveModel(sourceGlb, ops) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  io.setLogger(new Logger(Logger.Verbosity.ERROR));
  const doc = await io.read(sourceGlb), root = doc.getRoot(), scene = root.getDefaultScene() ?? root.listScenes()[0];
  doc.setLogger(new Logger(Logger.Verbosity.ERROR));
  const byName = name => root.listNodes().filter(n => n.getName() === name);
  const log = [];
  for (const op of ops) {
    if (op.keep) {
      const keep = new Set();
      for (const entry of op.keep) {
        const name = typeof entry === 'string' ? entry : entry.name;
        let found = byName(name);
        if (entry.inside) {
          const ref = byName(entry.inside)[0]; if (!ref) throw new Error(`keep: no node "${entry.inside}"`);
          const b = getBounds(ref), m = entry.margin ?? 0.3;
          found = found.filter(n => { const nb = getBounds(n); return [0, 1, 2].every(i => { const c = (nb.min[i] + nb.max[i]) / 2; return c >= b.min[i] - m && c <= b.max[i] + m; }); });
        }
        if (!found.length) throw new Error(`keep: no node "${name}"${entry.inside ? ` inside "${entry.inside}"` : ''}`);
        for (const n of found) { n.traverse(c => keep.add(c)); for (let p = n.getParentNode(); p; p = p.getParentNode()) keep.add(p); }
      }
      for (const n of root.listNodes()) if (!keep.has(n)) n.dispose();
      log.push(`kept ${op.keep.map(e => typeof e === 'string' ? e : e.name).join(', ')}`);
    } else if (op.drop) {
      for (const name of op.drop) { const found = byName(name); if (!found.length) throw new Error(`drop: no node "${name}"`); for (const n of found) n.traverse(c => c.dispose()); }
      log.push(`removed ${op.drop.join(', ')}`);
    } else if (op.rename) {
      for (const [from, to] of Object.entries(op.rename)) { const found = byName(from); if (found.length !== 1) throw new Error(`rename: ${found.length} nodes named "${from}"`); found[0].setName(to); }
      log.push('renamed parts');
    } else if (op.flatten) {
      const palette = op.flatten.palette?.map(hexToLinear) ?? null, cache = new Map();
      for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
        const m = prim.getMaterial(), tex = m?.getBaseColorTexture();
        if (!tex || !prim.getAttribute('TEXCOORD_0') || (op.flatten.materials && !op.flatten.materials.includes(m.getName()))) continue;
        const {count, island, colorOf} = await islandColors(prim, tex, cache);
        const colors = new Float32Array(count * 4), factor = m.getBaseColorFactor();
        for (let i = 0; i < count; i++) { let c = colorOf.get(island(i)) ?? [0.5, 0.5, 0.5]; c = c.map((v, k) => v * factor[k]); if (palette) c = nearest(c, palette); colors.set([...c, 1], i * 4); }
        prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC4').setArray(colors).setBuffer(root.listBuffers()[0]));
        const flat = m.clone().setName(`${m.getName()}-flat`).setBaseColorTexture(null).setBaseColorFactor([1, 1, 1, 1]).setNormalTexture(null)
          .setEmissiveTexture(null).setOcclusionTexture(null).setMetallicRoughnessTexture(null).setMetallicFactor(0).setRoughnessFactor(op.flatten.roughness ?? 0.65);
        prim.setMaterial(flat);
      }
      log.push(`textures flattened to one colour per UV island${palette ? ' (Hold Up palette)' : ''}`);
    } else if (op.recolor) {
      for (const [name, spec] of Object.entries(op.recolor)) {
        const {color:hex, roughness = 0.75, metalness = 0} = typeof spec === 'string' ? {color:spec} : spec;
        const found = root.listMaterials().filter(m => m.getName() === name); if (!found.length) throw new Error(`recolor: no material "${name}"`);
        // Emissive maps too: glowing signage (stripes, logos) lives there on some models
        for (const m of found) m.setBaseColorTexture(null).setBaseColorFactor([...hexToLinear(hex), 1]).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]).setMetallicFactor(metalness).setRoughnessFactor(roughness); // Painted, not metal unless asked
      }
      log.push(`recoloured ${Object.keys(op.recolor).join(', ')}`);
    } else if (op.emit) {
      for (const [name, hex] of Object.entries(op.emit)) {
        const found = root.listMaterials().filter(m => m.getName() === name); if (!found.length) throw new Error(`emit: no material "${name}"`);
        for (const m of found) m.setBaseColorTexture(null).setEmissiveTexture(null).setBaseColorFactor([...hexToLinear(hex), 1]).setEmissiveFactor(hexToLinear(hex));
      }
      log.push(`emissive ${Object.keys(op.emit).join(', ')}`);
    } else if (op.scale || op.fit || op.ground || op.center) {
      // Wrap the scene content in one transform node, so part names and their local transforms stay intact
      const wrapper = doc.createNode('holdup-adapt');
      for (const child of scene.listChildren()) { scene.removeChild(child); wrapper.addChild(child); }
      scene.addChild(wrapper);
      let k = op.scale ?? 1;
      if (op.fit) { const b = getBounds(wrapper), axis = {x:0, y:1, z:2}[op.fit.axis]; k = op.fit.length / (b.max[axis] - b.min[axis]); }
      wrapper.setScale([k, k, k]);
      const b = getBounds(wrapper);
      wrapper.setTranslation([op.center ? -(b.min[0] + b.max[0]) / 2 : 0, op.ground ? -b.min[1] : 0, op.center ? -(b.min[2] + b.max[2]) / 2 : 0]);
      log.push(`scaled ×${k.toPrecision(4)}${op.ground ? ', grounded' : ''}${op.center ? ', centred' : ''}`);
    } else if (op.socket) {
      const {name, position, axis, up = [0, 1, 0]} = op.socket;
      addSocket(doc, scene, name, position, axis, up);
      log.push(`socket ${name}`);
    } else if (op.socketOnSurface) {
      const {name, origin, direction, up = [0, 1, 0], tilt = null} = op.socketOnSurface;
      const hit = raycast(geometryOf(scene).tris, origin, norm(direction));
      if (!hit) throw new Error(`socketOnSurface ${name}: the ray from ${origin} hits nothing`);
      let axis = mul(hit.normal, -1); // Into the surface
      if (tilt) { const side = norm(cross(axis, tilt.toward)); axis = norm(rotate(axis, side, tilt.deg)); }
      addSocket(doc, scene, name, hit.point.map(v => Math.round(v * 1e5) / 1e5), axis, up);
      log.push(`socket ${name} on the surface`);
    } else if (op.socketFromTip) {
      const {name, node:partName, along, back = 0.05, up = [0, 1, 0]} = op.socketFromTip;
      const part = byName(partName)[0]; if (!part) throw new Error(`socketFromTip: no node "${partName}"`);
      const {verts} = geometryOf(part), dir = norm(along), proj = verts.map(v => dot(v, dir)), extreme = Math.max(...proj);
      const centroid = sel => [0, 1, 2].map(i => sel.reduce((s, v) => s + v[i], 0) / sel.length);
      const tipVerts = verts.filter((v, i) => proj[i] > extreme - 0.004), backVerts = verts.filter((v, i) => Math.abs(proj[i] - (extreme - back)) < 0.004);
      if (!tipVerts.length || !backVerts.length) throw new Error(`socketFromTip ${name}: not enough geometry near the tip`);
      const tip = centroid(tipVerts), axis = norm(sub(tip, centroid(backVerts)));
      addSocket(doc, scene, name, tip.map(v => Math.round(v * 1e5) / 1e5), axis, up);
      log.push(`socket ${name} at the tip of ${partName}`);
    } else throw new Error(`Unknown derive operation: ${JSON.stringify(op)}`);
  }
  await doc.transform(prune({keepAttributes:true, keepLeaves:true}), dedup());
  return {bytes:await io.writeBinary(doc), log, sha256:createHash('sha256').update(await readFile(sourceGlb)).digest('hex')};
}
