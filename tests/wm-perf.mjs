"use strict";
// wm-perf.mjs -- the W1 rows of docs/WINDOWS.md section 9, measured as 14.6 says (TSRun, T-states, direct calls with the sentinel return,
// interrupts off, the pointer at (500, 180) and no frame run), printed as a table: measured, bound, pass / MISSED / reported.  Written from
// the contract.   node tests/wm-perf.mjs [--seed N] [--build]
// A MISSED bound is reported with its numbers and sets the exit code; nothing here weakens a bound.
//
// Readings: the cartridge's own K_ARENA is the app arena; "plain Window" is CL_Window; the windows are opened with W_OPEN and the screen
// is settled with W_UPDATE before each measured call; "bytes" is (K_CODE_END - K_CODE + 14) - 2,394 (step 3's figure, OBJECTS_EVENTS 16.4),
// W1's growth, against step 4's whole bound of 4,096 (W2 and W3 add to it).
import { checks, Z } from './lib.mjs';
import { makeRng, call, hex, rd16, setGA } from './gfx6-lib.mjs';
import { armStack, stackUsed } from './kern-lib.mjs';
import { startW } from './wm-lib.mjs';
import { menuSpec, encodeTable, layoutOf } from './wm-model3.mjs';

const argv = process.argv.slice(2);
const SEED = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED} (the measurements are deterministic; the seed only picks the registers the routines ignore)`);
const C = checks('wm W1 perf');
const ctx = startW(C);
if (!ctx) { console.log('the kern4 cartridge is not available: nothing to measure'); C.done(); process.exit(); }
const { m, S, img } = ctx;
const rng = makeRng(SEED);
const rows = [];
const row = (name, measured, bound, unit = 'T') => rows.push({ name, measured, bound, unit });
const run = (name, regs = {}, o = {}) => call(m, S, name, regs, { ints: false, rng, guard: 60_000_000, ...o });
const R = (a) => rd16(m, a);
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; };
const poke16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
const desk = R(S.W_SLOTS), bar = R(S.W_SLOTS + 30);
const karenaUsed = R(S.K_KARENA) - 0xF500;                      // the kernel arena after the boot's W_INIT

const TITLE = [S.T_TITLE1, S.T_TITLE2];
let wins = [];
function kNew(kind) { const r = run('K_NEW', { hl: S[`CL_${kind}`] }); if (r.regs.f & 1) throw new Error(`K_NEW ${kind}: arena full`); return r.regs.ix; }
function setRect(a, x, y, w, h) { poke16(a + S.View_x, x); poke8(a + S.View_y, y); poke16(a + S.View_w, w); poke8(a + S.View_h, h); }
function newW(kind, x, y, w, h, title = TITLE[0]) {
  const a = kNew(kind); setRect(a, x, y, w, h); poke16(a + S.Window_title, title); return a;
}
const open = (a) => { const r = run('W_OPEN', { ix: a }); if (r.regs.f & 1) throw new Error(`W_OPEN ${hex(a)} refused`); wins.push(a); };
const settle = () => run('W_UPDATE');
function fresh() {
  for (const a of wins) run('W_CLOSE', { ix: a });
  for (const a of wins) run('T_SEND', { ix: a, a: S.M_DESTROY });
  wins = [];
  settle();
}
const gaInval = (x, y, w, h) => { setGA(m, S, x, y, w, h); return run('W_INVAL'); };
// the map as W_INIT leaves it (every cell dirty, no window) is W_INVAL of the whole screen; clean is W_UPDATE.  The map is never poked: W1
// keeps internal state next to it (14.2, $F422-$F47F) that a poke would not update.
const setMap = (initState) => { if (initState) gaInval(0, 0, 512, 192); else settle(); };

// ---- the headline window rows -------------------------------------------------------------------------------------------------------
{
  fresh();
  const A = newW('Window', 128, 48, 256, 96, TITLE[0]), B = newW('Window', 128, 48, 256, 96, TITLE[1]);
  open(A); open(B); settle();
  row('window raise: two empty 256 x 96 windows, W_RAISE of the hidden one + W_UPDATE (T_RAISEUPD)', run('T_RAISEUPD', { ix: A }).t, 90000);   // owner decision C (docs/WINDOWS.md 16.3, 16.5): the measured figure after B, rounded up; was 80,000
  fresh();
  const A2 = newW('Window', 128, 48, 256, 96, TITLE[0]);
  row('W_OPEN + W_UPDATE: an empty 256 x 96 window over the desk (T_OPENUPD)', run('T_OPENUPD', { ix: A2 }).t, 89000);   // decision C; was 80,000 wins.push(A2);
  settle();
  row('W_CLOSE + W_UPDATE: the same window, the only one (T_CLOSEUPD)', run('T_CLOSEUPD', { ix: A2 }).t, 63000);   // decision C; was 60,000 wins.pop(); run('T_SEND', { ix: A2, a: S.M_DESTROY });
  fresh();
  const A3 = newW('Window', 0, 8, 256, 96, TITLE[0]); open(A3); settle();
  row('W_MOVE + W_UPDATE: the same window from (0, 8) to (256, 96), no overlap with the old place (T_MOVEUPD)', run('T_MOVEUPD', { ix: A3, hl: 256, de: 96 }).t, 168000);   // decision C; was 140,000
  fresh();
}

// ---- W_INVAL ---------------------------------------------------------------------------------------------------------------------------
{
  setMap(false);
  row('W_INVAL 256 x 96 at (128, 48), clean map', gaInval(128, 48, 256, 96).t, 5000);
  setMap(false);
  row('W_INVAL the whole screen, clean map', gaInval(0, 0, 512, 192).t, 20000);
  setMap(false);
  row('  W_INVAL one cell, clean map', gaInval(130, 50, 1, 1).t, null);
  setMap(false);
}

// ---- K_GETEV ---------------------------------------------------------------------------------------------------------------------------
{
  settle(); setMap(false);
  if (m.ram[S.K_PN] !== 0 || m.ram[S.K_RHEAD] !== m.ram[S.K_RTAIL]) throw new Error('the queues are not empty');
  row('K_GETEV: queues empty, nothing dirty (carry)', run('K_GETEV').t, 100);
  gaInval(130, 50, 1, 1);
  const r = run('K_GETEV');
  if (r.regs.a !== 6 || (r.regs.f & 1)) throw new Error(`K_GETEV with W_DIRTY = 1 returned A ${r.regs.a}, carry ${r.regs.f & 1}, want E_REDRAW`);
  row('K_GETEV: queues empty, W_DIRTY != 0 (E_REDRAW returned)', r.t, 150);
  settle();
}

// ---- W_UPDATE overhead and the cost of each further rectangle ---------------------------------------------------------------------------
{
  fresh();
  const nullDesk = kNew('TNull'), nullBar = kNew('TNull');
  setRect(nullDesk, 0, 0, 512, 192); setRect(nullBar, 0, 0, 512, 8);
  poke16(S.W_SLOTS, nullDesk); poke16(S.W_SLOTS + 30, nullBar);
  setMap(true);
  row('W_UPDATE overhead: the map as W_INIT leaves it (bar + desk, 2 rectangles), M_DRAW a RET', run('W_UPDATE').t, 31000); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 20,000
  const cells = (list) => { setMap(false); for (const c of list) gaInval(16 * c, 40, 16, 8); };
  cells([0]); const t1 = run('W_UPDATE').t;
  cells(Array.from({ length: 16 }, (_, i) => 2 * i)); const t16 = run('W_UPDATE').t;
  row(`W_UPDATE per further rectangle: (T(16) - T(1)) / 15, T(1) = ${t1}, T(16) = ${t16}`, Math.ceil((t16 - t1) / 15), 2300); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 1,500
  poke16(S.W_SLOTS, desk); poke16(S.W_SLOTS + 30, bar);
  run('T_SEND', { ix: nullDesk, a: S.M_DESTROY }); run('T_SEND', { ix: nullBar, a: S.M_DESTROY });
  setMap(false);
}

// ---- K_FOCUSNEXT / K_FOCUSPREV: 32 views under an open TWin that is the scope ----------------------------------------------------------------
{
  const shapes = {};
  shapes.fan = Array.from({ length: 32 }, (_, i) => (i ? 0 : -1));
  shapes.chains = (() => { const par = [-1]; for (const len of [7, 7, 7, 7, 3]) for (let j = 0; j < len; j++) par.push(j ? par.length - 1 : 0); return par; })();
  shapes.heap = Array.from({ length: 32 }, (_, i) => (i ? (i - 1) >> 1 : -1));
  shapes.spine = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 7 ? i - 1 : (i % 6) + 1));
  shapes.groups = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 5 ? 0 : i <= 30 ? 1 + ((i - 6) % 5) : 0));
  shapes.reverse = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 7 ? i - 1 : 6));
  let seed = 99; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  for (let t = 0; t < 3; t++) {
    const par = [-1], depth = [1];
    for (let i = 1; i < 32; i++) { let p; do { p = rnd(i); } while (depth[p] >= 8); par.push(p); depth.push(depth[p] + 1); }
    shapes[`random${t}`] = par;
  }
  let worstN = 0, worstP = 0, whoN = '', whoP = '', calls = 0;
  for (const [shape, par] of Object.entries(shapes)) {
    fresh();
    const v = par.map((p, i) => (i === 0 ? newW('TWin', 16, 8, 256, 96, TITLE[0]) : kNew('TCtl')));
    par.forEach((p, i) => { if (i) { setRect(v[i], 20, 20, 10, 10); run('K_ADDCHILD', { ix: v[p], de: v[i] }); } });
    open(v[0]);
    if (R(S.K_FSCOPE) !== v[0]) throw new Error('the TWin is not the scope');
    const order = []; const kids = (i) => par.map((p, j) => (p === i ? j : -1)).filter((j) => j >= 0);
    (function dfs(i) { order.push(i); kids(i).forEach(dfs); })(0);
    const setFlags = (mode, s) => {
      const n = order.length;
      for (let i = 1; i < 32; i++) {
        let f = 1;
        if (mode === 'none') f = 0;
        else if (mode === 'last') { const idx = s < 0 ? n - 1 : (order.indexOf(s) + n - 1) % n; f = i === order[idx] ? 1 : 0; }
        else if (mode === 'mixed') f = [1, 1, 3, 5, 0, 1][rnd(6)];
        m.ram[v[i] + S.View_flags] = f;
      }
      m.ram[v[0] + S.View_flags] = mode === 'last' && s >= 0 && order[(order.indexOf(s) + order.length - 1) % order.length] === 0 ? 1 : (mode === 'all' ? 1 : 0);
    };
    for (const mode of ['all', 'last', 'none', 'mixed']) for (let s = -1; s < 32; s++) {
      for (const dir of ['K_FOCUSNEXT', 'K_FOCUSPREV']) {
        setFlags(mode, s); poke16(S.K_FOCUS, s < 0 ? 0 : v[s]);
        const t = run(dir).t; calls++;
        if (dir === 'K_FOCUSNEXT') { if (t > worstN) { worstN = t; whoN = `${shape}/${mode}/start ${s}`; } } else if (t > worstP) { worstP = t; whoP = `${shape}/${mode}/start ${s}`; }
      }
    }
  }
  poke16(S.K_FOCUS, 0);
  row(`K_FOCUSNEXT, 32 views under a TWin scope, worst of ${calls / 2} walks (${whoN})`, worstN, 11000);
  row(`K_FOCUSPREV, 32 views under a TWin scope, worst of ${calls / 2} walks (${whoP})`, worstP, 18000);
  fresh();
}

// ---- stack: W_UPDATE of a TWin holding a chain of 7 TGrp and a TCtl at the bottom, all meeting the clip -----------------------------------------
{
  let used = 0;
  for (const pat of [0x55, 0xAA]) {
    fresh();
    const w = newW('TWin', 0, 8, 512, 184, TITLE[0]);
    let parent = w, x = 2, y = 18, ww = 508, hh = 170;
    for (let d = 0; d < 7; d++) { const g = kNew('TGrp'); setRect(g, x, y, ww, hh); run('K_ADDCHILD', { ix: parent, de: g }); parent = g; x += 4; y += 4; ww -= 8; hh -= 8; }
    const leaf = kNew('TCtl'); setRect(leaf, x, y, ww, hh); run('K_ADDCHILD', { ix: parent, de: leaf });
    open(w);
    armStack(m, pat);
    run('W_UPDATE');
    used = Math.max(used, stackUsed(m, pat));
  }
  row('stack: W_UPDATE of a TWin, 7 nested TGrp and a TCtl, all meeting the clip', used, 192, 'B');
  fresh();
}

// ---- reports ----------------------------------------------------------------------------------------------------------------------------------
{
  fresh();
  const w = newW('TWin', 16, 8, 256, 96, TITLE[0]), c = kNew('TCtl');
  setRect(c, 40, 40, 64, 16); run('K_ADDCHILD', { ix: w, de: c });
  open(w); settle();
  row('report: W_DRAWVIEW of a 64 x 16 TCtl in the front window', run('W_DRAWVIEW', { ix: c }).t, null);
  const wp = newW('Window', 0, 8, 256, 96, TITLE[1]);
  row('report: W_DRAWVIEW of the front window itself, plain Window 256 x 96 (the content cleared, no children)', (open(wp), settle(), run('W_DRAWVIEW', { ix: wp }).t), null);
  fresh();
  row('report: W_UPDATE with every cell dirty and the real bar and desk, no windows (whole screen cleared)', (setMap(true), run('W_UPDATE').t), null);
  row('report: kernel arena bytes used after the boot\'s W_INIT (Desk + MenuBar)', karenaUsed, null, 'B');
  row('report: W_INIT (a second call, T-states)', run('W_INIT').t, null);
  const growth = S.K_CODE_END - S.K_CODE + 14 - 2394;
  row('bytes: W1\'s growth of K_CODE_END - K_CODE (step 3 was 2,394); step 4\'s whole bound is 4,096, W2 and W3 add to this', growth, 4096, 'B');
}

// ---- W2 (17.7): the drag step, the every-frame event paths, and the reports ----------------------------------------------------------------------------
// Measured as 17.7 says: direct calls, interrupts off, the pointer at (500, 180).  Without the W2 symbols these rows are skipped with a note.
const W2SYMS = ['w_outline', 'T_EVONE', 't_event', 'CL_Button', 'button_draw', 'button_event', 'Button_text', 'T_SOK', 'K_RING', 'K_RTAIL', 'K_RHEAD'];
if (W2SYMS.some((n) => S[n] === undefined)) console.log(`W2 rows skipped: missing ${W2SYMS.filter((n) => S[n] === undefined).join(', ')}`);
else {
  const REG8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  /**
   * A direct call, stepped: T-states from the first instruction until PC = stopPc (the instruction there not executed) or the return to T_RET.  Interrupts
   * are off.  A HALT is not waited for: its time is not counted and the CPU goes on (`waits` counts them), the pattern of a key click's four frames.
   */
  function steppedT(addr, regs = {}, stopPc = null) {
    const cpu = m.cpu, want = {};
    for (const [k, v] of Object.entries(regs)) { if (PAIRS[k]) { want[PAIRS[k][0]] = (v >> 8) & 0xFF; want[PAIRS[k][1]] = v & 0xFF; } else want[k] = v & 0xFF; }
    for (const r of REG8) cpu[r] = want[r] !== undefined ? want[r] : rng.byte();
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
    cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8; cpu.pc = addr;
    let t = 0, steps = 0, waits = 0;
    while (cpu.pc !== S.T_RET) {
      if (stopPc !== null && cpu.pc === stopPc && steps > 0) return { t, stopped: true, waits };
      const t0 = m.tstates;
      Z.runZ80(cpu, m.bus, 1, m);
      if (cpu.halted) { waits++; cpu.halted = false; } else t += m.tstates - t0;
      if (++steps > 4_000_000) throw new Error(`steppedT ${hex(addr)}: runaway at $${cpu.pc.toString(16)}`);
    }
    if (stopPc !== null) throw new Error(`steppedT ${hex(addr)}: PC never reached $${stopPc.toString(16)}`);
    return { t, stopped: false, waits };
  }
  const setEv = (a, b, c, d) => { m.ram[S.K_EV] = a; m.ram[S.K_EV + 1] = b; m.ram[S.K_EV + 2] = c; m.ram[S.K_EV + 3] = d; };
  const ringPut = (type, d1, d2, d3) => { const tail = m.ram[S.K_RTAIL], a = S.K_RING + (tail & 0x3F); m.ram[a] = type; m.ram[a + 1] = d1; m.ram[a + 2] = d2; m.ram[a + 3] = d3; m.ram[S.K_RTAIL] = (tail + 4) & 0xFF; };
  const drain = () => { m.ram[S.K_PN] = 0; m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; };
  const ptEv = (type, x, y, held) => [type, x & 255, y, ((x >> 8) & 1) | (held ? 2 : 0)];

  // the drag step: w_outline of a 256 x 96 window at (128, 48), then at (144, 48): the sum of the two calls
  fresh();
  const Wd = newW('Window', 128, 48, 256, 96, TITLE[0]); open(Wd); settle();
  const o1 = run('w_outline', { ix: Wd, hl: 128, de: 48 }).t, o2 = run('w_outline', { ix: Wd, hl: 144, de: 48 }).t;
  run('w_outline', { ix: Wd, hl: 144, de: 48 }); run('w_outline', { ix: Wd, hl: 128, de: 48 });          // XORed back
  row(`drag step: w_outline of a 256 x 96 window at (128, 48) = ${o1} T, then at (144, 48) = ${o2} T, the sum`, o1 + o2, 32000); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 25,000
  fresh();

  // the every-frame paths: desk, bar, three open windows; the front one (256 x 96) holds 8 TCtl (24 x 16) side by side, all focusable
  {
    fresh();
    const B1 = newW('TWin', 16, 8, 128, 64, TITLE[1]), B2 = newW('TWin', 16, 80, 128, 64, TITLE[1]), F = newW('TWin', 160, 56, 256, 96, TITLE[0]);
    const kids = [];
    for (let i = 0; i < 8; i++) {
      const c = kNew('TCtl'); setRect(c, 160 + 8 + 24 * i, 56 + 16, 24, 16); poke8(c + S.View_flags, 1); poke8(c + S.TCtl_tag, 0); poke8(c + S.View_id, i + 1);
      run('K_ADDCHILD', { ix: F, de: c }); kids.push(c);
    }
    open(B1); open(B2); open(F); settle();
    const px = 160 + 8 + 24 * 7 + 5, py = 56 + 16 + 5;
    const measure = (how, ev) => {
      drain(); poke16(S.K_CAPTURE, 0);
      if (how === 'ring') ringPut(...ev); else run('K_POST', { a: ev[0], c: ev[1], e: ev[2], d: ev[3] });
      const r = steppedT(S.T_EVONE, {}, S.t_event);
      drain(); return r.t;
    };
    run('K_SETFOCUS', { de: 0 });
    const mvR = measure('ring', ptEv(2, px, py, 0)), mvP = measure('posted', ptEv(2, px, py, 0));
    row(`E_MOVE, no capture: desk -> front window -> 8 TCtl, the last hit, to its handler (ring ${mvR}, posted ${mvP}; the worse)`, Math.max(mvR, mvP), 3900); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 3,500
    const dn = (how) => { run('K_SETFOCUS', { de: kids[0] }); return measure(how, ptEv(3, px, py, 1)); };
    const dnR = dn('ring'), dnP = dn('posted');
    row(`E_DOWN on the last TCtl of the front window, the focus on the first (ring ${dnR}, posted ${dnP}; the worse)`, Math.max(dnR, dnP), 5700); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 4,500
    poke16(S.K_CAPTURE, 0); run('K_SETFOCUS', { de: 0 });
  }

  // reports: button_draw 64 x 16 in its states; W_DRAWVIEW of a pressed button; a key click without its 4 frames; W_DRAG from the E_DOWN to the first outline
  {
    fresh();
    const Wb = newW('TWin', 160, 56, 256, 96, TITLE[0]), b = kNew('Button');
    setRect(b, 180, 80, 64, 16); poke16(b + S.Button_text, S.T_SOK); poke8(b + S.View_flags, 1); poke8(b + S.View_id, 7);
    run('K_ADDCHILD', { ix: Wb, de: b }); open(Wb); settle();
    const draw = (flags, focused) => { poke8(b + S.View_flags, flags); poke16(S.K_FOCUS, focused ? b : 0); return run('button_draw', { ix: b }).t; };
    const tn = draw(1, false), tp = draw(9, false), td = draw(0x11, false), tf = draw(1, true), tall = draw(0x19, true);
    row(`report: button_draw 64 x 16 "OK": normal ${tn}, pressed ${tp}, default ${td}, focused ${tf}, all three ${tall} (the largest)`, Math.max(tn, tp, td, tf, tall), null);
    poke8(b + S.View_flags, 9); poke16(S.K_FOCUS, 0);
    row('report: W_DRAWVIEW of a 64 x 16 Button, pressed, in the front window', run('W_DRAWVIEW', { ix: b }).t, null);
    poke8(b + S.View_flags, 1); poke16(S.K_FOCUS, b); run('W_DRAWVIEW', { ix: b });
    setEv(1, 13, 0, 0); drain();
    const kc = steppedT(S.button_event, { ix: b, de: S.K_EV });
    row(`report: a key click (ENTER on the focused button, button_event to the E_CMD posted; ${kc.waits} HALT(s) not waited for)`, kc.t, null);
    drain(); settle();
    // W_DRAG: an E_DOWN in the front window's title bar with an E_MOVE (one cell and a bit) waiting; to the first w_outline
    poke16(S.K_FOCUS, 0); drain(); poke16(S.K_CAPTURE, 0);
    run('K_POST', { a: 2, c: (200 + 20) & 255, e: 60, d: 0 });
    setEv(3, 200, 60, 2);
    const dr = steppedT(S.K_DISPATCH, {}, S.w_outline);
    row('report: W_DRAG from the E_DOWN (K_DISPATCH) to the first outline drawn (the window in front, nothing dirty)', dr.t, null);
    drain(); poke16(S.K_CAPTURE, 0);
    fresh();
  }
}

// ---- W3 (18.7): menu open, close, highlight, and the reports ---------------------------------------------------------------------------------------------
// Measured as 18.7 says: direct calls, interrupts off, the pointer at (500, 180).  `src/kern4.asm`'s T_MENU8 has wrong length bytes ("New text" is 8 codes but its
// length byte is 9; "Save text" 9 against 10), so MB_SET refuses it: the menu of 8 items about 96 pixels wide is built in RAM (at $DC00) with the same strings.
const W3SYMS = ['MB_SET', 'MB_ENABLE', 'mbar_event', 'T_MENUS', 'K_POST', 'K_GETEV', 'K_EV'];
if (W3SYMS.some((n) => S[n] === undefined)) console.log(`W3 rows skipped: missing ${W3SYMS.filter((n) => S[n] === undefined).join(', ')}`);
else {
  fresh(); settle();
  const cpu = m.cpu;
  const REG = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  /** The CPU state of a direct call to `addr` with IX = ix and the sentinel return, interrupts off; nothing is run yet. */
  const startCall = (addr, ix) => {
    for (const r of REG) cpu[r] = rng.byte();
    cpu.xh = ix >> 8; cpu.xl = ix & 255;
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
    cpu.sp = 0xFF00 - 2; m.ram[cpu.sp] = S.T_RET & 0xFF; m.ram[cpu.sp + 1] = S.T_RET >> 8; cpu.pc = addr;
  };
  /** Step until `cond()` holds (checked before each instruction, never before the first); returns the T-states. */
  const stepUntil = (cond, what) => {
    let t = 0, n = 0;
    for (;;) {
      if (n > 0 && cond()) return t;
      const t0 = m.tstates; Z.runZ80(cpu, m.bus, 1, m); t += m.tstates - t0;
      if (cpu.halted) throw new Error(`${what}: the loop halted (it waited for an event the test did not post)`);
      if (++n > 6_000_000) throw new Error(`${what}: runaway at $${cpu.pc.toString(16)}`);
    }
  };
  const drainQ = () => { m.ram[S.K_PN] = 0; m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; };
  /** K_POST in the middle of a stepped run: the CPU state is saved, K_POST runs on a stack of its own at $DF00 (not the measured one), the state is restored. */
  const post = (type, x, y, held) => {
    const keep = {}; for (const r of [...REG, 'pc', 'sp', 'iff1', 'iff2', 'halted']) keep[r] = cpu[r];
    for (const r of REG) cpu[r] = 0;
    cpu.a = type; cpu.c = x & 255; cpu.e = y; cpu.d = ((x >> 8) & 1) | (held ? 2 : 0);
    cpu.sp = 0xDF00 - 2; m.ram[cpu.sp] = S.T_RET & 0xFF; m.ram[cpu.sp + 1] = S.T_RET >> 8; cpu.pc = S.K_POST; cpu.iff1 = cpu.iff2 = false; cpu.halted = false;
    stepUntil(() => cpu.pc === S.T_RET, 'K_POST');
    if (cpu.f & 1) throw new Error('K_POST: the posted queue is full');
    for (const r of Object.keys(keep)) cpu[r] = keep[r];
  };
  const setEv3 = (a, x, y, held) => { m.ram[S.K_EV] = a; m.ram[S.K_EV + 1] = x & 255; m.ram[S.K_EV + 2] = y; m.ram[S.K_EV + 3] = ((x >> 8) & 1) | (held ? 2 : 0); };
  const M8 = [menuSpec(2, 'File', [[1, 0, 'New text'], [2, 0, 'Open text'], [3, 0, 'Save text'], [4, 0, 'Save as..'], [5, 0, 'Close all'], [6, 0, 'Print one'], [7, 0, 'Page size'], [8, 0, 'Quit Leap']])];
  const L8 = layoutOf(M8), d8 = L8.drops[0], b8 = L8.boxes[0];
  const T8 = 0xDC00; encodeTable(M8, T8).forEach((b, i) => poke8(T8 + i, b));
  const itemPt = (k) => [d8.x + (d8.w >> 1), 9 + 10 * k + 5];
  const titlePt = [b8.x + (b8.w >> 1), 3];
  settle();
  const tSet8 = run('MB_SET', { hl: T8 });
  if (tSet8.regs.f & 1) throw new Error('MB_SET of the 8-item table was refused');
  const tRepaint = run('W_UPDATE').t;
  /** One run of the tracking: open (E_DOWN on the title), then the events in `evs` (each taken by the loop); returns the times. */
  function track(evs) {
    drainQ(); setEv3(3, titlePt[0], titlePt[1], true);
    armStack(m, 0x55);
    startCall(S.mbar_event, bar);
    const o = { open: stepUntil(() => cpu.pc === S.K_GETEV, 'menu open'), steps: [] };
    for (let i = 0; i < evs.length; i++) {
      const ev = evs[i], ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8); if (process.env.TRACE) console.log('ret', ret.toString(16), 'pc', cpu.pc.toString(16));      // the loop's K_GETEV call: its return address
      post(...ev);
      stepUntil(() => cpu.pc === ret, 'K_GETEV (the event is taken)');          // not counted: the time of the loop's own K_GETEV
      o.steps.push(stepUntil(() => cpu.pc === (i === evs.length - 1 && ev[0] === 4 ? S.T_RET : S.K_GETEV), 'handling'));
    }
    o.stack = stackUsed(m, 0x55);
    cpu.pc = S.T_RET; drainQ();
    return o;
  }
  const it0 = itemPt(0), it1 = itemPt(1);
  // open, a highlight on item 0, moved to item 1 (erase + draw), then the close with an item highlighted (a choice, E_MENU posted)
  const tr1 = track([[2, ...it0, true], [2, ...it1, true], [4, ...it1, false]]);
  row('menu open: 8 items, 96 pixels wide (RAM copy of T_MENU8): from mbar_event\'s first instruction to the loop\'s first K_GETEV', tr1.open, 139000); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 100,000
  row('menu highlight moved to the next item (item 0 -> 1): from the E_MOVE taken by the loop to the loop\'s next K_GETEV', tr1.steps[1], 14500); // owner 2026-11-12 (docs/WINDOWS.md 16.7): the measured figure, rounded up; was 8,000
  row('report: the first highlight (none -> item 0), E_MOVE taken to the next K_GETEV', tr1.steps[0], null);
  row('report: a choice, from the E_UP taken (item 1 highlighted) to mbar_event\'s return, E_MENU posted', tr1.steps[2], null);
  // close with no choice: open, then the E_UP with nothing highlighted
  const tr2 = track([[4, 300, 150, false]]);
  row('menu close with no choice: from the E_UP taken by the loop (nothing highlighted) to mbar_event\'s return', tr2.steps[0], 30000);
  row('stack: menu tracking (open, two highlights, a choice; open, close), bytes below the return address, interrupts off', Math.max(tr1.stack, tr2.stack), 192, 'B');
  row('report: MB_SET of the 8-item table (layout and damage)', tSet8.t, null);
  row('report: the bar\'s repaint with one title (W_UPDATE, only the bar dirty)', tRepaint, null);
  row('report: MB_SET of T_MENUS (3 menus)', run('MB_SET', { hl: S.T_MENUS }).t, null);
  row('report: the bar\'s repaint with the 3 titles of T_MENUS', run('W_UPDATE').t, null);
  row('report: MB_ENABLE', run('MB_ENABLE', { a: 1, c: 3, b: 1 }).t, null);
  run('MB_SET', { hl: 0 }); settle();
  const g3 = S.K_CODE_END - S.K_CODE + 14 - 2394 + ((S.K1_CODE_END !== undefined && S.K1_CODE !== undefined) ? S.K1_CODE_END - S.K1_CODE : 0);
  row('bytes so far: growth of K_CODE_END - K_CODE (+ K1_CODE_END - K1_CODE, menus in chunk 1) against step 4\'s 4,096 (W2 and W3 included)', g3, 4850, 'B');   // owner 2026-11-12 (docs/WINDOWS.md 16.7, 16.8): the size pass's result, 4,837, rounded up; was 4,096
}

// ---- print --------------------------------------------------------------------------------------------------------------------------------------
const w = Math.max(...rows.map((r) => r.name.length));
console.log(`${'measure'.padEnd(w)}  ${'measured'.padStart(10)}  ${'bound'.padStart(8)}  status`);
let missed = 0;
for (const r of rows) {
  const status = r.bound === null ? 'reported' : r.measured <= r.bound ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  console.log(`${r.name.padEnd(w)}  ${(r.measured.toLocaleString('en-US') + (r.unit === 'B' ? ' B' : '')).padStart(10)}  ${(r.bound === null ? '-' : r.bound.toLocaleString('en-US')).padStart(8)}  ${status}`);
}
console.log(missed ? `${missed} bound(s) MISSED` : 'no bound missed');
if (missed) process.exitCode = 1;
void img;
