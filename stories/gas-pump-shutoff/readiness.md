# Readiness report (Phase 7A, narration revision 4)

**Verdict: Phase 7A APPROVED** by the owner on 2026-11-14:
- revision 4 with both technical fixes;
- the `rev4-recommended` take (24.48 s) and the 25.10 s timeline;
- the 10-shot storyboard, with relief instead of the thumbs-up in shot 9.

**Phase 7B has not started.** Its execution plan comes first, for review.

## Objective checks (`node tools/episode-check.mjs --story stories/gas-pump-shutoff/story.json --words production/gas-pump-shutoff/takes/rev4-recommended/words.json`)
| Check | Result |
|---|---|
| Narration timing | **Measured**, not estimated. The approved narrator gives 24.48 s spoken (75/75 words force-aligned exactly); the owner's wording as written gives 21.84 s. Both are under the 28–32 s target; options are in `narration.md` |
| Pause after the opening question | 0.48 s, measured (the click needs at least 0.30 s): **passes** |
| Story compiles against the measured take | **Pass:** 10 shots, 3 beats; video 25.10 s |
| Validation | `needs-revision` from **5 `MISSING_ASSET` errors** (car, fuel-pump, nozzle, nozzle-cutaway, spout-tip-cutaway). These are expected: nothing is substituted, sourcing is planned (`sourcing-report.md`), and the Sketchfab adapter is built and pushed (`fecd864`) |
| Warnings | `JUMP_CUT rewind`: intended, the seamless join. `STATIC_SHOT covered`: intended. No shot is over 4.5 s |
| Cast | `hold-up-protagonist` is awaiting artwork. The check strips the protagonist's events to test the rest |
| Captions | 22 groups; 12 pinned upper in the cutaway; no group crosses a cut |
| Sound | 10 cues on measured words; 9 distinct assets missing, plus the `gas-station` ambience profile |
| Technical accuracy | Each revision 4 line was checked against nozzle patents (`research.md`, "Revision 4: line-by-line technical validation"). **Two corrections recommended:** the click's source is unsourced as written, and the cause of the suction (the rushing fuel) was missing |
| Take ending | **Not clipped.** The final 20 ms are at −62.6 dBFS; the video runs 0.62 s past "hole". Now checked automatically (`ending` in `words.json`, reported by `episode-check`) |

## Blockers before Phase 7B production
1. ~~Owner approval of the narration script~~: **approved** (revision 4 + fixes, take `rev4-recommended`).
2. **Protagonist artwork** (the ChatGPT sheet), then design approval.
3. **Assets:**
   - the owner's free Sketchfab API token;
   - fetch → convert → **owner review** → register the nozzle, dispenser, station and car;
   - Poly Haven textures and props.
4. **Custom build:** the nozzle internals, the sensing hole, the filler-neck cutaway, the car's fuel door.
5. **Compiler and renderer features:**
   - named-part animation;
   - clipping-plane cutaway and x-ray;
   - fluid and particle effects with time reversal;
   - the freeze frame;
   - pale-blue air arrows;
   - the highlight ring;
   - impact shake;
   - an outdoor environment.
6. **Audio:**
   - CC0 recordings (liquids first), plus synth alternatives;
   - the mixer's ambience dip, hard-stop and per-shot ambience (approved).
7. ~~The production take~~: **approved** (`rev4-recommended`, aligned, ending checked).

## Quality evaluation (self-assessment)
| Criterion | Score | Notes |
|---|---|---|
| Hook | 9/10 | The overflow, then "That click?" spoken exactly as the rewind plays |
| Curiosity | 8/10 | "See this tiny hole near the tip?" lands at 7.3 s, a strong mid-point question |
| Clarity | 9/10 | A simpler chain than revision 3: air in → hole covered → suction → diaphragm → valve. The visuals carry the latch detail |
| Pacing | 8/10 | 10 shots in 25 s; the longest is the deliberate 4.4 s hold |
| Payoff | 8/10 | A second click on the valve, the flow stopping, and an ending on the hole |
| Accuracy | 9/10 with the corrections (7/10 as written) | The two corrections close the only gaps |
| Feasibility | 7/10 | Unchanged: the risk is in the effects and the cutaway, not the assets |
