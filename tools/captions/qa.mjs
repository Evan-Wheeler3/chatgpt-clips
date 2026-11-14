import { openRenderer } from '../storyboard/animatic.mjs';
import { focalBoxes } from './plan.mjs';

/*
 * Caption QA on drawn frames (the same renderer as the video):
 *   sync         at each word's midpoint, that word is the highlighted one
 *   coverage     every spoken word belongs to exactly one group, in order (none missing, none repeated)
 *   safe area    every drawn caption box lies inside the style's safe area
 *   consistency  one font size; every group enters with the same animation length
 *   faces        how often a caption box covers a character's face (review, not an error)
 */
const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

export function checkPlanCoverage(plan) {
  const seen = plan.captions.groups.flatMap(g => g.words.map(w => w.i)), want = plan.words.map(w => w.i);
  const missing = want.filter(i => !seen.includes(i)), repeated = seen.filter((i, k) => seen.indexOf(i) !== k);
  const outOfOrder = seen.some((i, k) => k && i < seen[k - 1]);
  const sizes = plan.captions.groups.map(g => g.words.length);
  return {missing, repeated, outOfOrder, groupSizes:{min:Math.min(...sizes), max:Math.max(...sizes)}};
}

export async function captionQA(plan, {quality = 'preview', renderer = null} = {}) {
  if (!plan.captions?.enabled) return {status:'skipped', reason:'captions disabled'};
  const fps = plan.fps, style = plan.captions.style, issues = [], warnings = [];
  const coverage = checkPlanCoverage(plan);
  if (coverage.missing.length) issues.push({code:'CAPTION_WORD_MISSING', message:`Not captioned: ${coverage.missing.map(i => plan.words[i].text).join(', ')}`});
  if (coverage.repeated.length) issues.push({code:'CAPTION_WORD_REPEATED', message:`Captioned twice: ${coverage.repeated.map(i => plan.words[i].text).join(', ')}`});
  if (coverage.outOfOrder) issues.push({code:'CAPTION_ORDER', message:'Caption words are out of spoken order'});
  const mids = plan.words.map(w => Math.round((w.start + w.end) / 2 * fps));
  const enters = plan.captions.groups.map(g => [g.startFrame, g.startFrame + 1, g.startFrame + Math.ceil(style.animation.enterSec * fps)]).flat();
  const frames = [...new Set([...mids, ...enters, ...Array.from({length:Math.ceil(plan.durationFrames / 6)}, (_, k) => k * 6)])].filter(f => f < plan.durationFrames).sort((a, b) => a - b);
  const r = renderer ?? await openRenderer(plan, {quality});
  let drawn;
  try { drawn = await r.page.evaluate(list => window.captionFrames(list), frames); }
  finally { if (!renderer) await r.close(); }
  const at = Object.fromEntries(drawn.map(d => [d.frame, d.caption]));
  // Sync: the word being spoken is the highlighted word
  const unsynced = plan.words.filter((w, k) => at[mids[k]]?.current !== w.i);
  if (unsynced.length) issues.push({code:'CAPTION_OUT_OF_SYNC', message:`Not highlighted while spoken: ${unsynced.map(w => `${w.text}@${w.start.toFixed(2)}s`).join(', ')}`});
  // Safe area (fractions of the frame, with half a pixel of tolerance)
  const s = style.layout.safe, eps = 0.5 / plan.size.width;
  const outside = drawn.filter(d => d.caption && (d.caption.box[0] < s.left - eps || d.caption.box[2] > s.right + eps || d.caption.box[1] < s.top - eps || d.caption.box[3] > s.bottom + eps));
  if (outside.length) issues.push({code:'CAPTION_OUTSIDE_SAFE_AREA', message:`${outside.length} frames, e.g. f${outside[0].frame} box ${outside[0].caption.box.map(v => v.toFixed(3)).join(',')}`});
  // Consistency: every group's first frame is drawn partly transparent and fully opaque by the end of its entrance
  const inconsistent = plan.captions.groups.filter(g => { const a = at[g.startFrame + 1]?.alpha, b = at[g.startFrame + Math.ceil(style.animation.enterSec * fps)]?.alpha; return style.animation.enter === 'pop-in' && !(a < 1 && b > 0.99); });
  if (inconsistent.length) warnings.push({code:'CAPTION_ENTRANCE_INCONSISTENT', message:`Groups ${inconsistent.map(g => g.n).join(', ')} do not pop in like the rest`});
  // Faces: frames where the caption covers part of a character's head (fraction of the head box covered)
  const aspect = plan.size.width / plan.size.height, faceHits = [];
  for (const d of drawn.filter(x => x.caption)) for (const b of focalBoxes(plan, d.frame, aspect).filter(b => b.kind === 'head')) {
    const covered = overlap(d.caption.box, b.box) / Math.max(1e-6, (b.box[2] - b.box[0]) * (b.box[3] - b.box[1]));
    if (covered > 0.05) faceHits.push({frame:d.frame, group:d.caption.group, covered:+covered.toFixed(2)});
  }
  if (faceHits.length) warnings.push({code:'CAPTION_COVERS_FACE', message:`${faceHits.length} sampled frames; worst ${Math.max(...faceHits.map(h => h.covered)) * 100}% of a face (f${faceHits.sort((a, b) => b.covered - a.covered)[0].frame})`});
  const sizePx = style.font.sizePx * plan.size.width / 1080;
  if (sizePx / plan.size.height < 0.03) warnings.push({code:'CAPTION_SMALL', message:`Caption text is ${Math.round(sizePx)} px on a ${plan.size.height} px frame`});
  if (style.stroke.widthPx / style.font.sizePx < 0.1 && !style.background) warnings.push({code:'CAPTION_LOW_CONTRAST', message:'Thin stroke and no background: captions may not read over bright scenes'});
  return {status:issues.length ? 'fail' : warnings.length ? 'review' : 'pass', style:style.name, groups:plan.captions.groups.length, framesChecked:frames.length,
    coverage, bands:Object.fromEntries(plan.captions.groups.map(g => [g.n, `${g.shot}:${g.band}`])), faceHits:faceHits.slice(0, 20), issues, warnings};
}
