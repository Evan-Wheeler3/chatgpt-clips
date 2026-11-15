# Sound and caption plan (revision 2)

The Phase 6.2 systems are used unchanged:
- the hold-up captions;
- the scheduler with manual cues;
- the mixer (narration −16 LUFS, effects −3 dB under speech, master −14 LUFS / −1.5 dBTP).

**Music:** none (no approved music exists).

## Sourcing policy (owner direction)
- **Natural recordings first:** verified **CC0** recordings, especially for the liquid sounds. Each import goes through `tools/audio/import.mjs` with its licence, source page, author and evidence, and starts as `pending-review`.
- **Synthesized alternatives** are generated with `tools/audio/synth.mjs` and compared by ear. The owner picks.
- Every asset keeps its licensing metadata in `audio/catalog.json`. Nothing is used before approval.
- **No sound has been sourced, created or downloaded yet.**

## Cues (`story.json` → `audio.sfx`; **measured** times on the `rev4-recommended` take)
| Cue | Anchor | Time (s) | Asset (new) | Source |
|---|---|---|---|---|
| Overflow gush | 0.5 s before "How" | 0.22 | `fuel-gush-loop` | **CC0 recording** (liquid pouring); a synth alternative for comparison |
| Splash | "know" | 1.68 | `fuel-splash` | **CC0 recording**; a synth alternative |
| **CLICK** (hook) | "That" − 0.1 s, the freeze frame | 2.86 | `nozzle-click` | A CC0 recording of a real nozzle or latch click if found; otherwise a synthesized metal impact. +2 dB. The gush stops dead here |
| Rewind | "That" + 0.03 s | 2.99 | `fuel-gush-reversed` | **Derived** from the approved gush recording: reversed, +1–2 semitones. It inherits the source licence |
| Gulp | end of "click?" | 3.57 | `fuel-gulp` | CC0 recording, or derived from the splash |
| Air suction | "sucks" | 10.88 | `air-suction-loop` | Synthesized band-passed hiss; a CC0 air-leak recording as the alternative |
| Air stops | "stops" (1st) | 16.32 | `air-stop` | Synthesized choke-off |
| Diaphragm | "pulls" | 18.00 | `diaphragm-flex` | Synthesized soft rubbery thump |
| Latch | "releasing" | 19.52 | `latch-release` | A CC0 small-metal recording or a synth |
| **CLICK** (payoff) | "valve." | 20.64 | `nozzle-click` | The same asset as the hook; synchronized to valve closure |

The pump-counter cue from revision 3 is removed: revision 4 has no pump-computer shot.

**Ambience:** a new `gas-station` profile (wind, distant traffic, canopy hum).
- Distant traffic should be a **CC0 recording**; the hum and wind can be synthesized.
- Ducked 3 dB under speech, plus 3 dB lower inside the cutaway.

**Needed mixer features (planned, not built):**
- a per-shot ambience level;
- a **150 ms ambience dip** on the hook click, to create the near-silence;
- a hard stop of a looping effect at a cue (the gush stops dead on the click).

## Captions
- **Style:** hold-up, 22 groups (measured take).
- **Emphasis:**
  - voice: nozzle, hole, air, stops, suction, hole;
  - captions: the same, plus every "hole".
- **Placement:**
  - **Exterior shots 1–3, 9 and 10:** lower band. The nozzle and filler neck stay in the middle third.
  - **Cutaway shots 4–8:** **pinned upper**. Mechanism framings keep the moving part in the lower two-thirds.
- **Group boundaries match the cuts**, measured: "That click?" is its own group on the rewind; "on a diaphragm, releasing" stays in `diaphragm`; "a spring-loaded valve." opens `valve-shut`.
- **To recheck on the production take:** "See this tiny *hole* near / the tip?" (a weak two-word tail) and "All because of that tiny / *hole.*" (a single-word last group). The second ends on the payoff word, which is acceptable and arguably stronger.
