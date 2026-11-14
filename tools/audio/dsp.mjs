/*
 * Small, deterministic DSP toolkit for generating and mixing Hold Up audio (no dependencies).
 * Signals are Float32Array at SAMPLE_RATE; randomness is seeded, so every asset is reproducible bit for bit.
 */
export const SAMPLE_RATE = 48000;

export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const buffer = sec => new Float32Array(Math.max(1, Math.round(sec * SAMPLE_RATE)));
export function white(sec, rand) { const b = buffer(sec); for (let i = 0; i < b.length; i++) b[i] = rand() * 2 - 1; return b; }
export function brown(sec, rand, leak = 0.995) { const b = buffer(sec); let y = 0; for (let i = 0; i < b.length; i++) { y = y * leak + (rand() * 2 - 1) * 0.06; b[i] = y; } return b; }

// One-pole low/high pass and an RBJ biquad band-pass (constant 0 dB peak)
export function lowpass(x, hz) { const a = Math.exp(-2 * Math.PI * hz / SAMPLE_RATE), y = new Float32Array(x.length); let s = 0; for (let i = 0; i < x.length; i++) { s = (1 - a) * x[i] + a * s; y[i] = s; } return y; }
export function highpass(x, hz) { const lp = lowpass(x, hz); return x.map((v, i) => v - lp[i]); }
export function bandpass(x, hz, q = 2, hzAt = null) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0, b0, b2, a0, a1, a2, last = -1;
  for (let i = 0; i < x.length; i++) {
    const f = hzAt ? hzAt(i / SAMPLE_RATE) : hz;
    if (f !== last) { const w = 2 * Math.PI * f / SAMPLE_RATE, alpha = Math.sin(w) / (2 * q); b0 = alpha; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * Math.cos(w); a2 = 1 - alpha; last = f; }
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
// A decaying sinusoid (one vibrating mode of a struck body)
export function mode(sec, hz, decaySec, amp = 1, phase = 0) { const b = buffer(sec); for (let i = 0; i < b.length; i++) { const t = i / SAMPLE_RATE; b[i] = amp * Math.sin(2 * Math.PI * hz * t + phase) * Math.exp(-t / decaySec); } return b; }
export const env = (x, fn) => x.map((v, i) => v * fn(i / SAMPLE_RATE));
export function add(target, source, at = 0, gain = 1) { const o = Math.round(at * SAMPLE_RATE); for (let i = 0; i < source.length && o + i < target.length; i++) if (o + i >= 0) target[o + i] += source[i] * gain; return target; }
export const peak = x => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
export function normalize(x, to = 0.89) { const p = peak(x) || 1; return x.map(v => v * to / p); }
export function fade(x, inSec, outSec) { const n = x.length, a = inSec * SAMPLE_RATE, b = outSec * SAMPLE_RATE; return x.map((v, i) => v * Math.min(1, a ? i / a : 1, b ? (n - 1 - i) / b : 1)); }
export const dbToGain = db => 10 ** (db / 20);
export const gainToDb = g => 20 * Math.log10(Math.max(1e-12, g));
export function rms(x, from = 0, to = x.length) { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); }
// Make a loop seamless: crossfade the tail into the head
export function loopable(x, xfadeSec = 0.5) {
  const n = Math.round(xfadeSec * SAMPLE_RATE), out = x.slice(0, x.length - n);
  for (let i = 0; i < n; i++) { const t = i / n; out[i] = x[i] * Math.sqrt(t) + x[x.length - n + i] * Math.sqrt(1 - t); }
  return out;
}
