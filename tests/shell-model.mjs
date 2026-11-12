"use strict";
// shell-model.mjs -- reference model of the shell slice (docs/SHELL.md 1-10; TOOLKIT.md 9 for the controls Controls shows).  Written from the contract only:
// src/kernel/launch.asm, src/kernel/tk.asm and src/apps/*.asm were never read.  Only src/apps/icons.txt (the icon art, part of the contract: SHELL 10.4 and 9.5) is read.
//
//   node tests/shell-model.mjs --self-test      hand-worked cases of the model itself
//
// What is here:
//   * parseIcons: icons.txt -> { CALC: [16 rows], CTRL: [16 rows] };
//   * iconLook / shellLook / aboutLook / renderShell: the shell's screen as gfx6-model drawing (SHELL 10.4 / 10.5: the window, the icons' bitmaps drawn at (x + 16, y) opaque, the names centred
//     at (x + floor((64 - tw) / 2), y + 17), the selected name's box (tx - 2, y + 17, tw + 4, 9) XORed; the "Leap" menu in the bar; the About Dialog in front);
//   * cwindowLook (10.1): a Window's look plus, only when it is the front one, the close box; paintWindows: the screen of a stack of windows, back to front;
//   * ShellSim: the shell's pointer / key logic (SHELL 4, 10.4): focus = selection, a second E_DOWN on the same icon within 20 frames opens it, ENTER opens the focused icon,
//     TAB / DOWN / RIGHT and BACKTAB / UP / LEFT move the focus (OBJECTS_EVENTS 6: the kernel's defaults, wrapping over the focusable views, here the two icons);
//   * Launcher bookkeeping constants: the programs, the menu table of the "Leap" menu.
//
// Readings of the contract (also in the report):
//  R1. "Selected (= focused, K_FOCUS = the icon)" (10.4): an icon is drawn selected exactly when K_FOCUS is that icon.  With the About dialog up the focus is on the OK button, so no icon is
//      selected; the model takes K_FOCUS from the machine for the screen and checks the focus transitions separately.
//  R2. The 20-frame rule: "V_FRAMES - its frame <= 20" (10.4): the frames are V_FRAMES when each E_DOWN is handled; the harness measures them from the shell's own variables where they
//      are given (S_LAST, S_LASTF in the task's symbol list) and checks the exact boundary 20 / 21.
//  R3. "If the last E_DOWN on an icon was on this one": E_DOWNs elsewhere (the window, the desk) do not count; a non-opening E_DOWN on an icon remembers that icon and the frame.
//  R4. The shell's window is a plain Window: no close box, and SYMBOL SHIFT + Q (CLOSE) is not consumed there (10.1 TK_DISPATCH: "otherwise not consumed, so it is dropped").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from '../tools/build.mjs';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';
import { windowLook, buttonLook, labelLook, dialogLook, toDisp } from './wm-model2.mjs';
import { drawBar, layoutOf, menuSpec } from './wm-model3.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR, toDisp, windowLook, buttonLook, labelLook, dialogLook };
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));
export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, REDRAW: 6, MENU: 7, CMD: 10 };
export const KEY = { BREAK: 3, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, TAB: 14, BACKTAB: 15, MENU: 16, CLOSE: 17, ESC: 27 };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The icon art (SHELL 10.4: 32 x 16 pixels, '#' ink, '.' paper)
export function parseIcons(path = join(ROOT, 'src', 'apps', 'icons.txt')) {
  const out = {}; let cur = null;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trimEnd();
    if (line.trim() === '' || (line.startsWith('#') && !/^[#.]{32}$/.test(line))) continue;       // a row of ink may start with '#': a comment is a '#' line that is not 32 of # and .
    const h = line.match(/^icon\s+(\w+)/);
    if (h) { cur = out[h[1]] = []; continue; }
    if (!cur) throw new Error(`icons.txt: a row before any icon: ${line}`);
    if (!/^[#.]{32}$/.test(line)) throw new Error(`icons.txt: a row that is not 32 of # and .: ${line}`);
    cur.push(line);
  }
  for (const [k, rows] of Object.entries(out)) if (rows.length !== 16) throw new Error(`icons.txt: icon ${k} has ${rows.length} rows, want 16`);
  return out;
}
export const ICONART = parseIcons();

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The programs and the shell's geometry (SHELL 4, 5, 10.4)
export const SHELL_WIN = { x: 32, y: 24, w: 256, h: 80, title: 'Leap Desktop' };
// WRITE 11.2: a third icon "Write" at (176, 40) (its bitmap is `icon WRITE` in icons.txt) and the menu item "Write" (id 5) after "Controls"
export const ICONS = [{ name: 'Calculator', art: 'CALC', prog: 1, x: 48, y: 40, w: 64, h: 26 }, { name: 'Controls', art: 'CTRL', prog: 2, x: 112, y: 40, w: 64, h: 26 },
  { name: 'Write', art: 'WRITE', prog: 3, x: 176, y: 40, w: 64, h: 26 }];
export const LEAP_MENU = menuSpec(1, 'Leap', [[1, 0, 'About Leap Desktop...'], [2, 2, ''], [3, 0, 'Calculator'], [4, 0, 'Controls'], [5, 0, 'Write']]);
export const ABOUT = { dialog: { x: 128, y: 64, w: 256, h: 64 }, label: { x: 144, y: 76, w: 200, h: 9, text: 'Leap Desktop, step 5' }, ok: { x: 304, y: 100, w: 64, h: 16, text: 'OK' } };
export const DBL_FRAMES = 20;

/** One icon (10.4 as amended by 10.5): CLR fill of its 64 x 26, the bitmap at (x + 16, y), the name centred in 64 at y + 17, the selected name's box XORed. */
export function iconLook(g, ic, selected) {
  g.setOp(OP_CLR); g.fill(ic.x, ic.y, ic.w, ic.h);
  const art = ICONART[ic.art];
  if (!art) throw new Error(`icons.txt has no icon ${ic.art} (WRITE 11.2: the Write icon's bitmap is in icons.txt; the key is read as WRITE)`);   // CONTRACT? the third icon's key in icons.txt
  for (let r = 0; r < 16; r++) for (let c = 0; c < 32; c++) g.set(ic.x + 16 + c, ic.y + r, art[r][c] === '#' ? 1 : 0);
  const cs = codesOf(ic.name), tw = g.textw(cs), tx = ic.x + Math.floor((64 - tw) / 2);
  g.setOp(OP_SET); g.textp(tx, ic.y + 17, cs);
  if (selected) { g.setOp(OP_XOR); g.fill(tx - 2, ic.y + 17, tw + 4, 9); }
}
/** The shell's window (a plain Window: no close box) and its icons; `sel` = the selected icon's index or -1. */
export function shellLook(g, sel, active = true) {
  windowLook(g, { x: SHELL_WIN.x, y: SHELL_WIN.y, w: SHELL_WIN.w, h: SHELL_WIN.h, title: { codes: codesOf(SHELL_WIN.title) } }, active);
  ICONS.forEach((ic, i) => iconLook(g, ic, i === sel));
}
/** The About dialog in front (10.4): Dialog look, a Label, the OK Button (default: flags $11); `okFocused` = K_FOCUS is the button. */
export function aboutLook(g, okFocused, okFlags = 0x11) {
  const d = ABOUT.dialog, l = ABOUT.label, b = ABOUT.ok;
  dialogLook(g, { ...d });
  labelLook(g, { x: l.x, y: l.y, w: l.w, h: l.h, flags: 0, text: { codes: codesOf(l.text) } });
  buttonLook(g, { x: b.x, y: b.y, w: b.w, h: b.h, flags: okFlags, text: { codes: codesOf(b.text) } }, okFocused);
}
/**
 * The whole screen in the shell: desk, the bar with "Leap", the shell window (active unless the dialog is up), the icons; `sel` the selected icon or -1; `dialog` = null, or
 * { okFocused } for the About dialog in front.
 */
export function renderShell({ sel = 0, dialog = null } = {}) {
  const g = new Gfx6Model();
  g.setOp(OP_CLR); g.fill(0, 8, 512, 184);
  drawBar(g, [LEAP_MENU], layoutOf([LEAP_MENU]));
  shellLook(g, sel, !dialog);
  if (dialog) aboutLook(g, !!dialog.okFocused);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// CWindow (10.1)
/** The close box of a front CWindow: CLR fill (x + w - 19, y + 1, 15, 7), SET frame (x + w - 18, y + 2, 13, 5); pressed: XOR fill (x + w - 17, y + 3, 11, 3). */
export function closeBoxLook(g, x, y, w, pressed = false) {
  g.setOp(OP_CLR); g.fill(x + w - 19, y + 1, 15, 7);
  g.setOp(OP_SET); g.frame(x + w - 18, y + 2, 13, 5);
  if (pressed) { g.setOp(OP_XOR); g.fill(x + w - 17, y + 3, 11, 3); }
}
export const boxRect = (x, y, w) => ({ x: x + w - 19, y: y + 1, w: 15, h: 7 });
export const inBox = (win, px, py) => { const b = boxRect(win.x, win.y, win.w); return px >= b.x && px < b.x + b.w && py >= b.y && py < b.y + b.h; };
/**
 * A stack of windows painted back to front (every look is opaque, so the painter's result is what the map rule shows): `wins` = [{ kind: 'Window' | 'CWindow', x, y, w, h, title }], the
 * last one is the front.  Only the front CWindow has the close box (10.1: "only when the window has the active look (it is in front)"); `pressed` = the front's box pressed.
 * The bar holds the "Leap" menu title (the shell's menu stays in the bar of a cartridge test that closed the shell's window).
 */
export function paintWindows(wins, { pressed = false, bar = true } = {}) {
  const g = new Gfx6Model();
  g.setOp(OP_CLR); g.fill(0, 8, 512, 184);
  if (bar) drawBar(g, [LEAP_MENU], layoutOf([LEAP_MENU])); else drawBar(g, null, null);
  wins.forEach((w, i) => {
    const front = i === wins.length - 1;
    windowLook(g, { x: w.x, y: w.y, w: w.w, h: w.h, title: { codes: codesOf(w.title) } }, front);
    if (front && w.kind === 'CWindow') closeBoxLook(g, w.x, w.y, w.w, pressed);
  });
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The shell's logic (SHELL 4, 10.4)
export class ShellSim {
  constructor() { this.reset(); }
  reset() { this.focus = 0; this.last = null; this.opened = 0; }            // focus = the icon index (the first icon is focused at the start: the window's activation, WINDOWS 14)
  /** E_DOWN on icon i at the frame f (V_FRAMES when handled): focus and selection move to it; a second one on the same icon within 20 frames opens it.  Returns the program or 0. */
  down(i, f) {
    this.focus = i;
    if (this.last && this.last.icon === i && ((f - this.last.frame) & 0xFFFF) <= DBL_FRAMES) { this.opened = ICONS[i].prog; return this.opened; }
    this.last = { icon: i, frame: f };
    return 0;
  }
  /** A key code reaching the shell's loop: ENTER on the focused icon opens it; the kernel's defaults move the focus.  Returns the program or 0. */
  key(code) {
    if (code === KEY.ENTER) { this.opened = ICONS[this.focus].prog; return this.opened; }
    if ([KEY.TAB, KEY.DOWN, KEY.RIGHT].includes(code)) this.focus = (this.focus + 1) % ICONS.length;
    else if ([KEY.BACKTAB, KEY.UP, KEY.LEFT].includes(code)) this.focus = (this.focus + ICONS.length - 1) % ICONS.length;
    return 0;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  let bad = 0;
  const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`); };
  eq('icons parsed (CALC, CTRL, and WRITE once the main model has drawn it)', [Object.keys(ICONART).slice(0, 2), ICONART.CALC.length, ICONART.CTRL[0].length], [['CALC', 'CTRL'], 16, 32]);
  // the bitmap: CALC's first row is '....####...' at x + 8: columns 4..27 inked
  { const g = new Gfx6Model(); iconLook(g, ICONS[0], false); eq('CALC row 0 pixels', [g.get(48 + 16 + 3, 40), g.get(48 + 16 + 4, 40), g.get(48 + 16 + 27, 40), g.get(48 + 16 + 28, 40)], [0, 1, 1, 0]); }
  // the name's width and the inverted box
  { const g0 = new Gfx6Model(), tw = g0.textw(codesOf('Calculator')), tx = 48 + Math.floor((64 - tw) / 2);
    const g = new Gfx6Model(); iconLook(g, ICONS[0], false); const h = new Gfx6Model(); iconLook(h, ICONS[0], true);
    let n = 0; for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) if (g.get(x, y) !== h.get(x, y)) { n++; if (x < tx - 2 || x >= tx + tw + 2 || y < 57 || y >= 66) n += 1000; }
    eq('selected inverts only the name box', n > 0 && n < 1000, true); }
  // the double click rule
  { const s = new ShellSim(); eq('first click', [s.down(0, 100), s.focus], [0, 0]); eq('20 frames later opens', s.down(0, 120), 1);
    const t = new ShellSim(); t.down(1, 5); eq('21 frames does not open', [t.down(1, 26), t.last.frame], [0, 26]); eq('and then 20 later opens', t.down(1, 46), 2);
    const u = new ShellSim(); u.down(0, 1); u.down(1, 3); eq('A, B, A: the third does not open', u.down(0, 5), 0);
    const w = new ShellSim(); w.down(1, 0xFFF8); eq('across the V_FRAMES wrap', w.down(1, 8), 2); }
  { const s = new ShellSim(); s.key(KEY.TAB); eq('TAB', s.focus, 1); s.key(KEY.UP); eq('UP', s.focus, 0); s.key(KEY.RIGHT); eq('RIGHT', s.focus, 1); eq('ENTER on the second icon', s.key(KEY.ENTER), 2); }
  // CWindow: the box is in the front window only
  { const g = paintWindows([{ kind: 'CWindow', x: 16, y: 24, w: 96, h: 64, title: 'A' }, { kind: 'Window', x: 64, y: 48, w: 96, h: 64, title: 'B' }]);
    const h = paintWindows([{ kind: 'Window', x: 64, y: 48, w: 96, h: 64, title: 'B' }, { kind: 'CWindow', x: 16, y: 24, w: 96, h: 64, title: 'A' }]);
    eq('the box of A is drawn only when A is in front', [g.get(16 + 96 - 18, 24 + 4) !== h.get(16 + 96 - 18, 24 + 4)], [true]); }
  console.log(bad ? `shell-model self-test: ${bad} FAILED` : 'shell-model self-test: all ok');
  if (bad) process.exitCode = 1;
}
