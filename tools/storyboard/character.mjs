import { Vector3, Plane, Ray, MathUtils } from 'three';
import { ease } from './easing.mjs';
import { propWorldBox } from './actions.mjs';

/*
 * Pure 2D-cutout character evaluation, shared by validation (Node) and rendering (browser).
 * Rig space: millimetres, feet at (0,0), y up, +x is the direction the character faces.
 * Pose angles are degrees: limbs hang straight down at 0 and positive swings them forward;
 * `torso`/`head` positive lean forward; `knee`/`elbow` positive bend the joint naturally.
 */
export const CHARACTER_ACTIONS = ['place', 'walk', 'pose', 'push', 'touch', 'look', 'expression'];
export const INSTANT_CHARACTER_ACTIONS = new Set(['place', 'look', 'expression']);
const TURN_FRAMES = 5;
// Hands are solved onto the prop for this many frames; after the shove the prop leaves them (follow-through)
export const PUSH_CONTACT_FRAMES = 4;
const BLEND_FRAMES = 7;
const RELEASE_FRAMES = 10;

const NEUTRAL = {hipDrop:0, torso:3, head:0, armF:[8, 14], armB:[-6, 12], legF:[3, 3], legB:[-3, 3], handF:'open', handB:'open', squash:1, face:'neutral'};
export const POSE_PRESETS = {
  idle:{},
  think:{torso:-2, head:-8, armF:[28, 128], handF:'fist', armB:[-14, 60], face:'curious', look:[0.3, 0.6]},
  point:{torso:6, head:-4, armF:[96, 4], handF:'point', armB:[-12, 20], face:'happy'},
  present:{torso:4, armF:[62, 30], handF:'open', face:'happy'},
  ready:{hipDrop:50, torso:20, head:-14, armF:[56, 52], armB:[50, 56], legF:[30, 52], legB:[-12, 40], handF:'open', handB:'open', face:'effort', squash:0.96},
  push:{hipDrop:45, torso:32, head:-6, armF:[84, 6], armB:[80, 8], legF:[34, 40], legB:[-34, 6], face:'effort', squash:1.04},
  'thumbs-up':{torso:-2, armF:[48, 104], handF:'thumbs', armB:[-10, 18], face:'proud'},
  surprised:{torso:-10, head:-6, armF:[36, 92], armB:[30, 96], face:'surprised', squash:1.06},
  shrug:{torso:-2, head:6, armF:[22, 118], armB:[18, 118], handF:'open', handB:'open', face:'curious'}
};
// Anticipation: a small counter-move before the main pose, the classic wind-up
const ANTICIPATION = {point:{torso:-4, armF:[-10, 40]}, 'thumbs-up':{hipDrop:20, armF:[20, 60]}, surprised:{hipDrop:30, squash:0.9}, present:{armF:[20, 50]}};
export const FACES = {
  neutral:{mouth:'neutral', brow:0, browTilt:0},
  happy:{mouth:'smile', brow:6, browTilt:-4},
  proud:{mouth:'grin', brow:8, browTilt:-6},
  curious:{mouth:'hmm', brow:12, browTilt:10},
  surprised:{mouth:'oh', brow:22, browTilt:0},
  effort:{mouth:'grit', brow:-10, browTilt:12},
  // The approved cooper's core set (characters/cooper.json); cutout rigs map them onto their nearest mouths
  speaking:{mouth:'grin', brow:4, browTilt:0},
  concerned:{mouth:'hmm', brow:4, browTilt:14},
  thinking:{mouth:'hmm', brow:6, browTilt:8},
  confused:{mouth:'oh', brow:10, browTilt:10},
  determined:{mouth:'grit', brow:-8, browTilt:14},
  realization:{mouth:'grin', brow:16, browTilt:0},
  disappointed:{mouth:'hmm', brow:0, browTilt:-10}
};
// Hands rest on a prop for a touch: reach in over these frames, then hold until the action ends
const TOUCH_REACH_FRAMES = 12;
// Gaze (eyes and the vector rig's head turn) eases toward its target instead of snapping
const GAZE_FOLLOW = 0.22;

const lerp = MathUtils.lerp;
function mixPose(a, b, t) {
  const out = {};
  for (const key of Object.keys(NEUTRAL)) {
    const x = a[key] ?? NEUTRAL[key], y = b[key] ?? NEUTRAL[key];
    if (Array.isArray(x)) out[key] = x.map((v, i) => lerp(v, y[i], t));
    else if (typeof x === 'number') out[key] = lerp(x, y, t);
    else out[key] = t < 0.5 ? x : y;
  }
  return out;
}
const preset = name => ({...NEUTRAL, ...(POSE_PRESETS[name] ?? (() => { throw new Error(`Unknown pose preset: ${name}`); })())});

// Deterministic per-character noise for blinks, so renders and validation agree
function hash(n) { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function solveTwoBone(target, upper, lower) {
  // target: vector from shoulder in rig space (mm). Returns limb angles (forward swing, elbow bend) and reach error
  const d = Math.hypot(target.x, target.y), reach = upper + lower;
  const clamped = Math.min(d, reach * 0.999);
  const elbow = Math.PI - Math.acos(MathUtils.clamp((upper * upper + lower * lower - clamped * clamped) / (2 * upper * lower), -1, 1));
  const base = Math.atan2(target.x, -target.y);
  const offset = Math.asin(MathUtils.clamp(lower * Math.sin(Math.PI - elbow) / Math.max(clamped, 1e-6), -1, 1));
  // The elbow bends forward, so the upper arm sits back (clockwise) from the shoulder-to-target line
  return {upper:MathUtils.radToDeg(base - offset), elbow:MathUtils.radToDeg(elbow), shortfall:Math.max(0, d - reach)};
}

function propById(plan, id) {
  return plan.props.find(prop => prop.id === id);
}

// World point the character should face or reach: a prop id, "camera" or [x, z]
function targetPoint(plan, spec, frame, camera) {
  if (spec === 'camera') return camera.position.clone();
  if (Array.isArray(spec)) return new Vector3(spec[0], spec.length === 3 ? spec[1] : 0, spec.at(-1));
  const prop = propById(plan, spec);
  const box = prop && propWorldBox(prop, frame);
  return box ? box.getCenter(new Vector3()) : null;
}

/*
 * Placement helper: `near` puts the character beside a prop, `gap` metres from its surface on `side` (a world direction)
 */
function resolvePlacement(plan, params, frame) {
  if (params.position) return new Vector3(params.position[0], 0, params.position.at(-1));
  const box = propWorldBox(propById(plan, params.near), frame);
  if (!box) throw new Error(`Character placement: unknown or missing prop "${params.near}"`);
  const side = new Vector3(params.side[0], 0, params.side.at(-1)).normalize();
  const center = box.getCenter(new Vector3()).setY(0);
  const size = box.getSize(new Vector3());
  const half = Math.abs(side.x) * size.x / 2 + Math.abs(side.z) * size.z / 2;
  return center.addScaledVector(side, half + (params.gap ?? 0.25) + 0.12);
}

// The camera-facing plane through the character, and the camera's right vector in world space
function characterPlane(camera, position) {
  const toCamera = camera.position.clone().sub(position).setY(0).normalize();
  const right = new Vector3(toCamera.z, 0, -toCamera.x);
  return {normal:toCamera, right, plane:new Plane().setFromNormalAndCoplanarPoint(toCamera, position)};
}

/*
 * Full per-frame track for one cast member, simulated from frame 0 (springs, turns, blinks).
 * `cameraAt(frame)` supplies the camera so facing and contact can be resolved in screen terms.
 */
export function characterTrack(plan, member, cameraAt) {
  const def = member.definition;
  const units = def.heightM / def.rig.heightMm; // metres per rig millimetre
  // Pose presets are authored for a 410 mm hip height; crouch depth and bob scale with each body
  const bodyScale = def.rig.hipY / 410;
  const actions = [...member.actions].sort((a, b) => a.startFrame - b.startFrame);
  const states = [];
  let position = new Vector3(member.start.position[0], 0, member.start.position.at(-1));
  let facing = new Vector3(1, 0, 0), mirror = null, turnFrom = null, turnStart = -Infinity;
  let pose = {...NEUTRAL}, poseFrom = {...NEUTRAL}, poseTarget = {...NEUTRAL}, poseStart = 0, poseFrames = 1, poseEase = 'settle';
  let face = 'neutral', look = [0, 0], lookTarget = null, gaze = null;
  let walk = null, walkPhase = 0, step = null;
  let headSpring = {x:0, v:0}, capSpring = {x:0, v:0}, lastTorso = NEUTRAL.torso, lastX = 0;
  if (member.start.face) {
    const p = targetPoint(plan, member.start.face, 0, cameraAt(0));
    if (p) facing = p.clone().sub(position).setY(0).normalize();
  }
  const blinkSeed = [...def.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const cuts = new Set(plan.shots.slice(1).map(shot => shot.startFrame));
  for (let frame = 0; frame < plan.durationFrames; frame++) {
    const camera = cameraAt(frame);
    // A cut changes the camera, not the character: facing snaps to the new view instead of animating a turn
    if (cuts.has(frame)) { gaze = null; mirror = null; turnFrom = null; lastX = null; headSpring = {x:0, v:0}; capSpring = {x:0, v:0}; }
    for (const action of actions) {
      if (action.startFrame !== frame) continue;
      const p = action.params ?? {};
      if (action.type === 'place') {
        position = resolvePlacement(plan, p, frame);
        if (p.face) { const t = targetPoint(plan, p.face, frame, camera); if (t) facing = t.clone().sub(position).setY(0).normalize(); }
        headSpring = {x:0, v:0}; capSpring = {x:0, v:0}; mirror = null; // A placement happens on a cut: reset springs and facing
        walk = null; step = null; // ...and cancels any walk or step still in progress, so the placement wins
      } else if (action.type === 'walk') {
        const to = new Vector3(p.to[0], 0, p.to.at(-1));
        walk = {from:position.clone(), to, start:frame, end:action.endFrame, stride:p.stride ?? 0.5};
        facing = to.clone().sub(position).setY(0).normalize();
      } else if (action.type === 'pose' || action.type === 'push') {
        poseFrom = {...pose};
        poseTarget = preset(action.type === 'push' ? 'push' : p.preset);
        poseStart = frame; poseFrames = action.type === 'push' ? 3 : p.frames ?? BLEND_FRAMES; poseEase = action.type === 'push' ? 'out' : p.ease ?? 'settle';
        if (poseTarget.face) face = poseTarget.face;
        if (poseTarget.look) { look = poseTarget.look; lookTarget = null; }
        const target = p.target ?? p.prop;
        if (target) { const t = targetPoint(plan, target, frame, camera); if (t) { facing = t.clone().sub(position).setY(0).normalize(); lookTarget = target; } }
      } else if (action.type === 'look') lookTarget = p.at;
      else if (action.type === 'expression') face = p.face;
    }
    // Anticipation: blend toward the wind-up pose in the frames just before a pose or push starts
    const upcoming = actions.find(a => (a.type === 'pose' || a.type === 'push') && a.startFrame > frame && a.startFrame - frame <= (a.type === 'push' ? 10 : 5));
    // Release: after a timed pose ends, return to idle
    const releasing = actions.find(a => (a.type === 'pose' || a.type === 'push') && a.endFrame > a.startFrame && frame >= a.endFrame && frame < a.endFrame + RELEASE_FRAMES
      && !actions.some(b => (b.type === 'pose' || b.type === 'push') && b.startFrame > a.startFrame && b.startFrame <= frame));
    if (releasing && frame === releasing.endFrame) { poseFrom = {...pose}; poseTarget = {...NEUTRAL}; poseStart = frame; poseFrames = releasing.params.release ?? RELEASE_FRAMES; poseEase = 'dolly'; face = face === 'effort' ? 'proud' : face; }
    pose = mixPose(poseFrom, poseTarget, ease(poseEase, (frame - poseStart + 1) / poseFrames));
    pose.hipDrop *= bodyScale;
    if (upcoming) {
      const lead = upcoming.type === 'push' ? 10 : 5;
      const k = ease('sine', 1 - (upcoming.startFrame - frame) / lead);
      const wind = upcoming.type === 'push' ? preset('ready') : {...pose, ...(ANTICIPATION[upcoming.params?.preset] ?? {})};
      pose = mixPose(pose, {...wind, hipDrop:(wind.hipDrop ?? 0) * (upcoming.type === 'push' ? bodyScale : 1)}, k * (upcoming.type === 'push' ? 1 : 0.6));
      if (upcoming.type === 'push') {
        face = 'effort';
        // Step into the push: if the prop is beyond comfortable reach, lunge toward it during the wind-up
        if (!step || step.action !== upcoming) {
          const box = propWorldBox(propById(plan, upcoming.params.prop), upcoming.startFrame);
          const flat = box && box.clone(); if (flat) { flat.min.y = -1; flat.max.y = 1; }
          const gap = flat ? flat.distanceToPoint(position) : 0;
          const lunge = MathUtils.clamp(gap - def.heightM * 0.3, 0, 0.4);
          step = {action:upcoming, from:position.clone(), to:position.clone().addScaledVector(facing, lunge), start:frame, end:upcoming.startFrame};
        }
      }
    }
    if (step && frame <= step.end + 1 && !walk) position = step.from.clone().lerp(step.to, ease('cubic', Math.min(1, (frame - step.start + 1) / Math.max(1, step.end - step.start + 1))));

    // Locomotion: stride-driven cycle so feet never slide; bob and counter-swing arms
    let bob = 0;
    if (walk && frame >= walk.start) {
      const u = walk.end > walk.start ? Math.min(1, (frame - walk.start) / (walk.end - walk.start)) : 1;
      const eased = ease('sine', u);
      const previous = position.clone();
      position = walk.from.clone().lerp(walk.to, eased);
      walkPhase += previous.distanceTo(position) / walk.stride;
      const s = Math.sin(walkPhase * Math.PI), moving = u < 1 ? 1 : 0;
      pose.legF = [pose.legF[0] + 26 * s * moving, pose.legF[1] + 28 * Math.max(0, -s) * moving];
      pose.legB = [pose.legB[0] - 26 * s * moving, pose.legB[1] + 28 * Math.max(0, s) * moving];
      pose.armF = [pose.armF[0] - 18 * s * moving, pose.armF[1]];
      pose.armB = [pose.armB[0] + 18 * s * moving, pose.armB[1]];
      pose.torso += 5 * moving;
      bob = -14 * bodyScale * Math.abs(Math.cos(walkPhase * Math.PI)) * moving;
      if (u >= 1) walk = null;
    }

    // Push contact: two-bone IK puts both hands on the prop's visible edge, solved in the character plane
    let contact = null;
    const pushing = actions.find(a => a.type === 'push' && frame >= a.startFrame && frame < Math.min(a.endFrame, a.startFrame + (a.params.contactFrames ?? PUSH_CONTACT_FRAMES)));
    const {right, plane} = characterPlane(camera, position);
    const screenSign = Math.sign(facing.dot(right)) || 1;
    if (pushing) {
      const box = propWorldBox(propById(plan, pushing.params.prop), frame);
      if (box) {
        const height = box.min.y + (box.max.y - box.min.y) * (pushing.params.height ?? 0.55);
        // The point on the prop nearest the character's chest, at the push height: hands go where the body actually is
        const chest = position.clone().setY(height).addScaledVector(facing, 0.05);
        const edge = box.clampPoint(chest, new Vector3()).setY(height);
        const hit = new Ray(camera.position.clone(), edge.clone().sub(camera.position).normalize()).intersectPlane(plane, new Vector3());
        if (hit) {
          const local = hit.clone().sub(position);
          const along = local.dot(right) * screenSign / units, up = local.y / units;
          // Adaptive reach: bend further over the prop (lean, then crouch) until both hands arrive or the body's limits are hit
          for (let attempt = 0; attempt < 12; attempt++) {
            const hipY = def.rig.hipY - pose.hipDrop + bob;
            const torsoRad = MathUtils.degToRad(pose.torso);
            let worst = 0;
            for (const side of ['F', 'B']) {
              const [sx, sy] = shoulderPoint(def, side, hipY, torsoRad);
              const solved = solveTwoBone({x:along - sx, y:up - sy}, def.rig.upperArm, def.rig.forearm + def.rig.hand * 0.6);
              // Arms hang from the torso, which leans forward (clockwise): local swing = absolute + lean
              pose[`arm${side}`] = [solved.upper + pose.torso, solved.elbow];
              worst = Math.max(worst, solved.shortfall);
            }
            contact = {point:edge.toArray(), shortfallM:worst * units, prop:pushing.params.prop};
            if (worst <= 0 || (pose.torso >= 66 && pose.hipDrop >= def.rig.hipY * 0.45)) break;
            if (pose.torso < 66) pose.torso = Math.min(66, pose.torso + 5);
            else pose.hipDrop = Math.min(def.rig.hipY * 0.45, pose.hipDrop + def.rig.hipY * 0.04);
          }
        }
      }
    }

    // Touch: one hand reaches onto a prop (by default its near top edge), rests there until the action ends, then releases
    const touching = actions.find(a => a.type === 'touch' && frame >= a.startFrame && frame < a.endFrame + (a.params.release ?? RELEASE_FRAMES));
    if (touching && !pushing) {
      const tp = touching.params, side = tp.hand ?? 'F';
      const box = propWorldBox(propById(plan, tp.prop), frame);
      if (box) {
        const reach = ease('sine', (frame - touching.startFrame + 1) / (tp.frames ?? TOUCH_REACH_FRAMES));
        const release = frame >= touching.endFrame ? 1 - ease('sine', (frame - touching.endFrame + 1) / (tp.release ?? RELEASE_FRAMES)) : 1;
        const w = Math.min(reach, release);
        const height = box.min.y + (box.max.y - box.min.y) * (tp.height ?? 1);
        const center = box.getCenter(new Vector3()).setY(height);
        const edge = box.clampPoint(position.clone().setY(height), new Vector3()).setY(height);
        // Rest the palm just inside the edge, so it sits on the rim rather than on the corner of the bounding box
        const inward = center.clone().sub(edge).setY(0);
        if (inward.lengthSq() > 1e-8) edge.addScaledVector(inward.normalize(), Math.min(tp.inset ?? 0.05, center.distanceTo(edge)));
        const hit = new Ray(camera.position.clone(), edge.clone().sub(camera.position).normalize()).intersectPlane(plane, new Vector3());
        if (hit) {
          const local = hit.clone().sub(position);
          const along = local.dot(right) * screenSign / units, up = local.y / units;
          const [sx, sy] = shoulderPoint(def, side, def.rig.hipY - pose.hipDrop + bob, MathUtils.degToRad(pose.torso));
          const solved = solveTwoBone({x:along - sx, y:up - sy}, def.rig.upperArm, def.rig.forearm + def.rig.hand * 0.6);
          const [upper, elbow] = pose[`arm${side}`];
          pose[`arm${side}`] = [lerp(upper, solved.upper + pose.torso, w), lerp(elbow, solved.elbow, w)];
          pose[side === 'F' ? 'handF' : 'handB'] = 'open';
          if (w >= 0.999) contact = {point:edge.toArray(), shortfallM:solved.shortfall * units, prop:tp.prop, hand:side};
        }
      }
    }

    // Facing on screen: mirror the cutout, animating a quick squash-turn when it flips mid-shot
    const wanted = screenSign;
    if (mirror === null) mirror = wanted;
    else if (wanted !== mirror && turnFrom === null) { turnFrom = mirror; turnStart = frame; }
    let turnScale = 1;
    if (turnFrom !== null) {
      const t = (frame - turnStart) / TURN_FRAMES;
      if (t >= 1) { mirror = wanted; turnFrom = null; }
      else turnScale = Math.abs(Math.cos(t * Math.PI)) * 0.85 + 0.15, mirror = t < 0.5 ? turnFrom : wanted;
    }

    // Secondary motion: the head lags torso changes and the cap tip lags the head (damped springs)
    const torsoVelocity = pose.torso - lastTorso; lastTorso = pose.torso;
    // Screen-space drift drives the cap; after a cut there is no previous screen position to compare with
    const xVelocity = lastX === null ? 0 : (position.dot(right) - lastX) / units; lastX = position.dot(right);
    for (const [spring, drive, k, damping] of [[headSpring, -torsoVelocity * 2.2, 0.25, 0.72], [capSpring, -torsoVelocity * 3 - xVelocity * 0.08 * screenSign, 0.2, 0.75]]) {
      spring.v = (spring.v + drive - spring.x * k) * damping;
      spring.x = MathUtils.clamp(spring.x + spring.v, -14, 14); // Follow-through stays a nudge, never a spin
    }

    // Eyes track a target in screen terms; blinks are deterministic and avoid the frames of a push
    let lookVec = look;
    if (lookTarget) {
      const t = targetPoint(plan, lookTarget, frame, camera);
      if (t) {
        const headPos = position.clone().setY(def.heightM * 0.8);
        const d = t.clone().sub(headPos);
        lookVec = [MathUtils.clamp(d.dot(right) * mirror / Math.max(0.3, d.length()), -1, 1), MathUtils.clamp(d.y / Math.max(0.3, d.length()) * 1.5, -1, 1)];
      }
    }
    gaze = gaze ? gaze.map((g, i) => g + (lookVec[i] - g) * GAZE_FOLLOW) : [...lookVec];
    const blinkCycle = Math.floor(frame / 90), blinkAt = blinkCycle * 90 + Math.floor(hash(blinkSeed + blinkCycle) * 60) + 10;
    const blink = !pushing && frame >= blinkAt && frame < blinkAt + 5 ? Math.sin((frame - blinkAt + 0.5) / 5 * Math.PI) : 0;
    const breathe = Math.sin(frame / plan.fps * 2 * Math.PI / 3.2) * 0.012;

    states.push({
      frame, position:position.toArray(), facing:facing.toArray(), mirror, turnScale,
      pose:{...pose, hipDrop:pose.hipDrop - bob, head:pose.head + headSpring.x, cap:capSpring.x, squash:pose.squash * (1 + breathe)},
      face:FACES[face] ? face : 'neutral', look:lookVec, gaze:[...gaze], blink, contact, heightM:def.heightM
    });
  }
  return states;
}

// The shoulder pivot rotates with the torso about the hip (torso lean is clockwise)
function shoulderPoint(def, side, hipY, torsoRad) {
  const x = def.rig[`shoulder${side}`][0], h = def.rig.shoulderHeight;
  return [x * Math.cos(torsoRad) + h * Math.sin(torsoRad), hipY - x * Math.sin(torsoRad) + h * Math.cos(torsoRad)];
}

// Forward kinematics of the key points (rig mm) for validation and IK checks: hips, neck, head centre, hands
export function rigPoints(def, pose) {
  const hipY = def.rig.hipY - pose.hipDrop;
  const t = MathUtils.degToRad(pose.torso);
  const neck = [Math.sin(t) * def.rig.neckHeight, hipY + Math.cos(t) * def.rig.neckHeight];
  const headCenter = [neck[0] + Math.sin(t) * def.rig.headCenter, neck[1] + Math.cos(t) * def.rig.headCenter];
  const hand = side => {
    const s = shoulderPoint(def, side, hipY, t);
    const [upper, elbow] = pose[`arm${side}`];
    const a1 = MathUtils.degToRad(upper - pose.torso), a2 = a1 + MathUtils.degToRad(elbow);
    const e = [s[0] + Math.sin(a1) * def.rig.upperArm, s[1] - Math.cos(a1) * def.rig.upperArm];
    return [e[0] + Math.sin(a2) * (def.rig.forearm + def.rig.hand * 0.6), e[1] - Math.cos(a2) * (def.rig.forearm + def.rig.hand * 0.6)];
  };
  return {hip:[0, hipY], neck, headCenter, handF:hand('F'), handB:hand('B')};
}
