# Asset requirements

Resolver result (`episode-check`): **all 5 story props are missing** from `assets/catalog.json`. They are recorded as `MISSING_ASSET` errors, and nothing was substituted. Nothing has been downloaded in this phase.

**Classification key:**
- **A**: available locally and verified;
- **M**: modify existing work;
- **X**: verified external (needs an approved adapter + human approval before download);
- **C**: custom modeling or code;
- **H**: needs human artwork approval.

| Need | Shots | Class | Plan | Notes |
|---|---|---|---|---|
| Protagonist "driver" | 1, 2, 10 | **H** | Intake `characters/intake/gas-pump-shutoff-protagonist/` (awaiting artwork) | See `characters.md`. The cooper is not reused |
| Nozzle exterior + cutaway (one model) | all | **C** | Blender hero model or parametric Three.js (see `mechanism-plan.md`) | The most important asset. Generic and unbranded |
| Spout tip + filler pipe cutaway | 3, 5, 6 | **C** | Simple lathe geometry | Shares the spout with the nozzle |
| Car (rear quarter, fuel door, filler neck) | 1, 2, 10 | **C** (or **X**) | Model only what's seen: the rear quarter panel, wheel arch, fuel door and neck. The wide outro (shot 10) needs a full silhouette, so either a simple stylized full car (C) or a vetted CC0 low-poly car (X) | No car in the catalog. Search-result titles are not licence evidence |
| Fuel dispenser (pump) | 1, 10 | **C** (or **X**) | A stylized box dispenser with a hose and nozzle holster, no screen text or logos | Background-soft in shot 1, readable in shot 10 |
| Gas station environment | 1, 2, 10 | **M** | A new `environments/gas-station.json`. The environment compiler needs **new outdoor types**: an open ground with no walls, a canopy (roof slab on columns), a pump island (curb) | Today's compiler only builds interior rooms (floor, walls, plinth, piers, trusses, rack) |
| Asphalt / concrete textures | 1, 2, 10 | **X** | Poly Haven CC0 textures via the existing approved Poly Haven adapter | The CC0 licence is verified per asset at import (polyhaven.com/license). The current texture catalog has none suitable |
| Outdoor HDRI / sky | 1, 10 | **X** or **C** | A Poly Haven CC0 HDRI, or the existing gradient sky (`stage.background`) | The gradient sky is enough for the stylized look; the HDRI is optional |
| Station dressing (bin, bollards, wet-floor sign) | 10 | **X** / optional | Poly Haven CC0 props | Not required. Skip if time is short |
| Fluid effects (spill, streaks, level, air) | 1–9 | **C** | Shader + animated meshes + sprite particles (code, not assets) | No fluid simulation |
| Highlight ring, x-ray material, shake | 3, 9 | **C** | Code | |
| SFX + ambience | all | **C** / **X** | See `sound-captions.md` | 8 effects + 1 ambience profile are missing |

**Reused as-is (A):**
- the hold-up caption style;
- the narrator profile;
- the audio scheduler and mixer;
- the vector character rig and approval gates;
- the storyboard compiler and validator.

**Readiness:** 0 of 5 props available, 1 character awaiting artwork, 0 of 9 sounds available. **Production cannot start until the nozzle model and the protagonist exist.**
