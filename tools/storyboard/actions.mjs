import { Vector3, Quaternion, Euler, Box3, MathUtils } from 'three';
import { ease } from './easing.mjs';

const UP = new Vector3(0, 1, 0);
const toQuat = degrees => new Quaternion().setFromEuler(new Euler(...degrees.map(MathUtils.degToRad), 'XYZ'));

export const ACTION_TYPES = ['set', 'move', 'roll', 'pivot', 'wobble', 'appear', 'hide', 'part', 'material'];
// Actions that jump instantly; validation requires them to sit on a cut while the prop is visible
export const INSTANT_ACTIONS = new Set(['set', 'appear', 'hide']);

export function baseState(prop) {
  return {position:new Vector3(...(prop.base.position ?? [0, 0, 0])), quaternion:toQuat(prop.base.rotation ?? [0, 0, 0]),
    scale:prop.base.scale ?? 1, visible:prop.base.visible ?? true, grounded:prop.base.grounded ?? true, wobble:new Quaternion(),
    // Named sub-parts (GLB nodes) offset from their rest pose, and the prop's material state (x-ray ghost, section cut)
    parts:{}, material:{xray:0, keep:[], section:null, ghost:null}};
}

const clone = state => ({...state, position:state.position.clone(), quaternion:state.quaternion.clone(), wobble:state.wobble.clone(), parts:{...state.parts}, material:{...state.material}});
const lerpArray = (a, b, p) => a.map((v, i) => v + ((b ?? a)[i] - v) * p);
export const REST_PART = Object.freeze({position:[0, 0, 0], rotation:[0, 0, 0], scale:1, morph:{}});

const corners = bounds => [bounds.min[0], bounds.max[0]].flatMap(x => [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => [x, y, z])));

// World-space silhouette points of a prop under a state (falls back to box corners without a shape)
export function worldPoints(shape, state) {
  const q = state.quaternion.clone().multiply(state.wobble);
  return (shape.points ?? corners(shape.bounds)).map(p => new Vector3(...p).multiplyScalar(state.scale).applyQuaternion(q).add(state.position));
}

export const worldBox = (shape, state) => new Box3().setFromPoints(worldPoints(shape, state));
const withoutWobble = state => ({...clone(state), wobble:new Quaternion()});

// Grounded props rest on y=0 whatever their rotation, so a barrel laid on its side sits on its bilge and rolls without bobbing
function grounded(shape, state) {
  if (!state.grounded || !shape.bounds) return state;
  const out = clone(state);
  out.position.y -= worldBox(shape, withoutWobble(state)).min.y;
  return out;
}

// Rolling radius: half the resting height, i.e. the bilge radius for a barrel on its side
const rollRadius = (shape, state) => {
  const box = worldBox(shape, withoutWobble(state));
  return (box.max.y - box.min.y) / 2;
};

const APPLY = {
  set:(state, p, params) => {
    const out = clone(state);
    if (params.position) out.position.set(...params.position);
    if (params.rotation) out.quaternion.copy(toQuat(params.rotation));
    if (params.grounded !== undefined) out.grounded = params.grounded;
    return out;
  },
  move:(state, p, params) => {
    const out = clone(state);
    out.position.lerp(new Vector3(...params.to), p);
    return out;
  },
  roll:(state, p, params, bounds) => {
    const direction = new Vector3(...params.direction).setY(0).normalize();
    const radius = params.radius ?? rollRadius(bounds, state);
    const distance = params.distance * p;
    const out = clone(state);
    out.position.addScaledVector(direction, distance);
    const axis = new Vector3().crossVectors(UP, direction).normalize();
    out.quaternion.premultiply(new Quaternion().setFromAxisAngle(axis, distance / radius));
    return out;
  },
  // Turns about the prop's own centre ("on the spot"), not its model origin, which may sit at one end
  pivot:(state, p, params, shape) => {
    const out = clone(state);
    const q = new Quaternion().setFromAxisAngle(UP, MathUtils.degToRad(params.degrees * p));
    const center = shape?.bounds ? worldBox(shape, withoutWobble(state)).getCenter(new Vector3()) : state.position.clone();
    out.position.sub(center).applyQuaternion(q).add(center);
    out.quaternion.premultiply(q);
    return out;
  },
  // Damped rocking after an impact or a stop; it decays to rest by the end of the action
  wobble:(state, p, params) => {
    const out = clone(state);
    const axis = new Vector3(...(params.axis ?? [1, 0, 0])).normalize();
    const angle = MathUtils.degToRad(params.degrees ?? 6) * Math.sin(p * Math.PI * 2 * (params.cycles ?? 2.5)) * (1 - p) ** 2;
    out.wobble = new Quaternion().setFromAxisAngle(axis, angle);
    return out;
  },
  // A named part moves from wherever it is toward an offset from its rest pose (degrees, metres, uniform scale, morph weights)
  part:(state, p, params) => {
    const out = clone(state), prev = state.parts[params.part] ?? REST_PART;
    const morph = {...prev.morph};
    for (const [k, w] of Object.entries(params.morph ?? {})) morph[k] = (prev.morph[k] ?? 0) + (w - (prev.morph[k] ?? 0)) * p;
    out.parts[params.part] = {position:lerpArray(prev.position, params.position, p), rotation:lerpArray(prev.rotation, params.rotation, p),
      scale:prev.scale + ((params.scale ?? prev.scale) - prev.scale) * p, morph};
    return out;
  },
  // X-ray amount eases; which parts stay solid, the section plane and the ghost look switch when the action starts
  material:(state, p, params) => {
    const out = clone(state), m = state.material;
    out.material = {xray:params.xray === undefined ? m.xray : m.xray + (params.xray - m.xray) * p, keep:params.keep ?? m.keep,
      section:params.section === undefined ? m.section : params.section, ghost:params.ghost ?? m.ghost};
    return out;
  },
  appear:state => ({...clone(state), visible:true}),
  hide:state => ({...clone(state), visible:false})
};

export function propStateAt(prop, frame) {
  let state = baseState(prop);
  for (const action of prop.actions) {
    if (frame < action.startFrame) break;
    const span = action.endFrame - action.startFrame;
    const linear = span > 0 ? Math.min(1, (frame - action.startFrame) / span) : 1;
    const p = INSTANT_ACTIONS.has(action.type) ? 1 : ease(action.ease ?? 'cubic', linear);
    state = APPLY[action.type](state, p, action.params ?? {}, prop);
  }
  return grounded(prop, state);
}

export function propWorldBox(prop, frame) {
  return prop.bounds ? worldBox(prop, propStateAt(prop, frame)) : null;
}

export function propWorldPoints(prop, frame) {
  return prop.bounds ? worldPoints(prop, propStateAt(prop, frame)) : null;
}
