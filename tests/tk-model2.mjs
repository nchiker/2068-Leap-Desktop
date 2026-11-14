"use strict";
// tk-model2.mjs -- reference model of toolkit slices T2 (List) and T3 (Field): docs/TOOLKIT.md section 10 (with 1-9 and the kernel's routing, OBJECTS_EVENTS 15 and WINDOWS 17).
// Written from the contract only; src/kernel/tk.asm, src/kernel/tk2.asm and src/apps/demo.asm were never read.
//
//   node tests/tk-model2.mjs --self-test      hand-worked cases of the model itself (the test files run the same cases as their group 0)
//
// What is here:
//   * withInside (10.2: the inside clip intersected with the caller's clip, restored), disabledLook (10.1);
//   * listGeom / listLook / listLineLook (10.3), fieldLook (10.4): the exact pixels as gfx6-model drawing;
//   * the List behaviour: listSelect / listKey / listDown / listScroll / listSetItems / listSetBar, with the click memory (`mem`) and the bar's value, max and page;
//   * the Field behaviour: fieldAdjust (the three-step "first adjusted" rule), fieldKey, fieldDown, fieldSetText;
//   * TkTree2 (extends tk-model's TkTree): windows holding List and Field nodes, the focus draws of a List, every W_DRAWVIEW and every E_CMD logged in order;
//     renderWindow draws List and Field nodes through tk-model's EXT_LOOKS.
//
// Nodes:  List  { kind: 'List', id, x, y, w, h, flags, items: [codes[]], count, sel, top, bar: a VScroll node | null }  (count = items.length unless a test says otherwise)
//         Field { kind: 'Field', id, x, y, w, h, flags, buf: codes[], cap, caret, first }
//
// Readings of the contract (CONTRACT? in the report):
//  R1. The draw calls of a List are compared as a multiset per node (not as a sequence): TK_SETITEMS lists "the bar set; a full draw" and the selection text lists "a full draw, then the bar
//      is set"; both are checked as "the same W_DRAWVIEWs, in any order".
//  R2. A selection move whose old line is the new line (a click on the selected line that is not a double click) is "one-line draws of old and of j": the model counts the draw of `old`
//      as optional there (1 or 2 W_DRAWVIEWs of the List).
//  R3. Focus / Blur of a List "a one-line draw of sel when it is not $FF and shown": with no such line no W_DRAWVIEW is made (the model logs none).
//  R4. The generators keep n >= 1 (a List shows at least one line) and top <= count; `top` and `sel` are poked directly only by the look tests (any legal-looking state).
//  R5. V_FRAMES differences are taken mod 65,536; the tests keep clear of the wrap.
import { fileURLToPath } from 'node:url';
import * as M from './tk-model.mjs';
import { KDcAbs } from './kdc-model.mjs';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from './tk-model.mjs';

export const FF = 0xFF;
export const LF = { DISABLED_LOOK: 8, CELL: 16 };          // List flags bits 3 and 4 (Field: bit 3 disabled look)
export const KEY = { DELETE: 12, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, TAB: 14 };
const g0 = new Gfx6Model();
const adv = (code) => g0.textw([code]);                                  // PROP6 advance of one code
/** tw(i, j): the width of codes i..j-1 (PROP6 advances), 0 when j <= i. */
export const tw = (codes, i, j) => (j <= i ? 0 : g0.textw(codes.slice(i, j)));
export const textw = (codes) => (codes.length ? g0.textw(codes) : 0);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Shared drawing rules (10.1, 10.2)
/** 10.2: narrow the clip to its intersection with (x + 1, y + 1, w - 2, h - 2), run fn, put the caller's clip back. */
export function withInside(g, x, y, w, h, fn) {
  const old = { ...g.clip };
  const x0 = Math.max(old.x0, x + 1), x1 = Math.min(old.x1, x + w - 1), y0 = Math.max(old.y0, y + 1), y1 = Math.min(old.y1, y + h - 1);
  g.clip = (x0 >= x1 || y0 >= y1) ? { x0: 0, x1: 0, y0: 0, y1: 0 } : { x0, x1, y0, y1 };
  fn();
  g.clip = old;
}
/** 10.1: the disabled look, drawn last: CLR fill (x + 1, r, w - 2, 1) for every row r = y + 2, y + 4, ... below y + h - 1. */
export function disabledLook(g, x, y, w, h) {
  g.setOp(OP_CLR);
  for (let r = y + 2; r < y + h - 1; r += 2) g.fill(x + 1, r, w - 2, 1);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// List (10.3)
/** { cell, LY0, P, n, r0, c0 } of a List { x, y, w, h, flags }. */
export function listGeom(l) {
  const { x, y, h } = l;
  if (!(l.flags & LF.CELL)) return { cell: false, LY0: y + 1, P: 9, n: Math.floor((h - 2) / 9), r0: 0, c0: 0 };
  const r0 = (y + 8) >> 3;
  return { cell: true, LY0: 8 * r0, P: 8, n: Math.floor((y + h - 1) / 8) - r0, r0, c0: (l.x + 9) >> 3 };
}
export const listN = (l) => listGeom(l).n;
export const listMaxTop = (l) => Math.max(0, l.count - listN(l));
/** Is item i a line shown (top <= i < top + n, i < count)? */
export const listShown = (l, i) => i !== FF && i >= l.top && i < l.top + listN(l) && i < l.count;
/** The text and the selection look of line k (item top + k must exist): 10.3 steps 3. */
function listLineDraw(g, l, geo, k, focused) {
  const it = l.top + k, codes = l.items[it];
  g.setOp(OP_SET);
  if (codes.length) { if (geo.cell) g.text8(geo.c0, geo.r0 + k, codes); else g.textp(l.x + 3, geo.LY0 + 9 * k, codes); }
  if (it === l.sel) {
    const bx = l.x + 1, by = geo.LY0 + geo.P * k, bw = l.w - 2, bh = geo.P;
    if (focused) { g.setOp(OP_XOR); g.fill(bx, by, bw, bh); } else { g.setOp(OP_SET); g.frame(bx, by, bw, bh); }
  }
}
/** The full draw (10.3): CLR fill, SET frame, the inside clip, each line, the disabled look, the clip back.  focused: K_FOCUS = the List and not drawn by its blur. */
export function listLook(g, l, focused) {
  const { x, y, w, h } = l, geo = listGeom(l);
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, w, h);
  withInside(g, x, y, w, h, () => {
    for (let k = 0; k < geo.n; k++) if (l.top + k < l.count) listLineDraw(g, l, geo, k, focused);
    if (l.flags & LF.DISABLED_LOOK) disabledLook(g, x, y, w, h);
  });
}
/** The one-line draw of item i (10.3): the inside clip, CLR fill of its band, its text, its selection look, the clip back. */
export function listLineLook(g, l, focused, i) {
  const geo = listGeom(l), k = i - l.top;
  if (!(k >= 0 && k < geo.n && i < l.count)) return;
  withInside(g, l.x, l.y, l.w, l.h, () => {
    g.setOp(OP_CLR); g.fill(l.x + 1, geo.LY0 + geo.P * k, l.w - 2, geo.P);
    listLineDraw(g, l, geo, k, focused);
  });
}

/** TK_SETBAR on the List's bar (10.3 "The bar"): value = top, max = max(0, count - n), page = n; the bar is drawn. */
export function listSetBar(tree, l) {
  if (!l.bar) return;
  M.setBar(l.bar, l.top, listMaxTop(l), listN(l));
  tree.draw(l.bar);
}
/** Selecting item j (10.3). */
export function listSelect(tree, l, j) {
  const n = listN(l), old = l.sel;
  l.sel = j;
  let top2 = l.top;
  if (j < l.top) top2 = j; else if (j >= l.top + n) top2 = j - n + 1;
  if (top2 === l.top) {
    if (listShown(l, old)) tree.draw(l, old === j);        // R2: when old is j this draw is optional
    tree.draw(l);
    tree.noteLine(l, listShown(l, old) ? [old, j] : [j]);
  } else { l.top = top2; tree.draw(l); tree.noteFull(l); listSetBar(tree, l); }
}
/** E_KEY (10.3); returns consumed. */
export function listKey(tree, l, code) {
  if (code === KEY.DOWN || code === KEY.UP) {
    if (l.count === 0) return true;
    let j = null;
    if (l.sel === FF) j = l.top;
    else if (code === KEY.DOWN) { if (l.sel + 1 < l.count) j = l.sel + 1; }
    else if (l.sel > 0) j = l.sel - 1;
    if (j !== null) listSelect(tree, l, j);
    return true;
  }
  if (code === KEY.ENTER) { if (l.sel !== FF) { tree.post(l); return true; } return false; }
  return false;
}
/**
 * E_DOWN at (px, py) (10.3 Pointer as amended by WRITE 14.9 item 2); `dbl` = the kernel's double-click flag (data 3 bit 2); `mem` = { list, item } is the one click memory (TK_LCV, TK_LCI).
 * A List posts E_CMD on an E_DOWN with the flag set when it is the same List, on the same item, and that item is the selection (the memory is then cleared); otherwise the item is selected and the
 * List and the item remembered.  Always consumed.
 */
export function listDown(tree, l, px, py, dbl, mem) {
  const geo = listGeom(l);
  let j = null;
  if (py >= geo.LY0) { const k = Math.floor((py - geo.LY0) / geo.P); if (k < geo.n && l.top + k < l.count) j = l.top + k; }
  if (j === null) { mem.list = null; return true; }                           // a press elsewhere in the List clears the memory
  if (dbl && mem.list === l && mem.item === j && j === l.sel) { tree.post(l); mem.list = null; return true; }
  listSelect(tree, l, j);
  mem.list = l; mem.item = j;
  return true;
}
/** E_SCROLL from the bar, data 1 = value (10.3): top' = min(value, max(0, count - n)); a full draw when it differs.  The bar is not told.  Consumed. */
export function listScroll(tree, l, value) {
  const t2 = Math.min(value, listMaxTop(l));
  if (t2 !== l.top) { l.top = t2; tree.draw(l); tree.noteFull(l); }
  return true;
}
/** TK_SETITEMS (10.3): items stored, sel = $FF, top = 0, the memory cleared, the bar set, a full draw. */
export function listSetItems(tree, l, items) {
  l.items = items; l.count = items.length; l.sel = FF; l.top = 0;
  if (tree.mem.list === l || true) tree.mem.list = null;                    // "the click memory cleared"
  listSetBar(tree, l);
  tree.draw(l); tree.noteFull(l);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Field (10.4)
/** 10.4 "First adjusted" (A = w - 5): the three steps, on a Field { w, buf, caret, first }. */
export function fieldAdjust(f) {
  const A = f.w - 5, L = f.buf.length;
  if (f.first > f.caret) f.first = f.caret;
  while (tw(f.buf, f.first, f.caret) > A) f.first++;
  while (f.first > 0 && tw(f.buf, f.first - 1, L) <= A) f.first--;
}
/** The look (10.4): CLR fill, SET frame, the inside clip, codes first..L-1 at (x + 3, ty), the caret when focused, the disabled look, the clip back. */
export function fieldLook(g, f, focused) {
  const { x, y, w, h } = f, ty = y + Math.floor((h - 8) / 2), L = f.buf.length;
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, w, h);
  withInside(g, x, y, w, h, () => {
    g.setOp(OP_SET);
    if (f.first < L) g.textp(x + 3, ty, f.buf.slice(f.first, L));
    if (focused) g.fill(x + 2 + tw(f.buf, f.first, f.caret), ty, 1, 9);
    if (f.flags & LF.DISABLED_LOOK) disabledLook(g, x, y, w, h);
  });
}
/** E_KEY (10.4); returns consumed. */
export function fieldKey(tree, f, code) {
  const L = f.buf.length;
  if (code >= 32 && code <= 126) {
    if (L < f.cap) { f.buf.splice(f.caret, 0, code); f.caret++; fieldAdjust(f); tree.draw(f); }
    return true;
  }
  if (code === KEY.DELETE) { if (f.caret > 0) { f.buf.splice(f.caret - 1, 1); f.caret--; fieldAdjust(f); tree.draw(f); } return true; }
  if (code === KEY.LEFT) { if (f.caret > 0) { f.caret--; fieldAdjust(f); tree.draw(f); } return true; }
  if (code === KEY.RIGHT) { if (f.caret < L) { f.caret++; fieldAdjust(f); tree.draw(f); } return true; }
  if (code === KEY.ENTER) { tree.post(f); return true; }
  return false;
}
/** The caret index a click at px gives (10.4 Pointer): the first k from `first` with px < pen + floor(a / 2), L when none. */
export function fieldClickCaret(f, px) {
  const L = f.buf.length;
  for (let k = f.first; k < L; k++) if (px < f.x + 3 + tw(f.buf, f.first, k) + (adv(f.buf[k]) >> 1)) return k;
  return L;
}
export function fieldDown(tree, f, px) { f.caret = fieldClickCaret(f, px); fieldAdjust(f); tree.draw(f); return true; }
/** TK_SETTEXT (10.4): L = min(length, cap), the first L codes, caret = L, first = 0 then adjusted, drawn. */
export function fieldSetText(tree, f, codes) {
  f.buf = codes.slice(0, Math.min(codes.length, f.cap)); f.caret = f.buf.length; f.first = 0; fieldAdjust(f); tree.draw(f);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The window
export class TkTree2 extends M.TkTree {
  constructor(win, kids) {
    super(win, kids);
    this.mem = { list: null, item: 0 };             // the click memory (one for all Lists)
    this.vf = 0;                                    // V_FRAMES at the next E_DOWN (no longer read by a List: the kernel's flag decides, WRITE 14.9)
    this.kd = new KDcAbs();                         // the kernel's double-click rule, for the tests that inject E_DOWN records (frames = the tests' `vf`)
    this.optDraws = [];                             // draws that may be absent (R2)
    this.lineBands = new Map(); this.fullSet = new Set();   // per List: the items drawn alone (one-line draws) and whether it was drawn in full, in this step
  }
  resetLog() { super.resetLog(); this.optDraws = []; this.lineBands = new Map(); this.fullSet = new Set(); }
  noteLine(l, items) { const s = this.lineBands.get(l) || new Set(); items.forEach((i) => s.add(i)); this.lineBands.set(l, s); }
  noteFull(l) { this.fullSet.add(l); }
  draw(n, optional = false) { super.draw(n); if (optional) this.optDraws.push(n); }
  /** M_FOCUS / M_BLUR: a List draws its selected line when there is one shown (R3); every other control is drawn again. */
  focusDraw(n) { if (n.kind === 'List') { if (listShown(n, n.sel)) { this.draw(n); this.noteLine(n, [n.sel]); } } else this.draw(n); }
  nodeEvent(n, ev) {
    if (n.kind === 'List') return this.listEvent(n, ev);
    if (n.kind === 'Field') return this.fieldEvent(n, ev);
    return super.nodeEvent(n, ev);
  }
  /** ev: { t, px, py } or { t: KEY, key } or { t: E.SCROLL, val }. */
  listEvent(l, ev) {
    switch (ev.t) {
      case M.E.KEY: return listKey(this, l, ev.key);
      case M.E.DOWN: return listDown(this, l, ev.px, ev.py, ev.dbl, this.mem);
      case M.E.UP: return true;
      case M.E.MOVE: return this.capture === l;
      case M.E.SCROLL: return listScroll(this, l, ev.val);
      default: return false;
    }
  }
  fieldEvent(f, ev) {
    switch (ev.t) {
      case M.E.KEY: return fieldKey(this, f, ev.key);
      case M.E.DOWN: return fieldDown(this, f, ev.px);
      case M.E.UP: return true;
      case M.E.MOVE: return this.capture === f;
      default: return false;
    }
  }
}
// renderWindow's looks for the new kinds (the window repaint draws a List or a Field in full)
M.EXT_LOOKS.List = (g, n, tree) => listLook(g, n, tree.focus === n);
M.EXT_LOOKS.Field = (g, n, tree) => fieldLook(g, n, tree.focus === n);

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  const bad = selfTest(true);
  console.log(bad ? `tk-model2 self-test: ${bad} FAILED` : 'tk-model2 self-test: all ok');
  if (bad) process.exitCode = 1;
}
/**
 * Hand-worked cases of the model (section 10's own numbers, worked on paper).  Returns the number that failed; `log` prints each.  The test files call this as their group 0 so that a
 * model bug shows up as a model failure and not as a cartridge failure.
 */
export function selfTest(log = false, out = []) {
  let bad = 0;
  const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; out.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`); if (log) console.log(out[out.length - 1]); };
  const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));
  const items = (...s) => s.map(codes);
  const mkTree = (kids) => new TkTree2({ x: 0, y: 8, w: 300, h: 170, slot: 3, title: codes('T') }, kids);
  // -- geometry, 10.5: the demo's List (326, 47, 132, 74) shows 8 lines proportional, 9 with cell lines (16 codes wide)
  eq('geom proportional: demo List (326, 47, 132, 74)', listGeom({ x: 326, y: 47, w: 132, h: 74, flags: 0 }), { cell: false, LY0: 48, P: 9, n: 8, r0: 0, c0: 0 });
  eq('geom cell: demo List: r0 = (47 + 8) >> 3 = 6, LY0 48, c0 = (326 + 9) >> 3 = 41, n = floor(120 / 8) - 6 = 9', listGeom({ x: 326, y: 47, w: 132, h: 74, flags: 16 }), { cell: true, LY0: 48, P: 8, n: 9, r0: 6, c0: 41 });
  // 10.6: 128 x 146 proportional shows floor(144 / 9) = 16 lines; the cell list 132 x 130 at x = 8a + 6, y = 8b + 7 shows 16 lines (a = 3, b = 2: x 30, y 23)
  eq('geom 10.6: 128 x 146 proportional shows 16', listGeom({ x: 24, y: 24, w: 128, h: 146, flags: 0 }).n, 16);
  eq('geom 10.6: cell list 132 x 130 at (30, 23): r0 3, n = floor(152 / 8) - 3 = 16, c0 = 39 >> 3 = 4', (({ r0, n, c0 }) => [r0, n, c0])(listGeom({ x: 30, y: 23, w: 132, h: 130, flags: 16 })), [3, 16, 4]);
  // -- selection with scrolling: 5 lines (h = 47: floor(45 / 9) = 5), 12 items
  {
    const l = { kind: 'List', id: 1, x: 10, y: 20, w: 80, h: 47, flags: 1, items: items(...'abcdefghijkl'), count: 12, sel: FF, top: 0, bar: { kind: 'VScroll', value: 0, max: 0, page: 0 } };
    const t = mkTree([l]);
    t.setFocus(l); t.resetLog();
    listKey(t, l, KEY.DOWN);
    eq('DOWN with no selection selects top (0): one-line draw only', [l.sel, l.top, t.draws.length], [0, 0, 1]);
    for (let i = 0; i < 4; i++) listKey(t, l, KEY.DOWN);
    eq('DOWN x 4 more: sel 4, top 0 (the last line shown)', [l.sel, l.top], [4, 0]);
    t.resetLog(); listKey(t, l, KEY.DOWN);
    eq('DOWN past the bottom: sel 5, top = 5 - 5 + 1 = 1; full draw then the bar set (value 1, max 12 - 5 = 7, page 5)', [l.sel, l.top, t.draws.length, l.bar.value, l.bar.max, l.bar.page], [5, 1, 2, 1, 7, 5]);
    t.resetLog(); listKey(t, l, KEY.UP);
    eq('UP: sel 4 shown, top stays 1; two one-line draws (old and new)', [l.sel, l.top, t.draws.length], [4, 1, 2]);
    listScroll(t, l, 200);
    eq('E_SCROLL beyond the end: top = min(200, 7) = 7', l.top, 7);
    t.resetLog(); listScroll(t, l, 7);
    eq('E_SCROLL to the same top draws nothing', t.draws.length, 0);
    l.sel = 0; l.top = 0;
    t.resetLog(); listKey(t, l, KEY.UP);
    eq('UP at sel 0 changes nothing, consumed', [l.sel, t.draws.length], [0, 0]);
    eq('ENTER with a selection posts E_CMD (id 1, slot 3)', (() => { t.resetLog(); const c = listKey(t, l, KEY.ENTER); return [c, t.posts]; })(), [true, [{ id: 1, slot: 3 }]]);
    l.sel = FF;
    eq('ENTER with no selection is not consumed', (() => { t.resetLog(); return [listKey(t, l, KEY.ENTER), t.posts.length]; })(), [false, 0]);
    eq('LEFT / RIGHT / TAB / SPACE are not consumed by a List', [8, 9, 14, 32, 97].map((k) => listKey(t, l, k)), [false, false, false, false, false]);
    // TK_SETITEMS
    t.mem.list = l; listSetItems(t, l, items('x', 'y'));
    eq('TK_SETITEMS: sel $FF, top 0, memory cleared, bar max max(0, 2 - 5) = 0 page 5', [l.sel, l.top, l.count, t.mem.list, l.bar.max, l.bar.page], [FF, 0, 2, null, 0, 5]);
  }
  // -- pointer (WRITE 14.9 item 2): the kernel's flag says "double-click"; the List adds "the same List, the same item, and that item is the selection"
  {
    const l = { kind: 'List', id: 2, x: 10, y: 20, w: 80, h: 47, flags: 1, items: items(...'abcdefghij'), count: 10, sel: FF, top: 0, bar: null };
    const t = mkTree([l]), line = (k) => 21 + 9 * k + 3;
    listDown(t, l, 20, line(2), false, t.mem);
    eq('click on line 2 selects item 2', [l.sel, t.posts.length], [2, 0]);
    t.resetLog(); listDown(t, l, 20, line(2), true, t.mem);
    eq('a flagged press on the same item (the selection): E_CMD, memory cleared', [t.posts, t.mem.list], [[{ id: 2, slot: 3 }], null]);
    t.resetLog(); listDown(t, l, 20, line(2), false, t.mem);
    eq('the next press (unflagged: the kernel never flags the press after a double-click) selects again (no post)', [t.posts.length, t.mem.list === l], [0, true]);
    t.resetLog(); listDown(t, l, 20, line(2), false, t.mem);
    eq('an unflagged press on the same item: no post', [t.posts.length, t.mem.item], [0, 2]);
    t.resetLog(); listDown(t, l, 20, line(3), false, t.mem); listDown(t, l, 20, line(2), true, t.mem);
    eq('a flagged press on another item than the remembered one: no post (selects it)', [t.posts.length, l.sel], [0, 2]);
    eq('click below the last item line / on the frame row: clears the memory', (() => { listDown(t, l, 20, 20, false, t.mem); return t.mem.list; })(), null);
    eq('a flagged press after the memory is cleared selects only', (() => { t.resetLog(); listDown(t, l, 20, line(2), true, t.mem); return [t.posts.length, t.mem.list === l]; })(), [0, true]);
    // the item must be the selection: a key moves the selection away from the remembered item
    t.mem.list = l; t.mem.item = 4; l.sel = 5; t.resetLog(); listDown(t, l, 20, line(4), true, t.mem);
    eq('a flagged press on the remembered item that is not the selection: no post, the item is selected', [t.posts.length, l.sel], [0, 4]);
    eq('a click on an item that is not shown (past count) is not an item', (() => { const l2 = { ...l, count: 2, sel: FF, top: 0 }; const t2 = mkTree([l2]); listDown(t2, l2, 20, line(4), false, t2.mem); return [l2.sel, t2.draws.length, t2.mem.list]; })(), [FF, 0, null]);
  }
  // -- Field: the first-adjusted rule worked by hand.  '0' is 7 pixels wide; a Field w = 60 gives A = 55.
  {
    const f = { kind: 'Field', id: 3, x: 10, y: 20, w: 60, h: 12, flags: 1, buf: codes('0000000000'), cap: 20, caret: 10, first: 0 };
    fieldAdjust(f);
    eq('adjust: ten 0s, caret 10: step 2 moves first to 3 (7 x 7 = 49 <= 55); step 3: tw(2, 10) = 56 > 55 keeps it', f.first, 3);
    f.caret = 9; fieldAdjust(f); eq('caret 9: first stays 3', f.first, 3);
    f.caret = 2; fieldAdjust(f); eq('caret 2: step 1 first = 2, step 3: tw(1, 10) = 63 > 55 stays', f.first, 2);
    f.buf = codes('00000'); f.caret = 5; f.first = 3; fieldAdjust(f);
    eq('adjust: five 0s (35 <= 55), caret 5, first 3: step 3 slides first to 0', f.first, 0);
    const t = mkTree([f]);
    f.buf = codes('abc'); f.caret = 3; f.first = 0; f.cap = 4;
    t.resetLog(); fieldKey(t, f, 100);
    eq('typing d at the end: "abcd", caret 4', [String.fromCharCode(...f.buf), f.caret, t.draws.length], ['abcd', 4, 1]);
    t.resetLog(); const c = fieldKey(t, f, 101);
    eq('typing into a full buffer: consumed, nothing changes, no draw', [c, String.fromCharCode(...f.buf), f.caret, t.draws.length], [true, 'abcd', 4, 0]);
    t.resetLog(); fieldKey(t, f, KEY.LEFT); fieldKey(t, f, KEY.LEFT); fieldKey(t, f, KEY.DELETE);
    eq('LEFT, LEFT, DELETE: "acd", caret 1, three draws', [String.fromCharCode(...f.buf), f.caret, t.draws.length], ['acd', 1, 3]);
    t.resetLog(); f.caret = 0; fieldKey(t, f, KEY.DELETE); fieldKey(t, f, KEY.LEFT);
    eq('DELETE and LEFT at caret 0: no draw', t.draws.length, 0);
    f.caret = 3; t.resetLog(); fieldKey(t, f, KEY.RIGHT);
    eq('RIGHT at the end: no draw', t.draws.length, 0);
    t.resetLog(); eq('ENTER posts E_CMD, no draw, consumed', [fieldKey(t, f, KEY.ENTER), t.posts, t.draws.length], [true, [{ id: 3, slot: 3 }], 0]);
    eq('TAB, UP, DOWN, ESC are not consumed by a Field', [14, 11, 10, 27, 1, 127].map((k) => fieldKey(t, f, k)), [false, false, false, false, false, false]);
    // click-to-caret: "abc" at x = 10: codes start at x + 3 = 13; a = 7, 7, 6 (c); middles: 13 + 3 = 16, 20 + 3 = 23, 27 + 3 = 30
    f.buf = codes('abc'); f.first = 0; f.caret = 0;
    eq('click at px 15 (< 16): caret before a', fieldClickCaret(f, 15), 0);
    eq('click at px 16 (not < 16): caret before b', fieldClickCaret(f, 16), 1);
    eq('click at px 22 (< 23): caret 1', fieldClickCaret(f, 22), 1);
    eq('click at px 29 (< 30): caret 2', fieldClickCaret(f, 29), 2);
    eq('click at px 30: caret 3 (= L)', fieldClickCaret(f, 30), 3);
    eq('TK_SETTEXT longer than cap: cut at cap, caret at the end, first adjusted', (() => { f.cap = 4; fieldSetText(t, f, codes('hello world')); return [String.fromCharCode(...f.buf), f.caret, f.first]; })(), ['hell', 4, 0]);
  }
  // -- looks: the caret column and the disabled look
  {
    const f = { kind: 'Field', id: 4, x: 10, y: 20, w: 60, h: 12, flags: 1, buf: codes('ab'), cap: 8, caret: 1, first: 0 }, g = new Gfx6Model();
    fieldLook(g, f, true);
    // ty = 20 + floor(4 / 2) = 22; caret column x = 10 + 2 + 7 = 19, rows 22..30; the frame is at x = 10 and 69
    eq('Field look: the caret is the 1 x 9 bar at (19, 22)', [g.get(19, 22), g.get(19, 30), g.get(19, 21), g.get(18, 22)], [1, 1, 0, 0]);
    const g2 = new Gfx6Model(); fieldLook(g2, { ...f, flags: 1 | 8 }, false);
    // disabled: CLR fill of x 11..68 on rows y + 2, y + 4, ... < y + h - 1 = 31: rows 22, 24, 26, 28, 30 are paper
    eq('Field look disabled: rows 22, 24, 26, 28, 30 are paper inside; the frame stays', [[22, 24, 26, 28, 30].every((r) => { for (let x = 11; x < 69; x++) if (g2.get(x, r)) return false; return true; }), g2.get(10, 22), g2.get(69, 30)], [true, 1, 1]);
    const g3 = new Gfx6Model(); g3.setClip(0, 0, 40, 100); fieldLook(g3, f, true);
    eq('the caller\'s clip is back after the draw, and the inside clip was intersected: nothing right of x = 40', [g3.clip, g3.get(40, 20), g3.get(69, 25)], [{ x0: 0, x1: 40, y0: 0, y1: 100 }, 0, 0]);
  }
  {
    const l = { kind: 'List', id: 5, x: 10, y: 20, w: 40, h: 29, flags: 1, items: items('One', 'Two', 'Three'), count: 3, sel: 1, top: 0, bar: null };   // 3 lines
    const g = new Gfx6Model(); listLook(g, l, true);
    // selected line 1: band (11, 20 + 1 + 9 = 30, 38, 9): XOR over the text: the corner (11, 30) is ink (paper XOR 1), the inside column x = 12 row 30 too
    eq('List look focused: the selected band is XORed (corner pixel inked)', [g.get(11, 30), g.get(48, 38), g.get(11, 29)], [1, 1, 0]);
    const g2 = new Gfx6Model(); listLook(g2, l, false);
    eq('List look not focused: the band is outlined (corner inked, the middle of the band paper)', [g2.get(11, 30), g2.get(45, 34), g2.get(48, 38)], [1, 0, 1]);
    const g3 = new Gfx6Model(); listLook(g3, { ...l, flags: 1 | 16 }, false);
    // cell lines: r0 = (20 + 8) >> 3 = 3, LY0 = 24, n = floor(48 / 8) - 3 = 3, c0 = (10 + 9) >> 3 = 2 (x = 16); line 1 band (11, 32, 38, 8)
    eq('List look cell lines: geometry rows 24 / 32 / 40, the band outline at (11, 32)', [listGeom({ ...l, flags: 17 }).n, g3.get(11, 32), g3.get(48, 39)], [3, 1, 1]);
  }
  return bad;
}
