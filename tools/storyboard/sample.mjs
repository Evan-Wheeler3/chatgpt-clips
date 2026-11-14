import { propStateAt } from './actions.mjs';
import { cameraAt } from './camera.mjs';
import { characterTrack } from './character.mjs';

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

export function samplePlan(plan, frame) {
  const shotIndex = shotIndexAt(plan, frame);
  const index = Math.max(0, Math.min(plan.durationFrames - 1, Math.floor(frame)));
  return {
    frame, time:frame / plan.fps, shotIndex, shot:plan.shots[shotIndex],
    camera:cameraAt(plan, shotIndex, frame),
    props:plan.props.map(prop => ({id:prop.id, missing:prop.missing, ...propStateAt(prop, frame)})),
    characters:[...castTracks(plan)].map(([id, track]) => ({id, ...track[index]})),
    word:wordAt(plan, frame)
  };
}
