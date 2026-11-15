import { Matrix4, Quaternion, Vector3, Euler, MathUtils, Plane } from 'three';

// Socket and hole maths shared by Node (compile, contact checks) and the browser renderer. Sockets are model-space frames
// ("socket/<name>" nodes: +Z axis, +Y up); `world` is the prop's matrix (its live group matrix in the browser).
export function propMatrix(prop) {
  return new Matrix4().compose(new Vector3(...prop.base.position), new Quaternion().setFromEuler(new Euler(...prop.base.rotation.map(MathUtils.degToRad), 'XYZ')),
    new Vector3().setScalar(prop.base.scale ?? 1));
}
export function socketMatrix(prop, name) {
  const s = prop.sockets?.[name];
  if (!s) throw new Error(`Prop ${prop.id} has no socket "${name}"${prop.sockets ? ` (${Object.keys(prop.sockets).join(', ') || 'none'})` : ''}`);
  return new Matrix4().compose(new Vector3(...s.position), new Quaternion(...s.quaternion), new Vector3(1, 1, 1));
}
// A socket's world frame: position, axis (+Z), up (+Y)
export function socketFrame(prop, name, world = propMatrix(prop)) {
  const m = world.clone().multiply(socketMatrix(prop, name)), p = new Vector3(), q = new Quaternion(), s = new Vector3();
  m.decompose(p, q, s);
  return {matrix:m, position:p.toArray(), axis:new Vector3(0, 0, 1).applyQuaternion(q).toArray(), up:new Vector3(0, 1, 0).applyQuaternion(q).toArray()};
}

// Clip planes for a prop's hole (world space): the box interior is cut away (material.clipIntersection = true)
export function holePlanes(prop, hole, world = propMatrix(prop)) {
  const f = world.clone().multiply(socketMatrix(prop, hole.socket)), [w, h] = hole.size, z0 = hole.from ?? -0.03, z1 = hole.to ?? 0.08;
  return [[1, 0, 0, -w / 2], [-1, 0, 0, -w / 2], [0, 1, 0, -h / 2], [0, -1, 0, -h / 2], [0, 0, 1, -z1], [0, 0, -1, z0]]
    .map(([x, y, z, c]) => new Plane(new Vector3(x, y, z), c).applyMatrix4(f));
}
