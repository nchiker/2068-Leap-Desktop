"use strict";
// wr-demo.mjs -- Write W1 over real frames, from the shell (docs/WRITE.md 8 items 3-5 and 11; SHELL 4, 10.4) on the prebuilt `desk5` cartridge (never rebuilt here), driven with TSRun's keyboard (the
// key map src/kernel/keymap.txt: CAPS SHIFT / SYMBOL SHIFT combinations) and Kempston mouse.  Written from the contract only; src/apps/write.asm and src/apps/shell.asm were never read.
//   node tests/wr-demo.mjs [--seed N] [--only LIST] [--verbose]
//     --only LIST  groups: 1 the shell's five icons and the launch by a double click (<= 30 frames), 2 SS+Q and the launch by the "Leap" menu item "Write", 3 a paragraph typed (SYMBOL SHIFT
//                  characters included) that wraps and scrolls, 4 arrows, DELETE, a click, the bar by the mouse, 5 "New" from the "File" menu with the dialog, 6 SS+Q with the dialog, 7 frames / watch
// After each step the machine's whole screen (the pointer left out) is compared with wr-model's rendering of the model's document, and the document, the line table and the bar are read back.
// The last line is "wr-demo: N of M groups pass"; exit code 1 on any failure.
import * as W from './wr-lib.mjs';
import * as H from './shell-lib.mjs';
import { PARAGRAPH } from './gfx6-model.mjs';

const { L, T, X, WM, hex, rd16 } = W;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('wr-demo', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED})`);
const env = H.bootShell(); env.rng = rng;
const { m, S } = env;
W.needWr(S);
let doc = new WM.Doc(), cur = null;
const waitFor = (f, max = 90) => { for (let i = 0; i <= max; i++) { if (f()) return true; if (i < max) env.frame(); } return false; };

/** Everything compared after a step: the state (document, line table, bar), the whole screen. */
function chk(what, o = {}) {
  env.frames_(o.frames ?? 3);
  const sd = W.stateDiff(env, doc), d = sd.doc.concat(sd.lt, sd.bar).filter((x) => !(o.dialog && x.startsWith('K_FOCUS')));
  cur.ok(d.length === 0, () => `${what}: ${d[0]} [${W.describe(doc)}]`);
  const s = W.liveDiff(env, doc, { full: true, dialog: !!o.dialog });
  cur.ok(s === null, () => `${what}: screen ${s} [${W.describe(doc)}]`);
  return d.length === 0 && s === null;
}
const key = (code, what) => { L.typeCode(env, code, 3, 3); W.Doc_key(doc, code); return chk(what || `key ${code}`); };
const typeText = (s, every = 12) => { let i = 0; for (const c of s) { L.typeCode(env, c.charCodeAt(0), 3, 3); W.Doc_key(doc, c.charCodeAt(0)); if (++i % every === 0) if (!chk(`typing, after ${i} codes`, { frames: 1 })) return false; } return chk('after the text'); };
const clickText = (px, py) => { L.click(env, px, py, 3, 4); doc.click(px, py); return chk(`click (${px}, ${py})`); };
const barDrag = (part, py2) => {
  const plan = W.barPlan(doc, part, py2); if (!plan) return false;
  const ok = L.moveTo(env, plan.px, plan.py); env.frames_(1);
  m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  if (plan.moveTo !== null) { L.moveTo(env, plan.px, plan.moveTo); env.frames_(2); }
  m.mouse.buttons = L.MOUSE_UP; env.frames_(3);
  plan.tells.forEach((v) => doc.scrollTo(v));
  return ok && chk(`bar ${part}${plan.moveTo !== null ? ' to ' + plan.moveTo : ''}`, { frames: 24 });          // a scroll of several lines redraws them: up to ~8 frames
};
/** The second click of a double click on icon p: the frames from its press (frame 1) until Write's window is drawn and equals the model (SHELL 7: <= 30). */
function launchFrames(p) {
  const [cx, cy] = L.iconCentre(p);
  L.click(env, cx, cy, 3, 6);
  m.mouse.buttons = L.MOUSE_LEFT;
  let n = 0, ok = false;
  for (n = 1; n <= 90; n++) { env.frame(); if (n === 3) m.mouse.buttons = L.MOUSE_UP; if (L.progUp(env, 3) && W.liveDiff(env, new WM.Doc(), { full: true }) === null) { ok = true; break; } }
  m.mouse.buttons = L.MOUSE_UP;
  return ok ? n : NaN;
}

// ===========================================================================================================================
if (ONLY.includes(1)) {
  const sec = cur = new Sec('1 the shell has five icons (Calculator, Key Caps, Notepad at (176, 40), Paint at (240, 40), Puzzle at (304, 40)); a double click on "Write" opens it: a CWindow "Write" (16, 16, 480, 168), the empty document drawn, the caret in the text view, within 30 frames');
  env.frames_(12);
  const d0 = H.shellDiff(env);
  sec.ok(d0 === null, () => `the shell's screen with five icons (the icon bitmaps are read from icons.txt): ${d0}`);
  const ics = H.treeOf(env).filter((v) => v.cls === S.CL_Icon);
  sec.ok(ics.length === 5 && ics[4].x === 304 && ics[4].y === 40 && m.ram[ics[4].a + S.Icon_prog] === 5 && H.readStrText(m, rd16(m, ics[4].a + S.Icon_name)) === 'Puzzle' && ics[3].x === 240 && ics[3].y === 40 && m.ram[ics[3].a + S.Icon_prog] === 4 && H.readStrText(m, rd16(m, ics[3].a + S.Icon_name)) === 'Paint' && ics[2].x === 176 && ics[2].y === 40 && m.ram[ics[2].a + S.Icon_prog] === 3 && H.readStrText(m, rd16(m, ics[2].a + S.Icon_name)) === 'Notepad', () => `icons ${JSON.stringify(ics.map((v) => [v.x, v.y]))}`);
  env.frames_(30);
  const n = launchFrames(3);
  sec.ok(n <= 30, () => `Write's window was drawn after ${n} frames (bound 30)`);
  env.frames_(10);
  sec.ok(L.progUp(env, 3), () => `K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))}`);
  doc = new WM.Doc();
  chk('Write just launched (empty document, not changed)');
  const o = W.objs(env), ws = L.openWindows(m, S);
  sec.ok(ws.length === 1 && ws[0].cls === S.CL_CWindow, 'Write\'s window is a CWindow');
  sec.ok(rd16(m, S.K_FOCUS) === o.tv && o.tv !== 0, () => `K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, the text view ${hex(o.tv)}`);
  const views = L.allViews(m, S), tvv = views.find((v) => v.a === o.tv), bv = views.find((v) => v.a === o.bar);
  sec.ok(!!tvv && [tvv.x, tvv.y, tvv.w, tvv.h].join() === '24,30,448,144' && tvv.id === 1 && (tvv.flags & 1) === 1, () => `text view ${tvv && [tvv.x, tvv.y, tvv.w, tvv.h, tvv.id, tvv.flags]}, want (24, 30, 448, 144) id 1 focusable`);
  sec.ok(!!bv && [bv.x, bv.y, bv.w, bv.h].join() === '478,28,12,148' && bv.id === 2, () => `bar ${bv && [bv.x, bv.y, bv.w, bv.h, bv.id]}, want (478, 28, 12, 148) id 2`);
  sec.end(`launch ${n} frames`);
}

// ===========================================================================================================================
if (ONLY.includes(2)) {
  const sec = cur = new Sec('2 SYMBOL SHIFT + Q on an unchanged document quits to the shell (no dialog); the "Leap" menu item "Write" (id 5) starts Write again, empty');
  if (!L.progUp(env, 3)) { L.launchByDoubleClick(env, 3); env.frames_(12); }
  const q = L.quitBySSQ(env); env.frames_(12);
  sec.ok(q, () => `the shell did not come back (K_PROG ${m.ram[S.K_PROG]})`);
  const d0 = H.shellDiff(env); sec.ok(d0 === null, () => `the shell after the quit: ${d0}`);
  H.leapMenu(env, 5);
  const n = L.waitProgram(env, 3, 120);
  sec.ok(n >= 0, () => `Leap menu item 5 did not start Write (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => w.title))})`);
  env.frames_(12); doc = new WM.Doc();
  chk('Write started from the "Leap" menu');
  sec.end(`menu launch ${n} frames`);
}

// ===========================================================================================================================
if (ONLY.includes(3)) {
  const sec = cur = new Sec('3 a paragraph typed with the keyboard (letters, digits, SYMBOL SHIFT characters) wraps; ENTERs scroll the view; every checkpoint equals the model\'s screen, the line table and the bar');
  if (!L.progUp(env, 3)) { L.launchByDoubleClick(env, 3); env.frames_(12); doc = new WM.Doc(); }
  const SS = '!@#$%&\'()_;":`?/~|\\{}[]<>=+-^.,*';
  typeText(PARAGRAPH);
  sec.ok(doc.nl >= 4, () => `the paragraph of ${doc.L} codes wraps into ${doc.nl} lines (about 80 codes a line)`);
  key(13, 'ENTER after the paragraph');
  typeText(SS + ' ' + SS);
  key(13, 'ENTER');
  typeText('Mixed Case 123 and a veryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongword wider than nothing');
  for (let i = 0; i < 14; i++) key(13, `ENTER ${i + 1} (scrolling)`);
  sec.ok(doc.top > 0 && rd16(m, S.WR_TOP) === doc.top, () => `the view scrolled: WR_TOP ${rd16(m, S.WR_TOP)}, model top ${doc.top} (${doc.nl} lines)`);
  typeText('end');
  sec.end(`${doc.L} codes, ${doc.nl} lines, top ${doc.top}`);
}

// ===========================================================================================================================
if (ONLY.includes(4)) {
  const sec = cur = new Sec('4 caret keys (LEFT, RIGHT, UP, DOWN with the target x), DELETE (paragraphs join), typing in the middle, a click, the bar by the mouse (arrow, page, thumb): top changes, the caret does not');
  if (!L.progUp(env, 3)) { L.launchByDoubleClick(env, 3); env.frames_(12); doc = new WM.Doc(); typeText(PARAGRAPH); for (let i = 0; i < 18; i++) key(13); }
  for (let i = 0; i < 6; i++) key(11, `UP ${i + 1}`);
  for (let i = 0; i < 3; i++) key(10, `DOWN ${i + 1}`);
  for (let i = 0; i < 5; i++) key(8, `LEFT ${i + 1}`);
  for (let i = 0; i < 4; i++) key(9, `RIGHT ${i + 1}`);
  for (let i = 0; i < 20; i++) key(11, `UP (to the top) ${i + 1}`);
  sec.ok(rd16(m, S.WR_TOP) === doc.top, () => `after UP: WR_TOP ${rd16(m, S.WR_TOP)}, model ${doc.top}`);
  typeText('<<inserted>>');
  for (let i = 0; i < 4; i++) key(12, `DELETE ${i + 1}`);
  clickText(rng.int(40, 400), rng.int(40, 160));
  clickText(30, 31); key(12, 'DELETE at the start of a line');
  clickText(465, 100);
  for (let i = 0; i < 30; i++) key(10, `DOWN ${i + 1}`);
  // the bar through the real pointer: the caret stays where it is
  const caret0 = doc.caret;
  barDrag('up'); barDrag('down'); barDrag('pgup'); barDrag('pgdn'); barDrag('thumb', 90); barDrag('thumb', 160);
  sec.ok(rd16(m, S.WR_GS) === caret0, () => `the bar moved the caret: WR_GS ${rd16(m, S.WR_GS)}, was ${caret0}`);
  key(doc.caret < doc.L ? 9 : 8, 'a caret key after scrolling away: the view follows the caret');
  sec.end(`${doc.L} codes, ${doc.nl} lines, top ${doc.top}`);
}

// ===========================================================================================================================
if (ONLY.includes(5)) {
  const sec = cur = new Sec('5 "New" from the "File" menu on a changed document: the dialog (Discard the document? / Discard / Cancel); Cancel keeps the text, Discard empties it (top 0, caret 0) and no dialog follows');
  if (!L.progUp(env, 3)) { L.launchByDoubleClick(env, 3); env.frames_(12); doc = new WM.Doc(); typeText('Some text to lose'); }
  W.fileNew(env); env.frames_(8);
  sec.ok(W.dialogUp(env) && rd16(m, S.W_MODAL) !== 0, () => `the dialog is not up (windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))})`);
  chk('the dialog over the document', { dialog: true });
  const b = W.dialogButtons(env);
  sec.ok(!!b, 'Discard (224, 100, 64, 16) and Cancel (304, 100, 64, 16) are there');
  L.typeCode(env, 27, 3, 3); env.frames_(24);
  sec.ok(!W.dialogUp(env) && L.progUp(env, 3), 'ESC cancels: the dialog is gone, Write runs');
  chk('after Cancel: nothing changed');
  W.fileNew(env); env.frames_(8);
  if (b && W.dialogUp(env)) W.clickView(env, W.dialogButtons(env).discard);
  env.frames_(24);
  doc.reset();
  sec.ok(!W.dialogUp(env) && L.progUp(env, 3), 'Discard by a click: the dialog is gone, Write runs');
  chk('after Discard: an empty document');
  W.fileNew(env); env.frames_(8);
  sec.ok(!W.dialogUp(env), 'New on the emptied (unchanged) document: no dialog');
  typeText('abc'); key(12, 'DELETE');
  sec.end('Cancel by ESC, Discard by a click, New with no change');
}

// ===========================================================================================================================
if (ONLY.includes(6)) {
  const sec = cur = new Sec('6 SYMBOL SHIFT + Q on a changed document: the dialog first (Cancel keeps Write running), then Discard (ENTER) quits to the shell; the shell as before');
  if (!L.progUp(env, 3)) { L.launchByDoubleClick(env, 3); env.frames_(12); doc = new WM.Doc(); typeText('changed'); }
  L.typeCode(env, 17, 3, 3); env.frames_(10);
  sec.ok(W.dialogUp(env) && m.ram[S.K_PROG] === 3, () => `SS+Q on a changed document: dialog ${W.dialogUp(env)}, K_PROG ${m.ram[S.K_PROG]}`);
  chk('the quit dialog', { dialog: true });
  L.typeCode(env, 3, 3, 3); env.frames_(24);                      // BREAK counts as ESC
  sec.ok(!W.dialogUp(env) && L.progUp(env, 3), 'BREAK cancels');
  chk('after Cancel');
  L.typeCode(env, 17, 3, 3); env.frames_(10);
  L.typeCode(env, 13, 3, 3);
  const ok = waitFor(() => L.progUp(env, 0), 60); env.frames_(12);
  sec.ok(ok, () => `Discard by ENTER did not quit (K_PROG ${m.ram[S.K_PROG]})`);
  const d0 = H.shellDiff(env); sec.ok(d0 === null, () => `the shell after the quit: ${d0}`);
  sec.end('Cancel by BREAK, Discard by ENTER');
}

// ===========================================================================================================================
if (ONLY.includes(7)) {
  const sec = new Sec('7 frames and memory: V_FRAMES rose by 1 on every normally run frame (no frame interrupt lost, no DI), the memory watch of BANKING 10.7');
  sec.ok(env.vf.bad === 0, () => `V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first: ${env.vf.first}`);
  sec.ok(env.w.n === 0, () => `memory watch: ${env.w.summary()}`);
  sec.end(`${env.vf.checked} frames checked, ${env.frames} frames run`);
}
finish();
