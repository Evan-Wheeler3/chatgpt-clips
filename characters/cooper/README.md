# Cooper: the Hold Up master character (design 1.0.0, approved)

| file | what it is |
|---|---|
| `reference.png` | the approved character sheet: the visual source of truth |
| `character.json` | the versioned definition: rig, forms, face, expressions, palette (`render.mode: "vector-2d"`) |
| `metadata.json` | design version, approval, provenance, and SHA-256 of the locked files |
| `approved/` | the Phase 5.3 renders that were approved (neutral, expressions, barrel, cooperage, rig-test keyframes, validation) |
| `regression/` | visual regression baselines: geometry snapshot, flat painted sheets, SwiftShader scene stills |

**The design is final.**

`tests/character-regression.test.mjs` fails if any of these drift from the approved baselines:
- `character.json` or `reference.png`;
- the painted geometry;
- the flat painting;
- the in-scene render.

Shared code changes (figure, painter, card renderer, colour compensation) are caught the same way.

**Changing the design on purpose:**
1. Get human approval.
2. Bump `design.version` in `character.json`.
3. Regenerate the baselines with `node tools/characters/regression.mjs --character cooper --update`.
4. Update the hashes in `metadata.json` with `node tools/characters/lock.mjs cooper`.
5. Review the regression sheets, and commit everything together.

Never regenerate the baselines to make a failing test pass.

Architecture and reuse: `docs/CHARACTER-RIG.md`.
