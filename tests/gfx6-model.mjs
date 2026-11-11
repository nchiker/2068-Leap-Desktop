"use strict";
// gfx6-model.mjs -- the reference model for the gfx6 graphics library, slices S1 and S2 (docs/GRAPHICS_SPIKE.md sections 3-6,
// 12 and 14).  Written from the contract, not from the code.  A 512 x 192 bit screen (one byte per pixel here, 1 = ink) and the
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
  C.done();
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) await selfTest();
