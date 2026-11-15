# Asset review (★B1): converted, awaiting owner approval

Nothing below is registered in the catalog yet. Each asset passed (or failed) the converter's checks: Khronos validation, the Three.js load check, scale against the provider's dimensions, and a 4-view `preview.png`.

**To approve one after looking at its preview:**
```bash
npm run assets:register -- --report <dir>/report.json --approve --approved-by "<your name>" --style <realistic|stylized>
node tools/register-texture.mjs --provider polyhaven --id <id> --resolution 2k --approve --approved-by "<your name>"
```

## Poly Haven (CC0; fetched through the approved adapter)
| Asset | Result | Preview | My recommendation |
|---|---|---|---|
| `clean_asphalt` texture (2k, 2.1 m tile) | fetched | `assets/cache/polyhaven/clean_asphalt/…/2k/` | **Approve:** forecourt asphalt |
| `asphalt_floor` texture (2k, 2.35 m tile) | fetched | `assets/cache/polyhaven/asphalt_floor/…/2k/` | **Approve:** clean concrete for the pump island |
| `WetFloorSign_01` (228 triangles) | passed | `assets/converted/polyhaven/WetFloorSign_01/60ba9bf72787574f/preview.png` | **Approve:** generic "Caution / Wet floor" sign by the shop |
| `concrete_road_barrier` (61k triangles) | passed | `assets/converted/polyhaven/concrete_road_barrier/269477e5ecac3710/preview.png` | Optional: a forecourt-edge barrier, weathered black and white |
| `korean_fire_extinguisher_01` (9.9k triangles) | passed | `assets/converted/polyhaven/korean_fire_extinguisher_01/4b513cba92e05669/preview.png` | **Skip:** a Korean-language label and printed product label would read oddly at a US station |
| `fire_hydrant` (86k triangles) | passed | `assets/converted/polyhaven/fire_hydrant/bf59a137243a36b8/preview.png` | **Skip:** two hydrants in one heavy model, not needed |
| `metal_trash_can` | **failed validation** | `assets/converted/polyhaven/metal_trash_can/7fb5951baf9fedfb/` | Refused: the geometry is 1.78 m wide against Poly Haven's declared 1.85 m (4%, over the 2% limit). It's also a large dumpster-style bin. Not substituted; the station props kit has bins |

## Original (generated, CC0): the nozzle internals
| Asset | Result | Preview | Status |
|---|---|---|---|
| `nozzle-internals` (15 named parts, 9.7k triangles) | passed | `assets/converted/generated/nozzle-internals/d6e143fe8f82cc6d/preview.png` | **Not for approval yet.** It is refitted to the sourced nozzle's measured interior after the Sketchfab download, then reviewed at ★C1 as a labelled section diagram |

## Sketchfab (CC BY 4.0): downloaded 2026-11-14, converted, awaiting approval
- **Authentication:** verified as the owner's free account (`/v3/me` returned 200; the token is never printed and appears in no file).
- **Licences:** every licence was re-checked from the model's own record at download time. All five are `by` (CC BY 4.0, commercial use allowed, credit required).
- **Formats:** each arrived as a single GLB, with no separate licence file.
- **Validation:** all five converted with **zero validation errors**. There are no real-brand flags in any name or tags.

| Asset | Size / scale | Triangles | Preview | My recommendation |
|---|---|---|---|---|
| **Gas Pump Nozzle** (ghostbusterjeffrey) | 5.06 units long: placed at about ×0.063 (a real nozzle is about 0.32 m) | 10.2k, 13 meshes | `assets/converted/sketchfab/5343a980106c41609a4ba34786d8a088/01911b6d93ca2fba/preview.png` | **Approve.** Clean and stylized. **The lever is a separate node** (`Cube_1`), so no repair is needed. The other parts: spout `Cylinder_4` (with a tip ring), bellows `Circle_0`, red body (root mesh), guard `Cube.001_2`, hose swivel `Cylinder.003_9`. The body and spout meshes are closed, so the section cuts cap cleanly |
| **gas pump** dispenser (kunkun) | 1.82 × 2.32 × 0.81 m, real scale | 13.4k, 1 mesh, 5 textures | `assets/converted/sketchfab/add0f902b9164718bd0540e88bf9927e/9e174bab432eb8ad/preview.png` | **Approve the geometry, with a repaint.** The only texture set in the download is covered in stickers and invented branding ("Quality PROclean Gasolines", "OKTD EXPRESS", "CLOSED"); the sticker-free set isn't in it. Adaptation replaces those textures with flat Hold Up materials (red/white panels, dark display). Alternative: the props kit's simpler `Fuel_pump.001` |
| **Gas station Props** kit (Elbolillo) | real metres, 51 separate pieces | 12.6k | `assets/converted/sketchfab/8fcd52f1b12e4b4296589b4c6328b777/f4bdbbb5f92a82ef/preview.png` | **Approve; use selected pieces:** the canopy (`The_ceiling`, 21.7 × 7.6 × 16.7 m), island pumps (`Fuel_pump.001`), bins (`Trash*`), `Dumpster`, `ICE` chest. **Exclude** the shop `6twelve` and its pylon `6twelve_Sign` (a parody of a real convenience-store brand), unless they are fully repainted and renamed. **Exclude** the trees and bush (photo-textured cards with uncertain texture sources). Everything kept is retextured with Poly Haven CC0 |
| **Gas station** full scene (Elbolillo) | 300 × 30 × 101 units, including terrain | 51.9k, **991 meshes** | `assets/converted/sketchfab/eeb913b90b4344ddbd7852f82a7ef160/c4d809541b4697e6/preview.png` | **Don't use.** It's the same station buried in terrain, trees and road. Its 991 meshes would exceed the draw-call budget, and the props kit already gives the pieces cleanly. Not registered; its credit is dropped from `credits.md` if you agree |
| **Generic passenger car pack** (Comrade1280) | real metres (sedan body 4.36 × 1.94 m) | 69.3k for all 10 cars | `assets/converted/sketchfab/20f9af9b8a404d5cb022ac6fe87f21f5/c392acefb1500079/preview.png` | **Approve; extract one car:** the **Sedan** (`Sedan Body`, 4.8k triangles, plus its four wheels). Hatchback is the alternative. Then recolour and add the fuel door |

**After approval (★B2 adaptation):**
1. Extract the chosen pieces (one sedan, the kit pieces) as derived catalog assets. They inherit the licence and credit, and each goes through the converter again.
2. Hold Up material pass: the dispenser repaint and the station retexture.
3. Scale the nozzle.
4. Render one exterior still for ★B2.
