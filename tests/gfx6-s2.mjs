"use strict";
// gfx6-s2.mjs -- slice S2 of the graphics spike (docs/GRAPHICS_SPIKE.md sections 8, 12 and 14): the generated tables in chunk 4
// (PROP6_W, PROP6_I, FONTP / GLYPH8, SHR, SHL), G_INIT's GLH = 8, G_TEXT8, G_TEXTP and G_TEXTW on the `gfx6t` cartridge.  Every
// drawing call is compared with the reference model (tests/gfx6-model.mjs, which parses fonts/prop6.txt and src/font.inc itself)
// over the whole 512 x 192 screen, with clip safety (poisoned RAM, the string buffer guarded), register preservation and the
// longest-DI measurement.  Written from the contract, never from the code.
//   node tests/gfx6-s2.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default from the clock); a failure is reproduced with the same seed
//     --n N      random calls per routine (default 600, contract minimum 500)
import { checks } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, changed, poison, checkPoison, seedDisplay, setGA, readClip, opClipBytes, hex, s16,
  NEEDED, NEEDED_S2, T_STR, PRESERVED } from './gfx6-lib.mjs';

const argv = process.argv.slice(2);
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
const N = argVal('--n', 600);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random calls per routine`);

const C = checks('gfx6 S2');
const ctx = start(C, [...NEEDED.filter((n) => !['T_CLSLOOP', 'T_CLSDONE', 'V_FRAMES', 'V_CLS', 'GFX6_CODE', 'GFX6_CODE_END', 'ROWTAB', 'LMASK', 'RMASK',
  'G_ADDR', 'G_ROWADDR', 'G_FILL', 'G_HLINE', 'G_VLINE', 'G_FRAME', 'G_CLS'].includes(n)), ...NEEDED_S2]);
if (!ctx) { console.log('the gfx6t cartridge (with the S2 symbols) is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const scr = new G.Gfx6Model();
const STR = S.T_STR ?? T_STR;                                       // $D000, 512 bytes

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
const support = new Cat('support calls (G_SETOP / G_SETCLIP / GLH setting) behave as specified');
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
const resync = () => { seedDisplay(m, rng); scr.loadRam(m.ram); };

// ---------------------------------------------------------------------------------------------------------------------------
// Poison regions: 12.4's, but the string buffer $D000-$D1FF is left out (it is checked as "unchanged" instead), and for a string
// placed elsewhere in RAM that range is left out too.
const BASE_REGIONS = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC000, 0xCFFF], [0xD200, 0xDFFF], [0xE100, 0xFDFF]];
function regionsWithout(lo, hi) {
  if (lo > hi) return BASE_REGIONS;
  const out = [];
  for (const [a, b] of BASE_REGIONS) {
    if (hi < a || lo > b) { out.push([a, b]); continue; }
    if (lo > a) out.push([a, lo - 1]);
    if (hi < b) out.push([hi + 1, b]);
  }
  return out;
}

/**
 * Put a string in memory.  where: 'buf' (in the string buffer, at offset off: the buffer is first filled with 'W' ($57) so a read
 * before the start or past the end of the string draws ink), 'ram' (anywhere in $C000-$CFFF, which may cross a page boundary),
 * 'cart' (inside the cartridge image, read-only: chunk 0-1 or chunk 4).  Returns { addr, bytes, regions, guard: [lo, hi] }.
 */
function place(bytes, where = 'buf', off = 0) {
  const n = bytes.length;
  if (where === 'ram') {
    const addr = 0xC000 + rng.int(0, 0xFFF - n);
    for (let i = 0; i < n; i++) m.ram[addr + i] = bytes[i];
    return { addr, bytes, regions: regionsWithout(addr, addr + n - 1), where };
  }
  if (where === 'cart') {
    const addr = rng.chance(0.5) ? rng.int(0x0200, 0x3F00) : rng.int(0x8000, 0x9E00);
    const real = Array.from({ length: n }, (_, i) => m.bus.read(addr + i));
    return { addr, bytes: real, regions: BASE_REGIONS, where };
  }
  m.ram.fill(0x57, STR, STR + 512);
  const addr = STR + off;
  for (let i = 0; i < n; i++) m.ram[addr + i] = bytes[i];
  return { addr, bytes, regions: BASE_REGIONS, where };
}

/**
 * One checked call of a text routine.  routine: 'G_TEXT8' (a0 = col, a1 = row), 'G_TEXTP' (a0 = x, a1 = y) or 'G_TEXTW'.
 * Builds the string, poisons, calls, applies the model, then checks: the whole screen against the model, nothing outside the
 * display written (the string buffer and a RAM string unchanged), SP back, the interrupt flag as found, IX / IY / the alternate
 * set preserved, GOP / GLH / GCLIP unchanged, GA unchanged, the returned HL / DE (G_TEXTP) or HL (G_TEXTW).
 */
function run(cat, routine, a0, a1, bytes, o = {}) {
  const pl = place(bytes, o.where || 'buf', o.off ?? 0), n = bytes.length;
  const bufBefore = m.ram.slice(STR, STR + 512), strBefore = Array.from({ length: n }, (_, i) => m.bus.read(pl.addr + i));
  setGA(m, S, a0, a1, pl.addr, n);
  const gaBefore = Array.from(m.ram.subarray(S.GA, S.GA + 8)), ocBefore = opClipBytes(m, S);
  const tok = poison(m, rng, { regions: pl.regions });
  const probs = [];
  let r = null;
  try { r = call(m, S, routine, {}, { rng, ints: !!o.ints }); }
  catch (e) { probs.push(e.message); }
  let want;
  if (routine === 'G_TEXT8') scr.text8(a0, a1, pl.bytes);
  else if (routine === 'G_TEXTP') want = scr.textp(a0, a1, pl.bytes);
  else want = scr.textw(pl.bytes);
  const d = scr.compareRam(m.ram);
  if (d) { probs.push(G.fmtDiff(d)); scr.loadRam(m.ram); }
  const pz = checkPoison(m, tok);
  if (pz) probs.push(`wrote outside the display files (or below the 32-byte stack allowance, $FE00-$FEDD): ${hex(pz.addr)} is ${hex(pz.got, 2)}, was ${hex(pz.want, 2)} (${pz.n} bytes changed)`);
  if (m.ram.slice(STR, STR + 512).some((v, i) => v !== bufBefore[i])) probs.push('the string buffer $D000-$D1FF changed');
  if (strBefore.some((v, i) => m.bus.read(pl.addr + i) !== v)) probs.push(`the string at ${hex(pl.addr)} changed`);
  if (r) {
    if (r.sp !== 0xFF00) probs.push(`SP ${hex(r.sp)} after the call, want $FF00`);
    if (r.iff1 !== !!o.ints) probs.push(`interrupt flag ${r.iff1}, found ${!!o.ints}`);
    const ch = changed(r, PRESERVED);
    if (ch.length) probs.push(`not preserved: ${ch.join(', ')}`);
    if (opClipBytes(m, S).join() !== ocBefore.join()) probs.push('GOP / GLH / GCLIP changed');
    if (Array.from(m.ram.subarray(S.GA, S.GA + 8)).join() !== gaBefore.join()) probs.push('GA changed');
    if (routine === 'G_TEXTP') {
      if (s16(r.regs.hl) !== want.x || s16(r.regs.de) !== want.y) probs.push(`returned pen (${s16(r.regs.hl)}, ${s16(r.regs.de)}), want (${want.x}, ${want.y})`);
    } else if (routine === 'G_TEXTW') {
      if (r.regs.hl !== want) probs.push(`returned width ${r.regs.hl}, want ${want}`);
    }
    if (o.ints && r.maxDiRun > 1500) probs.push(`longest DI run ${r.maxDiRun} T > 1500`);
    if (o.diOut) o.diOut(r);
    if (o.post) probs.push(...o.post(r, want));
  }
  const show = n > 24 ? `${pl.bytes.slice(0, 24).join(',')},... (${n} codes)` : `[${pl.bytes.join(',')}]`;
  cat.record(`${routine}(${a0}, ${a1}) ${show} at ${pl.where}${pl.where === 'buf' ? '+' + (o.off ?? 0) : ' ' + hex(pl.addr)} op=${scr.op} glh=${scr.glh} clip=${clipStr()} (call ${cat.calls + 1})`, probs);
  return r;
}
const t8 = (cat, col, row, bytes, o) => run(cat, 'G_TEXT8', col, row, bytes, o);
const tp = (cat, x, y, bytes, o) => run(cat, 'G_TEXTP', x, y, bytes, o);
// G_TEXTW takes only GA+4 / GA+6: GA+0 and GA+2 get random words, which must not matter.
const tw = (cat, bytes, o) => run(cat, 'G_TEXTW', rng.int(-30000, 30000), rng.int(-30000, 30000), bytes, o);

// ---- settings: the real G_SETOP / G_SETCLIP routines (S1) and the GLH byte (a caller-written setting) -------------------------
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
function setGlh(v) { m.ram[S.GLH] = v; scr.setGlh(v); }
const fullClip = () => setClip(0, 0, 512, 192);

// ===========================================================================================================================
// 0. GLH = 8 straight after boot (the cartridge ran G_INIT), the settings bytes.
{
  C.check('GLH = 8 after the cartridge booted (G_INIT ran), GOP = SET, GCLIP = whole screen',
    m.ram[S.GLH] === 8 && m.ram[S.GOP] === 0 && readClip(m, S).join() === '0,512,0,192', `GLH ${m.ram[S.GLH]}, GOP ${m.ram[S.GOP]}, GCLIP ${readClip(m, S)}`);
  C.check('the symbols: GLH is $E011 (between GOP and GCLIP), T_STR region is $D000', S.GLH === 0xE011 && S.GOP === 0xE010 && S.GCLIP === 0xE012 && STR === 0xD000,
    `GLH ${hex(S.GLH)}, GOP ${hex(S.GOP)}, GCLIP ${hex(S.GCLIP)}`);
}

// ===========================================================================================================================
// 1. The generated tables in the cartridge image, byte for byte (14.2).  chunk 4 = $8000-$9FFF.
{
  const T = G.expectedTables(), rd = (a) => m.bus.read(a);
  const TABLES = [['PROP6_W', T.PROP6_W], ['PROP6_I', T.PROP6_I], ['FONTP', T.FONTP], ['SHR', T.SHR], ['SHL', T.SHL]];
  const spans = [];
  const ILV = new Set(['SHR', 'SHL']);                                  // interleaved: logical index 256 p + v is at base + 512 p + v
  const addrOf = (name, base, i) => (ILV.has(name) ? G.shAddr(base, i >> 8, i & 255) : base + i);
  for (const [name, want] of TABLES) {
    const base = S[name];
    let bad = '', nbad = 0;
    for (let i = 0; i < want.length; i++) {
      const got = rd(addrOf(name, base, i));
      if (got !== want[i]) { nbad++; if (!bad) bad = `${name}[p ${i >> 8}, v ${i & 255}] (${hex(addrOf(name, base, i))}) = ${hex(got, 2)}, want ${hex(want[i], 2)}`; }
    }
    C.check(`table ${name} at ${hex(base)}: ${want.length} bytes equal the model's`, !nbad, nbad ? `${nbad} bytes differ, first ${bad}` : '');
    const len = ILV.has(name) ? 3840 + 256 : want.length;                // SHR / SHL: 8 pages each, interleaved, 4096 bytes together with the other
    C.check(`table ${name} is page aligned and inside chunk 4 ($8000-$9FFF)`, base % 256 === 0 && base >= 0x8000 && addrOf(name, base, want.length - 1) < 0xA000, hex(base));
    if (name === 'SHR') spans.push(['SHR+SHL', base, base + 4096]);
    else if (name !== 'SHL') spans.push([name, base, base + len]);
  }
  C.check('SHL = SHR + 256 (interleaved with SHR)', S.SHL === S.SHR + 256, `SHR ${hex(S.SHR)}, SHL ${hex(S.SHL)}`);
  for (const nm of ['LMASKP', 'RMASKP', 'PROP6_A2', 'PROP6_K']) if (S[nm] !== undefined) spans.push([nm, S[nm], S[nm] + 256]);
  let ov = '';
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (spans[i][1] < spans[j][2] && spans[j][1] < spans[i][2]) ov += ` ${spans[i][0]}/${spans[j][0]}`;
  C.check('the tables do not overlap each other (nor LMASKP / RMASKP / the internal PROP6_A2 / PROP6_K, when defined)', !ov, ov);
  C.check('GLYPH8 = FONTP + 128', S.GLYPH8 === S.FONTP + 128, `GLYPH8 ${hex(S.GLYPH8)}, FONTP ${hex(S.FONTP)}`);
  let bad = '';
  for (let k = 0; k < 8 && !bad; k++) for (let c = 0; c < 128; c++) {
    const g8 = rd(S.GLYPH8 + 256 * k + c), w = G.fonts().glyph8[c][k];
    if (g8 !== w) { bad = `GLYPH8 + 256 * ${k} + ${c} = ${hex(g8, 2)}, want ${hex(w, 2)}`; break; }
  }
  C.check('GLYPH8 + 256 k + c = row k of the 8x8 glyph of code c (c = 0..127), read through the GLYPH8 symbol', !bad, bad);
}

// ===========================================================================================================================
// 2. G_INIT: GLH = 8, GOP / clip as before, display untouched, only AF and HL clobbered.
{
  const cat = new Cat('G_INIT: GLH = 8, GOP = SET, clip = whole screen, display untouched, only AF and HL changed');
  for (let round = 0; round < 6; round++) {
    resync();
    m.ram[S.GOP] = 2; m.ram[S.GLH] = round === 0 ? 0 : rng.int(1, 255);
    for (let i = 0; i < 8; i++) m.ram[S.GCLIP + i] = 0x11 * (i + 1);
    const tok = poison(m, rng);
    const probs = [];
    let r = null;
    try { r = call(m, S, 'G_INIT', {}, { rng }); } catch (e) { probs.push(e.message); }
    scr.init();
    const d = scr.compareRam(m.ram);
    if (d) probs.push(G.fmtDiff(d));
    if (checkPoison(m, tok)) probs.push('wrote outside the display files');
    if (m.ram[S.GLH] !== 8) probs.push(`GLH = ${m.ram[S.GLH]}, want 8`);
    if (m.ram[S.GOP] !== 0) probs.push(`GOP = ${m.ram[S.GOP]}, want 0`);
    if (readClip(m, S).join() !== '0,512,0,192') probs.push(`GCLIP = ${readClip(m, S)}`);
    if (r) {
      const ch = changed(r, [...PRESERVED, 'b', 'c', 'd', 'e']);
      if (ch.length) probs.push(`not preserved: ${ch.join(', ')}`);
      if (r.sp !== 0xFF00) probs.push(`SP ${hex(r.sp)}`);
    }
    cat.record(`G_INIT round ${round}`, probs);
  }
  cat.report();
}

// ===========================================================================================================================
// 3. Random runs (section 8 item 2).
const randClip = () => {
  const k = rng.next();
  if (k < 0.15) return [0, 0, 512, 192];
  if (k < 0.2) return [-40, -40, 700, 400];
  if (k < 0.3) return rng.pick([[rng.int(0, 500), rng.int(0, 190), 0, rng.int(1, 50)], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 50), 0],
    [rng.int(0, 500), rng.int(0, 190), -rng.int(1, 9), rng.int(1, 50)], [rng.int(512, 900), rng.int(0, 190), 30, 30], [rng.int(-200, -40), 5, 30, 30],
    [5, rng.int(192, 300), 30, 30], [rng.int(0, 500), rng.int(0, 190), 1, 1], [rng.int(0, 500), rng.int(0, 190), rng.int(1, 3), rng.int(1, 3)]]);
  if (k < 0.5) return [8 * rng.int(0, 60) + rng.int(-1, 1), 8 * rng.int(0, 22) + rng.int(-1, 1), 8 * rng.int(1, 40) + rng.int(-1, 1), 8 * rng.int(1, 12) + rng.int(-1, 1)];   // near cell boundaries
  if (k < 0.8) return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 160), rng.int(1, 60)];
  return [rng.int(-20, 500), rng.int(-10, 190), rng.int(1, 560), rng.int(1, 210)];
};
const printable = () => rng.int(32, 126);
const s64 = Array.from({ length: 64 }, (_, k) => 32 + k);
function randBytes(maxN = 255) {
  const k = rng.next();
  let n = k < 0.04 ? 0 : k < 0.38 ? rng.int(1, 12) : k < 0.72 ? rng.int(13, 80) : k < 0.97 ? rng.int(81, 200) : rng.int(201, 255);
  n = Math.min(n, maxN);
  const style = rng.next(), out = [];
  for (let i = 0; i < n; i++) {
    const q = rng.next();
    if (style < 0.5) out.push(q < 0.62 ? printable() : q < 0.68 ? 13 : q < 0.82 ? rng.int(0, 31) : rng.int(127, 255));      // the contract's mix
    else if (style < 0.8) out.push(q < 0.9 ? printable() : q < 0.93 ? 13 : rng.int(0, 255));                              // mostly text
    else out.push(q < 0.8 ? printable() : q < 0.88 ? 32 : q < 0.93 ? 13 : rng.int(128, 255));                              // text with spaces and high codes
  }
  return out;
}
const randWhere = () => { const q = rng.next(); return q < 0.8 ? 'buf' : q < 0.9 ? 'ram' : 'cart'; };
const randOff = (n) => (rng.chance(0.5) ? 0 : rng.int(0, Math.min(256, 512 - n)));
// A random per-call setup: new clip now and then, a new op every call, GLH sometimes.
const randSetup = (i) => {
  if (i % 40 === 0) resync();
  if (i % 3 === 0) setClip(...randClip());
  setOp(rng.int(0, 2));
  if (rng.chance(0.35)) setGlh(rng.int(1, 20));
};

{
  const cat = new Cat(`random G_TEXT8, ${N} calls (every op, random clips incl. empty / tiny / cell-edge, off-screen columns and rows, random strings)`);
  for (let i = 0; i < N; i++) {
    randSetup(i);
    const bytes = randBytes(), c = scr.clip, q = rng.next();
    let col, row;
    if (q < 0.45) { col = (c.x0 >> 3) + rng.int(-3, 3); row = (c.y0 >> 3) + rng.int(-1, 2); }
    else if (q < 0.65) { col = (c.x1 >> 3) - rng.int(0, Math.min(bytes.length, 8)) + rng.int(-1, 1); row = (c.y1 >> 3) - 1 + rng.int(-1, 1); }
    else if (q < 0.95) { col = rng.int(-6, 70); row = rng.int(-3, 26); }
    else { col = rng.int(-300, 400); row = rng.int(-40, 60); }
    const w = randWhere();
    t8(cat, col, row, bytes, { where: w, off: w === 'buf' ? randOff(bytes.length) : 0 });
  }
  cat.report();
  fullClip(); setOp(0);
}
{
  const cat = new Cat(`random G_TEXTP, ${N} calls (every op, random clips incl. empty / tiny, positions off-screen and negative, GLH 1..20, codes 0..255 incl. 13)`);
  for (let i = 0; i < N; i++) {
    randSetup(i);
    const bytes = randBytes(), c = scr.clip, q = rng.next();
    let x, y;
    if (q < 0.3) { x = c.x0 + rng.int(-14, 14); y = c.y0 + rng.int(-10, 10); }
    else if (q < 0.5) { x = c.x1 + rng.int(-24, 6); y = c.y1 + rng.int(-12, 4); }
    else if (q < 0.9) { x = rng.int(-40, 520); y = rng.int(-12, 200); }
    else { x = rng.int(-900, 1200); y = rng.int(-300, 500); }
    const w = randWhere();
    tp(cat, x, y, bytes, { where: w, off: w === 'buf' ? randOff(bytes.length) : 0 });
  }
  cat.report();
  fullClip(); setOp(0); setGlh(8);
}
{
  const cat = new Cat(`random G_TEXTW, ${N} calls (random strings incl. n = 0 and code 13; the screen, GA+0 / GA+2, GOP, GLH and the clip are untouched)`);
  for (let i = 0; i < N; i++) {
    if (i % 40 === 0) resync();
    if (i % 5 === 0) setClip(...randClip());
    setOp(rng.int(0, 2));
    if (i % 7 === 0) setGlh(rng.int(1, 20));
    const bytes = randBytes(), w = randWhere();
    tw(cat, bytes, { where: w, off: w === 'buf' ? randOff(bytes.length) : 0 });
  }
  cat.report();
  fullClip(); setOp(0); setGlh(8);
}

// ===========================================================================================================================
// 4. Edge cases written out (section 8 item 3, 14).
const XS = [0, 7, 8, 15, 16, 255, 256, 503, 504, 511];
const codes = (s) => Array.from(s, (ch) => ch.charCodeAt(0));
resync(); fullClip(); setOp(0); setGlh(8);
{
  // 4.1 G_TEXTP at the x list x y list x ops.
  const cat = new Cat('edge G_TEXTP: x in {0,7,8,15,16,255,256,503,504,511} x y in {0,1,7,184,185,191} x every op x 3 strings');
  const strs = [codes('W'), codes('!'), codes('Hjg(Qy] {World}')];
  let i = 0;
  for (const x of XS) for (const y of [0, 1, 7, 184, 185, 191]) for (let op = 0; op < 3; op++) {
    if (i % 60 === 0) resync();
    setOp(op);
    tp(cat, x, y, strs[i++ % 3]);
  }
  cat.report();

  const above = new Cat('edge G_TEXTP: y partly above / below the screen (-8..-1 and 186..193) at the x list, every op');
  i = 0;
  for (const y of [-8, -7, -6, -4, -1, 186, 188, 190, 192, 193]) for (const x of XS) for (let op = 0; op < 3; op++) {
    if (i % 60 === 0) resync();
    setOp(op);
    tp(above, x, y, codes('Wgq|'), {});
    i++;
  }
  above.report();

  // 4.2 every glyph of the font at every p = 0..7.
  const gl = new Cat('edge G_TEXTP: every glyph 32..126 at x = 64 + p, p = 0..7, y = 50, every op (clip whole screen)');
  i = 0;
  for (let c = 32; c <= 126; c++) for (let p = 0; p < 8; p++) for (let op = 0; op < 3; op++) {
    if (i++ % 90 === 0) resync();
    setOp(op);
    tp(gl, 64 + p, 50, [c]);
  }
  gl.report();

  const gr = new Cat('edge G_TEXTP: every glyph 32..126 near the right edge (x = 500 + p, p = 0..11) and the left edge (x = -7 + p), rotating op');
  i = 0;
  for (let c = 32; c <= 126; c++) for (let p = 0; p < 12; p++) {
    if (i % 90 === 0) resync();
    setOp(i++ % 3);
    tp(gr, 500 + p, 3 + (c % 180), [c]);
    tp(gr, -7 + p, 4 + (c % 180), [c, c]);
  }
  gr.report();

  // 4.3 clip edges cutting a glyph inside its byte, text running off a clip's right edge.
  const ce = new Cat('edge G_TEXTP: a clip edge inside a glyph byte (clip x0 = 40 + j, width 9, j = 1..7; text at x = 36..45), every op; clips ending inside a byte');
  i = 0;
  for (let j = 0; j <= 8; j++) for (const dx of [-5, -3, 0, 2, 5, 9]) for (let op = 0; op < 3; op++) {
    if (i++ % 60 === 0) resync();
    setOp(op);
    setClip(40 + j, 20, 9, 14);
    tp(ce, 40 + dx, 24, codes('Wmg@%'));
    setClip(-5, 20, 40 + j + 3, 14);
    tp(ce, 30 + dx, 22, codes('Wmg@%MW'));
  }
  ce.report();

  const ro = new Cat('edge G_TEXTP: long text running off the right edge of the screen and of a clip, wrapping not applied; 100 and 255 codes');
  i = 0;
  const long100 = codes('The quick brown fox jumps over the lazy dog. '.repeat(3)).slice(0, 100);
  const long255 = Array.from({ length: 255 }, (_, k) => 32 + ((k * 7) % 95));
  for (let op = 0; op < 3; op++) {
    setOp(op); fullClip();
    for (const x of [0, 5, 256, 440, 500, 511]) { tp(ro, x, 10, long100); tp(ro, x, 100, long255); }
    for (const clip of [[100, 50, 120, 40], [101, 51, 97, 33], [0, 0, 512, 1], [255, 0, 3, 192]]) {
      setClip(...clip);
      for (const x of [60, 99, 101, 150]) tp(ro, x, 55, long100);
      tp(ro, 0, 0, long255);
    }
    fullClip();
    resync();
  }
  ro.report();

  // 4.4 empty clip, n = 0, a 255-code string, CR lines that leave the screen.
  const em = new Cat('empty clip: the display is untouched by G_TEXT8 / G_TEXTP / G_TEXTW (bytes compared directly, not with the model); pen still returned');
  for (const clip of [[10, 10, 0, 5], [10, 10, 5, 0], [10, 10, -5, 5], [600, 10, 20, 20], [-30, -30, 20, 20], [10, 200, 5, 5], [512, 0, 5, 5]]) {
    setClip(...clip);
    for (let op = 0; op < 3; op++) {
      resync(); setOp(op);
      const before = [m.ram.slice(0x4000, 0x5800), m.ram.slice(0x6000, 0x7800)];
      t8(em, 0, 0, codes('Hello world, this is text'));
      t8(em, 1, 1, long255);
      tp(em, 20, 20, codes('Hello world'));
      tp(em, 0, 0, long255);
      tw(em, codes('Hello\rworld'));
      const same = m.ram.slice(0x4000, 0x5800).every((v, k) => v === before[0][k]) && m.ram.slice(0x6000, 0x7800).every((v, k) => v === before[1][k]);
      em.record(`empty clip ${clip} op ${op}`, same ? [] : ['display changed']);
    }
  }
  em.report();
  fullClip(); setOp(0);

  const nz = new Cat('n = 0 (all three routines): nothing drawn, G_TEXTP returns (x, y), G_TEXTW returns 0');
  for (let op = 0; op < 3; op++) for (const [a, b] of [[0, 0], [511, 191], [-100, -100], [300, 300], [5, 5]]) {
    resync(); setOp(op);
    t8(nz, a >> 3, b >> 3, []); tp(nz, a, b, []); tw(nz, []);
    t8(nz, a >> 3, b >> 3, [], { where: 'ram' }); tp(nz, a, b, [], { where: 'cart' });
  }
  nz.report();

  const all255 = new Cat('a 255-code string: codes 1..255, 255 x "W", 255 x 13, 255 x code 200; every op, G_TEXT8 / G_TEXTP / G_TEXTW');
  const seq = Array.from({ length: 255 }, (_, k) => k + 1);
  for (const bytes of [seq, Array(255).fill(87), Array(255).fill(13), Array(255).fill(200), [...seq].reverse()]) for (let op = 0; op < 3; op++) {
    resync(); setOp(op); setGlh(3);
    t8(all255, 0, 4, bytes); t8(all255, -100, 9, bytes, { off: 255 }); tp(all255, 5, 3, bytes); tp(all255, -3, -2, bytes, { off: 255 }); tw(all255, bytes);
    t8(all255, 20, 4, bytes, { where: 'ram' }); tp(all255, 5, 30, bytes, { where: 'ram' });
  }
  all255.report();
  setGlh(8);

  const cr = new Cat('edge G_TEXTP: code 13 lines that leave the screen at the bottom, come in from above, GLH 1 / 8 / 10 / 20 / 100 / 255');
  i = 0;
  const lines = (n, s = 'Line one') => { const out = []; for (let k = 0; k < n; k++) { out.push(...codes(s), 13); } return out; };
  for (const glh of [1, 8, 10, 20, 100, 255]) for (let op = 0; op < 3; op++) {
    resync(); setOp(op); setGlh(glh);
    const nlines = glh >= 100 ? 2 : 12;
    for (const [x, y] of glh >= 100 ? [[5, 3], [200, -200], [0, 100]] : [[5, 3], [5, 150], [300, 185], [500, 100], [0, -60], [100, -9], [0, 191], [511, 0]]) {
      tp(cr, x, y, lines(nlines));
      if (i++ % 4 === 0) tp(cr, x, y, [13, 13, ...codes('Wg'), 13, 13, 13, ...codes('x')]);
    }
  }
  cr.report();
  fullClip(); setOp(0); setGlh(8);

  // 4.5 G_TEXT8 edge cases.
  const e8 = new Cat('edge G_TEXT8: columns {0,1,2,31,32,62,63,-1,64}, rows {0,1,22,23,-1,24}, n in {0,1,2,3,64}, every op');
  i = 0;
  for (const col of [0, 1, 2, 31, 32, 62, 63, -1, 64]) for (const row of [0, 1, 22, 23, -1, 24]) for (let op = 0; op < 3; op++) for (const n of [0, 1, 2, 3, 64]) {
    if (i++ % 60 === 0) resync();
    setOp(op);
    t8(e8, col, row, s64.slice(0, n), { off: n === 64 ? 0 : (i % 7) * 31 });
  }
  e8.report();

  const e8b = new Cat('edge G_TEXT8: every code 0..255 (c AND $7F), 32 cells per call, rows 5 and 23, every op, off the right edge');
  for (let op = 0; op < 3; op++) for (let base = 0; base < 256; base += 32) {
    if (base % 64 === 0) resync();
    setOp(op);
    const bytes = Array.from({ length: 32 }, (_, k) => base + k);
    t8(e8b, 0, 5, bytes); t8(e8b, 40, 23, bytes); t8(e8b, 25, 0, bytes, { off: 100 });
  }
  e8b.report();

  const e8c = new Cat('edge G_TEXT8: clip edges around the cells: clip x0/x1/y0/y1 on a cell boundary and off by one pixel either way (a cell is drawn only if wholly inside)');
  i = 0;
  for (const dx0 of [0, 1, -1]) for (const dx1 of [0, 1, -1]) for (const dy0 of [0, 1, -1]) for (const dy1 of [0, 1, -1]) for (let op = 0; op < 3; op++) {
    if (i++ % 60 === 0) resync();
    setOp(op);
    setClip(16 + dx0, 24 + dy0, (48 + dx1) - (16 + dx0), (48 + dy1) - (24 + dy0));        // cells 2..5, rows 3..5
    t8(e8c, 0, 3, codes('abcdefghij'));
    t8(e8c, 0, 4, codes('ABCDEFGHIJ'));
    t8(e8c, 0, 5, codes('0123456789'));
    t8(e8c, 1, 2, codes('QRSTUV'));
  }
  setClip(3, 5, 400, 150);                                                                   // not a cell multiple anywhere
  for (let op = 0; op < 3; op++) { setOp(op); t8(e8c, 0, 0, s64); t8(e8c, 0, 1, s64); t8(e8c, 0, 20, s64); t8(e8c, 0, 22, s64); }
  setClip(0, 0, 8, 8); t8(e8c, 0, 0, codes('A')); t8(e8c, -1, 0, codes('AB'));             // exactly one cell
  setClip(0, 184, 512, 8); t8(e8c, 0, 23, s64); setClip(504, 0, 8, 192); t8(e8c, 63, 0, codes('AB')); t8(e8c, 63, 23, codes('A'));
  e8c.report();
  fullClip(); setOp(0);

  // 4.6 G_TEXTW edge cases.
  const ew = new Cat('edge G_TEXTW: empty, CR only, CR CR, leading / trailing CR, ragged lines, every code 0..255, no-glyph codes, the widest glyph, 255 codes');
  const W = G.fonts().prop6.W;
  const widest = [...Array(95).keys()].map((k) => k + 32).sort((a, b) => W[b] - W[a])[0];
  for (const bytes of [[], [13], [13, 13], codes('a'), codes('\rabc'), codes('abc\r'), codes('Hello\rWorld!!\rhi'), codes('\r\r\rWW\r'), Array.from({ length: 256 }, (_, k) => k).slice(0, 255),
    [0, 1, 31, 127, 128, 200, 255, 193], Array(255).fill(widest), Array(255).fill(13), [widest, 13, widest, widest], codes('x'.repeat(100) + '\r' + 'W'.repeat(60) + '\r' + 'i'.repeat(200))]) {
    resync(); setOp(rng.int(0, 2));
    tw(ew, bytes);
    tw(ew, bytes, { off: 255 - bytes.length < 0 ? 0 : 255 - bytes.length });
  }
  ew.report();
}

// ===========================================================================================================================
// 5. Longest DI (section 7): each routine stepped from iff1 = true, long strings and short.
{
  const cat = new Cat('longest DI run <= 1,500 T, interrupt flag as found, in G_TEXT8 / G_TEXTP / G_TEXTW (stepped with interrupts on)');
  let worst = 0, worstName = '';
  const di = (name) => (r) => { if (r.maxDiRun > worst) { worst = r.maxDiRun; worstName = name; } };
  fullClip();
  const mixed = Array.from({ length: 255 }, () => (rng.chance(0.85) ? printable() : rng.chance(0.4) ? 13 : rng.int(0, 255)));
  for (let k = 0; k < 6; k++) {
    resync(); setOp(k % 3); setGlh(k % 2 ? 10 : 8);
    if (k >= 4) setClip(...randClip());
    t8(cat, k, 10, s64, { ints: true, diOut: di('G_TEXT8') });
    t8(cat, -3, 22, mixed, { ints: true, diOut: di('G_TEXT8') });
    tp(cat, 5 + k, 3, codes('The quick brown fox jumps over the lazy dog. Mode 6 gives the desktop'), { ints: true, diOut: di('G_TEXTP') });
    tp(cat, -20, -10, mixed, { ints: true, diOut: di('G_TEXTP') });
    tw(cat, mixed, { ints: true, diOut: di('G_TEXTW') });
    tw(cat, codes('The quick brown fox'), { ints: true, diOut: di('G_TEXTW') });
  }
  cat.report(`, longest DI run ${worst} T (${worstName || 'none'})`);
  fullClip(); setOp(0); setGlh(8);
}

support.report();
const bad = allCats.filter((c) => c.bad).length;
console.log(`${allCats.length} categories, ${allCats.reduce((s, c) => s + c.calls, 0)} checked calls, ${bad} failing categories; seed ${SEED}`);
C.done();
