"use strict";
// tk-lib2.mjs -- shared pieces of the T2 / T3 tests (tests/tk-t2.mjs List, tests/tk-t3.mjs Field): the group collector, the generators, and the step checker that compares the machine
// with tk-model2's TkTree2 after every event (W_DRAWVIEW calls, E_CMD posts, the state of every control, the focus, the capture, the window's pixels, the pixels outside it).
// Written from docs/TOOLKIT.md (1-10) only; src/kernel/tk.asm and tk2.asm were never read.
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import { coverage } from './wm-lib.mjs';

export const { L, hex, rd16 } = T;
export const FF = 0xFF;
export const codesOf = T.codesOf;
export const show = (codes) => JSON.stringify(String.fromCharCode(...codes));

/** The group collector: `const { Sec, finish } = makeGroups('tk-t2', VERBOSE)`; finish() prints "N of M groups pass" and the check totals. */
export function makeGroups(title, verbose) {
  const C = checks(title), groups = [];
  class Sec {
    constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.notes = []; }
    ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (verbose ? 40 : 5)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
    note(s) { if (!this.notes.includes(s) && this.notes.length < 6) this.notes.push(s); }
    end(extra = '') {
      groups.push(this.nf === 0);
      C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : '');
      for (const s of this.notes) console.log(`  note: ${s}`);
    }
  }
  const finish = () => { C.done(); console.log(`${title}: ${groups.filter(Boolean).length} of ${groups.length} groups pass`); };
  return { C, Sec, finish, groups };
}

export const totals = { di: 0, badPreserved: 0, badSp: 0, maxStack: 0 };
export function noteRun(sec, r, what) {
  totals.di += r.di; if (r.preserved.length) totals.badPreserved++; if (r.badSp !== undefined) totals.badSp++;
  sec.ok(r.di === 0, () => `${what}: a DI was executed (${r.di})`);
  sec.ok(r.preserved.length === 0, () => `${what}: registers not preserved: ${r.preserved.join(',')}`);
  sec.ok(r.badSp === undefined, () => `${what}: SP ${hex(r.badSp)} after the return, want ${hex(0xFF00)}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Generators
export const STD_ITEMS = ['Accounts', 'Address book', 'Budget 1987', 'Calendar', 'Chess', 'Diary', 'Drawing 1', 'Drawing 2', 'Font editor', 'Games', 'Letter to Ann', 'Loader', 'Music', 'Notes', 'Phone list',
  'Poems', 'Recipes', 'Shopping', 'Sprites', 'Stock list', 'To do', 'Travel', 'Utilities', 'Zebra'].map(codesOf);
const WORDS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export function genText(rng, lo, hi) {
  const n = rng.int(lo, hi), o = [];
  for (let i = 0; i < n; i++) o.push(rng.chance(0.75) ? rng.pick(codesOf(WORDS)) : rng.chance(0.15) ? 32 : rng.int(33, 126));
  return o;
}
export function genItems(rng, count) {
  if (count === 24 && rng.chance(0.3)) return STD_ITEMS.map((c) => c.slice());
  const o = [];
  for (let i = 0; i < count; i++) o.push(rng.chance(0.06) ? [] : genText(rng, 1, rng.chance(0.3) ? 24 : 12));
  return o;
}
/** A List node for the trees: a legal state (top <= max(0, count - n), sel $FF or < count). */
export function mkList(rng, id, rect, flags, count, o = {}) {
  const l = { kind: 'List', id, x: rect[0], y: rect[1], w: rect[2], h: rect[3], flags, items: o.items || genItems(rng, count), count, sel: FF, top: 0, bar: null };
  const n = M2.listN(l);
  l.top = rng.chance(0.5) ? 0 : rng.int(0, Math.max(0, count - n));
  l.sel = count === 0 || rng.chance(0.3) ? FF : rng.int(0, count - 1);
  return l;
}
export function mkField(rng, id, rect, flags, cap, o = {}) {
  const buf = o.buf || genText(rng, 0, Math.min(cap, rng.chance(0.5) ? 8 : cap));
  const f = { kind: 'Field', id, x: rect[0], y: rect[1], w: rect[2], h: rect[3], flags, buf, cap, caret: buf.length, first: 0 };
  f.caret = rng.chance(0.4) ? buf.length : rng.int(0, buf.length);
  M2.fieldAdjust(f);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The step checker
/** Compare the multiset of W_DRAWVIEW calls with the model's draws (optional draws may be absent, R2); null when equal. */
export function drawDiff(tree, r) {
  const cnt = (list) => { const mp = new Map(); for (const n of list) mp.set(n, (mp.get(n) || 0) + 1); return mp; };
  const got = new Map(), bad = [];
  for (const a of r.draws) { const n = T.nodeAt(tree, a); if (!n) return `W_DRAWVIEW of ${hex(a)}, which is no control of the window`; got.set(n, (got.get(n) || 0) + 1); }
  const want = cnt(tree.draws), opt = cnt(tree.optDraws);
  for (const n of new Set([...got.keys(), ...want.keys()])) {
    const g = got.get(n) || 0, w = want.get(n) || 0, lo = w - (opt.get(n) || 0);
    if (g < lo || g > w) bad.push(`${n.kind} id ${n.id}: ${g} draw(s), model ${lo === w ? w : lo + ' to ' + w}`);
  }
  return bad.length ? `W_DRAWVIEW calls differ: ${bad.join('; ')}` : null;
}
const strAt = (m, a) => Array.from(m.ram.subarray(a + 1, a + 1 + m.ram[a]));
/** Compare the state in RAM of every control with the model's; first difference as text, or null. */
export function stateDiff(env, tree) {
  const { m, S } = env;
  for (const n of tree.nodes()) {
    const a = n.addr;
    switch (n.kind) {
      case 'Check': if (m.ram[a + S.View_flags] !== n.flags) return `Check id ${n.id}: flags ${hex(m.ram[a + S.View_flags], 2)}, model ${hex(n.flags, 2)}`; break;
      case 'VScroll': {
        const got = [m.ram[a + S.VScroll_value], m.ram[a + S.VScroll_max], m.ram[a + S.VScroll_page]];
        if (got.join() !== [n.value, n.max, n.page].join()) return `VScroll id ${n.id}: value / max / page ${got}, model ${[n.value, n.max, n.page]}`;
        break;
      }
      case 'List': {
        const got = [m.ram[a + S.List_count], m.ram[a + S.List_sel], m.ram[a + S.List_top]];
        if (got.join() !== [n.count, n.sel, n.top].join()) return `List id ${n.id}: count / sel / top ${got}, model ${[n.count, n.sel, n.top]}`;
        const arr = rd16(m, a + S.List_items);
        for (let i = 0; i < n.count; i++) {
          const g = strAt(m, rd16(m, arr + 2 * i)).join(), w = n.items[i].join();
          if (g !== w) return `List id ${n.id}: item ${i} is ${show(strAt(m, rd16(m, arr + 2 * i)))}, model ${show(n.items[i])}`;
        }
        break;
      }
      case 'Field': {
        const b = rd16(m, a + S.Field_buf), got = strAt(m, b);
        if (got.join() !== n.buf.join()) return `Field id ${n.id}: text ${show(got)}, model ${show(n.buf)}`;
        const st = [m.ram[a + S.Field_cap], m.ram[a + S.Field_caret], m.ram[a + S.Field_first]];
        if (st.join() !== [n.cap, n.caret, n.first].join()) return `Field id ${n.id} ${show(n.buf)}: cap / caret / first ${st}, model ${[n.cap, n.caret, n.first]}`;
        break;
      }
      default: break;
    }
  }
  return null;
}
/**
 * After a step: the run's own checks (DI, registers, SP), the draws, the posts, the state of every control, K_FOCUS and K_CAPTURE, the window's pixels against the model's rendering of the tree,
 * and the pixels outside the window unchanged.  o: { noDraws, noPosts, noScreen }.  Returns true when everything matched.
 */
export function afterStep(env, tree, sec, r, ctx, before, o = {}) {
  const { m, S } = env, win = tree.win, nf0 = sec.nf;
  noteRun(sec, r, ctx);
  totals.maxStack = Math.max(totals.maxStack, r.stack);
  if (!o.noDraws) { const d = drawDiff(tree, r); sec.ok(d === null, () => `${ctx}: ${d}`); }
  if (!o.noPosts) {
    const gotP = r.posts.map((p) => [p.a, p.c, p.e, p.d].join()), wantP = tree.posts.map((p) => [M.E.CMD, p.id, p.slot, 0].join());
    sec.ok(gotP.join('|') === wantP.join('|'), () => `${ctx}: K_POST ${gotP.join(' | ') || 'none'}, model E_CMD ${wantP.join(' | ') || 'none'} (A, C = id, E = slot, D)`);
  }
  const sd = stateDiff(env, tree);
  sec.ok(sd === null, () => `${ctx}: ${sd}`);
  const f = rd16(m, S.K_FOCUS), cp = rd16(m, S.K_CAPTURE);
  sec.ok(f === (tree.focus ? tree.focus.addr : 0), () => `${ctx}: K_FOCUS ${hex(f)}, model ${tree.focus ? hex(tree.focus.addr) + ' (' + tree.focus.kind + ' id ' + tree.focus.id + ')' : 0}`);
  sec.ok(cp === (tree.capture ? tree.capture.addr : 0), () => `${ctx}: K_CAPTURE ${hex(cp)}, model ${tree.capture ? hex(tree.capture.addr) : 0}`);
  if (!o.noScreen) {
    const after = T.readDisp(m), g = M.renderWindow(tree);
    const d1 = T.diffRect(env, g, win.x, win.y, win.w, win.h), d2 = T.diffOutside(before, after, win.x, win.y, win.w, win.h);
    sec.ok(d1 === null, () => `${ctx}: window pixels: ${d1}`);
    sec.ok(d2 === null, () => `${ctx}: pixels outside the window changed: ${d2}`);
  }
  // a List that was only drawn line by line (10.3 "Draw (one line)"): nothing inside it changed but the bands of those lines
  for (const [l, items] of tree.lineBands) {
    if (o.noScreen || tree.fullSet.has(l)) continue;
    const geo = M2.listGeom(l), cov = T.rectCov(l.x, l.y, l.w, l.h), mask = new Uint8Array(cov.length);
    const bands = [...items].filter((i) => i >= l.top && i < l.top + geo.n).map((i) => { const k = i - l.top; return [l.x + 1, l.x + l.w - 1, geo.LY0 + geo.P * k, geo.LY0 + geo.P * k + geo.P]; });
    const bc = L_cov(bands);
    for (let i = 0; i < mask.length; i++) mask[i] = cov[i] & (0xFF ^ bc[i]);
    const d = T.diffDisp(before, T.readDisp(m), mask);
    sec.ok(d === null, () => `${ctx}: List id ${l.id} was drawn line by line (items ${[...items]}) but pixels outside those lines changed: ${d}`);
  }
  return sec.nf === nf0;
}
const L_cov = (rects) => coverage(rects);
export const describeEv = (ev) => (ev.t === M.E.KEY ? `key ${ev.key}` : ev.t === M.E.SCROLL ? `E_SCROLL ${ev.val}` : `${['', '', 'MOVE', 'DOWN', 'UP'][ev.t]} (${ev.px}, ${ev.py})${ev.vf !== undefined ? ' vf ' + ev.vf : ''}${ev.dbl ? ' DOUBLE' : ''}`);
/** One event through K_DISPATCH, then afterStep.  ev: { t, px, py, vf? } | { t: E.KEY, key }.  Returns the run, or null when the call failed. */
export function feedEv(env, tree, sec, ev, ctx, o = {}) {
  const { S } = env;
  const before = T.readDisp(env.m);
  T.drainEvents(env);
  if (ev.t === M.E.DOWN && ev.dbl === undefined) ev.dbl = ev.vf !== undefined && tree.kd ? tree.kd.press(ev.vf, ev.px, ev.py) : false;      // the kernel's double-click flag (WRITE 14.9): decided by its rule from the test's frame number
  T.setEv(env, ev.t === M.E.KEY ? [M.E.KEY, ev.key, 0, 0] : T.ptRec(ev.t, ev.px, ev.py, ev.t !== M.E.UP, ev.t === M.E.DOWN && ev.dbl));
  if (ev.vf !== undefined) { T.setVframes(env, ev.vf & 0xFFFF); tree.vf = ev.vf & 0xFFFF; }
  tree.resetLog();
  let r;
  try { r = T.runCall(env, S.K_DISPATCH, {}, o.run || {}); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return null; }
  tree.dispatch(ev);
  afterStep(env, tree, sec, r, ctx, before, o);
  return r;
}
/** Build a TkTree2's window in the machine, activate it as W_OPEN does and check the first screen; returns false when it failed. */
export function openTree(env, tree, sec, ctx) {
  const { m, S } = env;
  try { T.buildTree(env, tree); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return false; }
  tree.activate();
  const actual = rd16(m, S.K_FOCUS);
  sec.ok(actual === (tree.focus ? tree.focus.addr : 0), () => `${ctx}: after W_OPEN K_FOCUS ${hex(actual)}, the first focusable control is ${tree.focus ? hex(tree.focus.addr) + ' (' + tree.focus.kind + ' id ' + tree.focus.id + ')' : 'none'}`);
  tree.focus = tree.nodes().find((n) => n.addr === actual) || null;
  const w = tree.win, d0 = T.diffRect(env, M.renderWindow(tree), w.x, w.y, w.w, w.h);
  sec.ok(d0 === null, () => `${ctx}: window after W_OPEN + W_UPDATE: ${d0}`);
  return true;
}
export const rectOf = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
export const pointIn = (rng, n) => [rng.int(n.x, n.x + n.w - 1), rng.int(n.y, n.y + n.h - 1)];
export const overlap = (n, x, y) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h;
/** A random window position on the 16 x 8 grid for a window of w x h. */
export function winPos(rng, w, h) { return [16 * rng.int(0, (512 - w) / 16), 8 * rng.int(1, (192 - h) / 8)]; }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Direct sends: M_EVENT with DE -> a record that is not K_EV (10.1: a List reads every event through DE), M_DRAW under a chosen clip.
export const SCR_REC = 0x5E60;
export const stk = { draw: 0, event: 0, drawWhat: '', eventWhat: '' };
/** M_EVENT to `node` by T_SEND with the record at SCR_REC (K_EV holds garbage); compares the carry with the model's "consumed"; then afterStep.  ev as feedEv, or { t: E.SCROLL, val, barId }.  o.kevSame: K_EV holds the record too (for a Field, whose contract does not say it reads through DE; a List must). */
export function sendDirect(env, tree, sec, ctx, node, ev, o = {}) {
  const { m, S } = env;
  const rec = ev.t === M.E.KEY ? [M.E.KEY, ev.key, 0, 0] : ev.t === M.E.SCROLL ? [M.E.SCROLL, ev.val, ev.barId || 0, 0] : [ev.t, 0, 0, 0];
  if (ev.t === M.E.DOWN && ev.dbl === undefined) ev.dbl = ev.vf !== undefined && tree.kd ? tree.kd.press(ev.vf, ev.px, ev.py) : false;      // the kernel's double-click flag (WRITE 14.9): decided by its rule from the test's frame number
  if (ev.t === M.E.DOWN || ev.t === M.E.MOVE || ev.t === M.E.UP) { const p = T.ptRec(ev.t, ev.px, ev.py, ev.t !== M.E.UP, ev.t === M.E.DOWN && (o.deDbl !== undefined ? o.deDbl : ev.dbl)); for (let i = 0; i < 4; i++) rec[i] = p[i]; }      // o.deDbl: the flag of the record DE points to, when a test makes it differ from K_EV's (WRITE 14.9 item 9: the flag is read from K_EV + 3)
  T.setEv(env, process.env.KEVSAME || o.kevSame ? rec : (o.garb || [0xA5, 0x5A, 0x33, 0x73]));   // KEVSAME=1 (diagnostic): K_EV holds the record too, to tell a List that reads K_EV from one that reads DE
  for (let i = 0; i < 4; i++) m.ram[SCR_REC + i] = rec[i];
  if (ev.vf !== undefined) { T.setVframes(env, ev.vf & 0xFFFF); tree.vf = ev.vf & 0xFFFF; }
  const before = T.readDisp(m);
  tree.resetLog();
  const consumed = tree.nodeEvent(node, ev);
  let r;
  try { r = T.runCall(env, S.T_SEND, { ix: node.addr, a: S.M_EVENT, de: SCR_REC }, o.run || {}); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return null; }
  sec.ok(!!r.carry === !!consumed, () => `${ctx}: ${node.kind} id ${node.id} M_EVENT ${describeEv(ev)}: carry (consumed) ${r.carry}, model ${consumed ? 1 : 0}`);
  const used = r.stack - 2;                             // T_SEND's own RST return is not the callee's
  if (used > stk.event) { stk.event = used; stk.eventWhat = `${node.kind} ${describeEv(ev)}`; }
  afterStep(env, tree, sec, r, ctx, before, o);
  return r;
}
/** M_DRAW of `node` by T_SEND with GCLIP poked to the clip rectangle [x, y, w, h]; the whole display against the model (the screen before, the draw clipped); GCLIP back as it was. */
export function drawUnderClip(env, sec, ctx, node, look, clip, o = {}) {
  const { m, S } = env;
  const g = M.Gfx6Model.fromRam(m.ram); g.setClip(clip[0], clip[1], clip[2], clip[3]);
  const c = [g.clip.x0, g.clip.x1, g.clip.y0, g.clip.y1];
  c.forEach((v, i) => T.poke16(env, S.GCLIP + 2 * i, v));
  look(g);
  let r;
  try { r = T.runCall(env, S.T_SEND, { ix: node.addr, a: S.M_DRAW, de: 0 }, { ints: false }); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return null; }
  const got = [0, 1, 2, 3].map((i) => rd16(m, S.GCLIP + 2 * i));
  sec.ok(got.join() === c.join(), () => `${ctx}: GCLIP after M_DRAW ${got}, the caller's clip was ${c} (10.2: put back)`);
  const d = T.diffRect(env, g, 0, 0, 512, 192);
  sec.ok(d === null, () => `${ctx}: screen under clip ${c}: ${d}`);
  noteRun(sec, r, ctx);
  const used = r.stack - 2;
  if (used > stk.draw) { stk.draw = used; stk.drawWhat = `${node.kind} clip ${c}`; }
  T.poke16(env, S.GCLIP, 0); T.poke16(env, S.GCLIP + 2, 512); T.poke16(env, S.GCLIP + 4, 0); T.poke16(env, S.GCLIP + 6, 192);
  return r;
}

