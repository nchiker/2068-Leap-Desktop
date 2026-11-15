"use strict";
// shell-s1.mjs -- the shell slice (docs/SHELL.md 1-10) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  Tests 1 and 2 of SHELL.md 8.
// Written from SHELL.md 7-10, TOOLKIT.md 9, CALCULATOR.md, WINDOWS.md (17) and BANKING.md 10.7; never from src/kernel/launch.asm, tk.asm or src/apps/*.asm.
// The reference is tests/shell-model.mjs; the harness is tests/shell-lib.mjs (on tests/calc-lib.mjs).
//   node tests/shell-s1.mjs [--seed N] [--nlaunch N] [--ncycles N] [--nshell N] [--nlook N] [--ntrack N] [--ndialog N] [--only LIST] [--verbose]
//     --nlaunch N   random launch / quit transitions in group 1 (default 120)
//     --ncycles N   exact launch / quit cycles in group 1b (default 50)
//     --nshell N    random shell actions in group 2 (default 200)
//     --nlook N     random window operations in group 3a (default 150)
//     --ntrack N    random close-box tracking scripts in group 3b (default 300)
//     --ndialog N   About dialog openings in group 4 (default 24)
//     --only LIST   groups: 1 launcher, 2 shell, 3 CWindow, 4 About, 5 SS+Q with the About dialog up, 6 memory watch / V_FRAMES, 7 SHELL 12 (close, Show Desktop) (default all)
// Exit code 1 on any failure.
import { checks } from './lib.mjs';
import * as H from './shell-lib.mjs';
import * as T from './tk-lib.mjs';
import * as LMOD from './look-model.mjs';
import { layoutOf } from './wm-model3.mjs';

const { L, SM, hex, rd16 } = H;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NLAUNCH = argNum('--nlaunch', 120), NCYCLES = argNum('--ncycles', 50), NSHELL = argNum('--nshell', 200), NLOOK = argNum('--nlook', 150), NTRACK = argNum('--ntrack', 300), NDIALOG = argNum('--ndialog', 24);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const C = checks('shell-s1');
console.log(`seed ${SEED} (rerun with --seed ${SEED}); launcher ${NLAUNCH} transitions + ${NCYCLES} cycles, shell ${NSHELL} actions, CWindow ${NLOOK} looks + ${NTRACK} close-box scripts, About ${NDIALOG} openings`);

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.notes = []; }
  ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 40 : 6)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  note(s) { if (!this.notes.includes(s) && this.notes.length < 8) this.notes.push(s); }
  end(extra = '') {
    C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : '');
    for (const s of this.notes) console.log(`  note: ${s}`);
  }
}
const envs = [];                                         // every machine built (for group 6)
const mkShell = () => { const e = H.bootShell(); envs.push(e); e.rng = rng; return e; };
const dig = (rows) => rows.slice(0, 3).join(' | ');

// ===========================================================================================================================
// Driving a program a little before it is left (the state must not survive: SHELL 1 "nothing of the last one is kept")
const CALC_KEYS = [48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 43, 45, 42, 47, 61, 46, 110, 12];
function dirty(env, p) {
  const { m } = env;
  if (p === 1) {
    for (let i = rng.int(1, 5); i > 0; i--) {
      if (rng.chance(0.5)) L.typeCode(env, rng.pick(CALC_KEYS));
      else { const b = rng.pick(L.BUTTONS), [cx, cy] = L.centre(b); L.click(env, cx, cy, 3, 4); }
    }
  } else if (p === 2) {
    const spots = [[100, 44], [200, 44], [350, 44], [100, 66], [300, 128], [300, 148]];   // Key Caps (KEYCAPS 7): the three radios (y 40-48), caps of the keyboard (row 0, row 3, the SPACE bar)
    for (let i = rng.int(1, 4); i > 0; i--) { const [x, y] = rng.pick(spots); L.click(env, x, y, 3, 5); }
    if (rng.chance(0.5)) L.typeCode(env, rng.pick([32, 14, 15]));
  } else if (p === 3) {
    // Write: caret moves and clicks in the text view only (a changed document would ask before it quits, WRITE 11.6): nothing of it may survive the quit
    for (let i = rng.int(1, 4); i > 0; i--) { if (rng.chance(0.5)) L.typeCode(env, rng.pick([8, 9, 10, 11])); else L.click(env, rng.int(30, 460), rng.int(34, 170), 3, 4); }
  } else if (p === 5) {
    // Puzzle: arrow keys and a click on the board (the deal is random anyway; nothing of it may survive the quit)
    for (let i = rng.int(1, 4); i > 0; i--) { if (rng.chance(0.5)) L.typeCode(env, rng.pick([8, 9, 10, 11])); else L.click(env, rng.int(90, 330), rng.int(56, 170), 3, 4); }
  } else if (p === 4) {
    // Paint: nothing is drawn (a changed picture would ask before it quits); no Paint-specific checks here (another suite's)
  } else {
    // the shell: one single click on an icon, then at least 25 frames so that no second click can make a double (SHELL 4: <= 20 frames)
    if (rng.chance(0.6)) { H.clickIcon(env, rng.pick([1, 2, 3, 4, 5]), 3, 4); env.frames_(25); }
    if (rng.chance(0.4)) L.typeCode(env, rng.pick([14, 15, 10, 11]));
    if (rng.chance(0.2)) { H.leapMenu(env, 1); L.typeCode(env, rng.pick([13, 27, 3])); env.frames_(6); }
  }
  void m;
}

// ===========================================================================================================================
// 1. The launcher
function launcherGroup() {
  const sec = new Sec('1 launcher: random launches (icon double click, ENTER on the focused icon, the Leap menu items 3 to 7) and quits (close box, SYMBOL SHIFT + Q); after each K_PROG, the windows, the app arena top, K_FOCUS / K_CAPTURE / W_MODAL / the posted queue, the stack at the event loop and the screen as after a fresh launch');
  const env = mkShell(), { m, S } = env;
  const base = {}, stat = { launches: 0, quits: 0, byMethod: {}, maxLaunch: 0, maxQuit: 0, perProg: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, shells: 0 };
  base[0] = H.captureState(env);
  sec.ok(base[0].prog === 0 && base[0].wins.length === 1 && base[0].wins[0].title === 'Leap Desktop' && base[0].focus === H.iconAddrs(env)[0], () => `boot state: ${JSON.stringify({ prog: base[0].prog, wins: base[0].wins, focus: hex(base[0].focus) })} (the shell, K_FOCUS on the first icon)`);
  sec.ok(base[0].sp !== undefined, 'the shell\'s event loop was seen (K_GETEV)');
  sec.ok(base[0].top === rd16(m, S.K_AARENA) && base[0].base === 0xC400, () => `app arena base ${hex(base[0].base)}, want $C400 (SHELL 2)`);
  const trail = [];
  const note = (s) => { trail.push(s); if (trail.length > 8) trail.shift(); };
  const judge = (p, what) => {
    env.frames_(p === 2 ? 36 : 12);                     // the window is up before it is all drawn (a launch takes about 8 frames, SHELL 7; Key Caps' 40 caps another 25): let it settle
    const cur = H.captureState(env);
    if (!base[p]) {
      base[p] = cur;                                    // the first arrival: the reference for "as after a fresh launch"
      // independent of the baseline: the screen is what the models draw for a fresh program
      if (p !== 4 && p !== 5) {                         // Paint and the Puzzle have no screen model in this suite (their own tests judge their screens; the Puzzle's board is dealt at random)
        const d = H.programDiff(env, p, [], '0');
        sec.ok(d === null, () => `${what}: the fresh program ${p}'s screen against the model: ${d}`);
      }
      sec.ok(cur.dirty < 0 && cur.capture === 0 && cur.modal === 0 && cur.posted.length === 0, () => `${what}: fresh program ${p}: arena dirty ${cur.dirty}, K_CAPTURE ${hex(cur.capture)}, W_MODAL ${hex(cur.modal)}, posted ${JSON.stringify(cur.posted)}`);
      // K_FOCUS: the window's activation focuses the first view that can take it (WINDOWS 14)
      const tree = H.treeOf(env), win = tree.find((v) => v.depth === 1 && v.cls !== S.CL_MenuBar && v.kind === 'Window');
      const first = tree.find((v) => win && v.depth > win.depth && (v.flags & 7) === 1);
      if (p === 4) { sec.ok(cur.focus === 0, () => `${what}: Paint has no focusable view: K_FOCUS ${hex(cur.focus)} (PAINT 15)`); return; }   // PAINT 15: the window's views are not focusable, so K_FOCUS is 0
      sec.ok(!!first && cur.focus === first.a, () => `${what}: K_FOCUS ${hex(cur.focus)}, the first focusable view of the window is ${first && hex(first.a)}`);
      return;
    }
    const diffs = H.compareStates(env, base[p], cur, `after ${what} [${trail.join('; ')}]`);
    sec.ok(diffs.length === 0, () => dig(diffs));
  };
  // ---- the transitions
  const launch = (p, method) => {
    const f0 = env.frames;
    if (method === 'dbl') { L.launchByDoubleClick(env, p); }
    else if (method === 'enter') {
      const icons = H.iconAddrs(env);
      for (let i = 0; i < 5 && rd16(m, S.K_FOCUS) !== icons[p - 1]; i++) L.typeCode(env, 14);
      sec.ok(rd16(m, S.K_FOCUS) === icons[p - 1], () => `TAB did not bring K_FOCUS to icon ${p} (K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, icons ${icons.map((a) => hex(a))})`);
      L.typeCode(env, 13, 3, 1);
    } else H.leapMenu(env, p + 2);
    const n = L.waitProgram(env, p, 120);
    sec.ok(n >= 0, () => `${method} launch of program ${p}: it did not come up (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => w.title))})`);
    stat.maxLaunch = Math.max(stat.maxLaunch, env.frames - f0);
    return n >= 0;
  };
  const quit = (p, method) => {
    const f0 = env.frames;
    const ok = method === 'close' ? L.quitByCloseBox(env, p) : L.quitBySSQ(env);
    sec.ok(ok, () => `${method} quit of program ${p}: the shell did not come back (K_PROG ${m.ram[S.K_PROG]})`);
    stat.maxQuit = Math.max(stat.maxQuit, env.frames - f0);
    return ok;
  };
  let cur = 0, step = 0;
  const methods = ['dbl', 'enter', 'menu'];
  // a clean prelude gives the baselines: nothing was done in the shell or the programs before their first launch
  for (const p of [1, 2, 3, 4, 5]) {
    note(`first launch of ${p} by dbl`);
    if (!launch(p, 'dbl')) return sec.end('stopped');
    judge(p, `the first launch of program ${p}`); stat.launches++; stat.perProg[p]++;
    note(`quit ${p} by close`);
    if (!quit(p, 'close')) return sec.end('stopped');
    judge(0, `the first return from program ${p}`); stat.quits++;
  }
  for (let i = 0; i < NLAUNCH && sec.nf < 10; i++) {
    if (cur === 0) {
      const p = rng.pick([1, 2, 3, 4, 5]), method = rng.pick(methods);
      if (rng.chance(0.5)) dirty(env, 0);
      note(`launch ${p} by ${method}`);
      if (!launch(p, method)) break;
      cur = p; stat.launches++; stat.perProg[p]++; stat.byMethod[method] = (stat.byMethod[method] || 0) + 1;
      judge(p, `launch ${p} by ${method} (step ${i})`);
    } else {
      const method = rng.pick(['close', 'ssq']);
      if (rng.chance(0.6)) dirty(env, cur);
      note(`quit ${cur} by ${method}`);
      if (!quit(cur, method)) break;
      stat.quits++; stat.byMethod[method] = (stat.byMethod[method] || 0) + 1;
      judge(0, `quit ${cur} by ${method} (step ${i})`);
      cur = 0; stat.shells++;
    }
    step++;
  }
  if (cur !== 0) { quit(cur, 'close'); judge(0, 'the last return'); }
  // the baselines against each other: a program has its own state
  sec.ok(base[1].top !== base[2].top || base[1].focus !== base[2].focus, 'the two programs have different arena states');
  sec.end(`${stat.launches} launches (calculator ${stat.perProg[1]}, key caps ${stat.perProg[2]}, write ${stat.perProg[3]}, paint ${stat.perProg[4]}), ${stat.quits} quits, methods ${JSON.stringify(stat.byMethod)}; the shell's arena top ${hex(base[0].top)}, calculator's ${hex(base[1].top)}, controls' ${hex(base[2].top)}, write's ${hex(base[3].top)}, paint's ${hex(base[4].top)}; loop SP shell ${hex(base[0].sp)}, calculator ${hex(base[1].sp)}, controls ${hex(base[2].sp)}; most frames: launch ${stat.maxLaunch}, quit ${stat.maxQuit} (the whole driver, input included)`);
}

// 1b. Exact cycles: 50 launch / quit cycles (SHELL 7)
function cyclesGroup() {
  const sec = new Sec(`1b ${NCYCLES} launch / quit cycles, alternating the programs, the double click and the close box / SS+Q: the state after every launch and every return is exactly the first one`);
  const env = mkShell(), { m, S } = env;
  const base = { 0: H.captureState(env) };
  let diffsN = 0;
  for (let i = 0; i < NCYCLES && sec.nf < 6; i++) {
    const p = 1 + (i % 5), how = i & 2 ? 'ssq' : 'close';
    if (!L.launchByDoubleClick(env, p)) { sec.ok(false, `cycle ${i}: launch ${p} failed (K_PROG ${m.ram[S.K_PROG]})`); break; }
    env.frames_(12);
    const c1 = H.captureState(env);
    if (!base[p]) base[p] = c1;
    const d1 = H.compareStates(env, base[p], c1, `cycle ${i}: program ${p} launched`);
    sec.ok(d1.length === 0, () => dig(d1)); diffsN += d1.length;
    const ok = how === 'close' ? L.quitByCloseBox(env, p) : L.quitBySSQ(env);
    if (!ok) { sec.ok(false, `cycle ${i}: ${how} quit of ${p} failed`); break; }
    env.frames_(12);
    const d0 = H.compareStates(env, base[0], H.captureState(env), `cycle ${i}: back in the shell after ${how}`);
    sec.ok(d0.length === 0, () => dig(d0)); diffsN += d0.length;
  }
  sec.end(`${diffsN} differences from the first launch's state; the arena tops $${base[0].top.toString(16)} / $${base[1].top.toString(16)} / $${base[2] ? base[2].top.toString(16) : '-'} / $${base[3] ? base[3].top.toString(16) : '-'} / $${base[4] ? base[4].top.toString(16) : '-'}`);
}

// ===========================================================================================================================
// 2. The shell: look, clicks, double clicks, keys
/** A shell as it is when it has just started: leave it and come back (Calculator, the close box); K_FOCUS is on the first icon again, nothing is remembered. */
function freshShell(env, sec) {
  if (env.m.ram[env.S.K_PROG] !== 0) L.waitShell(env);
  const ok = L.launchByDoubleClick(env, 1); env.frames_(12);
  const ok2 = ok && L.quitByCloseBox(env, 1); env.frames_(12);
  sec.ok(ok && ok2, () => `a fresh shell: Calculator ${ok ? 'started' : 'did not start'}, the shell ${ok2 ? 'came back' : 'did not come back'} (K_PROG ${env.m.ram[env.S.K_PROG]})`);
}
function shellGroup() {
  const env = mkShell(), { m, S } = env;
  const icons = H.iconAddrs(env);
  // ---- the look (10.4), against the gfx6-model rendering
  {
    const sec = new Sec('2a the shell\'s look against shell-model\'s rendering of SHELL 10.4: the window, the icon bitmaps (icons.txt), the names centred, the selected name inverted');
    const views = H.treeOf(env), win = views.find((v) => v.cls === S.CL_CWindow);
    sec.ok(!!win && win.id === 255 && [win.x, win.y, win.w, win.h].join() === '32,24,384,80' && H.readStrText(m, rd16(m, win.a + S.Window_title)) === 'Leap Desktop', () => `the window ${win && [win.x, win.y, win.w, win.h]}, title "${win && H.readStrText(m, rd16(m, win.a + S.Window_title))}"`);
    const ics = views.filter((v) => v.cls === S.CL_Icon);
    sec.ok(ics.length === 5 && ics[0].x === 48 && ics[0].y === 40 && ics[1].x === 112 && ics[1].y === 40 && ics[2].x === 176 && ics[2].y === 40 && ics[3].x === 240 && ics[3].y === 40 && ics[4].x === 304 && ics[4].y === 40 && ics.every((v) => v.w === 64 && v.h === 26 && (v.flags & 1) === 1), () => `icons ${JSON.stringify(ics.map((v) => [v.x, v.y, v.w, v.h, v.flags]))}, want (48, 40), (112, 40), (176, 40) (WRITE 11.2) (240, 40) (PAINT 10) and (304, 40) (PUZZLE), 64 x 26 (SHELL 10.5), focusable`);
    sec.ok(ics.length === 5 && m.ram[ics[0].a + S.Icon_prog] === 1 && m.ram[ics[1].a + S.Icon_prog] === 2 && m.ram[ics[2].a + S.Icon_prog] === 3 && m.ram[ics[3].a + S.Icon_prog] === 4 && m.ram[ics[4].a + S.Icon_prog] === 5, () => `Icon prog fields ${ics.map((v) => m.ram[v.a + S.Icon_prog])}, want 1, 2, 3, 4 and 5 (SHELL 10.4: prog 1 byte)`);
    sec.ok(ics.length === 5 && H.readStrText(m, rd16(m, ics[4].a + S.Icon_name)) === 'Puzzle' && H.readStrText(m, rd16(m, ics[3].a + S.Icon_name)) === 'Paint' && H.readStrText(m, rd16(m, ics[0].a + S.Icon_name)) === 'Calculator' && H.readStrText(m, rd16(m, ics[1].a + S.Icon_name)) === 'Key Caps' && H.readStrText(m, rd16(m, ics[2].a + S.Icon_name)) === 'Notepad', () => `Icon names ${ics.map((v) => H.readStrText(m, rd16(m, v.a + S.Icon_name)))}`);
    const d0 = H.shellDiff(env);
    sec.ok(d0 === null, () => `boot screen: ${d0}`);
    sec.ok(rd16(m, S.K_FOCUS) === icons[0], () => `K_FOCUS after boot ${hex(rd16(m, S.K_FOCUS))}, the first icon is ${hex(icons[0])}`);
    // the pointer parked in a corner: the whole screen compared (mask only the corner)
    L.moveTo(env, 500, 180); env.frames_(4);
    const d1 = H.shellDiff(env);
    sec.ok(d1 === null, () => `pointer parked at (500, 180): ${d1}`);
    // the TABs below start from the first icon (the focus is there after the boot)
    // the selected look on each icon (set the focus by TAB, as a user does) and with none: K_FOCUS cleared by the harness is not a user state, so only 0 / 1
    for (const k of [1, 2, 3, 4, 0, 1]) {
      L.typeCode(env, 14); env.frames_(6);
      sec.ok(rd16(m, S.K_FOCUS) === icons[k], () => `TAB: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, want icon ${k} ${hex(icons[k])}`);
      const d = H.shellDiff(env);
      sec.ok(d === null, () => `TAB to icon ${k}: the whole screen against SHELL 10.4 / 10.5's rendering: ${d}`);
    }
    // the window is a CWindow (SHELL 12): the close box (x + 8, y + 1, 15, 7) is drawn while it is in front: its pixels are the model's and not all paper
    const g = SM.renderShell({ sel: icons.indexOf(rd16(m, S.K_FOCUS)) });
    const sh = H.readDisp(m), want = SM.toDisp(g), bx = SM.boxRect(32, 24, 384);
    let boxDiff = 0; for (let y = bx.y; y < bx.y + bx.h; y++) for (let x = bx.x; x < bx.x + bx.w; x++) { const bit = (a, X, Y) => (a[Y * 64 + (X >> 3)] >> (7 - (X & 7))) & 1; if (bit(sh, x, y) !== bit(want, x, y)) boxDiff++; }
    sec.ok(boxDiff === 0, () => `${boxDiff} pixels differ in the close box's place (SHELL 12: the window is a CWindow)`);
    { const bit = (X, Y) => (sh[Y * 64 + (X >> 3)] >> (7 - (X & 7))) & 1; let ink = 0; for (let y = bx.y; y < bx.y + bx.h; y++) for (let x = bx.x; x < bx.x + bx.w; x++) ink += bit(x, y);
      sec.ok(ink > 0 && SM.boxRect(32, 24, 384).x === 40, () => `the close box area (${bx.x}, ${bx.y}, ${bx.w}, ${bx.h}) has ${ink} ink pixels, want some (a frame)`); }
    sec.end('window, 5 icons (bitmaps from icons.txt, names, selection) in 10 screens');
  }
  // ---- LOOK 7: the open "Leap" menu under the bar's line (LOOK 3.1) and the Mac arrow (LOOK 3.6), against look-model
  {
    const sec = new Sec('2e the open "Leap" menu (LOOK 3.1): the title box XORed in rows 0-6 only (the bar\'s line stays), the drop-down with no top line of its own, its sides from row 8, the shadow 2 columns right and 1 row under, the highlight on the item under the pointer; the whole screen against look-model; released away from the items the shell comes back unchanged (save-under)');
    const LM = LMOD, lay = layoutOf([SM.LEAP_MENU]), en = [[true, true, true, true, true, true, true, true, true]];
    const mask = () => L.pointerMask(m, S);
    const screenWith = (h) => { const icons2 = H.iconAddrs(env), g = SM.renderShell({ sel: icons2.indexOf(rd16(m, S.K_FOCUS)) }); LM.openLook(g, [SM.LEAP_MENU], lay, en, 0, h); return g; };
    L.moveTo(env, 500, 180); env.frames_(4);
    const d0 = H.shellDiff(env); sec.ok(d0 === null, () => `before the menu: ${d0}`);
    L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
    { const d = H.diffDisp(H.readDisp(m), SM.toDisp(screenWith(-1)), mask()); sec.ok(d === null, () => `the menu open, no highlight: ${d}`); }
    // the contract's own statements: the line at row 7 is intact under the title box, the box is inverted in rows 0-6
    { const dd = H.readDisp(m), mk = mask(), b = lay.boxes[0], dr = lay.drops[0];
      // pixels under the pointer's byte rectangle are left out (the arrow covers part of the title and the first rows)
      const seen = (x, y) => mk[y * 64 + (x >> 3)] !== 0, bit = (x, y) => (dd[y * 64 + (x >> 3)] >> (7 - (x & 7))) & 1;
      const tally = (pts) => { let n = 0, t = 0; for (const [x, y] of pts) if (seen(x, y)) { t++; n += bit(x, y); } return [n, t]; };
      const row = (x0, x1, y) => Array.from({ length: x1 - x0 }, (_, i) => [x0 + i, y]);
      const col = (x, y0, y1) => Array.from({ length: y1 - y0 }, (_, i) => [x, y0 + i]);
      const [line, lineT] = tally(row(b.x, b.x + b.w, 7));
      sec.ok(line === lineT && lineT > 0, () => `the bar's line under the open title: ${line} of ${lineT} visible pixels ink`);
      let inv = 0; for (let y = 0; y < 7; y++) for (let x = b.x + 20; x < b.x + b.w; x++) if (seen(x, y)) inv += bit(x, y);
      sec.ok(inv > 0, () => `the title box is not inverted (${inv} ink pixels in rows 0-6, right of the pointer)`);
      const [side, sideT] = tally([...col(dr.x, 8, 8 + dr.h), ...col(dr.x + dr.w - 1, 8, 8 + dr.h)]);
      sec.ok(side === sideT, () => `the drop-down's sides from row 8: ${side} of ${sideT} visible pixels ink`);
      const [sh, shT] = tally([...col(dr.x + dr.w, 10, 8 + dr.h), ...col(dr.x + dr.w + 1, 10, 8 + dr.h), ...row(dr.x + 2, dr.x + dr.w + 2, 8 + dr.h)]);
      sec.ok(sh === shT, () => `the shadow (2 columns right, 1 row under): ${sh} of ${shT} visible pixels ink`); }
    for (const k of [0, 2, 3, 4, 5, 6, 7, 8]) {
      L.moveTo(env, 30, 9 + 10 * k + 5); env.frames_(3);
      const d = H.diffDisp(H.readDisp(m), SM.toDisp(screenWith(k)), mask()); sec.ok(d === null, () => `the menu open, item ${k} highlighted: ${d}`);
    }
    L.moveTo(env, 400, 150); env.frames_(3); m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
    const d2 = H.shellDiff(env); sec.ok(d2 === null, () => `after the menu is closed (released away from it): ${d2}`);
    sec.ok(rd16(m, S.K_FOCUS) !== 0 && m.ram[S.K_PROG] === 0, 'still the shell');
    // the arrow: P_ARROW drawn by the ISR at the pointer, the Mac arrow of LOOK 3.6, over the desk and over paper inside the window
    for (const [px, py, what] of [[300, 150, 'the desk'], [301, 123, 'the desk (odd x, odd y)'], [230, 85, 'the paper inside the shell window'], [200, 30, 'the title bar']]) {
      L.moveTo(env, px, py); env.frames_(4);
      const g = SM.renderShell({ sel: H.iconAddrs(env).indexOf(rd16(m, S.K_FOCUS)) }); LM.drawArrow(g, LM.ARROW_MAC, px, py);
      const d = H.diffDisp(H.readDisp(m), SM.toDisp(g));
      sec.ok(d === null, () => `the pointer at (${px}, ${py}) over ${what}: the whole screen with the Mac arrow drawn there: ${d}`);
    }
    sec.end('open menu (plain and 7 highlights), the bar line / title box / sides / shadow statements, the close, the Mac arrow at 4 places');
  }
  // ---- clicks, double clicks, TAB, arrows, ENTER against ShellSim, random
  {
    const sec = new Sec('2b clicks, double clicks (gaps near 20 frames), TAB / BACKTAB / arrows, ENTER and clicks off the icons against ShellSim: K_FOCUS, K_PROG, S_LAST, K_CAPTURE and the screen after every action (the double-click is the kernel\'s flag, WRITE 14.9)');
    const sim = new SM.ShellSim();
    freshShell(env, sec);
    const base0 = H.captureState(env);
    const stat = { downs: 0, opens: 0, keys: 0, enters: 0, blanks: 0, near20: 0, openedAt20: 0, notAt21: 0, moves: 0, flagSame: 0 };
    const hist = [];
    const rec = (s) => { hist.push(s); if (hist.length > 7) hist.shift(); };
    const afterLaunch = (p, why) => {
      const n = L.waitProgram(env, p, 120);
      sec.ok(n >= 0, () => `${why}: program ${p} did not come up (K_PROG ${m.ram[S.K_PROG]}) [${hist.join('; ')}]`);
      if (n < 0) return false;
      env.frames_(p === 2 ? 36 : 12);                   // Key Caps draws its 40 caps over about 25 frames after its window is up
      const d = p === 4 || p === 5 ? null : H.programDiff(env, p, [], '0');   // no screen model for Paint (its own suite) or the Puzzle (a random deal) here
      sec.ok(d === null, () => `${why}: the program ${p} screen: ${d}`);
      const ok = (p === 4 || rd16(m, S.K_FOCUS) !== 0) && L.progUp(env, p);   // Paint's views take no focus (K_FOCUS 0)
      sec.ok(ok, () => `${why}: program ${p} state`);
      // back to the shell, which starts fresh (SHELL 3, 10.3)
      const q = rng.chance(0.5) ? L.quitByCloseBox(env, p) : L.quitBySSQ(env);
      sec.ok(q, () => `${why}: the shell did not come back`);
      env.frames_(12);
      sim.reset();
      const diffs = H.compareStates(env, base0, H.captureState(env), `${why}: back in the shell`);
      sec.ok(diffs.length === 0, () => dig(diffs));
      return q;
    };
    const verifyShell = (what) => {
      env.frames_(1);
      sec.ok(m.ram[S.K_PROG] === 0, () => `${what}: K_PROG ${m.ram[S.K_PROG]} [${hist.join('; ')}]`);
      const want = icons[sim.focus], got = rd16(m, S.K_FOCUS);
      sec.ok(got === want, () => `${what}: K_FOCUS ${hex(got)}, the model has icon ${sim.focus} (${hex(want)}) [${hist.join('; ')}]`);
      sec.ok(rd16(m, S.K_CAPTURE) === 0 && rd16(m, S.W_MODAL) === 0, () => `${what}: K_CAPTURE ${hex(rd16(m, S.K_CAPTURE))}, W_MODAL ${hex(rd16(m, S.W_MODAL))}`);
      const d = H.shellDiff(env);
      sec.ok(d === null, () => `${what}: screen ${d} [${hist.join('; ')}]`);
    };
    // A press: the pointer on the icon, (optionally waiting until `gap` frames have passed since the last press anywhere), the button down for 1-3 frames.  The kernel decides the
    // double-click (WRITE 14.9 item 1) and marks the E_DOWN (data 3 bit 2): the flag is read from the ring record the ISR queued in the press frame (kern-dclick.mjs judges the flag itself);
    // the shell's rule (14.9 item 2) is then: an icon opens when the flag is set and the icon is S_LAST, the icon of the shell's last press.
    let lastPressFrame = null;
    const press = (i, gap) => {
      const p = i + 1, [cx, cy] = L.iconCentre(p);
      L.moveTo(env, cx, cy);
      if (gap !== undefined && lastPressFrame !== null) { let g = 0; while (env.frames + 1 - lastPressFrame < gap && g++ < 300) env.frame(); }
      const oldI = rd16(m, S.S_LAST), t0 = m.ram[S.K_RTAIL];
      m.mouse.buttons = L.MOUSE_LEFT; env.frame();
      const t1 = m.ram[S.K_RTAIL];
      let flag = null;
      for (let t = t0; t !== t1; t = (t + 4) & 0xFF) { const a = S.K_RING + (t & 0x3F); if (m.ram[a] === 3) flag = (m.ram[a + 3] & 4) !== 0; }
      const gapFrames = lastPressFrame === null ? null : env.frames - lastPressFrame;
      lastPressFrame = env.frames;
      env.frames_(rng.int(0, 2)); m.mouse.buttons = L.MOUSE_UP; env.frames_(rng.int(1, 2));
      for (let k = 0; k < 6 && m.ram[S.K_PROG] === 0 && rd16(m, S.S_LAST) === oldI && flag !== true; k++) env.frame();
      return { flag, gapFrames, opened: m.ram[S.K_PROG] };
    };
    sim.focus = Math.max(0, icons.indexOf(rd16(m, S.K_FOCUS)));                       // 2a left the focus where its last TAB put it
    verifyShell('start');
    for (let k = 0; k < NSHELL && sec.nf < 10; k++) {
      const r = rng.next();
      if (r < 0.50) {
        const i = rng.int(0, 3);
        const gap = rng.chance(0.55) ? rng.pick([2, 3, 4, 6, 10, 15, 18, 19, 20, 20, 21, 21, 22, 25, 30, 45]) : undefined;
        const prevIcon = sim.last ? sim.last.icon : null;
        const pr = press(i, gap);
        stat.downs++;
        sec.ok(pr.flag !== null, () => `press on icon ${i}: no E_DOWN in the ring [${hist.join('; ')}]`);
        const flag = !!pr.flag, want = sim.down(i, flag);
        if (pr.gapFrames !== null && pr.gapFrames >= 19 && pr.gapFrames <= 22) stat.near20++;
        rec(`press icon ${i} gap ${pr.gapFrames} flag ${flag ? 1 : 0} (last icon ${prevIcon})`);
        sec.ok(pr.opened === want, () => `press on icon ${i} (${hist.join('; ')}): the shell ${pr.opened ? `opened program ${pr.opened}` : 'did not open'}, the rule (flag set and the icon is S_LAST) says ${want ? `open program ${want}` : 'no open'}`);
        if (flag && prevIcon === i) stat.flagSame++;
        if (pr.opened) {
          stat.opens++; if (pr.gapFrames === 20) stat.openedAt20++;
          afterLaunch(pr.opened, `press icon ${i} (gap ${pr.gapFrames})`);
          lastPressFrame = null;
        } else {
          if (pr.gapFrames === 21 && prevIcon === i) stat.notAt21++;
          // the shell's own record of the press: the icon (S_LAST)
          sec.ok(rd16(m, S.S_LAST) === icons[i], () => `press icon ${i}: S_LAST ${hex(rd16(m, S.S_LAST))}, want the icon ${hex(icons[i])} [${hist.join('; ')}]`);
          verifyShell(`press icon ${i}`);
        }
      } else if (r < 0.80) {
        const code = rng.pick([14, 14, 15, 10, 11, 8, 9]);
        L.typeCode(env, code); sim.key(code); stat.keys++; rec(`key ${code}`);
        verifyShell(`key ${code}`);
      } else if (r < 0.90) {
        const prog = sim.key(13); L.typeCode(env, 13, 3, 1); stat.enters++; rec(`ENTER (focus icon ${sim.focus}) -> ${prog}`);
        if (prog) afterLaunch(prog, 'ENTER'); else verifyShell('ENTER');
      } else if (r < 0.96) {
        // a press on the window's blank part and on the desk: no icon sees it (reading R3 of shell-model.mjs: it does not disturb the double click)
        const [x, y] = rng.pick([[250, 90], [392, 56], [400, 150], [60, 160]]);
        L.click(env, x, y, 3, 4); lastPressFrame = env.frames - 4; sim.blank(); stat.blanks++; rec(`click blank (${x}, ${y})`);
        verifyShell(`click at (${x}, ${y})`);
      } else { const [x, y] = [rng.int(0, 511), rng.int(10, 190)]; L.moveTo(env, x, y); env.frames_(1); stat.moves++; rec(`move (${x}, ${y})`); verifyShell('move'); }
    }
    // the boundary, exactly (reading R2: the frames are V_FRAMES when each E_DOWN is handled, as the shell's S_LASTF records them)
    sec.end(`${stat.downs} presses (${stat.flagSame} flagged on the icon of the last press; ${stat.opens} double clicks opened; ${stat.near20} with a gap of 19-22; ${stat.openedAt20} opened at exactly 20; ${stat.notAt21} refused at exactly 21), ${stat.keys} keys, ${stat.enters} ENTERs, ${stat.blanks} blank clicks, ${env.frames} frames`);
  }
  // ---- the double click boundary, exactly, measured through the real ISR
  {
    const sec = new Sec('2c double click timing (WRITE 14.9 items 1-2): two presses on the same icon whose polls are f2 - f1 frames apart (the real ISR, m.mouse): <= 20 opens the program, 21 or more does not; the distance (8 across / 4 down opens, 9 / 5 does not); a press elsewhere between; a flagged press on the neighbouring icon; the kernel\'s flag is read from the ring');
    const gaps = [2, 3, 4, 5, 8, 10, 15, 18, 19, 20, 21, 22, 23, 25, 30, 40, 100];
    const stat = { opened: 0, kept: 0 };
    const finishTrial = (what, p, wantOpen, r) => {
      if (r) sec.ok(r.gapSeen === r.gapWant, () => `${what}: the harness made a gap of ${r.gapSeen}, wanted ${r.gapWant} (calibration)`);
      const n = L.waitProgram(env, p, 40), opened = n >= 0 && m.ram[S.K_PROG] === p;
      sec.ok(opened === wantOpen, () => `${what}: the program ${opened ? 'opened' : 'did not open'}, want ${wantOpen ? 'open' : 'no open'}${r ? ` (E_DOWNs polled in frames ${r.f1} and ${r.f2}, flags ${r.flag1 ? 1 : 0} and ${r.flag2 ? 1 : 0})` : ''}`);
      if (!opened) { stat.kept++; sec.ok(rd16(m, S.K_FOCUS) === icons[p - 1] || !r, () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))} after a click`); }
      else { stat.opened++; sec.ok(L.quitByCloseBox(env, p), `${what}: the shell did not come back`); env.frames_(4); }
      return opened;
    };
    const trial = (what, p, gap, o, wantOpen, wantFlag2 = wantOpen) => {
      if (m.ram[S.K_PROG] !== 0) L.waitShell(env);
      env.frames_(30);
      const r = H.doubleClickGap(env, p, gap, o); r.gapWant = gap;
      sec.ok(r.flag1 === false, () => `${what}: the first press (K_DCN 0 before) has the flag`);
      sec.ok(r.flag2 === wantFlag2, () => `${what}: the second press' flag ${r.flag2 ? 1 : 0}, want ${wantFlag2 ? 1 : 0} (the kernel's rule: 20 frames, 8 across, 4 down)`);
      return finishTrial(what, p, wantOpen, r);
    };
    for (const p of [1, 2, 3, 4, 5]) for (const gap of gaps) trial(`icon ${p}, gap ${gap}`, p, gap, {}, gap <= 20);
    // the distance (a gap of 6): inside the 64 x 26 icon, centre (x + 32, y + 13)
    for (const [dx, dy, want] of [[8, 0, true], [-8, 0, true], [0, 4, true], [0, -4, true], [8, 4, true], [-8, -4, true], [9, 0, false], [-9, 0, false], [0, 5, false], [0, -5, false], [9, 5, false], [12, 0, false], [0, 9, false]]) {
      const p = rng.pick([1, 2, 3, 4, 5]);
      trial(`icon ${p}, gap 6, second press at (${dx >= 0 ? '+' : ''}${dx}, ${dy >= 0 ? '+' : ''}${dy}) from the first`, p, 6, { off: [dx, dy] }, want);
    }
    // a press elsewhere between the two: the kernel's flag is about the previous press anywhere, so the second press on the icon is not a double
    for (const p of [1, 3]) {
      if (m.ram[S.K_PROG] !== 0) L.waitShell(env);
      env.frames_(30);
      const [cx, cy] = L.iconCentre(p), foc = H.iconAddrs(env)[p - 1];
      for (let i = 0; i < 3 && rd16(m, S.K_FOCUS) !== foc; i++) { L.typeCode(env, 14); env.frames_(2); }
      L.moveTo(env, cx, cy); env.frames_(25);
      const a = H.pressPoint(env, cx, cy); env.frames_(2);
      const mid = H.pressPoint(env, 400, 150); env.frames_(2);           // the bare desk
      const b = H.pressPoint(env, cx, cy);
      sec.ok(a.flag === false && mid.flag === false && b.flag === false, () => `icon ${p}: a press on the desk between two presses on the icon: flags ${a.flag}, ${mid.flag}, ${b.flag}, want all false`);
      finishTrial(`icon ${p}: press, desk press, press (6 frames in all)`, p, false, null);
    }
    // the neighbouring icon: icon 1's right edge (x 111) then icon 2's left edge (x 113): near (dx 2), so the kernel flags the second press, but it is not the icon of the last press: no open;
    // the second press made icon 2 the last press, and it was a double-click, so a third press (not flagged) does not open; a fourth press (flagged against the third) on icon 2 does
    {
      if (m.ram[S.K_PROG] !== 0) L.waitShell(env);
      env.frames_(30);
      for (let i = 0; i < 3 && rd16(m, S.K_FOCUS) !== icons[0]; i++) { L.typeCode(env, 14); env.frames_(2); }
      L.moveTo(env, 111, 50); env.frames_(25);
      const a = H.pressPoint(env, 111, 50); env.frames_(2);
      const b = H.pressPoint(env, 113, 50); env.frames_(3);
      sec.ok(a.flag === false && b.flag === true, () => `neighbouring icons: flags ${a.flag}, ${b.flag}, want false, true (2 pixels apart, 5 frames)`);
      sec.ok(m.ram[S.K_PROG] === 0 && rd16(m, S.S_LAST) === icons[1], () => `a flagged press on icon 2 after one on icon 1: K_PROG ${m.ram[S.K_PROG]}, S_LAST ${hex(rd16(m, S.S_LAST))} (want 0 and icon 2 ${hex(icons[1])})`);
      const c = H.pressPoint(env, 113, 50); env.frames_(3);
      sec.ok(c.flag === false && m.ram[S.K_PROG] === 0, () => `the press after a double-click: flag ${c.flag}, K_PROG ${m.ram[S.K_PROG]}, want false and the shell (the second press was a double-click)`);
      const d = H.pressPoint(env, 114, 51); 
      finishTrial('neighbouring icons: the fourth press (flagged against the third, on the icon of the last press)', 2, true, null);
      sec.ok(d.flag === true, () => `the fourth press: flag ${d.flag}, want true`);
    }
    sec.end(`${stat.opened + stat.kept} trials (${stat.opened} opened, ${stat.kept} refused): gaps 2-100 on 5 icons, 13 offsets, presses elsewhere between, neighbouring icons`);
  }
  // ---- ENTER and TAB / arrows from the user's side (the keys are checked again in 2b)
  {
    const sec = new Sec('2d ENTER opens the focused icon: straight after the start the first one; after TAB / DOWN / RIGHT once the second, twice the third, the fourth (Paint) three times, the fifth (Puzzle) four times, the first again five times; after BACKTAB / UP / LEFT from the first the fifth (wrapping), then the fourth, the third, the second, the first');
    const trial = (keys, wantProg, what) => {
      freshShell(env, sec);
      for (const k of keys) { L.typeCode(env, k); env.frames_(2); }
      L.typeCode(env, 13, 3, 1);
      const n = L.waitProgram(env, wantProg, 120);
      sec.ok(n >= 0, () => `${what}: keys ${JSON.stringify(keys)} then ENTER: program ${wantProg} did not come up (K_PROG ${m.ram[S.K_PROG]})`);
      if (n >= 0) sec.ok(L.quitBySSQ(env), `${what}: the shell did not come back by SS+Q`);
    };
    trial([], 1, 'at the start');
    for (const k of [14, 10, 9]) { trial([k], 2, `key ${k} once`); trial([k, k], 3, `key ${k} twice`); trial([k, k, k], 4, `key ${k} three times`); trial([k, k, k, k], 5, `key ${k} four times`); trial([k, k, k, k, k], 1, `key ${k} five times`); }
    for (const k of [15, 11, 8]) { trial([k], 5, `key ${k} once`); trial([k, k], 4, `key ${k} twice`); trial([k, k, k], 3, `key ${k} three times`); trial([k, k, k, k], 2, `key ${k} four times`); trial([k, k, k, k, k], 1, `key ${k} five times`); }
    sec.end('31 trials');
  }
}

// ===========================================================================================================================
// 3. CWindow (10.1): look and close box tracking, on an empty desk by direct calls (the pattern of tk-t1's group 3)
const CW = {};
function cwindowGroup() {
  const env = T.bootParked({ rng }); envs.push(env);
  const { m, S } = env;
  let strSlot = 0;
  const wins = [];                                              // back to front: { a, kind, x, y, w, h, title, id, slot }
  const validW = () => 16 * rng.int(6, 20), validH = () => 8 * rng.int(4, 16);
  const g0 = new SM.Gfx6Model();
  const tw = (s) => g0.textw(SM.codesOf(s));
  const randTitle = (maxw) => { for (let i = 0; i < 40; i++) { const n = rng.int(0, 14); let s = ''; for (let k = 0; k < n; k++) s += rng.pick('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '); if (tw(s) <= maxw) return s; } return 'Win'; };
  const randRect = () => { const w = validW(), h = validH(); return { x: 16 * rng.int(0, (512 - w) / 16), y: 8 * rng.int(1, (192 - h) / 8), w, h }; };
  const open = (kind, r, title, id) => {
    env.strp = T.STR0 + 32 * (strSlot++ % 8);                       // at most 4 windows are open at once: a ring of 8 title slots never reuses a live one
    const a = T.kNew(env, kind === 'CWindow' ? S.CL_CWindow : S.CL_Window);
    T.setRect(env, a, r.x, r.y, r.w, r.h); T.poke16(env, a + S.Window_title, T.str(env, SM.codesOf(title))); T.poke8(env, a + S.View_id, id);
    const q = T.runCall(env, S.W_OPEN, { ix: a }, { ints: false });
    if (q.carry) throw new Error(`W_OPEN refused ${JSON.stringify(r)}`);
    T.runCall(env, S.W_UPDATE, {}, { ints: false });
    const w = { a, kind, ...r, title, id, slot: m.ram[a + S.Window_slot] };
    wins.push(w); return w;
  };
  const raise = (w) => { T.runCall(env, S.W_RAISE, { ix: w.a }, { ints: false }); T.runCall(env, S.W_UPDATE, {}, { ints: false }); wins.splice(wins.indexOf(w), 1); wins.push(w); };
  const close = (w) => { T.runCall(env, S.W_CLOSE, { ix: w.a }, { ints: false }); T.runCall(env, S.W_UPDATE, {}, { ints: false }); wins.splice(wins.indexOf(w), 1); };
  const clear = () => { while (wins.length) close(wins[wins.length - 1]); T.runCall(env, S.K_ARESET, { hl: S.K_AARENA }, { ints: false }); T.runCall(env, S.K_ARENA, { hl: S.K_AARENA }, { ints: false }); T.poke16(env, S.K_FOCUS, 0); T.poke16(env, S.K_CAPTURE, 0); T.poke16(env, S.K_FSCOPE, 0); T.drainEvents(env); };
  const screenIs = (pressed = false) => { const g = SM.paintWindows(wins.map((w) => ({ kind: w.kind, x: w.x, y: w.y, w: w.w, h: w.h, title: w.title })), { pressed }); return T.diffDisp(T.readDisp(m), SM.toDisp(g)); };
  const ctx = () => wins.map((w) => `${w.kind}(${w.x},${w.y},${w.w},${w.h})"${w.title}"`).join(' < ');

  // ---- 3a. the look: the close box on the front CWindow only
  {
    const sec = new Sec('3a CWindow look (SHELL 10.1): Window look + the close box CLR fill (x+8, y+1, 15, 7) / SET frame (x+10, y+2, 11, 5), the Mac look of LOOK 3, only while the window is in front; random stacks of Windows and CWindows opened, raised and closed, the whole screen against the model after each step');
    const st = { screens: 0, boxes: 0, noBox: 0, raises: 0, closes: 0 };
    for (let i = 0; i < NLOOK && sec.nf < 10; i++) {
      const r = rng.next();
      try {
        if (wins.length === 0 || (r < 0.35 && wins.length < 4)) { const rc = randRect(), kind = rng.chance(0.6) ? 'CWindow' : 'Window'; open(kind, rc, randTitle(Math.max(0, rc.w - 30)), rng.int(0, 255)); }
        else if (r < 0.75 && wins.length > 1) { raise(rng.pick(wins.slice(0, -1))); st.raises++; }
        else if (r < 0.9) { close(rng.pick(wins)); st.closes++; }
        else { while (wins.length) close(wins[wins.length - 1]); }
      } catch (e) { sec.ok(false, `step ${i}: ${e.message} [${ctx()}]`); break; }
      const d = screenIs(false); st.screens++;
      sec.ok(d === null, () => `step ${i}, stack ${ctx()}: ${d}`);
      const f = wins[wins.length - 1]; if (f) { if (f.kind === 'CWindow') st.boxes++; else st.noBox++; }
    }
    sec.end(`${st.screens} screens: ${st.boxes} with a front CWindow (box drawn), ${st.noBox} with a front plain Window (no box), ${st.raises} raises, ${st.closes} closes`);
    clear();
  }
  // ---- the tracking of 10.1
  const trackOnce = (spec, label) => {
    // spec: { wins: [...windows to open, back to front], down: [px, py], frames: [[events]], via: 'TK' | 'K' }
    clear();
    for (const w of spec.wins) open(w.kind, w, w.title, w.id);
    const front = wins[wins.length - 1], target = spec.target || front;
    const posted = [], states = [];
    let wakes = 0, pointer = spec.down.slice(), drawnBox = null;
    const inside = () => SM.inBox(target, pointer[0], pointer[1]);
    const recOf = (e) => (e.t === 'move' ? T.ptRec(SM.E.MOVE, e.px, e.py, 1) : e.t === 'up' ? T.ptRec(SM.E.UP, e.px, e.py, 0) : e.t === 'down' ? T.ptRec(SM.E.DOWN, e.px, e.py, 1) : [SM.E.KEY, e.key, 0, 0]);
    T.drainEvents(env); T.setVframes(env, 1000);
    T.setEv(env, T.ptRec(SM.E.DOWN, spec.down[0], spec.down[1], 1));
    const target0 = target;
    void target0;
    const checkNow = (k) => {
      const pressed = spec.tracking && inside();
      const d = screenIs(pressed);
      states.push({ k, pressed, d });
    };
    let r;
    try {
      r = T.runCall(env, spec.via === 'TK' ? S.TK_DISPATCH : S.K_DISPATCH, {}, {
        onPost: (p) => posted.push(p),
        onHalt: (info) => {
          // the state after the events processed so far: for a tracked press the box is pressed exactly while the pointer is inside it
          if (spec.tracking) checkNow(wakes);
          else if (wakes === 0 && spec.raised) { const d = screenIs(false); states.push({ k: 0, pressed: false, d }); }
          wakes++;
          if (wakes > spec.frames.length) throw new Error('the loop still waits after the scripted frames (it never saw the E_UP?)');
          T.setVframes(env, 1000 + wakes);
          for (const e of spec.frames[wakes - 1]) { T.ringPut(env, recOf(e)); if (e.t === 'move') pointer = [e.px, e.py]; if (e.t === 'up') spec.upAt = [e.px, e.py]; }
        },
      });
    } catch (e) { sec.ok(false, `${label}: ${e.message}`); T.drainEvents(env); return null; }
    return { r, posted, states, wakes, front, target };
  };
  // ---- 3b. tracking: press, move out and back in, release in or out
  {
    const sec = new Sec('3b close box tracking (10.1): a press in (x+8, y+1, 15, 7) of the front CWindow draws the pressed look (XOR fill (x+11, y+3, 9, 3)); E_MOVE: the look follows whether the point is in the box; E_UP in the box: released and E_CMD posted (A 10, C View_id, E slot, D 0), outside: released, nothing posted; other events dropped; through TK_DISPATCH and K_DISPATCH');
    const st = { cases: 0, closed: 0, aborted: 0, moves: 0, pressedLooks: 0, unpressedLooks: 0, via: { TK: 0, K: 0 }, edge: 0, halts: 0, keysDropped: 0 };
    for (let ci = 0; ci < NTRACK && sec.nf < 10; ci++) {
      const rc = randRect(), id = rng.int(0, 255), title = randTitle(Math.max(0, rc.w - 30));
      const wlist = [];
      if (rng.chance(0.4)) { const o = randRect(); wlist.push({ kind: rng.pick(['Window', 'CWindow']), ...o, title: 'under', id: rng.int(0, 255) }); }
      const main = { kind: 'CWindow', ...rc, title, id };
      wlist.push(main);
      const bx = SM.boxRect(rc.x, rc.y, rc.w);
      const pointIn = () => (rng.chance(0.2) ? rng.pick([[bx.x, bx.y], [bx.x + bx.w - 1, bx.y], [bx.x, bx.y + bx.h - 1], [bx.x + bx.w - 1, bx.y + bx.h - 1]]) : [rng.int(bx.x, bx.x + bx.w - 1), rng.int(bx.y, bx.y + bx.h - 1)]);
      const pointOut = () => {
        if (rng.chance(0.35)) { const c = rng.pick([[bx.x - 1, bx.y + 3], [bx.x + bx.w, bx.y + 3], [bx.x + 7, bx.y - 1], [bx.x + 7, bx.y + bx.h], [bx.x - 1, bx.y - 1], [bx.x + bx.w, bx.y + bx.h]]); st.edge++; return c; }
        return [rng.int(0, 511), rng.int(0, 191)];
      };
      const down = pointIn();
      const nf = rng.int(1, 8), frames = [];
      let pos = down.slice();
      for (let f = 0; f < nf - 1; f++) {
        const ev = [];
        if (rng.chance(0.65)) { const p = rng.chance(0.5) ? pointIn() : pointOut(); ev.push({ t: 'move', px: p[0], py: p[1] }); pos = p; st.moves++; }
        if (rng.chance(0.2)) { ev.push({ t: 'key', key: rng.pick([17, 27, 3, 13, 32, 65, 14]) }); st.keysDropped++; }
        if (rng.chance(0.1)) { const p = pointOut(); ev.push({ t: 'down', px: p[0], py: p[1] }); }
        frames.push(ev);
      }
      // the E_UP: at the pointer's last place (what a real E_UP is) or, half the time, somewhere else: SHELL 10.1 says "E_UP: if it is pressed", the state the E_MOVEs left, not the E_UP's point
      const up = rng.chance(0.5) ? pos.slice() : rng.chance(0.5) ? pointIn() : pointOut();
      frames.push([{ t: 'up', px: up[0], py: up[1] }]);
      const via = rng.chance(0.5) ? 'TK' : 'K';
      const spec = { wins: wlist, down, frames, via, tracking: true };
      const label = `case ${ci}: ${via}_DISPATCH, window (${rc.x}, ${rc.y}, ${rc.w}, ${rc.h}) id ${id}${wlist.length > 1 ? ` over a ${wlist[0].kind}(${wlist[0].x},${wlist[0].y},${wlist[0].w},${wlist[0].h})` : ''}, press (${down}), frames ${JSON.stringify(frames.map((f) => f.map((e) => (e.t === 'move' ? `m${e.px},${e.py}` : e.t === 'up' ? `up${e.px},${e.py}` : e.t === 'down' ? `d${e.px},${e.py}` : `k${e.key}`))))}`;
      const out = trackOnce(spec, label);
      if (!out) continue;
      st.cases++; st.via[via]++;
      sec.ok(out.r.di === 0 && out.r.badSp === undefined, () => `${label}: DI ${out.r.di}, SP ${out.r.badSp && hex(out.r.badSp)}`);
      sec.ok(out.r.halts === frames.length, () => `${label}: ${out.r.halts} HALTs, the script has ${frames.length} frames`);
      for (const s of out.states) { sec.ok(s.d === null, () => `${label}: at the HALT after ${s.k} frame(s) the screen (the box ${s.pressed ? 'pressed' : 'not pressed'}): ${s.d}`); if (s.pressed) st.pressedLooks++; else st.unpressedLooks++; }
      const inUp = SM.inBox(main, pos[0], pos[1]);                      // pressed when the E_UP arrives: the last E_DOWN / E_MOVE point decides (10.1)
      if (inUp) {
        st.closed++;
        sec.ok(out.posted.length === 1, () => `${label}: released with the box pressed (the last point (${pos}) in it): ${out.posted.length} E_CMD posted, want 1`);
        const p = out.posted[0];
        if (p) sec.ok(p.a === SM.E.CMD && p.c === id && p.e === out.front.slot && p.d === 0, () => `${label}: the post is A ${p.a} C ${p.c} E ${p.e} D ${p.d}, want E_CMD (10), View_id ${id}, slot ${out.front.slot}, 0`);
        sec.ok(m.ram[out.front.a + S.Window_slot] === out.front.slot && T.rd16(m, S.W_SLOTS + 2 * out.front.slot) === out.front.a, () => `${label}: the window must stay open (the program decides what closing means)`);
      } else {
        st.aborted++;
        sec.ok(out.posted.length === 0, () => `${label}: released with the box not pressed (the last point (${pos}) outside it): ${out.posted.length} E_CMD posted, want 0`);
      }
      const d = screenIs(false);
      sec.ok(d === null, () => `${label}: after the release the screen (box not pressed): ${d}`);
      sec.ok(T.rd16(m, S.K_CAPTURE) === 0 || true, '');
      st.halts += out.r.halts;
    }
    sec.end(`${st.cases} scripts (${st.via.TK} via TK_DISPATCH, ${st.via.K} via K_DISPATCH): ${st.closed} released in the box (E_CMD), ${st.aborted} released outside (none); ${st.moves} moves, ${st.pressedLooks} pressed and ${st.unpressedLooks} released screens compared, ${st.keysDropped} keys dropped, ${st.edge} points just outside the box edges, ${st.halts} frames`);
    clear();
  }
  // ---- 3c. a press just outside the box, or on a window that is not in front: no tracking, no E_CMD
  {
    const sec = new Sec('3c a press just outside the close box (the title bar: the kernel\'s drag), or in the box of a CWindow that is not in front (WINDOWS 17.3: the first click raises it): no E_CMD, no pressed box; the raised window shows its box');
    const st = { outside: 0, back: 0 };
    for (let ci = 0; ci < Math.max(40, NTRACK / 4) && sec.nf < 8; ci++) {
      const rc = randRect(), id = rng.int(0, 255), bx = SM.boxRect(rc.x, rc.y, rc.w);
      const kind = rng.chance(0.5) ? 'outside' : 'back';
      if (kind === 'outside') {
        // each point is in the title bar (rows y..y+8) but not in the box
        const p = rng.pick([[bx.x - 1, bx.y + 3], [bx.x + bx.w, bx.y + 3], [bx.x + 6, rc.y], [bx.x + 6, rc.y + 8], [rc.x + 2, rc.y + 4], [rc.x + rc.w - 2, rc.y + 4]]);
        const spec = { wins: [{ kind: 'CWindow', ...rc, title: 'T', id }], down: p, frames: [[{ t: 'up', px: p[0], py: p[1] }]], via: rng.chance(0.5) ? 'TK' : 'K', tracking: false };
        const out = trackOnce(spec, `outside ${p}`);
        if (!out) continue;
        st.outside++;
        sec.ok(out.posted.length === 0, () => `press at (${p}) just outside the box of (${rc.x}, ${rc.y}, ${rc.w}): ${out.posted.length} E_CMD posted`);
        const d = screenIs(false); sec.ok(d === null, () => `press at (${p}) outside the box of (${rc.x}, ${rc.y}, ${rc.w}): screen ${d}`);
      } else {
        // a CWindow behind a window placed so that the point of its box stays uncovered
        let front = null;
        for (let t = 0; t < 30 && !front; t++) { const o = randRect(); if (o.x + o.w <= bx.x || o.x >= bx.x + bx.w || o.y + o.h <= bx.y || o.y >= bx.y + bx.h) front = o; }
        if (!front) continue;
        const p = [rng.int(bx.x, bx.x + bx.w - 1), rng.int(bx.y, bx.y + bx.h - 1)];
        const spec = { wins: [{ kind: 'CWindow', ...rc, title: 'Back', id }, { kind: rng.pick(['Window', 'CWindow']), ...front, title: 'Front', id: 7 }], down: p, frames: [[{ t: 'up', px: p[0], py: p[1] }]], via: rng.chance(0.5) ? 'TK' : 'K', tracking: false, raised: true };
        // the press raises the back window (and its drag ends at once)
        const backW = null; void backW;
        clear();
        for (const w of spec.wins) open(w.kind, w, w.title, w.id);
        const bw = wins[0];
        const posted = [];
        T.drainEvents(env); T.setVframes(env, 1000);
        T.setEv(env, T.ptRec(SM.E.DOWN, p[0], p[1], 1));
        let wk = 0, dAtHalt = null;
        try {
          T.runCall(env, spec.via === 'TK' ? S.TK_DISPATCH : S.K_DISPATCH, {}, { onPost: (q) => posted.push(q), onHalt: () => { if (wk === 0) { wins.splice(wins.indexOf(bw), 1); wins.push(bw); dAtHalt = screenIs(false); } wk++; if (wk > 1) throw new Error('a second HALT'); T.setVframes(env, 1001); T.ringPut(env, T.ptRec(SM.E.UP, p[0], p[1], 0)); } });
        } catch (e) { sec.ok(false, `back box ${p}: ${e.message}`); T.drainEvents(env); continue; }
        st.back++;
        sec.ok(posted.length === 0, () => `press at (${p}) in the box of a CWindow behind: ${posted.length} E_CMD posted (the box counts only on the front window)`);
        sec.ok(dAtHalt === null, () => `press at (${p}) in the box of the back CWindow (${rc.x}, ${rc.y}, ${rc.w}) under ${front.x},${front.y},${front.w},${front.h}: raised, the screen at the first frame: ${dAtHalt}`);
        const d = screenIs(false); sec.ok(d === null, () => `after the click on the back CWindow's box: screen ${d}`);
      }
    }
    sec.end(`${st.outside} presses just outside the box, ${st.back} presses in the box of a back CWindow`);
    clear();
  }
  // ---- 3d. TK_DISPATCH and the key CLOSE (17)
  {
    const sec = new Sec('3d TK_DISPATCH (10.1): E_KEY CLOSE (17) with a CWindow in front posts E_CMD (C View_id, E slot); with a plain Window in front, or any other key, it posts nothing; every other event goes to K_DISPATCH');
    const st = { close: 0, plain: 0, other: 0, tab: 0 };
    for (let ci = 0; ci < 60 && sec.nf < 8; ci++) {
      clear();
      const a = randRect(), b = randRect(), idA = rng.int(0, 255), idB = rng.int(0, 255);
      const frontKind = rng.pick(['CWindow', 'Window']);
      open(rng.pick(['CWindow', 'Window']), a, 'Back', idA);
      const fw = open(frontKind, b, 'Front', idB);
      const key = rng.chance(0.6) ? 17 : rng.pick([97, 27, 3, 13, 32, 65, 14, 15]);
      const posted = [];
      T.drainEvents(env); T.setEv(env, [SM.E.KEY, key, 0, 0]);
      const before = T.readDisp(m);
      const r = T.runCall(env, S.TK_DISPATCH, {}, { onPost: (p) => posted.push(p), allowHalt: true, onHalt: () => { throw new Error('TK_DISPATCH of a key waits for a frame'); } });
      const after = T.readDisp(m), same = T.diffDisp(before, after);
      sec.ok(r.di === 0 && r.badSp === undefined, () => `key ${key}: DI ${r.di}, SP ${r.badSp && hex(r.badSp)}`);
      if (key === 17 && frontKind === 'CWindow') {
        st.close++;
        sec.ok(posted.length === 1 && posted[0].a === SM.E.CMD && posted[0].c === idB && posted[0].e === fw.slot && posted[0].d === 0, () => `CLOSE with a CWindow in front: posts ${JSON.stringify(posted)}, want one E_CMD (10) C ${idB} E ${fw.slot} D 0`);
        sec.ok(T.rd16(m, S.W_SLOTS + 2 * fw.slot) === fw.a, 'the CWindow stays open (the program decides)');
      } else {
        if (key === 17) st.plain++; else st.other++;
        sec.ok(posted.length === 0, () => `key ${key} with a ${frontKind} in front: ${posted.length} post(s) ${JSON.stringify(posted)}, want none`);
      }
      sec.ok(same === null, () => `key ${key} (${frontKind} in front): the screen changed: ${same}`);
    }
    sec.end(`${st.close} CLOSE keys on a front CWindow, ${st.plain} CLOSE keys on a front plain Window (dropped), ${st.other} other keys`);
    clear();
  }
  // ======================================================================================================================
  // LOOK 7 rows (docs/LOOK.md 3, 7): each element of the look against the contract's own statements (pixel by pixel, written here, not taken from look-model), and against the
  // model's whole screen.  The desk is the 25% pattern ($88 on even rows, $22 on odd rows; bit 7 the leftmost pixel).
  const dispBit = (d, x, y) => (d[y * 64 + (x >> 3)] >> (7 - (x & 7))) & 1;
  const deskBit = (x, y) => (((y & 1) ? 0x22 : 0x88) >> (7 - (x & 7))) & 1;
  const longTitle = () => { const n = rng.int(0, 30); let s = ''; for (let k = 0; k < n; k++) s += rng.pick('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '); return s; };
  const stackModel = () => SM.paintWindows(wins.map((q) => ({ kind: q.kind, x: q.x, y: q.y, w: q.w, h: q.h, title: q.title })), {});
  // ---- 3e. the desk (25% grey) and the menu bar (paper rows 0-6, a line at row 7)
  {
    const sec = new Sec('3e the desk is the 25% pattern ($88 / $22) over (0, 8, 512, 184) and the bar is paper rows 0-6 with an ink line at row 7 (LOOK 3.1, 3.4): on an empty desk, with a window open, and after it is closed (the repaint); the whole screen against the look model');
    const check = (what) => {
      const d = T.readDisp(m), mk = L.pointerMask(m, S);
      const free = (x, y) => !wins.some((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
      let bad = 0, first = '';
      for (let y = 8; y < 192; y++) for (let x = 0; x < 512; x++) if (free(x, y) && dispBit(d, x, y) !== deskBit(x, y)) { bad++; if (!first) first = `(${x}, ${y}) is ${dispBit(d, x, y)}, want ${deskBit(x, y)}`; }
      sec.ok(bad === 0, () => `${what}: ${bad} desk pixel(s) off the 25% pattern, first ${first}`);
      let line = 0; for (let x = 0; x < 512; x++) line += dispBit(d, x, 7);
      sec.ok(line === 512, () => `${what}: the bar's line (row 7) has ${line} ink pixels, want 512`);
      let ink = 0; for (let y = 0; y < 7; y++) for (let x = 120; x < 512; x++) ink += dispBit(d, x, y);   // right of the title "Leap": paper
      sec.ok(ink === 0, () => `${what}: ${ink} ink pixels in the bar's rows 0-6 right of the title`);
      const df = T.diffDisp(d, SM.toDisp(stackModel()), mk);
      sec.ok(df === null, () => `${what}: the whole screen against the model: ${df}`);
    };
    clear(); check('empty desk');
    const w = open('Window', { x: 128, y: 48, w: 256, h: 96 }, 'Temp', 1); check('a window open');
    close(w); check('after the window is closed');
    sec.end('3 screens: 184 desk rows, the bar\'s line and paper rows');
    clear();
  }
  // ---- 3f. a window's pixels, LOOK 3.2
  {
    const sec = new Sec('3f a window (LOOK 3.2): frame (x, y, w-2, h-1), shadow (x+w-2, y+1, 2, h-1) and (x+2, y+h-1, w-2, 1), the two corners paper, the separator (x+1, y+8, w-4), the stripes at y+2, y+4, y+6 from x+2 for w-6 on the active window only, the title cut to w-66 and centred at x + floor((w-2-tw)/2) with a paper gap of 6 each side on the active bar, the content paper; the whole screen against the model; windows 48 to 320 wide (the narrow ones cut their titles)');
    const st = { screens: 0, active: 0, inactive: 0, cut: 0, empty: 0, narrow: 0 };
    for (let i = 0; i < 60 && sec.nf < 8; i++) {
      clear();
      const w = 16 * rng.int(3, 20), h = 8 * rng.int(2, 15), x = 16 * rng.int(0, (512 - w) / 16), y = 8 * rng.int(1, (192 - h) / 8);
      const title = longTitle(), kind = rng.pick(['Window', 'CWindow']), act = rng.chance(0.6);
      const oc = [{ x: 0, y: 8 }, { x: 416, y: 8 }, { x: 0, y: 160 }, { x: 416, y: 160 }].find((o) => o.x + 96 <= x || o.x >= x + w || o.y + 32 <= y || o.y >= y + h);
      const other = { x: oc.x, y: oc.y, w: 96, h: 32 };
      let me;
      try {
        if (act) { open('Window', other, 'Other', 2); me = open(kind, { x, y, w, h }, title, 3); }
        else { me = open(kind, { x, y, w, h }, title, 3); open('Window', other, 'Other', 2); }
      } catch (e) { sec.ok(false, `window (${x}, ${y}, ${w}, ${h}) refused: ${e.message}`); continue; }
      const d = T.readDisp(m), b = (xx, yy) => dispBit(d, xx, yy);
      st.screens++; if (act) st.active++; else st.inactive++; if (w < 112) st.narrow++;
      const ones = (x0, y0, w0, h0) => { let n = 0; for (let yy = y0; yy < y0 + h0; yy++) for (let xx = x0; xx < x0 + w0; xx++) n += b(xx, yy); return n; };
      const tag = `window (${x}, ${y}, ${w}, ${h}) ${kind} ${act ? 'active' : 'inactive'} "${title}"`;
      sec.ok(ones(x, y, w - 2, 1) === w - 2 && ones(x, y + h - 2, w - 2, 1) === w - 2 && ones(x, y, 1, h - 1) === h - 1 && ones(x + w - 3, y, 1, h - 1) === h - 1, () => `${tag}: the frame (x, y, w-2, h-1) is not all ink`);
      sec.ok(ones(x + w - 2, y + 1, 2, h - 1) === 2 * (h - 1) && ones(x + 2, y + h - 1, w - 2, 1) === w - 2, () => `${tag}: the shadow is not all ink`);
      sec.ok(ones(x + w - 2, y, 2, 1) === 0 && ones(x, y + h - 1, 2, 1) === 0, () => `${tag}: a corner the shadow leaves is not paper`);
      sec.ok(ones(x + 1, y + 8, w - 4, 1) === w - 4, () => `${tag}: the separator (x+1, y+8, w-4) is not all ink`);
      sec.ok(ones(x + 1, y + 9, w - 4, h - 11) === 0, () => `${tag}: the content (x+1, y+9, w-4, h-11) holds ${ones(x + 1, y + 9, w - 4, h - 11)} ink pixels, want 0`);
      const codes = SM.codesOf(title); let n = 0; for (let k = 1; k <= codes.length; k++) if (g0.textw(codes.slice(0, k)) <= w - 66) n = k;
      const tws = n ? g0.textw(codes.slice(0, n)) : 0, tx = x + Math.floor((w - 2 - tws) / 2);
      if (n < codes.length) st.cut++; if (n === 0) st.empty++;
      for (const r of [2, 4, 6]) {
        let bad = 0;
        for (let xx = x + 2; xx < x + w - 4; xx++) {
          if (act && kind === 'CWindow' && xx >= x + 8 && xx < x + 23) continue;       // the close box's zone
          const inGap = n > 0 && xx >= tx - 6 && xx < tx + tws + 6, titleCol = n > 0 && xx >= tx && xx < tx + tws;
          if (!act) { if (!titleCol && b(xx, y + r) !== 0) bad++; }                    // inactive: no stripes, paper but for the title's own pixels
          else if (inGap) { if (!titleCol && b(xx, y + r) !== 0) bad++; }
          else if (b(xx, y + r) !== 1) bad++;
        }
        sec.ok(bad === 0, () => `${tag}: stripe row y+${r} has ${bad} wrong pixel(s) (title ${n} codes, width ${tws}, tx ${tx}, gap ${tx - 6}..${tx + tws + 5})`);
      }
      const df = T.diffDisp(d, SM.toDisp(stackModel()), L.pointerMask(m, S));
      sec.ok(df === null, () => `${tag}: the whole screen against the model: ${df}`);
      void me;
    }
    sec.end(`${st.screens} windows (${st.active} active, ${st.inactive} inactive, ${st.narrow} narrower than 112), ${st.cut} with a cut title, ${st.empty} whose title is cut to nothing (no gap)`);
    clear();
  }
  // ---- 3g. the close box's hit rectangle (x+8, y+1, 15, 7), at the left
  {
    const sec = new Sec('3g the close box hit rectangle (LOOK 3.3): a press at each corner and the centre of (x+8, y+1, 15, 7) tracks (pressed look) and posts one E_CMD on release; a press just outside it (left, right, above, below) or at the old place on the right (x+w-19 ..) posts nothing and leaves the screen as it was');
    const st = { inside: 0, outside: 0 };
    for (const rc of [{ x: 0, y: 8, w: 96, h: 32 }, { x: 128, y: 48, w: 256, h: 96 }, { x: 192, y: 80, w: 320, h: 112 }]) {
      const bx = SM.boxRect(rc.x, rc.y, rc.w), id = 40 + st.inside;
      for (const p of [[bx.x, bx.y], [bx.x + bx.w - 1, bx.y], [bx.x, bx.y + bx.h - 1], [bx.x + bx.w - 1, bx.y + bx.h - 1], [bx.x + 7, bx.y + 3]]) {
        const out = trackOnce({ wins: [{ kind: 'CWindow', ...rc, title: 'Box', id }], down: p, frames: [[{ t: 'up', px: p[0], py: p[1] }]], via: st.inside % 2 ? 'TK' : 'K', tracking: true }, `inside ${p}`);
        if (!out) { sec.ok(false, `press at ${p} did not run`); continue; }
        st.inside++;
        sec.ok(out.posted.length === 1 && out.posted[0].a === SM.E.CMD && out.posted[0].c === id, () => `press and release at (${p}) in the box of (${rc.x}, ${rc.y}, ${rc.w}): posts ${JSON.stringify(out.posted)}, want one E_CMD with C ${id}`);
        sec.ok(out.states.length > 0 && out.states.every((s) => s.pressed), () => `press at (${p}): the box was not tracked as pressed at the HALT`);
        for (const s of out.states) sec.ok(s.d === null, () => `press at (${p}): the screen with the box pressed: ${s.d}`);
        const d = screenIs(false); sec.ok(d === null, () => `after the release at (${p}): the screen ${d}`);
      }
      for (const p of [[bx.x - 1, bx.y], [bx.x - 1, bx.y + bx.h - 1], [bx.x + bx.w, bx.y], [bx.x + bx.w, bx.y + bx.h - 1], [bx.x, bx.y - 1], [bx.x + bx.w - 1, bx.y - 1], [bx.x, bx.y + bx.h], [bx.x + bx.w - 1, bx.y + bx.h], [rc.x + rc.w - 12, rc.y + 4], [rc.x + rc.w - 19 + 2, rc.y + 3]]) {
        const out = trackOnce({ wins: [{ kind: 'CWindow', ...rc, title: 'Box', id }], down: p, frames: [[{ t: 'up', px: p[0], py: p[1] }]], via: st.outside % 2 ? 'TK' : 'K', tracking: false }, `outside ${p}`);
        if (!out) { sec.ok(false, `press at ${p} did not run`); continue; }
        st.outside++;
        sec.ok(out.posted.length === 0, () => `press at (${p}) outside the box of (${rc.x}, ${rc.y}, ${rc.w}): ${out.posted.length} E_CMD posted, want 0`);
        const d = screenIs(false); sec.ok(d === null, () => `press at (${p}) outside the box of (${rc.x}, ${rc.y}, ${rc.w}): the screen ${d}`);
      }
    }
    sec.end(`${st.inside} presses inside (corners and centre), ${st.outside} presses outside (8 around it, 2 at the old place on the right)`);
    clear();
  }
  // ---- 3h. the drag outline over the desk and over a window (WINDOWS 17.4, unchanged)
  {
    const sec = new Sec('3h the drag outline (WINDOWS 17.4, unchanged by the look): while a window is dragged the screen is the stack with the XOR of the 1-pixel frame at the candidate (x, y, w, h) (dotted over the desk, solid over a window\'s paper), none at the start place; on E_UP it is erased and the window is moved');
    const st = { cases: 0, overDesk: 0, overWin: 0, moved: 0, held: 0 };
    const outline = (g, cx, cy, w, h) => {
      const f = (xx, yy) => { if (xx >= 0 && xx < 512 && yy >= 0 && yy < 192) g.set(xx, yy, g.get(xx, yy) ^ 1); };
      for (let i = 0; i < w; i++) { f(cx + i, cy); f(cx + i, cy + h - 1); }
      for (let j = 1; j < h - 1; j++) { f(cx, cy + j); f(cx + w - 1, cy + j); }
    };
    for (let ci = 0; ci < 40 && sec.nf < 8; ci++) {
      clear();
      const rc = randRect(), kind = rng.pick(['Window', 'CWindow']);
      let under = null;
      if (ci % 4 !== 0) { const o = randRect(); if (o.x !== rc.x || o.y !== rc.y) under = o; }
      if (under) open('Window', under, 'Under', 5);
      const A = open(kind, rc, 'Drag', 6);
      const p0 = [rc.x + 3, rc.y + 4];                                   // the title bar, left of a close box
      const clampP = (q) => [Math.min(Math.max(q[0], 0), 511), Math.min(Math.max(q[1], 0), 191)];     // a pointer position is on the screen
      const pts = [clampP([p0[0] + 16 * rng.int(-6, 6) + rng.int(-7, 7), p0[1] + 8 * rng.int(-4, 4) + rng.int(-3, 3)]), clampP([p0[0] + 16 * rng.int(-6, 6), p0[1] + 8 * rng.int(-4, 4)])];
      const cand = (p) => ({ x: Math.min(Math.max(rc.x + 16 * Math.floor((p[0] - p0[0] + 8) / 16), 0), 512 - rc.w), y: Math.min(Math.max(rc.y + 8 * Math.floor((p[1] - p0[1] + 4) / 8), 8), 192 - rc.h) });
      const evs = [{ t: 'move', p: pts[0] }, { t: 'move', p: pts[1] }, { t: 'up', p: pts[1] }];
      let wakes = 0, c = { x: rc.x, y: rc.y }, err = null;
      T.drainEvents(env); T.setVframes(env, 1000);
      T.setEv(env, T.ptRec(SM.E.DOWN, p0[0], p0[1], 1));
      const want = () => { const g = stackModel(); if (c.x !== rc.x || c.y !== rc.y) outline(g, c.x, c.y, rc.w, rc.h); return g; };
      try {
        T.runCall(env, S.K_DISPATCH, {}, {
          onHalt: () => {
            const d = T.diffDisp(T.readDisp(m), SM.toDisp(want())); if (d) err ||= `at the HALT after ${wakes} event(s), candidate (${c.x}, ${c.y}): ${d}`;
            if (wakes >= evs.length) throw new Error('the drag loop still waits after the E_UP');
            const e = evs[wakes++]; T.setVframes(env, 1000 + wakes);
            T.ringPut(env, e.t === 'up' ? T.ptRec(SM.E.UP, e.p[0], e.p[1], 0) : T.ptRec(SM.E.MOVE, e.p[0], e.p[1], 1));
            c = cand(e.p);
          },
        });
      } catch (e) { sec.ok(false, `case ${ci}: ${e.message}`); T.drainEvents(env); continue; }
      T.runCall(env, S.W_UPDATE, {}, { ints: false });                      // W_DRAG ends with W_MOVE: the repaint is W_UPDATE's
      st.cases++;
      const label = `case ${ci}: ${kind} (${rc.x}, ${rc.y}, ${rc.w}, ${rc.h})${under ? ` over (${under.x}, ${under.y}, ${under.w}, ${under.h})` : ''}, press (${p0}), moves ${JSON.stringify(pts)}`;
      sec.ok(err === null, () => `${label}: ${err}`);
      if (c.x !== rc.x || c.y !== rc.y) { st.moved++; A.x = c.x; A.y = c.y; }
      const d = screenIs(false); sec.ok(d === null, () => `${label}: after the release (window at (${A.x}, ${A.y})): ${d}`);
      sec.ok(T.rd16(m, S.W_SLOTS + 2 * A.slot) === A.a, () => `${label}: the window must be open still`);
      const cands = [cand(pts[0]), cand(pts[1])];
      if (cands.some((q) => q.x !== rc.x || q.y !== rc.y)) {
        st.held++;
        if (under && cands.some((q) => q.x < under.x + under.w && q.x + rc.w > under.x && q.y < under.y + under.h && q.y + rc.h > under.y)) st.overWin++; else st.overDesk++;
      }
    }
    sec.ok(st.overDesk > 0 && st.overWin > 0, () => `the scripts must cover the outline over the desk (${st.overDesk}) and over a window (${st.overWin})`);
    sec.end(`${st.cases} drags (${st.moved} moved, ${st.held} with an outline shown: ${st.overDesk} clear of other windows, ${st.overWin} over a window)`);
    clear();
  }
  void CW;
}

// ===========================================================================================================================
// 4. The About dialog
function aboutGroup() {
  const sec = new Sec('4 About Leap Desktop... (menu "Leap", item 1): a Dialog (128, 64, 256, 64) with the Label "Leap Desktop, step 5" (144, 76, 224, 18; the alert of the app library, APPLIB 5) and the OK Button (304, 100, 64, 16), the default and the cancel; opens, closes by the mouse (OK), ENTER, ESC and BREAK, reopens; modal; the shell as before');
  const env = mkShell(), { m, S } = env;
  const icons = H.iconAddrs(env);
  const base0 = H.captureState(env);
  const st = { open: 0, byOK: 0, byEnter: 0, byEsc: 0, byBreak: 0, modalClicks: 0, focusKept: 0, focusMoved: 0 };
  const closers = ['ok', 'enter', 'esc', 'break'];
  for (let i = 0; i < NDIALOG && sec.nf < 10; i++) {
    // sometimes start with the second icon focused (TAB), to see where the focus comes back to
    const pre = rng.chance(0.4) ? 1 : 0;
    if (pre) { L.typeCode(env, 14); env.frames_(3); }
    const focusBefore = rd16(m, S.K_FOCUS);
    H.leapMenu(env, 1);
    env.frames_(4);
    const ws = L.openWindows(m, S);
    const dlg = ws.find((w) => w.cls === S.CL_Dialog);
    sec.ok(ws.length === 2 && !!dlg && [dlg.x, dlg.y, dlg.w, dlg.h].join() === '128,64,256,64', () => `opening ${i}: windows ${JSON.stringify(ws.map((w) => [hex(w.cls), w.title, w.x, w.y, w.w, w.h]))}, want the shell window and a Dialog at (128, 64, 256, 64)`);
    if (!dlg) { sec.note(`the dialog did not open at opening ${i}`); break; }
    st.open++;
    const kids = []; for (let v = dlg.child; v; v = L.readView(m, S, v).next) kids.push(L.readView(m, S, v));
    const lbl = kids.find((k) => k.cls === S.CL_Label), btn = kids.find((k) => k.cls === S.CL_Button);
    sec.ok(!!lbl && [lbl.x, lbl.y, lbl.w, lbl.h].join() === '144,76,224,18' && H.readStrText(m, rd16(m, lbl.a + S.Label_text)) === 'Leap Desktop, step 5', () => `Label ${lbl && [lbl.x, lbl.y, lbl.w, lbl.h]} "${lbl && H.readStrText(m, rd16(m, lbl.a + S.Label_text))}"`);
    sec.ok(!!btn && [btn.x, btn.y, btn.w, btn.h].join() === '304,100,64,16' && H.readStrText(m, rd16(m, btn.a + S.Button_text)) === 'OK', () => `Button ${btn && [btn.x, btn.y, btn.w, btn.h]} "${btn && H.readStrText(m, rd16(m, btn.a + S.Button_text))}"`);
    sec.ok(!!btn && rd16(m, dlg.a + S.Dialog_default) === btn.a && rd16(m, dlg.a + S.Dialog_cancel) === btn.a, () => `Dialog_default ${hex(rd16(m, dlg.a + S.Dialog_default))}, Dialog_cancel ${hex(rd16(m, dlg.a + S.Dialog_cancel))}, the button is ${btn && hex(btn.a)}`);
    sec.ok(rd16(m, S.W_MODAL) === dlg.a, () => `W_MODAL ${hex(rd16(m, S.W_MODAL))}, the dialog is ${hex(dlg.a)}`);
    const dd = H.shellDiff(env);
    sec.ok(dd === null, () => `opening ${i}: the screen with the dialog up: ${dd}`);
    // modal: a double click on the first icon (fully visible) does nothing while the dialog is up
    if (rng.chance(0.5)) {
      H.clickIcon(env, 1, 3, 3); H.clickIcon(env, 1, 3, 3); env.frames_(6); st.modalClicks++;
      sec.ok(m.ram[S.K_PROG] === 0 && L.openWindows(m, S).length === 2, () => `a double click on an icon under the modal dialog: K_PROG ${m.ram[S.K_PROG]}, windows ${L.openWindows(m, S).length}`);
      const dm = H.shellDiff(env); sec.ok(dm === null, () => `after a double click under the modal dialog: ${dm}`);
    }
    // close it
    const how = closers[i % 4];
    if (how === 'ok') { L.click(env, 336, 108, 3, 6); st.byOK++; }
    else if (how === 'enter') { L.typeCode(env, 13); st.byEnter++; }
    else if (how === 'esc') { L.typeCode(env, 27); st.byEsc++; }
    else { L.typeCode(env, 3); st.byBreak++; }
    env.frames_(4);
    const ws2 = L.openWindows(m, S);
    sec.ok(ws2.length === 1 && ws2[0].title === 'Leap Desktop', () => `closed by ${how}: windows ${JSON.stringify(ws2.map((w) => w.title))}`);
    sec.ok(rd16(m, S.W_MODAL) === 0 && rd16(m, S.K_CAPTURE) === 0 && m.ram[S.K_PROG] === 0, () => `closed by ${how}: W_MODAL ${hex(rd16(m, S.W_MODAL))}, K_CAPTURE ${hex(rd16(m, S.K_CAPTURE))}, K_PROG ${m.ram[S.K_PROG]}`);
    const foc = rd16(m, S.K_FOCUS);
    sec.ok(icons.includes(foc), () => `closed by ${how}: K_FOCUS ${hex(foc)} is not one of the icons ${icons.map((a) => hex(a))}`);
    if (foc === focusBefore) st.focusKept++; else st.focusMoved++;
    const d = H.shellDiff(env);
    sec.ok(d === null, () => `closed by ${how}: the shell screen (selection follows K_FOCUS ${hex(foc)}): ${d}`);
    if (pre) { /* the focus is left where the dialog put it; the next opening shows the other state */ }
    const post = H.postedQ(env);
    sec.ok(post.length === 0, () => `closed by ${how}: posted queue ${JSON.stringify(post)}`);
  }
  // the dialog's arena: opening and closing it again and again does not grow the arena beyond the first open (K_FREE, WINDOWS 17: the dialog's views are freed)
  const top1 = rd16(m, S.K_AARENA);
  for (let i = 0; i < 6; i++) { H.leapMenu(env, 1); L.typeCode(env, 13); env.frames_(4); }
  const top2 = rd16(m, S.K_AARENA);
  sec.ok(top2 <= top1 + 0x30, () => `app arena top ${hex(top1)} -> ${hex(top2)} after 6 more openings: the dialog's blocks should be reused`);
  sec.note(`K_FOCUS after the dialog came back to the icon focused before it ${st.focusKept} times, and to another icon ${st.focusMoved} times (the contract does not say; the screen follows K_FOCUS)`);
  // leaving for a program with the dialog closed: the shell is fresh
  const ok = L.launchByDoubleClick(env, 1); env.frames_(4);
  sec.ok(ok, 'a program starts after the dialog has been used');
  if (ok) { sec.ok(L.quitBySSQ(env), 'and the shell comes back'); env.frames_(4); const dd = H.compareStates(env, base0, H.captureState(env), 'after using the About dialog and a launch'); sec.ok(dd.length === 0, () => dig(dd)); }
  sec.end(`${st.open} openings (closed by OK ${st.byOK}, ENTER ${st.byEnter}, ESC ${st.byEsc}, BREAK ${st.byBreak}); ${st.modalClicks} double clicks under the modal dialog`);
}

// ===========================================================================================================================
// 5. SYMBOL SHIFT + Q with the About dialog up does nothing (SHELL 12: with no dialog it closes the shell's window: group 7)
function ssqGroup() {
  const sec = new Sec('5 SYMBOL SHIFT + Q (CLOSE, 17) with the About dialog up does nothing: the front window is a Dialog, not a CWindow, so the key is dropped (and the shell\'s window under it is not closed); K_PROG, the windows, the focus, the posted queue and the screen stay');
  const env = mkShell(), { m, S } = env;
  const icons = H.iconAddrs(env);
  let n = 0;
  for (let i = 0; i < 6 && sec.nf < 8; i++) {
    if (i === 3) { L.typeCode(env, 14); env.frames_(3); }                    // another icon focused when the dialog opens
    H.leapMenu(env, 1); env.frames_(4);
    sec.ok(L.openWindows(m, S).length === 2 && rd16(m, S.W_MODAL) !== 0, () => `SS+Q #${i}: the dialog did not open`);
    const before = H.captureState(env, 2);
    L.typeCode(env, 17, 3, 3); n++;
    L.typeCode(env, 17, 40, 6);                       // held through the key's repeat
    env.frames_(4);
    const after = H.captureState(env, 2);
    const diffs = H.compareStates(env, before, after, `SS+Q #${i}`, true);
    sec.ok(diffs.length === 0, () => dig(diffs));
    sec.ok(m.ram[S.K_PROG] === 0 && L.openWindows(m, S).length === 2 && m.ram[S.S_OPEN] === 1, () => `SS+Q #${i}: K_PROG ${m.ram[S.K_PROG]}, windows ${L.openWindows(m, S).length}, S_OPEN ${m.ram[S.S_OPEN]}`);
    const d = H.shellDiff(env); sec.ok(d === null, () => `SS+Q #${i}: screen ${d}`);
    sec.ok(rd16(m, S.K_FOCUS) === H.okButton(env), () => `SS+Q #${i}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, the OK button is ${hex(H.okButton(env))}`);
    L.typeCode(env, 27); env.frames_(4);
    sec.ok(L.openWindows(m, S).length === 1 && icons.includes(rd16(m, S.K_FOCUS)), () => `SS+Q #${i}: after ESC: windows ${L.openWindows(m, S).length}, K_FOCUS ${hex(rd16(m, S.K_FOCUS))}`);
  }
  // the shell still works: a double click opens Calculator, and it comes back fresh
  const ok = L.launchByDoubleClick(env, 1); sec.ok(ok, 'the shell still launches after SS+Q presses'); env.frames_(4);
  if (ok) { sec.ok(L.quitBySSQ(env), 'SS+Q quits Calculator (a CWindow program)'); env.frames_(4); }
  sec.end(`${n} presses (plus repeats)`);
}

// ===========================================================================================================================
// 7. SHELL 12: the shell's window closes; Leap > Show Desktop
function shell12Group() {
  const sec = new Sec('7 SHELL 12: the shell\'s window (a CWindow, id 255) closes by its close box and by SS+Q (the desk and the bar stay, K_FOCUS 0, the window object kept, S_OPEN 0); SS+Q and other keys with no window do nothing; the Leap menu opens with it closed (open dropdown, 7 items) and About works; a program launched from the menu returns to an OPEN shell; Show Desktop reopens it as at start, or with it open changes nothing; the modal rule');
  const env = mkShell(), { m, S } = env;
  const icons = H.iconAddrs(env), sim = new SM.ShellSim();
  const base0 = H.captureState(env);                                                // the shell as at start
  const bx = L.closeBoxOf(32, 24, 320), bxc = [bx.x + (bx.w >> 1), bx.y + (bx.h >> 1)];
  const trail = [];
  const note = (t) => { trail.push(t); if (trail.length > 6) trail.shift(); };
  const LM = LMOD, lay = layoutOf([SM.LEAP_MENU]), en = [[true, true, true, true, true, true, true, true, true]];
  // the machine against the model (ShellSim): K_PROG, the windows, K_FOCUS, K_CAPTURE, W_MODAL, the posted queue, S_OPEN, the window object, the screen
  const verify = (what) => {
    env.frames_(2);
    const ws = L.openWindows(m, S), open = sim.open, ctx = `[${trail.join('; ')}]`;
    sec.ok(m.ram[S.K_PROG] === 0, () => `${what}: K_PROG ${m.ram[S.K_PROG]} ${ctx}`);
    sec.ok(ws.length === (open ? 1 : 0) && (!open || (ws[0].title === 'Leap Desktop' && ws[0].cls === S.CL_CWindow && ws[0].id === 255 && [ws[0].x, ws[0].y, ws[0].w, ws[0].h].join() === '32,24,384,80')),
      () => `${what}: windows ${JSON.stringify(ws.map((w) => [hex(w.cls), w.title, w.id, w.x, w.y, w.w, w.h]))}, want ${open ? 'the shell CWindow (32, 24, 320, 80) id 255' : 'none'} ${ctx}`);
    const want = open ? icons[sim.focus] : 0, got = rd16(m, S.K_FOCUS);
    sec.ok(got === want, () => `${what}: K_FOCUS ${hex(got)}, the model has ${open ? 'icon ' + sim.focus + ' ' + hex(want) : '0 (no window)'} ${ctx}`);
    sec.ok(rd16(m, S.K_CAPTURE) === 0 && rd16(m, S.W_MODAL) === 0 && H.postedQ(env).length === 0, () => `${what}: K_CAPTURE ${hex(rd16(m, S.K_CAPTURE))}, W_MODAL ${hex(rd16(m, S.W_MODAL))}, posted ${JSON.stringify(H.postedQ(env))} ${ctx}`);
    sec.ok(m.ram[S.S_OPEN] === (open ? 1 : 0), () => `${what}: S_OPEN ${m.ram[S.S_OPEN]}, want ${open ? 1 : 0} ${ctx}`);
    const wo = rd16(m, S.S_WIN);
    sec.ok(wo !== 0 && rd16(m, wo) === S.CL_CWindow, () => `${what}: S_WIN ${hex(wo)} is not the kept CWindow object ${ctx}`);
    const d = H.shellDiff(env); sec.ok(d === null, () => `${what}: screen ${d} ${ctx}`);
  };
  const closeBox = () => { L.click(env, bxc[0], bxc[1], 3, 6); env.frames_(4); sim.boxClose(); note('close box'); };
  const closeSSQ = (hold = 3) => { L.typeCode(env, 17, hold, 3); env.frames_(4); sim.key(17); note('SS+Q'); };
  const menuItem = (k) => { H.leapMenu(env, k); env.frames_(4); note(`Leap item ${k}`); };
  // `slack`: the About dialog's first opening after an arena reset takes its blocks (0x50 bytes) and keeps them for the next openings (it does not shrink the top: a kernel / applib fact, not SHELL 12's);
  // a comparison made after an About tolerates that growth in the app arena's top (and no other difference); after a program's quit (K_ARESET) and in the cycles the top is exact (slack 0).
  const cmp = (base, what, slack = 0, modal = false) => {
    const cur = H.captureState(env), d = H.compareStates(env, base, cur, what, modal).filter((t) => !(slack && t.includes('app arena top')));
    sec.ok(d.length === 0, () => dig(d));
    sec.ok(cur.top >= base.top && cur.top <= base.top + slack, () => `${what}: app arena top ${hex(cur.top)}, the baseline ${hex(base.top)} (slack ${slack})`);
  };
  const tab = (n) => { for (let i = 0; i < n; i++) { L.typeCode(env, 14); sim.key(14); env.frames_(3); } };
  // ---- 1. close by the close box, with the focus on another icon first
  verify('start');
  tab(2); verify('TAB x2');
  { // the box pressed: its look while the button is down (LOOK 3.3), then released inside: the window closes
    L.moveTo(env, bxc[0], bxc[1]); env.frames_(2); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
    const g = SM.renderShell({ sel: icons.indexOf(rd16(m, S.K_FOCUS)) }); LMOD.closeBoxLook(g, 32, 24, true);
    const d = H.diffDisp(H.readDisp(m), SM.toDisp(g), L.pointerMask(m, S)); sec.ok(d === null, () => `the close box held down: the pressed look: ${d}`);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(6); sim.boxClose(); note('close box (pressed look seen)'); }
  verify('closed by the close box');
  const closed1 = H.captureState(env);
  sec.ok(closed1.wins.length === 0 && closed1.focus === 0 && closed1.sp !== undefined, () => `closed: windows ${closed1.wins.length}, K_FOCUS ${hex(closed1.focus)}, the loop seen ${closed1.sp !== undefined}`);
  // ---- 2. SS+Q and other input with no window: nothing
  for (const hold of [3, 3, 40]) { closeSSQ(hold); verify(`SS+Q with no window (hold ${hold})`); cmp(closed1, `SS+Q with no window (hold ${hold})`); }
  for (const code of [14, 15, 10, 11, 8, 9, 13, 27, 3, 32]) { L.typeCode(env, code); env.frames_(3); note(`key ${code}`); }
  verify('other keys with no window'); cmp(closed1, 'other keys with no window');
  { const [cx, cy] = L.iconCentre(1); L.click(env, cx, cy, 3, 4); L.click(env, cx, cy, 3, 4); L.click(env, 300, 150, 3, 4); L.click(env, bxc[0], bxc[1], 3, 4); env.frames_(25); note('clicks where the window was'); }
  verify('clicks on the bare desk where the window was'); cmp(closed1, 'clicks on the bare desk');
  // ---- 3. the Leap menu with the window closed: the open dropdown (9 items) and its highlights
  {
    const mask = () => L.pointerMask(m, S);
    const screenWith = (h) => { const g = SM.renderShell({ sel: -1, open: false }); LM.openLook(g, [SM.LEAP_MENU], lay, en, 0, h); return g; };
    L.moveTo(env, 500, 180); env.frames_(3);
    L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
    { const d = H.diffDisp(H.readDisp(m), SM.toDisp(screenWith(-1)), mask()); sec.ok(d === null, () => `the menu open over the empty desk, no highlight: ${d}`); }
    for (const k of [0, 2, 3, 4, 5, 6, 7, 8]) { L.moveTo(env, 30, 9 + 10 * k + 5); env.frames_(3); const d = H.diffDisp(H.readDisp(m), SM.toDisp(screenWith(k)), mask()); sec.ok(d === null, () => `the menu open over the empty desk, item ${k} highlighted: ${d}`); }
    L.moveTo(env, 400, 150); env.frames_(3); m.mouse.buttons = L.MOUSE_UP; env.frames_(8); note('menu opened and closed with no window');
    verify('the menu released away from the items'); cmp(closed1, 'the menu released away from the items');
  }
  // ---- 4. About with no window: the alert shows (modal) and closes
  for (const how of ['esc', 'ok', 'enter', 'break']) {
    menuItem(1);
    const ws = L.openWindows(m, S), dlg = ws.find((w) => w.cls === S.CL_Dialog);
    sec.ok(ws.length === 1 && !!dlg && [dlg.x, dlg.y, dlg.w, dlg.h].join() === '128,64,256,64' && rd16(m, S.W_MODAL) === dlg.a, () => `About with no window (${how}): windows ${JSON.stringify(ws.map((w) => [hex(w.cls), w.title]))}, W_MODAL ${hex(rd16(m, S.W_MODAL))}`);
    { const d = H.shellDiff(env); sec.ok(d === null, () => `About over the empty desk: ${d}`); }
    // modal: SS+Q, the Leap menu (Show Desktop) and a click where the shell's window was change nothing
    L.typeCode(env, 17, 3, 3); H.leapMenu(env, 8); L.click(env, bxc[0], bxc[1], 3, 4); env.frames_(4);
    sec.ok(L.openWindows(m, S).length === 1 && rd16(m, S.W_MODAL) === dlg.a && m.ram[S.S_OPEN] === 0, () => `About with no window (${how}): under the modal dialog SS+Q, Show Desktop and a click did something: windows ${L.openWindows(m, S).length}, S_OPEN ${m.ram[S.S_OPEN]}`);
    { const d = H.shellDiff(env); sec.ok(d === null, () => `About over the empty desk after the modal-rule presses: ${d}`); }
    if (how === 'ok') L.click(env, 336, 108, 3, 6); else L.typeCode(env, how === 'esc' ? 27 : how === 'enter' ? 13 : 3);
    env.frames_(6); note(`About closed by ${how}`);
    verify(`About closed by ${how}, no window`); cmp(closed1, `About closed by ${how}, no window`, 0x50);
  }
  // ---- 5. Show Desktop with the window closed: the shell exactly as at start
  menuItem(8); sim.show(); verify('Show Desktop, window closed');
  cmp(base0, 'Show Desktop with the window closed: the shell as at start', 0x50);
  // ---- 6. Show Desktop with it open: raised, nothing else changes (the focus stays)
  tab(1); verify('TAB'); { const before = H.captureState(env); menuItem(8); sim.show(); verify('Show Desktop, window open'); cmp(before, 'Show Desktop with the window open: nothing changes'); }
  // ---- 7. close by SS+Q; the same state as by the box (the focus was on another icon)
  closeSSQ(); verify('closed by SS+Q'); cmp(closed1, 'closed by SS+Q, the closed state as by the box', 0x50);
  // ---- 8. a program launched from the Leap menu with the window closed: it starts, and quits back to an OPEN shell, as at start
  for (const p of [1, 2, 3, 4, 5]) {
    menuItem(p + 2);
    const n = L.waitProgram(env, p, 120);
    sec.ok(n >= 0, () => `program ${p} from the Leap menu with the shell's window closed: it did not come up (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => w.title))})`);
    if (n < 0) { break; }
    env.frames_(p === 2 ? 36 : 12);
    if (p !== 4 && p !== 5) { const d = H.programDiff(env, p, [], '0'); sec.ok(d === null, () => `program ${p} from the closed shell: its screen: ${d}`); }
    const q = p % 2 ? L.quitByCloseBox(env, p) : L.quitBySSQ(env);
    sec.ok(q, () => `program ${p}: the shell did not come back (open) after ${p % 2 ? 'the close box' : 'SS+Q'}`);
    if (!q) break;
    env.frames_(12); sim.reset(); note(`program ${p} launched with no window and quit`);
    verify(`back from program ${p}`); cmp(base0, `back from program ${p} (launched with the shell's window closed): the shell open as at start`);
    closeBox(); verify(`closed again after program ${p}`);
  }
  // ---- 9. cycles: close by box / SS+Q, Show Desktop; the arena does not grow, the state is the start's
  for (let i = 0; i < 8 && sec.nf < 8; i++) {
    if (i % 2) closeSSQ(); else closeBox();
    verify(`cycle ${i}: closed`);
    menuItem(8); sim.show(); verify(`cycle ${i}: shown`); cmp(base0, `cycle ${i}: Show Desktop`);
  }
  // ---- 10. the modal rule: the close box of the shell's window (now inactive, under the About dialog) does nothing; nor does a press on its title bar (no raise, no drag)
  {
    menuItem(1);
    const dlg = L.openWindows(m, S).find((w) => w.cls === S.CL_Dialog);
    sec.ok(!!dlg && L.openWindows(m, S).length === 2, 'About over the open shell window');
    const before = H.captureState(env, 2);
    L.click(env, bxc[0], bxc[1], 3, 4); env.frames_(4);
    L.click(env, 200, 28, 3, 4); env.frames_(4);
    L.moveTo(env, 200, 28); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3); L.moveTo(env, 260, 60); env.frames_(3); m.mouse.buttons = L.MOUSE_UP; env.frames_(6);   // a drag attempt on the title bar
    note('modal: box, title click and drag');
    sec.ok(L.openWindows(m, S).length === 2 && m.ram[S.S_OPEN] === 1 && rd16(m, S.W_MODAL) === (dlg && dlg.a), () => `the close box under the modal dialog: windows ${L.openWindows(m, S).length}, S_OPEN ${m.ram[S.S_OPEN]}`);
    const diffs = H.compareStates(env, before, H.captureState(env, 2), 'modal rule: box, title, drag', true); sec.ok(diffs.length === 0, () => dig(diffs));
    const d = H.shellDiff(env); sec.ok(d === null, () => `after the presses under the modal dialog: ${d}`);
    L.typeCode(env, 27); env.frames_(6); note('About closed');
    verify('About closed after the modal-rule presses');
    // the window is front and active again: its close box works
    closeBox(); verify('closed by the box after the dialog'); menuItem(8); sim.show(); verify('shown again'); cmp(base0, 'shown again after the dialog', 0x50);
  }
  // ---- 11. a double click launches from the reopened window and the shell comes back (open, fresh)
  { const ok = L.launchByDoubleClick(env, 2); sec.ok(ok, 'double click on an icon of the reopened window'); if (ok) { env.frames_(30); sec.ok(L.quitByCloseBox(env, 2), 'and the shell comes back'); env.frames_(12); sim.reset(); verify('after launching from the reopened window'); cmp(base0, 'after launching from the reopened window'); } }
  sec.end(`${trail.length ? 'the shell closed by the box and by SS+Q, ' : ''}Show Desktop closed / open, About and the Leap menu with no window, 5 programs launched with the window closed, 8 cycles, the modal rule`);
}

// ===========================================================================================================================
// 6. The memory watch, V_FRAMES, DI
function watchGroup() {
  const sec = new Sec('6 memory watch (BANKING 10.7), V_FRAMES +1 per normal frame (a DI would lose a frame interrupt in TSRun), the image writes of Calculator');
  let frames = 0, acc = 0;
  envs.forEach((env, i) => {
    const w = env.w;
    sec.ok(w.n === 0, () => `machine ${i}: memory watch: ${w.summary()}`);
    sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first: ${env.vf.first}`);
    sec.ok(env.wr.n === 0, () => `machine ${i}: ${env.wr.n} write(s) to Calculator's image outside its variables while it ran: ${env.wr.first.join('; ')}`);
    frames += env.vf.checked; acc += (w.accA || 0) + (w.accR || 0);
  });
  sec.end(`${envs.length} machines, ${frames} normal frames with V_FRAMES checked, ${acc} accesses under A or R watched`);
}

// ===========================================================================================================================
const groups = { 1: () => { launcherGroup(); cyclesGroup(); }, 2: shellGroup, 3: cwindowGroup, 4: aboutGroup, 5: ssqGroup, 6: watchGroup, 7: shell12Group };
for (const g of [1, 2, 3, 4, 5, 7, 6]) {
  if (!ONLY.includes(g)) continue;
  try { groups[g](); } catch (e) { C.check(`group ${g} ran to the end`, false, `${e.message.split('\n')[0]}${VERBOSE ? '\n' + e.stack : ''}`); }
}
C.done();
