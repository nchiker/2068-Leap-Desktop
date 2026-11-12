"use strict";
// review-hw.mjs -- independent review: two things outside the frame-atomic input the other tests use.
//  1. The keyboard changes between K_POLL's all-rows read and its half-row reads (contact bounce on real hardware; impossible in
//     an emulator that changes keys only between frames).
//  2. Many keys newly down in one frame: the ISR's time, and whether a frame interrupt is lost.
import { start, setInput, step, runIsr, snapshot, restore, hex, Z, M } from './review-lib.mjs';

const { m, S } = start();
const NONE = () => new Uint8Array(8);
const keys = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
const tail = () => m.ram[S.K_RTAIL], ring = (i) => [...m.ram.subarray(S.K_RING + (i & 63), S.K_RING + (i & 63) + 4)];
const isr = (rows, joy = 0xFF) => { setInput(m, rows, joy); return runIsr(m, S, null); };
const base = snapshot(m);

// ---- 1. bounce
{
  const A = 5;
  isr(keys(A));                                       // frame 1: A down -> E_KEY 'a'
  const t1 = tail(); console.log(`1. frame 1, A down: ring record ${ring(t1 - 4)} (E_KEY 'a' = 1,97,0,0)`);
  isr(keys(A));                                       // frame 2: held
  // frame 3: the key is releasing and bounces: open at the all-rows read, closed again at the half-row reads
  setInput(m, NONE(), 0xFF);
  const cpu = m.cpu, pc0 = cpu.pc, sp0 = cpu.sp;
  m.tstates += Z.irqZ80(cpu, m.bus);
  const after = S['K_POLL.keys'] + 3;                 // XOR A / IN A,($FE) done
  let switched = false;
  while (!(cpu.pc === pc0 && cpu.sp === sp0)) { if (cpu.pc === after && !switched) { setInput(m, keys(A), 0xFF); switched = true; } step(m); }
  console.log(`   frame 3, bounce inside the ISR (open at the all-rows read, closed ${switched ? 'at' : 'NOT at'} the half-row reads): K_KANY ${m.ram[0xF098]}, K_NOW row 1 = ${m.ram[S.K_NOW + 1]}`);
  for (let f = 0; f < 5; f++) isr(NONE());            // released for good
  console.log(`   5 frames with no key: K_NOW row 1 = ${m.ram[S.K_NOW + 1]} (stale: the key reads as still down)`);
  const t0 = tail();
  for (let f = 0; f < 3; f++) isr(keys(A));           // the user presses A again
  console.log(`   A pressed again for 3 frames: ${(tail() - t0) / 4} event(s) appended (the contract's E_KEY for a key that went down: 1)`);
  console.log((tail() - t0) === 0 ? '   => CONFIRMED: the press is lost (and its old repeat state is still armed)' : '   => not reproduced');
  let rep = 0; for (let f = 0; f < 40; f++) { const t = tail(); isr(keys(A)); if (tail() !== t) rep++; }
  console.log(`   held 40 more frames: ${rep} repeat event(s), data 2 of the last ${hex(ring(tail() - 4)[2], 2)}`);
  restore(m, base);
}

// ---- 1b. the same bounce in keyboard-pointer mode
{
  const px = () => m.ram[S.K_PX] | (m.ram[S.K_PX + 1] << 8);
  isr(keys(0, 36)); isr(NONE());                      // CS + SS: mode on
  for (let f = 0; f < 3; f++) isr(keys(25, 35));      // P (right) and SPACE (button) held
  setInput(m, NONE(), 0xFF);
  const cpu = m.cpu, pc0 = cpu.pc, sp0 = cpu.sp;
  m.tstates += Z.irqZ80(cpu, m.bus);
  const after = S['K_POLL.keys'] + 3; let switched = false;
  while (!(cpu.pc === pc0 && cpu.sp === sp0)) { if (cpu.pc === after && !switched) { setInput(m, keys(25, 35), 0xFF); switched = true; } step(m); }
  const x0 = px();
  for (let f = 0; f < 50; f++) isr(NONE());           // nothing pressed at all
  console.log(`1b. keyboard-pointer mode ${m.ram[S.K_KPMODE]}, P + SPACE released with the same bounce, then 50 frames with no key and an idle joystick:`);
  console.log(`   K_PX ${x0} -> ${px()}, K_BTN ${m.ram[S.K_BTN]}  ${px() !== x0 || m.ram[S.K_BTN] ? '=> CONFIRMED: the pointer runs on and the button stays down until another key changes' : '=> not reproduced'}`);
  restore(m, base);
}

// ---- 2. many new keys in one frame
{
  const order = []; for (let k = 1; k < 40; k++) if (k !== 36) order.push(k);
  console.log('2. keys newly down in one frame -> ISR T (frame = ' + M.tStatesPerFrame + ' T), K_POLL stack, events appended / lost');
  for (const n of [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 38]) {
    restore(m, base);
    const r = isr(keys(...order.slice(0, n)), 0x75);  // with a move and the button
    console.log(`   ${String(n).padStart(2)} keys: ISR ${String(r.t).padStart(6)} T, stack ${r.depth}, ring ${(tail() / 4)} records, K_LOST ${m.ram[S.K_LOST]}`);
  }
  // in real frames: T_EVLOOP running, V_FRAMES against frames run
  for (const n of [16, 24, 32, 38]) {
    restore(m, base);
    m.cpu.pc = S.T_EVLOOP; m.cpu.sp = 0xFF00;
    for (let f = 0; f < 4; f++) M.runFrame(m);
    const v0 = m.ram[S.V_FRAMES] | (m.ram[S.V_FRAMES + 1] << 8);
    let frames = 0;
    for (let c = 0; c < 10; c++) {                    // press n keys for 2 frames, release for 2
      setInput(m, keys(...order.slice(0, n)), 0xFF); M.runFrame(m); M.runFrame(m);
      setInput(m, NONE(), 0xFF); M.runFrame(m); M.runFrame(m); frames += 4;
    }
    for (let f = 0; f < 4; f++) { M.runFrame(m); frames++; }
    const v1 = m.ram[S.V_FRAMES] | (m.ram[S.V_FRAMES + 1] << 8);
    console.log(`   real frames, ${n} keys pressed together 10 times: ${frames} frames run, V_FRAMES rose by ${(v1 - v0) & 0xFFFF}${((v1 - v0) & 0xFFFF) !== frames ? '  <-- frame interrupts lost' : ''}`);
  }
}

// ---- 3. the ISR with the main program's $F4 = $3F (application code in DOCK 2-3, display unmapped): it maps the display itself
//         and puts the shadow back.
{
  restore(m, base);
  m.ram[S.V_SHADOW_F4] = 0x3F; m.portF4 = 0x3F;
  let ok = true; const before = m.ram.slice(0x4000, 0x8000);
  for (let f = 0; f < 6; f++) { const r = isr(NONE(), 0xF5); if (m.portF4 !== 0x3F || r.changed.length) ok = false; }
  let wrote = 0; for (let i = 0; i < 0x4000; i++) if (m.ram[0x4000 + i] !== before[i]) wrote++;
  const dx = m.ram[S.PT_DX] | (m.ram[S.PT_DX + 1] << 8), kx = m.ram[S.K_PX] | (m.ram[S.K_PX + 1] << 8);
  console.log(`3. six ISRs with shadow $F4 = $3F: port after each ${ok ? '$3F' : 'WRONG'}; pointer drawn at x ${dx} (input x ${kx}, one frame behind while moving), ${wrote} display bytes changed`);
}
