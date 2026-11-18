# The approved cooper and the vector character rig (Phases 5.3–5.4)

**Status:** the cooper (design 1.0.0) is the **approved Hold Up master character**. The human approved the design and the five-second rig test.
- Since Phase 5.4 the cooper stars in `stories/barrel-bilge`.
- Bram (`characters/bram.json`, `status: "legacy"`) is kept for reference only.

**Visual source of truth:** `characters/cooper/reference.png`, the approved Hold Up character sheet.
- It is a raster image, not a layered source file. The character was rebuilt as vector shapes measured from the sheet's 3/4 turnaround figure and expression heads; nothing was traced or extracted.
- The sheet's logo and background render are presentation, not character content.

## Commands
```bash
node tools/character-rig.mjs                       # production review: stills, rig-test.mp4, validation.json (~25 s on an M1)
node tools/character-rig.mjs --quality preview     # faster look check
node tools/characters/regression.mjs               # compare the cooper with its approved baselines (~9 s)
node tools/character-rollout.mjs --cast cooper --approved production/character-rig/cooper --current production/character-rig/cooper-5.4
                                                   # rollout report and regression sheet for a story (production/<story>/)
node --test tests/character-rig.test.mjs tests/character-regression.test.mjs
```
Outputs go to `production/character-rig/cooper/`, which is gitignored:
- `reference-comparison.png`, `neutral.png`, `expressions.png`, `with-barrel.png`, `in-environment.png`
- `rig-test.mp4`
- `validation.json`

## Why a vector rig (not layered cutouts, not hybrid 3D)
The Phase 5 cutout rig drew each part as its own outlined card, which caused three problems:
- seams and doubled outlines at every joint;
- pivots showing when limbs rotated;
- a puppet-like look overall.

The Phase 5.2 hybrid fixed the joints, but its 3D forms could not match a flat, thick-outlined drawing like the approved sheet.

The chosen approach (`render.mode: "vector-2d"`) **repaints the whole figure every frame** from the shared pose state:
- **One painting per frame.** Each limb chain (forearm with hand, thigh with shin) is one outlined group: all outlines are stroked before any fill. Joints inside a chain have no seam and no doubled line, and pivots can never show.
- **Deliberate seams only.** The lines the reference actually draws (sleeve ends, rolled cuffs, boot tops, the apron edge) are separate groups painted on top, in the reference's order: far arm and legs behind the body, near arm in front.
- **Constant line weight.** The outline is set in screen pixels from the figure's on-screen size, using the sheet's "≈6–8 px at 1080p" (`render.outlineRatio`, `render.outlinePx`). Line weight holds from wide shots to close-ups.
- **Sharp at any distance.** Only the part of the figure inside the frame is painted, at about screen resolution, so close-ups stay sharp without huge textures.
- **In the 3D scene.** The canvas is mapped onto a camera-facing card, so depth testing still handles occlusion by 3D props. A second card facing the key light casts a real silhouette shadow, plus the existing contact shadows.

```text
story.json ─▶ compile ─▶ castTracks (pure, shared): pose angles, face, blink, gaze, contact
                                   │
          tools/characters/figure.mjs (pure): forward kinematics ─▶ display list in rig millimetres
                │                                   │
   tools/characters/rig-checks.mjs           tools/render/character-vector.mjs (browser)
   (joint cover, limb lengths; Node tests)    paint ─▶ CanvasTexture ─▶ camera-facing card + shadow card
```

## Rig
The rig is the same pose engine as Phase 5 (`tools/storyboard/character.mjs`); there is no new animation system. It supports:
- **Bones:** hip, torso lean, neck/head (rotation and tilt), cap follow-through, shoulder, elbow and wrist on both arms, hip, knee and ankle on both legs.
- **Existing behaviour:** walk cycle, pose presets with anticipation, push with two-bone IK, deterministic blinks, springs.

**Added in 5.3:**
- **`touch {prop, height = 1, hand = 'F', frames, release}`:** one hand reaches onto a prop (by default its near top rim), rests there until the action ends, then releases. It is solved with the same two-bone IK as `push`. A touch that cannot reach is reported as `CHARACTER_NO_CONTACT`, never faked.
- **`gaze`:** a smoothed copy of the look direction, so eyes ease toward a target instead of snapping. The vector rig also slides the face features across the head with it (a 2D head turn) and nods slightly when the gaze drops (`face.nod`). Cutout rigs ignore it.
- **Pose timing:** `pose` accepts `frames` and `ease` (blend in) and `release` (blend out); the defaults are unchanged.
- **Faces:** the approved core set (speaking, concerned, thinking, confused, determined, realization, disappointed) was added to `FACES`, and each cutout rig maps them onto its nearest mouth.
- **Fix: shoulders turn with the torso.** The arm IK and `rigPoints` now rotate the shoulder offset with the torso, which is what the renderers' bone hierarchies already did. `stories/barrel-bilge` validates the same before and after (no errors, no warnings).

**Accessories:** the cap is its own frame (`forms.cap.pivot`, `tilt`, `drop`) on the head and follows through on the existing cap spring. Hair is drawn between the head and the cap, so it can't float free of either.

## Character and prop motion standards

Use the approved character definition, proportions, silhouette, line weight and existing pose engine. Plan each action at the camera angle that will ship. The approved vector cooper is a camera-facing 3/4 rig with mirrored views. Favor a supported view and act through the turn or re-stage the camera when a move would expose a missing angle or cause an abrupt mirror flip. For actions beyond the supported rig vocabulary, use the existing hand-directed episode path and prove the result in-engine. See [camera direction](CAMERA-DIRECTION.md) and [motion QA](MOTION-QA.md).

### Locomotion and pose transitions

- Block a route through the set with intent, clearances, steps, stops and changes of direction. Plan body translation and stride phase together. A walk transfers weight over the support foot before the free leg swings. A run carries greater momentum and may have an airborne phase. Match stride length and cadence to root speed and character scale.
- Lock the supporting foot relative to the floor, slope or moving platform during its plant. Track both toe and heel when the foot rolls through the step. Position the pelvis over support, maintain plausible leg reach, and transition with weight transfer and knee bend. Use local foot targets or contact-aware IK when available. Inspect in camera and from an alternate angle where possible.
- Integrate turns into approaching or planted steps. Lead with attention, pivot through the supporting foot and let the torso, hips and footfalls agree with the new direction. Carry speed across continuing segments. At a real stop, absorb momentum into the final step and settle the body. Blend poses at compatible action phases and preserve the state on both sides of an edit.

### Physical actions and interactions

| Action | Direct and verify |
|---|---|
| Grab, release and carry | Stage the grip point, reach and contact frame. Align the hand to a prop socket or visible grip and preserve the evaluated world transform when changing ownership. During carry, keep contact fixed and let the actor's load affect posture and steps. At release, continue the prop trajectory with the intended momentum or support it on a surface. |
| Push and pull | Show the setup, force and result in that order. Plant the feet, align lean and arm force, keep the hand on the surface, and start prop motion with the force. Release or regain balance as it stops or moves away. |
| Sit and stand | Mark the seat and foot locations. Bring the hips to seat height without penetration. Transfer weight from the seat onto planted feet before straightening. Avoid letting the character hover during a hold. |
| Turn, react and avoid obstacles | Stage the stimulus so the reaction reads as cause and effect. Allow eyes or head to lead, then turn through torso, hips and steps. Plot a route with enough clearance for limbs and carried objects. Land on a distinct readable pose or direction. |

Use concise anticipation, primary movement, follow-through and settling where the action benefits. Ordinary grabs and turns can begin promptly. Match force and mass with the extent and duration of the windup, contact, recovery and residual motion. Check hands, feet, weights and moving props at the contact frame and neighboring frames. A freely moving prop needs continuous position and velocity through a transfer. An intentional impact can change velocity sharply at the contact frame.

Use arms, torso overlap, clothing, accessories, blinks and breathing to support the main action. During an active beat, assign a clear large action or a camera composition that meaningfully evolves. Secondary movement alone cannot carry the beat.

### Implementation notes

- Reuse `walk`, `pose`, `push`, `touch` and the existing gaze and expression tracks in [`character.mjs`](../tools/storyboard/character.mjs) where they fit. Current reach IK works in the camera-facing plane. Inspect an oblique camera or new contact visually. [`sockets.mjs`](../tools/storyboard/sockets.mjs) and [`attach.mjs`](../tools/storyboard/attach.mjs) supply existing prop attachment and contact tools. The declarative path has no general hand-parent switching or full-body plant solver.
- For a specialized Blender asset or full armature where one already fits the shot, author foot targets in the support frame, position the root relative to them, and key hand/prop attachment constraints with a transform match at switches. Use compatible pose phases for clip blends and inspect the evaluated result across the full shot. Bake and compare any exported animation in the actual production renderer before relying on it.
- Keep story-specific blocking and contact timing outside locked character assets. Cover walk-to-turn, grab-to-carry, release and cut continuity in the preview. Keep the current design regression checks when extending the animation code.

## Colour
- **Palette:** the sheet's swatches, sampled from their pixels. The sheet's printed hex labels were unreliable, and one wasn't a valid colour. Boots and mouth have no swatch, so they were sampled from the drawn figure; the tongue is an estimate (`paletteSource` in the definition).
- **Display compensation** (`tools/characters/display.mjs`): the scene's NeutralToneMapping subtracts a small offset that crushes dark browns, and the channel grade adds saturation, contrast and split toning. Measured drift without compensation was ΔE 15–17 on the browns.
  - The vector rig paints colours pre-compensated through a JavaScript model of that chain, so under neutral light the palette shows on screen.
  - Measured in the production studio still: ΔE 0.6–2.7 across skin, shirt, apron, trousers, cap and hair.
  - The outline is left as authored: the chain can only show it darker, which keeps silhouettes readable in dark sets.
  - Scene light still tints the character through the existing environment tint.

## Reuse for future characters
*Phase 5.5:* the library, resolver, intake workflow, approval gates and attachment layers are documented in `docs/CHARACTER-LIBRARY.md`; the style rules in `docs/CHARACTER-STYLE-GUIDE.md`.

A new character is a new `characters/<id>.json` with `render.mode: "vector-2d"`. Everything else is shared:
- **`rig`:** bone lengths and pivots in millimetres. Poses, walk, push, touch and IK scale with them.
- **`forms`:** part shapes in their own frames: torso and apron outlines, collar, cap crown, brim and band, head radii (`crown` and `jaw` shape it), hair blob, sleeve, cuff, forearm and hand sizes, leg width, boot.
- **`face` and `expressions`:** feature placement and the expression set. `faceMap` maps storyboard face names onto the character's own expressions.
- **`palette`:** colours, compensated automatically.

`validateDefinition` checks:
- required keys, colours, and that every storyboard face resolves;
- in every expression, that all joints are covered by art and features stay on the face.

Garments the cooper doesn't wear (coats, skirts, hats with other shapes) need new `forms` entries and drawing code in `figure.mjs`. The rig and animation don't change. Front, side and back views (on the sheet) are not built: the rig is the 3/4 view, mirrored for left and right, like Phase 5.

## Validation (`validation.json`, production, M1 Metal)
| check | result |
|---|---|
| definition | pass: 3.26 heads tall (sheet: ~3.5), 10 expressions, 26 painted parts |
| joints (every frame of the rig test) | 0 gaps, detached parts or features off the face |
| limb, neck and head lengths across frames | 0.000 mm drift |
| deterministic tracks | yes |
| silhouette pieces | 1 (studio and cooperage) |
| feet | 0.3 mm above the floor on every frame |
| hand on barrel | 23 frames of contact, 0 shortfall, palm within 5.6 px of the solved point (1080 px width) |
| studio readability | edge 0.56, ΔE 40.5, head 56 pt on a phone |
| cooperage readability | edge 0.135, ΔE 22.3, head 57 pt |
| colour accuracy (studio) | ΔE 0.6–2.7 |

Plan validation shows no errors. The only warnings are inherent to review stills: `JUMP_CUT` between deliberately matched studio stills, `CHARACTER_OCCLUDES_SUBJECT` where the character stands in front of an invisible framing prop, and `STATIC_SHOT` for the rig test's single held shot.

## Locked design and visual regression (Phase 5.4)
The master character lives in one folder:

| path | contents |
|---|---|
| `characters/cooper/character.json` | the versioned definition (`design.version` 1.0.0, `status: "approved-master"`) |
| `characters/cooper/reference.png` | the approved sheet |
| `characters/cooper/metadata.json` | approval, provenance, and SHA-256 of every locked file |
| `characters/cooper/approved/` | the approved Phase 5.3 renders, kept as the record |
| `characters/cooper/regression/` | baselines |

`characters/cooper/README.md` describes the change procedure.

Stories still name the character `"cooper"`. The loader (`tools/characters/load.mjs`) finds either `characters/<id>.json` or `characters/<id>/character.json`.

**Regression levels** (`tools/characters/regression.mjs`, run by `tests/character-regression.test.mjs`):
1. **Geometry snapshot:** hashes of the painted shapes for 23 canonical states (neutral, all 10 expressions, all pose presets, blink, gaze turn, walk stride). It is exact: any change to a form, colour, rig length or figure code fails.
2. **Flat sheets:** the same states painted by Chrome's 2D canvas, compared pixel by pixel. At most 0.2% of pixels may move by more than 32 levels.
3. **Scene strip:** the studio stills rendered in Three.js on SwiftShader. This catches card, outline, compensation and post-processing changes. At most 0.5% of pixels may change.

**Lock:** `metadata.json` records the SHA-256 of the definition, the reference and the baselines, so changing any of them without bumping the design version and relocking fails the tests. Never regenerate baselines just to make a test pass.

## Production rollout (Phase 5.4, `stories/barrel-bilge`)
The cooper is 1.40 m tall against Bram's 1.12 m. Only character positions changed; cameras, narration timing and prop animation are as in Phase 4/5. The story's `staging` note lists each change.

**New validation:**
- **`CHARACTER_HEAD_CROPPED`:** the whole head (crown to chin, from the pose's forward kinematics) must be in frame whenever any of the character is.
- **`CHARACTER_STRAY_LIMB`:** a hand in frame while the rest of the character is out of shot.

Both are warnings. The two remaining ones in barrel-bilge are deliberate camera-move entrances: the reveal rises from the floor (f0–14), and the profile orbit sweeps him in (f88–100).

**Grounding:** vector rigs take the hip height from the legs' actual reach when the authored hip drop is more than 2 mm off. Crouches and pushes plant the feet (the presets were tuned by eye for Bram), and the approved standing renders stay pixel-identical.

**Post-processing:** production post now clamps non-finite or extreme pixels before bloom. A one-frame full-screen flash (f363, also present in the Phase 5 Bram render) came from a single bad pixel being bloomed. Dust motes also fade near the camera.

**Rollout outputs** (`production/barrel-bilge/`):
- `production-approved-cooper.mp4`
- `approved-cooper-storyboard.png`
- `character-regression.png` (approved vs. now, plus the cooper in every shot)
- `character-rollout-report.json`

## Known differences from the approved sheet (reconstruction, not pixel-identical)
- **Shading:** the sheet has soft painted shading and paper grain; the rig is flat colour. It could be added later as a shade layer, but that wasn't done here.
- **Hair:** the hair is a scalloped blob with regular bumps. The sheet's curls are looser and more varied, with interior curl lines. This is the most visible difference.
- **Cap:** the crown is a little flatter and more regular than the sheet's puffy, forward-leaning cap.
- **Outline:** the outline is slightly warmer and darker than the swatch (#1E1A16) once tone-mapped. In close-ups it is relatively thinner than the sheet's heads, because it follows the 6–8 px rule.
- **Buttons:** they use the "straps/buttons" swatch (#DB8637), which is more orange than the yellow-gold buttons drawn on the sheet. The straps follow the drawing (apron brown), not the swatch.
- **Neutral mouth:** a flat line, as on the sheet's expression row. The turnaround figures show a slight smile.
- **Views:** front, side and back views are not implemented.
