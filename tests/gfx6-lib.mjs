"use strict";
// gfx6-lib.mjs -- the call harness for the gfx6 tests (docs/GRAPHICS_SPIKE.md section 12.4): boot the `gfx6t` test cartridge,
// call one routine directly with chosen registers (stepping instruction by instruction), measure its T-states and its longest
// DI run, poison / check the RAM outside the display files, seed the display with random bytes.
import { build } from '../tools/build.mjs';
import { boot, runFramesUntil, Z } from './lib.mjs';

export const STACK_TOP = 0xFF00;
export const GUARD_T = 3_000_000;

/** Symbols the S1 tests need (12.4); `start` fails clearly when any is missing. */
export const NEEDED = ['G_INIT', 'G_ADDR', 'G_ROWADDR', 'G_SETOP', 'G_SETCLIP', 'G_FILL', 'G_HLINE', 'G_VLINE', 'G_FRAME', 'G_CLS',
  'GA', 'GOP', 'GCLIP', 'ROWTAB', 'LMASK', 'RMASK', 'T_IDLE', 'T_RET', 'T_CLSLOOP', 'T_CLSDONE', 'V_FRAMES', 'V_CLS', 'RESULT',
  'GFX6_CODE', 'GFX6_CODE_END'];

/** Build and boot gfx6t; returns { m, S, img, frames } or null after recording a FAIL on C (the cartridge tests cannot run). */
export function start(C, needed = NEEDED) {
  let b;
  try { b = build('gfx6t'); }
  catch (e) { C.check('gfx6t cartridge builds', false, String(e.message).split('\n')[0]); return null; }
  const S = b.syms, missing = needed.filter((n) => S[n] === undefined);
  if (missing.length) { C.check('gfx6t defines the symbols the tests use', false, `missing: ${missing.join(', ')}`); return null; }
  const m = boot(b.dck);
  const marked = (mm) => mm.ram[S.RESULT] === 0xA5 && mm.ram[S.RESULT + 1] === 0x5A;
  const frames = runFramesUntil(m, marked, 400);
  const state = m.ram[S.RESULT + 2];
  C.check('gfx6t booted: record marker $A5 $5A, state 1', frames > 0 && state === 1, `frames ${frames}, state ${state}`);
  if (!(frames > 0 && state === 1)) return null;
  return { m, S, img: b.img, frames };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Seeded PRNG (mulberry32) with helpers.
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),      // inclusive
    byte: () => Math.floor(next() * 256),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
  return rng;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 16-bit helpers and the GA argument block.
export const w16 = (v) => v & 0xFFFF;                               // signed -> two's complement word
export const s16 = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
export const hex = (v, n = 4) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

/** Write GA+0..GA+7: x, y, w, h as little-endian signed words (extra words go after them). */
export function setGA(m, S, ...words) {
  words.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
}
export const getGA = (m, S, n = 4) => Array.from({ length: n }, (_, i) => s16(m.ram[S.GA + 2 * i] | (m.ram[S.GA + 2 * i + 1] << 8)));
/** Write garbage into GA+0..GA+7 (for routines that take their arguments in registers). */
export function garbageGA(m, S, rng) { for (let i = 0; i < 8; i++) m.ram[S.GA + i] = rng.byte(); }

export const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
/** GCLIP as [x0, x1, y0, y1]. */
export const readClip = (m, S) => [0, 1, 2, 3].map((i) => rd16(m, S.GCLIP + 2 * i));
/** GOP + GCLIP bytes ($E010-$E019): for "a drawing routine never changes the op or the clip". */
export const opClipBytes = (m, S) => Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));

// ---------------------------------------------------------------------------------------------------------------------------
// Registers.
const REG8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
export const PRESERVED = ['xh', 'xl', 'yh', 'yl', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2'];   // IX, IY, alternate set
export const ALL_REGS = REG8;
const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], af2: ['a2', 'f2'], bc2: ['b2', 'c2'], de2: ['d2', 'e2'],
  hl2: ['h2', 'l2'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };

/**
 * Call a routine directly (12.4).  regs: 8-bit names (a f b c d e h l, a2.., xh xl yh yl) and/or pairs (af bc de hl af2 bc2
 * de2 hl2 ix iy).  opts: { ints } iff1 = iff2 = ints (default false); { rng } gives every register not named a random value;
 * { guard } T-state limit.  Returns { t, regs (after), regsIn, sp, iff1, maxDiRun (T-states of the longest run with iff1 false,
 * only with ints) }.  Throws, naming the routine, if the guard is exceeded or the CPU halts.
 */
export function call(m, S, name, regs = {}, opts = {}) {
  const addr = typeof name === 'number' ? name : S[name];
  if (addr === undefined) throw new Error(`call: unknown routine ${name}`);
  const cpu = m.cpu, ints = !!opts.ints, guard = opts.guard ?? GUARD_T, rng = opts.rng;
  const want = {};
  for (const [k, v] of Object.entries(regs)) {
    if (PAIRS[k]) { want[PAIRS[k][0]] = (v >> 8) & 0xFF; want[PAIRS[k][1]] = v & 0xFF; }
    else if (REG8.includes(k)) want[k] = v & 0xFF;
    else throw new Error(`call: unknown register ${k}`);
  }
  const regsIn = {};
  for (const r of REG8) { regsIn[r] = want[r] !== undefined ? want[r] : (rng ? rng.byte() : 0); cpu[r] = regsIn[r]; }
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false;
  cpu.iff1 = cpu.iff2 = ints;
  cpu.sp = STACK_TOP - 2;
  m.ram[STACK_TOP - 2] = S.T_RET & 0xFF; m.ram[STACK_TOP - 1] = S.T_RET >> 8;
  cpu.pc = addr;
  const t0 = m.tstates, ret = S.T_RET;
  let run = 0, maxRun = 0, steps = 0;
  while (cpu.pc !== ret) {
    const before = m.tstates;
    Z.runZ80(cpu, m.bus, 1, m);
    const dt = m.tstates - before;
    if (cpu.halted) throw new Error(`call ${name}: the CPU halted at $${cpu.pc.toString(16)}`);
    if (!cpu.iff1) { run += dt; if (run > maxRun) maxRun = run; } else run = 0;
    if ((m.tstates - t0 > guard) || ++steps > 4_000_000) {
      throw new Error(`call ${name}: ${m.tstates - t0} T-states without returning to T_RET (guard ${guard}), PC = $${cpu.pc.toString(16)}`);
    }
  }
  const out = {};
  for (const r of REG8) out[r] = cpu[r];
  for (const [k, [hi, lo]] of Object.entries(PAIRS)) out[k] = (out[hi] << 8) | out[lo];
  return { t: m.tstates - t0, regs: out, regsIn, sp: cpu.sp, iff1: cpu.iff1, maxDiRun: ints ? maxRun : null };
}

/** Names of the registers in `names` whose value after the call differs from the value before it ("" when none). */
export function changed(res, names = PRESERVED) {
  return names.filter((r) => res.regs[r] !== res.regsIn[r]).map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Poisoning (12.4 "Clip safety").  Visible RAM in $4000-$FFFF outside the display files, except $E000-$E0FF (gfx6's and the
// cartridge's variables), $FE00-$FEFF (the stack around the call) and $FF00-$FFFF (the record).  $8000-$BFFF is the cartridge
// (DOCK chunks 4-5, read-only, not RAM under $F4 = $33), so it has nothing to poison.  The stack canary at $FB00 is inside the
// poisoned range, as the contract lists it.
export const POISON_REGIONS = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xDFFF], [0xE100, 0xFDFF]];
// Added by these tests: each routine uses at most 32 bytes of stack below its return address ($FEFE), so $FE00-$FEDD stay as they were.
export const STACK_GUARD = [0xFE00, 0xFEFE - 32 - 1];
const CLS_REGIONS = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xDFFF], [0xE100, 0xFAFF]];   // 12.5 for G_CLS safety
export { CLS_REGIONS };

let pool = null;
function getPool(rng) {
  if (!pool) { pool = new Uint8Array(65536 + 8192); for (let i = 0; i < pool.length; i++) pool[i] = rng.byte(); }
  return pool;
}

/** Fill the regions with random bytes; returns a token for checkPoison. */
export function poison(m, rng, { stack = true, regions = POISON_REGIONS } = {}) {
  const p = getPool(rng), all = stack ? [...regions, STACK_GUARD] : regions, saved = [];
  for (const [a, b] of all) {
    const len = b - a + 1, off = rng.int(0, p.length - len);
    m.ram.set(p.subarray(off, off + len), a);
    saved.push({ a, b, copy: m.ram.slice(a, b + 1) });
  }
  return saved;
}
/** null when every poisoned byte is unchanged, else { addr, got, want, n } for the first changed one. */
export function checkPoison(m, token) {
  for (const { a, b, copy } of token) {
    for (let i = 0; i <= b - a; i++) {
      if (m.ram[a + i] !== copy[i]) {
        let n = 0; for (let j = i; j <= b - a; j++) if (m.ram[a + j] !== copy[j]) n++;
        return { addr: a + i, got: m.ram[a + i], want: copy[i], n };
      }
    }
  }
  return null;
}

/** Random bytes into both display files (so a routine that skips a byte it should write shows up). */
export function seedDisplay(m, rng) {
  const p = getPool(rng);
  for (const a of [0x4000, 0x6000]) {
    const off = rng.int(0, p.length - 0x1800);
    m.ram.set(p.subarray(off, off + 0x1800), a);
  }
}
export function fillDisplay(m, v) { m.ram.fill(v, 0x4000, 0x5800); m.ram.fill(v, 0x6000, 0x7800); }
