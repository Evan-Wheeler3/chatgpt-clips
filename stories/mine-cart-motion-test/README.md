# Runaway Ore Cart — 10-second motion test

Silent, fictional, one continuous shot. A loaded cart races along a canyon trestle. The worker (the approved Cooper rig) throws the red lever, the yellow catch gate swings up, and the cart slams to a stop just short of the end of the rails. One loose chunk of ore keeps going and drops into the canyon.

Hand-directed scene: `scene.mjs` (`build(ctx)` / `update()`), rendered by `tools/episode/render.mjs`. The run is exactly 300 frames at 30 fps (frames 0–299). The silent timing file (`durationSec: 10`, no words) sets the length.

## Assets (not in git)

The files come from the owner-supplied *Runaway Ore Cart Claude Pack* (prepared against `6ed47a6`). Per the pack's handoff, the geometry and materials are original to this test. No licence beyond that was stated; treat it as owner-provided, for internal use. Install it before rendering:

```bash
mkdir -p production/mine-cart-motion-test/assets
cp <pack>/silent-timing.json        production/mine-cart-motion-test/words.json
cp <pack>/GLB/canyon-track.glb      production/mine-cart-motion-test/assets/canyon-track.bin
cp <pack>/GLB/ore-cart.glb          production/mine-cart-motion-test/assets/ore-cart.bin
cp <pack>/GLB/catch-gate.glb        production/mine-cart-motion-test/assets/catch-gate.bin
cp <pack>/GLB/control-lever.glb     production/mine-cart-motion-test/assets/control-lever.bin
cp characters/cooper/character.json production/mine-cart-motion-test/assets/cooper.json
```

- The GLB bytes are copied unchanged. All four scene roots stay at identity.
- Units are metres. +X runs down the track, +Y is up, +Z is the camera side.
- Moving parts are driven by node name: `Cart_Root`, the four `Wheel_*` nodes, `Hero_Ore`, `Gate_Pivot` / `Gate_Contact`, `Lever_Pivot` / `Grip_Target`.
- Cooper is loaded unmodified through `makeFigureCard` (design 1.0.0).

## Rig and contact solutions

| Element | How it is driven |
|---|---|
| Cart travel | Already rolling at frame 0. X = −7.6 + 1.42 t + ½·0.082 t² m, slowly gaining speed, hitting at 1.79 m/s. Wheel centres stay at 0.45 m, so the treads sit on the 0.18 m railheads. |
| Stop | Solved from the contacts: stop X = `Gate_Contact` world X at 78° − `Cart_Bumper_Contact` local X = **−0.4652 m**, reached at t = 4.45 s. |
| Wheels | Local Z rotation = −(distance travelled)/0.27, every frame. Spin stops dead at the hit. |
| Heavy stop | The body pitches nose-down about the front wheels' rail contact, so the rear lifts. It bounces twice, up to 2.4° (about 33 mm of rear lift), and decays. The front wheels stay on the rails. While it settles, the gate angle is solved each frame so its pad stays on the bumper face (0 mm gap). The load surges forward and settles. A speed-scaled rattle runs while rolling. |
| Gate | Starts 3.62 s, upright by 3.92 s with an overshoot, settles to 78°. It clears the bumper path long before the hit. |
| Lever | −22° → +22° about local Z. Grabbed 2.80 s, short anticipation, thrown 2.98–3.36 s. The linkage trips the gate 0.26 s later. |
| Loose ore | Carried in the tub until the hit. At the hit it leaves from its world transform at that moment: it rides up over the front rim, lobs over the raised gate, lands on the last plank (X 0.93), skips once, clears the deck end and falls out of sight into the canyon. |
| Worker | Cooper card on a walking line at z = 1.80, clear of the lever base (z ≤ 1.65) and in front of the near posts. Feet are scheduled plants with swings between them, and a two-bone leg IK solves each frame. The pelvis rides over the feet. On the lever, both hands are solved to the grip and shaft as the camera sees them. The pelvis is nudged within leg reach until the near hand lands. The back foot drives back as he heaves. Then he hurries to the deck end, recoils with a step back, and leans over with his hands on his knees. |
| Camera | C2 natural cubic splines through timed keys for position, aim and lens, so velocity and acceleration are continuous at every key. During 4.75–7.9 s the aim blends toward a lagged, low-passed read of the loose ore. |

## Shot

| Time | Action | Camera |
|---|---|---|
| 0.00–0.80 | Cart already rolling. Big wheel, loaded rim, ore rattling. | Low, alongside, a touch ahead, 60° lens. A fence post and rails wipe through the foreground. |
| 0.80–2.00 | The rails end at the drop. The trestle legs fall away into the canyon. The worker is visible beyond, heading for the lever. | Crane up and turn down the line. Cart in lower left, end of track upper right, by about 1.6–2.0 s. |
| 2.00–3.65 | The worker strides in, plants his front foot, grabs and heaves the lever. His back foot drives back. The cart closes behind him. | Push in and down, then hand off from the cart to the worker's reach. |
| 3.65–5.25 | The gate swings up. The bumper hits; heavy stop and short settle. | Arc right to a side-on view of the wheel, bumper and gate. The camera keeps moving through the hit. |
| 5.25–7.65 | The ore skips on the last plank and drops over the lip. | Follow the ore, then dip for a glimpse of the depth. |
| 7.65–10.00 | The worker arrives at the edge, recoils, then leans over to look down. The stopped cart sits behind him. | Tilt back up to him and widen to the closing composition. |

## Commands

```bash
node tools/episode/render.mjs stories/mine-cart-motion-test/story.json --quality preview --out motion-test   # 540×960, 300 frames
node stories/mine-cart-motion-test/qa.mjs --json production/mine-cart-motion-test/qa.json                    # motion QA (no pixels)
node tools/episode/render.mjs stories/mine-cart-motion-test/story.json --quality preview --stills 0,60,100,134 --out stills
```

`qa.mjs` loads the production scene in the same browser page as the renderer and evaluates every delivered frame. It checks:

- camera speed, acceleration, jerk and angular rates
- camera clearance against the set and prop bounds
- wheel-to-rail gap, and wheel spin against travel
- the bumper-to-pad gap
- planted-foot drift
- hand-to-grip error while the hand is on screen
- that the cart's front stays in frame
- that the worker never appears or vanishes while inside the frame
- limb and torso rotation rates (wrap-aware)

## Motion QA notes

```text
Preview and take / revision: motion-test.mp4 (preview quality, 540×960, 30 fps, 300 frames, 10.00 s, no audio), silent
Opening playback check: frame 0 = big teal cart, near wheel and loaded rim, sliding behind a foreground fence; the post
  wipes left in the first 0.4 s. First development: crane up from ~0.8 s; rail end + trestle drop + worker at the lever
  readable from ~1.6 s, clear by 2.0 s.
Measured (qa.mjs, every frame):
  wheel–rail gap before the hit: 0 mm on all four wheels; spin == −travel/0.27 every frame
  bumper–pad gap from the hit through the settle: 0 mm; never interpenetrates
  planted-foot drift: 0 mm; near-hand grip error while on screen: ≤ 0.3 mm; far hand on the shaft: 0 mm
  camera clearance ≥ 1.28 m (AABB of every set/prop mesh); max speed 4.1 m/s (push-in at 2.7 s); max jerk 21 m/s³
Shot | timecode | finding | correction or approved intent
runaway | 1.80–2.20 s | camera acceleration 6–9 m/s² | intended: crest of the crane move; smooth (C2), no jerk spike
runaway | 2.93–3.13 s | camera acceleration 6–7 m/s² | intended: push-in settling onto the worker's grab
runaway | 0.73–1.07 s | pan peaks 69°/s | intended: turn down the line during the rise; reviewed at speed, no whip
runaway | 7.47–7.67 s | tilt-up peaks 70°/s | intended: handoff from the falling ore back to the worker's recoil
runaway | 9.47–10.0 s | camera speed < 0.05 m/s | intended: closing settle
Fixed during review: cart lost from frame in the rise; track end off frame at 2 s; drop unreadable behind the deck end
  (re-staged higher + warm haze); grip up to 400 mm off (camera-projected grip + reach-limited pelvis nudge); front foot
  sliding 75 mm in the heave (stance narrowed, gait generator, hip from feet); camera acceleration jumps at keys
  (Hermite → C2 spline); gate pad lifting 6 mm off the bumper (flex removed); aim overshoot cropping the worker at the end.
Known limits: Cooper is a flat card. He is read obliquely (~55–60°) while small in frame during 1.6–2.4 s. During
  4.0–5.6 s, when he is off screen, his hand target follows the camera projection and may sit off the grip.
Motion pass: approved as a test by the owner. "Overall better, I like it." Not to be re-edited.
Owner notes (2026-11-18), carried forward and not fixed in this video:
  - Character movements are a little fast and unnatural, especially the arms-up recoil at the end
    (measured ~1,400°/s on the arms and ~300°/s on the torso at 7.4–7.6 s). Similar 2–3 frame arm snaps
    occur at the grab (2.7 s) and the release (5.7 s).
  - The character visibly spawns out of thin air: he becomes visible at 1.50 s while inside the frame.
  qa.mjs now flags both (areas `pose-speed` and `entrance`). Lessons: docs/MOTION-LESSONS.md.
Reviewer and date: owner, 2026-11-18
```

## Not done in this pass

- Audio. This test is silent by request. Wheel rumble, gate clank, the impact and the ore bounce are the next pass.
- Production-quality render (`--quality production`, 1080×1920). Waiting for the motion-pass approval.
- `npm test` currently fails 6 character regression and rig tests in a fresh clone because catalog assets are missing (`MISSING_ASSET` for the barrel, `ENV_MISSING_TEXTURE`). These failures don't involve this story's files.
