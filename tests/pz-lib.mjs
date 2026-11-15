"use strict";
// pz-lib.mjs -- harness of the Puzzle tests (tests/pz-p1.mjs, rows in tests/shell-perf.mjs): the 15-tile Puzzle (program 5, docs/PUZZLE.md) started through the shell on the prebuilt `desk5`
// (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  Written from docs/PUZZLE.md and the task's description of src/apps/puzzle.asm (symbol names read from out.sym).
//   - bootPuzzle: the shell booted (drawing off), the Puzzle started by the Leap menu (row 7) or a double click on the fifth icon; the first instruction at PZ_START observed (the mapping
//     under which it runs); the stack watch and the program-image write watch armed;
//   - readState / readViews: the machine's board, gap, moves, won flag, the label, the views (rectangles, classes, ids);
//   - pzDiff: the machine's screen against tests/pz-model.mjs's rendering of the machine's own state;
//   - setBoard: a board poked into the machine's variables and drawn (the window dragged away and back; the program redraws the window from its variables);
//   - drivers: a press on a cell, an arrow key, the title-bar drag to another cell position, a park of the pointer.
import * as H from './shell-lib.mjs';
import * as Z from './pz-model.mjs';
import { makeAyLog } from './snd-lib.mjs';
import { readDisp, diffDisp } from './wm-lib.mjs';

export { H, Z, readDisp, diffDisp };
export const { L } = H;
export const { hex, rd16 } = L;
export const PARK = [500, 185];                          // the pointer's parking place: on the desk, right of and below the window
export const SETTLE = 6;                                 // frames after an action before the machine is read (a move repaints in one frame; a deal in a few)
export const NEEDED = ['PZ_START', 'PZ_B', 'PZ_G', 'PZ_WON', 'PZ_MV', 'PZ_WIN', 'PZ_BV', 'PZ_LV', 'PZ_RND', 'PZ_LBL', 'PZ_VEND', 'CL_Board', 'CL_Label', 'CL_Button', 'K_PROGS', 'K_BEEP', 'V_SHADOW_F4', 'V_SHADOW_FF'];
export function needPuzzle(S) { const miss = NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); }

/** The lowest address written in the stack's area [lo, $FF00) while armed: depth = $FF00 - min. */
export function watchStack(m, lo = 0xFE00) {
  const o = { min: 0xFF00 }, w0 = m.bus.write;
  m.bus.write = function (addr, v) { const a = addr & 0xFFFF; if (a >= lo && a < 0xFF00 && a < o.min) o.min = a; w0(addr, v); };
  o.depth = () => 0xFF00 - o.min;
  return o;
}

/**
 * The shell booted (drawing off), the Puzzle launched through it: how = 'menu' (Leap menu row 7, the default) or 'icon' (a double click on the fifth icon); opts.ay: the AY write log of
 * tests/snd-lib.mjs wrapped from the first instruction (env.log).  env.entry = what was seen at PZ_START's first instruction: { n, shadowF4, portF4, shadowFF, sp }.
 */
export function bootPuzzle(opts = {}) {
  const log = opts.ay ? makeAyLog() : null;
  const env = H.bootShell({ video: false, ...opts, setup: log ? log.setup : opts.setup }), { m, S } = env;
  needPuzzle(S);
  if (log) { log.attach(env); env.log = log; }
  env.entry = { n: 0 };
  const r0 = m.bus.read;                                   // the first instruction of the program (PC = PZ_START): the mapping port and its shadows at that moment
  m.bus.read = function (addr) {
    const a = addr & 0xFFFF;
    if (a === S.PZ_START && m.cpu.pc === S.PZ_START) { env.entry.n++; if (env.entry.n === 1) Object.assign(env.entry, { shadowF4: m.ram[S.V_SHADOW_F4], portF4: m.portF4, shadowFF: m.ram[S.V_SHADOW_FF], sp: m.cpu.sp, kprog: m.ram[S.K_PROG] }); }
    return r0(addr);
  };
  if ((opts.how ?? 'menu') === 'menu') H.leapMenu(env, 7);
  else { const [x, y] = L.iconCentre(5); L.click(env, x, y, 3, 6); L.click(env, x, y, 3, 6); }
  if (L.waitProgram(env, 5, 160) < 0) throw new Error(`the Puzzle did not start (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))})`);
  env.frames_(opts.settle ?? 12);
  L.moveTo(env, PARK[0], PARK[1]); env.frames_(4);
  armWatches(env);
  return env;
}
/** The stack watch and the image-write watch (the program image $C000 .. AL_RAM may be written only in PZ_B .. PZ_VEND) armed from now on; env.stack, env.img. */
export function armWatches(env) {
  const { m, S } = env;
  env.stack = watchStack(m);
  env.img = { n: 0, first: [], armed: true, lo: S.PZ_B, hi: S.PZ_VEND };
  const w0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (env.img.armed && a >= 0xC000 && a < S.AL_RAM && (a < env.img.lo || a >= env.img.hi)) { env.img.n++; if (env.img.first.length < 8) env.img.first.push(`${hex(a)} <- ${hex(v, 2)}, PC ${hex(m.cpu.pc)}`); }
    w0(addr, v);
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading the machine
/** The window and its three children as the machine holds them: { win, kids, board, label, button } or null. */
export function readViews(env) {
  const { m, S } = env, win = L.openWindows(m, S).find((w) => w.title === 'Puzzle');
  if (!win) return null;
  const kids = []; for (let v = win.child; v; v = L.readView(m, S, v).next) kids.push(L.readView(m, S, v));
  return { win, kids, board: kids.find((k) => k.cls === S.CL_Board), label: kids.find((k) => k.cls === S.CL_Label), button: kids.find((k) => k.cls === S.CL_Button) };
}
export const labelStr = (m, S) => H.readStrText(m, S.PZ_LBL);
/** The program's variables: { b: [16 cells], g, won, mv, lbl: the label's text }. */
export function readState(env) {
  const { m, S } = env;
  return { b: Array.from(m.ram.subarray(S.PZ_B, S.PZ_B + 16)), g: m.ram[S.PZ_G], won: m.ram[S.PZ_WON], mv: rd16(m, S.PZ_MV), lbl: labelStr(m, S) };
}
/** The machine's state against a Game: the cells, the gap, the won flag, the moves, the label text; the first difference as text or null. */
export function stateDiff(env, game) {
  const st = readState(env);
  if (st.b.join() !== game.b.join()) return `board ${st.b.join(',')}, model ${game.b.join(',')}`;
  if (st.g !== game.gap) return `PZ_G ${st.g}, model ${game.gap}`;
  if (st.won !== (game.won ? 1 : 0)) return `PZ_WON ${st.won}, model ${game.won ? 1 : 0}`;
  if (st.mv !== game.mv) return `PZ_MV ${st.mv}, model ${game.mv}`;
  if (st.lbl !== game.label) return `label "${st.lbl}", model "${game.label}"`;
  return null;
}
/** The screen against the model's rendering of the machine's own board and label, the window where the machine has it; `extra` = pointer positions to leave out; null when equal. */
export function pzDiff(env, extra = []) {
  const { m, S } = env, v = readViews(env);
  if (!v) return 'the Puzzle window is not open';
  const st = readState(env);
  const g = Z.renderScreen({ board: st.b, label: st.lbl, dx: v.win.x - Z.WIN.x, dy: v.win.y - Z.WIN.y, active: true, btnFocus: !!v.button && rd16(m, S.K_FOCUS) === v.button.a });
  return diffDisp(readDisp(m), Z.toDisp(g), L.pointerMask(m, S, extra));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers
export const park = (env) => { L.moveTo(env, PARK[0], PARK[1]); env.frames_(2); };
/** The screen centre of cell i (the board's origin is the board view's). */
export function cellCentre(env, i) { const v = readViews(env); return [v.board.x + Z.CELL_W * (i & 3) + 32, v.board.y + Z.CELL_H * (i >> 2) + 16]; }
/** A press on the centre of cell i: the pointer there, held `hold` frames, released, `settle` frames run; the pointer is left on the cell (park() moves it away). */
export function pressCell(env, i, hold = 3, settle = SETTLE) { const [x, y] = cellCentre(env, i); L.click(env, x, y, hold, settle); return [x, y]; }
/** An arrow key or any key code typed (held 3 frames, released 3), `settle` frames after. */
export function key(env, code, settle = SETTLE) { L.typeCode(env, code, 3, 3); env.frames_(settle); }
/** The title bar dragged so that the window comes to (nx, ny) (whole cells: x a multiple of 16, y of 8); the window object read back. */
export function dragTo(env, nx, ny, settle = 30) {
  const { m } = env, w = readViews(env).win, px = w.x + 100, py = w.y + 3;
  L.moveTo(env, px, py); env.frames_(2);
  m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, px + (nx - w.x), py + (ny - w.y)); env.frames_(3);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(settle);
  return readViews(env).win;
}
/** The window's current offset from home. */
export const offset = (env) => { const w = readViews(env).win; return [w.x - Z.WIN.x, w.y - Z.WIN.y]; };

/**
 * Poke a game into the machine's variables (the board, the gap, the won flag, the moves, the label buffer) and have the program draw it: the window is dragged to (nx, ny) (default: one cell
 * position away from where it is, alternating), which repaints the whole window from the variables.  Returns the window read back.
 */
export function setBoard(env, game, nx = null, ny = null) {
  const { m, S } = env, w = readViews(env).win;
  for (let i = 0; i < 16; i++) m.ram[S.PZ_B + i] = game.b[i];
  m.ram[S.PZ_G] = game.gap; m.ram[S.PZ_WON] = game.won ? 1 : 0;
  m.ram[S.PZ_MV] = game.mv & 0xFF; m.ram[S.PZ_MV + 1] = game.mv >> 8;
  const t = game.label; m.ram[S.PZ_LBL] = t.length; for (let i = 0; i < t.length; i++) m.ram[S.PZ_LBL + 1 + i] = t.charCodeAt(i);
  if (nx === null) { nx = w.x === 64 ? 80 : 64; ny = w.y === 24 ? 32 : 24; }
  if (nx === w.x && ny === w.y) dragTo(env, nx === 80 ? 64 : 80, ny === 32 ? 24 : 32);        // a drag to the same place repaints nothing: go round by another place
  return dragTo(env, nx, ny);
}

/** The program's idle state at a stable point: V_FRAMES-driven frames run until the screen has been unchanged for 2 frames (a deal's redraw spans several). */
export function settle(env, max = 40) {
  const { m } = env; let prev = null;
  for (let i = 0; i < max; i++) { env.frame(); const d = readDisp(m); if (prev && d.every((v, k) => v === prev[k])) return i; prev = d; }
  return max;
}
