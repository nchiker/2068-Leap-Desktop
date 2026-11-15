"use strict";
// pt-model.mjs -- reference model of Paint slice P1 (program 4), written from docs/PAINT.md 2-9 and the "As built" section 15 only; src/apps/paint.asm was not used for any expectation.
//   * `PaintModel`: the tool, the status text, the 320 x 144 picture (a Gfx6Model region at (128, 32): lines and stamps drawn with the clip = the picture rectangle, exactly as the contract says
//     the machine draws), the undo box, the dirty flag and the name; `press / move / release` apply 15's pencil and eraser walks and the commit (the box widened to even byte columns, "fit" at
//     <= 2,048 bytes), `undo`, `clear`, `newDoc`, `pbm()` / `loadPbm()` (PAINT 9) and `copyBytes()` (the planar copy of PAINT 3);
//   * `renderScreen`: the whole screen: the desk, the bar "File Edit", the Paint window (look-model), the tool box (the icons parsed from src/apps/ticons.txt), the canvas frames, the picture,
//     the status label, then an optional dialog drawn by tests/wr-model.mjs / wr-w3model.mjs's functions (the app library's dialogs are Notepad's: APPLIB 4).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR, deskLook, barLook, macWindowLook, closeBoxLook } from './look-model.mjs';
import { labelLook, toDisp } from './wm-model2.mjs';
import { layoutOf, menuSpec } from './wm-model3.mjs';

export { Gfx6Model, OP_SET, OP_CLR, OP_XOR, toDisp, layoutOf };
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));

// P2a (PAINT 16): the pattern palette (id 2) and the brush palette (id 3), the Brush (2) and Spray (4) tools: `PATS` (checked against the cartridge's PATTAB by tests/pt-p1.mjs), `BRUSH_RECTS`, `SPT`, the LFSR
// `rndStep`, the model's brush strokes (REPLACE patterns through Gfx6Model.patFill), spray bursts, the stroke box margins, and the two palettes' pixels.
// ---------------------------------------------------------------------------------------------------------------------------
// Geometry (PAINT 2, 15, 16)
export const WIN = { x: 48, y: 16, w: 416, h: 176, id: 255 };
export const TOOLBOX = { x: 55, y: 28, w: 66, h: 82, id: 1 };
export const PATBOX = { x: 55, y: 112, w: 66, h: 50, id: 2 };
export const BRUSHBOX = { x: 55, y: 164, w: 66, h: 18, id: 3 };
export const CANVAS = { x: 126, y: 30, w: 324, h: 148, id: 4 };
export const STATUS = { x: 127, y: 180, w: 324, h: 9, id: 5 };
export const PIC = { x: 128, y: 32, w: 320, h: 144 };
export const TOOLNAMES = ['Marquee', 'Pencil', 'Brush', 'Eraser', 'Spray', 'Bucket', 'Line', 'Rectangle', 'Rounded rectangle', 'Oval'];
export const ICONNAMES = ['MARQUEE', 'PENCIL', 'BRUSH', 'ERASER', 'SPRAY', 'BUCKET', 'LINE', 'RECT', 'RRECT', 'OVAL'];
/** The interior of tool cell t (32 x 16): (56 + 32 (t AND 1), 29 + 16 (t >> 1)). */
export const cellOf = (t) => ({ x: 56 + 32 * (t & 1), y: 29 + 16 * (t >> 1), w: 32, h: 16 });
/** The tool whose cell (frame included: the cell and its right column / bottom row) a press at (x, y) hits, or -1. */
export function toolAt(x, y) {
  for (let t = 0; t < 10; t++) { const c = cellOf(t); if (x >= c.x && x < c.x + 32 && y >= c.y && y < c.y + 16) return t; }
  return -1;
}
/** The 16 patterns of PAINT 16 (tools/paint-mock.mjs PATS): 8 bytes each, bit 7 the leftmost pixel; solid first, white last. */
export const PATS = [[255, 255, 255, 255, 255, 255, 255, 255], [0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB], [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55], [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
  [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00], [0xFF, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00], [0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA], [0xC0, 0x60, 0x30, 0x18, 0x0C, 0x06, 0x03, 0x81],
  [0x88, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00], [0xFF, 0x80, 0x80, 0x80, 0xFF, 0x08, 0x08, 0x08], [0xFF, 0x88, 0x88, 0x88, 0xFF, 0x88, 0x88, 0x88], [0x00, 0x38, 0x7C, 0x7C, 0x7C, 0x38, 0x00, 0x00],
  [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81], [0xCC, 0xCC, 0x33, 0x33, 0xCC, 0xCC, 0x33, 0x33], [0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0xC0, 0x81], [0, 0, 0, 0, 0, 0, 0, 0]];
/** Swatch p (0-15, row-major, 4 columns): (56 + 16 (p AND 3), 113 + 12 (p >> 2)), 16 x 12.  Brush cell b (0-3): (56 + 16 b, 165), 16 x 16. */
export const swatchOf = (p) => ({ x: 56 + 16 * (p & 3), y: 113 + 12 * (p >> 2), w: 16, h: 12 });
export const brushCell = (b) => ({ x: 56 + 16 * b, y: 165, w: 16, h: 16 });
/** The brushes' rectangles (dx, dy, w, h) about the stamp's centre (PAINT 16). */
export const BRUSH_RECTS = [[[-2, -1, 5, 3], [-1, -2, 3, 5]], [[-4, -2, 9, 5], [-3, -3, 7, 7], [-2, -4, 5, 9]], [[-3, -3, 6, 6]], [[-4, 2, 3, 2], [-2, 0, 3, 2], [0, -2, 3, 2], [2, -4, 3, 2]]];
export const BRUSHNAMES = ['round small', 'round large', 'square', 'diagonal'];
/** The spray's half-width by |dy| (0..8). */
export const SPT = [16, 15, 15, 14, 13, 12, 10, 7, 0];
export const RND0 = 0xACE1;
/** `pn_rnd`: a 16-bit Galois LFSR, mask $B400, 8 shifts a byte, the byte being the low byte of the state after them; returns [state, byte]. */
export function rndStep(st) { for (let i = 0; i < 8; i++) { const lsb = st & 1; st >>= 1; if (lsb) st ^= 0xB400; } return [st, st & 0xFF]; }
/** The stroke box's margin (byte columns, rows) by tool (PN_PADC, PN_PADR). */
export const PADS = { 1: [0, 0], 2: [1, 4], 3: [1, 4], 4: [2, 8], 6: [0, 0], 7: [0, 0], 8: [0, 0], 9: [0, 0] };
export const SHAPES = [6, 7, 8, 9];             // the Line, the Rectangle, the Rounded rectangle and the Oval (PAINT 17, 18): an XOR band while the button is held (a line, or the bounding rectangle)
export const DRAWING = [1, 2, 3, 4, 6, 7, 8, 9];   // the tools that take a capture and draw a stroke: all but the Marquee (0: PAINT 22.2, its own press / move / release below) and the Bucket (5, a click: PAINT 21)
export const MESSAGES = ['Too big to undo', 'Fill too complex', 'Selection too big'];   // the status messages: each gives way to the tool's name at the next fitting commit / tool choice / fitting selection
/** G_RRECT's radii by tool (PAINT 18): the Rounded rectangle 8 x 4, the Oval 255 x 100 (cut to w / 2, h / 2). */
export const RADII = { 8: [8, 4], 9: [255, 100] };
export const inPic = (x, y) => x >= PIC.x && x < PIC.x + PIC.w && y >= PIC.y && y < PIC.y + PIC.h;
export const UNDO_MAX = 2048;
export const PBM_HEADER = codesOf('P4\n320 144\n');
export const PBM_LEN = 11 + 144 * 40;

/** The ten 32 x 16 tool icons of src/apps/ticons.txt ('#' ink): an array of ten arrays of 16 strings of 32 characters (checked on parsing). */
export const ICONS = (() => {
  const out = {}; let cur = null;
  for (const line of readFileSync(join(ROOT, 'src/apps/ticons.txt'), 'utf8').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t === '') continue;
    if (t.startsWith('icon ')) { cur = out[t.slice(5).trim()] = []; continue; }
    if (cur) cur.push(t);
  }
  return ICONNAMES.map((n) => {
    const a = out[n];
    if (!a || a.length !== 16 || a.some((r) => !/^[#.]{32}$/.test(r))) throw new Error(`ticons.txt: icon ${n} is not 16 rows of 32 of # and .`);
    return a;
  });
})();

// ---------------------------------------------------------------------------------------------------------------------------
// The menus (PAINT 8): File (id 1) New, Open..., Save..., separator, Quit; Edit (id 2) Undo, Clear.  The bar of a running program has no "Leap" menu.
export const FILE_MENU = menuSpec(1, 'File', [[1, 0, 'New'], [2, 0, 'Open...'], [3, 0, 'Save...'], [0, 2, ''], [4, 0, 'Quit']]);
export const EDIT_MENU = menuSpec(2, 'Edit', [[1, 1, 'Undo'], [2, 0, 'Clear']]);
export const OPTIONS_MENU = menuSpec(3, 'Options', [[1, 0, 'Filled shapes'], [2, 0, 'Hollow shapes']]);   // PAINT 17: the chosen mode's item is disabled
export const MENUS = [FILE_MENU, EDIT_MENU, OPTIONS_MENU];
export const MENU_ITEM = { NEW: 0, OPEN: 1, SAVE: 2, QUIT: 4, UNDO: 0, CLEAR: 1, FILLED: 0, HOLLOW: 1 };
/** The kernel's enable words (bit n - 1 - k for item k of n; a separator is never enabled): File 5 items, Edit 2 items, Options 2 items (PAINT 17: the chosen mode's item is disabled; hollow at the start). */
export const menuWords = (undoOn, fill = false) => [0b11101, undoOn ? 0b11 : 0b01, fill ? 0b01 : 0b10];
/** The enable matrix the dropdown drawing wants: en[menu][item]. */
export const menuEn = (undoOn, fill = false) => [[true, true, true, false, true], [undoOn, true], [!fill, fill]];

// ---------------------------------------------------------------------------------------------------------------------------
// The picture
export class PaintModel {
  constructor() { this.reset(); }
  reset() {
    this.tool = 1; this.status = 'Pencil'; this.fill = false; this.pat = 0; this.brush = 1; this.rnd = RND0; this.pic = new Gfx6Model(); this.pic.setClip(PIC.x, PIC.y, PIC.w, PIC.h);
    this.undoOn = false; this.undoBox = null; this.dirty = false; this.name = ''; this.stroke = null;
    this.hox = 0; this.hoy = 0;               // the picture origin's offset when the copy was last saved (its header)
    this.ox = 0; this.oy = 0;                 // the window's offset from (48, 16) after a drag (the views move with it)
    this.sel = null;                          // the Marquee's selection (PAINT 22.2): { c, n, y, h } = first byte column, byte columns, first row, rows (picture coordinates)
    this.cs = false;                          // CAPS SHIFT held at the release of a move (K_MODS bit 0): a copy
  }
  clone() {
    const c = new PaintModel(); c.tool = this.tool; c.fill = this.fill; c.pat = this.pat; c.brush = this.brush; c.rnd = this.rnd; c.status = this.status; c.pic.px.set(this.pic.px); c.undoOn = this.undoOn;
    c.undoBox = this.undoBox && { ...this.undoBox, px: this.undoBox.px.slice() }; c.dirty = this.dirty; c.name = this.name; c.ox = this.ox; c.oy = this.oy; c.hox = this.hox; c.hoy = this.hoy; c.sel = this.sel && { ...this.sel }; c.cs = this.cs; return c;
  }
  get title() { return 'Paint: ' + (this.name === '' ? 'Untitled' : this.name); }
  /** The picture's pixel (x, y) in picture coordinates (0..319, 0..143). */
  px(x, y) { return this.pic.get(PIC.x + x, PIC.y + y); }
  /** Choosing another tool drops the Marquee's selection (the outline erased, the picture unchanged); the same tool again keeps it (PAINT 22.2). */
  chooseTool(t) { if (t !== this.tool) this.sel = null; this.tool = t; this.status = TOOLNAMES[t]; }
  /** Every menu command drops the selection first (PAINT 22.2). */
  dropSel() { this.sel = null; }
  choosePat(p) { this.pat = p; }
  /** Options > Filled shapes (item 0) / Hollow shapes (item 1): PN_FILL (PAINT 17). */
  setFill(on) { this.fill = !!on; }
  chooseBrush(b) { this.brush = b; }

  // ---- strokes (PAINT 15) -------------------------------------------------------------------------------------------
  /** A press at screen (x, y): returns true when it starts a stroke (inside the picture; every tool but the Bucket, which fills at once). */
  press(x, y) {
    x -= this.ox; y -= this.oy;               // screen to the window's home position: the picture's pixels are kept at (128, 32)
    if (!inPic(x, y)) return false;
    if (this.tool === 5) { this.bucket(x, y); return false; }       // PAINT 21: a click fills; no capture, so no stroke (the caller's moves and release are ignored)
    if (this.tool === 0) return this.mqPress(x, y);
    this.stroke = { last: [x, y], pts: [[x, y]], anchor: [x, y], before: this.clone() };
    if (!SHAPES.includes(this.tool)) this.segment(x, y, x, y);     // a shape's press draws nothing (PAINT 17)
    return true;
  }
  /**
   * The Bucket (PAINT 21) at the picture-coordinate screen point (x, y) (the window's home position): G_FLOOD on the picture (clip = the picture) with the chosen pattern.  A complete fill is committed like a
   * stroke whose box is the region's (the box widened to even byte columns, pad 0); an overflow ("Fill too complex") leaves the picture and every undo state as they were and only changes the status.
   * Returns the model's flood result ({ spans, overflow, box, n, fast, ... }) and keeps it in `lastBucket`.
   */
  bucket(x, y) {
    const before = this.clone();
    const r = this.pic.floodFill(x, y, PATS[this.pat]);
    this.lastBucket = r;
    if (this.forceOverflow) { r.overflow = true; r.forced = true; this.pic.px.set(before.pic.px); }   // a seed-stack overflow (PAINT 21: more than 256 seeds): the model cannot predict it; the test says so
    if (r.overflow) { this.status = 'Fill too complex'; return r; }
    const box = strokeBox([[r.box.x0, r.box.y0], [r.box.x1, r.box.y1]], 0, 0);
    this.commit(box, before);
    return r;
  }
  /** A copy of the picture's model for a probe: `probe(x, y, p)` = G_FLOOD's model result for a seed (picture-home screen coordinates) and pattern p, the picture untouched (a complete fill happens on the copy). */
  probe(x, y, p) { const g = new Gfx6Model(); g.px.set(this.pic.px); g.setClip(PIC.x, PIC.y, PIC.w, PIC.h); return g.floodFill(x, y, PATS[p]); }
  /** An E_MOVE to (x, y) while the stroke is held. */
  move(x, y) {
    x -= this.ox; y -= this.oy;
    const s = this.stroke; if (!s) return;
    if (s.mq) { s.lx = x; s.ly = y; s.on = true; return; }          // the Marquee: the band (a selection's rectangle, or the moving box) follows the pointer
    if (SHAPES.includes(this.tool)) { s.last = [x, y]; return; }     // the band follows the pointer (bandModel)
    this.segment(s.last[0], s.last[1], x, y); s.last = [x, y]; s.pts.push([x, y]);
  }
  /** A shape stroke in progress: the rectangle's corners (the Rectangle) or the line's ends, anchor and the pointer. */
  shapeRect(ax, ay, bx, by) { return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax) + 1, h: Math.abs(by - ay) + 1 }; }
  /** The shape of the tool from the anchor to (x, y) drawn on `g` in the op `op` (the band: XOR; the final: SET, the filled inside first). */
  drawShape(g, op, ax, ay, x, y, fillFirst = false) {
    if (this.tool === 6) { g.setOp(op); g.line(ax, ay, x, y); return; }
    const r = this.shapeRect(ax, ay, x, y);
    if (this.tool >= 8 && op !== OP_XOR) {          // PAINT 18: the release draws G_RRECT in SET, the mode = PN_FILL (the band is the bounding rectangle, below)
      g.setOp(op); g.rrect(r.x, r.y, r.w, r.h, RADII[this.tool][0], RADII[this.tool][1], fillFirst ? 1 : 0, PATS[this.pat], op); return;
    }
    if (fillFirst) g.patFill(r.x + 1, r.y + 1, r.w - 2, r.h - 2, PATS[this.pat], 3);
    g.setOp(op); g.frame(r.x, r.y, r.w, r.h);
  }
  /** A copy of the model whose picture has the XOR band of the stroke in progress drawn on it (what the display shows mid-stroke); the copy (the machine's) is still the model itself. */
  bandModel() {
    const c = this.clone(), s = this.stroke;
    if (s && SHAPES.includes(this.tool)) this.drawShape(c.pic, OP_XOR, s.anchor[0], s.anchor[1], s.last[0], s.last[1]);
    return c;
  }
  /**
   * (kept for the drivers: the spray's bursts are no longer predicted frame by frame.)  PAINT 16 says the spray bursts at the last point on every frame WITHOUT an event; the machine's loop
   * (`halt / call pn_idle`) runs pn_idle on EVERY frame of a running stroke, before that frame's events, so it also bursts in a moving frame and in the release frame (group 10 checks it).
   */
  held(kind) { }
  /** The bursts the machine started, [{ x, y }] screen centres in order (read at the entry of pn_spray): drawn here, the LFSR running on. */
  applyBursts(list) { for (const b of list) this.burst(b.x - this.ox, b.y - this.oy); }
  /** The release: the commit (PAINT 15: the box, the fit rule, the undo area), then the picture is "saved" (the model is the picture).  Returns the box. */
  release() {
    const s = this.stroke; if (!s) return null;
    this.stroke = null;
    if (s.mq) return this.mqRelease(s);
    let pts = s.pts;
    if (SHAPES.includes(this.tool)) { this.drawShape(this.pic, OP_SET, s.anchor[0], s.anchor[1], s.last[0], s.last[1], this.fill); pts = [s.anchor, s.last]; }   // the band was erased (the model draws only the final shape)
    const box = strokeBox(pts, ...PADS[this.tool]);
    this.commit(box, s.before);
    return box;
  }
  saveHdr() { this.hox = this.ox; this.hoy = this.oy; }
  commit(box, before) {
    this.dirty = true; this.saveHdr();
    if (box.nc * box.nr <= UNDO_MAX) {
      // the undo area holds the box's pixels from BEFORE the stroke (the copy still held that state)
      this.undoBox = { ...box, px: boxPixels(before, box) }; this.undoOn = true;
      if (MESSAGES.includes(this.status)) this.status = TOOLNAMES[this.tool];   // PAINT 15: a message gives way to the tool's name at the next fitting commit
    } else { this.undoBox = null; this.undoOn = false; this.status = 'Too big to undo'; }
  }
  segment(lx, ly, nx, ny) {
    if (this.tool === 1) { this.pic.setOp(OP_SET); this.pic.line(lx, ly, nx, ny); return; }
    if (this.tool === 2) { this.walk(lx, ly, nx, ny, 2, (x, y) => this.brushStamp(x, y)); return; }
    if (this.tool === 4) return;                                   // the spray's bursts are drawn by applyBursts (the machine decides how many and where)
    this.eraseWalk(lx, ly, nx, ny);
  }
  /** The next byte of the LFSR (PN_RND). */
  rndByte() { const [s, b] = rndStep(this.rnd); this.rnd = s; return b; }
  /** A brush stamp: each rectangle of the chosen brush at (x + dx, y + dy), REPLACE with the chosen pattern (PAINT 16). */
  brushStamp(x, y) { for (const [dx, dy, w, h] of BRUSH_RECTS[this.brush]) this.pic.patFill(x + dx, y + dy, w, h, PATS[this.pat], 3); }
  /** A spray burst at (x, y): 12 candidates, two random numbers each, drawn as a 1 x 1 SET of the pattern when |dx| <= SPT[|dy|]. */
  burst(x, y) {
    for (let i = 0; i < 12; i++) {
      const r1 = this.rndByte(), r2 = this.rndByte(), dx = (r1 & 0x1F) - 16, dy = (r2 & 0x0F) - 8;
      if (Math.abs(dx) <= SPT[Math.abs(dy)]) this.pic.patFill(x + dx, y + dy, 1, 1, PATS[this.pat], 0);
    }
  }
  stamp(x, y) { this.pic.setOp(OP_CLR); this.pic.fill(x - 8, y - 4, 16, 8); }
  /** PAINT 15's eraser: stamps at every 4th step of the Bresenham walk and one at the end (one stamp when n = 0). */
  eraseWalk(lx, ly, nx, ny) { this.walk(lx, ly, nx, ny, 4, (x, y) => this.stamp(x, y)); }
  /** The walk of PAINT 15: a stamp after every `every`-th step and one at the end (one stamp when n = 0). */
  walk(lx, ly, nx, ny, every, stamp) {
    const dx = Math.abs(nx - lx), dy = Math.abs(ny - ly), sx = nx < lx ? -1 : 1, sy = ny < ly ? -1 : 1;
    const xmaj = dx > dy, dmaj = xmaj ? dx : dy, dmin = xmaj ? dy : dx, n = Math.max(dx, dy);
    let x = lx, y = ly, e = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (xmaj) x += sx; else y += sy;
      e += dmin;
      if (e >= dmaj) { e -= dmaj; if (xmaj) y += sy; else x += sx; }
      c++;
      if (c % every === 0) stamp(x, y);
    }
    stamp(nx, ny);
  }


  // ---- the Marquee (PAINT 22.2, tool 0) -----------------------------------------------------------------------------
  // The selection is a box of whole byte columns and exact rows, at most 2,048 bytes; its outline is an XOR frame that is in neither the picture nor its copy (`displayModel` adds it).  A press inside it starts a
  // move (the outline is erased, an XOR frame of the box displaced by the pointer follows: 8-pixel steps across, 1 row down, the box kept inside the picture); outside it, a new selection (the old one is dropped).
  /** A Marquee press at the picture-home screen point (x, y), inside the picture: always begins a stroke. */
  mqPress(x, y) {
    const c = (x - PIC.x) >> 3, r = y - PIC.y, s = this.sel;
    const inside = !!s && c >= s.c && c < s.c + s.n && r >= s.y && r < s.y + s.h;
    if (!inside) this.sel = null;
    this.stroke = { mq: true, mode: inside ? 'move' : 'select', ax: x, ay: y, lx: x, ly: y, on: false, before: this.clone() };
    return true;
  }
  /** A pointer position -> the byte column (0..39) / the picture row (0..143) it is over, clamped (the pointer may be anywhere on the screen). */
  static colOf(x) { return Math.max(0, Math.min(39, Math.floor((x - PIC.x) / 8))); }
  static rowOf(y) { return Math.max(0, Math.min(143, y - PIC.y)); }
  /** A move's destination for the stroke s: the selection displaced by floor((LX - AX) / 8) byte columns and LY - AY rows, kept inside the picture: { c, y }. */
  moveDest(s) {
    const q = this.sel, cl = (v, hi) => Math.max(0, Math.min(hi, v));
    return { c: cl(q.c + Math.floor((s.lx - s.ax) / 8), 40 - q.n), y: cl(q.y + (s.ly - s.ay), 144 - q.h) };
  }
  /** The selection the drag s from its anchor to its last point makes: { c, n, y, h }, or null (a click); `big` when it would be more than 2,048 bytes. */
  dragBox(s) {
    if (s.ax === s.lx && s.ay === s.ly) return { box: null };
    const c0 = PaintModel.colOf(s.ax), c1 = PaintModel.colOf(s.lx), r0 = PaintModel.rowOf(s.ay), r1 = PaintModel.rowOf(s.ly);
    const box = { c: Math.min(c0, c1), n: Math.abs(c1 - c0) + 1, y: Math.min(r0, r1), h: Math.abs(r1 - r0) + 1 };
    return { box, big: box.n * box.h > UNDO_MAX };
  }
  /** The release of a Marquee stroke: a selection made (or "Selection too big"), or the box moved / copied (committed), or nothing (a click; a move onto itself). Returns the commit's box or null. */
  mqRelease(s) {
    if (s.mode === 'select') {
      const d = this.dragBox(s);
      if (!d.box) return null;
      if (d.big) { this.status = 'Selection too big'; return null; }
      if (MESSAGES.includes(this.status)) this.status = TOOLNAMES[this.tool];
      this.sel = d.box; return null;
    }
    const q = this.sel, d = this.moveDest(s);
    if (d.c === q.c && d.y === q.y) return null;                      // no change: the outline is drawn again, nothing committed
    const src = { c0: q.c, nc: q.n, r0: q.y, nr: q.h }, dst = { c0: d.c, nc: q.n, r0: d.y, nr: q.h };
    const lifted = boxPixels(this, src);
    let cols = [d.c, d.c + q.n - 1], rows = [d.y, d.y + q.h - 1];
    if (!this.cs) {                                                    // a move: the source to paper, and the undo box is the union of source and destination (a copy: the destination only)
      for (let r = 0; r < q.h; r++) for (let j = 0; j < 8 * q.n; j++) this.pic.set(PIC.x + 8 * q.c + j, PIC.y + q.y + r, 0);
      cols = [Math.min(cols[0], q.c), Math.max(cols[1], q.c + q.n - 1)]; rows = [Math.min(rows[0], q.y), Math.max(rows[1], q.y + q.h - 1)];
    }
    putBoxPixels(this, dst, lifted);
    this.sel = { c: d.c, n: q.n, y: d.y, h: q.h };
    const box = widenBox(cols[0], cols[1], rows[0], rows[1]);
    this.commit(box, s.before);
    return box;
  }
  /** DELETE (E_KEY 12) with a selection: its box cleared to paper, committed (undo box = the box widened), the selection kept.  Returns false without a selection. */
  mqDelete() {
    const q = this.sel; if (!q) return false;
    const before = this.clone();
    for (let r = 0; r < q.h; r++) for (let j = 0; j < 8 * q.n; j++) this.pic.set(PIC.x + 8 * q.c + j, PIC.y + q.y + r, 0);
    this.commit(widenBox(q.c, q.c + q.n - 1, q.y, q.y + q.h - 1), before);
    return true;
  }
  /** ESC (E_KEY 27) with a selection: dropped, the picture unchanged. */
  mqEsc() { this.sel = null; }
  /**
   * A copy of the model with what the DISPLAY shows over the picture (the copy PN_PIC never has it): the selection's outline (an XOR frame of its box), or, while a Marquee stroke is held and the pointer has moved,
   * the band (a selecting drag: the rectangle from the anchor to the pointer; a move: the frame of the displaced box) with the selection's own outline erased.  Clipped to the picture.
   */
  displayModel() {
    const c = this.clone(), s = this.stroke, g = c.pic;
    const frame = (x, y, w, h) => { g.setOp(OP_XOR); g.frame(x, y, w, h); };
    if (s && s.mq) {
      if (s.on) {
        if (s.mode === 'select') { const r = this.shapeRect(s.ax, s.ay, s.lx, s.ly); frame(r.x, r.y, r.w, r.h); }
        else { const d = this.moveDest(s); frame(PIC.x + 8 * d.c, PIC.y + d.y, 8 * this.sel.n, this.sel.h); }
      }
    } else if (this.sel) frame(PIC.x + 8 * this.sel.c, PIC.y + this.sel.y, 8 * this.sel.n, this.sel.h);
    return c;
  }

  // ---- Undo, Clear, New ---------------------------------------------------------------------------------------------
  /** Undo: swap the box's pixels between the picture and the undo area; stays enabled. */
  undo() {
    this.sel = null;
    const b = this.undoBox; if (!this.undoOn || !b) return false;
    const cur = boxPixels(this, b);
    putBoxPixels(this, b, b.px);
    b.px = cur;
    return true;
  }
  clear() { this.sel = null; this.pic.setOp(OP_CLR); this.pic.fill(PIC.x, PIC.y, PIC.w, PIC.h); this.undoOn = false; this.undoBox = null; this.dirty = true; this.saveHdr(); }
  newDoc() { this.clear(); this.dirty = false; this.name = ''; }

  // ---- files (PAINT 9) ----------------------------------------------------------------------------------------------
  /** The PBM bytes: 'P4\n320 144\n', then 144 rows of 40 bytes, 1 = ink, the leftmost pixel in bit 7. */
  pbm() {
    const out = Array.from(PBM_HEADER);
    for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | this.px(8 * k + j, r); out.push(v); }
    return out;
  }
  /** Replace the picture by a PBM file's bytes when they are exactly the 5,771 bytes with the exact header; returns true on success (the contract's Open: dirty 0, Undo off). */
  loadPbm(bytes) {
    this.sel = null;
    if (bytes.length !== PBM_LEN) return false;
    for (let i = 0; i < 11; i++) if (bytes[i] !== PBM_HEADER[i]) return false;
    for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { const v = bytes[11 + 40 * r + k]; for (let j = 0; j < 8; j++) this.pic.set(PIC.x + 8 * k + j, PIC.y + r, (v >> (7 - j)) & 1); }
    this.undoOn = false; this.undoBox = null; this.dirty = false; this.saveHdr(); return true;
  }
  /** The copy as PAINT 3 lays it out: the header (16, 40, 32, 144), the file-1 part (even byte columns, 20 bytes a row), then the file-2 part (odd columns): 4 + 5,760 bytes. */
  copyBytes(swap = true) {
    const out = new Uint8Array(4 + 5760); out.set([(PIC.x + this.hox) >> 3, 40, PIC.y + this.hoy, 144]);   // the header G_SAVERECT wrote last: (OX >> 3, 40, OY, 144)
    for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) {
      let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | this.px(8 * k + j, r);
      out[4 + ((k & 1) ^ (swap ? 1 : 0)) * 2880 + 20 * r + (k >> 1)] = v;
    }
    return out;
  }
  /** The undo area as the contract lays it out ("part 1's rows, then part 2's, packed", nc / 2 bytes a row of each part) for the stored box; null without one. */
  undoBytes(swap = true) {
    const b = this.undoBox; if (!b) return null;
    const H = b.nc >> 1, out = [];
    for (const part of swap ? [1, 0] : [0, 1]) for (let r = 0; r < b.nr; r++) for (let h = 0; h < H; h++) {
      const k = b.c0 + 2 * h + part; let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | b.px[r * b.nc * 8 + (k - b.c0) * 8 + j];
      out.push(v);
    }
    return out;
  }
}
/** The stroke's box (PAINT 15, 16): columns (x - 128) >> 3 of each point +- padc (pencil 0, brush and eraser 1, spray 2) clamped to 0..39, rows y - 32 +- padr (0, 4, 8) clamped to 0..143; widened to an even first column and an even column count. */
export function strokeBox(pts, padc = 1, padr = 4) {
  const cols = pts.map(([x]) => Math.floor((x - PIC.x) / 8)), rows = pts.map(([, y]) => y - PIC.y);
  const clampc = (v) => Math.max(0, Math.min(39, v)), clampr = (v) => Math.max(0, Math.min(143, v));
  let c0 = clampc(Math.min(...cols) - padc), c1 = clampc(Math.max(...cols) + padc);
  const r0 = clampr(Math.min(...rows) - padr), r1 = clampr(Math.max(...rows) + padr);
  c0 -= c0 & 1; if ((c1 - c0 + 1) & 1) c1++;
  return { c0, nc: c1 - c0 + 1, r0, nr: r1 - r0 + 1 };
}
/** The undo box (PAINT 15) of a change over the byte columns c0 .. c1 and the rows r0 .. r1: widened to an even first column and an even column count. */
export function widenBox(c0, c1, r0, r1) {
  c0 -= c0 & 1; if ((c1 - c0 + 1) & 1) c1++;
  return { c0, nc: c1 - c0 + 1, r0, nr: r1 - r0 + 1 };
}
/** The pixels of a box of the picture (rows nr, 8 nc pixels a row). */
export function boxPixels(model, b) {
  const out = new Uint8Array(b.nc * 8 * b.nr);
  for (let r = 0; r < b.nr; r++) for (let j = 0; j < b.nc * 8; j++) out[r * b.nc * 8 + j] = model.px(b.c0 * 8 + j, b.r0 + r);
  return out;
}
export function putBoxPixels(model, b, px) {
  for (let r = 0; r < b.nr; r++) for (let j = 0; j < b.nc * 8; j++) model.pic.set(PIC.x + b.c0 * 8 + j, PIC.y + b.r0 + r, px[r * b.nc * 8 + j]);
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pixels
/** The tool box: for each cell the opaque 32 x 16 icon at (x, y) (G_ICON, the whole cell), the frame (x - 1, y - 1, 33, 17) in SET, the chosen cell's interior (x, y, 31, 15) inverted. */
const put = (g, x, y, v) => { if (x >= 0 && x < 512 && y >= 0 && y < 192) g.set(x, y, v); };
export function toolBoxLook(g, tool, ox = 0, oy = 0) {
  for (let t = 0; t < 10; t++) {
    const c = cellOf(t), art = ICONS[t];
    for (let r = 0; r < 16; r++) for (let q = 0; q < 32; q++) put(g, c.x + ox + q, c.y + oy + r, art[r][q] === '#' ? 1 : 0);
    g.setOp(OP_SET); g.frame(c.x + ox - 1, c.y + oy - 1, 33, 17);
    if (t === tool) { g.setOp(OP_XOR); g.fill(c.x + ox, c.y + oy, 31, 15); }
  }
}
/** The pattern palette (PAINT 16): swatch p is a REPLACE fill of pattern p (anchored to the screen), then the frame (x - 1, y - 1, 17, 13) in SET; the chosen pattern also gets the frame (x, y, 16, 12). */
export function patternBoxLook(g, sel, ox = 0, oy = 0) {
  for (let p = 0; p < 16; p++) {
    const c = swatchOf(p), x = c.x + ox, y = c.y + oy;
    g.patFill(x, y, 16, 12, PATS[p], 3);
    g.setOp(OP_SET); g.frame(x - 1, y - 1, 17, 13);
    if (p === sel) g.frame(x, y, 16, 12);
  }
}
/** The brush palette (PAINT 16): cell b has the brush's rectangles in SET about (x + 8, y + 8), the frame (x - 1, y - 1, 17, 17) in SET, the chosen brush inverted (XOR fill (x, y, 16, 16)). */
export function brushBoxLook(g, sel, ox = 0, oy = 0) {
  for (let b = 0; b < 4; b++) {
    const c = brushCell(b), x = c.x + ox, y = c.y + oy;
    g.setOp(OP_SET);
    for (const [dx, dy, w, h] of BRUSH_RECTS[b]) g.fill(x + 8 + dx, y + 8 + dy, w, h);
    g.frame(x - 1, y - 1, 17, 17);
    if (b === sel) { g.setOp(OP_XOR); g.fill(x, y, 16, 16); }
  }
}
/** The canvas: its two frames (the view's rectangle and the one inside it) in SET, then the picture. */
export function canvasLook(g, model, ox = 0, oy = 0) {
  g.setOp(OP_SET); g.frame(CANVAS.x + ox, CANVAS.y + oy, CANVAS.w, CANVAS.h); g.frame(CANVAS.x + ox + 1, CANVAS.y + oy + 1, CANVAS.w - 2, CANVAS.h - 2);
  for (let y = 0; y < PIC.h; y++) for (let x = 0; x < PIC.w; x++) put(g, PIC.x + ox + x, PIC.y + oy + y, model.px(x, y));
}
/**
 * The whole screen for a PaintModel `st`: desk, bar, window (active unless `active === false`: a dialog is open), tool box, canvas, status; then `dialog(g)` when given
 * (a function drawing a dialog onto g).
 */
export function renderScreen(st, { active = true, dialog = null, title = st.title, status = st.status } = {}) {
  const g = new Gfx6Model();
  deskLook(g); barLook(g, MENUS, layoutOf(MENUS));
  const ox = st.ox, oy = st.oy;
  macWindowLook(g, { x: WIN.x + ox, y: WIN.y + oy, w: WIN.w, h: WIN.h, title: { codes: codesOf(title) } }, active);
  if (active) closeBoxLook(g, WIN.x + ox, WIN.y + oy, false);
  toolBoxLook(g, st.tool, ox, oy);
  patternBoxLook(g, st.pat, ox, oy);
  brushBoxLook(g, st.brush, ox, oy);
  canvasLook(g, st, ox, oy);
  labelLook(g, { x: STATUS.x + ox, y: STATUS.y + oy, w: STATUS.w, h: STATUS.h, flags: 0, text: { codes: codesOf(status) } });
  if (dialog) dialog(g);
  return g;
}
