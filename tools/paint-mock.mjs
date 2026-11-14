"use strict";
// paint-mock.mjs -- the mock-ups for the Paint contract (docs/PAINT.md 2, 7, 8, 10): the window, the shell with its new icon, and the
// two menus, drawn with the same models as tools/look-mock.mjs and tools/kc-mock.mjs (tests/look-model.mjs: the chosen Mac look, 25%
// grey desk; tests/wm-model3.mjs: menu layout; tests/shell-model.mjs: the shell's icons), as PNGs in docs/paint/.
//   node tools/paint-mock.mjs [OUTDIR]          (default docs/paint)
// Mode 6's pixels are twice as tall as they are wide: each screen pixel becomes 2 x 4 PNG pixels ("1:1", 1,024 x 768 a screen) and
// 4 x 8 ("-2x").  The tool icons, the patterns, the brush stamps and the sample picture are drawn here, as our own bitmaps; nothing is
// read from a cartridge and nothing is built.  Before writing, "today's" shell is checked pixel for pixel against the shell model.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from '../tests/gfx6-model.mjs';
import { menuSpec, layoutOf } from '../tests/wm-model3.mjs';
import * as SH from '../tests/shell-model.mjs';
import * as LK from '../tests/look-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs/paint');
mkdirSync(OUT, { recursive: true });
const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------------------------------------------------------
// A small bitmap for the icons, the stamps and the sample picture: 1 = ink.
class Bmp {
  constructor(w, h) { this.w = w; this.h = h; this.p = new Uint8Array(w * h); }
  set(x, y, v = 1) { if (x >= 0 && x < this.w && y >= 0 && y < this.h) this.p[y * this.w + x] = v; return this; }
  get(x, y) { return x >= 0 && x < this.w && y >= 0 && y < this.h ? this.p[y * this.w + x] : 0; }
  fill(x, y, w, h, v = 1) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, v); return this; }
  frame(x, y, w, h) { return this.fill(x, y, w, 1).fill(x, y + h - 1, w, 1).fill(x, y, 1, h).fill(x + w - 1, y, 1, h); }
  line(x0, y0, x1, y1) { new Gfx6Model().linePixels(x0, y0, x1, y1).forEach(([x, y]) => this.set(x, y)); return this; }   // the model's line (15.2)
  ellipse(cx, cy, rx, ry) {
    const n = 4 * (rx + ry) + 8;
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; this.set(Math.round(cx + rx * Math.cos(a)), Math.round(cy + ry * Math.sin(a))); }
    return this;
  }
  art(rows) { rows.forEach((r, y) => [...r].forEach((c, x) => { if (c === '#') this.set(x, y); })); return this; }
  put(g, ox, oy) { for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.p[y * this.w + x]) g.set(ox + x, oy + y, 1); }
}

// ---- the ten tool icons, 16 x 12 (PAINT 7), in the order of PT_TOOLS
function dashedFrame(b, x, y, w, h) {                       // 2 on, 2 off round the rectangle
  const pts = [];
  for (let i = 0; i < w; i++) pts.push([x + i, y]);
  for (let j = 1; j < h; j++) pts.push([x + w - 1, y + j]);
  for (let i = w - 2; i >= 0; i--) pts.push([x + i, y + h - 1]);
  for (let j = h - 2; j >= 1; j--) pts.push([x, y + j]);
  pts.forEach(([px, py], i) => { if ((i >> 1) % 2 === 0) b.set(px, py); });
}
const ICONS12 = [
  ['Marquee', () => { const b = new Bmp(16, 12); dashedFrame(b, 1, 1, 14, 10); return b; }],
  ['Pencil', () => new Bmp(16, 12).art([                   // a slanted pencil: body, wood cone, lead
    '............##..',
    '...........####.',
    '..........#.##.#',
    '.........#.#..#.',
    '........#.#..#..',
    '.......#.#..#...',
    '......#.#..#....',
    '.....#.#..#.....',
    '....##.#.#......',
    '...###.##.......',
    '..####..........',
    '.##.............'])],
  ['Brush', () => new Bmp(16, 12).art([                    // a paintbrush: handle (upper right), ferrule, bristles
    '..............##',
    '.............##.',
    '............##..',
    '...........##...',
    '..........####..',
    '.........#.##.#.',
    '........#.####..',
    '.......#.#####..',
    '....##.####.....',
    '...####.##......',
    '..#####.........',
    '..###...........'])],
  ['Eraser', () => { const b = new Bmp(16, 12);            // a slanted block, its lower part solid
    for (let r = 0; r < 8; r++) { const l = 5 - (r >> 1); if (r === 0 || r === 7 || r >= 5) b.fill(l, r + 2, 10, 1); else { b.set(l, r + 2); b.set(l + 9, r + 2); } }
    return b; }],
  ['Spray', () => { const b = new Bmp(16, 12); b.frame(1, 5, 7, 7); b.fill(3, 3, 3, 2); b.fill(2, 7, 5, 1);
    [[10, 2], [12, 4], [14, 1], [12, 7], [10, 6], [14, 5], [10, 9], [13, 10], [8, 1], [15, 8]].forEach(([x, y]) => b.set(x, y)); return b; }],
  ['Bucket', () => { const b = new Bmp(16, 12); b.fill(2, 5, 9, 1); b.line(2, 5, 3, 11); b.line(10, 5, 9, 11); b.fill(3, 11, 7, 1);
    b.line(2, 5, 4, 2); b.fill(4, 2, 4, 1); b.line(8, 2, 10, 5); b.fill(4, 7, 5, 2);
    [[13, 6], [13, 7], [12, 7], [14, 7], [13, 8], [13, 10], [14, 11]].forEach(([x, y]) => b.set(x, y)); return b; }],
  ['Line', () => new Bmp(16, 12).line(1, 10, 14, 1)],
  ['Rectangle', () => new Bmp(16, 12).frame(1, 1, 14, 10)],
  ['Rounded rectangle', () => { const b = new Bmp(16, 12); b.fill(3, 1, 10, 1).fill(3, 10, 10, 1).fill(1, 3, 1, 6).fill(14, 3, 1, 6);
    [[2, 2], [13, 2], [2, 9], [13, 9]].forEach(([x, y]) => b.set(x, y)); return b; }],
  ['Oval', () => new Bmp(16, 12).ellipse(7.5, 5.5, 7, 5)],
];

// ---- the 16 patterns (PAINT 7: 8 x 8 bits, bit 7 the leftmost pixel; solid first, white last)
const PATS = [
  ['solid', [255, 255, 255, 255, 255, 255, 255, 255]],
  ['75%', [0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB]],
  ['50% checker', [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55]],
  ['25%', [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22]],
  ['12%', [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00]],
  ['horizontal lines', [0xFF, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00]],
  ['vertical lines', [0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA]],
  ['diagonal', [0xC0, 0x60, 0x30, 0x18, 0x0C, 0x06, 0x03, 0x81]],
  ['dots', [0x88, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00]],
  ['bricks', [0xFF, 0x80, 0x80, 0x80, 0xFF, 0x08, 0x08, 0x08]],
  ['cross-hatch', [0xFF, 0x88, 0x88, 0x88, 0xFF, 0x88, 0x88, 0x88]],
  ['large dots', [0x00, 0x38, 0x7C, 0x7C, 0x7C, 0x38, 0x00, 0x00]],
  ['weave', [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81]],
  ['2 x 2 checker', [0xCC, 0xCC, 0x33, 0x33, 0xCC, 0xCC, 0x33, 0x33]],
  ['back diagonal', [0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0xC0, 0x81]],
  ['white', [0, 0, 0, 0, 0, 0, 0, 0]],
];
const PAT = Object.fromEntries(PATS);
const pbit = (pat, x, y) => (pat[y & 7] >> (7 - (x & 7))) & 1;         // anchored to the screen (x AND 7, y AND 7), as G_PATFILL
const patRect = (g, pat, x, y, w, h) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) g.set(x + i, y + j, pbit(pat, x + i, y + j)); };
const patWhere = (g, pat, x0, y0, x1, y1, inside) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inside(x, y)) g.set(x, y, pbit(pat, x, y)); };

// ---- the four brush stamps (PAINT 7): a round 3, a round 6, a square 4, a diagonal 6; real pixel sizes, centred in a 15 x 15 cell
const STAMPS = [
  new Bmp(15, 15).fill(6, 5, 3, 5).fill(5, 6, 5, 3),                      // round 3: a 3-px disc (pixels are twice as tall as wide, so 3 x 5 at the edge of the tall bulge)
  (() => { const b = new Bmp(15, 15); for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if ((x - 2.5) ** 2 + (y - 2.5) ** 2 <= 7.6) b.set(5 + x, 5 + y); return b; })(),
  new Bmp(15, 15).fill(6, 6, 4, 4),                                       // square 4
  (() => { const b = new Bmp(15, 15); for (let k = 0; k < 6; k++) { b.set(4 + k, 10 - k); b.set(5 + k, 10 - k); } return b; })(),   // diagonal 6
];

// ---------------------------------------------------------------------------------------------------------------------------
// The menus (PAINT 8)
const LEAP = menuSpec(1, 'Leap', [[1, 0, 'About Leap Desktop...'], [2, 2, ''], [3, 0, 'Calculator'], [4, 0, 'Key Caps'], [5, 0, 'Notepad'], [6, 0, 'Paint']]);
const FILE = menuSpec(2, 'File', [[1, 0, 'New'], [2, 0, 'Open...'], [3, 0, 'Save...'], [0, 2, ''], [4, 0, 'Quit']]);
const EDIT = menuSpec(3, 'Edit', [[1, 0, 'Undo'], [2, 0, 'Clear']]);
const OPTS = menuSpec(4, 'Options', [[1, 0, 'Filled shapes'], [2, 0, 'Invert']]);
const MENUS = [LEAP, FILE, EDIT, OPTS];
const enOf = (menus) => menus.map((m) => m.items.map((it) => !(it.flags & 3)));

// ---------------------------------------------------------------------------------------------------------------------------
// The window (PAINT 2): every rectangle is screen-absolute.
const WIN = { x: 48, y: 16, w: 416, h: 176, title: { codes: codes('Paint: Untitled') } };
const TOOLS = { x: 53, y: 29, w: 64, h: 80 }, PATB = { x: 53, y: 113, w: 64, h: 48 }, BRUSH = { x: 53, y: 165, w: 64, h: 16 };
const CANV = { x: 126, y: 30, w: 324, h: 148 }, PIC = { x: 128, y: 32, w: 320, h: 144 }, STATUS = { x: 127, y: 180, w: 324, h: 9 };

/** A palette's grid: each cell owns its right column and bottom row as its border; the top row and left column sit one pixel
 *  outside the rectangle (x - 1, y - 1), so the cells keep the sizes the contract gives (32 x 16, 16 x 12, 16 x 16). */
function grid(g, r, cw, ch, nc, nr) {
  g.setOp(OP_SET);
  g.fill(r.x - 1, r.y - 1, nc * cw + 1, 1); g.fill(r.x - 1, r.y - 1, 1, nr * ch + 1);
  for (let i = 1; i <= nc; i++) g.fill(r.x + i * cw - 1, r.y, 1, nr * ch);
  for (let j = 1; j <= nr; j++) g.fill(r.x, r.y + j * ch - 1, nc * cw, 1);
}
function toolBox(g, sel) {
  grid(g, TOOLS, 32, 16, 2, 5);
  ICONS12.forEach(([, make], i) => {
    const cx = TOOLS.x + (i % 2) * 32, cy = TOOLS.y + Math.floor(i / 2) * 16;
    make().put(g, cx + 7, cy + 1);                          // the interior is 31 x 15: the 16 x 12 icon sits at (7, 1)
    if (i === sel) { g.setOp(OP_XOR); g.fill(cx, cy, 31, 15); }
  });
}
function patternBox(g, sel) {
  grid(g, PATB, 16, 12, 4, 4);
  PATS.forEach(([, pat], i) => {
    const cx = PATB.x + (i % 4) * 16, cy = PATB.y + Math.floor(i / 4) * 12;
    patRect(g, pat, cx, cy, 15, 11);
    if (i === sel) { g.setOp(OP_XOR); g.frame(cx, cy, 15, 11); g.frame(cx + 1, cy + 1, 13, 9); }   // the 2-px inverted border
  });
}
function brushBox(g, sel) {
  grid(g, BRUSH, 16, 16, 4, 1);
  STAMPS.forEach((b, i) => {
    const cx = BRUSH.x + i * 16;
    b.put(g, cx, BRUSH.y);
    if (i === sel) { g.setOp(OP_XOR); g.fill(cx, BRUSH.y, 15, 15); }
  });
}

// ---- a sample drawing in the picture area (320 x 144 at (128, 32)).  Pixels are twice as tall as wide, so a round shape has rx = 2 ry.
function sample(g) {
  const B = new Bmp(512, 192), X = PIC.x, Y = PIC.y;
  const ell = (cx, cy, rx, ry) => B.ellipse(cx, cy, rx, ry);
  const inEll = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  // grass: a 25% strip under a horizon line
  patRect(g, PAT['25%'], X, Y + 116, 320, 28); B.fill(X, Y + 116, 320, 1);
  // the house: brick walls, a 75% roof (a triangle), a chimney, a door and a window with a cross
  patRect(g, PAT.bricks, X + 30, Y + 78, 94, 38); B.frame(X + 30, Y + 78, 94, 38);
  patWhere(g, PAT['75%'], X + 22, Y + 44, X + 132, Y + 78, (x, y) => Math.abs(x - (X + 77)) <= 52 * ((y - (Y + 44)) / 34));
  B.line(X + 25, Y + 78, X + 77, Y + 44).line(X + 77, Y + 44, X + 129, Y + 78).fill(X + 25, Y + 78, 105, 1);
  patRect(g, PAT['25%'], X + 101, Y + 41, 10, 16); B.frame(X + 100, Y + 40, 12, 20);          // the chimney
  g.setOp(OP_CLR); g.fill(X + 49, Y + 90, 18, 26); g.fill(X + 88, Y + 90, 24, 14); g.setOp(OP_SET);
  B.frame(X + 48, Y + 89, 20, 27); B.set(X + 64, Y + 104).set(X + 65, Y + 104);              // the door and its knob
  B.frame(X + 87, Y + 89, 26, 16).fill(X + 99, Y + 89, 2, 16).fill(X + 87, Y + 96, 26, 1);   // the window
  // the sun: a solid disc with rays
  { const cx = X + 200, cy = Y + 26, rx = 24, ry = 12;
    patWhere(g, PAT.solid, cx - rx, cy - ry, cx + rx, cy + ry, inEll(cx, cy, rx, ry));
    for (let k = 0; k < 12; k++) { const a = (k * Math.PI) / 6; B.line(Math.round(cx + 32 * Math.cos(a)), Math.round(cy + 17 * Math.sin(a)), Math.round(cx + 44 * Math.cos(a)), Math.round(cy + 23 * Math.sin(a))); } }
  // the smiley: a 12% face with a double outline, eyes and a smile
  { const cx = X + 270, cy = Y + 88, rx = 36, ry = 18;
    patWhere(g, PAT['12%'], cx - rx, cy - ry, cx + rx, cy + ry, inEll(cx, cy, rx, ry)); ell(cx, cy, rx, ry); ell(cx, cy, rx - 1, ry);
    for (const ex of [-12, 12]) { patWhere(g, PAT.solid, cx + ex - 3, cy - 8, cx + ex + 3, cy - 4, inEll(cx + ex, cy - 6, 3, 2)); }
    for (let i = -22; i <= 22; i++) { const yy = cy + 3 + Math.round(8 * Math.sqrt(Math.max(0, 1 - (i / 22) ** 2))); B.set(cx + i, yy); B.set(cx + i, yy + 1); } }
  // the tree: a trunk and a foliage ellipse filled with large dots
  patRect(g, PAT['50% checker'], X + 169, Y + 101, 6, 14); B.frame(X + 168, Y + 100, 8, 16);
  { const cx = X + 172, cy = Y + 84, rx = 24, ry = 14; patWhere(g, PAT['large dots'], cx - rx, cy - ry, cx + rx, cy + ry, inEll(cx, cy, rx, ry)); ell(cx, cy, rx, ry); }
  // a cloud: three overlapping outlines
  ell(X + 100, Y + 18, 20, 7); ell(X + 118, Y + 14, 16, 8); ell(X + 84, Y + 21, 14, 6);
  // the shape tools: a filled rectangle (horizontal lines) and a hollow rounded rectangle
  patRect(g, PAT['horizontal lines'], X + 8, Y + 8, 36, 24); B.frame(X + 8, Y + 8, 36, 24);
  B.fill(X + 274, Y + 8, 30, 1).fill(X + 274, Y + 30, 30, 1).fill(X + 272, Y + 10, 1, 20).fill(X + 306, Y + 10, 1, 20);
  [[273, 9], [305, 9], [273, 29], [305, 29]].forEach(([x, y]) => B.set(X + x, Y + y));  
  // a freehand squiggle with the pencil, across the grass
  { let px = X + 140, py = Y + 132, seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 1; i <= 36; i++) { const nx = X + 140 + i * 4 + Math.round(rnd() * 3), ny = Y + 132 + Math.round(6 * Math.sin(i / 2.2) + (rnd() - 0.5) * 4); B.line(px, py, nx, ny); px = nx; py = ny; } }
  B.put(g, 0, 0);
}
function canvasView(g) {
  g.setOp(OP_SET); g.frame(CANV.x, CANV.y, CANV.w, CANV.h); g.frame(CANV.x + 1, CANV.y + 1, CANV.w - 2, CANV.h - 2);
  g.setOp(OP_CLR); g.fill(PIC.x, PIC.y, PIC.w, PIC.h);
  sample(g);
}

/** The Paint screen: desk, the bar (Leap File Edit Options), the window and its views. */
function paintScreen({ tool = 1, pat = 2, brush = 1, status = 'Pencil' } = {}) {
  const g = new Gfx6Model();
  LK.deskLook(g);
  LK.barLook(g, MENUS, layoutOf(MENUS));
  LK.macWindowLook(g, WIN, true, { closeBox: true });
  toolBox(g, tool); patternBox(g, pat); brushBox(g, brush);
  canvasView(g);
  g.setOp(OP_SET); g.textp(STATUS.x, STATUS.y, codes(status));
  return g;
}
function menuScene(menuIx, hi, ptr) {
  const g = paintScreen();
  LK.openLook(g, MENUS, layoutOf(MENUS), enOf(MENUS), menuIx, hi);
  LK.drawArrow(g, LK.ARROW_MAC, ptr[0], ptr[1]);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The shell (PAINT 10): today's window (3 icons, 256 wide) beside the proposed one (4 icons, 320 wide, Paint the fourth).
const PAINTICON = (() => {                                  // a palette with a thumb hole and paint dabs, a brush laid across it
  const b = new Bmp(32, 16);
  b.ellipse(13, 9, 12, 6).ellipse(13, 9, 11, 6);            // the palette
  b.ellipse(7, 11, 2, 1);                                   // the thumb hole
  [[10, 6], [14, 5], [18, 6], [8, 8]].forEach(([x, y]) => b.fill(x, y, 2, 2));   // paint dabs
  b.line(31, 0, 22, 7).line(30, 0, 21, 7).line(29, 0, 20, 7);   // the brush: handle
  b.fill(19, 7, 4, 1);                                      // the ferrule
  b.line(20, 8, 17, 11).line(21, 8, 18, 11).line(19, 8, 17, 10);   // bristles
  return b;
})();
SH.ICONART.PAINT = Array.from({ length: 16 }, (_, y) => Array.from({ length: 32 }, (_, x) => (PAINTICON.get(x, y) ? '#' : '.')).join(''));
const SHELL_ICONS = [...SH.ICONS, { name: 'Paint', art: 'PAINT', prog: 4, x: 240, y: 40, w: 64, h: 26 }];
function shellScene(nicons, w) {
  const g = new Gfx6Model();
  LK.deskLook(g);
  const menus = [nicons > 3 ? LEAP : SH.LEAP_MENU];
  LK.barLook(g, menus, layoutOf(menus));
  LK.macWindowLook(g, { x: 32, y: 24, w, h: 80, title: { codes: codes('Leap Desktop') } }, true);
  SHELL_ICONS.slice(0, nicons).forEach((ic, i) => SH.iconLook(g, ic, i === 0));
  return g;
}

// ---- the check: "today" is the shell model's screen
{
  const a = shellScene(3, 256), b = SH.renderShell({ sel: 0 });
  for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) { console.log(`FAIL  today's shell differs from renderShell at (${i % 512}, ${(i / 512) | 0}); nothing written`); process.exit(1); }
  console.log('ok    today\'s shell = shell-model renderShell');
}

// ---------------------------------------------------------------------------------------------------------------------------
// PNG (as tools/look-mock.mjs)
const INK = 0, PAPER = 255, GAP = 150;
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function png(w, h, gray) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) raw.set(gray.subarray(y * w, y * w + w), y * (w + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8Array(w * h).fill(GAP); }
  put(g, ox, oy, sx, sy, cx = 0, cy = 0, cw = 512, ch = 192) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = g.get(cx + x, cy + y) ? INK : PAPER;
      for (let j = 0; j < sy; j++) this.px.fill(v, (oy + y * sy + j) * this.w + ox + x * sx, (oy + y * sy + j) * this.w + ox + x * sx + sx);
    }
  }
  label(text, ox, oy, w) { const g = new Gfx6Model(); g.setOp(OP_SET); g.textp(0, 0, codes(text)); this.put(g, ox, oy, 2, 2, 0, 0, Math.min(w >> 1, 512), 9); }
  save(name) { writeFileSync(join(OUT, name), png(this.w, this.h, this.px)); console.log(`wrote ${join(OUT, name)} (${this.w} x ${this.h})`); }
}
/** One screen alone, at 2 x 4 (1:1) and 4 x 8 (-2x). */
function single(base, g) {
  for (const [suffix, sx, sy] of [['', 2, 4], ['-2x', 4, 8]]) { const c = new Canvas(512 * sx, 192 * sy); c.put(g, 0, 0, sx, sy); c.save(`${base}${suffix}.png`); }
}
const M = 16, CAP = 24;
/** Panels (each { g, caption, crop: [cx, cy, cw, ch] }) stacked or side by side, a caption above each. */
function panels(file, list, { sx, sy, stack }) {
  const dims = list.map((p) => [p.crop[2] * sx, p.crop[3] * sy]);
  const W = stack ? M * 2 + Math.max(...dims.map((d) => d[0])) : M + dims.reduce((a, d) => a + d[0] + M, 0);
  const H = stack ? dims.reduce((a, d) => a + CAP + d[1] + M, M) : M + CAP + Math.max(...dims.map((d) => d[1])) + M;
  const c = new Canvas(W, H);
  let ox = M, oy = M;
  list.forEach((p, i) => {
    c.label(p.caption, ox, oy, dims[i][0]);
    c.put(p.g, ox, oy + CAP, sx, sy, ...p.crop);
    if (stack) oy += CAP + dims[i][1] + M; else ox += dims[i][0] + M;
  });
  c.save(file);
}

// ---------------------------------------------------------------------------------------------------------------------------
single('pt1-window', paintScreen());
for (const [suffix, sx, sy] of [['', 2, 4], ['-2x', 4, 8]])
  panels(`pt1-shell${suffix}.png`, [
    { g: shellScene(3, 256), caption: 'Current: the shell window, 256 wide, three icons (as built)', crop: [0, 0, 512, 112] },
    { g: shellScene(4, 320), caption: 'Proposed: 320 wide, Paint the fourth icon (x = 48 + 64 (p - 1))', crop: [0, 0, 512, 112] },
  ], { sx, sy, stack: true });
panels('pt1-menus.png', [
  { g: menuScene(1, 1, [60, 30]), caption: 'File menu (New, Open..., Save..., Quit)', crop: [0, 0, 192, 96] },
  { g: menuScene(2, 0, [70, 20]), caption: 'Edit menu (Undo, Clear)', crop: [0, 0, 192, 96] },
], { sx: 3, sy: 6, stack: false });
