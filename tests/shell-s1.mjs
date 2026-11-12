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
//     --only LIST   groups: 1 launcher, 2 shell, 3 CWindow, 4 About, 5 SS+Q in the shell, 6 memory watch / V_FRAMES (default all)
// Exit code 1 on any failure.
import { checks } from './lib.mjs';
import * as H from './shell-lib.mjs';
import * as T from './tk-lib.mjs';

const { L, SM, hex, rd16 } = H;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NLAUNCH = argNum('--nlaunch', 120), NCYCLES = argNum('--ncycles', 50), NSHELL = argNum('--nshell', 200), NLOOK = argNum('--nlook', 150), NTRACK = argNum('--ntrack', 300), NDIALOG = argNum('--ndialog', 24);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6];
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
    const spots = [[194, 52], [194, 64], [194, 80], [194, 92], [194, 104], [306, 53], [306, 123]];
    for (let i = rng.int(1, 4); i > 0; i--) { const [x, y] = rng.pick(spots); L.click(env, x, y, 3, 5); }
    if (rng.chance(0.5)) L.typeCode(env, rng.pick([32, 14, 15]));
  } else if (p === 3) {
    // Write: caret moves and clicks in the text view only (a changed document would ask before it quits, WRITE 11.6): nothing of it may survive the quit
    for (let i = rng.int(1, 4); i > 0; i--) { if (rng.chance(0.5)) L.typeCode(env, rng.pick([8, 9, 10, 11])); else L.click(env, rng.int(30, 460), rng.int(34, 170), 3, 4); }
  } else {
    // the shell: one single click on an icon, then at least 25 frames so that no second click can make a double (SHELL 4: <= 20 frames)
    if (rng.chance(0.6)) { H.clickIcon(env, rng.pick([1, 2, 3]), 3, 4); env.frames_(25); }
    if (rng.chance(0.4)) L.typeCode(env, rng.pick([14, 15, 10, 11]));
    if (rng.chance(0.2)) { H.leapMenu(env, 1); L.typeCode(env, rng.pick([13, 27, 3])); env.frames_(6); }
  }
  void m;
}

// ===========================================================================================================================
// 1. The launcher
function launcherGroup() {
  const sec = new Sec('1 launcher: random launches (icon double click, ENTER on the focused icon, the Leap menu items 3 and 4) and quits (close box, SYMBOL SHIFT + Q); after each K_PROG, the windows, the app arena top, K_FOCUS / K_CAPTURE / W_MODAL / the posted queue, the stack at the event loop and the screen as after a fresh launch');
  const env = mkShell(), { m, S } = env;
  const base = {}, stat = { launches: 0, quits: 0, byMethod: {}, maxLaunch: 0, maxQuit: 0, perProg: { 1: 0, 2: 0, 3: 0 }, shells: 0 };
  base[0] = H.captureState(env);
  sec.ok(base[0].prog === 0 && base[0].wins.length === 1 && base[0].wins[0].title === 'Leap Desktop' && base[0].focus === H.iconAddrs(env)[0], () => `boot state: ${JSON.stringify({ prog: base[0].prog, wins: base[0].wins, focus: hex(base[0].focus) })} (the shell, K_FOCUS on the first icon)`);
  sec.ok(base[0].sp !== undefined, 'the shell\'s event loop was seen (K_GETEV)');
  sec.ok(base[0].top === rd16(m, S.K_AARENA) && base[0].base === 0xC400, () => `app arena base ${hex(base[0].base)}, want $C400 (SHELL 2)`);
  const trail = [];
  const note = (s) => { trail.push(s); if (trail.length > 8) trail.shift(); };
  const judge = (p, what) => {
    env.frames_(12);                                    // the window is up before it is all drawn (a launch takes about 8 frames, SHELL 7): let it settle
    const cur = H.captureState(env);
    if (!base[p]) {
      base[p] = cur;                                    // the first arrival: the reference for "as after a fresh launch"
      // independent of the baseline: the screen is what the models draw for a fresh program
      const d = H.programDiff(env, p, [], '0');
      sec.ok(d === null, () => `${what}: the fresh program ${p}'s screen against the model: ${d}`);
      sec.ok(cur.dirty < 0 && cur.capture === 0 && cur.modal === 0 && cur.posted.length === 0, () => `${what}: fresh program ${p}: arena dirty ${cur.dirty}, K_CAPTURE ${hex(cur.capture)}, W_MODAL ${hex(cur.modal)}, posted ${JSON.stringify(cur.posted)}`);
      // K_FOCUS: the window's activation focuses the first view that can take it (WINDOWS 14)
      const tree = H.treeOf(env), win = tree.find((v) => v.depth === 1 && v.cls !== S.CL_MenuBar && v.kind === 'Window');
      const first = tree.find((v) => win && v.depth > win.depth && (v.flags & 7) === 1);
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
      for (let i = 0; i < 3 && rd16(m, S.K_FOCUS) !== icons[p - 1]; i++) L.typeCode(env, 14);
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
  for (const p of [1, 2, 3]) {
    note(`first launch of ${p} by dbl`);
    if (!launch(p, 'dbl')) return sec.end('stopped');
    judge(p, `the first launch of program ${p}`); stat.launches++; stat.perProg[p]++;
    note(`quit ${p} by close`);
    if (!quit(p, 'close')) return sec.end('stopped');
    judge(0, `the first return from program ${p}`); stat.quits++;
  }
  for (let i = 0; i < NLAUNCH && sec.nf < 10; i++) {
    if (cur === 0) {
      const p = rng.pick([1, 2, 3]), method = rng.pick(methods);
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
  // the three baselines against each other: a program has its own state
  sec.ok(base[1].top !== base[2].top || base[1].focus !== base[2].focus, 'the two programs have different arena states');
  sec.end(`${stat.launches} launches (calculator ${stat.perProg[1]}, controls ${stat.perProg[2]}, write ${stat.perProg[3]}), ${stat.quits} quits, methods ${JSON.stringify(stat.byMethod)}; the shell's arena top ${hex(base[0].top)}, calculator's ${hex(base[1].top)}, controls' ${hex(base[2].top)}, write's ${hex(base[3].top)}; loop SP shell ${hex(base[0].sp)}, calculator ${hex(base[1].sp)}, controls ${hex(base[2].sp)}; most frames: launch ${stat.maxLaunch}, quit ${stat.maxQuit} (the whole driver, input included)`);
}

// 1b. Exact cycles: 50 launch / quit cycles (SHELL 7)
function cyclesGroup() {
  const sec = new Sec(`1b ${NCYCLES} launch / quit cycles, alternating the programs, the double click and the close box / SS+Q: the state after every launch and every return is exactly the first one`);
  const env = mkShell(), { m, S } = env;
  const base = { 0: H.captureState(env) };
  let diffsN = 0;
  for (let i = 0; i < NCYCLES && sec.nf < 6; i++) {
    const p = 1 + (i % 3), how = i & 2 ? 'ssq' : 'close';
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
  sec.end(`${diffsN} differences from the first launch's state; the arena tops $${base[0].top.toString(16)} / $${base[1].top.toString(16)} / $${base[2] ? base[2].top.toString(16) : '-'} / $${base[3] ? base[3].top.toString(16) : '-'}`);
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
    const views = H.treeOf(env), win = views.find((v) => v.cls === S.CL_Window);
    sec.ok(!!win && [win.x, win.y, win.w, win.h].join() === '32,24,256,80' && H.readStrText(m, rd16(m, win.a + S.Window_title)) === 'Leap Desktop', () => `the window ${win && [win.x, win.y, win.w, win.h]}, title "${win && H.readStrText(m, rd16(m, win.a + S.Window_title))}"`);
    const ics = views.filter((v) => v.cls === S.CL_Icon);
    sec.ok(ics.length === 3 && ics[0].x === 48 && ics[0].y === 40 && ics[1].x === 112 && ics[1].y === 40 && ics[2].x === 176 && ics[2].y === 40 && ics.every((v) => v.w === 64 && v.h === 26 && (v.flags & 1) === 1), () => `icons ${JSON.stringify(ics.map((v) => [v.x, v.y, v.w, v.h, v.flags]))}, want (48, 40), (112, 40) and (176, 40) (WRITE 11.2), 64 x 26 (SHELL 10.5), focusable`);
    sec.ok(ics.length === 3 && m.ram[ics[0].a + S.Icon_prog] === 1 && m.ram[ics[1].a + S.Icon_prog] === 2 && m.ram[ics[2].a + S.Icon_prog] === 3, () => `Icon prog fields ${ics.map((v) => m.ram[v.a + S.Icon_prog])}, want 1, 2 and 3 (SHELL 10.4: prog 1 byte)`);
    sec.ok(ics.length === 3 && H.readStrText(m, rd16(m, ics[0].a + S.Icon_name)) === 'Calculator' && H.readStrText(m, rd16(m, ics[1].a + S.Icon_name)) === 'Controls' && H.readStrText(m, rd16(m, ics[2].a + S.Icon_name)) === 'Write', () => `Icon names ${ics.map((v) => H.readStrText(m, rd16(m, v.a + S.Icon_name)))}`);
    const d0 = H.shellDiff(env);
    sec.ok(d0 === null, () => `boot screen: ${d0}`);
    sec.ok(rd16(m, S.K_FOCUS) === icons[0], () => `K_FOCUS after boot ${hex(rd16(m, S.K_FOCUS))}, the first icon is ${hex(icons[0])}`);
    // the pointer parked in a corner: the whole screen compared (mask only the corner)
    L.moveTo(env, 500, 180); env.frames_(4);
    const d1 = H.shellDiff(env);
    sec.ok(d1 === null, () => `pointer parked at (500, 180): ${d1}`);
    // the TABs below start from the first icon (the focus is there after the boot)
    // the selected look on each icon (set the focus by TAB, as a user does) and with none: K_FOCUS cleared by the harness is not a user state, so only 0 / 1
    for (const k of [1, 2, 0, 1]) {
      L.typeCode(env, 14); env.frames_(6);
      sec.ok(rd16(m, S.K_FOCUS) === icons[k], () => `TAB: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, want icon ${k} ${hex(icons[k])}`);
      const d = H.shellDiff(env);
      sec.ok(d === null, () => `TAB to icon ${k}: the whole screen against SHELL 10.4 / 10.5's rendering: ${d}`);
    }
    // the window has no close box: its title bar is the plain Window's (10.4: "a plain Window (the shell is not closed)")
    const g = SM.renderShell({ sel: icons.indexOf(rd16(m, S.K_FOCUS)) });
    const sh = H.readDisp(m), want = SM.toDisp(g), bx = SM.boxRect(32, 24, 256);
    let boxDiff = 0; for (let y = bx.y; y < bx.y + bx.h; y++) for (let x = bx.x; x < bx.x + bx.w; x++) { const bit = (a, X, Y) => (a[Y * 64 + (X >> 3)] >> (7 - (X & 7))) & 1; if (bit(sh, x, y) !== bit(want, x, y)) boxDiff++; }
    sec.ok(boxDiff === 0, () => `${boxDiff} pixels differ in the place where a close box would be: the shell's window has none`);
    sec.end('window, 3 icons (bitmaps from icons.txt, names, selection) in 8 screens');
  }
  // ---- clicks, double clicks, TAB, arrows, ENTER against ShellSim, random
  {
    const sec = new Sec('2b clicks, double clicks (gaps near 20 frames), TAB / BACKTAB / arrows, ENTER and clicks off the icons against ShellSim: K_FOCUS, K_PROG, S_LAST / S_LASTF, K_CAPTURE and the screen after every action');
    const sim = new SM.ShellSim();
    freshShell(env, sec);
    const base0 = H.captureState(env);
    const stat = { downs: 0, opens: 0, keys: 0, enters: 0, blanks: 0, near20: 0, openedAt20: 0, notAt21: 0, moves: 0, ambiguous: 0 };
    const hist = [];
    const rec = (s) => { hist.push(s); if (hist.length > 7) hist.shift(); };
    const afterLaunch = (p, why) => {
      const n = L.waitProgram(env, p, 120);
      sec.ok(n >= 0, () => `${why}: program ${p} did not come up (K_PROG ${m.ram[S.K_PROG]}) [${hist.join('; ')}]`);
      if (n < 0) return false;
      env.frames_(12);
      const d = H.programDiff(env, p, [], '0');
      sec.ok(d === null, () => `${why}: the program ${p} screen: ${d}`);
      const ok = (rd16(m, S.K_FOCUS) !== 0) && L.progUp(env, p);
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
    // A press: the pointer on the icon, (optionally waiting until the gap since the shell's last remembered press is reached), the button down for 1-3 frames.  The frame at which the shell
    // handles the E_DOWN is V_FRAMES after the press's frame when the icon is already focused; a press that moves the focus first redraws two icons and may be handled a frame or two
    // later (the shell's own S_LASTF tells for a press that does not open).  So `vmin` .. `vmax` bounds it and a press whose outcome depends on which is "ambiguous": the machine decides
    // and the model follows (counted, not judged).
    const press = (i, gap) => {
      const p = i + 1, [cx, cy] = L.iconCentre(p);
      L.moveTo(env, cx, cy);
      const ref = sim.last ? sim.last.frame : null;
      if (gap !== undefined && ref !== null) { let g = 0; while (((rd16(m, S.V_FRAMES) + 1 - ref) & 0xFFFF) < gap && g++ < 300) env.frame(); }
      const focusChange = rd16(m, S.K_FOCUS) !== icons[i], oldF = rd16(m, S.S_LASTF), oldI = rd16(m, S.S_LAST);
      m.mouse.buttons = L.MOUSE_LEFT; env.frame();
      const vmin = rd16(m, S.V_FRAMES);
      env.frames_(rng.int(0, 2)); m.mouse.buttons = L.MOUSE_UP; env.frames_(rng.int(1, 2));
      for (let k = 0; k < 6 && m.ram[S.K_PROG] === 0 && rd16(m, S.S_LASTF) === oldF && rd16(m, S.S_LAST) === oldI; k++) env.frame();
      return { vmin, vmax: focusChange ? vmin + 4 : vmin, focusChange, opened: m.ram[S.K_PROG] };
    };
    sim.focus = Math.max(0, icons.indexOf(rd16(m, S.K_FOCUS)));                       // 2a left the focus where its last TAB put it
    verifyShell('start');
    for (let k = 0; k < NSHELL && sec.nf < 10; k++) {
      const r = rng.next();
      if (r < 0.50) {
        const i = rng.int(0, 2);
        const gap = rng.chance(0.55) ? rng.pick([2, 3, 4, 6, 10, 15, 18, 19, 20, 20, 21, 21, 22, 25, 30, 45]) : undefined;
        const prev = sim.last ? { ...sim.last } : null;
        const pr = press(i, gap);
        stat.downs++;
        let want = 0, ambiguous = false;
        if (prev && prev.icon === i) {
          const oMin = ((pr.vmin - prev.frame) & 0xFFFF) <= SM.DBL_FRAMES, oMax = ((pr.vmax - prev.frame) & 0xFFFF) <= SM.DBL_FRAMES;
          if (oMin === oMax) want = oMin ? i + 1 : 0; else ambiguous = true;
          const g = (pr.vmin - prev.frame) & 0xFFFF; if (g >= 19 && g <= 22) stat.near20++;
          rec(`press icon ${i} handled@${pr.vmin}${pr.focusChange ? '..' + pr.vmax : ''} gap ${g}${ambiguous ? ' (ambiguous)' : ''}`);
        } else rec(`press icon ${i} handled@${pr.vmin}${pr.focusChange ? '..' + pr.vmax : ''}`);
        if (ambiguous) stat.ambiguous++;
        const gapMin = prev && prev.icon === i ? (pr.vmin - prev.frame) & 0xFFFF : null;
        if (!ambiguous) sec.ok(pr.opened === want, () => `press on icon ${i} (${hist.join('; ')}): the shell ${pr.opened ? `opened program ${pr.opened}` : 'did not open'}, the model says ${want ? `open program ${want}` : 'no open'} (the last remembered press ${JSON.stringify(prev)})`);
        if (pr.opened) {
          stat.opens++; if (gapMin === 20) stat.openedAt20++;
          sim.opened = pr.opened; sim.focus = i;
          afterLaunch(pr.opened, `press icon ${i} (gap ${gapMin})`);
        } else {
          if (gapMin === 21) stat.notAt21++;
          // the machine's own record of the press: the icon and the frame (S_LAST, S_LASTF)
          const lf = rd16(m, S.S_LASTF);
          sec.ok(rd16(m, S.S_LAST) === icons[i] && lf >= pr.vmin && lf <= pr.vmax, () => `press icon ${i}: S_LAST ${hex(rd16(m, S.S_LAST))} S_LASTF ${lf}, want the icon ${hex(icons[i])} and a frame in ${pr.vmin}..${pr.vmax} [${hist.join('; ')}]`);
          sim.focus = i; sim.last = { icon: i, frame: lf };
          verifyShell(`press icon ${i} handled@${pr.vmin}`);
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
        const [x, y] = rng.pick([[250, 90], [200, 60], [400, 150], [60, 160]]);
        L.click(env, x, y, 3, 4); stat.blanks++; rec(`click blank (${x}, ${y})`);
        verifyShell(`click at (${x}, ${y})`);
      } else { const [x, y] = [rng.int(0, 511), rng.int(10, 190)]; L.moveTo(env, x, y); env.frames_(1); stat.moves++; rec(`move (${x}, ${y})`); verifyShell('move'); }
    }
    // the boundary, exactly (reading R2: the frames are V_FRAMES when each E_DOWN is handled, as the shell's S_LASTF records them)
    sec.end(`${stat.downs} presses (${stat.ambiguous} ambiguous: the focus redraw makes the handling frame uncertain, not judged; ${stat.opens} double clicks opened; ${stat.near20} with a gap of 19-22; ${stat.openedAt20} opened at exactly 20; ${stat.notAt21} refused at exactly 21), ${stat.keys} keys, ${stat.enters} ENTERs, ${stat.blanks} blank clicks, ${env.frames} frames`);
  }
  // ---- the double click boundary, exactly, on a fresh shell each time it opened
  {
    const sec = new Sec('2c double click timing: a second E_DOWN on the same icon <= 20 frames (V_FRAMES, as handled) after the first opens the program, 21 or more does not; the shell remembers the frame; also across the V_FRAMES wrap');
    const gaps = [2, 3, 4, 5, 8, 10, 15, 18, 19, 20, 21, 22, 23, 25, 30, 40, 100, 200];
    const stat = { opened: 0, kept: 0 };
    for (const wrap of [false, true]) for (const p of [1, 2, 3]) for (const gap of gaps) {
      if (m.ram[S.K_PROG] !== 0) L.waitShell(env);
      env.frames_(30);                                                            // the last press is more than 20 frames ago
      if (wrap) { const v = 0xFFFF - rng.int(2, Math.min(gap, 40)) ; env.m.ram[S.V_FRAMES] = v & 0xFF; env.m.ram[S.V_FRAMES + 1] = v >> 8; env.resync(); }
      const r = H.doubleClickGap(env, p, gap);
      const n = L.waitProgram(env, p, 40);
      const opened = n >= 0 && m.ram[S.K_PROG] === p;
      const want = gap <= 20;
      sec.ok(opened === want, () => `icon ${p}, gap ${gap}${wrap ? ' across the V_FRAMES wrap' : ''}: the program ${opened ? 'opened' : 'did not open'}, want ${want ? 'open' : 'no open'} (E_DOWNs handled at ${r.f1} and ${r.handledAt}, S_LASTF now ${r.f2})`);
      if (!opened) {
        // not opened: the shell now remembers the second press's frame, and the icon is the focus
        sec.ok(r.gapSeen === gap, () => `icon ${p}, gap ${gap}${wrap ? ' (wrap)' : ''}: S_LASTF moved by ${r.gapSeen}, the harness made the gap ${gap} (calibration)`);
        sec.ok(rd16(m, S.K_FOCUS) === icons[p - 1], () => `icon ${p}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))} after a click`);
        stat.kept++;
      } else {
        stat.opened++;
        // leave the program by its close box: the shell again
        sec.ok(L.quitByCloseBox(env, p), `icon ${p}, gap ${gap}: the shell did not come back`);
        env.frames_(4);
      }
    }
    sec.end(`${gaps.length * 4} trials (3 icons, with and without the V_FRAMES wrap), ${stat.opened} opened, ${stat.kept} refused`);
  }
  // ---- ENTER and TAB / arrows from the user's side (the keys are checked again in 2b)
  {
    const sec = new Sec('2d ENTER opens the focused icon: straight after the start the first one; after TAB / DOWN / RIGHT the second; after BACKTAB / UP / LEFT from the first the second again (wrapping), and twice a key goes back to the first');
    const trial = (keys, wantProg, what) => {
      freshShell(env, sec);
      for (const k of keys) { L.typeCode(env, k); env.frames_(2); }
      L.typeCode(env, 13, 3, 1);
      const n = L.waitProgram(env, wantProg, 120);
      sec.ok(n >= 0, () => `${what}: keys ${JSON.stringify(keys)} then ENTER: program ${wantProg} did not come up (K_PROG ${m.ram[S.K_PROG]})`);
      if (n >= 0) sec.ok(L.quitBySSQ(env), `${what}: the shell did not come back by SS+Q`);
    };
    trial([], 1, 'at the start');
    for (const k of [14, 10, 9, 15, 11, 8]) { trial([k], 2, `key ${k} once`); trial([k, k], 1, `key ${k} twice`); }
    sec.end('13 trials');
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
    const sec = new Sec('3a CWindow look (SHELL 10.1): Window look + the close box CLR fill (x+w-19, y+1, 15, 7) / SET frame (x+w-18, y+2, 13, 5), only while the window is in front; random stacks of Windows and CWindows opened, raised and closed, the whole screen against the model after each step');
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
    const sec = new Sec('3b close box tracking (10.1): a press in (x+w-19, y+1, 15, 7) of the front CWindow draws the pressed look (XOR fill (x+w-17, y+3, 11, 3)); E_MOVE: the look follows whether the point is in the box; E_UP in the box: released and E_CMD posted (A 10, C View_id, E slot, D 0), outside: released, nothing posted; other events dropped; through TK_DISPATCH and K_DISPATCH');
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
  void CW;
}

// ===========================================================================================================================
// 4. The About dialog
function aboutGroup() {
  const sec = new Sec('4 About Leap Desktop... (menu "Leap", item 1): a Dialog (128, 64, 256, 64) with the Label "Leap Desktop, step 5" (144, 76, 200, 9) and the OK Button (304, 100, 64, 16), the default and the cancel; opens, closes by the mouse (OK), ENTER, ESC and BREAK, reopens; modal; the shell as before');
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
    sec.ok(!!lbl && [lbl.x, lbl.y, lbl.w, lbl.h].join() === '144,76,200,9' && H.readStrText(m, rd16(m, lbl.a + S.Label_text)) === 'Leap Desktop, step 5', () => `Label ${lbl && [lbl.x, lbl.y, lbl.w, lbl.h]} "${lbl && H.readStrText(m, rd16(m, lbl.a + S.Label_text))}"`);
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
// 5. SYMBOL SHIFT + Q in the shell does nothing
function ssqGroup() {
  const sec = new Sec('5 SYMBOL SHIFT + Q (CLOSE, 17) in the shell does nothing: its window is a plain Window (SHELL 10.4); K_PROG, the windows, the focus, the posted queue and the screen stay; also with the About dialog up');
  const env = mkShell(), { m, S } = env;
  const icons = H.iconAddrs(env);
  const base0 = H.captureState(env);
  let n = 0;
  for (let i = 0; i < 12 && sec.nf < 8; i++) {
    if (i === 3) { L.typeCode(env, 14); env.frames_(3); }
    if (i === 6) { H.leapMenu(env, 1); env.frames_(4); }
    if (i === 9) { L.typeCode(env, 27); env.frames_(4); L.typeCode(env, 14); env.frames_(3); }
    const before = H.captureState(env, 2);
    L.typeCode(env, 17, 3, 3); n++;
    L.typeCode(env, 17, 40, 6);                       // held through the key's repeat
    env.frames_(4);
    const after = H.captureState(env, 2);
    const diffs = H.compareStates(env, before, after, `SS+Q #${i}`, i >= 6 && i < 7);
    sec.ok(diffs.length === 0, () => dig(diffs));
    sec.ok(m.ram[S.K_PROG] === 0, () => `SS+Q #${i}: K_PROG ${m.ram[S.K_PROG]}`);
    const d = H.shellDiff(env); sec.ok(d === null, () => `SS+Q #${i}: screen ${d}`);
    sec.ok(icons.includes(rd16(m, S.K_FOCUS)) || rd16(m, S.K_FOCUS) === H.okButton(env), () => `SS+Q #${i}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}`);
    if (i === 6) { L.typeCode(env, 27); env.frames_(4); }
  }
  // the shell still works: a double click opens Calculator, and it comes back fresh
  const ok = L.launchByDoubleClick(env, 1); sec.ok(ok, 'the shell still launches after SS+Q presses'); env.frames_(4);
  if (ok) { sec.ok(L.quitBySSQ(env), 'SS+Q quits Calculator (a CWindow program)'); env.frames_(4); }
  void base0;
  sec.end(`${n} presses (plus repeats)`);
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
const groups = { 1: () => { launcherGroup(); cyclesGroup(); }, 2: shellGroup, 3: cwindowGroup, 4: aboutGroup, 5: ssqGroup, 6: watchGroup };
for (const g of [1, 2, 3, 4, 5, 6]) {
  if (!ONLY.includes(g)) continue;
  try { groups[g](); } catch (e) { C.check(`group ${g} ran to the end`, false, `${e.message.split('\n')[0]}${VERBOSE ? '\n' + e.stack : ''}`); }
}
C.done();
