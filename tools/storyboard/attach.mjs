import { Matrix4, Quaternion, Vector3, Euler, MathUtils, Triangle } from 'three';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { hosePoints } from './hose.mjs';
import { propMatrix, socketMatrix, socketFrame, holePlanes } from './sockets.mjs';
export { propMatrix, socketMatrix, socketFrame, holePlanes };

/*
 * Physical attachment between props, through named sockets stored in the models ("socket/<name>": +Z axis, +Y up).
 *   prop.attach: {to, socket, via, depth}   place this prop so its `via` socket sits on the host's `socket`, pushed
 *                                           `depth` metres along the host socket's axis (a spout into a filler neck)
 *   prop.holes: [{socket, size:[w, h], from, to}]  open the prop's surface in a box around a socket (the filler pocket):
 *                                           x in ±w/2, y in ±h/2, z (along the socket axis) from `from` to `to`
 * Positions are computed from the sockets, never typed in. Contacts are then checked against the real triangles:
 * alignment, insertion depth, orientation, no intersection with the host body outside its opening, hose attachment.
 */
export const CONTACT_LIMITS = {maxAngleDeg:3, depth:[0.03, 0.12], minUp:0.2, hoseClearance:0.008, hoseFreeNearEnds:0.12};
const round = v => Math.round(v * 1e5) / 1e5;

// Resolve every prop.attach into base position/rotation (hosts first; cycles and missing hosts are reported)
export function resolveAttachments(props) {
  const byId = new Map(props.map(p => [p.id, p])), state = new Map(), unresolved = [];
  const resolve = prop => {
    if (!prop.attach || state.get(prop.id) === 'done') return true;
    if (state.get(prop.id) === 'visiting') throw new Error(`Attachment cycle at prop ${prop.id}`);
    state.set(prop.id, 'visiting');
    const host = byId.get(prop.attach.to);
    if (!host) throw new Error(`Prop ${prop.id} attaches to unknown prop "${prop.attach.to}"`);
    if (prop.missing || host.missing || !resolve(host)) { unresolved.push({prop:prop.id, to:host.id, reason:prop.missing ? 'prop asset missing' : 'host asset missing'}); state.set(prop.id, 'done'); return false; }
    const target = propMatrix(host).multiply(socketMatrix(host, prop.attach.socket)).multiply(new Matrix4().makeTranslation(0, 0, prop.attach.depth ?? 0));
    const scale = prop.base.scale ?? 1, local = new Matrix4().makeScale(scale, scale, scale).multiply(socketMatrix(prop, prop.attach.via));
    const m = target.multiply(local.invert()), p = new Vector3(), q = new Quaternion(), s = new Vector3();
    m.decompose(p, q, s);
    prop.base.position = p.toArray().map(round);
    prop.base.rotation = new Euler().setFromQuaternion(q, 'XYZ').toArray().slice(0, 3).map(r => round(MathUtils.radToDeg(r)));
    prop.base.grounded = false;
    state.set(prop.id, 'done');
    return true;
  };
  for (const prop of props) resolve(prop);
  return unresolved;
}

const insideAll = (planes, p) => planes.every(pl => pl.distanceToPoint(p) < 0);

// --- Triangle geometry (Node) --------------------------------------------------------------------------------------
const triangleCache = new Map();
export async function readTriangles(path) {
  if (triangleCache.has(path)) return triangleCache.get(path);
  const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR)).read(path);
  const tris = [];
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), count = pos.getCount(), idx = prim.getIndices()?.getArray() ?? Uint32Array.from({length:count}, (_, i) => i);
      const v = Array.from({length:count}, (_, i) => new Vector3(...pos.getElement(i, [])).applyMatrix4(m));
      for (let k = 0; k < idx.length; k += 3) tris.push([v[idx[k]], v[idx[k + 1]], v[idx[k + 2]], node.getName()]);
    }
  }
  triangleCache.set(path, tris);
  return tris;
}
// Segment-triangle intersection point (or null)
function segmentHit(a, b, [p, q, r]) {
  const dir = b.clone().sub(a), e1 = q.clone().sub(p), e2 = r.clone().sub(p), h = dir.clone().cross(e2), det = e1.dot(h);
  if (Math.abs(det) < 1e-12) return null;
  const s = a.clone().sub(p), u = s.dot(h) / det; if (u < 0 || u > 1) return null;
  const qv = s.clone().cross(e1), v = dir.dot(qv) / det; if (v < 0 || u + v > 1) return null;
  const t = e2.dot(qv) / det;
  return t >= 0 && t <= 1 ? a.clone().addScaledVector(dir, t) : null;
}
// Points where two triangle sets cross (edges of each against faces of the other), skipping points inside `exclude`
function crossings(A, B, exclude) {
  const hits = [];
  const box = tri => { const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity); for (const v of tri.slice(0, 3)) { mn.min(v); mx.max(v); } return [mn, mx]; };
  const bb = B.map(box);
  for (const ta of A) {
    const [amn, amx] = box(ta);
    B.forEach((tb, j) => {
      const [bmn, bmx] = bb[j];
      if (amx.x < bmn.x || amn.x > bmx.x || amx.y < bmn.y || amn.y > bmx.y || amx.z < bmn.z || amn.z > bmx.z) return;
      for (const [x, y] of [[0, 1], [1, 2], [2, 0]]) {
        for (const [s0, s1, tri] of [[ta[x], ta[y], tb], [tb[x], tb[y], ta]]) {
          const p = segmentHit(s0, s1, tri);
          if (p && !(exclude && insideAll(exclude, p))) hits.push(p);
        }
      }
    });
  }
  return hits;
}
// Triangles whose closest point is near the centre (large low-poly panels have every vertex far away)
const near = (tris, center, radius) => { const q = new Vector3(); return tris.filter(([a, b, c]) => new Triangle(a, b, c).closestPointToPoint(center, q).distanceTo(center) < radius); };
const worldTris = (tris, m) => tris.map(([a, b, c, n]) => [a.clone().applyMatrix4(m), b.clone().applyMatrix4(m), c.clone().applyMatrix4(m), n]);
function pointTriangleDistance(p, [a, b, c]) { const t = new Triangle(a, b, c), q = new Vector3(); t.closestPointToPoint(p, q); return q.distanceTo(p); }

// All contact checks for the compiled props and hose effects; `pathOf(prop)` gives a prop's GLB path
export async function checkContacts(props, effects, pathOf, limits = CONTACT_LIMITS) {
  const byId = new Map(props.map(p => [p.id, p])), contacts = [];
  for (const prop of props.filter(p => p.attach && !p.missing && !byId.get(p.attach.to)?.missing)) {
    const host = byId.get(prop.attach.to), hostFrame = socketFrame(host, prop.attach.socket), via = socketFrame(prop, prop.attach.via);
    const angle = MathUtils.radToDeg(new Vector3(...via.axis).angleTo(new Vector3(...hostFrame.axis)));
    const depth = new Vector3(...via.position).sub(new Vector3(...hostFrame.position)).dot(new Vector3(...hostFrame.axis));
    // Orientation: the model's own up (+Y) in the world, not the attaching socket's (which is aligned by construction)
    const modelUp = new Vector3(0, 1, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(...prop.base.rotation.map(MathUtils.degToRad), 'XYZ')));
    const up = modelUp.y, range = prop.attach.depthRange ?? limits.depth;
    const result = {kind:'attach', prop:prop.id, to:host.id, socket:prop.attach.socket, via:prop.attach.via, angleDeg:round(angle), depthM:round(depth), depthRange:range, up:round(up), intersections:[]};
    // The body this prop must not cut through (e.g. the car under a filler): the host chain's props listed in clearOf
    for (const bodyId of prop.attach.clearOf ?? []) {
      const body = byId.get(bodyId);
      if (!body || body.missing) continue;
      const center = new Vector3(...hostFrame.position), radius = 0.6;
      const A = near(worldTris(await readTriangles(pathOf(prop)), propMatrix(prop)), center, radius);
      const B = near(worldTris(await readTriangles(pathOf(body)), propMatrix(body)), center, radius);
      const exclude = (body.holes ?? []).length ? holePlanes(body, body.holes[0]) : null;
      const hits = crossings(A, B, exclude);
      result.intersections.push({body:bodyId, count:hits.length, sample:hits.slice(0, 3).map(h => h.toArray().map(round))});
    }
    result.pass = angle <= limits.maxAngleDeg && depth >= range[0] && depth <= range[1] && up >= limits.minUp && result.intersections.every(i => i.count === 0);
    contacts.push(result);
  }
  for (const effect of effects.filter(e => e.type === 'hose')) {
    const {from, to} = effect.params, a = byId.get(from.prop), b = byId.get(to.prop);
    if (!a || !b) throw new Error(`Hose ${effect.id}: unknown prop`);
    if (a.missing || b.missing) { contacts.push({kind:'hose', effect:effect.id, pass:false, unresolved:true}); continue; }
    const fa = socketFrame(a, from.socket), fb = socketFrame(b, to.socket);
    const points = hosePoints(fa, fb, effect.params).map(p => new Vector3(...p));
    const ends = [points[0].distanceTo(new Vector3(...fa.position)), points.at(-1).distanceTo(new Vector3(...fb.position))];
    const radius = effect.params.radius ?? 0.011, clear = [];
    for (const bodyId of effect.params.clearOf ?? []) {
      const body = byId.get(bodyId); if (!body || body.missing) continue;
      const tris = worldTris(await readTriangles(pathOf(body)), propMatrix(body));
      let min = Infinity, at = null;
      for (const p of points) {
        if (p.distanceTo(points[0]) < limits.hoseFreeNearEnds || p.distanceTo(points.at(-1)) < limits.hoseFreeNearEnds) continue;
        for (const t of tris) { const d = pointTriangleDistance(p, t); if (d < min) { min = d; at = p; } }
      }
      clear.push({body:bodyId, minDistanceM:round(min - radius), at:at?.toArray().map(round) ?? null});
    }
    const lowest = Math.min(...points.map(p => p.y)) - radius;
    contacts.push({kind:'hose', effect:effect.id, endGapsM:ends.map(round), lowestM:round(lowest), clearance:clear,
      pass:ends.every(d => d < 1e-4) && lowest >= -1e-3 && clear.every(c => c.minDistanceM >= limits.hoseClearance)});
  }
  return contacts;
}
