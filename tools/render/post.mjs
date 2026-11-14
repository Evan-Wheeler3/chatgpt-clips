import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Display-referred grade after tone mapping: contrast, saturation, split toning, vignette, grain
const GradeShader = {
  uniforms:{
    tDiffuse:{value:null}, contrast:{value:1}, saturation:{value:1},
    shadowTint:{value:new THREE.Color('#2c3a5c')}, shadowAmount:{value:0}, highlightTint:{value:new THREE.Color('#ffcf8f')}, highlightAmount:{value:0},
    vignette:{value:0}, grain:{value:0}, frame:{value:0}, aspect:{value:9 / 16}
  },
  vertexShader:'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader:`uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation;
uniform vec3 shadowTint; uniform float shadowAmount; uniform vec3 highlightTint; uniform float highlightAmount;
uniform float vignette; uniform float grain; uniform float frame; uniform float aspect; varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, saturation);
  c = (c - 0.5) * contrast + 0.5;
  c = mix(c, c * shadowTint * 2.2, (1.0 - smoothstep(0.0, 0.45, l)) * shadowAmount);
  c = mix(c, c * highlightTint * 1.15, smoothstep(0.55, 1.0, l) * highlightAmount);
  vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) * 1.6;
  c *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
  c += (hash(vUv * 1000.0 + frame * 7.13) - 0.5) * grain;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`
};

export function createPost(renderer, scene, camera, {quality, style, width, height}) {
  if (quality.post === 'none') return {render:() => renderer.render(scene, camera), setFrame() {}};
  const target = new THREE.WebGLRenderTarget(width, height, {type:THREE.HalfFloatType, samples:quality.msaa});
  const composer = new EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, camera));
  if (quality.post === 'full') {
    const b = style.grade.bloom;
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(width, height), b.strength, b.radius, b.threshold));
  }
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  const g = style.grade, p = style.palette;
  Object.assign(grade.uniforms.contrast, {value:g.contrast});
  Object.assign(grade.uniforms.saturation, {value:g.saturation});
  grade.uniforms.shadowTint.value.set(p.shadowTint);
  grade.uniforms.highlightTint.value.set(p.highlightTint);
  grade.uniforms.shadowAmount.value = g.shadowTintAmount;
  grade.uniforms.highlightAmount.value = g.highlightTintAmount;
  grade.uniforms.vignette.value = g.vignette;
  grade.uniforms.grain.value = quality.post === 'full' ? g.grain : 0;
  grade.uniforms.aspect.value = width / height;
  composer.addPass(grade);
  return {render:() => composer.render(), setFrame(frame) { grade.uniforms.frame.value = frame; }};
}
