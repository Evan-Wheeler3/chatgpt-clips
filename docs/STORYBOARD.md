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
- **Voice:** `narrate.mjs` synthesizes with macOS `say` (story `narration.voice`; `[[slnc 300]]` and `[[emph +]]` shape pauses and stress) or takes any recording via `--audio`. `say` is a real but basic TTS voice: fine for pacing, not final performance. A better TTS vendor or a human read plugs in as audio.
- **Measured timing:** `vad.mjs` finds speech islands from the audio's energy (≥150 ms silences). `whisper.mjs` runs whisper.cpp with DTW word timestamps **separately on each island**, and words are clamped inside their island. This was necessary: on the full clip, whisper's word times drifted after pauses ("Iron" placed 0.43 s early, inside a silence).
- **Alignment:** `align.mjs` aligns the authored script to the recognised words (edit distance). Exact and substituted words take measured timing. A script word whisper missed gets the measured gap between its neighbours and is flagged `bounded-by-neighbours`. More than 10% unaligned fails. Nothing is estimated from text length or words-per-second.

## Story format (`stories/<slug>/story.json`)
- `props[]`: `{id, asset:{query, style, tags?}, position, rotation (deg), scale?, grounded?, sizeHint?}`. Every prop is resolved through the catalog. Every word of the query must match, so "wooden crate" never resolves to a stool.
- `beats[]`: `{id, purpose, shots[]}`. Each shot:
  - `start` is the word anchor where the cut lands; the first shot starts at 0.
  - `purpose` is required: what the viewer should notice and why.
  - `subject` is a prop id; `foreground[]` lists props allowed to cross in front of it.
  - `transition`: `{type:"cut", motivation}` or `{type:"whip"}`. Cuts must state their motivation.
  - `camera`: `{move, framing, azimuth, elevation, focus, lens, from?, to?, during?, ease, params}`.
  - `events[]`: `{at, prop, do, params, until|duration, ease}`.
  - `focus[]`: word anchors where the subject must be clearly framed.
- **Anchors:** `"bulge"` (must be unique), `"bulge#2"`, a phrase such as `"on the spot"`, or `{at, edge:"end", offset}`. Ambiguous or unknown anchors fail compilation. Cuts lead their word by `timing.cutLeadSec` (0.1 s) and actions by `eventLeadSec` (0.07 s), so action starts on or just before the word.
- **Framing** is semantic, not coordinates: `wide` / `medium` / `close` / `detail` (fills 40/62/88/180% of the limiting frame dimension). Camera distance is solved from the subject's real silhouette: compile extracts each GLB's extreme vertices in 96 directions. An axis-aligned box overestimated a barrel's width by 60% at oblique angles, which put every shot nearly twice too far away.
- **`during`:** `{from, to}` word anchors confine a move to the words it supports. Before the window the shot holds its start framing, after it the end framing. This creates motion bursts instead of constant drift.

## Camera behaviors (`tools/storyboard/camera.mjs`)
All are deterministic functions of the frame, shared by Node (validation) and the browser (animatic):

| move | what it does | typical motivation |
|---|---|---|
| `hold` | still composed frame | the stillness is the point; validation warns past 2 s without action |
| `push-in` / `pullback` | spherical dolly between framings (must tighten / widen) | emphasis on a word / reveal context |
| `orbit` | azimuth sweep at solved distance | change perspective, show form |
| `track` | parallel truck (`params.distance`), or pan-track (`pan:true`) | slide along detail, parallax |
| `follow` | critically damped spring on the moving subject (`lag`) | moving action |
| `reveal` | rises from a low or tight start (or another prop via `from.prop`) to the subject | discovery, hook |
| `whip-pan` | fast look-direction swing from `params.from` prop | energetic re-target |
| transition `whip` | first 8 frames swing from the previous shot's target, with sub-frame motion blur | energy shift between beats |

Easings (`easing.mjs`): `dolly`, `settle` (soft start, overshoot, settle), `cubic`, `sine`, `quint`, `in`, `out` (full-speed start, for moves that begin on a cut), `expo`, `anticipate`, `whip`, `linear`.

## Prop actions (`actions.mjs`)
`set` (instant, must be on a cut), `move`, `roll` (rotation = distance / radius, stays grounded), `pivot` (about vertical), `wobble` (damped rocking), `appear`, `hide`. Actions live on a global timeline, so state carries across cuts. Grounded props rest on y=0 by their silhouette, so a barrel on its side rolls on its bilge without bobbing.

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

Validation is necessary but not sufficient. On the demo, a frame-by-frame look caught two things it missed: a "profile" angle that looked identical on a symmetrical barrel, and an empty wide shot. The second led to the fog and size checks. Always review `storyboard.png` and the animatic.

## Animatic (`animatic.mjs`)
Headless Chrome (SwiftShader, throwaway profile) loads the catalog GLBs with the real Three.js `GLTFLoader` and renders every frame with the same `samplePlan()` the validator used. Frames go to ffmpeg with the narration, as H.264 + AAC. The burned-in overlay shows the shot, move, beat, timecode and frame, the safe area, the current sentence with the spoken word highlighted, missing-asset flags and active validation codes. The stage (ground plane, background, fog, lights) is declared in the story; it is staging, not a substitute for any requested asset. `storyboard.png` shows one frame per shot (its first focus word, else where its move lands) with the shot's purpose.

## Demo: `stories/barrel-bilge`
An original 12.2 s explainer on why barrels bulge, with sources in `stories/barrel-bilge/sources.md`. It has 6 shots: reveal → orbit → track → whip + push-in → follow → pullback. It uses 3 Poly Haven CC0 assets from the catalog and validates with 0 errors and 0 warnings. Rendering the 360×640 animatic takes about 40 s on SwiftShader.

## Not in scope yet
Final-resolution rendering, Remotion composition, SFX and music, characters and rigs, environment construction beyond the plain stage, and final voice performance.
