"use strict";
// kern-k1.mjs -- slice K1 of step 3 (docs/OBJECTS_EVENTS.md sections 2-5, 8, 9 tests 1-2, 13): classes, message send, arenas and
// pools, the view tree and view_destroy, on the `kern3` cartridge.  Written from the contract (sections 2-5, 13), never from the code.
// The reference is tests/kern-model.mjs: a byte image of both arenas, the kernel variables and the log, predicted after every call.
//   node tests/kern-k1.mjs [--seed N] [--steps N] [--trees N] [--rounds N] [--only LIST]
//     --seed N     PRNG seed (printed; default from the clock)
//     --steps N    random allocation steps (default 5000, the contract's minimum)
//     --trees N    random tree scenarios (default 60)
//     --rounds N   send rounds per class (default 6)
//     --only LIST  parts: 0 boot, 1 descriptors, 2 send, 3 hit test, 4 allocation, 5 trees (default all)
//
// Readings of the contract (also in the report):
//  R1. view_destroy's recursive M_DESTROY leaves BC / DE unspecified: the log records of such nested destroys are compared for code,
//      IX and tag only (the model marks their BC / DE bytes "wild" and they are copied from the machine).
//  R2. After M_DESTROY the carry is not checked (the contract leaves it open); every other method's carry is checked.
//  R3. Stack allowance: 32 bytes below the return address for a direct call of any K1 routine; a send through T_SEND adds the
//      RST's own 2 bytes (34); an M_DESTROY that reaches view_destroy / t_destroy gets 128 + 2 (13.7 gives 128 at tree depth 8).
//  R4. K_ARENA's blank "Clobbers" cell (section 5) is read as: it preserves every register, flags included.  K_SETROOT preserves BC.
//  R5. A K_NEW from the free list writes class pointer + zeros (13.4); from the arena top it writes the class pointer only (the arena
//      is zero above its top).  The test never writes above an arena's top.  Instances get random field bytes below their size.
import { checks } from './lib.mjs';
import { start, makeRng, call, poison, hex, rd16 } from './gfx6-lib.mjs';
import { KernelModel, buildClasses, expectedDescriptor, MSG, DECL } from './kern-model.mjs';
import { neededFor, readClassesJson, KPOISON, compareRam, traceCall, KEEP, carryOf } from './kern-lib.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const STEPS = argVal('--steps', 5000), TREES = argVal('--trees', 60), ROUNDS = argVal('--rounds', 6);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5];
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${STEPS} allocation steps, ${TREES} trees, ${ROUNDS} send rounds a class`);

const C = checks('kern K1');
const classes = buildClasses();
const ctx = start(C, neededFor(classes), 'kern3');
if (!ctx) { console.log('the kern3 cartridge is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S, img } = ctx;
const rng = makeRng(SEED);
let N = 0;                                   // every individual assertion

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg = '') { this.n++; N++; if (!c) { this.nf++; if (this.fails.length < 5) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  get bad() { return this.nf >= 3; }
  end() { C.check(`${this.name}: ${this.n} checks`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}

let model = null;
const poke8 = (a, v) => { m.ram[a] = v & 0xFF; model.mem[a] = v & 0xFF; };
const poke16 = (a, v) => { poke8(a, v); poke8(a + 1, v >> 8); };
const rd8m = (a) => m.ram[a];

// ---------------------------------------------------------------------------------------------------------------------------
// The call wrapper: interrupts on (so a DI would show), random registers, the generic checks of section 5, then the byte comparison.
function run(sec, what, target, regs, o = {}) {
  const addr = typeof target === 'number' ? target : S[target];
  const res = o.trace ? traceCall(m, S, addr, regs, { ints: true, rng, trace: true }) : call(m, S, addr, regs, { ints: true, rng });
  const moved = KEEP(!!o.ixOut).filter((r) => res.regs[r] !== res.regsIn[r]);
  sec.ok(moved.length === 0, () => `${what}: changed ${moved.map((r) => `${r} ${res.regsIn[r]} -> ${res.regs[r]}`).join(', ')} (section 5: IY, alternates${o.ixOut ? '' : ', IX'} preserved)`);
  sec.ok(res.maxDiRun === 0 && res.iff1 === true, () => `${what}: interrupts were off for ${res.maxDiRun} T-states / iff1 ${res.iff1} (no DI allowed)`);
  sec.ok(res.sp === 0xFF00, () => `${what}: SP ${hex(res.sp)} after the return, want $FF00`);
  for (const r of o.keep ?? []) sec.ok(res.regs[r] === res.regsIn[r], () => `${what}: ${r} changed ${res.regsIn[r]} -> ${res.regs[r]} (preserved by contract)`);
  return res;
}
function cmp(sec, what, lim = 32) {
  const d = compareRam(m, model, S, lim);
  if (!sec.ok(d === null, () => `${what}: ${d}`)) model.mem.set(m.ram);            // resynchronise: the failure is reported once
}

// ---------------------------------------------------------------------------------------------------------------------------
// Routine wrappers: call the machine, apply the model, compare.
function doNew(sec, name, what = `K_NEW ${name}`) {
  const cp = S[`CL_${name}`];
  const res = run(sec, what, 'K_NEW', { hl: cp }, { ixOut: true });
  const exp = model.newObj(cp), ixIn = (res.regsIn.xh << 8) | res.regsIn.xl;
  sec.ok(carryOf(res) === exp.carry, () => `${what}: carry ${carryOf(res)}, model ${exp.carry}`);
  if (exp.carry === 0) {
    sec.ok(res.regs.ix === exp.addr, () => `${what}: IX ${hex(res.regs.ix)}, model ${hex(exp.addr)}`);
    const c = model.classAt(cp);
    let z = true; for (let i = 2; i < c.size; i++) if (m.ram[exp.addr + i] !== 0) { z = false; break; }
    sec.ok(rd16(m, exp.addr) === cp && z, () => `${what}: the instance at ${hex(exp.addr)} is not class pointer + zeros`);
  } else sec.ok(res.regs.ix === ixIn, () => `${what}: IX changed on carry set (${hex(ixIn)} -> ${hex(res.regs.ix)})`);
  cmp(sec, what);
  return exp.carry ? null : exp.addr;
}
function doFree(sec, addr, what = 'K_FREE') {
  run(sec, what, 'K_FREE', { ix: addr });
  model.free(addr);
  cmp(sec, `${what} ${hex(addr)}`);
}
function doAlloc(sec, bc) {
  const res = run(sec, `K_ALLOC ${bc}`, 'K_ALLOC', { bc });
  const exp = model.alloc(bc);
  sec.ok(carryOf(res) === exp.carry, () => `K_ALLOC ${bc}: carry ${carryOf(res)}, model ${exp.carry}`);
  if (!exp.carry) sec.ok(res.regs.hl === exp.addr, () => `K_ALLOC ${bc}: HL ${hex(res.regs.hl)}, model ${hex(exp.addr)}`);
  cmp(sec, `K_ALLOC ${bc}`);
  return exp.carry ? null : exp.addr;
}
function doArena(sec, rec) {
  run(sec, 'K_ARENA', 'K_ARENA', { hl: rec }, { keep: ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'] });
  model.arena(rec);
  cmp(sec, 'K_ARENA');
}
function doReset(sec, rec) {
  run(sec, 'K_ARESET', 'K_ARESET', { hl: rec });
  model.aReset(rec);
  cmp(sec, `K_ARESET ${rec === S.K_KARENA ? 'kernel' : 'app'}`);
}
function doAinit(sec, rec, base, end, poisonRange = true) {
  if (poisonRange) for (let a = base; a < end; a++) { const v = rng.byte(); m.ram[a] = v; model.mem[a] = v; }
  run(sec, 'K_AINIT', 'K_AINIT', { hl: rec, de: base, bc: end });
  model.aInit(rec, base, end);
  cmp(sec, `K_AINIT ${hex(base)}-${hex(end)}`);
}
function doAddChild(sec, p, c) { run(sec, 'K_ADDCHILD', 'K_ADDCHILD', { ix: p, de: c }); model.addChild(p, c); cmp(sec, `K_ADDCHILD ${hex(p)} <- ${hex(c)}`); }
function doUnlink(sec, v) { run(sec, 'K_UNLINK', 'K_UNLINK', { ix: v }); model.unlink(v); cmp(sec, `K_UNLINK ${hex(v)}`); }
function doSetRoot(sec, v) { run(sec, 'K_SETROOT', 'K_SETROOT', { de: v }, { keep: ['b', 'c'] }); model.setRoot(v); cmp(sec, `K_SETROOT ${hex(v)}`); }

/** A send through T_SEND.  explicit: the log record is also checked against the inputs directly (a node without children). */
function doSend(sec, ix, msg, bc, de, explicit = true) {
  const cls = model.classOf(ix), label = model.label(cls, msg), what = `send ${cls.name}.${msg} (${label}) to ${hex(ix)}`;
  const isDestroy = label === 'view_destroy' || label === 't_destroy';
  const lim = isDestroy ? 130 : 34;
  const logn0 = model.rd16(S.T_LOGN), tag0 = cls.offsets.tag !== undefined ? m.ram[ix + cls.offsets.tag] : 0;
  const res = run(sec, what, 'T_SEND', { ix, a: msg, bc, de }, { trace: true });
  sec.ok(res.reached === S[label], () => `${what}: reached ${hex(res.reached ?? 0)}, the table says ${label} = ${hex(S[label])}`);
  const exp = model.send(ix, msg, bc, de);
  if (exp.carry !== null) sec.ok(carryOf(res) === exp.carry, () => `${what}: carry ${carryOf(res)}, want ${exp.carry}`);
  if (explicit) {
    const logs = label.startsWith('t_');
    sec.ok(rd16(m, S.T_LOGN) === ((logn0 + (logs ? 1 : 0)) & 0xFFFF), () => `${what}: T_LOGN ${rd16(m, S.T_LOGN)}, was ${logn0}, logs ${logs}`);
    if (logs) {
      const a = S.T_LOG + 8 * (logn0 & 255), got = Array.from(m.ram.subarray(a, a + 8));
      const want = [msg | ((label === 't_draw2' || label === 't_poke2') ? 0x80 : 0), ix & 0xFF, ix >> 8, bc & 0xFF, bc >> 8, de & 0xFF, de >> 8, tag0];
      sec.ok(got.every((v, i) => v === want[i]), () => `${what}: log record [${got.join(',')}], want [${want.join(',')}]`);
    }
  }
  cmp(sec, what, lim);
  return { res, exp };
}

// Randomise an instance's fields (in both images).  View fields in their documented ranges, tag, pad bytes.
function randomize(addr) {
  const c = model.classOf(addr);
  if (c.offsets.x !== undefined) {
    poke16(addr + c.offsets.x, rng.int(0, 511)); poke8(addr + c.offsets.y, rng.int(0, 191));
    poke16(addr + c.offsets.w, rng.int(0, 512)); poke8(addr + c.offsets.h, rng.int(0, 192));
    poke8(addr + c.offsets.flags, rng.byte()); poke8(addr + c.offsets.id, rng.byte());
    if (c.offsets.tag !== undefined) poke8(addr + c.offsets.tag, rng.byte());
  } else for (let i = 2; i < c.size; i++) poke8(addr + i, rng.byte());
}

// ===========================================================================================================================
// 0. boot (13.6)
if (ONLY.includes(0)) {
  const sec = new Sec('boot: arena records, K vars, record');
  const w = (a) => rd16(m, a);
  const rec = (r) => Array.from({ length: 8 }, (_, i) => w(r + 2 * i));
  sec.ok(JSON.stringify(rec(S.K_KARENA)) === JSON.stringify([0xF100, 0xFB00, 0xF100, 0, 0, 0, 0, 0]), () => `K_KARENA ${rec(S.K_KARENA).map((v) => hex(v))}`);
  sec.ok(JSON.stringify(rec(S.K_AARENA)) === JSON.stringify([0xC000, 0xE000, 0xC000, 0, 0, 0, 0, 0]), () => `K_AARENA ${rec(S.K_AARENA).map((v) => hex(v))}`);
  sec.ok(w(S.K_CURA) === S.K_AARENA, () => `K_CURA ${hex(w(S.K_CURA))}, want K_AARENA ${hex(S.K_AARENA)}`);
  sec.ok(w(S.K_FOCUS) === 0 && w(S.K_CAPTURE) === 0 && w(S.K_ROOT) === 0, () => `K_FOCUS/K_CAPTURE/K_ROOT ${hex(w(S.K_FOCUS))} ${hex(w(S.K_CAPTURE))} ${hex(w(S.K_ROOT))}`);
  sec.ok(S.K_KARENA === 0xF050 && S.K_AARENA === 0xF060 && S.K_CURA === 0xF070 && S.K_FOCUS === 0xF072 && S.K_CAPTURE === 0xF074 && S.K_ROOT === 0xF076,
    'K1 variable addresses (13.5)');
  const zero = (lo, hi) => { for (let a = lo; a < hi; a++) if (m.ram[a] !== 0) return a; return -1; };
  sec.ok(zero(0xC000, 0xE000) < 0 && zero(0xF100, 0xFB00) < 0, () => `an arena is not zero after boot (first at ${hex(Math.max(zero(0xC000, 0xE000), zero(0xF100, 0xFB00)))})`);
  sec.ok(S.T_LOG === 0xE800 && S.T_LOGN === 0xE090, 'T_LOG = $E800, T_LOGN = $E090');
  sec.ok(m.ram[S.RESULT] === 0xA5 && m.ram[S.RESULT + 1] === 0x5A && m.ram[S.RESULT + 2] === 1, 'record marker $A5 $5A, state 1');
  sec.end();
}

// ===========================================================================================================================
// 1. descriptors (13.2) and the generated symbols
if (ONLY.includes(1)) {
  const sec = new Sec('descriptors, classes.json and symbols');
  let json = null;
  try { json = readClassesJson('kern3'); } catch (e) { sec.ok(false, `classes.json unreadable: ${e.message}`); }
  if (json) {
    sec.ok(json.classes.every((c, i) => c.id === i + 1), 'class ids 1, 2, 3, ... in definition order');
    sec.ok(json.classes[0]?.name === 'Object' && json.classes[1]?.name === 'View', 'Object then View first');
    const names = json.classes.map((c) => c.name);
    const extra = names.filter((n) => !classes.byName[n]);
    if (extra.length) console.log(`note: classes in kern3 without a model (not tested): ${extra.join(', ')}`);
    sec.ok(JSON.stringify(json.messages) === JSON.stringify({ DESTROY: 0, DRAW: 1, EVENT: 2, HITTEST: 3, FOCUS: 4, BLUR: 5, POKE: 6, POKE2: 7 }),
      () => `messages ${JSON.stringify(json.messages)}`);
    for (const [k, v] of Object.entries(MSG)) sec.ok(S[`M_${k}`] === v, () => `M_${k} = ${S[`M_${k}`]}, want ${v}`);
    for (const c of classes.list) {
      const jc = json.classes.find((x) => x.name === c.name);
      if (!sec.ok(!!jc, `class ${c.name} in classes.json`)) continue;
      sec.ok(jc.parent === c.parent && jc.size === c.size && jc.pool === c.pool, () => `${c.name}: json parent ${jc.parent} size ${jc.size} pool ${jc.pool}; want ${c.parent} ${c.size} ${c.pool}`);
      sec.ok(JSON.stringify(jc.methods.map((x) => [x.n, x.label])) === JSON.stringify(c.slots.map((x) => [x.n, x.label])), () => `${c.name}: json methods ${jc.methods.map((x) => x.label)}`);
      sec.ok(jc.fields.every((f) => c.offsets[f.name] === f.offset) && S[`${c.name}_SIZE`] === c.size, () => `${c.name}: field offsets / ${c.name}_SIZE`);
      // the image
      const A = S[`CL_${c.name}`], rd = (a) => img[a] | (img[a + 1] << 8);
      const want = expectedDescriptor(c, S, jc.id);
      const got = { parent: rd(A - 6), id: img[A - 4], count: img[A - 3], size: img[A - 2], pool: img[A - 1], table: Array.from({ length: c.count }, (_, i) => rd(A + 2 * i)) };
      sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `${c.name} descriptor at ${hex(A)}: image ${JSON.stringify(got, (k, v) => (typeof v === 'number' && k !== 'id' && k !== 'count' && k !== 'size' && k !== 'pool' ? hex(v) : v))}`
        + ` want ${JSON.stringify(want, (k, v) => (typeof v === 'number' && k !== 'id' && k !== 'count' && k !== 'size' && k !== 'pool' ? hex(v) : v))}`);
      sec.ok((A & 0xFF) + 2 * c.count <= 256, () => `${c.name}: method table at ${hex(A)} x ${c.count} crosses a page`);
    }
    for (const [name, off] of [['View_parent', 2], ['View_child', 4], ['View_next', 6], ['View_x', 8], ['View_y', 10], ['View_w', 11], ['View_h', 13], ['View_flags', 14], ['View_id', 15], ['TLog_tag', 16]])
      sec.ok(S[name] === off, () => `${name} = ${S[name]}, want ${off}`);
    sec.ok(S.k_nop !== S.obj_destroy && img[S.k_nop] === 0xB7 && img[S.k_nop + 1] === 0xC9, 'k_nop is OR A, RET (contract 13.3)');
  }
  sec.end();
}

// ===========================================================================================================================
// Poison (13.6) and start the model from what is there; both arenas are initialised by K_AINIT (checked, zeroing what was poisoned).
{
  poison(m, rng, { stack: false, regions: KPOISON });
  model = new KernelModel(S, new Uint8Array(m.ram), classes);
  const sec = new Sec('poisoned RAM, K_AINIT of both arenas (zeroing), K_ARENA');
  doAinit(sec, S.K_KARENA, 0xF100, 0xFB00, false);
  doAinit(sec, S.K_AARENA, 0xC000, 0xE000, false);
  doArena(sec, S.K_AARENA);
  sec.ok(m.ram.subarray(0xC000, 0xE000).every((v) => v === 0) && m.ram.subarray(0xF100, 0xFB00).every((v) => v === 0), 'both arenas are zero after K_AINIT');
  sec.end();
}

const freshArenas = (sec) => { doAinit(sec, S.K_KARENA, 0xF100, 0xFB00); doAinit(sec, S.K_AARENA, 0xC000, 0xE000); doArena(sec, S.K_AARENA); };
const pickArena = (sec) => doArena(sec, rng.chance(0.5) ? S.K_AARENA : S.K_KARENA);

// ===========================================================================================================================
// 2. send (test 1): every message to every class
if (ONLY.includes(2)) {
  const sec = new Sec('send: every message to every class, T_SEND (reached label, log, carry, registers, memory)');
  let sends = 0;
  for (let round = 0; round < ROUNDS && !sec.bad; round++) {
    freshArenas(sec);
    for (const c of classes.list) {
      if (sec.bad) break;
      pickArena(sec);
      const inst = doNew(sec, c.name);
      if (inst === null) { sec.ok(false, `${c.name}: K_NEW failed in a fresh arena`); continue; }
      randomize(inst);
      const msgs = []; for (let i = 1; i < c.count; i++) msgs.push(i);
      for (let i = msgs.length - 1; i > 0; i--) { const j = rng.int(0, i); [msgs[i], msgs[j]] = [msgs[j], msgs[i]]; }
      msgs.push(0);                                                                   // Destroy last (it frees the instance)
      for (const msg of msgs) {
        let bc = rng.int(0, 65535), de = rng.int(0, 65535);
        if (msg === MSG.HITTEST && c.offsets.x !== undefined && rng.chance(0.6)) {   // aim near the rectangle
          const vx = rd16(m, inst + c.offsets.x), vw = rd16(m, inst + c.offsets.w), vy = m.ram[inst + c.offsets.y], vh = m.ram[inst + c.offsets.h];
          bc = (vx + rng.int(-2, vw + 1)) & 0xFFFF; de = (vy + rng.int(-2, vh + 1)) & 0xFF;
        }
        doSend(sec, inst, msg, bc, de, true); sends++;
        if (sec.bad) break;
      }
    }
  }
  console.log(`  ${sends} sends`);
  sec.end();
}

// ===========================================================================================================================
// 3. view_hittest edges (13.3)
if (ONLY.includes(3)) {
  const sec = new Sec('view_hittest and M_HITTEST on View: edges, w = 0, D > 0, BC near 65535');
  freshArenas(sec);
  let calls = 0;
  const cfgs = [[0, 0, 1, 1], [0, 0, 0, 5], [100, 20, 0, 0], [511, 191, 1, 1], [0, 0, 512, 192], [10, 10, 502, 182], [300, 7, 1, 192], [37, 150, 200, 0]];
  for (let i = 0; i < 8; i++) cfgs.push([rng.int(0, 511), rng.int(0, 191), rng.int(0, 512), rng.int(0, 192)]);
  for (const [vx, vy, vw, vh] of cfgs) {
    if (sec.bad) break;
    pickArena(sec);
    let v = doNew(sec, 'View');
    if (v === null) { freshArenas(sec); v = doNew(sec, 'View'); }
    randomize(v);
    poke16(v + 8, vx); poke8(v + 10, vy); poke16(v + 11, vw); poke8(v + 13, vh);
    const xs = new Set([vx - 1, vx, vx + 1, vx + vw - 1, vx + vw, vx + vw + 1, 0, 1, 511, 512, 65535, 65534, 65535 - vw, 32768, vx + 256, rng.int(0, 65535)].map((x) => x & 0xFFFF));
    const ys = new Set([vy - 1, vy, vy + 1, vy + vh - 1, vy + vh, vy + vh + 1, 0, 191, 255, 256 + vy, 0x8000 + vy, 0xFF00 + vy, 0xFFFF, 0x0100, 0x0101, rng.int(0, 65535)].map((y) => y & 0xFFFF));
    for (const x of xs) for (const y of ys) {
      if (sec.bad) break;
      const want = model.hit(v, x, y);
      const r = run(sec, `view_hittest (${vx},${vy},${vw},${vh}) at (${x},${y})`, 'view_hittest', { ix: v, bc: x, de: y });
      sec.ok(carryOf(r) === want, () => `view_hittest rect (${vx},${vy},${vw},${vh}) at (${x},${y}): carry ${carryOf(r)}, model ${want}`);
      cmp(sec, 'view_hittest'); calls++;
      if (rng.chance(0.5)) { doSend(sec, v, MSG.HITTEST, x, y, true); calls++; }
    }
  }
  console.log(`  ${calls} calls`);
  sec.end();
}

// ===========================================================================================================================
// 4. allocation (test 2)
if (ONLY.includes(4)) {
  const sec = new Sec('allocation: K_NEW / K_FREE / K_ALLOC / K_ARENA / K_ARESET / K_AINIT vs the model');
  const live = [];                                          // { addr, rec }
  const st = { new: 0, newFull: 0, fromList: 0, free: 0, alloc: 0, allocFull: 0, arena: 0, reset: 0, ainit: 0, near: 0 };
  const smalls = ['TSz8', 'TSz9', 'TSz16', 'TSz24', 'TSz32'], bigs = ['TSz33', 'TSz40', 'TSz255'], kernels = ['Object', 'View', 'TLog', 'TLog2'];
  const pickCls = () => { const p = rng.next(); return p < 0.55 ? rng.pick(smalls) : p < 0.75 ? rng.pick(bigs) : rng.pick(kernels); };
  const ptrVals = () => {
    const p = rng.next();
    return p < 0.2 ? 0 : p < 0.4 ? rng.int(0xC000, 0xDFFF) : p < 0.6 ? rng.int(0xF100, 0xFAFF) : p < 0.7 ? 0xE000 + rng.int(0, 255) : p < 0.8 ? 0xBF00 + rng.int(0, 255)
      : p < 0.9 ? 0xFB00 + rng.int(0, 255) : rng.int(0, 65535);
  };
  const setPtrs = () => { for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT]) poke16(a, ptrVals()); };
  const cur = () => model.cur;
  const dropArena = (rec) => { for (let i = live.length - 1; i >= 0; i--) if (live[i].rec === rec) live.splice(i, 1); };
  freshArenas(sec); setPtrs();
  let fullStreak = 0;
  for (let i = 0; i < STEPS && !sec.bad; i++) {
    if (i % 37 === 0) setPtrs();
    const p = rng.next();
    if (fullStreak >= 12) {
      const rec = cur(); setPtrs(); doReset(sec, rec); dropArena(rec); st.reset++; fullStreak = 0; continue;
    }
    if (p < 0.46 || (p < 0.76 && live.length === 0)) {
      const name = pickCls(), rec = cur(), a = doNew(sec, name, `step ${i}: K_NEW ${name}`);
      st.new++;
      if (a === null) { st.newFull++; fullStreak++; } else {
        fullStreak = 0; live.push({ addr: a, rec });
        if (rng.chance(0.5)) randomize(a);
      }
    } else if (p < 0.76) {
      const j = rng.int(0, live.length - 1), e = live[j]; live[j] = live[live.length - 1]; live.pop();
      doFree(sec, e.addr, `step ${i}: K_FREE`); st.free++;
    } else if (p < 0.88) {
      const q = rng.next(), rc = model.rec(cur()), room = rc.end - rc.top;
      const bc = q < 0.55 ? rng.int(1, 300) : q < 0.58 ? 0 : q < 0.63 ? 255 : q < 0.68 ? 4000 : q < 0.72 ? 65535 : q < 0.82 ? Math.max(0, room + rng.int(-1, 1)) : q < 0.9 ? rng.int(0, 65535) : rng.int(0, 40);
      const a = doAlloc(sec, bc); st.alloc++;
      if (a === null) { st.allocFull++; fullStreak++; } else fullStreak = 0;
    } else if (p < 0.94) { doArena(sec, rng.chance(0.5) ? S.K_AARENA : S.K_KARENA); st.arena++; }
    else if (p < 0.96) {                                                              // fill to within a few bytes of the end
      const rc = model.rec(cur()), room = rc.end - rc.top;
      if (room > 0) { doAlloc(sec, Math.max(0, room - rng.int(0, 40))); st.near++; }
    } else if (p < 0.9625) {
      const rec = rng.chance(0.5) ? S.K_AARENA : S.K_KARENA;
      if (rng.chance(0.8)) setPtrs();
      doReset(sec, rec); dropArena(rec); st.reset++;
    } else if (p < 0.966) {
      const rec = rng.chance(0.5) ? S.K_AARENA : S.K_KARENA, app = rec === S.K_AARENA;
      const lo = app ? 0xC0 : 0xF1, hi = app ? 0xE0 : 0xFB;
      let b = lo, e = hi;
      if (rng.chance(0.6)) { b = rng.int(lo, hi); e = rng.int(b, hi); if (rng.chance(0.5)) e = Math.min(hi, b + rng.int(0, 3)); }
      doAinit(sec, rec, b << 8, e << 8); dropArena(rec); st.ainit++;
    } else { const name = pickCls(), a = doNew(sec, name, `step ${i}: K_NEW ${name}`); if (a !== null) live.push({ addr: a, rec: cur() }); st.new++; }
  }
  for (const rec of [S.K_KARENA, S.K_AARENA]) {
    const rc = model.rec(rec);
    sec.ok(m.ram.subarray(rc.top, rc.end).every((v) => v === 0), () => `arena ${hex(rec)}: [top, end) is not all zero (13.4 invariant)`);
  }
  st.fromList = model.stat.fromList; console.log(`  ${JSON.stringify(st)}`);
  sec.ok(st.newFull > 0 && st.allocFull > 0 && st.reset > 0 && st.ainit > 0, () => `coverage: the run met full / reset / init (${JSON.stringify(st)})`);
  sec.end();
}

// ===========================================================================================================================
// 5. view tree
if (ONLY.includes(5)) {
  const sec = new Sec('view tree: K_ADDCHILD / K_UNLINK / K_SETROOT / M_DESTROY on random trees of TLog / TLog2 / View');
  let ops = 0, maxDepth = 0, destroyed = 0;
  for (let sc = 0; sc < TREES && !sec.bad; sc++) {
    freshArenas(sec);
    const nodes = [];
    const newNode = () => {
      pickArena(sec);
      const name = rng.pick(['View', 'TLog', 'TLog', 'TLog2']), a = doNew(sec, name);
      if (a !== null) { randomize(a); nodes.push(a); }
    };
    const target = rng.int(2, 32);
    for (let i = 0; i < target; i++) newNode();
    const setPtrs = () => {
      for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT]) poke16(a, nodes.length && rng.chance(0.85) ? rng.pick(nodes) : rng.chance(0.5) ? 0 : rng.int(0, 65535));
    };
    setPtrs();
    const nops = rng.int(40, 120);
    for (let k = 0; k < nops + 2 * target && !sec.bad; k++) {
      const p = k < 2 * target ? 0 : rng.next();               // first: build the forest
      ops++;
      if (nodes.length === 0) { newNode(); continue; }
      if (p < 0.35) {
        const det = nodes.filter((n) => model.parentOf(n) === 0);
        const c = rng.pick(det), cand = nodes.filter((n) => n !== c && !model.subtree(c).includes(n) && model.pathLen(n) + model.height(c) <= 8);
        if (cand.length === 0) continue;
        const par = rng.pick(cand); doAddChild(sec, par, c);
        maxDepth = Math.max(maxDepth, model.pathLen(c) + model.height(c) - 1);
      } else if (p < 0.47) doUnlink(sec, rng.pick(nodes));
      else if (p < 0.55) doSetRoot(sec, rng.chance(0.15) ? 0 : rng.pick(nodes));
      else if (p < 0.67) {
        const n = rng.pick(nodes), gone = new Set(model.subtree(n));
        doSend(sec, n, MSG.DESTROY, rng.int(0, 65535), rng.int(0, 65535), false);
        for (let i = nodes.length - 1; i >= 0; i--) if (gone.has(nodes[i])) nodes.splice(i, 1);
        destroyed += gone.size;
      } else if (p < 0.80) {
        const n = rng.pick(nodes), c = model.classOf(n), msg = rng.int(1, c.count - 1);
        doSend(sec, n, msg, rng.int(0, 65535), rng.int(0, 65535), true);
      } else if (p < 0.90) setPtrs();
      else if (nodes.length < 32) newNode();
    }
    // the three pointers, explicitly
    for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT]) sec.ok(rd16(m, a) === model.rd16(a), () => `pointer ${hex(a)}: ${hex(rd16(m, a))}, model ${hex(model.rd16(a))}`);
    // finish by destroying what is left, root by root (pointers set to nodes beforehand)
    setPtrs();
    for (const n of [...nodes]) {
      if (sec.bad) break;
      if (!nodes.includes(n)) continue;
      if (model.parentOf(n) !== 0) continue;
      const gone = new Set(model.subtree(n));
      doSend(sec, n, MSG.DESTROY, rng.int(0, 65535), rng.int(0, 65535), false);
      for (let i = nodes.length - 1; i >= 0; i--) if (gone.has(nodes[i])) nodes.splice(i, 1);
    }
    sec.ok(model.rd16(S.K_AARENA + 0) >= 0xC000, 'arena top sane');
  }
  console.log(`  ${ops} tree operations, ${destroyed} nodes destroyed, deepest tree built ${maxDepth} levels`);
  sec.end();
}

console.log(`${N} assertions`);
C.done();
