import { PerspectiveCamera, Vector3 } from 'three';
import { resolveStyle } from './styles.mjs';
import { parseScript } from '../narration/markup.mjs';
import { normalizeWord } from '../narration/align.mjs';
import { samplePlan } from '../storyboard/sample.mjs';
import { propWorldPoints } from '../storyboard/actions.mjs';
import { rigPoints } from '../storyboard/character.mjs';

/*
 * Caption plan (pure, Node and tests): word groups, timing, emphasis and on-screen placement.
 *   grouping   2-5 words; breaks at sentence ends, commas/colons and real pauses; never ends on a weak word ("the")
 *   timing     a group appears just before its first word and holds until the next group (or fades in long pauses)
 *   emphasis   words marked [[emph +]] in the script, plus story.captions.emphasize
 *   placement  per shot, the band (lower/upper/middle) that least covers characters' heads and bodies and the shot's
 *              subject across all its caption groups, inside the Shorts safe area (captions do not jump within a shot);
 *              a shot can pin a band (story shot.captions.position)
 * The browser draws the plan (tools/render/captions.mjs); QA reads the same plan.
 */
const HARD = /[.?!;]["')\]]*$/, SOFT = /[,:—–-]["')\]]*$/;
const CONJUNCTIONS = new Set(['and', 'but', 'or', 'so', 'then', 'because']);

export function groupWords(words, grouping) {
  const g = grouping, groups = [];
  if (g.sentence) {
    let current = [];
    for (const [k, w] of words.entries()) { current.push(k); if (HARD.test(w.text) || SOFT.test(w.text) && /:$/.test(w.text) || k === words.length - 1) { groups.push(current); current = []; } }
    return groups;
  }
  let current = [];
  const chars = list => list.reduce((n, k) => n + words[k].text.length, 0) + Math.max(0, list.length - 1);
  for (let k = 0; k < words.length; k++) {
    const w = words[k], next = words[k + 1];
    current.push(k);
    const gap = next ? next.start - w.end : Infinity;
    const full = current.length >= g.maxWords || (next && chars([...current, k + 1]) > g.maxChars);
    const conjunction = next && CONJUNCTIONS.has(normalizeWord(next.text)) && current.length >= g.minWords;
    const breakHere = !next || HARD.test(w.text) || (SOFT.test(w.text) && current.length >= g.minWords) || gap >= g.softGapSec || full || conjunction;
    if (!breakHere) continue;
    // A full group breaks where the speaker actually paused (the widest gap between its words), so phrases stay whole
    if (full && !conjunction && current.length > g.minWords) {
      // (equal pauses, common with an aligner's fixed time step, split nearest the middle so groups stay balanced)
      let best = current.length - 1, widest = 0.04;
      const middle = (current.length - 1) / 2;
      for (let p = g.minWords - 1; p < current.length - 1; p++) {
        const between = words[current[p + 1]].start - words[current[p]].end;
        if (between > widest + 1e-3 || (Math.abs(between - widest) <= 1e-3 && best !== current.length - 1 && Math.abs(p - middle) < Math.abs(best - middle))) { widest = Math.max(widest, between); best = p; }
        else if (between >= widest && best === current.length - 1) { widest = between; best = p; }
      }
      while (current.length - 1 > best) { current.pop(); k--; }
    }
    // Do not end a group on weak words when the sentence continues: carry them into the next group
    if (next && !HARD.test(w.text) && !SOFT.test(w.text)) {
      while (current.length > 1 && g.weakEndings.includes(normalizeWord(words[current.at(-1)].text))) { current.pop(); k--; }
    }
    groups.push(current); current = [];
  }
  // A single word joins its neighbour in the same sentence when the result still fits
  const continues = list => !HARD.test(words[list.at(-1)].text);
  for (let n = 0; n < groups.length; n++) {
    const lone = groups[n], prev = groups[n - 1], next = groups[n + 1];
    if (lone.length >= g.minWords) continue;
    if (next && continues(lone) && next.length + 1 <= g.maxWords && chars([...lone, ...next]) <= g.maxChars + 4) { groups[n + 1] = [...lone, ...next]; groups.splice(n--, 1); }
    else if (prev && continues(prev) && prev.length + 1 <= g.maxWords && chars([...prev, ...lone]) <= g.maxChars + 4) { groups[n - 1] = [...prev, ...lone]; groups.splice(n--, 1); }
  }
  return groups;
}

function emphasisSet(script, words, extra = []) {
  const spoken = parseScript(script ?? '').filter(t => t.type === 'word');
  const wanted = new Set(extra.map(normalizeWord));
  return new Set(words.filter((w, i) => spoken[i]?.emphasis || wanted.has(normalizeWord(w.text))).map(w => w.i));
}

// Screen-space boxes (fractions of the frame, y down) of what captions should not cover in one sampled frame
export function focalBoxes(plan, frame, aspect) {
  const s = samplePlan(plan, frame);
  const camera = new PerspectiveCamera(s.camera.fov, aspect, 0.02, 200);
  camera.position.copy(s.camera.position); camera.lookAt(s.camera.target); camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  const toScreen = points => {
    const p = points.map(v => v.clone().project(camera)).filter(v => v.z < 1);
    if (!p.length) return null;
    const xs = p.map(v => (v.x + 1) / 2), ys = p.map(v => (1 - v.y) / 2);
    const box = [Math.max(0, Math.min(...xs)), Math.max(0, Math.min(...ys)), Math.min(1, Math.max(...xs)), Math.min(1, Math.max(...ys))];
    return box[2] > box[0] && box[3] > box[1] ? box : null;
  };
  const boxes = [];
  for (const c of s.characters) {
    const def = plan.cast.find(m => m.id === c.id).definition, R = def.rig, units = def.heightM / R.heightMm;
    const pos = new Vector3(...c.position), toCam = camera.position.clone().sub(pos).setY(0).normalize(), right = new Vector3(toCam.z, 0, -toCam.x);
    const at = ([x, y]) => pos.clone().addScaledVector(right, x * units * c.mirror).setY(y * units);
    const crown = R.heightMm - (R.hipY + R.neckHeight + R.headCenter), [hx, hy] = rigPoints(def, c.pose).headCenter;
    const head = toScreen([[-1, 1], [1, 1], [-1, -0.6], [1, -0.6]].map(([sx, sy]) => at([hx + sx * crown, hy + sy * crown])));
    const body = toScreen([[-0.25, 0], [0.25, 0], [-0.25, hy], [0.25, hy]].map(([sx, y]) => at([sx * R.heightMm, y])));
    if (head) boxes.push({kind:'head', weight:4, box:head});
    if (body) boxes.push({kind:'body', weight:1, box:body});
  }
  const subject = plan.props.find(p => p.id === s.shot.subject);
  if (subject && !subject.missing) { const box = toScreen(propWorldPoints(subject, frame)); if (box) boxes.push({kind:'subject', weight:0.5, box}); }
  return boxes;
}

const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

// Estimated caption block for layout (the browser measures the real one; QA checks it)
export function estimateBlock(text, style, band, frame = {width:1080, height:1920}) {
  const L = style.layout, f = style.font, scale = frame.width / 1080;
  const size = f.sizePx * scale, charW = size * 0.58, maxW = L.maxWidth * frame.width;
  const lines = Math.min(L.maxLines, Math.max(1, Math.ceil(text.length * charW / maxW)));
  const w = Math.min(maxW, text.length * charW / lines) / frame.width, h = (lines * size * f.lineHeight + style.stroke.widthPx * scale) / frame.height;
  const cy = L.bands[band];
  return [L.centerX - w / 2, cy - h / 2, L.centerX + w / 2, cy + h / 2];
}

export function planCaptions(plan, story) {
  const config = story.captions === false ? {enabled:false} : story.captions ?? {};
  if (config.enabled === false) return {enabled:false};
  const style = resolveStyle(config), fps = plan.fps, words = plan.words, aspect = plan.size.width / plan.size.height;
  const emphasized = emphasisSet(story.narration?.script, words, config.emphasize ?? []);
  const shotRules = Object.fromEntries((story.beats ?? []).flatMap(b => b.shots).filter(s => s.captions).map(s => [s.id, s.captions]));
  const t = style.timing, lists = groupWords(words, style.grouping);
  const groups = lists.map((list, n) => {
    const first = words[list[0]], last = words[list.at(-1)], next = lists[n + 1] ? words[lists[n + 1][0]] : null;
    const start = Math.max(0, first.start - t.leadSec);
    const naturalEnd = last.end + t.holdSec, end = next ? (next.start - last.end > t.gapHideSec ? naturalEnd : next.start - t.leadSec) : Math.min(naturalEnd, plan.durationFrames / fps);
    const text = list.map(k => words[k].text).join(' ');
    // Placement: the band that covers the least of what matters, sampled across the group's frames
    const frames = [];
    for (let f = Math.floor(start * fps); f <= Math.min(plan.durationFrames - 1, Math.ceil(end * fps)); f += 3) frames.push(f);
    const boxes = frames.flatMap(f => focalBoxes(plan, f, aspect));
    const shot = plan.shots.find(s => first.startFrame >= s.startFrame && first.startFrame < s.endFrame) ?? plan.shots.at(-1);
    const scores = Object.fromEntries(Object.keys(style.layout.bands).map(band => {
      const block = estimateBlock(text, style, band, plan.size), area = (block[2] - block[0]) * (block[3] - block[1]);
      return [band, boxes.reduce((s, b) => s + b.weight * overlap(block, b.box) / area, 0) / Math.max(1, frames.length)];
    }));
    return {n, text, shot:shot.id, start:+start.toFixed(3), end:+end.toFixed(3), startFrame:Math.round(start * fps), endFrame:Math.round(end * fps), scores,
      words:list.map(k => ({i:words[k].i, text:words[k].text, start:words[k].start, end:words[k].end, emphasis:emphasized.has(words[k].i)}))};
  });
  // One band per shot: the lowest total coverage across its groups (the default band wins ties), unless the shot pins one
  const bands = {};
  for (const shot of new Set(groups.map(g => g.shot))) {
    const inShot = groups.filter(g => g.shot === shot), pinned = shotRules[shot]?.position;
    const total = band => inShot.reduce((s, g) => s + g.scores[band], 0);
    bands[shot] = pinned ?? Object.keys(style.layout.bands).sort((a, b) => total(a) - total(b) || (a === style.layout.default ? -1 : b === style.layout.default ? 1 : 0))[0];
  }
  for (const g of groups) Object.assign(g, {band:bands[g.shot], y:style.layout.bands[bands[g.shot]], pinned:!!shotRules[g.shot]?.position, coverage:+g.scores[bands[g.shot]].toFixed(3)});
  return {enabled:true, style, groups};
}
