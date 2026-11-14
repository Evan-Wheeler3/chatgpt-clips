/*
 * What the display chain does to a flat, unlit character colour: sRGB decode, NeutralToneMapping with the render's
 * exposure (the character tint already divides exposure out), sRGB encode, then the channel grade (saturation,
 * contrast, split toning; vignette and grain are left out because they vary across the frame).
 * Inverting it lets a flat-painted character show its palette colours on screen under neutral light.
 * Mirrors three's NeutralToneMapping and tools/render/post.mjs GradeShader.
 */
const toLinear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const toSrgb = c => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
const clamp01 = v => Math.min(1, Math.max(0, v));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
export const rgbToHex = rgb => '#' + rgb.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');

function neutralToneMap(color) {
  const start = 0.8 - 0.04, desaturation = 0.15;
  const x = Math.min(...color), offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let c = color.map(v => v - offset);
  const peak = Math.max(...c);
  if (peak < start) return c;
  const d = 1 - start, newPeak = 1 - d * d / (peak + d - start);
  c = c.map(v => v * newPeak / peak);
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return c.map(v => v + (newPeak - v) * g);
}

// display: {grade:{contrast, saturation, shadowTintAmount, highlightTintAmount}, shadowTint, highlightTint} (hex tints)
export function displayed(rgb, display) {
  let c = neutralToneMap(rgb.map(toLinear)).map(v => toSrgb(Math.max(0, v)));
  const g = display.grade, l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  c = c.map(v => l + (v - l) * g.saturation).map(v => (v - 0.5) * g.contrast + 0.5);
  const st = hexToRgb(display.shadowTint), ht = hexToRgb(display.highlightTint);
  const ws = (1 - smoothstep(0, 0.45, l)) * g.shadowTintAmount, wh = smoothstep(0.55, 1, l) * g.highlightTintAmount;
  c = c.map((v, i) => v + (v * st[i] * 2.2 - v) * ws).map((v, i) => v + (v * ht[i] * 1.15 - v) * wh);
  return c.map(clamp01);
}

// The colour to paint so that `displayed` shows `target` (fixed-point iteration; returns the residual for reporting)
export function compensate(target, display, iterations = 40) {
  let x = [...target];
  for (let k = 0; k < iterations; k++) {
    const y = displayed(x, display);
    x = x.map((v, i) => clamp01(v + (target[i] - y[i])));
  }
  const residual = rgb => Math.max(...displayed(rgb, display).map((v, i) => Math.abs(v - target[i])));
  // Near-black colours cannot be reached exactly (the tone mapper crushes them). Chasing them per channel can shift
  // the hue, so also try keeping the authored hue and lifting only its brightness, and keep whichever looks closer
  if (residual(x) > 0.01) {
    const luma = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2], want = luma(target);
    let lo = 1, hi = 4;
    for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (luma(displayed(target.map(v => clamp01(v * m)), display)) < want) lo = m; else hi = m; }
    const lifted = target.map(v => clamp01(v * lo));
    if (deltaE(displayed(lifted, display), target) < deltaE(displayed(x, display), target)) x = lifted;
  }
  return {rgb:x, residual:residual(x), deltaE:deltaE(displayed(x, display), target)};
}

// CIE76 colour difference between two sRGB colours (0-1)
export function deltaE(a, b) {
  const lab = rgb => {
    const [R, G, B] = rgb.map(toLinear), f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.9505), y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.089);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

// The ink line is left as authored: the chain can only show it darker, and a darker outline keeps the silhouette
// readable against dark sets
export function compensatePalette(palette, display, keep = ['line']) {
  if (!display) return palette;
  return Object.fromEntries(Object.entries(palette).map(([k, hex]) => [k, keep.includes(k) ? hex : rgbToHex(compensate(hexToRgb(hex), display).rgb)]));
}
