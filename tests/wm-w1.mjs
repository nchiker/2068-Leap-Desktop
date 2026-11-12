"use strict";
// wm-w1.mjs -- slice W1 of the window manager (docs/WINDOWS.md sections 1-11 and 14, test items 1-5 and 7), on the `kern4` cartridge.
// Written from the contract, never from the code.  The reference is tests/wm-model.mjs.
//   node tests/wm-w1.mjs [--seed N] [--steps N] [--only LIST] [--build] [--verbose]
//     --seed N     PRNG seed (printed; default from the clock)
//     --steps N    random sequence steps (default 3200; the contract asks for at least 3,000)
//     --only LIST  parts: 0 boot, 1 look, 2 hand-worked windows, 3 focus scope, 4 batches, 5 random sequence, 6 K_SETROOT / K_ARESET
//                  (default all; the parts share one machine, each starts by closing every window)
//     --literal-fscope  model 14.4's "Activation: nothing when f = old" to the letter (K_FSCOPE keeps the closed window after the last close);
//                  without it the model follows section 7 ("K_FSCOPE = f, 0 when there is no window"), reading M1 of tests/wm-model.mjs
//     --mutate N   plant fault N in the model (1..6) to show that the comparison catches it
//     --build      run tools/build.mjs kern4 first (default: use build/kern4.dck and build/kern4/ as they are)
//
// What is checked after every step of the random sequence: W_MAP byte for byte, W_SLOTS, the desk's list order (through the View_child /
// View_next pointers of the machine), W_DIRTY, W_MODAL, K_FSCOPE, K_FOCUS, K_CAPTURE, the carry of the routines that have one, every
// node's parent / child / next / x / y / slot / Window_focus, the log of the test methods (count, and the last 128 records byte for byte),
// GCLIP (the whole screen), the registers (IX, IY, the alternate set), no DI, SP, the stack depth, and that RAM outside the arenas, the
// kernel variables, the log records not written and W_SAVE (except in a step that paints, 14.4's batches keep rectangles there) is
// unchanged.  After every step that paints (W_UPDATE, W_DRAWVIEW, the stubs, K_DISPATCH of E_REDRAW): the display is poisoned with random
// bytes first, every byte outside the painted rectangles must come back as poisoned, and after the restore of the outside every clean
// cell must show the bytes of its owner's image (rendered by the machine itself: whole-screen clip, M_DRAW through T_SEND on a cleared
// display).
//
// Readings of the contract (see also the header of tests/wm-model.mjs, M1-M6):
//  T1. W_SAVE is exempt from the "unchanged" check in the steps that paint: 14.4's batches keep the rectangles there.  Every other step
//      must leave it as it was.
//  T2. The carry of W_UPDATE, W_INVAL, W_INVALV, W_DRAWVIEW, the T_*UPD stubs, K_DISPATCH is not checked (not specified).
//  T3. Registers: every W_* routine preserves IX, IY and the alternate set (5); W_FRONT also BC and DE (it clobbers AF, HL only).
//  T4. Stack: W_* and T_SEND of M_DRAW <= 192 bytes below the return address (section 9's W_UPDATE row), K_* routing routines <= 128,
//      M_DESTROY of a window <= 256 (window_destroy, W_CLOSE, activation, then the recursive view_destroy).
//  T5. A closed window's views are given the window's rectangle plus an offset by the test itself (never: the tests only move open windows).
import { checks } from './lib.mjs';
import { makeRng, call, hex, rd16, setGA, getGA } from './gfx6-lib.mjs';
import { KEEP, armStack, stackUsed } from './kern-lib.mjs';
import { startW, readDisp, writeDisp, coverage, diffDisp, DADDR } from './wm-lib.mjs';
import { WmModel, WHOLE, KEYS, NCELL, COLS, ROWS } from './wm-model.mjs';
import { Gfx6Model, fonts, fmtDiff, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 3200);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
const VERBOSE = argv.includes('--verbose');
const LITERAL = argv.includes('--literal-fscope');   // model 14.4's "nothing when f = old" literally: K_FSCOPE keeps the closed window after the last close (reading M1)
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} random steps`);

const C = checks('wm W1');
const ctx = startW(C);
if (!ctx) { console.log('the kern4 cartridge is not available (or lacks the W1 symbols): nothing else can run'); C.done(); process.exit(); }
const { m, S, img } = ctx;
const rng = makeRng(SEED);
const R = (a) => rd16(m, a);
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
let N = 0, stepNo = 0, stepWhat = '';

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 200 : 6)) this.fails.push(`[step ${stepNo}] ` + (typeof msg === 'function' ? msg() : msg)); } return c; }
  get bad() { return this.nf >= 3; }
  end() { C.check(`${this.name}: ${this.n} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}
const SUP = new Sec('set-up calls: registers, no DI, stack of K_NEW / K_ADDCHILD / K_ALLOC / K_SETROOT');

// ---------------------------------------------------------------------------------------------------------------------------
// Calls: interrupts on, random registers, the generic checks of section 5 / 14.4.
const nm = (n) => (n ? `${n.kind}@${n.a.toString(16)}${n.slot ? `#${n.slot}` : ''}` : '0');
function callW(sec, what, name, regs = {}, o = {}) {
  const pat = rng.chance(0.5) ? 0x55 : 0xAA;
  armStack(m, pat);
  const res = call(m, S, name, regs, { ints: o.ints ?? true, rng, guard: o.guard ?? 60_000_000 });
  const keep = KEEP(!!o.ixOut);
  const moved = keep.concat(o.keep || []).filter((r) => res.regs[r] !== res.regsIn[r]);
  sec.ok(moved.length === 0, () => `${what}: changed ${moved.map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`).join(', ')} (IX unless an output, IY and the alternate set are preserved)`);
  if (o.ints ?? true) sec.ok(res.maxDiRun === 0 && res.iff1 === true, () => `${what}: interrupts were off for ${res.maxDiRun} T-states / iff1 ${res.iff1} (no DI or EI allowed)`);
  sec.ok(res.sp === 0xFF00, () => `${what}: SP ${hex(res.sp)} after the return, want $FF00`);
  const used = stackUsed(m, pat), lim = o.lim ?? 192;
  sec.ok(used <= lim, () => `${what}: ${used} bytes of stack, bound ${lim}`);
  res.stack = used;
  return res;
}
const carry = (res) => res.regs.f & 1;

// ---------------------------------------------------------------------------------------------------------------------------
// The model and the machine's views.
let model = null, ver = 0;
const mkModel = () => new WmModel(R(S.W_SLOTS), R(S.W_SLOTS + 30));

const setRect = (a, x, y, w, h) => { poke16(a + S.View_x, x); poke8(a + S.View_y, y); poke16(a + S.View_w, w); poke8(a + S.View_h, h); };
function kNew(kind) {
  const r = callW(SUP, `K_NEW ${kind}`, 'K_NEW', { hl: S[`CL_${kind}`] }, { ixOut: true, lim: 32 });
  if (carry(r)) throw new Error(`K_NEW ${kind}: the arena is full (the tests keep fewer than 40 windows)`);
  return r.regs.ix;
}
const TITLE = (addr) => ({ addr, codes: Array.from(img.subarray(addr + 1, addr + 1 + img[addr])) });
const TITLES = [null, null, TITLE(S.T_TITLE1), TITLE(S.T_TITLE2), TITLE(S.T_TITLEL)];
function newTitle(codes) {
  const r = callW(SUP, 'K_ALLOC', 'K_ALLOC', { bc: codes.length + 1 }, { lim: 32 });
  const a = r.regs.hl; poke8(a, codes.length); codes.forEach((c, i) => poke8(a + 1 + i, c));
  return { addr: a, codes: codes.slice() };
}
for (let i = 0; i < 12; i++) TITLES.push(newTitle(Array.from({ length: rng.int(1, 28) }, () => rng.int(33, 126))));

/** A window (kind TWin, or the plain Window the look and perf tests use) with a random subtree in its content area. */
function newWindow(kind, rect, o = {}) {
  const [x, y, w, h] = rect, a = kNew(kind), tag = o.tag ?? rng.byte(), flags = o.flags ?? 0, id = rng.byte();
  setRect(a, x, y, w, h); poke8(a + S.View_flags, flags); poke8(a + S.View_id, id);
  if (kind === 'TWin') poke8(a + S.TWin_tag, tag);
  const title = o.title === undefined ? rng.pick(TITLES) : o.title;
  poke16(a + S.Window_title, title ? title.addr : 0);
  const n = model.addNode({ a, kind, x, y, w, h, flags, id, tag: kind === 'TWin' ? tag : 0, title });
  if (o.kids ?? true) addKids(n, x + 1, y + 9, w - 2, h - 10, 0);
  return n;
}
function addKid(parent, kind, x, y, w, h, flags, tag, id) {
  const a = kNew(kind);
  setRect(a, x, y, w, h); poke8(a + S.View_flags, flags); poke8(a + S.View_id, id);
  if (kind === 'TCtl') poke8(a + S.TCtl_tag, tag); else if (kind === 'TGrp') poke8(a + S.TGrp_tag, tag);
  const n = model.addNode({ a, kind, x, y, w, h, flags, id, tag });
  callW(SUP, 'K_ADDCHILD', 'K_ADDCHILD', { ix: parent.a, de: a }, { lim: 32 });
  model.attach(parent, n);
  return n;
}
/** Up to 4 children in disjoint strips of (rx, ry, rw, rh), all inside it; a TGrp gets children of its own (depth <= 3 below the window). */
function addKids(parent, rx, ry, rw, rh, depth) {
  if (rw < 12 || rh < 12) return;
  const n = rng.pick(depth === 0 ? [0, 1, 2, 2, 3, 4] : [0, 1, 1, 2, 2, 3]);
  if (!n) return;
  const horiz = rw >= rh, len = horiz ? rw : rh, strip = Math.floor(len / n);
  if (strip < 8) return;
  for (let i = 0; i < n; i++) {
    const s0 = (horiz ? rx : ry) + i * strip, along = rng.int(0, Math.floor(strip / 4)), alen = rng.int(Math.max(4, Math.floor(strip / 2)), strip - along - 1);
    const oth = horiz ? rh : rw, across = rng.int(0, Math.floor(oth / 4)), olen = rng.int(Math.max(4, Math.floor(oth / 2)), oth - across);
    let x = horiz ? s0 + along : rx + across, y = horiz ? ry + across : s0 + along, w = horiz ? alen : olen, h = horiz ? olen : alen;
    if (rng.chance(0.04)) { if (rng.chance(0.5)) w = 0; else h = 0; }
    const kind = depth < 3 && w >= 12 && h >= 12 && rng.chance(0.3) ? 'TGrp' : 'TCtl';
    let f = 0;
    if (kind === 'TCtl' ? rng.chance(0.65) : rng.chance(0.1)) f |= 1;
    if (rng.chance(0.07)) f |= 2;
    if (rng.chance(0.07)) f |= 4;
    const tag = kind === 'TCtl' ? (rng.byte() & 0xFE) | (rng.chance(0.2) ? 1 : 0) : rng.byte();
    const k = addKid(parent, kind, x, y, w, h, f, tag, rng.byte());
    if (kind === 'TGrp') addKids(k, x, y, w, h, depth + 1);
  }
}
const randRect = () => {
  const w = 16 * rng.int(3, rng.chance(0.15) ? 32 : 14), h = 8 * rng.int(2, rng.chance(0.15) ? 23 : 12);
  return [16 * rng.int(0, (512 - w) / 16), 8 * rng.int(1, Math.floor((192 - h) / 8)), w, h];
};
const BAD = [(r) => [r[0] + 8, r[1], r[2], r[3]], (r) => [r[0], r[1] + 4, r[2], r[3]], (r) => [r[0], r[1], 40, r[3]], (r) => [r[0], r[1], 32, r[3]], (r) => [r[0], r[1], r[2], 8],
  (r) => [r[0], r[1], r[2], 12], (r) => [496, r[1], 48, r[3]], (r) => [r[0], 184, r[2], 16], (r) => [r[0], 0, r[2], r[3]], (r) => [16, r[1], 512, r[3]],
  (r) => [r[0], 8, r[2], 192], (r) => [r[0], 200, r[2], r[3]], (r) => [r[0], r[1], 16, r[3]], (r) => [r[0], r[1], r[2], 0], (r) => [0, r[1], 0, r[3]]];

// ---------------------------------------------------------------------------------------------------------------------------
// Step bookkeeping: the log is reset, RAM is snapshotted; endStep compares everything.
const SECS = {};
const sec = (name) => (SECS[name] ??= new Sec(name));
const PROT = [[0x5800, 0x5FFF], [0xF0D0, 0xF0FF], [0xF480, 0xF4FF]];          // poisoned at the start, unchanged by every step
let before = null;
function beginStep(what) {
  stepNo++; stepWhat = what;
  model.log = []; poke16(S.T_LOGN, 0);
  before = m.ram.slice();
}
function checkProtected(s, what, saveOk) {
  const regions = [...PROT, [S.T_LOGN + 2, 0xE0FF], [0xE080, S.T_LOGN - 1]];
  if (!saveOk) regions.push([0xE800, 0xEFFF]);
  for (const [lo, hi] of regions) {
    if (Buffer.compare(Buffer.from(m.ram.buffer, m.ram.byteOffset + lo, hi - lo + 1), Buffer.from(before.buffer, before.byteOffset + lo, hi - lo + 1)) === 0) { s.ok(true); continue; }
    let a = lo; while (m.ram[a] === before[a]) a++;
    s.ok(false, () => `${what}: RAM outside the arenas changed at ${hex(a)} (was $${before[a].toString(16)}, now $${m.ram[a].toString(16)}) in the protected range ${hex(lo)}-${hex(hi)}`);
  }
  const n = R(S.T_LOGN), used = Math.min(n, 128);
  const lo = S.T_LOG + 16 * used, hi = S.T_LOG + 2047;
  if (lo <= hi) {
    let a = lo; while (a <= hi && m.ram[a] === before[a]) a++;
    s.ok(a > hi, () => `${what}: the log record slot at ${hex(a)} was written, but only ${n} record(s) were logged`);
  }
}
function cmpLog(s, what) {
  const exp = model.log, n = R(S.T_LOGN);
  s.ok(n === exp.length, () => `${what}: T_LOGN ${n}, model ${exp.length} records${VERBOSE ? ` [${exp.map((r) => `${r.code}@${r.ix.toString(16)}`).join(' ')}]` : ''}`);
  const k0 = Math.max(0, Math.min(n, exp.length) - 128);
  for (let k = k0; k < Math.min(n, exp.length) && k < k0 + 128; k++) {
    const e = exp[k], a = S.T_LOG + 16 * (k % 128);
    const want = [e.code, e.tag, e.ix & 255, e.ix >> 8];
    for (const c of e.clip) want.push(c & 255, c >> 8);
    want.push(0, 0, 0, 0);
    const got = Array.from(m.ram.subarray(a, a + 16));
    s.ok(want.every((b, i) => b === got[i]), () => {
      const dec = (b) => `code ${b[0]} tag ${b[1]} IX $${(b[2] | (b[3] << 8)).toString(16)} clip [${[4, 6, 8, 10].map((i) => b[i] | (b[i + 1] << 8))}] pad [${b.slice(12)}]`;
      return `${what}: log record ${k}: machine ${dec(got)}, model ${dec(want)}`;
    });
  }
}
/** The whole of section 14's state against the model. */
function cmpState(s, what) {
  const want = model.mapBytes(), got = Buffer.from(m.ram.buffer, m.ram.byteOffset + S.W_MAP, NCELL);
  if (!s.ok(Buffer.compare(got, Buffer.from(want)) === 0, () => {
    let i = 0; while (got[i] === want[i]) i++;
    return `${what}: W_MAP differs at cell (${i % 32}, ${i >> 5}): machine $${got[i].toString(16)}, model $${want[i].toString(16)} (owner | dirty << 7)`;
  })) { /* keep going: the other checks still say something */ }
  for (let o = 0; o < 16; o++) s.ok(R(S.W_SLOTS + 2 * o) === (model.slots[o] ? model.slots[o].a : 0), () => `${what}: W_SLOTS[${o}] ${hex(R(S.W_SLOTS + 2 * o))}, model ${nm(model.slots[o])}`);
  const order = []; for (let v = R(model.desk.a + S.View_child), g = 0; v && g < 40; v = R(v + S.View_next), g++) order.push(v);
  s.ok(order.join() === model.desk.kids.map((k) => k.a).join(), () => `${what}: the desk's list ${order.map((a) => a.toString(16))}, model ${model.desk.kids.map(nm)}`);
  s.ok(m.ram[S.W_DIRTY] === model.wDirty, () => `${what}: W_DIRTY ${m.ram[S.W_DIRTY]}, model ${model.wDirty}`);
  s.ok(R(S.W_MODAL) === model.modal, () => `${what}: W_MODAL ${R(S.W_MODAL)}, model ${model.modal}`);
  s.ok(R(S.K_FSCOPE) === (model.fscope ? model.fscope.a : 0), () => `${what}: K_FSCOPE ${hex(R(S.K_FSCOPE))}, model ${nm(model.fscope)}`);
  s.ok(R(S.K_FOCUS) === (model.focus ? model.focus.a : 0), () => `${what}: K_FOCUS ${hex(R(S.K_FOCUS))}, model ${nm(model.focus)}`);
  s.ok(R(S.K_CAPTURE) === (model.capture ? model.capture.a : 0), () => `${what}: K_CAPTURE ${hex(R(S.K_CAPTURE))}, model ${nm(model.capture)}`);
  s.ok(R(S.K_ROOT) === model.desk.a, () => `${what}: K_ROOT ${hex(R(S.K_ROOT))}, the desk ${hex(model.desk.a)}`);
  const clip = [0, 1, 2, 3].map((i) => R(S.GCLIP + 2 * i));
  s.ok(clip.join() === WHOLE.join(), () => `${what}: GCLIP ${clip}, the whole screen after every routine`);
  for (const n of model.nodes.values()) {
    const a = n.a, par = n.parent ? n.parent.a : 0, ch = n.kids.length ? n.kids[0].a : 0;
    const sib = n.parent ? (n.parent.kids[n.parent.kids.indexOf(n) + 1]?.a ?? 0) : 0;
    const got2 = [R(a + S.View_parent), R(a + S.View_child), R(a + S.View_next), R(a + S.View_x), m.ram[a + S.View_y]];
    const exp2 = [par, ch, sib, n.x, n.y];
    const isWin = n.kind === 'TWin' || n.kind === 'Window';
    if (isWin) { got2.push(m.ram[a + S.Window_slot], R(a + S.Window_focus)); exp2.push(n.slot, n.focus ? n.focus.a : 0); }
    s.ok(got2.join() === exp2.join(), () => `${what}: ${nm(n)} fields [parent child next x y${isWin ? ' slot focus' : ''}] machine [${got2.map((v) => v.toString(16))}], model [${exp2.map((v) => v.toString(16))}]`);
  }
}
function endStep(s, what, o = {}) { checkProtected(s, what, !!o.saveOk); cmpState(s, what); cmpLog(s, what); }

// ---------------------------------------------------------------------------------------------------------------------------
// Images (section 6 "What the screen must show"): each owner's M_DRAW alone on a cleared display, whole-screen clip, through T_SEND.
let imgCache = { ver: -1, imgs: null };
function renderImages() {
  if (imgCache.ver === ver) return imgCache.imgs;
  const saveDisp = readDisp(m), saveLog = m.ram.slice(S.T_LOG, S.T_LOG + 2048), saveN = R(S.T_LOGN), saveGfx = m.ram.slice(S.GA, S.GA + 0x20);
  const imgs = new Map();
  for (let o = 0; o < 16; o++) {
    const v = model.slots[o];
    if (!v) continue;
    m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
    [0, 512, 0, 192].forEach((c, i) => poke16(S.GCLIP + 2 * i, c));
    call(m, S, 'T_SEND', { ix: v.a, a: S.M_DRAW }, { ints: false, rng });
    imgs.set(o, readDisp(m));
  }
  writeDisp(m, saveDisp); m.ram.set(saveLog, S.T_LOG); poke16(S.T_LOGN, saveN); m.ram.set(saveGfx, S.GA);
  imgCache = { ver, imgs };
  return imgs;
}
function composition(s, what) {
  const imgs = renderImages(), scr = readDisp(m);
  let bad = 0, first = null;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    if (model.dirty[i]) continue;
    const im = imgs.get(model.map[i]);
    let same = true;
    for (let y = 8 * r; same && y < 8 * r + 8; y++) for (let k = 0; k < 2; k++) if (scr[y * 64 + 2 * c + k] !== im[y * 64 + 2 * c + k]) { same = false; break; }
    if (!same) { bad++; if (!first) first = { c, r, o: model.map[i] }; }
  }
  s.ok(bad === 0, () => `${what}: ${bad} clean cell(s) do not show the image of their owner, first (${first.c}, ${first.r}) owner ${first.o}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Steps.
/** A routine with a carry: the machine call, the model, the comparison.  Returns the model's carry. */
function opCarry(s, name, n, regs, fn, what = `${name} ${nm(n)}`) {
  beginStep(what);
  const res = callW(s, what, name, regs);
  const exp = fn();
  s.ok(carry(res) === exp, () => `${what}: carry ${carry(res)}, model ${exp}`);
  ver++;
  endStep(s, what);
  return exp;
}
const doOpen = (s, w) => opCarry(s, 'W_OPEN', w, { ix: w.a }, () => model.open(w));
const doClose = (s, w) => opCarry(s, 'W_CLOSE', w, { ix: w.a }, () => model.close(w));
const doRaise = (s, w) => opCarry(s, 'W_RAISE', w, { ix: w.a }, () => model.raise(w));
const doMove = (s, w, x, y) => opCarry(s, 'W_MOVE', w, { ix: w.a, hl: x & 0xFFFF, de: y & 0xFFFF }, () => model.move(w, x, y), `W_MOVE ${nm(w)} (${w.x},${w.y}) -> (${x},${y})`);

/** The poison, the call(s), the check outside the painted rectangles, the restore, the full check, the composition. */
function paintStep(s, what, pre, painter, run) {
  if (pre) pre();
  const orig = readDisp(m), painted = painter(), rects = painted.map((p) => p.clip);
  const rnd = new Uint8Array(192 * 64); for (let i = 0; i < rnd.length; i++) rnd[i] = rng.byte();
  writeDisp(m, rnd);
  run();
  const after = readDisp(m), cov = coverage(rects), ncov = Uint8Array.from(cov, (v) => (~v) & 0xFF);
  const d = diffDisp(after, rnd, ncov);
  s.ok(d === null, () => `${what}: display pixels outside the painted rectangle(s) [${rects.slice(0, 4).map((r) => `[${r}]`).join(' ')}${rects.length > 4 ? ` .. ${rects.length}` : ''}] changed: ${d}`);
  writeDisp(m, Uint8Array.from(after, (v, i) => (v & cov[i]) | (orig[i] & ncov[i])));
  endStep(s, what, { saveOk: true });
  ver += 0;
  composition(s, what);
  return painted;
}
function doUpdate(s, what = 'W_UPDATE') {
  beginStep(what);
  return paintStep(s, what, null, () => model.update(), () => callW(s, what, 'W_UPDATE', {}));
}
function doDrawView(s, v) {
  const what = `W_DRAWVIEW ${nm(v)}`;
  beginStep(what);
  return paintStep(s, what, null, () => model.drawview(v), () => callW(s, what, 'W_DRAWVIEW', { ix: v.a }));
}
/** The stubs of 14.5: T_RAISEUPD / T_OPENUPD / T_CLOSEUPD (IX = w) and T_MOVEUPD (IX, HL, DE): the operation, then W_UPDATE. */
function doStub(s, kind, w, x, y) {
  const what = `${kind} ${nm(w)}`;
  beginStep(what);
  const pre = () => { ver++; if (kind === 'T_RAISEUPD') model.raise(w); else if (kind === 'T_OPENUPD') model.open(w); else if (kind === 'T_CLOSEUPD') model.close(w); else model.move(w, x, y); };
  paintStep(s, what, pre, () => model.update(), () => callW(s, what, kind, kind === 'T_MOVEUPD' ? { ix: w.a, hl: x & 0xFFFF, de: y & 0xFFFF } : { ix: w.a }));
}
function doInval(s, x, y, w, h, quiet = false) {
  const what = `W_INVAL (${x},${y},${w},${h})`;
  if (!quiet) beginStep(what);
  const ga = [x, y, w, h].map((v) => v & 0xFFFF);
  setGA(m, S, x, y, w, h);
  const gaBefore = Array.from(m.ram.subarray(S.GA, S.GA + 8));
  callW(s, what, 'W_INVAL', {});
  s.ok(Array.from(m.ram.subarray(S.GA, S.GA + 8)).join() === gaBefore.join(), () => `${what}: GA was changed (${ga})`);
  model.inval(x, y, w, h);
  if (!quiet) endStep(s, what);
}
function doInvalV(s, v) {
  const what = `W_INVALV ${nm(v)}`;
  beginStep(what);
  callW(s, what, 'W_INVALV', { ix: v.a });
  model.invalv(v);
  endStep(s, what);
}
function doFront(s) {
  beginStep('W_FRONT');
  const res = callW(s, 'W_FRONT', 'W_FRONT', {}, { keep: ['b', 'c', 'd', 'e'] });
  s.ok(res.regs.hl === (model.front() ? model.front().a : 0), () => `W_FRONT: HL ${hex(res.regs.hl)}, model ${nm(model.front())}`);
  endStep(s, 'W_FRONT');
}
function doSetFocus(s, v) {
  const what = `K_SETFOCUS ${nm(v)} (focus ${nm(model.focus)})`;
  beginStep(what);
  const res = callW(s, what, 'K_SETFOCUS', { de: v ? v.a : 0 }, { lim: 128 });
  const exp = model.setFocus(v);
  s.ok(carry(res) === exp, () => `${what}: carry ${carry(res)}, model ${exp}`);
  endStep(s, what);
}
function doFocusMove(s, next) {
  const name = next ? 'K_FOCUSNEXT' : 'K_FOCUSPREV', what = `${name} (focus ${nm(model.focus)}, scope ${nm(model.fscope)})`;
  beginStep(what);
  callW(s, what, name, {}, { lim: 128 });
  if (next) model.focusNext(); else model.focusPrev();
  endStep(s, what);
}
const queuesEmpty = () => m.ram[S.K_PN] === 0 && m.ram[S.K_RHEAD] === m.ram[S.K_RTAIL];
/** K_GETEV with both queues empty (E_REDRAW when dirty), or a posted event, and K_DISPATCH. */
function doEvent(s, kind, key) {
  if (!queuesEmpty()) return;
  const what = kind === 'empty' ? 'K_GETEV (queues empty)' : kind === 'redraw' ? 'K_POST E_REDRAW, K_GETEV, K_DISPATCH' : `K_POST E_KEY ${key}, K_GETEV, K_DISPATCH`;
  beginStep(what);
  const evAt = () => Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4));
  let a, ev;
  if (kind === 'empty') {
    poke8(S.K_EV, 0xEE); poke8(S.K_EV + 1, 0xEE);
    const res = callW(s, what, 'K_GETEV', {}, { lim: 128 }), exp = model.getevEmpty();
    s.ok(carry(res) === exp.carry, () => `${what}: carry ${carry(res)}, model ${exp.carry} (W_DIRTY ${model.wDirty})`);
    if (!exp.carry) {
      s.ok(res.regs.a === 6 && evAt().join() === '6,0,0,0', () => `${what}: A ${res.regs.a}, K_EV [${evAt()}], want E_REDRAW 6,0,0,0`);
      if (rng.chance(0.7)) { paintDispatch(s, what); return; }
    } else s.ok(evAt()[0] === 0xEE && evAt()[1] === 0xEE, () => `${what}: K_EV was written although nothing was returned`);
    endStep(s, what);
    return;
  }
  const typ = kind === 'redraw' ? 6 : 1, d1 = kind === 'redraw' ? 0 : key;
  const post = callW(s, `${what} (K_POST)`, 'K_POST', { a: typ, c: d1, e: 0, d: 0 }, { lim: 128 });
  s.ok(carry(post) === 0, 'K_POST refused an event with the queue empty');
  const res = callW(s, `${what} (K_GETEV)`, 'K_GETEV', {}, { lim: 128 });
  a = res.regs.a; ev = evAt();
  s.ok(carry(res) === 0 && a === typ && ev.join() === `${typ},${d1},0,0`, () => `${what}: K_GETEV carry ${carry(res)} A ${a} K_EV [${ev}]`);
  if (kind === 'redraw') { paintDispatch(s, what); return; }
  callW(s, `${what} (K_DISPATCH)`, 'K_DISPATCH', {}, { lim: 128 });
  model.dispatchKey(key);
  endStep(s, what);
}
function paintDispatch(s, what) {
  paintStep(s, `${what} -> K_DISPATCH of E_REDRAW (W_UPDATE)`, null, () => model.update(), () => callW(s, `${what} (K_DISPATCH)`, 'K_DISPATCH', {}, { lim: 192 }));
}
function doDestroy(s, w) {
  const what = `M_DESTROY ${nm(w)}`;
  beginStep(what);
  callW(s, what, 'T_SEND', { ix: w.a, a: S.M_DESTROY }, { lim: 256 });
  model.destroyWindow(w); ver++;
  endStep(s, what);
}
function doSetCapture(s, v) { beginStep(`poke K_CAPTURE ${nm(v)}`); poke16(S.K_CAPTURE, v ? v.a : 0); model.capture = v; endStep(s, `poke K_CAPTURE ${nm(v)}`); }
const allViews = () => [...model.nodes.values()];
const childViews = () => allViews().filter((n) => n.parent && n.parent !== model.desk && n.kind !== 'Desk' && n.kind !== 'MenuBar');

/** Close every window and settle the screen: the start of each directed part. */
function reset(s) {
  for (const w of [...model.list]) doClose(s, w);
  doUpdate(s, 'W_UPDATE (reset)');
}

// ===========================================================================================================================
// Poison, the model, boot checks.
for (const [lo, hi] of PROT) if (lo !== 0xF480) for (let a = lo; a <= hi; a++) m.ram[a] = rng.byte();   // $F480-$F4FF: W2 / W3 state since they exist (docs/WINDOWS.md 17, 18); kept as booted (0), still checked unchanged
for (let a = S.T_LOG; a < S.T_LOG + 2048; a++) m.ram[a] = rng.byte();
model = mkModel();
model.literalFscope = LITERAL;
model.fault = argVal('--mutate', 0);     // plant fault N in the model (1 no title damage, 2 rows never merge, 3 batch limit 367, 4 group_draw skips no child, 5 move damages nothing, 6 drawview clip not cut to the view)

if (ONLY.includes(0)) {
  const s = sec('boot: W_INIT\'s state, symbols and the class layout (14.1, 14.2, 14.4)');
  s.ok(S.W_MAP === 0xF100 && S.W_SLOTS === 0xF400 && S.W_MODAL === 0xF420 && S.W_DIRTY === 0xF0C0 && S.K_FSCOPE === 0xF0C2 && S.T_LOG === 0x7800 && S.T_LOGN === 0xE090,
    () => `addresses: W_MAP ${hex(S.W_MAP)} W_SLOTS ${hex(S.W_SLOTS)} W_MODAL ${hex(S.W_MODAL)} W_DIRTY ${hex(S.W_DIRTY)} K_FSCOPE ${hex(S.K_FSCOPE)} T_LOG ${hex(S.T_LOG)} T_LOGN ${hex(S.T_LOGN)}`);
  s.ok(S.Window_slot === 16 && S.Window_title === 17 && S.Window_focus === 19 && S.TWin_tag === 21 && S.TWin_SIZE === 22 && S.TCtl_tag === 16 && S.TCtl_SIZE === 17 && S.TGrp_tag === 16 && S.TGrp_SIZE === 17,
    () => `field offsets: Window_slot ${S.Window_slot} _title ${S.Window_title} _focus ${S.Window_focus} TWin_tag ${S.TWin_tag} TWin_SIZE ${S.TWin_SIZE} TCtl_tag ${S.TCtl_tag} TGrp_tag ${S.TGrp_tag}`);
  const d = model.desk, b = model.bar;
  s.ok(R(d.a) === S.CL_Desk && R(b.a) === S.CL_MenuBar, () => `class pointers: desk ${hex(R(d.a))} (want CL_Desk ${hex(S.CL_Desk)}), bar ${hex(R(b.a))} (CL_MenuBar ${hex(S.CL_MenuBar)})`);
  s.ok(d.a >= 0xF500 && d.a < 0xFB00 && b.a >= 0xF500 && b.a < 0xFB00, 'the desk and the bar live in the kernel arena [$F500, $FB00)');
  const rect = (a) => [R(a + S.View_x), m.ram[a + S.View_y], R(a + S.View_w), m.ram[a + S.View_h], m.ram[a + S.View_flags], m.ram[a + S.View_id]];
  s.ok(rect(d.a).join() === '0,0,512,192,0,0' && rect(b.a).join() === '0,0,512,8,0,0', () => `desk ${rect(d.a)}, bar ${rect(b.a)}`);
  s.ok(R(b.a + 16) === 0, () => `MenuBar_table (offset 16) is ${R(b.a + 16)}, want 0`);
  s.ok(R(S.K_ROOT) === d.a && R(d.a + S.View_child) === b.a && R(b.a + S.View_next) === 0 && R(b.a + S.View_parent) === d.a && R(d.a + S.View_next) === 0, 'K_SETROOT desk; the desk\'s only child is the bar');
  const map = Array.from(m.ram.subarray(S.W_MAP, S.W_MAP + 768));
  s.ok(map.slice(0, 32).every((v) => v === 0x8F) && map.slice(32).every((v) => v === 0x80), 'W_MAP after W_INIT: row 0 = $8F, rows 1-23 = $80');
  s.ok(m.ram[S.W_DIRTY] === 1 && R(S.W_MODAL) === 0 && R(S.K_FSCOPE) === 0, () => `W_DIRTY ${m.ram[S.W_DIRTY]}, W_MODAL ${R(S.W_MODAL)}, K_FSCOPE ${R(S.K_FSCOPE)}`);
  s.ok(R(S.W_SLOTS) === d.a && R(S.W_SLOTS + 30) === b.a && Array.from({ length: 14 }, (_, i) => R(S.W_SLOTS + 2 + 2 * i)).every((v) => v === 0), 'W_SLOTS after W_INIT: [0] desk, [15] bar, the rest 0');
  s.ok(R(S.K_CAPTURE) === 0 && R(S.K_FOCUS) === 0, 'K_FOCUS and K_CAPTURE are 0 at boot');
  beginStep('boot state');
  endStep(s, 'boot state', { saveOk: true });
  // the first update paints the bar and the desk; the display is poisoned beforehand
  beginStep('first update');
  paintStep(s, 'first W_UPDATE', null, () => model.update(), () => callW(s, 'first W_UPDATE', 'W_UPDATE', {}));
  s.ok(model.log.length === 0 && R(S.T_LOGN) === 0, 'the bar and the desk are not test classes: no log record');
  // the whole screen against the gfx6 model: ink bar, paper desk
  const g = new Gfx6Model(); g.setOp(OP_SET); g.fill(0, 0, 512, 8);
  s.ok(g.compareRam(m.ram) === null, () => `settled boot screen: ${fmtDiff(g.compareRam(m.ram))}`);
  s.end();
}

// ===========================================================================================================================
// 1. The look (14.3): desk_draw, mbar_draw, window_draw active and inactive, title truncation.
if (ONLY.includes(1)) {
  const s = sec('look (14.3): desk, bar, window (active, inactive, titles cut by PROP6_W) and TCtl against the gfx6 model');
  const PW = fonts().prop6.W;
  const cut = (codes, w) => { let sum = 0, k = 0; for (let i = 0; i < codes.length; i++) { sum += PW[codes[i]]; if (sum <= w - 16) k = i + 1; } return k; };
  const seedAndDraw = (what, node, expect) => {
    const saved = readDisp(m);
    const bytes = new Uint8Array(192 * 64); for (let i = 0; i < bytes.length; i++) bytes[i] = rng.byte();
    writeDisp(m, bytes);
    [0, 512, 0, 192].forEach((c, i) => poke16(S.GCLIP + 2 * i, c));
    poke8(S.GLH, 11); poke8(S.GOP, rng.int(0, 2)); poke16(S.T_LOGN, 0);
    const g = Gfx6Model.fromRam(m.ram);
    callW(s, what, 'T_SEND', { ix: node.a, a: S.M_DRAW }, { lim: 192 });
    expect(g);
    const d = g.compareRam(m.ram);
    s.ok(d === null, () => {
      let hint = '';
      if (node.title && node.w) {                           // which title length does the machine's picture match?
        const fake = new Uint8Array(65536); for (let i = 0; i < bytes.length; i++) fake[DADDR[i]] = bytes[i];
        const fits = [];
        for (let k = 0; k <= node.title.codes.length; k++) {
          const g2 = Gfx6Model.fromRam(fake), { x, y, w, h } = node, act = model.front() === node;
          g2.setOp(OP_SET); g2.frame(x, y, w, h); g2.setOp(act ? OP_SET : OP_CLR); g2.fill(x + 1, y + 1, w - 2, 7); g2.setOp(OP_SET); g2.hline(x + 1, y + 8, w - 2);
          g2.setOp(act ? OP_XOR : OP_SET); g2.textp(x + 8, y, node.title.codes.slice(0, k)); g2.setOp(OP_CLR); g2.fill(x + 1, y + 9, w - 2, h - 10);
          if (g2.compareRam(m.ram) === null) fits.push(k);
        }
        hint = ` (the machine's picture equals a title of ${fits.length ? fits.join('/') : 'no'} code(s); widths ${node.title.codes.map((c) => PW[c]).join('+')}, w - 16 = ${node.w - 16})`;
      }
      if (VERBOSE && node.w && !node.__dumped) {
        node.__dumped = true;
        const got = Gfx6Model.fromRam(m.ram), rows = [];
        for (let yy = node.y; yy < node.y + Math.min(node.h, 16); yy++) {
          let a = '', b = '';
          for (let xx = node.x; xx < Math.min(node.x + node.w, node.x + 64); xx++) { a += got.get(xx, yy) ? '#' : '.'; b += g.get(xx, yy) ? '#' : '.'; }
          rows.push(`${a}  ${b}`);
        }
        hint += `\n   machine | model (x ${node.x}, y ${node.y}):\n   ${rows.join('\n   ')}`;
      }
      return `${what}: ${fmtDiff(d)}${hint}`;
    });
    s.ok(m.ram[S.GLH] === 11, () => `${what}: GLH was changed to ${m.ram[S.GLH]} (a draw method leaves GLH unchanged)`);
    s.ok([0, 1, 2, 3].map((i) => R(S.GCLIP + 2 * i)).join() === WHOLE.join(), () => `${what}: GCLIP was changed`);
    writeDisp(m, saved);                                    // the display stays what the settled screen was
  };
  const winLook = (n, active) => (g) => {
    const { x, y, w, h } = n;
    g.setOp(OP_SET); g.frame(x, y, w, h);
    g.setOp(active ? OP_SET : OP_CLR); g.fill(x + 1, y + 1, w - 2, 7);
    g.setOp(OP_SET); g.hline(x + 1, y + 8, w - 2);
    if (n.title) { g.setOp(active ? OP_XOR : OP_SET); g.textp(x + 8, y, n.title.codes.slice(0, cut(n.title.codes, w))); }
    g.setOp(OP_CLR); g.fill(x + 1, y + 9, w - 2, h - 10);
  };
  seedAndDraw('desk_draw (M_DRAW to the desk, whole clip, random display)', model.desk, (g) => { g.setOp(OP_CLR); g.fill(0, 8, 512, 184); });
  seedAndDraw('mbar_draw (M_DRAW to the bar)', model.bar, (g) => { g.setOp(OP_SET); g.fill(0, 0, 512, 8); });
  // exact-fit and one-too-wide titles for a few widths
  const titleOfWidth = (total) => {
    for (let tries = 0; tries < 2000; tries++) {
      const codes = []; let sum = 0;
      while (sum < total) {
        const rem = total - sum, ok = []; for (let c = 33; c <= 126; c++) if (PW[c] <= rem && PW[c] > 0) ok.push(c);
        if (!ok.length) break;
        const c = rng.pick(ok); codes.push(c); sum += PW[c];
      }
      if (sum === total && codes.length) return codes;
    }
    return null;
  };
  const variants = [];
  for (const w of [48, 64, 96, 128, 256, 512]) {
    for (const extra of [0, 1]) { const t = titleOfWidth(w - 16 + extra); if (t) variants.push({ w, h: 16 + 8 * rng.int(0, 6), title: newTitle(t), what: extra ? 'one pixel too wide' : 'exact fit' }); }
  }
  for (const w of [48, 64, 256, 512]) variants.push({ w, h: 24, title: TITLES[4], what: 'T_TITLEL (60 codes)' });
  variants.push({ w: 128, h: 48, title: TITLES[2], what: 'T_TITLE1' }, { w: 48, h: 16, title: TITLES[3], what: 'T_TITLE2 in the smallest window' }, { w: 160, h: 56, title: null, what: 'no title' });
  for (let i = 0; i < 6; i++) variants.push({ w: 16 * rng.int(3, 20), h: 8 * rng.int(2, 15), title: rng.pick(TITLES), what: 'random' });
  for (const v of variants) {
    const w = v.w, h = Math.min(v.h, 184), A = newWindow('Window', [16 * rng.int(0, (512 - w) / 16), 8 * rng.int(1, Math.floor((192 - h) / 8)), w, h], { title: v.title, kids: false });
    const B = newWindow('Window', [0, 8, 48, 16], { title: TITLES[2], kids: false });
    reset(s);
    doOpen(s, A);
    seedAndDraw(`window_draw active, ${v.what}, w ${w} h ${h}, n' = ${v.title ? cut(v.title.codes, w) : '-'} of ${v.title ? v.title.codes.length : 0}`, A, winLook(A, true));
    doOpen(s, B);
    seedAndDraw(`window_draw inactive, ${v.what}, w ${w} h ${h}`, A, winLook(A, false));
    seedAndDraw('window_draw active (the front window B)', B, winLook(B, true));
    doClose(s, B); doClose(s, A); doDestroy(s, A); doDestroy(s, B);
  }
  // TCtl (14.5): CLR fill of its rectangle, SET frame, SET line from the corner to the corner
  for (const [x, y, w, h] of [[20, 30, 10, 6], [100, 50, 40, 20], [0, 0, 1, 1], [511, 191, 1, 1], [3, 3, 5, 40]]) {
    const a = kNew('TCtl'); setRect(a, x, y, w, h); const n = model.addNode({ a, kind: 'TCtl', x, y, w, h });
    seedAndDraw(`TCtl draw (${x},${y},${w},${h})`, n, (g) => { g.setOp(OP_CLR); g.fill(x, y, w, h); g.setOp(OP_SET); g.frame(x, y, w, h); g.line(x, y, x + w - 1, y + h - 1); });
    s.ok(R(S.T_LOGN) === 1 && m.ram[S.T_LOG] === 2 && R(S.T_LOG + 2) === a, 'TCtl draw logs one record, code 2');
    callW(SUP, 'T_SEND M_DESTROY', 'T_SEND', { ix: a, a: S.M_DESTROY }, { lim: 130 }); model.nodes.delete(a);
  }
  reset(s);
  s.end();
}

// ===========================================================================================================================
// 2. Hand-worked windows: the expected logs and map cells are written out by hand, not taken from the model.
const logOf = () => Array.from({ length: Math.min(R(S.T_LOGN), 128) }, (_, i) => { const a = S.T_LOG + 16 * ((Math.max(0, R(S.T_LOGN) - 128) + i) % 128); return { code: m.ram[a], ix: R(a + 2), clip: [0, 1, 2, 3].map((i) => R(a + 4 + 2 * i)) }; });
function expectLog(s, what, want) {
  const got = logOf();
  s.ok(R(S.T_LOGN) === want.length && JSON.stringify(got) === JSON.stringify(want.map(([code, ix, clip]) => ({ code, ix, clip }))),
    () => `${what}: log ${JSON.stringify(got.map((r) => [r.code, r.ix.toString(16), r.clip]))} (T_LOGN ${R(S.T_LOGN)}), want ${JSON.stringify(want.map(([c, i, k]) => [c, i.toString(16), k]))}`);
}
const mapAt = (c, r) => m.ram[S.W_MAP + 32 * r + c];
if (ONLY.includes(2)) {
  const s = sec('hand-worked windows: open, raise, close, move, refusals, 14 slots (expected values derived by hand)');
  reset(s);
  const A = newWindow('TWin', [128, 48, 256, 96], { kids: false, title: TITLES[2], tag: 0x11 }), B = newWindow('TWin', [192, 80, 256, 96], { kids: false, title: TITLES[3], tag: 0x22 });
  s.ok(doOpen(s, A) === 0, 'W_OPEN of A: carry clear');
  s.ok(A.slot === 1 && m.ram[A.a + S.Window_slot] === 1 && R(S.W_SLOTS + 2) === A.a && R(S.K_FSCOPE) === A.a && R(S.W_DIRTY) === 1, 'A: slot 1, W_SLOTS[1], K_FSCOPE = A, W_DIRTY');
  s.ok([mapAt(8, 6), mapAt(23, 17), mapAt(24, 6), mapAt(8, 18), mapAt(7, 6), mapAt(0, 0)].join() === '129,129,0,0,0,15', () => `map after open A: ${[mapAt(8, 6), mapAt(23, 17), mapAt(24, 6), mapAt(8, 18), mapAt(7, 6), mapAt(0, 0)]} want 129,129,0,0,0,15`);
  let dirtyN = 0; for (let i = 0; i < 768; i++) if (m.ram[S.W_MAP + i] & 0x80) dirtyN++;
  s.ok(dirtyN === 192, () => `cells dirty after open A: ${dirtyN}, want 16 x 12 = 192`);
  doUpdate(s); expectLog(s, 'update after open A', [[1, A.a, [128, 384, 48, 144]]]);
  s.ok(m.ram[S.W_DIRTY] === 0 && mapAt(8, 6) === 1 && mapAt(0, 0) === 15, 'clean after the update');
  s.ok(doOpen(s, B) === 0, 'W_OPEN of B');
  s.ok(B.slot === 2 && R(S.K_FSCOPE) === B.a && R(S.W_SLOTS + 4) === B.a, 'B: slot 2, scope B');
  doUpdate(s); expectLog(s, 'update after open B (B whole, then A\'s title row)', [[1, B.a, [192, 448, 80, 176]], [1, A.a, [128, 384, 48, 56]]]);
  s.ok(mapAt(12, 10) === 2 && mapAt(23, 17) === 2 && mapAt(12, 9) === 1 && mapAt(12, 6) === 1, 'the overlap belongs to B (front), A keeps the rest');
  s.ok(doRaise(s, A) === 0, 'W_RAISE A');
  doUpdate(s); expectLog(s, 'update after raise A', [[1, A.a, [128, 384, 48, 56]], [1, A.a, [192, 384, 80, 144]], [1, B.a, [384, 448, 80, 88]]]);
  s.ok(doRaise(s, A) === 0 && m.ram[S.W_DIRTY] === 0, 'W_RAISE of the front window: carry clear, nothing damaged');
  s.ok(doClose(s, A) === 0, 'W_CLOSE A (the front window)');
  doUpdate(s); expectLog(s, 'update after close A', [[1, B.a, [192, 448, 80, 88]], [1, B.a, [192, 384, 88, 144]]]);
  s.ok(A.slot === 0 && m.ram[A.a + S.Window_slot] === 0 && R(S.W_SLOTS + 2) === 0 && R(S.K_FSCOPE) === B.a && R(model.bar.a + S.View_next) === B.a, 'A closed: slot 0, W_SLOTS[1] free, scope B, B is the bar\'s next sibling');
  s.ok(doClose(s, A) === 1, 'W_CLOSE of a closed window: carry');
  s.ok(doRaise(s, A) === 1 && doMove(s, A, 16, 16) === 1, 'W_RAISE and W_MOVE of a closed window: carry');
  s.ok(doMove(s, B, 192, 80) === 0 && m.ram[S.W_DIRTY] === 0, 'W_MOVE to where the window is: carry clear, nothing changed');
  s.ok([doMove(s, B, 200, 80), doMove(s, B, 192, 4), doMove(s, B, 320, 80), doMove(s, B, 192, 120), doMove(s, B, 192, 0), doMove(s, B, 192, -8)].join() === '1,1,1,1,1,1', 'W_MOVE to rectangles that break section 3: carry');
  s.ok(B.x === 192 && B.y === 80 && m.ram[S.W_DIRTY] === 0, 'refused moves changed nothing');
  s.ok(doMove(s, B, 16, 8) === 0, 'W_MOVE B to (16, 8)');
  doUpdate(s); expectLog(s, 'update after move', [[1, B.a, [16, 272, 8, 104]]]);
  s.ok(doClose(s, B) === 0 && R(S.K_FSCOPE) === 0 && R(S.K_FOCUS) === 0, 'closing the last window clears K_FSCOPE (reading M1)');
  doUpdate(s);
  // invalid rectangles are refused, with nothing changed
  const badWins = BAD.map((f) => newWindow('TWin', f([64, 40, 96, 48]), { kids: false }));
  badWins.forEach((w, i) => s.ok(doOpen(s, w) === 1 && w.slot === 0 && m.ram[w.a + S.Window_slot] === 0 && m.ram[S.W_DIRTY] === 0, () => `W_OPEN of the invalid rectangle ${i} (${w.x},${w.y},${w.w},${w.h}) is refused, nothing changed`));
  badWins.forEach((w) => doDestroy(s, w));
  // the smallest and the largest valid windows
  const small = newWindow('TWin', [0, 8, 48, 16], { kids: false }), big = newWindow('TWin', [0, 8, 512, 184], { kids: false });
  s.ok(doOpen(s, small) === 0 && doOpen(s, big) === 0, 'the smallest (48 x 16) and the largest (512 x 184) windows open');
  doUpdate(s);
  // W_MODAL != 0: W_OPEN refused
  const late = newWindow('TWin', [64, 40, 96, 48], { kids: false });
  poke16(S.W_MODAL, 0x1234); model.modal = 0x1234;
  s.ok(doOpen(s, late) === 1 && late.slot === 0, 'W_OPEN with W_MODAL != 0: carry, nothing changed');
  poke16(S.W_MODAL, 0); model.modal = 0;
  // 14 slots
  reset(s);
  const ws = Array.from({ length: 15 }, (_, i) => newWindow('TWin', [16 * (i % 8), 8 + 8 * i, 48, 16], { kids: false }));
  const results = ws.map((w) => doOpen(s, w));
  s.ok(results.join() === [...Array(14).fill(0), 1].join(), () => `14 windows open and the 15th is refused: ${results}`);
  s.ok(ws.slice(0, 14).every((w, i) => w.slot === i + 1 && m.ram[w.a + S.Window_slot] === i + 1), 'slots 1..14 in the order of opening');
  s.ok(doClose(s, ws[4]) === 0 && doOpen(s, ws[14]) === 0 && ws[14].slot === 5 && m.ram[ws[14].a + S.Window_slot] === 5, 'the lowest free slot (5) is reused');
  s.ok(doOpen(s, ws[14]) === 1, 'W_OPEN of an open window: carry');
  doUpdate(s);
  doFront(s);
  reset(s);
  for (const w of [...ws, late, small, big, A, B]) doDestroy(s, w);
  s.end();
}

// ===========================================================================================================================
// 3. The focus scope (14.4, 7): TAB stays inside the front window.  Expected values written out by hand.
if (ONLY.includes(3)) {
  const s = sec('focus scope: activation, Window_focus, K_FSCOPE, TAB and BACKTAB inside the front window, outside-focus walk');
  reset(s);
  const mkW = (rect, spec) => {
    const w = newWindow('TWin', rect, { kids: false, title: TITLES[2], tag: 0 });
    return { w, kids: spec.map((f, i) => addKid(w, 'TCtl', rect[0] + 16 * (i + 1), rect[1] + 16, 12, 8, f, 0, i + 1)) };
  };
  const WA = mkW([16, 8, 160, 64], [1, 0, 1]), WB = mkW([208, 8, 160, 64], [1, 1]);
  const [a1, a2, a3] = WA.kids, [b1, b2] = WB.kids;
  const focusIs = (v, what) => s.ok(R(S.K_FOCUS) === (v ? v.a : 0), () => `${what}: K_FOCUS ${hex(R(S.K_FOCUS))}, want ${nm(v)}`);
  doOpen(s, WA.w); focusIs(a1, 'open A: its first focusable child'); s.ok(R(S.K_FSCOPE) === WA.w.a, 'scope A');
  doOpen(s, WB.w); focusIs(b1, 'open B: B\'s first focusable child'); s.ok(R(S.K_FSCOPE) === WB.w.a && R(WA.w.a + S.Window_focus) === a1.a, 'scope B, A saved a1 as its focus');
  doFocusMove(s, true); focusIs(b2, 'TAB: b2');
  doFocusMove(s, true); focusIs(b1, 'TAB wraps inside B (never to A)');
  doFocusMove(s, false); focusIs(b2, 'BACKTAB wraps backwards to b2');
  doRaise(s, WA.w); focusIs(a1, 'raise A: a1 restored'); s.ok(R(WB.w.a + S.Window_focus) === b2.a && R(S.K_FSCOPE) === WA.w.a, 'B saved b2');
  doFocusMove(s, true); focusIs(a3, 'TAB in A skips the unfocusable a2');
  doFocusMove(s, true); focusIs(a1, 'TAB in A wraps to a1');
  doFocusMove(s, false); focusIs(a3, 'BACKTAB in A wraps to a3');
  doRaise(s, WB.w); focusIs(b2, 'raise B: b2 restored'); s.ok(R(WA.w.a + S.Window_focus) === a3.a, 'A saved a3');
  doClose(s, WB.w); focusIs(a3, 'close B (front): the focus was cleared, A is activated and restores a3'); s.ok(R(S.K_FSCOPE) === WA.w.a, 'scope A after the close');
  // the key through K_DISPATCH: TAB moves inside A
  doEvent(s, 'key', KEYS.TAB); focusIs(a1, 'E_KEY TAB through K_DISPATCH wraps to a1');
  doEvent(s, 'key', KEYS.BACKTAB); focusIs(a3, 'E_KEY BACKTAB through K_DISPATCH');
  // a saved focus that can no longer take it: the activation falls back to the first focusable view
  doOpen(s, WB.w); focusIs(b2, 'B opened again: its saved focus b2 is restored');
  poke8(b2.a + S.View_flags, 5); b2.flags = 5;                                 // disabled
  doRaise(s, WA.w); doRaise(s, WB.w);
  s.ok(R(WB.w.a + S.Window_focus) !== 0, 'B kept b2 as its saved focus');
  focusIs(b1, 'raise B with a saved focus that is now disabled: K_SETFOCUS refuses, 0 then K_FOCUSNEXT gives b1');
  // an empty window: no focusable view; the focus is 0
  const E = mkW([16, 88, 96, 48], [0, 0]); doOpen(s, E.w); focusIs(null, 'a window with no focusable view: focus 0'); s.ok(R(S.K_FSCOPE) === E.w.a, 'scope E');
  doFocusMove(s, true); focusIs(null, 'K_FOCUSNEXT in a scope with nothing focusable: nothing');
  // a focusable window itself is the first view of its own walk
  poke8(E.w.a + S.View_flags, 1); E.w.flags = 1;
  doRaise(s, WA.w); doRaise(s, E.w); focusIs(E.w, 'a focusable window: with no saved focus the walk tests the window itself first (the scope root)');
  poke8(E.w.a + S.View_flags, 0); E.w.flags = 0;
  doRaise(s, WA.w);
  // a focus outside the scope: a view of a closed window with no other focusable view; the walk climbs out, wraps to R and searches R's subtree
  const C1 = newWindow('TWin', [16, 8, 64, 48], { kids: false }), c1 = addKid(C1, 'TCtl', 24, 24, 8, 8, 1, 0, 9);
  for (const [next, want] of [[true, a1], [false, a3]]) {
    beginStep('poke K_FOCUS outside the scope'); poke16(S.K_FOCUS, c1.a); model.focus = c1; endStep(s, 'poke focus outside');
    doFocusMove(s, next); focusIs(want, `focus outside the scope (a lone view of a closed window), ${next ? 'NEXT' : 'PREV'}: ${nm(want)}`);
  }
  reset(s);
  for (const w of [WA.w, WB.w, E.w, C1]) doDestroy(s, w);
  s.end();
}

// ===========================================================================================================================
// 4. Batches (14.4): 365 or more rectangles collected at the start of a row are painted first.
if (ONLY.includes(4)) {
  const s = sec('batches: single-cell checkerboards (W_INVAL one cell at a time) reach the 365-rectangle limit');
  reset(s);
  const BIGW = newWindow('TWin', [0, 8, 512, 184], { kids: false, title: TITLES[2], tag: 0x5A });
  doOpen(s, BIGW); doUpdate(s);
  const cell = (c, r) => doInval(s, 16 * c, 8 * r, 16, 8, true);
  const pattern = (lastRowRuns) => {
    beginStep(`checkerboard rows 0-21, rows 22 and 23 with ${lastRowRuns} runs`);
    for (let r = 0; r < 22; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 0) cell(c, r);
    for (const r of [22, 23]) for (let c = 0; c < 2 * lastRowRuns; c += 2) cell(c, r);
  };
  // 364 collected at the start of row 23 (12 runs in row 22): no break, row 23 extends row 22's rectangles
  pattern(12);
  paintStep(s, '364 rectangles: one batch', null, () => model.update(), () => callW(s, 'W_UPDATE', 'W_UPDATE', {}));
  let recs = logOf();
  s.ok(R(S.T_LOGN) === 16 * 21 + 12 && recs.slice(-12).every((r) => r.clip[2] === 176 && r.clip[3] === 192), () => `364 collected: T_LOGN ${R(S.T_LOGN)} (want 348), the last 12 rectangles should be 2 rows tall: ${JSON.stringify(recs.slice(-2).map((r) => r.clip))}`);
  // 365: the first batch is painted, row 23 starts new rectangles
  doUpdate(s);
  pattern(13);
  paintStep(s, '365 rectangles: two batches', null, () => model.update(), () => callW(s, 'W_UPDATE', 'W_UPDATE', {}));
  recs = logOf();
  s.ok(R(S.T_LOGN) === 16 * 21 + 13 + 13 && recs.slice(-26, -13).every((r) => r.clip[2] === 176 && r.clip[3] === 184) && recs.slice(-13).every((r) => r.clip[2] === 184 && r.clip[3] === 192),
    () => `365 collected: T_LOGN ${R(S.T_LOGN)} (want 362), the last two groups of 13 should be one row tall: ${JSON.stringify(recs.slice(-14, -12).map((r) => r.clip))}`);
  // the full checkerboard of the amendment: 16 x 23 = 368 collected before row 23
  doUpdate(s);
  beginStep('full checkerboard');
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 0) cell(c, r);
  paintStep(s, 'full checkerboard', null, () => model.update(), () => callW(s, 'W_UPDATE', 'W_UPDATE', {}));
  recs = logOf();
  const want = []; for (let r = 1; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((c + r) % 2 === 0) want.push([16 * c, 16 * c + 16, 8 * r, 8 * r + 8]);
  s.ok(R(S.T_LOGN) === want.length && want.length === 368, () => `full checkerboard: T_LOGN ${R(S.T_LOGN)}, want 368 window rectangles`);
  s.ok(recs.every((r, i) => JSON.stringify(r.clip) === JSON.stringify(want[want.length - 128 + i])), 'the last 128 rectangles are the checkerboard cells of the last rows, in creation order, across the batch limit');
  // an owner mix: the checkerboard with two windows (an owner change in a row also splits runs)
  doClose(s, BIGW); doDestroy(s, BIGW);
  s.end();
}

// ===========================================================================================================================
// 5. The random sequence (test items 1-4).
if (ONLY.includes(5)) {
  const s = sec('random sequence: W_MAP, slots, list, focus, log, composition, clip safety, registers, stack');
  reset(s);
  const wins = [];
  const spawn = () => { const w = newWindow('TWin', randRect()); wins.push(w); return w; };
  for (let i = 0; i < 20; i++) spawn();
  const st = { open: 0, openRefused: 0, close: 0, raise: 0, move: 0, moveRefused: 0, inval: 0, update: 0, drawview: 0, stub: 0, focus: 0, key: 0, getev: 0, destroy: 0, mutate: 0, checker: 0, full14: 0, drawn: 0, hidden: 0, maxRects: 0, maxLog: 0 };
  const WEIGHTS = [['open', 20], ['close', 11], ['raise', 13], ['move', 12], ['inval', 5], ['invalv', 4], ['update', 10], ['drawview', 8], ['stub', 5], ['front', 2], ['setfocus', 3], ['focusmove', 3], ['key', 3],
    ['getev', 3], ['mutate', 3], ['destroy', 2], ['badopen', 2], ['capture', 1], ['checker', 0.5]];
  const total = WEIGHTS.reduce((a, [, w]) => a + w, 0);
  const pickOp = () => { let r = rng.next() * total; for (const [n, w] of WEIGHTS) { r -= w; if (r < 0) return n; } return 'update'; };
  const randGA = () => rng.chance(0.8) ? [rng.int(-60, 560), rng.int(-40, 230), rng.int(-5, 400), rng.int(-5, 200)] : [rng.int(-16384, 16383), rng.int(-16384, 16383), rng.int(-16384, 16383), rng.int(-16384, 16383)];
  for (let step = 0; step < STEPS && !s.bad; step++) {
    let op = pickOp();
    const open = model.list, closed = wins.filter((w) => !w.slot);
    if (step < 60 && rng.chance(0.6)) op = 'open';
    if (open.length >= 12 && op === 'open' && rng.chance(0.5)) op = 'close';
    if (open.length < 5 && (op === 'close' || op === 'destroy') && rng.chance(0.6)) op = 'open';
    if (wins.length < 20) spawn();
    switch (op) {
      case 'open': {
        const w = closed.length && !rng.chance(0.04) ? rng.pick(closed) : rng.pick(wins);
        if (doOpen(s, w)) st.openRefused++; else st.open++;
        if (model.list.length === 14) st.full14++;
        break;
      }
      case 'badopen': {
        const bw = newWindow('TWin', rng.pick(BAD)(randRect()), { kids: false });
        if (!doOpen(s, bw)) throw new Error(`the test built a valid rectangle (${bw.x},${bw.y},${bw.w},${bw.h}) for a bad open`);
        st.openRefused++;
        doDestroy(s, bw);
        break;
      }
      case 'close': { const w = open.length && !rng.chance(0.05) ? rng.pick(open) : rng.pick(wins); if (!doClose(s, w)) st.close++; break; }
      case 'raise': { const w = open.length && !rng.chance(0.05) ? rng.pick(open) : rng.pick(wins); doRaise(s, w); st.raise++; break; }
      case 'move': {
        const w = open.length && !rng.chance(0.05) ? rng.pick(open) : rng.pick(wins), q = rng.next();
        let x, y;
        if (q < 0.1) { x = w.x; y = w.y; }
        else if (q < 0.25) { [x, y] = rng.pick([[w.x + 8, w.y], [w.x, w.y + 4], [512 - w.w + 16, w.y], [w.x, 192 - w.h + 8], [w.x, 0], [w.x, -8], [w.x, 256 + 8], [w.x, 4]]); }
        else { x = 16 * rng.int(0, (512 - w.w) / 16); y = 8 * rng.int(1, Math.floor((192 - w.h) / 8)); }
        if (!doMove(s, w, x, y)) st.move++; else st.moveRefused++;
        break;
      }
      case 'inval': { const [x, y, w, h] = randGA(); doInval(s, x, y, w, h); st.inval++; break; }
      case 'invalv': { doInvalV(s, rng.pick(allViews())); st.inval++; break; }
      case 'update': { const p = doUpdate(s); st.update++; st.drawn += p.length; st.maxRects = Math.max(st.maxRects, p.length); st.maxLog = Math.max(st.maxLog, model.log.length); break; }
      case 'drawview': {
        const cand = allViews().filter((n) => n.w > 0 && n.h > 0);
        const v = rng.chance(0.08) ? rng.pick([model.desk, model.bar]) : rng.chance(0.6) && open.length ? rng.pick(model.subtree(rng.pick(open)).filter((n) => n.w > 0 && n.h > 0)) : rng.pick(cand);
        const p = doDrawView(s, v); st.drawview++; if (!p.length) st.hidden++;
        break;
      }
      case 'stub': {
        const w = rng.pick(wins), k = rng.pick(['T_RAISEUPD', 'T_OPENUPD', 'T_CLOSEUPD', 'T_MOVEUPD']);
        const x = 16 * rng.int(0, (512 - w.w) / 16), y = 8 * rng.int(1, Math.floor((192 - w.h) / 8));
        doStub(s, k, w, x, y); st.stub++;
        break;
      }
      case 'front': doFront(s); break;
      case 'setfocus': {
        const f = model.front(), pool = f ? model.subtree(f) : [];
        doSetFocus(s, rng.chance(0.15) || !pool.length ? null : rng.pick(pool)); st.focus++;
        break;
      }
      case 'focusmove': doFocusMove(s, rng.chance(0.5)); st.focus++; break;
      case 'key': doEvent(s, 'key', rng.pick([KEYS.TAB, KEYS.TAB, KEYS.BACKTAB, KEYS.DOWN, KEYS.UP, KEYS.LEFT, KEYS.RIGHT, 0x78, KEYS.ENTER])); st.key++; break;
      case 'getev': doEvent(s, rng.pick(['empty', 'empty', 'redraw'])); st.getev++; break;
      case 'mutate': {
        const cv = childViews(); if (!cv.length) break;
        const v = rng.pick(cv);
        beginStep(`flags of ${nm(v)}`);
        const bit = rng.pick([1, 2, 2, 4, 4]);
        v.flags ^= bit; poke8(v.a + S.View_flags, v.flags); ver++;
        endStep(s, `flags of ${nm(v)}`);
        doInvalV(s, v); st.mutate++;
        break;
      }
      case 'destroy': { const w = rng.pick(wins); wins.splice(wins.indexOf(w), 1); doDestroy(s, w); st.destroy++; break; }
      case 'capture': { const v = model.list.length && rng.chance(0.8) ? rng.pick(model.subtree(rng.pick(model.list))) : null; doSetCapture(s, v); break; }
      case 'checker': {
        beginStep('checkerboard');
        const par = rng.int(0, 1), r0 = rng.int(0, 3);
        for (let r = r0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if ((c + r + par) % 2 === 0) doInval(s, 16 * c, 8 * r, 16, 8, true);
        endStep(s, 'checkerboard (W_INVAL of single cells)');
        const p = doUpdate(s, 'W_UPDATE after a checkerboard'); st.checker++; st.maxRects = Math.max(st.maxRects, p.length);
        break;
      }
      default: throw new Error(`unknown op ${op}`);
    }
    if (VERBOSE && step % 500 === 0) console.log(`  step ${step}: ${model.list.length} open`);
  }
  // settle, then the last full check
  doUpdate(s, 'W_UPDATE (final)');
  s.ok(!model.anyDirty() && m.ram[S.W_DIRTY] === 0, 'after the final update nothing is dirty');
  console.log(`  ${JSON.stringify(st)}`);
  s.ok(st.open > 150 && st.openRefused > 40 && st.close > 100 && st.raise > 150 && st.move > 100 && st.moveRefused > 20 && st.update > 150 && st.drawview > 100 && st.stub > 40 && st.focus > 60 && st.key > 30 && st.getev > 30 && st.mutate > 30 && st.destroy > 20,
    () => `coverage: ${JSON.stringify(st)}`);
  s.ok(st.full14 > 3 || STEPS < 3000, () => `coverage: the 14-window state was reached only ${st.full14} times`);
  s.ok(st.checker >= 1 || STEPS < 3000, 'coverage: no checkerboard step ran');
  s.end();
}

// ===========================================================================================================================
// 6. K_SETROOT and K_ARESET clear K_FSCOPE (14.4); run last, K_ARESET wipes the app arena.
if (ONLY.includes(6)) {
  const s = sec('K_SETROOT and K_ARESET clear K_FSCOPE when it points into the arena (14.4)');
  reset(s);
  const w = newWindow('TWin', [64, 40, 96, 48], { kids: false });
  doOpen(s, w);
  s.ok(R(S.K_FSCOPE) === w.a, 'scope = the window');
  beginStep('K_SETROOT');
  callW(s, 'K_SETROOT desk', 'K_SETROOT', { de: model.desk.a }, { lim: 32 });
  s.ok(R(S.K_FSCOPE) === 0 && R(S.K_FOCUS) === 0 && R(S.K_CAPTURE) === 0 && R(S.K_ROOT) === model.desk.a, () => `after K_SETROOT: K_FSCOPE ${hex(R(S.K_FSCOPE))} K_FOCUS ${hex(R(S.K_FOCUS))} K_ROOT ${hex(R(S.K_ROOT))}`);
  // K_ARESET of the app arena: a scope in the kernel arena (the desk) stays, a scope in the app arena is cleared
  poke16(S.K_FSCOPE, model.desk.a);
  callW(s, 'K_ARESET app', 'K_ARESET', { hl: S.K_AARENA }, { lim: 32 });
  s.ok(R(S.K_FSCOPE) === model.desk.a, () => `K_ARESET of the app arena left the scope (a kernel arena view) ${hex(model.desk.a)} alone: ${hex(R(S.K_FSCOPE))}`);
  const w2a = 0xC123; poke16(S.K_FSCOPE, w2a);
  callW(s, 'K_ARESET app', 'K_ARESET', { hl: S.K_AARENA }, { lim: 32 });
  s.ok(R(S.K_FSCOPE) === 0, () => `K_ARESET of the app arena cleared a scope in it: ${hex(R(S.K_FSCOPE))}`);
  s.end();
}

SUP.end();
console.log(`${N} assertions`);
C.done();
