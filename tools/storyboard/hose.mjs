/*
 * A flexible hose between two socket frames, shared by Node validation and the browser renderer (plain arrays, no
 * dependencies), so the hose that is checked is exactly the hose that is drawn. The curve is a cubic Bezier that leaves
 * each end along its socket axis, with a sag (slack) that pulls the middle down like a hanging hose.
 */
const add = (a, b) => a.map((v, i) => v + b[i]), mul = (a, k) => a.map(v => v * k), sub = (a, b) => a.map((v, i) => v - b[i]);
const len = a => Math.hypot(...a);

export function hoseControls(from, to, {slack = 0.35, lead = 0.35} = {}) {
  const span = len(sub(to.position, from.position));
  const reach = Math.max(0.15, span * lead), sag = [0, -span * slack, 0];
  return [from.position, add(add(from.position, mul(from.axis, reach)), sag), add(add(to.position, mul(to.axis, reach)), sag), to.position];
}

export function hosePoints(from, to, options = {}, samples = 48) {
  const [p0, p1, p2, p3] = hoseControls(from, to, options);
  return Array.from({length:samples + 1}, (_, i) => {
    const t = i / samples, u = 1 - t;
    return [0, 1, 2].map(k => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
}
