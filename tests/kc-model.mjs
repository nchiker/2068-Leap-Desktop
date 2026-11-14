"use strict";
// kc-model.mjs -- reference model of Key Caps (program 2), written from docs/KEYCAPS.md (1-3, and 7: the TS2068 layout, which replaces the window, the layout and the caps of 1-2) and docs/APPLIB.md only; src/apps/keycaps.asm was not used for any expectation.
//   * the key indices k = 5 x half-row + bit come from src/kernel/keymap.txt's order (the contract: "the KEYMAP index (keymap.txt order)"), the layout from KEYCAPS 2's table;
//   * `capLabel`: the label of a cap in plane P (2: the shift keys are "CS" / "SS" in every plane; code 0 none; 33-126 the character; otherwise the names table);
//   * `statusFor`: the status line after an E_KEY (3);
//   * `renderKeyboard` / `renderScreen`: the pixels, on a Gfx6Model; the frame is LOOK's macWindowLook (look-model.mjs), the radios are tk-model's checkLook, the status line a Label;
//   * `KCSim`: the behaviour of 3 (the plane shown, the status text, the radios through tk-model's TkTree: focus, SPACE, the pointer, E_CMD), driven by key and pointer events.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR, deskLook, barLook, macWindowLook, closeBoxLook } from './look-model.mjs';
import { TkTree, checkLook, FL, E } from './tk-model.mjs';
import { labelLook, toDisp } from './wm-model2.mjs';

export { Gfx6Model, toDisp, E, FL };
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------------------------------------------------------
// The keys (KEYCAPS 2)
/** The key names in keymap.txt order: index k = 5 x half-row + bit. */
export const KEYNAMES = readFileSync(join(ROOT, 'src/kernel/keymap.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).map((l) => l.trim().split(/\s+/)[0]);
export const kOf = (name) => KEYNAMES.indexOf(name);
export const KCS = 0, KSS = 36, KSPACE = 35, KBREAK = 40;
/**
 * The five rows (KEYCAPS 7, TSRun's board order): y, first x, cap height, then [name, width] a cap; the caps are 2 pixels apart.  CS appears twice (both CAPS SHIFT caps show k 0); BREAK is k 40, a cap with no
 * KEYMAP entry (down when keys 0 and 35 both are).
 */
export const ROWS = [
  { y: 54, x: 40, h: 18, caps: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map((n) => [n, 36]) },
  { y: 76, x: 49, h: 18, caps: ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'].map((n) => [n, 36]) },
  { y: 98, x: 58, h: 18, caps: [...['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'].map((n) => [n, 36]), ['ENTER', 70]] },
  { y: 120, x: 40, h: 18, caps: [['CS', 43], ...['Z', 'X', 'C', 'V', 'B', 'N', 'M'].map((n) => [n, 36]), ['SS', 36], ['BREAK', 36], ['CS', 43]] },
  { y: 142, x: 128, h: 14, caps: [['SPACE', 254]] },
];
/** Every cap: { name, k, row, col, x, y, w, h } (k 40 for BREAK). */
export const CAPS = ROWS.flatMap((r, ri) => { let x = r.x; return r.caps.map(([n, w], c) => { const cap = { name: n, k: n === 'BREAK' ? KBREAK : kOf(n), row: ri, col: c, x, y: r.y, w, h: r.h }; x += w + 2; return cap; }); });
export const NAMES = { 1: 'Caps', 3: 'Brk', 8: 'Left', 9: 'Right', 10: 'Down', 11: 'Up', 12: 'Del', 13: 'Enter', 14: 'Tab', 15: 'BTab', 16: 'Menu', 17: 'Close', 18: 'Mark', 27: 'Esc', 32: 'Space' };

/** The label text of key code c (KEYCAPS 2): null when c is 0 or has no label. */
export function codeLabel(c) {
  if (c === 0) return null;
  if (c >= 33 && c <= 126) return String.fromCharCode(c);
  return NAMES[c] ?? null;
}
/** The label of the cap of key k in plane P, KEYMAP = the 120 bytes read from the cartridge. */
export function capLabel(keymap, plane, k) {
  if (k === KCS) return 'CS';
  if (k === KSS) return 'SS';
  if (k === KBREAK) return 'Brk';                      // KEYCAPS 7: the BREAK cap is always "Brk" (k 40 has no KEYMAP entry)
  return codeLabel(keymap[40 * plane + k]);
}
/** KEYCAPS 3, E_KEY: "Last key: " + the label of c (a code with no name is shown as its character) + " (code " c ")". */
export const statusFor = (c) => `Last key: ${codeLabel(c) ?? String.fromCharCode(c)} (code ${c})`;
export const START_STATUS = 'Press a key.';

// ---------------------------------------------------------------------------------------------------------------------------
// The pixels
export const WIN = { x: 32, y: 24, w: 448, h: 160, title: 'Key Caps' };      // KEYCAPS 7
export const RADIOS = [{ x: 48, y: 40, w: 96, h: 9, text: 'Plain', id: 1 }, { x: 160, y: 40, w: 120, h: 9, text: 'Caps Shift', id: 2 }, { x: 296, y: 40, w: 136, h: 9, text: 'Symbol Shift', id: 3 }];
export const KB = { x: 40, y: 54, w: 432, h: 102 };
export const STAT = { x: 48, y: 162, w: 400, h: 9 };
/** Is the cap drawn pressed?  Both CAPS SHIFT caps show k 0; BREAK is down when keys 0 and 35 both are (KEYCAPS 7). */
export const capDown = (cap, down) => (cap.k === KBREAK ? down.has(KCS) && down.has(KSPACE) : down.has(cap.k));
/** The pressed fill of a cap (KEYCAPS 7): (x + 1, y + 1, w - 2, h - 2). */
export const fillRect = (c) => ({ x: c.x + 1, y: c.y + 1, w: c.w - 2, h: c.h - 2 });
/** The caps whose pressed state differs between two sets of keys down (the ones mode 1 redraws). */
export const changedCaps = (a, b) => CAPS.filter((c) => capDown(c, a) !== capDown(c, b));
/** The keyboard's M_DRAW (KEYCAPS 2, 7): the view's rectangle to paper, then the 42 caps in plane `plane`; the caps of the keys in `down` (a Set of k) XOR-filled. */
export function renderKeyboard(g, keymap, plane, down) {
  g.setOp(OP_CLR); g.fill(KB.x, KB.y, KB.w, KB.h);
  for (const c of CAPS) {
    g.setOp(OP_SET); g.frame(c.x, c.y, c.w, c.h);
    const lab = capLabel(keymap, plane, c.k);
    if (lab !== null) { const cs = codesOf(lab), tw = g.textw(cs); g.textp(c.x + Math.floor((c.w - tw) / 2), c.y + (c.h - 8) / 2, cs); }
    if (capDown(c, down)) { const f = fillRect(c); g.setOp(OP_XOR); g.fill(f.x, f.y, f.w, f.h); }
  }
}
/**
 * The screen of the open window: the desk, the empty bar, the window (active, close box), the three radios (`flags`, `focus` index or -1), the keyboard, the status line.
 * st = { keymap, flags: [f1, f2, f3], focus, status (a string), plane, down, active = true, covers = [] (plain active Windows drawn over: { x, y, w, h })}.
 */
export function renderScreen(st) {
  const g = new Gfx6Model(), active = st.active ?? true;
  deskLook(g); barLook(g, null, null);
  macWindowLook(g, { x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h, title: { codes: codesOf(WIN.title) } }, active);
  RADIOS.forEach((r, i) => checkLook(g, { x: r.x, y: r.y, w: r.w, h: r.h, flags: st.flags[i], codes: codesOf(r.text) }, st.focus === i));
  renderKeyboard(g, st.keymap, st.plane, st.down);
  labelLook(g, { x: STAT.x, y: STAT.y, w: STAT.w, h: STAT.h, flags: 0, text: { codes: codesOf(st.status) } });
  if (active) closeBoxLook(g, WIN.x, WIN.y, false);
  for (const c of st.covers || []) macWindowLook(g, { x: c.x, y: c.y, w: c.w, h: c.h, title: c.title ? { codes: codesOf(c.title) } : null }, true);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The behaviour (KEYCAPS 3)
/** The plane shown: 1 while CAPS SHIFT is held, otherwise 2 while SYMBOL SHIFT is held, otherwise the checked radio's. */
export const planeShown = (down, sel) => (down.has(KCS) ? 1 : down.has(KSS) ? 2 : sel);

export class KCSim {
  constructor(keymap) {
    this.keymap = keymap;
    const kid = (i, flags) => ({ kind: 'Check', id: RADIOS[i].id, x: RADIOS[i].x, y: RADIOS[i].y, w: RADIOS[i].w, h: RADIOS[i].h, flags, codes: codesOf(RADIOS[i].text) });
    this.radios = [kid(0, 0x19), kid(1, 0x11), kid(2, 0x11)];
    const kb = { kind: 'KeyCaps', id: 4, x: KB.x, y: KB.y, w: KB.w, h: KB.h, flags: 0 };
    const lbl = { kind: 'Label', id: 5, x: STAT.x, y: STAT.y, w: STAT.w, h: STAT.h, flags: 0, codes: codesOf(START_STATUS) };
    this.tree = new TkTree({ x: WIN.x, y: WIN.y, w: WIN.w, h: WIN.h, slot: 1, title: codesOf(WIN.title) }, [...this.radios, kb, lbl]);
    this.tree.activate();
    this.status = START_STATUS;
    this.down = new Set();
    this.caps = 0; this.kp = 0;                   // caps lock (K_CAPS) and keyboard-pointer mode (K_KPMODE)
    this.log = [];
  }
  get sel() { return this.radios.findIndex((r) => r.flags & FL.CHECKED); }
  get focus() { return this.radios.indexOf(this.tree.focus); }
  get plane() { return planeShown(this.down, this.sel); }
  get flags() { return this.radios.map((r) => r.flags); }
  /** E_KEY with code c: the status line, then the toolkit's dispatch (focus moves, SPACE on a radio). */
  key(c) { this.status = statusFor(c); this.tree.resetLog(); this.tree.dispatch({ t: E.KEY, key: c }); this.log.push(...this.tree.posts); }
  /**
   * The held set becomes `ks` (OBJECTS_EVENTS 14.4 / the ISR's keyboard step: CS + SS alone toggles keyboard-pointer mode and types nothing; otherwise each key that went down, in increasing k and
   * not the shifts, types KEYMAP[plane] with SS before CS before plain; code 0 nothing; code 1 toggles caps lock, no event; plain a-z are upper case with caps lock on).  Returns the typed codes.
   */
  hold(ks) {
    const next = new Set(ks), codes = [];
    const both = next.has(KCS) && next.has(KSS);
    if (both && next.size === 2 && (!this.down.has(KCS) || !this.down.has(KSS))) this.kp ^= 1;
    else if (!this.kp) {
      const tp = next.has(KSS) ? 2 : next.has(KCS) ? 1 : 0;
      for (const k of [...next].sort((a, b) => a - b)) {
        if (this.down.has(k) || k === KCS || k === KSS) continue;
        let c = this.keymap[40 * tp + k];
        if (c === 0) continue;
        if (c === 1) { this.caps ^= 1; continue; }
        if (tp === 0 && this.caps && c >= 97 && c <= 122) c -= 32;
        codes.push(c);
      }
    }
    this.down = next;
    for (const c of codes) this.key(c);
    return codes;
  }
  /** A pointer event at (px, py) (t = E.DOWN / E.MOVE / E.UP). */
  point(t, px, py) { this.tree.resetLog(); this.tree.dispatch({ t, px, py }); this.log.push(...this.tree.posts); }
  state(extra = {}) { return { keymap: this.keymap, flags: this.flags, focus: this.focus, status: this.status, plane: this.plane, down: this.down, ...extra }; }
  screen(extra = {}) { return renderScreen(this.state(extra)); }
}
export const dispOf = (g) => toDisp(g);
