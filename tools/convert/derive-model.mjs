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
 *   recolor:{material:hex}          set a material's flat colour (textures removed)
 *   emit:{material:hex}             make a material glow (lamps)
 *   scale:k | fit:{axis, length}    uniform scale, or scale so the model's extent along x|y|z equals length (m)
 *   ground:true          move the model so its lowest point is at y = 0;   center:true  centre it on x/z
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
      for (const [name, hex] of Object.entries(op.recolor)) {
        const found = root.listMaterials().filter(m => m.getName() === name); if (!found.length) throw new Error(`recolor: no material "${name}"`);
        // Emissive maps too: glowing signage (stripes, logos) lives there on some models
        for (const m of found) m.setBaseColorTexture(null).setBaseColorFactor([...hexToLinear(hex), 1]).setNormalTexture(null).setMetallicRoughnessTexture(null).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]).setMetallicFactor(0).setRoughnessFactor(0.75); // Painted, not metal
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
    } else throw new Error(`Unknown derive operation: ${JSON.stringify(op)}`);
  }
  await doc.transform(prune({keepAttributes:true, keepLeaves:false}), dedup());
  return {bytes:await io.writeBinary(doc), log, sha256:createHash('sha256').update(await readFile(sourceGlb)).digest('hex')};
}
