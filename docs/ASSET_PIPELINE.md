# Asset resolver design

## Priority order
1. Check metadata of existing local assets.
2. Confirm the referenced `localPath` exists.
3. Rank by object/description/tag relevance, approved style, and license policy.
4. Return all usable candidates; don't silently choose a stylistically incompatible item.
5. On miss, query enabled external providers (planned); verify metadata, thumbnail, download licensing and usage rights.
6. Download into content-addressed local cache (planned), scan and inspect; normalize to GLB with consistent scale, orientation, materials (planned).
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
When no asset is installed, expect `not_found`. No remote models are downloaded by this first implementation.

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
- Provider adapter contract; Poly Haven API integration with pagination and throttling.
- License allowlist and attribution generator.
- Hash-based cache, file size/polygon budgets and MIME validation.
- Blender headless converter for OBJ/FBX/BLEND to optimized GLB.
- GLB structural verifier and thumbnail/contact-sheet generator.
- TypeScript scene loader and catalog search integrated with Remotion storyboard.
