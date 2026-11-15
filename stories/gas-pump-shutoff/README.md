# Episode: How does a gas pump know when to stop?

Phase 7A pre-production package. **Status:** awaiting owner approval. Nothing has been narrated, modeled or rendered.

| File | Contents |
|---|---|
| [`narration.md`](narration.md) | Recommended script, two alternate hooks, an alternate ending, the timing estimate |
| [`production-script.md`](production-script.md) | Master script, per shot: purpose, narration, composition, animation, camera, transitions, captions, SFX, timing, facts |
| [`storyboard.md`](storyboard.md) | Shot-by-shot table and rhythm |
| [`story.json`](story.json) | Machine-readable storyboard (schema v1). Unbuilt effects live under `planned` |
| [`mechanism-plan.md`](mechanism-plan.md) | Nozzle parts, fluid path, visual treatments, accuracy checklist |
| [`assets.md`](assets.md) | Every asset, classified available / modify / external / custom / human approval |
| [`characters.json`](characters.json), [`characters.md`](characters.md) | Protagonist request and intake status |
| [`sound-captions.md`](sound-captions.md) | SFX cues, ambience, caption placement and emphasis |
| [`research.md`](research.md) | Verified facts with patent and manufacturer sources; unverified list |
| [`feasibility.md`](feasibility.md) | Liquid, transparency and rendering on the M1 |
| [`readiness.md`](readiness.md) | Objective checks, blockers, quality evaluation |

**Re-run the check:**

```bash
node tools/episode-check.mjs --story stories/gas-pump-shutoff/story.json
```

It writes `production/gas-pump-shutoff/preproduction-check.json`, which is not committed.
