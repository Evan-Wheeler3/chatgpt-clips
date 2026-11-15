import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Bounds plus the model's extreme vertices in 2048 directions: a silhouette proxy that frames and grounds
// round objects correctly from any angle, where an axis-aligned box would overestimate them. 96 directions
// let a rolling barrel sink up to 17 mm into the floor; 2048 keeps the error near 0.1 mm
export async function readGlbShape(path, directions = 2048) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR)).read(path);
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const {min, max} = getBounds(scene);
  const vertices = [];
  scene.traverse(node => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let i = 0, p = [0, 0, 0]; i < position.getCount(); i++) {
        position.getElement(i, p);
        vertices.push([m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]);
      }
    }
  });
  const picked = new Set();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < directions; k++) {
    const y = 1 - (k + 0.5) * 2 / directions, r = Math.sqrt(1 - y * y);
    const d = [Math.cos(golden * k) * r, y, Math.sin(golden * k) * r];
    let best = 0, bestDot = -Infinity;
    vertices.forEach((v, i) => { const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; if (dot > bestDot) { bestDot = dot; best = i; } });
    picked.add(best);
  }
  const round = value => Math.round(value * 1e4) / 1e4;
  // Node names, so stories can animate named parts (and the compiler can reject parts the model does not have)
  const nodes = [], sockets = {};
  scene.traverse(node => {
    if (node.getName()) nodes.push(node.getName());
    // Attachment frames ("socket/<name>"): model-space position and orientation (+Z axis, +Y up)
    if (node.getName().startsWith('socket/')) sockets[node.getName().slice(7)] = {position:node.getWorldTranslation().map(round), quaternion:node.getWorldRotation()};
  });
  return {min, max, points:[...picked].sort((a, b) => a - b).map(i => vertices[i].map(round)), nodes, sockets};
}

// Silhouette extraction costs ~0.2 s per GLB; cache it by the GLB's own SHA-256 so storyboard iteration stays fast
export async function cachedShape(path, sha, cacheDir = resolve(root, '.cache/shapes')) {
  const file = sha ? join(cacheDir, `${sha}-v3.json`) : null; // v2: node names; v3: sockets
  if (file) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* Not cached yet */ }
  }
  const shape = await readGlbShape(path);
  if (file) {
    await mkdir(cacheDir, {recursive:true});
    await writeFile(file, JSON.stringify(shape));
  }
  return shape;
}
