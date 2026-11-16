# What If Everyone Bought GTA 6 at One Store?

Status: **delivered** (`production/gta-one-shop/gta-one-shop.mp4`: 40 s, 1080x1920, about −14.4 LUFS integrated, −1.1 dBFS peak).
A Hold Up–style remake of the owner's earlier short. It reuses that production's 3D sets and keeps the script, with small
edits. The narrator is Kokoro `am_michael` at speed 1.0, chosen by the owner as the final voice.

## Rebuild
The imported sets come from the owner's earlier production zip (`gta-one-shop-production.zip`). They are not in git; restore
them like this:
```bash
# from the extracted zip: street-mesh.npz (-> vertices), additional-3d-assets.npz (-> room, egypt, future)
python -I tools/episode/import_npz_meshes.py <zip>/street-mesh.npz <zip>/additional-3d-assets.npz --out production/gta-one-shop/assets
cp <zip>/street-atlas-final.png production/gta-one-shop/assets/street-atlas.png
cp <zip>/people.json production/gta-one-shop/assets/people.json
# land.json: Natural Earth 110m land (`node_modules/world-atlas/land-110m.json`, public domain), copied as-is
```
Then:
```bash
python tools/episode/standin_voice.py stories/gta-one-shop/story.json production/gta-one-shop   # Kokoro am_michael + word timing
node tools/audio/synth.mjs
node tools/episode/mix.mjs stories/gta-one-shop/story.json
tools/episode/render-shots.sh stories/gta-one-shop/story.json   # resumable, one shot at a time
ffmpeg -i production/gta-one-shop/picture.mp4 -i production/gta-one-shop/mix.wav -af "volume=0.9dB,alimiter=limit=0.84:level=disabled" \
  -c:v libx264 -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest production/gta-one-shop/gta-one-shop.mp4
```
Known quirk: SwiftShader logs a harmless `USE_TRANSMISSION` shader validation error on the couch, years, future and waiting
shots. `render.mjs` then exits non-zero, so `render-shots.sh` leaves `<id>.tmp.mp4` in place. If its frame count is right,
rename it to `<id>.mp4` and rerun the script; it then only joins the shots.

## Shots
| shot | line | picture |
| --- | --- | --- |
| hook | What if everyone buying GTA 6 shopped at the same game store? | Night street, a queue outside "MIDNIGHT GAMES" (our own "GTA 6 / MIDNIGHT LAUNCH" sign) |
| line | ... the line would stretch nearly 5,700 miles. | Crane up and back as the instanced crowd runs into the distance; miles counter |
| globe | Almost a quarter of the way around Earth. | Natural Earth globe; an 82° arc drawn from the central US |
| penny | If everyone paid $80 in pennies, | A one-cent coin (generic design) spins |
| cube | those coins could build a cube over a hundred feet tall. | A 35.3 m coin-textured cube grows beside the street; height counter |
| couch | Then all 10 million players go home and play for just three hours. | The imported living room: hero and friend on the couch, TV shows an original driving game |
| years | That's over 3,400 years of gaming. On opening night alone. | Push in; hours count up to 3,425 years |
| egypt | That long ago, pharaohs were ruling ancient Egypt. | Imported Egypt set; a pharaoh and a scribe |
| future | And 3,425 years from now, | Imported future city; the shop sign now reads "GTA 7 / COMING SOON"; hover cars and a robot |
| waiting | we'll still be waiting for GTA 7. | The hero as a skeleton, still in line, still holding the phone |

## Accuracy
- 10 million preorders is a third-party estimate and is labelled that way on screen. At 3 ft per person that is 5,682 miles,
  about 23% of Earth's circumference (24,901 mi).
- 10 M × $80 = $800 M = 80 billion pennies. At 19.05 mm × 1.52 mm each that is about 34.6 m³ of coin; the 35.3 m (116 ft) side
  allows for the gaps in a loose pile. "Over a hundred feet" holds either way.
- 10 M × 3 h = 30 M hours = 3,425 years (365 days a year), counted as total player-hours, as the on-screen note says. 2025 − 3,425
  gives about 1400 BC (New Kingdom Egypt); 2026 + 3,425 = 5451 AD.

## Credits and provenance
- The street, room, Egypt and future meshes and the crowd positions come from the owner's own earlier production, supplied
  in the zip. Baked game-logo posters in the street atlas are covered by our own plain-text signs. The zip's `earth.jpg`
  was **not** used because its licence is unknown.
- Globe coastlines: Natural Earth via `world-atlas` (ISC) and `topojson-client` (ISC); the data is public domain.
- Characters are the Hold Up vector rig (hero and friend, plus new pharaoh, scribe and skeleton looks). The coin, cube,
  TV game, robot and vehicles are original geometry.
- Sounds are original synthesis (`tools/audio/synth.mjs`, CC0). Narration: Kokoro (Apache-2.0); timing by faster-whisper (MIT).
- GTA is a trademark of Take-Two Interactive. This is commentary; no game footage or logos are used.
