"use strict";
// snd-lib.mjs -- the AY write log of tests/snd-s1.mjs (docs/SOUND.md 6).  Wraps m.bus.ioWrite: every write to port $F5 (register select) and $F6 (data) is logged with the frame
// being run, the register the data went to (the chip's latch at that moment) and the PC.  A model of the sound table gives the writes a sound must make, frame by frame.
import * as H from './shell-lib.mjs';
import { parsePatches, applyPatches, argVal } from './bank-lib.mjs';
export { H };
export const L = H.L;
export const hex = (v, n = 4) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

// docs/SOUND.md 6: the table (period, volume, frames, next); ids 1-9.  Id 5 (win) and 7-9 are the puzzle's run; 6 is the alert's second tone.
export const TAB = { 1: [60, 8, 2, 0], 2: [90, 8, 3, 0], 3: [125, 8, 6, 6], 4: [500, 8, 12, 0], 5: [125, 8, 3, 7], 6: [165, 8, 6, 0], 7: [94, 8, 3, 8], 8: [74, 8, 3, 9], 9: [62, 8, 10, 0] };
export const MIXER = 0x3E;

/** The log: { sel: [{ f, v, pc }], dat: [{ f, reg, v, pc }], cur } -- cur is the number of the frame being run (frames completed + 1), between frames the completed count. */
export function makeAyLog() {
  const log = { sel: [], dat: [], all: [], cur: 0, on: true, shadow: 0xF085 };      // all: every raw write in order ({ k: 'S' | 'D', v, f, pc })
  log.setup = (m) => {
    const w0 = m.bus.ioWrite;
    m.bus.ioWrite = (port, value) => {
      const p = port & 0xFF;
      if (log.on && p === 0xF5) { log.sel.push({ f: log.cur, v: value & 0xFF, pc: m.cpu.pc, shadow: m.ram[log.shadow] }); log.all.push({ k: 'S', v: value & 0xFF, f: log.cur, pc: m.cpu.pc }); }
      else if (log.on && p === 0xF6) { log.dat.push({ f: log.cur, reg: m.ayLatch & 0x0F, v: value & 0xFF, pc: m.cpu.pc, latch: m.ayLatch, shadow: m.ram[log.shadow] }); log.all.push({ k: 'D', v: value & 0xFF, f: log.cur, pc: m.cpu.pc, reg: m.ayLatch & 0x0F }); }
      w0(port, value);
    };
  };
  log.attach = (env) => {                              // frame numbers: the frame being run is frames + 1; between frames, the number completed
    const f0 = env.frame;
    log.cur = env.frames;
    env.frame = () => { log.cur = env.frames + 1; try { f0(); } finally { log.cur = env.frames; } };
  };
  log.clear = () => { log.sel.length = 0; log.dat.length = 0; log.all.length = 0; };
  return log;
}

/** Boot desk5 (the shell, or program `prog`) with the AY log wrapped from the first instruction. */
export function boot(opts = {}) {
  const log = makeAyLog();
  const env = H.bootShell({ video: false, ...opts, setup: log.setup });
  log.attach(env); env.log = log;
  const patches = parsePatches(argVal('--patch', ''));                 // --patch ADDR=BYTE[,...] (hex): plants a mutation in the machine's copy of the cartridge, to see that the checks bite
  if (patches.length) applyPatches(env.m, patches, 'snd-s1');
  return { env, log };
}

/** What a sound started at frame F (by main code, between frames: F = frames completed) writes: the four writes at F, then the tick's writes (chain and silence) frame by frame.
 *  Returns [{ f, reg, v }] up to the final r8 = 0.  A tick fires in each frame F+1.. (the ISR is at the frame's start); a sound with n frames ends in frame F + n. */
export function modelSound(id, F, opts = {}) {
  const out = [];
  let f = F, cur = id;
  for (let guard = 0; guard < 20; guard++) {
    const [per, vol, n, next] = TAB[cur];
    out.push({ f, reg: 7, v: MIXER }, { f, reg: 0, v: per & 0xFF }, { f, reg: 1, v: per >> 8 }, { f, reg: 8, v: vol });
    f += n;
    if (!next) { out.push({ f, reg: 8, v: 0 }); return out; }
    cur = next;
  }
  throw new Error('modelSound: chain too long');
}
export const fmt = (list) => list.map((e) => `f${e.f} r${e.reg}=${e.v}`).join(' ');
/** The data writes of the log as { f, reg, v }, optionally from index i. */
export const dataOf = (log, i = 0) => log.dat.slice(i).map((e) => ({ f: e.f, reg: e.reg, v: e.v }));

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The model of the sound engine (docs/SOUND.md 6).  Time is the frame number f: the frame ISR (the tick) runs at the start of frame f, then main code.
//   beep(f, id)  K_BEEP in frame f (after that frame's tick); nothing when sound is off.   set(f, on)  K_SNDSET (off: n = 0 and r8 = 0 at once).
//   exp          the expected data writes [{ f, reg, v }] in order;  regs  the AY registers 0, 1, 7, 8 as the model holds them.
export class AyModel {
  constructor(on = true, last = 0) { this.n = 0; this.next = 0; this.on = on; this.last = last; this.exp = []; this.regs = { 0: null, 1: null, 7: null, 8: null }; }
  w(f, reg, v) { this.exp.push({ f, reg, v }); this.regs[reg] = v; }
  advance(f) { while (this.last < f) { this.last++; this.tick(this.last); } }
  tick(f) { if (!this.n) return; this.n--; if (this.n) return; if (this.next) this.start(f, this.next); else this.w(f, 8, 0); }
  start(f, id) {
    const [per, vol, n, next] = TAB[id];
    this.n = 0; this.w(f, 7, MIXER); this.w(f, 0, per & 0xFF); this.w(f, 1, per >> 8); this.w(f, 8, vol); this.next = next; this.n = n;
  }
  beep(f, id) { this.advance(f); if (this.on) this.start(f, id); }
  set(f, on) { this.advance(f); this.on = !!on; if (!on) { this.n = 0; this.w(f, 8, 0); } }
}
const same = (a, b) => a.f === b.f && a.reg === b.reg && a.v === b.v;
/**
 * The real events: log.dat[i0..] against the model.  `wants` are the main-code events in order: a sound id, 'off' (K_SNDSET 0) or 'on' (K_SNDSET 1, which writes nothing).  Each main-code event is recognised as a write that the model
 * does not predict (a chain start or a silence is the tick's and is predicted); the event takes the next want.  `endF`: the model runs to it (the log must hold every write up to then).
 * Returns a list of mismatch texts (empty = the writes equal the model's, frame by frame).
 */
export function explain(log, i0, wants, endF, on = true) {
  const mdl = new AyModel(on, log.dat[i0] ? log.dat[i0].f - 1 : endF), L = log.dat.slice(i0), mains = wants.slice(), errs = [];
  let j = 0, p = 0;
  while (j < L.length && errs.length < 3) {
    const e = L[j];
    mdl.advance(e.f);
    if (p < mdl.exp.length) {
      if (!same(e, mdl.exp[p])) { errs.push(`write ${j}: f${e.f} r${e.reg}=${e.v}, the model has f${mdl.exp[p].f} r${mdl.exp[p].reg}=${mdl.exp[p].v}`); break; }
      j++; p++; continue;
    }
    if (!mains.length) { errs.push(`write ${j}: f${e.f} r${e.reg}=${e.v} that no event or tick explains`); break; }
    while (mains[0] === 'on') { mains.shift(); mdl.on = true; }                  // K_SNDSET 1 writes nothing: it is told to the model at the next event
    const w = mains.shift();
    if (w === 'off') mdl.set(e.f, false); else mdl.beep(e.f, w);
    if (p >= mdl.exp.length) { errs.push(`event ${w} at f${e.f} writes nothing in the model but the log has r${e.reg}=${e.v}`); break; }
  }
  if (!errs.length) {
    mdl.advance(endF);
    if (p < mdl.exp.length) errs.push(`the model has ${mdl.exp.length - p} more write(s): f${mdl.exp[p].f} r${mdl.exp[p].reg}=${mdl.exp[p].v}...`);
    if (mains.some((x) => x !== 'on')) errs.push(`event(s) never seen in the log: ${mains.join(',')}`);
  }
  return errs;
}
