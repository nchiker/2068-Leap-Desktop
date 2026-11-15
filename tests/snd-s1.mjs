"use strict";
// snd-s1.mjs -- the sound engine (docs/SOUND.md 1-6; section 6 "As built" is the reference) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// A model of the AY writes (tests/snd-lib.mjs AyModel: register, value, frame) against the machine, frame by frame.  The machine's AY is observed by wrapping m.bus.ioWrite from the first
// instruction of the boot (ports $F5 register select, $F6 data; the register a data byte goes to is the chip's latch at that moment).
//   node tests/snd-s1.mjs [--verbose] [--only LIST]
//     groups: 0 boot (K_SOUND = 1, only the boot's own silencing), 1 idle (no data write in 200 frames), 2 every sound by a direct K_BEEP: the writes in order, the register shadow, the registers and
//             K_SNDN frame by frame, the end after exactly `frames` frames, the chains, 3 a sound replaced by another, 4 interrupt injection at every instruction boundary of K_BEEP and K_SNDSET,
//             5 events in the shell (menu choice, About, the key / mouse press of a Button), 6 Calculator, 7 Notepad (the alerts, the discard question, the name dialog), 8 Paint's messages,
//             9 the Leap menu's Sound item (the open dropdown, the toggle, no write when off), 10 T, stack, no DI, registers kept, V_FRAMES
// The last line is "snd-s1: N of M groups pass"; exit code 1 on any failure.
//
// Readings of the contract (SOUND 6):
//   R1. A "frame" is the number of the frame being run (frames completed + 1; between frames the number completed).  The tick runs in the ISR at the start of the frame, main code after it.
//       A sound of n frames started in frame F ends (r8 = 0, or its chain's next row starts) in frame F + n.
//   R2. "No AY write while idle": the data port is not written; the register-select port is, twice a frame, by code that was there before the sound engine (K_POLL selects register 14 for the
//       joystick, the ISR then puts K_AYREG back).  The idle check holds the data writes to zero and the selects to those two.
//   R3. A press of a Button by key (ENTER / SPACE on the focused button, ENTER / ESC / BREAK on a dialog's default / cancel button) is `b_click`; the contract (SOUND 6: "by mouse or key") also names the mouse.
import * as S from './snd-lib.mjs';
import * as X from './tk-lib2.mjs';
import * as W from './wr-lib.mjs';
import * as Q from './pt-lib.mjs';
import { M, Z } from './lib.mjs';
import { snapshot, restore, runIsr } from './review-lib.mjs';
import * as SM from './shell-model.mjs';
import { layoutOf } from './wm-model3.mjs';
import { openLook as drawOpen } from './look-model.mjs';

const { H, L, TAB, AyModel, explain, hex } = S;
const { argv } = L;
const VERBOSE = argv.includes('--verbose');
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['0', '1', '2', '3', '4', '5', '5m', '6', '7', '8', '9', '10'];
const has = (g) => ONLY.includes(g);
const { Sec, finish } = X.makeGroups('snd-s1', VERBOSE);
const K_AYREG = 0xF085, K_SOUND = 0xE084, K_SNDN = 0xE085, K_SNDX = 0xE086;
const fmtLog = (log, n = 24) => log.dat.slice(0, n).map((e) => `f${e.f} r${e.reg}=${e.v}`).join(' ') + (log.dat.length > n ? ` ... (${log.dat.length} writes)` : '');
const regsOf = (m) => ({ 0: m.ay.regs[0], 1: m.ay.regs[1], 7: m.ay.regs[7], 8: m.ay.regs[8] });
const fmtRegs = (r) => `r0 ${r[0]} r1 ${r[1]} r7 ${r[7]} r8 ${r[8]}`;
const notes = { vfBad: 0, vfChecked: 0, envs: 0 };
const countVf = (env) => { notes.vfBad += env.vf.bad; notes.vfChecked += env.vf.checked; notes.envs++; };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Direct calls with a trace: T-states, the stack's deepest point, DI, the registers.
const KEEP = ['b', 'c', 'd', 'e', 'h', 'l', 'xh', 'xl', 'yh', 'yl', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2'];
const F4OF = { K: 0x33, A: 0x3F, R: 0x73 };
/** Call `addr` with `regs` under mapping `map`, interrupts off, the sentinel return; { t, depth (bytes below $FF00, the return address included), di, kept (names of registers that changed) }. */
function trace(env, addr, regs = {}, map = 'K', rng = null) {
  const { m, S: Sy } = env, cpu = m.cpu;
  // a frame ends with its interrupt accepted (PC = $38) and the ISR body runs first in the next frame: let it run (the tick of the frame comes before main code, as in a real frame) and
  // tag the writes with the frame being run
  if (env.log) env.log.cur = env.frames + 1;
  if (cpu.pc === 0x38) { let k = 0; while (cpu.pc !== Sy.T_RET) { Z.runZ80(cpu, m.bus, 1, m); if (++k > 200000) throw new Error('the pending ISR did not return'); } }
  for (const r of ['a', 'f', ...KEEP]) cpu[r] = rng ? rng.int(0, 255) : 0;
  const P = { bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  for (const [k, v] of Object.entries(regs)) { if (P[k]) { cpu[P[k][0]] = (v >> 8) & 0xFF; cpu[P[k][1]] = v & 0xFF; } else cpu[k] = v & 0xFF; }
  const before = KEEP.map((r) => cpu[r]);
  m.ram[Sy.V_SHADOW_F4] = F4OF[map]; m.portF4 = F4OF[map];
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = 0xFF00 - 2; m.ram[0xFF00 - 2] = Sy.T_RET & 0xFF; m.ram[0xFF00 - 1] = Sy.T_RET >> 8;
  cpu.pc = addr;
  const t0 = m.tstates; let lo = cpu.sp, di = 0, steps = 0;
  while (cpu.pc !== Sy.T_RET) {
    if (m.bus.read(cpu.pc) === 0xF3) di++;
    Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.sp < lo && cpu.sp >= 0xF000) lo = cpu.sp;
    if (++steps > 200000) throw new Error(`${hex(addr)} did not return (PC ${hex(cpu.pc)})`);
  }
  const t = m.tstates - t0;
  const kept = KEEP.filter((r, i) => cpu[r] !== before[i]);
  m.ram[Sy.V_SHADOW_F4] = 0x33; m.portF4 = 0x33;
  cpu.iff1 = cpu.iff2 = true;
  return { t, depth: 0xFF00 - lo, di, kept, sp: cpu.sp };
}
/** K_BEEP called directly: the model follows (the call is in the frame being run, after its tick). */
function beep(env, mdl, id, map = 'K') {
  const f = env.frames + 1;
  const r = trace(env, env.S.K_BEEP, { a: id }, map);
  mdl.beep(f, id);
  return r;
}
/** Run n frames; after each the AY registers 0, 1, 7, 8 equal the model's (those the model has written), K_SNDN equals the model's count.  Returns the mismatches. */
function runChecked(env, mdl, n, errs) {
  const { m } = env;
  for (let i = 0; i < n; i++) {
    env.frame(); mdl.advance(env.frames);
    for (const r of [0, 1, 7, 8]) if (mdl.regs[r] !== null && m.ay.regs[r] !== mdl.regs[r]) errs.push(`frame ${env.frames}: AY r${r} = ${m.ay.regs[r]}, the model has ${mdl.regs[r]}`);
    if (m.ram[K_SNDN] !== mdl.n) errs.push(`frame ${env.frames}: K_SNDN ${m.ram[K_SNDN]}, the model has ${mdl.n}`);
    if (errs.length > 4) break;
  }
}
const settle = (env, n = 30) => env.frames_(n);
// park: the pending frame ISR (a frame ends with its interrupt accepted, PC = $38) runs first, so that no frame's ISR is lost; interrupts stay on
const park = (env) => {
  const { m } = env, cpu = m.cpu;
  if (cpu.pc === 0x38) { const sp0 = cpu.sp + 2; let k = 0; do { Z.runZ80(cpu, m.bus, 1, m); if (++k > 200000) throw new Error('the pending ISR did not return'); } while (cpu.sp !== sp0); }
  L.park(env); cpu.iff1 = cpu.iff2 = true;
};
const allowedPairs = (ids) => { const s = new Set(['7,62', '8,0']); for (const id of ids) { const [per, vol] = TAB[id]; s.add(`0,${per & 255}`); s.add(`1,${per >> 8}`); s.add(`8,${vol}`); } return s; };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 0 and 1: boot and idle
function bootGroups() {
  const { env, log } = S.boot(); const { m, S: Sy } = env;
  // 0. the boot's writes: the stock ROM's (registers 7 and 14), the cartridge's own silencing (registers 15 down to 0, all 0), nothing else; K_SOUND = 1
  if (has('0')) {
    const sec = new Sec('0 boot: K_SOUND = 1, K_SNDN = 0; the AY data writes of the boot are the ROM\'s (registers 7 and 14) and the cartridge\'s own silencing (registers 15..0 written 0 once, by ENTRY); no sound is started, channel A\'s volume is 0');
    sec.ok(m.ram[K_SOUND] === 1, () => `K_SOUND ${m.ram[K_SOUND]}, want 1`);
    sec.ok(m.ram[K_SNDN] === 0, () => `K_SNDN ${m.ram[K_SNDN]}, want 0`);
    const entry = log.dat.filter((e) => e.pc >= 0x100 && e.pc < 0x200), rest = log.dat.filter((e) => !(e.pc >= 0x100 && e.pc < 0x200));
    sec.ok(entry.length === 16 && entry.every((e, i) => e.reg === 15 - i && e.v === 0), () => `ENTRY's silencing: ${entry.length} writes ${entry.map((e) => `r${e.reg}=${e.v}`).join(' ')}, want r15..r0 = 0`);
    sec.ok(rest.every((e) => e.reg === 7 || e.reg === 14), () => `a data write to a register other than 7 / 14 outside ENTRY: ${rest.filter((e) => e.reg !== 7 && e.reg !== 14).slice(0, 3).map((e) => `f${e.f} r${e.reg}=${e.v} PC ${hex(e.pc)}`).join(', ')}`);
    sec.ok(!log.dat.some((e) => e.reg === 8 && e.v !== 0), 'no volume write above 0 in the boot');
    sec.ok(m.ay.regs[8] === 0 && m.ay.regs[0] === 0 && m.ay.regs[1] === 0, () => `after boot r0 ${m.ay.regs[0]}, r1 ${m.ay.regs[1]}, r8 ${m.ay.regs[8]}, want 0`);
    sec.end(`${log.dat.length} data writes and ${log.sel.length} selects in the boot`);
  }
  // 1. idle: 200 frames with no sound: no data write; the selects are the two a frame that were there before (K_POLL's register 14, the ISR's put-back of K_AYREG)
  if (has('1')) {
    const sec = new Sec('1 idle: over 200 frames with no sound playing there is no write to the AY data port and the selects are two a frame (register 14, then K_AYREG), as before the sound engine; the registers stay as they are');
    env.frames_(20); log.clear();
    const r0 = regsOf(m), a0 = Array.from(m.ay.regs), shadow = m.ram[K_AYREG];
    env.frames_(200);
    sec.ok(log.dat.length === 0, () => `${log.dat.length} data writes in 200 idle frames: ${fmtLog(log, 6)}`);
    const byFrame = new Map(); for (const e of log.sel) byFrame.set(e.f, (byFrame.get(e.f) || []).concat(e.v));
    const bad = [...byFrame].filter(([, v]) => v.length !== 2 || v[0] !== 14 || v[1] !== shadow);
    sec.ok(byFrame.size === 200 && bad.length === 0, () => `selects: ${byFrame.size} frames with writes, ${bad.length} not (14, K_AYREG ${shadow}): ${JSON.stringify(bad.slice(0, 2))}`);
    sec.ok(Array.from(m.ay.regs).join() === a0.join() && fmtRegs(regsOf(m)) === fmtRegs(r0), 'the AY registers unchanged');
    sec.end('no data write; selects: 2 a frame');
  }
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. every sound by a direct K_BEEP
function directGroup() {
  const { env, log } = S.boot(); const { m, S: Sy } = env;
  park(env); env.frames_(5);
  const sec = new Sec('2 the nine sounds by a direct K_BEEP (mapping K and A, and by KFAR from A): the raw writes in order (select 7, data $3E, select 0, period low, select 1, period high, select 8, volume), K_AYREG stored before each select, the registers and K_SNDN each frame, r8 = 0 after exactly `frames` frames, the chains (3 then 6; 5 then 7, 8, 9) frame by frame');
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  m.ram.set([0xEF, Sy.K_BEEP & 255, Sy.K_BEEP >> 8, 0xC9], 0xC800);                    // KFAR K_BEEP / ret, at $C800 (the shell no longer runs: the arena is free)
  for (const how of ['K', 'A', 'KFAR']) for (const id of ids) {
    settle(env, 25); log.clear();
    const mdl = new AyModel(true, env.frames), errs = [];
    const f0 = env.frames + 1, i0 = log.all.length;
    if (how === 'KFAR') { const r = trace(env, 0xC800, { a: id }, 'A'); mdl.beep(f0, id); sec.ok(r.sp === 0xFF00, () => `KFAR K_BEEP ${id}: SP ${hex(r.sp)} after`); sec.ok(m.ram[Sy.V_SHADOW_F4] === 0x33, 'F4 shadow back to K'); }
    else beep(env, mdl, id, how);
    const ctx = `${how} K_BEEP ${id} (${['click', 'select', 'alert', 'error', 'win', 'alert 2nd', 'win 2', 'win 3', 'win 4'][id - 1]})`;
    // the raw writes: S7 D3E S0 Dlo S1 Dhi S8 Dvol, each select preceded by the shadow's store (the shadow equals the select when it is written, and the data goes to the selected register)
    const inSnd = (e) => e.pc > Sy.K_BEEP && e.pc <= Sy.SND_TAB;                        // the sound code's own writes (the pending ISR's selects of register 14 and K_AYREG are not)
    const [per, vol, n, next] = TAB[id], want = [['S', 7], ['D', 62], ['S', 0], ['D', per & 255], ['S', 1], ['D', per >> 8], ['S', 8], ['D', vol]], got = log.all.slice(i0).filter(inSnd).slice(0, 8);
    sec.ok(got.length === 8 && got.every((e, i) => e.k === want[i][0] && e.v === want[i][1]), () => `${ctx}: raw writes ${got.map((e) => e.k + e.v).join(' ')}, want ${want.map((w) => w.join('')).join(' ')}`);
    sec.ok(log.sel.filter(inSnd).slice(0, 4).every((e) => e.shadow === e.v), () => `${ctx}: K_AYREG at each select: ${log.sel.filter(inSnd).slice(0, 4).map((e) => `${e.shadow}/${e.v}`).join(' ')} (shadow / selected), want equal (the shadow is stored before the OUT)`);
    sec.ok(log.dat.slice(0, 4).every((e) => e.shadow === e.reg), () => `${ctx}: at each data write K_AYREG ${log.dat.slice(0, 4).map((e) => e.shadow).join(',')}, the latch ${log.dat.slice(0, 4).map((e) => e.reg).join(',')}`);
    sec.ok(m.ram[K_AYREG] === 8, () => `${ctx}: K_AYREG ${m.ram[K_AYREG]} after, want 8 (the last register selected)`);
    sec.ok(m.ram[K_SNDN] === n && m.ram[K_SNDX] === next, () => `${ctx}: K_SNDN ${m.ram[K_SNDN]} / K_SNDX ${m.ram[K_SNDX]}, want ${n} / ${next}`);
    sec.ok(regsOf(m)[7] === 0x3E && regsOf(m)[0] === (per & 255) && regsOf(m)[1] === (per >> 8) && regsOf(m)[8] === vol, () => `${ctx}: ${fmtRegs(regsOf(m))}, want r0 ${per & 255} r1 ${per >> 8} r7 62 r8 ${vol}`);
    // frame by frame to the end of the chain: the model; and the explicit end of a sound without a chain
    runChecked(env, mdl, 40, errs);
    sec.ok(errs.length === 0, () => `${ctx}: ${errs.join('; ')}`);
    const exp = mdl.exp, got2 = S.dataOf(log), same = exp.length === got2.length && exp.every((e, i) => e.f === got2[i].f && e.reg === got2[i].reg && e.v === got2[i].v);
    sec.ok(same, () => `${ctx}: writes ${S.fmt(got2)}; the model ${S.fmt(exp)}`);
    const end = got2.filter((e) => e.reg === 8 && e.v === 0);
    sec.ok(end.length === 1, () => `${ctx}: ${end.length} writes of r8 = 0`);
    let total = 0, cur = id; while (cur) { total += TAB[cur][2]; cur = TAB[cur][3]; }
    sec.ok(end.length === 1 && end[0].f === f0 + total, () => `${ctx}: silent in frame ${end[0] && end[0].f}, want ${f0 + total} (the chain's ${total} frames after frame ${f0})`);
    sec.ok(m.ram[K_SNDN] === 0 && m.ay.regs[8] === 0, () => `${ctx}: after the end K_SNDN ${m.ram[K_SNDN]}, r8 ${m.ay.regs[8]}`);
    sec.ok(log.dat.every((e) => [0, 1, 7, 8].includes(e.reg)), () => `${ctx}: a write to another register: ${log.dat.filter((e) => ![0, 1, 7, 8].includes(e.reg)).map((e) => 'r' + e.reg).join(',')}`);
  }
  // the chains frame by frame, spelled out (SOUND 6: the table)
  { const f0 = env.frames; settle(env, 25); log.clear(); const f1 = env.frames + 1, mdl = new AyModel(true, f1 - 1); beep(env, mdl, 3); env.frames_(14);
    const got = S.dataOf(log), want = [[7, 62], [0, 125], [1, 0], [8, 8], [7, 62], [0, 165], [1, 0], [8, 8], [8, 0]], fr = [0, 0, 0, 0, 6, 6, 6, 6, 12];
    sec.ok(got.length === 9 && got.every((e, i) => e.reg === want[i][0] && e.v === want[i][1] && e.f === f1 + fr[i]), () => `alert (3 then 6), spelled out: ${S.fmt(got)} from frame ${f1}; want r7 62 r0 125 r1 0 r8 8 at +0, r7 r0 165 r1 0 r8 8 at +6, r8 0 at +12`);
    void f0; }
  { settle(env, 25); log.clear(); const f1 = env.frames + 1, mdl = new AyModel(true, f1 - 1); beep(env, mdl, 5); env.frames_(22);
    const got = S.dataOf(log), per = [125, 94, 74, 62], vol = 8, fr = [0, 3, 6, 9], want = [];
    per.forEach((p, k) => { want.push([f1 + fr[k], 7, 62], [f1 + fr[k], 0, p & 255], [f1 + fr[k], 1, p >> 8], [f1 + fr[k], 8, vol]); }); want.push([f1 + 19, 8, 0]);
    sec.ok(got.length === want.length && got.every((e, i) => e.f === want[i][0] && e.reg === want[i][1] && e.v === want[i][2]), () => `win (5, 7, 8, 9), spelled out: ${S.fmt(got)}; want rows at +0, +3, +6, +9 (periods 125, 94, 74, 62) and r8 = 0 at +19`); }
  sec.end('9 sounds x 3 call paths, the two chains');
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. a sound replaced by another; off in the middle of a chain
function replaceGroup() {
  const { env, log } = S.boot(); const { m } = env;
  park(env); env.frames_(5);
  const sec = new Sec('3 a sound replaced by another (the new one\'s four writes at once, the old one\'s remaining frames and its chain dropped), at every point of a 12 frame sound and of the alert\'s chain; K_SNDSET off in the middle of a chain: r8 = 0 at once, the chain does not start; on again: nothing is written until the next sound');
  const run = (ctx, steps) => {
    settle(env, 30); log.clear();
    const mdl = new AyModel(true, env.frames), errs = [];
    for (const st of steps) {
      if (st.wait) runChecked(env, mdl, st.wait, errs);
      else if (st.beep) beep(env, mdl, st.beep);
      else if (st.off !== undefined) { const f = env.frames + 1; trace(env, env.S.K_SNDSET, { a: st.off ? 1 : 0 }); mdl.set(f, st.off); }
    }
    runChecked(env, mdl, 40, errs);
    const got = S.dataOf(log), same = mdl.exp.length === got.length && mdl.exp.every((e, i) => e.f === got[i].f && e.reg === got[i].reg && e.v === got[i].v);
    sec.ok(errs.length === 0, () => `${ctx}: ${errs.join('; ')}`);
    sec.ok(same, () => `${ctx}: writes ${S.fmt(got)}; the model ${S.fmt(mdl.exp)}`);
    sec.ok(m.ram[K_SNDN] === 0 && m.ay.regs[8] === 0, () => `${ctx}: after the end K_SNDN ${m.ram[K_SNDN]}, r8 ${m.ay.regs[8]}`);
    return got;
  };
  // error (4, 12 frames) replaced by click (1) after k frames, k = 0..13 (0: the same frame; 12: the frame the error ends; 13: after it)
  for (let k = 0; k <= 13; k++) run(`error then click after ${k} frames`, [{ beep: 4 }, { wait: k }, { beep: 1 }]);
  // alert (3, 6 + 6) replaced by select (2) at every frame 0..13 (inside the first tone, at the chain point 6, inside the second tone, at its end, after it)
  for (let k = 0; k <= 13; k++) run(`alert then select after ${k} frames`, [{ beep: 3 }, { wait: k }, { beep: 2 }]);
  // win (5, 7, 8, 9: 3 + 3 + 3 + 10) replaced by error (4) at every frame 0..20
  for (let k = 0; k <= 20; k++) run(`win then error after ${k} frames`, [{ beep: 5 }, { wait: k }, { beep: 4 }]);
  // the same sound twice in a row; three sounds in a frame
  run('the same sound twice in one frame', [{ beep: 1 }, { beep: 1 }]);
  run('three sounds in one frame', [{ beep: 1 }, { beep: 2 }, { beep: 3 }]);
  run('click after click, 1 frame apart', [{ beep: 1 }, { wait: 1 }, { beep: 1 }]);
  // K_SNDSET off in the middle of a chain, then on, then a sound
  for (const k of [0, 1, 5, 6, 7, 11, 12]) {
    const got = run(`alert, sound off after ${k} frames, on 10 frames later, then a click`, [{ beep: 3 }, { wait: k }, { off: false }, { wait: 10 }, { off: true }, { wait: 3 }, { beep: 1 }]);
    sec.ok(got.some((e) => e.reg === 8 && e.v === 0), `${k}: r8 = 0 written`);
  }
  // with sound off K_BEEP writes nothing and K_SNDSET off again still writes r8 = 0 (SOUND 6: "off sets K_SNDN = 0 and writes AY register 8 = 0")
  run('off, then three sounds (nothing), then on, a click', [{ off: false }, { beep: 1 }, { beep: 3 }, { beep: 5 }, { wait: 20 }, { off: true }, { beep: 2 }]);
  sec.end('replacements at every frame, off / on in a chain');
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. interrupt injection at every instruction boundary of K_BEEP and K_SNDSET
function injectGroup() {
  const { env, log } = S.boot(); const { m, S: Sy } = env;
  park(env); env.frames_(5);
  const sec = new Sec('4 interrupt injection (docs/BANKING.md 11.1): the frame ISR taken at every instruction boundary of K_BEEP (with nothing playing, with a sound about to end, with a chain about to start, with a sound mid-way) and of K_SNDSET: every data write lands in registers 0, 1, 7, 8 with the values of one of the sounds involved, the main sequence (7, 0, 1, 8) is in order, registers 2-6 and 9-15 untouched, after each ISR the register latch equals K_AYREG, the ISR keeps every register, the end state is the new sound\'s, silence at the end');
  for (let r = 2; r <= 6; r++) m.ay.regs[r] = 0xA0 + r;
  for (let r = 9; r <= 13; r++) m.ay.regs[r] = 0xA0 + r;
  settle(env, 20);
  const base = snapshot(m), keepRegs = [2, 3, 4, 5, 6, 9, 10, 11, 12, 13];
  const pres = [{ n: 0, x: 0, name: 'idle' }, { n: 1, x: 0, name: 'a sound ending this tick' }, { n: 1, x: 6, name: 'a chain starting this tick' }, { n: 5, x: 6, name: 'a sound mid-way' }];
  let runs = 0, bad = 0, firstBad = '', maxDepth = 0, latchBad = 0, isrChanged = 0;
  const start = (addr, regs) => {
    const cpu = m.cpu;
    for (const r of ['a', 'f', ...KEEP]) cpu[r] = 0;
    if (regs.a !== undefined) cpu.a = regs.a;
    m.ram[Sy.V_SHADOW_F4] = 0x33; m.portF4 = 0x33;
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true;
    cpu.sp = 0xFF00 - 2; m.ram[0xFF00 - 2] = Sy.T_RET & 0xFF; m.ram[0xFF00 - 1] = Sy.T_RET >> 8; cpu.pc = addr;
  };
  const one = (addr, a, pre, k, ids, want) => {
    restore(m, base); m.ram[K_SNDN] = pre.n; m.ram[K_SNDX] = pre.x; m.ram[K_SOUND] = 1;
    // the sound that was playing wrote its own registers: r7 62, r8 8 (r0 / r1 the old ones)
    m.ay.regs[7] = 0x3E; m.ay.regs[8] = pre.n ? 8 : 0;
    log.clear(); start(addr, { a });
    let n = 0, latchHere = true, depth = 0, changed = [];
    while (m.cpu.pc !== Sy.T_RET) {
      if (n === k) { const r = runIsr(m, Sy, null); depth = r.depth; changed = r.changed; latchHere = m.ayLatch === m.ram[K_AYREG]; }
      Z.runZ80(m.cpu, m.bus, 1, m); n++;
      if (n > 5000) throw new Error('K_BEEP did not return');
    }
    const ret = { n, depth, changed, latchHere };
    for (let i = 0; i < 40; i++) { M.runFrame(m); if (i >= 1 && m.ram[K_SNDN] === 0) break; }
    return ret;
  };
  const verify = (ctx, id, pre, k, r, kind) => {
    runs++;
    const chain = (i) => { const o = []; while (i) { o.push(i); i = TAB[i][3]; } return o; };
    const ids = kind === 'beep' ? [...chain(id), ...chain(pre.x)] : chain(pre.x);
    const ok = allowedPairs(ids), problems = [];
    for (const e of log.dat) { if (![0, 1, 7, 8].includes(e.reg)) problems.push(`a data write to r${e.reg} (${e.v})`); else if (!ok.has(`${e.reg},${e.v}`)) problems.push(`r${e.reg} = ${e.v} is no value of the sounds involved`); }
    if (kind === 'beep') {
      // the main sequence 7, 0, 1, 8 of the new sound appears in order among the writes
      const seq = [[7, 62], [0, TAB[id][0] & 255], [1, TAB[id][0] >> 8], [8, TAB[id][1]]]; let q = 0;
      for (const e of log.dat) if (q < 4 && e.reg === seq[q][0] && e.v === seq[q][1]) q++;
      if (q !== 4) problems.push(`the sequence r7 62, r0 ${seq[1][1]}, r1 ${seq[2][1]}, r8 ${seq[3][1]} is not in the writes: ${log.dat.map((e) => `r${e.reg}=${e.v}`).join(' ')}`);
      let last = id; while (TAB[last][3]) last = TAB[last][3];
      const per = TAB[last][0];
      if (!(m.ay.regs[7] === 0x3E && m.ay.regs[0] === (per & 255) && m.ay.regs[1] === (per >> 8))) problems.push(`the end state ${fmtRegs(regsOf(m))}, want r0 ${per & 255} r1 ${per >> 8} r7 62 (the last tone of sound ${id}'s chain)`);
    } else {
      if (m.ram[K_SOUND] !== (id ? 1 : 0)) problems.push(`K_SOUND ${m.ram[K_SOUND]}`);
    }
    if (m.ay.regs[8] !== 0) problems.push(`r8 = ${m.ay.regs[8]} after 60 frames, want 0`);
    if (m.ram[K_SNDN] !== 0) problems.push(`K_SNDN ${m.ram[K_SNDN]} after 60 frames`);
    for (const rr of keepRegs) if (m.ay.regs[rr] !== 0xA0 + rr) problems.push(`r${rr} changed to ${m.ay.regs[rr]}`);
    if (!r.latchHere) { latchBad++; problems.push(`after the ISR at boundary ${k} the latch ${m.ayLatch} is not K_AYREG`); }
    if (m.ayLatch !== m.ram[K_AYREG]) { latchBad++; problems.push(`at the end the latch ${m.ayLatch} is not K_AYREG ${m.ram[K_AYREG]}`); }
    if (r.changed.length) { isrChanged++; problems.push(`the ISR changed ${r.changed.join(',')}`); }
    maxDepth = Math.max(maxDepth, r.depth);
    // the data writes' own pairing: every data write came right after a select of its register (the select-data pairs in the raw log); a data write with no select of its own register just before is a stray
    for (let i = 0; i < log.all.length; i++) { const e = log.all[i]; if (e.k === 'D') { const prev = log.all.slice(0, i).reverse().find((x) => x.k === 'S'); if (!prev || (prev.v & 15) !== e.reg) problems.push(`a data write to r${e.reg} after a select of ${prev ? prev.v : 'none'}`); } }
    if (problems.length) { bad++; if (!firstBad) firstBad = `${ctx} (${pre.name}), boundary ${k}: ${problems.slice(0, 3).join('; ')}`; }
  };
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const pre of pres) {
    for (const id of (pre.n === 0 ? ids : [1, 3, 4, 5])) {
      const total = one(Sy.K_BEEP, id, pre, -1, [id], null).n;
      for (let k = 0; k < total; k++) { const r = one(Sy.K_BEEP, id, pre, k, [id], null); verify(`K_BEEP ${id}`, id, pre, k, r, 'beep'); }
    }
    for (const a of [0, 1]) {
      const total = one(Sy.K_SNDSET, a, pre, -1, [], null).n;
      for (let k = 0; k < total; k++) { const r = one(Sy.K_SNDSET, a, pre, k, [], null); verify(`K_SNDSET ${a}`, a, pre, k, r, 'set'); }
    }
  }
  sec.ok(bad === 0, () => `${bad} of ${runs} runs wrong; first: ${firstBad}`);
  sec.ok(latchBad === 0, () => `${latchBad} runs where the latch differed from K_AYREG after the ISR`);
  sec.ok(isrChanged === 0, () => `${isrChanged} ISRs changed a register`);
  sec.ok(runs > 1500, () => `only ${runs} runs`);
  sec.end(`${runs} runs (an ISR at every boundary), the deepest ISR ${maxDepth} bytes of stack`);
  injectGroup.depth = maxDepth;
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The real events
/** Run `action` with the log cleared, settle, and compare the writes with the model: the main-code events `wants` (ids or 'off'). */
function scen(env, log, sec, ctx, wants, action, { settleN = 45, on = true } = {}) {
  env.frames_(10); log.clear();
  action(); env.frames_(settleN);
  const errs = explain(log, 0, wants, env.frames, on);
  sec.ok(errs.length === 0, () => `${ctx}: ${errs.join('; ')}; writes: ${fmtLog(log)}`);
  sec.ok(env.m.ram[K_SNDN] === 0 && (wants.length === 0 || env.m.ay.regs[8] === 0), () => `${ctx}: after the sound K_SNDN ${env.m.ram[K_SNDN]}, r8 ${env.m.ay.regs[8]}`);
  return log.dat.slice();
}
const shellEnv = () => { const { env, log } = S.boot(); env.frames_(10); return { env, log }; };
const menuTitleClick = (env, hold = 5) => { L.moveTo(env, 20, 4); env.m.mouse.buttons = L.MOUSE_LEFT; env.frames_(hold); env.m.mouse.buttons = L.MOUSE_UP; env.frames_(10); };
const typeKey = (env, code) => { L.typeCode(env, code, 3, 3); };
const AB_OK = [336, 108];

function shellEvents() {
  const { env, log } = shellEnv(); const { m, S: Sy } = env;
  // 5a. menu choices and About
  {
    const sec = new Sec('5 shell events: a Leap menu item chosen sounds the select (id 2) once; About then the alert (3, chained to 6) in the same frame; a menu closed with nothing highlighted is silent (released on the title, released away from the items, ESC); Show Desktop; the alert\'s OK by key (ENTER, SPACE) and ESC / BREAK: the click (id 1) once per press');
    scen(env, log, sec, 'Leap > Show Desktop (item 7)', [2], () => H.leapMenu(env, 7));
    scen(env, log, sec, 'Leap > About (item 1): select, then the alert', [2, 3], () => H.leapMenu(env, 1), { settleN: 40 });
    scen(env, log, sec, 'the alert\'s OK by ENTER: a click', [1], () => typeKey(env, 13));
    scen(env, log, sec, 'About again (the dialog made once, reused)', [2, 3], () => H.leapMenu(env, 1));
    scen(env, log, sec, 'the alert\'s OK by SPACE (the focused default button): a click', [1], () => typeKey(env, 32));
    scen(env, log, sec, 'About, closed by ESC (the cancel path of a dialog): a click', [2, 3], () => H.leapMenu(env, 1));
    scen(env, log, sec, 'ESC', [1], () => typeKey(env, 27));
    scen(env, log, sec, 'About, closed by BREAK', [2, 3], () => H.leapMenu(env, 1));
    scen(env, log, sec, 'BREAK', [1], () => typeKey(env, 3));
    // held key: one click for a held ENTER (no repeat inside 30 frames)
    scen(env, log, sec, 'About, the OK key held 20 frames: one click', [2, 3], () => H.leapMenu(env, 1));
    scen(env, log, sec, 'ENTER held 20 frames', [1], () => { const list = L.keysFor(13); L.setKeys(m, list); env.frames_(20); L.setKeys(m, []); env.frames_(3); });
    // nothing highlighted: no sound
    scen(env, log, sec, 'the Leap title pressed and released on the title (no item highlighted)', [], () => menuTitleClick(env));
    scen(env, log, sec, 'the Leap title pressed, the pointer moved away from the items and released', [], () => { L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4); L.moveTo(env, 400, 150); env.frames_(3); m.mouse.buttons = L.MOUSE_UP; env.frames_(10); });
    scen(env, log, sec, 'the menu opened by MENU and closed by ESC', [], () => { typeKey(env, 16); typeKey(env, 27); });
    scen(env, log, sec, 'the menu opened by MENU, ENTER on the first item (About: select, then the alert)', [2, 3], () => { typeKey(env, 16); typeKey(env, 13); });
    scen(env, log, sec, 'the alert closed by ENTER', [1], () => typeKey(env, 13));
    scen(env, log, sec, 'the title click with the pointer pressed on a separator row (item 2) and released there: nothing chosen, silent', [], () => H.leapMenu(env, 2));
    // an item chosen is one select even when the program is then started (Calculator): select once, nothing else from the shell
    scen(env, log, sec, 'Leap > Calculator (item 3): the select; the launch itself is silent', [2], () => { H.leapMenu(env, 3); });
    env.frames_(20);
    L.quitByCloseBox(env, 1);
    sec.end('menu choices, About, key presses');
  }
  countVf(env);
}

function mouseButtons() {
  const { env, log } = shellEnv(); const { m, S: Sy } = env;
  const sec = new Sec('5m a Button pressed by the MOUSE (R3; SOUND 6: "b_click (a Button pressed, by mouse or key: id 1, before the press is drawn)"): the alert\'s OK clicked with the pointer, and a Calculator button clicked, sound the click (id 1) once each');
  scen(env, log, sec, 'About', [2, 3], () => H.leapMenu(env, 1));
  scen(env, log, sec, 'the alert\'s OK clicked by the mouse (press 3 frames, release): the click (id 1) once', [1], () => L.click(env, AB_OK[0], AB_OK[1], 3, 6));
  if (L.openWindows(m, Sy).some((w) => w.cls === Sy.CL_Dialog)) typeKey(env, 13);
  scen(env, log, sec, 'Leap > Calculator', [2], () => H.leapMenu(env, 3)); env.frames_(15);
  const [x7, y7] = L.centre(L.BUTTONS[4]);
  scen(env, log, sec, 'the 7 button clicked by the mouse, held 30 frames: the click (id 1) once', [1], () => L.click(env, x7, y7, 30, 8));
  sec.end('mouse press of a Button');
  countVf(env);
}

function calcEvents() {
  const log = S.makeAyLog();
  const env = L.bootDesk5({ prog: 1, video: false, setup: log.setup }); log.attach(env); const { m, S: Sy } = env;
  const sec = new Sec('6 Calculator: a button activated by key (the focused button, SPACE) sounds the click once; a digit typed on the keyboard and TAB sound nothing');
  scen(env, log, sec, 'a digit key (7): no sound', [], () => typeKey(env, 55));
  scen(env, log, sec, 'TAB moves the focus: no sound', [], () => typeKey(env, 14));
  scen(env, log, sec, 'SPACE on the focused button: the click (id 1) once', [1], () => typeKey(env, 32));
  scen(env, log, sec, 'SPACE again on the next button after TAB', [1], () => { typeKey(env, 14); typeKey(env, 32); });
  sec.end('Calculator');
  countVf(env);
}

function notepadEvents() {
  const log = S.makeAyLog();
  const env = W.bootWrite({ video: false, setup: log.setup }); log.attach(env); const { m, S: Sy } = env;
  const sec = new Sec('7 Notepad: Edit > Find... chosen (select; the Find dialog is a name dialog: NO alert sound), "Not found." opens (alert, 3), its OK (click 1); File > Save... (select only: the name dialog opening is silent); File > New with a changed document (select, then the discard question: 3), answered by ESC (cancel: click 1); typing sounds nothing');
  const fileItem = (k) => { L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3); L.moveTo(env, 30, 14 + 10 * k); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(12); };
  scen(env, log, sec, 'typing text', [], () => { for (const c of 'abc') typeKey(env, c.charCodeAt(0)); });
  scen(env, log, sec, 'Edit > Find...: the select only (a name dialog opens)', [2], () => W.editMenu(env, 6, { wait: 14 }));
  scen(env, log, sec, 'typing the search text "zzz" in the Field', [], () => { for (const c of 'zzz') typeKey(env, c.charCodeAt(0)); });
  scen(env, log, sec, 'ENTER in the Field: "Not found." (the alert: 3)', [3], () => typeKey(env, 13));
  scen(env, log, sec, 'the alert\'s OK by ENTER', [1], () => typeKey(env, 13));
  scen(env, log, sec, 'File > Save... (item 3): the select; the name dialog opens silently', [2], () => fileItem(2));
  scen(env, log, sec, 'ESC on the name dialog (the cancel button by key): a click', [1], () => typeKey(env, 27));
  scen(env, log, sec, 'File > New with the changed document: select, then the discard question (3)', [2, 3], () => fileItem(0));
  scen(env, log, sec, 'ESC on the question (Cancel by key): a click', [1], () => typeKey(env, 27));
  scen(env, log, sec, 'File > Open... is not used (it needs the file bridge); typing more text: silent', [], () => typeKey(env, 100));
  sec.end('Notepad');
  countVf(env);
}

function paintEvents() {
  const log = S.makeAyLog();
  const env = Q.bootPaint({ setup: log.setup }); log.attach(env); const { m, S: Sy } = env;
  const sec = new Sec('8 Paint\'s messages (id 4 once each, by pn_msg): "Not built yet" (a press with the Marquee), "Too big to undo" (a Bucket fill of the whole picture), "Fill too complex" (205 spans with a pattern); choosing a tool is silent');
  const P = Q.P, picAt = (px, py) => [P.PIC.x + env.st.ox + px, P.PIC.y + env.st.oy + py];
  const RECT = (x, y) => ((x >= 100 && x < 200 && y >= 40 && y < 100 && (x === 100 || x === 199 || y === 40 || y === 99)) ? 1 : 0), speck = (x, y) => (x === 20 && y === 10 ? 1 : 0);
  scen(env, log, sec, 'choosing the Marquee: silent', [], () => { Q.chooseTool(env, 0); env.st.chooseTool(0); });
  scen(env, log, sec, 'a press in the picture with the Marquee: "Not built yet"', [4], () => { Q.stroke(env, [picAt(150, 70)], { settle: 12 }); });
  sec.ok(Q.statusOf(env) === 'Not built yet', () => `status "${Q.statusOf(env)}"`);
  scen(env, log, sec, 'choosing the Bucket and the Pencil: silent', [], () => { Q.chooseTool(env, 5); env.st.chooseTool(5); });
  scen(env, log, sec, 'a Bucket click on the empty picture (solid): the whole picture, "Too big to undo"', [4], () => { Q.stroke(env, [picAt(150, 70)], { settle: 0 }); Q.idle(env, 1500); }, { settleN: 30 });
  sec.ok(Q.statusOf(env) === 'Too big to undo', () => `status "${Q.statusOf(env)}"`);
  scen(env, log, sec, 'choosing a pattern: silent', [], () => { Q.choosePattern(env, 2); env.st.choosePat(2); });
  Q.install(env, (x, y) => (RECT(x, y) || speck(x, y) ? 1 : 0)); env.frames_(6);
  scen(env, log, sec, 'a Bucket click on the background around a rectangle and a speck (205 spans, pattern 2): "Fill too complex"', [4], () => { Q.stroke(env, [picAt(10, 100)], { settle: 0 }); Q.idle(env, 1500); }, { settleN: 30 });
  sec.ok(Q.statusOf(env) === 'Fill too complex', () => `status "${Q.statusOf(env)}"`);
  Q.install(env, (x, y) => (RECT(x, y) ? 1 : 0)); env.frames_(6);
  scen(env, log, sec, 'a Bucket click inside the rectangle (no message): silent', [], () => { Q.stroke(env, [picAt(150, 70)], { settle: 0 }); Q.idle(env, 1500); }, { settleN: 20 });
  sec.end('Paint');
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 9. the Leap menu's 8th item
function leapGroup() {
  const { env, log } = shellEnv(); const { m, S: Sy } = env;
  const sec = new Sec('9 the Leap menu\'s 8th item: "Sound Off" at start (the open dropdown against the model with 8 items), chosen: the select, then channel A silent at once (r8 = 0), K_SOUND 0, the item\'s 9 characters "Sound On ", the dropdown redrawn; with sound off no data write for any event (About, the alert\'s key, Show Desktop, the menu by keys); chosen again: K_SOUND 1, "Sound Off", and the sounds return');
  const txt = () => String.fromCharCode(...m.ram.subarray(Sy.S_SNDTXT, Sy.S_SNDTXT + 9));
  const lay = (on) => layoutOf([SM.leapMenu(on)]), en = [[true, true, true, true, true, true, true, true]];
  const mask = () => L.pointerMask(m, Sy);
  const dropdown = (ctx, on, hi) => {
    L.moveTo(env, 500, 180); env.frames_(3);
    L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
    if (hi >= 0) { L.moveTo(env, 30, 9 + 10 * hi + 5); env.frames_(3); }
    const icons = H.iconAddrs(env), g = SM.renderShell({ sel: icons.indexOf(L.rd16(m, Sy.K_FOCUS)) }); drawOpen(g, [SM.leapMenu(on)], lay(on), en, 0, hi);
    const d = H.diffDisp(H.readDisp(m), SM.toDisp(g), mask());
    sec.ok(d === null, () => `${ctx}: the open dropdown (item ${hi} highlighted): ${d}`);
    L.moveTo(env, 400, 150); env.frames_(3); m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
  };
  sec.ok(txt() === 'Sound Off' && m.ram[K_SOUND] === 1, () => `at start the item "${txt()}", K_SOUND ${m.ram[K_SOUND]}`);
  // the menu table in RAM: the item's record is id 8, flags 0, length 9
  { const b = Sy.S_SNDTXT - 3; sec.ok(m.ram[b] === 8 && m.ram[b + 1] === 0 && m.ram[b + 2] === 9, () => `the item's record ${m.ram[b]}, ${m.ram[b + 1]}, ${m.ram[b + 2]}, want 8, 0, 9`); }
  dropdown('start', true, -1); dropdown('start', true, 7); dropdown('start', true, 6);
  // choose it (item 8): the select (2), then K_SNDSET 0: r8 = 0 at once
  const d1 = scen(env, log, sec, 'Leap > Sound Off (item 8): the select, then off', [2, 'off'], () => H.leapMenu(env, 8));
  sec.ok(d1.length === 5 && d1[4].reg === 8 && d1[4].v === 0 && d1[4].f === d1[0].f, () => `the writes ${S.fmt(d1.map((e) => ({ f: e.f, reg: e.reg, v: e.v })))}: want the select's four and r8 = 0 in the same frame`);
  sec.ok(m.ram[K_SOUND] === 0 && m.ram[K_SNDN] === 0 && m.ay.regs[8] === 0, () => `K_SOUND ${m.ram[K_SOUND]}, K_SNDN ${m.ram[K_SNDN]}, r8 ${m.ay.regs[8]}`);
  sec.ok(txt() === 'Sound On ', () => `the item now "${txt()}" (${JSON.stringify(txt())}), want "Sound On " (9 characters)`);
  sec.ok(m.ram[K_AYREG] === 8, () => `K_AYREG ${m.ram[K_AYREG]} after the off`);
  dropdown('sound off', false, -1); dropdown('sound off', false, 7);
  // with sound off: no data write for any event
  scen(env, log, sec, 'sound off: Leap > About (no select, no alert sound)', [], () => H.leapMenu(env, 1), { on: false });
  scen(env, log, sec, 'sound off: the alert\'s OK by ENTER (no click)', [], () => typeKey(env, 13), { on: false });
  scen(env, log, sec, 'sound off: Show Desktop', [], () => H.leapMenu(env, 7), { on: false });
  scen(env, log, sec, 'sound off: the menu by keys, MENU, ENTER (About)', [], () => { typeKey(env, 16); typeKey(env, 13); }, { on: false });
  if (L.openWindows(m, Sy).some((w) => w.cls === Sy.CL_Dialog)) typeKey(env, 13);
  scen(env, log, sec, 'sound off: 100 idle frames', [], () => env.frames_(100), { on: false });
  sec.ok(log.dat.length === 0, () => `${log.dat.length} data writes with sound off`);
  // on again: the select is not heard (it was off when chosen), K_SOUND 1, "Sound Off"
  scen(env, log, sec, 'Leap > Sound On (item 8): no sound written (off when chosen), then on', [], () => H.leapMenu(env, 8), { on: false });
  sec.ok(m.ram[K_SOUND] === 1 && txt() === 'Sound Off', () => `K_SOUND ${m.ram[K_SOUND]}, the item "${txt()}"`);
  dropdown('sound on again', true, -1);
  scen(env, log, sec, 'Leap > Show Desktop: the select is back', [2], () => H.leapMenu(env, 7));
  scen(env, log, sec, 'Leap > About: select and alert again', [2, 3], () => H.leapMenu(env, 1));
  scen(env, log, sec, 'the alert\'s OK by ENTER: the click', [1], () => typeKey(env, 13));
  // choosing Sound Off in the middle of the alert's chain: the item is reachable only with no dialog (modal), so toggle twice quickly
  scen(env, log, sec, 'Sound Off, On, Off, On (four toggles in a row): the select and r8 = 0 on the 1st and 3rd', [2, 'off', 'on', 2, 'off', 'on'], () => { for (let i = 0; i < 4; i++) H.leapMenu(env, 8); }, { on: true });
  sec.ok(m.ram[K_SOUND] === 1 && txt() === 'Sound Off', () => `after four toggles K_SOUND ${m.ram[K_SOUND]}, the item "${txt()}"`);
  sec.end('the Sound item');
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 10. T-states, stack, DI, registers, V_FRAMES
function costGroup() {
  const { env, log } = S.boot(); const { m, S: Sy } = env;
  const rng = L.makeRng(7);
  park(env); env.frames_(5);
  const sec = new Sec('10 cost: K_BEEP <= 400 T and <= 32 bytes of stack (the return address and the pushes), no DI in any path, every register kept but AF (random in), K_SNDSET and the tick likewise; the tick <= 60 T idle and <= 120 T playing (SOUND 2); V_FRAMES +1 a frame in every machine of this suite');
  const T = { beep: [], beepOff: 0, tickIdle: 0, tickPlay: 0, tickEndSilence: 0, tickEndChain: 0, set0: 0, set1: 0, kfar: 0 }, depth = { beep: 0, tick: 0, set: 0, kfar: 0 };
  let di = 0, kept = [];
  for (const map of ['K', 'A']) for (let id = 1; id <= 9; id++) {
    settle(env, 25); m.ram[K_SOUND] = 1;
    const r = trace(env, Sy.K_BEEP, { a: id }, map, rng);
    if (map === 'K') T.beep.push(r.t);
    depth.beep = Math.max(depth.beep, r.depth); di += r.di; kept.push(...r.kept);
    sec.ok(r.sp === 0xFF00, () => `K_BEEP ${id}: SP ${hex(r.sp)} on return`);
  }
  { settle(env, 25); m.ram[K_SOUND] = 0; const r = trace(env, Sy.K_BEEP, { a: 3 }, 'K', rng); T.beepOff = r.t; di += r.di; kept.push(...r.kept); m.ram[K_SOUND] = 1; }
  // the tick in its four situations (called as the ISR calls it: registers free)
  { const set = (n, x) => { m.ram[K_SNDN] = n; m.ram[K_SNDX] = x; };
    set(0, 0); let r = trace(env, Sy.K_SNDTICK); T.tickIdle = r.t; di += r.di; depth.tick = Math.max(depth.tick, r.depth);
    set(5, 0); r = trace(env, Sy.K_SNDTICK); T.tickPlay = r.t; di += r.di; depth.tick = Math.max(depth.tick, r.depth); sec.ok(m.ram[K_SNDN] === 4, () => `the tick with K_SNDN 5: ${m.ram[K_SNDN]}, want 4`);
    set(1, 0); r = trace(env, Sy.K_SNDTICK); T.tickEndSilence = r.t; di += r.di; depth.tick = Math.max(depth.tick, r.depth); sec.ok(m.ram[K_SNDN] === 0 && m.ay.regs[8] === 0, 'the ending tick silences');
    set(1, 6); r = trace(env, Sy.K_SNDTICK); T.tickEndChain = r.t; di += r.di; depth.tick = Math.max(depth.tick, r.depth); sec.ok(m.ram[K_SNDN] === 6 && m.ay.regs[0] === 165, () => `the ending tick with a chain: K_SNDN ${m.ram[K_SNDN]}, r0 ${m.ay.regs[0]}`);
    set(0, 0); m.ay.regs[8] = 0; }
  { settle(env, 25); const r1 = trace(env, Sy.K_SNDSET, { a: 0 }, 'K', rng); T.set0 = r1.t; depth.set = r1.depth; di += r1.di; kept.push(...r1.kept.filter((x) => !['b', 'c'].includes(x)));
    const r2 = trace(env, Sy.K_SNDSET, { a: 1 }, 'K', rng); T.set1 = r2.t; depth.set = Math.max(depth.set, r2.depth); di += r2.di; sec.ok(m.ram[K_SOUND] === 1, 'K_SNDSET 1 turns it on'); }
  // KFAR path from mapping A
  { m.ram.set([0xEF, Sy.K_BEEP & 255, Sy.K_BEEP >> 8, 0xC9], 0xC800); settle(env, 25); const r = trace(env, 0xC800, { a: 1 }, 'A', rng); T.kfar = r.t; depth.kfar = r.depth; di += r.di; }
  const maxBeep = Math.max(...T.beep), minBeep = Math.min(...T.beep);
  sec.ok(maxBeep <= 400, () => `K_BEEP ${minBeep}..${maxBeep} T, bound 400`);
  sec.ok(depth.beep - 2 <= 32, () => `K_BEEP's stack ${depth.beep - 2} bytes (without the return address), bound 32`);
  sec.ok(di === 0, () => `${di} DI executed`);
  sec.ok(kept.length === 0, () => `registers changed (should keep all but AF): ${[...new Set(kept)].join(',')}`);
  sec.ok(T.tickIdle <= 60, () => `tick idle ${T.tickIdle} T, bound 60`);
  sec.ok(T.tickPlay <= 120, () => `tick playing ${T.tickPlay} T, bound 120`);
  // the frame a sound ends in: the tick then silences (bound 120, the contract's "playing" row read as every frame of a sound's life) or starts the next row of a chain (a K_BEEP's work: bound 400)
  sec.ok(T.tickEndSilence <= 120, () => `the tick that ends a sound (r8 = 0) ${T.tickEndSilence} T, bound 120 (SOUND 2: "playing")`);
  sec.ok(T.tickEndChain <= 400, () => `the tick that starts the next row of a chain ${T.tickEndChain} T, bound 400 (K_BEEP's)`);
  console.log(`  T figures (RET included; the ISR's call adds 17): K_BEEP ${minBeep}..${maxBeep} (sound off ${T.beepOff}), via KFAR from A (id 1) ${T.kfar}; K_SNDSET off ${T.set0} / on ${T.set1};`);
  console.log(`  tick: idle ${T.tickIdle}, counting down ${T.tickPlay}, ending with silence ${T.tickEndSilence}, ending with a chain start ${T.tickEndChain}`);
  console.log(`  stack (bytes below $FF00, the return address included): K_BEEP ${depth.beep}, K_SNDSET ${depth.set}, the tick ${depth.tick}, KFAR K_BEEP from A ${depth.kfar}${injectGroup.depth !== undefined ? `; the frame ISR with the tick inside K_BEEP (group 4): ${injectGroup.depth}` : ''}`);
  sec.end(`K_BEEP ${minBeep}..${maxBeep} T, tick ${T.tickIdle} / ${T.tickPlay} T`);
  countVf(env);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (has('0') || has('1')) bootGroups();
if (has('2')) directGroup();
if (has('3')) replaceGroup();
if (has('4')) injectGroup();
if (has('5')) shellEvents();
if (has('5m')) mouseButtons();
if (has('6')) calcEvents();
if (has('7')) notepadEvents();
if (has('8')) paintEvents();
if (has('9')) leapGroup();
if (has('10')) costGroup();
{
  const sec = new Sec('11 V_FRAMES: +1 every normally run frame in every machine of this suite, no frame lost');
  sec.ok(notes.vfBad === 0, () => `${notes.vfBad} frames where V_FRAMES did not advance by 1`);
  sec.ok(notes.vfChecked > 0, 'frames were checked');
  sec.end(`${notes.vfChecked} frames in ${notes.envs} machines`);
}
finish();
