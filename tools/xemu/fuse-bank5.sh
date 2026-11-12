#!/bin/sh
# fuse-bank5.sh -- run the bank5 cartridge (docs/BANKING.md 7 test 8, 10.5) in Fuse 1.9.1 (no window, no sound), record a movie, and check it
# with fuse-bank5-check.mjs against TSRun's settled display (build/xemu/bank5-ref, made by bank5-ref.mjs, which does not build anything).
#   sh tools/xemu/fuse-bank5.sh [CART.dck] [OUTDIR] [SECONDS]
# Defaults: build/bank5.dck, build/xemu/fuse-bank5, 30 seconds.  Adapted from fuse-kern4.sh (same movie handling: uncompressed .fmf,
# decoded by the check script itself because fmfconv 0.5 cannot read Fuse 1.9.1 Timex hi-res movies).
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
cart=${1:-$here/build/bank5.dck}; out=${2:-$here/build/xemu/fuse-bank5}; secs=${3:-30}
mkdir -p "$out"
rm -f "$out/movie.fmf"
node "$here/tools/xemu/bank5-ref.mjs" > "$out/ref.log"
env -u DISPLAY -u WAYLAND_DISPLAY SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  timeout -s INT "$secs" fuse --machine ts2068 \
  --rom-ts2068-0 "$here/tsrun/roms/ts2068-0.rom" --rom-ts2068-1 "$here/tsrun/roms/ts2068-1.rom" \
  --no-sound --no-confirm-actions --no-autosave-settings --movie-compr None \
  --movie-start "$out/movie.fmf" "$cart" > "$out/fuse.log" 2>&1 || true
fmfconv --info "$out/movie.fmf" > "$out/fmfconv.log" 2>&1 || true
echo "fmfconv --info (installed fmfconv 0.5): $(grep -E 'ERR|read [0-9]+ frames' "$out/fmfconv.log" | tr '\n' ' ')"
node "$here/tools/xemu/fuse-bank5-check.mjs" "$out/movie.fmf" "$here/build/xemu/bank5-ref" "$out"
