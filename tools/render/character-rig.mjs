import * as THREE from 'three';
import { FACES } from '../storyboard/character.mjs';

/*
 * Layered-cutout character inside the 3D scene. Parts are drawn once from the definition's SVG paths
 * (ink outline baked in), mapped onto alpha-tested quads (so depth testing handles occlusion by 3D props),
 * and arranged in a bone hierarchy in rig millimetres. The whole rig yaws to face the camera and mirrors
 * to face left or right on screen; a second, invisible copy facing the key light casts the shadow.
 */
const UNITS_PX = 1;
const BONE_PARENT = {
  hip:null, torso:'hip', head:'torso', cap:'head', eyes:'head', pupils:'head', brows:'head', mouth:'head',
  upperArmF:'torso', forearmF:'upperArmF', hand:'forearmF', upperArmB:'torso', forearmB:'upperArmB', handB:'forearmB',
  thighF:'hip', shinF:'thighF', bootF:'shinF', thighB:'hip', shinB:'thighB', bootB:'shinB'
};

function shapeBounds(shape) {
  if (shape.ellipse) { const [cx, cy, rx, ry] = shape.ellipse; return [cx - rx, cy - ry, cx + rx, cy + ry]; }
  const numbers = shape.path.match(/-?\d+(\.\d+)?/g).map(Number);
  const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

const FACE_PARTS = /^(head|eyes|pupils|brows|mouth:)/;

function drawPart(part, def, outlineColor, pxPerMm) {
  // Flat-tinted designs get their outer contour from the shader, so leave room for it around every part
  const pad = def.render?.mode === 'flat-tinted' ? 34 : def.outlineMm + 4;
  const b = part.shapes.length
    ? part.shapes.map(shapeBounds).reduce((a, s) => [Math.min(a[0], s[0]), Math.min(a[1], s[1]), Math.max(a[2], s[2]), Math.max(a[3], s[3])], [Infinity, Infinity, -Infinity, -Infinity])
    : [0, 0, 1, 1]; // An empty part (e.g. legs under a long skirt) is a transparent stub
  const bounds = [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad];
  const w = bounds[2] - bounds[0], h = bounds[3] - bounds[1];
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(4, Math.ceil(w * pxPerMm)); canvas.height = Math.max(4, Math.ceil(h * pxPerMm));
  const g = canvas.getContext('2d');
  g.scale(canvas.width / w, canvas.height / h);
  g.translate(-bounds[0], -bounds[1]);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const colorOf = name => name === 'outline' || name === 'line' ? outlineColor : def.palette[name] ?? name;
  let base = null;
  for (const shape of part.shapes) {
    const path = new Path2D();
    if (shape.ellipse) { const [cx, cy, rx, ry] = shape.ellipse; path.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); }
    else path.addPath(new Path2D(shape.path));
    // clip: true confines cel shading to the last full shape, so shadows never spill past the silhouette
    g.save();
    if (shape.clip && base) g.clip(base);
    else if (shape.fill && !shape.clip) base = path;
    g.globalAlpha = shape.alpha ?? 1;
    if (shape.fill) {
      g.fillStyle = colorOf(shape.fill); g.fill(path);
      if (shape.line !== false && def.outlineMm > 0) { g.globalAlpha = 1; g.strokeStyle = outlineColor; g.lineWidth = def.outlineMm * (shape.lineScale ?? 1); g.stroke(path); }
    }
    if (shape.stroke) {
      g.globalAlpha = 1;
      if (shape.stroke !== 'outline' && shape.stroke !== 'line' && def.outlineMm > 0) { g.strokeStyle = outlineColor; g.lineWidth = shape.width + def.outlineMm * 0.9; g.stroke(path); }
      g.strokeStyle = colorOf(shape.stroke); g.lineWidth = shape.width; g.stroke(path);
    }
    g.restore();
  }
  return {canvas, bounds};
}

// Flat-tinted cutout shading: authored colours × a gentle environment tint, plus a constant-pixel outer contour
// found by probing the part's alpha around each transparent texel (so line weight holds at any camera distance)
function flatMaterial(texture, {outlineColor, outlinePx}) {
  return new THREE.ShaderMaterial({
    uniforms:{map:{value:texture}, tint:{value:new THREE.Color(1, 1, 1)}, outlineColor:{value:new THREE.Color(outlineColor)}, outlinePx:{value:outlinePx},
      ...THREE.UniformsLib.fog},
    vertexShader:`varying vec2 vUv;
#include <fog_pars_vertex>
void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader:`uniform sampler2D map; uniform vec3 tint; uniform vec3 outlineColor; uniform float outlinePx; varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) {
    if (outlinePx <= 0.0) discard;
    vec2 px = fwidth(vUv) * outlinePx;
    float a = 0.0;
    for (int i = 0; i < 12; i++) { float t = float(i) * 0.5235988; a = max(a, texture2D(map, vUv + vec2(cos(t), sin(t)) * px).a); }
    if (a < 0.5) discard;
    gl_FragColor = vec4(outlineColor, 1.0);
  } else gl_FragColor = vec4(c.rgb * tint, 1.0);
#include <colorspace_fragment>
#include <fog_fragment>
}`,
    side:THREE.DoubleSide, fog:true, toneMapped:false
  });
}

export function buildCharacter(def, {style, quality, maxAnisotropy = 4, outputHeight = 1920}) {
  const flat = def.render?.mode === 'flat-tinted';
  const outline = flat ? def.render.outlineColor ?? def.palette.line : style.palette.outline ?? '#1f140d';
  const units = def.heightM / def.rig.heightMm;
  const textures = {};
  const parts = {};
  for (const [name, part] of Object.entries(def.parts)) {
    // Face parts get extra texture density so features stay crisp at phone size
    const density = quality.pxPerMm * UNITS_PX * (flat && FACE_PARTS.test(name) ? 1.6 : 1);
    const {canvas, bounds} = drawPart(part, def, outline, density);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = maxAnisotropy;
    textures[name] = texture;
    parts[name] = {part, bounds};
  }

  function makeRig(shadowOnly) {
    const root = new THREE.Group(), yaw = new THREE.Group(), mirror = new THREE.Group(), body = new THREE.Group();
    root.add(yaw); yaw.add(mirror); mirror.add(body);
    body.scale.setScalar(units);
    const bones = {};
    for (const bone of Object.keys(BONE_PARENT)) { bones[bone] = new THREE.Group(); bones[bone].name = bone; }
    for (const [bone, parent] of Object.entries(BONE_PARENT)) (parent ? bones[parent] : body).add(bones[bone]);
    const meshes = {};
    for (const [name, {part, bounds}] of Object.entries(parts)) {
      const [x0, y0, x1, y1] = bounds;
      const geometry = new THREE.PlaneGeometry(x1 - x0, y1 - y0);
      // Parts are authored y-down around their pivot; place the quad so the pivot sits at the bone origin
      geometry.translate((x0 + x1) / 2, -(y0 + y1) / 2, part.z * 0.6);
      let material;
      if (shadowOnly) {
        material = new THREE.MeshBasicMaterial({colorWrite:false, depthWrite:false, side:THREE.DoubleSide});
      } else if (flat) {
        material = flatMaterial(textures[name], {outlineColor:outline, outlinePx:Math.max(1, def.render.outlinePx * outputHeight / 1920)});
        material.polygonOffset = true; material.polygonOffsetFactor = -part.z * 0.02;
      } else {
        material = new THREE.MeshStandardMaterial({map:textures[name], alphaTest:0.5, side:THREE.DoubleSide, roughness:1, metalness:0,
          emissive:new THREE.Color('#ffffff'), emissiveMap:textures[name], emissiveIntensity:style.character.selfLight});
        material.polygonOffset = true; material.polygonOffsetFactor = -part.z * 0.02;
      }
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.castShadow = shadowOnly; mesh.receiveShadow = false;
      if (shadowOnly) mesh.customDepthMaterial = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking, map:textures[name], alphaTest:0.5, side:THREE.DoubleSide});
      bones[part.bone].add(mesh);
      meshes[name] = mesh;
    }
    return {root, yaw, mirror, body, bones, meshes};
  }

  const visible = makeRig(false), shadow = makeRig(true);
  const R = def.rig, A = def.anchors;
  const rad = THREE.MathUtils.degToRad;

  function pose(rig, state) {
    const p = state.pose, b = rig.bones;
    rig.body.scale.set(units / Math.sqrt(p.squash), units * p.squash, units);
    b.hip.position.set(0, R.hipY - p.hipDrop, 0);
    b.torso.rotation.z = -rad(p.torso);
    b.head.position.set(A.head[0], R.neckHeight, 0); b.head.rotation.z = -rad(p.head);
    b.cap.rotation.z = -rad(p.cap ?? 0);
    b.eyes.position.set(A.eyes[0], -A.eyes[1], 0);
    b.eyes.scale.set(1, Math.max(0.08, 1 - state.blink), 1);
    b.pupils.position.set(A.pupils[0] + state.look[0] * 11, -A.pupils[1] + state.look[1] * 9, 0);
    b.pupils.scale.set(1, Math.max(0.08, 1 - state.blink), 1);
    const face = FACES[state.face] ?? FACES.neutral;
    const range = def.expressionScale ?? 1; // Restrained families move brows less
    b.brows.position.set(A.brows[0], -A.brows[1] + face.brow * range, 0); b.brows.rotation.z = rad(face.browTilt * range);
    b.mouth.position.set(A.mouth[0], -A.mouth[1], 0);
    for (const [name, mesh] of Object.entries(rig.meshes)) {
      if (name.startsWith('mouth:')) mesh.visible = name === `mouth:${face.mouth}`;
      if (name.startsWith('hand:')) mesh.visible = name === `hand:${p.handF}`;
      if (name.startsWith('handB:')) mesh.visible = name === `handB:${p.handB === 'fist' ? 'fist' : 'open'}`;
    }
    for (const side of ['F', 'B']) {
      const [upper, elbow] = p[`arm${side}`];
      b[`upperArm${side}`].position.set(R[`shoulder${side}`][0], R.shoulderHeight, side === 'F' ? 0 : 0);
      b[`upperArm${side}`].rotation.z = rad(upper);
      b[`forearm${side}`].position.set(0, -R.upperArm, 0); b[`forearm${side}`].rotation.z = rad(elbow);
      b[side === 'F' ? 'hand' : 'handB'].position.set(0, -R.forearm, 0);
      const [thigh, knee] = p[`leg${side}`];
      b[`thigh${side}`].position.set(R[`hip${side}`][0], 0, 0); b[`thigh${side}`].rotation.z = rad(thigh);
      b[`shin${side}`].position.set(0, -R.thigh, 0); b[`shin${side}`].rotation.z = -rad(knee);
      b[`boot${side}`].position.set(0, -R.shin, 0); b[`boot${side}`].rotation.z = -rad(thigh - knee);
    }
  }

  return {
    group:visible.root, shadowGroup:shadow.root,
    apply(state, cameraPosition, lightDirection, tint) {
      if (flat && tint) for (const mesh of Object.values(visible.meshes)) mesh.material.uniforms.tint.value.copy(tint);
      for (const [rig, facing] of [[visible, cameraPosition.clone().sub(new THREE.Vector3(...state.position))], [shadow, lightDirection.clone().negate()]]) {
        rig.root.position.set(...state.position);
        rig.yaw.rotation.y = Math.atan2(facing.x, facing.z);
        rig.mirror.scale.set(state.mirror * state.turnScale, 1, 1);
        pose(rig, state);
      }
    },
    dispose() { for (const t of Object.values(textures)) t.dispose(); }
  };
}

