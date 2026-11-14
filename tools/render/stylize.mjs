import * as THREE from 'three';

/*
 * Hold Up material treatment for realistic PBR assets. Roles (hero / set / architecture) come from the style file:
 * mapBias softens texture detail through the mip chain, tint/saturation pull albedo toward the palette,
 * bands add gentle cel banding to the lit result, rim adds a warm silhouette light, outline adds an ink hull.
 */
export function stylizeMaterial(material, role, palette) {
  if (!material || material.userData.holdUp) return material;
  const uniforms = {
    holdUpMapBias:{value:role.mapBias ?? 0}, holdUpSaturation:{value:role.saturation ?? 1},
    holdUpBands:{value:role.bands ?? 4}, holdUpBandMix:{value:role.bandMix ?? 0},
    holdUpRim:{value:role.rim ?? 0}, holdUpRimColor:{value:new THREE.Color(palette.rim ?? '#ffd6a0')},
    holdUpRoughMin:{value:role.roughnessMin ?? 0}, holdUpMetalScale:{value:role.metalScale ?? 0.6}
  };
  if (material.color && role.tint) material.color.lerp(new THREE.Color(role.tintColor ?? palette.highlightTint ?? '#ffcf8f'), role.tint);
  if ('envMapIntensity' in material) material.envMapIntensity = Math.min(material.envMapIntensity ?? 1, 0.7);
  if ('roughness' in material && role.roughnessMin) material.roughness = Math.max(material.roughness, role.roughnessMin);
  material.userData.holdUp = {role, uniforms};
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform float holdUpMapBias; uniform float holdUpSaturation; uniform float holdUpBands; uniform float holdUpBandMix;
uniform float holdUpRim; uniform vec3 holdUpRimColor; uniform float holdUpRoughMin; uniform float holdUpMetalScale;
float holdUpLuma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {`)
      .replace('#include <map_fragment>', THREE.ShaderChunk.map_fragment
        .replace('texture2D( map, vMapUv )', 'texture( map, vMapUv, holdUpMapBias )')
        + '\n\tdiffuseColor.rgb = mix(vec3(holdUpLuma(diffuseColor.rgb)), diffuseColor.rgb, holdUpSaturation);')
      // Controlled specular: no chrome-like glints on mapped metal or wet-looking stone
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n\troughnessFactor = max(roughnessFactor, holdUpRoughMin);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n\tmetalnessFactor *= holdUpMetalScale;')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replaceAll('texture2D( normalMap, vNormalMapUv )', 'texture( normalMap, vNormalMapUv, holdUpMapBias )'))
      .replace('#include <opaque_fragment>', `{
  float l = holdUpLuma(outgoingLight);
  float x = l * holdUpBands;
  float banded = (floor(x) + smoothstep(0.38, 0.62, fract(x))) / holdUpBands;
  outgoingLight *= mix(1.0, banded / max(l, 1e-4), holdUpBandMix);
  float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
  outgoingLight += holdUpRimColor * pow(1.0 - facing, 3.0) * holdUpRim * (0.35 + l);
}
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => `holdUp-${role.bands}-${role.bandMix > 0}`;
  material.needsUpdate = true;
  return material;
}

// Ink outline by inverted hull: a back-face copy pushed out along normals (works for instanced meshes too)
export function addOutline(mesh, width, color) {
  if (!width || !mesh.geometry?.attributes?.normal) return null;
  const material = new THREE.MeshBasicMaterial({color, side:THREE.BackSide, fog:true});
  material.onBeforeCompile = shader => {
    shader.uniforms.holdUpOutline = {value:width};
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float holdUpOutline;\nvoid main() {')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed += normalize(normal) * holdUpOutline;');
  };
  const outline = mesh.isInstancedMesh
    ? new THREE.InstancedMesh(mesh.geometry, material, mesh.count)
    : new THREE.Mesh(mesh.geometry, material);
  if (mesh.isInstancedMesh) { outline.instanceMatrix = mesh.instanceMatrix; outline.count = mesh.count; }
  outline.castShadow = false; outline.receiveShadow = false;
  outline.renderOrder = -1;
  outline.userData.outlineOf = mesh.name;
  mesh.add(outline);
  return outline;
}

export function stylizeObject(object, role, palette, {outlineScale = 1} = {}) {
  const outlines = [];
  object.traverse(child => {
    if (!child.isMesh || child.userData.outlineOf !== undefined) return;
    child.material = Array.isArray(child.material) ? child.material.map(m => stylizeMaterial(m, role, palette)) : stylizeMaterial(child.material, role, palette);
    if (role.outline) outlines.push([child, role.outline * outlineScale]);
  });
  for (const [mesh, width] of outlines) addOutline(mesh, width, palette.outline ?? '#1f140d');
  return object;
}
