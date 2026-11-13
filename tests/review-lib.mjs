"use strict";
// review-lib.mjs -- harness of the independent K2 review (tests/review-*.mjs).  Written from docs/OBJECTS_EVENTS.md sections 5-8
// and 14 and docs/GRAPHICS_SPIKE.md 16 only; it shares nothing with kern-model2.mjs / kern-k2.mjs except lib.mjs's boot().
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, ROOT } from '../tools/build.mjs';
import { boot, runFramesUntil, Z, M } from './lib.mjs';

export { Z, M };
export const hex = (v, n = 4) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');

export function start() {
  const b = build('kern3');
  const m = boot(b.dck), S = b.syms;
  const f = runFramesUntil(m, (mm) => mm.ram[S.RESULT] === 0xA5 && mm.ram[S.RESULT + 1] === 0x5A, 400);
  if (f < 0) throw new Error('kern3 did not boot');
  for (let i = 0; i < 3; i++) M.runFrame(m);          // the pointer is drawn; runFrame leaves the CPU at the next ISR's entry
  for (let i = 0; i < 100000 && !m.cpu.halted; i++) Z.runZ80(m.cpu, m.bus, 1, m);
  if (!m.cpu.halted) throw new Error('kern3 did not return to its idle HALT');
  m.cpu.halted = false; m.cpu.pc = S.T_RET; m.cpu.sp = 0xFF00; m.cpu.iff1 = m.cpu.iff2 = true; m.cpu.eiDelay = false;   // parked in T_RET's loop
  return { m, S, img: b.img };
}

export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), chance: (p) => next() < p, pick: (a) => a[Math.floor(next() * a.length)] };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Machine control
export function snapshot(m) {
  return { ram: m.ram.slice(), cpu: { ...m.cpu }, f4: m.portF4, ff: m.portFF, ayLatch: m.ayLatch, ay: m.ay.regs.slice(),
    keys: m.keyMatrix.slice(), joy: m.joystick.slice() };
}
export function restore(m, s) {
  m.ram.set(s.ram); Object.assign(m.cpu, s.cpu); m.portF4 = s.f4; m.portFF = s.ff; m.ayLatch = s.ayLatch; m.ay.regs.set(s.ay);
  m.keyMatrix.set(s.keys); m.joystick.set(s.joy);
}
export const step = (m) => { const t = m.tstates; Z.runZ80(m.cpu, m.bus, 1, m); return m.tstates - t; };

/** rows: 8 bytes, bit set = key down (bits 0-4).  joy: the raw active-low byte of joystick 1. */
export function setInput(m, rows, joy) {
  for (let r = 0; r < 8; r++) m.keyMatrix[r] = (~rows[r]) & 0x1F;
  m.joystick[0] = joy & 0xFF;
}

const REGS = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl', 'sp', 'pc'];
export const regsOf = (cpu) => REGS.map((r) => cpu[r]);
export const STACK_TOP = 0xFF00;

/** Prepare a direct call: return address T_RET at the stack top. */
export function setCall(m, S, addr, regs = {}, ints = true, rng = null) {
  const cpu = m.cpu;
  for (const r of REGS) if (r !== 'sp' && r !== 'pc') cpu[r] = rng ? rng.int(0, 255) : 0;
  const P = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  for (const [k, v] of Object.entries(regs)) { if (P[k]) { cpu[P[k][0]] = (v >> 8) & 255; cpu[P[k][1]] = v & 255; } else cpu[k] = v & 255; }
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = ints;
  cpu.sp = STACK_TOP - 2; m.ram[STACK_TOP - 2] = S.T_RET & 255; m.ram[STACK_TOP - 1] = S.T_RET >> 8;
  cpu.pc = addr;
}
/** Run a prepared call to its return with no interrupt.  Returns { t, stack } (stack: bytes used below the return address). */
export function runCall(m, S, guard = 2_000_000) {
  const cpu = m.cpu, t0 = m.tstates; let lo = cpu.sp, di = false;
  while (cpu.pc !== S.T_RET) {
    const op = m.bus.read(cpu.pc); if (op === 0xF3) di = true;
    step(m);
    if (cpu.sp >= 0xF800 && cpu.sp < lo) lo = cpu.sp;
    if (m.tstates - t0 > guard) throw new Error(`call did not return (PC ${hex(cpu.pc)})`);
  }
  return { t: m.tstates - t0, stack: STACK_TOP - 2 - lo, di };
}

/**
 * Take a frame interrupt now (between two instructions) and run the ISR to its RET.  Returns { t, depth, changed }:
 * depth = stack bytes used below the interrupted SP (return address included), by SP tracking and by a poison check;
 * changed = names of registers that differ afterwards (must be empty).
 */
export function runIsr(m, S, rng) {
  const cpu = m.cpu;
  if (!cpu.iff1 || cpu.eiDelay) throw new Error(`interrupt not acceptable at PC ${hex(cpu.pc)} (iff1 ${cpu.iff1}, eiDelay ${cpu.eiDelay})`);
  const before = regsOf(cpu), sp0 = cpu.sp, pc0 = cpu.pc, t0 = m.tstates;
  const POIS = 48, saved = m.ram.slice(sp0 - POIS, sp0), pois = new Uint8Array(POIS);
  for (let i = 0; i < POIS; i++) pois[i] = rng ? rng.int(0, 255) : (i * 37 + 11) & 255;
  m.ram.set(pois, sp0 - POIS);
  const wasHalted = cpu.halted;
  m.tstates += Z.irqZ80(cpu, m.bus);
  let lo = cpu.sp, di = false;
  while (!(cpu.pc === pc0 + (wasHalted ? 1 : 0) && cpu.sp === sp0) && !(cpu.pc === pc0 && cpu.sp === sp0)) {
    const op = m.bus.read(cpu.pc); if (op === 0xF3) di = true;
    step(m);
    if (cpu.sp >= 0xF800 && cpu.sp < lo) lo = cpu.sp;
    if (m.tstates - t0 > 400_000) throw new Error(`ISR did not return (PC ${hex(cpu.pc)})`);
  }
  let low = POIS;                                     // lowest poisoned byte changed
  for (let i = 0; i < POIS; i++) if (m.ram[sp0 - POIS + i] !== pois[i]) { low = i; break; }
  const depthPoison = POIS - low;
  m.ram.set(saved.subarray(0, POIS - Math.max(depthPoison, sp0 - lo)), sp0 - POIS);     // below the ISR's frames: as it was
  const after = regsOf(cpu), changed = [];
  REGS.forEach((r, i) => { if (r !== 'pc' && after[i] !== before[i]) changed.push(r); });
  return { t: m.tstates - t0, depth: Math.max(sp0 - lo, depthPoison), changed, di, iffOk: cpu.iff1 === true };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The key map, parsed from src/kernel/keymap.txt by 14.4's rules (independent of tools/gen-keymap.mjs).
export function readKeymap() {
  const NAMES = { ENTER: 13, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, DELETE: 12, TAB: 14, BACKTAB: 15, MENU: 16, CLOSE: 17, MARK: 18, ESC: 27, BREAK: 3, CAPS: 1, SPACE: 32, HASH: 35, DASH: 45 };
  const planes = [[], [], []];
  for (let line of readFileSync(join(ROOT, 'src/kernel/keymap.txt'), 'utf8').split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    for (let p = 0; p < 3; p++) {
      const e = f[1 + p];
      planes[p].push(e === '-' ? 0 : (NAMES[e] !== undefined ? NAMES[e] : (e.length === 1 ? e.charCodeAt(0) : NaN)));
    }
  }
  if (planes[0].length !== 40 || planes.flat().some(Number.isNaN)) throw new Error('keymap.txt: not 40 keys');
  return planes;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The reviewer's model of the queues and K_POLL (14.2, 14.3), plus P_ISRMOVE's effect (14.5).
export const E_KEY = 1, E_MOVE = 2, E_DOWN = 3, E_UP = 4, E_MODE = 9;
export class KModel {
  constructor(keymap) {
    this.keymap = keymap;
    this.ring = new Uint8Array(64); this.head = 0; this.tail = 0; this.lost = 0;
    this.postq = new Uint8Array(16); this.phead = 0; this.pn = 0; this.ev = [0, 0, 0, 0];
    this.px = 256; this.py = 96; this.btn = 0; this.kp = 0; this.caps = 0;
    this.old = new Uint8Array(8); this.hold = 0; this.rep = null; this.pend = 0; this.warpReq = null;
    this.ptx = 256; this.pty = 96; this.ptdirty = 0;
    this.log = [];                                    // events appended (for messages)
  }
  clone() {
    const c = new KModel(this.keymap);
    Object.assign(c, this, { ring: this.ring.slice(), postq: this.postq.slice(), ev: this.ev.slice(), old: this.old.slice(),
      rep: this.rep ? { ...this.rep } : null, warpReq: this.warpReq ? { ...this.warpReq } : null, log: [] });
    return c;
  }
  count() { return ((this.tail - this.head) & 255) >> 2; }
  enq(t, c, e, d) {
    this.log.push([t, c, e, d]);
    if (((this.tail - this.head) & 255) === 64) { this.lost = Math.min(255, this.lost + 1); return; }
    this.ring.set([t, c, e, d], this.tail & 63); this.tail = (this.tail + 4) & 255;
  }
  enqMove(c, e, d) {
    const last = (this.tail - 4) & 63;
    if (((this.tail - this.head) & 255) >= 8 && this.ring[last] === E_MOVE) { this.log.push([E_MOVE, c, e, d, 'coalesced']); this.ring.set([c, e, d], last + 1); } else this.enq(E_MOVE, c, e, d);
  }
  pdata() { return [this.px & 255, this.py, ((this.px >> 8) & 1) | (this.btn << 1)]; }
  /** rows: 8 bytes (bit set = down); joy: raw active-low byte; locked: PT_LOCK held. */
  poll(rows, joy, locked) {
    if (this.warpReq) { this.px = this.warpReq.x; this.py = this.warpReq.y; this.pend = 1; this.warpReq = null; }
    const down = (k) => (rows[(k / 5) | 0] >> (k % 5)) & 1;
    const anyNow = rows.some((r) => r & 0x1F), anyOld = this.old.some((r) => r);
    if (anyNow || anyOld) {
      const isNew = (k) => down(k) && !((this.old[(k / 5) | 0] >> (k % 5)) & 1);
      const cs = down(0), ss = down(36);
      let others = 0, newOthers = 0;
      for (let k = 0; k < 40; k++) if (k !== 0 && k !== 36) { others += down(k); newOthers += isNew(k) ? 1 : 0; }
      if (cs && ss && !others && (isNew(0) || isNew(36))) { this.kp ^= 1; this.enq(E_MODE, this.kp, 0, 0); this.rep = null; }
      if (this.kp === 0) {
        for (let k = 0; k < 40; k++) {
          if (k === 0 || k === 36 || !isNew(k)) continue;
          const plane = ss ? 2 : cs ? 1 : 0;
          let code = this.keymap[plane][k];
          if (code === 0) continue;
          if (code === 1) { this.caps ^= 1; this.rep = null; continue; }
          if (plane === 0 && this.caps && code >= 97 && code <= 122) code -= 32;
          const d2 = cs | (ss << 1) | (this.caps << 2);
          this.enq(E_KEY, code, d2, 0);
          this.rep = { k, code, d2, count: 30 };
        }
      }
      if (this.rep && !newOthers) {
        if (!down(this.rep.k)) this.rep = null;
        else if (--this.rep.count === 0) { this.enq(E_KEY, this.rep.code, this.rep.d2 | 0x80, 0); this.rep.count = 4; }
      }
      this.old.set(rows.map((r) => r & 0x1F));
    }
    let u = !(joy & 1), d = !(joy & 2), l = !(joy & 4), r = !(joy & 8), fire = !(joy & 0x80);
    if (u && d && l && r) u = d = l = r = fire = false;
    if (this.kp) { u ||= !!down(10); d ||= !!down(5); l ||= !!down(26); r ||= !!down(25); fire ||= !!down(35); }
    let s = 0;
    if (u || d || l || r) { s = Math.min(1 + Math.floor(this.hold / 6), 6); this.hold = Math.min(this.hold + 1, 30); } else this.hold = 0;
    const x = Math.max(0, Math.min(511, this.px + 2 * s * ((r ? 1 : 0) - (l ? 1 : 0))));
    const y = Math.max(0, Math.min(191, this.py + s * ((d ? 1 : 0) - (u ? 1 : 0))));
    const newBtn = fire ? 1 : 0, btnChanged = newBtn !== this.btn;
    this.btn = newBtn;                                // data 3 carries K_BTN after step 6
    if (x !== this.px || y !== this.py) { this.px = x; this.py = y; this.pend = 1; this.enqMove(...this.pdata()); }
    if (btnChanged) this.enq(newBtn ? E_DOWN : E_UP, ...this.pdata());
    if (this.pend && !locked) { this.ptx = this.px; this.pty = this.py; this.ptdirty = 1; this.pend = 0; }
  }
  getev() {
    if (this.pn > 0) { this.ev = [...this.postq.subarray(4 * this.phead, 4 * this.phead + 4)]; this.phead = (this.phead + 1) & 3; this.pn--; return { carry: 0, a: this.ev[0] }; }
    if (this.head !== this.tail) { const i = this.head & 63; this.ev = [...this.ring.subarray(i, i + 4)]; this.head = (this.head + 4) & 255; return { carry: 0, a: this.ev[0] }; }
    return { carry: 1 };
  }
  post(a, c, e, d) {
    if (this.pn === 4) return { carry: 1 };
    this.postq.set([a, c, e, d], 4 * ((this.phead + this.pn) & 3)); this.pn++; return { carry: 0 };
  }
  warp(x, y) { this.warpReq = { x: Math.max(0, Math.min(511, x)), y: Math.max(0, Math.min(191, y)) }; }
  /** Compare the interface memory (14.1) with the machine.  opts.pt: also PT_X / PT_Y; opts.dirty: also PT_DIRTY. */
  diff(m, S, opts = {}) {
    const out = [], r8 = (a) => m.ram[a], r16 = (a) => m.ram[a] | (m.ram[a + 1] << 8);
    const eq = (name, got, want) => { if (got !== want) out.push(`${name} machine ${got} model ${want}`); };
    for (let i = 0; i < 64; i++) if (m.ram[S.K_RING + i] !== this.ring[i]) { out.push(`ring byte ${i} (record ${i >> 2} +${i & 3}) machine ${m.ram[S.K_RING + i]} model ${this.ring[i]}`); break; }
    for (let i = 0; i < 16; i++) if (m.ram[S.K_POSTQ + i] !== this.postq[i]) { out.push(`postq byte ${i} machine ${m.ram[S.K_POSTQ + i]} model ${this.postq[i]}`); break; }
    eq('K_RHEAD', r8(S.K_RHEAD), this.head); eq('K_RTAIL', r8(S.K_RTAIL), this.tail); eq('K_PHEAD', r8(S.K_PHEAD), this.phead);
    eq('K_PN', r8(S.K_PN), this.pn); eq('K_LOST', r8(S.K_LOST), this.lost);
    for (let i = 0; i < 4; i++) eq(`K_EV+${i}`, r8(S.K_EV + i), this.ev[i]);
    eq('K_PX', r16(S.K_PX), this.px); eq('K_PY', r8(S.K_PY), this.py); eq('K_BTN', r8(S.K_BTN), this.btn);
    eq('K_KPMODE', r8(S.K_KPMODE), this.kp); eq('K_CAPS', r8(S.K_CAPS), this.caps);
    if (opts.pt) { eq('PT_X', r16(S.PT_X), this.ptx); eq('PT_Y', r8(S.PT_Y), this.pty); }
    if (opts.dirty) eq('PT_DIRTY', r8(S.PT_DIRTY), this.ptdirty);
    return out.length ? out.join('; ') : null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The display (mode 6): byte column c is in file c AND 1 at offset c >> 1 of the row.
export const rowOff = (y) => ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
export const scrAddr = (c, y) => ((c & 1) ? 0x6000 : 0x4000) + rowOff(y) + (c >> 1);
/** The two display files as one 12,288-byte array (file 1 then file 2). */
export function grab(m) { const d = new Uint8Array(12288); d.set(m.ram.subarray(0x4000, 0x5800), 0); d.set(m.ram.subarray(0x6000, 0x7800), 6144); return d; }
export function put(m, d) { m.ram.set(d.subarray(0, 6144), 0x4000); m.ram.set(d.subarray(6144), 0x6000); }
export const dIdx = (c, y) => ((c & 1) ? 6144 : 0) + rowOff(y) + (c >> 1);
/** Draw the arrow (16 rows of mask, image, mask, image at `arrow`) over background d at (x, y): (old AND mask) OR image. */
export function drawArrow(d, arrow, x, y) {
  const out = d.slice(), p = x & 7, c0 = x >> 3;
  for (let row = 0; row < 16 && y + row < 192; row++) {
    const a = arrow.subarray(4 * row, 4 * row + 4);
    const mk = ((((0xFF << 24) | (a[0] << 16) | (a[2] << 8) | 0xFF) >>> 0) / (1 << p)) & 0xFFFFFF;   // 1s shifted in from the left
    const im = (((a[1] << 16) | (a[3] << 8)) >>> p) & 0xFFFFFF;
    for (let k = 0; k < 3 && c0 + k < 64; k++) {
      const i = dIdx(c0 + k, y + row), sh = 16 - 8 * k;
      out[i] = (out[i] & ((mk >> sh) & 255)) | ((im >> sh) & 255);
    }
  }
  return out;
}
export function firstDiff(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) {
    const f = i >= 6144 ? 1 : 0, o = i - 6144 * f, col = ((o & 31) << 1) | f, y = ((o >> 5) & 0xC0) | ((o >> 8) & 7) | ((o >> 2) & 0x38);
    let n = 0; for (let j = 0; j < a.length; j++) if (a[j] !== b[j]) n++;
    return `${n} byte(s) differ, first at byte column ${col}, row ${y}: ${hex(a[i], 2)} vs ${hex(b[i], 2)}`;
  }
  return null;
}
