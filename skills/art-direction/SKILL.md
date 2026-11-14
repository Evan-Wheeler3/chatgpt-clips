---
name: hold-up-art-direction
description: Build period environments, apply the Hold Up look and stage original 2D characters inside 3D scenes.
---

# Environments, look and characters
- Read `docs/VISUALS.md`. Iterate on pacing and cameras in the fast animatic first. Use `--quality preview` for look review and `production` only for final frames.
- **Places:** reuse or add a story-agnostic `environments/<id>.json`, keeping a `keepClear` zone for the action. Make sure every camera in the story fits inside `bounds`; validation reports `CAMERA_OUTSIDE_ROOM` and `CAMERA_COLLISION`. Get period-appropriate models and textures through the asset pipeline only. Review every candidate's preview, and reject anachronisms (a modern claw hammer, a painted porcelain jug or a push broom in an 1850s storehouse).
- **Depth:** use foreground, midground and background layers. Dressing in the foreground layer may cross the subject; anything else that blocks it is a warning.
- **The look:** keep the channel's material treatment, and change only `palette` or `grade` per story. Never assume realistic PBR assets already match the style; look at a preview.
- **Characters:** original designs only, defined as vector parts in `characters/*.json`; never copy recognisable characters.
  - **Staging:** use measured screen positions (project the character into each shot) rather than guesses.
  - **Cuts:** place a character only on a cut.
  - **Pushes:** keep them synced with the prop's motion (`PUSH_NOT_SYNCED`).
  - **Blocking:** keep the character out of the subject's way unless the shot declares it foreground.
- **Review:** after `--qa`, read the warnings, then watch the MP4 and the per-shot strips yourself. Pixel QA is a trigger, not a verdict.
