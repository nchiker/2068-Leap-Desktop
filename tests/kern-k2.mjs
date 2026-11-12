"use strict";
// kern-k2.mjs -- slice K2 of step 3 (docs/OBJECTS_EVENTS.md sections 2, 5-9 tests 3, 4, 6, 8, and 14): the event queues, the input ISR
// K_POLL, K_WARP, P_ISRMOVE and the new pointer arrow, on the `kern3` cartridge.  Written from the contract only (never from the Z80).
// The reference is tests/kern-model2.mjs (queues, K_POLL step by step) and, for the display, tests/gfx6-model.mjs (the S4 pointer model).
//   node tests/kern-k2.mjs [--seed N] [--reps N] [--stride N] [--fuzz N] [--polls N] [--flicker N] [--only LIST]
//     --seed N     PRNG seed (printed; default from the clock)
//     --reps N     random scenarios per case of the injection tests (default 3)
//     --stride N   interrupt injection at every N-th instruction boundary (default 1 = every one)
//     --fuzz N     random frames of the test-4 fuzz (default 800)
//     --polls N    random direct K_POLL steps (default 3000)
//     --flicker N  strict frames of the test-6 flicker test (default 400; the contract wants at least 200)
//     --maxfail N  a section stops after N failed checks (default 25)
//     --only LIST  parts: 0 boot / spec, 1 direct queues, 2 queue injection, 3 direct K_POLL / P_ISRMOVE / K_WARP, 4 input over frames,
//                  5 pointer injection, 6 flicker (default all)
//
// Readings of the contract (also in the report):
//  R1. Ring full and the new record an E_MOVE whose predecessor is an E_MOVE (tail - head >= 8): the move COALESCES (14.2 says a move
//      overwrites "instead of being appended"; section 6: "moves never fill the ring"), so nothing is lost and K_LOST stays.
//  R2. A newly pressed key whose code is 0 (SS + Q / W / E / I / ENTER) makes no event and leaves the repeat as it was, but it counts as
//      "a key newly down" for the repeat rule of 14.3 (so the old repeat skips that frame).
//  R3. Injection into K_GETEV from the ring: the frame ISR may fall before or after the instruction that reads K_RTAIL / K_RHEAD, so the
//      result must equal one of two models: "the ISR first, then K_GETEV" or "K_GETEV first, then the ISR" (K_RHEAD advanced or not at the
//      moment the ISR tests tail - head; this decides coalescing and the empty ring).  K_GETEV from the posted queue and K_POST are
//      deterministic (the ISR never touches the posted queue).
//  R4. Pointer tests with the ISR moving it: PT_LOCK (named in 14.5 / section 7) is read at the instant of the injection to tell the model
//      whether P_ISRMOVE is refused.  P_ISRMOVE's direct test pokes PT_LOCK = 1 to hold the lock.
//  R5. The frame ISR's stack (return address included) is measured by the SP minimum and by poisoning $FB00-$FEFD; K_POLL's allowance
//      (20 bytes below its return address) by poisoning a direct call.
//  R6. An E_MOVE's data 3 bit 1 is the button AFTER step 6 (14.3), so an E_MOVE of the frame in which fire goes down already carries 1.
import { checks, M, Z, FRAME_T } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, hex, rd16, w16, PRESERVED, ALL_REGS, seedDisplay, setGA, PTR_AREA, GUARD_T } from './gfx6-lib.mjs';
import { armStack, stackUsed } from './kern-lib.mjs';
import { QUIRK, K2Model, E, KEY_NAMES, loadKeymap, keymapBytes, rowsOf, joyOf } from './kern-model2.mjs';
import { ROOT } from '../tools/build.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const REPS = argVal('--reps', 3), STRIDE = Math.max(1, argVal('--stride', 1)), FUZZ = argVal('--fuzz', 800), POLLS = argVal('--polls', 3000), FLICKER = argVal('--flicker', 400);
const MAXFAIL = argVal('--maxfail', 25);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
if (argv.includes('--quirk-seqclamp')) QUIRK.seqClampY = true;     // debugging aid: model the K_POLL fault 'y clamped between adding down and subtracting up' to see what else fails
console.log(`seed ${SEED} (rerun with --seed ${SEED}); injection stride ${STRIDE}, ${REPS} scenarios a case, ${FUZZ} fuzz frames, ${POLLS} poll steps, ${FLICKER} flicker frames`);

const C = checks('kern K2');
const NEED = ['K_POLL', 'K_WARP', 'K_GETEV', 'K_POST', 'P_ISRMOVE', 'KEYMAP', 'T_ISRP', 'T_POLLD', 'T_EVLOOP', 'T_EVLOG', 'T_EVN', 'K_RING', 'K_POSTQ',
  'K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST', 'K_AYREG', 'K_EV', 'K_PX', 'K_PY', 'K_BTN', 'K_KPMODE', 'K_CAPS', 'K_CODE', 'K_CODE_END', 'T_IDLE', 'T_RET',
  'V_FRAMES', 'V_SHADOW_F4', 'RESULT', 'P_INIT', 'P_ISR', 'P_ARROW', 'P_SHIELD', 'P_UNSHIELD', 'G_FILL', 'G_SETOP', 'G_INIT', 'GA', 'GOP', 'GLH', 'GCLIP', 'PT_LOCK', 'PT_DIRTY'];
const ctx = start(C, NEED, 'kern3');
if (!ctx) { console.log('the kern3 cartridge (with the K2 symbols) is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const fmt = (n) => n.toLocaleString('en-US');
const KM = loadKeymap(ROOT);
const KIDX = (name) => KEY_NAMES.indexOf(name);
const arrow = Uint8Array.from({ length: 64 }, (_, i) => m.bus.read(S.P_ARROW + i));
let N = 0;                                                       // every individual assertion

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < 5) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  get bad() { return this.nf >= MAXFAIL; }
  end() { C.check(`${this.name}: ${fmt(this.n)} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}

// ---------------------------------------------------------------------------------------------------------------------------
// CPU / frame helpers
const step1 = () => Z.runZ80(cpu, m.bus, 1, m);
const frameCount = () => rd16(m, S.V_FRAMES);
const accepted = () => cpu.pc === 0x38;                          // an accepted frame interrupt is pending (gfx6-s4 R7)
const rd8 = (a) => m.ram[a];
const zeroPtr = () => m.ram.fill(0, PTR_AREA[0], PTR_AREA[1] + 1);
const setInput = (rows, joy) => { for (let r = 0; r < 8; r++) m.keyMatrix[r] = rows[r]; m.joystick[0] = joy; };
const IDLE_ROWS = rowsOf([]);
const asJoy = (j) => (typeof j === 'string' ? joyOf(j) : (j ?? 0xFF));

const FS = { stress: [], kMax: 0, kMaxWhat: '', isrT: [], offs: [], kpollT: [], kpollDepth: 0, isrDepth: 0, poisonDepth: 0, vErr: 0, lostIrq: 0, frames: 0 };
/** Run the pending (accepted) frame interrupt to its RET: { t, offIsrp (frame offset at T_ISRP), kpollT (T_ISRP to T_POLLD), isrDepth, kDepth }. */
function runIsr(limit = 400000) {
  const sp0 = cpu.sp + 2, ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8), t0 = m.tstates;
  let offIsrp = -1, tIsrp = 0, tPolld = 0, spIsrp = 0, minSp = cpu.sp, kMin = 65536, steps = 0;
  while (!(cpu.pc === ret && cpu.sp === sp0)) {
    if (cpu.pc === S.T_ISRP && offIsrp < 0) { offIsrp = m.tstates - m.frameStart; tIsrp = m.tstates; spIsrp = cpu.sp; }
    if (cpu.pc === S.T_POLLD && tPolld === 0) tPolld = m.tstates;
    step1();
    if (cpu.sp < minSp) minSp = cpu.sp;
    if (offIsrp >= 0 && tPolld === 0 && cpu.sp < kMin) kMin = cpu.sp;
    if (++steps > limit) throw new Error(`the frame ISR did not return (PC ${hex(cpu.pc)}, SP ${hex(cpu.sp)}) after ${steps} instructions`);
  }
  return { t: m.tstates - t0, offIsrp, kpollT: tPolld - tIsrp, isrDepth: sp0 - minSp, kDepth: kMin === 65536 ? 0 : spIsrp - 2 - kMin, steps };
}
const finishPending = () => { if (accepted()) runIsr(); };
function parkIdle() { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_IDLE; }
function parkLoop() { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_EVLOOP; }
/** Raise the frame interrupt at the current instruction boundary and run the ISR to its return (interrupts must be on).  null when refused. */
function isrNow() {
  const pc0 = cpu.pc, sp0 = cpu.sp, t = Z.irqZ80(cpu, m.bus);
  if (!t) return null;
  m.tstates += t;
  let g = 0;
  while (!(cpu.pc === pc0 && cpu.sp === sp0)) { step1(); if (++g > 400000) throw new Error(`the frame ISR did not return (PC ${hex(cpu.pc)})`); }
  return g;
}
/**
 * After long direct calls the machine's clock runs ahead of its frame counter and runFrame spends whole frames catching up without running the
 * CPU (gfx6-s4 settle).  Run those parked, then one frame at T_EVLOOP: its end leaves the next frame interrupt pending (accepted).
 */
function prime() {
  for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { parkLoop(); M.runFrame(m); }
  parkLoop(); M.runFrame(m);
  if (!accepted()) throw new Error(`prime: no frame interrupt pending (PC ${hex(cpu.pc)})`);
}
const direct = (name, regs = {}, ga = null, o = {}) => { if (ga) setGA(m, S, ...ga); return call(m, S, name, regs, { rng, ...o }); };

// ---------------------------------------------------------------------------------------------------------------------------
// The kernel model and the display model.
let K = null;                                                    // K2Model, in step with the machine
let scr = null, pm = null;                                       // Gfx6Model (the screen without the pointer), PointerModel
const resetPm = () => { scr = new G.Gfx6Model(); scr.loadRam(m.ram); pm = new G.PointerModel(scr, arrow); };

/** The name of an interface address, for failure messages. */
function nameOf(a) {
  if (a >= S.K_RING && a < S.K_RING + 64) return `K_RING[${a - S.K_RING}] (record ${(a - S.K_RING) >> 2} byte ${(a - S.K_RING) & 3})`;
  if (a >= S.K_POSTQ && a < S.K_POSTQ + 16) return `K_POSTQ[${a - S.K_POSTQ}] (record ${(a - S.K_POSTQ) >> 2} byte ${(a - S.K_POSTQ) & 3})`;
  for (const n of ['K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST', 'K_PY', 'K_BTN', 'K_KPMODE', 'K_CAPS']) if (a === S[n]) return n;
  if (a === S.K_PX || a === S.K_PX + 1) return `K_PX+${a - S.K_PX}`;
  if (a >= S.K_EV && a < S.K_EV + 4) return `K_EV+${a - S.K_EV}`;
  return hex(a);
}
/** null when every interface variable of the machine equals the model's, else a text of the first differences. */
function ifaceDiff(model) {
  const d = [];
  for (const [a, v] of model.ifaceBytes(S)) if (m.ram[a] !== v) d.push(`${nameOf(a)} = ${m.ram[a]}, model ${v}`);
  return d.length ? `${d.length} variable byte(s) differ: ${d.slice(0, 4).join('; ')}` : null;
}
/** After a reported mismatch: take the machine's 14.1 variables into the model so one fault does not cascade into every later check. */
function resync() { K.loadIface(m.ram, S); if (pm) pm.move(K.px, K.py); }
/** null when the display bytes in RAM equal the pointer model's display, else a text. */
function displayDiff(p = pm) {
  const want = p.displayBytes(), d = G.compareBytes(m.ram, want);
  if (!d) return null;
  const off = d.addr & 0x1FFF, y = ((off >> 11) & 3) * 64 + ((off >> 5) & 7) * 8 + ((off >> 8) & 7), bc = (off & 31) * 2 + (d.addr >= 0x6000 ? 1 : 0);
  return `display byte (column ${bc}, row ${y}) at ${hex(d.addr)} = ${hex(d.got, 2)}, model ${hex(d.want, 2)} (pointer model: position (${p.pos.x}, ${p.pos.y}), drawn ${p.D ? `(${p.D.x}, ${p.D.y})` : 'no'})`;
}

/** Whole-RAM comparison ($4000-$FFFF) with the model's changes applied, leaving out the scratch, the poll state and the stack. */
const RAM_RANGES = [[0x4000, 0xF077], [0xF080, 0xF08F], [0xF0C0, 0xFDFF], [0xFF00, 0xFFFF]];
function ramDiff(want) {
  for (const [lo, hi] of RAM_RANGES) {
    if (Buffer.from(m.ram.buffer, m.ram.byteOffset + lo, hi - lo + 1).compare(Buffer.from(want.buffer, want.byteOffset + lo, hi - lo + 1)) === 0) continue;
    for (let a = lo; a <= hi; a++) if (m.ram[a] !== want[a]) return `RAM ${hex(a)} (${nameOf(a)}) = ${m.ram[a]}, expected ${want[a]}`;
  }
  return null;
}
const ixiyAlt = (res) => PRESERVED.filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`);
const carry = (res) => res.regs.f & 1;

// ---------------------------------------------------------------------------------------------------------------------------
// Scenes: a quiet machine with the pointer drawn and the model in step.
/** Idle input, a few ISRs to release everything, drain the queues, and build the model from the machine. */
function quiesce() {
  finishPending();
  setInput(IDLE_ROWS, 0xFF); parkIdle();
  if (rd8(S.K_KPMODE)) { setInput(rowsOf([0, 36]), 0xFF); isrNow(); setInput(IDLE_ROWS, 0xFF); isrNow(); }
  if (rd8(S.K_CAPS)) { setInput(rowsOf([0, KIDX('2')]), 0xFF); isrNow(); setInput(IDLE_ROWS, 0xFF); isrNow(); }
  m.ram[S.PT_LOCK] = 0;
  for (let i = 0; i < 4; i++) isrNow();
  m.ram[S.K_LOST] = 0;                                           // (the injection tests leave random bytes in the queue variables)
  for (let g = 0; g < 100; g++) { const r = call(m, S, 'K_GETEV', {}, { rng, ints: true }); if (carry(r)) break; }
  K = new K2Model(KM).loadIface(m.ram, S).idlePoll();
  m.ram.fill(0, S.T_EVN, S.T_EVN + 2); evnSeen = 0;
}
/** A blank display with the pointer drawn at the input's position (P_INIT again after zeroing the pointer area). */
function blankScene() {
  quiesce();
  zeroPtr(); m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
  direct('G_INIT'); m.ram[S.GLH] = 8;
  resetPm();                                                     // the screen without the pointer
  direct('P_INIT', { hl: K.px, de: K.py });
  direct('P_ISR');
  pm.init(K.px, K.py); pm.isr();
  const d = displayDiff();
  if (d) throw new Error(`blankScene: the pointer drawn by P_INIT + P_ISR differs from the model: ${d}`);
}
let evnSeen = 0;
function readLog() {
  const n = rd16(m, S.T_EVN), cnt = (n - evnSeen) & 0xFFFF, out = [];
  for (let i = 0; i < cnt; i++) { const a = S.T_EVLOG + 4 * ((evnSeen + i) & 511); out.push([m.ram[a], m.ram[a + 1], m.ram[a + 2], m.ram[a + 3]]); }
  evnSeen = n;
  return out;
}
const evText = (list) => list.map((e) => `[${e.join(',')}]`).join(' ');

// ===========================================================================================================================
// Part 0: the spec's data: arrow, key map, boot state
function part0() {
  const sec = new Sec('boot and data');
  // 14.6: the arrow
  const ART = ['##o.............', '###o............', '####o...........', '#####oo.........', '#######o........', '########oo......', '##########o.....', '###########o....',
    '#####ooooooo....', '##o###o.........', '#oo###o.........', 'o.oo###o........', '...o###o........', '....o###o.......', '....ooooo.......', '................'];
  const want = G.arrowFromArt(ART);
  sec.ok(want.every((v, i) => arrow[i] === v), () => `P_ARROW differs from 14.6's art at byte ${want.findIndex((v, i) => arrow[i] !== v)}: ${hex(arrow[want.findIndex((v, i) => arrow[i] !== v)], 2)}, want ${hex(want[want.findIndex((v, i) => arrow[i] !== v)], 2)}`);
  sec.ok(ART.slice(0, 11).every((r) => r[0] === '#') && ART[0][1] === '#', '14.6 / section 7: the art itself has ink at (0, 0), column 0 ink for rows 0-10, row 0 ink at columns 0-1');
  // 14.4: KEYMAP in the image equals keymap.txt
  const km = keymapBytes(KM);
  const got = Array.from({ length: 120 }, (_, i) => m.bus.read(S.KEYMAP + i));
  sec.ok(km.every((v, i) => got[i] === v), () => `KEYMAP differs from keymap.txt at index ${km.findIndex((v, i) => got[i] !== v)} (plane ${Math.floor(km.findIndex((v, i) => got[i] !== v) / 40)}, key ${KEY_NAMES[km.findIndex((v, i) => got[i] !== v) % 40]}): ${got[km.findIndex((v, i) => got[i] !== v)]}, want ${km[km.findIndex((v, i) => got[i] !== v)]}`);
  // 14.1: boot state (the state right after the boot, before any test touched it)
  const z = ['K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST', 'K_AYREG', 'K_BTN', 'K_KPMODE', 'K_CAPS'];
  sec.ok(z.every((n) => rd8(S[n]) === 0), () => `boot: ${z.filter((n) => rd8(S[n]) !== 0).map((n) => `${n} = ${rd8(S[n])}`).join(', ')} (14.1: 0)`);
  sec.ok(rd16(m, S.K_PX) === 256 && rd8(S.K_PY) === 96, () => `boot: K_PX ${rd16(m, S.K_PX)}, K_PY ${rd8(S.K_PY)} (14.7: 256, 96)`);
  sec.ok(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4)).every((v) => v === 0) && Array.from(m.ram.subarray(S.K_RING, S.K_RING + 80)).every((v) => v === 0), 'boot: K_RING, K_POSTQ and K_EV are 0 (14.1: everything else 0)');
  sec.ok(S.K_RING === 0xF000 && S.K_POSTQ === 0xF040 && S.K_RHEAD === 0xF080 && S.K_RTAIL === 0xF081 && S.K_PHEAD === 0xF082 && S.K_PN === 0xF083 && S.K_LOST === 0xF084
    && S.K_AYREG === 0xF085 && S.K_EV === 0xF086 && S.K_PX === 0xF08A && S.K_PY === 0xF08C && S.K_BTN === 0xF08D && S.K_KPMODE === 0xF08E && S.K_CAPS === 0xF08F, 'the symbol addresses of 14.1');
  sec.ok(S.T_ISRP === 0x1C1 || S.T_ISRP < S.T_POLLD, 'T_ISRP precedes T_POLLD (14.7)');
  sec.end();
}

// ===========================================================================================================================
// Part 1: test 3, direct K_GETEV / K_POST over every queue state
/** Make the queue state of the model (random record bytes everywhere) and write it to the machine. */
function setQueue(model, { pn = 0, phead = 0, ringN = 0, rhead = 0, lastMove = false, lost = null }) {
  for (let i = 0; i < 64; i++) model.ring[i] = rng.byte();
  for (let i = 0; i < 16; i++) model.postq[i] = rng.byte();
  model.ev = [rng.byte(), rng.byte(), rng.byte(), rng.byte()];
  model.pn = pn; model.phead = phead; model.rhead = rhead; model.rtail = (rhead + 4 * ringN) & 0xFF; model.lost = lost ?? rng.byte();
  if (lastMove && ringN > 0) model.ring[(model.rtail - 4) & 0x3F] = E.MOVE;
  model.storeIface(m.ram, S);
}
function part1() {
  const sec = new Sec('test 3a, direct K_GETEV / K_POST / K_WARP over every queue state');
  blankScene();
  const HEADS = [0, 4, 60, 64, 128, 192, 244, 252];
  let calls = 0, empties = 0, fromPosted = 0, fromRing = 0;
  // K_GETEV: posted 0-4 x posted head 0-3 x ring 0-16 x several free-running heads (both wrapping)
  for (let pn = 0; pn <= 4; pn++) for (let phead = 0; phead < 4; phead++) for (let ringN = 0; ringN <= 16; ringN++) for (const rh of [...HEADS.slice(0, 3 + (ringN & 3)), 4 * rng.int(0, 63)]) {
    if (sec.bad) break;
    const mod = K.clone();
    setQueue(mod, { pn, phead, ringN, rhead: rh });
    const before = m.ram.slice();
    const res = call(m, S, 'K_GETEV', {}, { rng, ints: true });
    const exp = mod.getev();
    const where = `pn ${pn} phead ${phead} ring ${ringN} head ${rh}`;
    calls++;
    sec.ok(carry(res) === exp.carry, () => `K_GETEV (${where}): carry ${carry(res)}, model ${exp.carry}`);
    if (!exp.carry) sec.ok(res.regs.a === exp.a, () => `K_GETEV (${where}): A = ${res.regs.a}, the event's type is ${exp.a}`);
    exp.carry ? empties++ : (pn > 0 ? fromPosted++ : fromRing++);
    const w = before.slice(); mod.storeIface(w, S);
    const d = ramDiff(w); sec.ok(d === null, () => `K_GETEV (${where}): ${d} (14.2: writes K_EV, K_PHEAD, K_PN or K_RHEAD only)`);
    const ch = ixiyAlt(res); sec.ok(ch.length === 0, () => `K_GETEV: changed ${ch.join(', ')} (section 5: IX, IY, alternate set preserved)`);
    sec.ok(res.maxDiRun === 0 && res.iff1 === true && res.sp === 0xFF00, () => `K_GETEV: DI for ${res.maxDiRun} T / iff1 ${res.iff1} / SP ${hex(res.sp)} (no DI, SP restored)`);
  }
  // K_POST: posted 0-4 x head 0-3, with a ring in some state; BC and DE are not clobbered
  for (let pn = 0; pn <= 4; pn++) for (let phead = 0; phead < 4; phead++) for (let rep = 0; rep < 3; rep++) {
    const mod = K.clone();
    setQueue(mod, { pn, phead, ringN: rng.int(0, 16), rhead: 4 * rng.int(0, 63) });
    const before = m.ram.slice(), type = rng.pick([1, 6, 7, 8, 16, 255, rng.byte()]), c = rng.byte(), e = rng.byte(), d = rng.byte();
    const res = call(m, S, 'K_POST', { a: type, c, e, d }, { rng, ints: true });
    const cy = mod.post(type, c, e, d);
    const where = `pn ${pn} phead ${phead}`;
    sec.ok(carry(res) === cy, () => `K_POST (${where}): carry ${carry(res)}, model ${cy} (set when the queue is full)`);
    const w = before.slice(); mod.storeIface(w, S);
    const df = ramDiff(w); sec.ok(df === null, () => `K_POST (${where}): ${df}`);
    const ch = [...ixiyAlt(res), ...['b', 'c', 'd', 'e'].filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`)];
    sec.ok(ch.length === 0, () => `K_POST: changed ${ch.join(', ')} (14.5 / section 5: clobbers only AF, HL)`);
    sec.ok(res.maxDiRun === 0 && res.iff1 === true && res.sp === 0xFF00, () => `K_POST: DI for ${res.maxDiRun} T / iff1 ${res.iff1} / SP ${hex(res.sp)}`);
    calls++;
  }
  // posted before ring: the order of a mixed drain, through K_POST and K_GETEV calls only
  {
    const mod = K.clone();
    setQueue(mod, { pn: 0, ringN: 5, rhead: 252 });
    const ringRecs = mod.queued();
    const posts = [[16, 1, 2, 3], [6, 0, 0, 0], [200, 9, 9, 9]];
    for (const p of posts) { const res = call(m, S, 'K_POST', { a: p[0], c: p[1], e: p[2], d: p[3] }, { rng, ints: true }); sec.ok(carry(res) === 0, 'K_POST into an empty queue'); mod.post(...p); }
    const got = [];
    for (let g = 0; g < 20; g++) { const r = call(m, S, 'K_GETEV', {}, { rng, ints: true }); if (carry(r)) break; got.push(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))); }
    sec.ok(JSON.stringify(got) === JSON.stringify([...posts, ...ringRecs]), () => `drain order: ${evText(got)}, want the 3 posted records first then the 5 ring records: ${evText([...posts, ...ringRecs])} (14.2 / section 5)`);
  }
  // K_WARP: clamps (signed words); nothing observable changes until the next K_POLL; clobbers only AF, HL
  for (let i = 0; i < 80 && !sec.bad; i++) {
    const mod = K.clone(); setQueue(mod, { ringN: rng.int(0, 3), rhead: 4 * rng.int(0, 63) });
    const before = m.ram.slice();
    const x = rng.pick([0, 511, 512, 513, 1000, 32767, 0x8000, 65535, 65280, rng.int(0, 511), rng.int(0, 65535), -1, -32768]) & 0xFFFF;
    const y = rng.pick([0, 191, 192, 255, 256, 32767, 0x8000, 65535, rng.int(0, 191), rng.int(0, 65535), -1]) & 0xFFFF;
    const res = call(m, S, 'K_WARP', { hl: x, de: y }, { rng, ints: true });
    const df = ramDiff(before); sec.ok(df === null, () => `K_WARP (${x}, ${y}): ${df} (no variable of 14.1 changes before the next K_POLL)`);
    const ch = [...ixiyAlt(res), ...['b', 'c', 'd', 'e'].filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`)];
    sec.ok(ch.length === 0, () => `K_WARP: changed ${ch.join(', ')} (14.5: clobbers only AF, HL)`);
    sec.ok(res.maxDiRun === 0 && res.iff1 === true && res.sp === 0xFF00, () => `K_WARP: DI for ${res.maxDiRun} T / iff1 ${res.iff1}`);
    calls++;
    // the next poll takes it: one idle poll through the real ISR; clamped, no event
    mod.warp(x, y); setInput(IDLE_ROWS, 0xFF); parkIdle();
    const pr = mod.poll(IDLE_ROWS, 0xFF, false);
    isrNow();
    const d2 = ifaceDiff(mod); sec.ok(d2 === null, () => `after K_WARP (${x}, ${y}) and one ISR: ${d2}; K_PX/K_PY must be the clamped (${mod.px}, ${mod.py}) and no event (14.5)`);
    sec.ok(pr.appended.length === 0 && pr.isrMove && pr.isrMove.x === mod.px, 'model: the warp makes no event');
  }
  quiesce();
  sec.end();
  console.log(`  K_GETEV direct calls: ${calls} (${empties} empty, ${fromPosted} from the posted queue, ${fromRing} from the ring)`);
}

// ===========================================================================================================================
// Part 2: test 3, interrupt injection into K_GETEV / K_POST
const REG8 = ALL_REGS;
const ISR_INPUTS = {
  key: { rows: rowsOf([KIDX('A')]), joy: 0xFF, label: 'a new key (E_KEY)' },
  move: { rows: IDLE_ROWS, joy: joyOf('r'), label: 'joystick right (E_MOVE, coalescing)' },
  movefire: { rows: IDLE_ROWS, joy: joyOf('rf'), label: 'right + fire (E_MOVE, E_DOWN)' },
  many: { rows: rowsOf([KIDX('A'), KIDX('S'), KIDX('D')]), joy: joyOf('lf'), label: 'three keys + left + fire (5 events)' },
  mode: { rows: rowsOf([0, 36]), joy: 0xFF, label: 'CS + SS (E_MODE)' },
};
/**
 * Run `name` (with regs) with interrupts on; raise the frame interrupt before instruction k (k < 0: never).  Returns { steps, error, regs }
 * (registers at the return).  The registers not named get random values.
 */
function runInj(name, regs, k) {
  for (const r of REG8) cpu[r] = rng.byte();
  for (const [r, v] of Object.entries(regs)) { if (r === 'hl') { cpu.h = (v >> 8) & 0xFF; cpu.l = v & 0xFF; } else if (r === 'de') { cpu.d = (v >> 8) & 0xFF; cpu.e = v & 0xFF; } else cpu[r] = v; }
  const regsIn = {}; for (const r of REG8) regsIn[r] = cpu[r];
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true;
  cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8;
  cpu.pc = S[name];
  let g = 0, injected = false, lockAtInj = 0, guard = 0;
  while (cpu.pc !== S.T_RET) {
    if (g === k && !injected) {
      injected = true; lockAtInj = rd8(S.PT_LOCK);
      const r = isrNow();
      if (r === null) return { steps: g, error: `the interrupt was refused before instruction ${k} of ${name}: interrupts were off inside it (no DI allowed)` };
    }
    step1(); g++;
    if (++guard > 2_000_000) return { steps: g, error: `${name} did not return (PC ${hex(cpu.pc)})` };
  }
  const out = {}; for (const r of REG8) out[r] = cpu[r];
  return { steps: g, error: null, regs: out, regsIn, lockAtInj };
}
function drainMachine() {
  const out = [];
  for (let g = 0; g < 40; g++) { const r = call(m, S, 'K_GETEV', {}, { rng, ints: true }); if (carry(r)) break; out.push(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))); }
  return out;
}
function part2() {
  const sec = new Sec('test 3b, interrupt injection at every instruction boundary of K_GETEV and K_POST');
  blankScene();
  let trials = 0, scenarios = 0, boundaries = 0, firstWins = 0, secondWins = 0, both = 0;
  const modes = {};
  /** One scenario: queue state q, ISR input, routine.  Returns nothing; failures go to sec. */
  function scenario(routine, q, inp, regs) {
    scenarios++;
    quiesce();                                                   // the previous scenario left keys 'down' in K_POLL's state
    const pre = K.clone(); setQueue(pre, q);
    const snapRam = m.ram.slice(), snapCpu = { ...cpu }, snapT = m.tstates;
    const restore = () => { m.ram.set(snapRam); Object.assign(cpu, snapCpu); m.tstates = snapT; };
    const desc = `${routine} pn ${q.pn} phead ${q.phead} ring ${q.ringN} head ${q.rhead}${q.lastMove ? ' last=MOVE' : ''}, ISR sees ${inp.label}`;
    // candidates (R3)
    const cand = [];
    const A = pre.clone(); A.poll(inp.rows, inp.joy, false); const rA = routine === 'K_GETEV' ? A.getev() : { carry: A.post(regs.a, regs.c, regs.e, regs.d) };
    cand.push({ name: 'ISR first', model: A, r: rA });
    const B = pre.clone(); const rB = routine === 'K_GETEV' ? B.getev() : { carry: B.post(regs.a, regs.c, regs.e, regs.d) }; B.poll(inp.rows, inp.joy, false);
    cand.push({ name: 'routine first', model: B, r: rB });
    // baseline, no interrupt: the routine alone
    setInput(inp.rows, inp.joy);
    const base = runInj(routine, regs, -1);
    const bm = pre.clone(); const rb = routine === 'K_GETEV' ? bm.getev() : { carry: bm.post(regs.a, regs.c, regs.e, regs.d) };
    const bd = ifaceDiff(bm);
    if (base.error || bd || (base.regs.f & 1) !== rb.carry) { sec.ok(false, `${desc} WITHOUT an interrupt: ${base.error || bd || `carry ${base.regs.f & 1}, model ${rb.carry}`}`); return; }
    const n = base.steps;
    boundaries += Math.ceil(n / STRIDE);
    for (let k = 0; k < n; k += STRIDE) {
      restore(); setInput(inp.rows, inp.joy);
      const f0 = frameCount();
      const res = runInj(routine, regs, k);
      trials++;
      if (res.error) { sec.ok(false, `${desc}, interrupt before instruction ${k} of ${n}: ${res.error}`); if (sec.bad) return; continue; }
      const probs = [];
      if (((frameCount() - f0) & 0xFFFF) !== 1) probs.push(`V_FRAMES rose by ${(frameCount() - f0) & 0xFFFF}, want 1`);
      const ch = PRESERVED.filter((r) => res.regs[r] !== res.regsIn[r]); if (ch.length) probs.push(`not preserved: ${ch.join(', ')} (the ISR or the routine)`);
      if (routine === 'K_POST') { const c2 = ['b', 'c', 'd', 'e'].filter((r) => res.regs[r] !== res.regsIn[r]); if (c2.length) probs.push(`K_POST changed ${c2.join(', ')}`); }
      // match one candidate on every interface byte, the carry and (K_GETEV) the type in A
      let match = null; const why = [], hits = [];
      for (const c of cand) {
        const dif = ifaceDiff(c.model);
        const rOk = (res.regs.f & 1) === c.r.carry && (routine !== 'K_GETEV' || c.r.carry || res.regs.a === c.r.a);
        if (!dif && rOk) { hits.push(c.name); if (!match) match = c; }
        else why.push(`${c.name}: ${dif || `carry ${res.regs.f & 1} / A ${res.regs.a} vs model ${c.r.carry} / ${c.r.a}`}`);
      }
      const ib0 = cand[0].model.ifaceBytes(S), ib1 = cand[1].model.ifaceBytes(S);
      const distinct = ib0.some(([, v], i) => ib1[i][1] !== v) || cand[0].r.carry !== cand[1].r.carry || cand[0].r.a !== cand[1].r.a;
      if (match) { const key = distinct ? `only "${hits.join('')}"` : 'candidates equal'; modes[key] = (modes[key] || 0) + 1; }
      if (!match) probs.push(`matches neither "ISR first" nor "routine first": ${why.join(' || ')}`);
      else {
        // drain: no event lost, duplicated, torn or reordered
        const got = drainMachine(), want = match.model.clone().drain();
        if (JSON.stringify(got) !== JSON.stringify(want)) probs.push(`drain gave ${evText(got)}, model ${evText(want)}`);
      }
      sec.ok(probs.length === 0, () => `${desc}, interrupt before instruction ${k} of ${n}: ${probs.join('; ')}`);
      if (sec.bad) return;
    }
  }
  const pick = (a) => rng.pick(a);
  const HEADS = [0, 60, 124, 244, 252];
  const gcases = [];
  for (const ringN of [0, 1, 2, 3, 15, 16]) for (const lastMove of [false, true]) {
    if (ringN === 0 && lastMove) continue;
    gcases.push({ pn: 0, phead: 0, ringN, lastMove });
  }
  for (const pn of [1, 2, 4]) for (const ringN of [0, 2, 16]) gcases.push({ pn, phead: rng.int(0, 3), ringN, lastMove: ringN > 0 && rng.chance(0.5) });
  for (const c of gcases) for (let rep = 0; rep < REPS && !sec.bad; rep++) {
    const inp = c.lastMove ? pick([ISR_INPUTS.move, ISR_INPUTS.move, ISR_INPUTS.movefire]) : pick(Object.values(ISR_INPUTS));
    scenario('K_GETEV', { ...c, phead: c.phead ?? 0, rhead: pick(HEADS) }, inp, {});
  }
  // K_POST: every posted state, the ISR input varied
  for (let pn = 0; pn <= 4; pn++) for (let phead = 0; phead < 4; phead += (pn === 4 ? 1 : 2)) for (let rep = 0; rep < REPS && !sec.bad; rep++) {
    const ringN = pick([0, 2, 15, 16]), lm = ringN > 0 && rng.chance(0.5);
    scenario('K_POST', { pn, phead, ringN, rhead: pick(HEADS), lastMove: lm }, lm ? pick([ISR_INPUTS.move, ISR_INPUTS.movefire]) : pick(Object.values(ISR_INPUTS)),
      { a: pick([6, 16, 99]), c: rng.byte(), e: rng.byte(), d: rng.byte() });
  }
  setInput(IDLE_ROWS, 0xFF);
  quiesce();
  sec.end();
  console.log(`  ${scenarios} scenarios, ${fmt(boundaries)} instruction boundaries, ${fmt(trials)} interrupted runs; candidates matched: ${JSON.stringify(modes)}`);
  C.check(`injection ran: both routines, ${scenarios} scenarios, ${fmt(trials)} interrupted runs`, scenarios >= 40 && trials > 500, `${scenarios} scenarios`);
}

// ===========================================================================================================================
// Part 3: direct K_POLL (queue behaviour under K_POLL, ring full, coalescing, fuzz), P_ISRMOVE, stack
let pollMaxStack = 0, pollMaxStackWhat = '';
/** One direct K_POLL against the model, then P_ISR and the display; optionally with PT_LOCK held.  Returns the model's poll result. */
function pollStep(sec, rows, joy, { lock = false, what = '', display = true } = {}) {
  setInput(rows, joy);
  if (lock) m.ram[S.PT_LOCK] = 1;
  const pat = (N & 1) ? 0x55 : 0xAA;
  armStack(m, pat);
  const res = call(m, S, 'K_POLL', {}, { rng, ints: false });
  const used = stackUsed(m, pat);
  if (used > pollMaxStack) { pollMaxStack = used; pollMaxStackWhat = what; }
  m.ram[S.PT_LOCK] = 0;
  const pr = K.poll(rows, joy, lock);
  const ch = ixiyAlt(res);
  sec.ok(ch.length === 0, () => `K_POLL (${what}): changed ${ch.join(', ')} (section 5: IX, IY, alternates preserved)`);
  sec.ok(res.sp === 0xFF00, () => `K_POLL (${what}): SP ${hex(res.sp)} after the return`);
  sec.ok(used <= 20, () => `K_POLL (${what}): used ${used} bytes of stack below its return address (14.5: at most 20)`);
  const d = ifaceDiff(K);
  sec.ok(d === null, () => `K_POLL (${what}) rows [${rows.map((r) => r.toString(16)).join(' ')}] joy ${hex(joy, 2)}${lock ? ' lock' : ''}: ${d}; model appended ${pr.appended.map((a) => `[${a.rec}] ${a.how}`).join(' ')}`);
  if (pr.isrMove) pm.move(pr.isrMove.x, pr.isrMove.y);
  if (d) resync();
  if (display) {
    direct('P_ISR'); pm.isr();
    const dd = displayDiff(); sec.ok(dd === null, () => `after K_POLL (${what}) and P_ISR: ${dd}`);
  }
  return pr;
}
function part3() {
  const sec = new Sec('test 3c, direct K_POLL: queue behaviour, ring full, coalescing, P_ISRMOVE, random steps');
  blankScene();
  const fire = (on) => (on ? joyOf('f') : 0xFF);
  // (a) one event a call: fire toggles.  16 fit, the 17th is dropped and K_LOST = 1, saturating at 255; nothing else changes
  for (let i = 0; i < 16; i++) pollStep(sec, IDLE_ROWS, fire(i & 1 ? false : true), { what: `fill ${i}`, display: false });
  sec.ok(K.count === 16 && K.lost === 0 && rd8(S.K_LOST) === 0, '16 events fit in the ring (14.1: all 16 records usable), K_LOST 0');
  pollStep(sec, IDLE_ROWS, fire(true), { what: 'the 17th event', display: false });
  sec.ok(rd8(S.K_LOST) === 1 && (rd8(S.K_RTAIL) - rd8(S.K_RHEAD)) === 64 && rd8(S.K_BTN) === 1, () => `17th event: K_LOST ${rd8(S.K_LOST)} (want 1), tail - head ${(rd8(S.K_RTAIL) - rd8(S.K_RHEAD)) & 255} (want 64), K_BTN ${rd8(S.K_BTN)} (the button state still follows)`);
  for (let i = 0; i < 290 && !sec.bad; i++) pollStep(sec, IDLE_ROWS, fire(i & 1 ? false : true), { what: `saturating ${i}`, display: false });
  sec.ok(rd8(S.K_LOST) === 255, () => `K_LOST after 290 more dropped events = ${rd8(S.K_LOST)} (14.1: saturating at 255)`);
  // the oldest 16 are intact and in order
  { const got = drainMachine(); const want = K.clone().drain(); sec.ok(got.length === 16 && JSON.stringify(got) === JSON.stringify(want), () => `after overflow the 16 oldest events drain intact: ${evText(got.slice(0, 4))}...`); K.drain(); }
  sec.ok(ifaceDiff(K) === null, 'after the drain the variables equal the model');
  // (b) coalescing: moves overwrite the last record when it is an E_MOVE and not the head; a full ring ending in a move coalesces too (R1)
  pollStep(sec, IDLE_ROWS, joyOf('r'), { what: 'move 1 (ring empty: appended)', display: false });
  pollStep(sec, IDLE_ROWS, joyOf('r'), { what: 'move 2 (the last is the head: appended)', display: false });
  for (let i = 0; i < 5; i++) pollStep(sec, IDLE_ROWS, joyOf('r'), { what: `move ${3 + i} (coalesced)`, display: false });
  sec.ok(K.count === 2, 'model: two E_MOVE records only (the first is the head, the rest coalesced into the second)');
  pollStep(sec, IDLE_ROWS, joyOf('rf'), { what: 'move + DOWN', display: false });
  pollStep(sec, IDLE_ROWS, joyOf('r'), { what: 'move + UP', display: false });
  for (let i = 0; i < 12; i++) pollStep(sec, IDLE_ROWS, joyOf(i & 1 ? 'f' : ''), { what: `fill up ${i}`, display: false });     // buttons: more records, no moves
  pollStep(sec, IDLE_ROWS, joyOf('r'), { what: 'a move (appends to a nearly full ring)', display: false });
  pollStep(sec, IDLE_ROWS, joyOf('rf'), { what: 'move coalesces into a full ring / DOWN is lost', display: false });
  pollStep(sec, IDLE_ROWS, joyOf('r'), { what: 'move into a full ring', display: false });
  K.drain(); drainMachine();
  sec.ok(ifaceDiff(K) === null, 'drained: variables equal the model');
  quiesce(); blankScene();

  // (c) P_ISRMOVE direct (14.5): unlocked sets the position (carry clear), locked refuses (carry set, pointer area unchanged); AF only
  for (let i = 0; i < 60; i++) {
    const x = rng.pick([0, 511, 7, 8, 495, 496, 503, 504, rng.int(0, 511), rng.int(0, 511)]), y = rng.pick([0, 191, 5, 7, 8, 176, 177, rng.int(0, 191), rng.int(0, 191)]);
    const lock = i % 4 === 3, before = m.ram.slice(PTR_AREA[0], PTR_AREA[1] + 1);
    if (lock) m.ram[S.PT_LOCK] = 1;
    const lockedBefore = m.ram.slice(PTR_AREA[0], PTR_AREA[1] + 1);
    const res = call(m, S, 'P_ISRMOVE', { hl: x, de: (rng.byte() << 8) | y, b: rng.byte(), c: rng.byte() }, { rng });
    if (lock) {
      sec.ok(carry(res) === 1, () => `P_ISRMOVE with PT_LOCK held: carry ${carry(res)}, want set (14.5)`);
      sec.ok(m.ram.slice(PTR_AREA[0], PTR_AREA[1] + 1).every((v, j) => v === lockedBefore[j]), 'P_ISRMOVE with PT_LOCK held changed the pointer area (14.5: nothing)');
      m.ram[S.PT_LOCK] = 0;
    } else {
      sec.ok(carry(res) === 0, () => `P_ISRMOVE (${x}, ${y}): carry ${carry(res)}, want clear`);
      sec.ok(m.ram[S.PT_DIRTY] !== 0, 'P_ISRMOVE did not set PT_DIRTY (14.5)');
      pm.move(x, y);
    }
    const ch = [...ixiyAlt(res), ...['b', 'c', 'd', 'e', 'h', 'l'].filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`)];
    sec.ok(ch.length === 0, () => `P_ISRMOVE: changed ${ch.join(', ')} (14.5: clobbers AF only)`);
    sec.ok(res.sp === 0xFF00 && res.iff1 === false, 'P_ISRMOVE: SP / interrupt flag');
    void before;
    if (!lock) { direct('P_ISR'); pm.isr(); const dd = displayDiff(); sec.ok(dd === null, () => `P_ISRMOVE (${x}, ${y}) then P_ISR: ${dd}`); }
  }
  // restore the pointer to the input's position
  direct('P_ISRMOVE', { hl: K.px, de: K.py }); direct('P_ISR'); pm.move(K.px, K.py); pm.isr();

  // (d) random K_POLL steps against the model (keys, joystick, kp mode, warp, posts, drains, lock held)
  {
    let keys = new Set(), joy = 0xFF, warpN = 0, lockN = 0;
    for (let i = 0; i < POLLS && !sec.bad; i++) {
      const r = rng.next();
      if (r < 0.30) { keys = new Set(keys); const k = rng.int(0, 39); if (keys.has(k)) keys.delete(k); else if (keys.size < 4) keys.add(k); }
      else if (r < 0.36) keys = new Set();
      else if (r < 0.40) keys = new Set([0, 36]);
      else if (r < 0.43) keys = new Set([0, KIDX('2')]);
      if (rng.chance(0.25)) { let j = ''; for (const c of 'udlrf') if (rng.chance(c === 'f' ? 0.3 : 0.28)) j += c; if (rng.chance(0.03)) j = 'udlrf'; joy = joyOf(j); }
      if (rng.chance(0.05)) {
        const x = rng.pick([0, 511, 600, -7, rng.int(0, 511), 65535, 32768]), y = rng.pick([0, 191, 300, -4, rng.int(0, 191), 40000]);
        direct('K_WARP', { hl: w16(x), de: w16(y) }); K.warp(w16(x), w16(y)); warpN++;
      }
      if (rng.chance(0.04)) { const p = [rng.int(6, 8), rng.byte(), rng.byte(), rng.byte()]; const rr = direct('K_POST', { a: p[0], c: p[1], e: p[2], d: p[3] }); const cy = K.post(...p); sec.ok(carry(rr) === cy, () => `fuzz K_POST carry ${carry(rr)}, model ${cy}`); }
      const lock = rng.chance(0.08); if (lock) lockN++;
      pollStep(sec, rowsOf([...keys]), joy, { lock, what: `fuzz ${i}` });
      if (rng.chance(0.25)) { for (let g = rng.int(1, 4); g > 0; g--) { const rr = call(m, S, 'K_GETEV', {}, { rng, ints: true }); const e = K.getev(); sec.ok(carry(rr) === e.carry, () => `fuzz K_GETEV carry ${carry(rr)}, model ${e.carry}`); } const d = ifaceDiff(K); sec.ok(d === null, () => `fuzz after K_GETEV: ${d}`); }
    }
    console.log(`  fuzz: ${POLLS} K_POLL steps, ${warpN} warps, ${lockN} with PT_LOCK held; stack used at most ${pollMaxStack} bytes (${pollMaxStackWhat})`);
  }
  // (e) the frame ISR preserves every register (AF, BC, DE, HL, IX, IY, the alternate set) and SP, whatever the input does
  {
    let n = 0;
    for (let i = 0; i < 60 && !sec.bad; i++) {
      const keys = rng.chance(0.5) ? [rng.int(1, 39)] : rng.chance(0.3) ? [0, 36] : [];
      setInput(rowsOf(keys), rng.chance(0.5) ? joyOf('rf') : 0xFF);
      parkIdle(); for (const r of REG8) cpu[r] = rng.byte();
      const before = {}; for (const r of REG8) before[r] = cpu[r];
      const sp0 = cpu.sp, pc0 = cpu.pc;
      isrNow(); n++;
      const bad = REG8.filter((r) => cpu[r] !== before[r]);
      sec.ok(bad.length === 0 && cpu.sp === sp0 && cpu.pc === pc0 && cpu.iff1 === true, () => `frame ISR: changed ${bad.map((r) => `${r} ${before[r]} -> ${cpu[r]}`).join(', ')}, SP ${hex(cpu.sp)} (want ${hex(sp0)}), iff1 ${cpu.iff1} (section 7 item 5: restores, EI, RET)`);
      setInput(IDLE_ROWS, 0xFF);
    }
    console.log(`  ISR register preservation: ${n} interrupts over random registers`);
  }
  setInput(IDLE_ROWS, 0xFF);
  m.ram[S.PT_LOCK] = 0;
  sec.end();
  C.check(`K_POLL stack: at most ${pollMaxStack} bytes below its return address over all direct calls (14.5: <= 20)`, pollMaxStack <= 20);
  quiesce();
}

// ===========================================================================================================================
// Part 4: test 4 (and 8), input over frames through T_EVLOOP
const FR = { frames: 0, events: 0, keyEv: 0, moveEv: 0, downUp: 0, modeEv: 0, repeats: 0, lostMax: 0 };
/**
 * One strict frame (the pattern of gfx6-s4 16.6.3): inputs are set; the pending frame interrupt is stepped to its RET (the ISR reads the inputs);
 * the model polls and the display must equal "the S4 model with the pointer where the previous frame's K_POLL put it"; the frame's direct calls
 * (K_WARP, K_POST); then the CPU runs the event loop for the rest of the frame (K_GETEV into T_EVLOG); the log must equal the model's drain.
 * fs: { keys: [k...], joy: string | byte, warp: [x, y], post: [[a, c, e, d]...] }.
 */
function strictFrame(sec, fs, label) {
  const rows = rowsOf(fs.keys || []), joy = asJoy(fs.joy);
  setInput(rows, joy);
  if (!accepted()) { sec.ok(false, `${label}: the frame interrupt is not pending (lost)`); return false; }
  const pat = (FR.frames & 1) ? 0x55 : 0xAA;
  armStack(m, pat);
  const v0 = frameCount();
  const r = runIsr();
  const poisonUsed = stackUsed(m, pat) + 2;
  FR.frames++; FS.frames++;
  if (((frameCount() - v0) & 0xFFFF) !== 1) { FS.vErr++; sec.ok(false, `${label}: V_FRAMES rose by ${(frameCount() - v0) & 0xFFFF}, want 1 (test 8)`); } else sec.ok(true);
  FS.poisonDepth = Math.max(FS.poisonDepth, poisonUsed);
  sec.ok(poisonUsed <= 32, () => `${label}: the frame ISR used ${poisonUsed} bytes of stack with its return address (poisoned $FB00-$FEFD; section 7 / 8: at most 32)`);
  sec.ok(m.ayLatch === rd8(S.K_AYREG) && m.portF4 === rd8(S.V_SHADOW_F4), () => `${label}: after the ISR the AY latch ${m.ayLatch} / $F4 ${hex(m.portF4, 2)} are not the shadows ${rd8(S.K_AYREG)} / ${hex(rd8(S.V_SHADOW_F4), 2)} (section 7 item 4)`);
  pm.isr();
  const pr = K.poll(rows, joy, false);
  {
    const nNew = pr.appended.filter((a) => a.rec[0] === E.KEY && !(a.rec[2] & 0x80)).length, nKeysDown = (fs.keys || []).length;
    if (nNew > 2 || nKeysDown > 6) FS.stress.push({ t: r.t, kpollT: r.kpollT, what: `${label} (${nNew} new keys)` });      // outside the "worst frame" of section 8 (a move, a button change, two new keys)
    else {
      FS.isrT.push(r.t); FS.offs.push(r.offIsrp); FS.kpollT.push(r.kpollT);
      if (r.kpollT > FS.kMax) { FS.kMax = r.kpollT; FS.kMaxWhat = `${label} keys [${(fs.keys || []).map((k) => KEY_NAMES[k]).join(' ')}] joy ${hex(joy, 2)}`; }
    }
  }
  if (pr.isrMove) pm.move(pr.isrMove.x, pr.isrMove.y);
  { const d = displayDiff(); sec.ok(d === null, () => `${label}: after the ISR ${d}`); }
  { const d = ifaceDiff(K); sec.ok(d === null, () => `${label}: after the ISR ${d}; model appended ${pr.appended.map((a) => `[${a.rec}] ${a.how}`).join(' ') || 'nothing'}`); if (d) resync(); }
  for (const a of pr.appended) { if (a.rec[0] === E.KEY) { FR.keyEv++; if (a.rec[2] & 0x80) FR.repeats++; } else if (a.rec[0] === E.MOVE) FR.moveEv++; else if (a.rec[0] === E.MODE) FR.modeEv++; else FR.downUp++; }
  FR.lostMax = Math.max(FR.lostMax, K.lost);
  // the frame's direct calls
  if (fs.warp) { call(m, S, 'K_WARP', { hl: w16(fs.warp[0]), de: w16(fs.warp[1]) }, { rng, ints: false }); K.warp(w16(fs.warp[0]), w16(fs.warp[1])); }
  for (const p of fs.post || []) { const res = call(m, S, 'K_POST', { a: p[0], c: p[1], e: p[2], d: p[3] }, { rng }); const cy = K.post(...p); sec.ok(carry(res) === cy, () => `${label}: K_POST carry ${carry(res)}, model ${cy}`); }
  parkLoop(); M.runFrame(m);
  if (!accepted()) { FS.lostIrq++; sec.ok(false, `${label}: the frame interrupt was lost at the end of the frame`); return false; }
  const want = K.drain(), got = readLog();
  sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `${label}: the event loop logged ${evText(got) || 'nothing'}, model ${evText(want) || 'nothing'} (keys [${(fs.keys || []).map((k) => KEY_NAMES[k]).join(' ')}] joy ${hex(joy, 2)})`);
  if (fs.expect) sec.ok(JSON.stringify(got) === JSON.stringify(fs.expect), () => `${label}: logged ${evText(got) || 'nothing'}, hand-worked ${evText(fs.expect) || 'nothing'} (section 7 / 14.4)`);
  FR.events += got.length;
  { const d = ifaceDiff(K); sec.ok(d === null, () => `${label}: after the loop ${d}`); }
  return true;
}
function runScript(sec, name, frames) {
  for (let i = 0; i < frames.length && !sec.bad; i++) if (!strictFrame(sec, frames[i], `${name} frame ${i}`)) return false;
  return true;
}
const F = (keys = [], joy = 0xFF, extra = {}) => ({ keys, joy, ...extra });
const Q = (n) => Array.from({ length: n }, () => F());

function part4() {
  const sec = new Sec('test 4 (and 8), input over frames: keys, caps, repeat, rollover, modes, joystick, acceleration, warp');
  blankScene();
  prime();
  runScript(sec, 'settle', Q(3));
  // ---- every key, plain / CS / SS / CS+SS, modifier pressed with the key or a frame earlier -----------------------------------
  {
    const frames = [];
    const MODS = [[], [0], [36], [0, 36]];
    for (let plane = 0; plane < 4; plane++) for (let k = 1; k < 40; k++) {
      if (k === 36) continue;
      const mods = MODS[plane];
      if ((k + plane) & 1 || plane === 0) frames.push(F([...mods, k]), F(), F());
      else frames.push(F(plane === 3 ? [0] : mods), F(plane === 3 ? [0, 36, k] : [...mods, k]), F(), F());
    }
    runScript(sec, 'all keys', frames);
    if (K.caps) runScript(sec, 'caps off', [F([0, KIDX('2')]), F()]);        // (CS+2 in the all-keys run turned caps lock on)
    console.log(`  all keys: ${frames.length} frames, ${FR.keyEv} E_KEY events so far`);
  }
  // hand-worked expectations, independent of the model: exact events for known keys (section 7 / 14.4), compared with the machine's log
  {
    const hand = [
      [[KIDX('A')], [[1, 97, 0, 0]]], [[0, KIDX('A')], [[1, 65, 1, 0]]], [[36, KIDX('Z')], [[1, 58, 2, 0]]], [[KIDX('ENTER')], [[1, 13, 0, 0]]],
      [[0, KIDX('5')], [[1, 8, 1, 0]]], [[0, KIDX('6')], [[1, 10, 1, 0]]], [[0, KIDX('7')], [[1, 11, 1, 0]]], [[0, KIDX('8')], [[1, 9, 1, 0]]],
      [[0, KIDX('0')], [[1, 12, 1, 0]]], [[0, KIDX('SPACE')], [[1, 3, 1, 0]]], [[KIDX('SPACE')], [[1, 32, 0, 0]]], [[0, KIDX('4')], [[1, 14, 1, 0]]],
      [[0, KIDX('3')], [[1, 15, 1, 0]]], [[0, KIDX('1')], [[1, 27, 1, 0]]], [[0, KIDX('9')], [[1, 16, 1, 0]]], [[36, KIDX('Q')], []], [[0, KIDX('2')], []], [[0, 36, KIDX('A')], [[1, 126, 7, 0]]],
    ];
    const frames = [];
    for (const [keys, expect] of hand) frames.push(F(keys, 0xFF, { expect }), F());
    runScript(sec, 'hand-worked keys', frames);
    runScript(sec, 'caps lock off again', [F([0, KIDX('2')]), F()]);           // (the CS+2 above turned it on)
  }
  // ---- caps lock -----------------------------------------------------------------------------------------------------------------
  runScript(sec, 'caps lock', [
    F([0, KIDX('2')]), F(), F([KIDX('A')]), F(), F([36, KIDX('Z')]), F(), F([0, KIDX('A')]), F(), F([KIDX('1')]), F(), F([KIDX('M')]), F(),
    F([0, KIDX('2')]), F(), F([KIDX('A')]), F(), F([0, KIDX('2')]), F([0, KIDX('2')]), F([KIDX('B')]), F(), F([0, KIDX('2')]), F([KIDX('B')]), F()]);
  // ---- repeat: the frame numbers of the events (n + 30, n + 34, ...), release cancels, another held key does not take over -----------
  {
    const before = FR.repeats;
    const log = [];
    const frames = [F([KIDX('A')]), ...Array.from({ length: 45 }, () => F([KIDX('A')])), F(), F(), F()];
    // frame index of each E_KEY event: compare with the hand-worked 0, 30, 34, 38, 42, 46 truncated to the 46 held frames
    const repAt = [];
    for (let i = 0; i < frames.length && !sec.bad; i++) { const n0 = FR.keyEv; strictFrame(sec, frames[i], `repeat A frame ${i}`); if (FR.keyEv > n0) repAt.push(i); log.push(i); }
    sec.ok(JSON.stringify(repAt) === JSON.stringify([0, 30, 34, 38, 42]), () => `A held from frame 0: events in frames ${repAt.join(', ')}, want 0, 30, 34, 38, 42 (14.3: n + 30, n + 34, ...)`);
    sec.ok(FR.repeats - before === 4, 'four repeats with bit 7 set');
    runScript(sec, 'repeat two keys', [
      F([KIDX('A')]), ...Array.from({ length: 12 }, () => F([KIDX('A')])), F([KIDX('A'), KIDX('S')]), ...Array.from({ length: 40 }, () => F([KIDX('A'), KIDX('S')])),
      ...Array.from({ length: 40 }, () => F([KIDX('A')])), F(), F()]);                // S repeats; S released: A does not take over
    runScript(sec, 'repeat 2', [
      F([KIDX('A'), KIDX('S')]), ...Array.from({ length: 40 }, () => F([KIDX('A'), KIDX('S')])), ...Array.from({ length: 40 }, () => F([KIDX('A')])), ...Array.from({ length: 40 }, () => F([KIDX('S')])), F(), F(),
      F([KIDX('A')]), ...Array.from({ length: 29 }, () => F([KIDX('A')])), F(), F([KIDX('A')]), ...Array.from({ length: 35 }, () => F([KIDX('A')])), F(),
      F([KIDX('A')]), ...Array.from({ length: 6 }, () => F([KIDX('A')])), F([0, KIDX('A')]), ...Array.from({ length: 40 }, () => F([0, KIDX('A')])), F([KIDX('A')]), ...Array.from({ length: 40 }, () => F([KIDX('A')])), F(), F(),
      F([KIDX('Z')]), ...Array.from({ length: 12 }, () => F([KIDX('Z')])), F([36, KIDX('Z')]), ...Array.from({ length: 40 }, () => F([36, KIDX('Z')])), F(), F(),
      // a newly down CS does not stop the repeat; a code-0 key (SS+Q) counts as newly down (R2); caps-lock key cancels
      F([KIDX('X')]), ...Array.from({ length: 28 }, () => F([KIDX('X')])), F([0, KIDX('X')]), F([0, KIDX('X')]), ...Array.from({ length: 8 }, () => F([KIDX('X')])), F([KIDX('X'), KIDX('Q'), 36]), ...Array.from({ length: 40 }, () => F([KIDX('X'), 36])), F(), F(),
      F([KIDX('C')]), ...Array.from({ length: 20 }, () => F([KIDX('C')])), F([KIDX('C'), 0, KIDX('2')]), ...Array.from({ length: 40 }, () => F([KIDX('C'), 0, KIDX('2')])), F(), F(), F([0, KIDX('2')]), F()]);
  }
  // ---- rollover: two keys newly down in one frame: increasing key index; across half-rows; many keys: 16 in the ring, the rest dropped -
  {
    runScript(sec, 'rollover', [F([KIDX('S'), KIDX('A')]), F(), F([KIDX('P'), KIDX('Q')]), F(), F([KIDX('B'), KIDX('Z'), KIDX('SPACE'), KIDX('1'), KIDX('T')]), F(),
      F([KIDX('A')]), F([KIDX('A'), KIDX('Z')]), F([KIDX('A'), KIDX('Z'), KIDX('S')]), F(), F([KIDX('H'), KIDX('J'), KIDX('K'), KIDX('L'), KIDX('ENTER')]), F()]);
    const lost0 = K.lost;
    const all = []; for (let k = 1; k < 40; k++) if (k !== 36) all.push(k);
    runScript(sec, 'rollover 38 keys', [F(all), F(all), F(), F()]);
    sec.ok(K.lost === Math.min(255, lost0 + 22) && rd8(S.K_LOST) === Math.min(255, lost0 + 22), () => `38 keys at once: K_LOST ${rd8(S.K_LOST)}, want ${Math.min(255, lost0 + 22)} (38 events, 16 fit; test 3: the 17th is dropped and counted)`);
    runScript(sec, 'rollover 20 keys with modifiers', [F([0, ...all.slice(0, 20)]), F(), F([36, ...all.slice(10, 30)]), F(), F([0, 36, ...all.slice(5, 25)]), F()]);
  }
  // ---- keyboard-pointer mode ---------------------------------------------------------------------------------------------------
  {
    const KP = (keys, n, joy = 0xFF) => Array.from({ length: n }, () => F(keys, joy));
    runScript(sec, 'mode toggles', [
      F([0, 36]), F([0, 36]), F([0, 36]), F(), F(), F([0, 36]), F(), F([0]), F([0, 36]), F([36]), F([0, 36]), F(), F([36, 0]), F([36]), F(), F([0, KIDX('A')]), F([0, KIDX('A'), 36]), F([0, 36, KIDX('A')]), F(), F(),
      F([KIDX('A')]), F([KIDX('A'), 0]), F([KIDX('A'), 0, 36]), F([KIDX('A'), 36, 0]), F(), F(),
      // on: Q / A / O / P / SPACE, no E_KEY, other keys ignored; the mode applies in the same frame as the toggle
      F([0, 36]), F(),
      ...KP([KIDX('Q')], 12), F(), F(), ...KP([KIDX('A')], 40), F(), ...KP([KIDX('O')], 25), F(), ...KP([KIDX('P')], 60), F(), ...KP([KIDX('Q'), KIDX('P')], 40), F(), ...KP([KIDX('A'), KIDX('O')], 40), F(),
      ...KP([KIDX('Q'), KIDX('A')], 8), ...KP([KIDX('O'), KIDX('P')], 8), F(), ...KP([KIDX('Z'), KIDX('X'), KIDX('1')], 5), F(), F([0, KIDX('Q')]), F([36, KIDX('P')]), F([0, 36, KIDX('A')]), F(), F(),
      F([KIDX('SPACE')]), ...KP([KIDX('SPACE')], 4), F(), F([KIDX('SPACE'), KIDX('P')]), ...KP([KIDX('SPACE'), KIDX('P')], 20), F(), F(),
      ...KP([KIDX('Q')], 8, joyOf('r')), ...KP([KIDX('O')], 8, joyOf('r')), ...KP([KIDX('SPACE')], 4, joyOf('f')), ...KP([], 4, joyOf('f')), ...KP([KIDX('SPACE')], 3, joyOf('')), F(), F(),
      ...KP([KIDX('P')], 6, joyOf('udlr')), ...KP([], 4, joyOf('udlrf')), ...KP([KIDX('SPACE')], 4, joyOf('udlrf')), F(), F(),
      F([0, 36]), F(), F([KIDX('Q')]), F(), F([KIDX('A')]), F(), ...KP([KIDX('P')], 10)]);
  }
  // ---- joystick: every direction combination, acceleration, every edge and corner, buttons -----------------------------------------
  {
    const frames = [];
    const HOLD = (joy, n, keys = []) => { for (let i = 0; i < n; i++) frames.push(F(keys, joy)); };
    for (let mask = 0; mask < 32; mask++) {
      let j = ''; for (let b = 0; b < 5; b++) if (mask & (1 << b)) j += 'udlrf'[b];
      HOLD(j, 9); HOLD('', 2);
    }
    // acceleration paths into the four edges and corners from near them (the warp puts the pointer there first)
    const spots = [['r', [440, 90]], ['l', [90, 90]], ['u', [200, 40]], ['d', [200, 150]], ['ur', [440, 40]], ['ul', [90, 40]], ['dr', [440, 150]], ['dl', [90, 150]]];
    for (const [dir, [x, y]] of spots) { frames.push(F([], 0xFF, { warp: [x, y] })); HOLD('', 2); HOLD(dir, 75); HOLD(dir + 'f', 6); HOLD(dir, 6); HOLD('', 2); HOLD('f', 3); HOLD('', 2); }
    // opposite directions cancel (14.3 step 5: x = clamp(x + 2 s (r - l)), y = clamp(y + s (d - u))), also ON each edge and corner: nothing moves
    for (const [x, y] of [[256, 191], [256, 0], [0, 96], [511, 96], [0, 0], [511, 191], [0, 191], [511, 0], [509, 189], [3, 2]]) for (const pair of ['ud', 'lr', 'udlr', 'udl', 'urd']) {
      frames.push(F([], 0xFF, { warp: [x, y] })); HOLD('', 2); HOLD(pair, 14); HOLD('', 2);
    }
    // hold, stop one frame, hold again (the hold counter restarts), opposite directions while accelerated
    HOLD('r', 20); HOLD('', 1); HOLD('r', 8); HOLD('l', 8); HOLD('lr', 10); HOLD('r', 12); HOLD('ud', 9); HOLD('udr', 9); HOLD('', 2);
    // all four directions after an acceleration: nothing, and the hold counter resets
    HOLD('d', 12); HOLD('udlr', 3); HOLD('d', 8); HOLD('', 2);
    runScript(sec, 'joystick', frames);
    console.log(`  joystick: ${frames.length} frames; pointer ended at (${K.px}, ${K.py})`);
  }
  // ---- hand-worked acceleration (spike6 17.5, from (391, 131)): right 10 frames -> (419, 131); also the first frame's E_MOVE bytes ----
  {
    runScript(sec, 'warp for the hand-worked path', [F([], 0xFF, { warp: [391, 131] }), F(), F()]);
    const x0 = rd16(m, S.K_PX), y0 = rd8(S.K_PY);
    runScript(sec, 'hand-worked right', Array.from({ length: 10 }, () => F([], joyOf('r'))));
    sec.ok(x0 === 391 && y0 === 131 && rd16(m, S.K_PX) === 419 && rd8(S.K_PY) === 131, () => `hand-worked: from (${x0}, ${y0}) right for 10 frames gives (${rd16(m, S.K_PX)}, ${rd8(S.K_PY)}), want (419, 131) (6 x 2 + 4 x 4)`);
    runScript(sec, 'quiet', Q(3));
    runScript(sec, 'hand-worked ul', Array.from({ length: 6 }, () => F([], joyOf('ul'))));
    sec.ok(rd16(m, S.K_PX) === 407 && rd8(S.K_PY) === 125, () => `hand-worked: up + left for 6 frames: (${rd16(m, S.K_PX)}, ${rd8(S.K_PY)}), want (407, 125)`);
    runScript(sec, 'quiet', Q(3));
  }
  // ---- warp: through K_WARP direct calls between frames: in range, clamped, repeated, with motion in the same frame, no event ------------
  {
    const W = [[100, 100], [-5, 1000], [511, 191], [512, 192], [0, 0], [300, -1], [32767, 32767], [0x8000, 5], [65535, 65535], [123, 45], [511, 0], [0, 191]];
    const frames = [];
    for (const [x, y] of W) { frames.push(F([], 0xFF, { warp: [x, y] }), F(), F()); }
    frames.push(F([], joyOf('r'), { warp: [200, 100] }), F([], joyOf('r')), F([], joyOf('rf'), { warp: [10, 10] }), F([], joyOf('l')), F([], 0xFF, { warp: [400, 50] }), F([], joyOf('f')), F(), F());
    frames.push(F([], 0xFF, { warp: [50, 50], post: [[16, 1, 2, 3]] }), F(), F([], 0xFF, { post: [[6, 0, 0, 0], [7, 0, 0, 0], [8, 0, 0, 0], [200, 4, 5, 6], [17, 0, 0, 0]] }), F(), F());
    frames.push(F([KIDX('A')], joyOf('r'), { post: [[16, 9, 9, 9]] }), F(), F());
    runScript(sec, 'warp and posted events', frames);
  }
  // ---- fuzz ----------------------------------------------------------------------------------------------------------------------
  {
    let keys = [], joy = '', frames = [];
    for (let i = 0; i < FUZZ; i++) {
      if (rng.chance(0.2)) {
        const r = rng.next();
        if (r < 0.5) { const s = new Set(keys); const k = rng.int(0, 39); if (s.has(k)) s.delete(k); else if (s.size < 5) s.add(k); keys = [...s]; }
        else if (r < 0.6) keys = [];
        else if (r < 0.7) keys = [0, 36];
        else if (r < 0.8) keys = [rng.pick([KIDX('Q'), KIDX('A'), KIDX('O'), KIDX('P'), KIDX('SPACE')]), ...(rng.chance(0.5) ? [0] : [])];
        else if (r < 0.9) keys = [0, KIDX('2')];
        else keys = [...keys.slice(0, 3), rng.int(1, 39)];
      }
      if (rng.chance(0.12)) { joy = ''; for (const c of 'udlrf') if (rng.chance(0.3)) joy += c; if (rng.chance(0.04)) joy = 'udlrf'; }
      const extra = {};
      if (rng.chance(0.04)) extra.warp = [rng.pick([rng.int(-20, 530), rng.int(0, 511)]), rng.pick([rng.int(-20, 210), rng.int(0, 191)])];
      if (rng.chance(0.03)) extra.post = Array.from({ length: rng.int(1, 5) }, () => [rng.pick([6, 7, 8, 16, 200]), rng.byte(), rng.byte(), rng.byte()]);
      frames.push(F(keys, joy, extra));
    }
    runScript(sec, 'fuzz', frames);
  }
  setInput(IDLE_ROWS, 0xFF);
  sec.end();
  console.log(`  frames ${fmt(FR.frames)}: ${fmt(FR.events)} events logged (E_KEY ${FR.keyEv} of which ${FR.repeats} repeats, E_MOVE ${FR.moveEv}, E_DOWN/E_UP ${FR.downUp}, E_MODE ${FR.modeEv}); K_LOST reached ${FR.lostMax}`);
  C.check('test 8: V_FRAMES rose by exactly 1 in every frame of test 4, no frame interrupt lost', FS.vErr === 0 && FS.lostIrq === 0, `${FS.vErr} frames with a wrong rise, ${FS.lostIrq} lost`);
  C.check(`frame ISR stack: at most ${FS.poisonDepth} bytes with the return address (poisoned $FB00-$FEFD; section 8: <= 32)`, FS.poisonDepth <= 32);
  const mx = Math.max(...FS.offs), kmx = Math.max(...FS.kpollT), tmx = Math.max(...FS.isrT);
  if (FS.stress.length) console.log(`  (${FS.stress.length} stress frames with more than 2 new keys or more than 6 keys down are left out of the ISR statistics; worst: ISR ${Math.max(...FS.stress.map((x) => x.t))} T, K_POLL ${Math.max(...FS.stress.map((x) => x.kpollT))} T)`);
  console.log(`  ISR over ${FS.isrT.length} frames: max ${tmx} T, mean ${(FS.isrT.reduce((a, b) => a + b, 0) / FS.isrT.length).toFixed(0)}; K_POLL (T_ISRP to T_POLLD, CALL and RET included) max ${kmx} (${FS.kMaxWhat}); largest T_ISRP offset ${mx} (+1,500 = ${mx + 1500} of 8,960)`);
  C.check(`pointer deadline: largest T_ISRP offset ${mx} + 1,500 = ${mx + 1500} <= 8,960 (frames of test 4; the ISR bounds are in kern-perf.mjs: worst ISR here ${tmx} T)`, mx + 1500 <= 8960);
}

// ===========================================================================================================================
// Part 5: test 6, the ISR moving the pointer while P_SHIELD / P_UNSHIELD / a shielded G_FILL run
const XE = [0, 7, 8, 495, 496, 503, 504, 511], YE = [0, 7, 8, 176, 177, 191];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const edgePairs = () => shuffle(XE.flatMap((x) => YE.map((y) => [x, y])));
const rint = (lo, hi) => rng.int(lo, hi);
function rectFromBytes(a, b, r0, r1) { const x = 8 * a + rint(0, 7); let xe = 8 * b + rint(0, 7); if (xe < x) xe = x; return [x, r0, xe - x + 1, r1 - r0 + 1]; }
function rectNear(T) {
  const mode = rint(0, 9), dc = () => rint(0, 3), dr = () => rint(0, 5);
  switch (mode) {
    case 0: { const b = T.c0 - 1; return rectFromBytes(b - dc(), b, T.y0 - dr(), T.y1 + dr()); }
    case 1: { const a = T.c1 + 1; return rectFromBytes(a, a + dc(), T.y0 - dr(), T.y1 + dr()); }
    case 2: { const r1 = T.y0 - 1; return rectFromBytes(T.c0 - dc(), T.c1 + dc(), r1 - dr(), r1); }
    case 3: { const r0 = T.y1 + 1; return rectFromBytes(T.c0 - dc(), T.c1 + dc(), r0, r0 + dr()); }
    case 4: return rectFromBytes(T.c0 - dc(), T.c0, T.y0 + rint(-5, 15), T.y0 + rint(0, 20));
    case 5: return rectFromBytes(T.c1, T.c1 + dc(), T.y0 + rint(-5, 15), T.y0 + rint(0, 20));
    case 6: return rectFromBytes(T.c0 + rint(-2, 3), T.c1 + rint(-2, 3), T.y0 - dr(), T.y0);
    case 7: return rectFromBytes(T.c0 + rint(-2, 3), T.c1 + rint(-2, 3), T.y1, T.y1 + dr());
    case 8: { const a = rint(T.c0, T.c1), b = rint(a, T.c1), r0 = rint(T.y0, T.y1); return rectFromBytes(a, b, r0, rint(r0, T.y1)); }
    default: return rectFromBytes(T.c0 - dc(), T.c1 + dc(), T.y0 - dr(), T.y1 + dr());
  }
}
/** A seeded random display, the pointer area re-initialised with P_INIT at (x, y), the input position set to match, the models in step. */
function seededScene(x, y, op = 0) {
  quiesce();
  zeroPtr(); seedDisplay(m, rng);
  direct('G_INIT'); m.ram[S.GLH] = 8;
  direct('G_SETOP', { a: op });
  resetPm(); scr.setOp(op); scr.setGlh(8);
  direct('P_INIT', { hl: x, de: y });
  m.ram[S.K_PX] = x & 0xFF; m.ram[S.K_PX + 1] = x >> 8; m.ram[S.K_PY] = y;
  K.px = x; K.py = y;
  direct('P_ISR');
  pm.init(x, y); pm.isr();
  const d = displayDiff(); if (d) throw new Error(`seededScene: ${d}`);
}
const dirs = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
/** The position the first poll at hold 0 gives (s = 1: 2 columns, 1 row). */
function stepFrom(A, joy) { let x = A[0], y = A[1]; for (const c of joy) { if ('udlr'.includes(c)) { x += 2 * dirs[c][0]; y += dirs[c][1]; } } return [Math.min(Math.max(x, 0), 511), Math.min(Math.max(y, 0), 191)]; }
function part5() {
  const sec = new Sec('test 6a, the ISR moves the pointer (joystick held) while P_SHIELD / P_UNSHIELD / a shielded G_FILL run: injection at every boundary');
  let trials = 0, scenarios = 0, boundaries = 0, refused = 0, accepted1 = 0, moved = 0;
  const cats = {};
  /** seq: [{ name, regs, ga, model(p) }]; the joystick `joy` is held when the injected ISR runs, released for the two ISRs after the return. */
  function runScenario(label, sc) {
    scenarios++;
    seededScene(sc.A[0], sc.A[1], sc.op ?? 0);
    if (sc.shield0) { direct('P_SHIELD', {}, sc.shield0); pm.shield(...sc.shield0); }
    const joy = joyOf(sc.joy);
    const B = stepFrom(sc.A, sc.joy);
    const K0 = K.clone();
    const snapRam = m.ram.slice(), snapCpu = { ...cpu }, snapT = m.tstates;
    const restore = () => { m.ram.set(snapRam); Object.assign(cpu, snapCpu); m.tstates = snapT; };
    const pe = pm.clone(); for (const s of sc.seq) s.model(pe);
    const desc = `${label}: A (${sc.A}) -> B (${B}) by joystick ${sc.joy}${sc.rect ? `, rect (${sc.rect})` : ''}${sc.op !== undefined ? ` op ${sc.op}` : ''}`;
    /** Run the sequence with the injection before instruction k of the whole sequence (k < 0: none); then the ISRs of "two more frames". */
    function run(k) {
      restore();
      let g = 0, injected = false, lockAtInj = 0;
      const f0 = frameCount();
      setInput(IDLE_ROWS, joy);
      for (const c of sc.seq) {
        if (c.ga) setGA(m, S, ...c.ga);
        for (const r of REG8) cpu[r] = rng.byte();
        for (const [r, v] of Object.entries(c.regs || {})) { if (r === 'hl') { cpu.h = (v >> 8) & 0xFF; cpu.l = v & 0xFF; } else if (r === 'de') { cpu.d = (v >> 8) & 0xFF; cpu.e = v & 0xFF; } else cpu[r] = v; }
        cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true;
        cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8; cpu.pc = S[c.name];
        let guard = 0;
        while (cpu.pc !== S.T_RET) {
          if (g === k && !injected) {
            injected = true; lockAtInj = rd8(S.PT_LOCK);
            if (isrNow() === null) return { error: `the interrupt was refused before instruction ${k} (inside ${c.name}): interrupts were off` };
          }
          step1(); g++;
          if (++guard > 2_000_000) return { error: `${c.name} did not return` };
        }
      }
      // the routine has returned: the joystick is released; "two more frames" (the retry, then the draw)
      const Kc = K0.clone(), polls = [];
      if (k >= 0) polls.push(Kc.poll(IDLE_ROWS, joy, !!lockAtInj)); else { setInput(IDLE_ROWS, joy); isrNow(); polls.push(Kc.poll(IDLE_ROWS, joy, false)); }
      setInput(IDLE_ROWS, 0xFF);
      parkIdle();
      for (let i = 0; i < 2; i++) { if (isrNow() === null) return { error: 'the interrupt after the routine was refused' }; polls.push(Kc.poll(IDLE_ROWS, 0xFF, false)); }
      return { steps: g, Kc, polls, lockAtInj, frames: ((frameCount() - f0) & 0xFFFF) };
    }
    const base = run(-1);
    const finalCheck = (res) => {
      const probs = [];
      const Kc = res.Kc, p2 = pe.clone(); p2.move(Kc.px, Kc.py); p2.isr();
      const want = p2.displayBytes(), d = G.compareBytes(m.ram, want);
      if (d) { const off = d.addr & 0x1FFF, y = ((off >> 11) & 3) * 64 + ((off >> 5) & 7) * 8 + ((off >> 8) & 7), bc = (off & 31) * 2 + (d.addr >= 0x6000 ? 1 : 0); probs.push(`display byte (column ${bc}, row ${y}) = ${hex(d.got, 2)}, model ${hex(d.want, 2)} (pointer expected at (${Kc.px}, ${Kc.py}), shield ${p2.S ? JSON.stringify(p2.S) : 'none'})`); }
      const dif = ifaceDiff(Kc); if (dif) probs.push(dif);
      return probs;
    };
    if (base.error) { sec.ok(false, `${desc} WITHOUT an interrupt: ${base.error}`); return; }
    { const pr = finalCheck(base); if (!sec.ok(pr.length === 0, () => `${desc} WITHOUT an interrupt: ${pr.join('; ')}`)) return; }
    const n = base.steps;
    boundaries += Math.ceil(n / STRIDE);
    cats[label] = cats[label] || { refused: 0, trials: 0 };
    for (let k = 0; k < n; k += STRIDE) {
      const res = run(k); trials++; cats[label].trials++;
      if (res.error) { sec.ok(false, `${desc}, interrupt before instruction ${k} of ${n}: ${res.error}`); if (sec.bad) return; continue; }
      const probs = [];
      if (res.frames !== 3) probs.push(`V_FRAMES rose by ${res.frames}, want 3 (the injected ISR and two more frames)`);
      const wasMove = B[0] !== sc.A[0] || B[1] !== sc.A[1];
      if (res.lockAtInj && wasMove) { refused++; cats[label].refused++; } else if (wasMove) accepted1++;
      if (wasMove) moved++;
      probs.push(...finalCheck(res));
      const pp = probs.filter(Boolean);
      sec.ok(pp.length === 0, () => `${desc}, interrupt before instruction ${k} of ${n}${res.lockAtInj ? ' (PT_LOCK held: P_ISRMOVE refused)' : ''}: ${pp.join('; ')}`);
      if (sec.bad) return;
    }
  }
  const posPair = () => (rng.chance(0.4) ? edgePairs()[0] : [rint(0, 511), rint(0, 191)]);
  const joys = ['r', 'l', 'u', 'd', 'ur', 'dl', 'rd', 'lu'];
  /** A rectangle (w = 0: random size) whose byte rectangle meets the pointer drawn at A iff wantA, and the one at B iff wantB. */
  const wantRect = (A, B, wantA, wantB, w, h, tries = 6000) => {
    const RA = G.pointerRect(...A), RB = G.pointerRect(...B);
    for (let t = 0; t < tries; t++) {
      const near = rng.chance(0.5) ? RA : RB;
      const r = w === 0 ? rectNear(near) : [8 * near.c0 + rint(-40, 40), near.y0 + rint(-24, 24), w, h];
      const s = G.shieldRect(...r);
      if (s && G.meets(RA, s) === wantA && G.meets(RB, s) === wantB) return r;
    }
    return null;
  };
  // A at a byte boundary (px AND 7 = 6, 7) or a row step so that the 2-column step changes the byte rectangle: the four meet combinations are reachable
  const pickA = () => { const a = posPair(); if (rng.chance(0.5)) a[0] = (a[0] & ~7) + rng.pick([6, 7, 0, 1]); a[0] = Math.min(Math.max(a[0], 0), 511); return a; };
  // P_SHIELD
  for (const [mA, mB] of [[1, 1], [1, 0], [0, 1], [0, 0]]) for (let i = 0; i < REPS * 2 && !sec.bad; i++) {
    let A, B, r = null, j;
    for (let t = 0; t < 80 && !r; t++) { A = pickA(); j = rng.pick(joys); B = stepFrom(A, j); r = wantRect(A, B, !!mA, !!mB, 0); }
    if (!r) continue;
    runScenario(`P_SHIELD (meets A ${mA}, meets B ${mB})`, { A, joy: j, rect: r, seq: [{ name: 'P_SHIELD', ga: r, model: (p) => p.shield(...r) }] });
  }
  // P_UNSHIELD: a shield (which A does not meet) is held; B meets it or not
  for (const mB of [1, 0]) for (let i = 0; i < REPS * 2 && !sec.bad; i++) {
    let A, B, r = null, j;
    for (let t = 0; t < 80 && !r; t++) { A = pickA(); j = rng.pick(joys); B = stepFrom(A, j); r = wantRect(A, B, false, !!mB, 0); }
    if (!r) continue;
    runScenario(`P_UNSHIELD (shield held; B meets it ${mB})`, { A, joy: j, shield0: r, rect: r, seq: [{ name: 'P_UNSHIELD', model: (p) => p.unshield() }] });
  }
  // shielded G_FILL 32 x 16: P_SHIELD r, G_FILL r, P_UNSHIELD
  for (const [mA, mB] of [[1, 1], [1, 0], [0, 1], [0, 0]]) for (let i = 0; i < REPS && !sec.bad; i++) {
    let A, B, r = null, j;
    for (let t = 0; t < 80 && !r; t++) { A = pickA(); j = rng.pick(joys); B = stepFrom(A, j); r = wantRect(A, B, !!mA, !!mB, 32, 16); }
    if (!r) continue;
    const op = (i + mA + 2 * mB) % 3;
    runScenario(`shielded G_FILL 32 x 16 (meets A ${mA}, meets B ${mB})`, { A, joy: j, rect: r, op, seq: [
      { name: 'P_SHIELD', ga: r, model: (p) => p.shield(...r) }, { name: 'G_FILL', ga: r, model: (p) => p.scr.fill(...r) }, { name: 'P_UNSHIELD', model: (p) => p.unshield() }] });
  }
  setInput(IDLE_ROWS, 0xFF);
  sec.end();
  console.log(`  ${scenarios} scenarios, ${fmt(boundaries)} boundaries, ${fmt(trials)} interrupted runs; the pointer wanted to move in ${moved} (P_ISRMOVE refused while PT_LOCK was held in ${refused}, accepted at once in ${accepted1}); by case: ${Object.entries(cats).map(([k, v]) => `${k}: ${v.refused}/${v.trials}`).join('; ')}`);
  C.check(`injection with the ISR moving the pointer ran: ${scenarios} scenarios, ${fmt(trials)} interrupted runs; P_ISRMOVE refused in ${refused} of them`, scenarios >= 20 && trials > 500 && refused > 0, `${scenarios} scenarios`);
}

// ===========================================================================================================================
// Part 6: test 6, the flicker test with the position from the joystick
function part6() {
  const FRAMES = FLICKER;
  const failures = [];
  const fail = (what) => { if (failures.length < 8) failures.push(what); };
  // ---- setup: a white screen and a background of SET / XOR fills by direct calls; the pointer at (256, 96)
  quiesce();
  zeroPtr(); m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
  direct('G_INIT'); m.ram[S.GLH] = 8;
  resetPm(); scr.setGlh(8);
  for (let i = 0; i < 30; i++) {
    const op = rint(0, 2), r = [rint(0, 480), rint(0, 170), rint(8, 200), rint(4, 60)];
    direct('G_SETOP', { a: op }); scr.setOp(op);
    direct('G_FILL', {}, r); scr.fill(...r);
  }
  direct('G_SETOP', { a: 0 }); scr.setOp(0);
  direct('P_INIT', { hl: 256, de: 96 }); pm.init(256, 96);
  m.ram[S.K_PX] = 0; m.ram[S.K_PX + 1] = 1; m.ram[S.K_PY] = 96; K.px = 256; K.py = 96;
  prime();                                                               // the frame after this one runs the ISR of the first frame
  // after prime's frame the ISR has not run: it is pending; the model's pointer has not been drawn yet
  // ---- the path: joystick runs, stops, warps to the edges / corners, shield windows
  const path = [];
  const corners = [[0, 0], [511, 0], [0, 191], [511, 191], [504, 185], [495, 176], [496, 177], [7, 8], [8, 7]];
  while (path.length < FRAMES + 60) {
    const r = rng.next();
    if (r < 0.45) { const j = rng.pick(['r', 'l', 'u', 'd', 'ur', 'ul', 'dr', 'dl', 'rf', 'lf', 'urf']); for (let i = rint(4, 45); i > 0; i--) path.push({ joy: j }); }
    else if (r < 0.58) { for (let i = rint(2, 6); i > 0; i--) path.push({ joy: '' }); }
    else if (r < 0.78) { const [ex, ey] = rng.pick(edgePairs()); path.push({ joy: '', warp: [ex, ey] }); for (let i = rint(0, 3); i > 0; i--) path.push({ joy: rng.pick(['', 'r', 'd', 'l', 'u']) }); }
    else if (r < 0.88) { const [ex, ey] = rng.pick(corners); path.push({ joy: '', warp: [ex, ey] }); path.push({ joy: rng.pick(['r', 'd', 'dr', 'l', 'u']) }); }
    else if (r < 0.94) { const y = rint(0, 175); for (let i = 0; i < 16; i++) path.push({ joy: i ? 'r' : '', warp: i ? undefined : [64, y] }); }
    else { for (let i = rint(6, 14); i > 0; i--) path.push({ joy: rng.pick(['', 'r', 'l', 'u', 'd']) }); }
  }
  const shieldAt = new Map(), unshieldAt = new Set();
  for (let f = rint(3, 12); f < FRAMES - 25;) {
    const len = rint(3, 18), kindv = rng.next();
    let tx = rint(0, 511), ty = rint(0, 191);
    if (kindv < 0.5) { tx = Math.min(511, Math.max(0, 256 + rint(-120, 120))); ty = Math.min(191, Math.max(0, 96 + rint(-60, 60))); }
    const r = rng.chance(0.5) ? rectFromBytes(tx / 8 | 0, (tx / 8 | 0) + rint(0, 8), Math.max(0, ty - rint(0, 8)), ty + rint(0, 40)) : [tx - rint(0, 30), ty - rint(0, 20), rint(8, 100), rint(4, 50)];
    shieldAt.set(f, kindv > 0.6 ? 'near' : r);              // 'near': a rectangle on the pointer drawn at that moment
    unshieldAt.add(f + len);
    f += len + rint(1, 14);
  }
  // ---- strict frames
  const st = { strict: 0, mism: 0, vErr: 0, deadline: 0, stackErr: 0, shielded: 0, carried: 0, erasedNow: 0 };
  const isrT = []; let maxOff = 0, maxOff2 = 0, firstMis = '';
  const frameRender = (label) => {
    const want = pm.display(), px = want.px;
    let bad = 0, first = '';
    for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) {
      const w = px[y * 512 + x] ? 0 : 7, h = (m.pixels[(24 + y) * 640 + 64 + x]) & 7;
      if (h !== w) { bad++; if (!first) first = `pixel (${x}, ${y}) shows ${h}, model ${w}`; }
    }
    if (bad) { st.mism++; if (!firstMis) firstMis = `${label}: ${bad} pixels differ, first ${first}; pointer at (${pm.pos.x}, ${pm.pos.y}), drawn ${pm.D ? `(${pm.D.x}, ${pm.D.y})` : 'no'}, shield ${pm.S ? JSON.stringify(pm.S) : 'none'}`; }
  };
  let carried = null; const actCost = [], nAct = {};
  for (let f = 0; f <= FRAMES; f++) {
    const inp = f < FRAMES ? path[f] : { joy: '' };
    const joy = joyOf(inp.joy || '');
    setInput(IDLE_ROWS, joy);
    if (!accepted()) { fail(`strict frame ${f}: the frame interrupt of the previous frame is not pending (lost)`); break; }
    for (let a = 0xFE00; a <= 0xFEDF; a++) m.ram[a] = rng.byte();
    const guard = m.ram.slice(0xFE00, 0xFEE0), v0 = frameCount();
    const r = runIsr();
    if (((frameCount() - v0) & 0xFFFF) !== 1) { st.vErr++; fail(`strict frame ${f}: V_FRAMES rose by ${(frameCount() - v0) & 0xFFFF}, want 1`); }
    if (guard.some((v, i) => m.ram[0xFE00 + i] !== v)) { st.stackErr++; fail(`strict frame ${f}: the frame ISR wrote below its 32-byte frame`); }
    isrT.push(r.t); if (r.offIsrp > maxOff) maxOff = r.offIsrp;
    if (r.offIsrp < 0) fail(`strict frame ${f}: the ISR never reached T_ISRP`);
    pm.isr();
    const pr = K.poll(IDLE_ROWS, joy, false);
    if (pr.isrMove) pm.move(pr.isrMove.x, pr.isrMove.y);
    { const d = displayDiff(); if (d) { st.mism++; if (!firstMis) firstMis = `strict frame ${f}: after the ISR ${d}`; } }
    // step 2: this frame's calls: a warp, and at most one shield action (carried over when the erase would not end before the beam)
    if (inp.warp) { direct('K_WARP', { hl: inp.warp[0], de: inp.warp[1] }); K.warp(inp.warp[0], inp.warp[1]); }
    const act = shieldAt.has(f) ? { shield: shieldAt.get(f) } : unshieldAt.has(f) ? { unshield: true } : null;
    if (act) { carried = act; if (carried.shield === 'near') carried = { shield: pm.D ? rectNear(G.pointerRect(pm.D.x, pm.D.y)) : [rint(0, 400), rint(0, 150), 60, 30] }; }
    let acted = false;
    if (carried) {
      const needT = carried.shield && pm.D && G.meets(G.pointerRect(pm.D.x, pm.D.y), G.shieldRect(...carried.shield)) ? 4500 : 1300;
      if (m.tstates - m.frameStart + needT < 8960) {
        const t0 = m.tstates, was = carried.shield ? 'P_SHIELD' + (needT > 1300 ? ' (erase)' : '') : 'P_UNSHIELD';
        if (carried.shield) { direct('P_SHIELD', {}, carried.shield); pm.shield(...carried.shield); st.shielded++; } else { direct('P_UNSHIELD'); pm.unshield(); }
        carried = null; acted = true; actCost.push([was, m.tstates - t0, needT]);
      } else st.carried++;
    }
    const off = m.tstates - m.frameStart; if (off > maxOff2) maxOff2 = off;
    if (off >= 8960 && acted) { st.deadline++; fail(`strict frame ${f}: the ISR and the frame's calls ended at ${off} T`); }
    parkLoop(); M.runFrame(m);
    st.strict++;
    if (!accepted()) { fail(`strict frame ${f}: the frame interrupt was lost at the end of the frame`); break; }
    K.drain(); readLog();
    { const d = ifaceDiff(K); if (d) { st.mism++; if (!firstMis) firstMis = `strict frame ${f}: ${d}`; } }
    frameRender(`strict frame ${f}`);
  }
  const mn = Math.min(...isrT), mx = Math.max(...isrT), sum = isrT.reduce((a, b) => a + b, 0);
  C.check(`flicker test with the joystick: ${st.strict} strict frames, every rendered frame (m.pixels, 512 x 192) and variable set equal the model`, st.mism === 0 && st.strict >= FRAMES, st.mism ? `${st.mism} frames differ, first: ${firstMis}` : `${st.strict} frames, ${st.shielded} P_SHIELD calls, ${st.carried} shield actions carried over`);
  C.check('flicker test: V_FRAMES rose by exactly 1 in every strict frame, no frame interrupt lost (test 8)', st.vErr === 0 && failures.filter((x) => /lost|rose/.test(x)).length === 0);
  C.check('flicker test: the frame ISR stayed within 32 bytes of stack in every strict frame ($FE00-$FEDF untouched)', st.stackErr === 0);
  C.check(`flicker test: the ISR and the calls ended before the beam reached row 0 (offset < 8,960 T), largest ${maxOff2} T`, st.deadline === 0);
  C.check(`deadline: largest T_ISRP offset ${fmt(maxOff)} T + 1,500 = ${fmt(maxOff + 1500)} <= 8,960`, maxOff > 0 && maxOff + 1500 <= 8960);
  for (const f of failures) console.log(`  detail: ${f}`);
  { const by = {}; for (const [w, c] of actCost) { by[w] = Math.max(by[w] ?? 0, c); nAct[w] = (nAct[w] || 0) + 1; } console.log(`  shield actions ${JSON.stringify(nAct)}, cost (max T): ${JSON.stringify(by)}`); }
  console.log(`  ISR over ${isrT.length} strict frames: min ${mn}, mean ${(sum / isrT.length).toFixed(0)}, max ${mx} T; largest T_ISRP offset ${maxOff}`);
}

// ===========================================================================================================================
const parts = [part0, part1, part2, part3, part4, part5, part6];
for (const i of ONLY) {
  console.log(`--- part ${i}`);
  try { parts[i](); }
  catch (e) { C.check(`part ${i} ran to the end`, false, String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
}
console.log(`total assertions in the section checks: ${fmt(N)}`);
C.done();
