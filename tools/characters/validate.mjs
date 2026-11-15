import { figureIssues } from './rig-checks.mjs';
import { FACES } from '../storyboard/character.mjs';
import { FACE_FALLBACK } from './figure.mjs';

// Static checks on a character definition (review assistance, not approval)
export const REQUIRED_PARTS = ['torso', 'head', 'cap', 'eyes', 'pupils', 'brows',
  ...['neutral', 'smile', 'grin', 'oh', 'grit', 'hmm'].map(m => `mouth:${m}`), 'upperArmF', 'forearmF', ...['open', 'fist', 'point', 'thumbs'].map(h => `hand:${h}`),
  'upperArmB', 'forearmB', 'handB:open', 'handB:fist', 'thighF', 'shinF', 'bootF', 'thighB', 'shinB', 'bootB'];
const CLOTHING_PARTS = /^(torso|upperArm|forearm|thigh|shin|boot|cap)/;
const NON_CLOTHING_KEYS = /^(skin|hair|eyeWhite|pupil|mouth|teeth|tongue|highlight|line|outline)/;
export const LIMITS = {maxClothingColors:5, maxClothingSaturation:0.62, minValueSeparation:0.08, minEyeShare:0.07, minAdultHeadRatio:3.3};

function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
const luma = hex => { const [r, g, b] = hexToRgb(hex).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
function saturation(hex) { const c = hexToRgb(hex), max = Math.max(...c), min = Math.min(...c), l = (max + min) / 2; return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1)); }

function bounds(part) {
  const all = part.shapes.map(s => {
    if (s.ellipse) { const [cx, cy, rx, ry] = s.ellipse; return [cx - rx, cy - ry, cx + rx, cy + ry]; }
    const n = s.path.match(/-?\d+(\.\d+)?/g).map(Number), xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
    const pad = s.width ? s.width / 2 : 0;
    return [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  });
  return all.length ? all.reduce((a, s) => [Math.min(a[0], s[0]), Math.min(a[1], s[1]), Math.max(a[2], s[2]), Math.max(a[3], s[3])]) : null;
}
const covers = (b, [x, y], margin = 2) => b && x >= b[0] - margin && x <= b[2] + margin && y >= b[1] - margin && y <= b[3] + margin;

// Hybrid definitions (3D body forms + 2D face) have forms instead of drawn parts
function validateHybrid(def) {
  const errors = [], warnings = [];
  const F = def.forms ?? {}, R = def.rig ?? {}, pal = def.palette ?? {};
  for (const key of ['torso', 'head', 'neck', 'face', 'arm', 'leg', 'boot']) if (!F[key]) errors.push({code:'MISSING_FORM', message:`${def.id} has no ${key} form`});
  for (const key of ['skin', 'shirt', 'trousers', 'boots', 'line']) if (!pal[key]) errors.push({code:'UNKNOWN_COLOR', message:`${def.id} palette lacks ${key}`});
  if (errors.length) return {status:'failed', errors, warnings, metrics:{}};
  // Joints stay closed when limb capsule radii exceed half the gap between neighbouring pivots (always true for spheres on pivots)
  if (F.shoulderSpan / 2 - F.arm.upper > F.torso.width / 2) errors.push({code:'JOINT_GAP', message:`${def.id}: arms hang clear of the torso`});
  const clothing = new Set(['shirt', 'apron', 'trousers', 'cap', 'boots', 'vest', 'coat'].filter(k => pal[k]).map(k => pal[k].toLowerCase()));
  if (clothing.size > 3) warnings.push({code:'TOO_MANY_COLORS', message:`${def.id} uses ${clothing.size} clothing colours (limit 3 for this experiment)`});
  const maxSat = Math.max(0, ...[...clothing].map(saturation));
  if (maxSat > LIMITS.maxClothingSaturation) warnings.push({code:'SATURATED_COLOR', message:`${def.id}: clothing saturation ${maxSat.toFixed(2)}`});
  for (const [a, b] of [['skin', 'shirt'], ['shirt', 'apron'], ['apron', 'trousers']]) {
    if (pal[a] && pal[b] && Math.abs(luma(pal[a]) - luma(pal[b])) < LIMITS.minValueSeparation) warnings.push({code:'LOW_VALUE_SEPARATION', message:`${def.id}: ${a} and ${b} are too close in value`});
  }
  const headRatio = R.heightMm / F.head.height;
  if (headRatio < LIMITS.minAdultHeadRatio) warnings.push({code:'CHILDLIKE_PROPORTIONS', message:`${def.id}: ${headRatio.toFixed(1)} heads tall`});
  const eyeShare = F.face.eyes.height / F.head.height;
  if (eyeShare < 0.06) warnings.push({code:'FEATURES_TOO_SMALL', message:`${def.id}: eyes are ${(eyeShare * 100).toFixed(1)}% of head height`});
  return {status:errors.length ? 'failed' : warnings.length ? 'review' : 'pass', errors, warnings,
    metrics:{headRatio:Math.round(headRatio * 10) / 10, clothingColors:clothing.size, maxClothingSaturation:Math.round(maxSat * 100) / 100, eyeShare:Math.round(eyeShare * 1000) / 1000}};
}

// Vector definitions (one figure painted per frame): structure, palette, expressions, and the painted joints in a neutral pose
export const VECTOR_REQUIRED = {
  rig:['heightMm', 'hipY', 'neckHeight', 'headCenter', 'shoulderHeight', 'shoulderF', 'shoulderB', 'hipF', 'hipB', 'upperArm', 'forearm', 'hand', 'thigh', 'shin', 'ankle'],
  palette:['skin', 'shirt', 'cap', 'hair', 'apron', 'trousers', 'line', 'buttons', 'boots', 'mouth', 'tongue'],
  forms:['head', 'neck', 'hair', 'cap', 'torso', 'collar', 'apron', 'arm', 'leg', 'boot'],
  expressions:['neutral', 'happy', 'surprised', 'concerned']
};
export const NEUTRAL_STATE = {pose:{hipDrop:0, torso:3, head:0, armF:[8, 14], armB:[-6, 12], legF:[3, 3], legB:[-3, 3], handF:'open', handB:'open', squash:1}, face:'neutral', blink:0, gaze:[0, 0]};
function validateVector(def) {
  const errors = [], warnings = [];
  for (const [group, keys] of Object.entries(VECTOR_REQUIRED)) for (const key of keys) {
    if (def[group]?.[key] === undefined) errors.push({code:group === 'palette' ? 'UNKNOWN_COLOR' : group === 'expressions' ? 'MISSING_EXPRESSION' : 'MISSING_FORM', message:`${def.id} has no ${group}.${key}`});
  }
  if (errors.length) return {status:'failed', errors, warnings, metrics:{}};
  for (const [name, color] of Object.entries(def.palette)) if (!/^#[0-9a-f]{6}$/i.test(color)) errors.push({code:'UNKNOWN_COLOR', message:`${def.id}: palette.${name} "${color}" is not a colour`});
  // Every face the storyboard can ask for must resolve to one of this character's expressions
  for (const face of Object.keys(FACES)) if (!def.expressions[face] && !def.expressions[def.faceMap?.[face]] && !def.expressions[FACE_FALLBACK[face]]) errors.push({code:'MISSING_EXPRESSION', message:`${def.id}: storyboard face "${face}" has no expression or faceMap entry`});
  for (const face of Object.keys(def.expressions)) for (const issue of figureIssues(def, {...NEUTRAL_STATE, face}).issues) errors.push({...issue, message:`${def.id} (${face}): ${issue.message}`});
  const {figure} = figureIssues(def, NEUTRAL_STATE);
  const head = figure.items.find(i => i.id === 'head').shapes[0].pts, chin = Math.min(...head.map(p => p[1]));
  const headRatio = figure.bounds[3] / (figure.bounds[3] - chin);
  if (Math.abs(figure.bounds[3] - def.rig.heightMm) > def.rig.heightMm * 0.03) warnings.push({code:'HEIGHT_MISMATCH', message:`${def.id}: painted height ${Math.round(figure.bounds[3])} mm vs rig.heightMm ${def.rig.heightMm}`});
  return {status:errors.length ? 'failed' : warnings.length ? 'review' : 'pass', errors, warnings,
    metrics:{headRatio:Math.round(headRatio * 100) / 100, paintedHeightMm:Math.round(figure.bounds[3]), expressions:Object.keys(def.expressions).length, parts:figure.items.length}};
}

export function validateDefinition(def) {
  if (def.render?.mode === 'vector-2d') return validateVector(def);
  if (def.render?.mode === 'hybrid-3d') return validateHybrid(def);
  const errors = [], warnings = [];
  for (const name of REQUIRED_PARTS) if (!def.parts?.[name]) errors.push({code:'MISSING_PART', message:`${def.id} has no ${name}`});
  for (const [name, part] of Object.entries(def.parts ?? {})) for (const s of part.shapes) for (const key of [s.fill, s.stroke].filter(Boolean)) {
    if (!['line', 'outline'].includes(key) && !def.palette[key]) errors.push({code:'UNKNOWN_COLOR', message:`${def.id}.${name} uses "${key}", which is not in the palette`});
  }

  // Joints: each child's pivot must sit inside its parent's art, or the limb visibly detaches when it rotates
  const R = def.rig, p = def.parts;
  const skirted = p.thighF && !p.thighF.shapes.length;
  const joints = [
    ['torso', [R.shoulderF[0], -R.shoulderHeight], 'shoulder'], ['torso', [0, -R.neckHeight], 'neck'],
    ['upperArmF', [0, R.upperArm], 'elbow'], ['forearmF', [0, R.forearm], 'wrist'], ['upperArmB', [0, R.upperArm], 'back elbow'], ['forearmB', [0, R.forearm], 'back wrist'],
    ...(skirted ? [] : [['thighF', [0, R.thigh], 'knee'], ['thighB', [0, R.thigh], 'back knee']]), ['shinF', [0, R.shin], 'ankle'], ['shinB', [0, R.shin], 'back ankle']
  ];
  for (const [parent, point, label] of joints) if (p[parent] && !covers(bounds(p[parent]), point)) errors.push({code:'JOINT_GAP', message:`${def.id}: the ${label} pivot (${point.map(Math.round).join(', ')}) is outside ${parent}'s art`});

  // Face legibility: eye height as a share of head height (phone-size readability)
  const eyeBounds = bounds(p.eyes ?? {shapes:[]}), headH = R.heightMm / (def.heightM * 1000) * (bounds(p.head)?.[3] - bounds(p.head)?.[1]);
  const eyeShare = eyeBounds && headH ? (eyeBounds[3] - eyeBounds[1]) / headH : 0;
  if (eyeShare < LIMITS.minEyeShare) warnings.push({code:'FEATURES_TOO_SMALL', message:`${def.id}: eyes are ${(eyeShare * 100).toFixed(1)}% of head height; faces will not read on a phone`});

  // Colour discipline: distinct clothing colours, saturation, and value separation between big adjacent masses
  const clothing = new Set();
  for (const [name, part] of Object.entries(p)) if (CLOTHING_PARTS.test(name)) for (const s of part.shapes) {
    const key = s.fill ?? s.stroke;
    if (key && !NON_CLOTHING_KEYS.test(key) && !/Shade$/.test(key) && def.palette[key]) clothing.add(def.palette[key].toLowerCase());
  }
  if (clothing.size > LIMITS.maxClothingColors) warnings.push({code:'TOO_MANY_COLORS', message:`${def.id} uses ${clothing.size} clothing colours (limit ${LIMITS.maxClothingColors})`});
  const maxSat = Math.max(0, ...[...clothing].map(saturation));
  if (maxSat > LIMITS.maxClothingSaturation) warnings.push({code:'SATURATED_COLOR', message:`${def.id}: a clothing colour has saturation ${maxSat.toFixed(2)}, which reads as a children's cartoon`});
  const pal = def.palette;
  for (const [a, b] of [['shirt', 'apron'], ['apron', 'trousers'], ['shirt', 'trousers'], ['skin', 'shirt']]) {
    if (pal[a] && pal[b] && Math.abs(luma(pal[a]) - luma(pal[b])) < LIMITS.minValueSeparation) warnings.push({code:'LOW_VALUE_SEPARATION', message:`${def.id}: ${a} and ${b} are too close in value to separate`});
  }
  const headRatio = R.heightMm / (bounds(p.head)[3] - bounds(p.head)[1]);
  if (headRatio < LIMITS.minAdultHeadRatio && def.age !== 'child') warnings.push({code:'CHILDLIKE_PROPORTIONS', message:`${def.id}: ${headRatio.toFixed(1)} heads tall reads as a child`});

  return {status:errors.length ? 'failed' : warnings.length ? 'review' : 'pass', errors, warnings,
    metrics:{headRatio:Math.round(headRatio * 10) / 10, clothingColors:clothing.size, maxClothingSaturation:Math.round(maxSat * 100) / 100, eyeShare:Math.round(eyeShare * 1000) / 1000}};
}
