# Narration: revision 4. APPROVED

**Owner approval (2026-11-14, Evan Wheeler):**
- revision 4 **with both recommended technical fixes**;
- the measured take `rev4-recommended` (**24.48 s** spoken) and the **25.10 s** video timeline;
- the script is **not** to be extended just to reach 30 s.

The take is recorded in `story.json` → `narration.take`, and it is the active narration in `production/gas-pump-shutoff/`.

- **Narrator:** `hold-up-narrator`, the approved cloned voice (local Qwen3-TTS 0.6B through mlx-audio), unchanged.
- **Timing previews:** two takes were generated for **timing only**, not as approved narration. They live in `production/gas-pump-shutoff/takes/` (gitignored) and were forced-aligned with Qwen3-ForcedAligner (0.08 s step).

## Revision 4 as written by the owner
How does a gas pump know when to stop?
That click comes from a clever little mechanism inside the nozzle.
See this tiny hole near the tip?
While you're pumping, air gets sucked through it.
But when gasoline rises high enough to cover the hole, that airflow stops.
Now the suction pulls on a diaphragm, releasing a spring-loaded valve.
And the gas stops flowing. All because of that tiny hole.

## Recommended: revision 4 with two minimal technical corrections
How does a gas pump know when to stop?
That click? A clever little mechanism inside the nozzle just shut it off.
See this tiny hole near the tip?
While you're pumping, the rushing fuel sucks air in through it.
But when gasoline rises high enough to cover the hole, that airflow stops.
Now the suction pulls on a diaphragm, releasing a spring-loaded valve.
And the gas stops flowing. All because of that tiny hole.

| Line | Change | Why (`research.md`, "Revision 4: line-by-line technical validation") |
|---|---|---|
| Shot 2 | "That click comes from a clever little mechanism inside the nozzle." becomes "That click? A clever little mechanism inside the nozzle just shut it off." | No nozzle source identifies which part makes the audible click. The shutoff itself is verified. The new wording ties the click to the moment of shutoff without claiming its source. Bonus: "That click?" lands exactly on the rewind |
| Shot 4 | "air gets sucked through it" becomes "**the rushing fuel sucks** air in through it" | The suction comes from the flowing fuel (the venturi: US 3,646,974, "the flow of the liquid … creates an orifice effect to suck the air … through the tube"). Without it, "the suction" in shot 6 has no cause |

Everything else is verified as written, including "releasing a spring-loaded valve" as a simplification; the visuals show the latch and lever steps.

**Emphasis:**
- **Voice** (`[[emph +]]` in `story.json`): nozzle, hole, air, stops, suction, hole.
- **Captions:** every "hole" is highlighted. The local engine has no emphasis control, so the voice markup affects captions only.

## Measured duration (timing-preview takes, approved narrator)
| Take | Words | Aligned | **Spoken duration** | Lead-in | Pause after "stop?" | Video length (+0.6 s tail) |
|---|---|---|---|---|---|---|
| `rev4-as-written` | 70 | 70/70 exact | **21.84 s** | 0.80 s | **0.40 s** | about 22.5 s |
| `rev4-recommended` | 75 | 75/75 exact | **24.48 s** | 0.72 s | **0.48 s** | 25.10 s |

**Measured sentence pauses** (recommended take, in seconds):
- stop? 0.48
- click? 0.40
- off. 0.56
- tip? 0.16
- pumping, 0.24
- it. 0.80
- hole, 0.40
- stops. 0.40
- diaphragm, 0.32
- valve. 0.24
- flowing. 0.64

**The intentional pause after the opening question** measures 0.48 s (natural). The local engine can't add silence at a sentence end. The click is placed 0.1 s before "That", which is 0.38 s after "stop?" ends, inside the gap. The 3-frame freeze follows, and the rewind plays under "That click?". So the transition works with the natural pause. No artificial gap is needed.

**The ending is not clipped (measured):**
- In `rev4-recommended`, "hole" decays from −29 dB to −63 dBFS over its last 40 ms. The final 20 ms are at −62.6 dBFS and the last sample is −3/32768.
- The video runs **0.62 s past the last word**: the mix spans the whole 25.10 s timeline, so ambience carries the tail.
- Every new take now records this as `ending` in `words.json` (`tools/narration/narrate.mjs`, `endingReport`), and `episode-check` reports it. A final 20 ms above −45 dBFS is flagged as cut off.
- My earlier "may be clipped" note came from a coarser 120 ms window and was wrong for both takes.

## Against the 28–32 s target (resolved: keep about 25 s)
Both measured takes are **under** the target: 21.8 s as written, 24.5 s recommended. The script is shorter, not too long, so no speed-up or trimming is needed. Options, without changing the voice's speed:

1. **Recommended: keep it at about 25 s.** The story is complete, every beat has room, and a tighter Short helps retention. The longest shot is 4.4 s, the shortest 0.97 s.
2. **Add one line of real explanation** (about +3 s, estimated from the narrator's pace; not measured). In the airflow beat, "Inside, the fuel squeezes through a narrow spot, creating suction." makes the venturi explicit and reaches about 28 s.
3. **Add a designed beat after "stop?"** (about +0.5–0.7 s) by inserting silence into the take at the measured gap. This is an audio edit, not a speed change, and the tool for it isn't built yet.

Final timing is re-measured on the production take after approval. Every cut and cue is anchored to words, so it follows that take automatically.
