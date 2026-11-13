"use strict";
// wr-perf.mjs -- Write W1's bounds, docs/WRITE.md section 7, measured as 11.8 says, as a table, on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt).
// Written from the contract only (never from src/apps/write.asm).  T-states are TSRun's (no memory contention); direct calls under mapping K with a sentinel return; interrupts ON for the
// K_DISPATCH rows (WRITE 7: "interrupts on for dispatch rows"), off for W_DRAWVIEW and the stack rows.  Each figure is the worst of three, the text view focused, the window in front.
//   node tests/wr-perf.mjs [--seed N]
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.  A missed bound is reported with its numbers and nothing is changed (WRITE preamble).
import * as W from './wr-lib.mjs';
import * as H from './shell-lib.mjs';

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
  row('scroll by one line: 40 lines, top 0, the caret on line 15, K_DISPATCH of E_KEY DOWN (11.8; the bound is set from the measurement, as List\'s: TOOLKIT 10.10)', Math.max(...ts), null, `report (EST 190 k); worst of ${ts.join(', ')} (${d.nl} lines)`);
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
  row('scroll by one line by a bar arrow: K_DISPATCH of the E_DOWN on the down arrow, the loop ended by an E_UP at its first HALT (the bar redrawn and the text view told)', Math.max(...ts), null, `report; worst of ${ts.join(', ')}`);
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
row('DI executed over every stepped call above', diTotal, 0, 'a DI is seen when interrupts are on and IFF1 drops during a step');
row('frame interrupts lost over the measuring machine\'s normal frames', env.vf.bad, 0, `${env.vf.checked} frames checked; memory watch: ${env.w.summary()}`);
if (env.w.n) missed++;

const c = (s) => rows.filter((r) => r.status === s).length;
console.log(`wr-perf: ${c('pass')} pass, ${c('MISSED')} missed, ${c('reported')} reported${missed - c('MISSED') ? `, ${missed - c('MISSED')} other failure(s)` : ''}`);
if (missed) process.exitCode = 1;
