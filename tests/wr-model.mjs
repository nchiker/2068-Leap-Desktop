"use strict";
// wr-model.mjs -- reference model of Write slice W1 (docs/WRITE.md sections 1-10 and 11, incl. the two amendments of 2026-11-12 on 11.4 and 11.5).  Written from the contract only;
// src/apps/write.asm, src/apps/shell.asm and src/kernel/*.asm were never read.
//
//   node tests/wr-model.mjs --self-test      hand-worked cases of the model itself (tests/wr-w1.mjs runs the same cases as its group 0)
//
// What is here:
//   * the line wrapper of 11.4 (`lineLen`, `wrapAll`), PROP6 advances from the gfx6 model, W = 444, a line of at most 255 codes;
//   * `Doc`: the document, the caret, top, the changed flag and the "run" of UP / DOWN with its target x (11.1, 11.5): insert, DELETE, LEFT, RIGHT, UP, DOWN, click, E_SCROLL,
//     "New", the shown rule, the bar's (value, max, page) with the scale k of 11.5;
//   * the pixels (11.3): `tvLook` (the text view alone), `windowLook` of Write (CWindow: window look, close box, the text view, the bar), `renderScreen` (desk, menu bar "File", the
//     window, covering plain windows, the discard dialog).
//
// Readings of the contract (also in the report; CONTRACT? in the comments):
//  R1. A line is cut by the 255-code cap after the other rules of 11.4 have had their say on that code (a non-space that overflows ends the line by the overflow rule first).  Only a
//      long run of spaces reaches the cap, and there the run is cut at 255 codes.
//  R2. After a space overflow the line ends after the run of spaces; a 13 directly after the run is NOT part of that line (it is not a space): it makes its own line of one code
//      (11.4 read to the letter).
//  R3. A click below the last display line puts the caret in the last line by the x rule (11.5), not at the document's end (section 4's wording).
//  R4. UP at the first line (caret to 0) and DOWN at the last line (caret to L) belong to a run: the target x of the run is kept.
//  R5. A refused insert (full, or 1,024 lines) changes nothing at all: the run and the changed flag are as before.  DELETE at the start of the document changes nothing and does not
//      set `changed`.
//  R6. (settled by the coordinator, WRITE 11.5) When a delete / rewrap leaves top > M = max(0, lines - 16), top does not move until the shown rule or an E_SCROLL moves it (blank bands
//      show at the bottom); the bar holds min(floor(top / k), max) (what TK_SETBAR stores).  `Doc.topBeyond()` only tells the generators when to count such a state.
//  R7. Keys that are not consumed end a run in the model (generators send them only when no run is active).  A bar click (E_SCROLL) does not end a run (generators avoid it in a run).
import { fileURLToPath } from 'node:url';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR, fonts } from './gfx6-model.mjs';
import { windowLook as wmWindowLook, buttonLook, labelLook, dialogLook, toDisp } from './wm-model2.mjs';
import { drawBar, layoutOf, menuSpec } from './wm-model3.mjs';
import { vsLook } from './tk-model.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR, toDisp };
export const CAP = 5120, MAXLINES = 1024, NSHOWN = 16, W = 444, MAXLINE = 255, PITCH = 9;
export const WINR = { x: 16, y: 16, w: 480, h: 168, title: 'Write' };
export const TVR = { x: 24, y: 30, w: 448, h: 144 };
export const BARR = { x: 478, y: 28, w: 12, h: 148 };
export const TEXTX = 27;
export const DLG = { x: 128, y: 64, w: 256, h: 64, label: { x: 144, y: 76, w: 200, h: 9, text: 'Discard the document?' }, discard: { x: 224, y: 100, w: 64, h: 16, text: 'Discard' }, cancel: { x: 304, y: 100, w: 64, h: 16, text: 'Cancel' } };
export const FILE_MENU = menuSpec(1, 'File', [[1, 0, 'New']]);
export const KEY = { DELETE: 12, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, TAB: 14, BACKTAB: 15, CLOSE: 17, ESC: 27 };
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));
export const textOf = (codes) => String.fromCharCode(...codes);
const PW = fonts().prop6.W;
export const adv = (c) => PW[c];
/** tw(codes, i, j): the width of codes i..j-1 (0 when j <= i). */
export const tw = (codes, i, j) => { let s = 0; for (let k = i; k < j; k++) s += PW[codes[k]]; return s; };
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 11.4: lines
/** The length of the line that starts at s (s < codes.length). */
export function lineLen(codes, s) {
  const L = codes.length;
  let sum = 0, lastSp = -1;
  for (let i = s; i < L; i++) {
    const c = codes[i];
    if (c === 13) return i + 1 - s;
    sum += PW[c];
    if (sum > W) {
      if (c !== 32) return lastSp >= 0 ? lastSp + 1 - s : Math.max(1, i - s);
      let j = i;                                                          // a space exceeds: the line ends after it and every space directly after it (at most 255 codes)
      while (j + 1 < L && codes[j + 1] === 32 && j + 2 - s <= MAXLINE) j++;
      return Math.min(j + 1 - s, MAXLINE);
    }
    if (c === 32) lastSp = i;
    if (i + 1 - s >= MAXLINE) return MAXLINE;
  }
  return L - s;
}
/** The lengths of the display lines of the document (at least one; the lengths sum to L). */
export function wrapAll(codes) {
  const out = [], L = codes.length;
  let s = 0;
  while (s < L) { const n = lineLen(codes, s); out.push(n); s += n; }
  if (L === 0 || codes[L - 1] === 13) out.push(0);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The document
export class Doc {
  constructor(codes = [], caret = 0) { this.codes = codes.slice(); this.caret = caret; this.top = 0; this.changed = false; this.run = null; this.relayout(); }
  reset() { this.codes = []; this.caret = 0; this.top = 0; this.changed = false; this.run = null; this.relayout(); }
  clone() { const d = new Doc(this.codes, this.caret); d.top = this.top; d.changed = this.changed; d.run = this.run; return d; }
  relayout() {
    this.lens = wrapAll(this.codes); this.starts = new Array(this.lens.length); let s = 0;
    for (let i = 0; i < this.lens.length; i++) { this.starts[i] = s; s += this.lens[i]; }
  }
  get L() { return this.codes.length; }
  get nl() { return this.lens.length; }
  lineOf(pos) { let i = 0; for (let k = 0; k < this.nl; k++) if (this.starts[k] <= pos) i = k; else break; return i; }
  caretLine() { return this.lineOf(this.caret); }
  /** The codes of display line i without a final 13 (what is drawn). */
  lineText(i) { const a = this.codes.slice(this.starts[i], this.starts[i] + this.lens[i]); if (a.length && a[a.length - 1] === 13) a.pop(); return a; }
  /** The width of the codes from the caret's line start to the caret. */
  caretTw() { return tw(this.codes, this.starts[this.caretLine()], this.caret); }
  lastPos(ln) { return ln < this.nl - 1 ? this.starts[ln] + this.lens[ln] - 1 : this.L; }
  /** TOOLKIT 10.4's click rule per line: the first position k whose middle is right of r (r = pixels from the pen start), else the line's last position. */
  posInLine(ln, r) {
    const s = this.starts[ln], lp = this.lastPos(ln);
    let pen = 0;
    for (let k = s; k < lp; k++) { if (r < pen + (PW[this.codes[k]] >> 1)) return k; pen += PW[this.codes[k]]; }
    return lp;
  }
  canInsert() { return this.L < CAP && this.nl < MAXLINES; }
  // ---- the bar (11.5, amended)
  get M() { return Math.max(0, this.nl - NSHOWN); }
  get k() { for (const k of [1, 2, 4]) if (Math.ceil(this.M / k) <= 255) return k; return 4; }
  /** What the VScroll holds: value (TK_SETBAR stores min(A, max)), max, page. */
  bar() { const k = this.k, max = Math.ceil(this.M / k); return { value: Math.min(Math.floor(this.top / k), max), max, page: NSHOWN / k }; }
  /** top beyond the last full page: the state the contract does not settle (R6). */
  topBeyond() { return this.top > this.M; }
  // ---- 11.5 "Shown"
  shown() { const ln = this.caretLine(); if (ln < this.top) this.top = ln; else if (ln >= this.top + NSHOWN) this.top = ln - (NSHOWN - 1); }
  /** Each returns true when anything (text, caret, top) changed. */
  insert(c) {
    if (!this.canInsert()) return false;
    const top0 = this.top;
    this.codes.splice(this.caret, 0, c); this.caret++; this.changed = true; this.run = null; this.relayout(); this.shown();
    void top0; return true;
  }
  del() {
    if (this.caret === 0) return false;
    this.codes.splice(this.caret - 1, 1); this.caret--; this.changed = true; this.run = null; this.relayout(); this.shown();
    return true;
  }
  left() { this.run = null; if (this.caret === 0) return false; this.caret--; this.shown(); return true; }
  right() { this.run = null; if (this.caret === this.L) return false; this.caret++; this.shown(); return true; }
  up() {
    const ln = this.caretLine(), c0 = this.caret, t0 = this.top;
    if (this.run === null) this.run = this.caretTw();
    this.caret = ln === 0 ? 0 : this.posInLine(ln - 1, this.run);
    this.shown();
    return this.caret !== c0 || this.top !== t0;
  }
  down() {
    const ln = this.caretLine(), c0 = this.caret, t0 = this.top;
    if (this.run === null) this.run = this.caretTw();
    this.caret = ln === this.nl - 1 ? this.L : this.posInLine(ln + 1, this.run);
    this.shown();
    return this.caret !== c0 || this.top !== t0;
  }
  /** E_DOWN in the text view at (px, py). */
  click(px, py) {
    const c0 = this.caret, t0 = this.top;
    const j = this.top + Math.floor((py - TVR.y) / PITCH), ln = Math.min(j, this.nl - 1);
    this.run = null; this.caret = this.posInLine(ln, px - TEXTX); this.shown();
    return this.caret !== c0 || this.top !== t0;
  }
  /** E_SCROLL with the bar's value v: top = min(v x k, M); the caret does not move. */
  scrollTo(v) { const t = Math.min(v * this.k, this.M), ch = t !== this.top; this.top = t; return ch; }
  /** A key that is not consumed. */
  other() { this.run = null; return false; }
  /** One of the keys of the table in section 4 (32-126, 13, 12, 8, 9, 10, 11); returns changed. */
  key(code) {
    if ((code >= 32 && code <= 126) || code === 13) return this.insert(code);
    switch (code) { case KEY.DELETE: return this.del(); case KEY.LEFT: return this.left(); case KEY.RIGHT: return this.right(); case KEY.DOWN: return this.down(); case KEY.UP: return this.up(); default: return this.other(); }
  }
  static consumes(code) { return (code >= 32 && code <= 126) || [8, 9, 10, 11, 12, 13].includes(code); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The pixels (11.3)
/** The text view alone: 16 bands CLR, the lines' text SET, the caret SET when `focus`. */
export function tvLook(g, d, focus) {
  g.setOp(OP_CLR); g.fill(TVR.x, TVR.y, TVR.w, TVR.h);
  g.setOp(OP_SET);
  const nl = d.nl;
  for (let j = 0; j < NSHOWN; j++) { const i = d.top + j; if (i < nl) { const t = d.lineText(i); if (t.length) g.textp(TEXTX, TVR.y + PITCH * j, t); } }
  if (focus) {
    const j = d.caretLine() - d.top;
    if (j >= 0 && j < NSHOWN) g.fill(Math.min(26 + d.caretTw(), 471), TVR.y + PITCH * j, 1, 9);
  }
}
/** CWindow's close box (SHELL 10.1). */
export function closeBoxLook(g, x, y, w) { g.setOp(OP_CLR); g.fill(x + w - 19, y + 1, 15, 7); g.setOp(OP_SET); g.frame(x + w - 18, y + 2, 13, 5); }
/** Write's window as drawn by W_UPDATE: the window look (active or not), the close box when active, the text view, the bar. */
export function writeLook(g, d, { focus = true, active = true, barValue = null } = {}) {
  wmWindowLook(g, { x: WINR.x, y: WINR.y, w: WINR.w, h: WINR.h, title: { codes: codesOf(WINR.title) } }, active);
  if (active) closeBoxLook(g, WINR.x, WINR.y, WINR.w);
  tvLook(g, d, focus);
  const b = d.bar();
  vsLook(g, { ...BARR, value: barValue ?? b.value, max: b.max, page: b.page }, 0);
}
/** The discard dialog (11.6): focusBtn 1 = Discard (the default, flags $11), 2 = Cancel (flags 1), 0 = none. */
export function dialogDraw(g, focusBtn) {
  dialogLook(g, { x: DLG.x, y: DLG.y, w: DLG.w, h: DLG.h });
  const l = DLG.label;
  labelLook(g, { x: l.x, y: l.y, w: l.w, h: l.h, flags: 0, text: { codes: codesOf(l.text) } });
  const a = DLG.discard, c = DLG.cancel;
  buttonLook(g, { x: a.x, y: a.y, w: a.w, h: a.h, flags: 0x11, text: { codes: codesOf(a.text) } }, focusBtn === 1);
  buttonLook(g, { x: c.x, y: c.y, w: c.w, h: c.h, flags: 1, text: { codes: codesOf(c.text) } }, focusBtn === 2);
}
/**
 * The whole screen: desk, the bar with "File", Write's window, then `covers` (plain Windows { x, y, w, h, title } in front, in order), then the dialog (focusBtn 0 / 1 / 2) when `dialog`.
 * Write has the active look (and its close box) only when nothing is in front of it; the caret only when `focus`.
 */
export function renderScreen(d, { focus = true, covers = [], dialog = null, barValue = null } = {}) {
  const g = new Gfx6Model();
  g.setOp(OP_CLR); g.fill(0, 8, 512, 184);
  drawBar(g, [FILE_MENU], layoutOf([FILE_MENU]));
  writeLook(g, d, { focus, active: covers.length === 0 && !dialog, barValue });
  covers.forEach((c, i) => wmWindowLook(g, { x: c.x, y: c.y, w: c.w, h: c.h, title: { codes: codesOf(c.title) } }, i === covers.length - 1 && !dialog));
  if (dialog) dialogDraw(g, dialog.focusBtn);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Generators for the tests
const LETTERS = codesOf('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ');
const MISC = codesOf('0123456789.,;:!?()-\'"');
/** Random text: words, spaces, runs of spaces (<= `maxRun`), long words, paragraph ends (13); `n` codes at most. */
export function genText(rng, n, { para = 0.04, longWord = 0.01, maxRun = 30 } = {}) {
  const out = [];
  while (out.length < n) {
    const r = rng.next();
    if (r < para) out.push(13);
    else if (r < para + 0.17) { const k = rng.chance(0.2) ? rng.int(2, maxRun) : 1; for (let i = 0; i < k; i++) out.push(32); }
    else if (r < para + 0.17 + longWord) { const k = rng.int(56, 130); for (let i = 0; i < k; i++) out.push(rng.pick(LETTERS)); }
    else { const k = rng.chance(0.15) ? rng.int(8, 16) : rng.int(1, 8); for (let i = 0; i < k; i++) out.push(rng.chance(0.9) ? rng.pick(LETTERS) : rng.pick(MISC)); }
  }
  return out.slice(0, n);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  const out = [], bad = selfTest(out);
  for (const l of out) console.log(l);
  console.log(bad ? `wr-model self-test: ${bad} FAILED` : 'wr-model self-test: all ok');
  if (bad) process.exitCode = 1;
}
/** Hand-worked cases (numbers worked on paper from 11.4 / 11.5; PROP6: 'W' 8, ' ' 4, 'i' 3, 'a' 7, 'b' 7, 'c' 6).  Returns the number that failed; `out` collects the lines. */
export function selfTest(out = []) {
  let bad = 0;
  const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; out.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`); };
  const rep = (s, n) => s.repeat(n);
  const lens = (s) => wrapAll(codesOf(s));
  eq('advances: W 8, space 4, i 3, a 7, b 7, c 6', [adv(87), adv(32), adv(105), adv(97), adv(98), adv(99)], [8, 4, 3, 7, 7, 6]);
  eq('empty document: one empty line', lens(''), [0]);
  eq('"ab": one line of 2', lens('ab'), [2]);
  eq('"ab" + 13: the last line is empty', lens('ab\r'), [3, 0]);
  eq('two empty paragraphs "\\r\\r": 1, 1, then the empty last line', lens('\r\r'), [1, 1, 0]);
  eq('55 W = 440 <= 444: one line', lens(rep('W', 55)), [55]);
  eq('56 W: a word wider than W breaks at the last code that fits (55)', lens(rep('W', 56)), [55, 1]);
  eq('60 W: [55, 5]', lens(rep('W', 60)), [55, 5]);
  eq('50 W, a space, 10 W: the 55th... the 5th W after the space fits (444), the 6th overflows: the line ends after the space', lens(rep('W', 50) + ' ' + rep('W', 10)), [51, 10]);
  eq('50 W, a space, 5 W: exactly 444: one line', lens(rep('W', 50) + ' ' + rep('W', 5)), [56]);
  eq('55 W + 5 spaces + W: the first space fits (444), the second overflows: the run of 5 stays on the line', lens(rep('W', 55) + rep(' ', 5) + 'W'), [60, 1]);
  eq('55 W + 2 spaces + 13: the 13 is not a space (R2): [57, 1, 0]', lens(rep('W', 55) + '  \r'), [57, 1, 0]);
  eq('a word wider than W after a space: "W" + space + 60 W: the space is the last one, the line ends after it', lens('W ' + rep('W', 60)), [2, 55, 5]);
  eq('300 spaces: the 112th overflows; the run goes on to the cap of 255, then 45 spaces fit (180)', lens(rep(' ', 300)), [255, 45]);
  eq('"ab\\rcd": a line ends at 13, included', lens('ab\rcd'), [3, 2]);
  eq('leading spaces then a long word: " " + 60 W: a space is the last space, the line ends after it', lens(' ' + rep('W', 60)), [1, 55, 5]);
  // the document, the caret, the shown rule
  {
    const d = new Doc();
    for (const c of codesOf('abc')) d.insert(c);
    eq('typing abc: caret 3, changed, one line', [d.caret, d.changed, d.nl, textOf(d.codes)], [3, true, 1, 'abc']);
    d.del(); eq('DELETE: "ab", caret 2', [textOf(d.codes), d.caret], ['ab', 2]);
    const e = new Doc(); eq('DELETE at 0 changes nothing, not changed (R5)', [e.del(), e.changed], [false, false]);
    eq('LEFT at 0 / RIGHT at L change nothing', [e.left(), e.right()], [false, false]);
    // click rule on "abc": r < 3 -> 0, 3..9 -> 1, 10..16 -> 2, >= 17 -> 3
    const c = new Doc(codesOf('abc'));
    eq('click rule: r = 2, 3, 9, 10, 16, 17', [2, 3, 9, 10, 16, 17].map((r) => c.posInLine(0, r)), [0, 1, 1, 2, 2, 3]);
    c.click(TEXTX + 9, 31); eq('click at px 36, row 31: caret 1', c.caret, 1);
    c.click(TEXTX + 100, 160); eq('click below the last line: the last line by x (R3): caret 3', c.caret, 3);
  }
  {
    // two lines [51, 10]: "WWWW...W " (50 W + space) then 10 W.  UP / DOWN with the target x.
    const d = new Doc(codesOf(rep('W', 50) + ' ' + rep('W', 10)), 51 + 3);
    eq('lines [51, 10]; caret 54 is in line 1 at tw 24', [d.lens, d.caretLine(), d.caretTw()], [[51, 10], 1, 24]);
    d.up(); eq('UP: target 24 -> line 0 position 3 (middle rule: r = 24 < 24 + 4? no: k = 3 gives pen 24, 24 < 28)', [d.caret, d.run], [3, 24]);
    d.up(); eq('UP on the first line: caret 0, run kept', [d.caret, d.run], [0, 24]);
    d.down(); eq('DOWN from line 0 keeps the target 24: line 1 position 51 + 3 = 54', d.caret, 54);
    d.down(); eq('DOWN on the last line: caret at L = 61, run kept', [d.caret, d.run], [61, 24]);
    d.left(); eq('LEFT ends the run', d.run, null);
    // line 0 ends with a space: its last position is 50 (before the space); a click far right in line 0 gives 50
    const e = new Doc(codesOf(rep('W', 50) + ' ' + rep('W', 10)));
    eq('last position of a non-last line is before its last code (50); of the last line L (61)', [e.lastPos(0), e.lastPos(1), e.posInLine(0, 999), e.posInLine(1, 999)], [50, 61, 50, 61]);
  }
  {
    // shown: 20 paragraphs
    const d = new Doc();
    for (let i = 0; i < 20; i++) d.insert(13);
    eq('20 ENTERs: 21 lines, caret in line 20, top = 20 - 15 = 5', [d.nl, d.caretLine(), d.top], [21, 20, 5]);
    for (let i = 0; i < 17; i++) d.up();
    eq('UP x 17: caret line 3 < top 5 -> top 3 (it followed the caret up)', [d.caretLine(), d.top], [3, 3]);
    eq('bar: M = 5, k 1, value 3, max 5, page 16', d.bar(), { value: 3, max: 5, page: 16 });
    eq('E_SCROLL 100: top = min(100, 5) = 5, the caret stays', [d.scrollTo(100), d.top, d.caretLine()], [true, 5, 3]);
    eq('the caret line 3 is above top 5: not drawn (tvLook)', (() => { const g = new Gfx6Model(); tvLook(g, d, true); return g.get(26, 30); })(), 0);
  }
  {
    // the bar's scale (11.5): M = 255 -> k 1 (255 <= 255); M = 256 -> k 2 (128); M = 511 -> k 2 (256 > 255 -> k 4: 128); check the three
    const mk = (n) => { const d = new Doc(); d.lens = new Array(n).fill(1); return d; };
    eq('M = 255 (271 lines): k 1', [mk(271).k, mk(271).bar()], [1, { value: 0, max: 255, page: 16 }]);
    eq('M = 256 (272 lines): k 2, max 128, page 8', [mk(272).k, mk(272).bar()], [2, { value: 0, max: 128, page: 8 }]);
    eq('M = 510 (526 lines): k 2, max 255', [mk(526).k, mk(526).bar().max], [2, 255]);
    eq('M = 511 (527 lines): k 4, max 128, page 4', [mk(527).k, mk(527).bar()], [4, { value: 0, max: 128, page: 4 }]);
    eq('M = 1008 (1024 lines): k 4, max 252', [mk(1024).k, mk(1024).bar().max], [4, 252]);
    const d = mk(527); d.starts = d.lens.map((_, i) => i); d.top = 9;
    eq('k 4, top 9: value floor(9 / 4) = 2; E_SCROLL 2 -> top 8', [d.bar().value, d.scrollTo(2), d.top], [2, true, 8]);
    eq('k 4: E_SCROLL 128 -> top = min(512, 511) = 511', [d.scrollTo(128), d.top], [true, 511]);
  }
  {
    // limits: a full document, 1,024 lines
    const d = new Doc(new Array(CAP).fill(97).map((c, i) => (i % 7 === 6 ? 32 : 97)), CAP);
    eq('full document: L = 5,120: insert refused, caret unchanged', [d.L, d.insert(98), d.caret, d.L], [CAP, false, CAP, CAP]);
    const e = new Doc(new Array(1022).fill(13), 1022);
    eq('1,023 lines: ENTER allowed -> 1,024 lines', [e.nl, e.insert(13), e.nl], [1023, true, 1024]);
    eq('1,024 lines: ENTER and a letter refused', [e.insert(13), e.insert(97), e.nl], [false, false, 1024]);
    eq('1,024 lines: DELETE allowed', [e.del(), e.nl], [true, 1023]);
  }
  {
    const g = new Gfx6Model(); const d = new Doc(codesOf('ab'), 1);
    tvLook(g, d, true);
    // caret at tw 7: x = 26 + 7 = 33, rows 30..38; the text 'a' at 27
    eq('caret column x = 33, rows 30..38; 32 and row 39 blank', [g.get(33, 30), g.get(33, 38), g.get(33, 39), g.get(32, 30)], [1, 1, 0, 0]);
    const h = new Gfx6Model(); const e = new Doc(codesOf('ab'), 2); tvLook(h, e, false);
    eq('not focused: no caret column at 40', [h.get(40, 30)], [0]);
    const caretOnly = new Doc(codesOf(rep('W', 60)), 60); const gg = new Gfx6Model(); tvLook(gg, caretOnly, true);
    eq('caret in line 1 (5 W = 40): x = 66, row 39..47', [gg.get(66, 39), gg.get(66, 47), gg.get(66, 48)], [1, 1, 0]);
  }
  return bad;
}
