import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileFiles } from './storyboard/compile.mjs';
import { castTracks } from './storyboard/sample.mjs';
import { openRenderer } from './storyboard/animatic.mjs';
import { checkCharacter, compareImages } from './characters/regression.mjs';
import { lockStatus } from './characters/lock.mjs';
import { characterFile } from './characters/load.mjs';
import { figureIssues } from './characters/rig-checks.mjs';

/*
 * Rollout check for an approved character in a story: lock and regression status, every-frame rig, contact and
 * ground checks on the painted joints, and a regression sheet (approved renders vs. now, plus the character in
 * every shot of the production) for human review.
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const exists = path => access(path).then(() => true, () => false);
const rel = path => path.replace(root + '/', '');
const text = s => s.replace(/'/g, '’').replace(/:/g, '\\:');

async function labelled(input, output, label, filter = '') {
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', input, '-vf', `${filter}${filter ? ',' : ''}drawtext=fontfile=${FONT}:text='${text(label)}':x=8:y=8:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=6`, output]);
}

export async function runRollout({story = 'barrel-bilge', character = 'cooper', castId = character, video, approvedDir, currentDir}) {
  const outDir = join(root, 'production', story), tmp = join(outDir, 'tmp-rollout');
  await mkdir(tmp, {recursive:true});
  const plan = await compileFiles(join(root, 'stories', story, 'story.json'), join(outDir, 'words.json'));
  const validation = JSON.parse(await readFile(join(outDir, 'validation.json'), 'utf8'));
  const qa = await exists(join(outDir, 'qa-production.json')) ? JSON.parse(await readFile(join(outDir, 'qa-production.json'), 'utf8')) : null;
  const storyJson = JSON.parse(await readFile(join(root, 'stories', story, 'story.json'), 'utf8'));
  const report = {story, character, castId, generatedAt:new Date().toISOString(), staging:storyJson.staging ?? null, lock:await lockStatus(character)};
  report.regression = await checkCharacter(character);

  // Every frame: painted joints covered, limb lengths fixed (pure), then contact and feet on the rendered card
  const def = plan.cast.find(m => m.id === castId).definition, track = castTracks(plan).get(castId);
  const issues = track.flatMap(state => figureIssues(def, state).issues.map(i => ({frame:state.frame, ...i})));
  const r = await openRenderer(plan, {quality:'production'});
  let joints;
  try { joints = await r.page.evaluate(n => window.characterJoints(Array.from({length:n}, (_, i) => i)), plan.durationFrames); }
  finally { await r.close(); }
  const mine = joints.map(j => ({frame:j.frame, ...j.characters.find(c => c.id === castId)}));
  const contact = mine.filter(c => c.contact);
  const feet = mine.map(c => Math.min(c.joints.heelF[1], c.joints.toeF[1], c.joints.heelB[1], c.joints.toeB[1]));
  const characterWarnings = validation.warnings.filter(w => w.code.startsWith('CHARACTER_'));
  report.checks = {
    frames:plan.durationFrames, rigIssues:issues,
    contact:{frames:contact.map(c => c.frame), prop:[...new Set(contact.map(c => c.contact.prop))], maxShortfallM:Math.max(0, ...contact.map(c => c.contact.shortfallM)), maxPalmOffsetPx:Math.max(0, ...contact.map(c => c.contactPx))},
    ground:{minFootY:Math.min(...feet), maxFootYWhileStanding:Math.max(...feet)},
    validation:{status:validation.status, errors:validation.errors, characterWarnings},
    qa:qa && {status:qa.status, warnings:qa.warnings}
  };

  // Regression sheet, top: approved Phase 5.3 renders vs. the same renders from today's code, with the diff
  const rows = [];
  if (approvedDir && currentDir) {
    report.approvedComparison = {};
    for (const name of ['neutral', 'expressions']) {
      const a = join(approvedDir, `${name}.png`), b = join(currentDir, `${name}.png`), d = join(tmp, `${name}-diff.png`);
      report.approvedComparison[name] = await compareImages(a, b, d);
      const parts = [[a, 'Approved (Phase 5.3)'], [b, 'Phase 5.4 build'], [d, `Diff: ${(report.approvedComparison[name].changedFraction * 100).toFixed(3)} percent of pixels changed`]];
      const files = [];
      for (const [i, [src, label]] of parts.entries()) { const f = join(tmp, `${name}-${i}.png`); await labelled(src, f, `${label} · ${name}`, name === 'neutral' ? 'crop=iw*0.6:ih*0.55:iw*0.05:ih*0.2,scale=-1:600' : 'scale=-1:600'); files.push(f); }
      const row = join(tmp, `row-${name}.png`);
      await run('ffmpeg', ['-loglevel', 'error', '-y', ...files.flatMap(f => ['-i', f]), '-filter_complex', 'hstack=inputs=3', row]);
      rows.push(row);
    }
  }
  // Bottom: the character in every shot of the production video, cropped around the painted figure
  const crops = [];
  report.shots = [];
  for (const shot of plan.shots) {
    const frames = mine.filter(c => c.frame >= shot.startFrame && c.frame < shot.endFrame);
    const visible = frames.filter(c => { const [x, y] = c.screen.headCenter; return x > 0 && x < 1080 && y > 0 && y < 1920; });
    const pick = visible[Math.floor(visible.length * 0.7)];
    const out = join(tmp, `shot-${shot.id}.png`);
    if (!pick) {
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=#201a14:s=360x600', '-frames:v', '1', join(tmp, 'blank.png')]);
      await labelled(join(tmp, 'blank.png'), out, `${shot.id}: off screen by design`);
      report.shots.push({id:shot.id, characterVisible:false});
    } else {
      const J = pick.screen, xs = Object.values(J).map(p => p[0]), ys = Object.values(J).map(p => p[1]);
      const h = Math.max(...ys) - Math.min(...ys), side = Math.round(Math.max(h * 1.5, 260));
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const x = Math.max(0, Math.min(1080 - Math.min(side, 1080), Math.round(cx - side / 2))), y = Math.max(0, Math.min(1920 - side * 1.6, Math.round(cy - side * 0.8)));
      await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', video, '-vf', `select='eq(n\\,${pick.frame})',crop=${Math.min(side, 1080)}:${Math.round(Math.min(side * 1.6, 1920))}:${x}:${Math.max(0, y)}`, '-frames:v', '1', join(tmp, `raw-${shot.id}.png`)]);
      await labelled(join(tmp, `raw-${shot.id}.png`), out, `${shot.id} · f${pick.frame}`, 'scale=360:600:force_original_aspect_ratio=decrease,pad=360:600:(ow-iw)/2:(oh-ih)/2:color=#201a14');
      report.shots.push({id:shot.id, characterVisible:true, frame:pick.frame, visibleFrames:visible.length, frames:frames.length});
    }
    crops.push(out);
  }
  const shotRow = join(tmp, 'row-shots.png');
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...crops.flatMap(f => ['-i', f]), '-filter_complex', `hstack=inputs=${crops.length}`, shotRow]);
  // Widths differ between the rows: pad every row to the widest, then stack
  const widths = await Promise.all([...rows, shotRow].map(async f => Number((await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=width', '-of', 'csv=p=0', f])).stdout)));
  const W = Math.max(...widths), all = [...rows, shotRow];
  const sheet = join(outDir, 'character-regression.png');
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...all.flatMap(f => ['-i', f]), '-filter_complex',
    all.map((_, i) => `[${i}]pad=${W}:ih:0:0:color=#efe8dd[p${i}]`).join(';') + ';' + all.map((_, i) => `[p${i}]`).join('') + `vstack=inputs=${all.length}`, sheet]);
  await rm(tmp, {recursive:true, force:true});
  report.outputs = {video:rel(video), regressionSheet:rel(sheet), characterFolder:rel(dirname(await characterFile(root, character)))};
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const story = opt('--story') ?? 'barrel-bilge';
  runRollout({story, character:opt('--character') ?? 'cooper', castId:opt('--cast'), video:resolve(root, opt('--video') ?? `production/${story}/production-approved-cooper.mp4`),
    approvedDir:opt('--approved') && resolve(root, opt('--approved')), currentDir:opt('--current') && resolve(root, opt('--current'))})
    .then(async report => {
      const file = join(root, 'production', story, 'character-rollout-report.json');
      await writeFile(file, JSON.stringify(report, null, 2) + '\n');
      process.stdout.write(JSON.stringify({lock:report.lock, regression:report.regression.pass, rigIssues:report.checks.rigIssues.length, contact:report.checks.contact, ground:report.checks.ground,
        validation:report.checks.validation.status, characterWarnings:report.checks.validation.characterWarnings.map(w => `${w.code} ${w.shot} f${w.frames?.join('-') ?? w.frame}`), shots:report.shots, approved:report.approvedComparison}, null, 2) + '\n');
    })
    .catch(err => { console.error(err.stack); process.exitCode = 1; });
}
