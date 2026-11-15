import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { samplePlan } from '../storyboard/sample.mjs';
import { buildEffects, partRig, materialRig } from './effects.mjs';
import { propWorldPoints } from '../storyboard/actions.mjs';
import { QUALITY } from './quality.mjs';
import { stylizeObject } from './stylize.mjs';
import { createPost } from './post.mjs';
import { buildEnvironment } from './environment.mjs';
import { buildCharacter } from './character-rig.mjs';
import { buildHybridCharacter } from './character-hybrid.mjs';
import { buildVectorCharacter } from './character-vector.mjs';
import { drawCaptions } from './captions.mjs';

let plan, quality, renderer, scene, camera, out, ctx, post, env = null, W, H, issues = [], keyLight;
const groups = new Map(), shadows = new Map(), characters = new Map(), rigs = new Map();
let updateEffects = () => {};
const flags = [];

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let blob;
function contactLayer(opacity) {
  blob ??= blobTexture();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({map:blob, color:0x000000, transparent:true, opacity, depthWrite:false}));
  mesh.rotation.x = -Math.PI / 2; mesh.renderOrder = 1; mesh.userData.opacity = opacity;
  scene.add(mesh);
  return mesh;
}

// Phase 4 stage: plain ground, background, fog and three lights (used by the fast animatic quality)
function buildStage(stage) {
  const background = new THREE.Color(stage.background ?? '#1d1b19');
  scene.background = background;
  if (stage.fog) scene.fog = new THREE.Fog(background, stage.fog.near ?? 4, stage.fog.far ?? 12);
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = stage.light?.environment ?? 0.35;
  scene.add(new THREE.HemisphereLight(stage.light?.sky ?? '#cfd8e6', stage.light?.bounce ?? '#4a3a2a', stage.light?.ambient ?? 0.6));
  keyLight = new THREE.DirectionalLight(stage.light?.key ?? '#ffe2b8', stage.light?.keyIntensity ?? 2.2);
  keyLight.position.set(...(stage.light?.keyPosition ?? [2.5, 4, 3]));
  keyLight.castShadow = true; keyLight.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  Object.assign(keyLight.shadow.camera, {left:-4, right:4, top:4, bottom:-4, near:0.5, far:15});
  keyLight.shadow.bias = -0.0005;
  scene.add(keyLight);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({color:stage.ground?.color ?? '#5b4a3a', roughness:0.95}));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);
}

window.setup = async (planJson, size, issueList, qualityName) => {
  plan = planJson; W = size.width; H = size.height; issues = issueList;
  quality = {name:qualityName, ...QUALITY[qualityName]};
  const style = plan.style;
  // The caption font is a local system font; make sure it is loaded before the first frame is drawn
  if (plan.captions?.enabled) { const f = plan.captions.style.font; await document.fonts.load(`${f.weight} ${f.sizePx}px ${f.family}`).catch(() => {}); }
  renderer = new THREE.WebGLRenderer({antialias:quality.post === 'none', preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = quality.stylize ? style?.grade?.exposure ?? 1 : plan.stage?.light?.exposure ?? 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // Count every pass of a frame, not just the last full-screen quad
  renderer.localClippingEnabled = true; // Section cuts on props (material state)
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 120);

  const loader = new GLTFLoader(), loaded = new Map();
  const loadGLB = async id => { if (!loaded.has(id)) loaded.set(id, await loader.loadAsync('/asset/' + id + '.glb')); return loaded.get(id); };
  const textureLoader = new THREE.TextureLoader(), textures = new Map();
  const loadTexture = async path => { if (!textures.has(path)) textures.set(path, await textureLoader.loadAsync('/tex/' + path)); return textures.get(path); };

  if (quality.environment && plan.environment) {
    env = await buildEnvironment({scene, renderer, env:plan.environment, style, quality, loadGLB, loadTexture});
    keyLight = env.keyLight;
    flags.push(...new Set([...plan.environment.missing.map(m => `MISSING ${m.kind.toUpperCase()}: ${m.material ?? m.id}`), ...env.flags]));
  } else buildStage(plan.stage ?? {});

  for (const prop of plan.props) {
    if (prop.missing) continue;
    const model = (await loadGLB(prop.asset.id)).scene.clone(true);
    model.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.material = o.material.clone(); } });
    if (quality.stylize) stylizeObject(model, style.materials.hero, style.palette, {outlineScale:quality.name === 'production' ? 1 : 1.6});
    const group = new THREE.Group(); group.add(model); scene.add(group);
    groups.set(prop.id, group);
    rigs.set(prop.id, {parts:partRig(model), material:materialRig(model, group)});
    if (prop.base.grounded !== false) shadows.set(prop.id, [contactLayer(0.35), contactLayer(0.7)]);
  }
  for (const member of plan.cast ?? []) {
    // Hybrid definitions (3D body forms + 2D face) and cutout definitions share the same rig and pose data
    const mode = member.definition.render?.mode;
    const display = quality.post === 'none' ? null : {grade:style.grade, shadowTint:style.palette.shadowTint, highlightTint:style.palette.highlightTint};
    const rig = mode === 'vector-2d' ? buildVectorCharacter(member.definition, {quality, outputWidth:W, outputHeight:H, display})
      : mode === 'hybrid-3d' ? buildHybridCharacter(member.definition, {quality, outputWidth:W, outputHeight:H})
      : buildCharacter(member.definition, {style, quality, maxAnisotropy:renderer.capabilities.getMaxAnisotropy(), outputHeight:H});
    scene.add(rig.group, rig.shadowGroup);
    // Each character also lives on its own layer (1, 2, ...) so QA can render its silhouette mask alone
    const layer = characters.size + 1;
    rig.group.traverse(o => o.layers.enable(layer));
    // Two-layer contact shadow: a soft pool and a tight dark patch under the feet
    characters.set(member.id, {rig, layer, definition:member.definition, shadow:contactLayer((style?.character?.contactShadow ?? 0.6) * 0.6), feet:contactLayer(style?.character?.contactShadow ?? 0.6)});
  }
  updateEffects = buildEffects(plan, {scene, groups});
  post = createPost(renderer, scene, camera, {quality, style, width:W, height:H});
  out = document.createElement('canvas'); out.width = W; out.height = H;
  ctx = out.getContext('2d', {willReadFrequently:true});
  return {props:groups.size, missing:plan.props.filter(p => p.missing).map(p => p.id), characters:characters.size, environment:env ? plan.environment.id : null, flags};
};

function placeContactShadows(frame) {
  for (const prop of plan.props) {
    const layers = shadows.get(prop.id);
    if (!layers) continue;
    const points = propWorldPoints(prop, frame);
    const minY = Math.min(...points.map(p => p.y)), height = Math.max(...points.map(p => p.y)) - minY;
    const fade = Math.max(0, 1 - minY / Math.max(0.05, height * 0.25));
    const footprint = new THREE.Box3().setFromPoints(points);
    const contact = new THREE.Box3().setFromPoints(points.filter(p => p.y <= minY + Math.max(0.01, height * 0.06)));
    [[footprint, 1.25, 0], [contact, 1, 0.08]].forEach(([box, grow, pad], k) => {
      const layer = layers[k], size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
      layer.position.set(center.x, 0.007 + k * 0.001, center.z);
      layer.scale.set(size.x * grow + pad, size.z * grow + pad, 1);
      layer.material.opacity = layer.userData.opacity * fade;
      layer.visible = groups.get(prop.id).visible;
    });
  }
}

// Consistent, gentle lighting response for flat-tinted characters: the environment's key colour plus nearby
// practical warmth, divided by exposure so authored colours survive tone mapping
const tintScratch = new THREE.Color();
function characterTint(c) {
  const t = tintScratch.set(1, 1, 1);
  if (plan.environment && quality.environment) {
    t.lerp(new THREE.Color(plan.environment.lighting.key.color), 0.14).multiplyScalar(0.96);
    for (const p of plan.environment.lighting.practicals) {
      const d = Math.hypot(p.position[0] - c.position[0], p.position[2] - c.position[2]);
      if (d < p.distance) t.add(new THREE.Color(p.color).multiplyScalar(0.1 * (1 - d / p.distance) ** 2));
    }
  }
  if (quality.post !== 'none') t.multiplyScalar(1 / renderer.toneMappingExposure);
  return t;
}

function draw(frame) {
  const s = samplePlan(plan, frame);
  for (const p of s.props) {
    const group = groups.get(p.id);
    if (!group) continue;
    group.position.copy(p.position);
    group.quaternion.copy(p.quaternion).multiply(p.wobble);
    group.scale.setScalar(p.scale);
    group.visible = p.visible;
    const rig = rigs.get(p.id);
    rig.parts(p.parts ?? {});
    rig.material(p.material ?? {xray:0, keep:[], section:null});
  }
  updateEffects(s.effects ?? [], (s.sceneFrame ?? frame) / plan.fps);
  const sceneFrame = s.sceneFrame ?? frame; // A freeze holds everything in the scene (not the film grain or the HUD)
  placeContactShadows(sceneFrame);
  // The camera is set before the characters: vector characters paint at the current frame's screen scale
  camera.fov = s.camera.fov; camera.updateProjectionMatrix();
  camera.position.copy(s.camera.position); camera.lookAt(s.camera.target);
  camera.updateMatrixWorld();
  const lightDir = keyLight ? keyLight.target.position.clone().sub(keyLight.position).normalize() : new THREE.Vector3(0, -1, 0);
  for (const c of s.characters) {
    const {rig, shadow, feet} = characters.get(c.id);
    characters.get(c.id).figure = rig.apply(c, s.camera.position, lightDir, characterTint(c), camera);
    shadow.position.set(c.position[0], 0.008, c.position[2]);
    shadow.scale.set(0.55 * c.heightM, 0.32 * c.heightM, 1);
    // The tight patch widens with the stance (push, walk) so both feet stay grounded
    const stance = 0.16 + Math.abs(Math.sin(THREE.MathUtils.degToRad((c.pose.legF[0] - c.pose.legB[0]) / 2))) * c.heightM * 0.45;
    feet.position.set(c.position[0], 0.009, c.position[2]);
    feet.scale.set(stance * 1.6, 0.12 * c.heightM + 0.05, 1);
    feet.rotation.z = Math.atan2(-c.facing[2], c.facing[0]); // Flat plane: local y is world -z
  }
  env?.update(sceneFrame, plan.fps);
  post.setFrame(frame);
  renderer.info.reset();
  post.render();
  return s;
}

function wrap(text, width) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (ctx.measureText(line + ' ' + word).width > width && line) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  return line ? [...lines, line] : lines;
}

function hud(s, frame) {
  const u = W / 360;
  ctx.font = (11 * u) + 'px sans-serif'; ctx.textBaseline = 'top';
  const label = (text, x, y, color = '#fff', align = 'left') => {
    ctx.textAlign = align; ctx.fillStyle = 'rgba(0,0,0,.55)';
    const w = ctx.measureText(text).width; ctx.fillRect(align === 'left' ? x - 3 * u : x - w - 3 * u, y - 2 * u, w + 6 * u, 15 * u);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  };
  label(s.shot.id + ' · ' + s.shot.camera.behavior + (s.camera.whip ? ' (whip)' : ''), 8 * u, 8 * u);
  label('beat: ' + s.shot.beat + ' · ' + quality.name, 8 * u, 25 * u, '#cbd5e1');
  label((frame / plan.fps).toFixed(2) + 's  f' + frame, W - 8 * u, 8 * u, '#fff', 'right');
  // Safe area for the subject, and the caption band reserved for Phase 6 captions
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.setLineDash([4 * u, 4 * u]);
  ctx.strokeRect(W * 0.1, H * 0.12, W * 0.8, H * 0.63); ctx.setLineDash([]);
  // Stories without production captions (e.g. character reviews on a synthetic beat timeline) keep the review overlay's
  // sentence captions, as before Phase 6.2
  const words = plan.words, current = s.word;
  if (current && !plan.captions?.enabled) {
    let a = current.i, b = current.i;
    while (a > 0 && !/[.?!:]$/.test(words[a - 1].text)) a--;
    while (b < words.length - 1 && !/[.?!:]$/.test(words[b].text)) b++;
    ctx.font = 'bold ' + (15 * u) + 'px sans-serif'; ctx.textAlign = 'center';
    const lines = wrap(words.slice(a, b + 1).map(w => w.text).join(' '), W * 0.8);
    let y = H * 0.79, k = a;
    for (const line of lines) {
      const tokens = line.split(' '); let x = W / 2 - ctx.measureText(line).width / 2;
      ctx.textAlign = 'left';
      for (const t of tokens) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(t, x + u, y + u);
        ctx.fillStyle = k === current.i ? '#facc15' : '#fff'; ctx.fillText(t, x, y);
        x += ctx.measureText(t + ' ').width; k++;
      }
      y += 19 * u;
    }
  }
  ctx.font = 'bold ' + (11 * u) + 'px sans-serif';
  // Missing assets are flagged where they should be, never drawn as substitute geometry
  for (const prop of plan.props.filter(p => p.missing)) {
    const v = new THREE.Vector3(...prop.base.position).add(new THREE.Vector3(0, (prop.sizeHint?.[1] ?? 0.5) / 2, 0)).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { label('MISSING ASSET: ' + prop.query + ' (off-screen)', 8 * u, 42 * u, '#f87171'); continue; }
    label('MISSING ASSET: ' + prop.query, (v.x + 1) / 2 * W, (1 - v.y) / 2 * H, '#f87171', 'left');
  }
  flags.slice(0, 3).forEach((f, n) => label(f, 8 * u, (H - (20 + 16 * n) * u), '#f87171'));
  const active = issues.filter(i => i.frames && frame >= i.frames[0] && frame <= i.frames[1] && i.shot === s.shot.id);
  active.slice(0, 2).forEach((issue, n) => label('⚠ ' + issue.code, 8 * u, (42 + 17 * n) * u, '#fb923c'));
}

function compose(frame, withHud = quality.hud) {
  const s = draw(frame);
  ctx.globalAlpha = 1; ctx.drawImage(renderer.domElement, 0, 0);
  if (s.camera.whip) {
    // Whip pans get real motion blur: about one sub-frame per 3 degrees of rotation, within the quality's range
    const look = c => c.target.clone().sub(c.position).normalize();
    const degrees = THREE.MathUtils.radToDeg(look(s.camera).angleTo(look(samplePlan(plan, frame + 1).camera)));
    const [lo, hi] = quality.whipSamples;
    const n = Math.min(hi, Math.max(lo, Math.ceil(degrees / 3)));
    for (let k = 1; k < n; k++) { draw(frame + k / n); ctx.globalAlpha = 1 / (k + 1); ctx.drawImage(renderer.domElement, 0, 0); }
    ctx.globalAlpha = 1; draw(frame);
  }
  if (withHud) hud(s, frame);
  // Burned-in captions (all qualities): the plan's groups, timing, placement and style
  lastCaption = plan.captions?.enabled && quality.captions !== false ? drawCaptions(ctx, plan.captions, frame / plan.fps, {width:W, height:H}) : null;
  return s;
}
let lastCaption = null;
window.captionFrames = frames => frames.map(frame => { compose(frame, false); return {frame, caption:lastCaption}; });

window.renderFrames = (frames, format = 'image/jpeg', hud) => frames.map(frame => { compose(frame, hud ?? quality.hud); return out.toDataURL(format, 0.9); });

window.renderSheet = (entries, columns) => {
  const tw = W, th = H, band = 90 * W / 360;
  const rows = Math.ceil(entries.length / columns);
  const sheet = document.createElement('canvas'); sheet.width = tw * columns; sheet.height = (th + band) * rows;
  const sc = sheet.getContext('2d'); sc.fillStyle = '#111'; sc.fillRect(0, 0, sheet.width, sheet.height);
  entries.forEach((entry, i) => {
    compose(entry.frame, true);
    const x = (i % columns) * tw, y = Math.floor(i / columns) * (th + band);
    sc.drawImage(out, x, y);
    sc.fillStyle = '#fff'; sc.font = 'bold ' + (13 * W / 360) + 'px sans-serif'; sc.textBaseline = 'top';
    sc.fillText(entry.title, x + 8, y + th + 6);
    sc.font = (11 * W / 360) + 'px sans-serif'; sc.fillStyle = '#cbd5e1';
    const words = entry.purpose.split(' '); let line = '', ly = y + th + 26 * W / 360;
    for (const w of words) { if (sc.measureText(line + ' ' + w).width > tw - 16 && line) { sc.fillText(line, x + 8, ly); ly += 14 * W / 360; line = w; } else line = line ? line + ' ' + w : w; }
    if (ly < y + th + band - 12) sc.fillText(line, x + 8, ly);
  });
  return sheet.toDataURL('image/png');
};

// Pixel QA on clean frames (no overlay): exposure, clipping, and subject/character contrast against their surroundings
function rectOf(points) {
  const v = points.map(p => p.clone().project(camera)).filter(p => p.z < 1);
  if (!v.length) return null;
  const xs = v.map(p => (p.x + 1) / 2 * W), ys = v.map(p => (1 - p.y) / 2 * H);
  const r = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(W, Math.max(...xs)), Math.min(H, Math.max(...ys))];
  return r[2] - r[0] > 4 && r[3] - r[1] > 4 ? r : null;
}
function lumaStats(data, rect) {
  let sum = 0, n = 0;
  const [x0, y0, x1, y1] = rect.map(Math.round);
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) {
    const i = (y * W + x) * 4; sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255; n++;
  }
  return n ? sum / n : null;
}
window.qaFrames = frames => frames.map(frame => {
  const s = compose(frame, false);
  const data = ctx.getImageData(0, 0, W, H).data;
  let sum = 0, high = 0, low = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    sum += l; n++; if (l > 0.98) high++; if (l < 0.03) low++;
  }
  const region = rect => {
    if (!rect) return null;
    const inner = lumaStats(data, rect);
    const pad = Math.max(rect[2] - rect[0], rect[3] - rect[1]) * 0.25;
    const outer = [Math.max(0, rect[0] - pad), Math.max(0, rect[1] - pad), Math.min(W, rect[2] + pad), Math.min(H, rect[3] + pad)];
    const ring = (lumaStats(data, outer) * (outer[2] - outer[0]) * (outer[3] - outer[1]) - inner * (rect[2] - rect[0]) * (rect[3] - rect[1])) / Math.max(1, (outer[2] - outer[0]) * (outer[3] - outer[1]) - (rect[2] - rect[0]) * (rect[3] - rect[1]));
    return {rect, luma:inner, ring, contrast:Math.abs(inner - ring)};
  };
  const subjectProp = plan.props.find(p => p.id === s.shot.subject);
  const subject = subjectProp && !subjectProp.missing ? region(rectOf(propWorldPoints(subjectProp, frame))) : null;
  const chars = s.characters.map(c => {
    const p = new THREE.Vector3(...c.position);
    return {id:c.id, ...region(rectOf([p.clone().add(new THREE.Vector3(-0.3, 0, 0)), p.clone().add(new THREE.Vector3(0.3, c.heightM, 0))])) ?? {visible:false}};
  });
  const info = renderer.info;
  return {frame, shot:s.shot.id, meanLuma:sum / n, clippedHigh:high / n, crushedLow:low / n, subject, characters:chars,
    renderer:{calls:info.render.calls, triangles:info.render.triangles, textures:info.memory.textures, geometries:info.memory.geometries}};
});

// ---- Character readability metrics on rendered pixels (review assistance) ----
const toLab = (r, g, b) => {
  const lin = c => (c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};
let maskTarget;
function characterMask(layer) {
  maskTarget ??= new THREE.WebGLRenderTarget(W, H);
  const background = scene.background, fogged = scene.fog;
  scene.background = null; scene.fog = null;
  renderer.setRenderTarget(maskTarget); renderer.setClearColor(0x000000, 0); renderer.clear();
  camera.layers.set(layer);
  renderer.render(scene, camera);
  camera.layers.set(0);
  renderer.setRenderTarget(null);
  scene.background = background; scene.fog = fogged;
  const px = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(maskTarget, 0, 0, W, H, px);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) mask[(H - 1 - y) * W + x] = px[(y * W + x) * 4 + 3] > 127 ? 1 : 0; // GL rows are bottom-up
  return mask;
}
function pieces(mask, minArea) {
  const seen = new Uint8Array(mask.length); let count = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;
    let area = 0; const stack = [i]; seen[i] = 1;
    while (stack.length) {
      const j = stack.pop(); area++;
      const x = j % W, y = (j - x) / W;
      for (const k of [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, y > 0 ? j - W : -1, y < H - 1 ? j + W : -1]) if (k >= 0 && mask[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
    }
    if (area >= minArea) count++;
  }
  return count;
}
window.characterMetrics = frames => frames.map(frame => {
  const s = compose(frame, false);
  const data = ctx.getImageData(0, 0, W, H).data;
  const luma = i => (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
  return {frame, shot:s.shot.id, characters:s.characters.map(c => {
    const entry = characters.get(c.id);
    const mask = characterMask(entry.layer);
    let area = 0, bbox = [W, H, 0, 0];
    for (let i = 0; i < mask.length; i++) if (mask[i]) { area++; const x = i % W, y = (i - x) / W; bbox = [Math.min(bbox[0], x), Math.min(bbox[1], y), Math.max(bbox[2], x), Math.max(bbox[3], y)]; }
    if (area < 300) return {id:c.id, visible:false};
    // Silhouette edge: luminance step from each boundary pixel to the background two pixels outside it
    let edgeSum = 0, edgeN = 0, inLab = [0, 0, 0], inN = 0, ringLab = [0, 0, 0], ringN = 0;
    for (let y = 3; y < H - 3; y += 1) for (let x = 3; x < W - 3; x += 1) {
      const i = y * W + x;
      if (mask[i]) {
        const outside = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => !mask[i + dx + dy * W]);
        if (outside) { const o = i + outside[0] * 3 + outside[1] * 3 * W; if (!mask[o]) { edgeSum += Math.abs(luma(i) - luma(o)); edgeN++; } }
        else if ((x + y) % 3 === 0 && mask[i + 3] && mask[i - 3] && mask[i + 3 * W] && mask[i - 3 * W]) { const l = toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); inLab = inLab.map((v, k) => v + l[k]); inN++; }
      } else if ((x + y) % 3 === 0 && (mask[i + 8] || mask[i - 8] || mask[i + 8 * W] || mask[i - 8 * W])) { const l = toLab(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]); ringLab = ringLab.map((v, k) => v + l[k]); ringN++; }
    }
    inLab = inLab.map(v => v / Math.max(1, inN)); ringLab = ringLab.map(v => v / Math.max(1, ringN));
    // Face size on a phone: head height projected, converted to points on a 390-pt-wide portrait screen
    const def = entry.definition, units = def.heightM / def.rig.heightMm;
    const headBounds = (def.parts.head?.shapes ?? []).reduce((a, sh) => { const b = sh.ellipse ? [sh.ellipse[1] - sh.ellipse[3], sh.ellipse[1] + sh.ellipse[3]] : (() => { const n = sh.path.match(/-?\d+(\.\d+)?/g).map(Number).filter((_, k) => k % 2 === 1); return [Math.min(...n), Math.max(...n)]; })(); return [Math.min(a[0], b[0]), Math.max(a[1], b[1])]; }, [Infinity, -Infinity]);
    const headMm = def.forms?.head?.height ?? headBounds[1] - headBounds[0];
    const center = new THREE.Vector3(...c.position).setY((def.rig.hipY - c.pose.hipDrop + def.rig.neckHeight + def.rig.headCenter) * units);
    const top = center.clone().setY(center.y + headMm * units / 2).project(camera), bottom = center.clone().setY(center.y - headMm * units / 2).project(camera);
    const headPx = Math.abs(top.y - bottom.y) / 2 * H;
    const toPoints = 390 / W;
    return {id:c.id, visible:true, areaFraction:area / (W * H), bbox, pieces:pieces(mask, area * 0.004),
      edgeContrast:edgeSum / Math.max(1, edgeN), colorContrast:Math.hypot(...inLab.map((v, k) => v - ringLab[k])), lab:inLab,
      headPoints:headPx * toPoints, eyePoints:headPx * toPoints * 0.14};
  })};
});

// Vector characters: world positions of the painted joints (hands, feet, head) for contact and continuity checks
window.characterJoints = frames => frames.map(frame => {
  const s = draw(frame);
  return {frame, characters:s.characters.map(c => {
    const entry = characters.get(c.id);
    if (!entry.figure?.joints || !entry.rig.world) return {id:c.id};
    const joints = Object.fromEntries(Object.entries(entry.figure.joints).map(([k, [x, y]]) => [k, entry.rig.world(x, y).toArray()]));
    // On screen, the painted palm should cover the point on the prop it was solved for
    const px = p => { const v = new THREE.Vector3(...p).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
    const contactPx = c.contact ? Math.hypot(...px(joints[`hand${c.contact.hand ?? 'F'}`]).map((v, i) => v - px(c.contact.point)[i])) * 1080 / W : null;
    const screen = Object.fromEntries(Object.entries(joints).map(([k, p]) => [k, px(p)]));
    return {id:c.id, contact:c.contact, joints, screen, contactPx};
  })};
});

window.ready = true;
