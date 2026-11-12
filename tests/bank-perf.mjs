"use strict";
// bank-perf.mjs -- the bounds of docs/BANKING.md 6.1 and 6.2, measured as 10.6 says (TSRun, T-states, direct calls with the sentinel return,
// interrupts off, no frame run during a measurement), printed as a table: measured, bound, pass / MISSED / reported.  Written from the contract
// (sections 5, 6, 10), never from the code; it runs the prebuilt `bank5` cartridge and never builds.
//   node tests/bank-perf.mjs [--seed N]
// A MISSED bound is reported with its numbers and sets the exit code; nothing here weakens a bound.
//
// Readings of the contract:
//  - a round trip is T(CT_xy) - 10 (the caller's RET), `$F4` = shadow = the caller's mapping, interrupts off (10.6);
//  - the send to a banked method is T(T_SEND of M_EVENT to a B_CLCTL) - 10 (T_SEND's RET) - 4 (b_event's OR A);
//  - the whole ISR is measured from the interrupt's entry at $0038 (the 13 T of the acceptance excluded, as tests/kern-perf.mjs does) to the RET
//    to the interrupted code, so it includes the ISR_BODY the contract names; entered with `$F4` and the shadow at each mapping, the pointer idle,
//    and moving with the button held and two keys going down (the worst frame of step 3); the table gives the worst frame of each;
//  - stack per crossing level: the bytes written below the caller's return address by CT_xy (the RST's return address, the pushed shadow, the
//    CALL's return address); two patterns so that a pushed byte equal to the pattern is not missed;
//  - `W_UPDATE` and `W_DRAWVIEW` banked against kernel: the same objects built from B_CLWIN / B_CLCTL and from TWin / TCtl, each alone over the desk,
//    the second built into the blocks the first one freed (so `T_LOG`, which holds IX, can be compared byte for byte).
import { checks, M } from './lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import { traceCall, armStack, stackUsed } from './kern-lib.mjs';
import { snapshot, restore, runIsr, setInput, grab, firstDiff } from './review-lib.mjs';
import { Z } from './lib.mjs';
import { bootBank5, runNormalFrames, parkIdle, setMap, argNum, hex, rd16, F4, PAIRS } from './bank-lib.mjs';

const SEED = argNum('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
console.log(`seed ${SEED} (the measurements are deterministic; the seed only picks the registers the routines ignore)`);
const C = checks('bank perf (slice B0)');
const rng = makeRng(SEED);
const B = bootBank5();
const { m, S, w } = B;
w.on = false;                                   // the memory watch is bank-b0's; here it would only slow the run
const cpu = m.cpu;
const rows = [];
const row = (name, measured, bound, unit = 'T', exact = false) => rows.push({ name, measured, bound, unit, exact });
const call = (name, regs = {}, o = {}) => traceCall(m, S, typeof name === 'number' ? name : S[name], regs, { rng, guard: 60_000_000, ...o });
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
const underK = () => setMap(m, S, 'K');

C.check('bank5 boot: the self-test record passes (state 1, 400 iterations)', B.rec.marked && B.rec.state === 1 && B.rec.iters === 400, `state ${B.rec.state}, kind ${B.rec.kind}, ${B.rec.iters} iterations`);

// ---- frames: 0 frame interrupts lost over normal frames (the self-test's and 300 more) ------------------------------------------------------
const more = runNormalFrames(m, S, 300);            // straight on from the boot's last frame: the CPU is at the ISR entry of the interrupt just taken (parking it would discard that frame)
row(`frame interrupts lost over ${B.vf.checked} frames of the self-test and ${more.checked} after it (V_FRAMES not +1)${B.vf.first || more.first ? ' first: ' + (B.vf.first || more.first) : ''}`, B.vf.bad + more.bad, 0, 'n');
parkIdle(m, S);
const ISRSNAP = snapshot(m);                    // the machine as the cartridge idles, the pointer drawn at (500, 180)

// ---- 6.1 bytes ---------------------------------------------------------------------------------------------------------------------------
row('K_FAR + its vector at $0028 (K_FAR_END - K_FAR + 3)', S.K_FAR_END - S.K_FAR + 3, 80, 'B');
row('report: the RAM image (B_IMG_LEN: two classes, five thunks, the title)', S.B_IMG_LEN, null, 'B');
row('report: thunks, 5 x 4 bytes (B_THWDRAW .. B_THBLUR, B_TITLE follows)', S.B_TITLE - S.B_THWDRAW, null, 'B');

// ---- the whole ISR, entered under each mapping, pointer idle and moving (6.2) --------------------------------------------------------------------
{
  const NONE = () => new Uint8Array(8);
  const keys = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
  const out = {};
  for (const L of ['K', 'A', 'R']) {
    restore(m, ISRSNAP);
    let worstIdle = 0, worstMove = 0, bad = '';
    const one = (rows8, joy) => {
      parkIdle(m, S); setMap(m, S, L); setInput(m, rows8, joy);
      const f0 = rd16(m, S.V_FRAMES), r = runIsr(m, S, rng);
      if (((rd16(m, S.V_FRAMES) - f0) & 0xFFFF) !== 1 || m.portF4 !== m.ram[S.V_SHADOW_F4] || m.portF4 !== F4[L] || r.changed.length || r.di) bad += ` [${L}: V_FRAMES ${rd16(m, S.V_FRAMES) - f0}, port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, changed ${r.changed}, di ${r.di}]`;
      return r.t - 13;
    };
    for (let i = 0; i < 3; i++) worstIdle = Math.max(worstIdle, one(NONE(), 0xFF));
    for (const dir of [0x7B, 0xFA, 0x7B, 0x7B, 0xFA, 0x7B, 0x7B, 0xFA, 0x7B, 0x7B, 0xFA, 0x7B]) worstMove = Math.max(worstMove, one(keys(5, 31), dir));   // left / up-left with the button held, two keys down
    for (let i = 0; i < 3; i++) worstIdle = Math.max(worstIdle, one(NONE(), 0xFF));      // and the frames that erase the last move
    out[L] = { idle: worstIdle, move: worstMove };
    C.check(`ISR entered under ${L}: V_FRAMES +1, port = shadow = ${hex(F4[L], 2)} afterwards, registers kept, no DI`, bad === '', bad);
  }
  for (const L of ['K', 'A', 'R']) {
    row(`whole ISR ($0038 to RET), entered under ${L}, pointer idle (worst of 6 frames)`, out[L].idle, 12000);
    row(`whole ISR ($0038 to RET), entered under ${L}, pointer moving + button + 2 keys (worst of 12 frames)`, out[L].move, 12000);
  }
}

// ---- direct-call setup (as wm-perf.mjs / bank-b0.mjs): the pointer erased, the screen cleared ---------------------------------------------------------------
restore(m, ISRSNAP); parkIdle(m, S); underK();
[0, 0, 512, 192].forEach((v, i) => poke16(S.GA + 2 * i, v));
call('P_SHIELD'); call('P_UNSHIELD');
m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
const SETUP = snapshot(m);

// ---- 6.2 the 9 round trips; stack per level; DI -----------------------------------------------------------------------------------------------------------------
{
  let worstDi = 0;
  for (const p of PAIRS) {
    restore(m, SETUP); setMap(m, S, p[0]);
    const r = call(`CT_${p}`, {});
    const back = m.portF4 === F4[p[0]] && m.ram[S.V_SHADOW_F4] === F4[p[0]];
    C.check(`CT_${p}: port and shadow back to ${hex(F4[p[0]], 2)} after the return, SP balanced`, back && r.sp === 0xFF00, `port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, SP ${hex(r.sp)}`);
    row(`rst $28 round trip, caller ${p[0]} -> target ${p[1]} (T(CT_${p}) - 10)`, r.t - 10, 400);
    restore(m, SETUP); setMap(m, S, p[0]);
    const ri = call(`CT_${p}`, {}, { ints: true });
    worstDi = Math.max(worstDi, ri.maxDiRun);
    let used = 0;
    for (const pat of [0x55, 0xAA, 0x5A]) { restore(m, SETUP); setMap(m, S, p[0]); armStack(m, pat); call(`CT_${p}`, {}); used = Math.max(used, stackUsed(m, pat)); }
    row(`stack per crossing level, ${p[0]} -> ${p[1]} (bytes below the caller's return address)`, used, 6, 'B', true);
  }
  row('longest run with interrupts off inside the crossing, worst of the 9 CT_ callers', worstDi, 0, 'T');
}

// ---- the send to a banked method (6.2) -------------------------------------------------------------------------------------------------------------------------
const kNewP = (cls) => { const r = call('K_NEW', { hl: cls }); if (r.regs.f & 1) throw new Error('K_NEW: arena full'); return r.regs.ix; };
{
  restore(m, SETUP); underK();
  const o = kNewP(S.B_CLCTL), SNAP = snapshot(m);
  const r = call('T_SEND', { ix: o, a: S.M_EVENT });
  row('send to a banked method that is a RET: T(T_SEND, M_EVENT, B_CLCTL) - 10 (T_SEND RET) - 4 (OR A)', r.t - 14, 520);
  C.check('the send leaves port = shadow = $33', m.portF4 === 0x33 && m.ram[S.V_SHADOW_F4] === 0x33);
  restore(m, SNAP);
}

// ---- window building (as wm-perf.mjs) --------------------------------------------------------------------------------------------------------------------------
const setRect = (a, x, y, ww, hh) => { poke16(a + S.View_x, x); poke8(a + S.View_y, y); poke16(a + S.View_w, ww); poke8(a + S.View_h, hh); };
function fresh() {
  underK();
  for (let i = 0; i < 16; i++) { const h = call('W_FRONT').regs.hl; if (!h) break; call('W_CLOSE', { ix: h }); }
  call('W_UPDATE');
}
const open = (a) => { if (call('W_OPEN', { ix: a }).regs.f & 1) throw new Error(`W_OPEN ${hex(a)} refused`); };
const logOf = () => { const n = rd16(m, S.T_LOGN); return { n, bytes: m.ram.slice(S.T_LOG, S.T_LOG + 16 * Math.min(n, 128)) }; };
const sameLog = (a, b) => a.n === b.n && Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0;

// ---- W_UPDATE and W_DRAWVIEW: banked against kernel (6.2, 10.6) ------------------------------------------------------------------------------------------------------
{
  const res = {};
  const variant = (name, winCls, ctlCls) => {
    fresh();
    const wn = kNewP(winCls), cn = kNewP(ctlCls);
    setRect(wn, 160, 56, 256, 96); poke16(wn + S.Window_title, S.T_TITLE1); poke8(wn + S.TWin_tag, 1);
    setRect(cn, 180, 80, 64, 16); poke8(cn + S.View_flags, 1); poke8(cn + S.View_id, 2); poke8(cn + S.TCtl_tag, 2);
    call('K_ADDCHILD', { ix: wn, de: cn }); open(wn);
    poke16(S.T_LOGN, 0);
    const up = call('W_UPDATE');
    const upLog = logOf(), upDisp = grab(m);
    poke16(S.T_LOGN, 0);
    const dv = call('W_DRAWVIEW', { ix: cn });
    const dvLog = logOf(), dvDisp = grab(m);
    armStack(m, 0x55); call('W_DRAWVIEW', { ix: cn }); const dvStack = stackUsed(m, 0x55);
    res[name] = { wn, cn, upT: up.t, upLog, upDisp, dvT: dv.t, dvLog, dvDisp, dvStack };
    fresh();
    call('T_SEND', { ix: wn, a: S.M_DESTROY });       // frees the window and its child: the next variant is built into the same blocks
  };
  variant('kernel', S.CL_TWin, S.CL_TCtl);
  variant('banked', S.B_CLWIN, S.B_CLCTL);
  const K = res.kernel, Bk = res.banked;
  C.check(`W_UPDATE banked and kernel: the same blocks (window ${hex(K.wn)} / ${hex(Bk.wn)}, control ${hex(K.cn)} / ${hex(Bk.cn)})`, K.wn === Bk.wn && K.cn === Bk.cn);
  const dd = firstDiff(K.upDisp, Bk.upDisp);
  C.check('W_UPDATE of the banked window and of the TWin: the displays are equal', !dd, dd || '');
  C.check(`W_UPDATE: T_LOGN and T_LOG equal (${K.upLog.n} records kernel, ${Bk.upLog.n} banked)`, sameLog(K.upLog, Bk.upLog));
  const dd2 = firstDiff(K.dvDisp, Bk.dvDisp);
  C.check('W_DRAWVIEW of a B_CLCTL and of a TCtl: the displays are equal', !dd2, dd2 || '');
  C.check(`W_DRAWVIEW: T_LOGN and T_LOG equal (${K.dvLog.n} records kernel, ${Bk.dvLog.n} banked)`, sameLog(K.dvLog, Bk.dvLog));
  row('report: W_UPDATE of a window and a control, kernel classes (TWin, TCtl)', K.upT, null);
  row('report: W_UPDATE of the same, banked classes (B_CLWIN, B_CLCTL: two up-calls and two nested down-calls)', Bk.upT, null);
  row('report: W_UPDATE banked - kernel', Bk.upT - K.upT, null);
  row('report: W_DRAWVIEW of a TCtl', K.dvT, null);
  row('report: W_DRAWVIEW of a B_CLCTL (nested: K -> up-call into A -> down-call into K -> RET)', Bk.dvT, null);
  row('report: nested, B_CLCTL - TCtl (one up-call and one nested down-call; EST about 700)', Bk.dvT - K.dvT, null);
  row('report: W_DRAWVIEW stack, TCtl', K.dvStack, null, 'B');
  row('report: W_DRAWVIEW stack, B_CLCTL (two crossing levels deeper)', Bk.dvStack, null, 'B');
  row('report: nested stack, B_CLCTL - TCtl (two levels of 6 = 12 expected)', Bk.dvStack - K.dvStack, null, 'B');
}

// ---- B_BTN against W_DRAWVIEW: a 64 x 16 Button in an open window (10.6) ---------------------------------------------------------------------------------------
{
  fresh();
  const wb = kNewP(S.CL_TWin), b = kNewP(S.CL_Button);
  setRect(wb, 160, 56, 256, 96); poke16(wb + S.Window_title, S.T_TITLE1);
  setRect(b, 180, 80, 64, 16); poke16(b + S.Button_text, S.T_SOK); poke8(b + S.View_flags, 1); poke8(b + S.View_id, 7);
  call('K_ADDCHILD', { ix: wb, de: b }); open(wb); call('W_UPDATE');
  const S0 = snapshot(m);
  underK();
  const k = call('W_DRAWVIEW', { ix: b }), dK = grab(m);
  restore(m, S0); setMap(m, S, 'A');
  const a = call('B_BTN', { ix: b }), dA = grab(m);
  const okMap = m.portF4 === 0x3F && m.ram[S.V_SHADOW_F4] === 0x3F;
  const dd = firstDiff(dA, dK);
  C.check('a 64 x 16 Button drawn by B_BTN from A and by W_DRAWVIEW from K: the screens are equal', !dd, dd || '');
  C.check('B_BTN returns with $F4 = shadow = $3F (A)', okMap);
  row('report: W_DRAWVIEW of a 64 x 16 Button from K code', k.t, null);
  row('report: B_BTN (A code: rst $28 -> W_DRAWVIEW), 64 x 16 Button', a.t, null);
  row('report: B_BTN - W_DRAWVIEW (the down-call from A, RET of B_BTN included)', a.t - k.t, null);
  restore(m, S0); fresh();
  call('T_SEND', { ix: wb, a: S.M_DESTROY });
}

// ---- E_MOVE over a banked view that overrides M_EVENT (6.2; the measure of tests/wm-perf.mjs) ---------------------------------------------------------------------
{
  const REG8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  /** A direct call, stepped: T-states to PC = stopPc (not executed) or to the return; interrupts off; a HALT is not waited for. */
  function steppedT(addr, stopPc = null) {
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
    for (const r of REG8) cpu[r] = rng.byte();
    cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8; cpu.pc = addr;
    let t = 0, steps = 0, waits = 0;
    while (cpu.pc !== S.T_RET) {
      if (stopPc !== null && cpu.pc === stopPc && steps > 0) return { t, stopped: true, waits };
      const t0 = m.tstates;
      Z.runZ80(cpu, m.bus, 1, m);
      if (cpu.halted) { waits++; cpu.halted = false; } else t += m.tstates - t0;
      if (++steps > 4_000_000) throw new Error(`steppedT ${hex(addr)}: runaway at $${cpu.pc.toString(16)}`);
    }
    return { t, stopped: false, waits };
  }
  const ringPut = (type, d1, d2, d3) => { const tail = m.ram[S.K_RTAIL], a = S.K_RING + (tail & 0x3F); m.ram[a] = type; m.ram[a + 1] = d1; m.ram[a + 2] = d2; m.ram[a + 3] = d3; m.ram[S.K_RTAIL] = (tail + 4) & 0xFF; };
  const drain = () => { m.ram[S.K_PN] = 0; m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; };
  const measure = (px, py, stop) => {
    underK(); drain(); poke16(S.K_CAPTURE, 0);
    ringPut(2, px & 255, py, (px >> 8) & 1);
    const SN = snapshot(m);
    const routing = steppedT(S.T_EVONE, stop);
    restore(m, SN);
    let full = null;
    try { full = steppedT(S.T_EVONE, null).t; } catch (e) { full = null; }
    drain(); return { routing: routing.t, full };
  };
  const res = {};
  for (const [name, lastCls, stop] of [['kernel (TCtl)', S.CL_TCtl, S.t_event], ['banked (B_CLCTL)', S.B_CLCTL, S.B_THEVENT]]) {
    fresh();
    const b1 = kNewP(S.CL_TWin), b2 = kNewP(S.CL_TWin), f = kNewP(S.CL_TWin);
    setRect(b1, 16, 8, 128, 64); setRect(b2, 16, 80, 128, 64); setRect(f, 160, 56, 256, 96);
    for (const a of [b1, b2, f]) poke16(a + S.Window_title, S.T_TITLE2);
    const kids = [];
    for (let i = 0; i < 8; i++) {
      const c = kNewP(i === 7 ? lastCls : S.CL_TCtl); setRect(c, 160 + 8 + 24 * i, 56 + 16, 24, 16); poke8(c + S.View_flags, 1); poke8(c + S.TCtl_tag, 0); poke8(c + S.View_id, i + 1);
      call('K_ADDCHILD', { ix: f, de: c }); kids.push(c);
    }
    open(b1); open(b2); open(f); call('W_UPDATE');
    call('K_SETFOCUS', { de: 0 });
    res[name] = measure(160 + 8 + 24 * 7 + 5, 56 + 16 + 5, stop);
    call('K_SETFOCUS', { de: 0 }); poke16(S.K_CAPTURE, 0);
    fresh();
    for (const a of [b1, b2, f]) call('T_SEND', { ix: a, a: S.M_DESTROY });
  }
  const K = res['kernel (TCtl)'], Bk = res['banked (B_CLCTL)'];
  row('report: E_MOVE, desk -> front window -> 8 children, the last hit, to its handler: kernel child (to t_event)', K.routing, null);
  row('report: E_MOVE, the same with the last child a banked B_CLCTL (to the thunk B_THEVENT)', Bk.routing, null);
  if (K.full !== null && Bk.full !== null) {
    row('report: the whole T_EVONE, E_MOVE, kernel child (handler included)', K.full, null);
    row('report: the whole T_EVONE, E_MOVE, banked child (thunk, crossing, b_event, return)', Bk.full, null);
    row('report: banked - kernel, the whole E_MOVE event (the cost of the up-call, less the handlers\' own difference)', Bk.full - K.full, null);
  } else console.log('note: T_EVONE did not return to the sentinel in the full-run measure; only the routing rows are given');
}

// ---- print --------------------------------------------------------------------------------------------------------------------------------------------------------
const wd = Math.max(...rows.map((r) => r.name.length));
console.log(`${'measure'.padEnd(wd)}  ${'measured'.padStart(10)}  ${'bound'.padStart(8)}  status`);
let missed = 0;
const fmt = (v, unit) => v.toLocaleString('en-US') + (unit === 'B' ? ' B' : unit === 'n' ? '' : '');
for (const r of rows) {
  const status = r.bound === null ? 'reported' : (r.exact ? r.measured === r.bound : r.measured <= r.bound) ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  console.log(`${r.name.padEnd(wd)}  ${fmt(r.measured, r.unit).padStart(10)}  ${(r.bound === null ? '-' : (r.exact ? '= ' : '') + fmt(r.bound, r.unit)).padStart(8)}  ${status}`);
}
console.log(missed ? `${missed} bound(s) MISSED` : 'no bound missed');
if (missed) process.exitCode = 1;
C.done();
void M;
