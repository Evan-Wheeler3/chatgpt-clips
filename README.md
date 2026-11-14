# Hold Up Animation — Production Pipeline V2

A modular, asset-first production system for original animated YouTube Shorts. This is a **development scaffold**, not a finished rendering application.

## Goal
Improve pacing, voice performance, camera direction and environment quality while reducing repeated Claude Code geometry work. Retain Three.js + Remotion as the eventual scene/render pipeline and use Blender only as an optional model-preparation fallback.

## Status
- [x] Separate V2 repository initialized
- [x] Architecture and production contracts documented
- [x] Initial local asset manifest + resolver implementation and tests
- [ ] Integrate asset resolver into a real Three.js shot
- [ ] Add external provider adapters (Poly Haven first)
- [ ] Add Blender batch conversion and optional MCP fallback
- [ ] Narration-timed storyboard, camera presets, and animated preview
- [ ] End-to-end render, QA, and comparison against baseline

## Current pipeline
```text
Research & script -> voice + word timing -> beat/shot plan -> asset resolver
  -> style+license review -> scene construction -> low-res animatic
  -> camera/animation/audio edit -> QA -> final Remotion render
```

**No fabricated assets or invented provider results:** v1 resolver searches a local JSON catalog and returns a structured miss. Remote downloads are deliberately not implemented until real provider integrations and license checks exist.

## Getting started
Node.js 20+ (Node 22 recommended).

```bash
npm test
npm run assets -- --query "wooden bar counter"
npm run validate:example
```

Add models to `assets/library/` and declare them in `assets/catalog.json`. See `docs/ASSET_PIPELINE.md`. Example entries are metadata-only fixtures and do not represent downloaded assets.

## Source repository
[claude-animated-shorts](https://github.com/Evan-Wheeler3/claude-animated-shorts) is preserved unchanged. Its `SKILL.md`, bridge composition and visual measurements are reference material, **not yet installed** into V2. We will migrate only validated pieces, not blindly copy the entire bridge example.

## Production rules
Read `CLAUDE.md`, then `skills/director/SKILL.md`. The other skill files apply only to the stage currently in progress.

## Licensing and safety
Only download or redistribute assets under verified terms. Store original source URLs, authors, licenses, and attribution with every asset. Do not add copyrighted reference frames, downloaded media, or large GLBs to Git by default. Keep original stories and imagery; references are for technique study rather than replication.
