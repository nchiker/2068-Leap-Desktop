"use strict";
// kc-mock.mjs -- the mock-ups of Key Caps' second design (owner, 2026-11-14: "it resembles the Spectrum keyboard not the 2068,
// it shows only once the key value"): the TS2068's own layout (five rows: the wide ENTER, two CAPS SHIFTs, BREAK, the SPACE
// bar; tsrun/keyboard.js's board), each key showing its three desktop values at once (CAPS SHIFT on top when it is a function,
// the key's legend in the middle, SYMBOL SHIFT at the bottom), the held shift's line highlighted.  Labels come from
// src/kernel/keymap.txt.  PNGs in docs/keycaps/, 2 x 4 PNG pixels a screen pixel (as tools/look-mock.mjs).
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

// ---- the layout (pixels): rows of [key, width]; x starts, y tops; cap 36 x 27, gaps 2, row pitch 28 (TS2068 board proportions)
const CAP_H = 27, Y0 = 30, PITCH = 28;
const ROWS = [
  { x: 40, keys: '1234567890'.split('').map((k) => [k, 36]) },
  { x: 49, keys: 'QWERTYUIOP'.split('').map((k) => [k, 36]) },
  { x: 58, keys: [...'ASDFGHJKL'.split('').map((k) => [k, 36]), ['ENTER', 70]] },
  { x: 40, keys: [['CS', 43], ...'ZXCVBNM'.split('').map((k) => [k, 36]), ['SS', 36], ['BREAK', 36], ['CS', 43]] },
];
const BAR = { x: 123, y: Y0 + 4 * PITCH, w: 264, h: 18 };
const WIN = { x: 32, y: 16, w: 448, h: 168, title: { codes: codes('Key Caps') } };
const STATUS = { x: 48, y: 164 };

/** The three lines of a key: [top (CAPS SHIFT), middle (the legend), bottom (SYMBOL SHIFT)]. */
function lines(key) {
  if (key === 'CS') return ['Caps', 'Shift', ''];
  if (key === 'SS') return ['Symbl', 'Shift', ''];
  if (key === 'BREAK') return ['', 'Break', ''];
  const [p, c, s] = MAP[key];
  const legend = key === 'ENTER' ? 'Enter' : key;
  const top = c && c !== p && !(c >= 65 && c <= 90 && c + 32 === p) ? label(c) : '';
  const bottom = s && s !== p ? label(s) : '';
  return [top, legend, bottom];
}
const centred = (g, x, w, ty, s) => { if (s) g.textp(x + Math.floor((w - tw(codes(s))) / 2), ty, codes(s)); };

/** A screen: `held` = 'CS' | 'SS' | null (the line highlighted), `down` = the keys drawn pressed, `status` = the status text. */
function scene({ held = null, down = [], status = 'Press a key.' }) {
  const g = new Gfx6Model();
  LK.deskLook(g);
  LK.barLook(g, null, null);
  LK.macWindowLook(g, WIN, true, { closeBox: true });
  ROWS.forEach((row, r) => {
    let x = row.x;
    const y = Y0 + r * PITCH;
    for (const [key, w] of row.keys) {
      g.setOp(OP_SET); g.frame(x, y, w, CAP_H);
      lines(key).forEach((s, i) => centred(g, x, w, y + 1 + 8 * i, s));
      const shiftKey = key === 'CS' || key === 'SS' || key === 'BREAK';
      if (held && !shiftKey) { g.setOp(OP_XOR); g.fill(x + 1, y + 1 + 8 * (held === 'CS' ? 0 : 2), w - 2, 8); }
      if (down.includes(key) || (held && key === held)) { g.setOp(OP_XOR); g.fill(x + 1, y + 1, w - 2, CAP_H - 2); }
      x += w + 2;
    }
  });
  g.setOp(OP_SET); g.frame(BAR.x, BAR.y, BAR.w, BAR.h);
  centred(g, BAR.x, BAR.w, BAR.y + 5, 'Space');
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
  ['kc2-plain.png', { status: 'Press a key.' }],
  ['kc2-caps.png', { held: 'CS', down: ['1'], status: 'Last key: Tab (code 14)' }],
  ['kc2-symbol.png', { held: 'SS', down: ['E'], status: 'Last key: Mark (code 18)' }],
];
for (const [file, opts] of SCENES) { writeFileSync(join(OUT, file), png(scene(opts))); console.log(`wrote ${join(OUT, file)}`); }
