# Episode: How does a gas pump know when to stop?

Phase 7A pre-production package. **Status: APPROVED** (2026-11-14):
- narration revision 4 with both technical fixes;
- take `rev4-recommended` (24.48 s spoken, 25.10 s video);
- the 10-shot storyboard.

Phase 7B awaits review of its execution plan. Nothing has been modeled, downloaded or rendered.

| File | Contents |
|---|---|
| [`narration.md`](narration.md) | Revision 4 as written and recommended, the measured durations and pauses, options against the target |
| [`production-script.md`](production-script.md) | Master script, per shot: purpose, narration, composition, animation, camera, transitions, captions, SFX, timing, facts |
| [`storyboard.md`](storyboard.md) | Shot-by-shot table and rhythm |
| [`story.json`](story.json) | Machine-readable storyboard (schema v1). Unbuilt effects live under `planned` |
| [`mechanism-plan.md`](mechanism-plan.md) | Nozzle parts, fluid path, visual treatments, accuracy checklist |
| [`sourcing-report.md`](sourcing-report.md) | Asset-first sourcing: real candidates, verified licences, adaptation work, build justification |
| [`credits.md`](credits.md) | CC BY 4.0 attribution requirements and the draft YouTube description credits |
| [`assets.md`](assets.md) | Every asset, classified available / modify / external / custom / human approval |
| [`characters.json`](characters.json), [`characters.md`](characters.md) | The recurring Hold Up protagonist: request, ChatGPT brief, wardrobe plan |
| [`sound-captions.md`](sound-captions.md) | SFX cues, ambience, caption placement and emphasis |
| [`research.md`](research.md) | Verified facts with patent and manufacturer sources; unverified list |
| [`feasibility.md`](feasibility.md) | Liquid, transparency and rendering on the M1 |
| [`readiness.md`](readiness.md) | Objective checks, blockers, quality evaluation |

**Re-run the check:**

```bash
node tools/episode-check.mjs --story stories/gas-pump-shutoff/story.json --words production/gas-pump-shutoff/takes/rev4-recommended/words.json
```

It writes `production/gas-pump-shutoff/preproduction-check.json`, which is not committed.
