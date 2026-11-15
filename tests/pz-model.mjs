"use strict";
// pz-model.mjs -- reference model of the 15-tile Puzzle (program 5, docs/PUZZLE.md; the K-resident program of docs/SPACE_PLAN.md).  Written from the contract and the task's description:
//   * the window: a CWindow (id 255, "Puzzle") at (64, 24), 400 x 160; the board view (80, 48, 256, 128): 4 x 4 cells of 64 x 32 pixels (cell i at column i & 3, row i >> 2); the label (352, 56, 96, 9);
//     the Button "New game" (352, 96, 96, 16, flags $11, id 2);
//   * a tile: a 62 x 30 frame at (cell x + 1, cell y + 1) in SET, its number in bold (the text drawn twice, one pixel apart) at x = cell x + 32 - 3 n (n digits), y = cell y + 12; the gap is paper;
//   * a press on a tile in the gap's row or column slides the run between it and the gap one cell toward the gap (moves + 1); a press elsewhere does nothing; the arrow keys slide the
//     gap's neighbour from that side (Left 8: the tile on the gap's right; Right 9: on its left; Down 10: above it; Up 11: below it); solved = 1 .. 15 and the gap last: PZ_WON, then presses
//     and keys do nothing (until New game);
//   * the label: "Moves:  " / "Solved: " (8 characters) and the moves in 4 characters, right aligned with leading zeros blanked (12 characters in all).
//   node tests/pz-model.mjs --self-test
import { fileURLToPath } from 'node:url';
import { Gfx6Model, OP_SET, OP_CLR, OP_XOR, deskLook, barLook, macWindowLook, closeBoxLook } from './look-model.mjs';
import { buttonLook, labelLook, toDisp } from './wm-model2.mjs';

export { Gfx6Model, toDisp };
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));
export const WIN = { x: 64, y: 24, w: 400, h: 160, title: 'Puzzle', id: 255 };
export const BOARD = { x: 80, y: 48, w: 256, h: 128, id: 1 };
export const LABEL = { x: 352, y: 56, w: 96, h: 9, id: 3 };
export const BUTTON = { x: 352, y: 96, w: 96, h: 16, flags: 0x11, id: 2, text: 'New game' };
export const CELL_W = 64, CELL_H = 32;
export const KEY = { LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, CLOSE: 17 };
export const SOLVED = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0];

/** The label's 12 characters: the 8-character prefix and the moves right-aligned in 4 characters. */
export const labelText = (moves, won) => (won ? 'Solved: ' : 'Moves:  ') + String(moves).padStart(4, ' ');
/** The permutation test: 16 cells holding 0 .. 15 once each. */
export const isPerm = (b) => b.length === 16 && [...b].sort((x, y) => x - y).every((v, i) => v === i);
/** Inversions of the tiles (the gap left out), reading the cells in order. */
export function inversions(b) { const t = b.filter((v) => v); let n = 0; for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) n++; return n; }
/** Reachable from the solved board by legal moves (4 x 4: inversions + the gap's row from the top is odd, as the solved board's 0 + 3). */
export const solvable = (b) => isPerm(b) && (inversions(b) + (b.indexOf(0) >> 2)) % 2 === 1;
export const isSolved = (b) => b.every((v, i) => v === SOLVED[i]);

export class Game {
  constructor(b = SOLVED, moves = 0, won = false) { this.b = Array.from(b); this.mv = moves; this.won = won; }
  get gap() { return this.b.indexOf(0); }
  clone() { return new Game(this.b, this.mv, this.won); }
  /** A press on cell c: the run between it and the gap slides toward the gap.  Returns true when something moved. */
  press(c) {
    if (this.won) return false;
    const g = this.gap;
    if (c === g) return false;
    let step;
    if ((c >> 2) === (g >> 2)) step = c > g ? 1 : -1;
    else if ((c & 3) === (g & 3)) step = c > g ? 4 : -4;
    else return false;
    for (let k = g; k !== c; k += step) this.b[k] = this.b[k + step];
    this.b[c] = 0;
    this.mv++;
    if (isSolved(this.b)) this.won = true;
    return true;
  }
  /** The cell whose tile an arrow key slides (null at the border): Left: the tile on the gap's right, ... */
  keyCell(code) {
    const g = this.gap;
    if (code === KEY.LEFT) return (g & 3) < 3 ? g + 1 : null;
    if (code === KEY.RIGHT) return (g & 3) > 0 ? g - 1 : null;
    if (code === KEY.DOWN) return g >= 4 ? g - 4 : null;
    if (code === KEY.UP) return g < 12 ? g + 4 : null;
    return undefined;
  }
  key(code) { const c = this.keyCell(code); return c == null ? false : this.press(c); }
  get label() { return labelText(this.mv, this.won); }
}
/** The solved board with the gap brought to cell `g` by legal moves (a fixed path), as a board array. */
export function boardWithGap(g) {
  const game = new Game();
  // the gap starts at 15: move it left along the bottom row, then up the columns as needed
  const gc = g & 3, gr = g >> 2;
  game.press(15 - (3 - gc)); game.mv = 0; game.won = false;       // the gap to column gc in the bottom row
  for (let r = 3; r > gr; r--) { game.press(game.gap - 4); }
  game.mv = 0; game.won = false;
  return game.b;
}

/** The cell's rectangle in the board's coordinates. */
export const cellRect = (i, dx = 0, dy = 0) => ({ x: BOARD.x + dx + CELL_W * (i & 3), y: BOARD.y + dy + CELL_H * (i >> 2), w: CELL_W, h: CELL_H });

/** One tile (docs: the 62 x 30 frame, the bold number). */
export function tileLook(g, i, tile, dx = 0, dy = 0) {
  if (!tile) return;
  const r = cellRect(i, dx, dy), codes = codesOf(String(tile));
  g.setOp(OP_SET);
  g.frame(r.x + 1, r.y + 1, 62, 30);
  const x = r.x + 32 - 3 * codes.length, y = r.y + 12;   // centred by the digit count (PUZZLE 6): x + 32 - 3 n
  g.textp(x, y, codes);
  g.textp(x + 1, y, codes);
}

/**
 * The whole screen with the Puzzle window: st = { board (16 cells), label (the 12 characters), dx, dy (the window's move from home), active, btnFocus }.  The Puzzle sets no menus, so the bar is empty.
 */
export function renderScreen(st) {
  const g = new Gfx6Model(), dx = st.dx || 0, dy = st.dy || 0, active = st.active ?? true;
  deskLook(g); barLook(g, null, null);
  macWindowLook(g, { x: WIN.x + dx, y: WIN.y + dy, w: WIN.w, h: WIN.h, title: { codes: codesOf(WIN.title) } }, active);
  st.board.forEach((t, i) => tileLook(g, i, t, dx, dy));
  labelLook(g, { x: LABEL.x + dx, y: LABEL.y + dy, w: LABEL.w, h: LABEL.h, flags: 0, text: { codes: codesOf(st.label) } });
  buttonLook(g, { x: BUTTON.x + dx, y: BUTTON.y + dy, w: BUTTON.w, h: BUTTON.h, flags: BUTTON.flags, text: { codes: codesOf(BUTTON.text) } }, !!st.btnFocus);
  if (active) closeBoxLook(g, WIN.x + dx, WIN.y + dy, false);
  return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) {
  let bad = 0;
  const eq = (name, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`}`); };
  eq('labels', [labelText(0, false), labelText(9, false), labelText(10, false), labelText(99, false), labelText(1000, false), labelText(1234, true)],
    ['Moves:     0', 'Moves:     9', 'Moves:    10', 'Moves:    99', 'Moves:  1000', 'Solved: 1234']);
  eq('the solved board is solvable, the swap of 14 and 15 is not', [solvable(SOLVED), solvable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 15, 14, 0])], [true, false]);
  { const g = new Game(); eq('a press on the gap or off its lines', [g.press(15), g.press(0), g.press(5)], [false, false, false]);
    eq('slide one: press 14 (tile 15 moves right)', [g.press(14), g.b.slice(12).join(), g.gap, g.mv], [true, '13,14,0,15', 14, 1]);
    eq('the run: press 12 slides 13 and 14 right', [g.press(12), g.b.slice(12).join(), g.gap, g.mv], [true, '0,13,14,15', 12, 2]);
    eq('Left: the tile on the gap\'s right (13) slides left', [g.key(KEY.LEFT), g.b.slice(12).join(), g.gap], [true, '13,0,14,15', 13]);
    eq('Right: the tile on the gap\'s left slides right', [g.key(KEY.RIGHT), g.b.slice(12).join(), g.gap], [true, '0,13,14,15', 12]);
    eq('Right at column 0 does nothing; Down: the tile above (9) slides down', [g.key(KEY.RIGHT), g.key(KEY.DOWN), g.b.slice(8).join()], [false, true, '0,10,11,12,9,13,14,15']);
    eq('Up slides the tile below the gap (9) back up', [g.key(KEY.UP), g.b.slice(8).join()], [true, '9,10,11,12,0,13,14,15']); }
  { const g = new Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15]); eq('the last tile wins', [g.press(15), g.won, g.mv, g.label], [true, true, 1, 'Solved:    1']); eq('after the win nothing moves', [g.press(11), g.key(KEY.DOWN)], [false, false]); }
  for (let g = 0; g < 16; g++) { const b = boardWithGap(g); if (b.indexOf(0) !== g || !solvable(b)) { bad++; console.log(`FAIL boardWithGap(${g}) ${b}`); } }
  console.log(bad ? `pz-model self-test: ${bad} FAILED` : 'pz-model self-test: all ok');
  if (bad) process.exitCode = 1;
}
