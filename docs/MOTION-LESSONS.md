# Motion lessons log

Each entry records what a real production or test taught us about camera and animation direction. Each lesson is a rule we now follow, the evidence behind it, and where it is implemented.

Read this before planning a hand-directed shot, together with:

- the [cinematography skill](../skills/cinematography/SKILL.md)
- [camera direction](CAMERA-DIRECTION.md#hand-directed-camera-toolkit)
- [card characters in a 3D set](CHARACTER-RIG.md#card-characters-in-a-3d-set)
- [motion QA](MOTION-QA.md)

Add a new entry after every owner review.

---

## 2026-11 · Runaway Ore Cart motion test (`stories/mine-cart-motion-test`)

This was a 10 s, silent, single continuous shot built from an owner-supplied GLB pack and the approved Cooper rig. Branch `claude/mine-cart-motion-test`, preview `production/mine-cart-motion-test/motion-test.mp4`. The reference implementation is [`scene.mjs`](../stories/mine-cart-motion-test/scene.mjs) and the per-frame QA sampler is [`qa.mjs`](../stories/mine-cart-motion-test/qa.mjs).

**Owner review:** "overall better, I like it." Two notes remained:

1. The character's movements, especially the arms-up recoil at the end, were too fast and unnatural.
2. The character visibly spawns out of thin air.

The test was not re-edited; the notes are carried forward here as rules.

### What worked: keep doing it

| Lesson | Evidence | Where |
|---|---|---|
| **Open on the subject already in motion, big, with a foreground layer sweeping across it.** A low, near-side camera with a fence post and rails between lens and subject reads as speed on frame 1. | Frame 0 read instantly. The post crossed the frame in about 0.4 s. | Camera key 0. |
| **Reveal danger with height, not distance.** A crane up to show the trestle legs falling away beneath the deck sold "over a canyon". Looking past the end at a far wall did not. | The first reveal (far wall behind the deck end) was unreadable. The high reveal with legs visible below read by about 1.6 s. | Camera key 1.95. |
| **Warm atmospheric haze separates near set from far landforms.** | `Fog('#dcc4a6', 9, 58)` pulled the deck end off the spire behind it. | Scene "light and air". |
| **One continuous move can carry 5+ beats when each beat changes subject or scale:** cart → reveal → worker → gate hit → ore → reaction. | The owner liked the flow. No cuts were needed. | Whole shot. |
| **Contacts solved from asset markers, never eyeballed.** Stop X = gate contact − bumper offset. The gate angle was re-solved per frame so the pad stays on the bumper through the settle. | 0 mm gap measured on every frame. | `poseCart`, `poseGate`. |
| **A heavy stop = pitch about the leading contact** (front wheels on the rail). The rear bounces twice with decay; the load surges and settles. The camera keeps moving through it. | It read as weight without camera shake. | `pitchAt`. |
| **A released prop starts from its exact world transform at release** and then follows analytic ballistics: a lob, a skip with restitution, and a free fall. | No pop at release. | `orePos`, `poseOre`. |
| **Everything is a pure function of time.** Stills, partial renders and the QA sampler all agree frame for frame. | Required for the QA sampler. | Whole scene. |

### What went wrong and how it was fixed

| Problem seen | Root cause | Rule now |
|---|---|---|
| The track end was off-frame at 2 s, and the cart was lost during the rise. | 9:16 at a 50° vertical FOV is only about 28° horizontal. Two subjects about 5 m apart along X can't share a frame from the side. | Plan reveals along the **frame's vertical/depth axis**: look down the line, with the subject low in frame and the goal high. Widen to 58–62° for reveals. Pre-check with projected subject points (see the camera tuner). |
| Camera acceleration jumped at keys (jerk 158 m/s³). | Catmull-Rom/Hermite keys are C1 only. | Use **C2 natural cubic splines** for camera position, aim and FOV (jerk fell to about 20 m/s³). Add an intermediate key wherever the aim overshoots after a big tilt. |
| The aim overshot after the canyon dip and cropped the worker. | Spline overshoot following a large vertical aim change. | Pin a key after any dip or crest, and check subject NDC on every frame. |
| The hand was off the lever by up to 400 mm. | The card plane sits 0.3 m in front of the grip; at oblique views the screen positions disagree, and Cooper's arm reach is only 0.41 m. | Solve the hand to the **grip as the camera sees it** (ray onto the card plane). Then nudge the pelvis, only within leg reach, until the hand lands. Check the error only while the hand is on screen. |
| The front foot slid 75 mm during the heave. | A hand-keyed hip path pulled the pelvis beyond leg reach (Cooper's leg is about 0.36 m). | Generate steps and derive the **pelvis from the feet**. Cap the stance at about 0.45 m for Cooper. Bound any pelvis correction by leg reach. |
| The worker read as an edge-on sliver at the frame edge. | Camera about 80° off the card normal. | Keep the camera within about 35° of a card's normal when the card matters. Above 55° the card must be small, brief or off frame. |
| **Owner note: arms-up recoil too fast.** | The recoil blended arms from about 0° to 128° in 0.15 s (about 1,400°/s), with the torso at about 300°/s. Similar 2–3 frame snaps happened at every arm-state switch (walk → lever grab 2.7 s, lever → walk 5.7 s, walk → recoil 7.4 s). | Follow the pose-timing rules in [card characters](CHARACTER-RIG.md#pose-timing-and-arcs): limbs ≤ 420°/s, torso ≤ 160°/s, a 0.25–0.4 s minimum for a big reaction with anticipation and overlap, and cross-fades of at least 0.2 s between arm drivers. `qa.mjs` now flags these. |
| **Owner note: the character spawns out of thin air.** | The card switched `visible = true` at 1.5 s while his body projected to NDC (0.78, 0.02), inside the frame. | **Never toggle visibility inside the frame.** Start the character off frame, behind a foreground occluder, or entering through a door, edge or tunnel. Better still, keep the character visible for the whole shot. `qa.mjs` flags any appear/vanish whose body projects into the frame. |

### Numbers worth reusing

- **Cooper reach:** arm about 0.41 m (shoulder to palm), leg about 0.36 m (hip to ankle). Comfortable stance ≤ 0.45 m; a shuffle step is about 0.3 m in about 0.2 s.
- **Lens:** 9:16 horizontal FOV = 2·atan(tan(vFOV/2)·0.5625). At 50° that is 28°; at 60° it is 36°.
- **Accepted camera envelope in this test (reviewed, not complained about):**

  | Measure | Value |
  |---|---|
  | Peak speed | 4.1 m/s (push-in) |
  | Peak acceleration | 9 m/s² (crest of a crane move) |
  | Peak jerk | 21 m/s³ |
  | Pan/tilt | 69–70°/s for under 0.4 s |
  | Closing settle | below 0.05 m/s |

  Treat these as provisional calibration, not limits.
- **Contact tolerances:**

  | Check | Measured |
  |---|---|
  | Planted foot | 0 mm |
  | On-screen grip | ≤ 0.3 mm |
  | Bumper to pad | 0 mm |
  | Wheel to rail before the stop | 0 mm |

### Carry forward to the next video

1. Before blocking, write a timed beat table, then project subject points per frame (cart, goal, character head/feet) and fix framing numerically before the first render.
2. Stage every character entrance (off frame, occluder or door) and give every gesture a duration from the pose-timing table.
3. Run `qa.mjs`-style checks (entrance, pose speed, contacts, camera derivatives) before asking for review.
4. Add audio in a second pass (wheel rumble, gate clank, impact, ore skip). This test was silent by request.
