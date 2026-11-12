"use strict";
// wm-w2.mjs -- slice W2 of the window manager (docs/WINDOWS.md sections 1-11, 14, 15, 17; test items 5, 6 and 8 of section 10, W2's parts), on the
// `kern4` cartridge.  Written from the contract, never from the code.  The reference is tests/wm-model2.mjs (on tests/wm-model.mjs).
//   node tests/wm-w2.mjs [--seed N] [--steps N] [--only LIST] [--build] [--verbose] [--mutate N] [--maxfail N]
//     --seed N     PRNG seed (printed; default from the clock)
//     --steps N    random gestures / operations in part 8 (default 400; each is several frames, so well over 300 frames)
//     --only LIST  parts: 0 boot and layout, 1 look (button, dialog, label), 2 raise on click, 3 drags, 4 modal rule, 5 dialog keys and the 4-frame
//                  flash, 6 buttons by pointer, 7 TAB and the focus look, 8 random interleavings (default all; the parts share one machine)
//     --mutate N   plant fault N in the model (1 W_RAISE not refused under a modal, 2 drag rounds toward zero instead of taking the floor, 3 BREAK does not
//                  cancel a drag) to show that the comparison catches it
//     --build      run tools/build.mjs kern4 first (default: use build/kern4.dck and build/kern4/ as they are)
//
//   TRACE=N prints the first N frames (PC, SP, V_FRAMES); TRACEOPS=1 prints each direct operation of part 8; --verbose dumps the first screen difference.
//
// How the frames run: the CPU is parked at T_APPLOOP (17.6) with interrupts on and TSRun's frames are run one at a time (`M.runFrame`).  At the
// end of a TSRun frame the next frame interrupt has been accepted (PC = $38), so the inputs set between two frames are read by that frame's K_POLL.
// The pointer is driven by the Kempston mouse (WINDOWS 15: `m.mouse`, `K_MSET`), the keys by `m.keyMatrix`.  The model gets the events the input
// produces (class `Ptr` of the model) and is compared with the machine whenever the application is idle: PC = $38 with the return address just after a
// `HALT`, both queues empty, nothing dirty (or a drag in progress).  After a key the test waits at least 6 frames (the 4-frame flash of a click).
//
// What is compared at every such point: W_MAP byte for byte, W_SLOTS, the desk's list (View_child / View_next), every node's parent / child / next / x /
// y / flags (the pressed bit) / slot / Window_focus, W_DIRTY, W_MODAL, K_FSCOPE, K_FOCUS, K_CAPTURE, T_EVN and the records T_APPLOOP wrote to T_EVLOG,
// K_PX / K_PY / K_BTN, and the whole display (the model's composition of the owners' images, with the drag's outline XORed when it is on the screen;
// the pointer's byte rectangles are left out).  And on every frame: V_FRAMES rises by exactly 1 (section 10 test 8).
//
// Readings of the contract (see also the header of tests/wm-model2.mjs, R1-R7):
//  T1. "Quiet" is judged from the machine: PC = $38 and the byte before the interrupted address is HALT.  A key click's HALTs are waited out by the 6
//      idle frames after every key; a pointer action waits at least 2.
//  T2. The pointer is placed with K_WARP (a direct call, no event) and one frame, so no E_MOVE comes of it.
//  T3. The press point of a drag is a point inside the title bar; the pointer cannot leave the screen, so the clamps at the four edges are reached with
//      the pointer at x 0 / 511 or y 0 / 191 (17.4 clamps the candidate whatever the pointer does).
//  T4. Stack: the bound of section 9 for W_DRAG (192) is read as "bytes used below $FF00 during a drag, ISR included, at most 192 + 32 (the ISR's)".
import { checks, M, FRAME_T } from './lib.mjs';
import { makeRng, call, hex, rd16, setGA } from './gfx6-lib.mjs';
import { rowsOf } from './kern-model2.mjs';
import { KEEP, armStack, stackUsed } from './kern-lib.mjs';
import { startW, WNEEDED, readDisp, writeDisp, diffDisp } from './wm-lib.mjs';
import { WmModel2, E, K, KEYSPEC, Ptr, drawInto, toDisp, titleCut, isWinKind, validRect, COLS, ROWS, NCELL, WHOLE } from './wm-model2.mjs';
import { Gfx6Model, fmtDiff } from './gfx6-model.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 400);
const MAXFAIL = argVal('--maxfail', 6);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8];
const VERBOSE = argv.includes('--verbose');
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} random gestures`);

const W2NEEDED = [...WNEEDED, 'CL_Dialog', 'CL_Button', 'CL_Label', 'Dialog_default', 'Dialog_cancel', 'Dialog_SIZE', 'Button_text', 'Button_SIZE', 'Label_text', 'Label_SIZE',
  'T_APPLOOP', 'T_EVONE', 'T_EVLOG', 'T_EVN', 'T_SOK', 'T_SCANCEL', 'W_DRAG', 'w_outline', 'K_MSET', 'K_WARP', 'K_PX', 'K_PY', 'K_BTN', 'K_RHEAD', 'K_RTAIL', 'K_PN', 'K_LOST',
  'desk_event', 'window_event', 'dialog_event', 'button_event', 'button_draw', 'button_fb', 'button_blur', 'label_draw', 'dialog_draw', 'V_FRAMES'];
const C = checks('wm W2');
const ctx = startW(C, W2NEEDED);
if (!ctx) { console.log('the kern4 cartridge is not available (or lacks the W2 symbols): nothing else can run'); C.done(); process.exit(); }
const { m, S, img } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const R = (a) => rd16(m, a);
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
let N = 0, stepNo = 0;
const FR = { frames: 0, idle: 0, quiet: 0, maxStack: 0 };

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 200 : MAXFAIL)) this.fails.push(`[#${stepNo}] ` + (typeof msg === 'function' ? msg() : msg)); } return c; }
  get bad() { return this.nf >= MAXFAIL * 3; }
  end() { C.check(`${this.name}: ${this.n} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}
const SECS = {};
const sec = (name) => (SECS[name] ??= new Sec(name));
const SUP = new Sec('set-up calls: registers, no DI, stack of K_NEW / K_ADDCHILD / K_ALLOC');
const nm = (n) => (n ? `${n.kind}@${n.a.toString(16)}${n.slot ? `#${n.slot}` : ''}${n.id ? `/id${n.id}` : ''}` : '0');
const carry = (res) => res.regs.f & 1;

// ---------------------------------------------------------------------------------------------------------------------------
// Direct calls: random registers, the generic checks of section 5 / 14.4 (IX, IY and the alternate set preserved, no DI, SP, stack).
let needRepark = false;
function callW(s, what, name, regs = {}, o = {}) {
  const pat = rng.chance(0.5) ? 0x55 : 0xAA;
  armStack(m, pat);
  const res = call(m, S, name, regs, { ints: o.ints ?? true, rng, guard: o.guard ?? 60_000_000 });
  needRepark = true;                                                         // the call left the CPU at T_RET: the next frame starts from the idle state again
  const moved = KEEP(!!o.ixOut).filter((r) => res.regs[r] !== res.regsIn[r]);
  s.ok(moved.length === 0, () => `${what}: changed ${moved.map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`).join(', ')} (IX unless an output, IY and the alternate set are preserved)`);
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
const STR = (s) => (typeof s === 'string' ? Array.from(s, (c) => c.charCodeAt(0)) : s);
function newStr(codes) {
  codes = STR(codes);
  const r = callW(SUP, 'K_ALLOC', 'K_ALLOC', { bc: codes.length + 1 }, { lim: 32 });
  const a = r.regs.hl; poke8(a, codes.length); codes.forEach((c, i) => poke8(a + 1 + i, c));
  return { addr: a, codes: codes.slice() };
}
const addKid = (parent, n) => { callW(SUP, 'K_ADDCHILD', 'K_ADDCHILD', { ix: parent.a, de: n.a }, { lim: 32 }); model.attach(parent, n); return n; };
/** A window of kind 'Window', 'TWin' or 'Dialog'. */
function newWin(kind, rect, title = null) {
  const [x, y, w, h] = rect, a = kNew(kind);
  setRect(a, x, y, w, h);
  const t = title === null || title === undefined ? null : typeof title === 'object' && title.addr ? title : newStr(title);
  if (kind !== 'Dialog') poke16(a + S.Window_title, t ? t.addr : 0);
  return model.addNode({ a, kind, x, y, w, h, title: kind === 'Dialog' ? null : t, default: null, cancel: null });
}
function newBtn(parent, rect, id, text = 'OK', flags = 1) {
  const [x, y, w, h] = rect, a = kNew('Button'), t = text === null ? null : newStr(text);
  setRect(a, x, y, w, h); poke8(a + S.View_flags, flags); poke8(a + S.View_id, id); poke16(a + S.Button_text, t ? t.addr : 0);
  return addKid(parent, model.addNode({ a, kind: 'Button', x, y, w, h, flags, id, text: t }));
}
function newLbl(parent, rect, text, flags = 0) {
  const [x, y, w, h] = rect, a = kNew('Label'), t = text === null ? null : newStr(text);
  setRect(a, x, y, w, h); poke8(a + S.View_flags, flags); poke16(a + S.Label_text, t ? t.addr : 0);
  return addKid(parent, model.addNode({ a, kind: 'Label', x, y, w, h, flags, text: t }));
}
function newCtl(parent, rect, tag, flags = 1, id = 0) {
  const [x, y, w, h] = rect, a = kNew('TCtl');
  setRect(a, x, y, w, h); poke8(a + S.View_flags, flags); poke8(a + S.View_id, id); poke8(a + S.TCtl_tag, tag);
  return addKid(parent, model.addNode({ a, kind: 'TCtl', x, y, w, h, flags, id, tag }));
}
function setDefaults(d, def, cancel) {
  poke16(d.a + S.Dialog_default, def ? def.a : 0); poke16(d.a + S.Dialog_cancel, cancel ? cancel.a : 0);
  d.default = def; d.cancel = cancel;
}
const setFlags = (n, f) => { n.flags = f; poke8(n.a + S.View_flags, f); };

// ---------------------------------------------------------------------------------------------------------------------------
// Running frames.
const BTN = (left) => 0xF8 | 1 | (left ? 0 : 2) | 4;                 // WINDOWS 15.1: active low, bit 0 right, bit 1 left, bit 2 middle, the rest 1
/**
 * Put the CPU where an idle application is at the end of a TSRun frame: the frame interrupt accepted (PC = $38, interrupts off) with the application's
 * wait loop as the interrupted code.  The next frame then runs the ISR (which reads the inputs set by then), then T_APPLOOP.  Direct calls leave the
 * machine's clock ahead of its frame counter: those frames are passed with the interrupt off (TSRun drops it), and the clock is moved to a frame end
 * when too little of the frame is left for the ISR to finish before the frame interrupt (an ISR running across it would lose it).
 */
function repark() {
  needRepark = false;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = 0xFF00 - 2; m.ram[cpu.sp] = S.T_APPLOOP & 0xFF; m.ram[cpu.sp + 1] = S.T_APPLOOP >> 8; cpu.pc = 0x38;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart > FRAME_T - 15000; k++) { if (m.tstates < m.frameStart + FRAME_T) m.tstates = m.frameStart + FRAME_T; M.runFrame(m); }
}
const isRetAfterHalt = () => { const ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8); return m.bus.read((ret - 1) & 0xFFFF) === 0x76; };
const queuesEmpty = () => m.ram[S.K_PN] === 0 && m.ram[S.K_RHEAD] === m.ram[S.K_RTAIL];
const quiet = () => cpu.pc === 0x38 && isRetAfterHalt() && queuesEmpty() && (m.ram[S.W_DIRTY] === 0 || !!model.drag);
let curBtn = 0;
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
/** One frame with the given input (the button state persists when `btn` is left out).  `feed` false: the model does not get the events (the flash test). */
function frame(s, inp = {}, feed = true) {
  if (needRepark) { repark(); needRepark = false; }
  inp = { ...inp, btn: inp.btn === undefined ? curBtn : inp.btn };
  setInputs(inp);
  const v0 = rd16(m, S.V_FRAMES);
  M.runFrame(m);
  if (process.env.TRACE && FR.frames < Number(process.env.TRACE)) console.log(`   frame ${FR.frames}: in ${JSON.stringify(inp)} -> PC ${hex(cpu.pc)} SP ${hex(cpu.sp)} ret ${hex(m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8))} halted ${cpu.halted} iff1 ${cpu.iff1} t ${m.tstates - m.frameStart} dV ${(rd16(m, S.V_FRAMES) - v0) & 0xFFFF} dirty ${m.ram[S.W_DIRTY]} pn ${m.ram[S.K_PN]} ring ${m.ram[S.K_RHEAD]}/${m.ram[S.K_RTAIL]}`);
  FR.frames++; if (!inp.key && !inp.dx && !inp.dy) FR.idle++;
  const dv = (rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
  if (dv !== 1 && VERBOSE && !frame.dumped) { frame.dumped = true; console.log(`   frame lost: input ${JSON.stringify(inp)}, PC ${hex(cpu.pc)} SP ${hex(cpu.sp)} iff1 ${cpu.iff1} halted ${cpu.halted}, t in frame ${m.tstates - m.frameStart}, stack top [${Array.from(m.ram.subarray(cpu.sp, cpu.sp + 8), (b) => b.toString(16))}], K_PN ${m.ram[S.K_PN]} ring ${m.ram[S.K_RHEAD]}/${m.ram[S.K_RTAIL]}, K_LOST ${m.ram[S.K_LOST]}`); }
  s.ok(dv === 1, () => `V_FRAMES rose by ${dv} in a frame, want exactly 1 (section 10 test 8; a frame interrupt was lost or doubled)`);
  const evs = ptr.step(inp);
  if (feed) for (const ev of evs) model.feed(ev);
  return evs;
}
/** Idle frames until the application is idle (at least `min`). */
function settle(s, min = 2, what = '') {
  for (let i = 1; ; i++) {
    frame(s, {});
    if (i >= min && quiet()) { FR.quiet++; model.idle(); return true; }
    if (i > 80) { s.ok(false, `${what}: the application did not become idle in 80 frames (PC ${hex(cpu.pc)}, queues empty ${queuesEmpty()}, W_DIRTY ${m.ram[S.W_DIRTY]}, drag ${!!model.drag})`); return false; }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The comparison.
function checkScreen(s, what, extraMask = null) {
  const exp = toDisp(model.screen());
  const mask = new Uint8Array(192 * 64).fill(0xFF);
  for (const [px, py] of [[ptr.px, ptr.py], [ptr.x, ptr.y]]) {
    const c0 = px >> 3;
    for (let y = py; y <= Math.min(py + 15, 191); y++) for (let c = c0; c <= Math.min(c0 + 2, 63); c++) mask[y * 64 + c] = 0;
  }
  if (extraMask) for (let i = 0; i < mask.length; i++) mask[i] &= extraMask[i];
  const cur = readDisp(m), d = diffDisp(cur, exp, mask);
  s.ok(d === null, () => `${what}: the screen differs from the model's composition${model.outline() ? ' with the outline' : ''}: ${d}`);
  if (d !== null && VERBOSE && !checkScreen.dumped) {
    checkScreen.dumped = true;
    let i = 0; while (((cur[i] ^ exp[i]) & mask[i]) === 0) i++;
    const y0 = Math.max(0, (i >> 6) - 10), bc0 = Math.max(0, (i & 63) - 5), bits = (v) => v.toString(2).padStart(8, '0').replace(/0/g, '.').replace(/1/g, '#');
    const lines = [];
    for (let y = y0; y < Math.min(192, y0 + 24); y++) { let a = '', b = ''; for (let bc = bc0; bc < Math.min(64, bc0 + 9); bc++) { a += bits(cur[y * 64 + bc]); b += bits(exp[y * 64 + bc]); } lines.push(`${String(y).padStart(3)} ${a}  ${b}`); }
    const px0 = (i & 63) * 8, py0 = i >> 6;
    const cover = [...model.nodes.values()].filter((n) => n.w > 0 && px0 + 40 >= n.x && px0 - 40 < n.x + n.w && py0 + 12 >= n.y && py0 - 12 < n.y + n.h && n.kind !== 'Desk')
      .map((n) => `${nm(n)} (${n.x},${n.y},${n.w},${n.h}) flags $${n.flags.toString(16)}${n.text ? ` text ${JSON.stringify(String.fromCharCode(...n.text.codes))}` : ''}`);
    console.log(`   machine | model, x from ${bc0 * 8}, rows from ${y0}:\n${lines.join('\n')}\n   nodes there: ${cover.join(' ; ')}; focus ${nm(model.focus)}; pointer model (${ptr.px},${ptr.py}) -> (${ptr.x},${ptr.y}) machine K_PX/K_PY (${R(S.K_PX)},${m.ram[S.K_PY]})`);
  }
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
  s.ok(R(S.K_CAPTURE) === (model.capture ? model.capture.a : 0), () => `${what}: K_CAPTURE ${hex(R(S.K_CAPTURE))}, model ${nm(model.capture)}`);
  s.ok(R(S.K_ROOT) === model.desk.a, () => `${what}: K_ROOT ${hex(R(S.K_ROOT))}`);
  for (const n of model.nodes.values()) {
    const a = n.a, par = n.parent ? n.parent.a : 0, ch = n.kids.length ? n.kids[0].a : 0;
    const sib = n.parent ? (n.parent.kids[n.parent.kids.indexOf(n) + 1]?.a ?? 0) : 0;
    const got2 = [R(a + S.View_parent), R(a + S.View_child), R(a + S.View_next), R(a + S.View_x), m.ram[a + S.View_y], m.ram[a + S.View_flags]];
    const exp2 = [par, ch, sib, n.x, n.y, n.flags];
    if (isWinKind(n.kind)) { got2.push(m.ram[a + S.Window_slot], R(a + S.Window_focus)); exp2.push(n.slot, n.focus ? n.focus.a : 0); }
    s.ok(got2.join() === exp2.join(), () => `${what}: ${nm(n)} fields [parent child next x y flags${isWinKind(n.kind) ? ' slot focus' : ''}] machine [${got2.map((v) => v.toString(16))}], model [${exp2.map((v) => v.toString(16))}]`);
  }
  const n = R(S.T_EVN), want2 = model.evlog;
  s.ok(n === want2.length, () => `${what}: T_EVN ${n} records, model ${want2.length} [${want2.map((r) => r.join('.')).join(' ')}]`);
  for (let k = Math.max(0, Math.min(n, want2.length) - 512); k < Math.min(n, want2.length); k++) {
    const a = S.T_EVLOG + 4 * (k & 511), got3 = Array.from(m.ram.subarray(a, a + 4));
    s.ok(got3.join() === want2[k].join(), () => `${what}: event record ${k}: machine [${got3}], model [${want2[k]}]`);
  }
  s.ok(R(S.K_PX) === ptr.x && m.ram[S.K_PY] === ptr.y && m.ram[S.K_BTN] === ptr.btn, () => `${what}: pointer K_PX ${R(S.K_PX)} K_PY ${m.ram[S.K_PY]} K_BTN ${m.ram[S.K_BTN]}, input model ${ptr.x} ${ptr.y} ${ptr.btn}`);
}
function checkAll(s, what, screen = true) { checkState(s, what); if (screen) checkScreen(s, what); }
/** Settle, then compare everything.  `min` idle frames at least. */
function commit(s, what, min = 2) { stepNo++; if (settle(s, min, what)) checkAll(s, what); }

// ---------------------------------------------------------------------------------------------------------------------------
// Direct operations at an idle point (never in a drag): the call, the model, the carry, then park and settle.
function opCarry(s, name, n, fn, regs, what = `${name} ${nm(n)}`) {
  if (model.drag) throw new Error('a direct call during a drag');
  const res = callW(s, what, name, regs ?? { ix: n.a });
  const exp = fn();
  s.ok(carry(res) === exp, () => `${what}: carry ${carry(res)}, model ${exp}`);
  repark();
  return exp;
}
const dOpen = (s, w) => opCarry(s, 'W_OPEN', w, () => model.open(w));
const dOpenOk = (s, w) => { const c = dOpen(s, w); s.ok(c === 0, () => `the test's window ${nm(w)} (${w.x},${w.y},${w.w},${w.h}) must open (the test's own mistake if not)`); return c; };
const dClose = (s, w) => opCarry(s, 'W_CLOSE', w, () => model.close(w));
const dRaise = (s, w) => opCarry(s, 'W_RAISE', w, () => model.raise(w));
const dMove = (s, w, x, y) => opCarry(s, 'W_MOVE', w, () => model.move(w, x, y), { ix: w.a, hl: x & 0xFFFF, de: y & 0xFFFF }, `W_MOVE ${nm(w)} (${w.x},${w.y}) -> (${x},${y})`);
function dSetFocus(s, v) {
  const what = `K_SETFOCUS ${nm(v)}`;
  const res = callW(s, what, 'K_SETFOCUS', { de: v ? v.a : 0 }, { lim: 128 });
  const exp = model.setFocus(v);
  s.ok(carry(res) === exp, () => `${what}: carry ${carry(res)}, model ${exp}`);
  repark();
}
function dDestroy(s, w) {
  callW(s, `M_DESTROY ${nm(w)}`, 'T_SEND', { ix: w.a, a: S.M_DESTROY }, { lim: 256 });
  model.destroyWindow(w); repark();
}
function place(s, x, y) {
  if (ptr.btn) throw new Error('place with the button down');
  callW(s, `K_WARP ${x},${y}`, 'K_WARP', { hl: x, de: y }, { ints: false, lim: 32 });
  ptr.warp(x, y);
  repark(); settle(s, 2, `warp to ${x},${y}`);
}
/** The pointer travels to (tx, ty) in steps of at most `step` per frame (one E_MOVE a frame). */
function travel(s, tx, ty, step = 40, extra = {}) {
  for (let g = 0; g < 200 && (ptr.x !== tx || ptr.y !== ty); g++) {
    const dx = Math.max(-step, Math.min(step, tx - ptr.x)), dy = Math.max(-step, Math.min(step, ty - ptr.y));
    frame(s, { dx, dy, ...extra });
  }
}
const press = (s) => frame(s, { btn: 1 });
const release = (s) => frame(s, { btn: 0 });
const key = (s, name) => frame(s, { key: name });
/** Close every window and settle: the start of each directed part. */
function reset(s) {
  if (model.drag) { key(s, 'ESC'); settle(s, 3); }
  if (ptr.btn) { release(s); settle(s, 3); }
  for (const w of [...model.list]) dClose(s, w);
  settle(s, 3);
  model.focus && dSetFocus(s, null);
  commit(s, 'reset');
  poke16(S.T_EVN, 0); model.evlog.length = 0;                               // every part counts its E_CMD records from 0
}
function destroyAll(s, wins) { for (const w of wins) if (model.nodes.has(w.a)) dDestroy(s, w); commit(s, 'destroyed'); }

// ---------------------------------------------------------------------------------------------------------------------------
// Boot: the mouse, the model.
function boot() {
  m.mouse.attached = true; m.mouse.x = 0; m.mouse.y = 0; m.mouse.buttons = BTN(0);
  call(m, S, 'K_MSET', { a: 1 }, { ints: false, rng });
  model = new WmModel2(R(S.W_SLOTS), R(S.W_SLOTS + 30));
  model.fault2 = argVal('--mutate', 0);
  ptr = new Ptr(R(S.K_PX), m.ram[S.K_PY]);
  poke16(S.T_EVN, 0);
  repark();
}
boot();

// ===========================================================================================================================
// 0. Boot and layout (17.1).
if (ONLY.includes(0)) {
  const s = sec('boot: class layout (17.1), the first repaint, the mouse');
  s.ok(S.Dialog_default === 21 && S.Dialog_cancel === 23 && S.Dialog_SIZE === 25 && S.Button_text === 16 && S.Button_SIZE === 18 && S.Label_text === 16 && S.Label_SIZE === 18,
    () => `field offsets: Dialog_default ${S.Dialog_default} _cancel ${S.Dialog_cancel} _SIZE ${S.Dialog_SIZE}, Button_text ${S.Button_text} _SIZE ${S.Button_SIZE}, Label_text ${S.Label_text} _SIZE ${S.Label_SIZE} (17.1: 25, 18, 18)`);
  s.ok(S.T_EVLOG === 0x5800, () => `T_EVLOG ${hex(S.T_EVLOG)}, want $5800`);
  commit(s, 'first settle: the bar and the desk');
  s.end();
}

// ===========================================================================================================================
// 1. Look (17.5): Button in its states, Dialog, Label, byte for byte against the gfx6 model.
if (ONLY.includes(1)) {
  const s = sec('look (17.5): button (normal, pressed, default, focused, combinations, sizes, texts), dialog, label (both fonts) against the gfx6 model');
  const saved = readDisp(m), focus0 = R(S.K_FOCUS);
  const seedAndDraw = (what, node) => {
    const bytes = new Uint8Array(192 * 64); for (let i = 0; i < bytes.length; i++) bytes[i] = rng.byte();
    writeDisp(m, bytes);
    [0, 512, 0, 192].forEach((c, i) => poke16(S.GCLIP + 2 * i, c));
    poke8(S.GLH, 11); poke8(S.GOP, rng.int(0, 2));
    const g = Gfx6Model.fromRam(m.ram);
    callW(s, what, 'T_SEND', { ix: node.a, a: S.M_DRAW }, { lim: 192 });
    drawInto(model, g, node);
    const d = g.compareRam(m.ram);
    s.ok(d === null, () => `${what}: ${fmtDiff(d)}`);
    s.ok(m.ram[S.GLH] === 11, () => `${what}: GLH was changed to ${m.ram[S.GLH]} (a draw method leaves GLH unchanged)`);
    s.ok([0, 1, 2, 3].map((i) => R(S.GCLIP + 2 * i)).join() === WHOLE.join(), () => `${what}: GCLIP was changed`);
  };
  const setFocusPoke = (n) => { poke16(S.K_FOCUS, n ? n.a : 0); model.focus = n; };
  const holder = newWin('Window', [0, 8, 512, 184]);                    // never opened: only a parent for the controls
  const randText = (len) => Array.from({ length: len }, () => rng.pick([rng.int(33, 126), rng.int(33, 126), 32]));
  const sizes = [[48, 16], [64, 16], [96, 24], [16, 8], [30, 12], [120, 40], [200, 16], [63, 17], [17, 31], [512, 24]];
  const texts = [[], 'OK', 'Cancel', 'A', 'Quit without saving', 'WWWWWWWWWWWWWWW', 'iiiii', randText(3), randText(9), randText(20)];
  let cases = 0;
  for (const text of texts) for (const [w, h] of sizes) {
    if (!rng.chance(0.55) && !(w === 64 && h === 16)) continue;
    const x = rng.int(0, 512 - w), y = rng.int(0, 192 - h);
    const b = newBtn(holder, [x, y, w, h], 1, STR(text).length ? text : null, 0);
    for (const flags of [0, 8, 0x10, 0x18]) for (const foc of [false, true]) {
      if (!(w === 64 && h === 16 && text === 'OK') && !rng.chance(0.3)) continue;
      setFlags(b, flags); setFocusPoke(foc ? b : null);
      seedAndDraw(`button ${w}x${h} at (${x},${y}) text ${JSON.stringify(STR(text).length > 10 ? '..' : (typeof text === 'string' ? text : STR(text)))} flags $${flags.toString(16)} focused ${foc}`, b); cases++;
    }
    setFocusPoke(null);
  }
  // a button wider text than itself (floor of a negative number), and no text at all focused
  for (const [w, h, t] of [[16, 16, 'WWWWWW'], [17, 16, 'WWWWWWW'], [20, 12, 'Quit now']]) {
    const b = newBtn(holder, [100, 60, w, h], 1, t, 0);
    for (const foc of [false, true]) { setFocusPoke(foc ? b : null); seedAndDraw(`button ${w}x${h} narrower than its text, focused ${foc} (tx = x + floor((w - tw) / 2) < x)`, b); cases++; }
    setFocusPoke(null);
  }
  // another view has the focus: no underline; another flag bits (focusable, bit 0) do not change the look
  { const b = newBtn(holder, [40, 40, 64, 16], 1, 'OK', 1), o = newBtn(holder, [200, 40, 64, 16], 2, 'No', 1); setFocusPoke(o); seedAndDraw('button focusable but the focus is on another view', b); setFocusPoke(null); }
  // labels: proportional and 8x8 text
  for (let i = 0; i < 24; i++) {
    const g8 = i % 2 === 1, x = g8 ? 8 * rng.int(0, 40) : rng.int(0, 300), y = g8 ? 8 * rng.int(0, 20) : rng.int(0, 170), w = rng.int(8, 200), h = rng.int(8, 20);
    const t = i < 2 ? null : randText(rng.int(1, 18));
    const l = newLbl(holder, [x, y, w, h], t, g8 ? 8 : 0);
    seedAndDraw(`label ${g8 ? '8x8' : 'proportional'} at (${x},${y}) ${w}x${h}, ${t ? t.length + ' codes' : 'no text'}`, l); cases++;
  }
  // dialogs: sizes, with and without children
  for (const [w, h] of [[48, 16], [64, 32], [192, 80], [256, 96], [512, 184], [96, 24]]) {
    const x = 16 * rng.int(0, (512 - w) / 16), y = 8 * rng.int(1, Math.floor((192 - h) / 8)), d = newWin('Dialog', [x, y, w, h]);
    seedAndDraw(`dialog ${w}x${h} at (${x},${y}), no children`, d);
    if (w >= 96 && h >= 24) {
      const ok = newBtn(d, [x + 8, y + h - 20, 40, 14], 1, 'OK', 0x11), no = newBtn(d, [x + 56, y + h - 20, 40, 14], 2, 'No', 1); newLbl(d, [x + 8, y + 5, 40, 8], 'Hi');
      setDefaults(d, ok, no); setFocusPoke(no);
      seedAndDraw(`dialog ${w}x${h} with an OK (default), a focused No and a label`, d); setFocusPoke(null);
    }
    cases++;
  }
  writeDisp(m, saved); poke16(S.K_FOCUS, focus0); model.focus = null;
  console.log(`  look: ${cases} drawings compared`);
  s.ok(cases > 100, () => `only ${cases} looks were drawn`);
  dDestroy(s, holder); repark();
  s.end();
}

// ===========================================================================================================================
// Scenes.
const TW = (n, p) => (n);
function sceneTwo() {
  const A = newWin('TWin', [16, 8, 160, 64], 'Window A'), B = newWin('TWin', [112, 40, 160, 64], 'Window B');
  const ba = newBtn(A, [40, 30, 48, 16], 5, 'OK'), ca = newBtn(A, [100, 30, 48, 16], 7, 'Cancel');
  const bb = newBtn(B, [130, 60, 48, 16], 6, 'Yes'), cb = newBtn(B, [190, 60, 48, 16], 8, 'No');
  return { A, B, ba, ca, bb, cb };
}
const centre = (n) => [n.x + (n.w >> 1), n.y + (n.h >> 1)];
const hand = {
  /** The candidate of 17.4 written out here, a second transcription: the window's new top left after a drag by (dx, dy). */
  cand(sx, sy, w, h, dx, dy) { return [Math.min(Math.max(sx + 16 * Math.floor((dx + 8) / 16), 0), 512 - w), Math.min(Math.max(sy + 8 * Math.floor((dy + 4) / 8), 8), 192 - h)]; },
};

// ===========================================================================================================================
// 2. A click on an inactive window raises it and nothing else gets the click (17.3).
if (ONLY.includes(2)) {
  const s = sec('raise on click: an inactive window is raised by a click, the click goes no further; its title drags');
  reset(s);
  const { A, B, ba, ca, bb, cb } = sceneTwo();
  dOpenOk(s, A); dOpenOk(s, B); commit(s, 'A and B open');
  s.ok(model.front() === B && R(S.K_FOCUS) === bb.a && R(S.K_FSCOPE) === B.a, () => `B opened last: front, focus on its first focusable bb: K_FOCUS ${hex(R(S.K_FOCUS))}`);
  place(s, 50, 38);                                                          // over A's button ba, where B does not cover A
  press(s); commit(s, 'press on A\'s button (A inactive)');
  s.ok(R(S.W_SLOTS + 2 * A.slot) === A.a && m.ram[S.W_MAP + 32 * 2 + 5] === A.slot && R(model.bar.a + S.View_next) === A.a, 'the click raised A: it is the bar\'s next sibling');
  s.ok((m.ram[ba.a + S.View_flags] & 8) === 0 && R(S.T_EVN) === 0 && R(S.K_CAPTURE) === 0, () => `nothing else got the click: ba flags $${m.ram[ba.a + S.View_flags].toString(16)}, T_EVN ${R(S.T_EVN)}, K_CAPTURE ${hex(R(S.K_CAPTURE))}`);
  s.ok(R(S.K_FOCUS) === ba.a && R(S.K_FSCOPE) === A.a, () => `activation gave A's first focusable the focus: K_FOCUS ${hex(R(S.K_FOCUS))} (ba ${hex(ba.a)})`);
  release(s); commit(s, 'release after the raise');
  s.ok(R(S.T_EVN) === 0, 'the release after a raising click makes no E_CMD (nothing was pressed)');
  press(s); release(s); commit(s, 'the second click: press and release on ba');
  s.ok(R(S.T_EVN) === 1 && m.ram[S.T_EVLOG] === 10 && m.ram[S.T_EVLOG + 1] === 5 && m.ram[S.T_EVLOG + 2] === A.slot && m.ram[S.T_EVLOG + 3] === 0, () => `E_CMD (id 5, A's slot ${A.slot}) in T_EVLOG: T_EVN ${R(S.T_EVN)}, record [${Array.from(m.ram.subarray(S.T_EVLOG, S.T_EVLOG + 4))}]`);
  // the title bar of the inactive window: raise, then the drag
  s.ok(model.front() === A, 'A is front');
  place(s, 200, 42);                                                         // B's title bar, past A's right edge (176)
  press(s); settle(s, 2); checkAll(s, 'title press on the inactive B: raised, the drag started');
  s.ok(R(S.W_SLOTS + 2 * B.slot) === B.a && R(model.bar.a + S.View_next) === B.a && !!model.drag, 'B raised, and a drag is in progress');
  travel(s, 232, 42, 16); settle(s, 2); checkAll(s, 'B dragged by 32: the outline');
  release(s); commit(s, 'B released');
  s.ok(B.x === 144 && B.y === 40, () => `B moved by (32, 0): now (${B.x}, ${B.y})`);
  // a click on A's content area (no control) while B is front: raise only
  press(s); release(s);
  place(s, 60, 60);                                                          // A's content, not on a control; B at 144..304 does not cover it
  press(s); commit(s, 'click on A\'s empty content (inactive): raise only'); release(s); commit(s, 'release');
  // the bar and the desk: nothing
  place(s, 300, 3); press(s); release(s); place(s, 400, 150); press(s); release(s); commit(s, 'bar and desk clicks');
  destroyAll(s, [A, B]);
  s.end();
}

// ===========================================================================================================================
// 3. Drags (17.4).
if (ONLY.includes(3)) {
  const s = sec('drags: move, snapping, clamping at four edges, ESC and BREAK, press-release, other events dropped, the outline, the screen after');
  reset(s);
  const A = newWin('TWin', [128, 48, 256, 96], 'Drag me');
  const b = newBtn(A, [150, 80, 48, 16], 3, 'Btn'); newCtl(A, [220, 80, 60, 30], 0, 1, 4); newLbl(A, [150, 110, 80, 8], 'text');
  dOpenOk(s, A); commit(s, 'A open');
  const startOf = () => [A.x, A.y];
  const home = () => { if (A.x !== 128 || A.y !== 48) { dMove(s, A, 128, 48); commit(s, 'home'); } };
  /** press in the title bar, move by (dx, dy) in steps, then finish as `how`. */
  const drag = (what, dx, dy, how = 'up', o = {}) => {
    home();
    const px = A.x + 72, py = A.y + 4, [sx, sy] = startOf();
    place(s, px, py);
    press(s); settle(s, 2, `${what}: press`);
    s.ok(!!model.drag && m.ram[S.W_DIRTY] === 0, `${what}: the drag started and W_UPDATE ran first`);
    checkAll(s, `${what}: after the press (no outline yet)`);
    const tx = Math.min(Math.max(px + dx, 0), 511), ty = Math.min(Math.max(py + dy, 0), 191);
    travel(s, tx, ty, o.step ?? 30);
    settle(s, 2, `${what}: moved`);
    const rdx = tx - px, rdy = ty - py;                                         // the pointer's real movement (it is clamped to the screen)
    const [ex, ey] = hand.cand(sx, sy, A.w, A.h, rdx, rdy);
    const outl = model.outline();
    s.ok((ex === sx && ey === sy) ? outl === null : !!outl && outl.x === ex && outl.y === ey, () => `${what}: the model's outline ${JSON.stringify(outl)}, hand-worked candidate (${ex}, ${ey}) from the start (${sx}, ${sy})`);
    checkAll(s, `${what}: mid-drag (outline ${outl ? `at (${outl.x},${outl.y})` : 'none'})`);
    if (o.during) o.during();
    if (how === 'up') release(s); else { key(s, how); }
    commit(s, `${what}: ${how === 'up' ? 'released' : how}`, how === 'up' ? 2 : 6);
    if (how !== 'up') { release(s); commit(s, `${what}: the release after the cancel`); }
    const want = how === 'up' ? [ex, ey] : [sx, sy];
    s.ok(A.x === want[0] && A.y === want[1], () => `${what}: the window is at (${A.x}, ${A.y}), hand-worked (${want[0]}, ${want[1]})`);
    s.ok(R(S.K_CAPTURE) === 0, `${what}: nothing took the capture`);
    return [A.x - sx, A.y - sy];
  };
  // snapping: dx -> 16 floor((dx + 8) / 16), dy -> 8 floor((dy + 4) / 8), both ways round the thresholds (hand-worked)
  for (const [dx, dy, ex, ey] of [[0, 0, 0, 0], [7, 3, 0, 0], [8, 4, 16, 8], [23, 11, 16, 8], [24, 12, 32, 16], [-8, -4, 0, 0], [-9, -5, -16, -8], [-24, -12, -16, -8], [-25, -13, -32, -16], [40, 20, 48, 24], [-40, -20, -32, -16], [100, -37, 96, -40]]) {
    const r = drag(`snap (${dx}, ${dy})`, dx, dy);
    s.ok(r[0] === ex && r[1] === ey, () => `drag by (${dx}, ${dy}): moved by (${r}), hand-worked (${ex}, ${ey})`);
  }
  // clamping: A is 256 x 96: x in [0, 256], y in [8, 96]
  s.ok(drag('clamp left', -200, 0)[0] === -128 && A.x === 0, `clamp left: x ${A.x} (want 0)`);
  s.ok(drag('clamp right', 300, 0)[0] === 128 && A.x === 256, () => `clamp right: x ${A.x} (want 512 - 256 = 256)`);
  s.ok(drag('clamp top', 0, -50)[1] === -40 && A.y === 8, () => `clamp top: y ${A.y} (want 8)`);
  s.ok(drag('clamp bottom', 0, 141)[1] === 48 && A.y === 96, () => `clamp bottom: y ${A.y} (want 192 - 96 = 96)`);
  drag('corner top left', -200, -50); drag('corner bottom right', 300, 141);
  // press and release with no move; moves under half a cell; a move and back to the start
  drag('press and release, no move', 0, 0);
  drag('a move of (7, 3): candidate = the start, no outline, no W_MOVE', 7, 3);
  drag('out and back to the start', 0, 0, 'up', { during: () => { /* the loop below moves out and back */ } });
  { home(); const px = A.x + 72, py = A.y + 4; place(s, px, py); press(s); settle(s, 2); travel(s, px + 60, py + 30); settle(s, 2); checkAll(s, 'out: outline'); travel(s, px + 3, py + 2); settle(s, 2); checkAll(s, 'back near the start: outline erased');
    s.ok(model.outline() === null, 'the model drew no outline back at the start'); release(s); commit(s, 'released at the start'); s.ok(A.x === 128 && A.y === 48, 'no move after going out and back to the start'); }
  // cancel by ESC and BREAK, with the outline drawn
  drag('ESC with the outline drawn', 80, 40, 'ESC'); drag('BREAK with the outline drawn', -64, 24, 'BREAK'); drag('ESC with no outline yet', 0, 0, 'ESC');
  // other events during a drag are dropped: TAB, ENTER (the focused button would click), SPACE, an arrow, a letter, BACKTAB
  { const f0 = R(S.K_FOCUS), n0 = R(S.T_EVN);
    drag('other events during a drag are dropped', 48, 24, 'up', { during: () => { for (const k of ['TAB', 'ENTER', 'SPACE', 'a', 'RIGHT', 'BACKTAB', 'MENU']) { key(s, k); settle(s, 6); } checkAll(s, 'keys during the drag: nothing happened'); s.ok(!!model.drag && R(S.K_FOCUS) === f0 && R(S.T_EVN) === n0, () => `after the keys: drag ${!!model.drag}, K_FOCUS ${hex(R(S.K_FOCUS))} (was ${hex(f0)}), T_EVN ${R(S.T_EVN)}`); } }); }
  // a drag with the button of the window's control focused: ENTER must not click it (covered above); the release over the control after an ESC is an ordinary E_UP
  { home(); const [bx, by] = centre(b); place(s, A.x + 72, A.y + 4); press(s); settle(s, 2); travel(s, bx, by, 30); settle(s, 2); key(s, 'ESC'); settle(s, 6); checkAll(s, 'ESC, the pointer over a button, the button still held');
    release(s); commit(s, 'released over the button after the cancel'); s.ok(R(S.T_EVN) === 0 && (m.ram[b.a + S.View_flags] & 8) === 0, 'the release over a button after a cancelled drag: no E_CMD, not pressed'); }
  // stack: the whole of a drag (the application and the ISR)
  { home(); const pat = 0x55; place(s, A.x + 72, A.y + 4); armStack(m, pat); press(s); travel(s, A.x + 150, A.y + 30, 30); release(s); settle(s, 3); const used = stackUsed(m, pat) + 2; FR.maxStack = Math.max(FR.maxStack, used);
    s.ok(used <= 192 + 32, () => `stack during a drag: ${used} bytes below $FF00 (the application and the ISR together), bound 192 + 32 (T4)`); console.log(`  stack during a drag: ${used} bytes (W_DRAG, K_DISPATCH, the routing and the ISR together)`); checkAll(s, 'after the stack drag'); }
  destroyAll(s, [A]);
  s.end();
}

// ===========================================================================================================================
// 4. The modal rule (17.2, 17.3).
if (ONLY.includes(4)) {
  const s = sec('modal rule: clicks outside the dialog ignored, W_RAISE and W_OPEN refused, buttons inside work, close ends it');
  reset(s);
  const { A, B, ba, ca, bb, cb } = sceneTwo();
  const D = newWin('Dialog', [96, 96, 192, 80]);
  const dok = newBtn(D, [110, 140, 48, 16], 1, 'OK', 0x11), dno = newBtn(D, [200, 140, 64, 16], 2, 'Cancel', 1); newLbl(D, [112, 106, 120, 8], 'Are you sure?');
  setDefaults(D, dok, dno);
  const E1 = newWin('TWin', [16, 112, 64, 32]), D2 = newWin('Dialog', [16, 112, 96, 32]);
  dOpenOk(s, A); dOpenOk(s, B); commit(s, 'A, B');
  s.ok(dOpenOk(s, D) === 0, 'W_OPEN of the dialog: carry clear');
  commit(s, 'the dialog open');
  s.ok(R(S.W_MODAL) === D.a && R(S.K_FOCUS) === dok.a && R(S.K_FSCOPE) === D.a, () => `W_MODAL ${hex(R(S.W_MODAL))} (want the dialog ${hex(D.a)}), K_FOCUS ${hex(R(S.K_FOCUS))} (its first focusable ${hex(dok.a)})`);
  // the routines
  s.ok(dRaise(s, A) === 1 && R(model.bar.a + S.View_next) === D.a, 'W_RAISE of A under a modal: carry, the dialog still in front');
  s.ok(dRaise(s, D) === 0, 'W_RAISE of the dialog itself: nothing, no carry');
  s.ok(dOpen(s, E1) === 1 && E1.slot === 0, 'W_OPEN of another window under a modal: carry');
  s.ok(dOpen(s, D2) === 1 && D2.slot === 0, 'W_OPEN of a second dialog: carry');
  commit(s, 'refusals changed nothing');
  // clicks outside: ignored (the desk, the bar, A's title bar, B's title bar, A's button, the dialog's own frame area outside its children)
  for (const [x, y, what] of [[400, 150, 'the desk'], [300, 3, 'the bar'], [60, 12, 'A\'s title bar'], [200, 42, 'B\'s title bar'], [50, 38, 'A\'s button'], [140, 66, 'B\'s button'], [95, 100, 'the left of the dialog (x 95)'], [288, 100, 'the right of the dialog'], [150, 95, 'above the dialog (y 95)']]) {
    place(s, x, y); press(s); settle(s, 2); release(s); commit(s, `modal: a click on ${what}`);
    s.ok(R(model.bar.a + S.View_next) === D.a && R(S.T_EVN) === 0 && !model.drag, () => `a click on ${what}: the dialog must stay in front, no E_CMD, no drag`);
  }
  // a press outside and a drag over the dialog's button: nothing is pressed
  place(s, 400, 150); press(s); travel(s, ...centre(dok)); settle(s, 2); checkAll(s, 'press outside, dragged onto OK'); release(s); commit(s, 'released on OK'); s.ok(R(S.T_EVN) === 0, 'a press outside that is released on OK: no E_CMD');
  // inside: on the dialog's frame (no control), on its label: nothing; on a window title nothing to drag
  place(s, 100, 100); press(s); release(s); place(s, 150, 108); press(s); release(s); commit(s, 'clicks on the dialog itself');
  s.ok(R(S.T_EVN) === 0 && D.x === 96 && D.y === 96, 'the dialog is never dragged');
  // inside: a click on Cancel
  place(s, ...centre(dno)); press(s); settle(s, 2); checkAll(s, 'Cancel pressed'); s.ok((m.ram[dno.a + S.View_flags] & 8) === 8 && R(S.K_CAPTURE) === dno.a && R(S.K_FOCUS) === dno.a, () => `Cancel pressed: flags $${m.ram[dno.a + S.View_flags].toString(16)}, K_CAPTURE ${hex(R(S.K_CAPTURE))}, K_FOCUS ${hex(R(S.K_FOCUS))}`);
  release(s); commit(s, 'Cancel clicked');
  s.ok(R(S.T_EVN) === 1 && m.ram[S.T_EVLOG] === 10 && m.ram[S.T_EVLOG + 1] === 2 && m.ram[S.T_EVLOG + 2] === D.slot, () => `E_CMD (Cancel id 2, the dialog's slot ${D.slot}): [${Array.from(m.ram.subarray(S.T_EVLOG, S.T_EVLOG + 4))}]`);
  place(s, ...centre(dok)); press(s); travel(s, 400, 150); settle(s, 2); checkAll(s, 'OK pressed and dragged outside the dialog'); release(s); commit(s, 'released outside after leaving OK');
  s.ok(R(S.T_EVN) === 1, 'OK pressed, dragged out of the dialog and released: no E_CMD (the capture follows the pointer out)');
  // close: the modal ends and the window below is activated; raising works again
  s.ok(dClose(s, D) === 0, 'W_CLOSE of the dialog'); commit(s, 'dialog closed');
  s.ok(R(S.W_MODAL) === 0 && R(S.K_FSCOPE) === B.a && model.front() === B, () => `W_MODAL ${hex(R(S.W_MODAL))} after the close, K_FSCOPE ${hex(R(S.K_FSCOPE))} (B ${hex(B.a)})`);
  s.ok(dRaise(s, A) === 0 && dOpenOk(s, E1) === 0, 'after the dialog: W_RAISE and W_OPEN work'); commit(s, 'raise and open again');
  place(s, 60, 12); press(s); settle(s, 2); checkAll(s, 'A\'s title bar works again'); release(s); commit(s, 'released');
  // a dialog opened over a dialog-free scene twice (the modal is cleared and set again)
  dClose(s, E1); dOpenOk(s, D); commit(s, 'dialog again'); s.ok(R(S.W_MODAL) === D.a, 'W_MODAL set again'); dClose(s, B); commit(s, 'another window closed under the modal'); s.ok(R(S.W_MODAL) === D.a, 'closing another window leaves the modal');
  dClose(s, D); commit(s, 'closed');
  destroyAll(s, [A, B, D, E1, D2]);
  s.end();
}

// ===========================================================================================================================
// 5. Keys in a dialog and on a focused button; the 4-frame flash (17.3).
if (ONLY.includes(5)) {
  const s = sec('dialog keys and key clicks: ENTER, ESC, BREAK, SPACE; the 4-frame flash, then E_CMD with the right data');
  reset(s);
  const A = newWin('TWin', [16, 8, 160, 64], 'Behind');
  const D = newWin('Dialog', [96, 96, 192, 80]);
  const tc = newCtl(D, [110, 110, 60, 14], 0, 1, 9);                       // a focusable view that does not take keys: they bubble to the dialog
  const dok = newBtn(D, [110, 140, 48, 16], 11, 'OK', 0x11), dno = newBtn(D, [200, 140, 64, 16], 12, 'Cancel', 1);
  setDefaults(D, dok, dno);
  dOpenOk(s, A); dOpenOk(s, D); commit(s, 'dialog open');
  s.ok(R(S.K_FOCUS) === tc.a, () => `the dialog's first focusable (the TCtl) has the focus: ${hex(R(S.K_FOCUS))}`);
  place(s, 450, 170);
  /** A key click, frame by frame: the button looks pressed at the end of the frames F .. F+3, then normal, with the E_CMD posted by the end of F+4. */
  const flash = (what, keyName, btn, id, slot) => {
    const n0 = R(S.T_EVN);
    const evs = frame(s, { key: keyName }, false);                             // frame F: K_POLL posts the key, the loop handles it
    const seen = [];
    const model0 = btn.flags;
    for (let i = 0; i < 4; i++) {
      if (i > 0) frame(s, {}, false);
      const pressedOnScreen = (() => { btn.flags = model0 | 8; const ok = checkScreenQuiet(btn); btn.flags = model0; return ok; })();
      const normalOnScreen = checkScreenQuiet(btn);
      seen.push(pressedOnScreen ? 'P' : normalOnScreen ? 'n' : '?');
      s.ok(R(S.T_EVN) === n0, () => `${what}: E_CMD posted already at the end of frame F+${i} (T_EVN ${R(S.T_EVN)}), the flash is 4 frames`);
    }
    frame(s, {}, false);                                                       // frame F+4
    const normalAfter = checkScreenQuiet(btn);
    seen.push(normalAfter ? 'n' : '?');
    s.ok(seen.join('') === 'PPPPn', () => `${what}: the button's look at the ends of the frames F..F+4 is "${seen.join('')}", want PPPPn (pressed for 4 frames, then normal; P pressed, n normal, ? neither)`);
    s.ok(R(S.T_EVN) === n0 + 1, () => `${what}: T_EVN ${R(S.T_EVN)} at the end of F+4, want ${n0 + 1}`);
    const a = S.T_EVLOG + 4 * (n0 & 511);
    s.ok(m.ram[a] === 10 && m.ram[a + 1] === id && m.ram[a + 2] === slot && m.ram[a + 3] === 0, () => `${what}: E_CMD record [${Array.from(m.ram.subarray(a, a + 4))}], want [10, ${id}, ${slot}, 0]`);
    for (const ev of evs) model.feed(ev);
    model.idle();
    settle(s, 2, what); checkAll(s, what);
  };
  /** The screen against the model, inside the button's rectangle only (the flash test looks at one button). */
  const checkScreenQuiet = (btn) => {
    const exp = toDisp(model.screen()), cur = readDisp(m);
    const maskR = new Uint8Array(192 * 64);
    const x0 = btn.x, x1 = btn.x + btn.w;
    for (let y = btn.y; y < btn.y + btn.h; y++) for (let bc = x0 >> 3; bc <= (x1 - 1) >> 3; bc++) { const lo = Math.max(x0, bc * 8) - bc * 8, hi = Math.min(x1, bc * 8 + 8) - bc * 8; maskR[y * 64 + bc] = ((0xFF >> lo) & (0xFF << (8 - hi)) & 0xFF); }
    for (const [px, py] of [[ptr.px, ptr.py], [ptr.x, ptr.y]]) { const c0 = px >> 3; for (let y = py; y <= Math.min(py + 15, 191); y++) for (let c = c0; c <= Math.min(c0 + 2, 63); c++) maskR[y * 64 + c] = 0; }
    return diffDisp(cur, exp, maskR) === null;
  };
  // ENTER: the focus is on the TCtl, which does not take it, so the default button clicks (flash, then E_CMD id 11)
  flash('ENTER, focus on a view that does not take it: the default button', 'ENTER', dok, 11, D.slot);
  flash('ESC: the cancel button', 'ESC', dno, 12, D.slot);
  flash('BREAK: the cancel button', 'BREAK', dno, 12, D.slot);
  // other keys do nothing
  { const n0 = R(S.T_EVN); for (const k of ['a', 'SPACE', 'MENU']) { key(s, k); settle(s, 6, k); } commit(s, 'other keys in a dialog (SPACE with the focus on the TCtl): nothing'); }
  s.ok(R(S.T_EVN) === 3, () => `other keys (a, SPACE with no button focused, MENU) made no E_CMD: T_EVN ${R(S.T_EVN)}`);
  // the focus on a button: ENTER and SPACE click the focused button itself (cancel is focused, not the default)
  key(s, 'TAB'); settle(s, 6); checkAll(s, 'TAB: OK focused'); key(s, 'TAB'); settle(s, 6); checkAll(s, 'TAB: Cancel focused');
  s.ok(R(S.K_FOCUS) === dno.a, () => `TAB twice: K_FOCUS ${hex(R(S.K_FOCUS))}, Cancel is ${hex(dno.a)}`);
  flash('ENTER with Cancel focused: Cancel itself clicks, not the default', 'ENTER', dno, 12, D.slot);
  flash('SPACE with Cancel focused', 'SPACE', dno, 12, D.slot);
  key(s, 'BACKTAB'); settle(s, 6); s.ok(R(S.K_FOCUS) === dok.a, 'BACKTAB: OK focused');
  flash('ENTER with OK focused', 'ENTER', dok, 11, D.slot);
  flash('SPACE with OK focused', 'SPACE', dok, 11, D.slot);
  flash('ESC with OK focused: ESC is not the button\'s, it bubbles to the dialog: Cancel', 'ESC', dno, 12, D.slot);
  // the focus wraps inside the dialog (the scope), never to the window behind
  for (let i = 0; i < 4; i++) { key(s, 'TAB'); settle(s, 6); s.ok(model.focus !== null && model.under(model.focus, D), 'TAB stays inside the dialog'); }
  commit(s, 'TABs inside the dialog');
  // Dialog_default = 0, Dialog_cancel = 0: ENTER, ESC do nothing once the focus is on a view that takes no key
  setDefaults(D, null, null); dSetFocus(s, tc); commit(s, 'defaults cleared');
  const nEv = R(S.T_EVN);
  key(s, 'ENTER'); settle(s, 6); key(s, 'ESC'); settle(s, 6); key(s, 'BREAK'); commit(s, 'ENTER, ESC, BREAK with no default and no cancel', 6);
  s.ok(R(S.T_EVN) === nEv, () => `no default and no cancel: ENTER / ESC / BREAK posted nothing (T_EVN ${R(S.T_EVN)}, was ${nEv})`);
  // a plain window with a focused button: ENTER / SPACE click it (not a dialog); the slot is the window's
  dClose(s, D); setDefaults(D, dok, dno); commit(s, 'dialog closed');
  const P = newWin('TWin', [208, 56, 160, 64], 'Plain'), pb = newBtn(P, [220, 80, 48, 16], 21, 'Go'), pc = newBtn(P, [290, 80, 48, 16], 22, 'Stop');
  dOpenOk(s, P); commit(s, 'a plain window'); place(s, 450, 170);
  flash('ENTER on the focused button of a plain window', 'ENTER', pb, 21, P.slot);
  key(s, 'TAB'); settle(s, 6); flash('SPACE on the second button', 'SPACE', pc, 22, P.slot);
  key(s, 'ESC'); commit(s, 'ESC in a plain window: nothing', 6);
  dClose(s, P); commit(s, 'closed');
  destroyAll(s, [A, D, P]);
  s.end();
}

// ===========================================================================================================================
// 6. Buttons by pointer (17.3): pressed look, out and back, released inside or outside.
if (ONLY.includes(6)) {
  const s = sec('buttons by pointer: press, drag out and back, release inside or outside, E_CMD and the pressed look');
  reset(s);
  const A = newWin('TWin', [16, 8, 208, 80], 'Buttons'), b = newBtn(A, [40, 30, 48, 16], 31, 'One'), c = newBtn(A, [110, 30, 48, 16], 32, 'Two', 0x11);
  const lab = newLbl(A, [40, 60, 100, 8], 'Hello'), t8 = newLbl(A, [40, 68, 64, 8], 'Eight', 8);
  dOpenOk(s, A); commit(s, 'A open');
  s.ok(R(S.K_FOCUS) === b.a, 'the first button has the focus');
  const pr = (n) => (m.ram[n.a + S.View_flags] & 8) !== 0;
  place(s, 60, 36);
  press(s); settle(s, 2); checkAll(s, 'b pressed');
  s.ok(pr(b) && R(S.K_CAPTURE) === b.a && R(S.K_FOCUS) === b.a, () => `E_DOWN on b: pressed ${pr(b)}, K_CAPTURE ${hex(R(S.K_CAPTURE))} (b ${hex(b.a)})`);
  travel(s, 100, 36, 20); settle(s, 2); checkAll(s, 'moved out of b (over the gap)'); s.ok(!pr(b), 'out of b: not pressed');
  travel(s, 130, 36, 20); settle(s, 2); checkAll(s, 'over c while b has the capture'); s.ok(!pr(b) && !pr(c) && R(S.K_CAPTURE) === b.a, 'over c: neither is pressed, b still has the capture');
  travel(s, 70, 38, 20); settle(s, 2); checkAll(s, 'back in b'); s.ok(pr(b), 'back in b: pressed again');
  release(s); commit(s, 'released inside b');
  s.ok(!pr(b) && R(S.K_CAPTURE) === 0 && R(S.T_EVN) === 1 && m.ram[S.T_EVLOG + 1] === 31 && m.ram[S.T_EVLOG + 2] === A.slot, () => `released inside after out-and-back: E_CMD (31, ${A.slot}): T_EVN ${R(S.T_EVN)}, record [${Array.from(m.ram.subarray(S.T_EVLOG, S.T_EVLOG + 4))}]`);
  // press, out, release outside: no E_CMD
  place(s, 60, 36); press(s); travel(s, 150, 70, 30); settle(s, 2); checkAll(s, 'b pressed, dragged out'); release(s); commit(s, 'released outside b');
  s.ok(R(S.T_EVN) === 1 && !pr(b) && R(S.K_CAPTURE) === 0, () => `released outside: no E_CMD (T_EVN ${R(S.T_EVN)}), not pressed, no capture`);
  // press the second (default) button: focus moves to it, E_CMD with its own id
  place(s, 130, 40); press(s); settle(s, 2); checkAll(s, 'c (default) pressed: focus moves'); s.ok(R(S.K_FOCUS) === c.a, 'the click focused c'); release(s); commit(s, 'c released');
  s.ok(R(S.T_EVN) === 2 && m.ram[S.T_EVLOG + 5] === 32, () => `E_CMD of c (32): T_EVN ${R(S.T_EVN)}, id ${m.ram[S.T_EVLOG + 5]}`);
  // moves without a press do not press anything; a press on a label or the window's empty area does nothing
  place(s, 60, 36); travel(s, 70, 40, 5); settle(s, 2); checkAll(s, 'moves over b with no press'); s.ok(!pr(b), 'a move over a button with no capture does not press it');
  place(s, 60, 63); press(s); release(s); commit(s, 'press and release on a label'); place(s, 180, 40); press(s); release(s); commit(s, 'press and release on empty content');
  s.ok(R(S.T_EVN) === 2, 'labels and empty content make no E_CMD');
  // two presses in a row; each makes its E_CMD, with the focus moving back and forth
  for (let i = 0; i < 3; i++) { const t = i & 1 ? c : b; place(s, ...centre(t)); press(s); release(s); commit(s, `click ${i}`); }
  s.ok(R(S.T_EVN) === 5, () => `three clicks, three E_CMD: T_EVN ${R(S.T_EVN)}`);
  // a press, then a key (ENTER) while held: the focused button's key click runs, the pointer's button goes on
  place(s, 60, 36); press(s); settle(s, 2); key(s, 'TAB'); settle(s, 6); checkAll(s, 'TAB while a button is held'); release(s); commit(s, 'release after the TAB');
  destroyAll(s, [A]);
  s.end();
}

// ===========================================================================================================================
// 7. TAB inside the front window and the focus look (17.3, 14.4).
if (ONLY.includes(7)) {
  const s = sec('TAB and BACKTAB stay in the front window; the focus look (the underline) follows K_FOCUS');
  reset(s);
  const A = newWin('TWin', [16, 8, 224, 80], 'A'), B = newWin('TWin', [256, 8, 224, 80], 'B');
  const a1 = newBtn(A, [24, 24, 48, 16], 41, 'One'), a2 = newBtn(A, [88, 24, 48, 16], 42, 'Two', 0), a3 = newBtn(A, [152, 24, 48, 16], 43, 'Three');
  const b1 = newBtn(B, [264, 24, 48, 16], 51, 'Uno'), b2 = newBtn(B, [328, 24, 48, 16], 52, 'Dos'), b3 = newBtn(B, [392, 24, 48, 16], 53, 'Tres', 0x11);
  dOpenOk(s, A); dOpenOk(s, B); commit(s, 'A and B open');
  const foc = (v, what) => { s.ok(R(S.K_FOCUS) === v.a, () => `${what}: K_FOCUS ${hex(R(S.K_FOCUS))}, want ${nm(v)}`); };
  foc(b1, 'B opened last: its first button');
  for (const [k, want, what] of [['TAB', b2, 'TAB: b2'], ['TAB', b3, 'TAB: b3'], ['TAB', b1, 'TAB wraps inside B (never to A)'], ['BACKTAB', b3, 'BACKTAB wraps backwards to b3'], ['BACKTAB', b2, 'BACKTAB: b2'], ['RIGHT', b3, 'RIGHT is NEXT too'], ['LEFT', b2, 'LEFT is PREV']]) {
    key(s, k); commit(s, what, 6); foc(want, what);
  }
  // 17.3 as amended: the button that lost the focus is redrawn without the underline, the one that got it with it (hand-worked pixels: the underline
  // is the row ty + 8 = y + 12 of a 16-high button, from tx = x + floor((w - tw) / 2) for tw pixels)
  { const tw = (b) => new Gfx6Model().textw(b.text.codes), ul = (b) => { const t = b.x + Math.floor((b.w - tw(b)) / 2), row = readDisp(m); const px = (x) => (row[(b.y + 12) * 64 + (x >> 3)] >> (7 - (x & 7))) & 1; return Array.from({ length: tw(b) }, (_, i) => px(t + i)); };
    foc(b2, 'b2 has the focus after the loop above');
    s.ok(ul(b2).every((v) => v === 1) && ul(b1).every((v) => v === 0) && ul(b3).every((v) => v === 0), 'only the focused button has its underline (tw pixels at row y + 12)');
    key(s, 'TAB'); settle(s, 6); foc(b3, 'TAB: b3 (underline test)');
    s.ok(ul(b3).every((v) => v === 1), 'the button that got the focus has its underline');
    s.ok(ul(b2).every((v) => v === 0), 'the button that lost the focus has no underline (button_blur draws without it)');
    key(s, 'BACKTAB'); settle(s, 6); foc(b2, 'BACKTAB back to b2'); s.ok(ul(b2).every((v) => v === 1) && ul(b3).every((v) => v === 0), 'and back: b2 underlined, b3 not'); }
  // the focus look: only the focused button has the underline (the screen check includes it); a click on A raises it: A restores its focus
  place(s, 40, 70); press(s); commit(s, 'click on A\'s empty content: A raised only'); release(s); commit(s, 'released');
  foc(a1, 'A raised: its first button (nothing saved yet)'); s.ok(R(B.a + S.Window_focus) === b2.a, () => `B saved b2 as its focus: ${hex(R(B.a + S.Window_focus))}`);
  for (const [k, want] of [['TAB', a3], ['TAB', a1], ['BACKTAB', a3]]) { key(s, k); commit(s, `A: ${k}`, 6); foc(want, `A: ${k} skips the disabled-focus a2 (not focusable)`); }
  // raise B by its title: its saved focus is back
  place(s, 400, 12); press(s); settle(s, 2); release(s); commit(s, 'B raised by its title bar (a click with no move)');
  foc(b2, 'B raised: b2 restored'); s.ok(R(A.a + S.Window_focus) === a3.a, 'A saved a3');
  // a click on a button gives it the focus (and the underline) even in the same window
  place(s, ...centre(b3)); press(s); settle(s, 2); checkAll(s, 'b3 pressed: focus look moved'); foc(b3, 'the click gave b3 the focus'); release(s); commit(s, 'b3 clicked');
  // close the front window: the other is activated with its saved focus
  dClose(s, B); commit(s, 'B closed'); foc(a3, 'B closed: A activated, a3 restored');
  key(s, 'TAB'); commit(s, 'TAB in A', 6); foc(a1, 'TAB in A wraps to a1');
  destroyAll(s, [A, B]);
  s.end();
}

// ===========================================================================================================================
// 8. Random interleavings.
if (ONLY.includes(8)) {
  const s = sec('random interleavings: gestures, keys, direct window operations and dialogs; events, list, map, focus, capture, modal and the screen against the model');
  reset(s);
  const wins = [], dlgs = [];
  // A text wider than its button draws its focus underline (and the text) outside the button's rectangle, where a redraw of the button alone (clip = the
  // rectangle, 14.4 W_DRAWVIEW) cannot erase it when the focus leaves: the random tests keep texts inside their buttons (see the report).
  const fitText = (t, w) => (t !== null && new Gfx6Model().textw(STR(t)) > w - 4 ? 'OK' : t);
  const mkRandWin = (i) => {
    const w = 16 * rng.int(4, 12), h = 8 * rng.int(6, 12), x = 16 * rng.int(0, (512 - w) / 16), y = 8 * rng.int(1, Math.floor((192 - h) / 8));
    const win = newWin(rng.chance(0.7) ? 'TWin' : 'Window', [x, y, w, h], rng.chance(0.85) ? `Win ${i}` : null);
    const nb = rng.int(1, 3);
    for (let k = 0; k < nb; k++) {
      const bw = 48, bh = 16, bx = x + 8 + k * 56, by = y + 14 + rng.int(0, 2) * 20;
      if (bx + bw > x + w - 2 || by + bh > y + h - 2) continue;
      newBtn(win, [bx, by, bw, bh], 10 * i + k + 1, fitText(rng.pick(['OK', 'Cancel', 'Go', 'Quit now', null]), bw), rng.pick([1, 1, 1, 0x11, 0]));
    }
    // the children of one group must not overlap (14.2 group_draw / section 4): Labels and TCtls only where no sibling is
    const free = (r) => win.kids.every((c) => r[0] + r[2] <= c.x || c.x + c.w <= r[0] || r[1] + r[3] <= c.y || c.y + c.h <= r[1]);
    const lr = [x + 8, y + h - 14, 64, 8], cr = [x + w - 60, y + h - 30, 40, 16];
    if (rng.chance(0.6) && w >= 96 && h >= 56 && free(lr)) newLbl(win, lr, 'Label', rng.chance(0.3) ? 8 : 0);
    if (rng.chance(0.5) && w >= 160 && h >= 56 && free(cr)) newCtl(win, cr, rng.byte(), 1, 90 + i);
    return win;
  };
  for (let i = 0; i < 5; i++) wins.push(mkRandWin(i + 1));
  for (let i = 0; i < 2; i++) {
    const w = 16 * rng.int(8, 12), h = 8 * rng.int(8, 10), x = 16 * rng.int(0, (512 - w) / 16), y = 8 * rng.int(1, Math.floor((192 - h) / 8));
    const d = newWin('Dialog', [x, y, w, h]);
    newLbl(d, [x + 8, y + 8, 80, 8], 'Sure?');
    const ok = newBtn(d, [x + 12, y + h - 24, 48, 14], 70 + i, 'OK', 0x11), no = newBtn(d, [x + 76, y + h - 24, 64, 14], 80 + i, 'Cancel', 1);
    if (rng.chance(0.5)) newCtl(d, [x + 12, y + 24, 40, 14], 0, 1, 99);
    setDefaults(d, rng.chance(0.85) ? ok : null, rng.chance(0.85) ? no : null);
    dlgs.push(d);
  }
  const all = () => [...wins, ...dlgs];
  const views = () => [...model.nodes.values()].filter((n) => n.kind === 'Button' || n.kind === 'TCtl' || n.kind === 'Label');
  const st = { gestures: 0, clicks: 0, drags: 0, moved: 0, cancels: 0, keys: 0, ops: 0, refused: 0, dialogs: 0, cmds: 0, raises: 0, modalClicks: 0, flashes: 0 };
  const hotPoint = () => {
    const r = rng.next();
    const open = model.list;
    if (r < 0.40 && open.length) { const w = rng.pick(open), v = rng.pick(model.subtree(w).filter((n) => n.kind !== 'TCtl' || true)); return [v.x + rng.int(0, Math.max(0, v.w - 1)), v.y + rng.int(0, Math.max(0, v.h - 1))]; }
    if (r < 0.60 && open.length) { const w = rng.pick(open); return [w.x + rng.int(0, w.w - 1), w.y + rng.int(0, 8)]; }       // a title bar
    if (r < 0.70) return [rng.int(0, 511), rng.int(0, 7)];                  // the bar
    if (r < 0.80 && model.modal) { const d = model.modal; return [d.x + rng.int(-6, d.w + 5), d.y + rng.int(-6, d.h + 5)]; }
    return [rng.int(0, 511), rng.int(0, 191)];
  };
  const clampPt = (x, y) => [Math.min(Math.max(x, 0), 511), Math.min(Math.max(y, 0), 191)];
  const KEYS_USED = ['TAB', 'TAB', 'BACKTAB', 'ENTER', 'SPACE', 'ESC', 'BREAK', 'a', 'RIGHT', 'LEFT', 'UP', 'DOWN', 'MENU'];
  const KEYSLEEP = 6;
  const startFrames = FR.frames;
  const closeModalLikeAnApp = (cmds0) => {
    // an application closes its dialog when one of its buttons says so
    if (model.modal && model.evlog.length > cmds0 && model.evlog.slice(cmds0).some((r) => r[2] === model.modal.slot) && rng.chance(0.8)) { dClose(s, model.modal); commit(s, 'the application closes its dialog', 3); }
  };
  for (let step = 0; step < STEPS && !s.bad; step++) {
    const r = rng.next();
    if (ptr.btn || model.drag) throw new Error('the test left the button down');
    if (model.modal && rng.chance(0.08)) { dClose(s, model.modal); commit(s, `close the dialog step ${step}`, 3); continue; }
    if (r < 0.55) {
      // a gesture: travel, press, (moves / a key), release
      st.gestures++;
      const kind = rng.pick(['wild', 'wild', 'click', 'click', 'drag', 'drag', 'drag']);
      const open = model.list;
      let tx, ty;
      if (kind === 'click' && views().length) { const v = rng.pick(views().filter((n) => n.kind === 'Button').concat(views())); [tx, ty] = [v.x + rng.int(0, Math.max(0, v.w - 1)), v.y + rng.int(0, Math.max(0, v.h - 1))]; }
      else if (kind === 'drag' && open.length) { const w = rng.pick(open); [tx, ty] = [w.x + rng.int(0, w.w - 1), w.y + rng.int(0, 8)]; }
      else [tx, ty] = hotPoint();
      [tx, ty] = clampPt(tx, ty);
      travel(s, tx, ty, rng.pick([127, 60, 25, 8]));
      const front0 = model.front(), drags0 = model.stats2.drags, cmds0 = model.evlog.length;
      const wasModal = !!model.modal;
      press(s);
      if (rng.chance(0.5)) settle(s, 2, 'gesture');
      const nm_ = kind === 'drag' ? rng.pick([1, 2, 3, 5]) : rng.pick([0, 0, 1, 2, 3, 5]);
      for (let k = 0; k < nm_; k++) {
        const big = kind === 'drag' ? 160 : 70;
        const [mx, my] = clampPt(ptr.x + rng.int(-big, big), ptr.y + rng.int(-big >> 1, big >> 1));
        travel(s, mx, my, rng.pick([127, 40, 10]));
        if (rng.chance(0.25)) settle(s, 1);
      }
      if (rng.chance(kind === 'drag' ? 0.3 : 0.15)) { const k = rng.pick(kind === 'drag' ? ['ESC', 'BREAK', 'TAB', 'ENTER', 'ESC'] : KEYS_USED); frame(s, { key: k }); st.keys++; settle(s, rng.pick([1, 2, 6])); }
      release(s);
      settle(s, KEYSLEEP, 'gesture end');
      stepNo++; checkAll(s, `gesture ${step} (${kind})`);
      if (model.drag) throw new Error('a drag survived the release');
      st.clicks += model.evlog.length - cmds0;
      st.drags += model.stats2.drags - drags0;
      if (wasModal) st.modalClicks++;
      if (model.front() !== front0) st.raises++;
      closeModalLikeAnApp(cmds0);
    } else if (r < 0.70) {
      st.keys++;
      const cmds0 = model.evlog.length;
      key(s, rng.pick(KEYS_USED)); commit(s, `key step ${step}`, KEYSLEEP);
      closeModalLikeAnApp(cmds0);
    } else if (r < 0.93) {
      // a direct operation at an idle point
      st.ops++;
      const o = rng.pick(['open', 'open', 'open', 'close', 'raise', 'raise', 'move', 'dialog', 'focus']);
      const pool = o === 'dialog' ? dlgs : all();
      const w = rng.pick(o === 'open' || o === 'dialog' || o === 'raise' ? pool : (model.list.length && rng.chance(0.85) ? model.list : pool));
      let carryM = 0;
      if (process.env.TRACEOPS) console.log(`   step ${step}: ${o} ${nm(w)} (${w.x},${w.y},${w.w},${w.h}) front ${nm(model.front())} focus ${nm(model.focus)} list ${model.list.map(nm)} ptr (${ptr.x},${ptr.y})`);
      if (o === 'open' || o === 'dialog') { carryM = dOpen(s, w); if (w.kind === 'Dialog' && !carryM) st.dialogs++; }
      else if (o === 'close') { if (model.modal && rng.chance(0.7)) carryM = dClose(s, model.modal); else carryM = dClose(s, w); }
      else if (o === 'raise') carryM = dRaise(s, w);
      else if (o === 'move') carryM = dMove(s, w, 16 * rng.int(0, (512 - w.w) / 16), 8 * rng.int(1, Math.floor((192 - w.h) / 8)));
      else { const v = rng.pick(views().filter((n) => n.kind !== 'Label')); dSetFocus(s, v); }
      if (carryM) st.refused++;
      commit(s, `${o} ${nm(w)} step ${step}`, 2);
    } else {
      // warp the pointer somewhere (no event) and idle
      const [x, y] = hotPoint(); place(s, ...clampPt(x, y)); commit(s, `warp step ${step}`);
    }
  }
  // the last full check, the settled screen; every window closed afterwards
  commit(s, 'final', 6);
  st.frames = FR.frames - startFrames;
  console.log(`  ${JSON.stringify(st)} ${JSON.stringify(model.stats2)}`);
  s.ok(STEPS < 300 || (st.frames >= 300 && st.gestures > 60 && st.keys > 40 && st.ops > 40), () => `coverage: ${JSON.stringify(st)}`);
  s.ok(STEPS < 300 || (model.stats2.cmds > 5 && st.drags > 3 && model.stats2.moved > 1 && st.raises > 5), () => `coverage: clicks ${st.clicks}, drags ${st.drags}, moved ${model.stats2.moved}, raises ${st.raises}`);
  reset(s);
  destroyAll(s, all());
  s.end();
}

SUP.end();
console.log(`${N} assertions; ${FR.frames} frames run (${FR.idle} idle), ${FR.quiet} idle points compared`);
C.done();
void img; void TW; void validRect; void titleCut; void setGA; void E; void K; void COLS; void ROWS;
