"use strict";
// kern-k3.mjs -- slice K3 of step 3 (docs/OBJECTS_EVENTS.md sections 5, 6, 9 test 5, 13, 14, 15): event routing (K_DISPATCH), Group,
// focus (K_SETFOCUS / K_FOCUSNEXT / K_FOCUSPREV) and the kern3 self-test (T_SELFTEST), on the `kern3` cartridge.  Written from the
// contract, never from the code.  The reference is tests/kern-model3.mjs (a subclass of the K1 model).
//   node tests/kern-k3.mjs [--seed N] [--steps N] [--only LIST] [--mock] [--mutate N]
//     --seed N     PRNG seed (printed; default from the clock)
//     --steps N    random routing / focus steps (default 3500, the contract asks for at least 3,000)
//     --only LIST  parts: 0 boot, 1 self-test, 2 random trees, 3 stack at depth 8 (default all)
//     --mock       run against the model itself instead of the Z80 (checks the harness; --mutate N then injects fault N: 1..6)
//
// Readings of the contract (also in the report):
//  R1. BC / DE are open (not predicted, copied from the machine) in the log records of: M_EVENT (BC; DE = K_EV is specified, 15.2), M_FOCUS
//      and M_BLUR from K_SETFOCUS (both) and the recursive M_DESTROY of view_destroy (both).  M_HITTEST from a Group has BC = x, DE = y.
//  R2. TBox has no HitTest of its own (15.1): its hit test is View's, geometric, and writes no log record.  TLog / TLog2 hit by tag bit 1.
//  R3. K_SETFOCUS' carry is checked (set = cannot take focus; clear otherwise, also for "same view").  The carry of K_DISPATCH, K_FOCUSNEXT
//      and K_FOCUSPREV is not checked.
//  R4. With K_ROOT = 0, K_FOCUSNEXT / K_FOCUSPREV (and the TAB / arrow defaults) do nothing, whatever K_FOCUS is (15.3, amended 2026-11-12).
//  R5. K_SETROOT is only given parentless views, and K_ADDCHILD never makes the root a child: the walk's "runs off the root (parent 0)"
//      then means the top of the tree.  Views outside the root's tree (detached, or focus left behind) are generated on purpose.
//  R6. Stack: K_DISPATCH, K_SETFOCUS, K_FOCUSNEXT and K_FOCUSPREV get 128 bytes below the return address (routing routines, 15.3 amended);
//      a send through T_SEND of M_DESTROY gets 130, other sends 34.
//  R8. $E0A0-$E0BF (T_VIEWS, T_TP, T_VP: the self-test's own variables) are copied from the machine, not predicted.
//  R7. The self-test: K_EV (E_KEY TAB, data 2 = data 3 = 0), the posted queue's bytes (type 16 carries 1, 2, 3), K_PN and K_PHEAD (15 events
//      posted: +15 mod 4) are all predicted.  The record's +4 is the sum of bytes +0, +1, +2 and +7 of every log record (15.4 amended);
//      the model's value (7550) is compared with the machine's record and with the EQU constant T_EXPECT.
import { checks } from './lib.mjs';
import { start, makeRng, call, poison, hex, rd16 } from './gfx6-lib.mjs';
import { neededFor, KPOISON, compareRam, KEEP, carryOf, armStack, stackUsed } from './kern-lib.mjs';
import { KernelModel3, buildClasses3, SYM3, E, KEY, MSG } from './kern-model3.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 3500);
const MOCK = argv.includes('--mock'), MUT = argVal('--mutate', 0);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3];
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} routing / focus steps${MOCK ? `; MOCK (the model stands in for the Z80${MUT ? `, fault ${MUT} injected` : ''})` : ''}`);

const C = checks('kern K3');
const classes = buildClasses3();
const K3NEEDED = ['K_DISPATCH', 'K_SETFOCUS', 'K_FOCUSNEXT', 'K_FOCUSPREV', 'group_event', 'CL_Group', 'CL_TBox', 'T_SELFTEST', 'K_EV', 'TBox_tag',
  'Group_SIZE', 'TBox_SIZE'];

// KPOISON for K3: the K1 list poisons $E100-$E7FF and $F080-$F0BF, which now hold the pointer and K2's state (the ISR and K_POLL read them).
export const KPOISON3 = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xDFFF], [0xE800, 0xEFFF], [0xF000, 0xF04F], [0xF0D0, 0xFAFF], [0xFB00, 0xFEFD]];   // not $F0C0-$F0CF: W_DIRTY, K_FSCOPE (docs/WINDOWS.md 2)

// ---------------------------------------------------------------------------------------------------------------------------
// The mock machine (--mock): the model, with random bytes in the open places, answers every call.  It checks the harness only.
class MockModel extends KernelModel3 {
  constructor(S, mem, cls, rng, mut) { super(S, mem, cls); this.rng = rng; this.mut = mut; }
  log(code, ix, bc, de) { super.log(code, ix, bc, de); for (const [a, n] of this.wild) for (let i = 0; i < n; i++) this.mem[a + i] = this.rng.byte(); this.wild = []; }
  step(n) { if (this.mut === 1 && (this.fl(n) & 2) === 0 && (this.fl(n) & 4) && this.childOf(n)) return { n: this.childOf(n) }; return super.step(n); }
  groupEvent(g, de) {
    if (this.mut === 2) { const t = this.rd8(de); if (t === E.MOVE || t === E.DOWN || t === E.UP) for (const c of this.children(g)) if ((this.fl(c) & 6) === 4) { /* disabled child tested */ const r = this.send(c, MSG.HITTEST, this.rd8(de + 1) + 256 * (this.rd8(de + 3) & 1), this.rd8(de + 2)); if (r.carry) return this.send(c, MSG.EVENT, null, de).carry; } }
    return super.groupEvent(g, de);
  }
  setFocus(v) {
    if (this.mut === 3 && v === this.focus && v !== 0) { this.send(v, MSG.BLUR, null, null); this.send(v, MSG.FOCUS, null, null); return 0; }
    return super.setFocus(v);
  }
  dispatch() {
    if (this.mut === 4 && this.ev()[0] === E.UP) { const c = this.capture; if (c) return { consumed: !!this.sendEvent(c) }; }
    if (this.mut === 6 && this.ev()[0] === E.KEY) { const v = this.focus || this.root; if (v) { if (this.sendEvent(v)) return { consumed: true }; return { consumed: false }; } }   // no bubbling, no defaults
    return super.dispatch();
  }
  focusPrev() { if (this.mut === 5) { const c = this.walk(); if (c.length) this.setFocus(c[0]); return; } super.focusPrev(); }
}
function mockStart() {
  const rng = makeRng(SEED ^ 0x5151);
  const S = { ...SYM3, RESULT: 0xFF00, K_POST: 1, K_GETEV: 1, T_RET: 0xFFF0 };
  classes.list.forEach((c, i) => { S[`CL_${c.name}`] = 0xA100 + 0x40 * i; });
  for (const n of ['TBox_tag', 'TLog_tag']) S[n] = 16;
  const ram = new Uint8Array(65536); for (let i = 0; i < ram.length; i++) ram[i] = rng.byte();
  const eng = new MockModel(S, ram, classes, rng, MUT);
  eng.aInit(S.K_KARENA, 0xF100, 0xFB00); eng.aInit(S.K_AARENA, 0xC000, 0xE000); eng.arena(S.K_AARENA);
  for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT, S.T_LOGN, S.K_PHEAD, S.K_PN, S.K_RHEAD, S.K_RTAIL]) eng.wr8(a, 0);
  for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT, S.T_LOGN]) eng.wr16(a, 0);
  ram[S.RESULT] = 0xA5; ram[S.RESULT + 1] = 0x5A; ram[S.RESULT + 2] = 1;
  const R8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
  const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
  const callMock = (name, regs = {}, opts = {}) => {
    const rin = {}, want = {};
    for (const [k, v] of Object.entries(regs)) { if (PAIRS[k]) { want[PAIRS[k][0]] = v >> 8 & 255; want[PAIRS[k][1]] = v & 255; } else want[k] = v & 255; }
    for (const r of R8) rin[r] = want[r] !== undefined ? want[r] : (opts.rng ? opts.rng.byte() : 0);
    const out = { ...rin }, w16 = (hi, lo) => (rin[hi] << 8) | rin[lo];
    const hl = w16('h', 'l'), de = w16('d', 'e'), bc = w16('b', 'c'), ix = w16('xh', 'xl');
    const setC = (c) => { out.f = (rin.f & 0xFE) | c; };
    switch (name) {
      case 'K_AINIT': eng.aInit(hl, de, bc); break;
      case 'K_ARENA': eng.arena(hl); break;
      case 'K_ARESET': eng.aReset(hl); break;
      case 'K_NEW': { const r = eng.newObj(hl); setC(r.carry); if (!r.carry) { out.xh = r.addr >> 8; out.xl = r.addr & 255; } break; }
      case 'K_ADDCHILD': eng.addChild(ix, de); break;
      case 'K_UNLINK': eng.unlink(ix); break;
      case 'K_SETROOT': eng.setRoot(de); break;
      case 'T_SEND': { const r = eng.send(ix, rin.a, bc, de); if (r.carry !== null) setC(r.carry); break; }
      case 'K_DISPATCH': eng.dispatch(); break;
      case 'K_SETFOCUS': setC(eng.setFocus(de)); break;
      case 'K_FOCUSNEXT': eng.focusNext(); break;
      case 'K_FOCUSPREV': eng.focusPrev(); break;
      case 'K_POST': setC(eng.post(rin.a, rin.c, rin.e, rin.d)); break;
      case 'K_GETEV': { const r = eng.getev(); setC(r.carry); if (!r.carry) out.a = r.type; break; }
      case 'T_SELFTEST': {
        eng.runSelfTest();
        const n = eng.rd16(S.T_LOGN), sum = eng.logSum().sum;
        eng.wr8(S.RESULT + 2, 3); eng.wr8(S.RESULT + 3, n); eng.wr16(S.RESULT + 4, sum); eng.wr8(S.RESULT + 6, eng.focus ? eng.rd8(eng.focus + 15) : 0xFF);
        break;
      }
      default: throw new Error(`mock: no routine ${name}`);
    }
    const res = { t: 0, regs: out, regsIn: rin, sp: 0xFF00, iff1: true, maxDiRun: 0 };
    for (const [k, [hi, lo]] of Object.entries(PAIRS)) res.regs[k] = (out[hi] << 8) | out[lo];
    return res;
  };
  return { m: { ram }, S, img: new Uint8Array(65536), callMock };
}

const ctx = MOCK ? mockStart() : start(C, [...neededFor(classes), ...K3NEEDED], 'kern3');
if (!ctx) { console.log('the kern3 cartridge is not available (or lacks the K3 symbols): nothing else can run'); C.done(); process.exit(); }
const { m, S: S0, img } = ctx;
const S = { ...SYM3, ...S0 };
const rng = makeRng(SEED);
const HAVE_QUEUE = S0.K_POST !== undefined && S0.K_GETEV !== undefined;
let N = 0;

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < 6) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  get bad() { return this.nf >= 3; }
  end() { C.check(`${this.name}: ${this.n} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}

let model = null;
const mkModel = () => (MOCK ? new KernelModel3(S, new Uint8Array(m.ram), classes) : new KernelModel3(S, new Uint8Array(m.ram), classes));
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; model.mem[a] = v & 0xFF; };
const poke16 = (a, v) => { poke8(a, v); poke8(a + 1, v >> 8); };

// ---------------------------------------------------------------------------------------------------------------------------
// The call wrapper: interrupts on (so a DI would show), random registers, the generic checks of section 5, then the byte comparison.
const callIt = (name, regs, o = {}) => (MOCK ? ctx.callMock(name, regs, { rng }) : call(m, S, S[name], regs, { ints: o.ints ?? true, rng }));
function run(sec, what, name, regs, o = {}) {
  const res = callIt(name, regs, o);
  const moved = KEEP(!!o.ixOut).filter((r) => res.regs[r] !== res.regsIn[r]);
  sec.ok(moved.length === 0, () => `${what}: changed ${moved.map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`).join(', ')} (IY, alternates${o.ixOut ? '' : ', IX'} are preserved)`);
  if ((o.ints ?? true)) sec.ok(res.maxDiRun === 0 && res.iff1 === true, () => `${what}: interrupts were off for ${res.maxDiRun} T-states / iff1 ${res.iff1} (no DI allowed)`);
  sec.ok(res.sp === 0xFF00, () => `${what}: SP ${hex(res.sp)} after the return, want $FF00`);
  return res;
}
function cmp(sec, what, lim = 32) {
  const d = compareRam(m, model, S, lim);
  if (!sec.ok(d === null, () => `${what}: ${d}`)) model.mem.set(m.ram);
}
const ptrs = (sec, what) => {
  for (const [n, a] of [['K_FOCUS', S.K_FOCUS], ['K_CAPTURE', S.K_CAPTURE], ['K_ROOT', S.K_ROOT]])
    sec.ok(rd16(m, a) === model.rd16(a), () => `${what}: ${n} ${hex(rd16(m, a))}, model ${hex(model.rd16(a))}`);
};
const nm = (a) => (a ? `${model.classOf(a).name}@${a.toString(16)}` : '0');

// ---- routine wrappers: call the machine, apply the model, compare -----------------------------------------------------------
function doAinit(sec, rec, base, end) { run(sec, 'K_AINIT', 'K_AINIT', { hl: rec, de: base, bc: end }); model.aInit(rec, base, end); cmp(sec, 'K_AINIT'); }
function doArena(sec, rec) { run(sec, 'K_ARENA', 'K_ARENA', { hl: rec }); model.arena(rec); cmp(sec, 'K_ARENA'); }
function doReset(sec, rec) { run(sec, 'K_ARESET', 'K_ARESET', { hl: rec }); model.aReset(rec); cmp(sec, 'K_ARESET'); }
function doNew(sec, name) {
  const cp = S[`CL_${name}`], res = run(sec, `K_NEW ${name}`, 'K_NEW', { hl: cp }, { ixOut: true });
  const exp = model.newObj(cp);
  sec.ok(carryOf(res) === exp.carry, () => `K_NEW ${name}: carry ${carryOf(res)}, model ${exp.carry}`);
  if (!exp.carry) sec.ok(res.regs.ix === exp.addr, () => `K_NEW ${name}: IX ${hex(res.regs.ix)}, model ${hex(exp.addr)}`);
  cmp(sec, `K_NEW ${name}`);
  return exp.carry ? null : exp.addr;
}
function doAddChild(sec, p, c) { run(sec, 'K_ADDCHILD', 'K_ADDCHILD', { ix: p, de: c }); model.addChild(p, c); cmp(sec, `K_ADDCHILD ${hex(p)} <- ${hex(c)}`); }
function doUnlink(sec, v) { run(sec, 'K_UNLINK', 'K_UNLINK', { ix: v }); model.unlink(v); cmp(sec, `K_UNLINK ${hex(v)}`); }
function doSetRoot(sec, v) { run(sec, 'K_SETROOT', 'K_SETROOT', { de: v }); model.setRoot(v); cmp(sec, `K_SETROOT ${hex(v)}`); }
function doSend(sec, ix, msg, bc, de) {
  const isDestroy = msg === MSG.DESTROY, what = `T_SEND ${model.classOf(ix).name}.${msg} to ${hex(ix)}`;
  run(sec, what, 'T_SEND', { ix, a: msg, bc, de });
  model.send(ix, msg, bc, de);
  cmp(sec, what, isDestroy ? 130 : 34);
}
const SETFOCUS_LIM = 128;
function doSetFocus(sec, v, lim = SETFOCUS_LIM) {
  const what = `K_SETFOCUS ${nm(v)} (focus ${nm(model.focus)})`, res = run(sec, what, 'K_SETFOCUS', { de: v });
  const exp = model.setFocus(v);
  sec.ok(carryOf(res) === exp, () => `${what}: carry ${carryOf(res)}, model ${exp} (flags ${v ? model.fl(v).toString(2) : '-'})`);
  cmp(sec, what, lim); ptrs(sec, what);
  return exp;
}
function doFocusMove(sec, next, lim = SETFOCUS_LIM) {
  const nameR = next ? 'K_FOCUSNEXT' : 'K_FOCUSPREV', what = `${nameR} (focus ${nm(model.focus)}, root ${nm(model.root)})`;
  run(sec, what, nameR, {});
  if (next) model.focusNext(); else model.focusPrev();
  cmp(sec, what, lim); ptrs(sec, what);
}
/** Put an event in K_EV directly, or through K_POST + K_GETEV; then K_DISPATCH. */
function doDispatch(sec, [type, d1, d2, d3], viaQueue = false, lim = 128) {
  const queued = viaQueue && HAVE_QUEUE && model.rd8(S.K_PN) === 0;
  if (queued) {
    const r1 = run(sec, 'K_POST', 'K_POST', { a: type, c: d1, e: d2, d: d3 });
    sec.ok(carryOf(r1) === model.post(type, d1, d2, d3), 'K_POST carry');
    cmp(sec, 'K_POST');
    const r2 = run(sec, 'K_GETEV', 'K_GETEV', {}), g = model.getev();
    sec.ok(carryOf(r2) === g.carry && (g.carry || r2.regs.a === g.type), () => `K_GETEV: carry ${carryOf(r2)}, A ${r2.regs.a}, model carry ${g.carry} type ${g.type}`);
    cmp(sec, 'K_GETEV');
  } else { for (let i = 0; i < 4; i++) poke8(S.K_EV + i, [type, d1, d2, d3][i]); }
  const what = `K_DISPATCH ${JSON.stringify([type, d1, d2, d3])} (focus ${nm(model.focus)}, capture ${nm(model.capture)}, root ${nm(model.root)})`;
  run(sec, what, 'K_DISPATCH', {});
  const r = model.dispatch();
  cmp(sec, what, lim); ptrs(sec, what);
  return { ...r, queued };
}

// ---------------------------------------------------------------------------------------------------------------------------
// 0. boot and the generated symbols (15.1)
if (ONLY.includes(0) && !MOCK) {
  const sec = new Sec('K3 symbols and descriptors (Group, TBox)');
  sec.ok(S0.Group_SIZE === 16 && S0.TBox_SIZE === 17 && S0.TBox_tag === 16, () => `Group_SIZE ${S0.Group_SIZE}, TBox_SIZE ${S0.TBox_SIZE}, TBox_tag ${S0.TBox_tag}`);
  sec.ok(S0.K_EV === 0xF086, () => `K_EV ${hex(S0.K_EV ?? 0)}, 14.1 says $F086`);
  for (const name of ['Group', 'TBox']) {
    const c = classes.byName[name], A = S0[`CL_${name}`], rd = (a) => img[a] | (img[a + 1] << 8);
    const got = { parent: rd(A - 6), count: img[A - 3], size: img[A - 2], pool: img[A - 1], table: Array.from({ length: c.count }, (_, i) => rd(A + 2 * i)) };
    const want = { parent: S0.CL_View, count: c.count, size: c.size, pool: c.pool, table: c.slots.map((s) => S0[s.label]) };
    sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `${name} descriptor at ${hex(A)}: ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    sec.ok((A & 0xFF) + 2 * c.count <= 256, () => `${name}: method table crosses a page`);
  }
  sec.end();
}

// Poison and start the model from what is there; both arenas are initialised by K_AINIT.
{
  poison(m, rng, { stack: false, regions: KPOISON3 });
  model = mkModel();
  const sec = new Sec('poisoned RAM, K_AINIT of both arenas, K_ARENA');
  doAinit(sec, S.K_KARENA, 0xF100, 0xFB00); doAinit(sec, S.K_AARENA, 0xC000, 0xE000); doArena(sec, S.K_AARENA);
  for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT]) poke16(a, 0);
  poke16(S.T_LOGN, 0);
  sec.end();
}

// ---------------------------------------------------------------------------------------------------------------------------
// 1. the self-test of 15.4: every log record, T_LOGN, the record, state 3
if (ONLY.includes(1)) {
  const sec = new Sec('T_SELFTEST: tree, script, log records, T_LOGN, record, final state');
  const R = S.RESULT;
  const syncWild = () => { for (const [a, n] of model.takeWild()) model.mem.set(m.ram.subarray(a, a + n), a); };
  for (const ints of [true, false, true]) {
    if (sec.bad) break;
    const what = `T_SELFTEST (interrupts ${ints ? 'on' : 'off'})`;
    const res = callIt('T_SELFTEST', {}, { ints });
    sec.ok(res.sp === 0xFF00, () => `${what}: SP ${hex(res.sp)}`);
    if (ints) sec.ok(res.maxDiRun === 0, () => `${what}: interrupts were off for ${res.maxDiRun} T-states (no DI)`);
    const { v } = model.runSelfTest();
    model.wild.push([0xE0A0, 0x20]);                    // R8: the cartridge's own scratch (T_VIEWS, T_TP, T_VP at $E0A0-$E0BF) is not in the contract
    syncWild();                                         // plus the log's open BC / DE bytes (R1)
    const logn = model.rd16(S.T_LOGN);
    sec.ok(rd16(m, S.T_LOGN) === logn && logn === 26, () => `${what}: T_LOGN ${rd16(m, S.T_LOGN)}, model ${logn} (hand-derived 26)`);
    // every log record: specified bytes against the model, with a readable message
    const recs = model.logRecords();
    recs.forEach((r, k) => {
      const a = S.T_LOG + 8 * k, got = Array.from(m.ram.subarray(a, a + 8));
      sec.ok(r.every((b, i) => b === null || b === got[i]), () => `${what}: log record ${k}: machine [${got.join(',')}], model [${r.map((b) => (b === null ? '*' : b)).join(',')}] (* = open)`);
    });
    // K_EV and the posted queue state
    sec.ok(Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4)).join() === [E.KEY, KEY.TAB, 0, 0].join(), () => `${what}: K_EV [${Array.from(m.ram.subarray(S.K_EV, S.K_EV + 4))}], want E_KEY TAB 0 0`);
    sec.ok(Array.from(m.ram.subarray(S.K_POSTQ + 4 * (model.rd8(S.K_PHEAD) + 3 & 3), S.K_POSTQ + 4 * (model.rd8(S.K_PHEAD) + 3 & 3) + 4)).join() === [E.KEY, KEY.TAB, 0, 0].join(),
      () => `${what}: the last posted record is not E_KEY TAB 0 0`);
    sec.ok(m.ram[S.K_PN] === 0, () => `${what}: K_PN ${m.ram[S.K_PN]}, want 0`);
    sec.ok(m.ram[S.K_PHEAD] === model.rd8(S.K_PHEAD), () => `${what}: K_PHEAD ${m.ram[S.K_PHEAD]}, model ${model.rd8(S.K_PHEAD)}`);
    // final tree state
    sec.ok(rd16(m, S.K_FOCUS) === v.B && rd16(m, S.K_CAPTURE) === 0 && rd16(m, S.K_ROOT) === v.R, () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))} (want B ${hex(v.B)}), K_CAPTURE ${hex(rd16(m, S.K_CAPTURE))}, K_ROOT ${hex(rd16(m, S.K_ROOT))} (want R ${hex(v.R)})`);
    // the record: state 3, +3 = T_LOGN low, +4/+5 = the 16-bit sum of every log byte written, +6 = the id of the focused view
    const sum = model.logSum().sum;                       // bytes +0 +1 +2 +7 of every record: no open byte in it
    let msum = 0; for (let k = 0; k < logn; k++) { const a = S.T_LOG + 8 * (k & 255); msum += m.ram[a] + m.ram[a + 1] + m.ram[a + 2] + m.ram[a + 7]; }
    sec.ok(sum === 7550, () => `model sum ${sum}, the coordinator's hand count is 7550`);
    sec.ok((msum & 0xFFFF) === sum, () => `${what}: the machine's log bytes +0 +1 +2 +7 sum to ${msum & 0xFFFF}, model ${sum}`);
    const id = model.focus ? model.rd8(model.focus + 15) : 0xFF;
    model.wr8(R + 2, 3); model.wr8(R + 3, logn); model.wr16(R + 4, sum); model.wr8(R + 6, id);
    sec.ok(m.ram[R + 2] === 3, () => `${what}: state ${m.ram[R + 2]}, want 3`);
    sec.ok(m.ram[R + 3] === (logn & 255), () => `${what}: record +3 = ${m.ram[R + 3]}, want T_LOGN low ${logn & 255}`);
    sec.ok(rd16(m, R + 4) === sum, () => `${what}: record +4 sum ${rd16(m, R + 4)}, model ${sum}`);
    sec.ok(m.ram[R + 6] === id, () => `${what}: record +6 = ${m.ram[R + 6]}, focused id ${id}`);
    sec.ok(m.ram[R] === 0xA5 && m.ram[R + 1] === 0x5A, `${what}: record marker`);
    if (S0.T_EXPECT !== undefined) sec.ok(S0.T_EXPECT === sum, () => `${what}: T_EXPECT = ${S0.T_EXPECT}, model ${sum} (an EQU constant)`);
    else sec.ok(MOCK, 'T_EXPECT is not defined (15.4 symbols)');
    cmp(sec, what, 250);
    if (ints && !MOCK) console.log(`  self-test: T_LOGN ${logn}, record sum ${rd16(m, R + 4)}, model ${sum}`);
    // the machine's open bytes of the log: print once for the report
    if (ints && process.argv.includes('--print-open')) recs.forEach((r, k) => console.log(`   rec ${k}: ${Array.from(m.ram.subarray(S.T_LOG + 8 * k, S.T_LOG + 8 * k + 8))}  open: ${r.map((b, i) => (b === null ? i : '')).filter((x) => x !== '')}`));
  }
  sec.end();
}

// ---------------------------------------------------------------------------------------------------------------------------
// 2. random trees, events, focus calls, M_DESTROYs (test 5)
if (ONLY.includes(2)) {
  const sec = new Sec('routing and focus: random trees, events, K_SETFOCUS / K_FOCUSNEXT / K_FOCUSPREV, M_DESTROY vs the model');
  const live = [];
  const st = { dispatch: 0, queue: 0, setfocus: 0, setfocusRefused: 0, next: 0, prev: 0, destroy: 0, unlink: 0, addchild: 0, setroot: 0, scenarios: 0, mutate: 0,
    consumedKey: 0, consumedPtr: 0, focusMoves: 0, downFocus: 0, captureSet: 0, captureUsed: 0, outsideWalks: 0, deep: 0, rootless: 0 };
  const genFlags = () => { let f = 0; if (rng.chance(0.72)) f |= 1; if (rng.chance(0.12)) f |= 2; if (rng.chance(0.12)) f |= 4; if (rng.chance(0.3)) f |= rng.int(0, 31) << 3; return f; };
  const genRect = () => (rng.chance(0.75)
    ? { x: rng.int(0, 400), y: rng.int(0, 150), w: rng.int(20, 300), h: rng.int(10, 100) }
    : { x: rng.int(0, 511), y: rng.int(0, 191), w: rng.int(0, 512), h: rng.int(0, 192) });
  const setFields = (a) => {
    const r = genRect(), c = model.classOf(a);
    poke16(a + 8, r.x); poke8(a + 10, r.y); poke16(a + 11, r.w); poke8(a + 13, r.h); poke8(a + 14, genFlags()); poke8(a + 15, rng.byte());
    if (c.offsets.tag !== undefined) poke8(a + 16, rng.byte());
  };
  const pickClass = () => { const p = rng.next(); return p < 0.30 ? 'Group' : p < 0.60 ? 'TBox' : p < 0.72 ? 'TLog' : p < 0.80 ? 'TLog2' : 'View'; };
  const newNode = () => {
    const a = doNew(sec, pickClass());
    if (a !== null) { setFields(a); live.push(a); }
    return a;
  };
  const pickParent = (c) => {
    const cand = live.filter((n) => n !== c && !model.subtree(c).includes(n) && model.pathLen(n) + model.height(c) <= 8);
    if (!cand.length) return 0;
    const groups = cand.filter((n) => model.classOf(n).name === 'Group');
    return groups.length && rng.chance(0.6) ? rng.pick(groups) : rng.pick(cand);
  };
  const attach = (c) => {
    const p = pickParent(c);
    if (!p) return;
    doAddChild(sec, p, c); st.addchild++;
    const px = model.rd16(p + 8), py = model.rd8(p + 10), pw = model.rd16(p + 11), ph = model.rd8(p + 13);
    if (rng.chance(0.7) && pw >= 2 && ph >= 2) {                       // mostly nested rectangles, so a point reaches the deep views
      const x = rng.int(px, px + pw - 1), y = rng.int(py, py + ph - 1);
      poke16(c + 8, x); poke8(c + 10, y); poke16(c + 11, rng.int(1, px + pw - x)); poke8(c + 13, rng.int(1, py + ph - y));
    }
  };
  const buildScenario = () => {
    doReset(sec, S.K_AARENA); live.length = 0; st.scenarios++;
    const target = rng.int(4, 32);
    let first = null;
    for (let i = 0; i < target; i++) {
      const a = i === 0 ? doNew(sec, 'Group') : newNode(); if (a === null) break;
      if (i === 0) { setFields(a); live.push(a); first = a; poke16(a + 8, 0); poke8(a + 10, 0); poke16(a + 11, 512); poke8(a + 13, 192); poke8(a + 14, rng.chance(0.8) ? 0 : genFlags()); continue; }
      if (rng.chance(0.1)) continue;                                // a few stay detached: forests
      if (rng.chance(0.4) && model.pathLen(first) + model.height(a) <= 8) {   // a share of the views go straight under the first Group
        doAddChild(sec, first, a); st.addchild++;
        const px = model.rd16(first + 8), py = model.rd8(first + 10), pw = model.rd16(first + 11), ph = model.rd8(first + 13);
        const x = rng.int(px, px + pw - 1), y = rng.int(py, py + ph - 1);
        poke16(a + 8, x); poke8(a + 10, y); poke16(a + 11, rng.int(1, Math.min(300, px + pw - x))); poke8(a + 13, rng.int(1, Math.min(100, py + ph - y)));
      } else attach(a);
    }
    const parentless = live.filter((n) => model.parentOf(n) === 0);
    doSetRoot(sec, rng.chance(0.04) ? 0 : rng.chance(0.08) ? rng.pick(parentless) : first);
  };
  const inTree = (n) => model.root !== 0 && model.preorder(model.root).includes(n);
  const genPoint = () => {
    if (live.length && rng.chance(0.85)) {
      const under = model.root ? model.preorder(model.root).filter((x) => x !== model.root) : [];
      if (under.length && rng.chance(0.65)) {                         // a point inside every rectangle on the way from the root to n
        const n = rng.pick(under);
        let x0 = 0, x1 = 511, y0 = 0, y1 = 191;
        for (let v = n; v !== 0 && v !== model.root; v = model.parentOf(v)) {
          const x = model.rd16(v + 8), y = model.rd8(v + 10), w = model.rd16(v + 11), h = model.rd8(v + 13);
          x0 = Math.max(x0, x); x1 = Math.min(x1, x + w - 1); y0 = Math.max(y0, y); y1 = Math.min(y1, y + h - 1);
        }
        if (x0 <= x1 && y0 <= y1) return [rng.int(x0, x1), rng.int(y0, y1)];
      }
      const n = under.length && rng.chance(0.8) ? rng.pick(under) : rng.pick(live),
        x = model.rd16(n + 8), y = model.rd8(n + 10), w = model.rd16(n + 11), h = model.rd8(n + 13);
      return [Math.max(0, Math.min(511, x + rng.int(-1, w))), Math.max(0, Math.min(255, y + rng.int(-1, h)))];
    }
    return [rng.int(0, 511), rng.int(0, rng.chance(0.9) ? 191 : 255)];
  };
  const WALKKEYS = [KEY.TAB, KEY.BACKTAB, KEY.DOWN, KEY.UP, KEY.LEFT, KEY.RIGHT];
  const genEvent = () => {
    const p = rng.next();
    if (p < 0.38) {
      let code = rng.chance(0.6) ? rng.pick(WALKKEYS) : rng.chance(0.5) ? rng.pick([0x78, 0x41, KEY.ENTER, 32, 27, 16, 12]) : rng.byte();
      if (!model.walkSafe() && WALKKEYS.includes(code)) code = 0x78;
      return [E.KEY, code, rng.byte(), rng.chance(0.9) ? 0 : rng.byte()];
    }
    if (p < 0.90) {
      const type = rng.pick([E.DOWN, E.DOWN, E.DOWN, E.MOVE, E.MOVE, E.UP]), [x, y] = genPoint();
      return [type, x & 255, y, ((x >> 8) & 1) | (rng.chance(0.5) ? 2 : 0) | (rng.chance(0.2) ? rng.int(0, 63) << 2 : 0)];
    }
    return [rng.pick([0, E.TIMER, E.REDRAW, E.MENU, E.QUIT, E.MODE, 16, 17, 100, 255]), rng.byte(), rng.byte(), rng.byte()];
  };
  buildScenario();
  for (let step = 0; step < STEPS && !sec.bad; step++) {
    if (step % 260 === 259 || live.length === 0) buildScenario();
    const p = rng.next();
    if (model.root === 0) {
      st.rootless++;
      if (rng.chance(0.5)) { const pl = live.filter((n) => model.parentOf(n) === 0 && model.classOf(n).name === 'Group'); if (pl.length || live.length) { doSetRoot(sec, pl.length ? rng.pick(pl) : rng.pick(live.filter((n) => model.parentOf(n) === 0))); continue; } }
    }
    if (p < 0.40) {
      const ev = genEvent(), cap0 = model.capture, f0 = model.focus;
      const r = doDispatch(sec, ev, rng.chance(0.25));
      st.dispatch++; if (r.queued) st.queue++;
      if (r.consumed) { if (ev[0] === E.KEY) st.consumedKey++; else st.consumedPtr++; }
      if (ev[0] === E.DOWN && model.focus !== f0) st.downFocus++;
      if (ev[0] === E.DOWN && model.capture !== 0) st.captureSet++;
      if ((ev[0] === E.MOVE || ev[0] === E.UP) && cap0 !== 0) st.captureUsed++;
      if (model.focus !== f0) st.focusMoves++;
    } else if (p < 0.52) {
      const q = rng.next(), v = q < 0.08 ? 0 : q < 0.16 ? model.focus : live.length ? rng.pick(live) : 0;
      if (doSetFocus(sec, v)) st.setfocusRefused++;
      st.setfocus++;
    } else if (p < 0.66) {
      if (!model.walkSafe()) { doSetFocus(sec, 0); continue; }
      const next = rng.chance(0.5);
      if (model.focus !== 0 && !inTree(model.focus)) st.outsideWalks++;
      const f0 = model.focus;
      doFocusMove(sec, next);
      if (next) st.next++; else st.prev++;
      if (model.focus !== f0) st.focusMoves++;
    } else if (p < 0.73) {
      const n = rng.pick(live), what = rng.int(0, 3);
      if (what === 0) poke8(n + 14, genFlags()); else if (what === 1) poke8(n + 14, model.fl(n) ^ (rng.chance(0.5) ? 2 : 4));
      else if (what === 2) { const r = genRect(); poke16(n + 8, r.x); poke8(n + 10, r.y); poke16(n + 11, r.w); poke8(n + 13, r.h); }
      else if (model.classOf(n).offsets.tag !== undefined) poke8(n + 16, rng.byte());
      st.mutate++;
    } else if (p < 0.755) {
      const n = rng.chance(0.12) ? rng.pick(live) : rng.pick(live.filter((x) => x !== model.root).concat(live.length > 1 ? [] : live)), gone = new Set(model.subtree(n));
      doSend(sec, n, MSG.DESTROY, rng.int(0, 65535), rng.int(0, 65535));
      for (let i = live.length - 1; i >= 0; i--) if (gone.has(live[i])) live.splice(i, 1);
      st.destroy++;
    } else if (p < 0.78) { doUnlink(sec, rng.pick(live)); st.unlink++; }
    else if (p < 0.87) {
      const det = live.filter((n) => model.parentOf(n) === 0 && n !== model.root);
      if (det.length) attach(rng.pick(det));
    } else if (p < 0.90) {
      const parentless = live.filter((n) => model.parentOf(n) === 0);
      doSetRoot(sec, rng.chance(0.06) || !parentless.length ? 0 : rng.pick(parentless)); st.setroot++;
    } else if (p < 0.93) { poke16(S.K_CAPTURE, rng.chance(0.3) ? 0 : rng.pick(live)); }
    else if (live.length < 32) newNode();
    if (live.length && model.root !== 0 && model.height(model.root) >= 6) st.deep++;
  }
  // the pointers once more, and the free lists must still be consistent: view tree walkable from the root (no cycle) in the model
  ptrs(sec, 'end of the run');
  console.log(`  ${JSON.stringify(st)}`);
  sec.ok(st.dispatch > 600 && st.setfocus > 100 && st.next > 50 && st.prev > 50 && st.destroy > 20, () => `coverage: ${JSON.stringify(st)}`);
  sec.ok(st.consumedKey > 20 && st.consumedPtr > 20 && st.downFocus > 20 && st.captureSet > 5 && st.captureUsed > 5 && st.focusMoves > 100,
    () => `coverage of the routing paths: ${JSON.stringify(st)}`);
  sec.ok(st.outsideWalks > 5, () => `coverage: only ${st.outsideWalks} walks from a focus outside the root's tree (the second-wrap path)`);
  sec.end();
}

// ---------------------------------------------------------------------------------------------------------------------------
// 3. stack at depth 8 (15.2: at most 128 bytes), registers (the run wrapper checks IX, IY, alternates and no DI on every call above)
if (ONLY.includes(3)) {
  const sec = new Sec('stack of the routing routines at tree depth 8 (<= 128 bytes below the return address)');
  const rows = [];
  const probe = (label, setup, act, bound = 128) => {
    let used = 0;
    for (const pat of [0x55, 0xAA]) {
      setup();
      armStack(m, pat); model.mem.fill(pat, 0xFB00, 0xFEFE);
      act();
      used = Math.max(used, stackUsed(m, pat));
    }
    rows.push(`${label} ${used}`);
    sec.ok(used <= bound, () => `${label}: ${used} bytes of stack, bound ${bound}`);
    model.mem.set(m.ram.subarray(0xFB00, 0xFEFE), 0xFB00);
  };
  // a chain of 7 Groups and a TBox leaf at depth 8, one focusable sibling at depth 2; every rectangle covers the whole screen
  const build = () => {
    doReset(sec, S.K_AARENA);
    const v = [];
    for (let d = 0; d < 8; d++) {
      const a = doNew(sec, d < 7 ? 'Group' : 'TBox'); v.push(a);
      poke16(a + 8, 0); poke8(a + 10, 0); poke16(a + 11, 512); poke8(a + 13, 192); poke8(a + 14, d === 7 ? 1 : (d % 2 ? 1 : 0)); poke8(a + 15, d + 1);
      if (d === 7) poke8(a + 16, 1);
      if (d === 0) doSetRoot(sec, a); else doAddChild(sec, v[d - 1], a);
    }
    const sib = doNew(sec, 'TBox'); poke16(sib + 8, 0); poke8(sib + 10, 0); poke16(sib + 11, 4); poke8(sib + 13, 4); poke8(sib + 14, 1); poke8(sib + 15, 9);
    doAddChild(sec, v[0], sib);
    return { v, sib };
  };
  let T = build();
  const setupDown = () => { T = build(); doSetFocus(sec, T.sib); };
  probe('E_DOWN through 7 Groups to a focusable consuming leaf (focus elsewhere)', setupDown, () => doDispatch(sec, [E.DOWN, 100, 100, 0], false, 128));
  probe('E_MOVE through 7 Groups', () => { T = build(); doSetFocus(sec, T.sib); }, () => doDispatch(sec, [E.MOVE, 100, 100, 0], false, 128));
  probe('E_UP through 7 Groups', () => { T = build(); }, () => doDispatch(sec, [E.UP, 100, 100, 0], false, 128));
  probe('E_KEY bubble from depth 8 (leaf does not consume) and the TAB default', () => { T = build(); poke8(T.v[7] + 16, 0); doSetFocus(sec, T.v[7]); },
    () => doDispatch(sec, [E.KEY, KEY.TAB, 0, 0], false, 128));
  probe('E_KEY BACKTAB from depth 8', () => { T = build(); poke8(T.v[7] + 16, 0); doSetFocus(sec, T.v[7]); }, () => doDispatch(sec, [E.KEY, KEY.BACKTAB, 0, 0], false, 128));
  probe('K_SETFOCUS depth 8 to depth 2', () => { T = build(); doSetFocus(sec, T.v[7]); }, () => doSetFocus(sec, T.sib, 128));
  probe('K_FOCUSNEXT from depth 8', () => { T = build(); doSetFocus(sec, T.v[7]); }, () => doFocusMove(sec, true, 128));
  probe('K_FOCUSPREV from depth 8', () => { T = build(); doSetFocus(sec, T.v[7]); }, () => doFocusMove(sec, false, 128));
  console.log(`  stack used: ${rows.join('; ')}`);
  sec.end();
}

console.log(`${N} assertions`);
C.done();
