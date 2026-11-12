"use strict";
// wm-w3.mjs -- slice W3 of the window manager: menus (docs/WINDOWS.md sections 1-11, 14, 15, 17 and 18; test items 5 and 6 of section 10, W3's parts, and 8), on the
// `kern4` cartridge.  Written from the contract, never from the code.  The reference is tests/wm-model3.mjs (on tests/wm-model.mjs and tests/gfx6-model.mjs).
//   node tests/wm-w3.mjs [--seed N] [--steps N] [--only LIST] [--build] [--verbose] [--mutate N] [--maxfail N]
//     --seed N     PRNG seed (printed; default from the clock)
//     --steps N    random interleavings in part 7 (default 300; each is one operation: a tracking session, MB_ENABLE, MB_SET, a window operation, keys ..)
//     --only LIST  parts: 0 boot, 1 MB_SET (valid tables, layout), 2 MB_SET refusals and limits, 3 the look (drop-downs, highlight, closing, windows under it),
//                  4 tracking by pointer, 5 tracking by keyboard, 6 modal / no menus / MB_ENABLE / bar repaint, 7 random interleavings (default all; one machine)
//     --mutate N   plant fault N in the model (1 a separator can be enabled, 2 a disabled item is highlighted, 3 UP / DOWN do not wrap, 4 BREAK chooses,
//                  5 BREAK does not close a pointer tracking, 6 a menu switch keeps h) to show that the comparison catches it
//     --build      run tools/build.mjs kern4 first (default: use build/kern4.dck and build/kern4/ as they are)
//
// How the frames run: as tests/wm-w2.mjs.  The CPU is parked at T_APPLOOP (17.6) with interrupts on and TSRun's frames are run one at a time.  The pointer is
// driven by the Kempston mouse (WINDOWS 15) and K_WARP, the keys by `m.keyMatrix`.  The model gets the events the input produces (class `Ptr` of
// tests/wm-model3.mjs) in the order of the ring and is compared with the machine whenever the application is idle: PC = $38 with the return address just after
// a HALT (T_APPLOOP's or the tracking loop's), both queues empty, nothing dirty.  After every action that can start a redraw, at least 2 idle frames are
// waited, so two E_MOVEs never pile up unread (the ring's coalescing is not modelled).
//
// What is compared at every such point: W_MAP byte for byte, W_SLOTS, the desk's list, W_DIRTY, W_MODAL, K_FSCOPE, K_FOCUS, K_CAPTURE, every node's fields, T_EVN and
// the E_MENU records T_APPLOOP wrote to T_EVLOG, K_PX / K_PY / K_BTN, and the whole display: the settled screen (the snapshot taken at the last idle point with no
// menu open: the machine's own, since window drawing is W1/W2's) with the bar replaced by the model's and the open menu drawn by the model, the pointer's byte
// rectangles (every position since the snapshot) left out.  After a close the screen must equal the snapshot (the bar from the model).  And on every frame:
// V_FRAMES rises by exactly 1 (section 10 test 8).
//
// Readings of the contract (see also the header of tests/wm-model3.mjs, D1-D11):
//  T1. After MB_SET / MB_ENABLE / a refused MB_SET the display bytes are exactly as before the call, with no frame run in between (18.2: the bar is damaged, drawn at
//      the next W_UPDATE).  A refused MB_SET leaves W_MAP, W_DIRTY and the W3 area $F480-$F4EF byte for byte as they were ("carry, nothing changed").
//  T2. Where 18.2's save-under rule is read two ways (D1), the tests assert only where the readings agree: a table that fits by the stricter one is accepted, one that
//      fails even the lenient one is refused; the band between is reported (which way the machine went).
//  T3. MB_ENABLE preserves BC and DE (5's "Clobbers AF, HL"), IX, IY and the alternate set; MB_SET only IX, IY and the alternate set.  Stack bound 192 (section 9).
//  T4. Pointer presses are generated only on the bar (the title boxes, or the bar elsewhere) outside tracking, never on a window (that is W2's raise / drag).
//  T5. MB_SET and MB_ENABLE are called only while no menu is open (tracking runs inside the kernel, so a program cannot call them then).
import { checks, M, FRAME_T } from './lib.mjs';
import { makeRng, call, hex, rd16, setGA } from './gfx6-lib.mjs';
import { rowsOf } from './kern-model2.mjs';
import { KEEP, armStack, stackUsed } from './kern-lib.mjs';
import { startW, WNEEDED, readDisp, diffDisp } from './wm-lib.mjs';
import { WmModel3, E, K, KEYSPEC, Ptr, menuSpec, encodeTable, readTable, layoutOf, tw, stringOfWidth, codes, expectedScreen, gFromDisp, dispFromG, SAVE_MAX, COLS, ROWS, NCELL, WHOLE } from './wm-model3.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 300);
const MAXFAIL = argVal('--maxfail', 6);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7];
const VERBOSE = argv.includes('--verbose');
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} random interleavings`);

const W3NEEDED = [...WNEEDED, 'MB_SET', 'MB_ENABLE', 'MB_KEY', 'mbar_event', 'T_MENUS', 'T_MENU8', 'CL_Dialog', 'Dialog_SIZE', 'T_APPLOOP', 'T_EVLOG', 'T_EVN', 'K_MSET', 'K_WARP',
  'K_PX', 'K_PY', 'K_BTN', 'desk_event', 'V_FRAMES'];
const C = checks('wm W3');
const ctx = startW(C, W3NEEDED);
if (!ctx) { console.log('the kern4 cartridge is not available (or lacks the W3 symbols): nothing else can run'); C.done(); process.exit(); }
const { m, S, img } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const R = (a) => rd16(m, a);
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
let N = 0, stepNo = 0;
const FR = { frames: 0, idle: 0, quiet: 0 };
const fmt = (n) => n.toLocaleString('en-US');

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 200 : MAXFAIL)) this.fails.push(`[#${stepNo}] ` + (typeof msg === 'function' ? msg() : msg)); } return c; }
  get bad() { return this.nf >= MAXFAIL * 3; }
  end() { C.check(`${this.name}: ${fmt(this.n)} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}
const SECS = {};
const sec = (name) => (SECS[name] ??= new Sec(name));
const SUP = new Sec('set-up calls: registers, no DI, stack of K_NEW / K_ADDCHILD / K_ALLOC');
const nm = (n) => (n ? `${n.kind}@${n.a.toString(16)}${n.slot ? `#${n.slot}` : ''}` : '0');
const carry = (res) => res.regs.f & 1;

// ---------------------------------------------------------------------------------------------------------------------------
// Direct calls: random registers, the generic checks of section 5 (IX, IY and the alternate set preserved, no DI, SP, stack).
function callW(s, what, name, regs = {}, o = {}) {
  const pat = rng.chance(0.5) ? 0x55 : 0xAA;
  armStack(m, pat);
  const res = call(m, S, name, regs, { ints: o.ints ?? true, rng, guard: o.guard ?? 60_000_000 });
  const moved = KEEP(!!o.ixOut).concat(o.keep || []).filter((r) => res.regs[r] !== res.regsIn[r]);
  s.ok(moved.length === 0, () => `${what}: changed ${moved.map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`).join(', ')} (IX unless an output, IY, the alternate set${o.keep ? ' and ' + o.keep.join('') : ''} are preserved)`);
  if (o.ints ?? true) s.ok(res.maxDiRun === 0 && res.iff1 === true, () => `${what}: interrupts were off for ${res.maxDiRun} T-states / iff1 ${res.iff1} (no DI or EI allowed)`);
  s.ok(res.sp === 0xFF00, () => `${what}: SP ${hex(res.sp)} after the return, want $FF00`);
  const used = stackUsed(m, pat);
  s.ok(used <= (o.lim ?? 192), () => `${what}: ${used} bytes of stack, bound ${o.lim ?? 192}`);
  return res;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The model, and builders that make an object in the machine and its node in the model.
let model = null, ptr = null;
const setRect = (a, x, y, w, h) => { poke16(a + S.View_x, x); poke8(a + S.View_y, y); poke16(a + S.View_w, w); poke8(a + S.View_h, h); };
function kNew(kind) {
  const r = callW(SUP, `K_NEW ${kind}`, 'K_NEW', { hl: S[`CL_${kind}`] }, { ixOut: true, lim: 32 });
  if (carry(r)) throw new Error(`K_NEW ${kind}: the arena is full`);
  return r.regs.ix;
}
function newStr(cs) {
  const r = callW(SUP, 'K_ALLOC', 'K_ALLOC', { bc: cs.length + 1 }, { lim: 32 });
  const a = r.regs.hl; poke8(a, cs.length); cs.forEach((c, i) => poke8(a + 1 + i, c));
  return { addr: a, codes: cs.slice() };
}
const TITLES = [];                                                 // filled by makePool (after the boot)
/** A window of kind 'TWin' or 'Dialog' with `nk` TCtl children (focusable, random tag) in its content area. */
function newWin(kind, rect, nk = 0) {
  const [x, y, w, h] = rect, a = kNew(kind);
  setRect(a, x, y, w, h);
  let title = null;
  if (kind === 'TWin') { title = rng.pick(TITLES); poke16(a + S.Window_title, title.addr); poke8(a + S.TWin_tag, 0); }
  const n = model.addNode({ a, kind, x, y, w, h, title, tag: 0 });
  for (let i = 0; i < nk; i++) {
    const cx = x + 8 + 40 * i, cy = y + 16, cw = 24, ch = 8, ca = kNew('TCtl'), tag = (rng.byte() & 0xFE) | ((POOL.length + DLGS.length + i) & 1);
    setRect(ca, cx, cy, cw, ch); poke8(ca + S.View_flags, 1); poke8(ca + S.View_id, 0); poke8(ca + S.TCtl_tag, tag);
    callW(SUP, 'K_ADDCHILD', 'K_ADDCHILD', { ix: a, de: ca }, { lim: 32 });
    model.attach(n, model.addNode({ a: ca, kind: 'TCtl', x: cx, y: cy, w: cw, h: ch, flags: 1, tag }));
  }
  return n;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Running frames.
const BTN = (left) => 0xF8 | 1 | (left ? 0 : 2) | 4;                 // WINDOWS 15.1: active low, bit 0 right, bit 1 left, bit 2 middle, the rest 1
/**
 * Put the CPU where an idle application is at the end of a TSRun frame: the frame interrupt accepted (PC = $38, interrupts off) with the application's wait loop as
 * the interrupted code (as wm-w2.mjs).  Direct calls leave the machine's clock ahead of its frame counter: those frames are passed with the interrupt off.
 */
function repark() {
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = 0xFF00 - 2; m.ram[cpu.sp] = S.T_APPLOOP & 0xFF; m.ram[cpu.sp + 1] = S.T_APPLOOP >> 8; cpu.pc = 0x38;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart > FRAME_T - 15000; k++) { if (m.tstates < m.frameStart + FRAME_T) m.tstates = m.frameStart + FRAME_T; M.runFrame(m); }
}
const isRetAfterHalt = () => { const ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8); return m.bus.read((ret - 1) & 0xFFFF) === 0x76; };
const queuesEmpty = () => m.ram[S.K_PN] === 0 && m.ram[S.K_RHEAD] === m.ram[S.K_RTAIL];
const quiet = () => cpu.pc === 0x38 && isRetAfterHalt() && queuesEmpty() && m.ram[S.W_DIRTY] === 0;
let curBtn = 0;
const PM = new Set();                                              // pointer positions since the snapshot (their byte rectangles are not compared)
const markPtr = (x, y) => PM.add(x * 256 + y);
function setInputs(inp) {
  const rows = rowsOf(inp.key ? KEYSPEC[inp.key].keys : []);
  for (let r = 0; r < 8; r++) m.keyMatrix[r] = rows[r];
  m.joystick[0] = 0xFF;
  const dx = inp.dx || 0, dy = inp.dy || 0;
  if (Math.abs(dx) > 127 || Math.abs(dy) > 127) throw new Error('a mouse step over 127');
  m.mouse.x = (m.mouse.x + dx) & 255; m.mouse.y = (m.mouse.y - dy) & 255;
  curBtn = inp.btn === undefined ? curBtn : inp.btn;
  m.mouse.buttons = BTN(curBtn);
}
/** One frame with the given input (the button state persists when `btn` is left out). */
function frame(s, inp = {}) {
  inp = { ...inp, btn: inp.btn === undefined ? curBtn : inp.btn };
  setInputs(inp);
  const v0 = rd16(m, S.V_FRAMES);
  M.runFrame(m);
  FR.frames++; if (!inp.key && !inp.dx && !inp.dy) FR.idle++;
  const dv = (rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
  s.ok(dv === 1, () => `V_FRAMES rose by ${dv} in a frame, want exactly 1 (section 10 test 8; a frame interrupt was lost or doubled)`);
  const evs = ptr.step(inp);
  markPtr(ptr.px, ptr.py); markPtr(ptr.x, ptr.y);
  const t0 = process.env.TRACE ? JSON.stringify(model.trk) : null;
  if (process.env.TRACE && model.trk && evs.some((e) => e[0] === 3)) console.log('   lay', JSON.stringify(model.lay.drops[model.trk.i]), 'boxes', JSON.stringify(model.lay.boxes), 'en', JSON.stringify(model.en[model.trk.i]), 'items', model.menus[model.trk.i].items.map((x) => x.flags + ':' + x.text.length).join(' '));
  for (const ev of evs) model.feed(ev);
  if (process.env.TRACE && evs.length) console.log(`  #${stepNo} ev ${evs.map((e) => e.join('.')).join(' ')} trk ${t0} -> ${JSON.stringify(model.trk)}`);
  return evs;
}
/** Idle frames until the application is idle (at least `min`). */
function settle(s, min = 2, what = '') {
  for (let i = 1; ; i++) {
    frame(s, {});
    if (i >= min && quiet()) { FR.quiet++; model.idle(); return true; }
    if (i > 80) { s.ok(false, `${what}: the application did not become idle in 80 frames (PC ${hex(cpu.pc)}, queues empty ${queuesEmpty()}, W_DIRTY ${m.ram[S.W_DIRTY]}; the model is ${model.trk ? `tracking ${JSON.stringify(model.trk)}` : 'not tracking'})`); return false; }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The comparison.
let snapG = null;                                                  // the settled screen at the last idle point with no menu open
function ptrMask() {
  const mask = new Uint8Array(192 * 64).fill(0xFF);
  for (const k of PM) {
    const px = k >> 8, py = k & 255, c0 = px >> 3;
    for (let y = py; y <= Math.min(py + 15, 191); y++) for (let c = c0; c <= Math.min(c0 + 2, 63); c++) mask[y * 64 + c] = 0;
  }
  return mask;
}
const bits = (v) => v.toString(2).padStart(8, '0').replace(/0/g, '.').replace(/1/g, '#');
function dumpDiff(cur, exp, mask) {
  let i = 0; while (((cur[i] ^ exp[i]) & mask[i]) === 0) i++;
  const y0 = Math.max(0, (i >> 6) - 2), bc0 = Math.max(0, (i & 63) - 2), lines = [];
  for (let y = y0; y < Math.min(192, y0 + 14); y++) { let a = '', b = ''; for (let bc = bc0; bc < Math.min(64, bc0 + 7); bc++) { a += bits(cur[y * 64 + bc]); b += bits(exp[y * 64 + bc]); } lines.push(`${String(y).padStart(3)} ${a}  ${b}`); }
  console.log(`   machine | model, x from ${bc0 * 8}, rows from ${y0}:\n${lines.join('\n')}`);
}
/** The display against the model.  `keep`: with no menu open, the whole screen must equal the snapshot (apart from the bar). */
function checkScreen(s, what, keep = false) {
  const cur = readDisp(m);
  markPtr(R(S.K_PX), m.ram[S.K_PY]);
  const exp = dispFromG(expectedScreen(model.trk || (keep && snapG) ? snapG : gFromDisp(cur), model)), mask = ptrMask();
  const d = diffDisp(cur, exp, mask);
  s.ok(d === null, () => `${what}: the screen differs from the model's (${model.trk ? `menu ${model.trk.i} open, h ${model.trk.h}, ${model.trk.mode} tracking` : keep ? 'no menu open, the screen before is the reference' : 'no menu open, the bar'}): ${d}`);
  if (d !== null && VERBOSE && !checkScreen.dumped) { checkScreen.dumped = true; dumpDiff(cur, exp, mask); }
  if (!model.trk) { snapG = gFromDisp(cur); PM.clear(); markPtr(ptr.px, ptr.py); markPtr(ptr.x, ptr.y); markPtr(R(S.K_PX), m.ram[S.K_PY]); }
  return d === null;
}
function checkState(s, what) {
  const want = model.mapBytes(), got = Buffer.from(m.ram.buffer, m.ram.byteOffset + S.W_MAP, NCELL);
  s.ok(Buffer.compare(got, Buffer.from(want)) === 0, () => { let i = 0; while (got[i] === want[i]) i++; return `${what}: W_MAP differs at cell (${i % 32}, ${i >> 5}): machine $${got[i].toString(16)}, model $${want[i].toString(16)}`; });
  for (let o = 0; o < 16; o++) s.ok(R(S.W_SLOTS + 2 * o) === (model.slots[o] ? model.slots[o].a : 0), () => `${what}: W_SLOTS[${o}] ${hex(R(S.W_SLOTS + 2 * o))}, model ${nm(model.slots[o])}`);
  const order = []; for (let v = R(model.desk.a + S.View_child), g = 0; v && g < 40; v = R(v + S.View_next), g++) order.push(v);
  s.ok(order.join() === model.desk.kids.map((k) => k.a).join(), () => `${what}: the desk's list ${order.map((a) => a.toString(16))}, model ${model.desk.kids.map(nm)}`);
  s.ok(m.ram[S.W_DIRTY] === model.wDirty, () => `${what}: W_DIRTY ${m.ram[S.W_DIRTY]}, model ${model.wDirty}`);
  s.ok(R(S.W_MODAL) === (model.modal ? model.modal.a : 0), () => `${what}: W_MODAL ${hex(R(S.W_MODAL))}, model ${nm(model.modal || null)}`);
  s.ok(R(S.K_FSCOPE) === (model.fscope ? model.fscope.a : 0), () => `${what}: K_FSCOPE ${hex(R(S.K_FSCOPE))}, model ${nm(model.fscope)}`);
  s.ok(R(S.K_FOCUS) === (model.focus ? model.focus.a : 0), () => `${what}: K_FOCUS ${hex(R(S.K_FOCUS))}, model ${nm(model.focus)}`);
  s.ok(R(S.K_CAPTURE) === 0, () => `${what}: K_CAPTURE ${hex(R(S.K_CAPTURE))}, want 0 (no view takes the capture in these tests)`);
  for (const n of model.nodes.values()) {
    const a = n.a, par = n.parent ? n.parent.a : 0, ch = n.kids.length ? n.kids[0].a : 0;
    const sib = n.parent ? (n.parent.kids[n.parent.kids.indexOf(n) + 1]?.a ?? 0) : 0;
    const got2 = [R(a + S.View_parent), R(a + S.View_child), R(a + S.View_next), R(a + S.View_x), m.ram[a + S.View_y]];
    const exp2 = [par, ch, sib, n.x, n.y];
    if (n.kind === 'TWin' || n.kind === 'Dialog') { got2.push(m.ram[a + S.Window_slot], R(a + S.Window_focus)); exp2.push(n.slot, n.focus ? n.focus.a : 0); }
    s.ok(got2.join() === exp2.join(), () => `${what}: ${nm(n)} fields [parent child next x y${n.kind !== 'TCtl' ? ' slot focus' : ''}] machine [${got2.map((v) => v.toString(16))}], model [${exp2.map((v) => v.toString(16))}]`);
  }
  const n = R(S.T_EVN), want2 = model.evlog;
  s.ok(n === want2.length, () => `${what}: T_EVN ${n} records, model ${want2.length} [${want2.slice(-6).map((r) => r.join('.')).join(' ')}]`);
  for (let k = Math.max(0, Math.min(n, want2.length) - 512); k < Math.min(n, want2.length); k++) {
    const a = S.T_EVLOG + 4 * (k & 511), got3 = Array.from(m.ram.subarray(a, a + 4));
    s.ok(got3.join() === want2[k].join(), () => `${what}: event record ${k}: machine [${got3}], model [${want2[k]}]`);
  }
  s.ok(R(S.K_PX) === ptr.x && m.ram[S.K_PY] === ptr.y && m.ram[S.K_BTN] === ptr.btn, () => `${what}: pointer K_PX ${R(S.K_PX)} K_PY ${m.ram[S.K_PY]} K_BTN ${m.ram[S.K_BTN]}, input model ${ptr.x} ${ptr.y} ${ptr.btn}`);
}
/** Settle, then compare everything.  `min` idle frames at least; `keep`: the screen must equal the snapshot (no menu open). */
function commit(s, what, o = {}) {
  stepNo++;
  if (!settle(s, o.min ?? 2, what)) return false;
  checkState(s, what);
  const ok = checkScreen(s, what, !!o.keep);
  if (!ok && !model.trk) {                                          // the machine may still be tracking (a finding already reported): close it so one fault is not counted again and again
    frame(s, { key: 'ESC' }); settle(s, 3, 'recovery');
    if (ptr.btn) release(s);
    snapG = gFromDisp(readDisp(m)); PM.clear(); markPtr(ptr.px, ptr.py); markPtr(ptr.x, ptr.y);
  }
  return ok;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Actions.
const clampPt = (x, y) => [Math.min(Math.max(x, 0), 511), Math.min(Math.max(y, 0), 191)];
function place(s, x, y) {
  if (ptr.btn) throw new Error('place with the button down');
  [x, y] = clampPt(x, y);
  callW(s, `K_WARP ${x},${y}`, 'K_WARP', { hl: x, de: y }, { ints: false, lim: 32 });
  ptr.warp(x, y);
  repark(); settle(s, 2, `warp to ${x},${y}`);
}
function moveTo(s, tx, ty, step = 100) {
  [tx, ty] = clampPt(tx, ty);
  for (let g = 0; g < 80 && (ptr.x !== tx || ptr.y !== ty); g++) {
    const dx = Math.max(-step, Math.min(step, tx - ptr.x)), dy = Math.max(-step, Math.min(step, ty - ptr.y));
    frame(s, { dx, dy }); settle(s, 1);
  }
}
const press = (s) => { frame(s, { btn: 1 }); settle(s, 2); };
const release = (s) => { frame(s, { btn: 0 }); settle(s, 2); };
const key = (s, name) => { frame(s, { key: name }); settle(s, 2); };
const mp = (p) => [p.x, p.y];
/** Direct operations: the call, the model, the carry, then park (the app loop settles the screen on the next frames). */
function dOp(s, name, regs, fn, what, o = {}) {
  if (model.trk) throw new Error(`a direct call (${what}) during tracking`);
  const res = callW(s, what, name, regs, o);
  const exp = fn();
  if (exp !== undefined) s.ok(carry(res) === exp, () => `${what}: carry ${carry(res)}, model ${exp}`);
  repark();
  return exp;
}
const dOpen = (s, w) => dOp(s, 'W_OPEN', { ix: w.a }, () => model.open(w), `W_OPEN ${nm(w)}`);
const dClose = (s, w) => dOp(s, 'W_CLOSE', { ix: w.a }, () => model.close(w), `W_CLOSE ${nm(w)}`);
const dRaise = (s, w) => dOp(s, 'W_RAISE', { ix: w.a }, () => model.raise(w), `W_RAISE ${nm(w)}`);
const dMove = (s, w, x, y) => dOp(s, 'W_MOVE', { ix: w.a, hl: x & 0xFFFF, de: y & 0xFFFF }, () => model.move(w, x, y), `W_MOVE ${nm(w)} -> (${x},${y})`);
function dInval(s, x, y, w, h) {
  setGA(m, S, x, y, w, h);
  callW(s, `W_INVAL (${x},${y},${w},${h})`, 'W_INVAL', {});
  model.inval(x, y, w, h); repark();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tables.  The cartridge's (T_MENUS, T_MENU8: data in src/kern4.asm) are read from the image; RAM tables live in two slots at $D000 and $D800, a new or refused table
// always built in the slot that is not live, so a refused MB_SET never touches the live table.
const rdImg = (a) => img[a];
const MENUS_SPEC = readTable(rdImg, S.T_MENUS), MENU8_SPEC = readTable(rdImg, S.T_MENU8);
// T_MENU8 in src/kern4.asm has wrong length bytes ("New text" is 8 codes but its length byte is 9, "Save text" 9 but 10): read as a table it is garbage and MB_SET
// refuses it.  Part 1 asserts the contract (18.6 / 18.7: a valid table of one menu of 8 items) and reports that; the other parts use this corrected RAM copy.
const MENU8_FIXED = [menuSpec(2, 'File', [[1, 0, 'New text'], [2, 0, 'Open text'], [3, 0, 'Save text'], [4, 0, 'Save as..'], [5, 0, 'Close all'], [6, 0, 'Print one'], [7, 0, 'Page size'], [8, 0, 'Quit Leap']])];
const CART = { T_MENUS: { name: 'T_MENUS', addr: S.T_MENUS, menus: MENUS_SPEC }, T_MENU8: { name: 'T_MENU8', addr: S.T_MENU8, menus: MENU8_SPEC } };
const fixed8 = () => ramTable(MENU8_FIXED, 'T_MENU8 corrected (RAM)');
let liveSlot = -1;                                                 // the slot of the live RAM table, -1 when the live table is the cartridge's (or none)
const SLOT_BASE = [0xD000, 0xD800];
function ramTable(menus, name = 'ram') {
  const slot = liveSlot === 0 ? 1 : 0, addr = SLOT_BASE[slot], bytes = encodeTable(menus, addr);
  if (bytes.length > 0x7F0) throw new Error(`a RAM table of ${bytes.length} bytes does not fit its 2 KB slot`);
  bytes.forEach((b, i) => poke8(addr + i, b));
  return { name, addr, menus, slot };
}
function checkArena() { if (R(S.K_AARENA) >= 0xD000) throw new Error(`the app arena reached $D000 (${hex(R(S.K_AARENA))}): it would overwrite the RAM tables`); }
const W3AREA = [0xF480, 0xF4EF];
const area = () => Buffer.from(m.ram.buffer, m.ram.byteOffset + W3AREA[0], W3AREA[1] - W3AREA[0] + 1);
/**
 * MB_SET with a table (or 0).  Checks 18.2: the display is exactly as before (the bar is drawn at the next W_UPDATE), the map (a success dirties row 0, a refusal
 * changes nothing), and for a refusal that the W3 area is unchanged.  Returns the machine's carry.  The caller settles and commits.
 */
function doMbSet(s, tbl, what = `MB_SET ${tbl ? tbl.name : '0'}`, opt = {}) {
  if (model.trk) throw new Error('MB_SET during tracking');
  const before = readDisp(m), areaB = Buffer.from(area()), mapB = Buffer.from(m.ram.buffer, m.ram.byteOffset + S.W_MAP, NCELL), mapCopy = Buffer.from(mapB), dirtyB = m.ram[S.W_DIRTY];
  const res = callW(s, what, 'MB_SET', { hl: tbl ? tbl.addr : 0 }, { lim: 192 });
  const c = carry(res);
  const lay = tbl ? layoutOf(tbl.menus) : null;
  const gray = !!lay && lay.okLenient && !lay.okStrict;
  if (gray) {
    opt.grayCarry = c; GRAY.push({ what, carry: c, n: tbl.menus.map((q) => q.items.length), w: tbl.menus.map((q, i) => lay.drops[i].w) });
  } else {
    const exp = tbl ? (lay.okStrict ? 0 : 1) : 0;
    s.ok(c === exp, () => `${what}: carry ${c}, want ${exp} (${tbl ? (lay.okStrict ? 'a valid table' : `refused: ${lay.why}`) : 'MB_SET 0'})`);
  }
  const mc = model.setTable(tbl ? tbl.menus : null, gray && !c ? 'lenient' : 'strict');
  s.ok(Buffer.compare(Buffer.from(readDisp(m)), Buffer.from(before)) === 0, () => `${what}: the display changed during the call (18.2: the bar is only damaged, drawn at the next W_UPDATE)`);
  if (c) {
    s.ok(Buffer.compare(area(), areaB) === 0, () => `${what}: refused, but the W3 area $F480-$F4EF changed ("carry, nothing changed")`);
    s.ok(Buffer.compare(Buffer.from(m.ram.buffer, m.ram.byteOffset + S.W_MAP, NCELL), mapCopy) === 0 && m.ram[S.W_DIRTY] === dirtyB, () => `${what}: refused, but W_MAP or W_DIRTY changed`);
  } else liveSlot = tbl && tbl.slot !== undefined ? tbl.slot : -1;
  checkState(s, `${what} (before the update)`);
  repark();
  return c;
}
const GRAY = [];
const R4 = (x) => x;
/** The screen after MB_SET: settle; the bar is the model's, the rest unchanged. */
const settleBar = (s, what) => commit(s, what, { keep: true });

// ---------------------------------------------------------------------------------------------------------------------------
// Boot.
function boot() {
  m.mouse.attached = true; m.mouse.x = 0; m.mouse.y = 0; m.mouse.buttons = BTN(0);
  call(m, S, 'K_MSET', { a: 1 }, { ints: false, rng });
  model = new WmModel3(R(S.W_SLOTS), R(S.W_SLOTS + 30));
  model.fault3 = argVal('--mutate', 0);
  ptr = new Ptr(R(S.K_PX), m.ram[S.K_PY]);
  poke16(S.T_EVN, 0);
  // the display was cleared by the harness (the pointer made harmless): repaint everything through the window manager
  setGA(m, S, 0, 0, 512, 192); call(m, S, 'W_INVAL', {}, { ints: false, rng }); model.inval(0, 0, 512, 192);
  repark();
}
boot();
/** Close every window, MB_SET 0, the pointer parked at (500, 180), everything repainted: the start of each directed part. */
function reset(s) {
  if (model.trk) { key(s, 'ESC'); key(s, 'ESC'); }
  if (ptr.btn) release(s);
  if (model.trk) throw new Error('a menu stays open after ESC');
  for (const w of [...model.list]) dClose(s, w);
  if (model.menus) doMbSet(s, null, 'MB_SET 0 (reset)');
  place(s, 500, 180);
  dInval(s, 0, 0, 512, 192);
  commit(s, 'reset');
}
const parkPtr = (s) => { if (ptr.x !== 500 || ptr.y !== 180) { if (ptr.btn) release(s); place(s, 500, 180); } };

// ===========================================================================================================================
// A pool of windows (TWin, some with focusable controls, some of which take keys) and dialogs (no buttons: ENTER / ESC do nothing in them).
const POOL = [], DLGS = [];
function makePool() {
  for (const t of ['Alpha', 'Beta window', 'Gamma', 'Delta four', 'Epsilon']) TITLES.push(newStr(codes(t)));
  const rects = [[16, 24, 192, 72], [120, 48, 240, 80], [250, 16, 160, 64], [60, 100, 300, 72], [330, 70, 170, 100], [8 * 2, 120, 140, 56]];
  for (const r of rects) POOL.push(newWin('TWin', r, rng.int(0, 2)));
  DLGS.push(newWin('Dialog', [176, 56, 160, 80], 0), newWin('Dialog', [64, 90, 200, 64], 0));
  checkArena();
  repark();
}
makePool();
const allWins = () => [...POOL, ...DLGS];

// ===========================================================================================================================
// 0. Boot.
if (ONLY.includes(0)) {
  const s = sec('boot: the repaint, the bar, the symbols, the cartridge tables');
  s.ok(S.T_EVLOG === 0x5800, () => `T_EVLOG ${hex(S.T_EVLOG)}, want $5800`);
  s.ok(MENUS_SPEC.length === 3 && MENUS_SPEC.map((q) => q.items.length).join() === '2,5,4', () => `T_MENUS as read from the image: ${MENUS_SPEC.length} menus, items ${MENUS_SPEC.map((q) => q.items.length)}; 18.6 says 3 menus (2, 5, 4 items)`);
  s.ok(MENU8_SPEC.length === 1 && MENU8_SPEC[0].items.length === 8, () => `T_MENU8: ${MENU8_SPEC.length} menus, ${MENU8_SPEC[0] && MENU8_SPEC[0].items.length} items`);
  commit(s, 'first settle: the bar (no menus) and the desk');
  s.end();
}

// ===========================================================================================================================
// A random valid table (strict-fitting, drop-downs inside the screen), in ASCII-ish strings.
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,-:';
const rstr = (lo, hi) => Array.from({ length: rng.int(lo, hi) }, () => ALPHA.charCodeAt(rng.int(0, ALPHA.length - 1)));
function randMenus() {
  for (let attempt = 0; attempt < 80; attempt++) {
    const nmn = rng.pick([1, 2, 3, 3, 4, 5, 6, 8]), menus = [];
    let used = 8;
    for (let i = 0; i < nmn; i++) {
      const title = rstr(1, 7), bw = tw(title) + 16;
      if (used + bw > 512) break;
      used += bw;
      const n = rng.pick([1, 2, 3, 4, 5, 6, 8, 10, 12, 15]), items = [], cap = rng.pick([3, 6, 10, 16]);
      for (let k = 0; k < n; k++) { const r = rng.next(), flags = r < 0.12 ? 1 : r < 0.24 ? 2 : r < 0.28 ? 3 : 0; items.push({ id: rng.int(1, 255), flags, text: flags & 2 ? [] : rstr(1, cap) }); }
      menus.push({ id: rng.int(1, 255), title, items });
    }
    if (!menus.length) continue;
    const l = layoutOf(menus);
    if (l.okStrict && l.drops.every((d) => d.w + 2 <= 512) && encodeTable(menus, 0).length < 0x7F0) return menus;
  }
  return MENUS_SPEC;
}
/** An exact-width string; null for widths 1 and 2. */
const sw = (w) => stringOfWidth(w);

// ===========================================================================================================================
// 1. MB_SET: valid tables, the layout read back from the screen and from behaviour (18.2, 18.3).
if (ONLY.includes(1)) {
  const s = sec('MB_SET (18.2): the cartridge tables and RAM tables; the bar after W_UPDATE; MB_SET 0; the layout from the screen and from where a press opens a menu');
  reset(s);
  parkPtr(s);
  const install = (tbl, what) => {
    const c = doMbSet(s, tbl, what);
    s.ok(c === 0, () => `${what}: refused (carry set) but the table is valid`);
    // right after the call and before the update: the bar's cells are damaged, the screen not yet changed (doMbSet checked the display); then the update
    settleBar(s, `${what}: after W_UPDATE the bar shows the titles, the rest of the screen is unchanged`);
  };
  install(CART.T_MENUS, 'MB_SET T_MENUS');
  // the layout from behaviour: a press on the first and last pixel of each title box opens that menu, one pixel outside does not (or opens the neighbour)
  const edge = (i, x, expectIdx, what) => {
    place(s, x, 3); press(s);
    s.ok(expectIdx < 0 ? !model.trk : (model.trk && model.trk.i === expectIdx), () => `${what}: the model says ${model.trk ? 'menu ' + model.trk.i : 'nothing'}`);
    commit(s, what);
    key(s, 'ESC'); release(s); commit(s, `${what}: closed`, { keep: true });
  };
  for (let i = 0; i < model.lay.boxes.length; i++) {
    const b = model.lay.boxes[i];
    edge(i, b.x, i, `press on the first pixel of title ${i} (x ${b.x})`);
    edge(i, b.x + b.w - 1, i, `press on the last pixel of title ${i} (x ${b.x + b.w - 1})`);
  }
  edge(0, 7, -1, 'press at x 7, before the first title box: nothing opens');
  edge(0, 8 + model.lay.boxes.reduce((a, b) => a + b.w, 0), -1, 'press just past the last title box: nothing opens');
  // MB_ENABLE does not change the screen (checked in the call) ; MB_SET again with other tables replaces the bar
  { const c = doMbSet(s, CART.T_MENU8, 'MB_SET T_MENU8 (src/kern4.asm data)'); s.ok(c === 0, () => `T_MENU8 (18.6, 18.7: one menu of 8 items) is refused: its length bytes do not match its strings (item lengths read ${MENU8_SPEC[0] ? MENU8_SPEC[0].items.map((i) => i.text.length) : '-'}; "New text" has 8 codes, "Save text" 9) -- a data fault in src/kern4.asm, not in MB_SET`); }
  install(fixed8(), 'MB_SET T_MENU8 corrected (8 items, 96 wide)');
  install(ramTable(MENUS_SPEC, 'RAM copy of T_MENUS at $D000'), 'MB_SET a RAM table');
  const t2 = ramTable([menuSpec(7, 'One', [[1, 0, 'x']])], 'RAM one menu one item');
  install(t2, 'MB_SET a RAM table of one menu with one item');
  for (let k = 0; k < 8; k++) install(ramTable(randMenus(), `random RAM table ${k}`), `MB_SET random RAM table ${k}`);
  // the bar of 8 menus whose last box ends exactly at 512
  const per = 63, ms8 = Array.from({ length: 8 }, (_, i) => menuSpec(i + 1, sw(per - 16), [[1, 0, 'ab'], [2, 2, ''], [3, 1, 'cd']]));
  { const l = layoutOf(ms8); s.ok(l.okStrict && l.boxes[7].x + l.boxes[7].w === 512, () => `the 8-menu table was meant to end at 512, ends at ${l.boxes[7].x + l.boxes[7].w}`); }
  install(ramTable(ms8, '8 menus, the last box ends at 512'), 'MB_SET 8 menus ending at 512');
  // MB_SET 0
  const c0 = doMbSet(s, null, 'MB_SET 0');
  s.ok(c0 === 0, 'MB_SET 0: carry clear');
  settleBar(s, 'MB_SET 0: the bar is plain ink again, the rest unchanged');
  key(s, 'MENU'); commit(s, 'MENU with no menus set does nothing');
  s.ok(!model.trk, 'no tracking after MENU with no menus (model)');
  place(s, 20, 3); press(s); commit(s, 'a press on the bar with no menus: nothing'); release(s); commit(s, 'released', { keep: true });
  // MB_SET after MB_SET 0 works
  install(CART.T_MENUS, 'MB_SET T_MENUS again');
  s.end();
}

// ===========================================================================================================================
// 2. MB_SET refusals and limits (18.2).
if (ONLY.includes(2)) {
  const s = sec('MB_SET refusals (18.2): 9 menus, a count of 0, 0 or 16 items, titles past 512, a too-large drop-down: carry and nothing changed; the limits to the pixel');
  reset(s); parkPtr(s);
  const mk = (nmn, ni, itemW, titleW = 19) => Array.from({ length: nmn }, (_, i) => menuSpec(i + 1, sw(titleW), Array.from({ length: ni }, (_, k) => [k + 1, 0, sw(itemW)])));
  // the live table: T_MENUS; after every refusal it must still work (a menu opened by the keyboard shows the old layout)
  const live = (what) => { doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS (the live table)'); settleBar(s, `${what}: the live table's bar`); };
  const stillWorks = (what) => {
    key(s, 'MENU'); commit(s, `${what}: MENU opens the old table's first menu`);
    key(s, 'RIGHT'); commit(s, `${what}: RIGHT: the old table's second menu`); key(s, 'ESC'); commit(s, `${what}: closed`, { keep: true });
  };
  const refuse = (menus, what) => {
    live(what);
    const tbl = ramTable(menus, what);
    const c = doMbSet(s, tbl, `MB_SET ${what}`);
    s.ok(c === 1, () => `${what}: accepted (carry clear), it must be refused`);
    settle(s, 2, what); commit(s, `${what}: the bar and the screen unchanged (the old table's)`, { keep: true });
    stillWorks(what);
  };
  refuse(mk(9, 1, 20), '9 menus');
  refuse([], 'a count of 0 menus');
  refuse([...mk(2, 3, 20), menuSpec(9, sw(20), [])], 'a menu with 0 items');
  refuse([menuSpec(1, 'ok', [[1, 0, 'a']]), menuSpec(2, 'Sixteen', Array.from({ length: 16 }, (_, k) => [k + 1, 0, 'ab']))], 'a menu with 16 items');
  refuse(Array.from({ length: 8 }, (_, i) => menuSpec(i + 1, sw(60), [[1, 0, 'x']])), '8 titles of 60 pixels: boxes end at 8 + 608 = 616');
  refuse([menuSpec(1, sw(500), [[1, 0, 'x']])], 'one title whose box ends at 8 + 516 = 524');
  refuse([menuSpec(1, 'ok', [[1, 0, 'a']]), menuSpec(2, sw(480), [[1, 0, 'x']])], 'a second title that ends past 512');
  // the limit of the titles to the pixel: the last box ends at 512 (fits) or 513 (refused)
  const widthSum = (sum, ni = 1) => { const per = Math.floor(sum / 4); const ws = [per - 16, per - 16, per - 16, sum - 3 * per - 16]; return ws.map((w, i) => menuSpec(i + 1, sw(w), Array.from({ length: ni }, (_, k) => [k + 1, 0, 'x']))); };
  { const t = ramTable(widthSum(504), 'titles end at 512'); const c = doMbSet(s, t, 'MB_SET titles ending at 512'); s.ok(c === 0, 'MB_SET with the last title box ending at 512 is accepted'); settleBar(s, 'bar with the last box ending at 512'); key(s, 'MENU'); key(s, 'LEFT'); commit(s, 'the last menu of that bar opens (LEFT wraps)'); key(s, 'ESC'); commit(s, 'closed', { keep: true }); }
  refuse(widthSum(505), 'titles ending at 513');
  // the drop-down limit: for each count n, the widest W the strict reading accepts is accepted; one more than the lenient reading's limit is refused; between: reported
  const boundaryLog = [];
  for (const n of [3, 5, 8, 11, 13, 14, 15]) {
    const H = 10 * n + 2, strictMax = (() => { let w = 24; while (4 + (((w + 1 + 2 + 7) >> 3) + 1) * (H + 1) <= SAVE_MAX && w + 1 + 2 <= 512) w++; return w; })();
    const lenMax = (() => { let w = 24; while (4 + ((w + 1 + 2 + 7) >> 3) * (H + 1) <= SAVE_MAX && w + 1 + 2 <= 512) w++; return w; })();
    const make = (W) => { const t = sw(W - 24); return t ? [menuSpec(1, 'Big', Array.from({ length: n }, (_, k) => [k + 1, 0, t]))] : null; };
    for (const [W, expect, label] of [[strictMax, 0, 'the widest the strict reading accepts'], [lenMax + 1, 1, 'one past the lenient reading']]) {
      const ms = make(W); if (!ms) continue;
      live(`n=${n} W=${W}`);
      const tbl = ramTable(ms, `${n} items, W ${W} (${label})`);
      const l = layoutOf(ms);
      const c = doMbSet(s, tbl, `MB_SET ${n} items W ${W}`);
      s.ok(c === expect, () => `${n} items, W ${W} (${label}; save-under 4 + ${l.drops[0].save - 4} bytes): carry ${c}, want ${expect}`);
      settle(s, 2, 'bound'); commit(s, `n=${n} W=${W} settled`, { keep: !c ? false : true });
      if (!c) {                                                          // accepted at the limit: open it (the save-under is at its biggest) and close it, byte for byte
        key(s, 'MENU'); commit(s, `n=${n} W=${W}: the biggest drop-down open`); key(s, 'DOWN'); commit(s, `n=${n} W=${W}: highlight moved`); key(s, 'ESC'); commit(s, `n=${n} W=${W}: closed`, { keep: true });
      }
    }
    const bandRes = [];
    for (let W = strictMax + 1; W <= lenMax; W++) {                      // the band: reported, with a table the machine decides on
      const ms = make(W); if (!ms) continue;
      live(`band n=${n} W=${W}`);
      const tbl = ramTable(ms, `band ${n} items, W ${W}`);
      const c = doMbSet(s, tbl, `MB_SET band ${n} items W ${W}`);
      bandRes.push(c ? 'r' : 'a');
      settle(s, 2, 'band'); commit(s, `band n=${n} W=${W}: settled`, { keep: true });
      if (!c) { key(s, 'MENU'); commit(s, `band n=${n} W=${W}: opened`); key(s, 'ESC'); commit(s, `band: closed`, { keep: true }); }
    }
    boundaryLog.push(`n ${n}: strict limit W ${strictMax}, lenient ${lenMax}, band W ${strictMax + 1}..${lenMax}: ${bandRes.filter((x) => x === 'r').length} refused, ${bandRes.filter((x) => x === 'a').length} accepted`);
  }
  console.log(`  save-under band (18.2's formula read two ways, T2): ${boundaryLog.join('; ')}`);
  live('final');
  s.end();
}

// ===========================================================================================================================
// 3. The look (18.3): drop-downs, shadow, separators, dimmed items, inverted title, highlight, closing; with windows under it.
if (ONLY.includes(3)) {
  const s = sec('the look (18.3): every menu of several tables open, the highlight on every enabled item, closing restores the screen byte for byte, windows under it');
  reset(s); parkPtr(s);
  /** MENU, then RIGHT through every menu; in each, DOWN through every enabled item (and once more: the wrap); ESC.  The pointer stays parked. */
  const lookAll = (tbl, what) => {
    const c = doMbSet(s, tbl, `${what}: MB_SET`); s.ok(c === 0, () => `${what}: MB_SET refused`);
    settleBar(s, `${what}: bar`);
    for (let first = 0; first < 1; first++) {
      key(s, 'MENU'); if (!model.trk) { commit(s, `${what}: MENU with no enabled item anywhere`, { keep: true }); return; }
      const nmn = model.menus.length;
      for (let step = 0; step < nmn; step++) {
        commit(s, `${what}: menu ${model.trk.i} open, h ${model.trk.h}`);
        const ne = model.en[model.trk.i].filter(Boolean).length;
        for (let k = 0; k < Math.min(ne, 8) + (ne > 1 ? 1 : 0); k++) { key(s, 'DOWN'); commit(s, `${what}: menu ${model.trk.i}, DOWN to ${model.trk.h}`); }
        if (ne > 1) { key(s, 'UP'); commit(s, `${what}: menu ${model.trk.i}, UP to ${model.trk.h}`); }
        key(s, 'RIGHT');
      }
      commit(s, `${what}: wrapped to menu ${model.trk.i}`);
      key(s, 'ESC'); commit(s, `${what}: closed`, { keep: true });
    }
  };
  lookAll(CART.T_MENUS, 'T_MENUS');
  lookAll(fixed8(), 'T_MENU8 corrected');
  // a drop-down pulled left to stay on the screen: the last title near the right edge, a wide drop-down (the shadow must stay on the screen)
  { const far = [menuSpec(1, sw(380), [[1, 0, 'x']]), menuSpec(2, 'Wide', [[1, 0, 'About Leap Desktop...'], [2, 1, 'Disabled one'], [3, 2, ''], [4, 0, 'Quit']])];
    const l = layoutOf(far); s.ok(l.okStrict && l.drops[1].x === 512 - (l.drops[1].w + 2) && l.boxes[1].x > l.drops[1].x, () => `the far-right table is not as meant: ${JSON.stringify(l.drops[1])}`);
    lookAll(ramTable(far, 'a drop-down pulled left at the right edge'), 'far right'); }
  // a drop-down right at the edge: box x + W + 2 = 512 exactly (not moved), and one pixel more (moved by one)
  for (const delta of [0, 1]) {
    const W = 100, tx = 512 - W - 2 - 8 + delta - 16;                    // title width so that the 2nd box starts at 512 - W - 2 + delta
    const first = sw(tx); if (!first) continue;
    const ms = [menuSpec(1, first, [[1, 0, 'x']]), menuSpec(2, 'Z', [[1, 0, sw(W - 24)], [2, 0, 'b']])], l = layoutOf(ms);
    s.ok(l.okStrict && l.drops[1].w === W && l.drops[1].x === Math.min(l.boxes[1].x, 512 - W - 2), () => `edge case table: ${JSON.stringify(l.drops[1])}, box ${l.boxes[1].x}`);
    lookAll(ramTable(ms, `drop-down at the edge, delta ${delta}`), `edge delta ${delta} (box x ${l.boxes[1].x}, x ${l.drops[1].x})`);
  }
  // a few random RAM tables: every menu, every enabled item
  for (let k = 0; k < 6; k++) lookAll(ramTable(randMenus(), `random ${k}`), `random table ${k}`);
  // MB_ENABLE changes the look: enable "Quit", disable others, and a separator stays dimmed-free
  { doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
    const en = (a, c, b) => { const res = callW(s, `MB_ENABLE ${a},${c},${b}`, 'MB_ENABLE', { a, c, b }, { keep: ['b', 'c', 'd', 'e'], lim: 192 }); void res; model.mbEnable(a, c, b); repark(); };
    en(1, 3, 1); en(1, 2, 1); en(0, 0, 0); en(2, 1, 0); en(5, 0, 1); en(1, 9, 1); en(255, 255, 0);
    commit(s, 'MB_ENABLE: Quit on, separator stays off, Leap 0 off, Edit 1 off, out-of-range indices ignored', { keep: true });
    for (const i of [0, 1, 2]) { key(s, 'MENU'); for (let k = 0; k < i; k++) key(s, 'RIGHT'); commit(s, `after MB_ENABLE: menu ${i} open`); key(s, 'DOWN'); commit(s, `after MB_ENABLE: menu ${i}, DOWN`); key(s, 'ESC'); commit(s, 'closed', { keep: true }); }
    en(1, 3, 0); en(1, 2, 0); en(0, 0, 1); en(2, 1, 1);
    commit(s, 'MB_ENABLE back', { keep: true }); }
  // with windows under the drop-downs: the screen after closing equals the screen before opening, byte for byte (the pointer is parked)
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
  for (let round = 0; round < 3; round++) {
    for (const w of rng.chance(0.5) ? POOL : [...POOL].reverse()) if (rng.chance(0.7)) { dOpen(s, w); }
    commit(s, `windows open (round ${round}): ${model.list.map((w) => w.slot)}`);
    for (let i = 0; i < 3; i++) {
      key(s, 'MENU'); for (let k = 0; k < i; k++) key(s, 'RIGHT');
      commit(s, `round ${round}: menu ${i} over the windows`);
      for (let k = 0; k < 3; k++) { key(s, 'DOWN'); }
      commit(s, `round ${round}: menu ${i}, highlight moved`);
      key(s, 'ESC'); commit(s, `round ${round}: menu ${i} closed: the screen is the screen before opening`, { keep: true });
    }
    for (const w of [...model.list]) if (rng.chance(0.6)) dClose(s, w);
    commit(s, `round ${round}: some windows closed`);
  }
  for (const w of [...model.list]) dClose(s, w);
  commit(s, 'all closed');
  s.end();
}

// ===========================================================================================================================
// 4. Tracking by pointer (18.4).
if (ONLY.includes(4)) {
  const s = sec('tracking by pointer (18.4): press on a title, drag over titles and items, release; disabled items and separators never chosen; ESC / BREAK; other events dropped');
  reset(s); parkPtr(s);
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
  const nEv = () => R(S.T_EVN);
  const box = (i) => model.boxPoint(i), item = (i, k) => model.itemPoint(i, k);
  const goto_ = (p, what) => { moveTo(s, p.x, p.y, 60); commit(s, what); };
  const sc = (what, fn) => { fn(); if (ptr.btn) { release(s); } if (model.trk) throw new Error(`${what}: tracking did not end`); commit(s, `${what}: done`, { keep: true }); };
  // a) press on File, release in place: closes, no event
  sc('press and release on a title', () => { place(s, box(1).x, box(1).y); press(s); commit(s, 'File opened by a press'); release(s); });
  s.ok(nEv() === 0, () => `a press and release on a title posted an E_MENU (T_EVN ${nEv()})`);
  // b) press on Leap, move onto item 0, release: E_MENU (1, 1, 0)
  sc('press on Leap, release on item 0', () => { place(s, box(0).x, box(0).y); press(s); goto_(item(0, 0), 'over Leap item 0'); release(s); });
  s.ok(nEv() === 1 && model.evlog[0].join() === '7,1,1,0', () => `E_MENU (1, 1, 0) expected, model ${model.evlog[0]} T_EVN ${nEv()}`);
  // c) File: every item in turn (the separator and Quit give none), drag to Edit's title and an Edit item, then out and release: no event
  sc('drag over File\'s items, to Edit, out of the menu, release elsewhere', () => {
    place(s, box(1).x, box(1).y); press(s);
    for (let k = 0; k < 5; k++) goto_(item(1, k), `File item ${k}${k === 2 ? ' (a separator)' : k === 3 ? ' (disabled)' : ''}`);
    goto_(box(2), 'across to Edit\'s title: Edit opens'); goto_(item(2, 3), 'Edit item 3'); goto_(item(2, 0), 'Edit item 0');
    goto_(box(0), 'back to Leap'); goto_(item(0, 1), 'Leap item 1');
    goto_({ x: 300, y: 150 }, 'out of the menu'); goto_({ x: 200, y: 90 }, 'somewhere else'); release(s);
  });
  s.ok(nEv() === 1, () => `release outside any item posted an E_MENU: T_EVN ${nEv()}`);
  // d) release on the separator and on the disabled item: no event; on the last item: E_MENU (2, 5)
  sc('release on the separator', () => { place(s, box(1).x, box(1).y); press(s); goto_(item(1, 2), 'separator'); release(s); });
  sc('release on the disabled Quit', () => { place(s, box(1).x, box(1).y); press(s); goto_(item(1, 3), 'Quit'); release(s); });
  s.ok(nEv() === 1, () => `release on a separator / a disabled item posted an E_MENU (T_EVN ${nEv()})`);
  sc('release on File\'s last item', () => { place(s, box(1).x, box(1).y); press(s); goto_(item(1, 4), 'Print'); release(s); });
  s.ok(nEv() === 2 && model.evlog[1].join() === '7,2,5,0', () => `E_MENU (2, 5, 0) expected, model ${model.evlog[1]} T_EVN ${nEv()}`);
  // e) ESC and BREAK during tracking: the menu closes, no event, the button is still down; the release then does nothing
  for (const k of ['ESC', 'BREAK']) {
    sc(`${k} during tracking, with an item highlighted`, () => { place(s, box(2).x, box(2).y); press(s); goto_(item(2, 1), 'Copy'); key(s, k); commit(s, `${k}: the menu is closed (button still down)`); goto_(item(2, 2), 'moving on with no menu'); release(s); });
    s.ok(nEv() === 2, () => `${k} during tracking posted an E_MENU`);
  }
  // f) other events are dropped: keys of all sorts, with an item highlighted; the release then chooses it
  sc('other events dropped while tracking by pointer', () => {
    place(s, box(0).x, box(0).y); press(s); goto_(item(0, 0), 'Leap item 0');
    for (const k of ['a', 'x', 'ENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'MENU', 'TAB', 'BACKTAB']) { key(s, k); commit(s, `dropped while tracking by pointer: ${k}`); }
    release(s);
  });
  s.ok(nEv() === 3 && model.evlog[2].join() === '7,1,1,0', () => `the highlight survived the dropped events: E_MENU (1, 1) expected, model ${model.evlog[2]}`);
  // g) the exact edges of an item's hit area and of the drop-down (18.4: x + 1 <= px < x + W - 1, 9 <= py < 9 + 10 n)
  sc('hit area edges', () => {
    place(s, box(1).x, box(1).y); press(s);
    const d = model.lay.drops[1];
    for (const [px, py, why] of [[d.x + 1, 9, 'top left corner of item 0'], [d.x, 9, 'the frame column'], [d.x + d.w - 2, 9, 'last column'], [d.x + d.w - 1, 9, 'x + W - 1: outside'], [d.x + 1, 8, 'row 8, the top frame'],
      [d.x + 5, 18, 'last row of item 0'], [d.x + 5, 19, 'first row of item 1'], [d.x + 5, 9 + 10 * 5 - 1, 'last row of item 4'], [d.x + 5, 9 + 10 * 5, 'below the last item'], [d.x + d.w + 1, 20, 'right of the shadow']]) {
      goto_({ x: px, y: py }, `edge: ${why} (${px}, ${py})`);
    }
    release(s);
  });
  // h) a press on the bar that is not on a title: nothing; a press past the last title; the released button
  place(s, 300, 3); press(s); commit(s, 'press on the bar past the last title: nothing opens'); release(s); commit(s, 'released');
  place(s, 2, 3); press(s); commit(s, 'press at x 2: nothing'); release(s); commit(s, 'released');
  // i) a drag started elsewhere on the bar that passes over a title: nothing opens (only a press on a title does)
  place(s, 300, 3); press(s); moveTo(s, 20, 3, 40); commit(s, 'dragging along the bar from x 300 to Leap: nothing opens'); release(s); commit(s, 'released', { keep: true });
  // j) every item of every menu is reachable and chosen with the right ids
  for (let i = 0; i < 3; i++) for (let k = 0; k < model.menus[i].items.length; k++) {
    const exp = model.en[i][k] ? 1 : 0, n0 = model.evlog.length;
    sc(`choose menu ${i} item ${k}`, () => { place(s, box(i).x, box(i).y); press(s); goto_(item(i, k), `menu ${i} item ${k}`); release(s); });
    s.ok(model.evlog.length === n0 + exp, () => `menu ${i} item ${k}: the model's E_MENU count ${model.evlog.length - n0}, want ${exp}`);
    parkPtr(s);
  }
  s.end();
}

// ===========================================================================================================================
// 5. Tracking by keyboard (18.4).
if (ONLY.includes(5)) {
  const s = sec('tracking by keyboard (18.4): MENU, the arrows with wrapping, ENTER, ESC, BREAK, MENU again; an E_DOWN hands over to pointer tracking');
  reset(s); parkPtr(s);
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
  const k = (name, what = name) => { key(s, name); commit(s, `${what}: ${model.trk ? `menu ${model.trk.i} h ${model.trk.h} ${model.trk.mode}` : 'closed'}`, { keep: !model.trk }); };
  const closed = (what) => { s.ok(!model.trk, () => `${what}: the model is still tracking`); };
  // MENU opens the first menu with its first enabled item; DOWN / UP wrap over the enabled items only
  k('MENU'); s.ok(model.trk && model.trk.i === 0 && model.trk.h === 0, 'MENU: Leap, item 0 (model)');
  k('DOWN'); k('DOWN'); k('UP'); k('UP'); k('UP');
  k('RIGHT'); k('DOWN'); k('DOWN'); k('DOWN'); k('DOWN'); k('UP'); k('UP'); k('UP');
  k('RIGHT'); k('RIGHT'); k('LEFT'); k('LEFT'); k('LEFT'); k('LEFT');
  { const n0 = R(S.T_EVN); k('ENTER'); closed('ENTER'); s.ok(R(S.T_EVN) === n0 + 1 && model.evlog[n0][0] === 7, () => `ENTER chose: T_EVN ${R(S.T_EVN)}, was ${n0}`); }
  // ESC, BREAK, MENU close with no choice
  for (const name of ['ESC', 'BREAK', 'MENU']) { const n0 = R(S.T_EVN); k('MENU'); k('DOWN'); k(name); closed(name); s.ok(R(S.T_EVN) === n0, () => `${name} posted an E_MENU`); }
  // ENTER on each enabled item of each menu: the ids
  for (let i = 0; i < 3; i++) for (let kk = 0; kk < model.menus[i].items.length; kk++) if (model.en[i][kk]) {
    k('MENU'); for (let j = 0; j < i; j++) k('RIGHT');
    for (let guard = 0; model.trk && model.trk.h !== kk && guard < 8; guard++) k('DOWN');
    s.ok(model.trk && model.trk.i === i && model.trk.h === kk, () => `reaching menu ${i} item ${kk}: model at ${JSON.stringify(model.trk)}`);
    k('ENTER', `ENTER on menu ${i} item ${kk}`);
  }
  // other events are dropped in keyboard tracking: moves, releases, other keys; the highlight stays
  k('MENU'); k('DOWN');
  moveTo(s, 100, 14, 60); commit(s, 'a pointer move while tracking by keyboard is dropped');
  for (const name of ['a', 'x', 'TAB', 'BACKTAB']) k(name, `dropped: ${name}`);
  k('ESC');
  // E_DOWN in the open menu's hit area hands over to pointer tracking: then moves select, release chooses
  place(s, 500, 180);
  k('MENU');
  { const it = model.itemPoint(0, 1); moveTo(s, it.x, it.y, 100); commit(s, 'pointer moved over item 1 while tracking by keyboard: dropped (h stays)');
    press(s); commit(s, 'E_DOWN on item 1: handed over to the pointer, h = item 1'); s.ok(model.trk && model.trk.mode === 'ptr' && model.trk.h === 1, 'handover (model)');
    const it0 = model.itemPoint(0, 0); moveTo(s, it0.x, it0.y, 100); commit(s, 'now moves select: item 0');
    const n0 = R(S.T_EVN); release(s); commit(s, 'release chooses item 0', { keep: true }); s.ok(R(S.T_EVN) === n0 + 1, () => `the release after a handover chose: T_EVN ${R(S.T_EVN)}`); }
  parkPtr(s);
  // E_DOWN on another title box: that menu opens by pointer; on the open menu's own title: continues; elsewhere: closes
  k('MENU'); { const b = model.boxPoint(2); moveTo(s, b.x, b.y, 100); commit(s, 'pointer on Edit\'s title (dropped)'); press(s); commit(s, 'E_DOWN on Edit\'s title: Edit opens, pointer tracking'); release(s); commit(s, 'released with no item: closed, no event', { keep: true }); }
  parkPtr(s);
  k('MENU'); { const b = model.boxPoint(0); moveTo(s, b.x, b.y, 100); press(s); commit(s, 'E_DOWN on the open menu\'s own title: nothing changes, pointer tracking'); release(s); commit(s, 'released: chooses its highlighted item (h was kept)', { keep: true }); }
  parkPtr(s);
  k('MENU'); k('RIGHT'); moveTo(s, 400, 120, 100); press(s); commit(s, 'E_DOWN elsewhere: closes', { keep: true }); release(s); commit(s, 'released after the closing press', { keep: true });
  parkPtr(s);
  k('MENU'); { const d = model.lay.drops[0]; moveTo(s, d.x + d.w + 1, 20, 100); press(s); commit(s, 'E_DOWN on the shadow (outside the hit area): closes', { keep: true }); release(s); commit(s, 'released', { keep: true }); }
  parkPtr(s);
  // E_DOWN on the drop-down's own frame (outside the hit area x + 1 <= px < x + W - 1, 9 <= py < 9 + 10 n): "elsewhere: close"
  { k('MENU'); const d = model.lay.drops[0];
    for (const [px, py, why] of [[d.x, 20, 'left frame column'], [d.x + d.w - 1, 20, 'right frame column (x + W - 1)'], [d.x + 20, 8, 'top frame row'], [d.x + 20, 9 + 10 * d.n, 'row below the last item (the bottom frame)'], [d.x + 20, 9 + 10 * d.n + 1, 'the shadow row']]) {
      if (!model.trk) k('MENU');
      moveTo(s, px, py, 100); press(s); commit(s, `E_DOWN on the ${why} (${px}, ${py}): not in the hit area, closes`, { keep: true }); s.ok(!model.trk, `${why}: the model closes`);
      release(s); commit(s, 'released', { keep: true });
    }
    parkPtr(s); }
  // MENU while the pointer is holding: pointer tracking drops MENU (checked in part 4); MENU after a closed menu opens again, from the first menu
  k('MENU'); k('RIGHT'); k('ESC'); k('MENU'); s.ok(model.trk && model.trk.i === 0, 'MENU opens the first menu again'); k('ESC');
  // menus with disabled items: MB_ENABLE moves where MENU and the arrows go
  { const en = (a, c, b) => { callW(s, `MB_ENABLE ${a},${c},${b}`, 'MB_ENABLE', { a, c, b }, { keep: ['b', 'c', 'd', 'e'], lim: 192 }); model.mbEnable(a, c, b); repark(); };
    en(0, 0, 0); en(0, 1, 0); commit(s, 'Leap: no enabled item', { keep: true });
    k('MENU'); s.ok(model.trk && model.trk.i === 1, 'MENU skips a menu with no enabled item: File opens (model)'); k('LEFT', 'LEFT into the menu with no enabled item: it opens, nothing highlighted'); k('DOWN', 'DOWN with none enabled: nothing'); k('UP', 'UP with none enabled: nothing'); k('ENTER', 'ENTER with none highlighted: closes with no event'); closed('ENTER with none');
    for (const [a, n] of [[1, 5], [2, 4]]) for (let c = 0; c < n; c++) en(a, c, 0);
    commit(s, 'no enabled item anywhere', { keep: true });
    k('MENU', 'MENU with no enabled item anywhere: nothing opens'); closed('MENU with nothing enabled');
    for (const [a, n] of [[0, 2], [1, 5], [2, 4]]) for (let c = 0; c < n; c++) en(a, c, 1);
    en(1, 2, 0);
    commit(s, 'everything enabled again, the separator off', { keep: true });
    k('MENU'); k('RIGHT'); for (let i = 0; i < 6; i++) k('DOWN'); k('ESC'); }
  parkPtr(s);
  s.end();
}

// ===========================================================================================================================
// 6. Modal dialogs, no menus, controls that take keys, MB_ENABLE, the bar's repaint.
if (ONLY.includes(6)) {
  const s = sec('MENU under a modal dialog, with no menus, or taken by a focused control; presses on the bar under a dialog; MB_ENABLE; the bar repainted in parts');
  reset(s); parkPtr(s);
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
  const D = DLGS[0], nEv0 = R(S.T_EVN);
  dOpen(s, D); commit(s, 'a modal dialog open');
  s.ok(model.modal === D && R(S.W_MODAL) === D.a, () => `W_MODAL ${hex(R(S.W_MODAL))}, the dialog ${hex(D.a)}`);
  key(s, 'MENU'); commit(s, 'MENU under a modal dialog does nothing', { keep: true });
  place(s, 60, 3); press(s); commit(s, 'a press on a title under a modal dialog: consumed and ignored (17.3)', { keep: true }); moveTo(s, 100, 4, 40); commit(s, 'moves over the bar', { keep: true }); release(s); commit(s, 'released', { keep: true });
  for (const name of ['ENTER', 'ESC', 'BREAK', 'LEFT', 'RIGHT']) { key(s, name); commit(s, `${name} under a modal dialog (no default / cancel): nothing`, { keep: true }); }
  s.ok(R(S.T_EVN) === nEv0, () => `an E_MENU was posted under a modal dialog (T_EVN ${R(S.T_EVN)}, was ${nEv0})`);
  dClose(s, D); commit(s, 'the dialog closed');
  key(s, 'MENU'); commit(s, 'MENU opens again once the dialog is closed'); key(s, 'ESC'); commit(s, 'closed', { keep: true });
  // a menu bar edit under the dialog: MB_SET with a dialog open draws at the next update; the dialog still blocks
  dOpen(s, D); commit(s, 'dialog open again');
  { const t = ramTable(MENUS_SPEC.slice(0, 2), 'two menus'); doMbSet(s, t, 'MB_SET (two menus) under a dialog'); settleBar(s, 'the bar changed under a dialog'); }
  key(s, 'MENU'); commit(s, 'still nothing under the dialog', { keep: true });
  dClose(s, D); commit(s, 'closed');
  key(s, 'MENU'); commit(s, 'MENU with the two-menu table'); key(s, 'ESC'); commit(s, 'closed', { keep: true });
  // MENU with no menus set
  doMbSet(s, null, 'MB_SET 0'); settleBar(s, 'bar without menus');
  key(s, 'MENU'); commit(s, 'MENU with no menus set does nothing', { keep: true }); place(s, 60, 3); press(s); commit(s, 'a press on the bar with no menus: nothing', { keep: true }); release(s); commit(s, 'released', { keep: true }); parkPtr(s);
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar again');
  // a focused control that takes the key: MENU never reaches the desk.  Find windows with a focusable control whose tag has bit 0, and ones whose have not
  let consuming = false, passing = false;
  for (const w of POOL) { dClose(s, w); }
  commit(s, 'windows closed');
  for (const w of POOL) {
    const kids = w.kids; if (!kids.length) continue;
    dOpen(s, w); commit(s, `window ${nm(w)} open, focus ${nm(model.focus)}`);
    const f = model.focus;
    const wantsOpen = !(f && f.kind === 'TCtl' && (f.tag & 1));
    key(s, 'MENU'); commit(s, `MENU with the focus on ${nm(f)} (tag ${f ? f.tag : '-'}): ${wantsOpen ? 'the menu opens' : 'the control takes the key, no menu'}`, { keep: !model.trk });
    s.ok(!!model.trk === wantsOpen, () => `model: MENU with a focused ${nm(f)} tag ${f && f.tag}`);
    if (model.trk) { key(s, 'ESC'); commit(s, 'closed', { keep: true }); passing = true; } else consuming = true;
    dClose(s, w); commit(s, 'closed');
  }
  // arrow keys and TAB move the focus when no menu is open and nobody consumes them (W1's walk); inside tracking they never do
  const W0 = POOL.find((w) => w.kids.length >= 1) || POOL[0];
  dOpen(s, W0); commit(s, 'window with controls');
  key(s, 'MENU'); if (model.trk) { for (const name of ['TAB', 'RIGHT', 'DOWN', 'LEFT']) { const f0 = R(S.K_FOCUS); key(s, name); commit(s, `${name} in keyboard tracking moves the highlight / menu, not the focus`); s.ok(R(S.K_FOCUS) === f0, 'K_FOCUS unchanged by tracking'); } key(s, 'ESC'); commit(s, 'closed', { keep: true }); }
  dClose(s, W0); commit(s, 'closed');
  console.log(`  MENU with a consuming focused control seen: ${consuming}, passing: ${passing}`);
  // the bar repainted in parts: W_INVAL of pieces of row 0 gives the same bar, the rest of the screen unchanged
  for (let i = 0; i < 8; i++) {
    const x = rng.int(0, 400), w = rng.int(1, 200);
    dInval(s, x, rng.int(0, 7), w, rng.int(1, 8)); commit(s, `W_INVAL of part of the bar (${x}, ., ${w}): repainted in pieces, same bar`, { keep: true });
  }
  dInval(s, 0, 0, 512, 192); commit(s, 'the whole screen repainted with menus set');
  // MB_ENABLE on out-of-range indices and separators changes nothing visible
  for (const [a, c, b] of [[3, 0, 1], [0, 2, 1], [1, 2, 1], [8, 8, 1], [255, 255, 1], [1, 15, 0]]) { callW(s, `MB_ENABLE ${a},${c},${b}`, 'MB_ENABLE', { a, c, b }, { keep: ['b', 'c', 'd', 'e'], lim: 192 }); model.mbEnable(a, c, b); repark(); }
  commit(s, 'MB_ENABLE with indices out of range and on a separator: nothing', { keep: true });
  key(s, 'MENU'); key(s, 'RIGHT'); for (let i = 0; i < 6; i++) key(s, 'DOWN'); commit(s, 'File open, the separator and Quit never highlighted'); key(s, 'ESC'); commit(s, 'closed', { keep: true });
  s.end();
}

// ===========================================================================================================================
// 7. Random interleavings (section 10, tests 6 and 8): tracking sessions by pointer and by keyboard, MB_ENABLE, MB_SET, window operations, keys.
if (ONLY.includes(7)) {
  const s = sec(`random interleavings: ${STEPS} operations (tracking sessions, moves, keys, MB_ENABLE, MB_SET, window operations), the model compared after every action`);
  reset(s); parkPtr(s);
  doMbSet(s, CART.T_MENUS, 'MB_SET T_MENUS'); settleBar(s, 'bar');
  const st = { sessions: 0, ptrSessions: 0, keySessions: 0, enables: 0, sets: 0, refusedSets: 0, winOps: 0, dialogs: 0, strayKeys: 0, subActions: 0, commits: 0, bars: 0 };
  const startFrames = FR.frames;
  const KEYS_ALL = ['MENU', 'ESC', 'BREAK', 'ENTER', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'DOWN', 'UP', 'RIGHT', 'LEFT', 'a', 'x', 'TAB', 'MENU'];
  const rndPick = (arr) => arr[rng.int(0, arr.length - 1)];
  /** A target point worth visiting: title boxes (edges too), item rows and edges of the open or another menu, or anywhere. */
  function targetPoint() {
    const r = rng.next(), L = model.lay;
    if (L && r < 0.30) { const b = rndPick(L.boxes); return { x: rng.int(b.x - 1, b.x + b.w), y: rng.int(0, 8) }; }
    if (L && r < 0.75) {
      const i = model.trk && rng.chance(0.8) ? model.trk.i : rng.int(0, L.drops.length - 1), d = L.drops[i], k = rng.int(-1, d.n);
      return { x: rndPick([d.x - 1, d.x, d.x + 1, d.x + (d.w >> 1), d.x + d.w - 2, d.x + d.w - 1, d.x + d.w, rng.int(d.x, d.x + d.w)]), y: k < 0 ? 8 : 9 + 10 * k + rndPick([0, 4, 5, 9, 10]) };
    }
    return { x: rng.int(0, 511), y: rng.int(0, 191) };
  }
  const canPress = (p) => !model.trk || model.trk.mode === 'key';
  function subAction() {
    st.subActions++;
    const r = rng.next();
    if (r < 0.34) { const p = targetPoint(); moveTo(s, p.x, p.y, rndPick([6, 25, 60, 120])); }
    else if (r < 0.66) key(s, rndPick(KEYS_ALL));
    else if (r < 0.80 && !ptr.btn) { let p = targetPoint(); if (!model.trk && !model.modal) p = { x: rng.int(0, 511), y: rng.int(0, 7) }; moveTo(s, p.x, p.y, 100); if (!model.trk || model.trk.mode === 'key') { if (!model.trk && !model.modal && ptr.y >= 8) return; press(s); } }
    else if (ptr.btn) release(s);
    else { const p = targetPoint(); moveTo(s, p.x, p.y, 100); }
  }
  /** A tracking session: start by MENU or by a press on a title, then a few random sub-actions, compared after each; end closed. */
  function session(kind) {
    st.sessions++;
    if (ptr.btn) { release(s); }
    if (kind === 'key') {
      st.keySessions++; key(s, 'MENU'); commit(s, `session: MENU`, { keep: !model.trk });
    } else {
      st.ptrSessions++;
      let p;
      if (model.lay && rng.chance(0.85)) { const b = rndPick(model.lay.boxes); p = { x: rng.int(b.x, b.x + b.w - 1), y: rng.int(0, 7) }; } else p = { x: rng.int(0, 511), y: rng.int(0, 7) };
      place(s, p.x, p.y); press(s); commit(s, `session: press at (${p.x}, ${p.y})`, { keep: !model.trk });
    }
    for (let k = rng.int(1, 9); k > 0 && model.trk && !s.bad; k--) { subAction(); st.commits++; commit(s, `session sub-action (${model.trk ? model.trk.mode : 'closed'})`, { keep: !model.trk }); }
    if (model.trk) { key(s, rng.pick(['ESC', 'BREAK'])); commit(s, 'session end: closed', { keep: true }); }
    if (ptr.btn) { release(s); commit(s, 'session end: released', { keep: true }); }
    s.ok(!model.trk, 'the session ended with the menu closed');
  }
  function randomSet() {
    st.sets++;
    const r = rng.next();
    let tbl, what;
    if (r < 0.2) { tbl = CART.T_MENUS; what = 'T_MENUS'; }
    else if (r < 0.3) { tbl = fixed8(); what = 'T_MENU8 corrected'; }
    else if (r < 0.4) { tbl = null; what = '0'; }
    else if (r < 0.52) {
      what = 'refused';
      const ms = rng.pick([() => [...randMenus(), ...randMenus(), ...randMenus()].slice(0, 9).concat(randMenus()).slice(0, 9), () => [], () => [menuSpec(1, 'abc', [])], () => [menuSpec(1, 'abc', Array.from({ length: 16 }, (_, i) => [i + 1, 0, 'x']))],
        () => [menuSpec(1, sw(520), [[1, 0, 'x']])], () => [menuSpec(1, 'abc', Array.from({ length: 15 }, (_, i) => [i + 1, 0, sw(140)]))]])();
      if (ms.length < 1 || ms.length > 8 || !layoutOf(ms).okLenient) { tbl = ramTable(ms.length > 9 ? ms.slice(0, 9) : ms, 'refused table'); } else tbl = ramTable(randMenus());
    } else { tbl = ramTable(randMenus(), 'random table'); what = 'random'; }
    const c = doMbSet(s, tbl, `MB_SET ${what}`);
    if (c) st.refusedSets++;
    commit(s, `MB_SET ${what} settled`, { keep: true });
  }
  function randomEnable() {
    st.enables++;
    let a, c;
    if (model.menus && rng.chance(0.85)) { a = rng.int(0, model.menus.length - 1); c = rng.int(0, model.menus[a].items.length - 1); } else { a = rng.int(0, 255); c = rng.int(0, 255); }
    if (rng.chance(0.1)) { a = rng.int(0, 9); c = rng.int(0, 16); }
    const b = rng.int(0, 1);
    callW(s, `MB_ENABLE ${a},${c},${b}`, 'MB_ENABLE', { a, c, b }, { keep: ['b', 'c', 'd', 'e'], lim: 192 });
    model.mbEnable(a, c, b); repark();
    commit(s, `MB_ENABLE ${a},${c},${b}`, { keep: true });
  }
  function randomWinOp() {
    st.winOps++;
    const o = rng.pick(['open', 'open', 'close', 'raise', 'move', 'dialog', 'dialog', 'dclose']);
    const w = rng.pick(o === 'dialog' || o === 'dclose' ? DLGS : (o === 'open' || o === 'raise' ? POOL : (model.list.length ? model.list : POOL)));
    if (o === 'open' || o === 'dialog') { const c = dOpen(s, w); if (w.kind === 'Dialog' && !c) st.dialogs++; }
    else if (o === 'close' || o === 'dclose') dClose(s, model.modal && rng.chance(0.7) ? model.modal : w);
    else if (o === 'raise') dRaise(s, w);
    else dMove(s, w, 16 * rng.int(0, (512 - w.w) / 16), 8 * rng.int(1, Math.floor((192 - w.h) / 8)));
    commit(s, `${o} ${nm(w)}`);
  }
  for (let step = 0; step < STEPS && !s.bad; step++) {
    const r = rng.next();
    if (ptr.btn) { release(s); commit(s, 'button released between operations', { keep: true }); }
    if (r < 0.14) session('key');
    else if (r < 0.32) session('ptr');
    else if (r < 0.40) randomEnable();
    else if (r < 0.50) randomSet();
    else if (r < 0.64) randomWinOp();
    else if (r < 0.80) { st.strayKeys++; const name = rndPick(KEYS_ALL); key(s, name); commit(s, `stray key ${name}`, { keep: !model.trk }); if (model.trk) { for (let g = 0; g < 4 && model.trk; g++) { subAction(); commit(s, 'stray key then ...', { keep: !model.trk }); } if (model.trk) { key(s, 'ESC'); commit(s, 'closed', { keep: true }); } } }
    else if (r < 0.88) { const p = { x: rng.int(0, 511), y: rng.int(0, 191) }; if (ptr.btn) release(s); place(s, p.x, p.y); commit(s, `warp (${p.x}, ${p.y})`, { keep: true }); }
    else if (r < 0.94) { st.bars++; const x = rng.int(0, 480), w = rng.int(1, 120); dInval(s, x, 0, w, 8); commit(s, `W_INVAL of part of the bar (${x}, ${w})`, { keep: true }); }
    else { const p = targetPoint(); if (ptr.btn) release(s); moveTo(s, p.x, p.y, rndPick([20, 100])); commit(s, `pointer move to (${p.x}, ${p.y})`, { keep: true }); }
    if (model.trk) { key(s, 'ESC'); commit(s, 'closed at the end of the operation', { keep: true }); }
  }
  commit(s, 'final', { min: 6 });
  st.frames = FR.frames - startFrames;
  const s3 = model.stats3;
  console.log(`  ${JSON.stringify(st)}\n  ${JSON.stringify(s3)}`);
  if (STEPS >= 200) {
    s.ok(st.sessions >= 50 && st.keySessions >= 10 && st.ptrSessions >= 15 && st.enables >= 10 && st.sets >= 10 && st.winOps >= 10, () => `coverage: ${JSON.stringify(st)}`);
    s.ok(s3.choices >= 10 && s3.noChoice >= 10 && s3.switches >= 10 && s3.hi >= 10 && s3.dropped >= 10, () => `coverage of the state machines: ${JSON.stringify(s3)}`);
  }
  reset(s);
  s.end();
}

SUP.end();
if (GRAY.length) console.log(`  (18.2's save-under rule read two ways, T2: ${GRAY.length} table(s) in the band: ${GRAY.filter((g) => g.carry).length} refused, ${GRAY.filter((g) => !g.carry).length} accepted by the machine)`);
console.log(`${fmt(N)} assertions; ${fmt(FR.frames)} frames run (${fmt(FR.idle)} idle), ${fmt(FR.quiet)} idle points compared`);
C.done();
void R4;
