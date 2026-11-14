/*
 * Burned-in captions: draws a caption plan (tools/captions/plan.mjs) onto the output canvas for one moment in time.
 * Animation presets (restrained): the group pops in (small scale + fade), the spoken word takes the highlight colour with a
 * small scale, emphasised words keep the accent once spoken, and a group fades out only where speech pauses.
 * Returns what was drawn (box in frame fractions, words, current word) so QA can check timing, placement and order.
 */
const clamp01 = t => Math.min(1, Math.max(0, t));
const easeOut = t => 1 - (1 - clamp01(t)) ** 3;

export function activeGroup(captions, time) {
  const groups = captions.groups;
  for (let n = 0; n < groups.length; n++) {
    const g = groups[n];
    if (time >= g.start && time < g.end) return {group:g, next:groups[n + 1] ?? null};
  }
  return null;
}

// Balanced wrapping into at most maxLines lines within maxWidth (measured with the real font)
function wrapWords(ctx, items, maxWidth, maxLines) {
  const width = list => list.reduce((s, it, k) => s + it.width + (k ? it.space : 0), 0);
  if (width(items) <= maxWidth || maxLines < 2 || items.length < 2) return [items];
  let best = null;
  for (let cut = 1; cut < items.length; cut++) {
    const a = items.slice(0, cut), b = items.slice(cut), w = Math.max(width(a), width(b));
    if (!best || w < best.w) best = {w, lines:[a, b]};
  }
  return best.lines;
}

export function drawCaptions(ctx, captions, time, frame) {
  const hit = captions?.enabled ? activeGroup(captions, time) : null;
  if (!hit) return null;
  const {group, next} = hit, st = captions.style, W = frame.width, H = frame.height, u = W / 1080;
  const A = st.animation, L = st.layout;
  const enter = A.enter === 'pop-in' ? easeOut((time - group.start) / Math.max(1e-3, A.enterSec)) : 1;
  // Fade out only into a pause (the next group does not follow straight on)
  const pauseFollows = !next || next.start > group.end + 1e-3;
  const exit = A.exit === 'fade' && pauseFollows ? clamp01((group.end - time) / Math.max(1e-3, A.exitSec)) : 1;
  const alpha = Math.min(enter, exit);
  if (alpha <= 0.001) return null;
  const size = st.font.sizePx * u;
  ctx.save();
  ctx.font = `${st.font.weight} ${size}px ${st.font.family}`;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${st.font.letterSpacing * u}px`;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  // Word gap: a space plus room for the current word's scale-up, so neighbours never touch
  const space = ctx.measureText(' ').width + (st.font.wordGap ?? 0) * size;
  // Exactly one current word: the latest that has started (held through the short gap before the next word).
  // No anticipation: with frame-rate sampling, a 40 ms word would otherwise be overtaken before any frame shows it
  const started = group.words.filter(w => time >= w.start);
  const currentWord = started.length && time < started.at(-1).end + 0.25 ? started.at(-1) : null;
  const items = group.words.map(w => {
    const text = st.font.uppercase ? w.text.toUpperCase() : w.text;
    const spoken = time >= w.start, current = w === currentWord;
    const grow = current ? easeOut((time - w.start + 1 / 60) / Math.max(1e-3, A.wordScaleSec)) : 0;
    const scaleTo = w.emphasis && st.emphasis ? st.emphasis.scale : st.highlight.scale;
    const color = current ? (w.emphasis && st.emphasis ? st.emphasis.color : st.highlight.color) : (w.emphasis && st.emphasis?.persist && spoken ? st.emphasis.color : st.fill);
    return {w, text, width:ctx.measureText(text).width, space, scale:1 + (scaleTo - 1) * grow, color, current};
  });
  const lines = wrapWords(ctx, items, L.maxWidth * W, L.maxLines);
  const lineHeight = size * st.font.lineHeight, blockH = lines.length * lineHeight;
  const widths = lines.map(line => line.reduce((s, it, k) => s + it.width + (k ? it.space : 0), 0));
  const blockW = Math.max(...widths);
  // Centre on the band, then keep the whole block (with stroke) inside the safe area
  const pad = st.stroke.widthPx * u;
  let cx = L.centerX * W, cy = group.y * H;
  cx = Math.min(Math.max(cx, L.safe.left * W + blockW / 2 + pad), L.safe.right * W - blockW / 2 - pad);
  cy = Math.min(Math.max(cy, L.safe.top * H + blockH / 2 + pad), L.safe.bottom * H - blockH / 2 - pad);
  const groupScale = A.enter === 'pop-in' ? A.enterScale + (1 - A.enterScale) * enter : 1;
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy); ctx.scale(groupScale, groupScale);
  const drawn = [];
  lines.forEach((line, li) => {
    let x = -widths[li] / 2;
    const baseline = -blockH / 2 + li * lineHeight + size * 0.8;
    for (const it of line) {
      const mid = x + it.width / 2;
      ctx.save();
      ctx.translate(mid, baseline - size * 0.32); ctx.scale(it.scale, it.scale); ctx.translate(-it.width / 2, size * 0.32);
      if (st.stroke.widthPx > 0) {
        ctx.shadowColor = st.shadow.color; ctx.shadowBlur = st.shadow.blurPx * u; ctx.shadowOffsetY = st.shadow.offsetYPx * u;
        ctx.strokeStyle = st.stroke.color; ctx.lineWidth = st.stroke.widthPx * 2 * u; ctx.strokeText(it.text, 0, 0);
        ctx.shadowColor = 'transparent';
      } else { ctx.fillStyle = st.shadow.color; ctx.fillText(it.text, 0, st.shadow.offsetYPx * u); }
      ctx.fillStyle = it.color; ctx.fillText(it.text, 0, 0);
      ctx.restore();
      drawn.push({i:it.w.i, text:it.w.text, current:it.current, color:it.color, line:li});
      x += it.width + it.space;
    }
  });
  ctx.restore();
  const half = [blockW / 2 * groupScale + pad, blockH / 2 * groupScale + pad];
  return {group:group.n, band:group.band, alpha, box:[(cx - half[0]) / W, (cy - half[1]) / H, (cx + half[0]) / W, (cy + half[1]) / H], lines:lines.length, words:drawn,
    current:drawn.find(d => d.current)?.i ?? null};
}
