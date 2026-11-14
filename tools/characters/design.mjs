/*
 * Hold Up character design system. A character is (style family) × (person spec):
 * the family sets shape language, line, shading, face construction and expression range;
 * the person sets proportions, build, face, hair, clothing, palette and age.
 * Output is a rig-compatible definition (same bones and part names as characters/bram.json),
 * drawn in each part's own y-down millimetre frame with its pivot at the origin.
 */
const r1 = n => Math.round(n * 10) / 10;
const pt = ([x, y]) => `${r1(x)} ${r1(y)}`;
const poly = points => `M ${points.map(pt).join(' L ')} Z`;

// Polygon with rounded corners; radius is clamped to half of each adjacent edge
function rounded(points, radius) {
  if (!radius) return poly(points);
  const n = points.length, parts = [];
  for (let i = 0; i < n; i++) {
    const p = points[i], a = points[(i + n - 1) % n], b = points[(i + 1) % n];
    const da = Math.hypot(a[0] - p[0], a[1] - p[1]), db = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const r = Math.min(radius, da / 2, db / 2);
    const s = [p[0] + (a[0] - p[0]) * r / da, p[1] + (a[1] - p[1]) * r / da], e = [p[0] + (b[0] - p[0]) * r / db, p[1] + (b[1] - p[1]) * r / db];
    parts.push(`${i === 0 ? 'M' : 'L'} ${pt(s)} Q ${pt(p)} ${pt(e)}`);
  }
  return parts.join(' ') + ' Z';
}

// Tapered capsule from p0 to p1: round caps at both ends make joints overlap cleanly when segments rotate
function capsule([x0, y0], [x1, y1], ra, rb, steps = 10) {
  const ang = Math.atan2(y1 - y0, x1 - x0), pts = [];
  for (let k = 0; k <= steps; k++) { const t = ang - Math.PI / 2 + Math.PI * k / steps; pts.push([x1 + Math.cos(t) * rb, y1 + Math.sin(t) * rb]); }
  for (let k = 0; k <= steps; k++) { const t = ang + Math.PI / 2 + Math.PI * k / steps; pts.push([x0 + Math.cos(t) * ra, y0 + Math.sin(t) * ra]); }
  return poly(pts);
}

// Superellipse: n=2 is an ellipse, larger n is squarer (shape language for heads)
function superellipse(cx, cy, rx, ry, n = 2, steps = 48, squash = 0) {
  const pts = [];
  for (let k = 0; k < steps; k++) {
    const t = Math.PI * 2 * k / steps, c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** (2 / n), y = Math.sign(s) * Math.abs(s) ** (2 / n);
    // squash > 0 widens the lower half (jaw), < 0 widens the top (cranium)
    const widen = 1 + squash * (y > 0 ? y : 0);
    pts.push([cx + x * rx * widen, cy + y * ry]);
  }
  return poly(pts);
}

function superellipsePoints(cx, cy, rx, ry, n, steps = 64, squash = 0) {
  const pts = [];
  for (let k = 0; k < steps; k++) {
    const t = Math.PI * 2 * k / steps, c = Math.cos(t), s = Math.sin(t);
    const x = Math.sign(c) * Math.abs(c) ** (2 / n), y = Math.sign(s) * Math.abs(s) ** (2 / n);
    pts.push([cx + x * rx * (1 + squash * (y > 0 ? y : 0)), cy + y * ry]);
  }
  return pts;
}

// Hair that follows the skull: the part of a slightly enlarged head outline on the "hair" side of a hairline
// (hairline(x, y) > 0 means hair). The kept arc is closed along the hairline, so hair never floats as a slab.
function skullRegion(points, inside) {
  const keep = points.map(inside);
  const start = keep.findIndex((k, i) => k && !keep[(i + keep.length - 1) % keep.length]);
  if (start < 0) return keep[0] ? poly(points) : null;
  const arc = [];
  for (let i = 0; i < points.length; i++) { const j = (start + i) % points.length; if (!keep[j]) break; arc.push(points[j]); }
  return arc.length > 2 ? poly(arc) : null;
}

export const FAMILIES = {
  editorial:{
    label:'A · Minimal editorial', corner:0.3, lineMm:2.5, outlinePx:2.2, shading:'flat', highlight:false, joints:'hidden',
    head:{shape:2.4, squash:-0.05, aspect:0.74}, eyes:'dot', brows:'line', nose:'line', mouth:'small', hands:'simple', expressionScale:0.6, faceDetail:1.4
  },
  storyteller:{
    label:'B · Stylized storyteller', corner:0.55, lineMm:4, outlinePx:3, shading:'cel', highlight:true, joints:'hidden',
    head:{shape:2.2, squash:0.16, aspect:0.86}, eyes:'lidded', brows:'bushy', nose:'bulb', mouth:'full', hands:'fingered', expressionScale:1.15, faceDetail:1.5
  },
  cutout:{
    label:'C · Graphic cutout', corner:0.08, lineMm:0, outlinePx:4.5, shading:'none', highlight:false, joints:'brads',
    head:{shape:4.5, squash:0.04, aspect:0.78}, eyes:'round', brows:'block', nose:'wedge', mouth:'graphic', hands:'mitt', expressionScale:1.0, faceDetail:1.3
  }
};

// Rig proportions from height, head ratio and leg ratio; all values in millimetres
function proportions(p) {
  const H = p.heightMm, headH = H / p.headRatio;
  const foot = 48;
  const hipY = Math.round(H * p.legRatio);
  const thigh = Math.round((hipY - foot) * 0.52), shin = hipY - foot - thigh;
  const neckLen = Math.round(headH * 0.12);
  const neckHeight = Math.round(H - hipY - headH * 0.9 - neckLen);
  return {H, headH, hipY, thigh, shin, foot, neckHeight, neckLen, shoulderHeight:Math.round(neckHeight - headH * 0.1),
    upperArm:Math.round(H * 0.17), forearm:Math.round(H * 0.15), hand:Math.round(H * 0.075)};
}

export function buildDefinition(family, person) {
  const F = FAMILIES[family];
  if (!F) throw new Error(`Unknown style family: ${family}`);
  const P = proportions(person);
  const b = person.build ?? {};
  const shW = (b.shoulders ?? 1) * P.H * 0.24, hipW = (b.hips ?? 1) * P.H * 0.19, limb = (b.limbs ?? 1) * P.H * 0.028, forearmR = limb * (b.forearms ?? 1);
  const cr = s => s * F.corner; // corner radius as a share of the feature size
  const c = person.palette;
  const parts = {};
  const shade = F.shading !== 'flat' && F.shading !== 'none';
  const line = F.lineMm > 0;
  const fill = (key, extra = {}) => ({fill:key, ...(line ? {} : {line:false}), ...extra});

  // ---- Torso (origin at hip, up is -y) ----
  const front = shW * 0.08, top = -P.neckHeight + 6, sh = -P.shoulderHeight;
  const belly = (b.belly ?? 0) * hipW * 0.25;
  const torsoPts = [[-hipW / 2, 24], [hipW / 2 + front, 24], [hipW / 2 + front + belly, -P.shoulderHeight * 0.4], [shW / 2 + front, sh + limb * 0.8], [shW * 0.22, top], [-shW * 0.22, top], [-shW / 2, sh + limb * 0.8]];
  const torso = [
    fill('skin', {path:rounded([[-P.headH * 0.1, top + 20], [P.headH * 0.12, top + 20], [P.headH * 0.1, top - P.neckLen - 10], [-P.headH * 0.08, top - P.neckLen - 10]], 8)}),
    fill(person.clothing.coat ? 'coat' : 'shirt', {path:rounded(torsoPts, cr(shW * 0.35))})
  ];
  if (shade) torso.push({path:rounded([[-hipW / 2, 24], [-hipW * 0.18, 24], [-shW * 0.2, sh + limb], [-shW / 2, sh + limb * 0.8]], cr(40)), fill:person.clothing.coat ? 'coatShade' : 'shirtShade', line:false, clip:true});
  if (person.clothing.waistcoat) {
    const vest = [[-hipW * 0.48, 10], [hipW * 0.5 + front, 10], [shW * 0.42 + front, sh + limb * 1.2], [shW * 0.12, top + 30], [shW * 0.02, -P.shoulderHeight * 0.45], [-shW * 0.15, top + 26], [-shW * 0.45, sh + limb * 1.2]];
    torso.push(fill('vest', {path:rounded(vest, cr(30))}));
    for (let k = 0; k < 3; k++) torso.push({ellipse:[shW * 0.05 + front * 0.5, -P.shoulderHeight * (0.38 - k * 0.11), 5, 5], fill:'vestShade', line:false});
  }
  if (person.clothing.skirt) {
    const hem = P.hipY - P.foot - 40;
    torso.push(fill('skirt', {path:rounded([[-hipW * 0.55, -30], [hipW * 0.58 + front, -30], [hipW * 0.95 + front, hem], [-hipW * 0.85, hem]], cr(60))}));
    if (shade) torso.push({path:rounded([[-hipW * 0.55, -30], [-hipW * 0.2, -30], [-hipW * 0.35, hem], [-hipW * 0.85, hem]], cr(30)), fill:'skirtShade', line:false, clip:true});
  }
  if (person.clothing.apron) {
    const len = P.thigh * (person.clothing.apronLength ?? 0.75);
    const apron = [[-hipW * 0.42, len], [hipW * 0.5 + front, len], [hipW * 0.45 + front + belly, -P.shoulderHeight * 0.45], [shW * 0.26 + front, -P.shoulderHeight * 0.78], [-shW * 0.08, -P.shoulderHeight * 0.78], [-hipW * 0.4, -P.shoulderHeight * 0.45]];
    torso.push(fill('apron', {path:rounded(apron, cr(36))}));
    if (shade) torso.push({path:rounded([[-hipW * 0.42, len], [-hipW * 0.1, len], [-hipW * 0.12, -P.shoulderHeight * 0.45], [-hipW * 0.4, -P.shoulderHeight * 0.45]], cr(20)), fill:'apronShade', line:false, clip:true});
    torso.push({path:`M ${pt([-shW * 0.06, -P.shoulderHeight * 0.78])} L ${pt([-shW * 0.2, top + 8])}`, stroke:'apronShade', width:limb * 0.35});
    torso.push({path:`M ${pt([shW * 0.24 + front, -P.shoulderHeight * 0.78])} L ${pt([shW * 0.16, top + 8])}`, stroke:'apronShade', width:limb * 0.35});
  }
  if (person.clothing.neckerchief) torso.push(fill('accent', {path:rounded([[-P.headH * 0.14, top + 4], [P.headH * 0.2, top + 4], [P.headH * 0.06, top + P.headH * 0.22]], cr(14))}));
  parts.torso = {bone:'torso', z:0, shapes:torso};

  // ---- Head (origin at neck, head centre up and slightly forward) ----
  const hw = P.headH * F.head.aspect / 2 * (person.face?.width ?? 1), hh = P.headH / 2;
  const hc = [P.headH * 0.06, -P.neckLen - hh];
  const head = [];
  const hair = person.hair ?? {};
  const skull = F.head.shape * (person.face?.squareness ?? 1), jaw = F.head.squash + (person.face?.jaw ?? 0);
  if (hair.style === 'long' || hair.style === 'bun') head.push(fill('hair', {path:superellipse(hc[0] - hw * 0.25, hc[1] + hh * 0.35, hw * 0.75, hh * 0.85, 2.2)}));
  head.push(fill('skin', {path:superellipse(hc[0], hc[1], hw, hh, skull, 56, jaw)}));
  // Cel shade on the side away from the viewer only, so the face itself stays one clean value
  if (shade) head.push({path:superellipse(hc[0] - hw * 0.95, hc[1] + hh * 0.2, hw * 0.42, hh * 0.95, 2), fill:'skinShade', line:false, clip:true});
  // Hair regions are cut from the skull outline (enlarged a little for volume) by a hairline, so they hug the head
  const outline = superellipsePoints(hc[0], hc[1], hw * 1.05, hh * 1.05, skull, 72, jaw);
  const crown = hc[1] - hh;
  const rel = ([x, y]) => [(x - hc[0]) / hw, (y - hc[1]) / hh];
  const region = {
    'side-part':([x, y]) => y < -0.42 + (x < -0.3 ? 0.55 * (-0.3 - x) : 0) - 0.12 * x,
    short:([x, y]) => y < -0.45 + (x < -0.2 ? 0.7 * (-0.2 - x) : 0),
    receding:([x, y]) => x < -0.42 && y > -0.62 && y < 0.3,
    block:([x, y]) => x < -0.35 && y < 0.25,
    long:([x, y]) => y < -0.4 + (x < 0 ? -0.9 * x : 0),
    bun:([x, y]) => y < -0.4 + (x < 0 ? -0.9 * x : 0)
  }[hair.style];
  // Sideburns are part of the hair mass: a band down the side of the head in front of the ear
  const burns = person.face?.sideburns ? ([x, y]) => x > -0.64 && x < -0.4 && y < 0.08 : () => false;
  const hairPath = region && skullRegion(outline, pt => region(rel(pt)) || burns(rel(pt)));
  if (hairPath) head.push(fill('hair', {path:hairPath}));
  if (hair.style === 'bun') head.push(fill('hair', {ellipse:[hc[0] - hw * 0.85, crown + hh * 0.35, hw * 0.32, hh * 0.28]}));
  // Ear sits over the head at the back third; its outer edge gets the part's contour from the shader
  const ear = [hc[0] - hw * 0.62, hc[1] + hh * 0.06];
  head.push({ellipse:[ear[0], ear[1], hw * 0.15, hh * 0.21], fill:'skin', line:false});
  head.push({path:`M ${pt([ear[0] + hw * 0.04, ear[1] - hh * 0.1])} Q ${pt([ear[0] - hw * 0.08, ear[1]])} ${pt([ear[0] + hw * 0.03, ear[1] + hh * 0.1])}`, stroke:'skinShade', width:Math.max(4, hw * 0.05)});
  // Nose: no interior outline; its protrusion past the cheek is contoured by the shader, and a shade defines its underside
  const nx = hc[0] + hw * 0.8, ny = hc[1] + hh * 0.12;
  if (F.nose === 'bulb') {
    head.push({ellipse:[nx, ny, hw * 0.23, hh * 0.17], fill:'skin', line:false});
    head.push({path:`M ${pt([nx - hw * 0.2, ny + hh * 0.06])} Q ${pt([nx, ny + hh * 0.2])} ${pt([nx + hw * 0.18, ny + hh * 0.05])}`, stroke:'skinShade', width:hw * 0.07});
    head.push({ellipse:[nx + hw * 0.05, ny - hh * 0.07, hw * 0.06, hh * 0.04], fill:'highlight', line:false, alpha:0.6});
  } else if (F.nose === 'wedge') {
    head.push({path:poly([[nx - hw * 0.14, ny - hh * 0.3], [nx + hw * 0.36, ny + hh * 0.14], [nx - hw * 0.12, ny + hh * 0.16]]), fill:'skin', line:false});
    head.push({path:poly([[nx - hw * 0.12, ny + hh * 0.06], [nx + hw * 0.3, ny + hh * 0.14], [nx - hw * 0.12, ny + hh * 0.16]]), fill:'skinShade', line:false});
  } else head.push({path:`M ${pt([nx - hw * 0.06, ny - hh * 0.22])} Q ${pt([nx + hw * 0.14, ny + hh * 0.06])} ${pt([nx - hw * 0.08, ny + hh * 0.12])}`, stroke:'line', width:Math.max(4, F.lineMm * 1.2 + 1.5)});
  if (person.face?.beard) {
    const beard = skullRegion(outline, pt => { const [x, y] = rel(pt); return y > 0.25 && x > -0.5; });
    if (beard) head.push(fill('hair', {path:beard}));
  }
  parts.head = {bone:'head', z:12, shapes:head};

  // Hat (separate bone so it can lag the head as follow-through)
  const hat = person.hat ?? 'none';
  const hatShapes = [];
  if (hat === 'bowler') {
    hatShapes.push(fill('hat', {path:superellipse(hc[0] - hw * 0.05, crown + hh * 0.08, hw * 0.82, hh * 0.42, 2.2)}));
    hatShapes.push(fill('hat', {path:rounded([[hc[0] - hw * 1.15, crown + hh * 0.36], [hc[0] + hw * 1.12, crown + hh * 0.36], [hc[0] + hw * 1.12, crown + hh * 0.48], [hc[0] - hw * 1.15, crown + hh * 0.48]], cr(14))}));
    hatShapes.push({path:rounded([[hc[0] - hw * 0.84, crown + hh * 0.22], [hc[0] + hw * 0.76, crown + hh * 0.22], [hc[0] + hw * 0.78, crown + hh * 0.32], [hc[0] - hw * 0.86, crown + hh * 0.32]], 4), fill:'accent', line:false});
  } else if (hat === 'flatcap') {
    hatShapes.push(fill('hat', {path:rounded([[hc[0] - hw * 1.05, crown + hh * 0.42], [hc[0] - hw * 0.9, crown - hh * 0.02], [hc[0] + hw * 0.6, crown - hh * 0.06], [hc[0] + hw * 1.05, crown + hh * 0.3], [hc[0] + hw * 1.45, crown + hh * 0.42]], cr(hw * 0.3))}));
  } else if (hat === 'tophat') {
    hatShapes.push(fill('hat', {path:rounded([[hc[0] - hw * 0.72, crown + hh * 0.3], [hc[0] - hw * 0.66, crown - hh * 0.9], [hc[0] + hw * 0.68, crown - hh * 0.9], [hc[0] + hw * 0.66, crown + hh * 0.3]], cr(12))}));
    hatShapes.push(fill('hat', {path:rounded([[hc[0] - hw * 1.1, crown + hh * 0.28], [hc[0] + hw * 1.1, crown + hh * 0.28], [hc[0] + hw * 1.1, crown + hh * 0.4], [hc[0] - hw * 1.1, crown + hh * 0.4]], cr(10))}));
  } else if (hat === 'bonnet') {
    hatShapes.push(fill('hat', {path:rounded([[hc[0] - hw * 1.1, hc[1] + hh * 0.2], [hc[0] - hw * 1.0, crown - hh * 0.1], [hc[0] + hw * 0.7, crown - hh * 0.05], [hc[0] + hw * 1.05, crown + hh * 0.4], [hc[0] + hw * 0.5, crown + hh * 0.25], [hc[0] - hw * 0.6, hc[1] + hh * 0.25]], cr(hw * 0.35))}));
  }
  parts.cap = {bone:'cap', z:18, shapes:hatShapes};

  // ---- Face features: sized for legibility at phone size (faceDetail), drawn per family ----
  const eyeR = hh * 0.11 * F.faceDetail, eye = [hc[0] + hw * 0.38, hc[1] - hh * 0.08];
  const farEye = [-hw * 0.5, eyeR * 0.08];
  if (F.eyes === 'dot') {
    parts.eyes = {bone:'eyes', z:14, shapes:[{ellipse:[0, 0, eyeR * 0.65, eyeR * 0.85], fill:'eyeWhite', line:false}, {ellipse:[farEye[0], farEye[1], eyeR * 0.5, eyeR * 0.8], fill:'eyeWhite', line:false}]};
    parts.pupils = {bone:'pupils', z:15, shapes:[{ellipse:[eyeR * 0.08, eyeR * 0.05, eyeR * 0.42, eyeR * 0.52], fill:'pupil', line:false}, {ellipse:[farEye[0] + eyeR * 0.05, farEye[1] + eyeR * 0.05, eyeR * 0.34, eyeR * 0.48], fill:'pupil', line:false}]};
  } else if (F.eyes === 'lidded') {
    parts.eyes = {bone:'eyes', z:14, shapes:[
      {ellipse:[0, 0, eyeR * 0.9, eyeR * 1.05], fill:'eyeWhite', line:false}, {ellipse:[farEye[0], farEye[1], eyeR * 0.72, eyeR], fill:'eyeWhite', line:false},
      // Heavy upper lids give a grown-up, knowing look instead of the wide stare of a child's cartoon
      {path:`M ${pt([-eyeR * 1.05, -eyeR * 0.1])} Q ${pt([0, -eyeR * 1.35])} ${pt([eyeR * 1.0, -eyeR * 0.25])}`, stroke:'line', width:eyeR * 0.32},
      {path:`M ${pt([farEye[0] - eyeR * 0.82, farEye[1] - eyeR * 0.1])} Q ${pt([farEye[0], farEye[1] - eyeR * 1.25])} ${pt([farEye[0] + eyeR * 0.75, farEye[1] - eyeR * 0.25])}`, stroke:'line', width:eyeR * 0.28}
    ]};
    parts.pupils = {bone:'pupils', z:15, shapes:[{ellipse:[eyeR * 0.15, eyeR * 0.2, eyeR * 0.5, eyeR * 0.6], fill:'pupil', line:false}, {ellipse:[farEye[0] + eyeR * 0.1, farEye[1] + eyeR * 0.2, eyeR * 0.4, eyeR * 0.55], fill:'pupil', line:false},
      {ellipse:[eyeR * 0.32, eyeR * 0.02, eyeR * 0.14, eyeR * 0.14], fill:'highlight', line:false}]};
  } else {
    parts.eyes = {bone:'eyes', z:14, shapes:[{ellipse:[0, 0, eyeR, eyeR], fill:'eyeWhite', line:false}, {ellipse:[farEye[0], farEye[1], eyeR * 0.8, eyeR], fill:'eyeWhite', line:false}]};
    parts.pupils = {bone:'pupils', z:15, shapes:[{ellipse:[eyeR * 0.2, eyeR * 0.1, eyeR * 0.45, eyeR * 0.45], fill:'pupil', line:false}, {ellipse:[farEye[0] + eyeR * 0.15, farEye[1] + eyeR * 0.1, eyeR * 0.38, eyeR * 0.42], fill:'pupil', line:false}]};
  }
  const browW = eyeR * 1.4, browT = F.brows === 'bushy' ? eyeR * 0.55 : F.brows === 'block' ? eyeR * 0.32 : eyeR * 0.24;
  const brow = (x, w) => F.brows === 'block'
    ? {path:poly([[x - w / 2, -browT / 2], [x + w / 2, -browT * 0.8], [x + w / 2, browT / 2], [x - w / 2, browT * 0.7]]), fill:'hair', line:false}
    : {path:`M ${pt([x - w / 2, browT * 0.2])} Q ${pt([x, -browT * 0.7])} ${pt([x + w / 2, 0])}`, stroke:'hair', width:browT};
  parts.brows = {bone:'brows', z:16, shapes:[brow(eyeR * 0.1, browW), brow(farEye[0] + eyeR * 0.05, browW * 0.75)]};

  // Mouths: same six expressions across families, drawn in each family's manner
  const mw = hw * (F.mouth === 'small' ? 0.32 : F.mouth === 'full' ? 0.5 : 0.42);
  const mouthStroke = F.mouth === 'small' ? Math.max(5, eyeR * 0.22) : eyeR * 0.3;
  const mouths = {
    neutral:[{path:`M ${pt([-mw / 2, 0])} Q ${pt([0, mw * 0.06])} ${pt([mw / 2, -mw * 0.04])}`, stroke:'mouth', width:mouthStroke}],
    smile:[{path:`M ${pt([-mw / 2, -mw * 0.08])} Q ${pt([0, mw * 0.55])} ${pt([mw / 2, -mw * 0.12])} Q ${pt([0, mw * 0.18])} ${pt([-mw / 2, -mw * 0.08])} Z`, fill:'mouth', line:false}],
    grin:[{path:`M ${pt([-mw * 0.55, -mw * 0.1])} Q ${pt([0, mw * 0.7])} ${pt([mw * 0.58, -mw * 0.14])} Q ${pt([0, mw * 0.05])} ${pt([-mw * 0.55, -mw * 0.1])} Z`, fill:'mouth', line:false},
      {path:`M ${pt([-mw * 0.42, -mw * 0.06])} Q ${pt([0, mw * 0.08])} ${pt([mw * 0.45, -mw * 0.1])} L ${pt([mw * 0.4, mw * 0.08])} Q ${pt([0, mw * 0.2])} ${pt([-mw * 0.38, mw * 0.08])} Z`, fill:'teeth', line:false}],
    oh:[{ellipse:[0, mw * 0.08, mw * 0.2, mw * 0.28], fill:'mouth', line:false}],
    grit:[{path:rounded([[-mw * 0.48, -mw * 0.12], [mw * 0.5, -mw * 0.12], [mw * 0.46, mw * 0.2], [-mw * 0.44, mw * 0.2]], mw * 0.08), fill:'teeth', line:false},
      {path:`M ${pt([-mw * 0.42, mw * 0.04])} L ${pt([mw * 0.44, mw * 0.04])}`, stroke:'mouth', width:mouthStroke * 0.5}],
    hmm:[{path:`M ${pt([-mw * 0.45, mw * 0.06])} Q ${pt([0, -mw * 0.06])} ${pt([mw * 0.5, mw * 0.04])}`, stroke:'mouth', width:mouthStroke}]
  };
  if (person.face?.mustache) for (const key of Object.keys(mouths)) mouths[key].push(fill('hair', {path:rounded([[-mw * 0.62, -mw * 0.12], [mw * 0.08, -mw * 0.34], [mw * 0.66, -mw * 0.16], [mw * 0.5, -mw * 0.02], [0, -mw * 0.14], [-mw * 0.5, 0]], cr(mw * 0.25)), lineScale:0.6}));
  for (const [key, shapes] of Object.entries(mouths)) parts[`mouth:${key}`] = {bone:'mouth', z:16, shapes};

  // ---- Arms: capsules with round caps; sleeves rolled or long; back arm in shade colours for depth ----
  const rolled = person.clothing.sleeves !== 'long';
  const sleeve = person.clothing.coat ? 'coat' : 'shirt';
  const armShapes = (back) => {
    const k = back ? 'Shade' : '';
    const upper = [fill(sleeve + k, {path:capsule([0, 0], [0, P.upperArm], limb * 1.12, limb * 0.98)})];
    if (shade && !back) upper.push({path:capsule([-limb * 0.55, 0], [-limb * 0.45, P.upperArm], limb * 0.6, limb * 0.55), fill:sleeve + 'Shade', line:false, clip:true});
    if (rolled) upper.push(fill(sleeve + 'Shade', {path:rounded([[-limb * 1.08, P.upperArm * 0.78], [limb * 1.08, P.upperArm * 0.78], [limb * 1.02, P.upperArm + limb * 0.6], [-limb * 1.02, P.upperArm + limb * 0.6]], cr(limb * 0.5))}));
    const fore = [fill(rolled ? 'skin' + k : sleeve + k, {path:capsule([0, 0], [0, P.forearm], forearmR, forearmR * 0.82)})];
    if (shade && !back) fore.push({path:capsule([-forearmR * 0.55, 0], [-forearmR * 0.45, P.forearm], forearmR * 0.55, forearmR * 0.45), fill:rolled ? 'skinShade' : sleeve + 'Shade', line:false, clip:true});
    if (!rolled) fore.push(fill('shirt' + k, {path:rounded([[-forearmR, P.forearm * 0.86], [forearmR, P.forearm * 0.86], [forearmR * 0.9, P.forearm + forearmR * 0.4], [-forearmR * 0.9, P.forearm + forearmR * 0.4]], 6)}));
    if (F.joints === 'brads') { upper.push({ellipse:[0, 0, limb * 0.22, limb * 0.22], fill:'accent', line:false}); fore.push({ellipse:[0, 0, limb * 0.2, limb * 0.2], fill:'accent', line:false}); }
    return {upper, fore};
  };
  const handR = P.hand * 0.42;
  const handShapes = (variant, back) => {
    const skin = back ? 'skinShade' : 'skin';
    const palm = F.hands === 'mitt' ? fill(skin, {path:rounded([[-handR, 0], [handR, 0], [handR * 1.05, handR * 1.7], [-handR * 0.95, handR * 1.7]], cr(handR))}) : fill(skin, {ellipse:[0, handR * 0.95, handR, handR * 1.05]});
    const thumbOut = fill(skin, {path:capsule([handR * 0.6, handR * 0.5], [handR * 1.35, handR * 1.1], handR * 0.32, handR * 0.26)});
    if (variant === 'open') {
      const s = [palm, thumbOut];
      if (F.hands === 'fingered') for (const dx of [-0.45, -0.05, 0.35]) s.push(fill(skin, {path:capsule([handR * dx, handR * 1.4], [handR * dx * 1.1, handR * 2.15], handR * 0.2, handR * 0.18)}));
      return s;
    }
    if (variant === 'fist') return [fill(skin, {ellipse:[0, handR * 0.9, handR * 0.95, handR * 0.95]})];
    if (variant === 'point') return [fill(skin, {path:capsule([handR * 0.25, handR], [handR * 0.3, handR * 2.6], handR * 0.24, handR * 0.2)}), fill(skin, {ellipse:[0, handR * 0.9, handR * 0.95, handR * 0.95]})];
    return [fill(skin, {ellipse:[0, handR * 0.9, handR * 0.95, handR * 0.95]}), fill(skin, {path:capsule([handR * 0.5, handR * 0.6], [handR * 0.7, -handR * 0.6], handR * 0.3, handR * 0.26)})];
  };
  const front_ = armShapes(false), back_ = armShapes(true);
  parts.upperArmF = {bone:'upperArmF', z:30, shapes:front_.upper};
  parts.forearmF = {bone:'forearmF', z:29, shapes:front_.fore};
  for (const v of ['open', 'fist', 'point', 'thumbs']) parts[`hand:${v}`] = {bone:'hand', z:31, shapes:handShapes(v, false)};
  parts.upperArmB = {bone:'upperArmB', z:-30, shapes:back_.upper};
  parts.forearmB = {bone:'forearmB', z:-31, shapes:back_.fore};
  for (const v of ['open', 'fist']) parts[`handB:${v}`] = {bone:'handB', z:-29, shapes:handShapes(v, true)};

  // ---- Legs: trousers capsules (hidden under a long skirt), boots with a toe toward +x ----
  const legR = limb * 1.25 * (b.legs ?? 1);
  const skirted = !!person.clothing.skirt;
  const legShapes = (back) => {
    const k = back ? 'Shade' : '';
    const thigh = skirted ? [] : [fill('trousers' + k, {path:capsule([0, 0], [0, P.thigh], legR * 1.05, legR * 0.92)})];
    if (shade && !back && !skirted) thigh.push({path:capsule([-legR * 0.6, 0], [-legR * 0.5, P.thigh], legR * 0.5, legR * 0.45), fill:'trousersShade', line:false, clip:true});
    const shin = skirted ? [fill('stockings' + k, {path:capsule([0, P.shin * 0.55], [0, P.shin], legR * 0.55, legR * 0.5)})] : [fill('trousers' + k, {path:capsule([0, 0], [0, P.shin], legR * 0.92, legR * 0.82)})];
    if (F.joints === 'brads' && !skirted) { thigh.push({ellipse:[0, 0, limb * 0.24, limb * 0.24], fill:'accent', line:false}); shin.push({ellipse:[0, 0, limb * 0.22, limb * 0.22], fill:'accent', line:false}); }
    const toe = P.H * 0.075;
    const boot = [fill('boots' + k, {path:rounded([[-legR * 0.9, -legR * 0.4], [legR * 0.8, -legR * 0.4], [toe, P.foot * 0.25], [toe * 1.02, P.foot], [-legR * 1.05, P.foot]], cr(legR * 0.7))})];
    if (!back) boot.push({path:rounded([[-legR * 1.05, P.foot * 0.78], [toe * 1.02, P.foot * 0.78], [toe * 1.02, P.foot], [-legR * 1.05, P.foot]], 4), fill:'bootShade', line:false});
    return {thigh, shin, boot};
  };
  const lf = legShapes(false), lb = legShapes(true);
  parts.thighF = {bone:'thighF', z:-10, shapes:lf.thigh}; parts.shinF = {bone:'shinF', z:-11, shapes:lf.shin}; parts.bootF = {bone:'bootF', z:-9, shapes:lf.boot};
  parts.thighB = {bone:'thighB', z:-20, shapes:lb.thigh}; parts.shinB = {bone:'shinB', z:-21, shapes:lb.shin}; parts.bootB = {bone:'bootB', z:-19, shapes:lb.boot};

  const eyesY = eye[1], browY = eyesY - eyeR * 1.55, mouthY = hc[1] + hh * 0.5;
  return {
    version:1, id:person.id, name:person.name, family, description:person.description,
    generated:{by:'tools/characters/design.mjs', family:F.label, spec:person.id},
    heightM:P.H / 1000, palette:c, outlineMm:F.lineMm, expressionScale:F.expressionScale,
    render:{mode:'flat-tinted', outlinePx:F.outlinePx, outlineColor:c.line, faceDetail:F.faceDetail},
    rig:{heightMm:P.H, hipY:P.hipY, neckHeight:P.neckHeight, headCenter:P.neckLen + hh, shoulderHeight:P.shoulderHeight,
      shoulderF:[Math.round(shW * 0.18), 0], shoulderB:[-Math.round(shW * 0.2), 0], hipF:[Math.round(hipW * 0.12), 0], hipB:[-Math.round(hipW * 0.16), 0],
      upperArm:P.upperArm, forearm:P.forearm, hand:P.hand, thigh:P.thigh, shin:P.shin},
    parts,
    anchors:{head:[0, 0], eyes:[r1(eye[0]), r1(eyesY)], pupils:[r1(eye[0]), r1(eyesY)], brows:[r1(eye[0]), r1(browY)], mouth:[r1(hc[0] + hw * 0.5), r1(mouthY)], cap:[0, 0]}
  };
}
