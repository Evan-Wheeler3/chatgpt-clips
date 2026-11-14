import { readFile, writeFile, mkdir, copyFile, access, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from './library.mjs';
import { resolveCast } from './resolve.mjs';
import { validateDefinition } from './validate.mjs';

/*
 * New-character intake (image first). The pipeline never invents character artwork:
 *   brief    resolver says "new" or "variant" -> design brief + artwork request (for ChatGPT image generation or an illustrator)
 *   import   a human supplies the image -> format, size, rights and duplicate checks; status awaiting-design-approval
 *   approve  a named human approves (or rejects) the design
 *   promote  after a vector definition has been built from the approved artwork and passes validation, the character
 *            moves to characters/<id>/ with design approval recorded and rig/production approval pending
 * Statuses: awaiting-artwork -> awaiting-design-approval -> design-approved | design-rejected -> promoted
 */
const run = promisify(execFile);
const exists = path => access(path).then(() => true, () => false);
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const today = () => new Date().toISOString().slice(0, 10);
const NOT_A_PERSON = /^(|claude.*|ai|assistant|bot|automation|auto|pipeline|system|ci|test)$/i;
export const SOURCES = ['chatgpt-image', 'illustrator', 'owner-drawn', 'other'];
const dirOf = (id, root) => join(root, 'characters', 'intake', id);

export async function readIntake(id, root = ROOT) { return readJson(join(dirOf(id, root), 'intake.json')); }
async function saveIntake(intake, root, event) {
  intake.log = [...(intake.log ?? []), {on:today(), ...event}];
  await writeJson(join(dirOf(intake.id, root), 'intake.json'), intake);
  return intake;
}

// Design brief and artwork request, written for a person or an image model; built from the style guide and the request
export function writeBrief(request, resolution, styleGuide, {story, premise, setting}) {
  const sg = styleGuide, variant = resolution.decision === 'variant';
  const subject = variant ? `an outfit/accessory variant for the approved character "${resolution.character}"` : `a new character: ${request.role}`;
  const prompt = [
    `Character design sheet for an original 2D cartoon character for "Hold Up", a YouTube Shorts channel. ${request.description}`,
    `Setting: ${setting.place}, ${setting.era}. Age: ${request.age}. Personality: ${request.personality}.`,
    `Style: simple, bold 2D cartoon with flat colours and one thick, even, dark warm outline around every shape; no gradients, textures or hatching. Round, simple face: solid dark oval eyes with no whites, short thick dark eyebrows that carry the expression, no nose or only a tiny mark, a simple line or shape for the mouth. Stylized compact proportions about ${sg.proportions.headsTall.adult[0]}-${sg.proportions.headsTall.adult[1]} heads tall, large readable head, simple mitten-like hands.`,
    `Silhouette: ${request.silhouette}.`,
    `Clothing and details: ${request.garments.filter(g => !/head|mitten/.test(g)).join(', ')}. Muted, period-appropriate colours, at most ${sg.color.maxClothingColors} clothing colours, one warm accent at most.`,
    `Accessories, each also drawn separately: ${request.accessories.join(', ')}.`,
    `Sheet layout on a plain light background: a full-body 3/4 view facing screen right (most important), plus front, side and back views; an expression row with ${[...request.expressions.required, ...request.expressions.role.map(e => e.split(' (')[0])].join(', ')}; colour swatches with hex labels.`,
    `Do not imitate any existing character, studio or creator; do not resemble a real person; no logos, watermarks or text over the figure.`
  ].join('\n\n');
  return {
    story, slot:request.slot, kind:variant ? 'variant' : 'new', subject, premise,
    character:{role:request.role, age:request.age, era:request.era, personality:request.personality, description:request.description, silhouette:request.silhouette, contrastWith:request.contrastWith ?? null},
    clothing:request.garments, accessories:request.accessories, expressions:request.expressions, historicalNotes:request.historicalNotes ?? null,
    styleGuide:{version:sg.version, basedOn:sg.basedOn, document:'docs/CHARACTER-STYLE-GUIDE.md'},
    artworkRequirements:{formats:sg.artwork.formats, minLongEdgePx:sg.artwork.minLongEdgePx, minShortEdgePx:sg.artwork.minShortEdgePx, background:sg.artwork.background, views:sg.artwork.views, sheet:sg.artwork.sheet, forbidden:sg.artwork.forbidden},
    rig:resolution.rig,
    artworkRequest:prompt
  };
}

function briefMarkdown(id, brief) {
  const list = items => items.map(i => `- ${i}`).join('\n');
  return `# Character brief: ${id}

**Story:** ${brief.story} · **Slot:** ${brief.slot} · **Request:** ${brief.subject}
**Status:** awaiting artwork. Nothing is drawn or approved yet.

${brief.premise}

## Who they are
- **Role:** ${brief.character.role}
- **Age:** ${brief.character.age}
- **Era:** ${brief.character.era}
- **Personality:** ${brief.character.personality}
- **Silhouette:** ${brief.character.silhouette}
${brief.character.contrastWith ? `- **Must contrast with:** ${brief.character.contrastWith}\n` : ''}
## Clothing
${list(brief.clothing)}

## Accessories (each also drawn separately)
${list(brief.accessories)}

## Expressions
- **Required:** ${brief.expressions.required.join(', ')}
- **For this role:**
${list(brief.expressions.role).replace(/^/gm, '  ')}
${brief.historicalNotes ? `\n## Historical notes (${brief.historicalNotes.status})\n${list(brief.historicalNotes.notes)}\n` : ''}
## Artwork requirements
- **Format:** ${brief.artworkRequirements.formats.join('/')}, at least ${brief.artworkRequirements.minLongEdgePx}×${brief.artworkRequirements.minShortEdgePx} px
- **Background:** ${brief.artworkRequirements.background}
- **Views:** ${brief.artworkRequirements.views.required.join('; ')} (required); ${brief.artworkRequirements.views.recommended.join(', ')} (recommended)
- **Sheet:** ${brief.artworkRequirements.sheet.join('; ')}
- **Forbidden:** ${brief.artworkRequirements.forbidden.join('; ')}

## Rig reuse
- **Shared systems reused unchanged:** ${brief.rig.reuse.length} (skeleton, poses, walk, IK, expressions, renderer, checks)
- **Existing forms that fit:** ${brief.rig.reusableForms.join(', ') || 'none'}
- **Needs new artwork (forms or attachment layers):** ${brief.rig.newArtwork.join(', ') || 'none'}

## Artwork request (paste into ChatGPT image generation, or send to an illustrator)
\`\`\`text
${brief.artworkRequest}
\`\`\`

## Next steps
1. Generate or commission the sheet, then import it:
   \`node tools/characters/intake.mjs import ${id} --image <file> --source chatgpt-image --rights "<who owns it and the commercial terms>"\`
2. Review the sheet, then approve or reject the design:
   \`node tools/characters/intake.mjs approve ${id} --by "<your name>"\` (or \`reject\`)
3. Rebuild the approved sheet as a vector definition in \`characters/intake/${id}/character.json\` (see \`docs/CHARACTER-LIBRARY.md\`), then:
   \`node tools/characters/intake.mjs promote ${id}\`
`;
}

export async function createBriefs(storyFile, {root = ROOT, slots = null} = {}) {
  const spec = await readJson(resolve(root, storyFile)), sg = await readJson(join(root, 'characters', 'style-guide.json'));
  const requests = spec.requests.filter(r => !slots || slots.includes(r.slot));
  const resolutions = await resolveCast(requests, root);
  const created = [];
  for (const [i, request] of requests.entries()) {
    const resolution = resolutions[i];
    if (resolution.decision === 'reuse') { created.push({slot:request.slot, decision:'reuse', character:resolution.character}); continue; }
    const id = `${spec.story}-${request.slot}`, dir = dirOf(id, root);
    await mkdir(join(dir, 'artwork'), {recursive:true});
    const brief = writeBrief(request, resolution, sg, {story:spec.story, premise:spec.premise, setting:{place:spec.setting.place, era:spec.setting.era}});
    await writeJson(join(dir, 'brief.json'), brief);
    await writeFile(join(dir, 'brief.md'), briefMarkdown(id, brief));
    await writeFile(join(dir, 'artwork-request.txt'), brief.artworkRequest + '\n');
    const previous = await exists(join(dir, 'intake.json')) ? await readIntake(id, root) : null;
    const intake = previous ?? {id, name:`${request.slot} (${spec.story})`, status:'awaiting-artwork', story:spec.story, slot:request.slot, created:today(),
      request:{roles:[request.role], era:{from:request.era, to:request.era}, description:request.description, age:request.age}, resolution:{decision:resolution.decision, character:resolution.character ?? null}, artwork:[], approvals:{}};
    if (!previous) await saveIntake(intake, root, {event:'brief', decision:resolution.decision});
    created.push({slot:request.slot, decision:resolution.decision, intake:id, status:intake.status});
  }
  return {resolutions, created};
}

async function probe(file) {
  try {
    const {stdout} = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,width,height', '-of', 'json', file]);
    const s = JSON.parse(stdout).streams?.[0];
    return s && s.width > 0 && s.height > 0 ? {codec:s.codec_name, width:s.width, height:s.height} : null;
  } catch { return null; }
}

export async function importArtwork(id, {image, source, rights, creator = null, root = ROOT}) {
  const intake = await readIntake(id, root), sg = await readJson(join(root, 'characters', 'style-guide.json'));
  if (intake.status === 'promoted') throw new Error(`${id} is already promoted; create a new design version instead`);
  if (!SOURCES.includes(source)) throw new Error(`--source must be one of ${SOURCES.join(', ')}`);
  if (!rights || /^(unknown|none|n\/a|tbd|\?)$/i.test(rights.trim())) throw new Error('Record who owns the artwork and its commercial-use terms with --rights; unknown rights cannot be imported');
  const ext = extname(image).slice(1).toLowerCase();
  if (!sg.artwork.formats.includes(ext)) throw new Error(`Artwork must be ${sg.artwork.formats.join('/')} (got .${ext})`);
  const info = await probe(image);
  if (!info || !['png', 'mjpeg', 'webp'].includes(info.codec)) throw new Error(`${image} is not a readable image`);
  const [long, short] = [Math.max(info.width, info.height), Math.min(info.width, info.height)];
  if (long < sg.artwork.minLongEdgePx || short < sg.artwork.minShortEdgePx) throw new Error(`Artwork is ${info.width}×${info.height}; the style guide needs at least ${sg.artwork.minLongEdgePx}×${sg.artwork.minShortEdgePx}`);
  const sha256 = createHash('sha256').update(await readFile(image)).digest('hex');
  if (intake.artwork.some(a => a.sha256 === sha256)) throw new Error('This exact image was already imported');
  const version = intake.artwork.length + 1, file = `artwork/sheet-v${version}.${ext}`;
  await copyFile(image, join(dirOf(id, root), file));
  intake.artwork.push({version, file, sha256, width:info.width, height:info.height, source, creator, rights, importedOn:today()});
  intake.status = 'awaiting-design-approval';
  return saveIntake(intake, root, {event:'import', file, sha256, source});
}

export async function decideDesign(id, decision, {by, evidence = '', root = ROOT}) {
  const intake = await readIntake(id, root);
  if (NOT_A_PERSON.test((by ?? '').trim())) throw new Error(`Design decisions need the name of the human reviewer (got "${by ?? ''}"); the pipeline cannot approve its own work`);
  const latest = intake.artwork.at(-1);
  if (!latest) throw new Error(`${id} has no artwork to review; import it first`);
  if (intake.status !== 'awaiting-design-approval') throw new Error(`${id} is ${intake.status}, not awaiting design approval`);
  intake.approvals.design = {status:decision, by:by.trim(), on:today(), evidence, artwork:latest.file, artworkSha256:latest.sha256};
  intake.status = decision === 'approved' ? 'design-approved' : 'design-rejected';
  return saveIntake(intake, root, {event:`design-${decision}`, by:by.trim(), artwork:latest.file});
}

export async function promote(id, {root = ROOT} = {}) {
  const intake = await readIntake(id, root), dir = dirOf(id, root);
  if (intake.status !== 'design-approved') throw new Error(`${id} is ${intake.status}; only an approved design can be promoted`);
  const defFile = join(dir, 'character.json');
  if (!await exists(defFile)) throw new Error(`${id}: no vector definition yet; rebuild the approved artwork as characters/intake/${id}/character.json first (docs/CHARACTER-LIBRARY.md)`);
  const def = await readJson(defFile), report = validateDefinition(def);
  if (def.render?.mode !== 'vector-2d') throw new Error(`${id}: the definition must use render.mode "vector-2d"`);
  if (report.status === 'failed') throw new Error(`${id}: the definition fails validation: ${report.errors.map(e => e.message).join('; ')}`);
  if (!def.design?.version) throw new Error(`${id}: character.json needs design.version`);
  const target = join(root, 'characters', def.id);
  if (await exists(target)) throw new Error(`characters/${def.id} already exists`);
  await mkdir(target, {recursive:true});
  const art = intake.artwork.find(a => a.sha256 === intake.approvals.design.artworkSha256);
  const reference = `reference${extname(art.file)}`;
  await copyFile(join(dir, art.file), join(target, reference));
  def.reference = `characters/${def.id}/${reference}`;
  def.design.status = 'rig-pending';
  await writeJson(join(target, 'character.json'), def);
  const definitionSha256 = createHash('sha256').update(await readFile(join(target, 'character.json'))).digest('hex');
  const brief = await readJson(join(dir, 'brief.json'));
  const design = {...intake.approvals.design, status:'approved'};
  await writeJson(join(target, 'metadata.json'), {
    id:def.id, name:def.name, designVersion:def.design.version, status:'rig-pending',
    library:{roles:intake.request.roles, description:intake.request.description, era:intake.request.era, age:intake.request.age, personality:brief.character.personality,
      outfits:{default:{default:true, status:'approved', era:intake.request.era, tags:[], version:def.design.version}}, accessories:{},
      rights:{artwork:reference, creator:art.creator, source:art.source, commercialUse:art.rights, confirmed:false}},
    approvals:{[def.design.version]:{definitionSha256, design}},
    approvalLog:[{version:def.design.version, stage:'design', decision:'approved', previous:'pending', by:design.by, on:design.on, evidence:design.evidence, artworkSha256:design.artworkSha256, definitionSha256}],
    intake:`characters/intake/${id}/`
  });
  intake.status = 'promoted';
  intake.promotedTo = `characters/${def.id}/`;
  await saveIntake(intake, root, {event:'promote', to:intake.promotedTo});
  return {id:def.id, folder:intake.promotedTo, next:'render review stills with tools/character-rig.mjs, then `library.mjs approve <id> --stage rig --by "<reviewer>"`'};
}

export async function listIntake(root = ROOT) {
  const dir = join(root, 'characters', 'intake');
  if (!await exists(dir)) return [];
  return Promise.all((await readdir(dir)).map(id => readIntake(id, root).then(i => ({id, status:i.status, slot:i.slot, decision:i.resolution?.decision}), () => null))).then(l => l.filter(Boolean));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, arg, ...rest] = process.argv.slice(2), opt = name => rest.includes(name) ? rest[rest.indexOf(name) + 1] : undefined;
  const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  const go = async () => {
    if (command === 'brief') return print(await createBriefs(arg, {slots:opt('--slot')?.split(',')}));
    if (command === 'import') return print(await importArtwork(arg, {image:resolve(process.cwd(), opt('--image') ?? ''), source:opt('--source'), rights:opt('--rights'), creator:opt('--creator')}));
    if (command === 'approve' || command === 'reject') return print(await decideDesign(arg, command === 'approve' ? 'approved' : 'rejected', {by:opt('--by'), evidence:opt('--evidence') ?? ''}));
    if (command === 'promote') return print(await promote(arg));
    if (command === 'list') return print(await listIntake());
    throw new Error('Usage: intake.mjs brief <story characters.json> [--slot a,b] | import <id> --image <file> --source <src> --rights "<terms>" [--creator <name>] | approve|reject <id> --by "<reviewer>" [--evidence "<note>"] | promote <id> | list');
  };
  go().catch(err => { console.error(err.message); process.exitCode = 1; });
}
