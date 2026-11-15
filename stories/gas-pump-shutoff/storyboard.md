# Storyboard (shot by shot)

Written storyboard only: **no frames are rendered in Phase 7A**. Machine-readable version: `story.json` (schema v1; compiles cleanly with scratch timing, see `readiness.md`). Times are estimates from the narrator's measured pace.

| # | Shot | Time | Frame (what we see) | Camera | Narration | Caption band |
|---|---|---|---|---|---|---|
| 1 | `overflow` | 0.0–2.8 | Low ¾ on the filler neck: fuel gushes out, sheets down the car, puddles; the driver recoils | push-in, medium → close | How does a gas pump know when to stop? | lower |
| 2 | `click-rewind` | 2.8–4.9 | **CLICK.** The spill rewinds into the neck; the nozzle sits normally; the driver points at it | hold, detail | It doesn't. The nozzle does. | lower |
| 3 | `tip-hole` | 4.9–9.2 | The car turns to x-ray; the spout tip is inside the filler pipe; a ring pulses on the sensing hole | push-in, medium → detail | And it's not electronic. It's air. See this tiny hole near the tip? | upper (pinned) |
| 4 | `venturi` | 9.2–13.6 | Body cutaway: amber fuel speeds through the narrow throat; a violet suction pulse | track right | Inside, rushing fuel squeezes through a narrow spot, creating suction. | upper |
| 5 | `air-path` | 13.6–19.0 | Blue air wisps in at the hole and up the thin tube to the throat; fuel keeps flowing | pullback, detail → close | That suction pulls air in through the hole, up a thin tube. While air gets in, fuel flows. | upper |
| 6 | `covered` | 19.0–22.5 | The fuel level rises over the hole; the air stops | hold (deliberate) | When the tank's full, gas covers the hole. No more air. | upper |
| 7 | `diaphragm` | 22.5–25.0 | The chamber tints violet; the diaphragm flexes up | push-in, close → detail | So the suction tugs a flexible diaphragm. | upper |
| 8 | `latch` | 25.0–28.2 | Pin up → balls slip → plunger and lever pivot drop | track left | That pulls a pin, a latch lets go, the lever drops, | upper |
| 9 | `snap` | 28.2–30.1 | New angle: the spring slams the poppet shut, the stream cuts off, a small shake | hold + impact | and a spring snaps the valve shut. | upper |
| 10 | `outro` | 30.1–32.4 | Pull back from the dry nozzle to the station; the driver gives a thumbs-up | pullback, close → wide | All from one tiny hole. | lower |

## Rhythm
```
0s        5s        10s       15s       20s       25s       30s  32s
|overflow|clk|tip-hole |venturi |air-path   |covered|diaph|latch |snap|outro|
 ▲push     ▲CLICK+rewind          ▲air in     ▲air stops ▲tug ▲latch ▲CLICK
```
- **Outside → inside → outside.** The cutaway is a single continuous stretch (shots 3–9), bracketed by the same exterior. The viewer always knows where they are.
- **Two clicks.** The hook's click (2.8 s) and the payoff click (28.7 s) are the same sound, so the ending is heard as the answer to the opening.
- **Coverage variety.** The validator flagged three push-ins in a row and a jump cut into `snap`. Both are fixed: shot 2 became a hold, and shot 9 changed to detail framing at a new angle. The `air-path` length and the `covered` hold are deliberate and documented.
