# V2 architecture

## Separation of responsibility
- **Claude Code:** research, scripts, artistic decisions, shot schema, escalation, review.
- **Deterministic utilities:** asset lookup, schema validation, downloads, model conversion, hashes, scene assembly, rendering and technical QA.
- **Three.js:** real-time scene composition and camera/action animation.
- **Remotion:** frame-accurate edit/audio synchronization, captions if wanted, compositing and final render.
- **Blender (optional):** specialized model conversion, repair, rigging and authoring. MCP can facilitate interactive work; unattended batch workflows should use reproducible Blender scripts where practical.

## Why V2
Original `SKILL.md` is a detailed instruction set for a particular bridge short. It uses `templates/bridge/`, custom geometry, fixed color/shadow choices and many bridge-specific paths. Reuse the strongest rendering techniques selectively; general story production must not depend on copying one full world.

## Phase order
1. Baseline repo audit and local asset registry/resolver. (done)
2. External provider adapters with explicit license/provenance checks and download cache. (done: Poly Haven; Sketchfab CC0/CC BY with token-gated downloads, added in Phase 7A)
3. Asset converter/validator: deterministic glTF → GLB, Khronos + scale/orientation validation, Three.js previews, approved catalog registration. (done; Blender path for other formats/repairs still open)
4. Voice-first storyboard: measured narration timing, shot-plan compiler, reusable camera/action library, validation and low-res animatic. (done; see `docs/STORYBOARD.md`)
5. Environments, art direction, 2D characters in 3D, animation presets, preview and production quality with pixel QA. (done; see `docs/VISUALS.md`)
   5.3 The approved cooper rebuilt as a reusable vector rig (`render.mode: "vector-2d"`). Approved. See `docs/CHARACTER-RIG.md`.
   5.4 The cooper is locked as the master character (`characters/cooper/`, versioned, with visual regression) and stars in barrel-bilge; Bram is legacy. Production approved.
   5.5 Character library, resolver, image-first intake, approval gates and rig attachments: see `docs/CHARACTER-LIBRARY.md` and `docs/CHARACTER-STYLE-GUIDE.md`.
6. Final voice, captions, sound design and audio QA; Remotion composition.
   6.1 Narration engine: free local voice cloning of the owner's voice (Qwen3-TTS 0.6B via mlx-audio; macOS say fallback; recordings), voice profiles, delivery markup, forced-aligner word timing (whisper fallback), takes and narration sync reports. The owner approved the narrator and the natural-voice barrel-bilge render. See `docs/NARRATION.md`.
   6.2 Burned-in Hold Up captions (word-synced groups, emphasis, per-shot safe placement), a generated CC0 sound library with licence-checked imports, animation-driven sound effects, ambience, optional ducked music, a local mixer mastered to −14 LUFS, and caption and audio QA. See `docs/CAPTIONS-AUDIO.md`.
6. Benchmarked end-to-end sample and iteration.

## Data contracts
- Catalog: `assets/catalog.json`.
- Request: `examples/asset-requests.json`.
- Resolver output: status `found` or `not_found`; chosen asset must include `license`, `sourceUrl` and `localPath`.
- Story: `stories/<slug>/story.json` (beats, shots, word anchors, props, events). Shot plan: `production/<slug>/shots.json`, frame-exact and generated from measured `words.json`. See `docs/STORYBOARD.md`.
- No provider adapter may return a downloaded asset without source and license evidence.

## Decision gates
Judge a candidate by era fit, style match, poly/texture budgets, inspectable license, useful camera angles, and downstream GLB readability. If uncertain, leave unresolved and request approval instead of auto-publishing.
