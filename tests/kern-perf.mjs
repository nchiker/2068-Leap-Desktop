"use strict";
// kern-perf.mjs -- the K1 and K2 rows of docs/OBJECTS_EVENTS.md section 8, measured as 13.7 and 14.8 say (TSRun, T-states, direct calls with the
// sentinel return, interrupts off), printed as a table: measured, bound, pass / MISSED / reported.  Written from the contract.
//   node tests/kern-perf.mjs [--seed N]
// A MISSED bound is reported with its numbers and sets the exit code; nothing here weakens a bound.
import { start, makeRng, call, hex } from './gfx6-lib.mjs';
import { checks, Z, M, FRAME_T } from './lib.mjs';
import { buildClasses, MSG } from './kern-model.mjs';
import { neededFor, traceCall, armStack, stackUsed } from './kern-lib.mjs';
import { rowsOf, joyOf, KEY_NAMES } from './kern-model2.mjs';

const argv = process.argv.slice(2);
const SEED = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED} (the measurements are deterministic; the seed only picks the registers the routines ignore)`);
const C = checks('kern K1 perf');
const classes = buildClasses();
const K2NEEDED = ['K_POLL', 'K_WARP', 'K_GETEV', 'K_POST', 'P_ISRMOVE', 'T_ISRP', 'T_POLLD', 'T_EVLOOP', 'T_EVN', 'T_EVLOG', 'K_RING', 'K_POSTQ', 'K_RHEAD', 'K_RTAIL', 'K_PHEAD', 'K_PN', 'K_LOST',
  'K_PX', 'K_PY', 'K_BTN', 'K_KPMODE', 'K_CAPS', 'K_EV', 'PT_LOCK', 'PT_DIRTY', 'P_ISR', 'P_INIT', 'T_IDLE'];
const ctx = start(C, [...neededFor(classes), ...K2NEEDED], 'kern3');
if (!ctx) { console.log('the kern3 cartridge is not available: nothing to measure'); C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const rows = [];
const row = (name, measured, bound, unit = 'T') => rows.push({ name, measured, bound, unit });
const run = (name, regs = {}) => call(m, S, name, regs, { ints: false, rng });
const rd16 = (a) => m.ram[a] | (m.ram[a + 1] << 8);
const wr16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };

const ARENAS = [['app', S.K_AARENA, 0xC000, 0xE000], ['kernel', S.K_KARENA, 0xF100, 0xFB00]];
const fresh = () => { for (const [, rec, b, e] of ARENAS) run('K_AINIT', { hl: rec, de: b, bc: e }); run('K_ARENA', { hl: S.K_AARENA }); };
const useArena = (rec) => run('K_ARENA', { hl: rec });
const newObj = (name) => { const r = run('K_NEW', { hl: S[`CL_${name}`] }); if (r.regs.f & 1) throw new Error(`K_NEW ${name} failed (arena full)`); return { addr: r.regs.ix, t: r.t }; };
const setRect = (v, x, y, w, h) => { wr16(v + 8, x); m.ram[v + 10] = y; wr16(v + 11, w); m.ram[v + 13] = h; };

fresh();

// ---- message send: T_SEND's first instruction to the method's first instruction, worst over every class and message -------------
{
  let worst = 0, who = '';
  for (const c of classes.list) {
    if (S[`CL_${c.name}`] === undefined) continue;
    const inst = newObj(c.name).addr;
    for (let msg = 0; msg < c.count; msg++) {
      const target = S[c.slots[msg].label];
      const r = traceCall(m, S, S.T_SEND, { ix: inst, a: msg, bc: 0x1234, de: 0x5678 }, { ints: false, rng, stopPc: target });
      if (!r.stopped) throw new Error(`send ${c.name}.${msg}: never reached ${c.slots[msg].label}`);
      if (r.t > worst) { worst = r.t; who = `${c.name}.${msg}`; }
    }
    fresh();
  }
  row(`message send (worst: ${who})`, worst, 100);
}

// ---- K_NEW of a 16-byte class (TSz16), from the free list / from the arena top; worst over 20 calls each, both arenas ----------
{
  let top = 0, list = 0;
  for (const [, rec] of ARENAS) {
    fresh(); useArena(rec);
    const blocks = [];
    for (let i = 0; i < 20; i++) { const n = newObj('TSz16'); top = Math.max(top, n.t); blocks.push(n.addr); }
    for (const b of blocks) run('K_FREE', { ix: b });
    for (let i = 0; i < 20; i++) list = Math.max(list, newObj('TSz16').t);
  }
  row('K_NEW TSz16 from the free list', list, 450);
  row('K_NEW TSz16 from the arena top', top, 550);
  fresh();
  let t255 = 0; for (const [, rec] of ARENAS) { useArena(rec); t255 = Math.max(t255, newObj('TSz255').t); }
  row('K_NEW TSz255 (pool 14, from the top)', t255, null);
  fresh();
  const n24 = newObj('TLog').t; row('K_NEW TLog (24-byte block, from the top)', n24, null);
}

// ---- K_FREE: blocks of every pool in both arenas, and TSz40; 3 rounds (42 calls) ------------------------------------------------
{
  let worst = 0;
  for (let round = 0; round < 3; round++) {
    for (const [, rec] of ARENAS) {
      fresh(); useArena(rec);
      for (const name of ['TSz8', 'TSz9', 'TSz16', 'TSz24', 'TSz32', 'TSz33', 'TSz40']) {
        const a = newObj(name).addr;
        worst = Math.max(worst, run('K_FREE', { ix: a }).t);
      }
    }
  }
  row('K_FREE (every pool, both arenas, TSz40)', worst, 250);
}

// ---- K_ALLOC: 0, 1, 255, 4,000 bytes, and a full arena; 20 calls -----------------------------------------------------------------
{
  let worst = 0, full = 0;
  for (let round = 0; round < 4; round++) {
    fresh(); useArena(round & 1 ? S.K_KARENA : S.K_AARENA);
    for (const bc of [0, 1, 255, 4000]) worst = Math.max(worst, run('K_ALLOC', { bc }).t);
    full = Math.max(full, run('K_ALLOC', { bc: 65535 }).t);
    const room = rd16(S.K_CURA) ? (rd16(rd16(S.K_CURA) + 2) - rd16(rd16(S.K_CURA))) : 0;
    run('K_ALLOC', { bc: room });                                    // exactly the rest: the arena is full
    full = Math.max(full, run('K_ALLOC', { bc: 1 }).t, run('K_ALLOC', { bc: 0 }).t);
  }
  row('K_ALLOC 0 / 1 / 255 / 4,000 bytes', worst, 200);
  row('K_ALLOC on a full arena (carry)', full, 200);
}

// ---- reports -------------------------------------------------------------------------------------------------------------------
fresh();
for (const [name, rec, b, e] of ARENAS) {
  row(`K_AINIT ${name} arena (${(e - b) >> 8} pages)`, run('K_AINIT', { hl: rec, de: b, bc: e }).t, null);
  newObj('TSz16'); useArena(rec);
  row(`K_ARESET ${name} arena (${(e - b) >> 8} pages)`, run('K_ARESET', { hl: rec }).t, null);
}
{
  fresh();
  const buildKids = (n) => { const p = newObj('View').addr, kids = []; for (let i = 0; i < n; i++) { const k = newObj('View').addr; run('K_ADDCHILD', { ix: p, de: k }); kids.push(k); } return { p, kids }; };
  for (const n of [0, 1, 8]) { const { p } = buildKids(n), k = newObj('View').addr; row(`K_ADDCHILD at ${n} children`, run('K_ADDCHILD', { ix: p, de: k }).t, null); }
  { const { kids } = buildKids(8); row('K_UNLINK the first of 8 children', run('K_UNLINK', { ix: kids[0] }).t, null); }
  { const { kids } = buildKids(8); row('K_UNLINK the last of 8 children', run('K_UNLINK', { ix: kids[7] }).t, null); }
  { const r = newObj('View').addr; row('K_UNLINK of a root (no-op)', run('K_UNLINK', { ix: r }).t, null); }
  { const v = newObj('View').addr; setRect(v, 100, 20, 50, 10);
    row('view_hittest, hit', run('view_hittest', { ix: v, bc: 120, de: 25 }).t, null);
    row('view_hittest, miss in x', run('view_hittest', { ix: v, bc: 99, de: 25 }).t, null);
    row('view_hittest, miss in y', run('view_hittest', { ix: v, bc: 120, de: 30 }).t, null);
    row('view_hittest, miss D > 0', run('view_hittest', { ix: v, bc: 120, de: 0x0119 }).t, null); }
  { const v = newObj('View').addr; row('view_destroy of a leaf', run('view_destroy', { ix: v }).t, null); }
  { const { p } = buildKids(7); row('view_destroy of a tree of 8 (root + 7 children)', run('view_destroy', { ix: p }).t, null); }
  { const { p } = buildKids(7); wr16(S.K_ROOT, p); wr16(S.K_FOCUS, p); row('view_destroy of a tree of 8, root also K_ROOT / K_FOCUS', run('view_destroy', { ix: p }).t, null); }
}

// ---- stack (13.7): poison below the return address; 32 for the K1 routines, 128 for view_destroy of a tree of depth 8 ----------------
{
  const stackOfRun = (name, setup) => {
    let used = 0;
    for (const pat of [0x55, 0xAA]) {
      fresh(); const regs = setup();
      armStack(m, pat);
      call(m, S, name, regs, { ints: false, rng });
      used = Math.max(used, stackUsed(m, pat));
    }
    return used;
  };
  const chain = (depth) => { let top = newObj('View').addr, root = top; for (let i = 1; i < depth; i++) { const k = newObj('View').addr; run('K_ADDCHILD', { ix: top, de: k }); top = k; } return root; };
  const bound = 32;
  const cases = [
    ['K_NEW (from the top)', 'K_NEW', () => ({ hl: S.CL_TSz16 })],
    ['K_NEW (from the free list)', 'K_NEW', () => { const a = newObj('TSz16').addr; run('K_FREE', { ix: a }); return { hl: S.CL_TSz16 }; }],
    ['K_NEW (arena full)', 'K_NEW', () => { run('K_ALLOC', { bc: 0x2000 }); return { hl: S.CL_TSz16 }; }],
    ['K_FREE', 'K_FREE', () => ({ ix: newObj('TSz16').addr })],
    ['K_ALLOC', 'K_ALLOC', () => ({ bc: 100 })],
    ['K_ARENA', 'K_ARENA', () => ({ hl: S.K_KARENA })],
    ['K_ARESET', 'K_ARESET', () => ({ hl: S.K_AARENA })],
    ['K_AINIT', 'K_AINIT', () => ({ hl: S.K_AARENA, de: 0xC000, bc: 0xE000 })],
    ['K_ADDCHILD', 'K_ADDCHILD', () => { const p = newObj('View').addr, k1 = newObj('View').addr, k2 = newObj('View').addr; run('K_ADDCHILD', { ix: p, de: k1 }); return { ix: p, de: k2 }; }],
    ['K_UNLINK', 'K_UNLINK', () => { const p = newObj('View').addr, k = newObj('View').addr; run('K_ADDCHILD', { ix: p, de: k }); return { ix: k }; }],
    ['K_SETROOT', 'K_SETROOT', () => ({ de: newObj('View').addr })],
    ['view_hittest', 'view_hittest', () => ({ ix: newObj('View').addr, bc: 5, de: 5 })],
  ];
  for (const [label, name, setup] of cases) row(`stack: ${label}`, stackOfRun(name, setup), bound, 'B');
  row('stack: view_destroy of a leaf', stackOfRun('view_destroy', () => ({ ix: newObj('View').addr })), 128, 'B');
  row('stack: view_destroy of a chain of depth 8', stackOfRun('view_destroy', () => ({ ix: chain(8) })), 128, 'B');
  row('stack: send of M_DESTROY to a chain of depth 8 (T_SEND)', stackOfRun('T_SEND', () => ({ ix: chain(8), a: MSG.DESTROY })), 128 + 2, 'B');
}


// =================================================================================================================================
// K2 rows (14.8): queues, K_POLL, K_WARP, P_ISRMOVE, the whole ISR and the deadline over frame tests, ISR stack, code bytes
const cpu = m.cpu;
const rd8 = (a) => m.ram[a];
const setIn = (rows, joy) => { for (let r = 0; r < 8; r++) m.keyMatrix[r] = rows[r]; m.joystick[0] = joy; };
const IDLE = rowsOf([]);
const KIDX = (n) => KEY_NAMES.indexOf(n);
const REGS8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
void REGS8;

/** Put a queue state in RAM: posted pn at phead, ring ringN records from the free-running head rh (random record bytes; the last an E_MOVE when lastMove). */
function setQueue({ pn = 0, phead = 0, ringN = 0, rh = 0, lastMove = false }) {
  for (let i = 0; i < 80; i++) m.ram[S.K_RING + i] = rng.byte();
  m.ram[S.K_PN] = pn; m.ram[S.K_PHEAD] = phead; m.ram[S.K_RHEAD] = rh; m.ram[S.K_RTAIL] = (rh + 4 * ringN) & 0xFF; m.ram[S.K_LOST] = 0;
  if (lastMove && ringN > 0) m.ram[S.K_RING + (((rh + 4 * ringN - 4) & 0xFF) & 0x3F)] = 2;
}
// ---- K_POST: the worst over every queue state (posted 0-4, head 0-3, ring 0-16 at several heads, both wrapping) ------------------------
{
  let worst = 0, who = '';
  for (let pn = 0; pn <= 4; pn++) for (let ph = 0; ph < 4; ph++) for (const ringN of [0, 5, 16]) for (const rh of [0, 60, 252]) {
    setQueue({ pn, phead: ph, ringN, rh });
    const t = run('K_POST', { a: rng.int(6, 255), c: rng.byte(), e: rng.byte(), d: rng.byte() }).t;
    if (t > worst) { worst = t; who = `pn ${pn} phead ${ph}`; }
  }
  row(`K_POST (worst over every queue state: ${who})`, worst, 200);
}
// ---- K_GETEV: posted / ring / empty -------------------------------------------------------------------------------------------------
{
  let posted = 0, ring = 0, empty = 0, whoP = '', whoR = '';
  for (let pn = 0; pn <= 4; pn++) for (let ph = 0; ph < 4; ph++) for (const ringN of [0, 1, 7, 16]) for (let rh = 0; rh < 256; rh += (pn === 0 ? 4 : 52)) {
    setQueue({ pn, phead: ph, ringN, rh });
    const r = run('K_GETEV');
    if (r.regs.f & 1) empty = Math.max(empty, r.t);
    else if (pn > 0) { if (r.t > posted) { posted = r.t; whoP = `pn ${pn} phead ${ph} ring ${ringN}`; } }
    else if (r.t > ring) { ring = r.t; whoR = `ring ${ringN} head ${rh}`; }
  }
  row(`K_GETEV from the posted queue (worst: ${whoP})`, posted, 250);
  row(`K_GETEV from the ring (worst: ${whoR})`, ring, 250);
  row('K_GETEV empty', empty, 100);
}
// ---- K_WARP, P_ISRMOVE: report -------------------------------------------------------------------------------------------------------
{
  let w = 0; for (const [x, y] of [[0, 0], [511, 191], [-5, 300], [600, -9], [100, 100], [0x8000, 0x7FFF], [300, 150]]) w = Math.max(w, run('K_WARP', { hl: x & 0xFFFF, de: y & 0xFFFF }).t);
  row('K_WARP (worst over in range / clamped values)', w, null);
  let pu = 0, pl = 0;
  for (let i = 0; i < 20; i++) { m.ram[S.PT_LOCK] = 0; pu = Math.max(pu, run('P_ISRMOVE', { hl: rng.int(0, 511), de: rng.int(0, 191) }).t); m.ram[S.PT_LOCK] = 1; pl = Math.max(pl, run('P_ISRMOVE', { hl: rng.int(0, 511), de: rng.int(0, 191) }).t); }
  m.ram[S.PT_LOCK] = 0;
  row('P_ISRMOVE unlocked (sets the position)', pu, null); row('P_ISRMOVE locked (refused)', pl, null);
}
// ---- K_POLL: idle / key held / worst, direct calls with interrupts off ---------------------------------------------------------------------
const resetPoll = () => {
  m.ram[S.PT_LOCK] = 0; setIn(IDLE, 0xFF);
  m.ram[S.K_KPMODE] = 0; m.ram[S.K_CAPS] = 0;
  for (let i = 0; i < 4; i++) run('K_POLL');
  m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL] = 0; m.ram[S.K_PN] = 0; m.ram[S.K_PHEAD] = 0; m.ram[S.K_LOST] = 0; m.ram[S.K_BTN] = 0;
};
const poll = (rows, joy, lock = false) => { setIn(rows, joy); m.ram[S.PT_LOCK] = lock ? 1 : 0; const r = run('K_POLL'); m.ram[S.PT_LOCK] = 0; return r.t; };
const warpTo = (x, y) => run('K_WARP', { hl: x, de: y });
{
  // idle
  resetPoll();
  let idle = 0; for (let i = 0; i < 30; i++) idle = Math.max(idle, poll(IDLE, 0xFF));
  row('K_POLL idle (no key, joystick idle, nothing pending)', idle, 300);
  // key held: one key held since an earlier call, the repeat count not at 1 (calls 2 .. 29 after the press: counts 29 .. 2)
  let held = 0, whoH = '', atRep = 0, atPress = 0;
  for (const keys of [['A'], ['Z'], ['B'], ['SPACE'], ['ENTER'], ['Q'], ['CS', 'A'], ['SS', 'Z'], ['1'], ['M'], ['A', 'S'], ['L', 'K', 'J']]) {
    resetPoll();
    const rows = rowsOf(keys.map(KIDX));
    atPress = Math.max(atPress, poll(rows, 0xFF));
    for (let i = 1; i <= 28; i++) { const t = poll(rows, 0xFF); if (t > held) { held = t; whoH = `[${keys.join(' ')}] call ${i}`; } }
    poll(rows, 0xFF);                                                 // count 1
    atRep = Math.max(atRep, poll(rows, 0xFF));                          // the repeat fires
  }
  row(`K_POLL a key held (no change, repeat count not 1; worst: ${whoH})`, held, 900);
  row('K_POLL the frame a key goes down (report)', atPress, null);
  row('K_POLL the frame a repeat fires (report)', atRep, null);
  // worst: a move at full speed (free / into an edge), a button change, two new keys; pointer locked and unlocked; ring empty / with a move last / full
  let worst = 0, whoW = '', n = 0;
  const KEYPAIRS = [['A', 'S'], ['Z', 'B'], ['ENTER', 'SPACE'], ['CS', 'Q'], ['SS', 'Z'], ['CS', 'SS'].length ? ['1', 'T'] : []];
  const worstFrames = [];
  for (const dir of ['r', 'l', 'u', 'd', 'rd', 'lu']) for (const edge of [0, 1, 2]) for (const fire of [0, 1]) for (const kp of KEYPAIRS) for (const lock of [false, true]) for (const ringSt of ['empty', 'move', 'full']) {
    resetPoll();
    const hx = dir.includes('r') ? 100 : dir.includes('l') ? 400 : 250, hy = dir.includes('d') ? 40 : dir.includes('u') ? 150 : 90;
    for (let i = 0; i < 31; i++) { warpTo(hx, hy); poll(IDLE, joyOf(dir)); }                // hold = 30 (full speed)
    // the pointer next to an edge: edge 1 = 6 px short of it, edge 2 = on it
    const ex = dir.includes('r') ? 511 : dir.includes('l') ? 0 : 250, ey = dir.includes('d') ? 191 : dir.includes('u') ? 0 : 90;
    if (edge) { const x = edge === 1 ? (dir.includes('r') ? ex - 6 : dir.includes('l') ? ex + 6 : ex) : ex, y = edge === 1 ? (dir.includes('d') ? ey - 3 : dir.includes('u') ? ey + 3 : ey) : ey; warpTo(x, y); poll(IDLE, joyOf(dir), lock); }
    if (ringSt === 'move') setQueue({ ringN: 6, rh: 60, lastMove: true }); else if (ringSt === 'full') setQueue({ ringN: 16, rh: 200 });
    if (ringSt !== 'empty') { m.ram[S.K_LOST] = 0; }
    const t = poll(rowsOf(kp.map(KIDX)), joyOf(dir + (fire ? 'f' : '')), lock);
    n++;
    if (t > worst) { worst = t; whoW = `${dir} edge ${edge} fire ${fire} keys [${kp.join(' ')}] ${lock ? 'locked' : 'unlocked'} ring ${ringSt}`; }
  }
  row(`K_POLL worst frame: full-speed move (free / into an edge), button change, two new keys, locked / unlocked, ${n} frames (worst: ${whoW})`, worst, 2000);
  void worstFrames;
  // reported: other frames
  const rep = {};
  const note = (k, t) => { rep[k] = Math.max(rep[k] ?? 0, t); };
  for (let i = 0; i < 6; i++) {
    resetPoll(); note('one new key', poll(rowsOf([KIDX('A')]), 0xFF));
    resetPoll(); note('mode toggle (CS + SS)', poll(rowsOf([0, 36]), 0xFF));
    resetPoll(); note('caps lock key (CS + 2)', poll(rowsOf([0, KIDX('2')]), 0xFF));
    resetPoll(); warpTo(rng.int(0, 511), rng.int(0, 191)); note('a K_WARP pending, no input', poll(IDLE, 0xFF));
    resetPoll(); warpTo(rng.int(0, 511), rng.int(0, 191)); note('a K_WARP pending + move + button + two keys', poll(rowsOf([KIDX('A'), KIDX('S')]), joyOf('rf')));
    resetPoll(); poll(rowsOf([0, 36]), 0xFF); poll(IDLE, 0xFF); setIn(IDLE, 0xFF); note('keyboard-pointer mode: Q + SPACE (move + button)', poll(rowsOf([KIDX('Q'), KIDX('SPACE')]), 0xFF));
    resetPoll(); note('joystick move only (hold 0)', poll(IDLE, joyOf('r')));
    resetPoll(); note('button change only', poll(IDLE, joyOf('f')));
    resetPoll(); note('all four directions (nothing)', poll(IDLE, joyOf('udlrf')));
  }
  resetPoll();
  for (let k = 0; k < 40; k++) if (k !== 0 && k !== 36) { resetPoll(); note('one new key, worst over all 38', poll(rowsOf([k]), 0xFF)); }
  for (const [k, t] of Object.entries(rep)) row(`K_POLL (report) ${k}`, t, null);
  resetPoll();
}

// ---- the whole ISR and the pointer deadline over strict frames (the harness of tests/kern-k2.mjs): P_ISR moving + K_POLL worst -------------
{
  const step1 = () => Z.runZ80(cpu, m.bus, 1, m);
  const accepted = () => cpu.pc === 0x38;
  const parkLoop = () => { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_EVLOOP; };
  const runIsr = () => {
    const sp0 = cpu.sp + 2, ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8), t0 = m.tstates;
    let offIsrp = -1, tIsrp = 0, tPolld = 0, steps = 0;
    while (!(cpu.pc === ret && cpu.sp === sp0)) {
      if (cpu.pc === S.T_ISRP && offIsrp < 0) { offIsrp = m.tstates - m.frameStart; tIsrp = m.tstates; }
      if (cpu.pc === S.T_POLLD && tPolld === 0) tPolld = m.tstates;
      step1();
      if (++steps > 400000) throw new Error('the frame ISR did not return');
    }
    return { t: m.tstates - t0, offIsrp, kpollT: tPolld - tIsrp };
  };
  const prime = () => { for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { parkLoop(); M.runFrame(m); } parkLoop(); M.runFrame(m); if (!accepted()) throw new Error('prime: no interrupt pending'); };
  const stat = { frames: 0, maxT: 0, maxOff: 0, maxK: 0, stack: 0, vErr: 0, lost: 0, whoT: '' };
  let pat = 0;
  const frame = (keys, joy, label, warp = null) => {
    setIn(rowsOf(keys.map(KIDX)), joy);
    if (!accepted()) { stat.lost++; return false; }
    pat ^= 0xFF; armStack(m, pat === 0xFF ? 0x55 : 0xAA);
    const v0 = rd8(S.V_FRAMES) | (rd8(S.V_FRAMES + 1) << 8);
    const r = runIsr();
    stat.stack = Math.max(stat.stack, stackUsed(m, pat === 0xFF ? 0x55 : 0xAA) + 2);
    const v1 = rd8(S.V_FRAMES) | (rd8(S.V_FRAMES + 1) << 8);
    if (((v1 - v0) & 0xFFFF) !== 1) stat.vErr++;
    stat.frames++;
    if (r.t > stat.maxT) { stat.maxT = r.t; stat.whoT = label; }
    stat.maxOff = Math.max(stat.maxOff, r.offIsrp); stat.maxK = Math.max(stat.maxK, r.kpollT);
    if (warp) warpTo(...warp);                                          // after the ISR: a pending warp for the next frame's poll
    return true;
  };
  const endFrame = () => { parkLoop(); M.runFrame(m); if (!accepted()) { stat.lost++; return false; } m.ram.fill(0, S.K_RHEAD, S.K_RHEAD + 2); m.ram[S.K_PN] = 0; return true; };
  resetPoll(); prime();
  const XS = [64, 71, 0, 7, 8, 488, 495, 496, 503, 504, 511], YS = [0, 5, 7, 176, 183, 191];
  let cases = 0;
  outer:
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < YS.length; j++) {
    const B = [XS[i], YS[j]], A = [(B[0] + 200) % 512, (B[1] + 50) % 192];
    const dir = ['r', 'l', 'u', 'd', 'rd', 'lu'][(i + j) % 6];
    // warm up: the direction held with warps to the middle (hold 30)
    for (let k = 0; k < 32; k++) if (!frame([], joyOf(dir), 'warm', [256, 96]) || !endFrame()) break outer;
    if (!frame([], joyOf(dir), 'warm', A) || !endFrame()) break outer;               // the poll takes the last warm-up warp; A is pending
    if (!frame([], joyOf(dir), 'tell A') || !endFrame()) break outer;                // the poll takes A (the pointer is told)
    if (!frame([], joyOf(dir), 'draw A', B) || !endFrame()) break outer;             // P_ISR draws A; B is pending
    if (!frame([], joyOf(dir), 'tell B') || !endFrame()) break outer;                // the poll takes B (and moves on)
    // the worst frame: P_ISR moves A -> B (erase + draw) and K_POLL has a move, a button change and two new keys
    if (!frame(['A', 'S'], joyOf(dir + 'f'), `worst frame A (${A}) -> B (${B}) ${dir}`) || !endFrame()) break outer;
    if (!frame([], 0xFF, 'release') || !endFrame()) break outer;
    cases++;
  }
  setIn(IDLE, 0xFF);
  row(`whole frame ISR, worst over ${stat.frames} strict frames: P_ISR moving + K_POLL worst (${stat.whoT})`, stat.maxT, 9500);
  row('K_POLL inside the ISR, worst (T_ISRP to T_POLLD, CALL and RET included)', stat.maxK, null);
  row('pointer deadline: largest T_ISRP offset + 1,500', stat.maxOff + 1500, 8960);
  row('ISR stack with the return address (poisoned $FB00-$FEFD)', stat.stack, 32, 'B');
  C.check(`ISR frames: V_FRAMES rose by exactly 1 in each (${stat.vErr} wrong), no frame interrupt lost (${stat.lost}); ${cases} A -> B cases`, stat.vErr === 0 && stat.lost === 0);
}
// ---- bytes (K1 + K2) -----------------------------------------------------------------------------------------------------------------
row('code bytes: K_CODE_END - K_CODE + 14 (K_SEND); section 8 allows 2,048 with chunk 0 and the tables', S.K_CODE_END - S.K_CODE + 14, null, 'B');
row('  of which K_CODE_END - K_CODE', S.K_CODE_END - S.K_CODE, null, 'B');

// ===============================================================================================================================
// K3 rows (docs/OBJECTS_EVENTS.md 15.5, section 8): per event, bubble level, E_DOWN through a Group of 8, K_SETFOCUS,
// K_FOCUSNEXT / K_FOCUSPREV over 32 views, bytes.  Only when the cartridge has the K3 symbols.
const HAVE_K3 = ['K_DISPATCH', 'K_SETFOCUS', 'K_FOCUSNEXT', 'K_FOCUSPREV', 'CL_Group', 'CL_TBox', 't_event', 'K_EV', 'K_GETEV', 'K_POST'].every((n) => S[n] !== undefined);
if (!HAVE_K3) console.log('the cartridge has no K3 symbols: the K3 rows are skipped');
else {
  const REG8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  /** Direct call from `addr`; T-states until PC = stopPc for the nth time (the instruction there not executed), or the whole call. */
  function steppedT(addr, regs = {}, stopPc = null, nth = 1) {
    const cpu = m.cpu, want = {};
    for (const [k, v] of Object.entries(regs)) { if (PAIRS[k]) { want[PAIRS[k][0]] = (v >> 8) & 0xFF; want[PAIRS[k][1]] = v & 0xFF; } else want[k] = v & 0xFF; }
    for (const r of REG8) cpu[r] = want[r] !== undefined ? want[r] : rng.byte();
    cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
    cpu.sp = 0xFEFE; m.ram[0xFEFE] = S.T_RET & 0xFF; m.ram[0xFEFF] = S.T_RET >> 8; cpu.pc = addr;
    const t0 = m.tstates; let steps = 0, seen = 0;
    while (cpu.pc !== S.T_RET) {
      if (stopPc !== null && cpu.pc === stopPc && steps > 0 && ++seen === nth) return { t: m.tstates - t0, stopped: true };
      Z.runZ80(cpu, m.bus, 1, m);
      if (cpu.halted || ++steps > 2_000_000) throw new Error(`steppedT ${hex(addr)}: halted or runaway at $${cpu.pc.toString(16)}`);
    }
    if (stopPc !== null) throw new Error(`steppedT ${hex(addr)}: PC never reached $${stopPc.toString(16)} (${nth}th time)`);
    return { t: m.tstates - t0, stopped: false };
  }
  const EVONE = S.T_EVONE !== undefined ? S.T_EVONE : 0x7F00;       // the stub of 15.5; written into RAM when the cartridge lacks it
  if (S.T_EVONE === undefined) m.ram.set([0xCD, S.K_GETEV & 255, S.K_GETEV >> 8, 0xCD, S.K_DISPATCH & 255, S.K_DISPATCH >> 8, 0xC9], EVONE);
  const setEv = (a, b, c, d) => { m.ram[S.K_EV] = a; m.ram[S.K_EV + 1] = b; m.ram[S.K_EV + 2] = c; m.ram[S.K_EV + 3] = d; };
  const mk = (name, x, y, w, h, flags, tag, id) => {
    const a = newObj(name).addr; setRect(a, x, y, w, h); m.ram[a + 14] = flags; m.ram[a + 15] = id;
    if (name !== 'Group' && name !== 'View') m.ram[a + 16] = tag; return a;
  };
  const add = (p, c) => run('K_ADDCHILD', { ix: p, de: c });
  const setFocus = (v) => run('K_SETFOCUS', { de: v });
  const rawFocus = (v) => wr16(S.K_FOCUS, v);
  /** An E_KEY 'x' put into the ring (the ring empty before) or posted; returns nothing. */
  const putKey = (how) => {
    if (how === 'ring' && S.K_RING !== undefined) {
      const h = m.ram[S.K_RHEAD]; m.ram.set([1, 0x78, 0, 0], S.K_RING + (h & 0x3F)); m.ram[S.K_RTAIL] = (h + 4) & 0xFF;
    } else run('K_POST', { a: 1, c: 0x78, e: 0, d: 0 });
  };

  // ---- per event (an E_KEY to the focused TBox that consumes), ring and posted ------------------------------------------------
  {
    fresh();
    const root = mk('Group', 0, 0, 512, 192, 0, 0, 0), leaf = mk('TBox', 10, 10, 50, 50, 1, 1, 1);
    run('K_SETROOT', { de: root }); add(root, leaf); setFocus(leaf);
    const ring = (S.K_RING !== undefined) ? (putKey('ring'), steppedT(EVONE, {}, S.t_event).t) : 0;
    putKey('post'); const posted = steppedT(EVONE, {}, S.t_event).t;
    row('per event: E_KEY, ring / posted, to the focused TBox consumer (worse)', Math.max(ring, posted), 500);
    row('  per event, ring', ring, null); row('  per event, posted', posted, null);
  }

  // ---- bubble level: a root TBox (consumes) and a chain of k Views; the focus is the last, E_KEY 'x'; (T(k) - T(0)) / k --------------
  {
    const measure = (k, mid) => {
      fresh();
      const top = mk('TBox', 0, 0, 512, 192, 1, 1, 1); run('K_SETROOT', { de: top });
      let prev = top, last = top;
      for (let i = 1; i <= k; i++) { last = mid === 'View' ? mk('View', 0, 0, 512, 192, 1, 0, i + 1) : mk('TBox', 0, 0, 512, 192, 1, 0, i + 1); add(prev, last); prev = last; }
      setFocus(last);
      putKey('ring');
      return steppedT(EVONE, {}, S.t_event, mid === 'View' ? 1 : k + 1).t;
    };
    for (const mid of ['View', 'TBox']) {
      const t0 = measure(0, mid); let worst = 0, wk = 0;
      for (let k = 1; k <= 7; k++) { const per = (measure(k, mid) - t0) / k; if (per > worst) { worst = per; wk = k; } }
      row(mid === 'View' ? `bubble level, focus and k-1 ancestors View (k_nop), consumer on top; worst k = ${wk}` : `  bubble level, the same chain of TBox (their t_event logs); worst k = ${wk}`, Math.ceil(worst), mid === 'View' ? 200 : null);
    }
  }

  // ---- E_DOWN through a root Group of 8 TBox children, the point in the last, the focus elsewhere ---------------------------------
  {
    const build = () => {
      fresh();
      const root = mk('Group', 0, 0, 512, 192, 0, 0, 0); run('K_SETROOT', { de: root });
      const kids = []; for (let i = 0; i < 8; i++) { const c = mk('TBox', 8 + 62 * i, 30, 60, 20, 1, 1, i + 1); add(root, c); kids.push(c); }
      return kids;
    };
    const down = (kids, focus, hit) => {
      rawFocus(0); if (focus) setFocus(focus);
      const x = 8 + 62 * hit + 5; setEv(3, x & 255, 35, ((x >> 8) & 1) | 2);
      return steppedT(S.K_DISPATCH, {}, S.t_event).t;
    };
    let kids = build();
    row('E_DOWN through a root Group of 8 TBox, last hit (focus on the first)', down(kids, kids[0], 7), 3500);
    kids = build(); row('  the same, no focus', down(kids, 0, 7), null);
    kids = build(); row('  the same, the focus already on the last (no K_SETFOCUS work)', down(kids, kids[7], 7), null);
    kids = build(); row('  the first child hit (focus on the last)', down(kids, kids[7], 0), null);
  }

  // ---- K_SETFOCUS (old and new both TBox), the whole call -------------------------------------------------------------------------
  {
    fresh();
    const root = mk('Group', 0, 0, 512, 192, 0, 0, 0), a = mk('TBox', 0, 0, 10, 10, 1, 0, 1), b = mk('TBox', 0, 0, 10, 10, 1, 0, 2), c = mk('TBox', 0, 0, 10, 10, 2, 0, 3);
    run('K_SETROOT', { de: root }); add(root, a); add(root, b); add(root, c);
    rawFocus(0); setFocus(a);
    let t = 0; for (let i = 0; i < 6; i++) t = Math.max(t, steppedT(S.K_SETFOCUS, { de: i & 1 ? a : b }).t);
    row('K_SETFOCUS TBox -> TBox (the whole call)', t, 500);
    rawFocus(0); row('  K_SETFOCUS none -> TBox', steppedT(S.K_SETFOCUS, { de: a }).t, null);
    row('  K_SETFOCUS TBox -> 0', steppedT(S.K_SETFOCUS, { de: 0 }).t, null);
    rawFocus(a); row('  K_SETFOCUS the same view', steppedT(S.K_SETFOCUS, { de: a }).t, null);
    row('  K_SETFOCUS refused (hidden view)', steppedT(S.K_SETFOCUS, { de: c }).t, null);
  }

  // ---- K_FOCUSNEXT / K_FOCUSPREV over 32 views: shapes x every start x candidate placements; the worst ----------------------------
  {
    const shapes = {};
    shapes.fan = Array.from({ length: 32 }, (_, i) => (i ? 0 : -1));
    shapes.chains = (() => { const par = [-1]; for (const len of [7, 7, 7, 7, 3]) for (let j = 0; j < len; j++) par.push(j ? par.length - 1 : 0); return par; })();
    shapes.heap = Array.from({ length: 32 }, (_, i) => (i ? (i - 1) >> 1 : -1));
    shapes.spine = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 7 ? i - 1 : (i % 6) + 1));
    shapes.groups = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 5 ? 0 : i <= 30 ? 1 + ((i - 6) % 5) : 0));
    shapes.reverse = Array.from({ length: 32 }, (_, i) => (i === 0 ? -1 : i <= 7 ? i - 1 : 6));              // a spine of 8 with a fan of 24 on its second-to-last node
    let seed = 99; const rnd = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
    for (let t = 0; t < 3; t++) {
      const par = [-1], depth = [1];
      for (let i = 1; i < 32; i++) { let p; do { p = rnd(i); } while (depth[p] >= 8); par.push(p); depth.push(depth[p] + 1); }
      shapes[`random${t}`] = par;
    }
    let worstN = 0, worstP = 0, whoN = '', whoP = '', calls = 0;
    for (const [shape, par] of Object.entries(shapes)) {
      fresh();
      const v = par.map((p, i) => (i === 0 ? mk('Group', 0, 0, 512, 192, 0, 0, 0) : mk('TBox', 0, 0, 10, 10, 1, 0, i + 1)));
      run('K_SETROOT', { de: v[0] });
      par.forEach((p, i) => { if (i) add(v[p], v[i]); });
      const order = []; const kids = (i) => par.map((p, j) => (p === i ? j : -1)).filter((j) => j >= 0);
      (function dfs(i) { order.push(i); kids(i).forEach(dfs); })(0);
      const setFlags = (mode, s) => {
        const n = order.length;
        for (let i = 1; i < 32; i++) {
          let f = 1;
          if (mode === 'none') f = 0;
          else if (mode === 'last') { const idx = s < 0 ? n - 1 : (order.indexOf(s) + n - 1) % n; f = i === order[idx] ? 1 : 0; }
          else if (mode === 'mixed') f = [1, 1, 3, 5, 0, 1][rnd(6)];
          m.ram[v[i] + 14] = f;
        }
        m.ram[v[0] + 14] = mode === 'last' && s >= 0 && order[(order.indexOf(s) + order.length - 1) % order.length] === 0 ? 1 : (mode === 'all' ? 1 : 0);
      };
      for (const mode of ['all', 'last', 'none', 'mixed']) for (let s = -1; s < 32; s++) {
        for (const dir of ['K_FOCUSNEXT', 'K_FOCUSPREV']) {
          setFlags(mode, s); rawFocus(s < 0 ? 0 : v[s]);
          const t = steppedT(S[dir]).t; calls++;
          if (dir === 'K_FOCUSNEXT') { if (t > worstN) { worstN = t; whoN = `${shape}/${mode}/start ${s}`; } } else if (t > worstP) { worstP = t; whoP = `${shape}/${mode}/start ${s}`; }
        }
      }
    }
    row(`K_FOCUSNEXT, 32 views, worst of ${calls / 2} walks (${whoN})`, worstN, 5000);
    row(`K_FOCUSPREV, 32 views, worst of ${calls / 2} walks (${whoP})`, worstP, 8000);
  }

  // ---- stack at depth 8 (15.2: dispatch <= 128; the focus routines are reported against 32) --------------------------------------
  {
    const stackOf = (setup, name, regs) => {
      let used = 0;
      for (const pat of [0x55, 0xAA]) { const r = setup(); armStack(m, pat); call(m, S, name, r ?? regs ?? {}, { ints: false, rng }); used = Math.max(used, stackUsed(m, pat)); }
      return used;
    };
    const chain = () => {
      fresh(); const v = [];
      for (let d = 0; d < 8; d++) { const a = mk(d < 7 ? 'Group' : 'TBox', 0, 0, 512, 192, d === 7 ? 1 : 0, d === 7 ? 1 : 0, d + 1); v.push(a); if (d) add(v[d - 1], a); else run('K_SETROOT', { de: a }); }
      const sib = mk('TBox', 0, 0, 4, 4, 1, 0, 9); add(v[0], sib);
      return { v, sib };
    };
    row('stack: K_DISPATCH E_DOWN through 7 Groups to a focusable consuming leaf', stackOf(() => { const t = chain(); setFocus(t.sib); setEv(3, 100, 100, 2); }, 'K_DISPATCH'), 128, 'B');
    row('stack: K_DISPATCH E_KEY bubble from depth 8, TAB default', stackOf(() => { const t = chain(); m.ram[t.v[7] + 16] = 0; setFocus(t.v[7]); setEv(1, 14, 0, 0); }, 'K_DISPATCH'), 128, 'B');
    row('stack: K_SETFOCUS depth 8 -> depth 2 (reported vs 32)', stackOf(() => { const t = chain(); setFocus(t.v[7]); return { de: t.sib }; }, 'K_SETFOCUS'), null, 'B');
    row('stack: K_FOCUSNEXT from depth 8 (reported vs 32)', stackOf(() => { const t = chain(); setFocus(t.v[7]); }, 'K_FOCUSNEXT'), null, 'B');
    row('stack: K_FOCUSPREV from depth 8 (reported vs 32)', stackOf(() => { const t = chain(); setFocus(t.v[7]); }, 'K_FOCUSPREV'), null, 'B');
  }

  // ---- bytes (section 8: <= 2,048 for the whole step) -----------------------------------------------------------------------------
  row('bytes: K_CODE_END - K_CODE + 14 (K_SEND), step 3 total', S.K_CODE_END - S.K_CODE + 14, 2048, 'B');
}

// ---- print -----------------------------------------------------------------------------------------------------------------------
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
