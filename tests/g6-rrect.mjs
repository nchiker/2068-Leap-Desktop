"use strict";
// g6-rrect.mjs -- G_RRECT in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/PAINT.md 18 (G_RRECT's contract: GA = x, y, w, h; GA+8 = pattern pointer (DOCK 6); GA+10 = rx, GA+12 = ry (words; cut to w / 2, h / 2, rx to 255, ry to 100); GA+14 = mode (byte:
// 0 outline, 1 the inside first by G_PATFILL REPLACE, then the outline); GOP = the outline's op (SET or CLR); clipped to GCLIP; the exact corner / inset algorithm),
// PAINT 15-17 (context), docs/BANKING.md (KFAR, the mappings) and tests/g6-patfill.mjs (the method).  src/gfx6/rrect.asm was used only to find names (the GA clobber and the scratch ranges).
//   node tests/g6-rrect.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random shapes (default 700)
// Method: tk-lib's bootParked; each call is made from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_RRECT / ret`: KFAR to chunk 6) with random registers (IX random: it must come back);
// GOP and the clip are set directly; the pattern pointer is PATTAB + k (k a multiple of 8, sometimes any offset 0..120).  The whole 512 x 192 screen is compared with
// tests/gfx6-model.mjs (Gfx6Model.rrect, written from the contract's text) after every call.  Also: mapping R at entry and for every access made from code in $C000-$DFFF; no write to
// $C000-$DFFF; no RAM outside the display files, GA ($E000-$E00F: clobbered by contract), the hot scratch ($E0D0-$E0F5, $E050-$E057, $E01A-$E07F), the stack window and KFAR's cells changed;
// the stack <= 128 bytes; no DI; IX, IY and the alternate set kept; GOP and GCLIP kept; the mapping back to K; then normal frames run with V_FRAMES +1 each, a shape drawn between frames.
// Exit code 1 on any failure.  The last line is "g6-rrect: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';
import { M, Z } from './lib.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 700);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random shapes`);
const C = checks('g6-rrect');
const rng = makeRng(SEED);
const STUB = 0x5F00;
const STACK_BOUND = 128;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_RRECT', 'PATTAB', 'GA', 'GOP', 'GCLIP', 'G_SETCLIP', 'K_FAR', 'K_FJP', 'V_SHADOW_F4', 'V_FRAMES']);
if (S.G_RRECT < 0xC000 || S.G_RRECT >= 0xE000) { C.check('G_RRECT is in chunk 6 ($C000-$DFFF)', false, hex(S.G_RRECT)); C.done(); process.exit(); }
C.check(`G_RRECT is in chunk 6 ($C000-$DFFF): ${hex(S.G_RRECT)}; PATTAB ${hex(S.PATTAB)} (DOCK 6)`, S.PATTAB >= 0xC000 && S.PATTAB + 128 <= 0xE000);

const dock6 = m.dock[6], PT0 = S.PATTAB - 0xC000;
const tab = Array.from({ length: 128 }, (_, i) => dock6[PT0 + i]);
const patAt = (off) => tab.slice(off, off + 8);

// the stub: rst $28 / DW G_RRECT / ret
m.ram[STUB] = 0xEF; m.ram[STUB + 1] = S.G_RRECT & 0xFF; m.ram[STUB + 2] = S.G_RRECT >> 8; m.ram[STUB + 3] = 0xC9;

// ---- watches -----------------------------------------------------------------------------------------------------------------------------------------
const watch = { armed: false, accR: 0, badMap: [], wrHeap: [] };
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
const entry = { n: 0, bad: [] };
const hooks = { [S.G_RRECT]: () => { entry.n++; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

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
  if (k < 0.2) return [0, 0, 512, 192];
  if (k < 0.27) return [-40, -40, 700, 400];
  if (k < 0.37) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(512, 900), rng.int(0, 190), 30, 30], [5, rng.int(192, 300), 30, 30], [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)]]);
  if (k < 0.5) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];
  if (k < 0.8) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 160), rng.int(1, 60)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};

// allowed to change: the display files, GA (clobbered), the hot scratch (rrect's, G_PATFILL's, G_FILL's), the stack window and KFAR's cells
const MAY = (a) => (a >= 0xE000 && a < 0xE010) || (a >= 0xE0D0 && a < 0xE0F6) || (a >= 0xE050 && a < 0xE058) || (a >= 0xE01A && a < 0xE080) || (a >= 0x4000 && a < 0x5800) || (a >= 0x6000 && a < 0x7800) ||
  (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);
const stats = { calls: 0, bad: 0, first: '', ops: [0, 0], modes: [0, 0], stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, tMax: 0, tMaxDesc: '', cases: {}, drawn: 0, empty: 0, gopBad: 0, lastT: 0 };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };
const mism = [];             // every model / machine mismatch: the first lines are reported in full

/** One checked call.  rx, ry: the words in GA+10 / GA+12; mode: 0 / 1; off: the pattern's offset in PATTAB. */
function shape(x, y, w, h, rx, ry, mode, off, tag = 'random') {
  const op = curOp, pat = patAt(off);
  const desc = `(x ${x}, y ${y}, w ${w}, h ${h}, rx ${rx}, ry ${ry}) mode ${mode} op ${op} pattern PATTAB+${off} [${pat.map((v) => hex(v, 2).slice(1)).join(' ')}] clip ${clipStr()}`;
  setGA(x, y, w, h, S.PATTAB + off, rx, ry, mode);
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  watch.armed = true;
  let r;
  const oc = Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));
  scr.rrect(x, y, w, h, rx, ry, mode, pat, op);
  let drew = false;
  { const c = scr.clip, xa = Math.max(G.s16(x), c.x0), xb = Math.min(G.s16(x) + G.s16(w), c.x1), ya = Math.max(G.s16(y), c.y0), yb = Math.min(G.s16(y) + G.s16(h), c.y1); drew = (G.s16(w) > 0 && G.s16(h) > 0 && xa < xb && ya < yb); }
  try { r = T.runCall(env, STUB, { ix: rng.int(0, 65535) }, { ints: true, hooks, guard: 40_000_000 }); }
  catch (e) { watch.armed = false; fail(`${tag} ${desc}: ${e.message}`); scr.loadRam(m.ram); return false; }
  watch.armed = false;
  stats.calls++; stats.ops[op]++; stats.modes[mode]++; stats.cases[tag] = (stats.cases[tag] || 0) + 1; if (drew) stats.drawn++; else stats.empty++;
  const d = scr.compareRam(m.ram);
  let ok = true;
  if (d) {
    ok = false;
    const want = scr.toBytes(); let k = 0; while (want[k] === m.ram[k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800]) k++;
    const a = k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800;
    const msg = `${tag} ${desc}: ${G.fmtDiff(d)}; first differing byte ${hex(a)} is ${hex(m.ram[a], 2)} (was ${hex(before[a], 2)}), model ${hex(want[k], 2)}`;
    mism.push(msg);
    fail(msg);
    scr.loadRam(m.ram);
  }
  if (r.stack > stats.stackMax) stats.stackMax = r.stack;
  if (r.stack > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} ${desc}: stack ${r.stack} bytes > ${STACK_BOUND}`); }
  if (r.di) { stats.di++; ok = false; fail(`${tag} ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8)).join() !== oc.join()) { stats.gopBad++; ok = false; fail(`${tag} ${desc}: GOP / GCLIP changed`); }
  if (r.sp !== 0xFF00) { ok = false; fail(`${tag} ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAY(a)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} ${desc}: RAM outside the display, GA and the scratch changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  if (r.t > stats.tMax) { stats.tMax = r.t; stats.tMaxDesc = desc; }
  stats.lastT = r.t;
  return ok;
}
const resync = () => { seedDisplay(); scr.loadRam(m.ram); };
const randOff = () => (rng.chance(0.7) ? 8 * rng.int(0, 15) : rng.int(0, 120));
const randRadii = () => {
  const q = rng.next();
  if (q < 0.15) return [0, 0];
  if (q < 0.3) return [255, 100];                                              // an oval
  if (q < 0.45) return [8, 4];                                                 // the rounded rectangle tool
  if (q < 0.65) return [rng.int(0, 12), rng.int(0, 8)];
  if (q < 0.8) return [rng.int(0, 255), rng.int(0, 100)];
  if (q < 0.9) return [rng.int(0, 1000), rng.int(0, 1000)];                    // cut to 255 / 100 (and to w / 2, h / 2)
  return [rng.pick([0, 1, 255, 256]), rng.pick([0, 1, 100, 101, 255, 256])];
};
const near = () => [rng.int(-30, 530), rng.int(-30, 220)];
function randShape() {
  const q = rng.next(), c = scr.clip;
  let x, y, w, h;
  if (q < 0.30) { [x, y] = near(); w = rng.int(1, 60); h = rng.int(1, 40); }                       // small, partly off the screen at the edges
  else if (q < 0.50) { x = rng.int(0, 400); y = rng.int(0, 150); w = rng.int(1, 512 - x); h = rng.int(1, 192 - y); }   // wholly inside, any size
  else if (q < 0.60) { x = rng.int(-20, 40); y = rng.int(-20, 40); w = rng.int(300, 512); h = rng.int(100, 192); }      // big, cut by the top left
  else if (q < 0.68) { x = 0; y = 0; w = 512 - rng.int(0, 3); h = 192 - rng.int(0, 3); }              // (nearly) the whole screen
  else if (q < 0.78) {
    if (scr.clipEmpty()) { [x, y] = near(); w = rng.int(1, 100); h = rng.int(1, 60); }
    else { x = c.x0 + rng.int(-9, 9); y = c.y0 + rng.int(-9, 9); w = c.x1 - c.x0 + rng.int(-9, 9); h = c.y1 - c.y0 + rng.int(-9, 9); }   // about the clip's size
  }
  else if (q < 0.84) { [x, y] = near(); w = rng.int(1, 4); h = rng.int(1, 200); }                  // thin
  else if (q < 0.88) { [x, y] = near(); w = rng.int(1, 520); h = rng.int(1, 4); }
  else if (q < 0.93) { x = rng.int(-300, 530); y = rng.int(-150, 220); w = rng.int(1, 800); h = rng.int(1, 400); }    // larger than the screen
  else { [x, y] = near(); w = rng.int(-300, 0); h = rng.int(-100, 60); if (rng.chance(0.5)) { w = rng.int(1, 100); h = rng.int(-100, 0); } }    // non-positive
  return [x, y, w, h];
}

// ---- 1. random shapes ------------------------------------------------------------------------------------------------------------------------------
resync(); setClip(0, 0, 512, 192); setOp(0);
for (let i = 0; i < N; i++) {
  if (i % 10 === 0) resync();
  if (i % 2 === 0) setClip(...randClip());
  setOp(rng.int(0, 1));
  const [rx, ry] = randRadii();
  shape(...randShape(), rx, ry, rng.int(0, 1), randOff(), 'random');
}
// ---- 2. every small size with a spread of radii: w, h = 1..8 (and a few larger), SET / CLR, both modes ----------------------------------------------------
setClip(0, 0, 512, 192);
{
  const RAD = [[0, 0], [1, 1], [2, 1], [3, 2], [8, 4], [255, 100], [1, 100], [255, 1], [5, 0], [0, 5]];
  let i = 0;
  for (let w = 1; w <= 9; w++) for (let h = 1; h <= 9; h++) for (const [rx, ry] of RAD) {
    if (i++ % 6 === 0) resync();
    setOp(i & 1);
    shape(rng.int(0, 500), rng.int(0, 180), w, h, rx, ry, (i >> 1) & 1, randOff(), 'small');
  }
  // sizes 10..40 on the radii the tools use, both ops, both modes, on a byte-aligned and an unaligned x
  for (const [rx, ry] of [[8, 4], [255, 100]]) for (let w = 10; w <= 40; w += 3) for (let h = 10; h <= 30; h += 4) {
    resync(); setOp(rng.int(0, 1));
    shape(rng.pick([16, 17, 21, 100, 255]), rng.int(0, 150), w, h, rx, ry, rng.int(0, 1), randOff(), 'tool-size');
  }
}
// ---- 3. big and special sizes: the picture, the screen, one pixel wide / high, ovals of every aspect ----------------------------------------------------
{
  const BIG = [[128, 32, 320, 144], [0, 0, 512, 192], [0, 0, 512, 1], [0, 0, 1, 192], [511, 191, 1, 1], [0, 0, 2, 192], [0, 0, 512, 2], [100, 20, 511, 190], [3, 5, 505, 181], [128, 32, 319, 143], [127, 31, 321, 145],
    [0, 0, 200, 192], [0, 0, 512, 100], [10, 10, 21, 3], [10, 10, 3, 21], [200, 100, 17, 17], [-100, -50, 400, 300], [300, 100, 400, 300], [-1, -1, 514, 194], [128, 32, 320, 1], [128, 32, 1, 144]];
  setClip(0, 0, 512, 192);
  for (const rc of BIG) for (const [rx, ry] of [[0, 0], [8, 4], [255, 100], [20, 10], [100, 50]]) for (const mode of [0, 1]) {
    resync(); setOp(rng.int(0, 1)); shape(...rc, rx, ry, mode, randOff(), 'big');
  }
  // non-positive sizes: nothing may be drawn
  for (const [w, h] of [[0, 0], [0, 10], [10, 0], [-1, 10], [10, -1], [-300, -300], [-32768, 5], [5, -32768], [32767, 0], [0, 32767]]) {
    resync(); setOp(rng.int(0, 1)); shape(rng.int(0, 300), rng.int(0, 100), w, h, 8, 4, rng.int(0, 1), randOff(), 'nonpositive');
  }
  // far and huge (x + w stays in 16 bits) with both radii kinds
  for (const [x, y, w, h] of [[-16384, -16384, 32767, 32767], [-100, 50, 32000, 20], [50, -100, 20, 32000], [-20000, -20000, 15000, 15000], [0, 0, 32767, 32767], [-30000, 10, 20000, 100]]) {
    resync(); setOp(rng.int(0, 1)); shape(x, y, w, h, 255, 100, rng.int(0, 1), randOff(), 'huge'); resync(); shape(x, y, w, h, 8, 4, rng.int(0, 1), randOff(), 'huge');
  }
}
// ---- 4. clips: single-pixel, thin, empty, byte-aligned ------------------------------------------------------------------------------------------------
for (const clip of [[0, 0, 512, 192], [5, 5, 1, 1], [17, 9, 1, 40], [17, 9, 40, 1], [8, 8, 8, 8], [7, 7, 10, 10], [100, 50, 0, 20], [100, 50, 20, 0], [600, 20, 30, 30], [20, 300, 30, 30], [130, 40, 1, 1], [128, 32, 320, 144], [200, 60, 64, 3]]) {
  setClip(...clip);
  for (const [rx, ry] of [[8, 4], [255, 100]]) for (const mode of [0, 1]) {
    resync(); setOp(rng.int(0, 1));
    shape(120, 28, 336, 152, rx, ry, mode, randOff(), 'clip');
    shape(clip[0] - 3, clip[1] - 3, clip[2] + 6, clip[3] + 6, rx, ry, mode, randOff(), 'clip');
    shape(rng.int(100, 300), rng.int(30, 100), rng.int(10, 120), rng.int(8, 60), rx, ry, mode, randOff(), 'clip');
  }
}
resync();
setClip(100, 50, 0, 20); setOp(0); shape(0, 0, 512, 192, 255, 100, 1, 16, 'empty-clip');     // empty clip: the display must stay as seeded
setClip(0, 0, 512, 192); setOp(0);

// ---- 5. timings: interrupts on but none can fire (no frame is run), so no ISR is in the figure --------------------------------------------------------
const timing = {};
{
  setClip(0, 0, 512, 192);
  for (const [name, op, x, y, w, h, rx, ry, mode, off] of [
    ['320 x 144 oval, outline', 0, 128, 32, 320, 144, 255, 100, 0, 16], ['320 x 144 oval, filled 50% checker', 0, 128, 32, 320, 144, 255, 100, 1, 16],
    ['320 x 144 oval, filled solid', 0, 128, 32, 320, 144, 255, 100, 1, 0], ['100 x 50 rounded rectangle 8 x 4, outline', 0, 130, 40, 100, 50, 8, 4, 0, 16],
    ['100 x 50 rounded rectangle 8 x 4, filled', 0, 130, 40, 100, 50, 8, 4, 1, 16], ['320 x 144 rounded rectangle 8 x 4, outline', 0, 128, 32, 320, 144, 8, 4, 0, 16],
    ['320 x 144 rounded rectangle 8 x 4, filled', 0, 128, 32, 320, 144, 8, 4, 1, 16], ['320 x 144 plain rectangle (0 x 0), filled', 0, 128, 32, 320, 144, 0, 0, 1, 16],
    ['512 x 192 oval, filled', 0, 0, 0, 512, 192, 255, 100, 1, 16], ['320 x 144 oval, filled, unaligned x = 131', 0, 131, 32, 320, 144, 255, 100, 1, 16],
    ['320 x 144 oval, CLR outline', 1, 128, 32, 320, 144, 255, 100, 0, 16]]) {
    resync(); setOp(op);
    shape(x, y, w, h, rx, ry, mode, off, 'timing');
    timing[name] = stats.lastT;
  }
  setOp(0);
}

// ---- 6. frames: normal frames after the shapes, V_FRAMES +1 each, a shape drawn between frames (no DI held across a frame) --------------------------------
const framesBad = { n: 0, first: '', checked: 0, vfbad: 0 };
{
  watch.armed = false;
  const cpu = m.cpu;
  cpu.pc = S.T_RET; cpu.iff1 = cpu.iff2 = false; cpu.halted = false; cpu.sp = 0xFF00;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart >= 58688; k++) { if (m.tstates < m.frameStart + 58688) m.tstates = m.frameStart + 58688; M.runFrame(m); }
  cpu.iff1 = cpu.iff2 = true;
  setClip(0, 0, 512, 192); setOp(0);
  for (let i = 0; i < 13; i++) {
    const v0 = L.rd16(m, S.V_FRAMES);
    M.runFrame(m);
    let g = 0; while (cpu.pc !== S.T_RET && ++g < 20000) Z.runZ80(cpu, m.bus, 1, m);
    if (cpu.pc !== S.T_RET) { framesBad.n++; framesBad.first ||= `frame ${i}: the ISR did not return to the parked loop (PC ${hex(cpu.pc)})`; break; }
    cpu.iff1 = cpu.iff2 = true;
    const dv = (L.rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
    if (i > 0) framesBad.checked++;
    if (i > 0 && dv !== 1) { framesBad.vfbad++; framesBad.first ||= `frame ${i}: V_FRAMES ${v0} -> ${v0 + dv}`; }
    setGA(10 + 10 * i, 10, 100 + 10 * i, 40 + 5 * i, S.PATTAB + 8 * (i & 15), i & 1 ? 255 : 8, i & 1 ? 100 : 4, i & 2 ? 1 : 0);
    const cat = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 40_000_000 });
    if (cat.di || m.portF4 !== 0x33) { framesBad.n++; framesBad.first ||= `frame ${i}: di ${cat.di}, port ${hex(m.portF4, 2)}`; }
    cpu.pc = S.T_RET; cpu.sp = 0xFF00; cpu.iff1 = cpu.iff2 = true;
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------
const cs = stats.cases, nCases = Object.values(cs).reduce((a, b) => a + b, 0);
C.check(`display after every call equals the reference model: ${stats.calls} shapes compared (ops SET/CLR ${stats.ops.join('/')}; modes outline/filled ${stats.modes.join('/')}; ${stats.drawn} drew pixels, ${stats.empty} drew nothing; ${Object.entries(cs).map(([k, v]) => `${k} ${v}`).join(', ')})`,
  stats.bad === 0 && stats.calls === nCases && stats.calls >= N, stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check(`G_SETCLIP behaved as specified on the way`, setupBad === 0, setupFirst);
C.check(`G_RRECT ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.calls && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls', watch.wrHeap.length === 0, watch.wrHeap.join(' | '));
C.check('GOP and GCLIP kept by every call (GA is clobbered by contract)', stats.gopBad === 0);
C.check('no RAM written outside the display files, GA, the scratch $E0D0-$E0F5 / $E050-$E057 / $E01A-$E07F, the stack window and KFAR cells (whole 64 KB compared after every call)', stats.outside === 0, stats.outsideFirst);
C.check(`stack used (KFAR included) <= ${STACK_BOUND} bytes: max ${stats.stackMax}`, stats.stackBad === 0);
C.check('no DI, IX (random each call), IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run): ${env.w.summary()}`, env.w.n === 0);
C.check(`V_FRAMES rose by 1 every normal frame: ${framesBad.checked} frames checked, ${framesBad.vfbad} wrong, no DI across a frame`, framesBad.checked >= 12 && framesBad.vfbad === 0 && framesBad.n === 0, framesBad.first);
console.log(`longest call ${stats.tMax} T (${stats.tMaxDesc})`);
for (const [k, v] of Object.entries(timing)) console.log(`  ${k}: ${v} T`);
if (mism.length) { console.log(`${mism.length} mismatch(es); the first ${Math.min(mism.length, 12)}:`); mism.slice(0, 12).forEach((s) => console.log('  ' + s)); }
C.done();
