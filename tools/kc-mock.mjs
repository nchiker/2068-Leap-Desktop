"use strict";
// kc-mock.mjs -- the mock-ups of Key Caps' second design (owner, 2026-11-14: "it resembles the Spectrum keyboard not the 2068";
// then "simplify what is on the key legends like the current version does"): the TS2068's own layout (five rows: the wide
// ENTER, two CAPS SHIFTs, BREAK, the SPACE bar; tsrun/keyboard.js's board), one legend a key in the plane shown, as KEYCAPS 2
// (the radios and the held shifts pick the plane).  Labels come from src/kernel/keymap.txt.  (kc2-*.png: the three-value
// design the owner turned down.)  PNGs in docs/keycaps/, 2 x 4 PNG pixels a screen pixel (as tools/look-mock.mjs).
//   node tools/kc-mock.mjs [OUTDIR]
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR } from '../tests/gfx6-model.mjs';
import { tw } from '../tests/wm-model3.mjs';
import * as LK from '../tests/look-model.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ?? join(ROOT, 'docs/keycaps');
mkdirSync(OUT, { recursive: true });
const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));

// ---- the key map: key name -> [plain, CS, SS] codes (0: none)
const NAMED = { ENTER: 13, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, DELETE: 12, TAB: 14, BACKTAB: 15, MENU: 16, CLOSE: 17, MARK: 18,
  ESC: 27, BREAK: 3, CAPS: 1, SPACE: 32, HASH: 35, DASH: 45 };
const MAP = {};
for (const line of readFileSync(join(ROOT, 'src/kernel/keymap.txt'), 'utf8').split('\n')) {
  if (!line.trim() || line.startsWith('#')) continue;
  const [key, ...cols] = line.trim().split(/\s+/);
  MAP[key] = cols.map((c) => (c === '-' ? 0 : NAMED[c] ?? c.charCodeAt(0)));
}
const NAMES = { 1: 'Caps', 3: 'Brk', 8: 'Left', 9: 'Right', 10: 'Down', 11: 'Up', 12: 'Del', 13: 'Enter', 14: 'Tab', 15: 'BTab',
  16: 'Menu', 17: 'Close', 18: 'Mark', 27: 'Esc', 32: 'Space' };
const label = (c) => (c === 0 ? '' : c >= 33 && c <= 126 ? String.fromCharCode(c) : NAMES[c] ?? '');

// ---- the layout (pixels): rows of [key, width]; cap height 18, row pitch 22; gaps 2 (TS2068 board proportions, tsrun/keyboard.js)
const CAP_H = 18, Y0 = 54, PITCH = 22;
const ROWS = [
  { x: 40, keys: '1234567890'.split('').map((k) => [k, 36]) },
  { x: 49, keys: 'QWERTYUIOP'.split('').map((k) => [k, 36]) },
  { x: 58, keys: [...'ASDFGHJKL'.split('').map((k) => [k, 36]), ['ENTER', 70]] },
  { x: 40, keys: [['CS', 43], ...'ZXCVBNM'.split('').map((k) => [k, 36]), ['SS', 36], ['BREAK', 36], ['CS', 43]] },
];
const BAR = { x: 123, y: Y0 + 4 * PITCH, w: 264, h: 14 };
const WIN = { x: 32, y: 24, w: 448, h: 160, title: { codes: codes('Key Caps') } };
const RADIOS = [[48, 'Plain'], [160, 'Caps Shift'], [296, 'Symbol Shift']];
const RADIO_Y = 40;
const STATUS = { x: 48, y: 162 };

/** One key's legend in plane P (0 plain, 1 CAPS SHIFT, 2 SYMBOL SHIFT), as KEYCAPS 2 (the shift keys and BREAK fixed). */
function legend(key, P) {
  if (key === 'CS') return 'CS';
  if (key === 'SS') return 'SS';
  if (key === 'BREAK') return 'Brk';
  return label(MAP[key][P]);
}
const centred = (g, x, w, ty, s) => { if (s) g.textp(x + Math.floor((w - tw(codes(s))) / 2), ty, codes(s)); };

/** A radio (TOOLKIT 9's Check look, as Controls had): a 9 x 9 box, a dot when checked, the text at x + 12. */
function radio(g, x, y, text, on) {
  g.setOp(OP_SET); g.frame(x, y, 9, 9);
  if (on) g.fill(x + 3, y + 3, 3, 3);
  g.textp(x + 12, y, codes(text));
}

/** A screen: P the plane shown, `checked` the radio checked, `down` the keys drawn pressed, `status` the status text. */
function scene({ P = 0, checked = 0, down = [], status = 'Press a key.' }) {
  const g = new Gfx6Model();
  LK.deskLook(g);
  LK.barLook(g, null, null);
  LK.macWindowLook(g, WIN, true, { closeBox: true });
  RADIOS.forEach(([x, t], i) => radio(g, x, RADIO_Y, t, i === checked));
  ROWS.forEach((row, r) => {
    let x = row.x;
    const y = Y0 + r * PITCH;
    for (const [key, w] of row.keys) {
      g.setOp(OP_SET); g.frame(x, y, w, CAP_H);
      centred(g, x, w, y + 5, legend(key, P));
      if (down.includes(key)) { g.setOp(OP_XOR); g.fill(x + 1, y + 1, w - 2, CAP_H - 2); }
      x += w + 2;
    }
  });
  g.setOp(OP_SET); g.frame(BAR.x, BAR.y, BAR.w, BAR.h);
  centred(g, BAR.x, BAR.w, BAR.y + 3, label(MAP.SPACE[P]));
  if (down.includes('SPACE')) { g.setOp(OP_XOR); g.fill(BAR.x + 1, BAR.y + 1, BAR.w - 2, BAR.h - 2); }
  g.setOp(OP_SET); g.textp(STATUS.x, STATUS.y, codes(status));
  return g;
}

// ---- PNG (as tools/look-mock.mjs: 2 x 4 a pixel)
function crc32(buf) {
  let c, crc = 0xFFFFFFFF;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function png(g) {
  const W = 1024, H = 768, px = Buffer.alloc((W + 1) * H);
  for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) {
    const v = g.get(x, y) ? 0 : 255;
    for (let j = 0; j < 4; j++) { const o = (y * 4 + j) * (W + 1) + 1 + x * 2; px[o] = v; px[o + 1] = v; }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(px, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const SCENES = [
  ['kc3-plain.png', { status: 'Press a key.' }],
  ['kc3-caps.png', { P: 1, down: ['CS', '1'], status: 'Last key: Tab (code 14)' }],
  ['kc3-symbol.png', { P: 2, checked: 2, down: ['E'], status: 'Last key: Mark (code 18)' }],
];
for (const [file, opts] of SCENES) { writeFileSync(join(OUT, file), png(scene(opts))); console.log(`wrote ${join(OUT, file)}`); }
