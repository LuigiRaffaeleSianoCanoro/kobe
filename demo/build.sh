#!/usr/bin/env bash
# Renders the 30s product demo of the live app to demo/out/kobe-demo.mp4.
# Needs Node, Google Chrome (override with CHROME=...), ffmpeg and python3 + numpy.
set -euo pipefail
cd "$(dirname "$0")"

[ -d node_modules ] || npm install --no-audit --no-fund
node record.mjs
python3 audio.py
ffmpeg -y -loglevel error -i out/video.mp4 -i out/audio.wav \
  -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest -movflags +faststart \
  out/kobe-demo.mp4
echo "wrote $(pwd)/out/kobe-demo.mp4"
