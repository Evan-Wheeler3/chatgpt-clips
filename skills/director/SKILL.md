---
name: hold-up-director
description: Direct original narrated 3D animated vertical Shorts using staged voice-first production, reusable licensed assets, deliberate cameras, and Remotion rendering.
---

# Hold Up — director

Use this skill to direct a Hold Up animated Short. Read the [motion lessons log](../../docs/MOTION-LESSONS.md) before planning. Load [`hold-up-cinematography`](../cinematography/SKILL.md) for the edit map, animatic, camera rig, animation plan, motion review and final validation.

## Mandatory checkpoints
1. **Story:** identify the first-second question, stakes, mechanism and payoff; make a factual source sheet.
2. **Voice:** render narration once the draft is approved, select delivery appropriate to the story, measure actual word times. Avoid rigid monotone.
3. **Edit map:** plan one readable visual idea per beat and resolve it to measured voice timestamps. Specify evolving compositions, motivated transitions and contact timing with the [shot planning standard](../../docs/STORYBOARD.md#cinematic-shot-planning). Create and review a storyboard/animatic.
4. **Asset map:** produce requests in the documented JSON format; resolve local assets first. If an asset is missing, try curated external adapter when available; escalate to Blender asset creation only when reuse fails.
5. **Scene:** place/import models in Three.js, enforce coherent materials, scale, lighting and outlines. Build reusable props, not one-off verbose geometry.
6. **Camera and action:** choose a motivated technique and specify path, aim, continuity, locomotion and contact. Check substantial visual developments and vertical safe areas in-engine.
7. **Audio:** sync SFX with physical impacts, duck score beneath narration, check loudness and intelligibility.
8. **Review:** render a low-resolution motion preview. Check smoothness, contacts, continuity, visual rhythm, readability and narration sync. Fix and re-preview problems, then record the [motion-pass approval](../../docs/MOTION-QA.md#preview-and-approval).
9. **Final:** use the episode's existing render path after motion approval. Verify the final against the approved preview and report actual timings, sources, licenses, metrics and unresolved concerns.

## Inputs
An original script or topic, reference style guidance, asset catalog, the user's narration preference, and the local Three.js production checkout.

## Outputs
Episode source files under `stories/<slug>/`. Generated measured words, resolved shots, asset-resolution and QA reports, previews and final exports follow the existing episode paths.

## Current implementation

The declarative [storyboard route](../../docs/STORYBOARD.md) produces narration-aligned plans, validation and previews. The [hand-directed episode route](../../stories/seatbelt-locking/README.md) covers actions outside the declarative vocabulary using a custom Three.js scene. Follow the episode's current render instructions. See [architecture](../../docs/ARCHITECTURE.md) for current entry points and [narration](../../docs/NARRATION.md) for the approved voice pipeline.
