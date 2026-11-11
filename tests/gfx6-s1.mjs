"use strict";
// gfx6-s1.mjs -- slice S1 of the graphics spike (docs/GRAPHICS_SPIKE.md section 8 items 1-4 and 6, section 12): G_ADDR, G_ROWADDR,
// G_SETOP, G_SETCLIP, G_INIT, G_FILL, G_HLINE, G_VLINE, G_FRAME, G_CLS on the `gfx6t` cartridge, every call compared with the
// reference model (tests/gfx6-model.mjs) over the whole 512 x 192 screen, with clip safety, register preservation and the
// longest-DI measurement.
//   node tests/gfx6-s1.mjs [--seed N] [--n N] [--quick]
//     --seed N   PRNG seed (printed; default from the clock); a failure is reproduced with the same seed
//     --n N      random calls per drawing routine (default 600, contract minimum 500)
//     --quick    G_ADDR: a dense sample (every x for 9 rows, every y for 10 columns) instead of all 98,304 pixels
import { checks } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, changed, poison, checkPoison, seedDisplay, setGA, garbageGA, readClip, opClipBytes, w16, hex, PRESERVED } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const N = argVal('--n', 600);
const QUICK = argv.includes('--quick');
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random calls per drawing routine${QUICK ? ', quick G_ADDR' : ''}`);

const C = checks('gfx6 S1');
const ctx = start(C);
if (!ctx) { console.log('the gfx6t cartridge is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const scr = new G.Gfx6Model();

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
const support = new Cat('support calls (G_INIT / G_SETOP / G_SETCLIP) behave as specified');

const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
const resync = () => { seedDisplay(m, rng); scr.loadRam(m.ram); };

/**
 * One checked call.  Builds the poison, calls `name`, applies `model()` to the model, then checks: the whole screen against the
 * model, nothing outside the display written, SP back, the interrupt flag as found, IX / IY / the alternate set (and `keep`)
 * preserved, GOP / GCLIP unchanged (unless opts.state), GA unchanged (opts.gaKept), plus opts.post(res) problems.
 */
function exec(cat, name, regs, desc, model, opts = {}) {
  const tok = poison(m, rng), gaBefore = Array.from(m.ram.subarray(S.GA, S.GA + 8)), ocBefore = opClipBytes(m, S);
  const probs = [];
  let r = null;
  try { r = call(m, S, name, regs, { rng, ints: !!opts.ints }); }
  catch (e) { probs.push(e.message); }
  model();
  const d = scr.compareRam(m.ram);
  if (d) { probs.push(G.fmtDiff(d)); scr.loadRam(m.ram); }
  const pz = checkPoison(m, tok);
  if (pz) probs.push(`wrote outside the display files (or below the 32-byte stack allowance, $FE00-$FEDD): ${hex(pz.addr)} is ${hex(pz.got, 2)}, was ${hex(pz.want, 2)} (${pz.n} bytes changed)`);
  if (r) {
    if (r.sp !== 0xFF00) probs.push(`SP ${hex(r.sp)} after the call, want $FF00`);
    if (r.iff1 !== !!opts.ints) probs.push(`interrupt flag ${r.iff1}, found ${!!opts.ints}`);
    const ch = changed(r, [...PRESERVED, ...(opts.keep || [])]);
    if (ch.length) probs.push(`not preserved: ${ch.join(', ')}`);
    if (!opts.state && opClipBytes(m, S).join() !== ocBefore.join()) probs.push('GOP / GCLIP changed');
    if (opts.gaKept && Array.from(m.ram.subarray(S.GA, S.GA + 8)).join() !== gaBefore.join()) probs.push('GA changed');
    if (opts.post) probs.push(...opts.post(r));
    if (opts.ints && r.maxDiRun > 1500) probs.push(`longest DI run ${r.maxDiRun} T > 1500`);
    if (opts.diOut) opts.diOut(r);
  }
  cat.record(`${desc} (call ${cat.calls + 1})`, probs);
  return r;
}

// ---- support routines ------------------------------------------------------------------------------------------------------
function doInit(cat = support) {
  m.ram[S.GOP] = 2;                                                 // garbage first, so G_INIT has to write
  for (let i = 0; i < 8; i++) m.ram[S.GCLIP + i] = 0x11 * (i + 1);
  exec(cat, 'G_INIT', {}, 'G_INIT', () => scr.init(), {
    state: true, keep: ['b', 'c', 'd', 'e'],
    post: () => {
      const p = [], c = readClip(m, S);
      if (m.ram[S.GOP] !== 0) p.push(`GOP = ${m.ram[S.GOP]}, want 0 (SET)`);
      if (c.join() !== '0,512,0,192') p.push(`GCLIP = ${c}, want 0,512,0,192`);
      return p;
    },
  });
}
function doSetOp(op, cat = support) {
  exec(cat, 'G_SETOP', { a: op }, `G_SETOP ${op}`, () => scr.setOp(op), {
    state: true, keep: ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'],
    post: () => (m.ram[S.GOP] === op ? [] : [`GOP = ${m.ram[S.GOP]}, want ${op}`]),
  });
}
function doSetClip(x, y, w, h, cat = support) {
  setGA(m, S, x, y, w, h);
  exec(cat, 'G_SETCLIP', {}, `G_SETCLIP (${x}, ${y}, ${w}, ${h})`, () => scr.setClip(x, y, w, h), {
    state: true, gaKept: true,
    post: () => {
      const c = readClip(m, S), p = [];
      if (c[0] < 0 || c[1] > 512 || c[0] > 512 || c[1] < 0 || c[2] < 0 || c[3] < 0 || c[2] > 192 || c[3] > 192) p.push(`GCLIP ${c} outside the screen`);
      if (scr.clipEmpty()) { if (c[0] < c[1] && c[2] < c[3]) p.push(`GCLIP ${c} is not empty, want an empty clip`); }
      else if (c.join() !== [scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1].join()) {
        p.push(`GCLIP = ${c}, want ${[scr.clip.x0, scr.clip.x1, scr.clip.y0, scr.clip.y1]}`);
      }
      return p;
    },
  });
}

// ---- drawing routines ------------------------------------------------------------------------------------------------------
const ROUTINES = ['G_FILL', 'G_HLINE', 'G_VLINE', 'G_FRAME'];
function draw(cat, routine, x, y, w, h, opts = {}) {
  const desc = `${routine} x=${x} y=${y} w=${w} h=${h} op=${scr.op} clip=${clipStr()}`;
  switch (routine) {
    case 'G_FILL':
      setGA(m, S, x, y, w, h);
      return exec(cat, routine, {}, desc, () => scr.fill(x, y, w, h), { gaKept: true, ...opts });
    case 'G_FRAME':
      setGA(m, S, x, y, w, h);
      return exec(cat, routine, {}, desc, () => scr.frame(x, y, w, h), opts);
    case 'G_HLINE':
      garbageGA(m, S, rng);                                         // the arguments are in registers: GA must not matter
      return exec(cat, routine, { hl: w16(x), de: w16(y), bc: w16(w) }, desc, () => scr.hline(x, y, w), opts);
    case 'G_VLINE':
      garbageGA(m, S, rng);
      return exec(cat, routine, { hl: w16(x), de: w16(y), bc: w16(h) }, desc, () => scr.vline(x, y, h), opts);
    default: throw new Error(routine);
  }
}

// ===========================================================================================================================
// 1. Tables in the image.
{
  const rd = (a) => m.bus.read(a);
  let bad = '';
  for (let y = 0; y < 192; y++) {
    const v = rd(S.ROWTAB + 2 * y) | (rd(S.ROWTAB + 2 * y + 1) << 8);
    if (v !== G.rowaddr(y)) { bad = `ROWTAB[${y}] = ${hex(v)}, formula ${hex(G.rowaddr(y))}`; break; }
  }
  C.check('ROWTAB (192 words) equals $4000 + (y AND $C0)*32 + (y AND 7)*256 + (y AND $38)*4', !bad, bad || hex(S.ROWTAB));
  bad = '';
  for (let i = 0; i < 8; i++) {
    if (rd(S.LMASK + i) !== G.LMASK[i]) { bad = `LMASK[${i}] = ${hex(rd(S.LMASK + i), 2)}, want ${hex(G.LMASK[i], 2)}`; break; }
    if (rd(S.RMASK + i) !== G.RMASK[i]) { bad = `RMASK[${i}] = ${hex(rd(S.RMASK + i), 2)}, want ${hex(G.RMASK[i], 2)}`; break; }
  }
  C.check('LMASK = $FF >> i and RMASK = ($FF << (7 - i)) AND $FF', !bad, bad);
  C.check('ROWTAB on a 512-byte boundary, in chunk 0-1 (below $4000), LMASK / RMASK right after it',
    S.ROWTAB % 512 === 0 && S.ROWTAB + 384 <= 0x4000 && S.LMASK === S.ROWTAB + 384 && S.RMASK === S.LMASK + 8,
    `ROWTAB ${hex(S.ROWTAB)}, LMASK ${hex(S.LMASK)}, RMASK ${hex(S.RMASK)}`);
}

// ===========================================================================================================================
// 2. G_INIT, G_SETOP.
resync();
doInit();
for (const op of [0, 1, 2, 1, 0, 2]) doSetOp(op);
doInit();

// ===========================================================================================================================
// 3. G_ADDR and G_ROWADDR.
{
  const cat = new Cat(QUICK ? 'G_ADDR dense sample' : 'G_ADDR all 512 x 192 pixels');
  const one = (x, y) => {
    const want = G.addr(x, y);
    const r = call(m, S, 'G_ADDR', { h: x >> 8, l: x & 255, e: y }, { rng });
    const p = [];
    if (r.regs.hl !== want.hl || r.regs.a !== want.mask) p.push(`HL/A = ${hex(r.regs.hl)}/${hex(r.regs.a, 2)}, want ${hex(want.hl)}/${hex(want.mask, 2)}`);
    const ch = changed(r, [...PRESERVED, 'b', 'c']);
    if (ch.length) p.push(`not preserved: ${ch.join(', ')}`);
    if (r.sp !== 0xFF00) p.push(`SP ${hex(r.sp)}`);
    if (r.iff1) p.push('interrupts enabled by the routine');
    cat.record(`G_ADDR x=${x} y=${y}`, p);
  };
  if (QUICK) {
    for (const y of [0, 1, 7, 8, 63, 64, 127, 128, 191]) for (let x = 0; x < 512; x++) one(x, y);
    for (const x of [0, 7, 8, 15, 16, 255, 256, 503, 504, 511]) for (let y = 0; y < 192; y++) one(x, y);
  } else {
    for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) one(x, y);
  }
  cat.report();

  const rows = new Cat('G_ROWADDR all 192 rows');
  for (let y = 0; y < 192; y++) {
    const r = call(m, S, 'G_ROWADDR', { a: y }, { rng }), p = [];
    if (r.regs.hl !== G.rowaddr(y)) p.push(`HL = ${hex(r.regs.hl)}, want ${hex(G.rowaddr(y))}`);
    const ch = changed(r, [...PRESERVED, 'b', 'c', 'd', 'e']);
    if (ch.length) p.push(`not preserved: ${ch.join(', ')}`);
    if (r.sp !== 0xFF00) p.push(`SP ${hex(r.sp)}`);
    rows.record(`G_ROWADDR y=${y}`, p);
  }
  rows.report();
}

// ===========================================================================================================================
// 4. G_SETCLIP, explicit and random.
{
  const cat = new Cat('G_SETCLIP: GCLIP = rectangle intersected with the screen, empty when off screen');
  const list = [[0, 0, 512, 192], [-10, -10, 20, 20], [500, 180, 100, 100], [10, 10, 5, 5], [-3000, -3000, 6000, 6000], [10, 10, 0, 5],
    [10, 10, 5, 0], [10, 10, -5, 5], [10, 10, 5, -5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5], [512, 0, 5, 5],
    [0, 192, 5, 5], [511, 191, 1, 1], [-1, -1, 2, 2], [-16384, -16384, 16383, 16383], [0, 0, 16383, 16383], [300, 100, 16383, 16383],
    [7, 63, 1, 1], [8, 64, 16, 16], [255, 127, 2, 2]];
  for (const c of list) doSetClip(...c, cat);
  for (let i = 0; i < 300; i++) {
    const k = rng.next();
    let c;
    if (k < 0.2) c = [rng.int(-600, 1100), rng.int(-250, 450), rng.int(-20, 0), rng.int(-20, 260)];
    else c = [rng.int(-600, 1100), rng.int(-250, 450), rng.int(-20, 700), rng.int(-20, 260)];
    doSetClip(...c, cat);
  }
  doSetClip(0, 0, 512, 192, cat);
  cat.report();
}

// ===========================================================================================================================
// 5. Random runs (section 8 item 2).
const randClip = () => {
  const k = rng.next();
  if (k < 0.18) return [0, 0, 512, 192];
  if (k < 0.24) return [-40, -40, 700, 400];
  if (k < 0.36) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(0, 500), rng.int(0, 190), -rng.int(1, 9), rng.int(1, 50)], [rng.int(512, 900), rng.int(0, 190), 30, 30], [rng.int(-200, -40), 5, 30, 30],
    [5, rng.int(192, 300), 30, 30]]);
  if (k < 0.7) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 60), rng.int(1, 40)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};
const randRect = () => {
  const near = rng.chance(0.6);
  const x = near ? rng.int(-20, 520) : rng.int(-600, 1100), y = near ? rng.int(-20, 200) : rng.int(-250, 450);
  const small = rng.chance(0.55);
  return [x, y, small ? rng.int(-3, 40) : rng.int(-20, 700), small ? rng.int(-3, 26) : rng.int(-20, 260)];
};
for (const routine of ROUTINES) {
  const cat = new Cat(`random ${routine}, ${N} calls (off-screen, negative, every op, random clips)`);
  for (let i = 0; i < N; i++) {
    if (i % 25 === 0) resync();
    if (i % 4 === 0) doSetClip(...randClip());
    doSetOp(rng.int(0, 2));
    draw(cat, routine, ...randRect());
  }
  cat.report();
  doSetClip(0, 0, 512, 192); doSetOp(0);
}

// ===========================================================================================================================
// 6. Edge cases written out (section 8 item 3).
const XS = [0, 7, 8, 15, 16, 255, 256, 503, 504, 511];
const YH = [[0, 1], [0, 8], [5, 3], [60, 8], [63, 2], [124, 8], [127, 2], [128, 1], [186, 6], [188, 8], [191, 1], [0, 192]];
const YS = [0, 63, 64, 127, 128, 191, 5];
const YV = [0, 56, 60, 63, 64, 120, 127, 128, 184, 188, 191];
resync(); doInit();
{
  const f = new Cat('edge G_FILL: x in {0,7,8,15,16,255,256,503,504,511} x w 0..17 x every op, thirds / character rows crossed');
  let i = 0;
  for (const x of XS) for (let w = 0; w <= 17; w++) for (let op = 0; op < 3; op++, i++) {
    if (i % 90 === 0) resync();
    doSetOp(op);
    const [y, h] = YH[i % YH.length];
    draw(f, 'G_FILL', x, y, w, h);
  }
  f.report();

  const bcs = new Cat('edge G_FILL: every byte column (even and odd, all file crossings), start offsets 0/3/7, widths 1,2,8,9,16,17');
  i = 0;
  for (let bc = 0; bc < 64; bc++) for (const off of [0, 3, 7]) for (const w of [1, 2, 8, 9, 16, 17]) {
    if (i % 100 === 0) resync();
    doSetOp(i % 3);
    const [y, h] = YH[(i++) % YH.length];
    draw(bcs, 'G_FILL', 8 * bc + off, y, w, h);
  }
  bcs.report();

  const hl = new Cat('edge G_HLINE: x set x w 0..17 x every op, rows at the third / character-row boundaries');
  i = 0;
  for (const x of XS) for (let w = 0; w <= 17; w++) for (let op = 0; op < 3; op++, i++) {
    if (i % 90 === 0) resync();
    doSetOp(op);
    draw(hl, 'G_HLINE', x, YS[i % YS.length], w, 1);
  }
  for (const y of [0, 63, 64, 100, 127, 128, 191]) for (const op of [0, 1, 2]) { doSetOp(op); draw(hl, 'G_HLINE', 0, y, 512, 1); }
  hl.report();

  const vl = new Cat('edge G_VLINE: x set x h 0..17 x every op, starts around the third boundaries; full height');
  i = 0;
  for (const x of XS) for (let h = 0; h <= 17; h++) for (let op = 0; op < 3; op++, i++) {
    if (i % 90 === 0) resync();
    doSetOp(op);
    draw(vl, 'G_VLINE', x, YV[i % YV.length], 1, h);
  }
  for (const x of XS) for (const op of [0, 1, 2]) { doSetOp(op); draw(vl, 'G_VLINE', x, 0, 1, 192); }
  vl.report();

  const fr = new Cat('edge G_FRAME: x set x w 0..17 x every op, thin rectangles (w = 1 / h = 1), full-screen frames');
  i = 0;
  for (const x of XS) for (let w = 0; w <= 17; w++) for (let op = 0; op < 3; op++, i++) {
    if (i % 90 === 0) resync();
    doSetOp(op);
    const [y, h] = YH[i % YH.length];
    draw(fr, 'G_FRAME', x, y, w, h);
  }
  for (const op of [0, 1, 2]) {
    doSetOp(op);
    for (const r of [[0, 0, 512, 192], [1, 1, 510, 190], [0, 0, 511, 191], [511, 0, 1, 192], [0, 95, 512, 1], [0, 0, 512, 2], [0, 0, 2, 192], [8, 8, 3, 3], [8, 8, 2, 2]])
      draw(fr, 'G_FRAME', ...r);
  }
  fr.report();
}

// Special rectangles x clip rectangles x ops x routines: running off the right edge and the bottom, off the left and top,
// completely off screen, zero and negative sizes, against an empty clip, a one-pixel clip, odd and byte-aligned clips.
{
  const rects = [[0, 0, 512, 192], [0, 0, 1, 1], [511, 191, 1, 1], [7, 5, 2, 3], [15, 63, 18, 3], [8, 127, 17, 2], [-5, -5, 20, 20],
    [500, 180, 30, 30], [-100, -100, 50, 50], [3, 0, 1, 192], [0, 10, 512, 1], [250, 60, 10, 70], [1, 1, 510, 190], [100, 100, 0, 10],
    [100, 100, 10, -5], [490, 185, 40, 40], [-16384, -16384, 16383, 16383], [16000, 16000, 383, 383]];
  const clips = [[0, 0, 512, 192], [10, 10, 0, 5], [600, 10, 20, 20], [7, 63, 1, 1], [3, 2, 13, 5], [8, 56, 16, 16], [256, 100, 300, 300],
    [0, 95, 512, 2], [-20, -20, 40, 40], [1, 1, 510, 190]];
  const cat = new Cat('special rectangles x clips (empty, 1 pixel, odd, byte-aligned, right/bottom edge) x every op x G_FILL/G_HLINE/G_VLINE/G_FRAME');
  let i = 0;
  for (const clip of clips) {
    doSetClip(...clip);
    for (const op of [0, 1, 2]) {
      doSetOp(op);
      for (const rect of rects) for (const routine of ROUTINES) {
        if (i++ % 150 === 0) resync();
        draw(cat, routine, ...rect);
      }
    }
  }
  cat.report();
  doSetClip(0, 0, 512, 192); doSetOp(0);

  // The empty clip explicitly, without the model: the display bytes must not change at all.
  const emp = new Cat('empty clip: the display is untouched by every drawing routine (compared byte for byte, not with the model)');
  const emptyClips = [[10, 10, 0, 5], [10, 10, 5, 0], [10, 10, -5, 5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5], [512, 0, 5, 5]];
  for (const clip of emptyClips) {
    doSetClip(...clip);
    for (const routine of ROUTINES) for (const op of [0, 1, 2]) {
      resync(); doSetOp(op);
      const before = [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
      draw(emp, routine, 0, 0, 512, 192);
      draw(emp, routine, 20, 20, 30, 30);
      const same = m.ram.slice(0x4000, 0x5800).every((v, k) => v === before[0][k]) && m.ram.slice(0x6000, 0x7800).every((v, k) => v === before[1][k]);
      emp.record(`${routine} op ${op} empty clip ${clip}`, same ? [] : ['display changed']);
    }
  }
  emp.report();
  doSetClip(0, 0, 512, 192); doSetOp(0);
}

// ===========================================================================================================================
// 7. G_CLS, called directly: all 12,288 bytes, and nothing else; clip and op ignored.
{
  const cat = new Cat('G_CLS direct call: whole display to 0, nothing else written, clip / op ignored');
  const states = [[0, [0, 0, 512, 192]], [2, [20, 20, 5, 5]], [1, [10, 10, 0, 5]], [2, [600, 0, 10, 10]], [0, [0, 0, 512, 192]], [2, [3, 191, 509, 1]]];
  for (const [op, clip] of states) {
    resync();
    doSetClip(...clip); doSetOp(op);
    exec(cat, 'G_CLS', {}, `G_CLS op=${op} clip=${clipStr()}`, () => scr.cls(), {
      keep: [],
      post: () => {
        const nz = m.ram.slice(0x4000, 0x5800).some((v) => v) || m.ram.slice(0x6000, 0x7800).some((v) => v);
        return nz ? ['a display byte is not 0'] : [];
      },
    });
  }
  cat.report();
  doInit();
}

// ===========================================================================================================================
// 8. Longest DI (section 7, section 12.5): every S1 routine stepped from iff1 = true.
{
  const cat = new Cat('longest DI run <= 1,500 T, interrupt flag as found, in every S1 routine (stepped with interrupts on)');
  let worst = 0, worstName = '';
  const di = (r) => { if (r && r.maxDiRun > worst) worst = r.maxDiRun; };
  const withInts = (name, regs, model, o = {}) => exec(cat, name, regs, `${name} (ints on)`, model, { ints: true, diOut: (r) => { di(r); if (r.maxDiRun === worst) worstName = name; }, ...o });
  resync();
  withInts('G_INIT', {}, () => scr.init(), { state: true, keep: ['b', 'c', 'd', 'e'] });
  withInts('G_SETOP', { a: 2 }, () => scr.setOp(2), { state: true, keep: ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l'] });
  setGA(m, S, -20, 5, 100, 100);
  withInts('G_SETCLIP', {}, () => scr.setClip(-20, 5, 100, 100), { state: true, gaKept: true });
  withInts('G_ADDR', { hl: 301, e: 77 }, () => {}, { keep: ['b', 'c'] });
  withInts('G_ROWADDR', { a: 130 }, () => {}, { keep: ['b', 'c', 'd', 'e'] });
  for (let k = 0; k < 6; k++) {
    doSetOp(k % 3); doSetClip(...(k < 3 ? [0, 0, 512, 192] : randClip()));
    const [x, y, w, h] = k < 3 ? [[0, 0, 512, 192], [3, 5, 500, 100], [-9, 60, 400, 140]][k] : randRect();
    setGA(m, S, x, y, w, h);
    withInts('G_FILL', {}, () => scr.fill(x, y, w, h), { gaKept: true });
    setGA(m, S, x, y, w, h);
    withInts('G_FRAME', {}, () => scr.frame(x, y, w, h));
    garbageGA(m, S, rng);
    withInts('G_HLINE', { hl: w16(x), de: w16(y), bc: w16(w) }, () => scr.hline(x, y, w));
    garbageGA(m, S, rng);
    withInts('G_VLINE', { hl: w16(x), de: w16(y), bc: w16(h) }, () => scr.vline(x, y, h));
  }
  doSetClip(0, 0, 512, 192); doSetOp(2);
  setGA(m, S, 0, 0, 512, 192);
  withInts('G_FILL', {}, () => scr.fill(0, 0, 512, 192), { gaKept: true });
  withInts('G_CLS', {}, () => scr.cls());
  cat.report(`, longest DI run ${worst} T (${worstName || 'none'})`);
  doInit();
}

support.report();
// Summary of every category.
const bad = allCats.filter((c) => c.bad).length;
console.log(`${allCats.length} categories, ${allCats.reduce((s, c) => s + c.calls, 0)} checked calls, ${bad} failing categories; seed ${SEED}`);
C.done();
