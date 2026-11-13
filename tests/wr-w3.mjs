"use strict";
// wr-w3.mjs -- Write slice W3 (Open and Save, docs/WRITE.md 13; files: docs/FILES.md) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  13.7 items 1-4 (item 5, the
// cross-emulator rows, is tools/xemu/; the bounds are tests/wr-perf.mjs).  Written from the contract (WRITE 13, FILES 2, 4, 5) and the main model's as-built list of 2026-11-12 (clarifications 1-10);
// the Z80 sources were used only to find symbols.  The reference is tests/wr-w3model.mjs (with tests/wr-model.mjs); the harness tests/wr-w3lib.mjs; the host is web/fshost.js's shared fake host with failure hooks.
//   node tests/wr-w3.mjs [--seed N] [--nrand N] [--only LIST] [--verbose]
//     --nrand N    random sequences in group 4 (default 24), 8 steps each
//     --only LIST  groups: 1 Save (the dialog, ENTER / the button / Cancel / ESC, names and ".txt", an empty name, refused names, host failures, no host), 2 Open (text conversion, 5,120 and 5,121 codes, 1,024 and
//                  1,025 lines, an empty file, cancels, refused names, host failures, no host, the discard dialog, events during the pick, the clipboard kept, the UP / DOWN run ended),
//                  3 the screens (the Save dialog with a long name, both alerts, the title; clarification 1's line pitch, 8 rows), 4 random sequences against the model, 5 real frames: typed text saved, then opened again,
//                  and a 5,120-code round trip, 6 stack <= 128, no DI, registers (direct calls of WR_MENU and the dialog's command), 7 memory watch / frames
// The last line is "wr-w3: N of M groups pass"; exit code 1 on any failure.
import * as Q from './wr-w3lib.mjs';

const { W, W3, L, WM, T, X, hex, rd16, E } = Q;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NRAND = argNum('--nrand', 24);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['1', '2', '3', '4', '5', '6', '7'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('wr-w3', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NRAND} random sequences`);
try { W.needWr(L.loadDesk5().S); W.needWr2(L.loadDesk5().S); Q.needW3(L.loadDesk5().S); } catch (e) { console.log(`FAIL: ${e.message}`); process.exit(1); }

const envs = [];
const newEnv = () => { const e = Q.bootW3({ rng }); envs.push(e); return e; };
const codes = WM.codesOf;
const LET = codes('abcdefghijklmnopqrstuvwxyz');
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return -1; };
const rndLine = (n) => Array.from({ length: n }, () => (rng.chance(0.18) ? 32 : rng.pick(LET)));
/** A text of about n codes: words and spaces, paragraph ends (13) now and then, never more than `maxLines` display lines. */
function genDoc(n, para = 0.03) { const d = new WM.Doc(WM.genText(rng, n, { para, longWord: 0.005, maxRun: 6 })); return d.codes; }
const toFile = (cs, ends = 'LF') => { const out = []; for (const c of cs) { if (c === 13) { if (ends === 'LF') out.push(10); else if (ends === 'CRLF') out.push(13, 10); else out.push(13); } else out.push(c); } return out; };
const GLH_ALERT = { v: 8 };                               // clarification 1 (corrected by the main model: G_TEXTP's 13 moves down GLH = 8 rows): a 13 in the alert's label is a new line 8 rows down; group 3 checks it and, when the machine differs, the rest compare with the machine's pitch

// Clarification 1's line pitch of the two-line alerts: measured once on a machine of its own; the models of every group use the machine's pitch (so that one difference is not repeated in every screen
// check), and group 3 reports the difference as a failure of its own.
{
  const e = Q.bootW3({ rng }); e.frames_(0);
  Q.fileMenu(e, 1); Q.settle(e, 8); e.host.answer('toolong.txt', Array.from({ length: 5121 }, () => 65)); Q.settle(e, 200);
  const probe = (pitch) => { W3.setGlh(pitch); return Q.screenDiff(e, e.st, Q.alertFn(e, W3.MSG.tooLong)); };
  GLH_ALERT.d9 = probe(9); GLH_ALERT.d8 = probe(8);
  GLH_ALERT.v = GLH_ALERT.d8 === null ? 8 : GLH_ALERT.d9 === null ? 9 : 8;
  W3.setGlh(GLH_ALERT.v);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Step drivers (real frames)
/** The "File" menu's "Save...": the dialog opens with the current name, the Field focused; returns the Field model. */
function openSave(env, sec, ctx) {
  Q.fileMenu(env, 2); Q.settle(env, 8);
  const f = W3.newSaveField(env.st.name);
  Q.check(env, sec, `${ctx}: the Save dialog`, { dk: 1, field: f });
  return f;
}
/** Keys into the Save dialog's Field (the model follows). */
function fieldKeys(env, f, cs) { for (const c of cs) { Q.key(env, c); W3.fieldTyped(f, c); } }
/** Replace the Field's text: DELETE the old, type the new (the model follows); the cap of 30 holds. */
function fieldSet(env, f, text) { fieldKeys(env, f, [...f.buf.map(() => Q.KEYS.DELETE), ...(typeof text === 'string' ? codes(text) : text)]); }
/** The alert is up: check it, then close it with `how` ('enter' | 'click' | 'esc' | 'break'). */
function dismiss(env, sec, ctx, msg, how = 'enter') {
  Q.check(env, sec, `${ctx}: the alert`, { dk: 2, msg });
  if (how === 'enter') Q.key(env, Q.KEYS.ENTER);
  else if (how === 'esc') Q.key(env, Q.KEYS.ESC);
  else if (how === 'break') Q.key(env, Q.KEYS.BREAK);
  else { const [x, y] = Q.centreOf(W3.ALERT.ok); L.click(env, x, y, 3, 6); }
  Q.settle(env, 24);
  Q.check(env, sec, `${ctx}: after the alert (${how})`, { dk: 0 });
}
/** Finish a Save: `how` 'enter' (in the Field) or 'button' (click "Save"); `cfg` { open, write } says what the host does (for the model); returns { saved, alert, writes: the host's write sizes }. */
function finishSave(env, sec, ctx, f, how = 'enter', cfg = {}, dismissHow = 'enter') {
  const st = env.st, h = env.host, log0 = h.log.length, saves0 = h.saves.length;
  const was = st.clone();
  const r = st.save(f.buf, cfg);
  if (how === 'enter') Q.key(env, Q.KEYS.ENTER); else { const [x, y] = Q.centreOf(W3.SAVE.save); L.click(env, x, y, 3, 6); }
  Q.settle(env, 40);
  const cmds = h.log.slice(log0);
  if (r.saved === null && r.alert === null) {
    sec.ok(cmds.length === 0, () => `${ctx}: an empty name sent ${cmds.length} command(s) to the host: ${JSON.stringify(cmds.map((c) => c.n))}`);
    Q.check(env, sec, `${ctx}: after Save with an empty name`, { dk: 0 });
    return { ...r, writes: [] };
  }
  const ns = cmds.map((c) => c.n);
  if (r.alert) {
    // FILES / as-built 5: a failure of FS_OPEN or of a FS_WRITE: FS_CLOSE is not called (no partial file is finished)
    const failedAt = cfg.close === false ? 'close' : cfg.open === false ? 'open' : cfg.write === false ? 'write' : 'open';
    if (env.m.host !== null) {
      if (failedAt !== 'close') sec.ok(!ns.includes(5), () => `${ctx}: FS_CLOSE was called after a failed ${failedAt} (commands ${JSON.stringify(ns)})`);
      if (failedAt !== 'close') sec.ok(h.saves.length === saves0, () => `${ctx}: a file was finished although the save failed`);
      sec.ok(ns[0] === 2, () => `${ctx}: the first command to the host is ${ns[0]}, want 2 (open)`);
    } else sec.ok(ns.length === 0, () => `${ctx}: with no host, commands reached the host`);
    dismiss(env, sec, ctx, r.alert, dismissHow);
    return { ...r, writes: [] };
  }
  // success: open (mode 1: write, text), then the codes before the gap and after it (each only when non-empty), then close
  const want = [Math.min(was.doc.caret, was.doc.L), was.doc.L - was.doc.caret].filter((n) => n > 0);
  const writes = cmds.filter((c) => c.n === 4).map((c) => c.bytes.length - 2);
  sec.ok(ns[0] === 2 && ns[ns.length - 1] === 5 && ns.slice(1, -1).every((n) => n === 4), () => `${ctx}: the host's commands ${JSON.stringify(ns)}, want open (2), writes (4), close (5)`);
  sec.ok(cmds[0] && cmds[0].bytes[0] === 1, () => `${ctx}: FS_OPEN's mode ${cmds[0] && cmds[0].bytes[0]}, want 1 (write, text)`);
  sec.ok(cmds[0] && eq(Array.from(cmds[0].bytes.slice(2)), r.name) && cmds[0].bytes[1] === r.name.length, () => `${ctx}: FS_OPEN's name ${JSON.stringify(cmds[0] && String.fromCharCode(...cmds[0].bytes.slice(2)))}, want ${JSON.stringify(WM.textOf(r.name))}`);
  sec.ok(eq(writes, want), () => `${ctx}: write sizes ${JSON.stringify(writes)}, want ${JSON.stringify(want)} (the codes before the gap, then after it)`);
  const nm = WM.textOf(r.name), sv = h.saves.slice(saves0);
  sec.ok(sv.length === 1 && sv[0].name === nm && !sv[0].binary && eq(sv[0].bytes, r.saved), () => `${ctx}: the host's saved file ${JSON.stringify(sv.map((s) => [s.name, s.bytes.length, s.binary]))}, want ${JSON.stringify(nm)} of ${r.saved.length} bytes${sv[0] ? `, differs at ${firstDiff(sv[0].bytes, r.saved)}` : ''}`);
  Q.check(env, sec, `${ctx}: after Save`, { dk: 0 });
  return { ...r, writes };
}
/** A full Save: the dialog, the name typed over the old one (`text`, or null to keep it), finish. */
function doSave(env, sec, ctx, text, how = 'enter', cfg = {}, dismissHow = 'enter') {
  const f = openSave(env, sec, ctx);
  if (text !== null) { fieldSet(env, f, text); Q.settle(env, 20); Q.check(env, sec, `${ctx}: the name typed`, { dk: 1, field: f }); }
  return finishSave(env, sec, ctx, f, how, cfg, dismissHow);
}
/** Cancel the Save dialog with 'button' | 'esc' | 'break'; nothing may change and the host hears nothing. */
function cancelSave(env, sec, ctx, how) {
  const f = openSave(env, sec, ctx), h = env.host, n0 = h.log.length;
  fieldKeys(env, f, codes('zz'));
  if (how === 'button') { const [x, y] = Q.centreOf(W3.SAVE.cancel); L.click(env, x, y, 3, 6); } else Q.key(env, how === 'esc' ? Q.KEYS.ESC : Q.KEYS.BREAK);
  Q.settle(env, 24);
  sec.ok(h.log.length === n0, () => `${ctx}: Cancel sent commands to the host: ${JSON.stringify(h.log.slice(n0).map((c) => c.n))}`);
  Q.check(env, sec, `${ctx}: after Cancel (${how})`, { dk: 0 });
}

/**
 * Open...: the menu, the discard dialog when the document is changed (answered by `disc`: 'discard' | 'cancel' | 'esc' | 'click-cancel' | 'click-discard'), the pick (answered by `pick`: 'host' | 'cancel' | 'esc' | 'break' | 'raw'),
 * then the model's result checked.  o: { name, bytes (the host's bytes; null: no such file), raw (a name the pick gives as it is), cfg (the model's host flags), events (keys typed during the pick), dismiss }.
 */
function doOpen(env, sec, ctx, o = {}) {
  const st = env.st, h = env.host, pick = o.pick ?? 'host', big = (o.bytes?.length ?? 0) > 2000;
  const changed = st.doc.changed;
  if (pick === 'raw') h.raw = o.raw;                    // the picks FS_PICK makes from now on answer at once with this name as it is
  Q.fileMenu(env, 1); Q.settle(env, 8);
  if (changed) {
    Q.check(env, sec, `${ctx}: the discard dialog first (the document is changed)`, { dk: 0, discard: true });
    sec.ok(h.count(1) === (o._picks ?? h.count(1)) && !h.picking, () => `${ctx}: the pick started before the discard dialog was answered`);
    const disc = o.disc ?? 'discard';
    if (disc === 'cancel') { const b = W.dialogButtons(env); Q.key(env, Q.KEYS.RIGHT); Q.key(env, Q.KEYS.ENTER); void b; }
    else if (disc === 'esc') Q.key(env, Q.KEYS.ESC);
    else if (disc === 'break') Q.key(env, Q.KEYS.BREAK);
    else if (disc === 'click-cancel') { const b = W.dialogButtons(env); W.clickView(env, b.cancel); }
    else if (disc === 'click-discard') { const b = W.dialogButtons(env); W.clickView(env, b.discard); }
    else Q.key(env, Q.KEYS.ENTER);
    Q.settle(env, 20);
    if (disc !== 'discard' && disc !== 'click-discard') {
      sec.ok(h.count(1) === (o._picks ?? 0) && !h.picking, () => `${ctx}: "${disc}" on the discard dialog but the pick started (host.picking ${h.picking})`);
      Q.check(env, sec, `${ctx}: after ${disc} on the discard dialog: nothing changed`, { dk: 0 });
      return { cancelled: true };
    }
  } else if (pick !== 'raw' && !o.noHost) sec.ok(!W.dialogUp(env), () => `${ctx}: the discard dialog opened on an unchanged document`);
  // the pick
  if (o.noHost) {
    // FS_PICK returns status 0: the alert at once
  } else if (pick !== 'raw') {
    sec.ok(Q.until(env, () => h.picking, 40), () => `${ctx}: the pick did not start (host.picking false)`);
    if (!h.picking) return { failed: true };
    Q.check(env, sec, `${ctx}: while FS_PICK waits (no closed menu or dialog on the screen; clarification 10)`, { dk: 0 });
    for (const c of (o.events ?? [])) { Q.key(env, c); }
    if (o.events) { L.click(env, 200, 100, 3, 6); L.moveTo(env, 511, 191); Q.settle(env, 40); sec.ok(h.picking, () => `${ctx}: other events ended the pick`); Q.check(env, sec, `${ctx}: after other events while FS_PICK waits (nothing typed)`, { dk: 0 }); }
  }
  const cmd0 = h.log.length;
  let res = { alert: null }, took = false;
  if (o.noHost) { /* nothing to answer */ res = st.open([], [], { pickOk: false }); took = true; }
  else if (pick === 'host') {
    const picked = codes(o.name);
    if (o.bytes !== null) h.answer(o.name, o.bytes); else h.answer(o.name, []), h.files.delete(o.name);
    res = st.open(picked, o.bytes ?? [], { ...(o.cfg ?? {}), openOk: o.bytes !== null && (o.cfg?.openOk ?? true) }); took = true;
  } else if (pick === 'raw') {
    const picked = codes(o.raw), have = o.bytes !== undefined && o.bytes !== null;
    if (have) h.files.set(o.raw, Uint8Array.from(o.bytes));
    res = st.open(picked, have ? o.bytes : [], { ...(o.cfg ?? {}), openOk: have && (o.cfg?.openOk ?? true) }); took = true;
  } else if (pick === 'cancel') h.answer(null);
  else if (pick === 'esc') Q.key(env, Q.KEYS.ESC);
  else if (pick === 'break') Q.key(env, Q.KEYS.BREAK);
  Q.settle(env, big ? 200 : 60);
  h.raw = null;
  const sent = h.log.slice(cmd0).map((c) => c.n);
  if (pick === 'esc' || pick === 'break') sec.ok(sent.includes(0), () => `${ctx}: ${pick} did not abort the pick at the host (commands ${JSON.stringify(sent)})`);
  if (!took) {
    sec.ok(!h.picking, () => `${ctx}: the pick is still open after ${pick}`);
    sec.ok(!sent.includes(2), () => `${ctx}: FS_OPEN was called after a cancelled pick`);
    Q.check(env, sec, `${ctx}: after the cancelled pick (${pick}): nothing changed`, { dk: 0 });
    return { cancelled: true };
  }
  if (res.alert) { dismiss(env, sec, ctx, res.alert, o.dismiss ?? 'enter'); return res; }
  Q.check(env, sec, `${ctx}: after Open`, { dk: 0 });
  return res;
}
/** "New" from the File menu by the pointer: the discard dialog (answered with Discard) when the document is changed; the model follows. */
function doNew(env, sec, ctx) {
  const st = env.st, ch = st.doc.changed;
  W.fileNew(env); Q.settle(env, 10);
  if (ch) { Q.check(env, sec, `${ctx}: the discard dialog`, { dk: 0, discard: true }); Q.key(env, Q.KEYS.ENTER); Q.settle(env, 24); }
  else sec.ok(!W.dialogUp(env), () => `${ctx}: the discard dialog opened on an unchanged document`);
  st.newDoc();
  Q.check(env, sec, `${ctx}: after New`, { dk: 0 });
}
const dummyBytes = (n) => toFile(genDoc(n), 'LF');
const rnd = (n) => Array.from({ length: n }, () => rng.int(0, 255));

// ===========================================================================================================================
if (has('1')) {
  const sec = new Sec('1 Save... (13.2): the dialog (Dialog, "Save as:", Field id 1 cap 30 holding the name, Save, Cancel); ENTER in the Field and the Save button save; ".txt" added only when there is no "." and it fits in 30; a 30-code name; an empty name saves nothing; Cancel / ESC / BREAK change nothing; refused names and host failures give the alert and change nothing; the writes before and after the gap');
  const env = newEnv(), st = env.st, h = env.host;
  Q.check(env, sec, 'Write just started');
  sec.ok(WM.textOf(Q.nameOf(env)) === 'Untitled', () => `the start name ${JSON.stringify(WM.textOf(Q.nameOf(env)))}, want "Untitled" (13.1)`);
  // an empty document, the prefilled name: "Untitled" gets ".txt"
  let r = doSave(env, sec, 'S1 empty document, name kept', null);
  sec.ok(WM.textOf(st.name) === 'Untitled.txt', 'model name');
  sec.ok(h.files.get('Untitled.txt')?.length === 0, () => `Untitled.txt is ${h.files.get('Untitled.txt')?.length} bytes, want 0`);
  sec.ok(r.writes.length === 0, () => `an empty document made ${r.writes.length} write(s)`);
  // text at the caret's end: one write
  Q.typeDoc(env, 'hello'); Q.keyDoc(env, 13); Q.typeDoc(env, 'world'); Q.settle(env, 40);
  Q.check(env, sec, 'S2 typed');
  r = doSave(env, sec, 'S2 name "doc"', 'doc');
  sec.ok(WM.textOf(st.name) === 'doc.txt' && r.writes.length === 1 && r.writes[0] === 11, () => `name ${WM.textOf(st.name)}, writes ${JSON.stringify(r.writes)}`);
  sec.ok(eq(Array.from(h.files.get('doc.txt') ?? []), [104, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100]), () => `doc.txt ${JSON.stringify(Array.from(h.files.get('doc.txt') ?? []))}`);
  // the caret in the middle: two writes (before and after the gap); the Field holds the document's name "doc.txt"
  for (let i = 0; i < 3; i++) Q.keyDoc(env, 8);
  Q.typeDoc(env, 'XY'); Q.settle(env, 40);
  r = doSave(env, sec, 'S3 caret in the middle, name kept', null);
  sec.ok(r.writes.length === 2, () => `writes ${JSON.stringify(r.writes)}, want 2 (before and after the gap)`);
  // the caret at 0: only the "after" write
  for (let i = 0; i < 20; i++) Q.keyDoc(env, 8);
  r = doSave(env, sec, 'S3b caret at 0, name kept', null);
  sec.ok(st.doc.caret === 0 && r.writes.length === 1 && r.writes[0] === st.doc.L, () => `writes ${JSON.stringify(r.writes)}, want [${st.doc.L}]`);
  Q.typeDoc(env, 'Z');
  // a selection (MARK, RIGHT x 3) is kept by Save: text, caret, anchor, mark and view unchanged (13.2 step 4)
  Q.keyDoc(env, 18); for (let i = 0; i < 3; i++) Q.keyDoc(env, 9); Q.settle(env, 40);
  Q.check(env, sec, 'S3c a selection made');
  doSave(env, sec, 'S3c Save with a selection', null);
  sec.ok(st.doc.mark === 1 && st.doc.S === 3, () => `model: the selection is kept (mark ${st.doc.mark}, S ${st.doc.S})`);
  Q.keyDoc(env, 18); Q.typeDoc(env, 'c');
  // the Save button instead of ENTER
  Q.typeDoc(env, 'b');
  doSave(env, sec, 'S4 the Save button', 'by-button', 'button');
  // names: with and without ".", ".txt" only when it fits in 30
  const nm = [['a.b', 'a.b'], ['abc', 'abc.txt'], ['.hidden', '.hidden'], ['trail.', 'trail.'], ['x'.repeat(26), 'x'.repeat(26) + '.txt'], ['x'.repeat(27), 'x'.repeat(27)], ['x'.repeat(30), 'x'.repeat(30)],
    ['y'.repeat(35), 'y'.repeat(30)], ['x'.repeat(25) + '.q', 'x'.repeat(25) + '.q'], ['Two Words', 'Two Words.txt'], ['a b.c d', 'a b.c d'], ['W'.repeat(30), 'W'.repeat(30)], ['W'.repeat(26), 'W'.repeat(26) + '.txt'], ['q', 'q.txt']];
  for (const [typed, want] of nm) {
    Q.typeDoc(env, 'n');
    r = doSave(env, sec, `S5 name ${JSON.stringify(typed)}`, typed);
    sec.ok(WM.textOf(st.name) === want, () => `typed ${JSON.stringify(typed)} (${typed.length} codes): the name is ${JSON.stringify(WM.textOf(st.name))}, want ${JSON.stringify(want)}`);
    sec.ok(h.files.has(want), () => `the host has no file ${JSON.stringify(want)} (it has ${JSON.stringify([...h.files.keys()].slice(-3))})`);
  }
  // an empty name: nothing saved, the dialog closed, name and changed as before
  Q.typeDoc(env, 'e');
  const n0 = h.saves.length;
  doSave(env, sec, 'S6 an empty name', '');
  sec.ok(h.saves.length === n0 && st.doc.changed, () => `an empty name saved ${h.saves.length - n0} file(s); changed ${st.doc.changed}`);
  // Cancel: the button, ESC, BREAK
  for (const how of ['button', 'esc', 'break']) cancelSave(env, sec, `S7 cancel by ${how}`, how);
  // refused names: the host says 3: the alert, nothing changes (the document stays changed, the name stays)
  for (const bad of ['a*b', 'a?b', 'a/b', 'a:b', 'a<b', 'a>b', 'a|b', 'a"b', 'a\\b']) {
    doSave(env, sec, `S8 refused name ${JSON.stringify(bad)}`, bad, 'enter', { open: false });
    sec.ok(st.doc.changed, 'the model: still changed');
  }
  // the host fails: FS_OPEN, the first FS_WRITE, the second FS_WRITE, FS_CLOSE
  for (let i = 0; i < 3; i++) Q.keyDoc(env, 8);
  const fails = [['FS_OPEN', 'open', (n, b) => (n === 2 ? { status: 6 } : undefined)], ['the first FS_WRITE', 'write', (n) => (n === 4 ? { status: 6 } : undefined)],
    ['the second FS_WRITE', 'write', (() => { let k = 0; return (n) => (n === 4 && ++k === 2 ? { status: 6 } : undefined); })()], ['FS_CLOSE', 'close', (n) => (n === 5 ? { status: 3 } : undefined)]];
  for (const [what, kind, hook] of fails) {
    h.hook = hook;
    const cfg = kind === 'open' ? { open: false } : kind === 'write' ? { write: false } : { close: false };
    doSave(env, sec, `S9 ${what} fails`, 'failing', 'enter', cfg, kind === 'open' ? 'click' : 'enter');
    h.hook = null;
    sec.ok(st.doc.changed, 'the model: still changed');
    sec.ok(!h.files.has('failing.txt') || kind === 'close', () => `S9 ${what} fails: the host holds a file "failing.txt" (a partial file was finished)`);
  }
  // the alert closes with ESC and BREAK too
  doSave(env, sec, 'S10 alert closed by ESC', 'x*', 'enter', { open: false }, 'esc');
  doSave(env, sec, 'S10 alert closed by BREAK', 'x*', 'enter', { open: false }, 'break');
  // no host: status 0 from FS_OPEN: the alert
  env.m.host = null;
  doSave(env, sec, 'S11 no host', 'nohost', 'enter', { open: false });
  env.m.host = h;
  // the dialog opens again (it is kept): the current name, then a normal save works
  r = doSave(env, sec, 'S12 the kept dialog, saved again', 'again');
  sec.ok(WM.textOf(st.name) === 'again.txt' && !st.doc.changed, () => `name ${WM.textOf(st.name)}`);
  sec.end(`${h.saves.length} files saved`);
}

// ===========================================================================================================================
if (has('2')) {
  const sec = new Sec('2 Open... (13.3): text mode (CR LF, TAB, control codes, codes above 126), 5,120 and 5,121 codes, 1,024 and 1,025 lines, an empty file, a cancelled pick (host, ESC, BREAK), refused names, host failures, no host, the discard dialog first when changed, events during the pick, the clipboard kept, the UP / DOWN run ended; every state after each step against the model');
  const env = newEnv(), st = env.st, h = env.host;
  Q.check(env, sec, 'Write just started');
  // a plain file
  doOpen(env, sec, 'O1 plain file', { name: 'plain.txt', bytes: toFile(codes('Line one\rLine two\r\rLast line without an end'), 'LF') });
  sec.ok(WM.textOf(st.name) === 'plain.txt' && st.doc.nl === 4 && st.doc.caret === 0 && st.doc.top === 0, 'model: name plain.txt, 4 lines, caret 0, top 0');
  // text mode conversions (FILES 2)
  const conv = [['crlf.txt', [65, 13, 10, 66, 13, 10]], ['cr.txt', [65, 13, 66, 13, 67]], ['mixed.txt', [65, 13, 10, 10, 13, 66, 13, 13, 10, 67]], ['tab.txt', [65, 9, 9, 66, 9]], ['ctl.txt', [1, 65, 2, 7, 66, 27, 31, 67, 0, 68]],
    ['high.txt', [72, 195, 169, 128, 127, 255, 73]], ['all.txt', Array.from({ length: 256 }, (_, i) => i)], ['onlynl.txt', [10]], ['onlycr.txt', [13, 10, 13, 10]]];
  for (const [name, bytes] of conv) {
    doOpen(env, sec, `O2 text mode ${name}`, { name, bytes });
    const want = W3.textIn(bytes);
    sec.ok(eq(st.doc.codes, want), 'model: the converted codes');
    const s = W.readState(env);
    sec.ok(eq(s.codes, want), () => `${name}: the document holds ${JSON.stringify(WM.textOf(s.codes.slice(0, 40)))}, FILES 2 says ${JSON.stringify(WM.textOf(want.slice(0, 40)))} (differs at ${firstDiff(s.codes, want)})`);
  }
  // an empty file: an empty document named after it, not changed
  doOpen(env, sec, 'O3 empty file', { name: 'empty.txt', bytes: [] });
  sec.ok(WM.textOf(st.name) === 'empty.txt' && st.doc.L === 0 && !st.doc.changed, 'model: empty, named, not changed');
  // 5,120 codes (the limit): accepted; 5,121: the alert, nothing changes
  const full = genDoc(5120, 0.012); const fullFile = toFile(full, 'LF');
  doOpen(env, sec, 'O4 exactly 5,120 codes', { name: 'full.txt', bytes: fullFile });
  sec.ok(st.doc.L === 5120, () => `5,120 codes: model L ${st.doc.L}`);
  Q.typeDoc(env, 'x');
  Q.keyDoc(env, 12);
  const before = st.clone();
  doOpen(env, sec, 'O5 5,121 codes: too long', { name: 'long.txt', bytes: Array.from({ length: 5121 }, () => rng.pick(LET)) });
  sec.ok(eq(st.doc.codes, before.doc.codes) && WM.textOf(st.name) === WM.textOf(before.name), 'model: nothing changed');
  // lines: 1,024 accepted, 1,025: empty document, "Untitled", the alert
  const nl1023 = Array.from({ length: 1023 }, (_, i) => [97 + (i % 26), 10]).flat();            // 1,023 line ends: 1,024 lines
  doOpen(env, sec, 'O6 1,024 lines', { name: 'l1024.txt', bytes: nl1023 });
  sec.ok(st.doc.nl === 1024, () => `model: ${st.doc.nl} lines`);
  const nl1024 = Array.from({ length: 1024 }, (_, i) => [97 + (i % 26), 10]).flat();            // 1,025 lines
  Q.typeDoc(env, 'k');
  doOpen(env, sec, 'O7 1,025 lines', { name: 'l1025.txt', bytes: nl1024 });
  sec.ok(st.doc.L === 0 && WM.textOf(st.name) === 'Untitled' && !st.doc.changed, () => `model: the document is empty and "Untitled" (L ${st.doc.L}, ${WM.textOf(st.name)})`);
  doOpen(env, sec, 'O7b 1,025 lines of bare line ends', { name: 'nl.txt', bytes: new Array(1024).fill(10) });
  // cancelled picks: the host, ESC, BREAK
  doOpen(env, sec, 'O8 a file for later', { name: 'keep.txt', bytes: toFile(codes('keep me\rplease'), 'LF') });
  doOpen(env, sec, 'O8 pick cancelled by the host', { pick: 'cancel' });
  doOpen(env, sec, 'O8 pick cancelled by ESC', { pick: 'esc' });
  doOpen(env, sec, 'O8 pick cancelled by BREAK', { pick: 'break' });
  // events during the pick are discarded
  doOpen(env, sec, 'O9 keys and the mouse during the pick', { name: 'ev.txt', bytes: toFile(codes('events\rdiscarded'), 'LF'), events: [97, 98, 13, 10, 11, 14, 32] });
  // refused names and failures: the alert "could not be opened", nothing else changes
  const base = st.clone();
  doOpen(env, sec, 'O10 a name the file calls refuse (a*b)', { pick: 'raw', raw: 'a*b.txt', bytes: [65] });
  doOpen(env, sec, 'O10 a name longer than 30 from the host', { pick: 'raw', raw: 'n'.repeat(31), bytes: [65] });
  doOpen(env, sec, 'O10 a name for a file that is not there', { pick: 'raw', raw: 'missing.txt', bytes: null });
  doOpen(env, sec, 'O10 a name with a slash', { pick: 'raw', raw: 'dir/file.txt', bytes: [65] });
  sec.ok(eq(st.doc.codes, base.doc.codes) && WM.textOf(st.name) === WM.textOf(base.name), 'model: nothing changed');
  h.hook = (n, b, res) => (n === 2 && (b[0] & 1) === 0 ? { status: 3 } : undefined);
  doOpen(env, sec, 'O11 FS_OPEN fails', { name: 'openfail.txt', bytes: [65, 66, 67], cfg: { openOk: false } });
  h.hook = (n) => (n === 3 ? { status: 7 } : undefined);
  doOpen(env, sec, 'O11 FS_READ fails: the document as after New, then the alert', { name: 'readfail.txt', bytes: toFile(codes('some text\rmore'), 'LF'), cfg: { readOk: false } });
  Q.check(env, sec, 'O11 after the read failure: empty, "Untitled"', { dk: 0 });
  sec.ok(st.doc.L === 0 && WM.textOf(st.name) === 'Untitled', 'model: as after New');
  h.hook = null;
  doOpen(env, sec, 'O11 a file to lose', { name: 'again.txt', bytes: toFile(codes('again'), 'LF') });
  h.hook = (n, b, res) => (n === 3 && res && res.status === 1 ? { status: 1, data: [(res.data[0] + 255) & 255, ((res.data[0] === 0 ? res.data[1] - 1 : res.data[1])) & 255, ...res.data.slice(2, -1)] } : undefined);
  doOpen(env, sec, 'O11 FS_READ gives fewer codes than FS_OPEN said', { name: 'short.txt', bytes: toFile(codes('twelve codes'), 'LF'), cfg: { readOk: false } });
  h.hook = null;
  // no host: FS_PICK gives status 0: the alert
  doOpen(env, sec, 'O12 a file to lose', { name: 'again2.txt', bytes: toFile(codes('again again'), 'LF') });
  env.m.host = null;
  doOpen(env, sec, 'O12 no host', { noHost: true, dismiss: 'click' });
  env.m.host = h;
  // the discard dialog: changed document: Cancel (the button, ESC, BREAK) stops, Discard goes on to the pick
  Q.typeDoc(env, 'changed');
  const picks0 = h.count(1);
  doOpen(env, sec, 'O13 changed: Cancel by the button', { disc: 'click-cancel', _picks: picks0 });
  doOpen(env, sec, 'O13 changed: Cancel (RIGHT, ENTER)', { disc: 'cancel', _picks: picks0 });
  doOpen(env, sec, 'O13 changed: ESC', { disc: 'esc', _picks: picks0 });
  doOpen(env, sec, 'O13 changed: BREAK', { disc: 'break', _picks: picks0 });
  doOpen(env, sec, 'O13 changed: Discard (ENTER), the pick cancelled', { disc: 'discard', pick: 'cancel' });
  sec.ok(st.doc.changed, 'model: still changed after Discard and a cancelled pick');
  doOpen(env, sec, 'O13 changed: Discard by a click, then Open', { disc: 'click-discard', name: 'afterdiscard.txt', bytes: toFile(codes('replaced\rtext'), 'LF') });
  sec.ok(!st.doc.changed, 'model: not changed after Open');
  Q.typeDoc(env, '!');
  doOpen(env, sec, 'O13 changed: Discard, then a too-long file (the document stays as it was)', { disc: 'discard', name: 'long2.txt', bytes: Array.from({ length: 5121 }, () => rng.pick(LET)) });
  sec.ok(st.doc.changed, 'model: the document is still changed');
  // the clipboard is kept and Paste stays enabled (Paste: unchanged); the Edit menu bits follow
  doOpen(env, sec, 'O14 a file for the clipboard test', { disc: 'discard', name: 'clip.txt', bytes: toFile(codes('copy these words'), 'LF') });
  W.editMenu(env, 4); Q.settle(env, 12);                    // Select all
  st.doc.menuItem(4); Q.check(env, sec, 'O14 select all', { dk: 0 });
  W.editMenu(env, 1); Q.settle(env, 12);                    // Copy
  st.doc.menuItem(2); Q.check(env, sec, 'O14 copy', { dk: 0 });
  sec.ok(st.doc.clip.length === 16, 'model: clipboard 16 codes');
  doOpen(env, sec, 'O14 Open with a clipboard', { name: 'other.txt', bytes: toFile(codes('some other text here\rand a second paragraph'), 'LF') });
  sec.ok(st.doc.clip.length === 16, 'model: the clipboard is kept');
  W.editMenu(env, 2); Q.settle(env, 20);                    // Paste at the caret 0
  sec.ok(st.doc.menuItem(3), 'model: Paste enabled'); Q.check(env, sec, 'O14 Paste after Open', { dk: 0 });
  // New names the document "Untitled" (clarification 6)
  Q.keyDoc(env, 12, 3, 3);
  doNew(env, sec, 'O15 New');
  // the UP / DOWN run is ended by Open: a run before it, then the keys act as on a fresh document
  doOpen(env, sec, 'O16 a three-line file', { name: 'run.txt', bytes: toFile(codes('a line of the first paragraph that is long enough to need a good few codes\rshort\rthe third paragraph is here and quite long too, longer than the one before it'), 'LF') });
  Q.keyDoc(env, 10); Q.keyDoc(env, 10); Q.keyDoc(env, 18); Q.keyDoc(env, 9); Q.keyDoc(env, 9);       // a run, and a mark with a selection
  Q.settle(env, 40); Q.check(env, sec, 'O16 a run and a selection before Open', { dk: 0 });
  doOpen(env, sec, 'O16 Open (the run ended, anchor and mark 0, Cut / Copy off)', { disc: 'discard', name: 'run2.txt', bytes: toFile(codes('first line of the second file is long and wide enough\rx\rthird line of the second file, again long enough to matter here'), 'LF') });
  for (const k of [10, 10, 11, 11, 9, 10]) { Q.keyDoc(env, k); Q.settle(env, 20); Q.check(env, sec, `O16 key ${k} after Open`, { dk: 0 }); }
  sec.end(`${h.log.length} host commands`);
}

// ===========================================================================================================================
if (has('3')) {
  const sec = new Sec('3 looks (13.2, 13.4, clarifications 1-2): the Save dialog with a name, with a 30-code name that scrolls in the Field, each alert (one line, two lines) and the title row, against the models; the line pitch of the two-line alerts');
  const env = newEnv(), st = env.st, h = env.host;
  // the Save dialog with the start name, with typing, with a name wider than the Field (30 x "W")
  const f = openSave(env, sec, 'L1');
  fieldSet(env, f, 'W'.repeat(30)); Q.settle(env, 20); Q.check(env, sec, 'L1 30 x W (the Field scrolls)', { dk: 1, field: f });
  fieldKeys(env, f, codes('more')); Q.settle(env, 20); Q.check(env, sec, 'L1 a 31st code is refused (cap 30)', { dk: 1, field: f });
  sec.ok(f.buf.length === 30, 'model: cap 30');
  for (let i = 0; i < 12; i++) Q.key(env, Q.KEYS.LEFT), W3.fieldTyped(f, Q.KEYS.LEFT);
  Q.settle(env, 20); Q.check(env, sec, 'L1 caret moved left in a scrolled Field', { dk: 1, field: f });
  fieldKeys(env, f, codes('i')); Q.settle(env, 20); Q.check(env, sec, 'L1 an "i" typed in the middle', { dk: 1, field: f });
  Q.key(env, Q.KEYS.ESC); Q.settle(env, 20); Q.check(env, sec, 'L1 after ESC', { dk: 0 });
  // the Save dialog's geometry from the view tree (13.2)
  {
    const f2 = openSave(env, sec, 'L2'), views = L.allViews(env.m, env.S);
    const find = (cls, r) => views.find((v) => v.cls === cls && v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h);
    const S_ = env.S, sv = W3.SAVE;
    sec.ok(!!find(S_.CL_Label, sv.label), 'the Label "Save as:" at (144, 68, 200, 9)');
    const fld = find(S_.CL_Field, sv.field);
    sec.ok(!!fld && fld.id === 1 && env.m.ram[fld.a + S_.Field_cap] === 30 && (fld.flags & 1) === 1, () => `the Field at (144, 84, 224, 12): id ${fld && fld.id}, cap ${fld && env.m.ram[fld.a + S_.Field_cap]}, flags ${fld && fld.flags} (want id 1, cap 30, flags bit 0)`);
    const bs = find(S_.CL_Button, sv.save), bc = find(S_.CL_Button, sv.cancel);
    sec.ok(!!bs && bs.id === 1 && (bs.flags & 0x10) !== 0, () => `the Button "Save" at (224, 108, 64, 16): id ${bs && bs.id}, flags ${bs && bs.flags}`);
    sec.ok(!!bc && bc.id === 2, () => `the Button "Cancel" at (304, 108, 64, 16): id ${bc && bc.id}`);
    const d = rd16(env.m, env.S.WR_SDLG);
    sec.ok(d !== 0 && rd16(env.m, d + S_.Dialog_default) === bs?.a && rd16(env.m, d + S_.Dialog_cancel) === bc?.a, 'Save is the dialog\'s default and Cancel its cancel');
    sec.ok(rd16(env.m, env.S.K_FOCUS) === fld?.a, 'the Field has the focus');
    sec.ok(W.dialogUp(env) === false && Q.dlgOpen(env, 'save'), 'the Save dialog is a Dialog (128, 56, 256, 80)');
    Q.key(env, Q.KEYS.ESC); Q.settle(env, 20);
  }
  // the alerts
  const msgs = [['saveFail', () => { h.hook = (n) => (n === 2 ? { status: 3 } : undefined); return doSave(env, sec, 'L3 alert (save)', 'q', 'enter', { open: false }); }],
    ['openFail', () => doOpen(env, sec, 'L3 alert (open)', { pick: 'raw', raw: 'nope.txt', bytes: null })],
    ['tooLong', () => doOpen(env, sec, 'L3 alert (too long)', { name: 'toolong.txt', bytes: Array.from({ length: 5121 }, () => rng.pick(LET)) })],
    ['tooMany', () => doOpen(env, sec, 'L3 alert (too many lines)', { name: 'toomany.txt', bytes: new Array(1030).fill(10) })]];
  for (const [k, f_] of msgs) { f_(); h.hook = null; }
  // the geometry of the alert from the view tree (clarification 1): Label (144, 76, 224, 18), OK (304, 100, 64, 16) id 1 the default and the cancel; then the line pitch of a two-line message
  {
    h.raw = 'nope2.txt'; Q.fileMenu(env, 1); Q.settle(env, 30); h.raw = null;
    const views = L.allViews(env.m, env.S), A = W3.ALERT, find = (cls, r) => views.find((v) => v.cls === cls && v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h);
    const lab = find(env.S.CL_Label, A.label), ok = find(env.S.CL_Button, A.ok), d = rd16(env.m, env.S.WR_ADLG);
    sec.ok(!!lab, () => `the alert's Label at (144, 76, 224, 18): found ${!!lab}; views ${JSON.stringify(views.filter((v) => v.cls === env.S.CL_Label).map((v) => [v.x, v.y, v.w, v.h]))}`);
    sec.ok(!!ok && ok.id === 1 && d !== 0 && rd16(env.m, d + env.S.Dialog_default) === ok.a && rd16(env.m, d + env.S.Dialog_cancel) === ok.a, 'the alert\'s "OK" (304, 100, 64, 16) id 1 is the default and the cancel');
    Q.key(env, Q.KEYS.ENTER); Q.settle(env, 20);
  }
  // clarification 1: a 13 in the label starts a new line 8 rows down (G_TEXTP's GLH; measured once at the top of this file)
  sec.ok(GLH_ALERT.d8 === null, () => `clarification 1: a 13 in the alert's label starts a new line 8 rows down; the machine's second line is not there (the screen differs from the 8-row model: ${GLH_ALERT.d8}; the model with a 9-row pitch ${GLH_ALERT.d9 === null ? 'MATCHES: the machine uses 9' : 'does not match either: ' + GLH_ALERT.d9})`);
  // the title row after each name change, and back to "Untitled" after New
  Q.check(env, sec, 'L4 title after the alerts', { dk: 0 });
  doOpen(env, sec, 'L4 a long name in the title', { name: 'a-rather-long-file-name-30.txt', bytes: [65] });
  doOpen(env, sec, 'L4 a 30-code name in the title', { name: 'z'.repeat(26) + '.txt', bytes: [65] });
  sec.end('the Save dialog (Field scrolling, cap 30), four alerts, titles');
}

// ===========================================================================================================================
if (has('4')) {
  const sec = new Sec('4 random sequences of typing, Save, Open (files saved earlier, generated files, cancels, failures) and New against the model: text, caret, top, changed, line table, bar, selection, clipboard, Edit bits, name, title, WR_DK and the screen after every step; the host\'s files equal the model\'s');
  let steps = 0;
  for (let s = 0; s < NRAND; s++) {
    const env = newEnv(), st = env.st, h = env.host;
    const pool = [];                                    // names the host holds that Open can pick
    const addFile = (name, bytes) => { h.files.set(name, Uint8Array.from(bytes)); pool.push(name); };
    addFile('r0.txt', []); addFile('r1.txt', toFile(genDoc(80), rng.pick(['LF', 'CRLF', 'CR'])));
    addFile('r2.txt', toFile(genDoc(700), rng.pick(['LF', 'CRLF']))); addFile('r3.txt', toFile(genDoc(rng.int(1500, 5120), 0.02), 'LF'));
    addFile('rbad.txt', rnd(300)); addFile('rlong.txt', Array.from({ length: 5121 }, () => rng.pick(LET))); addFile('rnl.txt', new Array(1025).fill(10));
    const trail = [];
    for (let k = 0; k < 8; k++) {
      const op = rng.pick(['type', 'type', 'save', 'open', 'open', 'new', 'cancelopen', 'keys', 'failsave']);
      trail.push(op);
      const ctx = `seq ${s} step ${k} (${trail.join(' > ')})`;
      steps++;
      if (op === 'type') { const n = rng.int(1, 6); for (let i = 0; i < n; i++) Q.keyDoc(env, rng.chance(0.15) ? 13 : rng.chance(0.2) ? 32 : rng.pick(LET)); Q.settle(env, 40); Q.check(env, sec, ctx, { dk: 0 }); }
      else if (op === 'keys') { for (let i = 0; i < rng.int(1, 5); i++) Q.keyDoc(env, rng.pick([8, 9, 10, 11, 12])); Q.settle(env, 40); Q.check(env, sec, ctx, { dk: 0 }); }
      else if (op === 'save') {
        const typed = rng.pick([null, null, 'rs' + rng.int(0, 5), 'a.b' + rng.int(0, 3), '', 'x'.repeat(rng.int(20, 30)), 'n' + rng.int(0, 9) + '.txt']);
        const r = doSave(env, sec, ctx, typed, rng.pick(['enter', 'button']));
        if (r.saved) { pool.push(WM.textOf(r.name)); }
      } else if (op === 'failsave') {
        const kind = rng.pick(['open', 'write']);
        h.hook = kind === 'open' ? (n) => (n === 2 ? { status: 3 } : undefined) : (n) => (n === 4 ? { status: 6 } : undefined);
        doSave(env, sec, ctx, rng.pick([null, 'fs']), 'enter', kind === 'open' ? { open: false } : { write: st.doc.L === 0 ? true : false });
        h.hook = null;
      } else if (op === 'open') {
        const name = rng.pick(pool), bytes = Array.from(h.files.get(name) ?? []);
        doOpen(env, sec, ctx, { name, bytes, disc: rng.chance(0.2) ? rng.pick(['cancel', 'esc', 'click-cancel']) : 'discard', _picks: h.count(1), dismiss: rng.pick(['enter', 'esc', 'click']) });
      } else if (op === 'cancelopen') {
        doOpen(env, sec, ctx, { pick: rng.pick(['cancel', 'esc', 'break']) });
      } else if (op === 'new') doNew(env, sec, ctx);
      if (sec.nf > 0 && !VERBOSE && sec.fails.length >= 5) break;
    }
    if (sec.nf > 0 && !VERBOSE && sec.fails.length >= 5) break;
  }
  sec.end(`${steps} steps`);
}

// ===========================================================================================================================
if (has('5')) {
  const sec = new Sec('5 real frames: "Save..." with a typed name, then "Open..." of the saved file, the document equal; a 5,120-code round trip (Open, Save, New, Open again) with the host\'s bytes equal at every stage; the picker on a name the Save made');
  const env = newEnv(), st = env.st, h = env.host;
  const text = 'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs.';
  Q.typeDoc(env, text); Q.keyDoc(env, 13); Q.typeDoc(env, 'Second paragraph, with a few words more.'); Q.keyDoc(env, 13); Q.keyDoc(env, 13); Q.typeDoc(env, 'Third, after a blank line.');
  Q.settle(env, 40); Q.check(env, sec, 'R1 typed');
  const was = st.doc.codes.slice();
  doSave(env, sec, 'R1 Save...', 'roundtrip');
  sec.ok(h.files.has('roundtrip.txt'), 'roundtrip.txt is on the host');
  doNew(env, sec, 'R1 New');
  doOpen(env, sec, 'R1 Open... of the saved file', { name: 'roundtrip.txt', bytes: Array.from(h.files.get('roundtrip.txt')) });
  sec.ok(eq(st.doc.codes, was) && WM.textOf(st.name) === 'roundtrip.txt', 'model: the document equals the one saved');
  sec.ok(eq(W.readState(env).codes, was), () => `the machine's document differs from the saved one at ${firstDiff(W.readState(env).codes, was)}`);
  // 5,120 codes, 80+ lines: Open, Save as another name, New, Open that
  const doc5 = genDoc(5120, 0.012), f5 = toFile(doc5, 'LF');
  doOpen(env, sec, 'R2 Open 5,120 codes', { name: 'big.txt', bytes: f5 });
  sec.ok(st.doc.L === 5120, () => `model L ${st.doc.L}`);
  Q.keyDoc(env, 12); Q.keyDoc(env, 9); Q.typeDoc(env, 'q');                      // a full document: the typed code is refused or accepted, the model decides
  Q.settle(env, 40); Q.check(env, sec, 'R2 an edit of the full document');
  for (let i = 0; i < 30; i++) Q.keyDoc(env, 10);                                   // the view scrolls away from the top: Save leaves it (13.2 step 4)
  Q.settle(env, 40); Q.check(env, sec, 'R2 scrolled');
  sec.ok(st.doc.top > 0, () => `model: top ${st.doc.top}`);
  const savedCodes = st.doc.codes.slice();
  doSave(env, sec, 'R2 Save... of the 5,120-code document', 'big2.txt');
  const bytes2 = Array.from(h.files.get('big2.txt') ?? []);
  sec.ok(eq(bytes2, W3.textOut(savedCodes)), () => `big2.txt on the host: ${bytes2.length} bytes, differs at ${firstDiff(bytes2, W3.textOut(savedCodes))}`);
  doNew(env, sec, 'R2 New');
  doOpen(env, sec, 'R2 Open the saved big file again', { name: 'big2.txt', bytes: bytes2 });
  sec.ok(eq(st.doc.codes, savedCodes), 'model: equal');
  sec.ok(eq(W.readState(env).codes, savedCodes), () => `the machine's 5,120-code document differs at ${firstDiff(W.readState(env).codes, savedCodes)}`);
  // Save without any change, then Save again under another name (the model: changed cleared each time)
  doSave(env, sec, 'R3 Save of an unchanged document', 'copy');
  sec.ok(eq(Array.from(h.files.get('copy.txt') ?? []), W3.textOut(st.doc.codes)), 'copy.txt equals the document');
  sec.end(`${h.saves.length} files saved`);
}

// ===========================================================================================================================
if (has('6')) {
  const sec = new Sec('6 stack <= 128 bytes, no DI, SP right: the W3 paths by direct calls of WR_MENU (Save..., Open... with the pick answered at its first HALT, a too-long file, a 5,120-code file) and of the Save dialog\'s command; interrupts on');
  const env = Q.bootW3({ rng }); envs.push(env);
  W.parkDirect(env);
  const { m, S } = env, h = env.host;
  const st = { di: 0, worst: 0, what: '' };
  const note = (r, what) => { st.di += r.di; if (r.stack > st.worst) { st.worst = r.stack; st.what = what; } sec.ok(r.di === 0, () => `${what}: ${r.di} DI`); sec.ok(r.badSp === undefined, () => `${what}: SP ${hex(r.badSp)} after the return`); sec.ok(r.stack <= 128, () => `${what}: stack ${r.stack} bytes (bound 128)`); };
  const ADDR = { dkcmd: env.S.wr_dkcmd };
  sec.ok(ADDR.dkcmd !== undefined, 'the symbol wr_dkcmd exists (the Save dialog\'s command handler)');
  // type a short document with the keys through K_DISPATCH (the machine is parked: no frames)
  const typeK = (cs) => { for (const c of cs) W.dispatch(env, W.keyRec(c), {}); };
  typeK([...codes('hello'), 13, ...codes('world')]);
  // Save...: the dialog opens
  let r = W.menuCall(env, 1, 3, { ints: true }); note(r, 'WR_MENU Save...');
  sec.ok(m.ram[S.WR_DK] === 1, () => `WR_DK ${m.ram[S.WR_DK]} after Save..., want 1`);
  // the name: the Field holds "Untitled"; ENTER posts E_CMD: the Write loop would hand it to the dialog's handler (A = WR_DK, K_EV = the record)
  for (let i = 0; i < 8; i++) W.dispatch(env, W.keyRec(12), {});
  typeK(codes('stack'));
  T.setEv(env, [E.CMD, 1, 0, 0]);
  r = T.runCall(env, ADDR.dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); note(r, 'the Save dialog\'s command (Save)');
  sec.ok(h.files.has('stack.txt') && eq(Array.from(h.files.get('stack.txt')), [104, 101, 108, 108, 111, 10, 119, 111, 114, 108, 100]), () => `stack.txt on the host: ${JSON.stringify(Array.from(h.files.get('stack.txt') ?? []))}`);
  sec.ok(m.ram[S.WR_DK] === 0 && WM.textOf(Q.nameOf(env)) === 'stack.txt', () => `WR_DK ${m.ram[S.WR_DK]}, name ${JSON.stringify(WM.textOf(Q.nameOf(env)))}`);
  // Save with a failing host: the alert path
  W.menuCall(env, 1, 3, { ints: true });
  h.hook = (n) => (n === 2 ? { status: 3 } : undefined);
  T.setEv(env, [E.CMD, 1, 0, 0]);
  r = T.runCall(env, ADDR.dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); note(r, 'the Save dialog\'s command (failing host: the alert)');
  h.hook = null;
  sec.ok(m.ram[S.WR_DK] === 2, () => `WR_DK ${m.ram[S.WR_DK]} after a failed save, want 2 (the alert)`);
  T.setEv(env, [E.CMD, 1, 0, 0]);
  r = T.runCall(env, ADDR.dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); note(r, 'the alert\'s OK');
  // Open...: the document is changed (typed), so the discard dialog opens first: Cancel it through WR_MENU's own path is the loop's; here New the document by the model's route: use an unchanged state by saving first
  const openCall = (file, name, label) => {
    h.files.set(name, Uint8Array.from(file));
    return W.menuCall(env, 1, 2, { ints: true, onHalt: () => { h.answer(name, file); } });
  };
  sec.ok(m.ram[S.WR_CHG] === 0, () => `WR_CHG ${m.ram[S.WR_CHG]} (the save cleared it)`);
  r = openCall(toFile(codes('a small file\rof two lines'), 'LF'), 'small.txt'); note(r, 'WR_MENU Open... (small file)');
  sec.ok(WM.textOf(Q.nameOf(env)) === 'small.txt', () => `name ${JSON.stringify(WM.textOf(Q.nameOf(env)))}`);
  r = openCall(Array.from({ length: 5121 }, () => rng.pick(LET)), 'toolong.txt'); note(r, 'WR_MENU Open... (5,121 codes: the alert)');
  sec.ok(m.ram[S.WR_DK] === 2, () => `WR_DK ${m.ram[S.WR_DK]}, want 2 (alert)`);
  T.setEv(env, [E.CMD, 1, 0, 0]); r = T.runCall(env, ADDR.dkcmd, { a: 2 }, { map: 'A', ints: true }); note(r, 'the alert\'s OK (too long)');
  r = openCall(new Array(1030).fill(10), 'lines.txt'); note(r, 'WR_MENU Open... (1,025+ lines: the alert)');
  T.setEv(env, [E.CMD, 1, 0, 0]); r = T.runCall(env, ADDR.dkcmd, { a: 2 }, { map: 'A', ints: true }); note(r, 'the alert\'s OK (too many lines)');
  const big = toFile(genDoc(5120, 0.012), 'LF');
  r = openCall(big, 'big.txt'); note(r, 'WR_MENU Open... (5,120 codes)');
  const s = W.readState(env);
  sec.ok(s.codes.length === 5120 && eq(s.codes, W3.textIn(big)), () => `the 5,120-code Open: ${s.codes.length} codes, differs at ${firstDiff(s.codes, W3.textIn(big))}`);
  // Save of that document
  W.menuCall(env, 1, 3, { ints: true });
  T.setEv(env, [E.CMD, 1, 0, 0]);
  r = T.runCall(env, ADDR.dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); note(r, 'the Save dialog\'s command (5,120 codes)');
  sec.ok(eq(Array.from(h.files.get('big.txt.txt') ?? h.files.get('big.txt') ?? []), big), 'the saved big file equals the opened one');
  // Cancel of the Save dialog and a pick cancelled
  W.menuCall(env, 1, 3, { ints: true });
  T.setEv(env, [E.CMD, 2, 0, 0]); r = T.runCall(env, ADDR.dkcmd, { a: m.ram[S.WR_DK] }, { map: 'A', ints: true }); note(r, 'the Save dialog\'s command (Cancel)');
  r = W.menuCall(env, 1, 2, { ints: true, onHalt: () => { h.answer(null); } }); note(r, 'WR_MENU Open... (the host cancels)');
  sec.end(`deepest stack ${st.worst} bytes (${st.what}); ${st.di} DI`);
  globalThis.__w3stack = st;
}

// ===========================================================================================================================
if (has('7')) {
  const sec = new Sec('7 frames and memory: V_FRAMES rose by 1 on every frame run normally (no interrupt lost, no DI), the memory watch of BANKING 10.7, and no write to $C000-$C3FF outside Write\'s variables (WR_BUF .. WR_PNAME + 32: the image\'s constants and the RAM after it are untouched)');
  envs.forEach((env, i) => {
    sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first ${env.vf.first}`);
    sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`);
    sec.ok(env.imgw.n === 0, () => `machine ${i}: ${env.imgw.n} write(s) to $C000-$C3FF outside ${hex(env.imgw.lo)}-${hex(env.imgw.hi - 1)}: ${env.imgw.first.join(' | ')}`);
  });
  sec.end(`${envs.length} machines, ${envs.reduce((a, e) => a + e.vf.checked, 0)} frames checked`);
}
finish();
