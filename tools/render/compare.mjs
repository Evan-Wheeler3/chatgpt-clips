import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sheetFrame } from '../storyboard/animatic.mjs';

const run = promisify(execFile);
const FONTS = ['/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
const LABELS = {'phase4-animatic':'Phase 4 animatic', animatic:'Phase 5 animatic', preview:'Phase 5 preview', production:'Phase 5 production'};

async function font() {
  for (const path of FONTS) if (await access(path).then(() => true, () => false)) return path;
  return null;
}

// Side-by-side video and per-shot stills of the same plan rendered at different qualities (e.g. animatic vs production)
export async function compareRenders(plan, {outDir, videos = ['animatic', 'production'], height = 640}) {
  const inputs = videos.map(name => join(outDir, `${name}.mp4`));
  for (const path of inputs) await access(path).catch(() => { throw new Error(`Missing ${path}; render it first with --render --quality ...`); });
  const fontfile = await font();
  const label = (i, name) => `scale=-2:${height},setsar=1` + (fontfile
    ? `,drawtext=fontfile=${fontfile}:text='${LABELS[name] ?? name}':x=12:y=12:fontsize=${Math.round(height / 32)}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8`
    : '');
  const filter = videos.map((name, i) => `[${i}:v]${label(i, name)}[v${i}]`).join(';') + ';' + videos.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${videos.length}[v]`;
  const video = join(outDir, `compare-${videos.join('-vs-')}.mp4`);
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...inputs.flatMap(p => ['-i', p]), '-filter_complex', filter, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', (plan.durationFrames / plan.fps).toFixed(3), video], {maxBuffer:64 * 1024 * 1024});

  // Stills: one row per shot at its key frame, one column per render
  const frames = plan.shots.map(sheetFrame);
  const select = `select='${frames.map(f => `eq(n\\,${f})`).join('+')}'`;
  const stillFilter = videos.map((name, i) => `[${i}:v]${select},${label(i, name)},tile=1x${frames.length}[c${i}]`).join(';') + ';' + videos.map((_, i) => `[c${i}]`).join('') + `hstack=inputs=${videos.length}`;
  const stills = join(outDir, `compare-${videos.join('-vs-')}.png`);
  await run('ffmpeg', ['-loglevel', 'error', '-y', ...inputs.flatMap(p => ['-i', p]), '-filter_complex', stillFilter, '-frames:v', '1', '-vsync', '0', stills], {maxBuffer:64 * 1024 * 1024});
  return {video, stills, frames};
}
