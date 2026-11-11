"use strict";
// gfx6-perf.mjs -- the S1, S2 and S3 bounds of docs/GRAPHICS_SPIKE.md section 7, measured as sections 12.5, 14.6 and 15.4 say: each routine
// called directly (interrupts off, so ISR time is excluded), T-states from the first instruction to the RET inclusive.  A missed
// bound is reported with its numbers; a bound is never loosened here.  Every measured figure is printed.
//   node tests/gfx6-perf.mjs [--seed N]
import { checks } from './lib.mjs';
import { start, makeRng, call, seedDisplay, setGA, w16, hex, NEEDED_S2, NEEDED_S3, T_STR, T_BUF } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';

const argv = process.argv.slice(2);
const si = argv.indexOf('--seed');
const SEED = si >= 0 ? Number(argv[si + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED}`);

const C = checks('gfx6 S1 + S2 + S3 bounds');
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

// ===========================================================================================================================
// S2 bounds (14.6).  Skipped, with a FAIL that names the missing symbols, when the cartridge does not define them yet.
{
  const missing = NEEDED_S2.filter((n) => S[n] === undefined);
  if (missing.length) {
    C.check('gfx6t defines the S2 symbols (G_TEXT8, G_TEXTP, G_TEXTW, GLH, tables): the S2 bounds cannot be measured', false, `missing: ${missing.join(', ')}`);
  } else {
    const STR = S.T_STR ?? T_STR, codes = (str) => Array.from(str, (ch) => ch.charCodeAt(0));
    const put = (bytes) => { for (let i = 0; i < bytes.length; i++) m.ram[STR + i] = bytes[i]; };
    const text8 = (col, row, bytes, o = {}) => { put(bytes); setGA(m, S, col, row, STR, bytes.length); return call(m, S, 'G_TEXT8', {}, { rng, ...o }); };
    const textp = (x, y, bytes, o = {}) => { put(bytes); setGA(m, S, x, y, STR, bytes.length); return call(m, S, 'G_TEXTP', {}, { rng, ...o }); };
    const textw = (bytes, o = {}) => { put(bytes); setGA(m, S, 0, 0, STR, bytes.length); return call(m, S, 'G_TEXTW', {}, { rng, ...o }); };
    const OPNAME = ['SET', 'CLR', 'XOR'];
    const per = (n, d) => (n / d).toFixed(1);
    const F = G.fonts();

    // G_TEXT8 per character: n = 64, codes 32..95, col 0, row 10, clip whole screen.
    {
      const s64 = Array.from({ length: 64 }, (_, k) => 32 + k), res = {};
      for (const op of [0, 2, 1]) {
        seedDisplay(m, rng); init(); setOp(op);
        res[op] = text8(0, 10, s64).t / 64;
        console.log(`G_TEXT8 64 chars ${OPNAME[op]}: ${fmt(res[op] * 64)} T = ${per(res[op], 1)} T per character`);
      }
      bound('G_TEXT8 per character, SET (64-char line)', res[0], 260);
      bound('G_TEXT8 per character, XOR (64-char line)', res[2], 340);
      C.check(`G_TEXT8 per character, CLR: ${per(res[1], 1)} T (report only)`, res[1] > 0);
    }

    // G_TEXTP per glyph: the sample paragraph, greedy wrap at 500 px, one call per line at x 5, y 3 + 10 i.
    const lines = G.wrapGreedy(G.PARAGRAPH, 500).map(codes);
    const total = lines.reduce((a, l) => a + l.length, 0);
    console.log(`paragraph: ${G.PARAGRAPH.length} characters, ${lines.length} lines of ${lines.map((l) => l.length).join(', ')} codes (${total} codes in the calls)`);
    {
      const res = {};
      for (const op of [0, 2, 1]) {
        seedDisplay(m, rng); init(); setOp(op);
        let t = 0;
        lines.forEach((l, i) => { t += textp(5, 3 + 10 * i, l).t; });
        res[op] = t / total;
        console.log(`G_TEXTP paragraph ${OPNAME[op]}: ${fmt(t)} T over ${total} codes = ${per(res[op], 1)} T per glyph`);
      }
      bound('G_TEXTP per glyph, SET (sample paragraph mean, spaces included)', res[0], 700);
      C.check(`G_TEXTP per glyph, XOR: ${per(res[2], 1)} T (report only)`, res[2] > 0);
      C.check(`G_TEXTP per glyph, CLR: ${per(res[1], 1)} T (report only)`, res[1] > 0);
    }

    // G_TEXTP per ink width: one-code calls, each glyph of that width, x = 64 + p (p = 0..7), y = 50, SET.
    {
      seedDisplay(m, rng); init(); setOp(0);
      const byW = new Map();
      for (let c = 32; c <= 126; c++) { const w = F.prop6.I[c]; if (!byW.has(w)) byW.set(w, []); byW.get(w).push(c); }
      let rows = 0;
      for (const w of [...byW.keys()].sort((a, b) => a - b)) {
        let t = 0, n = 0, lo = Infinity, hi = 0;
        for (const c of byW.get(w)) for (let p = 0; p < 8; p++) { const d = textp(64 + p, 50, [c]).t; t += d; n++; lo = Math.min(lo, d); hi = Math.max(hi, d); }
        console.log(`G_TEXTP one code, ink width ${w}${w === 0 ? ' (no ink)' : ''}: ${byW.get(w).length} glyphs x 8 shifts, mean ${per(t, n)} T (min ${lo}, max ${hi})`);
        rows++;
      }
      C.check(`G_TEXTP per-width figures reported for ${rows} ink widths (report only)`, rows > 0);
    }

    // Characters per line (report).
    {
      let sw = 0;
      for (const ch of G.PARAGRAPH) sw += F.prop6.W[ch.charCodeAt(0)];
      const mean = sw / G.PARAGRAPH.length;
      console.log(`mean advance over the paragraph ${mean.toFixed(3)} px, characters per 512-pixel line ${(512 / mean).toFixed(1)}`);
      C.check(`characters per line: ${(512 / mean).toFixed(1)} (report only; contract text expects about 75-80)`, mean > 0);
    }

    // G_TEXTW (reported): a 255-code string and the paragraph.
    {
      const bytes = codes(G.PARAGRAPH).slice(0, 255), r = textw(bytes);
      console.log(`G_TEXTW ${bytes.length} codes: ${fmt(r.t)} T = ${per(r.t, bytes.length)} T per code (result ${r.regs.hl} px)`);
      C.check(`G_TEXTW returns the model's width for the 255-code string (${r.regs.hl} px)`, r.regs.hl === new G.Gfx6Model().textw(bytes));
    }

    // Longest DI: each routine stepped from iff1 = true (as 12.5).
    {
      let worst = 0;
      const diS2 = (name, run) => {
        const r = run({ ints: true });
        if (r.maxDiRun > worst) worst = r.maxDiRun;
        C.check(`longest DI run in ${name} (${fmt(r.maxDiRun)} T, bound 1,500)`, r.maxDiRun <= 1500 && r.iff1 === true);
      };
      seedDisplay(m, rng); init(); setOp(2);
      const s64 = Array.from({ length: 64 }, (_, k) => 32 + k);
      diS2('G_TEXT8 64 chars XOR', (o) => text8(0, 10, s64, o));
      diS2('G_TEXTP paragraph line 1 XOR', (o) => textp(5, 3, lines[0], o));
      diS2('G_TEXTP 255 mixed codes', (o) => textp(-20, 5, Array.from({ length: 255 }, (_, k) => (k % 17 === 0 ? 13 : 32 + ((k * 11) % 95))), o));
      diS2('G_TEXTW 255 codes', (o) => textw(codes(G.PARAGRAPH).slice(0, 255), o));
      console.log(`longest DI run over the S2 calls: ${fmt(worst)} T`);
    }
  }
}

// ===========================================================================================================================
// S3 bounds (15.4).  Skipped, with a FAIL that names the missing symbols, when the cartridge does not define them yet.
{
  const missing = NEEDED_S3.filter((n) => S[n] === undefined);
  if (missing.length) {
    console.log(`SKIP: the S3 bounds (G_LINE, G_BLIT, G_SAVERECT / G_RESTRECT, G_SCROLLV) are not measured`);
    C.check('gfx6t defines the S3 symbols (G_LINE, G_BLIT, G_PRESHIFT, G_SAVERECT, G_RESTRECT, G_SCROLLV): the S3 bounds cannot be measured', false, `missing: ${missing.join(', ')}`);
  } else {
    const STR = S.T_STR ?? T_STR, BUF = S.T_BUF ?? T_BUF;
    const per = (n, d) => (n / d).toFixed(1);
    const OPNAME = ['SET', 'CLR', 'XOR'];
    const gline = (a, o = {}) => { setGA(m, S, ...a); return call(m, S, 'G_LINE', {}, { rng, guard: 60_000_000, ...o }); };
    const SET = BUF + 0x400;                                              // the shifted set of the measured bitmap, in T_BUF (15.3)
    const gblit = (x, y, w, h, o = {}) => { setGA(m, S, x, y, w, h, SET); return call(m, S, 'G_BLIT', {}, { rng, ...o }); };
    const gpreshift = (w, h, o = {}) => { setGA(m, S, 0, 0, w, h, STR, SET); return call(m, S, 'G_PRESHIFT', {}, { rng, guard: 20_000_000, ...o }); };
    const gsave = (x, y, w, h, buf, o = {}) => { setGA(m, S, x, y, w, h, buf); return call(m, S, 'G_SAVERECT', {}, { rng, ...o }); };
    const grest = (buf, o = {}) => call(m, S, 'G_RESTRECT', { hl: buf }, { rng, ...o });
    const gscroll = (x, y, w, h, n, o = {}) => { setGA(m, S, x, y, w, h, w16(n)); return call(m, S, 'G_SCROLLV', {}, { rng, ...o }); };

    // G_LINE per pixel: 200 lines, ends uniform on the screen, fixed seed, op SET, clip whole screen; XOR and the major-axis split are reported.
    {
      const lr = makeRng(0x5EED03), lines = Array.from({ length: 200 }, () => [lr.int(0, 511), lr.int(0, 191), lr.int(0, 511), lr.int(0, 191)]);
      const pixels = lines.reduce((t, l) => t + G.Gfx6Model.lineLength(...l), 0);
      const xPix = lines.filter((l) => Math.abs(l[2] - l[0]) >= Math.abs(l[3] - l[1])).reduce((t, l) => t + G.Gfx6Model.lineLength(...l), 0);
      console.log(`G_LINE: 200 lines, ${pixels} pixels (${xPix} on x-major lines, ${pixels - xPix} on y-major lines)`);
      const res = {};
      for (const op of [0, 2]) {
        seedDisplay(m, rng); init(); setOp(op);
        let t = 0, tx = 0, ty = 0;
        for (const l of lines) {
          const d = gline(l).t; t += d;
          if (Math.abs(l[2] - l[0]) >= Math.abs(l[3] - l[1])) tx += d; else ty += d;
        }
        res[op] = t / pixels;
        console.log(`G_LINE ${OPNAME[op]}: ${fmt(t)} T over ${pixels} pixels = ${per(t, pixels)} T per pixel`);
        if (op === 0) {
          console.log(`G_LINE SET by major axis: x-major ${per(tx, xPix)} T per pixel (${fmt(tx)} T), y-major ${per(ty, pixels - xPix)} T per pixel (${fmt(ty)} T)`);
          C.check(`G_LINE SET by major axis: x-major ${per(tx, xPix)}, y-major ${per(ty, pixels - xPix)} T per pixel (report only)`, tx > 0 && ty > 0);
        }
      }
      bound('G_LINE per pixel, SET (mean over 200 random lines)', res[0], 150);
      C.check(`G_LINE per pixel, XOR: ${per(res[2], 1)} T (report only)`, res[2] > 0);
    }

    // G_LINE long clipped lines (report): T a call.
    {
      seedDisplay(m, rng); init(); setOp(0);
      for (const l of [[-16384, -16384, 16383, 16383], [-16384, 0, 16383, 191]]) {
        const r = gline(l);
        console.log(`G_LINE long clipped (${l[0]}, ${l[1]})-(${l[2]}, ${l[3]}) SET: ${fmt(r.t)} T (${G.Gfx6Model.lineLength(...l)} pixels walked = ${per(r.t, G.Gfx6Model.lineLength(...l))} T per pixel)`);
        C.check(`G_LINE long clipped line (${l[0]}, ${l[1]})-(${l[2]}, ${l[3]}): ${fmt(r.t)} T a call (report only)`, r.t > 0);
      }
    }

    // G_BLIT 16 x 16 and 32 x 32: the worst over x = 64 + p, p = 0..7, y in {0, 5}; fixed random data; the 16 x 16 figure for each p at y = 0 is reported.
    {
      const br = makeRng(0xB117), data = Array.from({ length: 256 }, () => br.byte());
      for (let i = 0; i < data.length; i++) m.ram[STR + i] = data[i];
      for (const [w, h, limit] of [[16, 16, 4500], [32, 32, 14000]]) {
        seedDisplay(m, rng); init(); setOp(0);
        const ps = gpreshift(w, h);                                          // the set is built first, not counted in the blit
        const wb = (w + 7) >> 3, size = 16 * h * (wb + 1);
        console.log(`G_PRESHIFT ${w}x${h}: ${fmt(ps.t)} T (${size} bytes, ${per(ps.t, size)} T per byte)`);
        C.check(`G_PRESHIFT ${w}x${h}: ${fmt(ps.t)} T, returned HL ${ps.regs.hl === SET + size ? 'ok' : 'WRONG ' + hex(ps.regs.hl)} (report only)`, ps.t > 0 && ps.regs.hl === SET + size);
        let worst = 0, at = '';
        const row = [];
        for (let p = 0; p < 8; p++) for (const y of [0, 5]) {
          const t = gblit(64 + p, y, w, h).t;
          if (y === 0) row.push(`p${p} ${t}`);
          if (t > worst) { worst = t; at = `x ${64 + p}, y ${y}`; }
        }
        console.log(`G_BLIT ${w}x${h} at y 0 by p: ${row.join(', ')}`);
        bound(`G_BLIT ${w}x${h} (from a G_PRESHIFT set), worst of 16 positions`, worst, limit, ` at ${at}`);
        if (w === 16) C.check(`G_BLIT 16x16 at y 0 for p = 0..7: ${row.join(', ')} T (report only)`, row.length === 8);
      }
    }

    // G_SAVERECT / G_RESTRECT 96 x 80: the worst over x in {64, 72}, y in {0, 53}; buffer T_BUF; each restore puts back its own save.
    {
      let worstS = 0, worstR = 0, atS = '', atR = '', ok = true, why = '';
      for (const x of [64, 72]) for (const y of [0, 53]) {
        seedDisplay(m, rng); init(); setOp(0);
        const model = G.Gfx6Model.fromRam(m.ram), snap = model.saveRect(x, y, 96, 80);
        const rs = gsave(x, y, 96, 80, BUF);
        if (rs.regs.hl !== BUF + snap.size) { ok = false; why = `HL ${hex(rs.regs.hl)} want ${hex(BUF + snap.size)}`; }
        seedDisplay(m, rng); model.loadRam(m.ram);                       // change the display, then restore
        const rr = grest(BUF);
        model.restoreRect(snap);
        if (model.compareRam(m.ram)) { ok = false; why = `restore at (${x}, ${y}) does not match the model`; }
        if (rs.t > worstS) { worstS = rs.t; atS = `x ${x}, y ${y}`; }
        if (rr.t > worstR) { worstR = rr.t; atR = `x ${x}, y ${y}`; }
      }
      bound('G_SAVERECT 96x80, worst of x 64/72 x y 0/53', worstS, 20000, ` at ${atS}`);
      bound('G_RESTRECT 96x80, worst of x 64/72 x y 0/53', worstR, 20000, ` at ${atR}`);
      C.check('G_SAVERECT returned buf + 4 + nc nr and each G_RESTRECT put back exactly its own save (model compare)', ok, why);
    }

    // G_SCROLLV 256 x 96 by 1 row: (128, y, 256, 96), y in {48, 53}, n in {1, -1}: the worst.  512 x 192 by 8 rows: n in {8, -8}; by 1 and 10 rows reported.
    {
      let worst = 0, at = '';
      seedDisplay(m, rng); init(); setOp(0);
      for (const y of [48, 53]) for (const n of [1, -1]) {
        const t = gscroll(128, y, 256, 96, n).t;
        if (t > worst) { worst = t; at = `y ${y}, n ${n}`; }
      }
      bound('G_SCROLLV 256x96 by 1 row, worst of y 48/53 x n 1/-1', worst, 55000, ` at ${at}`);
      worst = 0; at = '';
      for (const n of [8, -8]) {
        const t = gscroll(0, 0, 512, 192, n).t;
        if (t > worst) { worst = t; at = `n ${n}`; }
      }
      bound('G_SCROLLV 512x192 by 8 rows, worst of n 8 / -8', worst, 200000, ` at ${at}`);
      for (const n of [1, 10]) {
        const t = gscroll(0, 0, 512, 192, n).t;
        console.log(`G_SCROLLV 512x192 by ${n} row${n > 1 ? 's' : ''}: ${fmt(t)} T`);
        C.check(`G_SCROLLV 512x192 by ${n} row${n > 1 ? 's' : ''}: ${fmt(t)} T (report only)`, t > 0);
      }
    }

    // Longest DI: each routine stepped from iff1 = true (as 12.5).
    {
      let worst = 0;
      const diS3 = (name, run) => {
        const r = run({ ints: true });
        if (r.maxDiRun > worst) worst = r.maxDiRun;
        C.check(`longest DI run in ${name} (${fmt(r.maxDiRun)} T, bound 1,500)`, r.maxDiRun <= 1500 && r.iff1 === true);
      };
      seedDisplay(m, rng); init(); setOp(2);
      diS3('G_LINE (0,0)-(511,191) XOR', (o) => gline([0, 0, 511, 191], o));
      diS3('G_LINE (-16384,-16384)-(16383,16383) XOR', (o) => gline([-16384, -16384, 16383, 16383], { guard: 60_000_000, ...o }));
      gpreshift(32, 32);
      diS3('G_PRESHIFT 32x32', (o) => gpreshift(32, 32, o));
      diS3('G_BLIT 32x32 at x 67', (o) => gblit(67, 5, 32, 32, o));
      diS3('G_SAVERECT 96x80 at x 72', (o) => gsave(72, 53, 96, 80, BUF, o));
      diS3('G_RESTRECT 96x80', (o) => grest(BUF, o));
      diS3('G_SCROLLV 512x192 by 8', (o) => gscroll(0, 0, 512, 192, 8, o));
      diS3('G_SCROLLV 256x96 by -1', (o) => gscroll(128, 53, 256, 96, -1, o));
      console.log(`longest DI run over the S3 calls: ${fmt(worst)} T`);
    }
  }
}

// Code size (report only).
{
  const size = S.GFX6_CODE_END - S.GFX6_CODE;
  C.check(`code size of gfx6: ${fmt(size)} bytes (${hex(S.GFX6_CODE)}-${hex(S.GFX6_CODE_END)}), target <= 4,096, report only`, size > 0);
  console.log(`code size ${size} bytes ${size <= 4096 ? '(within' : '(OVER'} the 4 KB target)`);
}
C.done();
