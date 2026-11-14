import * as THREE from 'three';
import { buildFigure, paintFigure } from '../characters/figure.mjs';
import { compensatePalette } from '../characters/display.mjs';

/*
 * 'vector-2d' characters (the approved cooper). The figure is repainted every frame from the shared pose state
 * (tools/characters/figure.mjs) onto one canvas and mapped onto a camera-facing card, so depth testing still handles
 * occlusion by 3D props. Because the whole body is one painting, joints have no seams, no stacked outlines and no
 * exposed pivots. The canvas covers only the part of the figure inside the frame, at about screen resolution, so
 * close-ups stay sharp; the outline is set in screen pixels, so line weight holds at any camera distance.
 * A second card facing the key light casts the real shadow.
 */
const GRID = [16, 24];

function cardMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms:{map:{value:texture}, tint:{value:new THREE.Color(1, 1, 1)}, ...THREE.UniformsLib.fog},
    vertexShader:`varying vec2 vUv;
#include <fog_pars_vertex>
void main() { vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
#include <fog_vertex>
}`,
    fragmentShader:`uniform sampler2D map; uniform vec3 tint; varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.02) discard;
  gl_FragColor = vec4(c.rgb * tint, c.a);
#include <colorspace_fragment>
#include <fog_fragment>
}`,
    side:THREE.DoubleSide, transparent:true, depthWrite:true, fog:true, toneMapped:false
  });
}

function makeCard(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false; texture.minFilter = THREE.LinearFilter;
  const geometry = new THREE.PlaneGeometry(1, 1);
  return {canvas, g:canvas.getContext('2d'), texture, geometry};
}

// Paint `figure`'s region [x0, y0, x1, y1] (rig mm) into the card at `density` px/mm, and fit the quad and UVs to it
function paintCard(card, mesh, figure, region, density, outlineMm, lineColor) {
  const [x0, y0, x1, y1] = region, {canvas, g} = card;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  g.setTransform(density, 0, 0, -density, -x0 * density, y1 * density);
  paintFigure(g, figure, outlineMm, lineColor);
  const u = (x1 - x0) * density / canvas.width, v = (y1 - y0) * density / canvas.height;
  card.geometry.attributes.uv.array.set([0, 1, u, 1, 0, 1 - v, u, 1 - v]);
  card.geometry.attributes.uv.needsUpdate = true;
  mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  mesh.scale.set(x1 - x0, y1 - y0, 1);
  card.texture.needsUpdate = true;
}

export function buildVectorCharacter(source, {quality, outputWidth = 1080, outputHeight = 1920, display = null}) {
  // Paint pre-compensated colours, so the tone mapper and grade show the palette under neutral light
  const def = {...source, palette:compensatePalette(source.palette, display)};
  const units = def.heightM / def.rig.heightMm;
  const supersample = quality.name === 'production' ? 1.25 : 1;
  const [minPx, maxPx] = def.render.outlinePx;
  const line = def.palette.line;

  function makeRig(card, material) {
    const root = new THREE.Group(), yaw = new THREE.Group(), mirror = new THREE.Group(), body = new THREE.Group();
    root.add(yaw); yaw.add(mirror); mirror.add(body);
    const mesh = new THREE.Mesh(card.geometry, material);
    mesh.name = 'figure';
    body.add(mesh);
    return {root, yaw, mirror, body, mesh};
  }
  const card = makeCard(Math.ceil(outputWidth * supersample), Math.ceil(outputHeight * supersample));
  const visible = makeRig(card, cardMaterial(card.texture));
  const shadowCard = makeCard(1024, 1024);
  // Invisible in the frame; in the shadow pass three copies map and alphaTest from this material onto its depth
  // material, so the alpha test lives here and the shadow takes the figure's silhouette, not the card's rectangle
  const shadow = makeRig(shadowCard, new THREE.MeshBasicMaterial({map:shadowCard.texture, alphaTest:0.5, colorWrite:false, depthWrite:false, side:THREE.DoubleSide}));
  shadow.mesh.castShadow = true;

  function place(rig, state, facing) {
    const s = state.pose.squash;
    rig.root.position.set(...state.position);
    rig.yaw.rotation.y = Math.atan2(facing.x, facing.z);
    rig.mirror.scale.set(state.mirror * state.turnScale, 1, 1);
    rig.body.scale.set(units / Math.sqrt(s), units * s, units);
    rig.root.updateMatrixWorld(true);
  }

  const point = new THREE.Vector3();
  const project = (rig, x, y, camera) => point.set(x, y, 0).applyMatrix4(rig.body.matrixWorld).project(camera);

  return {
    group:visible.root, shadowGroup:shadow.root,
    apply(state, cameraPosition, lightDirection, tint, camera) {
      const figure = buildFigure(def, state);
      if (tint) visible.mesh.material.uniforms.tint.value.copy(tint);
      place(visible, state, cameraPosition.clone().sub(new THREE.Vector3(...state.position)));
      place(shadow, state, lightDirection.clone().negate());

      // Screen scale: pixels per rig millimetre at the figure, and the outline weight for the figure's on-screen size
      const [bx0, by0, bx1, by1] = figure.bounds, mid = (bx0 + bx1) / 2;
      const a = project(visible, mid, by0, camera).y, b = project(visible, mid, by1, camera).y;
      const pxPerMm = Math.max(1e-4, Math.abs(b - a) / 2 * outputHeight / (by1 - by0));
      const charPx = pxPerMm * def.rig.heightMm * 1920 / outputHeight;
      const outlinePx = Math.min(maxPx, Math.max(minPx, charPx * def.render.outlineRatio)) * outputHeight / 1920;
      const outlineMm = outlinePx / pxPerMm, pad = outlineMm + 2;
      const bounds = [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad];

      // Only the part of the figure inside the frame is painted (close-ups would otherwise need enormous canvases)
      let region = null;
      const cw = (bounds[2] - bounds[0]) / GRID[0], ch = (bounds[3] - bounds[1]) / GRID[1];
      for (let i = 0; i <= GRID[0]; i++) for (let j = 0; j <= GRID[1]; j++) {
        const x = bounds[0] + i * cw, y = bounds[1] + j * ch, p = project(visible, x, y, camera);
        if (Math.abs(p.x) > 1.02 || Math.abs(p.y) > 1.02 || p.z < -1 || p.z > 1) continue;
        region = region ? [Math.min(region[0], x), Math.min(region[1], y), Math.max(region[2], x), Math.max(region[3], y)] : [x, y, x, y];
      }
      visible.mesh.visible = !!region;
      if (region) {
        region = [Math.max(bounds[0], region[0] - cw), Math.max(bounds[1], region[1] - ch), Math.min(bounds[2], region[2] + cw), Math.min(bounds[3], region[3] + ch)];
        const density = Math.min(pxPerMm * supersample, card.canvas.width / (region[2] - region[0]), card.canvas.height / (region[3] - region[1]));
        paintCard(card, visible.mesh, figure, region, density, outlineMm, line);
      }
      // The shadow card holds the whole silhouette at a fixed, modest density (shadow maps are coarse anyway)
      const density = Math.min(shadowCard.canvas.width / (bounds[2] - bounds[0]), shadowCard.canvas.height / (bounds[3] - bounds[1]));
      paintCard(shadowCard, shadow.mesh, figure, bounds, density, outlineMm, line);
      return figure;
    },
    // World position of a rig-millimetre point on the visible card (for contact checks)
    world(x, y) { return new THREE.Vector3(x, y, 0).applyMatrix4(visible.body.matrixWorld); },
    dispose() { card.texture.dispose(); shadowCard.texture.dispose(); card.geometry.dispose(); shadowCard.geometry.dispose(); }
  };
}
