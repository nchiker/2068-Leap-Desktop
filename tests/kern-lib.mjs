"use strict";
// kern-lib.mjs -- shared harness of the K1 tests (tests/kern-k1.mjs, tests/kern-perf.mjs): symbols, the poison regions, the byte
// comparison of the machine's RAM with the model's image, a traced call (for the method a send reaches and for send timing),
// the per-call register / DI checks (docs/OBJECTS_EVENTS.md 5, 13.7).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { Z } from './lib.mjs';
import { STACK_TOP, GUARD_T, PRESERVED, hex } from './gfx6-lib.mjs';

/** Symbols the K1 tests use (13.6); the CL_* and field symbols are added from the class list by neededFor(). */
export const KNEEDED = ['K_SEND', 'K_AINIT', 'K_ARENA', 'K_ARESET', 'K_NEW', 'K_FREE', 'K_ALLOC', 'K_ADDCHILD', 'K_UNLINK', 'K_SETROOT',
  'K_KARENA', 'K_AARENA', 'K_CURA', 'K_FOCUS', 'K_CAPTURE', 'K_ROOT', 'K_CODE', 'K_CODE_END', 'obj_destroy', 'view_destroy',
  'view_hittest', 'k_nop', 'T_SEND', 'T_LOG', 'T_LOGN', 'T_IDLE', 'T_RET', 'RESULT', 'V_FRAMES',
  't_destroy', 't_draw', 't_event', 't_hittest', 't_focus', 't_blur', 't_poke', 't_draw2', 't_poke2',
  'M_DESTROY', 'M_DRAW', 'M_EVENT', 'M_HITTEST', 'M_FOCUS', 'M_BLUR', 'M_POKE', 'M_POKE2'];
export const neededFor = (classes) => [...KNEEDED, ...classes.list.map((c) => `CL_${c.name}`), ...classes.list.map((c) => `${c.name}_SIZE`),
  'View_parent', 'View_child', 'View_next', 'View_x', 'View_y', 'View_w', 'View_h', 'View_flags', 'View_id', 'TLog_tag'];

export const readClassesJson = (target = 'kern3') => JSON.parse(readFileSync(join(ROOT, 'build', target, 'classes.json'), 'utf8'));

/** Regions poisoned before a run (13.6): everything outside the K1 variables, the gfx6 / cartridge variables, the record and the stack's top. */
export const KPOISON = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xDFFF], [0xE100, 0xE7FF], [0xE800, 0xEFFF], [0xF000, 0xF04F],
  [0xF080, 0xFAFF], [0xFB00, 0xFEFD]];
/** The address under which the stack guard stops: bytes up to this one must be unchanged for a routine allowed `lim` bytes below its return address. */
export const guardTop = (lim) => 0xFEFE - lim - 1;

const buf = (a, off, len) => Buffer.from(a.buffer, a.byteOffset + off, len);
/** Name an address for a failure message. */
export function where(S, a) {
  const inR = (lo, n) => a >= lo && a < lo + n;
  if (inR(S.K_KARENA, 16)) return `K_KARENA+${a - S.K_KARENA}`;
  if (inR(S.K_AARENA, 16)) return `K_AARENA+${a - S.K_AARENA}`;
  if (a === S.K_CURA || a === S.K_CURA + 1) return 'K_CURA';
  if (inR(S.K_FOCUS, 2)) return 'K_FOCUS'; if (inR(S.K_CAPTURE, 2)) return 'K_CAPTURE'; if (inR(S.K_ROOT, 2)) return 'K_ROOT';
  if (a >= S.T_LOG && a < S.T_LOG + 2048) return `log record ${(a - S.T_LOG) >> 3} +${(a - S.T_LOG) & 7}`;
  if (a === S.T_LOGN || a === S.T_LOGN + 1) return 'T_LOGN';
  if (a >= 0xC000 && a < 0xE000) return 'app arena';
  if (a >= 0xF100 && a < 0xFB00) return 'kernel arena';
  if (a >= 0xFB00 && a < 0xFF00) return 'stack area';
  return 'other RAM';
}

/**
 * Compare the machine's RAM with the model's image.  Ranges compared: $4000-$7FFF, $C000-$F077, $F080-guardTop(lim), $FF00-$FFFF.
 * Not compared (and copied from the machine into the model afterwards): the kernel scratch $F078-$F07F, the stack from the guard up
 * to $FEFF (the routine's own frames), and the model's `wild` ranges (bytes the contract leaves open).
 * Returns null when equal, else a string describing the first difference and the count.
 */
export function compareRam(m, model, S, lim = 32) {
  const gt = guardTop(lim);
  for (const [a, n] of model.takeWild()) model.mem.set(m.ram.subarray(a, a + n), a);
  let first = null, count = 0;
  for (const [lo, hi] of [[0x4000, 0x7FFF], [0xC000, 0xF077], [0xF080, gt], [0xFF00, 0xFFFF]]) {
    const len = hi - lo + 1;
    if (buf(m.ram, lo, len).compare(buf(model.mem, lo, len)) === 0) continue;
    for (let a = lo; a <= hi; a++) if (m.ram[a] !== model.mem[a]) { count++; if (!first) first = a; }
  }
  model.mem.set(m.ram.subarray(0xF078, 0xF080), 0xF078);
  model.mem.set(m.ram.subarray(gt + 1, 0xFF00), gt + 1);
  if (first === null) return null;
  return `${count} byte(s) differ, first at ${hex(first)} (${where(S, first)}): machine $${m.ram[first].toString(16)}, model $${model.mem[first].toString(16)}`;
}

/**
 * Call `addr` as call() does (docs/GRAPHICS_SPIKE.md 12.4), additionally: opts.trace -> `reached` = the first PC outside the dispatcher
 * ($0008-$0017) after it was entered (the method a send reached); opts.stopPc -> stop when PC = stopPc (t = T-states until then, the
 * instruction at stopPc not executed).  Returns { t, regs, regsIn, sp, iff1, maxDiRun, reached, stopped }.
 */
export function traceCall(m, S, addr, regs = {}, opts = {}) {
  const cpu = m.cpu, ints = !!opts.ints, guard = opts.guard ?? GUARD_T, rng = opts.rng;
  const REG8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  const want = {};
  for (const [k, v] of Object.entries(regs)) {
    if (PAIRS[k]) { want[PAIRS[k][0]] = (v >> 8) & 0xFF; want[PAIRS[k][1]] = v & 0xFF; } else want[k] = v & 0xFF;
  }
  const regsIn = {};
  for (const r of REG8) { regsIn[r] = want[r] !== undefined ? want[r] : (rng ? rng.byte() : 0); cpu[r] = regsIn[r]; }
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false;
  cpu.iff1 = cpu.iff2 = ints;
  cpu.sp = STACK_TOP - 2;
  m.ram[STACK_TOP - 2] = S.T_RET & 0xFF; m.ram[STACK_TOP - 1] = S.T_RET >> 8;
  cpu.pc = addr;
  const t0 = m.tstates, ret = S.T_RET;
  let run = 0, maxRun = 0, steps = 0, inDisp = false, reached = null, stopped = false;
  while (cpu.pc !== ret) {
    if (opts.stopPc !== undefined && cpu.pc === opts.stopPc && steps > 0) { stopped = true; break; }
    const pc = cpu.pc;
    if (opts.trace && reached === null) {
      if (pc >= 0x0008 && pc <= 0x0017) inDisp = true; else if (inDisp) reached = pc;
    }
    const before = m.tstates;
    Z.runZ80(cpu, m.bus, 1, m);
    const dt = m.tstates - before;
    steps++;
    if (cpu.halted) throw new Error(`traceCall ${hex(addr)}: the CPU halted at $${cpu.pc.toString(16)}`);
    if (!cpu.iff1) { run += dt; if (run > maxRun) maxRun = run; } else run = 0;
    if ((m.tstates - t0 > guard) || steps > 4_000_000) {
      throw new Error(`traceCall ${hex(addr)}: ${m.tstates - t0} T-states without returning (PC = $${cpu.pc.toString(16)})`);
    }
  }
  if (opts.trace && reached === null && cpu.pc !== ret) reached = cpu.pc;
  const out = {};
  for (const r of REG8) out[r] = cpu[r];
  for (const [k, [hi, lo]] of Object.entries(PAIRS)) out[k] = (out[hi] << 8) | out[lo];
  return { t: m.tstates - t0, regs: out, regsIn, sp: cpu.sp, iff1: cpu.iff1, maxDiRun: ints ? maxRun : null, reached, stopped };
}

/** The registers that must come back unchanged from every K1 routine (section 5): IY and the alternate set; IX unless it is an output. */
export const KEEP = (ixOut) => (ixOut ? PRESERVED.filter((r) => r !== 'xh' && r !== 'xl') : PRESERVED);
export const carryOf = (res) => res.regs.f & 1;

/** Stack-depth probe (13.7): fill the stack area below the return address with a pattern, run, find the lowest byte changed. */
export function armStack(m, pat) { m.ram.fill(pat, 0xFB00, 0xFEFE); }
export function stackUsed(m, pat) {
  let lo = 0xFEFE;
  for (let a = 0xFB00; a < 0xFEFE; a++) if (m.ram[a] !== pat) { lo = a; break; }
  return 0xFEFE - lo;
}
