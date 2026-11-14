"use strict";
// g6-line.mjs -- G_LINE in DOCK chunk 6 under mapping R ($F4 = $73), on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Since SIZE 4 (P0) nothing in desk5 calls G_LINE (Check's X is five G_FILLs), so its chunk 6 copy is exercised only here.  Written from
// docs/GRAPHICS_SPIKE.md 15.2 (the line's contract), docs/BANKING.md (KFAR, the mappings, 10.7) and tests/gfx6-s3.mjs (the gfx6t line tests, same model).
//   node tests/g6-line.mjs [--seed N] [--n N]
//     --seed N   PRNG seed (printed; default 1); a failure is reproduced with the same seed
//     --n N      random lines (default 600)
// Method: tk-lib's bootParked (desk5 booted, the pointer erased, the shell's window closed, the CPU parked at T_RET, no frame run afterwards while lines are drawn).
// Each line is called from a 4-byte stub under mapping K at $5F00 (`rst $28 / DW G_LINE / ret`: KFAR to chunk 6) with random registers; G_SETOP / G_SETCLIP are
// called directly under K.  The display files are seeded with random bytes every few lines; the whole 512 x 192 screen is compared with
// tests/gfx6-model.mjs (Gfx6Model.line, op, clip) after every line.  Also: the mapping at G_LINE's entry and for every access made from code
// in $C000-$DFFF is R; no write at all to $C000-$DFFF during the calls (and that RAM is unchanged); no write to RAM outside the display files, the stack window
// and KFAR's own cells; the stack used (KFAR included) <= 128 bytes; no DI; IY and the alternate set preserved; the mapping back to K; then normal frames
// run with V_FRAMES +1 each, a line drawn between frames.
// Exit code 1 on any failure.  The last line is "g6-line: N passed, M failed".
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import { makeRng } from './gfx6-lib.mjs';
import * as G from './gfx6-model.mjs';
import { M, Z } from './lib.mjs';

const { L } = T;
const { hex, argNum } = L;
const SEED = argNum('--seed', 1), N = argNum('--n', 600);
console.log(`seed ${SEED} (rerun with --seed ${SEED}), ${N} random lines`);
const C = checks('g6-line');
const rng = makeRng(SEED);
const STUB = 0x5F00;                       // free RAM under K ($5800-$5FFF is unused in mode 6; tk-lib uses $5800-$5E1F)
const STACK_BOUND = 128;

const env = T.bootParked({ rng, video: false });
const { m, S } = env;
T.needSyms(env, ['G_LINE', 'G_SETOP', 'G_SETCLIP', 'GA', 'GOP', 'GCLIP', 'K_FAR', 'K_FJP', 'V_SHADOW_F4', 'V_FRAMES']);
if (S.G_LINE < 0xC000 || S.G_LINE >= 0xE000) { C.check('G_LINE is in chunk 6 ($C000-$DFFF)', false, hex(S.G_LINE)); C.done(); process.exit(); }
C.check(`G_LINE is in chunk 6 ($C000-$DFFF): ${hex(S.G_LINE)}`, true);

// the stub: rst $28 / DW G_LINE / ret
m.ram[STUB] = 0xEF; m.ram[STUB + 1] = S.G_LINE & 0xFF; m.ram[STUB + 2] = S.G_LINE >> 8; m.ram[STUB + 3] = 0xC9;

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
const entry = { n: 0, bad: [] };           // the mapping at G_LINE's first instruction
const hooks = { [S.G_LINE]: () => { entry.n++; if (m.portF4 !== 0x73 || m.ram[S.V_SHADOW_F4] !== 0x73) entry.bad.push(`port ${hex(m.portF4, 2)} shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}`); } };

// ---- helpers ---------------------------------------------------------------------------------------------------------------------------------------
const seedDisplay = () => { for (let a = 0x4000; a < 0x5800; a++) m.ram[a] = rng.int(0, 255); for (let a = 0x6000; a < 0x7800; a++) m.ram[a] = rng.int(0, 255); };
const setGA = (...w) => w.forEach((v, i) => { m.ram[S.GA + 2 * i] = v & 0xFF; m.ram[S.GA + 2 * i + 1] = (v >> 8) & 0xFF; });
const scr = new G.Gfx6Model();
const clipStr = () => `[${scr.clip.x0},${scr.clip.x1},${scr.clip.y0},${scr.clip.y1}]`;
let setupBad = 0, setupFirst = '';
function setOp(op) {
  T.runCall(env, S.G_SETOP, { a: op }, { ints: false });
  scr.setOp(op);
  if (m.ram[S.GOP] !== op) { setupBad++; setupFirst ||= `GOP ${m.ram[S.GOP]}, want ${op}`; }
}
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
const XS = [0, 7, 8, 15, 16, 255, 256, 503, 504, 511], YS = [0, 1, 7, 8, 63, 64, 100, 184, 185, 190, 191];
function randLine() {
  const q = rng.next(), c = scr.clip, near = () => [rng.int(-20, 530), rng.int(-20, 212)], far = () => [rng.int(-16384, 16383), rng.int(-16384, 16383)];
  const cw = (v) => Math.max(-16384, Math.min(16383, v));
  let x0, y0, x1, y1;
  if (q < 0.34) { [x0, y0] = near(); [x1, y1] = near(); }
  else if (q < 0.44) { [x0, y0] = near(); x1 = x0 + rng.int(-6, 6); y1 = y0 + rng.int(-6, 6); }
  else if (q < 0.56) {
    if (scr.clipEmpty()) { [x0, y0] = near(); [x1, y1] = near(); }
    else { x0 = rng.int(c.x0, c.x1 - 1); y0 = rng.int(c.y0, c.y1 - 1); x1 = rng.int(c.x0, c.x1 - 1); y1 = rng.int(c.y0, c.y1 - 1); }
  } else if (q < 0.64) {
    [x0, y0] = near();
    const d = rng.int(1, 120), k = rng.int(0, 7);
    [x1, y1] = [[d, 0], [0, d], [d, d], [d, -d], [2 * d, d], [d, 2 * d], [-d, 2 * d + 1], [2 * d + 1, -d]][k].map((v, i) => v + (i ? y0 : x0));
  } else if (q < 0.70) { [x0, y0] = near(); x1 = x0; y1 = y0; }
  else if (q < 0.76) { [x0, y0] = near(); [x1, y1] = far(); if (rng.chance(0.5)) [x0, y0, x1, y1] = [x1, y1, x0, y0]; }
  else if (q < 0.80) { [x0, y0] = far(); [x1, y1] = far(); }
  else if (q < 0.90) { [x0, y0] = near(); [x1, y1] = [x0 + rng.int(-700, 700), y0 + rng.int(-400, 400)]; }
  else { x0 = rng.pick(XS) + rng.int(-1, 1); y0 = rng.pick(YS) + rng.int(-1, 1); x1 = rng.pick(XS) + rng.int(-1, 1); y1 = rng.pick(YS) + rng.int(-1, 1); }
  return [cw(x0), cw(y0), cw(x1), cw(y1)];
}

// RAM that a call may change: gfx6's scratch $E01A-$E07F and $E700-$E7FF (GRAPHICS_SPIKE 14.1, 15.1; GA / GOP / GCLIP are checked separately), the display files, the stack window, and KFAR's cells ($F0D0 JP nnnn, $F0D3 A); the shadow of $F4 must come back as it was
const MAY = (a) => (a >= 0xE01A && a < 0xE080) || (a >= 0xE700 && a < 0xE800) || (a >= 0x4000 && a < 0x5800) || (a >= 0x6000 && a < 0x7800) || (a >= 0xFE00 && a < 0xFF00) || (a >= S.K_FJP && a < S.K_FJP + 4);
const stats = { lines: 0, bad: 0, first: '', ops: [0, 0, 0], stackMax: 0, stackBad: 0, outside: 0, outsideFirst: '', di: 0, pres: 0, presFirst: '', mapBack: 0, tMax: 0, cases: {} };
const fail = (what) => { stats.bad++; if (!stats.first) stats.first = what; };

/** One checked line: G_LINE through KFAR from the stub, the screen against the model, and the side checks. */
function line(x0, y0, x1, y1, tag = 'random') {
  const desc = `(${x0}, ${y0})-(${x1}, ${y1}) op ${scr.op} clip ${clipStr()}`;
  setGA(x0, y0, x1, y1);
  const before = new Uint8Array(m.ram.subarray(0, 0x10000));
  watch.armed = true;
  let r;
  const ga = Array.from(m.ram.subarray(S.GA, S.GA + 8)), oc = Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8));
  try { r = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 6_000_000 }); }
  catch (e) { watch.armed = false; fail(`${tag} ${desc}: ${e.message}`); return false; }
  watch.armed = false;
  stats.lines++; stats.ops[scr.op]++; stats.cases[tag] = (stats.cases[tag] || 0) + 1;
  scr.line(x0, y0, x1, y1);
  const d = scr.compareRam(m.ram);
  let ok = true;
  if (d) {
    ok = false;
    // the first differing display byte, for the report
    const want = scr.toBytes(); let k = 0; while (want[k] === m.ram[k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800]) k++;
    const a = k < 0x1800 ? 0x4000 + k : 0x6000 + k - 0x1800;
    fail(`${tag} line ${desc}: ${G.fmtDiff(d)}; first differing byte ${hex(a)} is ${hex(m.ram[a], 2)}, model ${hex(want[k], 2)}`);
    scr.loadRam(m.ram);
  }
  if (r.stack > stats.stackMax) stats.stackMax = r.stack;
  if (r.stack > STACK_BOUND) { stats.stackBad++; ok = false; fail(`${tag} line ${desc}: stack ${r.stack} bytes > ${STACK_BOUND}`); }
  if (r.di) { stats.di++; ok = false; fail(`${tag} line ${desc}: ${r.di} DI executed`); }
  if (r.preserved.length) { stats.pres++; ok = false; stats.presFirst ||= `${desc}: ${r.preserved.join(',')}`; fail(`${tag} line ${desc}: not preserved: ${r.preserved.join(',')}`); }
  if (m.portF4 !== 0x33 || m.ram[S.V_SHADOW_F4] !== 0x33) { stats.mapBack++; ok = false; fail(`${tag} line ${desc}: mapping after the call: port ${hex(m.portF4, 2)}, shadow ${hex(m.ram[S.V_SHADOW_F4], 2)}, want $33`); }
  if (Array.from(m.ram.subarray(S.GA, S.GA + 8)).join() !== ga.join() || Array.from(m.ram.subarray(S.GOP, S.GCLIP + 8)).join() !== oc.join()) { ok = false; fail(`${tag} line ${desc}: GA / GOP / GCLIP changed`); }
  if (r.sp !== 0xFF00 - 2 + 2) { ok = false; fail(`${tag} line ${desc}: SP ${hex(r.sp)} after the call, want $FF00`); }
  for (let a = 0; a < 0x10000; a++) {
    if (m.ram[a] !== before[a] && !MAY(a)) { stats.outside++; ok = false; if (!stats.outsideFirst) stats.outsideFirst = `${desc}: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`; fail(`${tag} line ${desc}: RAM outside the display and stack changed: ${hex(a)} ${hex(before[a], 2)} -> ${hex(m.ram[a], 2)}`); break; }
  }
  if (r.t > stats.tMax) stats.tMax = r.t;
  return ok;
}
const resync = () => { seedDisplay(); scr.loadRam(m.ram); };

// ---- 1. random lines -----------------------------------------------------------------------------------------------------------------------------
resync(); setClip(0, 0, 512, 192); setOp(0);
for (let i = 0; i < N; i++) {
  if (i % 25 === 0) resync();
  if (i % 2 === 0) setClip(...randClip());
  setOp(rng.int(0, 2));
  line(...randLine());
}
// ---- 2. edge cases: octants from edges, points, corner to corner, long lines, every op, empty clip ----------------------------------------------------
setClip(0, 0, 512, 192);
const fixed = [];
const FIXED = [[0, 0, 511, 191], [511, 191, 0, 0], [0, 191, 511, 0], [511, 0, 0, 191], [0, 0, 511, 0], [0, 0, 0, 191], [0, 191, 511, 191], [511, 0, 511, 191],
  [-16384, -16384, 16383, 16383], [-16384, 0, 16383, 191], [100, 100, 100, 100], [511, 191, 511, 191], [0, 0, 0, 0], [7, 5, 8, 5], [15, 9, 16, 11], [-1, -1, 512, 192]];
for (const op of [0, 1, 2]) for (const l of FIXED) fixed.push([op, l]);
for (let i = 0; i < fixed.length; i++) {
  if (i % 8 === 0) resync();
  setOp(fixed[i][0]);
  line(...fixed[i][1], 'edge');
}
resync();
setClip(100, 50, 0, 20); setOp(0); line(0, 0, 511, 191, 'empty-clip');         // empty clip: the display must stay as seeded
setClip(0, 0, 512, 192); setOp(0);

// ---- 3. frames: normal frames after the lines, V_FRAMES +1 each, a line drawn between frames (no DI held across a frame) --------------------------------
const framesBad = { n: 0, first: '' };
{
  watch.armed = false;
  // the stepped calls above advanced the clock beyond the frame counter: run parked (interrupts off) frames until it is caught up (as gfx6-s4 / wm-w2 do), then interrupts on
  const cpu = m.cpu;
  cpu.pc = S.T_RET; cpu.iff1 = cpu.iff2 = false; cpu.halted = false; cpu.sp = 0xFF00;
  for (let k = 0; k < 100000 && m.tstates - m.frameStart >= 58688; k++) { if (m.tstates < m.frameStart + 58688) m.tstates = m.frameStart + 58688; M.runFrame(m); }
  cpu.iff1 = cpu.iff2 = true;
  setClip(0, 0, 512, 192); setOp(0);
  framesBad.checked = 0; framesBad.vfbad = 0;
  for (let i = 0; i < 13; i++) {                              // i = 0 is the warm-up (the clock was mid-frame, its interrupt came while parked with interrupts off): run, not checked
    const v0 = L.rd16(m, S.V_FRAMES);
    M.runFrame(m);                                          // a normal frame: it ends just after the interrupt is accepted at $0038
    let g = 0; while (cpu.pc !== S.T_RET && ++g < 20000) Z.runZ80(cpu, m.bus, 1, m);   // the ISR runs to its return into the parked loop (no interrupt due for ~58,000 T)
    if (cpu.pc !== S.T_RET) { framesBad.n++; framesBad.first ||= `frame ${i}: the ISR did not return to the parked loop (PC ${hex(cpu.pc)})`; break; }
    cpu.iff1 = cpu.iff2 = true;
    const dv = (L.rd16(m, S.V_FRAMES) - v0) & 0xFFFF;
    if (i > 0) framesBad.checked++;
    if (i > 0 && dv !== 1) { framesBad.vfbad++; framesBad.first ||= `frame ${i}: V_FRAMES ${v0} -> ${v0 + dv}`; }
    // a line between frames, drawn into the live display with interrupts on (the pointer's ISR drawing may touch the display, so only the mapping, DI and the frame count are checked here)
    setGA(0, 0, 100 + 10 * i, 30);
    const cat = T.runCall(env, STUB, {}, { ints: true, hooks, guard: 6_000_000 });
    if (cat.di || m.portF4 !== 0x33) { framesBad.n++; framesBad.first ||= `frame ${i}: di ${cat.di}, port ${hex(m.portF4, 2)}`; }
    cpu.pc = S.T_RET; cpu.sp = 0xFF00; cpu.iff1 = cpu.iff2 = true;
  }
}

// ---- report ----------------------------------------------------------------------------------------------------------------------------------------
C.check(`display after every line equals the reference model: ${stats.lines} lines compared (ops SET/CLR/XOR ${stats.ops.join('/')}; random ${stats.cases.random || 0}, edge ${stats.cases.edge || 0}, empty clip ${stats.cases['empty-clip'] || 0})`,
  stats.bad === 0 && stats.lines === (stats.cases.random || 0) + (stats.cases.edge || 0) + (stats.cases['empty-clip'] || 0), stats.bad ? `${stats.bad} failed, first: ${stats.first}` : '');
C.check('G_SETOP / G_SETCLIP behave as specified on the way', setupBad === 0, setupFirst);
C.check(`G_LINE ran under R ($F4 = $73, shadow $73) at its first instruction: ${entry.n} entries`, entry.n >= stats.lines && entry.bad.length === 0, entry.bad.slice(0, 3).join(' | '));
C.check(`every access made by code in $C000-$DFFF was under R: ${watch.accR} accesses`, watch.accR > 0 && watch.badMap.length === 0, watch.badMap.join(' | '));
C.check('no write to $C000-$DFFF during the calls', watch.wrHeap.length === 0, watch.wrHeap.join(' | '));
C.check('no RAM written outside the display files, the stack window and KFAR cells (whole 64 KB compared after every line)', stats.outside === 0, stats.outsideFirst);
C.check(`stack used (KFAR included) <= ${STACK_BOUND} bytes: max ${stats.stackMax}`, stats.stackBad === 0);
C.check('no DI, IY and the alternate set preserved, SP and the mapping ($33) restored after every call', stats.di === 0 && stats.pres === 0 && stats.mapBack === 0, stats.presFirst);
C.check(`memory watch of BANKING 10.7 (tests/bank-lib makeWatch, armed through the whole run): ${env.w.summary()}`, env.w.n === 0);
C.check(`V_FRAMES rose by 1 every normal frame: ${framesBad.checked} frames checked, ${framesBad.vfbad} wrong, no DI across a frame`, framesBad.checked >= 12 && framesBad.vfbad === 0 && framesBad.n === 0, framesBad.first);
console.log(`longest call ${stats.tMax} T`);
C.done();
