# Mechanism visualization plan

Goal: one generic, unbranded automatic nozzle, readable at phone size. It is accurate to the shared principle in the patents (`research.md`), simplified in its parts and never wrong about cause and effect. **Nothing is built in Phase 7A.**

## Parts and fluid path (as shown)
```
           diaphragm chamber (vacuum tint)
           ┌───────────────┐
           │  ~~diaphragm~~ │ ← flexes up when suction builds
           └──────┬────────┘
                  │ latch pin
        balls ○ ──┼── ○        lever pivot (on the plunger)
                  │ plunger ───────────●═══════ hand lever
 hose ═══▶ [main valve poppet + spring] ═▶ [venturi throat] ═▶ spout ════════════▶ tip
                                              ▲ suction port                    │
                                              └──────── sensing tube ◀──────────┘ sensing hole (near the tip)
```

| Part | Role on screen | Simplification | Build |
|---|---|---|---|
| Hose inlet + body | Context: where the fuel comes from | Plain tube | Custom (simple) |
| Main valve (poppet) + spring | Payoff: slams shut | One poppet, one coil spring | Custom (hero) |
| Venturi throat | Creates the suction | A visible narrow ring just downstream of the valve seat | Custom |
| Suction port | Where the tube meets the throat | A small hole in the throat wall | Custom |
| Sensing tube | Carries air from the tip | One thin tube along the spout; real designs run it inside | Custom |
| Sensing hole | The hero detail | Slightly oversized for readability (annotated as such in the notes, never sized in narration) | Custom |
| Diaphragm chamber + diaphragm | Responds to vacuum | A short cylinder, with the diaphragm as a soft disc | Custom (vertex/morph flex) |
| Latch pin, balls (2 shown), plunger | The trip | Two balls in the cut plane (real designs use about 3) | Custom |
| Hand lever + pivot | Loses its pivot | The pivot sits visibly on the plunger | Custom |
| Spout | Exterior/interior link | Matches the exterior nozzle exactly | Custom |
| Filler pipe / tank neck | Where fuel rises | A cut cylinder with a rising fuel surface | Custom |

**Custom vs reuse:**
- No existing asset fits. The catalog has 7 Poly Haven props, all 19th-century wood.
- The exterior nozzle and the cutaway must be **one model with two material states**, not two models, so the x-ray dissolve is continuous. Hence a single GLB with named parts:
  - `nozzle/shell`, `nozzle/spout`, `nozzle/lever`, `nozzle/poppet`, `nozzle/spring`, `nozzle/venturi`;
  - `nozzle/tube`, `nozzle/hole`, `nozzle/chamber`, `nozzle/diaphragm`, `nozzle/pin`, `nozzle/ball-1/2`, `nozzle/plunger`.
- **Recommended:** model it in Blender as the exceptional hero asset (CLAUDE.md: Blender for exceptional modeling). Blender MCP availability has **not** been checked in this phase.
- **Fallback:** build it as parametric primitives in Three.js. Lathe geometry suits the tubes, chamber and poppet. This keeps it inside the code pipeline, at the cost of hand-tuning.

## Visual treatments (distinct, consistent)
| Thing | Treatment | Why |
|---|---|---|
| **Gasoline** | Warm amber `#F2A33A`, glossy, slightly emissive; moving streak particles along the flow path; stretched streaks in the venturi | Warm and fast. Reads as liquid without a simulation |
| **Air** | Cool white-blue `#BFE6FF` wisps (soft sprites on a spline through the tube), additive, never glossy | Cool, light and broken up: clearly *not* fuel |
| **Suction / low pressure** | Faint violet `#8C7BFF` fill pulsing in the throat and chamber | A third hue, used only for "this is pulling" |
| **Mechanism metal** | Neutral grey, low metalness, warm rim light; the moving parts slightly brighter than the static ones | The moving parts pop; no clutter |
| **Ghosted shell** | Pale cyan fresnel x-ray at 20–30% opacity, no depth write; the cut faces are a flat solid colour | Shows the outside without hiding the inside |
| **Exterior fuel spill** | Amber ribbon and sheet meshes (animated geometry + shader), a puddle decal that grows and shrinks | Rewindable: it's an animation, so reversing it is free |

## Animation channels needed (not in the current schema)
The compiler ignores unknown keys, so these live under `planned` in each shot of `story.json`. Phase 7B must add real support:
1. Named-part transforms on a prop (poppet, lever, pin, plunger, balls) anchored to words.
2. Material state per prop: solid → x-ray, timed.
3. Fluid effects: overflow (forward and reversed), streak flow on/off and speed, rising fuel level, air wisps on/off.
4. Highlight ring on a part (`hole`).
5. Impact camera shake (a 3-frame decay).

## Accuracy checklist for review renders
- [ ] The air goes **in** at the tip and **up** the tube, never down.
- [ ] Fuel never enters the sensing tube in the steady state; at shutoff it only reaches the hole.
- [ ] The diaphragm moves **toward** the suction.
- [ ] The order is: pin → balls → plunger/pivot drops → spring closes the poppet.
- [ ] The poppet closes *with* the flow direction, against its seat, driven by the spring.
- [ ] No branding, no part numbers, no claimed dimensions.
