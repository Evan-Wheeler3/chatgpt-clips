# Narration engine (Phase 6.1)

Narration drives every Hold Up video. Shots, camera moves, prop and character actions and captions are anchored to spoken words, so a new take retimes the whole video by moving each beat to where its word is now spoken. Nothing is scaled uniformly.

```text
story.json narration.script (with delivery markup)
   │  voice: story profile ▸ approved Hold Up narrator ▸ development fallback (macOS say)
   ▼
tools/narration/tts.mjs ── provider.render ─▶ cache (.cache/narration, content-addressed) ─▶ spending guard ─▶ provider.synthesize
   │                                                                                    (paid: named approver + USD cap; usage log)
   ▼
tools/narration/narrate.mjs ── word timing: provider alignment (ElevenLabs) ▸ whisper.cpp ── take ─▶ production/<slug>/takes/<take>/
   │                                                                                                 (active copy: narration.wav, words.json)
   ▼
tools/narration/sync.mjs ── compile old vs new take ─▶ narration-sync.json (retimed shots/actions, conflicts)
   ▼
storyboard compile ─▶ render (captions read the same words)
```

## Setup
1. Copy `.env.example` to `.env` (gitignored) and set `ELEVENLABS_API_KEY` (https://elevenlabs.io/app/settings/api-keys).
2. Optional: set `ELEVENLABS_API_BASE` for a regional host.

The key is read only from the environment or `.env`, and is never printed (`redact()` shows the last 4 characters).

## Providers (`tools/narration/providers/`)
Every provider implements one interface: `render(script, profile)`, `estimate(text, profile)`, `cacheKey(text, profile)` and `synthesize(text, profile)`. The result is `{audio, extension, words|null, response}`.

| provider | cost | word timing | use |
|---|---|---|---|
| `elevenlabs` | paid, per character ($0.08/1K for v2/v3/v4, $0.04/1K for Flash; https://elevenlabs.io/pricing/api, read 2026-11-14) | character timestamps from `POST /v1/text-to-speech/{voice_id}/with-timestamps` | the Hold Up narrator |
| `macos-say` | free | whisper.cpp | development fallback (the original narrator) |
| `recorded` | free | whisper.cpp | imported human recordings (`--audio <file>`) |

**Implementation notes:**
- The ElevenLabs implementation follows the official API reference: `xi-api-key` header; `text`, `model_id`, `voice_settings` (stability, similarity_boost, style, use_speaker_boost, speed 0.7–1.2) and `seed` in the body; `output_format` as a query parameter.
- Voice discovery uses `GET /v2/voices`; usage uses `GET /v1/user/subscription`.
- **Errors** are mapped to clear codes: `missing-key`, `auth` (401), `forbidden` (403), `validation` (400/422), `rate-limit`/`quota` (429, retryable), `server`, `network`. Messages never include the key.
- **A new provider** needs only those four methods plus an entry in `createProvider`.

## Spending safeguards
- **Approval required:** a paid request runs only with an authorization: `authorize({by:'<person>', maxUsd})`, or on the CLI `--approve-spend <usd> --approved-by "<name>"` (audition: `--by`). Automated-sounding names are refused. A request is checked against the estimate and the remaining cap *before* any network call.
- **Hard off switch:** `HOLDUP_BLOCK_PAID_TTS=1` refuses every paid request.
- **Cache:** results are keyed by provider, voice, model, settings, seed, format and rendered text. Repeats are free and need no approval; any change is a new paid request.
- **Usage log:** every paid request is appended to `production/narration/usage.jsonl` with the approver, characters, estimated cost, ElevenLabs' `character-cost` and `request-id` headers, and the cache key.

## Voice profiles (`voices/*.json`)
A profile records `provider`, `voiceId`, `modelId`, `settings`, `seed`, `outputFormat` and `delivery` (pause handling).
- **`voices/hold-up-narrator.json`** is the channel's narrator. It records the target delivery (American male, young to middle-aged, conversational storyteller; no trailer, documentary or corporate voice) and stays `unselected` until the owner chooses a voice.
- **Once approved**, every story without its own voice uses it.
- **A story can name another profile** with `narration.voice.profile`.

## Delivery markup (`tools/narration/markup.mjs`)
Scripts keep their exact words; markup only shapes delivery:

| markup | meaning | macOS say | ElevenLabs v2 / Flash | ElevenLabs v3 / v4 |
|---|---|---|---|---|
| `[[slnc 350]]` | intentional pause (ms) | as written | `<break time="…"/>` if ≥ `delivery.minPauseMs`, scaled by `pauseScale` | an ellipsis for pauses ≥ 500 ms (no break tags on these models) |
| `[[emph +]]` | stress the next word | as written | word kept (no SSML emphasis) | word kept |
| `[[tone amused]]` | speaking style for what follows | dropped | dropped | `[amused]` audio tag |

The narrator profile keeps only deliberate pauses (≥ 300 ms) at 60% of their length and leaves short beats to punctuation, so there's no pause after every sentence and no speed changes. Marked pauses are measured in every take (`words.json` → `pauses`) and checked by the sync report.

## Word timing
- **Source:** ElevenLabs returns character start and end times with the audio. `wordsFromAlignment` turns them into words (skipping break tags and audio tags), and `alignWords` maps them onto the script words. Recordings and macOS `say` use whisper.cpp as before. Timing is always measured, never estimated from text.
- **Cross-check:** `--verify-alignment` also runs whisper on a provider take and records the mean and maximum difference (`alignmentCrossCheck`).
- **Takes:** each take is kept in `production/<slug>/takes/<take>/`; the active copy is `production/<slug>/{narration.wav, words.json}`. `--use-take <id>` switches back without synthesis.

## Sync report (`narration-sync.json`)
Narrating a story whose previous take exists, or switching takes, compiles both versions and reports:
- every shot's start, end, duration and ratio, and every action's old and new frames;
- conflicts:

| code | severity | meaning |
|---|---|---|
| `ANCHOR_MISSING` | error (blocks) | a word the storyboard anchors to is no longer spoken |
| `VALIDATION_ERROR` | error | the retimed plan fails storyboard validation |
| `CAPTION_DRIFT` | error | a caption would not show its word |
| `SCRIPT_CHANGED` | editorial | the spoken script differs between takes |
| `SHOT_RETIMED_HEAVILY` | editorial | a shot is < 0.65× or > 1.5× its previous length |
| `MOVE_TOO_FAST` | editorial | a camera move now has fewer than 8 frames |
| `ACTION_CROSSES_CUT` | editorial | a timed action that fitted its shot now runs past the cut |
| `BEAT_LOST` | editorial | a marked pause of ≥ 300 ms kept less than 35% of its length |
| `NEW_WARNING` | review | a storyboard warning the old take did not have |

A blocked report stops the storyboard run. Editorial conflicts need a decision: adjust the story's anchors, add a beat, or ask for a new take.

## Commands
```bash
# Free
node tools/narration/audition.mjs prepare                                   # audition plan, cost estimate; with a key: verify voices (free)
npm run storyboard -- --story stories/barrel-bilge/story.json --narrate      # development voice (macOS say), free
npm run storyboard -- --story ... --use-take <id>                           # switch takes
node tools/narration/sync.mjs --story ... --to <take>                       # compare the active take with another

# Paid (only with the owner's approval)
node tools/narration/audition.mjs generate --approve-spend 0.10 --by "<name>"
node tools/narration/audition.mjs select <1|2|3> --by "<name>"               # the owner's choice becomes the Hold Up narrator
npm run storyboard -- --story stories/barrel-bilge/story.json --narrate --approve-spend 0.05 --approved-by "<name>" --verify-alignment
npm run storyboard -- --story stories/barrel-bilge/story.json --render --quality production --qa --name production-natural-voice
```

## Narrator audition (`voices/auditions/barrel-bilge.json` → `production/narration/auditions/`)
- **Passage:** the full barrel-bilge script (203 spoken characters): a question hook, a reveal, an explanation and a payoff.
- **Model and settings:** `eleven_multilingual_v2` with the same settings and seed for every voice (stability 0.4, similarity 0.75, style 0.3, speaker boost, speed 1.0).
- **Candidates:** Chris, Liam and Eric from the ElevenLabs premade library, with Will as an alternate. Their IDs are unverified until `prepare` runs with a key.
- **Output:** `voice-01.mp3`–`voice-03.mp3`, plus `comparison.json` (IDs, model, settings, rendered text, cost, and measurements: duration, words per minute, kept pauses, alignment quality) and `README.md`.
- **Estimated cost:** about $0.06 for all three.
- **Selection:** nothing selects a voice automatically.
