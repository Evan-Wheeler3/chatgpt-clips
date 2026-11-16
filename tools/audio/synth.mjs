import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_RATE, rng, buffer, white, brown, lowpass, highpass, bandpass, mode, env, add, normalize, fade, loopable } from './dsp.mjs';
import { writeWav } from './wav.mjs';

/*
 * The Hold Up sound library, synthesized locally from physical models (original works, dedicated CC0-1.0).
 * Every asset is reproducible from its generator, parameters and seed; `node tools/audio/synth.mjs` rebuilds audio/sfx/
 * and the catalog entries. Recorded CC0 sounds can be added beside them with tools/audio/import.mjs.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Struck wooden body: a short contact click plus decaying body modes (inharmonic ratios typical of wood)
function woodImpact({seed, f0, decay, click = 0.5, body = 1, duration = 0.9, ratios = [1, 2.31, 3.89, 5.6]}) {
  const r = rng(seed), out = buffer(duration);
  ratios.forEach((k, n) => add(out, mode(duration, f0 * k * (1 + (r() - 0.5) * 0.04), decay / (1 + n * 0.9), body / (1 + n * 0.8), r() * 6)));
  const hit = env(bandpass(white(0.03, r), 1800 + r() * 900, 1.2), t => Math.exp(-t / 0.006));
  add(out, hit, 0, click * 3);
  const thump = env(lowpass(white(0.08, r), 220), t => Math.exp(-t / 0.02));
  add(out, thump, 0, body * 2.5);
  return normalize(fade(out, 0.001, 0.05), 0.89);
}

// Wood creak: stick-slip pulses with a gliding, jittering period, through wooden resonances
function creak({seed, duration = 0.9, fromHz = 28, toHz = 60, resonances = [380, 820, 1650]}) {
  const r = rng(seed), pulses = buffer(duration);
  let t = 0;
  while (t < duration) {
    const u = t / duration, hz = fromHz + (toHz - fromHz) * Math.sin(Math.PI * u * 0.9) + (r() - 0.5) * 8;
    const i = Math.round(t * SAMPLE_RATE); if (i < pulses.length) pulses[i] = 0.6 + r() * 0.4;
    t += 1 / Math.max(8, hz);
  }
  const out = buffer(duration);
  resonances.forEach((hz, n) => add(out, bandpass(pulses, hz * (1 + (r() - 0.5) * 0.06), 9 + n * 3), 0, 1 / (1 + n * 0.6)));
  return normalize(env(out, x => Math.sin(Math.PI * Math.min(1, x / duration)) ** 0.6), 0.85);
}

// Wood dragged/pivoted on stone: grainy band-limited noise with a low rumble
function scrape({seed, duration = 2.4}) {
  const r = rng(seed), grains = buffer(duration);
  for (let g = 0; g < duration * 140; g++) { const at = r() * duration, len = 0.004 + r() * 0.02; add(grains, env(white(len, r), x => Math.sin(Math.PI * x / len)), at, 0.4 + r()); }
  const band = bandpass(grains, 900, 0.8), rumble = lowpass(brown(duration, r), 160);
  const out = buffer(duration); add(out, band, 0, 1); add(out, rumble, 0, 3.5);
  return normalize(fade(highpass(out, 25), 0.12, 0.25), 0.8);
}

// A barrel rolling on cobbles: low rumble, periodic stave knocks and a faint hoop rattle; loops seamlessly
function rollLoop({seed, duration = 2.6, knockEvery = 0.16}) {
  const r = rng(seed), out = buffer(duration + 0.5);
  add(out, lowpass(brown(duration + 0.5, r), 130), 0, 4);
  for (let t = 0.03; t < duration + 0.45; t += knockEvery * (0.85 + r() * 0.3)) add(out, woodImpact({seed:Math.floor(r() * 1e9), f0:150 + r() * 60, decay:0.05, click:0.8, body:0.6, duration:0.12}), t, 0.22 + r() * 0.12);
  add(out, highpass(bandpass(white(duration + 0.5, r), 3200, 3), 1500), 0, 0.05);
  return normalize(loopable(highpass(out, 25), 0.5), 0.8);
}

// A footstep on stone: heel thump + short scuff
function footstep({seed}) {
  const r = rng(seed), out = buffer(0.32);
  add(out, env(lowpass(white(0.12, r), 300 + r() * 120), t => Math.exp(-t / 0.018)), 0, 1.6);
  add(out, mode(0.2, 85 + r() * 25, 0.035, 0.5), 0);
  add(out, env(bandpass(white(0.09, r), 2600 + r() * 1200, 1), t => Math.sin(Math.PI * Math.min(1, t / 0.09)) * 0.6), 0.03 + r() * 0.02, 0.5);
  return normalize(fade(out, 0.0005, 0.05), 0.85);
}

// Cloth rustle (a sleeve or apron moving): fluttering high band noise
function cloth({seed, duration = 0.42}) {
  const r = rng(seed), noise = bandpass(white(duration, r), 2800 + r() * 1400, 0.7);
  const flutter = Array.from({length:12}, () => r());
  return normalize(env(noise, t => Math.sin(Math.PI * t / duration) ** 1.5 * (0.55 + 0.45 * flutter[Math.floor(t / duration * 12) % 12])), 0.8);
}

// Air whoosh for whip pans: noise through a sweeping resonant band
function whoosh({seed, duration = 0.5}) {
  const r = rng(seed), sweep = t => 350 + 1900 * Math.sin(Math.PI * Math.min(1, t / duration)) ** 1.6;
  const out = bandpass(white(duration, r), 0, 1.6, sweep);
  return normalize(env(out, t => Math.sin(Math.PI * Math.min(1, t / duration)) ** 2), 0.8);
}

// Room tone for a large brick workshop: soft low air, a trace of high air, slow drift; seamless loop
function roomTone({seed, duration = 12}) {
  const r = rng(seed), d = duration + 1;
  const low = lowpass(brown(d, r, 0.998), 240), air = lowpass(highpass(white(d, r), 2500), 6000);
  const out = buffer(d); add(out, low, 0, 1); add(out, air, 0, 0.012);
  const drift = Array.from({length:8}, () => 0.8 + r() * 0.4);
  return normalize(loopable(highpass(env(out, t => { const x = t / d * 7, k = Math.floor(x), f = x - k; return drift[k] * (1 - f) + drift[k + 1] * f; }), 25), 1), 0.5);
}

// --- Gas-pump episode (Phase 7B): liquids from a bubble model, metal clicks, air -------------------------------
// A resonating gas bubble (Minnaert): a decaying sinusoid whose pitch rises as the bubble nears the surface
function bubble(hz, decaySec, rise = 0.6) {
  const b = buffer(Math.min(0.25, decaySec * 6));
  let phase = 0;
  for (let i = 0; i < b.length; i++) { const t = i / SAMPLE_RATE; phase += 2 * Math.PI * hz * (1 + rise * t / decaySec) / SAMPLE_RATE; b[i] = Math.sin(phase) * Math.exp(-t / decaySec); }
  return b;
}
// Bubble cloud: Poisson bubbles (radius -> pitch) over turbulent noise; the basis of pours, splashes and gulps
function bubbles(out, r, {from = 0, to, rate, hzLo, hzHi, decay = [0.004, 0.02], gain = 0.5, shape = () => 1}) {
  for (let t = from; t < to; t += -Math.log(1 - r()) / rate) {
    const u = (t - from) / Math.max(1e-6, to - from), hz = hzLo * (hzHi / hzLo) ** r();
    add(out, bubble(hz, decay[0] + (decay[1] - decay[0]) * r(), 0.3 + r() * 0.9), t, gain * shape(u) * (0.4 + r() * 0.6));
  }
  return out;
}
// Fuel gushing out of a filler neck and running over metal and pavement (seamless loop)
function liquidGush({seed, duration = 3}) {
  const r = rng(seed), d = duration + 0.6, out = buffer(d);
  bubbles(out, r, {to:d, rate:520, hzLo:450, hzHi:3800, gain:0.35});
  add(out, bandpass(white(d, r), 1400, 0.5), 0, 0.5);
  add(out, lowpass(brown(d, r), 300), 0, 2.2);
  return normalize(loopable(highpass(out, 40), 0.6), 0.8);
}
// Liquid slapping onto concrete: a broadband burst, then a short bubbly tail
function liquidSplash({seed, duration = 0.9}) {
  const r = rng(seed), out = buffer(duration);
  add(out, env(bandpass(white(duration, r), 2200, 0.6), t => Math.exp(-t / 0.07)), 0, 1.6);
  add(out, env(lowpass(white(0.2, r), 400), t => Math.exp(-t / 0.03)), 0, 2);
  bubbles(out, r, {from:0.02, to:0.6, rate:260, hzLo:600, hzHi:4200, gain:0.4, shape:u => 1 - u});
  return normalize(fade(highpass(out, 30), 0.001, 0.12), 0.85);
}
// A gulp: a few large bubbles with a strong upward glide (the last of the fuel swallowed by the neck)
function liquidGulp({seed}) {
  const r = rng(seed), out = buffer(0.45);
  [0, 0.07, 0.15].forEach((t, n) => add(out, bubble(210 + n * 70 + r() * 40, 0.05 + r() * 0.02, 1.4), t, 1 - n * 0.2));
  add(out, env(lowpass(white(0.25, r), 700), t => Math.exp(-t / 0.05)), 0, 0.4);
  return normalize(fade(highpass(out, 25), 0.002, 0.08), 0.85);
}
// Struck small metal part: inharmonic modes plus a contact tick
function metalHit({seed, modes, decay, tick = 0.6, tickHz = 5200, duration = 0.25}) {
  const r = rng(seed), out = buffer(duration);
  modes.forEach((hz, n) => add(out, mode(duration, hz * (1 + (r() - 0.5) * 0.02), decay / (1 + n * 0.5), 1 / (1 + n * 0.7), r() * 6)));
  add(out, env(bandpass(white(0.01, r), tickHz, 1.5), t => Math.exp(-t / 0.0015)), 0, tick * 4);
  return out;
}
// The nozzle's shut-off CLICK: a sharp latch tick, then the valve's heavier clack 15 ms later
function shutoffClick({seed}) {
  const out = buffer(0.3);
  add(out, metalHit({seed, modes:[2150, 3420, 5710], decay:0.012, tick:0.9, duration:0.08}), 0, 0.8);
  add(out, metalHit({seed:seed + 1, modes:[620, 1180, 1930, 2870], decay:0.035, tick:0.4, tickHz:2600, duration:0.25}), 0.015, 1);
  add(out, env(lowpass(white(0.06, rng(seed + 2)), 220), t => Math.exp(-t / 0.012)), 0.015, 1.2);
  return normalize(fade(out, 0.0003, 0.04), 0.9);
}
// A small metal snick (latch balls slipping, plunger released)
const latchSnick = ({seed}) => normalize(fade(metalHit({seed, modes:[3100, 4800, 7200], decay:0.008, tick:1, tickHz:6500, duration:0.07}), 0.0003, 0.02), 0.85);
// A soft rubbery thump (the diaphragm pulled by the suction)
function rubberThump({seed}) {
  const r = rng(seed), out = buffer(0.25);
  add(out, mode(0.25, 92, 0.06, 1), 0); add(out, mode(0.25, 171, 0.03, 0.4), 0);
  add(out, env(lowpass(white(0.08, r), 450), t => Math.exp(-t / 0.02)), 0, 1.5);
  return normalize(fade(highpass(out, 25), 0.002, 0.05), 0.85);
}
// Air drawn through a small tube: a thin band-limited hiss with gentle flutter (seamless loop)
function airHiss({seed, duration = 3}) {
  const r = rng(seed), d = duration + 0.5, flutter = Array.from({length:Math.ceil(d * 6) + 2}, () => 0.8 + r() * 0.2);
  const out = env(bandpass(highpass(white(d, r), 1500), 4600, 0.9), t => { const x = t * 6, k = Math.floor(x), f = x - k; return flutter[k] * (1 - f) + flutter[k + 1] * f; });
  return normalize(loopable(out, 0.5), 0.6);
}
// The airflow choking off: the hiss narrows and darkens as the hole is covered
function airStop({seed, duration = 0.6}) {
  const r = rng(seed), sweep = t => 4600 * (1 - 0.85 * Math.min(1, t / (duration * 0.7)));
  return normalize(env(bandpass(white(duration, r), 0, 1.2, sweep), t => Math.max(0, 1 - t / (duration * 0.8)) ** 1.5), 0.6);
}
// Outdoor gas-station bed: soft wind, distant traffic swells and a faint canopy-light hum (seamless loop)
function stationBed({seed, duration = 16}) {
  const r = rng(seed), d = duration + 1, out = buffer(d);
  const gust = Array.from({length:Math.ceil(d / 2) + 2}, () => 0.6 + r() * 0.4);
  add(out, env(lowpass(brown(d, r, 0.997), 380), t => { const x = t / 2, k = Math.floor(x), f = x - k; return gust[k] * (1 - f) + gust[k + 1] * f; }), 0, 1);
  for (let t = r() * 3; t < d; t += 4 + r() * 5) { const len = 3 + r() * 3; add(out, env(lowpass(brown(len, r, 0.999), 520), x => Math.sin(Math.PI * x / len) ** 2), t, 0.9 + r() * 0.6); }
  [120, 240, 360].forEach((hz, n) => add(out, mode(d, hz, 1e9, 0.0035 / (n + 1)), 0));
  return normalize(loopable(highpass(out, 25), 1), 0.5);
}

// ---- Seatbelt episode: webbing, retractor, buckle, sled impact, cabin and test-lab air
// Webbing drawn quickly through a guide loop: a short textured zip that rises (pull) or falls (retract)
function webbingZip({seed, duration = 0.32, from = 900, to = 2600, grainHz = 95}) {
  const r = rng(seed), sweep = t => from + (to - from) * Math.min(1, t / duration) ** 0.8;
  const body = bandpass(white(duration, r), 0, 1.3, sweep);
  return normalize(fade(env(body, t => (0.55 + 0.45 * Math.sin(2 * Math.PI * grainHz * t * (0.6 + t / duration))) * Math.sin(Math.PI * Math.min(1, t / duration)) ** 0.7), 0.004, 0.05), 0.8);
}
// The retractor locking: the pawl hits a tooth (a hard steel clack), the housing answers, the webbing snaps taut
function retractorClank({seed, weight = 1}) {
  const out = buffer(0.42);
  add(out, metalHit({seed, modes:[1480, 2360, 3890, 5200], decay:0.014, tick:1, tickHz:4200, duration:0.1}), 0, 0.9);
  add(out, metalHit({seed:seed + 1, modes:[410 / weight, 930 / weight, 1620, 2480], decay:0.045 * weight, tick:0.3, tickHz:1800, duration:0.38}), 0.004, 1);
  add(out, mode(0.3, 118 / weight, 0.035 * weight, 0.9), 0.004);
  add(out, env(bandpass(white(0.09, rng(seed + 2)), 700, 1.1), t => Math.exp(-t / 0.018)), 0.01, 0.7);
  return normalize(fade(highpass(out, 30), 0.0003, 0.06), 0.9);
}
// A buckle: the tongue slides in (a light tick), then the latch snaps home
function buckleClick({seed}) {
  const out = buffer(0.36);
  add(out, metalHit({seed, modes:[2900, 4700, 6900], decay:0.008, tick:0.9, tickHz:6000, duration:0.06}), 0, 0.5);
  add(out, metalHit({seed:seed + 1, modes:[820, 1710, 2950, 4300], decay:0.03, tick:0.6, tickHz:3200, duration:0.28}), 0.07, 1);
  add(out, mode(0.2, 190, 0.02, 0.5), 0.07);
  return normalize(fade(out, 0.0003, 0.05), 0.88);
}
// The spool turning freely: light ticks of the mechanism over a soft whirr, speeding up then easing
function spoolWhirr({seed, duration = 1.6}) {
  const r = rng(seed), out = buffer(duration);
  add(out, env(bandpass(white(duration, r), 0, 2.2, t => 500 + 700 * Math.sin(Math.PI * Math.min(1, t / duration))), t => 0.35 * Math.sin(Math.PI * Math.min(1, t / duration)) ** 1.2), 0);
  for (let t = 0.05, k = 0; t < duration - 0.08; k++) { const u = t / duration, gap = 0.11 - 0.06 * Math.sin(Math.PI * u); add(out, metalHit({seed:seed + 3 + k, modes:[2400 + 300 * r(), 4100, 6300], decay:0.006, tick:0.7, tickHz:5200, duration:0.04}), t, 0.28 + 0.2 * Math.sin(Math.PI * u)); t += gap; }
  return normalize(fade(out, 0.02, 0.12), 0.7);
}
// A sled meeting its barrier, kept short and dry: a low body thump, a crunch of panels, a brief rattle
function sledImpact({seed}) {
  const r = rng(seed), out = buffer(1.1);
  add(out, mode(0.8, 54, 0.11, 1.2), 0); add(out, mode(0.6, 97, 0.07, 0.7), 0);
  add(out, env(lowpass(white(0.35, r), 900), t => Math.exp(-t / 0.05)), 0, 1.4);
  add(out, env(bandpass(white(0.5, r), 2400, 0.9), t => Math.exp(-t / 0.09) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 31 * t))), 0.01, 0.35);
  add(out, metalHit({seed:seed + 5, modes:[330, 760, 1340, 2210], decay:0.09, tick:0.2, tickHz:1500, duration:0.6}), 0.012, 0.55);
  for (let k = 0; k < 5; k++) add(out, metalHit({seed:seed + 9 + k, modes:[1900 + 500 * r(), 3300, 5100], decay:0.012, tick:0.5, tickHz:4000, duration:0.06}), 0.12 + k * 0.07 + r() * 0.03, 0.16 / (1 + k * 0.5));
  return normalize(fade(highpass(out, 28), 0.0005, 0.25), 0.9);
}
// Air inside a parked car: close, soft and slightly boxy; or a large test hall: wider, with a faint ventilation tone
function airBed({seed, duration = 12, lowHz = 180, tone = 0, level = 1}) {
  const r = rng(seed), d = duration + 1, out = buffer(d);
  add(out, lowpass(brown(d, r), lowHz), 0, 1); add(out, lowpass(highpass(white(d, r), 2500), 6000), 0, 0.012 * level);
  if (tone) [tone, tone * 2.01].forEach((hz, n) => add(out, mode(d, hz, 1e9, 0.004 / (n + 1)), 0));
  return normalize(loopable(env(highpass(out, 30), t => 1 + 0.12 * Math.sin(2 * Math.PI * t / 5.3)), 1), 0.5);
}

// ---- School-bus episode: engines, brakes, a projector, paper swatches, a paint can
// A diesel bus idling or pulling in: a low firing pulse with harmonics and mechanical clatter (seamless loop)
function dieselLoop({seed, duration = 6, fire = 28, level = 1}) {
  const r = rng(seed), d = duration + 1, out = buffer(d);
  [1, 2, 3, 4.02, 6.1].forEach((k, n) => add(out, mode(d, fire * k, 1e9, 0.5 / (n + 1)), 0));
  add(out, env(bandpass(white(d, r), 1400, 1.2), t => 0.25 * (0.5 + 0.5 * Math.sin(2 * Math.PI * fire * t)) ** 6), 0);
  add(out, lowpass(brown(d, r), 160), 0, 2.5 * level);
  return normalize(loopable(env(highpass(out, 25), t => 1 + 0.06 * Math.sin(2 * Math.PI * 0.7 * t)), 1), 0.6);
}
// An older petrol engine: lumpier, higher, with a little tappet tick (seamless loop)
function oldEngineLoop({seed, duration = 6}) {
  const r = rng(seed), d = duration + 1, out = buffer(d);
  for (let t = 0, k = 0; t < d; k++) { const gap = 1 / 22 * (1 + 0.12 * (r() - 0.5)); add(out, env(lowpass(white(0.05, r), 300), u => Math.exp(-u / 0.012)), t, 0.9); if (k % 2) add(out, metalHit({seed:seed + k, modes:[3100, 4700], decay:0.004, tick:0.4, duration:0.02}), t + 0.01, 0.08); t += gap; }
  add(out, lowpass(brown(d, r), 220), 0, 1.5);
  return normalize(loopable(highpass(out, 30), 1), 0.6);
}
// An air brake: a sharp hiss that tails off
function airBrake({seed}) {
  const r = rng(seed), out = buffer(1.1);
  add(out, env(bandpass(white(1.1, r), 3800, 0.7), t => (t < 0.02 ? t / 0.02 : Math.exp(-(t - 0.02) / 0.28))), 0, 1);
  add(out, env(highpass(white(0.4, r), 6000), t => Math.exp(-t / 0.08)), 0, 0.4);
  return normalize(fade(out, 0.001, 0.2), 0.85);
}
// A film projector: shutter clatter at 24 per second over a motor whirr (seamless loop)
function projectorLoop({seed, duration = 4}) {
  const r = rng(seed), d = duration + 1, out = buffer(d);
  for (let t = 0; t < d; t += 1 / 24) add(out, env(bandpass(white(0.02, r), 2600 + 400 * r(), 2), u => Math.exp(-u / 0.004)), t, 0.6 + 0.2 * r());
  add(out, mode(d, 96, 1e9, 0.08), 0); add(out, lowpass(white(d, r), 900), 0, 0.15);
  return normalize(loopable(highpass(out, 60), 0.5), 0.55);
}
// A paper card flicked down onto a table
function cardFlick({seed}) {
  const r = rng(seed), out = buffer(0.18);
  add(out, env(bandpass(white(0.18, r), 2400 + 900 * r(), 1.4), t => Math.exp(-t / 0.025)), 0, 1);
  add(out, mode(0.1, 420 + 80 * r(), 0.012, 0.3), 0.004);
  return normalize(fade(out, 0.0005, 0.03), 0.8);
}
// Paper slid across wood
function paperSlide({seed, duration = 0.5}) {
  const r = rng(seed), body = bandpass(white(duration, r), 0, 1.1, t => 1500 + 1200 * t / duration);
  return normalize(fade(env(body, t => Math.sin(Math.PI * Math.min(1, t / duration)) ** 1.4), 0.01, 0.06), 0.7);
}
// A paint can lid levered off: a tight metal pop and a ring
function lidPop({seed}) {
  const out = buffer(0.6);
  add(out, metalHit({seed, modes:[1240, 2980, 4410, 6200], decay:0.06, tick:1, tickHz:5200, duration:0.55}), 0, 1);
  add(out, mode(0.2, 180, 0.02, 0.6), 0);
  return normalize(fade(out, 0.0004, 0.08), 0.85);
}
// A wall clock running fast: dry ticks
function clockTicks({seed, duration = 2, rate = 9}) {
  const out = buffer(duration);
  for (let t = 0.02, k = 0; t < duration - 0.04; t += 1 / rate, k++) add(out, metalHit({seed:seed + k, modes:[2700, 4300], decay:0.003, tick:0.8, tickHz:5800, duration:0.03}), t, k % 2 ? 0.6 : 0.85);
  return normalize(out, 0.7);
}

const generated = (generator, params) => ({type:'generated', generator:`tools/audio/synth.mjs#${generator}`, params});
const LICENSE = {license:'CC0-1.0', licenseEvidence:'Original synthesis by the Hold Up pipeline (tools/audio/synth.mjs); dedicated to the public domain under CC0 1.0', author:'Hold Up (generated)'};

// The library: id -> {make, meta}. Several variants per everyday sound, so repeats never sound identical
export const LIBRARY = [
  {id:'barrel-thud', category:'impact', description:'A heavy, hollow wooden barrel being shoved or set down', make:() => woodImpact({seed:11, f0:92, decay:0.32, click:0.45, body:1.2}), params:{f0:92, decay:0.32}, gainDb:-4},
  {id:'wood-knock-light', category:'impact', description:'A light knock on wood (a hand on a barrel, a small bump)', make:() => woodImpact({seed:12, f0:390, decay:0.06, click:0.9, body:0.5, duration:0.35}), params:{f0:390, decay:0.06}, gainDb:-10},
  {id:'wood-tok', category:'comedic', description:'A crisp wooden "tok" for comedic emphasis', make:() => woodImpact({seed:13, f0:880, decay:0.03, click:1, body:0.35, duration:0.2, ratios:[1, 2.76]}), params:{f0:880}, gainDb:-12},
  ...[1, 2, 3].map(n => ({id:`wood-creak-${n}`, category:'wood', description:`A short wooden creak (variant ${n})`, make:() => creak({seed:20 + n, duration:0.7 + n * 0.15, fromHz:24 + n * 4, toHz:52 + n * 6}), params:{variant:n}, gainDb:-16})),
  {id:'barrel-scrape', category:'movement', description:'A wooden barrel pivoting or dragging on stone', make:() => scrape({seed:31}), params:{duration:2.4}, gainDb:-12},
  {id:'barrel-roll-loop', category:'movement', description:'A barrel rolling over cobbles (seamless loop; follow the barrel speed)', make:() => rollLoop({seed:41}), params:{knockEvery:0.16}, gainDb:-10, loop:true},
  ...[1, 2, 3, 4].map(n => ({id:`footstep-stone-${n}`, category:'footsteps', description:`A footstep on stone (variant ${n})`, make:() => footstep({seed:50 + n}), params:{variant:n}, gainDb:-18})),
  ...[1, 2, 3].map(n => ({id:`cloth-rustle-${n}`, category:'clothing', description:`Clothing movement for a gesture (variant ${n})`, make:() => cloth({seed:60 + n, duration:0.34 + n * 0.05}), params:{variant:n}, gainDb:-24})),
  {id:'whoosh-soft', category:'transition', description:'A soft air whoosh for a whip pan', make:() => whoosh({seed:71}), params:{duration:0.5}, gainDb:-16},
  {id:'room-tone-workshop', category:'ambience', description:'Quiet room tone of a large brick workshop (seamless loop)', make:() => roomTone({seed:81}), params:{duration:12}, gainDb:-20, loop:true},
  // Gas-pump episode: synthesized alternatives, compared by ear with CC0 recordings before the owner chooses (Phase 7B, E1)
  {id:'fuel-gush-loop-synth', category:'liquid', description:'Fuel gushing out of a filler neck and running down (bubble-model synthesis; seamless loop)', make:() => liquidGush({seed:91}), params:{duration:3}, gainDb:-12, loop:true},
  {id:'fuel-splash-synth', category:'liquid', description:'Liquid slapping onto concrete (bubble-model synthesis)', make:() => liquidSplash({seed:92}), params:{duration:0.9}, gainDb:-10},
  {id:'fuel-gulp-synth', category:'liquid', description:'A short gulp as the last fuel is swallowed back into the filler neck', make:() => liquidGulp({seed:93}), params:{}, gainDb:-12},
  {id:'nozzle-click-synth', category:'mechanism', description:'A fuel nozzle shut-off click: latch tick then valve clack', make:() => shutoffClick({seed:94}), params:{}, gainDb:-6},
  {id:'latch-release-synth', category:'mechanism', description:'A small metal snick (latch balls slip, plunger released)', make:() => latchSnick({seed:96}), params:{}, gainDb:-16},
  {id:'diaphragm-flex-synth', category:'mechanism', description:'A soft rubbery thump (a diaphragm pulled by suction)', make:() => rubberThump({seed:97}), params:{}, gainDb:-14},
  {id:'air-suction-loop-synth', category:'air', description:'Air drawn through a small tube: a thin hiss (seamless loop)', make:() => airHiss({seed:98}), params:{duration:3}, gainDb:-22, loop:true},
  {id:'air-stop-synth', category:'air', description:'An airflow choking off as an opening is covered', make:() => airStop({seed:99}), params:{duration:0.6}, gainDb:-22},
  {id:'ambience-gas-station-synth', category:'ambience', description:'Outdoor gas station: soft wind, distant traffic swells, faint canopy hum (seamless loop)', make:() => stationBed({seed:100}), params:{duration:16}, gainDb:-24, loop:true},
  // Seatbelt episode
  {id:'seatbelt-pull-synth', category:'mechanism', description:'Seatbelt webbing pulled quickly through its guide loop', make:() => webbingZip({seed:110}), params:{duration:0.32}, gainDb:-16},
  {id:'seatbelt-pull-long-synth', category:'mechanism', description:'Seatbelt webbing drawn out smoothly, a long even pull', make:() => webbingZip({seed:111, duration:0.9, from:700, to:1500, grainHz:60}), params:{duration:0.9}, gainDb:-20},
  {id:'seatbelt-retract-synth', category:'mechanism', description:'Seatbelt webbing reeling back a short way', make:() => webbingZip({seed:112, duration:0.3, from:2100, to:800, grainHz:80}), params:{duration:0.3}, gainDb:-21},
  ...[1, 2, 3].map(n => ({id:`seatbelt-lock-clank-${n}`, category:'mechanism', description:`A seatbelt retractor locking: pawl on tooth, housing knock, webbing snapping taut (variant ${n})`, make:() => retractorClank({seed:120 + n * 4, weight:1 + (n - 1) * 0.07}), params:{variant:n}, gainDb:-7})),
  {id:'retractor-pawl-lock-synth', category:'mechanism', description:'The retractor pawl dropping into the ratchet, heard from inside the housing: heavier and closer', make:() => retractorClank({seed:140, weight:1.35}), params:{weight:1.35}, gainDb:-6},
  {id:'retractor-spool-whirr-synth', category:'mechanism', description:'A belt spool turning freely: light ticking over a soft whirr', make:() => spoolWhirr({seed:150}), params:{duration:1.6}, gainDb:-18},
  {id:'seatbelt-buckle-click-synth', category:'mechanism', description:'A seatbelt tongue sliding into its buckle and latching', make:() => buckleClick({seed:160}), params:{}, gainDb:-8},
  {id:'sled-impact-synth', category:'impact', description:'A crash-test sled stopping against its barrier: low thump, panel crunch, brief rattle (restrained)', make:() => sledImpact({seed:170}), params:{}, gainDb:-7},
  {id:'ambience-car-interior-synth', category:'ambience', description:'Air inside a parked car: close and soft (seamless loop)', make:() => airBed({seed:180, lowHz:160}), params:{duration:12}, gainDb:-26, loop:true},
  {id:'ambience-test-lab-synth', category:'ambience', description:'A large test hall: wide room air with a faint ventilation tone (seamless loop)', make:() => airBed({seed:181, lowHz:240, tone:120, level:1.6}), params:{duration:12}, gainDb:-25, loop:true},
  // School-bus episode
  {id:'bus-diesel-loop-synth', category:'mechanism', description:'A modern diesel school bus idling or pulling in (seamless loop)', make:() => dieselLoop({seed:200}), params:{fire:28}, gainDb:-16, loop:true},
  {id:'bus-1930s-engine-loop-synth', category:'mechanism', description:'A 1930s petrol bus engine running: lumpy, with tappet ticks (seamless loop)', make:() => oldEngineLoop({seed:201}), params:{}, gainDb:-18, loop:true},
  {id:'bus-air-brake-synth', category:'mechanism', description:'A bus air brake releasing: sharp hiss tailing off', make:() => airBrake({seed:202}), params:{}, gainDb:-12},
  {id:'film-projector-loop-synth', category:'ambience', description:'An old film projector: shutter clatter over a motor whirr (seamless loop)', make:() => projectorLoop({seed:203}), params:{}, gainDb:-24, loop:true},
  ...[1, 2, 3].map(n => ({id:`card-flick-${n}`, category:'movement', description:`A paper card flicked onto a table (variant ${n})`, make:() => cardFlick({seed:210 + n}), params:{variant:n}, gainDb:-16})),
  {id:'paper-slide-synth', category:'movement', description:'A sheet of paper slid across a wooden table', make:() => paperSlide({seed:215}), params:{duration:0.5}, gainDb:-18},
  {id:'paint-lid-pop-synth', category:'mechanism', description:'A paint can lid levered off: metal pop and ring', make:() => lidPop({seed:216}), params:{}, gainDb:-10},
  {id:'clock-ticks-fast-synth', category:'mechanism', description:'A wall clock ticking quickly (time passing)', make:() => clockTicks({seed:217}), params:{rate:9}, gainDb:-20}
];

export async function buildLibrary({dir = join(root, 'audio'), catalogFile = join(root, 'audio/catalog.json')} = {}) {
  await mkdir(join(dir, 'sfx'), {recursive:true});
  const existing = JSON.parse(await readFile(catalogFile, 'utf8').catch(() => '{"assets":[]}'));
  const keep = existing.assets.filter(a => a.source?.type !== 'generated');
  const assets = [];
  for (const item of LIBRARY) {
    const samples = item.make(), file = `sfx/${item.id}.wav`;
    await writeWav(join(dir, file), samples);
    assets.push({id:item.id, description:item.description, category:item.category, file:`audio/${file}`, durationSec:+(samples.length / SAMPLE_RATE).toFixed(3), sampleRate:SAMPLE_RATE, channels:1,
      source:generated(item.make.toString().match(/=> (\w+)\(/)?.[1] ?? 'synth', item.params), ...LICENSE, status:'approved',
      review:'Approved for use as an original generated asset; listen-through by the owner pending', gainDb:item.gainDb, loop:item.loop ? {seamless:true} : null,
      sha256:createHash('sha256').update(await readFile(join(dir, file))).digest('hex')});
  }
  const catalog = {note:'Hold Up audio catalog. Generated assets come from tools/audio/synth.mjs; imported recordings from tools/audio/import.mjs (with license evidence).', assets:[...assets, ...keep]};
  await writeFile(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  return catalog;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildLibrary().then(c => process.stdout.write(c.assets.map(a => `${a.id.padEnd(22)} ${a.category.padEnd(11)} ${a.durationSec}s`).join('\n') + '\n'));
}
