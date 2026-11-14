# Environments, art direction and 2D characters (Phase 5)

Phase 5 adds the finished look on top of the Phase 4 storyboard without changing its timing or camera engine. The same `story.json`, measured narration and `shots.json` drive every quality level. Visual layers are opt-in per story: `environment`, `style`, `cast` and character events.

```text
story.json ─┬─ environment: {id}  ──▶ environments/<id>.json ──compile──▶ cached world (catalog GLBs + texture catalog)
            ├─ style: {id, palette?, grade?} ─▶ styles/<id>.json (channel look) + story overrides
            ├─ cast: [{id, character, start}] ─▶ characters/<id>.json (vector parts + rig)
            └─ events: {character, do, at, ...} on the same word-anchored timeline as props and cameras
                                   │
            shots.json ──▶ animatic (fast, Phase 4 look) │ preview (styled, low-res) │ production (1080×1920)
```

## Commands
```bash
npm run storyboard -- --story stories/barrel-bilge/story.json                        # compile + validate (~0.5 s)
npm run storyboard -- --story ... --render                                           # animatic: Phase 4 look + characters (~40 s, CPU)
npm run storyboard -- --story ... --render --quality preview                          # styled, 360×640 (~7 s on an M1)
npm run storyboard -- --story ... --render --quality production --qa                 # styled, 1080×1920 (~24 s on an M1) + pixel QA
npm run storyboard -- --story ... --compare phase4-animatic,production               # side-by-side video + per-shot stills
npm run textures:register -- --provider polyhaven --id <id> [--approve --approved-by "<reviewer>"]
```
`HOLDUP_GPU=swiftshader` forces CPU rendering for preview and production, for CI or machines without Metal.

## Quality modes and budgets (`tools/render/quality.mjs`)
| quality | renderer | environment and style | post | character art | use |
|---|---|---|---|---|---|
| animatic | SwiftShader (deterministic) | Phase 4 plain stage | none | 0.4 px/mm | pacing and camera iteration |
| preview | Metal | full | grade and vignette | 0.5 px/mm | look review |
| production | Metal | full | bloom, grade, vignette, grain, 4× MSAA | 1.2 px/mm | final frames, no overlay |

**MacBook Air budgets** (M1, 8 GB): 1.2M triangles, 600 draw calls and about 420 MB of textures per frame in production. Environments are checked statically at compile time, and the GPU's actual counts are checked by `--qa`. The demo peaks at 737k triangles and 278 draw calls.

**Caching:**
- GLB silhouettes are cached by GLB SHA-256 in `.cache/shapes`.
- Compiled environments are cached by spec, catalog and palette hash in `.cache/environments`.
- Browser GLBs and textures are loaded once per render.
- Character art is drawn once per render.

Changing words, cuts, cameras or character events never rebuilds models or environments.

## Environment system
**Specs** (`environments/<id>.json`) are story-agnostic places:
- `bounds`, plus `keepClear` zones that stories stage in;
- `materials`: catalog textures with a tint and a style role;
- procedural `architecture`: `floor`, `walls` (with window and door openings), `plinth`, `piers`, `trusses`, `roof` and `rack` (racks auto-filled with catalog models);
- `dressing`: catalog models in foreground, midground or background layers;
- `lighting`: a sun with shadows through the openings, a cool fill, warm practicals with flicker and glow, and hemisphere ambient;
- `atmosphere`: fog, sun shafts and dust motes.

**Compiler** (`tools/environment/compile.mjs`):
- resolves every model by catalog id and every texture through `assets/texture-catalog.json`;
- expands racks into instances, using varied spins, rests computed from each spun silhouette, and gaps at piers and doors;
- computes world boxes for validation and estimates the budget.

Misses are recorded in `missing`, flagged in the overlay and raised by validation as `ENV_MISSING_*`. Nothing is substituted.

**Builder** (`tools/render/environment.mjs`):
- **Geometry:** UVs in metres everywhere, so textures tile at their published real-world size. Walls are extruded with real openings, so sunlight passes only through the windows.
- **Instancing:** identical catalog meshes are instanced, giving one draw call per mesh regardless of count. Background rack stock skips outlines and shadow casting.
- **Grounding:** contact darkening along walls and under every grounded model.
- **Atmosphere:** sun shafts are soft additive cones that fade toward the floor and near the camera. Dust motes drift deterministically and glow inside the shafts.

**Textures:** `fetchTexture` in the Poly Haven adapter downloads Diffuse, `nor_gl` and ARM JPEGs with the same verified, streamed, cache-revalidated path as models. It also records the published real-world size, and rejects non-texture assets.

**Demo environment:** `cooperage-storehouse`, a mid-19th-century cooperage storehouse. It uses four CC0 textures (cobblestone floor, medieval red brick, rough wood, dark planks) and six catalog models (barrel, crate, bucket, lantern, workbench, stepladder). It was enlarged from a vaulted-cellar idea because the Phase 4 turn shot rises to 4 m.

## Art direction: the Hold Up look (`styles/hold-up.json`, `tools/render/stylize.mjs`, `tools/render/post.mjs`)
**Channel identity:** a warm key against cool shadows, softened textures with gentle cel banding, warm-brown ink outlines, a warm rim light for readable silhouettes, light haze, a filmic grade and a vignette. Stories override `palette` and `grade`; the material treatment stays the channel's.

**Material treatment** by role (`hero` for story props, `set` for dressing, `architecture`). Realistic PBR assets are not assumed to match the style:
- **Texture detail:** softened through mip bias (`mapBias`).
- **Albedo:** pulled toward the palette (`tint`, `saturation`).
- **Specular:** controlled by a roughness floor and metalness scale. This stopped the barrel hoops rendering as chrome.
- **Banding:** gentle banding of the lit result (`bands`, `bandMix`).
- **Rim light** (`rim`).
- **Ink outline** by inverted hull (`outline`, in metres), which works on instanced meshes.

**Post:** neutral tone mapping, then bloom (production; threshold 1.05, so only windows and lantern flames bloom, never sunlit faces), then a display-space grade (contrast, saturation, cool shadow and warm highlight split toning, vignette, grain).

## 2D characters in 3D (`characters/*.json`, `tools/render/character-rig.mjs`, `tools/storyboard/character.mjs`)
**Design:** original, drawn from SVG paths in each part's own frame. Bram is a cooper's apprentice with a big head, compact body, cap, apron and rolled sleeves. Parts:
- torso, head, cap, eyes and pupils, brows;
- mouth variants (neutral, smile, grin, oh, grit, hmm);
- arm, hand (open, fist, point, thumbs) and leg segments.

Ink outlines are baked into the art in the style's outline colour. Appearance is fixed per character definition, so it is consistent across shots.

**In the scene:**
- **Parts:** alpha-tested quads in a bone hierarchy, so depth testing handles occlusion by 3D props, and he can stand behind a barrel. The rig yaws to face the camera and mirrors to face left or right on screen.
- **Lighting:** characters are lit by the scene, with a little self-light for readability.
- **Shadows:** a second, invisible rig facing the key light casts the shadow, plus a contact shadow at the feet.

**Behaviour** (pure and shared, so validation and rendering agree):
- **Mirroring:** derived from the world facing direction and the current camera. A flip mid-shot animates a quick turn; at a cut it snaps.
- **Secondary motion:** blinks are deterministic, breathing is subtle, and the head and cap follow through on damped, clamped springs that reset at cuts.

## Animation presets and actions
Character events use the same anchors as everything else (`at`, `until`, `duration`, `"shot-start"`).

**Actions:**
- `place {position | near, side, gap, face}`: must be on a cut, and cancels any walk in progress.
- `walk {to}`: stride-locked cycle (no foot sliding), with bob, counter-swing and squash.
- `pose {preset, target}`: blends in with a settle; timed poses release back to idle.
- `push {prop, height}`: a 10-frame anticipation crouch, then two-bone arm IK solved onto the prop's visible edge for a 4-frame contact window, then follow-through.
- `look {at}`: eyes track a prop, `camera` or a point.
- `expression {face}`.

**Pose presets:** `idle`, `think`, `point`, `present`, `ready`, `push`, `thumbs-up`, `surprised`, `shrug`, with anticipation wind-ups where it helps.

**Faces:** `neutral`, `happy`, `proud`, `curious`, `surprised`, `effort`.

## Validation and QA
Automated checks are review triggers. They don't replace watching the frames, and they're kept separate from the human review step.

**Plan validation** (`validate.mjs`, added to Phase 4's checks):
- **Environment:**
  - `ENV_MISSING_TEXTURE` / `ENV_MISSING_ASSET` and `ENV_INTRUSION`
  - `CAMERA_OUTSIDE_ROOM` and `CAMERA_COLLISION` (with dressing and architecture)
  - `SUBJECT_OCCLUDED` (by dressing, unless it's in the foreground layer)
- **Characters:**
  - errors: `CHARACTER_CLIPPING`, `CHARACTER_FLOATING`, `CHARACTER_POP`, `PLACE_NOT_ON_CUT`, `CHARACTER_NO_CONTACT`
  - warnings: `PUSH_NOT_SYNCED`, `CHARACTER_ACTION_OFF_SCREEN`, `CHARACTER_FACE_IN_CAPTION_ZONE` (caption band for Phase 6), `CHARACTER_OCCLUDES_SUBJECT`, `CHARACTER_OFF_MODEL`

**Pixel QA** (`--qa`, `tools/render/qa.mjs`): renders clean frames at each shot's start, focus words, middle and end, and reports:
- `FRAME_TOO_DARK`, `FRAME_TOO_BRIGHT`, `FRAME_CRUSHED`, `FRAME_BLOWN`
- `SUBJECT_LOW_CONTRAST`, `CHARACTER_LOW_CONTRAST`
- `RENDER_OVER_BUDGET` (GPU-reported triangles and draw calls)
- `RENDER_ERROR` (page, shader or load errors)

The output is `qa-<quality>.json`.

**Visual review artifacts:** `storyboard-<quality>.png`, `compare-phase4-animatic-vs-production.{mp4,png}`, and the MP4s themselves.

## Things the demo review caught and fixed
- **Pivot on the spot:** `pivot` rotated about the model origin, which for a barrel lying on its side is one end. It now turns about the prop's centre. This changes the Phase 4 turn shot as the narration intended ("right on the spot").
- **Chrome hoops:** the hoops read as chrome until the roughness floor and metalness scale were added.
- **Over budget:** the first build was at 1.3M triangles until racked stock stopped casting shadows and carrying outlines.
- **Flat light:** the sun shafts washed a whole shot into flat colour until they faded near the camera, and the window was a flat card until it got a gradient.
- **Glowing art:** bloom made sunlit eye whites and hands glow until the threshold was raised above any lit surface.
- **Character bugs:** the cap spun off on cuts, until springs reset and clamped. Facing animated a turn on cuts. A walk overriding a `place` showed up only in a test.

## Remaining limitations
- **One of each:** there is one environment (`cooperage-storehouse`) and one character (Bram). New places and characters are authored as JSON; there's no generator.
- **Character design:** Bram is a 3/4-view cutout only. There are no front or back turnarounds, no lip sync and only a few hand and mouth variants. Because the rig billboards toward the camera, he never shows his back.
- **Contact:** hands are solved in the character's camera-facing plane against the prop's screen-space edge. For strongly oblique pushes, the contact is convincing on screen rather than in 3D.
- **Stylization limits:** textures are softened photography, not hand-painted. Outlines have small gaps at hard-edged normals, and architecture has none. "Exaggerated proportions" come from the character design and chunky timber, not from deforming props.
- **Lighting approximations:** shafts and fog are approximations (no volumetrics or GI), and reflections use a generic room environment.
- **Pixel QA metrics are coarse:** contrast compares a bounding rectangle with a ring around it. It flags Bram as low-contrast in the contact shot, where he is deliberately half hidden behind the barrel.
- **Composition:** the hoops shot's background is mostly warm haze and wall.
- **GPU differences:** preview and production use the GPU, so tiny differences between machines are possible. The animatic stays deterministic.
- **Pending approvals:** the three new models and four textures are registered with Claude Code's preview approval, pending human confirmation.
