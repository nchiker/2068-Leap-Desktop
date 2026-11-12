"use strict";
// tk-demo.mjs -- the grown Controls demo (docs/TOOLKIT.md 10.5, 10.8 item 4) on the prebuilt `desk5` cartridge (never rebuilt here), launched through the shell (bootDesk5({ prog: 2 }), SHELL 4)
// and driven over real frames with TSRun's keyboard (the key map src/kernel/keymap.txt: CAPS SHIFT / SYMBOL SHIFT combinations) and Kempston mouse.  Written from the contract only (TOOLKIT 10,
// SHELL 5 and 10); src/apps/demo.asm was never read.  The views are found by walking D_WIN's children (class and rectangle), never by fixed addresses.
//   node tests/tk-demo.mjs [--seed N] [--only LIST] [--verbose]
//     --only LIST  groups: 1 the window and its controls, 2 focus order (TAB / BACKTAB), 3 List keys and the status line, 4 List mouse (click, double click, slow clicks), 5 "Grid",
//                  6 Field typing (SYMBOL SHIFT characters), editing and the status line, 7 frames / watch (default all)
// After every step the machine's window is compared, pixel for pixel, with tk-model2's rendering of the model's tree (the model follows the same keys and presses; the status Label and the
// "Value: n" Label are read from the machine, and their expected text is asserted separately).  The last line is "tk-demo: N of M groups pass"; exit code 1 on any failure.
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import * as X from './tk-lib2.mjs';

const { L, hex, rd16 } = T;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('tk-demo', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED})`);
const text = (codes) => String.fromCharCode(...codes);

const env = L.bootDesk5({ prog: 2 });
env.rng = rng;
T.needSyms(env, T.NEEDED2);
const { m, S } = env;
const WIN = [176, 32, 320, 144];
const sec0 = new Sec('1 the Controls window after the launch (TOOLKIT 10.5): a CWindow (176, 32, 320, 144) with T1\'s controls, the List and its bar, "Name:", the Field, the status Label');
const ID = { list: 136, bar: 135, nameLbl: 138, field: 137, status: 139, grid: 129 };

const dwin = rd16(m, S.D_WIN);
const kids = X.kidsOfWindow(env, dwin), wv = L.readView(m, S, dwin);
const nodes = kids.map((v) => X.viewToNode(env, v));
sec0.ok(nodes.every(Boolean), () => `a view of an unknown class in the demo window: ${kids.filter((v, i) => !nodes[i]).map((v) => hex(v.cls))}`);
const real = nodes.filter(Boolean);
X.linkBars(real);
const byId = (id, kind) => real.find((n) => n.id === id && (!kind || n.kind === kind));
const list = byId(ID.list, 'List'), listBar = byId(ID.bar, 'VScroll'), nameLbl = byId(ID.nameLbl, 'Label'), field = byId(ID.field, 'Field'), status = byId(ID.status, 'Label');
const checks = real.filter((n) => n.kind === 'Check'), grid = real.find((n) => n.kind === 'Check' && text(n.codes) === 'Grid');
const t1bar = real.find((n) => n.kind === 'VScroll' && n !== listBar), valueLbl = real.find((n) => n.kind === 'Label' && n !== nameLbl && n !== status);
sec0.ok(wv.cls === S.CL_CWindow && [wv.x, wv.y, wv.w, wv.h].join() === WIN.join(), () => `window class ${hex(wv.cls)} (CWindow ${hex(S.CL_CWindow)}) rect ${[wv.x, wv.y, wv.w, wv.h]}, want ${WIN}`);
sec0.ok(L.progUp(env, 2), 'program 2 is up, one window');
sec0.ok(text(X.readCodes(m, rd16(m, dwin + S.Window_title))) === 'Controls', 'the window title is "Controls"');
sec0.ok(!!list && !!listBar && !!nameLbl && !!field && !!status && !!grid && !!t1bar && !!valueLbl, () => `views missing: list ${!!list}, its bar ${!!listBar}, "Name:" ${!!nameLbl}, field ${!!field}, status ${!!status}, Grid ${!!grid}, T1 bar ${!!t1bar}, Value label ${!!valueLbl}`);
if (list && listBar && nameLbl && field && status && grid) {
  const rect = (n) => [n.x, n.y, n.w, n.h].join();
  sec0.ok(rect(list) === '326,47,132,74' && (list.flags & 1) && !(list.flags & 4), () => `List rect ${rect(list)} flags ${hex(list.flags, 2)}, want (326, 47, 132, 74) focusable, enabled`);
  sec0.ok(rect(listBar) === '458,47,12,74', () => `List bar rect ${rect(listBar)}, want (458, 47, 12, 74)`);
  sec0.ok(rect(nameLbl) === '184,134,32,9' && text(nameLbl.codes) === 'Name:', () => `"Name:" Label ${rect(nameLbl)} ${X.show(nameLbl.codes)}`);
  sec0.ok(rect(field) === '220,132,160,12' && (field.flags & 1) && field.cap === 40 && text(field.buf) === 'Leap', () => `Field ${rect(field)} flags ${hex(field.flags, 2)} cap ${field.cap} text ${X.show(field.buf)}, want (220, 132, 160, 12) focusable, cap 40, "Leap"`);
  sec0.ok(rect(status) === '184,152,280,9' && status.codes.length === 0, () => `status Label ${rect(status)} ${X.show(status.codes)}, want (184, 152, 280, 9) empty`);
  sec0.ok(list.count === 24 && list.items.every((c, i) => c.join() === X.STD_ITEMS[i].join()), () => `List holds ${list.count} items, want the 24 standard ones (10.7); first different: ${list.items.findIndex((c, i) => c.join() !== (X.STD_ITEMS[i] || []).join())}`);
  sec0.ok(list.sel === 0xFF && list.top === 0 && !(list.flags & 16), () => `List sel ${list.sel} top ${list.top} flags ${hex(list.flags, 2)}; want $FF, 0, proportional`);
  sec0.ok(list.bar === listBar && listBar.targetNode === list, () => `the List's bar field ${hex(list.barAddr)} is ${hex(listBar.addr)}? the bar's target ${hex(listBar.target)} is the List ${hex(list.addr)}?`);
  sec0.ok(listBar.max === 16 && listBar.page === 8 && listBar.value === 0, () => `List bar value / max / page ${listBar.value} / ${listBar.max} / ${listBar.page}, want 0 / 16 / 8 (24 items, 8 lines)`);
  sec0.ok(real.every((n) => n.id >= 128 || n.kind === 'Label'), () => `ids ${real.map((n) => n.id)}`);
  sec0.ok(real.indexOf(list) > real.indexOf(grid) && real.indexOf(field) > real.indexOf(list), 'the List and the Field are children after the T1 controls (the focus order puts the Field last)');
}
const demoOk = !!(list && listBar && field && status && grid);

if (demoOk) {
  const tree = new M2.TkTree2({ x: wv.x, y: wv.y, w: wv.w, h: wv.h, slot: m.ram[dwin + S.Window_slot], title: T.codesOf('Controls') }, real);
  const syncFocus = () => { tree.focus = real.find((n) => n.addr === rd16(m, S.K_FOCUS)) || null; };
  syncFocus();
  let vfModel = 1000;
  const labelNow = (n) => text(X.readCodes(m, rd16(m, n.addr + S.Label_text)));
  /** After a step: wait for the frames the program needs, bring the model's program-driven parts up to date, compare everything. */
  let curSec = sec0;
  const check = (what, o = {}) => {
    env.frames_(o.frames ?? 3);
    for (const n of real) if (n.kind === 'Label') n.codes = X.readCodes(m, rd16(m, n.addr + S.Label_text));
    X.applyGrid(tree, grid, list);
    const sd = X.stateDiff(env, tree); curSec.ok(sd === null, () => `${what}: ${sd}`);
    const f = rd16(m, S.K_FOCUS);
    curSec.ok(f === (tree.focus ? tree.focus.addr : 0), () => `${what}: K_FOCUS ${hex(f)} (${(real.find((n) => n.addr === f) || {}).kind} id ${(real.find((n) => n.addr === f) || {}).id}), model ${tree.focus ? tree.focus.kind + ' id ' + tree.focus.id : 'none'}`);
    curSec.ok(text(valueLbl.codes) === `Value: ${t1bar.value}`, () => `${what}: the Value label shows "${text(valueLbl.codes)}", the bar's value is ${t1bar.value}`);
    const g = M.renderWindow(tree); L.closeBoxLook(g, wv.x, wv.y, wv.w);
    const cov = T.rectCov(wv.x, wv.y, wv.w, wv.h), pm = L.pointerMask(m, S);
    for (let i = 0; i < cov.length; i++) cov[i] &= pm[i];
    const d = T.diffDisp(T.readDisp(m), M.toDisp(g), cov);
    curSec.ok(d === null, () => `${what}: the demo window's pixels: ${d}`);
    return d === null;
  };
  const key = (code, what) => { tree.resetLog(); L.typeCode(env, code, 3, 3); tree.dispatch({ t: M.E.KEY, key: code }); const posts = tree.posts.slice(); check(what || `key ${code}`); return posts; };
  const click = (x, y, gapFrames, what) => {
    tree.resetLog();
    L.moveTo(env, x, y); env.frames_(1);
    vfModel += gapFrames; tree.vf = vfModel;
    m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    tree.dispatch({ t: M.E.DOWN, px: x, py: y });
    m.mouse.buttons = L.MOUSE_UP; env.frames_(3);
    tree.dispatch({ t: M.E.UP, px: x, py: y });
    const posts = tree.posts.slice();
    check(what);
    return posts;
  };
  const focusId = () => (tree.focus ? tree.focus.id : 0);
  const linePt = (k) => { const geo = M2.listGeom(list); return [rng.int(list.x + 2, list.x + list.w - 3), geo.LY0 + geo.P * k + rng.int(1, geo.P - 2)]; };
  tree.resetLog();

  // ===========================================================================================================================
  if (ONLY.includes(1)) { check('the opened demo', { frames: 2 }); }
  if (ONLY.includes(1)) sec0.end(`${real.length} views read from the window's child list`);

  // ===========================================================================================================================
  if (ONLY.includes(2)) {
    const sec = new Sec('2 focus order: TAB walks the five T1 controls, then the List, then the Field, and wraps; BACKTAB walks it back; the screen after each step'); curSec = sec;
    const order = real.filter((n) => (n.flags & 7) === 1);
    sec.ok(order.length === 7 && order[5] === list && order[6] === field, () => `focusable views in order: ${order.map((n) => n.kind + ' ' + n.id)}; want five T1 controls, the List, the Field`);
    sec.ok(tree.focus === order[0], 'the first control (Sound) has the focus after the launch');
    for (let i = 1; i <= 8; i++) { key(14, `TAB ${i}`); sec.ok(tree.focus === order[i % order.length], () => `TAB ${i}: the model's focus is ${focusId()}`); }
    for (let i = 1; i <= 8; i++) { key(15, `BACKTAB ${i}`); }
    sec.end(`${order.length} focusable views`);
  }

  // ===========================================================================================================================
  if (ONLY.includes(3)) {
    const sec = new Sec('3 List keys: TAB to the List, DOWN selects the first line and moves down, past the last line shown the List scrolls (the bar follows), UP, ENTER sets the status to "Open: " and the item; the screen after each key'); curSec = sec;
    for (let k = 0; k < 8 && tree.focus !== list; k++) key(14, 'TAB to the List');
    sec.ok(tree.focus === list && rd16(m, S.K_FOCUS) === list.addr, 'the List has the focus');
    for (let i = 1; i <= 11; i++) key(10, `DOWN ${i}`);
    sec.ok(list.sel === 10 && list.top === 3, () => `after 11 DOWN: model sel ${list.sel} top ${list.top} (8 lines: sel 10 shows with top 3)`);
    sec.ok(m.ram[list.addr + S.List_sel] === 10 && m.ram[list.addr + S.List_top] === 3 && m.ram[listBar.addr + S.VScroll_value] === 3, () => `machine sel ${m.ram[list.addr + S.List_sel]} top ${m.ram[list.addr + S.List_top]} bar value ${m.ram[listBar.addr + S.VScroll_value]}, want 10, 3, 3`);
    for (let i = 0; i < 4; i++) key(11, `UP ${i + 1}`);
    key(13, 'ENTER');
    sec.ok(text(status.codes) === 'Open: ' + text(list.items[list.sel]), () => `the status reads "${text(status.codes)}", want "Open: ${text(list.items[list.sel])}" (item ${list.sel})`);
    for (let i = 0; i < 20; i++) key(10, `DOWN to the end ${i}`);
    sec.ok(list.sel === 23 && list.top === 16 && m.ram[list.addr + S.List_sel] === 23 && m.ram[list.addr + S.List_top] === 16, () => `DOWN past the last item: sel ${m.ram[list.addr + S.List_sel]} top ${m.ram[list.addr + S.List_top]}, want 23 and 16 (the last item stays selected)`);
    key(13, 'ENTER on the last item');
    sec.ok(text(status.codes) === 'Open: Zebra', () => `the status reads "${text(status.codes)}", want "Open: Zebra"`);
    for (let i = 0; i < 26; i++) key(11, `UP to the top ${i}`);
    sec.ok(list.sel === 0 && list.top === 0, () => `UP to the top: sel ${list.sel} top ${list.top}`);
    sec.end(`${(list.items || []).length} items, status "${text(status.codes)}"`);
  }

  // ===========================================================================================================================
  if (ONLY.includes(4)) {
    const sec = new Sec('4 List mouse: a click selects (and focuses) the line, a second click on the selected line within 20 frames opens it (status "Open: ..."), one 40 frames later only selects; E_UP / E_MOVE do nothing else'); curSec = sec;
    const status0 = text(status.codes);
    let p = linePt(3), posts = click(p[0], p[1], 100, 'single click on line 3');
    sec.ok(list.sel === list.top + 3 && tree.focus === list, () => `after a click on line 3: sel ${list.sel} top ${list.top}, focus ${focusId()}`);
    sec.ok(text(status.codes) === status0 && posts.length === 0, () => `a single click changed the status to "${text(status.codes)}"`);
    p = linePt(5); click(p[0], p[1], 100, 'single click on line 5');
    sec.ok(list.sel === list.top + 5, () => `after a click on line 5: sel ${list.sel}`);
    // a double click: the second press about 10 frames after the first (the click helper's press / release cadence), on the same line
    p = linePt(2); const gapBefore = T.vframes(env);
    click(p[0], p[1], 100, 'double click: first press');
    const f1 = T.vframes(env);
    const q = [p[0] + 3, p[1]];
    posts = click(q[0], Math.min(q[1], p[1]), 5, 'double click: second press');
    const gapSeen = (T.vframes(env) - f1) & 0xFFFF;
    sec.ok(gapSeen < 20, () => `the test's two presses were ${gapSeen} frames apart: not a double click timing`);
    sec.ok(posts.some((x) => x.id === ID.list), () => `the second press did not post E_CMD for the List (model posts ${JSON.stringify(posts)})`);
    sec.ok(text(status.codes) === 'Open: ' + text(list.items[list.sel]), () => `after a double click on item ${list.sel}: the status reads "${text(status.codes)}", want "Open: ${text(list.items[list.sel])}"`);
    // two clicks 40+ frames apart: only selects
    const status1 = text(status.codes);
    p = linePt(6); click(p[0], p[1], 100, 'slow clicks: first');
    env.frames_(40);
    posts = click(p[0], p[1], 50, 'slow clicks: second 40+ frames later');
    sec.ok(!posts.some((x) => x.id === ID.list) && text(status.codes) === status1, () => `a second click 40+ frames later changed the status to "${text(status.codes)}"`);
    // a click in the List's frame row (not a line) and one on a blank line after setting a shorter view: nothing selected / the memory cleared
    click(list.x + 20, list.y, 100, 'click on the frame row');
    // the pointer must leave no trace: a drag across the List (press, move, release) changes nothing but the selection on press
    L.moveTo(env, list.x + 10, linePt(1)[1]); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(2);
    tree.vf = (vfModel += 100); tree.dispatch({ t: M.E.DOWN, px: rd16(m, S.K_PX), py: m.ram[S.K_PY] });
    L.moveTo(env, list.x + 60, linePt(4)[1]); tree.dispatch({ t: M.E.MOVE, px: rd16(m, S.K_PX), py: m.ram[S.K_PY] });
    m.mouse.buttons = L.MOUSE_UP; env.frames_(3); tree.dispatch({ t: M.E.UP, px: rd16(m, S.K_PX), py: m.ram[S.K_PY] });
    check('press on line 1, move to line 4, release');
    sec.end(`the double click's presses ${gapSeen} frames apart`);
  }

  // ===========================================================================================================================
  if (ONLY.includes(5)) {
    const sec = new Sec('5 "Grid": its checked state switches the List to cell lines (9 lines of 16 codes on the 8 x 8 grid) with TK_SETITEMS (selection cleared); unchecking restores the proportional look'); curSec = sec;
    const pt = (n) => [n.x + 20, n.y + 4];
    const gridState = () => m.ram[list.addr + S.View_flags] & 16;
    // select something first, so that the clearing shows
    for (let k = 0; k < 8 && tree.focus !== list; k++) key(14, 'TAB to the List');
    key(10, 'DOWN'); key(10, 'DOWN');
    sec.ok(m.ram[list.addr + S.List_sel] !== 0xFF, 'a line is selected before "Grid"');
    let p = pt(grid); click(p[0], p[1], 100, 'click "Grid" on');
    sec.ok(!!(grid.flags & M.FL.CHECKED) && gridState() === 16, () => `Grid checked ${!!(grid.flags & M.FL.CHECKED)}, the List's flags ${hex(m.ram[list.addr + S.View_flags], 2)}: bit 4 should be set`);
    sec.ok(m.ram[list.addr + S.List_sel] === 0xFF && m.ram[list.addr + S.List_top] === 0 && m.ram[list.addr + S.List_count] === 24, () => `after "Grid": sel ${m.ram[list.addr + S.List_sel]} top ${m.ram[list.addr + S.List_top]} count ${m.ram[list.addr + S.List_count]}; want $FF, 0, 24 (TK_SETITEMS with the same items)`);
    sec.ok(listBar.max === 24 - M2.listN(list) && listBar.page === M2.listN(list) && M2.listN(list) === 9, () => `cell lines: n ${M2.listN(list)}, bar max ${listBar.max} page ${listBar.page}; want n 9, max 15, page 9`);
    for (let k = 0; k < 8 && tree.focus !== list; k++) key(14, 'TAB to the List');
    for (let i = 0; i < 12; i++) key(10, `DOWN ${i + 1} in cell lines`);
    sec.ok(list.sel === 11 && list.top === 3, () => `cell lines, 12 DOWN: sel ${list.sel} top ${list.top}; with 9 lines sel 11 shows with top 3`);
    key(13, 'ENTER in cell lines');
    sec.ok(text(status.codes) === 'Open: ' + text(list.items[list.sel]), () => `status "${text(status.codes)}"`);
    p = linePt(2); click(p[0], p[1], 100, 'click a cell line');
    p = pt(grid); click(p[0], p[1], 100, 'click "Grid" off');
    sec.ok(!(grid.flags & M.FL.CHECKED) && gridState() === 0 && m.ram[list.addr + S.List_sel] === 0xFF, () => `Grid off: checked ${!!(grid.flags & M.FL.CHECKED)}, List bit 4 ${gridState()}, sel ${m.ram[list.addr + S.List_sel]}`);
    key(10, 'DOWN after Grid off');
    // SPACE on the focused Grid check does the same as a click
    for (let k = 0; k < 8 && tree.focus !== grid; k++) key(15, 'BACKTAB to Grid');
    key(32, 'SPACE on Grid (on)'); sec.ok(gridState() === 16, 'SPACE on Grid switches the cell lines on');
    key(32, 'SPACE on Grid (off)'); sec.ok(gridState() === 0, 'SPACE on Grid switches them off');
    sec.end('Grid on and off by the mouse and by SPACE, with a selection before');
  }

  // ===========================================================================================================================
  if (ONLY.includes(6)) {
    const sec = new Sec('6 Field: TAB to it, type letters, digits and every SYMBOL SHIFT character of the key map, DELETE, LEFT, RIGHT, a click moving the caret, ENTER sets the status to "Name: " and the text; the screen after every key'); curSec = sec;
    for (let k = 0; k < 8 && tree.focus !== field; k++) key(14, 'TAB to the Field');
    sec.ok(tree.focus === field && rd16(m, S.K_FOCUS) === field.addr, 'the Field has the focus');
    // SYMBOL SHIFT characters (keymap.txt plane 3), CAPS SHIFT letters, plain letters and digits
    const SS = '!@#$%&\'()_;":`?/~|\\{}[]<>=+-^.,*';
    let typed = 0;
    const typeStr = (s, tag) => { for (const c of s) { const code = c.charCodeAt(0); key(code, `${tag} ${JSON.stringify(c)}`); typed++; sec.ok(text(field.buf).includes(c), () => `after typing ${JSON.stringify(c)} the Field holds ${X.show(field.buf)}`); } };
    const statusOk = (what) => sec.ok(text(status.codes) === 'Name: ' + text(field.buf), () => `${what}: the status reads ${X.show(status.codes)}, want "Name: " + ${X.show(field.buf)}`);
    sec.ok(text(field.buf) === 'Leap' && field.caret === 4, 'the Field starts with "Leap", the caret at its end');
    typeStr(' Ann', 'letters');                                        // a space, a capital (CAPS SHIFT + A) and lower case
    typeStr('1987', 'digits');
    sec.ok(text(field.buf) === 'Leap Ann1987', () => `the Field holds ${X.show(field.buf)}, want "Leap Ann1987"`);
    // ENTER: E_CMD, the status "Name: " and the text (short: the status Label shows it whole)
    let posts = key(13, 'ENTER in the Field');
    sec.ok(posts.some((x) => x.id === ID.field), () => `ENTER in the Field posted ${JSON.stringify(posts)}; want E_CMD for id ${ID.field}`);
    statusOk('after ENTER');
    // SYMBOL SHIFT characters (keymap.txt, the third column): 28 of them fill the Field to its cap (40), the 41st code changes nothing
    typeStr(SS.slice(0, 28), 'SYMBOL SHIFT');
    sec.ok(field.buf.length === 40 && m.ram[rd16(m, field.addr + S.Field_buf)] === 40, () => `the Field holds ${field.buf.length} codes, want cap 40`);
    sec.ok(field.first > 0, () => `40 codes do not fit in 160 pixels: first is ${field.first}`);
    key(122, 'z into the full Field'); sec.ok(field.buf.length === 40, 'a full Field takes no more codes');
    for (let i = 0; i < 10; i++) key(12, `DELETE ${i + 1}`);
    typeStr(SS.slice(28), 'SYMBOL SHIFT (the rest)');
    for (let i = 0; i < 2; i++) key(8, `LEFT ${i + 1}`);
    typeStr('X', 'inserted');
    key(9, 'RIGHT');
    for (let i = 0; i < 12; i++) key(8, `LEFT ${i + 1}`);
    typeStr('Q', 'inserted in the middle');
    // a click in the text moves the caret (the first code whose middle is right of the click)
    const px0 = field.x + 3 + M2.tw(field.buf, field.first, field.first + 3) + 1;
    click(px0, field.y + 5, 100, 'click in the Field text');
    sec.ok(field.caret === M2.fieldClickCaret({ ...field, caret: 0 }, px0), () => `a click at ${px0}: caret ${field.caret}`);
    typeStr('w', 'after the click');
    // back to the end and a shorter text, then ENTER again
    for (let i = 0; i < field.buf.length; i++) { L.typeCode(env, 9, 2, 1); tree.dispatch({ t: M.E.KEY, key: 9 }); }
    check('RIGHT to the end', { frames: 4 });
    while (M2.textw(field.buf) > 200 && field.buf.length) key(12, 'DELETE to shorten');
    posts = key(13, 'ENTER in the shortened Field');
    statusOk('after the second ENTER');
    // DELETE everything, then the status of an empty name
    while (field.buf.length) key(12, 'DELETE all');
    key(13, 'ENTER in the empty Field');
    sec.ok(text(status.codes) === 'Name: ', () => `the status of an empty Field reads ${X.show(status.codes)}, want "Name: "`);
    typeStr('ok', 'new text');
    // the keys the Field does not take move the focus (TAB, UP, DOWN), LEFT / RIGHT do not
    typeStr('ok', 'new text');
    key(14, 'TAB from the Field (wraps to the first control)');
    sec.ok(tree.focus === real.find((n) => n.kind === 'Check'), 'TAB from the Field wraps to Sound');
    key(15, 'BACKTAB back to the Field');
    sec.ok(tree.focus === field, 'BACKTAB returns to the Field');
    key(11, 'UP leaves the Field'); sec.ok(tree.focus === list, 'UP moves the focus back to the List');
    key(14, 'TAB to the Field'); sec.ok(tree.focus === field, 'TAB returns to the Field');
    key(10, 'DOWN leaves the Field'); sec.ok(tree.focus === real.find((n) => n.kind === 'Check'), 'DOWN moves the focus on (wrapping to Sound)');
    key(15, 'BACKTAB to the Field'); sec.ok(tree.focus === field, 'BACKTAB returns to the Field');
    key(8, 'LEFT stays in the Field'); sec.ok(tree.focus === field, 'LEFT moves the caret, not the focus');
    sec.end(`${typed} codes typed (${SS.length} SYMBOL SHIFT characters), final status ${X.show(status.codes)}`);
  }
}

if (!demoOk && ONLY.includes(1)) sec0.end('views missing: the other groups were skipped');
// ===========================================================================================================================
if (ONLY.includes(7)) {
  const sec = new Sec('7 frames and memory: V_FRAMES rose by 1 on every normally run frame (no frame interrupt lost, no DI), the memory watch of BANKING 10.7');
  sec.ok(env.vf.bad === 0, () => `V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first: ${env.vf.first}`);
  sec.ok(env.w.n === 0, () => `memory watch: ${env.w.summary()}`);
  sec.end(`${env.vf.checked} frames checked, ${env.frames} frames run`);
}
finish();
