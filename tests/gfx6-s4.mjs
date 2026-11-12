"use strict";
// gfx6-s4.mjs -- slice S4 of the graphics spike (docs/GRAPHICS_SPIKE.md sections 8 and 16): the mouse pointer drawn by the frame
// interrupt, and the shield, on the `gfx6t` cartridge.  Written from the contract (section 16), never from the code.  The reference is
// tests/gfx6-model.mjs (PointerModel over the S1-S3 model): the display is always "the screen with the pointer image at D".
//   node tests/gfx6-s4.mjs [--seed N] [--steps N] [--frames N] [--stride N] [--reps N] [--only 0,1,2,3,4,5]
//     --seed N     PRNG seed (printed; default from the clock); a failure is reproduced with the same seed
//     --steps N    checked calls per random direct-call run (16.6.1; default 3000, contract minimum 3000)
//     --frames N   strict frames of the flicker test (16.6.3; default 600)
//     --stride N   interrupt injection: every N-th instruction boundary (16.6.2; default 1 = every one)
//     --reps N     scenarios per case of the injection test (default 2)
//     --only LIST  run only these parts: 0 boot, 1 direct calls, 2 injection, 3 flicker, 4 G_CLS with the pointer, 5 longest DI
//
// Parts:
//   0  boot: P_ARROW sanity; P_ISR before P_INIT draws nothing (called directly and by the frame ISR over several frames)
//   1  16.6.1 random direct calls, interrupts off, display compared with the model after every step
//   2  16.6.2 interrupt injection at EVERY instruction boundary of P_MOVE / P_SHIELD / P_UNSHIELD / a shielded G_FILL
//   3  16.6.3 flicker test: strict frames compared with the model through m.pixels, script batches through T_SCRIPT
//   4  16.6.4 G_CLS with the pointer moving (T_CLSPLOOP, 300 frames)
//   5  16.6.5 longest DI
//
// Readings of the contract (also listed in the report that came with this file):
//  R1. Every step of 16.6.1 checks GA, GOP, GLH and GCLIP unchanged (all routines but P_INIT), including P_UNSHIELD and P_ISR, which
//      16.3 does not name for GA: 16.6.1 says "GA ... unchanged (except after P_INIT)" without restricting it.
//  R2. "Shielded drawing" of G_TEXTP uses the string's box as its rectangle (x, y, widest line, 8 + (lines - 1) GLH), united with the
//      bounding box of the ink the model draws (so the shield always covers every pixel written).  G_TEXT8 (not named in 16.6.1) is
//      added with its cells' rectangle.
//  R3. 16.6.2's starting state: pointer drawn at A (P_INIT, P_ISR), shield none (P_UNSHIELD's scenarios: a shield that A does not meet),
//      P_MOVE to B pending.  P_MOVE's argument C is B, A or another position.  "Shielded G_FILL" is the sequence P_SHIELD r; G_FILL r;
//      P_UNSHIELD, injected at every instruction boundary of the whole sequence (the boundaries between the routines included).
//      After the sequence returns, P_ISR is called once (direct call) and the display is compared with the model's "sequence, P_ISR".
//  R4. Strict frames (16.6.3): step 2 makes one P_MOVE (or none on a stop) and at most one P_SHIELD / P_UNSHIELD, in a random order.
//      "The model after step 2" = the model after the ISR of step 1 (model P_ISR) and then those calls.
//  R5. After a script batch the drawn state is unknown to the model (the ISR ran at uncontrolled moments): the next strict frame's ISR
//      (stepped, model P_ISR) must bring the display to "screen + pointer at the last position", whatever was drawn before (16.4).
//  R6. The frame ISR's stack depth: the bytes $FE00-$FEDF are poisoned before the stepped ISR of every strict frame and must be
//      unchanged after it (the ISR's whole frame, return address included, is the 32 bytes $FEE0-$FEFF, 12.2 / 16.3).
//  R7. A frame's interrupt counts as "not lost" when, after runFrame, the CPU stands at $0038 with the return address pushed (the
//      machine's accepted interrupt, see gfx6-cls.mjs), and V_FRAMES + that pending one has risen by exactly the frames run.
import { checks, M, Z, FRAME_T, screenPixel } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, changed, poison, checkPoison, seedDisplay, setGA, opClipBytes, hex, w16, rd16, CLS_REGIONS,
  PRESERVED, ALL_REGS, NEEDED_S4, T_STR, T_SCR, PTR_AREA, GUARD_T } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 3000), FRAMES = argVal('--frames', 600), STRIDE = Math.max(1, argVal('--stride', 1)), REPS = argVal('--reps', 2);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5];
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} direct-call steps, injection stride ${STRIDE}, ${REPS} scenarios a case, ${FRAMES} strict frames`);

const C = checks('gfx6 S4');
const BASE = ['G_INIT', 'G_SETOP', 'G_SETCLIP', 'G_FILL', 'G_TEXTP', 'G_TEXTW', 'G_TEXT8', 'G_SCROLLV', 'G_CLS', 'GA', 'GOP', 'GLH', 'GCLIP',
  'T_IDLE', 'T_RET', 'RESULT', 'V_FRAMES', 'V_CLS'];
const ctx = start(C, [...BASE, ...NEEDED_S4]);
if (!ctx) { console.log('the gfx6t cartridge (with the S4 symbols) is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const fmt = (n) => n.toLocaleString('en-US');
const STR = S.T_STR ?? T_STR, SCR0 = S.T_SCR ?? T_SCR;
const arrow = Uint8Array.from({ length: 64 }, (_, i) => m.bus.read(S.P_ARROW + i));

// ---------------------------------------------------------------------------------------------------------------------------
// CPU / frame helpers
const step1 = () => Z.runZ80(cpu, m.bus, 1, m);
const frameCount = () => rd16(m, S.V_FRAMES);
const zeroPtr = () => m.ram.fill(0, PTR_AREA[0], PTR_AREA[1] + 1);                  // 16.1: all 0 before P_INIT
const accepted = () => cpu.pc === 0x38;                                              // R7: an accepted frame interrupt is pending

/** Run a pending (accepted) frame interrupt to its RET.  Returns { t (T-states of the ISR, RET included), offIsrp (offset at T_ISRP), steps }. */
function runIsr(limit = 400000) {
  const sp0 = cpu.sp + 2, ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8), t0 = m.tstates;
  let offIsrp = -1, steps = 0;
  while (!(cpu.pc === ret && cpu.sp === sp0)) {
    if (cpu.pc === S.T_ISRP && offIsrp < 0) offIsrp = m.tstates - m.frameStart;
    step1();
    if (++steps > limit) throw new Error(`the frame ISR did not return (PC ${hex(cpu.pc)}, SP ${hex(cpu.sp)}) after ${steps} instructions`);
  }
  return { t: m.tstates - t0, offIsrp, steps };
}
/** If a frame interrupt is pending, run it. */
function finishPending() { if (accepted()) runIsr(); }
/** Put the CPU back at T_IDLE: SP $FF00, interrupts on, not halted (16.6.3 step 4). */
function parkIdle() {
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_IDLE;
}
/**
 * After long direct calls (P_INIT builds its pre-shifted copies: more than a frame of T-states) the machine's clock runs ahead of its
 * frame counter, and runFrame then spends whole frames catching up without running the CPU.  Run those with the CPU parked (the frame
 * interrupts they raise are discarded), then the two settling frames of 16.6.3: the first has no interrupt pending, the second runs
 * the first one's ISR at its start.
 */
function settle() {
  for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { parkIdle(); M.runFrame(m); }
  parkIdle(); M.runFrame(m); M.runFrame(m);
}
/** Direct call (interrupts off), throws on a guard or halt; returns call()'s result. */
const direct = (name, regs = {}, ga = null, o = {}) => {
  if (ga) setGA(m, S, ...ga);
  return call(m, S, name, regs, { rng, ...o });
};
const pinit = (x, y) => direct('P_INIT', { hl: w16(x), de: w16(y) });
const pmove = (x, y) => direct('P_MOVE', { hl: w16(x), de: w16(y) });
const pshield = (x, y, w, h) => direct('P_SHIELD', {}, [x, y, w, h]);
const punshield = () => direct('P_UNSHIELD');
const pisr = () => direct('P_ISR');

/** (byte column, row) of a display address. */
function byteAt(addr) {
  const file = addr >= 0x6000 ? 1 : 0, off = addr & 0x1FFF, y = ((off >> 11) & 3) * 64 + ((off >> 5) & 7) * 8 + ((off >> 8) & 7);
  return { bc: (off & 31) * 2 + file, y };
}
/** null when the display bytes in RAM equal the model's display; else a text with the first difference. */
function displayDiff(pm) {
  const want = pm.displayBytes(), d = G.compareBytes(m.ram, want);
  if (!d) return null;
  const b = byteAt(d.addr);
  return `display byte (column ${b.bc}, row ${b.y}) at ${hex(d.addr)} = ${hex(d.got, 2)}, model ${hex(d.want, 2)}`;
}

// Categories, as in the S3 test.
class Cat {
  constructor(name) { this.name = name; this.calls = 0; this.bad = 0; this.first = ''; }
  record(desc, probs) { this.calls++; if (probs.length) { this.bad++; if (!this.first) this.first = `${desc}: ${probs.join('; ')}`; } return probs.length === 0; }
  report(extra = '') { C.check(this.name, this.bad === 0, this.bad ? `${this.bad} of ${this.calls} failed, first: ${this.first}` : `${this.calls} checked${extra}`); }
}

// Positions and rectangles --------------------------------------------------------------------------------------------------
const XE = [0, 7, 8, 495, 496, 503, 504, 511], YE = [0, 7, 8, 176, 177, 191];            // 16.6.1's edge positions
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rng.int(0, i); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const edgePairs = () => shuffle(XE.flatMap((x) => YE.map((y) => [x, y])));
const rint = (lo, hi) => rng.int(lo, hi);

/**
 * A pixel rectangle [x, y, w, h] whose BYTE rectangle is columns a..b and rows r0..r1 (before the clamp to the screen).
 * x lies in byte a, the last pixel in byte b, rows exactly r0..r1.
 */
function rectFromBytes(a, b, r0, r1) {
  const x = 8 * a + rint(0, 7);
  let xe = 8 * b + rint(0, 7);
  if (xe < x) xe = x;
  return [x, r0, xe - x + 1, r1 - r0 + 1];
}
/**
 * A shield rectangle placed relative to a pointer byte rectangle T = { c0, c1, y0, y1 }: just missing it on one side, just touching
 * it, inside it, containing it (16.2's meets on byte, not pixel, rectangles), or at random.
 */
function rectNear(T) {
  const mode = rint(0, 9), dc = () => rint(0, 3), dr = () => rint(0, 5);
  switch (mode) {
    case 0: { const b = T.c0 - 1; return rectFromBytes(b - dc(), b, T.y0 - dr(), T.y1 + dr()); }          // just left
    case 1: { const a = T.c1 + 1; return rectFromBytes(a, a + dc(), T.y0 - dr(), T.y1 + dr()); }          // just right
    case 2: { const r1 = T.y0 - 1; return rectFromBytes(T.c0 - dc(), T.c1 + dc(), r1 - dr(), r1); }       // just above
    case 3: { const r0 = T.y1 + 1; return rectFromBytes(T.c0 - dc(), T.c1 + dc(), r0, r0 + dr()); }       // just below
    case 4: return rectFromBytes(T.c0 - dc(), T.c0, T.y0 + rint(-5, 15), T.y0 + rint(0, 20));            // touches the left byte column
    case 5: return rectFromBytes(T.c1, T.c1 + dc(), T.y0 + rint(-5, 15), T.y0 + rint(0, 20));            // touches the right byte column
    case 6: return rectFromBytes(T.c0 + rint(-2, 3), T.c1 + rint(-2, 3), T.y0 - dr(), T.y0);              // touches the top row
    case 7: return rectFromBytes(T.c0 + rint(-2, 3), T.c1 + rint(-2, 3), T.y1, T.y1 + dr());              // touches the bottom row
    case 8: { const a = rint(T.c0, T.c1), b = rint(a, T.c1), r0 = rint(T.y0, T.y1); return rectFromBytes(a, b, r0, rint(r0, T.y1)); }   // inside
    default: return rectFromBytes(T.c0 - dc(), T.c1 + dc(), T.y0 - dr(), T.y1 + dr());                    // contains it
  }
}
/** A random shield rectangle: mostly boundary cases around the drawn pointer or its position, sometimes anything. */
function randShield(pm, { maxW = 200, maxH = 60 } = {}) {
  const k = rng.next(), pos = pm.pos, D = pm.D;
  if (k < 0.60) {
    const t = rng.chance(0.5) && D ? D : (rng.chance(0.5) ? pos : (D || pos));
    return rectNear(G.pointerRect(t.x, t.y));
  }
  if (k < 0.74) return [rint(-30, 520), rint(-20, 205), rint(1, maxW), rint(1, maxH)];
  if (k < 0.80) return rng.pick([[rint(0, 500), rint(0, 190), 0, rint(0, 9)], [rint(0, 500), rint(0, 190), rint(0, 9), 0], [rint(0, 500), rint(0, 190), -rint(1, 9), rint(1, 20)],
    [rint(512, 900), rint(0, 190), 30, 30], [-60, 5, 40, 30], [5, rint(192, 300), 30, 30], [-40, -40, 40, 40]]);
  if (k < 0.85) return [0, 0, 512, 192];
  if (k < 0.92) { const t = D || pos; return [t.x + rint(-3, 18), t.y + rint(-3, 18), rint(1, 3), rint(1, 3)]; }
  return [rint(0, 500), rint(0, 190), rint(1, 40), rint(1, 20)];
}
/** A random position: the edge queue, anything, near the current one, the same, out of range, near the drawn one. */
/** A position whose pointer byte rectangle meets the shield (so the ISR hides the pointer there). */
function underShield(pm) {
  const px = 8 * rint(Math.max(0, pm.S.c0 - 2), pm.S.c1) + rint(0, 7), py = rint(Math.max(0, pm.S.y0 - 15), pm.S.y1);
  return [Math.min(px, 511), py];
}
function randPos(pm, edgeQ) {
  const r = rng.next();
  if (pm.S && rng.chance(pm.D ? 0.5 : 0.25)) return underShield(pm);
  if (r < 0.30 && edgeQ) { if (!edgeQ.q.length) edgeQ.q = edgePairs(); return edgeQ.q.pop(); }
  if (r < 0.50) return [rint(0, 511), rint(0, 191)];
  if (r < 0.64) return [pm.pos.x + rint(-20, 20), pm.pos.y + rint(-12, 12)];
  if (r < 0.72) return [pm.pos.x, pm.pos.y];
  if (r < 0.84) return [rng.pick([rint(-400, -1), rint(512, 900), -16384, 16383, rint(-16384, 16383), 65535 - 65536]), rng.pick([rint(-400, -1), rint(192, 400), -16384, 16383, rint(-16384, 16383)])];
  if (pm.D) return [pm.D.x + rint(-24, 24), pm.D.y + rint(-20, 20)];
  return [rint(0, 511), rint(0, 191)];
}

// ---------------------------------------------------------------------------------------------------------------------------
// The model state used by parts 1-3.
let scr = null, pm = null;
const resetModel = () => { scr = new G.Gfx6Model(); scr.loadRam(m.ram); pm = new G.PointerModel(scr, arrow); };
const setOp = (op) => { direct('G_SETOP', { a: op }); scr.setOp(op); };
const setClip = (x, y, w, h) => { direct('G_SETCLIP', {}, [x, y, w, h]); scr.setClip(x, y, w, h); };

/** A fresh machine state for a run: pointer area zero, random display, G_INIT, model synchronised, pointer not initialised. */
function freshState({ glh = 8 } = {}) {
  finishPending();
  zeroPtr();
  seedDisplay(m, rng);
  direct('G_INIT');
  m.ram[S.GLH] = glh;
  resetModel();
  scr.setGlh(glh);
}

// ---------------------------------------------------------------------------------------------------------------------------
// One checked call (the S3 test's `exec`, for the S4 routines): the display against the model, poison (with the routine's stack
// allowance), SP, the interrupt flag, IX / IY / alternate set, GA / GOP / GLH / GCLIP unchanged, T_STR / T_SCR unchanged.
const T1_REGIONS = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xCFFF], [0xE800, 0xFDFF]];   // 16.6.1: not the pointer area, $E0xx, $E700-$E7FF, T_STR, T_SCR
const GA_LEN = 16;
/**
 * o: { ga (words; the rest of GA gets random bytes) | none, regs, model() (applies the call to the model), stack (bytes below the
 *      return address the routine may use; default 32), gaUndefined, ints, guard, post(r) -> problems }.
 * Returns { ok, r }.
 */
function exec(cat, name, desc, o = {}) {
  if (o.ga) { setGA(m, S, ...o.ga); for (let i = 2 * o.ga.length; i < GA_LEN; i++) m.ram[S.GA + i] = rng.byte(); }
  const gaBefore = Array.from(m.ram.subarray(S.GA, S.GA + GA_LEN)), ocBefore = opClipBytes(m, S);
  const strBefore = m.ram.slice(STR, STR + 512), scrBefore = m.ram.slice(SCR0, 0xE000);
  const tok = poison(m, rng, { stack: false, regions: [...T1_REGIONS, [0xFE00, 0xFEFD - (o.stack ?? 32)]] });
  const probs = [];
  let r = null;
  try { r = call(m, S, name, o.regs || {}, { rng, ints: !!o.ints, guard: o.guard }); } catch (e) { probs.push(e.message); }
  if (o.model) o.model();
  const dd = displayDiff(pm);
  if (dd) probs.push(dd);
  const pz = checkPoison(m, tok);
  if (pz) probs.push(`wrote outside what it may write, or deeper in the stack than its allowance of ${o.stack ?? 32} bytes: ${hex(pz.addr)} is ${hex(pz.got, 2)}, was ${hex(pz.want, 2)} (${pz.n} bytes changed)`);
  if (strBefore.some((v, i) => m.ram[STR + i] !== v)) probs.push('T_STR changed');
  if (scrBefore.some((v, i) => m.ram[SCR0 + i] !== v)) probs.push('T_SCR changed');
  if (r) {
    if (r.sp !== 0xFF00) probs.push(`SP ${hex(r.sp)} after the call, want $FF00`);
    if (r.iff1 !== !!o.ints) probs.push(`interrupt flag ${r.iff1}, found ${!!o.ints} (the routine must not execute DI or EI)`);
    const ch = changed(r, PRESERVED);
    if (ch.length) probs.push(`not preserved: ${ch.join(', ')}`);
    if (opClipBytes(m, S).join() !== ocBefore.join()) probs.push('GOP / GLH / GCLIP changed');
    if (!o.gaUndefined && Array.from(m.ram.subarray(S.GA, S.GA + GA_LEN)).join() !== gaBefore.join()) probs.push('GA changed');
    if (o.post) probs.push(...o.post(r));
  }
  const ok = cat.record(`${desc} (call ${cat.calls + 1}; pointer at (${pm.pos.x}, ${pm.pos.y}), drawn ${pm.D ? `(${pm.D.x}, ${pm.D.y})` : 'no'}, shield ${pm.S ? JSON.stringify(pm.S) : 'none'})`, probs);
  return { ok, r };
}

// ===========================================================================================================================
// Part 0: boot
function part0() {
  const dflt = (name, ok, detail) => C.check(name, ok, detail);
  {
    // P_ARROW: 64 bytes in G_BLIT's pair format; must be a visible pointer (otherwise nothing below can fail).
    const scrA = new G.Gfx6Model(); scrA.px.fill(0);
    const scrB = new G.Gfx6Model(); scrB.px.fill(1);
    const pa = new G.PointerModel(scrA, arrow), pb = new G.PointerModel(scrB, arrow);
    pa.init(100, 50); pa.isr(); pb.init(100, 50); pb.isr();
    const drawn = pa.display().count(), onInk = (() => { const d = pb.display(); let n = 0; for (let i = 0; i < d.px.length; i++) if (!d.px[i]) n++; return n; })();
    dflt('P_ARROW (64 bytes in the cartridge) draws a visible pointer: some pixels become ink on paper and some paper on ink', drawn > 0 && onInk > 0 && drawn < 256,
      `${drawn} ink pixels on paper, ${onInk} paper pixels on ink; bytes ${Array.from(arrow.subarray(0, 8)).map((v) => v.toString(16).padStart(2, '0')).join(' ')} ...`);
    // Padding rule of the pair format for w = 16: no column to pad; mask 1 + image 1 is legal ("(old AND m) OR i") but unusual: report it.
    let odd = 0;
    for (let i = 0; i < 64; i += 2) if ((arrow[i] & arrow[i + 1]) !== 0) odd++;
    console.log(`P_ARROW: ${odd} pairs have mask and image bits both set (legal: new = (old AND m) OR i)`);
    // The hot spot is the bitmap's top-left pixel (0, 0): it should belong to the arrow (an image or an opaque-mask pixel).
    const hot = (!(arrow[0] & 0x80)) || (arrow[1] & 0x80);
    dflt('P_ARROW pixel (0, 0), the hot spot, is part of the arrow (mask 0 or image 1)', !!hot, `mask byte ${hex(arrow[0], 2)}, image byte ${hex(arrow[1], 2)}`);
  }
  {
    // Before P_INIT the pointer is off: P_ISR (direct and from the frame ISR) draws nothing.
    finishPending();
    seedDisplay(m, rng);
    const before = m.ram.slice(0x4000, 0x5800).toString() + m.ram.slice(0x6000, 0x7800).toString();
    const r = pisr();
    const same = () => m.ram.slice(0x4000, 0x5800).toString() + m.ram.slice(0x6000, 0x7800).toString() === before;
    dflt('P_ISR before P_INIT (direct call, interrupts off) writes nothing to the display and returns with interrupts off', same() && r.iff1 === false, `${r.t} T`);
    parkIdle();
    const f0 = frameCount();
    for (let f = 0; f < 4; f++) M.runFrame(m);
    dflt('the frame ISR before P_INIT (4 frames over a random display) leaves the display unchanged: the boot does not call P_INIT and the pointer stays off', same(),
      `${frameCount() - f0 + (accepted() ? 1 : 0)} interrupts`);
    finishPending();
  }
}

// ===========================================================================================================================
// Part 1: 16.6.1 random direct calls, interrupts off
const stats = { shErase: 0, shKeep: 0, shHiddenAlready: 0, isr: { none: 0, draw: 0, erase: 0, move: 0 }, hiddenSkip: 0, drawn: new Set(), moves: 0, clamped: 0, skipSteps: 0, drawSteps: 0 };

function part1() {
  const cats = {
    P_INIT: new Cat('P_INIT: display untouched, position clamped (the next P_ISR draws there), pointer on, registers / GOP / GLH / GCLIP / stack / poison as 16.3'),
    P_MOVE: new Cat('P_MOVE (positions: edge cases of 16.2, anywhere, in / out of range -> clamped): draws nothing, GA unchanged, 32 bytes of stack'),
    P_SHIELD: new Cat('P_SHIELD (boundary rectangles around the pointer, random, empty, off-screen, the whole screen): erases at once iff the byte rectangles meet; replaces the shield; GA unchanged'),
    P_UNSHIELD: new Cat('P_UNSHIELD: removes the shield, draws nothing'),
    P_ISR: new Cat('P_ISR (interrupts off): the display equals the model after every call; 16 bytes of stack; writes only the pointer\'s byte rectangles; returns with interrupts off'),
    fill: new Cat('shielded G_FILL (P_SHIELD r, G_FILL inside r, P_UNSHIELD): display = screen with the pointer, whether the pointer was hidden, erased or elsewhere'),
    textp: new Cat('shielded G_TEXTP (shield = the string\'s box, R2)'),
    text8: new Cat('shielded G_TEXT8 (shield = the cells\' rectangle)'),
    scroll: new Cat('shielded G_SCROLLV (shield = the rectangle)'),
  };
  let execs = 0, sessions = 0, firstFail = '';
  const x = (cat, name, desc, o) => { execs++; const e = exec(cat, name, desc, o); return e.ok; };

  const doInit = (px, py, cat = cats.P_INIT) => {
    zeroPtr();
    return x(cat, 'P_INIT', `P_INIT (${px}, ${py})`, { regs: { hl: w16(px), de: w16(py) }, stack: 48, gaUndefined: true, ints: rng.chance(0.2), model: () => pm.init(px, py) });
  };
  const doMove = (px, py) => {
    stats.moves++;
    const [cx, cy] = G.clampPos(px, py); if (cx !== px || cy !== py) stats.clamped++;
    return x(cats.P_MOVE, 'P_MOVE', `P_MOVE (${px}, ${py})`, { regs: { hl: w16(px), de: w16(py) }, ga: [rint(-999, 999), rint(-999, 999), rint(-999, 999), rint(-999, 999)], model: () => pm.move(px, py) });
  };
  const doShield = (rect) => {
    let meets = false, was = false;
    const ok = x(cats.P_SHIELD, 'P_SHIELD', `P_SHIELD (${rect})`, {
      ga: rect,
      model: () => {
        const S1 = G.shieldRect(...rect);
        was = !!pm.D; meets = !!pm.D && G.meets(G.pointerRect(pm.D.x, pm.D.y), S1);
        pm.shield(...rect);
      },
    });
    if (meets) stats.shErase++; else if (was) stats.shKeep++; else stats.shHiddenAlready++;
    return ok;
  };
  const doUnshield = () => x(cats.P_UNSHIELD, 'P_UNSHIELD', 'P_UNSHIELD', { ga: [rint(-99, 99), rint(-99, 99), rint(-99, 99), rint(-99, 99)], model: () => pm.unshield() });
  const doIsr = () => {
    const skipped = pm.calls === 0;
    let did = 'none';
    const vis = pm.visible();
    const ok = x(cats.P_ISR, 'P_ISR', 'P_ISR', { stack: 16, ga: [rint(-99, 99), rint(-99, 99), rint(-99, 99), rint(-99, 99)], model: () => { did = pm.isr(); }, post: (r) => (r.iff1 ? ['returned with interrupts on'] : []) });
    stats.isr[did]++;
    if (!vis && pm.on) stats.hiddenSkip++;
    if (skipped) stats.skipSteps++;
    if (pm.D) stats.drawn.add(`${pm.D.x},${pm.D.y}`);
    return ok;
  };

  /** Shielded drawing: P_SHIELD rect; the drawing routine inside; P_UNSHIELD. */
  const doDraw = () => {
    const near = pm.D || pm.pos, k = rng.next();
    const kind = k < 0.40 ? 'fill' : k < 0.62 ? 'textp' : k < 0.78 ? 'scroll' : 'text8';
    setOp(rint(0, 2));
    if (rng.chance(0.15)) { const g = rint(6, 14); m.ram[S.GLH] = g; scr.setGlh(g); }
    if (rng.chance(0.25)) { const c = rng.chance(0.5) ? [0, 0, 512, 192] : [near.x + rint(-30, 6), near.y + rint(-20, 6), rint(0, 120), rint(0, 60)]; setClip(...c); }
    if (kind === 'fill' || kind === 'scroll') {
      const big = rng.chance(0.03);
      let r;
      if (rng.chance(0.6)) r = rectNear(G.pointerRect(near.x, near.y)); else r = [near.x + rint(-80, 20), near.y + rint(-40, 10), rint(1, 140), rint(1, 50)];
      if (big) r = [rint(-5, 5), rint(-5, 5), rint(500, 520), rint(185, 200)];
      if (!doShield(r)) return false;
      if (kind === 'fill') {
        if (!x(cats.fill, 'G_FILL', `G_FILL (${r}) op ${scr.op}`, { ga: r, model: () => scr.fill(...r) })) return false;
        cats.fill.record('', []); cats.fill.calls--;
      } else {
        const n = rng.pick([0, 1, -1, 2, 7, -8, rint(-20, 20), 40, -200]);
        if (!x(cats.scroll, 'G_SCROLLV', `G_SCROLLV (${r}) n ${n}`, { ga: [...r, n], model: () => scr.scrollv(...r, n) })) return false;
      }
      return doUnshield();
    }
    if (kind === 'textp') {
      const len = rint(1, 22), bytes = Array.from({ length: len }, () => (rng.chance(0.06) ? 13 : rng.chance(0.03) ? rint(0, 255) : rint(32, 126)));
      for (let i = 0; i < len; i++) m.ram[STR + i] = bytes[i];
      const tx = near.x + rint(-60, 10), ty = near.y + rint(-14, 8);
      const probe = new G.Gfx6Model(); probe.setGlh(scr.glh); probe.textp(tx, ty, bytes);
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < probe.px.length; i++) if (probe.px[i]) { const px = i % 512, py = (i / 512) | 0; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      const lines = bytes.filter((c) => c === 13).length + 1, width = scr.textw(bytes);
      let bx0 = tx, by0 = ty, bx1 = tx + width, by1 = ty + 8 + (lines - 1) * scr.glh;
      if (x1 >= 0) { bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1 + 1); by1 = Math.max(by1, y1 + 1); }
      const r = [bx0, by0, bx1 - bx0, by1 - by0];
      if (!doShield(r)) return false;
      if (!x(cats.textp, 'G_TEXTP', `G_TEXTP (${tx}, ${ty}) ${len} codes op ${scr.op}`, { ga: [tx, ty, STR, len], model: () => scr.textp(tx, ty, bytes) })) return false;
      return doUnshield();
    }
    // text8
    const len = rint(1, 20), bytes = Array.from({ length: len }, () => rint(32, 126)), col = (near.x >> 3) + rint(-5, 1), row = (near.y >> 3) + rint(-1, 1);
    for (let i = 0; i < len; i++) m.ram[STR + i] = bytes[i];
    const r = [8 * col, 8 * row, 8 * len, 8];
    if (!doShield(r)) return false;
    if (!x(cats.text8, 'G_TEXT8', `G_TEXT8 (${col}, ${row}) ${len} chars op ${scr.op}`, { ga: [col, row, STR, len], model: () => scr.text8(col, row, bytes) })) return false;
    return doUnshield();
  };

  const edgeQ = { q: [] };
  const startSession = (sweep) => {
    sessions++;
    freshState({ glh: rng.chance(0.3) ? rint(6, 14) : 8 });
    const sx = sessions === 1 ? [XE[0], YE[0]] : [rint(-20, 531), rint(-20, 211)];
    // P_INIT is exercised with random / out-of-range positions; the first session also uses the corners
    if (!doInit(...sx)) return false;
    if (!pm.on || pm.D !== null) return false;
    if (!doIsr()) return false;                     // the first P_ISR draws it
    if (sweep) {                                    // every edge position of 16.2 is drawn at least once
      for (const [ex, ey] of edgePairs()) { if (!doMove(ex, ey) || !doIsr()) return false; if (rng.chance(0.25) && !doDraw()) return false; }
    }
    return true;
  };
  let target = STEPS;
  while (execs < target) {
    const before = execs;
    if (!startSession(sessions === 0)) { if (!firstFail) firstFail = Object.values(cats).map((c) => c.first).find(Boolean) || ''; continue; }
    const budget = sessions === 1 ? Math.max(500, STEPS / 6) : 500;
    let ok = true;
    while (ok && execs - before < budget && execs < target) {
      const r = rng.next();
      if (r < 0.28) ok = doMove(...randPos(pm, edgeQ));
      else if (r < 0.42) ok = doShield(randShield(pm));
      else if (r < 0.50) ok = doUnshield();
      else if (r < 0.70) ok = doIsr();
      else if (r < 0.78) {                                                                // erase only: move under a shield that the drawn pointer does not meet
        if (pm.S && pm.D) { const [qx, qy] = underShield(pm); ok = doMove(qx, qy) && doIsr(); } else ok = doShield(randShield(pm));
      } else ok = doDraw();
      if (ok && rng.chance(0.2) && pm.calls > 0 && r < 0.28) ok = doIsr();        // moves are often followed by the ISR, as in frames
    }
    if (!ok) target += 100;                      // keep the step count meaningful after an aborted session (a failure is already recorded)
    if (sessions > 400) break;
  }
  // P_INIT with clamped positions: its own small run (edge, out-of-range, negative, huge), each followed by P_ISR.
  const initPos = [[0, 0], [511, 191], [-1, -1], [512, 192], [65535 - 65536, 100], [300, -16384], [16383, 16383], [-16384, 16383], [7, 183], [504, 185], [496, 176], [300, 300]];
  for (const [ix, iy] of initPos) {
    freshState();
    if (!doInit(ix, iy) || !doIsr() || !doMove(ix + 3, iy + 5) || !doIsr()) break;
  }
  for (const c of Object.values(cats)) c.report();
  const ds = stats.drawn;
  const missing = [];
  for (const ex of XE) for (const ey of YE) if (!ds.has(`${ex},${ey}`)) missing.push(`(${ex},${ey})`);
  C.check('coverage: the pointer was drawn at every one of the 48 edge positions of 16.2 (x in {0, 7, 8, 495, 496, 503, 504, 511} x y in {0, 7, 8, 176, 177, 191})', missing.length === 0, missing.length ? `never drawn at ${missing.join(' ')}` : `${ds.size} distinct drawn positions`);
  C.check(`coverage: P_SHIELD erased the pointer ${stats.shErase} times, left a drawn pointer alone ${stats.shKeep} times, met a hidden one ${stats.shHiddenAlready} times; P_ISR drew ${stats.isr.draw}, erased ${stats.isr.erase}, moved ${stats.isr.move}, did nothing ${stats.isr.none} times (${stats.hiddenSkip} with the pointer hidden by the shield, ${stats.skipSteps} with no call since the last P_ISR)`,
    stats.shErase >= 40 && stats.shKeep >= 40 && stats.isr.draw >= 40 && stats.isr.erase >= 15 && stats.isr.move >= 100 && stats.isr.none >= 40 && stats.hiddenSkip >= 10,
    `${execs} checked calls in ${sessions} runs, ${stats.moves} P_MOVE (${stats.clamped} out of range)`);
  console.log(`part 1: ${execs} checked calls in ${sessions} runs`);
}

// ===========================================================================================================================
// Part 2: 16.6.2 interrupt injection at every instruction boundary
const REG8 = ALL_REGS;
/**
 * Run a sequence of calls with interrupts on; the frame interrupt is raised before instruction number k of the whole sequence
 * (k < 0: never), and run on until it returns.  seq: [{ name, regs, ga (words) }].  Returns { steps, error }.
 */
function runSeq(seq, k) {
  let g = 0, injected = false;
  for (const c of seq) {
    if (c.ga) setGA(m, S, ...c.ga);
    for (const r of REG8) cpu[r] = rng.byte();
    for (const [r, v] of Object.entries(c.regs || {})) { if (r === 'hl') { cpu.h = (v >> 8) & 0xFF; cpu.l = v & 0xFF; } else if (r === 'de') { cpu.d = (v >> 8) & 0xFF; cpu.e = v & 0xFF; } else cpu[r] = v; }
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true;
    cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8;
    cpu.pc = S[c.name];
    let guard = 0;
    while (cpu.pc !== S.T_RET) {
      if (g === k && !injected) {
        injected = true;
        const pc0 = cpu.pc, sp0 = cpu.sp, t = Z.irqZ80(cpu, m.bus);
        if (!t) return { steps: g, error: `the interrupt was refused at instruction ${k} (PC ${hex(pc0)}): interrupts were off inside ${c.name}` };
        m.tstates += t;
        let gg = 0;
        while (!(cpu.pc === pc0 && cpu.sp === sp0)) { step1(); if (++gg > 200000) return { steps: g, error: `the frame ISR did not return (PC ${hex(cpu.pc)}) after being raised at instruction ${k}` }; }
      }
      step1(); g++;
      if (++guard > 2_000_000) return { steps: g, error: `${c.name} did not return (PC ${hex(cpu.pc)})` };
    }
  }
  return { steps: g, error: null };
}

function part2() {
  const GUARD_REGION = [0xFE00, 0xFEB7];                                          // below the routine's 32 + the ISR's 32 bytes + the call
  const injCats = {};
  const cat = (name) => injCats[name] || (injCats[name] = new Cat(name));
  let trials = 0, scenarios = 0, boundaries = 0, setupFails = 0;
  const gaOf = () => Array.from(m.ram.subarray(S.GA, S.GA + GA_LEN)).join();

  /** Build the starting state of a scenario (R3): pointer drawn at A, optional shield (which A does not meet), P_MOVE to B pending. */
  function setup(sc) {
    freshState();
    if (sc.op !== undefined) setOp(sc.op);
    direct('P_INIT', { hl: w16(sc.A[0]), de: w16(sc.A[1]) }); pm.init(...sc.A);
    pisr(); pm.isr();
    if (sc.shield0) { pshield(...sc.shield0); pm.shield(...sc.shield0); }
    pmove(...sc.B); pm.move(...sc.B);
    const dd = displayDiff(pm);
    return dd ? `starting state differs from the model: ${dd}` : null;
  }

  function runScenario(label, sc) {
    scenarios++;
    const c = cat(label);
    const bad = setup(sc);
    if (bad) { setupFails++; c.record(`${label} A ${sc.A} B ${sc.B}`, [bad]); return; }
    for (let i = GUARD_REGION[0]; i <= GUARD_REGION[1]; i++) m.ram[i] = rng.byte();
    const snapRam = m.ram.slice(), snapCpu = { ...cpu }, snapT = m.tstates;
    const guardCopy = m.ram.slice(GUARD_REGION[0], GUARD_REGION[1] + 1);
    const restore = () => { m.ram.set(snapRam); Object.assign(cpu, snapCpu); m.tstates = snapT; };
    // what the model says: the sequence, then P_ISR
    const pe = pm.clone();
    for (const s of sc.seq) s.model(pe);
    pe.isr();
    const want = pe.displayBytes();
    // baseline: the same sequence with no interrupt, then P_ISR, must already match (else the failure is not about interrupts)
    const base = runSeq(sc.seq, -1);
    const gaBase = gaOf(), ocBase = opClipBytes(m, S).join();
    pisr();
    const d0 = G.compareBytes(m.ram, want);
    const desc = `${label}: A (${sc.A}) B (${sc.B})${sc.rect ? ` rect (${sc.rect})` : ''}${sc.C ? ` C (${sc.C})` : ''}${sc.op !== undefined ? ` op ${sc.op}` : ''}`;
    if (base.error || d0) { c.record(`${desc} WITHOUT an interrupt`, [base.error || `no interrupt: display byte at ${hex(d0.addr)} = ${hex(d0.got, 2)}, model ${hex(d0.want, 2)} (the routine itself is wrong before any interrupt)`]); return; }
    const n = base.steps;
    boundaries += Math.ceil(n / STRIDE);
    for (let k = 0; k < n; k += STRIDE) {
      restore();
      const f0 = frameCount();
      const probs = [];
      const res = runSeq(sc.seq, k);
      if (res.error) probs.push(res.error);
      else {
        if (frameCount() - f0 !== 1) probs.push(`V_FRAMES rose by ${(frameCount() - f0) & 0xFFFF}, want 1`);
        if (gaOf() !== gaBase) probs.push('GA differs from the run without an interrupt (the ISR changed it)');
        if (opClipBytes(m, S).join() !== ocBase) probs.push('GOP / GLH / GCLIP differ from the run without an interrupt');
        for (let i = 0; i < guardCopy.length; i++) if (m.ram[GUARD_REGION[0] + i] !== guardCopy[i]) { probs.push(`stack write below the allowance at ${hex(GUARD_REGION[0] + i)}`); break; }
        pisr();
        const d = G.compareBytes(m.ram, want);
        if (d) { const b = byteAt(d.addr); probs.push(`display byte (column ${b.bc}, row ${b.y}) = ${hex(d.got, 2)}, model ${hex(d.want, 2)}`); }
        else {
          const snap2 = m.ram.slice(0x4000, 0x7800).toString();
          pisr();
          if (m.ram.slice(0x4000, 0x7800).toString() !== snap2) probs.push('a second P_ISR changed the display (the state after the first was not settled)');
        }
      }
      trials++;
      c.record(`${desc}, interrupt before instruction ${k} of ${n}`, probs);
      if (c.bad >= 3) break;
    }
  }

  // ---- scenario generators -------------------------------------------------------------------------------------------------
  const posPair = (i) => {                                       // A, B covering both byte-column parities and every px AND 7
    const k = rng.next();
    if (k < 0.35) { const e = edgePairs(); return [e[0], e[1]]; }
    return [[rint(0, 511), rint(0, 191)], [rint(0, 511), rint(0, 191)]];
  };
  const wantRect = (A, B, wantA, wantB, w, h, tries = 5000) => {      // a w x h rectangle whose byte rectangle meets A's pointer iff wantA, B's iff wantB
    const RA = G.pointerRect(...A), RB = G.pointerRect(...B);
    for (let t = 0; t < tries; t++) {
      const near = rng.chance(0.5) ? RA : RB;
      let r;
      if (w === 0) r = rectNear(near); else r = [8 * near.c0 + rint(-40, 40), near.y0 + rint(-24, 24), w, h];
      const s = G.shieldRect(...r);
      if (s && G.meets(RA, s) === wantA && G.meets(RB, s) === wantB) return r;
    }
    return null;
  };

  // P_MOVE
  for (let i = 0; i < 12 * REPS; i++) {
    const [A, B] = posPair(i);
    const Cs = [B, A, [rint(0, 511), rint(0, 191)], [B[0] + rint(-9, 9), B[1] + rint(-9, 9)], [-3, 300]];
    const Cm = Cs[i % Cs.length];
    runScenario('P_MOVE', { A, B, C: Cm, seq: [{ name: 'P_MOVE', regs: { hl: w16(Cm[0]), de: w16(Cm[1]) }, model: (p) => p.move(...Cm) }] });
  }
  // P_SHIELD: the four combinations of "meets the drawn pointer (A)" x "meets the pending position (B)"
  for (const [mA, mB] of [[1, 1], [1, 0], [0, 1], [0, 0]]) for (let i = 0; i < REPS; i++) {
    let A, B, r = null;
    for (let t = 0; t < 50 && !r; t++) { [A, B] = posPair(i); r = wantRect(A, B, !!mA, !!mB, 0); }
    if (!r) continue;
    runScenario(`P_SHIELD (meets A ${mA}, meets B ${mB})`, { A, B, rect: r, seq: [{ name: 'P_SHIELD', ga: r, model: (p) => p.shield(...r) }] });
  }
  // P_UNSHIELD: a shield that A does not meet is set; B (pending) meets it or not
  for (const mB of [1, 0]) for (let i = 0; i < REPS * 2; i++) {
    let A, B, r = null;
    for (let t = 0; t < 50 && !r; t++) { [A, B] = posPair(i); r = wantRect(A, B, false, !!mB, 0); }
    if (!r) continue;
    runScenario(`P_UNSHIELD (shield held; B meets it ${mB})`, { A, B, shield0: r, rect: r, seq: [{ name: 'P_UNSHIELD', model: (p) => p.unshield() }] });
  }
  // shielded G_FILL 32 x 16: P_SHIELD r, G_FILL r, P_UNSHIELD, all of it interrupted at every boundary
  for (const [mA, mB] of [[1, 1], [1, 0], [0, 1], [0, 0]]) for (let i = 0; i < REPS; i++) {
    let A, B, r = null;
    for (let t = 0; t < 50 && !r; t++) { [A, B] = posPair(i); r = wantRect(A, B, !!mA, !!mB, 32, 16); }
    if (!r) continue;
    const op = (i + mA + 2 * mB) % 3;
    runScenario(`shielded G_FILL 32 x 16 (meets A ${mA}, meets B ${mB})`, { A, B, rect: r, op, seq: [
      { name: 'P_SHIELD', ga: r, model: (p) => p.shield(...r) },
      { name: 'G_FILL', ga: r, model: (p) => p.scr.fill(...r) },
      { name: 'P_UNSHIELD', model: (p) => p.unshield() },
    ] });
  }
  for (const c of Object.values(injCats)) c.report();
  C.check(`injection ran: ${scenarios} scenarios, ${fmt(boundaries)} instruction boundaries, ${fmt(trials)} interrupted runs, every one followed by one P_ISR and compared with the model`, scenarios >= 20 && trials > 0 && setupFails === 0,
    setupFails ? `${setupFails} scenario setups differed from the model` : `${Object.keys(injCats).length} cases, stride ${STRIDE}`);
}

// ===========================================================================================================================
// Part 3: 16.6.3 the flicker test
/** Script / background operations.  op: { k, ... }; opCmd -> { name, regs, ga }; applyModel applies the drawing part to a PointerModel's screen. */
function opCmd(op) {
  switch (op.k) {
    case 'op': return { name: 'G_SETOP', regs: { a: op.v } };
    case 'fill': return { name: 'G_FILL', ga: op.r };
    case 'text8': return { name: 'G_TEXT8', ga: [op.col, op.row, op.addr, op.bytes.length] };
    case 'textp': return { name: 'G_TEXTP', ga: [op.x, op.y, op.addr, op.bytes.length] };
    case 'scroll': return { name: 'G_SCROLLV', ga: [...op.r, op.n] };
    case 'cls': return { name: 'G_CLS' };
    case 'move': return { name: 'P_MOVE', regs: { hl: w16(op.x), de: w16(op.y) } };
    case 'shield': return { name: 'P_SHIELD', ga: op.r };
    case 'unshield': return { name: 'P_UNSHIELD' };
    case 'wait': return { name: 'T_WAIT' };
    default: throw new Error(`unknown op ${op.k}`);
  }
}
/** The drawing ops' effect on the model screen, the moves' on the position; shields and waits have none here (the batch ends unshielded). */
function applyOp(p, op) {
  const sc = p.scr;
  switch (op.k) {
    case 'op': sc.setOp(op.v); break;
    case 'fill': sc.fill(...op.r); break;
    case 'text8': sc.text8(op.col, op.row, op.bytes); break;
    case 'textp': sc.textp(op.x, op.y, op.bytes); break;
    case 'scroll': sc.scrollv(...op.r, op.n); break;
    case 'cls': sc.cls(); break;
    case 'move': { const [cx, cy] = G.clampPos(op.x, op.y); p.pos = { x: cx, y: cy }; break; }
    default: break;
  }
}
/** Execute an op by a direct call (setup of the background, no pointer on yet or pointer shielded by the caller). */
function runDirect(op) {
  const c = opCmd(op);
  if (c.ga) setGA(m, S, ...c.ga);
  call(m, S, c.name, c.regs || {}, { rng });
}

// Strings in T_STR ($D000-$D1FF): every string the flicker test's ops use is put there once (allocStr), so ops carry an address.
let strTop = 0;
const bgStr = [], batchStr = [];
function allocStr(bytes) {
  if (strTop + bytes.length > 512) throw new Error('T_STR is full');
  const addr = STR + strTop;
  for (let i = 0; i < bytes.length; i++) m.ram[addr + i] = bytes[i];
  strTop += bytes.length;
  return { addr, bytes: bytes.slice() };
}
const codes = (str) => Array.from(str, (c) => c.charCodeAt(0));
function layoutStrings() {
  strTop = 0; bgStr.length = 0; batchStr.length = 0;
  const words = 'the quick brown fox jumps over the lazy dog menu file edit view special window Mode 6 gives the desktop 512 pixels across'.split(' ');
  const mk = (n) => { let s = ''; while (s.length < n) s += words[rint(0, words.length - 1)] + ' '; return codes(s.slice(0, n)); };
  for (let i = 0; i < 3; i++) { const b = mk(rint(28, 44)); b.splice(rint(10, 20), 0, 13); bgStr.push(allocStr(b)); }
  bgStr.t8 = [allocStr(codes('Mode 6 desktop: the pointer test')), allocStr(codes('XOR rectangles and text')), allocStr(codes('inverted text over rectangles'))];
  for (let i = 0; i < 4; i++) batchStr.push(allocStr(mk(rint(20, 62))));
}
/** The background: fills in SET and XOR, 8x8 text lines, proportional text. */
function backgroundOps() {
  const t8 = (col, row, k) => ({ k: 'text8', col, row, addr: bgStr.t8[k].addr, bytes: bgStr.t8[k].bytes });
  return [
    { k: 'op', v: 0 }, { k: 'fill', r: [20, 30, 210, 70] }, { k: 'fill', r: [300, 10, 180, 160] }, { k: 'fill', r: [0, 170, 512, 22] },
    { k: 'op', v: 2 }, { k: 'fill', r: [100, 50, 190, 110] }, { k: 'fill', r: [250, 80, 90, 40] }, { k: 'fill', r: [33, 5, 301, 9] },
    { k: 'op', v: 0 }, t8(2, 1, 0), t8(30, 14, 1),
    { k: 'op', v: 2 }, t8(4, 10, 2),
    { k: 'op', v: 0 }, { k: 'textp', x: 24, y: 120, addr: bgStr[0].addr, bytes: bgStr[0].bytes }, { k: 'textp', x: 270, y: 24, addr: bgStr[1].addr, bytes: bgStr[1].bytes },
    { k: 'op', v: 2 }, { k: 'textp', x: 100, y: 150, addr: bgStr[2].addr, bytes: bgStr[2].bytes },
    { k: 'op', v: 0 },
  ];
}

function part3() {
  const failures = [];
  const fail = (what) => { if (failures.length < 8) failures.push(what); };

  // ---- setup ---------------------------------------------------------------------------------------------------------------
  finishPending();
  zeroPtr(); seedDisplay(m, rng); direct('G_INIT'); m.ram[S.GLH] = 8;
  for (const [a, b] of [[0x4000, 0x5800], [0x6000, 0x7800]]) m.ram.fill(0, a, b);       // a white screen, then the background
  layoutStrings();
  resetModel(); scr.setGlh(8);
  const bg = backgroundOps();
  for (const op of bg) { runDirect(op); applyOp(pm, op); }
  pinit(256, 96); pm.init(256, 96);
  {
    const d = displayDiff(pm);
    if (d) { C.check('flicker test setup: background drawn by direct calls equals the model', false, d); return; }
  }
  settle();                                                                              // two settling frames; the 2nd one's ISR drew the pointer
  if (!accepted()) { C.check('flicker test: the frame interrupt after the settling frames is pending (not lost)', false, `PC ${hex(cpu.pc)}`); return; }
  pm.isr();
  {
    const d = displayDiff(pm);
    if (d) { C.check('flicker test: after the settling frames the display equals the model (pointer at (256, 96))', false, d); return; }
  }

  // ---- the path ------------------------------------------------------------------------------------------------------------
  const path = [];
  const push = (x, y, call = true) => path.push({ x, y, call });
  let cx = 256, cy = 96;
  const corners = [[0, 0], [511, 0], [0, 191], [511, 191], [504, 185], [495, 176], [496, 177], [7, 8], [8, 7]];
  while (path.length < FRAMES + 60) {
    const r = rng.next();
    if (r < 0.38) {                                                                    // a straight run at 1..24 pixels a frame
      let vx = 0, vy = 0;
      while (Math.max(Math.abs(vx), Math.abs(vy)) < 1) { vx = rint(-24, 24); vy = rint(-24, 24); }
      if (rng.chance(0.3)) { cx = rint(0, 511); cy = rint(0, 191); }
      for (let i = rint(8, 40); i > 0; i--) { cx += vx; cy += vy; if (cx < -60 || cx > 570 || cy < -60 || cy > 250) break; push(cx, cy); }
    } else if (r < 0.52) {                                                             // stops (the skip): sometimes a P_MOVE to the same place
      for (let i = rint(2, 6); i > 0; i--) push(cx, cy, rng.chance(0.5));
    } else if (r < 0.74) {                                                             // jumps to the edge positions of 16.2
      const [ex, ey] = rng.pick(edgePairs()); cx = ex; cy = ey; push(cx, cy);
      for (let i = rint(0, 2); i > 0; i--) push(cx, cy, rng.chance(0.5));
    } else if (r < 0.82) { const [ex, ey] = rng.pick(corners); cx = ex; cy = ey; push(cx, cy); }
    else if (r < 0.90) { const y = rint(0, 175); for (let i = 0; i < 16; i++) { cx = 64 + i; cy = y; push(cx, cy); } }   // both parities of c0 x every px AND 7
    else { for (let i = rint(6, 14); i > 0; i--) { cx = Math.max(0, Math.min(511, cx + rint(-1, 1))); cy = Math.max(0, Math.min(191, cy + rint(-1, 1))); push(cx, cy); } }
  }
  // shield windows: held over several frames, some on the path, some off it; one action a frame
  const shieldAt = new Map(), unshieldAt = new Set();
  for (let f = rint(3, 12); f < FRAMES - 25;) {
    const len = rint(3, 18), kindv = rng.next();
    let tx, ty;
    if (kindv < 0.35) { const p = G.clampPos(path[Math.max(f - 1, 0)].x, path[Math.max(f - 1, 0)].y); tx = p[0]; ty = p[1]; }            // meets the pointer drawn at f
    else if (kindv < 0.70) { const p = G.clampPos(path[f + rint(0, len)].x, path[f + rint(0, len)].y); tx = p[0]; ty = p[1]; }          // the path comes through
    else { tx = rint(0, 511); ty = rint(0, 191); }
    const r = rng.chance(0.5) ? rectFromBytes(tx / 8 | 0, (tx / 8 | 0) + rint(0, 8), Math.max(0, ty - rint(0, 8)), ty + rint(0, 40)) : [tx - rint(0, 30), ty - rint(0, 20), rint(8, 100), rint(4, 50)];
    shieldAt.set(f, r);
    if (rng.chance(0.25) && len > 6) shieldAt.set(f + (len >> 1), [r[0] + rint(-20, 20), r[1] + rint(-10, 10), rint(4, 90), rint(4, 40)]);   // replaced while held
    unshieldAt.add(f + len);
    f += len + rint(1, 14);
  }

  // ---- batches ---------------------------------------------------------------------------------------------------------------
  const rsh = () => {
    const near = pm.D || pm.pos;
    return rng.chance(0.5) ? rectNear(G.pointerRect(near.x, near.y)) : [rint(0, 380), rint(0, 120), rint(40, 200), rint(16, 70)];
  };
  /** A batch of shielded drawing with moves and waits (16.6.3); `kind` = 'cls' makes the once-only G_CLS plus a redrawn background. */
  function makeBatch(kind) {
    const ops = [], at = () => { const p = G.clampPos(rint(-8, 520), rint(-8, 200)); return p; };
    const move = (x, y) => ops.push({ k: 'move', x, y });
    const inside = (r) => [r[0] + rint(0, Math.max(0, r[2] - 1)), r[1] + rint(0, Math.max(0, r[3] - 1))];
    if (kind === 'cls') {
      ops.push({ k: 'move', x: rint(0, 511), y: rint(0, 191) });
      ops.push({ k: 'shield', r: [0, 0, 512, 192] }, { k: 'cls' }, { k: 'wait' });
      move(...at()); ops.push({ k: 'wait' });
      for (const op of backgroundOps()) { ops.push(op); if (rng.chance(0.15)) move(...at()); if (rng.chance(0.1)) ops.push({ k: 'wait' }); }
      ops.push({ k: 'unshield' }, { k: 'wait' }, { k: 'move', x: rint(0, 511), y: rint(0, 191) });
      return ops;
    }
    const nDraw = rint(3, 6);
    const scrollAt = rint(0, nDraw - 1);
    for (let i = 0; i < nDraw; i++) {
      let r;
      const what = i === scrollAt ? 'scroll' : rng.pick(['fill', 'fill', 'textp', 'text8']);
      move(...at());
      if (what === 'scroll') r = [rint(0, 200) & ~7, rint(0, 90), 256 + 8 * rint(0, 8), 96 + rint(0, 40)];
      else if (what === 'fill') r = rng.chance(0.5) ? rsh() : [rint(0, 300), rint(0, 100), rint(60, 300), rint(24, 90)];
      let sr = r;
      let draw;
      if (what === 'textp') {
        const s = rng.pick(batchStr), x = rint(0, 300), y = rint(0, 170);
        const probe = new G.Gfx6Model(); probe.setGlh(scr.glh); probe.textp(x, y, s.bytes);
        let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
        for (let j = 0; j < probe.px.length; j++) if (probe.px[j]) { const px = j % 512, py = (j / 512) | 0; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
        const lines = s.bytes.filter((c) => c === 13).length + 1, w = scr.textw(s.bytes);
        let bx0 = x, by0 = y, bx1 = x + w, by1 = y + 8 + (lines - 1) * scr.glh;
        if (x1 >= 0) { bx0 = Math.min(bx0, x0); by0 = Math.min(by0, y0); bx1 = Math.max(bx1, x1 + 1); by1 = Math.max(by1, y1 + 1); }
        sr = [bx0, by0, bx1 - bx0, by1 - by0];
        draw = { k: 'textp', x, y, addr: s.addr, bytes: s.bytes };
      } else if (what === 'text8') {
        const col = rint(0, 40), row = rint(0, 21), st = rng.pick(batchStr), b2 = st.bytes.slice(0, rint(4, Math.min(22, st.bytes.length)));
        sr = [8 * col, 8 * row, 8 * b2.length, 8];
        draw = { k: 'text8', col, row, addr: st.addr, bytes: b2 };
      } else if (what === 'fill') draw = { k: 'fill', r };
      else draw = { k: 'scroll', r, n: rng.pick([1, -1, 3, -3, 8, -8, 10, 25, -40]) };
      ops.push({ k: 'op', v: rint(0, 2) });
      ops.push({ k: 'shield', r: sr });
      if (rng.chance(0.6)) { const p = inside(sr); move(p[0], p[1]); }                        // the pointer moves under the shield
      ops.push(draw);
      if (rng.chance(0.5)) { move(...at()); ops.push({ k: 'wait' }); if (rng.chance(0.5)) { const p = inside(sr); move(p[0], p[1]); } }
      ops.push({ k: 'unshield' });
      if (rng.chance(0.4)) { move(...at()); ops.push({ k: 'wait' }); }
    }
    return ops;
  }

  /** Run a batch by T_SCRIPT with interrupts on.  Precondition: the strict step 1 of this iteration is done (model P_ISR applied). */
  function runBatch(ops, label, stat) {
    if (ops.length > 130) throw new Error(`batch of ${ops.length} commands exceeds T_SCR`);
    // commands
    ops.forEach((op, i) => {
      const c = opCmd(op), a = SCR0 + 26 * i;
      m.ram.fill(0, a, a + 26);
      m.ram[a] = S[c.name] & 0xFF; m.ram[a + 1] = S[c.name] >> 8;
      const regs = c.regs || {};
      const set16 = (o, v) => { m.ram[a + o] = v & 0xFF; m.ram[a + o + 1] = (v >> 8) & 0xFF; };
      if (regs.hl !== undefined) set16(2, regs.hl);
      if (regs.de !== undefined) set16(4, regs.de);
      if (regs.bc !== undefined) set16(6, regs.bc);
      if (regs.a !== undefined) m.ram[a + 8] = regs.a;
      (c.ga || []).forEach((v, j) => set16(10 + 2 * j, v));
    });
    m.ram.fill(0, SCR0 + 26 * ops.length, SCR0 + 26 * ops.length + 26);
    // the volatile area: shield byte rectangles and the pointer's byte rectangles at every position before and during the batch
    const rects = [...pm.rects()];
    for (const op of ops) {
      if (op.k === 'shield') rects.push(G.shieldRect(...op.r));
      if (op.k === 'move') { const [px, py] = G.clampPos(op.x, op.y); rects.push(G.pointerRect(px, py)); }
    }
    const vol = G.rectUnion(rects), pre = pm.scr.px.slice();
    // the model after the batch: screen drawn into, last position, no shield, drawn state unknown (R5)
    for (const op of ops) applyOp(pm, op);
    pm.S = null; pm.unknown();
    m.ram[S.V_SCRN] = 0; m.ram[S.V_SCRN + 1] = 0;
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false; cpu.sp = 0xFF00; cpu.pc = S.T_SCRIPT;
    const vS = frameCount();
    let f = 0, done = false, outside = 0, firstBad = '';
    while (f < 400) {
      M.runFrame(m); f++;
      const got = frameCount() + (accepted() ? 1 : 0) - vS;
      if (got !== f) { fail(`${label}: after batch frame ${f} the interrupt count (V_FRAMES + pending) rose by ${got}, want ${f} (a frame interrupt was lost)`); stat.lost++; }
      for (let y = 0; y < 192 && !firstBad; y++) for (let bc = 0; bc < 64; bc++) {
        if (vol[y * 64 + bc]) continue;
        for (let j = 0; j < 8; j++) {
          const xx = bc * 8 + j, want = pre[y * 512 + xx] ? 0 : 7, have = screenPixel(m, xx, y) & 7;
          if (have !== want) { outside++; if (!firstBad) firstBad = `batch frame ${f}: pixel (${xx}, ${y}) outside the volatile area shows ${have}, model ${want}`; }
        }
      }
      stat.frames++;
      if (rd16(m, S.V_SCRN) === ops.length) { done = true; break; }
    }
    if (outside) { fail(`${label}: ${outside} pixels outside the volatile area differ in batch frames: ${firstBad}`); stat.outsideBad += outside; }
    if (!done) { fail(`${label}: the script did not finish in ${f} frames (V_SCRN ${rd16(m, S.V_SCRN)} of ${ops.length})`); return false; }
    stat.batches++; stat.commands += ops.length;
    return true;
  }

  // ---- the strict frames ---------------------------------------------------------------------------------------------------
  const st = { strict: 0, frames: 0, batches: 0, commands: 0, lost: 0, outsideBad: 0 };
  const isrT = [], isrTSkip = [], offs = [];
  let maxOff = 0, maxOff2 = 0, mismatches = 0, vErr = 0, deadlineErr = 0, stackErr = 0, firstMismatch = '';
  let clsDone = false, aborted = false;
  const frameRender = (label) => {
    const want = pm.display(), px = want.px;
    let bad = 0, first = '';
    for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) {
      const w = px[y * 512 + x] ? 0 : 7, h = screenPixel(m, x, y) & 7;
      if (h !== w) { bad++; if (!first) first = `pixel (${x}, ${y}) shows ${h}, model ${w}`; }
    }
    if (bad) { mismatches++; if (!firstMismatch) firstMismatch = `${label}: ${bad} pixels differ, first ${first}; pointer at (${pm.pos.x}, ${pm.pos.y}), drawn ${pm.D ? `(${pm.D.x}, ${pm.D.y})` : 'no'}, shield ${pm.S ? JSON.stringify(pm.S) : 'none'}`; }
    return bad === 0;
  };

  let i = 0, stage = 0;
  const strictFrame = () => {
    // 1. the pending frame interrupt, stepped to its RET
    if (!accepted()) { fail(`strict frame ${i}: the frame interrupt of the previous frame is not pending (lost)`); return false; }
    for (let a = 0xFE00; a <= 0xFEDF; a++) m.ram[a] = rng.byte();
    const guard = m.ram.slice(0xFE00, 0xFEE0), v0 = frameCount(), wasSkip = pm.calls === 0 && pm.D !== null && pm.visible() && pm.D.x === pm.pos.x && pm.D.y === pm.pos.y;
    const r = runIsr();
    if (frameCount() !== ((v0 + 1) & 0xFFFF)) { vErr++; fail(`strict frame ${i}: V_FRAMES rose by ${(frameCount() - v0) & 0xFFFF}, want 1`); }
    if (guard.some((v, k) => m.ram[0xFE00 + k] !== v)) { stackErr++; fail(`strict frame ${i}: the frame ISR wrote below its 32-byte frame ($FEE0-$FEFF)`); }
    isrT.push(r.t); if (wasSkip) isrTSkip.push(r.t);
    offs.push(r.offIsrp); if (r.offIsrp > maxOff) maxOff = r.offIsrp;
    if (r.offIsrp < 0) fail(`strict frame ${i}: the ISR never reached T_ISRP`);
    pm.isr();
    return true;
  };
  // R4: one P_MOVE and at most one P_SHIELD / P_UNSHIELD a frame, in a random order.  The ISR's erase + draw can take 7,000 T, so a
  // shield action that would not end before row 0 of the beam (the harness check, offset < 8,960) is carried over to the next frame.
  const SHIELD_BUDGET = 8960 - 3500;
  let carried = null, carriedN = 0;
  const step2 = (acts) => {
    if (acts.shield) carried = { shield: acts.shield }; else if (acts.unshield) carried = { unshield: true };
    const calls = [];
    if (acts.move) calls.push(() => { pmove(acts.x, acts.y); pm.move(acts.x, acts.y); });
    const doShieldNow = () => {
      if (!carried) return;
      if (m.tstates - m.frameStart >= SHIELD_BUDGET) { carriedN++; return; }
      if (carried.shield) { pshield(...carried.shield); pm.shield(...carried.shield); } else { punshield(); pm.unshield(); }
      carried = null;
    };
    if (rng.chance(0.5)) { calls.forEach((c) => c()); doShieldNow(); } else { doShieldNow(); calls.forEach((c) => c()); }
  };
  let rendered = 0, lastBatch = -1;
  for (i = 0; !aborted && i < FRAMES + 200 && rendered <= FRAMES; i++) {
    const f = rendered, acts = f < FRAMES ? { move: path[f].call, x: path[f].x, y: path[f].y, shield: shieldAt.get(f), unshield: unshieldAt.has(f) && !shieldAt.has(f) } : { move: false };
    if (!strictFrame()) { aborted = true; break; }
    if (rendered > 0 && rendered % 50 === 0 && rendered <= FRAMES && lastBatch !== rendered) {
      // a script batch after every 50 strict frames (16.6.3), the G_CLS one once in the middle
      const kind = (!clsDone && stage === Math.floor(FRAMES / 100)) ? 'cls' : 'plain';
      if (kind === 'cls') clsDone = true;
      stage++; lastBatch = rendered;
      const ok = runBatch(makeBatch(kind), `batch ${stage} (${kind})`, st);
      carried = null;                                                                  // the batch ends unshielded
      if (!ok) { aborted = true; break; }
      continue;                                                                        // its last frame's interrupt is pending; the next strict frame runs it
    }
    step2(acts);
    const off = m.tstates - m.frameStart;
    if (off > maxOff2) maxOff2 = off;
    if (off >= 8960) { deadlineErr++; fail(`strict frame ${f}: the ISR and this frame's calls ended at offset ${off} T, not below 8,960 (the beam is at row 0)`); }
    parkIdle();
    M.runFrame(m);
    st.strict++; rendered++;
    if (!accepted()) { fail(`strict frame ${f}: the frame interrupt was lost at the end of the frame`); aborted = true; break; }
    frameRender(`strict frame ${f}`);
  }
  // the frame after the last batch is verified like the others (strict frame loop ran one past FRAMES for it)
  const nIsr = isrT.length, sum = isrT.reduce((a, b) => a + b, 0);
  const mn = Math.min(...isrT), mx = Math.max(...isrT);
  C.check(`flicker test: ${st.strict} strict frames, every rendered frame (m.pixels, 512 x 192) equals the model's screen plus pointer exactly`, mismatches === 0 && !aborted && st.strict >= FRAMES,
    mismatches ? `${mismatches} frames differ, first: ${firstMismatch}` : `${st.strict} frames, ${st.batches} script batches of ${st.frames} frames (${st.commands} commands), ${carriedN} shield actions carried to the next frame`);
  C.check('flicker test: V_FRAMES rose by exactly 1 in every strict frame, no frame interrupt lost (strict and batch frames)', vErr === 0 && st.lost === 0 && !aborted, `${vErr} strict, ${st.lost} batch frames wrong`);
  C.check('flicker test: the frame ISR stayed within its 32-byte stack frame in every strict frame ($FE00-$FEDF untouched)', stackErr === 0, `${stackErr} frames`);
  C.check('flicker test: the ISR and the frame\'s direct calls finished before the beam reached row 0 (offset < 8,960 T) in every strict frame', deadlineErr === 0, `largest ${maxOff2} T`);
  C.check(`flicker test: in every script batch frame the pixels outside the volatile area equal the model (${st.batches} batches, ${st.frames} batch frames, one G_CLS batch: ${clsDone})`, st.outsideBad === 0 && st.batches >= Math.floor(FRAMES / 50) && clsDone, st.outsideBad ? `${st.outsideBad} pixels` : `${st.batches} batches`);
  C.check(`deadline (16.7): largest T_ISRP offset ${fmt(maxOff)} T + 1,500 = ${fmt(maxOff + 1500)} <= 8,960`, maxOff > 0 && maxOff + 1500 <= 8960);
  if (failures.length) for (const f of failures) console.log(`  detail: ${f}`);
  console.log(`ISR cost over ${nIsr} strict frames (ISR as a whole: P_ISR, the stack fill, the counter; RET included): min ${mn}, mean ${(sum / nIsr).toFixed(0)}, max ${mx} T; ${isrTSkip.length} frames were "skip" frames (nothing to do): max ${isrTSkip.length ? Math.max(...isrTSkip) : '-'} T`);
  console.log(`strict frames ${st.strict}; ${st.batches} batches, ${st.frames} batch frames; largest T_ISRP offset ${maxOff} T (deadline ${maxOff} + 1,500 = ${maxOff + 1500} of 8,960); largest end offset of the frame's calls ${maxOff2} T`);
}

// ===========================================================================================================================
// Part 4: 16.6.4 G_CLS with the pointer moving
function part4() {
  const FR = 300;
  finishPending();
  zeroPtr();
  seedDisplay(m, rng);
  direct('G_INIT');
  pinit(0, 0);
  const tok = poison(m, rng, { stack: false, regions: CLS_REGIONS });                      // 16.1: $5800-$5FFF, $7800-$7FFF, $C000-$DFFF, $E700-$FAFF
  seedDisplay(m, rng);
  const f0 = frameCount(), c0 = rd16(m, S.V_CLS);
  for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { parkIdle(); M.runFrame(m); }         // the clock caught up with the frames (see settle)
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false; cpu.sp = 0xFF00; cpu.pc = S.T_CLSPLOOP;
  for (let f = 0; f < FR; f++) M.runFrame(m);
  const pend = accepted();
  const dF = (frameCount() - f0 + (pend ? 1 : 0)) & 0xFFFF, dC = (rd16(m, S.V_CLS) - c0) & 0xFFFF;
  C.check(`G_CLS with the pointer moving: V_FRAMES (plus the interrupt pending at the end) rose by exactly ${FR} over ${FR} frames`, dF === FR, `${dF}`);
  C.check('G_CLS with the pointer moving: V_CLS rose (T_CLSPLOOP ran back to back)', dC > 0, `${dC} clears in ${FR} frames`);
  const t0 = m.tstates;
  let guard = 0;
  while (cpu.pc !== S.T_CLSPDONE) { step1(); if (cpu.halted || ++guard > 4_000_000 || m.tstates - t0 > 4 * GUARD_T) break; }
  C.check('stepped on to T_CLSPDONE (a finished shielded clear)', cpu.pc === S.T_CLSPDONE, `PC ${hex(cpu.pc)} after ${m.tstates - t0} T`);
  let nz = 0, first = -1;
  for (const [a, b] of [[0x4000, 0x57FF], [0x6000, 0x77FF]]) for (let k = a; k <= b; k++) if (m.ram[k] !== 0) { if (first < 0) first = k; nz++; }
  C.check('at T_CLSPDONE all 12,288 display bytes are 0 (the pointer, hidden by the shield, is not on the screen)', nz === 0, nz ? `${nz} bytes not 0, first at ${hex(first)} = ${hex(m.ram[first], 2)}` : '12,288 bytes');
  const pz = checkPoison(m, tok);
  C.check('$5800-$5FFF, $7800-$7FFF, $C000-$DFFF, $E700-$FAFF unchanged', !pz, pz ? `${pz.n} bytes changed, first ${hex(pz.addr)} = ${hex(pz.got, 2)}, was ${hex(pz.want, 2)}` : 'poison intact');
  console.log(`figures: ${dC} clears and ${dF} frame interrupts in ${FR} frames (${(dC / FR).toFixed(2)} clears per frame)`);
  // leave the machine at T_IDLE
  parkIdle();
}

// ===========================================================================================================================
// Part 5: 16.6.5 longest DI
function part5() {
  let worst = 0, what = '';
  const di = (name, run) => {
    const r = run({ ints: true });
    if (r.maxDiRun > worst) { worst = r.maxDiRun; what = name; }
    C.check(`longest DI run in ${name} (${fmt(r.maxDiRun)} T, bound 1,500) and interrupts on at the return`, r.maxDiRun <= 1500 && r.iff1 === true);
  };
  freshState();
  zeroPtr();
  di('P_INIT (144, 64)', (o) => direct('P_INIT', { hl: 144, de: 64 }, null, o));
  pm.init(144, 64);
  pisr(); pm.isr();                                                      // drawn at (144, 64)
  di('P_MOVE to (300, 100)', (o) => direct('P_MOVE', { hl: 300, de: 100 }, null, o));
  di('P_MOVE to the same position', (o) => direct('P_MOVE', { hl: 300, de: 100 }, null, o));
  pisr();                                                                // drawn at (300, 100)
  di('P_SHIELD that erases the drawn pointer (300, 100) 32 x 16', (o) => pshield2(o, [296, 96, 32, 16]));
  di('P_SHIELD that does not meet it', (o) => pshield2(o, [0, 0, 40, 20]));
  di('P_SHIELD of the whole screen with the pointer drawn', (o) => { pisr(); punshield(); pisr(); return pshield2(o, [0, 0, 512, 192]); });
  di('P_UNSHIELD', (o) => direct('P_UNSHIELD', {}, null, o));
  pisr();
  pmove(511, 191); pisr(); pmove(496, 176); pisr();
  di('P_SHIELD erasing the pointer at the bottom right (496, 176)', (o) => pshield2(o, [500, 180, 4, 4]));
  di('P_UNSHIELD again', (o) => direct('P_UNSHIELD', {}, null, o));
  for (const ints of [false, true]) {
    const r = direct('P_ISR', {}, null, { ints });
    C.check(`P_ISR called with interrupts ${ints ? 'on' : 'off'} returns with them ${ints ? 'on' : 'off'} (it never executes EI or DI)`, r.iff1 === ints);
  }
  console.log(`longest DI run over P_INIT, P_MOVE, P_SHIELD, P_UNSHIELD: ${fmt(worst)} T (${what})`);
  function pshield2(o, r) { return direct('P_SHIELD', {}, r, o); }
}

// ===========================================================================================================================
const PARTS = [[0, 'boot', part0], [1, 'random direct calls', part1], [2, 'interrupt injection', part2], [3, 'flicker test', part3], [4, 'G_CLS with the pointer', part4], [5, 'longest DI', part5]];
for (const [n, name, fn] of PARTS) {
  if (!ONLY.includes(n)) continue;
  const t0 = Date.now();
  try { fn(); } catch (e) { C.check(`part ${n} (${name}) ran to the end`, false, String(e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
  console.log(`-- part ${n} (${name}) took ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}
C.done();
