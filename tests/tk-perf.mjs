"use strict";
// tk-perf.mjs -- toolkit T1's bounds, docs/TOOLKIT.md sections 7 and 9.5, as a table, on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt).
// Written from the contract only (never from src/kernel/tk.asm).  T-states are TSRun's (no memory contention); direct calls under mapping K with a sentinel
// return, interrupts off unless a row says otherwise (a HALT is answered by the harness, tests/tk-lib.mjs runCall).
//   node tests/tk-perf.mjs [--seed N]
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import * as X from './tk-lib2.mjs';

const { L, hex, rd16 } = T;
const { argNum } = L;
const SEED = argNum('--seed', 1);
const rng = L.makeRng(SEED);
console.log(`seed ${SEED} (rerun with --seed ${SEED}; the measurements are deterministic, the seed picks the registers the routines ignore and the random bars)`);
const rows = [];
let missed = 0;
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en') : String(n));
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  rows.push({ name, measured, bound, status, note });
  console.log(`${status === 'MISSED' ? 'FAIL' : 'ok  '} | ${name} | measured ${fmt(measured)} | bound ${bound === null ? 'report' : '<= ' + fmt(bound)} | ${status}${note ? ' | ' + note : ''}`);
};
const g0 = new M.Gfx6Model();
const WIN = { x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Perf') };

const env = T.bootParked({ rng });
const { m, S } = env;
const rb = (a) => m.bus.read(a);
const rw = (a) => rb(a) | (rb(a + 1) << 8);
const methodOf = (cls, msg) => rw(cls + 2 * msg);

// ---- bytes (9.5: TK_END - TK_CODE plus the class descriptors in tk-classes.inc, reported per class) --------------------------------------------------------------------
{
  const total = S.TK_END - S.TK_CODE, descr = (S.CL_VScroll - S.CL_Check), nclass = 2;
  // the top-level labels between TK_CODE and TK_END (the symbol file lists them with their addresses); the share of each, by the next label's address
  const tops = Object.entries(S).filter(([n, a]) => a >= S.TK_CODE && a <= S.TK_END && !n.includes('.') && !/^[A-Z]+_?[A-Z]*(END|CODE)$/.test(n) && n !== 'TK_CODE' && n !== 'TK_END' && !/^(CL_|TK_[A-Z]+$)/.test(n) || n === 'TK_SETBAR')
    .filter(([n]) => !/^(Check|VScroll|View)_/.test(n)).sort((a, b) => a[1] - b[1]);
  const size = (i) => (i + 1 < tops.length ? tops[i + 1][1] : S.TK_END) - tops[i][1];
  const grp = { shared: 0, Check: 0, VScroll: 0, 'TK_SETBAR': 0, other: 0 };
  const detail = [];
  tops.forEach(([n, a], i) => {
    const sz = size(i); detail.push(`${n} ${sz}`);
    if (/^(tk_)/.test(n)) grp.shared += sz; else if (/^(check_|chk_)/.test(n)) grp.Check += sz; else if (/^vs_/.test(n)) grp.VScroll += sz; else if (n === 'TK_SETBAR') grp.TK_SETBAR += sz; else grp.other += sz;
  });
  const classDescr = (cls) => 18;                                                            // 6 header bytes + 6 method slots (OBJECTS_EVENTS 3)
  row('bytes in the pool: TK_END - TK_CODE (code of both classes, the shared helpers and TK_SETBAR)', total, null, `TK_CODE ${hex(S.TK_CODE)}, TK_END ${hex(S.TK_END)}; by label: shared helpers ${grp.shared}, Check ${grp.Check} (check_draw, check_event, chk_act), VScroll ${grp.VScroll} (vs_geom, vs_draw, vs_event), TK_SETBAR ${grp.TK_SETBAR}${grp.other ? ', other ' + grp.other : ''}`);
  row('bytes of the two class descriptors (CL_Check, CL_VScroll: 6 header + 12 method bytes each)', nclass * classDescr(), null, `Check ${classDescr()} at ${hex(S.CL_Check - 6)}, VScroll ${classDescr()} at ${hex(S.CL_VScroll - 6)}`);
  row('T1 toolkit bytes in the pool (code + descriptors); section 7 bounds all four controls and both routines at 2,600 (EST 1,800-2,400)', total + nclass * classDescr(), 2600, `${((total + nclass * classDescr()) / 26).toFixed(1)} % of the 2,600 used by Check and VScroll; List, Field, TK_SETTEXT, TK_SETITEMS (T2, T3) still to come: ${2600 - total - nclass * classDescr()} bytes left`);
}

// ---- W_DRAWVIEW per 1,000 pixels against Button's 28,816 T for 64 x 16 -------------------------------------------------------------------------------------------------
const BUTTON_T = 28816, BUTTON_PX = 64 * 16, BUTTON_PER_K = BUTTON_T / BUTTON_PX * 1000;
const textWidthCodes = (n) => { for (let k = 0; k < 4000; k++) { const c = []; for (let i = 0; i < 1 + n; i++) c.push(rng.int(97, 122)); const w = g0.textw(c); if (w === 40) return c; } return T.codesOf('Grid'); };
{
  const sound = T.codesOf('Sound'), c40 = (() => { for (let k = 0; k < 20000; k++) { const c = []; const n = rng.int(5, 9); for (let i = 0; i < n; i++) c.push(rng.int(65, 122)); if (g0.textw(c) === 40) return c; } return T.codesOf('Grid'); })();
  const nodes = [
    { kind: 'Check', id: 130, x: 24, y: 24, w: 72, h: 9, flags: 1 | M.FL.CHECKED, codes: sound },
    { kind: 'Check', id: 131, x: 24, y: 40, w: 17 + g0.textw(c40), h: 9, flags: 1, codes: c40 },
    { kind: 'VScroll', id: 132, x: 200, y: 24, w: 12, h: 80, value: 10, max: 20, page: 5, target: 0 },
    { kind: 'VScroll', id: 133, x: 240, y: 24, w: 12, h: 146, value: 10, max: 20, page: 5, target: 0 },
    { kind: 'VScroll', id: 134, x: 280, y: 24, w: 12, h: 146, value: 137, max: 255, page: 17, target: 0 },
    { kind: 'VScroll', id: 135, x: 320, y: 24, w: 12, h: 32, value: 0, max: 0, page: 0, target: 0 },
  ];
  const btn = { x: 24, y: 80, w: 64, h: 16 };
  const tree = new M.TkTree(WIN, nodes);
  T.buildTree(env, tree);
  // a kernel Button as the reference, built the same way
  const bAddr = T.kNew(env, S.CL_Button = S.CL_Button);
  T.setRect(env, bAddr, btn.x, btn.y, btn.w, btn.h); T.poke8(env, bAddr + S.View_flags, 1); T.poke16(env, bAddr + S.Button_text, T.str(env, T.codesOf('Button')));
  T.addChild(env, tree.win.addr, bAddr);
  T.runCall(env, S.W_UPDATE, {}, { ints: false });
  const meas = (addr) => { const ts = []; for (let i = 0; i < 3; i++) ts.push(T.runCall(env, S.W_DRAWVIEW, { ix: addr }, { ints: false }).t); return ts; };
  T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
  const tb = meas(bAddr);
  row(`reference: W_DRAWVIEW of a kernel Button 64 x 16, normal look (the figure the contract compares with is ${fmt(BUTTON_T)}, probably a pressed / default / focused Button; the ratios below use ${fmt(BUTTON_T)})`, tb[0], null, `${fmt(tb[0])} T for ${BUTTON_PX} pixels = ${fmt(Math.round(tb[0] / BUTTON_PX * 1000))} T per 1,000 pixels; repeated ${tb.join(', ')}`);
  const perK = (t, w, h) => Math.round(t / (w * h) * 1000);
  // absBound: 9.7's absolute bounds (Check 72 x 9 checked and focused <= 31,200 T; the bar 12 x 80 <= 47,700 T); the per-1,000-pixel figures and the other views are reported
  const report = (what, n, focus, absBound = null) => {
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); if (focus) T.runCall(env, S.K_SETFOCUS, { de: n.addr }, { ints: false });
    const ts = meas(n.addr), t = absBound !== null ? Math.max(...ts) : ts[0], k = perK(t, n.w, n.h), ratio = k / BUTTON_PER_K;
    // the look must still be right (the measurement is of the contract's drawing)
    const g = new M.Gfx6Model(); g.setClip(n.x, n.y, n.w, n.h);
    if (n.kind === 'Check') M.checkLook(g, n, !!focus); else M.vsLook(g, n, 0);
    const d = T.diffRect(env, g, n.x, n.y, n.w, n.h);
    const bound = absBound;
    row(`W_DRAWVIEW of ${what} (${n.w} x ${n.h} = ${n.w * n.h} pixels): ${fmt(k)} T per 1,000 pixels = ${ratio.toFixed(2)} x Button's ${fmt(Math.round(BUTTON_PER_K))}`, t, bound,
      `T-states${bound !== null ? `; absolute bound (9.7, owner 2026-11-12; replaces the 1.5 x ratio)` : '; reported, with its per-1,000-pixel figure'}; repeated ${ts.join(', ')}; screen ${d === null ? 'equals the model' : 'DIFFERS: ' + d}`);
    if (d !== null) { missed++; console.log(`FAIL | the drawing measured differs from the model: ${what}`); }
  };
  report('a Check "Sound", checked and focused (9.5, 9.7)', nodes[0], true, 31200);
  report('a Check "Sound", checked, not focused', nodes[0], false);
  report(`a Check with a 40-pixel text "${String.fromCharCode(...c40)}", focused`, nodes[1], true);
  report('a VScroll, the demo\'s bar: max 20, page 5, value 10 (9.5, 9.7)', nodes[2], false, 47700);
  report('a VScroll 12 x 146, max 20, page 5, value 10 ', nodes[3], false);
  report('a VScroll 12 x 146, max 255, page 17, value 137', nodes[4], false);
  report('a VScroll 12 x 32 with no thumb (max 0)', nodes[5], false);
  T.clearTree(env, tree);
}

// ---- the arrow click: K_DISPATCH of the E_DOWN to the bar redrawn and the target told ----------------------------------------------------------------------------------------
{
  const win = { ...WIN };
  for (const [what, bar, py] of [['up arrow', { x: 200, y: 24, w: 12, h: 80, value: 10, max: 20, page: 5 }, 28], ['down arrow', { x: 200, y: 24, w: 12, h: 80, value: 10, max: 20, page: 5 }, 100], ['page down', { x: 200, y: 24, w: 12, h: 80, value: 5, max: 20, page: 5 }, 90]]) {
    const node = { kind: 'VScroll', id: 140, ...bar, target: 0, press: 0 };
    const tree = new M.TkTree(win, [node]);
    node.target = T.kNew(env, T.STUB_CLASS);
    T.buildTree(env, tree);
    T.drainEvents(env); T.setEv(env, T.ptRec(M.E.DOWN, 205, py, 1)); T.setVframes(env, 1000);
    let tTell = 0, tGet = 0, t0 = 0, draws0 = 0, drawsTell = 0, tellRec = null;
    const hooks = {
      [T.STUB]: (info) => { tTell = m.tstates - t0; drawsTell = info.draws.length; const de = (m.cpu.d << 8) | m.cpu.e; tellRec = [0, 1, 2, 3].map((i) => m.ram[de + i]); },
      [S.K_GETEV]: (info) => { if (tTell) { tGet = m.tstates - t0; return 'stop'; } },
    };
    t0 = m.tstates;
    const r = T.runCall(env, S.K_DISPATCH, {}, { hooks, ints: true, onHalt: () => { throw new Error('halted before the first K_GETEV after the tell'); } });
    row(`arrow click (${what}): K_DISPATCH of the E_DOWN to the target told (the bar drawn ${drawsTell} time(s) before; record [${tellRec}])`, tTell, null, `T-states; to the loop's next K_GETEV (the step done, the loop idle): ${fmt(tGet)}`);
    T.clearTree(env, tree);
  }
}

// ---- E_MOVE, no capture, over a window holding one of each control (<= 3,900) --------------------------------------------------------------------------------------------------
{
  const STUBEV = 0x5E40;
  const wr = (b) => b.forEach((v, i) => { m.ram[STUBEV + i] = v; });
  wr([0xCD, S.K_GETEV & 255, S.K_GETEV >> 8, 0xD8, 0xCD, S.K_DISPATCH & 255, S.K_DISPATCH >> 8, 0xC9]);        // CALL K_GETEV / RET C / CALL K_DISPATCH / RET
  const mk = (kind, id, x, y) => {
    const n = { kind, id, x, y, w: 80, h: 12, flags: 0, codes: T.codesOf('Label') };
    if (kind === 'Check') { n.flags = 1; n.w = 72; n.h = 9; n.codes = T.codesOf('Sound'); }
    if (kind === 'VScroll') { Object.assign(n, { w: 12, h: 80, value: 10, max: 20, page: 5, target: 0 }); }
    return n;
  };
  const kinds = ['Label', 'Check', 'VScroll'];
  let worst = 0, worstWhere = '';
  const per = [];
  for (let last = 0; last < 3; last++) {
    const order = kinds.filter((_, i) => i !== last).concat([kinds[last]]);
    // one of each control; the controls side by side (the bar at the right), the hit one last in the window's list
    const nodes = order.map((k, i) => mk(k, 150 + i, k === 'VScroll' ? 300 : 40, 30 + 20 * i));
    const tree = new M.TkTree(WIN, nodes);
    T.buildTree(env, tree);
    const tgt = nodes[2], cls = tgt.kind === 'Check' ? S.CL_Check : tgt.kind === 'VScroll' ? S.CL_VScroll : S.CL_Label;
    const stopPc = methodOf(cls, S.M_EVENT);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
    for (const how of ['ring', 'posted']) {
      T.drainEvents(env); T.poke16(env, S.K_CAPTURE, 0);
      const rec = T.ptRec(M.E.MOVE, tgt.x + 3, tgt.y + 3, 0);
      if (how === 'ring') T.ringPut(env, rec); else T.runCall(env, S.K_POST, { a: rec[0], c: rec[1], e: rec[2], d: rec[3] }, { ints: false });
      const r = T.runCall(env, STUBEV, {}, { stopPc, ints: false });
      T.drainEvents(env);
      per.push(`${tgt.kind} last (${how}) ${r.t}${r.stopped ? '' : ' NOT STOPPED'}`);
      if (!r.stopped) { missed++; console.log(`FAIL | E_MOVE over the ${tgt.kind} did not reach its M_EVENT ${hex(stopPc)}`); }
      if (r.t > worst) { worst = r.t; worstWhere = `${tgt.kind} last in the list (${how})`; }
    }
    T.clearTree(env, tree);
  }
  row('E_MOVE, no capture: K_GETEV + K_DISPATCH from the stub\'s first instruction to the hit control\'s M_EVENT, a window with a Label, a Check and a VScroll (worst of the three orders)', worst, 3900, `worst: ${worstWhere}; all: ${per.join('; ')}`);
}

// ---- the stack: Check's and VScroll's M_EVENT and M_DRAW (<= 64 bytes each) -----------------------------------------------------------------------------------------------------
{
  const sendOf = (addr, msg, de) => T.runCall(env, S.T_SEND, { ix: addr, a: msg, de }, { ints: false });
  // Check: a window with check boxes and radios, one focused
  const codes = T.codesOf('Sound');
  const checksN = [0, 1, 2, 3, 4, 5].map((i) => ({ kind: 'Check', id: 160 + i, x: 40, y: 24 + 14 * i, w: 72, h: 9, flags: 1 | (i >= 2 ? M.FL.RADIO : 0) | (i === 3 ? M.FL.CHECKED : 0), codes }));
  const tree = new M.TkTree(WIN, checksN);
  T.buildTree(env, tree);
  const worstOf = {};
  const upd = (k, r) => { if (!worstOf[k] || r.stack - 2 > worstOf[k].v) worstOf[k] = { v: r.stack - 2, t: r.t }; };   // the 2 bytes of T_SEND's own RST return
  const radio = checksN[4], box = checksN[0];
  T.runCall(env, S.K_SETFOCUS, { de: box.addr }, { ints: false });
  const ev = (rec) => { T.setEv(env, rec); return S.K_EV; };
  upd('Check M_EVENT E_DOWN', sendOf(box.addr, S.M_EVENT, ev(T.ptRec(M.E.DOWN, 50, 26, 1))));
  T.poke16(env, S.K_CAPTURE, box.addr);
  upd('Check M_EVENT E_MOVE out', sendOf(box.addr, S.M_EVENT, ev(T.ptRec(M.E.MOVE, 300, 100, 1))));
  upd('Check M_EVENT E_MOVE in', sendOf(box.addr, S.M_EVENT, ev(T.ptRec(M.E.MOVE, 50, 26, 1))));
  upd('Check M_EVENT E_UP (check box activated)', sendOf(box.addr, S.M_EVENT, ev(T.ptRec(M.E.UP, 50, 26, 0))));
  T.poke8(env, radio.addr + S.View_flags, m.ram[radio.addr + S.View_flags] | M.FL.PRESSED);
  upd('Check M_EVENT E_UP (radio activated: siblings cleared, redrawn, E_CMD posted)', sendOf(radio.addr, S.M_EVENT, ev(T.ptRec(M.E.UP, 50, 80, 0))));
  upd('Check M_EVENT SPACE (radio)', sendOf(checksN[2].addr, S.M_EVENT, ev([M.E.KEY, 32, 0, 0])));
  upd('Check M_EVENT SPACE (check box)', sendOf(box.addr, S.M_EVENT, ev([M.E.KEY, 32, 0, 0])));
  T.drainEvents(env);
  for (const a of checksN) { upd('Check M_DRAW', sendOf(a.addr, S.M_DRAW, 0)); }
  for (const f of [S.M_FOCUS, S.M_BLUR]) upd(`Check ${f === S.M_FOCUS ? 'M_FOCUS' : 'M_BLUR'}`, sendOf(box.addr, f, 0));
  T.clearTree(env, tree);
  // VScroll: M_EVENT with tracking (arrow hold with repeats, page, thumb drag; target told and E_CMD), M_DRAW
  const barNodes = [];
  let worstBar = { v: 0, what: '' };
  for (let k = 0; k < 24; k++) {
    const mode = k % 2 ? 'tell' : 'cmd';
    const bar = { x: 200, y: 24, w: 12, h: rng.pick([32, 80, 146, 160]), value: rng.int(0, 20), max: 20, page: 5 };
    const node = { kind: 'VScroll', id: 170, ...bar, target: 0, press: 0 };
    const t2 = new M.TkTree(WIN, [node]);
    if (mode === 'tell') node.target = T.kNew(env, T.STUB_CLASS);
    T.buildTree(env, t2);
    const gm = M.vsGeom(bar), part = ['up', 'down', 'pgup', 'pgdn', 'thumb'][k % 5];
    let py = { up: bar.y + 3, down: bar.y + bar.h - 3, pgup: bar.y + 12, pgdn: bar.y + bar.h - 12, thumb: gm.ty + 2 }[part];
    const frames = []; const H = rng.pick([2, 18, 30]);
    for (let i = 0; i < H; i++) frames.push([]);
    if (part === 'thumb') for (let i = 0; i < H; i += 2) frames[i].push({ t: 'move', px: 205, py: bar.y + rng.int(10, bar.h - 10) });
    frames[H - 1].push({ t: 'up' });
    T.drainEvents(env); T.setVframes(env, 500); T.poke16(env, S.K_CAPTURE, 0);
    let wakes = 0;
    T.setEv(env, T.ptRec(M.E.DOWN, 205, py, 1));
    const r = T.runCall(env, S.T_SEND, { ix: node.addr, a: S.M_EVENT, de: S.K_EV }, {
      ints: true,
      onHalt: () => { wakes++; T.setVframes(env, 500 + wakes); for (const e of frames[wakes - 1] || []) T.ringPut(env, e.t === 'move' ? T.ptRec(M.E.MOVE, e.px, e.py, 1) : T.ptRec(M.E.UP, 205, py, 0)); },
    });
    const used = r.stack - 2;
    if (used > worstBar.v) worstBar = { v: used, what: `${part}, ${mode}, h ${bar.h}, ${H} frames` };
    upd('VScroll M_EVENT (tracking included)', r);
    T.drainEvents(env);
    T.clearTree(env, t2);
  }
  {
    const bar = { x: 200, y: 24, w: 12, h: 80, value: 10, max: 20, page: 5 };
    const node = { kind: 'VScroll', id: 170, ...bar, target: 0, press: 2 };
    const t3 = new M.TkTree(WIN, [node]);
    T.buildTree(env, t3);
    for (const press of [0, 1, 2]) { T.poke8(env, node.addr + S.VScroll_press, press); upd('VScroll M_DRAW', sendOf(node.addr, S.M_DRAW, 0)); }
    T.clearTree(env, t3);
  }
  for (const [k, v] of Object.entries(worstOf)) row(`stack: ${k}`, v.v, k.startsWith('Check M_FOCUS') || k.startsWith('Check M_BLUR') ? null : 64, `bytes below the callee's return address (T_SEND's own 2 not counted); ${fmt(v.t)} T`);
  console.log(`  (the deepest VScroll M_EVENT: ${worstBar.v} bytes for ${worstBar.what})`);
}

// ---- T2 / T3 (TOOLKIT 10.6): List and Field --------------------------------------------------------------------------------------------------------------------------------------
T.needSyms(env, T.NEEDED2);
{
  // bytes: TK2_END - TK2_CODE plus the two descriptors (18 each); the top-level labels split into List, Field and shared code (names read from the symbol file: ls_ / list_ / TK_SETITEMS, fd_ / field_ / TK_SETTEXT, tk_)
  const total = S.TK2_END - S.TK2_CODE, descr = 2 * 18;
  const tops = Object.entries(S).filter(([n, a]) => a >= S.TK2_CODE && a < S.TK2_END && !n.includes('.') && !/(_END|_CODE)$/.test(n)).sort((a, b) => a[1] - b[1]);
  const grp = { List: 0, Field: 0, shared: 0 };
  tops.forEach(([n, a], i) => { const sz = (i + 1 < tops.length ? tops[i + 1][1] : S.TK2_END) - a; if (/^(ls_|list_|TK_SETITEMS)/.test(n)) grp.List += sz; else if (/^(fd_|field_|TK_SETTEXT)/.test(n)) grp.Field += sz; else grp.shared += sz; });
  row('T2 / T3 bytes in the pool: TK2_END - TK2_CODE (List, Field, TK_SETITEMS, TK_SETTEXT and the shared code), report', total, null, `TK2_CODE ${hex(S.TK2_CODE)}, TK2_END ${hex(S.TK2_END)}; List ${grp.List}, Field ${grp.Field}, shared ${grp.shared} (by label prefix)`);
  row('T2 / T3 bytes: tk2.asm plus the two class descriptors (18 each) against 1,382 (the toolkit\'s 2,600 less T1\'s 1,218)', total + descr, 1382, `${total} + ${descr}; step 5's pool growth stays <= 3,400 (BANKING 6.1)`);
}
const listTree = (cell, withBar, sel = 3, top = 0) => {
  const rect = cell ? [30, 23, 132, 130] : [24, 24, 128, 146];
  const list = { kind: 'List', id: 150, x: rect[0], y: rect[1], w: rect[2], h: rect[3], flags: 1 | (cell ? 16 : 0), items: X.STD_ITEMS.map((c) => c.slice()), count: 24, sel, top, bar: null };
  const kids = [list];
  if (withBar) { const bar = { kind: 'VScroll', id: 152, x: list.x + list.w, y: list.y, w: 12, h: list.h, value: 0, max: 0, page: 0, target: 0, press: 0, targetNode: list }; list.bar = bar; M.setBar(bar, top, M2.listMaxTop(list), M2.listN(list)); kids.push(bar); }
  return new M2.TkTree2(WIN, kids);
};
{
  const meas = (addr) => { const ts = []; for (let i = 0; i < 3; i++) ts.push(T.runCall(env, S.W_DRAWVIEW, { ix: addr }, { ints: false }).t); return ts; };
  // W_DRAWVIEW of a List: 128 x 146 proportional (16 lines), 132 x 130 cell lines at x = 8 a + 6, y = 8 b + 7 (16 lines of 16 cells); item 3 selected, focused (report)
  for (const cell of [false, true]) {
    const tree = listTree(cell, false), list = tree.nodes()[0];
    T.buildTree(env, tree);
    const n = M2.listN(list);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: list.addr }, { ints: false });
    const ts = meas(list.addr);
    const g = new M.Gfx6Model(); g.setClip(list.x, list.y, list.w, list.h); M2.listLook(g, list, true);
    const d = T.diffRect(env, g, list.x, list.y, list.w, list.h);
    row(`W_DRAWVIEW of a ${cell ? `cell-lines List ${list.w} x ${list.h} at (${list.x}, ${list.y}) (x = 8a + 6, y = 8b + 7)` : `List ${list.w} x ${list.h}, proportional`}, ${n} lines of the standard items, item 3 selected, focused (${list.w * list.h} pixels)`, ts[0], null, `T-states, report; repeated ${ts.join(', ')}; ${n} lines${n === 16 ? '' : ' (CONTRACT: 16 expected)'}; screen ${d === null ? 'equals the model' : 'DIFFERS: ' + d}`);
    if (d !== null || n !== 16) { missed++; console.log('FAIL | the List drawn differs from the model, or does not show 16 lines'); }
    T.clearTree(env, tree);
  }
  // W_DRAWVIEW of a Field 160 x 12 showing 30 codes, focused (report)
  {
    const f = { kind: 'Field', id: 154, x: 40, y: 40, w: 160, h: 12, flags: 1, buf: T.codesOf('abcdefghijklmnopqrstuvwxyzabcd'), cap: 40, caret: 30, first: 0 };
    M2.fieldAdjust(f);
    const tree = new M2.TkTree2(WIN, [f]); T.buildTree(env, tree);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: f.addr }, { ints: false });
    const ts = meas(f.addr);
    const g = new M.Gfx6Model(); g.setClip(f.x, f.y, f.w, f.h); M2.fieldLook(g, f, true);
    const d = T.diffRect(env, g, f.x, f.y, f.w, f.h);
    row(`W_DRAWVIEW of a Field 160 x 12 holding 30 codes (first ${f.first}: the codes that fit are drawn), focused (${f.w * f.h} pixels)`, ts[0], null, `T-states, report; repeated ${ts.join(', ')}; screen ${d === null ? 'equals the model' : 'DIFFERS: ' + d}`);
    if (d !== null) { missed++; console.log('FAIL | the Field drawn differs from the model'); }
    T.clearTree(env, tree);
  }
  // the key rows: K_DISPATCH of an E_KEY to the return, interrupts on, the worst of three runs
  const runKey = (code) => { T.drainEvents(env); T.setEv(env, [M.E.KEY, code, 0, 0]); return T.runCall(env, S.K_DISPATCH, {}, {}); };
  for (const cell of [false, true]) {
    for (const [what, sel0, wantSel, wantTop] of [['List scrolled by one line: DOWN with sel the last line shown (top 0, sel 15), includes the full draw and the bar\'s', 15, 16, 1], ['a selection moved by DOWN within the lines shown (sel 3 -> 4)', 3, 4, 0]]) {
      const tree = listTree(cell, true, sel0, 0), list = tree.nodes()[0], bar = list.bar;
      T.buildTree(env, tree);
      T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: list.addr }, { ints: false });
      const ts = [];
      let ok = true, last = null;
      for (let i = 0; i < 3; i++) {
        T.poke8(env, list.addr + S.List_sel, sel0); T.poke8(env, list.addr + S.List_top, 0);
        T.poke8(env, bar.addr + S.VScroll_value, 0); T.poke8(env, bar.addr + S.VScroll_max, 8); T.poke8(env, bar.addr + S.VScroll_page, 16);
        const r = runKey(M2.KEY.DOWN); last = r; ts.push(r.t);
        ok = ok && m.ram[list.addr + S.List_sel] === wantSel && m.ram[list.addr + S.List_top] === wantTop;
        if (r.di) { missed++; console.log('FAIL | a DI in the key run'); }
      }
      const bound = sel0 === 15 ? (cell ? 209400 : 303500) : null;   // TOOLKIT 10.10: the owner set the one-line scroll bounds at the measured figures
      row(`${what}, ${cell ? 'cell lines (bar 12 x 130)' : 'proportional (bar 12 x 146)'}: K_DISPATCH of E_KEY DOWN`, Math.max(...ts), bound, `T-states, worst of three (the one-line scroll: the owner's bound, TOOLKIT 10.10; the selection move: report); runs ${ts.join(', ')}; ${last.draws.length} W_DRAWVIEW(s); state after: ${ok ? `sel ${wantSel} top ${wantTop} as expected` : 'NOT as expected: sel ' + m.ram[list.addr + S.List_sel] + ' top ' + m.ram[list.addr + S.List_top]}`);
      if (!ok) { missed++; console.log('FAIL | the List state after DOWN is not what 10.3 says'); }
      T.clearTree(env, tree);
    }
  }
  // a typed code: a Field 160 x 12, cap 40, 30 codes set by TK_SETTEXT, focused; K_DISPATCH of E_KEY 'x' to the return (<= 58,000)
  {
    const f = { kind: 'Field', id: 154, x: 40, y: 40, w: 160, h: 12, flags: 1, buf: [], cap: 40, caret: 0, first: 0 };
    const tree = new M2.TkTree2(WIN, [f]); T.buildTree(env, tree);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: f.addr }, { ints: false });
    const ts = []; let ok = true, draws = 0;
    for (let i = 0; i < 3; i++) {
      const src = T.str(env, T.codesOf('abcdefghijklmnopqrstuvwxyzabcd'));
      T.runCall(env, S.TK_SETTEXT, { ix: f.addr, hl: src }, {});
      const r = runKey(120); ts.push(r.t); draws = r.draws.length;
      ok = ok && m.ram[T.rd16(m, f.addr + S.Field_buf)] === 31 && m.ram[f.addr + S.Field_caret] === 31;
      env.strp = T.STR0 + 40;
    }
    row('a typed code: Field 160 x 12, cap 40, 30 codes by TK_SETTEXT, focused; K_DISPATCH of E_KEY \'x\' to the return (inserted at the end, first adjusted, redrawn)', Math.max(...ts), 58000, `T-states, worst of three (one frame: typing must keep up with auto-repeat); runs ${ts.join(', ')}; ${draws} W_DRAWVIEW(s); ${ok ? 'the text is 31 codes, caret 31' : 'STATE NOT AS EXPECTED'}`);
    if (!ok) { missed++; console.log('FAIL | the typed code did not land'); }
    T.clearTree(env, tree);
  }
}
// ---- E_MOVE, no capture, over a window holding one of each control including a List and a Field (<= 3,900) ------------------------------------------------------------------------
{
  const STUBEV = 0x5E40;
  const wr = (b) => b.forEach((v, i) => { m.ram[STUBEV + i] = v; });
  wr([0xCD, S.K_GETEV & 255, S.K_GETEV >> 8, 0xD8, 0xCD, S.K_DISPATCH & 255, S.K_DISPATCH >> 8, 0xC9]);
  const mk = (kind, id) => {
    switch (kind) {
      case 'Label': return { kind, id, x: 40, y: 30, w: 80, h: 12, flags: 0, codes: T.codesOf('Label') };
      case 'Check': return { kind, id, x: 40, y: 50, w: 72, h: 9, flags: 1, codes: T.codesOf('Sound') };
      case 'Field': return { kind, id, x: 40, y: 70, w: 160, h: 12, flags: 1, buf: T.codesOf('abc'), cap: 40, caret: 3, first: 0 };
      case 'List': return { kind, id, x: 40, y: 90, w: 128, h: 60, flags: 1, items: X.STD_ITEMS.map((c) => c.slice()), count: 24, sel: FF0, top: 0, bar: null };
      default: return { kind: 'VScroll', id, x: 300, y: 30, w: 12, h: 80, value: 10, max: 20, page: 5, target: 0 };
    }
  };
  const FF0 = 0xFF;
  const kinds = ['Label', 'Check', 'Field', 'List', 'VScroll'], clsOf = { Label: S.CL_Label, Check: S.CL_Check, Field: S.CL_Field, List: S.CL_List, VScroll: S.CL_VScroll };
  let worst = 0, worstWhere = '';
  const per = [];
  for (let last = 0; last < kinds.length; last++) {
    const order = kinds.filter((_, i) => i !== last).concat([kinds[last]]);
    const nodes = order.map((k, i) => mk(k, 150 + i));
    const tree = new M2.TkTree2(WIN, nodes);
    T.buildTree(env, tree);
    const tgt = nodes[nodes.length - 1], stopPc = methodOf(clsOf[tgt.kind], S.M_EVENT);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
    for (const how of ['ring', 'posted']) {
      T.drainEvents(env); T.poke16(env, S.K_CAPTURE, 0);
      const rec = T.ptRec(M.E.MOVE, tgt.x + 3, tgt.y + 3, 0);
      if (how === 'ring') T.ringPut(env, rec); else T.runCall(env, S.K_POST, { a: rec[0], c: rec[1], e: rec[2], d: rec[3] }, { ints: false });
      const r = T.runCall(env, STUBEV, {}, { stopPc, ints: false });
      T.drainEvents(env);
      per.push(`${tgt.kind} last (${how}) ${r.t}${r.stopped ? '' : ' NOT STOPPED'}`);
      if (!r.stopped) { missed++; console.log(`FAIL | E_MOVE over the ${tgt.kind} did not reach its M_EVENT ${hex(stopPc)}`); }
      if (r.t > worst) { worst = r.t; worstWhere = `${tgt.kind} last in the list (${how})`; }
    }
    T.clearTree(env, tree);
  }
  row('E_MOVE, no capture: K_GETEV + K_DISPATCH to the hit control\'s M_EVENT, a window with a Label, a Check, a Field, a List and a VScroll (worst of the five orders)', worst, 3900, `worst: ${worstWhere}; all: ${per.join('; ')}`);
}
// ---- the stack: List's and Field's M_EVENT and M_DRAW (<= 64 bytes each) -------------------------------------------------------------------------------------------------------------
{
  const sendOf = (addr, msg, de) => T.runCall(env, S.T_SEND, { ix: addr, a: msg, de }, { ints: false });
  const worstOf = {};
  const upd = (k, r) => { const v = r.stack - 2; if (!worstOf[k] || v > worstOf[k].v) worstOf[k] = { v, t: r.t }; };   // T_SEND's own RST return is not the callee's
  const ev = (rec) => { T.setEv(env, rec); return S.K_EV; };
  for (const cell of [false, true]) {
    const tree = listTree(cell, true, 3, 0), list = tree.nodes()[0], bar = list.bar;
    T.buildTree(env, tree);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: list.addr }, { ints: false });
    const geo = M2.listGeom(list), pt = (k) => [list.x + 20, geo.LY0 + geo.P * k + 2];
    const tag = cell ? 'List (cell lines)' : 'List';
    for (const [name, rec, pre] of [
      ['M_EVENT DOWN (within the lines)', [M.E.KEY, 10, 0, 0]], ['M_EVENT UP', [M.E.KEY, 11, 0, 0]], ['M_EVENT ENTER (E_CMD posted)', [M.E.KEY, 13, 0, 0]], ['M_EVENT other key', [M.E.KEY, 97, 0, 0]],
      ['M_EVENT E_DOWN on a line', T.ptRec(M.E.DOWN, ...pt(5), 1)], ['M_EVENT E_DOWN, second click (E_CMD posted)', T.ptRec(M.E.DOWN, ...pt(5), 1)], ['M_EVENT E_UP', T.ptRec(M.E.UP, ...pt(5), 0)], ['M_EVENT E_MOVE', T.ptRec(M.E.MOVE, ...pt(5), 1)],
      ['M_EVENT E_SCROLL (full draw)', [M.E.SCROLL, 5, 152, 0]],
    ]) { T.drainEvents(env); upd(`${tag} ${name}`, sendOf(list.addr, S.M_EVENT, ev(rec))); }
    // DOWN past the bottom: full draw and the bar set
    T.poke8(env, list.addr + S.List_sel, 15); T.poke8(env, list.addr + S.List_top, 0); T.drainEvents(env);
    upd(`${tag} M_EVENT DOWN past the bottom (full draw, TK_SETBAR)`, sendOf(list.addr, S.M_EVENT, ev([M.E.KEY, 10, 0, 0])));
    upd(`${tag} M_DRAW`, sendOf(list.addr, S.M_DRAW, 0));
    upd(`${tag} M_FOCUS`, sendOf(list.addr, S.M_FOCUS, 0)); upd(`${tag} M_BLUR`, sendOf(list.addr, S.M_BLUR, 0));
    { const src = S.CL_List; const items = T.itemsArray(env, X.STD_ITEMS); const r = T.runCall(env, S.TK_SETITEMS, { ix: list.addr, hl: items, a: 24 }, { ints: false }); upd(`${tag} TK_SETITEMS (a routine, not a method)`, { stack: r.stack + 2, t: r.t }); }
    T.drainEvents(env); T.clearTree(env, tree);
  }
  {
    const f = { kind: 'Field', id: 154, x: 40, y: 40, w: 160, h: 12, flags: 1, buf: T.codesOf('abcdefghijklmnopqrstuvwxyzabcd'), cap: 40, caret: 30, first: 0 };
    M2.fieldAdjust(f);
    const tree = new M2.TkTree2(WIN, [f]); T.buildTree(env, tree);
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); T.runCall(env, S.K_SETFOCUS, { de: f.addr }, { ints: false });
    for (const [name, rec] of [['M_EVENT code (insert, first adjusted, redraw)', [M.E.KEY, 120, 0, 0]], ['M_EVENT DELETE', [M.E.KEY, 12, 0, 0]], ['M_EVENT LEFT', [M.E.KEY, 8, 0, 0]], ['M_EVENT RIGHT', [M.E.KEY, 9, 0, 0]], ['M_EVENT ENTER (E_CMD posted)', [M.E.KEY, 13, 0, 0]],
      ['M_EVENT other key', [M.E.KEY, 14, 0, 0]], ['M_EVENT E_DOWN (click-to-caret)', T.ptRec(M.E.DOWN, 100, 45, 1)], ['M_EVENT E_UP', T.ptRec(M.E.UP, 100, 45, 0)], ['M_EVENT E_MOVE', T.ptRec(M.E.MOVE, 100, 45, 1)]]) { T.drainEvents(env); upd(`Field ${name}`, sendOf(f.addr, S.M_EVENT, ev(rec))); }
    upd('Field M_DRAW', sendOf(f.addr, S.M_DRAW, 0)); upd('Field M_FOCUS', sendOf(f.addr, S.M_FOCUS, 0)); upd('Field M_BLUR', sendOf(f.addr, S.M_BLUR, 0));
    { const src = T.str(env, T.codesOf('abcdefghijklmnopqrstuvwxyzabcdefghij')); const r = T.runCall(env, S.TK_SETTEXT, { ix: f.addr, hl: src }, { ints: false }); upd('Field TK_SETTEXT (a routine, not a method)', { stack: r.stack + 2, t: r.t }); }
    T.drainEvents(env); T.clearTree(env, tree);
  }
  for (const [k, v] of Object.entries(worstOf)) row(`stack: ${k}`, v.v, /M_FOCUS|M_BLUR|TK_SETITEMS|TK_SETTEXT/.test(k) ? null : 64, `bytes below the callee's return address (T_SEND's own 2 not counted); ${fmt(v.t)} T${/TK_SETITEMS|TK_SETTEXT/.test(k) ? '; reported (a routine called direct)' : ''}`);
}

// ---- interrupts lost (V_FRAMES over every normally run frame) and DI -----------------------------------------------------------------------------------------------------------
{
  // program 2 is Key Caps since docs/KEYCAPS.md (the Controls demo, with the List, the Field and the bar, is gone; List and Field have their own groups above, a VScroll in a real program is Notepad's bar,
  // tests/wr-perf.mjs): bootDesk5 launches it by a double click on its icon.  The long handlers of the real program: radio clicks (a plane change redraws the keyboard), the shifts, keys, TAB and SPACE.
  const e2 = L.bootDesk5({ prog: 2, settle: 36 }); const m2 = e2.m, S2 = e2.S;
  e2.rng = rng;
  e2.frames_(30);
  const ok = L.progUp(e2, 2);
  for (const [x, y] of [[100, 52], [200, 52], [350, 52], [100, 52]]) L.click(e2, x, y, 3, 20);
  for (const code of [32, 14, 32, 15, 32, 113, 65, 33]) L.typeCode(e2, code, 3, 12);
  for (const ks of [[0], [36], [0, 15], [36, 10], [0, 36, 5], [0, 1]]) { L.setKeys(m2, ks); e2.frames_(14); L.setKeys(m2, []); e2.frames_(14); }
  L.moveTo(e2, 300, 100); e2.frames_(2); m2.mouse.buttons = L.MOUSE_LEFT; e2.frames_(20); m2.mouse.buttons = L.MOUSE_UP; e2.frames_(8);   // a press on the keyboard view
  L.quitByCloseBox(e2, 2); e2.frames_(10); L.launchByDoubleClick(e2, 2); e2.frames_(30);       // a quit and a launch among the frames
  e2.frames_(40);
  row('frame interrupts lost over the Key Caps machine\'s normal frames (V_FRAMES must rise by 1 a frame): idle, pointer moving, radio clicks, keys, the shifts, a quit and a launch', e2.vf.bad, 0, `${e2.vf.checked} frames checked; Key Caps launched from the shell: ${ok}${e2.vf.bad ? '; first ' + e2.vf.first : ''}; memory watch: ${e2.w.summary()}`);
  if (e2.w.n) { missed++; console.log('FAIL | the memory watch (BANKING 10.7) reported violations in the perf run'); }
}
{
  // DI: a linear sweep of TK_CODE..TK_END with a Z80 instruction-length decoder counts the DI opcodes ($F3 at an instruction start); the stepped tests of tk-t1.mjs watch for a DI executed
  const imm8 = new Set([0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x36, 0x3E, 0xC6, 0xCE, 0xD6, 0xDE, 0xE6, 0xEE, 0xF6, 0xFE, 0xD3, 0xDB, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]);
  const imm16 = new Set([0x01, 0x11, 0x21, 0x31, 0x22, 0x2A, 0x32, 0x3A, 0xC2, 0xC3, 0xC4, 0xCA, 0xCC, 0xCD, 0xD2, 0xD4, 0xDA, 0xDC, 0xE2, 0xE4, 0xEA, 0xEC, 0xF2, 0xF4, 0xFA, 0xFC]);
  const idxd = new Set([0x34, 0x35, 0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x86, 0x8E, 0x96, 0x9E, 0xA6, 0xAE, 0xB6, 0xBE]);
  const len = (a) => {
    const o = rb(a);
    if (o === 0xDD || o === 0xFD) {
      const p = rb(a + 1);
      if (p === 0xCB) return 4;
      if (p === 0xDD || p === 0xFD || p === 0xED) return 1;
      if (idxd.has(p)) return 3;
      if (p === 0x36) return 4;
      if (p === 0x21 || p === 0x22 || p === 0x2A) return 4;
      if (p === 0x26 || p === 0x2E) return 3;
      return 2;
    }
    if (o === 0xED) return [0x43, 0x4B, 0x53, 0x5B, 0x63, 0x6B, 0x73, 0x7B].includes(rb(a + 1)) ? 4 : 2;
    if (o === 0xCB) return 2;
    if (imm16.has(o)) return 3;
    if (imm8.has(o)) return 2;
    return 1;
  };
  let n = 0, ops = 0; const at = [];
  for (let a = S.TK_CODE; a < S.TK_END; a += len(a)) { ops++; if (rb(a) === 0xF3) { n++; at.push(hex(a)); } }
  row('DI opcodes in TK_CODE..TK_END (linear sweep, instruction starts; the stepped tests of tk-t1.mjs also watch IFF1 after every instruction)', n, 0, `${ops} instructions swept${n ? '; DI at ' + at.join(', ') : ''}`);
  { let n2 = 0, ops2 = 0; const at2 = []; for (let a = S.TK2_CODE; a < S.TK2_END; a += len(a)) { ops2++; if (rb(a) === 0xF3) { n2++; at2.push(hex(a)); } }
    row('DI opcodes in TK2_CODE..TK2_END (List and Field; linear sweep, instruction starts; the stepped tests of tk-t2 / tk-t3 also watch IFF1 after every instruction)', n2, 0, `${ops2} instructions swept${n2 ? '; DI at ' + at2.join(', ') : ''}`); }
}

console.log('\n| Measure | Measured | Bound | Result |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${fmt(r.measured)} | ${r.bound === null ? 'report' : '<= ' + fmt(r.bound)} | ${r.status} |`);
console.log(`tk-perf: ${rows.filter((r) => r.status === 'pass').length} passed, ${missed} missed, ${rows.filter((r) => r.status === 'reported').length} reported`);
if (missed) process.exitCode = 1;
