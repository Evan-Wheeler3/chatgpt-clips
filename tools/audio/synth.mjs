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
  {id:'room-tone-workshop', category:'ambience', description:'Quiet room tone of a large brick workshop (seamless loop)', make:() => roomTone({seed:81}), params:{duration:12}, gainDb:-20, loop:true}
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
