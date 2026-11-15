"use strict";
// shell-perf.mjs -- the shell slice's bounds, docs/SHELL.md section 7, as a table (test 4 of section 8), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt).
// Written from the contract only (SHELL 7, 9, 10; never from src/kernel/launch.asm, src/kernel/tk.asm or src/apps/*.asm).  T-states are TSRun's (no memory contention); direct calls with a sentinel
// return, interrupts off, unless a row says otherwise; launch and quit are measured in frames over a real run (the mouse and the keyboard through TSRun).
//   node tests/shell-perf.mjs [--seed N] [--ncycles N] [--nrep N]
//     --ncycles N   exact launch / quit cycles (default 50)
//     --nrep N      repetitions of each launch / quit measurement (default 4)
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.
import * as H from './shell-lib.mjs';
import * as T from './tk-lib.mjs';

const { L, SM, hex, rd16 } = H;
const { argNum } = L;
const SEED = argNum('--seed', 1), NCYC = argNum('--ncycles', 50), NREP = argNum('--nrep', 4);
const rng = L.makeRng(SEED);
console.log(`seed ${SEED} (rerun with --seed ${SEED}; the measurements are deterministic except for the registers the routines ignore)`);
const rows = [];
let missed = 0;
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en') : String(n));
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  rows.push({ name, measured, bound, status, note });
  console.log(`${status === 'MISSED' ? 'FAIL' : 'ok  '} | ${name} | measured ${fmt(measured)} | bound ${bound === null ? 'report' : '<= ' + fmt(bound)} | ${status}${note ? ' | ' + note : ''}`);
};

const load = L.loadDesk5(), S = load.S;
H.needSyms(S, H.SHELL_NEEDED);

// ---- bytes (SHELL 7) ---------------------------------------------------------------------------------------------------------------------------
{
  const code = S.K_PROGS - S.K_LAUNCH;                                  // K_LAUNCH, K_QUIT; K_PROGS is the cartridge's table that follows
  const nprog = 5, table = 2 * nprog;                                   // a word per program: the shell, Calculator, Key Caps, Notepad, Paint
  row('the launcher\'s bytes in the pool (K_PROGS - K_LAUNCH: K_LAUNCH and K_QUIT; EST 90)', code, 150, `K_LAUNCH ${hex(S.K_LAUNCH)}, K_QUIT ${hex(S.K_QUIT)}, K_PROGS ${hex(S.K_PROGS)}; with the ${nprog}-word program table ${code + table}`);
  // SIZE 2: the pool's FREE bytes (the always-mapped chunks), read from the build, replace step 5's growth bound (BANKING 6.1: 3,400). The reserve is for step 6.
  const c01 = 0x4000 - S.TK2_END;                                       // chunks 0-1: from TK2_END to $4000
  let t = S.K_CODE; while (t > 0x8000 && load.mem[t - 1] === 0) t--;
  const c4 = S.K_CODE - t;                                              // chunk 4: the zero run below the kernel (the kernel starts at $9E00 since SIZE 1 S1)
  const c5 = 0xC000 - (S.K_PROGS + table);                              // chunk 5: from the end of the K_PROGS table to $C000
  const free = c01 + c4 + c5, RESERVE = 1000;
  row('the pool\'s free bytes (chunks 0-1 TK2_END..$4000, chunk 4 below the kernel, chunk 5 after the K_PROGS table); SIZE 2', free, null, `${free}: chunks 0-1 ${c01} (TK2_END ${hex(S.TK2_END)}), chunk 4 ${c4}, chunk 5 ${c5} (K_PROGS table ends ${hex(S.K_PROGS + table)})`);
  row('the pool\'s free bytes short of the 1,000-byte reserve for step 6 (SIZE 2: must be 0)', Math.max(0, RESERVE - free), 0, `free ${free}, reserve ${RESERVE}`);
  row('the shell\'s bytes in DOCK 2-3 (S_END - S_START: code, image, icons; EST 1,100)', S.S_END - S.S_START, 1600, `S_START ${hex(S.S_START)}, S_END ${hex(S.S_END)}; the image is ${S.S_IMG_LEN} of them`);
  row('Calculator\'s bytes in DOCK 2-3 (C_END - C_START), for reference (CALCULATOR 7: <= 2,500)', S.C_END - S.C_START, 2500);
  row('Key Caps\' bytes in DOCK 2-3 (KC_END - KC_START; KEYCAPS 4: <= 1,225, what Controls took)', S.KC_END - S.KC_START, 1225);
  for (const [name, len] of [['the shell', S.S_IMG_LEN], ['Calculator', S.C_IMG_LEN], ['Key Caps', S.KC_IMG_LEN]]) row(`${name}'s RAM image (<= 1,024: $C000-$C3FF, below the app arena at $C400)`, len, 1024);
}

// ---- DI (SHELL 7: none) --------------------------------------------------------------------------------------------------------------------------
{
  // a linear sweep of the launcher and the shell's code with a Z80 instruction-length decoder: the DI opcodes ($F3) at instruction starts (the shell's image is data: S_IMG .. S_END left out)
  const rb = (a) => load.mem[a];
  const imm8 = new Set([0x06, 0x0E, 0x16, 0x1E, 0x26, 0x2E, 0x36, 0x3E, 0xC6, 0xCE, 0xD6, 0xDE, 0xE6, 0xEE, 0xF6, 0xFE, 0xD3, 0xDB, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38]);
  const imm16 = new Set([0x01, 0x11, 0x21, 0x31, 0x22, 0x2A, 0x32, 0x3A, 0xC2, 0xC3, 0xC4, 0xCA, 0xCC, 0xCD, 0xD2, 0xD4, 0xDA, 0xDC, 0xE2, 0xE4, 0xEA, 0xEC, 0xF2, 0xF4, 0xFA, 0xFC]);
  const idxd = new Set([0x34, 0x35, 0x46, 0x4E, 0x56, 0x5E, 0x66, 0x6E, 0x7E, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x77, 0x86, 0x8E, 0x96, 0x9E, 0xA6, 0xAE, 0xB6, 0xBE]);
  const len = (a) => {
    const o = rb(a);
    if (o === 0xDD || o === 0xFD) {
      const p = rb(a + 1);
      if (p === 0xCB) return 4;
      if (p === 0xDD || p === 0xFD || p === 0xED) return 1;
      if (idxd.has(p)) return 3;
      if (p === 0x36) return 4;
      if (p === 0x21 || p === 0x22 || p === 0x2A) return 4;
      if (p === 0x26 || p === 0x2E) return 3;
      return 2;
    }
    if (o === 0xED) return [0x43, 0x4B, 0x53, 0x5B, 0x63, 0x6B, 0x73, 0x7B].includes(rb(a + 1)) ? 4 : 2;
    if (o === 0xCB) return 2;
    if (o === 0xEF) return 3;                       // RST $28 (KFAR) is followed by a DW target: an address byte such as $F3 is not a DI
    if (imm16.has(o)) return 3;
    if (imm8.has(o)) return 2;
    return 1;
  };
  const sweep = (lo, hi) => { let n = 0, ops = 0; const at = []; for (let a = lo; a < hi; a += len(a)) { ops++; if (rb(a) === 0xF3) { n++; at.push(hex(a)); } } return { n, ops, at }; };
  const a = sweep(S.K_LAUNCH, S.K_PROGS), b = sweep(S.S_START, S.S_IMG);
  row('DI opcodes in the launcher (K_LAUNCH..K_PROGS, linear sweep at instruction starts)', a.n, 0, `${a.ops} instructions swept${a.n ? '; DI at ' + a.at.join(', ') : ''}`);
  row('DI opcodes in the shell\'s code (S_START..S_IMG, linear sweep; the image is data)', b.n, 0, `${b.ops} instructions swept${b.n ? '; DI at ' + b.at.join(', ') : ''}`);
}

// ---- K_LAUNCH stepped, interrupts on: no DI, the stack, the cost ------------------------------------------------------------------------------------
{
  const env = H.bootShell({ watch: false }), { m } = env;
  env.rng = rng;
  const stepRun = (addr, regs, stopPc, what) => {
    const r = T.runCall(env, addr, regs, { stopPc, allowHalt: true, onHalt: () => { T.setVframes(env, (T.vframes(env) + 1) & 0xFFFF); }, guard: 20_000_000 });
    return { ...r, what };
  };
  // Calculator: K_LAUNCH with A = 1, stepped (interrupts on, so a DI would show as IFF1 clear after an instruction) until the program's start in DOCK 2-3
  const r1 = stepRun(S.K_LAUNCH, { a: 1 }, S.C_START, 'K_LAUNCH 1');
  row('K_LAUNCH (A = 1, Calculator) stepped with interrupts on up to the program\'s first instruction (C_START): DI executed', r1.di, 0, `reached C_START: ${r1.stopped}; ${fmt(r1.t)} T, ${r1.halts} HALT(s), stack ${r1.stack} bytes below the entry SP`);
  row('K_LAUNCH to the program\'s start: T-states (report; includes the closing of the shell\'s window and the desk repaint)', r1.t, null, `${(r1.t / 58688).toFixed(2)} frames of CPU`);
  const env2 = H.bootShell({ watch: false }); env2.rng = rng;
  const r0 = T.runCall(env2, S.K_QUIT, {}, { stopPc: S.S_START, allowHalt: true, onHalt: () => { T.setVframes(env2, (T.vframes(env2) + 1) & 0xFFFF); }, guard: 20_000_000 });
  row('K_QUIT stepped from the shell (K_LAUNCH 0) with interrupts on up to the shell\'s first instruction (S_START): DI executed', r0.di, 0, `reached S_START: ${r0.stopped}; ${fmt(r0.t)} T`);
  void m;
}

// ---- launch and quit in frames (SHELL 7) ---------------------------------------------------------------------------------------------------------
const env = H.bootShell();                                              // the memory watch on: the launches below also run under it
const { m } = env;
{
  const frames = { launch: { 1: [], 2: [], 3: [] }, quitBox: { 1: [], 2: [], 3: [] }, quitKey: { 1: [], 2: [], 3: [] } };
  const drawn = (p) => L.progUp(env, p) && H.programDiff(env, p, [], '0') === null && (p !== 0 || H.shellDiff(env) === null);
  const run = (p) => {
    // the second click of a double click on icon p: the first click, 9 frames; the second press is frame 1; count the frames until the program's window is drawn (the screen equals the model's)
    const [cx, cy] = L.iconCentre(p);
    L.click(env, cx, cy, 3, 6);
    env.frames_(0);
    m.mouse.buttons = L.MOUSE_LEFT;
    let n = 0, ok = false;
    for (n = 1; n <= 90; n++) { env.frame(); if (n === 3) m.mouse.buttons = L.MOUSE_UP; if (drawn(p)) { ok = true; break; } }
    m.mouse.buttons = L.MOUSE_UP;
    return ok ? n : NaN;
  };
  for (let rep = 0; rep < NREP; rep++) for (const p of [1, 2, 3]) {
    env.frames_(12);
    const n = run(p); frames.launch[p].push(n);
    env.frames_(12);
    // quit by the close box: the release is frame 1; the shell drawn
    {
      const w = L.PROG_WIN[p], b = L.closeBoxOf(w.x, w.y, w.w);
      L.moveTo(env, b.x + 7, b.y + 3); env.frames_(2);
      m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
      m.mouse.buttons = L.MOUSE_UP;
      let q = NaN;
      for (let k = 1; k <= 90; k++) { env.frame(); if (drawn(0)) { q = k; break; } }
      frames.quitBox[p].push(q);
    }
    env.frames_(12);
    // the same program again, quit by SYMBOL SHIFT + Q: the key goes down in frame 1
    run(p); env.frames_(12);
    {
      const list = L.keysFor(17);
      L.setKeys(m, list);
      let q = NaN;
      for (let k = 1; k <= 90; k++) { env.frame(); if (k === 3) L.setKeys(m, []); if (drawn(0)) { q = k; break; } }
      L.setKeys(m, []);
      frames.quitKey[p].push(q);
    }
    env.frames_(12);
  }
  const worst = (a) => Math.max(...a);
  for (const p of [1, 2, 3]) {
    const name = p === 1 ? 'Calculator' : p === 2 ? 'Key Caps' : 'Notepad';
    row(`launch ${name}: frames from the second click's press (frame 1) to its window drawn (the screen equals the model's), worst of ${NREP} (EST about 8)`, worst(frames.launch[p]), 30, `all ${frames.launch[p].join(', ')}`);
  }
  for (const p of [1, 2, 3]) {
    const name = p === 1 ? 'Calculator' : p === 2 ? 'Key Caps' : 'Notepad';
    row(`quit ${name} by the close box: frames from the release (frame 1; E_UP closes) to the shell's window drawn, worst of ${NREP}`, worst(frames.quitBox[p]), 30, `all ${frames.quitBox[p].join(', ')}`);
    row(`quit ${name} by SYMBOL SHIFT + Q: frames from the key's first frame to the shell's window drawn, worst of ${NREP}`, worst(frames.quitKey[p]), 30, `all ${frames.quitKey[p].join(', ')}`);
  }
}

// ---- 50 cycles, exactly (SHELL 7) ------------------------------------------------------------------------------------------------------------------
{
  const e = H.bootShell(), me = e.m;
  const base = { 0: H.captureState(e) };
  let diffs = 0, cyc = 0, firstDiff = '';
  const sps = { 0: new Set([base[0].sp]), 1: new Set(), 2: new Set(), 3: new Set() }, tops = { 0: new Set([base[0].top]), 1: new Set(), 2: new Set(), 3: new Set() };
  for (let i = 0; i < NCYC; i++) {
    const p = 1 + (i % 3);
    if (!L.launchByDoubleClick(e, p)) { diffs++; firstDiff ||= `cycle ${i}: launch ${p} failed`; break; }
    e.frames_(12);
    const c1 = H.captureState(e); if (!base[p]) base[p] = c1;
    sps[p].add(c1.sp); tops[p].add(c1.top);
    const d1 = H.compareStates(e, base[p], c1, `cycle ${i}: program ${p}`); diffs += d1.length; if (d1.length) firstDiff ||= d1[0];
    const ok = i & 2 ? L.quitBySSQ(e) : L.quitByCloseBox(e, p);
    if (!ok) { diffs++; firstDiff ||= `cycle ${i}: quit failed`; break; }
    e.frames_(12);
    const c0 = H.captureState(e); sps[0].add(c0.sp); tops[0].add(c0.top);
    const d0 = H.compareStates(e, base[0], c0, `cycle ${i}: shell`); diffs += d0.length; if (d0.length) firstDiff ||= d0[0];
    cyc++;
  }
  row(`${NCYC} launch / quit cycles: differences from the first launch's state (K_PROG, only that program's windows, the app arena's top at its base plus the program's own, K_FOCUS / K_CAPTURE / W_MODAL / the posted queue, the screen)`, diffs, 0, `${cyc} cycles; ${e.frames} frames (${Math.round(e.frames / Math.max(cyc, 1))} a cycle with the 12-frame settles); arena tops (own allocations above $C400): shell ${[...tops[0]].map((t) => t - 0xC400)}, Calculator ${[...tops[1]].map((t) => t - 0xC400)}, Key Caps ${[...tops[2]].map((t) => t - 0xC400)}${firstDiff ? '; first: ' + firstDiff : ''}`);
  const spDistinct = (s) => s.size;
  row('stack at the program\'s event loop (SP at K_GETEV\'s entry) after the cycles: distinct values over all launches of the shell / Calculator / Key Caps (must be 1 each: no growth)', Math.max(spDistinct(sps[0]), spDistinct(sps[1]), spDistinct(sps[2]), spDistinct(sps[3])), 1, `SP shell ${[...sps[0]].map((v) => hex(v))}, Calculator ${[...sps[1]].map((v) => hex(v))}, Key Caps ${[...sps[2]].map((v) => hex(v))}, Notepad ${[...sps[3]].map((v) => hex(v))} (the stack top is $FF00)`);
  row('frame interrupts lost over the 50-cycle machine\'s normal frames (V_FRAMES must rise by 1 a frame)', e.vf.bad, 0, `${e.vf.checked} frames checked${e.vf.bad ? '; first ' + e.vf.first : ''}; memory watch: ${e.w.summary()}`);
  if (e.w.n) { missed++; console.log('FAIL | the memory watch (BANKING 10.7) reported violations in the cycle run'); }
  void me;
}
{
  row('frame interrupts lost over the launch / quit timing machine\'s normal frames (V_FRAMES must rise by 1 a frame)', env.vf.bad, 0, `${env.vf.checked} frames checked${env.vf.bad ? '; first ' + env.vf.first : ''}; memory watch: ${env.w.summary()}`);
  if (env.w.n) { missed++; console.log('FAIL | the memory watch (BANKING 10.7) reported violations in the timing run'); }
}

// ---- W_DRAWVIEW of an icon (report) ----------------------------------------------------------------------------------------------------------------
{
  const e = H.bootShell({ watch: false }), me = e.m;
  const icons = H.iconAddrs(e);
  e.frames_(8);
  L.moveTo(e, 500, 180); e.frames_(4);
  L.park(e);
  const times = (a) => [0, 1, 2].map(() => L.directCall(e, S.W_DRAWVIEW, { ix: a }, 'K'));
  const sel = times(icons[0]);
  const d0 = H.shellDiff(e);
  row('W_DRAWVIEW of a selected icon (Calculator, the focused one: its 64 x 26, bitmap, 58-pixel name, inverted name box): direct call under K', sel[0], null, `T-states; repeated ${sel.join(', ')}; the shell's screen after: ${d0 === null ? 'equals the model' : 'DIFFERS: ' + d0}`);
  const uns = times(icons[1]);
  row('W_DRAWVIEW of an icon not selected (Key Caps, not focused), report', uns[0], null, `T-states; repeated ${uns.join(', ')}`);
  // Key Caps selected: move the focus there through the kernel's K_SETFOCUS (the user's TAB), then draw it
  L.directCall(e, S.K_SETFOCUS, { de: icons[1] }, 'K');
  const sel2 = times(icons[1]);
  row('W_DRAWVIEW of a selected icon (Key Caps, after K_SETFOCUS), report', sel2[0], null, `T-states; repeated ${sel2.join(', ')}`);
  void me;
}

// the figures at commit 800e9dc (before the look), measured by this block on that commit: whole-desk repaint 184,963; open 90,389; raise 91,944; draw 82,397; whole screen with a window 249,839.
// Owner, 2026-11-14 (LOOK 10): the window rows' bounds are the figures measured with the look, rounded up (the +10% of LOOK 4 would
// have cost a 70-90 byte line routine); the whole-screen W_UPDATE is reported, as the whole-desk repaint is (LOOK 9).
const LOOKB = { desk: null, open: 116000, raise: 117000, draw: 108000, all: null };
// ---- the chrome's speed (LOOK 4, 9): window open / raise / draw, a whole-desk W_UPDATE, on desk5 -----------------------------------------------
// Direct calls under K with interrupts off (no frame is crossed).  The shell's window is closed first, so the map holds the bar and the desk only; then the windows
// are plain empty `Window`s of 256 x 96 at (128, 48), as tests/wm-perf.mjs measures them on kern4.  Bounds: the figures at commit 800e9dc (before the look) plus 10%
// (LOOK 4: window draw, open, raise and the whole-desk W_UPDATE may grow by at most 10% each); the whole-desk repaint is reported (LOOK 9).
{
  const e = H.bootShell({ watch: false }), me = e.m;
  e.frames_(8); L.park(e);
  const R = (a, regs = {}) => L.directCall(e, a, regs, 'K', 30_000_000);
  const poke16 = (a, v) => { me.ram[a] = v & 0xFF; me.ram[a + 1] = (v >> 8) & 0xFF; };
  const setGA = (...w) => w.forEach((v, i) => poke16(S.GA + 2 * i, v));
  const title = rd16(me, rd16(me, S.S_WIN) + S.Window_title), shellWin = rd16(me, S.S_WIN);
  R(S.W_CLOSE, { ix: shellWin }); R(S.W_UPDATE);                      // the bar and the desk only
  const newW = (x, y, w, h) => {
    // K_NEW returns IX = the new view (carry = arena full); the rectangle and the title are poked as wm-perf does
    const cpu = me.cpu; R(S.K_NEW, { hl: S.CL_Window }); const a = (cpu.xh << 8) | cpu.xl;
    poke16(a + S.View_x, x); me.ram[a + S.View_y] = y; poke16(a + S.View_w, w); me.ram[a + S.View_h] = h; poke16(a + S.Window_title, title);
    return a;
  };
  const sum = (...ts) => ts.reduce((p, c) => p + c, 0);
  // the whole-desk repaint: every cell dirty, no window (bar + desk): W_INVAL of the screen, then W_UPDATE
  setGA(0, 0, 512, 192); const ti = R(S.W_INVAL); const tDesk = R(S.W_UPDATE);
  row('whole-desk repaint: W_UPDATE with every cell dirty, no window (the bar and the 25% / paper desk), after the shell\'s window is closed (LOOK 9)', tDesk, LOOKB.desk, `T-states; the W_INVAL before it ${ti}`);
  const A = newW(128, 48, 256, 96), B = newW(128, 48, 256, 96);
  const tOpen = sum(R(S.W_OPEN, { ix: A }), R(S.W_UPDATE));
  row('window open: W_OPEN + W_UPDATE of an empty 256 x 96 window over the desk (LOOK 10: the measured figure, rounded up; 90,389 before the look)', tOpen, LOOKB.open, 'T-states');
  const tOpenB = sum(R(S.W_OPEN, { ix: B }), R(S.W_UPDATE));
  row('window open over a window: W_OPEN + W_UPDATE of a second 256 x 96 window on the first, report', tOpenB, null, 'T-states');
  const tRaise = sum(R(S.W_RAISE, { ix: A }), R(S.W_UPDATE));
  row('window raise: two empty 256 x 96 windows, W_RAISE of the hidden one + W_UPDATE (LOOK 10: the measured figure, rounded up; 91,944 before the look)', tRaise, LOOKB.raise, 'T-states');
  const tDraw = R(S.W_DRAWVIEW, { ix: A });
  row('window draw: W_DRAWVIEW of the front empty 256 x 96 window (active look) (LOOK 10: the measured figure, rounded up; 82,397 before the look)', tDraw, LOOKB.draw, 'T-states');
  setGA(0, 0, 512, 192); R(S.W_INVAL); const tAll = R(S.W_UPDATE);
  row('W_UPDATE of a whole-screen desk with two windows: every cell dirty, the bar, the desk and a 256 x 96 window (LOOK 9, 10: reported; 249,839 before the look)', tAll, LOOKB.all, 'T-states');
  const tClose = sum(R(S.W_CLOSE, { ix: A }), R(S.W_UPDATE));
  row('window close: W_CLOSE + W_UPDATE of the front window, report', tClose, null, 'T-states');
}

console.log('\n| Measure | Measured | Bound | Result |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${fmt(r.measured)} | ${r.bound === null ? 'report' : '<= ' + fmt(r.bound)} | ${r.status} |`);
console.log(`shell-perf: ${rows.filter((r) => r.status === 'pass').length} passed, ${missed} missed, ${rows.filter((r) => r.status === 'reported').length} reported`);
if (missed) process.exitCode = 1;
