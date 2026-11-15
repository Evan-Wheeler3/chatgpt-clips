# Master production script: "How does a gas pump know when to stop?" (narration revision 4)

- **Format:** YouTube Short, 1080×1920, 30 fps.
- **Length:** **25.10 s**, measured: the 24.48 s recommended timing-preview take plus a 0.6 s tail.
- **Machine-readable storyboard:** `story.json`. It compiles against the measured take (`production/gas-pump-shutoff/preproduction-check.json`).
- **Timing:** every time below is a **measured word timestamp** from the forced-aligned preview. Cuts sit 0.1 s before their anchor word, and events 0.07 s before theirs. The production take re-times everything through the same anchors.

**Colour language:**
- **Gasoline:** amber `#F2A33A`.
- **Airflow:** pale blue `#BFE6FF`.
- **Suction / pressure difference:** violet `#8C7BFF`.
- **Metal:** neutral grey.
- **Ghosted shell:** pale cyan.

**Assets:** sourced per `sourcing-report.md` (nozzle, dispenser, station and car from Sketchfab, CC-BY; textures and props from Poly Haven, CC0). The custom work is only the nozzle internals and small details.

**Protagonist:** `hold-up-protagonist` (awaiting artwork).

---

## The CLICK and rewind: measured
| Time (s) | Picture | Sound |
|---|---|---|
| 0.00–2.48 | The overflow builds. The push-in accelerates (ease in) into "stop?" | The gush loop (from 0.22) swells; a splash at 1.68 ("know") |
| **2.86** (click: "That" − 0.1) | **Freeze.** The overflow holds for 3 frames at its peak. The cut to `rewind` sits here, on the same framing (a seamless join) | **CLICK** (latch tick + valve clack). **The gush hard-stops on the same sample**, and the ambience dips 150 ms |
| 2.99–3.52 ("That click?") | **Rewind:** the spill, the recoil and the camera's own push-in run backwards on an expo curve | The overflow recording **reversed** (from 2.99); a **gulp** at 3.57 as the last fuel disappears |
| 3.83 ("A clever…") | Cut: the nozzle close-up; the protagonist points on "nozzle" | Clean voice |

The natural pause after "stop?" measures 0.48 s; the click needs at least 0.30 s, so it fits.

---

## Per shot
**1 · `overflow`** (0.00–2.87, 2.87 s)
- **Narration:** "How does a gas pump know when to stop?"
- **Composition:** low three-quarter view on the filler neck. The car's rear quarter fills the right half; the protagonist is at frame-left, mid-ground; the pump is soft in the background.
- **Character animation:** surprised; a recoil on "know" (`surprised` pose, 1.2 s).
- **Object animation:** fuel ribbon, then sheet, then puddle.
- **Camera:** push-in, medium → close, accelerating into "stop?".
- **Captions:** lower.
- **SFX:** gush and splash, with the station ambience.

**2 · `rewind`** (2.87–3.83, 0.97 s)
- **Narration:** "That click?"
- **Picture:** the click, the freeze and the rewind, as in the table above.
- **Camera:** pullback on the same axis (azimuth 35°), close → medium, ease expo: the push-in reversed.
- **Character animation:** the recoil un-plays back to idle.
- **Captions:** lower.
- **Validator:** JUMP_CUT is intended (the seamless join).

**3 · `the-nozzle`** (3.83–7.33, 3.50 s)
- **Narration:** "A clever little mechanism inside the **nozzle** just shut it off."
- **Composition:** close → detail on the nozzle in the filler neck, with the lever visibly dropped.
- **Character animation:** curious; points on "nozzle".
- **Effect:** a glint travels along the nozzle on "nozzle".
- **Camera:** push-in, eased out, to "off".
- **Captions:** lower.

**4 · `tip-hole`** (7.33–9.10, 1.77 s)
- **Narration:** "See this tiny **hole** near the tip?"
- **Composition:** extreme close-up of the spout tip.
- **Effect:** a soft ring pulses on the sensing hole on "hole".
- **Camera:** push-in, close → detail, to "hole".
- **Captions:** upper, pinned.
- **Facts:** research row 2.

**5 · `airflow`** (9.10–12.77, 3.67 s)
- **Narration:** "While you're pumping, the rushing fuel sucks **air** in through it."
- **Picture:** an x-ray dissolve into the transparent cutaway.
- **Effect:**
  - amber fuel streaks race through the venturi throat on "rushing fuel", with a violet tint pulsing at the throat;
  - **pale-blue arrows** enter the sensing hole and travel up the tube to the throat on "air in through it".
- **Camera:** track right along the nozzle, to "it".
- **Captions:** upper.
- **SFX:** an air-suction hiss from 10.88 ("sucks").
- **Facts:** rows 3–5.

**6 · `covered`** (12.77–17.17, 4.40 s)
- **Narration:** "But when gasoline rises high enough to cover the **hole**, that airflow **stops**."
- **Picture:** close on the tip inside the filler neck. The amber level rises and covers the hole on "cover"; the blue arrows stop on "stops".
- **Camera:** **hold**. Deliberate: the rising level is the only motion.
- **SFX:** the hiss chokes off at 16.32 ("stops").
- **Captions:** upper.
- **Facts:** rows 6 and 15.

**7 · `diaphragm`** (17.17–19.83, 2.67 s)
- **Narration:** "Now the **suction** pulls on a diaphragm, releasing"
- **Effect:**
  - violet fills the sensing passage and diaphragm chamber on "suction";
  - the diaphragm flexes up on "pulls";
  - on "releasing", the pin rises, the latch balls slip, and the plunger and lever pivot drop. The latch sits just below the chamber, in the same section.
- **Camera:** push-in, close → detail, eased out.
- **SFX:** a diaphragm thump at 18.00 and a latch snick at 19.52.
- **Captions:** upper.
- **Facts:** rows 7–10.

**8 · `valve-shut`** (19.83–21.17, 1.33 s)
- **Narration:** "a spring-loaded **valve**."
- **Composition:** detail on the main valve and spring from a new angle (azimuth −40°).
- **Camera:** an accelerating creep (ease in) that **stops dead as the poppet slams** on "valve" (20.64), then a 3-frame decaying shake.
- **Effect:** the amber stream cuts off.
- **SFX:** **the CLICK again** at 20.64 (the same asset as the hook), synchronized to valve closure.
- **Captions:** upper.
- **Facts:** row 11.

**9 · `stops`** (21.17–23.10, 1.93 s)
- **Narration:** "And the gas stops flowing."
- **Composition:** exterior: the nozzle at rest in the filler neck, lever down, no drips.
- **Character animation** (owner adjustment): **subtle relief**. Concerned → a soft smile on "flowing", brows easing down, a small exhale and shoulder drop; no gesture. It uses the existing soft `happy` face now and the dedicated `relieved` expression once `hold-up-protagonist` is rigged (Phase 7B).
- **Camera:** pullback, close → medium, eased to settle.
- **Captions:** lower.

**10 · `outro`** (23.10–25.10, 2.00 s)
- **Narration:** "All because of that tiny **hole**."
- **Camera:** push-in back to the spout tip; it ends on the hole, which glints on "hole".
- **Captions:** lower.
- **Ambience:** fades out.
