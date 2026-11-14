import { openRenderer } from '../storyboard/animatic.mjs';

// Pixel-level QA on clean rendered frames. These are review triggers, kept separate from human visual review:
// they catch exposure, clipping, low subject/character contrast and GPU budget overruns, not taste.
export const QA_LIMITS = {
  tooDark:0.12, tooBright:0.6, crushed:0.12, blown:0.03, subjectContrast:0.015, characterContrast:0.02
};

export function qaFramesFor(plan) {
  const frames = new Set();
  for (const shot of plan.shots) {
    frames.add(Math.min(shot.endFrame - 1, shot.startFrame + 1));
    for (const focus of shot.focus) frames.add(focus.frame);
    frames.add(Math.floor((shot.startFrame + shot.endFrame) / 2));
    frames.add(Math.max(shot.startFrame, shot.endFrame - 2));
  }
  return [...frames].sort((a, b) => a - b);
}

export function judgeQA(plan, stats, budget, limits = QA_LIMITS) {
  const errors = [], warnings = [];
  for (const s of stats) {
    const at = `f${s.frame}`;
    if (s.meanLuma < limits.tooDark) warnings.push({code:'FRAME_TOO_DARK', shot:s.shot, frame:s.frame, message:`${at} mean luminance ${s.meanLuma.toFixed(2)}`});
    if (s.meanLuma > limits.tooBright) warnings.push({code:'FRAME_TOO_BRIGHT', shot:s.shot, frame:s.frame, message:`${at} mean luminance ${s.meanLuma.toFixed(2)}`});
    if (s.crushedLow > limits.crushed) warnings.push({code:'FRAME_CRUSHED', shot:s.shot, frame:s.frame, message:`${at} ${(s.crushedLow * 100).toFixed(0)}% of pixels are near black`});
    if (s.clippedHigh > limits.blown) warnings.push({code:'FRAME_BLOWN', shot:s.shot, frame:s.frame, message:`${at} ${(s.clippedHigh * 100).toFixed(1)}% of pixels are clipped white`});
    if (s.subject && s.subject.contrast < limits.subjectContrast) warnings.push({code:'SUBJECT_LOW_CONTRAST', shot:s.shot, frame:s.frame, message:`${at} subject luminance ${s.subject.luma.toFixed(2)} vs surroundings ${s.subject.ring.toFixed(2)}`});
    for (const c of s.characters) if (c.rect && c.contrast < limits.characterContrast) warnings.push({code:'CHARACTER_LOW_CONTRAST', shot:s.shot, frame:s.frame, message:`${at} ${c.id} luminance ${c.luma.toFixed(2)} vs surroundings ${c.ring.toFixed(2)}`});
    if (s.renderer.triangles > budget.triangles) warnings.push({code:'RENDER_OVER_BUDGET', shot:s.shot, frame:s.frame, message:`${at} ${s.renderer.triangles} triangles > ${budget.triangles}`});
    if (s.renderer.calls > budget.drawCalls) warnings.push({code:'RENDER_OVER_BUDGET', shot:s.shot, frame:s.frame, message:`${at} ${s.renderer.calls} draw calls > ${budget.drawCalls}`});
  }
  const sorted = [...stats].sort((a, b) => a.meanLuma - b.meanLuma);
  return {
    status:errors.length ? 'failed' : warnings.length ? 'review' : 'pass', errors, warnings,
    summary:{frames:stats.length, lumaMin:sorted[0]?.meanLuma ?? null, lumaMedian:sorted[Math.floor(sorted.length / 2)]?.meanLuma ?? null, lumaMax:sorted.at(-1)?.meanLuma ?? null,
      maxTriangles:Math.max(...stats.map(s => s.renderer.triangles)), maxDrawCalls:Math.max(...stats.map(s => s.renderer.calls)), maxTextures:Math.max(...stats.map(s => s.renderer.textures)), budget}
  };
}

export async function renderQA(plan, {quality = 'preview', chromePath} = {}) {
  const started = Date.now();
  const r = await openRenderer(plan, {quality, chromePath});
  try {
    const frames = qaFramesFor(plan);
    const stats = await r.page.evaluate(list => window.qaFrames(list), frames);
    const result = judgeQA(plan, stats, r.quality.budget);
    if (r.problems.length) result.errors.push(...r.problems.map(message => ({code:'RENDER_ERROR', message})));
    if (result.errors.length) result.status = 'failed';
    return {...result, quality, gpu:r.gpu, ms:Date.now() - started, frames:stats, flags:r.setup.flags};
  } finally {
    await r.close();
  }
}
