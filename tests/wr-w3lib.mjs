"use strict";
// wr-w3lib.mjs -- harness of the Write W3 tests (tests/wr-w3.mjs, the W3 rows of tests/wr-perf.mjs): a fake file host with failure hooks, the machine's W3 state read back against tests/wr-w3model.mjs,
// the screen (title, the Save dialog, the alert) against the model, and a driver for Write's "File" menu over real frames.
// Written from docs/WRITE.md 13, docs/FILES.md and the main model's as-built list; the Z80 sources were not used for any expectation.
import * as W from './wr-lib.mjs';
import * as W3 from './wr-w3model.mjs';
import { createFileHost } from '../web/fshost.js';

export { W, W3 };
export const { L, T, X, WM, hex, rd16, E, readDisp, diffDisp } = W;
export const W3_NEEDED = ['WR_NAME', 'WR_TITLE', 'WR_SDLG', 'WR_ADLG', 'WR_SFLD', 'WR_FBUF', 'WR_PNAME', 'WR_DK', 'WR_MENU', 'FS_PICK', 'FS_OPEN', 'FS_READ', 'FS_WRITE', 'FS_CLOSE', 'FS_BEGIN', 'FS_END',
  'Dialog_default', 'Dialog_cancel', 'MB_ENT', 'ME_EN', 'ME_SIZE'];
export function needW3(S) { const miss = W3_NEEDED.filter((n) => S[n] === undefined); if (miss.length) throw new Error(`desk5 has no Write W3 / files module: it does not define ${miss.join(', ')}`); }

/**
 * A host for TSRun's bridge: web/fshost.js's shared host (files, text conversion, the pick answered by the test) with hooks to make single commands fail or answer oddly:
 *   h.answer(name, bytes) / h.answer(null)   answer the pick that is waiting (a pick must be waiting: h.picking)
 *   h.raw = 'name'                           the next picks answer at once with this name, as the host gave it (no usable-name conversion): for names the FS_ calls refuse
 *   h.hook = (n, bytes, result) => result    change the answer of a command (n 1 pick .. 5 close); return undefined to keep it
 *   h.saves                                  every file written and closed: { name, bytes (host bytes), binary }
 *   h.log                                    every command the host got: { n, bytes }
 */
export function makeHost() {
  let pend = null;
  const saves = [];
  const base = createFileHost({ pick(a) { pend = a; }, cancelPick() { pend = null; }, saved(name, bytes, binary) { saves.push({ name, bytes: Array.from(bytes), binary }); } });
  const h = {
    base, files: base.files, saves, raw: null, hook: null,
    get picking() { return base.picking; }, get log() { return base.log; },
    answer(name, bytes) { const a = pend; pend = null; if (!a) throw new Error('answer(): no pick is waiting'); a(name, bytes === undefined ? undefined : Uint8Array.from(bytes)); },
    count(n) { return base.log.filter((c) => c.n === n).length; },
    command(n, bytes, ans) {
      if (n === 1 && h.raw !== null) {
        base.log.push({ n, bytes: Uint8Array.from(bytes) });
        const nm = h.raw;
        return { status: 1, data: [nm.length, ...Array.from(nm, (c) => c.charCodeAt(0))] };
      }
      let r = base.command(n, bytes, ans);
      if (h.hook) { const r2 = h.hook(n, bytes, r); if (r2 !== undefined) r = r2; }
      return r;
    },
  };
  return h;
}

/** Write, started through the shell, with a fake host on the bridge, the memory watch and V_FRAMES check as in wr-lib; `st` is the model { doc, name } that the driver keeps in step. */
export function bootW3(opts = {}) {
  const env = W.bootWrite2(opts);
  needW3(env.S);
  const host = makeHost();
  env.m.host = host;
  env.host = host;
  env.st = new W3.W3();
  // W3 memory watch (13.7: $C000-$C3FF, Write's image and the RAM after it, below the arena): writes are allowed only into Write's variables: from WR_BUF to the end of WR_PNAME's 32 bytes
  const { m, S } = env, lo = S.WR_BUF, hi = Math.max(S.WR_PNAME + 32, S.WR_FFB !== undefined ? S.WR_FFB + 32 : 0, S.WR_XEND !== undefined ? S.WR_XEND + 2 : 0);   // W4: WR_FN, F's codes (WR_FCODES) and the Find Field's buffer WR_FFB (31 bytes) are in this range too
  env.imgw = { n: 0, first: [], armed: true, lo, hi, log: new Map() };
  const wr0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (env.imgw.armed && a >= 0xC000 && a < 0xC400 && (a < lo || a >= hi) && !(a >= (S.AL_RAM ?? 0xC3C0))) {   // AL_RAM ($C3C0-$C3FF) belongs to the app library (APPLIB 1): AL_INIT, AL_NAMEDLG's AL_FLD
      env.imgw.n++; if (env.imgw.first.length < 8) env.imgw.first.push(`${hex(a)} <- ${hex(v, 2)}, PC ${hex(m.cpu.pc)}`);
    }
    wr0(addr, v);
  };
  return env;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Reading the machine
export const strAt = (m, a) => Array.from(m.ram.subarray(a + 1, a + 1 + m.ram[a]));
export const nameOf = (env) => strAt(env.m, env.S.WR_NAME);
export const titleOf = (env) => strAt(env.m, env.S.WR_TITLE);
/** The Save dialog's / alert's windows, when open (rectangles of 13.2 / 13.4). */
export function dlgOpen(env, which) {
  const { m, S } = env, r = which === 'save' ? W3.SAVE.dlg : which === 'alert' ? W3.ALERT.dlg : WM.DLG;
  const ws = L.openWindows(m, S);
  return ws.length === 2 && ws.some((w) => w.cls === S.CL_Dialog && w.x === r.x && w.y === r.y && w.w === r.w && w.h === r.h);
}

/** The screen (the pointer left out) against the model: the window's title is the model's, `dlg` (a function drawing a dialog onto g, or null) is drawn last. */
export function screenDiff(env, st, dlg = null) {
  const { m, S } = env, o = W.objs(env), foc = rd16(m, S.K_FOCUS);
  const g = WM.renderScreen(st.doc, { focus: foc === o.tv && !!o.tv, dialog: dlg ? { draw: dlg } : null, barValue: o.bar ? m.ram[o.bar + S.VScroll_value] : null, title: st.title });
  return diffDisp(readDisp(m), WM.toDisp(g), L.pointerMask(m, S));
}
/** The discard dialog (WRITE 11.6) as a drawing function: the focus read from K_FOCUS (Discard 1, Cancel 2). */
export function discardFn(env) {
  const { m } = env, b = W.dialogButtons(env), foc = rd16(m, env.S.K_FOCUS);
  const focusBtn = b && foc === b.discard.a ? 1 : b && foc === b.cancel.a ? 2 : 0;
  return (g) => WM.dialogDraw(g, focusBtn);
}
/** The alert's drawing function for `msg` (focused: the default button holds the focus, as the discard dialog does when it opens). */
export function alertFn(env, msg) {
  const { m, S } = env, d = rd16(m, S.WR_ADLG), def = d ? rd16(m, d + S.Dialog_default) : 0;
  return (g) => W3.alertDraw(g, msg, !!def && rd16(m, S.K_FOCUS) === def);
}
/** The Save dialog's drawing function for the Field model `f`; the focus is read from K_FOCUS (the Field, the Save button, the Cancel button). */
export function saveFn(env, f, tx = null) {
  const { m, S } = env, d = rd16(m, S.WR_SDLG), fld = rd16(m, S.WR_SFLD), foc = rd16(m, S.K_FOCUS);
  const focus = foc === fld ? 0 : d && foc === rd16(m, d + S.Dialog_default) ? 1 : d && foc === rd16(m, d + S.Dialog_cancel) ? 2 : -1;
  return (g) => W3.saveDraw(g, f, focus, tx);
}

/**
 * Every W3 check after a step, into `sec`: the document (text, caret, top, changed, line table, bar), the selection and clipboard, the Edit menu's enable bits, the name, the title, WR_DK, the screen.
 * o: { dk: 0 | 1 | 2 | 3 (WR_DK: 1 Save, 2 alert, 3 Find), dlg (function | null), msg, field (Field model, for dk 1 and 3) }.
 */
export function check(env, sec, ctx, o = {}) {
  const { m, S } = env, st = env.st, doc = st.doc, dk = o.dk ?? 0;
  const sd = W.stateDiff(env, doc), d = sd.doc.concat(sd.lt, sd.bar).filter((x) => !((dk || o.discard) && x.startsWith('K_FOCUS')));
  sec.ok(d.length === 0, () => `${ctx}: ${d[0]} [${W.describe(doc)}]`);
  const s2 = W.stateDiff2(env, doc), d2 = [...s2.sel, ...s2.clip];
  sec.ok(d2.length === 0, () => `${ctx}: ${d2[0]}`);
  const d4 = W.stateDiff4(env, doc);
  sec.ok(d4.length === 0, () => `${ctx}: ${d4[0]}`);
  const want = W.wantBits(doc), mask = [1, 0xFF];
  for (let i = 0; i < 2; i++) { const got = W.menuBits(env, i) & mask[i]; sec.ok(got === want[i], () => `${ctx}: menu ${i} enable bits ${got.toString(2)}, model ${want[i].toString(2)}`); }
  const nm = nameOf(env), tt = titleOf(env);
  sec.ok(WM.textOf(nm) === WM.textOf(st.name), () => `${ctx}: WR_NAME ${JSON.stringify(WM.textOf(nm))}, model ${JSON.stringify(WM.textOf(st.name))}`);
  sec.ok(WM.textOf(tt) === st.title, () => `${ctx}: WR_TITLE ${JSON.stringify(WM.textOf(tt))}, model ${JSON.stringify(st.title)}`);
  sec.ok(m.ram[S.WR_DK] === dk, () => `${ctx}: WR_DK ${m.ram[S.WR_DK]}, want ${dk}`);
  sec.ok(m.ram[S.K_PROG] === 3, () => `${ctx}: K_PROG ${m.ram[S.K_PROG]}, Write should be running`);
  const dlg = o.dlg !== undefined ? o.dlg : o.discard ? discardFn(env) : dk === 2 ? alertFn(env, o.msg) : dk === 1 ? saveFn(env, o.field) : dk === 3 ? saveFn(env, o.field, W3.FIND) : null;      // W4: dk 3 = the Find dialog (the Save dialog re-labelled, 14.9 item 4)
  const sc = screenDiff(env, st, dlg);
  sec.ok(sc === null, () => `${ctx}: screen ${sc} [${W.describe(doc)}; title ${st.title}${dk ? '; dialog ' + dk : ''}]`);
  const open = o.discard ? W.dialogUp(env) : dk === 1 || dk === 3 ? dlgOpen(env, 'save') : dk === 2 ? dlgOpen(env, 'alert') : (L.openWindows(m, S).length === 1);
  sec.ok(open, () => `${ctx}: windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))}, dialog state ${dk}`);
  return d.length === 0 && sc === null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Driving Write over real frames
/** The centre of a rectangle { x, y, w, h }. */
export const centreOf = (r) => [r.x + (r.w >> 1), r.y + (r.h >> 1)];
export const KEYS = { DELETE: 12, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, ENTER: 13, MENU: 16, ESC: 27, BREAK: 3 };
export const key = (env, code, hold = 3, rel = 3) => L.typeCode(env, code, hold, rel);
/** Type `s` into whatever has the focus (the text view or the Save dialog's Field), through the keyboard; `each` (ctx function) after each code when given. */
export function typeText(env, s, each = null) { for (const c of (typeof s === 'string' ? WM.codesOf(s) : s)) { key(env, c); if (each) each(c); } }
/** The "File" menu by the keyboard (MENU, DOWN k times, ENTER): k 0 New, 1 Open..., 2 Save... */
export function fileMenu(env, k) { key(env, KEYS.MENU); for (let i = 0; i < k; i++) key(env, KEYS.DOWN); key(env, KEYS.ENTER); }
/** Run frames until `f()` or `max` frames; returns whether it held. */
export function until(env, f, max = 120) { for (let i = 0; i <= max; i++) { if (f()) return true; if (i < max) env.frame(); } return false; }
/** Frames for the screen and the state to settle: `n` (default 40; a 5,120-code Open needs more). */
export const settle = (env, n = 40) => env.frames_(n);
/** A pick is waiting (Open... ran up to FS_PICK). */
export const picking = (env) => env.host.picking;
/** A key to the text view, the model (env.st.doc) following (W.Doc_key). */
export function keyDoc(env, code, hold = 3, rel = 3) { key(env, code, hold, rel); W.Doc_key(env.st.doc, code); }
export function typeDoc(env, s) { for (const c of (typeof s === 'string' ? WM.codesOf(s) : s)) keyDoc(env, c); }
