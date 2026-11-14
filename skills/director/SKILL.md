---
name: hold-up-director
description: Direct original narrated 3D animated vertical Shorts using staged voice-first production, reusable licensed assets, deliberate cameras, and Remotion rendering.
---

# Hold Up — director

Use this skill when the user asks Claude Code to create a new Hold Up animated Short.

## Mandatory checkpoints
1. **Story:** identify the first-second question, stakes, mechanism and payoff; make a factual source sheet.
2. **Voice:** render narration once the draft is approved, select delivery appropriate to the story, measure actual word times. Avoid rigid monotone.
3. **Edit map:** define shots by voice timestamps, with one readable visual idea per beat. Any movement or cut must support a word, action, reveal or perspective change. Create a basic storyboard/animatic.
4. **Asset map:** produce requests in the documented JSON format; resolve local assets first. If an asset is missing, try curated external adapter when available; escalate to Blender asset creation only when reuse fails.
5. **Scene:** place/import models in Three.js, enforce coherent materials, scale, lighting and outlines. Build reusable props, not one-off verbose geometry.
6. **Camera:** use subject tracking, punch-in, reveal, pan, object-follow, motivated transition or stillness. Check vertical safe areas. Avoid obligatory constant creep.
7. **Audio:** sync SFX with physical impacts, duck score beneath narration, check loudness and intelligibility.
8. **Review:** low-res preview first; check frame-level pops, camera collisions, continuity, unexplained silent gaps, dead frames and narration sync. Human review gate before final.
9. **Final:** render final through Remotion and export an audit containing real timings, sources, licenses, measured metrics and unresolved concerns.

## Inputs
An original script or topic, reference style guidance, asset catalog, the user's narration preference, and a working local Three.js/Remotion project.

## Outputs
`production/<slug>/story.md`, `words.json`, `shots.json`, `asset-requests.json`, `asset-resolution.json`, preview, final video, `qa.json`.

## Current implementation limitations
This repo currently implements the **local asset resolver, the Poly Haven search/download adapter and contracts only**. Do not claim the complete studio pipeline or Blender MCP is working until integrated and tested.
