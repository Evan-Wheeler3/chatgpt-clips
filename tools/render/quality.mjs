// Render quality presets, shared by Node (validation, budgets, launch flags) and the browser renderer.
// Budgets target a fanless M1 MacBook Air with 8 GB of unified memory.
export const QUALITY = {
  // Phase 4 storyboard look: plain stage, no styling, CPU (SwiftShader) for deterministic, GPU-independent frames
  animatic:{scale:1 / 3, gpu:'swiftshader', environment:false, stylize:false, post:'none', shadowMap:1024, msaa:0, pxPerMm:0.4, dust:0, hud:true, whipSamples:[6, 16]},
  // Styled environments and characters at low resolution for fast review
  preview:{scale:1 / 3, gpu:'metal', environment:true, stylize:true, post:'grade', shadowMap:1024, msaa:0, pxPerMm:0.5, dust:220, hud:true, whipSamples:[6, 12]},
  // Full-resolution clean frames: bloom, grain, MSAA, sharper character art, no review overlay
  production:{scale:1, gpu:'metal', environment:true, stylize:true, post:'full', shadowMap:2048, msaa:4, pxPerMm:1.2, dust:600, hud:false, whipSamples:[8, 24]}
};

export const BUDGETS = {
  animatic:{triangles:400_000, drawCalls:250, textureMB:128},
  preview:{triangles:1_200_000, drawCalls:600, textureMB:320},
  production:{triangles:1_200_000, drawCalls:600, textureMB:420}
};

export function qualityPreset(name) {
  const preset = QUALITY[name];
  if (!preset) throw new Error(`Unknown quality "${name}"; use ${Object.keys(QUALITY).join(', ')}`);
  return {name, ...preset, budget:BUDGETS[name]};
}
