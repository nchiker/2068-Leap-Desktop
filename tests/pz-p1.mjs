"use strict";
// pz-p1.mjs -- the 15-tile Puzzle (program 5, docs/PUZZLE.md; the first K-resident program, docs/SPACE_PLAN.md) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/PUZZLE.md and the description of src/apps/puzzle.asm (the symbol names come from out.sym).  The reference is tests/pz-model.mjs (the game, the label, the screen on gfx6-model);
// the harness is tests/pz-lib.mjs (on tests/shell-lib.mjs and tests/calc-lib.mjs).  A New game deals at random (an LFSR seeded from V_FRAMES), so the deal is judged by invariants (a permutation of
// 0 .. 15, reachable from the solved board: inversions + the gap's row odd; moves 0); every other state is poked into the machine's variables and drawn (the window dragged to another cell position and
// so repainted from them), and the actions run through the real input (the mouse, the keyboard) against the model.
//   node tests/pz-p1.mjs [--seed N] [--nwalk N] [--ndeal N] [--only LIST] [--verbose]
//     --nwalk N   random scenarios in group 3b (default 24)       --ndeal N   deals judged in group 6 (default 50)
//     --only LIST groups: 1 launch (Leap menu, icon), 2 screen at home and at other cell positions, 3 moves, 4 the counter, 5 the arrow keys, 6 New game (N, n, the button) and the deals,
//                 7 the win and its sound, 8 quit (SS+Q, the close box) and relaunch, 10 bounds (default all)
// The last line is "pz-p1: N of M groups pass"; exit code 1 on any failure (a timing row over its bound is a failure: MISSED, with the figure).
import { checks } from './lib.mjs';
import * as P from './pz-lib.mjs';
import * as KL from './kc-lib.mjs';
import { explain, fmt, dataOf } from './snd-lib.mjs';

const { L, H, Z, hex, rd16 } = P;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NWALK = argNum('--nwalk', 24), NDEAL = argNum('--ndeal', 50);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 10];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const C = checks('pz-p1');
const SET = 10;                                          // frames after a press or key before the machine is read (a run of 3 repaints in about 5)
console.log(`seed ${SEED} (rerun with --seed ${SEED}); random scenarios ${NWALK}, deals ${NDEAL}`);

const groupsOk = [];
class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.notes = []; }
  ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 40 : 6)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  note(s) { if (!this.notes.includes(s) && this.notes.length < (VERBOSE ? 60 : 10)) this.notes.push(s); }
  end(extra = '') {
    groupsOk.push(this.nf === 0);
    C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : '');
    for (const s of this.notes) console.log(`  note: ${s}`);
  }
}
const fmtN = (n) => (typeof n === 'number' ? n.toLocaleString('en') : String(n));
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  C.check(`${name}: measured ${fmtN(measured)}, bound ${bound === null ? 'report' : '<= ' + fmtN(bound)}${status === 'MISSED' ? ' -- MISSED' : ''}${note ? ' (' + note + ')' : ''}`, status !== 'MISSED');
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Boards
const KEYS = { LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11 };
/** A random reachable board: `steps` random legal presses from the solved board (the model's own moves); moves 0, not won. */
function randGame(steps = 70) {
  for (;;) {
    const g = new Z.Game();
    for (let i = 0; i < steps; i++) { const gap = g.gap, opts = []; for (let c = 0; c < 16; c++) if (c !== gap && ((c >> 2) === (gap >> 2) || (c & 3) === (gap & 3))) opts.push(c); g.press(rng.pick(opts)); }
    g.mv = 0; g.won = false;
    if (!Z.isSolved(g.b)) return g;
  }
}
/** A random reachable board with the gap at cell `g`. */
function gameGapAt(g) {
  for (;;) {
    const game = randGame();
    if ((game.gap & 3) !== (g & 3)) game.press((game.gap & ~3) + (g & 3));        // the gap along its row to the column
    if (game.gap !== g) game.press(g);                                           // then along the column
    game.mv = 0; game.won = false;
    if (game.gap === g && !Z.isSolved(game.b)) return game;
  }
}
const withMoves = (game, n) => { game.mv = n; return game; };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers: an action through the real input, the same on the model
const press = (c) => ({ t: 'press', c });
const keyA = (k) => ({ t: 'key', k });
const nameOf = (a) => (a.t === 'press' ? `press cell ${a.c}` : `key ${({ 8: 'LEFT', 9: 'RIGHT', 10: 'DOWN', 11: 'UP' })[a.k] || a.k}`);
function doAction(env, a) { if (a.t === 'press') P.pressCell(env, a.c, 3, SET); else P.key(env, a.k, SET); }
function applyModel(game, a) { return a.t === 'press' ? game.press(a.c) : game.key(a.k); }
/** One action: the machine does it, the model does it; the state (cells, gap, won, moves, label) and the screen against the model.  Returns whether it moved. */
function step(env, sec, tag, game, a, { screen = true } = {}) {
  const moved = applyModel(game, a);
  doAction(env, a);
  const d = P.stateDiff(env, game);
  sec.ok(d === null, () => `${tag}: ${nameOf(a)}: ${d}`);
  if (screen) { const sd = P.pzDiff(env); sec.ok(sd === null, () => `${tag}: ${nameOf(a)}: screen: ${sd}`); }
  return moved;
}
/** A set-up board drawn by the machine (checks that it shows what was poked). */
function setup(env, sec, tag, game, nx = null, ny = null) {
  const w = P.setBoard(env, game, nx, ny);
  const d = P.stateDiff(env, game); sec.ok(d === null, () => `${tag}: after the set-up: ${d}`);
  const sd = P.pzDiff(env); sec.ok(sd === null, () => `${tag}: the set-up board drawn: ${sd}`);
  return w;
}
const watchesOk = (env, sec, tag) => { sec.ok(env.w.n === 0, () => `${tag}: memory watch: ${env.w.summary()}`); };

/** A machine with the Puzzle running (the AY write log on: a move makes no sound, the win does). */
function mkPuzzle(opts = {}) {
  const env = P.bootPuzzle({ ay: true, ...opts });
  env.game = new Z.Game(P.readState(env).b);
  return env;
}
const envs = [];

// ===========================================================================================================================
// 1. Launch: the Leap menu (row 7) and a double click on the fifth icon
function launchChecks(env, sec, how) {
  const { m, S } = env, v = P.readViews(env);
  sec.ok(m.ram[S.K_PROG] === 5, () => `${how}: K_PROG ${m.ram[S.K_PROG]}, want 5`);
  // the K-resident start: PZ_START is in the pool (chunks 0-1 or 4-5), K_PROGS[5] points to it, and its first instruction ran under mapping K ($33) with the shadow equal to the port
  const kp = env.load.mem[S.K_PROGS + 10] | (env.load.mem[S.K_PROGS + 11] << 8);
  sec.ok(kp === S.PZ_START, () => `${how}: K_PROGS entry 5 ${hex(kp)}, want PZ_START ${hex(S.PZ_START)}`);
  sec.ok((S.PZ_START < 0x4000 || (S.PZ_START >= 0x8000 && S.PZ_START < 0xC000)), () => `${how}: PZ_START ${hex(S.PZ_START)} is not in the always-mapped chunks`);
  const e = env.entry;
  sec.ok(e.n === 1 && e.kprog === 5, () => `${how}: PZ_START's first instruction ran ${e.n} time(s), K_PROG then ${e.kprog}`);
  sec.ok(e.shadowF4 === 0x33 && e.portF4 === 0x33, () => `${how}: at PZ_START the mapping shadow ${hex(e.shadowF4, 2)} and the port ${hex(e.portF4, 2)}, want $33 (K)`);
  sec.ok(e.sp > 0xFE00 && e.sp <= 0xFF00, () => `${how}: SP at PZ_START ${hex(e.sp)}`);
  sec.note(`${how}: first instruction under $F4 shadow ${hex(e.shadowF4, 2)}, port ${hex(e.portF4, 2)}, $FF shadow ${hex(e.shadowFF, 2)}, SP ${hex(e.sp)}`);
  // the window and the three views
  const w = v && v.win;
  sec.ok(!!w && w.cls === S.CL_CWindow && [w.x, w.y, w.w, w.h].join() === '64,24,400,160' && w.id === 255 && w.title === 'Puzzle', () => `${how}: the window ${w && JSON.stringify([hex(w.cls), w.x, w.y, w.w, w.h, w.id, w.title])}`);
  sec.ok(!!v && v.kids.length === 3, () => `${how}: ${v && v.kids.length} views in the window, want 3`);
  if (v && v.kids.length === 3) {
    const [b, l, bt] = v.kids;
    sec.ok(b.cls === S.CL_Board && [b.x, b.y, b.w, b.h, b.id].join() === '80,48,256,128,1', () => `${how}: board view ${JSON.stringify([hex(b.cls), b.x, b.y, b.w, b.h, b.id])}, want (80, 48, 256, 128) id 1`);
    sec.ok(l.cls === S.CL_Label && [l.x, l.y, l.w, l.h, l.id].join() === '352,56,96,9,3', () => `${how}: label ${JSON.stringify([hex(l.cls), l.x, l.y, l.w, l.h, l.id])}, want (352, 56, 96, 9) id 3`);
    sec.ok(bt.cls === S.CL_Button && [bt.x, bt.y, bt.w, bt.h, bt.id, bt.flags].join() === '352,96,96,16,2,17' && H.readStrText(m, rd16(m, bt.a + S.Button_text)) === 'New game', () => `${how}: button ${JSON.stringify([hex(bt.cls), bt.x, bt.y, bt.w, bt.h, bt.id, bt.flags])} "${H.readStrText(m, rd16(m, bt.a + S.Button_text))}"`);
    sec.ok(rd16(m, S.PZ_BV) === b.a && rd16(m, S.PZ_LV) === l.a && rd16(m, S.PZ_WIN) === w.a, () => `${how}: PZ_BV / PZ_LV / PZ_WIN do not point at the views`);
    sec.ok(rd16(m, S.K_FOCUS) === bt.a, () => `${how}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, want the button ${hex(bt.a)}`);
  }
  // the dealt game
  const st = P.readState(env);
  sec.ok(Z.isPerm(st.b) && Z.solvable(st.b) && st.g === st.b.indexOf(0), () => `${how}: the dealt board ${st.b.join(',')} (gap ${st.g}) is not a solvable permutation`);
  sec.ok(st.mv === 0 && st.won === 0 && st.lbl === 'Moves:     0', () => `${how}: moves ${st.mv}, won ${st.won}, label "${st.lbl}"`);
  sec.ok(!Z.isSolved(st.b), () => `${how}: the first deal is the solved board`);
  const d = P.pzDiff(env); sec.ok(d === null, () => `${how}: the screen against the model: ${d}`);
  // the mapping stays K while it runs idle: sampled at the end of 20 frames
  let bad = 0; for (let i = 0; i < 20; i++) { env.frame(); if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) bad++; }
  sec.ok(bad === 0, () => `${how}: the mapping was not K ($33) at ${bad} of 20 frame ends`);
  return st;
}
function g1() {
  const sec = new Sec('1 launch: the Leap menu (row 7, "Puzzle") and a double click on the fifth icon: K_PROG 5, K_PROGS[5] = PZ_START in the pool, the first instruction under mapping K, the CWindow (64, 24, 400, 160) "Puzzle" id 255 with the board (80, 48, 256, 128), the label (352, 56, 96, 9) and the "New game" Button (352, 96, 96, 16); a dealt solvable game, moves 0; the screen equals the model');
  const e1 = mkPuzzle({ how: 'menu' }); envs.push(['1 menu', e1]); e1.game = new Z.Game(launchChecks(e1, sec, 'Leap menu row 7').b);
  const e2 = mkPuzzle({ how: 'icon' }); envs.push(['1 icon', e2]); launchChecks(e2, sec, 'double click on icon 5');
  const b1 = P.readState(e1).b.join(), b2 = P.readState(e2).b.join();
  sec.note(`the two machines' first deals: ${b1} / ${b2}`);
  sec.end(`the deals ${b1 === b2 ? 'were equal' : 'differ'}`);
  return e1;
}

// ===========================================================================================================================
// 2. The screen at home and with the window dragged to other cell positions (whole cells: x a multiple of 16, y of 8)
function g2(env) {
  const { m, S } = env;
  const sec = new Sec('2 the screen against the model at home and with the window dragged by its title bar to (112, 32), (0, 8), (16, 16), (48, 8), (96, 24) and home (64, 24): the views follow (board, label, button at home + the offset), the board repainted from the board view\'s origin; then a move at the new position');
  const home = Z.WIN;
  const game = randGame(); withMoves(game, 7);
  setup(env, sec, 'home, a set-up board', game, 80, 32); // (a drag already: home is visited at the end)
  for (const [nx, ny] of [[112, 32], [0, 8], [16, 16], [48, 8], [96, 24], [64, 24]]) {
    const w = P.dragTo(env, nx, ny), tag = `window at (${nx}, ${ny})`;
    if (!sec.ok(w.x === nx && w.y === ny, () => `${tag}: the drag put the window at (${w.x}, ${w.y})`)) continue;
    P.park(env);
    const v = P.readViews(env), dx = nx - home.x, dy = ny - home.y;
    sec.ok(v.kids.length === 3 && [v.board.x, v.board.y, v.board.w, v.board.h].join() === [Z.BOARD.x + dx, Z.BOARD.y + dy, 256, 128].join() && [v.label.x, v.label.y, v.label.w, v.label.h].join() === [Z.LABEL.x + dx, Z.LABEL.y + dy, 96, 9].join() &&
      [v.button.x, v.button.y, v.button.w, v.button.h].join() === [Z.BUTTON.x + dx, Z.BUTTON.y + dy, 96, 16].join(), () => `${tag}: the views did not move with the window: ${JSON.stringify(v.kids.map((k) => [k.x, k.y, k.w, k.h]))}`);
    const d = P.stateDiff(env, game); sec.ok(d === null, () => `${tag}: the game changed by the drag: ${d}`);
    const sd = P.pzDiff(env); sec.ok(sd === null, () => `${tag}: screen: ${sd}`);
    // a move at the moved position: the first press that moves a tile, then a key
    const gap = game.gap, cand = [gap - 1, gap + 1, gap - 4, gap + 4].filter((c) => c >= 0 && c < 16 && (((c >> 2) === (gap >> 2)) || ((c & 3) === (gap & 3))) && Math.abs(c - gap) !== 3 && Math.abs(c - gap) !== 5);
    step(env, sec, tag, game, press(rng.pick(cand)));
    step(env, sec, tag, game, keyA(rng.pick([8, 9, 10, 11])));
    P.park(env);
    const sd2 = P.pzDiff(env); sec.ok(sd2 === null, () => `${tag}: after the moves, parked: ${sd2}`);
  }
  watchesOk(env, sec, 'group 2');
  sec.end('6 positions, a move and a key at each');
}

// ===========================================================================================================================
// 3. Moves: every cell pressed from every gap position (singles and runs in all four directions, presses that do nothing), each undone by the press on the old gap; then random scenarios
function g3(env) {
  const { m, S } = env;
  const sec = new Sec('3 moves: with the gap at each of the 16 cells every other cell is pressed: a tile in the gap\'s row or column slides the run between it and the gap one cell toward it (moves + 1), a press elsewhere or on the gap does nothing, and the press on the old gap cell undoes a slide; every step against the model (cells, gap, moves, label, screen); then random scenarios of presses and arrow keys at other window positions; no sound');
  const dat0 = env.log.dat.length;
  const stat = { single: 0, run2: 0, run3: 0, none: 0, dir: { left: 0, right: 0, up: 0, down: 0 } };
  for (let g = 0; g < 16; g++) {
    const game = withMoves(gameGapAt(g), rng.int(0, 40));
    setup(env, sec, `gap ${g}`, game);
    for (let c = 0; c < 16 && sec.nf < 12; c++) {
      if (c === g) { step(env, sec, `gap ${g}`, game, press(c), { screen: c % 5 === 0 }); stat.none++; continue; }
      const before = game.gap, moved = step(env, sec, `gap ${g}`, game, press(c));
      if (!moved) { stat.none++; continue; }
      const k = Math.abs(c - before) / ((c >> 2) === (before >> 2) ? 1 : 4);
      stat[k === 1 ? 'single' : k === 2 ? 'run2' : 'run3']++;
      stat.dir[(c >> 2) === (before >> 2) ? (c > before ? 'right' : 'left') : (c > before ? 'down' : 'up')]++;
      step(env, sec, `gap ${g}, undo`, game, press(before), { screen: false });          // the press on the old gap cell slides the run back
      sec.ok(game.gap === before, () => `gap ${g}: the undo did not bring the gap back`);
    }
  }
  sec.ok(stat.single > 0 && stat.run2 > 0 && stat.run3 > 0 && Object.values(stat.dir).every((n) => n > 0), () => `coverage: ${JSON.stringify(stat)}`);
  // ---- 3b random scenarios
  const POS = [[64, 24], [112, 32], [0, 8], [16, 16], [48, 8], [96, 24]];
  let acts = 0, moves = 0;
  for (let s = 0; s < NWALK && sec.nf < 12; s++) {
    const game = withMoves(randGame(), rng.int(0, 200));
    const [nx, ny] = POS[s % POS.length];
    setup(env, sec, `scenario ${s}`, game, nx, ny);
    for (let i = 0; i < 10; i++) {
      const gap = game.gap, aligned = []; for (let c = 0; c < 16; c++) if (c !== gap && ((c >> 2) === (gap >> 2) || (c & 3) === (gap & 3))) aligned.push(c);
      const off = []; for (let c = 0; c < 16; c++) if (c !== gap && !aligned.includes(c)) off.push(c);
      let a;
      if (rng.chance(0.15)) a = press(rng.pick(off)); else if (rng.chance(0.08)) a = press(gap); else if (rng.chance(0.3)) a = keyA(rng.pick([8, 9, 10, 11])); else a = press(rng.pick(aligned));
      if (step(env, sec, `scenario ${s} at (${nx}, ${ny})`, game, a)) moves++;
      acts++;
    }
  }
  sec.ok(env.log.dat.length === dat0, () => `${env.log.dat.length - dat0} AY data write(s) during the moves (no move makes a sound: ${fmt(dataOf(env.log, dat0)).slice(0, 120)})`);
  watchesOk(env, sec, 'group 3');
  sec.end(`${stat.single} single slides, ${stat.run2} runs of 2, ${stat.run3} runs of 3 (left ${stat.dir.left}, right ${stat.dir.right}, up ${stat.dir.up}, down ${stat.dir.down}), ${stat.none} presses that do nothing; ${acts} scenario actions (${moves} moved)`);
}

// ===========================================================================================================================
// 4. The counter and its label
function g4(env) {
  const { m, S } = env;
  const sec = new Sec('4 the counter: the label "Moves:  n" (12 characters: the 8-character prefix, the moves in 4 with leading zeros blanked) after a move at n = 1, 9, 10, 11, 99, 100, 999, 1000, 1234, 9999 (the count poked to n - 1), by a press and by a key; the label view repaints');
  for (const n of [1, 2, 9, 10, 11, 99, 100, 999, 1000, 1234, 9999]) {
    const game = withMoves(gameGapAt(rng.int(0, 15)), n - 1);
    setup(env, sec, `moves ${n - 1}`, game, ...(n % 2 ? [80, 32] : [64, 24]));
    const gap = game.gap, c = [gap - 1, gap + 1, gap - 4, gap + 4].filter((x) => x >= 0 && x < 16 && Math.abs(x - gap) !== 3 && Math.abs(x - gap) !== 5 && (((x >> 2) === (gap >> 2)) || ((x & 3) === (gap & 3))));
    const a = n % 3 === 0 ? keyA(game.keyCell(8) !== null ? 8 : 9) : press(rng.pick(c));
    step(env, sec, `n = ${n}`, game, a);
    sec.ok(game.mv === n, () => `n = ${n}: the model counts ${game.mv}`);
    const st = P.readState(env), want = `Moves:${' '.repeat(12 - 6 - String(n).length)}${n}`;
    sec.ok(st.lbl === want && st.lbl.length === 12 && m.ram[S.PZ_LBL] === 12, () => `n = ${n}: the label "${st.lbl}" (length byte ${m.ram[S.PZ_LBL]}), want "${want}"`);
  }
  // a count that carries over a decade: 9 -> 10 through two moves in a row by the keys
  const g = withMoves(gameGapAt(5), 8); setup(env, sec, 'carry', g);
  step(env, sec, 'carry 8 -> 9', g, keyA(8)); step(env, sec, 'carry 9 -> 10', g, keyA(9));
  watchesOk(env, sec, 'group 4');
  sec.end('11 counts + a carry');
}

// ===========================================================================================================================
// 5. The arrow keys at every gap position, the borders included; other keys do nothing
function g5(env) {
  const { m, S } = env;
  const sec = new Sec('5 the arrow keys: with the gap at each of the 16 cells Left (the tile on the gap\'s right slides left), Right (the one on its left), Down (the one above it) and Up (the one below it): a slide where the neighbour exists, nothing at the border (state and screen unchanged); each slide undone by the opposite key; other keys (letters, digits) do nothing');
  const stat = { slid: 0, border: 0 };
  const OPP = { 8: 9, 9: 8, 10: 11, 11: 10 };
  for (let g = 0; g < 16; g++) {
    const game = withMoves(gameGapAt(g), rng.int(0, 30));
    setup(env, sec, `gap ${g}`, game);
    for (const k of [8, 9, 10, 11]) {
      const moved = step(env, sec, `gap ${g}`, game, keyA(k));
      if (moved) { stat.slid++; step(env, sec, `gap ${g}, undo`, game, keyA(OPP[k]), { screen: false }); } else stat.border++;
    }
    if (g % 5 === 0) for (const k of [97, 120, 53, 48]) step(env, sec, `gap ${g}`, game, keyA(k));      // a, x, 5, 0: ignored
  }
  sec.ok(stat.slid === 48 && stat.border === 16, () => `coverage: ${stat.slid} slides, ${stat.border} border presses, want 48 and 16 (each of the 4 keys is at a border at 4 of the 16 gap positions)`);
  watchesOk(env, sec, 'group 5');
  sec.end(`${stat.slid} slides, ${stat.border} border presses, 16 other keys`);
}

// ===========================================================================================================================
// 6. New game: the keys N and n, the button; the deal judged by invariants over NDEAL deals
function dealOk(env, sec, tag, st) {
  const ok = Z.isPerm(st.b) && Z.solvable(st.b) && st.g === st.b.indexOf(0) && st.mv === 0 && st.won === 0 && st.lbl === 'Moves:     0';
  sec.ok(ok, () => `${tag}: after the deal: board ${st.b.join(',')} gap ${st.g} moves ${st.mv} won ${st.won} label "${st.lbl}" (perm ${Z.isPerm(st.b)}, solvable ${Z.isPerm(st.b) && Z.solvable(st.b)})`);
  return ok;
}
function g6(env) {
  const { m, S } = env;
  const sec = new Sec(`6 New game: the keys N and n and the button deal again (a permutation of 0 .. 15 reachable from the solved board, moves 0, label "Moves:     0", won cleared, the screen repainted) from a played, a won and a fresh board; ${NDEAL} deals in a row judged by the inversion parity, the deals differ`);
  const bv = () => P.readViews(env).button;
  const clickButton = () => { const b = bv(); L.click(env, b.x + 48, b.y + 8, 3, 18); };
  // from a played board (a moves count and a gap elsewhere), by each trigger
  for (const [how, go] of [['N', () => P.key(env, 78, 16)], ['n', () => P.key(env, 110, 16)], ['the button', clickButton]]) {
    const game = withMoves(randGame(), 57);
    setup(env, sec, `${how}: a played board`, game);
    go(); P.park(env); env.frames_(6);
    const st = P.readState(env);
    dealOk(env, sec, how, st);
    sec.ok(st.b.join() !== game.b.join(), () => `${how}: the board did not change`);
    const d = P.pzDiff(env); sec.ok(d === null, () => `${how}: screen: ${d}`);
    env.game = new Z.Game(st.b);
    // a move after the deal counts from 0
    const g2 = env.game, gap = g2.gap, c = [gap - 1, gap + 1, gap - 4, gap + 4].filter((x) => x >= 0 && x < 16 && Math.abs(x - gap) !== 3 && Math.abs(x - gap) !== 5 && (((x >> 2) === (gap >> 2)) || ((x & 3) === (gap & 3))));
    step(env, sec, `${how}: the first move after the deal`, g2, press(rng.pick(c)));
  }
  // from a won board: the deal clears PZ_WON (the presses work again)
  { const game = new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0], 33, true);
    setup(env, sec, 'won board', game);
    P.key(env, 78, 16); P.park(env); env.frames_(6);
    const st = P.readState(env); dealOk(env, sec, 'N after a win', st);
    const d = P.pzDiff(env); sec.ok(d === null, () => `N after a win: screen: ${d}`);
    env.game = new Z.Game(st.b); const gap = env.game.gap;
    step(env, sec, 'a press after the deal that followed a win', env.game, press(gap + ((gap & 3) < 3 ? 1 : -1))); }
  // the deals in a row
  const seen = new Set(); let unsolved = 0, par = 0;
  for (let i = 0; i < NDEAL && sec.nf < 10; i++) {
    P.key(env, i & 1 ? 110 : 78, 14);
    const st = P.readState(env);
    if (dealOk(env, sec, `deal ${i}`, st)) par++;
    seen.add(st.b.join()); if (!Z.isSolved(st.b)) unsolved++;
    if (i % 10 === 9) { P.park(env); const d = P.pzDiff(env); sec.ok(d === null, () => `deal ${i}: screen: ${d}`); }
  }
  sec.ok(seen.size >= NDEAL - 2, () => `${seen.size} different boards in ${NDEAL} deals`);
  sec.ok(unsolved === NDEAL, () => `${NDEAL - unsolved} of ${NDEAL} deals gave the solved board`);
  watchesOk(env, sec, 'group 6');
  sec.end(`${par} of ${NDEAL} deals pass the invariants (${seen.size} different boards)`);
}

// ===========================================================================================================================
// 7. The win and its sound
function g7(env) {
  const { m, S } = env, log = env.log;
  const sec = new Sec('7 the win: the last move (a single tile, a run, a vertical run, by a press and by a key) makes PZ_WON 1 and the label "Solved: n"; the win sound (K_BEEP id 5: the table\'s 5, 7, 8, 9 chain) is written on the AY once; after it presses and keys do nothing (state and screen unchanged, no sound); New game plays again');
  const cases = [
    ['a single tile by a press', () => new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15], 41), press(15)],
    ['a single tile by the Left key', () => new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15], 9), keyA(8)],
    ['a run of 2 by a press', () => new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 0, 14, 15], 1000), press(15)],
    ['a vertical run of 2 by a press', () => new Z.Game([1, 2, 3, 4, 5, 6, 7, 0, 9, 10, 11, 8, 13, 14, 15, 12], 12), press(15)],
    ['a vertical tile by the Up key', () => new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 13, 14, 15, 12], 99), keyA(11)],
  ];
  for (const [what, mk, a] of cases) {
    const game = mk();
    if (!sec.ok(!Z.isSolved(game.b) && Z.solvable(game.b), () => `${what}: the set-up board is not a reachable unsolved board`)) continue;
    setup(env, sec, what, game);
    const i0 = log.dat.length, f0 = env.frames;
    const won = step(env, sec, what, game, a);
    sec.ok(won && game.won, () => `${what}: the model did not win`);
    const st = P.readState(env);
    sec.ok(st.won === 1 && st.lbl === Z.labelText(game.mv, true) && st.lbl.startsWith('Solved: '), () => `${what}: PZ_WON ${st.won}, label "${st.lbl}"`);
    env.frames_(30);
    const errs = explain(log, i0, [5], env.frames, true);
    sec.ok(errs.length === 0 && log.dat.length > i0, () => `${what}: the AY writes ${fmt(dataOf(log, i0)).slice(0, 200)} are not the win sound: ${errs.join('; ')}`);
    const wr = dataOf(log, i0);
    sec.ok(wr.filter((e) => e.reg === 7).length === 4 && wr[0].f > f0, () => `${what}: the sound chain 5, 7, 8, 9 has four starts (mixer writes): ${wr.filter((e) => e.reg === 7).length} in ${wr.length} writes, first at frame ${wr[0] && wr[0].f} (the move was in frame ${f0 + 1})`);
    // after the win: presses and keys do nothing, silently
    const i1 = log.dat.length;
    for (const b of [press(game.gap === 0 ? 1 : 0), press(15 === game.gap ? 14 : 15), press(14), keyA(8), keyA(10), keyA(9), keyA(11)]) step(env, sec, `${what}: after the win`, game, b);
    sec.ok(log.dat.length === i1, () => `${what}: sound after the win: ${log.dat.length - i1} write(s)`);
    sec.ok(P.readState(env).won === 1, () => `${what}: PZ_WON cleared by a press`);
    // New game: the button plays the game again
    P.key(env, 78, 16); P.park(env); env.frames_(6);
    const st2 = P.readState(env); dealOk(env, sec, `${what}: New game`, st2);
    env.game = new Z.Game(st2.b);
    const g2 = env.game, gap = g2.gap;
    step(env, sec, `${what}: a press after New game`, g2, press(gap + ((gap & 3) < 3 ? 1 : -1)));
  }
  watchesOk(env, sec, 'group 7');
  sec.end(`${cases.length} wins with the sound judged against the sound table`);
}

// ===========================================================================================================================
// 8. Quit by SS+Q and by the close box; the shell is as it was; the program starts again fresh
function g8() {
  const sec = new Sec('8 quit: SYMBOL SHIFT + Q and the close box return to the open shell (K_PROG 0, the shell window, the five icons, the arena top, K_FOCUS, the screen as before the launch), after a fresh start, after moves and after a win; the Puzzle starts again from the shell, fresh (moves 0, a dealt board)');
  const out = [];
  for (const [how, quit] of [['SS+Q', (env) => L.quitBySSQ(env)], ['the close box', (env) => L.quitByCloseBox(env, 5)]]) {
    for (const when of ['fresh', 'played', 'won']) {
      const env = H.bootShell({ video: false }); const { m, S } = env;
      const base0 = H.captureState(env);
      H.leapMenu(env, 7);
      if (!sec.ok(L.waitProgram(env, 5, 160) >= 0, () => `${how}, ${when}: the Puzzle did not start`)) continue;
      env.frames_(12); L.moveTo(env, P.PARK[0], P.PARK[1]); env.frames_(4);
      P.armWatches(env);
      if (when !== 'fresh') {
        const game = when === 'won' ? new Z.Game([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0, 15], 5) : withMoves(randGame(), 12);
        P.setBoard(env, game, 64, 24);                       // drawn at home (the close box is where PROG_WIN has it)
        if (when === 'won') step(env, sec, `${how}, won`, game, press(15)); else step(env, sec, `${how}, played`, game, press(game.gap + ((game.gap & 3) < 3 ? 1 : -1)));
      }
      env.frames_(40);
      env.img.armed = false;                               // the shell's own image is copied to $C000 by the quit
      const ok = quit(env);
      sec.ok(ok && m.ram[S.K_PROG] === 0, () => `${how}, ${when}: the shell did not come back (K_PROG ${m.ram[S.K_PROG]})`);
      env.frames_(14);
      const cur = H.captureState(env), diffs = H.compareStates(env, base0, cur, `${how}, ${when}: back in the shell`);
      sec.ok(diffs.length === 0, () => diffs.slice(0, 3).join(' | '));
      sec.ok(L.progUp(env, 0) && H.shellDiff(env) === null, () => `${how}, ${when}: the shell's screen: ${H.shellDiff(env)}`);
      sec.ok(L.openWindows(m, S).length === 1, () => `${how}, ${when}: ${L.openWindows(m, S).length} windows after the quit`);
      // start it again: fresh
      H.leapMenu(env, 7);
      const up = L.waitProgram(env, 5, 160) >= 0;
      sec.ok(up, () => `${how}, ${when}: the Puzzle did not start again`);
      if (up) {
        env.frames_(12); L.moveTo(env, P.PARK[0], P.PARK[1]); env.frames_(4);
        const st = P.readState(env); dealOk(env, sec, `${how}, ${when}: relaunch`, st);
        const d = P.pzDiff(env); sec.ok(d === null, () => `${how}, ${when}: relaunch screen: ${d}`);
      }
      out.push([`8 ${how} ${when}`, env]);
    }
  }
  sec.end('SS+Q and the close box, each after a fresh start, moves and a win, each relaunched');
  for (const e of out) envs.push(e);
}

// ===========================================================================================================================
// 10. Bounds (docs/PUZZLE.md 2): the click to idle, in T-states from the interrupt that polls the press to the program's next HALT with the screen repainted
function timeAction(env, start, sec, what) {
  const { m } = env;
  const tr = KL.traceLoop(env);
  start();
  env.frames_(14);
  const ev = tr.stop();
  const isr0 = ev.find((e) => e.e === 'ISR');
  const halt = isr0 && ev.find((e) => e.e === 'HALT' && e.t > isr0.t);
  if (!isr0 || !halt) { sec.ok(false, () => `${what}: no ISR / HALT pair in the trace (${ev.length} events)`); return NaN; }
  return halt.t - isr0.t;
}
function g10(env) {
  const { m, S } = env;
  const sec = new Sec('10 bounds (PUZZLE 2): a one-tile move from the click to idle, a run of 3, New game with its redraw (the interrupt that polls the input to the next HALT); the screen after each equals the model; the stack, V_FRAMES, the image writes');
  const rows = [];
  const measure = (name, bound, mk, reps = 6) => {
    const ts = [];
    for (let r = 0; r < reps; r++) {
      const { game, a } = mk(r);
      setup(env, sec, `${name} #${r}`, game);
      toCell(a);
      const t = timeAction(env, pressAt, sec, name);
      ts.push(t);
      applyModel(game, a);
      const d = P.stateDiff(env, game), sd = P.pzDiff(env);
      sec.ok(d === null && sd === null, () => `${name} #${r}: state ${d}, screen ${sd}`);
    }
    rows.push([name, Math.max(...ts), bound, `worst of ${reps}: ${ts.map(fmtN).join(', ')}`]);
  };
  const toCell = (a) => { const [x, y] = P.cellCentre(env, a.c); L.moveTo(env, x, y); env.frames_(6); };         // the pointer is put on the cell before the trace starts
  const pressAt = () => { m.mouse.buttons = L.MOUSE_LEFT; env.frame(); env.frame(); m.mouse.buttons = L.MOUSE_UP; };
  // a one-tile move: different gap positions (corner, edge, middle), a neighbour in a row or a column
  const singles = [[0, 1], [5, 4], [10, 14], [15, 11], [3, 2], [12, 8]];
  measure('one-tile move: the click to idle', 100_000, (r) => { const [g, c] = singles[r % singles.length]; return { game: gameGapAt(g), a: press(c) }; });
  const runs = [[0, 3], [3, 0], [0, 12], [12, 0], [5, 7], [6, 14]];
  measure('run of 3 tiles: the click to idle', 250_000, (r) => { const [g, c] = runs[r % runs.length]; return { game: gameGapAt(g), a: press(c) }; });
  measure('run of 2 tiles: the click to idle (report)', null, (r) => { const [g, c] = [[0, 2], [15, 13], [3, 11], [8, 0]][r % 4]; return { game: gameGapAt(g), a: press(c) }; }, 4);
  // New game: the key N (its press frame), and the button (its release frame)
  { const ts = [];
    for (let r = 0; r < 6; r++) {
      const game = withMoves(randGame(), 30); setup(env, sec, `New game #${r}`, game);
      const t = timeAction(env, () => { L.setKeys(m, L.keysFor(78)); env.frame(); L.setKeys(m, []); }, sec, 'New game (N)');
      ts.push(t);
      const st = P.readState(env), d = P.pzDiff(env); dealOk(env, sec, `New game #${r}`, st); sec.ok(d === null, () => `New game #${r}: screen ${d}`);
    }
    rows.push(['New game by the N key with its redraw: the key\'s interrupt to idle', Math.max(...ts), 500_000, `worst of 6: ${ts.map(fmtN).join(', ')}`]); }
  { const ts = [];
    for (let r = 0; r < 6; r++) {
      const game = withMoves(randGame(), 30); setup(env, sec, `New game button #${r}`, game);
      const b = P.readViews(env).button; L.moveTo(env, b.x + 48, b.y + 8); env.frames_(6); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
      const t = timeAction(env, () => { m.mouse.buttons = L.MOUSE_UP; }, sec, 'New game (button)');
      ts.push(t);
      const st = P.readState(env), d = P.pzDiff(env); dealOk(env, sec, `New game button #${r}`, st); sec.ok(d === null, () => `New game button #${r}: screen ${d}`);
    }
    rows.push(['New game by the button with its redraw: the release\'s interrupt to idle', Math.max(...ts), 500_000, `worst of 6: ${ts.map(fmtN).join(', ')}`]); }
  const missed = [];
  for (const [name, v, bound, note] of rows) { row(name, v, bound, note); if (bound !== null && !(v <= bound)) missed.push(name); }
  sec.end(`${rows.length} timing rows${missed.length ? '; MISSED: ' + missed.length : ''}`);
}

// ===========================================================================================================================
const run = { 1: g1 };
let main = null;
for (const g of ONLY) {
  if (g === 1) { main = g1(); continue; }
  if (g === 8) { g8(); continue; }
  if (!main) { main = mkPuzzle({ how: 'menu' }); envs.push(['main', main]); }
  const fn = { 2: g2, 3: g3, 4: g4, 5: g5, 6: g6, 7: g7, 10: g10 }[g];
  fn(main);
}
if (main && !envs.some(([, e]) => e === main)) envs.push(['main', main]);
{
  const sec = new Sec('9 memory watch (BANKING 10.7), V_FRAMES +1 on every frame run normally (no DI held), the stack <= 128 bytes, no write to the RAM image ($C000 .. AL_RAM) outside PZ_B .. PZ_VEND, in every machine');
  for (const [name, e] of envs) {
    sec.ok(e.w.n === 0, () => `${name}: memory watch: ${e.w.summary()}`);
    sec.ok(e.vf.bad === 0, () => `${name}: V_FRAMES did not rise by 1 on ${e.vf.bad} frames, first ${e.vf.first}`);
    if (e.img) sec.ok(e.img.n === 0, () => `${name}: ${e.img.n} write(s) to the image outside ${hex(e.img.lo)}-${hex(e.img.hi - 1)}: ${e.img.first.join(' | ')}`);
    if (e.stack) { const d = e.stack.depth(); sec.ok(d <= 128, () => `${name}: stack depth ${d} bytes (writes down to ${hex(e.stack.min)})`); sec.note(`${name}: stack ${d} bytes, ${e.vf.checked} frames checked`); }
  }
  sec.end(`${envs.length} machines`);
}
C.done();
console.log(`pz-p1: ${groupsOk.filter(Boolean).length} of ${groupsOk.length} groups pass`);
