#!/bin/sh
# fuse-desk5.sh -- run the desk5 cartridge (docs/SHELL.md 8 test 5) in Fuse 1.9.1 (no window, no sound), record a movie, and check it
# with fuse-desk5-check.mjs against TSRun's settled shell screen (build/xemu/desk5-ref, made by desk5-ref.mjs, which does not build anything).
#   sh tools/xemu/fuse-desk5.sh [CART.dck] [OUTDIR] [SECONDS]
# Defaults: build/desk5.dck, build/xemu/fuse-desk5, 20 seconds.  Adapted from fuse-kern4.sh (same movie handling: uncompressed .fmf,
# decoded by the check script itself because fmfconv 0.5 cannot read Fuse 1.9.1 Timex hi-res movies).
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
cart=${1:-$here/build/desk5.dck}; out=${2:-$here/build/xemu/fuse-desk5}; secs=${3:-20}
mkdir -p "$out"
rm -f "$out/movie.fmf"
node "$here/tools/xemu/desk5-ref.mjs" > "$out/ref.log"
env -u DISPLAY -u WAYLAND_DISPLAY SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  timeout -s INT "$secs" fuse --machine ts2068 \
  --rom-ts2068-0 "$here/tsrun/roms/ts2068-0.rom" --rom-ts2068-1 "$here/tsrun/roms/ts2068-1.rom" \
  --no-sound --no-confirm-actions --no-autosave-settings --movie-compr None \
  --movie-start "$out/movie.fmf" "$cart" > "$out/fuse.log" 2>&1 || true
fmfconv --info "$out/movie.fmf" > "$out/fmfconv.log" 2>&1 || true
echo "fmfconv --info (installed fmfconv 0.5): $(grep -E 'ERR|read [0-9]+ frames' "$out/fmfconv.log" | tr '\n' ' ')"
node "$here/tools/xemu/fuse-desk5-check.mjs" "$out/movie.fmf" "$here/build/xemu/desk5-ref" "$out"
