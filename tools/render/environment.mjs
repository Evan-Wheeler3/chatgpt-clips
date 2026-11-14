import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { stylizeMaterial, addOutline } from './stylize.mjs';

const deg = THREE.MathUtils.degToRad;

// Seeded random so dust and variation are identical in every render
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Box with UVs in metres on every face, so true-scale textures tile without stretching
export function meterBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) for (let k = 0; k < 4; k++) {
    const i = face * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[face][0], uv.getY(i) * dims[face][1]);
  }
  return g;
}

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(0.55, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,200,1)'); grad.addColorStop(0.25, 'rgba(255,190,110,0.55)'); grad.addColorStop(1, 'rgba(255,150,60,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export async function buildEnvironment({scene, renderer, env, style, quality, loadGLB, loadTexture}) {
  const root = new THREE.Group();
  root.name = `environment:${env.id}`;
  scene.add(root);
  const palette = style.palette;
  const [minX, , minZ] = env.bounds.min, [maxX, maxY, maxZ] = env.bounds.max;
  const center = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const flags = [];

  // Materials: true-scale tiling from the texture's real-world size, then the Hold Up treatment by role
  const materials = {};
  for (const [name, spec] of Object.entries(env.materials)) {
    const m = new THREE.MeshStandardMaterial({color:new THREE.Color(spec.color ?? '#ffffff'), roughness:spec.roughness ?? 1, metalness:spec.metalness ?? 0});
    if (spec.texture) {
      const [sx, sy] = spec.texture.realSizeM;
      const setup = (tex, srgb) => { const t = tex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / sx, 1 / sy); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; t.needsUpdate = true; return t; };
      m.map = setup(await loadTexture(spec.texture.maps.color), true);
      if (spec.texture.maps.normal) { m.normalMap = setup(await loadTexture(spec.texture.maps.normal), false); m.normalScale.set(0.8, 0.8); }
      if (spec.texture.maps.arm) { const arm = setup(await loadTexture(spec.texture.maps.arm), false); m.roughnessMap = arm; m.aoMap = arm; m.aoMapIntensity = 0.8; }
    } else if (!spec.color) flags.push(`MISSING TEXTURE: ${name}`);
    m.color.multiply(new THREE.Color(spec.tint ?? '#ffffff'));
    materials[name] = quality.stylize ? stylizeMaterial(m, style.materials[spec.role ?? 'architecture'], palette) : m;
  }
  const mesh = (geometry, material, {cast = true, receive = true} = {}) => {
    const o = new THREE.Mesh(geometry, materials[material] ?? material);
    o.castShadow = cast; o.receiveShadow = receive;
    root.add(o);
    return o;
  };

  for (const part of env.architecture) {
    if (part.type === 'floor') {
      const w = maxX - minX, d = maxZ - minZ;
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) + w / 2, pos.getZ(i) + d / 2);
      mesh(g, part.material, {cast:false}).position.copy(center);
    }

    if (part.type === 'walls') {
      const t = 0.4;
      // [length, transform] per side; `along` maps a world coordinate to the wall's u
      const sides = {
        back:{length:maxX - minX, position:[minX, 0, minZ - t], rotation:0, along:x => x - minX, glass:[0, 0, minZ - t + 0.05]},
        front:{length:maxX - minX, position:[maxX, 0, maxZ + t], rotation:Math.PI, along:x => maxX - x},
        left:{length:maxZ - minZ, position:[minX - t, 0, maxZ], rotation:Math.PI / 2, along:z => maxZ - z},
        right:{length:maxZ - minZ, position:[maxX + t, 0, minZ], rotation:-Math.PI / 2, along:z => z - minZ}
      };
      for (const side of part.sides) {
        const s = sides[side];
        const shape = new THREE.Shape();
        shape.moveTo(0, 0); shape.lineTo(s.length, 0); shape.lineTo(s.length, part.height); shape.lineTo(0, part.height); shape.lineTo(0, 0);
        const openings = (part.openings ?? []).filter(o => o.side === side);
        for (const o of openings) {
          const u = s.along(o.center[0]), [w, h] = o.size, y0 = o.center[1] - h / 2;
          const hole = new THREE.Path();
          if (o.type === 'window') {
            hole.moveTo(u - w / 2, y0); hole.lineTo(u + w / 2, y0); hole.lineTo(u + w / 2, y0 + h - w / 2);
            hole.absarc(u, y0 + h - w / 2, w / 2, 0, Math.PI, false); hole.lineTo(u - w / 2, y0);
          } else {
            hole.moveTo(u - w / 2, 0.001); hole.lineTo(u + w / 2, 0.001); hole.lineTo(u + w / 2, y0 + h); hole.lineTo(u - w / 2, y0 + h); hole.lineTo(u - w / 2, 0.001);
          }
          shape.holes.push(hole);
        }
        const wall = mesh(new THREE.ExtrudeGeometry(shape, {depth:t, bevelEnabled:false, curveSegments:12}), part.material);
        wall.position.set(...s.position); wall.rotation.y = s.rotation;
        for (const o of openings) {
          const u = s.along(o.center[0]), [w, h] = o.size;
          const holder = new THREE.Group(); holder.position.set(...s.position); holder.rotation.y = s.rotation; root.add(holder);
          if (o.type === 'window') {
            // Bright exterior beyond the opening: reads as daylight and feeds the bloom; it never blocks the sun
            // Daylight beyond the opening: a soft vertical gradient (brighter sky above), not a flat card
            const sky = document.createElement('canvas'); sky.width = 4; sky.height = 64;
            const sg = sky.getContext('2d'), grad = sg.createLinearGradient(0, 0, 0, 64);
            grad.addColorStop(0, '#fff3d6'); grad.addColorStop(0.55, '#ffd9a0'); grad.addColorStop(1, '#c98f5a');
            sg.fillStyle = grad; sg.fillRect(0, 0, 4, 64);
            const skyTexture = new THREE.CanvasTexture(sky); skyTexture.colorSpace = THREE.SRGBColorSpace;
            const glass = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.02, h + 0.02), new THREE.MeshBasicMaterial({map:skyTexture, color:new THREE.Color('#ffffff').multiplyScalar(1.5), fog:false}));
            glass.position.set(u, o.center[1], 0.02); holder.add(glass);
            const frameMat = materials.timber;
            for (const [fx, fy, fw, fh] of [[u, o.center[1] - h / 2 + 0.05, w, 0.1], [u, o.center[1], w, 0.06], [u, o.center[1] - 0.15, 0.06, h - 0.3]]) {
              const bar = new THREE.Mesh(meterBox(fw, fh, 0.08), frameMat); bar.position.set(fx, fy, t * 0.5); bar.castShadow = true; holder.add(bar);
            }
          } else {
            const door = new THREE.Mesh(meterBox(w - 0.04, h - 0.02, 0.08), materials[o.material] ?? materials.planks);
            door.position.set(u, h / 2, t * 0.75); door.receiveShadow = door.castShadow = true; holder.add(door);
            for (const y of [0.45, h - 0.5]) { const strap = new THREE.Mesh(meterBox(w - 0.1, 0.07, 0.02), materials.iron); strap.position.set(u, y, t * 0.75 + 0.05); holder.add(strap); }
          }
        }
      }
      // Gable ends above the tie beams, so the roof space is closed and the back wall reads as a building
      const truss = env.architecture.find(p => p.type === 'trusses');
      if (truss) for (const [z, flip] of [[minZ - 0.2, 0], [maxZ + 0.2, Math.PI]]) {
        const gable = new THREE.Shape();
        gable.moveTo(minX, part.height); gable.lineTo(maxX, part.height); gable.lineTo(center.x, truss.ridgeHeight + 0.2); gable.lineTo(minX, part.height);
        const g = mesh(new THREE.ExtrudeGeometry(gable, {depth:0.4, bevelEnabled:false}), part.material);
        g.position.set(0, 0, z - 0.2); if (flip) { g.rotation.y = flip; g.position.set(2 * center.x, 0, z + 0.2); }
      }
    }

    if (part.type === 'plinth') {
      for (const [x, z, w, d] of [[center.x, minZ + part.depth / 2, maxX - minX, part.depth], [center.x, maxZ - part.depth / 2, maxX - minX, part.depth],
        [minX + part.depth / 2, center.z, part.depth, maxZ - minZ], [maxX - part.depth / 2, center.z, part.depth, maxZ - minZ]]) {
        mesh(meterBox(w, part.height, d), part.material).position.set(x, part.height / 2, z);
      }
    }

    if (part.type === 'piers') for (const p of part.positions) {
      const h = maxY, w = part.width, d = part.depth;
      const [x, z, bw, bd] = part.side === 'left' ? [minX + d / 2, p, d, w] : part.side === 'right' ? [maxX - d / 2, p, d, w] : part.side === 'back' ? [p, minZ + d / 2, w, d] : [p, maxZ - d / 2, w, d];
      mesh(meterBox(bw, h, bd), part.material).position.set(x, h / 2, z);
    }

    if (part.type === 'trusses') {
      const [bw, bh] = part.beam, span = maxX - minX, rise = part.ridgeHeight - part.tieHeight;
      const rafterLength = Math.hypot(span / 2, rise), pitch = Math.atan2(rise, span / 2);
      for (const z of part.z) {
        mesh(meterBox(span, bh, bw), part.material).position.set(center.x, part.tieHeight + bh / 2, z);
        mesh(meterBox(bw * 0.9, rise, bw * 0.9), part.material).position.set(center.x, part.tieHeight + rise / 2, z);
        for (const dir of [-1, 1]) {
          const r = mesh(meterBox(rafterLength, bh, bw), part.material);
          r.position.set(center.x + dir * span / 4, part.tieHeight + rise / 2 + bh / 2, z); r.rotation.z = dir * -pitch;
          const strut = mesh(meterBox(Math.hypot(span / 4, rise / 2), bh * 0.7, bw * 0.8), part.material);
          strut.position.set(center.x + dir * span / 8, part.tieHeight + rise * 0.4, z); strut.rotation.z = dir * Math.atan2(rise / 2, span / 4);
        }
      }
      // Ridge and purlins run the length of the building
      mesh(meterBox(bw, bh, maxZ - minZ), part.material).position.set(center.x, part.ridgeHeight + bh / 2, center.z);
      for (const f of [0.35, 0.7]) for (const dir of [-1, 1]) {
        mesh(meterBox(bw * 0.8, bh * 0.8, maxZ - minZ), part.material).position.set(center.x + dir * span / 2 * (1 - f), part.tieHeight + rise * f + bh, center.z);
      }
    }

    if (part.type === 'roof') {
      const span = maxX - minX, rise = part.ridgeHeight - part.eaveHeight, slope = Math.hypot(span / 2, rise);
      for (const dir of [-1, 1]) {
        const g = new THREE.PlaneGeometry(slope, maxZ - minZ + 0.8).rotateX(-Math.PI / 2);
        const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * slope, uv.getY(i) * (maxZ - minZ + 0.8));
        const material = materials[part.material].clone(); material.side = THREE.DoubleSide;
        const r = mesh(g, material, {cast:true});
        r.rotation.z = -dir * Math.atan2(rise, span / 2); // Each half rises toward the ridge
        r.position.set(center.x + dir * span / 4, part.eaveHeight + rise / 2 + 0.3, center.z);
      }
    }

    if (part.type === 'rack') {
      const [x0, z0] = part.from, [x1, z1] = part.to;
      const length = Math.hypot(x1 - x0, z1 - z0), mid = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      for (const off of [-0.26, 0.26]) {
        const rail = mesh(alongX ? meterBox(length, 0.12, 0.12) : meterBox(0.12, 0.12, length), part.material);
        rail.position.set(mid.x + (alongX ? 0 : off), 0.16, mid.z + (alongX ? off : 0));
      }
      for (let s = 0; s <= length; s += 1.4) {
        const sleeper = mesh(alongX ? meterBox(0.14, 0.1, 0.8) : meterBox(0.8, 0.1, 0.14), part.material);
        sleeper.position.set(alongX ? x0 + s * Math.sign(x1 - x0) : mid.x, 0.05, alongX ? mid.z : z0 + s * Math.sign(z1 - z0));
      }
    }
  }

  // Floor contact darkening along the walls, so the room is grounded rather than floating on a flat plane
  const blob = blobTexture();
  const edge = (() => {
    const c = document.createElement('canvas'); c.width = 4; c.height = 64;
    const g = c.getContext('2d'), grad = g.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 4, 64);
    return new THREE.CanvasTexture(c);
  })();
  for (const [x, z, w, rot] of [[center.x, minZ + 0.6, maxX - minX, 0], [center.x, maxZ - 0.6, maxX - minX, Math.PI], [minX + 0.6, center.z, maxZ - minZ, Math.PI / 2], [maxX - 0.6, center.z, maxZ - minZ, -Math.PI / 2]]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, 1.2), new THREE.MeshBasicMaterial({map:edge, color:0x000000, transparent:true, depthWrite:false}));
    strip.rotation.set(-Math.PI / 2, 0, rot); strip.position.set(x, 0.004, z); strip.renderOrder = 1;
    root.add(strip);
  }

  // Catalog models: identical meshes are instanced (one draw call per mesh, however many barrels)
  const byAsset = new Map();
  // Batch per asset and per treatment: background stock skips outlines and shadow casting
  for (const instance of env.instances) {
    const key = `${instance.asset}|${instance.castShadow === false ? 'flat' : 'full'}`;
    byAsset.set(key, [...(byAsset.get(key) ?? []), instance]);
  }
  const blobs = [];
  for (const [key, list] of byAsset) {
    const [assetId, treatment] = key.split('|');
    const gltf = await loadGLB(assetId);
    gltf.scene.updateMatrixWorld(true);
    const meshes = [];
    gltf.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const source of meshes) {
      const material = source.material.clone();
      const inst = new THREE.InstancedMesh(source.geometry, material, list.length);
      inst.castShadow = treatment === 'full'; inst.receiveShadow = true;
      list.forEach((item, i) => {
        const m = new THREE.Matrix4().compose(new THREE.Vector3(...item.position), new THREE.Quaternion().setFromEuler(new THREE.Euler(...item.rotation.map(deg), 'XYZ')), new THREE.Vector3().setScalar(item.scale ?? 1));
        inst.setMatrixAt(i, m.multiply(source.matrixWorld));
      });
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      root.add(inst);
      if (quality.stylize) {
        stylizeMaterial(inst.material, style.materials.set, palette);
        if (treatment === 'full') addOutline(inst, style.materials.set.outline * (quality.name === 'production' ? 1 : 1.6), palette.outline);
      }
    }
    for (const item of list) if (item.box.min[1] < 0.05) blobs.push(item.box);
  }
  if (blobs.length) {
    const ao = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({map:blob, color:0x000000, transparent:true, opacity:0.5, depthWrite:false}), blobs.length);
    blobs.forEach((b, i) => {
      const w = (b.max[0] - b.min[0]) * 1.25, d = (b.max[2] - b.min[2]) * 1.25;
      ao.setMatrixAt(i, new THREE.Matrix4().compose(new THREE.Vector3((b.min[0] + b.max[0]) / 2, 0.006, (b.min[2] + b.max[2]) / 2), new THREE.Quaternion(), new THREE.Vector3(w, 1, d)));
    });
    ao.renderOrder = 1;
    root.add(ao);
  }

  // Lighting rig: warm sun through the windows (the only shadowed light), cool fill, warm practicals, ambient bounce
  const L = env.lighting;
  const sunDir = new THREE.Vector3(...L.key.direction).normalize();
  const sun = new THREE.DirectionalLight(L.key.color, L.key.intensity);
  sun.position.copy(center).addScaledVector(sunDir, -30);
  sun.target.position.copy(center);
  sun.castShadow = !!L.key.shadow;
  const extent = Math.max(maxX - minX, maxZ - minZ) * 0.75;
  Object.assign(sun.shadow.camera, {left:-extent, right:extent, top:extent, bottom:-extent, near:1, far:80});
  sun.shadow.mapSize.set(quality.shadowMap, quality.shadowMap);
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025;
  root.add(sun, sun.target);
  root.add(new THREE.HemisphereLight(L.ambient.sky, L.ambient.ground, L.ambient.intensity));
  if (L.fill) {
    const fill = new THREE.DirectionalLight(L.fill.color, L.fill.intensity);
    fill.position.copy(center).addScaledVector(new THREE.Vector3(...L.fill.direction).normalize(), -20);
    fill.target.position.copy(center);
    root.add(fill, fill.target);
  }
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = L.environment ?? 0.3;
  const glow = glowTexture();
  const practicals = L.practicals.map((p, i) => {
    const light = new THREE.PointLight(p.color, p.intensity, p.distance, 2);
    light.position.set(...p.position);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:glow, color:new THREE.Color(p.color).multiplyScalar(3), blending:THREE.AdditiveBlending, depthWrite:false, fog:false}));
    sprite.position.set(...p.position); sprite.scale.setScalar((p.glow ?? 0.06) * 10);
    root.add(light, sprite);
    if (p.hang) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, p.hang.ropeTo - p.position[1] - 0.1, 6), new THREE.MeshStandardMaterial({color:'#4a3a2a', roughness:1}));
      rope.position.set(p.position[0], (p.hang.ropeTo + p.position[1] + 0.1) / 2, p.position[2]);
      root.add(rope);
    }
    return {light, sprite, base:p.intensity, flicker:p.flicker ?? 0, phase:i * 1.7};
  });

  const A = env.atmosphere;
  if (A.fog) scene.fog = new THREE.FogExp2(A.fog.color, A.fog.density);

  // Sun shafts: additive cones from each window along the sun direction, fading toward the floor and at the edges
  const windows = (env.architecture.find(p => p.type === 'walls')?.openings ?? []).filter(o => o.type === 'window' && o.side === 'back');
  const shaftMaterial = (opacity) => new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, fog:false,
    uniforms:{color:{value:new THREE.Color(palette.key)}, opacity:{value:opacity}},
    vertexShader:'varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vDepth = -mv.z; gl_Position = projectionMatrix * mv; }',
    // Soft edges, fade toward the floor, and fade out close to the camera so a shaft never washes the whole frame
    fragmentShader:'uniform vec3 color; uniform float opacity; varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vDepth; void main(){ float edge = pow(abs(dot(vN, vV)), 3.0); float along = smoothstep(0.0, 0.25, vUv.y) * (0.35 + 0.65 * vUv.y); float near = smoothstep(0.8, 3.0, vDepth); gl_FragColor = vec4(color * opacity * edge * along * near, 1.0); }'
  });
  const shafts = [];
  for (const s of A.shafts ?? []) {
    const w = windows[s.window];
    if (!w) continue;
    const origin = new THREE.Vector3(w.center[0], w.center[1], minZ + 0.05);
    const geometry = new THREE.CylinderGeometry(s.radius[0], s.radius[1], s.length, 24, 1, true);
    const cone = new THREE.Mesh(geometry, shaftMaterial(s.opacity));
    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), sunDir);
    cone.position.copy(origin).addScaledVector(sunDir, s.length / 2);
    cone.renderOrder = 2;
    root.add(cone);
    shafts.push({origin, radius:s.radius, length:s.length});
  }

  // Dust motes: drifting points that glow inside the sun shafts (deterministic: position is a function of time)
  let dust = null;
  if (A.dust && quality.dust > 0) {
    const rand = seeded(7);
    const n = quality.dust, positions = new Float32Array(n * 3), seeds = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      positions.set([A.dust.min[0] + rand() * (A.dust.max[0] - A.dust.min[0]), A.dust.min[1] + rand() * (A.dust.max[1] - A.dust.min[1]), A.dust.min[2] + rand() * (A.dust.max[2] - A.dust.min[2])], i * 3);
      seeds[i] = rand();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    const shaftUniform = (k, f) => shafts.map(f).concat(Array(2).fill(new THREE.Vector3())).slice(0, 2);
    const material = new THREE.ShaderMaterial({
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, fog:false,
      uniforms:{time:{value:0}, size:{value:A.dust.size * 900 * (quality.scale)}, color:{value:new THREE.Color(palette.key)},
        o0:{value:shaftUniform(0, s => s.origin)[0]}, o1:{value:shaftUniform(0, s => s.origin)[1]}, dir:{value:sunDir}},
      vertexShader:`attribute float seed; uniform float time; uniform float size; uniform vec3 o0; uniform vec3 o1; uniform vec3 dir; varying float vBright;
float inShaft(vec3 p, vec3 o) { vec3 d = p - o; float t = dot(d, dir); float r = length(d - dir * t); return t > 0.0 ? 1.0 - smoothstep(0.4, 1.2, r - t * 0.1) : 0.0; }
void main() { vec3 p = position + vec3(sin(time * 0.21 + seed * 40.0) * 0.18, sin(time * 0.13 + seed * 17.0) * 0.12 + time * 0.012 * (seed - 0.5), cos(time * 0.17 + seed * 23.0) * 0.18);
  vBright = 0.08 + 0.92 * max(inShaft(p, o0), inShaft(p, o1));
  vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_PointSize = size / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader:'uniform vec3 color; varying float vBright; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; gl_FragColor = vec4(color * vBright * (1.0 - d * 2.0) * 0.9, 1.0); }'
    });
    dust = new THREE.Points(g, material);
    dust.frustumCulled = false;
    root.add(dust);
  }

  return {
    root, flags,
    update(frame, fps) {
      const t = frame / fps;
      for (const p of practicals) {
        const f = 1 + p.flicker * (Math.sin(t * 9.1 + p.phase) * 0.6 + Math.sin(t * 23.3 + p.phase * 2) * 0.4);
        p.light.intensity = p.base * f;
        p.sprite.material.opacity = 0.75 + 0.25 * f;
      }
      if (dust) dust.material.uniforms.time.value = t;
    },
    keyLight:sun
  };
}
