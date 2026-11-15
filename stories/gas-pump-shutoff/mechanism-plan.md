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

**Sourced vs custom** (asset-first; see `sourcing-report.md`):
- **Exterior: sourced.** ghostbusterjeffrey's "Gas Pump Nozzle" (CC-BY-4.0) supplies the shell, spout, boot, lever and guard. It is restyled with Hold Up materials.
- **Interior: custom, and only the interior.** The poppet and spring, venturi throat and suction port, sensing tube, diaphragm chamber and diaphragm, latch pin, two latch balls, and the plunger with the lever pivot. These are lathe and primitive parts built in Three.js, sized to the sourced shell's measured interior.
- **The cutaway.** It is the sourced shell cut by Three.js clipping planes, with capped section faces, and the custom parts inside. Exterior and cutaway are the same object in two material states, so the x-ray dissolve stays continuous.
- **Named parts for animation.** `nozzle/lever` comes from the sourced model; if the lever is fused to the body, split it in a one-off repair. Everything else is custom and named from the start:
  - `nozzle/poppet`, `nozzle/spring`, `nozzle/venturi`, `nozzle/tube`, `nozzle/hole`;
  - `nozzle/chamber`, `nozzle/diaphragm`, `nozzle/pin`, `nozzle/ball-1/2`, `nozzle/plunger`.
- **Blender is optional.** It is installed (3.1.0) and used only if a repair is needed, such as splitting the lever. It is not the default production method.

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
- [ ] The trigger is the liquid level reaching the spout opening (nozzle patents). No vehicle venting or vapour-recovery parts are shown or implied.
- [ ] Every part and motion above traces to a nozzle patent quote in `research.md` (rows 2–11, 15).
