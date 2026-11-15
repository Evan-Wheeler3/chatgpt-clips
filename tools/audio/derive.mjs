import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLE_RATE, fade } from './dsp.mjs';
import { writeWav, decodeAudio } from './wav.mjs';
import { ROOT, CATALOG, loadCatalog, validateCatalog } from './catalog.mjs';

/*
 * Derived sounds: an existing catalog asset transformed by a recorded list of operations (for example the overflow
 * played backwards for the rewind). The derived asset inherits the source's license, evidence, author, attribution and
 * review status, and records exactly where it came from, so it can be rebuilt and audited.
 *   ops: {trim:[fromSec, toSec]} | {reverse:true} | {speed:k} (resample: k > 1 is faster and higher) | {fade:[inSec, outSec]} | {gainDb:x}
 *   node tools/audio/derive.mjs --from <asset> --id <new id> --ops '<json array>' [--description "..."]
 */
export function applyOps(samples, ops) {
  let x = samples;
  for (const op of ops) {
    if (op.trim) {
      const [a, b] = op.trim.map(s => Math.round(s * SAMPLE_RATE));
      if (!(a >= 0 && b > a && b <= x.length)) throw new Error(`trim ${op.trim} is outside the source (${(x.length / SAMPLE_RATE).toFixed(3)} s)`);
      x = x.slice(a, b);
    } else if (op.reverse) x = x.slice().reverse();
    else if (op.speed) {
      if (!(op.speed > 0.25 && op.speed < 4)) throw new Error('speed must be between 0.25 and 4');
      const n = Math.floor((x.length - 1) / op.speed), y = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = i * op.speed, k = Math.floor(p), f = p - k; y[i] = x[k] * (1 - f) + x[Math.min(x.length - 1, k + 1)] * f; }
      x = y;
    } else if (op.fade) x = fade(x, op.fade[0], op.fade[1]);
    else if (op.gainDb !== undefined) { const g = 10 ** (op.gainDb / 20); x = x.map(v => v * g); }
    else throw new Error(`Unknown derive operation: ${JSON.stringify(op)}`);
  }
  return x;
}

export async function deriveAsset({from, id, ops, description = null, root = ROOT, catalogFile = CATALOG}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) throw new Error(`Invalid asset id: ${id}`);
  const catalog = await loadCatalog(catalogFile);
  const source = catalog.assets.find(a => a.id === from);
  if (!source) throw new Error(`No source asset "${from}" in the audio catalog`);
  if (source.status !== 'approved') throw new Error(`Source asset "${from}" is not approved (${source.status})`);
  const [mono] = await decodeAudio(join(root, source.file), {channels:1});
  const samples = applyOps(mono, ops), file = `audio/sfx/${id}.wav`;
  await writeWav(join(root, file), samples);
  const {id:_id, file:_file, durationSec:_d, sha256:_s, source:_src, description:_desc, loop:_loop, ...inherited} = source;
  const asset = {id, description:description ?? `${source.description} (derived: ${ops.map(o => Object.keys(o)[0]).join(', ')})`, ...inherited,
    file, durationSec:+(samples.length / SAMPLE_RATE).toFixed(3), sampleRate:SAMPLE_RATE, channels:1, loop:null,
    source:{type:'derived', from, fromSha256:source.sha256, ops}, sha256:createHash('sha256').update(await readFile(join(root, file))).digest('hex')};
  const assets = [...catalog.assets.filter(a => a.id !== id), asset];
  const next = {...catalog, assets};
  const problems = await validateCatalog(next, {root});
  if (problems.length) throw new Error(`Derived catalog is invalid: ${JSON.stringify(problems)}`);
  await writeFile(catalogFile, JSON.stringify(next, null, 2) + '\n');
  return asset;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  deriveAsset({from:opt('--from'), id:opt('--id'), ops:JSON.parse(opt('--ops') ?? '[]'), description:opt('--description')})
    .then(a => process.stdout.write(`${a.id}: ${a.durationSec}s from ${a.source.from} (${a.license})\n`)).catch(err => { console.error(err.message); process.exitCode = 1; });
}
