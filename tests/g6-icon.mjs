"use strict";
// g6-icon.mjs -- G_ICON in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/ICON.md 1 (the call: GA = x, y, w, h, GA+8 = a pointer to h rows of w / 8 bytes, bit 7 leftmost, 1 = ink, rows packed; x and w multiples of 8, w <= 512, h <= 192;
// the pixels inside GCLIP are REPLACED, a partial edge byte keeps the outside pixels; GA kept; GOP ignored; scratch $E050-$E05C), docs/BANKING.md (KFAR, the mappings) and
// tests/g6-patfill.mjs (the method).  src/gfx6/icon.asm was used only to find names.
//   node tests/g6-icon.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random calls (default 700)
// Method: tk-lib's bootParked; each call is made from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_ICON / ret`: KFAR to chunk 6); the clip is set through G_SETCLIP.  The bitmap is in
// DOCK 6 (the ICON_ / TICON_ tables, any other bytes of the chunk, and the free bytes after G6_END, filled with random bytes by the test) or in cold RAM ($7800..$7FFF, random bytes written
// through the machine before the call).  The whole 512 x 192 screen is compared with the model `iconModel` (below) after every call.  Also: mapping R at entry and for every access made
// from code in $C000-$DFFF; no write to $C000-$DFFF; no RAM outside the display files, the stack window, KFAR's cells and the scratch changed; G_ICON's own stack <= 32 bytes (calls made
// with interrupts off, so no ISR pushes are in the figure); no DI (calls with interrupts on); GA kept; the mapping back to K.  The 14 real icons are drawn and compared with the art text files.
// Exit code 1 on any failure.  The last line is "g6-icon: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';
import { ICONART } from './shell-model.mjs';
import { ICONS as TOOLART, ICONNAMES } from './pt-model.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 700);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random icon calls`);
const C = checks('g6-icon');
const rng = makeRng(SEED);
const STUB = 0x5F00;
const STACK_BOUND = 32;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_ICON', 'G6_END', 'ICON_CALC', 'ICON_KEYS', 'ICON_WRITE', 'ICON_PAINT', 'TICON_MARQUEE', 'GA', 'GOP', 'GCLIP', 'G_SETCLIP', 'K_FAR', 'V_SHADOW_F4']);
for (const n of ICONNAMES) T.needSyms(env, ['TICON_' + n]);
if (S.G_ICON < 0xC000 || S.G_ICON >= 0xE000) { C.check('G_ICON is in chunk 6 ($C000-$DFFF)', false, hex(S.G_ICON)); C.done(); process.exit(); }
C.check(`G_ICON is in chunk 6 ($C000-$DFFF): ${hex(S.G_ICON)}; G6_END ${hex(S.G6_END)}`, S.G6_END <= 0xE000 && S.G6_END > S.G_ICON);

// the stub: rst $28 / DW G_ICON / ret
m.ram[STUB] = 0xEF; m.ram[STUB + 1] = S.G_ICON & 0xFF; m.ram[STUB + 2] = S.G_ICON >> 8; m.ram[STUB + 3] = 0xC9;

// DOCK 6's free bytes (after G6_END) must be unused filler: all equal.  Then the test fills them with random bytes (they are bitmap sources only).
const dock6 = m.dock[6], FREE0 = S.G6_END, FREEN = 0xE000 - S.G6_END;
const filler = dock6[FREE0 - 0xC000];
const freeIsFiller = FREEN > 0 && Array.from({ length: FREEN }, (_, i) => dock6[FREE0 - 0xC000 + i]).every((v) => v === filler);
C.check(`DOCK 6 after G6_END: ${FREEN} free bytes, all ${hex(filler, 2)} (unused filler; the test overwrites them with random bytes in its own machine)`, freeIsFiller || FREEN === 0);
if (freeIsFiller) for (let i = 0; i < FREEN; i++) dock6[FREE0 - 0xC000 + i] = rng.int(0, 255);
const rd = (a) => (a >= 0xC000 && a < 0xE000 ? dock6[a - 0xC000] : m.ram[a]);

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
const entry = { n: 0, bad: [], sp: 0 };      // the mapping at G_ICON's first instruction
const hooks = { [S.G_ICON]: () => { entry.n++; entry.sp = m.cpu.sp; watch.track = true; watch.stackMin = 0xFFFF; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const seedDisplay = () => { for (let a = 0x4000; a < 0x5800; a++) m.ram[a] = rng.int(0, 255); for (let a = 0x6000; a < 0x7800; a++) m.ram[a] = rng.int(0, 255); };
const setGA = (...w) => w.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
const scr = new G.Gfx6Model();
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
let setupBad = 0, setupFirst = '';
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
  if (k < 0.25) return [0, 0, 512, 192];
  if (k < 0.3) return [-40, -40, 700, 400];
  if (k < 0.4) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(512, 900), rng.int(0, 190), 30, 30], [5, rng.int(192, 300), 30, 30], [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)]]);
  if (k < 0.65) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];   // edges inside / next to a byte
  if (k < 0.85) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 160), rng.int(1, 60)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};

/** The reference: bitmap pixel (j, k) (byte k * (w / 8) + (j >> 3) at ptr, bit 7 - (j AND 7), 1 = ink) REPLACES the screen pixel (x + j, y + k) when it is inside the clip.  Nothing else changes. */
function iconModel(g, x, y, w, h, ptr) {
  x = G.s16(x); y = G.s16(y); w = G.s16(w); h = G.s16(h);
  if (w <= 0 || h <= 0) return;
  const wb = w >> 3, c = g.clip;
  for (let k = 0; k < h; k++) {
    const yy = y + k;
    if (yy < c.y0 || yy >= c.y1) continue;
    for (let j = 0; j < w; j++) {
      const xx = x + j;
      if (xx < c.x0 || xx >= c.x1) continue;
      g.px[yy * G.SCR_W + xx] = (rd(ptr + k * wb + (j >> 3)) >> (7 - (j & 7))) & 1;
    }
  }
}

const MAY = (a) => (a >= 0xE01A && a < 0xE080) || (a >= 0xE700 && a < 0xE800) || (a >= 0x4000 && a < 0x5800) || (a >= 0x6000 && a < 0x7800) || (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);
const stats = { calls: 0, bad: 0, first: '', stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, cases: {}, drawn: 0, empty: 0, gaBad: 0, intsOn: 0, srcs: {}, stackN: 0 };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };

/** One checked call: G_ICON through KFAR from the stub, the screen against the model, and the side checks.  src names where the bitmap is (for the report). */
function icon(x, y, w, h, ptr, tag = 'random', src = 'dock6', intsOn = false) {
  const desc = `(${x}, ${y}, ${w}, ${h}) bitmap ${hex(ptr)} (${src}) clip ${clipStr()}`;
  setGA(x, y, w, h, ptr);
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  const ga = Array.from(m.ram.subarray(S.GA, S.GA + 10)), oc = Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));
  iconModel(scr, x, y, w, h, ptr);
  const c = scr.clip, xa = Math.max(G.s16(x), c.x0), xb = Math.min(G.s16(x) + G.s16(w), c.x1), ya = Math.max(G.s16(y), c.y0), yb = Math.min(G.s16(y) + G.s16(h), c.y1);
  const area = (xa < xb && ya < yb) ? (xb - xa) * (yb - ya) : 0;
  const ints = intsOn && area <= 6000;
  watch.armed = true; watch.track = false;
  let r;
  try { r = T.runCall(env, STUB, {}, { ints, hooks, guard: 6_000_000 }); }
  catch (e) { watch.armed = false; watch.track = false; fail(`${tag} ${desc}: ${e.message}`); scr.loadRam(m.ram); return false; }
  watch.armed = false; const tracked = watch.track; watch.track = false;
  stats.calls++; stats.cases[tag] = (stats.cases[tag] || 0) + 1; stats.srcs[src] = (stats.srcs[src] || 0) + 1; if (area) stats.drawn++; else stats.empty++;
  if (ints) stats.intsOn++;
  let ok = true;
  const d = scr.compareRam(m.ram);
  if (d) {
    ok = false;
    const want = scr.toBytes(); let k = 0; while (want[k] === m.ram[k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800]) k++;
    const a = k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800;
    fail(`${tag} icon ${desc}: ${G.fmtDiff(d)}; first differing byte ${hex(a)} is ${hex(m.ram[a], 2)} (was ${hex(before[a], 2)}), model ${hex(want[k], 2)}`);
    scr.loadRam(m.ram);
  }
  if (!ints && tracked) {            // G_ICON's own pushes: the lowest stack address written after its first instruction
    const depth = watch.stackMin === 0xFFFF ? 0 : Math.max(0, entry.sp - watch.stackMin);
    stats.stackN++; if (depth > stats.stackMax) stats.stackMax = depth;
    if (depth > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} icon ${desc}: G_ICON's stack ${depth} bytes > ${STACK_BOUND}`); }
  }
  if (r.di) { stats.di++; ok = false; fail(`${tag} icon ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} icon ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} icon ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GA, S.GA + 10)).join() !== ga.join() || Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8)).join() !== oc.join()) { stats.gaBad++; ok = false; fail(`${tag} icon ${desc}: GA / GOP / GCLIP changed`); }
  if (r.sp !== 0xFF00) { ok = false; fail(`${tag} icon ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAY(a)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} icon ${desc}: RAM outside the display and stack changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  stats.lastT = r.t; stats.lastArea = area;
  return ok;
}
const resync = () => { seedDisplay(); scr.loadRam(m.ram); };
const fillRam = () => { for (let a = 0x7800; a < 0x8000; a++) m.ram[a] = rng.int(0, 255); };

// ---- bitmap sources ----------------------------------------------------------------------------------------------------------------------------------
const TAB0 = S.ICON_CALC, TAB1 = S.G6_END;          // the icon tables (shell's four, then Paint's ten) end at G6_END
/** A random bitmap pointer for S bytes: { ptr, src }.  Sources: the icon tables, any DOCK 6 bytes (code and data), the free bytes after G6_END, cold RAM ($7800..$7FFF). */
function pickSource(size) {
  const k = rng.next();
  if (k < 0.3 && TAB1 - TAB0 >= size) return { ptr: rng.int(TAB0, TAB1 - size), src: 'tables' };
  if (k < 0.5 && FREEN >= size && freeIsFiller) return { ptr: rng.int(FREE0, 0xE000 - size), src: 'free6' };
  if (k < 0.7 && size <= 0x2000) return { ptr: rng.int(0xC000, 0xE000 - size), src: 'dock6' };
  if (size <= 0x800) { fillRam(); return { ptr: rng.pick([0x7800, 0x7800, rng.int(0x7800, 0x8000 - size)]), src: 'cold' }; }
  if (size <= 0x2000) return { ptr: rng.int(0xC000, 0xE000 - size), src: 'dock6' };
  return null;
}
function randCall() {
  for (;;) {
    const q = rng.next();
    let w, h;
    if (q < 0.25) { w = 8 * rng.int(1, 6); h = rng.int(1, 40); }
    else if (q < 0.4) { w = rng.pick([16, 32]); h = rng.pick([16, 16, 8, 15, 17]); }
    else if (q < 0.7) { w = 8 * rng.int(1, 64); h = rng.int(1, 32); }
    else if (q < 0.85) { w = 8 * rng.int(1, 24); h = rng.int(1, 192); }
    else { w = rng.pick([8, 64, 128, 256, 512]); h = rng.pick([1, 2, 3, 8, 16, 31]); }
    if (w > 512) w = 512;
    const size = (w >> 3) * h, s = pickSource(size);
    if (!s) continue;
    const t = rng.next(), c = scr.clip;
    let x, y;
    if (t < 0.5) { x = 8 * rng.int(-8, 64); y = rng.int(-30, 200); }
    else if (t < 0.7 && !scr.clipEmpty()) { x = (c.x0 & ~7) + 8 * rng.int(-3, 3); y = c.y0 + rng.int(-20, 8); }
    else if (t < 0.8) { x = 8 * rng.int(-(w >> 3) - 2, 0); y = rng.int(-h, 192); }            // hanging off the left
    else if (t < 0.9) { x = 8 * rng.int(56, 70); y = rng.int(-h, 192); }                          // hanging off / past the right
    else if (t < 0.95) { x = 8 * rng.pick([-2000, -1000, -80, 80, 90, 2000]); y = rng.int(-20, 200); }
    else { x = 8 * rng.int(-8, 64); y = rng.pick([-16384, -300, -200, 192, 250, 16000]); }
    return [x, y, w, h, s.ptr, s.src];
  }
}

// ---- 1. random calls ---------------------------------------------------------------------------------------------------------------------------------
resync(); setClip(0, 0, 512, 192);
for (let i = 0; i < N; i++) {
  if (i % 20 === 0) resync();
  if (i % 2 === 0) setClip(...randClip());
  const [x, y, w, h, ptr, src] = randCall();
  icon(x, y, w, h, ptr, 'random', src, rng.chance(0.4));
}
// ---- 2. edge cases -------------------------------------------------------------------------------------------------------------------------------------
const edgeSrc = [['dock6', 0xC000], ['tables', TAB0], ['free6', FREE0], ['cold', 0x7800]];
const EDGES = [[0, 0, 512, 1, 64], [0, 191, 512, 1, 64], [0, 0, 8, 192, 1], [504, 0, 8, 192, 1], [504, 100, 16, 10, 2], [-8, 100, 16, 10, 2], [-8, -8, 16, 16, 2], [504, 184, 16, 16, 2], [0, 0, 8, 1, 1], [504, 191, 8, 1, 1],
  [-520, 10, 512, 8, 64], [512, 10, 8, 8, 1], [0, 192, 8, 8, 1], [0, -8, 8, 8, 1], [128, 32, 32, 16, 4], [128, 32, 16, 16, 2], [64, 8, 8, 8, 1], [120, 40, 256, 24, 32], [-16384, 10, 16, 4, 2], [16384, 10, 16, 4, 2],
  [8, 5, 64, 1, 8], [0, -1, 8, 2, 1], [0, 191, 8, 2, 1]];
const EDGECLIPS = [[0, 0, 512, 192], [5, 5, 1, 1], [17, 9, 1, 40], [17, 9, 40, 1], [8, 8, 8, 8], [7, 7, 10, 10], [3, 3, 2, 2], [100, 50, 0, 20], [100, 50, 20, 0], [600, 20, 30, 30], [20, 300, 30, 30], [1, 1, 510, 190], [9, 0, 14, 192], [130, 36, 60, 5]];
{
  let i = 0;
  for (const clip of EDGECLIPS) {
    setClip(...clip);
    for (const [x, y, w, h, wb] of EDGES) {
      if (i++ % 6 === 0) resync();
      const size = wb === 64 && w === 512 ? 64 * h : (w >> 3) * h;
      const [src, base] = edgeSrc[i % 4];
      if (src === 'cold') fillRam();
      icon(x, y, w, h, base + (size <= 0x800 ? rng.int(0, Math.min(0x100, (src === 'cold' ? 0x800 : 0x1000) - size)) : 0), 'edge', src, i % 3 === 0);
    }
  }
}
// bitmaps at the very first and very last byte of each source
setClip(0, 0, 512, 192);
for (const [src, lo, hi] of [['dock6', 0xC000, 0xE000], ['cold', 0x7800, 0x8000]]) {
  resync(); if (src === 'cold') fillRam();
  icon(128, 40, 32, 16, lo, 'ends', src); icon(200, 40, 32, 16, hi - 64, 'ends', src); icon(8, 0, 8, 1, hi - 1, 'ends', src); icon(16, 0, 8, 2, hi - 2, 'ends', src);
}
// the clip's edges inside a byte: every (left offset, right offset) pair over an 8-column icon, a 16-column icon
for (let l = 0; l < 8; l++) for (let r = 0; r < 8; r++) {
  if (r === 0) resync();
  fillRam();
  setClip(40 + l, 10, 8 + r + 8 - l + (l > r ? 8 : 0), 5);
  icon(40, 8, 24, 8, 0x7800 + 8 * l, 'partial', 'cold', false);
  setClip(41 + l, 10, 1 + r, 5);
  icon(32, 8, 32, 8, 0x7800 + 16 * r, 'partial', 'cold', false);
}
setClip(100, 50, 0, 20); resync(); icon(0, 0, 512, 16, 0x7800, 'empty-clip', 'cold');     // empty clip: the display must stay as seeded
setClip(0, 0, 512, 192);

// ---- 3. the 14 real icons, drawn at an aligned position on a random display and compared with the art text files ---------------------------------------------
const real = { n: 0, bad: 0, first: '' };
{
  const pack = (art, r, c) => art[r][c] === '#' ? 1 : 0;
  const list = [...['CALC', 'KEYS', 'WRITE', 'PAINT'].map((n) => ({ name: 'ICON_' + n, sym: S['ICON_' + n], art: ICONART[n] })), ...ICONNAMES.map((n, i) => ({ name: 'TICON_' + n, sym: S['TICON_' + n], art: TOOLART[i] }))];
  setClip(0, 0, 512, 192);
  list.forEach((ic, k) => {
    resync();
    const x = 8 * (3 + 5 * (k % 7)), y = 10 + 20 * (k % 5) + (k > 6 ? 3 : 0);
    const ok0 = stats.bad;
    icon(x, y, 32, 16, ic.sym, 'real', 'tables');
    real.n++;
    // the screen against the art itself (not the model)
    const g = G.Gfx6Model.fromRam(m.ram);
    let diff = 0, firstD = '';
    for (let r = 0; r < 16; r++) for (let c = 0; c < 32; c++) if (g.px[(y + r) * 512 + x + c] !== pack(ic.art, r, c)) { diff++; firstD ||= `(${x + c}, ${y + r}) art row ${r} col ${c}: got ${g.px[(y + r) * 512 + x + c]}`; }
    if (diff || stats.bad > ok0) { real.bad++; real.first ||= `${ic.name} at ${hex(ic.sym)}: ${diff} pixels differ from the art${firstD ? ', first ' + firstD : ''}${stats.bad > ok0 ? '; ' + stats.first : ''}`; }
  });
}

// ---- 4. timings: an unclipped 16 x 16 and 32 x 16 icon, interrupts off -------------------------------------------------------------------------------------
const timing = {};
{
  setClip(0, 0, 512, 192);
  for (const [name, x, y, w, h, ptr] of [['16 x 16 icon, aligned, unclipped (DOCK 6 table)', 128, 32, 16, 16, S.ICON_CALC], ['32 x 16 icon, aligned, unclipped (DOCK 6 table)', 128, 32, 32, 16, S.ICON_CALC],
    ['32 x 16 icon at an odd byte column (x = 136)', 136, 32, 32, 16, S.ICON_CALC], ['32 x 16 icon from cold RAM', 128, 32, 32, 16, 0x7800], ['128 x 16 bitmap (256 bytes) from cold RAM (the marquee)', 128, 32, 128, 16, 0x7800]]) {
    resync(); fillRam();
    icon(x, y, w, h, ptr, 'timing', ptr >= 0xC000 ? 'tables' : 'cold');
    timing[name] = stats.lastT;
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------
const pre = { wr: watch.wrHeap.slice() };
const cs = stats.cases, nCases = Object.values(cs).reduce((a, b) => a + b, 0);
C.check(`display after every call equals the reference model: ${stats.calls} calls compared (${Object.entries(cs).map(([k, v]) => `${k} ${v}`).join(', ')}; bitmaps from ${Object.entries(stats.srcs).map(([k, v]) => `${k} ${v}`).join(', ')}; ${stats.drawn} drew pixels, ${stats.empty} drew nothing; ${stats.intsOn} with interrupts on)`,
  stats.bad === 0 && stats.calls === nCases && stats.calls >= N, stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check(`the 14 real icons (4 shell, 10 tool) drawn by G_ICON at an aligned position equal the art text files pixel for pixel: ${real.n} drawn, ${real.bad} wrong`, real.n === 14 && real.bad === 0, real.first);
C.check(`G_SETCLIP behaved as specified on the way`, setupBad === 0, setupFirst);
C.check(`G_ICON ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.calls && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls', pre.wr.length === 0, pre.wr.join(' | '));
C.check('GA (x, y, w, h, bitmap pointer), GOP and GCLIP kept by every call', stats.gaBad === 0);
C.check('no RAM written outside the display files, the stack window, KFAR cells and the scratch $E01A-$E07F / $E700-$E7FF (whole 64 KB compared after every call)', stats.outside === 0, stats.outsideFirst);
C.check(`G_ICON's own stack <= ${STACK_BOUND} bytes (lowest stack address written after its first instruction, ${stats.stackN} calls with interrupts off): max ${stats.stackMax}`, stats.stackN > 0 && stats.stackBad === 0);
C.check('no DI executed (calls with interrupts on), IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0 && stats.intsOn > 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run): ${env.w.summary()}`, env.w.n === 0);
for (const [k, v] of Object.entries(timing)) console.log(`  ${k}: ${v} T`);
C.done();
