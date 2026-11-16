# Why Are School Buses Yellow?

Status: **preview build.** Narration is a stand-in voice (Kokoro), so the episode retimes itself when the owner's cloned
narrator replaces `production/school-bus-yellow/narration.wav` and `words.json`. Everything else is final-pipeline.

Look: the owner-approved 1939 flashback still (stylised 3D, Hold Up outlines and grade) carried through every shot; 1939
shots add a warm faded-print look (sepia, vignette, dust specks).

## Build
```bash
python tools/episode/standin_voice.py stories/school-bus-yellow/story.json production/school-bus-yellow   # stand-in only
node tools/audio/synth.mjs
node tools/episode/mix.mjs stories/school-bus-yellow/story.json
node tools/episode/render.mjs stories/school-bus-yellow/story.json --quality production
ffmpeg -i production/school-bus-yellow/picture.mp4 -i production/school-bus-yellow/mix.wav -c:v libx264 -crf 20 -c:a aac -b:a 192k -shortest production/school-bus-yellow/school-bus-yellow.mp4
```

## Shots
| shot | line | picture |
| --- | --- | --- |
| hook | Why are school buses yellow? | A modern bus pulls up at a stop; low push toward the sign |
| always | They weren't always that way. | He looks at it; the picture fades to an old-film look |
| flashback-1939 | Back in 1939, ... all sorts of colors. | The approved still: red, green, blue and cream buses pass a brick school |
| standard | There was no national standard. | High view down the line: four colours, four lengths and shapes |
| conference | So a professor named Frank Cyr ... | A professor at a chalkboard ("COLOR = ?"); pull back to the experts at the table |
| fifty | He brought 50 different shades of yellow. | Fifty swatches, lemon to orange-red, pop onto the table |
| debate | After days of debate ... down to one. | Light cycles day to night, the clock spins, cups pile up, cards disappear; the last one lifts to camera |
| why | But why this particular shade? | Match cut: the card against a modern bus, same colour; pull back |
| eyes | Because yellow is ... corner of your eye. | At the stop on his phone, edges of frame blurred; the bus arrives at the edge of view and he looks up |
| orange | And this specific yellow-orange ... | Grey morning: a grey car and a brown truck melt into the haze, the bus does not |
| foggy | Especially on dark, foggy mornings. | Dense dark fog; the bus comes out of it, lights first |
| glossy | The color became known as ... | A can of the paint in front of a parked bus; the lid pops |
| still | And more than 85 years later ... | Crane up over a depot at sunrise: rows of identical buses |

## Credits
Nothing was downloaded. All sets, vehicles, props and painted textures are original geometry in `scene.mjs`; the buses
and cars are generic designs, and district names are invented. The protagonist is the approved Hold Up character. The
professor and the three experts reuse the same vector rig with period hair, suits and glasses (new looks; not a likeness of
the real Frank Cyr). Sounds are original synthesis (`tools/audio/synth.mjs`, CC0). Stand-in narration: Kokoro (Apache-2.0),
timing by faster-whisper (MIT).

## Accuracy notes (script approved by the owner; wording unchanged)
- Confirmed by several sources: the 1939 conference at Teachers College, Columbia, organised by Frank Cyr; 50 shades of
  yellow; visibility in low light and bad weather as the goal.
- "After days of debate": the conference length was not confirmed in the sources found.
- "Narrowed it down to one": Cyr recalled narrowing to three shades before one; the line skips the middle step (fine).
- "One of the easiest colors ... out of the corner of your eye": widely repeated (often as "1.24 times"), but no named study
  was found. Flagged to the owner.
- "Became known as National School Bus Glossy Yellow": the 1939 name was "National School Bus Chrome"; Glossy Yellow is the
  later name. "Became known" is defensible; flagged to the owner.

Sources: tc.edu (2013, "Why the school bus never comes in red or green"); Smithsonian ("How school buses became yellow");
Education Week (1989, the yellow bus's 50th birthday); Wikipedia, Frank W. Cyr; Mental Floss; Wonderopolis.
