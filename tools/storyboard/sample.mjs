import { propStateAt } from './actions.mjs';
import { cameraAt } from './camera.mjs';

// Everything a renderer or validator needs for one frame; pure, so Node validation and the browser animatic agree
export function shotIndexAt(plan, frame) {
  const index = plan.shots.findIndex(shot => frame >= shot.startFrame && frame < shot.endFrame);
  return index >= 0 ? index : plan.shots.length - 1;
}

export function wordAt(plan, frame) {
  const time = frame / plan.fps;
  return plan.words.findLast(word => word.start <= time && time < word.end + 0.15) ?? null;
}

export function samplePlan(plan, frame) {
  const shotIndex = shotIndexAt(plan, frame);
  return {
    frame, time:frame / plan.fps, shotIndex, shot:plan.shots[shotIndex],
    camera:cameraAt(plan, shotIndex, frame),
    props:plan.props.map(prop => ({id:prop.id, missing:prop.missing, ...propStateAt(prop, frame)})),
    word:wordAt(plan, frame)
  };
}
