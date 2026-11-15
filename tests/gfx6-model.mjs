"use strict";
// gfx6-model.mjs -- the reference model for the gfx6 graphics library, slices S1, S2, S3 and S4 (docs/GRAPHICS_SPIKE.md sections 3-6,
// 12, 14, 15 and 16 (S4: PointerModel and the byte-rectangle helpers, near the end of the file)).  Written from the contract, not from the code.  A 512 x 192 bit screen (one byte per pixel here, 1 = ink) and the
// operations: draw op, clip rectangle, G_FILL, G_HLINE, G_VLINE, G_FRAME, G_CLS, plus G_ADDR / G_ROWADDR / ROWTAB (S1); the line
// height GLH, G_TEXT8, G_TEXTP, G_TEXTW, the font parsers (fonts/prop6.txt, src/font.inc) and the expected generated tables
// PROP6_W / PROP6_I / FONTP / SHR / SHL (S2).
//   node tests/gfx6-model.mjs        runs the model's self-test
//
// Readings of the contract where its text leaves room (all of them also listed in the report that came with this file):
//  1. Arguments are signed 16-bit words (-16384..16383 in the tests).  The model wraps whatever it is given through s16(),
//     as the GA word would, and then uses ordinary integers: x + w never overflows in the legal range.
//  2. Clip (G_SETCLIP): x0 = max(x, 0), x1 = min(x + w, 512), y0 = max(y, 0), y1 = min(y + h, 192), half-open.  w <= 0 or
//     h <= 0, or no overlap with the screen, makes the clip empty (nothing is drawn).  The contract does not say which
//     numbers GCLIP holds for an empty clip (only 0 <= x0, x1 <= 512, 0 <= y0, y1 <= 192): the model's clip stays
//     {x0, x1, y0, y1} normalised to an empty clip (x0 = x1 = 0 when empty) and tests compare GCLIP words exactly only for a
//     non-empty clip; for an empty one they check the range and that the words describe an empty rectangle.
//  3. G_FILL / G_HLINE / G_VLINE with w <= 0 or h <= 0 draw nothing.  G_HLINE(x, y, w) = fill(x, y, w, 1),
//     G_VLINE(x, y, h) = fill(x, y, 1, h).
//  4. G_FRAME: w <= 0 or h <= 0 draws nothing; otherwise the pixels of the rectangle on its first or last row or first or
//     last column, each once, then clipped.  w = 1 or h = 1 gives the whole rectangle; w = 2 or h = 2 too (all its pixels
//     lie on the outline).
//  5. G_CLS clears all 12,288 display bytes: it ignores the clip and the op (and leaves both as they were).
//  6. Draw op values are 0 SET, 1 CLR, 2 XOR; other values are not exercised.
//  7. G_ADDR: HL = file address + offset, file = (x >> 3) AND 1 (0 -> $4000, 1 -> $6000), offset = (x >> 3) >> 1 added to the
//     Spectrum row address of file 1 (ROWTAB[y]); the mask is $80 >> (x AND 7).
// S3 (section 15): line (closed form, exact integers), blit, byteRect / saveRect / restoreRect, scrollRegion / scrollv.  Readings:
//  S3a. Arguments are wrapped through s16() as everywhere; w or h above 32 in blit throws (the contract says undefined).
//  S3b. byteRect clamps to the screen only (the clip is ignored); an empty rectangle is {c0 0, nc 0, y0 0, nr 0}.
//  S3c. scrollv intersects with the clip (already inside the screen); n is a signed word; abs(n) >= rows gives paper.
// S2 (section 14):
//  8. G_INIT also sets GLH = 8 (model: init() sets glh = 8).  GLH is a setting written by the caller (setGlh).
//  9. G_TEXT8: col and row are signed words and the cell test is done in true integers, 8 (col + i) >= x0 and so on (no 16-bit
//     wrap of 8 * col).  The tests keep |col| <= 4000 and |row| <= 500 so that 8 * col fits a signed word on any implementation.
//     The glyph is the 8x8 glyph of (code AND $7F); codes 0..31 and 127 are blank, so they still write (opaque cell): SET writes
//     0, CLR writes $FF, XOR changes nothing.  An empty clip draws no cell at all.
// 10. G_TEXTP: the pen is not wrapped; the tests keep x, y and the pen in -16384..16383 (14.4).  Code 13 is tested first: the
//     pen goes back to the start x and down GLH; it has no ink and no advance.  Every other code (0..31, 127..255 included) is
//     a glyph code: ink from FONTP rows (0 for a code without a glyph) and advance PROP6_W[c] (0 without a glyph).
// 11. G_TEXTW: the widest line, lines separated by code 13; an empty string, or a line with only 13s, gives 0.  The result is
//     not wrapped (the tests keep it < 65536; 255 codes of at most 16 pixels is 4080).
// 12. fonts/prop6.txt parser (14.3), strict: a comment is a line whose first non-blank character is ';'; blank (all-white) lines
//     are ignored; the header is `=`, optional blanks, decimal digits, then the end of the line or one blank followed by any
//     text (the character, possibly a blank itself); rows contain only `.` and `#` (a trailing blank in a row, or a CR, is
//     rejected); exactly 8 rows, all of one length L in 1..16, ink only in columns 0..7; every code 32..126 exactly once, in
//     any order; nothing else (a row before the first header, a code outside 32..126, a missing code, a repeated code) throws.
// 13. src/font.inc parser: `DB $xx, $xx, ...` lines (hex with `$`, a trailing `; comment` allowed), label-only and comment-only
//     lines ignored, anything else rejected; exactly 96 x 8 bytes; glyph n is code 32 + n; the byte of code 127 is not used
//     (14.2: 127 is blank).
// 14. Table checks read the cartridge bytes through the CPU bus (what the code sees), so a table that is not mapped fails.


import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCR_W = 512, SCR_H = 192;
export const OP_SET = 0, OP_CLR = 1, OP_XOR = 2;
export const FILE_A = 0x4000, FILE_B = 0x6000, FILE_SIZE = 0x1800;   // $4000-$57FF and $6000-$77FF

/** Signed 16-bit view of an integer (what a GA word holds). */
export const s16 = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;

/** ROWTAB[y] (section 12.3): row y, byte column 0, in file 1. */
export const rowaddr = (y) => 0x4000 + (y & 0xC0) * 32 + (y & 7) * 256 + (y & 0x38) * 4;
export const ROWTAB = Array.from({ length: SCR_H }, (_, y) => rowaddr(y));
/** LMASK[i] = $FF >> i, RMASK[i] = ($FF << (7 - i)) AND $FF (section 12.3). */
export const LMASK = Array.from({ length: 8 }, (_, i) => 0xFF >> i);
export const RMASK = Array.from({ length: 8 }, (_, i) => (0xFF << (7 - i)) & 0xFF);

/** G_ADDR: pixel (x, y) -> { hl: address of the byte holding it, mask: $80 >> (x AND 7) }. x 0..511, y 0..191. */
export function addr(x, y) {
  const bc = x >> 3;
  return { hl: ROWTAB[y] + (bc >> 1) + ((bc & 1) ? 0x2000 : 0), mask: 0x80 >> (x & 7) };
}

// byte index (0..12287) of display byte (y, bc): file A bytes first (offset 0..6143), then file B.
const IDX = new Uint16Array(SCR_H * 64);
for (let y = 0; y < SCR_H; y++) for (let bc = 0; bc < 64; bc++)
  IDX[y * 64 + bc] = (bc & 1) * FILE_SIZE + (ROWTAB[y] - FILE_A) + (bc >> 1);

export class Gfx6Model {
  constructor() {
    this.px = new Uint8Array(SCR_W * SCR_H);     // 1 = ink
    this.init();
  }

  /** G_INIT: op = SET, GLH = 8, clip = the whole screen. (The screen is not touched.) */
  init() { this.op = OP_SET; this.glh = 8; this.clip = { x0: 0, x1: SCR_W, y0: 0, y1: SCR_H }; }
  setOp(op) { this.op = op; }
  /** GLH: the line height G_TEXTP uses for code 13 (a caller-written setting, 1..255). */
  setGlh(v) { this.glh = v & 0xFF; }

  /** G_SETCLIP: the rectangle intersected with the screen, half-open; empty when it has no pixel on screen. */
  setClip(x, y, w, h) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    const x0 = Math.max(x, 0), x1 = Math.min(x + w, SCR_W), y0 = Math.max(y, 0), y1 = Math.min(y + h, SCR_H);
    this.clip = (w <= 0 || h <= 0 || x0 >= x1 || y0 >= y1) ? { x0: 0, x1: 0, y0: 0, y1: 0 } : { x0, x1, y0, y1 };
  }
  clipEmpty() { return this.clip.x0 >= this.clip.x1 || this.clip.y0 >= this.clip.y1; }

  /** G_FILL: every pixel of (x, y, w, h) inside the clip gets the draw op. */
  fill(x, y, w, h) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return;
    const c = this.clip;
    const xa = Math.max(x, c.x0), xb = Math.min(x + w, c.x1), ya = Math.max(y, c.y0), yb = Math.min(y + h, c.y1);
    if (xa >= xb || ya >= yb) return;
    const px = this.px, op = this.op;
    for (let yy = ya; yy < yb; yy++) {
      const r = yy * SCR_W;
      if (op === OP_SET) px.fill(1, r + xa, r + xb);
      else if (op === OP_CLR) px.fill(0, r + xa, r + xb);
      else for (let i = r + xa; i < r + xb; i++) px[i] ^= 1;
    }
  }
  /**
   * G_PATFILL (PAINT 16): the rectangle clipped to the clip and the screen; the pixel (x, y) takes bit 7 - (x AND 7) of pat8[y AND 7] (anchored to the screen).
   * op 0 SET (dst OR bit), 1 CLR (dst AND NOT bit), 2 XOR, 3 REPLACE (dst = bit).  `op` defaults to the model's draw op.  An empty or negative w / h draws nothing.
   */
  patFill(x, y, w, h, pat8, op = this.op) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return;
    const c = this.clip;
    const xa = Math.max(x, c.x0), xb = Math.min(x + w, c.x1), ya = Math.max(y, c.y0), yb = Math.min(y + h, c.y1);
    if (xa >= xb || ya >= yb) return;
    const px = this.px;
    for (let yy = ya; yy < yb; yy++) {
      const r = yy * SCR_W, pb = pat8[yy & 7];
      for (let xx = xa; xx < xb; xx++) {
        const bit = (pb >> (7 - (xx & 7))) & 1, i = r + xx;
        if (op === 0) px[i] |= bit; else if (op === 1) px[i] &= bit ^ 1; else if (op === 2) px[i] ^= bit; else px[i] = bit;
      }
    }
  }
  hline(x, y, w) { this.fill(x, y, w, 1); }
  vline(x, y, h) { this.fill(x, y, 1, h); }

  /** G_FRAME: the outline of the rectangle, each pixel exactly once (first row, last row, then the columns between). */
  frame(x, y, w, h) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return;
    this.fill(x, y, w, 1);                                   // first row
    if (h > 1) this.fill(x, y + h - 1, w, 1);                // last row
    if (h > 2) {
      this.fill(x, y + 1, 1, h - 2);                         // left column, between the rows
      if (w > 1) this.fill(x + w - 1, y + 1, 1, h - 2);      // right column
    }
  }

  /** Apply the draw op to the pixel (x, y), which the caller has already checked is inside the clip. */
  plot(x, y, bit) {
    const i = y * SCR_W + x;
    if (this.op === OP_SET) this.px[i] = 1; else if (this.op === OP_CLR) this.px[i] = 0; else this.px[i] ^= 1;
  }

  /**
   * G_TEXT8 (14.4): character s[i] in the cell (col + i, row) if the whole cell is inside the clip.  A cell is opaque: with g =
   * row k of the 8x8 glyph of (s[i] AND $7F), SET writes g, CLR writes NOT g, XOR writes b XOR g (a whole byte, 8 pixels).
   */
  text8(col, row, bytes) {
    col = s16(col); row = s16(row);
    const c = this.clip, f = fonts().glyph8, y0 = 8 * row, px = this.px, op = this.op;
    if (y0 < c.y0 || y0 + 8 > c.y1) return;
    for (let i = 0; i < bytes.length; i++) {
      const x0 = 8 * (col + i);
      if (x0 < c.x0 || x0 + 8 > c.x1) continue;
      const g = f[bytes[i] & 0x7F];
      for (let k = 0; k < 8; k++) {
        const r = (y0 + k) * SCR_W + x0;
        for (let j = 0; j < 8; j++) {
          const bit = (g[k] >> (7 - j)) & 1;
          if (op === OP_SET) px[r + j] = bit; else if (op === OP_CLR) px[r + j] = bit ^ 1; else px[r + j] ^= bit;
        }
      }
    }
  }

  /**
   * G_TEXTP (14.4): a pen starts at (x, y).  Code 13: pen x = x, pen y += GLH.  Any other code c: every ink pixel of c's PROP6
   * glyph, glyph pixel (j, k) at (pen x + j, pen y + k), inside the clip gets the draw op; then pen x += PROP6_W[c].
   * Returns { x, y }: the pen after the last code.
   */
  textp(x, y, bytes) {
    x = s16(x); y = s16(y);
    const F = fonts(), c = this.clip;
    let penx = x, peny = y;
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i];
      if (code === 13) { penx = x; peny += this.glh; continue; }
      const rows = code < 128 ? F.prop6.rows[code] : null;
      if (rows) {
        for (let k = 0; k < 8; k++) {
          const yy = peny + k;
          if (yy < c.y0 || yy >= c.y1) continue;
          for (let j = 0; j < 8; j++) {
            if (!((rows[k] >> (7 - j)) & 1)) continue;
            const xx = penx + j;
            if (xx < c.x0 || xx >= c.x1) continue;
            this.plot(xx, yy);
          }
        }
      }
      penx += F.prop6.W[code];
    }
    return { x: penx, y: peny };
  }

  /** G_TEXTW (14.4): the width of the widest line (lines separated by code 13), a line's width = the sum of PROP6_W. */
  textw(bytes) {
    const W = fonts().prop6.W;
    let best = 0, cur = 0;
    for (const code of bytes) {
      if (code === 13) { cur = 0; continue; }
      cur += W[code];
      if (cur > best) best = cur;
    }
    return best;
  }

  // ---- S3 (section 15) ------------------------------------------------------------------------------------------------------
  /**
   * Call fn(x, y) for each pixel P(i), i = 0..dmaj, of the line (15.2, amended 2026-11-11), in order, whatever the clip.  The major
   * axis is x when abs(dx) >= abs(dy).  The start S is the end with the smaller major coordinate, E the other; dmaj = E's major -
   * S's (>= 0), dmin = abs(E's minor - S's), smin = sign of (E's minor - S's) (+1 for 0).  P(i) = S's major + i, and
   * S's minor + smin floor((2 i dmin + dmaj) / (2 dmaj)) (0 when dmaj = 0).  So the two orders of the ends give the same pixels (and
   * the same order of visiting).  2 i dmin < 2^32, so the plain integer arithmetic of a double is exact; the floor is taken as
   * (a - a % b) / b, also exact.
   */
  eachLinePixel(x0, y0, x1, y1, fn) {
    x0 = s16(x0); y0 = s16(y0); x1 = s16(x1); y1 = s16(y1);
    const xmaj = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
    let sM = xmaj ? x0 : y0, sN = xmaj ? y0 : x0, eM = xmaj ? x1 : y1, eN = xmaj ? y1 : x1;
    if (eM < sM) { [sM, eM] = [eM, sM]; [sN, eN] = [eN, sN]; }
    const dmaj = eM - sM, dmin = Math.abs(eN - sN), smin = eN < sN ? -1 : 1;
    for (let i = 0; i <= dmaj; i++) {
      let off = 0;
      if (dmaj !== 0) { const a = 2 * i * dmin + dmaj, b = 2 * dmaj; off = (a - (a % b)) / b; }
      if (xmaj) fn(sM + i, sN + smin * off); else fn(sN + smin * off, sM + i);
    }
  }
  /** The line's pixels as [[x, y], ...] (no clipping). */
  linePixels(x0, y0, x1, y1) { const out = []; this.eachLinePixel(x0, y0, x1, y1, (x, y) => out.push([x, y])); return out; }
  /** G_LINE (15.2): the pixels of the line inside the clip get the draw op. */
  line(x0, y0, x1, y1) {
    const c = this.clip;
    this.eachLinePixel(x0, y0, x1, y1, (x, y) => { if (x >= c.x0 && x < c.x1 && y >= c.y0 && y < c.y1) this.plot(x, y); });
  }
  /** dmaj + 1: the number of pixels of the line (the count the T-state per pixel figure divides by). */
  static lineLength(x0, y0, x1, y1) { return Math.max(Math.abs(s16(x1) - s16(x0)), Math.abs(s16(y1) - s16(y0))) + 1; }

  /**
   * G_BLIT (15.2): bitmap pixel (j, k), j < w, k < h, at (x + j, y + k), inside the clip: new = (old AND m) OR i, the pair at
   * data + 2 (k wb + (j >> 3)), mask byte first, bit 7 - (j AND 7); wb = (w + 7) >> 3.  Ignores the op.  w <= 0 or h <= 0 draws
   * nothing; w or h above 32 is not allowed (throws).
   */
  blit(x, y, w, h, data) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return;
    if (w > 32 || h > 32) throw new RangeError(`blit ${w} x ${h}: w and h above 32 are not allowed`);
    const wb = (w + 7) >> 3, c = this.clip, px = this.px;
    for (let k = 0; k < h; k++) {
      const yy = y + k;
      if (yy < c.y0 || yy >= c.y1) continue;
      for (let j = 0; j < w; j++) {
        const xx = x + j;
        if (xx < c.x0 || xx >= c.x1) continue;
        const p = 2 * (k * wb + (j >> 3)), bit = 7 - (j & 7), mk = (data[p] >> bit) & 1, im = (data[p + 1] >> bit) & 1, i = yy * SCR_W + xx;
        px[i] = (px[i] & mk) | im;
      }
    }
  }

  /**
   * G_PRESHIFT (15.2): the shifted set of a source bitmap of w x h (w, h in 1..32; pair format of G_BLIT) as bytes: ws = wb + 1
   * pairs a row; copy p (p = 0..7) at 2 p h ws, its row k at + 2 k ws, its pair q (q = 0..wb) at + 2 q, mask byte first;
   * mask = ((M(q - 1) << (8 - p)) OR (M(q) >> p)) AND $FF with M(-1) = M(wb) = $FF; image the same with I(-1) = I(wb) = 0.
   * Length 16 h ws.  w <= 0 or h <= 0: an empty set (nothing is written).  Static-like: does not touch the screen.
   */
  preshift(w, h, src) {
    w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return new Uint8Array(0);
    if (w > 32 || h > 32) throw new RangeError(`preshift ${w} x ${h}: w and h above 32 are not allowed`);
    const wb = (w + 7) >> 3, ws = wb + 1, out = new Uint8Array(16 * h * ws);
    for (let p = 0; p < 8; p++) for (let k = 0; k < h; k++) for (let q = 0; q <= wb; q++) {
      const M = (b) => (b < 0 || b >= wb ? 0xFF : src[2 * (k * wb + b)]), I = (b) => (b < 0 || b >= wb ? 0 : src[2 * (k * wb + b) + 1]);
      const at = 2 * p * h * ws + 2 * k * ws + 2 * q;
      out[at] = ((M(q - 1) << (8 - p)) | (M(q) >> p)) & 0xFF;
      out[at + 1] = ((I(q - 1) << (8 - p)) | (I(q) >> p)) & 0xFF;
    }
    return out;
  }
  /**
   * G_BLIT drawn from a shifted set (15.2): a second, independent reading of the set format.  For each bitmap pixel (j, k) inside
   * the clip: the screen byte column (x + j) >> 3 (arithmetic shift), q = that - (x >> 3), copy p = x AND 7, bit 7 - ((x + j) AND 7)
   * of pair q of copy p's row k: new = (old AND m) OR i.  Equals blit(...) on the source of the set.
   */
  blitSet(x, y, w, h, set) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return;
    const wb = (w + 7) >> 3, ws = wb + 1, c = this.clip, p = x & 7, px = this.px;
    for (let k = 0; k < h; k++) {
      const yy = y + k;
      if (yy < c.y0 || yy >= c.y1) continue;
      for (let j = 0; j < w; j++) {
        const xx = x + j;
        if (xx < c.x0 || xx >= c.x1) continue;
        const q = (xx >> 3) - (x >> 3), at = 2 * p * h * ws + 2 * k * ws + 2 * q, bit = 7 - (xx & 7), mk = (set[at] >> bit) & 1, im = (set[at + 1] >> bit) & 1, i = yy * SCR_W + xx;
        px[i] = (px[i] & mk) | im;
      }
    }
  }

  /**
   * The byte rectangle of G_SAVERECT (15.2): (x, y, w, h) clamped to the screen (not the clip), half-open [ax, bx) x [ay, by);
   * empty (nc = nr = 0) when either range is; else c0 = ax >> 3, nc = ((bx - 1) >> 3) - c0 + 1, y0 = ay, nr = by - ay.
   */
  byteRect(x, y, w, h) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    const none = { c0: 0, nc: 0, y0: 0, nr: 0 };
    if (w <= 0 || h <= 0) return none;
    const ax = Math.max(x, 0), bx = Math.min(x + w, SCR_W), ay = Math.max(y, 0), by = Math.min(y + h, SCR_H);
    if (ax >= bx || ay >= by) return none;
    const c0 = ax >> 3;
    return { c0, nc: ((bx - 1) >> 3) - c0 + 1, y0: ay, nr: by - ay };
  }
  /** G_SAVERECT as the model sees it: a snapshot of the pixels of the byte rectangle (the buffer layout is internal). */
  saveRect(x, y, w, h) {
    const r = this.byteRect(x, y, w, h), px = new Uint8Array(r.nc * 8 * r.nr);
    for (let k = 0; k < r.nr; k++) for (let j = 0; j < r.nc * 8; j++) px[k * r.nc * 8 + j] = this.px[(r.y0 + k) * SCR_W + r.c0 * 8 + j];
    return { ...r, saved: px, size: 4 + r.nc * r.nr };
  }
  /** G_RESTRECT: the saved pixels go back where they came from; nothing else changes. */
  restoreRect(s) {
    for (let k = 0; k < s.nr; k++) for (let j = 0; j < s.nc * 8; j++) this.px[(s.y0 + k) * SCR_W + s.c0 * 8 + j] = s.saved[k * s.nc * 8 + j];
  }

  /**
   * The scroll region of G_SCROLLV (15.2): (x, y, w, h) intersected with the clip, [cx0, cx1) x [cy0, cy1); the byte columns lying
   * wholly inside [cx0, cx1) (c0 = ceil(cx0 / 8) .. floor(cx1 / 8) - 1) and the rows cy0 .. cy1 - 1.  null when it is empty.
   * Returns { c0, nc, y0, nr }.
   */
  scrollRegion(x, y, w, h) {
    x = s16(x); y = s16(y); w = s16(w); h = s16(h);
    if (w <= 0 || h <= 0) return null;
    const c = this.clip, cx0 = Math.max(x, c.x0), cx1 = Math.min(x + w, c.x1), cy0 = Math.max(y, c.y0), cy1 = Math.min(y + h, c.y1);
    if (cx0 >= cx1 || cy0 >= cy1) return null;
    const c0 = (cx0 + 7) >> 3, c1 = cx1 >> 3;
    if (c0 >= c1) return null;
    return { c0, nc: c1 - c0, y0: cy0, nr: cy1 - cy0 };
  }
  /**
   * G_SCROLLV (15.2): the scroll region moves by n pixel rows (n > 0 up, n < 0 down), the uncovered rows become paper; when
   * abs(n) >= the region's rows the whole region becomes paper; n = 0 does nothing.  Ignores the op.
   */
  scrollv(x, y, w, h, n) {
    n = s16(n);
    const r = this.scrollRegion(x, y, w, h);
    if (!r || n === 0) return;
    const m = Math.abs(n), xa = r.c0 * 8, len = r.nc * 8, px = this.px, row = (k) => (r.y0 + k) * SCR_W + xa;
    if (m >= r.nr) { for (let k = 0; k < r.nr; k++) px.fill(0, row(k), row(k) + len); return; }
    if (n > 0) {
      for (let k = 0; k < r.nr - m; k++) px.copyWithin(row(k), row(k + m), row(k + m) + len);
      for (let k = r.nr - m; k < r.nr; k++) px.fill(0, row(k), row(k) + len);
    } else {
      for (let k = r.nr - 1 - m; k >= 0; k--) px.copyWithin(row(k + m), row(k), row(k) + len);
      for (let k = 0; k < m; k++) px.fill(0, row(k), row(k) + len);
    }
  }

  /** G_CLS: the whole screen to paper; ignores clip and op. */
  cls() { this.px.fill(0); }

  get(x, y) { return this.px[y * SCR_W + x]; }
  set(x, y, v) { this.px[y * SCR_W + x] = v; }
  count() { let n = 0; for (let i = 0; i < this.px.length; i++) n += this.px[i]; return n; }

  /** The 12,288 display bytes: file A ($4000-$57FF) at 0..6143, then file B ($6000-$77FF) at 6144..12287. */
  toBytes() {
    const out = new Uint8Array(2 * FILE_SIZE), px = this.px;
    for (let y = 0; y < SCR_H; y++) {
      for (let bc = 0; bc < 64; bc++) {
        const i = y * SCR_W + bc * 8;
        out[IDX[y * 64 + bc]] = (px[i] << 7) | (px[i + 1] << 6) | (px[i + 2] << 5) | (px[i + 3] << 4) |
                                (px[i + 4] << 3) | (px[i + 5] << 2) | (px[i + 6] << 1) | px[i + 7];
      }
    }
    return out;
  }

  /** Decode the 12,288 display bytes of a 64 KB RAM array into this screen (op and clip untouched). */
  loadRam(ram) {
    const px = this.px;
    for (let y = 0; y < SCR_H; y++) {
      for (let bc = 0; bc < 64; bc++) {
        const k = IDX[y * 64 + bc], v = ram[(k < FILE_SIZE ? FILE_A + k : FILE_B + k - FILE_SIZE)];
        const i = y * SCR_W + bc * 8;
        px[i] = (v >> 7) & 1; px[i + 1] = (v >> 6) & 1; px[i + 2] = (v >> 5) & 1; px[i + 3] = (v >> 4) & 1;
        px[i + 4] = (v >> 3) & 1; px[i + 5] = (v >> 2) & 1; px[i + 6] = (v >> 1) & 1; px[i + 7] = v & 1;
      }
    }
    return this;
  }
  static fromRam(ram) { return new Gfx6Model().loadRam(ram); }

  /** Write the display bytes into a 64 KB RAM array (the inverse of loadRam). */
  storeRam(ram) {
    const b = this.toBytes();
    ram.set(b.subarray(0, FILE_SIZE), FILE_A);
    ram.set(b.subarray(FILE_SIZE), FILE_B);
    return ram;
  }

  /** Compare with another model screen: null when equal, else { count: differing pixels, first: {x, y, got, want} } (got = this). */
  compare(want) {
    let count = 0, first = null;
    for (let i = 0; i < this.px.length; i++) {
      if (this.px[i] !== want.px[i]) {
        if (!first) first = { x: i % SCR_W, y: (i / SCR_W) | 0, got: this.px[i], want: want.px[i] };
        count++;
      }
    }
    return count ? { count, first } : null;
  }

  /**
   * Compare this model (the expected screen) with the display bytes in a RAM array.  Fast path: bytes only; pixels are decoded
   * only when something differs.  null when equal, else { count, first: {x, y, got, want}, bytes } (got = RAM, want = model).
   */
  compareRam(ram) {
    const want = this.toBytes();
    let bad = -1;
    for (let k = 0; k < want.length; k++) {
      if (want[k] !== ram[k < FILE_SIZE ? FILE_A + k : FILE_B + k - FILE_SIZE]) { bad = k; break; }
    }
    if (bad < 0) return null;
    const got = Gfx6Model.fromRam(ram), d = got.compare(this);
    return { count: d.count, first: d.first };
  }
}

export const fmtDiff = (d) => d ? `${d.count} pixels differ, first at (${d.first.x}, ${d.first.y}): got ${d.first.got}, want ${d.first.want}` : 'equal';

// ---------------------------------------------------------------------------------------------------------------------------
// Fonts and generated tables (S2, sections 14.2 and 14.3): the model's own parsers, independent of tools/gen-tables.mjs.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FONT_FIRST = 32, FONT_LAST = 126;

/** Parse src/font.inc text: returns an array of 128 glyphs (arrays of 8 row bytes); codes 0..31 and 127 are blank. */
export function parseFont8(text) {
  const bytes = [];
  text.split('\n').forEach((raw, n) => {
    const line = raw.replace(/\r$/, '').replace(/;.*$/, '').trim();
    if (line === '' || /^[A-Za-z_.][A-Za-z0-9_.]*:$/.test(line)) return;
    const m = line.match(/^DB\s+(.*)$/i);
    if (!m) throw new Error(`font.inc line ${n + 1}: not a DB line: ${raw}`);
    for (const tok of m[1].split(',')) {
      const t = tok.trim();
      if (!/^\$[0-9A-Fa-f]{1,2}$/.test(t)) throw new Error(`font.inc line ${n + 1}: bad byte "${t}"`);
      bytes.push(parseInt(t.slice(1), 16));
    }
  });
  if (bytes.length !== 96 * 8) throw new Error(`font.inc: ${bytes.length} bytes, want 768 (96 glyphs of 8)`);
  const glyph = Array.from({ length: 128 }, () => [0, 0, 0, 0, 0, 0, 0, 0]);
  for (let c = FONT_FIRST; c <= FONT_LAST; c++) glyph[c] = bytes.slice((c - 32) * 8, (c - 32) * 8 + 8);
  return glyph;
}

/**
 * Parse fonts/prop6.txt text (14.3): returns { W: Uint8Array(256) advance widths, I: Uint8Array(256) ink widths,
 * rows: array of 128 (null, or the 8 row bytes, bit 7 = leftmost column) }.  Throws on anything malformed.
 */
export function parseProp6(text) {
  const rows = new Array(128).fill(null), W = new Uint8Array(256), I = new Uint8Array(256);
  let cur = null;                                         // { code, lines: [], at }
  const finish = () => {
    if (!cur) return;
    const where = `glyph ${cur.code} (line ${cur.at})`;
    if (cur.lines.length !== 8) throw new Error(`${where}: ${cur.lines.length} rows, want exactly 8`);
    const L = cur.lines[0].length;
    if (L < 1 || L > 16) throw new Error(`${where}: width ${L}, want 1..16`);
    const bytes = [];
    let ink = 0;
    for (const r of cur.lines) {
      if (r.length !== L) throw new Error(`${where}: rows of different lengths (${r.length} and ${L})`);
      let b = 0;
      for (let j = 0; j < L; j++) {
        if (r[j] !== '#') continue;
        if (j > 7) throw new Error(`${where}: ink in column ${j}, only columns 0..7 are allowed`);
        b |= 0x80 >> j;
        if (j + 1 > ink) ink = j + 1;
      }
      bytes.push(b);
    }
    rows[cur.code] = bytes; W[cur.code] = L; I[cur.code] = ink;
    cur = null;
  };
  text.split('\n').forEach((raw, n) => {
    const line = raw.replace(/\n$/, '');
    if (line.trim() === '' || line.trimStart().startsWith(';')) return;
    if (line[0] === '=') {
      finish();
      const m = line.match(/^=\s*(\d+)(?: .*)?$/);
      if (!m) throw new Error(`line ${n + 1}: bad glyph header: ${JSON.stringify(line)}`);
      const code = Number(m[1]);
      if (code < FONT_FIRST || code > FONT_LAST) throw new Error(`line ${n + 1}: code ${code} outside 32..126`);
      if (rows[code]) throw new Error(`line ${n + 1}: code ${code} appears twice`);
      cur = { code, lines: [], at: n + 1 };
      rows[code] = [];                                    // placeholder so a repeat is caught before finish()
      return;
    }
    if (!cur) throw new Error(`line ${n + 1}: a row before any glyph header: ${JSON.stringify(line)}`);
    if (!/^[.#]+$/.test(line)) throw new Error(`line ${n + 1}: a row may only hold '.' and '#': ${JSON.stringify(line)}`);
    cur.lines.push(line);
  });
  finish();
  for (let c = FONT_FIRST; c <= FONT_LAST; c++) if (!rows[c] || !rows[c].length) throw new Error(`code ${c} is missing`);
  return { W, I, rows };
}

let FONTS = null;
/** The two fonts as parsed from the files (cached): { glyph8, prop6 }. */
export function fonts() {
  if (!FONTS) FONTS = {
    glyph8: parseFont8(readFileSync(join(ROOT, 'src/font.inc'), 'utf8')),
    prop6: parseProp6(readFileSync(join(ROOT, 'fonts/prop6.txt'), 'utf8')),
  };
  return FONTS;
}

/** Address of SHR[p][v] / SHL[p][v] (14.2): the pages are interleaved, SHR + 512 p + v and SHL + 512 p + v (SHL = SHR + 256). */
export const shAddr = (base, p, v) => base + 512 * p + v;
/**
 * The expected generated tables (14.2) as byte arrays: PROP6_W (256), PROP6_I (256), FONTP (2048), SHR (2048), SHL (2048).
 * SHR and SHL are logical arrays indexed 256 p + v; their addresses are shAddr(S.SHR, p, v) and shAddr(S.SHL, p, v).
 */
export function expectedTables() {
  const F = fonts(), FONTP = new Uint8Array(8 * 256), SHR = new Uint8Array(8 * 256), SHL = new Uint8Array(8 * 256);
  for (let k = 0; k < 8; k++) for (let c = 0; c < 128; c++) {
    FONTP[256 * k + c] = F.prop6.rows[c] ? F.prop6.rows[c][k] : 0;
    FONTP[256 * k + 128 + c] = F.glyph8[c][k];
  }
  for (let p = 0; p < 8; p++) for (let v = 0; v < 256; v++) {
    SHR[256 * p + v] = v >> p;
    SHL[256 * p + v] = p === 0 ? 0 : (v << (8 - p)) & 0xFF;
  }
  return { PROP6_W: F.prop6.W, PROP6_I: F.prop6.I, FONTP, SHR, SHL };
}

/** The sample paragraph of 14.6 (verbatim) and the greedy word wrap the bound measurement uses. */
export const PARAGRAPH = 'The quick brown fox jumps over the lazy dog. Mode 6 gives the desktop 512 pixels across, so a proportional font fits about eighty characters on a line. Each glyph is shifted into place through byte tables and clipped to its window. Menus, title bars and dialogs all use it: (1) open, (2) scroll, [3] close; "quotes", \'apostrophes\' & 100% of the time {braces} <angles> @home #tags $5 ~ok? Yes!';
/** Greedy wrap: words joined by one space; a line is never empty (a word wider than the limit stands alone). Returns strings. */
export function wrapGreedy(text, limit = 500) {
  const W = fonts().prop6.W, width = (s) => { let t = 0; for (let i = 0; i < s.length; i++) t += W[s.charCodeAt(i)]; return t; };
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line === '') line = word;
    else if (width(line + ' ' + word) <= limit) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line !== '') lines.push(line);
  return lines;
}

// ---------------------------------------------------------------------------------------------------------------------------
// S4 (section 16): the pointer, drawn by the frame interrupt, and the shield.  Written from 16.2 and 16.4.  Readings:
//  S4a. A byte rectangle is { c0, c1, y0, y1 }, all INCLUSIVE (byte columns c0..c1, pixel rows y0..y1); null is "empty".
//  S4b. The shield's byte rectangle clamps (x, y, w, h) to the screen as G_SETCLIP does (x0 = max(x, 0), x1 = min(x + w, 512), ...);
//       empty (null) when w <= 0, h <= 0 or a range is empty.  Arguments are wrapped through s16() like every GA word.
//  S4c. P_INIT / P_MOVE clamp each coordinate: clamp(s16(v), 0, 511) and clamp(s16(v), 0, 191).
//  S4d. The model keeps TWO things: `scr`, a Gfx6Model holding the screen WITHOUT the pointer (what shielded drawing made of it;
//       tests draw into it), and the pointer state.  display() is "the screen with the pointer image at D" (16.4), a fresh
//       Gfx6Model with the whole-screen clip; the real display bytes are compared with it.  The model's draw ops never see the
//       pointer: a draw outside the shield rule (16.3 "How to use the shield") is not modelled.
//  S4e. Interrupts: the model has no notion of an interrupt.  16.4 says the display after "the routine, then P_ISR" is what the
//       model gives however the frame ISR fell, so a test injecting an interrupt compares with `routine; isr()` only.
//  S4f. unknown(): after a script batch the drawn state D is not known (ISRs ran at uncontrolled moments); D := null with the screen
//       known is the state from which the next isr() gives "screen + pointer at the position", which is all 16.4 promises.

/** Clamp a pointer position (S4c): [x, y] each clamped to 0..511 / 0..191 after the s16() wrap. */
export const clampPos = (x, y) => [Math.min(Math.max(s16(x), 0), SCR_W - 1), Math.min(Math.max(s16(y), 0), SCR_H - 1)];

/** The pointer's byte rectangle at (px, py) (16.2): byte columns c0 = px >> 3 .. min(c0 + 2, 63), rows py .. min(py + 15, 191). */
export function pointerRect(px, py) {
  const c0 = px >> 3;
  return { c0, c1: Math.min(c0 + 2, 63), y0: py, y1: Math.min(py + 15, SCR_H - 1) };
}

/** The shield's byte rectangle of (x, y, w, h) (16.2): clamped as G_SETCLIP does; null when empty. */
export function shieldRect(x, y, w, h) {
  x = s16(x); y = s16(y); w = s16(w); h = s16(h);
  if (w <= 0 || h <= 0) return null;
  const ax = Math.max(x, 0), bx = Math.min(x + w, SCR_W), ay = Math.max(y, 0), by = Math.min(y + h, SCR_H);
  if (ax >= bx || ay >= by) return null;
  return { c0: ax >> 3, c1: (bx - 1) >> 3, y0: ay, y1: by - 1 };
}

/** Two byte rectangles meet when they share a (byte column, row); an empty one (null) meets nothing (16.2). */
export const meets = (a, b) => !!a && !!b && a.c0 <= b.c1 && b.c0 <= a.c1 && a.y0 <= b.y1 && b.y0 <= a.y1;

/** The set of (byte column, row) cells of a list of byte rectangles, as a Uint8Array(64 * 192) (1 = in the union). */
export function rectUnion(rects) {
  const v = new Uint8Array(64 * SCR_H);
  for (const r of rects) if (r) for (let y = r.y0; y <= r.y1; y++) for (let c = r.c0; c <= r.c1; c++) v[y * 64 + c] = 1;
  return v;
}

/** Build a 16 x 16 pointer bitmap in G_BLIT's pair format (64 bytes) from 16 strings of 16 characters: '#' ink (mask 0, image 1),
 *  'o' outline in paper (mask 0, image 0), anything else transparent (mask 1, image 0). */
export function arrowFromArt(art) {
  const out = new Uint8Array(64);
  for (let k = 0; k < 16; k++) for (let b = 0; b < 2; b++) {
    let mk = 0, im = 0;
    for (let j = 0; j < 8; j++) {
      const ch = art[k][8 * b + j] ?? '.', bit = 0x80 >> j;
      if (ch === '#') im |= bit; else if (ch !== 'o') mk |= bit;
    }
    out[2 * (2 * k + b)] = mk; out[2 * (2 * k + b) + 1] = im;
  }
  return out;
}
/** An arrow for the model's own self-test and for stand-ins (the cartridge's own P_ARROW is read from the image). */
export const TEST_ARROW = arrowFromArt([
  'o...............', 'oo..............', 'o#o.............', 'o##o............', 'o###o...........', 'o####o..........', 'o#####o.........', 'o######o........',
  'o#######o.......', 'o########o......', 'o#####ooooo.....', 'o##o##o.........', 'o#o o##o........', 'oo  o##o........', 'o    o##o.......', '      oo........',
]);

/**
 * The S4 pointer model (16.4) over a pointer-free screen `scr` (a Gfx6Model).  `arrow`: the 64 bytes of P_ARROW.
 * State: pos {x, y}; on; S (shield byte rectangle or null); D (drawn position {x, y} or null).
 */
export class PointerModel {
  constructor(scr, arrow) {
    if (arrow.length !== 64) throw new RangeError('P_ARROW must be 64 bytes');
    this.scr = scr; this.arrow = Uint8Array.from(arrow);
    this.on = false; this.pos = { x: 0, y: 0 }; this.S = null; this.D = null;
    this.calls = 0;                    // number of P_MOVE / P_SHIELD / P_UNSHIELD / P_INIT calls since the last isr() (the "skip" test)
  }
  /** A copy with its own screen (for "what would this give" questions). */
  clone() {
    const c = new PointerModel(new Gfx6Model(), this.arrow);
    c.scr.px.set(this.scr.px); c.scr.op = this.scr.op; c.scr.glh = this.scr.glh; c.scr.clip = { ...this.scr.clip };
    c.on = this.on; c.pos = { ...this.pos }; c.S = this.S && { ...this.S }; c.D = this.D && { ...this.D }; c.calls = this.calls;
    return c;
  }
  /** P_INIT(x, y): position = clamped; on; no shield; nothing drawn. */
  init(x, y) { const [cx, cy] = clampPos(x, y); this.pos = { x: cx, y: cy }; this.on = true; this.S = null; this.D = null; this.calls++; }
  /** P_MOVE(x, y). */
  move(x, y) { const [cx, cy] = clampPos(x, y); this.pos = { x: cx, y: cy }; this.calls++; }
  /** P_SHIELD(x, y, w, h): replaces any shield; erases the drawn pointer at once when its byte rectangle meets the shield's. */
  shield(x, y, w, h) {
    this.S = shieldRect(x, y, w, h); this.calls++;
    if (this.D && meets(pointerRect(this.D.x, this.D.y), this.S)) this.D = null;
  }
  /** P_UNSHIELD. */
  unshield() { this.S = null; this.calls++; }
  /** Would the pointer be visible now (on, and its byte rectangle at the position does not meet the shield)? */
  visible() { return this.on && !meets(pointerRect(this.pos.x, this.pos.y), this.S); }
  /** P_ISR (16.4).  Returns what it did: 'none' (nothing drawn or erased), 'erase', 'draw' or 'move' (erase + draw). */
  isr() {
    this.calls = 0;
    if (!this.on) return 'none';
    const vis = this.visible();
    let did = 'none';
    if (this.D && (!vis || this.D.x !== this.pos.x || this.D.y !== this.pos.y)) { this.D = null; did = 'erase'; }
    if (vis && !this.D) { this.D = { ...this.pos }; did = did === 'erase' ? 'move' : 'draw'; }
    return did;
  }
  /** S4f: forget where the pointer is drawn (the screen is known, the pointer is not). */
  unknown() { this.D = null; }
  /** The display this state implies (16.4): the screen with the pointer image at D, a fresh model with the whole-screen clip. */
  display() {
    const d = new Gfx6Model();
    d.px.set(this.scr.px);
    if (this.D) d.blit(this.D.x, this.D.y, 16, 16, this.arrow);
    return d;
  }
  /** Compare the display bytes in a RAM array with display(): null when equal, else { count, first }. */
  compareRam(ram) { return this.display().compareRam(ram); }
  /** The display bytes this state implies (12,288, file A then file B). */
  displayBytes() { return this.display().toBytes(); }
  /** The byte rectangles of everything the state may touch: the pointer at the position and at D. */
  rects() { return [pointerRect(this.pos.x, this.pos.y), this.D && pointerRect(this.D.x, this.D.y)].filter(Boolean); }
}

// The 12,288 display bytes of a 64 KB RAM array equal `want` (displayBytes())?  null when equal, else the first difference.
export function compareBytes(ram, want) {
  for (let k = 0; k < want.length; k++) {
    const a = k < FILE_SIZE ? FILE_A + k : FILE_B + k - FILE_SIZE;
    if (ram[a] !== want[k]) return { index: k, addr: a, got: ram[a], want: want[k] };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Self-test:  node tests/gfx6-model.mjs
async function selfTest() {
  const { checks } = await import('./lib.mjs');
  const C = checks('gfx6-model self-test');
  const hex = (v, n = 4) => '$' + v.toString(16).toUpperCase().padStart(n, '0');

  // G_ADDR, hand-worked.
  const cases = [
    [0, 0, 0x4000, 0x80], [8, 0, 0x6000, 0x80], [16, 0, 0x4001, 0x80], [511, 191, 0x77FF, 0x01], [0, 1, 0x4100, 0x80],
    [0, 8, 0x4020, 0x80], [0, 64, 0x4800, 0x80], [7, 0, 0x4000, 0x01], [24, 0, 0x6001, 0x80], [255, 0, 0x600F, 0x01],
    [256, 0, 0x4010, 0x80], [503, 0, 0x401F, 0x01], [504, 0, 0x601F, 0x80], [0, 63, 0x47E0, 0x80], [0, 128, 0x5000, 0x80],
    [0, 191, 0x57E0, 0x80], [13, 100, 0x6C80, 0x04],
  ];
  let bad = '';
  for (const [x, y, hl, mask] of cases) {
    const a = addr(x, y);
    if (a.hl !== hl || a.mask !== mask) bad += ` (${x},${y}): ${hex(a.hl)}/${hex(a.mask, 2)} want ${hex(hl)}/${hex(mask, 2)};`;
  }
  C.check('G_ADDR hand-worked pixels', !bad, bad || `${cases.length} pixels`);

  // ROWTAB against the (third, character row, scan line) construction, and every row distinct.
  bad = '';
  const seen = new Set();
  for (let y = 0; y < SCR_H; y++) {
    const t = y >> 6, r = (y >> 3) & 7, s = y & 7, want = 0x4000 + 0x800 * t + 0x20 * r + 0x100 * s;
    if (ROWTAB[y] !== want) bad += ` y=${y}: ${hex(ROWTAB[y])} want ${hex(want)};`;
    seen.add(ROWTAB[y]);
  }
  C.check('ROWTAB equals the Spectrum row construction, 192 distinct rows', !bad && seen.size === 192, bad);
  C.check('LMASK / RMASK', LMASK.join() === '255,127,63,31,15,7,3,1' && RMASK.join() === '128,192,224,240,248,252,254,255',
    `${LMASK.join(',')} / ${RMASK.join(',')}`);

  // Every pixel -> exactly one display byte and one bit, all distinct (a bijection onto the 98,304 bits), via loadRam.
  {
    const ram = new Uint8Array(65536), hit = new Uint8Array(0x8000);
    let ok = true, why = '';
    for (let y = 0; y < SCR_H && ok; y++) for (let x = 0; x < SCR_W; x++) {
      const a = addr(x, y), inFile = (a.hl >= 0x4000 && a.hl < 0x5800) || (a.hl >= 0x6000 && a.hl < 0x7800);
      if (!inFile || (hit[a.hl] & a.mask)) { ok = false; why = `(${x},${y}) -> ${hex(a.hl)}/${hex(a.mask, 2)}`; break; }
      hit[a.hl] |= a.mask;
    }
    C.check('G_ADDR is a bijection onto the 12,288 display bytes', ok, why || '98,304 pixels');
    ok = true;
    const rng = (() => { let s = 12345; return () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296; })();
    for (let n = 0; n < 400 && ok; n++) {
      const x = n < 200 ? (n * 5 + 1) % 512 : (rng() * 512) | 0, y = n < 200 ? (n * 7) % 192 : (rng() * 192) | 0;
      ram.fill(0); const a = addr(x, y); ram[a.hl] = a.mask;
      const m = Gfx6Model.fromRam(ram);
      if (m.count() !== 1 || !m.get(x, y)) { ok = false; why = `pixel (${x}, ${y})`; }
    }
    C.check('a byte written at G_ADDR(x, y) with its mask decodes to exactly pixel (x, y)', ok, why);
  }

  // Screen layout: toBytes / loadRam / storeRam round trip, file order.
  {
    const m = new Gfx6Model(); m.set(0, 0, 1); m.set(8, 0, 1); m.set(511, 191, 1);
    const b = m.toBytes();
    C.check('toBytes: (0,0) -> file A byte 0, (8,0) -> file B byte 0, (511,191) -> file B last byte',
      b[0] === 0x80 && b[6144] === 0x80 && b[12287] === 0x01 && b.reduce((s, v) => s + (v ? 1 : 0), 0) === 3);
    const ram = new Uint8Array(65536);
    for (let i = 0; i < 65536; i++) ram[i] = (i * 2654435761 >>> 24) & 0xFF;
    const copy = ram.slice();
    const m2 = Gfx6Model.fromRam(ram), ram2 = new Uint8Array(65536); m2.storeRam(ram2);
    let same = true;
    for (let a = 0x4000; a < 0x5800; a++) if (ram2[a] !== copy[a]) same = false;
    for (let a = 0x6000; a < 0x7800; a++) if (ram2[a] !== copy[a]) same = false;
    C.check('fromRam -> storeRam reproduces the 12,288 display bytes; compareRam agrees', same && m2.compareRam(copy) === null);
    const copy2 = copy.slice(); copy2[0x601F] ^= 0x10;
    const d = m2.compareRam(copy2);
    C.check('compareRam reports the count and the first differing pixel',
      d && d.count === 1 && d.first.x === 8 * 63 + 3 && d.first.y === 0, fmtDiff(d));
  }

  // G_SETCLIP.
  {
    const m = new Gfx6Model(), eq = (a, b) => a.x0 === b[0] && a.x1 === b[1] && a.y0 === b[2] && a.y1 === b[3];
    C.check('G_INIT: op SET, clip (0, 512, 0, 192)', m.op === OP_SET && eq(m.clip, [0, 512, 0, 192]));
    m.setClip(-10, -10, 20, 20); const a1 = eq(m.clip, [0, 10, 0, 10]);
    m.setClip(500, 180, 100, 100); const a2 = eq(m.clip, [500, 512, 180, 192]);
    m.setClip(10, 10, 5, 5); const a3 = eq(m.clip, [10, 15, 10, 15]);
    m.setClip(-3000, -3000, 6000, 6000); const a4 = eq(m.clip, [0, 512, 0, 192]);
    C.check('G_SETCLIP intersects with the screen', a1 && a2 && a3 && a4);
    const empties = [[10, 10, 0, 5], [10, 10, 5, 0], [10, 10, -5, 5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5]];
    let ok = true;
    for (const e of empties) { m.setClip(...e); if (!m.clipEmpty()) ok = false; m.fill(0, 0, 512, 192); }
    C.check('G_SETCLIP: empty rectangles / off-screen rectangles give an empty clip that draws nothing', ok && m.count() === 0);
    m.setClip(10, 10, 1, 1); m.fill(0, 0, 512, 192);
    C.check('clip is half-open: (10, 10, 1, 1) lets exactly pixel (10, 10) through', m.count() === 1 && m.get(10, 10) === 1);
    m.init(); C.check('G_INIT resets the clip', eq(m.clip, [0, 512, 0, 192]));
    C.check('s16 wraps like a GA word', s16(40000) === -25536 && s16(-1) === -1 && s16(0xFFFF) === -1 && s16(16383) === 16383);
  }

  // G_FILL.
  {
    const m = new Gfx6Model();
    m.fill(5, 3, 10, 4);
    let ok = m.count() === 40 && m.get(5, 3) && m.get(14, 6) && !m.get(15, 6) && !m.get(14, 7) && !m.get(4, 3) && !m.get(5, 2);
    C.check('G_FILL 10 x 4 at (5, 3): 40 pixels, exact corners', ok, `${m.count()}`);
    m.cls();
    m.fill(-5, -5, 10, 10);
    C.check('G_FILL with negative origin: only the 5 x 5 corner', m.count() === 25 && m.get(4, 4) && !m.get(5, 4) && !m.get(4, 5));
    m.cls(); m.fill(500, 180, 100, 100);
    C.check('G_FILL running off the right and bottom edges', m.count() === 12 * 12 && m.get(511, 191));
    m.cls(); m.fill(0, 0, 512, 192);
    C.check('G_FILL whole screen: 98,304 pixels', m.count() === 98304);
    m.setOp(OP_XOR); m.fill(0, 0, 512, 192);
    C.check('XOR over the whole screen after SET: all paper', m.count() === 0);
    m.setOp(OP_SET); m.setClip(8, 0, 8, 2); m.fill(0, 0, 512, 192);
    C.check('G_FILL clipped to (8, 0, 8, 2): 16 pixels', m.count() === 16 && m.get(8, 0) && m.get(15, 1) && !m.get(16, 0) && !m.get(7, 0));
    m.setOp(OP_CLR); m.setClip(0, 0, 512, 192); m.fill(8, 0, 4, 1);
    C.check('CLR clears only inside its rectangle', m.count() === 12 && !m.get(8, 0) && m.get(12, 0));
    m.fill(0, 0, 0, 5); m.fill(0, 0, 5, 0); m.fill(0, 0, -5, 5); m.fill(0, 0, 5, -5);
    C.check('w <= 0 or h <= 0 draws nothing', m.count() === 12);
    const n = new Gfx6Model(); n.hline(10, 2, 5); n.vline(20, 1, 3);
    C.check('hline = fill(x, y, w, 1); vline = fill(x, y, 1, h)', n.count() === 8 && n.get(14, 2) && !n.get(15, 2) && n.get(20, 3) && !n.get(20, 4));
    n.cls(); n.setOp(OP_SET); n.fill(0, 0, 512, 192); n.setClip(1, 1, 2, 2); n.cls();
    C.check('G_CLS ignores clip and op', n.count() === 0);
  }

  // G_FRAME.
  {
    const brute = (m, x, y, w, h) => {                       // independent definition: pixel of the rect on its border
      if (w <= 0 || h <= 0) return;
      const c = m.clip;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
        if (!(xx === x || xx === x + w - 1 || yy === y || yy === y + h - 1)) continue;
        if (xx < c.x0 || xx >= c.x1 || yy < c.y0 || yy >= c.y1) continue;
        if (m.op === OP_SET) m.set(xx, yy, 1); else if (m.op === OP_CLR) m.set(xx, yy, 0); else m.set(xx, yy, m.get(xx, yy) ^ 1);
      }
    };
    const m = new Gfx6Model();
    m.frame(10, 10, 5, 4);
    C.check('G_FRAME 5 x 4: 14 pixels, interior empty', m.count() === 14 && !m.get(12, 11) && !m.get(12, 12) && m.get(10, 10) && m.get(14, 13));
    m.cls(); m.frame(3, 3, 1, 6);
    C.check('G_FRAME w = 1: the thin rectangle, 6 pixels', m.count() === 6 && m.get(3, 3) && m.get(3, 8));
    m.cls(); m.frame(3, 3, 6, 1);
    C.check('G_FRAME h = 1: the thin rectangle, 6 pixels', m.count() === 6);
    m.cls(); m.frame(3, 3, 1, 1);
    C.check('G_FRAME 1 x 1: one pixel', m.count() === 1);
    m.cls(); m.frame(3, 3, 2, 2);
    C.check('G_FRAME 2 x 2: four pixels', m.count() === 4);
    m.cls(); m.frame(3, 3, 0, 5); m.frame(3, 3, 5, 0); m.frame(3, 3, -2, 5); m.frame(3, 3, 5, -2);
    C.check('G_FRAME with w <= 0 or h <= 0: nothing', m.count() === 0);
    m.setOp(OP_XOR);
    for (let i = 0; i < 2; i++) m.frame(10, 10, 5, 4);
    C.check('XOR frame twice: screen unchanged', m.count() === 0);
    m.setOp(OP_SET); m.fill(0, 0, 512, 192); m.setOp(OP_XOR); m.frame(-5, -5, 600, 300); m.frame(-5, -5, 600, 300);
    C.check('XOR frame twice over a full screen, partly off screen: unchanged', m.count() === 98304);
    m.cls(); m.setOp(OP_SET); m.frame(-3, -3, 10, 10);
    C.check('G_FRAME at (-3, -3, 10, 10): only the visible 13 pixels (bottom row x 0..6, right column y 0..5)',
      m.count() === 13 && m.get(0, 6) && m.get(6, 6) && m.get(6, 0) && !m.get(0, 0) && !m.get(0, 5));
    // brute-force comparison over random rectangles, ops and clips (several thousand)
    let s = 987654321; const R = (lo, hi) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return lo + (s >>> 8) % (hi - lo + 1); };
    let ok = true, why = '';
    for (let n = 0; n < 600 && ok; n++) {
      const a = new Gfx6Model(), b = new Gfx6Model();
      for (let i = 0; i < a.px.length; i++) a.px[i] = b.px[i] = R(0, 1);
      const op = R(0, 2); a.setOp(op); b.setOp(op);
      const cl = [R(-30, 60), R(-30, 40), R(0, 120), R(-5, 90)]; a.setClip(...cl); b.setClip(...cl);
      const x = R(-20, 90), y = R(-20, 60), w = R(-3, 60), h = R(-3, 50);
      a.frame(x, y, w, h); brute(b, x, y, w, h);
      const d = a.compare(b);
      if (d) { ok = false; why = `frame(${x},${y},${w},${h}) clip ${cl} op ${op}: ${fmtDiff(d)}`; }
    }
    C.check('G_FRAME equals the brute-force outline definition on 600 random cases', ok, why);
  }

  // Raster check of a frame next to a fill through the byte path: a 3-byte-wide fill at an odd start byte column.
  {
    const m = new Gfx6Model(); m.fill(8, 0, 24, 1);          // byte columns 1, 2, 3 of row 0: $6000, $4001, $6001
    const b = m.toBytes();
    C.check('fill (8, 0, 24, 1) -> bytes $6000, $4001, $6001 = $FF', b[6144] === 0xFF && b[1] === 0xFF && b[6145] === 0xFF && b[0] === 0 &&
      b.reduce((s, v) => s + (v ? 1 : 0), 0) === 3);
    const n = new Gfx6Model(); n.fill(0, 64, 3, 1);
    const bb = n.toBytes();
    C.check('fill (0, 64, 3, 1) -> $4800 = $E0', bb[0x800] === 0xE0 && bb.reduce((s, v) => s + (v ? 1 : 0), 0) === 1);
  }
  // ---- S2: fonts, tables, GLH, text routines ----------------------------------------------------------------------------------
  const J = (a) => JSON.stringify(Array.from(a));
  const F = fonts();
  {
    C.check('font.inc: A (65) and g (103) as in the file, "!" (33), blank 0..31 and 127',
      J(F.glyph8[65]) === J([0x20, 0x50, 0x88, 0x88, 0xF8, 0x88, 0x88, 0]) && J(F.glyph8[103]) === J([0, 0, 0x78, 0x88, 0x88, 0x78, 0x08, 0x70]) &&
      J(F.glyph8[33]) === J([0x20, 0x20, 0x20, 0x20, 0x20, 0, 0x20, 0]) && J(F.glyph8[126]) === J([0, 0, 0x40, 0xA8, 0x10, 0, 0, 0]) &&
      F.glyph8[127].every((v) => !v) && F.glyph8.slice(0, 32).every((g) => g.every((v) => !v)) && F.glyph8.length === 128);
    const P = F.prop6;
    C.check('prop6: "A" = rows 00 30 78 CC FC CC CC 00, advance 7, ink 6',
      J(P.rows[65]) === J([0, 0x30, 0x78, 0xCC, 0xFC, 0xCC, 0xCC, 0]) && P.W[65] === 7 && P.I[65] === 6);
    C.check('prop6: "W" = 00 C6 C6 D6 FE EE C6 00, advance 8, ink 7', J(P.rows[87]) === J([0, 0xC6, 0xC6, 0xD6, 0xFE, 0xEE, 0xC6, 0]) && P.W[87] === 8 && P.I[87] === 7);
    C.check('prop6: "g" = 00 00 7C CC CC 7C 0C 78, advance 7, ink 6', J(P.rows[103]) === J([0, 0, 0x7C, 0xCC, 0xCC, 0x7C, 0x0C, 0x78]) && P.W[103] === 7 && P.I[103] === 6);
    C.check('prop6: "1" ink 5 advance 7; "!" = 00 C0 C0 C0 C0 00 C0 00 advance 3 ink 2; space advance 4 ink 0',
      P.W[49] === 7 && P.I[49] === 5 && J(P.rows[33]) === J([0, 0xC0, 0xC0, 0xC0, 0xC0, 0, 0xC0, 0]) && P.W[33] === 3 && P.I[33] === 2 &&
      P.W[32] === 4 && P.I[32] === 0 && P.rows[32].every((v) => !v));
    let ok = true;
    for (let c = 0; c < 256; c++) if ((c < 32 || c > 126) && (P.W[c] !== 0 || P.I[c] !== 0 || (c < 128 && P.rows[c]))) ok = false;
    for (let c = 32; c <= 126; c++) if (P.W[c] < 1 || P.W[c] > 16 || P.I[c] > 8 || P.I[c] > P.W[c]) ok = false;
    C.check('prop6: codes outside 32..126 have no glyph (width 0, ink 0); every glyph has width 1..16 and ink <= min(8, width)', ok);
  }
  {
    // The parser rejects malformed input: start from a valid generated file and break it one way at a time.
    const block = (code, rows) => `= ${code} ${String.fromCharCode(code)}\n${rows.join('\n')}\n\n`;
    const good = (code) => block(code, ['....', '#...', '##..', '#...', '#...', '#...', '#...', '....']);
    const all = (skip = -1, extra = '') => {
      let t = '; comment\n\n';
      for (let c = 32; c <= 126; c++) if (c !== skip) t += good(c);
      return t + extra;
    };
    const rejects = (name, text) => {
      let threw = false, msg = '';
      try { parseProp6(text); } catch (e) { threw = true; msg = e.message; }
      C.check(`parseProp6 rejects ${name}`, threw, msg);
    };
    let t = null, err = '';
    try { t = parseProp6(all()); } catch (e) { err = e.message; }
    C.check('parseProp6 accepts a valid file (comments, blank lines)', t && t.W[33] === 4 && t.I[33] === 2 && J(t.rows[65]) === J([0, 0x80, 0xC0, 0x80, 0x80, 0x80, 0x80, 0]), err);
    rejects('a missing code', all(77));
    rejects('a repeated code', all(-1, good(65)));
    rejects('code 31', all(-1, good(31)));
    rejects('code 127', all(-1, good(127)));
    rejects('seven rows', all(66).replace('', '') + block(66, ['....', '#...', '##..', '#...', '#...', '#...', '....']));
    rejects('nine rows', all(66) + block(66, ['....', '#...', '##..', '#...', '#...', '#...', '#...', '....', '....']));
    rejects('rows of different lengths', all(66) + block(66, ['....', '#...', '##..', '#...', '#..', '#...', '#...', '....']));
    rejects('width 17', all(66) + block(66, Array(8).fill('.'.repeat(17))));
    rejects('ink in column 8', all(66) + block(66, ['.'.repeat(10), '........#.', ...Array(6).fill('.'.repeat(10))]));
    rejects('a bad row character', all(66) + block(66, ['....', '#...', '##..', '#..x', '#...', '#...', '#...', '....']));
    rejects('a trailing blank in a row', all(66) + block(66, ['....', '#... ', '##..', '#...', '#...', '#...', '#...', '....']));
    rejects('a row before any header', '....\n' + all());
    rejects('a non-numeric header', all(66) + '= B\n' + good(66).split('\n').slice(1).join('\n'));
    rejects('a header "= 6x"', all(66) + '= 6x\n' + good(66).split('\n').slice(1).join('\n'));
    rejects('an empty glyph (no rows)', all(66) + '= 66 B\n\n');
    let w9 = null; try { w9 = parseProp6(all(66) + block(66, ['.'.repeat(16), '#'.repeat(1) + '.'.repeat(15), ...Array(6).fill('.'.repeat(16))])); } catch { /* */ }
    C.check('parseProp6 accepts width 16 and ink in column 0', w9 && w9.W[66] === 16 && w9.I[66] === 1);
    const eight = all(66) + block(66, ['........', '.......#', ...Array(6).fill('.'.repeat(8))]);
    let w8 = null; try { w8 = parseProp6(eight); } catch { /* */ }
    C.check('parseProp6 accepts ink in column 7 (width 8, ink 8)', w8 && w8.I[66] === 8 && w8.rows[66][1] === 0x01);
    const bad = (txt) => { try { parseFont8(txt); return false; } catch { return true; } };
    const rowsTxt = Array.from({ length: 96 }, () => '    DB $00, $00, $00, $00, $00, $00, $00, $00 ; x').join('\n');
    C.check('parseFont8 accepts 96 glyphs, rejects 95, a bad byte and stray text',
      !bad('LABEL:\n' + rowsTxt) && bad(rowsTxt.split('\n').slice(1).join('\n')) && bad(rowsTxt.replace('$00', '$0G')) && bad(rowsTxt + '\nfoo'));
    let real = true; try { fonts(); } catch (e) { real = false; err = e.message; }
    C.check('the real fonts/prop6.txt and src/font.inc parse', real, err);
  }
  {
    const T = expectedTables(), P = F.prop6;
    C.check('PROP6_W / PROP6_I hand values: W[0]=0 W[13]=0 W[32]=4 W[33]=3 W[65]=7 W[87]=8 W[127]=0 W[200]=0, I[33]=2 I[65]=6 I[32]=0',
      T.PROP6_W.length === 256 && T.PROP6_I.length === 256 && [0, 13, 32, 33, 65, 87, 127, 200].map((c) => T.PROP6_W[c]).join() === '0,0,4,3,7,8,0,0' &&
      T.PROP6_I[33] === 2 && T.PROP6_I[65] === 6 && T.PROP6_I[32] === 0 && T.PROP6_I[200] === 0);
    C.check('FONTP: plane k at 256 k; byte c = PROP6 row k, byte 128 + c = 8x8 row k (A: plane 1 = $30 / $50, plane 4 = $FC / $F8)',
      T.FONTP.length === 2048 && T.FONTP[256 + 65] === 0x30 && T.FONTP[256 + 128 + 65] === 0x50 && T.FONTP[4 * 256 + 65] === 0xFC && T.FONTP[4 * 256 + 128 + 65] === 0xF8 &&
      T.FONTP[65] === 0 && T.FONTP[7 * 256 + 128 + 103] === 0x70 && T.FONTP[7 * 256 + 103] === 0x78 && T.FONTP[13] === 0 && T.FONTP[128 + 13] === 0 && T.FONTP[127] === 0 && T.FONTP[255] === 0);
    C.check('SHR / SHL: SHR[3][$FF] = $1F, SHR[0][v] = v, SHR[7][$80] = 1, SHL[3][$FF] = $E0, SHL[1][$01] = $80, SHL[0][v] = 0, SHL[7][$03] = 6',
      T.SHR[3 * 256 + 0xFF] === 0x1F && T.SHR[0 * 256 + 0xA5] === 0xA5 && T.SHR[7 * 256 + 0x80] === 1 && T.SHL[3 * 256 + 0xFF] === 0xE0 && T.SHL[256 + 1] === 0x80 &&
      T.SHL[0xA5] === 0 && T.SHL[7 * 256 + 3] === 6 && T.SHR.length === 2048 && T.SHL.length === 2048);
    let ok = true;
    for (let p = 0; p < 8 && ok; p++) for (let v = 0; v < 256; v++) if (((T.SHR[256 * p + v] << 8) | T.SHL[256 * p + v]) !== ((v << 8) >> p)) { ok = false; break; }
    C.check('shAddr: interleaved pages, SHR + 512 p + v, SHL (= SHR + 256) + 512 p + v', shAddr(0x8C00, 3, 0xFF) === 0x8C00 + 1536 + 255 && shAddr(0x8D00, 7, 1) === 0x8D00 + 3584 + 1);
    C.check('SHR (high byte) and SHL (low byte) together are the 16-bit value (v << 8) >> p, for every p and v', ok);
  }
  {
    const m = new Gfx6Model();
    C.check('G_INIT sets GLH = 8', m.glh === 8);
    m.setGlh(15); m.init(); C.check('init() resets GLH to 8 after a change', m.glh === 8);
    m.setGlh(15); m.setClip(0, 0, 512, 192); m.setOp(OP_XOR); C.check('GLH is a setting: setClip / setOp leave it', m.glh === 15);
  }
  // text8
  {
    const m = new Gfx6Model(), q = (...c) => c.map((ch) => (typeof ch === 'string' ? ch.charCodeAt(0) : ch));
    m.text8(2, 1, q('!'));                                   // glyph rows 20 20 20 20 20 00 20 00: bit 5 = x 16 + 2
    let ok = m.count() === 6 && [8, 9, 10, 11, 12, 14].every((y) => m.get(18, y));
    C.check('text8 "!" at cell (2, 1) SET on paper: 6 pixels at x 18, rows 8..12 and 14', ok, `${m.count()}`);
    m.fill(16, 8, 8, 8);                                     // ink the whole cell, then CLR over it
    m.setOp(OP_CLR); m.text8(2, 1, q('!'));
    C.check('text8 CLR writes NOT g: over an inked cell the 6 glyph pixels become paper and the other 58 are ink', m.count() === 58 && !m.get(18, 8) && m.get(19, 8) && m.get(18, 13));
    const n = new Gfx6Model(); n.setOp(OP_CLR); n.text8(0, 0, q('!'));
    C.check('text8 CLR on paper: the cell holds NOT g (58 pixels inked), opaque', n.count() === 58 && !n.get(2, 0) && n.get(3, 0) && n.get(2, 5));
    const o = new Gfx6Model(); o.fill(0, 0, 512, 192); o.setOp(OP_SET); o.text8(0, 0, q(0));
    C.check('text8 SET of a blank glyph (code 0) erases the whole cell (opaque)', o.count() === 98304 - 64 && !o.get(0, 0) && !o.get(7, 7) && o.get(8, 0) && o.get(0, 8));
    const x = new Gfx6Model(); x.setOp(OP_XOR); x.text8(5, 5, q('A', 'g', 0xC1)); const once = x.count(); x.text8(5, 5, q('A', 'g', 0xC1));
    C.check('text8 XOR: "A", "g", code $C1 (= "A") give 16 + 16 + 16 = 48 pixels on paper; XOR again restores', once === 48 && x.count() === 0, `${once}`);
    const a = new Gfx6Model(), b = new Gfx6Model(); a.text8(3, 3, q('A')); b.text8(3, 3, q(0xC1));
    C.check('text8 uses code AND $7F: $C1 draws the glyph of "A"', a.count() > 0 && a.compare(b) === null);
    const c1 = new Gfx6Model(); c1.setClip(8, 8, 16, 8); c1.text8(0, 1, q('#', '#', '#', '#')); // cells at x 0, 8, 16, 24; clip x 8..24, y 8..16
    const cells = [0, 1, 2, 3].map((i) => { let n2 = 0; for (let yy = 8; yy < 16; yy++) for (let xx = 8 * i; xx < 8 * i + 8; xx++) n2 += c1.get(xx, yy); return n2; });
    C.check('text8 draws a cell only if it is wholly inside the clip: clip (8, 8, 16, 8) keeps cells 1 and 2 of 4', !cells[0] && cells[1] > 0 && cells[2] > 0 && !cells[3], cells.join());
    const c2 = new Gfx6Model(); c2.setClip(9, 8, 16, 8); c2.text8(0, 1, q('#', '#', '#', '#'));   // x 9..25: only cell 2 (16..24) is whole
    const c3 = new Gfx6Model(); c3.setClip(8, 9, 16, 8); c3.text8(0, 1, q('#', '#', '#', '#'));   // y 9..17: no cell row is whole
    const c4 = new Gfx6Model(); c4.setClip(8, 8, 16, 7); c4.text8(0, 1, q('#', '#', '#', '#'));   // y 8..15: 7 rows, none whole
    let in2 = 0; for (let yy = 8; yy < 16; yy++) for (let xx = 16; xx < 24; xx++) in2 += c2.get(xx, yy);
    C.check('text8 with a clip not on cell boundaries: x 9..25 keeps only cell 2; y 9..17 and a 7-row clip keep none', c2.count() > 0 && c2.count() === in2 && c3.count() === 0 && c4.count() === 0, `${c2.count()} ${in2} ${c3.count()} ${c4.count()}`);
    const e = new Gfx6Model(); e.setClip(10, 10, 0, 5); e.text8(1, 1, q('A', 'B')); e.text8(0, 0, q('A'));
    C.check('text8 with an empty clip draws nothing; n = 0 draws nothing', e.count() === 0 && (() => { const z = new Gfx6Model(); z.text8(1, 1, []); return z.count() === 0; })());
    const r = new Gfx6Model(); r.text8(62, 23, q('A', 'B', 'C', 'D'));      // cells 62, 63 on screen, 64, 65 off the right edge; row 23 = last row
    let right = 0; for (let yy = 184; yy < 192; yy++) for (let xx = 496; xx < 512; xx++) right += r.get(xx, yy);
    C.check('text8 running off the right edge: only cells 62 and 63 drawn, last cell row 23', r.count() === right && right > 0);
    const neg = new Gfx6Model(); neg.text8(-2, 0, q('A', 'B', 'C', 'D')); neg.text8(0, -1, q('A')); neg.text8(0, 24, q('A'));
    let first2 = 0; for (let yy = 0; yy < 8; yy++) for (let xx = 0; xx < 16; xx++) first2 += neg.get(xx, yy);
    C.check('text8 with a negative column draws only the cells that are on screen (cells -2, -1 skipped); rows -1 and 24 draw nothing', neg.count() > 0 && neg.count() === (() => { let k = 0; for (let xx = 0; xx < 16; xx++) for (let yy = 0; yy < 8; yy++) k += neg.get(xx, yy); return k; })() && first2 > 0);
  }
  // textp
  {
    const q = (...c) => c.map((ch) => (typeof ch === 'string' ? ch.charCodeAt(0) : ch));
    const m = new Gfx6Model(), end = m.textp(10, 5, q('!'));          // rows 1..4 and 6 have ink at columns 0, 1
    let ok = m.count() === 10 && [6, 7, 8, 9, 11].every((y) => m.get(10, y) && m.get(11, y)) && !m.get(12, 6) && !m.get(10, 10);
    C.check('textp "!" at (10, 5): 10 ink pixels (x 10, 11; y 6..9 and 11); pen (13, 5)', ok && end.x === 13 && end.y === 5, `${m.count()} (${end.x}, ${end.y})`);
    const m2 = new Gfx6Model(), e2 = m2.textp(10, 5, q('!', '!'));
    C.check('textp "!!": second glyph at x 13; pen x 16', m2.count() === 20 && m2.get(13, 6) && m2.get(14, 6) && e2.x === 16 && e2.y === 5);
    const m3 = new Gfx6Model(), e3 = m3.textp(10, 5, q('!', 13, '!'));
    C.check('textp code 13: pen back to x = 10 and down GLH 8: the second "!" at (10, 13); pen (13, 13)', m3.count() === 20 && m3.get(10, 14) && m3.get(11, 14) && m3.get(10, 19) && e3.x === 13 && e3.y === 13, `(${e3.x}, ${e3.y})`);
    m3.cls(); m3.setGlh(20); const e3b = m3.textp(10, 5, q('!', 13, '!', 13, 13));
    C.check('textp with GLH 20 and three code 13s: lines 20 apart (second "!" row 1 at y 26), pen x back at the start 10, pen y 5 + 60 = 65', e3b.x === 10 && e3b.y === 65 && m3.get(10, 26), `(${e3b.x}, ${e3b.y})`);
    const m5 = new Gfx6Model(), e5 = m5.textp(10, 5, q(0, 1, 31, 127, 128, 200, 255, 193));
    C.check('textp: codes 0, 1, 31, 127, 128, 193 (= "A" + 128), 200, 255 have no glyph: no ink, pen did not move', m5.count() === 0 && e5.x === 10 && e5.y === 5);
    const m6 = new Gfx6Model(), e6 = m6.textp(0, 0, q(32, 32, 'A'));    // two spaces (4 each), then "A" at x 8
    C.check('textp: a space advances 4 and has no ink; "A" after two spaces starts at x 8 (ink at x 10, 11 in row 1)', m6.count() > 0 && m6.get(10, 1) && m6.get(11, 1) && !m6.get(2, 1) && e6.x === 15);
    const m7 = new Gfx6Model(); m7.setClip(11, 7, 1, 2); m7.textp(10, 5, q('!'));      // clip keeps x 11, y 7..8 only
    C.check('textp pixel clipping: clip (11, 7, 1, 2) keeps exactly the ink at x 11, y 7 and 8', m7.count() === 2 && m7.get(11, 7) && m7.get(11, 8));
    const m8 = new Gfx6Model(); m8.fill(0, 0, 512, 192); m8.setOp(OP_CLR); m8.textp(10, 5, q('!'));
    C.check('textp CLR clears only the ink pixels (no opaque background): 98,304 - 10', m8.count() === 98304 - 10 && !m8.get(10, 6) && m8.get(12, 6));
    m8.setOp(OP_XOR); m8.textp(10, 5, q('!')); m8.textp(10, 5, q('!'));
    C.check('textp XOR twice restores', m8.count() === 98304 - 10);
    const m9 = new Gfx6Model(), e9 = m9.textp(-3, -2, q('!', '!'));     // first glyph x -3,-2 (off), second x 0, 1 visible; rows -1..2 and 4 -> visible rows 0..2 and 4
    C.check('textp with origin (-3, -2): the first "!" is off screen, the second (x 0, 1) shows rows 0..2 and 4: 8 pixels; pen (3, -2)', m9.count() === 8 && m9.get(0, 0) && m9.get(1, 2) && m9.get(0, 4) && !m9.get(0, 3) && e9.x === 3 && e9.y === -2, `${m9.count()}`);
    const m10 = new Gfx6Model(); m10.textp(510, 0, q('!'));
    C.check('textp running off the right edge: "!" at x 510 shows its 10 pixels, at x 511 only the 5 in column 511', m10.count() === 10 && (() => { const t = new Gfx6Model(); t.textp(511, 0, q('!')); return t.count() === 5 && t.get(511, 1); })());
    const m11 = new Gfx6Model(), e11 = m11.textp(5, 5, []);
    C.check('textp with n = 0: nothing drawn, pen (x, y)', m11.count() === 0 && e11.x === 5 && e11.y === 5);
  }
  // textw
  {
    const m = new Gfx6Model(), q = (...c) => c.map((ch) => (typeof ch === 'string' ? ch.charCodeAt(0) : ch));
    C.check('textw: "!!!" = 9; "!!!" CR "!" = 9 (the widest line); CR "!!" = 6; empty = 0; CR CR = 0; "AW" = 15; code 200 adds 0',
      m.textw(q('!', '!', '!')) === 9 && m.textw(q('!', '!', '!', 13, '!')) === 9 && m.textw(q(13, '!', '!')) === 6 && m.textw([]) === 0 && m.textw([13, 13]) === 0 &&
      m.textw(q('A', 'W')) === 15 && m.textw(q('A', 200, 0, 127)) === 7 && m.textw(q('!', 13, '!', '!', '!', '!')) === 12);
  }
  {
    const lines = wrapGreedy(PARAGRAPH, 500), W = fonts().prop6.W, wd = (s) => { let t = 0; for (const ch of s) t += W[ch.charCodeAt(0)]; return t; };
    C.check('PARAGRAPH is 392 characters; greedy wrap at 500 px gives 5 lines, each <= 500 px, joined by one space = the paragraph',
      PARAGRAPH.length === 392 && lines.length === 5 && lines.every((l) => wd(l) <= 500 && l.length > 0) && lines.join(' ') === PARAGRAPH &&
      wd(lines[0] + ' ' + lines[1].split(' ')[0]) > 500, `${lines.map((l) => l.length + '/' + wd(l)).join(' ')}`);
  }
  // ---- S3: line, blit, byte rectangle, scroll ---------------------------------------------------------------------------------
  {
    const LP = (a, b, c, d) => J(new Gfx6Model().linePixels(a, b, c, d));
    const pts = (...p) => J(p.map(([x, y]) => [x, y]));
    // hand-worked: (0,0)-(4,2): dmaj 4, dmin 2: minor offsets floor((4 i + 4) / 8) = 0, 1, 1, 2, 2; the reverse gives the same pixels
    C.check('line (0,0)-(4,2) = (0,0) (1,1) (2,1) (3,2) (4,2); the reverse (4,2)-(0,0) is the same pixels (the start is the end with the smaller x)',
      LP(0, 0, 4, 2) === pts([0, 0], [1, 1], [2, 1], [3, 2], [4, 2]) && LP(4, 2, 0, 0) === LP(0, 0, 4, 2));
    C.check('line (0,0)-(5,2): offsets floor((4 i + 5) / 10) = 0, 0, 1, 1, 2, 2',
      LP(0, 0, 5, 2) === pts([0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]));
    C.check('line, the eight octants (both orders of each pair of ends give the same pixels, listed from the end with the smaller major coordinate)',
      LP(0, 0, 5, 2) === pts([0, 0], [1, 0], [2, 1], [3, 1], [4, 2], [5, 2]) && LP(5, 2, 0, 0) === LP(0, 0, 5, 2) &&
      LP(5, 0, 0, 2) === pts([0, 2], [1, 2], [2, 1], [3, 1], [4, 0], [5, 0]) && LP(0, 2, 5, 0) === LP(5, 0, 0, 2) &&
      LP(0, 0, 2, 5) === pts([0, 0], [0, 1], [1, 2], [1, 3], [2, 4], [2, 5]) && LP(2, 5, 0, 0) === LP(0, 0, 2, 5) &&
      LP(0, 5, 2, 0) === pts([2, 0], [2, 1], [1, 2], [1, 3], [0, 4], [0, 5]) && LP(2, 0, 0, 5) === LP(0, 5, 2, 0));
    C.check('line, ties: dmaj 1 (0,0)-(1,1) -> (1,1); dmaj 2 dmin 1 (0,0)-(2,1) = (0,0) (1,1) (2,1), and (2,1)-(0,0) the same; (0,1)-(2,0) = (0,1) (1,0) (2,0)',
      LP(0, 0, 1, 1) === pts([0, 0], [1, 1]) && LP(0, 0, 2, 1) === pts([0, 0], [1, 1], [2, 1]) && LP(2, 1, 0, 0) === LP(0, 0, 2, 1) &&
      LP(0, 1, 2, 0) === pts([0, 1], [1, 0], [2, 0]) && LP(2, 0, 0, 1) === LP(0, 1, 2, 0));
    C.check('line, |dx| = |dy|: x is the major axis and the line is the exact diagonal, both orders, both slopes',
      LP(0, 0, 3, 3) === pts([0, 0], [1, 1], [2, 2], [3, 3]) && LP(3, 3, 0, 0) === LP(0, 0, 3, 3) &&
      LP(0, 3, 3, 0) === pts([0, 3], [1, 2], [2, 1], [3, 0]) && LP(3, 0, 0, 3) === LP(0, 3, 3, 0));
    C.check('line, dmaj = 0: a single pixel at (x0, y0); horizontal and vertical lines: dmaj + 1 pixels, both ends drawn, either order',
      LP(7, 9, 7, 9) === pts([7, 9]) && LP(3, 2, 3, 6) === pts([3, 2], [3, 3], [3, 4], [3, 5], [3, 6]) && LP(3, 6, 3, 2) === LP(3, 2, 3, 6) &&
      LP(5, 1, 2, 1) === pts([2, 1], [3, 1], [4, 1], [5, 1]) && LP(-5, -5, -5, -5) === pts([-5, -5]));
    // against an independent iterative Bresenham (the ends swapped first so that the major coordinate grows): error starts at floor(dmaj / 2), += dmin per step, the minor axis steps when err >= dmaj
    const bres = (x0, y0, x1, y1) => {
      { const xm0 = Math.abs(x1 - x0) >= Math.abs(y1 - y0); if (xm0 ? x1 < x0 : y1 < y0) { [x0, y0, x1, y1] = [x1, y1, x0, y0]; } }   // start at the smaller major coordinate
      const dx = x1 - x0, dy = y1 - y0, adx = Math.abs(dx), ady = Math.abs(dy), xm = adx >= ady, dmaj = xm ? adx : ady, dmin = xm ? ady : adx;
      const sx = dx < 0 ? -1 : 1, sy = dy < 0 ? -1 : 1, out = [];
      let x = x0, y = y0, err = Math.floor(dmaj / 2);
      out.push([x, y]);
      for (let i = 0; i < dmaj; i++) {
        if (xm) x += sx; else y += sy;
        err += dmin;
        if (err >= dmaj) { err -= dmaj; if (xm) y += sy; else x += sx; }
        out.push([x, y]);
      }
      return out;
    };
    {
      let bad = '', n = 0;
      const mm = new Gfx6Model();
      for (let dx = -20; dx <= 20 && !bad; dx++) for (let dy = -20; dy <= 20; dy++) {
        n++;
        if (J(mm.linePixels(100, 50, 100 + dx, 50 + dy)) !== J(bres(100, 50, 100 + dx, 50 + dy))) { bad = `(100,50)-(${100 + dx},${50 + dy})`; break; }
      }
      C.check('line = iterative Bresenham (error from floor(dmaj / 2)) for all 41 x 41 offsets within 20', !bad, bad || `${n} lines`);
      let s2 = 424242; const R = (lo, hi) => { s2 = (Math.imul(s2, 1664525) + 1013904223) >>> 0; return lo + (s2 >>> 4) % (hi - lo + 1); };
      bad = '';
      for (let k = 0; k < 1500 && !bad; k++) {
        const far = k % 3 === 0, lo = far ? -16384 : -600, hi = far ? 16383 : 700;
        const a = [R(lo, hi), R(lo, hi), R(lo, hi), R(lo, hi)];
        if (far) { a[2] = a[0] + R(-1500, 1500); a[3] = a[1] + R(-1500, 1500); a[2] = Math.max(-16384, Math.min(16383, a[2])); a[3] = Math.max(-16384, Math.min(16383, a[3])); }
        if (LP(...a) !== J(bres(...a))) bad = `(${a})`;
      }
      C.check('line = iterative Bresenham for 1,500 random lines (a third far off screen)', !bad, bad);
      // the closed form with BigInt, spot-checked at random i on lines with the largest products (2 i dmin about 2^31)
      bad = '';
      for (let k = 0; k < 300 && !bad; k++) {
        const x0 = R(-16384, 16383), y0 = R(-16384, 16383), x1 = R(-16384, 16383), y1 = R(-16384, 16383);
        const xm = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
        let sM = BigInt(xm ? x0 : y0), sN = BigInt(xm ? y0 : x0), eM = BigInt(xm ? x1 : y1), eN = BigInt(xm ? y1 : x1);
        if (eM < sM) { [sM, eM] = [eM, sM]; [sN, eN] = [eN, sN]; }
        const dmaj = eM - sM, dmin = eN > sN ? eN - sN : sN - eN, smin = eN < sN ? -1n : 1n;
        const line = mm.linePixels(x0, y0, x1, y1);
        if (line.length !== Number(dmaj) + 1) { bad = `length of (${x0},${y0})-(${x1},${y1})`; break; }
        for (const i of [0, 1, Number(dmaj) >> 1, Number(dmaj) - 1, Number(dmaj), R(0, Number(dmaj))]) {
          if (i < 0) continue;
          const bi = BigInt(i), off = dmaj === 0n ? 0n : (2n * bi * dmin + dmaj) / (2n * dmaj);
          const wx = xm ? sM + bi : sN + smin * off, wy = xm ? sN + smin * off : sM + bi;
          if (BigInt(line[i][0]) !== wx || BigInt(line[i][1]) !== wy) { bad = `P(${i}) of (${x0},${y0})-(${x1},${y1})`; break; }
        }
      }
      C.check('line P(i) = the BigInt closed form on 300 lines across the full -16384..16383 range', !bad, bad);
    }
    {
      const m1 = new Gfx6Model(), m2 = new Gfx6Model();
      m1.line(-16384, -16384, 16383, 16383);
      C.check('line (-16384,-16384)-(16383,16383), clip whole screen: exactly the 192 diagonal pixels (0,0)..(191,191)',
        m1.count() === 192 && m1.get(0, 0) && m1.get(191, 191) && !m1.get(100, 99) && !m1.get(99, 100));
      m2.line(-16384, 0, 16383, 191);
      let ok = m2.count() === 512, why = `${m2.count()} pixels`;
      for (let x = 0; x < 512 && ok; x++) { let n = 0; for (let y = 0; y < 192; y++) n += m2.get(x, y); if (n !== 1) { ok = false; why = `column ${x}: ${n}`; } }
      const i0 = 16384, y0v = Math.floor((2 * i0 * 191 + 32767) / 65534);
      C.check('line (-16384,0)-(16383,191): one pixel in each of the 512 columns, column 0 at y floor((2 * 16384 * 191 + 32767) / 65534)', ok && m2.get(0, y0v), why);
    }
    {
      let s3 = 777; const R = (lo, hi) => { s3 = (Math.imul(s3, 1664525) + 1013904223) >>> 0; return lo + (s3 >>> 5) % (hi - lo + 1); };
      let bad = '';
      for (let k = 0; k < 300 && !bad; k++) {
        const a = [R(-60, 560), R(-40, 240), R(-60, 560), R(-40, 240)], cl = [R(-20, 400), R(-20, 150), R(-3, 300), R(-3, 120)], op = R(0, 2);
        const A = new Gfx6Model(), B = new Gfx6Model();
        for (let i = 0; i < A.px.length; i++) A.px[i] = B.px[i] = R(0, 1);
        A.setOp(op); B.setOp(op); B.setClip(...cl); A.setClip(...cl);
        A.line(...a);
        // independent: apply the line pixel by pixel to a copy, but only where inside cl and the screen
        const c = B.clip;
        for (const [x, y] of bres(...a)) {
          if (x < c.x0 || x >= c.x1 || y < c.y0 || y >= c.y1) continue;
          const i = y * SCR_W + x; B.px[i] = op === 0 ? 1 : op === 1 ? 0 : B.px[i] ^ 1;
        }
        const d = A.compare(B); if (d) bad = `line(${a}) clip ${cl} op ${op}: ${fmtDiff(d)}`;
      }
      C.check('line with a random clip and op = the same pixels, kept only when inside the clip (clipping never moves a pixel), 300 cases', !bad, bad);
      const m = new Gfx6Model(); m.setOp(OP_XOR);
      for (let k = 0; k < 2; k++) m.line(3, 4, 300, 150);
      for (let k = 0; k < 2; k++) m.line(-600, 100, 900, -50);
      m.line(10, 10, 10, 10); m.line(10, 10, 10, 10);
      C.check('XOR line twice (same ends, same order) restores the screen, also for a single pixel and off-screen ends', m.count() === 0);
      m.line(0, 0, 4, 2); m.line(4, 2, 0, 0);
      C.check('XOR (0,0)-(4,2) then (4,2)-(0,0): erased (same pixels either way round)', m.count() === 0, `${m.count()}`);
      let s6 = 31337; const R6 = (lo, hi) => { s6 = (Math.imul(s6, 1664525) + 1013904223) >>> 0; return lo + (s6 >>> 5) % (hi - lo + 1); };
      let bad2 = '';
      for (let k = 0; k < 1500 && !bad2; k++) {
        const x0 = R6(-40, 560), y0 = R6(-40, 240), d = R6(1, 150), t = k % 6;
        const [x1, y1] = [[x0 + R6(-300, 300), y0 + R6(-200, 200)], [x0 + 2 * d, y0 + d], [x0 - 2 * d, y0 + d], [x0 + d, y0 - 2 * d], [x0 + 2 * d + 1, y0 - d], [x0 + d, y0 + d]][t];
        const A = new Gfx6Model(), B = new Gfx6Model(), op = R6(0, 2);
        for (let i = 0; i < A.px.length; i++) A.px[i] = B.px[i] = R6(0, 1);
        A.setOp(op); B.setOp(op); A.line(x0, y0, x1, y1); B.line(x1, y1, x0, y0);
        const dd = A.compare(B); if (dd) bad2 = `(${x0},${y0})-(${x1},${y1}) op ${op}: ${fmtDiff(dd)}`;
        const la = J(A.linePixels(x0, y0, x1, y1).map(String).sort()), lb = J(A.linePixels(x1, y1, x0, y0).map(String).sort());
        if (la !== lb) bad2 = `pixel sets of (${x0},${y0})-(${x1},${y1}) differ`;
      }
      C.check('line A-B and B-A give the same pixels (and the same drawn screen) on 1,500 random lines incl. ties (dmaj = 2 dmin, odd dmaj), all ops', !bad2, bad2);
      const e = new Gfx6Model(); e.setClip(1, 1, 0, 5); e.line(0, 0, 511, 191);
      C.check('line with an empty clip draws nothing', e.count() === 0);
    }
    // blit
    {
      // w = 3, h = 2, wb = 1: row 0 mask $5F image $80, row 1 mask $DF image $A0 (columns 3..7 transparent: mask 1, image 0)
      const d = [0x5F, 0x80, 0xDF, 0xA0];
      const a = new Gfx6Model(); a.fill(0, 0, 20, 20); a.blit(4, 4, 3, 2, d);
      C.check('blit 3 x 2 at (4,4) over ink: (old AND m) OR i leaves exactly one paper pixel, at (6,4) (j = 2, row 0: mask 0, image 0)',
        a.count() === 400 - 1 && !a.get(6, 4) && a.get(4, 4) && a.get(5, 4) && a.get(4, 5) && a.get(5, 5) && a.get(6, 5));
      const b = new Gfx6Model(); b.blit(4, 4, 3, 2, d);
      C.check('blit over paper: the image bits show: (4,4), (4,5), (6,5)', b.count() === 3 && b.get(4, 4) && b.get(4, 5) && b.get(6, 5));
      const c = new Gfx6Model(); c.setOp(OP_XOR); c.blit(4, 4, 3, 2, d); c.setOp(OP_CLR); c.blit(20, 20, 3, 2, d);
      C.check('blit ignores the draw op (XOR and CLR give the same 3 pixels as SET)', c.count() === 6 && c.get(4, 4) && c.get(22, 21));
      const e = new Gfx6Model(); e.setClip(5, 4, 1, 1); e.fill(0, 0, 512, 192); e.setClip(0, 0, 512, 192); e.px.fill(0); e.setClip(5, 5, 1, 1); e.blit(4, 4, 3, 2, d);
      C.check('blit clipped to the single pixel (5,5): (j = 1, k = 1: mask 1, image 0) leaves paper; clip (4,5,1,1): (j = 0, k = 1) shows ink',
        e.count() === 0 && (() => { const t = new Gfx6Model(); t.setClip(4, 5, 1, 1); t.blit(4, 4, 3, 2, d); return t.count() === 1 && t.get(4, 5); })());
      // w = 9, h = 1: two pairs; pair 2 = mask $7F image $80: pixel j = 8 shows ink (mask 0, image 1), padding transparent
      const f = new Gfx6Model(); f.fill(30, 7, 20, 1); f.blit(30, 7, 9, 1, [0xFF, 0x00, 0x7F, 0x80]);
      C.check('blit w = 9 uses the second pair for j = 8: over an inked row, mask 0 / image 1 keeps the ink; with mask $FF image $00 pair 1 nothing changes',
        f.count() === 20);
      const g = new Gfx6Model(); g.fill(30, 7, 20, 1); g.blit(30, 7, 9, 1, [0xFF, 0x00, 0x00, 0x00]);   // pair 2: mask 0, image 0, but only j = 8 is inside w
      C.check('blit w = 9: pair 2 mask bit 7 = 0 clears j = 8 (x 38) only; its other bits are padding and never drawn', g.count() === 19 && !g.get(38, 7) && g.get(39, 7));
      const h = new Gfx6Model(), d2 = [0xFF, 0x80, 0xFF, 0x00, 0xFF, 0x00, 0xFF, 0x01];   // w = 16 h = 2: row k at data + 4 k
      h.blit(0, 0, 16, 2, d2);
      C.check('blit w = 16, h = 2: row 1 starts at data + 4 (wb = 2 pairs a row): pixels (0,0) and (15,1)', h.count() === 2 && h.get(0, 0) && h.get(15, 1));
      const n = new Gfx6Model(); n.blit(0, 0, 0, 5, d); n.blit(0, 0, 5, 0, d); n.blit(0, 0, -3, 5, d); n.blit(0, 0, 5, -3, d);
      let threw = false; try { n.blit(0, 0, 33, 1, d); } catch { threw = true; }
      C.check('blit with w <= 0 or h <= 0 draws nothing; w = 33 is rejected by the model', n.count() === 0 && threw);
      const o = new Gfx6Model(); o.blit(-2, -1, 3, 2, d);
      C.check('blit at (-2,-1): only bitmap pixel (2, 1) (screen (0, 0)) is inside: mask 0 image 1 -> ink', o.count() === 1 && o.get(0, 0));
    }
    // preshift
    {
      const m = new Gfx6Model(), d = [0x5F, 0x80, 0xDF, 0xA0];            // w = 3, h = 2: wb 1, ws 2; padding transparent
      const set = m.preshift(3, 2, d), hx = (a) => Array.from(a).map((v) => v.toString(16).padStart(2, '0')).join(' ');
      C.check('preshift 3 x 2: 16 h ws = 64 bytes; copy 0 = the source pairs then the fill pair ($FF, 0): 5F 80 FF 00 DF A0 FF 00',
        set.length === 64 && hx(set.subarray(0, 8)) === '5f 80 ff 00 df a0 ff 00', hx(set.subarray(0, 8)));
      C.check('preshift 3 x 2, copy p = 3 (at 2 p h ws = 24): row 0 = EB 10 FF 00, row 1 = FB 14 FF 00 (hand-worked: mask $5F -> (FF << 5) | (5F >> 3) = EB; image 80 >> 3 = 10; pair 1 mask (5F << 5) | (FF >> 3) = FF, image 00)',
        hx(set.subarray(24, 32)) === 'eb 10 ff 00 fb 14 ff 00', hx(set.subarray(24, 32)));
      const w9 = m.preshift(9, 1, [0xFF, 0x00, 0x7F, 0x80]);
      C.check('preshift 9 x 1 (wb 2, ws 3): 48 bytes; copy 4 at offset 2 p h ws = 24: FF 00 F7 08 FF 00 (fill M(-1) = M(wb) = $FF, I = 0 at both edges)',
        w9.length === 48 && hx(w9.subarray(24, 30)) === 'ff 00 f7 08 ff 00' && hx(w9.subarray(0, 6)) === 'ff 00 7f 80 ff 00', hx(w9.subarray(24, 30)));
      C.check('preshift: copy 0 always ends each row with the pair ($FF, 0); copy 7 pair 0 = M(-1) << 1 | M(0) >> 7',
        (() => { const p = m.preshift(16, 2, Array.from({ length: 8 }, (_, i) => (i * 37 + 5) & 255)); const src = Array.from({ length: 8 }, (_, i) => (i * 37 + 5) & 255);
          return p[2 * 2 * 3 - 2] === 0xFF && p[2 * 2 * 3 - 1] === 0 && p[2 * 7 * 2 * 3] === (((0xFF << 1) | (src[0] >> 7)) & 255) && p[2 * 7 * 2 * 3 + 1] === (src[1] >> 7); })());
      C.check('preshift: w <= 0 or h <= 0 gives an empty set; w or h above 32 is rejected by the model',
        m.preshift(0, 5, d).length === 0 && m.preshift(5, 0, d).length === 0 && m.preshift(-3, 5, d).length === 0 && m.preshift(5, -1, d).length === 0 &&
        (() => { try { m.preshift(33, 1, d); } catch { return true; } return false; })());
      C.check('preshift sizes: 16 x 16 = 768 bytes, 32 x 32 = 2,560, 1 x 1 = 32, 9 x 3 = 144',
        m.preshift(16, 16, new Array(64).fill(0xFF).map((v, i) => (i & 1 ? 0 : v))).length === 768 && m.preshift(32, 32, new Array(256).fill(0)).length === 2560 &&
        m.preshift(1, 1, [0x7F, 0x80]).length === 32 && m.preshift(9, 3, new Array(12).fill(0)).length === 144);
      // the format against an independent per-pixel reading: blit through the set = blit from the source, every x (all 8 shifts, negative x), random data
      let s7 = 2024; const R = (lo, hi) => { s7 = (Math.imul(s7, 1664525) + 1013904223) >>> 0; return lo + (s7 >>> 6) % (hi - lo + 1); };
      let bad = '', n = 0;
      for (let k = 0; k < 600 && !bad; k++) {
        const w = R(1, 32), h = R(1, 12), wb = (w + 7) >> 3, src = [];
        for (let r = 0; r < h; r++) for (let b = 0; b < wb; b++) { let mk = R(0, 255), im = R(0, 255); if (b === wb - 1) { const pad = (1 << (8 * wb - w)) - 1; mk |= pad; im &= ~pad & 255; } src.push(mk, im); }
        const A = new Gfx6Model(), B = new Gfx6Model();
        for (let i = 0; i < A.px.length; i++) A.px[i] = B.px[i] = R(0, 1);
        const cl = R(0, 3) === 0 ? [R(-5, 300), R(-5, 100), R(-3, 300), R(-3, 120)] : [0, 0, 512, 192]; A.setClip(...cl); B.setClip(...cl);
        const x = R(0, 5) === 0 ? R(-60, 540) : R(-40, 300) , y = R(-10, 190), set = A.preshift(w, h, src);
        A.blit(x, y, w, h, src); B.blitSet(x, y, w, h, set); n++;
        const dd = A.compare(B); if (dd) bad = `blit(${x}, ${y}, ${w}, ${h}) clip ${cl}: ${fmtDiff(dd)}`;
      }
      C.check('blitSet (the set read per pixel: copy x AND 7, pair (x + j >> 3) - (x >> 3)) equals blit from the source on 600 random bitmaps, positions (negative too) and clips', !bad, bad || `${n} cases`);
    }
    // byteRect / saveRect / restoreRect
    {
      const m = new Gfx6Model(), br = (...a) => J(Object.values(m.byteRect(...a)));
      C.check('byteRect (5,3,10,2) -> c0 0, nc 2, y0 3, nr 2 (x 5..14 touches byte columns 0 and 1)', br(5, 3, 10, 2) === J([0, 2, 3, 2]));
      C.check('byteRect (8,0,8,1) -> column 1 only; (8,0,9,1) -> columns 1 and 2; (7,0,2,1) -> columns 0 and 1', br(8, 0, 8, 1) === J([1, 1, 0, 1]) && br(8, 0, 9, 1) === J([1, 2, 0, 1]) && br(7, 0, 2, 1) === J([0, 2, 0, 1]));
      C.check('byteRect (-5,-5,10,10) -> clamped to (0..4, 0..4): c0 0, nc 1, y0 0, nr 5', br(-5, -5, 10, 10) === J([0, 1, 0, 5]));
      C.check('byteRect (500,190,100,100) -> columns 62..63, rows 190..191', br(500, 190, 100, 100) === J([62, 2, 190, 2]));
      C.check('byteRect of the whole screen (0,0,512,192): 64 columns x 192 rows = 4 + 12,288 = 12,292 bytes; (-16384,-16384,32767,32767) too',
        br(0, 0, 512, 192) === J([0, 64, 0, 192]) && br(-16384, -16384, 32767, 32767) === J([0, 64, 0, 192]) && m.saveRect(0, 0, 512, 192).size === 12292);
      C.check('byteRect empty cases: w = 0, h = 0, w < 0, off the left (-20,0,20,5), off the right (512,0,5,5), below (0,192,5,5): nc = nr = 0, size 4',
        [[0, 0, 0, 5], [0, 0, 5, 0], [0, 0, -4, 5], [-20, 0, 20, 5], [512, 0, 5, 5], [0, 192, 5, 5], [0, -9, 5, 9]].every((a) => m.byteRect(...a).nc === 0 && m.byteRect(...a).nr === 0 && m.saveRect(...a).size === 4));
      m.setClip(100, 100, 3, 3);
      C.check('byteRect and saveRect ignore the clip and the op', J(Object.values(m.byteRect(0, 0, 20, 4))) === J([0, 3, 0, 4]));
      let s4 = 4711; const R = (lo, hi) => { s4 = (Math.imul(s4, 1664525) + 1013904223) >>> 0; return lo + (s4 >>> 6) % (hi - lo + 1); };
      let bad = '';
      for (let k = 0; k < 300 && !bad; k++) {
        const A = new Gfx6Model(); for (let i = 0; i < A.px.length; i++) A.px[i] = R(0, 1);
        const rect = [R(-30, 540), R(-20, 210), R(-3, 150), R(-3, 80)], s = A.saveRect(...rect), before = A.px.slice();
        for (let i = 0; i < 4000; i++) A.px[R(0, A.px.length - 1)] ^= 1;
        const mid = A.px.slice(); A.restoreRect(s);
        // independent expectation: inside the byte rectangle = before, elsewhere = mid
        for (let y = 0; y < SCR_H && !bad; y++) for (let x = 0; x < SCR_W; x++) {
          const inside = s.nc > 0 && y >= s.y0 && y < s.y0 + s.nr && x >= 8 * s.c0 && x < 8 * (s.c0 + s.nc), i = y * SCR_W + x;
          if (A.px[i] !== (inside ? before[i] : mid[i])) { bad = `rect ${rect} pixel (${x}, ${y})`; break; }
        }
      }
      C.check('saveRect / change / restoreRect: the byte rectangle returns to its saved values, every other pixel keeps the later value (300 cases)', !bad, bad);
    }
    // scrollv
    {
      const m = new Gfx6Model();
      for (let y = 10; y < 15; y++) m.set(8 + (y % 16), y, 1);           // one marker per row, x = 18..22
      m.scrollv(8, 10, 16, 5, 2);                                         // c0 1, nc 2, rows 10..14: up by 2
      C.check('scrollv up by 2 on (8,10,16,5): row 10 <- old 12, 11 <- 13, 12 <- 14, rows 13 and 14 paper',
        m.count() === 3 && m.get(8 + 12 % 16, 10) && m.get(8 + 13 % 16, 11) && m.get(8 + 14 % 16, 12));
      const n = new Gfx6Model();
      for (let y = 10; y < 15; y++) n.set(8 + (y % 16), y, 1);
      n.scrollv(8, 10, 16, 5, -2);
      C.check('scrollv down by 2: row 12 <- old 10, 13 <- 11, 14 <- 12, rows 10 and 11 paper',
        n.count() === 3 && n.get(8 + 10 % 16, 12) && n.get(8 + 11 % 16, 13) && n.get(8 + 12 % 16, 14));
      const p = new Gfx6Model(); p.fill(0, 0, 40, 3); p.setOp(OP_XOR);
      p.scrollv(3, 0, 30, 3, 1);                                          // cx 3..33: whole byte columns 1..3 (x 8..31); x 3..7 and 32 stay
      C.check('scrollv (3,0,30,3) by 1: only whole byte columns 1..3 (x 8..31) scroll; the partial bytes at x 3..7 and x 32 are left alone, rows 0..1 keep ink, row 2 paper in the region',
        p.count() === 120 - 24 && !p.get(8, 2) && !p.get(31, 2) && p.get(7, 2) && p.get(32, 2) && p.get(8, 1) && p.get(3, 2) && p.op === OP_XOR);
      for (const nn of [3, -3, 4, 100, -100, 16383, -16384]) {
        const q = new Gfx6Model(); q.fill(0, 0, 40, 3); q.scrollv(3, 0, 30, 3, nn);
        if (q.count() !== 120 - 72 || q.get(8, 0) || q.get(31, 2) || !q.get(7, 0) || !q.get(32, 2)) { C.check(`scrollv n = ${nn} >= rows (3): the region (72 pixels) becomes paper`, false); break; }
      }
      C.check('scrollv with abs(n) >= the region rows: the whole region becomes paper, partial bytes intact (n = 3, -3, 4, 100, -100, 16383, -16384)', true);
      const z = new Gfx6Model(); z.fill(0, 0, 40, 3); z.scrollv(1, 0, 14, 5, 1); z.scrollv(8, 0, 0, 3, 1); z.scrollv(8, 0, 8, 0, 1); z.scrollv(8, 0, 16, 3, 0); z.scrollv(-100, 0, 20, 3, 1); z.scrollv(512, 0, 8, 3, 1);
      C.check('scrollv with no whole byte column (x 1..14), w = 0, h = 0, n = 0, or off screen: nothing changes', z.count() === 120);
      const c = new Gfx6Model(); c.fill(0, 0, 64, 8); c.setClip(16, 0, 16, 4); c.scrollv(0, 0, 512, 192, 1);
      C.check('scrollv intersects with the clip: clip (16,0,16,4) with the whole screen: columns 2..3, rows 0..3 (rows 0..2 keep ink, row 3 paper)',
        c.count() === 64 * 8 - 16 && !c.get(16, 3) && c.get(16, 2) && c.get(15, 3) && c.get(32, 3) && c.get(16, 4));
      const r = (...a) => JSON.stringify(m.scrollRegion(...a));
      C.check('scrollRegion: (3,0,30,3) -> c0 1 nc 3 y0 0 nr 3; (1,0,14,5) -> null; (0,0,512,192) -> 64 columns 192 rows; (-20,-5,40,10) -> c0 0 nc 2 (x 0..19: bytes 0, 1) rows 0..4',
        r(3, 0, 30, 3) === JSON.stringify({ c0: 1, nc: 3, y0: 0, nr: 3 }) && r(1, 0, 14, 5) === 'null' && r(0, 0, 512, 192) === JSON.stringify({ c0: 0, nc: 64, y0: 0, nr: 192 }) && r(-20, -5, 40, 10) === JSON.stringify({ c0: 0, nc: 2, y0: 0, nr: 5 }));
      // brute force from the contract text: row cy0 + r gets old row cy0 + r + m, and so on, on a random screen
      let s5 = 99; const R = (lo, hi) => { s5 = (Math.imul(s5, 1664525) + 1013904223) >>> 0; return lo + (s5 >>> 7) % (hi - lo + 1); };
      let bad = '';
      for (let k = 0; k < 400 && !bad; k++) {
        const A = new Gfx6Model(), B = new Gfx6Model();
        for (let i = 0; i < A.px.length; i++) A.px[i] = B.px[i] = R(0, 1);
        const cl = [R(-20, 300), R(-20, 120), R(-3, 400), R(-3, 150)]; A.setClip(...cl); B.setClip(...cl);
        const rect = [R(-30, 400), R(-20, 150), R(-3, 300), R(-3, 120)], nn = [0, 1, -1, 7, -7, 8, -8, R(-200, 200), R(-16384, 16383), 192, -192][R(0, 10)];
        A.scrollv(...rect, nn);
        const c2 = B.clip, old = B.px.slice();
        const cx0 = Math.max(rect[0], c2.x0), cx1 = Math.min(rect[0] + rect[2], c2.x1), cy0 = Math.max(rect[1], c2.y0), cy1 = Math.min(rect[1] + rect[3], c2.y1);
        if (rect[2] > 0 && rect[3] > 0 && cx0 < cx1 && cy0 < cy1 && nn !== 0) {
          const bx0 = Math.ceil(cx0 / 8), bx1 = Math.floor(cx1 / 8), nr = cy1 - cy0, mm = Math.abs(nn);
          for (let bc = bx0; bc < bx1; bc++) for (let j = 0; j < 8; j++) for (let r2 = 0; r2 < nr; r2++) {
            const x = bc * 8 + j, src = nn > 0 ? r2 + mm : r2 - mm;
            B.px[(cy0 + r2) * SCR_W + x] = (src >= 0 && src < nr && mm < nr) ? old[(cy0 + src) * SCR_W + x] : 0;
          }
        }
        const d = A.compare(B); if (d) bad = `scrollv(${rect}, ${nn}) clip ${cl}: ${fmtDiff(d)}`;
      }
      C.check('scrollv = the contract rule written row by row, 400 random rectangles, clips and n', !bad, bad);
    }
  }
  // ---- S4: the pointer model (16.2, 16.4) ---------------------------------------------------------------------------------
  {
    const rj = (r) => JSON.stringify(r);
    const pr = (x, y) => rj(pointerRect(x, y));
    C.check('pointerRect: (0,0) -> c 0..2 rows 0..15; (7,0) -> c 0..2; (8,0) -> c 1..3; (495,0) -> c 61..63; (496,0) -> c 62..63; (504,185) -> c 63..63 rows 185..191; (511,191) -> c 63 row 191',
      pr(0, 0) === rj({ c0: 0, c1: 2, y0: 0, y1: 15 }) && pr(7, 0) === rj({ c0: 0, c1: 2, y0: 0, y1: 15 }) && pr(8, 0) === rj({ c0: 1, c1: 3, y0: 0, y1: 15 }) &&
      pr(495, 0) === rj({ c0: 61, c1: 63, y0: 0, y1: 15 }) && pr(496, 0) === rj({ c0: 62, c1: 63, y0: 0, y1: 15 }) &&
      pr(504, 185) === rj({ c0: 63, c1: 63, y0: 185, y1: 191 }) && pr(511, 191) === rj({ c0: 63, c1: 63, y0: 191, y1: 191 }));
    C.check('pointerRect: rows min(py + 15, 191): y 176 -> 176..191, y 177 -> 177..191, y 175 -> 175..190',
      pointerRect(0, 176).y1 === 191 && pointerRect(0, 177).y1 === 191 && pointerRect(0, 175).y1 === 190);
    const sr = (...a) => rj(shieldRect(...a));
    C.check('shieldRect: (3,5,14,2) -> c 0..2 rows 5..6; (-10,-10,20,20) -> c 0..1 rows 0..9; (16,0,8,1) -> c 2..2; (15,0,2,1) -> c 1..2; (511,191,5,5) -> c 63 row 191; (0,0,512,192) -> c 0..63 rows 0..191',
      sr(3, 5, 14, 2) === rj({ c0: 0, c1: 2, y0: 5, y1: 6 }) && sr(-10, -10, 20, 20) === rj({ c0: 0, c1: 1, y0: 0, y1: 9 }) && sr(16, 0, 8, 1) === rj({ c0: 2, c1: 2, y0: 0, y1: 0 }) &&
      sr(15, 0, 2, 1) === rj({ c0: 1, c1: 2, y0: 0, y1: 0 }) && sr(511, 191, 5, 5) === rj({ c0: 63, c1: 63, y0: 191, y1: 191 }) && sr(0, 0, 512, 192) === rj({ c0: 0, c1: 63, y0: 0, y1: 191 }));
    C.check('shieldRect: empty (null) for w = 0, h = 0, w < 0, off screen left / right / above / below, and a rectangle that ends at x = 0 or y = 0',
      [[0, 0, 0, 5], [0, 0, 5, 0], [5, 5, -3, 4], [-20, 0, 20, 9], [512, 0, 9, 9], [0, -9, 9, 9], [0, 192, 9, 9], [600, 600, 9, 9], [-100, -100, 100, 100]].every((a) => shieldRect(...a) === null));
    C.check('shieldRect wraps its arguments like a GA word (65535 = -1, 65536 + 3 = 3)', sr(65535, 0, 9, 1) === rj({ c0: 0, c1: 0, y0: 0, y1: 0 }) && sr(65536 + 3, 0, 9, 1) === rj({ c0: 0, c1: 1, y0: 0, y1: 0 }));
    const a = { c0: 2, c1: 4, y0: 10, y1: 20 };
    C.check('meets: shares at least one (byte column, row); touching edges inside the rectangle count, adjacent ones do not; null meets nothing; symmetric',
      meets(a, { c0: 4, c1: 9, y0: 20, y1: 30 }) && !meets(a, { c0: 5, c1: 9, y0: 10, y1: 20 }) && !meets(a, { c0: 2, c1: 4, y0: 21, y1: 30 }) && !meets(a, { c0: 0, c1: 1, y0: 0, y1: 99 }) &&
      !meets(a, null) && !meets(null, a) && !meets(null, null) && meets({ c0: 0, c1: 63, y0: 0, y1: 191 }, a) && meets(a, { c0: 3, c1: 3, y0: 15, y1: 15 }) === meets({ c0: 3, c1: 3, y0: 15, y1: 15 }, a));
    C.check('clampPos: (-5, 300) -> (0, 191); (511, 191) stays; (512, 192) -> (511, 191); (65535, 65535) = (-1, -1) -> (0, 0); (40000, 40000) = (-25536, -25536) -> (0, 0); (16383, -16384) -> (511, 0)',
      rj(clampPos(-5, 300)) === '[0,191]' && rj(clampPos(511, 191)) === '[511,191]' && rj(clampPos(512, 192)) === '[511,191]' && rj(clampPos(65535, 65535)) === '[0,0]' &&
      rj(clampPos(40000, 40000)) === '[0,0]' && rj(clampPos(16383, -16384)) === '[511,0]');
    C.check('arrowFromArt: 64 bytes, pixel (0,0) of TEST_ARROW is outline (mask 0, image 0), (1,2) is ink (mask 0, image 1), (15,15) is transparent (mask 1, image 0)',
      TEST_ARROW.length === 64 && !(TEST_ARROW[0] & 0x80) && !(TEST_ARROW[1] & 0x80) && !(TEST_ARROW[2 * (2 * 2)] & 0x40) && (TEST_ARROW[2 * (2 * 2) + 1] & 0x40) &&
      (TEST_ARROW[2 * (2 * 15 + 1)] & 1) && !(TEST_ARROW[2 * (2 * 15 + 1) + 1] & 1));

    // The image: bitmap pixel (j, k) at (px + j, py + k): new = (old AND m) OR i, cut at the right and bottom edges; compared with a
    // direct per-pixel reading of the arrow and with preshift + blitSet (15.2), over every position class of 16.6.1.
    const R = (() => { let s = 0x5EED4; return (lo, hi) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return lo + (s >>> 8) % (hi - lo + 1); }; })();
    const XS = [0, 1, 7, 8, 9, 15, 16, 100, 255, 256, 495, 496, 497, 503, 504, 505, 511], YS = [0, 1, 5, 7, 8, 100, 175, 176, 177, 183, 190, 191];
    let bad = '', n = 0;
    for (const px of XS) for (const py of YS) {
      const scr = new Gfx6Model(); for (let i = 0; i < scr.px.length; i++) scr.px[i] = R(0, 1);
      const pm = new PointerModel(scr, TEST_ARROW); pm.init(px, py); pm.isr();
      const disp = pm.display(), want = scr.px.slice(), set = scr.preshift(16, 16, TEST_ARROW), viaSet = new Gfx6Model();
      viaSet.px.set(scr.px); viaSet.blitSet(px, py, 16, 16, set);
      for (let k = 0; k < 16; k++) for (let j = 0; j < 16; j++) {
        const x = px + j, y = py + k;
        if (x >= SCR_W || y >= SCR_H) continue;
        const mk = (TEST_ARROW[2 * (2 * k + (j >> 3))] >> (7 - (j & 7))) & 1, im = (TEST_ARROW[2 * (2 * k + (j >> 3)) + 1] >> (7 - (j & 7))) & 1;
        want[y * SCR_W + x] = (want[y * SCR_W + x] & mk) | im;
      }
      let diff = 0, outside = 0;
      const rect = pointerRect(px, py);
      for (let i = 0; i < want.length; i++) {
        if (disp.px[i] !== want[i]) diff++;
        if (disp.px[i] !== scr.px[i]) { const x = i % SCR_W, y = (i / SCR_W) | 0; if ((x >> 3) < rect.c0 || (x >> 3) > rect.c1 || y < rect.y0 || y > rect.y1) outside++; }
      }
      if (diff || outside || disp.compare(viaSet)) bad += ` (${px},${py}): ${diff} differ from the per-pixel reading, ${outside} changed outside the byte rectangle, via the set: ${disp.compare(viaSet) ? 'differs' : 'equal'};`;
      n++;
    }
    C.check('pointer image = per-pixel (old AND m) OR i, cut at the right and bottom edges, only inside the byte rectangle, equals preshift + blitSet: 17 x 12 positions', !bad, bad || `${n} positions`);
    {
      const scr = new Gfx6Model(); scr.px.fill(1);
      const pm = new PointerModel(scr, TEST_ARROW); pm.init(100, 50); pm.isr();
      const d = pm.display(); let changed = 0; for (let i = 0; i < d.px.length; i++) if (d.px[i] !== 1) changed++;
      const scr2 = new Gfx6Model(); const pm2 = new PointerModel(scr2, TEST_ARROW); pm2.init(100, 50); pm2.isr(); const d2 = pm2.display();
      C.check('TEST_ARROW is a visible pointer on ink (some pixels become paper: outline) and on paper (some become ink)', changed > 0 && d2.count() > 0, `${changed} pixels erased on ink, ${d2.count()} drawn on paper`);
    }
  }

  // The state machine, hand-worked (16.4).
  {
    const R = (() => { let s = 0x5EED5; return (lo, hi) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return lo + (s >>> 8) % (hi - lo + 1); }; })();
    const mk = () => { const scr = new Gfx6Model(); for (let i = 0; i < scr.px.length; i++) scr.px[i] = (i * 7 + (i >> 5)) & 1; return new PointerModel(scr, TEST_ARROW); };
    const same = (pm, ref) => !pm.display().compare(ref);
    const ref = (pm) => { const r = new Gfx6Model(); r.px.set(pm.scr.px); return r; };
    let pm = mk(), plain = ref(pm);
    C.check('before P_INIT the pointer is off: P_ISR does nothing, move / shield do not turn it on, the display is the plain screen',
      (pm.isr(), pm.D === null) && (pm.move(10, 10), pm.isr(), pm.D === null) && (pm.shield(0, 0, 9, 9), pm.unshield(), pm.isr(), pm.D === null) && same(pm, plain));
    pm.init(300, 100);
    C.check('P_INIT: position clamped, on, no shield, nothing drawn (display = plain screen) until the next P_ISR', pm.on && pm.S === null && pm.D === null && same(pm, plain) && pm.pos.x === 300 && pm.pos.y === 100);
    C.check('P_ISR draws at the position: D = (300, 100), display = screen + image there, differs from the plain screen', pm.isr() === 'draw' && pm.D.x === 300 && !same(pm, plain));
    C.check('P_ISR again with nothing changed does nothing (D unchanged, display unchanged)', (() => { const was = pm.display(); return pm.isr() === 'none' && !pm.display().compare(was); })());
    pm.move(301, 100);
    C.check('P_MOVE draws nothing (D still (300, 100)); the next P_ISR erases and draws at (301, 100) (a "move")', pm.D.x === 300 && pm.isr() === 'move' && pm.D.x === 301);
    pm.move(301, 100);
    C.check('P_MOVE to the same position: P_ISR does not erase or draw', pm.isr() === 'none' && pm.D.x === 301);
    // shield meeting the drawn pointer: erased at once; shield not meeting: nothing
    pm.shield(320, 100, 8, 8);            // byte column 40: the pointer at px 301 covers columns 37..39 -> no meet
    C.check('P_SHIELD whose byte rectangle does not meet the drawn pointer (columns 37..39 vs 40): the pointer stays', pm.D !== null);
    pm.shield(312, 100, 8, 8);            // byte column 39: meets (even though pixels 312.. are beyond the arrow: 301 + 15 = 316 is inside column 39)
    C.check('P_SHIELD that meets (column 39) erases at once: D = none, display = plain screen', pm.D === null && same(pm, plain));
    C.check('P_ISR with the pointer still meeting the shield: nothing drawn (hidden), even after P_MOVE to another position that meets', pm.isr() === 'none' && pm.D === null && (pm.move(300, 104), pm.isr() === 'none' && pm.D === null));
    pm.move(0, 0);
    C.check('P_MOVE to a position that does not meet the shield: the next P_ISR draws it even though the shield is still set (a draw, not a move)', pm.isr() === 'draw' && pm.D.x === 0);
    pm.shield(0, 0, 0, 5);
    C.check('P_SHIELD with an empty rectangle: the shield becomes "empty" (meets nothing): the pointer stays, and replaces the old shield', pm.S === null && pm.D !== null);
    pm.shield(500, 0, 12, 12); pm.unshield(); pm.move(496, 0);
    C.check('P_UNSHIELD removes the shield; draws nothing by itself', pm.S === null && pm.D.x === 0);
    pm.shield(0, 0, 8, 1); pm.shield(496, 190, 8, 1);                  // replaces the first: the pointer at (0, 0) is NOT erased by the replaced rectangle... it met the first!
    C.check('P_SHIELD(0,0,8,1) erases the pointer at (0,0); a second P_SHIELD replaces the first and nothing is redrawn until P_ISR', pm.D === null && pm.S.c0 === 62);
    C.check('P_ISR: position (496, 0) rows 0..15, columns 62..63; shield rows 190..190: does not meet: draw at (496, 0)', pm.isr() === 'draw' && pm.D.x === 496 && pm.D.y === 0);
    // erasing restores exactly
    pm.unshield(); pm.shield(0, 0, 512, 192);
    C.check('P_SHIELD of the whole screen: erased, display = plain screen; P_ISR keeps it hidden; P_UNSHIELD then P_ISR draws it again',
      pm.D === null && same(pm, plain) && pm.isr() === 'none' && same(pm, plain) && (pm.unshield(), pm.isr() === 'draw') && pm.D.x === 496);
    // drawn at one place, shield set at its new position only: erase only
    pm.move(100, 100); pm.shield(100, 100, 4, 4);
    C.check('P_MOVE then a P_SHIELD that meets only the NEW position: the drawn pointer stays (D = old), the next P_ISR only erases ("erase")', pm.D.x === 496 && pm.isr() === 'erase' && pm.D === null && same(pm, plain));
    C.check('calls counter: P_ISR resets it, P_MOVE / P_SHIELD / P_UNSHIELD / P_INIT count (the "skip" case is calls == 0)', (() => { const q = mk(); q.init(1, 1); q.isr(); const a0 = q.calls; q.move(2, 2); q.shield(0, 0, 1, 1); q.unshield(); return a0 === 0 && q.calls === 3 && (q.isr(), q.calls === 0); })());
    const cl = pm.clone(); cl.scr.px[5] ^= 1;
    C.check('clone() has its own screen and state', pm.scr.px[5] !== cl.scr.px[5] && cl.pos.x === pm.pos.x && cl.on === pm.on);
    // randomised: whatever the order of calls, display() == screen + image at D, and D is either null or a position the ISR has drawn
    let bad = '';
    for (let t = 0; t < 400 && !bad; t++) {
      const q = mk(); q.init(R(0, 511), R(0, 191)); q.isr();
      for (let s = 0; s < 40 && !bad; s++) {
        const k = R(0, 4);
        if (k === 0) q.move(R(-40, 560), R(-40, 230)); else if (k === 1) q.shield(R(-20, 520), R(-20, 200), R(0, 80), R(0, 40)); else if (k === 2) q.unshield(); else if (k === 3) q.isr(); else q.move(q.pos.x, q.pos.y);
        if (q.D && q.S && meets(pointerRect(q.D.x, q.D.y), q.S) && k !== 1 && k !== 0) bad = `step ${s}: drawn pointer meets the shield without a P_SHIELD erase`;
        if (k === 1 && q.D && meets(pointerRect(q.D.x, q.D.y), q.S)) bad = `step ${s}: P_SHIELD left a meeting pointer drawn`;
        if (k === 3) { const vis = q.visible(); if (vis !== !!q.D || (q.D && (q.D.x !== q.pos.x || q.D.y !== q.pos.y))) bad = `step ${s}: after P_ISR, drawn must equal visible position`; }
      }
    }
    C.check('random walk over P_MOVE / P_SHIELD / P_UNSHIELD / P_ISR (400 x 40): after P_ISR D = the position iff visible; P_SHIELD never leaves a meeting pointer drawn', !bad, bad);
  }
  C.done();
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) await selfTest();
