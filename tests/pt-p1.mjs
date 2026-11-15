"use strict";
// pt-p1.mjs -- Paint slices P1, P2a and P2b-1 (program 4, docs/PAINT.md 2-9 and the "As built" sections 15, 16 and 17) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from the contract; src/apps/paint.asm was used only to find symbol names.  The reference is tests/pt-model.mjs (the window, the tool box, the pencil's G_LINE segments, the eraser's stamps, the commit,
// the undo box, Clear / New, the PBM bytes), the harness tests/pt-lib.mjs (on tests/shell-lib.mjs and tests/calc-lib.mjs).
//   node tests/pt-p1.mjs [--seed N] [--nrand N] [--only LIST] [--verbose]
//     --nrand N    random strokes in groups 3 and 4 (default 12 each)
//     --only LIST  groups: 1 launch, 2 tool box, 3 pencil, 4 eraser, 5 undo (and Clear), 6 files (Save, Open, the discard question, New), 7 quit, 8 exposure (dialogs over the canvas, a dragged window), 9 bounds and report rows,
//                  10 P2a: the pattern and brush palettes, the brush, the spray (PAINT 16), 11 the spray's frame rule (PAINT 16),
//                  12 P2b-1 (PAINT 17): the Options menu, the Line and the Rectangle tools (the XOR band, hollow and filled),
//                  13 P2b-2 (PAINT 18): the Rounded rectangle (8) and the Oval (9): the XOR band is the bounding rectangle, the release draws G_RRECT,
//                  14 P3a (PAINT 21): the Bucket (5): a click fills with G_FLOOD, committed as a stroke whose box is the region's; "Fill too complex" on an overflow; Undo; a moved window,
//                  15 P3b (PAINT 22.2): the Marquee (0): select, move, copy (CAPS SHIFT at the release), DELETE, ESC, the outline (an XOR frame in neither the picture nor its copy), the limits, the status messages, exposure
// Exit code 1 on any failure.  The last lines are "pt-p1: N passed, M failed" and "pt-p1: N of M groups pass".
// Where the machine disagrees with the contract the test says so and fails: the model is not changed to match the machine.
// PAINT 3 (corrected 2026-11-14): the copy's part 1 holds the ODD byte columns; its header is (OX >> 3, 40, OY, 144) of the last whole-picture save; the picture origin follows the Canvas view (x + 2, y + 2).
import * as Q from './pt-lib.mjs';
import * as T from './tk-lib.mjs';
import { openLook } from './look-model.mjs';

const { L, P, H, WM, W3, hex, rd16 } = Q;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NRAND = argNum('--nrand', 12);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { C, Sec, finish } = Q.makeGroups('pt-p1', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NRAND} random strokes a group`);
try { Q.needPaint(L.loadDesk5().S); } catch (e) { console.log(`FAIL: ${e.message}`); process.exit(1); }
const has = (g) => ONLY.includes(g);
const codes = WM.codesOf;
const FRAME_T = 58688;
const rows = [];
const row = (name, measured, bound, note = '', contract = null) => {
  if (contract !== null) note += `${note ? '; ' : ''}PAINT 12 bound <= ${contract.toLocaleString('en')}: ${measured <= contract ? 'met' : 'MISSED by ' + (measured - contract).toLocaleString('en')}`;
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  rows.push({ name, measured, bound, status });
  const f = (n) => (typeof n === 'number' ? n.toLocaleString('en') : String(n));
  C.check(`${name}: measured ${f(measured)}, bound ${bound === null ? 'report' : '<= ' + f(bound)}${note ? ' (' + note + ')' : ''}`, status !== 'MISSED');
};
const envs = [];
const newEnv = (o = {}) => { const e = Q.bootPaint(o); envs.push(e); return e; };

// After an action: the pointer parked, the model checked (screen, state, copy), then the copy against the display's picture read from the machine.
function settleCheck(env, sec, ctx, o = {}) {
  Q.park(env, 3);
  const ok = Q.check(env, sec, ctx, o);
  if (!o.noCopy && !o.copyOf && !o.dialog) Q.copyIsDisplay(env, sec, ctx);
  return ok;
}
/**
 * After a Marquee action: the pointer parked, the machine against the model's DISPLAY (the picture with the selection's outline, or the held stroke's band, XORed on: `displayModel`), every state variable (including PN_SELON
 * and the box), the copy against the model's picture WITHOUT the outline (PN_PIC never holds it), and the display's picture rectangle against the copy plus the outline.
 */
function settleMq(env, sec, ctx, o = {}) {
  Q.park(env, 3);
  const dm = env.st.displayModel();
  const ok = Q.check(env, sec, ctx, { st: dm, copyOf: env.st, ...o });
  if (!o.noCopy && !o.dialog) {
    const dp = Q.displayPlanar(env), cp = dm.copyBytes(Q.SWAP), i = Q.firstDiffBytes(dp, cp);
    sec.ok(i < 0, () => `${ctx}: the display's picture differs from the model's picture plus outline at ${Q.describeIdx(i)} (display ${dp[i]}, model ${cp[i]})`);
  }
  return ok;
}
const noise = (seed, density = 0.5) => { const r = L.makeRng(seed); const t = new Uint8Array(320 * 144); for (let i = 0; i < t.length; i++) t[i] = r.next() < density ? 1 : 0; return (x, y) => t[y * 320 + x]; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rndWalk = (n, x0, y0, step, lo = [60, 8], hi = [500, 188]) => {
  const pts = [[x0, y0]];
  for (let i = 1; i < n; i++) { const [x, y] = pts[i - 1]; pts.push([Math.max(lo[0], Math.min(hi[0], x + rng.int(-step, step))), Math.max(lo[1], Math.min(hi[1], y + rng.int(-step, step)))]); }
  return pts;
};
/** A stroke checked after its release: the model (via Q.stroke), the display, the copy. */
function doStroke(env, sec, ctx, pts, o = {}) {
  const r = Q.stroke(env, pts, o);
  settleCheck(env, sec, ctx, o.check || {});
  return r;
}
/** Does the machine's undo area ($5800) hold what the model's stored box says? */
function undoAreaOk(env, sec, ctx) {
  const st = env.st, want = st.undoBytes(Q.SWAP);
  if (!want) return true;
  const got = Array.from(env.m.ram.subarray(Q.UNDO_AREA, Q.UNDO_AREA + want.length));
  const i = want.findIndex((v, k) => got[k] !== v);
  return sec.ok(i < 0, () => `${ctx}: the undo area at $5800 differs from the model's saved box at byte ${i} of ${want.length} (machine ${got[i]}, model ${want[i]}); box ${JSON.stringify({ ...st.undoBox, px: undefined })}`);
}
/** File > ... by the pointer (menu index, item index). */
const fileMenu = (env, ii, o) => Q.menuPick(env, 0, ii, o);
const editMenu = (env, ii, o) => Q.menuPick(env, 1, ii, o);
const waitDialog = (env, kind, max = 60) => Q.until(env, () => { const d = Q.dialogKind(env); return !!d && d.kind === kind; }, max);

// ===========================================================================================================================================
// 1. Launch
function g1() {
  for (const how of ['menu', 'icon']) {
    const env = newEnv({ how }), { m, S } = env;
    const sec = new Sec(`1 launch (${how === 'menu' ? "the shell's Leap menu, item 6" : 'a double click on the fourth icon'}): the CWindow (48, 16, 416, 176) id 255 "Paint: Untitled", the tool box, the canvas, the status "Pencil" (PAINT 2, 15)`);
    const w = Q.paintWin(env);
    sec.ok(!!w, 'the Paint window is open');
    if (w) {
      sec.ok([w.x, w.y, w.w, w.h, w.id, w.flags].join() === '48,16,416,176,255,0' && w.cls === S.CL_CWindow, () => `window ${[w.x, w.y, w.w, w.h, w.id, w.flags]} class ${hex(w.cls)}`);
      sec.ok(w.title === 'Paint: Untitled', () => `title "${w.title}"`);
      sec.ok(L.openWindows(m, S).length === 1, () => `${L.openWindows(m, S).length} windows`);
      const k = Q.paintKids(env);
      sec.ok(k.length === 5, () => `${k.length} children, want 5 (tool box, patterns, brushes, canvas, status)`);
      if (k.length === 5) {
        const want = [[55, 28, 66, 82, 1], [55, 112, 66, 50, 2], [55, 164, 66, 18, 3], [126, 30, 324, 148, 4], [127, 180, 324, 9, 5]];
        k.forEach((v, i) => sec.ok([v.x, v.y, v.w, v.h, v.id].join() === want[i].join(), () => `child ${i}: ${[v.x, v.y, v.w, v.h, v.id]}, want ${want[i]}`));
        sec.ok(k[4].cls === S.CL_Label && Q.strAt(m, rd16(m, k[4].a + S.Label_text)) === 'Pencil', () => `status view class ${hex(k[4].cls)} text "${Q.strAt(m, rd16(m, k[4].a + S.Label_text))}"`);
        sec.ok(k[0].cls === k[1].cls && k[1].cls === k[2].cls, () => `the tool box, the patterns and the brushes are all a Palette: classes ${hex(k[0].cls)} ${hex(k[1].cls)} ${hex(k[2].cls)}`);
        sec.ok(k[0].cls !== k[3].cls && k[0].cls !== S.CL_Label && k[3].cls !== S.CL_Label && k[0].cls !== S.CL_CWindow && k[3].cls !== S.CL_CWindow, () => `the Palette (${hex(k[0].cls)}) and the Canvas (${hex(k[3].cls)}) are two classes of their own`);
        sec.ok(rd16(m, S.PN_LBL) === k[4].a, () => `PN_LBL ${hex(rd16(m, S.PN_LBL))}, the label view is ${hex(k[4].a)}`);
      }
      sec.ok(rd16(m, S.PN_WIN) === w.a, () => `PN_WIN ${hex(rd16(m, S.PN_WIN))}, the window is ${hex(w.a)}`);
    }
    sec.ok(m.ram[S.PN_PAT] === 0 && m.ram[S.PN_BRUSH] === 1 && rd16(m, S.PN_RND) === P.RND0, () => `at launch PN_PAT ${m.ram[S.PN_PAT]} (want 0), PN_BRUSH ${m.ram[S.PN_BRUSH]} (want 1), PN_RND ${hex(rd16(m, S.PN_RND))} (want $ACE1)`);
    { const d6 = m.dock[6], t0 = S.PATTAB - 0xC000, bad = P.PATS.findIndex((pt, k) => pt.some((v, j) => d6[t0 + 8 * k + j] !== v));
      sec.ok(bad < 0, () => `PATTAB (DOCK 6) differs from the model's PATS at pattern ${bad}`); }
    const pa = Q.picAddr(env), cp = Q.copyOf(env);
    sec.ok(pa >= 0xC400 && pa + 5764 <= 0xE000, () => `PN_PIC ${hex(pa)}: the copy (5,764 bytes) is not in the app arena $C400-$DFFF`);
    sec.ok(eq(Array.from(cp.subarray(0, 4)), [16, 40, 32, 144]), () => `the copy's header ${Array.from(cp.subarray(0, 4))}, want (c0, nc, y0, nr) = 16, 40, 32, 144`);
    sec.ok(cp.subarray(4).every((v) => v === 0), 'the picture starts white (every byte of the copy is 0)');
    Q.check(env, sec, 'as launched', {});
    Q.copyIsDisplay(env, sec, 'as launched');
    sec.ok(m.ram[S.PN_UNDO] === 0 && menuWordEdit(env) === 0b01, () => `Undo disabled: PN_UNDO ${m.ram[S.PN_UNDO]}, the Edit menu's word ${menuWordEdit(env).toString(2)} (Undo bit 1 clear, Clear bit 0 set)`);
    const wd = watchDisplay(m); env.frames_(10); const wr = wd.stop();
    sec.ok(wr.size === 0, () => `10 idle frames wrote ${wr.size} display bytes`);
    sec.end(`stack so far ${env.stack.depth()} bytes`);
  }
}
const menuWordEdit = (env) => Q.menuWord(env, 1) & 3;
/** Display bytes written (as a Set of y * 64 + byte column) while armed. */
function watchDisplay(m) {
  const set = new Set(), w0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (a >= 0x4000 && a < 0x8000) { const file = (a >> 13) & 1, off = a & 0x1FFF; if (off < 0x1800) { const y = ((off >> 8) & 7) | (((off >> 5) & 7) << 3) | (((off >> 11) & 3) << 6); set.add(y * 64 + (off & 31) * 2 + file); } }
    w0(addr, v);
  };
  return { set, stop() { m.bus.write = w0; return set; } };
}

// ===========================================================================================================================================
// 2. The tool box
function g2() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('2 tool box: each of the 10 cells (corners and middle) chooses its tool (PN_TOOL, the inverted cell, the status name); clicks off the cells change nothing (PAINT 15)');
  for (let t = 0; t < 10; t++) {
    const c = P.cellOf(t);
    const [px, py] = [[c.x + 16, c.y + 8], [c.x, c.y], [c.x + 31, c.y + 15], [c.x + 3, c.y + 12]][t % 4];
    L.click(env, px, py, 3, 6);
    st.chooseTool(t);
    settleCheck(env, sec, `tool ${t} (${P.TOOLNAMES[t]}) clicked at (${px}, ${py})`);
  }
  for (const t of [3, 1, 9, 0, 5, 5, 2, 8, 6, 7, 4, 1]) { Q.chooseTool(env, t); st.chooseTool(t); settleCheck(env, sec, `tool ${t} again`); }
  // clicks that must change nothing: the frame lines of the box, the gap between the box and the canvas, empty window content, the window's right part
  const offs = [[55, 60], [70, 28], [122, 60], [60, 111], [122, 170], [123, 100], [300, 186]];
  Q.chooseTool(env, 4); st.chooseTool(4);
  for (const [x, y] of offs) { L.click(env, x, y, 3, 6); settleCheck(env, sec, `a click at (${x}, ${y}) (off the cells; tool 4 stays)`); }
  Q.chooseTool(env, 1); st.chooseTool(1);
  settleCheck(env, sec, 'Pencil again');
  sec.ok(m.ram[S.PN_DIRTY] === 0 && m.ram[S.PN_UNDO] === 0, () => `PN_DIRTY ${m.ram[S.PN_DIRTY]}, PN_UNDO ${m.ram[S.PN_UNDO]} after tool choices`);
  sec.end(`stack so far ${env.stack.depth()} bytes`);
}

// ===========================================================================================================================================
// 3. The pencil
function g3() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('3 pencil: G_LINE segments between successive pointer positions; a single click is one pixel; the copy is the state before the stroke until the release; clipping; presses off the picture; a Marquee drag selects without changing the picture (PAINT 15, 22.2)');
  // a single click
  doStroke(env, sec, 'a single click at (200, 80)', [[200, 80]]);
  sec.ok(st.px(72, 48) === 1 && st.pic.count() === 1, () => `the model's single click: pixel ${st.px(72, 48)}, count ${st.pic.count()}`);
  // lines of every direction, one pointer position a frame
  const lines = [
    ['horizontal, 1 pixel a frame', Array.from({ length: 25 }, (_, i) => [150 + i, 60])],
    ['vertical, 1 pixel a frame', Array.from({ length: 25 }, (_, i) => [180, 100 + i])],
    ['diagonal down-right', Array.from({ length: 20 }, (_, i) => [200 + 2 * i, 90 + 2 * i])],
    ['diagonal up-left (reverse)', Array.from({ length: 20 }, (_, i) => [260 - 2 * i, 140 - i])],
    ['shallow slope 3:1', Array.from({ length: 12 }, (_, i) => [300 + 3 * i, 50 + i])],
    ['steep slope 1:3', Array.from({ length: 12 }, (_, i) => [350 + i, 50 + 3 * i])],
    ['a fast stroke (30, 50, 80 pixels a frame)', [[140, 40], [170, 40], [220, 90], [300, 150], [380, 70], [440, 70]]],
    ['a zig-zag with right angles', [[200, 120], [240, 120], [240, 100], [280, 100], [280, 160], [200, 160]]],
  ];
  for (const [name, pts] of lines) doStroke(env, sec, name, pts);
  for (let i = 0; i < NRAND; i++) doStroke(env, sec, `random walk ${i + 1}`, rndWalk(rng.int(4, 18), rng.int(130, 440), rng.int(40, 170), rng.int(1, 40), [129, 33], [446, 174]));
  // mid-stroke: the copy holds the state before the stroke, the display the new pixels; nothing committed yet
  {
    const before = st.clone();
    let k = 0;
    Q.stroke(env, [[220, 70], [226, 74], [236, 74], [236, 90], [250, 96], [262, 96]], {
      noRelease: true,
      mid: (i) => { k++; Q.check(env, sec, `mid-stroke after point ${i}`, { copyOf: before, extra: [] }); },
    });
    sec.ok(m.ram[S.PN_DIRTY] === (before.dirty ? 1 : 0), () => `mid-stroke PN_DIRTY ${m.ram[S.PN_DIRTY]}, the committed state ${before.dirty ? 1 : 0} (the commit is at the release)`);
    m.mouse.buttons = L.MOUSE_UP; env.frame(); st.release(); env.frames_(14);
    settleCheck(env, sec, 'the mid-stroke test stroke, released');
    sec.ok(k === 6, 'mid checks ran');
  }
  // clipping: strokes that leave the picture (the capture continues until the release; G_LINE is clipped to the picture)
  doStroke(env, sec, 'leaves right across the border to the desk and comes back', [[430, 100], [446, 104], [452, 108], [480, 112], [470, 126], [440, 130]]);
  doStroke(env, sec, 'leaves at the top (the canvas frame, the title bar, the menu bar)', [[300, 40], [300, 30], [300, 20], [300, 4], [340, 4], [340, 60]]);
  doStroke(env, sec, 'leaves at the left (the tool box, the desk) and at the bottom (the status line)', [[140, 100], [128, 100], [100, 110], [60, 120], [60, 175], [140, 185], [150, 150]]);
  doStroke(env, sec, 'runs along the picture\'s edge', [[128, 33], [447, 33], [447, 175], [128, 175], [128, 33]]);
  // presses that draw nothing
  const nodraw = [['the canvas border (126, 100)', [126, 100]], ['the canvas inner frame (127, 100)', [127, 100]], ['the canvas border below (300, 177)', [300, 177]], ['the tool box (80, 60)', [80, 60]], ['the desk (490, 100)', [490, 100]],
    ['empty window content (123, 150)', [123, 150]], ['the status line (200, 184)', [200, 184]]];
  for (const [what, [x, y]] of nodraw) {
    const was = st.clone();
    const r = Q.stroke(env, [[x, y], [200, 100], [250, 120], [300, 100]], { settle: 12 });
    sec.ok(!r.began, `${what}: the model says no stroke`);
    if (what.startsWith('the tool box')) { Q.chooseTool(env, 1); st.chooseTool(1); }
    settleCheck(env, sec, `a press on ${what}, dragged across the picture, draws nothing`);
    sec.ok(eq(Array.from(st.copyBytes()), Array.from(was.copyBytes())), `${what}: the model's picture is unchanged`);
  }
  // the Marquee (PAINT 22.2): a drag selects (the picture and its copy are not changed, nothing committed); choosing the Pencil again drops the selection (its outline erased)
  for (const t of [0]) {
    Q.chooseTool(env, t); st.chooseTool(t);
    const dirty0 = st.dirty;
    Q.stroke(env, [[300, 100], [320, 110], [340, 100]], { settle: 12 });
    sec.ok(!!st.sel && st.status === 'Marquee', () => `model: the drag selected (${JSON.stringify(st.sel)}), status "${st.status}"`);
    settleMq(env, sec, `tool ${t} (${P.TOOLNAMES[t]}): a drag in the picture selects and draws nothing into the picture (the outline is XOR on the display only)`);
    sec.ok(st.dirty === dirty0, 'dirty unchanged');
    Q.chooseTool(env, 1); st.chooseTool(1);
    settleCheck(env, sec, `Pencil chosen again: the selection is dropped, the status is "Pencil"`);
  }
  // the one strict check of PAINT 3's layout (the machine's order differs: report the exact mismatch)
  {
    const cp = Q.copyOf(env), w = st.copyBytes(true), i = Q.firstDiffBytes(cp, w);
    sec.ok(i < 0, () => `PAINT 3 (corrected): part 1 holds the ODD byte columns, part 2 the EVEN ones, header (OX >> 3, 40, OY, 144): first difference at ${Q.describeIdx(i)} (machine ${cp[i]}, contract ${w[i]})`);
  }
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}`);
}

// ===========================================================================================================================================
// 4. The eraser
function g4() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('4 eraser: 16 x 8 CLR stamps at (x - 8, y - 4) along the Bresenham walk of PAINT 15 (every 4th step and the end; one stamp for a single click) on a noisy picture');
  Q.install(env, noise(7, 0.5));
  Q.chooseTool(env, 3); st.chooseTool(3);
  settleCheck(env, sec, 'a noisy picture installed, the Eraser chosen');
  doStroke(env, sec, 'a single click at (200, 80)', [[200, 80]]);
  const strokes = [
    ['horizontal, 1 pixel a frame (20 moves)', Array.from({ length: 20 }, (_, i) => [140 + i, 60])],
    ['horizontal, 3 pixels a frame', Array.from({ length: 20 }, (_, i) => [140 + 3 * i, 100])],
    ['horizontal, 4 pixels a frame (every step a stamp)', Array.from({ length: 12 }, (_, i) => [140 + 4 * i, 120])],
    ['horizontal fast, 40 pixels a frame', [[140, 140], [180, 140], [220, 140], [260, 140], [300, 140]]],
    ['horizontal right to left', Array.from({ length: 16 }, (_, i) => [440 - 5 * i, 150])],
    ['vertical, 1 pixel a frame', Array.from({ length: 20 }, (_, i) => [330, 40 + i])],
    ['vertical fast, 30 pixels a frame (down then up)', [[360, 40], [360, 70], [360, 100], [360, 130], [360, 100]]],
    ['diagonal 45 degrees, 2 pixels a frame', Array.from({ length: 20 }, (_, i) => [380 + 2 * i, 40 + 2 * i])],
    ['diagonal up-left', Array.from({ length: 12 }, (_, i) => [440 - 3 * i, 170 - 3 * i])],
    ['x major, slope 1:3', Array.from({ length: 12 }, (_, i) => [140 + 9 * i, 45 + 3 * i])],
    ['y major, slope 1:3 (steep)', Array.from({ length: 12 }, (_, i) => [160 + 3 * i, 50 + 9 * i])],
    ['one long segment, 75 x 33', [[200, 40], [275, 73]]],
    ['a very short segment of 1 and 2 pixels', [[250, 100], [251, 100], [251, 102], [252, 102]]],
    ['stamps clipped at the picture\'s edge', [[130, 40], [135, 36], [128, 34], [135, 34], [445, 174], [440, 170]]],
    ['leaves the picture and returns', [[430, 100], [446, 104], [470, 112], [480, 130], [440, 130]]],
  ];
  for (const [name, pts] of strokes) doStroke(env, sec, name, pts);
  for (let i = 0; i < NRAND; i++) doStroke(env, sec, `random walk ${i + 1}`, rndWalk(rng.int(3, 14), rng.int(135, 440), rng.int(40, 170), rng.int(1, 45), [129, 33], [446, 174]));
  // stamps hold only paper: every pixel the eraser touched is CLR'd; the pencil does not do it
  Q.chooseTool(env, 1); st.chooseTool(1);
  doStroke(env, sec, 'the pencil after the eraser', [[300, 60], [340, 90]]);
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}`);
}

// ===========================================================================================================================================
// 5. Undo (and Clear)
function g5() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('5 undo: the box variables (PN_UB0 / UBN / UR0 / URN), the saved box at $5800, Undo restores exactly (display and copy), a second Undo redoes, a too-big box disables Undo ("Too big to undo"), Clear disables Undo (PAINT 6, 15)');
  const after = (ctx, o = {}) => { settleCheck(env, sec, ctx, o); if (st.undoOn) undoAreaOk(env, sec, ctx); };
  Q.install(env, noise(11, 0.4));
  settleCheck(env, sec, 'a noisy picture installed');
  sec.ok(Q.menuWord(env, 1) === 1, 'Undo disabled at the start');
  // a small stroke: the box, the area, Undo, redo, redo
  let r = doStroke(env, sec, 'a stroke (pencil)', [[200, 80], [230, 100], [250, 90]]);
  sec.ok(!!r.box, 'box');
  sec.ok(st.undoOn && Q.menuWord(env, 1) === 3, () => `after a stroke Undo is enabled: model ${st.undoOn}, Edit word ${Q.menuWord(env, 1).toString(2)}`);
  undoAreaOk(env, sec, 'a stroke');
  const pre = st.clone();
  editMenu(env, 0); st.undo();
  after('Undo');
  sec.ok(st.undoOn && Q.menuWord(env, 1) === 3, 'Undo stays enabled after an Undo (it redoes)');
  { const a = pre.copyBytes(Q.SWAP), b = Q.copyOf(env); sec.ok(!eq(Array.from(a), Array.from(b)), 'Undo changed the copy'); }
  editMenu(env, 0); st.undo();
  after('Undo again (redo)');
  sec.ok(eq(Array.from(st.copyBytes()), Array.from(pre.copyBytes())), 'model: undo twice is the identity');
  editMenu(env, 0); st.undo();
  after('Undo, a third time');
  editMenu(env, 0); st.undo();
  after('Undo, a fourth time');
  // eraser strokes and undo
  Q.chooseTool(env, 3); st.chooseTool(3);
  r = doStroke(env, sec, 'an eraser stroke', [[150, 60], [200, 66], [250, 60], [250, 100]]);
  undoAreaOk(env, sec, 'eraser stroke');
  editMenu(env, 0); st.undo(); after('Undo of the eraser stroke');
  // a new stroke replaces the one level
  Q.chooseTool(env, 1); st.chooseTool(1);
  doStroke(env, sec, 'a new stroke replaces the undo area', [[300, 50], [330, 60]]);
  undoAreaOk(env, sec, 'replaced');
  // the box: single click in the corners (clamped columns and rows), widened to even columns
  for (const [name, p] of [['top-left corner', [128, 32]], ['top-right corner', [447, 32]], ['bottom-left corner', [128, 175]], ['bottom-right corner', [447, 175]], ['column 1 / 2', [140, 100]], ['column 2 / 3', [150, 100]], ['an odd column 25', [330, 100]]]) {
    const rr = doStroke(env, sec, `a click, ${name}`, [p]);
    undoAreaOk(env, sec, name);
    editMenu(env, 0); st.undo(); after(`Undo of the click, ${name}`);
  }
  // the 2,048-byte boundary: a stroke whose box is 32 columns x 64 rows fits, 32 x 65 does not (PAINT 15; the pencil's box has no margin: PAINT 16)
  for (const [name, p0, p1, wantFit] of [['32 x 64 (2,048 bytes)', [152, 60], [384, 123], true], ['32 x 65 (2,080 bytes)', [152, 60], [384, 124], false]]) {
    const was = st.clone();
    const rr = Q.stroke(env, [p0, p1], {});
    const b = rr.box, fit = b.nc * b.nr <= 2048;
    sec.ok(fit === wantFit && b.nc === 32 && b.nr === (wantFit ? 64 : 65), () => `the model's box for ${name}: ${JSON.stringify(b)}`);
    settleCheck(env, sec, `the stroke with a box of ${name}`, wantFit ? {} : { noBox: true });
    if (wantFit) { undoAreaOk(env, sec, name); sec.ok(Q.menuWord(env, 1) === 3, `${name}: Undo enabled`); }
    else sec.ok(Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo' && m.ram[S.PN_UNDO] === 0, () => `${name}: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}", PN_UNDO ${m.ram[S.PN_UNDO]}`);
  }
  // a too-big stroke, then a small one: Undo is back; the status after a fitting stroke is not specified
  {
    const rr = Q.stroke(env, [[140, 45], [440, 45], [440, 170], [140, 170]], {});
    settleCheck(env, sec, 'a stroke round the picture (a very big box)', { noBox: true });
    sec.ok(!st.undoOn && Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo', () => `very big box: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}"`);
    const rr2 = Q.stroke(env, [[300, 100], [310, 105]], {});
    settleCheck(env, sec, 'a small stroke after a too-big one', { adoptStatus: true });
    undoAreaOk(env, sec, 'small after big');
    sec.ok(Q.menuWord(env, 1) === 3, 'Undo enabled again');
  }
  // random strokes with undo, redo and a check after each
  for (let i = 0; i < NRAND; i++) {
    const t = rng.pick([1, 3]); Q.chooseTool(env, t); st.chooseTool(t);
    doStroke(env, sec, `random stroke ${i + 1}`, rndWalk(rng.int(2, 8), rng.int(135, 440), rng.int(40, 170), rng.int(1, 60), [129, 33], [446, 174]), { check: { adoptStatus: true } });
    if (st.undoOn) { undoAreaOk(env, sec, `random ${i + 1}`); editMenu(env, 0); st.undo(); after(`random ${i + 1}: Undo`, { adoptStatus: true }); }
  }
  // Clear: asks (the picture has changed), Discard clears, Undo disabled, dirty 1
  Q.chooseTool(env, 1); st.chooseTool(1);
  doStroke(env, sec, 'a stroke before Clear', [[200, 100], [260, 120]], { check: { adoptStatus: true } });
  sec.ok(st.undoOn && st.dirty, 'model: undo on, dirty');
  editMenu(env, 1);                                           // Edit > Clear
  sec.ok(waitDialog(env, 'ask'), 'Clear on a changed picture asks "Discard the document?"');
  Q.check(env, sec, 'Clear: the question', { dialog: 'ask', noCopy: true });
  Q.askAnswer(env, 'discard'); st.clear();
  settleCheck(env, sec, 'Clear, Discard', { adoptStatus: true });
  sec.ok(Q.menuWord(env, 1) === 1 && m.ram[S.PN_UNDO] === 0 && m.ram[S.PN_DIRTY] === 1, () => `Clear: Edit word ${Q.menuWord(env, 1).toString(2)}, PN_UNDO ${m.ram[S.PN_UNDO]}, PN_DIRTY ${m.ram[S.PN_DIRTY]}`);
  sec.ok(st.pic.count() === 0, 'model: white');
  editMenu(env, 0);                                           // Undo is disabled: nothing happens
  env.frames_(10);
  settleCheck(env, sec, 'a click on the disabled Undo does nothing');
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}`);
}

// ===========================================================================================================================================
// 6. Files: Save, Open, the discard question, New
const savedFile = (env, n = 0) => env.host.saves[env.host.saves.length - 1 - n];
/** File > Save...: the name dialog opens (Field focused); returns the Field model. */
function openSaveDialog(env, sec, ctx) {
  fileMenu(env, 2);
  sec.ok(waitDialog(env, 'name'), () => `${ctx}: the name dialog did not open (windows ${JSON.stringify(L.openWindows(env.m, env.S).map((w) => [w.title, w.x, w.y, w.w, w.h]))})`);
  env.frames_(6);
  // the Field's text as the machine holds it (the Field's buffer: a length byte and the codes)
  const fv = L.allViews(env.m, env.S).find((v) => v.cls === env.S.CL_Field);
  const fb = fv ? rd16(env.m, fv.a + env.S.Field_buf) : 0, mt = fb ? Q.strAt(env.m, fb) : '';
  // PAINT 9 (corrected): the Field starts with the picture's name: "Untitled" for a picture never saved, else the saved / opened name
  const want = env.st.name === '' ? 'Untitled' : env.st.name;
  sec.ok(mt === want, () => `${ctx}: the name dialog's Field starts with ${JSON.stringify(mt)}, want ${JSON.stringify(want)}`);
  const f = W3.newSaveField(codes(mt));
  Q.check(env, sec, `${ctx}: the name dialog`, { dialog: 'name', field: f, noCopy: true });
  return f;
}
/** Finish a Save: ENTER in the Field. Returns the commands the host got. */
function finishSave(env, sec, ctx, f, { fail = null } = {}) {
  const h = env.host, log0 = h.log.length, saves0 = h.saves.length;
  L.typeCode(env, 13, 3, 3);
  env.frames_(60);
  return { cmds: h.log.slice(log0).map((c) => ({ n: c.n, len: c.bytes.length, b0: c.bytes[0] })), saves: h.saves.slice(saves0) };
}
function saveAs(env, sec, ctx, typed, expectName, o = {}) {
  const st = env.st, f = openSaveDialog(env, sec, ctx);
  Q.fieldDelete(env, f, f.buf.length); Q.fieldType(env, f, typed);
  env.frames_(8);
  Q.check(env, sec, `${ctx}: the name typed`, { dialog: 'name', field: f, noCopy: true });
  const want = st.pbm();
  const r = finishSave(env, sec, ctx, f);
  sec.ok(r.saves.length === 1, () => `${ctx}: ${r.saves.length} files finished on the host; commands ${JSON.stringify(r.cmds.map((c) => c.n))}`);
  const s = r.saves[0];
  if (s) {
    sec.ok(s.name === expectName, () => `${ctx}: the host's file name "${s.name}", want "${expectName}"`);
    sec.ok(s.binary === true, () => `${ctx}: the file was written in ${s.binary ? 'binary' : 'TEXT'} mode`);
    const i = want.findIndex((v, k) => s.bytes[k] !== v);
    sec.ok(s.bytes.length === P.PBM_LEN && i < 0, () => `${ctx}: the saved bytes: ${s.bytes.length} long, want ${P.PBM_LEN}; first difference at byte ${i} (${s.bytes[i]}, model ${want[i]})`);
    sec.ok(s.bytes.slice(0, 11).every((v, k) => v === P.PBM_HEADER[k]), () => `${ctx}: the header ${JSON.stringify(String.fromCharCode(...s.bytes.slice(0, 11)))}`);
  }
  const ns = r.cmds.map((c) => c.n);
  sec.ok(ns[0] === 2 && ns[ns.length - 1] === 5 && ns.slice(1, -1).every((n) => n === 4), () => `${ctx}: the host's commands ${JSON.stringify(ns.length > 12 ? [...ns.slice(0, 6), '...', ...ns.slice(-3)] : ns)}, want open (2), writes (4), close (5)`);
  sec.ok(r.cmds[0] && r.cmds[0].b0 === 3, () => `${ctx}: FS_OPEN's mode ${r.cmds[0] && r.cmds[0].b0}, want 3 (write, binary)`);
  const writes = r.cmds.filter((c) => c.n === 4).map((c) => c.len - 2);
  sec.ok(writes.reduce((a, b) => a + b, 0) === P.PBM_LEN, () => `${ctx}: ${writes.length} writes totalling ${writes.reduce((a, b) => a + b, 0)} bytes, want ${P.PBM_LEN}`);
  sec.ok(writes[0] === 11 && writes.slice(1).every((n) => n === 40) && writes.length === 145, () => `${ctx}: write sizes ${JSON.stringify(writes.slice(0, 4))}... (${writes.length} writes), PAINT 9: the header (11), then 144 rows of 40`);
  st.name = expectName; st.dirty = false;
  return r;
}
/** Open a file through the picker: File > Open... (the discard question answered by `discard` when the picture has changed), the pick answered with `bytes`. */
function openFile(env, sec, ctx, name, bytes, { discard = 'discard', hook = null } = {}) {
  const st = env.st, h = env.host;
  fileMenu(env, 1);
  if (st.dirty) {
    sec.ok(waitDialog(env, 'ask'), () => `${ctx}: the picture has changed: "Discard the document?" should be asked first`);
    sec.ok(!h.picking, `${ctx}: the pick began before the question was answered`);
    Q.check(env, sec, `${ctx}: the question`, { dialog: 'ask', noCopy: true });
    Q.askAnswer(env, discard);
    if (discard === 'cancel' || discard === 'esc') { env.frames_(10); sec.ok(!h.picking, `${ctx}: Cancel: the pick must not start`); settleCheck(env, sec, `${ctx}: Cancel leaves everything`); return { cancelled: true }; }
  }
  const ok = Q.until(env, () => h.picking, 60);
  sec.ok(ok, () => `${ctx}: FS_PICK was not called`);
  if (!ok) return { picked: false };
  h.hook = hook;
  const log0 = h.log.length;
  h.answer(name, bytes);
  env.frames_(70);
  h.hook = null;
  return { picked: true, cmds: h.log.slice(log0).map((c) => ({ n: c.n, len: c.bytes.length, b0: c.bytes[0] })) };
}
const pbmOf = (bit) => { const out = [...P.PBM_HEADER]; for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | (bit(8 * k + j, r) ? 1 : 0); out.push(v); } return out; };
/** The model's picture := the machine's copy (for the cases the contract does not settle). */
function syncFromCopy(env) {
  const cp = Q.copyOf(env), st = env.st;
  for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { const v = cp[4 + ((k & 1) ^ 1) * 2880 + 20 * r + (k >> 1)]; for (let j = 0; j < 8; j++) st.pic.set(P.PIC.x + 8 * k + j, P.PIC.y + r, (v >> (7 - j)) & 1); }
}
const alertText = (env) => { const d = Q.dialogKind(env); if (!d || d.kind !== 'alert') return null; const lbl = d.kids.find((k) => k.cls === env.S.CL_Label); return lbl ? Q.strAt(env.m, rd16(env.m, lbl.a + env.S.Label_text)) : null; };

function g6() {
  const env = newEnv(), { m, S } = env, st = env.st, h = env.host;
  const sec = new Sec('6 files: Save... (name dialog, PBM bytes, ".pbm", title, PN_DIRTY), Open... (round trips, the alerts), the discard question for New / Open / Clear, New (PAINT 8, 9, 15)');
  // draw something, save it as "one"
  Q.chooseTool(env, 1);
  doStroke(env, sec, 'a stroke to save', [[150, 50], [250, 120], [330, 60], [440, 170]]);
  doStroke(env, sec, 'a second stroke', [[135, 160], [220, 160]]);
  sec.ok(st.dirty && m.ram[S.PN_DIRTY] === 1, 'changed');
  // Cancel of the dialog: nothing happens, the host hears nothing
  {
    const f = openSaveDialog(env, sec, 'Save, then Cancel'), n0 = h.log.length;
    Q.fieldType(env, f, 'zz');
    const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); env.frames_(20);
    sec.ok(h.log.length === n0, () => `Cancel sent ${h.log.length - n0} command(s) to the host`);
    settleCheck(env, sec, 'after Cancel of the name dialog');
  }
  saveAs(env, sec, 'Save "one"', 'one', 'one.pbm');
  settleCheck(env, sec, 'after the save', {});
  sec.ok(st.title === 'Paint: one.pbm' && Q.winTitle(env) === 'Paint: one.pbm', () => `title "${Q.winTitle(env)}"`);
  // save again: the Field holds the name; a name with a "." is not given a second extension
  saveAs(env, sec, 'Save "pic.x"', 'pic.x', 'pic.x');
  settleCheck(env, sec, 'after the second save');
  saveAs(env, sec, 'Save "two.pbm"', 'two.pbm', 'two.pbm');
  settleCheck(env, sec, 'after the third save');
  // a failing host: the alert, the title and PN_DIRTY unchanged
  doStroke(env, sec, 'a stroke (changed again)', [[300, 130], [360, 150]]);
  {
    h.hook = (n) => (n === 2 ? { status: 3 } : undefined);
    const f = openSaveDialog(env, sec, 'Save with a failing host');
    Q.fieldDelete(env, f, f.buf.length); Q.fieldType(env, f, 'bad');
    L.typeCode(env, 13, 3, 3); env.frames_(40);
    h.hook = null;
    const a = alertText(env);
    sec.ok(a === 'Cannot save the picture.', () => `a host failure at FS_OPEN: the alert says ${JSON.stringify(a)}, want "Cannot save the picture."`);
    Q.check(env, sec, 'Save failing: the alert', { dialog: 'alert', msg: 'Cannot save the picture.', noCopy: true });
    sec.ok(m.ram[S.PN_DIRTY] === 1, 'a failed Save leaves PN_DIRTY set');
    Q.alertOk(env, 'enter'); env.frames_(10);
    settleCheck(env, sec, 'after the alert (the name and the dirty flag are as before)');
  }
  {
    const saves0 = h.saves.length;
    h.hook = (n) => (n === 4 ? { status: 6 } : undefined);
    const f = openSaveDialog(env, sec, 'Save with a host that refuses the writes');
    L.typeCode(env, 13, 3, 3); env.frames_(40);
    h.hook = null;
    const a = alertText(env);
    sec.ok(a === 'Cannot save the picture.', () => `a host failure at FS_WRITE: the alert says ${JSON.stringify(a)}, want "Cannot save the picture."`);
    sec.ok(m.ram[S.PN_DIRTY] === 1, 'a failed write leaves PN_DIRTY set');
    sec.note(`a failing FS_WRITE: the host then got ${h.log.slice(-3).map((c) => c.n)} last; files finished: ${h.saves.length - saves0}`);
    if (Q.dialogKind(env)) Q.alertOk(env, 'click');
    env.frames_(10);
    settleCheck(env, sec, 'after the second alert');
  }
  // save the picture under "keep" for the round trip; remember it
  saveAs(env, sec, 'Save "keep"', 'keep', 'keep.pbm');
  const keep = st.clone(), keepBytes = savedFile(env).bytes.slice();
  // New: unchanged picture, no question; "Untitled", white, dirty 0
  fileMenu(env, 0); env.frames_(30);
  sec.ok(!Q.dialogKind(env), 'New on an unchanged picture asks nothing');
  st.newDoc();
  settleCheck(env, sec, 'New (unchanged picture)', { adoptStatus: true });
  sec.ok(st.title === 'Paint: Untitled' && m.ram[S.PN_DIRTY] === 0 && st.pic.count() === 0, 'model: Untitled, white, clean');
  // Open "keep.pbm": the round trip
  let r = openFile(env, sec, 'Open "keep.pbm"', 'keep.pbm', keepBytes);
  const ns = (r.cmds || []).map((c) => c.n);
  sec.ok(ns[0] === 1 || ns[0] === 2, () => `Open: the host's commands ${JSON.stringify(ns.slice(0, 6))}`);
  sec.ok(r.cmds && r.cmds.some((c) => c.n === 2 && c.b0 === 2), () => `FS_OPEN for reading must use mode 2 (read, binary): ${JSON.stringify((r.cmds || []).filter((c) => c.n === 2).map((c) => c.b0))}`);
  sec.ok(ns.includes(5), 'the file is closed');
  st.loadPbm(keepBytes); st.name = 'keep.pbm';
  settleCheck(env, sec, 'Open "keep.pbm": the round trip', { adoptStatus: true });
  sec.ok(eq(Array.from(st.copyBytes()), Array.from(keep.copyBytes())), 'model: the opened picture is the saved one');
  sec.ok(Q.menuWord(env, 1) === 1 && m.ram[S.PN_UNDO] === 0, 'Undo is disabled after an Open');
  // Opens of files built here
  const files = [
    ['noise (50%)', pbmOf(noise(21, 0.5))], ['all ink', pbmOf(() => 1)], ['white', pbmOf(() => 0)], ['sparse', pbmOf(noise(22, 0.03))],
    ['one pixel at each corner', pbmOf((x, y) => (x === 0 || x === 319) && (y === 0 || y === 143))],
    ['columns of 8', pbmOf((x) => ((x >> 3) & 1))],
  ];
  for (const [name, bytes] of files) {
    openFile(env, sec, `Open ${name}`, 'file.pbm', bytes);
    st.loadPbm(bytes); st.name = 'file.pbm';
    settleCheck(env, sec, `Open ${name}`, { adoptStatus: true });
    sec.ok(m.ram[S.PN_DIRTY] === 0, 'dirty 0 after Open');
  }
  // an opened picture can be drawn on and undone
  doStroke(env, sec, 'a stroke on an opened picture', [[200, 80], [230, 100]], { check: { adoptStatus: true } });
  undoAreaOk(env, sec, 'a stroke on an opened picture');
  // the alerts: a wrong length, a wrong header, an empty file; the picture is left alone
  const good = pbmOf(noise(23, 0.3));
  const bad = [
    ['5,770 bytes', good.slice(0, 5770)], ['5,772 bytes', [...good, 0]], ['an empty file', []], ['header only (11 bytes)', good.slice(0, 11)],
    ['"P1" for "P4"', [0x50, 0x31, ...good.slice(2)]], ['"320 143"', [...good.slice(0, 9), 0x33, ...good.slice(10)]], ['"319 144"', [...good.slice(0, 3), 0x33, 0x31, 0x39, ...good.slice(6)]],
    ['a comment line (same length)', [...codes('P4\n#a 320 144\n'.padEnd(11, ' ')).slice(0, 11), ...good.slice(11)]], ['"P4 320 144 " with spaces', [...codes('P4 320 144\n'), ...good.slice(11)]],
    ['CR LF line ends (same length)', [...codes('P4\r\n320 144\r\n').slice(0, 11), ...good.slice(11)]], ['a text file', codes('hello world, this is not a picture\n')],
  ];
  for (const [name, bytes] of bad) {
    // the picture is changed first so that a wrongly accepted file shows: a stroke, then Open (Discard)
    const before = st.clone();
    openFile(env, sec, `Open ${name}`, 'bad.pbm', bytes);
    const a = alertText(env);
    sec.ok(a === 'Not a 320 x 144 PBM picture.', () => `Open ${name}: the alert says ${JSON.stringify(a)}, want "Not a 320 x 144 PBM picture."`);
    Q.check(env, sec, `Open ${name}: the alert`, { dialog: 'alert', msg: 'Not a 320 x 144 PBM picture.', noCopy: true, adoptStatus: true });
    Q.alertOk(env, 'enter'); env.frames_(10);
    // after the alert the picture is as it was; the name and dirty are unchanged except that the Discard was answered: not asked, since the picture was not changed
    settleCheck(env, sec, `Open ${name}: after the alert the picture is as before`, { adoptStatus: true });
    sec.ok(eq(Array.from(st.copyBytes()), Array.from(before.copyBytes())), 'model unchanged');
  }
  // cancel the picker: nothing changes
  {
    fileMenu(env, 1);
    if (st.dirty) { sec.ok(waitDialog(env, 'ask'), 'Open (changed): the question'); Q.askAnswer(env, 'discard'); }
    const ok = Q.until(env, () => h.picking, 60);
    sec.ok(ok, 'Open: the pick began');
    if (ok) h.answer(null);
    env.frames_(30);
    settleCheck(env, sec, 'Open, the pick cancelled: nothing changed', { adoptStatus: true });
  }
  // host failures at the read
  {
    const before = st.clone();
    openFile(env, sec, 'Open with a read failure', 'rf.pbm', good, { hook: (n) => (n === 3 ? { status: 6 } : undefined) });
    const a = alertText(env);
    sec.ok(a === 'Cannot read the file.', () => `a host failure at FS_READ: the alert says ${JSON.stringify(a)}, want "Cannot read the file."`);
    Q.check(env, sec, 'Open with a read failure: the alert', { dialog: 'alert', msg: a ?? 'Cannot read the file.', noCopy: true, adoptStatus: true });
    Q.alertOk(env, 'enter'); env.frames_(10);
    settleCheck(env, sec, 'after the alert, the display is the old picture', { adoptStatus: true, noCopy: true });
    const cp = Q.copyOf(env), i = Q.firstDiffBytes(cp, before.copyBytes(Q.SWAP));
    sec.note(i < 0 ? 'a failed read (the first FS_READ) leaves the copy untouched' : `a failed read (the first FS_READ) changed the copy at ${Q.describeIdx(i)}`);
    sec.ok(Q.statusOf(env) !== undefined, 'status read');
  }
  {
    // a read that fails half way (the 20th FS_READ)
    let k = 0;
    openFile(env, sec, 'Open with a read failure half way', 'rf2.pbm', good, { hook: (n) => (n === 3 && ++k === 20 ? { status: 6 } : undefined) });
    const a = alertText(env);
    sec.ok(a === 'Cannot read the file.', () => `a host failure in the middle of the file: the alert says ${JSON.stringify(a)}, want "Cannot read the file."`);
    if (a) { Q.alertOk(env, 'enter'); env.frames_(10); }
    const cp = Q.copyOf(env), was = st.copyBytes(Q.SWAP), nd = cp.reduce((n, v, i) => n + (v !== was[i] ? 1 : 0), 0);
    const dp = Q.displayPlanar(env), dd = dp.reduce((n, v, i) => n + (v !== was[i] ? 1 : 0), 0);
    sec.note(`a read that fails half way (the 20th FS_READ): ${nd} copy byte(s) and ${dd} displayed byte(s) differ from the picture before the Open (the contract does not say what the picture shows after it)`);
    Q.park(env, 3);
    Q.copyIsDisplay(env, sec, 'after a half-way read failure: the display is the copy');
    st.status = Q.statusOf(env);
    syncFromCopy(env);                                 // the model follows the machine's copy from here
    settleCheck(env, sec, 'after a half-way read failure: the model follows the machine\'s copy', { adoptStatus: true });
  }
  {
    // FS_OPEN refused
    openFile(env, sec, 'Open with a host that refuses FS_OPEN', 'rf3.pbm', good, { hook: (n) => (n === 2 ? { status: 3 } : undefined) });
    const a = alertText(env);
    sec.ok(a !== null, 'FS_OPEN refused: an alert is shown');
    sec.note(`FS_OPEN refused by the host: the alert says ${JSON.stringify(a)} (the contract names "Cannot read the file." for a read failure only)`);
    if (a) { Q.alertOk(env, 'enter'); env.frames_(10); }
  }
  // restore a known state: Open the good file again (this machine's copy may hold half a picture)
  openFile(env, sec, 'Open the good file again', 'good.pbm', good);
  st.loadPbm(good); st.name = 'good.pbm';
  settleCheck(env, sec, 'Open the good file again', { adoptStatus: true });

  // ---- the discard question
  const stroke1 = () => doStroke(env, sec, 'a stroke (changes the picture)', [[200, 100], [240, 120]], { check: { adoptStatus: true } });
  // New, changed: Cancel leaves everything; Discard (ENTER, click) does New
  for (const how of ['cancel', 'esc', 'discard', 'enter']) {
    stroke1();
    const was = st.clone();
    fileMenu(env, 0);
    sec.ok(waitDialog(env, 'ask'), `New (changed), ${how}: the question`);
    Q.check(env, sec, `New (changed), ${how}: the question`, { dialog: 'ask', noCopy: true });
    Q.askAnswer(env, how);
    if (how === 'cancel' || how === 'esc') settleCheck(env, sec, `New (changed): ${how} leaves everything`, { adoptStatus: true });
    else { st.newDoc(); settleCheck(env, sec, `New (changed): ${how} gives Untitled`, { adoptStatus: true }); sec.ok(st.title === 'Paint: Untitled' && st.pic.count() === 0 && m.ram[S.PN_DIRTY] === 0, 'Untitled, white, clean'); }
    if (how === 'cancel' || how === 'esc') sec.ok(eq(Array.from(st.copyBytes()), Array.from(was.copyBytes())), 'model: unchanged');
  }
  // Clear: changed asks; unchanged does not
  stroke1();
  editMenu(env, 1); sec.ok(waitDialog(env, 'ask'), 'Clear (changed): the question'); Q.askAnswer(env, 'cancel');
  settleCheck(env, sec, 'Clear (changed), Cancel', { adoptStatus: true });
  editMenu(env, 1); sec.ok(waitDialog(env, 'ask'), 'Clear (changed): the question again'); Q.askAnswer(env, 'enter'); st.clear();
  settleCheck(env, sec, 'Clear (changed), Discard', { adoptStatus: true });
  fileMenu(env, 0); sec.ok(waitDialog(env, 'ask'), 'New after Clear (PN_DIRTY is 1): the question'); Q.askAnswer(env, 'discard'); st.newDoc();
  settleCheck(env, sec, 'New to make the picture unchanged', { adoptStatus: true });
  editMenu(env, 1); env.frames_(30);
  sec.ok(!Q.dialogKind(env), 'Clear on an unchanged picture asks nothing'); st.clear();
  settleCheck(env, sec, 'Clear (unchanged)', { adoptStatus: true });
  sec.ok(m.ram[S.PN_DIRTY] === 1, () => `Clear sets PN_DIRTY (${m.ram[S.PN_DIRTY]})`);
  // Open with Cancel at the question: the picker is not called
  stroke1();
  r = openFile(env, sec, 'Open (changed), Cancel', 'x.pbm', good, { discard: 'cancel' });
  stroke1();
  r = openFile(env, sec, 'Open (changed), ESC', 'x.pbm', good, { discard: 'esc' });
  // Open with Discard
  r = openFile(env, sec, 'Open (changed), Discard', 'again.pbm', good);
  st.loadPbm(good); st.name = 'again.pbm';
  settleCheck(env, sec, 'Open (changed), Discard', { adoptStatus: true });
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}; host commands ${h.log.length}`);
}

// ===========================================================================================================================================
// 7. Quit and relaunch
function g7() {
  const sec = new Sec('7 quit: File > Quit, the close box and SYMBOL SHIFT + Q return to the shell (K_PROG 0); a changed picture asks first; relaunching shows a fresh white picture (PAINT 8, 15)');
  for (const how of ['menu', 'closebox', 'ssq']) {
    const env = newEnv(), { m, S } = env, st = env.st;
    const quit = () => { env.img.armed = false; if (how === 'menu') { fileMenu(env, 4); return L.waitShell(env, 60); } return how === 'closebox' ? L.quitByCloseBox(env, 4) : L.quitBySSQ(env); };
    // unchanged: no question
    const ok = quit();
    sec.ok(ok && m.ram[S.K_PROG] === 0, () => `${how}: unchanged picture: K_PROG ${m.ram[S.K_PROG]}, the shell ${ok ? 'is' : 'is not'} up`);
    sec.ok(L.progUp(env, 0), () => `${how}: the shell's window is up after Quit`);   // (the shell's own pixels are tests/shell-s1.mjs's business: its model is being updated for the fourth icon)
    // relaunch: a fresh white picture (the launcher copies the image to $C000: the image-write watch is off meanwhile)
    env.img.armed = false;
    H.leapMenu(env, 6);
    sec.ok(L.waitProgram(env, 4, 160) >= 0, `${how}: relaunched`);
    env.frames_(24); env.img.armed = true;
    st.reset();
    Q.park(env, 6);
    Q.check(env, sec, `${how}: relaunch`, {});
    // changed: ask; cancel stays; discard quits and the next launch is fresh
    doStroke(env, sec, `${how}: a stroke`, [[200, 100], [240, 120], [260, 90]], { check: { adoptStatus: true } });
    const ok2 = (() => { if (how === 'menu') fileMenu(env, 4); else if (how === 'closebox') { const w = L.PROG_WIN[4], b = L.closeBoxOf(w.x, w.y, w.w); L.click(env, b.x + (b.w >> 1), b.y + (b.h >> 1), 3, 6); } else L.typeCode(env, 17, 3, 3); return waitDialog(env, 'ask'); })();
    sec.ok(ok2, `${how}: a changed picture asks "Discard the document?"`);
    sec.ok(m.ram[S.K_PROG] === 4, `${how}: still in Paint while the question is open`);
    Q.check(env, sec, `${how}: the question`, { dialog: 'ask', noCopy: true });
    Q.askAnswer(env, 'cancel');
    settleCheck(env, sec, `${how}: Cancel stays in Paint, the picture as it was`, { adoptStatus: true });
    if (how === 'menu') fileMenu(env, 4); else if (how === 'closebox') { const w = L.PROG_WIN[4], b = L.closeBoxOf(w.x, w.y, w.w); L.click(env, b.x + (b.w >> 1), b.y + (b.h >> 1), 3, 6); } else L.typeCode(env, 17, 3, 3);
    sec.ok(waitDialog(env, 'ask'), `${how}: the question again`);
    env.img.armed = false;                      // the shell's own image is copied to $C000 on the way back
    Q.askAnswer(env, 'discard'); env.frames_(30);
    sec.ok(L.waitShell(env, 60) && m.ram[S.K_PROG] === 0, () => `${how}: Discard quits (K_PROG ${m.ram[S.K_PROG]})`);
    env.img.armed = false;
    H.leapMenu(env, 6);
    sec.ok(L.waitProgram(env, 4, 160) >= 0, `${how}: relaunched after a changed quit`);
    env.frames_(24); env.img.armed = true; st.reset(); Q.park(env, 6);
    Q.check(env, sec, `${how}: relaunch after a discard`, {});
    Q.copyIsDisplay(env, sec, `${how}: relaunch after a discard`);
    sec.ok(env.w.n === 0, () => `${how}: memory watch: ${env.w.summary()}`);
  }
  sec.end();
}

// ===========================================================================================================================================
// 8. Exposure: dialogs over the canvas, a dragged window
function g8() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('8 exposure: dialogs cover part of the canvas and are closed again (the redraw restores exactly the covered part); Paint\'s window dragged to other cell offsets, then used (PAINT 4)');
  Q.install(env, noise(31, 0.5));
  settleCheck(env, sec, 'a noisy picture installed');
  // the ask over the canvas, cancelled; the alert over the canvas; the name dialog over the canvas
  doStroke(env, sec, 'a stroke (so that the picture is changed)', [[200, 100], [300, 120]], { check: { adoptStatus: true } });
  for (const how of ['cancel', 'esc', 'cancel']) {
    fileMenu(env, 0); waitDialog(env, 'ask');
    Q.check(env, sec, 'the question over the canvas (screen with the dialog)', { dialog: 'ask', noCopy: true });
    Q.askAnswer(env, how);
    settleCheck(env, sec, `the question closed (${how}): the canvas is exactly the picture`, { adoptStatus: true });
  }
  { const f = openSaveDialog(env, sec, 'the name dialog over the canvas'); const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); env.frames_(20); settleCheck(env, sec, 'the name dialog closed: the canvas is exactly the picture', { adoptStatus: true }); }
  { // the alert over the canvas
    const bad = pbmOf(noise(32, 0.5)).slice(0, 100);
    st.dirty = m.ram[S.PN_DIRTY] === 1;
    fileMenu(env, 1); if (st.dirty) { waitDialog(env, 'ask'); Q.askAnswer(env, 'discard'); }
    Q.until(env, () => env.host.picking, 60); env.host.answer('short.pbm', bad); env.frames_(60);
    sec.ok(alertText(env) === 'Not a 320 x 144 PBM picture.', () => `alert ${alertText(env)}`);
    Q.check(env, sec, 'the alert over the canvas', { dialog: 'alert', msg: 'Not a 320 x 144 PBM picture.', noCopy: true, adoptStatus: true });
    Q.alertOk(env, 'click'); env.frames_(10);
    settleCheck(env, sec, 'the alert closed: the canvas is exactly the picture', { adoptStatus: true });
  }
  // the window dragged by its title bar
  const drag = (dx, dy) => {
    const w = Q.paintWin(env), tx = w.x + 200, ty = w.y + 3;
    L.moveTo(env, tx, ty); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, tx + dx, ty + dy); env.frames_(3);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(30);
    const w2 = Q.paintWin(env);
    st.ox = w2.x - 48; st.oy = w2.y - 16;
    return [w2.x - w.x, w2.y - w.y];
  };
  // every drag: the screen equals the model (the picture origin is the Canvas view's x + 2, y + 2), then the program is used in the moved window
  let n = 0; const seen = [];
  for (const [dx, dy] of [[40, 0], [-30, 12], [-100, 0], [64, 16], [0, -20], [120, 0], [-130, 0], [32, 8], [0, 24], [-16, 16]]) {
    const [rx, ry] = drag(dx, dy);
    sec.note(`dragged by (${dx}, ${dy}): the window moved by (${rx}, ${ry})`);
    const w = Q.paintWin(env), tag = `the window at (${w.x}, ${w.y})`; seen.push(`(${w.x}, ${w.y})`);
    sec.ok(w.x % 16 === 0 && w.y % 8 === 0, () => `the window's position (${w.x}, ${w.y}) is cell-aligned`);
    const k = Q.paintKids(env);
    sec.ok(k.length === 5 && k.slice(0, 3).every((v) => v.x === 55 + st.ox) && [28, 112, 164].every((y, i) => k[i].y === y + st.oy) && k[3].x === 126 + st.ox && k[3].y === 30 + st.oy && k[4].x === 127 + st.ox && k[4].y === 180 + st.oy, () => `${tag}: the views moved with the window: ${JSON.stringify(k.map((v) => [v.x, v.y]))}`);
    settleCheck(env, sec, `after the drag to (${w.x}, ${w.y}): the screen is the model's (the canvas inside its view)`, { adoptStatus: true });
    const px = (a) => w.x + 80 + a, py = (a) => w.y + 30 + a;                 // inside the picture (its origin is (w.x + 80, w.y + 16))
    doStroke(env, sec, `${tag}: a pencil stroke`, [[px(20), py(20)], [px(60), py(50)], [px(120), py(40)], [px(120), py(90)]], { check: { adoptStatus: true } });
    sec.ok(st.undoOn, `${tag}: the stroke can be undone`);
    undoAreaOk(env, sec, tag);
    editMenu(env, 0); st.undo(); settleCheck(env, sec, `${tag}: Undo`, { adoptStatus: true }); undoAreaOk(env, sec, `${tag}: Undo`);
    editMenu(env, 0); st.undo(); settleCheck(env, sec, `${tag}: Undo again (redo)`, { adoptStatus: true });
    Q.chooseTool(env, 3); st.chooseTool(3);
    doStroke(env, sec, `${tag}: an eraser stroke`, [[px(30), py(30)], [px(90), py(36)], [px(150), py(60)]], { check: { adoptStatus: true } });
    Q.chooseTool(env, 1); st.chooseTool(1);
    doStroke(env, sec, `${tag}: a stroke that leaves the picture on the left (clipped)`, [[px(10), py(70)], [px(-10), py(70)], [px(-30), py(72)], [px(40), py(100)]], { check: { adoptStatus: true } });
    // cover and uncover: the ask, the name dialog and the alert are fixed on the desk and cover the canvas at this offset
    fileMenu(env, 0); sec.ok(waitDialog(env, 'ask'), `${tag}: the question`);
    Q.check(env, sec, `${tag}: the question over the canvas`, { dialog: 'ask', noCopy: true });
    Q.askAnswer(env, 'cancel');
    settleCheck(env, sec, `${tag}: the question closed: the canvas is exactly the picture`, { adoptStatus: true });
    openSaveDialog(env, sec, `${tag}: the name dialog`); { const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); env.frames_(20); }
    settleCheck(env, sec, `${tag}: the name dialog closed: the canvas is exactly the picture`, { adoptStatus: true });
    // Save, then Open of a file of our own: the file is the picture, the picture follows the file
    const r = saveAs(env, sec, `${tag}: Save`, `m${n}`, `m${n}.pbm`);
    settleCheck(env, sec, `${tag}: after the save`, { adoptStatus: true });
    const file = pbmOf(noise(60 + n, 0.4));
    openFile(env, sec, `${tag}: Open`, `o${n}.pbm`, file);
    st.loadPbm(file); st.name = `o${n}.pbm`;
    settleCheck(env, sec, `${tag}: after the Open`, { adoptStatus: true });
    doStroke(env, sec, `${tag}: a stroke on the opened picture`, [[px(50), py(50)], [px(80), py(70)]], { check: { adoptStatus: true } });
    editMenu(env, 1); sec.ok(waitDialog(env, 'ask'), `${tag}: Clear asks`); Q.askAnswer(env, 'discard'); st.clear();
    settleCheck(env, sec, `${tag}: Clear`, { adoptStatus: true });
    n++;
  }
  // back home: the window at (48, 16) again
  drag(-st.ox, -st.oy);
  settleCheck(env, sec, 'dragged back to (48, 16): the screen is the model\'s', { adoptStatus: true });
  doStroke(env, sec, 'a stroke at home again', [[200, 100], [260, 130]], { check: { adoptStatus: true } });
  sec.end(`window positions tried: ${seen.join(' ')}; stack so far ${env.stack.depth()} bytes; memory watch: ${env.w.summary()}`);
}

// ===========================================================================================================================================
// 10. P2a: the pattern and brush palettes, the brush, the spray (PAINT 16)
function g10() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('10 P2a (PAINT 16): pattern and brush palette clicks, brush strokes (REPLACE: the white pattern erases) with each brush and several patterns, spray bursts (the LFSR reproduced), undo of a brush / spray stroke, a stroke too big to undo');
  const after = (ctx, o = {}) => { settleCheck(env, sec, ctx, o); if (st.undoOn) undoAreaOk(env, sec, ctx); };
  const pads = (ctx) => { const [pc, pr] = P.PADS[st.tool]; sec.ok(m.ram[S.PN_PADC] === pc && m.ram[S.PN_PADR] === pr, () => `${ctx}: PN_PADC / PN_PADR ${m.ram[S.PN_PADC]}, ${m.ram[S.PN_PADR]}; the margins of tool ${st.tool} are ${pc}, ${pr}`); };
  // a brush stamp is up to 15,000 T, a 24-pixel step 12 stamps: steps are split to 24 pixels and followed by 4 quiet frames, so that the machine finishes each step before the next (as a hand would not outrun it)
  const slow = () => (st.tool === 2 ? { gap: 4, max: 24, settle: 30 } : {});
  const go = (ctx, pts, o = {}) => { const r = doStroke(env, sec, ctx, pts, { check: { adoptStatus: true }, ...slow(), ...o });
    if (st.tool === 4 && r.began) sec.ok(r.burstBad === 0 && r.bursts.length >= 1 && r.bursts[0].x === r.pts[0][0] && r.bursts[0].y === r.pts[0][1] && !r.bursts[0].idle, () => `${ctx}: the machine's bursts (${r.bursts.length}) must be at the pointer's positions, the first at the press: ${r.burstBad} elsewhere; first ${JSON.stringify(r.bursts[0])}, press at ${r.pts[0]}`); if (st.tool === 4 && r.began) sec.ok(r.burstDup === 0, () => `${ctx}: PAINT 16: at most one burst a frame, but ${r.burstDup} burst(s) share a frame with the one before (${r.bursts.map((b) => 'f' + b.f + (b.idle ? 'i' : 'e')).join(' ')})`); pads(ctx); if (st.undoOn) undoAreaOk(env, sec, ctx); return r; };
  const pat = (p) => { Q.choosePattern(env, p); st.choosePat(p); };
  const brush = (b) => { Q.chooseBrush(env, b); st.chooseBrush(b); };
  const tool = (t) => { Q.chooseTool(env, t); st.chooseTool(t); };
  // -- the pattern palette: every swatch (centre, then a corner of the interior), then the same one twice, then clicks off the swatches
  for (let p = 0; p < 16; p++) {
    const c = P.swatchOf(p), [px, py] = [[c.x + 8, c.y + 6], [c.x, c.y], [c.x + 15, c.y + 11], [c.x + 3, c.y + 9]][p % 4];
    L.click(env, px, py, 3, 6); st.choosePat(p);
    settleCheck(env, sec, `pattern ${p} clicked at (${px}, ${py})`);
  }
  for (const p of [15, 0, 5, 5, 9, 2, 13]) { pat(p); settleCheck(env, sec, `pattern ${p} again`); }
  pat(2);
  for (const [x, y] of [[120, 130], [120, 150], [100, 112], [100, 111], [122, 130]]) { L.click(env, x, y, 3, 6); settleCheck(env, sec, `a click at (${x}, ${y}) off the swatches (pattern 2 stays)`); }
  // -- the brush palette
  for (let b = 0; b < 4; b++) {
    const c = P.brushCell(b), [px, py] = [[c.x + 8, c.y + 8], [c.x, c.y], [c.x + 15, c.y + 15], [c.x + 4, c.y + 11]][b];
    L.click(env, px, py, 3, 6); st.chooseBrush(b);
    settleCheck(env, sec, `brush ${b} (${P.BRUSHNAMES[b]}) clicked at (${px}, ${py})`);
  }
  for (const b of [0, 3, 3, 1, 2, 0]) { brush(b); settleCheck(env, sec, `brush ${b} again`); }
  brush(1); pat(0);
  for (const [x, y] of [[120, 170], [100, 164], [122, 170], [60, 182]]) { L.click(env, x, y, 3, 6); settleCheck(env, sec, `a click at (${x}, ${y}) off the brushes (brush 1 stays)`); }
  sec.ok(m.ram[S.PN_DIRTY] === 0 && m.ram[S.PN_UNDO] === 0 && m.ram[S.PN_TOOL] === 1, () => `palette clicks changed PN_DIRTY ${m.ram[S.PN_DIRTY]}, PN_UNDO ${m.ram[S.PN_UNDO]}, PN_TOOL ${m.ram[S.PN_TOOL]}`);
  // -- the brush: on a noisy picture every brush with several patterns (the paper bits of the pattern are drawn: REPLACE)
  Q.install(env, noise(21, 0.5));
  tool(2);
  settleCheck(env, sec, 'a noisy picture installed, the Brush chosen');
  go('a single click, brush 1, pattern 0', [[200, 80]]);
  const PATSET = [0, 2, 3, 7, 9, 11, 13, 15];
  for (let b = 0; b < 4; b++) {
    brush(b);
    for (const p of PATSET) {
      pat(p);
      const y0 = 40 + 14 * PATSET.indexOf(p);
      go(`brush ${b} (${P.BRUSHNAMES[b]}), pattern ${p}: a horizontal stroke, 1 pixel a frame, and a click`, [...Array.from({ length: 12 }, (_, i) => [150 + 3 * b * 10 + i, y0]), [330 + 20 * b, y0 + 2]]);
    }
  }
  brush(1);
  for (const [name, pts] of [
    ['a diagonal, 2 pixels a frame', Array.from({ length: 14 }, (_, i) => [200 + 2 * i, 60 + 2 * i])],
    ['a vertical, 1 pixel a frame (odd and even step counts)', Array.from({ length: 11 }, (_, i) => [260, 60 + i])],
    ['a fast stroke (40 pixels a frame)', [[140, 50], [180, 60], [220, 100], [260, 90], [300, 150]]],
    ['a single step of 1 and of 2 pixels', [[350, 100], [351, 100], [351, 102], [352, 102]]],
    ['stamps clipped at the picture\'s edge', [[130, 40], [135, 36], [128, 34], [135, 34], [445, 174], [440, 170]]],
    ['leaves the picture and returns', [[430, 100], [446, 104], [470, 112], [480, 130], [440, 130]]],
  ]) { pat(2); go(name, pts); }
  pat(15);
  go('the white pattern erases (brush 1, pattern 15) over the noise', Array.from({ length: 30 }, (_, i) => [180 + 3 * i, 120 + (i % 5)]));
  pat(0); brush(2);
  go('the solid square brush: a short stroke', [[300, 60], [320, 60], [320, 80]]);
  for (let i = 0; i < NRAND; i++) {
    brush(rng.int(0, 3)); pat(rng.int(0, 15));
    go(`random brush stroke ${i + 1} (brush ${st.brush}, pattern ${st.pat})`, rndWalk(rng.int(2, 14), rng.int(135, 440), rng.int(40, 170), rng.int(1, 40), [129, 33], [446, 174]));
  }
  // -- undo of a brush stroke, and of a stroke with each margin
  brush(3); pat(6);
  go('a brush stroke to undo', [[200, 80], [230, 100], [250, 90]]);
  sec.ok(st.undoOn && Q.menuWord(env, 1) === 3, 'Undo enabled after a brush stroke');
  {
    const pre = st.clone();
    editMenu(env, 0); st.undo(); after('Undo of the brush stroke');
    sec.ok(!eq(Array.from(pre.copyBytes()), Array.from(st.copyBytes())), 'model: the undo changed the picture');
    editMenu(env, 0); st.undo(); after('Undo again (redo) of the brush stroke');
    sec.ok(eq(Array.from(pre.copyBytes()), Array.from(st.copyBytes())), 'model: undo twice is the identity');
  }
  for (const [b, p] of [[0, 15], [1, 0], [2, 11], [3, 13]]) {
    brush(b); pat(p);
    go(`a brush stroke, brush ${b}, pattern ${p}, then Undo`, [[300, 100], [320, 108], [340, 100]]);
    editMenu(env, 0); st.undo(); after(`Undo of brush ${b}, pattern ${p}`);
  }
  // the box: a click in each corner of the picture (clamped margins), brush 1 and the spray, widened to even columns
  brush(1);
  for (const [name, pt] of [['top-left', [128, 32]], ['top-right', [447, 32]], ['bottom-left', [128, 175]], ['bottom-right', [447, 175]], ['column 24', [330, 100]]]) {
    go(`a brush click, ${name}`, [pt]);
    editMenu(env, 0); st.undo(); after(`Undo of the brush click, ${name}`);
  }
  // a brush stroke whose box is just 2,048 bytes and one row more (margins 1 column, 4 rows): the box is 32 columns x 64 rows for y 60 .. 115, 65 rows for y 116
  for (const [name, p1, wantFit] of [['32 x 64', [384, 115], true], ['32 x 65', [384, 116], false]]) {
    brush(1); pat(0);
    const rr = Q.stroke(env, [[152, 60], p1], slow());
    const b = rr.box;
    sec.ok(b.nc === 32 && b.nr === (wantFit ? 64 : 65) && (b.nc * b.nr <= 2048) === wantFit, () => `the model's brush box for ${name}: ${JSON.stringify(b)}`);
    settleCheck(env, sec, `the brush stroke with a box of ${name} bytes`, { adoptStatus: true, noBox: !wantFit });
    if (wantFit) { undoAreaOk(env, sec, name); sec.ok(Q.menuWord(env, 1) === 3, `${name}: Undo enabled`); }
    else sec.ok(Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo' && m.ram[S.PN_UNDO] === 0, () => `${name}: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}", PN_UNDO ${m.ram[S.PN_UNDO]}`);
  }
  // a brush stroke too big to undo: Undo disabled, the status says so; a small stroke after it enables Undo again
  pat(2); brush(0);
  {
    const rr = Q.stroke(env, [[140, 45], [440, 45], [440, 170], [140, 170]], slow());
    settleCheck(env, sec, 'a brush stroke round the picture (a very big box)', { noBox: true });
    sec.ok(!st.undoOn && Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo' && !!rr.box, () => `very big brush box: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}"`);
    go('a small brush stroke after a too-big one', [[300, 100], [310, 105]]);
    sec.ok(Q.menuWord(env, 1) === 3, 'Undo enabled again');
  }
  // -- the spray: bursts at the press, at every E_MOVE and in every frame with the button held and no event; the model reproduces the LFSR (PN_RND is compared after every action)
  Q.install(env, noise(22, 0.35));
  tool(4);
  settleCheck(env, sec, 'a noisy picture installed, the Spray chosen');
  for (const p of [0, 2, 7, 11, 15]) {
    pat(p);
    go(`spray, pattern ${p}: a click (one burst)`, [[200 + 20 * p % 100, 60 + p]]);
    go(`spray, pattern ${p}: held still for 6 frames (an idle burst each) after the press`, [[260, 100 + p]], { wait: 6 });
    go(`spray, pattern ${p}: a stroke, 3 pixels a frame, and a pause`, [...Array.from({ length: 10 }, (_, i) => [300 + 3 * i, 90 + p]), [329, 90 + p], [329, 90 + p], [329, 90 + p]]);
  }
  pat(0);
  for (const [name, pts, o] of [
    ['a long stroke, 20 pixels a frame', Array.from({ length: 12 }, (_, i) => [140 + 20 * i, 60 + 6 * i]), {}],
    ['a burst held for 40 frames in one place (many bursts: the LFSR runs on)', [[250, 120]], { wait: 40 }],
    ['bursts at the picture\'s edges (clipped to the picture)', [[130, 34], [128, 32], [446, 34], [447, 33], [446, 174], [130, 174], [128, 175]], {}],
    ['leaves the picture and returns', [[430, 100], [446, 104], [470, 112], [480, 130], [440, 130]], {}],
  ]) go(`spray: ${name}`, pts, o);
  for (let i = 0; i < NRAND; i++) { pat(rng.int(0, 15)); go(`random spray stroke ${i + 1} (pattern ${st.pat})`, rndWalk(rng.int(1, 10), rng.int(135, 440), rng.int(40, 170), rng.int(0, 30), [129, 33], [446, 174]), { wait: rng.int(0, 3) }); }
  // spray: undo, the box (margins 2 columns, 8 rows), too big
  pat(2);
  go('a spray stroke to undo', [[200, 80], [230, 100], [250, 90]]);
  sec.ok(st.undoOn, 'model: undo on');
  editMenu(env, 0); st.undo(); after('Undo of the spray stroke');
  editMenu(env, 0); st.undo(); after('Undo again (redo) of the spray stroke');
  for (const [name, pt] of [['top-left', [128, 32]], ['bottom-right', [447, 175]], ['column 13', [233, 100]]]) {
    go(`a spray click, ${name}`, [pt]);
    editMenu(env, 0); st.undo(); after(`Undo of the spray click, ${name}`);
  }
  // 2,048 bytes: margins 2 columns, 8 rows: x 168 .. 380 is columns 5 .. 31, the box columns 3 .. 33 widened to 2 .. 33 (32 columns); y 60 .. 107 is rows 28 .. 75, the box rows 20 .. 83 (64); one row more does not fit
  for (const [name, p0, p1, wantFit] of [['32 x 64', [168, 60], [380, 107], true], ['32 x 65', [168, 60], [380, 108], false]]) {
    const rr = Q.stroke(env, [p0, p1], { wait: 2 });
    const b = rr.box;
    sec.ok(b.nc === 32 && b.nr === (wantFit ? 64 : 65) && (b.nc * b.nr <= 2048) === wantFit, () => `the model's spray box for ${name}: ${JSON.stringify(b)} (${b.nc * b.nr} bytes)`);
    settleCheck(env, sec, `the spray stroke with a box of ${name}`, { adoptStatus: true, noBox: !wantFit });
    if (wantFit) { undoAreaOk(env, sec, name); sec.ok(Q.menuWord(env, 1) === 3, `${name}: Undo enabled`); }
    else sec.ok(Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo' && m.ram[S.PN_UNDO] === 0, () => `${name}: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}", PN_UNDO ${m.ram[S.PN_UNDO]}`);
  }
  {
    const rr = Q.stroke(env, [[140, 45], [440, 45], [440, 170], [140, 170]], {});
    settleCheck(env, sec, 'a spray stroke round the picture (a very big box)', { noBox: true });
    sec.ok(!st.undoOn && Q.menuWord(env, 1) === 1 && Q.statusOf(env) === 'Too big to undo' && !!rr.box, () => `very big spray box: Edit word ${Q.menuWord(env, 1).toString(2)}, status "${Q.statusOf(env)}"`);
  }
  // the other tools still draw as before, with a pattern chosen (the pencil and the eraser ignore it)
  pat(7); tool(1); go('the pencil with pattern 7 chosen: solid ink', [[300, 60], [340, 90]]);
  tool(3); go('the eraser with pattern 7 chosen: paper', [[300, 70], [330, 80]]);
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}; PN_RND ${hex(rd16(m, S.PN_RND))}`);
}

// ===========================================================================================================================================
// 11. The spray's frame rule (PAINT 16: a burst on the press, on every E_MOVE and on every frame WITHOUT an event while the button is held; AT MOST ONE burst a frame (PN_SPR); the release frame has an event and no burst)
function g11() {
  const sec = new Sec('11 spray frame rule (PAINT 16): a burst on the press, on each E_MOVE frame and on each frame without an event while held (pn_idle), never two in one frame, none after the release; read from the entry of pn_spray');
  const env = newEnv(), { m, S } = env, st = env.st;
  Q.chooseTool(env, 4); st.chooseTool(4);
  const fmt = (l) => l.map((b) => `${b.idle ? 'idle' : 'event'}@(${b.x},${b.y}) f${b.f}`).join(', ');
  /** A scripted stroke: steps 'down', ['m', x, y], 'quiet', 'up' (one frame each); each frame's bursts are matched with what the contract gives it. */
  function run(name, p0, steps) {
    L.moveTo(env, p0[0], p0[1]); env.frames_(2); env.bursts.length = 0;
    const frames = []; let pos = L.pointerPos(m, S);
    for (const s of steps) {
      const kind = Array.isArray(s) ? 'move' : s, f = env.frames;
      if (kind === 'down') { m.mouse.buttons = L.MOUSE_LEFT; env.frame(); }
      else if (kind === 'up') { m.mouse.buttons = L.MOUSE_UP; env.frame(); }
      else if (kind === 'move') pos = Q.stepTo(env, s[1], s[2]);
      else env.frame();
      frames.push({ kind, f, pos });
    }
    env.frames_(10);
    const b = env.bursts.splice(0);
    // the rule frame by frame
    const byF = new Map(); for (const x of b) byF.set(x.f, [...(byF.get(x.f) || []), x]);
    sec.ok([...byF.values()].every((l) => l.length === 1), () => `${name}: two bursts in one frame (PAINT 16: at most one a frame); the machine's bursts: ${fmt(b)}`);
    let held = false;
    for (const fr of frames) {
      const l = byF.get(fr.f) || [];
      if (fr.kind === 'down') { held = true; sec.ok(l.length === 1 && !l[0].idle && l[0].x === fr.pos[0] && l[0].y === fr.pos[1], () => `${name}: the press frame f${fr.f} should have one burst from the event at (${fr.pos}); got ${fmt(l)}`); }
      else if (fr.kind === 'move') sec.ok(l.length === 1 && !l[0].idle && l[0].x === fr.pos[0] && l[0].y === fr.pos[1], () => `${name}: the E_MOVE frame f${fr.f} should have one burst from the event at (${fr.pos}); got ${fmt(l)}`);
      else if (fr.kind === 'quiet') sec.ok(l.length === 1 && l[0].idle && l[0].x === fr.pos[0] && l[0].y === fr.pos[1], () => `${name}: the quiet frame f${fr.f} (button held, no event) should have one idle burst at (${fr.pos}); got ${fmt(l)}`);
      else if (fr.kind === 'up') { held = false; sec.ok(l.length === 0, () => `${name}: the release frame f${fr.f} has an event and no burst; got ${fmt(l)}`); }
    }
    const total = b.length, want = frames.filter((x) => x.kind !== 'up').length;
    sec.ok(total === want, () => `${name}: ${total} bursts in all, the contract gives ${want} (one for each frame with the button held); the machine's: ${fmt(b)}`);
    const after = frames.length ? b.filter((x) => x.f > frames[frames.length - 1].f) : [];
    sec.ok(after.length === 0, () => `${name}: ${after.length} burst(s) after the release; ${fmt(after)}`);
    return b;
  }
  // A: press at P0, a move to P1, 3 quiet frames, release
  run('A press, move, 3 quiet, release', [300, 100], ['down', ['m', 310, 100], 'quiet', 'quiet', 'quiet', 'up']);
  // B: press, 2 quiet frames, release
  run('B press, 2 quiet, release', [300, 120], ['down', 'quiet', 'quiet', 'up']);
  // C: moves on every frame (6 frames), no quiet frame
  run('C a move every frame', [200, 60], ['down', ['m', 206, 60], ['m', 212, 62], ['m', 206, 64], ['m', 200, 66], ['m', 206, 68], ['m', 212, 70], 'up']);
  // D: an alternating mix of moves and quiet frames, then a long hold
  run('D moves and quiet frames mixed', [220, 90], ['down', 'quiet', ['m', 226, 90], 'quiet', 'quiet', ['m', 232, 94], ['m', 238, 94], 'quiet', 'up']);
  run('E a hold of 30 frames', [250, 140], ['down', ...Array(30).fill('quiet'), 'up']);
  // F: a press, a move of 0 (no change: no event) is a quiet frame; a big jump of 100 pixels is one E_MOVE
  run('F a jump of 100 pixels', [140, 60], ['down', ['m', 240, 60], 'quiet', ['m', 140, 120], 'up']);
  // G: nothing after the release (no bursts without the button)
  {
    env.bursts.length = 0; env.frames_(10);
    sec.ok(env.bursts.length === 0, () => `${env.bursts.length} bursts in 10 frames with the button up`);
  }
  sec.end(`PN_RND ${hex(rd16(m, S.PN_RND))}`);
}

// ===========================================================================================================================================
// 12. P2b-1 (PAINT 17): the Options menu, the Line and the Rectangle tools
function g12() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('12 P2b-1 (PAINT 17): the Options menu (Filled / Hollow shapes, PN_FILL, MB_ENABLE), the Line tool (XOR band, SET line at the release, box = the two endpoints, undo, clipping), the Rectangle tool hollow and filled (normalised corners, w = |dx| + 1, the filled inside by REPLACE of the pattern, then the frame), every pattern');
  const after = (ctx, o = {}) => { settleCheck(env, sec, ctx, o); if (st.undoOn) undoAreaOk(env, sec, ctx); };
  const tool = (t) => { Q.chooseTool(env, t); st.chooseTool(t); };
  const pat = (p) => { Q.choosePattern(env, p); st.choosePat(p); };
  const optionsMenu = (ii, o) => Q.menuPick(env, 2, ii, o);
  const lay = P.layoutOf(P.MENUS);
  // the screen with the Options menu open (and the highlight on item hl), against the model
  const openCheck = (ctx, hl) => {
    const g = P.renderScreen(st, { dialog: (gg) => openLook(gg, P.MENUS, lay, P.menuEn(st.undoOn, st.fill), 2, hl) });
    const d = H.diffDisp(H.readDisp(m), P.toDisp(g), L.pointerMask(m, S, []));
    sec.ok(d === null, () => `${ctx}: the open Options menu (highlight ${hl}): the screen: ${d}`);
  };
  const setFill = (on) => {                                   // by the menu, through the open dropdown check
    if (st.fill === !!on) return;
    const b = lay.boxes[2], d = lay.drops[2], item = on ? 0 : 1;
    L.moveTo(env, b.x + (b.w >> 1), 3); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    openCheck(`Options opened (${st.fill ? 'filled' : 'hollow'} mode)`, -1);
    L.moveTo(env, d.x + 12, 9 + 10 * item + 5); env.frames_(2);
    openCheck(`Options, the pointer on item ${item}`, item);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(10);
    st.setFill(on);
    settleCheck(env, sec, `Options > ${on ? 'Filled' : 'Hollow'} shapes`);
  };
  // -- 1. the Options menu itself
  sec.ok(!st.fill && Q.menuWord(env, 2) === 0b10 && m.ram[S.PN_FILL] === 0, () => `at launch: PN_FILL ${m.ram[S.PN_FILL]}, the Options word ${Q.menuWord(env, 2).toString(2)} (want 0, 10: Filled shapes enabled, Hollow shapes disabled)`);
  settleCheck(env, sec, 'the bar "File Edit Options" as launched');
  setFill(true);
  sec.ok(m.ram[S.PN_FILL] === 1 && (Q.menuWord(env, 2) & 3) === 0b01, () => `Filled shapes: PN_FILL ${m.ram[S.PN_FILL]}, word ${(Q.menuWord(env, 2) & 3).toString(2)}, want 1, 01`);
  optionsMenu(0); settleCheck(env, sec, 'Options > Filled shapes again (the item is disabled): nothing changes');
  setFill(false);
  sec.ok(m.ram[S.PN_FILL] === 0 && (Q.menuWord(env, 2) & 3) === 0b10, () => `Hollow shapes: PN_FILL ${m.ram[S.PN_FILL]}, word ${(Q.menuWord(env, 2) & 3).toString(2)}, want 0, 10`);
  optionsMenu(1); settleCheck(env, sec, 'Options > Hollow shapes again (the item is disabled): nothing changes');
  setFill(true); setFill(true); setFill(false); setFill(false); setFill(true); setFill(false);
  sec.ok(!m.ram[S.PN_DIRTY] && !m.ram[S.PN_UNDO], 'the Options menu changed neither PN_DIRTY nor PN_UNDO');
  // -- the tools' margins and anchors
  const shapePads = (ctx) => { const [pc, pr] = P.PADS[st.tool]; sec.ok(m.ram[S.PN_PADC] === pc && m.ram[S.PN_PADR] === pr, () => `${ctx}: PN_PADC / PN_PADR ${m.ram[S.PN_PADC]}, ${m.ram[S.PN_PADR]}; the margins of tool ${st.tool} are ${pc}, ${pr}`); };
  // a stroke with the band checked after every pointer position (the display is the picture XOR the band, the copy still the state before the stroke), then the release: the model, the display, the copy, the box, the undo area
  const shape = (ctx, pts, o = {}) => {
    const before = st.clone(), t = st.tool;
    // a band longer than about 100 pixels takes more than a frame (erase the old band, draw the new): quiet frames follow each point, so that the check sees the finished band
    const far = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x - pts[0][0]), Math.abs(y - pts[0][1])))) > 90;
    const r = Q.stroke(env, pts, { gap: far ? 3 : 0, ...o, mid: o.noMid ? undefined : (i, seen) => {
      if (i === 0) { const ax = rd16(m, S.PN_AX), ay = m.ram[S.PN_AY]; sec.ok(ax === seen[0][0] && ay === seen[0][1], () => `${ctx}: the anchor PN_AX, PN_AY = (${ax}, ${ay}), the press was at (${seen[0]})`); }
      Q.check(env, sec, `${ctx}: mid-stroke after point ${i}`, { st: st.bandModel(), copyOf: before, extra: i > 0 ? [seen[i - 1]] : [] });   // the previous pointer position is masked too (see the report: the pointer image can linger one frame outside the picture)
    } });
    settleCheck(env, sec, ctx, o.check || {});
    shapePads(ctx);
    if (st.undoOn) undoAreaOk(env, sec, ctx);
    sec.ok(r.box === null || (r.box.nc * r.box.nr <= 2048) === st.undoOn, () => `${ctx}: box ${JSON.stringify(r.box)} (${r.box && r.box.nc * r.box.nr} bytes): the model's undo ${st.undoOn}`);
    return r;
  };
  const noise2 = noise;
  const undoRedo = (ctx) => {
    if (!st.undoOn) return;
    editMenu(env, 0); st.undo(); after(`Undo of ${ctx}`);
    editMenu(env, 0); st.undo(); after(`Undo again (redo) of ${ctx}`);
    editMenu(env, 0); st.undo(); after(`Undo, a third time, of ${ctx}`);
    editMenu(env, 0); st.undo(); after(`Undo, a fourth time, of ${ctx}`);
  };
  // -- 2. the Line
  tool(6);
  settleCheck(env, sec, 'the Line chosen');
  { const r = shape('a press and release at one point (200, 80)', [[200, 80]], { noMid: false }); sec.ok(r.began && st.pic.count() === 1 && st.px(72, 48) === 1, () => `the model's one-point line: ${st.pic.count()} pixels`); undoRedo('the one-point line'); }
  const base = [300, 100];
  const dirs = [['right', [60, 0]], ['left', [-60, 0]], ['down', [0, 50]], ['up', [0, -50]], ['down-right 45', [40, 40]], ['up-left 45', [-40, -40]], ['down-left 45', [-40, 40]], ['up-right 45', [40, -40]],
    ['shallow 3:1 down-right', [60, 20]], ['shallow 3:1 up-left', [-60, -20]], ['steep 1:3 down-left', [-20, 60]], ['steep 1:3 up-right', [20, -60]], ['one pixel right', [1, 0]], ['one pixel down', [0, 1]], ['one pixel up-left', [-1, -1]], ['two pixels', [2, 1]]];
  for (const [name, [dx, dy]] of dirs) { shape(`a line ${name}: the band follows, one move, then the release`, [base, [base[0] + dx, base[1] + dy]]); undoRedo(`the line ${name}`); }
  shape('a line drawn by many moves (the band is erased and redrawn each time), ending near the anchor', [[250, 60], [270, 80], [300, 70], [320, 120], [260, 130], [255, 62]]);
  shape('a line drawn by many moves, ending far away', [[250, 60], [252, 61], [260, 90], [255, 61], [380, 140]]);
  shape('a line whose last move comes back to the anchor (release on the anchor: one pixel)', [[330, 90], [380, 120], [330, 90]]);
  shape('the line is clipped: a drag that leaves the picture on the right', [[400, 100], [440, 110], [470, 120], [490, 140]]);
  shape('a drag that leaves on the left (the tool box, the desk)', [[160, 100], [128, 100], [100, 110], [60, 130]]);
  shape('a drag that leaves at the top (the canvas frame, the title bar, the menu bar)', [[300, 60], [300, 33], [300, 20], [310, 4]]);
  shape('a drag that leaves at the bottom (the status line)', [[300, 150], [300, 175], [300, 184], [320, 188]]);
  shape('a drag out of a corner of the picture', [[140, 45], [128, 32], [100, 20]]);
  shape('a line from a picture corner to the opposite corner', [[128, 32], [447, 175]]);
  shape('a line along the picture\'s top edge', [[128, 32], [447, 32]]);
  shape('a line along the picture\'s bottom edge and right edge', [[128, 175], [447, 175], [447, 32]]);
  // on a noisy picture: the XOR band must leave the picture exactly as it was (erased)
  Q.install(env, noise2(51, 0.5));
  settleCheck(env, sec, 'a noisy picture installed (the Line chosen)');
  for (let i = 0; i < 6; i++) shape(`line on noise ${i + 1}`, rndWalk(rng.int(2, 6), rng.int(140, 440), rng.int(40, 170), rng.int(5, 80), [129, 33], [446, 174]), { check: {} });
  for (let i = 0; i < NRAND; i++) { shape(`random line ${i + 1}`, rndWalk(rng.int(1, 8), rng.int(135, 440), rng.int(40, 170), rng.int(1, 120), [100, 20], [490, 186]), { noMid: i % 2 === 1 }); if (i % 3 === 0) undoRedo(`random line ${i + 1}`); }
  // presses that start no stroke: the status line, the tool box, the desk; the drag over the picture draws nothing
  for (const [what, [x, y]] of [['the tool box (80, 60)', [80, 60]], ['the canvas frame (126, 100)', [126, 100]], ['the desk (490, 100)', [490, 100]], ['the status line (200, 184)', [200, 184]]]) {
    const was = st.clone(), r = Q.stroke(env, [[x, y], [200, 100], [250, 120], [300, 100]], { settle: 12 });
    sec.ok(!r.began, `the Line: ${what}: no stroke`);
    if (what.startsWith('the tool box')) tool(6);
    settleCheck(env, sec, `the Line: a press on ${what}, dragged across the picture, draws nothing`);
    sec.ok(eq(Array.from(st.copyBytes()), Array.from(was.copyBytes())), 'the picture is unchanged');
  }
  // -- 3. the Rectangle, hollow
  tool(7);
  settleCheck(env, sec, 'the Rectangle chosen (hollow)');
  Q.install(env, noise2(52, 0.5));
  settleCheck(env, sec, 'a noisy picture installed (the Rectangle chosen)');
  const rb = [300, 100];
  const sizes = [[0, 0], [1, 1], [2, 2], [3, 3], [1, 0], [0, 1], [2, 0], [0, 2], [1, 4], [4, 1], [99, 2], [2, 99], [60, 40], [7, 7], [8, 8], [9, 9], [15, 15], [16, 16]];
  const signs = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [w, h] of sizes) for (const [sx, sy] of signs) {
    if ((w === 0 && sx < 0) || (h === 0 && sy < 0)) continue;
    shape(`hollow rectangle dragged ${sx > 0 ? 'right' : 'left'} ${w} and ${sy > 0 ? 'down' : 'up'} ${h} (a ${w + 1} x ${h + 1} frame)`, [rb, [rb[0] + sx * w, rb[1] + sy * h]], { noMid: (w + h) % 3 !== 0 });
    if (w + h <= 4) undoRedo(`the ${w + 1} x ${h + 1} rectangle`);
  }
  shape('a hollow rectangle with many moves (the band changes shape each time)', [[250, 60], [300, 90], [260, 120], [200, 80], [240, 100], [320, 130]]);
  shape('a hollow rectangle whose last move comes back to the anchor (1 x 1)', [[330, 90], [380, 120], [330, 90]]);
  shape('a hollow rectangle leaving the picture on the right', [[400, 100], [440, 110], [480, 140]]);
  shape('a hollow rectangle leaving on the left and the top', [[160, 60], [100, 40], [90, 10]]);
  shape('a hollow rectangle leaving at the bottom and the right (a big one)', [[200, 100], [480, 186]]);
  shape('a hollow rectangle from outside the picture\'s corner into it', [[128, 32], [447, 175]]);
  shape('a hollow rectangle over the picture\'s whole edge', [[128, 32], [447, 32], [447, 175]]);
  for (let i = 0; i < NRAND; i++) { shape(`random hollow rectangle ${i + 1}`, rndWalk(rng.int(1, 6), rng.int(135, 440), rng.int(40, 170), rng.int(1, 150), [100, 20], [490, 186]), { noMid: i % 2 === 1 }); if (i % 3 === 0) undoRedo(`random hollow rectangle ${i + 1}`); }
  // -- 4. the Rectangle, filled: the inside is the pattern (REPLACE), then the frame; every pattern
  setFill(true);
  tool(7);
  for (let p = 0; p < 16; p++) {
    pat(p);
    shape(`filled rectangle, pattern ${p}, 25 x 13, dragged down-right`, [[150 + 20 * (p & 3), 50 + 14 * (p >> 2)], [174 + 20 * (p & 3), 62 + 14 * (p >> 2)]], { noMid: p % 4 !== 0 });
    if (p % 5 === 0) undoRedo(`the filled rectangle, pattern ${p}`);
  }
  for (const p of [0, 2, 15, 6, 11]) {
    pat(p);
    for (const [w, h] of [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [1, 5], [5, 1], [2, 40], [40, 2], [3, 40], [40, 3], [31, 15]]) for (const [sx, sy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if ((w === 0 && sx < 0) || (h === 0 && sy < 0)) continue;
      shape(`filled rectangle, pattern ${p}, ${w + 1} x ${h + 1}, dragged ${sx > 0 ? 'right' : 'left'} ${sy > 0 ? 'down' : 'up'}`, [[300, 100], [300 + sx * w, 100 + sy * h]], { noMid: true });
    }
  }
  pat(2);
  shape('a filled rectangle with many moves (the band is the frame only)', [[250, 60], [300, 90], [260, 120], [200, 80], [240, 100], [320, 130]]);
  shape('a filled rectangle leaving the picture on the right', [[400, 100], [440, 110], [480, 140]]);
  shape('a filled rectangle leaving on the left and the top', [[160, 60], [100, 40], [90, 10]]);
  shape('a filled rectangle, the whole picture', [[128, 32], [447, 175]], { check: { noBox: true } });
  { const was = st.clone(); sec.ok(!st.undoOn && st.status === 'Too big to undo', () => `the whole-picture rectangle: Undo ${st.undoOn}, status "${st.status}"`); void was; }
  pat(13);
  shape('a filled rectangle 200 x 100 on the noise', [[170, 50], [369, 149]], { noMid: true, check: { noBox: true } });
  for (let i = 0; i < NRAND; i++) { pat(rng.int(0, 15)); shape(`random filled rectangle ${i + 1} (pattern ${st.pat})`, rndWalk(rng.int(1, 6), rng.int(135, 440), rng.int(40, 170), rng.int(1, 150), [100, 20], [490, 186]), { noMid: i % 2 === 1 }); if (i % 3 === 0) undoRedo(`random filled rectangle ${i + 1}`); }
  // the Line ignores Filled (and the pattern); the mode is kept across tool choices
  tool(6);
  shape('the Line with Filled shapes and a pattern chosen: a plain line', [[200, 60], [260, 100]]);
  tool(7); setFill(false);
  shape('back to hollow: a frame only', [[200, 60], [260, 100]]);
  // the other tools still draw as before
  pat(0); tool(1); shape('the pencil after the shapes', [[300, 60], [340, 90]], { noMid: true });
  tool(3); shape('the eraser after the shapes', [[300, 70], [330, 80]], { noMid: true });
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}`);
}

// ===========================================================================================================================================
// 13. P2b-2 (PAINT 18): the Rounded rectangle (tool 8, radii 8 x 4) and the Oval (tool 9, radii 255 x 100) -- the XOR band is the bounding rectangle (G_FRAME) exactly as for the Rectangle; the release
// draws G_RRECT in SET with the mode PN_FILL (hollow: the outline; filled: the inside by REPLACE of the chosen pattern, then the outline); the stroke box is the two corners (pad 0); the commit as for the other shapes
function g13() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('13 P2b-2 (PAINT 18): the Rounded rectangle (8 x 4) and the Oval (255 x 100): the XOR band is the bounding rectangle, the release draws G_RRECT in SET with the mode PN_FILL (hollow, and filled with every pattern), the box is the two corners, commit and undo as for the Rectangle; four drag directions, tiny, thin and big shapes, clipping, noise');
  const after = (ctx, o = {}) => { settleCheck(env, sec, ctx, o); if (st.undoOn) undoAreaOk(env, sec, ctx); };
  const tool = (t) => { Q.chooseTool(env, t); st.chooseTool(t); };
  const pat = (p) => { Q.choosePattern(env, p); st.choosePat(p); };
  const setFill = (on) => {
    if (st.fill === !!on) return;
    Q.menuPick(env, 2, on ? 0 : 1); st.setFill(on);
    settleCheck(env, sec, `Options > ${on ? 'Filled' : 'Hollow'} shapes`);
  };
  const shapePads = (ctx) => { const [pc, pr] = P.PADS[st.tool]; sec.ok(m.ram[S.PN_PADC] === pc && m.ram[S.PN_PADR] === pr, () => `${ctx}: PN_PADC / PN_PADR ${m.ram[S.PN_PADC]}, ${m.ram[S.PN_PADR]}; the margins of tool ${st.tool} are ${pc}, ${pr}`); };
  const shape = (ctx, pts, o = {}) => {
    const before = st.clone();
    const far = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x - pts[0][0]), Math.abs(y - pts[0][1])))) > 90;
    const r = Q.stroke(env, pts, { gap: far ? 3 : 0, settle: 45, ...o, mid: o.noMid ? undefined : (i, seen) => {
      if (i === 0) { const ax = rd16(m, S.PN_AX), ay = m.ram[S.PN_AY]; sec.ok(ax === seen[0][0] && ay === seen[0][1], () => `${ctx}: the anchor PN_AX, PN_AY = (${ax}, ${ay}), the press was at (${seen[0]})`); }
      Q.check(env, sec, `${ctx}: mid-stroke after point ${i} (the band is the bounding rectangle in XOR)`, { st: st.bandModel(), copyOf: before, extra: i > 0 ? [seen[i - 1]] : [] });
    } });
    settleCheck(env, sec, ctx, o.check || {});
    shapePads(ctx);
    if (st.undoOn) undoAreaOk(env, sec, ctx);
    sec.ok(r.box === null || (r.box.nc * r.box.nr <= 2048) === st.undoOn, () => `${ctx}: box ${JSON.stringify(r.box)} (${r.box && r.box.nc * r.box.nr} bytes): the model's undo ${st.undoOn}`);
    return r;
  };
  const undoRedo = (ctx) => {
    if (!st.undoOn) return;
    editMenu(env, 0); st.undo(); after(`Undo of ${ctx}`);
    editMenu(env, 0); st.undo(); after(`Undo again (redo) of ${ctx}`);
  };
  const NAMES = { 8: 'rounded rectangle', 9: 'oval' };
  const rb = [300, 100];
  const signs = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  // the model's own band is the bounding rectangle: the first checks look at the model's pieces (the contract's text)
  {
    const c = st.clone(); st.chooseTool(9);
    const g = new P.Gfx6Model(); g.setClip(P.PIC.x, P.PIC.y, P.PIC.w, P.PIC.h);
    st.drawShape(g, P.OP_XOR, 200, 60, 239, 89); const f = new P.Gfx6Model(); f.setClip(P.PIC.x, P.PIC.y, P.PIC.w, P.PIC.h); f.setOp(P.OP_XOR); f.frame(200, 60, 40, 30);
    sec.ok(g.px.every((v, i) => v === f.px[i]), 'model: the band of the Oval is the bounding rectangle in XOR');
    st.chooseTool(c.tool);
  }
  for (const t of [8, 9]) {
    const nm = NAMES[t];
    setFill(false);
    tool(t);
    settleCheck(env, sec, `the ${nm} chosen (hollow): the status line shows "${P.TOOLNAMES[t]}"`);
    Q.install(env, noise(60 + t, 0.5));
    settleCheck(env, sec, `a noisy picture installed (the ${nm} chosen)`);
    sec.ok(m.ram[S.PN_TOOL] === t, () => `PN_TOOL ${m.ram[S.PN_TOOL]}, want ${t}`);
    // -- hollow
    { const r = shape(`${nm}: a press and release at one point (200, 80): 1 x 1`, [[200, 80]]); sec.ok(r.began, `${nm}: the press started a stroke`); undoRedo(`the one-point ${nm}`); }
    const sizes = [[0, 0], [1, 1], [2, 2], [3, 3], [1, 0], [0, 1], [2, 0], [0, 2], [1, 4], [4, 1], [99, 2], [2, 99], [60, 40], [7, 7], [8, 8], [9, 9], [15, 15], [16, 16], [30, 20], [100, 50]];
    for (const [w, h] of sizes) for (const [sx, sy] of signs) {
      if ((w === 0 && sx < 0) || (h === 0 && sy < 0)) continue;
      shape(`hollow ${nm} dragged ${sx > 0 ? 'right' : 'left'} ${w} and ${sy > 0 ? 'down' : 'up'} ${h} (a ${w + 1} x ${h + 1} shape)`, [rb, [rb[0] + sx * w, rb[1] + sy * h]], { noMid: (w + h) % 4 !== 0 });
      if (w + h <= 4) undoRedo(`the ${w + 1} x ${h + 1} hollow ${nm}`);
    }
    shape(`hollow ${nm} with many moves (the band is the bounding rectangle each time)`, [[250, 60], [300, 90], [260, 120], [200, 80], [240, 100], [320, 130]]);
    shape(`hollow ${nm} whose last move comes back to the anchor (1 x 1)`, [[330, 90], [380, 120], [330, 90]]);
    shape(`hollow ${nm} leaving the picture on the right`, [[400, 100], [440, 110], [480, 140]]);
    shape(`hollow ${nm} leaving on the left and the top`, [[160, 60], [100, 40], [90, 10]]);
    shape(`hollow ${nm} leaving at the bottom and the right (a big one)`, [[200, 100], [480, 186]]);
    shape(`hollow ${nm} from the picture's corner to the opposite corner (the whole picture)`, [[128, 32], [447, 175]], { check: { noBox: true } });
    sec.ok(!st.undoOn && st.status === 'Too big to undo', () => `the whole-picture hollow ${nm}: Undo ${st.undoOn}, status "${st.status}"`);
    shape(`hollow ${nm} over the picture's top edge and right edge`, [[128, 32], [447, 32], [447, 175]]);
    for (let i = 0; i < NRAND; i++) { shape(`random hollow ${nm} ${i + 1}`, rndWalk(rng.int(1, 6), rng.int(135, 440), rng.int(40, 170), rng.int(1, 150), [100, 20], [490, 186]), { noMid: i % 2 === 1 }); if (i % 3 === 0) undoRedo(`random hollow ${nm} ${i + 1}`); }
    // -- filled: the inside is the chosen pattern (REPLACE), then the outline; every pattern
    setFill(true);
    tool(t);
    for (let p = 0; p < 16; p++) {
      pat(p);
      shape(`filled ${nm}, pattern ${p}, 41 x 25, dragged down-right`, [[150 + 20 * (p & 3), 50 + 28 * (p >> 2)], [190 + 20 * (p & 3), 74 + 28 * (p >> 2)]], { noMid: p % 4 !== 0 });
      if (p % 5 === 0) undoRedo(`the filled ${nm}, pattern ${p}`);
    }
    for (const p of [0, 2, 15, 6, 11]) {
      pat(p);
      for (const [w, h] of [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [1, 5], [5, 1], [2, 40], [40, 2], [3, 40], [40, 3], [31, 15]]) for (const [sx, sy] of signs) {
        if ((w === 0 && sx < 0) || (h === 0 && sy < 0)) continue;
        if (p !== 2 && (sx < 0) !== (sy < 0)) continue;           // all four directions for pattern 2; the diagonal pair for the others
        shape(`filled ${nm}, pattern ${p}, ${w + 1} x ${h + 1}, dragged ${sx > 0 ? 'right' : 'left'} ${sy > 0 ? 'down' : 'up'}`, [[300, 100], [300 + sx * w, 100 + sy * h]], { noMid: true });
      }
    }
    pat(2);
    shape(`a filled ${nm} with many moves (the band is the bounding rectangle only)`, [[250, 60], [300, 90], [260, 120], [200, 80], [240, 100], [320, 130]]);
    shape(`a filled ${nm} leaving the picture on the right`, [[400, 100], [440, 110], [480, 140]]);
    shape(`a filled ${nm} leaving on the left and the top`, [[160, 60], [100, 40], [90, 10]]);
    shape(`a filled ${nm}, the whole picture`, [[128, 32], [447, 175]], { check: { noBox: true } });
    sec.ok(!st.undoOn && st.status === 'Too big to undo', () => `the whole-picture filled ${nm}: Undo ${st.undoOn}, status "${st.status}"`);
    pat(13);
    shape(`a filled ${nm} 200 x 100 on the noise`, [[170, 50], [369, 149]], { noMid: true, check: { noBox: true } });
    for (let i = 0; i < NRAND; i++) { pat(rng.int(0, 15)); shape(`random filled ${nm} ${i + 1} (pattern ${st.pat})`, rndWalk(rng.int(1, 6), rng.int(135, 440), rng.int(40, 170), rng.int(1, 150), [100, 20], [490, 186]), { noMid: i % 2 === 1 }); if (i % 3 === 0) undoRedo(`random filled ${nm} ${i + 1}`); }
    // presses that start no stroke: the tool box, the desk
    for (const [what, [x, y]] of [['the tool box (80, 60)', [80, 60]], ['the desk (490, 100)', [490, 100]]]) {
      const was = st.clone(), r = Q.stroke(env, [[x, y], [200, 100], [250, 120], [300, 100]], { settle: 12 });
      sec.ok(!r.began, `the ${nm}: ${what}: no stroke`);
      if (what.startsWith('the tool box')) tool(t);
      settleCheck(env, sec, `the ${nm}: a press on ${what}, dragged across the picture, draws nothing`);
      sec.ok(eq(Array.from(st.copyBytes()), Array.from(was.copyBytes())), 'the picture is unchanged');
    }
    pat(0);
  }
  // the other shape tools still draw as before, and the mode / pattern are kept across tool choices
  setFill(true); pat(5);
  tool(7); shape('the Rectangle after the oval: filled, pattern 5', [[200, 60], [260, 100]]);
  tool(6); shape('the Line after the oval', [[200, 60], [260, 100]]);
  tool(8); shape('back to the Rounded rectangle, still filled with pattern 5', [[200, 60], [260, 100]]);
  setFill(false); pat(0);
  tool(1); shape('the pencil after the shapes', [[300, 60], [340, 90]], { noMid: true });
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}`);
}

// ===========================================================================================================================================
// 9. Bounds and report rows
function g9() {
  const sec = new Sec('9 bounds: stack <= 128 on every path, no DI (V_FRAMES + 1 a frame), the memory watch (BANKING 10.7) clean, no write to the program image outside its variables, the image and its variables end at or below AL_RAM (rows with no bound are reports; PAINT 12\'s own bounds are quoted in their notes)');
  const env = newEnv(), { m, S } = env, st = env.st;
  sec.ok(S.PN_VARS_END <= S.AL_RAM, () => `PN_VARS_END ${hex(S.PN_VARS_END)} is above AL_RAM ${hex(S.AL_RAM)}`);
  sec.note(`Paint: code and image PN_END - PN_START = ${S.PN_END - S.PN_START} bytes, image ${S.PN_IMG_LEN}, variables ${S.PN_VARS_END - S.PN_VARS}; the image ends at ${hex(0xC000 + S.PN_IMG_LEN)}, the variables at ${hex(S.PN_VARS_END)}, AL_RAM ${hex(S.AL_RAM)} (${S.AL_RAM - S.PN_VARS_END} bytes spare)`);
  const idle = Q.busy(env, () => env.frames_(6)).map((p) => p.t1 - p.t0), base = Math.max(...idle);
  sec.note(`an idle frame: ISR entry to HALT ${Math.min(...idle)}-${base} T`);
  const marks = [S.pn_undo, S.pn_commit, S.pn_save, S.pn_open, S.pn_seg].filter(Boolean);
  // a pencil step of 30 pixels: from the E_MOVE (the frame's ISR) to idle
  {
    L.moveTo(env, 200, 80); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(200, 80);
    const ts = [], seg = [];
    for (let i = 1; i <= 8; i++) {
      const dir = i % 2 ? 1 : -1;
      const per = Q.busy(env, () => Q.stepTo(env, 200 + (dir > 0 ? 30 : 0), 80), marks);
      ts.push(Math.max(...per.map((p) => p.t1 - p.t0))); seg.push(...Q.spansFrom(per.ev, S.pn_seg));
      const [x, y] = L.pointerPos(m, S); st.held('move'); st.move(x, y);
    }
    row('pencil step: a 30-pixel segment, ISR entry of the E_MOVE frame to HALT (shielded, clipped)', Math.max(...ts), null, `idle frame ${base}; ${ts.join(', ')}`, 58000);
    if (seg.length) row('pencil step: pn_seg (the segment routine) entry to HALT', Math.max(...seg), null, `${seg.join(', ')}`);
    m.mouse.buttons = L.MOUSE_UP; env.frame(); st.held('up'); st.release(); env.frames_(14);
  }
  // P2a (PAINT 16): a brush step (30 pixels, the large round brush, REPLACE with the 50 % checker), a spray burst (an E_MOVE frame and an idle frame)
  {
    Q.chooseTool(env, 2); st.chooseTool(2); Q.chooseBrush(env, 1); st.chooseBrush(1); Q.choosePattern(env, 2); st.choosePat(2);
    L.moveTo(env, 200, 80); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(200, 80);
    // each step is followed by 6 quiet frames, so that every busy period (ISR entry to HALT) closes inside the measured call; the longest period is the step's work
    const ts = [];
    for (let i = 1; i <= 8; i++) {
      const dir = i % 2 ? 1 : -1;
      const per = Q.busy(env, () => { Q.stepTo(env, 200 + (dir > 0 ? 30 : 0), 80); env.frames_(6); });
      ts.push(Math.max(...per.map((p) => p.t1 - p.t0)));
      const [x, y] = L.pointerPos(m, S); st.held('move'); st.move(x, y);
    }
    row('brush step: a 30-pixel segment, large round brush, pattern 2 (15 stamps of 3 rectangles), the E_MOVE\'s ISR entry to HALT (shielded, clipped)', Math.max(...ts), null, `idle frame ${base}; ${ts.join(', ')}`);
    m.mouse.buttons = L.MOUSE_UP; env.frame(); st.held('up'); st.release(); env.frames_(14);
    settleCheck(env, sec, 'after the brush steps', { adoptStatus: true });
    Q.chooseTool(env, 4); st.chooseTool(4);
    L.moveTo(env, 300, 100); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(300, 100);
    {
      // 8 frames with a 6-pixel step and 8 frames with the pointer still (pn_idle): every frame bursts once; the periods are ISR entry to HALT
      const durs = [];
      const per = Q.busy(env, () => {
        for (let i = 1; i <= 8; i++) { Q.stepTo(env, 300 + (i % 2 ? 6 : 0), 100); const [x, y] = L.pointerPos(m, S); st.held('move'); st.move(x, y); }
        for (let i = 0; i < 8; i++) { env.frame(); st.held('still'); }
        env.frames_(2); st.held('still'); st.held('still');
      });
      for (const p of per) durs.push(p.t1 - p.t0);
      row('spray burst (12 candidates, about 8 drawn as 1 x 1 patterns): the longest busy period over 16 frames of bursts (E_MOVE and pn_idle), ISR entry to HALT', Math.max(...durs), null, `idle frame ${base}; ${durs.join(', ')}`);
    }
    m.mouse.buttons = L.MOUSE_UP; env.frame(); st.held('up'); st.release(); env.frames_(14); st.applyBursts(env.bursts.splice(0));
    settleCheck(env, sec, 'after the spray bursts', { adoptStatus: true });
    Q.chooseTool(env, 1); st.chooseTool(1); Q.choosePattern(env, 0); st.choosePat(0); Q.chooseBrush(env, 1); st.chooseBrush(1);
    settleCheck(env, sec, 'Pencil, pattern 0 and brush 1 chosen again', { adoptStatus: true });
  }
  // P2b-1 (PAINT 17): a band step of the Line and of the Rectangle (the old band erased, the new one drawn in XOR), and the release of a filled 200 x 100 rectangle
  {
    const bandRow = (t, name, alt) => {
      Q.chooseTool(env, t); st.chooseTool(t);
      L.moveTo(env, 200, 80); env.frames_(2);
      m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(200, 80);
      const ts = [], pr = [];
      for (let i = 1; i <= 8; i++) {
        const to = alt[i % 2];
        const per = Q.busy(env, () => { Q.stepTo(env, to[0], to[1]); env.frames_(6); });
        ts.push(Math.max(...per.map((p) => p.t1 - p.t0)));
        const [x, y] = L.pointerPos(m, S); st.move(x, y);
      }
      row(`${name}: a band step (the old band erased, the new one drawn in XOR), the E_MOVE's ISR entry to HALT`, Math.max(...ts), null, `idle frame ${base}; ${ts.join(', ')}`);
      m.mouse.buttons = L.MOUSE_UP; env.frame(); st.release(); env.frames_(14);
      settleCheck(env, sec, `after the ${name} band steps`, { adoptStatus: true });
    };
    bandRow(6, 'line band step, 60 x 30 and 90 x 45 (about 60 and 90 pixels)', [[260, 110], [290, 125]]);
    bandRow(7, 'rectangle band step, 61 x 31 and 91 x 46 (hollow)', [[260, 110], [290, 125]]);
    bandRow(7, 'rectangle band step, about 200 x 100 (hollow)', [[399, 179], [398, 178]]);
    // the release of a filled 200 x 100 rectangle (pattern 2): the band erased, the inside by REPLACE, the frame, the commit
    Q.menuPick(env, 2, 0); st.setFill(true); Q.choosePattern(env, 2); st.choosePat(2);
    Q.chooseTool(env, 7); st.chooseTool(7);
    L.moveTo(env, 170, 50); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(170, 50);
    for (const p of Q.expand([[170, 50], [369, 149]]).slice(1)) { const [x, y] = Q.stepTo(env, p[0], p[1]); st.move(x, y); env.frames_(6); }
    let rbox;
    const per = Q.busy(env, () => { m.mouse.buttons = L.MOUSE_UP; env.frame(); rbox = st.release(); env.frames_(10); }, [S.pn_shapedone, S.pn_commit].filter(Boolean));
    const sd = S.pn_shapedone ? Q.spansFrom(per.ev, S.pn_shapedone) : [], cm = Q.spansFrom(per.ev, S.pn_commit);
    row('release of a filled 200 x 100 rectangle (pattern 2): the release frame ISR entry to HALT (band erased, inside filled, frame, commit)', Math.max(...per.map((p) => p.t1 - p.t0)), null, `idle frame ${base}; pn_shapedone entry to HALT ${sd.join(', ') || 'n/a'}; pn_commit entry to HALT ${cm.join(', ')}; box ${rbox.nc} x ${rbox.nr}; busy periods ${per.map((p) => p.t1 - p.t0).filter((d) => d > base + 200).join(', ')}`);
    settleCheck(env, sec, 'after the filled 200 x 100 rectangle', { adoptStatus: true });
    Q.menuPick(env, 2, 1); st.setFill(false); Q.choosePattern(env, 0); st.choosePat(0);
    Q.chooseTool(env, 1); st.chooseTool(1);
    settleCheck(env, sec, 'Pencil, pattern 0 and hollow shapes chosen again', { adoptStatus: true });
  }
  // P2b-2 (PAINT 18): the release of the whole-picture (320 x 144) Oval, hollow and filled (pattern 2), and of the Rounded rectangle (8 x 4), the band erased, G_RRECT, the commit.  Reported (the draw is G_RRECT's 841 k / 1,466 k T).
  {
    const relRow = (label, t, fill, p, from, to) => {
      Q.menuPick(env, 2, fill ? 0 : 1); st.setFill(fill); Q.choosePattern(env, p); st.choosePat(p);
      Q.chooseTool(env, t); st.chooseTool(t);
      L.moveTo(env, from[0], from[1]); env.frames_(2);
      m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(...L.pointerPos(m, S));
      for (const q of Q.expand([from, to]).slice(1)) { const [x, y] = Q.stepTo(env, q[0], q[1]); st.move(x, y); env.frames_(6); }
      let rbox;
      const lost0 = env.vf.bad;
      const per = Q.busy(env, () => { m.mouse.buttons = L.MOUSE_UP; env.frame(); rbox = st.release(); env.frames_(60); }, [S.pn_shapedone, S.pn_commit].filter(Boolean));
      const sd = S.pn_shapedone ? Q.spansFrom(per.ev, S.pn_shapedone) : [], cm = Q.spansFrom(per.ev, S.pn_commit);
      row(`release of ${label}: the release frame ISR entry to HALT (band erased, G_RRECT, commit)`, Math.max(...per.map((p2) => p2.t1 - p2.t0)), null, `idle frame ${base}; pn_shapedone entry to HALT ${sd.join(', ') || 'n/a'}; pn_commit entry to HALT ${cm.join(', ')}; box ${rbox.nc} x ${rbox.nr}; busy periods ${per.map((p2) => p2.t1 - p2.t0).filter((d) => d > base + 200).join(', ')}; frames lost in the release ${env.vf.bad - lost0}`);
      settleCheck(env, sec, `after ${label}`, { adoptStatus: true, noBox: rbox.nc * rbox.nr > 2048 });
    };
    relRow('a hollow oval 320 x 144 (the whole picture)', 9, false, 2, [128, 32], [447, 175]);
    relRow('a filled oval 320 x 144 (the whole picture, pattern 2)', 9, true, 2, [128, 32], [447, 175]);
    relRow('a filled oval 200 x 100 (pattern 2)', 9, true, 2, [170, 50], [369, 149]);
    relRow('a hollow rounded rectangle 320 x 144 (8 x 4)', 8, false, 2, [128, 32], [447, 175]);
    relRow('a filled rounded rectangle 320 x 144 (8 x 4, pattern 2)', 8, true, 2, [128, 32], [447, 175]);
    Q.menuPick(env, 2, 1); st.setFill(false); Q.choosePattern(env, 0); st.choosePat(0);
    Q.chooseTool(env, 1); st.chooseTool(1);
    settleCheck(env, sec, 'Pencil, pattern 0 and hollow shapes chosen again (after the oval releases)', { adoptStatus: true });
  }
  // the commit (release to idle): small and large box
  const commit = (pts) => {
    L.moveTo(env, pts[0][0], pts[0][1]); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frame(); st.press(...L.pointerPos(m, S));
    for (const p of Q.expand(pts).slice(1)) { const [x, y] = Q.stepTo(env, p[0], p[1]); st.move(x, y); }
    let box;
    const per = Q.busy(env, () => { m.mouse.buttons = L.MOUSE_UP; env.frame(); box = st.release(); env.frames_(10); }, marks);
    const cs = Q.spansFrom(per.ev, S.pn_commit);
    return { box, commit: cs[0], first: per[0].t1 - per[0].t0 };
  };
  {
    const a = commit([[200, 100]]);
    row(`commit, a single click (box ${a.box.nc} x ${a.box.nr}): pn_commit entry to HALT`, a.commit, null, `release frame ISR to HALT ${a.first}`, 260000);
    settleCheck(env, sec, 'after the small commit', { adoptStatus: true });
    const b = commit([[152, 60], [384, 115]]);
    row(`commit, a ${b.box.nc} x ${b.box.nr} box (${b.box.nc * b.box.nr} bytes): pn_commit entry to HALT`, b.commit, null, `release frame ISR to HALT ${b.first}`, 260000);
    settleCheck(env, sec, 'after the large commit', { adoptStatus: true });
    const c = commit([[140, 45], [440, 45], [440, 170], [140, 170]]);
    row(`commit, a too-big box (${c.box.nc} x ${c.box.nr}): pn_commit entry to HALT`, c.commit, null, `release frame ISR to HALT ${c.first}`, 260000);
    settleCheck(env, sec, 'after the too-big commit', { adoptStatus: true, noBox: true });
  }
  // Undo of a ~2,000-byte box
  {
    Q.install(env, noise(41, 0.5));
    const rr = Q.stroke(env, [[152, 60], [384, 122]], {});
    settleCheck(env, sec, 'the stroke for the Undo timing', { adoptStatus: true });
    sec.ok(st.undoOn, () => `box ${JSON.stringify(rr.box)} for Undo fits`);
    const bytes = rr.box.nc * rr.box.nr;
    const per = Q.busy(env, () => { editMenu(env, 0, { settle: 0 }); env.frames_(14); }, marks);
    st.undo();
    const u = Q.spansFrom(per.ev, S.pn_undo);
    row(`Undo of a ${rr.box.nc} x ${rr.box.nr} box (${bytes} bytes): pn_undo entry to HALT`, u[0], null, `the busy periods of the whole menu action: ${per.map((p) => p.t1 - p.t0).filter((d) => d > base + 200).join(', ')}`, 265442);
    settleCheck(env, sec, 'after the timed Undo', { adoptStatus: true });
  }
  // Save and Open of the whole picture
  {
    const f = openSaveDialog(env, sec, 'Save for timing');
    Q.fieldDelete(env, f, f.buf.length); Q.fieldType(env, f, 'timing');
    const per = Q.busy(env, () => { L.typeCode(env, 13, 3, 0); env.frames_(60); }, marks);
    const sv = Q.spansFrom(per.ev, S.pn_save);
    row('Save of the whole picture (5,771 bytes, 145 writes): pn_save entry to HALT', sv[0], null, `EST 400,000`);
    st.name = 'timing.pbm'; st.dirty = false;
    settleCheck(env, sec, 'after the timed Save');
    const file = pbmOf(noise(42, 0.5));
    fileMenu(env, 1); Q.until(env, () => env.host.picking, 60);
    const per2 = Q.busy(env, () => { env.host.answer('t.pbm', file); env.frames_(60); }, marks);
    row('Open of the whole picture (5,771 bytes): the pick answered to HALT (the busiest ISR-to-HALT period)', Math.max(...per2.map((p) => p.t1 - p.t0)), null, `EST 450,000`);
    st.loadPbm(file); st.name = 't.pbm';
    settleCheck(env, sec, 'after the timed Open', { adoptStatus: true });
  }
  // closing the 256 x 64 question over the canvas: the exposed part redrawn
  {
    st.dirty = true; m.ram[S.PN_DIRTY] = 1;
    fileMenu(env, 0); waitDialog(env, 'ask');
    const per = Q.busy(env, () => { Q.askAnswer(env, 'cancel'); });
    const durs = per.map((p) => p.t1 - p.t0);
    row('closing the 256 x 64 question over the canvas: the busiest ISR-to-HALT period (the exposed part redrawn)', Math.max(...durs), null, `busy periods ${durs.filter((d) => d > base + 200).join(', ')}`);
    settleCheck(env, sec, 'after the question closed', { adoptStatus: true });
  }
  // the redraw of a fully exposed canvas: W_INVAL of the canvas rectangle and W_UPDATE, called directly on a machine of its own (nothing runs on it afterwards)
  {
    const e2 = newEnv(), st2 = e2.st;
    Q.install(e2, noise(43, 0.5));
    const T2 = TKcalls(e2);
    const t1 = T2.inval(126, 30, 324, 148), t2 = T2.update();
    const stk = T2.lastStack();
    row('a fully exposed canvas (W_INVAL of the canvas view, then W_UPDATE): redrawn', t1 + t2, null, `W_INVAL ${t1} + W_UPDATE ${t2}`, 759700);
    for (const [name, x, y, w, h] of [['the pattern palette (55, 112, 66, 50)', 55, 112, 66, 50], ['the brush palette (55, 164, 66, 18)', 55, 164, 66, 18], ['the tool box (55, 28, 66, 82)', 55, 28, 66, 82]]) {
      const a = T2.inval(x, y, w, h), b = T2.update();
      row(`redraw of ${name}: W_INVAL of the view, then W_UPDATE`, a + b, null, `W_INVAL ${a} + W_UPDATE ${b}`);
    }
    row('stack of the direct W_UPDATE call (the redraw, crossings included), bytes below the return address', stk, 128, '');
    const d = H.diffDisp(H.readDisp(e2.m), P.toDisp(P.renderScreen(st2)), L.pointerMask(e2.m, e2.S));
    sec.ok(d === null, () => `after the direct redraw the screen is not the model's: ${d}`);
  }
  // the bounds
  const depth = Math.max(...envs.map((e) => e.stack.depth()));
  const all = envs.map((e) => ({ s: e.stack.depth(), di: e.vf.bad, n: e.vf.checked, w: e.w.n, img: e.img.n }));
  row('stack depth, the highest of every path run in this suite (crossings included)', depth, 128, `per machine: ${all.map((a) => a.s).join(', ')}`);
  row('frames in which V_FRAMES did not advance by 1 (a DI held across a frame), all machines', all.reduce((a, b) => a + b.di, 0), 0, `${all.reduce((a, b) => a + b.n, 0)} frames checked; ${envs.flatMap((e) => e.vfBad).slice(0, 6).join(', ')}`);
  row('memory watch violations (BANKING 10.7), all machines', all.reduce((a, b) => a + b.w, 0), 0, envs.map((e) => (e.w.n ? e.w.summary() : '')).filter(Boolean)[0] || '');
  row('writes to the program image outside Paint\'s variables, all machines', all.reduce((a, b) => a + b.img, 0), 0, envs.map((e) => e.img.first[0] || '').filter(Boolean)[0] || '');
  row('Paint\'s image + variables end at or below AL_RAM: PN_VARS_END - AL_RAM (bytes, <= 0)', S.PN_VARS_END - S.AL_RAM, 0, `${hex(S.PN_VARS_END)} against ${hex(S.AL_RAM)}`);
  sec.end();
}
// direct calls of the kernel's window routines (group 9's exposed-canvas row), on a machine on which no frame is run afterwards
function TKcalls(env) {
  const { S } = env;
  env.rng = null;
  L.park(env);
  return {
    stack: 0,
    lastStack() { return this.stack; },
    inval(x, y, w, h) { T.poke16(env, S.GA, x); T.poke16(env, S.GA + 2, y); T.poke16(env, S.GA + 4, w); T.poke16(env, S.GA + 6, h); const r = T.runCall(env, S.W_INVAL, {}, { ints: false }); this.stack = Math.max(this.stack, r.stack); return r.t; },
    update() { const r = T.runCall(env, S.W_UPDATE, {}, { ints: false }); this.stack = Math.max(this.stack, r.stack); return r.t; },
  };
}

// ===========================================================================================================================================
// 14. P3a (PAINT 21): the Bucket (tool 5).  A click inside the picture runs G_FLOOD from the pointer with the chosen pattern (the clip the picture, the pointer shielded); a complete fill is committed like a stroke
// whose box is the region's (even byte columns, undo when nc x nr <= 2,048 else "Too big to undo"); an overflow (more than 204 maximal runs with a pattern that is not the solid-opposite one) leaves the picture
// EXACTLY as before, says "Fill too complex" and changes no undo state and not PN_DIRTY; no capture is taken.  The model is tests/pt-model.mjs bucket() on tests/gfx6-model.mjs floodFill().
function g14() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('14 P3a (PAINT 21): the Bucket: a click fills the 4-connected region with the chosen pattern (every pattern, paper and ink seeds), commit and undo box as for a stroke (the region\'s box, even columns, "Too big to undo" past 2,048 bytes), Undo and redo, "Fill too complex" on an overflow (205 spans with a pattern; 204 completes; solid completes) leaving the picture, the copy, PN_DIRTY and the undo state as they were, no capture, presses off the picture, a moved window');
  const tool = (t) => { Q.chooseTool(env, t); st.chooseTool(t); };
  const pat = (p) => { Q.choosePattern(env, p); st.choosePat(p); };
  // pictures in picture coordinates (0..319, 0..143)
  const hollow = (x0, y0, w, h) => (x, y) => (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h && (x === x0 || x === x0 + w - 1 || y === y0 || y === y0 + h - 1)) ? 1 : 0;
  const union = (...fs) => (x, y) => (fs.some((f) => f(x, y)) ? 1 : 0);
  const comb = (K, h) => (x, y) => (y === 0 || (y <= h && x % 2 === 0 && x < 2 * K)) ? 0 : 1;      // ink everywhere but the paper top row and K one-pixel teeth h rows tall: 1 + K h spans
  const RECT = hollow(100, 40, 100, 60);                                                          // the 100 x 60 hollow rectangle: the inside is 98 x 58, 58 spans
  const speck = (x, y) => (x === 20 && y === 10 ? 1 : 0);                                         // one ink pixel in a row of paper: splits that row's run in two
  const screenOf = (px, py) => [P.PIC.x + st.ox + px, P.PIC.y + st.oy + py];
  const undoState = () => [m.ram[S.PN_UNDO], m.ram[S.PN_UB0], m.ram[S.PN_UBN], m.ram[S.PN_UR0], m.ram[S.PN_URN], Array.from(m.ram.subarray(Q.UNDO_AREA, Q.UNDO_AREA + 2064)).join(',')].join('|');
  /** A click with the Bucket at picture point (px, py): the stroke driver with no moves (or `o.pts`, screen points), then the loop idle; the model follows; screen, state, copy and the display against the copy are checked. */
  const click = (ctx, px, py, o = {}) => {
    const [sx, sy] = screenOf(px, py), dirty0 = m.ram[S.PN_DIRTY], u0 = undoState();
    st.lastBucket = null; st.forceOverflow = !!o.stackOverflow;
    const r = Q.stroke(env, o.pts ?? [[sx, sy]], { settle: 0 });
    st.forceOverflow = false;
    const nf = Q.idle(env, o.max ?? 1500);
    sec.ok(!r.began, `${ctx}: the model takes no stroke (the bucket is a click)`);
    sec.ok(nf < (o.max ?? 1500), () => `${ctx}: the loop never went idle in ${nf} frames`);
    const b = st.lastBucket;
    settleCheck(env, sec, ctx, o.check || {});
    sec.ok(m.ram[S.PN_DRAW] === 0 && rd16(m, S.K_CAPTURE) === 0, () => `${ctx}: PN_DRAW ${m.ram[S.PN_DRAW]}, K_CAPTURE ${hex(rd16(m, S.K_CAPTURE))}: a bucket click takes no capture`);
    if (st.undoOn) undoAreaOk(env, sec, ctx);
    if (b && b.overflow) {
      sec.ok(Q.statusOf(env) === 'Fill too complex', () => `${ctx}: status "${Q.statusOf(env)}", want "Fill too complex" (${b.spans} spans)`);
      sec.ok(m.ram[S.PN_DIRTY] === dirty0 && undoState() === u0, () => `${ctx}: an overflow changed PN_DIRTY (${dirty0} -> ${m.ram[S.PN_DIRTY]}) or the undo state`);
    }
    return { b, frames: nf, started: r.pts };
  };
  const undoRedo = (ctx) => {
    if (!st.undoOn) return;
    editMenu(env, 0); st.undo(); settleCheck(env, sec, `Undo of ${ctx}`); undoAreaOk(env, sec, `Undo of ${ctx}`);
    editMenu(env, 0); st.undo(); settleCheck(env, sec, `Undo again (redo) of ${ctx}`); undoAreaOk(env, sec, `redo of ${ctx}`);
  };
  tool(5);
  settleCheck(env, sec, 'the Bucket chosen: the status line shows "Bucket"');
  sec.ok(m.ram[S.PN_TOOL] === 5 && Q.statusOf(env) === 'Bucket', () => `PN_TOOL ${m.ram[S.PN_TOOL]}, status "${Q.statusOf(env)}"`);
  // ---- a click inside the 100 x 60 hollow rectangle, solid: one pass; Undo and redo ----
  Q.install(env, RECT); settleCheck(env, sec, 'the hollow rectangle installed');
  { const c = click('inside the hollow 100 x 60 rectangle, solid (pattern 0)', 150, 70); sec.ok(c.b && !c.b.overflow && c.b.n === 98 * 58 && c.b.spans === 58, () => `model: region ${c.b && c.b.n} px, ${c.b && c.b.spans} spans (want ${98 * 58}, 58)`);
    sec.ok(st.undoOn, () => `the fill's box fits the undo area: undoOn ${st.undoOn}, box ${JSON.stringify(st.undoBox && { ...st.undoBox, px: 0 })}`); undoRedo('the solid fill inside the rectangle'); }
  // ---- every pattern, a paper seed inside the rectangle and an ink seed on its frame ----
  for (let p = 0; p < 16; p++) {
    pat(p);
    Q.install(env, RECT);
    click(`pattern ${p}: inside the rectangle (paper seed)`, 120 + p, 50 + (p & 7));
    if (p % 5 === 0) undoRedo(`the pattern ${p} fill`);
    Q.install(env, RECT);
    click(`pattern ${p}: on the frame (ink seed, the frame's 118 spans)`, 100, 60 + p);
  }
  // ---- the region's box: a small region, two columns of bytes, an edge region, a one-pixel hole ----
  pat(2);
  { Q.install(env, (x, y) => ((x === 40 || x === 49 || y === 20 || y === 29) && x >= 40 && x <= 49 && y >= 20 && y <= 29) ? 1 : 0);
    const c = click('a 8 x 8 room (box inside one byte column pair), pattern 2', 44, 24); sec.ok(c.b && c.b.n === 64, () => `model: region ${c.b && c.b.n}`); undoRedo('the 8 x 8 room'); }
  { Q.install(env, (x, y) => (x === 5 && y === 5 ? 0 : 1)); const c = click('a single paper pixel in ink, pattern 0', 5, 5); sec.ok(c.b && c.b.n === 1, () => `model: region ${c.b && c.b.n}`); undoRedo('the one-pixel region'); }
  { Q.install(env, (x, y) => (x === 319 && y === 143 ? 0 : 1)); click('the picture\'s last pixel (319, 143) as the only paper pixel, pattern 0', 319, 143); undoRedo('the corner pixel'); }
  { Q.install(env, (x, y) => (x === 0 && y === 0 ? 0 : 1)); click('the picture\'s first pixel (0, 0) as the only paper pixel, pattern 2', 0, 0); }
  // ---- the background around a hollow rectangle: 204 spans (a pattern completes), 205 (one speck more: a pattern overflows, solid completes) ----
  pat(2);
  Q.install(env, RECT);
  { const c = click('the background around one hollow rectangle: 204 spans, pattern 2 (completes)', 10, 100); sec.ok(c.b && c.b.spans === 204 && !c.b.overflow, () => `model: ${c.b && c.b.spans} spans, overflow ${c.b && c.b.overflow}`); }
  Q.install(env, union(RECT, speck));
  { const c = click('the background around the rectangle and a speck: 205 spans, pattern 2 (overflows: "Fill too complex")', 10, 100); sec.ok(c.b && c.b.spans === 205 && c.b.overflow, () => `model: ${c.b && c.b.spans} spans, overflow ${c.b && c.b.overflow}`);
    sec.ok(Q.statusOf(env) === 'Fill too complex', 'the status line says "Fill too complex"'); }
  // the picture is exactly as before (also the display against the copy: settleCheck did both); the status gives way to the tool's name at the next tool choice
  // PAINT 21 (revised): pressing the already-chosen tool's cell brings the tool's name back after a message, as choosing another tool does
  tool(5); settleCheck(env, sec, 'the already-chosen Bucket cell pressed after an overflow: the status is "Bucket" again');
  tool(1); settleCheck(env, sec, 'another tool (the Pencil) chosen after an overflow: the status is "Pencil"'); tool(5); settleCheck(env, sec, 'the Bucket chosen again: the status is "Bucket"');
  pat(0);
  { const c = click('the same 205-span region, solid pattern 0: completes (fast path)', 10, 100); sec.ok(c.b && c.b.spans === 205 && !c.b.overflow, () => `model: ${c.b && c.b.spans} spans`);
    sec.ok(!st.undoOn && Q.statusOf(env) === 'Too big to undo', () => `a whole-background fill: undo ${st.undoOn}, status "${Q.statusOf(env)}"`); }
  // ---- many shapes: the background around 3 frames overflows with a pattern; the solid fill completes ----
  const shapes3 = union(hollow(20, 10, 40, 40), hollow(100, 55, 40, 40), hollow(200, 100, 40, 40));
  for (const p of [2, 6, 12]) {
    pat(p); Q.install(env, shapes3);
    const c = click(`the background around 3 frames, pattern ${p} (many spans: "Fill too complex")`, 10, 140); sec.ok(c.b && c.b.overflow && c.b.spans > 204, () => `model: ${c.b && c.b.spans} spans, overflow ${c.b && c.b.overflow}`);
  }
  pat(0); Q.install(env, shapes3);
  click('the background around 3 frames, solid: completes', 10, 140);
  pat(15); Q.install(env, (x, y) => 1 - shapes3(x, y));
  { const c = click('the ink around... 3 frames inverted: ink seed in the white background, white pattern 15 (the fast path over ink)', 10, 140); sec.ok(c.b && c.b.fast && !c.b.overflow, () => `model: fast ${c.b && c.b.fast}`); }
  // ---- combs: 1 + K h spans (the exact boundary with the span list) ----
  for (const [K, h] of [[160, 1], [29, 7], [102, 2], [101, 2], [160, 2]]) {
    const spans = 1 + K * h;
    for (const p of [2, 0]) {
      pat(p); Q.install(env, comb(K, h));
      const c = click(`a comb of ${K} teeth x ${h} rows (${spans} spans), pattern ${p}: ${spans > 204 && p !== 0 ? 'overflows' : 'completes'}`, 1, 0);
      sec.ok(c.b && c.b.spans === spans && c.b.overflow === (spans > 204 && p !== 0), () => `model: ${c.b && c.b.spans} spans, overflow ${c.b && c.b.overflow}`);
    }
  }
  // ---- an overflow changes no undo state: a fitting fill first (undo on), then an overflow, then Undo of the first fill still works ----
  pat(2); Q.install(env, union(RECT, speck));
  click('a fitting fill (inside the rectangle, pattern 2) before the overflow', 150, 70);
  sec.ok(st.undoOn, 'Undo is enabled after the fitting fill');
  const u1 = undoState();
  click('then an overflow elsewhere (the background, 205 spans, pattern 2): the undo state is the fitting fill\'s', 10, 100);
  sec.ok(undoState() === u1 && st.undoOn, 'the undo box and the undo area are those of the fitting fill');
  editMenu(env, 0); st.undo(); settleCheck(env, sec, 'Undo after the overflow undoes the fitting fill'); undoAreaOk(env, sec, 'Undo after the overflow');
  editMenu(env, 0); st.undo(); settleCheck(env, sec, 'Undo again (redo) after the overflow');
  // the next fitting fill brings the tool's name back
  click('another overflow, then ...', 10, 100);
  sec.ok(Q.statusOf(env) === 'Fill too complex', 'status "Fill too complex"');
  click('... a fitting fill (inside the rectangle) brings the name back', 150, 70);
  sec.ok(Q.statusOf(env) === 'Bucket', () => `the status is "${Q.statusOf(env)}", want "Bucket"`);
  // a stroke of another tool also brings the name back (the tool choice does)
  click('an overflow once more', 10, 100);
  tool(1); settleCheck(env, sec, 'the Pencil chosen after an overflow: the status is "Pencil"'); tool(5);
  // ---- presses that fill nothing: off the picture ----
  for (const [what, [x, y]] of [['the canvas border (126, 100)', [126, 100]], ['the canvas inner frame (127, 100)', [127, 100]], ['the desk (490, 100)', [490, 100]], ['the status line (200, 184)', [200, 184]], ['the window\'s empty content (123, 150)', [123, 150]]]) {
    const u0 = undoState(), d0 = m.ram[S.PN_DIRTY], pic0 = Array.from(st.copyBytes());
    Q.install(env, RECT);
    pic0.length = 0; pic0.push(...st.copyBytes());
    click(`a bucket press on ${what}: no fill, no commit`, 0, 0, { pts: [[x, y]], max: 60 });
    sec.ok(st.lastBucket === null && m.ram[S.PN_DIRTY] === d0 && undoState() === u0 && eq(Array.from(Q.copyOf(env)), Array.from(st.copyBytes())), () => `${what}: a press outside the picture changed PN_DIRTY (${d0} -> ${m.ram[S.PN_DIRTY]}), the undo state or the copy`);
    sec.ok(Q.statusOf(env) === 'Bucket', () => `${what}: status "${Q.statusOf(env)}", want "Bucket"`);
  }
  { // the tool box: the press chooses the Brush (cell (80, 60)); nothing is filled
    const d0 = m.ram[S.PN_DIRTY], u0 = undoState(); Q.install(env, RECT); st.lastBucket = null;
    Q.stroke(env, [[80, 60], [200, 100]], { settle: 12 }); st.chooseTool(2);
    settleCheck(env, sec, 'a bucket-tool press on the tool box (the Brush cell) chooses that tool and fills nothing');
    sec.ok(m.ram[S.PN_DIRTY] === d0 && undoState() === u0, 'no commit by the tool box press');
    tool(5);
  }
  // ---- no E_MOVE handling: the pointer dragged across the picture after the press changes nothing more ----
  pat(2); Q.install(env, RECT);
  { const [x0, y0] = screenOf(150, 70);
    click('a bucket press inside the rectangle, then the button held and the pointer dragged over the picture: one fill, no more', 0, 0, { pts: [[x0, y0], [x0 + 60, y0 - 20], [x0 + 120, y0 + 30], [x0 - 20, y0 + 40]], max: 400 }); }
  // ---- a picture with noise: the machine and the model agree on the fill and the overflow.  A fill that completes on the machine needs the seed stack (256 entries) not to pass its limit: the model cannot predict that,
  // so a seed is picked whose region the model proves cannot (at most 512 pushes in any order for a solid fill, 256 for a patterned one), or whose fill overflows by the span count in any case ----
  for (const [d, p] of [[0.5, 0], [0.5, 2], [0.45, 5], [0.55, 0], [0.55, 9], [0.7, 6], [0.3, 0], [0.3, 12]]) {
    const r = L.makeRng(900 + Math.round(d * 100) + p); const t = new Uint8Array(320 * 144); for (let i = 0; i < t.length; i++) t[i] = r.next() < d ? 1 : 0;
    pat(p); Q.install(env, (x, y) => t[y * 320 + x]);
    for (const colour of [0, 1]) {
      let seed = null, why = '';
      for (let k = 0; k < 400 && !seed; k++) {
        const x = r.int(0, 319), y = r.int(0, 143); if (t[y * 320 + x] !== colour) continue;
        const pr = st.probe(P.PIC.x + x, P.PIC.y + y, p);
        if (pr.overflow || pr.pushBound <= (pr.fast ? 512 : 256)) { seed = [x, y]; why = `${pr.n} px, ${pr.spans} spans, ${pr.overflow ? 'overflow' : 'completes'}`; }
      }
      if (!seed) { sec.note(`noise ink density ${d}, pattern ${p}, ${colour ? 'ink' : 'paper'} seed: no seed without a seed-stack risk found (skipped)`); continue; }
      click(`noise (ink density ${d}), pattern ${p}, ${colour ? 'an ink' : 'a paper'} seed (${why})`, seed[0], seed[1], { check: { noBox: true } });
    }
  }
  // the seed stack (PAINT 21 revised: 512 seeds for a one-pass fill): a paper bar with 160 one-pixel teeth up and 160 down, each tooth capped by a full bar with 160 more teeth beyond it: the first span pushes 320 seeds, a popped tooth
  // leads to a bar that pushes the other 159 teeth again (duplicates) and its own 160 more: well over 512 whatever the scan order.  G_FLOOD overflows with a solid pattern: "Fill too complex".
  { pat(0);
    const bars = new Set([66, 68, 70, 72, 74]), teeth = new Set([65, 67, 71, 73]);          // rows: teeth 65, bar 66, up-teeth 67, bar 68 ...
    const rowsT = [[67, 'tooth'], [69, 'bar'], [70, 'tooth'], [71, 'bar'], [73, 'tooth'], [74, 'bar']];
    void bars; void teeth; void rowsT;
    // layout (picture rows): 64 teeth2, 65 bar0, 66 up teeth, 67 bar1 (the seed's row), 68 down teeth, 69 bar2, 70 teeth2'
    const pic = (x, y) => { const T = (x % 2 === 0 && x < 320); if (y === 65 || y === 67 || y === 69) return 0; if ((y === 64 || y === 66 || y === 68 || y === 70) && T) return 0; return 1; };
    Q.install(env, pic);
    const pr = st.probe(P.PIC.x + 3, P.PIC.y + 67, 0);
    sec.ok(pr.fast && !pr.overflow && pr.pushBound > 512, () => `model: the seed-stack picture is a solid fill with ${pr.pushBound} possible pushes (must exceed 512)`);
    const c = click('bars and 160 + 160 teeth (more than 512 seeds in all), solid: the SEED STACK passes 512 entries: "Fill too complex" although the pattern is solid', 3, 67, { stackOverflow: true });
    sec.ok(c.b && c.b.forced, 'the model was told to expect the seed-stack overflow'); }
  // ---- a moved window: the picture is where the canvas view is ----
  const drag = (dx, dy) => {
    const w = Q.paintWin(env), tx = w.x + 200, ty = w.y + 3;
    L.moveTo(env, tx, ty); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, tx + dx, ty + dy); env.frames_(3);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(30);
    const w2 = Q.paintWin(env); st.ox = w2.x - 48; st.oy = w2.y - 16;
    return [w2.x - w.x, w2.y - w.y];
  };
  for (const [dx, dy] of [[64, 16], [-96, 8]]) {
    const [rx, ry] = drag(dx, dy);
    sec.note(`dragged by (${dx}, ${dy}): the window moved by (${rx}, ${ry}); the picture's origin is (${P.PIC.x + st.ox}, ${P.PIC.y + st.oy})`);
    settleCheck(env, sec, `after the drag to offset (${st.ox}, ${st.oy})`, { adoptStatus: true });
    pat(2); Q.install(env, union(RECT, speck));
    click(`moved window (${st.ox}, ${st.oy}): inside the rectangle, pattern 2`, 150, 70); undoRedo(`the moved-window fill (${st.ox}, ${st.oy})`);
    click(`moved window (${st.ox}, ${st.oy}): the background, 205 spans, pattern 2 (overflow)`, 10, 100);
    pat(0);
    click(`moved window (${st.ox}, ${st.oy}): a fill whose box touches the picture's right edge, solid`, 310, 143, { check: { noBox: true } });
    pat(2);
  }
  drag(-st.ox, -st.oy);
  settleCheck(env, sec, 'the window back at (48, 16)', { adoptStatus: true });
  // ---- a second machine: an overflow does not set PN_DIRTY when it was clear; the first completed fill does ----
  {
    const e2 = newEnv(), m2 = e2.m, S2 = e2.S, st2 = e2.st;
    const chk = (ctx) => { Q.park(e2, 3); Q.check(e2, sec, ctx); Q.copyIsDisplay(e2, sec, ctx); };
    Q.chooseTool(e2, 5); st2.chooseTool(5); Q.choosePattern(e2, 2); st2.choosePat(2);
    Q.install(e2, union(RECT, speck));
    sec.ok(m2.ram[S2.PN_DIRTY] === 0, 'PN_DIRTY is clear at the start');
    const [sx, sy] = [P.PIC.x + 10, P.PIC.y + 100];
    Q.stroke(e2, [[sx, sy]], { settle: 0 }); Q.idle(e2, 1500);
    chk('overflow on a clean picture: no change');
    sec.ok(m2.ram[S2.PN_DIRTY] === 0 && m2.ram[S2.PN_UNDO] === 0, () => `after an overflow PN_DIRTY ${m2.ram[S2.PN_DIRTY]}, PN_UNDO ${m2.ram[S2.PN_UNDO]}; both must be 0`);
    sec.ok(st2.status === 'Fill too complex' && Q.statusOf(e2) === 'Fill too complex', () => `status "${Q.statusOf(e2)}"`);
    Q.stroke(e2, [[P.PIC.x + 150, P.PIC.y + 70]], { settle: 0 }); Q.idle(e2, 1500);
    chk('a completed fill after the overflow');
    sec.ok(m2.ram[S2.PN_DIRTY] === 1 && Q.statusOf(e2) === 'Bucket', () => `after a completed fill PN_DIRTY ${m2.ram[S2.PN_DIRTY]}, status "${Q.statusOf(e2)}"`);
  }
  // ---- "Too big to undo": a fill whose box exceeds 2,048 bytes ----
  pat(2); Q.install(env, (x, y) => ((x < 30 || x > 290) && y > 20 && y < 60) || (y === 100) ? 1 : 0);
  { const c = click('a big region (box 40 x 100: 4,000 bytes), pattern 2: "Too big to undo", Undo disabled', 150, 80, { check: { noBox: true } });
    sec.ok(c.b && !c.b.overflow && !st.undoOn && st.status === 'Too big to undo', () => `model: overflow ${c.b && c.b.overflow}, undoOn ${st.undoOn}, status "${st.status}"`); }
  // ---- time rows: the click's work, from the press frame's ISR to the idle HALT ----
  {
    const marks = [S.pn_bucket, S.pn_commit].filter(Boolean);
    const timed = (label, pic, p, px, py) => {
      pat(p); Q.install(env, pic);
      const [sx, sy] = screenOf(px, py);
      const per = Q.busy(env, () => { Q.stroke(env, [[sx, sy]], { settle: 0 }); Q.idle(env, 3000); }, marks);
      const bk = Q.spansFrom(per.ev, S.pn_bucket), cm = Q.spansFrom(per.ev, S.pn_commit);
      const lost0 = env.vf.bad;
      row(`bucket: ${label}: pn_bucket entry to HALT`, bk[0] ?? Math.max(...per.map((q) => q.t1 - q.t0)), null, `the longest busy period ${Math.max(...per.map((q) => q.t1 - q.t0))}; pn_commit entry to HALT ${cm.join(', ') || 'n/a'}; ${Math.round((bk[0] ?? 0) / FRAME_T)} frames; region ${st.lastBucket.n} px, ${st.lastBucket.spans} spans${lost0 ? '' : ''}`);
      settleCheck(env, sec, `after the timed fill: ${label}`, { noBox: true });
    };
    timed('inside the 100 x 60 hollow rectangle, solid', RECT, 0, 150, 70);
    timed('inside the 100 x 60 hollow rectangle, 50 % checker', RECT, 2, 150, 70);
    timed('an empty whole picture (320 x 144), solid', () => 0, 0, 100, 70);
    timed('an empty whole picture (320 x 144), 50 % checker', () => 0, 2, 100, 70);
  }
  sec.end(`stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}; memory watch: ${env.w.summary()}`);
}

// ===========================================================================================================================================
// 15. P3b (PAINT 22.2): the Marquee (tool 0).  A press and drag inside the picture draws an XOR band; the release makes the selection (byte columns, exact rows, <= 2,048 bytes; "Selection too big" otherwise;
// a click selects nothing; the pointer outside the picture is clamped) shown as an XOR outline that is in neither the picture nor its copy.  A press inside the selection moves it (8-pixel steps across, rows exact, the box
// kept inside the picture; CAPS SHIFT held at the release copies); the release erases the source (a move), draws the lifted box (G_LIFT then G_ICON), commits (undo box = the union of source and destination for a
// move, the destination for a copy; "Too big to undo" past 2,048 bytes) and the destination is the selection; a release without a change commits nothing.  DELETE clears the box (committed, selection kept), ESC drops it;
// every menu command and a tool change drop it too; the outline is drawn again after an exposure (a dragged window).  The model is tests/pt-model.mjs mqPress / mqRelease / mqDelete / displayModel; PAINT 22.2 is the reference.
function g15() {
  const env = newEnv(), { m, S } = env, st = env.st;
  const sec = new Sec('15 P3b (PAINT 22.2): the Marquee: select (sizes, the 2,048-byte limit, clicks, clamping), the outline (XOR, in neither the picture nor its copy), move and copy (all directions, 8-pixel steps, edges, overlap), the undo box (the union), no-change releases, DELETE, ESC, a new selection, tool and menu commands drop it, exposure (a dragged window), the status messages');
  const tool = (t) => { Q.chooseTool(env, t); st.chooseTool(t); };
  const scr = (px, py) => [P.PIC.x + st.ox + px, P.PIC.y + st.oy + py];
  const eqSel = (a, b) => (a === null || b === null) ? a === b : a.c === b.c && a.n === b.n && a.y === b.y && a.h === b.h;
  const showSel = (q) => (q ? `{ c ${q.c}, n ${q.n}, y ${q.y}, h ${q.h} }` : 'none');
  const after = (ctx, o = {}) => { settleMq(env, sec, ctx, o); if (st.undoOn) undoAreaOk(env, sec, ctx); };
  /** The packed rows a lift of box q from the picture g must leave in cold RAM $7800 (G_LIFT's layout: n bytes a row). */
  const liftBytes = (q, g) => { const out = []; for (let r = 0; r < q.h; r++) for (let k = 0; k < q.n; k++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | g.px(8 * (q.c + k) + j, q.y + r); out.push(v); } return out; };
  const expectSel = (ctx, want) => sec.ok(eqSel(st.sel, want), () => `${ctx}: the model's selection is ${showSel(st.sel)}, PAINT 22.2 says ${showSel(want)}`);
  /**
   * A Marquee stroke along `pts` (screen points) with the band checked after every point and the machine settled and compared after the release.  o.cs: 'release' = CAPS SHIFT pressed after the last move and still held at the
   * release (a copy), 'all' = held throughout (a copy), 'drag' = held from before the press and let go before the release (a move); o.noMid skips the band checks; o.check = Q.check options for the final check.
   */
  const mq = (ctx, pts, o = {}) => {
    const before = st.clone(), last = Q.expand(pts, o.max ?? 100).length - 1, cs = o.cs, sel0 = st.sel && { ...st.sel };
    st.cs = cs === 'all' || cs === 'release';
    L.setKeys(m, cs === 'all' || cs === 'drag' ? [0] : []);
    if (cs) env.frames_(2);
    const r = Q.stroke(env, pts, { wait: 3, gap: 2, settle: 0, mid: (i, seen) => {
      if (i === last && cs === 'release') { L.setKeys(m, [0]); env.frames_(2); }
      if (i === last && cs === 'drag') { L.setKeys(m, []); env.frames_(2); }
      if (o.noMid) return;
      Q.check(env, sec, `${ctx}: mid-stroke after point ${i}`, { st: st.displayModel(), copyOf: before, extra: i > 0 ? [seen[i - 1]] : [] });
      if (i === 0 && st.stroke && st.stroke.mode === 'move') {
        const want = liftBytes(sel0, before), got = Array.from(m.ram.subarray(0x7800, 0x7800 + want.length)), k = want.findIndex((v, j) => got[j] !== v);
        sec.ok(k < 0, () => `${ctx}: the lift buffer at $7800 differs from the selection's pixels at byte ${k} of ${want.length} (machine ${got[k]}, model ${want[k]})`);
      }
    } });
    L.setKeys(m, []); st.cs = false; env.frames_(2);
    const nf = Q.idle(env, 800);
    sec.ok(nf < 800, () => `${ctx}: the loop never went idle (${nf} frames)`);
    after(ctx, o.check || {});
    return r;
  };
  /** The corners of a drag that selects the byte columns c0 .. c1 and the rows r0 .. r1 (rev: from the far corner back). */
  const box = (c0, c1, r0, r1, rev = false) => (rev ? [scr(8 * c1 + 5, r1), scr(8 * c0 + 2, r0)] : [scr(8 * c0 + 3, r0), scr(8 * c1 + 4, r1)]);
  /** A press in the middle of the selection and a drag by (dx, dy) pixels (through the half way point). */
  const dragSel = (ctx, dx, dy, o = {}) => {
    const q = st.sel;
    if (!q) { sec.ok(false, `${ctx}: there is no selection to drag (an earlier step did not make one)`); return null; }
    const [px, py] = scr(8 * q.c + 4 * q.n + 1, q.y + (q.h >> 1));
    const cx = (v) => Math.max(0, Math.min(511, v)), cy = (v) => Math.max(0, Math.min(191, v));
    return mq(ctx, [[px, py], [cx(px + (dx >> 1)), cy(py + (dy >> 1))], [cx(px + dx), cy(py + dy)]], o);
  };
  const key = (code) => { L.typeCode(env, code, 3, 3); Q.idle(env, 300); };
  const del = (ctx) => { key(12); st.mqDelete(); after(ctx); };
  const esc = (ctx) => { key(27); st.mqEsc(); after(ctx); };
  const dirty = () => m.ram[S.PN_DIRTY];
  /** Drop the selection by ESC (so that the next press cannot land inside it), then a new picture straight into the machine. */
  const fresh = () => { if (st.sel) { key(27); st.mqEsc(); } };
  const reinstall = (seed, ctx) => { fresh(); Q.install(env, noise(seed, 0.5)); settleMq(env, sec, ctx, { adoptStatus: true, noBox: true }); };
  /** A selection made from scratch (the old one dropped first by ESC). */
  const select = (ctx, c0, c1, r0, r1, rev = false, o = {}) => { fresh(); return mq(ctx, box(c0, c1, r0, r1, rev), o); };

  Q.install(env, noise(41, 0.5));
  tool(0);
  after('a noisy picture installed, the Marquee chosen: nothing selected');
  sec.ok(m.ram[S.PN_SELON] === 0, () => `PN_SELON ${m.ram[S.PN_SELON]} at the start`);

  // ---- 1. clicks, a box one byte wide and one row tall, a drag back to its start ----
  mq('a click without a drag selects nothing', [scr(100, 50)]);
  expectSel('a click', null); sec.ok(st.status === 'Marquee' && !dirty(), () => `status "${st.status}", PN_DIRTY ${dirty()}`);
  mq('a drag that comes back to its start selects nothing', [scr(100, 50), scr(140, 80), scr(100, 50)]);
  expectSel('a drag back to its start', null);
  mq('a 2-pixel drag along a row: one byte wide, one row tall (8 x 1 pixels)', [scr(100, 50), scr(102, 50)]);
  expectSel('8 x 1', { c: 12, n: 1, y: 50, h: 1 });
  mq('a click inside that selection (a move that goes nowhere): the outline again, nothing committed', [scr(100, 50)]);
  expectSel('a click inside', { c: 12, n: 1, y: 50, h: 1 }); sec.ok(!dirty() && !st.undoOn, () => `PN_DIRTY ${dirty()}, undo ${st.undoOn}`);
  mq('a 1-pixel drag down: one byte wide, two rows', [scr(160, 70), scr(160, 71)]);
  expectSel('8 x 2', { c: 20, n: 1, y: 70, h: 2 });
  mq('a 1-pixel drag to the left across a byte boundary: two bytes, one row', [scr(160, 90), scr(159, 90)]);
  expectSel('16 x 1', { c: 19, n: 2, y: 90, h: 1 });
  mq('a drag up and to the left (reverse corners): 6 x 4 bytes x rows', box(30, 35, 20, 23, true));
  expectSel('reverse', { c: 30, n: 6, y: 20, h: 4 });

  // ---- 2. random selections (small, some big), every corner order; a press outside the old selection starts a new one (the old outline is erased at the press) ----
  for (let i = 0; i < NRAND * 2; i++) {
    const ax = rng.int(0, 319), ay = rng.int(0, 143), big = rng.chance(0.25);
    const dx = rng.int(big ? -250 : -90, big ? 250 : 90), dy = rng.int(big ? -110 : -30, big ? 110 : 30);
    const pts = [scr(ax, ay)]; if (rng.chance(0.5)) pts.push(scr(Math.max(0, Math.min(319, ax + (dx >> 1) + rng.int(-9, 9))), Math.max(0, Math.min(143, ay + (dy >> 1) + rng.int(-9, 9)))));
    pts.push(scr(Math.max(0, Math.min(319, ax + dx)), Math.max(0, Math.min(143, ay + dy))));
    mq(`random drag ${i + 1} from (${ax}, ${ay}) to (${pts[pts.length - 1][0] - 128}, ${pts[pts.length - 1][1] - 32}) (picture coordinates; the previous selection ${showSel(st.sel)} is dropped at the press unless the press is inside it)`, pts);
  }

  // ---- 3. the 2,048-byte limit ----
  const limit = (what, c0, c1, r0, r1, fits, rev = false) => {
    select(`${what}: ${c1 - c0 + 1} x ${r1 - r0 + 1} = ${(c1 - c0 + 1) * (r1 - r0 + 1)} bytes`, c0, c1, r0, r1, rev);
    if (fits) expectSel(what, { c: c0, n: c1 - c0 + 1, y: r0, h: r1 - r0 + 1 });
    else sec.ok(st.sel === null && st.status === 'Selection too big', () => `${what}: selection ${showSel(st.sel)}, status "${st.status}" (PAINT 22.2: "Selection too big" and no selection)`);
  };
  limit('exactly 2,048 bytes (16 x 128)', 4, 19, 5, 132, true);
  limit('exactly 2,048 bytes (16 x 128), dragged from the far corner back', 4, 19, 5, 132, true, true);
  limit('exactly 2,048 bytes (32 x 64)', 2, 33, 20, 83, true);
  limit('2,040 bytes (40 x 51, the whole width)', 0, 39, 10, 60, true);
  limit('2,040 bytes (17 x 120)', 4, 20, 5, 124, true);
  limit('the whole height (1 x 144)', 7, 7, 0, 143, true);
  limit('the smallest box past the limit: 25 x 82 = 2,050 (2,049 = 3 x 683 is not a product of a width of 1-40 and a height of 1-144)', 3, 27, 10, 91, false);
  sec.ok(st.status === 'Selection too big', 'the status line says "Selection too big" (a message)');
  limit('16 x 129 = 2,064', 4, 19, 5, 133, false);
  limit('17 x 121 = 2,057', 4, 20, 5, 125, false);
  limit('40 x 52 = 2,080', 0, 39, 10, 61, false, true);
  limit('the whole picture (40 x 144)', 0, 39, 0, 143, false);
  limit('a fitting selection after a message: the status is the tool\'s name again', 10, 11, 10, 20, true);
  sec.ok(st.status === 'Marquee', () => `status "${st.status}"`);

  // ---- 4. the pointer outside the picture: the box is clamped to the picture's edges ----
  fresh(); mq('press inside, release right of and below the picture (screen (500, 190))', [scr(300, 100), [500, 190]]);
  expectSel('released at the bottom right', { c: 37, n: 3, y: 100, h: 44 });
  fresh(); mq('press inside, release left of and above the picture (screen (20, 4))', [scr(250, 60), [20, 4]]);
  expectSel('released at the top left', { c: 0, n: 32, y: 0, h: 61 });
  fresh(); mq('press in the last column, release at the screen corner (505, 191): a clamped 8 x 1 box', [scr(319, 143), [505, 191]]);
  expectSel('the last pixel', { c: 39, n: 1, y: 143, h: 1 });
  fresh(); mq('press inside, release over the tool box and the status line', [scr(140, 100), [80, 185]]);
  fresh(); mq('press near the top left, released far to the right on the desk (screen (490, 20))', [scr(10, 5), [490, 20]]);

  // ---- 5. presses that are not in the picture: nothing changes, the selection stays ----
  select('select 5 x 20 for the next rows', 10, 14, 20, 39, false);
  for (const [what, p] of [['the canvas border (126, 100)', [126, 100]], ['the canvas inner frame (127, 60)', [127, 60]], ['below the picture (300, 177)', [300, 177]], ['the desk (490, 100)', [490, 100]]]) {
    const was = st.clone();
    const r = mq(`a press on ${what}, dragged across the picture and released: the selection stays`, [p, scr(200, 100), scr(250, 120), p]);
    sec.ok(!r.began && eqSel(st.sel, was.sel) && Q.copyOf(env).join() === was.copyBytes(Q.SWAP).join(), () => `${what}: began ${r.began}, selection ${showSel(st.sel)}`);
  }
  mq('a press just outside the selection, released where it was pressed: the old selection is dropped, nothing new', [scr(8 * 9 + 2, 30)]);
  expectSel('a click outside', null);

  // ---- 6. moves: all directions, 8-pixel steps, overlap, the edges ----
  reinstall(42, 'a new noisy picture installed');
  select('select 4 x 30 bytes x rows at column 10, row 40', 10, 13, 40, 69, false);
  expectSel('select', { c: 10, n: 4, y: 40, h: 30 });
  const MOVES = [[16, 0], [-16, 0], [0, 10], [0, -10], [24, 12], [-24, -12], [24, -12], [-24, 12], [3, 0], [-3, 0], [7, 1], [-1, 0], [8, 0], [0, 1], [8, 1], [-8, -1], [0, 15], [16, 0], [-17, 7], [31, -5]];
  for (const [dx, dy] of MOVES) {
    const q0 = { ...st.sel };
    dragSel(`move by (${dx}, ${dy}) pixels (8-pixel steps across: ${Math.floor(dx / 8)} byte columns)`, dx, dy);
    const dc = Math.max(0, Math.min(40 - q0.n, q0.c + Math.floor(dx / 8))), dr = Math.max(0, Math.min(144 - q0.h, q0.y + dy));
    if (Math.abs(dx) < 120) expectSel(`move by (${dx}, ${dy})`, { c: dc, n: q0.n, y: dr, h: q0.h });
  }
  sec.ok(st.dirty && st.undoOn && dirty() === 1, 'moves commit: PN_DIRTY 1, Undo enabled');
  // the edges: far moves are clamped, a move onto the edge it is already at changes nothing
  for (const [dx, dy, what] of [[-400, 0, 'far left'], [-40, 0, 'left again (already at the edge: no change)'], [0, -400, 'far up'], [0, -9, 'up again (no change)'], [500, 0, 'far right'], [90, 0, 'right again (no change)'], [0, 300, 'far down'], [0, 50, 'down again (no change)'], [-500, -300, 'to the top left corner'], [500, 300, 'to the bottom right corner']]) {
    const d0 = dirty(), u = st.undoBox && { ...st.undoBox, px: 0 }, q0 = { ...st.sel };
    dragSel(`${what}: by (${dx}, ${dy})`, dx, dy);
    if (what.includes('no change')) sec.ok(eqSel(st.sel, q0) && dirty() === d0 && JSON.stringify(u) === JSON.stringify(st.undoBox && { ...st.undoBox, px: 0 }), () => `${what}: selection ${showSel(st.sel)}, PN_DIRTY ${dirty()}, the undo box changed`);
  }

  // ---- 7. copies: CAPS SHIFT at the release; held during the drag only = a move; overlapping; the edges ----
  reinstall(43, 'a third noisy picture');
  select('select 3 x 20 at column 20, row 60', 20, 22, 60, 79, false);
  for (const [dx, dy, cs, what] of [[40, 0, 'release', 'a copy 5 columns right (CAPS SHIFT pressed at the end of the drag)'], [-48, 0, 'all', 'a copy left (CAPS SHIFT held all through)'], [0, 25, 'release', 'a copy down'], [0, -25, 'all', 'a copy up'],
    [8, 0, 'release', 'an overlapping copy (one column right)'], [0, 1, 'release', 'an overlapping copy (one row down)'], [-8, -1, 'all', 'an overlapping copy up-left'], [24, 12, 'drag', 'CAPS SHIFT held during the drag and let go before the release: a MOVE'],
    [-200, 0, 'release', 'a copy to the left edge (clamped)'], [0, -300, 'release', 'a copy to the top edge'], [400, 0, 'release', 'a copy to the right edge'], [0, 200, 'release', 'a copy to the bottom edge'], [5, 2, 'release', 'a copy by (5, 2): 0 columns, 2 rows'], [3, 0, 'release', 'a copy by 3 pixels: no change']]) {
    dragSel(`${what} (${dx}, ${dy})`, dx, dy, { cs });
    if (cs !== 'drag' && st.undoOn && st.undoBox) sec.ok(st.undoBox.nc * st.undoBox.nr <= 2048, 'the copy\'s undo box fits');
  }
  // the undo box of a copy is the destination only, of a move the union: stated through the model on a clean box
  {
    select('select 2 x 10 at column 4, row 30 (a fresh selection)', 4, 5, 30, 39, false);
    dragSel('a copy 10 columns right: the undo box covers the destination only (columns 14-15)', 80, 0, { cs: 'release' });
    sec.ok(st.undoBox && st.undoBox.c0 === 14 && st.undoBox.nc === 2 && st.undoBox.r0 === 30 && st.undoBox.nr === 10, () => `copy's undo box ${JSON.stringify(st.undoBox && { ...st.undoBox, px: 0 })}, want c0 14, nc 2, r0 30, nr 10`);
    select('select 2 x 10 at column 4, row 30 again', 4, 5, 30, 39, false);
    dragSel('a move 10 columns right: the undo box is the union of source and destination (columns 4-15)', 80, 0);
    sec.ok(st.undoBox && st.undoBox.c0 === 4 && st.undoBox.nc === 12 && st.undoBox.r0 === 30 && st.undoBox.nr === 10, () => `move's undo box ${JSON.stringify(st.undoBox && { ...st.undoBox, px: 0 })}, want c0 4, nc 12, r0 30, nr 10`);
  }

  // ---- 8. Undo and redo of a move and of a copy (the menu drops the selection first) ----
  select('select 3 x 16 at column 30, row 100', 30, 32, 100, 115, false);
  dragSel('a move (to be undone)', -64, -40);
  editMenu(env, 0); st.dropSel(); st.undo(); after('Edit > Undo of the move: both the source and the destination come back, the selection is dropped');
  editMenu(env, 0); st.undo(); after('Undo again (redo)');
  select('select 3 x 16 at column 5, row 20', 5, 7, 20, 35, false);
  dragSel('a copy (to be undone)', 96, 60, { cs: 'release' });
  editMenu(env, 0); st.undo(); after('Edit > Undo of the copy');
  editMenu(env, 0); st.undo(); after('Undo again (redo)');

  // ---- 9. "Too big to undo": the union past 2,048 bytes (after widening to even columns) ----
  select('select 16 x 128 = 2,048 bytes at column 4 (even), row 5', 4, 19, 5, 132, false);
  dragSel('move down 1 row: the union is 16 x 129 = 2,064 bytes: "Too big to undo", Undo disabled', 0, 1);
  sec.ok(st.status === 'Too big to undo' && !st.undoOn, () => `status "${st.status}", undo ${st.undoOn}`);
  select('select 16 x 64 at column 4, row 5', 4, 19, 5, 68, false);
  dragSel('move down 64 rows: the union is 16 x 128 = 2,048 bytes: it fits, Undo enabled, the status is the tool\'s name', 0, 64);
  sec.ok(st.undoOn && st.status === 'Marquee', () => `undo ${st.undoOn}, status "${st.status}"`);
  select('select 16 x 128 = 2,048 bytes at column 3 (odd), row 5', 3, 18, 5, 132, false);
  del('DELETE of a 2,048-byte box at an odd column: widened to 18 x 128 = 2,304: "Too big to undo"');
  sec.ok(st.status === 'Too big to undo' && !st.undoOn && !!st.sel, () => `status "${st.status}", undo ${st.undoOn}, selection ${showSel(st.sel)}`);
  select('select 16 x 128 = 2,048 bytes at column 4 (even), row 5', 4, 19, 5, 132, false);
  del('DELETE of a 2,048-byte box at an even column: it fits, Undo enabled');
  sec.ok(st.undoOn && st.status === 'Marquee', () => `undo ${st.undoOn}, status "${st.status}"`);

  // ---- 10. DELETE and ESC ----
  reinstall(44, 'a fourth noisy picture');
  { const d0 = dirty(), u0 = m.ram[S.PN_UNDO]; del('DELETE with no selection: nothing happens'); sec.ok(dirty() === d0 && m.ram[S.PN_UNDO] === u0, () => `a DELETE with no selection changed PN_DIRTY (${d0} -> ${dirty()}) or PN_UNDO (${u0} -> ${m.ram[S.PN_UNDO]})`); }
  esc('ESC with no selection: nothing happens');
  select('select 6 x 25 at column 12, row 50', 12, 17, 50, 74, false);
  del('DELETE: the box is cleared to paper, committed (PN_DIRTY 1, Undo enabled), the selection stays');
  sec.ok(st.dirty && st.undoOn && !!st.sel, 'model: committed, selection kept');
  sec.ok(Q.copyOf(env).length > 0 && Array.from({ length: 25 }, (_, r) => r).every((r) => Array.from({ length: 48 }, (_, j) => st.px(96 + j, 50 + r)).every((v) => v === 0)), 'model: the box is paper');
  editMenu(env, 0); st.undo(); after('Edit > Undo of DELETE: the box is back, the selection dropped');
  select('select 6 x 25 at column 12, row 50 again', 12, 17, 50, 74, false);
  del('DELETE again (the box is cleared)');
  del('DELETE a second time on the same selection (already paper: still a commit)');
  esc('ESC: the selection is dropped, the picture unchanged'); expectSel('ESC', null);
  esc('ESC again: nothing');

  // ---- 11. a new selection with a press outside the old one; a press inside moves it ----
  select('select 5 x 20 at column 8, row 30', 8, 12, 30, 49, false);
  mq('a press outside (column 20), a drag: the first selection is dropped at the press, the new one made', box(20, 26, 90, 120));
  expectSel('second selection', { c: 20, n: 7, y: 90, h: 31 });
  mq('a press just outside the new selection (one column left of it), dragged: a new selection', box(18, 19, 90, 100));
  expectSel('third selection', { c: 18, n: 2, y: 90, h: 11 });
  mq('a press on the last column of the selection, one byte inside: that is a move', [scr(8 * 19 + 7, 95), scr(8 * 19 + 7 + 8, 95)]);
  expectSel('moved one column', { c: 19, n: 2, y: 90, h: 11 });

  // ---- 12. a tool change drops the selection; the same tool again does not; every menu command drops it ----
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  tool(0); after('the Marquee chosen again: the selection stays');
  sec.ok(!!st.sel && m.ram[S.PN_SELON] === 1, 'the selection survives choosing the same tool');
  tool(1); after('the Pencil chosen: the selection is dropped, the picture unchanged'); tool(0);
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  Q.chooseBrush(env, 2); st.chooseBrush(2); Q.choosePattern(env, 3); st.choosePat(3); after('a pattern and a brush chosen: the selection stays');
  sec.ok(!!st.sel, 'the palettes keep the selection');
  tool(5); after('the Bucket chosen: dropped'); tool(0);
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  Q.menuPick(env, 2, 0); st.dropSel(); st.setFill(true); after('Options > Filled shapes: dropped');
  Q.menuPick(env, 2, 1); st.setFill(false);
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  { st.dropSel(); const f = openSaveDialog(env, sec, 'File > Save with a selection (the selection is dropped at the command)'); const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); env.frames_(20); after('Save...: the name dialog cancelled: the selection was dropped at the command', { adoptStatus: true }); }
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  dragSel('a move so that the picture is changed (the discard question will be asked)', 40, 20);
  editMenu(env, 1); st.dropSel(); sec.ok(waitDialog(env, 'ask'), 'Clear asks'); Q.askAnswer(env, 'cancel'); after('Edit > Clear, Cancel: the selection is dropped, the picture kept', { adoptStatus: true });
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  editMenu(env, 1); st.dropSel(); sec.ok(waitDialog(env, 'ask'), 'Clear asks again'); Q.askAnswer(env, 'discard'); st.clear(); after('Edit > Clear, Discard: the selection is dropped, the picture cleared', { adoptStatus: true });
  reinstall(46, 'a fifth noisy picture');
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  dragSel('a move (the picture is changed again)', 24, 24);
  fileMenu(env, 0); st.dropSel(); sec.ok(waitDialog(env, 'ask'), 'New asks'); Q.askAnswer(env, 'discard'); st.newDoc(); after('File > New, Discard: the selection is dropped, a new picture', { adoptStatus: true });
  reinstall(47, 'a sixth noisy picture');
  select('select 6 x 12 at column 2, row 20', 2, 7, 20, 31, false);
  { const file = pbmOf(noise(48, 0.3)); openFile(env, sec, 'File > Open with a selection (the picture is unchanged: no question)', 'sel.pbm', file); st.loadPbm(file); st.name = 'sel.pbm'; after('File > Open: the selection is dropped, the file shown', { adoptStatus: true }); }

  // ---- 13. exposure: the window dragged with a selection (the outline is drawn again at the new place), then used there ----
  reinstall(49, 'a seventh noisy picture');
  const dragWin = (dx, dy) => {
    const w = Q.paintWin(env), tx = w.x + 200, ty = w.y + 3;
    L.moveTo(env, tx, ty); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, tx + dx, ty + dy); env.frames_(3);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(30);
    const w2 = Q.paintWin(env); st.ox = w2.x - 48; st.oy = w2.y - 16;
    return [w2.x - w.x, w2.y - w.y];
  };
  let nd = 0; const seen = [];
  for (const [dx, dy] of [[40, 0], [-30, 12], [-100, 0], [64, 16], [0, -20], [-16, 16]]) {
    mq(`before drag ${nd + 1}: select 6 x 20 at column 5, row 10`, box(5, 10, 10, 29));
    const [rx, ry] = dragWin(dx, dy);
    const w = Q.paintWin(env), tag = `the window at (${w.x}, ${w.y})`; seen.push(`(${w.x}, ${w.y})`);
    sec.note(`dragged by (${dx}, ${dy}): the window moved by (${rx}, ${ry})`);
    after(`${tag}: after the drag the outline is drawn again at the new place and nowhere else`, { adoptStatus: true });
    dragSel(`${tag}: a move`, 56, 30);
    dragSel(`${tag}: a copy`, -40, 20, { cs: 'release' });
    del(`${tag}: DELETE`);
    editMenu(env, 0); st.undo(); after(`${tag}: Undo`, { adoptStatus: true });
    mq(`${tag}: select 3 x 8 at the picture's top left corner`, box(0, 2, 0, 7));
    dragSel(`${tag}: a move up-left from the corner: clamped, no change`, -80, -40);
    mq(`${tag}: select 4 x 10 at the bottom right corner`, box(36, 39, 134, 143));
    dragSel(`${tag}: a move down-right from the corner: clamped, no change`, 80, 40);
    nd++;
  }
  dragWin(-st.ox, -st.oy);
  after('dragged back to (48, 16): the outline is where the selection is', { adoptStatus: true });
  dragSel('a move at home again', 24, -16);
  tool(1); after('the Pencil chosen: dropped');
  tool(0);

  // ---- 14. report rows: select, move, copy and DELETE, the release to idle (report only: no bound) ----
  {
    reinstall(50, 'a picture for the timing rows');
    const timed = (label, f) => {
      const per = Q.busy(env, () => { f(); Q.idle(env, 800); }, [S.pn_mqup, S.pn_key].filter(Boolean));
      const t = Q.spansFrom(per.ev, label.pc);
      row(`marquee: ${label.name}: entry of ${label.pc === S.pn_key ? 'pn_key' : 'pn_mqup'} to idle (HALT)`, t[0] ?? 0, null, `${t.length} entr${t.length === 1 ? 'y' : 'ies'}; ${Math.round((t[0] ?? 0) / FRAME_T * 10) / 10} frames`);
    };
    const run = (name, pc, pts, o = {}) => {
      st.cs = o.cs === 'release';
      const before = st.clone();
      timed({ name, pc }, () => { if (o.cs) L.setKeys(m, [0]); Q.stroke(env, pts, { wait: 3, gap: 2, settle: 0 }); if (o.cs) L.setKeys(m, []); });
      st.cs = false;
      after(`after the timed ${name}`, { adoptStatus: true, noBox: true });
    };
    for (const [name, c0, c1, r0, r1] of [['select 16 x 128 (2,048 bytes)', 4, 19, 5, 132], ['select 4 x 30 (120 bytes)', 10, 13, 40, 69], ['select 1 x 1', 20, 20, 90, 90]]) { fresh(); run(name, S.pn_mqup, box(c0, c1, r0, r1)); }
    select('select 16 x 128 = 2,048 bytes at column 4, row 5', 4, 19, 5, 132, false, { noMid: true });
    { const q = st.sel, [px, py] = scr(8 * q.c + 4 * q.n + 1, q.y + (q.h >> 1)); run('move of a 2,048-byte box by 8 pixels across', S.pn_mqup, [[px, py], [px + 4, py], [px + 8, py]]); }
    { const q = st.sel, [px, py] = scr(8 * q.c + 4 * q.n + 1, q.y + (q.h >> 1)); run('copy of a 2,048-byte box by 24 pixels across (CAPS SHIFT)', S.pn_mqup, [[px, py], [px + 12, py], [px + 24, py]], { cs: 'release' }); }
    select('select 4 x 30 at column 10, row 40', 10, 13, 40, 69, false, { noMid: true });
    { const q = st.sel, [px, py] = scr(8 * q.c + 4 * q.n + 1, q.y + (q.h >> 1)); run('move of a 120-byte box by 16 pixels across', S.pn_mqup, [[px, py], [px + 8, py], [px + 16, py]]); }
    { const q = st.sel, [px, py] = scr(8 * q.c + 4 * q.n + 1, q.y + (q.h >> 1)); run('move of a 120-byte box by 40 pixels across and 20 rows down', S.pn_mqup, [[px, py], [px + 20, py + 10], [px + 40, py + 20]]); }
    select('select 16 x 128 = 2,048 bytes at column 4, row 5', 4, 19, 5, 132, false, { noMid: true });
    timed({ name: 'DELETE of a 2,048-byte box', pc: S.pn_key }, () => { key(12); });
    st.mqDelete(); after('after the timed DELETE', { adoptStatus: true });
    select('select 4 x 30 at column 10, row 40', 10, 13, 40, 69, false, { noMid: true });
    timed({ name: 'DELETE of a 120-byte box', pc: S.pn_key }, () => { key(12); });
    st.mqDelete(); after('after the timed DELETE', { adoptStatus: true });
  }
  sec.end(`window positions tried: ${seen.join(' ')}; stack so far ${env.stack.depth()} bytes; image writes ${env.img.n}; memory watch: ${env.w.summary()}`);
}

// ===========================================================================================================================================
const run = [[1, g1], [2, g2], [3, g3], [4, g4], [5, g5], [6, g6], [7, g7], [8, g8], [9, g9], [10, g10], [11, g11], [12, g12], [13, g13], [14, g14], [15, g15]];
for (const [n, f] of run) if (has(n)) { const t0 = Date.now(); try { f(); } catch (e) { C.check(`group ${n} ran to the end`, false, e.stack.split('\n').slice(0, 3).join(' | ')); } if (VERBOSE) console.log(`  (group ${n}: ${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
finish();
