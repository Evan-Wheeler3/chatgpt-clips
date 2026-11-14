import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { samplePlan } from '../storyboard/sample.mjs';
import { propWorldPoints } from '../storyboard/actions.mjs';
import { QUALITY } from './quality.mjs';
import { stylizeObject } from './stylize.mjs';
import { createPost } from './post.mjs';
import { buildEnvironment } from './environment.mjs';
import { buildCharacter } from './character-rig.mjs';

let plan, quality, renderer, scene, camera, out, ctx, post, env = null, W, H, issues = [], keyLight;
const groups = new Map(), shadows = new Map(), characters = new Map();
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
  renderer = new THREE.WebGLRenderer({antialias:quality.post === 'none', preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = quality.stylize ? style?.grade?.exposure ?? 1 : plan.stage?.light?.exposure ?? 1;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false; // Count every pass of a frame, not just the last full-screen quad
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
    if (prop.base.grounded !== false) shadows.set(prop.id, [contactLayer(0.35), contactLayer(0.7)]);
  }
  for (const member of plan.cast ?? []) {
    const rig = buildCharacter(member.definition, {style, quality, maxAnisotropy:renderer.capabilities.getMaxAnisotropy()});
    scene.add(rig.group, rig.shadowGroup);
    characters.set(member.id, {rig, shadow:contactLayer(style?.character?.contactShadow ?? 0.6)});
  }
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

function draw(frame) {
  const s = samplePlan(plan, frame);
  for (const p of s.props) {
    const group = groups.get(p.id);
    if (!group) continue;
    group.position.copy(p.position);
    group.quaternion.copy(p.quaternion).multiply(p.wobble);
    group.scale.setScalar(p.scale);
    group.visible = p.visible;
  }
  placeContactShadows(frame);
  const lightDir = keyLight ? keyLight.target.position.clone().sub(keyLight.position).normalize() : new THREE.Vector3(0, -1, 0);
  for (const c of s.characters) {
    const {rig, shadow} = characters.get(c.id);
    rig.apply(c, s.camera.position, lightDir);
    // Feet contact shadow follows the character and tightens when crouching
    shadow.position.set(c.position[0], 0.008, c.position[2]);
    shadow.scale.set(0.55 * c.heightM, 0.32 * c.heightM, 1);
  }
  env?.update(frame, plan.fps);
  camera.fov = s.camera.fov; camera.updateProjectionMatrix();
  camera.position.copy(s.camera.position); camera.lookAt(s.camera.target);
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
  const words = plan.words, current = s.word;
  if (current) {
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
  return s;
}

window.renderFrames = (frames, format = 'image/jpeg') => frames.map(frame => { compose(frame); return out.toDataURL(format, 0.9); });

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

window.ready = true;
