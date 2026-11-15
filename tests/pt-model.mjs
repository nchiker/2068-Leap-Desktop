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

// ---------------------------------------------------------------------------------------------------------------------------
// Geometry (PAINT 2, 15)
export const WIN = { x: 48, y: 16, w: 416, h: 176, id: 255 };
export const TOOLBOX = { x: 55, y: 28, w: 66, h: 82, id: 1 };
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
export const inPic = (x, y) => x >= PIC.x && x < PIC.x + PIC.w && y >= PIC.y && y < PIC.y + PIC.h;
export const UNDO_MAX = 2048;
export const PBM_HEADER = codesOf('P4\n320 144\n');
export const PBM_LEN = 11 + 144 * 40;

/** The ten 16 x 16 tool icons of src/apps/ticons.txt ('#' ink): an array of ten arrays of 16 strings. */
export const ICONS = (() => {
  const out = {}; let cur = null;
  for (const line of readFileSync(join(ROOT, 'src/apps/ticons.txt'), 'utf8').split('\n')) {
    const t = line.trim();
    if (t.startsWith('#') || t === '') continue;
    if (t.startsWith('icon ')) { cur = out[t.slice(5).trim()] = []; continue; }
    if (cur) cur.push(t);
  }
  return ICONNAMES.map((n) => out[n]);
})();

// ---------------------------------------------------------------------------------------------------------------------------
// The menus (PAINT 8): File (id 1) New, Open..., Save..., separator, Quit; Edit (id 2) Undo, Clear.  The bar of a running program has no "Leap" menu.
export const FILE_MENU = menuSpec(1, 'File', [[1, 0, 'New'], [2, 0, 'Open...'], [3, 0, 'Save...'], [0, 2, ''], [4, 0, 'Quit']]);
export const EDIT_MENU = menuSpec(2, 'Edit', [[1, 1, 'Undo'], [2, 0, 'Clear']]);
export const MENUS = [FILE_MENU, EDIT_MENU];
export const MENU_ITEM = { NEW: 0, OPEN: 1, SAVE: 2, QUIT: 4, UNDO: 0, CLEAR: 1 };
/** The kernel's enable words (bit n - 1 - k for item k of n; a separator is never enabled): File 5 items, Edit 2 items. */
export const menuWords = (undoOn) => [0b11101, undoOn ? 0b11 : 0b01];

// ---------------------------------------------------------------------------------------------------------------------------
// The picture
export class PaintModel {
  constructor() { this.reset(); }
  reset() {
    this.tool = 1; this.status = 'Pencil'; this.pic = new Gfx6Model(); this.pic.setClip(PIC.x, PIC.y, PIC.w, PIC.h);
    this.undoOn = false; this.undoBox = null; this.dirty = false; this.name = ''; this.stroke = null;
    this.hox = 0; this.hoy = 0;               // the picture origin's offset when the copy was last saved (its header)
    this.ox = 0; this.oy = 0;                 // the window's offset from (48, 16) after a drag (the views move with it)
  }
  clone() {
    const c = new PaintModel(); c.tool = this.tool; c.status = this.status; c.pic.px.set(this.pic.px); c.undoOn = this.undoOn;
    c.undoBox = this.undoBox && { ...this.undoBox, px: this.undoBox.px.slice() }; c.dirty = this.dirty; c.name = this.name; c.ox = this.ox; c.oy = this.oy; c.hox = this.hox; c.hoy = this.hoy; return c;
  }
  get title() { return 'Paint: ' + (this.name === '' ? 'Untitled' : this.name); }
  /** The picture's pixel (x, y) in picture coordinates (0..319, 0..143). */
  px(x, y) { return this.pic.get(PIC.x + x, PIC.y + y); }
  chooseTool(t) { this.tool = t; this.status = TOOLNAMES[t]; }

  // ---- strokes (PAINT 15) -------------------------------------------------------------------------------------------
  /** A press at screen (x, y): returns true when it starts a stroke (inside the picture, Pencil or Eraser); else the status "Not built yet" for another tool (a press in the picture only). */
  press(x, y) {
    x -= this.ox; y -= this.oy;               // screen to the window's home position: the picture's pixels are kept at (128, 32)
    if (!inPic(x, y)) return false;
    if (this.tool !== 1 && this.tool !== 3) { this.status = 'Not built yet'; return false; }
    this.stroke = { last: [x, y], pts: [[x, y]], before: this.clone() };
    this.segment(x, y, x, y);
    return true;
  }
  /** An E_MOVE to (x, y) while the stroke is held. */
  move(x, y) {
    x -= this.ox; y -= this.oy;
    const s = this.stroke; if (!s) return;
    this.segment(s.last[0], s.last[1], x, y); s.last = [x, y]; s.pts.push([x, y]);
  }
  /** The release: the commit (PAINT 15: the box, the fit rule, the undo area), then the picture is "saved" (the model is the picture).  Returns the box. */
  release() {
    const s = this.stroke; if (!s) return null;
    this.stroke = null;
    const box = strokeBox(s.pts);
    this.commit(box, s.before);
    return box;
  }
  saveHdr() { this.hox = this.ox; this.hoy = this.oy; }
  commit(box, before) {
    this.dirty = true; this.saveHdr();
    if (box.nc * box.nr <= UNDO_MAX) {
      // the undo area holds the box's pixels from BEFORE the stroke (the copy still held that state)
      this.undoBox = { ...box, px: boxPixels(before, box) }; this.undoOn = true;
      if (this.status === 'Too big to undo' || this.status === 'Not built yet') this.status = TOOLNAMES[this.tool];   // PAINT 15: a message gives way to the tool's name at the next fitting commit
    } else { this.undoBox = null; this.undoOn = false; this.status = 'Too big to undo'; }
  }
  segment(lx, ly, nx, ny) {
    if (this.tool === 1) { this.pic.setOp(OP_SET); this.pic.line(lx, ly, nx, ny); return; }
    this.eraseWalk(lx, ly, nx, ny);
  }
  stamp(x, y) { this.pic.setOp(OP_CLR); this.pic.fill(x - 8, y - 4, 16, 8); }
  /** PAINT 15's eraser: stamps at every 4th step of the Bresenham walk and one at the end (one stamp when n = 0). */
  eraseWalk(lx, ly, nx, ny) {
    const dx = Math.abs(nx - lx), dy = Math.abs(ny - ly), sx = nx < lx ? -1 : 1, sy = ny < ly ? -1 : 1;
    const xmaj = dx > dy, dmaj = xmaj ? dx : dy, dmin = xmaj ? dy : dx, n = Math.max(dx, dy);
    let x = lx, y = ly, e = 0, c = 0;
    for (let i = 0; i < n; i++) {
      if (xmaj) x += sx; else y += sy;
      e += dmin;
      if (e >= dmaj) { e -= dmaj; if (xmaj) y += sy; else x += sx; }
      c++;
      if (c % 4 === 0) this.stamp(x, y);
    }
    this.stamp(nx, ny);
  }

  // ---- Undo, Clear, New ---------------------------------------------------------------------------------------------
  /** Undo: swap the box's pixels between the picture and the undo area; stays enabled. */
  undo() {
    const b = this.undoBox; if (!this.undoOn || !b) return false;
    const cur = boxPixels(this, b);
    putBoxPixels(this, b, b.px);
    b.px = cur;
    return true;
  }
  clear() { this.pic.setOp(OP_CLR); this.pic.fill(PIC.x, PIC.y, PIC.w, PIC.h); this.undoOn = false; this.undoBox = null; this.dirty = true; this.saveHdr(); }
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
/** The stroke's box (PAINT 15): columns (x - 128) >> 3 of each point +-1 clamped to 0..39, rows y - 32 +- 4 clamped to 0..143; widened to an even first column and an even column count. */
export function strokeBox(pts) {
  const cols = pts.map(([x]) => Math.floor((x - PIC.x) / 8)), rows = pts.map(([, y]) => y - PIC.y);
  const clampc = (v) => Math.max(0, Math.min(39, v)), clampr = (v) => Math.max(0, Math.min(143, v));
  let c0 = clampc(Math.min(...cols) - 1), c1 = clampc(Math.max(...cols) + 1);
  const r0 = clampr(Math.min(...rows) - 4), r1 = clampr(Math.max(...rows) + 4);
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
/** The tool box: for each cell the opaque icon at (x + 8, y), the frame (x - 1, y - 1, 33, 17) in SET, the chosen cell's interior (x, y, 31, 15) inverted. */
const put = (g, x, y, v) => { if (x >= 0 && x < 512 && y >= 0 && y < 192) g.set(x, y, v); };
export function toolBoxLook(g, tool, ox = 0, oy = 0) {
  for (let t = 0; t < 10; t++) {
    const c = cellOf(t), art = ICONS[t];
    for (let r = 0; r < 16; r++) for (let q = 0; q < 16; q++) put(g, c.x + ox + 8 + q, c.y + oy + r, art[r][q] === '#' ? 1 : 0);
    g.setOp(OP_SET); g.frame(c.x + ox - 1, c.y + oy - 1, 33, 17);
    if (t === tool) { g.setOp(OP_XOR); g.fill(c.x + ox, c.y + oy, 31, 15); }
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
  canvasLook(g, st, ox, oy);
  labelLook(g, { x: STATUS.x + ox, y: STATUS.y + oy, w: STATUS.w, h: STATUS.h, flags: 0, text: { codes: codesOf(status) } });
  if (dialog) dialog(g);
  return g;
}
