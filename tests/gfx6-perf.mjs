"use strict";
// gfx6-perf.mjs -- the S1 bounds of docs/GRAPHICS_SPIKE.md section 7, measured as section 12.5 says: each routine called
// directly (interrupts off, so ISR time is excluded), T-states from the first instruction to the RET inclusive.  A missed
// bound is reported with its numbers; a bound is never loosened here.
//   node tests/gfx6-perf.mjs [--seed N]
import { checks } from './lib.mjs';
import { start, makeRng, call, seedDisplay, setGA, w16, hex } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const si = argv.indexOf('--seed');
const SEED = si >= 0 ? Number(argv[si + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED}`);

const C = checks('gfx6 S1 bounds');
const ctx = start(C);
if (!ctx) { C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const fmt = (n) => n.toLocaleString('en-US');

const setOp = (op) => call(m, S, 'G_SETOP', { a: op }, { rng });
const init = () => call(m, S, 'G_INIT', {}, { rng });
const fill = (x, y, w, h, o = {}) => { setGA(m, S, x, y, w, h); return call(m, S, 'G_FILL', {}, { rng, ...o }); };
const hline = (x, y, w, o = {}) => call(m, S, 'G_HLINE', { hl: w16(x), de: w16(y), bc: w16(w) }, { rng, ...o });
const vline = (x, y, h, o = {}) => call(m, S, 'G_VLINE', { hl: w16(x), de: w16(y), bc: w16(h) }, { rng, ...o });

/** Check one bound: value <= bound. */
function bound(name, value, limit, extra = '') {
  C.check(`${name} (${fmt(value)} T, bound ${fmt(limit)})${extra}`, value <= limit);
}
/** Longest DI run of a call stepped with interrupts on, <= 1,500 T. */
let diWorst = 0;
function di(name, run) {
  const r = run({ ints: true });
  if (r.maxDiRun > diWorst) diWorst = r.maxDiRun;
  C.check(`longest DI run in ${name} (${fmt(r.maxDiRun)} T, bound 1,500)`, r.maxDiRun <= 1500 && r.iff1 === true);
}

seedDisplay(m, rng);
init();

// G_CLS whole screen: one direct call, interrupts off.
{
  const r = call(m, S, 'G_CLS', {}, { rng });
  bound('G_CLS whole screen', r.t, 80000);
  const zero = m.ram.slice(0x4000, 0x5800).every((v) => !v) && m.ram.slice(0x6000, 0x7800).every((v) => !v);
  C.check('G_CLS left all 12,288 display bytes at 0', zero);
}

// G_FILL 512 x 192 SET, clip whole screen.
{
  seedDisplay(m, rng); init(); setOp(0);
  const r = fill(0, 0, 512, 192);
  bound('G_FILL 512x192 SET', r.t, 150000);
}

// G_FILL 32 x 16 at odd x: the worst over x in {1, 3, 9, 101, 255, 477}, y in {0, 5}, for SET and XOR.
for (const [op, name, limit] of [[0, 'SET', 3000], [2, 'XOR', 3300]]) {
  seedDisplay(m, rng); init(); setOp(op);
  let worst = 0, at = '';
  for (const x of [1, 3, 9, 101, 255, 477]) for (const y of [0, 5]) {
    const t = fill(x, y, 32, 16).t;
    if (t > worst) { worst = t; at = `x ${x}, y ${y}`; }
  }
  bound(`G_FILL 32x16 at odd x ${name}, worst of 12 positions`, worst, limit, ` at ${at}`);
}

// G_HLINE 512 wide (0, y) for y in {0, 100, 191}; G_VLINE 192 high (x, 0) for x in {0, 7, 100, 511}: the worst, SET.
{
  seedDisplay(m, rng); init(); setOp(0);
  let worst = 0, at = '';
  for (const y of [0, 100, 191]) { const t = hline(0, y, 512).t; if (t > worst) { worst = t; at = `y ${y}`; } }
  bound('G_HLINE 512 wide, worst of y 0/100/191', worst, 2500, ` at ${at}`);
  worst = 0; at = '';
  for (const x of [0, 7, 100, 511]) { const t = vline(x, 0, 192).t; if (t > worst) { worst = t; at = `x ${x}`; } }
  bound('G_VLINE 192 high, worst of x 0/7/100/511', worst, 7000, ` at ${at}`);
}

// Longest DI (section 7): the measured calls again, stepped from iff1 = true.
{
  seedDisplay(m, rng); init(); setOp(0);
  di('G_FILL 512x192', (o) => fill(0, 0, 512, 192, o));
  di('G_FILL 32x16 at x 101', (o) => fill(101, 5, 32, 16, o));
  di('G_HLINE 512', (o) => hline(0, 100, 512, o));
  di('G_VLINE 192', (o) => vline(7, 0, 192, o));
  setOp(2);
  di('G_FRAME 512x192 XOR', (o) => { setGA(m, S, 0, 0, 512, 192); return call(m, S, 'G_FRAME', {}, { rng, ...o }); });
  di('G_CLS', (o) => call(m, S, 'G_CLS', {}, { rng, ...o }));
  console.log(`longest DI run over the measured calls: ${fmt(diWorst)} T`);
}

// Code size (report only).
{
  const size = S.GFX6_CODE_END - S.GFX6_CODE;
  C.check(`code size of gfx6: ${fmt(size)} bytes (${hex(S.GFX6_CODE)}-${hex(S.GFX6_CODE_END)}), target <= 4,096, report only`, size > 0);
  console.log(`code size ${size} bytes ${size <= 4096 ? '(within' : '(OVER'} the 4 KB target)`);
}
C.done();
