import { createHash } from 'node:crypto';
export { readGlbShape } from './shape.mjs';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlbShape, cachedShape } from './shape.mjs';
import { compileEnvironment, loadStyle } from '../environment/compile.mjs';
import { loadCharacter, loadWearing, castApproval } from '../characters/load.mjs';
import { planCaptions } from '../captions/plan.mjs';
import { CHARACTER_ACTIONS, INSTANT_CHARACTER_ACTIONS, POSE_PRESETS } from './character.mjs';
import { resolveAssets } from '../asset-resolver.mjs';
import { resolveAnchor } from './anchors.mjs';
import { BEHAVIORS, FRAMING, FRAMING_ORDER, LENSES } from './camera.mjs';
import { ACTION_TYPES, INSTANT_ACTIONS } from './actions.mjs';
import { isEasing } from './easing.mjs';
import { validateEffectDeclaration, validateEffectKey } from './effects.mjs';
import { resolveAttachments, checkContacts } from './attach.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const TIMING_DEFAULTS = {cutLeadSec:0.1, eventLeadSec:0.07, tailSec:0.6, minShotSec:0.5, maxShotSec:4.5};
const TRANSITIONS = ['cut', 'whip'];
const sha256 = data => createHash('sha256').update(data).digest('hex');

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

export async function compileStory(story, wordsDoc, {catalogPath = resolve(root, 'assets/catalog.json'), rootDir = root, shapeOf, storyBytes, wordsBytes} = {}) {
  // Default: silhouettes cached by GLB hash; tests may inject their own
  const shapeFor = (path, sha) => shapeOf ? shapeOf(path) : sha ? cachedShape(path, sha) : readGlbShape(path);
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
      ...(asset ? await shapeFor(resolve(rootDir, asset.localPath), asset.sha256).then(({min, max, points, nodes, sockets}) => ({bounds:{min, max}, points, nodes:nodes ?? null, sockets:sockets ?? null})) : {bounds:null, points:null, nodes:null, sockets:null}),
      attach:prop.attach ?? null, holes:prop.holes ?? null,
      base:{position:prop.position ?? [0, 0, 0], rotation:prop.rotation ?? [0, 0, 0], scale:prop.scale ?? 1, visible:prop.visible ?? true, grounded:prop.grounded ?? true},
      actions:[]
    });
  }
  const propById = new Map(props.map(prop => [prop.id, prop]));
  // Physical attachments (a nozzle in a filler neck): placed from the models' sockets, never from typed coordinates
  for (const prop of props) {
    if (prop.attach && !['to', 'socket', 'via'].every(k => typeof prop.attach[k] === 'string')) throw new Error(`Prop ${prop.id}: attach needs to, socket and via`);
    for (const hole of prop.holes ?? []) if (typeof hole.socket !== 'string' || !Array.isArray(hole.size)) throw new Error(`Prop ${prop.id}: holes need a socket and a size [w, h]`);
    if ((prop.holes ?? []).length > 1) throw new Error(`Prop ${prop.id}: one hole per prop is supported`);
    for (const hole of prop.holes ?? []) if (!prop.missing && !prop.sockets?.[hole.socket]) throw new Error(`Prop ${prop.id}: no socket "${hole.socket}" for its hole`);
  }
  const unresolvedAttachments = resolveAttachments(props);

  // Effects: declared once, animated by shot events (tools/storyboard/effects.mjs)
  const effects = [];
  for (const declared of story.effects ?? []) {
    validateEffectDeclaration(declared);
    if (effects.some(e => e.id === declared.id) || propById.has(declared.id)) throw new Error(`Duplicate effect id: ${declared.id}`);
    if (declared.attach?.prop && !propById.has(declared.attach.prop)) throw new Error(`Effect ${declared.id}: attaches to unknown prop "${declared.attach.prop}"`);
    const host = declared.attach?.prop ? propById.get(declared.attach.prop) : null;
    if (declared.attach?.part && host?.nodes && !host.nodes.includes(declared.attach.part)) throw new Error(`Effect ${declared.id}: prop ${host.id} has no part "${declared.attach.part}"`);
    if (declared.type === 'hose') for (const end of ['from', 'to']) {
      const e = declared.params?.[end], host = e && propById.get(e.prop);
      if (!host) throw new Error(`Hose ${declared.id}: ${end} needs a known prop`);
      if (!host.missing && !host.sockets?.[e.socket]) throw new Error(`Hose ${declared.id}: prop ${host.id} has no socket "${e.socket}"`);
    }
    effects.push({id:declared.id, type:declared.type, attach:declared.attach ?? null, params:declared.params ?? {}, initial:declared.initial ?? {}, keys:[]});
  }
  const effectById = new Map(effects.map(effect => [effect.id, effect]));
  const freezes = [], shakes = [];

  // Look and place: channel style with story palette overrides, and an optional reusable environment
  const style = await loadStyle(story.style?.id ?? 'hold-up', story.style ?? {});
  // Catalogs and the build cache live under the same root as the story's assets
  const environment = story.environment ? await compileEnvironment(story.environment.id, {style, catalogPath, rootDir,
    textureCatalogPath:resolve(rootDir, 'assets/texture-catalog.json'), cacheDir:resolve(rootDir, '.cache/environments')}) : null;

  // Cast: original 2D characters; definitions are fixed per character so appearance is consistent across shots
  const cast = [];
  for (const member of story.cast ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(member.id ?? '') || propById.has(member.id)) throw new Error(`Invalid or duplicate cast id: ${member.id}`);
    let definition = await loadCharacter(rootDir, member.character);
    const wearing = await loadWearing(rootDir, member.character, member);
    if (Object.keys(wearing).length) definition = {...definition, wearing};
    if (definition.version !== 1 || definition.id !== member.character.split('/').pop()) throw new Error(`Character ${member.character}: bad definition`);
    if (!Array.isArray(member.start?.position)) throw new Error(`Cast ${member.id}: needs start.position [x, z]`);
    cast.push({id:member.id, character:member.character, definition, start:member.start, actions:[], approval:await castApproval(rootDir, member.character, member)});
  }
  const castById = new Map(cast.map(member => [member.id, member]));

  const shots = [];
  for (const beat of story.beats ?? []) {
    if (!beat.id || !beat.purpose) throw new Error('Every beat needs an id and a purpose');
    for (const shot of beat.shots ?? []) {
      const behavior = shot.camera?.move;
      if (!BEHAVIORS.includes(behavior)) throw new Error(`Shot ${shot.id}: unknown camera move "${behavior}"`);
      if (!propById.has(shot.subject)) throw new Error(`Shot ${shot.id}: unknown subject "${shot.subject}"`);
      for (const id of shot.foreground ?? []) if (!propById.has(id)) throw new Error(`Shot ${shot.id}: unknown foreground prop "${id}"`);
      // intent "contrast" declares a deliberate smash cut, so composition-continuity warnings are skipped for it
      const transition = {type:shot.transition?.type ?? 'cut', motivation:shot.transition?.motivation ?? null, frames:shot.transition?.frames, intent:shot.transition?.intent ?? 'continuity'};
      if (!['continuity', 'contrast'].includes(transition.intent)) throw new Error(`Shot ${shot.id}: transition intent must be "continuity" or "contrast"`);
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
      if (event.character) {
        const member = castById.get(event.character);
        if (!member) throw new Error(`Shot ${shot.id}: event targets unknown cast member "${event.character}"`);
        if (!CHARACTER_ACTIONS.includes(event.do)) throw new Error(`Shot ${shot.id}: unknown character action "${event.do}"`);
        if (event.do === 'pose' && !POSE_PRESETS[event.params?.preset]) throw new Error(`Shot ${shot.id}: unknown pose preset "${event.params?.preset}"`);
        if ((event.do === 'push' || event.do === 'touch') && !propById.has(event.params?.prop)) throw new Error(`Shot ${shot.id}: ${event.do} needs params.prop`);
        const at = event.at === 'shot-start' || event.at === undefined ? {frame:shot.startFrame, word:null, wordIndex:null} : anchor(event.at, timing.eventLeadSec);
        let endFrame = at.frame;
        if (event.until) endFrame = anchor(typeof event.until === 'string' ? {at:event.until, edge:'end'} : event.until).frame;
        else if (event.duration) endFrame = at.frame + Math.round(event.duration * fps);
        else if (event.do === 'walk') throw new Error(`Shot ${shot.id}: walk needs "until" or "duration"`);
        else if (event.do === 'push') endFrame = at.frame + Math.round(0.35 * fps);
        else if (event.do === 'touch') endFrame = at.frame + fps;
        member.actions.push({type:event.do, startFrame:at.frame, endFrame:Math.max(at.frame, endFrame), params:event.params ?? {},
          anchor:at.word ? {word:at.word, wordIndex:at.wordIndex, wordFrame:words[at.wordIndex].startFrame} : null, shot:shot.id, instant:INSTANT_CHARACTER_ACTIONS.has(event.do)});
        continue;
      }
      if (event.effect) {
        const effect = effectById.get(event.effect);
        if (!effect) throw new Error(`Shot ${shot.id}: event targets unknown effect "${event.effect}"`);
        if (event.do !== 'animate') throw new Error(`Shot ${shot.id}: effect events use "do":"animate"`);
        validateEffectKey(effect, event.set, `Shot ${shot.id}`);
        if (event.ease && !isEasing(event.ease)) throw new Error(`Shot ${shot.id}: unknown easing "${event.ease}"`);
        const at = event.at === 'shot-start' || event.at === undefined ? {frame:shot.startFrame, word:null, wordIndex:null} : anchor(event.at, timing.eventLeadSec);
        let endFrame = at.frame;
        if (event.until) endFrame = anchor(typeof event.until === 'string' ? {at:event.until, edge:'end'} : event.until).frame;
        else if (event.duration !== undefined) endFrame = at.frame + Math.round(event.duration * fps);
        effect.keys.push({startFrame:at.frame, endFrame:Math.max(at.frame, endFrame), set:event.set, ease:event.ease ?? null, shot:shot.id,
          anchor:at.word ? {word:at.word, wordIndex:at.wordIndex, wordFrame:words[at.wordIndex].startFrame} : null});
        continue;
      }
      const prop = propById.get(event.prop);
      if (!prop) throw new Error(`Shot ${shot.id}: event targets unknown prop "${event.prop}"`);
      if (event.do === 'part') {
        if (typeof event.params?.part !== 'string') throw new Error(`Shot ${shot.id}: part events need params.part`);
        if (prop.nodes && !prop.nodes.includes(event.params.part)) throw new Error(`Shot ${shot.id}: prop ${prop.id} has no part "${event.params.part}" (${prop.nodes.join(', ')})`);
      }
      if (event.do === 'material') {
        const x = event.params?.xray;
        if (x !== undefined && !(x >= 0 && x <= 1)) throw new Error(`Shot ${shot.id}: material xray must be between 0 and 1`);
        for (const part of event.params?.keep ?? []) if (prop.nodes && !prop.nodes.includes(part)) throw new Error(`Shot ${shot.id}: prop ${prop.id} has no part "${part}" to keep solid`);
      }
      if (!ACTION_TYPES.includes(event.do)) throw new Error(`Shot ${shot.id}: unknown action "${event.do}"`);
      if (event.ease && !isEasing(event.ease)) throw new Error(`Shot ${shot.id}: unknown easing "${event.ease}"`);
      const at = event.at === 'shot-start' || event.at === undefined ? {frame:shot.startFrame, word:null, wordIndex:null} : anchor(event.at, timing.eventLeadSec);
      let endFrame = at.frame;
      if (!INSTANT_ACTIONS.has(event.do)) {
        if (event.until) endFrame = anchor(typeof event.until === 'string' ? {at:event.until, edge:'end'} : event.until).frame;
        else if (event.duration) endFrame = at.frame + Math.round(event.duration * fps);
        else if (event.duration === 0 && (event.do === 'part' || event.do === 'material')) endFrame = at.frame; // A switch on the frame
        else throw new Error(`Shot ${shot.id}: ${event.do} needs "until" or "duration"`);
      }
      prop.actions.push({type:event.do, startFrame:at.frame, endFrame:Math.max(at.frame, endFrame), params:event.params ?? {}, ease:event.ease ?? null,
        anchor:at.word ? {word:at.word, wordIndex:at.wordIndex, wordFrame:words[at.wordIndex].startFrame} : null, shot:shot.id});
    }
    // Time effects: a freeze (the scene holds for a few frames; captions and audio run on) and a camera shake
    if (shot.raw.freeze) {
      const f = shot.raw.freeze, at = f.at === undefined || f.at === 'shot-start' ? {frame:shot.startFrame} : anchor(f.at, 0);
      if (!(Number.isInteger(f.frames) && f.frames > 0 && f.frames <= 30)) throw new Error(`Shot ${shot.id}: freeze.frames must be 1-30`);
      freezes.push({startFrame:at.frame, frames:f.frames, shot:shot.id});
    }
    if (shot.raw.camera?.shake) {
      const k = shot.raw.camera.shake, at = anchor(k.at, 0);
      if (!(k.amplitude > 0 && k.amplitude <= 0.1)) throw new Error(`Shot ${shot.id}: camera.shake.amplitude must be in (0, 0.1] (a fraction of the camera distance)`);
      shakes.push({startFrame:at.frame, frames:k.frames ?? 3, amplitude:k.amplitude, shot:shot.id});
    }
    delete shot.raw;
    delete shot.events;
  }
  for (const prop of props) prop.actions.sort((a, b) => a.startFrame - b.startFrame);
  for (const effect of effects) effect.keys.sort((a, b) => a.startFrame - b.startFrame);
  for (const member of cast) member.actions.sort((a, b) => a.startFrame - b.startFrame);

  const plan = {
    version:1, slug:story.slug, title:story.title ?? story.slug, fps, size:story.size ?? {width:1080, height:1920}, durationFrames, timing,
    audio:{file:wordsDoc.audio?.file ?? null, sha256:wordsDoc.audio?.sha256 ?? null, durationSec:wordsDoc.audio?.durationSec ?? null},
    words, stage:story.stage ?? {}, props, shots, missingAssets, style, environment, cast, effects, freezes:freezes.sort((a, b) => a.startFrame - b.startFrame), shakes,
    sources:{story:storyBytes ? sha256(storyBytes) : null, words:wordsBytes ? sha256(wordsBytes) : null, narration:wordsDoc.source ?? null, aligner:wordsDoc.aligner ?? null}
  };
  // Contacts: alignment, insertion depth, orientation, body intersection, hose attachment (checked on real triangles)
  plan.unresolvedAttachments = unresolvedAttachments;
  plan.contacts = await checkContacts(props, effects, prop => resolve(rootDir, prop.asset.localPath));
  // Captions are planned from the measured words and the staged shots (story.captions: false turns them off)
  plan.captions = planCaptions(plan, story);
  return plan;
}

export async function compileFiles(storyPath, wordsPath, options = {}) {
  const [storyBytes, wordsBytes] = await Promise.all([readFile(storyPath), readFile(wordsPath)]);
  return compileStory(JSON.parse(storyBytes), JSON.parse(wordsBytes), {...options, storyBytes, wordsBytes});
}
