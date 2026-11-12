#!/bin/sh
# fuse-kern3.sh -- run the kern3demo cartridge (docs/OBJECTS_EVENTS.md 9 test 10) in Fuse 1.9.1 (no window, no sound), record a movie, and check it
# with fuse-kern3-check.mjs against TSRun's settled screen (build/xemu/kern3-ref, made by kern3-ref.mjs; this script makes them).
#   sh tools/xemu/fuse-kern3.sh [CART.dck] [OUTDIR] [SECONDS]
# Defaults: build/kern3demo.dck, build/xemu/fuse-kern3, 20 seconds.  Adapted from fuse-probe23.sh.
# The movie is written uncompressed (--movie-compr None).  fmfconv is NOT used for the frames: fmfconv 0.5 (fuse-utils 1.4.3) cannot read
# Fuse 1.9.1 Timex hi-res movies (it stops at the first hi-res frame) and -S writes only 6,912-byte Spectrum .scr files; its --info output is
# kept in fmfconv.log as the evidence.  fuse-kern3-check.mjs decodes the .fmf itself (format from Fuse's movie.c).
set -e
here=$(cd "$(dirname "$0")/../.." && pwd)
cart=${1:-$here/build/kern3demo.dck}; out=${2:-$here/build/xemu/fuse-kern3}; secs=${3:-20}
mkdir -p "$out"
rm -f "$out/movie.fmf"
node "$here/tools/xemu/kern3-ref.mjs" > "$out/ref.log"
env -u DISPLAY -u WAYLAND_DISPLAY SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy \
  timeout -s INT "$secs" fuse --machine ts2068 \
  --rom-ts2068-0 "$here/tsrun/roms/ts2068-0.rom" --rom-ts2068-1 "$here/tsrun/roms/ts2068-1.rom" \
  --no-sound --no-confirm-actions --no-autosave-settings --movie-compr None \
  --movie-start "$out/movie.fmf" "$cart" > "$out/fuse.log" 2>&1 || true
fmfconv --info "$out/movie.fmf" > "$out/fmfconv.log" 2>&1 || true
echo "fmfconv --info (installed fmfconv 0.5): $(grep -E 'ERR|read [0-9]+ frames' "$out/fmfconv.log" | tr '\n' ' ')"
node "$here/tools/xemu/fuse-kern3-check.mjs" "$out/movie.fmf" "$here/build/xemu/kern3-ref" "$out"
