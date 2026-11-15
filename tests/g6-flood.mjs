"use strict";
// g6-flood.mjs -- G_FLOOD in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/PAINT.md 21 (the contract: GA = x, y (the seed) and GA+8 = the pattern pointer; the region = the 4-connected set of pixels equal to the seed's pixel inside GCLIP; the region's pixels are
// replaced by the pattern (REPLACE); the seed outside the clip changes nothing; carry clear = complete, carry SET = overflow when the region has more than 204 maximal horizontal runs ('spans') and the
// pattern is not the one-pass fast path (every byte of the pattern is the colour opposite to the target: all $FF over paper, all $00 over ink), or when the seed stack passes 256 entries; after a
// complete fill the region's box is in FL_BX0 / FL_BX1 (words) and FL_BY0 / FL_BY1 (bytes)), with PAINT 16 (G_PATFILL's pattern table and the pattern anchoring), docs/BANKING.md (KFAR, the mappings)
// and tests/g6-patfill.mjs (the method).  src/gfx6/flood.asm was not used; only the symbol names of build/desk5/out.sym.
//   node tests/g6-flood.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random scenes per family (default 12; the machine's fills are slow to step)
// Method: tk-lib's bootParked; each fill is called from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_FLOOD / ret`: KFAR to chunk 6) with random registers; the picture is built in a Gfx6Model
// and stored into the display files, the clip set by G_SETCLIP; the model (tests/gfx6-model.mjs Gfx6Model.floodFill) gives the expected screen, the carry and the box.  The cold RAM $7800-$7FFF (the span
// list and the seed stack) and the hot state $E0D0-$E0E7 are filled with random bytes before every call.  Also: mapping R at entry and for every access made from code in $C000-$DFFF; no write to
// $C000-$DFFF; no RAM outside the display files, GA, GOP, the hot scratch $E01A-$E07F, $E0D0-$E0E7, the cold RAM $7800-$7FFF and the stack window changed; GCLIP kept; the stack <= 128 bytes; no DI; IX, IY and
// the alternate set kept; the mapping back to K; on an overflow the pixels outside the region are as they were ("the boundary is never touched").
// Exit code 1 on any failure.  The last line is "g6-flood: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';
import { M, Z } from './lib.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 12);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random scenes a family`);
const C = checks('g6-flood');
const rng = makeRng(SEED);
const STUB = 0x5F00;
const STACK_BOUND = 128;
const SPAN_MAX = 204, STK_MAX = 256;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_FLOOD', 'PATTAB', 'GA', 'GOP', 'GCLIP', 'G_SETCLIP', 'K_FAR', 'K_FJP', 'V_SHADOW_F4', 'V_FRAMES', 'FL_BX0', 'FL_BX1', 'FL_BY0', 'FL_BY1', 'FL_FAST', 'FL_LIST', 'FL_LEND', 'FL_STK']);
if (S.G_FLOOD < 0xC000 || S.G_FLOOD >= 0xE000) { C.check('G_FLOOD is in chunk 6 ($C000-$DFFF)', false, hex(S.G_FLOOD)); C.done(); process.exit(); }
C.check(`G_FLOOD is in chunk 6 ($C000-$DFFF): ${hex(S.G_FLOOD)}; PATTAB ${hex(S.PATTAB)}; FL_BX0 ${hex(S.FL_BX0)}, FL_BX1 ${hex(S.FL_BX1)}, FL_BY0 ${hex(S.FL_BY0)}, FL_BY1 ${hex(S.FL_BY1)}, FL_FAST ${hex(S.FL_FAST)}`, true);

// the pattern table as the cartridge holds it (DOCK chunk 6 at offset PATTAB - $C000)
const dock6 = m.dock[6], PT0 = S.PATTAB - 0xC000;
const tab = Array.from({ length: 128 }, (_, i) => dock6[PT0 + i]);
const patAt = (off) => tab.slice(off, off + 8);
const SOLID = 0, WHITE = 120, CHECK = 16;                 // PATTAB offsets of pattern 0 (all $FF), 15 (all $00), 2 (50 % checker)
C.check('PATTAB: pattern 0 is all $FF, pattern 15 all $00, pattern 2 the 50 % checker', patAt(SOLID).every((v) => v === 255) && patAt(WHITE).every((v) => v === 0) && patAt(CHECK).join() === '170,85,170,85,170,85,170,85');

// the stub: rst $28 / DW G_FLOOD / ret
m.ram[STUB] = 0xEF; m.ram[STUB + 1] = S.G_FLOOD & 0xFF; m.ram[STUB + 2] = S.G_FLOOD >> 8; m.ram[STUB + 3] = 0xC9;

// ---- watches -----------------------------------------------------------------------------------------------------------------------------------------
const watch = { armed: false, accR: 0, badMap: [], wrHeap: [], spanTop: 0, stkLow: 0x8000 };
{
  const rd0 = m.bus.read, wr0 = m.bus.write;
  const note = (addr, isWrite) => {
    if (!watch.armed) return;
    const pc = m.cpu.pc;
    if (pc >= 0xC000 && pc < 0xE000) {
      watch.accR++;
      if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) { if (watch.badMap.length < 4) watch.badMap.push(`PC ${hex(pc)} accessed ${hex(addr)} with port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); }
    }
    if (isWrite) {
      if (addr >= 0xC000 && addr < 0xE000 && watch.wrHeap.length < 8) watch.wrHeap.push(`${hex(addr)} written by PC ${hex(pc)} under ${hex(m.portF4, 2)}`);
      if (addr >= S.FL_LIST && addr < S.FL_LEND && addr > watch.spanTop) watch.spanTop = addr;
      if (addr >= S.FL_LEND && addr < S.FL_STK && addr < watch.stkLow) watch.stkLow = addr;
    }
  };
  m.bus.read = function (addr) { note(addr & 0xFFFF, false); return rd0(addr); };
  m.bus.write = function (addr, v) { note(addr & 0xFFFF, true); wr0(addr, v); };
}
const entry = { n: 0, bad: [] };
const hooks = { [S.G_FLOOD]: () => { entry.n++; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const setGA = (...w) => w.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
const scr = new G.Gfx6Model();
const px = scr.px, W = G.SCR_W, H = G.SCR_H;
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1})x[${scr.clip.y0},${scr.clip.y1})`;
let setupBad = 0, setupFirst = '';
function setClip(x, y, w, h) {
  setGA(x, y, w, h);
  T.runCall(env, S.G_SETCLIP, {}, { ints: false });
  scr.setClip(x, y, w, h);
  const c = [0, 1, 2, 3].map((i) => L.rd16(m, S.GCLIP + 2 * i));
  const want = [scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1];
  if (scr.clipEmpty() ? (c[0] < c[1] && c[2] < c[3]) : c.join() !== want.join()) { setupBad++; setupFirst ||= `GCLIP ${c} after G_SETCLIP(${x}, ${y}, ${w}, ${h}), want ${want}`; }
}
const store = () => { scr.storeRam(m.ram); };                // the model's picture into the display files
// drawing helpers on the model's pixels
const fillPx = (v) => px.fill(v);
const rectPx = (x, y, w, h, v) => { for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) px[yy * W + xx] = v; };
const setPx = (x, y, v) => { if (x >= 0 && x < W && y >= 0 && y < H) px[y * W + x] = v; };
const noisePx = (x, y, w, h, d) => { for (let yy = Math.max(0, y); yy < Math.min(H, y + h); yy++) for (let xx = Math.max(0, x); xx < Math.min(W, x + w); xx++) px[yy * W + xx] = rng.next() < d ? 1 : 0; };
const drawOn = (f) => { const c0 = scr.clip, o0 = scr.op; scr.clip = { x0: 0, x1: W, y0: 0, y1: H }; scr.setOp(G.OP_SET); f(); scr.clip = c0; scr.setOp(o0); };   // model drawing ignoring the flood clip
const colourAt = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? px[y * W + x] : 0);

const MAY = (a) => (a >= 0xE000 && a < 0xE011) || (a >= 0xE01A && a < 0xE080) || (a >= 0xE0D0 && a < 0xE0E8) || (a >= 0xE700 && a < 0xE800) || (a >= 0x4000 && a < 0x5800) || (a >= 0x6000 && a < 0x7800) ||
  (a >= 0x7800 && a < 0x8000) || (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);
const stats = { calls: 0, bad: 0, first: '', stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, tMax: 0, tMaxDesc: '', cases: {}, gaBad: 0, clipBad: 0,
  complete: 0, overflow: 0, offClip: 0, fastDone: 0, slowDone: 0, spansMax: 0, spansMaxDone: 0, stkEntriesMax: 0, listMax: 0, stackOverflows: [], stackLegit: 0, stackLegitFast: [], stackLegitSlow: [], carryBad: 0, boxBad: 0, goBad: 0, bndBad: 0, gopChanged: 0, regionMax: 0 };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };
const ptrOf = (off) => S.PATTAB + off;
const hx2 = (v) => hex(v, 2).slice(1);
let lastGOP = 0;
function stk(r) { return { stkEntries: r }; }

/**
 * One checked flood: G_FLOOD through KFAR from the stub, the screen against the model, the carry and the box, and the side checks.  The picture has been built in `scr` (and stored); the clip is set.
 * `off` = the pattern's offset in PATTAB.  o.expectStack: 'ok' | 'over' for the seed-stack probes (the model cannot predict them): the carry is then checked against that expectation.
 */
function flood(x, y, off, tag, o = {}) {
  const pat = patAt(off);
  const desc = `seed (${x}, ${y}) pattern PATTAB+${off} [${pat.map(hx2).join(' ')}] clip ${clipStr()}`;
  setGA(x, y, 0, 0, ptrOf(off));
  for (let a = 0x7800; a < 0x8000; a++) m.ram[a] = rng.byte();
  for (let a = 0xE0D0; a < 0xE0E8; a++) m.ram[a] = rng.byte();
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  const px0 = px.slice();
  const ga = Array.from(m.ram.subarray(S.GA, S.GA + 10)), gclip = Array.from(m.ram.subarray(S.GCLIP, S.GCLIP + 8)), gop = m.ram[S.GOP];
  const mr = scr.floodFill(x, y, pat);                 // the model (changes `px` only on a complete fill)
  watch.armed = true; watch.spanTop = 0; watch.stkLow = 0x8000;
  let r;
  try { r = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 60_000_000 }); }
  catch (e) { watch.armed = false; fail(`${tag} ${desc}: ${e.message}`); scr.loadRam(m.ram); return null; }
  watch.armed = false;
  stats.calls++; stats.cases[tag] = (stats.cases[tag] || 0) + 1;
  const carry = r.carry;
  const stkEntries = (S.FL_STK - watch.stkLow) / 4, listN = watch.spanTop ? Math.ceil((watch.spanTop - S.FL_LIST + 1) / 5) : 0;
  if (stkEntries > stats.stkEntriesMax) stats.stkEntriesMax = stkEntries;
  if (listN > stats.listMax) stats.listMax = listN;
  let ok = true;
  // ---- the expected outcome ----
  let wantCarry, why;
  if (!mr.inClip) { wantCarry = 0; why = 'seed outside the clip'; }
  else if (o.expectStack) { wantCarry = o.expectStack === 'over' ? 1 : 0; why = `seed-stack probe (${o.expectStack})`; }
  else if (mr.overflow) { wantCarry = 1; why = `${mr.spans} spans > ${SPAN_MAX} and the pattern is not the one-pass fast path`; }
  else { wantCarry = 0; why = `${mr.spans} spans, ${mr.fast ? 'one-pass fast path' : 'two-pass'}`; }
  if (mr.inClip) { if (mr.spans > stats.spansMax) stats.spansMax = mr.spans; if (mr.n > stats.regionMax) stats.regionMax = mr.n; }
  const legit = carry === 1 && wantCarry === 0 && mr.inClip && !o.expectStack && stkEntries >= STK_MAX && mr.pushBound > STK_MAX;   // the seed stack passed 256 entries (PAINT 21): allowed, counted
  if (legit) { stats.stackLegit++; (mr.fast ? stats.stackLegitFast : stats.stackLegitSlow).push(`${tag} ${desc}: ${mr.spans} spans, ${mr.n} px, up to ${mr.pushBound} pushes`); }
  else if (carry !== wantCarry) {
    ok = false; stats.carryBad++;
    const stackHint = (wantCarry === 0 && carry === 1 && mr.fast) ? ` (a fast fill: the machine's seed stack reached ${stkEntries} entries; the contract says overflow only past ${STK_MAX})` : '';
    fail(`${tag} ${desc}: carry ${carry}, expected ${wantCarry} (${why}); model: region ${mr.n} px, ${mr.spans} spans, fast ${mr.fast}${stackHint}`);
  }
  if (carry === 1 && mr.inClip) {
    // the machine overflowed (rightly or not): the display is partly changed; the pixels outside the region are as they were; the model's screen is reloaded from the machine
    stats.overflow++;
    scr.px.set(px0);
    const got = G.Gfx6Model.fromRam(m.ram);
    let bad = -1;
    for (let i = 0; i < got.px.length; i++) if (!mr.mask[i] && got.px[i] !== px0[i]) { bad = i; break; }
    if (bad >= 0) { ok = false; stats.bndBad++; fail(`${tag} ${desc}: overflow left a pixel outside the region changed: (${bad % W}, ${(bad / W) | 0}) was ${px0[bad]}, now ${got.px[bad]}`); }
    scr.px.set(got.px);
  } else if (mr.inClip && carry === 0 && wantCarry === 0) {
    stats.complete++;
    if (mr.fast) stats.fastDone++; else stats.slowDone++;
    if (mr.spans > stats.spansMaxDone) stats.spansMaxDone = mr.spans;
    const d = scr.compareRam(m.ram);
    if (d) {
      ok = false;
      fail(`${tag} fill ${desc}: ${G.fmtDiff(d)} (region ${mr.n} px, ${mr.spans} spans, fast ${mr.fast})`);
      scr.loadRam(m.ram);
    }
    const bx = [L.rd16(m, S.FL_BX0), L.rd16(m, S.FL_BX1), m.ram[S.FL_BY0], m.ram[S.FL_BY1]], wb = [mr.box.x0, mr.box.x1, mr.box.y0, mr.box.y1];
    if (bx.join() !== wb.join()) { ok = false; stats.boxBad++; fail(`${tag} ${desc}: box (FL_BX0, FL_BX1, FL_BY0, FL_BY1) = ${bx}, the region's bounding box is ${wb} (${mr.n} px, ${mr.spans} spans)`); }
    const wf = mr.fast ? 1 : 0;
    // FL_FAST is documented in 21 as the state; compared as a note only (a hot-RAM variable)
    if (m.ram[S.FL_FAST] !== wf) stats.flFast = (stats.flFast || 0) + 1;
  } else if (!mr.inClip) {
    stats.offClip++;
    const d = scr.compareRam(m.ram);
    if (d) { ok = false; fail(`${tag} ${desc}: the seed is outside the clip but the display changed: ${G.fmtDiff(d)}`); scr.loadRam(m.ram); }
  } else {
    // carry != expectation: resync the model from the machine so the next case is not poisoned
    scr.loadRam(m.ram);
  }
  if (mr.inClip && carry === 0 && wantCarry === 0 && o.expectStack === 'ok') { /* counted above */ }
  if (r.stack > stats.stackMax) stats.stackMax = r.stack;
  if (r.stack > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} fill ${desc}: stack ${r.stack} bytes > ${STACK_BOUND}`); }
  if (r.di) { stats.di++; ok = false; fail(`${tag} fill ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} fill ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} fill ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GCLIP, S.GCLIP + 8)).join() !== gclip.join()) { stats.clipBad++; ok = false; fail(`${tag} fill ${desc}: GCLIP changed`); }
  if (m.ram[S.GOP] !== gop) stats.gopChanged++;
  if (r.sp !== 0xFF00) { ok = false; fail(`${tag} fill ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAY(a)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} fill ${desc}: RAM outside the allowed areas changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  void ga; void lastGOP;
  if (r.t > stats.tMax) { stats.tMax = r.t; stats.tMaxDesc = `${tag}: ${desc}, ${mr.inClip ? `${mr.n} px, ${mr.spans} spans, carry ${carry}` : 'seed outside'}`; }
  stats.lastT = r.t; stats.lastCarry = carry; stats.lastModel = mr; stats.lastStk = stkEntries; stats.lastList = listN;
  return { ok, t: r.t, carry, mr, stkEntries, listN };
}

// ---- scene builders: each builds the model picture (and stores it); the clip is set by the caller -------------------------------------------------------
const FAST_FOR = (colour) => (colour ? WHITE : SOLID);          // over ink: the white pattern; over paper: the solid ink pattern
const pickOff = (colour) => { const k = rng.next(); if (k < 0.4) return FAST_FOR(colour); if (k < 0.5) return rng.chance(0.5) ? SOLID : WHITE; if (k < 0.55) return rng.int(0, 120); return 8 * rng.int(0, 15); };
const randClip = () => {
  const k = rng.next();
  if (k < 0.2) return [0, 0, 512, 192];
  if (k < 0.35) return [128, 32, 320, 144];
  if (k < 0.4) return [-40, -40, 700, 400];
  if (k < 0.47) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0], [rng.int(512, 900), rng.int(0, 190), 30, 30],
    [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)], [rng.int(0, 500), rng.int(0, 190), 1, rng.int(1, 100)], [rng.int(0, 400), rng.int(0, 190), rng.int(1, 100), 1]]);
  if (k < 0.6) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];
  if (k < 0.85) return [rng.int(-20, 400), rng.int(-10, 150), rng.int(1, 200), rng.int(1, 60)];
  return [rng.int(-20, 300), rng.int(-10, 100), rng.int(1, 560), rng.int(1, 210)];
};
/** A seed of the colour `want` (0 paper, 1 ink, null any) inside the clip when the clip has one; else anywhere on the screen. */
function pickSeed(want) {
  const c = scr.clip;
  if (scr.clipEmpty()) return [rng.int(0, 511), rng.int(0, 191)];
  const k = rng.next();
  if (k < 0.08) return [rng.pick([c.x0, c.x1 - 1]), rng.pick([c.y0, c.y1 - 1])];      // a clip corner
  if (k < 0.12) return rng.pick([[c.x0 - 1, rng.int(c.y0, c.y1 - 1)], [c.x1, rng.int(c.y0, c.y1 - 1)], [rng.int(c.x0, c.x1 - 1), c.y0 - 1], [rng.int(c.x0, c.x1 - 1), c.y1]]);   // just outside
  for (let i = 0; i < 300; i++) {
    const x = rng.int(c.x0, c.x1 - 1), y = rng.int(c.y0, c.y1 - 1);
    if (want === null || px[y * W + x] === want) return [x, y];
  }
  return [rng.int(c.x0, c.x1 - 1), rng.int(c.y0, c.y1 - 1)];
}
function runSeeds(tag, n = 3) {
  for (let i = 0; i < n; i++) {
    const want = rng.chance(0.5) ? 0 : 1, [x, y] = pickSeed(rng.chance(0.15) ? null : want);
    const colour = (x >= scr.clip.x0 && x < scr.clip.x1 && y >= scr.clip.y0 && y < scr.clip.y1) ? px[y * W + x] : want;
    flood(x, y, pickOff(colour), tag);
  }
}

// ---- 1. noise at several densities -----------------------------------------------------------------------------------------------------------------
{
  const dens = [0.02, 0.1, 0.3, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 0.97];
  for (let i = 0; i < N; i++) {
    const d = dens[i % dens.length];
    fillPx(0);
    if (i % 4 === 3) noisePx(rng.int(0, 300), rng.int(0, 100), rng.int(20, 300), rng.int(10, 90), d); else noisePx(0, 0, W, H, d);
    store(); setClip(...randClip());
    runSeeds('noise');
  }
}
// ---- 2. drawn shapes: frames, lines, rounded rectangles, ovals, filled boxes ---------------------------------------------------------------------------
for (let i = 0; i < N; i++) {
  fillPx(rng.chance(0.2) ? 1 : 0);
  drawOn(() => {
    const k = rng.int(1, 9);
    for (let j = 0; j < k; j++) {
      scr.setOp(rng.chance(0.15) ? G.OP_XOR : rng.chance(0.15) ? G.OP_CLR : G.OP_SET);
      const q = rng.next(), x = rng.int(0, 480), y = rng.int(0, 170), w = rng.int(2, 200), h = rng.int(2, 100);
      if (q < 0.3) scr.frame(x, y, w, h);
      else if (q < 0.5) scr.line(x, y, rng.int(0, 511), rng.int(0, 191));
      else if (q < 0.65) scr.rrect(x, y, w, h, rng.int(2, 12), rng.int(1, 8), 0, tabPat(8 * rng.int(0, 15)), G.OP_SET);
      else if (q < 0.75) scr.rrect(x, y, w, h, 255, 100, rng.int(0, 1), tabPat(8 * rng.int(0, 15)), G.OP_SET);
      else if (q < 0.85) scr.patFill(x, y, w, h, tabPat(8 * rng.int(0, 15)), rng.int(0, 2));
      else scr.fill(x, y, w, h);
    }
  });
  store(); setClip(...randClip());
  runSeeds('shapes', 4);
}
function tabPat(off) { return patAt(off); }
// ---- 3. closed shapes with a 1-pixel gap, and 4-connected boundaries (a diagonal gap does NOT leak) -----------------------------------------------------------
for (let i = 0; i < N; i++) {
  fillPx(0);
  const x0 = rng.int(20, 300), y0 = rng.int(10, 100), w = rng.int(6, 120), h = rng.int(6, 60);
  const kind = i % 5;
  drawOn(() => {
    scr.setOp(G.OP_SET);
    if (kind === 0) scr.frame(x0, y0, w, h);                                   // closed: inside and outside are separate regions
    else if (kind === 1) { scr.frame(x0, y0, w, h); const side = rng.int(0, 3); const gx = side < 2 ? rng.int(x0 + 1, x0 + w - 2) : (side === 2 ? x0 : x0 + w - 1), gy = side < 2 ? (side === 0 ? y0 : y0 + h - 1) : rng.int(y0 + 1, y0 + h - 2); setPx(gx, gy, 0); }   // one-pixel orthogonal gap: leaks
    else if (kind === 2) { const r = rng.int(3, 40), cx = x0 + 40, cy = y0 + r + 2; for (let k = 0; k <= r; k++) { setPx(cx + k, cy - r + k, 1); setPx(cx + r - k, cy + k, 1); setPx(cx - k, cy + r - k, 1); setPx(cx - r + k, cy - k, 1); } }   // a diamond of diagonal chains: does not leak
    else if (kind === 3) { const r = rng.int(3, 40), cx = x0 + 40, cy = y0 + r + 2; for (let k = 0; k <= r; k++) { setPx(cx + k, cy - r + k, 1); setPx(cx + r - k, cy + k, 1); setPx(cx - k, cy + r - k, 1); setPx(cx - r + k, cy - k, 1); } setPx(cx + (r >> 1), cy - r + (r >> 1), 0); setPx(cx + (r >> 1) + 1, cy - r + (r >> 1) + 1, 0); }   // two pixels of the chain removed: leaks
    else { for (let k = 0; k < Math.min(w, 100); k++) setPx(x0 + k, y0 + k, 1); for (let k = 0; k < Math.min(w, 100); k++) setPx(x0 + k + 1, y0 + k, 1); }   // a double diagonal (an orthogonally connected wall)
  });
  store();
  setClip(...(rng.chance(0.5) ? [0, 0, 512, 192] : randClip()));
  const inside = [x0 + 1 + (w >> 1), y0 + 1 + (h >> 1)], outside = [x0 - 3, y0 - 3];
  for (const [sx, sy] of [inside, outside, [x0 + 40, y0 + 2 + 3]]) { const c = colourAt(sx, sy); flood(sx, sy, pickOff(c), `gap${kind}`); }
}
// ---- 4. thin regions: 1-pixel corridors carved in ink (spans), a spiral, columns --------------------------------------------------------------------------
for (let i = 0; i < N; i++) {
  fillPx(1);
  let x = rng.int(10, 500), y = rng.int(5, 185); const x00 = x, y00 = y, steps = rng.int(20, 1500);
  setPx(x, y, 0);
  for (let s = 0; s < steps; s++) {
    const d = rng.int(0, 3); x += [1, -1, 0, 0][d]; y += [0, 0, 1, -1][d]; x = Math.max(0, Math.min(511, x)); y = Math.max(0, Math.min(191, y)); setPx(x, y, 0);
  }
  if (i % 3 === 0) { for (let yy = 0; yy < H; yy += 2) for (let xx = (yy & 2) ? 0 : 1; xx < W; xx += 2) setPx(xx, yy, 0); }        // a lattice of isolated paper dots (no 4-connection)
  if (i % 3 === 1) { for (let xx = 0; xx < W; xx += 2) for (let yy = 0; yy < H; yy++) setPx(xx, yy, 0); }                              // vertical 1-pixel columns: every row has 256 spans, each column one region
  store(); setClip(...(rng.chance(0.4) ? [0, 0, 512, 192] : randClip()));
  runSeeds('thin', 3); flood(x00, y00, pickOff(0), 'thin');
}
// ---- 5. empty picture: every pattern, clips that touch every edge, 1-pixel and empty clips; ink picture too ------------------------------------------------
for (const ink of [0, 1]) {
  for (const clip of [[0, 0, 512, 192], [128, 32, 320, 144], [0, 0, 1, 1], [511, 191, 1, 1], [0, 0, 512, 1], [0, 191, 512, 1], [0, 0, 1, 192], [511, 0, 1, 192], [5, 5, 3, 200], [-5, -5, 20, 20], [100, 50, 0, 20], [100, 50, 20, 0], [600, 20, 30, 30], [7, 7, 9, 9], [8, 8, 8, 8]]) {
    fillPx(ink); store(); setClip(...clip);
    const sx = scr.clipEmpty() ? 100 : rng.int(scr.clip.x0, scr.clip.x1 - 1), sy = scr.clipEmpty() ? 50 : rng.int(scr.clip.y0, scr.clip.y1 - 1);
    for (const off of [FAST_FOR(ink), 8 * rng.int(0, 15), CHECK, ink ? SOLID : WHITE]) { fillPx(ink); store(); flood(sx, sy, off, 'empty'); }
  }
}
// all 16 patterns on the picture's rectangle, from several seeds, paper and ink
for (const ink of [0, 1]) for (let p = 0; p < 16; p++) { fillPx(ink); rectPx(128, 32, 320, 144, ink); store(); setClip(128, 32, 320, 144); flood(rng.int(128, 447), rng.int(32, 175), 8 * p, `pattern${p}`); }
// a region that touches every clip edge, a ring around the clip, a cross dividing the clip
for (let i = 0; i < 12; i++) {
  fillPx(0); const c = [rng.int(0, 200), rng.int(0, 80), rng.int(20, 300), rng.int(20, 100)];
  drawOn(() => { scr.setOp(G.OP_SET); scr.frame(c[0] - 1, c[1] - 1, c[2] + 2, c[3] + 2); if (i & 1) scr.vline(c[0] + (c[2] >> 1), c[1], c[3]); if (i & 2) scr.hline(c[0], c[1] + (c[3] >> 1), c[2]); });
  store(); setClip(...c);
  for (const [sx, sy] of [[c[0], c[1]], [c[0] + c[2] - 1, c[1] + c[3] - 1], [c[0] + (c[2] >> 1) - 1, c[1] + (c[3] >> 1) + 1], [c[0] - 1, c[1] - 1]]) flood(sx, sy, pickOff(colourAt(sx, sy)), 'edges');
}

// ---- 6. combs: a top row of paper, K one-pixel teeth hanging down h rows; spans = 1 + K x h --------------------------------------------------------------
/** The comb in the clip rectangle (cx, cy, cw, ch): ink everywhere in it, paper row 0 across, K teeth at x = cx + 2 j for h rows (spans 1 + K h).  `inv`: the colours swapped.  Outside the clip: paper-or-ink by `outside`. */
function buildComb(cx, cy, cw, ch, K, h, inv, outside) {
  const wall = inv ? 0 : 1, open = inv ? 1 : 0;
  fillPx(outside === 'same' ? open : outside === 'wall' ? wall : open);
  if (outside === 'noise') noisePx(0, 0, W, H, 0.5);
  rectPx(cx, cy, cw, ch, wall);
  rectPx(cx, cy, cw, 1, open);
  for (let j = 0; j < K; j++) rectPx(cx + 2 * j, cy + 1, 1, h, open);
  store();
  return 1 + K * h;
}
const COMB = { cx: 20, cy: 10, cw: 480, ch: 120 };
const combCase = (K, h, inv, off, tag, outside = 'same', expect = null) => {
  const spans = buildComb(COMB.cx, COMB.cy, COMB.cw, COMB.ch, K, h, inv, outside);
  setClip(COMB.cx, COMB.cy, COMB.cw, COMB.ch);
  const r = flood(COMB.cx + 5, COMB.cy, off, `${tag}`);
  if (r) { const ok = r.mr.spans === spans; C.check(`${tag}: the comb has ${spans} spans (model counts ${r.mr.spans})`, ok); }
  return r;
};
// the exact boundary: 204 spans does not overflow with a pattern fill, 205 does; the solid / white fill completes either way
const bnd = {};
for (const inv of [0, 1]) {
  const nm = inv ? 'ink comb' : 'paper comb', fast = FAST_FOR(inv), other = inv ? SOLID : WHITE;   // `fast` = the opposite colour of the target; `other` = the same colour (a no-change two-pass fill)
  for (const [K, h] of [[203, 1], [204, 1], [29, 7], [17, 12], [67, 3], [202, 1], [205, 1], [240, 1]]) {
    const spans = 1 + K * h;
    for (const [pn, off] of [['50% checker', CHECK], ['25%', 24], ['the colour opposite to the target (fast path)', fast], ['the target colour itself (two-pass)', other]]) {
      const r = combCase(K, h, inv, off, `${nm} K ${K} x ${h} (${spans} spans), ${pn}`, rng.pick(['same', 'wall', 'noise']));
      if (r) bnd[`${inv}:${spans}:${pn}`] = r.carry;
    }
  }
}
C.check('204 spans, 50 % checker: no overflow (paper comb)', bnd['0:204:50% checker'] === 0);
C.check('205 spans, 50 % checker: overflow, carry set (paper comb)', bnd['0:205:50% checker'] === 1);
C.check('205 spans, solid: completes (paper comb)', bnd['0:205:the colour opposite to the target (fast path)'] === 0);
C.check('204 spans, 50 % checker: no overflow (ink comb)', bnd['1:204:50% checker'] === 0);
C.check('205 spans, 50 % checker: overflow, carry set (ink comb)', bnd['1:205:50% checker'] === 1);
C.check('205 spans, white: completes (ink comb)', bnd['1:205:the colour opposite to the target (fast path)'] === 0);
// random combs
for (let i = 0; i < N; i++) {
  const K = rng.int(1, 240), h = rng.int(1, 6), inv = rng.int(0, 1);
  if (2 * K - 1 > COMB.cw || 1 + h > COMB.ch) continue;
  combCase(K, h, inv, pickOff(inv), `random comb K ${K} x ${h} (${1 + K * h} spans)`, rng.pick(['same', 'wall', 'noise']));
}

// ---- 7. the seed stack: a span with teeth up and down pushes Ku + Kd seeds at once (PAINT 21: it overflows when the stack passes 256 entries) ----------------
/** A paper bar (row cy + hu) with Ku teeth up (x = cx + 2 j) and Kd teeth down (x = cx + 2 j), all one pixel wide and one pixel high; the rest ink.  Spans 1 + Ku + Kd. */
function buildBar(cx, cy, cw, Ku, Kd, inv) {
  const wall = inv ? 0 : 1, open = inv ? 1 : 0;
  fillPx(wall);
  rectPx(cx, cy + 1, cw, 1, open);
  for (let j = 0; j < Ku; j++) setPx(cx + 2 * j, cy, open);
  for (let j = 0; j < Kd; j++) setPx(cx + 2 * j, cy + 2, open);
  store();
}
const stkRes = {};
for (const inv of [0, 1]) for (const [Ku, Kd] of [[100, 100], [128, 128], [200, 56], [200, 57], [150, 150], [255, 1], [255, 2], [128, 129], [250, 250]]) {
  buildBar(0, 80, 512, Ku, Kd, inv); setClip(0, 0, 512, 192);
  const off = FAST_FOR(inv), tot = Ku + Kd;
  const r = flood(3, 81, off, 'stack-probe', { expectStack: tot <= STK_MAX ? 'ok' : 'over' });
  stkRes[`${inv}:${Ku}+${Kd}`] = r && { carry: r.carry, stk: r.stkEntries };
}
// ---- 8. big complex regions, solid fills (the fast path completes whatever the span count): the largest the seed stack allows ------------------------------
const bigRes = [];
for (let i = 0; i < Math.max(12, N >> 2); i++) {
  const inv = i & 1, dens = [0.55, 0.6, 0.65, 0.7, 0.75, 0.8][i % 6];
  fillPx(0); noisePx(0, 0, W, H, inv ? dens : 1 - dens);               // the region colour is the majority: paper (inv 0) or ink (inv 1)
  store(); setClip(...rng.pick([[0, 0, 512, 192], [128, 32, 320, 144], [0, 0, 512, 192]]));
  const [sx, sy] = pickSeed(inv ? 1 : 0);
  const r = flood(sx, sy, FAST_FOR(inv ? 1 : 0), 'big-solid');
  if (r) bigRes.push(`density ${dens} ${inv ? 'ink' : 'paper'}: region ${r.mr.n} px, ${r.mr.spans} spans, carry ${r.carry}, stack ${r.stkEntries}`);
}
// a few picture-sized combs and checkerboards with solid fills
for (const [K, h] of [[256, 1], [250, 4], [128, 6]]) {
  const spans = buildComb(0, 0, 512, 192, K, h, 0, 'same'); setClip(0, 0, 512, 192);
  const r = flood(5, 0, SOLID, 'big-solid');
  if (r) bigRes.push(`full-screen comb K ${K} x ${h} (${spans} spans): carry ${r.carry}, stack ${r.stkEntries}, list ${r.listN}`);
}

// ---- 9. timings: interrupts on (the call under test is not stepped by frames), the picture's clip and the whole screen --------------------------------------
const timing = {};
{
  const cases = [
    ['empty 320 x 144 clip, solid pattern (fast path)', () => { fillPx(0); store(); setClip(128, 32, 320, 144); return [200, 100, SOLID]; }],
    ['empty 320 x 144 clip, 50 % checker (two-pass)', () => { fillPx(0); store(); setClip(128, 32, 320, 144); return [200, 100, CHECK]; }],
    ['comb of 100 spans (K 99 x 1), 50 % checker', () => { buildComb(COMB.cx, COMB.cy, COMB.cw, COMB.ch, 99, 1, 0, 'same'); setClip(COMB.cx, COMB.cy, COMB.cw, COMB.ch); return [COMB.cx + 5, COMB.cy, CHECK]; }],
    ['comb of 100 spans (K 99 x 1), solid', () => { buildComb(COMB.cx, COMB.cy, COMB.cw, COMB.ch, 99, 1, 0, 'same'); setClip(COMB.cx, COMB.cy, COMB.cw, COMB.ch); return [COMB.cx + 5, COMB.cy, SOLID]; }],
    ['comb of 204 spans (K 203 x 1), 50 % checker (the most the span list holds)', () => { buildComb(COMB.cx, COMB.cy, COMB.cw, COMB.ch, 203, 1, 0, 'same'); setClip(COMB.cx, COMB.cy, COMB.cw, COMB.ch); return [COMB.cx + 5, COMB.cy, CHECK]; }],
    ['comb of 205 spans (K 204 x 1), 50 % checker (the overflow call)', () => { buildComb(COMB.cx, COMB.cy, COMB.cw, COMB.ch, 204, 1, 0, 'same'); setClip(COMB.cx, COMB.cy, COMB.cw, COMB.ch); return [COMB.cx + 5, COMB.cy, CHECK]; }],
    ['hollow frame 100 x 60, inside, 50 % checker', () => { fillPx(0); drawOn(() => { scr.setOp(G.OP_SET); scr.frame(200, 60, 100, 60); }); store(); setClip(128, 32, 320, 144); return [250, 90, CHECK]; }],
    ['hollow frame 100 x 60, inside, solid', () => { fillPx(0); drawOn(() => { scr.setOp(G.OP_SET); scr.frame(200, 60, 100, 60); }); store(); setClip(128, 32, 320, 144); return [250, 90, SOLID]; }],
  ];
  for (const [name, f] of cases) { const [x, y, off] = f(); const r = flood(x, y, off, 'timing'); if (r) timing[name] = `${r.t} T (carry ${r.carry}, ${r.mr.inClip ? `${r.mr.n} px, ${r.mr.spans} spans` : 'off clip'}, seed stack ${r.stkEntries}, span list ${r.listN})`; }
}

// ---- 10. frames: normal frames after the fills, V_FRAMES +1 each, a fill drawn between frames (no DI across a frame) ---------------------------------------
const framesBad = { n: 0, first: '', checked: 0, vfbad: 0 };
{
  watch.armed = false;
  const cpu = m.cpu;
  cpu.pc = S.T_RET; cpu.iff1 = cpu.iff2 = false; cpu.halted = false; cpu.sp = 0xFF00;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart >= 58688; k++) { if (m.tstates < m.frameStart + 58688) m.tstates = m.frameStart + 58688; M.runFrame(m); }
  cpu.iff1 = cpu.iff2 = true;
  for (let i = 0; i < 13; i++) {
    const v0 = L.rd16(m, S.V_FRAMES);
    M.runFrame(m);
    let g = 0; while (cpu.pc !== S.T_RET && ++g < 20000) Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.pc !== S.T_RET) { framesBad.n++; framesBad.first ||= `frame ${i}: the ISR did not return to the parked loop (PC ${hex(cpu.pc)})`; break; }
    cpu.iff1 = cpu.iff2 = true;
    const dv = (L.rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
    if (i > 0) framesBad.checked++;
    if (i > 0 && dv !== 1) { framesBad.vfbad++; framesBad.first ||= `frame ${i}: V_FRAMES ${v0} -> ${v0 + dv}`; }
    fillPx(0); rectPx(100 + 10 * i, 40, 60, 40, 1); store(); setClip(0, 0, 512, 192);
    const lim = 0; void lim;
    setGA(150 + 10 * i, 60, 0, 0, ptrOf(8 * (i & 15)));
    const pre = m.ram.slice(0x4000, 0x4010);
    void pre;
    const cat = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 6_000_000 });
    if (cat.di || m.portF4 !== 0x33) { framesBad.n++; framesBad.first ||= `frame ${i}: di ${cat.di}, port ${hex(m.portF4, 2)}`; }
    cpu.pc = S.T_RET; cpu.sp = 0xFF00; cpu.iff1 = cpu.iff2 = true;
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------
const cs = stats.cases, nCases = Object.values(cs).reduce((a, b) => a + b, 0);
C.check(`every call equals the reference model (display after a complete fill, carry, the region's box): ${stats.calls} calls (${Object.entries(cs).map(([k, v]) => `${k} ${v}`).join(', ')}); ${stats.complete} complete (${stats.fastDone} one-pass, ${stats.slowDone} two-pass), ${stats.overflow} overflowed, ${stats.offClip} with the seed outside the clip; most spans in a model region ${stats.spansMax}, in a complete fill ${stats.spansMaxDone}`,
  stats.bad === 0 && stats.calls === nCases, stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check(`carry: ${stats.carryBad} wrong of ${stats.calls}`, stats.carryBad === 0, stats.first);
C.check(`the region's box (FL_BX0, FL_BX1, FL_BY0, FL_BY1) equals the bounding box after every complete fill: ${stats.boxBad} wrong`, stats.boxBad === 0);
C.check(`on an overflow the pixels outside the region are as they were: ${stats.bndBad} wrong of ${stats.overflow} overflows`, stats.bndBad === 0);
C.check('G_SETCLIP behaved as specified on the way', setupBad === 0, setupFirst);
C.check(`G_FLOOD ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.calls && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls', watch.wrHeap.length === 0, watch.wrHeap.join(' | '));
C.check('GCLIP kept by every call', stats.clipBad === 0);
C.check('no RAM written outside the display files, GA, GOP, the scratch $E01A-$E07F / $E0D0-$E0E7 / $E700-$E7FF, the cold RAM $7800-$7FFF and the stack window (whole 64 KB compared after every call)', stats.outside === 0, stats.outsideFirst);
C.check(`stack used (KFAR included) <= ${STACK_BOUND} bytes: max ${stats.stackMax}`, stats.stackBad === 0);
C.check('no DI, IX / IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run): ${env.w.summary()}`, env.w.n === 0);
C.check(`V_FRAMES rose by 1 every normal frame: ${framesBad.checked} frames checked, ${framesBad.vfbad} wrong, no DI across a frame`, framesBad.checked >= 12 && framesBad.vfbad === 0 && framesBad.n === 0, framesBad.first);
console.log(`  ${stats.stackLegit} fills overflowed the machine's seed stack (256 entries) with more than 256 possible pushes (allowed by PAINT 21): ${stats.stackLegitFast.length} one-pass (solid) and ${stats.stackLegitSlow.length} two-pass; e.g. ${(stats.stackLegitFast[0] || stats.stackLegitSlow[0] || 'none')}`);
// the seed-stack probes: Ku + Kd seeds pushed at once; the contract: overflow when the stack passes 256 entries (these are the machine's answers; a mismatch is reported, not bent)
for (const [k, v] of Object.entries(stkRes)) {
  const [inv, kk] = k.split(':'), tot = kk.split('+').map(Number).reduce((a, b) => a + b, 0), want = tot <= STK_MAX ? 0 : 1;
  C.check(`seed-stack probe, ${inv === '1' ? 'ink' : 'paper'} bar with ${kk} teeth (up + down = ${tot} seeds pushed by the first span): carry ${v ? v.carry : '?'} (contract: ${want ? 'overflow, past 256' : 'completes'}); seed stack reached ${v ? v.stk : '?'} entries`, !!v && v.carry === want);
}
console.log(`  the seed stack's deepest use ${stats.stkEntriesMax} entries (of ${STK_MAX}); the span list's longest ${stats.listMax} entries (of ${SPAN_MAX}); the largest region ${stats.regionMax} px; G_FLOOD changed GOP in ${stats.gopChanged} of ${stats.calls} calls; FL_FAST differed from the model's fast flag in ${stats.flFast || 0} complete fills`);
for (const s of bigRes) console.log(`  big solid fill: ${s}`);
console.log(`longest call ${stats.tMax} T (${stats.tMaxDesc})`);
for (const [k, v] of Object.entries(timing)) console.log(`  ${k}: ${v}`);
C.done();
