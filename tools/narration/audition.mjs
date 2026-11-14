import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createProvider, synthesize, VOICES_DIR, DEFAULT_NARRATOR } from './tts.mjs';
import { alignWords, scriptWords } from './align.mjs';
import { audioDuration, pauseReport, whisperWords } from './narrate.mjs';
import { status as voiceStatus, ENGINES } from './voice.mjs';

/*
 * Narrator audition with the owner's cloned voice: the same passage and voice in three delivery variants, so the owner
 * can listen and choose. Free and local throughout.
 *   prepare   no generation: the plan, the rendered text of each variant, and what is still missing (engine, voice)
 *   generate  writes voice-01.wav .. voice-03.wav with measurements (pace, beats kept, alignment, settings applied)
 *   select    the owner's choice becomes the approved Hold Up narrator (voices/hold-up-narrator.json)
 * Nothing here chooses a voice by itself.
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const AUDITION_DIR = resolve(root, 'production/narration/auditions');
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const writeJson = (f, v) => writeFile(f, JSON.stringify(v, null, 2) + '\n');
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;

export async function loadAudition(configFile = resolve(VOICES_DIR, 'auditions/barrel-bilge.json')) {
  const config = await readJson(configFile), story = await readJson(resolve(root, config.story));
  return {config, script:story.narration.script};
}

export const variantProfile = (config, variant, n) => ({
  id:`audition-${String(n).padStart(2, '0')}`, provider:config.provider, engine:config.engine, voice:config.voice, seed:config.seed,
  settings:variant.settings ?? {}, delivery:variant.delivery ?? {}, variant:variant.name
});

export async function prepare({configFile, outDir = AUDITION_DIR, provider = null, voiceDir, privateDir} = {}) {
  const {config, script} = await loadAudition(configFile);
  provider ??= await createProvider(config.provider, {voiceDir, privateDir});
  await mkdir(outDir, {recursive:true});
  const engine = ENGINES[config.engine], state = await voiceStatus({voiceDir, privateDir});
  const missing = [];
  if (!state.manifest) missing.push(`engine not installed (about ${state.plan.needGB} GB; ${state.plan.freeDiskGB} GB free): node tools/narration/voice.mjs install`);
  if (!state.enrolled.includes(config.voice)) missing.push(`no enrolled voice "${config.voice}": record ${'10-20'} s of natural speech, then node tools/narration/voice.mjs enroll --id ${config.voice} --audio <file> --owner "<name>" --consent "<statement>" --transcript "<words>"`);
  const report = {
    audition:config.id, status:missing.length ? 'waiting' : 'ready', preparedAt:new Date().toISOString(), story:config.story, passage:config.passageNote,
    engine:{id:config.engine, name:engine.name, model:engine.repo, license:engine.license, controls:engine.controls}, voice:config.voice, seed:config.seed, honesty:config.honesty,
    install:state.plan, missing, costUsd:0,
    takes:config.variants.map((v, i) => ({file:`voice-${String(i + 1).padStart(2, '0')}.wav`, variant:v.name, description:v.description, settings:v.settings, delivery:v.delivery,
      renderedText:provider.render(script, variantProfile(config, v, i + 1))})),
    selection:null
  };
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return report;
}

async function measure(audioPath, script) {
  const dir = await mkdtemp(join(tmpdir(), 'hold-up-audition-')), wav16 = join(dir, 'a.wav');
  try {
    await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', audioPath, '-ac', '1', '-ar', '16000', wav16]);
    const aligned = alignWords(script, (await whisperWords(wav16)).words);
    const first = aligned.words[0].start, last = aligned.words.at(-1).end;
    return {durationSec:+(await audioDuration(audioPath)).toFixed(2), speechSec:+(last - first).toFixed(2), wordsPerMinute:Math.round(scriptWords(script).length / (last - first) * 60),
      aligner:'whisper.cpp', alignment:aligned.quality, beats:pauseReport(script, aligned.words)};
  } finally { await rm(dir, {recursive:true, force:true}); }
}

export async function generate({configFile, outDir = AUDITION_DIR, provider = null, cacheDir, voiceDir, privateDir, measureTake = measure} = {}) {
  const {config, script} = await loadAudition(configFile);
  const report = await prepare({configFile, outDir, provider, voiceDir, privateDir});
  if (report.status !== 'ready' && !provider) throw new Error(`The audition cannot run yet:\n- ${report.missing.join('\n- ')}`);
  provider ??= await createProvider(config.provider, {voiceDir, privateDir});
  for (const [i, variant] of config.variants.entries()) {
    const take = await synthesize({provider, profile:variantProfile(config, variant, i + 1), script}, {cacheDir});
    const entry = report.takes[i];
    await copyFile(take.audioPath, join(outDir, entry.file));
    Object.assign(entry, {generatedAt:take.createdAt, cached:take.cached, cacheKey:take.key, sha256:createHash('sha256').update(take.audio).digest('hex'),
      engineReport:take.response, settingsApplied:take.response?.applied ?? {}, settingsIgnored:take.response?.ignored ?? [], measurements:await measureTake(join(outDir, entry.file), script)});
  }
  report.status = 'generated';
  report.generatedAt = new Date().toISOString();
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return report;
}

// The owner's choice (never automatic): the chosen take's voice and delivery become the approved Hold Up narrator
export async function select({n, by, outDir = AUDITION_DIR, voicesDir = VOICES_DIR, configFile} = {}) {
  if (NOT_A_PERSON.test(String(by ?? '').trim())) throw new Error('Selecting the narrator needs the name of the person choosing');
  const {config} = await loadAudition(configFile);
  const report = await readJson(join(outDir, 'comparison.json')), entry = report.takes[n - 1];
  if (!entry) throw new Error(`No take ${n}`);
  if (report.status !== 'generated' || !entry.sha256) throw new Error('Generate and listen to the auditions before selecting');
  const file = join(voicesDir, `${DEFAULT_NARRATOR}.json`), narrator = await readJson(file);
  const chosen = {...narrator, status:'approved', provider:config.provider, engine:config.engine, voice:config.voice, seed:config.seed, settings:entry.settings, delivery:entry.delivery,
    variant:entry.variant, approval:{by:String(by).trim(), on:new Date().toISOString().slice(0, 10), audition:report.audition, take:entry.file, takeSha256:entry.sha256}};
  await writeJson(file, chosen);
  report.selection = {take:n, variant:entry.variant, by:chosen.approval.by, on:chosen.approval.on};
  await writeJson(join(outDir, 'comparison.json'), report);
  await writeFile(join(outDir, 'README.md'), readme(report));
  return chosen;
}

function readme(r) {
  const rows = r.takes.map((t, i) => `| ${i + 1} | ${t.file} | ${t.variant} | ${t.measurements ? `${t.measurements.durationSec} s, ${t.measurements.wordsPerMinute} wpm, ${t.measurements.alignment.exact}/${t.measurements.alignment.scriptWords} words aligned` : 'not generated'} | ${t.settingsIgnored?.length ? `ignored: ${t.settingsIgnored.join(', ')}` : t.measurements ? 'all applied' : '-'} |`).join('\n');
  return `# Hold Up narrator audition (${r.audition})

**Status:** ${r.status}${r.selection ? `. **Selected:** take ${r.selection.take} (${r.selection.variant}), by ${r.selection.by} on ${r.selection.on}` : '. **No take selected.** The owner chooses after listening.'}

- **Voice:** the owner's cloned voice ("${r.voice}"), the same in every take
- **Engine:** ${r.engine.name}, \`${r.engine.model}\` (local, free, offline after install; ${r.engine.license.weights})
- **Passage:** ${r.passage}
- **Controls:** ${r.honesty}

| # | file | delivery | measured | settings |
|---|---|---|---|---|
${rows}

${r.takes.map((t, i) => `**${i + 1}. ${t.variant}:** ${t.description}\n\n> ${t.renderedText}`).join('\n\n')}
${r.missing.length ? `\n## Still needed\n${r.missing.map(m => `- ${m}`).join('\n')}\n` : ''}
## Steps
1. Check the plan: \`node tools/narration/voice.mjs status\` (disk, RAM, what is installed).
2. Install the engine once: \`node tools/narration/voice.mjs install\` shows the download plan, and \`--yes\` installs it.
3. Record 10-20 s of your natural speaking voice (quiet room, no music, one take). Enroll it:
   \`node tools/narration/voice.mjs enroll --id ${r.voice} --audio <file> --owner "<your name>" --consent "I am <name>; this is my own voice and I permit Hold Up to clone it" --transcript "<exactly what you said>"\`
4. Generate: \`node tools/narration/audition.mjs generate\`
5. Listen, then choose: \`node tools/narration/audition.mjs select <1|2|3> --by "<your name>"\`
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const configFile = opt('--config') && resolve(process.cwd(), opt('--config'));
  const print = v => process.stdout.write(JSON.stringify(v, null, 2) + '\n');
  const go = async () => {
    if (command === 'prepare') { const r = await prepare({configFile}); return print({status:r.status, missing:r.missing, install:r.install, takes:r.takes.map(t => ({file:t.file, variant:t.variant, text:t.renderedText}))}); }
    if (command === 'generate') { const r = await generate({configFile}); return print({status:r.status, takes:r.takes.map(t => ({file:t.file, variant:t.variant, measurements:t.measurements, ignored:t.settingsIgnored}))}); }
    if (command === 'select') return print(await select({n:Number(rest[0]), by:opt('--by'), configFile}));
    throw new Error('Usage: audition.mjs prepare | generate | select <n> --by "<name>"  [--config voices/auditions/<file>.json]');
  };
  go().catch(err => { console.error(err.message); process.exitCode = 1; });
}
