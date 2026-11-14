"use strict";
// look-model.mjs -- the proposed Mac OS 1.0 style look (docs/LOOK.md), as pixels on a Gfx6Model.  Draft for the owner's choice: once
// the owner picks, the chosen functions become the reference model of the look slice's tests (LOOK 7).  Today it feeds the mock-ups
// (tools/look-mock.mjs) only.  Every function draws with the whole-screen clip; the order of drawing inside one function is free.
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from './gfx6-model.mjs';
import { titleCut } from './wm-model2.mjs';
import { tw } from './wm-model3.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR };

// ---------------------------------------------------------------------------------------------------------------------------
// Desk patterns (LOOK 3.4): two row bytes, row y uses pat[y & 1]; bit 7 = the leftmost pixel of each byte.  Byte-aligned: the
// pattern of pixel (x, y) depends on x & 7 and y & 1 only, so every cell (16 x 8) shows the same pattern wherever it is.
export const PATTERNS = {
  grey50: [0xAA, 0x55],          // a checkerboard: pixel (x, y) is ink when x + y is even
  grey25: [0x88, 0x22],          // one pixel in four
  white: [0x00, 0x00],           // today's desk
};
export const patBit = (pat, x, y) => (pat[y & 1] >> (7 - (x & 7))) & 1;
/** The pattern fill: every pixel of (x, y, w, h) takes the pattern's value (the new op, LOOK 4.1). */
export function patFill(g, pat, x, y, w, h) {
  for (let yy = Math.max(y, 0); yy < Math.min(y + h, 192); yy++)
    for (let xx = Math.max(x, 0); xx < Math.min(x + w, 512); xx++) g.set(xx, yy, patBit(pat, xx, yy));
}

/** The drag outline XORed with the pattern instead of ink (LOOK 3.4, option B): solid paper over the desk, dotted over paper. */
export function patXorFrame(g, pat, x, y, w, h) {
  const px = (xx, yy) => { if (xx >= 0 && xx < 512 && yy >= 0 && yy < 192) g.set(xx, yy, g.get(xx, yy) ^ patBit(pat, xx, yy)); };
  for (let i = 0; i < w; i++) { px(x + i, y); if (h > 1) px(x + i, y + h - 1); }
  for (let j = 1; j < h - 1; j++) { px(x, y + j); if (w > 1) px(x + w - 1, y + j); }
}

// ---------------------------------------------------------------------------------------------------------------------------
// The menu bar (LOOK 3.1).  Paper rows 0-6, a line at row 7, the titles in ink at (box x + 8, 0).  Glyph rows 1-6 hold the
// letters, row 7 the descenders, which rest on the line.  An open title: XOR fill (box x, 0, box w, 7), rows 0-6 only.
export function barLook(g, menus, lay) {
  g.setOp(OP_CLR); g.fill(0, 0, 512, 7);
  g.setOp(OP_SET); g.hline(0, 7, 512);
  if (menus && lay && lay.boxes) for (let i = 0; i < menus.length; i++) g.textp(lay.boxes[i].x + 8, 0, menus[i].title);
}
/** Menu i opened (LOOK 3.1): as WINDOWS 18.3 but the drop-down has no top line of its own (the bar's line is its top edge) and the title box is rows 0-6. */
export function openLook(g, menus, lay, en, i, h) {
  const d = lay.drops[i], b = lay.boxes[i], m = menus[i];
  g.setOp(OP_CLR); g.fill(d.x, 8, d.w, d.h);       // no top line at row 8: the bar's line (row 7) is the drop-down's top edge
  g.setOp(OP_SET); g.vline(d.x, 8, d.h); g.vline(d.x + d.w - 1, 8, d.h); g.hline(d.x, 7 + d.h, d.w);
  g.fill(d.x + d.w, 10, 2, d.h - 1); g.fill(d.x + 2, 8 + d.h, d.w, 1);
  for (let k = 0; k < m.items.length; k++) {
    const it = m.items[k];
    g.setOp(OP_SET);
    if (it.flags & 2) { g.hline(d.x + 1, 13 + 10 * k, d.w - 2); continue; }
    g.textp(d.x + 8, 10 + 10 * k, it.text);
    if (!en[i][k]) { const t = tw(it.text); g.setOp(OP_CLR); for (const r of [11, 13, 15, 17]) g.fill(d.x + 8, r + 10 * k, t, 1); }
  }
  g.setOp(OP_XOR); g.fill(b.x, 0, b.w, 7);
  if (h >= 0) g.fill(d.x + 1, 9 + 10 * h, d.w - 2, 10);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Windows (LOOK 3.2, 3.3, 3.5).  The rectangle (x, y, w, h) stays the cell-aligned one the window manager knows; the frame is
// (x, y, w - 2, h - 1) and the shadow fills the last 2 columns and the last row, so nothing is drawn outside the rectangle.
// The two corners the shadow leaves (top right, bottom left) show the desk pattern.
export const TITLE_GAP = 6;            // paper columns each side of the title on a striped bar
export const BOX = { gx: 8, fx: 10, fw: 11 };   // close box: paper gap from x + 8 (15 wide, rows y+1..y+7), frame (x + 10, y + 2, 11, 5)
/** The largest count of title codes that fits between the close-box zone and its mirror: PROP6 sum <= w - 64. */
export const macTitleCut = (codes, w) => titleCut(codes, w - 48);
export function windowLook(g, n, active, { pat = PATTERNS.grey50, closeBox = false, pressed = false } = {}) {
  const { x, y, w, h } = n, fw = w - 2, fh = h - 1;
  g.setOp(OP_SET); g.frame(x, y, fw, fh);
  g.fill(x + fw, y + 1, 2, fh);                     // shadow: right
  g.fill(x + 2, y + fh, fw, 1);                     // shadow: bottom
  patFill(g, pat, x + fw, y, 2, 1);                 // the corners the shadow leaves
  patFill(g, pat, x, y + fh, 2, 1);
  g.setOp(OP_CLR); g.fill(x + 1, y + 1, fw - 2, 7);
  if (active) { g.setOp(OP_SET); for (const r of [2, 4, 6]) g.hline(x + 2, y + r, fw - 4); }
  g.setOp(OP_SET); g.hline(x + 1, y + 8, fw - 2);
  if (n.title) {
    const codes = n.title.codes.slice(0, macTitleCut(n.title.codes, fw)), t = codes.length ? tw(codes) : 0;
    const tx = x + Math.floor((fw - t) / 2);
    if (active && t) { g.setOp(OP_CLR); g.fill(tx - TITLE_GAP, y + 1, t + 2 * TITLE_GAP, 7); }
    g.setOp(OP_SET); if (t) g.textp(tx, y, codes);
  }
  if (active && closeBox) closeBoxLook(g, x, y, pressed);
  g.setOp(OP_CLR); g.fill(x + 1, y + 9, fw - 2, fh - 10);
}
/** The close box, left (LOOK 3.3): paper gap (x + 8, y + 1, 15, 7), frame (x + 10, y + 2, 11, 5); pressed: XOR fill (x + 11, y + 3, 9, 3). */
export function closeBoxLook(g, x, y, pressed = false) {
  g.setOp(OP_CLR); g.fill(x + BOX.gx, y + 1, 15, 7);
  g.setOp(OP_SET); g.frame(x + BOX.fx, y + 2, BOX.fw, 5);
  if (pressed) { g.setOp(OP_XOR); g.fill(x + BOX.fx + 1, y + 3, BOX.fw - 2, 3); }
}
export const boxRect = (x, y) => ({ x: x + BOX.gx, y: y + 1, w: 15, h: 7 });

// ---------------------------------------------------------------------------------------------------------------------------
// The pointer (LOOK 3.6).  '#' ink, 'o' paper, '.' transparent; the hot spot is pixel (0, 0), ink (OBJECTS_EVENTS 14.6).
export const ARROW_NOW = [            // src/gfx6/pointer.asm P_ARROW today
  '##o.............', '###o............', '####o...........', '#####oo.........', '#######o........', '########oo......', '##########o.....', '###########o....',
  '#####ooooooo....', '##o###o.........', '#oo###o.........', 'o.oo###o........', '...o###o........', '....o###o.......', '....ooooo.......', '................',
];
// The Mac arrow (QuickDraw's black arrow: 8 rows widening by one pixel, a notch, a tail two pixels wide going down and right),
// widened 1.5 times so that it keeps its shape on mode 6's pixels, which are twice as tall as they are wide.
export const ARROW_MAC = [
  '##o.............', '###o............', '####o...........', '######o.........', '#######o........', '#########o......', '##########o.....', '############o...',
  '########ooooo...', '###oo###o.......', '##oo.o###o......', 'oo...o###o......', '......o###o.....', '......o###o.....', '.......ooo......', '................',
];
export function drawArrow(g, art, px, py) {
  for (let r = 0; r < 16; r++) for (let c = 0; c < 16; c++) {
    const ch = art[r][c], x = px + c, y = py + r;
    if (x >= 512 || y >= 192 || ch === '.') continue;
    g.set(x, y, ch === '#' ? 1 : 0);
  }
}
