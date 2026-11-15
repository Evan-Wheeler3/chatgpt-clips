# Phase 7B execution plan: gas-pump-shutoff. APPROVED (2026-11-14, Evan Wheeler)

The owner approved all five tracks and render checkpoints R1–R5.
- **Working mode:** independent between ★ checkpoints, and never past one without the owner's approval.
- **Sketchfab token:** the owner sets `SKETCHFAB_API_TOKEN` locally. Its value is never printed, logged, committed or requested.

**Locked inputs** (approved in Phase 7A):
- narration revision 4 + fixes, take `rev4-recommended` (24.48 s; 25.10 s video);
- the 10-shot storyboard (`story.json`);
- the CLICK and rewind design;
- amber / pale-blue / violet colour language;
- the asset-first sourcing (`sourcing-report.md`);
- credits (`credits.md`).

**Rules carried forward:**
- free and local only;
- licensed assets first, nothing substituted;
- every approval comes from the owner;
- no final render before checkpoint R4 is approved.

★ marks an **owner checkpoint**: work stops there until you approve.

## Tracks and order
Three tracks run in parallel where they don't depend on each other. The character track depends on your artwork, so it starts first.

```
A Character   ─ artwork (owner) ─★A1─ rig ─★A2 ───────────────────────────┐
B Assets      ─ token (owner) ─ fetch/convert ─★B1─ adapt ─★B2 ────────────┤
C Mechanism   ─ custom internals ─★C1 (stills) ─ motion test ─★C2 ─────────┼─ R1 ★ ─ R2 ★ ─ R3 ★ ─ R4 ★ ─ R5 ★
D Engine      ─ named parts, x-ray, fluids, freeze, shake, outdoor scene ──┤
E Audio       ─ CC0 search + synth ─★E1 ─ mixer features ──────────────────┘
```

## A. Character: `hold-up-protagonist`
1. **You** generate the sheet in ChatGPT from `characters/intake/hold-up-protagonist/artwork-request.txt`, then import it:
   `node tools/characters/intake.mjs import hold-up-protagonist --image <file> --source chatgpt-image --rights "<terms>"`
2. **★A1 Design approval:** `intake.mjs approve hold-up-protagonist --by "<you>"`. If you reject it, we iterate on the prompt.
3. Rebuild the sheet as a vector definition on the shared rig: forms, palette, separable clothing layers, a face set with all 8 expressions, and the poses (grip, recoil, point, glance, relaxed).
4. **New storyboard face `relieved`**, for shot 9:
   - added to the shared expression table;
   - the approved cooper gets a **faceMap entry only** (relieved → happy), with no change to his artwork;
   - cooper's regression baselines must stay pixel-identical, or work stops and I report it.
5. Rig checks, regression baselines, a pose/expression sheet and a 5 s motion test, then promote.
6. **★A2 Rig approval:** stills and the motion test.

## B. Assets (Sketchfab adapter + Poly Haven)
1. **You** set `SKETCHFAB_API_TOKEN` (free account). The first real download confirms the API path end to end. If it fails, I stop and report rather than work around it.
2. Fetch and convert, one at a time (`npm run assets:convert -- --provider sketchfab --id <uid>`):

   | Asset | Model | Licence |
   |---|---|---|
   | nozzle | `5343a980106c41609a4ba34786d8a088` | CC BY 4.0 |
   | dispenser | `add0f902b9164718bd0540e88bf9927e` | CC BY 4.0 |
   | station | `eeb913b90b4344ddbd7852f82a7ef160` | CC BY 4.0 |
   | station props | `8fcd52f1b12e4b4296589b4c6328b777` | CC BY 4.0 |
   | car pack | `20f9af9b8a404d5cb022ac6fe87f21f5` | CC BY 4.0 |

   - Each passes Khronos validation and the Three.js load check, and produces `preview.png` plus a report.
   - The licence is re-checked at download, and the attribution and archive licence text are kept.
3. Poly Haven, through the existing adapter: `clean_asphalt`, `asphalt_floor` textures, and the dressing props.
4. **★B1 Asset review:** you review each preview, then `assets:register --approve --approved-by "<you>" --style <style>`. If a model fails, its fallback from the sourcing report takes its place:
   - nozzle → "Vintage Gas Pump Nozzle";
   - car → the CC0 Quaternius or Kay Lousberg car.
5. **Adaptation** (Three.js material and scene level; the source files stay unchanged):
   - Hold Up material pass;
   - station retexture with Poly Haven CC0;
   - remove the photo-card trees;
   - repaint the pylon and fascia (no "Magna", no "6");
   - the dispenser's clean texture set;
   - choose one car and recolour it;
   - a small custom fuel door and filler neck.
6. **Checks that can only happen now:**
   - whether the nozzle lever is a separate node (if fused: one Blender repair split, recorded with provenance);
   - whether the nozzle shell is closed (needed for clean cutaway caps);
   - real-world scale (a nozzle is roughly 0.30–0.35 m long).
7. **★B2 Adapted look:** one exterior still with the station, car, dispenser and nozzle, plus a credits check.

## C. Technical modelling: only the custom nozzle internals
1. Parametric Three.js parts (lathe and primitives), sized to the **measured interior of the sourced nozzle**:
   - poppet + main spring;
   - venturi seat ring + suction port;
   - sensing tube + sensing hole (slightly oversized for readability);
   - diaphragm chamber + diaphragm (morph flex);
   - latch pin, 2 latch balls (the patent's own section shows 2 of 3), plunger, lever pivot;
   - the filler-neck section with a fuel-level surface.
2. Named, independently animatable parts (`nozzle/poppet`, `nozzle/spring`, …), joined to the sourced shell by clipping-plane section and capped faces.
3. **★C1 Technical stills:** a labelled section diagram render plus the accuracy checklist from `mechanism-plan.md`. Each part and motion is traced to the patent quotes in `research.md`.
4. A silent motion test of the full trip sequence (air in → covered → suction → diaphragm → latch → valve), on the real word timings.
5. **★C2 Mechanism motion approval.**

## D. Engine features (each with tests, and none changing approved behaviour)
- **Story schema:**
  - part actions on props (`parts` transforms anchored to words);
  - material states (solid ↔ x-ray, timed);
  - effect events (overflow forward/reverse, flow streaks on/off, level rise, air arrows on/off, highlight ring, impact shake, 3-frame freeze).
- **Fluids:** stylized meshes and particles on deterministic timelines. The rewind *is* the forward timeline played backwards, so it matches exactly.
- **Outdoor scene:** placed models plus a ground plane and sky in the environment compiler (today it only builds interiors).
- **Regression:** barrel-bilge and the character regression must render unchanged.

## E. Sound
1. **CC0 recordings first** (gush, splash, gulp, click candidates, distant traffic).
   - I look for verified CC0 sources. Some (e.g. Freesound) need a free account for downloads. If so, either you download the files and I import them with `tools/audio/import.mjs` (licence, source page, author, evidence), or I propose an adapter first.
   - Synth alternatives come from `tools/audio/synth.mjs` (click, air hiss, air stop, diaphragm, latch).
2. Derived assets: the reversed gush (inheriting the source licence).
3. **★E1 Listening review:** recordings and synth options side by side; you choose.
4. **Mixer features (approved in Phase 7A):**
   - the 150 ms ambience dip on the click;
   - hard-stop of a looping effect at a cue;
   - a per-shot ambience level.

   Plus the `gas-station` ambience profile, with tests.

## Render checkpoints (all low-resolution until R5)
| Checkpoint | What | What you review |
|---|---|---|
| **R1 ★ Animatic** | Full 25.10 s at animatic quality with the real narration, captions and placeholder-free assets (missing pieces stay flagged, never substituted) | Timing, framing, caption placement, story read |
| **R2 ★ Key frames** | One production-quality still per shot (10) | Look, lighting, colour language, continuity, character on model |
| **R3 ★ Hero sequences** | Preview renders with sound: shots 1–3 (CLICK and rewind) and shots 4–8 (mechanism) | The transition's impact; mechanism clarity and accuracy |
| **R4 ★ Full preview** | The full episode at preview quality with the final mix; render, caption and audio QA reports | Everything; QA numbers (−14 LUFS, −1.5 dBTP, narration clarity, A/V offset, caption safety) |
| **R5 ★ Final** | 1080×1920 production render + QA + the credits block for the YouTube description | Final approval to publish |

**After R5:** I record QA results, wall-clock time per stage, cost (free; local only) and outstanding issues in `readiness.md`.

## Known risks and fallbacks
- **Sketchfab download path** is not yet proven live. Fallback: report it, then use the itch.io CC0 station (FBX) or other sources via the asset-first workflow.
- **Nozzle mesh not cuttable** (open or fused). Fallback: a one-off Blender repair, or the second nozzle candidate.
- **Mixed visual styles across sourced models.** Mitigation: a shared material pass, checked at B2 and R2.
- **The 8 GB M1** with the station model, car, transparency and particles: watch render time and memory at R1, and cut texture resolution before geometry.
- **The character timeline** depends on your artwork. Every other track can proceed without it until R1.
