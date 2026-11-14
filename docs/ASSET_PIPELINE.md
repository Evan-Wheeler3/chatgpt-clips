# Asset resolver design

## Priority order
1. Check metadata of existing local assets.
2. Confirm the referenced `localPath` exists.
3. Rank by object/description/tag relevance, approved style, and license policy.
4. Return all usable candidates; don't silently choose a stylistically incompatible item.
5. On miss, query enabled external providers (Poly Haven implemented); verify metadata, thumbnail, download licensing and usage rights.
6. Download into versioned local cache (Poly Haven implemented), scan and inspect; normalize to GLB with consistent scale, orientation, materials (planned).
7. Human or automated quality gate; only then add to shared catalog.
8. Use Blender MCP/batch conversion when specific repair, rigging or custom asset work is necessary.

## Licensing
Poly Haven and ambientCG contain CC0 assets/materials; verify individual source metadata. Poly Pizza, Sketchfab and BlenderKit include mixed licenses and attribution requirements. Never infer a model's license from its hosting site alone. Track the exact source URL and license per model. No hidden artist credits.

## Why local first
A reusable catalog avoids repeat search, inference tokens and geometry authoring. This is the primary cost-reduction lever, not Blender MCP itself.

## CLI
```bash
node tools/asset-resolver.mjs --query "wooden bar counter"
node tools/asset-resolver.mjs --request examples/asset-requests.json --out production/example/asset-resolution.json
node --test
```
When no asset is installed, expect `not_found`. No remote models are downloaded by the resolver itself.

## Poly Haven adapter (`tools/providers/polyhaven.mjs`)
- **Search:** `--external polyhaven` adds `externalCandidates` to `not_found` results only; the status stays `not_found`. Matching is local and deterministic over the `/assets?type=models` index (name 4, tags/categories 3, description 1, simple plural folding). A candidate needs a name/tag hit on a query word; request tags only boost. Each candidate reports `matchedTerms` and `coverage` (fraction of query words matched) so partial matches are obvious. The API's `/search` endpoint was evaluated and not used: its semantic ranking returned unrelated models for concrete prop queries.
- **Exclusions:** non-models, assets in locked vaults (`/vaults` status other than `unlocked`), and assets with a future `date_published`.
- **Warnings:** `tmwarn` assets carry a trademark warning (CC0 does not clear trademarks); a requested style other than `realistic` carries a style-review warning.
- **License evidence:** the API has no per-asset license field. Candidates record `license: CC0-1.0` with `licenseEvidence: https://polyhaven.com/license`, Poly Haven's site-wide statement that all of its assets are CC0.
- **API terms** ([ToS](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)): every request sends the `hold-up-animation-v2/<version>` User-Agent. Output that surfaces Poly Haven results includes `providerCredits: ["Powered by Poly Haven (https://polyhaven.com)"]`. The model index is cached for 12 hours at `assets/cache/polyhaven/models-index.json`.
- **Download:** `npm run assets:fetch -- --provider polyhaven --id <id> [--resolution 1k]` fetches the glTF bundle (`.gltf` + `.bin` + textures) sequentially, only from `https://dl.polyhaven.org`. It rejects unsafe relative paths and bundles over 200 MB, and verifies each file's size and MD5 against the API. It writes to `assets/cache/polyhaven/<id>/<files_hash>/<resolution>/`, adding a `provenance.json` with source, creator, license evidence, API terms/credit, warnings and per-file SHA-256. Failed downloads leave nothing in place. A repeat fetch of the same version returns `cached`.
- **Not done:** Poly Haven serves glTF, not GLB, and the catalog accepts only GLB. A fetched model is therefore not resolvable until Phase 3 converts and inspects it and a reviewed catalog entry is added. Fetching never edits `assets/catalog.json`.

## Catalog entry
```json
{
  "id":"bar-counter-001",
  "name":"Western wooden bar counter",
  "description":"1870s wooden bar with brass foot rail",
  "tags":["saloon","bar","western","interior"],
  "style":"stylized",
  "localPath":"assets/library/bar-counter-001.glb",
  "sourceUrl":"https://example.org/real-model-page",
  "license":"CC0-1.0",
  "creator":"Original artist"
}
```
Replace placeholder source metadata with a real verified origin before accepting an entry. Missing local file means it will not be resolved.

## Next engineering tasks
- Further provider adapters following the Poly Haven contract: `search(request) -> candidates` and an explicit `fetchModel(id) -> {status, dir, provenance}`.
- License allowlist and attribution generator.
- Hash-based cache, file size/polygon budgets and MIME validation.
- Blender headless converter for OBJ/FBX/BLEND to optimized GLB.
- GLB structural verifier and thumbnail/contact-sheet generator.
- TypeScript scene loader and catalog search integrated with Remotion storyboard.
