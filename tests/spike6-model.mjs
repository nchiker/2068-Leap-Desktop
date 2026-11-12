"use strict";
// spike6-model.mjs -- the reference model of the `spike6` demo cartridge (docs/GRAPHICS_SPIKE.md section 17.4 - 17.5), written from the
// contract only, over the gfx6 model (tests/gfx6-model.mjs: Gfx6Model and the S4 PointerModel).
//   node tests/spike6-model.mjs     runs the model's self-test (the script table's positions, the scene, menu and outline invariants)
//
// Readings of the contract where its text leaves room (also listed in the report that came with this file):
//  A1. Every drawing step of 17.4 that does not name an op runs in SET (17.4: "GOP = SET between drawing steps"): the title text, the
//      icon's caption, the window content, the menu items.  Text lines are drawn with the model's textp / text8 (the window's
//      content is clipped to the interior by the clip, exactly as 17.4 says).  The icon is drawn by blit (clip = the whole screen).
//  A2. A menu's save-under is the byte rectangle of M_i (saveRect), restored by restoreRect; the model keeps one buffer ($E800).
//  A3. Input bits of an iteration: u d l r f.  "any of u, d, l, r" (u and d together count: hold advances, s > 0, no net movement).
//  A4. Press: the hot spot is the position AFTER this iteration's move (step 3 comes before step 4).  A press on a title bar of a
//      window records Q = that position and draws the window's outline at offset (0, 0).
//  A5. Held with a drag and a changed position: erase the outline where it is drawn (the old offset), draw it at (px - Qx, py - Qy).
//      "Position changed" = changed by THIS iteration's move.
//  A6. Release (17.5, as amended): D_MENU_CLOSE of the open menu, and D_OUTLINE at the offset where the outline is drawn (the last offset
//      drawn, i.e. from the position BEFORE this iteration's move), so the screen returns to the scene even when the pointer moves on the
//      release iteration.  tests/spike6.mjs checks it (release fire while holding a direction, for a drag and for a menu).
//  A7. D_OUTLINE: four shields of one edge each (top, bottom, left, right in that order), each edge XORed under its own shield.
//  A8. The model runs the frame as "P_ISR, then the iteration" (the ISR runs first in the frame, 17.5 "right after the HALT returns").
import * as G from './gfx6-model.mjs';

const { Gfx6Model, PointerModel, OP_SET, OP_CLR, OP_XOR } = G;
export const NONE = 0xFF;                                             // V_MENU: no menu open
const str = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------------------------------------------------------
// 17.4: the scene
export const TITLES = ['Leap', 'File', 'Edit', 'View', 'Window'];
export const ITEMS = [
  ['About Leap Desktop', 'Calculator', 'Notepad'],
  ['New', 'Open...', 'Close', 'Save', 'Quit'],
  ['Undo', 'Cut', 'Copy', 'Paste'],
  ['By Icon', 'By Name', 'By Size'],
  ['Bring to Front', 'Tile', 'Close All'],
];
export const titleRect = (i) => [8 + 56 * i, 0, 56, 10];
export const menuRect = (i) => [8 + 56 * i, 10, 128, 10 * ITEMS[i].length + 4];
export const WIN = [null, { rect: [32, 24, 288, 104], title: 'Notes (8x8)' }, { rect: [224, 64, 256, 112], title: 'About mode 6 (proportional)' }];   // 1 = A, 2 = B

const A_LINES = [[5, 'Leap Desktop spike6'], [6, 'Mode 6: 512 x 192, 64 columns.'], [7, 'This window uses the 8x8 font.'], [9, 'The pointer is drawn by the'],
  [10, 'frame interrupt. Hold fire on'], [11, 'a menu title to open its list,'], [12, 'or on a title bar to drag an'], [13, 'outline. Nothing else works.']];
const B_LINES = ['The quick brown fox jumps over the lazy dog.', 'Mode 6 gives the desktop 512 pixels across, so a',
  'proportional font fits about eighty characters on a', 'line. Each glyph is shifted into place through byte',
  'tables and clipped to its window. This line is long enough to run past the right edge of the window.', 'Menus, title bars and dialogs all use it:',
  '(1) open, (2) scroll, [3] close;', '"quotes", \'apostrophes\' & 100% {braces}', '<angles> @home #tags $5 ~ok? Yes!', '0123456789 ABCDEFGHIJKLM NOPQRSTUVWXYZ',
  'abcdefghijklm nopqrstuvwxyz', 'Twelve lines fit; the thirteenth is cut by the clip.', '(clipped)'];

/** The icon's art (17.4): '#' ink (mask 0, image 1), '.' paper (mask 0, image 0), ' ' transparent (mask 1, image 0).  Rows are 32 wide. */
export const ICON_ART = [
  ' ##############################',
  '#..............................#',
  '#.############################.#',
  '#.#..........................#.#',
  '#.#....####..........####....#.#',
  '#.#...#....#........#....#...#.#',
  '#.#...#.##.#..####..#.##.#...#.#',
  '#.#...#....#........#....#...#.#',
  '#.#....####..........####....#.#',
  '#.#..........................#.#',
  '#.############################.#',
  '#..............................#',
  '#.......################.......#',
  '#......#..##........##..#......#',
  '#.....#...##........##...#.....#',
  ' ##############################',
];
/** The icon in G_BLIT's pair format (wb = 4, 128 bytes), built from the art: rows 0 and 15 end in a space (column 31). */
export function iconBytes() {
  const out = new Uint8Array(128);
  ICON_ART.forEach((row, k) => {
    const r = row.padEnd(32, ' ');
    for (let b = 0; b < 4; b++) {
      let mk = 0, im = 0;
      for (let j = 0; j < 8; j++) {
        const ch = r[8 * b + j], bit = 0x80 >> j;
        if (ch === '#') im |= bit; else if (ch === ' ') mk |= bit;
      }
      out[2 * (4 * k + b)] = mk; out[2 * (4 * k + b) + 1] = im;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// 17.5: the script (n, input, checkpoint, position after it) -- written from the table's columns
const bitsOf = (s) => [...s].reduce((a, ch) => a | ({ u: 1, d: 2, l: 4, r: 8, f: 16 }[ch] ?? 0), 0);
export const SCRIPT = [
  [30, '', 1, [256, 96]], [30, 'ul', 0, [76, 6]], [40, 'f', 2, [76, 6]], [18, 'rf', 0, [148, 6]], [10, 'f', 0, [148, 6]],
  [18, 'rf', 0, [220, 6]], [10, 'f', 0, [220, 6]], [12, 'rf', 0, [256, 6]], [20, 'f', 3, [256, 6]], [20, '', 4, [256, 6]],
  [24, 'd', 0, [256, 66]], [2, '', 0, [256, 66]], [10, 'f', 0, [256, 66]], [18, 'dlf', 0, [184, 102]], [20, 'f', 5, [184, 102]],
  [20, '', 6, [184, 102]], [60, 'dr', 0, [511, 191]], [20, '', 7, [511, 191]], [24, 'ul', 0, [391, 131]], [20, '', 8, [391, 131]],
].map(([n, inp, cp, pos], idx) => ({ idx: idx + 1, n, bits: bitsOf(inp), cp, pos }));
export const SCRIPT_ITERATIONS = SCRIPT.reduce((a, e) => a + e.n, 0);           // 426
/** The input bits of iteration k (1-based) of the script, or null past its end. */
export const scriptBits = (k) => { let a = 0; for (const e of SCRIPT) { if (k <= a + e.n) return e.bits; a += e.n; } return null; };
/** First / last iteration (1-based) of each entry, and the iteration of each checkpoint k = 1.. (the last one of its entry). */
export const ENTRY_SPAN = (() => { let a = 0; return SCRIPT.map((e) => { const s = a + 1; a += e.n; return { idx: e.idx, first: s, last: a }; }); })();
export const CHECKPOINT_ITER = SCRIPT.filter((e) => e.cp).map((e) => ENTRY_SPAN[e.idx - 1].last);
/** The bytes S_SCRIPT must hold: (n, bits | $80 on a checkpoint), then n = 0. */
export const scriptBytes = () => [...SCRIPT.flatMap((e) => [e.n, e.bits | (e.cp ? 0x80 : 0)]), 0];

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// ---------------------------------------------------------------------------------------------------------------------------
export class Spike6Model {
  /**
   * @param arrow the 64 bytes of P_ARROW.  opts.boot (default true): the state after boot (scene drawn, P_INIT (256, 96) done, nothing
   * drawn by the ISR yet).  boot false: a blank screen, pointer off (the caller draws with drawScene() / the D_ methods).
   */
  constructor(arrow, { boot = true } = {}) {
    this.icon = iconBytes();
    this.scr = new Gfx6Model();
    this.pm = new PointerModel(this.scr, arrow);
    this.px = 256; this.py = 96; this.hold = 0; this.fire = 0; this.menu = NONE; this.drag = 0; this.Q = { x: 0, y: 0 }; this.off = { x: 0, y: 0 };
    this.tick = 0; this.saved = null;
    if (boot) { this.drawScene(); this.pm.init(256, 96); }
  }

  // ---- 17.4 --------------------------------------------------------------------------------------------------------------
  drawWindow(n) {
    const s = this.scr, { rect: [x, y, w, h], title } = WIN[n];
    s.setOp(OP_CLR); s.fill(x, y, w, h);
    s.setOp(OP_SET); s.frame(x, y, w, h);
    s.setOp(OP_SET); s.fill(x, y, w, 11);
    s.setOp(OP_XOR); s.textp(x + 8, y + 2, str(title));
    s.setClip(x + 1, y + 11, w - 2, h - 12); s.setOp(OP_SET);
    if (n === 1) for (const [r, t] of A_LINES) s.text8(5, r, str(t));
    else B_LINES.forEach((t, j) => s.textp(232, 78 + 8 * j, str(t)));
    s.setClip(0, 0, 512, 192);
  }
  /** D_SCENE: unshielded. */
  drawScene() {
    const s = this.scr;
    s.setOp(OP_SET); s.setGlh(8); s.setClip(0, 0, 512, 192);
    s.hline(0, 10, 512);
    TITLES.forEach((t, i) => s.textp(16 + 56 * i, 1, str(t)));
    s.blit(432, 24, 32, 16, this.icon); s.textp(436, 42, str('Tapes'));
    this.drawWindow(1); this.drawWindow(2);
  }
  /** D_MENU_OPEN(i). */
  menuOpen(i) {
    const s = this.scr, p = this.pm, t = titleRect(i), m = menuRect(i);
    p.shield(...t); s.setOp(OP_XOR); s.fill(...t); s.setOp(OP_SET); p.unshield();
    p.shield(...m); this.saved = s.saveRect(...m); s.setOp(OP_CLR); s.fill(...m); s.setOp(OP_SET); s.frame(...m);
    ITEMS[i].forEach((it, j) => s.textp(16 + 56 * i, 13 + 10 * j, str(it)));
    p.unshield(); this.menu = i;
  }
  /** D_MENU_CLOSE: nothing when no menu is open. */
  menuClose() {
    if (this.menu === NONE) return;
    const s = this.scr, p = this.pm, i = this.menu, t = titleRect(i), m = menuRect(i);
    p.shield(...m); s.restoreRect(this.saved); p.unshield();
    p.shield(...t); s.setOp(OP_XOR); s.fill(...t); s.setOp(OP_SET); p.unshield();
    this.menu = NONE;
  }
  /** D_OUTLINE (x, y, w, h): w >= 1, h >= 3; the four edges of G_FRAME's pixels, each in XOR under its own shield. */
  outline(x, y, w, h) {
    const s = this.scr, p = this.pm;
    for (const e of [[x, y, w, 1], [x, y + h - 1, w, 1], [x, y + 1, 1, h - 2], [x + w - 1, y + 1, 1, h - 2]]) {
      p.shield(...e); s.setOp(OP_XOR); s.fill(...e); s.setOp(OP_SET); p.unshield();
    }
  }
  /** The outline of window n at offset (dx, dy). */
  outlineWin(n, dx, dy) { const [x, y, w, h] = WIN[n].rect; this.outline(x + dx, y + dy, w, h); }

  // ---- 17.5 --------------------------------------------------------------------------------------------------------------
  /** What the frame interrupt does: P_ISR. */
  isr() { return this.pm.isr(); }
  titleAt(px, py) { if (py > 9) return -1; const i = Math.floor((px - 8) / 56); return px >= 8 && i >= 0 && i <= 4 ? i : -1; }
  barAt(px, py) {                                                      // B first: it is in front
    for (const n of [2, 1]) { const [x, y, w] = WIN[n].rect; if (px >= x && px < x + w && py >= y && py < y + 11) return n; }
    return 0;
  }
  /** One main-loop iteration (17.5) with the input bits u d l r f = bit 0..4. */
  iterate(bits) {
    const u = bits & 1, d = (bits >> 1) & 1, l = (bits >> 2) & 1, r = (bits >> 3) & 1, f = (bits >> 4) & 1;
    this.tick++;
    let s = 0;
    if (u || d || l || r) { s = Math.min(1 + Math.floor(this.hold / 6), 6); this.hold++; } else this.hold = 0;
    const nx = clamp(this.px + 2 * s * (r - l), 0, 511), ny = clamp(this.py + s * (d - u), 0, 191);
    const changed = nx !== this.px || ny !== this.py;
    this.px = nx; this.py = ny;
    if (changed) this.pm.move(nx, ny);
    if (f && !this.fire) {                                             // press
      const i = this.titleAt(nx, ny);
      if (i >= 0) this.menuOpen(i);
      else {
        const n = this.barAt(nx, ny);
        if (n) { this.drag = n; this.Q = { x: nx, y: ny }; this.off = { x: 0, y: 0 }; this.outlineWin(n, 0, 0); }
      }
    } else if (f && this.fire) {                                       // held
      if (this.menu !== NONE) { const j = this.titleAt(nx, ny); if (j >= 0 && j !== this.menu) { this.menuClose(); this.menuOpen(j); } }
      if (this.drag && changed) {
        this.outlineWin(this.drag, this.off.x, this.off.y);
        this.off = { x: nx - this.Q.x, y: ny - this.Q.y };
        this.outlineWin(this.drag, this.off.x, this.off.y);
      }
    } else if (!f && this.fire) {                                      // release
      if (this.menu !== NONE) this.menuClose();
      if (this.drag) { this.outlineWin(this.drag, this.off.x, this.off.y); this.drag = 0; }
    }
    this.fire = f;
  }
  /** One frame: the ISR, then the iteration. */
  frame(bits) { this.isr(); this.iterate(bits); }
  /** The display the model implies now (screen + pointer at D). */
  display() { return this.pm.display(); }
  /** The plain screen with the pointer image at (x, y) (the model's blit with the whole-screen clip), as a Gfx6Model. */
  screenWithPointer(x, y) { const d = new Gfx6Model(); d.px.set(this.scr.px); d.blit(x, y, 16, 16, this.pm.arrow); return d; }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Self-test:  node tests/spike6-model.mjs
export async function selfTest() {
  const { checks } = await import('./lib.mjs');
  const C = checks('spike6-model self-test');
  const sceneOf = () => { const q = new Spike6Model(G.TEST_ARROW); return q.scr.px.slice(); };

  C.check('the script has 20 entries and 426 iterations; 8 checkpoints (the last iteration of entries 1, 3, 9, 10, 15, 16, 18, 20)',
    SCRIPT.length === 20 && SCRIPT_ITERATIONS === 426 && CHECKPOINT_ITER.length === 8 && JSON.stringify(SCRIPT.filter((e) => e.cp).map((e) => e.idx)) === '[1,3,9,10,15,16,18,20]',
    `${SCRIPT_ITERATIONS} iterations, checkpoints at ${CHECKPOINT_ITER.join(', ')}`);
  C.check('script bytes: 40 entry bytes and the terminator; entry 3 = 40, f | $80; entry 14 = 18, d l f; last byte 0',
    scriptBytes().length === 41 && scriptBytes()[4] === 40 && scriptBytes()[5] === (16 | 0x80) && scriptBytes()[26] === 18 && scriptBytes()[27] === (2 | 4 | 16) && scriptBytes()[40] === 0);

  // The script run through the model: positions after each entry (the "Position after it" column).
  const mdl = new Spike6Model(G.TEST_ARROW), scene = mdl.scr.px.slice();
  let bad = '', k = 0, cpSeen = 0, cpBad = '', maxMenuOn = 0;
  const snaps = [];
  for (const e of SCRIPT) {
    for (let i = 1; i <= e.n; i++) {
      k++; mdl.frame(e.bits);
      if (mdl.menu !== NONE) maxMenuOn++;
    }
    if (mdl.px !== e.pos[0] || mdl.py !== e.pos[1]) bad += ` entry ${e.idx}: (${mdl.px}, ${mdl.py}) want (${e.pos})`;
    if (e.cp) {
      cpSeen++;
      if (!mdl.pm.D || mdl.pm.D.x !== mdl.px || mdl.pm.D.y !== mdl.py) cpBad += ` cp ${cpSeen}: the pointer is not drawn at the position (D ${JSON.stringify(mdl.pm.D)})`;
      snaps.push({ cp: cpSeen, menu: mdl.menu, drag: mdl.drag, pos: [mdl.px, mdl.py], px: mdl.scr.px.slice() });
    }
  }
  C.check('the model reproduces the script table: the position after every one of the 20 entries equals the "Position after it" column', !bad && k === 426, bad || `${k} iterations`);
  C.check('the pointer is drawn at the position (D = position) at every checkpoint (a quiet stretch of >= 20 iterations)', !cpBad && cpSeen === 8, cpBad);
  const same = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
  const [c1, c2, c3, c4, c5, c6, c7, c8] = snaps;
  C.check('checkpoints 1, 4, 6, 7, 8: the plain scene (no menu, no drag); 2: "File" open; 3: "Window" open; 5: window B being dragged; 6: outline gone',
    [c1, c4, c6, c7, c8].every((c) => c.menu === NONE && c.drag === 0 && same(c.px, scene)) && c2.menu === 1 && c3.menu === 4 && c5.drag === 2 && c5.menu === NONE && !same(c5.px, scene) && !same(c2.px, scene) && !same(c3.px, scene));
  C.check('the model screen after the script equals the scene (menus restored, outline erased)', same(mdl.scr.px, scene));

  // The scene.
  const s0 = new Spike6Model(G.TEST_ARROW);
  let ink = 0; for (const v of s0.scr.px) ink += v;
  C.check('scene sanity: ink pixels present, the hline at row 10 is ink where no title or window covers it (x = 400), op SET, GLH 8, clip whole screen',
    ink > 5000 && s0.scr.get(400, 10) === 1 && s0.scr.get(400, 9) === 0 && s0.scr.op === OP_SET && s0.scr.glh === 8 && s0.scr.clip.x1 === 512 && s0.scr.clip.y1 === 192, `${ink} ink pixels`);
  C.check('window A: black title bar (11 rows), white interior; window B in front of A: B\'s interior is paper where it covers A\'s text',
    s0.scr.get(300, 24) === 1 && s0.scr.get(100, 100) === 0 && s0.scr.get(226, 100) === 0 && s0.scr.get(224, 100) === 1);
  const icon = iconBytes();
  C.check('icon bytes: 128; row 0: pair 0 = mask $80 image $7F, pair 3 = mask $01 image $FE; row 1: pair 0 = mask 0 image $80 (ink, then paper)',
    icon.length === 128 && icon[0] === 0x80 && icon[1] === 0x7F && icon[6] === 0x01 && icon[7] === 0xFE && icon[8] === 0 && icon[9] === 0x80);
  const sc = (i) => { const q = new Spike6Model(G.TEST_ARROW); q.menuOpen(i); return q; };
  bad = '';
  for (let i = 0; i < 5; i++) {
    const q = sc(i);
    if (same(q.scr.px, scene)) bad += ` open ${i}: no change;`;
    q.menuClose();
    if (!same(q.scr.px, scene) || q.menu !== NONE) bad += ` close ${i}: not restored;`;
    q.menuClose(); if (!same(q.scr.px, scene)) bad += ` close with none open changed the screen;`;
  }
  C.check('D_MENU_OPEN then D_MENU_CLOSE restores the scene for i = 0..4; a close with no menu open does nothing', !bad, bad);
  bad = '';
  for (const [dx, dy] of [[0, 0], [-72, 36], [12, 6], [-300, 5], [250, -80]]) {
    const q = new Spike6Model(G.TEST_ARROW), [x, y, w, h] = WIN[2].rect;
    q.outlineWin(2, dx, dy);
    const fr = new Gfx6Model(); fr.px.set(scene); fr.setOp(OP_XOR); fr.frame(x + dx, y + dy, w, h);
    if (!same(q.scr.px, fr.px)) bad += ` (${dx}, ${dy}): outline != XOR G_FRAME;`;
    q.outlineWin(2, dx, dy);
    if (!same(q.scr.px, scene)) bad += ` (${dx}, ${dy}): twice did not restore;`;
  }
  C.check('D_OUTLINE = XOR G_FRAME of the rectangle (each pixel once, clipped), and a second call restores the screen', !bad, bad);
  const pm = new Spike6Model(G.TEST_ARROW);
  pm.pm.move(200, 20); pm.isr(); pm.menuOpen(3);
  C.check('a menu opened over the drawn pointer erases it (shield) until the next P_ISR; the pointer then draws over the menu', pm.pm.D === null && (pm.isr(), pm.pm.D.x === 200 && !pm.display().compare(pm.screenWithPointer(200, 20))));
  C.done();
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) await selfTest();
