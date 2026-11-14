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
- **Download:** `npm run assets:fetch -- --provider polyhaven --id <id> [--resolution 1k]` fetches the glTF bundle (`.gltf` + `.bin` + textures) sequentially. It rejects unsafe relative paths and bundles over 200 MB. Each file is streamed to disk while its MD5 and SHA-256 are computed; the stream aborts as soon as it exceeds the API's declared size, and the final size and MD5 must match the API. Output goes to `assets/cache/polyhaven/<id>/<files_hash>/<resolution>/` with a `provenance.json` holding source, creator, license evidence, API terms/credit, warnings and per-file size/MD5/SHA-256. Failed downloads leave nothing in place.
- **Redirects:** followed by hand (max 5 hops). Every hop must be HTTPS on an approved host (`api.polyhaven.com` for API calls, `dl.polyhaven.org` for files). A response whose final URL is off-host is rejected too.
- **Cache revalidation:** a repeat fetch of the same version re-hashes every cached file against `provenance.json`, and checks the record against the API's current file list. It returns `cached` only if everything matches. Otherwise it downloads a verified fresh copy, replaces the bad one, and reports the problem in `repaired`.
- Poly Haven serves glTF, not GLB. Fetching never edits `assets/catalog.json`; a fetched model becomes resolvable only after conversion, review and registration (below).
- `conversionSource(id)` fetches/revalidates the model and returns it in the provider-agnostic source contract. Poly Haven reports dimensions as Blender Z-up millimetres `[x, depth, height]`; they are mapped to glTF Y-up metres `[x, height, depth]` as the expected size (verified exactly on `painted_wooden_stool`).

## Conversion and registration (Phase 3)

### Requirements
- Node.js 20+ and `npm install` (exact-pinned: `@gltf-transform/*` 4.5.1, `gltf-validator` 2.0.0-dev.3.10, `three` 0.186.1, `puppeteer-core` 25.16.0).
- Google Chrome or Chromium for the Three.js load check and previews. Found automatically on macOS/Linux standard paths, or set `CHROME_PATH`. `puppeteer-core` drives it with a throwaway profile and SwiftShader WebGL, never the user's profile, and downloads no browser.
- Blender is **not** required. Ordinary glTF/GLB conversion is deterministic gltf-transform. Formats that need Blender (`.fbx`, `.obj`, `.blend`, `.dae`, `.usd*`, ...) fail with `NEEDS_BLENDER`; that path is not implemented yet.

### Commands
```bash
npm run assets:convert -- --provider polyhaven --id painted_wooden_stool [--resolution 1k] [--quantize] [--force] [--no-preview]
# review assets/converted/polyhaven/<id>/<key>/preview.png and report.json, then:
npm run assets:register -- --report assets/converted/polyhaven/<id>/<key>/report.json --approve --approved-by "<reviewer>" [--id <catalog-id>] [--style realistic] [--tag extra] [--replace]
npm run test:integration   # real painted_wooden_stool run: live API or verified cache, Chrome required
```

### Source contract (`tools/convert/pipeline.mjs`)
Any provider can feed the converter by returning:
`{provider, id, version, resolution?, dir, entry, files:[{path, size, sha256}], attribution:{name, sourceUrl, license, licenseEvidence, creator, credit?}, metadata:{name, description, tags, category, style, warnings}, expected:{extentsM:[x,y,z]} | null}`.
Before converting, the converter re-hashes every listed file. Each buffer/image URI in a `.gltf` must be a safe relative path to a listed file; remote, absolute, `..` and unlisted references are rejected. Converters are chosen by entry extension (`.gltf`/`.glb` → gltf-transform), so a new format or Blender path is one more registry entry.

### Conversion
- `dedup`, `prune` (solid-colour textures kept), `weld` and `unpartition`, written as a single-buffer GLB. All of these only remove exact duplicates or unused data. Textures are embedded byte-for-byte; there's no recompression, resizing or Draco/meshopt, so quality and decoder requirements are unchanged.
- `--quantize` adds `KHR_mesh_quantization` (supported natively by Three.js). On `painted_wooden_stool` it saved 0.4%, so it is off by default.
- Source credit is embedded in the GLB: `asset.copyright` plus `asset.extras.holdUp` (provider, id, version, source URL, license, license evidence, creator).
- Output: `assets/converted/<provider>/<id>/<key>/{model.glb, preview.png, report.json}` (gitignored). `key` hashes the converter version, pinned tool versions, options, expected size and every source file's SHA-256. A repeat run returns `cached` only if the report passed, the GLB still matches its SHA-256 and the preview exists. Failed results are always retried. Output is deterministic (identical GLB SHA-256 across runs).

### Validation (`report.json` → `validation`)
Errors fail the conversion; warnings are kept for review.
- **Errors:**
  - any Khronos glTF validator error, or the GLB not being exactly one embedded buffer
  - no mesh, missing POSITION, non-finite positions, or a normal map without UVs
  - a texture without embedded bytes, a MIME type other than JPEG/PNG/WebP/KTX2, or magic bytes that don't match the MIME type
  - a largest extent outside 5 mm–500 m
  - size more than 2% off the provider dimensions, or axes in a different order from them (orientation)
  - any Three.js load failure in Chrome: console error, failed request, a texture with zero size, no meshes, or a WebGL error
- **Warnings:**
  - Khronos validator warnings, listed by code
  - missing normals
  - base more than max(1 cm, 2% of height) from y=0, or more than 10% off-centre
  - more than 100k triangles, a texture over 2048 px, or a GLB over 25 MB
  - unused textures
  - no provider dimensions to cross-check against
- The `threejs` block records the Three.js revision, the WebGL renderer, meshes, triangles, each material texture slot with its loaded size and colour space, and the draw calls.
- `preview.png` is a 2×2 contact sheet (three-quarter, front, side, top) with a 10 cm grid as a scale reference.

### Registration
`assets:register` refuses without `--approve` and `--approved-by`, a `passed` report, an existing preview and a GLB matching its recorded SHA-256. It copies the GLB to `assets/library/<id>.glb` (gitignored), re-verifies the hash, and writes a sorted catalog entry with source, license and license evidence, creator, provider version, SHA-256, dimensions, triangles, conversion key and review record. Re-registering the same GLB is `unchanged`; a different GLB under the same id needs `--replace`.

Because `assets/library/` is not in git, a fresh clone has catalog entries without files; the resolver correctly reports `not_found` until `assets:convert` + `assets:register` are rerun. The conversion key and SHA-256 in the entry identify the exact expected output.

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
- Blender headless converter for OBJ/FBX/BLEND to optimized GLB (the `NEEDS_BLENDER` path).
- Optional texture downscaling/WebP for budget-constrained scenes, with before/after preview comparison.
- A restore command that rebuilds `assets/library/` from catalog entries on a fresh clone.
- TypeScript scene loader and catalog search integrated with Remotion storyboard.
