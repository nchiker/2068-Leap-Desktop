"use strict";
// spike6.mjs -- slice S5 of the graphics spike (docs/GRAPHICS_SPIKE.md sections 17.6 and 17.7): the `spike6` demo cartridge on TSRun,
// headless.  Written from the contract (sections 3-7, 12, 14-16 and 17), never from src/spike6.asm.  The reference is the gfx6 model with
// the S4 pointer model plus tests/spike6-model.mjs (17.4 scene, 17.5 main loop, input and script).
//   node tests/spike6.mjs [--seed N] [--self-test]
//     --seed N       PRNG seed (printed; for the poison bytes)
//     --self-test    run the model's self-test only (no cartridge needed)
//
// Tests (17.6):   1 build and boot, icon / P_ARROW / S_SET / S_SCRIPT bytes     5 RAM outside the demo's areas unchanged
//                 2 checkpoints (display RAM, rendered frame, variables)        6 end of script: state 2 after iteration 426
//                 3 pointer frames in entries 2, 11, 17, 19                      7 live input, menu and drag round trip
//                 4 V_FRAMES + 1 per frame; missed main-loop frames reported     8 direct calls of D_SCENE / D_MENU_* / D_OUTLINE
// Then the 17.7 reports (T-states of the direct calls, missed frames, boot frames, code size).
//
// Readings of the contract (also listed in the report that came with this file):
//  B1. A frame is one runFrame; the ISR of the frame runs first, then at most one main-loop iteration.  The iteration that ran in a
//      frame is found from V_TICK (it is incremented at the start of the iteration, before the input is read).  A frame in which V_TICK
//      did not rise is a "missed" frame (the iteration of the frame before overran into it): reported, not a failure.
//  B2. After runFrame an accepted frame interrupt is pending at $0038 (gfx6-s4 R7); the ISR of that interrupt runs at the start of the
//      next runFrame.  So "the display at the end of frame j" = the ISR of frame j and the iteration of frame j (the pointer shown is the
//      one the ISR drew from the position set by iteration j - 1).
//  B3. Test 3 (pointer frames): in a frame whose iteration k is in an entry 2, 11, 17 or 19 and is not its first, the rendered frame is
//      the scene with the pointer at the position after iteration (V_TICK before the frame).  Frames with a missed iteration are skipped.
//  B4. Test 7: the live input is applied by setting the joystick contacts / key matrix before each runFrame; the model takes an
//      iteration per rise of V_TICK with the input set before that frame.  "A menu opened and closed with Space over a title, and a window
//      outline dragged and released": the pointer is steered there by keys / joystick under the model's control.  No iteration moves the
//      pointer on the release iteration (17.5 / A6).  All four directions on the joystick means "no input, fire included".
//  B5. Test 8 runs on a second, fresh boot (no frame run): the display of a fresh boot is the scene, the pointer drawn by no ISR yet.
//  B6. Code size: the demo's own code is not delimited by a symbol in 17.2; the report gives the span of the demo symbols found in the
//      symbol file inside chunk 5 and says so.
import { checks, M, FRAME_T, screenPixel } from './lib.mjs';
import * as G from './gfx6-model.mjs';
import { start, makeRng, call, poison, checkPoison, setGA, opClipBytes, readClip, hex, rd16, fillDisplay, w16 } from './gfx6-lib.mjs';
import * as X from './spike6-model.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--self-test')) { await X.selfTest(); process.exit(); }
const argVal = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? Number(argv[i + 1]) : dflt; };
const SEED = argVal('--seed', (Date.now() ^ (process.pid << 8)) >>> 0);
console.log(`seed ${SEED} (rerun with --seed ${SEED})`);

const C = checks('spike6');
const NEEDED = ['S_ICON', 'S_SET', 'S_SCRIPT', 'D_SCENE', 'D_MENU_OPEN', 'D_MENU_CLOSE', 'D_OUTLINE', 'S_LOOP', 'S_WAIT', 'S_CHECK', 'T_RET', 'RESULT',
  'V_FRAMES', 'V_TICK', 'V_PX', 'V_PY', 'V_MENU', 'V_DRAG', 'V_CHECKS', 'P_ARROW', 'P_ISR', 'GA', 'GOP', 'GLH', 'GCLIP'];
const ctx = start(C, NEEDED, 'spike6');
if (!ctx) { console.log('the spike6 cartridge is not available: nothing else can run'); C.done(); process.exit(); }
const { m, S, frames: bootFrames } = ctx;
const cpu = m.cpu;
const rng = makeRng(SEED);
const fmt = (n) => n.toLocaleString('en-US');
const arrow = Uint8Array.from({ length: 64 }, (_, i) => m.bus.read(S.P_ARROW + i));
const rdb = (a) => m.bus.read(a);

// ---------------------------------------------------------------------------------------------------------------------------
// helpers
let cur = m;                                                                       // the machine the helpers look at (test 8 switches to the second boot)
const ramDiff = (model, mach = cur) => model.compareRam(mach.ram);                      // null or { count, first }
/** The rendered 512 x 192 frame (m.pixels) against a model screen: null, or { count, first: 'pixel (x, y) shows a, model b' }. */
function renderDiff(model, mach = cur) {
  let count = 0, first = null;
  for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) {
    const want = model.px[y * 512 + x] ? 0 : 7, have = screenPixel(mach, x, y) & 7;
    if (have !== want) { count++; if (!first) first = `pixel (${x}, ${y}) shows ${have}, model ${want}`; }
  }
  return count ? { count, first } : null;
}
const fmtR = (d) => d ? `${d.count} pixels differ, first at (${d.first.x}, ${d.first.y}): RAM ${d.first.got}, model ${d.first.want}` : 'equal';
const fmtP = (d) => d ? `${d.count} pixels differ, first ${d.first}` : 'equal';
/** A Gfx6Model with the given pixel array and the pointer image blitted at (x, y). */
function withPointer(px, x, y) { const d = new G.Gfx6Model(); d.px.set(px); d.blit(x, y, 16, 16, arrow); return d; }
const asModel = (px) => { const d = new G.Gfx6Model(); d.px.set(px); return d; };
const vars = (mach = cur) => ({ px: mach.ram[S.V_PX] | (mach.ram[S.V_PX + 1] << 8), py: mach.ram[S.V_PY], menu: mach.ram[S.V_MENU], drag: mach.ram[S.V_DRAG] });
const varsText = (v) => `V_PX ${v.px}, V_PY ${v.py}, V_MENU ${v.menu === 0xFF ? '$FF' : v.menu}, V_DRAG ${v.drag}`;
const modelVars = (mdl) => ({ px: mdl.px, py: mdl.py, menu: mdl.menu, drag: mdl.drag });
const varsEq = (a, b) => a.px === b.px && a.py === b.py && a.menu === b.menu && a.drag === b.drag;
const tickOf = () => rd16(m, S.V_TICK), framesOf = () => rd16(m, S.V_FRAMES), state = () => m.ram[S.RESULT + 2];

// ---------------------------------------------------------------------------------------------------------------------------
// Test 1: build and boot (the record was checked by start(); here the state, the icon, P_ARROW, the shifted set and the script bytes)
console.log('--- test 1: build and boot');
{
  C.check(`boot: ${bootFrames} frames from reset to the record; V_TICK 0, V_CHECKS 0, no menu, no drag, position (256, 96)`,
    tickOf() === 0 && m.ram[S.V_CHECKS] === 0 && varsEq(vars(), { px: 256, py: 96, menu: 0xFF, drag: 0 }), `${varsText(vars())}, V_TICK ${tickOf()}, V_CHECKS ${m.ram[S.V_CHECKS]}`);
  const icon = X.iconBytes(), got = Array.from({ length: 128 }, (_, i) => rdb(S.S_ICON + i));
  const badI = icon.findIndex((v, i) => v !== got[i]);
  C.check('S_ICON (128 bytes) equals the 32 x 16 art of 17.4 in G_BLIT\'s pair format', badI < 0, badI < 0 ? '' : `byte ${badI}: image ${hex(got[badI], 2)}, art ${hex(icon[badI], 2)} (row ${badI >> 3}, pair ${(badI >> 1) & 3})`);
  const mdl0 = new X.Spike6Model(arrow);
  const set = mdl0.scr.preshift(32, 16, icon), rs = Array.from({ length: set.length }, (_, i) => m.ram[S.S_SET + i]);
  const badS = set.findIndex((v, i) => v !== rs[i]);
  C.check(`S_SET (${set.length} bytes) is the shifted set of the icon (G_PRESHIFT, 15.2) at $C000`, S.S_SET === 0xC000 && set.length === 1280 && badS < 0, badS < 0 ? '' : `byte ${badS}: ${hex(rs[badS], 2)} want ${hex(set[badS], 2)}`);
  const sb = X.scriptBytes(), gs = sb.map((_, i) => rdb(S.S_SCRIPT + i)), badB = sb.findIndex((v, i) => v !== gs[i]);
  C.check('S_SCRIPT: 20 entries of (n, bits | $80 on a checkpoint) as in 17.5, then n = 0', badB < 0, badB < 0 ? '' : `byte ${badB}: ${hex(gs[badB], 2)} want ${hex(sb[badB], 2)}`);
  const d0 = ramDiff(mdl0.scr), d1 = ramDiff(withPointer(mdl0.scr.px, 256, 96));
  C.check('after boot the display is the scene of 17.4 (the pointer not yet drawn: the ISR draws it)', !d0 || !d1, `without pointer: ${fmtR(d0)}; with pointer at (256, 96): ${fmtR(d1)}`);
  C.check('P_ARROW: 64 bytes in the cartridge, a visible pointer (some ink pixels)', arrow.some((v, i) => (i & 1) && v), `bytes ${Array.from(arrow.subarray(0, 8)).map((v) => v.toString(16).padStart(2, '0')).join(' ')} ...`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Tests 2-6: the script, run with runFrame
console.log('--- tests 2-6: the script');
const POISON = [[0x5800, 0x5FFF], [0x7800, 0x7FFF], [0xC500, 0xDFFF], [0xF000, 0xFAFF]];
const tok = poison(m, rng, { stack: false, regions: POISON });                       // 17.6.5: after boot, before the script
const setBefore = m.ram.slice(S.S_SET, S.S_SET + 1280);

const mdl = new X.Spike6Model(arrow);
const scene = mdl.scr.px.slice();                                                  // the model's scene (checked against the cartridge at checkpoints 1, 4, 6, 7, 8)
const posAt = [[256, 96]];
const ptrEntries = [2, 11, 17, 19].map((i) => X.ENTRY_SPAN[i - 1]);                   // test 3
const ptrIter = new Set(ptrEntries.flatMap((e) => Array.from({ length: e.last - e.first }, (_, k) => e.first + 1 + k)));
const missed = [];                                                                 // frames in which the main loop did not run: { frame, tick }
const vfBad = [], stateBad = [], posBad = [], menuLag = [];
let tickPrev = tickOf(), vfPrev = framesOf(), ckSeen = 0, frame = 0, ptrFrames = 0, ptrBad = [], endState = null;
const cpResults = [];
const ptrCache = new Map();
while (tickOf() < X.SCRIPT_ITERATIONS && frame < 900) {
  M.runFrame(m); frame++;
  const tk = tickOf(), vf = framesOf(), ck = m.ram[S.V_CHECKS];
  if (((vf - vfPrev) & 0xFFFF) !== 1) vfBad.push(`frame ${frame}: V_FRAMES rose by ${(vf - vfPrev) & 0xFFFF}`);
  if (tk - tickPrev > 1 || tk < tickPrev) vfBad.push(`frame ${frame}: V_TICK rose by ${tk - tickPrev}`);
  if (tk === tickPrev) missed.push({ frame, tick: tk });
  mdl.isr();
  for (let t = tickPrev + 1; t <= tk && t <= X.SCRIPT_ITERATIONS; t++) { mdl.iterate(X.scriptBits(t)); posAt[t] = [mdl.px, mdl.py]; }
  const st = state();
  if (tk < X.SCRIPT_ITERATIONS && st !== 1) stateBad.push(`frame ${frame} (iteration ${tk}): state ${st}, want 1`);
  if (tk === X.SCRIPT_ITERATIONS) endState = st;
  const mv = vars(), mm = modelVars(mdl);
  if (mv.px !== mm.px || mv.py !== mm.py) posBad.push(`frame ${frame} (iteration ${tk}): ${varsText(mv)}; model (${mm.px}, ${mm.py})`);
  else if (mv.menu !== mm.menu || mv.drag !== mm.drag) menuLag.push({ frame, text: `frame ${frame} (iteration ${tk}): ${varsText(mv)}; model menu ${mm.menu}, drag ${mm.drag}` });
  // test 3: pointer frames
  if (tk === tickPrev + 1 && ptrIter.has(tk)) {
    const [qx, qy] = posAt[tickPrev], key = `${qx},${qy}`;
    if (!ptrCache.has(key)) ptrCache.set(key, withPointer(scene, qx, qy));
    const d = renderDiff(ptrCache.get(key));
    ptrFrames++;
    if (d) ptrBad.push(`iteration ${tk} (frame ${frame}), pointer at (${qx}, ${qy}): ${fmtP(d)}`);
  }
  // test 2: the checkpoint reached in this frame
  while (ckSeen < ck) {
    ckSeen++;
    const want = X.CHECKPOINT_ITER[ckSeen - 1], disp = mdl.display(), e = X.SCRIPT.filter((s) => s.cp)[ckSeen - 1];
    C.check(`checkpoint ${ckSeen}: S_CHECK ran at the end of iteration ${want} (V_TICK ${tk}), the model's position there is (${e.pos})`, tk === want && mdl.px === e.pos[0] && mdl.py === e.pos[1]);
    const dr = ramDiff(disp), dp = renderDiff(disp), v = vars();
    cpResults.push({ n: ckSeen, dr, dp });
    C.check(`checkpoint ${ckSeen}: display RAM (98,304 pixels) = the model`, !dr, fmtR(dr));
    C.check(`checkpoint ${ckSeen}: the rendered frame (m.pixels) = the model`, !dp, fmtP(dp));
    C.check(`checkpoint ${ckSeen}: V_PX, V_PY, V_MENU, V_DRAG = the model's`, varsEq(v, modelVars(mdl)), `${varsText(v)}; model ${varsText(modelVars(mdl))}`);
    if ([1, 4, 6, 7, 8].includes(ckSeen)) {
      const ds = ramDiff(withPointer(scene, mdl.px, mdl.py));
      C.check(`checkpoint ${ckSeen}: the display is the scene of 17.4 with the pointer at (${mdl.px}, ${mdl.py}) (menus and outline gone)`, !ds, fmtR(ds));
    }
  }
  tickPrev = tk; vfPrev = vf;
}

console.log('--- test 4: interrupts');
C.check(`V_FRAMES rose by exactly 1 in every one of the ${frame} frames run, V_TICK never by more than 1`, vfBad.length === 0, vfBad.slice(0, 3).join('; '));
const missedText = missed.length ? missed.map((x) => `frame ${x.frame} (after iteration ${x.tick})`).join(', ') : 'none';
console.log(`REPORT main-loop frames missed over the script: ${missed.length} of ${frame} frames (${X.SCRIPT_ITERATIONS} iterations): ${missedText}`);
C.check('the script ran to its end: V_TICK = 426 and 8 checkpoints seen (V_CHECKS 8)', tickOf() === X.SCRIPT_ITERATIONS && m.ram[S.V_CHECKS] === 8 && ckSeen === 8, `V_TICK ${tickOf()}, V_CHECKS ${m.ram[S.V_CHECKS]}, ${frame} frames`);
C.check('V_PX / V_PY equal the model\'s at the end of every frame of the script (the move comes before any drawing in an iteration)', posBad.length === 0, posBad.slice(0, 2).join('; '));
{
  // V_MENU / V_DRAG are set at the END of D_MENU_OPEN / the press (17.4), so they may lag the model in a frame whose iteration overran into the next one
  const lagBad = menuLag.filter((x) => !missed.some((q) => q.frame === x.frame + 1));
  C.check(`V_MENU / V_DRAG equal the model's at the end of every frame of the script, except frames whose iteration overran into the next (${menuLag.length - lagBad.length} such frames)`, lagBad.length === 0, lagBad.slice(0, 2).map((x) => x.text).join('; '));
}

console.log('--- test 3: pointer frames');
C.check(`pointer frames: ${ptrFrames} rendered frames in entries 2, 11, 17 and 19 (second iteration on) = the scene with the pointer at the previous iteration's position`, ptrBad.length === 0 && ptrFrames >= 100, ptrBad.length ? `${ptrBad.length} bad, first: ${ptrBad[0]}` : `${ptrFrames} frames`);

console.log('--- tests 5, 6: RAM and the end of the script');
{
  const bad = checkPoison(m, tok);
  C.check('RAM $5800-$5FFF, $7800-$7FFF, $C500-$DFFF, $F000-$FAFF (poisoned after boot) unchanged after the script', !bad, bad ? `${hex(bad.addr)} = ${hex(bad.got, 2)}, was ${hex(bad.want, 2)} (${bad.n} bytes changed)` : '');
  const sset = m.ram.slice(S.S_SET, S.S_SET + 1280), j = sset.findIndex((v, i) => v !== setBefore[i]);
  C.check('S_SET unchanged after the script', j < 0, j < 0 ? '' : `byte ${j}`);
  C.check('every frame before iteration 426 had record state 1', stateBad.length === 0, stateBad.slice(0, 2).join('; '));
  C.check('state 2 (script ended) after iteration 426', endState === 2 && state() === 2, `state ${endState}`);
}

// ---------------------------------------------------------------------------------------------------------------------------
// Test 7: live input
console.log('--- test 7: live input');
const JOY = { u: 0, d: 1, l: 2, r: 3, f: 7 };
const KEY = { q: [2, 0], a: [1, 0], o: [5, 1], p: [5, 0], ' ': [7, 0] };                // [matrix row, bit]
const KBITS = { q: 1, a: 2, o: 4, p: 8, ' ': 16 }, JBITS = { u: 1, d: 2, l: 4, r: 8, f: 16 };
const liveFail = [];
let liveFrames = 0, liveMissed = 0;
function setInputs(joy, keys) {
  m.joystick[0] = 0xFF; for (const ch of joy) m.joystick[0] &= ~(1 << JOY[ch]);
  m.keyMatrix.fill(0x1F, 0, 8); for (const ch of keys) m.keyMatrix[KEY[ch][0]] &= ~(1 << KEY[ch][1]);
}
function modelBits(joy, keys) {
  let jb = 0; for (const ch of joy) jb |= JBITS[ch];
  if ((jb & 15) === 15) jb = 0;                                                    // all four direction lines active: no input, fire included
  let kb = 0; for (const ch of keys) kb |= KBITS[ch];
  return jb | kb;
}
/** n frames with the input held; the model takes one iteration per rise of V_TICK.  Returns the ticks taken. */
function drive(joy, keys, n) {
  let ticks = 0;
  setInputs(joy, keys);
  for (let k = 0; k < n; k++) {
    M.runFrame(m); liveFrames++;
    const tk = tickOf(), vf = framesOf();
    if (((vf - vfPrev) & 0xFFFF) !== 1) liveFail.push(`live frame ${liveFrames}: V_FRAMES rose by ${(vf - vfPrev) & 0xFFFF}`);
    if (tk === tickPrev) liveMissed++;
    mdl.isr();
    for (let t = tickPrev + 1; t <= tk; t++) { mdl.iterate(modelBits(joy, keys)); ticks++; }
    tickPrev = tk; vfPrev = vf;
  }
  setInputs('', '');
  return ticks;
}
const driveUntil = (joy, keys, pred, max = 200) => { let n = 0; while (!pred() && n < max) { drive(joy, keys, 1); n++; } return n; };
const quiet = (n = 3) => drive('', '', n);
const here = () => `cartridge (${varsText(vars())}), model (${mdl.px}, ${mdl.py}) menu ${mdl.menu} drag ${mdl.drag}`;
const same = () => varsEq(vars(), modelVars(mdl));
function segment(name, joy, keys, n, hand) {
  quiet(2);                                                                        // a frame without a direction resets the hold counter
  const t = drive(joy, keys, n);
  const ok = same() && t === n && (!hand || (mdl.px === hand[0] && mdl.py === hand[1]));
  C.check(`live input: ${name} for ${n} frames: position follows 17.5`, ok, `${here()}${hand ? `, hand-worked (${hand})` : ''}, ${t} iterations`);
}
// hand-worked from (391, 131): s = 1 for six iterations, 2 for four: 14 rows, 28 columns
segment('joystick right', 'r', '', 10, [419, 131]);
segment('key Q (up)', '', 'q', 10, [419, 117]);
segment('key A (down)', '', 'a', 10, [419, 131]);
segment('key O (left)', '', 'o', 10, [391, 131]);
segment('key P (right)', '', 'p', 10, [419, 131]);
segment('joystick up + left', 'ul', '', 6, [419 - 12 * 1, 131 - 6 * 1]);              // six iterations at s = 1: (-12, -6)
{
  const before = { ...modelVars(mdl) }, t = drive('udlr', '', 10);
  C.check('live input: all four joystick directions at once for 10 frames moves nothing', same() && mdl.px === before.px && mdl.py === before.py && t === 10, here());
}
// steer to the "Edit" title by keys (the model's position decides)
driveUntil('', 'q', () => mdl.py <= 9);
driveUntil('', 'o', () => mdl.px <= 150);
quiet(3);
C.check('live input: keys steered the pointer onto the "Edit" title (py <= 9, px in 120..175)', same() && mdl.py <= 9 && mdl.px >= 120 && mdl.px <= 175, here());
{
  const t = drive('udlrf', '', 5);
  C.check('live input: all four joystick directions + fire over a title: nothing happens (fire included in "no input"): no menu opens', same() && mdl.menu === X.NONE && vars().menu === 0xFF && t === 5, here());
  quiet(3);
  const d = ramDiff(withPointer(scene, mdl.px, mdl.py));
  C.check('live input: ... and the display is still the scene with the pointer', !d, fmtR(d));
}
{
  const t = drive('', ' ', 6);                                                     // Space: the menu opens on the press
  const dm = ramDiff(mdl.display());
  C.check('live input: Space held over "Edit": the menu opens (V_MENU 2) and the display is the model\'s', same() && vars().menu === 2 && !dm, `${here()}; ${fmtR(dm)}; ${t} iterations in 6 frames`);
  quiet(3);
  const ds = ramDiff(withPointer(scene, mdl.px, mdl.py)), dd = renderDiff(withPointer(scene, mdl.px, mdl.py));
  C.check('live input: Space released: the menu closes, the display returns to the scene exactly (with the pointer); display RAM and rendered frame',
    same() && vars().menu === 0xFF && !ds && !dd, `${here()}; RAM ${fmtR(ds)}; frame ${fmtP(dd)}`);
}
// steer to window B's title bar (x 224..479, y 64..74) and drag
driveUntil('d', '', () => mdl.py >= 64);
driveUntil('r', '', () => mdl.px >= 232);
quiet(3);
C.check('live input: the pointer is on window B\'s title bar (y 64..74, x 224..479)', same() && mdl.py >= 64 && mdl.py <= 74 && mdl.px >= 224 && mdl.px <= 479, here());
{
  drive('', ' ', 4);
  C.check('live input: Space pressed on B\'s title bar: V_DRAG = 2, no menu', same() && vars().drag === 2 && vars().menu === 0xFF, here());
  const d0 = ramDiff(mdl.display());
  C.check('live input: the outline of B is drawn (display = the model, pointer included)', !d0, fmtR(d0));
  const q = { x: mdl.px, y: mdl.py };
  drive('dl', ' ', 14);
  C.check('live input: Space + joystick down-left for 14 frames: V_DRAG 2 and the outline offset follows the pointer', same() && vars().drag === 2 && mdl.px < q.x && mdl.py > q.y, here());
  drive('', ' ', 4);
  const d1 = ramDiff(mdl.display()), r1 = renderDiff(mdl.display());
  C.check('live input: held still: the display = the model (the outline at (pointer - press point), clipped at the bottom); display RAM and rendered frame', same() && !d1 && !r1, `RAM ${fmtR(d1)}; frame ${fmtP(r1)}`);
  const differs = ramDiff(withPointer(scene, mdl.px, mdl.py));
  C.check('live input: (the outline is on the screen: the display is not the scene)', !!differs);
  drive('', '', 1);                                                                // release with no movement (A6)
  quiet(3);
  const ds = ramDiff(withPointer(scene, mdl.px, mdl.py)), dd = renderDiff(withPointer(scene, mdl.px, mdl.py));
  C.check('live input: Space released: V_DRAG 0, the outline is gone, the display returns to the scene exactly (with the pointer); display RAM and rendered frame',
    same() && vars().drag === 0 && !ds && !dd, `${here()}; RAM ${fmtR(ds)}; frame ${fmtP(dd)}`);
}
// release while moving (17.5 "release": the outline / menu is removed where it is drawn, i.e. from the position BEFORE this iteration's move)
{
  const toScene = () => ({ ram: ramDiff(withPointer(scene, mdl.px, mdl.py)), frm: renderDiff(withPointer(scene, mdl.px, mdl.py)), model: mdl.scr.px.every((v, i) => v === scene[i]) });
  // drag B, then on ONE iteration release fire and hold a direction
  driveUntil('', 'q', () => mdl.py <= 74);
  driveUntil('r', '', () => mdl.px >= 232 || mdl.px < 224);
  if (mdl.px < 224) driveUntil('r', '', () => mdl.px >= 232);
  quiet(3);
  const onBar = mdl.py >= 64 && mdl.py <= 74 && mdl.px >= 224 && mdl.px <= 479;
  drive('', ' ', 4);
  drive('dl', ' ', 6);
  drive('', ' ', 3);
  const dragging = vars().drag === 2, p0 = [mdl.px, mdl.py], dOut = ramDiff(mdl.display());
  const t = drive('dl', '', 1);                                                    // fire released, down-left held: the pointer moves on the release iteration
  const moved = mdl.px !== p0[0] || mdl.py !== p0[1];
  quiet(3);
  const t1 = toScene();
  C.check('live input: B dragged, then fire released while a direction is held (the pointer moves on the release iteration): V_DRAG 0, the outline is gone, display RAM and rendered frame = scene + pointer exactly',
    onBar && dragging && !dOut && moved && t === 1 && same() && vars().drag === 0 && !t1.ram && !t1.frm && t1.model,
    `${here()}; on the bar ${onBar}, dragging ${dragging}, moved ${moved}, ${t} iteration; RAM ${fmtR(t1.ram)}; frame ${fmtP(t1.frm)}; model back to the scene ${t1.model}`);
  // a menu: release fire while moving off the title
  driveUntil('', 'q', () => mdl.py <= 9);
  driveUntil('', 'o', () => mdl.px <= 150 && mdl.px >= 120 || mdl.px < 120);
  if (mdl.px < 120) driveUntil('', 'p', () => mdl.px >= 120);
  quiet(2);
  for (let k = 0; k < 12 && mdl.py < 9; k++) { drive('d', '', 1); quiet(1); }          // single steps of one row (hold reset in between): py = 9, the last row of the title
  quiet(2);
  const onTitle = mdl.py === 9 && mdl.px >= 120 && mdl.px <= 175;
  drive('', ' ', 4);
  const opened = vars().menu === 2, dm = ramDiff(mdl.display());
  const p1 = [mdl.px, mdl.py], t2 = drive('d', '', 1);                              // fire released, down held: the hot spot leaves the title
  const moved2 = mdl.px === p1[0] && mdl.py === p1[1] + 1 && mdl.py >= 10;
  quiet(3);
  const t3 = toScene();
  C.check('live input: a menu open, then fire released while moving off the title: V_MENU $FF, the menu is closed and the title restored: display RAM and rendered frame = scene + pointer exactly',
    onTitle && opened && !dm && moved2 && t2 === 1 && same() && vars().menu === 0xFF && !t3.ram && !t3.frm && t3.model,
    `${here()}; on the title ${onTitle}, opened ${opened}, moved ${moved2}, ${t2} iteration; RAM ${fmtR(t3.ram)}; frame ${fmtP(t3.frm)}; model back to the scene ${t3.model}`);
}
C.check(`live input: V_FRAMES rose by exactly 1 in each of the ${liveFrames} live frames; main-loop frames missed in them: ${liveMissed}`, liveFail.length === 0, liveFail.slice(0, 3).join('; '));
{
  const bad = checkPoison(m, tok);
  C.check('RAM $5800-$5FFF, $7800-$7FFF, $C500-$DFFF, $F000-$FAFF still unchanged after the live input too', !bad, bad ? `${hex(bad.addr)} = ${hex(bad.got, 2)}, was ${hex(bad.want, 2)}` : '');
}

// ---------------------------------------------------------------------------------------------------------------------------
// Test 8 and 17.7: direct calls on a second, fresh boot
console.log('--- test 8: direct calls (a fresh boot, interrupts off)');
const ctx2 = start({ check: (n, ok, d) => C.check(n, ok, d) }, NEEDED, 'spike6');
if (!ctx2) { C.done(); process.exit(); }
{
  const m2 = ctx2.m, S2 = ctx2.S;
  cur = m2;
  const tok2 = poison(m2, rng, { stack: false, regions: POISON });
  const dcall = (name, regs = {}, ga = null) => { if (ga) setGA(m2, S2, ...ga); return call(m2, S2, name, regs, { rng }); };
  const settings = () => { const b = opClipBytes(m2, S2), cl = readClip(m2, S2); return b[0] === 0 && m2.ram[S2.GLH] === 8 && cl.join() === '0,512,0,192'; };
  const d = new X.Spike6Model(arrow);                                              // the booted state: the scene, pointer on, nothing drawn
  const report = {};
  // D_SCENE on a clear screen
  fillDisplay(m2, 0);
  d.scr.cls(); d.drawScene();
  let r = dcall('D_SCENE');
  report.scene = r.t;
  let df = ramDiff(d.scr);
  C.check(`D_SCENE on a clear screen: display RAM (98,304 pixels) = the model's scene; GOP SET, GLH 8, clip the whole screen afterwards (${fmt(r.t)} T)`, !df && settings(), `${fmtR(df)}${settings() ? '' : '; settings changed'}`);
  const scene2 = d.scr.px.slice();
  // menus
  report.open = []; report.close = [];
  for (let i = 0; i < 5; i++) {
    r = dcall('D_MENU_OPEN', { a: i }); report.open.push(r.t); d.menuOpen(i);
    df = ramDiff(d.scr);
    C.check(`D_MENU_OPEN ${i} ("${X.TITLES[i]}"): display = the model (title inverted, list drawn); V_MENU = ${i}; settings kept (${fmt(r.t)} T)`, !df && m2.ram[S2.V_MENU] === i && settings(), `${fmtR(df)}; V_MENU ${m2.ram[S2.V_MENU]}`);
    r = dcall('D_MENU_CLOSE'); report.close.push(r.t); d.menuClose();
    df = ramDiff(d.scr);
    C.check(`D_MENU_CLOSE after ${i}: the scene is restored exactly; V_MENU = $FF; settings kept (${fmt(r.t)} T)`, !df && !ramDiff(asModel(scene2)) && m2.ram[S2.V_MENU] === 0xFF && settings(), `${fmtR(df)}; V_MENU ${m2.ram[S2.V_MENU]}`);
  }
  r = dcall('D_MENU_CLOSE'); df = ramDiff(asModel(scene2));
  C.check(`D_MENU_CLOSE with no menu open does nothing (display unchanged, V_MENU $FF) (${fmt(r.t)} T)`, !df && m2.ram[S2.V_MENU] === 0xFF, fmtR(df));
  report.switch = [];
  for (let i = 0; i < 5; i++) {                                                    // the switch: close i + open j
    const j = (i + 1) % 5;
    dcall('D_MENU_OPEN', { a: i }); d.menuOpen(i);
    const t1 = dcall('D_MENU_CLOSE').t, t2 = dcall('D_MENU_OPEN', { a: j }).t; d.menuClose(); d.menuOpen(j);
    report.switch.push([i, j, t1 + t2]);
    df = ramDiff(d.scr);
    C.check(`menu switch ${i} -> ${j} (close + open): display = the model, V_MENU = ${j}`, !df && m2.ram[S2.V_MENU] === j, fmtR(df));
    dcall('D_MENU_CLOSE'); d.menuClose();
  }
  df = ramDiff(asModel(scene2));
  C.check('after all the menu calls the display is the scene again', !df, fmtR(df));
  // outlines: B at (0, 0) and (-72, 36), twice each
  const [bx, by, bw, bh] = X.WIN[2].rect;
  for (const [dx, dy] of [[0, 0], [-72, 36]]) {
    for (let k = 1; k <= 2; k++) {
      r = dcall('D_OUTLINE', {}, [bx + dx, by + dy, bw, bh]); d.outlineWin(2, dx, dy);
      df = ramDiff(d.scr);
      if (k === 1) report[`outline${dx}`] = r.t;
      C.check(`D_OUTLINE of B at offset (${dx}, ${dy}), call ${k}: display = the model${k === 2 ? ' (the screen restored)' : ''}; settings kept (${fmt(r.t)} T)`, !df && settings() && (k === 1 || !ramDiff(asModel(scene2))), fmtR(df));
    }
  }
  // with the pointer drawn by P_ISR: a menu over it and an outline around it
  d.pm.move(200, 20); dcall('P_MOVE', { hl: 200, de: 20 }); d.isr(); dcall('P_ISR');
  df = ramDiff(d.display());
  C.check('pointer drawn by P_ISR at (200, 20): display = scene + pointer', !df, fmtR(df));
  dcall('D_MENU_OPEN', { a: 3 }); d.menuOpen(3);
  df = ramDiff(d.display());
  C.check('D_MENU_OPEN 3 over the drawn pointer: the pointer is erased at once (shield); the display = the model', !df, fmtR(df));
  d.isr(); dcall('P_ISR'); df = ramDiff(d.display());
  C.check('... and the next P_ISR draws the pointer over the menu: display = the model', !df, fmtR(df));
  dcall('D_MENU_CLOSE'); d.menuClose(); d.isr(); dcall('P_ISR'); df = ramDiff(d.display());
  C.check('D_MENU_CLOSE over the pointer, then P_ISR: the scene with the pointer again', !df && !ramDiff(withPointer(scene2, 200, 20)), fmtR(df));
  d.pm.move(260, 66); dcall('P_MOVE', { hl: 260, de: 66 }); d.isr(); dcall('P_ISR');
  dcall('D_OUTLINE', {}, [bx - 72, by + 36, bw, bh]); d.outlineWin(2, -72, 36);
  df = ramDiff(d.display());
  C.check('D_OUTLINE of B at (-72, 36) with the pointer on B\'s title bar: the display = the model', !df, fmtR(df));
  dcall('D_OUTLINE', {}, [bx - 72, by + 36, bw, bh]); d.outlineWin(2, -72, 36); d.isr(); dcall('P_ISR');
  df = ramDiff(d.display());
  C.check('... the second call and P_ISR restore the scene with the pointer', !df && !ramDiff(withPointer(scene2, 260, 66)), fmtR(df));
  const bad2 = checkPoison(m2, tok2);
  C.check('direct calls: RAM $5800-$5FFF, $7800-$7FFF, $C500-$DFFF, $F000-$FAFF unchanged', !bad2, bad2 ? `${hex(bad2.addr)} = ${hex(bad2.got, 2)}, was ${hex(bad2.want, 2)}` : '');

  // ---- 17.7 reports (clear screen, direct calls, interrupts off, no pointer drawn) --------------------------------------------
  const rep = (title, s) => console.log(`REPORT ${title}: ${s}`);
  fillDisplay(m2, 0);
  const tmain = new X.Spike6Model(arrow, { boot: false });
  const dd2 = (name, regs, ga) => dcall(name, regs, ga).t;
  rep('D_SCENE (one call after a clear screen)', `${fmt(dd2('D_SCENE'))} T`);
  rep('D_MENU_OPEN i = 0..4', report.open.map((t, i) => `${i}: ${fmt(t)}`).join(', ') + ' T');
  rep('D_MENU_CLOSE after i = 0..4', report.close.map((t, i) => `${i}: ${fmt(t)}`).join(', ') + ' T');
  rep('menu switch (close + open)', report.switch.map(([i, j, t]) => `${i}->${j}: ${fmt(t)}`).join(', ') + ' T');
  const eraseDraw = (a, b) => { dcall('D_OUTLINE', {}, [bx + a[0], by + a[1], bw, bh]); const t1 = dcall('D_OUTLINE', {}, [bx + a[0], by + a[1], bw, bh]).t, t2 = dcall('D_OUTLINE', {}, [bx + b[0], by + b[1], bw, bh]).t; dcall('D_OUTLINE', {}, [bx + b[0], by + b[1], bw, bh]); return t1 + t2; };
  rep('drag step (erase B\'s outline at one offset + draw at another)', `(0,0) -> (12,6): ${fmt(eraseDraw([0, 0], [12, 6]))} T; (0,0) -> (-72,36) (clipped at the bottom): ${fmt(eraseDraw([0, 0], [-72, 36]))} T; one D_OUTLINE at (0,0): ${fmt(report.outline0)} T`);
  rep('main-loop frames missed (test 4)', `${missed.length} of ${frame} frames over the script's ${X.SCRIPT_ITERATIONS} iterations: ${missedText}`);
  rep('boot (frames from reset to the record)', `${bootFrames} frames`);
  // code size (17.2: DEMO_CODE .. DEMO_CODE_END)
  if (S2.DEMO_CODE !== undefined && S2.DEMO_CODE_END !== undefined) rep('code size (the demo\'s own code, chunk 5)', `DEMO_CODE_END - DEMO_CODE = ${S2.DEMO_CODE_END - S2.DEMO_CODE} bytes (${hex(S2.DEMO_CODE)} .. ${hex(S2.DEMO_CODE_END)})`);
  else {
  // fallback when the symbols are missing (B6)
  const lo = 0xA000, hi = 0xBFFF;
  const sym = Object.entries(S2).filter(([n, a]) => a >= lo && a <= hi && /^(S_|D_)/.test(n) && n !== 'S_ICON' && n !== 'S_SET').sort((a, b) => a[1] - b[1]);
  const ends = ['S_CODE_END', 'S_END', 'D_END', 'S_DATA'].filter((n) => S2[n] !== undefined);
  rep('code size (the demo\'s own code, chunk 5)', ends.length ? ends.map((n) => `${n} ${hex(S2[n])}`).join(', ') : `no end symbol in the symbol file; demo symbols in $A000-$BFFF span ${sym.length ? `${sym[0][0]} ${hex(sym[0][1])} .. ${sym[sym.length - 1][0]} ${hex(sym[sym.length - 1][1])}` : 'none'} (approximate: the last routine's length is not in it)`);
  // the model's own list for the missing figure: bytes of chunk 5 that differ from 0 / $FF in the image (the demo's data and code)
  let last = lo - 1; for (let a = lo; a <= hi; a++) if (ctx2.img[a] !== 0) last = a;
  rep('chunk 5 image: highest non-zero byte', `${hex(last)} (the demo's code and data, the gfx6 tables / PROP6 included if they are in chunk 5)`);
  }
}
C.done();
