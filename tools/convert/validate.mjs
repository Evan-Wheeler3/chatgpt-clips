import { createHash } from 'node:crypto';
import validator from 'gltf-validator';
import { getBounds, getPrimitiveVertexCount, VertexCountMethod } from '@gltf-transform/functions';
import { ImageUtils, Primitive } from '@gltf-transform/core';

// Thresholds are review triggers, not hard limits, except where noted as errors
export const BUDGETS = {triangles:100_000, textureSize:2048, glbBytes:25 * 1024 * 1024};
const SCALE_TOLERANCE = 0.02;
const MIN_EXTENT_M = 0.005, MAX_EXTENT_M = 500;
const MAGIC = {
  'image/jpeg':bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  'image/png':bytes => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
  'image/webp':bytes => String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP',
  'image/ktx2':bytes => bytes[1] === 0x4b && bytes[2] === 0x54 && bytes[3] === 0x58
};
const round = value => Math.round(value * 1e5) / 1e5;

export async function runKhronosValidator(glb) {
  const report = await validator.validateBytes(new Uint8Array(glb), {maxIssues:200, externalResourceFunction:uri => Promise.reject(new Error(`External resource not allowed in GLB: ${uri}`))});
  const {numErrors, numWarnings, numInfos, messages} = report.issues;
  return {
    validatorVersion:report.validatorVersion, errors:numErrors, warnings:numWarnings, infos:numInfos,
    messages:messages.filter(message => message.severity <= 1).slice(0, 20).map(({code, message, severity, pointer}) => ({code, message, severity, pointer}))
  };
}

// Validates a converted document; `expected.extentsM` is the provider's Y-up size in metres, when known
export async function validateDocument(document, glb, {expected = null} = {}) {
  const errors = [], warnings = [];
  const root = document.getRoot();

  const khronos = await runKhronosValidator(glb);
  if (khronos.errors) errors.push(`Khronos glTF validator reported ${khronos.errors} error(s): ${khronos.messages.filter(m => m.severity === 0).map(m => m.code).join(', ')}`);
  if (khronos.warnings) warnings.push(`Khronos glTF validator reported ${khronos.warnings} warning(s): ${[...new Set(khronos.messages.filter(m => m.severity === 1).map(m => m.code))].join(', ')}`);
  if (root.listBuffers().length !== 1) errors.push(`GLB must contain exactly one buffer, found ${root.listBuffers().length}`);
  if (root.listBuffers().some(buffer => buffer.getURI())) errors.push('GLB buffer references an external URI');

  let triangles = 0, vertices = 0, primitives = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    primitives++;
    const position = prim.getAttribute('POSITION');
    if (!position) { errors.push(`Primitive in mesh "${mesh.getName()}" has no POSITION`); continue; }
    if (!prim.getAttribute('NORMAL')) warnings.push(`Primitive in mesh "${mesh.getName()}" has no normals; Three.js will shade it flat`);
    if (prim.getMaterial()?.getNormalTexture() && !prim.getAttribute('TEXCOORD_0')) errors.push(`Mesh "${mesh.getName()}" has a normal map but no TEXCOORD_0`);
    const array = position.getArray();
    if (array.some(value => !Number.isFinite(value))) errors.push(`Mesh "${mesh.getName()}" has non-finite positions`);
    vertices += position.getCount();
    const mode = prim.getMode();
    const count = getPrimitiveVertexCount(prim, VertexCountMethod.RENDER);
    if (mode === Primitive.Mode.TRIANGLES) triangles += count / 3;
    else if (mode === Primitive.Mode.TRIANGLE_STRIP || mode === Primitive.Mode.TRIANGLE_FAN) triangles += Math.max(0, count - 2);
    else warnings.push(`Mesh "${mesh.getName()}" uses non-triangle primitive mode ${mode}`);
  }
  if (!primitives) errors.push('Model contains no mesh primitives');
  if (triangles > BUDGETS.triangles) warnings.push(`${triangles} triangles exceeds the ${BUDGETS.triangles} review budget`);

  const textures = [];
  for (const texture of root.listTextures()) {
    const image = texture.getImage();
    const mime = texture.getMimeType();
    const usedBy = texture.listParents().filter(parent => parent.propertyType === 'Material').length;
    if (!image?.byteLength) { errors.push(`Texture "${texture.getName() || texture.getURI()}" has no embedded image data`); continue; }
    if (!MAGIC[mime]) errors.push(`Texture "${texture.getName()}" has unsupported MIME type ${mime}`);
    else if (!MAGIC[mime](image)) errors.push(`Texture "${texture.getName()}" bytes do not match ${mime}`);
    const size = ImageUtils.getSize(image, mime);
    if (!size) errors.push(`Texture "${texture.getName()}" size could not be read`);
    else if (Math.max(...size) > BUDGETS.textureSize) warnings.push(`Texture "${texture.getName()}" is ${size.join('x')}, over the ${BUDGETS.textureSize}px review budget`);
    textures.push({name:texture.getName(), mime, width:size?.[0] ?? null, height:size?.[1] ?? null, bytes:image.byteLength, materials:usedBy});
    if (!usedBy) warnings.push(`Texture "${texture.getName()}" is not used by any material`);
  }
  const materials = root.listMaterials().map(material => ({
    name:material.getName(), alphaMode:material.getAlphaMode(), doubleSided:material.getDoubleSided(),
    baseColorTexture:!!material.getBaseColorTexture(), normalTexture:!!material.getNormalTexture(),
    metallicRoughnessTexture:!!material.getMetallicRoughnessTexture(), occlusionTexture:!!material.getOcclusionTexture(),
    emissiveTexture:!!material.getEmissiveTexture()
  }));

  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  let bounds = null, scale = null, orientation = null;
  if (!scene) errors.push('Model has no scene');
  else {
    const {min, max} = getBounds(scene);
    const extents = max.map((value, i) => value - min[i]);
    bounds = {min:min.map(round), max:max.map(round), extentsM:extents.map(round)};
    if (extents.some(value => !Number.isFinite(value))) errors.push('Scene bounds are not finite');
    else {
      if (Math.max(...extents) < MIN_EXTENT_M || Math.max(...extents) > MAX_EXTENT_M) errors.push(`Largest extent ${round(Math.max(...extents))} m is outside the plausible ${MIN_EXTENT_M}-${MAX_EXTENT_M} m range; check units`);
      if (expected?.extentsM) {
        const relative = extents.map((value, i) => Math.abs(value - expected.extentsM[i]) / expected.extentsM[i]);
        const sortedRelative = [...extents].sort((a, b) => a - b).map((value, i, sorted) => {
          const target = [...expected.extentsM].sort((a, b) => a - b)[i];
          return Math.abs(value - target) / target;
        });
        scale = {expectedM:expected.extentsM.map(round), actualM:extents.map(round), maxRelativeError:round(Math.max(...relative))};
        if (Math.max(...relative) > SCALE_TOLERANCE) {
          errors.push(Math.max(...sortedRelative) <= SCALE_TOLERANCE
            ? `Axis order differs from provider dimensions (expected Y-up ${scale.expectedM.join(' x ')} m, got ${scale.actualM.join(' x ')} m); orientation is wrong`
            : `Size differs from provider dimensions by ${Math.round(Math.max(...relative) * 100)}% (expected ${scale.expectedM.join(' x ')} m, got ${scale.actualM.join(' x ')} m); check units/scale`);
        }
      } else warnings.push('No provider dimensions available; scale and orientation were not cross-checked');
      const groundOffset = min[1];
      const centerOffset = [(min[0] + max[0]) / 2, (min[2] + max[2]) / 2];
      orientation = {upAxis:'+Y', groundOffsetM:round(groundOffset), horizontalCenterOffsetM:centerOffset.map(round)};
      if (Math.abs(groundOffset) > Math.max(0.01, extents[1] * 0.02)) warnings.push(`Model base is ${round(groundOffset)} m from y=0; it will not rest on the ground without an offset`);
      if (Math.hypot(...centerOffset) > Math.max(extents[0], extents[2]) * 0.1) warnings.push(`Model is ${round(Math.hypot(...centerOffset))} m off the vertical axis through the origin`);
    }
  }
  if (glb.byteLength > BUDGETS.glbBytes) warnings.push(`GLB is ${glb.byteLength} bytes, over the ${BUDGETS.glbBytes} byte review budget`);

  return {
    status:errors.length ? 'failed' : 'passed', errors, warnings,
    checks:{
      khronos, glb:{bytes:glb.byteLength, sha256:createHash('sha256').update(glb).digest('hex')},
      geometry:{meshes:root.listMeshes().length, primitives, triangles, vertices},
      materials, textures, bounds, scale, orientation
    }
  };
}
