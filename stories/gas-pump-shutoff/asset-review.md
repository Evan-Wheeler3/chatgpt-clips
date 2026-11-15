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

## Sketchfab (CC BY 4.0): waiting for `SKETCHFAB_API_TOKEN`
The nozzle, dispenser, station, station props and car pack from `sourcing-report.md` are fetched and converted as soon as the token is set. Their previews then join this sheet.
