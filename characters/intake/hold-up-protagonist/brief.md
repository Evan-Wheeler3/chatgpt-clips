# Character brief: hold-up-protagonist

**Story:** gas-pump-shutoff · **Slot:** protagonist · **Request:** a new character: driver
**Status:** awaiting artwork. Nothing is drawn or approved yet.

Hold Up's recurring everyday protagonist: a modern guy who keeps running into everyday mysteries (and, in other episodes, wakes up in history). In this episode he watches the pump fail to stop and gasoline overflow (an exaggerated what-if), then a CLICK rewinds it: the nozzle itself knows when to stop.

## Who they are
- **Role:** driver
- **Age:** adult man, about 25-35
- **Era:** 2026
- **Personality:** relatable, curious, a little clumsy and easily startled, quick to grin; big readable reactions
- **Silhouette:** instantly recognisable even in a different outfit or era: a tall, tousled dark-brown quiff that tips slightly forward (his signature shape, kept in every story), a slim build with slightly long arms, compact Hold Up proportions with a large head; one strong, muted teal jacket colour that reads against grey concrete and a red-and-white pump
- **Must contrast with:** the cooper (approved 1870s craftsman): the protagonist must read as clearly modern and younger, with a different head shape, hair and palette

## Clothing
- round cartoon head
- tall, tousled dark-brown quiff (signature, never covered by default)
- muted teal zip-up hooded jacket, worn open, sleeves pushed up slightly
- plain cream T-shirt
- dark-blue jeans, cuffs rolled once
- simple white sneakers with one muted red stripe (the single warm accent)
- mitten hands

## Accessories (each also drawn separately)
- smartphone (small, plain, no logo)
- car key fob (small, plain)

## Expressions
- **Required:** neutral, happy, surprised, concerned
- **For this role:**
  - panicked (wide eyes, raised brows, small open mouth) for the overflow
  - relieved (soft smile, lowered brows) after the click
  - curious (one brow up, small mouth) as the explanation starts
  - impressed (raised brows, open smile) at the payoff

## Poses the rig must reach
- holding a fuel nozzle in a car's filler neck (arm extended, hand closed around an empty grip)
- recoiling (lean back, free hand up)
- pointing at something low in front of him
- glancing back over his shoulder
- relaxed stance, thumbs-up

## Recurring wardrobe (later outfit/accessory variants; not drawn on this sheet)
- base: modern casual (teal open hoodie-jacket, cream T-shirt, jeans, white sneakers) [this sheet]
- 1873 Kansas saloon (the planned time-travel story): he arrives in his modern base outfit (the fish-out-of-water joke); a period duster coat and hat are later variants
- future historical variants as layers over the same body: period coats, hats, aprons and tools, chosen per story
- accessories as separate layers: smartphone, key fob, backpack, cap, sunglasses, period hats

## Artwork requirements
- **Format:** png/jpg/jpeg/webp, at least 1536×1024 px
- **Background:** plain, light and even; no scene behind the figure
- **Views:** 3/4 view, full body, facing screen right (required); front, side, back (recommended)
- **Sheet:** full-body turnaround; expression row (the required set at least); colour swatches with labels; separate drawings of removable accessories (hat, tools, weapons)
- **Forbidden:** copies or close imitations of another creator's characters; likeness of a real living person; logos, watermarks or text over the figure

## Rig reuse
- **Shared systems reused unchanged:** 11 (skeleton, poses, walk, IK, expressions, renderer, checks)
- **Existing forms that fit:** round cartoon head (head), mitten hands (hands)
- **Needs new artwork (forms or attachment layers):** tall, tousled dark-brown quiff (signature, never covered by default), muted teal zip-up hooded jacket, worn open, sleeves pushed up slightly, plain cream T-shirt, dark-blue jeans, cuffs rolled once, simple white sneakers with one muted red stripe (the single warm accent), smartphone (small, plain, no logo) (accessory layer), car key fob (small, plain) (accessory layer)

## Artwork request (paste into ChatGPT image generation, or send to an illustrator)
```text
Character design sheet for an original 2D cartoon character for "Hold Up", a YouTube Shorts channel. Hold Up's recurring everyday protagonist: an ordinary, likeable modern man (the viewer's stand-in) who reacts big to small mysteries. The same face and body in every episode; only his outfit and accessories change with the story.

Setting: the present day, his home era (he also visits historical eras in other episodes; first episode: a modern self-service gas station), 2026. Age: adult man, about 25-35. Personality: relatable, curious, a little clumsy and easily startled, quick to grin; big readable reactions.

Style: simple, bold 2D cartoon with flat colours and one thick, even, dark warm outline around every shape; no gradients, textures or hatching. Round, simple face: solid dark oval eyes with no whites, short thick dark eyebrows that carry the expression, no nose or only a tiny mark, a simple line or shape for the mouth. Stylized compact proportions about 2.9-4.2 heads tall, large readable head, simple mitten-like hands.

Silhouette: instantly recognisable even in a different outfit or era: a tall, tousled dark-brown quiff that tips slightly forward (his signature shape, kept in every story), a slim build with slightly long arms, compact Hold Up proportions with a large head; one strong, muted teal jacket colour that reads against grey concrete and a red-and-white pump.

Clothing and details: tall, tousled dark-brown quiff (signature, never covered by default), muted teal zip-up hooded jacket, worn open, sleeves pushed up slightly, plain cream T-shirt, dark-blue jeans, cuffs rolled once, simple white sneakers with one muted red stripe (the single warm accent). Muted, period-appropriate colours, at most 5 clothing colours, one warm accent at most.

Accessories, each also drawn separately: smartphone (small, plain, no logo), car key fob (small, plain).

Sheet layout on a plain light background: a full-body 3/4 view facing screen right (most important), plus front, side and back views; an expression row with neutral, happy, surprised, concerned, panicked, relieved, curious, impressed; colour swatches with hex labels. A small pose row: holding a fuel nozzle in a car's filler neck (arm extended, hand closed around an empty grip); recoiling (lean back, free hand up); pointing at something low in front of him; glancing back over his shoulder; relaxed stance, thumbs-up.

Recurring character: the head, face, hair and body stay identical in every story while outfits and accessories change. Draw the clothing as clean, separate flat shapes with their own outlines (nothing drawn across the face, and nothing fused to the hands), so outfits can be swapped as layers later. Draw only the base outfit on this sheet.

Do not imitate any existing character, studio or creator; do not resemble a real person; no logos, watermarks or text over the figure.
```

## Next steps
1. Generate or commission the sheet, then import it:
   `node tools/characters/intake.mjs import hold-up-protagonist --image <file> --source chatgpt-image --rights "<who owns it and the commercial terms>"`
2. Review the sheet, then approve or reject the design:
   `node tools/characters/intake.mjs approve hold-up-protagonist --by "<your name>"` (or `reject`)
3. Rebuild the approved sheet as a vector definition in `characters/intake/hold-up-protagonist/character.json` (see `docs/CHARACTER-LIBRARY.md`), then:
   `node tools/characters/intake.mjs promote hold-up-protagonist`
