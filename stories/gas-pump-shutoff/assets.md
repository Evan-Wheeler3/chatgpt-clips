# Asset requirements (asset-first; see `sourcing-report.md`)

- **Local catalog:** all 5 story props are `MISSING_ASSET` (recorded, nothing substituted).
- **Missing locally is not the same as unavailable.** Real, licence-verified candidates exist online for every ordinary object. Custom work is limited to what no free model can show: the nozzle's internal mechanism and a few small details.
- **Nothing has been downloaded.**

**Classification key:**
- **A:** available locally.
- **P:** available through the approved Poly Haven adapter (CC0).
- **S:** a sourced external candidate. The licence is verified on its page; it needs the Sketchfab or Poly Pizza adapter, then convert, owner review and register.
- **C:** custom, only where sourcing can't work.
- **H:** human artwork approval.

| Need | Shots | Class | Plan |
|---|---|---|---|
| Recurring protagonist | 1–3, 9 | **H** | Intake `characters/intake/hold-up-protagonist/` (ChatGPT image brief; awaiting artwork) |
| Nozzle exterior | 1–4, 9, 10 | **S** | ghostbusterjeffrey "Gas Pump Nozzle" (CC-BY-4.0), restyled; a section cut in Three.js |
| Nozzle internal mechanism | 5–8 | **C** | Custom parts fitted inside the sourced shell (`mechanism-plan.md`) |
| Sensing hole, filler-neck cutaway, car fuel door | 4–6, 10 | **C** (small) | Simple custom details |
| Fuel dispenser | 1, 9 (background) | **S** | kunkun "gas pump" (CC-BY-4.0), clean texture set |
| Station (canopy, island, shop, sign) | 1, 9 | **S** | Elbolillo "Gas station" + "Gas station Props" (CC-BY-4.0; CC0 FBX alternative), re-textured |
| Car | 1–3, 9 | **S** | Comrade1280 "Generic passenger car pack" (CC-BY-4.0), or a CC0 Quaternius / Kay Lousberg car after a preview comparison |
| Ground and island textures | 1, 9 | **P** | `clean_asphalt`, `asphalt_floor` |
| Dressing | 1, 9 | **P** | `metal_trash_can`, `concrete_road_barrier`, `WetFloorSign_01`, `fire_hydrant`, `korean_fire_extinguisher_01` |
| Sky | 1, 9 | **A** / **P** | Gradient-sky stage (existing), or a Poly Haven HDRI |
| Fluid, air, x-ray, highlight, shake | 1–8 | **C** (code) | Effects, not assets |
| Sounds and ambience | all | see `sound-captions.md` | Verified CC0 recordings first (especially the liquids); synthesized alternatives tested |

**Reused unchanged:**
- the caption style;
- the narrator;
- the audio scheduler and mixer;
- the character rig and approval gates;
- the storyboard compiler and validator;
- the converter, validator and registration.

**Pipeline additions needed:**
- a Sketchfab provider adapter, using the owner's free API token for downloads;
- optionally, a Poly Pizza adapter;
- environment-compiler support for an outdoor scene made of placed models (the current compiler builds interior rooms only).
