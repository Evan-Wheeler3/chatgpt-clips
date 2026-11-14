import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { compileStory } from '../storyboard/compile.mjs';
import { openRenderer } from '../storyboard/animatic.mjs';

/*
 * Caption style comparison: the same production frames rendered with two caption styles, side by side (one row per moment).
 *   node tools/captions/compare.mjs --story stories/<slug>/story.json [--styles legacy-hud,hold-up] [--times 1.2,4.8,...]
 * By default it picks a moment inside a few caption groups, spread across the shots.
 */
const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';

export async function compareStyles({storyFile, styles = ['legacy-hud', 'hold-up'], times = null, quality = 'production', out = null}) {
  const story = JSON.parse(await readFile(storyFile, 'utf8'));
  const dir = resolve(root, 'production', story.slug), tmp = join(dir, 'tmp-captions');
  await mkdir(tmp, {recursive:true});
  const words = JSON.parse(await readFile(join(dir, 'words.json'), 'utf8'));
  const plans = await Promise.all(styles.map(style => compileStory({...story, captions:{...(story.captions || {}), style}}, words)));
  // Moments: mid-way through a spoken word, in groups spread across the video (one per shot where possible)
  const groups = plans.at(-1).captions.groups;
  const picks = times ?? [...new Map(groups.map(g => [g.shot, g])).values()].slice(0, 4).map(g => { const w = g.words[Math.min(1, g.words.length - 1)]; return (w.start + w.end) / 2; });
  const frames = picks.map(t => Math.round(t * plans[0].fps));
  const rows = [];
  for (const [k, plan] of plans.entries()) {
    const r = await openRenderer(plan, {quality});
    try {
      const images = await r.page.evaluate(list => window.renderFrames(list, 'image/png'), frames);
      for (const [n, image] of images.entries()) {
        const raw = join(tmp, `${k}-${n}.png`), labelled = join(tmp, `${k}-${n}-l.png`);
        await writeFile(raw, Buffer.from(image.split(',')[1], 'base64'));
        await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', raw, '-vf', `scale=540:-1,drawtext=fontfile=${FONT}:text='${styles[k]} · ${(frames[n] / plan.fps).toFixed(2)}s':x=10:y=10:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=6`, labelled]);
        (rows[n] ??= []).push(labelled);
      }
    } finally { await r.close(); }
  }
  const rowFiles = [];
  for (const [n, row] of rows.entries()) {
    const f = join(tmp, `row-${n}.png`);
    await run('ffmpeg', ['-loglevel', 'error', '-y', ...row.flatMap(x => ['-i', x]), '-filter_complex', `hstack=inputs=${row.length}`, f]);
    rowFiles.push(f);
  }
  const target = out ?? join(dir, 'caption-style-comparison.png');
  // Moments side by side as columns of [style A over style B]: transpose rows into a grid
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...rowFiles.flatMap(x => ['-i', x]), '-filter_complex', `vstack=inputs=${rowFiles.length}`, join(tmp, 'grid.png')]);
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', join(tmp, 'grid.png'), '-vf', 'scale=iw/2:-1', target]);
  await rm(tmp, {recursive:true, force:true});
  return {file:target, frames, styles};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), opt = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  compareStyles({storyFile:resolve(process.cwd(), opt('--story')), styles:opt('--styles')?.split(','), times:opt('--times')?.split(',').map(Number), quality:opt('--quality') ?? 'production'})
    .then(r => process.stdout.write(JSON.stringify(r, null, 2) + '\n')).catch(err => { console.error(err.stack); process.exitCode = 1; });
}
