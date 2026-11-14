"use strict";
// look-mock.mjs -- the look slice's mock-ups (docs/LOOK.md 5): each scene drawn twice by the JS models, today's look (the step 4-5
// models: wm-model2, wm-model3, shell-model, wr-model) beside the proposed one (tests/look-model.mjs), as PNGs in docs/look/.
//   node tools/look-mock.mjs [OUTDIR]          (default docs/look)
// Mode 6's pixels are twice as tall as they are wide, so each screen pixel becomes 2 x 4 PNG pixels (1,024 x 768 a screen): the
// shapes look as they do on a 4:3 display.  Today's side is drawn by the step 4-5 models (wm-model2, wm-model3), which kern4's
// tests still use.  Before writing, the chosen look's scenes are checked pixel for pixel against the models the desk5 tests use
// (renderShell, renderScreen), so the right side is what the tests hold the cartridge to (since L1, LOOK 10).
// Builds nothing, reads no cartridge.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from '../tests/gfx6-model.mjs';
import { windowLook as wmWindowLook, xorOutline } from '../tests/wm-model2.mjs';
import { drawBar, drawOpen, layoutOf } from '../tests/wm-model3.mjs';
import * as SH from '../tests/shell-model.mjs';
import * as WR from '../tests/wr-model.mjs';
import { saveDraw, newSaveField } from '../tests/wr-w3model.mjs';
import * as LK from '../tests/look-model.mjs';
import { vsLook } from '../tests/tk-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs/look');
mkdirSync(OUT, { recursive: true });
const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));

// ---- the two looks
const NOW = {
  name: 'today',
  desk: (g) => { g.setOp(OP_CLR); g.fill(0, 8, 512, 184); },
  bar: drawBar,
  open: drawOpen,
  window: (g, n, active, { closeBox = false } = {}) => { wmWindowLook(g, n, active); if (active && closeBox) WR.closeBoxLook(g, n.x, n.y, n.w); },
  arrow: LK.ARROW_NOW,
};
const mac = (pat, name) => ({
  name,
  pat,
  desk: (g) => LK.patFill(g, pat, 0, 8, 512, 184),
  bar: LK.barLook,
  open: LK.openLook,
  window: (g, n, active, o = {}) => LK.windowLook(g, n, active, { ...o, pat }),
  arrow: LK.ARROW_MAC,
});
const MAC50 = mac(LK.PATTERNS.grey50, 'proposed, grey 50%');
const MAC25 = mac(LK.PATTERNS.grey25, 'chosen, grey 25%');
const MAC50P = { ...MAC50, name: 'proposed, grey 50%, patterned outline', patOutline: true };

// ---- the scenes (each returns a Gfx6Model; `ptr` false leaves the pointer out, for the check against the test models)
const enOf = (menus) => menus.map((m) => m.items.map((it) => !(it.flags & 3)));
const LEAP = [SH.LEAP_MENU];
const win = (r, title) => ({ x: r.x, y: r.y, w: r.w, h: r.h, title: { codes: codes(title) } });
function shell(L, { ptr = true, sel = 0, active = true } = {}) {
  const g = new Gfx6Model();
  L.desk(g); L.bar(g, LEAP, layoutOf(LEAP));
  L.window(g, win(SH.SHELL_WIN, SH.SHELL_WIN.title), active);
  SH.ICONS.forEach((ic, i) => SH.iconLook(g, ic, i === sel));
  if (ptr) LK.drawArrow(g, L.arrow, 150, 60);
  return g;
}
function shellMenu(L) {
  const g = shell(L, { ptr: false });
  L.open(g, LEAP, layoutOf(LEAP), enOf(LEAP), 0, 2);
  LK.drawArrow(g, L.arrow, 46, 33);
  return g;
}
function shellDrag(L) {
  const g = shell(L, { ptr: false });
  const r = [SH.SHELL_WIN.x + 160, SH.SHELL_WIN.y + 64, SH.SHELL_WIN.w, SH.SHELL_WIN.h];
  if (L.patOutline) LK.patXorFrame(g, LK.PATTERNS.grey50, ...r); else xorOutline(g, ...r);
  LK.drawArrow(g, L.arrow, 300, 92);
  return g;
}
const TEXT = 'Leap Desktop runs on the Timex Sinclair 2068 in its 512-pixel mode.\rThis is Notepad, the desktop\'s text editor: it wraps long lines at the edge of the window, scrolls, selects with the mouse or MARK, and keeps its own clipboard.\r\rFile: Open... and Save... go through the page in the browser for now.\rThe look is being tried in the style of the first Macintosh.';
const doc = () => { const c = codes(TEXT).map((v) => (v === 13 ? 13 : v)); return new WR.Doc(c, c.length); };
const NAME = 'Notepad: Untitled';
function notepad(L, { ptr = true, dialog = null } = {}) {
  const g = new Gfx6Model(), d = doc();
  L.desk(g); L.bar(g, WR.MENUS, layoutOf(WR.MENUS));
  L.window(g, win(WR.WINR, NAME), !dialog, { closeBox: true });
  WR.tvLook(g, d, !dialog);
  const b = d.bar(); WR_vs(g, b);
  if (dialog) dialog(g);
  if (ptr) LK.drawArrow(g, L.arrow, dialog ? 200 : 330, dialog ? 112 : 100);
  return g;
}
function WR_vs(g, b) { vsLook(g, { ...WR.BARR, value: b.value, max: b.max, page: b.page }, 0); }
function notepadMenu(L) {
  const g = notepad(L, { ptr: false });
  L.open(g, WR.MENUS, layoutOf(WR.MENUS), enOf(WR.MENUS), 0, 2);
  LK.drawArrow(g, L.arrow, 40, 34);
  return g;
}
const saveDlg = (g) => saveDraw(g, newSaveField(codes('letter')), 0);
const notepadSave = (L) => notepad(L, { dialog: saveDlg });

// ---- the check: today's scenes = the test models' screens
function same(a, b) { for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) return `differ at (${i % 512}, ${(i / 512) | 0})`; return null; }
const checks = [                                         // since L1 (LOOK 10) the test models draw the chosen look: check that side against them
  ['shell = shell-model renderShell', same(shell(MAC25, { ptr: false }), SH.renderShell({ sel: 0 }))],
  ['notepad = wr-model renderScreen', same(notepad(MAC25, { ptr: false }), WR.renderScreen(doc(), { title: NAME }))],
  ['notepad + Save dialog = renderScreen with the dialog', same(notepad(MAC25, { ptr: false, dialog: saveDlg }), WR.renderScreen(doc(), { focus: false, title: NAME, dialog: { draw: saveDlg } }))],
];
let bad = 0;
for (const [what, d] of checks) { console.log(`${d ? 'FAIL' : 'ok  '}  chosen look's ${what}${d ? ': ' + d : ''}`); if (d) bad++; }
if (bad) { console.log('look-mock: the chosen look\'s scenes do not match the test models; nothing written'); process.exit(1); }

// ---- PNG
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
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; gray.copy ? gray.copy(raw, y * (w + 1) + 1, y * w, y * w + w) : raw.set(gray.subarray(y * w, y * w + w), y * (w + 1) + 1); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/** A canvas of gray bytes; `put` draws a region of a Gfx6Model scaled sx x sy. */
class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8Array(w * h).fill(GAP); }
  put(g, ox, oy, sx, sy, cx = 0, cy = 0, cw = 512, ch = 192) {
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const v = g.get(cx + x, cy + y) ? INK : PAPER;
      for (let j = 0; j < sy; j++) this.px.fill(v, (oy + y * sy + j) * this.w + ox + x * sx, (oy + y * sy + j) * this.w + ox + x * sx + sx);
    }
  }
  /** A caption in PROP6 on a paper strip, scaled 2 x 2. */
  label(text, ox, oy, w) {
    const g = new Gfx6Model(); g.setOp(OP_SET); g.textp(0, 0, codes(text));
    this.put(g, ox, oy, 2, 2, 0, 0, Math.min(w >> 1, 512), 9);
  }
  save(name) { writeFileSync(join(OUT, name), png(this.w, this.h, this.px)); console.log(`wrote ${join(OUT, name)} (${this.w} x ${this.h})`); }
}
const SX = 2, SY = 4, PW = 512 * SX, PH = 192 * SY, M = 16, CAP = 24;
/** Side by side: the looks in `looks`, each a full screen at 2 x 4, captioned. */
function sideBySide(file, title, scene, looks) {
  const c = new Canvas(M + looks.length * (PW + M), CAP + M + PH + M);
  looks.forEach((L, i) => {
    const ox = M + i * (PW + M);
    c.label(`${title}: ${L.name}`, ox, 4, PW);
    c.put(scene(L), ox, CAP + M, SX, SY);
  });
  c.save(file);
}
/** A detail: region (cx, cy, cw, ch) of each look's scene at 4 x 8 (or `z`), stacked across. */
function detail(file, title, scene, looks, cx, cy, cw, ch, z = [4, 8]) {
  const w = cw * z[0], h = ch * z[1];
  const c = new Canvas(M + looks.length * (w + M), CAP + M + h + M);
  looks.forEach((L, i) => {
    const ox = M + i * (w + M);
    c.label(`${title}: ${L.name}`, ox, 4, w);
    c.put(scene(L), ox, CAP + M, z[0], z[1], cx, cy, cw, ch);
  });
  c.save(file);
}

const TWO = [NOW, MAC25];                               // the owner chose 25% (LOOK 8); 7-grey.png keeps the three options
sideBySide('1-shell.png', 'The shell', shell, TWO);
sideBySide('2-shell-menu.png', 'The Leap menu open', shellMenu, TWO);
sideBySide('3-notepad.png', 'Notepad', notepad, TWO);
sideBySide('4-notepad-menu.png', 'Notepad, the File menu open', notepadMenu, TWO);
sideBySide('5-notepad-save.png', 'Notepad behind the Save dialog (inactive)', notepadSave, TWO);
sideBySide('6-drag.png', 'Dragging the shell window (the XOR outline)', shellDrag, TWO);
sideBySide('7-grey.png', 'Desk and drag outline', shellDrag, [MAC50, MAC50P, MAC25]);
detail('8-detail-title.png', 'Menu bar, title bar, close box (x 3)', notepad, TWO, 0, 0, 300, 36, [3, 6]);
detail('9-detail-menu.png', 'An open menu (x 4)', notepadMenu, TWO, 0, 0, 120, 56);
detail('10-detail-shadow.png', 'Shadow and corner (x 4)', notepad, TWO, 400, 150, 112, 42);
{ // the arrows on paper and on each grey, x 12
  const bgs = [['paper', LK.PATTERNS.white], ['grey 50%', LK.PATTERNS.grey50], ['grey 25%', LK.PATTERNS.grey25]], arts = [['today', LK.ARROW_NOW], ['Mac', LK.ARROW_MAC]];
  const z = [12, 24], cw = 22, ch = 20, w = cw * z[0], h = ch * z[1];
  const c = new Canvas(M + 6 * (w + M), CAP + M + h + M);
  let i = 0;
  for (const [an, art] of arts) for (const [bn, pat] of bgs) {
    const g = new Gfx6Model(); LK.patFill(g, pat, 0, 0, 512, 192); LK.drawArrow(g, art, 3, 2);
    const ox = M + i++ * (w + M); c.label(`${an}, ${bn}`, ox, 4, w); c.put(g, ox, CAP + M, z[0], z[1], 0, 0, cw, ch);
  }
  c.save('11-detail-arrow.png');
}
