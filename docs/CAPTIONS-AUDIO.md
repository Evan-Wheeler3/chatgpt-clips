# Captions and sound design (Phase 6.2)

Every Hold Up video gets burned-in captions and a finished audio mix: narration, sound effects, ambience and optional music. Everything runs locally and is free: no subscriptions, APIs or downloaded audio of unknown origin.

```text
words.json (forced-aligned narration) ─┬─▶ caption plan (compile): groups, timing, emphasis, per-shot placement ─▶ drawn on every frame
                                       └─▶ ducking curve
story.json + compiled plan ─▶ effect schedule (animation events, manual cues) ─┐
audio/catalog.json (licensed assets) + audio/ambience.json ────────────────────┼─▶ mixer ─▶ loudnorm ─▶ mix.wav ─▶ muxed into the MP4
narration.wav (never modified) ────────────────────────────────────────────────┘                     └▶ audio QA + caption QA
```

## Captions (`tools/captions/`, `tools/render/captions.mjs`)
- **Style presets** (`styles.mjs`):
  - **`hold-up`** (default): Avenir Next Heavy at 74 px (at 1080 px wide), white words, a dark ink stroke in the characters' outline colour, a soft shadow, the spoken word in warm amber at 1.06×, and emphasised words in amber at 1.12× (they stay amber once spoken).
  - **`legacy-hud`:** the old review-overlay look, kept for comparisons.
  - A story can override any field: `"captions": {"style": "hold-up", "font": {"sizePx": 80}}`.
- **Grouping** (`plan.mjs`):
  - 2–5 words and at most 24 characters per group (one or two balanced lines).
  - Groups break at sentence ends, colons and commas, before conjunctions, and at real pauses. A full group splits at the speaker's widest pause (nearest the middle when pauses are equal).
  - A group never ends on a weak word ("the", "a", "to"…) mid-sentence.
- **Timing:**
  - A group appears 80 ms before its first word and holds until the next group. It fades only into pauses longer than 0.9 s.
  - Exactly one word is highlighted: the latest word that has started. There's no anticipation, so even 40 ms words get their frame.
- **Emphasis:** words marked `[[emph +]]` in the script, plus `captions.emphasize: ["bulge", "roll"]`.
- **Animation:** a subtle pop-in (0.14 s, 0.9× to 1×), the word highlight with a small scale, fades between groups. There's no bouncing.
- **Placement:**
  - Candidate bands: lower (0.68), upper (0.24), middle (0.5).
  - **Per shot**, the band chosen is the one that least covers characters' heads (weighted 4×), their bodies (1×) and the shot's subject (0.5×), projected from the storyboard's camera and rig data. No computer vision is involved.
  - Captions never jump within a shot. A shot can pin a band: `"captions": {"position": "upper"}`.
  - Every block is clamped inside the Shorts safe area: 9–86% across (clear of the right-hand buttons), 11–77% down (clear of the title area).
- **Rendering:** captions are drawn in every quality and burned into the MP4. Stories can turn them off with `"captions": false`. Character-review scenes do this; caption-less stories keep the old review overlay in previews.
- **Comparison:** `node tools/captions/compare.mjs --story stories/<slug>/story.json` renders the same frames in two styles side by side.

## Audio assets (`audio/`)
- **Catalog** (`audio/catalog.json`): each asset has an id, description, category, file, duration, source, licence plus evidence, review status, default gain, loop information and SHA-256.
- **Licences:** the mixer refuses anything not `approved` or not on the allowed list (`CC0-1.0`, `CC-BY-4.0`/`3.0` with a credit line). Missing assets stop the mix; nothing is substituted.
- **Generated library** (`tools/audio/synth.mjs`, 17 assets, 2.3 MB): original sounds synthesized locally from physical models, dedicated CC0. Each is reproducible bit for bit from its generator, parameters and seed (`node tools/audio/synth.mjs`). The assets:
  - wood impacts (barrel thud, light knock, a comedic "tok");
  - three creaks;
  - a barrel scrape and a loopable barrel roll;
  - four stone footsteps;
  - three cloth rustles;
  - a soft whoosh;
  - loopable workshop room tone.

  They're approved for use as original works. **The owner's listening review is still pending.**
- **Imports** (`tools/audio/import.mjs`):
  - `add` needs the licence, the source page, the author and the licence evidence (plus the credit line for CC-BY). Non-commercial and unknown licences are refused.
  - Imports are converted to 48 kHz WAV and start as `pending-review`.
  - `approve <id> --by "<name>"` needs a person. `validate` checks every licence, file and checksum.
- **Ambience profiles** (`audio/ambience.json`): `workshop` is the room tone, faded in over 1.2 s and out over 1.0 s, and ducked 3 dB under speech.

## Sound-effect schedule (`tools/audio/schedule.mjs`)
Effects follow the compiled plan, so they move with the animation when narration or staging changes:

| rule | from | sound |
|---|---|---|
| `roll` | a prop's roll action | a shove thud, plus a rolling bed whose level follows the measured speed |
| `pivot` | a prop's pivot | a creak at the start, plus a scrape following the turn rate |
| `wobble` | a prop's wobble | a light knock, then a short creak |
| `push` | a character's push | a clothing wind-up, plus the contact thud (deduplicated with a roll's) |
| `touch` | a character's touch | a light knock when the hand lands |
| `walk` | a character's walk | a footstep per stride, measured from the path |
| `gesture` | big pose presets | a subtle cloth rustle |
| `whip` | whip transitions | a soft whoosh centred on the whip |

Each event is panned subtly to where its source is on screen. Story controls (all optional):
```json
"audio": {
  "ambience": {"profile": "workshop", "gainDb": 0},
  "auto": true,
  "sfx": [{"id": "staves-tension", "at": "squeeze", "asset": "wood-creak-3", "gainDb": 0}],
  "mute": ["gesture-1"],
  "music": {"asset": "<approved music id>", "startSec": 0, "fadeInSec": 1.5, "fadeOutSec": 2, "duckDb": -12},
  "gainDb": {"sfx": 0}
}
```
- `auto` can be `false`, or `{"exclude": ["walk", "gesture"]}`.
- `at` takes a spoken word (`"bulge#2"`), `{"at": "word", "edge": "end", "offset": 0.1}`, or seconds.

## Mixer and mastering (`tools/audio/mix.mjs`)
- **Narration:** a loudness-matched *copy* (to −16 LUFS) placed at time zero, so it stays frame-locked to the video. The source file is never modified.
- **Effects:** placed sample-accurately, with constant-power pan and speed-following envelopes, and −3 dB under speech.
- **Ambience:** looped with equal-power crossfades, faded, and ducked under speech.
- **Music:** optional. Trimmed, faded, and ducked −12 dB under speech. **If no approved music exists, it's omitted** (barrel-bilge has none).
- **Ducking:** follows the measured words (±0.12 s, 80 ms attack, 350 ms release).
- **Master:** two-pass `loudnorm` to **−14 LUFS integrated, −1.5 dBTP true peak**, 48 kHz stereo. Stems are written beside the mix for review.

## QA
- **Audio** (`audioQA`, written to `qa-audio-<name>.json`):
  - integrated loudness and true peak;
  - clipped samples;
  - narration clarity during speech (the voice must be ≥ 12 dB above everything else);
  - dead air;
  - for the MP4: an audio stream exists, audio and video durations match, and the narration offset (cross-correlation around the first word) is ≤ 20 ms.
- **Captions** (`captionQA` on drawn frames, written to `qa-captions-<name>.json`):
  - every word captioned once and in order;
  - the spoken word highlighted at its midpoint;
  - every box inside the safe area;
  - consistent entrances;
  - face coverage;
  - text size and stroke.

## Commands
```bash
npm run storyboard -- --story stories/barrel-bilge/story.json --render --quality production --qa --name production-sound-design
node tools/captions/compare.mjs --story stories/barrel-bilge/story.json
node tools/audio/synth.mjs                 # rebuild the generated library
node tools/audio/import.mjs validate       # check every asset's licence, file and checksum
```
Stories with an `audio` block render with their mix; other stories render with narration only, as before.

## Barrel-bilge result (`production/barrel-bilge/production-sound-design.mp4`)
- **Video:** 1080×1920, 12.87 s, the approved cooper, environment, animation, camera and cloned narration (served from cache, unchanged).
- **Captions:** 11 groups; one band per shot (upper for the hoops close-up); emphasis on bulge, bilge, roll and turn.
- **Effects (15):**
  - four gesture rustles;
  - the whip whoosh;
  - the shove thud, the speed-following roll and three footsteps;
  - the pivot creak and scrape;
  - the wobble knock and creak;
  - a staves creak on "squeeze".
- **Ambience:** workshop room tone.
- **QA:**
  - −14.2 LUFS, −1.5 dBTP, no clipping;
  - narration 17 dB clear;
  - A/V offset 0 ms, drift 1 ms;
  - caption QA passes with no warnings.
