"use strict";
// hello.mjs -- the step 1 smoke test: build src/hello.asm, boot it on TSRun with the stock ROMs, and compare the whole
// 512 x 192 picture with a reference model written from the spec in hello.asm's header (not from its code).
//   node tests/hello.mjs [--pgm]      (--pgm also writes build/hello.pgm to look at)
import { join } from 'node:path';
import { build, ROOT } from '../tools/build.mjs';
import { boot, runFramesUntil, screenPixel, savePgm, loadFont, checks, M, SCR_W, SCR_H } from './lib.mjs';

const C = checks('hello');
const { dck, syms } = build('hello');
const RESULT = syms.RESULT, R_STATE = syms.R_STATE, V_FRAMES = syms.V_FRAMES;
const marked = (mm) => mm.ram[RESULT] === 0xA5 && mm.ram[RESULT + 1] === 0x5A;
const m = boot(dck);

// 1. Hand-off and boot: the stock ROM reaches the cartridge after about 103 frames.
const f = runFramesUntil(m, marked, 400);
C.check('cartridge ran and reported pass', f > 0 && m.ram[R_STATE] === 1, `frames ${f}, state ${m.ram[R_STATE]}`);
C.check('hand-off within 98..140 frames', f >= 98 && f <= 140, `${f}`);
C.check('$F4 = $33 (DOCK 0,1,4,5)', m.portF4 === 0x33, `$${m.portF4.toString(16)}`);
C.check('$FF = $06 (mode 6, black ink, interrupt on, DOCK)', m.portFF === 0x06, `$${m.portFF.toString(16)}`);
C.check('shadow of $FF matches the port', m.ram[syms.V_SHADOW_FF] === m.portFF);

// 2. The frame interrupt runs: the counter advances one per frame.
const before = m.ram[V_FRAMES] | (m.ram[V_FRAMES + 1] << 8);
for (let i = 0; i < 10; i++) M.runFrame(m);
const after = m.ram[V_FRAMES] | (m.ram[V_FRAMES + 1] << 8);
C.check('10 frame interrupts in 10 frames', after - before === 10, `${after - before}`);

// 3. The picture, pixel for pixel, against the reference model.
const glyph = loadFont();
const want = new Uint8Array(SCR_W * SCR_H);                      // 1 = ink
const text = (row, col, s) => {
  for (let i = 0; i < s.length; i++) {
    const g = glyph(s.charCodeAt(i));
    for (let r = 0; r < 8; r++) for (let b = 0; b < 8; b++)
      if (g[r] & (0x80 >> b)) want[(row * 8 + r) * SCR_W + (col + i) * 8 + b] = 1;
  }
};
text(0, 0, 'LEAP DESKTOP  mode 6, 512x192, 64 columns of 8x8 text');
text(2, 0, '0123456789012345678901234567890123456789012345678901234567890123');
text(4, 1, 'odd column start: file 2 first');
for (let x = 0; x < SCR_W; x++) { want[176 * SCR_W + x] = 1; want[191 * SCR_W + x] = 1; }
for (let y = 177; y < 191; y++) { want[y * SCR_W] = 1; want[y * SCR_W + 511] = 1; }

let bad = 0, first = '';
for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
  const got = screenPixel(m, x, y), exp = want[y * SCR_W + x] ? 0 : 7;  // ink 0 (black), paper 7 (white)
  if (got !== exp) { if (!bad) first = `first at (${x}, ${y}): got ${got}, want ${exp}`; bad++; }
}
C.check('512 x 192 picture equals the reference model', bad === 0, bad ? `${bad} pixels differ, ${first}` : '98,304 pixels');

if (process.argv.includes('--pgm')) { savePgm(m, join(ROOT, 'build/hello.pgm')); console.log('wrote build/hello.pgm'); }
C.done();
