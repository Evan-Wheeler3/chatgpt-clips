import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FACES } from '../storyboard/character.mjs';

/*
 * Hybrid character: simple 3D body forms driven by the existing 2D rig (same bones, same pose data),
 * with sparse 2D facial marks placed on a 3D head. Compared with layered cutout cards this gives:
 *  - one continuous silhouette outline (screen-constant inverted hull) instead of a contour on every card,
 *  - joints that stay closed at any angle (capsule ends are spheres centred on the pivots),
 *  - real form and real cast shadows, while colours stay flat (two-tone key shading) and readable.
 * Rig millimetres are kept: the body group is scaled by heightM / heightMm.
 */
const rad = THREE.MathUtils.degToRad;

function bodyMaterial(color, outline, panel = null) {
  // panel: a garment region painted onto this form's own surface (e.g. an apron bib on the torso), so it can
  // never float off the body; x is forward, y up, z lateral in the form's local millimetres
  return new THREE.ShaderMaterial({
    uniforms:{color:{value:new THREE.Color(color)}, tint:{value:new THREE.Color(1, 1, 1)}, keyDir:{value:new THREE.Vector3(0, -1, 0)}, shade:{value:outline.shade},
      panelColor:{value:new THREE.Color(panel?.color ?? color)}, panelInk:{value:new THREE.Color(outline.color)},
      panelBox:{value:new THREE.Vector4(panel?.minX ?? 1e9, panel?.top ?? 0, panel?.halfWidth ?? 0, panel?.edge ?? 0)}, ...THREE.UniformsLib.fog},
    vertexShader:`varying vec3 vN; varying vec3 vLocal;
#include <fog_pars_vertex>
void main() { vN = normalize(mat3(modelMatrix) * normal); vLocal = position; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    // Flat colour with one soft-edged form shade on the side away from the scene's key light
    fragmentShader:`uniform vec3 color; uniform vec3 tint; uniform vec3 keyDir; uniform float shade; uniform vec3 panelColor; uniform vec3 panelInk; uniform vec4 panelBox;
varying vec3 vN; varying vec3 vLocal;
#include <fog_pars_fragment>
void main() {
  float lit = smoothstep(-0.12, 0.12, dot(normalize(vN), -keyDir));
  vec3 base = color;
  if (vLocal.x > panelBox.x) {
    float top = panelBox.y - 0.0004 * vLocal.z * vLocal.z; // gently curved bib top
    float inside = min(top - vLocal.y, panelBox.z - abs(vLocal.z));
    if (inside > 0.0) base = inside < panelBox.w ? panelInk : panelColor;
  }
  gl_FragColor = vec4(base * tint * mix(shade, 1.0, lit), 1.0);
#include <colorspace_fragment>
#include <fog_fragment>
}`,
    fog:true, toneMapped:false
  });
}

// Screen-constant inverted hull: back faces pushed outward in clip space by a fixed number of pixels
function hullMaterial(color, px, width, height) {
  return new THREE.ShaderMaterial({
    uniforms:{color:{value:new THREE.Color(color)}, px:{value:px * height / 1920}, resolution:{value:new THREE.Vector2(width, height)}, ...THREE.UniformsLib.fog},
    vertexShader:`uniform float px; uniform vec2 resolution;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * mvPosition;
  vec3 n = normalize(normalMatrix * normal);
  vec2 dir = normalize((projectionMatrix * vec4(n, 0.0)).xy + 1e-6);
  clip.xy += dir * px * 2.0 / resolution * clip.w;
  gl_Position = clip;
#include <fog_vertex>
}`,
    fragmentShader:`uniform vec3 color;
#include <fog_pars_fragment>
void main() { gl_FragColor = vec4(color, 1.0);
#include <colorspace_fragment>
#include <fog_fragment>
}`,
    side:THREE.BackSide, fog:true, toneMapped:false
  });
}

// Capsule hanging down from its pivot, with a sphere cap centred on the pivot and on the far joint
function limb(length, r0, r1 = r0) {
  const g = new THREE.CapsuleGeometry((r0 + r1) / 2, length, 6, 16);
  g.translate(0, -length / 2, 0);
  if (r0 !== r1) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = THREE.MathUtils.clamp(-p.getY(i) / length, 0, 1); const k = THREE.MathUtils.lerp(r0, r1, t) / ((r0 + r1) / 2); p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k); }
    g.computeVertexNormals();
  }
  return g;
}

// Flat 2D facial mark drawn once to a canvas (dark ink on transparent), applied to a small quad on the head surface
function markTexture(draw, size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.translate(size / 2, size / 2); g.scale(size / 100, size / 100);
  draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildHybridCharacter(def, {quality, outputWidth = 1080, outputHeight = 1920}) {
  const F = def.forms, P = def.palette, R = def.rig;
  const units = def.heightM / R.heightMm;
  const outline = {color:def.render.outlineColor ?? P.line, px:def.render.outlinePx ?? 3, shade:def.render.shade ?? 0.82};
  const materials = [], hulls = [];
  const mat = (key, panel) => { const m = bodyMaterial(P[key], outline, panel); materials.push(m); return m; };
  const hullMat = hullMaterial(outline.color, outline.px, outputWidth, outputHeight);
  hulls.push(hullMat);

  const root = new THREE.Group(), yaw = new THREE.Group(), body = new THREE.Group();
  root.add(yaw); yaw.add(body); body.scale.setScalar(units);
  const bone = (name, parent) => { const g = new THREE.Group(); g.name = name; (parent ?? body).add(g); return g; };
  const add = (parent, geometry, key, {outline:withHull = true, cast = true, panel = null} = {}) => {
    const mesh = new THREE.Mesh(geometry, mat(key, panel));
    mesh.castShadow = cast; mesh.receiveShadow = false;
    parent.add(mesh);
    if (withHull) { const hull = new THREE.Mesh(geometry, hullMat); hull.castShadow = false; mesh.add(hull); }
    return mesh;
  };

  const hip = bone('hip'), torso = bone('torso', hip), head = bone('head', torso);
  // Torso: one rounded block, tapered toward the waist; the apron is a thin plate on its front
  const t = F.torso;
  const torsoGeo = new RoundedBoxGeometry(t.depth, R.neckHeight + 30, t.width, 4, t.radius);
  torsoGeo.translate(0, (R.neckHeight + 30) / 2 - 20, 0);
  { const p = torsoGeo.attributes.position; for (let i = 0; i < p.count; i++) { const k = THREE.MathUtils.lerp(t.waist, 1, THREE.MathUtils.clamp(p.getY(i) / R.neckHeight, 0, 1)); p.setZ(i, p.getZ(i) * k); } torsoGeo.computeVertexNormals(); }
  const a = F.apron;
  // Leather apron: the bib is painted onto the torso's front surface; the skirt is a curved panel wrapping the hips
  add(torso, torsoGeo, 'shirt', {panel:a && {color:P.apron, minX:t.depth * 0.08, top:a.top, halfWidth:a.width / 2, edge:a.edge ?? 5}});
  if (a) {
    const arc = Math.PI * 0.95, r = t.depth / 2 + 8;
    const skirt = new THREE.CylinderGeometry(r, r * a.flare, a.top0 - a.bottom, 28, 1, true, Math.PI / 2 - arc / 2, arc);
    skirt.scale(1, 1, (t.width * t.waist / 2 + 10) / r);
    skirt.translate(0, (a.top0 + a.bottom) / 2, 0);
    const mesh = add(torso, skirt, 'apron');
    mesh.material.side = THREE.DoubleSide;
  }
  add(torso, new THREE.CylinderGeometry(F.neck.radius, F.neck.radius * 1.05, F.neck.length, 16).translate(0, R.neckHeight + F.neck.length / 2 - 30, 0), 'skin', {outline:false});

  // Head: a slightly egg-shaped ovoid; turns partly toward camera so the face stays readable (see apply)
  const h = F.head;
  const headPivot = new THREE.Group(); head.add(headPivot);
  const headGeo = new THREE.SphereGeometry(1, 40, 28);
  { const p = headGeo.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); const jaw = y < 0 ? 1 - h.jawTaper * (-y) : 1; p.setXYZ(i, p.getX(i) * h.depth / 2 * jaw, y * h.height / 2, p.getZ(i) * h.width / 2 * jaw); } headGeo.computeVertexNormals(); }
  const headMesh = add(headPivot, headGeo, 'skin');
  headMesh.position.y = R.headCenter;
  // Flat cap: a squashed crown and a short brim, sitting on the head (not floating)
  if (F.cap) {
    const c = F.cap;
    const crown = new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.55);
    crown.scale(h.depth / 2 * c.scale, h.height * c.height, h.width / 2 * c.scale);
    const crownMesh = add(headPivot, crown, 'cap'); crownMesh.position.y = R.headCenter + h.height * c.seat; crownMesh.rotation.z = rad(-c.tilt);
    const brim = new RoundedBoxGeometry(c.brimLength, c.brimThickness, h.width * 0.78, 3, c.brimThickness * 0.45);
    const brimMesh = add(headPivot, brim, 'cap'); brimMesh.position.set(h.depth / 2 * 0.86, R.headCenter + h.height * c.seat + c.brimThickness * 0.2, 0); brimMesh.rotation.z = rad(-c.tilt - 8);
  }
  // Facial marks: positioned on the ovoid surface by azimuth/elevation around the facing direction (+x)
  const surface = (az, el, lift = 1.5) => {
    const d = new THREE.Vector3(Math.cos(rad(el)) * Math.cos(rad(az)), Math.sin(rad(el)), Math.cos(rad(el)) * Math.sin(rad(az)));
    const ry = d.y < 0 ? 1 - h.jawTaper * -d.y : 1;
    const point = new THREE.Vector3(d.x * h.depth / 2 * ry, d.y * h.height / 2, d.z * h.width / 2 * ry);
    const normal = new THREE.Vector3(point.x / (h.depth / 2) ** 2, point.y / (h.height / 2) ** 2, point.z / (h.width / 2) ** 2).normalize();
    return {position:point.addScaledVector(normal, lift).add(new THREE.Vector3(0, R.headCenter, 0)), normal};
  };
  const ink = P.ink ?? P.line;
  const mark = (texture, w, ht, at) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, ht), new THREE.MeshBasicMaterial({map:texture, transparent:true, depthWrite:false, toneMapped:false, fog:true}));
    // Upright basis: the mark faces out along the surface normal with its x axis horizontal, so features never roll
    const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), at.normal).normalize();
    const yAxis = new THREE.Vector3().crossVectors(at.normal, xAxis);
    m.position.copy(at.position); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, at.normal));
    m.renderOrder = 3;
    headPivot.add(m);
    return m;
  };
  const fc = F.face;
  const eyeTex = markTexture(g => { g.fillStyle = ink; g.beginPath(); g.ellipse(0, 0, 32, 46, 0, 0, Math.PI * 2); g.fill(); });
  const eyes = fc.eyes.azimuths.map(az => mark(eyeTex, fc.eyes.width, fc.eyes.height, surface(az, fc.eyes.elevation)));
  const browTex = markTexture(g => { g.fillStyle = ink; g.beginPath(); g.roundRect(-46, -11, 92, 22, 11); g.fill(); });
  const brows = fc.eyes.azimuths.map(az => { const m = mark(browTex, fc.brows.width, fc.brows.width, surface(az, fc.brows.elevation)); return {mesh:m, base:m.position.clone(), baseQ:m.quaternion.clone(), az}; });
  // Nose: a small form on the head (shaded like skin), not an outlined mark
  // Nose: one quiet mark in a darker skin tone, not an outlined bump that competes with the mouth
  const noseTex = markTexture(g => { g.strokeStyle = P.skinShade ?? '#c9b79e'; g.lineWidth = 9; g.lineCap = 'round'; g.beginPath(); g.moveTo(-6, -26); g.quadraticCurveTo(12, 10, -8, 22); g.stroke(); });
  mark(noseTex, fc.nose.size * 2, fc.nose.size * 2, surface(fc.nose.azimuth ?? 4, fc.nose.elevation));
  // Mouths: a few restrained shapes; expressions mostly live in the brows
  const mouthShapes = {
    flat:g => { g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(-30, 0); g.lineTo(30, 0); g.stroke(); },
    soft:g => { g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(-30, -3); g.quadraticCurveTo(0, 10, 30, -3); g.stroke(); },
    concerned:g => { g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(-28, 6); g.quadraticCurveTo(0, -6, 28, 4); g.stroke(); },
    o:g => { g.fillStyle = ink; g.beginPath(); g.ellipse(0, 4, 15, 20, 0, 0, Math.PI * 2); g.fill(); },
    tight:g => { g.strokeStyle = ink; g.lineWidth = 7; g.lineCap = 'round'; g.beginPath(); g.moveTo(-32, 2); g.lineTo(-10, -2); g.lineTo(10, 2); g.lineTo(32, -2); g.stroke(); }
  };
  const mouthAt = surface(0, fc.mouth.elevation);
  const mouths = Object.fromEntries(Object.entries(mouthShapes).map(([k, draw]) => [k, mark(markTexture(draw), fc.mouth.width, fc.mouth.width, mouthAt)]));
  const MOUTH_FOR = def.render.mouths ?? {neutral:'flat', smile:'soft', grin:'soft', oh:'o', grit:'tight', hmm:'concerned'};

  // Arms and legs: capsules; the far side sits behind the body in 3D, so no shading tricks are needed for depth
  const limbs = {};
  for (const side of ['F', 'B']) {
    const lateral = side === 'F' ? 1 : -1;
    const shoulder = bone(`upperArm${side}`, torso); shoulder.position.set(0, R.shoulderHeight, lateral * F.shoulderSpan / 2);
    add(shoulder, limb(R.upperArm, F.arm.upper, F.arm.upper * 0.92), 'shirt');
    const elbow = bone(`forearm${side}`, shoulder); elbow.position.y = -R.upperArm;
    add(elbow, limb(R.forearm, F.arm.fore, F.arm.fore * 0.85), F.arm.rolled ? 'skin' : 'shirt');
    const wrist = bone(`hand${side}`, elbow); wrist.position.y = -R.forearm;
    add(wrist, new THREE.SphereGeometry(F.arm.hand, 16, 12).scale(0.9, 1.25, 0.75).translate(0, -F.arm.hand * 0.9, 0), 'skin');
    const hipJoint = bone(`thigh${side}`, hip); hipJoint.position.set(0, 0, lateral * F.hipSpan / 2);
    add(hipJoint, limb(R.thigh, F.leg.thigh, F.leg.thigh * 0.9), 'trousers');
    const knee = bone(`shin${side}`, hipJoint); knee.position.y = -R.thigh;
    add(knee, limb(R.shin, F.leg.shin, F.leg.shin * 0.9), 'trousers');
    const ankle = bone(`boot${side}`, knee); ankle.position.y = -R.shin;
    const bootGeo = new RoundedBoxGeometry(F.boot.length, F.boot.height, F.boot.width, 3, F.boot.height * 0.4);
    bootGeo.translate(F.boot.length * 0.28, -F.boot.height / 2 - 4, 0);
    add(ankle, bootGeo, 'boots');
    limbs[side] = {shoulder, elbow, hipJoint, knee, ankle};
  }

  // Contact shadows are handled by the page; cast shadows come from the body itself
  const tmp = new THREE.Vector3();
  return {
    group:root, shadowGroup:new THREE.Group(),
    apply(state, cameraPosition, lightDirection, tint) {
      const p = state.pose;
      root.position.set(...state.position);
      // Real 3D facing: the body turns to face where the character is acting, never mirrored
      yaw.rotation.y = Math.atan2(-state.facing[2], state.facing[0]);
      body.scale.set(units / Math.sqrt(p.squash), units * p.squash, units / Math.sqrt(p.squash));
      hip.position.y = R.hipY - p.hipDrop;
      torso.rotation.z = -rad(p.torso);
      head.position.y = R.neckHeight; head.rotation.z = -rad(p.head); // Head pivots at the neck
      // Head turns part-way toward the camera (clamped) so the face reads without a billboard
      tmp.copy(cameraPosition).sub(root.position).setY(0).normalize();
      const toCamera = Math.atan2(-tmp.z, tmp.x) - yaw.rotation.y;
      const wrapped = Math.atan2(Math.sin(toCamera), Math.cos(toCamera));
      headPivot.rotation.y = THREE.MathUtils.clamp(wrapped * (def.render.headTowardCamera ?? 0.5), -rad(60), rad(60));
      for (const side of ['F', 'B']) {
        const [upper, elbow] = p[`arm${side}`], [thigh, knee] = p[`leg${side}`], L = limbs[side];
        L.shoulder.rotation.z = rad(upper); L.elbow.rotation.z = rad(elbow);
        L.hipJoint.rotation.z = rad(thigh); L.knee.rotation.z = -rad(knee); L.ankle.rotation.z = -rad(thigh - knee);
      }
      // Face: brows carry the expression; eyes blink; one restrained mouth per expression
      const face = FACES[state.face] ?? FACES.neutral, range = def.expressionScale ?? 0.8;
      for (const b of brows) {
        b.mesh.position.copy(b.base).add(new THREE.Vector3(0, face.brow * range * 0.9, 0));
        b.mesh.quaternion.copy(b.baseQ).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rad(face.browTilt * range * (b.az > 0 ? -1 : 1))));
      }
      for (const e of eyes) e.scale.set(1, Math.max(0.08, (1 - state.blink) * (state.face === 'surprised' ? 1.15 : 1)), 1);
      const mouth = MOUTH_FOR[face.mouth] ?? 'flat';
      for (const [k, m] of Object.entries(mouths)) m.visible = k === mouth;
      for (const m of materials) { m.uniforms.keyDir.value.copy(lightDirection); if (tint) m.uniforms.tint.value.copy(tint); }
    },
    dispose() {}
  };
}
