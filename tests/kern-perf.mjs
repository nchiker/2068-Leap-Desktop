"use strict";
// kern-perf.mjs -- the K1 rows of docs/OBJECTS_EVENTS.md section 8, measured as 13.7 says (TSRun, T-states, direct calls with the
// sentinel return, interrupts off), printed as a table: measured, bound, pass / MISSED / reported.  Written from the contract.
//   node tests/kern-perf.mjs [--seed N]
// A MISSED bound is reported with its numbers and sets the exit code; nothing here weakens a bound.
import { start, makeRng, call, hex } from './gfx6-lib.mjs';
import { checks } from './lib.mjs';
import { buildClasses, MSG } from './kern-model.mjs';
import { neededFor, traceCall, armStack, stackUsed } from './kern-lib.mjs';

const argv = process.argv.slice(2);
const SEED = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED} (the measurements are deterministic; the seed only picks the registers the routines ignore)`);
const C = checks('kern K1 perf');
const classes = buildClasses();
const ctx = start(C, neededFor(classes), 'kern3');
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

// ---- bytes -----------------------------------------------------------------------------------------------------------------------
row('K1 code bytes: K_CODE_END - K_CODE + 14 (K_SEND); section 8 allows 2,048 for the whole step', S.K_CODE_END - S.K_CODE + 14, null, 'B');
row('  of which K_CODE_END - K_CODE', S.K_CODE_END - S.K_CODE, null, 'B');

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
