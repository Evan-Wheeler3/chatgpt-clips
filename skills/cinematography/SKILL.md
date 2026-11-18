---
name: hold-up-cinematography
description: Plan and review smooth camera travel, character and prop choreography, and meaningful visual development and strong openings for Hold Up storyboards, shot lists, animatics, camera rigs, animation passes, motion previews, and final validation.
---

# Hold Up cinematography

Read the [motion lessons log](../../docs/MOTION-LESSONS.md) first. It lists what past owner reviews accepted and rejected. Then read the episode's script, shot list or story data, and the selected narration's measured word timings. Use draft beat timings during early storyboarding and resolve them once the take is aligned. Identify which scene path the episode uses and check the available rigs, props, set geometry and caption layout.

1. **Storyboard and shot list.** Plan the [first two seconds](../../docs/STORYBOARD.md#first-two-seconds) first. Specify what grabs attention on frame one, what large action changes the composition in the first second, and what new story information lands by about two seconds. Identify the dominant visual action for each later beat. Decide what the viewer sees first, what meaningful visual development follows roughly every 1–2 seconds, and how it motivates the next point of attention. Keep an evolving continuous shot when it fits. Give each static hold or cut a story purpose. Use the fields and example in [cinematic shot planning](../../docs/STORYBOARD.md#cinematic-shot-planning).
2. **Animatic.** Build from measured word anchors and preview the full sequence at delivery FPS in 9:16. Check geography, depth, action readability and pacing. Flag active stretches that rely on idle animation or minor drift. Strengthen the action, perspective or focal handoff where it improves the beat.
3. **Camera rig and paths.** Pick a technique from [camera direction](../../docs/CAMERA-DIRECTION.md). Write the opening and closing pose, target, path, timing and lens, including how motion enters, continues and settles. Preserve velocity through continuous segments, keep orientation stable and check clearance, foreground crossings and the view of key contact or reveal frames. Make shake, whip pans and rapid zooms exceptional choices with a story reason.
4. **Character and prop choreography.** Follow the [rig motion standards](../../docs/CHARACTER-RIG.md#character-and-prop-motion-standards). Plan weight transfer, planted steps, turns, contacts, releases and prop momentum. Keep secondary acting subordinate to the large action. Match screen direction, pose phase, eyeline, object state and contact across cuts. Keep approved character definitions and the existing narration workflow.
5. **Implementation handoff.** For declarative shots, use supported `story.json` camera and action fields with word anchors, subject and foreground IDs, focus, purpose and cut motivation. Keep authored shot records with the intended purpose and inspect the resolved plan. For hand-directed shots, put deterministic paths, aim and action in the episode scene and key the timing to measured words. Use Blender for specialized authoring when the shot needs it.
6. **Motion review and final validation.** Render and watch a low-resolution motion preview from the production scene. Apply the [motion QA gate](../../docs/MOTION-QA.md), including the [opening playback check](../../docs/MOTION-QA.md#opening-playback-check). Fix or explicitly resolve findings, then submit the latest preview for approval before full rendering. Record the take, preview, timecoded findings and decision in the episode QA notes. Recheck the final render against the approved motion pass.

**Standing rules from owner reviews** (details in the lessons log):
- Open on the subject already in motion, big, with a foreground layer crossing it.
- In 9:16, stage relationships along depth or the frame's vertical axis. Widen the lens for reveals.
- Interpolate hand-directed cameras with C2 splines, and check projected subject points on every frame before rendering.
- Never pop a character into a visible frame. Enter from off frame, from behind an occluder, or through a portal.
- Give gestures real time: limbs ≤ 420°/s, big reactions 0.3–0.45 s with anticipation and overlap, and cross-fades of at least 0.2 s between pose drivers.
- After each review, add an entry to the lessons log and turn every owner note into an automated check where possible.

Deliver shot directions with visible developments, camera and action continuity, and review evidence suitable for the current stage. A completed shot plan gives the next agent enough information to block the scene and judge the result without guessing the intended movement.
