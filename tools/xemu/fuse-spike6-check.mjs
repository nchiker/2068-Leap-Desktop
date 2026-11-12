"use strict";
// fuse-spike6-check.mjs -- decode a Fuse 1.9.1 movie (.fmf) of the spike6 cartridge (docs/GRAPHICS_SPIKE.md 17.8, Fuse column) and check it.
//   node tools/xemu/fuse-spike6-check.mjs MOVIE.fmf [REFDIR] [OUTDIR]     (REFDIR default build/xemu/spike6-ref, from spike6-ref.mjs)
//
// Why not fmfconv: fmfconv 0.5 (fuse-utils 1.4.3, the one installed) cannot read a Fuse 1.9.1 movie of a Timex hi-res screen: it stops at the
// first hi-res frame ("Unknown FMF chunk type '0'"), and its -S writes only 6,912-byte Spectrum .scr files.  So this file decodes the FMF itself,
// from Fuse's own source (ui movie.c, the format comment and movie_compress_area / movie_add_area):
//   header 16 bytes: "FMF_V1" e|E, U|Z (zlib after the header), frame rate, screen type, timing, sound format, freq (2), M|S, "\n"
//   chunks: '$' slice x(1) y(2) w(1) h(2) then TWO run-length planes of w*h bytes (bitmap1, then bitmap2/attribute: in Timex hi-res mode 6
//           bitmap1 is the byte from $4000-file, bitmap2 the byte from the $6000-file; the screen-mode byte is NOT written, fmf_screen stays 0)
//           'N' new frame: rate, screen type ($ X C R), timing;  'S' sound slice (7-byte head + data);  'X' end of recording.
//   x is 0..39 and y 0..239: the 320 x 240 canvas incl. 4 border columns each side (16 hi-res pixels each) and 24 border rows.
//   Plane RLE: a byte equal to the one before it is followed by a count n (n more copies); after a count the next byte starts afresh.
// A hi-res frame (screen type R in its N chunk) is turned into a 512 x 192 bitmap: for y 0..191, display column dw 0..31 (screen column dw+4,
// row y+24), pixels 0-7 are bitmap1's bits and 8-15 bitmap2's (bit 7 first): byte column c = 2 dw + file, as in CLAUDE.md.  Bit set = ink.
// Checks: every TSRun checkpoint bitmap (cpK.pbm) appears among the frames, the first appearances in checkpoint order; counts are reported.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const [movie, refDir = join(ROOT, 'build/xemu/spike6-ref'), outDir = dirname(movie)] = process.argv.slice(2);
if (!movie) { console.error('usage: node fuse-spike6-check.mjs MOVIE.fmf [REFDIR] [OUTDIR]'); process.exit(2); }
mkdirSync(outDir, { recursive: true });

// ---- decode ---------------------------------------------------------------------------------------------------------------------
let raw = readFileSync(movie);
if (raw.subarray(0, 6).toString('latin1') !== 'FMF_V1') throw new Error('not an FMF V1 file');
const little = raw[6] === 0x65, compression = String.fromCharCode(raw[7]);
let b = raw.subarray(16);
if (compression === 'Z') b = zlib.inflateSync(b, { finishFlush: zlib.constants.Z_SYNC_FLUSH });   // tolerate a stream not closed with Z_FINISH
const head = { rate: raw[8], screen: String.fromCharCode(raw[9]), timing: String.fromCharCode(raw[10]), sound: String.fromCharCode(raw[11]) };
const COLS = 40, ROWS = 240;
const p1 = new Uint8Array(COLS * ROWS), p2 = new Uint8Array(COLS * ROWS);
let pos = 0, ended = false, screenType = head.screen, frames = [], slices = 0, frameOpen = false, sound = 0;

function plane(dst, x, y, w, h) {
  const total = w * h; let out = 0, prev = -1;
  const put = (v, i) => { const r = Math.floor(i / w), c = i % w; dst[(y + r) * COLS + x + c] = v; };
  while (out < total) {
    const v = b[pos++];
    put(v, out++);
    if (v === prev) {                      // a pair: the count of further copies follows
      const n = b[pos++];
      for (let i = 0; i < n; i++) put(v, out++);
      prev = -1;
    } else prev = v;
  }
  if (out !== total) throw new Error(`plane overran: ${out} of ${total} bytes at file offset ${pos}`);
}
const snapshot = () => {
  const px = new Uint8Array(512 * 192);
  for (let y = 0; y < 192; y++) for (let dw = 0; dw < 32; dw++) {
    const i = (y + 24) * COLS + dw + 4;
    for (let bit = 0; bit < 8; bit++) {
      px[y * 512 + dw * 16 + bit] = (p1[i] >> (7 - bit)) & 1;
      px[y * 512 + dw * 16 + 8 + bit] = (p2[i] >> (7 - bit)) & 1;
    }
  }
  return { hires: screenType === 'R', px };
};
const closeFrame = () => { if (frameOpen) frames.push(snapshot()); frameOpen = false; };
while (pos < b.length && !ended) {
  const t = String.fromCharCode(b[pos++]);
  if (t === '$') {
    const x = b[pos], y = b[pos + 1] | (b[pos + 2] << 8), w = b[pos + 3], h = b[pos + 4] | (b[pos + 5] << 8);
    pos += 6; plane(p1, x, y, w, h); plane(p2, x, y, w, h); slices++;
  } else if (t === 'N') {
    closeFrame(); screenType = String.fromCharCode(b[pos + 1]); pos += 3; frameOpen = true;
  } else if (t === 'S') {
    const len = (b[pos + 5] | (b[pos + 6] << 8)) + 1, fs = (b[pos + 4] === 0x53 ? 2 : 1) * (b[pos] === 0x50 ? 2 : 1);
    pos += 7 + len * fs; sound++;
  } else if (t === 'X') { ended = true; }
  else throw new Error(`unknown FMF chunk type ${JSON.stringify(t)} at ${pos - 1}`);
}
closeFrame();
const hires = frames.map((f, i) => (f.hires ? i : -1)).filter((i) => i >= 0);
console.log(`movie: ${movie}: ${little ? 'little' : 'big'} endian, ${compression === 'Z' ? 'zlib' : 'uncompressed'}, header screen ${head.screen}, timing ${head.timing}; ` +
  `${frames.length} frames, ${slices} slices, ${sound} sound chunks, ${ended ? 'closed with the end chunk' : 'NO end chunk (movie cut off)'}; ` +
  `hi-res frames ${hires.length} (first #${hires[0] ?? '-'}, boot/ROM frames before it ${hires[0] ?? frames.length})`);

// ---- compare with TSRun's checkpoints -------------------------------------------------------------------------------------------
const NCP = 8;
const cps = [];
for (let k = 1; k <= NCP; k++) {
  const f = readFileSync(join(refDir, `cp${k}.pbm`));
  const nl = [0, 0]; let at = 0;                                          // "P4\n512 192\n"
  for (let n = 0; n < 2; n++) { while (f[at] !== 0x0A) at++; at++; }
  const px = new Uint8Array(512 * 192);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) px[y * 512 + x] = (f[at + y * 64 + (x >> 3)] >> (7 - (x & 7))) & 1;
  cps.push(px);
}
const same = (a, c) => { for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) return false; return true; };
const diffCount = (a, c) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; return n; };
const matches = Array.from({ length: NCP }, () => []);
const hiresFrames = frames.map((f, i) => ({ f, i })).filter((o) => o.f.hires);
for (const { f, i } of hiresFrames) for (let k = 0; k < NCP; k++) if (same(f.px, cps[k])) matches[k].push(i);

const rows = [];
rows.push(['the movie decodes to the end chunk, with hi-res frames', ended && hires.length > 0, `${frames.length} frames, ${hires.length} hi-res`]);
for (let k = 0; k < NCP; k++) {
  const m = matches[k];
  let text = m.length ? `${m.length} frames, first #${m[0]}, last #${m.at(-1)}` : 'no frame matches';
  if (!m.length && hiresFrames.length) {
    // nearest frame by differing pixels, to say how close it came
    let best = null;
    for (const { f, i } of hiresFrames) { const d = diffCount(f.px, cps[k]); if (!best || d < best.d) best = { d, i }; }
    text += `; nearest is frame #${best.i} with ${best.d} of 98304 pixels different`;
    mkdirSync(outDir, { recursive: true });
    const pbm = (px) => { const o = Buffer.alloc(64 * 192); for (let i = 0; i < px.length; i++) if (px[i]) o[i >> 3] |= 0x80 >> (i & 7); return Buffer.concat([Buffer.from('P4\n512 192\n'), o]); };
    writeFileSync(join(outDir, `cp${k + 1}-fuse-nearest.pbm`), pbm(hiresFrames.find((o) => o.i === best.i).f.px));
  }
  rows.push([`checkpoint ${k + 1} bitmap appears among the frames`, m.length > 0, text]);
}
// In-order check: the earliest chain of frames i1 < i2 < ... < i8 with frame ik showing checkpoint k (greedy: each takes the first match after the previous).
const chain = []; let after = -1;
for (let k = 0; k < NCP; k++) { const f = matches[k].find((i) => i > after); if (f === undefined) break; chain.push(f); after = f; }
rows.push(['the checkpoints appear in checkpoint order (chain of frames i1 < ... < i8)', chain.length === NCP, `frames ${chain.join(', ')}`]);
// Frames of checkpoint k inside its own window [i_k, i_(k+1)) against outside it: a checkpoint image can also equal an earlier state of the screen
// (reported, not a failure: checkpoint 7's pointer at the corner (511, 191) is clipped to nothing visible, so its picture is the scene alone).
const outside = matches.map((m, k) => (chain.length === NCP ? m.filter((i) => i < chain[k] || (k < NCP - 1 && i >= chain[k + 1])).length : '?'));
console.log(`frames per checkpoint inside its window / outside it: ${matches.map((m, k) => `${k + 1}: ${m.length - outside[k]}/${outside[k]}`).join(', ')}`);
let ok = true;
for (const [n, v, t] of rows) { console.log(`  ${v ? 'PASS' : 'FAIL'}  ${n}${t ? `: ${t}` : ''}`); ok = ok && v; }
console.log(`${ok ? 'PASS' : 'FAIL'}: spike6 on Fuse 1.9.1: ${rows.filter((r) => r[1]).length} of ${rows.length} rows`);
process.exitCode = ok ? 0 : 1;
