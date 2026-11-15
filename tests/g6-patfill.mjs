"use strict";
// g6-patfill.mjs -- G_PATFILL in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/PAINT.md 16 (G_PATFILL's contract: GA = x, y, w, h and GA+8 = a pointer to 8 pattern bytes in DOCK 6; GOP 0 SET, 1 CLR, 2 XOR, 3 REPLACE; clipped to GCLIP and the
// screen; the pattern anchored to the screen; GA kept; scratch $E050-$E057), docs/BANKING.md (KFAR, the mappings) and tests/g6-line.mjs (the method).  src/gfx6/patfill.asm was used only to find names.
//   node tests/g6-patfill.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random rectangles (default 600)
// Method: tk-lib's bootParked; each fill is called from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_PATFILL / ret`: KFAR to chunk 6) with random registers; GOP and the clip are
// set directly; the pattern pointer is PATTAB + k (k a multiple of 8 for the 16 patterns of the table, sometimes any offset 0..120: 8 bytes of the table / its neighbour, all in DOCK 6).
// The whole 512 x 192 screen is compared with tests/gfx6-model.mjs (Gfx6Model.patFill) after every call.  Also: mapping R at entry and for every access made from code in $C000-$DFFF;
// no write to $C000-$DFFF; no RAM outside the display files, the stack window, KFAR's cells and the scratch changed; the stack <= 128 bytes; no DI; GA kept; the mapping back to K;
// then normal frames run with V_FRAMES +1 each, a fill drawn between frames.  The table in DOCK 6 equals tools/paint-mock.mjs PATS.
// Exit code 1 on any failure.  The last line is "g6-patfill: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';
import { M, Z } from './lib.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 600);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random rectangles`);
const C = checks('g6-patfill');
const rng = makeRng(SEED);
const STUB = 0x5F00;
const STACK_BOUND = 128;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_PATFILL', 'PATTAB', 'GA', 'GOP', 'GCLIP', 'G_SETCLIP', 'K_FAR', 'K_FJP', 'V_SHADOW_F4', 'V_FRAMES']);
if (S.G_PATFILL < 0xC000 || S.G_PATFILL >= 0xE000) { C.check('G_PATFILL is in chunk 6 ($C000-$DFFF)', false, hex(S.G_PATFILL)); C.done(); process.exit(); }
C.check(`G_PATFILL is in chunk 6 ($C000-$DFFF): ${hex(S.G_PATFILL)}; PATTAB ${hex(S.PATTAB)}`, S.PATTAB >= 0xC000 && S.PATTAB + 128 <= 0xE000);

// the pattern table as the cartridge holds it (DOCK chunk 6 at offset PATTAB - $C000) against the mock-up's PATS (tools/paint-mock.mjs)
const PATS = [[255, 255, 255, 255, 255, 255, 255, 255], [0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB, 0xEE, 0xBB], [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55], [0x88, 0x22, 0x88, 0x22, 0x88, 0x22, 0x88, 0x22],
  [0x88, 0x00, 0x22, 0x00, 0x88, 0x00, 0x22, 0x00], [0xFF, 0x00, 0x00, 0x00, 0xFF, 0x00, 0x00, 0x00], [0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA, 0xAA], [0xC0, 0x60, 0x30, 0x18, 0x0C, 0x06, 0x03, 0x81],
  [0x88, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00], [0xFF, 0x80, 0x80, 0x80, 0xFF, 0x08, 0x08, 0x08], [0xFF, 0x88, 0x88, 0x88, 0xFF, 0x88, 0x88, 0x88], [0x00, 0x38, 0x7C, 0x7C, 0x7C, 0x38, 0x00, 0x00],
  [0x81, 0x42, 0x24, 0x18, 0x18, 0x24, 0x42, 0x81], [0xCC, 0xCC, 0x33, 0x33, 0xCC, 0xCC, 0x33, 0x33], [0x03, 0x06, 0x0C, 0x18, 0x30, 0x60, 0xC0, 0x81], [0, 0, 0, 0, 0, 0, 0, 0]];
const dock6 = m.dock[6], PT0 = S.PATTAB - 0xC000;
const tab = Array.from({ length: 128 }, (_, i) => dock6[PT0 + i]);
C.check('PATTAB in DOCK 6 holds the 16 patterns of tools/paint-mock.mjs PATS', PATS.every((p, k) => p.every((v, j) => tab[8 * k + j] === v)),
  `first difference at pattern ${PATS.findIndex((p, k) => p.some((v, j) => tab[8 * k + j] !== v))}`);
const patAt = (off) => tab.slice(off, off + 8);

// the stub: rst $28 / DW G_PATFILL / ret
m.ram[STUB] = 0xEF; m.ram[STUB + 1] = S.G_PATFILL & 0xFF; m.ram[STUB + 2] = S.G_PATFILL >> 8; m.ram[STUB + 3] = 0xC9;

// ---- watches -----------------------------------------------------------------------------------------------------------------------------------------
// every access whose instruction is in $C000-$DFFF must be made under R; a write to $C000-$DFFF under any mapping is counted during the calls
const watch = { armed: false, accR: 0, badMap: [], wrHeap: [], wrLo: [] };
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
  };
  m.bus.read = function (addr) { note(addr & 0xFFFF, false); return rd0(addr); };
  m.bus.write = function (addr, v) { note(addr & 0xFFFF, true); wr0(addr, v); };
}

const entry = { n: 0, bad: [] };           // the mapping at G_PATFILL's first instruction
const hooks = { [S.G_PATFILL]: () => { entry.n++; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const seedDisplay = () => { for (let a = 0x4000; a < 0x5800; a++) m.ram[a] = rng.int(0, 255); for (let a = 0x6000; a < 0x7800; a++) m.ram[a] = rng.int(0, 255); };
const setGA = (...w) => w.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
const scr = new G.Gfx6Model();
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
let setupBad = 0, setupFirst = '';
let curOp = 0;
function setOp(op) { m.ram[S.GOP] = op; curOp = op; }
function setClip(x, y, w, h) {
  setGA(x, y, w, h);
  T.runCall(env, S.G_SETCLIP, {}, { ints: false });
  scr.setClip(x, y, w, h);
  const c = [0, 1, 2, 3].map((i) => L.rd16(m, S.GCLIP + 2 * i));
  const want = [scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1];
  if (scr.clipEmpty() ? (c[0] < c[1] && c[2] < c[3]) : c.join() !== want.join()) { setupBad++; setupFirst ||= `GCLIP ${c} after G_SETCLIP(${x}, ${y}, ${w}, ${h}), want ${want}`; }
}
const randClip = () => {
  const k = rng.next();
  if (k < 0.15) return [0, 0, 512, 192];
  if (k < 0.2) return [-40, -40, 700, 400];
  if (k < 0.3) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(512, 900), rng.int(0, 190), 30, 30], [5, rng.int(192, 300), 30, 30], [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)]]);
  if (k < 0.5) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];
  if (k < 0.8) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 160), rng.int(1, 60)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};

const MAY = (a) => (a >= 0xE01A && a < 0xE080) || (a >= 0xE700 && a < 0xE800) || (a >= 0x4000 && a < 0x5800) || (a >= 0x6000 && a < 0x7800) || (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);
const stats = { calls: 0, bad: 0, first: '', ops: [0, 0, 0, 0], stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, tMax: 0, tMaxDesc: '', cases: {}, drawn: 0, empty: 0, gaBad: 0 };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };
const ptrOf = (off) => S.PATTAB + off;

/** One checked fill: G_PATFILL through KFAR from the stub, the screen against the model, and the side checks.  `off` = the pattern's offset in PATTAB. */
function fill(x, y, w, h, off, tag = 'random') {
  const op = curOp, pat = patAt(off);
  const desc = `(${x}, ${y}, ${w}, ${h}) op ${op} pattern PATTAB+${off} [${pat.map((v) => hex(v, 2).slice(1)).join(' ')}] clip ${clipStr()}`;
  setGA(x, y, w, h, ptrOf(off));
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  watch.armed = true;
  let r;
  const ga = Array.from(m.ram.subarray(S.GA, S.GA + 10)), oc = Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));
  // the model first: its changed-pixel count tells whether a frame interrupt (and its ISR's own RAM writes) must be kept out of the call
  const px0 = scr.px.slice();
  scr.patFill(x, y, w, h, pat, op);
  let changed = 0, area = 0;
  { const c = scr.clip, xa = Math.max(G.s16(x), c.x0), xb = Math.min(G.s16(x) + G.s16(w), c.x1), ya = Math.max(G.s16(y), c.y0), yb = Math.min(G.s16(y) + G.s16(h), c.y1); area = (G.s16(w) > 0 && G.s16(h) > 0 && xa < xb && ya < yb) ? (xb - xa) * (yb - ya) : 0; }
  void px0; void changed;
  try { r = T.runCall(env, STUB, {}, { ints: area <= 6000, hooks, guard: 6_000_000 }); }
  catch (e) { watch.armed = false; fail(`${tag} ${desc}: ${e.message}`); scr.loadRam(m.ram); return false; }
  watch.armed = false;
  stats.calls++; stats.ops[op]++; stats.cases[tag] = (stats.cases[tag] || 0) + 1; if (area) stats.drawn++; else stats.empty++;
  const d = scr.compareRam(m.ram);
  let ok = true;
  if (d) {
    ok = false;
    const want = scr.toBytes(); let k = 0; while (want[k] === m.ram[k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800]) k++;
    const a = k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800;
    fail(`${tag} fill ${desc}: ${G.fmtDiff(d)}; first differing byte ${hex(a)} is ${hex(m.ram[a], 2)} (was ${hex(before[a], 2)}), model ${hex(want[k], 2)}`);
    scr.loadRam(m.ram);
  }
  if (r.stack > stats.stackMax) stats.stackMax = r.stack;
  if (r.stack > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} fill ${desc}: stack ${r.stack} bytes > ${STACK_BOUND}`); }
  if (r.di) { stats.di++; ok = false; fail(`${tag} fill ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} fill ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} fill ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GA, S.GA + 10)).join() !== ga.join() || Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8)).join() !== oc.join()) { stats.gaBad++; ok = false; fail(`${tag} fill ${desc}: GA / GOP / GCLIP changed`); }
  if (r.sp !== 0xFF00) { ok = false; fail(`${tag} fill ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAY(a)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} fill ${desc}: RAM outside the display and stack changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  if (r.t > stats.tMax) { stats.tMax = r.t; stats.tMaxDesc = `${desc}${area <= 6000 ? ' (interrupts on)' : ''}`; }
  stats.lastT = r.t; stats.lastArea = area;
  return ok;
}
const resync = () => { seedDisplay(); scr.loadRam(m.ram); };
// Rectangles whose clipped range, as the routine computes it, has a negative end or a start of 256 or more are run LAST (and counted on their own): on this build they make G_PATFILL draw
// (rows or columns that wrap), so a run of them corrupts RAM and would hide everything else.  They are still checked against the model (the contract says: clipped to the clip and the screen).
const deferred = [];
const sw = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
function suspect(x, y, w, h) {
  const gc = [0, 1, 2, 3].map((i) => sw(L.rd16(m, S.GCLIP + 2 * i))), [cx0, cx1, cy0, cy1] = gc;
  x = sw(x); y = sw(y); w = sw(w); h = sw(h);
  if (w < 0 || h < 0) return null;                                  // returned at once (a negative size)
  const x1 = Math.min(sw(x + w), cx1), y1 = Math.min(sw(y + h), cy1), y0 = Math.max(y, cy0);
  if (x1 < 0) return 'x end < 0 (wholly left of the screen)';
  if (y1 < 0) return 'y end < 0 (wholly above the screen)';
  if (y0 >= 256) return 'y start >= 256 (wholly below the screen)';
  return null;
}
const go = (x, y, w, h, off, tag) => { if (!later(x, y, w, h, off, tag)) fill(x, y, w, h, off, tag); };
const later = (x, y, w, h, off, tag) => { const k = suspect(x, y, w, h); if (!k) return false; deferred.push({ clip: [scr.clip.x0, scr.clip.y0, scr.clip.x1 - scr.clip.x0, scr.clip.y1 - scr.clip.y0], clipRaw: scr.clipEmpty() ? [0, 0, 0, 0] : null, op: curOp, rect: [x, y, w, h], off, tag, why: k }); return true; };
const randOff = () => (rng.chance(0.7) ? 8 * rng.int(0, 15) : rng.int(0, 120));
const XB = [0, 7, 8, 9, 15, 16, 17, 255, 256, 257, 503, 504, 505, 511];
function randRect() {
  const q = rng.next(), c = scr.clip, near = () => [rng.int(-20, 530), rng.int(-20, 212)];
  let x, y, w, h;
  if (q < 0.25) { [x, y] = near(); w = rng.int(1, 40); h = rng.int(1, 30); }
  else if (q < 0.40) { x = rng.pick(XB) + rng.int(-1, 1); y = rng.int(-10, 200); w = rng.pick([1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 64, 100, 255, 256, 257, 511, 512]) + rng.int(-1, 1); h = rng.int(1, 40); }
  else if (q < 0.52) {
    if (scr.clipEmpty()) { [x, y] = near(); w = rng.int(1, 100); h = rng.int(1, 60); }
    else { x = c.x0 + rng.int(-9, 9); y = c.y0 + rng.int(-9, 9); w = c.x1 - c.x0 + rng.int(-9, 9); h = c.y1 - c.y0 + rng.int(-9, 9); }
  }
  else if (q < 0.62) { [x, y] = near(); w = rng.int(1, 512); h = rng.int(1, 200); }
  else if (q < 0.70) { x = rng.int(-16384, 16383); y = rng.int(-16384, 16383); w = rng.int(-16384, 16383); h = rng.int(-16384, 16383); }              // far and huge, signs mixed (x + w stays in 16 bits)
  else if (q < 0.76) { [x, y] = near(); w = rng.int(5000, 16383); h = rng.int(1, 60); if (x < 0) x = rng.int(-16000, 0); }                             // huge width, from the screen
  else if (q < 0.82) { [x, y] = near(); w = rng.int(1, 100); h = rng.int(5000, 16383); }                                                               // huge height
  else if (q < 0.88) { [x, y] = near(); w = rng.int(-300, 0); h = rng.int(-100, 60); }                                                                   // negative or zero
  else if (q < 0.94) { x = rng.pick([-600, -300, 512, 600, 1000]); y = rng.int(-20, 212); w = rng.int(1, 400); h = rng.int(1, 100); if (x < 0 && rng.chance(0.5)) w = rng.int(1, 300); }  // wholly off to the left / right
  else { x = rng.int(-20, 530); y = rng.pick([-300, -100, 192, 250, 400]); w = rng.int(1, 300); h = rng.int(1, 100); }                                    // above / below
  return [x, y, w, h];
}

// ---- 1. random rectangles --------------------------------------------------------------------------------------------------------------------------
resync(); setClip(0, 0, 512, 192); setOp(0);
for (let i = 0; i < N; i++) {
  if (i % 20 === 0) resync();
  if (i % 2 === 0) setClip(...randClip());
  setOp(rng.int(0, 3));
  { const r = randRect(), off = randOff(); if (!later(...r, off, 'random')) fill(...r, off); }
}
// ---- 2. edge cases: every op x every table pattern x rectangles on and across byte columns, rows and the screen's edges; empty clip -------------------------
setClip(0, 0, 512, 192);
const FIXED = [[0, 0, 512, 192], [0, 0, 1, 1], [511, 191, 1, 1], [0, 0, 8, 8], [3, 5, 2, 1], [7, 7, 2, 2], [8, 8, 8, 8], [5, 3, 22, 9], [128, 32, 320, 144], [-1, -1, 514, 194], [-16384, -16384, 32767, 32767], [0, 0, 512, 1], [0, 191, 512, 1],
  [0, 0, 1, 192], [511, 0, 1, 192], [100, 100, 0, 50], [100, 100, 50, 0], [100, 100, -5, -5], [100, 100, 32767 - 100, 50], [-100, 50, 32767, 20], [510, 190, 20, 20], [-10, -10, 11, 11]];
const fixed = [];
for (const op of [0, 1, 2, 3]) for (const rc of FIXED) fixed.push([op, rc, rng.chance(0.5) ? 8 * rng.int(0, 15) : rng.int(0, 120)]);
for (let i = 0; i < fixed.length; i++) { if (i % 8 === 0) resync(); setOp(fixed[i][0]); if (!later(...fixed[i][1], fixed[i][2], 'edge')) fill(...fixed[i][1], fixed[i][2], 'edge'); }
// each of the 16 table patterns in each op over a rectangle that starts and ends mid byte
for (let p = 0; p < 16; p++) for (const op of [0, 1, 2, 3]) { if (op === 0) resync(); setOp(op); go(3 + p, 2 + p, 37 + p, 21, 8 * p, 'table'); }
// the clip: single-pixel, empty and byte-aligned clips with large rectangles
for (const clip of [[0, 0, 512, 192], [5, 5, 1, 1], [17, 9, 1, 40], [17, 9, 40, 1], [8, 8, 8, 8], [7, 7, 10, 10], [100, 50, 0, 20], [100, 50, 20, 0], [600, 20, 30, 30], [20, 300, 30, 30]]) {
  setClip(...clip);
  for (const op of [0, 1, 2, 3]) { resync(); setOp(op); go(-8, -8, 600, 300, 8 * rng.int(0, 15), 'clip'); go(clip[0] - 1, clip[1] - 1, clip[2] + 2, clip[3] + 2, rng.int(0, 120), 'clip'); }
}
resync();
setClip(100, 50, 0, 20); setOp(3); fill(0, 0, 512, 192, 16, 'empty-clip');     // empty clip: the display must stay as seeded
setClip(0, 0, 512, 192); setOp(0);

// ---- 3. timings: a 320 x 144 REPLACE fill (the picture's size) and the whole screen, interrupts off, so the figure has no ISR in it -----------------------
const timing = {};
{
  setClip(0, 0, 512, 192);
  for (const [name, op, x, y, w, h, off] of [['320 x 144 REPLACE, 50% checker', 3, 128, 32, 320, 144, 16], ['320 x 144 REPLACE, white', 3, 128, 32, 320, 144, 120], ['320 x 144 REPLACE, solid', 3, 128, 32, 320, 144, 0],
    ['320 x 144 XOR, 50% checker', 2, 128, 32, 320, 144, 16], ['320 x 144 SET, 25%', 0, 128, 32, 320, 144, 24], ['aligned 320 x 144 REPLACE at x = 128 (byte aligned)', 3, 128, 32, 320, 144, 56], ['unaligned 320 x 144 REPLACE at x = 131', 3, 131, 32, 320, 144, 56], ['512 x 192 REPLACE', 3, 0, 0, 512, 192, 16]]) {
    resync(); setOp(op);
    fill(x, y, w, h, off, 'timing');
    timing[name] = stats.lastT;
  }
  setOp(0);
}

// ---- 4. frames: normal frames after the fills, V_FRAMES +1 each, a fill drawn between frames (no DI held across a frame) -----------------------------------
const framesBad = { n: 0, first: '' };
{
  watch.armed = false;
  const cpu = m.cpu;
  cpu.pc = S.T_RET; cpu.iff1 = cpu.iff2 = false; cpu.halted = false; cpu.sp = 0xFF00;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart >= 58688; k++) { if (m.tstates < m.frameStart + 58688) m.tstates = m.frameStart + 58688; M.runFrame(m); }
  cpu.iff1 = cpu.iff2 = true;
  setClip(0, 0, 512, 192); setOp(3);
  framesBad.checked = 0; framesBad.vfbad = 0;
  for (let i = 0; i < 13; i++) {
    const v0 = L.rd16(m, S.V_FRAMES);
    M.runFrame(m);
    let g = 0; while (cpu.pc !== S.T_RET && ++g < 20000) Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.pc !== S.T_RET) { framesBad.n++; framesBad.first ||= `frame ${i}: the ISR did not return to the parked loop (PC ${hex(cpu.pc)})`; break; }
    cpu.iff1 = cpu.iff2 = true;
    const dv = (L.rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
    if (i > 0) framesBad.checked++;
    if (i > 0 && dv !== 1) { framesBad.vfbad++; framesBad.first ||= `frame ${i}: V_FRAMES ${v0} -> ${v0 + dv}`; }
    setGA(0, 0, 100 + 10 * i, 30, ptrOf(8 * (i & 15)));
    const cat = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 6_000_000 });
    if (cat.di || m.portF4 !== 0x33) { framesBad.n++; framesBad.first ||= `frame ${i}: di ${cat.di}, port ${hex(m.portF4, 2)}`; }
    cpu.pc = S.T_RET; cpu.sp = 0xFF00; cpu.iff1 = cpu.iff2 = true;
  }
}

// ---- 5. the deferred rectangles (wholly off the screen to the left, above or below), run last, each on a fresh display ---------------------------------------------
const late = { n: 0, bad: 0, byWhy: {}, firstBy: {}, outside: 0 };
const pre = { wr: watch.wrHeap.slice(), w: env.w.n, wsum: env.w.summary() };
{
  const kept = { bad: stats.bad, first: stats.first, outside: stats.outside, outsideFirst: stats.outsideFirst, calls: stats.calls, gaBad: stats.gaBad, stackBad: stats.stackBad, mapBack: stats.mapBack };
  const save = { ...stats, ops: stats.ops.slice(), cases: { ...stats.cases } };
  stats.bad = 0; stats.first = '';
  for (const d of deferred) {
    resync(); setClip(...d.clip); if (d.clipRaw) setClip(100, 50, 0, 20);
    setOp(d.op);
    stats.bad = 0; stats.first = ''; const o0 = stats.outside;
    late.n++;
    fill(...d.rect, d.off, 'late');
    const w = d.why; late.byWhy[w] ||= { n: 0, bad: 0 };
    late.byWhy[w].n++;
    if (stats.bad) { late.bad++; late.byWhy[w].bad++; late.firstBy[w] ||= stats.first; }
    if (stats.outside > o0) late.outside++;
  }
  Object.assign(stats, { bad: kept.bad, first: kept.first, outside: kept.outside, outsideFirst: kept.outsideFirst, calls: save.calls, gaBad: kept.gaBad, stackBad: kept.stackBad, mapBack: kept.mapBack, ops: save.ops, cases: save.cases });
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------
const cs = stats.cases, nCases = Object.values(cs).reduce((a, b) => a + b, 0);
C.check(`display after every call equals the reference model: ${stats.calls} fills compared (ops SET/CLR/XOR/REPLACE ${stats.ops.join('/')}; ${stats.drawn} drew pixels, ${stats.empty} drew nothing; ${Object.entries(cs).map(([k, v]) => `${k} ${v}`).join(', ')})`,
  stats.bad === 0 && stats.calls === nCases && stats.calls >= N, stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check(`rectangles wholly off the screen (x end < 0, y end < 0, y start >= 256) leave the display as it was (PAINT 16: clipped to the clip and the screen): ${late.n} run, ${late.bad} wrong; ${Object.entries(late.byWhy).map(([k, v]) => `${k}: ${v.bad} of ${v.n}`).join('; ')}`,
  late.bad === 0, Object.entries(late.firstBy).map(([k, v]) => `[${k}] ${v}`).join(' | '));
C.check(`G_SETCLIP behaved as specified on the way`, setupBad === 0, setupFirst);
C.check(`G_PATFILL ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.calls && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls (all but the wholly-off-screen rectangles of section 5)', pre.wr.length === 0, pre.wr.join(' | '));
C.check(`no write to $C000-$DFFF during the section 5 calls (${late.n} wholly-off-screen rectangles)`, watch.wrHeap.length === pre.wr.length, watch.wrHeap.slice(pre.wr.length).join(' | '));
C.check('GA (x, y, w, h, pattern pointer), GOP and GCLIP kept by every call', stats.gaBad === 0);
C.check('no RAM written outside the display files, the stack window, KFAR cells and the scratch $E01A-$E07F / $E700-$E7FF (whole 64 KB compared after every call)', stats.outside === 0, stats.outsideFirst);
C.check(`stack used (KFAR included) <= ${STACK_BOUND} bytes: max ${stats.stackMax}`, stats.stackBad === 0);
C.check('no DI, IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run, before section 5): ${pre.wsum}`, pre.w === 0);
C.check(`memory watch of BANKING 10.7 during section 5: ${env.w.n - pre.w} violation(s)`, env.w.n === pre.w, env.w.summary());
C.check(`V_FRAMES rose by 1 every normal frame: ${framesBad.checked} frames checked, ${framesBad.vfbad} wrong, no DI across a frame`, framesBad.checked >= 12 && framesBad.vfbad === 0 && framesBad.n === 0, framesBad.first);
console.log(`longest call ${stats.tMax} T (${stats.tMaxDesc})`);
for (const [k, v] of Object.entries(timing)) console.log(`  ${k}: ${v} T`);
C.done();
