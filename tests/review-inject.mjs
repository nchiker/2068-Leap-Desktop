"use strict";
// review-inject.mjs -- independent review, questions 1 and 3: frame interrupts injected at instruction boundaries of the main
// program's routines (one and two interrupts a routine), the whole ISR run each time.
//   node tests/review-inject.mjs [--seed N] [--scen N] [--pairs N] [--rand N]
// The model (review-lib.mjs KModel) is the ring's producer side; the consumer-owned head is taken from the machine at each
// interrupt (the ISR is atomic, so what it sees of the head is exact).  The consumer side is checked by rule:
//   K_GETEV from the ring returns the record at the head, all 4 bytes as the producer last wrote them, and advances the head by 4;
//   it may report "empty" only if the ring was empty when it was entered.
import { start, makeRng, setInput, setCall, step, runIsr, snapshot, restore, readKeymap, KModel, hex, grab, put, drawArrow, firstDiff,
  dIdx, E_MOVE } from './review-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const seed = arg('--seed', 1), NSCEN = arg('--scen', 24), NPAIRS = arg('--pairs', 1200), NRAND = arg('--rand', 4000);
const rng = makeRng(seed);
const { m, S, img } = start();
const arrow = img.subarray(S.P_ARROW, S.P_ARROW + 64);
let K = new KModel(readKeymap());
// --mutate N: patch the cartridge image in the emulator's memory (never the sources) to show that the checks can fail.
const MUT = arg('--mutate', 0);
const poke = (addr, from, to) => { const c = m.dock[addr >> 13], o = addr & 0x1FFF; if (c[o] !== from) throw new Error(`mutation: ${hex(addr)} holds ${hex(c[o], 2)}, not ${hex(from, 2)}`); c[o] = to; };
if (MUT === 1) poke(S.P_ISRMOVE + 5, 0xC0, 0x00);                        // P_ISRMOVE ignores PT_LOCK
if (MUT === 2) { let a = S.k_dir; while (!(img[a] === 0x7C && img[a + 1] === 0x95 && img[a + 2] === 0xFE && img[a + 3] === 0x08)) a++; poke(a + 3, 0x08, 0x04); }   // a move coalesces into the head record
if (MUT) console.log(`MUTATION ${MUT} applied: failures are expected`);
let fails = 0, runs = 0, isrs = 0, maxDepth = 0, maxIsrT = 0, refused = 0;
const fail = (msg) => { fails++; if (fails <= 15) console.log('FAIL: ' + msg); };
const NONE = () => new Uint8Array(8);
const keys = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
const J = { idle: 0xFF, u: 0xFE, d: 0xFD, l: 0xFB, r: 0xF7, f: 0x7F, rf: 0x77, lf: 0x7B, ul: 0xFA, dr: 0xF5, df: 0x7D, uf: 0x7E };

/** One frame interrupt now, with this input; the model follows.  ctx names the place for messages. */
function isr(rows, joy, ctx, opts = {}) {
  setInput(m, rows, joy);
  const lock = m.ram[S.PT_LOCK] !== 0;
  K.head = m.ram[S.K_RHEAD];
  if (opts.model) opts.model(lock); else { K.log = []; K.poll(rows, joy, lock); }
  if (lock && K.pend) refused++;
  const frames0 = m.ram[S.V_FRAMES] | (m.ram[S.V_FRAMES + 1] << 8);
  const r = runIsr(m, S, rng);
  isrs++;
  if (r.depth > maxDepth) maxDepth = r.depth;
  if (r.t > maxIsrT) maxIsrT = r.t;
  if (r.changed.length) fail(`${ctx}: the ISR changed ${r.changed.join(', ')}`);
  if (r.depth > 32) fail(`${ctx}: ISR stack ${r.depth} bytes`);
  if (r.di) fail(`${ctx}: DI executed in the ISR`);
  if (!r.iffOk) fail(`${ctx}: interrupts off after the ISR`);
  if (((m.ram[S.V_FRAMES] | (m.ram[S.V_FRAMES + 1] << 8)) - frames0 & 0xFFFF) !== 1) fail(`${ctx}: V_FRAMES did not rise by 1`);
  if (m.portF4 !== m.ram[S.V_SHADOW_F4]) fail(`${ctx}: $F4 ${hex(m.portF4, 2)} after the ISR, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`);
  if (m.ayLatch !== m.ram[S.K_AYREG]) fail(`${ctx}: AY latch ${m.ayLatch} after the ISR, shadow ${m.ram[S.K_AYREG]}`);
  if (!opts.noDiff) { const d = producerDiff(); if (d) fail(`${ctx}: after the ISR: ${d}; model events ${JSON.stringify(K.log)}`); }
  return r;
}
/** The producer-owned memory against the model: ring, tail, lost, position, button, mode, caps. */
function producerDiff() {
  const out = [];
  for (let i = 0; i < 64; i++) if (m.ram[S.K_RING + i] !== K.ring[i]) { out.push(`ring byte ${i}: machine ${m.ram[S.K_RING + i]} model ${K.ring[i]}`); break; }
  const eq = (n, a, b) => { if (a !== b) out.push(`${n} machine ${a} model ${b}`); };
  eq('K_RTAIL', m.ram[S.K_RTAIL], K.tail); eq('K_LOST', m.ram[S.K_LOST], K.lost);
  eq('K_PX', m.ram[S.K_PX] | (m.ram[S.K_PX + 1] << 8), K.px); eq('K_PY', m.ram[S.K_PY], K.py); eq('K_BTN', m.ram[S.K_BTN], K.btn);
  eq('K_KPMODE', m.ram[S.K_KPMODE], K.kp); eq('K_CAPS', m.ram[S.K_CAPS], K.caps);
  return out.length ? out.join('; ') : null;
}

/** Run a prepared call (PC, SP set by setCall) to T_RET; inj = sorted boundary numbers at which to interrupt (boundary k is before
 * the k-th instruction; the last boundary is at the return).  onIsr(n, boundary).  Returns the number of boundaries. */
function runWith(inj, onIsr, guard = 3_000_000) {
  const cpu = m.cpu; let n = 0, q = 0; const t0 = m.tstates;
  for (;;) {
    while (q < inj.length && inj[q] === n) { onIsr(q, n); q++; }
    if (cpu.pc === S.T_RET) break;
    step(m); n++;
    if (m.tstates - t0 > guard) throw new Error(`routine did not return, PC ${hex(cpu.pc)}`);
  }
  while (q < inj.length) { onIsr(q, n); q++; }
  return n + 1;
}
const direct = (name, regs = {}) => { setCall(m, S, S[name], regs, true, rng); runWith([], () => {}); return { carry: m.cpu.f & 1, a: m.cpu.a }; };
const r16 = (a) => m.ram[a] | (m.ram[a + 1] << 8);

// ===========================================================================================================================
// Part A: the queues.  Every boundary pair (i <= j) of K_GETEV and K_POST, over ring / posted-queue states and ISR inputs.
function mainGetev(ctx, inj, inputs) {
  const head0 = m.ram[S.K_RHEAD], tail0 = m.ram[S.K_RTAIL], pn0 = m.ram[S.K_PN], ph0 = m.ram[S.K_PHEAD], ev0 = [...m.ram.subarray(S.K_EV, S.K_EV + 4)];
  const post0 = [...m.ram.subarray(S.K_POSTQ, S.K_POSTQ + 16)];
  setCall(m, S, S.K_GETEV, {}, true, rng);
  let want = [...K.ring.subarray(head0 & 63, (head0 & 63) + 4)];
  const n = runWith(inj, (q) => {
    const moved = m.ram[S.K_RHEAD] !== head0;          // the head record is the consumer's until the head moves; after that the slot may be reused
    isr(inputs[q][0], inputs[q][1], `${ctx} irq ${q}`);
    if (!moved) want = [...K.ring.subarray(head0 & 63, (head0 & 63) + 4)];
  });
  const carry = m.cpu.f & 1, a = m.cpu.a, ev = [...m.ram.subarray(S.K_EV, S.K_EV + 4)];
  const head1 = m.ram[S.K_RHEAD];
  if (pn0 > 0) {
    const want = post0.slice(4 * ph0, 4 * ph0 + 4);
    if (carry || ev.join() !== want.join() || a !== want[0] || m.ram[S.K_PN] !== pn0 - 1 || m.ram[S.K_PHEAD] !== ((ph0 + 1) & 3) || head1 !== head0) fail(`${ctx}: posted event wrong: carry ${carry} K_EV ${ev} want ${want}`);
    return { n, ev, carry };
  }
  if (carry) {
    if (head0 !== tail0) fail(`${ctx}: K_GETEV said empty, the ring held ${((tail0 - head0) & 255) / 4} at entry`);
    if (ev.join() !== ev0.join() || head1 !== head0) fail(`${ctx}: K_GETEV empty but wrote K_EV or the head`);
    return { n, carry };
  }
  if (K.tail === head0) fail(`${ctx}: K_GETEV returned an event from an empty ring`);
  if (ev.join() !== want.join()) fail(`${ctx}: K_EV ${ev} is not the head record ${want} (torn or wrong)`);
  if (a !== ev[0]) fail(`${ctx}: A ${a} is not the type ${ev[0]}`);
  if (head1 !== ((head0 + 4) & 255)) fail(`${ctx}: head ${head0} -> ${head1}`);
  if (m.ram[S.K_PN] !== 0) fail(`${ctx}: K_PN changed`);
  return { n, ev, carry };
}
function mainPost(ctx, inj, inputs, rec) {
  const pn0 = m.ram[S.K_PN], ph0 = m.ram[S.K_PHEAD], post0 = [...m.ram.subarray(S.K_POSTQ, S.K_POSTQ + 16)], head0 = m.ram[S.K_RHEAD];
  setCall(m, S, S.K_POST, { a: rec[0], c: rec[1], e: rec[2], d: rec[3] }, true, rng);
  const bc = [m.cpu.b, m.cpu.c, m.cpu.d, m.cpu.e];
  const n = runWith(inj, (q) => isr(inputs[q][0], inputs[q][1], `${ctx} irq ${q}`));
  const carry = m.cpu.f & 1, post1 = [...m.ram.subarray(S.K_POSTQ, S.K_POSTQ + 16)];
  const want = post0.slice();
  if (pn0 < 4) want.splice(4 * ((ph0 + pn0) & 3), 4, ...rec);
  if (carry !== (pn0 === 4 ? 1 : 0) || post1.join() !== want.join() || m.ram[S.K_PN] !== Math.min(4, pn0 + 1) || m.ram[S.K_PHEAD] !== ph0 || m.ram[S.K_RHEAD] !== head0) fail(`${ctx}: K_POST wrong (carry ${carry}, K_PN ${m.ram[S.K_PN]})`);
  if ([m.cpu.b, m.cpu.c, m.cpu.d, m.cpu.e].join() !== bc.join()) fail(`${ctx}: K_POST changed BC or DE`);
  return { n };
}
/** Bring the ring to `recs` records with the head at `off` records from 0 (so it wraps), the last a move or not; posted pn. */
function prepQueues(nRing, lastMove, pn, wrapTo) {
  // advance head and tail to wrapTo records (mod 64) by appending and draining button events
  let fire = K.btn;
  const ev = () => { fire ^= 1; isr(NONE(), fire ? J.f : J.idle, 'prep'); };
  while (((m.ram[S.K_RTAIL] >> 2) & 63) !== (wrapTo & 63)) { ev(); while (!direct('K_GETEV').carry) { /* drain */ } }
  while (!direct('K_GETEV').carry) { /* drain */ }
  for (let i = 0; i < nRing - (lastMove ? 1 : 0); i++) ev();
  if (lastMove && nRing > 0) isr(NONE(), fire ? J.rf : J.r, 'prep move');
  while (m.ram[S.K_PN] > 0) direct('K_GETEV');        // posted first: these do not touch the ring
  // re-fill what those calls may have taken is not needed: K_PN was 0 on entry to the fills above
  for (let i = 0; i < pn; i++) direct('K_POST', { a: 16 + i, c: 0xA0 + i, e: 0xB0 + i, d: 0xC0 + i });
  K.head = m.ram[S.K_RHEAD];
}
function partA() {
  const INPUTS = [
    [[NONE(), J.r], [NONE(), J.r]],                    // two moves (coalescing)
    [[NONE(), J.rf], [NONE(), J.l]],                   // move + DOWN, then move + UP
    [[keys(5), J.idle], [keys(5, 31), J.d]],           // a key, then a key and a move
    [[keys(0, 1, 2), J.uf], [NONE(), J.uf]],           // two shifted keys + move + DOWN, then releases + move
  ];
  let total = 0, events = 0;
  const states = [];
  for (const nRing of [0, 1, 2, 3, 14, 15, 16]) for (const lastMove of [false, true]) for (const pn of [0, 1, 4]) {
    if (nRing === 0 && lastMove) continue;
    states.push({ nRing, lastMove, pn, wrapTo: rng.pick([0, 3, 15, 62, 63, 40]) });
  }
  for (const st of states) {
    isr(NONE(), J.idle, 'reset'); K.hold = K.hold;     // idle frame: hold 0
    direct('K_WARP', { hl: 256, de: 96 }); K.warp(256, 96); isr(NONE(), J.idle, 'centre');
    prepQueues(st.nRing, st.lastMove, st.pn, st.wrapTo);
    const snap = snapshot(m), K0 = K.clone();
    for (const [ri, routine] of ['K_GETEV', 'K_POST'].entries()) {
      // boundaries of the routine in this state
      restore(m, snap); K = K0.clone();
      const N = routine === 'K_GETEV' ? mainGetev('dry', [], []).n : mainPost('dry', [], [], [7, 1, 2, 3]).n;
      for (const [ii, inputs] of INPUTS.entries()) {
        if ((ri + ii + st.nRing) % 2 && st.pn === 1) continue;            // thin the grid a little
        for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
          restore(m, snap); K = K0.clone();
          const ctx = `${routine} ring ${st.nRing}${st.lastMove ? 'M' : ''} posted ${st.pn} wrap ${st.wrapTo} inputs ${ii} irqs at ${i},${j} of ${N}`;
          const f0 = fails;
          if (routine === 'K_GETEV') mainGetev(ctx, [i, j], inputs); else mainPost(ctx, [i, j], inputs, [7, 0x11, 0x22, 0x33]);
          // drain everything: the stream must be the posted records, then the ring in order, nothing lost or doubled
          const kept = (K.tail - m.ram[S.K_RHEAD]) & 255;
          let guard = 40, got = 0;
          while (guard-- > 0) { const r = mainGetev(ctx + ' drain', [], []); if (r.carry) break; got++; }
          if (m.ram[S.K_RHEAD] !== K.tail) fail(`${ctx}: after the drain head ${m.ram[S.K_RHEAD]} != tail ${K.tail}`);
          void kept; events += got; total++; runs++;
          if (fails > f0 && fails > 15) return;
        }
      }
    }
    restore(m, snap); K = K0.clone();
  }
  console.log(`part A: K_GETEV / K_POST, every pair of boundaries: ${total} runs over ${states.length} queue states x 4 inputs, ${events} events drained; fails ${fails}`);
}

// Part A2: K_WARP, every boundary pair; the position after the routine and one more interrupt.
function partA2() {
  let total = 0, dropped = 0;
  const cases = [];
  for (const pendingOld of [false, true]) for (const tgt of [[100, 50], [600, -5], [-3, 300], [511, 191]]) cases.push({ pendingOld, tgt });
  for (const cs of cases) {
    isr(NONE(), J.idle, 'reset');
    direct('K_WARP', { hl: 256, de: 96 }); K.warp(256, 96); isr(NONE(), J.idle, 'centre');
    while (!direct('K_GETEV').carry) { /* drain */ }
    if (cs.pendingOld) { direct('K_WARP', { hl: 30, de: 20 }); K.warp(30, 20); }
    const snap = snapshot(m), K0 = K.clone();
    setCall(m, S, S.K_WARP, { hl: cs.tgt[0] & 0xFFFF, de: cs.tgt[1] & 0xFFFF }, true, rng);
    const N = runWith([], () => {});
    for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
      // candidates: n0 interrupts before the routine took effect at all, n1 that saw no warp pending, the rest after
      const inputs = [[NONE(), J.r], [NONE(), J.d], [NONE(), J.idle]];
      const cands = [];
      for (let n0 = 0; n0 <= 2; n0++) for (let n1 = 0; n0 + n1 <= 2; n1++) {
        const c = K0.clone(); c.head = m.ram[S.K_RHEAD];
        for (let k = 0; k < n0; k++) c.poll(inputs[k][0], inputs[k][1], false);
        const hadOld = !!c.warpReq; c.warpReq = null;
        for (let k = n0; k < n0 + n1; k++) c.poll(inputs[k][0], inputs[k][1], false);
        c.warp(cs.tgt[0], cs.tgt[1]);
        for (let k = n0 + n1; k < 3; k++) c.poll(inputs[k][0], inputs[k][1], false);
        cands.push({ c, droppedOld: hadOld && n1 > 0, n0, n1 });
      }
      restore(m, snap);
      setCall(m, S, S.K_WARP, { hl: cs.tgt[0] & 0xFFFF, de: cs.tgt[1] & 0xFFFF }, true, rng);
      const de = [m.cpu.d, m.cpu.e, m.cpu.b, m.cpu.c];
      const ctx = `K_WARP to ${cs.tgt}${cs.pendingOld ? ' (an older warp pending)' : ''} irqs at ${i},${j} of ${N}`;
      runWith([i, j], (q) => isr(inputs[q][0], inputs[q][1], ctx, { model: () => {}, noDiff: true }));
      if ([m.cpu.d, m.cpu.e, m.cpu.b, m.cpu.c].join() !== de.join()) fail(`${ctx}: K_WARP changed BC or DE`);
      isr(inputs[2][0], inputs[2][1], ctx, { model: () => {}, noDiff: true });
      const hit = cands.find((x) => { K = x.c; return producerDiff() === null && r16(S.PT_X) === x.c.ptx && m.ram[S.PT_Y] === x.c.pty; });
      if (!hit) { K = cands[0].c; fail(`${ctx}: no ordering explains the result: K_PX ${r16(S.K_PX)} K_PY ${m.ram[S.K_PY]} tail ${m.ram[S.K_RTAIL]}`); } else if (hit.droppedOld && !cands.some((x) => !x.droppedOld && (K = x.c, producerDiff() === null))) dropped++;
      total++; runs++;
    }
    restore(m, snap); K = K0.clone();
  }
  console.log(`part A2: K_WARP, every pair of boundaries: ${total} runs; in ${dropped} of them an older pending warp was discarded unseen (explained only that way); fails ${fails}`);
}

// ===========================================================================================================================
// Part B: the pointer.  P_SHIELD, a shielded G_FILL, P_UNSHIELD as one program; the joystick moves the pointer in the ISRs.
let bg = null;                                        // the display without the pointer
function setScene() {
  setGA(0, 0, 512, 192);
  direct0('P_SHIELD');                                // erases the pointer (interrupts off for the setup)
  bg = new Uint8Array(12288); for (let i = 0; i < bg.length; i++) bg[i] = rng.int(0, 255);
  put(m, bg);
  direct0('P_UNSHIELD');
  m.cpu.iff1 = m.cpu.iff2 = true;
}
function direct0(name, regs = {}) { setCall(m, S, S[name], regs, false, rng); runWith([], () => {}, 6_000_000); m.cpu.iff1 = m.cpu.iff2 = true; }
function setGA(x, y, w, h) { [x, y, w, h].forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 255; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 255; }); }
/** What G_FILL makes of background d (reference run: no pointer, interrupts off; the machine is restored). */
function refFill(d, rect, op) {
  const snap = snapshot(m);
  put(m, d); setGA(...rect); m.ram[S.GOP] = op;
  direct0('G_FILL');
  const out = grab(m);
  restore(m, snap);
  return out;
}
function checkDisplay(ctx, want) {
  const d = firstDiff(grab(m), want);
  if (d) fail(`${ctx}: display: ${d}`);
  return !d;
}
function settle(ctx) {                                // two quiet frames; then the pointer must be drawn at the input's position
  isr(NONE(), J.idle, ctx + ' settle 1'); isr(NONE(), J.idle, ctx + ' settle 2');
  if (r16(S.PT_X) !== K.px || m.ram[S.PT_Y] !== K.py) fail(`${ctx}: PT position (${r16(S.PT_X)}, ${m.ram[S.PT_Y]}) is not the input's (${K.px}, ${K.py})`);
  if (!m.ram[S.PT_DRAWN] || r16(S.PT_DX) !== K.px || m.ram[S.PT_DY] !== K.py) fail(`${ctx}: pointer not drawn at (${K.px}, ${K.py}): drawn ${m.ram[S.PT_DRAWN]} at (${r16(S.PT_DX)}, ${m.ram[S.PT_DY]})`);
}
function partB() {
  let total = 0, singles = 0, cls = 0;
  for (let sc = 0; sc < NSCEN && fails <= 15; sc++) {
    setScene();
    const w = rng.pick([1, 5, 8, 17, 30, 40, 70]), h = rng.int(1, 10);
    const x = rng.pick([0, 512 - w, rng.int(0, 512 - w), rng.int(0, 512 - w)]), y = rng.pick([0, 192 - h, rng.int(0, 192 - h), rng.int(0, 192 - h)]);
    const rect = [x, y, w, h], op = rng.pick([0, 1, 2, 2]);
    // the pointer starts near the rectangle and is moving towards / along / away from it
    const px = Math.max(0, Math.min(511, x + rng.int(-30, w + 14))), py = Math.max(0, Math.min(191, y + rng.int(-22, h + 6)));
    const dir = rng.pick([J.r, J.l, J.u, J.d, J.ul, J.dr, J.rf, J.df]);
    const hold = rng.pick([0, 0, 3, 12, 30]), moving = rng.chance(0.6);
    for (let i = 0; i < hold; i++) isr(NONE(), dir, 'prep hold');
    direct0('K_WARP', { hl: px, de: py }); K.warp(px, py);
    m.cpu.iff1 = m.cpu.iff2 = true;
    if (moving) { isr(NONE(), dir, 'prep'); isr(NONE(), dir, 'prep'); } else { isr(NONE(), J.idle, 'prep'); isr(NONE(), J.idle, 'prep'); isr(NONE(), J.idle, 'prep'); }
    while (!direct('K_GETEV').carry) { /* drain */ }
    const in1 = [rng.chance(0.3) ? keys(rng.int(1, 35)) : NONE(), rng.chance(0.8) ? dir : rng.pick(Object.values(J))];
    const in2 = [rng.chance(0.3) ? keys(rng.int(1, 35), 0) : NONE(), rng.pick([dir, dir, J.idle, J.l, J.r, J.u, J.d])];
    const isCls = sc % 6 === 5;                       // every sixth scenario: a whole-screen shield and G_CLS (stack in the display file)
    const prog = isCls ? [['P_SHIELD', [0, 0, 512, 192]], ['G_CLS'], ['P_UNSHIELD']] : [['P_SHIELD', rect], ['G_FILL', rect], ['P_UNSHIELD']];
    const want0 = isCls ? new Uint8Array(12288) : refFill(bg, rect, op);
    const c0 = x >> 3, c1 = (x + w - 1) >> 3;
    const snap = snapshot(m), K0 = K.clone();
    // dry run for the boundary counts of each call (with an interrupt a call may be shorter or longer; later boundaries then fall at its return)
    const lens = (() => { const l = []; for (const [name, ga] of prog) { if (ga) setGA(...ga); if (name === 'G_FILL') m.ram[S.GOP] = op; setCall(m, S, S[name], {}, true, rng); l.push(runWith([], () => {}, 6_000_000)); } return l; })();
    const N = lens.reduce((a, b) => a + b, 0);
    const runOne = (inj) => {
      restore(m, snap); K = K0.clone();
      const ctx = `scenario ${sc} ${isCls ? 'G_CLS' : `rect ${rect} op ${op}`} pointer (${px}, ${py}) ${moving ? 'moving' : 'at rest'} irqs at ${inj} of ${N} [${lens}]`;
      // run the three calls, mapping the global boundary numbers onto each
      let base = 0, q0 = 0;
      for (const [pi, [name, ga]] of prog.entries()) {
        if (ga) setGA(...ga);
        if (name === 'G_FILL') m.ram[S.GOP] = op;
        setCall(m, S, S[name], {}, true, rng);
        const mine = [];
        while (q0 + mine.length < inj.length && inj[q0 + mine.length] < base + lens[pi]) mine.push(inj[q0 + mine.length] - base);
        const qBase = q0;
        const n = runWith(mine, (q, bnd) => {
          const before = (pi === 1 && !isCls) ? grab(m) : null;
          const inp = qBase + q === 0 ? in1 : in2;
          isr(inp[0], inp[1], `${ctx} (in ${name} at ${bnd})`);
          if (before) {
            const after = grab(m);
            for (let cc = c0; cc <= c1; cc++) for (let yy = y; yy < y + h; yy++) if (before[dIdx(cc, yy)] !== after[dIdx(cc, yy)]) { fail(`${ctx}: the ISR wrote inside the shield (byte column ${cc}, row ${yy}) during ${name}`); return; }
          }
        }, 6_000_000);
        void n;
        q0 += mine.length; base += lens[pi];
      }
      settle(ctx);
      checkDisplay(ctx, drawArrow(want0, arrow, K.px, K.py));
      total++; runs++;
    };
    if (isCls) {                                      // G_CLS is long: sampled singles and pairs
      for (let k = 0; k < 250 && fails <= 15; k++) { const i = rng.int(0, N - 1); runOne(k % 2 ? [i] : [i, rng.int(i, N - 1)]); cls++; }
    } else {
      for (let i = 0; i < N && fails <= 15; i++) { runOne([i]); singles++; }
      for (let k = 0; k < NPAIRS && fails <= 15; k++) { const i = rng.int(0, N - 1), j = rng.int(i, Math.min(N - 1, i + rng.pick([0, 1, 3, 20, N]))); runOne([i, j]); }
    }
    restore(m, snap); K = K0.clone();
  }
  console.log(`part B: P_SHIELD + shielded G_FILL / G_CLS + P_UNSHIELD: ${total} runs (${singles} single boundaries, ${cls} G_CLS runs, the rest pairs) over ${NSCEN} scenarios; P_ISRMOVE refused ${refused} times so far; fails ${fails}`);
}

// Part C: P_MOVE from the main program while the ISR moves the pointer: never torn, drawn where PT says.
function partC() {
  let total = 0;
  for (let sc = 0; sc < 6; sc++) {
    setScene(); m.cpu.iff1 = m.cpu.iff2 = true;
    const tx = rng.int(0, 511), ty = rng.int(0, 191);
    direct('K_WARP', { hl: 200, de: 100 }); K.warp(200, 100); isr(NONE(), J.r, 'prep'); isr(NONE(), J.r, 'prep');
    const snap = snapshot(m), K0 = K.clone();
    setCall(m, S, S.P_MOVE, { hl: tx, de: ty }, true, rng); const N = runWith([], () => {});
    for (let i = 0; i < N; i++) for (let j = i; j < N; j++) {
      restore(m, snap); K = K0.clone();
      const ctx = `P_MOVE to (${tx}, ${ty}) irqs at ${i},${j}`;
      setCall(m, S, S.P_MOVE, { hl: tx, de: ty }, true, rng);
      runWith([i, j], (q) => isr(NONE(), q ? J.d : J.r, ctx));
      isr(NONE(), J.idle, ctx); isr(NONE(), J.idle, ctx);
      const pos = [r16(S.PT_X), m.ram[S.PT_Y]];
      if (!((pos[0] === tx && pos[1] === ty) || (pos[0] === K.px && pos[1] === K.py))) fail(`${ctx}: PT position (${pos}) is neither P_MOVE's nor the input's (${K.px}, ${K.py}): torn`);
      if (K.pend) fail(`${ctx}: pend left set`);
      checkDisplay(ctx, drawArrow(bg, arrow, pos[0], pos[1]));
      total++; runs++;
    }
    restore(m, snap); K = K0.clone();
  }
  console.log(`part C: P_MOVE against P_ISRMOVE, every pair of boundaries: ${total} runs; fails ${fails}`);
}

// ===========================================================================================================================
// Part D: a random main program (K_GETEV, K_POST, shield / fill / unshield) with interrupts at random boundaries and random input.
function partD() {
  setScene(); m.cpu.iff1 = m.cpu.iff2 = true;
  isr(NONE(), J.idle, 'D'); isr(NONE(), J.idle, 'D');
  let rows = NONE(), joy = J.idle, consumed = 0, posted = [], nIsr = 0, fills = 0, dispChecks = 0;
  const produced = [];                                // not used for order (the model's ring is the order); counts only
  const nextIsr = (ctx) => {
    if (rng.chance(0.3)) { const k = rng.chance(0.4) ? rng.pick([0, 36, 10, 5, 26, 25, 35]) : rng.int(0, 39); rows[(k / 5) | 0] ^= 1 << (k % 5); }
    if (rng.chance(0.05)) rows = NONE();
    if (rng.chance(0.3)) joy = rng.pick(Object.values(J));
    isr(rows.slice(), joy, ctx); nIsr++;
  };
  const withIrqs = (name, regs, ctx, pre) => {
    void regs; void pre;
    const N0 = name === 'G_FILL' ? 400 : name === 'P_SHIELD' ? 200 : 30;
    const inj = []; const k = rng.pick([0, 0, 1, 1, 2, 3]);
    for (let i = 0; i < k; i++) inj.push(rng.int(0, N0));
    inj.sort((a, b) => a - b);
    return inj;
  };
  for (let it = 0; it < NRAND && fails <= 15; it++) {
    const act = rng.next(), ctx = `random step ${it}`;
    if (act < 0.55) {
      const inj = withIrqs('K_GETEV', {}, ctx);
      const pn0 = m.ram[S.K_PN];
      const r = mainGetev(ctx, inj, inj.map(() => [rows.slice(), joy]));
      if (!r.carry) { consumed++; if (pn0 > 0) { const w = posted.shift(); if (!w || w.join() !== r.ev.join()) fail(`${ctx}: posted event ${r.ev}, expected ${w}`); } }
    } else if (act < 0.70) {
      const rec = [rng.int(6, 255), rng.int(0, 255), rng.int(0, 255), rng.int(0, 255)];
      const inj = withIrqs('K_POST', {}, ctx);
      const pn0 = m.ram[S.K_PN];
      mainPost(ctx, inj, inj.map(() => [rows.slice(), joy]), rec);
      if (pn0 < 4) posted.push(rec);
    } else if (act < 0.80) {
      nextIsr(ctx);
    } else {
      const w = rng.int(1, 60), h = rng.int(1, 12), x = rng.int(0, 512 - w), y = rng.int(0, 192 - h), op = rng.int(0, 2);
      const want = refFill(bg, [x, y, w, h], op);
      for (const name of ['P_SHIELD', 'G_FILL', 'P_UNSHIELD']) {
        setGA(x, y, w, h); m.ram[S.GOP] = op;
        const inj = withIrqs(name, {}, ctx);
        setCall(m, S, S[name], {}, true, rng);
        runWith(inj, () => nextIsr(`${ctx} in ${name}`), 6_000_000);
      }
      bg = want; fills++;
      if (rng.chance(0.5)) {
        const keepRows = rows, keepJoy = joy;
        settle(ctx); checkDisplay(ctx, drawArrow(bg, arrow, K.px, K.py)); dispChecks++;
        rows = keepRows; joy = keepJoy;
        // the settle frames were idle input: the model saw them too (releases), so the next real input is a fresh press
      }
    }
  }
  // final: drain, settle, compare
  let guard = 40; while (guard-- > 0 && !mainGetev('final drain', [], []).carry) consumed++;
  settle('final'); checkDisplay('final', drawArrow(bg, arrow, K.px, K.py));
  void produced;
  console.log(`part D: ${NRAND} random main-program steps, ${nIsr} interrupts at random boundaries, ${consumed} events consumed, ${fills} shielded fills, ${dispChecks} display comparisons; K_LOST ${m.ram[S.K_LOST]}; fails ${fails}`);
}

partA(); partA2(); partB(); partC(); partD();
console.log(`ISR stack: at most ${maxDepth} bytes with the return address (bound 32); longest ISR ${maxIsrT} T; ${isrs} interrupts in ${runs} runs`);
console.log(`review-inject seed ${seed}: ${fails} failure(s)`);
if (fails) process.exitCode = 1;
