"use strict";
// wr-lib.mjs -- shared harness of the Write W1 tests (tests/wr-w1.mjs, tests/wr-demo.mjs, tests/wr-perf.mjs).  Written from docs/WRITE.md (1-11), docs/TOOLKIT.md 9.3 / 10.4 and docs/SHELL.md 10
// only; src/apps/write.asm, src/apps/shell.asm and src/kernel/*.asm were never read.  It never builds: it loads the prebuilt build/desk5.dck and build/desk5/out.sym through tests/calc-lib.mjs.
//   - bootWrite: desk5 booted into the shell, Write launched by the double click on its icon (SHELL 4), the pointer parked in the bottom-right corner;
//   - readState / stateDiff: the document (gap buffer WR_BUF / WR_GS / WR_GE), the line table (WR_LT, WR_NL), WR_TOP, WR_CHG, the bar, K_FOCUS, read back and compared with a wr-model Doc;
//   - loadDoc: a document TYPED into a fresh machine through K_DISPATCH (poking the buffer corrupts the cartridge's own state), snapshots to repeat it;
//   - the screen: liveDiff (the window's rectangle or the whole screen against wr-model's renderScreen, reading K_FOCUS and the dialog from the machine);
//   - Drv: one step at a time through K_DISPATCH (keys, a click = E_DOWN + E_UP), E_SCROLL by M_EVENT, bar clicks through the real VScroll tracking loop, with every check of 8 items 1-4;
//   - covering plain windows, M_EVENT / M_DRAW sent directly (T_SEND), the symbols (WR_*) the tests need.
// CONTRACT? the symbols WR_WIN, WR_TV, WR_BAR, WR_DLG, WR_BUF, WR_LT are read as VARIABLES holding the object's / buffer's address (as S_WIN and D_WIN are in the shell and Calculator suites);
// WR_GS, WR_GE, WR_NL, WR_TOP are word variables, WR_CHG a byte variable (11.7).
// W2 (docs/WRITE.md 12; the section at the end of this file, additive): WR2_NEEDED / needWr2, readState2 / stateDiff2 (WR_AN, WR_MK, WR_CLN and the clipboard at $7800), menuBits (the kernel's menu
// entry, WINDOWS 8 / 18: MB_ENT + ME_SIZE x menu index + ME_EN, bit n - 1 - k for item k), menuCall (WR_MENU called under mapping A with K_EV holding the E_MENU record), Drv2 (Drv plus MARK,
// drags, the Edit menu's items, and the checks of WRITE 12.9 items 2-4 after every step), editMenu / typeMark / menuKeys (real frames).
// CONTRACT? WR_MENU is code in DOCK 2-3 (12.6: "the Edit menu's handler" is under DOCK 2-3), so it is called under mapping A; WR_AN is a word variable, WR_MK and WR_CLN as 12.7 says (byte, word).
import * as L from './calc-lib.mjs';
import * as T from './tk-lib.mjs';
import * as X from './tk-lib2.mjs';
import * as WM from './wr-model.mjs';
import * as M from './tk-model.mjs';
import { readDisp, diffDisp } from './wm-lib.mjs';
import { snapshot, restore } from './review-lib.mjs';

export { L, T, X, WM, readDisp, diffDisp };
export const { hex, rd16 } = L;
export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, MENU: 7, CMD: 10, SCROLL: 11 };
export const WR_NEEDED = ['WR_START', 'WR_END', 'WR_IMG', 'WR_IMG_LEN', 'WR_WIN', 'WR_TV', 'WR_BAR', 'WR_DLG', 'CL_TextView', 'WR_BUF', 'WR_GS', 'WR_GE', 'WR_LT', 'WR_NL', 'WR_TOP', 'WR_CHG',
  'K_DISPATCH', 'TK_DISPATCH', 'K_EV', 'K_FOCUS', 'K_CAPTURE', 'K_SETFOCUS', 'K_POST', 'K_PN', 'K_PHEAD', 'K_POSTQ', 'K_RING', 'K_RHEAD', 'K_RTAIL', 'T_SEND', 'T_RET', 'M_EVENT', 'M_DRAW', 'W_DRAWVIEW',
  'W_OPEN', 'W_CLOSE', 'W_UPDATE', 'K_NEW', 'CL_Window', 'TK_SETBAR', 'VScroll_value', 'VScroll_max', 'VScroll_page', 'W_MODAL', 'CL_Dialog', 'Dialog_default', 'Dialog_cancel', 'V_FRAMES', 'GCLIP',
  'VScroll_target', 'Window_title', 'K_AARENA', 'TK_EV'];
export function needWr(S) { const miss = WR_NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); }

/** desk5 booted into the shell, Write (program 3) launched through the shell; the pointer parked at (511, 191); the memory watch of BANKING 10.7 on. */
export function bootWrite(opts = {}) {
  const env = L.bootDesk5({ ...opts, prog: 3 });
  needWr(env.S);
  env.rng = opts.rng || null;
  L.moveTo(env, 511, 191); env.frames_(4);
  return env;
}
/** For the direct calls (runCall steps K_DISPATCH, T_SEND, ... with a sentinel return): the CPU is parked, no frame is run any more on this machine. */
export function parkDirect(env) { L.park(env); env.strp = T.STR0; env.snap0 = snapshot(env.m); env.cache = {}; return env; }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// State
export const objs = (env) => ({ win: rd16(env.m, env.S.WR_WIN), tv: rd16(env.m, env.S.WR_TV), bar: rd16(env.m, env.S.WR_BAR), dlg: rd16(env.m, env.S.WR_DLG) });
/** Everything 11.7 names, read back: the text (buffer [0, GS) then [GE, 5120)), the caret (= GS), the line table's first NL bytes, TOP, CHG, the bar's fields, K_FOCUS, K_CAPTURE. */
export function readState(env) {
  const { m, S } = env, o = objs(env);
  const buf = rd16(m, S.WR_BUF), gs = rd16(m, S.WR_GS), ge = rd16(m, S.WR_GE), nl = rd16(m, S.WR_NL), lt = rd16(m, S.WR_LT);
  const okGap = gs <= ge && ge <= WM.CAP;
  const codes = okGap ? [...m.ram.subarray(buf, buf + gs), ...m.ram.subarray(buf + ge, buf + WM.CAP)] : [];
  return { buf, gs, ge, okGap, codes, caret: gs, nl, lt, lens: Array.from(m.ram.subarray(lt, lt + Math.min(nl, 2000))), top: rd16(m, S.WR_TOP), chg: m.ram[S.WR_CHG], ...o,
    bar: o.bar ? { value: m.ram[o.bar + S.VScroll_value], max: m.ram[o.bar + S.VScroll_max], page: m.ram[o.bar + S.VScroll_page], target: rd16(m, o.bar + S.VScroll_target) } : null,
    focus: rd16(m, S.K_FOCUS), capture: rd16(m, S.K_CAPTURE) };
}
const firstDiff = (a, b) => { const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return -1; };
/** The differences between the machine's document state and a Doc, split by what they belong to: { doc: [...], lt: [...], bar: [...] }. */
export function stateDiff(env, doc) {
  const st = readState(env), out = { doc: [], lt: [], bar: [] };
  if (!st.okGap) { out.doc.push(`the gap is not valid: WR_GS ${st.gs}, WR_GE ${st.ge}`); return out; }
  const w = doc.codes, i = firstDiff(st.codes, w);
  if (i >= 0) out.doc.push(`the text differs at offset ${i} (machine length ${st.codes.length}, model ${w.length}): machine ${JSON.stringify(WM.textOf(st.codes.slice(Math.max(0, i - 6), i + 10)))}, model ${JSON.stringify(WM.textOf(w.slice(Math.max(0, i - 6), i + 10)))}`);
  if (st.caret !== doc.caret) out.doc.push(`the caret (WR_GS) ${st.caret}, model ${doc.caret}`);
  if (st.top !== doc.top) out.doc.push(`WR_TOP ${st.top}, model ${doc.top}`);
  if ((st.chg !== 0) !== doc.changed) out.doc.push(`WR_CHG ${st.chg}, model changed ${doc.changed}`);
  if (st.nl !== doc.nl) out.lt.push(`WR_NL ${st.nl}, model ${doc.nl}`);
  const j = firstDiff(st.lens.slice(0, doc.nl), doc.lens);
  if (st.nl === doc.nl && j >= 0) out.lt.push(`line table byte ${j} is ${st.lens[j]}, model ${doc.lens[j]} (line ${j}: model ${JSON.stringify(WM.textOf(doc.lineText(j)).slice(0, 40))})`);
  if (!st.bar) out.bar.push('WR_BAR is 0'); else {
    const b = doc.bar();
    // the bar's own value is what its tracking left (an E_SCROLL does not make the text view set it again): with k > 1 and M not a multiple of k that can be ceil(top / k), not floor
    const lo = Math.min(Math.floor(doc.top / doc.k), b.max), hi = Math.min(Math.ceil(doc.top / doc.k), b.max);
    if (st.bar.value < lo || st.bar.value > hi || st.bar.max !== b.max || st.bar.page !== b.page) out.bar.push(`the bar's value / max / page ${st.bar.value} / ${st.bar.max} / ${st.bar.page}, model ${b.value} / ${b.max} / ${b.page} (lines ${doc.nl}, top ${doc.top}, k ${doc.k})`);
    if (st.bar.target !== st.tv) out.bar.push(`the bar's target ${hex(st.bar.target)}, the text view is ${hex(st.tv)}`);
  }
  if (st.focus !== st.tv) out.doc.push(`K_FOCUS ${hex(st.focus)}, the text view is ${hex(st.tv)}`);
  return out;
}
/** A readable summary of a doc for a failure message. */
export const describe = (d) => `L ${d.L}, ${d.nl} lines, caret ${d.caret} (line ${d.caretLine()}), top ${d.top}, run ${d.run}, changed ${d.changed}`;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Setting up a document.  NOT by poking the buffer: the cartridge keeps state of its own beside WR_GS / WR_GE (a poked gap made its next RIGHT write a byte at the old gap), so a document is TYPED
// through K_DISPATCH (then the caret moved with LEFT, the top set by an E_SCROLL), from the machine's fresh state (a snapshot taken by parkDirect).
/** Back to the fresh state of the parked machine (an empty document, nothing changed). */
export function resetDoc(env) { restore(env.m, env.snap0); env.strp = T.STR0; }
/** Type `target` (a Doc: codes, caret, top, changed) into the fresh machine; returns the model Doc that follows the machine (top may differ from the target's: E_SCROLL's granularity). */
export function buildDoc(env, target) {
  const { S } = env, o = objs(env), model = new WM.Doc(), run = { allowHalt: true };
  for (const c of target.codes) { dispatch(env, keyRec(c), run); model.key(c); }
  for (let i = target.L - target.caret; i > 0; i--) { dispatch(env, keyRec(8), run); model.key(8); }
  if (target.top !== null && target.top !== model.top) {
    const v = Math.floor(target.top / model.k), go = (w) => { emulateBar(env, w); sendRec(env, o.tv, [E.SCROLL, w, 2, 0], run); model.scrollTo(w); };
    // a scroll by exactly 15 lines loses the one surviving line in the cartridge (found by wr-w1 group 4): the set-up goes round it by one line first, so that group 1-3 are not spoilt by it
    if (model.k === 1 && Math.abs(Math.min(v, model.M) - model.top) === 15) go(model.top + (v > model.top ? 1 : -1));
    go(v);
  }
  model.changed = !!target.changed; T.poke8(env, S.WR_CHG, model.changed ? 1 : 0);       // WR_CHG is a documented byte
  return model;
}
/** resetDoc + buildDoc; with `key`, the typed machine is kept as a snapshot and later loads of the same key are instant (the returned model is a clone). */
export function loadDoc(env, target, key = null) {
  if (key && env.cache[key]) { restore(env.m, env.cache[key].snap); env.strp = T.STR0; return env.cache[key].model.clone(); }
  resetDoc(env);
  const model = buildDoc(env, target);
  if (key) env.cache[key] = { snap: snapshot(env.m), model: model.clone() };
  return model;
}
export const drawTv = (env) => T.runCall(env, env.S.W_DRAWVIEW, { ix: objs(env).tv }, { ints: false });
export function focusTv(env) { const { S } = env; T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: objs(env).tv }, { ints: false }); }
/** A random document with a legal state: the text, a caret, a top that shows the caret and is not beyond the last page (the contract does not settle that, R6). */
export function randomDoc(rng, nCodes, o = {}) {
  const d = new WM.Doc(WM.genText(rng, nCodes, o.gen || {}));
  d.caret = rng.chance(0.15) ? 0 : rng.chance(0.15) ? d.L : rng.int(0, d.L);
  const cl = d.caretLine(), lo = Math.max(0, cl - 15), hi = Math.min(cl, d.M);
  d.top = lo <= hi ? rng.int(lo, hi) : lo;
  if (rng.chance(0.3)) d.top = Math.min(d.M, cl);
  d.changed = rng.chance(0.5);
  return d;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Events, directly under K
export const keyRec = (code) => [E.KEY, code, 0, 0];
export const ptRec = T.ptRec;
/** K_DISPATCH of one event record (the ring is emptied first, K_EV holds the record). */
export function dispatch(env, rec, o = {}) { T.drainEvents(env); T.setEv(env, rec); return T.runCall(env, env.S.K_DISPATCH, {}, o); }
/** M_EVENT of `node` by T_SEND: the record in K_EV and DE -> K_EV, or for E_SCROLL the pool's TK_EV (where the bar's own record is).  The text view's M_EVENT runs under mapping A, where
 *  $5800-$7FFF is DOCK: a record at X.SCR_REC ($5E60) would be unreadable to it (BANKING rule 4: every pointer handed to K code is in RAM, and the converse for the callee). */
export function sendRec(env, node, rec, o = {}) {
  const { m, S } = env, at = rec[0] === E.SCROLL ? S.TK_EV : S.K_EV;
  T.setEv(env, rec); for (let i = 0; i < 4; i++) m.ram[at + i] = rec[i];
  return T.runCall(env, S.T_SEND, { ix: node, a: S.M_EVENT, de: at }, o);
}
export function sendDraw(env, node, o = { ints: false }) { return T.runCall(env, env.S.T_SEND, { ix: node, a: env.S.M_DRAW, de: 0 }, o); }

/** What the bar does before it tells the text view (E_SCROLL's sender): its own value becomes v (TK_SETBAR keeps max and page). */
export function emulateBar(env, v) {
  const { m, S } = env, b = objs(env).bar, max = m.ram[b + S.VScroll_max], page = m.ram[b + S.VScroll_page];
  T.runCall(env, S.TK_SETBAR, { ix: b, a: Math.min(v, max), c: max, b: page }, { ints: false });
}
// ---------------------------------------------------------------------------------------------------------------------------------------------
// Covering plain windows
/** A plain Window (not a CWindow) opened over Write: returns { addr, rect }; Write's text view gets the focus back by K_SETFOCUS (so keys still reach it); null when that is refused. */
export function openCover(env, rect, title) {
  const { S } = env;
  const win = T.kNew(env, S.CL_Window);
  T.setRect(env, win, rect.x, rect.y, rect.w, rect.h);
  T.poke16(env, win + S.Window_title, T.str(env, T.codesOf(title)));
  const r = T.runCall(env, S.W_OPEN, { ix: win }, { ints: false });
  if (r.carry) return null;
  T.runCall(env, S.W_UPDATE, {}, { ints: false });
  focusTv(env);
  return { addr: win, ...rect, title };
}
export function closeCover(env, cover) {
  const { S } = env;
  T.runCall(env, S.W_CLOSE, { ix: cover.addr }, { ints: false });
  T.runCall(env, S.W_UPDATE, {}, { ints: false });
  focusTv(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The screen
/** The machine's screen (the window's rectangle, or all of it with the pointer left out) against the model; null when equal.  The caret and the dialog's focus are read from K_FOCUS. */
export function liveDiff(env, doc, { covers = [], dialog = false, full = false, rect = WM.WINR } = {}) {
  const { m, S } = env, o = objs(env), foc = rd16(m, S.K_FOCUS);
  let dlg = null;
  if (dialog) {
    const d = rd16(m, S.WR_DLG), def = d ? rd16(m, d + S.Dialog_default) : 0, can = d ? rd16(m, d + S.Dialog_cancel) : 0;
    dlg = { focusBtn: foc && foc === def ? 1 : foc && foc === can ? 2 : 0 };
  }
  const g = WM.renderScreen(doc, { focus: foc === o.tv && !!o.tv, covers, dialog: dlg, barValue: o.bar ? m.ram[o.bar + S.VScroll_value] : null });
  const d = full ? diffDisp(readDisp(m), WM.toDisp(g), L.pointerMask(m, S)) : T.diffRect(env, g, rect.x, rect.y, rect.w, rect.h);
  return d === null ? null : `${d}; the differing bytes span x ${bbox(env, g, full).join(' ')}`;
}
/** The bounding box of the bytes that differ (x range in pixels, y range) between the machine and the model's pixels, as 'x0..x1, y0..y1' text parts. */
function bbox(env, g, full) {
  const a = readDisp(env.m), b = WM.toDisp(g), mask = L.pointerMask(env.m, env.S);
  let x0 = 999, x1 = -1, y0 = 999, y1 = -1, n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && (!full || mask[i])) { const y = i >> 6, x = (i & 63) * 8; x0 = Math.min(x0, x); x1 = Math.max(x1, x + 7); y0 = Math.min(y0, y); y1 = Math.max(y1, y); n++; }
  return [`${x0}..${x1},`, `y ${y0}..${y1}`, `(${n} bytes in all, whole screen)`];
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The step driver
/** The bar's tracking by the model (tk-model's VsTrack): the values told to the target (E_SCROLL) for a click script. */
export function barPlan(doc, part, py2, value = null) {
  const b = doc.bar(), v = { ...WM.BARR, value: value ?? b.value, max: b.max, page: b.page, id: 2 }, gm = M.vsGeom(v);
  const py = { up: WM.BARR.y + 3, down: WM.BARR.y + WM.BARR.h - 3, pgup: gm.ty - 2, pgdn: gm.ty + gm.th + 2, thumb: gm.ty + 2 }[part];
  if (part === 'pgup' || part === 'pgdn') { if (!gm.thumb) return null; if (part === 'pgup' && py < WM.BARR.y + 10) return null; if (part === 'pgdn' && py >= WM.BARR.y + WM.BARR.h - 10) return null; }
  if (part === 'thumb' && !gm.thumb) return null;
  const t = new M.VsTrack(v, 'tell'), px = WM.BARR.x + 6;
  t.down(px, py, 1000);
  let moveTo = null;
  if (part === 'thumb') { moveTo = py2 ?? py; t.onEvent({ t: 'move', px, py: moveTo }); }
  t.onEvent({ t: 'up' });
  return { px, py, moveTo, tells: t.tells.map((x) => x.value), part };
}

/**
 * A driver for one document on one machine: every step goes through K_DISPATCH (or M_EVENT for E_SCROLL, the bar's own tracking loop for bar clicks), the model follows, and after each step the
 * checks of 8 items 1-4 are made into `secs` = { doc, lt, bar, scr } (each a Sec of tk-lib2's makeGroups; may be the same one).
 */
export class Drv {
  constructor(env, secs, doc, o = {}) {
    this.env = env; this.secs = secs; this.doc = doc; this.trail = []; this.covers = o.covers || []; this.screen = o.screen !== false; this.full = !!o.full;
    this.stat = { steps: 0, keys: 0, clicks: 0, scrolls: 0, barClicks: 0, noops: 0, screens: 0, maxDraws: 0, drawsPerKey: [] };
  }
  note(s) { this.trail.push(s); if (this.trail.length > 6) this.trail.shift(); }
  ctx() { return `${this.trail.join(' > ')} [${describe(this.doc)}]`; }
  /** The checks after a step.  r = the run; before = the display before; noDraws: the contract says nothing is drawn. */
  check(r, before, o = {}) {
    const { env, secs, doc } = this, { S } = env, ob = objs(env), ctx = this.ctx();
    this.stat.steps++;
    if (r) X.noteRun(secs.doc, r, ctx);
    if (r) X.totals.maxStack = Math.max(X.totals.maxStack, r.stack);
    if (r) for (const a of r.draws) secs.doc.ok(a === ob.tv || a === ob.bar, () => `${ctx}: W_DRAWVIEW of ${hex(a)}, which is neither the text view ${hex(ob.tv)} nor the bar ${hex(ob.bar)}`);
    if (r && o.noDraws) secs.doc.ok(r.draws.length === 0, () => `${ctx}: ${r.draws.length} W_DRAWVIEW call(s); nothing changed, so nothing is drawn`);
    if (r) this.stat.maxDraws = Math.max(this.stat.maxDraws, r.draws.length);
    const sd = stateDiff(env, doc);
    secs.doc.ok(sd.doc.length === 0, () => `${ctx}: ${sd.doc[0]}`);
    secs.lt.ok(sd.lt.length === 0, () => `${ctx}: ${sd.lt[0]}`);
    secs.bar.ok(sd.bar.length === 0, () => `${ctx}: ${sd.bar[0]}`);
    if (this.screen) {
      this.stat.screens++;
      const d1 = liveDiff(env, doc, { covers: this.covers, full: this.full });
      secs.scr.ok(d1 === null, () => `${ctx}: screen ${d1}`);
      if (!this.full) {
        const d2 = T.diffOutside(before, readDisp(env.m), WM.WINR.x, WM.WINR.y, WM.WINR.w, WM.WINR.h);
        secs.scr.ok(d2 === null, () => `${ctx}: pixels outside Write's window changed: ${d2}`);
      }
    }
    return secs.doc.nf + secs.lt.nf + secs.bar.nf + secs.scr.nf;
  }
  /** The checks with no step (after a poke, a cover opened or closed). */
  verify(label) { this.note(label); return this.check(null, readDisp(this.env.m)); }
  total() { const s = this.secs; return s.doc.nf + s.lt.nf + s.bar.nf + s.scr.nf; }
  /** A record to the text view's M_EVENT by T_SEND (the model follows: a key is applied when consumed); returns the run. */
  direct(rec, label, o = {}) {
    const { env, doc } = this, before = readDisp(env.m), tv = objs(env).tv;
    this.note(label);
    let r;
    try { if (rec[0] === E.SCROLL) emulateBar(env, rec[1]); r = sendRec(env, tv, rec, o.run || {}); } catch (e) { this.secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    const [t, a1, a2, a3] = rec;
    let want;
    if (t === E.KEY) { want = Doc_consumes(a1); Doc_key(doc, a1); }
    else if (t === E.DOWN) { want = true; doc.click(a1 + 256 * (a3 & 1), a2); }
    else if (t === E.UP) want = true;
    else if (t === E.MOVE) { want = rd16(env.m, env.S.K_CAPTURE) === tv; if (want) doc.drag(a1 + 256 * (a3 & 1), a2); }      // W2 (12.4): E_MOVE with the capture is a drag (W1: consumed, nothing else)
    else if (t === E.SCROLL) { want = undefined; doc.scrollTo(a1); }       // CONTRACT? consumed or not is not settled for E_SCROLL
    if (want !== undefined) this.secs.doc.ok(!!r.carry === !!want, () => `${this.ctx()}: record ${JSON.stringify(rec)}: consumed (carry) ${r.carry}, want ${want ? 1 : 0}`);
    this.check(r, before, o);
    return r;
  }
  /** One key through K_DISPATCH. */
  key(code) {
    const { env, doc } = this, before = readDisp(env.m);
    this.note(`key ${code}${code >= 32 && code < 127 ? ' ' + JSON.stringify(String.fromCharCode(code)) : ''}`);
    this.stat.keys++;
    const was = doc.clone();
    let r;
    try { r = dispatch(env, keyRec(code)); } catch (e) { this.secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    const changed = Doc_key(doc, code);
    if (!changed) this.stat.noops++;
    const refused = ((code >= 32 && code <= 126) || code === 13) && !was.canInsert();
    this.check(r, before, { noDraws: refused });
    return r;
  }
  /** A click: E_DOWN then E_UP at (px, py) through K_DISPATCH; K_CAPTURE is the text view after the press and 0 after the release. */
  click(px, py) {
    const { env, doc, secs } = this, { S } = env, before = readDisp(env.m), tv = objs(env).tv;
    this.note(`click (${px}, ${py})`); this.stat.clicks++;
    let r1, r2;
    try { r1 = dispatch(env, ptRec(E.DOWN, px, py, 1)); } catch (e) { secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    const cap1 = rd16(env.m, S.K_CAPTURE);
    secs.doc.ok(cap1 === tv, () => `${this.ctx()}: K_CAPTURE ${hex(cap1)} after the press, the text view ${hex(tv)} (E_DOWN consumed)`);
    try { r2 = dispatch(env, ptRec(E.UP, px, py, 0)); } catch (e) { secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    doc.click(px, py);
    secs.doc.ok(rd16(env.m, S.K_CAPTURE) === 0, () => `${this.ctx()}: K_CAPTURE ${hex(rd16(env.m, S.K_CAPTURE))} after the release`);
    X.noteRun(secs.doc, r1, this.ctx());
    this.check(r2, before);
    return r2;
  }
  /** E_SCROLL with the bar's value v, to the text view by M_EVENT (as the bar sends it). */
  scroll(v) {
    const { env, doc } = this, before = readDisp(env.m), o = objs(env);
    this.note(`E_SCROLL ${v}`); this.stat.scrolls++;
    let r;
    try { emulateBar(env, v); r = sendRec(env, o.tv, [E.SCROLL, v, 2, 0]); } catch (e) { this.secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    if (!r.carry) this.stat.scrollNotConsumed = (this.stat.scrollNotConsumed || 0) + 1;      // CONTRACT? 11.5 does not say whether the text view consumes E_SCROLL (a List's does): counted, not judged
    const was = doc.top; doc.scrollTo(v);
    this.check(r, before);
    void was; return r;
  }
  /** A click on the bar through the real tracking loop (E_DOWN to the bar by K_DISPATCH, the loop answered per HALT with the script's events); the model's VsTrack gives the E_SCROLLs. */
  barClick(part, py2) {
    const { env, doc } = this, { m, S } = env, before = readDisp(m);
    const plan = barPlan(doc, part, py2, m.ram[objs(env).bar + S.VScroll_value]);      // from the value the bar really holds (an E_SCROLL leaves it where the bar put it)
    if (!plan) return null;
    this.note(`bar ${part}${plan.moveTo !== null ? ' to ' + plan.moveTo : ''}`); this.stat.barClicks++;
    T.drainEvents(env); T.setVframes(env, 1000); T.setEv(env, ptRec(E.DOWN, plan.px, plan.py, 1));
    let wakes = 0, r;
    const script = plan.part === 'thumb' ? [[ptRec(E.MOVE, plan.px, plan.moveTo, 1)], [ptRec(E.UP, plan.px, plan.moveTo, 0)]] : [[ptRec(E.UP, plan.px, plan.py, 0)]];
    try {
      r = T.runCall(env, S.K_DISPATCH, {}, { onHalt: () => { if (wakes >= script.length) throw new Error('the bar still waits after the script'); T.setVframes(env, 1000 + wakes + 1); for (const rec of script[wakes]) T.ringPut(env, rec); wakes++; } });
    } catch (e) { this.secs.bar.ok(false, `${this.ctx()}: ${e.message}`); T.drainEvents(env); return null; }
    for (const v of plan.tells) doc.scrollTo(v);
    this.check(r, before);
    return r;
  }
}
/** Doc.key for a code, with the keys that are not consumed ending the run. */
export function Doc_key(doc, code) { return Doc_consumes(code) ? doc.key(code) : doc.other(); }
export const Doc_consumes = (code) => WM.Doc.consumes(code);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Real frames: the "File" menu, the dialog (WRITE 11.6)
/** The "File" menu's item "New" by the pointer: press the title, move to the first item, release (the gesture of the shell's "Leap" menu, tests/shell-lib.mjs leapMenu). */
export function fileNew(env) {
  const { m } = env;
  L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, 30, 14); env.frames_(2);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
}
/** The discard dialog is the second window, at (128, 64, 256, 64). */
export function dialogUp(env) {
  const { m, S } = env, ws = L.openWindows(m, S);
  return ws.length === 2 && ws.some((w) => w.cls === S.CL_Dialog && w.x === WM.DLG.x && w.y === WM.DLG.y && w.w === WM.DLG.w && w.h === WM.DLG.h);
}
/** { discard, cancel } as readView records found by their rectangles (11.6), or null. */
export function dialogButtons(env) {
  const { m, S } = env, views = L.allViews(m, S);
  const f = (r) => views.find((v) => v.cls === S.CL_Button && v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h);
  const discard = f(WM.DLG.discard), cancel = f(WM.DLG.cancel);
  return discard && cancel ? { discard, cancel } : null;
}
export const clickView = (env, v) => L.click(env, v.x + (v.w >> 1), v.y + (v.h >> 1), 3, 6);

// ===========================================================================================================================================================================================
// W2 (docs/WRITE.md 12).  Everything below is additive: W1's suites still load against a build that has no W2 symbols (they just do not call these).
export const WR2_NEEDED = ['WR_AN', 'WR_MK', 'WR_CLN', 'WR_CLIP', 'WR_MENU', 'K_LDIR', 'MB_ENT', 'ME_EN', 'ME_SIZE'];
/** A clear failure (not a crash somewhere later) when the cartridge is not a W2 build. */
export function needWr2(S) {
  const miss = WR2_NEEDED.filter((n) => S[n] === undefined);
  if (miss.length) throw new Error(`desk5 has no Write W2: it does not define ${miss.join(', ')} (docs/WRITE.md 12.7); build W2 first`);
  if (S.WR_CLIP !== 0x7800) throw new Error(`WR_CLIP is ${hex(S.WR_CLIP)}, 12.5 says $7800`);
}
/** bootWrite for the W2 suites: the same machine, the W2 symbols required. */
export function bootWrite2(opts = {}) { const env = bootWrite(opts); needWr2(env.S); return env; }
export const CLIP = 0x7800, CLIP_END = 0x8000;
/** What 12.7 names, read back: the anchor, the mark, the clipboard's length and its codes. */
export function readState2(env) {
  const { m, S } = env, cln = rd16(m, S.WR_CLN);
  return { an: rd16(m, S.WR_AN), mk: m.ram[S.WR_MK], cln, clip: Array.from(m.ram.subarray(CLIP, CLIP + Math.min(cln, WM.CLIPMAX))) };
}
/** The differences between the machine's W2 state and a Doc: { sel: [anchor, mark], clip: [length, codes] }. */
export function stateDiff2(env, doc) {
  const st = readState2(env), out = { sel: [], clip: [] };
  if (st.an !== doc.anchor) out.sel.push(`the anchor (WR_AN) ${st.an}, model ${doc.anchor} (caret ${doc.caret}, mark ${doc.mark})`);
  if (st.mk !== doc.mark) out.sel.push(`the mark (WR_MK) ${st.mk}, model ${doc.mark}`);
  if (st.cln !== doc.clip.length) out.clip.push(`the clipboard's length (WR_CLN) ${st.cln}, model ${doc.clip.length}`);
  else { const i = firstDiff(st.clip, doc.clip); if (i >= 0) out.clip.push(`the clipboard differs at offset ${i} (length ${st.cln}): machine ${JSON.stringify(WM.textOf(st.clip.slice(Math.max(0, i - 4), i + 8)))}, model ${JSON.stringify(WM.textOf(doc.clip.slice(Math.max(0, i - 4), i + 8)))}`); }
  return out;
}
/** The kernel's enable word of menu `index` (0 File, 1 Edit): MB_ENT + ME_SIZE x index + ME_EN (a word; bit n - 1 - k for item k of n). */
export const menuBits = (env, index) => rd16(env.m, env.S.MB_ENT + env.S.ME_SIZE * index + env.S.ME_EN);
/** The model's words for the two menus: File "New" (1 item, always enabled: bit 0), Edit (5 items). */
export const wantBits = (doc) => [1, doc.editBits()];
/** WR_MENU with K_EV = an E_MENU record (menu id, item id), by a direct call under mapping A (interrupts as `o`). */
export function menuCall(env, menuId, item, o = {}) {
  T.drainEvents(env); T.setEv(env, [E.MENU, menuId, item, 0]);
  return T.runCall(env, env.S.WR_MENU, {}, { map: 'A', ...o });
}
/** The 2,048 bytes at $7800 (a copy). */
export const clipRegion = (env) => env.m.ram.slice(CLIP, CLIP_END);

/** Drv plus MARK, drags and the Edit menu's items.  secs may also hold `sel` (anchor, mark), `clip` (the clipboard and its region) and `menu` (the enabled bits); each falls back to secs.doc. */
export class Drv2 extends Drv {
  constructor(env, secs, doc, o = {}) { super(env, secs, doc, o); this.clipLast = null; this.menuChecks = o.menu !== false; this.stat.drags = 0; this.stat.menus = 0; this.stat.marks = 0; this.stat.pastesRefused = 0; }
  check(r, before, o = {}) {
    const n = super.check(r, before, o);
    this.check2(r, o);
    const s = this.secs;
    return n + (s.sel ? s.sel.nf : 0) + (s.clip ? s.clip.nf : 0) + (s.menu ? s.menu.nf : 0);
  }
  total() { const s = this.secs; return super.total() + (s.sel ? s.sel.nf : 0) + (s.clip ? s.clip.nf : 0) + (s.menu ? s.menu.nf : 0); }
  /** The W2 checks of WRITE 12.9 items 2 and 4: anchor, mark, clipboard (length, codes, and $7800-$7FFF written only by Cut / Copy), the menu's enable bits.  o.clipWrite: this step is Cut or Copy. */
  check2(r, o = {}) {
    const { env, doc } = this, { m } = env, s = this.secs, sel = s.sel || s.doc, clip = s.clip || s.doc, menu = s.menu || s.doc, ctx = this.ctx();
    const sd = stateDiff2(env, doc);
    sel.ok(sd.sel.length === 0, () => `${ctx}: ${sd.sel[0]}`);
    clip.ok(sd.clip.length === 0, () => `${ctx}: ${sd.clip[0]}`);
    const cur = clipRegion(env);
    if (this.clipLast && r) {
      const from = o.clipWrite ? doc.clip.length : 0;       // 12.5: Cut and Copy write the selection's codes at $7800; nothing else writes $7800-$7FFF (CONTRACT? the bytes above them are left alone)
      let bad = -1; for (let i = from; i < WM.CLIPMAX; i++) if (cur[i] !== this.clipLast[i]) { bad = i; break; }
      clip.ok(bad < 0, () => `${ctx}: $7800-$7FFF changed at offset ${bad} (${hex(CLIP + bad)}) by a step that ${o.clipWrite ? 'may write only the first ' + doc.clip.length + ' bytes' : 'must not write it'}`);
    }
    this.clipLast = cur;
    if (this.menuChecks) {
      const want = wantBits(doc), mask = [1, 0x1F];
      for (let i = 0; i < 2; i++) { const got = menuBits(env, i) & mask[i]; menu.ok(got === want[i], () => `${ctx}: menu ${i} enable bits ${got.toString(2).padStart(i ? 5 : 1, '0')}, model ${want[i].toString(2).padStart(i ? 5 : 1, '0')} (S ${doc.S}, clipboard ${doc.clip.length})`); }
    }
  }
  /** The state after a loadDoc / reset (no step): remembers $7800-$7FFF as it is. */
  verify(label) { this.clipLast = null; const n = super.verify(label); return n; }
  /** One key through K_DISPATCH (W2: a typed code over a selection is not "refused": its deletion draws). */
  key(code) {
    const { env, doc } = this, before = readDisp(env.m);
    this.note(`key ${code}${code >= 32 && code < 127 ? ' ' + JSON.stringify(String.fromCharCode(code)) : code === 18 ? ' MARK' : ''}`);
    this.stat.keys++; if (code === 18) this.stat.marks++;
    const was = doc.clone();
    let r;
    try { r = dispatch(env, keyRec(code)); } catch (e) { this.secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    const changed = Doc_key(doc, code);
    if (!changed) this.stat.noops++;
    const refused = ((code >= 32 && code <= 126) || code === 13) && !was.canInsert() && was.S === 0;
    this.check(r, before, { noDraws: refused });
    return r;
  }
  mark() { return this.key(18); }
  /** A drag: E_DOWN at `down` = [px, py] (K_CAPTURE becomes the text view), an E_MOVE with the button held at each of `moves`, E_UP at the last point; the model follows each event and every event is checked. */
  drag(down, moves) {
    const { env, doc, secs } = this, { S } = env, tv = objs(env).tv;
    this.note(`press (${down[0]}, ${down[1]})`); this.stat.drags++;
    let before = readDisp(env.m), r;
    try { r = dispatch(env, ptRec(E.DOWN, down[0], down[1], 1)); } catch (e) { secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    doc.click(down[0], down[1]);
    secs.doc.ok(rd16(env.m, S.K_CAPTURE) === tv, () => `${this.ctx()}: K_CAPTURE ${hex(rd16(env.m, S.K_CAPTURE))} after the press, the text view ${hex(tv)}`);
    this.check(r, before);
    for (const [px, py] of moves) {
      this.note(`drag to (${px}, ${py})`);
      before = readDisp(env.m);
      try { r = dispatch(env, ptRec(E.MOVE, px, py, 1)); } catch (e) { secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
      doc.drag(px, py);
      this.check(r, before);
    }
    const last = moves.length ? moves[moves.length - 1] : down;
    this.note(`release (${last[0]}, ${last[1]})`);
    before = readDisp(env.m);
    try { r = dispatch(env, ptRec(E.UP, last[0], last[1], 0)); } catch (e) { secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    secs.doc.ok(rd16(env.m, S.K_CAPTURE) === 0, () => `${this.ctx()}: K_CAPTURE ${hex(rd16(env.m, S.K_CAPTURE))} after the release`);
    this.check(r, before);
    return r;
  }
  /** An Edit menu item (1 Cut, 2 Copy, 3 Paste, 4 Select all) by WR_MENU; only for an item the model has enabled (the kernel sends no other: 12.4). */
  menuItem(item) {
    const { env, doc } = this, before = readDisp(env.m), name = ['', 'Cut', 'Copy', 'Paste', 'Select all'][item];
    this.note(`menu ${name}`); this.stat.menus++;
    const en = doc.editEnabled()[item === 4 ? 4 : item - 1];
    if (!en) throw new Error(`Drv2.menuItem(${item}): the model has it disabled (${this.ctx()})`);
    const wasPasteOk = item === 3 ? doc.pasteOk() : true;
    let r;
    try { r = menuCall(env, 2, item); } catch (e) { this.secs.doc.ok(false, `${this.ctx()}: ${e.message}`); return null; }
    doc.menuItem(item);
    if (item === 3 && !wasPasteOk) this.stat.pastesRefused++;
    this.check(r, before, { clipWrite: item === 1 || item === 2 });
    return r;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Real frames: MARK, the Edit menu
/** Hold the matrix keys `list` (indices 5 row + bit) `hold` frames, release, `rel` frames. */
export function typeKeys(env, list, hold = 3, rel = 3) { L.setKeys(env.m, list); env.frames_(hold); L.setKeys(env.m, []); env.frames_(rel); }
/** MARK by the keyboard: SYMBOL SHIFT + E.  CONTRACT? keymap.txt maps SS+E to MARK (12.1); when the key map in the tree does not yet, the keys are pressed all the same (key 36 + key 12). */
export function typeMark(env, hold = 3, rel = 3) {
  let keys; try { keys = L.keysFor(18); } catch { keys = [36, 12]; }
  typeKeys(env, keys, hold, rel);
}
/** The menu keys: MENU (code 16), then the codes in `codes` (RIGHT 9, DOWN 10, ENTER 13 ...), each a real keystroke. */
export function menuKeys(env, codes) { for (const c of codes) L.typeCode(env, c, 3, 3); }
/** The Edit title box (43..79 at y 0-7: File is 8..42) and the items' rows: item index k (Cut 0, Copy 1, Paste 2, separator 3, Select all 4) at y 14 + 10 k, x inside the drop-down (WINDOWS 18.2, 18.3). */
export const EDIT_TITLE = [60, 4], editItemPos = (k) => [60, 14 + 10 * k];
export const ITEM_INDEX = { 1: 0, 2: 1, 3: 2, 4: 4 };
/** The Edit menu by the pointer (the gesture of fileNew): press the title, move to the item, release over it (`release` false: leave the button down, the menu open). */
export function editMenu(env, itemIndex, { release = true, wait = 12 } = {}) {
  const { m } = env;
  L.moveTo(env, EDIT_TITLE[0], EDIT_TITLE[1]); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  const [x, y] = editItemPos(itemIndex);
  L.moveTo(env, x, y); env.frames_(2);
  if (release) { m.mouse.buttons = L.MOUSE_UP; env.frames_(wait); }
}
export const releaseMenu = (env, wait = 12) => { env.m.mouse.buttons = L.MOUSE_UP; env.frames_(wait); };
