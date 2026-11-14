// Named easing curves for camera moves and prop actions. Linear is available but flagged by validation
// for camera moves, because constant-velocity drift reads as mechanical rather than motivated.
const clamp01 = t => Math.min(1, Math.max(0, t));

function cubicBezier(x1, y1, x2, y2) {
  const sample = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
  return x => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 30; i++) {
      t = (lo + hi) / 2;
      if (sample(x1, x2, t) < x) lo = t; else hi = t;
    }
    return sample(y1, y2, t);
  };
}

export const EASINGS = {
  linear:t => t,
  sine:t => -(Math.cos(Math.PI * t) - 1) / 2,
  cubic:t => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  quint:t => t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2,
  // Starts at full speed: for moves that begin on a cut, not from a hold (validation flags the jolt otherwise)
  out:t => 1 - (1 - t) ** 3,
  // Slow build into a hard stop: tension into a reveal
  in:t => t ** 3,
  expo:t => t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  // Soft start, slight overshoot, then settles, like an operator catching the frame
  settle:cubicBezier(0.4, 0, 0.2, 1.3),
  // Small pull back before committing to the move
  anticipate:t => { const c = 1.1; return t * t * ((c + 1) * t - c); },
  // Whip pans: almost all rotation happens in the middle third
  whip:cubicBezier(0.7, 0, 0.3, 1),
  // Film-style ease for dolly moves
  dolly:cubicBezier(0.45, 0, 0.2, 1)
};

export function ease(name, t) {
  const fn = EASINGS[name ?? 'cubic'];
  if (!fn) throw new Error(`Unknown easing: ${name}`);
  return fn(clamp01(t));
}

export const isEasing = name => Object.hasOwn(EASINGS, name);
