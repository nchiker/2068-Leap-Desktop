"use strict";
// wr-model.mjs -- reference model of Write slices W1 and W2 (docs/WRITE.md sections 1-10, 11 and 12, incl. the two amendments of 2026-11-12 on 11.4 and 11.5).  Written from the contract
// only; src/apps/write.asm, src/apps/shell.asm and src/kernel/*.asm were never read.
//
//   node tests/wr-model.mjs --self-test      hand-worked cases of the model itself (tests/wr-w1.mjs runs the same cases as its group 0)
//
// What is here:
//   * the line wrapper of 11.4 (`lineLen`, `wrapAll`), PROP6 advances from the gfx6 model, W = 444, a line of at most 255 codes;
//   * `Doc`: the document, the caret, top, the changed flag and the "run" of UP / DOWN with its target x (11.1, 11.5): insert, DELETE, LEFT, RIGHT, UP, DOWN, click, E_SCROLL,
//     "New", the shown rule, the bar's (value, max, page) with the scale k of 11.5;
//   * the pixels (11.3, 12.3): `tvLook` (the text view alone, with the selection's XOR fill), `windowLook` of Write (CWindow: window look, close box, the text view, the bar),
//     `renderScreen` (desk, menu bar "File" "Edit", the window, covering plain windows, the discard dialog);
//   * W2 (12): the anchor and the mark (MARK = key 18), the selection, the clipboard (Write's own, max 2,048 codes, kept by "New"), the Edit menu's actions and enabled bits
//     (`Doc.cut / copy / paste / selectAll / editBits`), typing over a selection, the drag (`Doc.drag`), a click with the mark on.
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
//  W2 readings (each marked CONTRACT? where it is used; the generators stay away from the ones the contract does not settle):
//  R8.  MARK (18) is consumed and ends an UP / DOWN run.
//  R9.  A refused typed code with no selection changes nothing at all (as R5): the mark stays on.  A DELETE at 0 with no selection changes nothing: the mark stays on.
//  R10. A drag (E_MOVE with the capture) ends a run (it follows an E_DOWN, which already ended it).
//  R11. (coordinator, 2026-11-12) every Edit menu action that takes effect (Cut, Copy, Paste, Select all) ends the UP / DOWN run.  A Paste that is refused does nothing (R12); the generators do not send a refused Paste while a run is live.
//  R12. A Paste that is refused changes nothing: the selection, the mark and the run stay.
import { fileURLToPath } from 'node:url';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR, fonts } from './gfx6-model.mjs';
import { windowLook as wmWindowLook, buttonLook, labelLook, dialogLook, toDisp } from './wm-model2.mjs';
import { drawBar, layoutOf, menuSpec } from './wm-model3.mjs';
import { vsLook } from './tk-model.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR, toDisp };
export const CAP = 5120, MAXLINES = 1024, NSHOWN = 16, W = 444, MAXLINE = 255, PITCH = 9;
export const WINR = { x: 16, y: 16, w: 480, h: 168, title: 'Write: Untitled' };   // W3 (13.1): "Write: " and the name
export const TVR = { x: 24, y: 30, w: 448, h: 144 };
export const BARR = { x: 478, y: 28, w: 12, h: 148 };
export const TEXTX = 27;
export const DLG = { x: 128, y: 64, w: 256, h: 64, label: { x: 144, y: 76, w: 200, h: 9, text: 'Discard the document?' }, discard: { x: 224, y: 100, w: 64, h: 16, text: 'Discard' }, cancel: { x: 304, y: 100, w: 64, h: 16, text: 'Cancel' } };
export const FILE_MENU = menuSpec(1, 'File', [[1, 0, 'New'], [2, 0, 'Open...'], [3, 0, 'Save...']]);   // W3 (13.1)
export const KEY = { DELETE: 12, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, TAB: 14, BACKTAB: 15, MENU: 16, CLOSE: 17, MARK: 18, ESC: 27 };
export const CLIPMAX = 2048, CLIP_ADDR = 0x7800;
export const EDIT_MENU = menuSpec(2, 'Edit', [[1, 1, 'Cut'], [2, 1, 'Copy'], [3, 1, 'Paste'], [0, 2, ''], [4, 0, 'Select all']]);   // 12.4: flags bit 0 disabled at start, bit 1 separator
export const MENUS = [FILE_MENU, EDIT_MENU];
export const ITEM = { CUT: 1, COPY: 2, PASTE: 3, ALL: 4 };
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
  constructor(codes = [], caret = 0) {
    this.codes = codes.slice(); this.caret = caret; this.top = 0; this.changed = false; this.run = null;
    this.anchor = caret; this.mark = 0; this.clip = [];            // 12.2: anchor = caret, mark 0 at the start; 12.5: the clipboard is empty at each start (never mutated in place: clones share it)
    this.relayout();
  }
  /** "New" (11.6): the document emptied; the clipboard is kept (12.1). */
  reset() { this.codes = []; this.caret = 0; this.top = 0; this.changed = false; this.run = null; this.anchor = 0; this.mark = 0; this.relayout(); }
  clone() { const d = new Doc(this.codes, this.caret); d.top = this.top; d.changed = this.changed; d.run = this.run; d.anchor = this.anchor; d.mark = this.mark; d.clip = this.clip; return d; }
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
  // ---- the selection (12.2)
  get selStart() { return Math.min(this.anchor, this.caret); }
  get selEnd() { return Math.max(this.anchor, this.caret); }
  /** S, the selection's length. */
  get S() { return this.selEnd - this.selStart; }
  selCodes() { return this.codes.slice(this.selStart, this.selEnd); }
  /** The three state words the tests read back as one string (a change of any of them is a change of the document's state). */
  stamp() { return `${this.caret}/${this.anchor}/${this.mark}/${this.top}/${this.L}`; }
  // ---- the bar (11.5, amended)
  get M() { return Math.max(0, this.nl - NSHOWN); }
  get k() { for (const k of [1, 2, 4]) if (Math.ceil(this.M / k) <= 255) return k; return 4; }
  /** What the VScroll holds: value (TK_SETBAR stores min(A, max)), max, page. */
  bar() { const k = this.k, max = Math.ceil(this.M / k); return { value: Math.min(Math.floor(this.top / k), max), max, page: NSHOWN / k }; }
  /** top beyond the last full page: the state the contract does not settle (R6). */
  topBeyond() { return this.top > this.M; }
  // ---- 11.5 "Shown"
  shown() { const ln = this.caretLine(); if (ln < this.top) this.top = ln; else if (ln >= this.top + NSHOWN) this.top = ln - (NSHOWN - 1); }
  /** The selection deleted (12.4): caret = its start, anchor = caret, mark 0, changed, the run ended, rewrapped.  Not "shown" (the caller does that). */
  deleteSel() {
    const a = this.selStart, b = this.selEnd;
    this.codes.splice(a, b - a); this.caret = a; this.anchor = a; this.mark = 0; this.changed = true; this.run = null; this.relayout();
  }
  /** Typing / ENTER (12.4, 11.1).  Each key method returns true when anything (text, caret, anchor, mark, top) changed. */
  insert(c) {
    const had = this.S > 0;
    if (had) this.deleteSel();                                             // the deletion stands even when the insert is refused (12.4)
    if (this.canInsert()) {
      this.codes.splice(this.caret, 0, c); this.caret++; this.anchor = this.caret; this.mark = 0; this.changed = true; this.run = null; this.relayout();
    } else if (!had) return false;                                         // CONTRACT? a refused insert with no selection changes nothing, the mark stays on (R9)
    this.shown();
    return true;
  }
  del() {
    if (this.S > 0) this.deleteSel();
    else if (this.caret > 0) { this.codes.splice(this.caret - 1, 1); this.caret--; this.anchor = this.caret; this.mark = 0; this.changed = true; this.run = null; this.relayout(); }
    else return false;                                                     // CONTRACT? DELETE at 0 with no selection changes nothing: the mark stays on (R9)
    this.shown();
    return true;
  }
  /** LEFT (dir -1) / RIGHT (dir +1): 12.4's table. */
  hmove(dir) {
    const was = this.stamp(), a0 = this.anchor;
    this.run = null;
    if (this.mark === 0) {
      if (this.S > 0) this.caret = dir < 0 ? this.selStart : this.selEnd;
      else this.caret = clamp(this.caret + dir, 0, this.L);
      this.anchor = this.caret;
    } else this.caret = clamp(this.caret + dir, 0, this.L);
    const moved = this.stamp() !== was || this.anchor !== a0;
    if (moved) this.shown();                                               // as W1: a key that changes nothing does not scroll
    return moved;
  }
  left() { return this.hmove(-1); }
  right() { return this.hmove(1); }
  /** UP (dir -1) / DOWN (dir +1). */
  vmove(dir) {
    const was = this.stamp();
    if (this.mark === 0 && this.S > 0) this.caret = dir < 0 ? this.selStart : this.selEnd;           // the caret to the start / end, then W1's move from there
    const ln = this.caretLine();
    if (this.run === null) this.run = this.caretTw();
    this.caret = dir < 0 ? (ln === 0 ? 0 : this.posInLine(ln - 1, this.run)) : (ln === this.nl - 1 ? this.L : this.posInLine(ln + 1, this.run));
    if (this.mark === 0) this.anchor = this.caret;
    this.shown();
    return this.stamp() !== was;
  }
  up() { return this.vmove(-1); }
  down() { return this.vmove(1); }
  /** MARK (12.4's first row). */
  markKey() {
    const was = this.stamp();
    this.run = null;
    if (this.mark === 0) this.mark = 1; else { this.mark = 0; this.anchor = this.caret; }
    return this.stamp() !== was;
  }
  /** E_DOWN in the text view at (px, py) (12.4: mark 0: anchor = caret; mark 1: the anchor stays; the mark unchanged). */
  click(px, py) {
    const was = this.stamp();
    const j = this.top + Math.floor((py - TVR.y) / PITCH), ln = Math.min(j, this.nl - 1);
    this.run = null; this.caret = this.posInLine(ln, px - TEXTX);
    if (this.mark === 0) this.anchor = this.caret;
    this.shown();
    return this.stamp() !== was;
  }
  /** E_MOVE with the capture (12.4): the line clamped to the lines shown, no autoscroll; the anchor stays. */
  drag(px, py) {
    const was = this.stamp();
    let j = py >= TVR.y ? this.top + Math.floor((py - TVR.y) / PITCH) : this.top;
    j = Math.min(j, this.top + NSHOWN - 1, this.nl - 1);
    this.run = null;                                                       // CONTRACT? a drag ends a run (it follows an E_DOWN, which has already)
    this.caret = this.posInLine(j, px - TEXTX);
    return this.stamp() !== was;
  }
  /** E_SCROLL with the bar's value v: top = min(v x k, M); the caret and the selection do not move (12.2). */
  scrollTo(v) { const t = Math.min(v * this.k, this.M), ch = t !== this.top; this.top = t; return ch; }
  /** A key that is not consumed. */
  other() { this.run = null; return false; }
  /** One of the keys of the table in section 4 / 12.4 (32-126, 13, 12, 8, 9, 10, 11, 18); returns changed. */
  key(code) {
    if ((code >= 32 && code <= 126) || code === 13) return this.insert(code);
    switch (code) { case KEY.DELETE: return this.del(); case KEY.LEFT: return this.left(); case KEY.RIGHT: return this.right(); case KEY.DOWN: return this.down(); case KEY.UP: return this.up(); case KEY.MARK: return this.markKey(); default: return this.other(); }
  }
  static consumes(code) { return (code >= 32 && code <= 126) || [8, 9, 10, 11, 12, 13, 18].includes(code); }
  // ---- the Edit menu (12.4)
  /** The enabled bits of the items 1-5 (Cut, Copy, Paste, the separator, Select all). */
  editEnabled() { return [this.S >= 1 && this.S <= CLIPMAX, this.S >= 1 && this.S <= CLIPMAX, this.clip.length >= 1, false, true]; }
  /** The menu entry's enable word as the kernel keeps it (WINDOWS 8 / 18; bit n - 1 - k for item k of n = 5). */
  editBits() { return this.editEnabled().reduce((w, e, k) => w | (e ? 1 << (4 - k) : 0), 0); }
  /** The lines of the text a Paste of the clipboard would leave (the selection replaced) and its length. */
  pasteResult() {
    const a = this.selStart, b = this.selEnd, codes = this.codes.slice(0, a).concat(this.clip, this.codes.slice(b));
    return { codes, n: codes.length, lines: wrapAll(codes).length };
  }
  pasteOk() { if (this.clip.length < 1) return false; const r = this.pasteResult(); return r.n <= CAP && r.lines <= MAXLINES; }
  /** E_MENU 2, `item`: returns false when the item is disabled (the kernel never sends it: nothing is done) or does nothing (a refused Paste). */
  menuItem(item) {
    const en = this.editEnabled();
    if (item < 1 || item > 4 || !en[item === ITEM.ALL ? 4 : item - 1]) return false;      // item ids 1-3, then the separator (id 0), then Select all (id 4)
    const was = this.stamp();
    if (item === ITEM.CUT) { this.clip = this.selCodes(); this.deleteSel(); this.shown(); }
    else if (item === ITEM.COPY) { this.clip = this.selCodes(); this.mark = 0; this.run = null; }          // the selection is kept (12.4); every menu action ends a run (R11)
    else if (item === ITEM.PASTE) {
      if (!this.pasteOk()) return false;                                                    // CONTRACT? a refused Paste changes nothing at all, the run too (R12)
      const r = this.pasteResult(), a = this.selStart;
      this.codes = r.codes; this.caret = a + this.clip.length; this.anchor = this.caret; this.mark = 0; this.changed = true; this.run = null; this.relayout(); this.shown();
    } else { this.anchor = 0; this.caret = this.L; this.mark = 0; this.run = null; this.shown(); }           // every menu action ends a run (R11)
    return true;
  }
  /** E_MENU 1, 1 ("New") on a document that is not changed (no dialog): 11.6 + 12.1 (the clipboard is kept). */
  newDoc() { this.reset(); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The pixels (11.3)
/** 12.3: the XOR fill (x0, y, x1 - x0, 9) of the selected part of display line t (its y band j), or null.  [a, b) is the selection. */
export function selRect(d, t, j) {
  const a = d.selStart, b = d.selEnd, s = d.starts[t], n = d.lens[t], a1 = Math.max(a, s), b1 = Math.min(b, s + n);
  if (a1 >= b1) return null;
  const x0 = Math.min(26 + tw(d.codes, s, a1), 471);
  const x1 = (b1 === s + n && t !== d.nl - 1) ? 472 : Math.min(27 + tw(d.codes, s, b1), 472);   // the line's last code selected, not the last line: to the right edge
  return { x: x0, y: TVR.y + PITCH * j, w: x1 - x0, h: 9 };
}
/** The text view alone: 16 bands CLR, the lines' text SET, the selection XOR (12.3, after the text, focus or not), the caret SET when `focus` and the selection is empty. */
export function tvLook(g, d, focus) {
  g.setOp(OP_CLR); g.fill(TVR.x, TVR.y, TVR.w, TVR.h);
  g.setOp(OP_SET);
  const nl = d.nl;
  for (let j = 0; j < NSHOWN; j++) { const i = d.top + j; if (i < nl) { const t = d.lineText(i); if (t.length) g.textp(TEXTX, TVR.y + PITCH * j, t); } }
  if (d.S > 0) {
    g.setOp(OP_XOR);
    for (let j = 0; j < NSHOWN; j++) { const i = d.top + j; if (i < nl) { const r = selRect(d, i, j); if (r) g.fill(r.x, r.y, r.w, r.h); } }
    g.setOp(OP_SET);
  } else if (focus) {
    const j = d.caretLine() - d.top;
    if (j >= 0 && j < NSHOWN) g.fill(Math.min(26 + d.caretTw(), 471), TVR.y + PITCH * j, 1, 9);
  }
}
/** CWindow's close box (SHELL 10.1). */
export function closeBoxLook(g, x, y, w) { g.setOp(OP_CLR); g.fill(x + w - 19, y + 1, 15, 7); g.setOp(OP_SET); g.frame(x + w - 18, y + 2, 13, 5); }
/** Write's window as drawn by W_UPDATE: the window look (active or not), the close box when active, the text view, the bar. */
export function writeLook(g, d, { focus = true, active = true, barValue = null, title = WINR.title } = {}) {
  wmWindowLook(g, { x: WINR.x, y: WINR.y, w: WINR.w, h: WINR.h, title: { codes: codesOf(title) } }, active);
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
 * The whole screen: desk, the bar with "File" and "Edit" (W2; `menus` [FILE_MENU] for a W1 build), Write's window, then `covers` (plain Windows { x, y, w, h, title } in front, in order), then the dialog (focusBtn 0 / 1 / 2) when `dialog`.
 * Write has the active look (and its close box) only when nothing is in front of it; the caret only when `focus`.
 */
export function renderScreen(d, { focus = true, covers = [], dialog = null, barValue = null, menus = MENUS, title = WINR.title } = {}) {
  const g = new Gfx6Model();
  g.setOp(OP_CLR); g.fill(0, 8, 512, 184);
  drawBar(g, menus, layoutOf(menus));
  writeLook(g, d, { focus, active: covers.length === 0 && !dialog, barValue, title });
  covers.forEach((c, i) => wmWindowLook(g, { x: c.x, y: c.y, w: c.w, h: c.h, title: { codes: codesOf(c.title) } }, i === covers.length - 1 && !dialog));
  if (dialog) { if (dialog.draw) dialog.draw(g); else dialogDraw(g, dialog.focusBtn); }      // W3: `dialog.draw(g)` draws the Save dialog or the alert instead of the discard dialog
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
  // ======================================================================================================================================================
  // W2 (docs/WRITE.md 12): hand-worked cases.  PROP6 again: W 8, space 4, i 3, a 7, b 7, c 6, x 7, e 7, d 7.
  const mk = (s, caret, anchor = caret, mark = 0) => { const d = new Doc(codesOf(s), caret); d.anchor = anchor; d.mark = mark; return d; };
  const st = (d) => [d.caret, d.anchor, d.mark];
  const T2 = rep('W', 50) + ' ' + rep('W', 10);                          // lines [51, 10]; line 1 starts at 51; a W is 8 wide
  const mk2 = (caret, anchor = caret, mark = 0) => mk(T2, caret, anchor, mark);
  eq('12.2: a new document: anchor = caret, mark 0, an empty clipboard (C = 0)', [new Doc().anchor, new Doc().mark, new Doc().clip.length, new Doc(codesOf('abc'), 2).anchor], [0, 0, 0, 2]);
  eq('12.1: MARK is key code 18 and is consumed (the other unlisted keys are not)', [KEY.MARK, Doc.consumes(18), Doc.consumes(17), Doc.consumes(16), Doc.consumes(19)], [18, true, false, false, false]);
  // ---- 12.4 table: MARK
  { const d = mk('abcdef', 3); d.key(18); eq('12.4 MARK, mark 0 and empty: mark 1, anchor = caret', st(d), [3, 3, 1]); }
  { const d = mk('abcdef', 4, 1); d.key(18); eq('12.4 MARK, mark 0 and a selection: mark 1, the anchor kept', st(d), [4, 1, 1]); }
  { const d = mk('abcdef', 4, 1, 1); d.key(18); eq('12.4 MARK, mark 1: mark 0, anchor = caret (the selection cleared)', st(d), [4, 4, 0]); }
  { const d = mk2(54); d.key(11); const r1 = d.run; d.key(18); eq('12.4 MARK ends an UP / DOWN run (any other key does)', [r1, d.run], [24, null]); }
  // ---- LEFT / RIGHT
  { const d = mk('abcdef', 3); d.key(8); const a = st(d); d.key(9); d.key(9); eq('12.4 LEFT / RIGHT, mark 0 and empty: as W1, anchor = caret', [a, st(d)], [[2, 2, 0], [4, 4, 0]]); }
  { const d = mk('abcdef', 4, 1), e = mk('abcdef', 4, 1); d.key(8); e.key(9); eq('12.4 LEFT / RIGHT, mark 0, a selection (anchor 1 < caret 4): LEFT to the start, RIGHT to the end, anchor = caret', [st(d), st(e)], [[1, 1, 0], [4, 4, 0]]); }
  { const d = mk('abcdef', 1, 4), e = mk('abcdef', 1, 4); d.key(8); e.key(9); eq('12.4 LEFT / RIGHT, mark 0, a selection (anchor 4 > caret 1): LEFT to the start (1), RIGHT to the end (4)', [st(d), st(e)], [[1, 1, 0], [4, 4, 0]]); }
  { const d = mk('abcdef', 3, 3, 1); d.key(8); const a = st(d); d.key(9); d.key(9); const b = st(d); eq('12.4 LEFT / RIGHT, mark 1: the caret moves, the anchor stays', [a, b], [[2, 3, 1], [4, 3, 1]]); }
  { const d = mk('abcdef', 0, 0, 1), e = mk('abcdef', 6, 6, 1); eq('12.4 LEFT at 0 / RIGHT at L with mark 1: nothing moves (returns false), mark stays', [d.key(8), st(d), e.key(9), st(e)], [false, [0, 0, 1], false, [6, 6, 1]]); }
  // ---- UP / DOWN (T2: lines [51, 10], a W is 8 wide)
  { const d = mk2(54); d.key(11); eq('12.4 UP, mark 0 and empty: as W1 (tw 24 -> position 3), anchor = caret', [st(d), d.run], [[3, 3, 0], 24]); }
  { const d = mk2(58, 2); d.key(11); eq('12.4 UP, mark 0, a selection (anchor 2, caret 58): the caret to the start (2), then UP from line 0 puts it at 0; run = tw(2) = 16', [st(d), d.run], [[0, 0, 0], 16]); }
  { const d = mk2(2, 58); d.key(10); eq('12.4 DOWN, mark 0, a selection (anchor 58, caret 2): the caret to the end (58, line 1 = the last), then DOWN at the last line gives L = 61; run = tw(58) = 56', [st(d), d.run], [[61, 61, 0], 56]); }
  { const d = mk2(20, 3); d.key(10); eq('12.4 DOWN, mark 0, a selection inside line 0 (anchor 3, caret 20): the caret to 20 (tw 160), then DOWN: line 1 is 80 wide, so its last position, L = 61', [st(d), d.run], [[61, 61, 0], 160]); }
  { const d = mk2(55, 52); d.key(11); eq('12.4 UP, mark 0, a selection in line 1 (anchor 52, caret 55): the caret to 52 (tw 8), UP: position 1 of line 0', [st(d), d.run], [[1, 1, 0], 8]); }
  { const d = mk2(54, 2, 1); d.key(11); const a = [st(d), d.run]; d.key(10); eq('12.4 UP / DOWN, mark 1: the caret moves as W1 with the target x kept, the anchor stays (anchor 2)', [a, st(d), d.run], [[[3, 2, 1], 24], [54, 2, 1], 24]); }
  { const d = mk2(54, 2, 1); d.key(11); d.key(8); eq('12.4 a LEFT with the mark on ends the run', d.run, null); }
  // ---- typing, ENTER
  { const d = mk('abcdef', 3); d.key(120); eq('12.4 typing, mark 0 and empty: as W1', [textOf(d.codes), st(d), d.changed], ['abcxdef', [4, 4, 0], true]); }
  { const d = mk('abcdef', 4, 1), e = mk('abcdef', 1, 4); d.key(120); e.key(120); eq('12.4 typing over a selection [1, 4): "bcd" deleted, then x inserted (both anchor orders)', [textOf(d.codes), st(d), d.changed, textOf(e.codes), st(e)], ['axef', [2, 2, 0], true, 'axef', [2, 2, 0]]); }
  { const d = mk('abcdef', 4, 1); d.key(13); eq('12.4 ENTER over a selection: the selection deleted, a 13 inserted', [textOf(d.codes), st(d), d.nl], ['a\ref', [2, 2, 0], 2]); }
  { const d = mk('abcdef', 3, 3, 1); d.key(120); eq('12.4 typing, mark 1 and empty: inserted, anchor = caret, mark 0 (12.2: every edit)', [textOf(d.codes), st(d)], ['abcxdef', [4, 4, 0]]); }
  { const d = mk('abcdef', 4, 1, 1); d.key(120); eq('12.4 typing, mark 1 and a selection: as with mark 0', [textOf(d.codes), st(d)], ['axef', [2, 2, 0]]); }
  { const d = mk('abc' + '\r'.repeat(1023), 3, 1); const nl0 = d.nl; d.key(120); eq('12.4 typing over a selection at 1,024 lines: the deletion stands, nothing is inserted (W1 rule)', [nl0, d.nl, d.L, st(d), d.changed, d.codes[1]], [1024, 1024, 1024, [1, 1, 0], true, 13]); }
  { const d = mk('\r'.repeat(1023), 1, 0); const nl0 = d.nl; d.key(120); eq('12.4 typing over a selection of one 13 at 1,024 lines: 1,023 lines remain, so x is inserted', [nl0, d.nl, d.L, textOf(d.codes.slice(0, 2)), st(d)], [1024, 1023, 1023, 'x\r', [1, 1, 0]]); }
  { const t = codesOf('ab '.repeat(1707)).slice(0, CAP), d = new Doc(t, CAP); d.anchor = CAP - 120; d.key(120); eq('12.4 typing over a selection in a full document (L = 5,120): deleted, then inserted: L = 5,001', [d.L, d.codes[CAP - 120], d.caret], [CAP - 119, 120, CAP - 119]); }
  { const t = codesOf('ab '.repeat(1707)).slice(0, CAP), d = new Doc(t, CAP), L0 = d.L; eq('12.4 / R9: a typed code in a full document with no selection changes nothing (mark stays on)', [(d.mark = 1, d.key(120)), d.L, st(d), d.changed], [false, L0, [CAP, CAP, 1], false]); }
  // ---- DELETE
  { const d = mk('abcdef', 3); d.key(12); eq('12.4 DELETE, mark 0 and empty: as W1', [textOf(d.codes), st(d)], ['abdef', [2, 2, 0]]); }
  { const d = mk('abcdef', 4, 1), e = mk('abcdef', 1, 4); d.key(12); e.key(12); eq('12.4 DELETE, mark 0, a selection: deleted, caret = its start (both anchor orders)', [textOf(d.codes), st(d), d.changed, textOf(e.codes), st(e)], ['aef', [1, 1, 0], true, 'aef', [1, 1, 0]]); }
  { const d = mk('abcdef', 3, 3, 1); d.key(12); eq('12.4 DELETE, mark 1 and empty: as W1, mark 0', [textOf(d.codes), st(d)], ['abdef', [2, 2, 0]]); }
  { const d = mk('abcdef', 4, 1, 1); d.key(12); eq('12.4 DELETE, mark 1 and a selection: deleted', [textOf(d.codes), st(d)], ['aef', [1, 1, 0]]); }
  { const d = mk('abcdef', 0, 0, 1); eq('12.4 / R9 DELETE at 0 with no selection: nothing changes (mark stays on, not changed)', [d.key(12), st(d), d.changed], [false, [0, 0, 1], false]); }
  // ---- the pointer
  { const d = mk('ab', 2), px = TEXTX + 6; d.click(px, 31); eq('12.4 E_DOWN, mark 0: caret at the click (r = 6: position 1), anchor = caret', st(d), [1, 1, 0]); }
  { const d = mk('ab', 0, 0, 1); d.click(TEXTX + 20, 31); eq('12.4 E_DOWN, mark 1: the anchor stays, the caret moves, mark unchanged (a click extends)', st(d), [2, 0, 1]); }
  { const d = mk('ab', 1, 0, 0); d.click(TEXTX + 20, 31); eq('12.4 E_DOWN, mark 0 with a selection: the selection is replaced by an empty one at the click', st(d), [2, 2, 0]); }
  { const d = new Doc(codesOf('\r'.repeat(19)), 0); d.click(30, 31); d.drag(100, 30 + 9 * 17 + 2); eq('12.4 E_MOVE (a drag) is clamped to the lines shown: py in line 17 -> line 15 (top 0); the anchor stays 0', [d.caret, d.anchor], [15, 0]); }
  { const d = new Doc(codesOf('\r'.repeat(19)), 0); d.top = 3; d.click(30, 31); d.drag(100, 10); eq('12.4 E_MOVE above the text view (py < 30): the line top = 3', [d.caret, d.anchor, d.top], [3, 3, 3]); d.drag(100, 191); eq('12.4 E_MOVE below: top + 15 = line 18 (no autoscroll: top stays 3)', [d.caret, d.top], [18, 3]); }
  { const d = new Doc(codesOf('\r\r\r\r'), 0); d.click(30, 31); d.drag(100, 170); eq('12.4 E_MOVE below the last line: the last line (5 lines: line 4, position L = 4)', [d.caret, d.anchor], [4, 0]); }
  { const d = new Doc(codesOf('abc'), 0); d.click(TEXTX, 31); d.drag(511, 31); const a = d.caret; d.drag(0, 31); eq('12.4 E_MOVE at px 511 / 0: the last position / position 0 of the line', [a, d.caret, d.anchor], [3, 0, 0]); }
  { const d = new Doc(codesOf('\r'.repeat(30)), 0); d.click(30, 31); d.drag(100, 31 + 9 * 7); const c1 = [d.caret, d.top]; d.scrollTo(4); eq('12.2 E_SCROLL changes neither the selection nor the mark', [c1, d.caret, d.anchor, d.mark, d.top], [[7, 0], 7, 0, 0, 4]); }
  // ---- the Edit menu, the clipboard
  eq('12.4 the Edit menu: items Cut 1, Copy 2, Paste 3, a separator (never enabled), Select all 4; flags 1, 1, 1, 2, 0', EDIT_MENU.items.map((i) => [i.id, i.flags]), [[1, 1], [2, 1], [3, 1], [0, 2], [4, 0]]);
  eq('12.4 enabled bits at the start: only Select all (bit 0 of the entry\'s word, n - 1 - k with n = 5, k = 4)', [new Doc().editBits(), new Doc().editEnabled()], [1, [false, false, false, false, true]]);
  { const d = mk('abcdef', 4, 1); eq('12.4 enabled bits with a selection (S = 3), no clipboard: Cut, Copy and Select all', d.editBits(), 0x10 | 0x08 | 0x01); d.clip = codesOf('q'); eq('... and Paste with a clipboard', d.editBits(), 0x1D); }
  { const d = mk('abcdef', 3); d.clip = codesOf('q'); eq('12.4 an empty selection: Cut and Copy disabled, Paste enabled (C >= 1)', d.editBits(), 0x05); }
  { const d = mk('abcdef', 4, 1); d.menuItem(ITEM.CUT); eq('12.4 Cut: clipboard "bcd", the selection deleted, caret = start, mark 0, changed', [textOf(d.clip), textOf(d.codes), st(d), d.changed], ['bcd', 'aef', [1, 1, 0], true]); }
  { const d = mk('abcdef', 1, 4, 1); d.menuItem(ITEM.COPY); eq('12.4 Copy: clipboard "bcd", the selection kept (anchor 4, caret 1), mark 0, not changed', [textOf(d.clip), textOf(d.codes), st(d), d.changed], ['bcd', 'abcdef', [1, 4, 0], false]); }
  { const d = mk('abcdef', 3); eq('12.4 Cut / Copy with S = 0 are disabled: the kernel never sends them (menuItem false, nothing done)', [d.menuItem(ITEM.CUT), d.menuItem(ITEM.COPY), d.menuItem(ITEM.PASTE), d.clip.length], [false, false, false, 0]); }
  { const d = mk('abcdef', 2); d.clip = codesOf('XY'); d.menuItem(ITEM.PASTE); eq('12.4 Paste, empty selection: inserted at the caret, caret after, anchor = caret, changed', [textOf(d.codes), st(d), d.changed], ['abXYcdef', [4, 4, 0], true]); }
  { const d = mk('abcdef', 4, 1, 1); d.clip = codesOf('XY'); d.menuItem(ITEM.PASTE); eq('12.4 Paste over a selection [1, 4): deleted, then the 2 codes inserted at 1; mark 0', [textOf(d.codes), st(d)], ['aXYef', [3, 3, 0]]); }
  { const d = mk('abcdef', 2); d.menuItem(ITEM.ALL); const a = st(d); d.mark = 1; d.menuItem(ITEM.ALL); eq('12.4 Select all: anchor 0, caret L, mark 0 (also with the mark on)', [a, st(d)], [[6, 0, 0], [6, 0, 0]]); }
  { const d = new Doc(); d.menuItem(ITEM.ALL); eq('12.4 Select all in an empty document: an empty selection (Cut / Copy stay disabled)', [st(d), d.editBits()], [[0, 0, 0], 1]); }
  { const d = new Doc(codesOf('\r'.repeat(39)), 0); d.menuItem(ITEM.ALL); eq('12.4 Select all in a 40-line document, top 0: the view follows the caret (line 39): top = 39 - 15 = 24', [d.caret, d.anchor, d.top], [39, 0, 24]); }
  { const d = mk('abcdef', 4, 1); d.clip = codesOf('keep'); d.mark = 1; d.codes = codesOf('xyz'); d.caret = d.anchor = 2; d.reset(); eq('12.1 "New" keeps the clipboard, clears the rest (caret, anchor, mark, top, changed)', [textOf(d.clip), d.L, st(d), d.top, d.changed], ['keep', 0, [0, 0, 0], 0, false]); }
  // ---- selections of 2,048 and 2,049 codes; Paste's limits
  { const t = codesOf('ab '.repeat(700)), d = new Doc(t, 0), e = new Doc(t, 0);        // 2,100 codes
    d.anchor = 0; d.caret = 2048; e.anchor = 0; e.caret = 2049;
    eq('12.4 a selection of 2,048 codes: Cut and Copy enabled; of 2,049: disabled (Select all and Paste as before)', [d.S, d.editBits(), e.S, e.editBits()], [2048, 0x19, 2049, 0x01]);
    d.menuItem(ITEM.COPY); eq('12.5 Copy of 2,048 codes: the clipboard holds exactly the codes', [d.clip.length, d.clip.every((c, i) => c === t[i])], [2048, true]);
    eq('12.4 a refused Cut of 2,049 codes (disabled): nothing done', [e.menuItem(ITEM.CUT), e.L], [false, 2100]);
    d.mark = 0; d.anchor = d.caret = 2100; eq('12.4 Paste of 2,048 codes into 2,100: 4,148, accepted (and the selection of Select all: 2,100 > 2,048, Cut disabled)', [d.menuItem(ITEM.PASTE), d.L], [true, 4148]); }
  { const mkL = (n) => new Doc(codesOf('ab '.repeat(Math.ceil(n / 3))).slice(0, n), 0);
    const d = mkL(5100); d.clip = codesOf('ab '.repeat(7)).slice(0, 20); eq('12.4 Paste: 5,100 + 20 = 5,120 codes is accepted', [d.pasteOk(), d.menuItem(ITEM.PASTE), d.L], [true, true, 5120]);
    const e = mkL(5100); e.clip = codesOf('ab '.repeat(7)).slice(0, 21); const was = [e.L, st(e)]; eq('12.4 Paste: 5,100 + 21 = 5,121 is refused, nothing changes', [e.pasteOk(), e.menuItem(ITEM.PASTE), e.L, st(e), was[0]], [false, false, 5100, was[1], 5100]);
    const f = mkL(5100); f.anchor = 10; f.caret = 20; f.clip = codesOf('ab '.repeat(10)).slice(0, 30);
    const g = mkL(5100); g.anchor = 10; g.caret = 20; g.clip = codesOf('ab '.repeat(11)).slice(0, 31);
    eq('12.4 Paste over a selection of 10: 5,100 - 10 + 30 = 5,120 is accepted; 31 codes (5,121) is refused', [f.pasteOk(), g.pasteOk()], [true, false]); }
  { const d = new Doc(codesOf('\r'.repeat(1019)), 1019); d.clip = codesOf('\r\r\r\r'); eq('12.4 Paste: 1,020 lines + 4 paragraph ends = 1,024 lines is accepted', [d.nl, d.pasteOk(), d.pasteResult().lines], [1020, true, 1024]);
    d.clip = codesOf('\r\r\r\r\r'); eq('12.4 Paste: 5 paragraph ends = 1,025 lines is refused, nothing changes (selection and mark too)', [d.pasteOk(), d.menuItem(ITEM.PASTE), d.L, st(d)], [false, false, 1019, [1019, 1019, 0]]); }
  { const d = new Doc(codesOf('\r'.repeat(1022)), 1022); d.clip = codesOf('W'.repeat(56)); eq('12.4 Paste\'s line check is exact (wrapped by 11.4): 1,022 lines of 13 + 56 W = [55, 1]: 1,024 lines accepted', [d.pasteResult().lines, d.pasteOk()], [1024, true]);
    d.clip = codesOf('W'.repeat(111)); eq('... 111 W = [55, 55, 1]: 1,025 lines refused (a count of the paragraph ends alone would accept it)', [d.pasteResult().lines, d.pasteOk()], [1025, false]);
    d.clip = codesOf('W'.repeat(55) + '\r'); eq('... 55 W + 13: the text ends with a 13, so one empty line more: 1,022 + 1 + 1 = 1,024 accepted', [d.pasteResult().lines, d.pasteOk()], [1024, true]);
    d.clip = codesOf('W'.repeat(55) + '\r\r'); eq('... 55 W + 13 13: 1,025 refused', [d.pasteResult().lines, d.pasteOk()], [1025, false]); }
  { const d = new Doc(codesOf('\r'.repeat(1023)), 1); d.anchor = 0; d.clip = codesOf('\r'); eq('12.4 Paste at 1,024 lines replacing one 13 by one 13: the result has 1,024 lines (at most 1,024): accepted', [d.nl, d.pasteOk(), d.menuItem(ITEM.PASTE), d.L, d.nl], [1024, true, true, 1023, 1024]); }
  // ---- 12.3: the selection pixels (XOR fill after the text; the caret only when the selection is empty)
  {
    const look = (d, focus = true) => { const g = new Gfx6Model(); tvLook(g, d, focus); return g; };
    /** The pixel rectangles of the view in which `d`'s look differs from the same text with no selection and no caret. */
    const flipped = (d, rect) => {
      const e = d.clone(); e.anchor = e.caret; const a = look(d), b = look(e, false);
      for (let y = TVR.y - 2; y < TVR.y + TVR.h + 2; y++) for (let x = TVR.x - 2; x < TVR.x + TVR.w + 2; x++) {
        const inR = x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h, inTv = x >= TVR.x && x < TVR.x + TVR.w && y >= TVR.y && y < TVR.y + TVR.h;
        const want = inR ? 1 - b.get(x, y) : b.get(x, y);
        if (inTv && a.get(x, y) !== want) return false;
      }
      return true;
    };
    const d1 = mk('ab\rcd', 3, 0);
    eq('12.3 x1 = 472: line 0 "ab" + 13 selected (not the last line): fill (26, 30, 446, 9); no caret is drawn', [selRect(d1, 0, 0), selRect(d1, 1, 1), flipped(d1, { x: 26, y: 30, w: 446, h: 9 }), look(d1).get(26, 39)], [{ x: 26, y: 30, w: 446, h: 9 }, null, true, 0]);
    const d2 = mk('ab\rcd', 2, 0);
    eq('12.3 selection [0, 2) = "ab" before the 13: x1 = 27 + tw = 41: fill (26, 30, 15, 9)', [selRect(d2, 0, 0), flipped(d2, { x: 26, y: 30, w: 15, h: 9 })], [{ x: 26, y: 30, w: 15, h: 9 }, true]);
    const d3 = mk('xx\rab', 5, 3);
    eq('12.3 the last line: [3, 5) = "ab", b\' = s + n but it is the last line: x1 = 27 + 14 = 41: fill (26, 39, 15, 9)', [selRect(d3, 1, 1), flipped(d3, { x: 26, y: 39, w: 15, h: 9 })], [{ x: 26, y: 39, w: 15, h: 9 }, true]);
    const d4 = mk('ab\rcd\rxy', 7, 1);
    eq('12.3 over three lines: [1, 7): line 0 from the blank column before "b" (26 + 7 = 33) to 472; line 1 whole; the last line "x" to 27 + 7 = 34', [selRect(d4, 0, 0), selRect(d4, 1, 1), selRect(d4, 2, 2)],
      [{ x: 33, y: 30, w: 439, h: 9 }, { x: 26, y: 39, w: 446, h: 9 }, { x: 26, y: 48, w: 8, h: 9 }]);
    const d5 = mk(rep('W', 55) + rep(' ', 5) + 'W', 60, 57);
    eq('12.3 x0 clamped at 471 (the overflow spaces start at 26 + 448 = 474), line 0 of [60, 1] not the last line: x1 = 472: fill (471, 30, 1, 9)', [d5.lens, selRect(d5, 0, 0), selRect(d5, 1, 1)], [[60, 1], { x: 471, y: 30, w: 1, h: 9 }, null]);
    const d6 = mk(rep('W', 55) + rep(' ', 5), 60, 57);
    eq('12.3 x0 clamped at 471, x1 clamped at 472 on the last line (27 + 460 = 487): fill (471, 30, 1, 9)', [d6.lens, selRect(d6, 0, 0)], [[60], { x: 471, y: 30, w: 1, h: 9 }]);
    const d7 = mk(rep('W', 55) + rep(' ', 5) + 'W', 58, 56);
    eq('12.3 [56, 58): x0 = 26 + 440 + 4 = 470, b\' = 58 < 60: x1 = min(27 + 448, 472) = 472: fill (470, 30, 2, 9)', selRect(d7, 0, 0), { x: 470, y: 30, w: 2, h: 9 });
    const d8 = mk('\r\rab', 1, 0);
    eq('12.3 [0, 1) = the first lone 13: fill (26, 30, 446, 9)', selRect(d8, 0, 0), { x: 26, y: 30, w: 446, h: 9 });
    const e1 = mk('ab', 1, 0);
    eq('12.3 the caret only when the selection is empty; the selection shows with or without focus', [look(e1, true).px.join() === look(e1, false).px.join(), look(mk('ab', 1, 1), true).get(33, 30), look(mk('ab', 1, 1), false).get(33, 30)], [true, 1, 0]);
    const e2 = new Doc(codesOf('\r'.repeat(19)), 3); e2.anchor = 0; e2.top = 5; const e3 = e2.clone(); e3.anchor = e3.caret;
    eq('12.3 lines not shown draw no selection (top 5, the selection [0, 3) is in lines 0-3): the look equals the look with no selection', look(e2).px.join() === look(e3).px.join(), true);
  }
  { const mkRun = () => { const d = mk2(54, 2, 1); d.run = 24; return d; };    // a live run, selection [2, 54)
    const runs = [ITEM.COPY, ITEM.ALL, ITEM.CUT, ITEM.PASTE].map((it) => { const d = mkRun(); d.clip = codesOf('q'); d.menuItem(it); return d.run; });
    eq('R11 (coordinator): every Edit action that takes effect (Copy, Select all, Cut, Paste) ends the UP / DOWN run', runs, [null, null, null, null]); }
  return bad;
}
