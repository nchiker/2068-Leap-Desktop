"use strict";
// wm-lib.mjs -- shared harness of the window manager tests (tests/wm-w1.mjs, tests/wm-perf.mjs): boot the prebuilt `kern4` cartridge
// (build/kern4.dck and build/kern4/out.sym; `--build` runs tools/build.mjs first), display helpers (the screen as bytes [y * 64 + byte
// column], the byte coverage of pixel rectangles), the symbols the tests need.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, build } from '../tools/build.mjs';
import { boot, runFramesUntil } from './lib.mjs';
import { call, setGA, hex } from './gfx6-lib.mjs';
import { ROWTAB } from './gfx6-model.mjs';

export const WNEEDED = [
  'K_SEND', 'K_AINIT', 'K_ARENA', 'K_ARESET', 'K_NEW', 'K_ALLOC', 'K_ADDCHILD', 'K_UNLINK', 'K_SETROOT', 'K_KARENA', 'K_AARENA',
  'K_FOCUS', 'K_CAPTURE', 'K_ROOT', 'K_FSCOPE', 'K_CODE', 'K_CODE_END', 'K_DISPATCH', 'K_SETFOCUS', 'K_FOCUSNEXT', 'K_FOCUSPREV',
  'K_GETEV', 'K_POST', 'K_EV', 'K_PN', 'K_RHEAD', 'K_RTAIL', 'T_SEND', 'T_LOG', 'T_LOGN', 'T_RET', 'RESULT', 'V_FRAMES',
  'W_INIT', 'W_OPEN', 'W_CLOSE', 'W_RAISE', 'W_MOVE', 'W_INVAL', 'W_INVALV', 'W_UPDATE', 'W_DRAWVIEW', 'W_FRONT', 'W_MAP', 'W_SLOTS',
  'W_DIRTY', 'W_MODAL', 'group_draw', 'desk_draw', 'mbar_draw', 'window_draw', 'window_destroy',
  'T_RAISEUPD', 'T_OPENUPD', 'T_CLOSEUPD', 'T_MOVEUPD', 'T_TITLE1', 'T_TITLE2', 'T_TITLEL',
  'CL_View', 'CL_Group', 'CL_Desk', 'CL_MenuBar', 'CL_Window', 'CL_TWin', 'CL_TCtl', 'CL_TGrp', 'CL_TNull',
  'View_parent', 'View_child', 'View_next', 'View_x', 'View_y', 'View_w', 'View_h', 'View_flags', 'View_id',
  'Window_slot', 'Window_title', 'Window_focus', 'TWin_tag', 'TCtl_tag', 'TGrp_tag', 'TWin_SIZE', 'TCtl_SIZE', 'TGrp_SIZE',
  'M_DRAW', 'M_DESTROY', 'GA', 'GOP', 'GLH', 'GCLIP', 'G_SETCLIP', 'P_SHIELD', 'P_UNSHIELD',
];

export function parseSym(text) {
  const syms = {};
  for (const line of text.split('\n')) { const m = line.match(/^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)/); if (m) syms[m[1]] = parseInt(m[2], 16); }
  return syms;
}

/**
 * Boot the kern4 cartridge as it is on disk.  Returns { m, S, img, frames } or null after recording a FAIL on C.  After the boot the pointer
 * is made harmless: it is shielded over the whole screen (which erases it if the boot's frames drew it) and the display is cleared.  The tests
 * run no frame afterwards, so the pointer is never drawn again (P_ISR runs only in the frame interrupt).
 */
export function startW(C, needed = WNEEDED, target = 'kern4', doBuild = process.argv.includes('--build')) {
  let img, syms, dck;
  try {
    if (doBuild) { const b = build(target); img = b.img; syms = b.syms; dck = b.dck; }
    else {
      const dir = join(ROOT, 'build', target);
      if (!existsSync(join(dir, 'out.sym')) || !existsSync(join(ROOT, 'build', `${target}.dck`))) throw new Error(`build/${target}/out.sym or build/${target}.dck is missing (node tools/build.mjs ${target}, or pass --build)`);
      syms = parseSym(readFileSync(join(dir, 'out.sym'), 'utf8'));
      img = new Uint8Array(readFileSync(join(dir, 'mem.bin')));
      dck = readFileSync(join(ROOT, 'build', `${target}.dck`));
    }
  } catch (e) { C.check(`${target} cartridge is available`, false, String(e.message).split('\n')[0]); return null; }
  const S = syms, missing = needed.filter((n) => S[n] === undefined);
  if (missing.length) { C.check(`${target} defines the symbols the tests use`, false, `missing: ${missing.join(', ')}`); return null; }
  const m = boot(dck);
  const marked = (mm) => mm.ram[S.RESULT] === 0xA5 && mm.ram[S.RESULT + 1] === 0x5A;
  const frames = runFramesUntil(m, marked, 400);
  const state = m.ram[S.RESULT + 2];
  C.check(`${target} booted: record marker $A5 $5A, state 1`, frames > 0 && state === 1, `frames ${frames}, state ${state}`);
  if (!(frames > 0 && state === 1)) return null;
  setGA(m, S, 0, 0, 512, 192);
  call(m, S, 'P_SHIELD', {}, { ints: false });
  call(m, S, 'P_UNSHIELD', {}, { ints: false });
  m.ram.fill(0, 0x4000, 0x5800); m.ram.fill(0, 0x6000, 0x7800);
  return { m, S, img, frames };
}

// ---------------------------------------------------------------------------------------------------------------------------
// The display as bytes: screen byte column bc (0..63) of pixel row y at index y * 64 + bc.
export const DADDR = new Uint16Array(192 * 64);
for (let y = 0; y < 192; y++) for (let bc = 0; bc < 64; bc++) DADDR[y * 64 + bc] = ROWTAB[y] + (bc >> 1) + ((bc & 1) ? 0x2000 : 0);
export function readDisp(m) { const out = new Uint8Array(192 * 64); for (let i = 0; i < out.length; i++) out[i] = m.ram[DADDR[i]]; return out; }
export function writeDisp(m, d) { for (let i = 0; i < d.length; i++) m.ram[DADDR[i]] = d[i]; }
/** Bit masks of the pixels covered by the rectangles [x0, x1, y0, y1] (half-open): a display-shaped array. */
export function coverage(rects) {
  const cov = new Uint8Array(192 * 64);
  for (const [x0, x1, y0, y1] of rects) {
    if (x1 <= x0 || y1 <= y0) continue;
    for (let y = Math.max(y0, 0); y < Math.min(y1, 192); y++) for (let bc = x0 >> 3; bc <= (x1 - 1) >> 3; bc++) {
      const lo = Math.max(x0, bc * 8) - bc * 8, hi = Math.min(x1, bc * 8 + 8) - bc * 8;
      cov[y * 64 + bc] |= (0xFF >> lo) & (0xFF << (8 - hi)) & 0xFF;
    }
  }
  return cov;
}
/** First difference between two display arrays under a mask (bits to compare), as text, or null. */
export function diffDisp(a, b, mask = null) {
  let first = -1, n = 0;
  for (let i = 0; i < a.length; i++) { const d = (a[i] ^ b[i]) & (mask ? mask[i] : 0xFF); if (d) { n++; if (first < 0) first = i; } }
  if (first < 0) return null;
  const y = first >> 6, bc = first & 63;
  return `${n} byte(s) differ, first at pixel row ${y}, byte column ${bc} (x ${bc * 8}..${bc * 8 + 7}, cell ${bc >> 1},${y >> 3}): $${a[first].toString(16)} against $${b[first].toString(16)}`;
}
export const cellRange = (c, r) => ({ bc0: 2 * c, y0: 8 * r });

export { hex };
