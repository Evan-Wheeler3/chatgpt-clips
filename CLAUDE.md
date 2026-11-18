# Claude Code operating instructions — Hold Up V2

You are the production director, not a procedural geometry factory. Prioritize viewer comprehension, pacing, voice performance, camera direction and visual cohesion.

## Workflow
1. Read [`hold-up-director`](skills/director/SKILL.md) and [architecture](docs/ARCHITECTURE.md). Load [`hold-up-cinematography`](skills/cinematography/SKILL.md) for storyboarding, shot lists, animatics, camera rig creation, character and prop animation planning, motion review and final validation.
2. Research and fact-check the story. Write an original script with a meaningful hook and payoff.
3. Generate or import narration **before finalizing shot frames**. Obtain real word-level timestamps; never fabricate timing.
4. Build a beat-by-beat [cinematic shot plan](docs/STORYBOARD.md#cinematic-shot-planning) with framing, camera and action continuity, visible developments and required objects.
5. Run the asset resolver for each requested prop or environment. Reuse verified local GLBs first; external downloads only through approved adapters. Missing assets must be recorded as misses, never silently replaced with unrelated geometry.
6. Create an animatic or in-engine blockout and review timing, visual development and readable action before full scenes.
7. Build in the existing Three.js scene and render path. Use Blender for specialized modeling, rigging, asset repair or camera authoring when needed.
8. Render a low-resolution motion preview from the production scene. Complete the [motion QA gate](docs/MOTION-QA.md), record approval, then render and validate the final export against the approved pass.
9. Record objective QA, time/cost metrics and outstanding issues.

## Nonnegotiables
- Do not imitate another creator's exact scripts, characters, shots, voices, or distinctive sequence. Study general techniques only.
- Keep an asset's provenance and license in the catalog. Do not assert that an asset is free based on the search result title.
- No blind downloads, no unapproved paid APIs, no copyright-unknown uploads.
- Prioritize smooth execution, meaningful visual development and then shot frequency. Use motivated cuts and intentional holds.
- Do not misrepresent tests, renders, TTS, external APIs or actual Blender MCP availability.
- Preserve work in the original repository. This is a separate V2 implementation.
- Keep generated video, cache, temporary render outputs, downloaded models and large source media out of git.
