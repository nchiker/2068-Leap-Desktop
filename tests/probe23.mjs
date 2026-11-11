"use strict";
// probe23.mjs -- probe (a) on TSRun: application code in DOCK chunks 2-3, the K_PLOT trampoline, an ISR that draws while the
// window is mapped.  Contract and checks: docs/PROBE_DOCK23.md ("Checks per emulator", TSRun column).
//   node tests/probe23.mjs
import { build } from '../tools/build.mjs';
import { boot, M, Z, FRAME_T, FRAME_W, SCR_X0, SCR_Y0, checks } from './lib.mjs';

const C = checks('probe23 (TSRun)');
const { dck, syms: S } = build('probe23');
const N = 2000, ISR_BYTE = 0x57FF;
const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
const marked = (m) => m.ram[S.RESULT] === 0xA5 && m.ram[S.RESULT + 1] === 0x5A;
const model = (off) => (off % 3 === 0 && off / 3 < N) ? ((7 * (off / 3) + 1) & 0xFF) : 0;   // file 1 byte at $4000 + off

// File 1 byte at offset off as the video showed it (mode 0: 256 pixels doubled to 512 buffer columns; ink 0 = 1).
function shownByte(m, off) {
  const y = ((off >> 8) & 7) | ((off >> 2) & 0x38) | ((off >> 5) & 0xC0), col = off & 31;
  let v = 0;
  for (let b = 0; b < 8; b++) if (m.pixels[(SCR_Y0 + y) * FRAME_W + SCR_X0 + 2 * (8 * col + b)] === 0) v |= 0x80 >> b;
  return v;
}

/** One frame stepped instruction by instruction (as Leap-IDE's arcade/spike/xip/lib.mjs stepFrame). */
function stepFrame(m, onInstr) {
  const end = m.frameStart + FRAME_T;
  while (m.tstates < end - 64 && !m.cpu.halted) { onInstr(m); Z.runZ80(m.cpu, m.bus, 1, m); }
  M.runFrame(m);
}

const m = boot(dck);
// Boot: frames until the cartridge has switched to its own mapping, then instructions until MAINC's EI has run.
let frames = 0;
while (m.portF4 !== 0x33 && frames < 300) { M.runFrame(m); frames++; }
let guard = 0;
while (m.cpu.pc !== S.MAINC + 1 && guard++ < 2e6) Z.runZ80(m.cpu, m.bus, 1, m);
C.check('reached MAINC (interrupts on)', m.cpu.pc === S.MAINC + 1, `hand-off + ${frames} frames`);

// 60 frames stepped: where the PC is, and where the interrupts land.
let inApp = 0, inAppMapped = 0, total = 0, irqs = 0, irqsInApp = 0;
for (let f = 0; f < 60; f++) {
  stepFrame(m, (mm) => {
    total++;
    const pc = mm.cpu.pc;
    if (pc >= 0x4000 && pc < 0x8000) { inApp++; if (mm.portF4 === 0x3F) inAppMapped++; }
    if (pc === S.ISR) {
      irqs++;
      const ret = mm.bus.read(mm.cpu.sp) | (mm.bus.read(mm.cpu.sp + 1) << 8);
      if (ret >= 0x4000 && ret < 0x8000) irqsInApp++;
    }
  });
}
C.check('application code executed in $4000-$7FFF', inApp > 0, `${inApp} of ${total} instructions (${(100 * inApp / total).toFixed(1)} %)`);
C.check('...always with DOCK 2-3 mapped ($F4 = $3F)', inAppMapped === inApp, `${inAppMapped} of ${inApp}`);
C.check('interrupts taken inside chunk 2-3 code', irqsInApp > 0, `${irqsInApp} of ${irqs} interrupts returned into $4000-$7FFF`);
// Stepping a frame instruction by instruction can drop that frame's interrupt (a harness effect: the stepped frames show it, the
// frames run normally do not), so the "no interrupt lost" check counts only the frames run normally from here on.
const isrAtStep = rd16(m, S.V_FRAMES);

// Run to the end, checking every rendered frame: file 1 shows only model bytes or 0 (never DOCK bytes), written count never falls.
let badFrames = 0, firstBad = '', lastWritten = 0, fallBack = 0, runFrames = 60;
while (!marked(m) && runFrames < 3000) {
  M.runFrame(m); runFrames++;
  if (marked(m)) break;                                  // the final frame is green, judged below
  let written = 0, bad = 0;
  for (let off = 0; off < 0x1800; off++) {
    if (off === ISR_BYTE - 0x4000) continue;
    const v = shownByte(m, off), want = model(off);
    if (v === want && want !== 0) written++;
    else if (v !== 0) { bad++; if (!firstBad) firstBad = `frame ${runFrames}, offset ${off}: shown ${v}, model ${want}`; }
  }
  if (bad) badFrames++;
  if (written < lastWritten) fallBack++;
  lastWritten = written;
}
C.check('every frame showed display RAM (model bytes or 0), never DOCK bytes', badFrames === 0, badFrames ? `${badFrames} frames, ${firstBad}` : `${runFrames} frames`);
C.check('written bytes on screen never decrease', fallBack === 0);

// The record.
const R = S.RESULT;
C.check('record: pass', marked(m) && m.ram[R + 2] === 1, `state ${m.ram[R + 2]}, kind ${m.ram[R + 3]}, address $${rd16(m, R + 10).toString(16)}`);
C.check('record: 2,000 iterations', rd16(m, R + 4) === N, `${rd16(m, R + 4)}`);
C.check('record: interrupts while mapped > 0', rd16(m, R + 8) > 0, `${rd16(m, R + 8)} of ${rd16(m, R + 6)}`);
C.check('no interrupt lost in the frames run normally (within 1)', Math.abs((rd16(m, R + 6) - isrAtStep) - (runFrames - 60)) <= 1,
  `ISR ${rd16(m, R + 6) - isrAtStep}, frames ${runFrames - 60}; the 60 stepped frames had ${isrAtStep} interrupts`);
let green = true;
for (let a = 0x5800; a < 0x5B00; a++) if (m.ram[a] !== 0x20) green = false;
C.check('final attributes green', green);
C.done();
