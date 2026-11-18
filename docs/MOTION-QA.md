# Motion quality assurance

Use this gate for declarative storyboards and hand-directed episode scenes. The [cinematography skill](../skills/cinematography/SKILL.md) connects the initial shot plan to the final review. Record review results in the episode's existing QA notes or handoff.

## Preview and approval

1. **Review the animatic.** Run the declarative compile and animatic once measured words and narration are available. Read `validation.json` and watch the animatic for timing, geography, focal handoffs and planned holds before committing to detailed scene work. For a hand-directed episode, use a lightweight in-engine blockout and a measured take. Its look-development stills can establish composition before narration exists.
2. **Render a motion preview.** Run the actual scene at delivery FPS and 9:16 with reduced resolution. Keep camera, rig, props, hit frames and caption layout representative. Spend preview time on path, weight, contact and readability. Simplify expensive shading where possible. Review once with narration and once muted. For a hand-directed picture-only preview, mix with the selected take through the existing episode audio workflow to check timing.
3. **Review shots and joins.** Run the [opening playback check](#opening-playback-check) and watch the full sequence at normal speed on a phone-sized display. Mark stagnant beats and any moment where the eye loses the subject. Step through flagged blends, turns, pauses, contacts and the frames on both sides of cuts. Review with captions and the intended crop. For blur-sensitive shots, also check representative frames with final blur settings.
4. **Correct and re-review.** Reblock unsafe paths, fix contact and momentum, and simplify competing movement. Rerender changed shots with their neighbors, then repeat the full-sequence playback. Update the QA notes with the preview version, findings, fixes and any approved intent.
5. **Approve before final render.** Obtain and record the motion-pass review/approval before starting the expensive final render. If there is no approval, mark it pending. Retime and re-review affected shots when the chosen take changes. Validate the final export against the approved motion pass, including final blur, crop and sync. Existing asset, audio and render gates still apply.

Examples from the repository root, after narration and assets have been prepared. Substitute episode paths, shot IDs and output names as appropriate.

```bash
npm run storyboard -- --story stories/barrel-bilge/story.json --render
npm run storyboard -- --story stories/barrel-bilge/story.json --render --quality preview --qa
node tools/episode/render.mjs stories/seatbelt-locking/story.json --quality preview --out motion-preview
node tools/episode/render.mjs stories/seatbelt-locking/story.json --quality preview --shots yank --out motion-yank
```

[Storyboard commands and prerequisites](STORYBOARD.md#commands) describe the declarative route. The hand-directed route writes picture only. Its `--shots` filter renders the contiguous range from the first selected shot start to the last selected shot end, including any intervening shots. Record the selected take and, if used, the stand-in status. Use the approved take for final validation.

## Opening playback check

Play the first two seconds at phone size and normal speed with the intended crop. Review once muted and once with narration and captions.

- Pause on frame one. Identify what the viewer should look at and the question or stakes the picture establishes.
- Play through the first second. Confirm that the planned large movement reads and that the camera stays smooth. Look for changes in subject position, scale, depth, or a prop's state.
- Play through about two seconds. Identify the first meaningful development and check that the viewer can follow the cause and effect. If the image is unchanged or confusing, reblock the action or reveal and replay before polishing.
- Record the opening action, the first development's timecode and any approved quiet hold in the motion notes. After publishing, compare viewed versus swiped away and early retention, where available, against comparable Shorts. Record what changed as an opening experiment.

## Acceptance criteria

| Area | Pass condition |
|---|---|
| Camera travel and orientation | Intentional position and orientation through the full shot. No visible jitter, orientation flip, sudden acceleration spike, accidental stop or overshoot where keys, paths or aim targets join. Speed and rotation leave time to read the action. |
| Scene clearance | Camera and near plane clear solid geometry throughout travel. No unintended character/prop/environment intersections or teleporting poses. Intentional contact and controlled foreground crossings are staged explicitly. |
| Character movement and contact | The moving body transfers weight plausibly. Planted feet stay anchored to their support. Grabs and releases align with the prop path. Push, pull, carry, sit, stand and other contact actions have believable pose, timing and release. |
| Opening hook | Frame one gives the eye a clear subject and a reason to keep watching. A substantial movement in the first second develops into a readable beat by about two seconds, or a deliberate quiet opening earns and resolves its hold. |
| Visual rhythm | During active beats, roughly every 1–2 seconds there is a readable development in the camera composition, action, subject or environment. Each development delivers information, anticipation or consequence. A continuous move and intentional holds pass when the viewer can follow the beat and the hold serves a clear purpose. Blinks, breathing and barely visible drift are secondary. |
| Framing and readability | Primary action stays visible when needed, with readable silhouettes, phone-safe composition and clear focal priority. A planned entrance or occlusion clears before the important action. Motion blur preserves the key pose, contact or detail. |
| Edit and narration | Every cut has a motivation. Cuts maintain understandable action phase, direction, eyeline, position and prop state or deliberately signal a change of context. Main action and focal handoffs align with the measured narration or planned silence. |
| Review evidence | The latest preview and relevant reports are identified. Fix motion defects and resolve warnings with a documented correction or a specific reviewed exception. Record reviewer and status before final render. |

Suggested note format:

```text
Preview and take / revision:
Shot ID | frame range / timecode | issue and viewer impact | correction or approved intent
Re-preview result:
Motion pass: pending / changes requested / approved
Reviewer and date:
```

## Hand-directed QA sampler (first implementation)

[`stories/mine-cart-motion-test/qa.mjs`](../stories/mine-cart-motion-test/qa.mjs) is the first implementation of roadmap item 1 for the hand-directed path.

**How it works:**
- It loads the production scene in the renderer's own page.
- It calls a scene-provided `window.<episode>QA()` hook that evaluates every delivered frame (no pixels).
- It writes `production/<slug>/qa.json`.

**What it checks:**

| Area | What it measures |
|---|---|
| Camera | Speed, acceleration, jerk, angular velocity and angular acceleration (sign-invariant quaternion) |
| Clearance | Distance to the bounds of every set and prop mesh |
| Rolling contact | Wheel-to-rail gap; spin against travel |
| Impact contact | Bumper-to-pad gap |
| Feet | Planted-foot drift |
| Grip | Hand-to-grip error, counted only while the hand is on screen |
| Framing | Subject's front edge stays in frame |
| Character entrances | Appear or vanish while inside the frame |
| Pose speed | Wrap-aware limb and torso rotation rates |

Copy it into the next hand-directed episode and adapt the hook. Owner notes the sampler didn't catch become new checks; the entrance and pose-speed checks came from the ore-cart review. See the [motion lessons log](MOTION-LESSONS.md).

Provisional warning thresholds:

| Measure | Threshold |
|---|---|
| Camera acceleration | 6 m/s² |
| Angular velocity | 60°/s |
| Angular acceleration | 260°/s² |
| Camera speed (near-stop) | below 0.05 m/s |
| Clearance | 0.25 m |
| Planted-foot drift | 6 mm |
| On-screen grip error | 12 mm |
| Limb rotation | 420°/s |
| Torso rotation | 160°/s |

The owner accepted these camera excursions in the ore-cart preview:
- a crane crest at 9 m/s²
- pans of 69–70°/s for under 0.4 s
- a closing settle

## Validation coverage and proposed measurements

[`tools/storyboard/validate.mjs`](../tools/storyboard/validate.mjs) already checks declarative timing, framing, occlusion, contacts, camera clearance, camera pops/jerk and cut continuity using simplified scene data. [`tools/render/qa.mjs`](../tools/render/qa.mjs) samples frames for pixel/performance QA. [`tools/storyboard/attach.mjs`](../tools/storyboard/attach.mjs) has specialized socket and geometry checks. The hand-directed renderer does not run these declarative scene-motion checks against its custom camera and pose code. Use manual preview QA on both paths.

Start future instrumentation with evaluated scene state, then add image evidence where it helps. In Three.js use the actual camera matrices and sampled scene state after updates. In Blender use `scene.frame_set`, the evaluated dependency graph and world transforms after constraints. Sample each delivered frame, and add subframes for fast clearance/contact when needed. Use the episode FPS and explicit shot boundaries. Restore the original frame after sampling an interactive Blender scene. [Blender scene API](https://docs.blender.org/api/current/bpy.types.Scene.html) · [Evaluated dependency graph](https://docs.blender.org/api/current/bpy.types.Depsgraph.html)

| Review item | Programmatic evidence | Director check |
|---|---|---|
| Camera position/orientation continuity, excessive speed/rotation, acceleration changes and stops | Per shot, compute world-space displacement and velocity vectors in units/s. Difference consecutive velocities for acceleration and inspect changes around joins. Derive angular distance from sign-invariant unit quaternion differences over seconds, and inspect angular velocity vector changes for direction reversals. Log runs of near-zero travel and rotation separately from authored holds. Track FOV changes too. | Confirm intent, readable speed and smoothness in actual playback. Exclude intentional cuts from derivative checks and inspect their endpoints separately. |
| Camera/object contact and character/prop intersections | Broad-phase evaluated bounds, then mesh or proxy tests on candidates. Sweep camera center and near-plane corners between poses. Use contact masks or permitted pairs for hands, feet and sockets. For thin or concave geometry, an AABB overlap or one ray is only a candidate. | Confirm contact is intentional and the surfaces look physically connected or separated as required. |
| Foot sliding, frozen acting and abrupt poses | For each declared plant interval, compare heel/toe or foot markers in the support object's frame. Measure tangential drift and normal separation independently. Measure root displacement and joint/landmark deltas during active beats, including clip boundaries and actions with a stationary root. Check prop sockets through grip switches. | Check weight, stride length, balance, handoffs and readable action. A near-zero root can be valid when arms drive the beat. |
| Off-screen subject, occlusion, unreadable composition and idle periods | Project evaluated landmarks and bounds at output aspect. Track visible area, focal point and size, relative near/far motion, and visibility changes. Ray-test from camera to multiple required landmarks, ignoring approved blockers only within their authored windows. Use screen-space tracks in rolling time windows to flag stagnant active beats. | Decide whether developments are substantial. A track can keep its hero centered while the set moves past it. An orbit can move in world space while a symmetric subject reads unchanged. Compare scale, silhouettes, parallax, contact and focal handoffs as well as centroid movement. |
| Blur and cuts | Compare last outgoing and first incoming frames for subject projected position/size, heading, action phase, eyeline, contact and prop state. Flag cuts without a recorded purpose. Where shutter sampling is available, estimate focal screen travel over the exposure as a blur cue. | Confirm spatial comprehension, motivation and visual legibility by watching the edit and final blur. Scene transforms alone cannot score narrative intent or prove a key detail reads. |

For Blender projection, `world_to_camera_view` uses a bottom-left origin with visible X/Y in `[0,1]`, and points behind the camera have negative depth. Convert Three.js coordinates to the same convention before comparison and handle the near-plane and visibility separately. Use evaluated projected landmarks or clipped bounds. A single oblique 3D bounding box may exaggerate screen occupancy. For occlusion, limit world-space ray distance to just before the target and use the evaluated scene geometry. [Projection API](https://docs.blender.org/api/5.2/bpy_extras.object_utils.html) · [Scene ray cast](https://docs.blender.org/api/current/bpy.types.Scene.html#bpy.types.Scene.ray_cast)

### Configure and calibrate

- Keep thresholds as reviewed config by shot class, scene scale, FPS, lens and intent. Use world units/s, degrees/s, fraction of frame dimensions, and frame ranges with timecodes. Support planned hold, contact, occlusion, shake and cut windows by ID and range with a reason. Avoid applying a per-frame value across FPS blindly.
- Collect representative accepted and rejected previews for dolly, tracking, arc, reveal, deliberate hold, matched cut and planted contact. Use the barrel-bilge cut fixes and the seatbelt motion revision as starting cases, plus a purpose-built failure for each new measurement. Include a centered tracking shot with strong parallax and a large world-space orbit with little perceived change.
- Sample the labelled clips, inspect overlaid traces and compare false positives and misses with a human review at delivery FPS and phone size. Set provisional warning thresholds only after this comparison, record the fixtures and configuration, and verify against a separate scene before generalizing. Treat the existing Phase 4 thresholds as specific to their validator and fixtures. They do not define the cinematic pacing standard.
- Emit findings with shot ID, time/frame range, metric, observed value, configured threshold, related subject/geometry and review status. Keep automated motion findings advisory. A warning should send the director to the relevant frames. Keep current schema/data errors and existing render checks intact.

## Implementation roadmap

These are proposed changes, ordered to improve production quality with the least disruption.

| Order | Impact / effort | Implementation and verification |
|---|---|---|
| 1. Capture motion evidence for both renderers | High / small to medium | Extend the declarative sampler used by `validate.mjs` and add optional evaluated frame diagnostics after the custom scene update in [`tools/episode/page.mjs`](../tools/episode/page.mjs). Start with actual camera pose, FOV, primary/secondary anchor projections and shot ID. Save non-mutating per-shot traces next to previews. Verify that repeat runs and isolated-shot versus full renders agree for matching frame numbers. |
| 2. Add calibrated warning reports | High / medium | Use the capture to flag in-shot pose/velocity discontinuities, sudden aim changes, dead starts, occlusion and active windows with little projected development. Reuse existing bounds and QA conventions. Include per-shot intent overrides, range summaries and a preview overlay or reference stills. Validate with fixtures above plus unit cases for quaternion sign flips, cuts and differing FPS. |
| 3. Make common camera moves composable | High / medium | Extend [`camera.mjs`](../tools/storyboard/camera.mjs) and [`compile.mjs`](../tools/storyboard/compile.mjs) with optional position/aim waypoints, continuous tangent/speed profiles, local/world offsets, and a controlled target handoff. Add vertical and foreground reveals using explicit paths before introducing more presets. Keep existing behavior defaults and measured word windows. Demo one moving-subject follow into a reveal without rekeying narration. Regression-check existing plans and shared Node/browser sampling. |
| 4. Improve locomotion and prop continuity | High / medium to large | Extend [`character.mjs`](../tools/storyboard/character.mjs) with distance-driven stride phase, support-local plant constraints, turn blends and explicit grip/release anchors where current presets fall short. Reuse socket and contact code. Check carry, push/pull and sit/stand with visual proofs plus contact traces. Preserve the approved character assets and [rig regression suite](../tests/character-regression.test.mjs). |
| 5. Pilot Blender authoring interchange | Selective / medium to large | On one shot that benefits from authored rail or specialized rig controls, bake camera transforms or supported prop/rig animation and adapt it to the existing frame sampler. Verify axes, scale, projection, FPS, contacts and renderer parity before supporting more shots. Keep the three-dimensional camera, approved visual treatment and narration timing reproducible in the existing production renderer. See [camera engineering](CAMERA-DIRECTION.md#motion-engineering-and-optional-blender-authoring). |
