"use strict";
// gfx6-s3.mjs -- slice S3 of the graphics spike (docs/GRAPHICS_SPIKE.md sections 8, 12, 14 and 15): G_LINE, G_BLIT, G_SAVERECT /
// G_RESTRECT and G_SCROLLV on the `gfx6t` cartridge.  Every call is compared with the reference model (tests/gfx6-model.mjs) over
// the whole 512 x 192 screen, with clip safety (poisoned RAM including the save buffer T_BUF, the blit data in T_STR guarded),
// register preservation, GA / GOP / GLH / GCLIP unchanged, the returned HL of G_SAVERECT and the longest-DI measurement.
// Written from the contract (section 15), never from the code.
//   node tests/gfx6-s3.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default from the clock); a failure is reproduced with the same seed
//     --n N      random calls per routine (default 600, contract minimum 500)
import { checks } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, changed, poison, snapshot, checkPoison, seedDisplay, setGA, readClip, opClipBytes, hex, s16,
  NEEDED, NEEDED_S3, T_STR, T_BUF, T_BUF_END, POISON_REGIONS, poisonRegionsWithout, PRESERVED } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const N = argVal('--n', 600);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random calls per routine`);

const C = checks('gfx6 S3');
const BASE = ['G_INIT', 'G_SETOP', 'G_SETCLIP', 'GA', 'GOP', 'GCLIP', 'T_IDLE', 'T_RET', 'RESULT'];
const ctx = start(C, [...NEEDED.filter((n) => BASE.includes(n)), ...NEEDED_S3]);
if (!ctx) { console.log('the gfx6t cartridge (with the S3 symbols) is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const scr = new G.Gfx6Model();
const STR = S.T_STR ?? T_STR;                                       // $D000, 512 bytes: blit data
const BUF = S.T_BUF ?? T_BUF;                                       // $C000, 4 KB: save-under buffer
const BUF_LIMIT = 0xD000;                                           // 4 + nc x nr must fit before this (15.3)

// ---------------------------------------------------------------------------------------------------------------------------
// Per-category bookkeeping: one PASS/FAIL line per category, with the first failing call in full.
const allCats = [];
class Cat {
  constructor(name) { this.name = name; this.calls = 0; this.bad = 0; this.first = ''; allCats.push(this); }
  record(desc, probs) {
    this.calls++;
    if (probs.length) { this.bad++; if (!this.first) this.first = `${desc}: ${probs.join('; ')}`; }
  }
  report(extra = '') {
    C.check(this.name, this.bad === 0, this.bad ? `${this.bad} of ${this.calls} calls failed, first: ${this.first}` : `${this.calls} calls${extra}`);
  }
}
const support = new Cat('support calls (G_SETOP / G_SETCLIP) behave as specified');
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
const resync = () => { seedDisplay(m, rng); scr.loadRam(m.ram); };
const GA_LEN = 16;

// ---- settings: the real G_SETOP / G_SETCLIP routines (S1), mirrored in the model ----------------------------------------------
function setOp(op) {
  call(m, S, 'G_SETOP', { a: op }, { rng });
  scr.setOp(op);
  support.record(`G_SETOP ${op}`, m.ram[S.GOP] === op ? [] : [`GOP = ${m.ram[S.GOP]}, want ${op}`]);
}
function setClip(x, y, w, h) {
  setGA(m, S, x, y, w, h);
  call(m, S, 'G_SETCLIP', {}, { rng });
  scr.setClip(x, y, w, h);
  const c = readClip(m, S), p = [];
  if (scr.clipEmpty()) { if (c[0] < c[1] && c[2] < c[3]) p.push(`GCLIP ${c} is not empty, want an empty clip`); }
  else if (c.join() !== [scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1].join()) p.push(`GCLIP = ${c}, want ${[scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1]}`);
  support.record(`G_SETCLIP (${x}, ${y}, ${w}, ${h})`, p);
}
const fullClip = () => setClip(0, 0, 512, 192);

/**
 * One checked call.  words: the GA words (x, y, w, h, [a8]) -- GA+10..GA+15 and, when `words` is shorter, the rest get random
 * values, so "GA unchanged" means something.  o: { regs, model (applies the call to the model), regions (poison), tok (an
 * existing token instead of fresh poison), skip ([lo, hi): bytes the routine may write), guard, ints, diOut, post(r) -> problems,
 * keepRam: [[addr, len]] ranges that must be unchanged }.  Checks: the whole screen against the model, poison, SP, the interrupt
 * flag, IX / IY / the alternate set, GA (16 bytes) / GOP / GLH / GCLIP unchanged, the longest DI.
 */
function exec(cat, routine, words, desc, o = {}) {
  setGA(m, S, ...words);
  for (let i = 2 * words.length; i < GA_LEN; i++) m.ram[S.GA + i] = rng.byte();
  const gaBefore = Array.from(m.ram.subarray(S.GA, S.GA + GA_LEN)), ocBefore = opClipBytes(m, S);
  const keep = (o.keepRam || []).map(([a, n]) => [a, m.ram.slice(a, a + n)]);
  const tok = o.tok || poison(m, rng, { regions: o.regions || POISON_REGIONS });
  const probs = [];
  let r = null;
  try { r = call(m, S, routine, o.regs || {}, { rng, ints: !!o.ints, guard: o.guard }); }
  catch (e) { probs.push(e.message); }
  if (o.model) o.model();
  const d = scr.compareRam(m.ram);
  if (d) { probs.push(G.fmtDiff(d)); scr.loadRam(m.ram); }
  const pz = checkPoison(m, tok, o.skip);
  if (pz) probs.push(`wrote outside what it may write (display files, [buf, buf + 4 + nc nr)) or below the 32-byte stack allowance: ${hex(pz.addr)} is ${hex(pz.got, 2)}, was ${hex(pz.want, 2)} (${pz.n} bytes changed)`);
  for (const [a, copy] of keep) if (copy.some((v, i) => m.ram[a + i] !== v)) probs.push(`the bytes at ${hex(a)}..${hex(a + copy.length - 1)} changed`);
  if (r) {
    if (r.sp !== 0xFF00) probs.push(`SP ${hex(r.sp)} after the call, want $FF00`);
    if (r.iff1 !== !!o.ints) probs.push(`interrupt flag ${r.iff1}, found ${!!o.ints}`);
    const ch = changed(r, PRESERVED);
    if (ch.length) probs.push(`not preserved: ${ch.join(', ')}`);
    if (opClipBytes(m, S).join() !== ocBefore.join()) probs.push('GOP / GLH / GCLIP changed');
    if (Array.from(m.ram.subarray(S.GA, S.GA + GA_LEN)).join() !== gaBefore.join()) probs.push('GA changed');
    if (o.ints && r.maxDiRun > 1500) probs.push(`longest DI run ${r.maxDiRun} T > 1500`);
    if (o.diOut) o.diOut(r);
    if (o.post) probs.push(...o.post(r));
  }
  cat.record(`${desc} op=${scr.op} clip=${clipStr()} (call ${cat.calls + 1})`, probs);
  return r;
}

// ---- random ingredients ------------------------------------------------------------------------------------------------------
const randClip = () => {
  const k = rng.next();
  if (k < 0.15) return [0, 0, 512, 192];
  if (k < 0.2) return [-40, -40, 700, 400];
  if (k < 0.3) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(0, 500), rng.int(0, 190), -rng.int(1, 9), rng.int(1, 50)], [rng.int(512, 900), rng.int(0, 190), 30, 30], [rng.int(-200, -40), 5, 30, 30],
    [5, rng.int(192, 300), 30, 30], [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)]]);
  if (k < 0.5) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];
  if (k < 0.8) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 160), rng.int(1, 60)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};
/** A new clip now and then, a new op every call; the display is re-seeded every `every` calls. */
const randSetup = (i, { every = 40, clipEvery = 3 } = {}) => {
  if (i % every === 0) resync();
  if (i % clipEvery === 0) setClip(...randClip());
  setOp(rng.int(0, 2));
};
const XS = [0, 7, 8, 15, 16, 255, 256, 503, 504, 511];
const YS = [0, 1, 7, 8, 63, 64, 100, 184, 185, 190, 191];

// ===========================================================================================================================
// 1. G_LINE
const lineGuard = (a) => 300_000 + 600 * G.Gfx6Model.lineLength(...a);
function line(cat, x0, y0, x1, y1, o = {}) {
  const a = [x0, y0, x1, y1];
  return exec(cat, 'G_LINE', a, `G_LINE (${x0}, ${y0})-(${x1}, ${y1})`, { model: () => scr.line(...a), guard: lineGuard(a), ...o });
}
function randLine() {
  const q = rng.next(), c = scr.clip, near = () => [rng.int(-20, 530), rng.int(-20, 212)], far = () => [rng.int(-16384, 16383), rng.int(-16384, 16383)];
  const clampW = (v) => Math.max(-16384, Math.min(16383, v));
  let x0, y0, x1, y1, p;
  if (q < 0.34) { [x0, y0] = near(); [x1, y1] = near(); }
  else if (q < 0.44) { [x0, y0] = near(); x1 = x0 + rng.int(-6, 6); y1 = y0 + rng.int(-6, 6); }
  else if (q < 0.56) {                                               // both ends inside the clip (when it is not empty)
    if (scr.clipEmpty()) { [x0, y0] = near(); [x1, y1] = near(); }
    else { x0 = rng.int(c.x0, c.x1 - 1); y0 = rng.int(c.y0, c.y1 - 1); x1 = rng.int(c.x0, c.x1 - 1); y1 = rng.int(c.y0, c.y1 - 1); }
  } else if (q < 0.64) {                                             // ties and special slopes
    [x0, y0] = near();
    const d = rng.int(1, 120), k = rng.int(0, 7);
    [x1, y1] = [[d, 0], [0, d], [d, d], [d, -d], [2 * d, d], [d, 2 * d], [-d, 2 * d + 1], [2 * d + 1, -d]][k].map((v, i) => v + (i ? y0 : x0));
  } else if (q < 0.70) { p = near(); [x0, y0] = p; x1 = x0; y1 = y0; }          // a point
  else if (q < 0.76) { [x0, y0] = near(); [x1, y1] = far(); if (rng.chance(0.5)) { [x0, y0, x1, y1] = [x1, y1, x0, y0]; } }
  else if (q < 0.80) { [x0, y0] = far(); [x1, y1] = far(); }
  else if (q < 0.90) { [x0, y0] = near(); [x1, y1] = [x0 + rng.int(-700, 700), y0 + rng.int(-400, 400)]; }
  else { x0 = rng.pick(XS) + rng.int(-1, 1); y0 = rng.pick(YS) + rng.int(-1, 1); x1 = rng.pick(XS) + rng.int(-1, 1); y1 = rng.pick(YS) + rng.int(-1, 1); }
  return [clampW(x0), clampW(y0), clampW(x1), clampW(y1)];
}
{
  const cat = new Cat(`random G_LINE, ${N} calls (every op, random clips incl. empty / tiny, ends off-screen and negative, some across -16384..16383, short, ties, points)`);
  for (let i = 0; i < N; i++) { randSetup(i, { every: 25, clipEvery: 2 }); line(cat, ...randLine()); }
  cat.report();
  fullClip(); setOp(0);
}

// 1.1 edge cases
resync(); fullClip(); setOp(0);
{
  const cat = new Cat('edge G_LINE: all small steps (dx, dy) in -9..9 from (100, 100): every octant, ties, dmaj = 0, rotating op');
  let i = 0;
  for (let dx = -9; dx <= 9; dx++) for (let dy = -9; dy <= 9; dy++) {
    if (i % 40 === 0) resync();
    setOp(i++ % 3);
    line(cat, 100, 100, 100 + dx, 100 + dy);
  }
  cat.report();

  const oct = new Cat('edge G_LINE: the eight octants (slopes 1:3 .. 3:1 and the diagonals) from x in {0,7,8,15,16,255,256,503,504,511}, every op');
  i = 0;
  const dirs = [[40, 13], [13, 40], [-13, 40], [-40, 13], [-40, -13], [-13, -40], [13, -40], [40, -13], [30, 30], [-30, 30], [30, -30], [-30, -30], [41, 20], [20, 41], [61, 30]];
  for (const x of XS) for (const [dx, dy] of dirs) for (let op = 0; op < 3; op++) {
    if (i++ % 60 === 0) resync();
    setOp(op);
    line(oct, x, 90, x + dx, 90 + dy);
  }
  oct.report();

  const pt = new Cat('edge G_LINE: single pixels (x0 = x1, y0 = y1) at the x list x the y list x every op, plus off-screen points');
  i = 0;
  for (const x of XS) for (const y of YS) for (let op = 0; op < 3; op++) {
    if (i++ % 80 === 0) resync();
    setOp(op);
    line(pt, x, y, x, y);
  }
  for (const [x, y] of [[-1, 0], [0, -1], [512, 0], [0, 192], [-16384, -16384], [16383, 16383], [-16384, 16383], [511, 192], [512, 191]]) for (let op = 0; op < 3; op++) { setOp(op); line(pt, x, y, x, y); }
  pt.report();

  const hv = new Cat('edge G_LINE: horizontal and vertical lines of 1..18 pixels at the x list / y list (both byte-column parities, file boundaries), both directions');
  i = 0;
  for (const x of XS) for (let len = 0; len <= 17; len++) for (const y of [0, 7, 8, 191]) {
    if (i++ % 60 === 0) resync();
    setOp(i % 3);
    line(hv, x, y, x + len, y);
    line(hv, x + len, y, x, y);
  }
  for (const y of YS) for (let len = 0; len <= 17; len += 1) for (const x of [0, 7, 8, 255, 256, 511]) {
    if (i++ % 60 === 0) resync();
    setOp(i % 3);
    line(hv, x, y, x, y + len);
    line(hv, x, y + len, x, y);
  }
  hv.report();

  const co = new Cat('edge G_LINE: corner to corner (0,0)-(511,191) and the three other pairs, both directions, every op; screen edges; lines along the edges');
  const corners = [[0, 0, 511, 191], [511, 191, 0, 0], [0, 191, 511, 0], [511, 0, 0, 191], [0, 0, 511, 0], [511, 0, 0, 0], [0, 191, 511, 191], [0, 0, 0, 191], [511, 0, 511, 191],
    [0, 0, 512, 192], [-1, -1, 512, 192], [0, 100, 511, 100], [255, 0, 256, 191], [256, 191, 255, 0], [0, 0, 191, 191], [191, 191, 0, 0]];
  i = 0;
  for (const a of corners) for (let op = 0; op < 3; op++) { if (i++ % 6 === 0) resync(); setOp(op); line(co, ...a); }
  co.report();

  // 1.2 clip edges: the same line under clips that touch its pixels at +-1.
  const ce = new Cat('edge G_LINE: clip edges cutting a line at the exact pixel (clip x0/x1/y0/y1 inside the line and +-1), every op');
  i = 0;
  const L = [[20, 20, 200, 90], [200, 90, 20, 20], [20, 90, 200, 20], [30, 15, 90, 160], [90, 160, 30, 15]];
  for (const a of L) for (const dx0 of [-1, 0, 1]) for (const dx1 of [-1, 0, 1]) for (const dy0 of [-1, 0, 1]) for (const dy1 of [-1, 0, 1]) {
    if (i++ % 30 === 0) resync();
    setOp(i % 3);
    const x0 = 60 + dx0, x1 = 150 + dx1, y0 = 40 + dy0, y1 = 80 + dy1;
    setClip(x0, y0, x1 - x0, y1 - y0);
    line(ce, ...a);
  }
  setClip(100, 50, 1, 1); for (const a of L) line(ce, ...a);
  setClip(0, 0, 512, 192);
  ce.report();

  // 1.3 empty clip.
  const em = new Cat('empty clip: G_LINE leaves the display untouched (bytes compared directly, not with the model)');
  for (const clip of [[10, 10, 0, 5], [10, 10, 5, 0], [10, 10, -5, 5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5], [512, 0, 5, 5]]) {
    setClip(...clip);
    for (let op = 0; op < 3; op++) {
      resync(); setOp(op);
      const before = [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
      line(em, 0, 0, 511, 191); line(em, 10, 10, 10, 10); line(em, -16384, -16384, 16383, 16383);
      const same = m.ram.slice(0x4000, 0x5800).every((v, k) => v === before[0][k]) && m.ram.slice(0x6000, 0x7800).every((v, k) => v === before[1][k]);
      em.record(`empty clip ${clip} op ${op}`, same ? [] : ['display changed']);
    }
  }
  em.report();
  fullClip(); setOp(0);

  // 1.4 long clipped lines (keep a few: they may be slow).
  const lg = new Cat('long G_LINE: (-16384,-16384)-(16383,16383), (-16384,0)-(16383,191), both directions, horizontal / vertical across the whole range, every op');
  const longs = [[-16384, -16384, 16383, 16383], [16383, 16383, -16384, -16384], [-16384, 0, 16383, 191], [16383, 191, -16384, 0], [-16384, 100, 16383, 100],
    [0, -16384, 0, 16383], [511, 16383, 511, -16384], [-16384, 16383, 16383, -16384], [-16384, -1000, 16383, 1000]];
  i = 0;
  for (const a of longs) for (let op = 0; op < 3; op++) {
    if (i++ % 3 === 0) resync();
    setOp(op);
    if (i % 4 === 0) setClip(100, 20, 77, 31); else fullClip();
    line(lg, ...a);
  }
  lg.report();
  fullClip(); setOp(0);

  // 1.5 XOR twice restores; both directions against the model.
  const xr = new Cat('G_LINE XOR: the same ends in the same order twice restore the display bytes exactly; XOR A-B then XOR B-A restores them too (same pixels either order); both match the model');
  setOp(2);
  const bytes = () => [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
  const sameBytes = (b0) => m.ram.slice(0x4000, 0x5800).every((v, j) => v === b0[0][j]) && m.ram.slice(0x6000, 0x7800).every((v, j) => v === b0[1][j]);
  for (let k = 0; k < 60; k++) {
    resync();
    if (k % 3 === 0) setClip(...randClip()); else if (k % 3 === 1) fullClip();
    const a = k < 40 ? randLine() : [rng.int(-40, 560), rng.int(-30, 230), rng.int(-40, 560), rng.int(-30, 230)];
    const b0 = bytes();
    line(xr, ...a); line(xr, ...a);
    xr.record(`XOR twice (${a})`, sameBytes(b0) ? [] : ['the display bytes are not the original after XOR-ing the same line twice']);
    line(xr, ...a); line(xr, a[2], a[3], a[0], a[1]);
    xr.record(`XOR A-B then B-A (${a})`, sameBytes(b0) ? [] : ['the display bytes are not the original after XOR A-B then XOR B-A (the pixels must not depend on the order of the ends)']);
  }
  xr.report();
  fullClip(); setOp(0);
}

// ===========================================================================================================================
// 2. G_BLIT
/** Blit data: wb pairs a row, h rows; columns w..8 wb - 1 are transparent (mask 1, image 0).  style picks the mask / image shape. */
function blitData(w, h, style = 0) {
  const wb = (w + 7) >> 3, d = [];
  for (let k = 0; k < h; k++) for (let b = 0; b < wb; b++) {
    let mk, im;
    switch (style) {
      case 1: mk = 0xFF; im = rng.byte(); break;                                // OR the image
      case 2: mk = 0x00; im = rng.byte(); break;                                // replace
      case 3: mk = 0xFF; im = 0x00; break;                                      // transparent
      case 4: mk = 0x00; im = 0x00; break;                                      // clear
      case 5: mk = 0x00; im = 0xFF; break;                                      // solid
      case 6: im = rng.byte(); mk = (~im & 0xFF) | (rng.chance(0.5) ? 0 : rng.byte()); break;   // sprite: image bits clear the mask there
      default: mk = rng.byte(); im = rng.byte();
    }
    if (b === wb - 1) { const pad = (1 << (8 * wb - w)) - 1; mk |= pad; im &= ~pad & 0xFF; }
    d.push(mk & 0xFF, im & 0xFF);
  }
  return d;
}
const BLIT_REGIONS = poisonRegionsWithout(STR, STR + 511);
const psCat = new Cat('G_PRESHIFT (built before every G_BLIT call, any w, h 1..32, w <= 0 / h <= 0, destination anywhere in T_BUF): HL = dest + 16 h (wb + 1), the set equals the model\'s byte for byte, writes exactly [dest, HL), T_STR unchanged');
/** First difference between the set in RAM at `dest` and the model's, as text ("" when equal). */
function setDiff(dest, want, w, h) {
  const wb = (w + 7) >> 3, ws = wb + 1;
  for (let i = 0; i < want.length; i++) if (m.ram[dest + i] !== want[i]) {
    const p = Math.floor(i / (2 * h * ws)), k = Math.floor((i % (2 * h * ws)) / (2 * ws)), q = Math.floor((i % (2 * ws)) / 2);
    return `set byte ${i} (copy ${p}, row ${k}, pair ${q}, ${i & 1 ? 'image' : 'mask'}) = ${hex(m.ram[dest + i], 2)}, want ${hex(want[i], 2)}`;
  }
  return '';
}
/**
 * G_PRESHIFT of the source bitmap `data` (placed at STR + off) into `dest` (in T_BUF), then G_BLIT from that set (15.3): the set is
 * built first and checked byte for byte; G_BLIT gets GA+8 = the set and must leave T_BUF and T_STR unchanged.
 */
function blit(cat, x, y, w, h, data, o = {}) {
  const off = o.off ?? rng.int(0, 512 - Math.max(data.length, 1));
  for (let i = 0; i < 512; i++) m.ram[STR + i] = rng.byte();                    // garbage around the data (a read past or before it shows)
  for (let i = 0; i < data.length; i++) m.ram[STR + off + i] = data[i];
  const ok = w > 0 && h > 0, wb = (Math.max(w, 0) + 7) >> 3, size = ok ? 16 * h * (wb + 1) : 0;
  const dest = o.dest ?? BUF + (rng.chance(0.3) ? 0 : rng.int(0, 0x1000 - size));
  const want = scr.preshift(w, h, data);
  exec(psCat, 'G_PRESHIFT', [rng.int(-9999, 9999), rng.int(-9999, 9999), w, h, STR + off, dest], `G_PRESHIFT ${w} x ${h} src@+${off} dest=${hex(dest)}`, {
    regions: BLIT_REGIONS, skip: [dest, dest + size], keepRam: [[STR, 512]], ints: o.ints, diOut: o.psDiOut, guard: o.psGuard,
    post: (r) => [...(r.regs.hl === dest + size ? [] : [`HL = ${hex(r.regs.hl)}, want dest + 16 h (wb + 1) = ${hex(dest + size)}`]), ...(setDiff(dest, want, w, h) ? [setDiff(dest, want, w, h)] : [])],
  });
  return exec(cat, 'G_BLIT', [x, y, w, h, dest], `G_BLIT (${x}, ${y}) ${w} x ${h} set@${hex(dest)}`, {
    model: () => scr.blit(x, y, w, h, data), tok: snapshot(m, { regions: BLIT_REGIONS }), keepRam: [[STR, 512], [dest, size]], ints: o.ints, diOut: o.diOut, guard: o.guard,
  });
}
{
  const cat = new Cat(`random G_BLIT, ${N} calls (w, h 1..32 incl. w not a multiple of 8, 7 data styles, every op set but ignored, random clips incl. empty, off-screen and negative positions; display random)`);
  for (let i = 0; i < N; i++) {
    randSetup(i, { every: 1, clipEvery: 2 });
    const c = scr.clip, q = rng.next();
    const w = rng.chance(0.15) ? rng.pick([8, 16, 24, 32, 1, 32]) : rng.int(1, 32), h = rng.chance(0.15) ? rng.pick([1, 32, 8, 16]) : rng.int(1, 32);
    let x, y;
    if (q < 0.35) { x = rng.int(-34, 530); y = rng.int(-34, 212); }
    else if (q < 0.55) { x = c.x0 + rng.int(-w - 1, 2); y = c.y0 + rng.int(-h - 1, 2); }
    else if (q < 0.75) { x = c.x1 - rng.int(0, w + 1); y = c.y1 - rng.int(0, h + 1); }
    else if (q < 0.95) { x = rng.int(0, 512 - w); y = rng.int(0, 192 - h); }
    else { x = rng.int(-16384, 16383); y = rng.int(-16384, 16383); }
    blit(cat, x, y, w, h, blitData(w, h, rng.chance(0.6) ? 0 : rng.int(1, 6)));
  }
  cat.report();
  fullClip(); setOp(0);
}
resync(); fullClip(); setOp(0);
{
  const e1 = new Cat('edge G_BLIT: every w in 1..32 (h = 1 + w mod 32) at the x list x y in {0, 100, 191 - h + 1, -1, 191}, random styles, rotating op');
  let i = 0;
  for (let w = 1; w <= 32; w++) for (const x of XS) for (const y0 of [0, 100, -1, 191, 'bottom']) {
    const h = 1 + (w * 7) % 32, y = y0 === 'bottom' ? 192 - h : y0;
    resync(); setOp(i++ % 3);
    blit(e1, x, y, w, h, blitData(w, h, i % 5 === 0 ? 1 + (i % 6) : 0));
  }
  e1.report();

  const e2 = new Cat('edge G_BLIT: every h in 1..32 at w = 16 and w = 17, y across the top (-h..2) and bottom (190..192 - h + 3) edges, x = 8 and 13');
  i = 0;
  for (let h = 1; h <= 32; h++) for (const w of [16, 17]) for (const x of [8, 13]) for (const y of [-h, -h + 1, -1, 0, 1, 192 - h - 1, 192 - h, 192 - h + 1, 191, 192]) {
    resync(); setOp(i++ % 3);
    blit(e2, x, y, w, h, blitData(w, h));
  }
  e2.report();

  const e3 = new Cat('edge G_BLIT: 32 x 32 and 16 x 16 at x = 64 + p for p = 0..7 (both byte parities, all shifts), y = 0, 5, and with the clip cutting every edge by -1 / 0 / +1');
  i = 0;
  for (const [w, h] of [[32, 32], [16, 16], [24, 8], [1, 32], [32, 1]]) for (let p = 0; p < 8; p++) for (const y of [0, 5, 61]) {
    resync(); setOp(i++ % 3);
    blit(e3, 64 + p, y, w, h, blitData(w, h));
  }
  for (const d0 of [-1, 0, 1]) for (const d1 of [-1, 0, 1]) for (const d2 of [-1, 0, 1]) for (const d3 of [-1, 0, 1]) {
    resync();
    setClip(70 + d0, 25 + d2, (100 + d1) - (70 + d0), (50 + d3) - (25 + d2));
    blit(e3, 67, 22, 32, 32, blitData(32, 32));
    blit(e3, 71, 30, 21, 19, blitData(21, 19, 2));
  }
  fullClip();
  e3.report();

  const e4 = new Cat('edge G_BLIT: w <= 0 or h <= 0 draws nothing (w = 0, -1, -16384; h = 0, -1); empty clip draws nothing; one-pixel clips; fully off-screen');
  i = 0;
  for (const [w, h] of [[0, 8], [8, 0], [-1, 8], [8, -1], [-16384, 5], [5, -16384], [0, 0], [-3, -3]]) { resync(); blit(e4, 20, 20, w, h, blitData(8, 8), { off: i++ }); }
  for (const clip of [[10, 10, 0, 5], [10, 10, 5, 0], [10, 10, -5, 5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5], [512, 0, 5, 5]]) {
    setClip(...clip);
    for (let op = 0; op < 3; op++) {
      resync(); setOp(op);
      const before = [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
      blit(e4, 0, 0, 32, 32, blitData(32, 32)); blit(e4, 8, 8, 9, 9, blitData(9, 9));
      const same = m.ram.slice(0x4000, 0x5800).every((v, k) => v === before[0][k]) && m.ram.slice(0x6000, 0x7800).every((v, k) => v === before[1][k]);
      e4.record(`empty clip ${clip} op ${op}`, same ? [] : ['display changed']);
    }
  }
  fullClip();
  for (let k = 0; k < 20; k++) { setClip(rng.int(0, 480), rng.int(0, 160), 1, 1); resync(); blit(e4, rng.int(-5, 480), rng.int(-5, 160), 32, 32, blitData(32, 32)); }
  fullClip();
  for (const [x, y] of [[512, 0], [0, 192], [-32, 0], [0, -32], [512, 192], [-16384, 5], [16383, 5], [5, 16383], [5, -16384], [-33, -33], [511, 191], [-31, -31], [-1, -1]]) { resync(); blit(e4, x, y, 32, 32, blitData(32, 32)); }
  e4.report();

  const e5 = new Cat('edge G_BLIT: mask / image semantics: new = (old AND m) OR i per pixel: transparent, clear, solid, OR, replace over random and all-ink / all-paper screens');
  i = 0;
  for (const bg of [0, 1, 2]) for (const style of [1, 2, 3, 4, 5, 6, 0]) for (const [w, h] of [[8, 8], [13, 5], [32, 32], [3, 2]]) {
    if (bg === 0) resync(); else { m.ram.fill(bg === 1 ? 0xFF : 0, 0x4000, 0x5800); m.ram.fill(bg === 1 ? 0xFF : 0, 0x6000, 0x7800); scr.loadRam(m.ram); }
    setOp(i++ % 3);
    blit(e5, rng.int(0, 480), rng.int(0, 150), w, h, blitData(w, h, style));
  }
  e5.report();
  resync(); setOp(0);
}

{
  const cat = new Cat('G_PRESHIFT alone: every w in 1..32 x h in {1, 2, 17, 32} x 7 data styles, destination at the start / end of T_BUF and at odd addresses; w <= 0 / h <= 0 writes nothing (HL = dest, T_BUF unchanged)');
  let i = 0;
  const run = (w, h, data, dest, off) => {
    for (let k = 0; k < 512; k++) m.ram[STR + k] = rng.byte();
    for (let k = 0; k < data.length; k++) m.ram[STR + off + k] = data[k];
    const ok = w > 0 && h > 0, wb = (Math.max(w, 0) + 7) >> 3, size = ok ? 16 * h * (wb + 1) : 0, want = scr.preshift(w, h, data);
    exec(cat, 'G_PRESHIFT', [rng.int(-9999, 9999), rng.int(-9999, 9999), w, h, STR + off, dest], `G_PRESHIFT ${w} x ${h} src@+${off} dest=${hex(dest)}`, {
      regions: BLIT_REGIONS, skip: [dest, dest + size], keepRam: [[STR, 512]],
      post: (r) => [...(r.regs.hl === dest + size ? [] : [`HL = ${hex(r.regs.hl)}, want ${hex(dest + size)}`]), ...(setDiff(dest, want, w, h) ? [setDiff(dest, want, w, h)] : [])],
    });
  };
  for (let w = 1; w <= 32; w++) for (const h of [1, 2, 17, 32]) {
    const size = 16 * h * (((w + 7) >> 3) + 1), data = blitData(w, h, i % 7);
    if (i++ % 5 === 0) { resync(); setOp(i % 3); setClip(...randClip()); }
    run(w, h, data, [BUF, BUF_LIMIT - size, BUF + 1, BUF_LIMIT - size - 1][i % 4], rng.int(0, 512 - data.length));
  }
  for (const [w, h] of [[0, 8], [8, 0], [-1, 8], [8, -1], [-16384, 5], [5, -16384], [0, 0], [-3, -3], [-1, -1]]) { resync(); run(w, h, blitData(8, 8), BUF + 5 + i++, 3); run(w, h, blitData(8, 8), BUF_LIMIT - 1, 0); }
  cat.report();
  fullClip(); setOp(0);
}

// ===========================================================================================================================
// 3. G_SAVERECT / G_RESTRECT, as pairs and nested (15.3)
/** A random rectangle for save / restore; w, h shrunk until 4 + nc x nr fits in the remaining room. */
function randSaveRect(room) {
  const q = rng.next();
  let x, y, w, h;
  if (q < 0.40) { x = rng.int(-20, 520); y = rng.int(-10, 200); w = rng.int(0, 200); h = rng.int(0, 100); }
  else if (q < 0.55) { x = 8 * rng.int(0, 63); y = rng.int(0, 191); w = 8 * rng.int(0, 30); h = rng.int(0, 90); }
  else if (q < 0.65) { x = rng.int(-16384, 16383); y = rng.int(-16384, 16383); w = rng.int(0, 16383); h = rng.int(0, 16383); }
  else if (q < 0.75) { x = rng.int(-4, 512); y = rng.int(-4, 192); w = rng.int(1, 3); h = rng.int(1, 3); }
  else if (q < 0.82) { x = rng.int(-100, 100); y = rng.int(-100, 100); w = rng.pick([0, -1, -50, 5]); h = rng.pick([5, 0, -1, -50]); }
  else if (q < 0.9) { x = rng.int(-30, 40); y = rng.int(-30, 40); w = rng.int(500, 700); h = rng.int(1, 100); }       // runs off the right edge
  else { x = rng.int(0, 511); y = rng.int(0, 191); w = rng.int(1, 600); h = rng.int(1, 300); }
  for (let k = 0; k < 40; k++) {
    const br = scr.byteRect(x, y, w, h);
    if (4 + br.nc * br.nr <= room) break;
    if (h > 1 && (br.nr >= br.nc || w <= 1)) h = Math.max(1, h >> 1); else if (w > 1) w = Math.max(1, w >> 1); else h = Math.max(1, h >> 1);
  }
  if (4 + scr.byteRect(x, y, w, h).nc * scr.byteRect(x, y, w, h).nr > room) { w = 0; }
  return [x, y, w, h];
}
/** Change the display (random bytes, a random fill, an inversion or a clear around the rectangle) and mirror it in the model. */
function mutateDisplay(rect) {
  const k = rng.next(), px = scr.px;
  if (k < 0.3) { resync(); return 'random'; }
  const br = scr.byteRect(...rect);
  let xa = 8 * br.c0 - rng.int(0, 9), xb = 8 * (br.c0 + br.nc) + rng.int(0, 9), ya = br.y0 - rng.int(0, 4), yb = br.y0 + br.nr + rng.int(0, 4);
  if (br.nc === 0) { xa = rng.int(0, 400); xb = xa + rng.int(1, 100); ya = rng.int(0, 150); yb = ya + rng.int(1, 40); }
  xa = Math.max(0, xa); ya = Math.max(0, ya); xb = Math.min(512, xb); yb = Math.min(192, yb);
  const kind = k < 0.6 ? 0 : k < 0.7 ? 1 : k < 0.8 ? 2 : 3;
  for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) {
    const i = y * 512 + x;
    px[i] = kind === 0 ? rng.byte() & 1 : kind === 1 ? 1 : kind === 2 ? 0 : px[i] ^ 1;
  }
  scr.storeRam(m.ram);
  return ['bytes', 'fill', 'clear', 'invert'][kind];
}
const saveCat = new Cat(`random G_SAVERECT, ${N} calls (as pairs and nested; every op and clip set but ignored; rectangles off-screen, negative, empty, huge, 1 x 1; buffer anywhere in T_BUF; HL = buf + 4 + nc nr)`);
const restCat = new Cat(`random G_RESTRECT, ${N} calls (the pairs above: byte rectangle back, everything else as it was after the change; all of T_BUF unchanged)`);

/** G_SAVERECT of `rect` into `buf`; returns { snap (the model's), end (the expected HL) }.  The poison token is taken before the call. */
function doSave(rect, buf, o = {}) {
  const snap = scr.saveRect(...rect), end = buf + snap.size, tok = snapshot(m);
  exec(o.cat || saveCat, 'G_SAVERECT', [...rect, buf], `G_SAVERECT (${rect}) buf=${hex(buf)} nc=${snap.nc} nr=${snap.nr}`, {
    tok, skip: [buf, end], ints: o.ints, diOut: o.diOut, guard: o.guard,
    post: (r) => (r.regs.hl === end ? [] : [`HL = ${hex(r.regs.hl)}, want buf + 4 + nc nr = ${hex(end)}`]),
  });
  return { snap, end, buf };
}
/** G_RESTRECT from `buf`: the model puts the saved pixels back. */
function doRestore(s, o = {}) {
  const tok = snapshot(m);
  exec(o.cat || restCat, 'G_RESTRECT', [], `G_RESTRECT buf=${hex(s.buf)} nc=${s.snap.nc} nr=${s.snap.nr}`, {
    tok, regs: { hl: s.buf }, model: () => scr.restoreRect(s.snap), ints: o.ints, diOut: o.diOut, guard: o.guard,
  });
}
// A sequence: poison everything once (including T_BUF), then save, change, save, change, ... and restore in reverse.
function sequence(depth, o = {}) {
  resync();
  poison(m, rng);
  setClip(...randClip()); setOp(rng.int(0, 2));
  let buf = BUF + (rng.chance(0.5) ? 0 : rng.int(0, 200)), room = BUF_LIMIT - buf;
  const stack = [];
  for (let d = 0; d < depth; d++) {
    const rect = o.rects ? o.rects[d] : randSaveRect(room);
    const s = doSave(rect, buf, o);
    stack.push(s);
    buf = s.end; room = BUF_LIMIT - buf;
    if (room < 8) break;
    mutateDisplay(rect);
    if (rng.chance(0.25)) setClip(...randClip());
  }
  for (let d = stack.length - 1; d >= 0; d--) {
    if (d < stack.length - 1 || rng.chance(0.5)) mutateDisplay(stack[d].snap.nc ? [8 * stack[d].snap.c0, stack[d].snap.y0, 8 * stack[d].snap.nc, stack[d].snap.nr] : [0, 0, 0, 0]);
    doRestore(stack[d], o);
  }
}
while (saveCat.calls < N) sequence(rng.pick([1, 1, 1, 2, 2, 3]));
saveCat.report(); restCat.report();
fullClip(); setOp(0);

resync();
{
  // 3.1 edge cases: the byte-rectangle rule at the x list, widths 0..17, rows at the edges, as pairs.
  const cat = new Cat('edge G_SAVERECT / G_RESTRECT pairs: x in {0,7,8,15,16,255,256,503,504,511} x w in 0..17 x (y, h) in {(0,1), (5,9), (191,1), (190,2), (-1,3), (190,5)}');
  let i = 0;
  const hs = [[0, 1], [5, 9], [191, 1], [190, 2], [-1, 3], [190, 5]];
  for (const x of XS) for (let w = 0; w <= 17; w++) {
    const [y, h] = hs[i++ % hs.length];
    const q = [x, y, w, h];
    resync(); poison(m, rng);
    const s = doSave(q, BUF + (i % 3), { cat });
    mutateDisplay(q);
    doRestore(s, { cat });
  }
  // rectangles crossing every file boundary / third / character-row boundary
  for (const q of [[0, 0, 512, 6], [8, 60, 40, 8], [8, 62, 16, 4], [100, 62, 33, 6], [0, 7, 9, 2], [504, 0, 8, 192 - 1], [3, 63, 17, 2], [255, 0, 2, 20], [256, 187, 100, 5], [0, 100, 512, 1]]) {
    resync(); poison(m, rng);
    const br = scr.byteRect(...q);
    if (4 + br.nc * br.nr > BUF_LIMIT - BUF) continue;
    const s = doSave(q, BUF + 1, { cat });
    mutateDisplay(q);
    doRestore(s, { cat });
  }
  cat.report(`; ${i} rectangles`);

  const big = new Cat('G_SAVERECT / G_RESTRECT: the largest rectangles that fit T_BUF (4 KB): 4092 bytes of screen at full width and at full height; buffer at the very start and end of T_BUF');
  for (const q of [[0, 0, 512, 63], [0, 0, 20, 192], [8, 0, 160, 25], [-50, -50, 600, 63], [496, 0, 16, 192]]) {
    const br = scr.byteRect(...q), size = 4 + br.nc * br.nr;
    if (size > BUF_LIMIT - BUF) continue;
    for (const buf of [BUF, BUF_LIMIT - size]) {
      resync(); poison(m, rng);
      const s = doSave(q, buf, { cat: big });
      mutateDisplay(q);
      doRestore(s, { cat: big });
    }
  }
  big.report();

  const emp = new Cat('G_SAVERECT of an empty / off-screen rectangle: HL = buf + 4, nothing else written, nothing displayed changes; its restore changes nothing');
  for (const q of [[0, 0, 0, 5], [0, 0, 5, 0], [0, 0, -4, 5], [-20, 0, 20, 5], [512, 0, 5, 5], [0, 192, 5, 5], [0, -9, 5, 9], [-16384, -16384, 100, 100], [16383, 16383, 100, 100]]) {
    resync(); poison(m, rng);
    const s = doSave(q, BUF + 7, { cat: emp });
    emp.record(`empty ${q}: model nc ${s.snap.nc} nr ${s.snap.nr}`, s.snap.nc === 0 && s.snap.nr === 0 && s.end === BUF + 11 ? [] : ['model disagrees about emptiness']);
    mutateDisplay([5, 5, 50, 50]);
    doRestore(s, { cat: emp });
  }
  emp.report();

  const nest = new Cat('nested G_SAVERECT / G_RESTRECT: the same and overlapping rectangles saved one after another (each save after the last), restored in reverse');
  for (let k = 0; k < 40; k++) {
    const base = [rng.int(0, 400), rng.int(0, 120), rng.int(1, 60), rng.int(1, 40)];
    const rects = [base, [base[0] + rng.int(-9, 9), base[1] + rng.int(-5, 5), base[2] + rng.int(-5, 20), base[3] + rng.int(-4, 12)], base, [rng.int(0, 480), rng.int(0, 160), rng.int(1, 30), rng.int(1, 20)]];
    sequence(rects.length, { rects, cat: undefined });
    nest.record(`nested sequence ${k} ran`, []);
  }
  nest.report(' sequences of 4 saves and 4 restores; each call is checked and counted in the random G_SAVERECT / G_RESTRECT categories');
  fullClip(); setOp(0);
}

// ===========================================================================================================================
// 4. G_SCROLLV
function scroll(cat, x, y, w, h, n, o = {}) {
  return exec(cat, 'G_SCROLLV', [x, y, w, h, n], `G_SCROLLV (${x}, ${y}, ${w}, ${h}) n=${n}`, { model: () => scr.scrollv(x, y, w, h, n), ...o });
}
const nChoices = (nr) => rng.pick([0, 1, -1, 7, -7, 8, -8, nr, -nr, nr + 1, -(nr + 1), nr - 1, -(nr - 1), nr + 9, rng.int(-3, 3), rng.int(-nr - 3, nr + 3), rng.int(-20, 20), 16383, -16384, rng.int(-16384, 16383)]);
{
  const cat = new Cat(`random G_SCROLLV, ${N} calls (n in 0, +-1, +-7, +-8, +-rows, beyond; aligned and unaligned rectangles and clips, incl. empty; display random every call; op set but ignored)`);
  for (let i = 0; i < N; i++) {
    randSetup(i, { every: 1, clipEvery: 2 });
    const q = rng.next(), c = scr.clip;
    let x, y, w, h;
    if (q < 0.3) { x = 8 * rng.int(0, 60); y = rng.int(0, 150); w = 8 * rng.int(1, 40); h = rng.int(1, 100); }                     // byte-aligned
    else if (q < 0.55) { x = rng.int(-20, 480); y = rng.int(-10, 190); w = rng.int(1, 300); h = rng.int(1, 120); }
    else if (q < 0.65) { x = 8 * rng.int(0, 62) + rng.int(-1, 1); y = rng.int(0, 190); w = 8 * rng.int(1, 8) + rng.int(-2, 2); h = rng.int(1, 30); }
    else if (q < 0.75) { x = rng.int(-30, 40); y = rng.int(-10, 20); w = rng.int(480, 700); h = rng.int(150, 250); }                // whole screen and more
    else if (q < 0.85) { x = c.x0 + rng.int(-9, 9); y = c.y0 + rng.int(-4, 4); w = c.x1 - c.x0 + rng.int(-9, 9); h = c.y1 - c.y0 + rng.int(-4, 4); }
    else if (q < 0.92) { x = rng.int(0, 511); y = rng.int(0, 191); w = rng.int(1, 16); h = rng.int(1, 5); }                         // tiny
    else { x = rng.int(-16384, 16383); y = rng.int(-16384, 16383); w = rng.int(-5, 16383); h = rng.int(-5, 16383); }
    const reg = scr.scrollRegion(x, y, w, h);
    scroll(cat, x, y, w, h, nChoices(reg ? reg.nr : 8));
  }
  cat.report();
  fullClip(); setOp(0);
}
resync(); fullClip(); setOp(0);
{
  const e1 = new Cat('edge G_SCROLLV: whole screen (0,0,512,192) and (-30,-30,600,300), n = 0, +-1, +-7, +-8, +-9, +-10, +-96, +-191, +-192, +-193, 16383, -16384');
  let i = 0;
  for (const n of [0, 1, -1, 7, -7, 8, -8, 9, -9, 10, -10, 96, -96, 191, -191, 192, -192, 193, -193, 16383, -16384]) for (const r of [[0, 0, 512, 192], [-30, -30, 600, 300]]) {
    resync(); setOp(i++ % 3);
    scroll(e1, ...r, n);
  }
  e1.report();

  const e2 = new Cat('edge G_SCROLLV: byte columns of either parity: x in 0..40 (step 1) with w = 24 and w = 17 (whole bytes = ceil(x/8) .. floor((x+w)/8) - 1), n = +-1, +-3');
  i = 0;
  for (let x = 0; x <= 40; x++) for (const w of [24, 17, 8, 9, 15, 16]) for (const n of [1, -3]) {
    if (i++ % 3 === 0) resync();
    setOp(i % 3);
    scroll(e2, x, 10, w, 12, n);
  }
  for (const x of XS) for (const w of [8, 16, 24, 33, 65]) for (const n of [1, -1, 5, -9]) { resync(); scroll(e2, x, 70, w, 20, n); }
  e2.report();

  const e3 = new Cat('edge G_SCROLLV: partial edge bytes left alone: an unaligned x / w over an all-ink and a random screen; empty regions (no whole byte column, h = 0, w = 0, off screen)');
  i = 0;
  for (const bg of [1, 0]) for (const [x, w] of [[3, 30], [1, 14], [7, 10], [7, 9], [5, 11], [0, 7], [0, 8], [8, 7], [504, 8], [505, 7], [500, 30], [-5, 14], [-5, 13], [0, 513], [1, 511], [200, 1]]) for (const n of [1, -1, 4, 100]) {
    if (bg) { m.ram.fill(0xFF, 0x4000, 0x5800); m.ram.fill(0xFF, 0x6000, 0x7800); scr.loadRam(m.ram); } else resync();
    setOp(i++ % 3);
    scroll(e3, x, 20, w, 9, n);
  }
  for (const [x, y, w, h] of [[8, 20, 16, 0], [8, 20, 0, 5], [8, 20, -16, 5], [8, 20, 16, -5], [-100, 20, 16, 5], [600, 20, 16, 5], [8, -50, 16, 20], [8, 200, 16, 5], [8, 191, 16, 1], [8, 0, 16, 1], [8, 20, 16, 1], [8, 20, 8, 1], [16383, 16383, 8, 8], [-16384, -16384, 8, 8]]) for (const n of [1, -1, 0, 3]) { resync(); scroll(e3, x, y, w, h, n); }
  e3.report();

  const e4 = new Cat('edge G_SCROLLV: rows across the thirds and character rows (y = 5..9 and 60..70, 188..), one row, n = 1 / -1 / rows / rows - 1, both file parities');
  i = 0;
  for (const y of [0, 5, 6, 7, 8, 9, 55, 56, 62, 63, 64, 65, 70, 127, 128, 135, 183, 184, 186]) for (const h of [1, 2, 3, 9, 20]) for (const n of [1, -1, h, h - 1, -h]) {
    if (i++ % 4 === 0) resync();
    setOp(i % 3);
    scroll(e4, 8 * rng.int(0, 60), y, 8 * rng.int(1, 3), h, n);
  }
  e4.report();

  const e5 = new Cat('edge G_SCROLLV: the clip limits the region (clip not on byte columns: its partial bytes are left alone); clip edges +-1 around byte columns, rows; empty clip');
  i = 0;
  for (const d0 of [-1, 0, 1]) for (const d1 of [-1, 0, 1]) for (const d2 of [-1, 0, 1]) for (const d3 of [-1, 0, 1]) for (const n of [1, -2]) {
    if (i++ % 3 === 0) resync();
    setOp(i % 3);
    setClip(24 + d0, 30 + d2, (80 + d1) - (24 + d0), (60 + d3) - (30 + d2));
    scroll(e5, 0, 0, 512, 192, n);
    scroll(e5, 10, 35, 200, 20, n);
  }
  for (const clip of [[10, 10, 0, 5], [10, 10, 5, 0], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5]]) {
    setClip(...clip);
    resync();
    const before = [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
    scroll(e5, 0, 0, 512, 192, 3);
    const same = m.ram.slice(0x4000, 0x5800).every((v, k) => v === before[0][k]) && m.ram.slice(0x6000, 0x7800).every((v, k) => v === before[1][k]);
    e5.record(`empty clip ${clip}`, same ? [] : ['display changed']);
  }
  fullClip();
  e5.report();
  setOp(0);
}

// ===========================================================================================================================
// 5. Longest DI (section 7): each routine stepped from iff1 = true.
{
  const cat = new Cat('longest DI run <= 1,500 T, interrupt flag as found, in G_LINE / G_BLIT / G_PRESHIFT / G_SAVERECT / G_RESTRECT / G_SCROLLV (stepped with interrupts on)');
  let worst = 0, worstName = '';
  const di = (name) => (r) => { if (r.maxDiRun > worst) { worst = r.maxDiRun; worstName = name; } };
  fullClip();
  for (let k = 0; k < 4; k++) {
    resync(); setOp(k % 3); if (k === 3) setClip(...randClip());
    line(cat, 0, 0, 511, 191, { ints: true, diOut: di('G_LINE') });
    line(cat, 300, 190, 10, 3, { ints: true, diOut: di('G_LINE') });
    line(cat, -16384, -16384, 16383, 16383, { ints: true, diOut: di('G_LINE'), guard: 12_000_000 });
    line(cat, -16384, 0, 16383, 191, { ints: true, diOut: di('G_LINE'), guard: 12_000_000 });
    blit(cat, 67 + k, 5, 32, 32, blitData(32, 32), { ints: true, diOut: di('G_BLIT'), psDiOut: di('G_PRESHIFT'), psGuard: 12_000_000 });
    blit(cat, 66, 100, 16, 16, blitData(16, 16), { ints: true, diOut: di('G_BLIT'), psDiOut: di('G_PRESHIFT') });
    scroll(cat, 0, 0, 512, 192, 8, { ints: true, diOut: di('G_SCROLLV') });
    scroll(cat, 8, 10, 256, 96, -1, { ints: true, diOut: di('G_SCROLLV') });
    scroll(cat, 0, 0, 512, 192, -192, { ints: true, diOut: di('G_SCROLLV') });
    fullClip();
    poison(m, rng);
    const a = [[64 + 8 * (k & 1), 3, 96, 80], [0, 0, 512, 8 * 6]];
    const s1 = doSave(a[0], BUF, { cat, ints: true, diOut: di('G_SAVERECT') });
    mutateDisplay(a[0]);
    const s2 = doSave(a[1], s1.end, { cat, ints: true, diOut: di('G_SAVERECT') });
    mutateDisplay(a[1]);
    doRestore(s2, { cat, ints: true, diOut: di('G_RESTRECT') });
    doRestore(s1, { cat, ints: true, diOut: di('G_RESTRECT') });
  }
  cat.report(`, longest DI run ${worst} T (${worstName || 'none'})`);
  fullClip(); setOp(0);
}

psCat.report(' (one before every G_BLIT call, plus the standalone category above)');
support.report();
const bad = allCats.filter((c) => c.bad).length;
console.log(`${allCats.length} categories, ${allCats.reduce((s, c) => s + c.calls, 0)} checked calls, ${bad} failing categories; seed ${SEED}`);
C.done();
