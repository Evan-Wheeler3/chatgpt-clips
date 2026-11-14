import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, synthesize, authorize, VOICES_DIR, DEFAULT_NARRATOR } from './tts.mjs';
import { alignWords, scriptWords } from './align.mjs';
import { audioDuration, pauseReport, whisperWords } from './narrate.mjs';
import { redact } from './env.mjs';

/*
 * Narrator audition: the same passage and settings for each candidate voice, so the owner can compare and choose.
 *   prepare   free: renders the passage, estimates the cost, and (with an API key) verifies the candidate voices and
 *             discovers alternatives through the free voice listing
 *   generate  paid: needs --approve-spend <usd> --by "<name>"; writes voice-0N.mp3 and measurements to comparison.json
 *   select    the owner's choice becomes the approved Hold Up narrator (voices/hold-up-narrator.json)
 * Nothing here selects a voice by itself.
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const AUDITION_DIR = resolve(root, 'production/narration/auditions');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const writeJson = (f, v) => writeFile(f, JSON.stringify(v, null, 2) + '\n');

export async function loadAudition(configFile = resolve(VOICES_DIR, 'auditions/barrel-bilge.json')) {
  const config = await readJson(configFile), story = await readJson(resolve(root, config.story));
  return {config, story, script:story.narration.script};
}

export const candidateProfile = (config, candidate, n) => ({
  id:`audition-${String(n).padStart(2, '0')}`, provider:config.provider, voiceId:candidate.voiceId, voiceName:candidate.name, modelId:config.modelId,
  settings:config.settings, seed:config.seed, outputFormat:config.outputFormat, delivery:config.delivery
});

const labelMatch = (voice, labels) => {
  const l = Object.fromEntries(Object.entries(voice.labels ?? {}).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));
  return Object.entries(labels).every(([k, want]) => (Array.isArray(want) ? want : [want]).some(w => (l[k] ?? '').includes(w)));
};

export async function prepare({configFile, outDir = AUDITION_DIR, provider = null, env = process.env} = {}) {
  const {config, script} = await loadAudition(configFile);
  provider ??= await createProvider(config.provider, {env});
  await mkdir(outDir, {recursive:true});
  const candidates = config.candidates.map((c, i) => {
    const profile = candidateProfile(config, c, i + 1), text = provider.render(script, profile);
    return {file:`voice-${String(i + 1).padStart(2, '0')}.mp3`, name:c.name, voiceId:c.voiceId, why:c.why, modelId:config.modelId, settings:config.settings, seed:config.seed,
      renderedText:text, estimate:provider.estimate(text, profile), verified:null};
  });
  const report = {
    audition:config.id, status:'prepared', preparedAt:new Date().toISOString(), story:config.story, passage:config.passageNote,
    provider:config.provider, modelId:config.modelId, settings:config.settings, delivery:config.delivery,
    apiKey:env.ELEVENLABS_API_KEY ? `configured (${redact(env.ELEVENLABS_API_KEY)})` : 'not configured',
    estimatedTotalUsd:Math.round(candidates.reduce((s, c) => s + c.estimate.usd, 0) * 10000) / 10000, pricingSource:candidates[0]?.estimate.source,
    candidates, alternatives:[], selection:null
  };
  if (env.ELEVENLABS_API_KEY) {
    // Free requests: confirm each candidate exists and read its labels; list other matching voices
    const found = await provider.listVoices({voice_ids:config.candidates.map(c => c.voiceId), page_size:100});
    for (const c of report.candidates) {
      const v = found.voices?.find(x => x.voice_id === c.voiceId);
      c.verified = v ? {name:v.name, labels:v.labels ?? {}, description:v.description ?? null, previewUrl:v.preview_url ?? null, category:v.category ?? null} : false;
    }
    const library = await provider.listVoices(config.discovery.query);
    report.alternatives = (library.voices ?? []).filter(v => labelMatch(v, config.discovery.labels) && !config.discovery.avoidDescriptions.some(a => `${v.description ?? ''} ${JSON.stringify(v.labels ?? {})}`.toLowerCase().includes(a)))
      .filter(v => !config.candidates.some(c => c.voiceId === v.voice_id)).map(v => ({name:v.name, voiceId:v.voice_id, labels:v.labels, description:v.description ?? null, previewUrl:v.preview_url ?? null}));
    report.status = report.candidates.every(c => c.verified) ? 'verified' : 'needs-candidate-change';
  }
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return report;
}

async function measure(audioPath, script, providerWords) {
  const duration = await audioDuration(audioPath);
  let words = providerWords, aligner = 'provider alignment';
  if (!words?.length) {
    const dir = await mkdtemp(join(tmpdir(), 'hold-up-audition-')), wav16 = join(dir, 'a.wav');
    try { await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', audioPath, '-ac', '1', '-ar', '16000', wav16]); words = (await whisperWords(wav16)).words; aligner = 'whisper.cpp'; }
    finally { await rm(dir, {recursive:true, force:true}); }
  }
  const aligned = alignWords(script, words);
  const spoken = scriptWords(script).length, first = aligned.words[0].start, last = aligned.words.at(-1).end;
  return {durationSec:Math.round(duration * 100) / 100, speechSec:Math.round((last - first) * 100) / 100, wordsPerMinute:Math.round(spoken / (last - first) * 60),
    aligner, alignment:aligned.quality, pauses:pauseReport(script, aligned.words)};
}

export async function generate({configFile, outDir = AUDITION_DIR, approveSpendUsd, approvedBy, provider = null, env = process.env, cacheDir} = {}) {
  const {config, script} = await loadAudition(configFile);
  const report = await readJson(join(outDir, 'comparison.json')).catch(() => null);
  if (!report) throw new Error('Run `audition.mjs prepare` first');
  if (report.status === 'needs-candidate-change') throw new Error('Some candidate voices were not found; update voices/auditions/*.json (see alternatives in comparison.json) and prepare again');
  const authorization = authorize({by:approvedBy, maxUsd:approveSpendUsd});
  if (report.estimatedTotalUsd > approveSpendUsd) throw new Error(`The audition is estimated at $${report.estimatedTotalUsd}; the approved cap is $${approveSpendUsd}`);
  provider ??= await createProvider(config.provider, {env});
  for (const [i, candidate] of config.candidates.entries()) {
    const profile = candidateProfile(config, candidate, i + 1), entry = report.candidates[i];
    const take = await synthesize({provider, profile, script}, {authorization, cacheDir, env});
    await copyFile(take.audioPath, join(outDir, entry.file));
    Object.assign(entry, {generatedAt:take.createdAt, cached:take.cached, costUsd:take.costUsd, cacheKey:take.key, sha256:createHash('sha256').update(take.audio).digest('hex'),
      response:take.response, measurements:await measure(join(outDir, entry.file), script, take.words)});
  }
  report.status = 'generated';
  report.generation = {approvedBy:authorization.by, approvedCapUsd:approveSpendUsd, spentUsd:Math.round(authorization.spentUsd * 10000) / 10000, at:new Date().toISOString()};
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return report;
}

// The owner's choice (never automatic): the chosen audition voice becomes the approved Hold Up narrator
export async function select({n, by, outDir = AUDITION_DIR, voicesDir = VOICES_DIR, configFile} = {}) {
  if (/^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i.test(String(by ?? '').trim())) throw new Error('Selecting the narrator needs the name of the person choosing');
  const {config} = await loadAudition(configFile);
  const report = await readJson(join(outDir, 'comparison.json')), entry = report.candidates[n - 1];
  if (!entry) throw new Error(`No candidate ${n}`);
  if (report.status !== 'generated' || !entry.sha256) throw new Error('Generate and listen to the auditions before selecting');
  const file = join(voicesDir, `${DEFAULT_NARRATOR}.json`), narrator = await readJson(file);
  const chosen = {...narrator, status:'approved', provider:config.provider, voiceId:entry.voiceId, voiceName:entry.name, modelId:entry.modelId, settings:entry.settings, seed:entry.seed,
    outputFormat:config.outputFormat, delivery:config.delivery, approval:{by:String(by).trim(), on:new Date().toISOString().slice(0, 10), audition:report.audition, sample:entry.file, sampleSha256:entry.sha256}};
  await writeJson(file, chosen);
  report.selection = {candidate:n, name:entry.name, by:chosen.approval.by, on:chosen.approval.on};
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return chosen;
}

function readme(r) {
  const rows = r.candidates.map((c, i) => `| ${i + 1} | ${c.file} | ${c.name} | \`${c.voiceId}\` | ${c.verified === null ? 'unverified (no key yet)' : c.verified ? 'found' : '**not found**'} | $${c.estimate.usd.toFixed(4)} | ${c.measurements ? `${c.measurements.durationSec} s, ${c.measurements.wordsPerMinute} wpm` : 'not generated'} |`).join('\n');
  return `# Hold Up narrator audition (${r.audition})

**Status:** ${r.status}${r.selection ? `. **Selected:** voice ${r.selection.candidate} (${r.selection.name}), by ${r.selection.by} on ${r.selection.on}` : '. **No voice selected.** The owner chooses after listening.'}

**Passage:** ${r.passage}
**Provider and model:** ${r.provider} \`${r.modelId}\`, with the same settings for every voice (\`${JSON.stringify(r.settings)}\`)
**Pauses:** only the script's deliberate pauses are kept, at 60% of their length; short beats are left to punctuation.
**API key:** ${r.apiKey}
**Estimated total:** $${r.estimatedTotalUsd} (${r.pricingSource})

| # | file | voice | voice ID | check | est. cost | measured |
|---|---|---|---|---|---|---|
${rows}
${r.alternatives?.length ? `\n**Other matching voices** (from discovery): ${r.alternatives.slice(0, 8).map(a => `${a.name} (\`${a.voiceId}\`)`).join(', ')}\n` : ''}
## How to complete the audition
1. Copy \`.env.example\` to \`.env\` and set \`ELEVENLABS_API_KEY\`.
2. Verify the voices (free): \`node tools/narration/audition.mjs prepare\`. If one isn't found, swap it in \`voices/auditions/barrel-bilge.json\` (see the alternatives above).
3. Approve the cost and generate (paid, about $${r.estimatedTotalUsd} in total):
   \`node tools/narration/audition.mjs generate --approve-spend 0.10 --by "<your name>"\`
4. Listen to voice-01.mp3 to voice-03.mp3 and read the measurements in comparison.json (pace, pauses kept, alignment).
5. Choose: \`node tools/narration/audition.mjs select <1|2|3> --by "<your name>"\`. Future episodes then use that narrator by default.
6. Re-voice barrel-bilge with the narrator and check the timing report before rendering \`production-natural-voice.mp4\` (docs/NARRATION.md).
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const configFile = opt('--config') && resolve(process.cwd(), opt('--config'));
  const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  const { loadEnv } = await import('./env.mjs');
  await loadEnv();
  const go = async () => {
    if (command === 'prepare') { const r = await prepare({configFile}); return print({status:r.status, apiKey:r.apiKey, estimatedTotalUsd:r.estimatedTotalUsd, candidates:r.candidates.map(c => ({file:c.file, name:c.name, voiceId:c.voiceId, verified:c.verified, usd:c.estimate.usd})), alternatives:r.alternatives.length}); }
    if (command === 'generate') { const r = await generate({configFile, approveSpendUsd:Number(opt('--approve-spend')), approvedBy:opt('--by')}); return print({status:r.status, spent:r.generation, candidates:r.candidates.map(c => ({file:c.file, name:c.name, measurements:c.measurements}))}); }
    if (command === 'select') return print(await select({n:Number(rest[0]), by:opt('--by'), configFile}));
    throw new Error('Usage: audition.mjs prepare | generate --approve-spend <usd> --by "<name>" | select <n> --by "<name>"  [--config voices/auditions/<file>.json]');
  };
  go().catch(err => { console.error(err.message); process.exitCode = 1; });
}
