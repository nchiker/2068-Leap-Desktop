"use strict";
// kern-mouse.mjs -- slice M, the Kempston mouse (docs/WINDOWS.md section 15, tests 1-3 of 15.4), on the `kern3` cartridge.
// Written from docs/WINDOWS.md 15 and docs/OBJECTS_EVENTS.md 7, 14.1-14.3, 14.8 only (never from the Z80).  The reference is the K2 model
// extended with the mouse (tests/kern-model2.mjs: `mset`, and the optional 4th argument of `poll`) and the S4 pointer model for the display.
//   node tests/kern-mouse.mjs [--seed N] [--polls N] [--frames N] [--offpolls N] [--maxfail N] [--only LIST]
//     --seed N       PRNG seed (printed; default from the clock)
//     --polls N      random direct K_POLL / K_MSET steps with the mouse in use (default 3000)
//     --frames N     random whole frames (the ISR, then the event loop) with the mouse in use (default 800)
//     --offpolls N   random direct steps with the mouse off and its counters changing (default 1500; and 300 frames)
//     --only LIST    parts: 0 TSRun port decode, 1 boot / mouse off, 2 hand-worked, 3 random direct, 4 random frames, 5 clamps, 6 mouse off (default all)
//
// How the ports are read (test 1): through the CPU, `IN A,(C)` run as a tiny routine at $D300 (every one of the 256 high bytes), and through
// `m.bus.ioRead` (every low byte with a spread of high bytes).
//
// Readings of the spec (also in the report):
//  M1. Counter steps are signed 8-bit differences, so a difference of 128 reads as -128 (mdx = x - last x, mdy = last y - y, each taken mod 256).
//      Random steps stay within +-127 (an attach / detach changes what the ports read by any amount, and can give 128: the literal reading is used).
//  M2. "Other bits 1" of the button port: bits 3-7 are kept 1 in every test; TSRun returns `buttons & 0xFF`.
//  M3. Other odd ports "still read $FF" (test 1) excludes $xxFF: that is the TS2068's own port ($FF, TSRun's portFF), not floating.
//  M4. While the mouse is on and a K_MSET 1 comes again, the counters are re-read (15.2: "the counters are read into the last-seen values"), so
//      motion since the last poll is dropped.  The model does exactly that.
//  M5. With the mouse on and detached (K_MSET 1 with `attached` false, or a detach in mid-run) the ports read $FF: the model feeds {255, 255, $FF}
//      into the same rule, so a detach is a jump of (255 - last) and a button of none.
import { checks, M, Z, FRAME_T } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, hex, rd16, w16, PRESERVED, ALL_REGS, seedDisplay, PTR_AREA } from './gfx6-lib.mjs';
import { armStack, stackUsed } from './kern-lib.mjs';
import { K2Model, E, KEY_NAMES, loadKeymap, rowsOf, joyOf } from './kern-model2.mjs';
import { ROOT } from '../tools/build.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const POLLS = argVal('--polls', 3000), FRAMES = argVal('--frames', 800), OFFPOLLS = argVal('--offpolls', 1500), MAXFAIL = argVal('--maxfail', 25);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${POLLS} direct steps, ${FRAMES} frames, ${OFFPOLLS} mouse-off steps`);

const C = checks('kern mouse (slice M)');
const NEED = ['K_POLL', 'K_WARP', 'K_GETEV', 'K_POST', 'K_MSET', 'K_MOUSE', 'P_ISRMOVE', 'T_ISRP', 'T_POLLD', 'T_EVLOOP', 'T_EVLOG', 'T_EVN', 'K_RING', 'K_POSTQ',
  'K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST', 'K_AYREG', 'K_EV', 'K_PX', 'K_PY', 'K_BTN', 'K_KPMODE', 'K_CAPS', 'T_IDLE', 'T_RET',
  'V_FRAMES', 'V_SHADOW_F4', 'RESULT', 'P_INIT', 'P_ISR', 'P_ARROW', 'G_INIT', 'GLH', 'PT_LOCK', 'PT_DIRTY'];
const ctx = start(C, NEED, 'kern3');
if (!ctx) { console.log('the kern3 cartridge (with the K2 and slice M symbols) is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const fmt = (n) => n.toLocaleString('en-US');
const KM = loadKeymap(ROOT);
const KIDX = (name) => KEY_NAMES.indexOf(name);
const arrow = Uint8Array.from({ length: 64 }, (_, i) => m.bus.read(S.P_ARROW + i));
const rd8 = (a) => m.ram[a];
let N = 0;                                                       // every individual assertion

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < 5) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  get bad() { return this.nf >= MAXFAIL; }
  end() { C.check(`${this.name}: ${fmt(this.n)} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}

// ---------------------------------------------------------------------------------------------------------------------------
// CPU / frame helpers (the pattern of tests/kern-k2.mjs)
const step1 = () => Z.runZ80(cpu, m.bus, 1, m);
const frameCount = () => rd16(m, S.V_FRAMES);
const accepted = () => cpu.pc === 0x38;
const zeroPtr = () => m.ram.fill(0, PTR_AREA[0], PTR_AREA[1] + 1);
const setInput = (rows, joy) => { for (let r = 0; r < 8; r++) m.keyMatrix[r] = rows[r]; m.joystick[0] = joy; };
const IDLE_ROWS = rowsOf([]);
const asJoy = (j) => (typeof j === 'string' ? joyOf(j) : (j ?? 0xFF));
const carry = (res) => res.regs.f & 1;
const ixiyAlt = (res) => PRESERVED.filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`);

function runIsr(limit = 400000) {
  const sp0 = cpu.sp + 2, ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8), t0 = m.tstates;
  let steps = 0;
  while (!(cpu.pc === ret && cpu.sp === sp0)) { step1(); if (++steps > limit) throw new Error(`the frame ISR did not return (PC ${hex(cpu.pc)}, SP ${hex(cpu.sp)})`); }
  return { t: m.tstates - t0 };
}
const finishPending = () => { if (accepted()) runIsr(); };
function parkIdle() { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_IDLE; }
function parkLoop() { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_EVLOOP; }
function isrNow() {
  const pc0 = cpu.pc, sp0 = cpu.sp, t = Z.irqZ80(cpu, m.bus);
  if (!t) return null;
  m.tstates += t;
  let g = 0;
  while (!(cpu.pc === pc0 && cpu.sp === sp0)) { step1(); if (++g > 400000) throw new Error(`the frame ISR did not return (PC ${hex(cpu.pc)})`); }
  return g;
}
function prime() {
  for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { parkLoop(); M.runFrame(m); }
  parkLoop(); M.runFrame(m);
  if (!accepted()) throw new Error(`prime: no frame interrupt pending (PC ${hex(cpu.pc)})`);
}
const direct = (name, regs = {}, o = {}) => call(m, S, name, regs, { rng, ...o });

// ---------------------------------------------------------------------------------------------------------------------------
// The mouse as the machine has it: the host's counters (m.mouse) and what the ports read right now.
const mouseDetached = () => { m.mouse.attached = false; m.mouse.x = 0; m.mouse.y = 0; m.mouse.buttons = 0xFF; };
/** What the three ports read now: attached -> the fields, else $FF (15.1). */
const eff = () => (m.mouse.attached ? { x: m.mouse.x & 0xFF, y: m.mouse.y & 0xFF, buttons: m.mouse.buttons & 0xFF } : { x: 0xFF, y: 0xFF, buttons: 0xFF });
const BTN = (right, left, middle) => 0xF8 | (right ? 0 : 1) | (left ? 0 : 2) | (middle ? 0 : 4);   // active low; other bits 1 (M2)
const hostMove = (dx, dy) => { m.mouse.x = (m.mouse.x + dx) & 0xFF; m.mouse.y = (m.mouse.y + dy) & 0xFF; };   // dy > 0: the counter grows = the mouse moves up the screen
const hostSet = (o) => { Object.assign(m.mouse, o); };
/** A random host motion, a button change now and then. */
function randomMotion(bias = 0.45) {
  const r = rng.next();
  if (r < bias) { /* no motion */ }
  else if (r < bias + 0.3) hostMove(rng.int(-4, 4), rng.int(-4, 4));
  else if (r < bias + 0.45) hostMove(rng.int(-127, 127), rng.int(-127, 127));
  else hostMove(rng.pick([127, -127, 0, 1, -1]), rng.pick([127, -127, 0, 1, -1]));
  if (rng.chance(0.18)) m.mouse.buttons = BTN(rng.chance(0.4), rng.chance(0.45), rng.chance(0.4));
}

// ---------------------------------------------------------------------------------------------------------------------------
// The kernel model and the display model (as kern-k2).
let K = null, scr = null, pm = null;
const resetPm = () => { scr = new G.Gfx6Model(); scr.loadRam(m.ram); pm = new G.PointerModel(scr, arrow); };
function nameOf(a) {
  if (a >= S.K_RING && a < S.K_RING + 64) return `K_RING[${a - S.K_RING}] (record ${(a - S.K_RING) >> 2} byte ${(a - S.K_RING) & 3})`;
  if (a >= S.K_POSTQ && a < S.K_POSTQ + 16) return `K_POSTQ[${a - S.K_POSTQ}]`;
  for (const n of ['K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST', 'K_PY', 'K_BTN', 'K_KPMODE', 'K_CAPS', 'K_MOUSE']) if (a === S[n]) return n;
  if (a === S.K_PX || a === S.K_PX + 1) return `K_PX+${a - S.K_PX}`;
  if (a >= S.K_EV && a < S.K_EV + 4) return `K_EV+${a - S.K_EV}`;
  return hex(a);
}
function ifaceDiff(model) {
  const d = [];
  for (const [a, v] of model.ifaceBytes(S)) if (m.ram[a] !== v) d.push(`${nameOf(a)} = ${m.ram[a]}, model ${v}`);
  return d.length ? `${d.length} variable byte(s) differ: ${d.slice(0, 4).join('; ')}` : null;
}
function resync() { K.loadIface(m.ram, S); if (pm) pm.move(K.px, K.py); }
function displayDiff(p = pm) {
  const want = p.displayBytes(), d = G.compareBytes(m.ram, want);
  if (!d) return null;
  const off = d.addr & 0x1FFF, y = ((off >> 11) & 3) * 64 + ((off >> 5) & 7) * 8 + ((off >> 8) & 7), bc = (off & 31) * 2 + (d.addr >= 0x6000 ? 1 : 0);
  return `display byte (column ${bc}, row ${y}) at ${hex(d.addr)} = ${hex(d.got, 2)}, model ${hex(d.want, 2)} (pointer model: position (${p.pos.x}, ${p.pos.y}), drawn ${p.D ? `(${p.D.x}, ${p.D.y})` : 'no'})`;
}
const evText = (list) => list.map((e) => `[${e.join(',')}]`).join(' ');

/** Idle input, the mouse off and detached, a few ISRs to release everything, drain the queues, and build the model from the machine. */
function quiesce() {
  finishPending();
  setInput(IDLE_ROWS, 0xFF); parkIdle();
  if (rd8(S.K_MOUSE)) call(m, S, 'K_MSET', { a: 0 }, { rng });
  mouseDetached();
  if (rd8(S.K_KPMODE)) { setInput(rowsOf([0, 36]), 0xFF); isrNow(); setInput(IDLE_ROWS, 0xFF); isrNow(); }
  if (rd8(S.K_CAPS)) { setInput(rowsOf([0, KIDX('2')]), 0xFF); isrNow(); setInput(IDLE_ROWS, 0xFF); isrNow(); }
  m.ram[S.PT_LOCK] = 0;
  for (let i = 0; i < 4; i++) isrNow();
  m.ram[S.K_LOST] = 0;
  for (let g = 0; g < 100; g++) { const r = call(m, S, 'K_GETEV', {}, { rng, ints: true }); if (carry(r)) break; }
  K = new K2Model(KM).loadIface(m.ram, S).idlePoll();
  m.ram.fill(0, S.T_EVN, S.T_EVN + 2); evnSeen = 0;
}
function blankScene() {
  quiesce();
  zeroPtr(); m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
  direct('G_INIT'); m.ram[S.GLH] = 8;
  resetPm();
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
function drainMachine() {
  const out = [];
  for (let g = 0; g < 40; g++) { const r = call(m, S, 'K_GETEV', {}, { rng, ints: true }); if (carry(r)) break; out.push(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))); }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// One direct K_POLL / K_MSET against the model.
let pollMaxStack = 0, pollMaxStackWhat = '', MS = { calls: 0, on: 0, off: 0 };
/**
 * One direct K_POLL against the model with the keys / joystick set and the mouse as it stands now (the host counters in m.mouse), the event
 * stream, K_PX, K_PY, K_BTN, K_MOUSE and the rest of 14.1 compared; then P_ISR and the display.
 */
function pollStep(sec, rows, joy, { lock = false, what = '', display = true } = {}) {
  setInput(rows, joy);
  if (lock) m.ram[S.PT_LOCK] = 1;
  const pat = (N & 1) ? 0x55 : 0xAA;
  armStack(m, pat);
  const res = call(m, S, 'K_POLL', {}, { rng, ints: false });
  const used = stackUsed(m, pat);
  if (used > pollMaxStack) { pollMaxStack = used; pollMaxStackWhat = what; }
  m.ram[S.PT_LOCK] = 0;
  const pr = K.poll(rows, joy, lock, eff());
  const ch = ixiyAlt(res);
  sec.ok(ch.length === 0, () => `K_POLL (${what}): changed ${ch.join(', ')} (section 5: IX, IY, alternates preserved)`);
  sec.ok(res.sp === 0xFF00, () => `K_POLL (${what}): SP ${hex(res.sp)} after the return`);
  sec.ok(used <= 20, () => `K_POLL (${what}): used ${used} bytes of stack below its return address (14.5: at most 20)`);
  const d = ifaceDiff(K);
  const mo = m.mouse;
  sec.ok(d === null, () => `K_POLL (${what}) rows [${rows.map((r) => r.toString(16)).join(' ')}] joy ${hex(joy, 2)}${lock ? ' lock' : ''} mouse ${K.mouseOn ? 'on' : 'off'} ports (${eff().x}, ${eff().y}, ${hex(eff().buttons, 2)}, attached ${mo.attached}): ${d}; model appended ${pr.appended.map((a) => `[${a.rec}] ${a.how}`).join(' ') || 'nothing'}`);
  sec.ok(rd16(m, S.K_PX) === K.px && rd8(S.K_PY) === K.py && rd8(S.K_BTN) === K.btn, () => `K_POLL (${what}): K_PX ${rd16(m, S.K_PX)} K_PY ${rd8(S.K_PY)} K_BTN ${rd8(S.K_BTN)}, model ${K.px} ${K.py} ${K.btn}`);
  if (pr.isrMove) pm.move(pr.isrMove.x, pr.isrMove.y);
  if (d) resync();
  if (display) {
    direct('P_ISR'); pm.isr();
    const dd = displayDiff(); sec.ok(dd === null, () => `after K_POLL (${what}) and P_ISR: ${dd}`);
  }
  return pr;
}
/** K_MSET by a direct call: on = a random non-zero A (A != 0), off = 0.  The model reads the ports at this moment. */
function msetStep(sec, on, what = '') {
  const before = m.ram.slice();
  const a = on ? rng.pick([1, 1, 2, 0x80, 0xFF, rng.int(1, 255)]) : 0;
  const res = call(m, S, 'K_MSET', { a }, { rng, ints: false });
  K.mset(on, eff()); MS.calls++; on ? MS.on++ : MS.off++;
  const ch = [...ixiyAlt(res), ...['d', 'e'].filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`)];
  sec.ok(ch.length === 0, () => `K_MSET ${a} (${what}): changed ${ch.join(', ')} (15.2: clobbers AF, BC, HL only)`);
  sec.ok(res.sp === 0xFF00 && res.iff1 === false, () => `K_MSET: SP ${hex(res.sp)} / iff1 ${res.iff1}`);
  sec.ok(m.ram[S.K_MOUSE] === (on ? 1 : 0), () => `K_MSET ${a} (${what}): K_MOUSE = ${m.ram[S.K_MOUSE]}, want ${on ? 1 : 0} (15.2: 1 for A != 0, 0 for A = 0)`);
  const d = ifaceDiff(K); sec.ok(d === null, () => `K_MSET ${a} (${what}): ${d}`);
  // nothing else in 14.1 changes (K_MSET writes K_MOUSE and the poll's internal state only)
  const diffs = []; for (const [lo, hi] of [[0x4000, 0xF0BF], [0xF0C6, 0xFAFF]]) for (let x = lo; x <= hi; x++) if (m.ram[x] !== before[x] && !(x >= S.K_EV && x < S.K_EV + 4 && false)) diffs.push(x);
  sec.ok(diffs.length === 0 || diffs.every((x) => x >= 0xF090 && x <= 0xF0BF), () => `K_MSET changed RAM outside $F090-$F0BF and K_MOUSE / $F0C5: ${diffs.slice(0, 4).map((x) => hex(x)).join(' ')}`);
  if (d) resync();
}

// ===========================================================================================================================
// Part 0: test 1, TSRun's port decode
const CODE = 0xD300;
function readPortCpu(port) {
  const save = [m.ram[CODE], m.ram[CODE + 1], m.ram[CODE + 2]];
  m.ram[CODE] = 0xED; m.ram[CODE + 1] = 0x78; m.ram[CODE + 2] = 0xC9;       // IN A,(C) ; RET
  const r = call(m, S, CODE, { bc: port, a: 0x5A }, { ints: false });
  m.ram[CODE] = save[0]; m.ram[CODE + 1] = save[1]; m.ram[CODE + 2] = save[2];
  return r.regs.a;
}
function part0() {
  const sec = new Sec('test 1, TSRun port decode');
  quiesce();
  sec.ok(m.mouse && typeof m.mouse.attached === 'boolean' && 'x' in m.mouse && 'y' in m.mouse && 'buttons' in m.mouse, 'm.mouse = { attached, x, y, buttons } exists');
  mouseDetached();
  m.mouse.x = 0x12; m.mouse.y = 0x34; m.mouse.buttons = 0xF8;                    // values that must not leak while detached
  let n = 0;
  for (let hi = 0; hi < 256; hi++) { const v = readPortCpu((hi << 8) | 0xDF); n++; sec.ok(v === 0xFF, () => `detached: IN A,(C) of $${hi.toString(16).padStart(2, '0')}DF = ${hex(v, 2)}, want $FF`); }
  for (let hi = 0; hi < 256; hi++) { const v = m.bus.ioRead((hi << 8) | 0xDF); sec.ok(v === 0xFF, () => `detached: ioRead $${hi.toString(16).padStart(2, '0')}DF = ${hex(v, 2)}, want $FF`); }
  const sets = [[0x00, 0xFF, 0xFF], [0xFF, 0x00, 0xFD], [0x12, 0x34, 0xF8], [0x80, 0x7F, 0xFE], [0xA5, 0x5A, 0xFB], [0x01, 0xFE, 0xFA], [0xFF, 0xFF, 0xFF]];
  for (let i = 0; i < 6; i++) sets.push([rng.byte(), rng.byte(), 0xF8 | rng.int(0, 7)]);
  for (const [x, y, b] of sets) {
    hostSet({ attached: true, x, y, buttons: b });
    for (let hi = 0; hi < 256; hi++) {
      const port = (hi << 8) | 0xDF;
      const want = !(hi & 0x01) ? b : !(hi & 0x04) ? x : y;                       // 15.1: buttons when A8 = 0, x when A8 = 1 and A10 = 0, y when A8 = 1 and A10 = 1
      const v = readPortCpu(port), v2 = m.bus.ioRead(port);
      n++;
      sec.ok(v === want && v2 === want, () => `attached (x ${hex(x, 2)}, y ${hex(y, 2)}, buttons ${hex(b, 2)}): $${hi.toString(16).padStart(2, '0')}DF reads ${hex(v, 2)} (CPU) / ${hex(v2, 2)} (ioRead), want ${hex(want, 2)}`);
    }
  }
  // the three named ports, hand-spelled
  hostSet({ attached: true, x: 0x37, y: 0xC4, buttons: 0xFD });
  sec.ok(readPortCpu(0xFADF) === 0xFD && readPortCpu(0xFBDF) === 0x37 && readPortCpu(0xFFDF) === 0xC4, () => `$FADF ${hex(readPortCpu(0xFADF), 2)} (want $FD), $FBDF ${hex(readPortCpu(0xFBDF), 2)} (want $37), $FFDF ${hex(readPortCpu(0xFFDF), 2)} (want $C4)`);
  // other odd ports still read $FF while attached (all odd low bytes except $DF and the TS2068's $FF; M3)
  let odd = 0;
  for (let lo = 1; lo < 256; lo += 2) {
    if (lo === 0xDF || lo === 0xFF) continue;
    const highs = lo === 0xF5 || lo === 0x1F || lo === 0xDD || lo === 0xDB || lo === 0x5F ? [...Array(256).keys()] : [0, 1, 0xFA, 0xFB, 0xFF, 0x04, 0x05, rng.byte(), rng.byte()];
    for (const hi of highs) { const v = m.bus.ioRead((hi << 8) | lo); odd++; sec.ok(v === 0xFF, () => `attached: ioRead $${hi.toString(16).padStart(2, '0')}${lo.toString(16).padStart(2, '0')} = ${hex(v, 2)}, want $FF (only low byte $DF is the mouse)`); }
  }
  for (const port of [0xFBDD, 0xFFDB, 0xFB5F, 0xFFD7, 0xFADF ^ 0x80, 0xFADF ^ 0x40, 0xFADF ^ 0x10, 0xFADF ^ 0x08, 0xFADF ^ 0x04, 0xFADF ^ 0x02, 0xFBDF ^ 0x80, 0xFFDF ^ 0x10]) {   // (a port one bit away from $xxDF in the low byte)
    if ((port & 0xFF) === 0xDF || (port & 1) === 0) continue;
    const v = readPortCpu(port); sec.ok(v === 0xFF, () => `attached: IN A,(C) of ${hex(port)} = ${hex(v, 2)}, want $FF`);
  }
  // an even low byte is the keyboard (not part of this test): the mouse does not answer there
  setInput(IDLE_ROWS, 0xFF);
  for (const port of [0xFADE, 0xFBDE, 0xFFDE]) { const v = readPortCpu(port); sec.ok((v & 0x1F) === 0x1F, () => `attached: ${hex(port)} (low byte $DE, the keyboard) = ${hex(v, 2)}: the mouse must not answer at an even port`); }
  mouseDetached();
  // a fresh machine starts detached ("createMachine starts it detached")
  { const fresh = M.createMachine(new Uint8Array(9).fill(0x1F), new Uint8Array(2).fill(0xFF)); sec.ok(fresh.mouse.attached === false, 'createMachine starts the mouse detached'); }
  sec.end();
  console.log(`  port decode: ${n} CPU / ioRead reads of $xxDF, ${odd} reads of other odd ports`);
}

// ===========================================================================================================================
// Part 1: the boot state (the mouse is off in kern3) and a fresh run with the mouse off
function part1() {
  const sec = new Sec('boot: the mouse is off');
  sec.ok(S.K_MOUSE === 0xF0C4, () => `K_MOUSE = ${hex(S.K_MOUSE)}, want $F0C4 (15.2)`);
  sec.ok(bootK_MOUSE === 0, () => `K_MOUSE after boot = ${bootK_MOUSE} (15.2: boot leaves it 0)`);
  sec.end();
}
const bootK_MOUSE = m.ram[S.K_MOUSE];

// ===========================================================================================================================
// Part 2: hand-worked cases, independent of the model's code paths (numbers computed by hand from 15.2), each also run against the model
function part2() {
  const sec = new Sec('hand-worked: motion, wrap, buttons, K_MSET, clamps');
  blankScene();
  const events = () => drainMachine();
  const P = (rows = IDLE_ROWS, joy = 0xFF, what = 'hand') => pollStep(sec, rows, joy, { what, display: true });
  const warp = (x, y) => { direct('K_WARP', { hl: x, de: y }); K.warp(x, y); };
  const cur = () => [rd16(m, S.K_PX), rd8(S.K_PY)];
  warp(256, 96); P();                                               // (256, 96), mouse off
  // detached, K_MSET 1: reads $FF: no jump
  hostSet({ attached: true, x: 250, y: 3, buttons: BTN(0, 0, 0) });
  // off: motion and the left button change nothing
  hostMove(40, 40); m.mouse.buttons = BTN(1, 1, 1); P(); P();
  sec.ok(cur()[0] === 256 && cur()[1] === 96 && rd8(S.K_BTN) === 0 && events().length === 0, () => `mouse off: counters and buttons changed: pointer ${cur()}, K_BTN ${rd8(S.K_BTN)} (15.2: no mouse effect)`);
  K.drain();
  m.mouse.buttons = BTN(0, 0, 0); m.mouse.x = 250; m.mouse.y = 3;
  msetStep(sec, true, 'on');                                        // no jump on
  P(); sec.ok(cur()[0] === 256 && cur()[1] === 96 && events().length === 0, 'K_MSET 1 then a poll with unchanged counters: no jump, no event'); K.drain();
  // x 250 -> 4 (+10 by wrap), y counter 3 -> 8 (+5: up 5): (266, 91): E_MOVE data [10, 91, 1 (x bit 8)]
  hostSet({ x: 4, y: 8 }); P();
  sec.ok(cur()[0] === 266 && cur()[1] === 91, () => `x 250 -> 4, y 3 -> 8: pointer ${cur()}, want (266, 91) (+10 across the wrap, 5 up)`);
  { const ev = events(); sec.ok(JSON.stringify(ev) === '[[2,10,91,1]]', () => `E_MOVE = ${evText(ev)}, want [2,10,91,1]`); } K.drain();
  // a step of +127 and one of -127 in x, y both ways
  hostMove(127, -127); P(); sec.ok(cur()[0] === 266 + 127 && cur()[1] === 191, () => `+127 / y counter -127 (down 127): pointer ${cur()}, want (393, 191) (91 + 127 = 218, clamped)`);
  hostMove(-127, 127); P(); hostMove(-127, 127); P();
  events(); K.drain();
  // buttons: left (bit 1) = E_DOWN / K_BTN 1; right (bit 0) and middle (bit 2) make nothing
  warp(256, 96); P(); events(); K.drain();
  m.mouse.buttons = BTN(1, 0, 0); P(); sec.ok(rd8(S.K_BTN) === 0 && events().length === 0, 'right button only: no K_BTN, no event'); K.drain();
  m.mouse.buttons = BTN(0, 0, 1); P(); sec.ok(rd8(S.K_BTN) === 0 && events().length === 0, 'middle button only: no K_BTN, no event'); K.drain();
  m.mouse.buttons = BTN(1, 0, 1); P(); sec.ok(rd8(S.K_BTN) === 0 && events().length === 0, 'right + middle: no K_BTN, no event'); K.drain();
  m.mouse.buttons = BTN(0, 1, 0); P();
  { const ev = events(); sec.ok(rd8(S.K_BTN) === 1 && JSON.stringify(ev) === '[[3,0,96,3]]', () => `left button: K_BTN ${rd8(S.K_BTN)}, events ${evText(ev)}, want [3,0,96,3] (E_DOWN at (256, 96), data 3 = bit 8 + button 2)`); } K.drain();
  m.mouse.buttons = BTN(1, 1, 1); P(); sec.ok(rd8(S.K_BTN) === 1 && events().length === 0, 'left + right + middle held: still down, no new event'); K.drain();
  m.mouse.buttons = BTN(1, 0, 1); P(); { const ev = events(); sec.ok(rd8(S.K_BTN) === 0 && JSON.stringify(ev) === '[[4,0,96,1]]', () => `left released (right + middle held): K_BTN ${rd8(S.K_BTN)}, events ${evText(ev)}, want [4,0,96,1]`); } K.drain();
  m.mouse.buttons = BTN(0, 0, 0); P(); events(); K.drain();
  // left with the joystick fire: ORed; releasing one keeps the other
  m.mouse.buttons = BTN(0, 1, 0); P(rowsOf([]), joyOf('f')); events(); K.drain();
  m.mouse.buttons = BTN(0, 0, 0); P(rowsOf([]), joyOf('f')); sec.ok(rd8(S.K_BTN) === 1 && events().length === 0, 'left released while joystick fire is held: the button stays down'); K.drain();
  P(); sec.ok(rd8(S.K_BTN) === 0, 'then fire released: up'); events(); K.drain();
  // all four joystick directions + left button: fire from the mouse still counts (the 4-direction rule is the joystick's)
  m.mouse.buttons = BTN(0, 1, 0); P(rowsOf([]), joyOf('udlrf')); sec.ok(rd8(S.K_BTN) === 1, 'left button with all four directions down: the button is down (15.2 step 4: fire ORed with mb)'); events(); K.drain();
  m.mouse.buttons = BTN(0, 0, 0); P(); events(); K.drain();
  // keyboard-pointer mode SPACE ORed too
  P(rowsOf([0, 36])); events(); K.drain(); P(); events(); K.drain();
  m.mouse.buttons = BTN(0, 1, 0); P(rowsOf([KIDX('SPACE')])); P(rowsOf([])); sec.ok(rd8(S.K_BTN) === 1, 'keyboard-pointer mode: SPACE released with the left button held: still down'); events(); K.drain();
  m.mouse.buttons = BTN(0, 0, 0); P(); P(rowsOf([0, 36])); P(); events(); K.drain();
  // left held, then K_MSET 0: the next poll releases it (no stuck button), mouse motion ignored from then on
  m.mouse.buttons = BTN(0, 1, 0); P(); sec.ok(rd8(S.K_BTN) === 1, 'left down'); events(); K.drain();
  const px0 = cur();
  msetStep(sec, false, 'off with the left button held'); hostMove(30, 30);
  P(); { const ev = events(); sec.ok(rd8(S.K_BTN) === 0 && JSON.stringify(ev) === `[[4,${px0[0] & 255},${px0[1]},${(px0[0] >> 8) | 1}]]`, () => `K_MSET 0 with the left button held: K_BTN ${rd8(S.K_BTN)}, events ${evText(ev)}, want one E_UP at ${px0}`); } K.drain();
  sec.ok(cur()[0] === px0[0] && cur()[1] === px0[1], 'K_MSET 0: the mouse moved by 30 and nothing followed');
  P(); P(); sec.ok(events().length === 0 && rd8(S.K_BTN) === 0, 'mouse off, left still held on the host: no event, no button'); K.drain();
  // on again with the left button still held and the counters changed while off: no jump, then the button goes down at the next poll
  hostMove(77, -50);
  msetStep(sec, true, 'on again'); P(); { const ev = events(); sec.ok(cur()[0] === px0[0] && cur()[1] === px0[1] && rd8(S.K_BTN) === 1 && ev.length === 1 && ev[0][0] === 3, () => `K_MSET 1 with counters moved while off and the left button held: pointer ${cur()}, K_BTN ${rd8(S.K_BTN)}, events ${evText(ev)} (no jump, E_DOWN)`); } K.drain();
  m.mouse.buttons = BTN(0, 0, 0); P(); events(); K.drain();
  // K_MSET 1 again while on: the counters are re-read (M4): motion since the last poll is dropped
  hostMove(20, 20); msetStep(sec, true, 'on while on'); P(); sec.ok(cur()[0] === px0[0] && events().length === 0, 'K_MSET 1 while on re-reads the counters: the motion since the last poll is dropped'); K.drain();
  // mouse motion with a pending K_WARP: the warp replaces the position first, then the motion is added (14.3 step 1, 15.2 step 5)
  warp(100, 100); hostMove(5, -7); P(); sec.ok(cur()[0] === 105 && cur()[1] === 107, () => `K_WARP (100, 100) then +5 / down 7 in the same poll: ${cur()}, want (105, 107)`); events(); K.drain();
  // wrap and the signed range: +128 counter steps in two polls of +64 and +64; -1 across 0 -> 255
  hostSet({ x: 0, y: 0 }); msetStep(sec, true, 'on at 0, 0'); P(); events(); K.drain();
  warp(300, 100); P(); events(); K.drain();
  hostMove(-1, 0); P(); sec.ok(cur()[0] === 299, () => `counter 0 -> 255 is -1: pointer x ${cur()[0]}, want 299`);
  hostMove(1, 0); P(); sec.ok(cur()[0] === 300, () => `counter 255 -> 0 is +1: pointer x ${cur()[0]}, want 300`);
  hostMove(0, -1); P(); sec.ok(cur()[1] === 101, () => `y counter 0 -> 255 (the mouse moved down one): pointer y ${cur()[1]}, want 101`);
  hostMove(0, 1); P(); sec.ok(cur()[1] === 100, () => `y counter 255 -> 0 (up one): pointer y ${cur()[1]}, want 100`);
  events(); K.drain();
  // K_MSET 0 mid-run, counters change, on again at once: no jump (both orders)
  msetStep(sec, false, 'off'); hostMove(-100, 90); msetStep(sec, true, 'on'); P(); sec.ok(cur()[0] === 300 && cur()[1] === 100, 'off, big counter change, on: no jump');
  events(); K.drain();
  m.mouse.buttons = BTN(0, 0, 0);
  msetStep(sec, false, 'off'); P();
  sec.end();
}

// ===========================================================================================================================
// Part 3: random direct K_POLL / K_MSET steps against the model
function randomInput(st) {
  // the keys, as kern-k2's fuzz
  const r = rng.next();
  if (r < 0.30) { const s = new Set(st.keys); const k = rng.int(0, 39); if (s.has(k)) s.delete(k); else if (s.size < 4) s.add(k); st.keys = s; }
  else if (r < 0.36) st.keys = new Set();
  else if (r < 0.40) st.keys = new Set([0, 36]);
  else if (r < 0.43) st.keys = new Set([0, KIDX('2')]);
  else if (r < 0.50) st.keys = new Set([rng.pick([KIDX('Q'), KIDX('A'), KIDX('O'), KIDX('P'), KIDX('SPACE')]), ...(rng.chance(0.3) ? [0] : [])]);
  if (rng.chance(0.25)) { let j = ''; for (const c of 'udlrf') if (rng.chance(c === 'f' ? 0.3 : 0.28)) j += c; if (rng.chance(0.03)) j = 'udlrf'; st.joy = joyOf(j); }
}
const EDGEX = [0, 1, 2, 3, 5, 12, 100, 256, 400, 498, 505, 508, 509, 510, 511], EDGEY = [0, 1, 2, 3, 5, 6, 90, 150, 185, 186, 188, 189, 190, 191];
function randomWarp() { return [rng.chance(0.7) ? rng.pick(EDGEX) : rng.pick([rng.int(0, 511), -7, 600, 65535, 32768]), rng.chance(0.7) ? rng.pick(EDGEY) : rng.pick([rng.int(0, 191), -4, 300, 40000])]; }
function part3() {
  const sec = new Sec('test 2a, direct K_POLL / K_MSET against the model (mouse motion, buttons, joystick, keys, keyboard-pointer mode, warps, on / off)');
  blankScene();
  const st = { keys: new Set(), joy: 0xFF };
  m.mouse.attached = true; m.mouse.x = rng.byte(); m.mouse.y = rng.byte(); m.mouse.buttons = BTN(0, 0, 0);
  msetStep(sec, true, 'start');
  let warpN = 0, lockN = 0, onPolls = 0, offPolls = 0, detach = 0, bigN = 0;
  const stats = { mdx: new Set(), edge: 0 };
  for (let i = 0; i < POLLS && !sec.bad; i++) {
    randomInput(st);
    const x0 = m.mouse.x, y0 = m.mouse.y;
    randomMotion(); if (Math.abs(((m.mouse.x - x0 + 128) & 255) - 128) >= 100 || Math.abs(((m.mouse.y - y0 + 128) & 255) - 128) >= 100) bigN++;
    if (rng.chance(0.04)) { const [x, y] = randomWarp(); direct('K_WARP', { hl: w16(x), de: w16(y) }); K.warp(w16(x), w16(y)); warpN++; }
    if (rng.chance(0.05)) msetStep(sec, K.mouseOn ? false : true, `step ${i}`);
    else if (rng.chance(0.02)) msetStep(sec, true, `step ${i}, on again`);
    if (rng.chance(0.01)) { m.mouse.attached = !m.mouse.attached; detach++; }
    if (rng.chance(0.03)) { hostMove(rng.int(-127, 127), rng.int(-127, 127)); }     // a jump between the K_MSET and the poll
    const lock = rng.chance(0.08); if (lock) lockN++;
    if (K.mouseOn) onPolls++; else offPolls++;
    pollStep(sec, rowsOf([...st.keys]), st.joy, { lock, what: `step ${i}`, display: i % 2 === 0 || rng.chance(0.2) });
    if (rng.chance(0.25)) {
      for (let g = rng.int(1, 4); g > 0; g--) { const rr = call(m, S, 'K_GETEV', {}, { rng, ints: true }); const e = K.getev(); sec.ok(carry(rr) === e.carry, () => `step ${i}: K_GETEV carry ${carry(rr)}, model ${e.carry}`); if (!e.carry) sec.ok(JSON.stringify(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))) === JSON.stringify(K.ev), () => `step ${i}: K_GETEV record ${Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))}, model ${K.ev}`); }
      const d = ifaceDiff(K); sec.ok(d === null, () => `after K_GETEV: ${d}`); if (d) resync();
    }
    if (K.px === 0 || K.px === 511 || K.py === 0 || K.py === 191) stats.edge++;
  }
  // end: drain and compare the whole stream once more
  { const got = drainMachine(), want = K.clone().drain(); sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `final drain: ${evText(got)} vs model ${evText(want)}`); K.drain(); }
  console.log(`  direct: ${POLLS} steps (${onPolls} with the mouse on, ${offPolls} off), ${MS.calls} K_MSET calls (${MS.on} on, ${MS.off} off), ${warpN} warps, ${lockN} locked, ${detach} attach / detach flips, ${bigN} polls with a step of 100 or more in x or y, pointer at an edge after ${stats.edge} steps; K_POLL stack at most ${pollMaxStack} B (${pollMaxStackWhat})`);
  m.mouse.buttons = BTN(0, 0, 0);
  setInput(IDLE_ROWS, 0xFF); m.ram[S.PT_LOCK] = 0;
  sec.end();
  C.check(`K_POLL stack with the mouse in use: at most ${pollMaxStack} bytes below its return address (14.5: <= 20)`, pollMaxStack <= 20);
  quiesce();
}

// ===========================================================================================================================
// Part 4: random whole frames (the ISR with the mouse, then the event loop), the pointer drawn one frame later
const FR = { frames: 0, events: 0, moveEv: 0, downUp: 0, maxStack: 0, vErr: 0, lostIrq: 0, isrMax: 0, onFrames: 0 };
/**
 * One strict frame (kern-k2 part 4): the inputs (keys, joystick, the host mouse as it stands) are set; the pending frame interrupt is stepped to its RET;
 * the display must equal "the S4 model with the pointer where the previous frame's K_POLL put it" (the pointer drawn one frame later); K_PX, K_PY, K_BTN and
 * the whole of 14.1 equal the model's; then the frame's direct calls (K_WARP, counters changing and K_MSET between frames); then the event loop runs the
 * rest of the frame and its log must equal the model's drain.
 * fs: { keys, joy, mouse: {x, y, buttons, attached} (applied before the ISR), warp: [x, y], counters2: patch, mset: 0 | 1 }.
 */
function strictFrame(sec, fs, label) {
  const rows = rowsOf(fs.keys || []), joy = asJoy(fs.joy);
  setInput(rows, joy);
  if (fs.mouse) hostSet(fs.mouse);
  if (!accepted()) { sec.ok(false, `${label}: the frame interrupt is not pending (lost)`); return false; }
  const pat = (FR.frames & 1) ? 0x55 : 0xAA;
  armStack(m, pat);
  const v0 = frameCount();
  const r = runIsr();
  const used = stackUsed(m, pat) + 2;
  FR.frames++; FR.maxStack = Math.max(FR.maxStack, used); FR.isrMax = Math.max(FR.isrMax, r.t); if (K.mouseOn) FR.onFrames++;
  if (((frameCount() - v0) & 0xFFFF) !== 1) { FR.vErr++; sec.ok(false, `${label}: V_FRAMES rose by ${(frameCount() - v0) & 0xFFFF}, want 1`); } else sec.ok(true);
  sec.ok(used <= 32, () => `${label}: the frame ISR used ${used} bytes of stack with its return address (section 7 / 8: at most 32)`);
  sec.ok(m.ayLatch === rd8(S.K_AYREG) && m.portF4 === rd8(S.V_SHADOW_F4), () => `${label}: after the ISR the AY latch / $F4 are not the shadows (section 7 item 4)`);
  pm.isr();                                                             // the pointer is drawn at the position of the previous frame's poll
  const pr = K.poll(rows, joy, false, eff());
  if (pr.isrMove) pm.move(pr.isrMove.x, pr.isrMove.y);
  { const d = displayDiff(); sec.ok(d === null, () => `${label}: after the ISR ${d} (the pointer must be at the model's position of the previous frame)`); }
  { const d = ifaceDiff(K); sec.ok(d === null, () => `${label}: after the ISR ${d}; mouse ${K.mouseOn ? 'on' : 'off'}, ports (${eff().x}, ${eff().y}, ${hex(eff().buttons, 2)}); model appended ${pr.appended.map((a) => `[${a.rec}] ${a.how}`).join(' ') || 'nothing'}`); if (d) resync(); }
  sec.ok(rd16(m, S.K_PX) === K.px && rd8(S.K_PY) === K.py && rd8(S.K_BTN) === K.btn, () => `${label}: K_PX ${rd16(m, S.K_PX)} K_PY ${rd8(S.K_PY)} K_BTN ${rd8(S.K_BTN)}, model ${K.px} ${K.py} ${K.btn}`);
  for (const a of pr.appended) { if (a.rec[0] === E.MOVE) FR.moveEv++; else if (a.rec[0] === E.DOWN || a.rec[0] === E.UP) FR.downUp++; }
  // the frame's direct calls
  if (fs.warp) { call(m, S, 'K_WARP', { hl: w16(fs.warp[0]), de: w16(fs.warp[1]) }, { rng, ints: false }); K.warp(w16(fs.warp[0]), w16(fs.warp[1])); }
  if (fs.counters2) hostSet(fs.counters2);
  if (fs.mset !== undefined) msetStep(sec, !!fs.mset, `${label} (between frames)`);
  parkLoop(); M.runFrame(m);
  if (!accepted()) { FR.lostIrq++; sec.ok(false, `${label}: the frame interrupt was lost at the end of the frame`); return false; }
  const want = K.drain(), got = readLog();
  sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `${label}: the event loop logged ${evText(got) || 'nothing'}, model ${evText(want) || 'nothing'}`);
  FR.events += got.length;
  { const d = ifaceDiff(K); sec.ok(d === null, () => `${label}: after the loop ${d}`); if (d) resync(); }
  return true;
}
function frameFuzz(sec, name, n, { allowOn }) {
  const st = { keys: new Set(), joy: 0xFF };
  let on = K.mouseOn;
  for (let i = 0; i < n && !sec.bad; i++) {
    randomInput(st);
    randomMotion(0.35);
    const fs = { keys: [...st.keys], joy: st.joy, mouse: { ...m.mouse } };
    if (rng.chance(0.04)) fs.warp = randomWarp();
    if (allowOn && rng.chance(0.04)) { on = !on; fs.mset = on ? 1 : 0; if (rng.chance(0.5)) fs.counters2 = { x: rng.byte(), y: rng.byte() }; }
    else if (allowOn && rng.chance(0.02)) fs.mset = 1;
    if (rng.chance(0.005)) fs.mouse.attached = !fs.mouse.attached;
    if (!strictFrame(sec, fs, `${name} frame ${i}`)) return false;
  }
  return true;
}
function part4() {
  const sec = new Sec('test 2b, random whole frames with the mouse (ISR, display one frame later, event log)');
  blankScene(); prime();
  mouseDetached(); hostSet({ attached: true, x: rng.byte(), y: rng.byte(), buttons: BTN(0, 0, 0) });
  for (let i = 0; i < 3; i++) strictFrame(sec, { keys: [], joy: 0xFF, mouse: { ...m.mouse } }, `settle ${i}`);
  strictFrame(sec, { keys: [], joy: 0xFF, mset: 1 }, 'K_MSET 1');
  frameFuzz(sec, 'fuzz', FRAMES, { allowOn: true });
  // a long drag: left down, motion in one direction at full speed, mixed with the joystick, into every edge
  for (const [name, dx, dy, spot] of [['right', 100, 0, [400, 90]], ['left', -100, 0, [100, 90]], ['up', 0, 100, [250, 40]], ['down', 0, -100, [250, 150]], ['corner', 120, 120, [480, 20]], ['corner2', -120, -120, [30, 170]]]) {
    const fr = [{ keys: [], joy: 0xFF, warp: spot }];
    for (let k = 0; k < 8; k++) fr.push({ keys: [], joy: k & 1 ? joyOf(dx > 0 ? 'l' : 'r') : 0xFF, mouse: null, drag: [dx, dy], btn: k < 6 ? BTN(0, 1, 0) : BTN(0, 0, 0) });
    for (const f of fr) {
      if (f.drag) { hostMove(f.drag[0], f.drag[1]); m.mouse.buttons = f.btn; }
      if (!strictFrame(sec, { keys: f.keys, joy: f.joy, warp: f.warp, mouse: { ...m.mouse } }, `drag ${name}`)) break;
    }
  }
  strictFrame(sec, { keys: [], joy: 0xFF, mset: 0, mouse: { ...m.mouse, buttons: BTN(0, 0, 0) } }, 'K_MSET 0');
  strictFrame(sec, { keys: [], joy: 0xFF }, 'quiet');
  setInput(IDLE_ROWS, 0xFF);
  sec.end();
  console.log(`  frames ${fmt(FR.frames)} (${fmt(FR.onFrames)} with the mouse on): ${fmt(FR.events)} events logged (E_MOVE ${FR.moveEv}, E_DOWN/E_UP ${FR.downUp}); ISR stack at most ${FR.maxStack} B, longest ISR ${fmt(FR.isrMax)} T`);
  C.check('every frame of test 2b: V_FRAMES rose by exactly 1, no frame interrupt lost', FR.vErr === 0 && FR.lostIrq === 0, `${FR.vErr} wrong, ${FR.lostIrq} lost`);
  C.check(`frame ISR stack with the mouse in use: ${FR.maxStack} bytes with the return address (section 7 / 8: at most 32)`, FR.maxStack <= 32);
  quiesce();
}

// ===========================================================================================================================
// Part 5: clamping at all four edges (directed: every edge and corner, from inside and on it, steps of +-1, +-127, with and without the joystick)
function part5() {
  const sec = new Sec('test 2c, clamping at all four edges with mouse motion');
  blankScene();
  m.mouse.attached = true; m.mouse.x = 77; m.mouse.y = 200; m.mouse.buttons = BTN(0, 0, 0);
  msetStep(sec, true, 'on');
  const cur = () => [rd16(m, S.K_PX), rd8(S.K_PY)];
  let n = 0;
  const spots = [];
  for (const x of [0, 1, 5, 126, 127, 128, 256, 383, 384, 385, 505, 510, 511]) for (const y of [0, 1, 5, 63, 64, 96, 127, 128, 186, 190, 191]) spots.push([x, y]);
  // hand-worked clamps first: they check the machine against numbers from the spec, not the model
  const hand = [[[5, 5], [-127, 127], [0, 0]], [[500, 185], [127, -127], [511, 191]], [[0, 0], [-1, 1], [0, 0]], [[511, 191], [1, -1], [511, 191]], [[0, 191], [-127, -127], [0, 191]], [[511, 0], [127, 127], [511, 0]],
    [[100, 100], [-127, 0], [0, 100]], [[400, 100], [127, 0], [511, 100]], [[100, 10], [0, 127], [100, 0]], [[100, 180], [0, -127], [100, 191]], [[3, 3], [-2, 2], [1, 1]], [[508, 188], [2, -2], [510, 190]]];
  for (const [[x, y], [dx, dyc], [ex, ey]] of hand) {
    direct('K_WARP', { hl: x, de: y }); K.warp(x, y); pollStep(sec, IDLE_ROWS, 0xFF, { what: `clamp warp (${x}, ${y})` }); drainMachine(); K.drain();
    hostMove(dx, dyc); pollStep(sec, IDLE_ROWS, 0xFF, { what: `clamp hand (${x}, ${y}) + (${dx}, up ${dyc})` }); n++;
    sec.ok(cur()[0] === ex && cur()[1] === ey, () => `from (${x}, ${y}) with counter steps (${dx}, ${dyc}) (y counter up = pointer up): pointer ${cur()}, want (${ex}, ${ey})`);
    drainMachine(); K.drain();
  }
  const steps = [-127, -64, -5, -1, 0, 1, 5, 64, 127];
  for (let i = 0; i < 600 && !sec.bad; i++) {
    const [x, y] = rng.pick(spots);
    direct('K_WARP', { hl: x, de: y }); K.warp(x, y);
    pollStep(sec, IDLE_ROWS, 0xFF, { what: `clamp warp (${x}, ${y})`, display: false });
    const dx = rng.pick(steps), dy = rng.pick(steps);
    hostMove(dx, dy);
    const joy = rng.chance(0.4) ? joyOf(['r', 'l', 'u', 'd', 'rd', 'lu', 'rf', 'ul', 'dr'][rng.int(0, 8)]) : 0xFF;
    // a few polls at hold 0 .. n so the joystick's acceleration (+ up to 12 columns / 6 rows) adds to the mouse's step
    const reps = joy === 0xFF ? 1 : rng.int(1, 40);
    for (let k = 0; k < reps && !sec.bad; k++) { pollStep(sec, IDLE_ROWS, joy, { what: `clamp (${x}, ${y}) mouse (${dx}, ${dy}) joy ${hex(joy, 2)} rep ${k}`, display: k === 0 || k === reps - 1 }); n++; if (k + 1 < reps) hostMove(rng.pick([-1, 0, 1, dx]), rng.pick([-1, 0, 1, dy])); }
    if (K.px === 0 || K.px === 511 || K.py === 0 || K.py === 191) { /* an edge reached */ }
    if (i % 5 === 0) { drainMachine(); K.drain(); }
  }
  console.log(`  clamp: ${n} polls at and near the edges`);
  msetStep(sec, false, 'off'); pollStep(sec, IDLE_ROWS, 0xFF, { what: 'off' });
  sec.end();
  quiesce();
}

// ===========================================================================================================================
// Part 6: with the mouse off, the mouse's counters changing change nothing (15.4 test 3, at the level of the model of 14.3)
function part6() {
  const sec = new Sec('test 3, mouse off: the counters changing change nothing');
  blankScene();
  m.mouse.attached = true; m.mouse.x = rng.byte(); m.mouse.y = rng.byte(); m.mouse.buttons = BTN(0, 0, 0);
  sec.ok(rd8(S.K_MOUSE) === 0, 'K_MOUSE is 0 at the start of the mouse-off steps');
  const st = { keys: new Set(), joy: 0xFF };
  let warpN = 0;
  for (let i = 0; i < OFFPOLLS && !sec.bad; i++) {
    randomInput(st);
    randomMotion(0.2);
    if (rng.chance(0.2)) m.mouse.buttons = BTN(rng.chance(0.5), rng.chance(0.6), rng.chance(0.5));   // the left button often held
    if (rng.chance(0.03)) m.mouse.attached = !m.mouse.attached;
    if (rng.chance(0.04)) { const [x, y] = randomWarp(); direct('K_WARP', { hl: w16(x), de: w16(y) }); K.warp(w16(x), w16(y)); warpN++; }
    pollStep(sec, rowsOf([...st.keys]), st.joy, { lock: rng.chance(0.05), what: `off step ${i}`, display: i % 3 === 0 });
    sec.ok(K.mouseOn === 0 && rd8(S.K_MOUSE) === 0, 'K_MOUSE stays 0');
    if (rng.chance(0.2)) { drainMachine(); K.drain(); }
  }
  // frames
  drainMachine(); K.drain();
  prime(); m.mouse.attached = true;
  for (let i = 0; i < 3; i++) strictFrame(sec, { keys: [], joy: 0xFF, mouse: { ...m.mouse } }, `off settle ${i}`);
  frameFuzz(sec, 'off fuzz', 300, { allowOn: false });
  sec.ok(rd8(S.K_MOUSE) === 0, 'K_MOUSE still 0 after the mouse-off frames');
  console.log(`  mouse off: ${OFFPOLLS} direct steps and 300 frames with the counters and buttons changing; ${warpN} warps`);
  setInput(IDLE_ROWS, 0xFF);
  sec.end();
  quiesce();
}

// ===========================================================================================================================
const parts = [part0, part1, part2, part3, part4, part5, part6];
for (const i of ONLY) {
  console.log(`--- part ${i}`);
  try { parts[i](); }
  catch (e) { C.check(`part ${i} ran to the end`, false, String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
}
mouseDetached();
console.log(`total assertions in the section checks: ${fmt(N)}`);
C.done();
