"use strict";
// fuse-kern4-check.mjs -- decode a Fuse 1.9.1 movie (.fmf) of the kern4 cartridge (docs/WINDOWS.md 18.6: the boot screen only) and check it.
//   node tools/xemu/fuse-kern4-check.mjs MOVIE.fmf [REFDIR] [OUTDIR]     (REFDIR default build/xemu/kern4-ref, from kern4-ref.mjs)
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
// Checks: the settled demo screen of TSRun (boot.pbm, made by kern4-ref.mjs) appears among the frames and stays to the end of the movie;
// the screen with the About dialog open (s2.pbm) does not appear (no key is sent to Fuse); counts are reported.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const [movie, refDir = join(ROOT, 'build/xemu/kern4-ref'), outDir = dirname(movie)] = process.argv.slice(2);
if (!movie) { console.error('usage: node fuse-kern4-check.mjs MOVIE.fmf [REFDIR] [OUTDIR]'); process.exit(2); }
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

// ---- compare with TSRun's settled screen ----------------------------------------------------------------------------------------
const loadPbm = (name) => {
  const f = readFileSync(join(refDir, name));
  let at = 0;                                                             // "P4\n512 192\n"
  for (let n = 0; n < 2; n++) { while (f[at] !== 0x0A) at++; at++; }
  const px = new Uint8Array(512 * 192);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) px[y * 512 + x] = (f[at + y * 64 + (x >> 3)] >> (7 - (x & 7))) & 1;
  return px;
};
const settled = loadPbm('boot.pbm'), tab = loadPbm('s2.pbm');
const same = (a, c) => { for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) return false; return true; };
const diffCount = (a, c) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== c[i]) n++; return n; };
const hiresFrames = frames.map((f, i) => ({ f, i })).filter((o) => o.f.hires);
const m = hiresFrames.filter(({ f }) => same(f.px, settled)).map((o) => o.i);
const mTab = hiresFrames.filter(({ f }) => same(f.px, tab)).map((o) => o.i);
const lastHires = hiresFrames.at(-1)?.i ?? -1;
const rows = [];
rows.push(['the movie decodes to the end chunk, with hi-res frames', ended && hires.length > 0, `${frames.length} frames, ${hires.length} hi-res`]);
// "settled" from the first hi-res frame that begins a run of at least 20 consecutive hi-res frames equal to TSRun's boot screen.  Before it
// the boot repaint may still be drawing (each repaint rectangle is drawn with the pointer shielded, docs/WINDOWS.md 6, and Fuse's longer
// frames catch the last desk rectangles, identical in content, being drawn).
const isM = new Set(m);
let runStart = -1;
for (let k = 0; k + 19 < hiresFrames.length && runStart < 0; k++) {
  let all = true;
  for (let j = 0; j < 20; j++) if (!isM.has(hiresFrames[k + j].i)) { all = false; break; }
  if (all) runStart = k;
}
const settledAt = runStart >= 0 ? hiresFrames[runStart].i : -1;
const diffBox = (px) => {
  let n = 0, x0 = 512, x1 = -1, y0 = 192, y1 = -1;
  for (let k = 0; k < px.length; k++) if (px[k] !== settled[k]) { const x = k % 512, y = (k / 512) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return { n, x0, x1, y0, y1 };
};
const ptrOnly = (d) => d.n > 0 && d.x0 >= 500 && d.y0 >= 180;   // every differing pixel inside the pointer's box (500..511, 180..191)
const matchesNote = m.length ? `${m.length} frames equal it, first #${m[0]}, last #${m.at(-1)}` : 'no frame matches';
rows.push(['the settled boot screen (TSRun) appears among the frames (pixel for pixel = the 12,288 display bytes)', m.length > 0, matchesNote]);
rows.push(['a run of at least 20 consecutive hi-res frames equals it (the screen is "settled" from the first frame of that run)', settledAt >= 0,
  settledAt >= 0 ? `settled from frame #${settledAt}` : 'no such run']);
const after = hiresFrames.filter((o) => settledAt >= 0 && o.i >= settledAt);
const bad = after.filter((o) => !isM.has(o.i));
rows.push(['from the settled frame to the end of the movie every hi-res frame equals it', settledAt >= 0 && bad.length === 0,
  `${after.length - bad.length} of ${after.length} hi-res frames from #${settledAt} on; last hi-res frame #${lastHires}` + (bad.length ? `; the others: ${bad.map((o) => `#${o.i}`).join(', ')}` : '')]);
// information: the frames before the settled frame that are not the boot screen, and whether they differ in the pointer's box only
const before = hiresFrames.filter((o) => settledAt >= 0 && o.i < settledAt && !isM.has(o.i)).map((o) => ({ i: o.i, d: diffBox(o.px ?? o.f.px) }));
const ptrMissing = before.filter((o) => ptrOnly(o.d));
console.log(`  INFO  before the settled frame #${settledAt}: ${before.length} hi-res frames are not the boot screen; ${ptrMissing.length} of them differ in the pointer box only` +
  (ptrMissing.length ? `, i.e. the pointer is missing (${ptrMissing.map((o) => `#${o.i}: ${o.d.n} pixels`).join(', ')})` : '') +
  `; the others (windows still being drawn): ${before.filter((o) => !ptrOnly(o.d)).map((o) => `#${o.i}`).join(' ') || 'none'}`);
rows.push(['the About-dialog screen (s2) does not appear (no key was sent)', mTab.length === 0, `${mTab.length} frames`]);
let ok = true;
for (const [n, v, t] of rows) { console.log(`  ${v ? 'PASS' : 'FAIL'}  ${n}${t ? `: ${t}` : ''}`); ok = ok && v; }
console.log(`${ok ? 'PASS' : 'FAIL'}: kern4demo on Fuse 1.9.1: ${rows.filter((r) => r[1]).length} of ${rows.length} rows`);
process.exitCode = ok ? 0 : 1;
