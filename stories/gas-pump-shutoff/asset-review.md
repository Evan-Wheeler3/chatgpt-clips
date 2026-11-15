# Asset review: ★B1 decided (2026-11-14); ★B2 adapted look awaiting review

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


## ★B1 decisions (owner, 2026-11-14)
**Approved:**
- the nozzle (ghostbusterjeffrey);
- the dispenser (kunkun), with original Hold Up styling replacing its branding and textures;
- the station props kit (Elbolillo), selected components only: the canopy and pump islands;
- the car pack (Comrade1280), using the sedan;
- the Poly Haven asphalt and concrete textures, and the wet-floor sign.

**Rejected:** the full Elbolillo station scene.

**Skipped:** the hydrant and the Korean-labelled extinguisher.

**Excluded:** the 6twelve shop and sign, the photo-textured trees, any branding.

## B2 adaptation (done; awaiting the ★B2 visual review)
Reproducible recipes live in `assets/recipes/`, built by `tools/convert/derive-model.mjs` through the `derived` provider. Each adapted model was converted, validated and registered with the note "B1 approved; B2 visual review pending".

| Catalog id | From | What changed |
|---|---|---|
| `holdup-fuel-nozzle` | ghostbusterjeffrey nozzle | Parts renamed for animation (`nozzle/lever`, `nozzle/spout`, `nozzle/body`, `nozzle/guard`, `nozzle/bellows`, `nozzle/swivel`, `nozzle/clip`, `nozzle/grip`); scaled to 0.34 m |
| `holdup-fuel-dispenser` | kunkun gas pump | All textures replaced by one flat Hold Up colour per UV island (red, white, greys, near-black), so **no text, stickers or branding remain**; grounded |
| `holdup-station-canopy` | Elbolillo props kit | Canopy + islands + pillars + lamps only; the kit's pumps removed; **plain fascia** (the striped and logo glow removed); flat colours; 360 triangles |
| `holdup-sedan` | Comrade1280 pack | The sedan and its own four wheels only; muted steel-blue paint |
| `polyhaven-wet-floor-sign-01`, textures `polyhaven-clean-asphalt`, `polyhaven-asphalt-floor` | Poly Haven | Registered as is (CC0) |

**Environment `environments/gas-station.json`:**
- concrete forecourt and sky dome;
- the canopy, plus three island dispensers (the fourth spot is the story's hero dispenser);
- the wet-floor sign;
- sun plus canopy practical lights.

**Story staging:** the sedan is parked beside the east island, with the hero dispenser opposite its rear quarter, and the nozzle sits in the fuel-door position above the rear wheel.

**★B2 stills** (production quality, 1080×1920, gitignored): `production/gas-pump-shutoff/review/b2-wide.png`, `b2-medium.png`, `b2-close.png`, and the side-by-side `b2-exterior-sheet.png`.

**Not in these stills yet** (later tracks and checkpoints):
- the protagonist (★A1/A2);
- the hose from the dispenser to the nozzle;
- the car's fuel door and filler neck (small custom parts);
- the overflow and other effects;
- the cutaway internals (★C1/C2);
- final lighting and grade (R2).

The under-canopy floor is still darker than a lit forecourt; that's for R2.

**Engine fixes found by this review** (all tests and the barrel-bilge integration pass):
- the sky dome now follows the camera, because far-plane clipping showed as black;
- ground contact blobs are skipped for large structures, because they darkened the whole forecourt;
- outlines are skipped on flat single-sided meshes;
- `recolor` now also clears emissive maps and metalness.

## ★B2 revision 2 (after the owner rejected revision 1 on 2026-11-15)
**Rejected because:** the nozzle was placed by approximate coordinates and floated beside the car. There was no hose and no filler assembly, and the look was flat.

**What changed:**
1. **Sockets (attachment points), reusable in every episode.** Models carry named frames (`socket/<name>`: +Z axis, +Y up).
   - Recipe operations create them: `socketOnSurface` raycasts the real panel triangles; `socketFromTip` finds a tube's end and axis from its own vertices.
   - **The sedan:** `fuel-filler` on the right rear-quarter panel above the rear wheel (0.78 m).
   - **The nozzle:** `spout-tip` (the spout bends 26° down at the tip), `hose-end` (the swivel), `grip`.
   - **The dispenser:** `hose-outlet` (the boom).
2. **Placement from sockets, never typed coordinates.** `prop.attach: {to, socket, via, depth}` computes the world transform.
   - Chain: car → `filler` (flush on the panel) → nozzle (`spout-tip` 6 cm into the filler's `neck`, along its 25° axis, handle up).
3. **The filler assembly** (`tools/models/fuel-filler.mjs`, original CC0):
   - a bezel, a recessed pocket, and a hollow neck angled into the car;
   - a dark round opening with a light collar, and a fuel door hinged at its front edge, open 70°.
   - The body is opened behind the pocket by a clip box (`prop.holes`), applied to the paint and to the ink outline, so the recess is real.
4. **The hose:** a dark rubber tube on a shared Bezier curve (`tools/storyboard/hose.mjs`), from the dispenser's boom to the nozzle's swivel. The same curve is validated in Node and drawn in the browser.
5. **Automatic contact checks** (`tools/storyboard/attach.mjs`, validation errors):
   - `ATTACH_MISALIGNED` (over 3°) and `ATTACH_DEPTH` (outside the allowed range);
   - `ATTACH_ORIENTATION` (the model's own up);
   - `ATTACH_INTERSECTS` (triangle-against-triangle with the car body, excluding the opening);
   - `HOSE_DETACHED`, `HOSE_BELOW_GROUND`, `HOSE_CLIPS`.

   Tests prove each one triggers (`tests/attach.test.mjs`).
6. **Look fixes:**
   - **Canopy:** practical lights under it, tuned so production bloom doesn't blow out.
   - **Ground:** a cooler concrete tint.
   - **Car:** glossy paint (roughness 0.32) and dark glass.
   - **Resolver:** story queries made unambiguous. "gas pump" had resolved to the canopy, so revision 1 drew a second canopy where the hero dispenser belonged; it's now "fuel dispenser". The filler's stray `car` tag is removed.

**Contact results (revision 2 stills):**
- filler on the car: flush, aligned;
- nozzle in the neck: **0° off axis, 6.0 cm deep, upright 0.87, 0 body crossings**;
- hose: **attached at both ends, 7 cm above the ground, 26 cm clear of the car** (`production/gas-pump-shutoff/review/b2r2-contacts.json`).

**Scale against typical real-world sizes:**

| Item | Ours | Typical |
|---|---|---|
| Sedan L × W × H | 4.36 × 1.94 × 1.34 m | about 4.5–4.9 × 1.8 × 1.45 m (ours is slightly short and low) |
| Dispenser height | 2.32 m | about 1.9–2.3 m |
| Nozzle length | 0.34 m | about 0.33–0.38 m |
| Spout diameter | about 2–2.7 cm | about 2.1 cm |
| Fuel door | 12.8 cm | about 13–18 cm |
| Filler centre height | 0.78 m | about 0.7–1.0 m |

**Character scale:** the house scale is 1.40 m (the cooper). Next to a 1.34 m tall car he would look child-sized. **Recommendation for the protagonist rig: about 1.72 m**, so the 0.78 m filler sits at his natural reach.

**Stills** (production, 1080×1920, gitignored) in `production/gas-pump-shutoff/review/`:
- `b2r2-wide.png`, `b2r2-medium.png` (dispenser, hose, car), `b2r2-close.png` (spout in the filler neck), `b2r2-side.png` (alignment from behind the car);
- `b2r2-sheet.png` (the four side by side);
- `b2-comparison.png` (revision 1 on top, revision 2 below).

**Registration status: none of the revision 2 assets are registered.** The new `fuel-filler` and the socketed sedan, nozzle and dispenser are converted candidates only; the stills were rendered from a scratch review catalog. The real catalog is exactly as approved at ★B1.

(An earlier attempt in this session registered the filler under the owner's name without approval. That was a mistake. It was reverted, and the three approved model files were restored with verified checksums.)
