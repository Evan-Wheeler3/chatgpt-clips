import { buildFigure } from './figure.mjs';

/*
 * Geometric checks on a painted vector figure (review assistance; they do not replace watching frames).
 * Joints must sit inside the art that covers them, so nothing detaches or shows a pivot, and limb lengths and
 * head size must not change from frame to frame.
 */
export const REQUIRED_ITEMS = ['forearmF', 'sleeveF', 'cuffF', 'legF', 'bootF', 'legB', 'bootB', 'neck', 'torso', 'straps', 'apron', 'buttons', 'collar',
  'head', 'eyes', 'brows', 'mouth', 'hair', 'brim', 'crown', 'forearmB', 'sleeveB', 'cuffB'];

export function insidePolygon([x, y], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function figureIssues(def, state) {
  const figure = buildFigure(def, state), J = figure.joints;
  const items = Object.fromEntries(figure.items.map(it => [it.id, it]));
  const issues = [];
  for (const id of REQUIRED_ITEMS) if (!items[id]) issues.push({code:'MISSING_PART', message:`${id} is not painted`});
  if (issues.length) return {figure, issues};
  const shape = id => items[id].shapes[0].pts;
  const covered = (label, point, ...ids) => {
    if (!ids.some(id => items[id].shapes.some(s => s.fill && insidePolygon(point, s.pts)))) issues.push({code:'JOINT_GAP', message:`the ${label} is not covered by ${ids.join(' or ')}`});
  };
  for (const side of ['F', 'B']) {
    covered(`shoulder ${side}`, J[`shoulder${side}`], 'torso', 'apron');
    covered(`elbow ${side}`, J[`elbow${side}`], `cuff${side}`);
    covered(`wrist ${side}`, J[`wrist${side}`], `forearm${side}`);
    covered(`hip ${side}`, J[`hip${side}`], 'torso', 'apron');
    covered(`ankle ${side}`, J[`ankle${side}`], `boot${side}`);
  }
  covered('neck base', items.neck.shapes[0].pts[0], 'torso', 'collar', 'apron');
  covered('neck top', items.neck.shapes[0].pts.at(-1), 'head');
  // Hair and cap sit on the head; face features stay on the face
  const head = shape('head');
  if (!shape('hair').some(p => insidePolygon(p, head))) issues.push({code:'DETACHED_PART', message:'the hair does not touch the head'});
  if (!head.some(p => insidePolygon(p, shape('crown')))) issues.push({code:'DETACHED_PART', message:'the cap does not sit on the head'});
  for (const id of ['eyes', 'brows', 'mouth']) for (const s of items[id].shapes) {
    if (!s.pts.every(p => insidePolygon(p, head))) issues.push({code:'FEATURE_OFF_FACE', message:`${id} leaves the face`});
  }
  return {figure, issues};
}

// Lengths that must never change (rig mm): limb segments, neck-to-head distance and head size
export function figureMeasures(figure) {
  const J = figure.joints, head = figure.items.find(it => it.id === 'head').shapes[0].pts, n = head.length;
  return {
    upperArmF:dist(J.shoulderF, J.elbowF), forearmF:dist(J.elbowF, J.wristF), upperArmB:dist(J.shoulderB, J.elbowB), forearmB:dist(J.elbowB, J.wristB),
    thighF:dist(J.hipF, J.kneeF), shinF:dist(J.kneeF, J.ankleF), thighB:dist(J.hipB, J.kneeB), shinB:dist(J.kneeB, J.ankleB),
    neckToHead:dist(J.neck, J.headCenter), headWidth:dist(head[0], head[n / 2]), headHeight:dist(head[n / 4], head[3 * n / 4])
  };
}
