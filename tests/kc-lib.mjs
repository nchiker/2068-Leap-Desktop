"use strict";
// kc-lib.mjs -- harness of the Key Caps tests (tests/kc-k1.mjs) and of the other suites' program 2 checks: Key Caps' views read from the machine and its screen against tests/kc-model.mjs.
// Written from docs/KEYCAPS.md and docs/APPLIB.md; it never builds (build/desk5.dck and out.sym, through tests/calc-lib.mjs).
import * as L from './calc-lib.mjs';
import * as K from './kc-model.mjs';
import { readDisp, diffDisp } from './wm-lib.mjs';

export { L, K, readDisp, diffDisp };
export const { hex, rd16 } = L;
export const KC_NEEDED = ['KEYMAP', 'K_NOW', 'K_MODS', 'KC_START', 'KC_END', 'KC_IMG_LEN', 'KC_P', 'KC_DOWN', 'KC_OLD', 'KC_MODE', 'KC_STAT', 'KC_WIN', 'KC_KB', 'KC_LBL', 'CL_KeyCaps', 'CL_Check', 'CL_Label', 'CL_CWindow',
  'Check_text', 'Label_text', 'Window_title', 'AL_RAM', 'PROG_IMG'];
export const needKC = (S) => { const miss = KC_NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); };

/** The cartridge's KEYMAP (3 planes of 40 codes), read out of the assembled image at S.KEYMAP. */
export const readKeymap = (env) => Uint8Array.from(env.load.mem.subarray(env.S.KEYMAP, env.S.KEYMAP + 120));
export const readStrText = (m, a) => (a ? String.fromCharCode(...m.ram.subarray(a + 1, a + 1 + m.ram[a])) : '');
/** The keys down, as the kernel's K_NOW holds them (8 half-row bytes, bit set = down): a Set of k = 5 x half-row + bit. */
export function nowKeys(m, S) { const s = new Set(); for (let k = 0; k < 40; k++) if (m.ram[S.K_NOW + (k / 5 | 0)] & (1 << (k % 5))) s.add(k); return s; }

/** Key Caps' window and its views as the machine holds them: { win, radios: [3 views], kb, lbl } or null. */
export function kcViews(env) {
  const { m, S } = env, win = L.openWindows(m, S).find((w) => w.title === 'Key Caps');
  if (!win) return null;
  const kids = []; for (let v = win.child; v; v = L.readView(m, S, v).next) kids.push(L.readView(m, S, v));
  return { win, kids, radios: kids.filter((k) => k.cls === S.CL_Check), kb: kids.find((k) => k.cls === S.CL_KeyCaps), lbl: kids.find((k) => k.cls === S.CL_Label) };
}
/** What the machine's own state says: the radios' flags, the focus (index or -1), the status text, the keys down, the plane shown by the contract's rule from K_MODS and the checked radio. */
export function readKC(env) {
  const { m, S } = env, v = kcViews(env);
  if (!v || v.radios.length !== 3 || !v.kb || !v.lbl) return null;
  const flags = v.radios.map((r) => r.flags), foc = rd16(m, S.K_FOCUS), sel = flags.findIndex((f) => f & 8);
  const mods = m.ram[S.K_MODS], plane = (mods & 1) ? 1 : (mods & 2) ? 2 : sel;
  return { v, flags, focus: v.radios.findIndex((r) => r.a === foc), sel, status: readStrText(m, rd16(m, v.lbl.a + S.Label_text)), down: nowKeys(m, S), mods, plane };
}
/** The screen against the model's rendering of the machine's own state (covers: plain windows in front of Key Caps). null when equal. */
export function kcDiff(env, extra = [], covers = []) {
  const { m, S } = env, st = readKC(env);
  if (!st) return 'Key Caps is not open';
  const g = K.renderScreen({ keymap: readKeymap(env), flags: st.flags, focus: st.focus, status: st.status, plane: st.plane, down: st.down, active: covers.length === 0, covers });
  return diffDisp(readDisp(m), K.toDisp(g), L.pointerMask(m, S, extra));
}

// ---------------------------------------------------------------------------------------------------------------------------
// Drivers
/** The keys `ks` held `hold` frames (matrix keys by index), released, `rel` frames. */
export function hold(env, ks, hold = 5, rel = 5) { L.setKeys(env.m, ks); env.frames_(hold); L.setKeys(env.m, []); env.frames_(rel); }
/** Display bytes (y, bc) of every write in [0x4000, 0x8000) since the call, as a Set of y * 64 + bc: the bus write hook; `stop()` removes it and returns the set. */
export function watchDisplay(m) {
  const set = new Set(), w0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (a >= 0x4000 && a < 0x8000) {
      const file = (a >> 13) & 1, off = a & 0x1FFF;
      if (off < 0x1800) { const y = ((off >> 8) & 7) | (((off >> 5) & 7) << 3) | (((off >> 11) & 3) << 6), bc = (off & 31) * 2 + file; set.add(y * 64 + bc); }
    }
    w0(addr, v);
  };
  return { set, stop() { m.bus.write = w0; return set; } };
}
/** The display bytes a pixel rectangle covers, as a Set of y * 64 + bc. */
export function rectBytes(x, y, w, h) { const s = new Set(); for (let yy = y; yy < y + h; yy++) for (let bc = x >> 3; bc <= (x + w - 1) >> 3; bc++) s.add(yy * 64 + bc); return s; }
/**
 * A trace of the program's loop while frames run normally: ISR entries (PC $0038), K_GETEV entries (the loop's top), W_DRAWVIEW entries (with IX), and the HALT instructions, each with
 * the absolute T-state.  `stop()` removes the hooks and returns the events [{ e: 'ISR' | 'GETEV' | 'DRAW' | 'HALT', t, ix }].  A "busy period" runs from an ISR entry to the next HALT.
 */
export function traceLoop(env) {
  const { m, S } = env, cpu = m.cpu, ev = [], r0 = m.bus.read;
  let h = cpu.halted;
  m.bus.read = function (addr) {
    const a = addr & 0xFFFF;
    if (a === cpu.pc) {
      if (a === 0x38) ev.push({ e: 'ISR', t: m.tstates });
      else if (a === S.K_GETEV) ev.push({ e: 'GETEV', t: m.tstates });
      else if (a === S.W_DRAWVIEW) ev.push({ e: 'DRAW', t: m.tstates, ix: (cpu.xh << 8) | cpu.xl });
    }
    return r0(addr);
  };
  Object.defineProperty(cpu, 'halted', { configurable: true, get: () => h, set: (v) => { if (v && !h) ev.push({ e: 'HALT', t: m.tstates }); h = v; } });
  return { ev, stop() { m.bus.read = r0; Object.defineProperty(cpu, 'halted', { configurable: true, writable: true, enumerable: true, value: h }); return ev; } };
}
/** From a trace: the busy periods [{ t0 (ISR entry), t1 (HALT), draws: [{ ix, t0, t1 }] }] (a draw ends at the next K_GETEV entry or HALT after it). */
export function periodsOf(ev) {
  const out = []; let cur = null;
  for (let i = 0; i < ev.length; i++) {
    const x = ev[i];
    if (x.e === 'ISR' && !cur) cur = { t0: x.t, t1: null, draws: [] };
    else if (x.e === 'DRAW' && cur) { const end = ev.slice(i + 1).find((y) => y.e === 'GETEV' || y.e === 'HALT'); cur.draws.push({ ix: x.ix, t0: x.t, t1: end ? end.t : null }); }
    else if (x.e === 'HALT' && cur) { cur.t1 = x.t; out.push(cur); cur = null; }
  }
  return out;
}
/** The lowest address written in the stack's area [lo, 0xFF00) while armed: depth = 0xFF00 - min. */
export function watchStack(m, lo = 0xFE00) {
  const o = { min: 0xFF00 }, w0 = m.bus.write;
  m.bus.write = function (addr, v) { const a = addr & 0xFFFF; if (a >= lo && a < 0xFF00 && a < o.min) o.min = a; w0(addr, v); };
  o.depth = () => 0xFF00 - o.min;
  o.stop = () => { m.bus.write = w0; return o.depth(); };
  return o;
}
