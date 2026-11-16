#!/usr/bin/env bash
# Render an episode one shot at a time (production/<slug>/shots/<id>.mp4), skipping shots already rendered, then join
# them into picture.mp4. A restart loses at most the shot in progress; rerun to resume.
#   tools/episode/render-shots.sh stories/<slug>/story.json
set -euo pipefail
cd "$(dirname "$0")/../.."
STORY=$1; SLUG=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$STORY','utf8')).slug)")
OUT=production/$SLUG; mkdir -p "$OUT/shots"
IDS=$(node -e "JSON.parse(require('fs').readFileSync('$STORY','utf8')).shots.forEach(s=>console.log(s.id))")
for id in $IDS; do
  f="$OUT/shots/$id.mp4"
  if [ -s "$f" ] && ffprobe -v error "$f" >/dev/null 2>&1; then echo "have $id"; continue; fi
  node tools/episode/render.mjs "$STORY" --quality production --shots "$id" --out "shots/$id.tmp" && mv "$OUT/shots/$id.tmp.mp4" "$f"
  echo "done $id"
done
: > "$OUT/shots/list.txt"; for id in $IDS; do echo "file '$id.mp4'" >> "$OUT/shots/list.txt"; done
ffmpeg -y -loglevel error -f concat -safe 0 -i "$OUT/shots/list.txt" -c copy "$OUT/picture.mp4"
echo "picture -> $OUT/picture.mp4"
