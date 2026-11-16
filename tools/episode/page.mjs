import * as THREE from 'three';
import { createPost } from '/tools/render/post.mjs';
import { stylizeObject, stylizeMaterial, addOutline } from '/tools/render/stylize.mjs';
import { drawCaptions } from '/tools/render/captions.mjs';
import { buildFigure, paintFigure } from '/tools/characters/figure.mjs';
import { compensatePalette } from '/tools/characters/display.mjs';

/*
 * Browser side of the episode renderer: sets up the Hold Up renderer (tone mapping, shadows, post grade), offers the
 * scene module the shared helpers (style roles, outlines, the vector character on a card), then composes each frame:
 * scene -> post -> 2D canvas -> burned-in captions.
 */
let plan, quality, renderer, scene, camera, post, out, ctx, episode, W, H;

// The approved vector character painted on a flat card in the scene (unlit: the 2D look against the 3D set).
// The card lies in an XY plane; rig +x (the direction he faces) maps to world +X, or -X with mirror: -1.
export function makeFigureCard(source, {display, canvasPx = 2048, edit = null} = {}) {
  const def = {...source, palette:compensatePalette(source.palette, display)};
  const units = def.heightM / def.rig.heightMm;
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = canvasPx;
  const g = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const material = new THREE.ShaderMaterial({
    uniforms:{map:{value:texture}, tint:{value:new THREE.Color(1, 1, 1)}},
    vertexShader:'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:`uniform sampler2D map; uniform vec3 tint; varying vec2 vUv;
void main() { vec4 c = texture2D(map, vUv); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb * tint, 1.0);
#include <colorspace_fragment>
}`, side:THREE.DoubleSide, toneMapped:false});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  const group = new THREE.Group(); group.add(mesh);
  let last = null;
  return {
    group, def, units, material,
    // state: the shared pose state; origin: world position of the rig's hip joint; outlineMm: ink weight
    set(state, {hip = [0, 0, 0], mirror = 1, outlineMm = 9, tint = null} = {}) {
      let figure = buildFigure(def, state);
      if (edit) figure = edit(figure, def, state) ?? figure;
      const pad = outlineMm + 6, [bx0, by0, bx1, by1] = figure.bounds, b = [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad];
      const density = Math.min(canvasPx / (b[2] - b[0]), canvasPx / (b[3] - b[1]));
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvasPx, canvasPx);
      g.setTransform(density, 0, 0, -density, -b[0] * density, b[3] * density);
      paintFigure(g, figure, outlineMm, def.palette.line);
      const u = (b[2] - b[0]) * density / canvasPx, v = (b[3] - b[1]) * density / canvasPx;
      mesh.geometry.attributes.uv.array.set([0, 1, u, 1, 0, 1 - v, u, 1 - v]); mesh.geometry.attributes.uv.needsUpdate = true;
      texture.needsUpdate = true;
      // Rig millimetres -> world: the hip joint lands on `hip`
      const [hx, hy] = figure.joints.hip;
      const toWorld = (x, y) => new THREE.Vector3(hip[0] + (x - hx) * units * mirror, hip[1] + (y - hy) * units, hip[2]);
      const c = toWorld((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
      mesh.position.copy(c); mesh.scale.set((b[2] - b[0]) * units * mirror, (b[3] - b[1]) * units, 1);
      if (tint) material.uniforms.tint.value.copy(tint);
      last = {figure, toWorld};
      return last;
    },
    joint(name) { const [x, y] = last.figure.joints[name]; return last.toWorld(x, y); }
  };
}

// Two-bone arm solve in the rig's convention (angles from straight down, positive toward the facing direction):
// returns the pose's [upper, bend] for a hand target given in rig millimetres
export function solveArm(def, pose, side, target) {
  const R = def.rig, rad = Math.PI / 180, t = -pose.torso * rad;
  const hip = [0, R.hipY - (pose.hipDrop ?? 0)], q = [R[`shoulder${side}`][0], R.shoulderHeight];
  const sh = [hip[0] + q[0] * Math.cos(t) - q[1] * Math.sin(t), hip[1] + q[0] * Math.sin(t) + q[1] * Math.cos(t)];
  const L1 = R.upperArm, L2 = R.forearm + R.hand * 0.6;
  const dx = target[0] - sh[0], dy = target[1] - sh[1], d = Math.min(L1 + L2 - 1, Math.max(Math.abs(L1 - L2) + 1, Math.hypot(dx, dy)));
  const phi = Math.atan2(dx, -dy), a = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)), b = Math.acos((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2));
  return [(phi - a) / rad + pose.torso, (Math.PI - b) / rad];
}

window.setup = async (p, size, q) => {
  plan = p; quality = q; W = size.width; H = size.height;
  const style = plan.style, f = plan.captions.style.font;
  for (const fam of f.family.split(',')) await document.fonts.load(`${f.weight} ${f.sizePx}px ${fam.trim()}`).catch(() => {});
  renderer = new THREE.WebGLRenderer({antialias:quality.msaa === 0, preserveDrawingBuffer:true});
  renderer.setPixelRatio(1); renderer.setSize(W, H);
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = style.grade.exposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;
  scene = new THREE.Scene(); camera = new THREE.PerspectiveCamera(35, W / H, 0.05, 400);
  const display = {grade:style.grade, shadowTint:style.palette.shadowTint, highlightTint:style.palette.highlightTint};
  const mod = await import(`/stories/${plan.slug}/scene.mjs`);
  const roles = style.materials, palette = style.palette;
  episode = await mod.build({THREE, scene, camera, renderer, plan, quality, style, display, W, H,
    makeFigureCard:(def, o = {}) => makeFigureCard(def, {display, ...o}), solveArm,
    stylize:(object, role = 'hero', o = {}) => stylizeObject(object, roles[role], palette, o), stylizeMaterial:(m, role = 'hero') => stylizeMaterial(m, roles[role], palette), addOutline});
  post = createPost(renderer, scene, camera, {quality, style, width:W, height:H});
  out = document.createElement('canvas'); out.width = W; out.height = H; ctx = out.getContext('2d');
  const gl = renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info');
  return {gpu:d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'};
};

function compose(frame) {
  const time = frame / plan.fps;
  let si = plan.shots.findIndex(s => frame >= s.startFrame && frame < s.endFrame); if (si < 0) si = plan.shots.length - 1;
  const shot = plan.shots[si];
  const fx = episode.update({frame, time, shot, shotIndex:si, t:time - shot.startSec, d:shot.endSec - shot.startSec}) ?? {};
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  post.setFrame(frame); post.render();
  // fx.filter: a canvas filter for the whole frame (e.g. a period look); fx.paint(ctx, W, H): 2D overlay drawn by the scene
  ctx.globalAlpha = 1; ctx.filter = fx.filter ?? 'none'; ctx.drawImage(renderer.domElement, 0, 0); ctx.filter = 'none';
  fx.paint?.(ctx, W, H);
  if (fx.fade > 0.003) { ctx.fillStyle = `rgba(${fx.fadeColor ?? '8,6,5'},${Math.min(1, fx.fade)})`; ctx.fillRect(0, 0, W, H); }
  if (plan.captions.enabled && quality.captions !== false) drawCaptions(ctx, plan.captions, time, {width:W, height:H});
}
window.renderFrames = frames => frames.map(frame => { compose(frame); return out.toDataURL('image/jpeg', 0.93); });
window.ready = true;
window.addEventListener('error', e => { window.failed = e.message; });
