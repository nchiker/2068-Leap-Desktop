"use strict";
// calc-lib.mjs -- shared harness of the Calculator tests (tests/calc-c1.mjs, tests/calc-perf.mjs).  Written from docs/CALCULATOR.md and
// docs/BANKING.md only (never from src/apps/calc.asm).  It never builds: it loads the prebuilt build/desk5.dck and build/desk5/out.sym.
//   - bootDesk5: boot, mouse attached before the first frame, the memory watch of BANKING 10.7 (makeWatch from bank-lib), the writes to the
//     Calculator's RAM image watched, V_FRAMES read after every normally run frame, frames until the program runs;
//   - directKey: C_KEY called directly under mapping A (CALCULATOR 3), with the T-states;
//   - keyboard and mouse drivers for frame-by-frame input;
//   - the screen as the contract's section 4 draws it (a gfx6-model rendering), and the view tree read from RAM.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { boot, M, Z } from './lib.mjs';
import { parseSym, readDisp } from './wm-lib.mjs';
import { makeWatch } from './bank-lib.mjs';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';
import { windowLook, buttonLook, toDisp } from './wm-model2.mjs';
import { drawBar, layoutOf, menuSpec } from './wm-model3.mjs';
import { readKeymap, makeRng } from './review-lib.mjs';

export { M, Z, makeRng, makeWatch, readDisp };
export const hex = (v, n = 4) => '$' + (v >>> 0).toString(16).toUpperCase().padStart(n, '0');
export const argv = process.argv.slice(2);
export const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt; };
export const argNum = (name, dflt) => { const v = argVal(name, null); return v === null ? dflt : Number(v); };
export const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
export const F4K = 0x33, F4A = 0x3F;

export const NEEDED = ['C_KEY', 'C_DSTR', 'C_MAIN', 'C_INIT', 'C_END', 'C_IMG', 'C_IMG_ADDR', 'C_IMG_LEN', 'C_WIN', 'C_DISP', 'K_PX', 'K_PY', 'V_FRAMES', 'V_SHADOW_F4',
  'V_SHADOW_FF', 'T_RET', 'CL_Button', 'CL_Window', 'CL_CDisp', 'View_x', 'View_y', 'View_w', 'View_h', 'View_flags', 'View_id', 'View_child', 'View_next', 'View_parent',
  'Button_text', 'Window_title', 'K_FAR', 'K_FAR_END', 'GFX6_CODE', 'GFX6_CODE_END', 'K_ROOT', 'K_FOCUS', 'PT_X', 'PT_Y', 'W_DRAWVIEW', 'K_MSET', 'K_BTN'];

/** The prebuilt cartridge: { dck, S, mem } (mem = the assembled 64 K image build/desk5/mem.bin). */
export function loadDesk5() {
  const dir = join(ROOT, 'build', 'desk5');
  if (!existsSync(join(dir, 'out.sym')) || !existsSync(join(ROOT, 'build', 'desk5.dck'))) throw new Error('build/desk5/out.sym or build/desk5.dck is missing');
  const S = parseSym(readFileSync(join(dir, 'out.sym'), 'utf8'));
  const missing = NEEDED.filter((n) => S[n] === undefined);
  if (missing.length) throw new Error(`desk5 does not define: ${missing.join(', ')}`);
  return { dck: readFileSync(join(ROOT, 'build', 'desk5.dck')), S, mem: new Uint8Array(readFileSync(join(dir, 'mem.bin'))) };
}

/** Calculator's variables: from C_WIN to the end of the image (everything before it is class, thunk, strings, menu table: constant). */
export const varRegion = (S) => [S.C_WIN, S.C_IMG_ADDR + S.C_IMG_LEN - 1];

/**
 * Boot the prebuilt desk5, the mouse attached before the first frame (so K_MSET reads its counters), the memory watch armed, and run normal frames
 * until the program is running (C_WIN set) plus `settle` frames.  Returns env = { m, S, w, load, vf, wr, frames }.
 *   w   the memory watch of BANKING 10.7 (bank-lib makeWatch; its violations are in w.n / w.summary())
 *   vf  V_FRAMES check state { checked, bad, first }, updated by env.frame()
 *   wr  writes to the RAM image outside the variables, once the program runs: { n, first: [] }
 * env.frame() runs one normal frame with the V_FRAMES check; env.frames(n) runs n.
 */
export function bootDesk5(opts = {}) {
  const load = loadDesk5(), S = load.S;
  const m = boot(load.dck);
  m.mouse.attached = true; m.mouse.x = 0; m.mouse.y = 0; m.mouse.buttons = 0xFF;
  const w = opts.watch === false ? { n: 0, kinds: {}, first: [], summary: () => 'watch off', on: false } : makeWatch(m, S);
  const vf = { checked: 0, bad: 0, first: '', started: false };
  const wr = { n: 0, first: [], armed: false };
  const [vlo, vhi] = varRegion(S);
  const wr0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (wr.armed && a >= S.C_IMG_ADDR && a <= vhi && a < vlo) { wr.n++; if (wr.first.length < 8) wr.first.push(`${hex(a)} <- ${hex(v, 2)}, PC ${hex(m.cpu.pc)}`); }
    wr0(addr, v);
  };
  let prev = rd16(m, S.V_FRAMES);
  const env = { m, S, w, load, vf, wr, frames: 0, direct: false };
  env.frame = () => {
    M.runFrame(m); env.frames++;
    const cur = rd16(m, S.V_FRAMES);
    if (vf.started) { vf.checked++; if (((cur - prev) & 0xFFFF) !== 1) { vf.bad++; if (!vf.first) vf.first = `frame ${env.frames}: V_FRAMES ${prev} -> ${cur}`; } }
    else if (prev === 0 && cur === 1) vf.started = true;   // random at power-on and cleared by the boot (DI for about 130 frames): count from the first ISR
    prev = cur;
  };
  env.frames_ = (n) => { for (let i = 0; i < n; i++) env.frame(); };
  const maxFrames = opts.maxFrames ?? 500;
  let ready = false;
  // before the first ISR the image variables are the copy's or power-on noise: wait for the first ISR, then for C_WIN
  for (let i = 0; i < maxFrames; i++) { env.frame(); if (vf.started && rd16(m, S.C_WIN) !== 0) { ready = true; break; } }
  if (!ready) throw new Error(`desk5: the program did not start in ${maxFrames} frames (C_WIN stays 0)`);
  env.bootFrames = env.frames;
  env.frames_(opts.settle ?? 12);
  wr.armed = true;
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Direct calls of C_KEY (mapping A).
export const readDstr = (m, S) => { const n = m.ram[S.C_DSTR]; return String.fromCharCode(...m.ram.subarray(S.C_DSTR + 1, S.C_DSTR + 1 + Math.min(n, 16))) + (n > 16 ? '...' : ''); };

/** Park the CPU outside any routine for direct calls (interrupts off; no frame is run while parked). */
export function park(env) {
  const { m, S } = env, cpu = m.cpu;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false; cpu.sp = 0xFF00; cpu.pc = S.T_RET;
  env.direct = true;
}

const REGS8 = ['b', 'c', 'd', 'e', 'h', 'l', 'xh', 'xl', 'yh', 'yl'];
/**
 * Call C_KEY with A = k under mapping A ($F4 = shadow = $3F), the sentinel return, interrupts off; back to $33 afterwards.  Other registers are
 * random when `rng` is given (the contract names only A).  Returns the T-states.
 */
export function directKey(env, k, rng = null, guard = 3_000_000) {
  const { m, S } = env, cpu = m.cpu;
  m.ram[S.V_SHADOW_F4] = F4A; m.portF4 = F4A;
  cpu.a = k & 0xFF; cpu.f = rng ? rng.int(0, 255) : 0;
  for (const r of REGS8) cpu[r] = rng ? rng.int(0, 255) : 0;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = 0xFF00 - 2; m.ram[0xFF00 - 2] = S.T_RET & 0xFF; m.ram[0xFF00 - 1] = S.T_RET >> 8;
  cpu.pc = S.C_KEY;
  const t0 = m.tstates, ret = S.T_RET;
  let steps = 0;
  while (cpu.pc !== ret) {
    Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.halted) throw new Error(`C_KEY(${k}): the CPU halted at ${hex(cpu.pc)}`);
    if (++steps > guard) throw new Error(`C_KEY(${k}): no return after ${steps} instructions (PC ${hex(cpu.pc)})`);
  }
  const t = m.tstates - t0;
  if (cpu.sp !== 0xFF00) throw new Error(`C_KEY(${k}): SP ${hex(cpu.sp)} after the return, want $FF00`);
  m.ram[S.V_SHADOW_F4] = F4K; m.portF4 = F4K;
  return t;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Keyboard: key codes to matrix keys through src/kernel/keymap.txt.
let KM = null;
/** The matrix key indices (5 row + bit) to hold for the key code `code`: [] when nothing types it. */
export function keysFor(code) {
  KM ??= readKeymap();
  for (const [p, mods] of [[0, []], [1, [0]], [2, [36]]]) {
    const k = KM[p].indexOf(code);
    if (k >= 0 && k !== 0 && k !== 36) return [...mods, k];
  }
  throw new Error(`no key types code ${code}`);
}
export function setKeys(m, list) {
  const rows = new Array(8).fill(0);
  for (const k of list) rows[(k / 5) | 0] |= 1 << (k % 5);
  for (let r = 0; r < 8; r++) m.keyMatrix[r] = (~rows[r]) & 0x1F;
}
/** Hold the key for `code` for `hold` frames, then release for `rel` frames (so no auto-repeat: the first repeat is after 30 frames). */
export function typeCode(env, code, hold = 3, rel = 3) {
  const list = keysFor(code);
  setKeys(env.m, list); env.frames_(hold);
  setKeys(env.m, []); env.frames_(rel);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Mouse: the pointer is moved by counter deltas (1:1 pixels; y counter grows as the mouse moves up); buttons active low, left = bit 1.
export const MOUSE_UP = 0xFF, MOUSE_LEFT = 0xFD;
export const pointerPos = (m, S) => [rd16(m, S.K_PX), m.ram[S.K_PY]];
/** Move the pointer to (tx, ty) in steps of at most 80 counts a frame; returns true when it got there. */
export function moveTo(env, tx, ty) {
  const { m, S } = env;
  for (let i = 0; i < 30; i++) {
    const [px, py] = pointerPos(m, S);
    const dx = tx - px, dy = ty - py;
    if (dx === 0 && dy === 0) return true;
    const sx = Math.max(-80, Math.min(80, dx)), sy = Math.max(-80, Math.min(80, dy));
    m.mouse.x = (m.mouse.x + sx) & 0xFF; m.mouse.y = (m.mouse.y - sy) & 0xFF;
    env.frame();
  }
  const [px, py] = pointerPos(m, S);
  return px === tx && py === ty;
}
/** Click at (tx, ty): move there, hold the left button `hold` frames, release and wait `rel` frames.  Returns false when the pointer did not arrive. */
export function click(env, tx, ty, hold = 3, rel = 6) {
  const ok = moveTo(env, tx, ty);
  env.m.mouse.buttons = MOUSE_LEFT; env.frames_(hold);
  env.m.mouse.buttons = MOUSE_UP; env.frames_(rel);
  return ok;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The view tree read from RAM (class word at +0, parent +2, child +4, next +6, x +8 (word), y +10, w +11 (word), h +13, flags +14, id +15).
export function readStr(m, a) { if (!a) return null; const n = m.ram[a]; return Array.from(m.ram.subarray(a + 1, a + 1 + n)); }
export function readView(m, S, a) {
  return { a, cls: rd16(m, a), x: rd16(m, a + S.View_x), y: m.ram[a + S.View_y], w: rd16(m, a + S.View_w), h: m.ram[a + S.View_h],
    flags: m.ram[a + S.View_flags], id: m.ram[a + S.View_id], child: rd16(m, a + S.View_child), next: rd16(m, a + S.View_next) };
}
/** All views below `a` (depth first), each with its kind ('Window' | 'Button' | 'CDisp' | other) and, for a Button, its text codes. */
export function walkTree(m, S, a, out = [], depth = 0) {
  for (let v = a, n = 0; v && n < 64; v = rd16(m, v + S.View_next), n++) {
    const r = readView(m, S, v);
    r.kind = r.cls === S.CL_Button ? 'Button' : r.cls === S.CL_Window ? 'Window' : r.cls === S.CL_CDisp ? 'CDisp' : `class ${hex(r.cls)}`;
    if (r.kind === 'Button') r.text = readStr(m, rd16(m, v + S.Button_text));
    if (r.kind === 'Window') r.title = readStr(m, rd16(m, v + S.Window_title));
    r.depth = depth; out.push(r);
    if (r.child) walkTree(m, S, r.child, out, depth + 1);
  }
  return out;
}
export const allViews = (m, S) => walkTree(m, S, rd16(m, S.K_ROOT));
/** The contract's section 4 geometry: Window and CDisp rects, 20 buttons (text, id, x, y). */
export const WIN = { x: 160, y: 24, w: 176, h: 144, title: 'Calculator' };
export const DISP = { x: 168, y: 40, w: 160, h: 16 };
export const BUTTONS = (() => {
  const rows = [['C', 27], ['CE', 'e'], ['+/-', 'n'], ['/', '/'], ['7', '7'], ['8', '8'], ['9', '9'], ['*', '*'], ['4', '4'], ['5', '5'], ['6', '6'], ['-', '-'],
    ['1', '1'], ['2', '2'], ['3', '3'], ['+', '+'], ['0', '0'], ['.', '.'], ['Del', 12], ['=', '=']];
  return rows.map(([text, id], i) => ({ text, id: typeof id === 'number' ? id : id.charCodeAt(0), x: 172 + 40 * (i % 4), y: 64 + 20 * ((i / 4) | 0), w: 32, h: 16, col: i % 4, row: (i / 4) | 0 }));
})();
export const centre = (b) => [b.x + (b.w >> 1), b.y + (b.h >> 1)];
const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));

/**
 * The screen as the contract draws it (section 4), as a Gfx6Model: the desk, the menu bar with "Calc", the active Window, CDisp showing `dstr`
 * (CLR fill, SET frame, the text right aligned at x + w - 4 - tw, y + 4) and the 20 buttons, the one at address `focusAddr` (or none) underlined.
 * `btnAddrs` maps button index -> address (for the focus), `flagsOf(i)` gives a button's flags (default 1).
 */
export function renderScreen(dstr, focusIndex = -1, flagsOf = () => 1) {
  const g = new Gfx6Model();
  g.setOp(OP_CLR); g.fill(0, 8, 512, 184);
  drawBar(g, [menuSpec(1, 'Calc', [[1, 0, 'Clear'], [2, 0, 'Clear entry']])], layoutOf([menuSpec(1, 'Calc', [[1, 0, 'Clear'], [2, 0, 'Clear entry']])]));
  windowLook(g, { x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h, title: { codes: codesOf(WIN.title) } }, true);
  const cs = codesOf(dstr), tw = g.textw(cs);
  g.setOp(OP_CLR); g.fill(DISP.x, DISP.y, DISP.w, DISP.h);
  g.setOp(OP_SET); g.frame(DISP.x, DISP.y, DISP.w, DISP.h);
  g.textp(DISP.x + DISP.w - 4 - tw, DISP.y + 4, cs);
  BUTTONS.forEach((b, i) => buttonLook(g, { x: b.x, y: b.y, w: b.w, h: b.h, flags: flagsOf(i), text: { codes: codesOf(b.text) } }, i === focusIndex));
  return g;
}
/** Display bytes mask that leaves out the pointer: both byte rectangles (the position K_PX/K_PY and the drawn one PT_X/PT_Y), 3 byte columns by 16 rows. */
export function pointerMask(m, S, extra = []) {
  const mask = new Uint8Array(192 * 64).fill(0xFF);
  const spots = [[rd16(m, S.K_PX), m.ram[S.K_PY]], [rd16(m, S.PT_X), m.ram[S.PT_Y]], ...extra];
  for (const [px, py] of spots) {
    const c0 = px >> 3;
    for (let y = py; y < Math.min(py + 16, 192); y++) for (let c = c0; c <= Math.min(c0 + 2, 63); c++) mask[y * 64 + c] = 0;
  }
  return mask;
}
/** First difference of two display arrays under a mask, as text, or null. */
export function diffMasked(a, b, mask) {
  let first = -1, n = 0;
  for (let i = 0; i < a.length; i++) if ((a[i] ^ b[i]) & mask[i]) { n++; if (first < 0) first = i; }
  if (first < 0) return null;
  const y = first >> 6, bc = first & 63;
  return `${n} byte(s) differ, first at pixel row ${y}, byte column ${bc} (x ${bc * 8}..${bc * 8 + 7}): screen $${a[first].toString(16)}, want $${b[first].toString(16)}`;
}
/** The focused button's index (by tree order of the 20 BUTTONS' rectangles), -1 when none, -2 when the focus is on something else. */
export function focusIndex(m, S, views) {
  const f = rd16(m, S.K_FOCUS);
  if (!f) return -1;
  const v = views.find((x) => x.a === f);
  if (!v || v.kind !== 'Button') return -2;
  return BUTTONS.findIndex((b) => b.x === v.x && b.y === v.y);
}
/** Compare the machine's screen with the rendering for `dstr`; returns null or a text.  Reads the live focus from RAM. */
export function screenDiff(env, dstr) {
  const { m, S } = env, views = allViews(m, S);
  const fi = focusIndex(m, S, views);
  const flagsOf = (i) => { const b = BUTTONS[i], v = views.find((x) => x.kind === 'Button' && x.x === b.x && x.y === b.y); return v ? v.flags : 1; };
  const want = toDisp(renderScreen(dstr, fi, flagsOf));
  return diffMasked(readDisp(m), want, pointerMask(m, S));
}

/**
 * Call any routine directly under mapping `map` ('K' $33 | 'A' $3F): registers as given (8-bit names a f b c d e h l xh xl yh yl, or pairs hl bc de ix iy), the sentinel
 * return, interrupts off, mapping restored to K afterwards.  Returns the T-states (the callee's RET included).
 */
export function directCall(env, addr, regs = {}, map = 'K', guard = 6_000_000) {
  const { m, S } = env, cpu = m.cpu, f4 = map === 'A' ? F4A : F4K;
  const P = { bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  for (const r of ['a', 'f', ...REGS8]) cpu[r] = 0;
  for (const [k, v] of Object.entries(regs)) { if (P[k]) { cpu[P[k][0]] = (v >> 8) & 0xFF; cpu[P[k][1]] = v & 0xFF; } else cpu[k] = v & 0xFF; }
  m.ram[S.V_SHADOW_F4] = f4; m.portF4 = f4;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = 0xFF00 - 2; m.ram[0xFF00 - 2] = S.T_RET & 0xFF; m.ram[0xFF00 - 1] = S.T_RET >> 8;
  cpu.pc = addr;
  const t0 = m.tstates;
  let steps = 0;
  while (cpu.pc !== S.T_RET) {
    Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.halted) throw new Error(`call ${hex(addr)}: the CPU halted at ${hex(cpu.pc)}`);
    if (++steps > guard) throw new Error(`call ${hex(addr)}: no return after ${steps} instructions (PC ${hex(cpu.pc)})`);
  }
  const t = m.tstates - t0;
  m.ram[S.V_SHADOW_F4] = F4K; m.portF4 = F4K;
  return t;
}
