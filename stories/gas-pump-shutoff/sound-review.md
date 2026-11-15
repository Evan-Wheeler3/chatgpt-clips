# Sound review (★E1): recordings vs synthesized alternatives

Policy (approved): **verified CC0 recordings first, especially the liquids.** The synthesized alternatives are compared by ear, and the owner chooses per sound. Every asset keeps its licence metadata in `audio/catalog.json`.

## 1. Synthesized alternatives (ready to audition)
These are original works, generated reproducibly by `tools/audio/synth.mjs` and dedicated CC0. The files are in `audio/sfx/`.

| Cue | File | Notes |
|---|---|---|
| Overflow gush (loop) | `fuel-gush-loop-synth.wav` | Bubble model (Minnaert bubbles) over turbulence |
| Splash on pavement | `fuel-splash-synth.wav` | Broadband slap + bubbly tail |
| Gulp (rewind lands) | `fuel-gulp-synth.wav` | Three large rising bubbles |
| Rewind | `fuel-gush-reversed-synth.wav` | **Derived** from the gush: the 0.62 s heard before the click, reversed, ×1.12 (`tools/audio/derive.mjs`) |
| Nozzle CLICK (hook + payoff) | `nozzle-click-synth.wav` | Latch tick, then valve clack 15 ms later |
| Latch release | `latch-release-synth.wav` | Small metal snick |
| Diaphragm | `diaphragm-flex-synth.wav` | Soft rubbery thump |
| Air suction (loop) | `air-suction-loop-synth.wav` | Thin band-limited hiss |
| Air stops | `air-stop-synth.wav` | Hiss narrowing and darkening as the hole is covered |
| Station ambience (loop) | `ambience-gas-station-synth.wav` | Wind, distant traffic swells, faint canopy hum (used by the `gas-station` profile for now) |

**Listen:** `open audio/sfx/fuel-gush-loop-synth.wav` (and so on for the others).

## 2. CC0 recordings to download (free Freesound account needed)
Each page was opened and shows **"Creative Commons 0"**. Freesound requires login to download, so these are yours to download. Save them anywhere and tell me the paths, and I'll import each one with its licence evidence.

| For | Recording | Why |
|---|---|---|
| **Gush + the real CLICK** | [Gas Pump.wav, by WryFighter (451551)](https://freesound.org/people/WryFighter/sounds/451551/), 42 s, 96 kHz/24-bit | "A gas tank filling up and then clicking once the tank is full": the real shut-off click and fill sound in one recording |
| Gush (alternative) | [filling the tank, by itinerantmonk108 (787479)](https://freesound.org/people/itinerantmonk108/sounds/787479/), 82 s, 48 kHz/24-bit | A car tank being filled at a pump |
| Gush / nozzle (alternative) | [Gas station pump and nozzle sounds, by crockerg (396492)](https://freesound.org/people/crockerg/sounds/396492/), 38 s | An H4n recording of filling a car |
| **Splash** | [Water on concrete, by LPA134 (329513)](https://freesound.org/people/LPA134/sounds/329513/), 15 s, 88.2 kHz/24-bit | A bucket of water onto concrete, close-miked |
| Splash + **glug** | [Liquid Gurgle Pour Splash FF211, by martinimeniscus (200349)](https://freesound.org/people/martinimeniscus/sounds/200349/), 24 s | Pour, glug and splash on concrete |
| **Ambience** | [busy gas station.wav, by cognito perceptu (115381)](https://freesound.org/people/cognito%20perceptu/sounds/115381/), 83 s | A real station forecourt. **The description mentions patrons, so I'll check for voices before use** |
| Click (alternative) | [Latch Clicks, by Nightflame (397602)](https://freesound.org/people/Nightflame/sounds/397602/), 39 s | Sharp metal latch clicks |

**Import** (once per file; it converts to 48 kHz WAV and starts as `pending-review`):
```bash
node tools/audio/import.mjs add --file <download.wav> --id <id> --category liquid --license CC0-1.0 \
  --source-url <freesound page> --author "<username>" --evidence "<freesound page> shows Creative Commons 0" --description "<what it is>"
```
I'll trim the useful region of each recording (for example the click and the moment the fill stops in 451551) into separate derived assets. The rewind is then re-derived from the chosen gush.

## 3. Your decision (★E1)
For each cue: **recording**, **synth**, or **both layered**. The story's cue IDs (`fuel-gush-loop`, `nozzle-click`, …) are pointed at the chosen assets after E1. Until then the mix can't run with them, by design: nothing is substituted silently.
