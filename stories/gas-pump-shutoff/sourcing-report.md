# Asset sourcing report: gas-pump-shutoff

- **Date:** 2026-11-14.
- **Scope:** every 3D asset the episode needs, sourced **asset-first** following the Phase 2–3 pipeline (`docs/ASSET_PIPELINE.md`).
- **Nothing has been downloaded.** Only public metadata and preview thumbnails were read. Licences are taken from each model's own page or API record, never from a site's reputation or a search-result title.

## Method
1. **Local catalog** (`node tools/asset-resolver.mjs`): `not_found` for gas pump, fuel dispenser, fuel nozzle, car, vehicle, gas station and canopy. The catalog holds 7 Poly Haven props, all 19th-century wood.
2. **Approved adapter** (`--external polyhaven`, the only adapter built):
   - **Found:** station dressing and textures (below).
   - **Not found:** a pump, nozzle, station or usable car. `covered_car` is a car under a tarp, so it can't be used.
3. **Other free providers** (no adapter yet; searched by hand):
   - **Sketchfab public search API**, filtered to `downloadable` plus `cc0` or `by`. Each shortlisted model's record was opened (`/v3/models/<uid>`) for its licence URL, author, triangle count, publish date and description, and its thumbnail was reviewed visually.
   - **Poly Pizza:** model pages opened for the licence and formats.
   - **Kenney, Quaternius, itch.io:** pack pages opened.
4. **Evaluation:** era and style fit (a modern 2026 station; Hold Up's look is a stylized 3D world with clean PBR materials, e.g. barrel-bilge's Poly Haven props), geometry budget, trademarks, licence, and the adaptation needed.

**Licence policy:**
- Allowed: CC0-1.0, and CC-BY-4.0 / CC-BY-3.0 with attribution (the same allow-list as audio).
- CC-BY assets need a credit line in the video description, recorded in the catalog.
- Branded models (Shell, Wawa, Texaco, Exxon, RaceTrac, Petron) are **excluded**: CC licences don't clear trademarks.

## Owner decisions (Phase 7A review)
1. **Station:** prefer the realistic Elbolillo station, provided its commercial-use licence is verified and it matches our visual quality.
   - **Licence: verified.** The Sketchfab API record gives `license.slug: by` and creativecommons.org/licenses/by/4.0. CC BY 4.0 permits commercial use with attribution.
   - **Quality** (reviewed on the 1920 px preview):
     - The geometry is clean and modern (canopy, island dispensers, shop, price pylon) and good for the wide and background shots.
     - The textures are low-res (PSX style), so the canopy, columns, ground and shop are **re-textured with Poly Haven CC0 materials** to match barrel-bilge.
     - **Required changes:** remove the photo-card trees (their textures may come from pexels/textures.com) and repaint the pylon and fascia. The pylon lists "Magna / Premium / Diesel"; "Magna" is a real fuel grade name, and the "6" logo is fictional but replaced anyway.
     - Final acceptance is at the converter preview.
2. **CC-BY is acceptable for the vehicle (and the other models).** The exact requirements and a draft YouTube description are in `credits.md`.
3. **Adapter:** build the Sketchfab adapter only if existing free providers can't supply the assets.
   - **Finding: they can't.**
     - Poly Haven has no nozzle, dispenser, station or usable car.
     - The nozzle and dispenser exist only on Sketchfab.
     - Token-free routes exist only for the station (the itch.io CC0 FBX, which needs the unbuilt Blender converter) and the cars (Poly Pizza CC0 glTF).
   - So the Sketchfab adapter is necessary. Sketchfab downloads need a free account's API token.
   - **Status:** the owner approved the adapter, and it is **built and tested** (`tools/providers/sketchfab.mjs`; see `docs/ASSET_PIPELINE.md`). A live search found every recommended model, each with its licence re-verified as CC-BY-4.0. **No model has been downloaded:** that needs the owner's token and happens in Phase 7B.

## Recommendations
| Need | Recommended model | Licence (verified) | Why | Adaptation |
|---|---|---|---|---|
| **Nozzle exterior** (hero) | **"Gas Pump Nozzle"** by ghostbusterjeffrey: https://sketchfab.com/3d-models/gas-pump-nozzle-5343a980106c41609a4ba34786d8a088 | CC-BY-4.0 (record's licence URL: creativecommons.org/licenses/by/4.0) | A clean, stylized modern automatic nozzle: spout, boot, lever, guard, hose ferrule. 10.2k triangles. The closest match to Hold Up's look of any candidate. Made "for an upcoming animation" | Medium. Material override to the Hold Up palette; check the lever is a separate node (split it if not); add the sensing-hole detail; a section cut via Three.js clipping planes with capped faces; the custom mechanism fitted inside |
| **Fuel dispenser** | **"gas pump"** by kunkun (youoyouyou): https://sketchfab.com/3d-models/gas-pump-add0f902b9164718bd0540e88bf9927e | CC-BY-4.0 | A modern self-service dispenser with a display, hoses and holstered nozzles. 13.4k triangles, PBR, Blender-made. The author offers a no-stickers texture set | Low–medium. Use the clean texture set, or override the header and sticker materials (it shows "Quality PROclean Gasoline" text); recolour to the station palette; verify scale |
| **Station** (canopy, island, shop, sign) | **"Gas station"** by Elbolillo (Elbolilloduro): https://sketchfab.com/3d-models/gas-station-eeb913b90b4344ddbd7852f82a7ef160, with its **"Gas station Props"** kit: https://sketchfab.com/3d-models/gas-station-props-8fcd52f1b12e4b4296589b4c6328b777 | CC-BY-4.0 on Sketchfab. The same author's itch.io release (https://elbolilloduro.itch.io/gas-station) states **CC0**, FBX only | A modern canopy station with dispensers, an island, a shop, a price sign and props. 52k + 12.7k triangles. 937 and 910 likes, the most-liked station on Sketchfab | Medium. The PSX-style textures are low resolution: fine as background (shots 1 and 13 are soft or wide), but the ground gets Poly Haven `clean_asphalt` / `asphalt_floor`. Replace the price-sign logo (a fictional "6" with a striped fascia: generic, but repaint it to avoid any convenience-store look-alike). Use the props kit for the island and dispensers if we drop the separate pump |
| **Car** | **"Generic passenger car pack"** by Comrade1280: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5 | CC-BY-4.0 | A hatchback, sedan, wagon, compact and coupe at about 6–7k triangles each; the author states they resemble no real cars ("trademark claim proof"). Reviewed visually: clean, generic, modern-ish | Low–medium. Take the hatchback or sedan; recolour; add a **fuel door + filler neck** (small custom part) where the camera sees it |
| Car (CC0 alternative) | Quaternius "Car" (sedan): https://poly.pizza/m/unqqkULtRU and https://poly.pizza/m/Cz6yDaUcM9; Kay Lousberg "Car Hatchback": https://poly.pizza/m/BG0KAhmGDt | **CC0** (Poly Pizza pages: "Public Domain (CC0)"), glTF | CC0 is preferable on licence. **Not reviewed visually yet**: Poly Pizza's preview images weren't retrievable from the pages. Likely more toy-like | Decide after a converter preview (`preview.png`) side by side with the Comrade1280 car |

**Station dressing (CC0, available now through the approved Poly Haven adapter):**
- `metal_trash_can`;
- `concrete_road_barrier` / `concrete_road_barrier_02`;
- `korean_fire_extinguisher_01`;
- `WetFloorSign_01`;
- `fire_hydrant`;
- `metal_jerrycan`.

**Ground textures** (Poly Haven CC0): `clean_asphalt`, `asphalt_floor` (clean concrete), `asphalt_01`.

**Sky:** the existing gradient-sky stage, or one of 705 outdoor Poly Haven HDRIs (optional).

## Other candidates evaluated (not recommended)
| Model | Licence | Reason not chosen |
|---|---|---|
| "Vintage Gas Pump Nozzle" by Vishal Pandey (sketchfab …45259204) | CC-BY-4.0 | Rusted vintage look; a 2k-triangle low-poly game prop. A fallback if the recommended nozzle fails conversion |
| "Old Rusty Gaspump Nozzle" by Mark Peters (…f8336313) | CC-BY-4.0 | Modern shape but heavily rusted; the author warns of flipped normals |
| "Gas Pump Nozzle" by Gabriel Quintana (…404653c9) | Sketchfab Standard, **not downloadable** | Not free |
| "Gas & Fuel Station" by Meet_Savani (…e99f2da3) | CC-BY-4.0 | Clean cartoon style and 13k triangles, but a retro diner look with "GAS"/"FUEL" signs. Our alternative if the owner prefers a flatter cartoon world |
| "Game-ready Extra low poly Gas Station" by Amirchyk (…3e7afaea) | CC-BY-4.0 | Fictional "Knocking Brothers" branding plastered over it, a neon look, and published 2026-10-29 (too new to have any usage history) |
| "Old Gas Station" by CGMeller (…e1d06721), "Gas Station Noir" by natcrab (…cdf84d86) | CC-BY-4.0 | Derelict/desert period look, not a modern station. Noir has no UVs |
| "Gasoline pump" by Artem Goyko, "Vintage Gas Pump" by rescue3d, "Gas Station Stand" by Parham Mazloumin, "3 fuel dispensers" by Bansheeva, "Gas Pump" by xrooshka, "Weathered Fuelpump" by Mark Peters | CC-BY-4.0 | Vintage or derelict. Goyko's carries Texaco theming (a trademark) |
| "Shell Self-Service Gas Pump", "Wawa Gas pump", "RaceTrac Gas Station", "Petron Gas Station", "Exxon/Shell price signs" | CC-BY-4.0 | **Real brands**: excluded |
| "Gas Station" by Alex Safayan (Poly Pizza 7rUkCX-AIR2) | CC-BY-3.0, glTF | A 2018 Google-Poly-era scene; very low detail for our close shots. Not reviewed visually |
| Kenney Car Kit / City Kits | CC0 | The kits contain no station or pump. The cars are toy-like and kart-styled |
| Quaternius Cars Pack | CC0 | FBX/OBJ/Blend only (needs the unbuilt Blender path); covered by the Poly Pizza glTF versions above |
| Unity Asset Store "Low Poly Fuel station" | Unity EULA (not CC) | Outside our licence allow-list |

## What we build (justified)
Only what can't reasonably be sourced:

| Custom element | Why it can't be sourced | Size of work |
|---|---|---|
| **Nozzle internal mechanism**: main valve poppet + spring, venturi throat + suction port, sensing tube, diaphragm chamber + diaphragm, latch pin, latch balls, plunger, lever pivot | No free model shows the mechanism. It must be technically correct (`research.md`) and animate part by part | Medium. Simple lathe and primitive parts in Three.js, sized to fit inside the sourced nozzle's measured interior |
| **Sensing hole** on the spout | A detail no model has | Small: a ring and a hole decal on the sourced spout |
| **Filler-neck cutaway** (pipe, rising fuel surface) | Must be cut away and show a rising fuel level | Small: lathe geometry |
| **Fuel door + filler neck on the car** | Generic cars have none modelled | Small: a recessed disc, an open door and a short pipe placed on the car's flank |
| **Fluid and air effects, x-ray/cut materials, highlight ring, shake** | Effects, not assets | Code (see `mechanism-plan.md`) |

**Blender:**
- Installed (3.1.0), but **not required** by this plan.
- Every recommended model has a glTF download, so it converts with the existing gltf-transform path.
- Blender stays optional, for repair only: for example, splitting the lever out of the nozzle mesh if it's fused, or the FBX-only CC0 itch.io station if the owner prefers CC0 over CC-BY.

## Pipeline work needed before fetching
1. **A Sketchfab provider adapter.** Four of the five recommendations come from Sketchfab. It follows the Poly Haven source contract:
   - search through the public API;
   - a licence allow-list on the record's `license.slug` (`cc0`, `by`);
   - provenance including the author and the licence URL.
   - **Downloads need the owner's own Sketchfab API token** (a free account). Sketchfab's download API returns a glTF archive; the adapter adds safe zip extraction (path checks, size caps) and records the archive hash.
   - Sketchfab's API terms need a read before this is built (not done yet).
2. **Optional: a Poly Pizza adapter** for the CC0 cars. Its API needs a free key.
3. Then the existing path, per model:
   - `assets:convert` (Khronos validation, Three.js load check, `preview.png`);
   - **owner review**;
   - `assets:register --approve --approved-by "<name>"`.
   - Every catalog entry carries the source URL, licence, licence evidence, creator and a CC-BY credit line.

**Attribution block for the video description** (if all CC-BY recommendations are approved):
- "Gas Pump Nozzle" by ghostbusterjeffrey;
- "gas pump" by kunkun;
- "Gas station" and "Gas station Props" by Elbolillo;
- "Generic passenger car pack" by Comrade1280.

All are on Sketchfab, licensed CC BY 4.0 (creativecommons.org/licenses/by/4.0), and modified (materials, scale and cuts).

## Open risks
- **Not verified until download:**
  - whether the nozzle's lever is a separate mesh;
  - whether the shell is closed (needed for clean cut caps);
  - the real-world scale;
  - the dispenser's no-sticker textures being in the Sketchfab archive.

  All of this is checked by `assets:convert` and the review preview; any failure moves to the next candidate listed above.
- **Station texture provenance.** The itch.io page says some of the station's textures came from pexels.com and textures.com. The author licenses the model CC-BY / CC0, but we re-texture all visible surfaces with Poly Haven CC0 materials anyway, for consistency, which also removes this question.
- **Style coherence.** The candidates come from different authors. A shared material pass in Three.js (palette, roughness and outline treatment from `style.json`) is part of the adaptation estimate.
