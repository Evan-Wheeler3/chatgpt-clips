---
name: hold-up-assets
description: Retrieve and prepare reusable, provenance-tracked 3D assets for Three.js shorts.
---

# Asset sourcing instructions
- Describe the visual job of the asset: object, era, proportions, style, animated/static, preferred materials.
- Search catalog using `npm run assets -- --query "..."`. Use deterministic matching rather than repeatedly asking Claude to hallucinate a file path.
- Inspect thumbnail/preview and ensure asset appears in approved style before scene use.
- Prefer approved CC0 assets; allow attribution-required assets only when the video/project can actually provide attribution. Keep source, creator, license and required attribution intact.
- A search hit is not a guarantee that a file exists: verify `localPath` before loading.
- Imported assets need meter scale, scene orientation, bounding box, normals, sensible polygon/material budgets, texture compression and GLB export checks.
- For misses, mark `not_found` and let the coordinator decide: external search -> human style approval -> Blender repair/custom creation -> simplified procedural fallback only if visually acceptable.
- Cache model and provenance metadata keyed by an immutable provider ID/version and file hash after download.
- Convert with `npm run assets:convert -- --provider polyhaven --id <id>`. Then open `preview.png` and check `report.json` warnings yourself before `npm run assets:register -- --report <path> --approve --approved-by "<who reviewed>"`. Never register a failed report, and never approve without looking at the preview. If you registered it, say so in `--approved-by` and ask the user to confirm.
- Blender is for repair, remeshing, rigging or custom modelling only, and for formats that fail with `NEEDS_BLENDER`. It is not for ordinary glTF/GLB conversion.
- Poly Haven is the only implemented external provider: `npm run assets -- --query "..." --external polyhaven` suggests candidates on misses, and `npm run assets:fetch` downloads one reviewed candidate to the cache. Check `matchedTerms`/`coverage`, warnings and the thumbnail before fetching; a low-coverage hit is usually a different object. Other providers and Blender are **planned integrations**, not currently implemented.

Read `docs/ASSET_PIPELINE.md` for interfaces and quality gates.
