/*
 * Vector figure for 'vector-2d' characters: forward kinematics from the shared pose state (tools/storyboard/character.mjs)
 * to a display list in rig millimetres (x is the facing direction, y up, feet at 0). Pure, so the browser paints it
 * and tests inspect exactly what is painted.
 *
 * Each limb chain is one outlined group: every outline in the group is stroked before any fill, so the joints inside
 * a chain have no seams and no doubled lines. Design lines (sleeve ends, cuffs, boot tops) are separate groups on top.
 */
const rad = d => d * Math.PI / 180;
const rot = ([x, y], deg) => { const t = rad(deg), c = Math.cos(t), s = Math.sin(t); return [x * c - y * s, x * s + y * c]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
// Limb direction: 0 hangs straight down, positive swings toward the facing direction
const along = (p, deg, len) => [p[0] + Math.sin(rad(deg)) * len, p[1] - Math.cos(rad(deg)) * len];

export function chaikin(points, iterations = 2, closed = true) {
  let pts = points;
  for (let k = 0; k < iterations; k++) {
    const out = [];
    const n = closed ? pts.length : pts.length - 1;
    if (!closed) out.push(pts[0]);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) out.push(pts.at(-1));
    pts = out;
  }
  return pts;
}

export function ellipse(cx, cy, rx, ry, tilt = 0, n = 48, shape = null) {
  return Array.from({length:n}, (_, i) => {
    const t = i / n * Math.PI * 2;
    const [x, y] = shape ? shape(t) : [Math.cos(t) * rx, Math.sin(t) * ry];
    return add([cx, cy], rot([x, y], tilt));
  });
}

// An arched stroke (brows, smiles, frowns): `bend` > 0 bows upward
const arc = (cx, cy, w, bend, tilt = 0, n = 9) => Array.from({length:n}, (_, i) => {
  const u = i / (n - 1) * 2 - 1;
  return add([cx, cy], rot([u * w / 2, bend * (1 - u * u)], tilt));
});

// A curly outline: an ellipse whose edge is a run of round bumps
function scalloped(cx, cy, rx, ry, count, amp, n = 84) {
  return Array.from({length:n}, (_, i) => {
    const t = i / n * Math.PI * 2, f = (t / (Math.PI * 2) * count) % 1;
    const r = 1 + amp * Math.sqrt(Math.max(0, Math.sin(f * Math.PI)));
    return [cx + Math.cos(t) * rx * r, cy + Math.sin(t) * ry * r];
  });
}

// The head: a superellipse that is fuller across the cranium (`crown` exponent) and narrows slightly to the jaw
export function headOutline(H, n = 96) {
  return Array.from({length:n}, (_, i) => {
    const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t), e = 2 / (s > 0 ? H.crown ?? 2 : 2);
    return [Math.sign(c) * Math.abs(c) ** e * H.rx * (s < 0 ? 1 - H.jaw * s * s : 1), Math.sign(s) * Math.abs(s) ** e * H.ry];
  });
}
// Half-width of the head at height y (above the centre), for keeping features on the face
const headHalfWidth = (H, y) => y > 0 ? H.rx * Math.max(0, 1 - Math.abs(y / H.ry) ** (H.crown ?? 2)) ** (1 / (H.crown ?? 2)) : H.rx * Math.sqrt(Math.max(0, 1 - (y / H.ry) ** 2)) * (1 - H.jaw * (y / H.ry) ** 2);

export const EXPRESSION_FALLBACK = 'neutral';
// Newer storyboard faces fall back to an existing expression on characters drawn before them (their artwork untouched)
export const FACE_FALLBACK = {relieved:'happy', panicked:'surprised', impressed:'surprised'};
export function resolveExpression(def, face) {
  const shared = FACE_FALLBACK[face] && def.expressions[FACE_FALLBACK[face]] ? FACE_FALLBACK[face] : null;
  const name = def.expressions[face] ? face : def.faceMap?.[face] ?? shared ?? EXPRESSION_FALLBACK;
  return {name, ...def.expressions[name]};
}

/*
 * state: a characterTrack sample ({pose, face, blink, gaze}). Returns {items, joints, bounds}.
 * items: [{id, outline, shapes:[{pts, closed, fill?, stroke?, width?}]}] in paint order.
 */
export function buildFigure(def, state) {
  const R = def.rig, F = def.forms, C = def.palette, p = state.pose;
  const items = [];
  const item = (id, outline, ...shapes) => items.push({id, outline, shapes});
  const fill = (pts, color) => ({pts, closed:true, fill:color});
  const stroke = (pts, color, width) => ({pts, closed:false, stroke:color, width});

  // Frames: hip (legs), torso (leans about the hip), head (turns about the neck), cap (follows through about its seat)
  const hip = [0, R.hipY - p.hipDrop];
  const T = q => add(hip, rot(q, -p.torso));
  const neck = T([0, R.neckHeight]);
  // The head nods toward what the eyes follow (gaze y < 0 looks down), on top of the pose's head angle
  const nod = -(state.gaze?.[1] ?? 0) * (def.face.nod ?? 0);
  const headAngle = -(p.torso + p.head + nod);
  const headCenter = [F.head.offsetX, R.headCenter];
  const Hc = q => add(neck, rot(add(headCenter, q), headAngle));
  // Hatless characters (cap: null) skip the cap items; the cap frame then follows the head
  const capPivot = F.cap?.pivot ?? [0, 0];
  // Bone frames for attachments (outfit and accessory layers): rig millimetres in each bone's own frame
  const frames = {hip:q => add(hip, q), torso:T, head:q => Hc(q)};
  const Cp = q => Hc(add([capPivot[0], capPivot[1] - (F.cap?.drop ?? 0)], rot([q[0] - capPivot[0], q[1] - capPivot[1]], (F.cap?.tilt ?? 0) - (p.cap ?? 0))));
  const joints = {hip, neck, headCenter:Hc([0, 0])};

  function arm(side) {
    const [upper, bend] = p[`arm${side}`];
    const shoulder = T([R[`shoulder${side}`][0], R.shoulderHeight]);
    const a1 = upper - p.torso, a2 = a1 + bend;
    const elbow = along(shoulder, a1, R.upperArm), wrist = along(elbow, a2, R.forearm);
    const dir = [Math.sin(rad(a2)), -Math.cos(rad(a2))], side2 = [Math.cos(rad(a2)), Math.sin(rad(a2))];
    const H = (u, v) => [wrist[0] + dir[0] * u + side2[0] * v, wrist[1] + dir[1] * u + side2[1] * v];
    const [hw, hl] = F.arm.hand;
    const handName = side === 'F' ? p.handF : p.handB;
    const hand = [];
    if (handName === 'fist' || handName === 'thumbs') {
      hand.push(fill(ellipse(0, 0, hw * 0.56, hw * 0.56).map(([u, v]) => H(u + hw * 0.4, v)), C.skin));
      if (handName === 'thumbs') hand.push(stroke([H(hw * 0.2, hw * 0.45), H(-hw * 0.25, hw * 0.62)], C.skin, hw * 0.3));
    } else {
      const narrow = handName === 'point' ? 0.8 : 1;
      hand.push(fill(ellipse(0, 0, hl / 2, hw / 2 * narrow).map(([u, v]) => H(u + hl * 0.42, v)), C.skin));
      hand.push(fill(ellipse(0, 0, hw * 0.2, hw * 0.17).map(([u, v]) => H(u + hl * 0.2, v + hw * 0.42 * narrow)), C.skin)); // thumb
      if (handName === 'point') hand.push(stroke([H(hl * 0.7, hw * 0.12), H(hl * 1.25, hw * 0.12)], C.skin, hw * 0.3));
    }
    // Forearm and hand share one outline (no wrist seam); the sleeve and cuff are design lines drawn over the elbow
    item(`forearm${side}`, true, stroke([elbow, wrist], C.skin, F.arm.forearm), ...hand);
    item(`sleeve${side}`, true, stroke([shoulder, along(shoulder, a1, R.upperArm - F.arm.cuffAt)], C.shirt, F.arm.sleeve));
    const cuffAt = along(shoulder, a1, R.upperArm - F.arm.cuffAt);
    const [cw, ch] = F.arm.cuff;
    item(`cuff${side}`, true, fill(chaikin([[-cw / 2, -ch / 2], [cw / 2, -ch / 2], [cw / 2, ch / 2], [-cw / 2, ch / 2]], 3).map(q => add(cuffAt, rot(q, a1))), C.shirt));
    // Limb frames: local y runs up the limb (it hangs along -y at rest), x points forward
    Object.assign(frames, {[`upperArm${side}`]:q => add(shoulder, rot(q, a1)), [`forearm${side}`]:q => add(elbow, rot(q, a2)), [`hand${side}`]:q => add(wrist, rot(q, a2))});
    Object.assign(joints, {[`shoulder${side}`]:shoulder, [`elbow${side}`]:elbow, [`wrist${side}`]:wrist, [`hand${side}`]:H(R.hand * 0.6, 0)});
  }

  function leg(side) {
    const [thigh, knee] = p[`leg${side}`];
    const top = add(hip, [R[`hip${side}`][0], 0]);
    const kneeAt = along(top, thigh, R.thigh), ankle = along(kneeAt, thigh - knee, R.shin);
    item(`leg${side}`, true, stroke([top, kneeAt, ankle], C.trousers, F.leg.width));
    const B = F.boot, ground = -R.ankle;
    const boot = chaikin([[-B.heel, B.height + ground], [-B.heel, ground], [B.toe, ground], [B.toe, ground + B.height * 0.42], [B.toe * 0.55, ground + B.height * 0.8], [B.toe * 0.25, B.height + ground]], 3);
    item(`boot${side}`, true, fill(boot.map(q => add(ankle, q)), C.boots));
    Object.assign(frames, {[`thigh${side}`]:q => add(top, rot(q, thigh)), [`shin${side}`]:q => add(kneeAt, rot(q, thigh - knee)), [`foot${side}`]:q => add(ankle, q)});
    Object.assign(joints, {[`hip${side}`]:top, [`knee${side}`]:kneeAt, [`ankle${side}`]:ankle, [`toe${side}`]:add(ankle, [B.toe, ground]), [`heel${side}`]:add(ankle, [-B.heel, ground])});
  }

  // Far side (F: the leading arm and leg) behind the body, near side (B) in front
  frames.cap = q => Cp(q);
  const wearing = def.wearing ?? {}, layers = [...(wearing.outfit?.layers ?? []), ...(wearing.accessories ?? []).flatMap(a => a.layers ?? [])];
  const colors = {...C, ...(wearing.outfit?.palette ?? {}), ...Object.assign({}, ...(wearing.accessories ?? []).map(a => a.palette ?? {}))};
  const attach = slot => {
    for (const layer of layers.filter(l => (l.slot ?? 'body') === slot)) {
      const frame = frames[layer.bone];
      if (!frame) throw new Error(`Attachment ${layer.id}: unknown bone "${layer.bone}"`);
      item(layer.id, layer.outline !== false, ...layer.shapes.map(sh => {
        const pts = chaikin(sh.points, sh.smooth ?? 0, sh.stroke ? false : true).map(frame), color = c => colors[c] ?? c;
        return sh.stroke ? stroke(pts, color(sh.stroke), sh.width) : fill(pts, color(sh.fill));
      }));
    }
  };
  attach('back');
  arm('F');
  attach('heldF');
  leg('F'); leg('B');
  item('neck', true, stroke([T(F.neck.base), Hc([F.neck.top[0], -R.headCenter + F.neck.top[1]])], C.skin, F.neck.width));
  item('torso', true, fill(chaikin(F.torso, 2).map(T), C.shirt));
  const A = F.apron;
  item('straps', true, ...(A.straps ?? []).map(s => stroke(s.map(T), C.apron, A.strapWidth)));
  item('apron', true, fill(chaikin(A.outline, 2).map(T), C.apron));
  if (A.pocket?.length > 1) item('pocket', false, stroke(chaikin(A.pocket, 2, false).map(T), C.line, 7));
  item('buttons', true, ...(A.buttons ?? []).map(([x, y]) => fill(ellipse(x, y, A.buttonRadius, A.buttonRadius, 0, 20).map(T), C.buttons)));
  item('collar', true, ...F.collar.map(c => fill(c.map(T), C.shirt)));
  attach('body');

  // Head, then face, hair and cap
  const Hd = F.head;
  item('head', true, fill(headOutline(Hd).map(Hc), C.skin));
  faceItems(def, state, Hc, item, fill, stroke);
  const hair = F.hair;
  // Hair: a scalloped mass (the cooper's curls under his cap), or a drawn shape in head coordinates (a quiff), optionally
  // with a back layer behind the head
  if (hair.shape) item('hair', true, fill(chaikin(hair.shape, hair.smooth ?? 2).map(Hc), C.hair));
  else item('hair', true, fill(scalloped(hair.cx, hair.cy, hair.rx, hair.ry, hair.scallops, hair.amp).map(Hc), C.hair));
  const cap = F.cap;
  if (cap) {
    item('brim', true, fill(chaikin(cap.brim, 2).map(Cp), C.hair));
    item('crown', true, fill(chaikin(cap.crown, 3).map(Cp), C.cap));
    item('capLines', false, ...[cap.band, cap.seam].filter(l => l?.length).map((l, i) => stroke(chaikin(l, 2, false).map(Cp), C.line, i ? 5 : 8)));
  }
  // Reference points inside large flat areas, for colour sampling on rendered frames
  const hairSample = hair.sample ? Hc(hair.sample) : Hc([hair.cx - hair.rx * 0.3, hair.cy]);
  Object.assign(joints, {capSample:cap ? Cp([-60, 220]) : hairSample, hairSample, apronSample:T([0, 60]), cheekSample:Hc([-40, -40])});
  if (cap) item('capButton', true, fill(ellipse(cap.button[0], cap.button[1], cap.button[2], cap.button[2] * 0.7, 0, 20).map(Cp), C.cap));
  attach('head');
  arm('B');
  attach('front');
  if (resolveExpression(def, state.face).spark) item('spark', false, stroke([Hc([168, 262]), Hc([190, 304])], C.line, 10), stroke([Hc([204, 236]), Hc([244, 258])], C.line, 10));

  // An outfit may hide built-in garments it replaces (e.g. the apron and its straps)
  const hidden = new Set(wearing.outfit?.hide ?? []);
  if (hidden.size) for (let i = items.length - 1; i >= 0; i--) if (hidden.has(items[i].id)) items.splice(i, 1);
  let bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const it of items) for (const s of it.shapes) {
    const pad = (s.width ?? 0) / 2;
    for (const [x, y] of s.pts) bounds = [Math.min(bounds[0], x - pad), Math.min(bounds[1], y - pad), Math.max(bounds[2], x + pad), Math.max(bounds[3], y + pad)];
  }
  return {items, joints, bounds};
}

function faceItems(def, state, Hc, item, fill, stroke) {
  const f = def.face, C = def.palette, e = resolveExpression(def, state.face);
  const gaze = state.gaze ?? state.look ?? [0, 0];
  const turn = Math.max(-1, Math.min(1, gaze[0])) * f.turnShift;
  const [gx, gy] = [gaze[0] * f.gazeShift[0], gaze[1] * f.gazeShift[1]];
  // Features stay on the face: the head's half-width at a feature's height bounds how far it can slide with a turn
  const edge = y => headHalfWidth(def.forms.head, y) * 0.96;
  const pick = (v, i) => Array.isArray(v) ? v[i] : v ?? 0;
  const scale = e.eyeScale ?? 1, blink = state.blink ?? 0;
  const eyes = [], brows = [];
  for (const i of [0, 1]) {
    const x = Math.min(edge(f.eyes.y + f.eyes.h / 2) - f.eyes.w * 0.7, f.eyes.x[i] + turn + gx), y = f.eyes.y + gy;
    const w = f.eyes.w * scale, h = f.eyes.h * scale;
    if (e.eyes === 'arc') eyes.push(stroke(arc(x, y - h * 0.15, w * 1.3, h * 0.32), C.line, 9));
    else if (blink > 0.75) eyes.push(stroke([[x - w * 0.6, y], [x + w * 0.6, y]], C.line, 8));
    else if (e.eyes === 'lid') {
      eyes.push(fill(ellipse(x, y, w / 2, h / 2 * (1 - blink), 0, 24).filter(([, py]) => py <= y + 0.01), C.line));
      eyes.push(stroke([[x - w * 0.7, y], [x + w * 0.7, y]], C.line, 8));
    } else eyes.push(fill(ellipse(x, y, w / 2, Math.max(h * 0.06, h / 2 * (1 - blink)), 0, 24), C.line));
    // Brows: positive tilt raises the inner ends (toward the nose), which reads as worry; negative reads as determination
    const by = f.brows.y + pick(e.brows.raise, i);
    const bx = Math.min(edge(by + f.brows.arch + f.brows.thick / 2) - f.brows.w / 2 - f.brows.thick / 2, f.brows.x[i] + turn + gx * 0.5);
    brows.push(stroke(arc(bx, by, f.brows.w, f.brows.arch, pick(e.brows.tilt, i) * (i === 0 ? 1 : -1)), C.line, f.brows.thick));
  }
  item('eyes', false, ...eyes.map(s => ({...s, pts:s.pts.map(Hc)})));
  item('brows', false, ...brows.map(s => ({...s, pts:s.pts.map(Hc)})));
  const m = e.mouth, mx = f.mouth.x + (m.x ?? 0) + turn * 1.1 + gx * 0.4, my = f.mouth.y;
  const map = s => ({...s, pts:s.pts.map(Hc)});
  if (m.shape === 'line') item('mouth', false, map(stroke([[mx - m.w / 2, my], [mx + m.w / 2, my]], C.line, f.mouth.thick)));
  else if (m.shape === 'frown') item('mouth', false, map(stroke(arc(mx, my - 6, m.w, 9), C.line, f.mouth.thick)));
  else if (m.shape === 'smile') item('mouth', false, map(stroke(arc(mx, my + 4, m.w, -10), C.line, f.mouth.thick)));
  else if (m.shape === 'o') item('mouth', true, map(fill(ellipse(mx, my, m.w / 2, m.h / 2, 0, 28), C.mouth)));
  else if (m.shape === 'open') {
    // D-shaped open mouth: a gently curved top edge and a round bottom, with the tongue showing
    const top = arc(mx, my + m.h * 0.28, m.w, -3, 0, 7);
    const bottom = Array.from({length:15}, (_, i) => { const t = Math.PI + (i + 1) / 16 * Math.PI; return [mx - Math.cos(t) * m.w / 2, my + m.h * 0.28 + Math.sin(t) * m.h]; });
    item('mouth', true, map(fill([...top, ...bottom], C.mouth)));
    item('tongue', false, map(fill(ellipse(mx + m.w * 0.06, my - m.h * 0.52, m.w * 0.24, m.h * 0.17, 0, 20), C.tongue)));
  }
}

// Paints a figure onto any 2D canvas context already transformed to rig millimetres (y up). `outlineMm` is the
// visible outline weight; outlines are stroked at twice that and the fill covers the inner half.
export function paintFigure(g, figure, outlineMm, lineColor) {
  g.lineJoin = 'round'; g.lineCap = 'round';
  const trace = s => {
    g.beginPath();
    s.pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
    if (s.closed) g.closePath();
  };
  for (const it of figure.items) {
    if (it.outline) {
      g.strokeStyle = lineColor;
      for (const s of it.shapes) { trace(s); g.lineWidth = (s.width ?? 0) + outlineMm * 2; g.stroke(); }
    }
    for (const s of it.shapes) {
      trace(s);
      if (s.fill) { g.fillStyle = s.fill; g.fill(); }
      else { g.strokeStyle = s.stroke; g.lineWidth = s.width; g.stroke(); }
    }
  }
}
