# Readiness report (Phase 7A)

**Verdict:**
- The script, research and shot plan are ready for approval.
- **Production is not ready.** It is blocked on the protagonist artwork, the nozzle model and new animation/fluid features.

## Objective checks (`node tools/episode-check.mjs --story stories/gas-pump-shutoff/story.json`)
Output: `production/gas-pump-shutoff/preproduction-check.json`, not committed.

| Check | Result |
|---|---|
| Story compiles (schema v1, all word anchors resolve) | **Pass**: 10 shots, 4 beats |
| Estimated duration (narrator's measured pace) | **31.8 s** (96 words; target 28–32 s) |
| Validation status | `needs-revision`, from **5 errors**, all `MISSING_ASSET` (car, fuel-pump, nozzle, nozzle-cutaway, spout-tip-cutaway). Expected: nothing is substituted |
| Cast | `gas-pump-shutoff-protagonist` **not available** (intake awaiting artwork). The check strips the driver's events to test the rest |
| Warnings | `SHOT_LONG air-path` (5.4 s; accepted: one continuous move). `STATIC_SHOT covered` (accepted: the hold is the point; the rising fuel isn't visible to the validator). `STATIC_SHOT click-rewind` (artefact of the stripped character events; clears when the driver exists) |
| Fixed during planning | `PERPETUAL_ZOOM` (three push-ins in a row), `JUMP_CUT` ×2, two shots over 4.5 s, duration 33.6 s → 31.8 s |
| Captions | 28 groups; cutaway shots pinned upper; emphasis on nozzle / air / suction / hole / snaps |
| Sound | 9 cues scheduled; **8 distinct assets missing**, plus the `gas-station` ambience profile |
| Facts | 11 narrated claims verified against patent text; 1 flagged simplification ("not electronic"); unverified items kept out (`research.md`) |

## Blockers before Phase 7B production
1. **Protagonist artwork**: owner-supplied, then design approval (`characters.md`).
2. **Nozzle hero model** (exterior + cutaway, named parts). Decide Blender or parametric.
3. **Compiler features**:
   - named-part animation;
   - material states (x-ray);
   - fluid/particle effects;
   - a highlight ring;
   - impact shake;
   - per-shot ambience level.
4. **Outdoor environment**: new environment types (open ground, canopy, island) and CC0 textures via the Poly Haven adapter.
5. **Sounds**: 7 synthesizable effects, 2 liquid sounds needing an owner decision, 1 ambience profile.
6. **Narration take**: generate with the approved voice, align, and check the gap after "stop?" for the click.

## Quality evaluation (self-assessment, to be confirmed by the owner)
| Criterion | Score | Notes |
|---|---|---|
| Hook | 9/10 | A disaster image plus the exact question viewers ask, both in the first second; the click is a sharp pattern-break at 2.8 s |
| Curiosity | 8/10 | Two reversals ("the nozzle does", "it's air") before 5 s keep the viewer watching |
| Clarity | 8/10 | One causal chain, one visual per link, consistent colours for fuel, air and suction. Risk: the latch beat (3 actions in 3.2 s) is dense |
| Pacing | 7/10 | About 3 words/s, average shot 3.2 s. `air-path` is long; the real take may move it |
| Payoff | 8/10 | The click callback plus the "one tiny hole" loop. Satisfying, but quieter than the hook |
| Accuracy | 9/10 | Every mechanism claim is sourced. Two simplifications: "not electronic" and two latch balls instead of about three |
| Feasibility | 6/10 | All techniques are tractable on the M1, but there's a lot of new build: a hero model, new compiler features, an outdoor environment, a new character |
