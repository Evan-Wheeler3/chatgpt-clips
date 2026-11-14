# Hold Up character style guide

This guide is the visual language set by the approved cooper (`characters/cooper/`, design 1.0.0).
- **Machine-readable limits:** `characters/style-guide.json`. Briefs, validation and import checks read it.
- **Review aid only:** the numbers flag drift for a reviewer; they don't approve a design. Every new character still needs human design, rig and production approval (`docs/CHARACTER-LIBRARY.md`).

Not every Hold Up character looks like the cooper. Age, build, era, role and personality should change the silhouette, clothing and proportions. The rendering language and face construction stay the same, so the whole cast belongs to one channel.

## 1. Faces: simple and expressive, with restrained features
- **Eyes:** solid dark vertical ovals, with no whites, irises, lashes or highlights. Cooper: 16% of head height. Range: 11–22%.
- **Brows:** short, thick, dark arcs that carry most of the emotion (raise, tilt, knit). Cooper: about 4% of head height.
- **Nose:** none, or one small mark.
- **Mouth:** a line, arc, O or D. Open mouths show a dark interior and a small tongue.
- **Facial hair:** one simple dark shape (moustache, beard), with the same outline as everything else.
- **Expressions:** the required set is neutral, happy, surprised and concerned. The core set adds speaking, thinking, confused, determined, realization and disappointed. Role-specific faces (a glare, a sheepish grin) are built from the same parts.
- **Avoid:** realistic eyes, eyelashes, nostrils, lips, teeth rows, blush gradients and wrinkles.

## 2. Outlines and line weight
- **One outline:** a single dark, slightly warm ink line around every silhouette (cooper: `#1E1A16`).
- **Screen weight:** about 6–8 px on a 1080p frame, 3 px at the smallest. The renderer holds it constant on screen (`render.outlinePx`, `outlineRatio`).
- **No interior outlines:** there is no outline inside a limb chain; elbows and knees never show a seam.
- **Design lines:** a few are allowed on top (cuffs, sleeve ends, boot tops, a pocket, a hat band).

## 3. Silhouettes and proportions
- **Readable outline:** every character must read from its outline alone, at phone size, against a dark set. Hats, coats, tools and posture do most of this work.
- **Head size:** stylized, compact bodies with a big head. Cooper: 3.26 heads tall. Adults: 2.9–4.2. Children: 2.3–3.0.
- **Builds:** lanky, stocky, short, tall and old characters are all welcome. Change limb lengths, torso shape, head size and hip and shoulder width; the rig adapts (`docs/CHARACTER-LIBRARY.md`, "Rig integration").
- **Contrast:** characters who share a scene should contrast in silhouette (the saloon story pairs a small, soft, hatless protagonist with a tall, angular, hatted gunfighter).
- **Hands:** simple mittens with an optional thumb. Fingers only when a pose needs them (pointing).

## 4. Colour
- **Palette:** flat, muted, period-appropriate colours. At most 5 clothing colours, HSL saturation ≤ 0.62, and one warm accent at most (buttons, a scarf, a badge).
- **Value separation:** neighbouring masses (skin and collar, shirt and apron or coat, coat and trousers) need clearly different values (≥ 0.08 in relative luminance).
- **Skin:** any natural skin tone, separated from hair and collar.
- **Display compensation:** the renderer compensates the scene's tone mapping and grade, so palette swatches are what viewers see under neutral light (cooper: ΔE ≤ 2.7).

## 5. Shading and detail
- **Shading:** flat colour. One soft shade layer only if a design really needs it; the cooper has none.
- **Detail:** keep complexity consistent across the cast. A handful of design lines per garment, with no textures, hatching, gradients or fine pattern. Detail belongs to the 3D environments; the characters stay graphic.

## 6. Clothing and accessories
- **Period accuracy:** clothing is period-accurate and suited to the role. Fact-check it the way the story's facts are checked, and note anachronisms (the cooper's newsboy cap is more typical of the 1880s–1920s).
- **Separate accessories:** hats, tools, weapons and props a character handles are drawn as separate pieces. They attach to the rig as layers on a bone (head, hand, hip), so they can be swapped, held or removed.
- **Avoid:** costume-shop clichés and later film conventions (for the 1870s: low, tied-down holsters and heavy fringe).

## 7. Mobile readability
On rendered frames (`tools/characters/metrics.mjs`):
- the head is at least 16 pt tall on a 390 pt-wide phone;
- silhouette edge contrast is ≥ 0.10;
- character-to-surroundings colour contrast is ΔE ≥ 12;
- the character renders as one piece.

These numbers are reported for each review render.

## 8. In the 3D environments
- **Placement:** characters are flat-painted cards in detailed 3D sets. They are lit by the scene's tint, cast a silhouette shadow, and sit on contact shadows with their feet planted.
- **Set dressing:** keep set dressing behind or beside characters, never through them (validation flags clipping, cropped heads and stray limbs).

## 9. Originality
Hold Up characters are original. Don't imitate another creator's characters, a studio's style or a real person's likeness. No logos, watermarks or text appear on the artwork.

## Artwork deliverable (what intake accepts)
- **Format:** PNG, JPEG or WebP, at least 1536 × 1024 px, on a plain light background.
- **Views:** a full-body 3/4 view facing screen right (required); front, side and back views are recommended.
- **Expressions:** an expression row with at least the required set.
- **Swatches:** colour swatches with hex labels.
- **Accessories:** each removable accessory drawn separately.

The cooper's sheet (`characters/cooper/reference.png`) is the model.
