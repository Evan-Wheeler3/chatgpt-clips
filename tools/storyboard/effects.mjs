import { ease } from './easing.mjs';

/*
 * Effects: stylized, deterministic visual elements that are not catalog models (fluids, airflow, highlights, tints).
 * A story declares each effect once (story.effects) and animates its channels from shot events anchored to words:
 *   {"effect":"spill", "do":"animate", "set":{"progress":1}, "at":"know", "until":"stop?", "ease":"in"}
 * Channels move from their current value to the target over the event (eased), exactly like prop actions, so a
 * rewind is the same channel driven back to 0: every intermediate state is the forward state, replayed in reverse.
 * Renderers (tools/render/effects.mjs) draw an effect from its type, static params and sampled channel values.
 */
export const EFFECT_TYPES = {
  overflow:{channels:{progress:0}, about:'liquid ribbon from an origin, a sheet down a surface path, a spreading puddle'},
  flow:{channels:{amount:0, speed:1}, about:'streaks travelling along a path (fuel through the nozzle)'},
  air:{channels:{amount:0, speed:1}, about:'arrows and wisps travelling along a path (air through the sensing tube)'},
  level:{channels:{height:0}, about:'a liquid surface rising inside a cylinder (fuel in the filler neck)'},
  ring:{channels:{amount:0}, about:'a soft pulsing highlight ring at a point'},
  tint:{channels:{amount:0}, about:'a translucent tinted volume (suction / pressure difference)'},
  glint:{channels:{progress:0}, about:'a specular glint sweeping along a path'}
};

export function effectDefaults(effect) {
  return {...EFFECT_TYPES[effect.type].channels, ...(effect.initial ?? {})};
}

// Channel values at a (scene) frame
export function effectStateAt(effect, frame) {
  const values = effectDefaults(effect);
  for (const key of effect.keys) {
    if (frame < key.startFrame) break;
    const span = key.endFrame - key.startFrame;
    const p = ease(key.ease ?? 'cubic', span > 0 ? Math.min(1, (frame - key.startFrame) / span) : 1);
    for (const [channel, to] of Object.entries(key.set)) values[channel] += (to - values[channel]) * p;
  }
  return values;
}

export function validateEffectDeclaration(effect) {
  if (!/^[a-z][a-z0-9-]*$/.test(effect?.id ?? '')) throw new Error(`Invalid effect id: ${effect?.id}`);
  if (!EFFECT_TYPES[effect.type]) throw new Error(`Effect ${effect.id}: unknown type "${effect.type}" (${Object.keys(EFFECT_TYPES).join(', ')})`);
  for (const [channel, value] of Object.entries(effect.initial ?? {})) {
    if (!(channel in EFFECT_TYPES[effect.type].channels)) throw new Error(`Effect ${effect.id}: ${effect.type} has no channel "${channel}"`);
    if (!Number.isFinite(value)) throw new Error(`Effect ${effect.id}: initial ${channel} must be a number`);
  }
}

export function validateEffectKey(effect, set, where) {
  if (!set || !Object.keys(set).length) throw new Error(`${where}: effect event needs "set" with at least one channel`);
  for (const [channel, value] of Object.entries(set)) {
    if (!(channel in EFFECT_TYPES[effect.type].channels)) throw new Error(`${where}: ${effect.type} effect "${effect.id}" has no channel "${channel}"`);
    if (!Number.isFinite(value)) throw new Error(`${where}: ${channel} must be a number`);
  }
}

// Time effects. Freeze: the scene holds frame `startFrame` for `frames` frames, then continues on real time (captions
// and audio never stop). Shake: a short decaying camera jolt, as a fraction of the camera-to-target distance.
export function sceneFrame(plan, frame) {
  for (const f of plan.freezes ?? []) if (frame >= f.startFrame && frame < f.startFrame + f.frames) return f.startFrame;
  return frame;
}

export function shakeOffset(plan, frame) {
  for (const s of plan.shakes ?? []) {
    const k = frame - s.startFrame;
    if (k < 0 || k >= s.frames) continue;
    const decay = (1 - k / s.frames) ** 2, a = s.amplitude * decay;
    return [a * Math.sin(k * 2.1 + 0.3), a * Math.cos(k * 2.9 + 1.1) * 0.8, a * Math.sin(k * 3.7 + 2.0) * 0.5];
  }
  return null;
}
