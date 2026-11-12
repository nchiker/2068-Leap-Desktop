"use strict";
// review-ay.mjs -- independent review, question 4: a main-program AY access that follows section 7's rule ("store the shadow,
// then OUT the latch") with the frame interrupt at every pair of boundaries.  The stub is poked into RAM ($C800); no source changes.
import { start, setInput, setCall, step, runIsr, snapshot, restore } from './review-lib.mjs';
const { m, S } = start();
const lo = S.K_AYREG & 255, hi = S.K_AYREG >> 8;
const GOOD = [0x3E, 8, 0x32, lo, hi, 0xD3, 0xF5, 0x3E, 0x0D, 0xD3, 0xF6,        // LD A,8 / LD (K_AYREG),A / OUT ($F5),A / LD A,$0D / OUT ($F6),A
  0x3E, 3, 0x32, lo, hi, 0xD3, 0xF5, 0xDB, 0xF6, 0xC9];                         // LD A,3 / LD (K_AYREG),A / OUT ($F5),A / IN A,($F6) / RET
const BAD = [0x3E, 8, 0xD3, 0xF5, 0x32, lo, hi, 0x3E, 0x0D, 0xD3, 0xF6,         // the OUT before the store (against the rule)
  0x3E, 3, 0xD3, 0xF5, 0x32, lo, hi, 0xDB, 0xF6, 0xC9];
const base = snapshot(m);
for (const [name, code] of [['rule followed (store, then OUT)', GOOD], ['rule broken (OUT, then store)', BAD]]) {
  let runs = 0, bad = 0, first = '';
  const N = 10;
  for (let i = 0; i <= N; i++) for (let j = i; j <= N; j++) {
    restore(m, base);
    m.ram.set(code, 0xC800); m.ay.regs[3] = 0x0A; m.ay.regs[8] = 0; const r14 = m.ay.regs[14], r7 = m.ay.regs[7];
    setCall(m, S, 0xC800, {}, true);
    let n = 0, done = 0;
    for (;;) {
      for (const b of [i, j]) if (b === n && done < 2 && (b !== i || done === 0 || i === j)) { if ((b === i && done === 0) || (b === j && done === 1)) { setInput(m, new Uint8Array(8), done ? 0x7B : 0xF7); runIsr(m, S, null); done++; } }
      if (m.cpu.pc === S.T_RET) break;
      step(m); n++;
    }
    runs++;
    const ok = m.ay.regs[8] === 0x0D && m.cpu.a === 0x0A && m.ayLatch === 3 && m.ay.regs[14] === r14 && m.ay.regs[7] === r7 && m.ay.regs[3] === 0x0A;
    if (!ok) { bad++; if (!first) first = `interrupts at boundaries ${i},${j}: R8 ${m.ay.regs[8]} (want 13), A ${m.cpu.a} (want 10), R14 ${m.ay.regs[14]} (was ${r14}), latch ${m.ayLatch}`; }
  }
  console.log(`${name}: ${runs} runs, ${bad} wrong${first ? ' (first: ' + first + ')' : ''}`);
}
