"use strict";
// wm-model.mjs -- reference model of slice W1 of the window manager (docs/WINDOWS.md sections 1-11 and 14).  Written from the
// contract only; the Z80 code (src/kernel/wm.asm) was never read.
//
//   node tests/wm-model.mjs --self-test      hand-worked cases and invariants of the model itself
//
// The model keeps the view tree as plain objects (nodes) and the cell map as two byte arrays.  It predicts: W_MAP (owner | dirty << 7),
// W_SLOTS, the desk's list order, W_DIRTY, K_FSCOPE, K_FOCUS, K_CAPTURE, the carry of the routines that have one, and the log of the test
// methods (14.5: code, tag, IX, GCLIP) written by every M_DRAW / M_FOCUS / M_BLUR / M_EVENT the routines send.
//
// Readings of the contract (also listed in the report that came with this file):
//  M1. A W_CLOSE of the last window ends in Activation (0, 0).  14.4 says "nothing when f = old", but section 7 says "K_FSCOPE = f (0 when
//      there is no window)", and a stale K_FSCOPE (the closed window) would make the walk start from a detached view.  The model sets
//      K_FSCOPE = 0 there (nothing else changes).
//  M2. The focus walk is step 3's mechanical walk with R (= K_FSCOPE, or K_ROOT when 0) as the root: R has no parent and no next sibling,
//      a walk that runs off R wraps to R (once), the second wrap ends it.  A focus outside R's tree climbs out through its own tree's
//      parents (testing the views it passes), wraps to R, and searches R's subtree.  The random tests keep K_FOCUS inside R or 0.
//  M3. W_DRAWVIEW of a view with w = 0 or h = 0 is not generated (the cell range of an empty rectangle is not defined by 14.4).
//  M4. Windows are never hidden or disabled in the generated tests (the contract does not say what W_UPDATE does with a hidden window), and
//      x is never negative (14.4's "valid rect" does not list x >= 0).
//  M5. The carry of W_UPDATE, W_INVAL, W_INVALV and W_DRAWVIEW is not specified and not modelled.  The log record's GCLIP of a focus, blur
//      or event method sent outside a draw is the whole screen (every routine ends with the whole-screen clip).
//  M6. A K_DISPATCH of E_KEY goes through 15.2: M_EVENT to K_FOCUS (or K_ROOT = the desk), then to each parent.  Only `TCtl`'s M_EVENT
//      logs (code 3, consumes when tag bit 0 is set); `Group`s, `TWin` and the desk route with group_event, which does not consume an E_KEY.
import { fileURLToPath } from 'node:url';

export const COLS = 32, ROWS = 24, NCELL = COLS * ROWS;
export const WHOLE = [0, 512, 0, 192];
export const KEYS = { LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, TAB: 14, BACKTAB: 15 };

export const validRect = (x, y, w, h) => x >= 0 && x % 16 === 0 && y % 8 === 0 && w % 16 === 0 && h % 8 === 0 && w >= 48 && h >= 16 &&
  y >= 8 && x + w <= 512 && y + h <= 192;

/**
 * The rectangles of a cell set (section 6): `inS(c, r)` says whether the cell is in S.  Returns [{c0, c1, r0, r1}] half-open, in the order
 * of the rule: scan rows 0..23, take the maximal runs of each row left to right, extend the rectangle that ended in the previous row with
 * the same [c0, c1), else start one; the rectangles come out ordered by their first row, then c0.
 */
export function decompose(inS) {
  const out = [];
  let open = [];
  for (let r = 0; r < ROWS; r++) {
    const next = [];
    for (let c = 0; c < COLS;) {
      if (!inS(c, r)) { c++; continue; }
      let c1 = c;
      while (c1 < COLS && inS(c1, r)) c1++;
      const ext = open.find((q) => q.c0 === c && q.c1 === c1);
      if (ext) { ext.r1 = r + 1; next.push(ext); } else { const q = { c0: c, c1, r0: r, r1: r + 1 }; out.push(q); next.push(q); }
      c = c1;
    }
    open = next;
  }
  return out;
}

export class WmModel {
  /** deskAddr, barAddr: the views W_INIT made (read from W_SLOTS[0] / [15] of the machine). */
  constructor(deskAddr, barAddr) {
    this.nodes = new Map();
    this.desk = this.addNode({ a: deskAddr, kind: 'Desk', x: 0, y: 0, w: 512, h: 192 });
    this.bar = this.addNode({ a: barAddr, kind: 'MenuBar', x: 0, y: 0, w: 512, h: 8 });
    this.attach(this.desk, this.bar);
    this.slots = new Array(16).fill(null); this.slots[0] = this.desk; this.slots[15] = this.bar;
    this.map = new Uint8Array(NCELL); this.dirty = new Uint8Array(NCELL);
    for (let i = 0; i < NCELL; i++) { this.map[i] = i < COLS ? 15 : 0; this.dirty[i] = 1; }
    this.modal = 0;
    this.focus = null; this.capture = null; this.fscope = null;
    this.log = [];
    this.clip = WHOLE.slice();
    this.fault = 0;                                                  // --mutate N of tests/wm-w1.mjs: a planted fault, to show the tests catch it
    this.stats = { updates: 0, rects: 0, maxRects: 0, draws: 0 };
  }

  // ---- nodes -------------------------------------------------------------------------------------------------------------------
  /** kind: Desk MenuBar Window TWin TCtl TGrp TNull Group.  Fields not given default to 0. */
  addNode(o) {
    const n = { a: 0, kind: 'TCtl', x: 0, y: 0, w: 0, h: 0, flags: 0, id: 0, tag: 0, parent: null, kids: [], slot: 0, title: null, focus: null, ...o };
    this.nodes.set(n.a, n);
    return n;
  }
  attach(p, c) { c.parent = p; p.kids.push(c); }
  unlinkNode(c) { if (c.parent) { c.parent.kids.splice(c.parent.kids.indexOf(c), 1); c.parent = null; } }
  under(v, r) { for (let x = v; x; x = x.parent) if (x === r) return true; return false; }
  subtree(v) { const out = [v]; for (const c of v.kids) out.push(...this.subtree(c)); return out; }
  get list() { return this.desk.kids.slice(1); }                 // the open windows, front to back (the bar is the desk's first child)
  front() { return this.desk.kids.length > 1 ? this.desk.kids[1] : null; }
  isOpen(w) { return w.slot !== 0; }
  ownerView(o) { return this.slots[o]; }
  logHas(kind) { return kind === 'TWin' || kind === 'TCtl'; }

  // ---- the log -----------------------------------------------------------------------------------------------------------------
  rec(code, n) { this.log.push({ code, tag: n.tag, ix: n.a, clip: this.clip.slice() }); }

  // ---- the map -----------------------------------------------------------------------------------------------------------------
  damageCell(i) { this.dirty[i] = 1; }
  anyDirty() { for (let i = 0; i < NCELL; i++) if (this.dirty[i]) return true; return false; }
  get wDirty() { return this.anyDirty() ? 1 : 0; }
  /** The map rule (section 6): the owner of a cell below row 0 is the slot of the first window whose rectangle holds it; changed -> damaged. */
  mapRule() {
    const list = this.list;
    for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      let o = 0;
      for (const w of list) if (c * 16 >= w.x && c * 16 + 16 <= w.x + w.w && r * 8 >= w.y && r * 8 + 8 <= w.y + w.h) { o = w.slot; break; }
      const i = r * COLS + c;
      if (this.map[i] !== o) { this.map[i] = o; this.damageCell(i); }
    }
  }
  /** W_MAP's bytes as the machine holds them. */
  mapBytes() { return Uint8Array.from(this.map, (o, i) => o | (this.dirty[i] ? 0x80 : 0)); }
  damageRect(x, y, w, h) {
    const ax = Math.max(x, 0), bx = Math.min(x + w, 512), ay = Math.max(y, 0), by = Math.min(y + h, 192);
    if (w <= 0 || h <= 0 || ax >= bx || ay >= by) return;
    for (let r = ay >> 3; r <= (by - 1) >> 3; r++) for (let c = ax >> 4; c <= (bx - 1) >> 4; c++) this.damageCell(r * COLS + c);
  }
  /** W_INVAL (GA: x, y, w, h; signed). */
  inval(x, y, w, h) { this.damageRect(x, y, w, h); }
  invalv(v) { this.damageRect(v.x, v.y, v.w, v.h); }

  // ---- focus -------------------------------------------------------------------------------------------------------------------
  canFocus(n) { return (n.flags & 7) === 1; }
  /** K_SETFOCUS: carry 1 when nothing changed because the view cannot take focus. */
  setFocus(v) {
    if (v === this.focus) return 0;
    if (v && !this.canFocus(v)) return 1;
    if (this.focus && this.logHas(this.focus.kind)) this.rec(5, this.focus);
    this.focus = v;
    if (v && this.logHas(v.kind)) this.rec(4, v);
    return 0;
  }
  /** One step of the pre-order walk with root R (M2): { n } or { wrap: true }. */
  step(n, R) {
    if ((n.flags & 6) === 0 && n.kids.length) return { n: n.kids[0] };
    for (let x = n; x; x = x.parent) {
      if (x === R) return { wrap: true };                          // R has no next sibling and no parent
      const sib = x.parent ? x.parent.kids[x.parent.kids.indexOf(x) + 1] : undefined;
      if (sib) return { n: sib };
    }
    return { wrap: true };
  }
  /** The views K_FOCUSNEXT / K_FOCUSPREV test, in order (the walk of 15.3 with R as the root). */
  walk() {
    const R = this.fscope || this.desk, cands = [];
    let s = this.focus;
    if (!s) { s = R; if (this.canFocus(s)) cands.push(s); }
    let n = s, wraps = 0, guard = 0;
    for (;;) {
      const st = this.step(n, R);
      if (st.wrap) { if (wraps === 1) break; wraps = 1; n = R; } else n = st.n;
      if (n === s) break;
      if (this.canFocus(n)) cands.push(n);
      if (++guard > 4096) throw new Error('model: the focus walk does not end');
    }
    return cands;
  }
  focusNext() { const c = this.walk(); if (c.length) this.setFocus(c[0]); }
  focusPrev() { const c = this.walk(); if (c.length) this.setFocus(c[c.length - 1]); }

  /** K_DISPATCH of an E_KEY (15.2, M6). */
  dispatchKey(code) {
    let v = this.focus || this.desk, consumed = false;
    while (v) {
      if (v.kind === 'TCtl') { this.rec(3, v); if (v.tag & 1) { consumed = true; break; } }
      v = v.parent;
    }
    if (!consumed) {
      if ([KEYS.TAB, KEYS.DOWN, KEYS.RIGHT].includes(code)) this.focusNext();
      else if ([KEYS.BACKTAB, KEYS.UP, KEYS.LEFT].includes(code)) this.focusPrev();
    }
    return consumed;
  }

  // ---- activation (14.4) -------------------------------------------------------------------------------------------------------
  activation(old, f) {
    if (f === old) { if (f === null && !this.literalFscope) this.fscope = null; return; }                // M1 (literalFscope: the machine's reading, 14.4 to the letter)
    if (old) old.focus = (this.focus && this.under(this.focus, old)) ? this.focus : null;
    this.fscope = f;
    if (!f) this.setFocus(null);
    else {
      let carry = 1;
      if (f.focus) carry = this.setFocus(f.focus);
      if (!f.focus || carry) { this.setFocus(null); this.focusNext(); }
    }
    if (this.fault !== 1) for (const w of [old, f]) if (w && w.slot !== 0) {
      const r = w.y >> 3;
      for (let c = w.x >> 4; c < (w.x + w.w) >> 4; c++) if (this.map[r * COLS + c] === w.slot) this.damageCell(r * COLS + c);
    }
  }

  // ---- the window routines (14.4); each returns the carry ----------------------------------------------------------------------
  open(w) {
    if (w.slot !== 0 || !validRect(w.x, w.y, w.w, w.h) || this.modal !== 0) return 1;
    let s = 1; while (s <= 14 && this.slots[s]) s++;
    if (s > 14) return 1;
    const old = this.front();
    this.slots[s] = w; w.slot = s;
    this.desk.kids.splice(1, 0, w); w.parent = this.desk;
    this.mapRule();
    this.activation(old, w);
    return 0;
  }
  close(w) {
    if (w.slot === 0) return 1;
    if (this.focus && this.under(this.focus, w)) this.setFocus(null);
    if (this.capture && this.under(this.capture, w)) this.capture = null;
    const wasFront = this.front() === w;
    this.unlinkNode(w); this.slots[w.slot] = null; w.slot = 0;
    this.mapRule();
    if (wasFront) this.activation(null, this.front());
    return 0;
  }
  raise(w) {
    if (w.slot === 0) return 1;
    const old = this.front();
    if (old === w) return 0;
    this.desk.kids.splice(this.desk.kids.indexOf(w), 1); this.desk.kids.splice(1, 0, w);
    this.mapRule();
    this.activation(old, w);
    return 0;
  }
  move(w, x, y) {
    if (w.slot === 0 || !validRect(x, y, w.w, w.h)) return 1;
    if (x === w.x && y === w.y) return 0;
    const dx = x - w.x, dy = y - w.y;
    for (const v of this.subtree(w)) { v.x += dx; v.y += dy; }
    this.mapRule();
    if (this.fault !== 5) for (let i = 0; i < NCELL; i++) if (this.map[i] === w.slot) this.damageCell(i);
    return 0;
  }

  // ---- repaint (section 6, 14.3, 14.4) -----------------------------------------------------------------------------------------
  /** group_draw (14.3): the children in list order that are not hidden and whose rectangle meets the clip. */
  groupDraw(n, clip) {
    for (const c of n.kids) {
      if (c.flags & 2) continue;
      if (!(c.w > 0 && c.h > 0 && (this.fault === 4 || (c.x < clip[1] && c.x + c.w > clip[0] && c.y < clip[3] && c.y + c.h > clip[2])))) continue;
      this.drawNode(c, clip);
    }
  }
  /** M_DRAW to a node: the log records the test classes write (14.5); the pixels are not modelled here. */
  drawNode(n, clip) {
    this.stats.draws++;
    this.clip = clip.slice();
    switch (n.kind) {
      case 'TWin': this.rec(1, n); this.groupDraw(n, clip); break;
      case 'Window': this.groupDraw(n, clip); break;
      case 'TCtl': this.rec(2, n); break;
      case 'TGrp': this.rec(6, n); this.groupDraw(n, clip); break;
      case 'Group': this.groupDraw(n, clip); break;
      case 'Desk': case 'MenuBar': case 'TNull': break;
      default: throw new Error(`model: drawNode ${n.kind}`);
    }
    this.clip = WHOLE.slice();
  }
  /** The rectangles W_UPDATE paints for owner o, in order: [{ c0, c1, r0, r1 }]. */
  dirtyRects(o) { return decompose((c, r) => this.dirty[r * COLS + c] === 1 && this.map[r * COLS + c] === o); }
  /** The owners in W_UPDATE's order: the bar (15), the windows front to back, then the desk (0). */
  ownerOrder() { return [15, ...this.list.map((w) => w.slot), 0]; }
  /**
   * W_UPDATE (section 6 and 14.4's batches).  Rectangles of every owner are collected while the rows 0..23 are scanned; at the start of a
   * row, when 365 or more have been collected, they are painted first (owner order: the bar, the windows front to back, the desk; within
   * an owner in creation order) and collection restarts: a run never extends a rectangle of an earlier batch.  Returns [{ o, clip, batch }].
   */
  update() {
    if (!this.anyDirty()) return [];
    const painted = [], BATCH = this.fault === 3 ? 367 : 365;
    let batch = 0;
    this.stats.updates++;
    let rects = [], open = [];
    const paint = () => {
      for (const o of this.ownerOrder()) for (const q of rects) {
        if (q.o !== o) continue;
        const clip = [16 * q.c0, 16 * q.c1, 8 * q.r0, 8 * q.r1];
        painted.push({ o, clip, batch });
        this.drawNode(this.slots[o], clip);
      }
      this.stats.rects += rects.length;
      rects = []; open = []; batch++;
    };
    for (let r = 0; r < ROWS; r++) {
      if (rects.length >= BATCH) paint();
      const next = [];
      for (let c = 0; c < COLS;) {
        const i = r * COLS + c;
        if (!this.dirty[i]) { c++; continue; }
        const o = this.map[i];
        let c1 = c + 1;
        while (c1 < COLS && this.dirty[r * COLS + c1] && this.map[r * COLS + c1] === o) c1++;
        const ext = this.fault === 2 ? undefined : open.find((q) => q.o === o && q.c0 === c && q.c1 === c1);
        if (ext) { ext.r1 = r + 1; next.push(ext); } else { const q = { o, c0: c, c1, r0: r, r1: r + 1 }; rects.push(q); next.push(q); }
        c = c1;
      }
      open = next;
    }
    paint();
    this.stats.maxRects = Math.max(this.stats.maxRects, painted.length);
    this.dirty.fill(0);
    return painted;
  }
  /** The owner o of a view (14.4 W_DRAWVIEW 1-2): a slot, or -1 when nothing is drawn. */
  topOwner(v) {
    if (v === this.desk) return 0;
    let x = v;
    const chain = [];
    while (x.parent && x.parent !== this.desk) { chain.push(x); x = x.parent; }
    if (x.parent !== this.desk) return -1;                         // not under the desk at all (a closed window's view)
    if (x === this.bar) return 15;
    if (x.slot === 0) return -1;
    return x.slot;
  }
  hiddenOnTheWay(v) {
    const o = this.topOwner(v);
    if (o < 0) return true;
    for (let x = v; x && x !== this.desk && x.parent !== this.desk; x = x.parent) if (x.flags & 2) return true;
    if (v !== this.desk && v.parent !== this.desk && (v.flags & 2)) return true;
    return false;
  }
  drawview(v) {
    const o = this.topOwner(v);
    if (o < 0 || this.hiddenOnTheWay(v)) return [];
    const x0 = Math.max(v.x >> 4, 0), x1 = Math.min((v.x + v.w - 1) >> 4, COLS - 1), y0 = Math.max(v.y >> 3, 0), y1 = Math.min((v.y + v.h - 1) >> 3, ROWS - 1);
    const rects = decompose((c, r) => c >= x0 && c <= x1 && r >= y0 && r <= y1 && this.map[r * COLS + c] === o);
    const painted = [];
    for (const q of rects) {
      const clip = this.fault === 6 ? [16 * q.c0, 16 * q.c1, 8 * q.r0, 8 * q.r1] : [Math.max(16 * q.c0, v.x), Math.min(16 * q.c1, v.x + v.w), Math.max(8 * q.r0, v.y), Math.min(8 * q.r1, v.y + v.h)];
      painted.push({ o, clip });
      this.drawNode(v, clip);
    }
    return painted;
  }

  // ---- destroying a window (window_destroy) ---------------------------------------------------------------------------------------
  /** M_DESTROY of a window: W_CLOSE when open, then view_destroy: the whole subtree goes. */
  destroyWindow(w) {
    if (w.slot !== 0) this.close(w);
    for (const v of this.subtree(w)) {
      if (this.focus === v) this.focus = null;
      if (this.capture === v) this.capture = null;
      if (this.fscope === v && !this.literalFscope) this.fscope = null;
      this.nodes.delete(v.a);
    }
    this.unlinkNode(w);
  }

  // ---- K_GETEV (14.4) ----------------------------------------------------------------------------------------------------------
  /** With both queues empty: { carry, type }. */
  getevEmpty() { return this.anyDirty() ? { carry: 0, type: 6 } : { carry: 1, type: null }; }
}

// ===========================================================================================================================
// Self-test: hand-worked cases (each expected value derived by hand from the contract, not from the model) and invariants.
function selfTest() {
  let fails = 0, n = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  let nextA = 0xC000;
  const mkWin = (m, x, y, w, h, extra = {}) => m.addNode({ a: (nextA += 0x20), kind: 'TWin', x, y, w, h, tag: 7, ...extra });
  const fresh = () => { nextA = 0xC000; return new WmModel(0xF500, 0xF510); };
  const clips = (m) => m.log.filter((r) => r.code === 1).map((r) => ({ ix: r.ix, clip: r.clip }));

  // -- decomposition ------------------------------------------------------------------------------------------------------------
  {
    const cells = (list) => { const s = new Set(list.map(([c, r]) => `${c},${r}`)); return (c, r) => s.has(`${c},${r}`); };
    const R = (c0, r0, c1, r1) => ({ c0, c1, r0, r1 });
    eq('one cell', decompose(cells([[3, 4]])), [R(3, 4, 4, 5)]);
    eq('a block is one rectangle', decompose(cells([[1, 1], [2, 1], [1, 2], [2, 2], [1, 3], [2, 3]])), [R(1, 1, 3, 4)]);
    eq('two runs in a row, two rectangles', decompose(cells([[0, 5], [2, 5]])), [R(0, 5, 1, 6), R(2, 5, 3, 6)]);
    eq('an L: the foot starts a new rectangle', decompose(cells([[0, 0], [0, 1], [1, 1], [0, 2], [1, 2]])), [R(0, 0, 1, 1), R(0, 1, 2, 3)]);
    eq('a T: stem under the bar is separate', decompose(cells([[0, 0], [1, 0], [2, 0], [1, 1]])), [R(0, 0, 3, 1), R(1, 1, 2, 2)]);
    // never merges across a gap row: rows 0 and 2 identical but row 1 empty
    eq('a gap row separates equal runs', decompose(cells([[2, 0], [3, 0], [2, 2], [3, 2]])), [R(2, 0, 4, 1), R(2, 2, 4, 3)]);
    // a rectangle that ended cannot be extended later, and the order is first row then c0
    eq('order by first row then c0', decompose(cells([[5, 0], [0, 1], [5, 1], [9, 1]])), [R(5, 0, 6, 2), R(0, 1, 1, 2), R(9, 1, 10, 2)]);
    eq('empty', decompose(() => false), []);
    eq('whole screen', decompose(() => true), [R(0, 0, 32, 24)]);
    // wide run then narrower run above: the narrower does not extend
    eq('wide over narrow', decompose(cells([[0, 0], [1, 0], [0, 1]])), [R(0, 0, 2, 1), R(0, 1, 1, 2)]);
  }

  // -- the boot state and the first update -------------------------------------------------------------------------------------
  let m = fresh();
  eq('boot map row 0 is $8F, rows 1-23 $80', [m.mapBytes()[0], m.mapBytes()[31], m.mapBytes()[32], m.mapBytes()[767]], [0x8F, 0x8F, 0x80, 0x80]);
  eq('boot W_DIRTY, slots, list', [m.wDirty, m.slots[0] === m.desk, m.slots[15] === m.bar, m.list.length], [1, true, true, 0]);
  eq('first update paints the bar and the desk (no log: neither is a test class)', [m.update().length, m.log.length], [2, 0]);
  eq('first update: bar is one rectangle (0,0)-(32,1), desk (0,1)-(32,24)', m.update(), []);
  m = fresh();
  eq('rects of the bar and the desk', [m.dirtyRects(15), m.dirtyRects(0)], [[{ c0: 0, c1: 32, r0: 0, r1: 1 }], [{ c0: 0, c1: 32, r0: 1, r1: 24 }]]);
  m.update(); eq('clean after update', [m.wDirty, m.mapBytes()[0], m.mapBytes()[100]], [0, 0x0F, 0]);

  // -- open A over the bare desk (hand-derived) -------------------------------------------------------------------------------------
  const A = mkWin(m, 128, 48, 256, 96);
  eq('open A', m.open(A), 0);
  eq('A slot 1, A front, scope A', [A.slot, m.front() === A, m.fscope === A], [1, true, true]);
  eq('cell (8,6) and (23,17) owned by A and dirty; (24,6) and (8,18) not', [m.mapBytes()[6 * 32 + 8], m.mapBytes()[17 * 32 + 23], m.mapBytes()[6 * 32 + 24], m.mapBytes()[18 * 32 + 8]], [0x81, 0x81, 0, 0]);
  eq('exactly 16 x 12 = 192 cells dirty', m.dirty.reduce((a, b) => a + b, 0), 192);
  m.log = []; m.update();
  eq('update after open A: one TWin draw, clip (128,384,48,144)', [m.log.length, clips(m)], [1, [{ ix: A.a, clip: [128, 384, 48, 144] }]]);
  eq('the record', m.log[0], { code: 1, tag: 7, ix: A.a, clip: [128, 384, 48, 144] });

  // -- open B overlapping (hand-derived in the report): B (192,80,256,96), A's title row damaged --------------------------------------
  const B = mkWin(m, 192, 80, 256, 96);
  eq('open B', m.open(B), 0);
  eq('B slot 2, front B, list B A', [B.slot, m.front() === B, m.list.map((w) => w.slot)], [2, true, [2, 1]]);
  m.log = []; m.update();
  eq('update: B whole (192,448,80,176) then A\'s title row (128,384,48,56)', clips(m), [{ ix: B.a, clip: [192, 448, 80, 176] }, { ix: A.a, clip: [128, 384, 48, 56] }]);
  eq('overlap cells now belong to B', [m.map[10 * 32 + 12], m.map[17 * 32 + 23], m.map[9 * 32 + 12], m.map[6 * 32 + 12]], [2, 2, 1, 1]);

  // -- raise A (hand-derived): A's title + the overlap, then B's visible title tail --------------------------------------------------
  eq('raise A', m.raise(A), 0);
  eq('raise: list A B, scope A', [m.list.map((w) => w.slot), m.fscope === A], [[1, 2], true]);
  m.log = []; m.update();
  eq('update after raise A', clips(m), [{ ix: A.a, clip: [128, 384, 48, 56] }, { ix: A.a, clip: [192, 384, 80, 144] }, { ix: B.a, clip: [384, 448, 80, 88] }]);
  eq('raise of the front window: nothing, carry clear, still clean', [m.raise(A), m.wDirty], [0, 0]);

  // -- close A (front): B owns everything again, B's title row damaged ---------------------------------------------------------------
  eq('close A', m.close(A), 0);
  m.log = []; m.update();
  eq('update after close A: B (192,448,80,88) then B (192,384,88,144)', clips(m), [{ ix: B.a, clip: [192, 448, 80, 88] }, { ix: B.a, clip: [192, 384, 88, 144] }]);
  eq('A closed: slot 0, free; B scope', [A.slot, m.slots[1], m.fscope === B], [0, null, true]);
  eq('close of a closed window: carry', m.close(A), 1);
  // -- move B: every cell it owns is damaged, the cells it left too ----------------------------------------------------------------------
  eq('move to the same place: nothing', [m.move(B, 192, 80), m.wDirty], [0, 0]);
  eq('move to an invalid place: carry', [m.move(B, 200, 80), m.move(B, 192, 4), m.move(B, 320, 80), m.move(B, 192, 120)], [1, 1, 1, 1]);
  eq('move valid', m.move(B, 16, 8), 0);
  eq('B at (16,8)', [B.x, B.y], [16, 8]);
  m.log = []; m.update();
  eq('update after move: one rectangle of 16 x 12 cells at B\'s new place (the old place is the desk)', clips(m), [{ ix: B.a, clip: [16, 272, 8, 104] }]);
  eq('close the last window: scope cleared (reading M1)', [m.close(B), m.fscope, m.focus], [0, null, null]);

  // -- invalid opens -----------------------------------------------------------------------------------------------------------------
  m = fresh(); m.update();
  const bad = [[8, 16, 64, 16], [16, 4, 64, 16], [16, 8, 40, 16], [16, 8, 32, 16], [16, 8, 64, 8], [16, 8, 64, 12], [496, 8, 32, 16], [464, 8, 64, 16], [16, 184, 64, 16], [16, 0, 64, 16]];
  eq('invalid rectangles are refused', bad.map(([x, y, w, h]) => m.open(mkWin(m, x, y, w, h))), bad.map(() => 1));
  eq('nothing changed', [m.wDirty, m.list.length], [0, 0]);
  eq('the smallest and the largest valid windows', [m.open(mkWin(m, 0, 8, 48, 16)), m.open(mkWin(m, 0, 8, 512, 184))], [0, 0]);
  const W3 = mkWin(m, 16, 8, 64, 16); m.modal = 1;
  eq('a modal dialog open: W_OPEN refused', m.open(W3), 1); m.modal = 0;
  // 14 slots
  m = fresh();
  const ws = Array.from({ length: 15 }, (_, i) => mkWin(m, 16 * (i % 8), 8 + 8 * i, 48, 16));
  eq('14 open, the 15th refused', ws.map((w) => m.open(w)), [...Array(14).fill(0), 1]);
  eq('slots 1..14 in open order', ws.slice(0, 14).map((w) => w.slot), Array.from({ length: 14 }, (_, i) => i + 1));
  m.close(ws[4]); const w5 = ws[14]; m.open(w5);
  eq('the lowest free slot is reused', w5.slot, 5);
  eq('the same window twice: carry', m.open(w5), 1);

  // -- W_INVAL --------------------------------------------------------------------------------------------------------------------------
  m = fresh(); m.update();
  m.inval(130, 50, 1, 1); eq('a pixel: one cell (8,6)', [m.dirty[6 * 32 + 8], m.dirty.reduce((a, b) => a + b, 0), m.wDirty], [1, 1, 1]); m.update();
  m.inval(-100, -100, 120, 120); eq('clamped at the top left: cols 0-1, rows 0-2', m.dirty.reduce((a, b) => a + b, 0), 6);
  m.update(); m.inval(500, 180, 100, 100); eq('clamped at the bottom right: col 31, rows 22-23', m.dirty.reduce((a, b) => a + b, 0), 2);
  m.update(); m.inval(10, 10, 0, 10); m.inval(10, 10, 10, -3); m.inval(600, 10, 5, 5); m.inval(-50, 10, 40, 5); m.inval(0, 200, 5, 5);
  eq('empty rectangles do nothing, W_DIRTY stays 0', m.wDirty, 0);
  m.inval(15, 7, 2, 2); eq('a 2 x 2 pixel rectangle across 4 cells', m.dirty.reduce((a, b) => a + b, 0), 4);
  m.update(); m.inval(0, 0, 512, 192); eq('the whole screen', m.dirty.reduce((a, b) => a + b, 0), 768);

  // -- focus, activation and the scope (hand-derived) -------------------------------------------------------------------------------------
  m = fresh(); m.update();
  const mkW = (x, y, w, h, kids) => {
    const win = mkWin(m, x, y, w, h);
    for (const k of kids) { const c = m.addNode({ a: (nextA += 0x20), kind: 'TCtl', x: x + 16 * k.i, y: y + 16, w: 12, h: 8, flags: k.f, tag: k.t ?? 0 }); m.attach(win, c); k.n = c; }
    return win;
  };
  const ka = [{ i: 1, f: 1 }, { i: 2, f: 0 }, { i: 3, f: 1 }], kb = [{ i: 1, f: 1 }, { i: 2, f: 1 }];
  const WA = mkW(16, 8, 128, 64, ka), WB = mkW(160, 8, 128, 64, kb);
  m.open(WA);
  eq('open A: focus is its first focusable child', [m.focus === ka[0].n, m.fscope === WA], [true, true]);
  m.open(WB);
  eq('open B: A saved its focus, B takes its first focusable', [WA.focus === ka[0].n, m.focus === kb[0].n, m.fscope === WB], [true, true, true]);
  m.focusNext(); eq('TAB: b2', m.focus === kb[1].n, true);
  m.focusNext(); eq('TAB wraps inside B, never to A', m.focus === kb[0].n, true);
  m.focusPrev(); eq('BACKTAB wraps to b2', m.focus === kb[1].n, true);
  m.raise(WA);
  eq('raise A: B saved b2, A restores a1', [WB.focus === kb[1].n, m.focus === ka[0].n, m.fscope === WA], [true, true, true]);
  m.focusNext(); eq('TAB in A skips the unfocusable a2: a3', m.focus === ka[2].n, true);
  m.focusNext(); eq('TAB in A wraps to a1', m.focus === ka[0].n, true);
  m.raise(WB); eq('raise B restores b2', m.focus === kb[1].n, true);
  m.close(WB); eq('close B (front): focus cleared, A activated, a1 restored from its saved focus', [m.fscope === WA, m.focus === ka[0].n], [true, true]);
  m.log = []; m.dispatchKey(KEYS.TAB);
  eq('TAB through dispatch: the focused TCtl logs a (non-consuming) event, then the walk moves focus: blur, focus', m.log.map((r) => r.code), [3, 5, 4]);
  eq('the walk found a3', m.focus === ka[2].n, true);
  ka[2].n.tag = 1; m.log = []; m.dispatchKey(KEYS.TAB);
  eq('a consuming TCtl keeps the key: one event record, no focus move', [m.log.map((r) => r.code), m.focus === ka[2].n], [[3], true]);

  // -- batches (14.4): 365 or more rectangles collected at the start of a row are painted first --------------------------------------
  {
    const batchCase = (lastRowRuns) => {
      const q = fresh(); q.update();
      const big = mkWin(q, 0, 8, 512, 184); q.open(big); q.update();
      // rows 0..21: a checkerboard (16 one-cell runs a row); row 22 and row 23 identical: lastRowRuns runs (even columns below 2 * lastRowRuns)
      for (let r = 0; r < 22; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 0) q.damageCell(r * COLS + c);
      for (const r of [22, 23]) for (let c = 0; c < 2 * lastRowRuns; c += 2) q.damageCell(r * COLS + c);
      q.log = [];
      return { q, painted: q.update() };
    };
    // 16 (row 0: the bar) + 21 x 16 = 352 rectangles before row 22, then row 22 adds 12: 364 at the start of row 23: no break
    let { q, painted } = batchCase(12);
    eq('364 collected at the start of the last row: no batch, row 23 extends row 22\'s rectangles', [painted.length, painted.filter((p) => p.batch === 1).length, painted.filter((p) => p.clip[2] === 176 && p.clip[3] === 192).length], [16 + 21 * 16 + 12, 0, 12]);
    // 13 runs: 365 at the start of row 23: the first batch is painted, row 23 starts new rectangles
    ({ q, painted } = batchCase(13));
    eq('365 collected: row 23 starts a second batch, nothing extends', [painted.length, painted.filter((p) => p.batch === 1).length, painted.filter((p) => p.clip[2] === 176 && p.clip[3] === 184).length, painted.filter((p) => p.clip[2] === 184 && p.clip[3] === 192).length], [16 + 21 * 16 + 13 + 13, 13, 13, 13]);
    eq('the second batch is painted after the first (the window\'s records are in creation order, the bar\'s first)', painted.map((p) => p.o).join(',').replace(/(15,)+/, 'bar,').replace(/(1,)+1?$/, 'win'), 'bar,win');
    eq('batch numbers never decrease', painted.every((p, i) => i === 0 || p.batch >= painted[i - 1].batch), true);
    // the full checkerboard of the report: 16 x 23 = 368 collected before row 23
    q = fresh(); q.update(); { const big = mkWin(q, 0, 8, 512, 184); q.open(big); q.update(); for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 0) q.damageCell(r * COLS + c);
      painted = q.update();
      eq('checkerboard: 384 rectangles, 368 in the first batch', [painted.length, painted.filter((p) => p.batch === 0).length], [384, 368]); }
  }

  // -- invariants over random sequences ------------------------------------------------------------------------------------------------
  let seed = 777; const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % k; };
  let bads = 0, steps = 0;
  for (let run = 0; run < 40; run++) {
    m = fresh(); m.update();
    const pool = Array.from({ length: 18 }, () => { const w = Math.max(48, 16 * (1 + rnd(6))), h = 8 * (2 + rnd(10)); return mkWin(m, 16 * rnd(32 - w / 16 + 1), 8 + 8 * rnd(24 - h / 8), w, h); });
    for (let s = 0; s < 400; s++) {
      steps++;
      const w = pool[rnd(pool.length)], op = rnd(8);
      if (op < 2) m.open(w); else if (op === 2) m.close(w); else if (op === 3) m.raise(w);
      else if (op === 4) m.move(w, 16 * rnd(32), 8 + 8 * rnd(23)); else if (op === 5) m.inval(rnd(600) - 50, rnd(250) - 30, rnd(200), rnd(100));
      else if (op === 6) m.drawview(w);
      else {
        const dirtyBefore = Uint8Array.from(m.dirty), mapBefore = Uint8Array.from(m.map), bits = m.mapBytes();
        void bits;
        m.log = [];
        const painted = m.update();
        // the painted rectangles are disjoint, cover exactly the dirty cells, and each is wholly owned by one owner
        const cover = new Uint8Array(NCELL);
        for (const p of painted) for (let r = p.clip[2] >> 3; r < p.clip[3] >> 3; r++) for (let c = p.clip[0] >> 4; c < p.clip[1] >> 4; c++) {
          if (cover[r * COLS + c]++) bads++;
          if (mapBefore[r * COLS + c] !== p.o) bads++;
        }
        for (let i = 0; i < NCELL; i++) if ((cover[i] === 1) !== (dirtyBefore[i] === 1)) bads++;
        if (m.anyDirty()) bads++;
      }
      // the map equals an independent construction: paint the windows back to front over the desk
      const ind = new Uint8Array(NCELL);
      for (let c = 0; c < COLS; c++) ind[c] = 15;
      for (const win of [...m.list].reverse()) for (let r = win.y >> 3; r < (win.y + win.h) >> 3; r++) for (let c = win.x >> 4; c < (win.x + win.w) >> 4; c++) ind[r * COLS + c] = win.slot;
      if (Buffer.compare(Buffer.from(ind), Buffer.from(m.map)) !== 0) bads++;
      // slots and the list agree; slots are distinct
      const used = new Set(m.list.map((x) => x.slot));
      if (used.size !== m.list.length || m.list.some((x) => m.slots[x.slot] !== x)) bads++;
      if (m.list.length && m.fscope !== m.front()) bads++;
      if (!m.list.length && m.fscope !== null) bads++;
      if (m.focus && m.fscope && !m.under(m.focus, m.fscope)) bads++;
    }
  }
  eq(`invariants over ${steps} random steps`, bads, 0);
  console.log(`wm-model self-test: ${n - fails} passed, ${fails} failed`);
  if (fails) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
