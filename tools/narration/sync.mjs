import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileStory } from '../storyboard/compile.mjs';
import { validatePlan } from '../storyboard/validate.mjs';
import { wordAt } from '../storyboard/sample.mjs';

/*
 * Narration sync report. The storyboard anchors shots, camera moves, prop actions and character actions to words, so a new
 * narration take retimes the whole video when it compiles: each beat moves to where its word is now spoken (nothing is
 * scaled uniformly). This report compares the plan before and after a take and flags where the new delivery breaks the
 * edit and needs an editorial decision.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const LIMITS = {shotRatio:[0.65, 1.5], minMoveFrames:8, beatKeptRatio:0.35, minBeatMs:300};

const shotTimes = (plan, fps) => Object.fromEntries(plan.shots.map(s => [s.id, {start:+(s.startFrame / fps).toFixed(3), end:+(s.endFrame / fps).toFixed(3), sec:+((s.endFrame - s.startFrame) / fps).toFixed(3), move:s.camera.window}]));
const actionList = plan => [
  ...plan.cast.flatMap(m => m.actions.map(a => ({who:m.id, type:a.type, shot:a.shot, word:a.anchor?.word ?? null, start:a.startFrame, end:a.endFrame, instant:a.instant}))),
  ...plan.props.flatMap(p => p.actions.map(a => ({who:p.id, type:a.type, shot:a.shot, word:a.anchor?.word ?? null, start:a.startFrame, end:a.endFrame})))
];

export async function narrationSync(story, before, after, {rootDir = root, catalogPath} = {}) {
  const opts = {rootDir, ...(catalogPath ? {catalogPath} : {})};
  const conflicts = [], notes = [];
  if (before.script !== after.script) conflicts.push({code:'SCRIPT_CHANGED', severity:'editorial', message:'The spoken script differs between takes; check every word anchor still means what the shot intends'});
  const planBefore = await compileStory(story, before, opts);
  let planAfter;
  try { planAfter = await compileStory(story, after, opts); }
  catch (err) { return {status:'blocked', conflicts:[...conflicts, {code:'ANCHOR_MISSING', severity:'error', message:err.message}], notes}; }
  const fps = planAfter.fps, b = shotTimes(planBefore, fps), a = shotTimes(planAfter, fps);
  const shots = planAfter.shots.map(s => ({id:s.id, before:b[s.id], after:a[s.id], ratio:+(a[s.id].sec / b[s.id].sec).toFixed(3)}));
  for (const s of shots) {
    if (s.ratio < LIMITS.shotRatio[0] || s.ratio > LIMITS.shotRatio[1]) conflicts.push({code:'SHOT_RETIMED_HEAVILY', severity:'editorial', shot:s.id, message:`${s.id} goes from ${s.before.sec}s to ${s.after.sec}s; check its action and camera move still read`});
    const move = s.after.move, moveFrames = move[1] - move[0];
    const behavior = planAfter.shots.find(x => x.id === s.id).camera.behavior;
    if (behavior !== 'hold' && moveFrames < LIMITS.minMoveFrames) conflicts.push({code:'MOVE_TOO_FAST', severity:'editorial', shot:s.id, message:`${s.id}'s ${behavior} now has ${moveFrames} frames`});
  }
  // Timed actions that used to finish inside their shot but now run past the cut
  const beforeActions = actionList(planBefore), afterActions = actionList(planAfter);
  const shotEnd = Object.fromEntries(planAfter.shots.map(s => [s.id, s.endFrame])), shotEndBefore = Object.fromEntries(planBefore.shots.map(s => [s.id, s.endFrame]));
  const actions = afterActions.map((x, i) => ({...x, beforeStart:beforeActions[i]?.start, beforeEnd:beforeActions[i]?.end}));
  for (const x of actions) {
    if (x.instant || x.end <= x.start) continue;
    if (x.end > shotEnd[x.shot] && !(x.beforeEnd > shotEndBefore[x.shot])) conflicts.push({code:'ACTION_CROSSES_CUT', severity:'editorial', shot:x.shot, message:`${x.who} ${x.type} (on "${x.word ?? 'shot start'}") now runs ${x.end - shotEnd[x.shot]} frames past the end of ${x.shot}`});
  }
  // Intentional beats: a pause marked in the script should still be audible in the new take
  for (const p of after.pauses ?? []) {
    if (p.markedMs >= LIMITS.minBeatMs && p.measuredMs < p.markedMs * LIMITS.beatKeptRatio) conflicts.push({code:'BEAT_LOST', severity:'editorial', message:`The ${p.markedMs} ms beat after "${p.after}" is now ${p.measuredMs} ms`});
  }
  const vb = validatePlan(planBefore), va = validatePlan(planAfter);
  for (const e of va.errors) conflicts.push({code:'VALIDATION_ERROR', severity:'error', shot:e.shot, message:`${e.code}: ${e.message}`});
  const known = new Set(vb.warnings.map(w => `${w.code}|${w.shot}`));
  for (const w of va.warnings) if (!known.has(`${w.code}|${w.shot}`)) conflicts.push({code:'NEW_WARNING', severity:'review', shot:w.shot, message:`${w.code}: ${w.message}`});
  // Captions follow the words: the caption word at each word's midpoint must be that word
  const captionErrors = planAfter.words.filter(w => wordAt(planAfter, (w.start + w.end) / 2 * fps)?.i !== w.i).map(w => w.text);
  if (captionErrors.length) conflicts.push({code:'CAPTION_DRIFT', severity:'error', message:`Captions do not show: ${captionErrors.join(', ')}`});
  notes.push(`Duration ${(planBefore.durationFrames / fps).toFixed(2)}s -> ${(planAfter.durationFrames / fps).toFixed(2)}s; every beat follows its anchor word (no uniform scaling).`);
  const errors = conflicts.filter(c => c.severity === 'error').length;
  return {status:errors ? 'blocked' : conflicts.length ? 'review' : 'in-sync', durationSec:{before:+(planBefore.durationFrames / fps).toFixed(3), after:+(planAfter.durationFrames / fps).toFixed(3)},
    shots, actions:actions.map(x => ({who:x.who, type:x.type, shot:x.shot, word:x.word, frame:[x.beforeStart, x.start], endFrame:[x.beforeEnd, x.end]})), conflicts, notes};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const storyFile = resolve(process.cwd(), opt('--story')), story = JSON.parse(await readFile(storyFile, 'utf8'));
  const outDir = resolve(root, 'production', story.slug);
  const load = async take => JSON.parse(await readFile(take === 'active' ? join(outDir, 'words.json') : join(outDir, 'takes', take, 'words.json'), 'utf8'));
  const report = await narrationSync(story, await load(opt('--from') ?? 'active'), await load(opt('--to'))).catch(err => ({status:'blocked', conflicts:[{code:'ERROR', severity:'error', message:err.message}]}));
  await writeFile(join(outDir, 'narration-sync.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({status:report.status, durationSec:report.durationSec, conflicts:report.conflicts}, null, 2) + '\n');
}
