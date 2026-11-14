import { readFile, writeFile, mkdir, statfs, access, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { totalmem, tmpdir } from 'node:os';

/*
 * Local voice cloning: engine install, voice enrollment and status. Everything runs on the Mac, for free:
 *   engine     Qwen3-TTS 0.6B Base (Apache-2.0 code and weights) through mlx-audio (MIT) on Apple Silicon (MLX)
 *   install    a private Python environment and the model in .cache/voice/ (gitignored); after that, generation is offline
 *   enroll     the owner's reference recording + transcript in voices/private/<id>/ (gitignored), with recorded consent
 */
const run = promisify(execFile);
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const VOICE_DIR = resolve(ROOT, '.cache/voice');
export const PRIVATE_DIR = resolve(ROOT, 'voices/private');
export const WORKER = resolve(ROOT, 'tools/narration/local/clone_worker.py');
const GB = 1024 ** 3;

// Engines this Mac can run. Sizes from the official Hugging Face listings (read 2026-11-14); the MLX conversion's exact
// size is confirmed at install time and recorded in the manifest
export const ENGINES = {
  'qwen3-tts':{
    name:'Qwen3-TTS 0.6B Base (voice cloning)', repo:'mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16', runtime:'mlx-audio',
    license:{code:'Apache-2.0 (QwenLM/Qwen3-TTS)', weights:'Apache-2.0 (Qwen/Qwen3-TTS-12Hz-0.6B-Base model card)', runtime:'MIT (mlx-audio)'},
    downloadGB:2.6, environmentGB:1.5, ramGB:3, transcriptRequired:true,
    controls:{styleInstructions:false, speed:false, pitch:false, note:'The Base (cloning) model documents no instruction, speed or pitch control; only sampling settings that generate() actually names are applied'}
  }
};
export const DEFAULT_ENGINE = 'qwen3-tts';
// Word timing for local takes: forced alignment of the known script (whisper.cpp remains the fallback)
export const ALIGNER = {name:'Qwen3-ForcedAligner 0.6B (8-bit MLX)', repo:'mlx-community/Qwen3-ForcedAligner-0.6B-8bit', license:'Apache-2.0 (model card)', downloadGB:1.28};
export const REFERENCE = {minSec:3, maxSec:60, recommended:[10, 20], sampleRate:24000};
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;

export const paths = (voiceDir = VOICE_DIR) => ({venv:join(voiceDir, 'venv'), python:join(voiceDir, 'venv/bin/python'), models:join(voiceDir, 'models'), manifest:join(voiceDir, 'manifest.json')});
const exists = path => access(path).then(() => true, () => false);
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
// Free space on the volume that will hold `path` (measured at its nearest existing parent)
export async function freeDiskGB(path = ROOT) {
  for (let p = path; ; p = dirname(p)) { const s = await statfs(p).catch(() => null); if (s) return s.bavail * s.bsize / GB; if (p === dirname(p)) throw new Error(`Cannot measure free disk for ${path}`); }
}
async function dirSizeGB(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, {withFileTypes:true, recursive:true})) if (entry.isFile()) bytes += (await stat(join(entry.parentPath ?? entry.path, entry.name))).size;
  return bytes / GB;
}

export async function manifest(voiceDir = VOICE_DIR) { return readJson(paths(voiceDir).manifest).catch(() => null); }

export async function installPlan(engine = DEFAULT_ENGINE, {voiceDir = VOICE_DIR} = {}) {
  const e = ENGINES[engine];
  if (!e) throw new Error(`Unknown engine "${engine}" (${Object.keys(ENGINES).join(', ')})`);
  const needGB = e.downloadGB + e.environmentGB, free = await freeDiskGB(voiceDir);
  return {engine, model:e.repo, license:e.license, downloadGB:e.downloadGB, environmentGB:e.environmentGB, needGB:+needGB.toFixed(1), freeDiskGB:+free.toFixed(1),
    freeAfterGB:+(free - needGB).toFixed(1), ramGB:e.ramGB, machineRamGB:Math.round(totalmem() / GB), fits:free - needGB >= 1, installed:!!(await manifest(voiceDir))};
}

// One-time install (network). Needs --yes: it downloads several GB
// Adds the forced aligner to an existing install (about 1.3 GB; needs --yes)
export async function installAligner({voiceDir = VOICE_DIR, yes = false, log = console.error} = {}) {
  const m = await manifest(voiceDir), free = await freeDiskGB(voiceDir);
  if (!m) throw new Error('Install the voice engine first (node tools/narration/voice.mjs install)');
  const plan = {aligner:ALIGNER.repo, license:ALIGNER.license, downloadGB:ALIGNER.downloadGB, freeDiskGB:+free.toFixed(1), fits:free - ALIGNER.downloadGB >= 1};
  if (!yes) return {...plan, status:'plan-only', next:'re-run with --yes to download'};
  if (!plan.fits) throw new Error(`Not enough free disk for the aligner (${plan.freeDiskGB} GB free)`);
  const p = paths(voiceDir), modelDir = join(p.models, ALIGNER.repo.replace('/', '--'));
  log(`downloading ${ALIGNER.repo}`);
  await run(p.python, ['-c', `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(ALIGNER.repo)}, local_dir=${JSON.stringify(modelDir)})`], {maxBuffer:64 * 1024 * 1024});
  const record = {...m, aligner:{repo:ALIGNER.repo, modelDir, license:ALIGNER.license, sizeGB:+(await dirSizeGB(modelDir)).toFixed(2), installedAt:new Date().toISOString()}};
  await writeFile(p.manifest, JSON.stringify(record, null, 2) + '\n');
  return {...record.aligner, status:'installed'};
}

export async function install({engine = DEFAULT_ENGINE, voiceDir = VOICE_DIR, python = process.env.HOLDUP_PYTHON ?? '/opt/homebrew/bin/python3.12', yes = false, log = console.error} = {}) {
  const plan = await installPlan(engine, {voiceDir});
  if (!yes) return {...plan, status:'plan-only', next:'re-run with --yes to download and install'};
  if (!plan.fits) throw new Error(`Not enough free disk: need about ${plan.needGB} GB plus 1 GB headroom, ${plan.freeDiskGB} GB free`);
  const p = paths(voiceDir);
  await mkdir(p.models, {recursive:true});
  log(`creating Python environment (${python})`);
  await run(python, ['-m', 'venv', p.venv]);
  log('installing mlx-audio and dependencies');
  await run(p.python, ['-m', 'pip', 'install', '--upgrade', 'pip'], {maxBuffer:64 * 1024 * 1024});
  await run(p.python, ['-m', 'pip', 'install', 'mlx-audio', 'soundfile', 'numpy', 'huggingface_hub'], {maxBuffer:64 * 1024 * 1024});
  const e = ENGINES[engine], modelDir = join(p.models, e.repo.replace('/', '--'));
  log(`downloading ${e.repo}`);
  await run(p.python, ['-c', `from huggingface_hub import snapshot_download; snapshot_download(${JSON.stringify(e.repo)}, local_dir=${JSON.stringify(modelDir)})`], {maxBuffer:64 * 1024 * 1024});
  const {stdout:versions} = await run(p.python, ['-c', 'import json; from importlib.metadata import version as v; print(json.dumps({k: v(k) for k in ["mlx-audio", "mlx", "numpy", "soundfile"]}))']);
  const record = {engine, repo:e.repo, modelDir, license:e.license, packages:JSON.parse(versions), modelSizeGB:+(await dirSizeGB(modelDir)).toFixed(2), environmentSizeGB:+(await dirSizeGB(p.venv)).toFixed(2), installedAt:new Date().toISOString()};
  await writeFile(p.manifest, JSON.stringify(record, null, 2) + '\n');
  return {...record, status:'installed'};
}

/*
 * Enroll a voice the user owns: a short clean recording and its transcript (Qwen3-TTS cloning needs both).
 * The transcript can be typed or measured with the existing whisper.cpp aligner.
 */
export async function enroll({id, audio, owner, consent, transcript = null, engine = DEFAULT_ENGINE, privateDir = PRIVATE_DIR, transcribe = null}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id ?? '')) throw new Error('--id must be lowercase letters, digits and dashes');
  if (NOT_A_PERSON.test(String(owner ?? '').trim())) throw new Error('--owner must name the person whose voice this is');
  if (!consent || String(consent).trim().length < 10) throw new Error('--consent must state that the owner records and permits cloning of their own voice');
  const {stdout} = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]).catch(() => ({stdout:''}));
  const durationSec = Number(stdout.trim());
  if (!(durationSec > 0)) throw new Error(`${audio} is not a readable audio file`);
  if (durationSec < REFERENCE.minSec || durationSec > REFERENCE.maxSec) throw new Error(`The reference is ${durationSec.toFixed(1)} s; use ${REFERENCE.minSec}-${REFERENCE.maxSec} s (best ${REFERENCE.recommended.join('-')} s of clean, natural speech)`);
  const dir = join(privateDir, id);
  await mkdir(dir, {recursive:true});
  const reference = join(dir, 'reference.wav');
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', audio, '-ac', '1', '-ar', String(REFERENCE.sampleRate), '-c:a', 'pcm_s16le', reference]);
  let transcriptSource = 'typed';
  if (!transcript) {
    if (!transcribe) throw new Error('Provide --transcript "<exact words in the recording>" (or install whisper for automatic transcription)');
    transcript = await transcribe(reference); transcriptSource = 'whisper.cpp (check it)';
  }
  const voice = {id, owner:String(owner).trim(), consent:String(consent).trim(), enrolledOn:new Date().toISOString().slice(0, 10), engine,
    reference:{file:'reference.wav', sha256:createHash('sha256').update(await readFile(reference)).digest('hex'), durationSec:+durationSec.toFixed(2), sampleRate:REFERENCE.sampleRate},
    transcript, transcriptSource, warnings:durationSec < REFERENCE.recommended[0] ? [`Short reference (${durationSec.toFixed(1)} s); ${REFERENCE.recommended.join('-')} s usually clones better`] : []};
  await writeFile(join(dir, 'voice.json'), JSON.stringify(voice, null, 2) + '\n');
  // A reusable profile for this voice (kept with the private data; the committed narrator profile only names the id)
  const profile = {name:`${owner} (cloned)`, provider:'local-clone', engine, voice:id, settings:{}, seed:1873, delivery:{minPauseMs:300, pauseScale:1}, status:'enrolled'};
  await writeFile(join(dir, 'profile.json'), JSON.stringify(profile, null, 2) + '\n');
  return voice;
}

export async function loadVoice(id, privateDir = PRIVATE_DIR) {
  const dir = join(privateDir, id), voice = await readJson(join(dir, 'voice.json')).catch(() => null);
  if (!voice) throw new Error(`No enrolled voice "${id}"; record a reference and run: node tools/narration/voice.mjs enroll --id ${id} --audio <file> --owner "<name>" --consent "<statement>"`);
  return {...voice, referencePath:join(dir, voice.reference.file)};
}

export async function status({voiceDir = VOICE_DIR, privateDir = PRIVATE_DIR} = {}) {
  const voices = await readdir(privateDir).catch(() => []);
  return {plan:await installPlan(DEFAULT_ENGINE, {voiceDir}), manifest:await manifest(voiceDir), enrolled:voices.filter(v => !v.startsWith('.'))};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  const go = async () => {
    if (command === 'status') return print(await status());
    if (command === 'install') return print(rest.includes('--aligner') ? await installAligner({yes:rest.includes('--yes')}) : await install({engine:opt('--engine') ?? DEFAULT_ENGINE, yes:rest.includes('--yes')}));
    if (command === 'enroll') {
      const transcribe = async wav => {
        const { whisperWords } = await import('./narrate.mjs');
        const dir = await mkdtemp(join(tmpdir(), 'hold-up-enroll-')), wav16 = join(dir, 'ref16.wav');
        try {
          await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', wav, '-ac', '1', '-ar', '16000', wav16]);
          return (await whisperWords(wav16)).words.map(w => w.text).join(' ');
        } finally { await rm(dir, {recursive:true, force:true}); }
      };
      return print(await enroll({id:opt('--id'), audio:resolve(process.cwd(), opt('--audio') ?? ''), owner:opt('--owner'), consent:opt('--consent'), transcript:opt('--transcript'), transcribe}));
    }
    throw new Error('Usage: voice.mjs status | install [--aligner] [--yes] | enroll --id <id> --audio <file> --owner "<name>" --consent "<statement>" [--transcript "<words>"]');
  };
  go().catch(err => { console.error(err.message); process.exitCode = 1; });
}
