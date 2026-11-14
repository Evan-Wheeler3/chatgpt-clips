import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { resolveAssets } from '../asset-resolver.mjs';
import { resolveAnchor } from './anchors.mjs';
import { BEHAVIORS, FRAMING, FRAMING_ORDER, LENSES } from './camera.mjs';
import { ACTION_TYPES, INSTANT_ACTIONS } from './actions.mjs';
import { isEasing } from './easing.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TIMING_DEFAULTS = {cutLeadSec:0.1, eventLeadSec:0.07, tailSec:0.6, minShotSec:0.5, maxShotSec:4.5};
const TRANSITIONS = ['cut', 'whip'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

// Bounds plus the model's extreme vertices in ~100 directions: a silhouette proxy that frames and grounds
// round objects correctly from any angle, where an axis-aligned box would overestimate them
export async function readGlbShape(path, directions = 96) {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).setLogger(new Logger(Logger.Verbosity.ERROR)).read(path);
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  const {min, max} = getBounds(scene);
  const vertices = [];
  scene.traverse(node => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const m = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const position = prim.getAttribute('POSITION');
      if (!position) continue;
      for (let i = 0, p = [0, 0, 0]; i < position.getCount(); i++) {
        position.getElement(i, p);
        vertices.push([m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]]);
      }
    }
  });
  const picked = new Set();
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let k = 0; k < directions; k++) {
    const y = 1 - (k + 0.5) * 2 / directions, r = Math.sqrt(1 - y * y);
    const d = [Math.cos(golden * k) * r, y, Math.sin(golden * k) * r];
    let best = 0, bestDot = -Infinity;
    vertices.forEach((v, i) => { const dot = v[0] * d[0] + v[1] * d[1] + v[2] * d[2]; if (dot > bestDot) { bestDot = dot; best = i; } });
    picked.add(best);
  }
  const round = value => Math.round(value * 1e4) / 1e4;
  return {min, max, points:[...picked].sort((a, b) => a - b).map(i => vertices[i].map(round))};
}

function tighter(framing, steps) {
  const index = FRAMING_ORDER.indexOf(framing) + steps;
  return FRAMING_ORDER[Math.max(0, Math.min(FRAMING_ORDER.length - 1, index))];
}

// Story camera spec -> compiled start/end framings; behaviors supply sensible defaults the author can override
function compileCamera(camera, behavior) {
  const lens = camera.lens ?? 'normal';
  if (!LENSES[lens]) throw new Error(`Unknown lens: ${lens}`);
  const from = {framing:camera.framing ?? 'medium', azimuth:camera.azimuth ?? 0, elevation:camera.elevation ?? 8, focus:camera.focus ?? [0, 0, 0], fov:LENSES[lens]};
  if (behavior === 'reveal') Object.assign(from, {framing:'detail', elevation:3, focus:[0, -0.4, 0]}, camera.from ?? {});
  else if (camera.from) Object.assign(from, camera.from);
  if (camera.from?.lens) from.fov = LENSES[camera.from.lens];
  const to = {...from, prop:undefined, ...(behavior === 'reveal' ? {framing:camera.framing ?? 'medium', azimuth:camera.azimuth ?? from.azimuth, elevation:camera.elevation ?? 8, focus:camera.focus ?? [0, 0, 0]} : {}), ...(camera.to ?? {})};
  if (behavior === 'push-in' && !camera.to?.framing) to.framing = tighter(from.framing, 1);
  if (behavior === 'pullback' && !camera.to?.framing) to.framing = tighter(from.framing, -1);
  if (camera.to?.lens) to.fov = LENSES[camera.to.lens];
  for (const pose of [from, to]) if (!FRAMING[pose.framing]) throw new Error(`Unknown framing: ${pose.framing}`);
  return {from, to};
}

export async function compileStory(story, wordsDoc, {catalogPath = resolve(root, 'assets/catalog.json'), rootDir = root, shapeOf = readGlbShape, storyBytes, wordsBytes} = {}) {
  if (story?.version !== 1) throw new Error('story.version must be 1');
  const fps = story.fps ?? 30;
  const timing = {...TIMING_DEFAULTS, ...(story.timing ?? {})};
  const words = wordsDoc.words.map(word => ({i:word.i, text:word.text, start:word.start, end:word.end, startFrame:Math.round(word.start * fps)}));
  if (!words.length) throw new Error('words.json has no words');
  if (words.some((word, i) => i && word.start < words[i - 1].start)) throw new Error('Word timings are not in order');
  const anchor = (spec, lead = 0) => {
    const resolved = resolveAnchor(words, spec, fps);
    return {...resolved, frame:Math.max(0, Math.round((resolved.time - lead) * fps))};
  };
  const narrationEnd = Math.max(wordsDoc.audio?.durationSec ?? 0, words.at(-1).end);
  const durationFrames = Math.ceil((narrationEnd + timing.tailSec) * fps);

  // Props: every asset comes from the catalog; misses are recorded, never replaced with stand-in geometry
  const props = [];
  const missingAssets = [];
  for (const prop of story.props ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(prop.id ?? '')) throw new Error(`Invalid prop id: ${prop.id}`);
    const [result] = await resolveAssets([{id:prop.id, query:prop.asset.query, style:prop.asset.style, tags:prop.asset.tags}], {catalogPath, rootDir});
    const asset = result.status === 'found' ? result.candidates[0] : null;
    if (!asset) missingAssets.push({prop:prop.id, query:prop.asset.query, style:prop.asset.style ?? null});
    props.push({
      id:prop.id, query:prop.asset.query, missing:!asset, sizeHint:prop.sizeHint ?? null,
      asset:asset && {id:asset.id, name:asset.name, localPath:asset.localPath, sha256:asset.sha256 ?? null, license:asset.license, creator:asset.creator, sourceUrl:asset.sourceUrl},
      ...(asset ? await shapeOf(resolve(rootDir, asset.localPath)).then(({min, max, points}) => ({bounds:{min, max}, points})) : {bounds:null, points:null}),
      base:{position:prop.position ?? [0, 0, 0], rotation:prop.rotation ?? [0, 0, 0], scale:prop.scale ?? 1, visible:prop.visible ?? true, grounded:prop.grounded ?? true},
      actions:[]
    });
  }
  const propById = new Map(props.map(prop => [prop.id, prop]));

  const shots = [];
  for (const beat of story.beats ?? []) {
    if (!beat.id || !beat.purpose) throw new Error('Every beat needs an id and a purpose');
    for (const shot of beat.shots ?? []) {
      const behavior = shot.camera?.move;
      if (!BEHAVIORS.includes(behavior)) throw new Error(`Shot ${shot.id}: unknown camera move "${behavior}"`);
      if (!propById.has(shot.subject)) throw new Error(`Shot ${shot.id}: unknown subject "${shot.subject}"`);
      for (const id of shot.foreground ?? []) if (!propById.has(id)) throw new Error(`Shot ${shot.id}: unknown foreground prop "${id}"`);
      const transition = {type:shot.transition?.type ?? 'cut', motivation:shot.transition?.motivation ?? null, frames:shot.transition?.frames};
      if (!TRANSITIONS.includes(transition.type)) throw new Error(`Shot ${shot.id}: unknown transition "${transition.type}"`);
      const easeName = shot.camera.ease ?? (behavior === 'whip-pan' ? 'whip' : 'dolly');
      if (!isEasing(easeName)) throw new Error(`Shot ${shot.id}: unknown easing "${easeName}"`);
      const start = shots.length ? anchor(shot.start, timing.cutLeadSec) : {frame:0, word:null, wordIndex:null, time:0};
      shots.push({
        id:shot.id, beat:beat.id, purpose:shot.purpose ?? '', subject:shot.subject, startFrame:start.frame, startAnchor:shot.start ?? null,
        foreground:shot.foreground ?? [],
        transition, camera:{behavior, ...compileCamera(shot.camera, behavior), ease:easeName, params:shot.camera.params ?? {}, during:shot.camera.during ?? null},
        // Focus frames land on or just after the word starts, never the frame before it
        focus:(shot.focus ?? []).map(spec => { const r = resolveAnchor(words, spec, fps); return {...r, frame:Math.ceil(r.time * fps - 1e-6), spec}; }),
        events:shot.events ?? [], raw:shot
      });
    }
  }
  if (!shots.length) throw new Error('Story has no shots');
  shots.forEach((shot, i) => { shot.endFrame = i + 1 < shots.length ? shots[i + 1].startFrame : durationFrames; });
  for (const shot of shots) {
    if (shot.endFrame <= shot.startFrame) throw new Error(`Shot ${shot.id} has no duration (frames ${shot.startFrame}-${shot.endFrame}); check its start anchor order`);
    const during = shot.camera.during;
    const from = during?.from ? anchor(during.from, timing.eventLeadSec).frame : shot.startFrame;
    const to = during?.to ? anchor(typeof during.to === 'string' ? {at:during.to, edge:'end'} : during.to).frame : shot.endFrame - 1;
    shot.camera.window = [Math.max(shot.startFrame, from), Math.min(shot.endFrame - 1, Math.max(from, to))];

    // Events become prop actions on the global timeline, so continuity carries across cuts
    for (const event of shot.events) {
      const prop = propById.get(event.prop);
      if (!prop) throw new Error(`Shot ${shot.id}: event targets unknown prop "${event.prop}"`);
      if (!ACTION_TYPES.includes(event.do)) throw new Error(`Shot ${shot.id}: unknown action "${event.do}"`);
      if (event.ease && !isEasing(event.ease)) throw new Error(`Shot ${shot.id}: unknown easing "${event.ease}"`);
      const at = event.at === 'shot-start' || event.at === undefined ? {frame:shot.startFrame, word:null, wordIndex:null} : anchor(event.at, timing.eventLeadSec);
      let endFrame = at.frame;
      if (!INSTANT_ACTIONS.has(event.do)) {
        if (event.until) endFrame = anchor(typeof event.until === 'string' ? {at:event.until, edge:'end'} : event.until).frame;
        else if (event.duration) endFrame = at.frame + Math.round(event.duration * fps);
        else throw new Error(`Shot ${shot.id}: ${event.do} needs "until" or "duration"`);
      }
      prop.actions.push({type:event.do, startFrame:at.frame, endFrame:Math.max(at.frame, endFrame), params:event.params ?? {}, ease:event.ease ?? null,
        anchor:at.word ? {word:at.word, wordIndex:at.wordIndex, wordFrame:words[at.wordIndex].startFrame} : null, shot:shot.id});
    }
    delete shot.raw;
    delete shot.events;
  }
  for (const prop of props) prop.actions.sort((a, b) => a.startFrame - b.startFrame);

  return {
    version:1, slug:story.slug, title:story.title ?? story.slug, fps, size:story.size ?? {width:1080, height:1920}, durationFrames, timing,
    audio:{file:wordsDoc.audio?.file ?? null, sha256:wordsDoc.audio?.sha256 ?? null, durationSec:wordsDoc.audio?.durationSec ?? null},
    words, stage:story.stage ?? {}, props, shots, missingAssets,
    sources:{story:storyBytes ? sha256(storyBytes) : null, words:wordsBytes ? sha256(wordsBytes) : null, narration:wordsDoc.source ?? null, aligner:wordsDoc.aligner ?? null}
  };
}

export async function compileFiles(storyPath, wordsPath, options = {}) {
  const [storyBytes, wordsBytes] = await Promise.all([readFile(storyPath), readFile(wordsPath)]);
  return compileStory(JSON.parse(storyBytes), JSON.parse(wordsBytes), {...options, storyBytes, wordsBytes});
}
