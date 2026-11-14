"use strict";
// wr-w2.mjs -- Write slice W2 (selection and clipboard, docs/WRITE.md 12; sections 1-11 are W1) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// 12.9 items 1-4 (the bounds are tests/wr-perf.mjs, the cross-emulator rows tools/xemu/).  Written from the contract only (WRITE 1-12, TOOLKIT 10.4, OBJECTS_EVENTS 14.3, WINDOWS 8 / 18);
// src/apps/write.asm, src/apps/shell.asm and src/kernel/*.asm were never read.  The reference is tests/wr-model.mjs; the harness tests/wr-lib.mjs (Drv2 and the W2 section).
//   node tests/wr-w2.mjs [--seed N] [--nseq N] [--nsteps N] [--ncover N] [--nclip N] [--only LIST] [--verbose]
//     --nseq N     random documents in the editing groups 1-4 (default 28), --nsteps N steps on each (default 40)
//     --ncover N   covering windows in group 3b (default 8), each with 20 steps;  --nclip N  random clips in group 3c (default 100)
//     --only LIST  groups: 0 the model's hand cases, 1 selection state / document / bar (random steps), 2 the clipboard (random steps), 3 screen (3 = the random steps, 3b covered windows,
//                  3c M_DRAW under a clip with a selection, 3d a scripted tour of the drawing modes), 4 the menu: enabled bits (random steps), a disabled item clicked, the drop-down's look,
//                  5 the limits (selections of 2,048 / 2,049, Paste's 5,120 / 1,024-line refusals, typing over a selection at 1,024 lines and at 5,120 codes), 6 consumed (M_EVENT direct),
//                  7 real frames: MARK and the caret keys, drags by the pointer, the Edit menu by pointer and keys, the clipboard through "New" and a new start, the modal dialog, 8 stack / DI /
//                  registers (WR_MENU too), 9 memory watch (default all).  Groups 1-4 share one run of random steps (a failure is attributed to the group of the thing that differed).
// The last line is "wr-w2: N of M groups pass"; exit code 1 on any failure.  Without a W2 build the suite stops with a message naming the missing symbols.
//
// Readings of the contract (CONTRACT? comments; the generators stay away from what the contract does not settle):
//  C1. MARK (18) is consumed and ends an UP / DOWN run.  C2. A refused insert with no selection, and a DELETE at 0 with no selection, change nothing at all: the mark stays on (the generators never
//  do either with the mark on).  C3. A drag ends a run.  C4. Every Edit action that takes effect ends a run (coordinator); a refused Paste on a live run is not generated.  C5. A refused Paste changes nothing.
//  C6. WR_MENU is called under mapping A (it is code in DOCK 2-3).  C7. Cut / Copy write only the first C bytes of $7800-$7FFF.  C8. No-op keys / menu items while the caret is off the lines shown:
//  whether the view follows is not settled (W1's R5): the generators skip them.
import * as W from './wr-lib.mjs';
import { layoutOf } from './wm-model3.mjs';
import { openLook as drawOpen } from './look-model.mjs';
import { readDisp, diffDisp } from './wm-lib.mjs';

const { L, T, X, WM, hex, rd16, E } = W;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NSEQ = argNum('--nseq', 28), NSTEPS = argNum('--nsteps', 40), NCOVER = argNum('--ncover', 8), NCLIP = argNum('--nclip', 100);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['0', '1', '2', '3', '3b', '3c', '3d', '4', '5', '6', '7', '8', '9'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('wr-w2', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NSEQ} documents x ${NSTEPS} steps, ${NCOVER} covers, ${NCLIP} clips`);
const envs = [];
const newEnv = () => { const e = W.bootWrite2({ rng }); envs.push(e); return e; };
const LET = WM.codesOf('abcdefghijklmnopqrstuvwxyz');
const PRINT = (() => { const o = []; for (let c = 32; c <= 126; c++) o.push(c); return o; })();
const isIns = (c) => (c >= 32 && c <= 126) || c === 13;
const fails = (...secs) => secs.reduce((n, s) => n + s.nf, 0);
const TV = WM.TVR;

// ===========================================================================================================================
// 0. The model's own hand-worked cases (12.9 item 1)
let cartOk = true;
if (has('0')) {
  const sec = new Sec('0 wr-model hand cases (W1: 11.4 wrapping, 11.5 caret / UP / DOWN / click / shown / bar, the limits, the looks; W2: every cell of 12.4\'s table, the pointer rules, Cut / Copy / Paste / Select all, the enabled bits, Paste\'s 5,120-code and 1,024-line refusals, selections of 2,048 and 2,049 codes, 12.3\'s selection pixels incl. the x1 = 472 rule and the clamps at 471 / 472)');
  const out = []; const bad = WM.selfTest(out);
  sec.n = out.length; sec.nf = bad;
  for (const l of out) if (l.startsWith('FAIL')) sec.fails.push(l);
  sec.end(`${out.length} cases`);
}
// the cartridge must be a W2 build: stop with a clear message otherwise
if (ONLY.some((g) => g !== '0')) {
  try { const S = L.loadDesk5().S; W.needWr(S); W.needWr2(S); } catch (e) {
    cartOk = false;
    const sec = new Sec('cartridge: build/desk5 is a Write W2 build'); sec.ok(false, e.message); sec.end();
  }
}

// ===========================================================================================================================
// The action generator
function applyTo(c, a) {
  if (a.k === 'key') return W.Doc_key(c, a.code);
  if (a.k === 'click') return c.click(a.px, a.py);
  if (a.k === 'drag') { c.click(a.down[0], a.down[1]); for (const [px, py] of a.moves) c.drag(px, py); return true; }
  if (a.k === 'menu') return c.menuItem(a.item);
  if (a.k === 'scroll') return c.scrollTo(a.v);
  if (a.k === 'bar') { const p = W.barPlan(c, a.part, a.py2); if (!p) return false; p.tells.forEach((v) => c.scrollTo(v)); return true; }
  return false;
}
const WEIGHTS = {
  typing: { letter: 30, space: 7, enter: 5, del: 6, left: 4, right: 4, up: 3, down: 3, mark: 5, click: 3, drag: 4, menu: 6, scroll: 1, bar: 1, other: 1 },
  edit: { letter: 9, space: 3, enter: 3, del: 5, left: 8, right: 8, up: 6, down: 6, mark: 10, click: 6, drag: 9, menu: 11, scroll: 2, bar: 2, other: 1 },
};
const wpick = (w) => { const tot = Object.values(w).reduce((a, b) => a + b, 0); let r = rng.next() * tot; for (const [k, v] of Object.entries(w)) { if ((r -= v) < 0) return k; } return 'letter'; };
const pt = () => [rng.chance(0.15) ? rng.pick([24, 25, 26, 27, 28, 470, 471]) : rng.int(24, 471), rng.chance(0.2) ? rng.int(150, 173) : rng.int(30, 173)];
const movePt = () => [rng.chance(0.25) ? rng.int(0, 511) : rng.int(24, 471), rng.chance(0.3) ? rng.int(8, 191) : rng.int(30, 173)];
function pickMenu(doc) {
  const en = doc.editEnabled(), w = [];
  if (en[0]) w.push([1, 2]); if (en[1]) w.push([2, 3]); if (en[2]) w.push([3, doc.clip.length ? 4 : 1]); w.push([4, 1]);
  const tot = w.reduce((a, [, x]) => a + x, 0); let r = rng.next() * tot;
  for (const [it, x] of w) { if ((r -= x) < 0) return it; }
  return 4;
}
function pickAction2(doc, mode) {
  for (let tries = 0; tries < 80; tries++) {
    const kind = wpick(WEIGHTS[mode === 'typing' ? 'typing' : 'edit']);
    let a;
    switch (kind) {
      case 'letter': a = { k: 'key', code: rng.chance(0.85) ? rng.pick(LET) : rng.pick(PRINT) }; break;
      case 'space': a = { k: 'key', code: 32 }; break;
      case 'enter': a = { k: 'key', code: 13 }; break;
      case 'del': a = { k: 'key', code: 12 }; break;
      case 'left': a = { k: 'key', code: 8 }; break;
      case 'right': a = { k: 'key', code: 9 }; break;
      case 'up': a = { k: 'key', code: 11 }; break;
      case 'down': a = { k: 'key', code: 10 }; break;
      case 'mark': a = { k: 'key', code: 18 }; break;
      case 'click': { const [px, py] = pt(); a = { k: 'click', px, py }; break; }
      case 'drag': {
        const moves = []; const n = rng.int(1, 4);
        for (let i = 0; i < n; i++) moves.push(movePt());
        if (rng.chance(0.3)) { const [dx, dy] = pt(); moves.push([dx, Math.min(173, dy + 9)]); }     // a one-line step at the same x
        a = { k: 'drag', down: pt(), moves }; break;
      }
      case 'menu': a = { k: 'menu', item: pickMenu(doc) }; break;
      case 'scroll': if (doc.run !== null) continue; a = { k: 'scroll', v: rng.int(0, doc.bar().max) }; break;
      case 'bar': if (doc.run !== null) continue; a = { k: 'bar', part: rng.pick(['up', 'down', 'pgup', 'pgdn', 'thumb']), py2: rng.int(38, 170) }; break;
      default: if (doc.run !== null) continue; a = { k: 'key', code: rng.pick([14, 15, 27, 3, 0, 5, 17, 127, 128, 200, 255, 31, 19])   /* not 16 (MENU): it starts the kernel's keyboard menu tracking, a HALT loop; group 7 drives it through real frames */ };
    }
    // the contract does not settle these: not generated (see the CONTRACT? list in the header)
    if (a.k === 'menu' && a.item === 3 && doc.run !== null && !doc.pasteOk()) continue;                                // C4: a refused Paste on a live run (does it end the run?)
    if (a.k === 'key' && doc.mark === 1 && doc.S === 0 && ((isIns(a.code) && !doc.canInsert()) || (a.code === 12 && doc.caret === 0))) continue;   // C2
    const c = doc.clone(); applyTo(c, a);
    const ln = doc.caretLine(), off = ln < doc.top || ln >= doc.top + WM.NSHOWN;
    if (off && (a.k === 'key' || a.k === 'menu') && c.caret === doc.caret && c.L === doc.L && c.anchor === doc.anchor) continue;   // C8
    if (off && a.k === 'key' && !isIns(a.code) && c.caret === doc.caret && c.L === doc.L) continue;                    // W1's R5
    if (a.k === 'bar' && !W.barPlan(doc, a.part, a.py2)) continue;
    return a;
  }
  return { k: 'key', code: 97 };
}
function perform(drv, a) {
  switch (a.k) {
    case 'key': return drv.key(a.code);
    case 'click': return drv.click(a.px, a.py);
    case 'drag': return drv.drag(a.down, a.moves);
    case 'menu': return drv.menuItem(a.item);
    case 'scroll': return drv.scroll(a.v);
    case 'bar': return drv.barClick(a.part, a.py2);
    default: return null;
  }
}
const sizes = [0, 0, 12, 60, 150, 300, 450, 700, 1000];
const st = { steps: 0, sels: 0, marks1: 0, cuts: 0, copies: 0, pastes: 0, alls: 0, drags: 0, maxLines: 0, big: 0 };
/** Type `target` into a fresh machine (W.loadDoc), check it, and run `nSteps` random steps; stops the sequence at the first failing step. */
function runSequence(drv, target, nSteps, mode) {
  const env = drv.env, doc = W.loadDoc(env, target);
  drv.doc = doc;
  drv.trail = []; drv.verify(`typed ${doc.L} codes`);
  if (drv.total() > 0) return false;
  for (let i = 0; i < nSteps; i++) {
    const n0 = drv.total();
    const a = pickAction2(doc, mode);
    perform(drv, a);
    st.steps++; if (doc.S > 0) st.sels++; if (doc.mark) st.marks1++;
    if (a.k === 'menu') { if (a.item === 1) st.cuts++; else if (a.item === 2) st.copies++; else if (a.item === 3) st.pastes++; else st.alls++; }
    if (a.k === 'drag') st.drags++;
    if (doc.nl > st.maxLines) st.maxLines = doc.nl;
    if (drv.total() > n0) return false;
  }
  return true;
}

// ===========================================================================================================================
// 1-4. The random steps (12.9 items 2-4): text, caret, anchor, mark, clipboard, changed, top, the bar, the looks, the enable bits, after each step
const s1 = new Sec('1 selection state and document: random editing with MARK, LEFT / RIGHT / UP / DOWN (12.4\'s table), typing / ENTER / DELETE over a selection, clicks with and without the mark (a click extends while the mark is on), drags (E_DOWN, E_MOVE with the capture clamped to the lines shown, E_UP), Cut, Copy, Paste, Select all, E_SCROLL and the bar, through K_DISPATCH / WR_MENU on documents of 0-1,000 codes typed into a fresh machine; the text (gap buffer), caret, WR_AN, WR_MK, WR_CHG, WR_TOP, the line table, the bar and K_FOCUS / K_CAPTURE read back after each step');
const s2 = new Sec('2 the clipboard: WR_CLN and the codes at $7800 against the model after each step (Cut and Copy write them, Paste reads them, "New" keeps them), and $7800-$7FFF written only by Cut and Copy (nothing else touches it)');
const s3 = new Sec('3 screen: the window\'s rectangle against wr-model\'s rendering after each step (12.3: the selection\'s XOR fill after the text, the caret only when the selection is empty), the pixels outside Write\'s window unchanged');
const s4 = new Sec('4 the menu: the Edit entry\'s enable bits (kernel MB_ENT + ME_SIZE x 1 + ME_EN, bit n - 1 - k) equal the model\'s after each step (Cut / Copy: 1 <= S <= 2,048; Paste: C >= 1; Select all always; the separator never), the File entry\'s New always');
if (cartOk && ['1', '2', '3', '4'].some(has)) {
  const env = newEnv(); W.parkDirect(env);
  const secs = { doc: s1, lt: s1, bar: s1, sel: s1, scr: s3, clip: s2, menu: s4 };
  const drv = new W.Drv2(env, secs, new WM.Doc());
  runSequence(drv, new WM.Doc(), Math.max(NSTEPS, 80), 'typing');
  for (let i = 0; i < NSEQ && fails(s1, s2, s3, s4) < 12; i++) {
    const n = rng.pick(sizes), doc = W.randomDoc(rng, n);
    if (rng.chance(0.2)) doc.top = Math.min(doc.caretLine(), doc.top + 3);
    runSequence(drv, doc, NSTEPS, i % 3 === 0 ? 'typing' : 'edit');
  }
  const t = drv.stat;
  s1.note(`${st.steps} steps: ${t.keys} keys (${t.marks} MARK, ${t.noops} that changed nothing), ${t.clicks} clicks, ${t.drags} drags, ${t.menus} menu items (${st.cuts} Cut, ${st.copies} Copy, ${st.pastes} Paste of which ${t.pastesRefused} refused, ${st.alls} Select all), ${t.scrolls} E_SCROLL, ${t.barClicks} bar clicks; ${st.sels} steps ended with a selection, ${st.marks1} with the mark on; the longest document had ${st.maxLines} lines`);
}
if (cartOk && has('1')) s1.end();
if (cartOk && has('2')) s2.end();
if (cartOk && has('3')) s3.end();
if (cartOk && has('4')) s4.end();

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3b. A plain Window over Write: the draws of the selection stay inside the visible part
if (cartOk && has('3b')) {
  const sec = new Sec('3b covered window: a plain Window over part of Write while the text view has a selection and steps (MARK, caret keys, typing over it, drags are not sent: a press raises the window behind) are made: each step\'s draws leave the cover alone and the rest of Write equals the model (inactive look, no close box); the cover closed, Write is whole again');
  const env = newEnv(); W.parkDirect(env);
  const secs = { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec };
  const drv = new W.Drv2(env, secs, new WM.Doc());
  let ok = 0, skipped = 0;
  for (let i = 0; i < NCOVER && sec.nf < 8; i++) {
    const cx = 16 * rng.int(9, 22), cy = 8 * rng.int(4, 14), rect = { x: cx, y: cy, w: 16 * rng.int(5, Math.min(13, (512 - cx) / 16)), h: 8 * rng.int(5, Math.min(12, (192 - cy) / 8)) };
    const doc = W.loadDoc(env, W.randomDoc(rng, rng.pick([100, 300, 600])));
    drv.doc = doc; drv.trail = []; drv.covers = []; drv.verify('typed');
    for (const c of [18, 10, 10, 9, 9, 9]) drv.key(c);                              // a selection over a few lines, then the cover
    const cover = W.openCover(env, rect, 'Cover');
    if (!cover) { skipped++; sec.note('W_OPEN of the covering window failed (arena?)'); continue; }
    if (rd16(env.m, env.S.K_FOCUS) !== W.objs(env).tv) { skipped++; sec.note('K_SETFOCUS did not give the text view the focus while it is behind a plain Window: covered steps skipped'); W.closeCover(env, cover); continue; }
    drv.covers = [cover];
    W.drawTv(env);
    drv.trail = []; drv.verify(`cover (${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}) over ${doc.L} codes, selection ${doc.S}`);
    for (let k = 0; k < 20 && sec.nf < 8; k++) {
      const a = pickAction2(doc, k % 2 ? 'edit' : 'typing');
      if (a.k === 'click' || a.k === 'bar' || a.k === 'drag') continue;
      const n0 = drv.total(); perform(drv, a); if (drv.total() > n0) break;
    }
    W.closeCover(env, cover); drv.covers = [];
    drv.verify('the cover closed');
    ok++;
  }
  sec.end(`${ok} covers (${skipped} skipped), ${drv.stat.steps} steps`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3c. M_DRAW under a random clip with a selection: the same pixels as a full draw (every drawing mode's pixels are those of the full draw)
/** A selection made by real steps on `drv` (a random one of: MARK and caret keys, a drag, Select all). */
function makeSelection(drv) {
  const k = rng.int(0, 3), doc = drv.doc;
  if (k === 0) { drv.mark(); for (let i = rng.int(1, 40); i > 0; i--) drv.key(rng.pick([9, 9, 9, 10, 8])); }
  else if (k === 1) drv.drag(pt(), [movePt(), movePt()]);
  else if (k === 2 && doc.L > 0) { drv.menuItem(4); }
  else { drv.mark(); for (let i = rng.int(1, 5); i > 0; i--) drv.key(rng.pick([10, 10, 11])); }
}
if (cartOk && has('3c')) {
  const sec = new Sec('3c M_DRAW of the text view under a random clip with a selection (W_DRAWVIEW gives one per visible rectangle): the display equals the model\'s full draw inside the clip (selection XOR after the text, no caret while the selection is not empty), GCLIP put back; focused and not');
  const env = newEnv(); W.parkDirect(env);
  const { S } = env, o = W.objs(env);
  const drv = new W.Drv2(env, { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec }, new WM.Doc());
  let n = 0, withSel = 0;
  for (let i = 0; i < NCLIP && sec.nf < 8; i++) {
    if (i % 10 === 0) {
      drv.doc = W.loadDoc(env, W.randomDoc(rng, rng.pick([120, 300, 700]))); drv.trail = []; drv.verify('typed');
      for (let k = 0; k < 3; k++) makeSelection(drv);
    }
    if (i % 5 === 4) { makeSelection(drv); if (rng.chance(0.4)) drv.key(rng.pick([18, 8, 9])); }
    const doc = drv.doc; if (doc.S > 0) withSel++;
    const foc = rng.chance(0.6);
    if (foc) W.focusTv(env); else T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
    const x0 = rng.int(TV.x - 10, TV.x + TV.w - 1), y0 = rng.int(TV.y - 6, TV.y + TV.h - 1);
    const clip = rng.chance(0.2) ? [TV.x, TV.y, TV.w, TV.h] : [x0, y0, rng.int(1, 160), rng.int(1, 70)];
    X.drawUnderClip(env, sec, `${W.describe(doc)}, selection ${doc.S}, focus ${foc}, clip ${clip}`, { addr: o.tv }, (g) => WM.tvLook(g, doc, foc), clip);
    W.focusTv(env);                                         // the steps that follow run with the focus on the text view (an unfocused draw left K_FOCUS = 0)
    n++;
  }
  W.focusTv(env);
  sec.end(`${n} clips (${withSel} with a selection)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3d. A scripted tour of the drawing modes (12.1: "selection" is a drawing mode; each must equal a full draw): the selection grown and shrunk inside a line, over lines, flipped across the anchor,
//     cleared, replaced by a drag, extended by a click, covering a wrap, deleted, typed over; the model's screen after every step
if (cartOk && has('3d')) {
  const sec = new Sec('3d the drawing modes of the selection (caret only, one line from x, lines, selection, scroll) on a scripted tour: grow within a line, shrink, grow over lines, cross the anchor, clear with MARK, drag down and back, click-extend with the mark on, Select all, Cut, Paste, typing over a selection; every step\'s screen equals the model\'s full draw');
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv2(env, { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec }, new WM.Doc());
  const t0 = new WM.Doc(WM.genText(rng, 1100, { para: 0.01 })); t0.caret = 0; t0.top = 0;
  const doc = W.loadDoc(env, t0, 'tour'); drv.doc = doc; drv.trail = [];
  drv.verify('the tour document');
  const run = (label, f) => { const n0 = drv.total(); drv.trail.length = 0; f(); if (drv.total() > n0) throw new Error(`${label} failed`); };
  const K = (code, n = 1) => { for (let i = 0; i < n; i++) drv.key(code); };
  try {
    drv.scroll(0); drv.click(80, 31);
    run('grow in a line', () => { drv.mark(); K(9, 12); });
    run('shrink', () => K(8, 5));
    run('grow over lines', () => K(10, 3));
    run('cross the anchor', () => K(11, 7));
    run('clear with MARK', () => drv.mark());
    run('mark again, a click extends', () => { drv.mark(); drv.click(300, 100); drv.click(60, 150); });
    run('clear', () => drv.mark());
    run('drag down over the whole view and back', () => drv.drag([30, 31], [[200, 60], [471, 173], [300, 190], [100, 100], [27, 30]]));
    run('keys over a drag selection', () => { K(9); K(11); K(10); });
    run('drag again, then LEFT / RIGHT collapse it', () => { drv.drag([100, 50], [[350, 120]]); K(8); drv.drag([100, 50], [[350, 120]]); K(9); });
    run('Select all, Copy, Cut of the part, Paste', () => { drv.menuItem(4); drv.drag([60, 40], [[400, 90]]); drv.menuItem(2); drv.menuItem(1); drv.menuItem(3); drv.menuItem(3); });
    run('typing over a selection, DELETE of one, ENTER over one', () => { drv.mark(); K(9, 9); K(120); drv.mark(); K(11, 2); K(12); drv.mark(); K(10, 2); K(13); });
    run('the bar scrolls with a selection kept', () => { drv.drag([60, 40], [[400, 140]]); drv.scroll(rng.int(0, Math.max(0, doc.bar().max))); drv.scroll(0); K(9); });
  } catch (e) { sec.ok(false, e.message); }
  sec.end(`${drv.stat.steps} steps`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4 (the menu): a disabled item clicked sends nothing; the drop-down's look; the enable bits through real frames
/** The machine's whole screen (the pointer left out) against `g`; null when equal. */
const screenDiffG = (env, g) => diffDisp(readDisp(env.m), WM.toDisp(g), L.pointerMask(env.m, env.S));
const liveFocus = (env) => { const o = W.objs(env); return rd16(env.m, env.S.K_FOCUS) === o.tv && !!o.tv; };
/** The model's screen with the Edit menu open and item index `h` highlighted (h -1: none). */
function menuScreen(env, doc, h) {
  const g = WM.renderScreen(doc, { focus: liveFocus(env), barValue: env.m.ram[W.objs(env).bar + env.S.VScroll_value] });
  const lay = layoutOf(WM.MENUS);
  drawOpen(g, WM.MENUS, lay, [[true], doc.editEnabled()], 1, h);
  return g;
}
/** The state of the machine, all of it that 12.9 item 4's "sends nothing" can change, as a string. */
const stateKey = (env) => { const a = W.readState(env), b = W.readState2(env); return JSON.stringify([a.codes.length, a.caret, a.top, a.chg, a.nl, b.an, b.mk, b.cln, Array.from(env.m.ram.subarray(W.CLIP, W.CLIP + 64)), W.menuBits(env, 0), W.menuBits(env, 1), T.postedQueue(env)]); };
if (cartOk && has('4')) {
  const sec = new Sec('4b the Edit menu through real frames (the pointer on the title "Edit", the drop-down\'s look as WINDOWS 18.3 draws it with the model\'s enable bits, a highlight on an enabled item, none on a disabled one); a disabled item released on sends nothing (no E_MENU, nothing changes, the menu closes); an enabled one acts; the enable bits follow the selection and the clipboard');
  const env = newEnv(), { m, S } = env;
  const doc = new WM.Doc();
  const chk = (what, o = {}) => {
    env.frames_(o.frames ?? 3);
    const sd = W.stateDiff(env, doc), d = sd.doc.concat(sd.lt, sd.bar, W.stateDiff2(env, doc).sel, W.stateDiff2(env, doc).clip).filter((x) => !(o.menuOpen && x.startsWith('K_FOCUS')));
    sec.ok(d.length === 0, () => `${what}: ${d[0]} [${W.describe(doc)}]`);
    const want = W.wantBits(doc), got = [W.menuBits(env, 0) & 1, W.menuBits(env, 1) & 0x1F];
    sec.ok(got[0] === want[0] && got[1] === want[1], () => `${what}: enable bits ${got} want ${want} (S ${doc.S}, clipboard ${doc.clip.length})`);
    if (!o.menuOpen) { const s = W.liveDiff(env, doc, { full: true }); sec.ok(s === null, () => `${what}: screen ${s} [${W.describe(doc)}]`); }
  };
  const key = (code, what) => { L.typeCode(env, code, 3, 3); W.Doc_key(doc, code); chk(what || `key ${code}`); };
  const typeText = (s) => { for (const c of s) { L.typeCode(env, c.charCodeAt(0), 3, 3); doc.key(c.charCodeAt(0)); } chk(`typed ${JSON.stringify(s.slice(0, 20))}...`, { frames: 6 }); };
  chk('Write just launched');
  sec.ok(doc.editBits() === 1 && W.menuBits(env, 1) === 1, () => `at the start only Select all is enabled (bits ${W.menuBits(env, 1)} want 1)`);
  // 1. every item disabled but Select all, no text: open the menu, look, release on a disabled item
  for (const k of [0, 1, 2, 3]) {
    const s0 = stateKey(env), name = ['Cut', 'Copy', 'Paste', 'the separator'][k];
    W.editMenu(env, k, { release: false });
    const d = screenDiffG(env, menuScreen(env, doc, -1)); sec.ok(d === null, () => `the Edit menu open over ${name} (disabled: no highlight): ${d}`);
    W.releaseMenu(env, 14);
    sec.ok(stateKey(env) === s0, () => `releasing on ${name} (disabled) changed something: before ${s0.slice(0, 150)}, after ${stateKey(env).slice(0, 150)}`);
    sec.ok(m.ram[S.K_PN] === 0 && L.progUp(env, 3) && L.openWindows(m, S).length === 1, () => `after ${name}: posted ${m.ram[S.K_PN]}, windows ${L.openWindows(m, S).length}`);
    chk(`after releasing on ${name}`);
  }
  // 2. text, a selection by MARK: Cut and Copy become enabled; look with the highlight on each enabled item
  typeText('The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.');
  W.typeMark(env); doc.key(18); chk('MARK');
  for (let i = 0; i < 9; i++) key(8, `LEFT ${i + 1} (extend)`);
  sec.ok(doc.S === 9 && doc.mark === 1, () => `the selection is ${doc.S} codes, mark ${doc.mark}`);
  for (const k of [0, 1, 4]) {
    W.editMenu(env, k, { release: false });
    const d = screenDiffG(env, menuScreen(env, doc, k)); sec.ok(d === null, () => `the Edit menu open with item ${k} highlighted: ${d}`);
    if (k === 1) { W.releaseMenu(env, 14); doc.menuItem(2); chk('Copy by the pointer'); }
    else if (k === 4) { W.releaseMenu(env, 14); doc.menuItem(4); chk('Select all by the pointer'); }
    else { L.moveTo(env, 200, 120); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(14); }       // Cut: the menu is closed by releasing away from its items (no choice)
  }
  sec.ok(doc.clip.length === 9 && W.menuBits(env, 1) === doc.editBits(), () => `after Copy: clipboard ${doc.clip.length}, bits ${W.menuBits(env, 1)}`);
  // 3. Paste by the pointer, Cut by the pointer
  L.click(env, 100, 40, 3, 6); doc.click(100, 40); chk('a click');
  W.editMenu(env, 2); doc.menuItem(3); chk('Paste by the pointer', { frames: 6 });
  W.editMenu(env, 4); doc.menuItem(4); chk('Select all by the pointer', { frames: 6 });
  { const en = doc.editEnabled()[0]; W.editMenu(env, 0); if (en) doc.menuItem(1); chk(`Cut by the pointer (${en ? 'enabled' : 'disabled: nothing happens'})`, { frames: 8 }); }
  sec.end(`${doc.L} codes, clipboard ${doc.clip.length}`);
}

// ===========================================================================================================================
// 5. The limits
if (cartOk && has('5')) {
  // NOTE (coordinator): a Paste into a nearly full document keeps the overwritten selection codes at $5800-$5FFF, where tk-lib keeps strings / stubs ($5C00-$5E6F).  This group only uses K_DISPATCH, WR_MENU, E_SCROLL
  // and the bar, none of which needs those areas, and opens no covering window: nothing here relies on them surviving a Paste.
  const sec = new Sec('5 the limits: selections of 2,048 and 2,049 codes (the enable bits), Copy of 2,048; Paste\'s refusal at 5,120 codes (accepted at exactly 5,120, refused at 5,121 and 5,119 + 2,048), at 1,024 lines (1,025 refused, 1,024 accepted) with the lines counted after wrapping, typing over a selection at 1,024 lines (the deletion stands, nothing inserted) and in a full document, Select all of a full document');
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv2(env, { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec }, new WM.Doc());
  const run = (title, target, key, script) => {
    const d = W.loadDoc(env, target, key);
    drv.doc = d; drv.trail = []; drv.covers = [];
    drv.verify(title);
    const n0 = drv.total();
    try { script(d); } catch (e) { sec.ok(false, `${title}: ${e.message} (${drv.ctx()})`); }
    if (drv.total() > n0) sec.note(`${title}: failed after ${drv.trail.join(' > ')}`);
    return d;
  };
  const K = (code, n = 1) => { for (let i = 0; i < n && drv.total() === 0; i++) drv.key(code); };
  /** From a selection with the mark on and the caret at its end, shrink it with UP and LEFT to exactly `S` codes (the model picks each key). */
  const shrinkTo = (d, S) => { while (d.S > S && drv.total() === 0) { const c = d.clone(); c.key(11); if (c.S >= S && c.caret !== d.caret) drv.key(11); else drv.key(8); } };
  const text = (n, opt = {}) => { const t = new WM.Doc(WM.genText(rng, n, { para: 0.01, ...opt })); t.top = null; return t; };
  // (a) 2,100 codes: Select all (2,100: Cut and Copy disabled), MARK, shrink to 2,049 (disabled) and 2,048 (enabled), Copy, Cut
  {
    const t = text(2100);
    run('2,100 codes: selections of 2,049 and 2,048', t, 'w2-2100', (d) => {
      drv.menuItem(4);
      sec.ok(d.S === d.L && !d.editEnabled()[0] && !d.editEnabled()[1] && (W.menuBits(env, 1) & 0x18) === 0, () => `Select all of ${d.L} codes: S ${d.S}; Cut and Copy must be disabled (S > 2,048): bits ${W.menuBits(env, 1).toString(2)}`);
      drv.mark(); shrinkTo(d, 2049);
      sec.ok(d.S === 2049 && (W.menuBits(env, 1) & 0x18) === 0, () => `S ${d.S}: enable bits ${W.menuBits(env, 1).toString(2)}, Cut and Copy must be off`);
      K(8);
      sec.ok(d.S === 2048 && (W.menuBits(env, 1) & 0x18) === 0x18, () => `S ${d.S}: enable bits ${W.menuBits(env, 1).toString(2)}, Cut and Copy must be on`);
      drv.menuItem(2);
      const cl = W.readState2(env);
      sec.ok(cl.cln === 2048 && cl.clip.every((c, i) => c === t.codes[i]), () => `Copy of 2,048 codes: WR_CLN ${cl.cln}, the codes at $7800 must be the first 2,048 of the document`);
      drv.menuItem(1);                                                 // Cut of the same 2,048 codes (the selection was kept by Copy): L 52
      sec.ok(d.L === 2100 - 2048 && W.readState(env).codes.length === 52, () => `Cut of 2,048 codes: L ${W.readState(env).codes.length}, want 52`);
      drv.menuItem(3);                                                 // Paste at the caret: 2,100 again
      sec.ok(W.readState(env).codes.length === 2100, () => `Paste of 2,048 codes: L ${W.readState(env).codes.length}, want 2,100`);
    });
  }
  // (b) Paste at the 5,120-code boundary: 3,073 codes typed; select 2,048, Copy, to the end of the selection, Paste (5,121: refused), DELETE, Paste (5,120: accepted), Paste (refused)
  {
    const t = text(3073, { para: 0.005 }); t.caret = t.L;
    run('3,073 codes: Paste at 5,121 refused, at 5,120 accepted', t, 'w2-3073', (d) => {
      drv.scroll(0); drv.click(30, 31); drv.menuItem(4); drv.mark(); shrinkTo(d, 2048);
      drv.menuItem(2); K(9);                                          // Copy; RIGHT: the caret to the selection's end (2,048)
      sec.ok(d.clip.length === 2048 && d.L === 3073 && d.S === 0, () => `set-up: clipboard ${d.clip.length}, L ${d.L}, S ${d.S}`);
      const L0 = d.L, was = JSON.stringify([d.caret, d.anchor, d.mark]);
      drv.menuItem(3);
      sec.ok(d.L === L0 && JSON.stringify([d.caret, d.anchor, d.mark]) === was, () => `Paste into 3,073 codes (5,121): the model's L ${d.L}, must be refused`);
      sec.ok(W.readState(env).codes.length === L0, () => `Paste into 3,073 codes (5,121) must be refused: the machine's L is ${W.readState(env).codes.length}`);
      K(12);
      drv.menuItem(3);
      sec.ok(d.L === 5120 && W.readState(env).codes.length === 5120, () => `Paste into 3,072 codes (5,120) must be accepted: L ${W.readState(env).codes.length}, model ${d.L}`);
      drv.menuItem(3);
      sec.ok(d.L === 5120 && W.readState(env).codes.length === 5120, () => `Paste into a full document must be refused: L ${W.readState(env).codes.length}`);
      K(12, 3); drv.menuItem(3);                                      // 5,117 + 2,048: refused
      // typing over a selection in a (nearly) full document, and a typed code refused when full
      drv.menuItem(4); drv.key(120);                                  // Select all of a document over 2,048: Cut disabled; typing replaces everything
    });
  }
  // (c) 1,024 lines: 1,020 paragraph ends; a clip of five 13s: Paste -> 1,025 lines refused; DELETE; Paste -> 1,024 lines accepted
  {
    const t = new WM.Doc(new Array(1019).fill(13), 1019); t.top = null;
    run('1,020 lines: Paste of five paragraph ends refused (1,025 lines), then accepted (1,024)', t, 'w2-e1019', (d) => {
      drv.mark(); K(8, 5); drv.menuItem(2); K(9);
      sec.ok(d.clip.length === 5 && d.caret === 1019 && d.nl === 1020, () => `set-up: clipboard ${d.clip.length}, caret ${d.caret}, lines ${d.nl}`);
      drv.menuItem(3);
      sec.ok(d.nl === 1020 && W.readState(env).nl === 1020, () => `Paste of five 13s into 1,020 lines (1,025) must be refused: the machine has ${W.readState(env).nl} lines`);
      K(12); drv.menuItem(3);
      sec.ok(d.nl === 1024 && W.readState(env).nl === 1024, () => `Paste of five 13s into 1,019 lines (1,024) must be accepted: the machine has ${W.readState(env).nl} lines, model ${d.nl}`);
    });
  }
  // (d) the lines counted after wrapping: 111 W then 1,020 paragraph ends (1,023 lines); the clip is the 111 W (a wrap of 3 lines): Paste at the end -> 1,025 refused; DELETE; Paste -> 1,024 accepted
  {
    const codes = [...new Array(111).fill(87), ...new Array(1020).fill(13)], t = new WM.Doc(codes, codes.length); t.top = null;
    run('1,023 lines, a clip of 111 W (3 lines when wrapped): refused, then accepted', t, 'w2-w111', (d) => {
      drv.scroll(0); drv.click(30, 31); drv.mark(); K(9, 111); drv.menuItem(2);
      sec.ok(d.clip.length === 111 && d.nl === 1023, () => `set-up: clipboard ${d.clip.length}, lines ${d.nl}`);
      drv.scroll(d.bar().max); drv.click(100, 30 + 9 * 15 + 4);        // the last line (the empty one after the final 13)
      sec.ok(d.caret === d.L, () => `set-up: the caret ${d.caret}, L ${d.L}`);
      drv.menuItem(3);
      sec.ok(d.nl === 1023 && W.readState(env).nl === 1023, () => `Paste of 111 W into 1,023 lines (3 lines more: 1,025 after the wrap) must be refused: the machine has ${W.readState(env).nl} lines`);
      K(12); drv.menuItem(3);
      sec.ok(d.nl === 1024 && W.readState(env).nl === 1024, () => `Paste of 111 W (1,024 lines after the wrap) must be accepted: the machine has ${W.readState(env).nl} lines, model ${d.nl}`);
    });
  }
  // (e) typing over a selection at 1,024 lines: the deletion stands and nothing is inserted; ENTER and a letter with no selection are refused (W1); one DELETE frees a line
  {
    const codes = [97, 98, 99, ...new Array(1023).fill(13)], t = new WM.Doc(codes, codes.length); t.top = null;
    run('1,024 lines: typing over a selection', t, 'w2-1024', (d) => {
      sec.ok(d.nl === 1024, () => `set-up: ${d.nl} lines`);
      drv.scroll(0); drv.click(WM.TEXTX + 30, 31); drv.mark(); K(8, 2);   // the selection "bc" of line 0
      drv.key(120);
      sec.ok(W.readState(env).codes.length === 1024 && W.readState(env).nl === 1024 && d.codes[1] === 13, () => `typing over "bc" at 1,024 lines: the deletion stands (L ${W.readState(env).codes.length}), nothing inserted (${W.readState(env).nl} lines)`);
      K(13); K(97); K(12); K(13);
    });
    const e2 = new WM.Doc(new Array(1023).fill(13), 1023); e2.top = null;
    run('1,024 lines of 13: a selection of one 13 replaced by a letter (1,023 lines remain: inserted)', e2, 'w2-e1023', (d) => {
      drv.scroll(0); drv.click(30, 31); drv.mark(); K(9); drv.key(120);
      sec.ok(d.codes[0] === 120 && W.readState(env).codes[0] === 120, () => 'x must be inserted after the selection of one 13 is deleted (1,023 lines remain)');
    });
  }
  // (f) a full document: typing over a selection, Select all and typing replaces it, a refused typed code
  {
    const t = text(WM.CAP, { para: 0.02 }); t.caret = t.L; t.top = null;
    run('5,120 codes: typing over a selection, Select all and one code', t, 'w2-full', (d) => {
      sec.ok(d.L === WM.CAP, () => `set-up: L ${d.L}`);
      drv.key(120);                                                    // refused (full, no selection): nothing changes
      drv.mark(); K(8, 30); drv.key(120);                              // over 30 codes: L 5,091
      sec.ok(W.readState(env).codes.length === WM.CAP - 29 && d.L === WM.CAP - 29, () => `a code typed over a selection of 30 in a full document: L ${W.readState(env).codes.length}, want ${WM.CAP - 29}`);
      drv.menuItem(4);
      sec.ok(!d.editEnabled()[0] && !d.editEnabled()[1] && (W.menuBits(env, 1) & 0x18) === 0, () => 'Select all of 5,091 codes: Cut and Copy disabled');
      drv.key(65);
      sec.ok(W.readState(env).codes.length === 1 && d.L === 1, () => `typing over Select all: L ${W.readState(env).codes.length}, want 1`);
    });
  }
  sec.end(`${drv.stat.steps} steps, ${drv.stat.pastesRefused} Pastes refused`);
}

// ===========================================================================================================================
// 6. M_EVENT directly: consumed (carry) for every key 0..255 (MARK 18 included), the pointer events (E_MOVE with the capture is a drag)
if (cartOk && has('6')) {
  const sec = new Sec('6 consumed: M_EVENT of the text view by T_SEND: carry exactly for 32-126, DELETE, LEFT, RIGHT, UP, DOWN, ENTER and MARK (18); E_DOWN and E_UP consumed, E_MOVE only with the capture (and then a drag: the caret moves, the anchor stays); state, selection and screen against the model');
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv2(env, { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec }, new WM.Doc());
  const { S } = env, o = W.objs(env);
  let n = 0;
  for (let rep = 0; rep < 3 && sec.nf < 8; rep++) {
    const t0 = W.randomDoc(rng, 300); t0.changed = true; const d = W.loadDoc(env, t0); drv.doc = d; drv.trail = []; drv.verify('typed');
    const codes = []; for (let c = 0; c < 256; c++) codes.push(c);
    for (let i = codes.length - 1; i > 0; i--) { const j = rng.int(0, i); [codes[i], codes[j]] = [codes[j], codes[i]]; }
    for (const code of codes) {
      if (sec.nf > 8) break;
      if (d.run !== null && !WM.Doc.consumes(code)) continue;
      if (code === 12 && d.caret === 0 && d.S === 0) continue;
      if (d.mark === 1 && d.S === 0 && ((isIns(code) && !d.canInsert()) || (code === 12 && d.caret === 0))) continue;
      const ln = d.caretLine(); if ((ln < d.top || ln >= d.top + 16) && !isIns(code) && code !== 12) continue;
      drv.direct(W.keyRec(code), `M_EVENT key ${code}`); n++;
    }
    for (let i = 0; i < 8 && sec.nf < 8; i++) {
      const [px, py] = pt();
      drv.direct(W.ptRec(E.DOWN, px, py, 1), `M_EVENT E_DOWN (${px}, ${py})`);
      T.poke16(env, S.K_CAPTURE, 0); drv.direct(W.ptRec(E.MOVE, px, py, 1), 'M_EVENT E_MOVE, no capture');
      T.poke16(env, S.K_CAPTURE, o.tv);
      for (let k = rng.int(1, 3); k > 0; k--) { const [mx, my] = movePt(); drv.direct(W.ptRec(E.MOVE, mx, my, 1), `M_EVENT E_MOVE with the capture (${mx}, ${my})`); }
      drv.direct(W.ptRec(E.UP, px, py, 0), 'M_EVENT E_UP'); T.poke16(env, S.K_CAPTURE, 0);
      if (d.run === null && rng.chance(0.5)) drv.direct([E.SCROLL, rng.int(0, d.bar().max + 2), 2, 0], 'M_EVENT E_SCROLL');
      n++;
    }
  }
  sec.end(`${n} sends`);
}

// ===========================================================================================================================
// 7. Real frames: the keyboard (MARK = SYMBOL SHIFT + E, the caret keys), the pointer (a drag, the Edit menu), the menu keys (MENU, RIGHT, DOWN, ENTER), "New" keeps the clipboard, a new start loses it,
//    the modal dialog keeps the menus shut
if (cartOk && has('7')) {
  const sec = new Sec('7 real frames from the shell: text typed, MARK (SYMBOL SHIFT + E) and the caret keys select across lines, a drag by the pointer, the Edit menu by the pointer and by MENU + RIGHT + DOWN + ENTER (Copy, Cut, Paste, Select all), the clipboard kept by "New" (Discard) and lost by a new start (WR_CLN 0), no menu opens behind the discard dialog; after each step the whole screen, the state, the anchor / mark / clipboard and the enable bits equal the model\'s');
  const env = newEnv(), { m, S } = env;
  let doc = new WM.Doc(), n = 0;
  const waitFor = (f, max = 90) => { for (let i = 0; i <= max; i++) { if (f()) return true; if (i < max) env.frame(); } return false; };
  const chk = (what, o = {}) => {
    env.frames_(o.frames ?? 3);
    const w2s = W.stateDiff2(env, doc), sd = W.stateDiff(env, doc), d = sd.doc.concat(sd.lt, sd.bar, w2s.sel, w2s.clip).filter((x) => !(o.dialog && x.startsWith('K_FOCUS')));
    sec.ok(d.length === 0, () => `${what}: ${d[0]} [${W.describe(doc)}]`); n++;
    const want = W.wantBits(doc), got = [W.menuBits(env, 0) & 1, W.menuBits(env, 1) & 0x1F];
    sec.ok(got[0] === want[0] && got[1] === want[1], () => `${what}: enable bits ${got} want ${want} (S ${doc.S}, clipboard ${doc.clip.length})`);
    const sc = W.liveDiff(env, doc, { full: true, dialog: !!o.dialog }); sec.ok(sc === null, () => `${what}: screen ${sc} [${W.describe(doc)}]`);
    return d.length === 0 && sc === null;
  };
  const key = (code, what) => { L.typeCode(env, code, 3, 3); W.Doc_key(doc, code); return chk(what || `key ${code}`); };
  const mark = (what) => { W.typeMark(env); W.Doc_key(doc, 18); return chk(what || 'MARK (SYMBOL SHIFT + E)'); };
  const typeText = (s, every = 12) => { let i = 0; for (const c of s) { const code = c === '\n' ? 13 : c.charCodeAt(0); L.typeCode(env, code, 3, 3); W.Doc_key(doc, code); if (++i % every === 0) if (!chk(`typing, after ${i} codes`, { frames: 1 })) return false; } return chk(`typed ${JSON.stringify(s.slice(0, 20))}...`); };
  const menuByKeys = (items, item, what) => {
    // MENU opens the first menu with an enabled item ("File": New), RIGHT goes to "Edit" with its first enabled item highlighted, DOWN walks the enabled items (wrapping), ENTER chooses
    const en = doc.editEnabled(); const order = [1, 2, 3, 4].filter((i) => en[i === 4 ? 4 : i - 1]);
    const steps = order.indexOf(item);
    if (steps < 0) { sec.ok(false, `${what}: the model has item ${item} disabled (set-up)`); return false; }
    L.typeCode(env, 16, 3, 3); L.typeCode(env, 9, 3, 3);
    for (let i = 0; i < steps; i++) L.typeCode(env, 10, 3, 3);
    L.typeCode(env, 13, 3, 3);
    doc.menuItem(item);
    void items; return chk(what, { frames: 8 });
  };
  const dragPtr = (p0, p1, what) => {
    L.moveTo(env, p0[0], p0[1]); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, p1[0], p1[1]); env.frames_(2);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(4);
    doc.click(p0[0], p0[1]); doc.drag(p1[0], p1[1]);
    return chk(what);
  };
  const dialogUp = () => W.dialogUp(env);

  env.frames_(6);
  chk('a fresh start: empty document');
  sec.ok(rd16(m, S.WR_CLN) === 0 && W.readState2(env).mk === 0 && rd16(m, S.WR_AN) === 0, () => `at the start: WR_CLN ${rd16(m, S.WR_CLN)}, WR_MK ${W.readState2(env).mk}, WR_AN ${rd16(m, S.WR_AN)}`);
  typeText('alpha beta gamma delta\nsecond line here\nthird');
  mark('MARK with no selection');
  key(11, 'UP with the mark on (extends)'); key(11, 'UP again'); key(8, 'LEFT'); key(8, 'LEFT');
  sec.ok(doc.S > 0 && doc.mark === 1, () => `the selection spans ${doc.S} codes over ${doc.nl} lines`);
  menuByKeys(null, 2, 'Copy by MENU, RIGHT, DOWN, ENTER');
  sec.ok(doc.clip.length > 0 && W.readState2(env).cln === doc.clip.length, () => `Copy: clipboard ${W.readState2(env).cln}`);
  key(9, 'RIGHT collapses the selection to its end');
  key(13, 'ENTER');
  menuByKeys(null, 3, 'Paste by the keyboard menu');
  mark('MARK'); key(11, 'UP'); key(11, 'UP'); key(10, 'DOWN');
  menuByKeys(null, 1, 'Cut by the keyboard menu');
  key(120, 'a letter'); mark('MARK'); key(8, 'LEFT'); key(8, 'LEFT');
  key(12, 'DELETE of a selection (mark on)');
  // the pointer: a drag over lines (the pointer's E_MOVEs with the button held), a click with the mark on extends, the Edit menu by the pointer
  dragPtr([60, 31], [300, 60], 'a drag from line 0 to line 3');
  dragPtr([200, 70], [40, 40], 'a drag upward');
  mark('MARK'); L.click(env, 400, 50, 3, 6); doc.click(400, 50); chk('a click with the mark on extends');
  mark('MARK (off: the selection is cleared)');
  W.editMenu(env, 4); doc.menuItem(4); chk('Select all by the pointer', { frames: 8 });
  W.editMenu(env, 1); doc.menuItem(2); chk('Copy by the pointer', { frames: 8 });
  L.click(env, 90, 35, 3, 6); doc.click(90, 35); chk('a click');
  W.editMenu(env, 2); doc.menuItem(3); chk('Paste by the pointer', { frames: 8 });
  // "New" keeps the clipboard (12.1): Discard, then Paste is enabled with nothing selected
  const clip0 = doc.clip.slice();
  W.fileNew(env); env.frames_(8);
  sec.ok(dialogUp(), 'File / New on a changed document: the discard dialog');
  chk('the dialog over the document', { dialog: true });
  // while the dialog is open no menu opens: a press on the "Edit" title does nothing
  { const s0 = stateKey(env); L.moveTo(env, 60, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3); L.moveTo(env, 60, 14); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(10);
    sec.ok(dialogUp() && stateKey(env) === s0, () => 'the Edit menu behind the dialog changed something (the kernel\'s modal rule: no menu opens)');
    chk('after a press on "Edit" behind the dialog', { dialog: true }); }
  if (W.dialogButtons(env)) W.clickView(env, W.dialogButtons(env).discard);
  env.frames_(24); doc.newDoc();
  sec.ok(!dialogUp() && L.progUp(env, 3), 'Discard: the dialog is gone, Write runs');
  chk('after "New": an empty document, the clipboard kept');
  sec.ok(doc.clip.length === clip0.length && W.readState2(env).cln === clip0.length && W.readState2(env).clip.join() === clip0.join(), () => `"New" must keep the clipboard: WR_CLN ${W.readState2(env).cln}, was ${clip0.length}`);
  W.editMenu(env, 2); doc.menuItem(3); chk('Paste after "New" (nothing selected, the clipboard kept)', { frames: 8 });
  // a new start loses the clipboard: quit (the document changed: Discard), start Write again
  L.typeCode(env, 17, 3, 3); env.frames_(10);
  sec.ok(dialogUp(), 'SS+Q on a changed document: the dialog');
  L.typeCode(env, 13, 3, 3);
  sec.ok(waitFor(() => L.progUp(env, 0), 60), 'Discard on quit: back in the shell'); env.frames_(12);
  sec.ok(L.launchByDoubleClick(env, 3), 'Write started again'); env.frames_(12);
  doc = new WM.Doc();
  chk('a new start: the clipboard is gone (C = 0), Paste disabled');
  sec.ok(rd16(m, S.WR_CLN) === 0 && (W.menuBits(env, 1) & 0x1F) === 1, () => `after a new start: WR_CLN ${rd16(m, S.WR_CLN)}, Edit bits ${W.menuBits(env, 1)} (want 0 and 1)`);
  sec.end(`${n} state / screen checks`);
}

// ===========================================================================================================================
// 8. Stack, DI, registers
if (cartOk && has('8')) {
  const sec = new Sec('8 stack <= 128 bytes in the text view\'s M_DRAW and M_EVENT (MARK, drags, a selection drawn) and in WR_MENU (Cut, Copy, Paste, Select all), crossings included, interrupts off for the sends; no DI, and IX / IY / the alternate set kept in every stepped call');
  const env = newEnv(); W.parkDirect(env);
  const { S } = env, o = W.objs(env);
  const drv = new W.Drv2(env, { doc: sec, lt: sec, scr: sec, bar: sec, sel: sec, clip: sec, menu: sec }, new WM.Doc());
  let ev = { v: 0, what: '' }, dr = { v: 0, what: '' }, mn = { v: 0, what: '' };
  const upE = (r, what) => { const u = r.stack - 2; if (u > ev.v) ev = { v: u, what }; };
  for (const [name, mk] of [['a long wrapping paragraph', () => new WM.Doc(WM.genText(rng, 900, { para: 0.003 }), 0)], ['many short paragraphs', () => new WM.Doc(WM.genText(rng, 900, { para: 0.25 }), 0)], ['an empty document', () => new WM.Doc()]]) {
    const t0 = mk(); t0.caret = Math.min(t0.L, rng.int(0, 40)); t0.top = Math.min(t0.M, Math.max(0, t0.caretLine() - 3));
    const d = W.loadDoc(env, t0); drv.doc = d; drv.trail = []; drv.verify('typed');
    for (const code of [18, 10, 10, 9, 9, 11, 8, 18, 18, 9, 10, 18, 97, 18, 8, 12, 18, 11, 10, 10, 18, 9, 13, 18, 11, 11, 10, 8, 9, 12]) {
      if (d.run !== null && !WM.Doc.consumes(code)) continue;
      if (d.mark === 1 && d.S === 0 && ((isIns(code) && !d.canInsert()) || (code === 12 && d.caret === 0))) continue;
      const r = drv.direct(W.keyRec(code), `${name}: key ${code}`, { run: { ints: false } }); if (r) upE(r, `${name}, key ${code} (${W.describe(d)})`);
      if (sec.nf > 6) break;
    }
    for (let i = 0; i < 4 && sec.nf < 6; i++) {
      const [px, py] = pt();
      let r = drv.direct(W.ptRec(E.DOWN, px, py, 1), `${name}: press (${px}, ${py})`, { run: { ints: false } }); if (r) upE(r, `${name}, E_DOWN`);
      T.poke16(env, S.K_CAPTURE, o.tv);
      for (let k = 0; k < 2; k++) { const [mx, my] = movePt(); r = drv.direct(W.ptRec(E.MOVE, mx, my, 1), `${name}: drag (${mx}, ${my})`, { run: { ints: false } }); if (r) upE(r, `${name}, E_MOVE (drag)`); }
      T.poke16(env, S.K_CAPTURE, 0);
    }
    for (const foc of [true, false]) {
      if (foc) W.focusTv(env); else T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
      const r = W.sendDraw(env, o.tv); X.noteRun(sec, r, `${name}: M_DRAW focus ${foc}, selection ${d.S}`); const u = r.stack - 2; if (u > dr.v) dr = { v: u, what: `${name}, focus ${foc}, selection ${d.S}` };
    }
    W.focusTv(env);
    // WR_MENU: Select all, Copy / Cut (enabled by the model), Paste, each checked against the model
    for (const item of [4, 2, 3, 1, 3, 4, 1, 3]) {
      if (!d.editEnabled()[item === 4 ? 4 : item - 1] || (item === 3 && d.run !== null && !d.pasteOk())) continue;
      const r = drv.menuItem(item); if (r) { const u = r.stack; if (u > mn.v) mn = { v: u, what: `${name}, item ${item} (${W.describe(d)})` }; }
      if (sec.nf > 6) break;
    }
  }
  sec.ok(ev.v <= 128, () => `M_EVENT used ${ev.v} bytes of stack (${ev.what}), bound 128`);
  sec.ok(dr.v <= 128, () => `M_DRAW used ${dr.v} bytes of stack (${dr.what}), bound 128`);
  sec.ok(mn.v <= 128, () => `WR_MENU used ${mn.v} bytes of stack (${mn.what}), bound 128`);
  sec.ok(X.totals.di === 0, () => `${X.totals.di} DI instruction(s) executed in the stepped calls`);
  sec.ok(X.totals.badPreserved === 0, () => `${X.totals.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(X.totals.badSp === 0, () => `${X.totals.badSp} call(s) returned with a wrong SP`);
  sec.end(`deepest M_EVENT ${ev.v} bytes (${ev.what}), deepest M_DRAW ${dr.v} (${dr.what}), deepest WR_MENU ${mn.v} (${mn.what})`);
}

// ===========================================================================================================================
// 9. The memory watch
if (cartOk && has('9')) {
  const sec = new Sec('9 memory watch (BANKING 10.7; $7800-$7FFF is written only under K, by KFAR K_LDIR: a write under A would be a violation), no pointer to DOCK 2-3 / 6 handed to K code, V_FRAMES rose by one on every frame run normally');
  envs.forEach((env, i) => { sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`); sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} frames, first ${env.vf.first}`); });
  sec.end(`${envs.length} machines, ${envs.reduce((a, e) => a + e.frames, 0)} frames run`);
}
finish();
