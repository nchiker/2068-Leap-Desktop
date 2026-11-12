"use strict";
// gfx6-perf.mjs -- the S1, S2 and S3 bounds of docs/GRAPHICS_SPIKE.md section 7, measured as sections 12.5, 14.6 and 15.4 say: each routine
// called directly (interrupts off, so ISR time is excluded), T-states from the first instruction to the RET inclusive.  A missed
// bound is reported with its numbers; a bound is never loosened here.  Every measured figure is printed.
//   node tests/gfx6-perf.mjs [--seed N]
import { checks, M, Z, FRAME_T } from './lib.mjs';
import { start, makeRng, call, seedDisplay, setGA, w16, hex, NEEDED_S2, NEEDED_S3, NEEDED_S4, T_STR, T_BUF, PTR_AREA } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';

const argv = process.argv.slice(2);
const si = argv.indexOf('--seed');
const SEED = si >= 0 ? Number(argv[si + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED}`);

const C = checks('gfx6 S1 + S2 + S3 + S4 bounds');
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

/** Check one bound: value <= bound.  Returns whether it held (for the section 7 table at the end). */
function bound(name, value, limit, extra = '') {
  C.check(`${name} (${fmt(value)} T, bound ${fmt(limit)})${extra}`, value <= limit);
  return value <= limit;
}
// The section 7 table printed at the end (17.9): one row per row of section 7, in its order; a row has one part per figure it names.
// status: true = pass, false = MISSED, 'report' = reported.  Only records what the checks above measured; nothing here judges anything.
const S7_ROWS = ['`G_CLS` whole screen', '`G_CLS` interrupt safety', 'Longest `DI` anywhere', '`G_FILL` 512 x 192, SET', '`G_FILL` 32 x 16 at odd x, SET / XOR',
  '`G_HLINE` 512 wide / `G_VLINE` 192 high', '`G_LINE`', '`G_TEXT8`', '`G_TEXTP`', '`G_BLIT` 16 x 16 / 32 x 32 at any x', '`G_SAVERECT` / `G_RESTRECT` 96 x 80',
  '`G_SCROLLV` 256 x 96 by 1 row / 512 x 192 by 8 rows', 'Pointer, in the ISR', 'Code size of `gfx6`'];
const s7 = new Map(S7_ROWS.map((r) => [r, []]));
const sum7 = (row, fig, bnd, status) => { if (!s7.has(row)) throw new Error(`no section 7 row ${row}`); s7.get(row).push({ fig, bnd, status }); };
s7.get('`G_CLS` interrupt safety').push({ fig: 'see gfx6-cls / gfx6-s4', bnd: '0 lost over 300 frames; RAM outside the display unchanged', status: 'see' });
let diAllMax = 0, diAllOk = true, diAllCalls = 0;
const diNote = (r) => { diAllCalls++; if (r.maxDiRun > diAllMax) diAllMax = r.maxDiRun; if (!(r.maxDiRun <= 1500 && r.iff1 === true)) diAllOk = false; };
/** Longest DI run of a call stepped with interrupts on, <= 1,500 T. */
let diWorst = 0;
function di(name, run) {
  const r = run({ ints: true });
  diNote(r);
  if (r.maxDiRun > diWorst) diWorst = r.maxDiRun;
  C.check(`longest DI run in ${name} (${fmt(r.maxDiRun)} T, bound 1,500)`, r.maxDiRun <= 1500 && r.iff1 === true);
}

seedDisplay(m, rng);
init();

// G_CLS whole screen: one direct call, interrupts off.
{
  const r = call(m, S, 'G_CLS', {}, { rng });
  sum7('`G_CLS` whole screen', `${fmt(r.t)} T`, '<= 80,000', bound('G_CLS whole screen', r.t, 80000));
  const zero = m.ram.slice(0x4000, 0x5800).every((v) => !v) && m.ram.slice(0x6000, 0x7800).every((v) => !v);
  C.check('G_CLS left all 12,288 display bytes at 0', zero);
}

// G_FILL 512 x 192 SET, clip whole screen.
{
  seedDisplay(m, rng); init(); setOp(0);
  const r = fill(0, 0, 512, 192);
  sum7('`G_FILL` 512 x 192, SET', `${fmt(r.t)} T`, '<= 150,000', bound('G_FILL 512x192 SET', r.t, 150000));
}

// G_FILL 32 x 16 at odd x: the worst over x in {1, 3, 9, 101, 255, 477}, y in {0, 5}, for SET and XOR.
for (const [op, name, limit] of [[0, 'SET', 3000], [2, 'XOR', 3300]]) {
  seedDisplay(m, rng); init(); setOp(op);
  let worst = 0, at = '';
  for (const x of [1, 3, 9, 101, 255, 477]) for (const y of [0, 5]) {
    const t = fill(x, y, 32, 16).t;
    if (t > worst) { worst = t; at = `x ${x}, y ${y}`; }
  }
  sum7('`G_FILL` 32 x 16 at odd x, SET / XOR', `${name} ${fmt(worst)} T`, `<= ${fmt(limit)}`, bound(`G_FILL 32x16 at odd x ${name}, worst of 12 positions`, worst, limit, ` at ${at}`));
}

// G_HLINE 512 wide (0, y) for y in {0, 100, 191}; G_VLINE 192 high (x, 0) for x in {0, 7, 100, 511}: the worst, SET.
{
  seedDisplay(m, rng); init(); setOp(0);
  let worst = 0, at = '';
  for (const y of [0, 100, 191]) { const t = hline(0, y, 512).t; if (t > worst) { worst = t; at = `y ${y}`; } }
  sum7('`G_HLINE` 512 wide / `G_VLINE` 192 high', `HLINE ${fmt(worst)} T`, '<= 2,500', bound('G_HLINE 512 wide, worst of y 0/100/191', worst, 2500, ` at ${at}`));
  worst = 0; at = '';
  for (const x of [0, 7, 100, 511]) { const t = vline(x, 0, 192).t; if (t > worst) { worst = t; at = `x ${x}`; } }
  sum7('`G_HLINE` 512 wide / `G_VLINE` 192 high', `VLINE ${fmt(worst)} T`, '<= 7,000', bound('G_VLINE 192 high, worst of x 0/7/100/511', worst, 7000, ` at ${at}`));
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
      sum7('`G_TEXT8`', `SET ${per(res[0], 1)} T per character`, '<= 260', bound('G_TEXT8 per character, SET (64-char line)', res[0], 260));
      sum7('`G_TEXT8`', `XOR ${per(res[2], 1)} T per character`, '<= 340', bound('G_TEXT8 per character, XOR (64-char line)', res[2], 340));
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
      sum7('`G_TEXTP`', `SET ${per(res[0], 1)} T per glyph`, '<= 700', bound('G_TEXTP per glyph, SET (sample paragraph mean, spaces included)', res[0], 700));
      C.check(`G_TEXTP per glyph, XOR: ${per(res[2], 1)} T (report only)`, res[2] > 0);
      C.check(`G_TEXTP per glyph, CLR: ${per(res[1], 1)} T (report only)`, res[1] > 0);
    }

    // G_TEXTP per ink width: one-code calls, each glyph of that width, x = 64 + p (p = 0..7), y = 50, SET.
    {
      seedDisplay(m, rng); init(); setOp(0);
      const byW = new Map();
      for (let c = 32; c <= 126; c++) { const w = F.prop6.I[c]; if (!byW.has(w)) byW.set(w, []); byW.get(w).push(c); }
      let rows = 0, wMean = [];
      for (const w of [...byW.keys()].sort((a, b) => a - b)) {
        let t = 0, n = 0, lo = Infinity, hi = 0;
        for (const c of byW.get(w)) for (let p = 0; p < 8; p++) { const d = textp(64 + p, 50, [c]).t; t += d; n++; lo = Math.min(lo, d); hi = Math.max(hi, d); }
        console.log(`G_TEXTP one code, ink width ${w}${w === 0 ? ' (no ink)' : ''}: ${byW.get(w).length} glyphs x 8 shifts, mean ${per(t, n)} T (min ${lo}, max ${hi})`);
        rows++; wMean.push(t / n);
      }
      sum7('`G_TEXTP`', `per-width means ${fmt(Math.round(Math.min(...wMean)))}-${fmt(Math.round(Math.max(...wMean)))} T per one-code call (${rows} ink widths, listed above)`, 'report', 'report');
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
        diNote(r);
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
      sum7('`G_LINE`', `${per(res[0], 1)} T per pixel (SET, mean of 200 lines)`, '<= 150', bound('G_LINE per pixel, SET (mean over 200 random lines)', res[0], 150));
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
        sum7('`G_BLIT` 16 x 16 / 32 x 32 at any x', `${w}x${h} ${fmt(worst)} T`, `<= ${fmt(limit)}`, bound(`G_BLIT ${w}x${h} (from a G_PRESHIFT set), worst of 16 positions`, worst, limit, ` at ${at}`));
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
      sum7('`G_SAVERECT` / `G_RESTRECT` 96 x 80', `SAVERECT ${fmt(worstS)} T`, '<= 20,000', bound('G_SAVERECT 96x80, worst of x 64/72 x y 0/53', worstS, 20000, ` at ${atS}`));
      sum7('`G_SAVERECT` / `G_RESTRECT` 96 x 80', `RESTRECT ${fmt(worstR)} T`, '<= 20,000', bound('G_RESTRECT 96x80, worst of x 64/72 x y 0/53', worstR, 20000, ` at ${atR}`));
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
      sum7('`G_SCROLLV` 256 x 96 by 1 row / 512 x 192 by 8 rows', `256x96 by 1 ${fmt(worst)} T`, '<= 55,000', bound('G_SCROLLV 256x96 by 1 row, worst of y 48/53 x n 1/-1', worst, 55000, ` at ${at}`));
      worst = 0; at = '';
      for (const n of [8, -8]) {
        const t = gscroll(0, 0, 512, 192, n).t;
        if (t > worst) { worst = t; at = `n ${n}`; }
      }
      sum7('`G_SCROLLV` 256 x 96 by 1 row / 512 x 192 by 8 rows', `512x192 by 8 ${fmt(worst)} T`, '<= 200,000', bound('G_SCROLLV 512x192 by 8 rows, worst of n 8 / -8', worst, 200000, ` at ${at}`));
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
        diNote(r);
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

// ===========================================================================================================================
// S4 bounds (16.7): the pointer.  Skipped, with a FAIL that names the missing symbols, when the cartridge does not define them yet.
{
  const missing = NEEDED_S4.filter((n) => S[n] === undefined);
  if (missing.length) {
    console.log('SKIP: the S4 bounds (pointer, shield) are not measured');
    C.check('gfx6t defines the S4 symbols (P_INIT, P_MOVE, P_SHIELD, P_UNSHIELD, P_ISR, T_ISRP, ...): the S4 bounds cannot be measured', false, `missing: ${missing.join(', ')}`);
  } else {
    const cpu = m.cpu;
    const pinit = (x, y, o = {}) => call(m, S, 'P_INIT', { hl: w16(x), de: w16(y) }, { rng, ...o });
    const pmove = (x, y, o = {}) => call(m, S, 'P_MOVE', { hl: w16(x), de: w16(y) }, { rng, ...o });
    const pshield = (r, o = {}) => { setGA(m, S, ...r); return call(m, S, 'P_SHIELD', {}, { rng, ...o }); };
    const punshield = (o = {}) => call(m, S, 'P_UNSHIELD', {}, { rng, ...o });
    const pisr = (o = {}) => call(m, S, 'P_ISR', {}, { rng, ...o });
    const rectOf = (x, y) => G.pointerRect(x, y);
    const xs = [64, 65, 66, 67, 68, 69, 70, 71, 0, 7, 8, 488, 495, 496, 503, 504, 511], ys = [0, 5, 7, 176, 183, 191];
    // a 1-row full-width shield on a row that neither pointer's byte rectangle covers (null when there is none)
    const freeRow = (a, b) => {
      const ra = rectOf(...a), rb = rectOf(...b);
      for (const r of [100, 40, 150, 80, 20, 120, 60, 170, 0, 191]) if (!(r >= ra.y0 && r <= ra.y1) && !(r >= rb.y0 && r <= rb.y1)) return r;
      return null;
    };
    seedDisplay(m, rng); init(); setOp(0);
    m.ram.fill(0, PTR_AREA[0], PTR_AREA[1] + 1);
    const ini = pinit(256, 96);
    console.log(`P_INIT: ${fmt(ini.t)} T (once, at boot; report only)`);
    C.check(`P_INIT: ${fmt(ini.t)} T (report only)`, ini.t > 0);
    /** Get the state "pointer drawn at A, no shield, nothing pending", optionally with a shield held (its redraw done). */
    const drawnAt = (A, shieldRow) => {
      punshield(); pmove(...A); pisr();
      if (shieldRow !== null && shieldRow !== undefined) { pshield([0, shieldRow, 512, 1]); pisr(); }
    };
    // ---- P_ISR moving / skipped -------------------------------------------------------------------------------------------
    {
      let worst = 0, worstAt = '', worstSkip = 0, worstSkipAt = '', n = 0, nShield = 0, noFree = 0;
      const byCase = { 'no shield': 0, 'with shield': 0 };
      for (const bx of xs) for (const by of ys) {
        const B = [bx, by];
        for (const A of [[(bx + 200) % 512, (by + 50) % 192], [bx, (by + 40) % 192]]) {
          for (const withShield of [false, true]) {
            let row = null;
            if (withShield) { row = freeRow(A, B); if (row === null) { noFree++; continue; } }
            drawnAt(A, row);
            pmove(...B);
            const r = pisr();
            const label = `B (${bx}, ${by}), A (${A}), ${withShield ? `shield row ${row}` : 'no shield'}`;
            byCase[withShield ? 'with shield' : 'no shield'] = Math.max(byCase[withShield ? 'with shield' : 'no shield'], r.t);
            if (r.t > worst) { worst = r.t; worstAt = label; }
            const sk = pisr();
            if (sk.t > worstSkip) { worstSkip = sk.t; worstSkipAt = label; }
            n++; if (withShield) nShield++;
          }
        }
      }
      console.log(`P_ISR moving: ${n} measured pairs (${nShield} with a shield, ${noFree} without a free row); worst no shield ${fmt(byCase['no shield'])} T, worst with shield ${fmt(byCase['with shield'])} T`);
      sum7('Pointer, in the ISR', `moving ${fmt(worst)} T`, '<= 7,000', bound(`P_ISR moving (erase + draw), worst of ${n} cases`, worst, 7000, ` at ${worstAt}`));
      sum7('Pointer, in the ISR', `skipped ${fmt(worstSkip)} T`, '<= 300', bound(`P_ISR skipped (again, no call in between), worst of ${n} cases`, worstSkip, 300, ` at ${worstSkipAt}`));
    }
    // ---- other paths (report) ---------------------------------------------------------------------------------------------
    {
      const rep = {};
      const note = (k, t, at) => { if (!rep[k] || t > rep[k].t) rep[k] = { t, at }; };
      const sumT = {}, cnt = {};
      const acc = (k, t) => { sumT[k] = (sumT[k] || 0) + t; cnt[k] = (cnt[k] || 0) + 1; };
      for (const bx of xs) for (const by of ys) {
        const B = [bx, by], A = [(bx + 200) % 512, (by + 50) % 192], B2 = [Math.min(511, bx + 9), Math.min(191, by + 6)];
        const at = `B (${bx}, ${by})`;
        // draw only: hidden by a shield that meets B, then P_UNSHIELD
        punshield(); pmove(...A); pisr(); pmove(...B); pshield([8 * rectOf(...B).c0, B[1], 24, 16]); pisr(); punshield();
        let r = pisr(); note('draw only', r.t, at); acc('draw only', r.t);
        // erase only: drawn at A, P_MOVE to B, P_SHIELD meets B but not A
        punshield(); pmove(...A); pisr(); pmove(...B);
        const row = freeRow(A, B);
        const sh = [8 * rectOf(...B).c0, B[1], 24, 16];
        const meetsA = G.meets(rectOf(...A), G.shieldRect(...sh));
        if (!meetsA) { pshield(sh); r = pisr(); note('erase only', r.t, at); acc('erase only', r.t); }
        // P_MOVE to the same position
        punshield(); pmove(...B); pisr(); pmove(...B); r = pisr(); note('P_MOVE to the same position, then P_ISR', r.t, at); acc('P_MOVE to the same position, then P_ISR', r.t);
        // a move while hidden by the shield: the shield covers B and B2
        punshield(); pmove(...B); pisr(); pshield([8 * rectOf(...B).c0 - 8, Math.max(0, B[1] - 2), 64, 40]); pisr(); pmove(...B2); r = pisr();
        note('a move while hidden by the shield', r.t, at); acc('a move while hidden by the shield', r.t);
        void row;
      }
      for (const k of Object.keys(rep)) {
        console.log(`P_ISR ${k}: worst ${fmt(rep[k].t)} T at ${rep[k].at}, mean ${(sumT[k] / cnt[k]).toFixed(0)} T over ${cnt[k]} (report only)`);
        C.check(`P_ISR ${k}: worst ${fmt(rep[k].t)} T, mean ${(sumT[k] / cnt[k]).toFixed(0)} T (report only)`, rep[k].t > 0);
      }
    }
    // ---- P_SHIELD / P_UNSHIELD / P_MOVE (report) ---------------------------------------------------------------------------
    {
      let wE = 0, atE = '', wN = 0, atN = '', wU = 0, wM = 0, atM = '', sE = 0, nE = 0, sN = 0, nN = 0;
      for (const bx of xs) for (const by of ys) {
        const A = [bx, by];
        drawnAt(A);
        const rr = rectOf(...A);
        let t = pshield([8 * rr.c0, A[1], 8 * (rr.c1 - rr.c0 + 1), 16]).t;           // meets the drawn pointer: erases
        if (t > wE) { wE = t; atE = `A (${bx}, ${by})`; } sE += t; nE++;
        wU = Math.max(wU, punshield().t);
        drawnAt(A);
        const row = (by < 100) ? 150 : 40;
        t = pshield([0, row, 512, 1]).t;                                             // does not meet: no erase
        if (t > wN) { wN = t; atN = `A (${bx}, ${by})`; } sN += t; nN++;
        punshield();
        t = pmove(bx ^ 0x55 & 511, by).t;
        if (t > wM) { wM = t; atM = `(${bx}, ${by})`; }
      }
      console.log(`P_SHIELD with an erase: worst ${fmt(wE)} T at ${atE}, mean ${(sE / nE).toFixed(0)}; without an erase: worst ${fmt(wN)} T at ${atN}, mean ${(sN / nN).toFixed(0)}; P_UNSHIELD worst ${fmt(wU)} T; P_MOVE worst ${fmt(wM)} T at ${atM}`);
      C.check(`P_SHIELD with an erase: worst ${fmt(wE)} T (report only)`, wE > 0);
      C.check(`P_SHIELD without an erase: worst ${fmt(wN)} T (report only)`, wN > 0);
      C.check(`P_UNSHIELD: worst ${fmt(wU)} T (report only)`, wU > 0);
      C.check(`P_MOVE: worst ${fmt(wM)} T (report only)`, wM > 0);
    }
    // ---- deadline: the largest T_ISRP offset over frames that move the pointer (A, B, A, B, ... over the grid of the moving measure) ---
    {
      const accepted = () => cpu.pc === 0x38;
      const park = () => { cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = true; cpu.sp = 0xFF00; cpu.pc = S.T_IDLE; };
      const step = () => Z.runZ80(cpu, m.bus, 1, m);
      const isr = () => {                                                        // run the pending ISR to its RET; offset of T_ISRP, ISR T
        const sp0 = cpu.sp + 2, ret = m.ram[cpu.sp] | (m.ram[cpu.sp + 1] << 8), t0 = m.tstates;
        let off = -1, g = 0;
        while (!(cpu.pc === ret && cpu.sp === sp0)) { if (cpu.pc === S.T_ISRP && off < 0) off = m.tstates - m.frameStart; step(); if (++g > 400000) throw new Error('ISR did not return'); }
        return { off, t: m.tstates - t0 };
      };
      for (let k = 0; k < 20000 && m.tstates - m.frameStart >= FRAME_T; k++) { park(); M.runFrame(m); }
      park(); M.runFrame(m); M.runFrame(m);
      const seq = [];
      for (const bx of xs) for (const by of ys) { seq.push([(bx + 200) % 512, (by + 50) % 192], [bx, by], [bx, (by + 40) % 192], [bx, by]); }
      let maxOff = 0, maxT = 0, lost = 0, frames = 0, at = '';
      for (const p of seq) {
        if (!accepted()) { lost++; break; }
        const r = isr();
        if (r.off > maxOff) { maxOff = r.off; at = `moving to (${p})`; }
        if (r.t > maxT) maxT = r.t;
        pmove(...p);
        park(); M.runFrame(m); frames++;
      }
      console.log(`deadline: ${frames} frames moving the pointer over the grid; largest T_ISRP offset ${fmt(maxOff)} T (${at}), largest whole-ISR time ${fmt(maxT)} T`);
      sum7('Pointer, in the ISR', `deadline: T_ISRP offset ${fmt(maxOff)} + 1,500 = ${fmt(maxOff + 1500)} T`, '<= 8,960 (before the beam)', bound(`pointer deadline: largest T_ISRP offset ${fmt(maxOff)} + 1,500`, maxOff + 1500, 8960, ` over ${frames} moving frames${lost ? `, ${lost} interrupt lost` : ''}`) && !lost);
      park();
    }
    const pc = S.P_CODE_END - S.P_CODE, all = S.GFX6_CODE_END - S.GFX6_CODE;
    console.log(`pointer code ${pc} bytes (${hex(S.P_CODE)}-${hex(S.P_CODE_END)}); gfx6 code now ${all} bytes`);
    C.check(`code size: pointer ${pc} bytes, gfx6 in all ${all} bytes (report only)`, pc > 0);
  }
}

// Code size (report only).
{
  const size = S.GFX6_CODE_END - S.GFX6_CODE;
  C.check(`code size of gfx6: ${fmt(size)} bytes (${hex(S.GFX6_CODE)}-${hex(S.GFX6_CODE_END)}), target <= 4,096, report only`, size > 0);
  console.log(`code size ${size} bytes ${size <= 4096 ? '(within' : '(OVER'} the 4 KB target)`);
  sum7('Code size of `gfx6`', `${fmt(size)} bytes (GFX6_CODE to GFX6_CODE_END)`, `report; target <= 4,096 (${size <= 4096 ? 'within' : 'OVER'})`, 'report');
}
C.done();

// ===========================================================================================================================
// Section 7 as a table (17.9): every row, this run's figure, its bound, pass / MISSED / reported.  The checks above are the only judges.
{
  if (diAllCalls) sum7('Longest `DI` anywhere', `${fmt(diAllMax)} T (${diAllCalls} stepped calls)`, '<= 1,500', diAllOk);
  const label = (st) => (st === true ? 'pass' : st === false ? 'MISSED' : st === 'report' ? 'reported' : 'see test');
  const out = [['Section 7 row', 'Measured (this run)', 'Bound', 'Result']];
  for (const [row, parts] of s7) {
    if (!parts.length) { out.push([row.replace(/`/g, ''), 'not measured', '', '-']); continue; }
    const sts = parts.map((x) => label(x.status));
    out.push([row.replace(/`/g, ''), parts.map((x) => x.fig).join(' / '), parts.map((x) => x.bnd).join(' / '),
      sts.every((x) => x === sts[0]) ? sts[0] : sts.join(' / ')]);
  }
  const wd = out[0].map((_, c) => Math.max(...out.map((r) => r[c].length)));
  console.log('\nSection 7 summary (seed ' + SEED + '):');
  out.forEach((r, i) => {
    console.log(r.map((v, c) => v.padEnd(wd[c])).join(' | ').trimEnd());
    if (i === 0) console.log(wd.map((w) => '-'.repeat(w)).join('-+-'));
  });
}
