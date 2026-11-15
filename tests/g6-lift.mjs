"use strict";
// g6-lift.mjs -- G_LIFT in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/PAINT.md 22.2 and docs/ICON.md (G_LIFT is G_ICON's mirror): GA = x, y, w, h (screen pixels; x and w multiples of 8, w >= 8, h >= 1, the box wholly on the screen: no clipping), GA+8 = the destination:
// h rows of w / 8 bytes, bit 7 the leftmost pixel, 1 = ink, rows packed (the layout G_ICON reads); GA kept; clobbers AF, BC, DE, HL; scratch $E050-$E05C (G_PATFILL's / G_ICON's).  src/gfx6/lift.asm was used only to
// find names.  Tests/g6-icon.mjs is the pattern.
//   node tests/g6-lift.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random calls (default 700)
// Method: tk-lib's bootParked; each call is made from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_LIFT / ret`: KFAR to chunk 6).  The display is filled with random bytes; the destination (cold RAM $5800-$5EFF
// $5800-$5EFF or $7800-$7FFF, any offset, up to 2,048 bytes: the marquee's limit) is filled with random bytes too.  After every call: the destination equals the model's packed rows of the screen's pixels; the WHOLE 64 KB is compared
// with its state before the call (nothing else changed: not the display, not the stack window beyond its own pushes, not DOCK 6); mapping R at entry and for every access made from code in $C000-$DFFF; no write to
// $C000-$DFFF; G_LIFT's own stack <= 32 bytes (calls made with interrupts off); no DI (calls with interrupts on); GA kept; IY and the alternate set preserved; SP and the mapping ($33) restored.
// A round trip with G_ICON: lift a box, draw it elsewhere with G_ICON (clip the whole screen): the screen equals the model.  Timings: a 128 x 16 box and the marquee's 2,048-byte box.
// Exit code 1 on any failure.  The last line is "g6-lift: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 700);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random lift calls`);
const C = checks('g6-lift');
const rng = makeRng(SEED);
const STUB = 0x5F00, STUB2 = 0x5F08;
const STACK_BOUND = 32;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_LIFT', 'G_ICON', 'G6_END', 'GA', 'GOP', 'GCLIP', 'G_SETCLIP', 'K_FAR', 'V_SHADOW_F4']);
if (S.G_LIFT < 0xC000 || S.G_LIFT >= 0xE000) { C.check('G_LIFT is in chunk 6 ($C000-$DFFF)', false, hex(S.G_LIFT)); C.done(); process.exit(); }
C.check(`G_LIFT is in chunk 6 ($C000-$DFFF): ${hex(S.G_LIFT)}; G6_END ${hex(S.G6_END)}`, S.G6_END <= 0xE000 && S.G6_END > S.G_LIFT);

// the stubs: rst $28 / DW target / ret
for (const [st, tg] of [[STUB, S.G_LIFT], [STUB2, S.G_ICON]]) { m.ram[st] = 0xEF; m.ram[st + 1] = tg & 0xFF; m.ram[st + 2] = tg >> 8; m.ram[st + 3] = 0xC9; }
const dock6 = m.dock[6];
const dockCopy = Uint8Array.from(dock6);

// ---- watches ---------------------------------------------------------------------------------------------------------------------------------------
const watch = { armed: false, accR: 0, badMap: [], wrHeap: [], stackMin: 0xFFFF, track: false };
{
  const rd0 = m.bus.read, wr0 = m.bus.write;
  const note = (addr, isWrite) => {
    if (!watch.armed) return;
    const pc = m.cpu.pc;
    if (pc >= 0xC000 && pc < 0xE000) {
      watch.accR++;
      if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) { if (watch.badMap.length < 4) watch.badMap.push(`PC ${hex(pc)} accessed ${hex(addr)} with port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); }
    }
    if (isWrite && addr >= 0xC000 && addr < 0xE000 && watch.wrHeap.length < 8) watch.wrHeap.push(`${hex(addr)} written by PC ${hex(pc)} under ${hex(m.portF4, 2)}`);
    if (isWrite && watch.track && addr >= 0xFE00 && addr < 0xFF00 && addr < watch.stackMin) watch.stackMin = addr;
  };
  m.bus.read = function (addr) { note(addr & 0xFFFF, false); return rd0(addr); };
  m.bus.write = function (addr, v) { note(addr & 0xFFFF, true); wr0(addr, v); };
}
const entry = { n: 0, bad: [], sp: 0 };      // the mapping at G_LIFT's first instruction
const hooks = { [S.G_LIFT]: () => { entry.n++; entry.sp = m.cpu.sp; watch.track = true; watch.stackMin = 0xFFFF; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const seedDisplay = () => { for (let a = 0x4000; a < 0x5800; a++) m.ram[a] = rng.int(0, 255); for (let a = 0x6000; a < 0x7800; a++) m.ram[a] = rng.int(0, 255); };
const fillCold = () => { for (let a = 0x5800; a < 0x5F00; a++) m.ram[a] = rng.int(0, 255); for (let a = 0x7800; a < 0x8000; a++) m.ram[a] = rng.int(0, 255); };
const setGA = (...w) => w.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
const scr = new G.Gfx6Model();
const resync = () => { seedDisplay(); fillCold(); scr.loadRam(m.ram); };
function setClip(x, y, w, h) { setGA(x, y, w, h); T.runCall(env, S.G_SETCLIP, {}, { ints: false }); scr.setClip(x, y, w, h); }

/** The reference: byte k * (w / 8) + j of the destination = the 8 pixels (x + 8 j .. x + 8 j + 7, y + k) of the screen, the leftmost in bit 7 (1 = ink).  Returns the bytes. */
function liftModel(g, x, y, w, h) {
  const wb = w >> 3, out = new Uint8Array(wb * h);
  for (let k = 0; k < h; k++) for (let j = 0; j < wb; j++) { let v = 0; for (let b = 0; b < 8; b++) v = (v << 1) | g.px[(y + k) * G.SCR_W + x + 8 * j + b]; out[k * wb + j] = v; }
  return out;
}

const MAYBASE = (a) => (a >= 0xE050 && a < 0xE05D) || (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);       // G_LIFT's scratch, the stack window, KFAR's cells
const stats = { calls: 0, bad: 0, first: '', stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, cases: {}, bytes: 0, degenerate: 0, gaBad: 0, intsOn: 0, dests: {}, stackN: 0, lastT: 0 };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };

/** One checked call: G_LIFT through KFAR from the stub; the destination against the model, the whole 64 KB against its state before (only the destination and the scratch / stack cells may change), the side checks. */
function lift(x, y, w, h, dst, tag = 'random', intsOn = false) {
  const desc = `(${x}, ${y}, ${w}, ${h}) -> ${hex(dst)}`;
  setGA(x, y, w, h, dst);
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  const ga = Array.from(m.ram.subarray(S.GA, S.GA + 10)), oc = Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));
  const degenerate = w < 8 || h < 1;
  const want = degenerate ? new Uint8Array(0) : liftModel(scr, x, y, w, h);
  watch.armed = true; watch.track = false;
  let r;
  try { r = T.runCall(env, STUB, {}, { ints: intsOn, hooks, guard: 6_000_000 }); }
  catch (e) { watch.armed = false; watch.track = false; fail(`${tag} ${desc}: ${e.message}`); return false; }
  watch.armed = false; const tracked = watch.track; watch.track = false;
  stats.calls++; stats.cases[tag] = (stats.cases[tag] || 0) + 1; stats.bytes += want.length; if (degenerate) stats.degenerate++;
  const dk = dst >= 0x7800 ? 'cold $7800-$7FFF' : 'cold $5800-$5EFF'; stats.dests[dk] = (stats.dests[dk] || 0) + 1;
  if (intsOn) stats.intsOn++;
  let ok = true;
  const got = m.ram.subarray(dst, dst + want.length), k = want.findIndex((v, i) => got[i] !== v);
  if (k >= 0) { ok = false; fail(`${tag} lift ${desc}: destination byte ${k} (row ${Math.floor(k / (w >> 3))}, column ${k % (w >> 3)}) is ${hex(got[k], 2)}, model ${hex(want[k], 2)}`); }
  if (!intsOn && tracked) {            // G_LIFT's own pushes: the lowest stack address written after its first instruction
    const depth = watch.stackMin === 0xFFFF ? 0 : Math.max(0, entry.sp - watch.stackMin);
    stats.stackN++; if (depth > stats.stackMax) stats.stackMax = depth;
    if (depth > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} lift ${desc}: G_LIFT's stack ${depth} bytes > ${STACK_BOUND}`); }
  }
  if (r.di) { stats.di++; ok = false; fail(`${tag} lift ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} lift ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} lift ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GA, S.GA + 10)).join() !== ga.join() || Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8)).join() !== oc.join()) { stats.gaBad++; ok = false; fail(`${tag} lift ${desc}: GA / GOP / GCLIP changed`); }
  if (r.sp !== 0xFF00) { ok = false; fail(`${tag} lift ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  const d0 = dst, d1 = dst + want.length;
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAYBASE(a) && !(a >= d0 && a < d1)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} lift ${desc}: RAM outside the destination, the scratch and the stack changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  scr.loadRam(m.ram);            // the display is unchanged (checked above); the model re-reads it (an interrupt's pointer, if any)
  stats.lastT = r.t;
  return ok;
}

/** A random destination for `size` bytes: cold RAM $5800-$5EFF (the stubs are at $5F00) or $7800-$7FFF, at the start, at the very end, or anywhere. */
function pickDest(size) {
  const opts = [[0x5800, 0x700], [0x7800, 0x800]].filter(([, cap]) => size <= cap);
  if (!opts.length) return null;
  const [base, cap] = rng.pick(opts);
  return base + rng.pick([0, 0, cap - size, rng.int(0, cap - size)]);
}
function randCall() {
  for (;;) {
    const q = rng.next();
    let wb, h;
    if (q < 0.25) { wb = rng.int(1, 6); h = rng.int(1, 40); }
    else if (q < 0.4) { wb = rng.pick([2, 4]); h = rng.pick([16, 16, 8, 15, 17]); }
    else if (q < 0.7) { wb = rng.int(1, 64); h = rng.int(1, 32); }
    else if (q < 0.85) { wb = rng.int(1, 24); h = rng.int(1, 192); }
    else { wb = rng.pick([1, 8, 16, 32, 64]); h = rng.pick([1, 2, 3, 8, 16, 31]); }
    const size = wb * h, dst = pickDest(size);
    if (dst === null) continue;
    const t = rng.next();
    let c0, y;
    if (t < 0.5) { c0 = rng.int(0, 64 - wb); y = rng.int(0, 192 - h); }
    else if (t < 0.65) { c0 = rng.pick([0, 64 - wb]); y = rng.int(0, 192 - h); }                    // against the left / right edge
    else if (t < 0.8) { c0 = rng.int(0, 64 - wb); y = rng.pick([0, 192 - h, 63 - (h >> 1), 64 - (h >> 1), 127 - (h >> 1), 128 - (h >> 1)]); }   // against the top / bottom, across the thirds
    else { c0 = rng.pick([1, 3, 5, 63 - wb, 62 - wb, 2, 4]); y = rng.int(0, 192 - h); }
    c0 = Math.max(0, Math.min(64 - wb, c0)); y = Math.max(0, Math.min(192 - h, y));
    return [8 * c0, y, 8 * wb, h, dst];
  }
}

// ---- 1. random calls ---------------------------------------------------------------------------------------------------------------------------------
resync(); setClip(0, 0, 512, 192);
for (let i = 0; i < N; i++) {
  if (i % 20 === 0) resync();
  const [x, y, w, h, dst] = randCall();
  // a bit of everything: the destination is refilled with random bytes before each call (a byte the call does not write stays as it was: the whole-memory comparison)
  if (i % 5 === 0) fillCold();
  lift(x, y, w, h, dst, 'random', rng.chance(0.4) && (w >> 3) * h <= 300);
}
// ---- 2. edge cases -------------------------------------------------------------------------------------------------------------------------------------
{
  const EDGES = [[0, 0, 8, 1], [504, 191, 8, 1], [0, 0, 8, 192], [504, 0, 8, 192], [0, 0, 512, 1], [0, 191, 512, 1], [0, 0, 512, 4], [8, 10, 8, 1], [16, 10, 8, 1], [8, 10, 16, 1], [16, 10, 16, 1], [8, 10, 24, 3], [504, 100, 8, 5], [496, 100, 16, 5],
    [248, 62, 16, 4], [248, 126, 16, 4], [248, 63, 8, 2], [256, 127, 8, 2], [0, 189, 24, 3], [128, 32, 128, 16], [128, 32, 320, 6], [0, 0, 8, 128], [24, 64, 16, 128], [8, 0, 24, 64], [0, 0, 128, 16]];
  let i = 0;
  for (const [x, y, w, h] of EDGES) {
    if (i++ % 4 === 0) resync();
    const size = (w >> 3) * h; if (size > 0x800) continue;
    lift(x, y, w, h, 0x7800, 'edge-start'); lift(x, y, w, h, 0x8000 - size, 'edge-end', i % 3 === 0 && size <= 300); if (size <= 0x700) { lift(x, y, w, h, 0x5800, 'edge-start'); lift(x, y, w, h, 0x5F00 - size, 'edge-end'); }
  }
}
// a destination that is a part of the lifted box's own rows is not tested (the display is not a legal destination: the contract says cold RAM or anywhere visible under R)
// the whole 2,048-byte limit boxes of the marquee: 16 x 128 and 32 x 64 bytes x rows, even and odd first columns, at both destinations
for (const [wb, h] of [[16, 128], [32, 64], [8, 144], [40, 51], [1, 144], [2, 144], [17, 120]]) {
  for (const c0 of [0, 1, 4, 5, 64 - wb]) {
    if (c0 < 0 || c0 + wb > 64 || wb * h > 0x800) continue;
    resync(); lift(8 * c0, rng.int(0, 192 - h), 8 * wb, h, 0x7800 + rng.pick([0, 0x800 - wb * h]), 'limit');
  }
}
// degenerate calls: a zero width or a zero height writes nothing (the code returns at once; the contract says w >= 8, h >= 1)
resync();
lift(64, 20, 0, 8, 0x7800, 'degenerate'); lift(64, 20, 8, 0, 0x7800, 'degenerate'); lift(64, 20, 7, 8, 0x7800, 'degenerate');
// all-ink and all-paper screens: the packed bytes are $FF / $00; the lifted rows then match the model exactly
for (const v of [0x00, 0xFF, 0xAA, 0x55, 0x01, 0x80]) {
  for (let a = 0x4000; a < 0x5800; a++) m.ram[a] = v; for (let a = 0x6000; a < 0x7800; a++) m.ram[a] = v ^ (v === 0xAA ? 0xFF : 0); scr.loadRam(m.ram);
  fillCold(); lift(40, 30, 64, 20, 0x7800, 'solid'); lift(8, 100, 24, 9, 0x5800, 'solid');
}

// ---- 3. a round trip with G_ICON: lift a box into cold RAM, draw it elsewhere (clip the whole screen): the screen is the model's -----------------------------------
const trip = { n: 0, bad: 0, first: '' };
{
  const iconT = [];
  resync(); setClip(0, 0, 512, 192);
  for (let i = 0; i < 60; i++) {
    if (i % 6 === 0) resync();
    const wb = i < 10 ? rng.pick([2, 4, 16, 40]) : rng.int(1, 40), h = i < 10 ? rng.pick([16, 16, 30, 51]) : rng.int(1, Math.min(144, Math.floor(2048 / wb)));
    const x0 = 8 * rng.int(0, 64 - wb), y0 = rng.int(0, 192 - h), x1 = 8 * rng.int(0, 64 - wb), y1 = rng.int(0, 192 - h), dst = pickDest(wb * h);
    const nb = stats.bad;
    if (!lift(x0, y0, 8 * wb, h, dst, 'trip', false) || stats.bad > nb) { trip.bad++; trip.first ||= stats.first; continue; }
    // G_ICON at the destination: the model is the lifted pixels placed at (x1, y1) (the source may overlap: G_ICON reads the bitmap from cold RAM, so the source's own pixels are already copied)
    const bmp = Uint8Array.from(m.ram.subarray(dst, dst + wb * h));
    const g = scr;
    for (let k = 0; k < h; k++) for (let j = 0; j < 8 * wb; j++) g.px[(y1 + k) * G.SCR_W + x1 + j] = (bmp[k * wb + (j >> 3)] >> (7 - (j & 7))) & 1;
    setGA(x1, y1, 8 * wb, h, dst);
    const r = T.runCall(env, STUB2, {}, { ints: false, guard: 6_000_000 });
    const d = g.compareRam(m.ram);
    trip.n++; iconT.push(r.t);
    if (d || r.di || r.preserved.length) { trip.bad++; trip.first ||= `lift (${x0}, ${y0}, ${8 * wb}, ${h}) then G_ICON at (${x1}, ${y1}): ${d ? G.fmtDiff(d) : r.preserved.join(',')}`; g.loadRam(m.ram); }
    // lifting the drawn copy again: the model (the screen now holds the box at (x1, y1)) judges that lift too
    fillCold();
    const nb2 = stats.bad;
    lift(x1, y1, 8 * wb, h, pickDest(wb * h), 'trip-back', false);
    if (stats.bad > nb2) { trip.bad++; trip.first ||= stats.first; }
  }
}

// ---- 4. timings: a 128 x 16 box (256 bytes), the marquee's 2,048-byte boxes, a 1 x 1 byte; interrupts off ----------------------------------------------------------
const timing = {};
{
  setClip(0, 0, 512, 192);
  for (const [name, x, y, w, h, dst] of [['128 x 16 box (256 bytes, 16 byte columns x 16 rows) at an even column', 128, 32, 128, 16, 0x7800], ['128 x 16 box at an odd column (x = 136)', 136, 32, 128, 16, 0x7800], ['16 x 128 bytes x rows (2,048 bytes, the marquee\'s limit)', 32, 5, 128, 128, 0x7800],
    ['32 x 64 bytes x rows (2,048 bytes)', 16, 20, 256, 64, 0x7800], ['one byte (8 x 1)', 64, 20, 8, 1, 0x7800], ['32 x 16 icon-sized box (64 bytes)', 128, 32, 32, 16, 0x5800]]) {
    resync(); lift(x, y, w, h, dst, 'timing', false);
    timing[name] = stats.lastT;
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------------
const pre = { wr: watch.wrHeap.slice() };
const cs = stats.cases, nCases = Object.values(cs).reduce((a, b) => a + b, 0);
C.check(`destination after every call equals the model's packed screen rows, and nothing else in the 64 KB changed: ${stats.calls} calls compared (${Object.entries(cs).map(([k, v]) => `${k} ${v}`).join(', ')}; destinations ${Object.entries(stats.dests).map(([k, v]) => `${k} ${v}`).join(', ')}; ${stats.bytes} bytes lifted, ${stats.degenerate} degenerate calls writing nothing; ${stats.intsOn} with interrupts on)`,
  stats.bad === 0 && stats.calls === nCases && stats.calls >= N, stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check(`round trip with G_ICON: ${trip.n} lifts drawn elsewhere by G_ICON equal the model (and lifting the drawn copy gives the same bytes): ${trip.bad} wrong`, trip.n >= 50 && trip.bad === 0, trip.first);
C.check(`G_LIFT ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.calls && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls (DOCK 6 is unchanged)', pre.wr.length === 0 && dock6.every((v, i) => v === dockCopy[i]), pre.wr.join(' | '));
C.check('GA (x, y, w, h, destination pointer), GOP and GCLIP kept by every call', stats.gaBad === 0);
C.check('no RAM written outside the destination, the scratch $E050-$E05C, the stack window and KFAR\'s cells (whole 64 KB compared after every call; the display is read only)', stats.outside === 0, stats.outsideFirst);
C.check(`G_LIFT's own stack <= ${STACK_BOUND} bytes (lowest stack address written after its first instruction, ${stats.stackN} calls with interrupts off): max ${stats.stackMax}`, stats.stackN > 0 && stats.stackBad === 0);
C.check('no DI executed (calls with interrupts on), IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0 && stats.intsOn > 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run): ${env.w.summary()}`, env.w.n === 0);
for (const [k, v] of Object.entries(timing)) console.log(`  ${k}: ${v} T (through KFAR, about 350 T of it)`);
C.done();
