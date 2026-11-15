import { propStateAt } from './actions.mjs';
import { cameraAt } from './camera.mjs';
import { characterTrack } from './character.mjs';
import { effectStateAt, sceneFrame, shakeOffset } from './effects.mjs';

// Everything a renderer or validator needs for one frame; pure, so Node validation and the browser animatic agree
export function shotIndexAt(plan, frame) {
  const index = plan.shots.findIndex(shot => frame >= shot.startFrame && frame < shot.endFrame);
  return index >= 0 ? index : plan.shots.length - 1;
}

export function wordAt(plan, frame) {
  const time = frame / plan.fps;
  return plan.words.findLast(word => word.start <= time && time < word.end + 0.15) ?? null;
}

// Character tracks are simulated once per plan (springs, turns, blinks need the whole history) and then indexed
const tracks = new WeakMap();
export function castTracks(plan) {
  if (!tracks.has(plan)) {
    const cameraFor = frame => cameraAt(plan, shotIndexAt(plan, frame), frame);
    tracks.set(plan, new Map((plan.cast ?? []).map(member => [member.id, characterTrack(plan, member, cameraFor)])));
  }
  return tracks.get(plan);
}

// A freeze holds the scene (camera, props, effects, characters) while captions and audio run on in real time
export function samplePlan(plan, frame) {
  const scene = sceneFrame(plan, frame), shotIndex = shotIndexAt(plan, frame);
  const index = Math.max(0, Math.min(plan.durationFrames - 1, Math.floor(scene)));
  let camera = cameraAt(plan, shotIndex, scene);
  const shake = shakeOffset(plan, frame);
  if (shake) { // New vectors: never mutate a pose the camera module may share between frames
    const d = camera.position.distanceTo(camera.target), offset = camera.position.clone().set(...shake).multiplyScalar(d);
    camera = {...camera, position:camera.position.clone().add(offset), target:camera.target.clone().add(offset)};
  }
  return {
    frame, time:frame / plan.fps, sceneFrame:scene, shotIndex, shot:plan.shots[shotIndex], camera,
    props:plan.props.map(prop => ({id:prop.id, missing:prop.missing, ...propStateAt(prop, scene)})),
    effects:(plan.effects ?? []).map(effect => ({id:effect.id, type:effect.type, ...effectStateAt(effect, scene)})),
    characters:[...castTracks(plan)].map(([id, track]) => ({id, ...track[index]})),
    word:wordAt(plan, frame)
  };
}
