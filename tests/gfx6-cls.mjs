"use strict";
// gfx6-cls.mjs -- G_CLS interrupt safety (docs/GRAPHICS_SPIKE.md sections 7 and 12.5): T_CLSLOOP calls G_CLS back to back with
// interrupts on for 300 frames.  No frame interrupt may be lost (V_FRAMES rises by exactly 300), and when a clear is finished
// (T_CLSDONE) the display is all paper and the RAM outside the display files is unchanged.
//   node tests/gfx6-cls.mjs [--seed N]
import { checks, M, Z, FRAME_T } from './lib.mjs';
import { start, makeRng, poison, checkPoison, seedDisplay, rd16, hex, CLS_REGIONS, GUARD_T } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const i = argv.indexOf('--seed');
const SEED = i >= 0 ? Number(argv[i + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED}`);
const FRAMES = 300;

const C = checks('gfx6 G_CLS interrupt safety');
const ctx = start(C, ['G_CLS', 'T_CLSLOOP', 'T_CLSDONE', 'V_FRAMES', 'V_CLS', 'RESULT']);
if (!ctx) { C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);

// TSRun raises the frame interrupt at the END of runFrame (an accepted one leaves PC = $0038 with the return address pushed; the
// ISR itself runs at the start of the next frame).  So the boot's last interrupt is still pending here and must be run to its RET
// before the CPU is redirected, and the last frame's interrupt is pending after the loop and is run to its counter increment
// before V_FRAMES is read.  An interrupt that was NOT accepted (DI, or a frame ending right after EI) leaves PC elsewhere, so it
// stays missing from the count: that is the loss this test looks for.
const cpu = m.cpu;
function step1() { Z.runZ80(cpu, m.bus, 1, m); }
if (cpu.pc === 0x38) { let g = 0; while (!(cpu.sp === 0xFF00 && cpu.pc !== 0x38) && g++ < 1000) step1(); }

// Poison the listed regions ($5800-$5FFF, $7800-$7FFF, $C000-$DFFF, $E700-$FAFF (16.1: not the pointer area $E100-$E6FF, which the ISR's P_ISR reads); not the stack), random bytes in the display.
const tok = poison(m, rng, { stack: false, regions: CLS_REGIONS });
seedDisplay(m, rng);
const frames0 = rd16(m, S.V_FRAMES), cls0 = rd16(m, S.V_CLS);

// T_CLSLOOP does its own EI: start it with interrupts off and the stack at $FF00.
cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
cpu.sp = 0xFF00; cpu.pc = S.T_CLSLOOP;
for (let f = 0; f < FRAMES; f++) M.runFrame(m);

if (cpu.pc === 0x38) { const v = rd16(m, S.V_FRAMES); let g = 0; while (rd16(m, S.V_FRAMES) === v && g++ < 1000) step1(); }
const dFrames = (rd16(m, S.V_FRAMES) - frames0) & 0xFFFF, dCls = (rd16(m, S.V_CLS) - cls0) & 0xFFFF;
C.check(`V_FRAMES rose by exactly ${FRAMES} over ${FRAMES} frames (no interrupt lost)`, dFrames === FRAMES, `${dFrames}`);
C.check('V_CLS rose: G_CLS ran back to back', dCls > 0, `${dCls} clears in ${FRAMES} frames (${(FRAMES * FRAME_T / Math.max(dCls, 1)).toFixed(0)} T per clear incl. ISR time)`);

// Step to the end of a clear and judge it.
const t0 = m.tstates;
let guard = 0;
while (cpu.pc !== S.T_CLSDONE) {
  Z.runZ80(cpu, m.bus, 1, m);
  if (cpu.halted || ++guard > 4_000_000 || m.tstates - t0 > 4 * GUARD_T) break;
}
C.check('stepped on to T_CLSDONE (a finished clear)', cpu.pc === S.T_CLSDONE, `PC ${hex(cpu.pc)} after ${m.tstates - t0} T`);
let nz = 0, first = -1;
for (const [a, b] of [[0x4000, 0x57FF], [0x6000, 0x77FF]]) for (let k = a; k <= b; k++) if (m.ram[k] !== 0) { if (first < 0) first = k; nz++; }
C.check('all 12,288 display bytes are 0 (paper) at T_CLSDONE', nz === 0, nz ? `${nz} bytes not 0, first at ${hex(first)} = ${hex(m.ram[first], 2)}` : '12,288 bytes');
const pz = checkPoison(m, tok);
C.check('$5800-$5FFF, $7800-$7FFF, $C000-$DFFF, $E700-$FAFF unchanged', !pz,
  pz ? `${pz.n} bytes changed, first ${hex(pz.addr)} = ${hex(pz.got, 2)}, was ${hex(pz.want, 2)}` : 'poison intact');
C.check('stack pointer and result record intact', cpu.sp === 0xFF00 && m.ram[S.RESULT] === 0xA5 && m.ram[S.RESULT + 1] === 0x5A,
  `SP ${hex(cpu.sp)}, record ${hex(m.ram[S.RESULT], 2)} ${hex(m.ram[S.RESULT + 1], 2)}`);
console.log(`figures: ${dCls} clears and ${dFrames} frame interrupts in ${FRAMES} frames (${(dCls / FRAMES).toFixed(2)} clears per frame)`);
C.done();
