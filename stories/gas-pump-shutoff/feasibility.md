# Production feasibility on the M1

Not measured in this phase: **nothing was rendered**. These are engineering judgements to confirm with low-resolution tests at the start of Phase 7B.

| Risk | Approach | Feasibility | What could go wrong |
|---|---|---|---|
| **Liquid (overflow, flow, rising level)** | No fluid simulation. Animated ribbon/sheet meshes with an amber glossy shader, streak sprites along splines, a growing puddle decal, a flat fuel-surface plane with a ripple normal map | **Good.** Cheap, deterministic, rewindable (reverse = play the curve backwards) | It can look like plastic. Needs the gloss, the streaks and a slight emissive edge to read as liquid at phone size |
| **Transparency / x-ray** | Fresnel shell material, no depth write, rendered before the opaque interior; cut faces as flat opaque caps. Avoid `MeshPhysicalMaterial` transmission (an expensive extra pass, inconsistent) | **Good**, with care | Sorting artefacts between transparent layers. Keep **one** transparent layer per view, never nested ghosts |
| **Mechanism animation** | Named GLB parts transformed by word-anchored keys (a new compiler feature) | **Good.** Simple rigid transforms; the diaphragm via a morph target or vertex shader | Needs the schema extension (`mechanism-plan.md`) |
| **Air wisps** | Additive soft sprites on the tube spline, ~200 particles | **Good** | Overdraw is negligible at this count |
| **Rendering time** | The existing deterministic frame renderer (Three.js + Remotion-style frames) at 1080×1920, about 970 frames | **Likely fine** | The car and environment are the heaviest parts. Keep textures at 1–2K and low-poly geometry. Measure in 7B rather than guess |
| **Character + 3D compositing** | The existing vector-2D character over the 3D stage (proven in barrel-bilge) | **Proven** | The driver holding the nozzle needs a hand contact point. The `touch` action exists; hand-on-prop alignment needs checking |
| **Narration gap for the click** | Natural sentence gap (~0.38 s measured) | **Medium** | If a take's gap is short, the click overlaps "It". Choose the take by gap, or add segmented generation |
| **Modeling the nozzle** | Blender (exceptional hero asset) or parametric Three.js | **Medium** (effort, not compute) | Blender MCP availability **not verified**. Hand modeling may need the owner's time or a fallback |

**Memory/compute:** none of the above needs a GPU simulation, ray tracing or ML models at render time. The heaviest local job remains the narration (local Qwen3-TTS, already proven on this machine).
