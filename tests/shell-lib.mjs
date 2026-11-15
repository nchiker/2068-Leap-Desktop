"use strict";
// shell-lib.mjs -- shared harness of the shell slice's tests (tests/shell-s1.mjs, tests/shell-perf.mjs).  Written from docs/SHELL.md (1-10), docs/TOOLKIT.md 9, docs/CALCULATOR.md,
// docs/WINDOWS.md and docs/BANKING.md only; src/kernel/launch.asm, src/kernel/tk.asm and src/apps/*.asm were never read.  It never builds: it loads the prebuilt
// build/desk5.dck and build/desk5/out.sym through tests/calc-lib.mjs.
//   - the machine states of the launcher's contract: captureState (K_PROG, the windows, the app arena's top, K_FOCUS / K_CAPTURE / W_MODAL / the posted queue, the stack depth at the
//     program's event loop, the screen) and compareStates (the "same as after a fresh launch" rows of SHELL 7);
//   - shellDiff / calcDiff / keycapsDiff: the machine's screen against the models' renderings (shell-model.mjs, calc-lib's renderScreen, kc-model's rendering, tk-model's renderWindow plus the close box);
//   - drivers for the shell: single click, double click at an exact frame gap, the "Leap" menu items by the pointer, keys.
import * as L from './calc-lib.mjs';
import * as SM from './shell-model.mjs';
import * as M from './tk-model.mjs';
import './tk-model2.mjs';                          // registers the List and Field looks (T2 / T3) with tk-model's renderWindow
import { readDisp, diffDisp } from './wm-lib.mjs';
import { barLook as drawBar, deskLook } from './look-model.mjs';
import * as WM from './wr-model.mjs';
import * as KL from './kc-lib.mjs';

export { L, SM, M, readDisp, diffDisp };
export const { hex, rd16 } = L;
export const AARENA_BASE = (S) => S.AARENA_BASE ?? 0xC400;
export const AARENA_END = (S) => S.AARENA_END ?? 0xE000;

export const needSyms = (S, list) => { const miss = list.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); };
export const SHELL_NEEDED = ['K_PROG', 'K_PROGS', 'K_LAUNCH', 'K_QUIT', 'S_START', 'S_END', 'S_IMG', 'S_IMG_LEN', 'S_WIN', 'S_LAST', 'S_ABOUT', 'CL_CWindow', 'CL_Icon', 'CL_Dialog', 'Dialog_default', 'Dialog_cancel',
  'TK_DISPATCH', 'C_START', 'C_END', 'C_IMG_LEN', 'KC_START', 'KC_END', 'KC_IMG_LEN', 'K_AARENA', 'K_PN', 'K_POSTQ', 'K_PHEAD', 'K_FOCUS', 'K_CAPTURE', 'W_MODAL', 'V_FRAMES', 'K_PX', 'K_PY', 'PT_X', 'PT_Y',
  'W_SLOTS', 'K_GETEV', 'W_DRAWVIEW', 'K_ARESET', 'GCLIP', 'Window_title', 'Window_slot', 'Button_text', 'Label_text', 'Check_text', 'VScroll_value'];

/** Boot desk5 into the shell (program 0); the pointer is at (0, 0). */
export function bootShell(opts = {}) {
  const env = L.bootDesk5({ ...opts, prog: 0 });
  needSyms(env.S, SHELL_NEEDED);
  return env;
}

export const readStrText = (m, a) => (a ? String.fromCharCode(...m.ram.subarray(a + 1, a + 1 + m.ram[a])) : '');
export const treeOf = (env) => L.allViews(env.m, env.S);
/** The icons of the shell (valid while the shell runs): their addresses in tree order. */
export const iconAddrs = (env) => treeOf(env).filter((v) => v.cls === env.S.CL_Icon).map((v) => v.a);
/** The OK button of the About dialog, or 0. */
export function okButton(env) {
  const d = treeOf(env).find((v) => v.cls === env.S.CL_Dialog);
  return d ? rd16(env.m, d.a + env.S.Dialog_default) : 0;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// States (SHELL 7: the cycle row)
/** SP at every entry of K_GETEV over `n` idle frames: the shallowest is the program's event loop (the tracking loops are deeper).  Undefined when none was seen. */
export function loopDepth(env, n = 4) {
  env.sp.samples.clear(); env.sp.on = true; env.frames_(n); env.sp.on = false;
  const sps = [...env.sp.samples.keys()];
  return sps.length ? Math.max(...sps) : undefined;
}
/** The posted queue (K_PN records from K_PHEAD) as a list of 4-byte records. */
export function postedQ(env) {
  const { m, S } = env, n = m.ram[S.K_PN], h = m.ram[S.K_PHEAD], out = [];
  for (let k = 0; k < n; k++) { const a = S.K_POSTQ + 4 * ((h + k) & 3); out.push([m.ram[a], m.ram[a + 1], m.ram[a + 2], m.ram[a + 3]]); }
  return out;
}
/**
 * What SHELL 7's cycle row compares, taken at the program's idle (frames run with no input): K_PROG, its windows, the app arena's top (and that every byte above it is still 0),
 * K_FOCUS, K_CAPTURE, W_MODAL, the posted queue, the stack depth at the event loop, the screen.
 */
export function captureState(env, idleFrames = 4) {
  const { m, S } = env;
  const sp = loopDepth(env, idleFrames);
  const top = rd16(m, S.K_AARENA);
  let dirty = -1;
  for (let a = top; a < AARENA_END(S); a++) if (m.ram[a] !== 0) { dirty = a; break; }
  return {
    prog: m.ram[S.K_PROG], wins: L.openWindows(m, S).map((w) => ({ cls: w.cls, x: w.x, y: w.y, w: w.w, h: w.h, title: w.title })),
    top, base: rd16(m, S.K_AARENA + 4), dirty, focus: rd16(m, S.K_FOCUS), capture: rd16(m, S.K_CAPTURE), modal: rd16(m, S.W_MODAL), posted: postedQ(env), sp,
    screen: readDisp(m), ptr: [rd16(m, S.K_PX), m.ram[S.K_PY]],
  };
}
/** The differences between a state and the baseline (a first launch): [] when the same.  The screen is compared except where the pointer is (now, or in the baseline). */
export function compareStates(env, base, cur, what, allowModal = false) {
  const { m, S } = env, out = [];
  if (cur.prog !== base.prog) out.push(`K_PROG ${cur.prog}, want ${base.prog}`);
  if (JSON.stringify(cur.wins) !== JSON.stringify(base.wins)) out.push(`windows ${JSON.stringify(cur.wins)}, want ${JSON.stringify(base.wins)}`);
  if (cur.top !== base.top) out.push(`app arena top ${hex(cur.top)}, a fresh launch leaves ${hex(base.top)}`);
  if (cur.base !== AARENA_BASE(S)) out.push(`app arena base ${hex(cur.base)}, want ${hex(AARENA_BASE(S))}`);
  if (cur.dirty >= 0) out.push(`app arena byte ${hex(cur.dirty)} above the top is not 0 (K_ARESET clears it)`);
  if (cur.focus !== base.focus) out.push(`K_FOCUS ${hex(cur.focus)}, a fresh launch ${hex(base.focus)}`);
  if (cur.capture !== 0) out.push(`K_CAPTURE ${hex(cur.capture)}, want 0`);
  if (cur.modal !== (allowModal ? base.modal : 0)) out.push(`W_MODAL ${hex(cur.modal)}, want ${allowModal ? hex(base.modal) : 0}`);
  if (JSON.stringify(cur.posted) !== JSON.stringify(base.posted)) out.push(`posted queue ${JSON.stringify(cur.posted)}, a fresh launch ${JSON.stringify(base.posted)}`);
  if (cur.sp !== base.sp) out.push(`stack at the event loop: SP ${cur.sp === undefined ? 'no K_GETEV seen' : hex(cur.sp)}, a fresh launch ${base.sp === undefined ? 'none' : hex(base.sp)}`);
  const d = diffDisp(cur.screen, base.screen, L.pointerMask(m, S, [base.ptr, cur.ptr]));
  if (d) out.push(`screen differs from a fresh launch's: ${d}`);
  return out.map((s) => `${what}: ${s}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Screens against the models
const withPointer = (env, extra = []) => L.pointerMask(env.m, env.S, extra);
/** The shell's screen against shell-model's rendering (SHELL 10.4 / 10.5).  sel / dialog are read from the machine's K_FOCUS and window list (selected = focused).  Always strict. */
export function shellDiff(env, extra = []) {
  const { m, S } = env, icons = iconAddrs(env), foc = rd16(m, S.K_FOCUS), ws = L.openWindows(m, S);
  const open = ws.some((w) => w.title === 'Leap Desktop');                       // SHELL 12: the shell's window may be closed
  const dialog = ws.some((w) => w.cls === S.CL_Dialog) ? { okFocused: foc !== 0 && foc === okButton(env) } : null;
  const g = SM.renderShell({ sel: icons.indexOf(foc), dialog, open });
  return diffDisp(readDisp(m), SM.toDisp(g), withPointer(env, extra));
}
/** Calculator's screen (calc-lib's rendering of CALCULATOR 4 + the close box) for the display `dstr`. */
export const calcDiff = (env, dstr = '0', extra = []) => { const d = L.screenDiff(env, dstr); return d; };
/** Key Caps' screen (KEYCAPS 1-3): the window read from the machine (the radios' flags, the focus, the status text, the keys down), tests/kc-model.mjs's rendering. */
export const keycapsDiff = (env, extra = []) => KL.kcDiff(env, extra);
/** Write's screen (WRITE 11.3) with an empty document, as a fresh launch draws it: the caret shows when K_FOCUS is the text view. */
export function writeDiff(env, extra = []) {
  const { m, S } = env, tv = S.WR_TV !== undefined ? rd16(m, S.WR_TV) : 0, foc = rd16(m, S.K_FOCUS);
  const g = WM.renderScreen(new WM.Doc(), { focus: tv !== 0 && foc === tv });
  return diffDisp(readDisp(m), WM.toDisp(g), withPointer(env, extra));
}
/** The screen of the running program against its model (the shell, Calculator showing `dstr`, Key Caps, Write with an empty document). */
export function programDiff(env, p = env.m.ram[env.S.K_PROG], extra = [], dstr = '0') {
  return p === 0 ? shellDiff(env, extra) : p === 1 ? L.screenDiff(env, dstr) : p === 2 ? keycapsDiff(env, extra) : writeDiff(env, extra);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers
/** A single click on the icon of program p: the pointer there, press `hold` frames, release, wait `rel` frames. */
export const clickIcon = (env, p, hold = 3, rel = 6) => { const [x, y] = L.iconCentre(p); return L.click(env, x, y, hold, rel); };
/** The "Leap" menu by the pointer (WINDOWS 18.4): press on the title, move to item `item` (1-based, the separator counts: items 1 About, 2 separator, 3 Calculator, 4 Key Caps, 5 Notepad, 6 Paint, 7 Show Desktop, 8 Sound Off / Sound On), release. */
export function leapMenu(env, item) {
  const { m } = env;
  L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, 30, 9 + 10 * (item - 1) + 5); env.frames_(2);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
}
/** E_DOWN flag (data 3 bit 2) of the last E_DOWN record the ISR appended since the ring's tail was `t0` (null when none). */
export function flagSince(env, t0) {
  const { m, S } = env; let f = null;
  for (let t = t0; t !== m.ram[S.K_RTAIL]; t = (t + 4) & 0xFF) { const a = S.K_RING + (t & 0x3F); if (m.ram[a] === 3) f = (m.ram[a + 3] & 4) !== 0; }
  return f;
}
/** A press at (x, y) with the pointer moved there and the button put down in ONE frame (the E_DOWN is at (x, y)), held `hold` frames, released (one frame, the release frame counts).  Returns { frame: the harness frame count of the press, flag }. */
export function pressPoint(env, x, y, hold = 1) {
  const { m, S } = env, [px, py] = L.pointerPos(m, S);
  m.mouse.x = (m.mouse.x + (x - px)) & 0xFF; m.mouse.y = (m.mouse.y - (y - py)) & 0xFF;
  const t0 = m.ram[S.K_RTAIL];
  m.mouse.buttons = L.MOUSE_LEFT; env.frame();
  const frame = env.frames, flag = flagSince(env, t0);
  for (let i = 1; i < hold; i++) env.frame();
  m.mouse.buttons = L.MOUSE_UP; env.frame();
  return { frame, flag };
}
/**
 * Two presses whose ISR polls are `gap` frames apart (WRITE 14.9 item 1: the kernel's double-click flag; the frames are counted by this harness, one per env.frame(), and the E_DOWN is queued in the
 * frame in which the button is first seen down).  The first press is on icon p's centre (or `first` = [x, y]); the second at the first moved by `off` = [dx, dy] (the pointer moves and the button goes
 * down in one frame, so the second E_DOWN is at the offset), or at the absolute point `second`.  The icon is focused first (TAB), so that a press does not cost a focus redraw, and 25 idle frames
 * run before the first press (K_DCN is 0).  Returns { f1, f2, gapSeen: f2 - f1, flag1, flag2 }: the harness frame counts at the two presses and data 3 bit 2 of the two E_DOWN records.
 */
export function doubleClickGap(env, p, gap, { off = [0, 0], first = null, second = null } = {}) {
  const { m, S } = env, [cx, cy] = first || L.iconCentre(p), want = iconAddrs(env)[p - 1];
  for (let i = 0; i < 3 && rd16(m, S.K_FOCUS) !== want; i++) { L.typeCode(env, 14); env.frames_(2); }
  L.moveTo(env, cx, cy); env.frames_(25);
  const a = pressPoint(env, cx, cy, 1);                                  // press frame f1, release frame f1 + 1
  env.frames_(Math.max(0, gap - 2));                                     // frames f1 + 2 .. f1 + gap - 1
  const b = pressPoint(env, second ? second[0] : cx + off[0], second ? second[1] : cy + off[1], 1);   // frame f1 + gap
  env.frames_(2);
  return { f1: a.frame, f2: b.frame, gapSeen: b.frame - a.frame, flag1: a.flag, flag2: b.flag };
}
export const KEYS_OK = (env, code, hold = 3, rel = 3) => L.typeCode(env, code, hold, rel);
