"use strict";
// al-a1.mjs -- the app library (docs/APPLIB.md, src/apps/applib.asm) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from the contract (APPLIB 1-4, 7) and the lead's brief; src/apps/applib.asm was never read for any expectation.  The harness is Notepad's: bootWrite2 + parkDirect (a running desk5,
// Notepad's image at $C000, AL_RAM written by its AL_INIT), then each call is CALLed under mapping A with interrupts on: T.runCall(env, S.AL_xxx, regs, { map: 'A', ints: true }).
// Every case starts from the parked machine's snapshot (restore), so the arena never fills; the program's words and buffers are K_ALLOC blocks (RAM, never DOCK 2-3 or 6).
//   node tests/al-a1.mjs [--seed N] [--nrand N] [--only LIST] [--verbose]
//     --nrand N    random view tables in group 2 (default 40)
//     --only LIST  groups: 1 AL_INIT's RAM, 2 AL_VIEWS (tables of every role, random tables), 3 AL_DIALOG (made once, then reused), 4 AL_EXTNAME, 5 AL_TITLE,
//                  6 AL_ALERT, 7 AL_ASK, 8 AL_NAMEDLG, 9 stack <= 128 and the registers (IY and the alternate set, sentinel patterns).
//                  The edge groups 2b (a Window parent takes no roles), 4b (AL_EXTNAME of an empty name) and 5b (AL_TITLE with an empty prefix or an empty name) run with 2, 4 and 5.
// The last line is "al-a1: N of M groups pass"; exit code 1 on any failure.
//
// What the model takes from the contract (and where it had to read between the lines):
//   * AL_VIEWS: each table entry is made by K_NEW (13-byte entries, APPLIB 3), its rectangle / flags / id / word set, added as the parent's LAST child; for a Dialog parent role bit 0 / 1 sets
//     Dialog_default / Dialog_cancel; role bit 2 = a Field of cap 30; IX = the parent on return.  For a Window parent the roles set nothing (the contract names a Dialog parent only).
//   * AL_DIALOG: the first call makes the Dialog (K_NEW, its 8 bytes: x w, y, w w, h, flags, id) and its views and stores it in the word; later calls return the stored dialog and make nothing.
//   * AL_ALERT / AL_ASK / AL_NAMEDLG: section 4's rectangles; the dialog is open afterwards (a window in W_SLOTS, W_MODAL = the dialog) and the focus is on the default button (alert, ask) or the Field (name dialog).
//   * AL_EXTNAME: ext added when the name has no "." (any position) and len + 4 <= 30; the empty name therefore becomes the extension alone.
//   * AL_TITLE: the buffer = length byte, prefix, name (<= 39 codes); Window_title = BC; W_INVAL of (x, y, w, 8) with carry SET on entry, none with carry clear (the lead's brief: "the dirty title row
//     only with carry set"; the contract's table does not say it).
import * as W from './wr-lib.mjs';
import * as W3 from './wr-w3model.mjs';
import * as Q from './wr-w3lib.mjs';

const { L, T, X, WM, hex, rd16 } = W;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NRAND = argNum('--nrand', 40);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('al-a1', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NRAND} random tables`);

const AL_NEEDED = ['AL_RAM', 'AL_INIT', 'AL_VIEWS', 'AL_DIALOG', 'AL_ALERT', 'AL_ASK', 'AL_NAMEDLG', 'AL_TITLE', 'AL_EXTNAME', 'K_NEW', 'K_ALLOC', 'K_ADDCHILD', 'W_INVAL', 'W_UPDATE', 'W_OPEN', 'W_CLOSE',
  'GA', 'CL_Dialog', 'CL_Window', 'CL_Label', 'CL_Button', 'CL_Check', 'CL_Field', 'Dialog_default', 'Dialog_cancel', 'Field_buf', 'Field_cap', 'Field_caret', 'Field_first', 'Label_text', 'Button_text',
  'Check_text', 'Window_title', 'View_child', 'View_next', 'View_parent', 'View_x', 'View_y', 'View_w', 'View_h', 'View_flags', 'View_id', 'W_DIRTY', 'W_MODAL', 'K_FOCUS', 'WR_WIN'];
const env = (() => {
  const miss = AL_NEEDED.filter((n) => L.loadDesk5().S[n] === undefined);
  if (miss.length) { console.log(`FAIL: desk5 does not define: ${miss.join(', ')}`); process.exit(1); }
  const e = W.bootWrite2({ rng });
  W.parkDirect(e);
  return e;
})();
const { m, S } = env;
env.rng = rng;
env.st = new W3.W3();                                  // the model of Notepad under the dialogs: an empty document, "Notepad: Untitled"
W3.setGlh(8);                                          // the two-line alert: G_TEXTP's 13 moves down 8 rows (as wr-w3 settled it on this machine)
const AL_RAM = S.AL_RAM, AL_LEN = 64;
const codes = WM.codesOf;
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const show = (cs) => JSON.stringify(String.fromCharCode(...cs));
const reset = () => { W.resetDoc(env); env.st = new W3.W3(); };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Helpers
const alloc = (n) => { const r = T.runCall(env, S.K_ALLOC, { bc: n }, { ints: false }); if (r.carry) throw new Error('K_ALLOC: arena full'); const a = r.regs.hl; m.ram.fill(0, a, a + n); return a; };
const putStr = (codesIn) => { const a = alloc(codesIn.length + 1); m.ram[a] = codesIn.length; codesIn.forEach((c, i) => { m.ram[a + 1 + i] = c; }); return a; };
const strAt = (a) => Array.from(m.ram.subarray(a + 1, a + 1 + m.ram[a]));
const poke16 = (a, v) => T.poke16(env, a, v);
const rd8 = (a) => m.ram[a];
const inRam = (a) => a >= 0xC000 && a < 0xFFFF;
const inAlRam = (a) => a >= AL_RAM && a < AL_RAM + AL_LEN;
const kNew = (cls) => T.kNew(env, cls);

/** Statistics per call, for group 9 and the notes. */
const stats = {};
let calls = 0;
/** One library call under mapping A, interrupts on, the sentinel return; checks SP after the return, IY / the alternate set (and IX unless ixOut) kept, and records the stack depth. */
function call(sec, name, regs, ctx, o = {}) {
  let r;
  try { r = T.runCall(env, S[name], regs, { map: 'A', ints: true, ixOut: o.ixOut, hooks: o.hooks, guard: 2_000_000 }); }
  catch (e) { sec.ok(false, `${ctx}: ${name} crashed: ${e.message.replace(/^runCall \$[0-9A-F]+: /, '')}`); return { crashed: true, regs: { ix: 0 }, preserved: [], stack: 0, t: 0, di: 0, carry: 0 }; }
  calls++;
  const st = (stats[name] ??= { n: 0, stack: 0, t: 0, di: 0 });
  st.n++; st.stack = Math.max(st.stack, r.stack); st.t = Math.max(st.t, r.t); st.di += r.di;
  sec.ok(r.preserved.length === 0, () => `${ctx}: ${name} did not keep ${r.preserved.join(',')}`);
  sec.ok(r.badSp === undefined, () => `${ctx}: ${name}: SP ${hex(r.badSp ?? 0)} after the return`);
  sec.ok(r.stack <= 128, () => `${ctx}: ${name}: stack ${r.stack} bytes (bound 128)`);
  return r;
}
/** A hook counter: hits of K_NEW (and K_ADDCHILD) during a call. */
const counter = () => { const c = { newN: 0, addN: 0 }; return { c, hooks: { [S.K_NEW]: () => { c.newN++; }, [S.K_ADDCHILD]: () => { c.addN++; } } }; };

/** The view at `a`, as read from RAM (calc-lib's readView) plus its parent and its word at offset 16. */
const view = (a) => ({ ...L.readView(m, S, a), parent: rd16(m, a + S.View_parent), word: rd16(m, a + 16) });
/** The children of `p`, in order. */
function kids(p) { const out = []; for (let v = rd16(m, p + S.View_child), n = 0; v && n < 40; v = rd16(m, v + S.View_next), n++) out.push(view(v)); return out; }

// A table entry { cls, x, y, w, h, flags, id, role, word } as the 13 bytes of APPLIB 3; the table ends with DW 0 (followed by junk that must not be read).
function tableBytes(entries) {
  const b = [];
  const w = (v) => b.push(v & 255, (v >> 8) & 255);
  for (const e of entries) { w(e.cls); w(e.x); b.push(e.y & 255); w(e.w); b.push(e.h & 255, e.flags & 255, e.id & 255, e.role & 255); w(e.word); }
  w(0); b.push(0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE, 0xEE);
  return b;
}
const putBytes = (bytes) => { const a = alloc(bytes.length); bytes.forEach((v, i) => { m.ram[a + i] = v; }); return a; };
const putTable = (entries) => putBytes(tableBytes(entries));
const CLS = { Label: () => S.CL_Label, Button: () => S.CL_Button, Check: () => S.CL_Check, Field: () => S.CL_Field };
const CLN = (c) => (c === S.CL_Label ? 'Label' : c === S.CL_Button ? 'Button' : c === S.CL_Check ? 'Check' : c === S.CL_Field ? 'Field' : c === S.CL_Dialog ? 'Dialog' : c === S.CL_Window ? 'Window' : hex(c));

/** Check the views under `parent` against the entries (and the parent's default / cancel for a Dialog); `before` = the children that were there already. */
function checkViews(sec, ctx, parent, entries, before, isDialog, defBefore = 0, canBefore = 0) {
  const ks = kids(parent), want = before.length + entries.length;
  sec.ok(ks.length === want, () => `${ctx}: ${ks.length} children, want ${want}`);
  before.forEach((a, i) => sec.ok(ks[i] && ks[i].a === a, () => `${ctx}: pre-existing child ${i} is ${hex(ks[i]?.a ?? 0)}, want ${hex(a)} (the new views are added LAST)`));
  let def = defBefore, can = canBefore;
  entries.forEach((e, i) => {
    const v = ks[before.length + i];
    if (!v) { sec.ok(false, `${ctx}: view ${i} is missing`); return; }
    const c = `${ctx}: view ${i} (${CLN(e.cls)}, role ${e.role})`;
    sec.ok(v.cls === e.cls, () => `${c}: class ${hex(v.cls)}, want ${hex(e.cls)}`);
    sec.ok(v.parent === parent, () => `${c}: parent ${hex(v.parent)}, want ${hex(parent)}`);
    sec.ok(v.x === e.x && v.y === e.y && v.w === e.w && v.h === e.h, () => `${c}: rect (${v.x}, ${v.y}, ${v.w}, ${v.h}), want (${e.x}, ${e.y}, ${e.w}, ${e.h})`);
    sec.ok(v.flags === (e.flags & 255) && v.id === (e.id & 255), () => `${c}: flags ${v.flags} id ${v.id}, want ${e.flags & 255} / ${e.id & 255}`);
    sec.ok(v.word === e.word, () => `${c}: the word at 16 is ${hex(v.word)}, want ${hex(e.word)}`);
    sec.ok(v.child === 0, () => `${c}: a new view has child ${hex(v.child)}`);
    sec.ok(i === entries.length - 1 ? v.next === 0 : v.next === ks[before.length + i + 1]?.a, () => `${c}: next ${hex(v.next)}`);
    if (e.role & 4) sec.ok(rd8(v.a + S.Field_cap) === 30, () => `${c}: Field cap ${rd8(v.a + S.Field_cap)}, want 30`);
    if (isDialog && (e.role & 1)) def = v.a;
    if (isDialog && (e.role & 2)) can = v.a;
  });
  if (isDialog) {
    sec.ok(rd16(m, parent + S.Dialog_default) === def, () => `${ctx}: Dialog_default ${hex(rd16(m, parent + S.Dialog_default))}, want ${hex(def)}`);
    sec.ok(rd16(m, parent + S.Dialog_cancel) === can, () => `${ctx}: Dialog_cancel ${hex(rd16(m, parent + S.Dialog_cancel))}, want ${hex(can)}`);
  }
}

// The windows: the dialog open on the desk.
const dlgOf = (addr) => ({ w: L.openWindows(m, S).find((x) => x.a === addr), n: L.openWindows(m, S).length });
function checkOpen(sec, ctx, dlg, r) {
  const { w, n } = dlgOf(dlg);
  sec.ok(!!w && w.cls === S.CL_Dialog && w.x === r.x && w.y === r.y && w.w === r.w && w.h === r.h, () => `${ctx}: the dialog is not open at (${r.x}, ${r.y}, ${r.w}, ${r.h}); windows ${JSON.stringify(L.openWindows(m, S).map((x) => [hex(x.a), x.x, x.y, x.w, x.h]))}`);
  sec.ok(n === 2, () => `${ctx}: ${n} windows open, want 2 (Notepad and the dialog)`);
  sec.ok(rd16(m, S.W_MODAL) === dlg, () => `${ctx}: W_MODAL ${hex(rd16(m, S.W_MODAL))}, want the dialog ${hex(dlg)}`);
}
const update = () => T.runCall(env, S.W_UPDATE, {}, { ints: false });
/** The screen (pointer masked) against Notepad's model with the dialog function drawn on top; null when equal. */
const screen = (fn) => Q.screenDiff(env, env.st, fn);
const closeDlg = (dlg) => { T.runCall(env, S.W_CLOSE, { ix: dlg }, { ints: false }); update(); };

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 1. AL_INIT's RAM
if (has('1')) {
  const sec = new Sec('1 AL_INIT: writes AL_RAM ($C3C0-$C3FF) only: "OK", "Cancel", "Discard" and "Discard the document?" as length-prefixed strings; nothing else in the program image or the arena; AF BC DE HL clobbered, the rest kept; the same again when called twice');
  const want = ['OK', 'Cancel', 'Discard', 'Discard the document?'];
  const findStr = (s) => { const cs = codes(s); for (let i = 0; i < AL_LEN - cs.length; i++) if (m.ram[AL_RAM + i] === cs.length && cs.every((c, j) => m.ram[AL_RAM + i + 1 + j] === c)) return AL_RAM + i; return -1; };
  sec.ok(AL_RAM === 0xC3C0, () => `AL_RAM is ${hex(AL_RAM)}, the contract says $C3C0`);
  // as booted (Notepad's own AL_INIT wrote it)
  for (const s of want) sec.ok(findStr(s) >= 0, () => `as booted: ${show(codes(s))} is not in AL_RAM`);
  let first = null;
  for (const noise of [0x00, 0xA5, 0xFF, 'rnd']) {
    reset();
    for (let i = 0; i < AL_LEN; i++) m.ram[AL_RAM + i] = noise === 'rnd' ? rng.int(0, 255) : noise;
    const before = m.ram.slice(0xC000, 0xE000);
    const r = call(sec, 'AL_INIT', {}, `AL_INIT over ${noise === 'rnd' ? 'random' : hex(noise, 2)} fill`);
    for (const s of want) { const a = findStr(s); sec.ok(a >= 0, () => `AL_INIT over ${noise === 'rnd' ? 'random' : hex(noise, 2)}: ${show(codes(s))} is not in AL_RAM`); }
    const stray = [];
    for (let i = 0; i < 0x2000; i++) { const a = 0xC000 + i; if (!inAlRam(a) && m.ram[a] !== before[i]) stray.push(a); }
    sec.ok(stray.length === 0, () => `AL_INIT over ${noise === 'rnd' ? 'random' : hex(noise, 2)}: wrote outside AL_RAM, e.g. ${stray.slice(0, 4).map((a) => hex(a)).join(' ')} (${stray.length} bytes of $C000-$DFFF)`);
    // the strings are the same whatever was there before
    const strs = want.map((s) => strAt(findStr(s)));
    if (!first) first = strs; else sec.ok(strs.every((s, i) => eq(s, first[i])), () => `AL_INIT's strings differ with the fill ${noise}`);
    // twice
    const a1 = Array.from(m.ram.subarray(AL_RAM, AL_RAM + AL_LEN));
    call(sec, 'AL_INIT', {}, 'AL_INIT again');
    sec.ok(eq(a1, Array.from(m.ram.subarray(AL_RAM, AL_RAM + AL_LEN))), () => 'AL_INIT called twice changes AL_RAM');
    sec.ok(r.stack <= 128, () => `stack ${r.stack}`);
  }
  sec.end(`strings at ${want.map((s) => hex(findStr(s))).join(' ')}`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2. AL_VIEWS
if (has('2')) {
  const sec = new Sec('2 AL_VIEWS: every view of the table made, rectangle / flags / id / word set, added as the parent\'s last child (existing children kept first); roles 1 (default), 2 (cancel), 3 (both), 4 (Field of cap 30); IX = the parent; K_NEW once per view; an empty table adds nothing');
  const secW = new Sec('2b AL_VIEWS with a Window parent (APPLIB 2: the default and cancel buttons are set "for a Dialog parent"): the roles must not write the Dialog\'s default / cancel words (offsets 21-24) into a Window, which is 21 bytes');
  const ent = (cls, x, y, w, h, flags, id, role, word) => ({ cls: cls(), x, y, w, h, flags, id, role, word });
  const wordP = (s) => putStr(codes(s));
  function run(ctx, parentClsIn, mk, preKids = 0) {
    reset();
    const parentCls = typeof parentClsIn === 'function' ? parentClsIn : () => parentClsIn;
    const dlg = kNew(parentCls());
    const before = [];
    for (let i = 0; i < preKids; i++) { const k = kNew(S.CL_Label); T.addChild(env, dlg, k); before.push(k); }
    const entries = mk();
    const tbl = putTable(entries);
    const isDlg = parentCls() === S.CL_Dialog;
    const defB = isDlg ? rd16(m, dlg + S.Dialog_default) : 0, canB = isDlg ? rd16(m, dlg + S.Dialog_cancel) : 0;
    const guard = isDlg ? null : Array.from(m.ram.subarray(dlg + 0x15, dlg + 0x18));
    const cnt = counter();
    const r = call(sec, 'AL_VIEWS', { ix: dlg, hl: tbl }, ctx, { hooks: cnt.hooks });
    sec.ok(r.regs.ix === dlg, () => `${ctx}: IX ${hex(r.regs.ix)} on return, want the parent ${hex(dlg)}`);
    sec.ok(cnt.c.newN === entries.length, () => `${ctx}: ${cnt.c.newN} K_NEW calls, want ${entries.length}`);
    checkViews(sec, ctx, dlg, entries, before, isDlg, defB, canB);
    if (guard) secW.ok(eq(guard, Array.from(m.ram.subarray(dlg + 0x15, dlg + 0x18))), () => `${ctx}: a Window parent's bytes 21-23 (where a Dialog keeps its default / cancel words) were ${guard.map((v) => hex(v, 2)).join(' ')}, now ${Array.from(m.ram.subarray(dlg + 0x15, dlg + 0x18)).map((v) => hex(v, 2)).join(' ')}`);
  }
  run('an empty table (Dialog)', S.CL_Dialog, () => []);
  run('an empty table (Dialog with a child)', () => S.CL_Dialog, () => [], 2);
  run('one Label, no role', () => S.CL_Dialog, () => [ent(CLS.Label, 144, 76, 200, 9, 0, 0, 0, wordP('Hello'))]);
  run('role 1 Button', () => S.CL_Dialog, () => [ent(CLS.Button, 224, 100, 64, 16, 0x11, 1, 1, wordP('Go'))]);
  run('role 2 Button', () => S.CL_Dialog, () => [ent(CLS.Button, 304, 100, 64, 16, 1, 2, 2, wordP('Stop'))]);
  run('role 3 Button (default and cancel)', () => S.CL_Dialog, () => [ent(CLS.Button, 304, 100, 64, 16, 0x11, 1, 3, wordP('OK'))]);
  run('role 4 Field', () => S.CL_Dialog, () => [ent(CLS.Field, 144, 84, 224, 12, 1, 1, 4, putBytes(new Array(32).fill(0)))]);
  run('the alert\'s shape: Label, Button role 3', () => S.CL_Dialog, () => [ent(CLS.Label, 144, 76, 224, 18, 0, 0, 0, wordP('x')), ent(CLS.Button, 304, 100, 64, 16, 0x11, 1, 3, wordP('OK'))]);
  run('the name dialog\'s shape: Label, Field 4, Button 1, Button 2', () => S.CL_Dialog, () => [ent(CLS.Label, 144, 68, 200, 9, 0, 0, 0, wordP('Save as:')), ent(CLS.Field, 144, 84, 224, 12, 1, 1, 4, putBytes(new Array(32).fill(0))),
    ent(CLS.Button, 224, 108, 64, 16, 0x11, 1, 1, wordP('Save')), ent(CLS.Button, 304, 108, 64, 16, 1, 2, 2, wordP('Cancel'))]);
  run('a Check and a Label with a 16-bit x and w (x 300, w 400)', () => S.CL_Dialog, () => [ent(CLS.Check, 300, 20, 400, 11, 3, 9, 0, wordP('Check')), ent(CLS.Label, 511, 191, 1, 1, 0xFF, 0xFF, 0, 0)]);
  run('a table after two existing children', () => S.CL_Dialog, () => [ent(CLS.Label, 10, 11, 12, 13, 14, 15, 0, wordP('a')), ent(CLS.Button, 20, 21, 22, 23, 24, 25, 1, wordP('b'))], 2);
  run('a Window parent, roles ignored', () => S.CL_Window, () => [ent(CLS.Label, 10, 11, 12, 13, 0, 0, 0, wordP('a')), ent(CLS.Button, 20, 21, 22, 23, 1, 2, 3, wordP('b')), ent(CLS.Button, 30, 31, 32, 33, 1, 3, 1, wordP('c'))]);
  run('a Window parent with a child, a Field', () => S.CL_Window, () => [ent(CLS.Field, 10, 11, 120, 12, 1, 1, 4, putBytes(new Array(32).fill(0)))], 1);
  // random tables: 1-6 views, one default and one cancel at most, Fields with role 4; Dialog and Window parents
  for (let k = 0; k < NRAND; k++) {
    const dialog = rng.chance(0.7), n = rng.int(1, 6);
    let haveDef = false, haveCan = false;
    const mk = () => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const kind = rng.pick(['Label', 'Button', 'Button', 'Check', 'Field']);
        let role = 0;
        if (kind === 'Field') role = 4;
        else if (kind === 'Button') { const d = !haveDef && rng.chance(0.6), c = !haveCan && rng.chance(0.6); role = (d ? 1 : 0) | (c ? 2 : 0); if (d) haveDef = true; if (c) haveCan = true; }
        const word = kind === 'Field' ? putBytes(new Array(32).fill(0)) : rng.chance(0.2) ? 0 : wordP(String.fromCharCode(...Array.from({ length: rng.int(0, 8) }, () => rng.int(65, 90))));
        out.push(ent(CLS[kind], rng.int(0, 511), rng.int(0, 191), rng.int(0, 511), rng.int(0, 191), rng.int(0, 255), rng.int(0, 255), role, word));
      }
      return out;
    };
    run(`random table ${k} (${dialog ? 'Dialog' : 'Window'}, ${n} views)`, dialog ? () => S.CL_Dialog : () => S.CL_Window, mk, rng.int(0, 2));
  }
  sec.end();
  secW.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3. AL_DIALOG
if (has('3')) {
  const sec = new Sec('3 AL_DIALOG: the first call makes the Dialog (its 8 bytes) and its views and keeps it in the word; IX = the dialog; the second and third calls make nothing (no K_NEW, the arena and the program image unchanged) and return the same IX');
  const ent = (cls, x, y, w, h, flags, id, role, word) => ({ cls: cls(), x, y, w, h, flags, id, role, word });
  const cases = [
    { name: 'no views', dlg: { x: 128, y: 64, w: 256, h: 64, flags: 0, id: 0 }, mk: () => [] },
    { name: 'the alert\'s shape', dlg: { x: 128, y: 64, w: 256, h: 64, flags: 0, id: 0 }, mk: () => [ent(CLS.Label, 144, 76, 224, 18, 0, 0, 0, putStr(codes('Msg'))), ent(CLS.Button, 304, 100, 64, 16, 0x11, 1, 3, putStr(codes('OK')))] },
    { name: 'a dialog with a 16-bit x / w, flags and id, a Field, default and cancel', dlg: { x: 300, y: 20, w: 400, h: 90, flags: 0x05, id: 7 },
      mk: () => [ent(CLS.Field, 310, 30, 300, 12, 1, 1, 4, putBytes(new Array(32).fill(0))), ent(CLS.Button, 320, 80, 64, 16, 0x11, 1, 1, putStr(codes('Yes'))), ent(CLS.Button, 400, 80, 64, 16, 1, 2, 2, putStr(codes('No')))] },
    { name: 'five views', dlg: { x: 1, y: 2, w: 3, h: 4, flags: 0x21, id: 0xFE }, mk: () => [ent(CLS.Label, 1, 1, 1, 1, 0, 0, 0, 0), ent(CLS.Check, 2, 2, 2, 2, 1, 1, 0, putStr(codes('c'))), ent(CLS.Label, 3, 3, 3, 3, 2, 2, 0, putStr(codes('l'))),
      ent(CLS.Button, 4, 4, 4, 4, 3, 3, 2, putStr(codes('b'))), ent(CLS.Button, 5, 5, 5, 5, 4, 4, 1, putStr(codes('d')))] },
  ];
  for (const cs of cases) {
    reset();
    const word = alloc(2); poke16(word, 0);
    const entries = cs.mk();
    const tbl = putBytes([cs.dlg.x & 255, cs.dlg.x >> 8, cs.dlg.y, cs.dlg.w & 255, cs.dlg.w >> 8, cs.dlg.h, cs.dlg.flags, cs.dlg.id, ...tableBytes(entries)]);
    const c1 = counter();
    const r1 = call(sec, 'AL_DIALOG', { hl: word, de: tbl }, `${cs.name}: first call`, { ixOut: true, hooks: c1.hooks });
    const d = rd16(m, word);
    sec.ok(d !== 0 && inRam(d), () => `${cs.name}: the word holds ${hex(d)} after the first call`);
    sec.ok(r1.regs.ix === d, () => `${cs.name}: IX ${hex(r1.regs.ix)}, the word ${hex(d)}`);
    sec.ok(c1.c.newN === 1 + entries.length, () => `${cs.name}: ${c1.c.newN} K_NEW calls on the first call, want ${1 + entries.length}`);
    const v = view(d);
    sec.ok(v.cls === S.CL_Dialog, () => `${cs.name}: class ${hex(v.cls)}, want CL_Dialog ${hex(S.CL_Dialog)}`);
    sec.ok(v.x === cs.dlg.x && v.y === cs.dlg.y && v.w === cs.dlg.w && v.h === cs.dlg.h && v.flags === cs.dlg.flags && v.id === cs.dlg.id, () => `${cs.name}: the Dialog's (${v.x}, ${v.y}, ${v.w}, ${v.h}) flags ${v.flags} id ${v.id}, want ${JSON.stringify(cs.dlg)}`);
    checkViews(sec, `${cs.name}: views`, d, entries, [], true);
    const img = m.ram.slice(0xC000, 0xE000), recs = m.ram.slice(S.K_AARENA, S.K_AARENA + 16);
    for (const [i, how] of [[2, 'second'], [3, 'third']]) {
      const c2 = counter();
      const r2 = call(sec, 'AL_DIALOG', { hl: word, de: tbl }, `${cs.name}: ${how} call`, { ixOut: true, hooks: c2.hooks });
      sec.ok(r2.regs.ix === d, () => `${cs.name}: ${how} call: IX ${hex(r2.regs.ix)}, want the same dialog ${hex(d)}`);
      sec.ok(c2.c.newN === 0, () => `${cs.name}: ${how} call: ${c2.c.newN} K_NEW call(s), want none`);
      sec.ok(rd16(m, word) === d, () => `${cs.name}: ${how} call: the word changed to ${hex(rd16(m, word))}`);
      const now = m.ram.slice(0xC000, 0xE000), diff = [];
      for (let k = 0; k < now.length; k++) if (now[k] !== img[k]) diff.push(0xC000 + k);
      sec.ok(diff.length === 0, () => `${cs.name}: ${how} call changed the arena / image, e.g. ${diff.slice(0, 4).map((a) => hex(a)).join(' ')} (${diff.length} bytes)`);
      sec.ok(eq(Array.from(recs), Array.from(m.ram.slice(S.K_AARENA, S.K_AARENA + 16))), () => `${cs.name}: ${how} call changed the app arena's record`);
    }
    // a word that already holds a dialog is the dialog, whatever the table
    reset();
    const w2 = alloc(2), other = kNew(S.CL_Dialog); poke16(w2, other);
    const cc = counter();
    const r3 = call(sec, 'AL_DIALOG', { hl: w2, de: tbl }, `${cs.name}: a word already holding a dialog`, { ixOut: true, hooks: cc.hooks });
    sec.ok(r3.regs.ix === other && cc.c.newN === 0 && rd16(m, w2) === other, () => `${cs.name}: a word already holding ${hex(other)}: IX ${hex(r3.regs.ix)}, ${cc.c.newN} K_NEW, word ${hex(rd16(m, w2))}`);
  }
  sec.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4. AL_EXTNAME
if (has('4')) {
  const sec = new Sec('4 AL_EXTNAME: the extension is added when the name has no "." and the result is <= 30 codes (names of 1, 2, 10, 24-30 codes with and without a ".", the "." first / inside / last, another extension); the name buffer past 30 and the extension untouched; AF BC DE HL clobbered only');
  const secE = new Sec('4b AL_EXTNAME of an empty name: APPLIB 2 adds the extension when the name has no "." and the result fits, so "" becomes ".txt" (WRITE 13.2 stops an empty name before this rule; the library\'s own contract does not say so)');
  const model = (name, ext) => (!name.includes(46) && name.length + 4 <= 30 ? [...name, ...ext] : name.slice());
  const mkName = (n, dotAt) => { const cs = Array.from({ length: n }, (_, i) => 97 + (i % 26)); if (dotAt >= 0 && dotAt < n) cs[dotAt] = 46; return cs; };
  const sec4 = sec, cases = [];
  for (const n of [0, 1, 2, 10, 24, 25, 26, 27, 28, 29, 30]) {
    cases.push([n, -1]);
    if (n >= 1) { cases.push([n, 0]); cases.push([n, n - 1]); }
    if (n >= 3) cases.push([n, rng.int(1, n - 2)]);
  }
  for (const ext of ['.txt', '.dat', '.AbC', '.x_y']) for (const [n, dot] of cases) {
    if (ext !== '.txt' && ![0, 25, 26, 27, 30].includes(n)) continue;
    reset();
    const name = mkName(n, dot), want = model(name, codes(ext));
    const buf = alloc(48), e = alloc(8), canary = 0x5A;
    m.ram.fill(canary, buf, buf + 48);
    m.ram[buf] = name.length; name.forEach((c, i) => { m.ram[buf + 1 + i] = c; });
    codes(ext).forEach((c, i) => { m.ram[e + i] = c; }); m.ram[e + 4] = canary;
    const ctx = `name ${show(name)} (${n} codes${dot >= 0 ? `, "." at ${dot}` : ', no "."'}), ext ${ext}`;
    const sec = n === 0 ? secE : sec4;
    call(sec, 'AL_EXTNAME', { hl: buf, de: e }, ctx);
    const got = strAt(buf);
    sec.ok(eq(got, want), () => `${ctx}: result ${show(got)} (${got.length}), want ${show(want)} (${want.length})`);
    sec.ok(m.ram[buf] === want.length, () => `${ctx}: length byte ${m.ram[buf]}, want ${want.length}`);
    sec.ok(Array.from(m.ram.subarray(buf + 31, buf + 48)).every((v) => v === canary), () => `${ctx}: bytes past the 30-code cap (buffer + 31..47) were written`);
    sec.ok(eq(Array.from(m.ram.subarray(e, e + 4)), codes(ext)) && m.ram[e + 4] === canary, () => `${ctx}: the extension's bytes changed`);
  }
  sec4.end(`${cases.length} name shapes`);
  secE.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 5. AL_TITLE
if (has('5')) {
  const sec5 = new Sec('5 AL_TITLE: the title is prefix + name in the buffer (length byte first, up to 39 codes, nothing written past the 40 bytes), Window_title = the buffer, W_INVAL of (x, y, w, 8) once with carry set, none with carry clear; IX kept; AF BC DE HL clobbered only');
  const secE = new Sec('5b AL_TITLE with an empty prefix or an empty name (a length-prefixed string of 0 codes is a legal argument, APPLIB 2): the title is still prefix + name and the call returns');
  const cases = [
    ['Notepad: ', 'Untitled'], ['Notepad: ', 'x'.repeat(30)], ['Notepad: ', ''], ['', 'Untitled'], ['', ''], ['A', 'b'], ['', 'y'.repeat(39)], ['z'.repeat(39), ''], ['Notepad: ', 'Report.txt'], ['Leap Desktop - ', 'q'.repeat(24)],
  ];
  const wins = [{ x: 16, y: 16, w: 480 }, { x: 300, y: 50, w: 200 }, { x: 0, y: 0, w: 512 }, { x: 511, y: 191, w: 1 }, { x: 77, y: 120, w: 300 }];
  let k = 0;
  for (const carry of [1, 0]) for (const [pre, nm] of cases) {
    reset();
    const wn = wins[k++ % wins.length], sec = pre.length === 0 || nm.length === 0 ? secE : sec5;
    const win = kNew(S.CL_Window); T.setRect(env, win, wn.x, wn.y, wn.w, 80); poke16(win + S.Window_title, 0);
    const p = putStr(codes(pre)), n = putStr(codes(nm)), buf = alloc(48);
    m.ram.fill(0x5A, buf, buf + 48);
    const hits = [];
    const hooks = { [S.W_INVAL]: () => { const g = (o) => { const v = rd16(m, S.GA + o); return v >= 0x8000 ? v - 0x10000 : v; }; hits.push([g(0), g(2), g(4), g(6)]); } };
    const f = (carry ? 1 : 0) | (rng.int(0, 255) & 0xFE);
    const dirty0 = rd8(S.W_DIRTY);
    const ctx = `carry ${carry}, prefix ${show(codes(pre))} + name ${show(codes(nm))} (${pre.length + nm.length} codes), window (${wn.x}, ${wn.y}, ${wn.w})`;
    const rt = call(sec, 'AL_TITLE', { ix: win, hl: p, de: n, bc: buf, f }, ctx, { hooks });
    if (rt.crashed) continue;
    const want = [...codes(pre), ...codes(nm)];
    sec.ok(rd16(m, win + S.Window_title) === buf, () => `${ctx}: Window_title ${hex(rd16(m, win + S.Window_title))}, want the buffer ${hex(buf)}`);
    sec.ok(m.ram[buf] === want.length && eq(strAt(buf), want), () => `${ctx}: the buffer holds ${show(strAt(buf))} (length byte ${m.ram[buf]}), want ${show(want)}`);
    sec.ok(Array.from(m.ram.subarray(buf + 40, buf + 48)).every((v) => v === 0x5A), () => `${ctx}: bytes buffer + 40..47 were written (the buffer is 40 bytes)`);
    sec.ok(eq(strAt(p), codes(pre)) && eq(strAt(n), codes(nm)), () => `${ctx}: the prefix or the name string changed`);
    sec.ok(rd16(m, win + S.View_x) === wn.x && rd8(win + S.View_y) === wn.y && rd16(m, win + S.View_w) === wn.w, () => `${ctx}: the window's rectangle changed`);
    if (carry) {
      sec.ok(hits.length === 1 && hits[0][0] === wn.x && hits[0][1] === wn.y && hits[0][2] === wn.w && hits[0][3] === 8, () => `${ctx}: W_INVAL calls ${JSON.stringify(hits)}, want one (${wn.x}, ${wn.y}, ${wn.w}, 8)`);
      if (dirty0 === 0) sec.ok(rd8(S.W_DIRTY) !== 0, () => `${ctx}: W_DIRTY is still 0 after the title row was invalidated`);
    } else {
      sec.ok(hits.length === 0, () => `${ctx}: carry clear, yet W_INVAL was called ${hits.length} time(s): ${JSON.stringify(hits)} (the brief: the dirty row only with carry set)`);
    }
  }
  sec5.end();
  secE.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The standard dialogs: alert, ask, name dialog.
/** A tree check of a standard dialog: spec { rect, kids: [{ cls, x, y, w, h, id?, text (codes) | null, ramText: bool (must be in AL_RAM) }], def, can (indices or -1) , field index }. */
function checkStd(sec, ctx, d, spec) {
  const v = view(d);
  sec.ok(v.cls === S.CL_Dialog && v.x === spec.rect.x && v.y === spec.rect.y && v.w === spec.rect.w && v.h === spec.rect.h, () => `${ctx}: the Dialog is ${CLN(v.cls)} (${v.x}, ${v.y}, ${v.w}, ${v.h}), want (${spec.rect.x}, ${spec.rect.y}, ${spec.rect.w}, ${spec.rect.h})`);
  const ks = kids(d);
  sec.ok(ks.length === spec.kids.length, () => `${ctx}: ${ks.length} views (${ks.map((k) => CLN(k.cls)).join(', ')}), want ${spec.kids.length}`);
  spec.kids.forEach((e, i) => {
    const k = ks[i]; if (!k) return;
    const c = `${ctx}: view ${i} (${e.cls})`;
    sec.ok(CLN(k.cls) === e.cls, () => `${c}: class ${CLN(k.cls)}`);
    sec.ok(k.parent === d, () => `${c}: parent ${hex(k.parent)}`);
    sec.ok(k.x === e.x && k.y === e.y && k.w === e.w && k.h === e.h, () => `${c}: rect (${k.x}, ${k.y}, ${k.w}, ${k.h}), want (${e.x}, ${e.y}, ${e.w}, ${e.h})`);
    if (e.id !== undefined) sec.ok(k.id === e.id, () => `${c}: id ${k.id}, want ${e.id}`);
    if (e.cls === 'Field') {
      sec.ok(rd8(k.a + S.Field_cap) === 30, () => `${c}: cap ${rd8(k.a + S.Field_cap)}, want 30`);
      sec.ok(inRam(k.word), () => `${c}: the Field's buffer ${hex(k.word)} is not in RAM`);
    } else if (e.text) {
      const t = k.word && inRam(k.word) ? strAt(k.word) : null;
      sec.ok(inRam(k.word), () => `${c}: the text pointer ${hex(k.word)} is not in RAM`);
      sec.ok(t && eq(t, e.text), () => `${c}: text ${t ? show(t) : 'none'}, want ${show(e.text)}`);
      if (e.ramText) sec.ok(inAlRam(k.word), () => `${c}: the library's own string is at ${hex(k.word)}, not in AL_RAM ($C3C0-$C3FF)`);
    }
  });
  const def = spec.def >= 0 ? ks[spec.def]?.a ?? 0 : 0, can = spec.can >= 0 ? ks[spec.can]?.a ?? 0 : 0;
  sec.ok(rd16(m, d + S.Dialog_default) === def, () => `${ctx}: Dialog_default ${hex(rd16(m, d + S.Dialog_default))}, want ${hex(def)}`);
  sec.ok(rd16(m, d + S.Dialog_cancel) === can, () => `${ctx}: Dialog_cancel ${hex(rd16(m, d + S.Dialog_cancel))}, want ${hex(can)}`);
  return ks;
}
const ALERT_SPEC = (msg) => ({ rect: { x: 128, y: 64, w: 256, h: 64 }, def: 1, can: 1, kids: [{ cls: 'Label', x: 144, y: 76, w: 224, h: 18, text: msg }, { cls: 'Button', x: 304, y: 100, w: 64, h: 16, id: 1, text: codes('OK'), ramText: true }] });
const ASK_SPEC = { rect: { x: 128, y: 64, w: 256, h: 64 }, def: 1, can: 2, kids: [{ cls: 'Label', x: 144, y: 76, w: 200, h: 9, text: codes('Discard the document?'), ramText: true },
  { cls: 'Button', x: 224, y: 100, w: 64, h: 16, id: 1, text: codes('Discard'), ramText: true }, { cls: 'Button', x: 304, y: 100, w: 64, h: 16, id: 2, text: codes('Cancel'), ramText: true }] };
const NAME_SPEC = (label, btn) => ({ rect: { x: 128, y: 56, w: 256, h: 80 }, def: 2, can: 3, kids: [{ cls: 'Label', x: 144, y: 68, w: 200, h: 9, text: label }, { cls: 'Field', x: 144, y: 84, w: 224, h: 12 },
  { cls: 'Button', x: 224, y: 108, w: 64, h: 16, id: 1, text: btn }, { cls: 'Button', x: 304, y: 108, w: 64, h: 16, id: 2, text: codes('Cancel'), ramText: true }] });

// 6. AL_ALERT
if (has('6')) {
  const sec = new Sec('6 AL_ALERT: the alert (128, 64, 256, 64) with the Label (144, 76, 224, 18) showing the message and the default + cancel Button "OK" (304, 100, 64, 16), id 1 ("OK" in AL_RAM), opened modal with the focus on OK; pixels as the standard alert (one line, two lines at a 13, empty); made once, reused with another message after a close; IX clobbered only');
  const msgs = [W3.MSG.saveFail, W3.MSG.tooLong, W3.MSG.tooMany, 'Leap Desktop, step 5', '', 'A', 'Two\rlines', 'x'.repeat(24), 'Line one\rline two of the same message', W3.MSG.openFail];
  for (let pass = 0; pass < 2; pass++) {
    reset();
    const word = alloc(2); poke16(word, 0);
    let dlg = 0;
    const seq = pass === 0 ? msgs : [...msgs].reverse();
    seq.forEach((msg, k) => {
      const mc = codes(msg), ma = putStr(mc), ctx = `alert ${k} (pass ${pass}) ${show(mc)}`;
      const cnt = counter();
      call(sec, 'AL_ALERT', { hl: word, de: ma }, ctx, { ixOut: true, hooks: cnt.hooks });
      const d = rd16(m, word);
      if (k === 0) { dlg = d; sec.ok(d !== 0 && cnt.c.newN === 3, () => `${ctx}: made ${d ? '' : 'nothing, '}with ${cnt.c.newN} K_NEW calls, want 3 (Dialog, Label, Button)`); }
      else sec.ok(d === dlg && cnt.c.newN === 0, () => `${ctx}: the word ${hex(d)} (was ${hex(dlg)}), ${cnt.c.newN} K_NEW calls on a reuse`);
      sec.ok(eq(strAt(ma), mc), () => `${ctx}: the message string changed`);
      const ks = checkStd(sec, ctx, d, ALERT_SPEC(mc));
      checkOpen(sec, ctx, d, ALERT_SPEC(mc).rect);
      const ok = ks[1]?.a ?? 0;
      sec.ok(rd16(m, S.K_FOCUS) === ok && ok !== 0, () => `${ctx}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, want the OK button ${hex(ok)}`);
      update();
      const focused = rd16(m, S.K_FOCUS) === ok;
      const sd = screen((g) => W3.alertDraw(g, msg, focused));
      sec.ok(sd === null, () => `${ctx}: screen ${sd}`);
      closeDlg(d);
      const sc = screen(null);
      sec.ok(sc === null && L.openWindows(m, S).length === 1, () => `${ctx}: after the close: screen ${sc}, ${L.openWindows(m, S).length} windows`);
      sec.ok(rd16(m, word) === d, () => `${ctx}: the word changed after the close`);
    });
  }
  sec.end();
}

// 7. AL_ASK
if (has('7')) {
  const sec = new Sec('7 AL_ASK: the ask (128, 64, 256, 64): Label (144, 76, 200, 9) "Discard the document?", Button "Discard" (224, 100, 64, 16) id 1 default, Button "Cancel" (304, 100, 64, 16) id 2 cancel, all three strings in AL_RAM; open and modal, the focus on Discard; pixels as the standard dialog; made once, reused');
  reset();
  const word = alloc(2); poke16(word, 0);
  let dlg = 0;
  for (let k = 0; k < 3; k++) {
    const ctx = `ask ${k}`, cnt = counter();
    call(sec, 'AL_ASK', { hl: word }, ctx, { ixOut: true, hooks: cnt.hooks });
    const d = rd16(m, word);
    if (k === 0) { dlg = d; sec.ok(d !== 0 && cnt.c.newN === 4, () => `${ctx}: made ${d ? '' : 'nothing, '}with ${cnt.c.newN} K_NEW calls, want 4 (Dialog, Label, 2 Buttons)`); }
    else sec.ok(d === dlg && cnt.c.newN === 0, () => `${ctx}: the word ${hex(d)} (was ${hex(dlg)}), ${cnt.c.newN} K_NEW calls on a reuse`);
    const ks = checkStd(sec, ctx, d, ASK_SPEC);
    checkOpen(sec, ctx, d, ASK_SPEC.rect);
    const disc = ks[1]?.a ?? 0, canc = ks[2]?.a ?? 0, foc = rd16(m, S.K_FOCUS);
    sec.ok(foc === disc && disc !== 0, () => `${ctx}: K_FOCUS ${hex(foc)}, want the Discard button ${hex(disc)}`);
    update();
    const fb = foc === disc ? 1 : foc === canc ? 2 : 0;
    const sd = screen((g) => WM.dialogDraw(g, fb));
    sec.ok(sd === null, () => `${ctx}: screen ${sd}`);
    closeDlg(d);
    const sc = screen(null);
    sec.ok(sc === null && L.openWindows(m, S).length === 1, () => `${ctx}: after the close: screen ${sc}`);
  }
  // an ask and an alert side by side in one program: two words, two dialogs (not one shared object)
  reset();
  const wa = alloc(2), wk = alloc(2); poke16(wa, 0); poke16(wk, 0);
  call(sec, 'AL_ASK', { hl: wk }, 'ask beside alert (ask)', { ixOut: true }); closeDlg(rd16(m, wk));
  call(sec, 'AL_ALERT', { hl: wa, de: putStr(codes('Hi')) }, 'ask beside alert (alert)', { ixOut: true });
  sec.ok(rd16(m, wa) !== 0 && rd16(m, wa) !== rd16(m, wk), () => `the alert's dialog ${hex(rd16(m, wa))} is the ask's ${hex(rd16(m, wk))}`);
  closeDlg(rd16(m, wa));
  call(sec, 'AL_ASK', { hl: wk }, 'ask after the alert', { ixOut: true });
  sec.ok(rd16(m, wk) !== 0 && checkStdQuiet(rd16(m, wk), ASK_SPEC), 'the ask after an alert in the same program is still the ask');
  sec.end();
}
function checkStdQuiet(d, spec) { const ks = kids(d); return ks.length === spec.kids.length && view(d).w === spec.rect.w && rd16(m, d + S.Dialog_cancel) === ks[spec.can]?.a; }

// 8. AL_NAMEDLG
if (has('8')) {
  const sec = new Sec('8 AL_NAMEDLG: the name dialog (128, 56, 256, 80): Label (144, 68, 200, 9) with the caller\'s text, Field (144, 84, 224, 12) cap 30 on the caller\'s buffer holding the text with the caret at the end, Button (224, 108, 64, 16) id 1 default with the caller\'s text, Button "Cancel" (304, 108, 64, 16) id 2 cancel; open, modal, the Field focused; IX = the Field; pixels as the Save dialog; made once, reused with other texts');
  const runs = [
    { label: 'Save as:', btn: 'Save', text: 'Untitled' },
    { label: 'Find:', btn: 'Find', text: '' },
    { label: 'Open:', btn: 'Open', text: 'a' },
    { label: 'Save as:', btn: 'Save', text: 'Report.txt' },
    { label: 'Name:', btn: 'OK', text: 'W'.repeat(30) },
    { label: 'Find:', btn: 'Find', text: 'the quick brown fox jumps over' },
    { label: 'Save as:', btn: 'Save', text: 'iiiiiiiiiiiiiiiiiiiiiiiiiiiiii' },
    { label: '', btn: 'Go', text: 'x y' },
  ];
  for (const order of [runs, [...runs].reverse()]) {
    reset();
    const word = alloc(2); poke16(word, 0);
    let dlg = 0;
    order.forEach((r, k) => {
      const ctx = `name dialog ${k} ${JSON.stringify(r)}`;
      const lab = putStr(codes(r.label)), fbuf = alloc(32), btn = putStr(codes(r.btn)), txt = putStr(codes(r.text));
      m.ram.fill(0x5A, fbuf, fbuf + 32);
      const args = alloc(8); poke16(args, lab); poke16(args + 2, fbuf); poke16(args + 4, btn); poke16(args + 6, txt);
      const cnt = counter();
      const res = call(sec, 'AL_NAMEDLG', { hl: word, de: args }, ctx, { ixOut: true, hooks: cnt.hooks });
      const d = rd16(m, word);
      if (k === 0) { dlg = d; sec.ok(d !== 0 && cnt.c.newN === 5, () => `${ctx}: made ${d ? '' : 'nothing, '}with ${cnt.c.newN} K_NEW calls, want 5 (Dialog, Label, Field, 2 Buttons)`); }
      else sec.ok(d === dlg && cnt.c.newN === 0, () => `${ctx}: the word ${hex(d)} (was ${hex(dlg)}), ${cnt.c.newN} K_NEW calls on a reuse`);
      const ks = checkStd(sec, ctx, d, NAME_SPEC(codes(r.label), codes(r.btn)));
      checkOpen(sec, ctx, d, NAME_SPEC([], []).rect);
      const fld = ks[1]?.a ?? 0;
      sec.ok(res.regs.ix === fld && fld !== 0, () => `${ctx}: IX ${hex(res.regs.ix)} on return, want the Field ${hex(fld)}`);
      sec.ok(rd16(m, fld + S.Field_buf) === fbuf, () => `${ctx}: Field_buf ${hex(rd16(m, fld + S.Field_buf))}, want the caller's buffer ${hex(fbuf)}`);
      const f = W3.newSaveField(codes(r.text));
      sec.ok(eq(strAt(fbuf), codes(r.text)), () => `${ctx}: the Field's buffer holds ${show(strAt(fbuf))}, want ${show(codes(r.text))}`);
      sec.ok(rd8(fld + S.Field_caret) === f.caret, () => `${ctx}: Field_caret ${rd8(fld + S.Field_caret)}, want ${f.caret} (the end)`);
      sec.ok(rd8(fld + S.Field_first) === f.first, () => `${ctx}: Field_first ${rd8(fld + S.Field_first)}, want ${f.first}`);
      sec.ok(Array.from(m.ram.subarray(fbuf + 1 + r.text.length, fbuf + 32)).every((v, i) => (1 + r.text.length + i <= 31) ? true : v === 0x5A), () => `${ctx}: the Field's buffer was written past 31 bytes`);
      sec.ok(eq(strAt(txt), codes(r.text)) && eq(strAt(lab), codes(r.label)) && eq(strAt(btn), codes(r.btn)), () => `${ctx}: a caller's string changed`);
      sec.ok(rd16(m, S.K_FOCUS) === fld && fld !== 0, () => `${ctx}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, want the Field ${hex(fld)}`);
      update();
      const sd = screen((g) => W3.saveDraw(g, f, 0, { label: r.label, btn: r.btn }));
      sec.ok(sd === null, () => `${ctx}: screen ${sd}`);
      closeDlg(d);
      const sc = screen(null);
      sec.ok(sc === null && L.openWindows(m, S).length === 1, () => `${ctx}: after the close: screen ${sc}`);
    });
  }
  sec.end();
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 9. The stack and the registers
if (has('9')) {
  const sec = new Sec('9 stack <= 128 bytes (crossings and interrupts included) for every call, over the cases of groups 1-8; IY and the alternate set kept (with sentinel patterns as well as random values); SP right after every return');
  const names = ['AL_INIT', 'AL_VIEWS', 'AL_DIALOG', 'AL_ALERT', 'AL_ASK', 'AL_NAMEDLG', 'AL_TITLE', 'AL_EXTNAME'];
  const SENT = { a2: 0x5A, f2: 0xA5, b2: 0x3C, c2: 0xC3, d2: 0x0F, e2: 0xF0, h2: 0x96, l2: 0x69, yh: 0x12, yl: 0x34 };
  // sentinel pass: one call of each kind with fixed alternate set and IY, and a few random IX
  reset();
  const wA = alloc(2), wK = alloc(2), wN = alloc(2), wD = alloc(2); [wA, wK, wN, wD].forEach((a) => poke16(a, 0));
  const lab = putStr(codes('Save as:')), fb = alloc(32), btn = putStr(codes('Save')), txt = putStr(codes('abc')), args = alloc(8);
  poke16(args, lab); poke16(args + 2, fb); poke16(args + 4, btn); poke16(args + 6, txt);
  const win = kNew(S.CL_Window); T.setRect(env, win, 20, 20, 100, 50);
  const dlg0 = kNew(S.CL_Dialog);
  const tbl = putTable([{ cls: S.CL_Label, x: 1, y: 2, w: 3, h: 4, flags: 0, id: 0, role: 0, word: lab }, { cls: S.CL_Button, x: 5, y: 6, w: 7, h: 8, flags: 0x11, id: 1, role: 3, word: btn }]);
  const dtbl = putBytes([1, 0, 2, 3, 0, 4, 0, 0, ...tableBytes([{ cls: S.CL_Label, x: 1, y: 2, w: 3, h: 4, flags: 0, id: 0, role: 0, word: lab }])]);
  const pre = putStr(codes('Notepad: ')), nm = putStr(codes('Untitled')), tb = alloc(48), nb = putStr(codes('Untitled')), ex = putBytes(codes('.txt'));
  const plan = [
    ['AL_INIT', {}, false], ['AL_VIEWS', { ix: dlg0, hl: tbl }, false], ['AL_DIALOG', { hl: wD, de: dtbl }, true], ['AL_TITLE', { ix: win, hl: pre, de: nm, bc: tb, f: 1 }, false],
    ['AL_EXTNAME', { hl: nb, de: ex }, false], ['AL_ALERT', { hl: wA, de: putStr(codes('Sentinel')) }, true], ['AL_NAMEDLG', { hl: wN, de: args }, true], ['AL_ASK', { hl: wK }, true],
  ];
  for (const [name, regs, ixOut] of plan) {
    const r = T.runCall(env, S[name], { ...regs, ...SENT }, { map: 'A', ints: true, ixOut });
    calls++;
    const st = (stats[name] ??= { n: 0, stack: 0, t: 0, di: 0 });
    st.n++; st.stack = Math.max(st.stack, r.stack); st.t = Math.max(st.t, r.t); st.di += r.di;
    sec.ok(r.preserved.length === 0, () => `${name} with sentinel registers: did not keep ${r.preserved.join(',')}`);
    for (const [k, v] of Object.entries(SENT)) sec.ok(r.regs[k] === v, () => `${name}: ${k} is ${hex(r.regs[k], 2)}, want the sentinel ${hex(v, 2)}`);
    sec.ok(r.badSp === undefined, () => `${name}: SP ${hex(r.badSp ?? 0)} after the return`);
    if (name === 'AL_ALERT' || name === 'AL_NAMEDLG' || name === 'AL_ASK') { const wd = name === 'AL_ALERT' ? wA : name === 'AL_ASK' ? wK : wN; T.runCall(env, S.W_CLOSE, { ix: rd16(m, wd) }, { ints: false }); update(); }
  }
  for (const n of names) {
    const s = stats[n];
    sec.ok(!!s && s.n > 0, () => `${n}: never called`);
    if (s) sec.ok(s.stack <= 128, () => `${n}: stack ${s.stack} bytes, bound 128`);
  }
  const line = names.map((n) => `${n} ${stats[n]?.stack ?? '-'} B / ${stats[n]?.t ?? '-'} T (${stats[n]?.n ?? 0})`).join('; ');
  sec.note(`max stack and slowest call: ${line}`);
  const di = names.reduce((a, n) => a + (stats[n]?.di ?? 0), 0);
  if (di) sec.note(`${di} instructions left interrupts disabled (the harness re-enables them at once); the contract does not forbid a brief DI`);
  sec.end(`${calls} calls in all`);
}

finish();
