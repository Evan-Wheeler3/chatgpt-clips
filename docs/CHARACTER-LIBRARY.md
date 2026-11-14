# Character library, matching, intake and approvals (Phase 5.5)

Hold Up keeps every character in one library, decides per script whether a character can be reused, and brings in new characters image-first: a human or an image model draws, and a human approves. The pipeline never invents character artwork and never approves its own work.

## Layout
| path | contents |
|---|---|
| `characters/<id>/` | managed characters: `character.json` (versioned vector definition), `reference.*`, `metadata.json`, `approved/`, `regression/`, optional `outfits/` and `accessories/` |
| `characters/intake/<id>/` | requested characters: `brief.md`, `brief.json`, `artwork-request.txt`, `artwork/` (imported sheets), `intake.json` (status and log) |
| `characters/<id>.json` | legacy and experimental designs (Bram, Phase 5.1–5.2 candidates). Listed in the catalog but never offered for reuse |
| `characters/catalog.json` | generated index of everything above (`node tools/characters/library.mjs catalog`) |
| `characters/style-guide.json` | style limits; the prose version is `docs/CHARACTER-STYLE-GUIDE.md` |
| `characters/roles.json` | role families and aliases used by the resolver |

**Library record** (`metadata.json` → `library`):
- roles and family, physical description, personality, historical context;
- era, regions, age, build, settings;
- outfits (each with era, tags and approval status) and accessories;
- rights.

**Rights are separate from visual approval.** `rights.confirmed` stays `false` until the owner confirms commercial-use terms. The approved cooper is in that state.

## Commands
```bash
node tools/characters/library.mjs catalog                 # rebuild characters/catalog.json
node tools/characters/library.mjs list | status <id>
node tools/characters/library.mjs approve <id> --stage design|rig|production --by "<reviewer>" [--evidence "<note>"]
node tools/characters/library.mjs reject  <id> --stage ... --by "<reviewer>"

node tools/characters/intake.mjs brief stories/<story>/characters.json [--slot a,b]   # resolve roles, write briefs
node tools/characters/intake.mjs import <intake-id> --image <file> --source chatgpt-image|illustrator|owner-drawn|other --rights "<owner and terms>" [--creator "<name>"]
node tools/characters/intake.mjs approve|reject <intake-id> --by "<reviewer>"          # design decision
node tools/characters/intake.mjs promote <intake-id>                                   # after the vector definition is built
node tools/characters/intake.mjs list
```

## Character matching (`tools/characters/resolve.mjs`)
A story lists the characters it needs in `stories/<story>/characters.json`:
- slot, role, description, age and era;
- outfit needs (era, tags);
- garments, accessories and expressions;
- personality, silhouette, and who the character must contrast with.

For each request the resolver returns one of three decisions:
- **`reuse`:** an approved character *is* this person (same role or an alias in `roles.json`), the era overlaps, the age band matches, and an approved outfit fits the scene's period and tags.
- **`variant`:** it is the same person, but the scene needs an outfit or accessory with no approved artwork yet. Request variant artwork; the character itself is reused.
- **`new`:** nobody can play the part honestly. Intake starts.

**Hard constraints** (role identity, era, age band) are never relaxed:
- A different person in the same family (a blacksmith for a cooper) is reported but **not** substituted.
- Characters without rig approval are not offered, nor are legacy designs.
- Every candidate's reasons are in the output (`considered`).

**Rig report.** The resolver also reports which shared rig systems and existing forms a role reuses, and which garments and accessories need new artwork.

## Intake: from brief to animation-ready character
1. **Brief.** `intake.mjs brief` writes, for each `new` or `variant` role, a design brief built from the style guide and the story's requirements: who they are, silhouette, clothing, accessories, expressions, historical notes, artwork requirements and rig reuse. It also writes an **artwork request** ready to paste into ChatGPT image generation or send to an illustrator. No image API is assumed, so the pipeline stops here with status `awaiting-artwork`.
2. **Generate the sheet** outside the pipeline (ChatGPT, or an illustrator), following the request. Use the cooper sheet as the model of what a sheet contains.
3. **Import.** `intake.mjs import` checks:
   - the format (PNG/JPEG/WebP that actually decodes);
   - the size (at least 1536 × 1024);
   - that rights are recorded (unknown rights are refused);
   - that it isn't a duplicate.

   It then stores `artwork/sheet-v<n>.<ext>` with its SHA-256, source and rights. Status becomes `awaiting-design-approval`. Re-imports add new versions.
4. **Design approval.** A named human runs `intake.mjs approve <id> --by "<name>"` (or `reject`; a rejected design can be re-imported). Approval records the exact artwork hash. Names that look automated ("Claude", "bot", "pipeline", empty) are refused.
5. **Convert the approved sheet into a vector definition.** This is the Phase 5.3 method, done by a developer, not generated:
   - **Start:** create `characters/intake/<id>/character.json` with `render.mode: "vector-2d"`, `design.version`, and a palette sampled from the sheet's swatch pixels (record where each colour came from in `paletteSource`).
   - **Rig:** measure the 3/4 figure into millimetres. Set the rig to the character's own proportions (`heightMm`, `hipY`, `neckHeight`, `headCenter`, `shoulderHeight`, shoulder and hip offsets, limb lengths, `ankle`). Nothing has to match the cooper.
   - **Forms and face:** trace the forms the figure already supports (head, hair, neck, torso, collar, sleeves and cuffs, hands, legs, boots) from the measurements. Set `face` (eye, brow and mouth placement) and `expressions` from the expression row, with a `faceMap` for storyboard face names.
   - **New garments and accessories** (a hat brim, a coat, a holster) become attachment layers (see "Rig integration") or, if they replace the body's shape, new forms in `figure.mjs`.
   - **Iterate:** compare flat previews side by side with the sheet until it matches, and document differences instead of hiding them.
   - **Check:** `validateDefinition` (joints covered, features on the face, all storyboard faces resolve) must pass.
6. **Promote.** `intake.mjs promote <id>` moves the definition into `characters/<id>/`:
   - the approved sheet becomes `reference.*`;
   - `metadata.json` records the design approval (artwork hash, reviewer) bound to the new definition's hash;
   - rig and production approval start as pending.
7. **Rig approval.** Render review stills and a short rig test (`node tools/character-rig.mjs --character <id>`). A human approves with `library.mjs approve <id> --stage rig --by "<name>"`.
8. **Production approval.** After a story renders with the character in its environment, a human approves with `--stage production`.
9. **Lock.** Write regression baselines (`node tools/characters/regression.mjs --character <id> --update`) and the lock (`node tools/characters/lock.mjs <id>`), as for the cooper.

## Approval gates and versioning
| gate | question | needed for |
|---|---|---|
| design | Does the artwork match the brief and the Hold Up style? | promotion into the library |
| rig | Does the animated character faithfully preserve the approved artwork? | any story render (validation error `CHARACTER_NOT_APPROVED` otherwise) |
| production | Does it animate convincingly inside the final environment? | final delivery (`CHARACTER_PRODUCTION_PENDING` warning until then; `usableFor(id, 'final')`) |

**Versioning:**
- Approvals are stored per `design.version` and bound to the SHA-256 of `character.json`. Editing an approved definition voids that version's approvals, and validation fails, so changes need a new version and new approvals.
- Every decision is appended to `metadata.json` → `approvalLog`, including what it replaced.
- Approved artwork and baselines are also locked by `metadata.json` → `files`; see `characters/cooper/README.md`.

**Variants:** outfit and accessory files (`characters/<id>/outfits/<name>.json`, `accessories/<name>.json`) carry their own status in `library.outfits` and `library.accessories`. A story can only use approved ones (`CHARACTER_VARIANT_NOT_APPROVED`). A missing file stops compilation with a pointer to intake; nothing is substituted.

## Rig integration (reusable across characters)
**Shared, unchanged for every vector character:**
- the pose engine and its presets (scaled to each body), walk, push and touch IK;
- blinks, gaze and head turn, and feet grounding;
- the expression system, painter, card renderer, shadow and palette compensation;
- rig checks, regression and approval gates.

The contract is the state from `characterTrack`: pose angles, face, blink, gaze and contact.

**Per character:**
- `rig` (proportions and joint positions);
- `forms` (shapes);
- `face`, `expressions` and `faceMap`;
- `palette`.

**Attachments.** In a story, a cast member chooses `"outfit": "<name>"` and `"accessories": ["<name>"]`. Each file holds:
```json
{"palette": {"steel": "#8a8f96"}, "hide": ["apron", "straps"],
 "layers": [{"id": "revolver", "bone": "handF", "slot": "heldF", "outline": true,
             "shapes": [{"points": [[0, 0], [20, 0], [20, -60], [0, -60]], "fill": "steel", "smooth": 1}]}]}
```
- **Bones** (points in each bone's own millimetre frame; limbs hang along −y and x points forward):
  - `hip`, `torso`, `head` (head-centred), `cap`;
  - `upperArmF/B`, `forearmF/B`, `handF/B`;
  - `thighF/B`, `shinF/B`, `footF/B`.
- **Slots set the paint order:** `back`, `heldF` (in the far hand, behind the body), `body` (over the torso), `head` (over hair and cap), `front` (over the near arm).
- **`hide`** removes built-in garments an outfit replaces.
- The default cooper is unaffected; its regression baselines prove it.

## Demonstration: the 1873 Kansas saloon story
`stories/saloon-1873/characters.json` records the two roles from the story brief. Resolution: `production/saloon-1873/character-resolution.json`. Briefs: `characters/intake/saloon-1873-*`.
- **Gunfighter → `new`.** The cooper was considered and rejected: a cooper is not a gunfighter. It reuses the shared rig and the head, trouser, boot and hand forms. It needs new artwork: hat, moustache, shirt, waistcoat, coat or duster, neckerchief, cartridge belt and holster, revolver, glass.
- **Protagonist → `new`.** The cooper was rejected on role (not a time traveller) and era (1840–1890 against present day). It reuses the head, legs (as jeans) and hand forms. It needs new artwork: sweatshirt or T-shirt, sneakers, glass, phone.
- **Status:** both briefs are `awaiting-artwork`. No artwork has been generated or approved. The owner still decides the protagonist's gender and look, and the town.
