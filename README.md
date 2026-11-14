# Hold Up Animation — Production Pipeline V2

A modular, asset-first production system for original animated YouTube Shorts. This is a **development scaffold**, not a finished rendering application.

## Goal
Improve pacing, voice performance, camera direction and environment quality while reducing repeated Claude Code geometry work. Retain Three.js + Remotion as the eventual scene/render pipeline and use Blender only as an optional model-preparation fallback.

## Status
- [x] Separate V2 repository initialized
- [x] Architecture and production contracts documented
- [x] Initial local asset manifest + resolver implementation and tests
- [x] glTF → GLB conversion, validation, Three.js preview and approved catalog registration (`painted_wooden_stool` registered)
- [ ] Integrate asset resolver into a real Three.js shot
- [x] Poly Haven provider adapter (search + explicit checksum-verified glTF download to cache)
- [ ] Additional provider adapters
- [ ] Add Blender batch conversion for formats/repairs gltf-transform cannot handle, and optional MCP fallback
- [x] Narration-timed storyboard: measured word timing (whisper.cpp), word-anchored shot plans, reusable camera behaviors, validation and a low-res vertical animatic (`stories/barrel-bilge` demo); see `docs/STORYBOARD.md`
- [ ] End-to-end render, QA, and comparison against baseline

## Current pipeline
```text
Research & script -> voice + word timing -> beat/shot plan -> asset resolver
  -> style+license review -> scene construction -> low-res animatic
  -> camera/animation/audio edit -> QA -> final Remotion render
```

**No fabricated assets or invented provider results:** the resolver searches a local JSON catalog and returns a structured miss. With `--external polyhaven` it attaches Poly Haven suggestions to misses for review; it never downloads or substitutes them. Downloads happen only through the explicit `assets:fetch` command.

## Getting started
Node.js 20+ (Node 22 recommended). Run `npm install` first. Storyboarding also needs `ffmpeg` and `whisper-cli` (whisper.cpp); its model downloads and is verified on first use. Conversion previews and the Three.js load test also need Google Chrome or Chromium (or `CHROME_PATH`); Blender is not required.

```bash
npm test
npm run assets -- --query "wooden bar counter"
npm run validate:example
npm run assets -- --query "wooden stool" --external polyhaven   # network: suggests Poly Haven models on local misses
npm run assets:fetch -- --provider polyhaven --id wooden_stool_01 --resolution 1k
npm run assets:convert -- --provider polyhaven --id painted_wooden_stool
npm run assets:register -- --report assets/converted/polyhaven/painted_wooden_stool/<key>/report.json --approve --approved-by "<you>"
npm run storyboard -- --story stories/barrel-bilge/story.json --narrate --render
npm run test:integration
```

Add models to `assets/library/` and declare them in `assets/catalog.json`. See `docs/ASSET_PIPELINE.md`. Example entries are metadata-only fixtures and do not represent downloaded assets.

## Source repository
[claude-animated-shorts](https://github.com/Evan-Wheeler3/claude-animated-shorts) is preserved unchanged. Its `SKILL.md`, bridge composition and visual measurements are reference material, **not yet installed** into V2. We will migrate only validated pieces, not blindly copy the entire bridge example.

## Production rules
Read `CLAUDE.md`, then `skills/director/SKILL.md`. The other skill files apply only to the stage currently in progress.

## Licensing and safety
Only download or redistribute assets under verified terms. Store original source URLs, authors, licenses, and attribution with every asset. Do not add copyrighted reference frames, downloaded media, or large GLBs to Git by default. Keep original stories and imagery; references are for technique study rather than replication.
