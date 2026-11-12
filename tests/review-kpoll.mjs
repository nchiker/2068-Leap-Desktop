"use strict";
// review-kpoll.mjs -- independent review, question 2 and 3: K_POLL against 14.3 by direct calls (interrupts off), with the
// reviewer's model (review-lib.mjs).  node tests/review-kpoll.mjs [--seed N] [--steps N]
import { start, makeRng, setInput, setCall, runCall, regsOf, readKeymap, KModel, hex } from './review-lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const seed = arg('--seed', 1), STEPS = arg('--steps', 60000);
const rng = makeRng(seed);
const { m, S, img } = start();
// --mutate N: patch the cartridge image in the emulator's memory (never the sources) to show that the comparison can fail.
const MUT = arg('--mutate', 0);
const find = (from, bytes) => { let a = from; while (!bytes.every((b, i) => img[a + i] === b)) a++; return a; };
const poke = (addr, v) => { m.dock[addr >> 13][addr & 0x1FFF] = v; };
if (MUT === 1) poke(find(S['k_keys.held'], [0x36, 0x04]) + 1, 5);          // the repeat period 5 instead of 4
if (MUT === 2) poke(find(S['k_press.code'], [0xFE, 0x7B]) + 1, 0x7A);      // caps lock leaves 'z' lower case
if (MUT === 3) poke(find(S.k_dir, [0xFE, 0x1E]) + 1, 29);                  // hold stops at 29
if (MUT) console.log(`MUTATION ${MUT} applied: failures are expected`);
const keymap = readKeymap();
let K = new KModel(keymap);
let fails = 0, checks = 0, maxStack = 0, maxT = 0, maxWhat = '';
const KEEP = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];               // alternates, IX, IY
const fail = (msg) => { fails++; if (fails <= 12) console.log('FAIL: ' + msg); };

function callK(name, regs = {}) {
  setCall(m, S, S[name], regs, false, rng);
  const before = regsOf(m.cpu);
  const r = runCall(m, S);
  const after = regsOf(m.cpu);
  for (const i of KEEP) if (before[i] !== after[i]) fail(`${name}: register #${i} changed`);
  if (r.di) fail(`${name}: executed DI`);
  return { ...r, carry: m.cpu.f & 1, a: m.cpu.a };
}
const rowsText = (rows) => rows.map((r) => r.toString(16).padStart(2, '0')).join(' ');
function poll(rows, joy, lock, what = '') {
  setInput(m, rows, joy);
  m.ram[S.PT_LOCK] = lock ? 1 : 0;
  const r = callK('K_POLL');
  m.ram[S.PT_LOCK] = 0;
  K.log = [];
  K.poll(rows, joy, lock);
  checks++;
  if (r.stack > maxStack) maxStack = r.stack;
  if (r.t > maxT) { maxT = r.t; maxWhat = `${what} rows ${rowsText(rows)} joy ${hex(joy, 2)}`; }
  const d = K.diff(m, S, { pt: true, dirty: true });
  if (d) { fail(`K_POLL ${what} rows [${rowsText(rows)}] joy ${hex(joy, 2)}${lock ? ' locked' : ''}: ${d}; model events ${JSON.stringify(K.log)}`); return { ...r, bad: true }; }
  return r;
}
const NONE = () => new Uint8Array(8);
const withKeys = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
function drain() { for (;;) { const r = callK('K_GETEV'), g = K.getev(); if (r.carry !== g.carry) fail('K_GETEV carry'); if (r.carry) break; } }

// ---- part 1: every key x plane x caps lock, modifier first and modifier in the same frame; release order
function part1() {
  let n = 0;
  for (const caps of [0, 1]) {
    if (K.caps !== caps) { poll(withKeys(0), 0xFF, false, 'CS'); poll(withKeys(0, 16), 0xFF, false, 'CS+2'); poll(NONE(), 0xFF, false, 'up'); }
    for (const mods of [[], [0], [36], [0, 36]]) {
      for (const same of [false, true]) {
        for (let k = 1; k < 40; k++) {
          if (k === 36) continue;
          if (mods.length === 1 && mods[0] === 0 && k === 16) continue;          // CS+2 would flip caps lock: covered above
          if (mods.length === 2 && !same) continue;                              // CS+SS first would toggle the mode: part 2 covers it
          if (!same && mods.length) poll(withKeys(...mods), 0xFF, false, 'mods first');
          poll(withKeys(...mods, k), 0xFF, false, `key ${k} mods ${mods} caps ${caps}`);
          poll(withKeys(...mods, k), 0xFF, false, 'held');
          poll(withKeys(...mods), 0xFF, false, 'key up');
          poll(NONE(), 0xFF, false, 'all up');
          drain(); n++;
          if (K.kp) { fail('part 1 left keyboard-pointer mode on'); return; }
        }
      }
    }
  }
  console.log(`part 1: ${n} key cases (39 keys x plain/CS/SS/CS+SS x caps x modifier first/same frame), fails so far ${fails}`);
}

// ---- part 2: repeat timing, exactly: first repeat 30 frames after the press, then every 4; another key held does not take over
function part2() {
  drain();
  poll(withKeys(5), 0xFF, false, 'A down');           // frame n
  let frames = [];
  for (let f = 1; f <= 45; f++) { const t0 = K.tail; poll(withKeys(5), 0xFF, false, `A held ${f}`); if (K.tail !== t0) frames.push(f); }
  console.log(`part 2: repeats of a held key at frames n + [${frames.join(', ')}] (contract: 30, 34, 38, 42)`);
  if (frames.join() !== '30,34,38,42') fail('repeat frames');
  poll(withKeys(5, 6), 0xFF, false, 'S down too'); for (let f = 0; f < 3; f++) poll(withKeys(5, 6), 0xFF, false, 'both');
  poll(withKeys(5), 0xFF, false, 'S up: A must not take over'); for (let f = 0; f < 40; f++) poll(withKeys(5), 0xFF, false, 'A only');
  poll(NONE(), 0xFF, false, 'up'); drain();
  // the mode toggle, in each order of pressing, and with another key down
  for (const seq of [[[0], [0, 36]], [[36], [0, 36]], [[0, 36]], [[5], [0, 5], [0, 5, 36], [0, 36]], [[0, 36], [0], [0, 36]], [[0, 36], [0, 36, 5], [0, 36]]]) {
    for (const ks of seq) poll(withKeys(...ks), 0xFF, false, `toggle sequence ${JSON.stringify(seq)}`);
    poll(NONE(), 0xFF, false, 'up'); drain();
  }
  if (K.kp) { poll(withKeys(0, 36), 0xFF, false, 'mode off'); poll(NONE(), 0xFF, false, 'up'); drain(); }
}

// ---- part 3: random frames
const SPECIAL = [0, 36, 10, 5, 26, 25, 35, 16, 0, 36];
const JOYS = [0xFF, 0xFF, 0xFE, 0xFD, 0xFB, 0xF7, 0xFA, 0xF6, 0xF9, 0xF5, 0x7F, 0x7E, 0x77, 0x7B, 0x7D, 0xF0, 0x70, 0xFC, 0xF3, 0x8F, 0x0F, 0xF8, 0xF4, 0xF2, 0xF1];
function part3() {
  let rows = NONE(), joy = 0xFF, seg = 0, phase = 0, stats = { key: 0, move: 0, mode: 0, lostMax: 0, warp: 0, lock: 0, coal: 0, full: 0, kpFrames: 0, capsFrames: 0, repeats: 0 };
  for (let i = 0; i < STEPS && fails < 12; i++) {
    if (seg === 0) {
      seg = rng.pick([1, 1, 1, 1, 2, 2, 3, 4, 6, 31, 36, 45]);
      const kind = rng.next();
      if (kind < 0.12) rows = NONE();
      else if (kind < 0.20) rows = withKeys(0, 36);
      else if (kind < 0.24) rows = withKeys(rng.pick([0, 36]));
      else { const n = rng.pick([1, 1, 1, 2, 2, 3, 5]); for (let j = 0; j < n; j++) { const k = rng.chance(0.5) ? rng.pick(SPECIAL) : rng.int(0, 39); rows[(k / 5) | 0] ^= 1 << (k % 5); } }
      if (rng.chance(0.03)) phase = rng.int(0, 2);
    }
    seg--;
    if (rng.chance(0.25)) joy = rng.chance(0.85) ? rng.pick(JOYS) : rng.int(0, 255);
    if (rng.chance(0.04)) {
      const x = rng.pick([rng.int(0, 511), rng.int(-600, 1200), 0, 511, 6, 505, -32768, 32767]), y = rng.pick([rng.int(0, 191), rng.int(-300, 500), 0, 191, 3, 188, -1, 256, 32767]);
      const r = callK('K_WARP', { hl: x & 0xFFFF, de: y & 0xFFFF }); K.warp(x, y); stats.warp++; void r;
    }
    const lock = rng.chance(0.12); if (lock) stats.lock++;
    const t0 = K.tail, l0 = K.lost;
    const r = poll(rows.slice(), joy, lock, `step ${i}`);
    if (r.bad) break;
    for (const e of K.log) { if (e[0] === 1) stats.key++; if (e[0] === 2) stats.move++; if (e[0] === 9) stats.mode++; if (e[4]) stats.coal++; }
    if (K.lost > l0) stats.full++;
    if (K.kp) stats.kpFrames++; if (K.caps) stats.capsFrames++;
    for (const e of K.log) if (e[0] === 1 && (e[2] & 0x80)) stats.repeats++;
    if (K.lost > stats.lostMax) stats.lostMax = K.lost;
    void t0;
    const n = phase === 0 ? 20 : phase === 1 ? (rng.chance(0.3) ? 1 : 0) : (rng.chance(0.02) ? rng.int(1, 16) : 0);
    for (let j = 0; j < n; j++) {
      const g = callK('K_GETEV'), w = K.getev();
      if (g.carry !== w.carry || (!w.carry && g.a !== w.a)) { fail(`K_GETEV step ${i}: carry ${g.carry} A ${g.a}, model ${JSON.stringify(w)}`); break; }
      const d = K.diff(m, S, { pt: true }); if (d) { fail(`after K_GETEV step ${i}: ${d}`); break; }
      if (w.carry) break;
    }
    if (K.lost === 255 && rng.chance(0.01)) { m.ram[S.K_LOST] = 0; K.lost = 0; }
  }
  console.log(`part 3: ${STEPS} random K_POLL frames: ${JSON.stringify(stats)}`);
}

part1(); part2(); part3();
console.log(`K_POLL: stack at most ${maxStack} bytes below its return address (14.5: <= 20); longest call ${maxT} T (${maxWhat})`);
console.log(`review-kpoll seed ${seed}: ${checks} K_POLL calls compared, ${fails} failure(s)`);
if (fails) process.exitCode = 1;
