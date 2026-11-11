#!/bin/sh
# fuse-probe23.sh -- run the probe23 cartridge (docs/PROBE_DOCK23.md) in Fuse 1.9.1 (no window, no sound), record a movie, convert it to
# one 6,912-byte .scr per frame with fmfconv -S, and check the frames with fuse-probe23-check.mjs.
#   sh tools/xemu/fuse-probe23.sh [CART.dck] [OUTDIR] [SECONDS]
# Defaults: build/probe23.dck, build/xemu/fuse-probe23, 40 seconds.  (Adapted from Leap-IDE arcade/spike/bank/fuse.sh.)
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
cart=${1:-$here/build/probe23.dck}; out=${2:-$here/build/xemu/fuse-probe23}; secs=${3:-40}
mkdir -p "$out"
rm -f "$out"/frame-*.scr "$out/movie.fmf"
env -u DISPLAY -u WAYLAND_DISPLAY SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  timeout -s INT "$secs" fuse --machine ts2068 \
  --rom-ts2068-0 "$here/tsrun/roms/ts2068-0.rom" --rom-ts2068-1 "$here/tsrun/roms/ts2068-1.rom" \
  --no-sound --no-confirm-actions --no-autosave-settings \
  --movie-start "$out/movie.fmf" "$cart" > "$out/fuse.log" 2>&1 || true
fmfconv -S -y "$out/movie.fmf" "$out/frame.scr" > "$out/fmfconv.log" 2>&1 || true
ls "$out"/frame-*.scr | wc -l
node "$here/tools/xemu/fuse-probe23-check.mjs" "$out"
