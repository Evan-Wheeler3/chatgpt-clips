import { PerspectiveCamera, Vector3, Ray, MathUtils, Box3 } from 'three';
import { samplePlan } from './sample.mjs';
import { propWorldBox, INSTANT_ACTIONS } from './actions.mjs';
import { FRAMING, focusPoint, moveProgress } from './camera.mjs';

// Vertical-short safe area in NDC: the bottom band carries captions and platform UI, the top band platform chrome
export const SAFE_AREA = {left:-0.8, right:0.8, bottom:-0.5, top:0.76};
const CAMERA_MARGIN_M = 0.05;
// A pop is an isolated spike; a jerk is a sudden change of camera speed (e.g. a move starting at full speed from a hold)
const POP_STEP_M = 0.3, POP_RATIO = 4, JERK_M_PER_FRAME = 0.12;
const SYNC_LEAD_FRAMES = 8, SYNC_LAG_FRAMES = 2;
const STATIC_SHOT_SEC = 2.0, DRIFT_FRACTION = 0.9;
// The subject should be at least this fraction of frame height, and closer than this share of the fog's far plane
const MIN_SUBJECT_HEIGHT = 0.12, MAX_FOG_DEPTH = 0.7;
// Across a continuity cut the viewer re-finds the subject; these are review triggers, not hard limits
const CUT_SCALE_RATIO = 2.0, CUT_SHIFT_NDC = 0.6;
const CUT_SOFT = {scale:1.6, shift:0.35, viewDeg:60, pitchDeg:8};
const DEAD_START_FRAMES = 12;
// Characters: body column for clipping, the largest believable frame-to-frame step, and push reach tolerance
const BODY_RADIUS_M = 0.14, CHARACTER_STEP_M = 0.15, CONTACT_TOLERANCE_M = 0.03, PUSH_SYNC_FRAMES = [-3, 6];
const CAPTION_BAND_TOP = SAFE_AREA.bottom;

// The point the shot is about: the subject's framed focus, interpolated along the move
function shotFocus(shot, box, frame) {
  const u = moveProgress(shot.camera, frame);
  const from = shot.camera.from.focus ?? [0, 0, 0], to = shot.camera.to.focus ?? [0, 0, 0];
  return focusPoint(box, from.map((value, i) => value + (to[i] - value) * u));
}

function projectPoint(cameraState, aspect, point) {
  const camera = new PerspectiveCamera(cameraState.fov, aspect, 0.02, 200);
  camera.position.copy(cameraState.position);
  camera.lookAt(cameraState.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return point.clone().project(camera);
}

function project(cameraState, aspect, box) {
  const camera = new PerspectiveCamera(cameraState.fov, aspect, 0.02, 200);
  camera.position.copy(cameraState.position);
  camera.lookAt(cameraState.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const points = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const local = new Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    points.push({behind:local.z > -0.02, ndc:new Vector3(x, y, z).project(camera)});
  }
  const center = box.getCenter(new Vector3()).project(camera);
  const front = points.filter(point => !point.behind).map(point => point.ndc);
  const xs = front.map(p => p.x), ys = front.map(p => p.y);
  return {center, behind:front.length === 0, minX:Math.min(...xs), maxX:Math.max(...xs), minY:Math.min(...ys), maxY:Math.max(...ys)};
}

const round2 = value => Math.round(value * 100) / 100;

// How the subject reads on screen at one frame: height share, centre, viewing direction in the subject's own frame, camera pitch
function cutView(sample, prop, aspect) {
  const box = prop?.bounds ? propWorldBox(prop, sample.frame) : null;
  if (!box) return null;
  const view = project(sample.camera, aspect, box);
  if (view.behind) return null;
  const state = sample.props.find(p => p.id === prop.id);
  const toCamera = sample.camera.position.clone().sub(box.getCenter(new Vector3())).normalize().applyQuaternion(state.quaternion.clone().invert());
  const look = sample.camera.target.clone().sub(sample.camera.position).normalize();
  // Size is the larger on-screen dimension (a barrel lying down is wide, not tall); position is the centre of what is visible
  const [x0, x1, y0, y1] = [Math.max(view.minX, -1), Math.min(view.maxX, 1), Math.max(view.minY, -1), Math.min(view.maxY, 1)];
  return {size:Math.max(x1 - x0, y1 - y0) / 2, center:{x:(x0 + x1) / 2, y:(y0 + y1) / 2}, view:toCamera, pitch:MathUtils.radToDeg(Math.asin(look.y))};
}

const inside = (point, area) => point.x >= area.left && point.x <= area.right && point.y >= area.bottom && point.y <= area.top;
const onScreen = point => Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && point.z < 1;

// Collapses per-frame findings into frame ranges so a reviewer sees "frames 120-134" rather than 15 copies
function rangeIssues(list) {
  const out = [];
  for (const issue of list) {
    const last = out.at(-1);
    if (last && last.code === issue.code && last.shot === issue.shot && last.subject === issue.subject && last.frames[1] === issue.frame - 1) last.frames[1] = issue.frame;
    else out.push({code:issue.code, shot:issue.shot, subject:issue.subject, frames:[issue.frame, issue.frame], message:issue.message});
  }
  return out;
}

export function validatePlan(plan) {
  const errors = [], warnings = [];
  const perFrameErrors = [], perFrameWarnings = [];
  const aspect = plan.size.width / plan.size.height;
  const fps = plan.fps;
  const propById = new Map(plan.props.map(prop => [prop.id, prop]));

  // Assets
  for (const miss of plan.missingAssets) errors.push({code:'MISSING_ASSET', prop:miss.prop, message:`No catalog asset for "${miss.query}" (prop ${miss.prop}); nothing was substituted`});

  // Timing and direction
  plan.shots.forEach((shot, i) => {
    const seconds = (shot.endFrame - shot.startFrame) / fps;
    if (i === 0 && shot.startFrame !== 0) errors.push({code:'TIMING_GAP', shot:shot.id, message:'First shot must start at frame 0'});
    if (i > 0 && shot.startFrame !== plan.shots[i - 1].endFrame) errors.push({code:'TIMING_GAP', shot:shot.id, message:'Shots must be contiguous'});
    if (seconds < plan.timing.minShotSec) errors.push({code:'SHOT_TOO_SHORT', shot:shot.id, message:`${seconds.toFixed(2)} s is shorter than ${plan.timing.minShotSec} s`});
    if (seconds > plan.timing.maxShotSec) warnings.push({code:'SHOT_LONG', shot:shot.id, message:`${seconds.toFixed(2)} s; consider a cut or a motivated move`});
    if (!shot.purpose.trim()) errors.push({code:'NO_PURPOSE', shot:shot.id, message:'Every shot needs a stated visual purpose'});
    if (i > 0 && shot.transition.type === 'cut' && !shot.transition.motivation) errors.push({code:'UNMOTIVATED_CUT', shot:shot.id, message:'Hard cuts need a motivation (new information, action, reveal or perspective change)'});
    const c = shot.camera;
    const moveFrames = c.window[1] - c.window[0];
    const hasEvents = plan.props.some(prop => prop.actions.some(action => action.shot === shot.id && !INSTANT_ACTIONS.has(action.type)));
    if (c.behavior === 'hold' && seconds > STATIC_SHOT_SEC && !hasEvents) warnings.push({code:'STATIC_SHOT', shot:shot.id, message:`${seconds.toFixed(1)} s still frame with no action; make sure the stillness is the point`});
    if (c.behavior !== 'hold' && c.behavior !== 'follow' && c.ease === 'linear' && moveFrames >= (shot.endFrame - shot.startFrame) * DRIFT_FRACTION) {
      warnings.push({code:'MECHANICAL_DRIFT', shot:shot.id, message:'Constant-speed move across the whole shot; anchor it to words with "during" or use an eased curve'});
    }
    if (c.behavior === 'push-in' && FRAMING[c.to.framing] <= FRAMING[c.from.framing]) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'push-in must end tighter than it starts'});
    if (c.behavior === 'pullback' && FRAMING[c.to.framing] >= FRAMING[c.from.framing]) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'pullback must end wider than it starts'});
    if (c.behavior === 'orbit' && Math.abs(c.to.azimuth - c.from.azimuth) < 10) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'orbit needs at least 10 degrees of travel'});
    if (c.behavior === 'track' && !(c.params.distance > 0)) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'track needs params.distance > 0'});
    if (c.behavior === 'track' && c.params.direction !== undefined && !['left', 'right'].includes(c.params.direction)) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'track direction must be "left" or "right"'});
    if (c.behavior === 'whip-pan' && !propById.has(c.params.from)) errors.push({code:'MOVE_DIRECTION', shot:shot.id, message:'whip-pan needs params.from (a prop id)'});
    if (i >= 2 && [0, 1, 2].every(k => plan.shots[i - k].camera.behavior === 'push-in')) warnings.push({code:'PERPETUAL_ZOOM', shot:shot.id, message:'Three push-ins in a row; vary the coverage'});
  });

  // Continuity across cuts: same subject, same framing and nearly the same angle is a jump cut
  for (let i = 1; i < plan.shots.length; i++) {
    const a = plan.shots[i - 1], b = plan.shots[i];
    if (a.subject !== b.subject || b.transition.type === 'whip') continue;
    const end = a.camera.to, start = b.camera.from;
    let delta = Math.abs(end.azimuth - start.azimuth) % 360;
    delta = Math.min(delta, 360 - delta);
    if (end.framing === start.framing && delta < 25 && Math.abs(end.elevation - start.elevation) < 15) warnings.push({code:'JUMP_CUT', shot:b.id, message:`Cut from ${a.id} keeps the same framing and angle (${delta.toFixed(0)} degrees apart)`});
  }

  // Instant prop changes must hide behind a cut, or the viewer sees a pop
  const cutFrames = new Set(plan.shots.map(shot => shot.startFrame));
  for (const prop of plan.props) for (const action of prop.actions) {
    if (INSTANT_ACTIONS.has(action.type) && !cutFrames.has(action.startFrame)) errors.push({code:'CONTINUITY_POP', prop:prop.id, shot:action.shot, message:`"${action.type}" at frame ${action.startFrame} is not on a cut`});
  }
  for (const prop of plan.props) for (let i = 1; i < prop.actions.length; i++) {
    const a = prop.actions[i - 1], b = prop.actions[i];
    if (b.startFrame < a.endFrame && !INSTANT_ACTIONS.has(a.type)) errors.push({code:'ACTION_OVERLAP', prop:prop.id, shot:b.shot, message:`${b.type} starts before ${a.type} ends`});
  }

  // Sync: visible actions start on (or just before) their word
  for (const prop of plan.props) for (const action of prop.actions) {
    if (!action.anchor) continue;
    const delta = action.anchor.wordFrame - action.startFrame;
    if (delta > SYNC_LEAD_FRAMES) warnings.push({code:'SYNC_EARLY', prop:prop.id, shot:action.shot, message:`${action.type} starts ${delta} frames before "${action.anchor.word}"`});
    if (delta < -SYNC_LAG_FRAMES) warnings.push({code:'SYNC_LATE', prop:prop.id, shot:action.shot, message:`${action.type} starts ${-delta} frames after "${action.anchor.word}"`});
  }

  // Per-frame camera, collision and framing checks
  const samples = Array.from({length:plan.durationFrames}, (_, frame) => samplePlan(plan, frame));
  const step = frame => frame > 0 && samples[frame - 1].shot.id === samples[frame].shot.id && !samples[frame].camera.whip && !samples[frame - 1].camera.whip
    ? samples[frame].camera.position.distanceTo(samples[frame - 1].camera.position) : null;
  for (let frame = 0; frame < plan.durationFrames; frame++) {
    const sample = samples[frame];
    const {camera, shot} = sample;
    const issue = (list, code, message, subject) => list.push({code, shot:shot.id, frame, message, subject});
    if (camera.position.y < CAMERA_MARGIN_M) issue(perFrameErrors, 'CAMERA_BELOW_GROUND', 'Camera is below or on the ground plane');
    for (const prop of plan.props) {
      const box = propWorldBox(prop, frame);
      if (box && box.clone().expandByScalar(CAMERA_MARGIN_M).containsPoint(camera.position)) issue(perFrameErrors, 'CAMERA_COLLISION', `Camera is inside ${prop.id}`, prop.id);
    }
    const here = step(frame), before = step(frame - 1), after = frame + 1 < plan.durationFrames ? step(frame + 1) : null;
    if (here !== null && here > POP_STEP_M && here > POP_RATIO * Math.max(before ?? 0, after ?? 0, 0.01)) issue(perFrameErrors, 'CAMERA_POP', 'Camera jumps within a shot');
    else if (here !== null && before !== null && Math.abs(here - before) > JERK_M_PER_FRAME) issue(perFrameErrors, 'CAMERA_JERK', `Camera speed changes by ${Math.abs(here - before).toFixed(2)} m/frame in one frame; ease into and out of the move`);

    const subject = propById.get(shot.subject);
    const box = propWorldBox(subject, frame);
    if (!box || camera.whip) continue;
    const view = project(camera, aspect, box);
    const focus = shotFocus(shot, box, frame);
    const focusView = projectPoint(camera, aspect, focus);
    if (view.behind || !onScreen(focusView)) issue(perFrameErrors, 'SUBJECT_OFF_SCREEN', `${shot.subject} is not in frame`, shot.subject);
    if (!view.behind && (Math.min(view.maxY, 1) - Math.max(view.minY, -1)) / 2 < MIN_SUBJECT_HEIGHT) issue(perFrameErrors, 'SUBJECT_TOO_SMALL', `${shot.subject} fills less than ${MIN_SUBJECT_HEIGHT * 100}% of the frame height`, shot.subject);
    if (plan.stage.fog && camera.position.distanceTo(focus) > plan.stage.fog.far * MAX_FOG_DEPTH) issue(perFrameErrors, 'SUBJECT_IN_FOG', `${shot.subject} is ${camera.position.distanceTo(focus).toFixed(1)} m away, deep in fog that is opaque at ${plan.stage.fog.far} m`, shot.subject);
    else if (!inside(focusView, SAFE_AREA)) issue(perFrameWarnings, 'SUBJECT_OUTSIDE_SAFE_AREA', `${shot.subject} focus is outside the vertical safe area`, shot.subject);
    // Other props blocking the line of sight to the subject's focus, unless the shot declares them as foreground
    const ray = new Ray(camera.position.clone(), focus.clone().sub(camera.position).normalize());
    const reach = camera.position.distanceTo(focus);
    for (const other of plan.props) {
      if (other.id === shot.subject || shot.foreground.includes(other.id)) continue;
      const otherBox = propWorldBox(other, frame);
      const hit = otherBox && ray.intersectBox(otherBox, new Vector3());
      if (hit && camera.position.distanceTo(hit) < reach) issue(perFrameWarnings, 'SUBJECT_OCCLUDED', `${other.id} blocks the view of ${shot.subject}`, other.id);
    }
  }

  // Focus words: the subject must be clearly framed when its key word is spoken
  for (const shot of plan.shots) for (const focus of shot.focus) {
    if (focus.frame < shot.startFrame || focus.frame >= shot.endFrame) {
      errors.push({code:'FOCUS_OUTSIDE_SHOT', shot:shot.id, message:`Focus word "${focus.word}" (frame ${focus.frame}) is outside the shot`});
      continue;
    }
    const sample = samples[focus.frame];
    const box = propWorldBox(propById.get(shot.subject), focus.frame);
    if (box && !inside(projectPoint(sample.camera, aspect, shotFocus(shot, box, focus.frame)), SAFE_AREA)) errors.push({code:'FOCUS_NOT_FRAMED', shot:shot.id, message:`${shot.subject} is not in the safe area on "${focus.word}"`});
  }

  // Actions should happen where the viewer can see them
  for (const prop of plan.props) for (const action of prop.actions) {
    if (INSTANT_ACTIONS.has(action.type) || prop.missing) continue;
    const sample = samples[Math.min(action.startFrame, samples.length - 1)];
    const box = propWorldBox(prop, action.startFrame);
    if (box && !onScreen(project(sample.camera, aspect, box).center)) warnings.push({code:'ACTION_OFF_SCREEN', prop:prop.id, shot:action.shot, message:`${action.type} starts while ${prop.id} is off screen`});
  }

  // Cut continuity: compare the subject's on-screen size, position and viewing angle either side of each cut
  const cuts = [];
  for (let i = 1; i < plan.shots.length; i++) {
    const a = plan.shots[i - 1], b = plan.shots[i];
    if (b.transition.type !== 'cut' || a.subject !== b.subject) continue;
    const prop = propById.get(b.subject);
    const before = cutView(samples[a.endFrame - 1], prop, aspect), after = cutView(samples[b.startFrame], prop, aspect);
    if (!before || !after) continue;
    const metrics = {
      from:a.id, to:b.id, frame:b.startFrame,
      scaleRatio:round2(Math.max(before.size, after.size) / Math.max(1e-3, Math.min(before.size, after.size))),
      shiftNdc:round2(Math.hypot(after.center.x - before.center.x, after.center.y - before.center.y)),
      viewDeg:Math.round(MathUtils.radToDeg(before.view.angleTo(after.view))),
      pitchDeg:Math.round(Math.abs(before.pitch - after.pitch)),
      intent:b.transition.intent
    };
    cuts.push(metrics);
    if (b.transition.intent === 'contrast') continue;
    if (metrics.scaleRatio > CUT_SCALE_RATIO) warnings.push({code:'CUT_SCALE_JUMP', shot:b.id, message:`${b.subject} changes size ${metrics.scaleRatio}x across the cut from ${a.id}; match scale or declare intent "contrast"`});
    if (metrics.shiftNdc > CUT_SHIFT_NDC) warnings.push({code:'CUT_POSITION_JUMP', shot:b.id, message:`${b.subject} jumps ${Math.round(metrics.shiftNdc * 50)}% of the frame across the cut from ${a.id}`});
    const changed = [metrics.scaleRatio > CUT_SOFT.scale, metrics.shiftNdc > CUT_SOFT.shift, metrics.viewDeg > CUT_SOFT.viewDeg, metrics.pitchDeg > CUT_SOFT.pitchDeg].filter(Boolean).length;
    if (changed >= 3) warnings.push({code:'CUT_DISORIENTING', shot:b.id, message:`Size, position, angle and horizon change together across the cut from ${a.id} (scale ${metrics.scaleRatio}x, shift ${metrics.shiftNdc}, view ${metrics.viewDeg}°, pitch ${metrics.pitchDeg}°); keep at least two of them steady`});
  }

  // Dead frames after a cut: the shot has action coming, but nothing moves for a while after the cut
  for (let i = 1; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    if (shot.transition.type === 'whip') continue;
    const actions = plan.props.flatMap(prop => prop.actions.filter(action => action.shot === shot.id && !INSTANT_ACTIONS.has(action.type)));
    const cameraMoves = shot.camera.behavior !== 'hold' && shot.camera.behavior !== 'follow';
    const firstMotion = Math.min(...actions.map(action => action.startFrame), cameraMoves ? shot.camera.window[0] : Infinity);
    if (Number.isFinite(firstMotion) && firstMotion - shot.startFrame > DEAD_START_FRAMES) {
      warnings.push({code:'CUT_DEAD_START', shot:shot.id, message:`Nothing moves for ${firstMotion - shot.startFrame} frames after the cut, then the shot's action starts; cut closer to the action`});
    }
  }

  validateWorld(plan, samples, aspect, {errors, warnings, perFrameErrors, perFrameWarnings, propById});

  errors.push(...rangeIssues(perFrameErrors));
  warnings.push(...rangeIssues(perFrameWarnings));
  const lengths = plan.shots.map(shot => (shot.endFrame - shot.startFrame) / fps);
  return {
    status:errors.length ? 'needs-revision' : 'pass', errors, warnings, cuts,
    stats:{shots:plan.shots.length, durationSec:plan.durationFrames / fps, averageShotSec:Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length * 100) / 100,
      shortestShotSec:Math.min(...lengths), longestShotSec:Math.max(...lengths),
      behaviors:Object.fromEntries([...new Set(plan.shots.map(shot => shot.camera.behavior))].map(b => [b, plan.shots.filter(shot => shot.camera.behavior === b).length])),
      transitions:Object.fromEntries(['cut', 'whip'].map(t => [t, plan.shots.slice(1).filter(shot => shot.transition.type === t).length]))}
  };
}

const boxOf = b => new Box3(new Vector3(...b.min), new Vector3(...b.max));

// Environment and character checks: these only run when the plan has an environment or a cast
function validateWorld(plan, samples, aspect, {errors, warnings, perFrameErrors, perFrameWarnings, propById}) {
  const env = plan.environment;
  const envBoxes = env ? [...env.instances.map(i => ({id:`${i.asset}@${i.position.map(v => v.toFixed(1)).join(',')}`, layer:i.layer, box:boxOf(i.box)})),
    ...env.boxes.map(b => ({id:b.id, layer:'architecture', box:boxOf(b)}))] : [];
  if (env) {
    for (const miss of env.missing) errors.push({code:miss.kind === 'texture' ? 'ENV_MISSING_TEXTURE' : 'ENV_MISSING_ASSET', message:`Environment ${env.id} needs ${miss.kind} "${miss.id}", which is not in the local catalog; nothing was substituted`});
    for (const item of env.intrusions) warnings.push({code:'ENV_INTRUSION', message:`${item.asset} at ${item.position.join(', ')} sits inside the story action area`});
  }
  const cuts = new Set([0, ...plan.shots.map(shot => shot.startFrame)]);

  for (const member of plan.cast ?? []) for (const action of member.actions) {
    if (action.type === 'place' && !cuts.has(action.startFrame)) errors.push({code:'PLACE_NOT_ON_CUT', shot:action.shot, message:`${member.id} is placed at frame ${action.startFrame}, which is not a cut; the viewer would see a teleport`});
    if (action.type === 'push') {
      const propAction = propById.get(action.params.prop)?.actions.find(a => !INSTANT_ACTIONS.has(a.type) && a.startFrame >= action.startFrame + PUSH_SYNC_FRAMES[0]);
      const delta = propAction ? propAction.startFrame - action.startFrame : null;
      if (delta === null || delta > PUSH_SYNC_FRAMES[1]) warnings.push({code:'PUSH_NOT_SYNCED', shot:action.shot, message:`${member.id} pushes ${action.params.prop} at frame ${action.startFrame} but it ${delta === null ? 'never moves' : `only moves ${delta} frames later`}`});
    }
  }

  for (let frame = 0; frame < plan.durationFrames; frame++) {
    const {camera, shot, characters} = samples[frame];
    const issue = (list, code, message, subject) => list.push({code, shot:shot.id, frame, message, subject});
    if (env) {
      const [minX, , minZ] = env.bounds.min, [maxX, , maxZ] = env.bounds.max;
      const p = camera.position;
      if (p.x < minX + 0.1 || p.x > maxX - 0.1 || p.z < minZ + 0.1 || p.z > maxZ - 0.1) issue(perFrameErrors, 'CAMERA_OUTSIDE_ROOM', `Camera is outside ${env.id}`);
      for (const item of envBoxes) if (item.box.clone().expandByScalar(CAMERA_MARGIN_M).containsPoint(p)) issue(perFrameErrors, 'CAMERA_COLLISION', `Camera is inside ${item.id}`, item.id);
      const subject = propById.get(shot.subject);
      const box = subject && propWorldBox(subject, frame);
      if (box && !camera.whip) {
        const focus = box.getCenter(new Vector3());
        const ray = new Ray(p.clone(), focus.clone().sub(p).normalize()), reach = p.distanceTo(focus);
        for (const item of envBoxes) {
          if (item.layer === 'foreground') continue;
          const hit = ray.intersectBox(item.box, new Vector3());
          if (hit && p.distanceTo(hit) < reach - 0.2) issue(perFrameWarnings, 'SUBJECT_OCCLUDED', `${item.id} blocks the view of ${shot.subject}`, item.id);
        }
      }
    }
    for (const c of characters) {
      const pos = new Vector3(...c.position);
      const body = new Box3(new Vector3(pos.x - BODY_RADIUS_M, 0.05, pos.z - BODY_RADIUS_M), new Vector3(pos.x + BODY_RADIUS_M, c.heightM * 0.8, pos.z + BODY_RADIUS_M));
      for (const prop of plan.props) {
        const box = propWorldBox(prop, frame);
        if (box && box.intersectsBox(body)) issue(perFrameErrors, 'CHARACTER_CLIPPING', `${c.id} passes through ${prop.id}`, c.id);
      }
      for (const item of envBoxes) if (item.box.intersectsBox(body)) issue(perFrameErrors, 'CHARACTER_CLIPPING', `${c.id} passes through ${item.id}`, c.id);
      if (Math.abs(c.position[1]) > 1e-6) issue(perFrameErrors, 'CHARACTER_FLOATING', `${c.id} feet are ${c.position[1].toFixed(2)} m off the ground`, c.id);
      if (c.contact && c.contact.shortfallM > CONTACT_TOLERANCE_M) issue(perFrameErrors, 'CHARACTER_NO_CONTACT', `${c.id}'s hands fall ${(c.contact.shortfallM * 100).toFixed(0)} cm short of ${c.contact.prop}`, c.id);
      if (c.pose.squash < 0.85 || c.pose.squash > 1.15) issue(perFrameWarnings, 'CHARACTER_OFF_MODEL', `${c.id} squash ${c.pose.squash.toFixed(2)} distorts the design`, c.id);
      const previous = frame > 0 ? samples[frame - 1].characters.find(o => o.id === c.id) : null;
      if (previous && !cuts.has(frame) && pos.distanceTo(new Vector3(...previous.position)) > CHARACTER_STEP_M) issue(perFrameErrors, 'CHARACTER_POP', `${c.id} jumps within a shot`, c.id);
      // Face position for captions: the head should stay out of the bottom caption band when it is prominent
      const head = projectPoint(camera, aspect, pos.clone().setY(c.heightM * 0.8));
      const feet = projectPoint(camera, aspect, pos.clone());
      const onScreenHeight = (head.y - feet.y) / 2;
      if (onScreen(head) && onScreenHeight > 0.25 && head.y < CAPTION_BAND_TOP) issue(perFrameWarnings, 'CHARACTER_FACE_IN_CAPTION_ZONE', `${c.id}'s face is in the caption band`, c.id);
      // The character should not block the subject unless the shot declares it as foreground
      const subject = propById.get(shot.subject);
      const box = subject && propWorldBox(subject, frame);
      if (box && !shot.foreground.includes(c.id) && !camera.whip) {
        const focus = box.getCenter(new Vector3());
        const hit = new Ray(camera.position.clone(), focus.clone().sub(camera.position).normalize()).intersectBox(body, new Vector3());
        if (hit && camera.position.distanceTo(hit) < camera.position.distanceTo(focus) - 0.2) issue(perFrameWarnings, 'CHARACTER_OCCLUDES_SUBJECT', `${c.id} blocks the view of ${shot.subject}`, c.id);
      }
    }
  }

  // Character actions should start where the viewer can see them
  for (const member of plan.cast ?? []) for (const action of member.actions) {
    if (!['pose', 'push', 'walk'].includes(action.type)) continue;
    const sample = samples[Math.min(action.startFrame, samples.length - 1)];
    const c = sample.characters.find(o => o.id === member.id);
    const v = projectPoint(sample.camera, aspect, new Vector3(...c.position).setY(c.heightM * 0.55));
    if (!onScreen(v)) warnings.push({code:'CHARACTER_ACTION_OFF_SCREEN', shot:action.shot, message:`${member.id}'s ${action.type}${action.params.preset ? ` (${action.params.preset})` : ''} starts while ${member.id} is off screen`});
  }
}
