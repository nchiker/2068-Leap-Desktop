"use strict";
// wm-model2.mjs -- reference model of slice W2 of the window manager (docs/WINDOWS.md sections 1-11, 14, 15 and 17), built on the W1 model
// (tests/wm-model.mjs).  Written from the contract only; the Z80 code (src/kernel/wm2.asm) was never read.
//
//   node tests/wm-model2.mjs --self-test      hand-worked cases and invariants of the model itself
//
// What it adds to WmModel:
//   * 17.2's amendments: W_OPEN of a Dialog sets W_MODAL (after activation), W_CLOSE clears it (before activation), W_RAISE is refused
//     (carry) while W_MODAL != 0 and the window is not W_MODAL;
//   * the event routing of OBJECTS_EVENTS 15.2 (`dispatch`: K_DISPATCH), `group_event`, capture, and W2's event methods: `desk_event`,
//     `window_event`, `dialog_event`, `button_event` (17.3), a click of a button and E_CMD;
//   * W_DRAG's state machine (17.4): `drag` holds the window, the start, the press, the candidate and whether the outline is drawn; `feed`
//     gives the next event of the ring to the drag loop while one is running;
//   * the pixels of every draw method (17.5, 14.3, 14.5) as gfx6-model drawing: `drawInto`, `renderOwner`, `composite`, `xorOutline`;
//   * `Ptr`: the pointer, the mouse and the keys as the input ISR turns them into events (OBJECTS_EVENTS 14.3 with WINDOWS 15.2), for the
//     inputs the tests use (mouse motion and the left button, plain keys and CAPS SHIFT keys; no joystick, no keyboard-pointer mode).
//
// Readings of the contract (also in the report):
//  R1. The 4 frames of a key click are not modelled in time: `click(b)` does press, release and the post at once.  The tests wait long enough
//      (at least 6 frames after a key) before comparing, and a directed test checks the 4 frames of the flash on the screen.
//  R2. The clip of a log record written outside a draw is the whole screen (M5 of wm-model.mjs); `TCtl`'s M_EVENT logs code 3 and consumes
//      when its tag bit 0 is set (14.5); `TWin` inherits Window's M_EVENT (window_event), `TGrp` and `TNull` Group's.
//  R3. "In the title bar" is wy <= y < wy + 9 and nothing else is tested (17.3), the window having been hit already.
//  R4. M_BLUR of a Button draws it without the focus look and M_FOCUS with it (17.3 as amended): the pixels follow K_FOCUS, so the model
//      draws a button focused exactly when K_FOCUS is the button.
//  R5. The ring's coalescing of E_MOVEs is not modelled (the tests never let two unread E_MOVEs pile up, or the final state does not depend
//      on the dropped intermediate positions).
//  R6. floor((w - tw) / 2) and floor((h - 8) / 2) of button_draw are Math.floor (also for negative values, w < tw).
//  R7. An E_UP ends a drag after its own point is taken as a candidate (17.4 step 3 comes before "On E_UP").
import { fileURLToPath } from 'node:url';
import { WmModel, validRect, decompose, COLS, ROWS, NCELL, WHOLE, KEYS } from './wm-model.mjs';
import { Gfx6Model, fonts, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';

export { WmModel, validRect, decompose, COLS, ROWS, NCELL, WHOLE };
export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, REDRAW: 6, MENU: 7, CMD: 10 };
export const K = { ...KEYS, ESC: 27, BREAK: 3, SPACE: 32, MENU: 16 };
export const WINKINDS = ['Window', 'TWin', 'Dialog'];
export const isWinKind = (k) => WINKINDS.includes(k);

const inRect = (n, x, y) => n.w > 0 && n.h > 0 && x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h;
const pt = (ev) => ({ x: ev[1] + 256 * (ev[3] & 1), y: ev[2] });
const PW = () => fonts().prop6.W;

// ---------------------------------------------------------------------------------------------------------------------------
// The pixels.
/** n' of 14.3 step 4: the largest count of codes whose PROP6_W sum is <= w - 16. */
export function titleCut(codes, w) {
  const W = PW();
  let sum = 0, k = 0;
  for (let i = 0; i < codes.length; i++) { sum += W[codes[i]]; if (sum <= w - 16) k = i + 1; }
  return k;
}
/** button_draw (17.5), `focused` already decided by the caller. */
export function buttonLook(g, b, focused) {
  const { x, y, w, h } = b, codes = b.text ? b.text.codes : [];
  const tw = codes.length ? g.textw(codes) : 0;
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, w, h);
  if (b.flags & 0x10) g.frame(x + 2, y + 1, w - 4, h - 2);
  const tx = x + Math.floor((w - tw) / 2), ty = y + Math.floor((h - 8) / 2);
  if (codes.length) g.textp(tx, ty, codes);
  if (focused) g.hline(tx, ty + 8, tw);
  if (b.flags & 0x08) { g.setOp(OP_XOR); g.fill(x + 1, y + 1, w - 2, h - 2); }
}
export function labelLook(g, l) {
  const { x, y, w, h } = l, codes = l.text ? l.text.codes : [];
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET);
  if (codes.length) { if (l.flags & 8) g.text8(x >> 3, y >> 3, codes); else g.textp(x, y, codes); }
}
export function dialogLook(g, d) {
  const { x, y, w, h } = d;
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, w, h); g.frame(x + 4, y + 2, w - 8, h - 4);
}
export function windowLook(g, n, active) {
  const { x, y, w, h } = n;
  g.setOp(OP_SET); g.frame(x, y, w, h);
  g.setOp(active ? OP_SET : OP_CLR); g.fill(x + 1, y + 1, w - 2, 7);
  g.setOp(OP_SET); g.hline(x + 1, y + 8, w - 2);
  if (n.title) { g.setOp(active ? OP_XOR : OP_SET); g.textp(x + 8, y, n.title.codes.slice(0, titleCut(n.title.codes, w))); }
  g.setOp(OP_CLR); g.fill(x + 1, y + 9, w - 2, h - 10);
}
/** The M_DRAW of a node with the whole-screen clip, drawn into g (a Gfx6Model); `model` says who is in front and who has the focus. */
export function drawInto(model, g, n) {
  const kids = () => { for (const c of n.kids) { if (c.flags & 2) continue; if (!(c.w > 0 && c.h > 0 && c.x < 512 && c.x + c.w > 0 && c.y < 192 && c.y + c.h > 0)) continue; drawInto(model, g, c); } };
  switch (n.kind) {
    case 'Desk': g.setOp(OP_CLR); g.fill(0, 8, 512, 184); break;
    case 'MenuBar': g.setOp(OP_SET); g.fill(0, 0, 512, 8); break;
    case 'Window': case 'TWin': windowLook(g, n, n.slot !== 0 && model.front() === n); kids(); break;
    case 'Dialog': dialogLook(g, n); kids(); break;
    case 'TGrp': g.setOp(OP_CLR); g.fill(n.x, n.y, n.w, n.h); kids(); break;
    case 'Group': kids(); break;
    case 'TNull': break;
    case 'TCtl': g.setOp(OP_CLR); g.fill(n.x, n.y, n.w, n.h); g.setOp(OP_SET); g.frame(n.x, n.y, n.w, n.h); g.line(n.x, n.y, n.x + n.w - 1, n.y + n.h - 1); break;
    case 'Button': buttonLook(g, n, model.focus === n); break;
    case 'Label': labelLook(g, n); break;
    default: throw new Error(`model: drawInto ${n.kind}`);
  }
}
/** image(o) of section 6: the owner's M_DRAW alone on a blank screen. */
export function renderOwner(model, o) { const g = new Gfx6Model(); drawInto(model, g, model.slots[o]); return g; }
/** The screen of section 6's "what the screen must show", every cell the image of its owner. */
export function composite(model) {
  const imgs = new Map(), out = new Gfx6Model();
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const o = model.map[r * COLS + c];
    if (!imgs.has(o)) imgs.set(o, renderOwner(model, o));
    const im = imgs.get(o).px;
    for (let y = 8 * r; y < 8 * r + 8; y++) out.px.set(im.subarray(y * 512 + 16 * c, y * 512 + 16 * c + 16), y * 512 + 16 * c);
  }
  return out;
}
/** The outline of 17.4 step 4: the pixels G_FRAME would set, XORed once. */
export function xorOutline(g, x, y, w, h) { g.setOp(OP_XOR); g.frame(x, y, w, h); }
/** A Gfx6Model as display bytes in the layout of wm-lib.mjs's readDisp (y * 64 + byte column). */
export function toDisp(g) {
  const out = new Uint8Array(192 * 64), px = g.px;
  for (let y = 0; y < 192; y++) for (let bc = 0; bc < 64; bc++) {
    const i = y * 512 + bc * 8;
    out[y * 64 + bc] = (px[i] << 7) | (px[i + 1] << 6) | (px[i + 2] << 5) | (px[i + 3] << 4) | (px[i + 4] << 3) | (px[i + 5] << 2) | (px[i + 6] << 1) | px[i + 7];
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The input as the ISR turns it into events.
export const KEYSPEC = {
  ENTER: { keys: [30], code: 13 }, SPACE: { keys: [35], code: 32 }, a: { keys: [5], code: 97 }, x: { keys: [2], code: 120 },
  TAB: { keys: [0, 15], code: 14 }, BACKTAB: { keys: [0, 17], code: 15 }, ESC: { keys: [0, 18], code: 27 }, BREAK: { keys: [0, 35], code: 3 },
  MENU: { keys: [0, 21], code: 16 }, LEFT: { keys: [0, 19], code: 8 }, RIGHT: { keys: [0, 22], code: 9 }, UP: { keys: [0, 23], code: 11 }, DOWN: { keys: [0, 24], code: 10 },
};
export class Ptr {
  constructor(x, y) { this.x = x; this.y = y; this.btn = 0; this.px = x; this.py = y; }
  warp(x, y) { this.x = Math.min(Math.max(x, 0), 511); this.y = Math.min(Math.max(y, 0), 191); }
  /** One frame of input: { dx, dy (down positive), btn (the left button), key (a KEYSPEC name or null) }; returns the events in the ring's order. */
  step(inp) {
    const evs = [];
    this.px = this.x; this.py = this.y;                                  // where the previous frame's poll left it
    if (inp.key) { const k = KEYSPEC[inp.key]; evs.push([E.KEY, k.code, k.keys.includes(0) ? 1 : 0, 0]); }
    const nx = Math.min(Math.max(this.x + (inp.dx || 0), 0), 511), ny = Math.min(Math.max(this.y + (inp.dy || 0), 0), 191), nb = inp.btn ? 1 : 0;
    const d3 = (nx >> 8) | (nb << 1);
    if (nx !== this.x || ny !== this.y) evs.push([E.MOVE, nx & 255, ny, d3]);
    if (nb !== this.btn) evs.push([nb ? E.DOWN : E.UP, nx & 255, ny, d3]);
    this.x = nx; this.y = ny; this.btn = nb;
    return evs;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
export class WmModel2 extends WmModel {
  constructor(deskAddr, barAddr) {
    super(deskAddr, barAddr);
    this.evlog = [];                 // the E_MENU / E_CMD records T_APPLOOP appends to T_EVLOG (17.6)
    this.drag = null;                // W_DRAG in progress: { w, sx, sy, p0x, p0y, cx, cy, drawn }
    this.fault2 = 0;                 // --mutate N of tests/wm-w2.mjs: a planted fault
    this.stats2 = { clicks: 0, cmds: 0, drags: 0, moved: 0, cancelled: 0, raisedByClick: 0, modalIgnored: 0, dropped: 0 };
  }
  isDialog(n) { return n.kind === 'Dialog'; }
  logHas(kind) { return kind === 'TWin' || kind === 'TCtl'; }
  drawNode(n, clip) {
    if (n.kind === 'Dialog') { this.stats.draws++; this.clip = clip.slice(); this.groupDraw(n, clip); this.clip = WHOLE.slice(); return; }
    if (n.kind === 'Button' || n.kind === 'Label') { this.stats.draws++; return; }
    super.drawNode(n, clip);
  }

  // ---- 17.2 --------------------------------------------------------------------------------------------------------------------
  open(w) {
    const carry = super.open(w);
    if (!carry && this.isDialog(w)) this.modal = w;
    return carry;
  }
  close(w) {
    if (w.slot !== 0 && this.modal === w) this.modal = 0;
    return super.close(w);
  }
  raise(w) {
    if (this.modal !== 0 && w !== this.modal && this.fault2 !== 1) return 1;
    return super.raise(w);
  }
  destroyWindow(w) { if (this.modal === w) this.modal = 0; super.destroyWindow(w); }

  // ---- K_DISPATCH (OBJECTS_EVENTS 15.2) -----------------------------------------------------------------------------------------
  /** The next event of the ring: to the drag loop while W_DRAG runs, else to K_DISPATCH. */
  feed(ev) { if (this.drag) this.dragEvent(ev); else this.dispatch(ev); }
  /** E_REDRAW once both queues are empty and a cell is dirty (not while W_DRAG runs: it never gets there, nothing is dirty). */
  idle() { if (!this.drag && this.anyDirty()) this.update(); }
  dispatch(ev) {
    const t = ev[0];
    if (t === E.KEY) {
      let v = this.focus || this.desk, consumed = false;
      while (v) { if (this.send(v, ev)) { consumed = true; break; } v = v.parent; }
      if (!consumed) {
        if ([K.TAB, K.DOWN, K.RIGHT].includes(ev[1])) this.focusNext();
        else if ([K.BACKTAB, K.UP, K.LEFT].includes(ev[1])) this.focusPrev();
      }
    } else if (t === E.DOWN) { this.capture = null; this.send(this.desk, ev); }
    else if (t === E.MOVE) this.send(this.capture || this.desk, ev);
    else if (t === E.UP) {
      if (this.capture) { const v = this.capture; this.capture = null; this.send(v, ev); } else this.send(this.desk, ev);
    } else if (t === E.REDRAW) this.update();
    else this.send(this.desk, ev);
  }
  /** M_EVENT to v: carry = consumed. */
  send(v, ev) {
    switch (v.kind) {
      case 'Desk': return this.deskEvent(ev);
      case 'Window': case 'TWin': return this.windowEvent(v, ev);
      case 'Dialog': return this.dialogEvent(v, ev);
      case 'Button': return this.buttonEvent(v, ev);
      case 'TCtl': this.rec(3, v); return v.tag & 1;
      case 'Group': case 'TGrp': case 'TNull': return this.groupEvent(v, ev);
      default: return 0;                                     // MenuBar (k_nop), Label (View's)
    }
  }
  groupEvent(g, ev) {
    const t = ev[0];
    if (t !== E.MOVE && t !== E.DOWN && t !== E.UP) return 0;
    const p = pt(ev);
    let target = null;
    for (const c of g.kids) { if (c.flags & 6) continue; if (inRect(c, p.x, p.y)) { target = c; break; } }
    if (!target) return 0;
    if (t === E.DOWN && (target.flags & 1)) this.setFocus(target);
    const consumed = this.send(target, ev);
    if (consumed && t === E.DOWN && !this.capture) this.capture = target;
    return consumed;
  }
  deskEvent(ev) {
    const t = ev[0];
    if (t === E.KEY) return 0;
    if ((t === E.DOWN || t === E.MOVE || t === E.UP) && this.modal !== 0) {
      const d = this.modal, p = pt(ev);
      if (inRect(d, p.x, p.y)) return this.send(d, ev);
      this.stats2.modalIgnored++;
      return 1;
    }
    return this.groupEvent(this.desk, ev);
  }
  windowEvent(w, ev) {
    if (ev[0] === E.DOWN) {
      const p = pt(ev), inTitle = p.y >= w.y && p.y < w.y + 9;
      if (this.front() !== w) { this.raise(w); this.stats2.raisedByClick++; if (inTitle) this.startDrag(w, ev); return 0; }
      if (inTitle) { this.startDrag(w, ev); return 0; }
    }
    return this.groupEvent(w, ev);
  }
  dialogEvent(d, ev) {
    if (ev[0] === E.KEY) {
      if (ev[1] === 13 && d.default) { this.click(d.default); return 1; }
      if ((ev[1] === 27 || ev[1] === 3) && d.cancel) { this.click(d.cancel); return 1; }
    }
    return this.groupEvent(d, ev);
  }
  buttonEvent(b, ev) {
    const t = ev[0], pressed = () => (b.flags & 8) !== 0;
    if (t === E.DOWN) { b.flags |= 8; return 1; }
    if (t === E.MOVE) {
      if (this.capture !== b) return 0;
      const p = pt(ev), inside = inRect(b, p.x, p.y);
      if (inside !== pressed()) { if (inside) b.flags |= 8; else b.flags &= ~8; }
      return 1;
    }
    if (t === E.UP) { if (pressed()) { b.flags &= ~8; this.postCmd(b); } return 1; }
    if (t === E.KEY && (ev[1] === 13 || ev[1] === 32)) { this.click(b); return 1; }
    return 0;
  }
  /** 17.3: the slot of the open window b is in, else 0. */
  slotOf(b) {
    let x = b;
    while (x && x.parent !== this.desk) x = x.parent;
    return x && x !== this.bar && x.slot ? x.slot : 0;
  }
  postCmd(b) { this.stats2.cmds++; this.evlog.push([E.CMD, b.id, this.slotOf(b), 0]); }
  /** A click of b (R1: the four frames are not modelled). */
  click(b) { this.stats2.clicks++; b.flags |= 8; b.flags &= ~8; this.postCmd(b); }

  // ---- W_DRAG (17.4) -------------------------------------------------------------------------------------------------------------
  startDrag(w, ev) {
    this.update();
    const p = pt(ev);
    this.stats2.drags++;
    this.drag = { w, sx: w.x, sy: w.y, p0x: p.x, p0y: p.y, cx: w.x, cy: w.y, drawn: false };
  }
  /** The candidate of 17.4 step 3 for the point (px, py). */
  candidate(d, px, py) {
    const w = d.w;
    let cx = d.sx + 16 * Math.floor((px - d.p0x + 8) / 16), cy = d.sy + 8 * Math.floor((py - d.p0y + 4) / 8);
    if (this.fault2 === 2) { cx = d.sx + 16 * Math.trunc((px - d.p0x + 8) / 16); cy = d.sy + 8 * Math.trunc((py - d.p0y + 4) / 8); }
    cx = Math.min(Math.max(cx, 0), 512 - w.w); cy = Math.min(Math.max(cy, 8), 192 - w.h);
    return [cx, cy];
  }
  dragEvent(ev) {
    const d = this.drag, t = ev[0];
    if (t === E.MOVE || t === E.UP) {
      const p = pt(ev), [cx, cy] = this.candidate(d, p.x, p.y);
      if (cx !== d.cx || cy !== d.cy) { d.cx = cx; d.cy = cy; d.drawn = !(cx === d.sx && cy === d.sy); }
      if (t === E.UP) {
        d.drawn = false;
        if (d.cx !== d.sx || d.cy !== d.sy) { this.move(d.w, d.cx, d.cy); this.stats2.moved++; }
        this.drag = null;
      }
    } else if (t === E.KEY && (ev[1] === 27 || (ev[1] === 3 && this.fault2 !== 3))) { d.drawn = false; this.drag = null; this.stats2.cancelled++; }
    else this.stats2.dropped++;
  }
  /** The outline now on the screen, or null. */
  outline() { const d = this.drag; return d && d.drawn ? { x: d.cx, y: d.cy, w: d.w.w, h: d.w.h } : null; }
  /** The screen the machine must show when the settled screen is composite() and the drag may be on: the same, with the outline XORed. */
  screen() { const g = composite(this); const o = this.outline(); if (o) xorOutline(g, o.x, o.y, o.w, o.h); return g; }
}

// ===========================================================================================================================
// Self-test: hand-worked cases (each expected value derived by hand from the contract, not from the model) and invariants.
function selfTest() {
  let fails = 0, n = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  let nextA = 0xC000;
  const fresh = () => { nextA = 0xC000; return new WmModel2(0xF500, 0xF510); };
  const mk = (m, kind, x, y, w, h, extra = {}) => m.addNode({ a: (nextA += 0x20), kind, x, y, w, h, ...extra });
  const mkWin = (m, x, y, w, h, kind = 'Window', extra = {}) => mk(m, kind, x, y, w, h, extra);
  const mkBtn = (m, par, x, y, w, h, id, extra = {}) => { const b = mk(m, 'Button', x, y, w, h, { id, flags: 1, text: { codes: [79, 75] }, ...extra }); m.attach(par, b); return b; };
  const down = (x, y) => [E.DOWN, x & 255, y, (x >> 8) | 2], move = (x, y, held = 1) => [E.MOVE, x & 255, y, (x >> 8) | (held << 1)], up = (x, y) => [E.UP, x & 255, y, x >> 8];
  const key = (c) => [E.KEY, c, 0, 0];
  const run = (m, evs) => { for (const e of evs) m.feed(e); m.idle(); };

  // -- the pointer and key model ------------------------------------------------------------------------------------------------------
  {
    const p = new Ptr(256, 96);
    eq('Ptr: a move of (+5, -3) gives one E_MOVE', p.step({ dx: 5, dy: -3 }), [[2, 5, 93, 1]].map((e) => [2, 261 & 255, 93, 1]));
    eq('Ptr: the left button goes down at the position, data 3 = bit 8 | 2', p.step({ btn: 1 }), [[3, 5, 93, 3]]);
    eq('Ptr: a move with the button held, then the release in the same frame', p.step({ dx: -10, btn: 0 }), [[2, 251, 93, 0], [4, 251, 93, 0]]);
    eq('Ptr: TAB is CAPS SHIFT + 1 = code 14 with data 2 bit 0, ENTER plain', [p.step({ key: 'TAB' }), p.step({ key: 'ENTER' })], [[[1, 14, 1, 0]], [[1, 13, 0, 0]]]);
    eq('Ptr: clamp at x 0 / 511, y 0 / 191', [p.step({ dx: -500 }).length, p.x, p.step({ dx: 900 }).length, p.x, p.step({ dy: -500 }).length, p.y, p.step({ dy: 900 }).length, p.y], [1, 0, 1, 511, 1, 0, 1, 191]);
    eq('Ptr: clamped to where it already is: no event', p.step({ dy: 9 }), []);
  }

  // -- 17.2: the modal rule on the routines -------------------------------------------------------------------------------------------
  {
    const m = fresh(); m.update();
    const A = mkWin(m, 16, 8, 128, 64), B = mkWin(m, 160, 8, 128, 64);
    const D = mkWin(m, 64, 48, 192, 80, 'Dialog');
    eq('open A, B', [m.open(A), m.open(B)], [0, 0]);
    eq('open the dialog: modal = D, slot 3, front', [m.open(D), m.modal === D, D.slot, m.front() === D], [0, true, 3, true]);
    eq('W_RAISE of A refused under the modal, the list unchanged', [m.raise(A), m.list.map((w) => w.slot)], [1, [3, 2, 1]]);
    eq('W_RAISE of the dialog itself: nothing, no carry', m.raise(D), 0);
    eq('W_OPEN of a window and a second dialog refused', [m.open(mkWin(m, 16, 100, 64, 32)), m.open(mkWin(m, 16, 100, 64, 32, 'Dialog'))], [1, 1]);
    eq('W_CLOSE of the dialog clears the modal, activates B', [m.close(D), m.modal, m.fscope === B], [0, 0, true]);
    eq('then raise works', [m.raise(A), m.front() === A], [0, true]);
    m.open(D); eq('reopen: modal again', m.modal === D, true);
    m.close(B); eq('closing another window keeps the modal', m.modal === D, true);
    eq('a closed window under a modal: carry too', m.raise(B), 1);
  }

  // -- the drag: rounding, clamping, the outline, cancel (hand-worked) -----------------------------------------------------------------------
  {
    const m = fresh(); m.update();
    const A = mkWin(m, 128, 48, 256, 96, 'TWin', { title: { codes: [65] } });
    m.open(A); m.update();
    const dragTo = (dx, dy, how = 'up') => {
      const x0 = 200, y0 = 50;                                     // press in the title bar (A at y 48, so rows 48..56)
      m.feed(down(x0, y0)); const r = { outlineAtMove: null };
      m.feed(move(x0 + dx, y0 + dy)); r.outlineAtMove = m.outline();
      m.feed(how === 'up' ? up(x0 + dx, y0 + dy) : key(how === 'esc' ? 27 : 3)); m.idle();
      return [A.x - 128, A.y - 48];
    };
    eq('press: the drag starts, nothing drawn', [(m.feed(down(200, 50)), m.drag !== null), m.outline()], [true, null]);
    m.feed(up(200, 50));
    eq('press and release with no move: nothing moved, no outline, nothing dirty', [A.x, A.y, m.drag, m.wDirty], [128, 48, null, 0]);
    // hand-worked: cx = 16 floor((dx + 8) / 16), cy = 8 floor((dy + 4) / 8)
    const table = [[0, 0, 0, 0], [7, 3, 0, 0], [8, 4, 16, 8], [23, 11, 16, 8], [24, 12, 32, 16], [-8, -4, 0, 0], [-9, -5, -16, -8], [-24, -12, -16, -8], [-25, -13, -32, -16], [40, 20, 48, 24]];
    for (const [dx, dy, ex, ey] of table) {
      m.move(A, 128, 48); m.update();
      eq(`drag by (${dx}, ${dy}) moves the window by (${ex}, ${ey})`, dragTo(dx, dy), [ex, ey]);
    }
    m.move(A, 128, 48); m.update();
    // clamping: A is 256 x 96 at (128, 48): x in [0, 256], y in [8, 96]
    // (the pointer stays on the screen: x 0..511, y 0..191; the press is at (200, 50))
    eq('clamp left (pointer at x 0)', dragTo(-200, 0), [-128, 0]);
    m.move(A, 128, 48); eq('clamp right (pointer at x 500)', dragTo(300, 0), [128, 0]);
    m.move(A, 128, 48); eq('clamp top (pointer at y 0)', dragTo(0, -50), [0, -40]);
    m.move(A, 128, 48); eq('clamp bottom (pointer at y 191)', dragTo(0, 141), [0, 48]);
    m.move(A, 128, 48); m.update();
    // the outline is shown while the candidate differs from the start, and not at the start
    m.feed(down(200, 50));
    m.feed(move(230, 50)); eq('candidate (+32, 0): outline at (160, 48)', m.outline(), { x: 160, y: 48, w: 256, h: 96 });
    m.feed(move(203, 52)); eq('back to the start: outline erased', m.outline(), null);
    m.feed(move(260, 90)); eq('outline at (128 + 64, 48 + 40) = (192, 88)', m.outline(), { x: 192, y: 88, w: 256, h: 96 });
    m.feed(key(14)); m.feed(key(13)); m.feed(down(10, 10));
    eq('other events are dropped: the drag goes on, nothing moved, no focus change', [m.drag !== null, A.x, A.y, m.stats2.dropped], [true, 128, 48, 3]);
    m.feed(key(27)); eq('ESC: outline erased, drag over, window where it was', [m.drag, m.outline(), A.x, A.y], [null, null, 128, 48]);
    m.feed(down(200, 50)); m.feed(move(260, 90)); m.feed(key(3));
    eq('BREAK counts as ESC', [m.drag, A.x, A.y], [null, 128, 48]);
    m.feed(up(260, 90));
    eq('the release after a cancel is an ordinary E_UP: nothing happens', [A.x, A.y, m.capture, m.drag], [128, 48, null, null]);
    m.feed(down(200, 50)); m.feed(move(230, 50)); m.feed(up(230, 50)); m.idle();
    eq('E_UP after a move: W_MOVE by (32, 0), repainted at the next E_REDRAW (clean)', [A.x, A.y, m.wDirty, m.capture], [160, 48, 0, null]);
    // the E_UP point counts as a candidate even with no E_MOVE before it
    m.feed(down(200, 50)); m.feed(up(240, 70));
    eq('E_UP alone moves too (candidate (+48, +24)): (208, 72)', [A.x, A.y], [208, 72]);
  }

  // -- a click on an inactive window raises it and nothing else gets the click --------------------------------------------------------------
  {
    const m = fresh(); m.update();
    const A = mkWin(m, 16, 8, 160, 64, 'TWin'), B = mkWin(m, 112, 40, 160, 64, 'TWin');
    const ba = mkBtn(m, A, 40, 30, 48, 16, 5), bb = mkBtn(m, B, 130, 60, 48, 16, 6);
    m.open(A); m.open(B); m.update();
    eq('B front, focus on bb (the first focusable of B)', [m.front() === B, m.focus === bb], [true, true]);
    // press on A's button where A is visible: the click only raises A
    run(m, [down(50, 38), up(50, 38)]);
    eq('click on an inactive window\'s button: A raised, the button not pressed, no E_CMD, no capture', [m.front() === A, ba.flags & 8, m.evlog.length, m.capture], [true, 0, 0, null]);
    eq('the focus is A\'s own first focusable (not the click\'s doing)', m.focus === ba, true);
    run(m, [down(50, 38), up(50, 38)]);
    eq('the second click presses and releases the button: E_CMD (id 5, slot 1)', m.evlog, [[10, 5, 1, 0]]);
    // click on the inactive B's title: raise and drag
    run(m, [down(200, 42), move(232, 42), up(232, 42)]);
    eq('title click of the inactive B: raised, then dragged by 32', [m.front() === B, B.x, B.y], [true, 144, 40]);
    // click on the bar and the desk do nothing
    run(m, [down(30, 3), up(30, 3), down(400, 150), up(400, 150)]);
    eq('bar and desk clicks: nothing', [m.evlog.length, m.front() === B, m.drag], [1, true, null]);
  }

  // -- the button by pointer: out and back, released inside / outside --------------------------------------------------------------------------
  {
    const m = fresh(); m.update();
    const A = mkWin(m, 16, 8, 160, 64, 'TWin'), b = mkBtn(m, A, 40, 30, 48, 16, 9), c = mkBtn(m, A, 100, 30, 48, 16, 10);
    m.open(A); m.update();
    m.feed(down(50, 35)); eq('E_DOWN: pressed, captured, focused', [b.flags & 8, m.capture === b, m.focus === b], [8, true, true]);
    m.feed(move(200, 35)); eq('moved out: not pressed', b.flags & 8, 0);
    m.feed(move(105, 35)); eq('over the other button: still the capturer\'s; c gets nothing', [b.flags & 8, c.flags & 8, m.capture === b], [0, 0, true]);
    m.feed(move(60, 40)); eq('back in: pressed', b.flags & 8, 8);
    m.feed(up(60, 40)); m.idle();
    eq('released inside: E_CMD (9, 1), unpressed, no capture', [m.evlog, b.flags & 8, m.capture], [[[10, 9, 1, 0]], 0, null]);
    m.feed(down(50, 35)); m.feed(move(300, 100)); m.feed(up(300, 100)); m.idle();
    eq('released outside: no E_CMD, unpressed', [m.evlog.length, b.flags & 8, m.capture], [1, 0, null]);
    // a move without the capture is not consumed (no press)
    eq('E_MOVE with no capture over a button: not consumed', [m.buttonEvent(c, move(110, 35)), c.flags & 8], [0, 0]);
    // keys: ENTER and SPACE click the focused button, other keys are not consumed
    m.setFocus(c);
    run(m, [key(32)]); eq('SPACE on the focused c: E_CMD (10, 1)', m.evlog[m.evlog.length - 1], [10, 10, 1, 0]);
    run(m, [key(13)]); eq('ENTER too', m.evlog.length, 3);
    run(m, [key(97)]); eq('another key: nothing', m.evlog.length, 3);
    run(m, [key(14)]); eq('TAB moves the focus to the next in the window (wraps to b)', m.focus === b, true);
  }

  // -- dialogs: ENTER / ESC / BREAK ---------------------------------------------------------------------------------------------------------------
  {
    const m = fresh(); m.update();
    const A = mkWin(m, 16, 8, 160, 64, 'TWin'), D = mkWin(m, 96, 56, 192, 80, 'Dialog');
    const ok = mkBtn(m, D, 110, 100, 48, 16, 1, { flags: 0x11 }), cancel = mkBtn(m, D, 200, 100, 64, 16, 2);
    const lab = mk(m, 'Label', 112, 70, 80, 8, { text: { codes: [72] } }); m.attach(D, lab);
    const tc = mk(m, 'TCtl', 220, 70, 40, 16, { flags: 1, tag: 0 }); m.attach(D, tc);
    D.default = ok; D.cancel = cancel;
    m.open(A); m.open(D); m.update();
    eq('the dialog opened: modal, focus on its first focusable (ok)', [m.modal === D, m.focus === ok], [true, true]);
    run(m, [down(10, 150), up(10, 150), down(130, 12), up(130, 12), down(300, 3), up(300, 3)]);
    eq('clicks outside the dialog (desk, A\'s title, the bar) are consumed and ignored', [m.front() === D, m.drag, m.evlog.length, A.x], [true, null, 0, 16]);
    run(m, [key(14)]); eq('TAB inside the dialog: the cancel button', m.focus === cancel, true);
    run(m, [key(13)]); eq('ENTER with the focus on cancel: that button clicks (id 2, slot 2)', m.evlog, [[10, 2, 2, 0]]);
    m.setFocus(tc); m.evlog.length = 0;
    run(m, [key(13)]); eq('ENTER with the focus on a view that does not take it (it bubbles to the dialog): the default button (1, 2)', m.evlog, [[10, 1, 2, 0]]);
    run(m, [key(27)]); run(m, [key(3)]); eq('ESC and BREAK: the cancel button', m.evlog.slice(1), [[10, 2, 2, 0], [10, 2, 2, 0]]);
    run(m, [key(97)]); eq('other keys: nothing', m.evlog.length, 3);
    D.default = null; run(m, [key(13)]); eq('ENTER with Dialog_default = 0: nothing', m.evlog.length, 3);
    D.cancel = null; run(m, [key(27)]); eq('ESC with Dialog_cancel = 0: nothing', m.evlog.length, 3);
    // inside: a click on ok by pointer
    m.evlog.length = 0;
    run(m, [down(120, 108), up(120, 108)]);
    eq('a click on ok by pointer: E_CMD (1, 2)', m.evlog, [[10, 1, 2, 0]]);
    eq('close the dialog: modal 0, A activated', [m.close(D), m.modal, m.front() === A], [0, 0, true]);
  }

  // -- pixels (hand-worked counts) -----------------------------------------------------------------------------------------------------------------
  {
    const ink = (g) => g.count();
    const b = { x: 10, y: 20, w: 48, h: 16, flags: 0, text: null };
    let g = new Gfx6Model(); buttonLook(g, b, false);
    eq('button 48 x 16, no text: the frame, 2 x 48 + 2 x 14 = 124 pixels', ink(g), 124);
    g = new Gfx6Model(); buttonLook(g, { ...b, flags: 0x10 }, false);
    eq('default: the inner frame (2, 1, 44, 14) adds 2 x 44 + 2 x 12 = 112', ink(g), 236);
    g = new Gfx6Model(); buttonLook(g, { ...b, flags: 0x08 }, false);
    eq('pressed: the whole 46 x 14 interior inked, 644 + 124 = 768', ink(g), 768);
    g = new Gfx6Model(); buttonLook(g, { ...b, flags: 0x18 }, false);
    eq('default and pressed: interior XORed, 644 - 112 + 124 = 656', ink(g), 656);
    g = new Gfx6Model(); buttonLook(g, b, true);
    eq('focused with no text: tw = 0, no underline', ink(g), 124);
    const W = fonts().prop6.W, tw = W[79] + W[75], t = { ...b, text: { codes: [79, 75] } };
    g = new Gfx6Model(); buttonLook(g, { ...t, flags: 0 }, false); const plain = ink(g);
    const g2 = new Gfx6Model(); buttonLook(g2, t, true);
    eq('focused: an underline of tw pixels at (tx, ty + 8), tx = 10 + floor((48 - tw) / 2), ty = 20 + 4', [ink(g2) - plain, g2.get(10 + Math.floor((48 - tw) / 2), 32), g2.get(10 + Math.floor((48 - tw) / 2) + tw - 1, 32), g2.get(10 + Math.floor((48 - tw) / 2) + tw, 32)], [tw, 1, 1, 0]);
    g = new Gfx6Model(); dialogLook(g, { x: 16, y: 40, w: 64, h: 32 });
    eq('dialog 64 x 32: outer frame 2 x 64 + 2 x 30 = 188, inner (4, 2, 56, 28) 2 x 56 + 2 x 26 = 164', ink(g), 352);
    g = new Gfx6Model(); g.setOp(OP_SET); g.fill(0, 0, 512, 192); labelLook(g, { x: 8, y: 8, w: 40, h: 8, flags: 0, text: null });
    eq('label: the rectangle cleared', ink(g), 512 * 192 - 40 * 8);
    g = new Gfx6Model(); g.setOp(OP_SET); g.fill(0, 0, 512, 192); labelLook(g, { x: 8, y: 8, w: 8, h: 8, flags: 8, text: { codes: [0] } });
    eq('label 8x8 with a blank glyph: the cell cleared (opaque)', ink(g), 512 * 192 - 64);
    // the window look is W1's (hand counts in W1's tests); here only: an active window has an inked title band
    const m = fresh(); m.update(); const A = mkWin(m, 16, 8, 64, 24); m.open(A);
    g = renderOwner(m, A.slot);
    eq('active window 64 x 24, no title: frame 2 x 64 + 2 x 22 = 172, band 62 x 7 = 434, separator at row y + 8: 62 -> 668, content empty', ink(g), 172 + 434 + 62);
    const g3 = composite(m);
    eq('composite: the bar is inked, the desk is paper, the window\'s cells are the window\'s image', [g3.get(0, 0), g3.get(511, 7), g3.get(300, 100), g3.get(16, 8), g3.get(40, 20)], [1, 1, 0, 1, 0]);
    eq('toDisp: the bar is $FF in byte columns 0..63 of rows 0..7', [toDisp(g3)[0], toDisp(g3)[63], toDisp(g3)[7 * 64 + 31], toDisp(g3)[8 * 64 + 40]], [255, 255, 255, 0]);
    const o = composite(m); xorOutline(o, 100, 100, 48, 16);
    eq('outline: 2 x 48 + 2 x 14 = 124 pixels XORed once, twice restores', [o.count() - composite(m).count(), (xorOutline(o, 100, 100, 48, 16), o.compare(composite(m)))], [124, null]);
  }

  // -- invariants over random scripts: the machine-independent facts -----------------------------------------------------------------------------------
  {
    let seed = 4242; const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % k; };
    let bads = 0, steps = 0;
    for (let run_ = 0; run_ < 60; run_++) {
      const m = fresh(); m.update();
      const wins = [], p = new Ptr(256, 96);
      for (let i = 0; i < 5; i++) {
        const w = 16 * (3 + rnd(6)), h = 8 * (4 + rnd(6));
        const A = mkWin(m, 16 * rnd(32 - w / 16 + 1), 8 + 8 * rnd(Math.floor((184 - h) / 8) + 1), w, h, rnd(4) === 0 ? 'Dialog' : 'TWin');
        for (let k = 0; k < 2; k++) mkBtn(m, A, A.x + 8 + 56 * k, A.y + 12, 48, 16, 10 * i + k);
        A.default = A.kids[0]; A.cancel = A.kids[1];
        wins.push(A);
      }
      for (let s = 0; s < 200; s++) {
        steps++;
        const r = rnd(10);
        if (r === 0 && !m.drag) m.open(wins[rnd(5)]);
        else if (r === 1 && !m.drag) m.close(wins[rnd(5)]);
        else if (r === 2 && !m.drag) m.raise(wins[rnd(5)]);
        else {
          const inp = { dx: rnd(60) - 30, dy: rnd(40) - 20, btn: rnd(2), key: rnd(6) === 0 ? ['TAB', 'ENTER', 'ESC', 'BREAK', 'SPACE', 'a'][rnd(6)] : null };
          for (const ev of p.step(inp)) m.feed(ev);
        }
        m.idle();
        // invariants: modal is the front window or 0; the dialog is never dragged; no drag without the front window being the dragged one
        if (m.modal !== 0 && (m.front() !== m.modal || m.modal.slot === 0)) bads++;
        if (m.drag && m.front() !== m.drag.w) bads++;
        if (m.drag && m.modal !== 0 && m.drag.w === m.modal) bads++;
        if (!m.drag && m.wDirty) bads++;
        for (const w of m.list) if (!validRect(w.x, w.y, w.w, w.h)) bads++;
        for (const w of wins) if (w.slot === 0 && w.parent) bads++;
        if (m.capture && !m.under(m.capture, m.desk)) bads++;
      }
    }
    eq(`invariants over ${steps} random steps`, bads, 0);
  }
  console.log(`wm-model2 self-test: ${n - fails} passed, ${fails} failed`);
  if (fails) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
