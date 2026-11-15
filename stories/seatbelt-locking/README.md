# Why Does Your Seatbelt Lock When You Pull It Too Fast?

Status: **preview build, not ready to publish.** It was produced on a cloud machine that has only what is in Git, so three
things differ from the brief:

| brief | this build | to finish on the Mac |
| --- | --- | --- |
| Approved owner-cloned narrator (Qwen3-TTS) | Stand-in voice (Kokoro `am_michael`), marked `standIn` in `words.json` | Re-narrate with the approved profile, then re-render; every shot, action, caption and sound cue is keyed to words and retimes itself |
| Match `production/barrel-bilge/production-sound-design.mp4` | The benchmark video is git-ignored and was not available; the look follows `styles/hold-up.json` and `docs/VISUALS.md` only | Compare side by side and adjust |
| Asset-first: approved library, then licensed downloads | No library GLBs or provider access here, so the car interior, sled and retractor are built in code in `scene.mjs` | Swap in a licensed interior model if one clears review |

## Build
```bash
python tools/episode/standin_voice.py stories/seatbelt-locking/story.json production/seatbelt-locking   # stand-in only; needs kokoro-onnx, faster-whisper
node tools/audio/synth.mjs                                                                              # sound library (already committed)
node tools/episode/mix.mjs stories/seatbelt-locking/story.json
node tools/episode/render.mjs stories/seatbelt-locking/story.json --quality production
ffmpeg -i production/seatbelt-locking/picture.mp4 -i production/seatbelt-locking/mix.wav -c:v copy -c:a aac -b:a 192k -shortest production/seatbelt-locking/seatbelt-locking.mp4
```
With the real narrator, replace the first step with a normal take (`narration.wav` + `words.json` in `production/seatbelt-locking/`).

## Why a custom scene module
The storyboard's declarative actions cover props and standing characters. This episode needs a seated driver whose hand
holds a belt, webbing that follows it, a sled and a mechanism cutaway, so the action is directed in `scene.mjs` and rendered
by `tools/episode/render.mjs`. Timing still comes only from measured words. Shared with the main renderer: the vector
character painter, the Hold Up style and grade, the caption renderer and styles, and the sound catalog and loudness targets.

Files: `story.json` (approved script, shots, captions, sound cues), `scene.mjs`, `research.md`, `storyboard.md`, `credits.md`.
