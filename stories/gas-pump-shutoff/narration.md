# Narration

Narrator: **hold-up-narrator** (the approved cloned voice, local Qwen3-TTS; profile `voices/hold-up-narrator.json`). **No narration has been generated for this episode.** Generation happens in Phase 7B, after approval.

## Recommended script (96 words, estimated 31.8 s)
> How does a gas pump know when to stop?
> It doesn't. The **nozzle** does.
> And it's not electronic. It's **air**.
> See this tiny hole near the tip?
> Inside, rushing fuel squeezes through a narrow spot, creating **suction**.
> That suction pulls air in through the hole, up a thin tube.
> While air gets in, fuel flows.
> When the tank's full, gas covers the hole. No more air.
> So the suction tugs a flexible diaphragm.
> That pulls a pin, a latch lets go, the lever drops, and a spring **snaps** the valve shut.
> All from one tiny hole.

**Markup:**
- In `story.json`, bold words carry `[[emph +]]`.
- "hole" gets caption emphasis through `captions.emphasize`, so it lights up at each mention. Voice emphasis on "hole" is left out deliberately: four stressed repeats would sound sing-song.

**Why it works:**
- **Hook:** the question is spoken over a disaster image, so the viewer gets the problem in the first second.
- **Twist:** "It doesn't. The nozzle does." reframes the question in four words.
- **Second twist:** "It's air." is something most viewers don't expect.
- **Explanation:** one causal chain, with each link given a visual: air in → covered → vacuum → diaphragm → pin → latch → lever → spring.
- **Ending:** the last line calls back to the hole, so the loop closes on the image it started from.

## Timing estimate: method and caveat
`node tools/episode-check.mjs --story stories/gas-pump-shutoff/story.json` builds a **scratch** timeline from the narrator's measured pace:
- the source is the approved barrel-bilge take, aligned with the forced aligner;
- 15.8 letters/s inside sentences;
- 0.38 s gaps between sentences;
- 0.64 s lead-in.

It estimates **31.8 s** (target 28–32 s). This is an estimate, not a measurement. The real take decides, and every shot is anchored to words, so the edit re-times itself to the real alignment.

A first draft estimated 33.6 s. It was tightened by these edits:
- "As long as air gets in, fuel keeps flowing" became "While air gets in, fuel flows";
- "But" and "instead" were dropped;
- "the handle loses its pivot" became "the lever drops".

Nothing in the causal chain was removed.

**Delivery risks for the take (check in Phase 7B):**
- **The click gap.** The CLICK must sit in the natural pause after "stop?". The local engine can't insert silence at sentence ends, so we rely on the measured ~0.4 s gap. If it comes out shorter, the click overlaps "It". Options then:
  - take a different seed;
  - put the question in its own generated segment and join the segments (a new feature, not built yet).
- **"No more air."** is short and could come out rushed. Audition two seeds.
- **The list.** "a pin, a latch lets go, the lever drops" must keep its commas as small beats.

## Alternate opening lines (both keep the overflow image, the click and the reveal)
1. "Why doesn't every fill-up end like this?" Shows the disaster first, then the CLICK, then "Because the nozzle knows. And it's not electronic…" (the second line changes to fit).
2. "Your gas pump has no idea your tank is full." A provocative claim. Over the overflow, the CLICK lands after it, then "But the nozzle does. And it's not electronic…".

**Recommendation:** keep the main hook. It is the question viewers actually ask, and it fits a search title. Alternate 2 is the strongest swap if a bolder claim is wanted.

## Alternate ending
> "Next time you hear that click, that's air, a diaphragm and a spring saving your shoes."

This is warmer and a little comedic, a callback to both the click and the spill. It's about 1.2 s longer, so the trim would have to come from elsewhere (for example "flexible").

**Recommendation:** the main ending ("All from one tiny hole."), which is shorter and loops cleanly.
