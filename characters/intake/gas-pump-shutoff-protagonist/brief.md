# Character brief: gas-pump-shutoff-protagonist

**Story:** gas-pump-shutoff · **Slot:** protagonist · **Request:** a new character: driver
**Status:** awaiting artwork. Nothing is drawn or approved yet.

A driver at a modern gas station watches the pump fail to stop and gasoline overflow (an exaggerated what-if), then a CLICK rewinds it: the nozzle itself knows when to stop. The camera dives into a cutaway of the nozzle to show the sensing hole, the airflow, the vacuum, the diaphragm and the latch.

## Who they are
- **Role:** driver
- **Age:** adult (mid 20s to 30s)
- **Era:** 2026
- **Personality:** relatable, slightly clumsy, curious; big readable reactions
- **Silhouette:** simple and friendly: compact Hold Up proportions, a distinctive hairstyle or cap, one strong jacket colour that reads against concrete and a red or white pump

## Clothing
- round cartoon head
- zip jacket or hoodie
- plain T-shirt
- jeans
- sneakers
- mitten hands

## Accessories (each also drawn separately)
- fuel nozzle (held; the dispensing nozzle prop, not character artwork)
- car keys (optional)

## Expressions
- **Required:** neutral, happy, surprised, concerned
- **For this role:**
  - panicked (wide eyes, raised brows, small open mouth) for the overflow
  - relieved (soft smile, lowered brows) after the click
  - curious (one brow up, small mouth) as the explanation starts
  - impressed (raised brows, open smile) at the payoff

## Poses the rig must reach
- holding a nozzle in the filler neck (arm extended, hand at the nozzle grip)
- recoiling from the overflow (lean back, free hand up)
- pointing at the nozzle
- relaxed stance, nozzle hung back on the pump

## Artwork requirements
- **Format:** png/jpg/jpeg/webp, at least 1536×1024 px
- **Background:** plain, light and even; no scene behind the figure
- **Views:** 3/4 view, full body, facing screen right (required); front, side, back (recommended)
- **Sheet:** full-body turnaround; expression row (the required set at least); colour swatches with labels; separate drawings of removable accessories (hat, tools, weapons)
- **Forbidden:** copies or close imitations of another creator's characters; likeness of a real living person; logos, watermarks or text over the figure

## Rig reuse
- **Shared systems reused unchanged:** 11 (skeleton, poses, walk, IK, expressions, renderer, checks)
- **Existing forms that fit:** round cartoon head (head), jeans (legs, recoloured), mitten hands (hands)
- **Needs new artwork (forms or attachment layers):** zip jacket or hoodie, plain T-shirt, sneakers, fuel nozzle (held; the dispensing nozzle prop, not character artwork) (accessory layer), car keys (optional) (accessory layer)

## Artwork request (paste into ChatGPT image generation, or send to an illustrator)
```text
Character design sheet for an original 2D cartoon character for "Hold Up", a YouTube Shorts channel. An ordinary, relatable modern adult filling up their own car: the viewer's stand-in. Expressive and a little comedic; on screen briefly in the hook, the rewind and the payoff.

Setting: a clean, modern self-service gas station in daylight, 2026. Age: adult (mid 20s to 30s). Personality: relatable, slightly clumsy, curious; big readable reactions.

Style: simple, bold 2D cartoon with flat colours and one thick, even, dark warm outline around every shape; no gradients, textures or hatching. Round, simple face: solid dark oval eyes with no whites, short thick dark eyebrows that carry the expression, no nose or only a tiny mark, a simple line or shape for the mouth. Stylized compact proportions about 2.9-4.2 heads tall, large readable head, simple mitten-like hands.

Silhouette: simple and friendly: compact Hold Up proportions, a distinctive hairstyle or cap, one strong jacket colour that reads against concrete and a red or white pump.

Clothing and details: zip jacket or hoodie, plain T-shirt, jeans, sneakers. Muted, period-appropriate colours, at most 5 clothing colours, one warm accent at most.

Accessories, each also drawn separately: fuel nozzle (held; the dispensing nozzle prop, not character artwork), car keys (optional).

Sheet layout on a plain light background: a full-body 3/4 view facing screen right (most important), plus front, side and back views; an expression row with neutral, happy, surprised, concerned, panicked, relieved, curious, impressed; colour swatches with hex labels. A small pose row: holding a nozzle in the filler neck (arm extended, hand at the nozzle grip); recoiling from the overflow (lean back, free hand up); pointing at the nozzle; relaxed stance, nozzle hung back on the pump.

Do not imitate any existing character, studio or creator; do not resemble a real person; no logos, watermarks or text over the figure.
```

## Next steps
1. Generate or commission the sheet, then import it:
   `node tools/characters/intake.mjs import gas-pump-shutoff-protagonist --image <file> --source chatgpt-image --rights "<who owns it and the commercial terms>"`
2. Review the sheet, then approve or reject the design:
   `node tools/characters/intake.mjs approve gas-pump-shutoff-protagonist --by "<your name>"` (or `reject`)
3. Rebuild the approved sheet as a vector definition in `characters/intake/gas-pump-shutoff-protagonist/character.json` (see `docs/CHARACTER-LIBRARY.md`), then:
   `node tools/characters/intake.mjs promote gas-pump-shutoff-protagonist`
