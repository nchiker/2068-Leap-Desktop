"use strict";
// tk-model.mjs -- reference model of toolkit slice T1 (docs/TOOLKIT.md sections 1-7 and 9): Check (and radio) and VScroll.  Written from the
// contract only (TOOLKIT 9, WINDOWS 4-5, 7, 17.3, 17.5, OBJECTS_EVENTS 5-6, 15); src/kernel/tk.asm and src/apps/demo.asm were never read.
//
//   node tests/tk-model.mjs --self-test      hand-worked cases of the model itself
//
// What is here:
//   * checkLook (9.2), vsGeom / vsLook (9.3): the exact pixels as gfx6-model drawing (CLR fill, frames, lines, fills, PROP6 text, the focus underline);
//   * TkTree: a window with Check / Label / VScroll / Group children, the focus, the capture, K_DISPATCH's routing for pointer and key events, K_SETFOCUS,
//     the kernel's TAB / arrow defaults, Check's state machine (9.2), the radio rule; every W_DRAWVIEW and every E_CMD it makes is logged in order;
//   * VsTrack: VScroll's tracking loop (9.3) as a per-frame machine: the part pressed, steps and clamping, the repeat (15 frames, then every 6, counted
//     by V_FRAMES), the thumb drag (halves up), the target told (E_SCROLL record) or E_CMD posted, `tells` in order;
//   * setBar (TK_SETBAR).
//
// Readings of the contract (also in the report):
//  R1. Look of a Check with no text: tw = 0, the focus underline has width 0 and draws nothing.
//  R2. A hold of an arrow / page that leaves its part, or a thumb that comes under the pointer, stops repeating; the generators never bring the pointer back
//      into the part, and never put an event in the frame of a due repeat unless both orders of "repeat check" and "events" give the same trace
//      (`VsTrack.frame(..., order)`).  The repeat check is taken before the frame's events (K_GETEV returns carry, HALT, repeat check: 9.3 "The loop").
//  R3. The pressed arrow is drawn pressed from the E_DOWN that presses it until the E_UP, also when the step is clamped (no change of value).
//  R4. The page parts need a thumb (max > 0); with max = 0 a press in the track is not generated.
//  R5. Radio rule: the siblings are the other children of the same parent; a radio that is already checked draws once (self), the model counts a second
//      draw of self as an `extra` (the test tolerates it and reports it).
//  R6. (9.7 item 2) With target = 0 the bar posts ONE E_CMD when tracking ends (as Button, 17.3: C = View_id, E = the window's slot, D = 0), only if the value changed.
//  R7. (9.7 item 1) The repeat deadlines are the press frame + 15, then each deadline + 6, whatever a step costs; (item 5) 'inside the part' is the part's rectangle.
import { fileURLToPath } from 'node:url';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';
import { labelLook, windowLook, toDisp } from './wm-model2.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR, labelLook, windowLook, toDisp };
export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, REDRAW: 6, MENU: 7, CMD: 10, SCROLL: 11 };
export const FL = { FOCUS: 1, HIDDEN: 2, DISABLED: 4, CHECKED: 8, RADIO: 0x10, PRESSED: 0x20 };
export const KEYC = { TAB: 14, BACKTAB: 15, UP: 11, DOWN: 10, LEFT: 8, RIGHT: 9, ENTER: 13, ESC: 27, SPACE: 32 };
export const PRESS = { NONE: 0, UP: 1, DOWN: 2 };          // the VScroll `press` byte; 1 = up, 2 = down is a reading (the test finds it out)

export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const inRect = (n, x, y) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Check (9.2)
/** The Check's pixels (9.2 steps 1-7).  c = { x, y, w, h, flags, codes }; focused: the focus underline (step 6). */
export function checkLook(g, c, focused) {
  const { x, y, w, h } = c, codes = c.codes, tw = codes.length ? g.textw(codes) : 0, radio = (c.flags & FL.RADIO) !== 0;
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, 13, 8);
  if (c.flags & FL.CHECKED) {
    if (radio) g.fill(x + 4, y + 3, 5, 2);
    else { g.line(x + 3, y + 2, x + 9, y + 5); g.line(x + 3, y + 5, x + 9, y + 2); }
  }
  if (radio) { g.setOp(OP_CLR); g.fill(x, y, 1, 1); g.fill(x + 12, y, 1, 1); g.fill(x, y + 7, 1, 1); g.fill(x + 12, y + 7, 1, 1); }
  g.setOp(OP_SET);
  if (codes.length) g.textp(x + 17, y, codes);
  if (focused) g.hline(x + 17, y + 8, tw);
  if (c.flags & FL.PRESSED) { g.setOp(OP_XOR); g.fill(x + 1, y + 1, 11, 6); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// VScroll (9.3)
/** { tl, thumb, th, ty }: the track length, whether there is a thumb (max > 0), its height and its top row. */
export function vsGeom(v) {
  const tl = v.h - 20;
  if (!(v.max > 0)) return { tl, thumb: false, th: 0, ty: v.y + 10 };
  const th = Math.min(tl, Math.max(6, Math.floor(tl * v.page / (v.max + v.page))));
  return { tl, thumb: true, th, ty: v.y + 10 + Math.floor((tl - th) * v.value / v.max) };
}
/** 9.3 Draw steps 1-5.  v = { x, y, w, h, value, max, page }; press 0 / 1 (up) / 2 (down). */
export function vsLook(g, v, press = 0) {
  const { x, y, w, h } = v, cx = x + (w >> 1), gm = vsGeom(v);
  g.setOp(OP_CLR); g.fill(x, y, w, h);
  g.setOp(OP_SET); g.frame(x, y, w, h);
  g.hline(x, y + 9, w); g.hline(x, y + h - 10, w);
  for (let k = 0; k < 3; k++) { g.hline(cx - 2 * k, y + 3 + k, 4 * k + 1); g.hline(cx - 2 * k, y + h - 4 - k, 4 * k + 1); }
  if (gm.thumb) g.fill(x + 2, gm.ty, w - 4, gm.th);
  if (press === PRESS.UP) { g.setOp(OP_XOR); g.fill(x + 1, y + 1, w - 2, 8); }
  else if (press === PRESS.DOWN) { g.setOp(OP_XOR); g.fill(x + 1, y + h - 9, w - 2, 8); }
}
/** The part of the bar at row py: 'up' | 'down' | 'thumb' | 'pgup' | 'pgdn' | 'none' (a track press with no thumb). */
export function vsPart(v, py) {
  if (py < v.y + 10) return 'up';
  if (py >= v.y + v.h - 10) return 'down';
  const gm = vsGeom(v);
  if (!gm.thumb) return 'none';
  if (py < gm.ty) return 'pgup';
  if (py >= gm.ty + gm.th) return 'pgdn';
  return 'thumb';
}
/** TK_SETBAR (IX = bar; A = value, C = max, B = page): max and page stored, value = min(A, max). */
export function setBar(v, a, c, b) { v.max = c; v.page = b; v.value = Math.min(a, c); }

/**
 * VScroll's tracking loop as a machine.  v is the bar's state { x, y, w, h, value, max, page, id } (updated in place); `target`: 'cmd' (target = 0: E_CMD is posted)
 * or 'tell' (the target is sent M_EVENT with the E_SCROLL record).  `tells` get { vf, value, press, kind } for each change of value, in order; `kind` = 'tell' | 'cmd'.
 *   down(px, py, vf)      the E_DOWN at (px, py) handled when V_FRAMES = vf (the step is taken at once)
 *   frame(vf, events, order)  one wake from HALT: V_FRAMES = vf, then `events` ({ t: 'move' | 'up' | 'other', px, py }) in order.
 *                         order 'repeatFirst' (9.3: carry, HALT, repeat check, loop to K_GETEV) | 'eventsFirst'.
 */
export class VsTrack {
  constructor(v, target, mode = 'py') { this.v = v; this.target = target; this.mode = mode; this.alive = false; this.tells = []; this.press = PRESS.NONE; this.vf = 0; this.px = 0; this.py = 0; }
  change(nv) {
    if (nv === this.v.value) return;
    this.v.value = nv; this.changed = true;
    if (this.target !== 'cmd') this.tells.push({ vf: this.vf, value: nv, press: this.press, kind: 'tell' });   // target = 0: one E_CMD when tracking ends (9.7 item 2)
  }
  step(part) {
    const v = this.v, amt = part === 'up' ? -1 : part === 'down' ? 1 : part === 'pgup' ? -v.page : v.page;
    if (part === 'up') this.press = PRESS.UP; else if (part === 'down') this.press = PRESS.DOWN;
    this.change(clamp(v.value + amt, 0, v.max));
  }
  down(px, py, vf) {
    const v = this.v;
    this.vf = vf; this.p = vf; this.due = 15; this.start = v.value; this.changed = false; this.px = px; this.py = py; this.alive = true;
    this.part = vsPart(v, py);
    if (this.part === 'none') throw new Error('model: a press in the track of a bar without a thumb (R4)');
    if (this.part === 'thumb') this.grab = py - vsGeom(v).ty;
    else this.step(this.part);
  }
  /**
   * Is the pointer (px, py) inside the part pressed?  The contract lists only rows ("up arrow: py < y + 10", 9.3), and says "while the pointer is inside that part":
   * three readings, `mode`: 'py' (rows only, the letter), 'xpy' (also x within the bar's width), 'rect' (also within the bar's rows: the arrow boxes and the track are rectangles).
   */
  inside(px, py) {
    const v = this.v, gm = vsGeom(v);
    const xin = this.mode === 'py' || (px >= v.x && px < v.x + v.w);
    const rows = this.mode !== 'rect' || (py >= v.y && py < v.y + v.h);
    if (!xin || !rows) return false;
    switch (this.part) {
      case 'up': return py < v.y + 10;
      case 'down': return py >= v.y + v.h - 10;
      case 'pgup': return gm.thumb && py >= v.y + 10 && py < gm.ty;
      case 'pgdn': return gm.thumb && py >= gm.ty + gm.th && py < v.y + v.h - 10;
      default: return false;
    }
  }
  repeatCheck() {
    if (!this.alive || this.part === 'thumb') return;
    if (this.vf - this.p >= this.due) {
      if (this.inside(this.px, this.py)) this.step(this.part); else this.skipped = true;     // a due repeat with the pointer out of the part
      this.due += 6;
    }
  }
  onEvent(ev) {
    if (!this.alive) return;
    if (ev.t === 'move') {
      this.px = ev.px; this.py = ev.py;
      if (this.skipped && this.part !== 'thumb' && this.inside(ev.px, ev.py)) this.ambiguous = true;   // back in the part after a skipped repeat: the contract does not say when the repeat resumes
      if (this.part === 'thumb') {
        const v = this.v, gm = vsGeom(v), span = gm.tl - gm.th;
        if (span !== 0) {
          const ty2 = clamp(ev.py - this.grab, v.y + 10, v.y + 10 + span);
          this.change(Math.floor((2 * (ty2 - v.y - 10) * v.max + span) / (2 * span)));
        }
      }
    } else if (ev.t === 'up') {
      this.press = PRESS.NONE; this.alive = false;
      if (this.target === 'cmd' && this.changed) {
        // 9.7: one E_CMD, only if the value changed during tracking; "changed" is read as a final value different from the start (a change and a change back is ambiguous)
        if (this.v.value === this.start) this.ambiguous = true;
        else this.tells.push({ vf: this.vf, value: this.v.value, press: 0, kind: 'cmd' });
      }
    }
    // 'other': dropped
  }
  frame(vf, events, order = 'repeatFirst') {
    this.vf = vf;
    if (order === 'repeatFirst') { this.repeatCheck(); for (const e of events) this.onEvent(e); }
    else { for (const e of events) this.onEvent(e); this.repeatCheck(); }
  }
}
export const MODES = ['py', 'xpy', 'rect'];
/** Run a script on a copy of the bar under both orders (repeat check first / events first); null when the traces differ or the model flags an ambiguity, else the trace of 'repeatFirst'. */
export function simulateTrack(v0, target, press, vf0, frames, mode = 'py') {
  const run = (order) => {
    const v = { ...v0 }, t = new VsTrack(v, target, mode), per = [];
    t.down(press.px, press.py, vf0);
    for (const e of press.pre || []) t.onEvent(e);
    const init = { value: v.value, press: t.press, alive: t.alive };
    frames.forEach((ev, i) => { t.frame(vf0 + i + 1, ev, order); per.push({ value: v.value, press: t.press, alive: t.alive }); });
    return { v, t, per, init };
  };
  const a = run('repeatFirst'), b = run('eventsFirst');
  if (a.t.ambiguous || b.t.ambiguous) return null;
  const sig = (r) => JSON.stringify([r.t.tells.map((x) => [x.vf, x.value, x.press]), r.per]);
  if (sig(a) !== sig(b)) return null;
  return a;
}
/** The simulations of a script under every reading of "inside that part": { py, xpy, rect } (a null where the reading is ambiguous for this script). */
export function simulateAll(v0, target, press, vf0, frames) { const o = {}; for (const m of MODES) o[m] = simulateTrack(v0, target, press, vf0, frames, m); return o; }
/**
 * Compare what the machine did with each simulation.  trace = { states: [{ value, press }] (states[0] after the press, states[k] after k frames), tells: [{ vf, value, press }] | null }.
 * Returns { matched: [modes], why: { mode: first difference } }.
 */
export function matchTrace(sims, trace, vf0) {
  const matched = [], why = {};
  for (const [mode, sim] of Object.entries(sims)) {
    if (!sim) continue;
    let d = null;
    const cmp = (k, want) => { const g = trace.states[k]; if (!d && (g.value !== want.value || g.press !== want.press)) d = `after ${k} frame(s): value ${g.value} press ${g.press}, model ${want.value} / ${want.press}`; };
    cmp(0, sim.init); sim.per.forEach((p, i) => cmp(i + 1, p));
    if (!d && trace.tells) {
      const w = sim.t.tells;
      if (trace.tells.length !== w.length) d = `${trace.tells.length} changes told or posted, model ${w.length}`;
      else trace.tells.forEach((t, i) => { if (!d && (t.vf !== (w[i].vf & 0xFFFF) || t.value !== w[i].value)) d = `change ${i + 1}: at V_FRAMES offset ${(t.vf - vf0) & 0xFFFF} value ${t.value}, model offset ${w[i].vf - vf0} value ${w[i].value}`; });
    }
    if (d) why[mode] = d; else matched.push(mode);
  }
  return { matched, why };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The window and its controls.
/** Preorder of the nodes below n (n itself not included). */
export function preorder(n, out = []) { for (const k of n.kids || []) { out.push(k); preorder(k, out); } return out; }

/**
 * A window with children and the kernel's focus / capture / routing, as far as Check needs it.
 * node: { kind: 'Check' | 'Label' | 'VScroll' | 'Group', id, x, y, w, h, flags, codes, kids }.  Check: flags (focusable 1, checked 8, radio $10, pressed $20).
 * `win`: { x, y, w, h, slot, title: codes }.  focus / capture are nodes or null.  `log` collects draws (nodes, in order) and posts ({ id, slot }).
 */
export class TkTree {
  constructor(win, kids) {
    this.win = { ...win, kids, kind: 'Window', flags: 0 }; this.focus = null; this.capture = null;
    this.draws = []; this.posts = []; this.extra = 0;
    const link = (n) => { for (const k of n.kids || []) { k.parent = n; link(k); } };
    link(this.win);
  }
  nodes() { return preorder(this.win); }
  resetLog() { this.draws = []; this.posts = []; }
  canFocus(n) { return (n.flags & 7) === 1; }
  draw(n) { this.draws.push(n); }
  /** K_SETFOCUS: the same view: nothing; cannot take focus: nothing; else blur (drawn without the focus look) the old, focus the new (drawn). */
  setFocus(n) {
    if (n === this.focus) return;
    if (n && !this.canFocus(n)) return;
    if (this.focus) this.draw(this.focus);
    this.focus = n;
    if (n) this.draw(n);
  }
  focusNext() {
    const list = this.nodes().filter((n) => this.canFocus(n));
    if (!list.length) return;
    const i = this.focus ? list.indexOf(this.focus) : -1;
    this.setFocus(list[(i + 1) % list.length]);
  }
  focusPrev() {
    const list = this.nodes().filter((n) => this.canFocus(n));
    if (!list.length) return;
    const i = this.focus ? list.indexOf(this.focus) : list.length;
    this.setFocus(list[(i - 1 + list.length) % list.length]);
  }
  /** The activation of the window at W_OPEN: no focus, then the first view that can take one. */
  activate() { this.focus = null; this.focusNext(); this.resetLog(); }
  post(n) { this.posts.push({ id: n.id, slot: this.win.slot }); }
  activateCheck(c) {
    if (c.flags & FL.RADIO) {
      for (const s of c.parent.kids) if (s !== c && s.kind === 'Check' && (s.flags & FL.RADIO) && (s.flags & FL.CHECKED)) { s.flags &= ~FL.CHECKED; this.draw(s); }
      c.flags |= FL.CHECKED;
    } else c.flags ^= FL.CHECKED;
    this.draw(c); this.post(c);
  }
  /** M_EVENT of a node: returns consumed. */
  nodeEvent(n, ev) {
    if (n.kind === 'Group' || n.kind === 'Window') return this.groupEvent(n, ev);
    if (n.kind === 'Check') {
      if (ev.t === E.DOWN) { n.flags |= FL.PRESSED; this.draw(n); return true; }
      if (ev.t === E.MOVE) {
        if (this.capture !== n) return false;
        const inside = inRect(n, ev.px, ev.py);
        if (inside !== ((n.flags & FL.PRESSED) !== 0)) { n.flags = inside ? n.flags | FL.PRESSED : n.flags & ~FL.PRESSED; this.draw(n); }
        return true;
      }
      if (ev.t === E.UP) { if (n.flags & FL.PRESSED) { n.flags &= ~FL.PRESSED; this.activateCheck(n); } return true; }
      if (ev.t === E.KEY) { if (ev.key === KEYC.SPACE) { this.activateCheck(n); return true; } return false; }
      return false;
    }
    return false;                                   // Label (View's default event), VScroll (not driven here)
  }
  groupEvent(g, ev) {
    if (ev.t !== E.MOVE && ev.t !== E.DOWN && ev.t !== E.UP) return false;
    let target = null;
    for (const k of g.kids) { if (k.flags & 6) continue; if (inRect(k, ev.px, ev.py)) { target = k; break; } }
    if (!target) return false;
    if (ev.t === E.DOWN && (target.flags & 1)) this.setFocus(target);
    const c = this.nodeEvent(target, ev);
    if (c && ev.t === E.DOWN && this.capture === null) this.capture = target;
    return c;
  }
  /** K_DISPATCH of a pointer or key event: { t, px, py } or { t: E.KEY, key }.  Returns nothing (K_DISPATCH has no result). */
  dispatch(ev) {
    if (ev.t === E.DOWN) { this.capture = null; this.groupEvent(this.rootGroup(), ev); return; }
    if (ev.t === E.MOVE) { if (this.capture) this.nodeEvent(this.capture, ev); else this.groupEvent(this.rootGroup(), ev); return; }
    if (ev.t === E.UP) {
      if (this.capture) { const v = this.capture; this.capture = null; this.nodeEvent(v, ev); } else this.groupEvent(this.rootGroup(), ev);
      return;
    }
    if (ev.t === E.KEY) {
      let v = this.focus;
      while (v && v.kind !== 'Window') { if (this.nodeEvent(v, ev)) return; v = v.parent; }
      // the window's and the desk's M_EVENT take no key: the kernel's defaults
      if ([KEYC.TAB, KEYC.DOWN, KEYC.RIGHT].includes(ev.key)) this.focusNext();
      else if ([KEYC.BACKTAB, KEYC.UP, KEYC.LEFT].includes(ev.key)) this.focusPrev();
    }
  }
  /** The desk's group (the bar is above row 8 and the points are below): its only child is the window. */
  rootGroup() { return { kids: [this.win], kind: 'Group' }; }
}

/** The window's pixels as W_UPDATE leaves them: the window look (active), then every child in list order; the focus underline on this.focus. */
export function renderWindow(tree, g = new Gfx6Model()) {
  const w = tree.win;
  windowLook(g, { x: w.x, y: w.y, w: w.w, h: w.h, title: { codes: w.title } }, true);
  const drawNode = (n) => {
    if (n.flags & 2) return;
    switch (n.kind) {
      case 'Check': checkLook(g, n, tree.focus === n); break;
      case 'Label': labelLook(g, { x: n.x, y: n.y, w: n.w, h: n.h, flags: n.flags, text: { codes: n.codes } }); break;
      case 'VScroll': vsLook(g, n, n.press || 0); break;
      case 'Group': for (const k of n.kids) drawNode(k); break;
      default: throw new Error(`renderWindow: ${n.kind}`);
    }
  };
  for (const k of w.kids) drawNode(k);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  let bad = 0;
  const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`); };
  // geometry: h = 80, max 20, page 5, value 10: tl = 60, th = floor(60 * 5 / 25) = 12, ty = y + 10 + floor(48 * 10 / 20) = y + 34
  eq('geom 12x80', vsGeom({ x: 0, y: 0, w: 12, h: 80, value: 10, max: 20, page: 5 }), { tl: 60, thumb: true, th: 12, ty: 34 });
  eq('geom th floor of 6', vsGeom({ x: 0, y: 0, w: 12, h: 32, value: 0, max: 255, page: 0 }).th, 6);
  eq('geom no thumb', vsGeom({ x: 0, y: 5, w: 12, h: 40, value: 0, max: 0, page: 9 }).thumb, false);
  // thumb drag rounding: tl - th = 48, max 20: py - grab -> ty' - 10; value = round(d * 20 / 48), halves up: d = 12 -> 5.0; d = 17 -> 7.08 -> 7; d = 6 -> 2.5 -> 3
  {
    const v = { x: 0, y: 0, w: 12, h: 80, value: 0, max: 20, page: 5, id: 1 }, t = new VsTrack(v, 'tell');
    t.down(5, 10 + 3, 100);                       // the thumb at ty = 10 (value 0): grab = 3
    t.frame(101, [{ t: 'move', px: 5, py: 13 + 6 }]); eq('drag d = 6 -> 3 (half up)', v.value, 3);
    t.frame(102, [{ t: 'move', px: 5, py: 13 + 12 }]); eq('drag d = 12 -> 5', v.value, 5);
    t.frame(103, [{ t: 'move', px: 5, py: 500 }]); eq('drag far below clamps to max', v.value, 20);
    t.frame(104, [{ t: 'move', px: 5, py: -5 }]); eq('drag far above clamps to 0', v.value, 0);
  }
  // arrow hold: step at once, again at 15, then every 6
  {
    const v2 = { x: 0, y: 0, w: 12, h: 80, value: 0, max: 255, page: 5, id: 1 }, t2 = new VsTrack(v2, 'tell');
    t2.down(5, 75, 1000);
    for (let f = 1; f <= 30; f++) t2.frame(1000 + f, []);
    eq('down arrow tells at vf offsets', t2.tells.map((x) => x.vf - 1000), [0, 15, 21, 27]);
  }
  // radio rule
  {
    const mk = (id, flags) => ({ kind: 'Check', id, x: 0, y: 0, w: 40, h: 9, flags, codes: [65] });
    const a = mk(1, 1 | FL.RADIO | FL.CHECKED), b = mk(2, 1 | FL.RADIO), c = mk(3, 1);
    const tr = new TkTree({ x: 0, y: 8, w: 100, h: 100, slot: 1, title: [65] }, [a, b, c]);
    tr.activateCheck(b);
    eq('radio: b checked, a cleared, c untouched', [a.flags & 8, b.flags & 8, c.flags & 8], [0, 8, 0]);
    eq('radio draws: a then b, one post', [tr.draws.map((n) => n.id), tr.posts], [[1, 2], [{ id: 2, slot: 1 }]]);
  }
  console.log(bad ? `tk-model self-test: ${bad} FAILED` : 'tk-model self-test: all ok');
  if (bad) process.exitCode = 1;
}
