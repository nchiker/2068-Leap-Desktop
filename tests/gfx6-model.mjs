"use strict";
// gfx6-model.mjs -- the reference model for the gfx6 graphics library, slice S1 (docs/GRAPHICS_SPIKE.md sections 3, 4, 5, 12).
// Written from the contract, not from the code.  A 512 x 192 bit screen (one byte per pixel here, 1 = ink) and the S1
// operations: draw op, clip rectangle, G_FILL, G_HLINE, G_VLINE, G_FRAME, G_CLS, plus G_ADDR / G_ROWADDR / ROWTAB.
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

  /** G_INIT: op = SET, clip = the whole screen. (The screen is not touched.) */
  init() { this.op = OP_SET; this.clip = { x0: 0, x1: SCR_W, y0: 0, y1: SCR_H }; }
  setOp(op) { this.op = op; }

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
  C.done();
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) await selfTest();
