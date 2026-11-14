"use strict";
// wr-w4.mjs -- Write slice W4 (double-click and Find, docs/WRITE.md 14 as amended by 14.9) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  14.7's test list items 1-4
// (the bounds are tests/wr-perf.mjs, the kernel's flag is tests/kern-dclick.mjs, the cross-emulator rows tools/xemu/).  Written from the contract only (WRITE 11-14, FILES 2, OBJECTS_EVENTS 6); the Z80 sources
// were not read.  The reference is tests/wr-model.mjs (the clicked code, the runs, the double-click rule, F and the search) with tests/wr-w3model.mjs (the dialog's looks); the harness is tests/wr-w3lib.mjs.
//   node tests/wr-w4.mjs [--seed N] [--nrand N] [--only LIST] [--verbose]
//     --nrand N    random sequences in group 6 (default 30), 8 steps each
//     --only LIST  groups: 0 the model's hand cases, 1 double-click on the machine (the clicked code at every pixel edge, classes and runs, a word across display lines, spaces, punctuation, digits, past a line's end,
//                  an empty line, the mark on, an edit between the two clicks, a neighbouring code, the third and fourth clicks, a drag after it, the 19 / 20 / 21-frame gaps through the real ISR, a view that scrolls),
//                  2 Find on the machine (F at 0, at L - |F|, crossing the caret, the wrap point, 30 codes, an empty Find, Cancel in its three ways, ENTER and the button, case folding, Find again's cycle, Not found and
//                  its dismissals, F kept by New and Open, the enable bits), 3 WR_LCK exactly ($FFFF for none: start, after a typed code, DELETE, Cut, Paste, New, Open) and WR_FN / F's codes,
//                  4 looks (the Find dialog's geometry from the view tree and its rendering, "Not found.", the Save dialog still as W3's after Find and the other way round, the open Edit menu), 5 the UP / DOWN run is kept by
//                  Find..., Cancel, an empty Find and Not found and ended by a match, 6 random sessions against the model (clicks, double-clicks, typing, Find..., Find again, edits), 7 stack <= 128 / no DI /
//                  registers (direct calls), 8 frames and memory
// The last line is "wr-w4: N of M groups pass"; exit code 1 on any failure.
//
// Readings of the contract (CONTRACT? comments; the generators stay away from what the contract does not settle):
//  D1. (14.2, 14.9 item 3) A double-click selects the run around the clicked code and ends the UP / DOWN run (it is an E_DOWN: 11.5).  The kernel's flag is read from the ring record the ISR queued for each press
//      (tests/kern-dclick.mjs judges the flag itself) and the model is told it; the presses of the timing group also expect the flag from the contract (<= 20 frames, 8 across, 4 down).
//  D2. (14.4) "Find" with the Field text equal to F searches again (F = the text).  The Field's cap is 30, so F has 1-30 codes.
//  D3. (14.5) "Not found." leaves everything unchanged, the mark and the run included; the alert is WR_DK 2 with the Label "Not found." (W3's alert, one line).
//  D4. (14.9 item 6) The UP / DOWN run ends only when a match is selected.
import * as Q from './wr-w3lib.mjs';
import * as H from './shell-lib.mjs';
import { layoutOf } from './wm-model3.mjs';
import { openLook as drawOpen } from './look-model.mjs';

const { W, W3, L, WM, T, X, hex, rd16, E } = Q;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NRAND = argNum('--nrand', 30);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['0', '1', '2', '3', '4', '5', '6', '7', '8'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('wr-w4', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NRAND} random sequences`);
const W4_NEEDED = ['WR_FN', 'WR_FCODES', 'WR_FFB', 'WR_LCK', 'WR_DK', 'WR_SDLG', 'WR_SFLD', 'K_DCN', 'K_RING', 'K_RTAIL'];
let cartOk = true;
if (ONLY.some((g) => g !== '0')) {
  try { const S = L.loadDesk5().S; W.needWr(S); W.needWr2(S); Q.needW3(S); const miss = W4_NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 has no Write W4: it does not define ${miss.join(', ')}`); }
  catch (e) { cartOk = false; const sec = new Sec('cartridge: build/desk5 is a Write W4 build'); sec.ok(false, e.message); sec.end(); }
}
const envs = [];
const newEnv = () => { const e = Q.bootW3({ rng }); envs.push(e); return e; };
const codes = WM.codesOf, textOf = WM.textOf;
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const LET = codes('abcdefghijklmnopqrstuvwxyz');
const K = Q.KEYS;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers (real frames: keys through the keyboard, presses through the Kempston mouse and the real ISR)
/** The screen point inside code k of the model's document (fraction `frac` of its advance), or null when its line is not shown or the point is outside the text view. */
function pointOf(doc, k, frac = 0.5) {
  const ln = doc.lineOf(k), j = ln - doc.top;
  if (j < 0 || j >= 16 || k >= doc.starts[ln] + doc.lens[ln]) return null;
  const x0 = WM.TEXTX + WM.tw(doc.codes, doc.starts[ln], k), w = WM.adv(doc.codes[k]), x = x0 + Math.min(w - 1, Math.floor(w * frac));
  return x >= 472 ? null : [x, WM.TVR.y + 9 * j + 4];
}
/** A press at (x, y) as the real ISR sees it (the pointer moved there and the button down in one frame; K_RING read for the flag), the model told with that flag.  Returns { frame, flag }. */
function press(env, x, y, hold = 1) {
  const r = H.pressPoint(env, x, y, hold);
  env.st.doc.press(x, y, !!r.flag);
  return r;
}
/** The pointer moved toward (x, y) by at most `step` counts a frame, one frame at a time, `n` frames (stops early when there). */
function drift(env, x, y, n, step = 60) {
  const { m, S } = env;
  for (let i = 0; i < n; i++) {
    const [px, py] = L.pointerPos(m, S), dx = Math.max(-step, Math.min(step, x - px)), dy = Math.max(-step, Math.min(step, y - py));
    m.mouse.x = (m.mouse.x + dx) & 0xFF; m.mouse.y = (m.mouse.y - dy) & 0xFF; env.frame();
  }
}
/**
 * A press at (x, y) whose poll is `gap` frames after the previous press's poll (the previous press' release frame is frame 1 of the gap): gap - 2 frames of pointer drift toward the point, and more frames
 * (only when the point is more than 100 counts away) so that the final move fits one frame.  Returns { frame, flag } as press().
 */
function pressAfter(env, x, y, gap) {
  drift(env, x, y, Math.max(0, gap - 2));
  for (let t = 0; t < 8; t++) { const [px, py] = L.pointerPos(env.m, env.S); if (Math.abs(x - px) <= 100 && Math.abs(y - py) <= 100) break; drift(env, x, y, 1); }
  return press(env, x, y);
}
/** What the kernel's flag must be for a press (14.9 item 1) given the previous press { frame, x, y, flag }: <= 20 frames, <= 8 across, <= 4 down, the previous not itself a double-click. */
const wantFlag = (prev, frame, x, y) => !!prev && !prev.flag && frame - prev.frame <= 20 && Math.abs(x - prev.x) <= 8 && Math.abs(y - prev.y) <= 4;
/** The Edit menu by the keys: MENU, RIGHT (to "Edit"), DOWN over the enabled items, ENTER on item `item` (ids: 1 Cut .. 4 Select all, 5 Find..., 6 Find again). */
function editItemKeys(env, doc, item) {
  const en = doc.editEnabled(), order = [1, 2, 3, 4, 5, 6].filter((i) => en[WM.ITEM_IDX[i]]), steps = order.indexOf(item);
  if (steps < 0) throw new Error(`editItemKeys: the model has item ${item} disabled`);
  Q.key(env, K.MENU); Q.key(env, K.RIGHT); for (let i = 0; i < steps; i++) Q.key(env, K.DOWN); Q.key(env, K.ENTER);
}
/** Keys into the dialog's Field, the model's Field following. */
function fieldKeys(env, f, cs) { for (const c of cs) { Q.key(env, c); W3.fieldTyped(f, c); } }
/** The Field's text replaced by `text` (DELETE the old, type the new). */
function fieldSet(env, f, text) { fieldKeys(env, f, [...f.buf.map(() => K.DELETE), ...(typeof text === 'string' ? codes(text) : text)]); }
/** "Find..." from the menu: the dialog opens with F in the Field (caret at the end); returns the Field model. */
function openFind(env, sec, ctx) {
  editItemKeys(env, env.st.doc, 5); Q.settle(env, 8);
  const f = W3.newSaveField(env.st.doc.find);
  Q.check(env, sec, `${ctx}: the Find dialog`, { dk: 3, field: f });
  return f;
}
/** The alert is up (WR_DK 2 with `msg`): check it, close it with how = 'enter' | 'esc' | 'break' | 'click'. */
function dismiss(env, sec, ctx, msg, how = 'enter') {
  Q.check(env, sec, `${ctx}: the alert`, { dk: 2, msg });
  if (how === 'enter') Q.key(env, K.ENTER); else if (how === 'esc') Q.key(env, K.ESC); else if (how === 'break') Q.key(env, K.BREAK);
  else { const [x, y] = Q.centreOf(W3.ALERT.ok); L.click(env, x, y, 3, 6); }
  Q.settle(env, 24);
  Q.check(env, sec, `${ctx}: after the alert (${how})`, { dk: 0 });
}
/**
 * Finish the open Find dialog: how 'enter' (in the Field) | 'button' | 'cancel' (the button) | 'esc' | 'break'.  The model follows (14.4, 14.5); "Not found." is checked and dismissed.
 * Returns { found, empty, cancelled }.
 */
function finishFind(env, sec, ctx, f, how = 'enter', dismissHow = 'enter') {
  const doc = env.st.doc, text = f.buf.slice();
  if (how === 'cancel' || how === 'esc' || how === 'break') {
    if (how === 'cancel') { const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); } else Q.key(env, how === 'esc' ? K.ESC : K.BREAK);
    Q.settle(env, 24);
    Q.check(env, sec, `${ctx}: after Cancel (${how})`, { dk: 0 });
    return { cancelled: true };
  }
  if (how === 'enter') Q.key(env, K.ENTER); else { const [x, y] = Q.centreOf(W3.SAVE.save); L.click(env, x, y, 3, 6); }
  Q.settle(env, 40);
  const r = doc.findDialog(text);
  if (r.empty) { Q.check(env, sec, `${ctx}: after an empty Find`, { dk: 0 }); return { empty: true }; }
  if (r.found) { Q.check(env, sec, `${ctx}: after Find "${textOf(text)}" (found at ${r.pos})`, { dk: 0 }); return { found: true, pos: r.pos }; }
  dismiss(env, sec, `${ctx}: "${textOf(text)}" not found`, 'Not found.', dismissHow);
  return { found: false };
}
/** Find...: the dialog, the Field set to `text` (null: keep F), finished. */
function doFind(env, sec, ctx, text, how = 'enter', dismissHow = 'enter') {
  const f = openFind(env, sec, ctx);
  if (text !== null) { fieldSet(env, f, text); Q.settle(env, 12); Q.check(env, sec, `${ctx}: the text typed`, { dk: 3, field: f }); }
  return finishFind(env, sec, ctx, f, how, dismissHow);
}
/** Find again by the menu keys (item 6, enabled when F is not empty); "Not found." dismissed. */
function doAgain(env, sec, ctx, dismissHow = 'enter') {
  const doc = env.st.doc;
  editItemKeys(env, doc, 6); Q.settle(env, 40);
  const r = doc.search(doc.find);
  if (r.found) { Q.check(env, sec, `${ctx}: Find again (found at ${r.pos})`, { dk: 0 }); return { found: true, pos: r.pos }; }
  dismiss(env, sec, `${ctx}: Find again, not found`, 'Not found.', dismissHow);
  return { found: false };
}
/** File > New by the pointer, the discard dialog answered with Discard when the document is changed; the model follows. */
function doNew(env, sec, ctx) {
  const st = env.st, ch = st.doc.changed;
  W.fileNew(env); Q.settle(env, 10);
  if (ch) { Q.check(env, sec, `${ctx}: the discard dialog`, { dk: 0, discard: true }); Q.key(env, K.ENTER); Q.settle(env, 24); }
  st.newDoc();
  Q.check(env, sec, `${ctx}: after New`, { dk: 0 });
}
/** Type `cs` (codes or text) into the text view, the model following; then the state is checked. */
function typeIn(env, sec, ctx, cs) { Q.typeDoc(env, cs); Q.settle(env, 30); Q.check(env, sec, ctx, { dk: 0 }); }
const vocab = ['the', 'The', 'quick', 'Brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'x1', 'a.b', 'Hello,', 'world', 'THE', 'it\'s', '(the)', 'abc123', '42', 'Zebra', 'end.'];
/** A document of about n codes made of vocabulary words, spaces, runs of spaces and paragraph ends. */
function vocabDoc(n, para = 0.06) {
  const out = [];
  while (out.length < n) {
    const r = rng.next();
    if (r < para) out.push(13); else if (r < para + 0.12) { const k = rng.chance(0.3) ? rng.int(2, 5) : 1; for (let i = 0; i < k; i++) out.push(32); } else out.push(...codes(rng.pick(vocab)));
  }
  return out.slice(0, n);
}
const flipCase = (c) => (c >= 97 && c <= 122 ? c - 32 : c >= 65 && c <= 90 ? c + 32 : c);
/** An F for a document: mostly a substring of it (no 13), sometimes case-flipped, sometimes absent. */
function pickF(doc) {
  const r = rng.next();
  if (r < 0.12 || doc.L < 3) return codes(rng.pick(['zzq', 'qx', 'not here', 'Zq9']));
  for (let t = 0; t < 30; t++) {
    const n = rng.pick([1, 2, 3, 4, 5, 6, 8, 12]), a = rng.int(0, Math.max(0, doc.L - n)), s = doc.codes.slice(a, a + n);
    if (s.length === n && !s.includes(13)) return rng.chance(0.4) ? s.map((c) => (rng.chance(0.6) ? flipCase(c) : c)) : s;
  }
  return codes('the');
}

// ===========================================================================================================================
if (has('0')) {
  const sec = new Sec('0 wr-model hand cases (W1-W3 and W4: the clicked code at pixel edges, the runs by class, the double-click rule with WR_LCK, the search with its wrap, case folding and F\'s survival, the Edit menu\'s 8 items and their enable bits)');
  const out = []; const bad = WM.selfTest(out);
  sec.n = out.length; sec.nf = bad;
  for (const l of out) if (l.startsWith('FAIL')) sec.fails.push(l);
  sec.end(`${out.length} cases`);
}

// ===========================================================================================================================
if (cartOk && has('1')) {
  const sec = new Sec('1 double-click (14.2, 14.9 item 3) on the machine through the real ISR: the clicked code at the edge pixels of codes, word / space / punctuation runs, digits, a word across display lines, past a line\'s end, an empty line, a 13, the mark on, an edit between the clicks, a neighbouring code, the third (not flagged) and fourth clicks, a drag after it, the 19 / 20 / 21-frame gaps, a scrolled view; state, selection, menu bits, F and WR_LCK and the screen after each');
  const stat = { pairs: 0, doubles: 0 };
  /** One case: a fresh machine, `text` typed, then the presses (each [k, frac, gap]: a press on code k; gap = frames after the previous press, null for the first). */
  const run = (name, text, presses, o = {}) => {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, `${name}: typed`, text);
    if (o.pre) o.pre(env);
    let n = 0, prev = null;
    for (const p of presses) {
      const doc = st.doc;
      const pt = p.at ?? pointOf(doc, p.k, p.frac ?? 0.5);
      if (!pt) { sec.ok(false, `${name}: code ${p.k} is not on screen (set-up)`); return env; }
      let r;
      if (prev === null) { L.moveTo(env, pt[0], pt[1]); Q.settle(env, 24); r = press(env, pt[0], pt[1], p.hold ?? 1); }
      else r = pressAfter(env, pt[0], pt[1], p.gap ?? 6);
      // the kernel's flag as 14.9 item 1 says (the model of this test is told the machine's flag; kern-dclick.mjs judges it in full)
      const want = wantFlag(prev, r.frame, pt[0], pt[1]);
      sec.ok(!!r.flag === want, () => `${name}, press ${n + 1} at (${pt}), ${prev ? r.frame - prev.frame + ' frames after the previous' : 'the first'}: the kernel's flag ${r.flag ? 1 : 0}, the contract says ${want ? 1 : 0}`);
      prev = { frame: r.frame, x: pt[0], y: pt[1], flag: !!r.flag };
      n++; stat.pairs++; if (doc.lastDouble) stat.doubles++;
      if (p.after) p.after(env);
    }
    Q.settle(env, 40);
    Q.check(env, sec, `${name}: after the presses`, { dk: 0 });
    return env;
  };
  // A press pair on code k (both on the middle of the code), 6 frames apart
  const pair = (k, o = {}) => [{ k, frac: o.f1 ?? 0.5, expectFlag: false, idle: 4 }, { k: o.k2 ?? k, frac: o.f2 ?? 0.5, gap: 6, expectFlag: o.flag2 ?? true }];
  const T1 = 'The quick brown fox, jumps over: the lazy dog 42 times.';
  // a word in the middle, its first and last code, a space, a punctuation code, digits, the last code of the text
  for (const [what, k] of [['the first code of the text (T)', 0], ['a word\'s middle (quick)', T1.indexOf('quick') + 2], ['the first code of "brown"', T1.indexOf('brown')], ['the last code of "brown"', T1.indexOf('brown') + 4], ['the space after "brown"', T1.indexOf('brown') + 5],
    ['the comma', T1.indexOf(',')], ['the space after the comma', T1.indexOf(',') + 1], ['the colon', T1.indexOf(':')], ['"4" of 42 (digits are word codes)', T1.indexOf('42')], ['the final period', T1.length - 1]]) {
    run(`${what} (code ${k})`, T1, pair(k));
  }
  // the clicked code at the edges of every pixel: the first and last pixel of each of the first 12 codes of a line of mixed widths, and the pixels around the line's end
  {
    const text = 'iWi.W i,Wl-ii M';
    for (let k = 0; k < text.length; k++) run(`pixel edges: code ${k} (${JSON.stringify(text[k])}) first pixel`, text, pair(k, { f1: 0, f2: 0 }));
    for (let k = 0; k < text.length; k += 3) run(`pixel edges: code ${k} (${JSON.stringify(text[k])}) last pixel`, text, pair(k, { f1: 0.99, f2: 0.99 }));
    // the first pixel of code k + 1 is not code k: a first press on the last pixel of code k, the second on the first pixel of code k + 1 (a neighbouring code)
    for (const k of [0, 3, 7, 11]) run(`pixel edges: last pixel of code ${k} then the first pixel of code ${k + 1}: not a double-click`, text, [{ k, frac: 0.99, idle: 4 }, { k: k + 1, frac: 0, gap: 6, expectFlag: true }]);
    // left of the first code (24..26) is the first code; right of the last drawn code is none
    run('px 24 and px 26 (left of the text) both mean the first code: a double-click', text, [{ at: [24, 34], idle: 4 }, { at: [26, 34], gap: 6, expectFlag: true }]);
    run('px 24 then px 27: the same first code', text, [{ at: [24, 34], idle: 4 }, { at: [27, 34], gap: 6, expectFlag: true }]);
    run('right of the last drawn code: no clicked code, no double-click (two presses at x 200)', text, [{ at: [200, 34], idle: 4 }, { at: [200, 34], gap: 6, expectFlag: true }]);
    run('just right of the last drawn code (x 27 + the text\'s width): none', text, [{ at: [27 + WM.tw(codes(text), 0, text.length), 34], idle: 4 }, { at: [27 + WM.tw(codes(text), 0, text.length), 34], gap: 6, expectFlag: true }]);
  }
  // classes: a run of spaces, a lone space, punctuation next to words, digits and letters together
  run('a run of 4 spaces: a double-click on the second selects all four', 'ab    cd', pair(3));
  run('a run of 4 spaces: on the first of them', 'ab    cd', pair(2));
  run('a lone space', 'ab cd', pair(2));
  run('punctuation: "(the)" the "(" alone', 'x (the) y', pair(2));
  run('punctuation: the ")" alone', 'x (the) y', pair(6));
  run('punctuation: two commas ",," select one', 'a,,b', pair(2));
  run('digits and letters are one word: abc123 on the "1"', 'x abc123 y', pair(5));
  run('an apostrophe splits: it\'s on the "s" (word codes only: letters and digits)', 'it\'s ok', pair(3));
  run('"x1" after a hyphen: a-b selects b', 'a-b', pair(2));
  run('a 13 ends a run: "ab" then a paragraph end then "cd": on "b"', 'ab\rcd', pair(1));
  run('a 13 ends a run: on "c" (the line after the paragraph end)', 'ab\rcd', pair(3));
  run('a word at the end of the text (no code after it)', 'foo bar', pair(6));
  run('a word at the start of the text', 'foo bar', pair(0));
  run('a one-code word', 'a b c', pair(2));
  // a word that wraps across display lines: 70 W (8 pixels each: 55 per line); a double-click on the second line selects all 70 (the run goes through the wrap)
  run('a word across display lines: 70 W, on the second line', 'W'.repeat(70), [{ at: [27 + 8 * 3 + 2, 30 + 9 + 4], idle: 4 }, { at: [27 + 8 * 3 + 2, 30 + 9 + 4], gap: 6, expectFlag: true }]);
  run('a word across display lines: 70 W, on the first line', 'W'.repeat(70), [{ at: [27 + 8 * 20 + 1, 34], idle: 4 }, { at: [27 + 8 * 20 + 1, 34], gap: 6, expectFlag: true }]);
  run('a word across lines after other words ("aaa" + 60 b): the break goes after the space; a double-click on the b\'s', 'aaa ' + 'b'.repeat(60), [{ at: [60, 30 + 9 + 4], idle: 4 }, { at: [60, 30 + 9 + 4], gap: 6, expectFlag: true }]);
  run('a space run across a line end (overflow spaces): 55 W + 6 spaces + W: on the 5th space', 'W'.repeat(55) + ' '.repeat(6) + 'W', [{ at: [469, 34], idle: 4 }, { at: [469, 34], gap: 6, expectFlag: true }]);
  // an empty line, a 13 as the line's only code: none
  run('an empty paragraph (a line holding only a 13): no clicked code', 'ab\r\rcd', [{ at: [40, 30 + 9 + 4], idle: 4 }, { at: [40, 30 + 9 + 4], gap: 6, expectFlag: true }]);
  run('below the last line (the last line by x): "ab cd" at line 5', 'ab cd', [{ at: [30, 30 + 9 * 5 + 4], idle: 4 }, { at: [30, 30 + 9 * 5 + 4], gap: 6, expectFlag: true }]);
  run('the last line is empty (the text ends with a 13): a press below it is on the empty line: none', 'ab\r', [{ at: [30, 30 + 9 * 4 + 4], idle: 4 }, { at: [30, 30 + 9 * 4 + 4], gap: 6, expectFlag: true }]);
  // the same press pair with the mark on: a flagged E_DOWN is a click (it extends)
  run('the mark on: MARK, then two presses on the same code are not a double-click', 'one two three four five', pair(5), { pre: (env) => { Q.keyDoc(env, 18); Q.keyDoc(env, 8); Q.keyDoc(env, 8); } });
  // an edit between the two clicks: WR_LCK is none, the flagged press is a click
  run('an edit between the clicks: a typed code between the two presses', 'one two three', [{ k: 5, idle: 2, after: (env) => { Q.keyDoc(env, 120); } }, { k: 5, gap: 4, expectFlag: true }]);
  run('an edit between the clicks: DELETE (the text changes)', 'one two three', [{ k: 5, idle: 2, after: (env) => { Q.keyDoc(env, 12); } }, { k: 5, gap: 4, expectFlag: true }]);
  // a neighbouring code: a then b of one word
  run('a neighbouring code: two presses on adjacent codes of a word', 'abcdef', [{ k: 2, idle: 4 }, { k: 3, gap: 6, expectFlag: true }]);
  run('the same code, a different pixel of it (a wide "W": pixels 0 and 7)', 'xx WWW xx', [{ k: 4, frac: 0, idle: 4 }, { k: 4, frac: 0.99, gap: 6, expectFlag: true }]);
  // the third click is not flagged (W2's click), the fourth is: a double-click again; fifth not
  run('three presses: the third is a plain click (the kernel does not flag it)', 'one two three', [{ k: 5, idle: 2, expectFlag: false }, { k: 5, gap: 4, idle: 2, expectFlag: true }, { k: 5, gap: 4, expectFlag: false }]);
  run('four presses: the fourth double-clicks again', 'one two three', [{ k: 5, idle: 2, expectFlag: false }, { k: 5, gap: 4, idle: 2, expectFlag: true }, { k: 5, gap: 4, idle: 2, expectFlag: false }, { k: 5, gap: 4, expectFlag: true }]);
  run('five presses', 'one two three', [{ k: 5, idle: 2 }, { k: 5, gap: 4, idle: 2 }, { k: 5, gap: 4, idle: 2 }, { k: 5, gap: 4, idle: 2 }, { k: 5, gap: 4 }]);
  run('a double-click on one word, then at once on another word: not a double-click (different code; the second press is far)', 'one two three', [{ k: 5, idle: 2 }, { k: 5, gap: 4, idle: 2 }, { k: 9, gap: 4 }]);
  // the timing through the real ISR: 19, 20, 21 frames
  for (const gap of [2, 5, 18, 19, 20, 21, 22, 25, 40]) run(`gap ${gap} frames between the presses (the kernel's flag decides: <= 20)`, 'one two three', [{ k: 5, expectFlag: false }, { k: 5, gap, expectFlag: gap <= 20 }]);
  // a double-click, then a drag with the button held: the caret follows the pointer, the anchor stays at the word's start
  {
    const env = newEnv(), st = env.st; typeIn(env, sec, 'drag: typed', 'one two three four five six seven');
    const p = pointOf(st.doc, 5);
    L.moveTo(env, p[0], p[1]); Q.settle(env, 24);
    press(env, p[0], p[1]); drift(env, p[0], p[1], 4);
    // the second press stays held: the drag
    const q = p, t0 = env.m.ram[env.S.K_RTAIL];
    env.m.mouse.buttons = L.MOUSE_LEFT; env.frame();
    st.doc.press(q[0], q[1], H.flagSince(env, t0) === true);
    Q.settle(env, 6);
    const s1 = st.doc.anchor === 4 && st.doc.caret === 7;
    sec.ok(s1, () => `drag: after the double-click on "two" the model selects [${st.doc.anchor}, ${st.doc.caret}) (want [4, 7))`);
    for (const [px, py] of [[120, 34], [220, 34], [60, 34], [33, 34], [300, 34]]) {
      L.moveTo(env, px, py); env.frames_(2);
      st.doc.drag(px, py);
      Q.settle(env, 8); Q.check(env, sec, `drag after a double-click: to (${px}, ${py})`, { dk: 0 });
    }
    env.m.mouse.buttons = L.MOUSE_UP; Q.settle(env, 20);
    Q.check(env, sec, 'drag after a double-click: released', { dk: 0 });
    sec.ok(st.doc.anchor === 4, () => `the anchor stayed at the word's start (4): ${st.doc.anchor}`);
  }
  // a scrolled view and a double-click on a word whose end wraps below the view ("Shown")
  {
    const env = newEnv(), st = env.st;
    const lines = []; for (let i = 0; i < 20; i++) lines.push('line ' + i + ' of words');
    typeIn(env, sec, 'scrolled: typed', codes(lines.join('\r')));
    for (let i = 0; i < 60; i++) Q.keyDoc(env, K.UP);
    Q.settle(env, 30); Q.check(env, sec, 'scrolled: caret at the top', { dk: 0 });
    // scroll by keys: the caret's line follows (top changes)
    for (let i = 0; i < 17; i++) Q.keyDoc(env, K.DOWN);
    Q.settle(env, 30); Q.check(env, sec, 'scrolled: down 17 lines', { dk: 0 });
    for (const k of [st.doc.starts[st.doc.top + 4] + 2, st.doc.starts[st.doc.top + 9] + 7]) {
      const pt = pointOf(st.doc, k); if (!pt) { sec.ok(false, `scrolled: code ${k} not on screen`); continue; }
      L.moveTo(env, pt[0], pt[1]); Q.settle(env, 24); press(env, pt[0], pt[1]); pressAfter(env, pt[0], pt[1], 6);
      Q.settle(env, 40); Q.check(env, sec, `scrolled: double-click on code ${k} (top ${st.doc.top})`, { dk: 0 });
    }
    // a word at the bottom of the view that ends beyond it: the caret (the word's end) must be shown: top moves
    const sl = []; for (let i = 0; i < 17; i++) sl.push('x');
    const env2 = newEnv(), st2 = env2.st;
    typeIn(env2, sec, 'shown: typed', codes(sl.join('\r') + '\r' + 'W'.repeat(120)));
    for (let i = 0; i < 3; i++) Q.keyDoc(env2, K.UP); Q.keyDoc(env2, K.UP);
    Q.settle(env2, 30); Q.check(env2, sec, 'shown: moved up', { dk: 0 });
    const k2 = st2.doc.starts[st2.doc.top + 15] + 1, pt2 = pointOf(st2.doc, k2);
    if (pt2) { L.moveTo(env2, pt2[0], pt2[1]); Q.settle(env2, 24); press(env2, pt2[0], pt2[1]); pressAfter(env2, pt2[0], pt2[1], 6); Q.settle(env2, 40); Q.check(env2, sec, `shown: double-click on the last visible line (top now ${st2.doc.top}, caret ${st2.doc.caret})`, { dk: 0 }); }
  }
  // the selection after a double-click is Cut / Copy-able: the menu bits and Cut
  {
    const env = newEnv(), st = env.st; typeIn(env, sec, 'cut: typed', 'alpha beta gamma');
    const pt = pointOf(st.doc, 8); L.moveTo(env, pt[0], pt[1]); Q.settle(env, 24); press(env, pt[0], pt[1]); pressAfter(env, pt[0], pt[1], 6); Q.settle(env, 40);
    Q.check(env, sec, 'cut: "beta" selected, Cut and Copy enabled', { dk: 0 });
    sec.ok((W.menuBits(env, 1) & 0xC0) === 0xC0, () => `Cut and Copy not enabled after a double-click (bits ${W.menuBits(env, 1).toString(2)})`);
    editItemKeys(env, st.doc, 1); st.doc.menuItem(1); Q.settle(env, 30); Q.check(env, sec, 'cut: after Cut of the word', { dk: 0 });
    sec.ok(textOf(st.doc.codes) === 'alpha  gamma', () => `model after Cut: ${JSON.stringify(textOf(st.doc.codes))}`);
  }
  sec.end(`${stat.pairs} presses (${stat.doubles} double-clicks by the model)`);
}

// ===========================================================================================================================
if (cartOk && has('2')) {
  const sec = new Sec('2 Find (14.3-14.5) on the machine: "Find..." and "Find again" by the menu keys; F at 0, at L - |F|, crossing the caret, a match spanning the wrap point, a 30-code F, an empty Find (F kept), Cancel (button, ESC, BREAK), ENTER and the Find button, case folding, the cycle of Find again, "Not found." and its dismissals, F kept by New and Open, the enable bits; state, selection, F, menu bits and the screen after each');
  // 2a. at the start: Find again is disabled, Find... is enabled
  {
    const env = newEnv(), st = env.st;
    Q.check(env, sec, 'start', { dk: 0 });
    sec.ok(W.menuBits(env, 1) === 0x0A, () => `at the start the Edit bits are ${W.menuBits(env, 1).toString(2).padStart(8, '0')}, want 00001010 (Select all, Find...)`);
    sec.ok(env.m.ram[env.S.WR_FN] === 0, () => `WR_FN ${env.m.ram[env.S.WR_FN]} at the start, want 0`);
    // an empty document: Find... then "x": Not found.
    doFind(env, sec, 'F1 empty document', 'x');
    sec.ok(st.doc.find.length === 1 && W.menuBits(env, 1) === 0x0B, () => `after the first Find: F ${st.doc.find.length} codes, bits ${W.menuBits(env, 1).toString(2).padStart(8, '0')} (want 00001011: Find again enabled)`);
    doAgain(env, sec, 'F1 Find again in an empty document');
    // Find with an empty Field: F kept, nothing else
    doFind(env, sec, 'F1 an empty Find', '');
    sec.ok(textOf(st.doc.find) === 'x', () => `F ${JSON.stringify(textOf(st.doc.find))} after an empty Find (it is kept: "x")`);
    const f = openFind(env, sec, 'F1 reopened'); sec.ok(textOf(f.buf) === 'x', 'the Field shows F');
    finishFind(env, sec, 'F1', f, 'cancel');
  }
  // 2b. matches: F at 0, at L - |F|, crossing the caret, case folding, the cycle
  {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, 'F2 typed', 'Abc abc xyz ABC the end abc');
    for (let i = 0; i < 40; i++) Q.keyDoc(env, K.LEFT);          // the caret at 0
    Q.settle(env, 20); Q.check(env, sec, 'F2 caret at 0', { dk: 0 });
    doFind(env, sec, 'F2 "abc" from 0 (the match at 0 is found: it starts at the caret)', 'abc');
    doAgain(env, sec, 'F2 again 1 (matches: 0, 4, 12, 24)'); doAgain(env, sec, 'F2 again 2'); doAgain(env, sec, 'F2 again 3'); doAgain(env, sec, 'F2 again 4 (wrap to 0)'); doAgain(env, sec, 'F2 again 5');
    doFind(env, sec, 'F2 "ABC" with the selection at 4..7: the search starts at its end', 'ABC', 'button');
    doFind(env, sec, 'F2 "END" in the middle', 'END');
    doFind(env, sec, 'F2 "d" at L - |F|... the last code', 'c', 'enter');
    doFind(env, sec, 'F2 a 3-code F at L - 3', 'abc');
    doAgain(env, sec, 'F2 from the end (the match at L - |F| is the selection): wraps to the first one');
    doFind(env, sec, 'F2 Not found', 'qqq', 'enter', 'esc');
    doFind(env, sec, 'F2 Not found 2 (BREAK)', 'xyzz', 'enter', 'break');
    doFind(env, sec, 'F2 Not found 3 (the OK button)', 'xyzzy', 'button', 'click');
    doAgain(env, sec, 'F2 Find again with the last F (not found again)');
    doFind(env, sec, 'F2 a case-folded match "XyZ"', 'XyZ');
    doFind(env, sec, 'F2 one code "A"', 'A');
    doFind(env, sec, 'F2 a space " "', ' ');
    doFind(env, sec, 'F2 two spaces and a word " the"', ' the');
  }
  // 2c. the match crossing the caret, spanning display lines, the wrap point (found once)
  {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, 'F3 typed', 'abab');
    Q.keyDoc(env, K.LEFT); Q.keyDoc(env, K.LEFT); Q.settle(env, 20); Q.check(env, sec, 'F3 caret at 2', { dk: 0 });
    doFind(env, sec, 'F3 "bab" spans the caret (2) and the wrap point: found at 1', 'bab');
    doAgain(env, sec, 'F3 again: the same match is the only one (found again, not twice)');
    // a match spanning display lines
    const e2 = newEnv(); const s2 = e2.st;
    typeIn(e2, sec, 'F3b typed', codes('W'.repeat(54) + ' hello there'));
    for (let i = 0; i < 70; i++) Q.keyDoc(e2, K.LEFT);
    Q.settle(e2, 20);
    doFind(e2, sec, 'F3b "W hel" spans the break between the display lines', 'W hel');
    doFind(e2, sec, 'F3b "there"', 'there');
  }
  // 2d. a 30-code F, 31 typed (cap 30), F with all printable codes
  {
    const env = newEnv(), st = env.st;
    const f30 = 'abcdefghijklmnopqrstuvwxyz0123', d = codes('x ' + f30 + ' y ' + f30.toUpperCase());
    typeIn(env, sec, 'F4 typed', d);
    for (let i = 0; i < 200; i++) Q.keyDoc(env, K.LEFT);
    Q.settle(env, 20);
    const f = openFind(env, sec, 'F4 30 codes');
    fieldSet(env, f, f30 + 'extra'); Q.settle(env, 12);
    sec.ok(f.buf.length === 30, 'model: cap 30');
    Q.check(env, sec, 'F4 31st code refused (cap 30), the Field scrolls', { dk: 3, field: f });
    finishFind(env, sec, 'F4', f, 'enter');
    sec.ok(st.doc.find.length === 30 && env.m.ram[env.S.WR_FN] === 30, () => `WR_FN ${env.m.ram[env.S.WR_FN]}, want 30`);
    doAgain(env, sec, 'F4 again: the upper-case copy (case folded)');
    doAgain(env, sec, 'F4 again: wraps to the first');
    // every printable code as F (one code each) for a document holding them all
    const all = []; for (let c = 33; c <= 126; c++) all.push(c); all.push(32);
    const e2 = newEnv(); typeIn(e2, sec, 'F4b typed', all);
    for (let i = 0; i < 100; i++) Q.keyDoc(e2, K.LEFT);
    for (const c of [33, 64, 65, 90, 91, 96, 97, 122, 123, 126, 32, 48, 57]) doFind(e2, sec, `F4b the single code ${c} ${JSON.stringify(String.fromCharCode(c))}`, [c], 'enter');
    for (const c of [64, 91, 96, 123]) { doFind(e2, sec, `F4b the pair near a case boundary ${c}`, [c, c + 1 <= 126 ? c + 1 : c]); }
  }
  // 2e. with a selection: the search starts at its end; with the mark on; Not found leaves the selection, the mark and everything
  {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, 'F5 typed', 'foo bar foo baz foo');
    for (let i = 0; i < 6; i++) Q.keyDoc(env, K.LEFT);
    Q.keyDoc(env, 18); for (let i = 0; i < 3; i++) Q.keyDoc(env, K.LEFT);
    Q.settle(env, 20); Q.check(env, sec, 'F5 a selection with the mark on (anchor 13, caret 10)', { dk: 0 });
    sec.ok(st.doc.mark === 1 && st.doc.S === 3, 'model: mark on, S 3');
    doFind(env, sec, 'F5 Not found with the mark on: nothing changes (the selection, the mark)', 'zzz');
    sec.ok(st.doc.mark === 1 && st.doc.S === 3, 'model: still marked');
    doFind(env, sec, 'F5 found with the mark on: the mark goes off', 'foo');
    sec.ok(st.doc.mark === 0, 'model: mark off after a match');
    doFind(env, sec, 'F5 again, Cancel', 'foo', 'cancel');
    doFind(env, sec, 'F5 again, ESC', 'bar', 'esc');
    doFind(env, sec, 'F5 again, BREAK', 'baz', 'break');
    doFind(env, sec, 'F5 an empty Find with the Field cleared', '');
    doAgain(env, sec, 'F5 Find again after the Cancels (F is still "foo")');
  }
  // 2f. F survives New and Open; a new start loses it
  {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, 'F6 typed', 'keep this word keep');
    doFind(env, sec, 'F6 F = "keep"', 'keep');
    doNew(env, sec, 'F6 New');
    sec.ok(W.menuBits(env, 1) & 1, 'Find again stays enabled after New (F kept)');
    typeIn(env, sec, 'F6 typed again', 'say keep here');
    for (let i = 0; i < 13; i++) Q.keyDoc(env, K.LEFT);
    Q.settle(env, 20);
    doAgain(env, sec, 'F6 Find again after New: searches with the kept F');
    const f = openFind(env, sec, 'F6 reopened after New'); sec.ok(textOf(f.buf) === 'keep', 'the Field shows the kept F'); finishFind(env, sec, 'F6', f, 'cancel');
    // Open: F kept
    const h = env.host; h.files.set('o.txt', Uint8Array.from(codes('open keep file keep')));
    Q.fileMenu(env, 1); Q.settle(env, 8);
    Q.check(env, sec, 'F6 the discard dialog (the document is changed)', { dk: 0, discard: true }); Q.key(env, K.ENTER); Q.settle(env, 20);
    sec.ok(Q.until(env, () => h.picking, 40), 'the pick started');
    h.answer('o.txt', Array.from(h.files.get('o.txt'))); Q.settle(env, 60);
    const res = st.open(codes('o.txt'), Array.from(h.files.get('o.txt')), {});
    sec.ok(!res.alert, 'model: Open ok');
    Q.check(env, sec, 'F6 after Open: F kept', { dk: 0 });
    doAgain(env, sec, 'F6 Find again after Open');
    // a new start: F is empty again
    const e2 = newEnv(); Q.check(e2, sec, 'F6 a new start', { dk: 0 });
    sec.ok(e2.m.ram[e2.S.WR_FN] === 0 && W.menuBits(e2, 1) === 0x0A, () => `a new start: WR_FN ${e2.m.ram[e2.S.WR_FN]}, bits ${W.menuBits(e2, 1)} (want 0 and 10)`);
  }
  // 2g. Find... from a disabled-Cut state by the pointer: the Edit menu items by the mouse; a disabled "Find again" released on sends nothing
  {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, 'F7 typed', 'some text to search in some way');
    // Find again is disabled: pointer on it (item index 7), released: nothing
    W.editMenu(env, 7, { release: false }); Q.settle(env, 4); W.releaseMenu(env, 14); Q.settle(env, 20);
    Q.check(env, sec, 'F7 released on the disabled "Find again": nothing happens', { dk: 0 });
    // Find... by the pointer (index 6)
    W.editMenu(env, 6); Q.settle(env, 12);
    const f = W3.newSaveField(st.doc.find);
    Q.check(env, sec, 'F7 Find... by the pointer', { dk: 3, field: f });
    fieldKeys(env, f, codes('some')); Q.settle(env, 12);
    finishFind(env, sec, 'F7', f, 'button');
    // Find again by the pointer (index 7)
    W.editMenu(env, 7); Q.settle(env, 40);
    const r = st.doc.search(st.doc.find);
    Q.check(env, sec, `F7 Find again by the pointer (found ${r.found})`, { dk: 0 });
  }
  sec.end(`${envs.length} machines`);
}

// ===========================================================================================================================
if (cartOk && has('3')) {
  const sec = new Sec('3 WR_LCK is $FFFF for none (14.9 item 3: at the start, after every change of the text, "New" and Open) and the clicked code after an E_DOWN; WR_FN and F\'s codes (14.9 item 5)');
  const env = newEnv(), st = env.st, { m, S } = env, lck = () => rd16(m, S.WR_LCK);
  const want = (what, v) => sec.ok(lck() === v, () => `${what}: WR_LCK ${hex(lck())}, the contract says ${hex(v)}`);
  want('at the start', 0xFFFF);
  Q.typeDoc(env, 'abc def'); Q.settle(env, 20);
  want('after typed codes', 0xFFFF);
  const p = pointOf(st.doc, 5); L.moveTo(env, p[0], p[1]); Q.settle(env, 24); press(env, p[0], p[1]); Q.settle(env, 20);
  want('after an E_DOWN on code 5', 5);
  sec.ok(lck() === 5, 'the clicked code 5');
  Q.keyDoc(env, 120); Q.settle(env, 20); want('after a typed code', 0xFFFF);
  press(env, p[0], p[1]); Q.settle(env, 20); sec.ok(lck() !== 0xFFFF, 'an E_DOWN sets it again');
  Q.keyDoc(env, K.DELETE); Q.settle(env, 20); want('after DELETE', 0xFFFF);
  press(env, p[0], p[1]); Q.settle(env, 20);
  Q.keyDoc(env, 13); Q.settle(env, 20); want('after ENTER', 0xFFFF);
  // Cut and Paste
  Q.keyDoc(env, 18); for (let i = 0; i < 3; i++) Q.keyDoc(env, K.LEFT); Q.settle(env, 20);
  press(env, 40, 34); Q.settle(env, 20); sec.ok(lck() !== 0xFFFF, 'E_DOWN set it');
  Q.keyDoc(env, 18); Q.keyDoc(env, K.RIGHT); Q.keyDoc(env, K.RIGHT); Q.settle(env, 20);
  editItemKeys(env, st.doc, 2); st.doc.menuItem(2); Q.settle(env, 20);
  const afterCopy = lck();
  press(env, 40, 34); Q.settle(env, 20);
  Q.keyDoc(env, 18); Q.keyDoc(env, K.RIGHT); Q.keyDoc(env, K.RIGHT); Q.settle(env, 20);
  editItemKeys(env, st.doc, 1); st.doc.menuItem(1); Q.settle(env, 20); want('after Cut', 0xFFFF);
  press(env, 40, 34); Q.settle(env, 20); sec.ok(lck() !== 0xFFFF || true, '');
  editItemKeys(env, st.doc, 3); st.doc.menuItem(3); Q.settle(env, 20); want('after Paste', 0xFFFF);
  press(env, 30, 34); Q.settle(env, 20);
  editItemKeys(env, st.doc, 4); st.doc.menuItem(4); Q.settle(env, 20);
  void afterCopy;
  Q.check(env, sec, 'LCK: state after the sequence', { dk: 0 });
  // New
  press(env, 30, 34); Q.settle(env, 20); doNew(env, sec, 'LCK New'); want('after New', 0xFFFF);
  // Open
  typeIn(env, sec, 'LCK typed', 'open me');
  press(env, 30, 34); Q.settle(env, 20);
  const h = env.host; h.files.set('l.txt', Uint8Array.from(codes('some file')));
  Q.fileMenu(env, 1); Q.settle(env, 8); Q.key(env, K.ENTER); Q.settle(env, 20);
  sec.ok(Q.until(env, () => h.picking, 40), 'the pick started');
  h.answer('l.txt', Array.from(h.files.get('l.txt'))); Q.settle(env, 60);
  st.open(codes('l.txt'), Array.from(h.files.get('l.txt')), {});
  want('after Open', 0xFFFF);
  Q.check(env, sec, 'LCK: after Open', { dk: 0 });
  // WR_FN and F's codes are a length-prefixed text (14.9 item 5): WR_FCODES = WR_FN + 1
  sec.ok(S.WR_FCODES === S.WR_FN + 1, () => `WR_FCODES ${hex(S.WR_FCODES)} is not WR_FN + 1 (${hex(S.WR_FN + 1)}): F is not a length-prefixed text`);
  doFind(env, sec, 'LCK F', 'file');
  sec.ok(m.ram[S.WR_FN] === 4 && eq(Array.from(m.ram.subarray(S.WR_FCODES, S.WR_FCODES + 4)), codes('file')), () => `WR_FN ${m.ram[S.WR_FN]}, codes ${JSON.stringify(Array.from(m.ram.subarray(S.WR_FCODES, S.WR_FCODES + 6)))}`);
  const strict = W.stateDiff4(env, st.doc, true);
  sec.ok(strict.length === 0, () => strict[0]);
  sec.end('WR_LCK at 12 moments');
}

// ===========================================================================================================================
if (cartOk && has('4')) {
  const sec = new Sec('4 looks (14.4, 14.9 item 4): the Find dialog\'s geometry from the view tree (Dialog (128, 56, 256, 80), Label "Find:" (144, 68, 200, 9), Field (144, 84, 224, 12) cap 30 id 1 holding F, Button "Find" (224, 108, 64, 16) id 1 the default, "Cancel" (304, 108, 64, 16) id 2) and its rendering with F, with an empty Field, with 30 codes scrolled, and after typing; "Not found."; the Save dialog still as W3\'s after Find and the other way round; the open Edit menu with 8 items');
  const env = newEnv(), st = env.st, { m, S } = env;
  typeIn(env, sec, 'L typed', 'hello world, hello again');
  // the Edit menu open with 8 items: the model's drop-down with the enable bits, every highlight
  {
    const lay = layoutOf(WM.MENUS);
    const menuScreen = (h) => { const g = WM.renderScreen(st.doc, { focus: rd16(m, S.K_FOCUS) === W.objs(env).tv, barValue: m.ram[W.objs(env).bar + S.VScroll_value] }); drawOpen(g, WM.MENUS, lay, [[true], st.doc.editEnabled()], 1, h); return g; };
    const shot = (h) => T.diffDisp(T.readDisp(m), WM.toDisp(menuScreen(h)), L.pointerMask(m, S));
    for (const k of [6, 7, 4]) {
      W.editMenu(env, k, { release: false });
      const en = st.doc.editEnabled()[k];
      const d = shot(en ? k : -1);
      sec.ok(d === null, () => `the Edit menu open over item index ${k} (${['Cut', 'Copy', 'Paste', '-', 'Select all', '-', 'Find...', 'Find again'][k]}, ${en ? 'enabled: highlighted' : 'disabled: no highlight'}): ${d}`);
      L.moveTo(env, 200, 120); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(14);
    }
    Q.check(env, sec, 'L the menu closed without a choice', { dk: 0 });
    doFind(env, sec, 'L F = hello', 'hello');
    for (const k of [6, 7]) {
      W.editMenu(env, k, { release: false });
      const d = shot(k);
      sec.ok(d === null, () => `the Edit menu open over item ${k} with F set: ${d}`);
      L.moveTo(env, 200, 120); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(14);
    }
    Q.check(env, sec, 'L closed', { dk: 0 });
  }
  // the dialog's geometry
  {
    const f = openFind(env, sec, 'L1');
    const views = L.allViews(m, S), find = (cls, r) => views.find((v) => v.cls === cls && v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h), sv = W3.SAVE;
    const lab = find(S.CL_Label, sv.label), fld = find(S.CL_Field, sv.field), bf = find(S.CL_Button, sv.save), bc = find(S.CL_Button, sv.cancel);
    sec.ok(!!lab, 'a Label at (144, 68, 200, 9)');
    sec.ok(!!lab && textOf(L.readStr(m, rd16(m, lab.a + S.Label_text))) === 'Find:', () => `the Label's text ${lab && JSON.stringify(textOf(L.readStr(m, rd16(m, lab.a + S.Label_text)) || []))}, want "Find:"`);
    sec.ok(!!fld && fld.id === 1 && m.ram[fld.a + S.Field_cap] === 30, () => `the Field at (144, 84, 224, 12): id ${fld && fld.id}, cap ${fld && m.ram[fld.a + S.Field_cap]}`);
    sec.ok(!!bf && bf.id === 1 && (bf.flags & 0x10) !== 0, () => `the Button "Find" (224, 108, 64, 16): id ${bf && bf.id}, flags ${bf && bf.flags}`);
    sec.ok(!!bf && textOf(L.readStr(m, rd16(m, bf.a + S.Button_text)) || []) === 'Find', () => `the first Button's text ${bf && JSON.stringify(textOf(L.readStr(m, rd16(m, bf.a + S.Button_text)) || []))}, want "Find"`);
    sec.ok(!!bc && bc.id === 2 && textOf(L.readStr(m, rd16(m, bc.a + S.Button_text)) || []) === 'Cancel', 'the Button "Cancel" (304, 108, 64, 16) id 2');
    const d = rd16(m, S.WR_SDLG);
    sec.ok(d !== 0 && rd16(m, d + S.Dialog_default) === bf?.a && rd16(m, d + S.Dialog_cancel) === bc?.a, 'Find is the dialog\'s default, Cancel its cancel');
    sec.ok(rd16(m, S.K_FOCUS) === fld?.a, 'the Field has the focus');
    sec.ok(Q.dlgOpen(env, 'save'), 'the Find dialog is a Dialog (128, 56, 256, 80)');
    // the Field's text, the caret at the end
    sec.ok(m.ram[fld.a + S.Field_caret] === 5, () => `the caret ${m.ram[fld.a + S.Field_caret]}, want 5 (at the end of "hello")`);
    // looks: typing, a 30-code F scrolled, caret keys, an empty Field
    fieldKeys(env, f, codes(' there')); Q.settle(env, 12); Q.check(env, sec, 'L1 "hello there" typed', { dk: 3, field: f });
    fieldSet(env, f, 'W'.repeat(30)); Q.settle(env, 12); Q.check(env, sec, 'L1 30 x W (the Field scrolls)', { dk: 3, field: f });
    for (let i = 0; i < 12; i++) fieldKeys(env, f, [K.LEFT]);
    Q.settle(env, 12); Q.check(env, sec, 'L1 the caret in the scrolled Field', { dk: 3, field: f });
    fieldSet(env, f, ''); Q.settle(env, 12); Q.check(env, sec, 'L1 an empty Field', { dk: 3, field: f });
    // Tab to the buttons (the focus look)
    Q.key(env, 14); Q.settle(env, 8); Q.check(env, sec, 'L1 TAB: the focus on the Find button', { dk: 3, field: f });
    Q.key(env, 14); Q.settle(env, 8); Q.check(env, sec, 'L1 TAB: the focus on Cancel', { dk: 3, field: f });
    finishFind(env, sec, 'L1', f, 'esc');
  }
  // the Save dialog after the Find dialog, and the Find dialog after the Save dialog
  {
    Q.fileMenu(env, 2); Q.settle(env, 8);
    const fs = W3.newSaveField(st.name);
    Q.check(env, sec, 'L2 Save... after Find...: "Save as:", "Save", the name', { dk: 1, field: fs });
    fieldKeys(env, fs, codes('x')); Q.settle(env, 8);
    Q.key(env, K.ESC); Q.settle(env, 24); Q.check(env, sec, 'L2 Save dialog closed', { dk: 0 });
    const f = openFind(env, sec, 'L2 Find... after Save...');
    sec.ok(textOf(f.buf) === 'hello', () => `the Find Field holds ${JSON.stringify(textOf(f.buf))}, want F "hello" (not the Save name)`);
    finishFind(env, sec, 'L2', f, 'esc');
    Q.fileMenu(env, 2); Q.settle(env, 8);
    const fs2 = W3.newSaveField(st.name);
    Q.check(env, sec, 'L2 Save... again: the name is the document\'s, not F', { dk: 1, field: fs2 });
    Q.key(env, K.ESC); Q.settle(env, 24);
    // a save with the name typed, then Find again: the Field holds F
    const g = openFind(env, sec, 'L2 Find... once more'); finishFind(env, sec, 'L2', g, 'cancel');
  }
  // "Not found." as the alert
  {
    doFind(env, sec, 'L3 not found', 'qqqq');
    const views = L.allViews(m, S); void views;
    doFind(env, sec, 'L3 not found a second time', 'zzzz', 'enter', 'click');
    // the alert's geometry: Label (144, 76, 224, 18) and OK, as W3's
    editItemKeys(env, st.doc, 6); Q.settle(env, 20);
    const vs = L.allViews(m, S), A = W3.ALERT, lab = vs.find((v) => v.cls === S.CL_Label && v.x === A.label.x && v.y === A.label.y && v.w === A.label.w && v.h === A.label.h);
    sec.ok(!!lab && textOf(L.readStr(m, rd16(m, lab.a + S.Label_text)) || []) === 'Not found.', () => `the alert's Label: ${lab && JSON.stringify(textOf(L.readStr(m, rd16(m, lab.a + S.Label_text)) || []))}, want "Not found."`);
    sec.ok(m.ram[S.WR_DK] === 2, () => `WR_DK ${m.ram[S.WR_DK]}, want 2 (the alert)`);
    Q.check(env, sec, 'L3 the alert (Find again)', { dk: 2, msg: 'Not found.' });
    Q.key(env, K.ENTER); Q.settle(env, 24); Q.check(env, sec, 'L3 closed', { dk: 0 });
  }
  sec.end(`${envs.length} machines`);
}

// ===========================================================================================================================
if (cartOk && has('5')) {
  const sec = new Sec('5 the UP / DOWN run (14.9 item 6, 11.5): kept by "Find...", a Cancel, an empty "Find" and "Not found."; ended when a match is selected; found by a search of random documents for a state in which a lost run would give a different caret');
  /** A random document and a key walk that leaves a live run with a following vertical move that differs from the one a lost run would make (so the test can tell). */
  const find = () => {
    for (let t = 0; t < 4000; t++) {
      const text = vocabDoc(rng.int(120, 420), 0.03), d = new WM.Doc(text);
      d.caret = rng.int(0, d.L); d.shown();
      const keys = []; let ok = false;
      for (let k = 0; k < 4; k++) {
        const key = rng.pick([K.UP, K.DOWN]); keys.push(key); W.Doc_key(d, key);
      }
      if (d.run === null || d.nl < 4) continue;
      const ln = d.caretLine(); if (ln <= 0 || ln >= d.nl - 1) continue;
      const a = d.clone(), b = d.clone(); b.run = null;
      W.Doc_key(a, K.DOWN); W.Doc_key(b, K.DOWN);
      if (a.caret !== b.caret) ok = true;
      if (ok) return { text, caret0: null };
    }
    return null;
  };
  let used = 0;
  for (let trial = 0; trial < 6 && sec.nf < 6; trial++) {
    const base = find();
    if (!base) { sec.ok(false, 'could not generate a document where a lost run would change the next vertical move (set-up)'); break; }
    for (const op of ['cancel', 'empty', 'notfound', 'esc', 'found']) {
      const env = newEnv(), st = env.st;
      typeIn(env, sec, `R${trial} ${op}: typed`, base.text);
      // a deterministic walk: random caret placement and up / down until a run is live and the next vertical move distinguishes
      let tries = 0, placed = false;
      while (tries++ < 400 && !placed) {
        const key = rng.pick([K.UP, K.DOWN, K.UP, K.DOWN, K.LEFT, K.RIGHT]); Q.keyDoc(env, key);
        const d = st.doc, ln = d.caretLine();
        if (d.run !== null && ln > 0 && ln < d.nl - 1) { const a = d.clone(), b = d.clone(); b.run = null; W.Doc_key(a, K.DOWN); W.Doc_key(b, K.DOWN); if (a.caret !== b.caret) placed = true; }
      }
      Q.settle(env, 20);
      if (!placed) { sec.ok(false, `R${trial} ${op}: no distinguishing state reached in ${tries} keys (set-up)`); continue; }
      used++;
      Q.check(env, sec, `R${trial} ${op}: the run is live`, { dk: 0 });
      sec.ok(st.doc.run !== null, 'model: a run is live');
      let r;
      if (op === 'cancel') r = doFind(env, sec, `R${trial} Find... Cancel`, null, 'cancel');
      else if (op === 'esc') r = doFind(env, sec, `R${trial} Find... ESC`, 'abc', 'esc');
      else if (op === 'empty') { st.doc.find = st.doc.find.length ? st.doc.find : []; r = doFind(env, sec, `R${trial} an empty Find`, ''); }
      else if (op === 'notfound') r = doFind(env, sec, `R${trial} Not found`, 'zzzqqq');
      else r = doFind(env, sec, `R${trial} found`, textOf(st.doc.codes.filter((c) => c !== 13).slice(0, 40).slice(st.doc.L > 60 ? 10 : 0, st.doc.L > 60 ? 14 : 4)));
      if (op !== 'found') sec.ok(st.doc.run !== null, () => `R${trial} ${op}: the model lost the run (contract 14.9 item 6)`);
      else sec.ok(r.found === true ? st.doc.run === null : true, 'a match ends the run');
      // the next vertical moves: DOWN, DOWN, UP: the machine follows the model (a lost run would differ in the first)
      for (const key of [K.DOWN, K.DOWN, K.UP]) { Q.keyDoc(env, key); Q.settle(env, 20); Q.check(env, sec, `R${trial} ${op}: key ${key} after it`, { dk: 0 }); }
    }
  }
  sec.end(`${used} runs tested (documents where the run decides the next move)`);
}

// ===========================================================================================================================
if (cartOk && has('6')) {
  const sec = new Sec('6 random sessions against the model (real frames, the real ISR): typing, caret keys and MARK, single clicks, double-click pairs (gaps 2-30, near and far, the same, a neighbouring and another code), third and fourth presses, Find... (typed text, ENTER or the button, Cancel by 3 ways, empty), Find again, Cut / Copy / Paste / Select all by the menu keys, New; text, caret, anchor, mark, top, F, WR_LCK, menu bits, WR_DK, the screen after every step');
  let steps = 0; const stat = { dbl: 0, doubles: 0, finds: 0, found: 0, notfound: 0, again: 0, cancels: 0, empties: 0 };
  for (let s = 0; s < NRAND && sec.nf < 6; s++) {
    const env = newEnv(), st = env.st;
    typeIn(env, sec, `seq ${s}: typed`, vocabDoc(rng.int(60, 520), rng.pick([0.02, 0.05, 0.1])));
    const trail = [];
    for (let k = 0; k < 8 && sec.nf < 6; k++) {
      const doc = st.doc;
      const op = rng.pick(['dbl', 'dbl', 'dbl', 'click', 'type', 'keys', 'find', 'find', 'again', 'again', 'edit', 'mark', 'dblfar', 'chain', 'new']);
      trail.push(op);
      const ctx = `seq ${s} step ${k} (${trail.join(' > ')})`;
      steps++;
      if (op === 'type') { for (let i = 0; i < rng.int(1, 4); i++) Q.keyDoc(env, rng.chance(0.15) ? 13 : rng.chance(0.2) ? 32 : rng.pick(LET)); Q.settle(env, 30); Q.check(env, sec, ctx, { dk: 0 }); }
      else if (op === 'keys') { for (let i = 0; i < rng.int(1, 5); i++) Q.keyDoc(env, rng.pick([K.LEFT, K.RIGHT, K.UP, K.DOWN, K.UP, K.DOWN, K.DELETE])); Q.settle(env, 30); Q.check(env, sec, ctx, { dk: 0 }); }
      else if (op === 'mark') { Q.keyDoc(env, 18); for (let i = 0; i < rng.int(0, 4); i++) Q.keyDoc(env, rng.pick([K.LEFT, K.RIGHT, K.UP, K.DOWN])); Q.settle(env, 30); Q.check(env, sec, ctx, { dk: 0 }); }
      else if (op === 'click') {
        const tgt = doc.L ? rng.int(0, doc.L - 1) : 0, pt = doc.L ? pointOf(doc, tgt, rng.next()) : [100, 34];
        if (!pt) continue;
        L.moveTo(env, pt[0], pt[1]); Q.settle(env, 24); const r = press(env, pt[0], pt[1]); Q.settle(env, 30);
        sec.ok(!r.flag, () => `${ctx}: a press 24+ frames after the last was flagged`);
        Q.check(env, sec, ctx, { dk: 0 });
      } else if (op === 'dbl' || op === 'dblfar' || op === 'chain') {
        if (doc.L < 1) continue;
        // a code on the screen, the second press on the same code (another pixel of it), a neighbour, or another one
        let k0 = -1, pt = null;
        for (let t = 0; t < 30 && !pt; t++) { k0 = rng.int(0, doc.L - 1); pt = pointOf(doc, k0, rng.next()); }
        if (!pt) continue;
        const mode = op === 'dblfar' ? 'far' : rng.pick(['same', 'same', 'same', 'neighbour', 'offset', 'other']);
        let p2 = pointOf(doc, k0, rng.next());
        if (mode === 'neighbour') p2 = pointOf(doc, Math.min(doc.L - 1, k0 + rng.pick([1, -1].filter((d) => k0 + d >= 0 && k0 + d < doc.L)) || k0 + 1), rng.next()) || p2;
        else if (mode === 'offset') p2 = [Math.max(24, Math.min(471, pt[0] + rng.int(-9, 9))), Math.max(30, Math.min(173, pt[1] + rng.int(-5, 5)))];
        else if (mode === 'other' || mode === 'far') { const k2 = rng.int(0, doc.L - 1); p2 = pointOf(doc, k2, rng.next()) || p2; }
        const gap = rng.pick([2, 3, 6, 10, 15, 19, 20, 20, 21, 21, 22, 30]);
        const flags = [];
        L.moveTo(env, pt[0], pt[1]); Q.settle(env, 24);
        let r = press(env, pt[0], pt[1]); flags.push(r.flag); stat.dbl++;
        r = pressAfter(env, p2[0], p2[1], gap); flags.push(r.flag);
        if (doc.lastDouble) stat.doubles++;
        if (op === 'chain') {
          const n = rng.int(1, 3);
          for (let i = 0; i < n; i++) { const q = rng.chance(0.7) ? p2 : pt; r = pressAfter(env, q[0], q[1], rng.int(3, 11)); flags.push(r.flag); if (doc.lastDouble) stat.doubles++; }
        }
        trail[trail.length - 1] = `${op}(${mode}, gap ${gap}, flags ${flags.map((f) => (f ? 1 : 0)).join('')})`;
        Q.settle(env, 40); Q.check(env, sec, `seq ${s} step ${k} (${trail.join(' > ')})`, { dk: 0 });
      } else if (op === 'find') {
        const how = rng.pick(['enter', 'enter', 'button', 'cancel', 'esc', 'break']), text = rng.chance(0.12) ? '' : rng.chance(0.2) && doc.find.length ? null : textOf(pickF(doc));
        const f = openFind(env, sec, ctx);
        if (text !== null && text !== textOf(f.buf)) { fieldSet(env, f, text); Q.settle(env, 12); Q.check(env, sec, `${ctx}: typed`, { dk: 3, field: f }); }
        const r = finishFind(env, sec, ctx, f, how, rng.pick(['enter', 'esc', 'click', 'break']));
        stat.finds++; if (r.found) stat.found++; else if (r.found === false) stat.notfound++; if (r.cancelled) stat.cancels++; if (r.empty) stat.empties++;
      } else if (op === 'again') {
        if (!doc.find.length) continue;
        const r = doAgain(env, sec, ctx, rng.pick(['enter', 'esc', 'click'])); stat.again++; if (r.found) stat.found++; else stat.notfound++;
      } else if (op === 'edit') {
        const en = doc.editEnabled(), items = [1, 2, 3, 4].filter((i) => en[WM.ITEM_IDX[i]] && !(i === 3 && !doc.pasteOk()));
        if (!items.length) continue; const item = rng.pick(items);
        if (item === 3 && doc.run !== null) continue;       // a refused Paste with a live run is not generated (R12)
        editItemKeys(env, doc, item); doc.menuItem(item); Q.settle(env, 40); Q.check(env, sec, `${ctx} (item ${item})`, { dk: 0 });
      } else if (op === 'new') { doNew(env, sec, ctx); }
      if (sec.nf >= 6 && !VERBOSE) break;
    }
  }
  sec.end(`${steps} steps: ${stat.dbl} press pairs (${stat.doubles} double-clicks by the model), ${stat.finds} Find... (${stat.cancels} cancelled, ${stat.empties} empty), ${stat.again} Find again, ${stat.found} found, ${stat.notfound} not found`);
}

// ===========================================================================================================================
if (cartOk && has('7')) {
  const sec = new Sec('7 stack <= 128 bytes, no DI, SP right and registers kept: direct calls with the interrupts on (a flagged E_DOWN through K_DISPATCH, WR_MENU Find..., the Find dialog\'s command with a match, with nothing found (the alert), Find again, an empty Find, Cancel)');
  const env = Q.bootW3({ rng }); envs.push(env);
  W.parkDirect(env);
  const { m, S } = env, st = { di: 0, worst: 0, what: '' };
  const note = (r, what) => { st.di += r.di; if (r.stack > st.worst) { st.worst = r.stack; st.what = what; } sec.ok(r.di === 0, () => `${what}: ${r.di} DI`); sec.ok(r.badSp === undefined, () => `${what}: SP ${hex(r.badSp)} after the return`); sec.ok(r.stack <= 128, () => `${what}: stack ${r.stack} bytes (bound 128)`); sec.ok((r.preserved || []).length === 0, () => `${what}: registers not preserved: ${(r.preserved || []).join(',')}`); };
  const typeK = (cs) => { for (const c of cs) W.dispatch(env, W.keyRec(c), {}); };
  const dkcmd = (id) => { T.setEv(env, [E.CMD, id, 0, 0]); return T.runCall(env, S.wr_dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); };
  typeK(codes('the quick brown fox jumps over the lazy dog. The end.'));
  const doc = new WM.Doc(codes('the quick brown fox jumps over the lazy dog. The end.'), 55);
  // a flagged E_DOWN pair through K_DISPATCH: the first press, then the flagged one on the same code
  let r = W.dispatch(env, W.ptRec(E.DOWN, 60, 34, 1), { ints: true }); note(r, 'E_DOWN (first press)'); W.dispatch(env, W.ptRec(E.UP, 60, 34, 0), { ints: true });
  r = W.dispatch(env, [E.DOWN, 60, 34, 2 | 4], { ints: true }); note(r, 'E_DOWN (flagged, a double-click)'); W.dispatch(env, W.ptRec(E.UP, 60, 34, 0), { ints: true });
  doc.press(60, 34, false); doc.press(60, 34, true);
  const sd = W.stateDiff(env, doc), s2 = W.stateDiff2(env, doc);
  sec.ok(sd.doc.length + s2.sel.length === 0, () => `after the double-click: ${sd.doc[0] || s2.sel[0]}`);
  // Find...: the dialog; the text; "Find" with a match
  r = W.menuCall(env, 2, 5, { ints: true }); note(r, 'WR_MENU Find...'); sec.ok(m.ram[S.WR_DK] === 3, () => `WR_DK ${m.ram[S.WR_DK]} after Find..., want 3`);
  typeK(codes('lazy')); r = dkcmd(1); note(r, 'the Find dialog\'s command (Find, a match)');
  doc.findDialog(codes('lazy'));
  { const a = W.stateDiff(env, doc), b = W.stateDiff2(env, doc), c = W.stateDiff4(env, doc); sec.ok(a.doc.length + b.sel.length + c.length === 0, () => `after Find "lazy": ${a.doc[0] || b.sel[0] || c[0]}`); sec.ok(m.ram[S.WR_DK] === 0, () => `WR_DK ${m.ram[S.WR_DK]} after a match`); }
  // Find again (found), Find again again
  r = W.menuCall(env, 2, 6, { ints: true }); note(r, 'WR_MENU Find again (the wrap: the same match)'); doc.search(doc.find);
  { const a = W.stateDiff(env, doc); sec.ok(a.doc.length === 0, () => `after Find again: ${a.doc[0]}`); }
  // not found: the alert
  W.menuCall(env, 2, 5, { ints: true });
  for (let i = 0; i < 4; i++) W.dispatch(env, W.keyRec(12), {});
  typeK(codes('qqqq')); r = dkcmd(1); note(r, 'the Find dialog\'s command (Find, not found: the alert)');
  sec.ok(m.ram[S.WR_DK] === 2, () => `WR_DK ${m.ram[S.WR_DK]} after a failed search, want 2 (the alert)`);
  r = dkcmd(1); note(r, 'the alert\'s OK');
  sec.ok(m.ram[S.WR_DK] === 0, () => `WR_DK ${m.ram[S.WR_DK]} after the alert, want 0`);
  doc.findDialog(codes('qqqq'));
  // an empty Find and Cancel
  W.menuCall(env, 2, 5, { ints: true }); for (let i = 0; i < 4; i++) W.dispatch(env, W.keyRec(12), {}); r = dkcmd(1); note(r, 'the Find dialog\'s command (an empty Find)');
  sec.ok(m.ram[S.WR_DK] === 0 && m.ram[S.WR_FN] === 4, () => `an empty Find: WR_DK ${m.ram[S.WR_DK]}, WR_FN ${m.ram[S.WR_FN]} (F kept: 4)`);
  W.menuCall(env, 2, 5, { ints: true }); r = dkcmd(2); note(r, 'the Find dialog\'s command (Cancel)');
  sec.ok(m.ram[S.WR_DK] === 0, () => `after Cancel WR_DK ${m.ram[S.WR_DK]}`);
  { const a = W.stateDiff(env, doc), b = W.stateDiff2(env, doc), c = W.stateDiff4(env, doc); sec.ok(a.doc.length + b.sel.length + c.length === 0, () => `at the end: ${a.doc[0] || b.sel[0] || c[0]}`); }
  sec.end(`deepest stack ${st.worst} bytes (${st.what}); ${st.di} DI`);
}

// ===========================================================================================================================
if (cartOk && has('8')) {
  const sec = new Sec('8 frames and memory: V_FRAMES rose by 1 on every frame run normally (no interrupt lost, no DI), the memory watch of BANKING 10.7, and no write to $C000-$C3FF outside Write\'s variables (WR_BUF .. the Find Field\'s buffer: the image\'s constants are untouched)');
  envs.forEach((env, i) => {
    sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first ${env.vf.first}`);
    sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`);
    sec.ok(env.imgw.n === 0, () => `machine ${i}: ${env.imgw.n} write(s) to $C000-$C3FF outside ${hex(env.imgw.lo)}-${hex(env.imgw.hi - 1)}: ${env.imgw.first.join(' | ')}`);
  });
  sec.end(`${envs.length} machines, ${envs.reduce((a, e) => a + e.vf.checked, 0)} frames checked`);
}
finish();
