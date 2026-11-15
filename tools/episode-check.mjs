import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileStory } from './storyboard/compile.mjs';
import { validatePlan } from './storyboard/validate.mjs';
import { scheduleSfx } from './audio/schedule.mjs';
import { loadCatalog } from './audio/catalog.mjs';
import { spokenWords } from './narration/markup.mjs';

/*
 * Pre-production check for an episode (no narration, no rendering): estimates the spoken duration from the approved
 * narrator's measured pace, builds a SCRATCH word timeline at that pace, and compiles + validates the storyboard against
 * it. It reports anchors, missing assets and characters, caption groups and the sound effects the scheduler would add.
 * Every number here is an estimate; real timing comes from the narration take and forced alignment.
 *   node tools/episode-check.mjs --story stories/<slug>/story.json [--reference production/<slug>/words.json]
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const exists = p => access(p).then(() => true, () => false);
const letters = t => t.replace(/[^a-z0-9]/gi, '').length;

// Pace measured from a real take of the narrator: letters per second inside sentences, gaps between sentences, lead-in, tail
export function measurePace(words, durationSec) {
  const sentences = []; let cur = [];
  for (const w of words) { cur.push(w); if (/[.?!:]$/.test(w.text)) { sentences.push(cur); cur = []; } }
  if (cur.length) sentences.push(cur);
  let chars = 0, speech = 0; const gaps = [];
  sentences.forEach((s, i) => { chars += s.reduce((a, w) => a + letters(w.text), 0); speech += s.at(-1).end - s[0].start; if (sentences[i + 1]) gaps.push(sentences[i + 1][0].start - s.at(-1).end); });
  return {lettersPerSec:chars / speech, sentenceGapSec:gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length), leadInSec:words[0].start, tailSec:Math.max(0, durationSec - words.at(-1).end), source:null};
}

// A scratch timeline: each word lasts letters / pace (at least 0.12 s), sentences are separated by the measured gap
export function scratchWords(script, pace) {
  const out = []; let t = pace.leadInSec;
  for (const [i, text] of spokenWords(script).entries()) {
    const d = Math.max(0.12, letters(text) / pace.lettersPerSec);
    out.push({i, text, start:+t.toFixed(3), end:+(t + d).toFixed(3)});
    t += d + (/[.?!:]$/.test(text) ? pace.sentenceGapSec : /[,;—…]$/.test(text) ? 0.12 : 0);
  }
  return {words:out, durationSec:+(out.at(-1).end + Math.max(0.5, pace.tailSec)).toFixed(2)};
}

export async function checkEpisode(storyFile, {referenceWords = join(root, 'production/barrel-bilge/words.json')} = {}) {
  const story = JSON.parse(await readFile(storyFile, 'utf8')), report = {story:story.slug, generatedAt:new Date().toISOString(), notes:[]};
  const reference = JSON.parse(await readFile(referenceWords, 'utf8'));
  const pace = {...measurePace(reference.words, reference.audio.durationSec), source:referenceWords.replace(root + '/', '')};
  const scratch = scratchWords(story.narration.script, pace);
  report.estimate = {words:scratch.words.length, durationSec:scratch.durationSec, pace:{lettersPerSec:+pace.lettersPerSec.toFixed(1), sentenceGapSec:+pace.sentenceGapSec.toFixed(2), leadInSec:pace.leadInSec, source:pace.source},
    caveat:'Estimated from the approved narrator\'s measured pace; the real take decides (delivery varies with punctuation and emphasis).'};
  // Not built yet: characters and environments that do not exist are reported and stripped so the rest can be checked
  const staged = structuredClone(story);
  report.cast = [];
  for (const member of story.cast ?? []) {
    const ok = await exists(join(root, 'characters', member.character, 'character.json')) || await exists(join(root, 'characters', `${member.character}.json`));
    report.cast.push({id:member.id, character:member.character, available:ok});
  }
  const unavailable = new Set(report.cast.filter(c => !c.available).map(c => c.id));
  staged.cast = (story.cast ?? []).filter(m => !unavailable.has(m.id));
  for (const shot of staged.beats.flatMap(b => b.shots)) shot.events = (shot.events ?? []).filter(e => !unavailable.has(e.character));
  if (story.environment && !await exists(join(root, 'environments', `${story.environment.id}.json`))) { report.environment = {id:story.environment.id, available:false}; delete staged.environment; }
  else report.environment = story.environment ? {id:story.environment.id, available:true} : null;
  const plan = await compileStory(staged, {words:scratch.words, audio:{durationSec:scratch.durationSec}});
  const v = validatePlan(plan);
  report.shots = plan.shots.map(s => ({id:s.id, start:+(s.startFrame / plan.fps).toFixed(2), end:+(s.endFrame / plan.fps).toFixed(2), sec:+((s.endFrame - s.startFrame) / plan.fps).toFixed(2), move:s.camera.behavior, transition:s.transition?.type ?? 'cut'}));
  report.missingAssets = plan.missingAssets;
  report.validation = {status:v.status, errors:v.errors.map(e => `${e.code} ${e.shot ?? e.prop ?? ''}: ${e.message}`), warnings:[...new Set(v.warnings.map(w => `${w.code} ${w.shot ?? ''}`))]};
  report.captions = plan.captions?.enabled ? plan.captions.groups.map(g => ({n:g.n, shot:g.shot, band:g.band, pinned:g.pinned, text:g.words.map(w => w.emphasis ? `*${w.text}*` : w.text).join(' ')})) : null;
  // Sound: the scheduler's automatic events plus manual cues, and which assets the catalog does not have yet
  const events = scheduleSfx(plan, staged), catalog = await loadCatalog();
  report.sound = {events:events.map(e => ({time:e.time, rule:e.rule, asset:e.asset})), missingAssets:[...new Set(events.map(e => e.asset))].filter(id => !catalog.assets.some(a => a.id === id)),
    plannedButNotScheduled:(story.audio?.planned ?? []).map(p => p.asset ?? p.need)};
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const storyFile = resolve(process.cwd(), opt('--story'));
  checkEpisode(storyFile, {referenceWords:opt('--reference') ? resolve(process.cwd(), opt('--reference')) : undefined}).then(async r => {
    const out = join(root, 'production', r.story); await mkdir(out, {recursive:true});
    await writeFile(join(out, 'preproduction-check.json'), JSON.stringify(r, null, 2) + '\n');
    process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }).catch(err => { console.error(err.stack); process.exitCode = 1; });
}
