import * as THREE from 'three';
import { socketFrame, holePlanes } from '../storyboard/sockets.mjs';
import { hosePoints } from '../storyboard/hose.mjs';

/*
 * Browser renderers for story effects (tools/storyboard/effects.mjs). Each effect is built once from its static params
 * in the local space of the prop (or named part) it is attached to, so it moves with it, and is updated every frame
 * from its sampled channels and the scene time. Everything is deterministic: seeded layouts, time-based motion.
 * Hold Up colour language: amber gasoline, pale-blue air, violet suction.
 */
export const COLORS = {fuel:'#F2A33A', air:'#BFE6FF', suction:'#8C7BFF', highlight:'#FFF4C2'};

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const v3 = a => new THREE.Vector3(...a);
const curveOf = points => new THREE.CatmullRomCurve3(points.map(v3), false, 'centripetal');
const fuelMaterial = (color = COLORS.fuel, opacity = 0.93) => new THREE.MeshStandardMaterial({color, roughness:0.12, metalness:0, emissive:new THREE.Color(color).multiplyScalar(0.18), transparent:opacity < 1, opacity});
const glowTexture = (() => { let t; return () => {
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.4, 'rgba(255,255,255,0.5)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return t = new THREE.CanvasTexture(c);
}; })();
const ringTexture = (() => { let t; return () => {
  if (t) return t;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  for (const [w, a] of [[14, 0.25], [7, 0.6], [3, 1]]) { g.strokeStyle = `rgba(255,255,255,${a})`; g.lineWidth = w; g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.stroke(); }
  return t = new THREE.CanvasTexture(c);
}; })();

// Liquid running out of an opening: a tube that grows along a path, then a spreading puddle with an irregular edge
function overflow(p) {
  const group = new THREE.Group(), material = fuelMaterial(p.color);
  const curve = curveOf(p.path), segments = 64, radial = 10;
  const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, p.width ?? 0.025, radial, false), material);
  // An organic edge: a few slow sine lobes, not per-vertex noise (which reads as a star)
  const rand = rng(p.seed ?? 7), lobes = [2, 3, 5].map(k => ({k, a:0.05 + rand() * 0.07, ph:rand() * Math.PI * 2}));
  const edge = Array.from({length:64}, (_, i) => 1 + lobes.reduce((sum, l) => sum + l.a * Math.sin(l.k * i / 64 * Math.PI * 2 + l.ph), 0));
  const shape = new THREE.Shape(edge.map((k, i) => new THREE.Vector2(Math.cos(i / 64 * Math.PI * 2) * k, Math.sin(i / 64 * Math.PI * 2) * k)));
  const puddleGeometry = new THREE.ShapeGeometry(shape, 1); puddleGeometry.rotateX(-Math.PI / 2);
  const puddle = new THREE.Mesh(puddleGeometry, material);
  if (p.puddle) puddle.position.copy(v3(p.puddle.center)).add(new THREE.Vector3(0, 0.003, 0));
  group.add(tube, puddle);
  return {group, update:({progress}) => {
    const s = Math.min(1, progress / 0.6), r = THREE.MathUtils.smoothstep(progress, 0.35, 1) * (p.puddle?.radius ?? 0);
    tube.visible = s > 0.001;
    tube.geometry.setDrawRange(0, Math.ceil(s * segments) * radial * 6);
    puddle.visible = !!p.puddle && r > 0.001;
    puddle.scale.set(r, 1, r);
  }};
}

// Particles travelling along a path: streaks (fuel) or arrowheads (air). A "narrow" stretch of the path moves faster.
function travellers(p, kind) {
  const curve = curveOf(p.path), count = p.count ?? (kind === 'air' ? 26 : 70), rand = rng(p.seed ?? (kind === 'air' ? 11 : 5));
  const color = p.color ?? (kind === 'air' ? COLORS.air : COLORS.fuel);
  const geometry = kind === 'air' ? new THREE.ConeGeometry(0.5, 1, 8).rotateX(Math.PI / 2) : new THREE.CapsuleGeometry(0.5, 1, 2, 6).rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.9, depthWrite:false, blending:kind === 'air' ? THREE.AdditiveBlending : THREE.NormalBlending});
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  const seeds = Array.from({length:count}, () => ({u:rand(), a:rand() * Math.PI * 2, r:Math.sqrt(rand()) * (p.radius ?? 0.006), k:0.85 + rand() * 0.3}));
  const length = curve.getLength(), narrow = p.narrow ?? null, size = p.size ?? (kind === 'air' ? 0.008 : 0.004);
  const speedAt = u => narrow && u >= narrow.from && u <= narrow.to ? narrow.factor : 1;
  // Time-to-arc-length warp so particles cross the narrow section faster (constant flow, higher speed)
  const table = [0]; for (let i = 1; i <= 200; i++) table.push(table[i - 1] + 1 / speedAt((i - 0.5) / 200));
  const total = table[200];
  const uAt = x => { const target = x * total; let i = 1; while (i < 200 && table[i] < target) i++; return (i - 1 + (target - table[i - 1]) / (table[i] - table[i - 1])) / 200; };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), z = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
  const pos = new THREE.Vector3(), tan = new THREE.Vector3(), side = new THREE.Vector3(), other = new THREE.Vector3(), scale = new THREE.Vector3();
  return {group:mesh, update:({amount, speed = 1}, time) => {
    mesh.visible = amount > 0.01;
    material.opacity = Math.min(1, amount) * (kind === 'air' ? 0.85 : 0.9);
    const travel = time * speed * (p.rate ?? 0.12) / length * 10;
    seeds.forEach((s, i) => {
      const u = uAt(((s.u + travel * s.k) % 1 + 1) % 1);
      curve.getPointAt(u, pos); curve.getTangentAt(u, tan);
      side.crossVectors(tan, Math.abs(tan.y) > 0.9 ? z : up).normalize(); other.crossVectors(tan, side);
      pos.addScaledVector(side, Math.cos(s.a) * s.r).addScaledVector(other, Math.sin(s.a) * s.r);
      q.setFromUnitVectors(z, tan);
      const stretch = kind === 'air' ? 1.6 : 4 * speedAt(u);
      m.compose(pos, q, scale.set(size, size, size * stretch));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }};
}

// A liquid surface rising inside a cylinder (bottom centre, radius, from/to heights in local units, optional rotation)
function level(p) {
  const group = new THREE.Group(), material = fuelMaterial(p.color, 0.88);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(p.radius, p.radius, 1, 40, 1, true), material);
  const top = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 40).rotateX(-Math.PI / 2), material);
  group.add(column, top);
  group.position.copy(v3(p.center));
  // An optional tilt (degrees XYZ) fills a slanted pipe along its axis, e.g. a filler neck seen in section
  if (p.rotation) group.rotation.set(...p.rotation.map(THREE.MathUtils.degToRad));
  return {group, update:({height}, time) => {
    const y = p.from + (p.to - p.from) * height, h = Math.max(1e-4, y - p.from);
    group.visible = height > 0.001 || p.from !== 0;
    column.scale.set(1, h, 1); column.position.y = p.from + h / 2;
    top.position.y = y + Math.sin(time * 7) * 0.0015; // A gentle surface wobble
  }};
}

// A soft pulsing ring that always faces the camera (highlights the sensing hole)
function ring(p) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:ringTexture(), color:p.color ?? COLORS.highlight, transparent:true, depthTest:false, depthWrite:false}));
  sprite.renderOrder = 10; sprite.position.copy(v3(p.position));
  return {group:sprite, update:({amount}, time) => {
    sprite.visible = amount > 0.01;
    const pulse = 1 + 0.18 * Math.sin(time * Math.PI * 2 * (p.hz ?? 1.4));
    sprite.scale.setScalar((p.radius ?? 0.02) * 2.6 * pulse);
    sprite.material.opacity = Math.min(1, amount) * (0.7 + 0.3 * Math.sin(time * Math.PI * 2 * (p.hz ?? 1.4) + 1));
  }};
}

// A translucent tinted volume (violet: suction / low pressure)
function tint(p) {
  const geometry = p.shape === 'box' ? new THREE.BoxGeometry(...p.size) : new THREE.CylinderGeometry(p.radius, p.radius, p.height, 32);
  if (p.rotation) geometry.rotateX(THREE.MathUtils.degToRad(p.rotation[0])).rotateY(THREE.MathUtils.degToRad(p.rotation[1])).rotateZ(THREE.MathUtils.degToRad(p.rotation[2]));
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({color:p.color ?? COLORS.suction, transparent:true, depthWrite:false, opacity:0}));
  mesh.renderOrder = 5; mesh.position.copy(v3(p.center));
  return {group:mesh, update:({amount}, time) => {
    mesh.visible = amount > 0.01;
    mesh.material.opacity = Math.min(1, amount) * 0.38 * (0.85 + 0.15 * Math.sin(time * Math.PI * 4));
  }};
}

// A specular glint sweeping along a path (progress 0..1), brightest mid-sweep
function glint(p) {
  const curve = curveOf(p.path);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture(), color:'#ffffff', transparent:true, blending:THREE.AdditiveBlending, depthWrite:false}));
  sprite.renderOrder = 11;
  return {group:sprite, update:({progress}) => {
    sprite.visible = progress > 0.001 && progress < 0.999;
    curve.getPointAt(Math.min(1, Math.max(0, progress)), sprite.position);
    sprite.scale.setScalar(p.size ?? 0.05);
    sprite.material.opacity = Math.sin(Math.PI * progress);
  }};
}

// A dark rubber fuel hose between two live socket frames, rebuilt only when an end moves
function hose(p, {frameOf}) {
  const material = new THREE.MeshStandardMaterial({color:p.color ?? '#1c1d20', roughness:0.55, metalness:0});
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  let key = '';
  return {group:mesh, update:({amount}) => {
    mesh.visible = amount > 0.01;
    const from = frameOf(p.from.prop, p.from.socket), to = frameOf(p.to.prop, p.to.socket);
    if (!from || !to) { mesh.visible = false; return; }
    const k = [...from.position, ...from.axis, ...to.position, ...to.axis].map(v => v.toFixed(4)).join();
    if (k === key) return;
    key = k;
    const curve = new THREE.CatmullRomCurve3(hosePoints(from, to, p).map(q => new THREE.Vector3(...q)));
    mesh.geometry.dispose();
    mesh.geometry = new THREE.TubeGeometry(curve, 96, p.radius ?? 0.011, 12, false);
  }};
}

const BUILDERS = {overflow, flow:p => travellers(p, 'flow'), air:p => travellers(p, 'air'), level, ring, tint, glint, hose};

// Builds every effect of the plan and parents it to its prop / part; returns update(sampleEffects, sceneTime)
export function buildEffects(plan, {scene, groups}) {
  const built = new Map(), propById = new Map(plan.props.map(p => [p.id, p]));
  // World frame of a prop socket from the prop's live group (hoses follow whatever the props do)
  const frameOf = (propId, socket) => { const g = groups.get(propId), prop = propById.get(propId); if (!g || !prop?.sockets?.[socket]) return null; g.updateMatrixWorld(true); return socketFrame(prop, socket, g.matrixWorld); };
  for (const effect of plan.effects ?? []) {
    const fx = BUILDERS[effect.type](effect.params, {frameOf});
    let parent = scene;
    if (effect.attach?.prop) {
      const group = groups.get(effect.attach.prop);
      if (!group) continue; // A missing prop is flagged by the plan; its effects cannot be placed
      parent = effect.attach.part ? partNamed(group, effect.attach.part) ?? group : group;
    }
    parent.add(fx.group);
    built.set(effect.id, fx);
  }
  return (states, time) => { for (const s of states) built.get(s.id)?.update(s, time); };
}

// --- Named parts and material states for props ---------------------------------------------------------------
// GLTFLoader strips "/" (and . : [ ]) from node names; the original glTF name, which stories use ("nozzle/lever"), is kept in userData
export const partName = o => o.userData?.name ?? o.name;
export function partNamed(root, name) { let found; root.traverse(o => { if (!found && partName(o) === name) found = o; }); return found; }

// Rest transforms of every named node, so part offsets are applied relative to rest each frame
export function partRig(model) {
  const rest = new Map();
  model.traverse(o => { const name = partName(o); if (name && !rest.has(name)) rest.set(name, {object:o, position:o.position.clone(), quaternion:o.quaternion.clone(), scale:o.scale.clone()}); });
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  return parts => {
    for (const [name, r] of rest) {
      const p = parts[name];
      r.object.position.copy(r.position); r.object.quaternion.copy(r.quaternion); r.object.scale.copy(r.scale);
      if (!p) continue;
      r.object.position.add(v3(p.position));
      r.object.quaternion.multiply(q.setFromEuler(e.set(...p.rotation.map(THREE.MathUtils.degToRad), 'XYZ')));
      r.object.scale.multiplyScalar(p.scale);
      for (const [key, w] of Object.entries(p.morph ?? {})) r.object.traverse(o => {
        const k = o.morphTargetDictionary?.[key];
        if (k !== undefined) o.morphTargetInfluences[k] = w;
      });
    }
  };
}

const GHOST_VERTEX = `#include <clipping_planes_pars_vertex>
varying vec3 vN; varying vec3 vV;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal); vV = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <clipping_planes_vertex>
}`;
const GHOST_FRAGMENT = `#include <clipping_planes_pars_fragment>
uniform vec3 color; uniform float opacity;
varying vec3 vN; varying vec3 vV;
void main() {
  #include <clipping_planes_fragment>
  float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
  gl_FragColor = vec4(color, opacity * (0.18 + 0.82 * rim));
}`;
const DEFAULT_GHOST = {color:'#A8E6F0', opacity:0.55, cap:'#5b6670'};

// X-ray ghost (pale cyan fresnel shell, no depth write) and section cut (clipping plane in the prop's local space,
// cut faces capped by a back-face pass in a flat colour). Parts listed in `keep` stay solid and uncut.
export function materialRig(model, group, {prop = null} = {}) {
  const meshes = [];
  model.traverse(o => {
    if (!o.isMesh || o.userData.outlineOf !== undefined) return;
    if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); // The ghost's fresnel rim needs normals
    meshes.push({mesh:o, base:o.material, outlines:o.children.filter(c => c.userData.outlineOf !== undefined)});
  });
  const plane = new THREE.Plane(), local = new THREE.Plane();
  const ghost = new THREE.ShaderMaterial({uniforms:{color:{value:new THREE.Color(DEFAULT_GHOST.color)}, opacity:{value:0}}, vertexShader:GHOST_VERTEX, fragmentShader:GHOST_FRAGMENT,
    transparent:true, depthWrite:false, side:THREE.DoubleSide, clipping:true});
  const capMaterial = new THREE.MeshBasicMaterial({color:DEFAULT_GHOST.cap, side:THREE.BackSide, clippingPlanes:[plane]});
  const kept = (o, keep) => { for (let x = o; x && x !== model.parent; x = x.parent) if (keep.includes(partName(x))) return true; return false; };
  const caps = new Map();
  return m => {
    const look = {...DEFAULT_GHOST, ...(m.ghost ?? {})};
    ghost.uniforms.color.value.set(look.color); capMaterial.color.set(look.cap);
    group.updateMatrixWorld(true);
    if (m.section) { local.set(v3(m.section.normal).normalize(), m.section.constant ?? 0); plane.copy(local).applyMatrix4(group.matrixWorld); }
    // A hole (e.g. the fuel-filler pocket) cuts a box out of the surface; a section cut, when active, takes precedence
    const hole = !m.section && prop?.holes?.length && prop.sockets?.[prop.holes[0].socket] ? holePlanes(prop, prop.holes[0], group.matrixWorld) : null;
    for (const entry of meshes) {
      const solid = kept(entry.mesh, m.keep ?? []), cut = !!m.section && !solid, x = solid ? 0 : m.xray;
      const bases = Array.isArray(entry.base) ? entry.base : [entry.base];
      // Dissolve: the solid material fades out over the first half, the ghost fades in over the second
      if (x < 0.5) {
        entry.mesh.material = entry.base;
        for (const b of bases) {
          b.transparent = x > 0; b.opacity = 1 - x * 2; b.depthWrite = x === 0;
          b.clippingPlanes = cut ? [plane] : hole; b.clipIntersection = !cut && !!hole; b.clipShadows = !!hole;
          const mode = cut ? 'cut' : hole ? 'hole' : 'none';
          b.needsUpdate = b.userData.clipMode !== mode || b.userData.ghosting !== x > 0; b.userData.clipMode = mode; b.userData.ghosting = x > 0;
        }
      } else {
        entry.mesh.material = ghost;
        ghost.uniforms.opacity.value = look.opacity * (x - 0.5) * 2;
        ghost.clippingPlanes = m.section ? [plane] : null;
      }
      for (const o of entry.outlines) {
        o.visible = x < 0.25;
        // The ink hull must be cut by the same section or hole, or the removed half's outline (or its dark back faces) shows
        const mode = cut ? 'cut' : hole && x < 0.5 ? 'hole' : 'none';
        if (o.material.userData.clipMode !== mode) { o.material.clippingPlanes = mode === 'cut' ? [plane] : mode === 'hole' ? hole : null; o.material.clipIntersection = mode === 'hole'; o.material.needsUpdate = true; o.material.userData.clipMode = mode; }
        else if (mode === 'hole') o.material.clippingPlanes = hole;
      }
      // Caps: a back-face copy in a flat colour shows through the cut wherever the solid shell is open
      if (cut && x < 0.5) {
        if (!caps.has(entry.mesh)) { const c = new THREE.Mesh(entry.mesh.geometry, capMaterial); c.renderOrder = 1; entry.mesh.add(c); caps.set(entry.mesh, c); }
        caps.get(entry.mesh).visible = true;
      } else if (caps.has(entry.mesh)) caps.get(entry.mesh).visible = false;
    }
  };
}
