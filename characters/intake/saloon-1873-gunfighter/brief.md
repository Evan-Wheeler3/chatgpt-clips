# Character brief: saloon-1873-gunfighter

**Story:** saloon-1873 · **Slot:** gunfighter · **Request:** a new character: gunfighter
**Status:** awaiting artwork. Nothing is drawn or approved yet.

A modern protagonist wakes up inside an 1873 Kansas saloon and accidentally spills a gunfighter's whiskey. The gunfighter challenges them to a duel outside. The narration covers historical gunfights, revolvers, quick-draw myths, shooting accuracy and reaction times. The smartest survival strategy: walk back inside and buy the gunfighter another drink.

## Who they are
- **Role:** gunfighter
- **Age:** adult (30s to 40s)
- **Era:** 1873
- **Personality:** calm, confident, menacing in stillness; dry humour; can be won over with a drink
- **Silhouette:** tall and angular: high-crowned wide-brim hat, broad coat shoulders, long legs, a revolver at the hip, so he reads as the threat at a glance
- **Must contrast with:** protagonist

## Clothing
- round cartoon head
- wide-brim high-crown felt hat
- moustache
- collarless or bib-front shirt
- waistcoat
- sack coat or long duster
- neckerchief
- wool trousers
- boots
- mitten hands

## Accessories (each also drawn separately)
- cartridge belt with holster (riding high on the hip)
- revolver (holstered and in hand)
- whiskey glass

## Expressions
- **Required:** neutral, happy, surprised, concerned
- **For this role:**
  - glare (narrowed eyes, brows down and in)
  - smirk (one-sided smile)
  - challenge (determined, chin up)
  - pleased (when handed a drink)

## Historical notes (Research notes to verify against cited sources before the narration is written (CLAUDE.md: fact-check the story).)
- Revolvers in Kansas around 1873 included cap-and-ball Colts and their cartridge conversions, the Smith & Wesson Model 3 and Remingtons; the Colt Single Action Army was brand new in 1873.
- Holsters rode fairly high on the belt; the low, tied-down quick-draw holster is largely a 20th-century film convention. Many men carried a pistol in a coat pocket or waistband.
- Wide-brim, high-crowned felt hats (the 1865 Stetson 'Boss of the Plains' style) and bowlers were both common; avoid later Hollywood hat shapes and heavy fringe.
- Several Kansas cattle towns had ordinances against carrying firearms in town, which the story may want to acknowledge.

## Artwork requirements
- **Format:** png/jpg/jpeg/webp, at least 1536×1024 px
- **Background:** plain, light and even; no scene behind the figure
- **Views:** 3/4 view, full body, facing screen right (required); front, side, back (recommended)
- **Sheet:** full-body turnaround; expression row (the required set at least); colour swatches with labels; separate drawings of removable accessories (hat, tools, weapons)
- **Forbidden:** copies or close imitations of another creator's characters; likeness of a real living person; logos, watermarks or text over the figure

## Rig reuse
- **Shared systems reused unchanged:** 11 (skeleton, poses, walk, IK, expressions, renderer, checks)
- **Existing forms that fit:** round cartoon head (head), wool trousers (legs), boots (boot), mitten hands (hands)
- **Needs new artwork (forms or attachment layers):** wide-brim high-crown felt hat, moustache, collarless or bib-front shirt, waistcoat, sack coat or long duster, neckerchief, cartridge belt with holster (riding high on the hip) (accessory layer), revolver (holstered and in hand) (accessory layer), whiskey glass (accessory layer)

## Artwork request (paste into ChatGPT image generation, or send to an illustrator)
```text
Character design sheet for an original 2D cartoon character for "Hold Up", a YouTube Shorts channel. An adult Western gunfighter in an 1873 Kansas cattle town: confident, intimidating, still in the simple Hold Up cartoon style.

Setting: a Kansas cattle town saloon and the street outside, 1873. Age: adult (30s to 40s). Personality: calm, confident, menacing in stillness; dry humour; can be won over with a drink.

Style: simple, bold 2D cartoon with flat colours and one thick, even, dark warm outline around every shape; no gradients, textures or hatching. Round, simple face: solid dark oval eyes with no whites, short thick dark eyebrows that carry the expression, no nose or only a tiny mark, a simple line or shape for the mouth. Stylized compact proportions about 2.9-4.2 heads tall, large readable head, simple mitten-like hands.

Silhouette: tall and angular: high-crowned wide-brim hat, broad coat shoulders, long legs, a revolver at the hip, so he reads as the threat at a glance.

Clothing and details: wide-brim high-crown felt hat, moustache, collarless or bib-front shirt, waistcoat, sack coat or long duster, neckerchief, wool trousers, boots. Muted, period-appropriate colours, at most 5 clothing colours, one warm accent at most.

Accessories, each also drawn separately: cartridge belt with holster (riding high on the hip), revolver (holstered and in hand), whiskey glass.

Sheet layout on a plain light background: a full-body 3/4 view facing screen right (most important), plus front, side and back views; an expression row with neutral, happy, surprised, concerned, glare, smirk, challenge, pleased; colour swatches with hex labels.

Do not imitate any existing character, studio or creator; do not resemble a real person; no logos, watermarks or text over the figure.
```

## Next steps
1. Generate or commission the sheet, then import it:
   `node tools/characters/intake.mjs import saloon-1873-gunfighter --image <file> --source chatgpt-image --rights "<who owns it and the commercial terms>"`
2. Review the sheet, then approve or reject the design:
   `node tools/characters/intake.mjs approve saloon-1873-gunfighter --by "<your name>"` (or `reject`)
3. Rebuild the approved sheet as a vector definition in `characters/intake/saloon-1873-gunfighter/character.json` (see `docs/CHARACTER-LIBRARY.md`), then:
   `node tools/characters/intake.mjs promote saloon-1873-gunfighter`
