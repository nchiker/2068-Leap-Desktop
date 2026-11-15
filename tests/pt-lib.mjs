"use strict";
// pt-lib.mjs -- harness of the Paint P1 tests (tests/pt-p1.mjs): Paint (program 4) started through the shell on the prebuilt `desk5` (build/desk5.dck, build/desk5/out.sym; never rebuilt here), the machine's
// state read back (symbols only: PN_ variables and the views), the screen and the copy compared with tests/pt-model.mjs, and drivers for the mouse (strokes, tool box, menus, dialogs).
// Written from docs/PAINT.md 2-9 and 15; src/apps/paint.asm was used only to find symbol names.
import * as H from './shell-lib.mjs';
import * as P from './pt-model.mjs';
import * as WM from './wr-model.mjs';
import * as W3 from './wr-w3model.mjs';
import { createFileHost } from '../web/fshost.js';
import * as GA from './gfx6-model.mjs';
import { makeGroups } from './tk-lib2.mjs';

export { H, P, WM, W3, makeGroups };
export const { L, readDisp, diffDisp } = H;
export const { hex, rd16 } = L;
export const PIC_ADDR_NOTE = 'PN_PIC holds the address of the copy';
export const NEEDED = ['PN_START', 'PN_END', 'PN_IMG', 'PN_IMG_LEN', 'PN_VARS', 'PN_VARS_END', 'PN_PIC', 'PN_BAND', 'PN_TOOL', 'PN_DIRTY', 'PN_UNDO', 'PN_UB0', 'PN_UBN', 'PN_UR0', 'PN_URN', 'PN_LBL', 'PN_STAT', 'PN_MENUS', 'PN_NAME', 'PN_TITLE',
  'PN_WIN', 'PN_FILL', 'PN_AX', 'PN_AY', 'PN_SPR', 'PN_PAT', 'PN_BRUSH', 'PN_RND', 'PN_PADC', 'PN_PADR', 'PN_NX', 'PN_NY', 'pn_spray', 'pn_idle', 'G_PATFILL', 'PATTAB', 'AL_RAM', 'MB_ENT', 'ME_SIZE', 'ME_EN', 'Label_text', 'Window_title', 'K_FOCUS', 'K_PROG', 'CL_Dialog', 'CL_Button', 'CL_Field', 'CL_CWindow', 'Dialog_default', 'Dialog_cancel', 'Field_buf', 'V_FRAMES', 'W_MODAL'];
export function needPaint(S) { const miss = NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); }

/** PAINT 3 (as corrected 2026-11-14): the copy's part 1 holds the ODD byte columns, part 2 the EVEN ones; the header is (OX >> 3, 40, OY, 144) of the last whole-picture save. */
export const SWAP = true;
export const UNDO_AREA = 0x5800;
export const PARK = [490, 100];            // the pointer's parking place: on the desk, right of the window (x 48..463)

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The fake host (as tests/wr-w3lib.mjs makeHost, reduced): files in the shared map, picks answered by the test, a hook to make a command fail or answer oddly.
export function makeHost() {
  let pend = null;
  const saves = [];
  const base = createFileHost({ pick(a) { pend = a; }, cancelPick() { pend = null; }, saved(name, bytes, binary) { saves.push({ name, bytes: Array.from(bytes), binary }); } });
  const h = {
    base, files: base.files, saves, hook: null,
    get picking() { return base.picking; }, get log() { return base.log; },
    answer(name, bytes) { const a = pend; pend = null; if (!a) throw new Error('answer(): no pick is waiting'); a(name, bytes === undefined ? undefined : Uint8Array.from(bytes)); },
    count(n) { return base.log.filter((c) => c.n === n).length; },
    command(n, bytes, ans) {
      let r = base.command(n, bytes, ans);
      if (h.hook) { const r2 = h.hook(n, bytes, r); if (r2 !== undefined) r = r2; }
      return r;
    },
  };
  return h;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Booting Paint
/**
 * The shell booted (drawing off), Paint launched through it: how = 'menu' (the Leap menu's item 6, default) or 'icon' (a double click on the fourth icon); the pointer parked, a fake host on the bridge, the
 * stack watch and the program-image write watch armed.  env.st is the model (a PaintModel) the drivers keep in step.
 */
export function bootPaint(opts = {}) {
  const env = H.bootShell({ video: false, ...opts }), { m, S } = env;
  needPaint(S);
  if ((opts.how ?? 'menu') === 'menu') { H.leapMenu(env, 6); } else { const [x, y] = L.iconCentre(4); L.click(env, x, y, 3, 6); L.click(env, x, y, 3, 6); }
  if (L.waitProgram(env, 4, 160) < 0) throw new Error(`Paint did not start (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))})`);
  env.frames_(24);
  L.moveTo(env, PARK[0], PARK[1]); env.frames_(6);
  env.host = makeHost(); m.host = env.host;
  env.st = new P.PaintModel();
  env.stack = watchStack(m);
  // the program image ($C000 .. AL_RAM) may be written only in Paint's variables (PN_VARS .. PN_VARS_END) and in the status text buffer PN_STAT (a writable buffer that sits in the image part, before PN_MENUS); AL_RAM and the arena are not the image
  env.img = { n: 0, first: [], armed: true };
  env.vfBad = []; { const f0 = env.frame; env.frame = () => { const b = env.vf.bad; f0(); if (env.vf.bad > b) env.vfBad.push(`frame ${env.frames}${env.what ? ' (' + env.what + ')' : ''}`); }; env.frames_ = (n) => { for (let i = 0; i < n; i++) env.frame(); }; }
  const w0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (env.img.armed && a >= 0xC000 && a < S.AL_RAM && (a < S.PN_VARS || a >= S.PN_VARS_END) && !(a >= S.PN_STAT && a < S.PN_MENUS)) { env.img.n++; if (env.img.first.length < 6) env.img.first.push(`${hex(a)} <- ${hex(v, 2)}, PC ${hex(m.cpu.pc)}`); }
    w0(addr, v);
  };
  // every burst of the spray (entry of pn_spray) is logged with its centre (PN_NX, PN_NY: the screen position), the frame count and whether pn_idle called it: the machine's own timing decides how many bursts a stroke gets
  // (a burst takes up to 60,000 T, a frame has 58,688 T), so the model draws the bursts the machine STARTED, at the centres it used (`st.applyBursts`), and the tests check the centres and the counts against the pointer's moves.
  env.bursts = [];
  { const r0 = m.bus.read;
    m.bus.read = function (addr) {
      const a = addr & 0xFFFF;
      if (a === m.cpu.pc && a === S.pn_spray) {
        const ret = m.ram[m.cpu.sp] | (m.ram[m.cpu.sp + 1] << 8);      // called from pn_idle (the return address is inside it: pn_idle .. pn_spray) or from the event handlers
        env.bursts.push({ x: rd16(m, S.PN_NX), y: m.ram[S.PN_NY], f: env.frames, idle: ret >= S.pn_idle && ret < S.pn_spray });
      }
      return r0(addr);
    }; }
  if (globalThis.PT_BOOT_HOOK) globalThis.PT_BOOT_HOOK(env);       // a hook for experiments (a runner may patch the machine before the test uses it)
  return env;
}
/** The lowest address written in the stack's area [lo, $FF00) while armed: depth = $FF00 - min. */
export function watchStack(m, lo = 0xFE00) {
  const o = { min: 0xFF00 }, w0 = m.bus.write;
  m.bus.write = function (addr, v) { const a = addr & 0xFFFF; if (a >= lo && a < 0xFF00 && a < o.min) o.min = a; w0(addr, v); };
  o.depth = () => 0xFF00 - o.min;
  return o;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading the machine
export const strAt = (m, a) => (a ? String.fromCharCode(...m.ram.subarray(a + 1, a + 1 + m.ram[a])) : '');
export const picAddr = (env) => rd16(env.m, env.S.PN_PIC);
export const statusOf = (env) => strAt(env.m, rd16(env.m, rd16(env.m, env.S.PN_LBL) + env.S.Label_text));
export const paintWin = (env) => L.openWindows(env.m, env.S).find((w) => w.cls === env.S.CL_CWindow);
export const winTitle = (env) => { const w = paintWin(env); return w ? w.title : null; };
export const menuWord = (env, i) => rd16(env.m, env.S.MB_ENT + env.S.ME_SIZE * i + env.S.ME_EN);
/** The Paint window's children: [{ ...view, cls, ... }] in tree order. */
export function paintKids(env) {
  const { m, S } = env, w = paintWin(env), out = [];
  if (!w) return out;
  for (let v = w.child; v; v = L.readView(m, S, v).next) out.push(L.readView(m, S, v));
  return out;
}
/** The display's picture rectangle (128, 32, 320, 144) as the copy's planar bytes (header + two parts), straight from the display RAM: the parts in `swap` order. */
export function displayPlanar(env, swap = SWAP) {
  const d = readDisp(env.m), out = new Uint8Array(4 + 5760), ox = env.st.ox, oy = env.st.oy; out.set([(P.PIC.x + env.st.hox) >> 3, 40, P.PIC.y + env.st.hoy, 144]);
  for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { const c = 16 + (ox >> 3) + k; out[4 + ((k & 1) ^ (swap ? 1 : 0)) * 2880 + 20 * r + (k >> 1)] = c < 64 ? d[(32 + oy + r) * 64 + c] : 0; }
  return out;
}
/** Install a picture straight into the machine (test set-up, not Paint's own path): pixel (x, y) of the picture = bit(x, y); the model, the display RAM and the copy (in the machine's part order) follow. */
export function install(env, bit) {
  const { m } = env, st = env.st;
  for (let y = 0; y < 144; y++) for (let x = 0; x < 320; x++) st.pic.set(P.PIC.x + x, P.PIC.y + y, bit(x, y) ? 1 : 0);
  st.saveHdr();
  const cp = st.copyBytes(SWAP), pa = picAddr(env);
  m.ram.set(cp, pa);
  for (let r = 0; r < 144; r++) for (let k = 0; k < 40; k++) { const a = GA.addr(8 * (16 + (st.ox >> 3) + k), 32 + st.oy + r).hl; m.ram[a] = cp[4 + ((k & 1) ^ 1) * 2880 + 20 * r + (k >> 1)]; }
}
export const copyOf = (env) => env.m.ram.slice(picAddr(env), picAddr(env) + 4 + 5760);
export function firstDiffBytes(a, b) { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return i; return a.length === b.length ? -1 : Math.min(a.length, b.length); }
export const describeIdx = (i) => (i < 4 ? `header byte ${i}` : `part ${(i - 4) >= 2880 ? 2 : 1} row ${((i - 4) % 2880 / 20) | 0} byte ${(i - 4) % 20}`);

/** The first difference between two Gfx6Model-free display arrays inside the picture rectangle only (rows 32..175, bytes 16..55), as text or null. */
export function picDiff(got, want) {
  let n = 0, first = null;
  for (let r = 32; r < 176; r++) for (let c = 16; c < 56; c++) if (got[r * 64 + c] !== want[r * 64 + c]) { n++; first ??= `y ${r}, byte column ${c}: screen $${got[r * 64 + c].toString(16)}, want $${want[r * 64 + c].toString(16)}`; }
  return n ? `${n} byte(s) differ in the picture, first at ${first}` : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Dialogs
/** The ask / alert / name dialog on the desk: { kind: 'ask' | 'alert' | 'name', win } or null.  The ask and the alert share the rectangle (128, 64, 256, 64); they differ by their buttons. */
export function dialogKind(env) {
  const { m, S } = env, ws = L.openWindows(m, S).filter((w) => w.cls === S.CL_Dialog);
  if (ws.length !== 1) return null;
  const d = ws[0], r = (o) => d.x === o.x && d.y === o.y && d.w === o.w && d.h === o.h;
  if (r(W3.SAVE.dlg)) return { kind: 'name', win: d };
  if (r(W3.ALERT.dlg)) {
    const kids = []; for (let v = d.child; v; v = L.readView(m, S, v).next) kids.push(L.readView(m, S, v));
    const btns = kids.filter((k) => k.cls === S.CL_Button);
    return { kind: btns.length === 2 ? 'ask' : 'alert', win: d, kids };
  }
  return null;
}
/** The focus inside a dialog: ask: 1 Discard, 2 Cancel; name: 0 the Field, 1 Save, 2 Cancel; alert: 1 OK; -1 other. */
export function dialogFocus(env, dk) {
  const { m, S } = env, foc = rd16(m, S.K_FOCUS), d = dk.win;
  const def = rd16(m, d.a + S.Dialog_default), can = rd16(m, d.a + S.Dialog_cancel);
  if (dk.kind === 'name') { const f = dk.kids?.find?.((k) => k.cls === S.CL_Field); const fld = f ? f.a : L.allViews(m, S).find((v) => v.cls === S.CL_Field)?.a; return foc === fld ? 0 : foc === def ? 1 : foc === can ? 2 : -1; }
  return foc === def ? 1 : foc === can ? 2 : -1;
}
export const centreOf = (r) => [r.x + (r.w >> 1), r.y + (r.h >> 1)];
/** The model's drawing function for the dialog that is open (read from the machine's focus), or null. */
export function dialogFn(env, dk, extra = {}) {
  const f = dialogFocus(env, dk);
  if (dk.kind === 'ask') return (g) => WM.dialogDraw(g, f);
  if (dk.kind === 'alert') return (g) => W3.alertDraw(g, extra.msg, f === 1);
  return (g) => W3.saveDraw(g, extra.field, f);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The comparison of the machine with the model
/**
 * What Paint says it is, against the model `env.st` (or `st`): PN_TOOL, PN_DIRTY, PN_UNDO, the box variables, the Edit menu's enable word, the status text, the title, then the screen and the copy.
 * o: { dialog: a kind ('ask' | 'alert' | 'name') expected open (the screen is then rendered under it with the window inactive), msg, field, noCopy, noScreen, status: a string to expect instead of the model's,
 * adoptStatus: take the machine's status as the model's (a transition the contract does not specify), noBox }.  Returns true when everything held.
 */
export function check(env, sec, ctx, o = {}) {
  const { m, S } = env, st = o.st ?? env.st;
  let good = true;
  const t = (c, msg) => { good = sec.ok(c, msg) && good; };
  t(m.ram[S.K_PROG] === 4, () => `${ctx}: K_PROG ${m.ram[S.K_PROG]}, Paint (4) should be running`);
  t(m.ram[S.PN_TOOL] === st.tool, () => `${ctx}: PN_TOOL ${m.ram[S.PN_TOOL]}, model ${st.tool}`);
  t(m.ram[S.PN_PAT] === st.pat, () => `${ctx}: PN_PAT ${m.ram[S.PN_PAT]}, model ${st.pat}`);
  t(m.ram[S.PN_BRUSH] === st.brush, () => `${ctx}: PN_BRUSH ${m.ram[S.PN_BRUSH]}, model ${st.brush}`);
  { const rn = rd16(m, S.PN_RND); t(rn === st.rnd, () => `${ctx}: PN_RND ${hex(rn)}, model ${hex(st.rnd)} (the spray's LFSR: the machine drew a different number of random bytes than the model's bursts)`); }
  t(m.ram[S.PN_DIRTY] === (st.dirty ? 1 : 0), () => `${ctx}: PN_DIRTY ${m.ram[S.PN_DIRTY]}, model ${st.dirty ? 1 : 0}`);
  t(m.ram[S.PN_UNDO] === (st.undoOn ? 1 : 0), () => `${ctx}: PN_UNDO ${m.ram[S.PN_UNDO]}, model ${st.undoOn ? 1 : 0}`);
  if (st.undoOn && st.undoBox && !o.noBox) {
    const b = st.undoBox, got = [m.ram[S.PN_UB0], m.ram[S.PN_UBN], m.ram[S.PN_UR0], m.ram[S.PN_URN]];
    t(got.join() === [b.c0, b.nc, b.r0, b.nr].join(), () => `${ctx}: box (PN_UB0, PN_UBN, PN_UR0, PN_URN) ${got}, model (c0 ${b.c0}, nc ${b.nc}, r0 ${b.r0}, nr ${b.nr})`);
  }
  const mw = [menuWord(env, 0) & 0x1F, menuWord(env, 1) & 3, menuWord(env, 2) & 3], want = P.menuWords(st.undoOn, st.fill);
  t(mw[0] === want[0] && mw[1] === want[1] && mw[2] === want[2], () => `${ctx}: menu enable words File ${mw[0].toString(2)}, Edit ${mw[1].toString(2)}, Options ${mw[2].toString(2)}; model ${want[0].toString(2)}, ${want[1].toString(2)}, ${want[2].toString(2)}`);
  t(m.ram[S.PN_FILL] === (st.fill ? 1 : 0), () => `${ctx}: PN_FILL ${m.ram[S.PN_FILL]}, model ${st.fill ? 1 : 0}`);
  const stat = statusOf(env);
  if (o.adoptStatus) { if (stat !== st.status) sec.note?.(`${ctx}: status after this step is "${stat}", not "${st.status}" (the contract does not say)`); st.status = stat; }
  const wantStat = o.status ?? st.status;
  t(stat === wantStat, () => `${ctx}: status "${stat}", model "${wantStat}"`);
  const ttl = winTitle(env);
  t(ttl === (o.title ?? st.title), () => `${ctx}: window title "${ttl}", model "${o.title ?? st.title}"`);
  let dfn = null;
  if (o.dialog) {
    const dk = dialogKind(env);
    t(!!dk && dk.kind === o.dialog, () => `${ctx}: dialog ${dk ? dk.kind : 'none'}, want ${o.dialog}; windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))}`);
    if (dk) dfn = dialogFn(env, dk, o);
  } else t(L.openWindows(m, S).length === 1, () => `${ctx}: ${L.openWindows(m, S).length} windows, want 1`);
  if (!o.noScreen) {
    const g = P.renderScreen(st, { active: !o.dialog, dialog: dfn, status: wantStat, title: o.title ?? st.title });
    const d = diffDisp(readDisp(m), P.toDisp(g), L.pointerMask(m, S, o.extra || []));
    t(d === null, () => `${ctx}: the screen: ${d}`);
  }
  if (!o.noCopy) {
    const cp = copyOf(env), w = (o.copyOf ?? st).copyBytes(SWAP), i = firstDiffBytes(cp, w);
    t(i < 0, () => `${ctx}: the copy differs from the model at ${describeIdx(i)} (machine ${cp[i]}, model ${w[i]})`);
  }
  return good;
}
/** The picture's display against the copy, both read from the machine (pointer parked first): the strict form of "the copy is the display's picture rectangle" (PAINT 3, 5). */
export function copyIsDisplay(env, sec, ctx) {
  const dp = displayPlanar(env), cp = copyOf(env), i = firstDiffBytes(dp, cp);
  return sec.ok(i < 0, () => `${ctx}: the copy differs from the display's picture at ${describeIdx(i)} (copy ${cp[i]}, display ${dp[i]})`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Drivers
export const park = (env, frames = 4) => { const left = env.st.ox > 0; L.moveTo(env, left ? 20 : PARK[0], left ? 100 : PARK[1]); env.frames_(frames); };
/** Set the pointer to (x, y) in ONE frame (the counters move by the difference, at most 120 a frame): returns the position the machine reports. */
export function stepTo(env, x, y) {
  const { m, S } = env, [px, py] = L.pointerPos(m, S);
  const dx = Math.max(-120, Math.min(120, x - px)), dy = Math.max(-120, Math.min(120, y - py));
  m.mouse.x = (m.mouse.x + dx) & 0xFF; m.mouse.y = (m.mouse.y - dy) & 0xFF;
  env.frame();
  return L.pointerPos(m, S);
}
/**
 * A stroke with the current tool: the pointer moved to pts[0] (frames run, no button), the button down (one frame: the E_DOWN), then one frame per further point with the pointer there (one E_MOVE each), then
 * the release.  The model follows with the positions the machine reports.  o: { mid: (i) => void called after the frame of point i (mid-stroke checks), settle: frames after the release (default 14),
 * wait: frames after the press before the first move (default 0), gap: quiet frames after each further point (the brush's long segments take several frames), max: the largest step (default 100) before a point is split, noRelease }.  Returns { pts: the positions seen, box (the model's), before: the model before }.
 */
/** Points more than `max` apart in x or y get equally spaced points between them (the pointer moves at most 120 counts a frame). */
export function expand(pts, max = 100) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / max);
    for (let k = 1; k < n; k++) out.push([Math.round(x0 + (x1 - x0) * k / n), Math.round(y0 + (y1 - y0) * k / n)]);
    out.push(pts[i]);
  }
  return out;
}
export function stroke(env, pts, o = {}) {
  const { m, st } = env;
  pts = expand(pts, o.max ?? 100);
  L.moveTo(env, pts[0][0], pts[0][1]); env.frames_(2);
  const before = st.clone();
  m.mouse.buttons = L.MOUSE_LEFT; env.frame();
  const [px0, py0] = L.pointerPos(m, env.S);
  const seen = [[px0, py0]];
  const began = st.press(px0, py0);
  if (o.wait) { env.frames_(o.wait); if (began) for (let k = 0; k < o.wait; k++) st.held('still'); }
  if (o.mid) o.mid(0, seen);
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = stepTo(env, pts[i][0], pts[i][1]);
    seen.push([px, py]);
    if (began) {
      const moved = px !== seen[i - 1][0] || py !== seen[i - 1][1]; st.held(moved ? 'move' : 'still'); if (moved) st.move(px, py);
    }
    if (o.gap) { env.frames_(o.gap); if (began) for (let k = 0; k < o.gap; k++) st.held('still'); }
    if (o.mid) o.mid(i, seen);
  }
  let box = null, bursts = [], burstBad = 0, burstDup = 0;
  if (!o.noRelease) {
    m.mouse.buttons = L.MOUSE_UP; env.frame();
    if (began) st.held('up');
    box = began ? st.release() : null;
    env.frames_(o.settle ?? 14);
    if (began) { const bl = env.bursts.splice(0); burstBad = bl.filter((b) => !seen.some(([x, y]) => x === b.x && y === b.y)).length; burstDup = bl.filter((b, i) => i > 0 && bl[i - 1].f === b.f).length; bursts = bl; st.applyBursts(bl); }
  }
  return { pts: seen, box, before, began, bursts, burstBad, burstDup };
}
/** A click (press and release in place) on the tool box cell of tool t. */
export function chooseTool(env, t) { const c = P.cellOf(t); L.click(env, c.x + env.st.ox + 16, c.y + env.st.oy + 8, 3, 6); park(env, 3); }
/** A click on pattern swatch p (the model is not changed here: the caller calls st.choosePat) / on brush cell b. */
export function choosePattern(env, p) { const c = P.swatchOf(p); L.click(env, c.x + env.st.ox + 8, c.y + env.st.oy + 6, 3, 6); park(env, 3); }
export function chooseBrush(env, b) { const c = P.brushCell(b); L.click(env, c.x + env.st.ox + 8, c.y + env.st.oy + 8, 3, 6); park(env, 3); }
/** The menu bar by the pointer: press on the title of menu `mi` (0 File, 1 Edit, 2 Options), move to item `ii`, release.  Returns nothing; the caller settles. */
export function menuPick(env, mi, ii, { settle = 10 } = {}) {
  const { m } = env, lay = P.layoutOf(P.MENUS), b = lay.boxes[mi], d = lay.drops[mi];
  L.moveTo(env, b.x + (b.w >> 1), 3); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, d.x + 12, 9 + 10 * ii + 5); env.frames_(2);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(settle);
}
/** Click the ask's button ('discard' | 'cancel'), or press ENTER / ESC. */
export function askAnswer(env, how) {
  if (how === 'discard') { const [x, y] = centreOf(WM.DLG.discard); L.click(env, x, y, 3, 6); }
  else if (how === 'cancel') { const [x, y] = centreOf(WM.DLG.cancel); L.click(env, x, y, 3, 6); }
  else if (how === 'enter') L.typeCode(env, 13, 3, 3);
  else if (how === 'esc') L.typeCode(env, 27, 3, 3);
  else throw new Error(`askAnswer ${how}`);
  env.frames_(24);
  park(env, 3);
}
/** The alert's OK: ENTER or a click. */
export function alertOk(env, how = 'enter') {
  if (how === 'enter') L.typeCode(env, 13, 3, 3); else { const [x, y] = centreOf(W3.ALERT.ok); L.click(env, x, y, 3, 6); }
  env.frames_(24); park(env, 3);
}
/** Type text into the focused name Field (the Field model follows). */
export function fieldType(env, f, s) { for (const c of (typeof s === 'string' ? WM.codesOf(s) : s)) { L.typeCode(env, c, 3, 3); W3.fieldTyped(f, c); } }
export const fieldDelete = (env, f, n) => { for (let i = 0; i < n; i++) { L.typeCode(env, 12, 3, 3); W3.fieldTyped(f, 12); } };
/** Run frames until `f()` or `max` frames; returns whether it held. */
export function until(env, f, max = 120) { for (let i = 0; i <= max; i++) { if (f()) return true; if (i < max) env.frame(); } return false; }

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Timing: the busy periods of the program's loop (an ISR entry to the next HALT), as tests/kc-lib.mjs traceLoop / periodsOf
export function traceLoop(env, marks = []) {
  const { m } = env, cpu = m.cpu, ev = [], r0 = m.bus.read, ms = new Set(marks);
  let h = cpu.halted;
  m.bus.read = function (addr) {
    const a = addr & 0xFFFF;
    if (a === cpu.pc) { if (a === 0x38) ev.push({ e: 'ISR', t: m.tstates }); else if (ms.has(a)) ev.push({ e: 'MARK', pc: a, t: m.tstates }); }
    return r0(addr);
  };
  Object.defineProperty(cpu, 'halted', { configurable: true, get: () => h, set: (v) => { if (v && !h) ev.push({ e: 'HALT', t: m.tstates }); h = v; } });
  return { ev, stop() { m.bus.read = r0; Object.defineProperty(cpu, 'halted', { configurable: true, writable: true, enumerable: true, value: h }); return ev; } };
}
/** The busy periods [{ t0 (ISR entry), t1 (HALT) }] of a trace (an ISR while a period is open does not start a new one). */
export function periodsOf(ev) {
  const out = []; let cur = null;
  for (const x of ev) {
    if (x.e === 'ISR' && !cur) cur = { t0: x.t, t1: null };
    else if (x.e === 'HALT' && cur) { cur.t1 = x.t; out.push(cur); cur = null; }
  }
  return out;
}
/** For each entry of the routine at `pc` in a trace: the T-states to the next HALT (the loop idle again), a list. */
export function spansFrom(ev, pc) {
  const out = [];
  for (let i = 0; i < ev.length; i++) if (ev[i].e === 'MARK' && ev[i].pc === pc) { const h = ev.slice(i + 1).find((x) => x.e === 'HALT'); if (h) out.push(h.t - ev[i].t); }
  return out;
}
/** Run `f()` (which runs frames) under a trace; returns the busy periods (and the trace as .ev). */
export function busy(env, f, marks = []) { const tr = traceLoop(env, marks); try { f(); } finally { tr.stop(); } const p = periodsOf(tr.ev); p.ev = tr.ev; return p; }
