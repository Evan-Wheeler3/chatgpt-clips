import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElevenLabs, DEFAULT_BASE } from './providers/elevenlabs.mjs';
import { createMacSay, createRecorded } from './providers/local.mjs';
import { loadEnv } from './env.mjs';

/*
 * Narration synthesis behind one interface, with a content-addressed cache and a spending guard.
 *   provider: {id, paid, render(script, profile), estimate(text, profile), cacheKey(text, profile), synthesize(text, profile)}
 *   profile:  voices/<id>.json (provider, voiceId, modelId, settings, delivery)
 * Paid providers only run with an explicit authorization {by, maxUsd} from a person; cache hits never cost anything.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const VOICES_DIR = resolve(root, 'voices');
export const DEFAULT_NARRATOR = 'hold-up-narrator';
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;

export class SpendNotAuthorized extends Error {
  constructor(message, estimate) { super(message); this.name = 'SpendNotAuthorized'; this.code = 'unauthorized-spend'; this.estimate = estimate; }
}

export async function createProvider(id, {env = process.env, fetch} = {}) {
  if (id === 'elevenlabs') { await loadEnv(undefined, env); return createElevenLabs({apiKey:env.ELEVENLABS_API_KEY, base:env.ELEVENLABS_API_BASE ?? DEFAULT_BASE, fetch}); }
  if (id === 'macos-say') return createMacSay();
  if (id === 'recorded') return createRecorded();
  throw new Error(`Unknown narration provider "${id}" (elevenlabs, macos-say, recorded)`);
}

export async function loadVoiceProfile(id, dir = VOICES_DIR) {
  const file = join(dir, `${id}.json`);
  try { return {id, ...JSON.parse(await readFile(file, 'utf8'))}; } catch { throw new Error(`No voice profile "${id}" (${file})`); }
}

// The voice a story uses: the story's own profile, else the approved Hold Up narrator, else the development fallback
export async function narratorFor(narration = {}, dir = VOICES_DIR) {
  if (narration.voice?.profile) return {profile:await loadVoiceProfile(narration.voice.profile, dir), reason:'story profile'};
  const narrator = await loadVoiceProfile(DEFAULT_NARRATOR, dir).catch(() => null);
  if (narrator?.status === 'approved' && narrator.provider) return {profile:narrator, reason:'approved Hold Up narrator'};
  if (narration.voice?.engine === 'macos-say') return {profile:{id:'story-macos-say', provider:'macos-say', voiceId:narration.voice.voice, settings:{rate:narration.voice.rate}, delivery:{}}, reason:'development fallback (no approved narrator yet)'};
  throw new Error('No approved Hold Up narrator yet and the story names no voice; run the audition and approve a narrator, or set narration.voice');
}

// Authorization: a person, a dollar cap, and the running total spent under it
export function authorize({by, maxUsd}) {
  if (NOT_A_PERSON.test(String(by ?? '').trim())) throw new Error('Paid generation needs the name of the person approving the cost');
  if (!(maxUsd > 0)) throw new Error('Paid generation needs a positive spending cap in USD');
  return {by:String(by).trim(), maxUsd, spentUsd:0};
}

export async function synthesize({provider, profile, script}, {authorization = null, cacheDir = resolve(root, '.cache/narration'), usageLog = resolve(root, 'production/narration/usage.jsonl'), env = process.env} = {}) {
  const text = provider.render(script, profile);
  const keyObject = provider.cacheKey(text, profile);
  const key = createHash('sha256').update(JSON.stringify(keyObject)).digest('hex').slice(0, 32);
  const metaFile = join(cacheDir, `${key}.json`);
  const cached = await readFile(metaFile, 'utf8').then(JSON.parse, () => null);
  if (cached && await access(join(cacheDir, cached.audioFile)).then(() => true, () => false)) {
    return {...cached, audio:await readFile(join(cacheDir, cached.audioFile)), audioPath:join(cacheDir, cached.audioFile), cached:true, costUsd:0};
  }
  const estimate = provider.estimate(text, profile);
  if (provider.paid) {
    if (env.HOLDUP_BLOCK_PAID_TTS === '1') throw new SpendNotAuthorized('Paid narration is blocked in this environment (HOLDUP_BLOCK_PAID_TTS=1)', estimate);
    if (!authorization) throw new SpendNotAuthorized(`This would call ${provider.id} (${estimate.characters} characters, about $${estimate.usd.toFixed(4)}) and needs explicit approval: pass an authorization with the approver's name and a USD cap`, estimate);
    if (authorization.spentUsd + estimate.usd > authorization.maxUsd + 1e-9) throw new SpendNotAuthorized(`Estimated $${estimate.usd.toFixed(4)} would exceed the approved cap ($${authorization.spentUsd.toFixed(4)} of $${authorization.maxUsd} already used)`, estimate);
  }
  const result = await provider.synthesize(text, profile);
  if (provider.paid) authorization.spentUsd += estimate.usd;
  await mkdir(cacheDir, {recursive:true});
  const audioFile = `${key}.${result.extension}`;
  await writeFile(join(cacheDir, audioFile), result.audio);
  const meta = {key, provider:provider.id, profile:profile.id, request:keyObject, renderedText:text, audioFile, words:result.words, response:result.response, estimate, createdAt:new Date().toISOString()};
  await writeFile(metaFile, JSON.stringify(meta, null, 2) + '\n');
  if (provider.paid) {
    await mkdir(dirname(usageLog), {recursive:true});
    await appendFile(usageLog, JSON.stringify({at:meta.createdAt, provider:provider.id, profile:profile.id, voiceId:profile.voiceId, modelId:profile.modelId, characters:estimate.characters, estimatedUsd:estimate.usd, characterCostHeader:result.response?.characterCost ?? null, requestId:result.response?.requestId ?? null, approvedBy:authorization.by, cacheKey:key}) + '\n');
  }
  return {...meta, audio:result.audio, audioPath:join(cacheDir, audioFile), cached:false, costUsd:provider.paid ? estimate.usd : 0};
}
