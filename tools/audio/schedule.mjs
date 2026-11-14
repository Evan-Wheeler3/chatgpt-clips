import { PerspectiveCamera, Vector3, Quaternion } from 'three';
import { samplePlan } from '../storyboard/sample.mjs';
import { propWorldBox } from '../storyboard/actions.mjs';
import { normalizeWord } from '../narration/align.mjs';

/*
 * Sound-effect timeline from the compiled plan (pure). Effects follow what the animation actually does:
 *   roll    shove thud + a rolling bed whose level follows the barrel's measured speed
 *   pivot   a scrape that follows the turn rate, with a creak as it starts
 *   wobble  a light knock and a short creak
 *   push    a clothing wind-up and the contact thud      touch  a light knock when the hand lands
 *   walk    a footstep per stride (from the measured path)  pose  a subtle cloth rustle for big gestures
 *   whip    a soft whoosh centred on the whip pan
 * story.audio: {auto: true | false | {exclude:[rule...]}, sfx:[{at, asset, gainDb, pan}], mute:[eventId...], gainDb:{sfx}}
 * Every event says which rule made it and why, so a reviewer can mute or override it.
 */
export const RULES = ['roll', 'pivot', 'wobble', 'push', 'touch', 'walk', 'gesture', 'whip'];
const GESTURES = new Set(['point', 'present', 'shrug', 'thumbs-up', 'surprised', 'think', 'ready']);
const variant = (base, count, n) => `${base}-${(n % count) + 1}`;

// Screen pan (-1 left .. 1 right) of a world point at a frame, kept subtle
function panAt(plan, frame, point) {
  const s = samplePlan(plan, frame), aspect = plan.size.width / plan.size.height;
  const camera = new PerspectiveCamera(s.camera.fov, aspect, 0.02, 200);
  camera.position.copy(s.camera.position); camera.lookAt(s.camera.target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const v = point.clone().project(camera);
  return v.z < 1 ? Math.max(-0.45, Math.min(0.45, v.x * 0.45)) : 0;
}
const propCenter = (prop, frame) => propWorldBox(prop, frame)?.getCenter(new Vector3()) ?? new Vector3();

// Per-frame linear (m/s) and angular (deg/s) speed of a prop, from its sampled transform
function propMotion(plan, prop, from, to) {
  const out = [];
  let prev = null;
  for (let f = from; f <= to; f++) {
    const p = samplePlan(plan, f).props.find(x => x.id === prop.id), pos = new Vector3().copy(p.position), q = new Quaternion().copy(p.quaternion);
    if (prev) out.push({frame:f, speed:pos.distanceTo(prev.pos) * plan.fps, spin:prev.q.angleTo(q) * 180 / Math.PI * plan.fps});
    prev = {pos, q};
  }
  return out;
}

function resolveTime(plan, at) {
  if (typeof at === 'number') return at;
  const spec = typeof at === 'string' ? {at} : at;
  const [word, nth] = String(spec.at).split('#'), wanted = normalizeWord(word);
  const hits = plan.words.filter(w => normalizeWord(w.text) === wanted);
  const hit = hits[(Number(nth) || 1) - 1];
  if (!hit) throw new Error(`Sound event anchor "${spec.at}" is not a spoken word`);
  return (spec.edge === 'end' ? hit.end : hit.start) + (spec.offset ?? 0);
}

export function scheduleSfx(plan, story = {}) {
  const audio = story.audio ?? {}, fps = plan.fps, events = [];
  const auto = audio.auto === false ? [] : RULES.filter(r => !(audio.auto?.exclude ?? []).includes(r));
  const push = (rule, asset, frame, extra = {}) => events.push({id:`${rule}-${events.length + 1}`, rule, asset, time:+(frame / fps).toFixed(3), frame:Math.round(frame), gainDb:0, pan:0, ...extra});
  let creaks = 0, steps = 0, rustles = 0;

  for (const prop of plan.props) for (const a of prop.actions) {
    if (a.type === 'roll' && auto.includes('roll')) {
      const motion = propMotion(plan, prop, a.startFrame, a.endFrame + 6), top = Math.max(0.2, ...motion.map(m => m.speed));
      push('roll', 'barrel-thud', a.startFrame, {pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)), reason:`${prop.id} starts rolling`});
      push('roll', 'barrel-roll-loop', a.startFrame, {durationSec:(a.endFrame - a.startFrame + 6) / fps, pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)),
        envelope:motion.map(m => [+((m.frame - a.startFrame) / fps).toFixed(3), +Math.min(1, (m.speed / top) ** 0.7).toFixed(3)]), reason:`${prop.id} rolls (level follows its speed)`});
    }
    if (a.type === 'pivot' && auto.includes('pivot')) {
      const motion = propMotion(plan, prop, a.startFrame, a.endFrame), top = Math.max(1, ...motion.map(m => m.spin));
      push('pivot', variant('wood-creak', 3, creaks++), a.startFrame, {gainDb:-2, pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)), reason:`${prop.id} starts to pivot`});
      push('pivot', 'barrel-scrape', a.startFrame, {durationSec:(a.endFrame - a.startFrame) / fps, pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)),
        envelope:motion.map(m => [+((m.frame - a.startFrame) / fps).toFixed(3), +Math.min(1, (m.spin / top) ** 0.8).toFixed(3)]), reason:`${prop.id} pivots on the stone (level follows the turn rate)`});
    }
    if (a.type === 'wobble' && auto.includes('wobble')) {
      push('wobble', 'wood-knock-light', a.startFrame, {pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)), reason:`${prop.id} wobbles`});
      push('wobble', variant('wood-creak', 3, creaks++), a.startFrame + 3, {gainDb:-4, pan:panAt(plan, a.startFrame, propCenter(prop, a.startFrame)), reason:`${prop.id} settles`});
    }
  }
  for (const member of plan.cast ?? []) {
    const position = frame => new Vector3(...samplePlan(plan, frame).characters.find(c => c.id === member.id).position);
    for (const a of member.actions) {
      const at = a.startFrame;
      if (a.type === 'push' && auto.includes('push')) {
        const windup = Math.max(0, at - 10);
        if (!events.some(e => e.asset.startsWith('cloth-rustle') && Math.abs(e.frame - windup) < fps * 0.35)) push('push', variant('cloth-rustle', 3, rustles++), windup, {pan:panAt(plan, at, position(at)), reason:`${member.id} winds up to push`});
        // The roll rule already thumps when a pushed prop starts moving on the same frame
        if (!events.some(e => e.asset === 'barrel-thud' && Math.abs(e.frame - at) <= 3)) push('push', 'barrel-thud', at, {pan:panAt(plan, at, position(at)), reason:`${member.id}'s hands hit ${a.params.prop}`});
      }
      if (a.type === 'touch' && auto.includes('touch')) push('touch', 'wood-knock-light', at + (a.params.frames ?? 12), {gainDb:-4, pan:panAt(plan, at, position(at)), reason:`${member.id}'s hand lands on ${a.params.prop}`});
      if (a.type === 'pose' && auto.includes('gesture') && GESTURES.has(a.params.preset)) {
        if (!events.some(e => Math.abs(e.frame - at) < fps * 0.25)) push('gesture', variant('cloth-rustle', 3, rustles++), at, {pan:panAt(plan, at, position(at)), reason:`${member.id} gestures (${a.params.preset})`});
      }
      if (a.type === 'walk' && auto.includes('walk')) {
        const stride = a.params.stride ?? 0.5;
        let walked = 0, last = position(a.startFrame);
        for (let f = a.startFrame + 1; f <= a.endFrame; f++) {
          const p = position(f); walked += p.distanceTo(last); last = p;
          if (walked >= stride) { walked -= stride; push('walk', variant('footstep-stone', 4, steps++), f, {gainDb:steps % 2 ? 0 : -1.5, pan:panAt(plan, f, p), reason:`${member.id} steps`}); }
        }
      }
    }
  }
  if (auto.includes('whip')) for (const shot of plan.shots.filter(s => s.transition?.type === 'whip')) {
    let f = shot.startFrame; while (f < shot.endFrame && samplePlan(plan, f).camera.whip) f++;
    const mid = (shot.startFrame + f) / 2;
    push('whip', 'whoosh-soft', Math.max(0, mid - 0.25 * fps), {reason:`whip pan into ${shot.id}`});
  }
  for (const s of audio.sfx ?? []) {
    const time = resolveTime(plan, s.at);
    events.push({id:s.id ?? `manual-${events.length + 1}`, rule:'manual', asset:s.asset, time:+time.toFixed(3), frame:Math.round(time * fps), gainDb:s.gainDb ?? 0, pan:s.pan ?? 0, durationSec:s.durationSec, reason:s.reason ?? 'story'});
  }
  const muted = new Set(audio.mute ?? []);
  return events.filter(e => !muted.has(e.id)).sort((a, b) => a.time - b.time);
}
