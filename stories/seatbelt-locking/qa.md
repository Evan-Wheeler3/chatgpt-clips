# QA: preview build of 2026-11-15

Rendered on a cloud machine with software GL (SwiftShader), production quality: 1080x1920, 30 fps, bloom, grade, 4x MSAA.

## Measured
| check | result |
| --- | --- |
| Duration | 31.16 s (30.26 s narration + 0.9 s tail). **Over the 30 s target by about 1.2 s** with the stand-in voice at speed 1.1 |
| Video | H.264, 1080x1920, 30 fps, 935 frames |
| Loudness | -14.2 LUFS integrated, peak -1.0 dBFS (0.5 dB above the -1.5 dB target); pre-master figures in `production/seatbelt-locking/audio-report.json` |
| Narration over effects | voice stem -16 LUFS, effects stem -32 LUFS, effects ducked 3 dB under speech |
| "Clank" words vs lock sounds | each lock sound starts 20 ms after its word starts (by construction: cues are word anchors) |
| Captions | 2-5 word groups from the same measured words; one band per shot (top), clear of the face and the mechanism in the sampled frames |
| Render time | 8.7 min at preview quality, about 41 min at production quality (CPU) |

## Reviewed by eye (frames only, 27 sampled + motion strips; nobody has watched it play or heard it)
- Belt: extends, stops, relaxes between pulls, and ends buckled across the chest.
- Crash comparison: same framing; without the lock the dummy pitches to the wheel, with it a short lurch and rebound.
- Retractor: spool, carrier, inertia disc and pawl are distinguishable; the pawl is tucked while turning and sits in a tooth after the jerk.

## Known imperfections
1. Narrator is a stand-in, not the approved cloned voice.
2. Not compared with the barrel-bilge benchmark (not available on this machine).
3. The car interior, sled and lab are simple hand-built sets with painted textures, not library or downloaded models.
4. Reach poses: while his hand goes up for the belt (shot 1 and the first frames of shot 9) the forearm stands vertical in front of his shoulder and reads stiffly.
5. Tension shot opens with the dummy's head partly under the caption.
6. The inertia disc's lag is small on screen; the pawl swing carries the explanation.
7. The buckle is on the far side of the driver, so the latch itself is mostly hidden; the click is carried by sound and the belt settling.
8. Caption font falls back to Inter on Linux (Avenir Next on the Mac).
9. The stowed belt is out of frame before he grabs it.
