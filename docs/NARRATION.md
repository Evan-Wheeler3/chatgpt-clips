# Narration engine (Phase 6.1, local voice cloning)

Hold Up narration is **free and local**: the owner's own voice is cloned from a short recording and speaks every script on the Mac. There are no paid APIs, subscriptions or keys, and nothing needs the internet after the one-time engine install.

Narration drives the video. Shots, camera moves, prop and character actions, and captions are anchored to spoken words, so a new take retimes everything by moving each beat to where its word is now spoken. Nothing is scaled uniformly.

```text
story.json narration.script (+ delivery markup)
   │  voice: story profile ▸ approved Hold Up narrator (the owner's cloned voice) ▸ development fallback (macOS say)
   ▼
tools/narration/tts.mjs ── provider.render ─▶ cache (.cache/narration, content-addressed) ─▶ provider.synthesize (WAV)
   │       local-clone: tools/narration/local/clone_worker.py in .cache/voice/venv (MLX, offline)
   ▼
tools/narration/narrate.mjs ── word timing: whisper.cpp alignment ── take ─▶ production/<slug>/takes/<take>/
   ▼                                                                       (active copy: narration.wav, words.json)
tools/narration/sync.mjs ── compile old vs new take ─▶ narration-sync.json (retimed shots/actions, conflicts)
   ▼
storyboard compile ─▶ render (captions read the same words)
```

## Engine choice (researched 2026-11-14, official sources)
Researched for this machine: Apple M1 MacBook Air, 8 GB RAM, about 8 GB of free disk.

| | Qwen3-TTS (chosen) | VoxCPM2 | OpenVoice V2 |
|---|---|---|---|
| licence: code / weights | Apache-2.0 / Apache-2.0 | Apache-2.0 / Apache-2.0 | MIT / MIT (+ MeloTTS MIT) |
| model used / size | 0.6B Base, about 2.5 GB (1.7B is 4.5 GB) | 2B, about 5.0 GB | about 0.13 GB + MeloTTS |
| cloning input | reference audio + its transcript | reference audio (transcript optional) | reference audio |
| delivery control on a cloned voice | none documented; sampling only | style prefix, e.g. "(slightly faster, cheerful)" | speed |
| Apple Silicon | via **mlx-audio** (MIT), native MLX | about 8 GB VRAM officially; community MLX ports | CPU; macOS install issues noted upstream |
| naturalness | high | high | lower (base TTS + timbre conversion) |

**Why Qwen3-TTS 0.6B:**
- It's the only high-quality cloning model that fits this Mac's RAM and remaining disk, with a documented cloning API on Apple Silicon (mlx-audio).
- VoxCPM2 has real style control for cloned voices but doesn't fit the free disk.
- OpenVoice fits easily but sounds noticeably less natural.

The engine sits behind `ENGINES` in `tools/narration/voice.mjs`; another engine needs a registry entry and, if its API differs, a branch in the worker.

**Sources:**
- github.com/QwenLM/Qwen3-TTS and its LICENSE;
- huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base;
- github.com/OpenBMB/VoxCPM and huggingface.co/openbmb/VoxCPM2;
- github.com/myshell-ai/OpenVoice and huggingface.co/myshell-ai/OpenVoiceV2;
- github.com/Neywa-Labs/mlx-audio.

## Setup (one time)
```bash
node tools/narration/voice.mjs status            # disk, RAM, what is installed and enrolled
node tools/narration/voice.mjs install           # prints the plan: about 2.6 GB model + about 1.5 GB Python environment, about 3 GB RAM
node tools/narration/voice.mjs install --yes     # downloads and installs into .cache/voice/ (gitignored); refuses if the disk can't hold it
```
The manifest (`.cache/voice/manifest.json`) records the model, package versions and measured sizes. The worker runs with `HF_HUB_OFFLINE=1`.

## Enrolling the owner's voice
Use only a voice you own or have explicit permission to clone.
1. Record 10–20 s of natural speech: a quiet room, no music, one take, at your normal storytelling energy. The tool accepts 3–60 s.
2. Enroll it:
   ```bash
   node tools/narration/voice.mjs enroll --id owner --audio my-voice.m4a --owner "<your name>" \
     --consent "I am <name>; this is my own voice and I permit Hold Up to clone it" --transcript "<exactly what you said>"
   ```
   Without `--transcript`, whisper.cpp transcribes the recording; check the result.
3. **Where it's stored:** `voices/private/owner/` (gitignored): `reference.wav` (24 kHz mono), `voice.json` (owner, consent, date, SHA-256, transcript) and `profile.json`.

## Providers (`tools/narration/providers/`)
Every provider implements `render(script, profile)`, `estimate`, `cacheKey`, `synthesize` and optionally `prepare`. All are free.

| provider | output | word timing | use |
|---|---|---|---|
| `local-clone` | WAV (engine rate, 16-bit) | whisper.cpp | the Hold Up narrator (the owner's cloned voice) |
| `macos-say` | AIFF → WAV | whisper.cpp | development fallback (the original narrator) |
| `recorded` | any audio | whisper.cpp | real human recordings (`--audio <file>`) |

**Local cloning in practice:**
- The worker applies a setting only if the model's `generate()` names it, and reports what it applied and ignored. Unsupported controls are never assumed.
- The cache key includes the engine version, model, the SHA-256 of the reference recording, settings, seed and text, so changing any of them regenerates.
- **Safety net:** `tts.mjs` still refuses any provider marked `paid` unless a named person approves a USD cap (`HOLDUP_BLOCK_PAID_TTS=1` blocks them all). No paid provider is registered.

## Delivery markup (`tools/narration/markup.mjs`)
Scripts keep their exact words; markup shapes delivery only:

| markup | meaning | local cloning (`punctuation`) | macOS say |
|---|---|---|---|
| `[[slnc 350]]` | an intentional beat (ms) | an ellipsis after the word, if ≥ `delivery.minPauseMs` and not already at a sentence end | as written |
| `[[emph +]]` | stress the next word | word kept as is (no emphasis control) | as written |
| `[[tone amused]]` | style for what follows | dropped (no style control in Qwen3-TTS Base) | dropped |

Marked beats are measured in every take (`words.json` → `pauses`) and checked by the sync report.

## Word timing, takes and sync
- **Timing:** whisper.cpp aligns every take to the script (`tools/narration/align.mjs`). Timing is measured, never estimated.
- **Takes:** each take is kept in `production/<slug>/takes/<take>/`. `--use-take <id>` switches the active take without regenerating.
- **Sync report:** narrating a story whose previous take exists, or switching takes, writes `narration-sync.json` with retimed shots and actions, plus these conflicts:

| code | severity | meaning |
|---|---|---|
| `ANCHOR_MISSING` | error (blocks) | a word the storyboard anchors to is no longer spoken |
| `VALIDATION_ERROR` | error | the retimed plan fails storyboard validation |
| `CAPTION_DRIFT` | error | a caption would not show its word |
| `SCRIPT_CHANGED` | editorial | the spoken script differs between takes |
| `SHOT_RETIMED_HEAVILY` | editorial | a shot is < 0.65× or > 1.5× its previous length |
| `MOVE_TOO_FAST` | editorial | a camera move now has fewer than 8 frames |
| `ACTION_CROSSES_CUT` | editorial | a timed action that fitted its shot now runs past the cut |
| `BEAT_LOST` | editorial | a marked beat of ≥ 300 ms kept less than 35% of its length |
| `NEW_WARNING` | review | a storyboard warning the old take did not have |

## Narrator audition (`voices/auditions/barrel-bilge.json` → `production/narration/auditions/`)
The full barrel-bilge script is read by the **same cloned voice** in three delivery variants:
1. **Natural conversational:** the script's own punctuation, default sampling.
2. **Energetic storyteller:** no added beats, and sampling temperature 0.9, *if the engine accepts it*.
3. **Expressive, comedic timing:** every marked beat becomes an ellipsis ("a name… the bilge", "easy to roll… and easy to turn"), with temperature 0.8 if accepted.

Qwen3-TTS Base documents no style, emotion, speed or pitch control for cloned voices. The variants therefore differ only by punctuation (always applied) and by sampling settings the engine accepts; `comparison.json` lists what was applied and ignored for each take.

```bash
node tools/narration/audition.mjs prepare                    # plan and what is still missing (no generation)
node tools/narration/audition.mjs generate                   # voice-01.wav .. voice-03.wav + comparison.json + README.md
node tools/narration/audition.mjs select <1|2|3> --by "<name>"   # the owner's choice becomes the Hold Up narrator
```

## Re-voicing barrel-bilge (after the narrator is approved)
```bash
npm run storyboard -- --story stories/barrel-bilge/story.json --narrate        # uses the approved narrator; writes narration-sync.json
npm run storyboard -- --story stories/barrel-bilge/story.json --render --quality production --qa --name production-natural-voice
```
Review the sync report before rendering. `--use-take` returns to the approved macOS take at any time.
