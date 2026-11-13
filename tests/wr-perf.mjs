"use strict";
// wr-perf.mjs -- Write W1's bounds, docs/WRITE.md section 7, measured as 11.8 says, as a table, on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt).
// Written from the contract only (never from src/apps/write.asm).  T-states are TSRun's (no memory contention); direct calls under mapping K with a sentinel return; interrupts ON for the
// K_DISPATCH rows (WRITE 7: "interrupts on for dispatch rows"), off for W_DRAWVIEW and the stack rows.  Each figure is the worst of three, the text view focused, the window in front.
//   node tests/wr-perf.mjs [--seed N]
// W2's rows (WRITE 12.8) follow W1's: tests/wr-perf.mjs measures both; without W2 symbols the W2 rows fail with a message.
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.  A missed bound is reported with its numbers and nothing is changed (WRITE preamble).
import * as W from './wr-lib.mjs';
import * as H from './shell-lib.mjs';
import { makeHost } from './wr-w3lib.mjs';
import * as W3 from './wr-w3model.mjs';

const { L, T, X, WM, hex, rd16, E } = W;
const { argNum } = L;
const SEED = argNum('--seed', 1);
const rng = L.makeRng(SEED);
console.log(`seed ${SEED} (rerun with --seed ${SEED}; the measurements are deterministic, the seed picks the registers the routines ignore and the random words)`);
const rows = []; let missed = 0;
const fmt = (n) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en') : String(n));
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  rows.push({ name, measured, bound, status, note });
  console.log(`${status === 'MISSED' ? 'FAIL' : 'ok  '} | ${name} | measured ${fmt(measured)} | bound ${bound === null ? 'report' : '<= ' + fmt(bound)} | ${status}${note ? ' | ' + note : ''}`);
};

const env = W.bootWrite({ rng }); W.parkDirect(env);
const { m, S } = env, o = W.objs(env);
const KB = 58_000;
let diTotal = 0;

// ---- bytes ---------------------------------------------------------------------------------------------------------------------------------------------------------
{
  const total = S.WR_END - S.WR_START;
  row('Write\'s bytes in DOCK 2-3 (code and image): WR_END - WR_START (W1 EST 3,000-4,000, all of Write <= 7,000)', total, null, `WR_START ${hex(S.WR_START)}, WR_END ${hex(S.WR_END)}; the all-of-Write bound of 7,000 is ${total <= 7000 ? 'not exceeded' : 'EXCEEDED'}`);
  row('RAM image: WR_IMG_LEN', S.WR_IMG_LEN, 1024, `image at ${hex(S.WR_IMG)}`);
  row('pool bytes: nothing of Write is in the pool (WRITE 6, 7: 0).  Not measurable from the symbol file of a cartridge: the build report of the main model gives it', 0, 0, 'noted, not measured here');
}

// ---- documents for the rows (11.8) ---------------------------------------------------------------------------------------------------------------------------------
const SENT = WM.codesOf('The quick brown fox jumps over the lazy dog. ');
const X_ = 120;                                                                  // 'x'
/** 11.8 "typed code at the end of a line": the sentence repeated, a start offset chosen so that 'x' typed at the end of line 0's last word does not rewrap anything. */
function endOfLineDoc() {
  for (let off = 0; off < SENT.length; off++) {
    const codes = []; while (codes.length < 400) codes.push(...SENT); codes.splice(0, off);
    const d = new WM.Doc(codes), l0 = d.lens[0]; let e = l0; while (e > 0 && codes[e - 1] === 32) e--;
    const t = new WM.Doc(codes.slice(0, e).concat([X_], codes.slice(e)));
    if (JSON.stringify(t.lens) === JSON.stringify([l0 + 1, ...d.lens.slice(1)])) { d.caret = e; return { d, off }; }
  }
  throw new Error('no start offset gives a no-rewrap end-of-line insert');
}
/** An 80-code line with room for one more code (width <= 444 - adv('x')). */
function line80() {
  const L_ = WM.codesOf('abcdefghijklmnopqrstuvwxyz'), room = 444 - WM.adv(X_);
  const c = new Array(80).fill(105);                                              // 80 x 'i' (3 each), then random letters wherever the line still has room, up to 420..room pixels
  for (let k = 0; k < 4000 && WM.tw(c, 0, 80) < 420; k++) { const i = rng.int(0, 79), n = rng.pick(L_), t = WM.tw(c, 0, 80) - WM.adv(c[i]) + WM.adv(n); if (t <= room) c[i] = n; }
  const d = new WM.Doc(c, 0);
  if (d.nl !== 1 || WM.tw(c, 0, 80) > room) throw new Error('line80: no 80-code line');
  return d;
}
const words = () => { const o = []; for (;;) { const n = rng.int(2, 9); for (let i = 0; i < n; i++) o.push(rng.pick(WM.codesOf('abcdefghijklmnopqrstuvwxyz'))); o.push(32); if (o.length > 4000) return o; } };
/** One paragraph (no ENTER) of exactly n display lines, each as full as the words allow. */
function paragraph(n) { const w = words(); for (let len = 60; len < 4000; len++) { const d = new WM.Doc(w.slice(0, len)); if (d.nl === n && d.lens[n - 1] > 40) return d; if (d.nl > n) break; } return paragraph(n); }
let docKey = 0;
/** Type `d` into a fresh machine (a snapshot per distinct document makes the repeats instant); `d.top` null: the natural top.  Returns the model that follows the machine. */
const setup = (d, key = null) => { if (d.top === 0 && d.nl > 16 && d.caretLine() > 15) d.top = null; return W.loadDoc(env, d, key); };
const chkState = (d, what) => { const s = W.stateDiff(env, d), a = [...s.doc, ...s.lt, ...s.bar]; if (a.length) { missed++; console.log(`FAIL | ${what}: the machine's state differs from the model's: ${a[0]}`); } };
const key = (code, ints = true) => { const r = W.dispatch(env, W.keyRec(code), { ints }); diTotal += r.di; if (r.badSp !== undefined || r.preserved.length) { missed++; console.log(`FAIL | key ${code}: SP / registers not kept (${r.badSp !== undefined ? 'SP ' + hex(r.badSp) : r.preserved.join(',')})`); } return r; };
/** The worst of three runs of `act` (each from a fresh `prep`), and the screen check of the last. */
function worst3(prep, act, d, what) {
  const ts = [];
  for (let i = 0; i < 3; i++) { prep(); const r = act(); ts.push(r.t); }
  chkState(d, what);
  const g = W.liveDiff(env, d, {}); if (g !== null) { missed++; console.log(`FAIL | ${what}: the screen differs from the model: ${g}`); }
  return ts;
}

// ---- typed codes ---------------------------------------------------------------------------------------------------------------------------------------------------
/** Three runs of `act(dd)` from the same typed document (an instant snapshot restore each time); the model follows; the state and screen of the last are checked. */
function runs3(d, key, what, act) {
  const ts = []; let last = null;
  for (let i = 0; i < 3; i++) {
    const dd = setup(d.clone(), key), r = act(dd); ts.push(r.t); last = dd;
    if (i === 2) { chkState(dd, what); const g = W.liveDiff(env, dd, {}); if (g) { missed++; console.log(`FAIL | ${what}: the screen differs from the model: ${g}`); } }
  }
  return { ts, doc: last };
}
{
  const { d, off } = endOfLineDoc();
  const { ts } = runs3(d, 'eol', 'typed code at the end of a line', (dd) => { const r = key(X_); dd.key(X_); return r; });
  row('a typed code at the end of a line (no rewrap): K_DISPATCH of E_KEY "x" to the return (11.8: the quick-brown-fox text, caret at the end of line 0\'s last word)', Math.max(...ts), KB, `worst of ${ts.join(', ')}; start offset ${off}, line 0 ${d.lens[0]} codes`);
}
{
  const d = line80();
  const { ts } = runs3(d, 'l80', 'typed code at the start of an 80-code line', (dd) => { const r = key(X_); dd.key(X_); return r; });
  row('a typed code at the start of an 80-code line that does not rewrap: K_DISPATCH of E_KEY "x" (11.8)', Math.max(...ts), 117_000, `worst of ${ts.join(', ')}`);
}
{
  const d = paragraph(10); d.caret = 0;
  const { ts } = runs3(d, 'p10', 'typed code that rewraps a 10-line paragraph', (dd) => { const r = key(X_); dd.key(X_); return r; });
  row('a typed code that rewraps the rest of a 10-line paragraph: K_DISPATCH of E_KEY "x", caret 0 (11.8)', Math.max(...ts), null, `report; worst of ${ts.join(', ')} (${d.nl} lines)`);
}

// ---- caret moves ---------------------------------------------------------------------------------------------------------------------------------------------------
/** The loaded document (caret 0, top 0) with the caret taken down `n` lines by DOWN keys (unmeasured; the model follows).  top stays 0 for n <= 15. */
const downTo = (dd, n) => { for (let i = 0; i < n; i++) { key(10); dd.key(10); } return dd; };
/** Three runs of `act(dd)`, each from `dd0` rebuilt by `prep` (typed once, then restored from the snapshot, then walked to its line). */
function runsAt(d, keyName, line, what, act) {
  const ts = []; let last = null;
  for (let i = 0; i < 3; i++) {
    const dd = downTo(setup(d.clone(), keyName), line), r = act(dd); ts.push(r.t); last = dd;
    if (i === 2) { chkState(dd, what); const g = W.liveDiff(env, dd, {}); if (g) { missed++; console.log(`FAIL | ${what}: the screen differs from the model: ${g}`); } }
  }
  return { ts, doc: last };
}
{
  const d = paragraph(16); d.caret = 0; d.top = 0;
  for (const [name, code] of [['RIGHT', 9], ['LEFT', 8], ['DOWN', 10], ['UP', 11]]) {
    const { ts } = runsAt(d, 'p16', 5, `caret move ${name}`, (dd) => { const r = key(code); dd.key(code); return r; });
    row(`a caret move ${name} within the lines shown: K_DISPATCH, the caret in line 5 of 16 full lines (11.8)`, Math.max(...ts), KB, `worst of ${ts.join(', ')}`);
  }
}

// ---- scroll by one line ---------------------------------------------------------------------------------------------------------------------------------------------
{
  const d = paragraph(40); d.caret = 0; d.top = 0;
  const { ts, doc } = runsAt(d, 'p40', 15, 'scroll by one line', (dd) => { const r = key(10); dd.key(10); return r; });
  if (doc.top !== 1) { missed++; console.log(`FAIL | the model's top after DOWN off the bottom is ${doc.top}, want 1`); }
  row('scroll by one line: 40 lines, top 0, the caret on line 15, K_DISPATCH of E_KEY DOWN (11.8; the owner\'s bound, WRITE 11.10)', Math.max(...ts), 341400, `EST was 190 k; worst of ${ts.join(', ')} (${d.nl} lines)`);
}
// a bar arrow scrolls by one line too: the real tracking loop, E_DOWN to the down arrow answered with an E_UP at the first HALT
{
  const d0 = paragraph(40); d0.caret = 0; d0.top = 0;
  const ts = [];
  for (let i = 0; i < 3; i++) {
    const dd = setup(d0.clone(), 'p40');
    T.drainEvents(env); T.setVframes(env, 1000); T.setEv(env, W.ptRec(E.DOWN, 484, 170, 1));
    const r = T.runCall(env, S.K_DISPATCH, {}, { onHalt: () => { T.setVframes(env, 1001); T.ringPut(env, W.ptRec(E.UP, 484, 170, 0)); } });
    ts.push(r.t); diTotal += r.di;
    dd.scrollTo(m.ram[o.bar + S.VScroll_value]);
    if (i === 2) { chkState(dd, 'bar arrow'); const g = W.liveDiff(env, dd, {}); if (g) { missed++; console.log(`FAIL | the screen after the bar arrow: ${g}`); } }
  }
  row('scroll by one line by a bar arrow: K_DISPATCH of the E_DOWN on the down arrow, the loop ended by an E_UP at its first HALT (the bar redrawn and the text view told; the owner\'s bound, WRITE 11.10)', Math.max(...ts), 411900, `worst of ${ts.join(', ')}`);
}

// ---- the full draw -------------------------------------------------------------------------------------------------------------------------------------------------
{
  const d = paragraph(16); d.top = 0; d.caret = 0;
  const dd = downTo(setup(d, 'p16b'), 8);
  const ts = [];
  for (let i = 0; i < 3; i++) { const r = T.runCall(env, S.W_DRAWVIEW, { ix: o.tv }, { ints: false }); ts.push(r.t); diTotal += r.di; }
  const g = W.liveDiff(env, dd, {});
  row('W_DRAWVIEW of the text view, 16 lines of about 80 codes, focused (11.8)', Math.max(...ts), null, `report (EST 870 k); worst of ${ts.join(', ')} (${d.L} codes, ${d.nl} lines); screen ${g === null ? 'equals the model' : 'DIFFERS: ' + g}`);
  if (g !== null) missed++;
}

// ---- stack -----------------------------------------------------------------------------------------------------------------------------------------------------------
{
  let worstE = { v: 0, what: '' }, worstD = { v: 0, what: '' };
  for (const [name, d] of [['a 10-line paragraph, caret 0, typing', (() => { const p = paragraph(10); p.caret = 0; return p; })()], ['40 lines, DOWN off the bottom', (() => { const p = paragraph(40); p.caret = p.starts[15] + 10; p.top = 0; return p; })()], ['an empty document', new WM.Doc()]]) {
    const dd = setup(d.clone());
    for (const code of [X_, X_, 13, 12, 11, 10, 10, 8, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]) {
      const r = W.sendRec(env, o.tv, W.keyRec(code), { ints: false }); diTotal += r.di;
      if (r.stack - 2 > worstE.v) worstE = { v: r.stack - 2, what: `${name}, key ${code}` };
    }
    W.focusTv(env);
    const r = W.sendDraw(env, o.tv); diTotal += r.di;
    if (r.stack - 2 > worstD.v) worstD = { v: r.stack - 2, what: name };
    const r2 = W.sendRec(env, o.tv, [E.SCROLL, 2, 2, 0], { ints: false }); if (r2.stack - 2 > worstE.v) worstE = { v: r2.stack - 2, what: `${name}, E_SCROLL` };
  }
  row('stack of the text view\'s M_EVENT (keys, a scroll), crossings included, bytes below T_SEND\'s own return', worstE.v, 128, worstE.what);
  row('stack of the text view\'s M_DRAW, crossings included', worstD.v, 128, worstD.what);
}

// ---- launch, over real frames ----------------------------------------------------------------------------------------------------------------------------------------
{
  const e = H.bootShell(), me = e.m;
  const frames = [];
  const drawn = () => L.progUp(e, 3) && H.writeDiff(e) === null;
  for (let rep = 0; rep < 3; rep++) {
    e.frames_(12);
    const [cx, cy] = L.iconCentre(3);
    L.click(e, cx, cy, 3, 6);
    me.mouse.buttons = L.MOUSE_LEFT;
    let n = 0, ok = false;
    for (n = 1; n <= 90; n++) { e.frame(); if (n === 3) me.mouse.buttons = L.MOUSE_UP; if (drawn()) { ok = true; break; } }
    me.mouse.buttons = L.MOUSE_UP; frames.push(ok ? n : NaN);
    e.frames_(12);
    if (!L.quitBySSQ(e)) { missed++; console.log('FAIL | SS+Q did not quit Write'); break; }
  }
  row('launch: frames from the second click\'s press (frame 1) to Write\'s window drawn (the screen equals the model\'s), empty document, worst of 3', Math.max(...frames), 30, `all ${frames.join(', ')}`);
  row('frame interrupts lost over the launch machine\'s normal frames (V_FRAMES must rise by 1 a frame)', e.vf.bad, 0, `${e.vf.checked} frames checked${e.vf.bad ? '; first ' + e.vf.first : ''}; memory watch: ${e.w.summary()}`);
  if (e.w.n) { missed++; console.log('FAIL | the memory watch (BANKING 10.7) reported violations in the launch run'); }
}
// ===== W2 (docs/WRITE.md 12.8) ===========================================================================================================================================================
// W1's rows above are unchanged (12.8: "W1's rows (11.9) again, after W2": the same rows, the same bounds, now run against the W2 build).  Written from 12.8 only.
// CONTRACT? 12.8's key rows use K_DISPATCH of E_KEY, the pointer rows K_DISPATCH of the E_MOVE with K_CAPTURE = the text view (set by a K_DISPATCH of the E_DOWN that starts the drag), the menu rows WR_MENU
// called under mapping A (it is code in DOCK 2-3) with K_EV = the E_MENU record; interrupts on, the worst of three.
let w2ok = true;
try { W.needWr2(S); } catch (e) { w2ok = false; missed++; console.log(`FAIL | W2 rows not measured: ${e.message}`); }
if (w2ok) {
  const BASE_W1 = 3406;                                                     // WRITE 11.9: Write's bytes after W1
  { const total = S.WR_END - S.WR_START;
    row('Write\'s bytes in DOCK 2-3 for W2: WR_END - WR_START less W1\'s 3,406 (12.8 EST +1,200-1,800; all of Write <= 7,000)', total - BASE_W1, null, `total ${total}; the all-of-Write bound of 7,000 is ${total <= 7000 ? 'not exceeded' : 'EXCEEDED'}; K_LDIR ${hex(S.K_LDIR)}`);
    row('RAM image after W2: WR_IMG_LEN', S.WR_IMG_LEN, 1024, 'unchanged bound'); }
  const { snapshot, restore } = await import('./review-lib.mjs');
  const dispPt = (t, px, py, held = 1) => { const r = W.dispatch(env, W.ptRec(t, px, py, held), { ints: true }); diTotal += r.di; return r; };
  const menu = (item) => { const r = W.menuCall(env, 2, item, { ints: true }); diTotal += r.di; if (r.badSp !== undefined || r.preserved.length) { missed++; console.log(`FAIL | WR_MENU item ${item}: SP / registers not kept`); } return r; };
  const chk2 = (d, what) => {
    chkState(d, what);
    const s2 = W.stateDiff2(env, d), a = [...s2.sel, ...s2.clip];
    if (a.length) { missed++; console.log(`FAIL | ${what}: W2 state differs from the model: ${a[0]}`); }
    const g = W.liveDiff(env, d, {}); if (g !== null) { missed++; console.log(`FAIL | ${what}: the screen differs from the model: ${g}`); }
  };
  const pcache = {};
  /** The typed document `d` (snapshot `key`), then `prep(dd)` (unmeasured, the model follows): the result is itself kept as a snapshot, so that the repeats are instant. */
  function prepared(d, key, prep) {
    if (pcache[key]) { restore(env.m, pcache[key].snap); env.strp = T.STR0; return pcache[key].model.clone(); }
    const dd = setup(d.clone(), key); prep(dd);
    pcache[key] = { snap: snapshot(env.m), model: dd.clone() }; return dd.clone();
  }
  const keys = (dd, codes) => { for (const c of codes) { key(c); dd.key(c); } };
  const mk = (dd, item) => { const r = menu(item); dd.menuItem(item); return r; };
  /** The worst of three: `act(dd)` returns the run; each from the prepared state. */
  function worst(d, kname, what, prep, act) {
    const ts = []; let last = null;
    for (let i = 0; i < 3; i++) { const dd = prepared(d, kname, prep); const r = act(dd); ts.push(r.t); last = dd; }
    chk2(last, what); return ts;
  }
  const into5 = (dd) => keys(dd, [10, 10, 10, 10, 10]);                       // the caret into line 5 of the 16 full lines (top stays 0)
  // ---- extend by one code / one line (mark 1, a 10-code selection inside line 5)
  const p16 = paragraph(16); p16.caret = 0; p16.top = 0;
  const ext = (dd) => { into5(dd); keys(dd, [18, ...new Array(10).fill(9)]); };
  {
    const ts = worst(p16, 'w2p16', 'extend by one code', ext, (dd) => { const r = key(9); dd.key(9); return r; });
    row('extend by one code: mark 1, a 10-code selection inside line 5 of 16 full lines, RIGHT (12.8)', Math.max(...ts), KB, `worst of ${ts.join(', ')}`);
    const ts2 = worst(p16, 'w2p16', 'extend by one line', ext, (dd) => { const r = key(10); dd.key(10); return r; });
    row('extend by one line: the same, DOWN (12.8)', Math.max(...ts2), KB, `worst of ${ts2.join(', ')}`);
  }
  // ---- a drag step: the capture held (E_DOWN through K_DISPATCH), a selection ending in line 5, E_MOVE to the same x in line 6
  {
    const ts = [];
    for (let i = 0; i < 3; i++) {
      const dd = prepared(p16, 'w2p16-drag', (d0) => { dispPt(E.DOWN, 100, 30 + 9 * 5 + 4); d0.click(100, 30 + 9 * 5 + 4); dispPt(E.MOVE, 260, 30 + 9 * 5 + 4); d0.drag(260, 30 + 9 * 5 + 4); });
      const r = dispPt(E.MOVE, 260, 30 + 9 * 6 + 4); dd.drag(260, 30 + 9 * 6 + 4); ts.push(r.t);
      if (i === 2) chk2(dd, 'a drag step');
    }
    row('a drag step: the capture held, a selection ending in line 5, E_MOVE to the same x in line 6, K_DISPATCH (12.8)', Math.max(...ts), KB, `worst of ${ts.join(', ')}`);
  }
  // ---- a drag over the view: anchor at line 0's start, E_MOVE to the end of line 15
  {
    const ts = [];
    for (let i = 0; i < 3; i++) {
      const dd = prepared(p16, 'w2p16-dragall', (d0) => { dispPt(E.DOWN, 27, 31); d0.click(27, 31); });
      const r = dispPt(E.MOVE, 471, 30 + 9 * 15 + 4); dd.drag(471, 30 + 9 * 15 + 4); ts.push(r.t);
      if (i === 2) chk2(dd, 'a drag over the view');
    }
    row('a drag over the view: anchor at line 0\'s start, E_MOVE to the end of line 15, K_DISPATCH (12.8)', Math.max(...ts), 366_600, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}`);
  }
  // ---- a typed code over a selection: line 0 a whole paragraph of 70 codes, codes 20-29 selected
  {
    // CONTRACT? "a whole paragraph of 70 codes": taken as 70 text codes and the 13; a second short paragraph follows
    const c = new Array(70).fill(105), room = 444 - WM.adv(X_);
    for (let k = 0; k < 4000 && WM.tw(c, 0, 70) < 400; k++) { const i = rng.int(0, 69), n = rng.pick(WM.codesOf('abcdefghijklmnopqrstuvwxyz')), t = WM.tw(c, 0, 70) - WM.adv(c[i]) + WM.adv(n); if (t <= room) c[i] = n; }
    const d = new WM.Doc([...c, 13, ...WM.codesOf('second paragraph')], 20); d.top = 0;
    if (d.lens[0] !== 71) throw new Error(`the 70-code paragraph wraps: ${d.lens}`);
    const ts = worst(d, 'w2over', 'a typed code over a selection', (dd) => keys(dd, [18, ...new Array(10).fill(9)]), (dd) => { const r = key(X_); dd.key(X_); return r; });
    row('a typed code over a selection: line 0 a whole paragraph of 70 codes, codes 20-29 selected, E_KEY "x" (12.8)', Math.max(...ts), 117_000, `worst of ${ts.join(', ')}`);
  }
  // ---- DELETE of a selection of 3 whole lines (lines 4-6 of a 40-line document, top 0)
  {
    const d = paragraph(40); d.caret = 0; d.top = 0;
    const ts = worst(d, 'w2p40', 'DELETE of 3 lines', (dd) => keys(dd, [10, 10, 10, 10, 18, 10, 10, 10]), (dd) => { const r = key(12); dd.key(12); return r; });
    row('DELETE of a selection of 3 whole lines (lines 4-6 of a 40-line document, top 0), E_KEY DELETE (12.8)', Math.max(...ts), 850_900, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}`);
  }
  // ---- Copy of 2,048 codes
  {
    const t = new WM.Doc(WM.genText(rng, 2100, { para: 0.01 })); t.top = null;
    const prep = (dd) => { mk(dd, 4); key(18); dd.key(18); while (dd.S > 2048) { const c = dd.clone(); c.key(11); const code = c.S >= 2048 && c.caret !== dd.caret ? 11 : 8; key(code); dd.key(code); } };
    const ts = worst(t, 'w2copy', 'Copy of 2,048 codes', prep, (dd) => mk(dd, 2));
    row('Copy of 2,048 codes: WR_MENU with E_MENU 2, 2 (12.8: EST 46 k)', Math.max(...ts), 45_400, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}`);
  }
  // ---- Cut of lines 0-15 (about 1,280 codes) of a 40-line document, top 0; Paste of that clip at the start of line 5
  {
    const d = paragraph(40); d.caret = 0; d.top = 0;
    const sel16 = (dd) => { keys(dd, new Array(16).fill(10)); keys(dd, [18, ...new Array(16).fill(11)]); };   // anchor at line 16's start, the caret back at 0, top 0
    const ts = worst(d, 'w2cut', 'Cut of lines 0-15', sel16, (dd) => { if (dd.S > 2048 || dd.top !== 0) throw new Error(`set-up: S ${dd.S}, top ${dd.top}`); return mk(dd, 1); });
    row('Cut of lines 0-15 (about 1,280 codes) of a 40-line document, top 0, WR_MENU E_MENU 2, 1 (12.8: EST about 1.1 M)', Math.max(...ts), 1_100_900, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}; ${d.nl} lines`);
    let clipLen = 0;
    const ts2 = worst(d, 'w2paste', 'Paste of 1,280 codes', (dd) => { sel16(dd); mk(dd, 2); keys(dd, [8, 10, 10, 10, 10, 10]); clipLen = dd.clip.length; }, (dd) => mk(dd, 3));
    row('Paste of the clipboard (about 1,280 codes) at the start of line 5 of a 40-line document, WR_MENU E_MENU 2, 3 (12.8)', Math.max(...ts2), 1_825_600, `the owner's bound (WRITE 12.13); worst of ${ts2.join(', ')}; ${clipLen} codes`);
  }
  // ---- Select all of a 5,120-code document, the caret at 0
  {
    let t = null; for (let tries = 0; tries < 20 && !t; tries++) { const c = new WM.Doc(WM.genText(rng, WM.CAP, { para: 0.02 })); if (c.nl <= 1024) { t = c; } }
    t.caret = t.L; t.top = null;
    const prep = (dd) => {
      W.emulateBar(env, 0); W.sendRec(env, o.tv, [E.SCROLL, 0, 2, 0], { ints: false }); dd.scrollTo(0);
      dispPt(E.DOWN, 27, 31); dd.click(27, 31); dispPt(E.UP, 27, 31, 0);      // px 27: r = 0, position 0 (a click at 30 would land after a glyph of 7 or more)
    };
    const ts = worst(t, 'w2all', 'Select all of 5,120 codes', prep, (dd) => { if (dd.caret !== 0 || dd.L !== WM.CAP) throw new Error(`set-up: caret ${dd.caret}, length ${dd.L}`); return mk(dd, 4); });
    row('Select all of a 5,120-code document, the caret at 0, WR_MENU E_MENU 2, 4 (12.8)', Math.max(...ts), 1_473_900, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}`);
  }
  // ---- W_DRAWVIEW of 16 lines, all selected
  {
    const d = paragraph(16); d.top = 0; d.caret = 0;
    const dd = prepared(d, 'w2draw', (x) => { mk(x, 4); });
    const ts = [];
    for (let i = 0; i < 3; i++) { const r = T.runCall(env, S.W_DRAWVIEW, { ix: o.tv }, { ints: false }); ts.push(r.t); diTotal += r.di; }
    const g = W.liveDiff(env, dd, {});
    row('W_DRAWVIEW of 16 lines of about 80 codes, all selected, focused (12.8: W1\'s 950 k plus 16 fills)', Math.max(...ts), 1_179_400, `the owner's bound (WRITE 12.13); worst of ${ts.join(', ')}; ${dd.L} codes; screen ${g === null ? 'equals the model' : 'DIFFERS: ' + g}`);
    if (g !== null) missed++;
  }
  // ---- stack
  {
    let worstE = { v: 0, what: '' }, worstD = { v: 0, what: '' }, worstM = { v: 0, what: '' };
    for (const [name, d] of [['a 16-line paragraph', (() => { const p = paragraph(16); p.caret = 0; p.top = 0; return p; })()], ['40 lines', (() => { const p = paragraph(40); p.caret = p.starts[15] + 10; p.top = 0; return p; })()]]) {
      const dd = setup(d.clone());
      for (const code of [18, 9, 9, 10, 10, 11, 8, 18, 10, 10, 18, 10, 10, 10, 10, 12, 18, 9, 120, 18, 11, 11, 10]) {
        if (dd.run !== null && !WM.Doc.consumes(code)) continue;
        const r = W.sendRec(env, o.tv, W.keyRec(code), { ints: false }); diTotal += r.di; dd.key(code);
        if (r.stack - 2 > worstE.v) worstE = { v: r.stack - 2, what: `${name}, key ${code}` };
      }
      T.poke16(env, S.K_CAPTURE, o.tv);
      for (const [px, py] of [[100, 40], [300, 100], [471, 169], [10, 10]]) {
        const r = W.sendRec(env, o.tv, W.ptRec(E.MOVE, px, py, 1), { ints: false }); diTotal += r.di; dd.drag(px, py);
        if (r.stack - 2 > worstE.v) worstE = { v: r.stack - 2, what: `${name}, E_MOVE (${px}, ${py})` };
      }
      T.poke16(env, S.K_CAPTURE, 0);
      W.focusTv(env);
      const r = W.sendDraw(env, o.tv); diTotal += r.di; if (r.stack - 2 > worstD.v) worstD = { v: r.stack - 2, what: `${name}, selection ${dd.S}` };
      for (const item of [4, 2, 3, 1, 3]) {
        if (!dd.editEnabled()[item === 4 ? 4 : item - 1] || (item === 3 && dd.run !== null && !dd.pasteOk())) continue;
        const r2 = mk(dd, item); if (r2.stack > worstM.v) worstM = { v: r2.stack, what: `${name}, item ${item}` };
      }
    }
    row('stack of the text view\'s M_EVENT with the selection (MARK, caret keys, a drag), crossings included, bytes below T_SEND\'s own return', worstE.v, 128, worstE.what);
    row('stack of the text view\'s M_DRAW with a selection, crossings included', worstD.v, 128, worstD.what);
    row('stack of WR_MENU (Cut, Copy, Paste, Select all), crossings included, bytes below its return', worstM.v, 128, worstM.what);
  }
}

// ===== W3 (docs/WRITE.md 13.6) ===========================================================================================================================================================
// Save of 5,120 codes and Open of 5,120 codes in 80 lines, measured as direct calls under mapping A with a sentinel return, interrupts on, against web/fshost.js's fake host (files in a Map):
//   * Save: the Save dialog's command (the label wr_dkcmd, A = WR_DK = 1, K_EV = the E_CMD record of the "Save" button) from the call to the return: the dialog closed and the window under it repainted, FS_OPEN, one FS_WRITE
//     (the caret at 0) or two (the caret in the middle: the codes before the gap, then after it), FS_CLOSE, the name and the title row made dirty.  The write of the bytes itself is FS_WRITE's own 5,120 x 50 T (tests/fs-f1.mjs).
//   * Open: WR_MENU (E_MENU 1, 2) with the pick answered at its first HALT; measured from FS_OPEN's entry (14 T after FS_PICK returned: `ld hl, WR_PNAME` and `xor a`) to WR_MENU's return, which is after the view is drawn
//     (the title row is redrawn later by the window manager's E_REDRAW, not included): FS_OPEN, FS_READ of 5,120 codes, the emptied document, the paste with its line count, the name, the bar, the full draw.
let w3ok = true;
try { for (const n of ['WR_MENU', 'FS_OPEN', 'FS_READ', 'FS_WRITE', 'FS_BEGIN', 'FS_END', 'wr_dkcmd', 'WR_DK', 'WR_NAME']) if (S[n] === undefined) throw new Error(`desk5 does not define ${n}`); }
catch (e) { w3ok = false; missed++; console.log(`FAIL | W3 rows not measured: ${e.message}`); }
if (w3ok) {
  const { snapshot, restore } = await import('./review-lib.mjs');
  const host = makeHost(); m.host = host;
  const BASE_W2 = 5564;                                                       // WRITE 12.11: Write's bytes after W2
  { const total = S.WR_END - S.WR_START;
    row('Write\'s bytes in DOCK 2-3 for W3: WR_END - WR_START less W2\'s 5,564 (13.6 EST +600-800; all of Write <= 7,000)', total - BASE_W2, null, `total ${total}; the all-of-Write bound of 7,000 is ${total <= 7000 ? 'not exceeded' : 'EXCEEDED'}; files.asm (FS_END - FS_BEGIN) ${S.FS_END - S.FS_BEGIN} bytes after it`);
    row('RAM image after W3: WR_IMG_LEN', S.WR_IMG_LEN, 1024, 'unchanged bound'); }
  // a document of 5,120 codes in 80 display lines: 80 paragraphs of 63 codes and the paragraph end, each line within the text width
  let codes80 = null;
  for (let tries = 0; tries < 400 && !codes80; tries++) {
    const cs = [];
    for (let p = 0; p < 80 && cs.length <= 5120; p++) {
      for (let k = 0; k < 63; k++) cs.push(k % 9 === 8 ? 32 : rng.pick(WM.codesOf('abcdefghijklmnopqrstuvwxyz')));
      cs.push(13);
    }
    const d = new WM.Doc(cs);
    if (d.L === 5120 && d.nl === 81) codes80 = cs;                           // 80 paragraph ends: the last line is the empty line after the final 13
  }
  if (!codes80) throw new Error('no 5,120-code document of 80 lines');
  const file80 = codes80.map((c) => (c === 13 ? 10 : c));
  const lines80 = new WM.Doc(codes80).nl;
  const diAdd = (r) => { diTotal += r.di; };
  host.files.set('perf80.txt', Uint8Array.from(file80));
  const openOnce = () => {
    W.resetDoc(env);
    let tFsOpen = null; const t0 = m.tstates;
    const r = W.menuCall(env, 1, 2, { ints: true, onHalt: () => { host.answer('perf80.txt', file80); }, hooks: { [S.FS_OPEN]: () => { if (tFsOpen === null) tFsOpen = m.tstates; } } });
    diAdd(r);
    if (r.badSp !== undefined || r.preserved.length) { missed++; console.log(`FAIL | WR_MENU Open...: SP / registers not kept (${r.badSp !== undefined ? 'SP ' + hex(r.badSp) : r.preserved.join(',')})`); }
    return { total: r.t, fromOpen: t0 + r.t - tFsOpen, r };
  };
  const os = [openOnce(), openOnce(), openOnce()];
  { const d = new WM.Doc(codes80), s = W.stateDiff(env, d), a = [...s.doc, ...s.lt, ...s.bar];
    if (a.length) { missed++; console.log(`FAIL | Open of the 5,120-code file: the state differs from the model: ${a[0]}`); }
    const nm = Array.from(m.ram.subarray(S.WR_NAME + 1, S.WR_NAME + 1 + m.ram[S.WR_NAME]));
    if (WM.textOf(nm) !== 'perf80.txt') { missed++; console.log(`FAIL | Open: the name is ${JSON.stringify(WM.textOf(nm))}`); } }
  row('Open of 5,120 codes in 80 lines: from FS_OPEN\'s entry (FS_PICK\'s return + 14 T) to WR_MENU\'s return, the view drawn (13.6)', Math.max(...os.map((x) => x.fromOpen)), null, `report; worst of ${os.map((x) => x.fromOpen).join(', ')}; the whole WR_MENU call (from E_MENU: the screen repainted before the pick) ${Math.max(...os.map((x) => x.total)).toLocaleString('en')}; ${lines80} lines`);
  // Save: from the loaded document (caret 0: one write), and with the caret in the middle (two writes)
  const saveRows = [];
  for (const [label, caretWhere] of [['caret 0 (one write)', 0], ['caret in the middle (two writes)', 1]]) {
    W.resetDoc(env);
    W.menuCall(env, 1, 2, { ints: true, onHalt: () => { host.answer('perf80.txt', file80); } });
    let d = new WM.Doc(codes80);
    if (caretWhere) { const r = W.dispatch(env, W.ptRec(E.DOWN, 100, 30 + 9 * 8 + 4, 1), { ints: true }); diTotal += r.di; W.dispatch(env, W.ptRec(E.UP, 100, 30 + 9 * 8 + 4, 0), { ints: true }); d.click(100, 30 + 9 * 8 + 4); }
    W.menuCall(env, 1, 3, { ints: true });                                   // the Save dialog (not measured here)
    const snap = snapshot(m), ts = [];
    for (let i = 0; i < 3; i++) {
      restore(m, snap); host.saves.length = 0; host.log.length = 0;
      T.setEv(env, [E.CMD, 1, 0, 0]);
      const r = T.runCall(env, S.wr_dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true });
      ts.push(r.t); diAdd(r);
      if (r.badSp !== undefined) { missed++; console.log('FAIL | Save: SP not kept'); }
    }
    const writes = host.log.filter((c) => c.n === 4).map((c) => c.bytes.length - 2), sv = host.saves[host.saves.length - 1];
    const want = d.caret > 0 ? [d.caret, d.L - d.caret] : [d.L];
    const saved = sv && sv.bytes.length === 5120 && sv.bytes.every((b, i) => b === file80[i]);
    if (!saved || JSON.stringify(writes) !== JSON.stringify(want)) { missed++; console.log(`FAIL | Save (${label}): the host got ${sv ? sv.bytes.length : 'no'} bytes in writes ${JSON.stringify(writes)}, want 5,120 in ${JSON.stringify(want)}; equal ${saved}`); }
    saveRows.push({ label, ts, writes });
  }
  const worstSave = Math.max(...saveRows.flatMap((x) => x.ts));
  row('Save of 5,120 codes: from "Save"\'s E_CMD (the dialog command wr_dkcmd, A = 1, K_EV = E_CMD id 1) to the return: the dialog closed and repainted, FS_OPEN, FS_WRITE of 5,120 codes, FS_CLOSE, the name (13.6)', worstSave, null, `report; ${saveRows.map((x) => `${x.label}: worst of ${x.ts.join(', ')} (writes ${JSON.stringify(x.writes)})`).join('; ')}; the 5,120 byte writes alone are about 256 k T (fs-f1)`);
  // stack of the W3 paths (WRITE 13.6: <= 128), measured over the calls above with a fresh run of each
  {
    let worst = 0, what = '';
    const nt = (r, w) => { if (r.stack > worst) { worst = r.stack; what = w; } };
    W.resetDoc(env);
    nt(W.menuCall(env, 1, 2, { ints: true, onHalt: () => { host.answer('perf80.txt', file80); } }), 'Open 5,120');
    nt(W.menuCall(env, 1, 3, { ints: true }), 'Save...');
    T.setEv(env, [E.CMD, 1, 0, 0]); nt(T.runCall(env, S.wr_dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }), 'Save 5,120');
    host.files.set('big.txt', Uint8Array.from(new Array(6000).fill(65)));
    nt(W.menuCall(env, 1, 2, { ints: true, onHalt: () => { host.answer('big.txt', new Array(6000).fill(65)); } }), 'Open too long (alert)');
    row('stack of the W3 paths (WR_MENU Open... / Save..., the dialog command, the alert), crossings included, bytes below the return', worst, 128, what);
  }
}

row('DI executed over every stepped call above', diTotal, 0, 'a DI is seen when interrupts are on and IFF1 drops during a step');
row('frame interrupts lost over the measuring machine\'s normal frames', env.vf.bad, 0, `${env.vf.checked} frames checked; memory watch: ${env.w.summary()}`);
if (env.w.n) missed++;

const c = (s) => rows.filter((r) => r.status === s).length;
console.log(`wr-perf: ${c('pass')} pass, ${c('MISSED')} missed, ${c('reported')} reported${missed - c('MISSED') ? `, ${missed - c('MISSED')} other failure(s)` : ''}`);
if (missed) process.exitCode = 1;
