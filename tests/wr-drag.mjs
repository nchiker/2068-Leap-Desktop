"use strict";
// wr-drag.mjs -- Notepad (program 3, src/apps/write.asm `wr_org`) with its window dragged by the title bar to other cell positions: a RELOCATION INVARIANCE test on the prebuilt `desk5`
// cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  The existing models (tests/wr-model.mjs) have the geometry fixed at the default position, window (16, 16, 480, 168),
// text view (24, 30, 448, 144), bar (478, 28, 12, 148); this test does not use them.  For each document state it takes the machine at the default position, drags the window to a new position
// (x in {0, 16, 32} and y in {8, 16, 24}), and compares, shifted by the move (dx = x - 16, dy = y - 16):
//   1. after the drag: the text view's pixels, the bar's pixels, the whole window's pixels, and the program's state (document, caret, selection, top, bar, ...) against the machine that was not moved;
//   2. after each of a list of actions done at the same positions RELATIVE to the view (typing, keys, MARK, a click, a drag over the text and out of the view, a double-click, the bar's arrows and
//      track, Select all / Cut / Paste, Find... and Find again): the same three pixel regions and the same state against a reference run at the default position;
//   3. the origin variables of `wr_org` (WR_VX, WR_VY, WR_VYE, WR_VT, WR_NVT, WR_CMAX, WR_XEND) against the view's moved rectangle (24 + dx, 30 + dy);
//   4. the dialogs after a move: the Save dialog (its rectangle is fixed, not the window's), the discard question ("New" over a changed document) and the Find dialog: the dialog's pixels equal
//      the default position's, Cancel restores the window exactly, Save writes the same file, Discard empties the document as at the default position.
// Pixels outside the compared rectangles (the pointer's tile, the desk) are not compared.  Real frames throughout (keys through the keyboard, the Kempston mouse for the drags and clicks).
//   node tests/wr-drag.mjs [--only LIST] [--positions N,N,..] [--verbose]
//     --only LIST  states: empty, typed, mouse, mark, long, edge, edge2, find (default all)
//     --ignore-stale-caret   a diagnostic: leave out of every comparison on the moved machines the display bytes of the caret as the default position drew it (the 1 x 9 column at WR_NCX / WR_NCY of the
//                  reference), where a stale caret is drawn and cleared after a drag; the plain run does not do this and reports it
//     --refresh    after each drag (and, for the reference, at the same point) type a code and DELETE it: the caret is worked out again by an event, so what the drag itself left stale (the caret's position)
//                  is out of the way and the rest of the invariance can be judged (a diagnostic; the plain run is the test)
// The last line is "wr-drag: N of M groups pass"; exit code 1 on any failure.
import * as Q from './wr-w3lib.mjs';
import * as H from './shell-lib.mjs';

const { W, W3, L, WM, X, hex, rd16 } = Q;
const { argv } = L;
const VERBOSE = argv.includes('--verbose'), REFRESH = argv.includes('--refresh'), IGNORE_STALE = argv.includes('--ignore-stale-caret');
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['empty', 'typed', 'mouse', 'mark', 'long', 'edge', 'edge2', 'find'];
const { Sec, finish } = X.makeGroups('wr-drag', VERBOSE);
const KEYS = Q.KEYS;
const WIN0 = { x: 16, y: 16, w: 480, h: 168 }, TV0 = { x: 24, y: 30, w: 448, h: 144 }, BAR0 = { x: 478, y: 28, w: 12, h: 148 };
const POS = [];
for (const y of [8, 16, 24]) for (const x of [0, 16, 32]) POS.push([x, y]);
const PARK = [511, 191];

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Pixels
/** { disp, mask }: the display and the mask that leaves out the pointer (0 = ignore). */
function grab(env) {
  const mask = L.pointerMask(env.m, env.S);
  for (const [x, y] of env.stale || []) { for (let yy = y; yy < y + 9 && yy < 192; yy++) for (const c of [x >> 3, (x >> 3) + 1]) if (c < 64) mask[yy * 64 + c] = 0; }
  return { disp: W.readDisp(env.m), mask, ptr: L.pointerPos(env.m, env.S) };
}
/** The caret the machine last drew, [x, y] (WR_NCX / WR_NCY), or null when none is shown. */
const caretOf = (env) => (env.m.ram[env.S.WR_NCV] ? [rd16(env.m, env.S.WR_NCX), env.m.ram[env.S.WR_NCY]] : null);
/** The rectangle r (pixels, in A's coordinates) of A against the same rectangle moved by (dx, dy) in B (dx a multiple of 8): null, or { x, y, a, b } of the first differing byte. */
function cmpRect(A, B, r, dx, dy) {
  const c0 = r.x >> 3, c1 = (r.x + r.w - 1) >> 3, shift = dx >> 3;
  let first = null, n = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    const yb = y + dy;
    if (yb < 0 || yb >= 192) { return { x: r.x, y, a: 0, b: 0, n: 1, note: 'outside the screen' }; }
    for (let c = c0; c <= c1; c++) {
      const ia = y * 64 + c, ib = yb * 64 + c + shift;
      let m = 0xFF;
      if (c === c0) m &= 0xFF >> (r.x & 7);
      if (c === c1) m &= (0xFF00 >> (((r.x + r.w - 1) & 7) + 1)) & 0xFF;
      m &= A.mask[ia] & B.mask[ib];
      if ((A.disp[ia] ^ B.disp[ib]) & m) { n++; if (!first) first = { x: c * 8, y, a: A.disp[ia], b: B.disp[ib] }; }
    }
  }
  if (first) first.n = n;
  return first;
}
const REGIONS = { 'text view': TV0, 'bar': BAR0, 'window': WIN0 };
/** All three regions: a list of messages. */
function cmpAll(A, B, dx, dy) {
  const out = [];
  for (const [name, r] of Object.entries(REGIONS)) {
    const d = cmpRect(A, B, r, dx, dy);
    if (d) out.push(`${name}: ${d.n} byte(s) differ, first at screen y ${d.y + dy}, x ${d.x + dx}..${d.x + dx + 7} (default position: y ${d.y}, x ${d.x}): reference $${d.a.toString(16)}, moved $${d.b.toString(16)}`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// State
/** Everything the program keeps: the document, the selection, the bar, the focus, Find, the dialog kind, the name. */
function stateOf(env) {
  const { m, S } = env, st = W.readState(env), s2 = W.readState2(env), s4 = W.readState4(env);
  return JSON.stringify({ st: { ...st, lens: st.lens.length }, lens: Array.from(st.lens), s2, s4, dk: m.ram[S.WR_DK], prog: m.ram[S.K_PROG], chg: m.ram[S.WR_CHG], wins: L.openWindows(m, S).map((w) => [w.title, w.w, w.h]) });
}
/** The first difference between two state strings, readable. */
function stateDiff(a, b) {
  if (a === b) return null;
  const A = JSON.parse(a), B = JSON.parse(b), diffs = [];
  const walk = (x, y, p) => {
    if (x && typeof x === 'object' && y && typeof y === 'object') { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], p + '.' + k); }
    else if (x !== y) diffs.push(`${p}: reference ${JSON.stringify(x)}, moved ${JSON.stringify(y)}`);
  };
  walk(A, B, '');
  return diffs.slice(0, 4).join('; ');
}
/** The origin variables of wr_org against the view's rectangle (24 + dx, 30 + dy). */
function orgOf(env, dx, dy) {
  const { m, S } = env, vx = TV0.x + dx, vy = TV0.y + dy;
  const got = { VX: rd16(m, S.WR_VX), VY: m.ram[S.WR_VY], VYE: m.ram[S.WR_VYE], VT: rd16(m, S.WR_VT), NVT: rd16(m, S.WR_NVT), CMAX: rd16(m, S.WR_CMAX), XEND: rd16(m, S.WR_XEND) };
  const want = { VX: vx, VY: vy, VYE: vy + TV0.h, VT: vx + 3, NVT: (-(vx + 3)) & 0xFFFF, CMAX: vx + 447, XEND: vx + TV0.w };
  const bad = Object.keys(want).filter((k) => got[k] !== want[k]).map((k) => `${k} ${got[k]} (want ${want[k]})`);
  return bad.length ? bad.join(', ') : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Driving
const key = (env, c) => Q.key(env, c);
function typeStr(env, s) { for (const ch of s) key(env, ch === '\n' ? KEYS.ENTER : ch.charCodeAt(0)); }
const park = (env) => { L.moveTo(env, PARK[0], PARK[1]); env.frames_(4); };
const winOf = (env) => L.openWindows(env.m, env.S).find((w) => w.title.startsWith('Notepad'));
/** A drag of the window by its title bar to (nx, ny) (the same gesture as tests/pt-p1.mjs group 8); returns the window as it ends. */
function dragWin(env, nx, ny) {
  const { m } = env, w = winOf(env), px = w.x + 200, py = w.y + 3;
  L.moveTo(env, px, py); env.frames_(2);
  m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, px + (nx - w.x), py + (ny - w.y)); env.frames_(3);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(30);
  park(env);
  return winOf(env);
}
/** A press-move-release over absolute points `pts` (the first the press). */
function dragPts(env, pts) {
  const { m } = env;
  L.moveTo(env, pts[0][0], pts[0][1]); env.frames_(2);
  m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  for (const [x, y] of pts.slice(1)) { L.moveTo(env, x, y); env.frames_(3); }
  m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
  park(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The document states (set up at the default position by real keys and the mouse)
const LONG = Array.from({ length: 50 }, (_, i) => `Row ${String(i + 1).padStart(2, '0')} abcdef`).join('\n');
const STATES = {
  empty: { desc: 'an empty document', setup: () => {} },
  typed: { desc: 'a few lines typed', setup: (env) => { typeStr(env, 'Hello world\nSecond line of text, a bit longer\n\nFourth after a blank line'); } },
  mouse: { desc: 'a selection made by a mouse drag', setup: (env) => { typeStr(env, 'The quick brown fox\njumps over the lazy dog\nand runs away again'); dragPts(env, [[TV0.x + 30, TV0.y + 6], [TV0.x + 120, TV0.y + 14], [TV0.x + 80, TV0.y + 24]]); } },
  mark: { desc: 'a selection made by MARK and the arrows', setup: (env) => { typeStr(env, 'The quick brown fox\njumps over the lazy dog\nand runs away again'); for (let i = 0; i < 10; i++) key(env, KEYS.LEFT); W.typeMark(env); for (let i = 0; i < 12; i++) key(env, KEYS.RIGHT); key(env, KEYS.UP); } },
  long: { desc: 'a 50-line document scrolled by the keys and by the bar so that the view shows the middle', setup: (env) => {
    typeStr(env, LONG);
    for (let i = 0; i < 30; i++) key(env, KEYS.UP);
    for (const [bx, by] of [[6, 142], [6, 142], [6, 100]]) L.click(env, BAR0.x + bx, BAR0.y + by, 3, 8);
    for (let i = 0; i < 4; i++) key(env, KEYS.DOWN);
    park(env);
  } },
  edge: { desc: 'the caret at the end of a long line of trailing spaces (the caret clamped at x 471, the view\'s right edge)', setup: (env) => { typeStr(env, 'W'.repeat(40) + ' '.repeat(80)); } },
  edge2: { desc: 'the caret on a wrapped line just before its last code (near the right edge, not clamped)', setup: (env) => {
    typeStr(env, 'W'.repeat(130)); env.frames_(10);
    const st = W.readState(env), l0 = st.lens[0];
    for (let i = st.gs; i > l0 - 1; i--) key(env, KEYS.LEFT);
  } },
  find: { desc: 'a Find match selected', setup: (env) => { typeStr(env, 'the quick brown fox. the lazy dog\nand the end of the text'); for (let i = 0; i < 70; i++) key(env, KEYS.LEFT); findText(env, 'lazy'); } },
};
/** "Find..." by the pointer (the Edit menu's item 5) then the text and ENTER. */
function findText(env, s) { W.editMenu(env, W.ITEM_INDEX[5]); env.frames_(12); typeStr(env, s); key(env, KEYS.ENTER); env.frames_(30); dismissAlert(env); }
/** "Not found." (WR_DK 2) is closed with ENTER: the alert is fixed on the desk, so a window compared with it open would differ by design. */
function dismissAlert(env) { if (env.m.ram[env.S.WR_DK] === 2) { key(env, KEYS.ENTER); env.frames_(24); } }

// The actions: relative to the view (rx, ry in the view; bx, by in the bar).  The same list at every position.
const at = (v) => (rx, ry) => [v.x + rx, v.y + ry];
const ACTIONS = [
  ['a click in the text', (env, v) => { const p = at(v)(60, 20); L.click(env, p[0], p[1], 3, 8); park(env); }],
  ['a drag over the text', (env, v) => { const a = at(v); dragPts(env, [a(30, 10), a(110, 20), a(200, 40)]); }],
  ['typing "xy" over the selection', (env) => { typeStr(env, 'xy'); }],
  ['keys: RIGHT RIGHT DOWN UP LEFT', (env) => { for (const c of [KEYS.RIGHT, KEYS.RIGHT, KEYS.DOWN, KEYS.UP, KEYS.LEFT]) key(env, c); }],
  ['MARK, RIGHT x4, DOWN', (env) => { W.typeMark(env); for (let i = 0; i < 4; i++) key(env, KEYS.RIGHT); key(env, KEYS.DOWN); }],
  ['clicks at the right edge, the left edge and the bottom line of the view', (env, v) => { for (const [rx, ry] of [[440, 8], [2, 8], [300, 140], [447, 143]]) { const p = at(v)(rx, ry); L.click(env, p[0], p[1], 3, 8); } park(env); }],
  ['a double-click on a word (MARK first: it ends the mark)', (env, v) => { W.typeMark(env); const p = at(v)(40, 4); H.pressPoint(env, p[0], p[1]); env.frames_(2); H.pressPoint(env, p[0], p[1]); env.frames_(20); park(env); }],
  ['a drag that leaves the view at the bottom right and comes back', (env, v) => { const a = at(v); dragPts(env, [a(100, 50), a(430, 100), a(446, 143), a(300, 150), a(120, 60)]); }],
  ['the bar: the up arrow twice, the down arrow three times, the track', (env, v, b) => { for (const [bx, by] of [[6, 6], [6, 6], [6, 142], [6, 142], [6, 142], [6, 100]]) { const p = [b.x + bx, b.y + by]; L.click(env, p[0], p[1], 3, 8); } park(env); }],
  ['Find... "e", Find again twice', (env) => { findText(env, 'e'); for (let i = 0; i < 2; i++) { W.editMenu(env, W.ITEM_INDEX[6]); env.frames_(30); dismissAlert(env); } }],
  ['DELETE x2, Select all, Cut, Paste', (env) => { key(env, KEYS.DELETE); key(env, KEYS.DELETE); W.editMenu(env, 4); env.frames_(20); W.editMenu(env, 0); env.frames_(20); W.editMenu(env, 2); env.frames_(30); }],
];

/** A fresh machine with the state set up at the default position. */
function fresh(name) {
  const env = Q.bootW3({});
  park(env);
  STATES[name].setup(env);
  env.frames_(30);
  park(env);
  return env;
}
/** --refresh: a typed code and its DELETE (an event that works the caret out again); the same at the reference's default position. */
function refresh(env) { if (!REFRESH || rd16(env.m, env.S.WR_AN) !== rd16(env.m, env.S.WR_GS)) return;       // (not over a selection: typing would replace it)
  key(env, 'z'.charCodeAt(0)); key(env, KEYS.DELETE); env.frames_(20); park(env); }
const viewsOf = (env, dx, dy) => ({ v: { x: TV0.x + dx, y: TV0.y + dy }, b: { x: BAR0.x + dx, y: BAR0.y + dy } });

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The dialogs: a script over a machine at position (dx, dy); returns the records [{ tag, grab, state, rect? }] and the host's saves
function dialogs(env, dx, dy) {
  const rec = [];
  const snap = (tag, extra = {}) => { env.frames_(8); rec.push({ tag, g: grab(env), state: stateOf(env), ...extra }); };
  const windows = () => L.openWindows(env.m, env.S).filter((w) => w.cls === env.S.CL_Dialog).map((w) => [w.x, w.y, w.w, w.h]);      // the dialogs only: the Notepad window is where the drag put it
  snap('before the dialogs');
  // the Save dialog: opened, looked at, Cancel
  Q.fileMenu(env, 2); Q.settle(env, 10); snap('the Save dialog open', { wins: windows(), rect: W3.SAVE.dlg });
  { const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); Q.settle(env, 24); park(env); } snap('after the Save dialog\'s Cancel');
  // Save for real: a name typed, ENTER
  Q.fileMenu(env, 2); Q.settle(env, 10); typeStr(env, 'zz'); key(env, KEYS.ENTER); Q.settle(env, 60); park(env);
  snap('after Save "zz"', { saves: env.host.saves.map((s) => ({ name: s.name, bytes: s.bytes })) });
  // Find... opened and cancelled
  W.editMenu(env, W.ITEM_INDEX[5]); Q.settle(env, 12); snap('the Find dialog open', { wins: windows(), rect: W3.SAVE.dlg });
  key(env, KEYS.ESC); Q.settle(env, 24); park(env); snap('after Find\'s Cancel');
  // New over a changed document: the discard question; Cancel, then again and Discard
  typeStr(env, 'q'); env.frames_(10); park(env);
  snap('changed by a typed code');
  Q.fileMenu(env, 0); Q.settle(env, 12); snap('the discard question open', { wins: windows(), rect: WM.DLG });
  { const b = W.dialogButtons(env); if (b) { W.clickView(env, b.cancel); Q.settle(env, 24); park(env); } } snap('after the discard question\'s Cancel');
  Q.fileMenu(env, 0); Q.settle(env, 12);
  { const b = W.dialogButtons(env); if (b) { W.clickView(env, b.discard); Q.settle(env, 40); park(env); } } snap('after Discard (the document is new)');
  return rec;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
for (const name of Object.keys(STATES).filter((n) => ONLY.includes(n))) {
  const sec = new Sec(`${name}: ${STATES[name].desc}: the window dragged to each of the nine positions (x 0 / 16 / 32, y 8 / 16 / 24), then the same actions at the same view-relative places, the dialogs: pixels and state equal the default position's`);
  const t0 = Date.now();
  // the reference: the default position
  const ref = fresh(name); refresh(ref);
  const refCaret = IGNORE_STALE ? caretOf(ref) : null;
  sec.note(`the reference's caret at the start: ${JSON.stringify(caretOf(ref))} (the clamp is at x ${TV0.x + 447})`);
  ref.stale = refCaret ? [refCaret] : null;
  const refSetup = { g: grab(ref), state: stateOf(ref) };
  ref.stale = null;
  sec.ok(!orgOf(ref, 0, 0), () => `the default position: origin variables: ${orgOf(ref, 0, 0)}`);
  const w0 = winOf(ref);
  sec.ok(!!w0 && w0.x === WIN0.x && w0.y === WIN0.y && w0.w === WIN0.w && w0.h === WIN0.h, () => `the default window is ${w0 && [w0.x, w0.y, w0.w, w0.h]}`);
  const refSteps = [];
  { const { v, b } = viewsOf(ref, 0, 0); for (const [, fn] of ACTIONS) { fn(ref, v, b); ref.frames_(20); refSteps.push({ g: grab(ref), state: stateOf(ref) }); } }
  if (VERBOSE) console.log(`  ${name}: reference after each action (caret, anchor, mark, top, lines, clipboard, F): ${refSteps.map((r) => { const j = JSON.parse(r.state); return `${j.st.gs},${j.s2.an},${j.s2.mk},${j.st.top},${j.st.nl},${j.s2.cln},${j.s4 ? j.s4.fn : '-'}`; }).join('  ')}`);
  // the dialogs' reference from a second default machine (the actions above leave a different document)
  const refD = fresh(name); refresh(refD); refD.stale = refCaret ? [refCaret] : null; const refDlg = dialogs(refD, 0, 0);
  sec.note(`reference done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  for (const [nx, ny] of POS) {
    const dx = nx - WIN0.x, dy = ny - WIN0.y, tag = `window at (${nx}, ${ny})`;
    const env = fresh(name);
    const w = dragWin(env, nx, ny); refresh(env); env.stale = refCaret ? [refCaret] : null;
    if (!sec.ok(!!w && w.x === nx && w.y === ny, () => `${tag}: the drag put the window at ${w && [w.x, w.y]}`)) continue;
    // 1. after the drag
    const mv = { g: grab(env), state: stateOf(env) };
    const d1 = cmpAll(refSetup.g, mv.g, dx, dy);
    sec.ok(d1.length === 0, () => `${tag}: after the drag: ${d1.join(' | ')}`);
    const s1 = stateDiff(refSetup.state, mv.state);
    sec.ok(s1 === null, () => `${tag}: after the drag, the state: ${s1}`);
    sec.ok(!orgOf(env, dx, dy), () => `${tag}: after the drag: origin variables: ${orgOf(env, dx, dy)}`);
    // 2. the actions
    const { v, b } = viewsOf(env, dx, dy);
    ACTIONS.forEach(([what, fn], i) => {
      fn(env, v, b); env.frames_(20);
      const g = grab(env), st = stateOf(env), r = refSteps[i];
      const d = cmpAll(r.g, g, dx, dy);
      sec.ok(d.length === 0, () => `${tag}: after ${what}: ${d.join(' | ')}`);
      const sd = stateDiff(r.state, st);
      sec.ok(sd === null, () => `${tag}: after ${what}, the state: ${sd}`);
      sec.ok(!orgOf(env, dx, dy), () => `${tag}: after ${what}: origin variables: ${orgOf(env, dx, dy)}`);
    });
    // 3. the dialogs (a second machine: the actions above leave another document)
    const e2 = fresh(name);
    dragWin(e2, nx, ny); refresh(e2); e2.stale = refCaret ? [refCaret] : null;
    const dl = dialogs(e2, dx, dy);
    sec.ok(dl.length === refDlg.length, () => `${tag}: the dialog script made ${dl.length} records, the reference ${refDlg.length}`);
    refDlg.forEach((r, i) => {
      const x = dl[i]; if (!x) return;
      const what = `${tag}: ${x.tag}`;
      const sd = stateDiff(r.state, x.state);
      sec.ok(sd === null, () => `${what}: the state: ${sd}`);
      if (r.rect) {
        // the dialog is fixed on the desk: its rectangle is the same as at the default position, and so are its pixels at the SAME place (shift 0)
        sec.ok(JSON.stringify(r.wins) === JSON.stringify(x.wins), () => `${what}: windows ${JSON.stringify(x.wins)}, at the default position ${JSON.stringify(r.wins)}`);
        const d = cmpRect(r.g, x.g, { x: r.rect.x, y: r.rect.y, w: r.rect.w, h: r.rect.h }, 0, 0);
        sec.ok(!d, () => `${what}: the dialog's rectangle (${r.rect.x}, ${r.rect.y}, ${r.rect.w}, ${r.rect.h}) differs: ${d && `${d.n} byte(s), first at y ${d.y}, x ${d.x}`}`);
      }
      if (r.saves) sec.ok(JSON.stringify(r.saves) === JSON.stringify(x.saves), () => `${what}: the saved file(s) ${JSON.stringify(x.saves)}, at the default position ${JSON.stringify(r.saves)}`);
      if (!r.rect) { const d = cmpAll(r.g, x.g, dx, dy); sec.ok(d.length === 0, () => `${what}: ${d.join(' | ')}`); }
    });
    // Cancel restores the window exactly (at this position): before the dialogs == after Save's Cancel, == after the Find and discard Cancels (state aside: only the document changes in between)
    const idx = (t) => dl.findIndex((q) => q.tag === t);
    const pairs = [...(IGNORE_STALE ? [] : [['before the dialogs', 'after the Save dialog\'s Cancel']]), ['after Save "zz"', 'after Find\'s Cancel']];       // (--ignore-stale-caret: the first pair differs by the caret that the drag left out, which the focus draws later)
    for (const [a, c] of pairs) { const A = dl[idx(a)], C = dl[idx(c)]; if (A && C) { const d = cmpAll(A.g, C.g, 0, 0); sec.ok(d.length === 0, () => `${tag}: the window after "${c}" is not as at "${a}": ${d.join(' | ')}`); } }
    { const A = dl[idx('changed by a typed code')], C = dl[idx('after the discard question\'s Cancel')]; if (A && C) { const d = cmpAll(A.g, C.g, 0, 0); sec.ok(d.length === 0, () => `${tag}: the window after the discard question's Cancel is not as before it: ${d.join(' | ')}`); } }
    // the origin variables after all that
    sec.ok(!orgOf(e2, dx, dy), () => `${tag}: after the dialogs: origin variables: ${orgOf(e2, dx, dy)}`);
    for (const e of [env, e2]) { sec.ok(e.vf.bad === 0, () => `${tag}: V_FRAMES did not rise by 1 on ${e.vf.bad} frames, first ${e.vf.first}`); sec.ok(e.w.n === 0, () => `${tag}: memory watch: ${e.w.summary()}`); sec.ok(e.imgw.n === 0, () => `${tag}: ${e.imgw.n} write(s) to the RAM image outside Notepad's variables: ${e.imgw.first.join(' | ')}`); }
  }
  // a chain of drags on one machine: the window to several positions in turn, each time the three regions against the default
  {
    const env = fresh(name); env.stale = refCaret ? [refCaret] : null; let ok = true;
    for (const [nx, ny] of [[0, 8], [32, 24], [16, 8], [0, 24], [32, 8], [16, 16]]) {
      const w = dragWin(env, nx, ny); refresh(env); if (!sec.ok(!!w && w.x === nx && w.y === ny, () => `chain: the drag to (${nx}, ${ny}) put the window at ${w && [w.x, w.y]}`)) { ok = false; break; }
      const g = grab(env), dx = nx - 16, dy = ny - 16;
      const d = cmpAll(refSetup.g, g, dx, dy); sec.ok(d.length === 0, () => `chain, window at (${nx}, ${ny}): ${d.join(' | ')}`);
      const sd = stateDiff(refSetup.state, stateOf(env)); sec.ok(sd === null, () => `chain, window at (${nx}, ${ny}): the state: ${sd}`);
      sec.ok(!orgOf(env, dx, dy), () => `chain, window at (${nx}, ${ny}): origin variables: ${orgOf(env, dx, dy)}`);
    }
    if (ok) {  // back at (16, 16): the first action must give the reference's first step
      const { v, b } = viewsOf(env, 0, 0); ACTIONS[0][1](env, v, b); env.frames_(20);
      const d = cmpAll(refSteps[0].g, grab(env), 0, 0); sec.ok(d.length === 0, () => `chain, home again: ${ACTIONS[0][0]}: ${d.join(' | ')}`);
    }
  }
  sec.end(`${POS.length} positions, ${ACTIONS.length} actions each, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
finish();
