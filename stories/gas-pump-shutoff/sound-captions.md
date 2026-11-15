# Sound and caption plan

Everything uses the Phase 6.2 systems unchanged:
- the hold-up caption style;
- the effect scheduler with manual cues;
- the mixer (narration at −16 LUFS, effects −3 dB under speech, a −14 LUFS / −1.5 dBTP master).

**Music:** none (no approved music exists).

## Sound-effect cues (`story.json` → `audio.sfx`; times from the scratch timeline)
| Cue | Anchor | ≈ time | Asset (new) | Source plan |
|---|---|---|---|---|
| Overflow gush | 0.5 s before "How" | 0.14 s | `fuel-gush-loop` | **Hard to synthesize convincingly** (pouring liquid). Either a CC0 recording import with licence evidence, or a synthesis attempt reviewed by ear. Owner decision |
| Splash on pavement | "know" | 1.65 s | `fuel-splash` | Same as above |
| **CLICK** (hook) | 0.1 s before "It", on the cut | 2.81 s | `nozzle-click` | Synthesize: a metal modal impact (a sharp latch tick plus a lower valve clack, about 120 ms). +2 dB. The gush stops dead here |
| Rewind | 0.04 s before "It" | 2.87 s | `rewind-swoosh` | Synthesize from the existing whoosh generator, reversed, with a rising pitch sweep |
| Air suction | "pulls" | 14.35 s | `air-suction-loop` | Synthesize: band-passed noise, a thin airy hiss, loopable. −4 dB |
| Air stops | "No" | 21.60 s | `air-stop` | Synthesize: the hiss choked off with a fast low-pass sweep |
| Diaphragm | "tugs" | 23.31 s | `diaphragm-flex` | Synthesize: a soft rubbery thump |
| Latch | "latch" | 26.26 s | `latch-release` | Synthesize: a small metal snick |
| **CLICK** (payoff) | "snaps" | 28.71 s | `nozzle-click` | The same asset as the hook, on purpose (callback). +2 dB |

**Automatic cues:**
- The scheduler adds gesture rustles for the driver's big poses (surprised, point, thumbs-up) once the character exists.
- No roll, pivot or walk events.

**Ambience:** a new `gas-station` profile in `audio/ambience.json`:
- light wind, distant traffic and a faint canopy-light hum;
- ducked 3 dB under speech;
- lowered a further 3 dB inside the cutaway (shots 3–9) so the mechanism sounds "inside".
- The hum and wind are synthesizable. Distant traffic is better as a CC0 recording.
- The per-shot ambience level is a **new feature**: the current profile has one level.

**Licensing:** every new asset goes through `tools/audio/import.mjs` (licence + source + evidence; CC0 / CC-BY only) or `tools/audio/synth.mjs` (original, CC0 dedication). Nothing is used before human approval. **No sound has been created or downloaded in Phase 7A.**

## Captions
- **Style:** hold-up (Avenir Next Heavy 74 px, ink stroke, amber highlight for the spoken word).
- **28 groups** (from `episode-check`).
- **Emphasis:**
  - voice markup on nozzle, air, suction and snaps;
  - plus "hole" via `captions.emphasize` (amber at each mention: the visual motif).
- **Placement keeps the nozzle visible:**
  - **Exterior shots 1, 2 and 10:** automatic band, which chose *lower*. The nozzle and filler neck are framed in the middle third, and the driver's head is in the upper half.
  - **Cutaway shots 3–9:** **pinned upper band** (0.24). Every mechanism framing must keep the moving part in the lower two-thirds. That is a composition rule for Phase 7B framing, checked by caption QA.
- **Known caption issues to recheck with the real take:**
  - "See this tiny *hole* near / the tip?" splits before "the tip": a weak 2-word tail from the 24-character limit. Acceptable; the real pauses may regroup it.
  - "and a spring *snaps*" starts in `latch` and the group continues into `snap`. A group belongs to the shot of its first word, so "snaps" is captioned over the latch frame for about 0.4 s before the cut. Options:
    - anchor the `snap` cut to "and#2"; or
    - accept it (the word lands right before its picture).

    To decide on the real take.
