"use strict";
// bank-b0.mjs -- slice B0's headless TSRun tests (docs/BANKING.md section 7 tests 1-6 and 8's TSRun part), written from sections 2, 4-7 and the B0
// interface of section 10, never from the code.  It runs the prebuilt `bank5` cartridge (build/bank5.dck, build/bank5/out.sym) and never builds.
//   node tests/bank-b0.mjs [--seed N] [--rounds N] [--only 0,1,2,3,5] [--patch ADDR=BYTE[,...]] [--patch-early ADDR=BYTE[,...]]
//     --seed N        PRNG seed (printed; default from the clock)
//     --rounds N      random register rounds per mapping pair, tests 1 and 2 (default 120)
//     --only LIST     groups to run: 0 self-test record + frames (tests 4, 6, 8), 1-2 registers and mappings, 3 interrupt injection, 5 direct-call audit
//     --patch LIST    after the self-test and before tests 1-5, patch the cartridge image in the emulator's memory (hex ADDR=BYTE; m:ADDR=BYTE for RAM)
//     --patch-early   the same, but before the first frame (the self-test then runs with the mutation)
// Test 4 (the memory watch of 10.7) is armed from the cartridge's own first `$F4 = $33` to the end of the run and judged twice: over the self-test, and over
// everything.  Test 7 (mutations) is the main model's: plant them with --patch / --patch-early.
import { checks } from './lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import { traceCall } from './kern-lib.mjs';
import { snapshot, restore, step, runIsr, setInput, setCall, grab, firstDiff } from './review-lib.mjs';
import { bootBank5, applyPatches, parsePatches, runNormalFrames, parkIdle, setMap, ramDiff, readRecord, argVal, argNum, argv, hex, rd16, F4, PAIRS } from './bank-lib.mjs';

const SEED = argNum('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const ROUNDS = argNum('--rounds', 120);
const ONLY = argVal('--only', null) === null ? [0, 1, 2, 3, 5] : String(argVal('--only')).split(',').map(Number);
const patchLate = parsePatches(argVal('--patch', ''));
const patchEarly = parsePatches(argVal('--patch-early', ''));
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${ROUNDS} register rounds a pair; groups ${ONLY.join(',')}`);
const C = checks('bank-b0 (slice B0, TSRun)');
const rng = makeRng(SEED);
const t0 = Date.now();
const NONE0 = () => new Uint8Array(8);

/** A group of checks: n assertions, the first few failures kept; printed as one line by end(). */
const groups = [];
class Grp {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.note = ''; groups.push(this); }
  ok(cond, msg = '') { this.n++; if (!cond) { this.nf++; if (this.fails.length < 6) this.fails.push(typeof msg === 'function' ? msg() : msg); } return cond; }
  /** Run fn; an exception (a runaway or a halt in the machine) is one failed check, not the end of the run. */
  guard(ctx, fn) { try { return fn(); } catch (e) { this.ok(false, `${ctx}: ${String(e.message).split('\n')[0]}`); return undefined; } }
  end() { C.check(`${this.name}: ${this.n.toLocaleString('en-US')} checks${this.note ? ', ' + this.note : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Boot, the self-test record (10.5), the memory watch over the self-test run (test 4), V_FRAMES per frame (test 6)
const B = bootBank5({ patchEarly });
const { m, S, w } = B;
const cpu = m.cpu;
const RAMN = (n) => Array.from({ length: n }, () => rng.byte());
const w16 = (a, o) => a[o] | (a[o + 1] << 8);
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };

{
  const g = new Grp('self-test (test 8, TSRun part)');
  const r = B.rec;
  g.ok(r.marked, 'no record: the self-test did not finish in 900 frames');
  g.ok(r.state === 1, `state ${r.state} (1 = pass, 2 = fail), first failure kind ${r.kind} (1 outputs, 2 inputs, 3 shadow seen, 4 shadow after, 5 no IRQ under A, 6 none under R), pair ${r.pair} (${PAIRS[r.pair]})`);
  g.ok(r.kind === 0, `failure kind ${r.kind}`);
  g.ok(r.iters === 400, `iterations ${r.iters}, want 400`);
  g.ok(r.irqA > 0, `V_IRQA ${r.irqA}`);
  g.ok(r.irqR > 0, `V_IRQR ${r.irqR}`);
  g.ok(r.logn === 2, `T_LOGN ${r.logn}, want 2`);
  let sum = 0; for (let i = 0; i < 2048; i++) sum = (sum + m.ram[S.T_LOG + i]) & 0xFFFF;
  g.ok(sum === r.logSum, `the record's T_LOG sum ${r.logSum}, recomputed ${sum}`);
  g.note = `record: state ${r.state}, ${r.iters} iterations, V_FRAMES ${r.frames}, V_IRQA ${r.irqA}, V_IRQR ${r.irqR}, T_LOGN ${r.logn}, T_LOG sum ${r.logSum}, display sum ${r.dispSum} (not judged: the pointer is drawn after it), after ${B.frames} frames`;
  g.end();
  const g4 = new Grp('test 4 (memory watch, 10.7) over the whole self-test run');
  g4.ok(w.n === 0, () => w.summary());
  g4.note = `${w.accA.toLocaleString('en-US')} accesses to $4000-$7FFF under A (${w.codeA.toLocaleString('en-US')} legal), ${w.accR.toLocaleString('en-US')} to $C000-$DFFF under R (${w.codeR.toLocaleString('en-US')} legal${w.rstr ? `, ${w.rstr} reads by gfx6 of the chunk 6 data handed to it (R-direct, 10.7)` : ''})`;
  g4.end();
  const g6 = new Grp('test 6 (V_FRAMES +1 per normal frame)');
  g6.ok(B.vf.bad === 0, `during the self-test: ${B.vf.bad} of ${B.vf.checked} frames without exactly +1, first ${B.vf.first}`);
  g6.ok(B.vf.checked > 100, `only ${B.vf.checked} frames checked during the self-test`);
  const af = runNormalFrames(m, S, 120);
  g6.ok(af.bad === 0, `after the record: ${af.bad} of ${af.checked} frames without exactly +1, first ${af.first}`);
  g6.note = `${B.vf.checked} frames during the self-test, ${af.checked} after it`;
  g6.end();
}
if (patchLate.length) applyPatches(m, patchLate, 'after the self-test, before tests 1-5');

// the machine as the cartridge idles (K, interrupts on, the pointer drawn): every test starts from here
parkIdle(m, S);
// the pointer at the middle of the screen and drawn there (a warp is told in one frame and drawn in the next: three quiet frames)
setMap(m, S, 'K');
traceCall(m, S, S.K_WARP, { hl: 256, de: 96 }, { rng, guard: 100000 });
parkIdle(m, S);
for (let i = 0; i < 3; i++) { setInput(m, NONE0(), 0xFF); runIsr(m, S, rng); }
if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) console.log(`note: after the self-test $F4 = ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)} (K expected)`);
const IDLE = snapshot(m);
const call = (name, regs = {}, o = {}) => traceCall(m, S, typeof name === 'number' ? name : S[name], regs, { rng, guard: 60_000_000, ...o });
const underK = () => { setMap(m, S, 'K'); };
/** No window open, the screen settled (W_UPDATE): the windows are closed through W_FRONT / W_CLOSE under K. */
const fresh = () => {
  underK();
  for (let i = 0; i < 16; i++) { const h = call('W_FRONT').regs.hl; if (!h) break; call('W_CLOSE', { ix: h }); }
  call('W_UPDATE');
};
let auditViol = 0, summaryBeforeAudit = null;                                       // violations made inside test 5's runs: judged there, not again in test 4's total

// ---------------------------------------------------------------------------------------------------------------------------------------
// Tests 1 and 2: registers and mappings through the 9 callers (10.3), CR_ (register target) and CT_ (timing target, a RET)
if (ONLY.includes(1) || ONLY.includes(2)) {
  const g1 = new Grp('test 1 (registers through CR_xy, 9 pairs)');
  const g1t = new Grp('test 1 (registers through CT_xy, target a RET)');
  const g2 = new Grp('test 2 (mappings: after the return, and at the target\'s first instruction)');
  const ALT = ['a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2'];
  const diffs = [];
  for (let round = 0; round < ROUNDS; round++) for (const p of PAIRS) {
    const from = p[0], to = p[1], tag = `${p} round ${round}`;
    restore(m, IDLE);
    // ---- CR_: random inputs, random T_OUT; a full run
    g1.guard(tag, () => {
      const tout = RAMN(10); m.ram.set(tout, S.T_OUT); m.ram.fill(0xEE, S.T_IN, S.T_IN + 13);
      const regs = { a: rng.byte(), bc: rng.int(0, 65535), de: rng.int(0, 65535), hl: rng.int(0, 65535), ix: rng.int(0, 65535), iy: rng.int(0, 65535) };
      setMap(m, S, from);
      const r = traceCall(m, S, S[`CR_${p}`], regs, { rng, ints: true, guard: 200000 });
      const tin = m.ram.subarray(S.T_IN, S.T_IN + 14);
      const bad = [];
      if (w16(tin, 0) !== regs.hl) bad.push(`T_IN HL ${hex(w16(tin, 0))} want ${hex(regs.hl)}`);
      if (tin[3] !== regs.a) bad.push(`T_IN A ${hex(tin[3], 2)} want ${hex(regs.a, 2)}`);
      if (w16(tin, 4) !== regs.bc) bad.push(`T_IN BC ${hex(w16(tin, 4))} want ${hex(regs.bc)}`);
      if (w16(tin, 6) !== regs.de) bad.push(`T_IN DE ${hex(w16(tin, 6))} want ${hex(regs.de)}`);
      if (w16(tin, 8) !== regs.ix) bad.push(`T_IN IX ${hex(w16(tin, 8))} want ${hex(regs.ix)}`);
      if (w16(tin, 10) !== regs.iy) bad.push(`T_IN IY ${hex(w16(tin, 10))} want ${hex(regs.iy)}`);
      g2.ok(tin[12] === F4[to], `${tag}: the shadow the target saw ${hex(tin[12], 2)}, want ${hex(F4[to], 2)}`);
      const out = r.regs;
      if (out.hl !== w16(tout, 0)) bad.push(`out HL ${hex(out.hl)} want ${hex(w16(tout, 0))}`);
      if (out.f !== tout[2]) bad.push(`out F ${hex(out.f, 2)} want ${hex(tout[2], 2)}`);
      if (out.a !== tout[3]) bad.push(`out A ${hex(out.a, 2)} want ${hex(tout[3], 2)}`);
      if (out.bc !== w16(tout, 4)) bad.push(`out BC ${hex(out.bc)} want ${hex(w16(tout, 4))}`);
      if (out.de !== w16(tout, 6)) bad.push(`out DE ${hex(out.de)} want ${hex(w16(tout, 6))}`);
      if (out.ix !== w16(tout, 8)) bad.push(`out IX ${hex(out.ix)} want ${hex(w16(tout, 8))}`);
      if (out.iy !== regs.iy) bad.push(`IY ${hex(out.iy)} not preserved (${hex(regs.iy)})`);
      for (const k of ALT) if (out[k] !== r.regsIn[k]) bad.push(`alternate ${k} ${hex(out[k], 2)} not preserved (${hex(r.regsIn[k], 2)})`);
      g1.ok(bad.length === 0, `${tag}: ${bad.join('; ')}`);
      g1.ok(r.sp === 0xFF00, `${tag}: SP ${hex(r.sp)} after the return, want $FF00`);
      g1.ok(r.maxDiRun === 0, `${tag}: interrupts were off for ${r.maxDiRun} T`);
      g2.ok(m.portF4 === F4[from] && m.ram[S.V_SHADOW_F4] === F4[from], `${tag}: after the return port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want ${hex(F4[from], 2)}`);
    });
    // ---- CT_: the target is a RET: every input comes back, IY and the alternate set too
    g1t.guard(tag + ' (CT)', () => {
      restore(m, IDLE);
      const regs = { a: rng.byte(), bc: rng.int(0, 65535), de: rng.int(0, 65535), hl: rng.int(0, 65535), ix: rng.int(0, 65535), iy: rng.int(0, 65535) };
      setMap(m, S, from);
      const r = traceCall(m, S, S[`CT_${p}`], regs, { rng, ints: true, guard: 200000 });
      const bad = [];
      for (const k of ['a', 'bc', 'de', 'hl', 'ix', 'iy']) if (r.regs[k] !== regs[k]) bad.push(`${k} ${hex(r.regs[k])} want ${hex(regs[k])}`);
      for (const k of ALT) if (r.regs[k] !== r.regsIn[k]) bad.push(`alternate ${k}`);
      g1t.ok(bad.length === 0, `${tag}: ${bad.join('; ')}`);
      g1t.ok(r.sp === 0xFF00 && r.maxDiRun === 0, `${tag}: SP ${hex(r.sp)}, interrupts off ${r.maxDiRun} T`);
      g2.ok(m.portF4 === F4[from] && m.ram[S.V_SHADOW_F4] === F4[from], `${tag} (CT): after the return port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want ${hex(F4[from], 2)}`);
    });
    // ---- test 2: stop at the target's first instruction ($F4 and the shadow must already be the target's mapping)
    for (const [kind, sym] of [['CR', `XR_${to}`], ['CT', `XT_${to}`]]) g2.guard(`${tag} (${kind} stop)`, () => {
      restore(m, IDLE);
      m.ram.set(RAMN(10), S.T_OUT);
      setMap(m, S, from);
      const r = traceCall(m, S, S[`${kind}_${p}`], { a: rng.byte(), bc: rng.int(0, 65535), hl: rng.int(0, 65535) }, { rng, ints: true, guard: 200000, stopPc: S[sym] });
      g2.ok(r.stopped, `${tag} (${kind}): never reached ${sym}`);
      g2.ok(m.portF4 === F4[to] && m.ram[S.V_SHADOW_F4] === F4[to], `${tag} (${kind}): at ${sym} port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want ${hex(F4[to], 2)}`);
    });
  }
  void diffs;
  g1.note = `${ROUNDS} rounds x 9 pairs, T_OUT random, inputs A BC DE HL IX IY random`;
  g1.end(); g1t.end(); g2.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Test 3: a frame interrupt at every instruction boundary of the crossing paths
const J = { idle: 0xFF, u: 0xFE, d: 0xFD, l: 0xFB, r: 0xF7, rf: 0x77, lf: 0x7B, df: 0x7D, ul: 0xFA, dr: 0xF5 };
const NONE = () => new Uint8Array(8);
const keysDown = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
const SKIP_RAM = [[S.V_SHADOW_F4, S.V_SHADOW_F4], [S.V_IRQA, S.V_IRQA + 3], [0xFB00, 0xFEFF]];   // what a different mapping may legitimately change in a frame ISR

if (ONLY.includes(3)) {
  const REGS0 = () => ({ a: rng.byte(), bc: rng.int(0, 65535), de: rng.int(0, 65535), hl: rng.int(0, 65535), ix: rng.int(0, 65535), iy: rng.int(0, 65535) });
  /** Prepare one path; the caller runs `restore(m, spec.base)` before each run.  kind CT / CR / SEND / DRAW. */
  function prepPath(kind, from, to, extra = {}) {
    const spec = { kind, from, to, name: kind === 'CT' || kind === 'CR' ? `${kind}_${from}${to}` : kind };
    let regs;
    restore(m, IDLE);
    if (kind === 'CT' || kind === 'CR') {
      regs = REGS0(); spec.addr = S[spec.name];
      if (kind === 'CR') { spec.tout = RAMN(10); m.ram.set(spec.tout, S.T_OUT); m.ram.fill(0xEE, S.T_IN, S.T_IN + 13); }
    } else if (kind === 'SEND') {          // K_SEND to a banked method: the thunk path (5.3)
      underK(); const o = call('K_NEW', { hl: S.B_CLCTL }); if (o.regs.f & 1) throw new Error('K_NEW B_CLCTL: arena full');
      regs = { ix: o.regs.ix, a: S.M_EVENT, bc: rng.int(0, 65535), de: rng.int(0, 65535), hl: rng.int(0, 65535), iy: rng.int(0, 65535) }; spec.addr = S.T_SEND;
    } else {                                // DRAW: W_DRAWVIEW of a banked control in an open banked window (nested: up-call, then a down-call)
      fresh();
      const wn = call('K_NEW', { hl: S.B_CLWIN }).regs.ix, cn = call('K_NEW', { hl: S.B_CLCTL }).regs.ix;
      const rect = (a, x, y, ww, hh) => { poke16(a + S.View_x, x); poke8(a + S.View_y, y); poke16(a + S.View_w, ww); poke8(a + S.View_h, hh); };
      rect(wn, 160, 56, 256, 96); poke16(wn + S.Window_title, S.T_TITLE1); rect(cn, 180, 80, 64, 16); poke8(cn + S.View_flags, 1); poke8(cn + S.View_id, 2);
      call('K_ADDCHILD', { ix: wn, de: cn }); if (call('W_OPEN', { ix: wn }).regs.f & 1) throw new Error('W_OPEN refused');
      call('W_UPDATE');
      regs = { ix: cn, iy: rng.int(0, 65535) }; spec.addr = S.W_DRAWVIEW;
      parkIdle(m, S);
    }
    spec.regs = regs;
    setMap(m, S, from);
    setCall(m, S, spec.addr, regs, true, rng);
    spec.cpuIn = { ...cpu };
    spec.base = snapshot(m);
    return spec;
  }
  const inCross = (pc) => (pc >= S.K_FAR && pc <= S.K_FAR_END) || (pc >= 0x4000 && pc < 0x8000) || (pc >= S.B_THWDRAW && pc < S.B_TITLE) || (m.portF4 === 0x73 && pc >= 0xC000 && pc < 0xC200);

  function finalCheck(g, spec, ctx) {
    const bad = [];
    if (cpu.pc !== S.T_RET) bad.push(`ended at PC ${hex(cpu.pc)}`);
    if (cpu.sp !== 0xFF00) bad.push(`SP ${hex(cpu.sp)}`);
    const want = F4[spec.from];
    if (m.portF4 !== want || m.ram[S.V_SHADOW_F4] !== want) bad.push(`after the return port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want ${hex(want, 2)}`);
    if (spec.kind === 'CR') {
      const tout = spec.tout, tin = m.ram.subarray(S.T_IN, S.T_IN + 14), rg = spec.regs;
      if (w16(tin, 0) !== rg.hl || tin[3] !== rg.a || w16(tin, 4) !== rg.bc || w16(tin, 6) !== rg.de || w16(tin, 8) !== rg.ix || w16(tin, 10) !== rg.iy) bad.push(`T_IN ${Array.from(tin).map((x) => x.toString(16)).join(' ')} does not show the inputs`);
      if (tin[12] !== F4[spec.to]) bad.push(`the target saw shadow ${hex(tin[12], 2)}, want ${hex(F4[spec.to], 2)}`);
      const o = { hl: cpu.h << 8 | cpu.l, a: cpu.a, f: cpu.f, bc: cpu.b << 8 | cpu.c, de: cpu.d << 8 | cpu.e, ix: cpu.xh << 8 | cpu.xl };
      if (o.hl !== w16(tout, 0) || o.f !== tout[2] || o.a !== tout[3] || o.bc !== w16(tout, 4) || o.de !== w16(tout, 6) || o.ix !== w16(tout, 8)) bad.push(`outputs HL ${hex(o.hl)} AF ${hex(o.a << 8 | o.f)} BC ${hex(o.bc)} DE ${hex(o.de)} IX ${hex(o.ix)} are not T_OUT`);
    } else if (spec.kind === 'CT') {
      const rg = spec.regs, o = { a: cpu.a, bc: cpu.b << 8 | cpu.c, de: cpu.d << 8 | cpu.e, hl: cpu.h << 8 | cpu.l, ix: cpu.xh << 8 | cpu.xl };
      for (const k of ['a', 'bc', 'de', 'hl', 'ix']) if (o[k] !== rg[k]) bad.push(`${k} ${hex(o[k])} want ${hex(rg[k])}`);
    }
    if ((cpu.yh << 8 | cpu.yl) !== spec.regs.iy) bad.push(`IY ${hex(cpu.yh << 8 | cpu.yl)} not preserved`);
    for (const k of ['a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2']) if (cpu[k] !== spec.cpuIn[k]) bad.push(`alternate ${k} changed`);
    g.ok(bad.length === 0, `${ctx}: ${bad.join('; ')}`);
  }

  /** The interrupt(s) now, with this input (inp.n of them in a row: the pointer is told in one frame and drawn in the next); each checks 3's rules
   * and is compared with the same ISR run under K from the same snapshot. */
  function inject(g, spec, ctx, inp) {
    if (!cpu.iff1 || cpu.eiDelay) { g.ok(false, `${ctx}: interrupts cannot be accepted here (iff1 ${cpu.iff1}, eiDelay ${cpu.eiDelay})`); return; }
    for (let k = 0; k < inp.n; k++) {
      const cx = `${ctx}${inp.n > 1 ? ` ISR ${k + 1}` : ''}`;
      setInput(m, inp.rows, inp.joy);
      const pre = snapshot(m), v0 = rd16(m, S.V_FRAMES), dispPre = grab(m);
      const f4pre = m.portF4, shpre = m.ram[S.V_SHADOW_F4];
      const r = runIsr(m, S, rng);
      g.ok(r.changed.length === 0, `${cx}: the ISR changed ${r.changed.join(', ')}`);
      g.ok(!r.di, `${cx}: DI executed in the ISR`);
      g.ok(r.iffOk, `${cx}: interrupts off after the ISR`);
      g.ok(((rd16(m, S.V_FRAMES) - v0) & 0xFFFF) === 1, `${cx}: V_FRAMES did not rise by 1`);
      g.ok(m.portF4 === m.ram[S.V_SHADOW_F4], `${cx}: after the ISR port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)} (before it ${hex(f4pre, 2)} / ${hex(shpre, 2)})`);
      g.ok(m.portF4 === F4[spec.from] || m.portF4 === F4[spec.to] || spec.kind === 'DRAW' || spec.kind === 'SEND', `${cx}: after the ISR the mapping is ${hex(m.portF4, 2)}, neither the caller's nor the target's`);
      const dispReal = grab(m), ramReal = m.ram.slice(), real = snapshot(m);
      restore(m, pre); m.portF4 = 0x33; m.ram[S.V_SHADOW_F4] = 0x33;
      runIsr(m, S, rng);
      const dispK = grab(m), ramK = m.ram.slice();
      restore(m, real);
      const dd = firstDiff(dispReal, dispK);
      g.ok(!dd, `${cx}: display after the ISR differs from the same ISR under K: ${dd}`);
      const rd = ramDiff(ramReal, ramK, SKIP_RAM);
      g.ok(!rd, `${cx}: RAM after the ISR differs from the same ISR under K: ${rd}`);
      cover.isrs++; if (firstDiff(dispPre, dispReal)) cover.drew++;
    }
  }
  const cover = { isrs: 0, drew: 0 };                    // injected ISRs, and those that changed the display (the pointer erased and drawn)
  const VARIANTS = () => [
    { name: 'pointer idle', rows: NONE(), joy: J.idle, n: 1 },
    { name: 'pointer moving', rows: rng.chance(0.3) ? keysDown(rng.int(1, 35)) : NONE(), joy: rng.pick([J.r, J.rf, J.l, J.d, J.ul, J.dr, J.lf, J.df, J.u]), n: 2 },
  ];

  /** Sweep: a frame interrupt at each boundary n (before the n-th instruction; the last is at the return) passing `filter(n, pc)`. */
  function sweep(g, spec, filter, label) {
    restore(m, spec.base);
    const list = [];
    try {
      for (let n = 0; ; n++) {
        if (filter(n, cpu.pc)) list.push(n);
        if (cpu.pc === S.T_RET) break;
        step(m);
        if (n > 20000) throw new Error(`the un-interrupted call did not return (PC ${hex(cpu.pc)})`);
      }
    } catch (e) { g.ok(false, `${label}: ${e.message}`); return 0; }
    for (const n of list) for (const v of VARIANTS()) g.guard(`${label} boundary ${n} ${v.name}`, () => {
      restore(m, spec.base);
      const ctx = `${label} boundary ${n}/${list[list.length - 1]} (PC ${hex(cpu.pc)}) ${v.name}`;
      for (let k = 0; k < n; k++) step(m);
      const here = hex(cpu.pc);
      inject(g, spec, `${label} boundary ${n} (PC ${here}) ${v.name}`, v);
      void ctx;
      for (let k = 0; cpu.pc !== S.T_RET; k++) { step(m); if (k > 400000) throw new Error(`${label}: did not return after the ISR`); }
      finalCheck(g, spec, `${label} boundary ${n} (PC ${here}) ${v.name}: the call after the ISR`);
    });
    return list.length;
  }

  const g3 = new Grp('test 3 (interrupt at every instruction boundary of CT_xy and CR_xy, 9 pairs each)');
  let nb = 0, nruns = 0;
  for (const kind of ['CT', 'CR']) for (const p of PAIRS) {
    const spec = g3.guard(`${kind}_${p} setup`, () => prepPath(kind, p[0], p[1]));
    if (!spec) continue;
    const before = g3.n;
    nb += sweep(g3, spec, () => true, `${kind}_${p}`); nruns += (g3.n - before);
  }
  g3.note = `${nb} boundaries x 2 inputs (pointer idle: 1 ISR; moving: 2 ISRs, the pointer told, then erased and drawn), ${g3.n.toLocaleString('en-US')} assertions`;
  g3.end();

  const g3b = new Grp('test 3 (the thunk path: K_SEND of M_EVENT to a B_CLCTL, every boundary)');
  { const spec = g3b.guard('setup', () => prepPath('SEND', 'K', 'A')); if (spec) { const nbs = sweep(g3b, spec, () => true, 'T_SEND thunk'); g3b.note = `${nbs} boundaries x 2 inputs`; } }
  g3b.end();

  const g3c = new Grp('test 3 (nested: W_DRAWVIEW of a banked control, boundaries inside K_FAR, the thunks and the banked methods)');
  { const spec = g3c.guard('setup', () => prepPath('DRAW', 'K', 'A')); if (spec) { const nbs = sweep(g3c, spec, (n, pc) => inCross(pc), 'W_DRAWVIEW nested'); g3c.note = `${nbs} boundaries x 2 inputs`; } }
  g3c.end();
  console.log(`  test 3 coverage: ${cover.isrs} injected ISRs, ${cover.drew} of them changed the display (the pointer erased / drawn)`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Test 5: the direct-call audit (5.4, 10.8)
if (ONLY.includes(5)) {
  summaryBeforeAudit = w.summary();
  const STR = 0xE800;                                   // hot RAM, outside the kernel's variables: strings for G_TEXT8 / G_TEXTP
  const setGA = (...v) => v.forEach((x, i) => poke16(S.GA + 2 * i, x));
  const randomDisplay = () => { for (let i = 0; i < 0x1800; i++) { m.ram[0x4000 + i] = rng.byte(); m.ram[0x6000 + i] = rng.byte(); } };
  const clipAll = () => { [0, 512, 0, 192].forEach((x, i) => poke16(S.GCLIP + 2 * i, x)); };
  const putStr = (s) => { for (let i = 0; i < s.length; i++) m.ram[STR + i] = s.charCodeAt(i); };
  const ringPut = (type, d1, d2, d3) => { const tail = m.ram[S.K_RTAIL], a = S.K_RING + (tail & 0x3F); m.ram[a] = type; m.ram[a + 1] = d1; m.ram[a + 2] = d2; m.ram[a + 3] = d3; m.ram[S.K_RTAIL] = (tail + 4) & 0xFF; };
  const cases = [];
  const A = (name, addr, prep) => cases.push({ name, to: 'A', addr, prep });
  const R = (name, addr, prep) => cases.push({ name, to: 'R', addr, prep });
  // under A (10.8)
  A('K_NEW (CL_TWin)', 'K_NEW', () => ({ hl: S.CL_TWin }));
  A('K_NEW (B_CLCTL, a class in the RAM image)', 'K_NEW', () => ({ hl: S.B_CLCTL }));
  A('K_ALLOC (20 bytes)', 'K_ALLOC', () => ({ bc: 20 }));
  A('K_FREE', 'K_FREE', () => ({ ix: call('K_NEW', { hl: S.CL_TCtl }).regs.ix }));
  A('K_POST', 'K_POST', () => ({ a: 16, c: 1, e: 2, d: 3 }));
  A('K_ARENA (kernel arena)', 'K_ARENA', () => ({ hl: S.K_KARENA }));
  A('K_ARENA (app arena)', 'K_ARENA', () => ({ hl: S.K_AARENA }));
  A('K_GETEV (posted queue non-empty)', 'K_GETEV', () => { call('K_POST', { a: 17, c: 0x21, e: 0x22, d: 0x23 }); call('K_POST', { a: 18, c: 0x31, e: 0x32, d: 0x33 }); return {}; });
  A('K_GETEV (ring non-empty)', 'K_GETEV', () => { ringPut(2, 100, 50, 0); ringPut(4, 100, 50, 0); return {}; });
  A('K_GETEV (W_DIRTY non-empty)', 'K_GETEV', () => { fresh(); setGA(130, 50, 40, 10); call('W_INVAL'); if (!m.ram[S.W_DIRTY]) throw new Error('W_INVAL did not set W_DIRTY'); return {}; });
  A('K_GETEV (everything non-empty)', 'K_GETEV', () => { call('K_POST', { a: 19, c: 1, e: 2, d: 3 }); ringPut(2, 100, 50, 0); setGA(130, 50, 40, 10); call('W_INVAL'); return {}; });
  A('K_GETEV (nothing pending)', 'K_GETEV', () => { m.ram[S.K_PN] = 0; m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; fresh(); m.ram[S.K_PN] = 0; m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; return {}; });
  // under R (10.8): string arguments in hot RAM
  R('G_SETCLIP', 'G_SETCLIP', () => { setGA(10, 10, 100, 50); return {}; });
  R('G_SETOP (XOR)', 'G_SETOP', () => ({ a: 2 }));
  for (const op of [0, 2]) R(`G_FILL (op ${op}, 70 x 25 at an odd x)`, 'G_FILL', () => { clipAll(); poke8(S.GOP, op); setGA(33, 20, 70, 25); return {}; });
  R('G_FRAME (op XOR)', 'G_FRAME', () => { clipAll(); poke8(S.GOP, 2); setGA(17, 30, 90, 40); return {}; });
  R('G_HLINE', 'G_HLINE', () => { clipAll(); poke8(S.GOP, 0); return { hl: 21, de: 77, bc: 200 }; });
  R('G_VLINE', 'G_VLINE', () => { clipAll(); poke8(S.GOP, 0); return { hl: 301, de: 10, bc: 150 }; });
  R('G_TEXT8 (op SET)', 'G_TEXT8', () => { clipAll(); poke8(S.GOP, 0); putStr('Banked text 1234'); setGA(5, 7, STR, 16); return {}; });
  R('G_TEXTP (op SET)', 'G_TEXTP', () => { clipAll(); poke8(S.GOP, 0); putStr('Proportional text, drawn under R.'); setGA(37, 90, STR, 33); return {}; });
  R('G_TEXTP (op XOR, a line break)', 'G_TEXTP', () => { clipAll(); poke8(S.GOP, 2); poke8(S.GLH, 10); putStr('Two\rlines'); setGA(200, 120, STR, 9); return {}; });
  R('P_SHIELD (erases the pointer)', 'P_SHIELD', () => { const px = rd16(m, S.PT_DX), py = m.ram[S.PT_DY]; if (!m.ram[S.PT_DRAWN]) throw new Error('the pointer is not drawn'); setGA(Math.max(0, px - 4), Math.max(0, py - 4), 24, 24); return {}; });
  R('P_SHIELD (the pointer is not under it)', 'P_SHIELD', () => { setGA(0, 150, 100, 30); return {}; });
  R('P_UNSHIELD', 'P_UNSHIELD', () => { setGA(0, 150, 100, 30); call('P_SHIELD'); return {}; });
  // controls: the audit must be able to fail (a routine that does touch the hidden range, under the wrong mapping)
  cases.push({ name: 'CONTROL G_FILL under A (writes the display, hidden under A): the audit must report it', to: 'A', addr: 'G_FILL', control: true, prep: () => { clipAll(); poke8(S.GOP, 2); setGA(33, 20, 70, 25); return {}; } });
  cases.push({ name: 'CONTROL K_NEW under R (the app arena is hidden under R): the audit must report it', to: 'R', addr: 'K_NEW', control: true, prep: () => ({ hl: S.CL_TWin }) });
  const ga = new Grp('test 5 (direct-call audit, 10.8): every routine under its mapping against the same call under K');
  const findings = [];
  const REGS8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  let idx = 0;
  for (const cs of cases) ga.guard(cs.name, () => {
    idx++;
    restore(m, IDLE); underK(); parkIdle(m, S);
    randomDisplay();
    const regs = cs.prep() || {};
    const snap0 = snapshot(m);
    const seed = (SEED * 31 + idx) >>> 0;
    const rK = traceCall(m, S, S[cs.addr], regs, { rng: makeRng(seed), ints: false, guard: 60_000_000 });
    const ramK = m.ram.slice(), dispK = grab(m), f4K = m.portF4;
    restore(m, snap0); setMap(m, S, cs.to);
    const n0 = w.n, k0 = Object.assign({}, w.kinds), f0 = w.first.length;
    const rX = traceCall(m, S, S[cs.addr], regs, { rng: makeRng(seed), ints: false, guard: 60_000_000 });
    const nviol = w.n - n0; auditViol += nviol;
    const vsum = `${nviol} violation(s): ${Object.entries(w.kinds).map(([k, v]) => [k, v - (k0[k] || 0)]).filter(([, v]) => v).map(([k, v]) => `${v} x ${k}`).join('; ')}; first: ${w.first.slice(f0, f0 + 3).join(' | ')}`;
    const ramX = m.ram.slice(), dispX = grab(m);
    const bad = [];
    if (nviol) bad.push(`watch: ${vsum}`);
    const rd = ramDiff(ramX, ramK, [[S.V_SHADOW_F4, S.V_SHADOW_F4], [0xFB00, 0xFEFF]]); if (rd) bad.push(`RAM differs from the call under K: ${rd}`);
    const dd = firstDiff(dispX, dispK); if (dd) bad.push(`display differs from the call under K: ${dd}`);
    const rg = REGS8.filter((k) => rX.regs[k] !== rK.regs[k]).map((k) => `${k} ${hex(rX.regs[k], 2)} against ${hex(rK.regs[k], 2)} under K`);
    if (rg.length) bad.push(`registers differ: ${rg.join(', ')}`);
    if (m.portF4 !== F4[cs.to] || m.ram[S.V_SHADOW_F4] !== F4[cs.to]) bad.push(`port ${hex(m.portF4, 2)} / shadow ${hex(m.ram[S.V_SHADOW_F4], 2)} changed from ${hex(F4[cs.to], 2)}`);
    if (rX.t !== rK.t) bad.push(`T-states ${rX.t} against ${rK.t} under K`);
    void f4K;
    const ok = bad.length === 0;
    if (cs.control) {
      console.log(`  audit control ${ok ? 'NOT DETECTED' : 'detected'} under ${cs.to}: ${cs.name}${ok ? '' : ': ' + bad.join(' | ').slice(0, 260)}`);
      ga.ok(!ok, `${cs.name}: the audit did not notice`);
      return;
    }
    console.log(`  audit ${ok ? 'pass' : 'FAIL'} under ${cs.to}: ${cs.name}${ok ? ` (${rX.t} T)` : ': ' + bad.join(' | ')}`);
    if (!ok) findings.push(`${cs.name} under ${cs.to}: ${bad.join(' | ')}`);
    ga.ok(ok, `${cs.name} under ${cs.to}: ${bad.join(' | ')}`);
  });
  const real = cases.filter((c) => !c.control), passA = real.filter((c) => c.to === 'A').length, passR = real.length - passA;
  ga.note = `${real.length} cases + 2 controls (${passA} under A, ${passR} under R), ${findings.length} finding(s)`;
  ga.end();
  m.ram.set(IDLE.ram);   // leave nothing behind
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Test 4 over everything above
{
  const g = new Grp('test 4 (memory watch, 10.7) over the whole run (self-test, tests 1-3, 5, the frames)');
  g.ok(w.n - auditViol === 0, () => summaryBeforeAudit ?? w.summary());
  g.note = `${w.accA.toLocaleString('en-US')} accesses to $4000-$7FFF under A (${w.codeA.toLocaleString('en-US')} legal), ${w.accR.toLocaleString('en-US')} to $C000-$DFFF under R (${w.codeR.toLocaleString('en-US')} legal${w.rstr ? `, ${w.rstr} reads by gfx6 of the chunk 6 data handed to it (R-direct, 10.7)` : ''}); ${auditViol} violation(s) inside test 5's runs are judged there`;
  g.end();
}
void readRecord; void argv;
console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
C.done();
