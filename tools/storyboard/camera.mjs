import { Vector3, Box3, MathUtils, Quaternion, Matrix4 } from 'three';
import { ease } from './easing.mjs';
import { propWorldBox, propWorldPoints } from './actions.mjs';

// How much of the frame the subject should fill (fraction of the limiting dimension)
export const FRAMING = {wide:0.4, medium:0.62, close:0.88, detail:1.8};
export const FRAMING_ORDER = ['wide', 'medium', 'close', 'detail'];
export const LENSES = {wide:55, normal:40, tele:26};
export const BEHAVIORS = ['hold', 'push-in', 'pullback', 'orbit', 'track', 'follow', 'reveal', 'whip-pan'];
export const WHIP_FRAMES = 8;
// A whip transition swings at least this far (so it reads as a whip) and at most this far (so it stays legible)
export const WHIP_MIN_DEG = 45, WHIP_MAX_DEG = 90;
const UP = new Vector3(0, 1, 0);
const v3 = array => new Vector3(...array);

// Azimuth 0 looks from +Z toward the subject, 90 from +X; elevation is degrees above the horizon
export function direction(azimuth, elevation) {
  const a = MathUtils.degToRad(azimuth), e = MathUtils.degToRad(elevation);
  return new Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
}

export function focusPoint(box, focus = [0, 0, 0]) {
  const size = box.getSize(new Vector3());
  return box.getCenter(new Vector3()).add(new Vector3(focus[0] * size.x, focus[1] * size.y, focus[2] * size.z));
}

const boxPoints = box => [box.min.x, box.max.x].flatMap(x => [box.min.y, box.max.y].flatMap(y => [box.min.z, box.max.z].map(z => new Vector3(x, y, z))));

// Solves the camera distance that makes the subject's silhouette fill the requested framing at this angle and lens
export function framedPose(box, {framing = 'medium', azimuth = 0, elevation = 8, focus, fov = LENSES.normal}, aspect, points = boxPoints(box)) {
  const forward = direction(azimuth, elevation).negate();
  const right = new Vector3().crossVectors(forward, UP).normalize();
  const up = new Vector3().crossVectors(right, forward);
  const extent = axis => { const values = points.map(p => p.dot(axis)); return Math.max(...values) - Math.min(...values); };
  const width = extent(right), height = extent(up), depth = extent(forward);
  const tanV = Math.tan(MathUtils.degToRad(fov) / 2), tanH = tanV * aspect;
  const fill = FRAMING[framing];
  if (!fill) throw new Error(`Unknown framing: ${framing}`);
  const distance = Math.max(height / 2 / (fill * tanV), width / 2 / (fill * tanH)) + depth / 2;
  return {target:focusPoint(box, focus), azimuth, elevation, distance, fov};
}

const poseToCamera = pose => ({position:pose.target.clone().addScaledVector(direction(pose.azimuth, pose.elevation), pose.distance), target:pose.target.clone(), fov:pose.fov});

function blend(a, b, u) {
  let delta = b.azimuth - a.azimuth;
  delta -= Math.round(delta / 360) * 360; // Shortest way round unless an orbit asks for more
  return {target:a.target.clone().lerp(b.target, u), azimuth:a.azimuth + (b.azimuthRaw ?? delta) * u,
    elevation:MathUtils.lerp(a.elevation, b.elevation, u), distance:MathUtils.lerp(a.distance, b.distance, u), fov:MathUtils.lerp(a.fov, b.fov, u)};
}

export function moveProgress(camera, frame) {
  const [from, to] = camera.window;
  if (to <= from) return frame >= from ? 1 : 0;
  return ease(camera.ease, (frame - from) / (to - from));
}

const subjectPoints = (plan, id, frame) => {
  const prop = plan.props.find(candidate => candidate.id === id);
  return prop?.bounds ? propWorldPoints(prop, frame) : undefined;
};

const subjectBox = (plan, id, frame) => {
  const prop = plan.props.find(candidate => candidate.id === id);
  return prop?.bounds ? propWorldBox(prop, frame) : prop?.sizeHint ? new Box3().setFromCenterAndSize(v3(prop.base.position).add(new Vector3(0, prop.sizeHint[1] / 2, 0)), v3(prop.sizeHint)) : null;
};

// The start and end framing of a shot, measured on the subject as it stands at the move's start and end
export function shotPoses(plan, shot) {
  const c = shot.camera;
  const aspect = plan.size.width / plan.size.height;
  const startBox = subjectBox(plan, shot.subject, c.window[0]) ?? new Box3(new Vector3(-0.5, 0, -0.5), new Vector3(0.5, 1, 0.5));
  const endBox = subjectBox(plan, shot.subject, c.window[1]) ?? startBox;
  const start = framedPose(startBox, c.from, aspect, subjectPoints(plan, shot.subject, c.window[0]));
  const end = framedPose(endBox, c.to, aspect, subjectPoints(plan, shot.subject, c.window[1]));
  if (shot.camera.behavior === 'orbit') end.azimuthRaw = c.to.azimuth - c.from.azimuth;
  const fromBox = c.from.prop ? subjectBox(plan, c.from.prop, c.window[0]) : null;
  if (fromBox) start.target = focusPoint(fromBox, c.from.focus);
  return {start, end};
}

// Critically damped spring, simulated frame by frame from the shot start so it is deterministic
const followCache = new WeakMap();
function followTrack(plan, shot) {
  if (followCache.has(shot)) return followCache.get(shot);
  const {start} = shotPoses(plan, shot);
  const offset = direction(start.azimuth, start.elevation).multiplyScalar(start.distance);
  const lag = shot.camera.params.lag ?? 0.25;
  const omega = 2 / lag, dt = 1 / plan.fps;
  const goal = frame => focusPoint(subjectBox(plan, shot.subject, frame), shot.camera.from.focus);
  let target = goal(shot.startFrame), velocity = new Vector3();
  const track = [];
  for (let frame = shot.startFrame; frame < shot.endFrame; frame++) {
    const desired = goal(frame);
    const x = omega * dt, decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    const change = target.clone().sub(desired);
    const temp = velocity.clone().addScaledVector(change, omega).multiplyScalar(dt);
    velocity = velocity.clone().addScaledVector(temp, -omega).multiplyScalar(decay);
    target = desired.clone().add(change.add(temp).multiplyScalar(decay));
    track.push({target:target.clone(), position:target.clone().add(offset), fov:start.fov});
  }
  followCache.set(shot, track);
  return track;
}

function behaviorCamera(plan, shot, frame) {
  const c = shot.camera;
  const u = moveProgress(c, frame);
  const {start, end} = shotPoses(plan, shot);
  switch (c.behavior) {
    case 'hold': return poseToCamera(start);
    case 'push-in': case 'pullback': case 'orbit': case 'reveal': return poseToCamera(blend(start, end, u));
    case 'track': {
      const pose = poseToCamera(blend(start, end, u));
      const right = new Vector3().crossVectors(UP, direction(start.azimuth, 0)).normalize();
      const sign = c.params.direction === 'left' ? -1 : 1;
      const shift = right.multiplyScalar(sign * MathUtils.lerp(-c.params.distance / 2, c.params.distance / 2, u));
      pose.position.add(shift);
      if (!c.params.pan) pose.target.add(shift); // Parallel truck: foreground slides past; pan keeps the subject centred
      return pose;
    }
    case 'follow': return followTrack(plan, shot)[Math.max(0, Math.min(Math.floor(frame) - shot.startFrame, shot.endFrame - shot.startFrame - 1))];
    case 'whip-pan': {
      const pose = poseToCamera(end);
      const fromBox = subjectBox(plan, c.params.from, c.window[0]);
      return fromBox ? {...pose, target:whipTarget(pose.position, focusPoint(fromBox), pose.target, u)} : pose;
    }
    default: throw new Error(`Unknown camera behavior: ${c.behavior}`);
  }
}

// Rotates the look direction (not the position) between two targets, as a real whip pan does
function whipTarget(position, fromTarget, toTarget, u) {
  const look = (target) => new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(position, target, UP));
  const q = look(fromTarget).slerp(look(toTarget), u);
  const distance = MathUtils.lerp(position.distanceTo(fromTarget), position.distanceTo(toTarget), u);
  return position.clone().add(new Vector3(0, 0, -1).applyQuaternion(q).multiplyScalar(distance));
}

// The incoming look direction: the final one yawed (a pan, never a tilt) toward where the previous shot looked, by 45-90 degrees
export function whipStartDirection(fromDir, toDir) {
  const flat = v => new Vector3(v.x, 0, v.z).normalize();
  const from = flat(fromDir), to = flat(toDir);
  let yaw = Math.atan2(new Vector3().crossVectors(to, from).y, to.dot(from));
  if (!Number.isFinite(yaw) || Math.abs(yaw) < 1e-3) yaw = 1e-3; // Same heading: whip in from the left
  const swing = Math.sign(yaw) * MathUtils.clamp(Math.abs(yaw), MathUtils.degToRad(WHIP_MIN_DEG), MathUtils.degToRad(WHIP_MAX_DEG));
  return toDir.clone().applyAxisAngle(UP, swing);
}

export function cameraAt(plan, shotIndex, frame) {
  const shot = plan.shots[shotIndex];
  const camera = behaviorCamera(plan, shot, frame);
  const whip = shot.transition?.type === 'whip' && shotIndex > 0 ? shot.transition.frames ?? WHIP_FRAMES : 0;
  if (whip && frame < shot.startFrame + whip) {
    // Whip in from the direction the previous shot was looking, already at speed on the cut, decelerating onto the subject
    const previous = plan.shots[shotIndex - 1];
    const before = cameraAt(plan, shotIndex - 1, previous.endFrame - 1);
    const fromDir = before.target.clone().sub(before.position).normalize();
    const toDir = camera.target.clone().sub(camera.position).normalize();
    const startDir = whipStartDirection(fromDir, toDir);
    const u = ease('whipIn', (frame - shot.startFrame) / whip);
    const dir = startDir.clone().applyQuaternion(new Quaternion().slerp(new Quaternion().setFromUnitVectors(startDir, toDir), u));
    return {...camera, target:camera.position.clone().addScaledVector(dir, camera.position.distanceTo(camera.target)), whip:true};
  }
  const [from, to] = shot.camera.window;
  return {...camera, whip:shot.camera.behavior === 'whip-pan' && frame >= from && frame <= to};
}
