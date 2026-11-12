"use strict";
// bank-lib.mjs -- shared harness of slice B0's tests (tests/bank-b0.mjs, tests/bank-perf.mjs).  Written from docs/BANKING.md sections 2, 4-7 and 10
// only (never from src/kernel/far.asm, src/bank5.asm or src/bank5k.asm).  It never builds: it loads the prebuilt build/bank5.dck and
// build/bank5/out.sym (node tools/build.mjs bank5, done by someone else).
//   - bootBank5: boot, memory watch (10.7) armed from the cartridge's own `$F4 = $33`, frames until the self-test record (10.5),
//     V_FRAMES watched per normally run frame;
//   - makeWatch: the memory watch of 10.7 (wraps m.bus.read / m.bus.write);
//   - parsePatches / applyPatches: `--patch ADDR=BYTE[,ADDR=BYTE...]` (hex), plants a mutation in the emulator's copy of the cartridge.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { boot, M, Z } from './lib.mjs';
import { parseSym } from './wm-lib.mjs';

export { M, Z };
export const hex = (v, n = 4) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
export const F4 = { K: 0x33, A: 0x3F, R: 0x73 };                       // docs/BANKING.md 2
export const PAIRS = ['KK', 'KA', 'KR', 'AK', 'AA', 'AR', 'RK', 'RA', 'RR'];   // 10.3: (caller, target), the order of the record's pair index

export const argv = process.argv.slice(2);
export const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
export const argNum = (name, dflt) => { const v = argVal(name, null); return v === null ? dflt : Number(v); };

/** Symbols both suites use (10.2-10.5 and the kernel routines named in 6.2 / 10.8). */
export const NEEDED = ['K_FAR', 'K_FAR_END', 'K_FJP', 'K_FA', 'V_SHADOW_F4', 'V_FRAMES', 'V_IRQA', 'V_IRQR', 'T_IN', 'T_OUT', 'T_RET', 'T_SEND', 'T_IDLE',
  'T_LOG', 'T_LOGN', 'RESULT', 'ISR', 'ISR_BODY', 'XT_K', 'XT_A', 'XT_R', 'XR_K', 'XR_A', 'XR_R', 'B_IMG_ADDR', 'B_IMG_LEN', 'B_CLWIN', 'B_CLCTL', 'B_BTN',
  'B_RDRAW', 'B_RSTR', 'B_RSTR_N', 'B_THWDRAW', 'B_THCDRAW', 'B_THEVENT', 'B_THFOCUS', 'B_THBLUR', 'B_TITLE',
  ...PAIRS.map((p) => `CT_${p}`), ...PAIRS.map((p) => `CR_${p}`),
  'K_WARP', 'K_NEW', 'K_ALLOC', 'K_FREE', 'K_POST', 'K_ARENA', 'K_GETEV', 'K_ADDCHILD', 'K_RING', 'K_RTAIL', 'K_RHEAD', 'K_PN', 'K_EV', 'K_AARENA', 'K_KARENA', 'K_CURA',
  'W_DIRTY', 'W_INVAL', 'W_UPDATE', 'W_OPEN', 'W_CLOSE', 'W_FRONT', 'W_DRAWVIEW',
  'G_SETCLIP', 'G_SETOP', 'G_FILL', 'G_FRAME', 'G_HLINE', 'G_VLINE', 'G_TEXT8', 'G_TEXTP', 'P_SHIELD', 'P_UNSHIELD', 'GA', 'GOP', 'GCLIP', 'GLH',
  'PT_DX', 'PT_DY', 'PT_DRAWN', 'PT_X', 'PT_Y', 'CL_TWin', 'CL_TCtl', 'CL_Button', 'View_x', 'View_y', 'View_w', 'View_h', 'View_flags', 'View_id',
  'Window_title', 'TWin_tag', 'TCtl_tag', 'Button_text', 'M_EVENT', 'M_DRAW', 'M_DESTROY', 'T_SOK', 'T_TITLE1', 'T_EVONE', 't_event'];

/** The prebuilt cartridge: { dck, S, img }.  Throws a one-line error when the files are missing. */
export function loadBank5() {
  const dir = join(ROOT, 'build', 'bank5');
  if (!existsSync(join(dir, 'out.sym')) || !existsSync(join(ROOT, 'build', 'bank5.dck'))) throw new Error('build/bank5/out.sym or build/bank5.dck is missing (node tools/build.mjs bank5)');
  const S = parseSym(readFileSync(join(dir, 'out.sym'), 'utf8'));
  const missing = NEEDED.filter((n) => S[n] === undefined);
  if (missing.length) throw new Error(`bank5 does not define: ${missing.join(', ')}`);
  return { dck: readFileSync(join(ROOT, 'build', 'bank5.dck')), S };
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// --patch ADDR=BYTE[,ADDR=BYTE...] (hex).  ADDR is a DOCK address: the byte goes into the DOCK chunk that the address falls in (`m.dock[addr >> 13]`),
// the cartridge image as `review-inject.mjs --mutate` plants it.  `m:ADDR=BYTE` writes the machine RAM instead (for the RAM image at $C000, which
// B_INIT copies at boot).  Several patches are separated by commas.
export function parsePatches(text) {
  if (!text) return [];
  return text.split(',').filter(Boolean).map((p) => {
    const mm = p.trim().match(/^(m:)?(?:\$|0x)?([0-9a-fA-F]{1,4})=(?:\$|0x)?([0-9a-fA-F]{1,2})$/);
    if (!mm) throw new Error(`--patch: cannot read "${p}" (want ADDR=BYTE in hex, optionally m:ADDR=BYTE)`);
    return { ram: !!mm[1], addr: parseInt(mm[2], 16), val: parseInt(mm[3], 16) };
  });
}
export function applyPatches(m, list, label) {
  for (const p of list) {
    let old;
    if (p.ram) { old = m.ram[p.addr]; m.ram[p.addr] = p.val; }
    else {
      const c = m.dock[p.addr >> 13];
      if (!c) throw new Error(`--patch: no DOCK chunk at ${hex(p.addr)}`);
      old = c[p.addr & 0x1FFF]; c[p.addr & 0x1FFF] = p.val;
    }
    console.log(`PATCH applied ${label}: ${p.ram ? 'RAM' : 'DOCK'} ${hex(p.addr)}: ${hex(old, 2)} -> ${hex(p.val, 2)}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------
/**
 * The memory watch (10.7).  Wraps m.bus.read / m.bus.write.  For each access M is the mapping `$F4` holds at that moment and PC the CPU's `pc`
 * (TSRun has already stepped it past the opcode byte, so it is inside the instruction being executed):
 *   under A ($3F): a write to $4000-$7FFF is a violation; a read there is one unless PC is in $4000-$7FFF or in K_FAR..K_FAR_END;
 *   under R ($73): the same for $C000-$DFFF, and a read is also allowed when PC is in gfx6's code (GFX6_CODE..GFX6_CODE_END - 1, the R-direct routines);
 *   under K ($33): no rule.
 * Any other `$F4` value (after the cartridge's own first `$F4 = $33`) is a violation too ($7F and the rest are never used, 2).
 * The watch arms itself at the first access made with `$F4 = $33`.  `w.on = false` pauses it (the tests' own reads go through m.ram anyway).
 */
export function makeWatch(m, S, opts = {}) {
  const rd0 = m.bus.read, wr0 = m.bus.write;
  const w = { on: true, armed: false, n: 0, kinds: {}, first: [], accA: 0, accR: 0, codeA: 0, codeR: 0, rstr: 0 };
  const FAR0 = S.K_FAR, FAR1 = S.K_FAR_END;
  const bad = (kind, addr, pc, f4) => {
    w.n++; w.kinds[kind] = (w.kinds[kind] || 0) + 1;
    if (w.first.length < 12) w.first.push(`${kind} at ${hex(addr)}, PC ${hex(pc)}, $F4 ${hex(f4, 2)}`);
  };
  const check = (addr, isWrite) => {
    const f4 = m.portF4;
    if (!w.armed) { if (f4 === 0x33) w.armed = true; else return; }
    if (f4 === 0x33) return;
    const pc = m.cpu.pc;
    if (f4 === 0x3F) {
      if (addr >= 0x4000 && addr < 0x8000) {
        w.accA++;
        if (isWrite) bad('write to $4000-$7FFF under A', addr, pc, f4);
        else if (pc >= 0x4000 && pc < 0x8000) w.codeA++;
        else if (pc >= FAR0 && pc <= FAR1) w.codeA++;
        else bad('read of $4000-$7FFF under A', addr, pc, f4);
      }
    } else if (f4 === 0x73) {
      if (addr >= 0xC000 && addr < 0xE000) {
        w.accR++;
        if (isWrite) bad('write to $C000-$DFFF under R', addr, pc, f4);
        else if (pc >= 0xC000 && pc < 0xE000) w.codeR++;
        else if (pc >= FAR0 && pc <= FAR1) w.codeR++;
        else if (pc >= S.GFX6_CODE && pc < S.GFX6_CODE_END) w.rstr++;   // 10.7 (amended): an R-direct routine (gfx6) reading the chunk 6 data it was handed
        else bad('read of $C000-$DFFF under R', addr, pc, f4);
      }
    } else bad(`unexpected $F4 value ${hex(f4, 2)}`, addr, pc, f4);
  };
  m.bus.read = function (addr) { if (w.on) check(addr & 0xFFFF, false); return rd0(addr); };
  m.bus.write = function (addr, v) { if (w.on) check(addr & 0xFFFF, true); wr0(addr, v); };
  w.reset = () => { w.n = 0; w.kinds = {}; w.first = []; };
  w.summary = () => (w.n ? `${w.n} violation(s): ${Object.entries(w.kinds).map(([k, v]) => `${v} x ${k}`).join('; ')}; first: ${w.first.slice(0, 4).join(' | ')}` : 'no violation');
  return w;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
export const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);

/** What the self-test wrote (10.5), read from the machine's RAM. */
export function readRecord(m, S) {
  const R = S.RESULT, r8 = (o) => m.ram[R + o], r16 = (o) => m.ram[R + o] | (m.ram[R + o + 1] << 8);
  return { marked: r8(0) === 0xA5 && r8(1) === 0x5A, state: r8(2), kind: r8(3), iters: r16(4), frames: r16(6), irqA: r16(8), irqR: r16(10), logn: r16(12),
    logSum: r16(14), dispSum: r16(16), pair: r8(18) };
}

/**
 * Boot the prebuilt bank5 and run normal frames until the self-test record (10.5) is there, with the memory watch armed and V_FRAMES read after every
 * frame (test 6).  opts.patchEarly: patches applied before the first frame.  Returns { m, S, w, frames, vf, rec, load }.
 */
export function bootBank5(opts = {}) {
  const load = loadBank5(), S = load.S;
  const m = boot(load.dck);
  const w = makeWatch(m, S);
  if (opts.patchEarly?.length) applyPatches(m, opts.patchEarly, 'before the first frame');
  const vf = { frames: 0, checked: 0, bad: 0, first: '', started: false };
  let prev = rd16(m, S.V_FRAMES), frames = 0;
  const maxFrames = opts.maxFrames ?? 900;
  for (; frames < maxFrames; frames++) {
    M.runFrame(m);
    const cur = rd16(m, S.V_FRAMES);
    if (vf.started) {
      vf.checked++;
      if (((cur - prev) & 0xFFFF) !== 1) { vf.bad++; if (!vf.first) vf.first = `frame ${frames + 1}: V_FRAMES ${prev} -> ${cur}`; }
    } else if (prev === 0 && cur === 1) vf.started = true;   // V_FRAMES is random at power-on and the boot (DI for about 130 frames) clears it: count from the first ISR
    prev = cur;
    if (readRecord(m, S).marked) { frames++; break; }
  }
  vf.frames = frames;
  return { m, S, w, frames, vf, rec: readRecord(m, S), load };
}

/** Run `n` normal frames, V_FRAMES read after each; returns { checked, bad, first }. */
export function runNormalFrames(m, S, n) {
  let prev = rd16(m, S.V_FRAMES), bad = 0, first = '';
  for (let i = 0; i < n; i++) {
    M.runFrame(m);
    const cur = rd16(m, S.V_FRAMES);
    if (((cur - prev) & 0xFFFF) !== 1) { bad++; if (!first) first = `frame ${i + 1}: V_FRAMES ${prev} -> ${cur}`; }
    prev = cur;
  }
  return { checked: n, bad, first };
}

/** Park the CPU as `kern4` idles (interrupts on, outside any routine); direct calls overwrite all of this. */
export function parkIdle(m, S) {
  const cpu = m.cpu;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_RET;
}

/** Set `$F4` and the shadow to mapping `letter` ('K' | 'A' | 'R'): both together, as a caller of 10.3 must be entered. */
export function setMap(m, S, letter) { m.ram[S.V_SHADOW_F4] = F4[letter]; m.portF4 = F4[letter]; }

/** Compare two RAM images except `skip` ranges [lo, hi]; returns null or "N byte(s) differ, first at $xxxx (a: $x, b: $y)". */
export function ramDiff(a, b, skip = []) {
  let first = -1, n = 0;
  for (let i = 0; i < 0x10000; i++) {
    if (a[i] === b[i]) continue;
    let s = false; for (const [lo, hi] of skip) if (i >= lo && i <= hi) { s = true; break; }
    if (s) continue;
    n++; if (first < 0) first = i;
  }
  return first < 0 ? null : `${n} byte(s) differ, first at ${hex(first)} (${hex(a[first], 2)} against ${hex(b[first], 2)})`;
}
