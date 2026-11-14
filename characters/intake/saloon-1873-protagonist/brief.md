# Character brief: saloon-1873-protagonist

**Story:** saloon-1873 · **Slot:** protagonist · **Request:** a new character: time traveller
**Status:** awaiting artwork. Nothing is drawn or approved yet.

A modern protagonist wakes up inside an 1873 Kansas saloon and accidentally spills a gunfighter's whiskey. The gunfighter challenges them to a duel outside. The narration covers historical gunfights, revolvers, quick-draw myths, shooting accuracy and reaction times. The smartest survival strategy: walk back inside and buy the gunfighter another drink.

## Who they are
- **Role:** time traveller
- **Age:** adult (late 20s to 30s)
- **Era:** 2026
- **Personality:** ordinary, likeable, nervous, quick to apologise; reacts big
- **Silhouette:** short and soft: rounded shoulders, a slightly larger head than the gunfighter's, no hat, so the outline reads small and unthreatening beside him
- **Must contrast with:** gunfighter

## Clothing
- round cartoon head
- hooded sweatshirt or plain T-shirt
- jeans
- sneakers
- mitten hands

## Accessories (each also drawn separately)
- whiskey glass (spilled)
- smartphone (optional comic prop)

## Expressions
- **Required:** neutral, happy, surprised, concerned
- **For this role:**
  - panicked (wide eyes, small open mouth, raised brows)
  - sheepish grin (closed eyes or side glance, wide flat smile)
  - relieved (soft smile, lowered brows)
  - gulp (tight wavy mouth)

## Artwork requirements
- **Format:** png/jpg/jpeg/webp, at least 1536×1024 px
- **Background:** plain, light and even; no scene behind the figure
- **Views:** 3/4 view, full body, facing screen right (required); front, side, back (recommended)
- **Sheet:** full-body turnaround; expression row (the required set at least); colour swatches with labels; separate drawings of removable accessories (hat, tools, weapons)
- **Forbidden:** copies or close imitations of another creator's characters; likeness of a real living person; logos, watermarks or text over the figure

## Rig reuse
- **Shared systems reused unchanged:** 11 (skeleton, poses, walk, IK, expressions, renderer, checks)
- **Existing forms that fit:** round cartoon head (head), jeans (legs, recoloured), mitten hands (hands)
- **Needs new artwork (forms or attachment layers):** hooded sweatshirt or plain T-shirt, sneakers, whiskey glass (spilled) (accessory layer), smartphone (optional comic prop) (accessory layer)

## Artwork request (paste into ChatGPT image generation, or send to an illustrator)
```text
Character design sheet for an original 2D cartoon character for "Hold Up", a YouTube Shorts channel. An ordinary, relatable modern-day adult who wakes up in an 1873 saloon. Visually expressive, slightly nervous, built for comedic reactions.

Setting: a Kansas cattle town saloon and the street outside, 1873. Age: adult (late 20s to 30s). Personality: ordinary, likeable, nervous, quick to apologise; reacts big.

Style: simple, bold 2D cartoon with flat colours and one thick, even, dark warm outline around every shape; no gradients, textures or hatching. Round, simple face: solid dark oval eyes with no whites, short thick dark eyebrows that carry the expression, no nose or only a tiny mark, a simple line or shape for the mouth. Stylized compact proportions about 2.9-4.2 heads tall, large readable head, simple mitten-like hands.

Silhouette: short and soft: rounded shoulders, a slightly larger head than the gunfighter's, no hat, so the outline reads small and unthreatening beside him.

Clothing and details: hooded sweatshirt or plain T-shirt, jeans, sneakers. Muted, period-appropriate colours, at most 5 clothing colours, one warm accent at most.

Accessories, each also drawn separately: whiskey glass (spilled), smartphone (optional comic prop).

Sheet layout on a plain light background: a full-body 3/4 view facing screen right (most important), plus front, side and back views; an expression row with neutral, happy, surprised, concerned, panicked, sheepish grin, relieved, gulp; colour swatches with hex labels.

Do not imitate any existing character, studio or creator; do not resemble a real person; no logos, watermarks or text over the figure.
```

## Next steps
1. Generate or commission the sheet, then import it:
   `node tools/characters/intake.mjs import saloon-1873-protagonist --image <file> --source chatgpt-image --rights "<who owns it and the commercial terms>"`
2. Review the sheet, then approve or reject the design:
   `node tools/characters/intake.mjs approve saloon-1873-protagonist --by "<your name>"` (or `reject`)
3. Rebuild the approved sheet as a vector definition in `characters/intake/saloon-1873-protagonist/character.json` (see `docs/CHARACTER-LIBRARY.md`), then:
   `node tools/characters/intake.mjs promote saloon-1873-protagonist`
