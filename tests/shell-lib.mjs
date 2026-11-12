"use strict";
// shell-lib.mjs -- shared harness of the shell slice's tests (tests/shell-s1.mjs, tests/shell-perf.mjs).  Written from docs/SHELL.md (1-10), docs/TOOLKIT.md 9, docs/CALCULATOR.md,
// docs/WINDOWS.md and docs/BANKING.md only; src/kernel/launch.asm, src/kernel/tk.asm and src/apps/*.asm were never read.  It never builds: it loads the prebuilt
// build/desk5.dck and build/desk5/out.sym through tests/calc-lib.mjs.
//   - the machine states of the launcher's contract: captureState (K_PROG, the windows, the app arena's top, K_FOCUS / K_CAPTURE / W_MODAL / the posted queue, the stack depth at the
//     program's event loop, the screen) and compareStates (the "same as after a fresh launch" rows of SHELL 7);
//   - shellDiff / calcDiff / controlsDiff: the machine's screen against the models' renderings (shell-model.mjs, calc-lib's renderScreen, tk-model's renderWindow plus the close box);
//   - drivers for the shell: single click, double click at an exact frame gap, the "Leap" menu items by the pointer, keys.
import * as L from './calc-lib.mjs';
import * as SM from './shell-model.mjs';
import * as M from './tk-model.mjs';
import './tk-model2.mjs';                          // registers the List and Field looks (T2 / T3) with tk-model's renderWindow
import { readDisp, diffDisp } from './wm-lib.mjs';
import { drawBar } from './wm-model3.mjs';

export { L, SM, M, readDisp, diffDisp };
export const { hex, rd16 } = L;
export const AARENA_BASE = (S) => S.AARENA_BASE ?? 0xC400;
export const AARENA_END = (S) => S.AARENA_END ?? 0xE000;

export const needSyms = (S, list) => { const miss = list.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); };
export const SHELL_NEEDED = ['K_PROG', 'K_PROGS', 'K_LAUNCH', 'K_QUIT', 'S_START', 'S_END', 'S_IMG', 'S_IMG_LEN', 'S_WIN', 'S_LAST', 'S_LASTF', 'S_ABOUT', 'CL_CWindow', 'CL_Icon', 'CL_Dialog', 'Dialog_default', 'Dialog_cancel',
  'TK_DISPATCH', 'C_START', 'C_END', 'C_IMG_LEN', 'D_START', 'D_END', 'D_IMG_LEN', 'D_WIN', 'D_VSTR', 'D_TGT', 'D_LBL', 'K_AARENA', 'K_PN', 'K_POSTQ', 'K_PHEAD', 'K_FOCUS', 'K_CAPTURE', 'W_MODAL', 'V_FRAMES', 'K_PX', 'K_PY', 'PT_X', 'PT_Y',
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
  const dialog = ws.length >= 2 ? { okFocused: foc !== 0 && foc === okButton(env) } : null;
  const g = SM.renderShell({ sel: icons.indexOf(foc), dialog });
  return diffDisp(readDisp(m), SM.toDisp(g), withPointer(env, extra));
}
/** Calculator's screen (calc-lib's rendering of CALCULATOR 4 + the close box) for the display `dstr`. */
export const calcDiff = (env, dstr = '0', extra = []) => { const d = L.screenDiff(env, dstr); return d; };
/** Controls' screen: the window read from the machine (the controls' flags, text, bar value), the tk-model's rendering of TOOLKIT 9 plus the close box (SHELL 10.1). */
export function controlsDiff(env, extra = []) {
  const { m, S } = env, dwin = rd16(m, S.D_WIN), rv = (a) => L.readView(m, S, a);
  const wv = rv(dwin), order = [];
  for (let v = wv.child; v; v = rv(v).next) {
    const k = rv(v), base = { addr: v, id: k.id, x: k.x, y: k.y, w: k.w, h: k.h, flags: k.flags };
    if (k.cls === S.CL_Check) order.push({ kind: 'Check', ...base, codes: Array.from(readStrText(m, rd16(m, v + S.Check_text)), (c) => c.charCodeAt(0)) });
    else if (k.cls === S.CL_VScroll) order.push({ kind: 'VScroll', ...base, value: m.ram[v + S.VScroll_value], max: m.ram[v + S.VScroll_max], page: m.ram[v + S.VScroll_page], press: m.ram[v + S.VScroll_press] });
    else if (k.cls === S.CL_Label) order.push({ kind: 'Label', ...base, codes: Array.from(readStrText(m, rd16(m, v + S.Label_text)), (c) => c.charCodeAt(0)) });
    else if (k.cls === S.CL_List) {
      const arr = rd16(m, v + S.List_items), count = m.ram[v + S.List_count], items = [];
      for (let i = 0; i < count; i++) { const a = rd16(m, arr + 2 * i); items.push(Array.from(m.ram.subarray(a + 1, a + 1 + m.ram[a]))); }
      order.push({ kind: 'List', ...base, items, count, sel: m.ram[v + S.List_sel], top: m.ram[v + S.List_top], bar: null });
    } else if (k.cls === S.CL_Field) {
      const b = rd16(m, v + S.Field_buf);
      order.push({ kind: 'Field', ...base, buf: Array.from(m.ram.subarray(b + 1, b + 1 + m.ram[b])), cap: m.ram[v + S.Field_cap], caret: m.ram[v + S.Field_caret], first: m.ram[v + S.Field_first] });
    }
    else return `an unknown view class ${hex(k.cls)} in the Controls window`;
  }
  const tree = new M.TkTree({ x: wv.x, y: wv.y, w: wv.w, h: wv.h, slot: m.ram[dwin + S.Window_slot], title: SM.codesOf(readStrText(m, rd16(m, dwin + S.Window_title))) }, order);
  const foc = rd16(m, S.K_FOCUS); tree.focus = order.find((n) => n.addr === foc) || null;
  const g = new M.Gfx6Model();
  g.setOp(SM.OP_CLR); g.fill(0, 8, 512, 184); drawBar(g, null, null);
  M.renderWindow(tree, g); SM.closeBoxLook(g, wv.x, wv.y, wv.w);
  return diffDisp(readDisp(m), M.toDisp(g), withPointer(env, extra));
}
/** The screen of the running program against its model (the shell, Calculator showing `dstr`, Controls). */
export function programDiff(env, p = env.m.ram[env.S.K_PROG], extra = [], dstr = '0') {
  return p === 0 ? shellDiff(env, extra) : p === 1 ? L.screenDiff(env, dstr) : controlsDiff(env, extra);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers
/** A single click on the icon of program p: the pointer there, press `hold` frames, release, wait `rel` frames. */
export const clickIcon = (env, p, hold = 3, rel = 6) => { const [x, y] = L.iconCentre(p); return L.click(env, x, y, hold, rel); };
/** The "Leap" menu by the pointer (WINDOWS 18.4): press on the title, move to item `item` (1-based, the separator counts: items 1 About, 2 separator, 3 Calculator, 4 Controls), release. */
export function leapMenu(env, item) {
  const { m } = env;
  L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, 30, 9 + 10 * (item - 1) + 5); env.frames_(2);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
}
/**
 * Two presses on the same icon whose E_DOWNs are handled `gap` frames apart (SHELL 4: V_FRAMES at the handling).  The icon is focused first (TAB), so that a press does not cost a focus
 * redraw and is handled in the frame it is made.  The first press is made and the shell's own record of it (S_LASTF, S_LAST) read: F1.  The second press is then made so that it is handled
 * at F1 + gap (it goes in the frame after V_FRAMES = F1 + gap - 1; gap >= 2: the release needs a frame).  Returns { f1, f2, handledAt, gapSeen }: f2 = S_LASTF after the second press
 * (the shell remembers the frame of a press that does not open), gapSeen = f2 - f1, so the caller can see that the gap was really `gap`.
 */
export function doubleClickGap(env, p, gap) {
  const { m, S } = env, [cx, cy] = L.iconCentre(p), want = iconAddrs(env)[p - 1];
  for (let i = 0; i < 3 && rd16(m, S.K_FOCUS) !== want; i++) { L.typeCode(env, 14); env.frames_(2); }
  L.moveTo(env, cx, cy); env.frames_(2);
  const old = rd16(m, S.S_LASTF);
  m.mouse.buttons = L.MOUSE_LEFT; env.frame();
  let k = 0;
  while (rd16(m, S.S_LASTF) === old && k++ < 8) env.frame();
  const f1 = rd16(m, S.S_LASTF);
  m.mouse.buttons = L.MOUSE_UP; env.frame();
  let guard = 0;
  while (((rd16(m, S.V_FRAMES) + 1 - f1) & 0xFFFF) < gap && guard++ < 400) env.frame();
  m.mouse.buttons = L.MOUSE_LEFT; env.frame();
  const f2 = rd16(m, S.S_LASTF);
  const handledAt = rd16(m, S.V_FRAMES);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(2);
  return { f1, f2, handledAt, gapSeen: (f2 - f1) & 0xFFFF };
}
export const KEYS_OK = (env, code, hold = 3, rel = 3) => L.typeCode(env, code, hold, rel);
