"use strict";
// tk-perf.mjs -- toolkit T1's bounds, docs/TOOLKIT.md sections 7 and 9.5, as a table, on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt).
// Written from the contract only (never from src/kernel/tk.asm or src/apps/demo.asm).  T-states are TSRun's (no memory contention); direct calls under mapping K with a sentinel
// return, interrupts off unless a row says otherwise (a HALT is answered by the harness, tests/tk-lib.mjs runCall).
//   node tests/tk-perf.mjs [--seed N]
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';

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
  // bounded = section 7's rows ("a Check with a 40-pixel text", "a VScroll 12 x 146": none over 1.5 x Button's figure per 1,000 pixels); the others are reported (9.5, or an extra)
  const report = (what, n, focus, bounded = false) => {
    T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false }); if (focus) T.runCall(env, S.K_SETFOCUS, { de: n.addr }, { ints: false });
    const ts = meas(n.addr), t = ts[0], k = perK(t, n.w, n.h), ratio = k / BUTTON_PER_K;
    // the look must still be right (the measurement is of the contract's drawing)
    const g = new M.Gfx6Model(); g.setClip(n.x, n.y, n.w, n.h);
    if (n.kind === 'Check') M.checkLook(g, n, !!focus); else M.vsLook(g, n, 0);
    const d = T.diffRect(env, g, n.x, n.y, n.w, n.h);
    const bound = bounded ? Math.floor(1.5 * BUTTON_PER_K * (n.w * n.h) / 1000) : null;
    row(`W_DRAWVIEW of ${what} (${n.w} x ${n.h} = ${n.w * n.h} pixels): ${fmt(k)} T per 1,000 pixels = ${ratio.toFixed(2)} x Button's ${fmt(Math.round(BUTTON_PER_K))}`, t, bound,
      `T-states${bounded ? `; bound = 1.5 x Button's figure x area = ${fmt(bound)}` : '; reported'}; repeated ${ts.join(', ')}; screen ${d === null ? 'equals the model' : 'DIFFERS: ' + d}`);
    if (d !== null) { missed++; console.log(`FAIL | the drawing measured differs from the model: ${what}`); }
  };
  report('a Check "Sound", checked and focused (9.5)', nodes[0], true);
  report('a Check "Sound", checked, not focused', nodes[0], false);
  report(`a Check with a 40-pixel text "${String.fromCharCode(...c40)}", focused (section 7)`, nodes[1], true, true);
  report('a VScroll, the demo\'s bar: max 20, page 5, value 10 (9.5)', nodes[2], false);
  report('a VScroll 12 x 146, max 20, page 5, value 10 (section 7)', nodes[3], false, true);
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

// ---- interrupts lost (V_FRAMES over every normally run frame) and DI -----------------------------------------------------------------------------------------------------------
{
  const e2 = L.bootDesk5(); const m2 = e2.m, S2 = e2.S;
  e2.rng = rng;
  e2.frames_(30);
  // open the demo, click its controls, hold the bar: the long handlers of the real program
  L.moveTo(e2, 20, 4); m2.mouse.buttons = L.MOUSE_LEFT; e2.frames_(3); L.moveTo(e2, 30, 35); e2.frames_(2); m2.mouse.buttons = L.MOUSE_UP; e2.frames_(12);
  const ok = rd16(m2, S2.D_WIN) !== 0;
  for (const [x, y] of [[380, 36], [380, 48], [380, 64], [380, 76], [380, 88], [380, 36]]) L.click(e2, x, y, 3, 5);
  for (const code of [32, 14, 32, 15, 32]) L.typeCode(e2, code, 3, 3);
  L.moveTo(e2, 481, 36); e2.frames_(2); m2.mouse.buttons = L.MOUSE_LEFT; e2.frames_(60); m2.mouse.buttons = L.MOUSE_UP; e2.frames_(8);
  L.moveTo(e2, 481, 108); e2.frames_(2); m2.mouse.buttons = L.MOUSE_LEFT; e2.frames_(40); m2.mouse.buttons = L.MOUSE_UP; e2.frames_(8);
  L.moveTo(e2, 481, 60); e2.frames_(2); m2.mouse.buttons = L.MOUSE_LEFT; e2.frames_(2); L.moveTo(e2, 481, 90); L.moveTo(e2, 481, 40); m2.mouse.buttons = L.MOUSE_UP; e2.frames_(8);
  e2.frames_(40);
  row('frame interrupts lost over the demo machine\'s normal frames (V_FRAMES must rise by 1 a frame): idle, pointer moving, Check clicks, keys, a held arrow, a track hold, a thumb drag', e2.vf.bad, 0, `${e2.vf.checked} frames checked; demo opened: ${ok}${e2.vf.bad ? '; first ' + e2.vf.first : ''}; memory watch: ${e2.w.summary()}`);
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
}

console.log('\n| Measure | Measured | Bound | Result |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${fmt(r.measured)} | ${r.bound === null ? 'report' : '<= ' + fmt(r.bound)} | ${r.status} |`);
console.log(`tk-perf: ${rows.filter((r) => r.status === 'pass').length} passed, ${missed} missed, ${rows.filter((r) => r.status === 'reported').length} reported`);
if (missed) process.exitCode = 1;
