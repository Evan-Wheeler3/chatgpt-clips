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
1. Baseline repo audit and local asset registry/resolver (this commit).
2. External provider adapters with explicit license/provenance checks; download cache and thumbnails.
3. Asset importer/normalizer with Blender command-line optional path and GLB inspection.
4. Voice-first storyboard and shot-plan compiler.
5. Reusable camera/action library, Remotion scene test harness, audio QA.
6. Benchmarked end-to-end sample and iteration.

## Data contracts
- Catalog: `assets/catalog.json`.
- Request: `examples/asset-requests.json`.
- Resolver output: status `found` or `not_found`; chosen asset must include `license`, `sourceUrl` and `localPath`.
- Future shot plan: voice-synchronized frames, scene assets, camera intent and expected action.
- No provider adapter may return a downloaded asset without source and license evidence.

## Decision gates
Judge a candidate by era fit, style match, poly/texture budgets, inspectable license, useful camera angles, and downstream GLB readability. If uncertain, leave unresolved and request approval instead of auto-publishing.
