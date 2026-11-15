# Character requirements: the recurring Hold Up protagonist

**Owner direction (Phase 7A review):**
- A reusable, original, modern adult **male** protagonist, about 20–30s, in casual clothes.
- Visually distinctive, with a simple, expressive face, in the approved character style.
- **Recurring:** he also appears in historical and time-travel stories, with swappable outfits and accessories.
- **Not the cooper**: the resolver also rejects the cooper for both role and era.

- **Request:** `characters.json` (slot `protagonist`, stable intake id `hold-up-protagonist`, not tied to this episode).
- **Intake:** `characters/intake/hold-up-protagonist/`, status **awaiting-artwork**:
  - `artwork-request.txt`: **paste this into ChatGPT image generation**;
  - `brief.md`: the full brief (style rules, views, expressions, poses, wardrobe plan, next steps);
  - `brief.json`, `intake.json`.
- **Superseded:** the earlier `gas-pump-shutoff-protagonist` brief is kept for the record and marked `supersededBy: hold-up-protagonist`.

## Design
- **Signature (constant across every outfit and era):**
  - a tall, tousled dark-brown quiff that tips slightly forward;
  - a slim build with slightly long arms;
  - a big round head, solid dark oval eyes and thick expressive brows (the house style).
- **Base outfit:**
  - a muted teal zip-up hooded jacket, worn open;
  - a cream T-shirt;
  - dark jeans with rolled cuffs;
  - white sneakers with one muted red stripe (the single warm accent).

  The teal reads against grey concrete and stays clear of the episode's amber, pale blue and violet.
- **Accessories** (drawn separately): smartphone, key fob.
- **Not character artwork:** the fuel nozzle is the episode's 3D prop, held in a grip pose.
- **Expressions:** neutral, happy, surprised, concerned, panicked, relieved, curious, impressed.
- **Poses:**
  - holding a nozzle in a filler neck;
  - recoiling;
  - pointing low;
  - glancing over his shoulder;
  - thumbs-up.

## Built for reuse
- **Swappable clothing.** The prompt asks for clothing drawn as clean, separate flat shapes (nothing across the face, nothing fused to the hands). The rig then carries outfits and accessories as attachment layers: `characters/<id>/outfits/*.json` and `accessories/*.json`, each with its own approval.
- **Wardrobe plan** (later variants, not drawn now):
  - **1873 saloon:** he arrives in his modern base outfit (the fish-out-of-water joke); a period duster and hat come later.
  - **Further eras:** period coats, hats, aprons and tools.
  - **Modern add-ons:** backpack, cap, sunglasses.
- **Saloon story.** `stories/saloon-1873/` still has its own protagonist slot (`saloon-1873-protagonist`). Once this character is approved, that slot should resolve to him as an outfit variant rather than a new character. The saloon files are **not changed yet**.

## Gates (unchanged)
1. ChatGPT sheet.
2. `intake import`, recording the rights.
3. **Owner design approval.**
4. Vector rebuild.
5. Rig checks and regression baselines.
6. Production approval.

No artwork is generated procedurally, and nothing is approved on the owner's behalf.

**Name (owner decision):** the internal id is `hold-up-protagonist`. No public name is needed yet.
