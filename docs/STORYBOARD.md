# Narration-driven storyboarding (Phase 4)

Voice first, then edit, then camera. A story is a JSON file of beats and shots whose timing comes **only** from measured narration words. The compiler turns it into a frame-exact shot plan. The validator checks it, and a low-resolution vertical animatic is rendered for review before any detailed scene work.

```text
story.json ──narrate──▶ narration.wav + words.json (measured)
     │                         │
     └──────── compile ◀───────┘ ◀── assets/catalog.json (GLB silhouettes)
                  │
             shots.json ──validate──▶ validation.json
                  │
               animatic ──▶ animatic.mp4 (360×640) + storyboard.png
```

## Commands
```bash
npm run storyboard -- --story stories/<slug>/story.json --narrate        # TTS + align once (or --audio recording.wav)
npm run storyboard -- --story stories/<slug>/story.json                  # compile + validate (~0.5 s)
npm run storyboard -- --story stories/<slug>/story.json --render [--scale 0.333] [--strict]
```
Outputs go to `production/<slug>/` (gitignored): `narration.wav`, `words.json`, `shots.json`, `validation.json`, `animatic.mp4`, `storyboard.png`. After narrating once, edit `story.json` and rerun. Changing cuts, moves, easing or events never touches the models or the audio.

## Requirements
- Everything from Phase 3 (Node 20+, `npm install`, Chrome or Chromium / `CHROME_PATH`) plus `ffmpeg`/`ffprobe`.
- `whisper-cli` from whisper.cpp (`brew install whisper-cpp`). The `ggml-base.en` model (MIT, 148 MB) is downloaded on first use from a pinned Hugging Face revision into `.cache/whisper/`, and is SHA-256 verified.
- macOS for the built-in `macos-say` voice. On other systems, pass a recording with `--audio`.

## Narration and timing (`tools/narration/`)
*Phase 6.1:* local voice cloning, voice profiles, delivery markup, takes and narration sync reports are described in `docs/NARRATION.md`.
*Phase 6.2:* stories can add `captions` (style, emphasis, `false` to disable; per-shot `captions.position`) and `audio` (ambience, automatic or manual effects, music, gains). Both are optional and backward compatible; see `docs/CAPTIONS-AUDIO.md`. The measured-timing rules below still hold for every provider.
- **Voice:** `narrate.mjs` synthesizes with macOS `say` (story `narration.voice`; `[[slnc 300]]` and `[[emph +]]` shape pauses and stress) or takes any recording via `--audio`. `say` is a real but basic TTS voice: fine for pacing, not final performance. A better TTS vendor or a human read plugs in as audio.
- **Measured timing:** `vad.mjs` finds speech islands from the audio's energy (≥150 ms silences). `whisper.mjs` runs whisper.cpp with DTW word timestamps **separately on each island**, and words are clamped inside their island. This was necessary: on the full clip, whisper's word times drifted after pauses ("Iron" placed 0.43 s early, inside a silence).
- **Alignment:** `align.mjs` aligns the authored script to the recognised words (edit distance). Exact and substituted words take measured timing. A script word whisper missed gets the measured gap between its neighbours and is flagged `bounded-by-neighbours`. More than 10% unaligned fails. Nothing is estimated from text length or words-per-second.

## Story format (`stories/<slug>/story.json`)
- `props[]`: `{id, asset:{query, style, tags?}, position, rotation (deg), scale?, grounded?, sizeHint?}`. Every prop is resolved through the catalog. Every word of the query must match, so "wooden crate" never resolves to a stool.
- `beats[]`: `{id, purpose, shots[]}`. Each shot:
  - `start` is the word anchor where the cut lands; the first shot starts at 0.
  - `purpose` is required: what the viewer should notice and why.
  - `subject` is a prop id; `foreground[]` lists props allowed to cross in front of it.
  - `transition`: `{type:"cut", motivation, intent?}` or `{type:"whip"}`. Cuts must state their motivation. `intent:"contrast"` declares a deliberate smash cut and skips the cut-continuity warnings; the default is `"continuity"`.
  - `camera`: `{move, framing, azimuth, elevation, focus, lens, from?, to?, during?, ease, params}`.
  - `events[]`: `{at, prop, do, params, until|duration, ease}`.
  - `focus[]`: word anchors where the subject must be clearly framed.
- **Anchors:** `"bulge"` (must be unique), `"bulge#2"`, a phrase such as `"on the spot"`, or `{at, edge:"end", offset}`. Ambiguous or unknown anchors fail compilation. Cuts lead their word by `timing.cutLeadSec` (0.1 s) and actions by `eventLeadSec` (0.07 s), so action starts on or just before the word.
- **Framing** is semantic, not coordinates: `wide` / `medium` / `close` / `detail` (fills 40/62/88/180% of the limiting frame dimension). Camera distance is solved from the subject's real silhouette: compile extracts each GLB's extreme vertices in 2048 directions. With 96 directions, a rolling barrel sank up to 17 mm into the floor; with 2048 the error is about 0.1 mm. An axis-aligned box overestimated a barrel's width by 60% at oblique angles, which put every shot nearly twice too far away.
- **`during`:** `{from, to}` word anchors confine a move to the words it supports. Before the window the shot holds its start framing, after it the end framing. This creates motion bursts instead of constant drift.

## Camera behaviors (`tools/storyboard/camera.mjs`)
All are deterministic functions of the frame, shared by Node (validation) and the browser (animatic):

| move | what it does | typical motivation |
|---|---|---|
| `hold` | still composed frame | the stillness is the point; validation warns past 2 s without action |
| `push-in` / `pullback` | spherical dolly between framings (must tighten / widen) | emphasis on a word / reveal context |
| `orbit` | azimuth sweep at solved distance | change perspective, show form |
| `track` | parallel truck (`params.distance`, `params.direction` `right`/`left`), or pan-track (`pan:true`) | slide along detail, parallax |
| `follow` | critically damped spring on the moving subject (`lag`) | moving action |
| `reveal` | rises from a low or tight start (or another prop via `from.prop`) to the subject | discovery, hook |
| `whip-pan` | fast look-direction swing from `params.from` prop | energetic re-target |
| transition `whip` | first 8 frames pan in (yaw only, 45–90°) from the direction the previous shot was looking, fastest on the cut (`whipIn` ease) and decelerating onto the subject, with motion blur that adds sub-frames as the pan speeds up (6–16, about one per 3°) | energy shift between beats |

Easings (`easing.mjs`): `dolly`, `settle` (soft start, overshoot, settle), `cubic`, `sine`, `quint`, `in`, `out` (full-speed start, for moves that begin on a cut), `expo`, `anticipate`, `whip`, `whipIn`, `linear`.

## Prop actions (`actions.mjs`)
`set` (instant, must be on a cut), `move`, `roll` (rotation = distance / radius, stays grounded), `pivot` (about the vertical through the prop's own centre; before Phase 5 it used the model origin, which for a barrel on its side is one end), `wobble` (damped rocking), `appear`, `hide`. Actions live on a global timeline, so state carries across cuts. Grounded props rest on y=0 by their silhouette, so a barrel on its side rolls on its bilge without bobbing.

## Validation (`validate.mjs`)
**Errors** block scene construction; **warnings** need a director's judgement.
- **Assets:** `MISSING_ASSET` (also flagged as red text in the animatic; no stand-in geometry is ever drawn).
- **Timing:**
  - errors: `TIMING_GAP` (shots must be contiguous from 0), `SHOT_TOO_SHORT` (< 0.5 s), `FOCUS_OUTSIDE_SHOT`
  - warnings: `SHOT_LONG` (> 4.5 s)
- **Direction:**
  - errors: `NO_PURPOSE`, `UNMOTIVATED_CUT`, `MOVE_DIRECTION`
  - warnings: `STATIC_SHOT`, `MECHANICAL_DRIFT` (linear move across ≥ 90% of a shot), `PERPETUAL_ZOOM` (three push-ins in a row), `JUMP_CUT` (same subject, framing and angle within 25°)
- **Continuity:** `CONTINUITY_POP` (instant change not on a cut), `ACTION_OVERLAP`, `CAMERA_POP` (isolated spike), `CAMERA_JERK` (speed changes > 0.12 m/frame in one frame)
- **Camera:** `CAMERA_BELOW_GROUND`, `CAMERA_COLLISION` (inside a prop's box + 5 cm)
- **Framing** (per frame, at the shot's interpolated focus point; vertical safe area x ±0.8, y −0.5…0.76 NDC):
  - errors: `SUBJECT_OFF_SCREEN`, `SUBJECT_TOO_SMALL` (< 12% of frame height), `SUBJECT_IN_FOG` (beyond 70% of fog far), `FOCUS_NOT_FRAMED` (subject outside the safe area on its focus word)
  - warnings: `SUBJECT_OUTSIDE_SAFE_AREA`, `SUBJECT_OCCLUDED` (by a prop not declared as foreground)
- **Sync:** `SYNC_EARLY` (> 8 frames before its word), `SYNC_LATE` (> 2 frames after), `ACTION_OFF_SCREEN`
- **Cut continuity** (warnings only, same-subject hard cuts that don't declare `contrast`). Each cut compares the last frame before it with the first frame after. Metrics: on-screen size (larger visible dimension), visible-centre position, viewing angle in the subject's own frame, and camera pitch.
  - `CUT_SCALE_JUMP`: size changes more than 2×.
  - `CUT_POSITION_JUMP`: the subject moves more than 30% of the frame.
  - `CUT_DISORIENTING`: three of four change together (size > 1.6×, shift > 0.35 NDC, view > 60°, pitch > 8°).
  - `CUT_DEAD_START`: the shot's first action or camera move starts more than 12 frames after the cut.
  - Every cut's metrics are listed under `cuts` in `validation.json`, so a deliberate change of angle (a cut needs one) is visible without being an error.

Validation is necessary but not sufficient. On the demo, a frame-by-frame look caught two things it missed: a "profile" angle that looked identical on a symmetrical barrel, and an empty wide shot. The second led to the fog and size checks. Always review `storyboard.png` and the animatic.

## Animatic (`animatic.mjs`)
Headless Chrome (SwiftShader, throwaway profile) loads the catalog GLBs with the real Three.js `GLTFLoader` and renders every frame with the same `samplePlan()` the validator used. Frames go to ffmpeg with the narration, as H.264 + AAC. Grounded props get contact shadows each frame: a soft pool under the silhouette footprint and a tight dark patch where it meets the floor, fading with height (`stage.contactShadows:false` disables them). The burned-in overlay shows the shot, move, beat, timecode and frame, the safe area, the current sentence with the spoken word highlighted, missing-asset flags and active validation codes. The stage (ground plane, background, fog, lights) is declared in the story; it is staging, not a substitute for any requested asset. `storyboard.png` shows one frame per shot (its first focus word, else where its move lands) with the shot's purpose.

## Demo: `stories/barrel-bilge`
An original 12.2 s explainer on why barrels bulge, with sources in `stories/barrel-bilge/sources.md`. It has 6 shots: reveal → orbit → track → whip + push-in → follow → pullback. It uses 3 Poly Haven CC0 assets from the catalog and validates with 0 errors and 0 warnings. Rendering the 360×640 animatic takes about 40 s on SwiftShader.

## Demo revision: the contact → roll cut
The first version cut from the end of a close push-in on the barrel's side to a wide, head-on follow. The barrel shrank about 2×, rotated 78° and jumped 10° in horizon. It then sat still for 22 frames before rolling, and it rested on its protruding bung.

The revision cuts on action instead:
- the roll starts on the cut frame with a shove-like `out` ease;
- the follow opens at `medium` (1.32× from the push-in's end) at the same focus height and horizon (3°), with a 50° angle change;
- the barrel is laid down with its bung clear of the floor for the whole roll (3.6 mm centre variation, down from 16 mm).

The new cut checks would have flagged the original (`CUT_DISORIENTING`, `CUT_DEAD_START`).

A second review fixed the two cuts they then flagged, plus a defect found by watching the frames:
- **`profile → hoops`** (frame-left to frame-right, 0.61 NDC): the hoops detail now cuts in on the same side of the barrel (azimuth −60, 33° from the profile), keeping the silhouette edge where the eye already is, and tracks `left` along the hoops. Shift is now 0.32, scale 1.22×.
- **`turn`** (20 dead frames): the cut moved to "easy" in "easy to turn", and the pivot starts on the cut and runs through "turn, right" with the camera's pull-back. The decelerating roll settles in the 5 frames the roll shot gained.
- **Whip into `contact`:** it only swung about 8°, because it rotated between target *points* that happened to lie in the same direction from the new camera. Its first frame was also crisp and off-target. It now pans in from the previous look direction (see behaviors above), and the blur adds sub-frames as the pan speeds up.

The demo now validates with 0 errors and 0 warnings, and the integration test fails on any regression of these cuts.

Visual notes still open (not defects of the shot plan):
- The plain stage floor has no texture, so travel speed in the follow shot is read mainly from the barrel's turning head and the crate passing. Environment detail is Phase 5.
- The hoops detail leaves the right half of the frame as dark wall: the cost of matching the profile's silhouette edge.
- At 360×640 the first whip frames still show faint stepped copies of the crate. This should vanish at final resolution with more samples.
- The burned-in caption covers the lower barrel in the hoops detail. It's a review overlay only, not final captions.

## Phase 5
Environments, art direction, 2D characters, character events and preview and production quality are documented in `docs/VISUALS.md`.

## Not in scope yet
Final-resolution rendering, Remotion composition, SFX and music, characters and rigs, environment construction beyond the plain stage, and final voice performance.
