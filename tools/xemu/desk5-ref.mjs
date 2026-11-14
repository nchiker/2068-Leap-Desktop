"use strict";
// desk5-ref.mjs -- the TSRun reference for the cross-emulator runs of desk5 (docs/SHELL.md 8 test 5).
//   node tools/xemu/desk5-ref.mjs [OUTDIR]        (default build/xemu/desk5-ref)
// Does NOT build: boots the existing build/desk5.dck (symbols from build/desk5/out.sym).  No mouse is attached (the Kempston ports read $FF).
// The cartridge boots into the shell (K_PROG 0: "Leap Desktop" window, icons Calculator and Controls, Calculator focused).  Steps:
//   1. boot (K_PROG poisoned with $FF after reset, RAM being random) until K_PROG = 0, then 30 frames more, then until the display RAM is unchanged over 20 frames (checked every 20): "shell"
//   2. ENTER (opens the focused icon); until K_PROG = 1, 30 frames more, settled: "calc" (C_DSTR = "0")
//   3. 1 2 3 . 4 5 SS+B 6 ENTER through the keyboard matrix (m.keyMatrix, active low, index = half-row in the order $FE $FD $FB $F7 $EF $DF
//      $BF $7F, bit 0-4), each key (or chord) held 3 frames, released 3 frames ('.' = SS+M; 123.45 * 6 = 740.7); settled: "typed"
//   4. SYMBOL SHIFT + Q (CLOSE, held 3 frames); until K_PROG = 0, 30 frames more, settled: "back", which must equal "shell" byte for byte.
//   5. (T2/T3, docs/TOOLKIT.md 10.8 item 6) the Controls session: TAB (CAPS SHIFT + 1) focuses the Controls icon, ENTER opens it: "ctl" (K_PROG 2);
//      TAB x5 (to the List), DOWN x10 (CS+6): "list"; TAB (the Field), LEFT x2 (CS+5), x, SS+P ('"'), SS+Z (':'), DELETE (CS+0): "field";
//      ENTER (the status line reads Name: ...): "status"; SYMBOL SHIFT + Q: "back2" (K_PROG 0; whether it equals "shell" is reported, not required).
//   6. (docs/WRITE.md 8 item 7) the Write session, from the shell: TAB x2 (CAPS SHIFT + 1; the third icon), ENTER (K_PROG 3): "wr-open"; a typed paragraph that wraps
//      (with SYMBOL SHIFT characters) and short lines to about 20 lines, so that the view scrolls: "wr-typed"; UP x4, LEFT, DELETE, x: "wr-edit";
//      SYMBOL SHIFT + Q (the document has changed: the discard dialog): "wr-dialog" (K_PROG 3); ENTER (Discard): "wr-back" (K_PROG 0, equal to "shell" byte for byte).
//      The characters are keyed through the matrix from build/desk5/keymap.inc (plain, else SYMBOL SHIFT, else CAPS SHIFT).
//   7. (docs/WRITE.md 12.9 item 7; only when the build has the W2 symbols WR_AN, WR_MK, WR_CLN, WR_MENU, MB_ENT) the W2 session, from the shell again: TAB x2, ENTER (K_PROG 3): "w2-open"; three short lines
//      typed: "w2-typed"; MARK (SYMBOL SHIFT + E), UP, UP, LEFT, LEFT select across lines: "w2-sel"; MENU (CAPS SHIFT + 9), RIGHT (CS + 8): the "Edit" menu open, Cut highlighted: "w2-menu"; DOWN (Copy), ENTER:
//      "w2-copy" (the clipboard filled, the selection kept); RIGHT (the caret to the selection's end), ENTER, MENU, RIGHT (Paste is the first enabled item), ENTER: "w2-paste"; SYMBOL SHIFT + Q: "w2-dialog";
//      ENTER (Discard): "w2-back" (= "shell").  Extra data per checkpoint: WR_AN, WR_MK, WR_CLN, the Edit entry's enable word (MB_ENT + ME_SIZE + ME_EN) and the clipboard's bytes.
//   8. (docs/WRITE.md 13.7 item 5; only when the build has the W3 symbols WR_NAME, WR_SDLG, WR_ADLG, WR_DK, FS_OPEN) the W3 session, with NO file bridge (m.host unset: TSRun's port $6F reads $FF, as ZEsarUX's does; the FS_ calls
//      then give status 0): from the shell, TAB x2, ENTER (K_PROG 3): "w3-open"; "abc" typed: "w3-typed"; MENU (CAPS SHIFT + 9), DOWN x2 (File: New, Open..., Save...), ENTER: "w3-dialog" (the Save dialog, its Field
//      holding "Untitled"); DELETE x8, "t1": "w3-name"; ENTER (Save: FS_OPEN fails): "w3-alert" (the alert "The file could not be saved."); ENTER (OK): "w3-after" (the document, its name "Untitled" and WR_CHG unchanged: the screen
//      is reported against "w3-typed"); SYMBOL SHIFT + Q: "w3-discard" (the discard dialog); ENTER (Discard): "w3-back" (K_PROG 0, = "shell").  Extra data per checkpoint: the document's codes (hex), WR_NAME (length byte and codes, hex),
//      WR_TITLE (hex), WR_CHG, WR_DK (the dialog open: 0 none, 1 Save, 2 the alert), whether WR_SDLG / WR_ADLG are made (non-zero), and the document counters of 6.
// Per checkpoint NAME: NAME.bin (display RAM: $4000-$57FF then $6000-$77FF, 12,288 bytes), NAME.pbm (rendered 512x192, P4, 1 = ink),
// NAME.json (display string, K_PROG, V_FRAMES, K_PX, K_PY, frame counts).  Also keys.json (the typed keys, display string after each key,
// K_PROG after each step) for the other runners.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, M, screenPixel, SCR_W, SCR_H } from '../../tests/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(ROOT, 'build/xemu/desk5-ref');
mkdirSync(outDir, { recursive: true });

const S = {};
for (const line of readFileSync(join(ROOT, 'build/desk5/out.sym'), 'utf8').split('\n')) {
  const mm = line.match(/^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)/);
  if (mm) S[mm[1]] = parseInt(mm[2], 16);
}
// [row, bit] of the matrix: rows $FE $FD $FB $F7 $EF $DF $BF $7F; row 7 = SPACE, SS, M, N, B
const D1 = [3, 0], D2 = [3, 1], D3 = [3, 2], D4 = [3, 3], D5 = [3, 4], D6 = [4, 4];
const SS = [7, 1], KM = [7, 2], KB = [7, 4], ENTER = [6, 0], KQ = [2, 0];
const SEQ = [
  ['1', [D1]], ['2', [D2]], ['3', [D3]], ['.', [SS, KM]], ['4', [D4]], ['5', [D5]], ['*', [SS, KB]], ['6', [D6]], ['ENTER', [ENTER]],
];
const EXPECT = '740.7';
const CLOSEKEYS = [SS, KQ];
const CS = [0, 0], KZ = [0, 1], KX = [0, 2], KP = [5, 0], K0 = [4, 0];
const TAB = [CS, D1], LEFT = [CS, D5], DOWN = [CS, D6], DELETE = [CS, K0], SSP = [SS, KP], SSZ = [SS, KZ];
const CTL = [['TAB', TAB], ['ENTER', [ENTER]]];
const LISTSEQ = [...Array(5).fill(['TAB', TAB]), ...Array(10).fill(['DOWN', DOWN])];
const FIELDSEQ = [['TAB', TAB], ['LEFT', LEFT], ['LEFT', LEFT], ['x', [KX]], ['SS+P', SSP], ['SS+Z', SSZ], ['DELETE', DELETE]];
const STATUSSEQ = [['ENTER', [ENTER]]];

// the Write session's keys
const keymap = (() => {
  const t = readFileSync(join(ROOT, 'build/desk5/keymap.inc'), 'utf8').split('\n').filter((l) => /^\s+DB\s+\d+\s+;/.test(l)).map((l) => +l.match(/DB\s+(\d+)/)[1]);
  const byCode = new Map();
  for (const plane of [0, 2, 1]) for (let k = 0; k < 40; k++) {
    const code = t[40 * plane + k];
    if (code && !byCode.has(code)) byCode.set(code, [...(plane === 2 ? [SS] : plane === 1 ? [CS] : []), [Math.floor(k / 5), k % 5]]);
  }
  return byCode;
})();
const typeText = (str) => [...str].map((ch) => [ch === '\n' ? 'ENTER' : ch, keymap.get(ch === '\n' ? 13 : ch.charCodeAt(0))]);
const UP = [CS, [4, 3]];
const WR_PARA = 'the quick brown fox jumps over the lazy dog; pack my box with five dozen liquor jugs: "how vexingly quick daft zebras jump?" sphinx of black quartz, judge my vow. ' +
  'we all quietly watched 3 big green frogs! #1 (and 2 more) cost $5.00 each.';
const WR_SHORT = 'abcdefghijklmnop';       // 16 short lines "a".."p": ENTER ends each but the last
const WR_TYPED = [...typeText(WR_PARA + '\n'), ...[...WR_SHORT].flatMap((ch, i) => typeText(i < WR_SHORT.length - 1 ? ch + '\n' : ch + ' ' + ch))];
const WR_EDIT = [...Array(4).fill(['UP', UP]), ['LEFT', LEFT], ['DELETE', DELETE], ['x', [KX]]];
const WR_OPEN = [['TAB', TAB], ['TAB', TAB], ['ENTER', [ENTER]]];
const KE = [2, 2];
const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
const prog = (m) => m.ram[S.K_PROG];
const dstr = (m) => { const n = m.ram[S.C_DSTR]; return String.fromCharCode(...m.ram.subarray(S.C_DSTR + 1, S.C_DSTR + 1 + Math.min(n, 40))); };
const displayRam = (m) => {
  const out = new Uint8Array(12288);
  out.set(m.ram.subarray(0x4000, 0x5800), 0);
  out.set(m.ram.subarray(0x6000, 0x7800), 6144);
  return out;
};
const rowOff = (y) => ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
const ramPixel = (d, x, y) => { const c = x >> 3; return (d[(c & 1) * 6144 + rowOff(y) + (c >> 1)] >> (7 - (x & 7))) & 1; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rd_ = (n) => readFileSync(join(outDir, `${n}.bin`));

const m = boot(readFileSync(join(ROOT, 'build/desk5.dck')));
m.ram[S.K_PROG] = 0xFF;      // RAM is random at power-on: poison K_PROG so that 0 means the launcher has started the shell
let frames = 0;
const run = (n) => { for (let i = 0; i < n; i++) { M.runFrame(m); frames++; } };
function settle(maxExtra) {
  let prev = displayRam(m), used = 0;
  while (used < maxExtra) {
    run(20); used += 20;
    const cur = displayRam(m);
    if (same(prev, cur)) return true;
    prev = cur;
  }
  return false;
}
let mismatch = 0;
function dump(name, settled) {
  const d = displayRam(m);
  const pbm = Buffer.alloc(SCR_W / 8 * SCR_H);
  let bad = 0, ink = 0;
  for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
    const i = screenPixel(m, x, y) === 0 ? 1 : 0;
    if (i !== ramPixel(d, x, y)) bad++;
    if (i) { pbm[y * (SCR_W / 8) + (x >> 3)] |= 0x80 >> (x & 7); ink++; }
  }
  mismatch += bad;
  const vars = { frame: frames, settled, K_PROG: prog(m), display: dstr(m), dstrLen: m.ram[S.C_DSTR], V_FRAMES: rd16(m, S.V_FRAMES), K_PX: rd16(m, S.K_PX), K_PY: rd16(m, S.K_PY), ink };
  writeFileSync(join(outDir, `${name}.bin`), d);
  writeFileSync(join(outDir, `${name}.pbm`), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(vars) + '\n');
  console.log(`${name}: frame ${frames}, K_PROG ${vars.K_PROG}, display "${vars.display}", settled ${settled}, V_FRAMES ${vars.V_FRAMES}, K_PX ${vars.K_PX}, K_PY ${vars.K_PY}, ink pixels ${ink}, rendered vs RAM mismatches ${bad}`);
  return vars;
}

const press = (keys) => {
  for (const [r, b] of keys) m.keyMatrix[r] &= ~(1 << b);
  run(3);
  for (const [r, b] of keys) m.keyMatrix[r] |= 1 << b;
  run(3);
};
const untilProg = (n) => { while (prog(m) !== n && frames < 2000) run(1); return prog(m) === n; };

// 1. the shell
const shellUp = untilProg(0);
const framesToShell = frames;
run(30);
const shellSettled = settle(300);
const shell = dump('shell', shellSettled);
const kprog = { shell: shell.K_PROG };

// 2. ENTER opens Calculator
press([ENTER]);
const calcUp = untilProg(1);
run(30);
const calcSettled = settle(300);
const calc = dump('calc', calcSettled);
kprog.calc = calc.K_PROG;

// 3. the typed sequence
const afterKey = [];
for (const [name, keys] of SEQ) {
  press(keys);
  afterKey.push([name, dstr(m)]);
}
const typedSettled = settle(60);
const typed = dump('typed', typedSettled);
kprog.typed = typed.K_PROG;

// 4. SYMBOL SHIFT + Q quits to the shell
press(CLOSEKEYS);
const backUp = untilProg(0);
run(30);
const backSettled = settle(300);
const back = dump('back', backSettled);
kprog.back = back.K_PROG;

// 5. the Controls session
const pressSeq = (seq) => { for (const [, keys] of seq) press(keys); };
pressSeq(CTL.slice(0, 1));                  // TAB: the focus to the Controls icon
press(CTL[1][1]);                            // ENTER: opens it
const ctlUp = untilProg(2);
run(30);
const ctlSettled = settle(300);
const ctl = dump('ctl', ctlSettled);
pressSeq(LISTSEQ);
const listSettled = settle(60);
const list = dump('list', listSettled);
pressSeq(FIELDSEQ);
const fieldSettled = settle(60);
const field = dump('field', fieldSettled);
pressSeq(STATUSSEQ);
const statusSettled = settle(60);
const status = dump('status', statusSettled);
press(CLOSEKEYS);
const back2Up = untilProg(0);
run(30);
const back2Settled = settle(300);
const back2 = dump('back2', back2Settled);
const back2EqShell = same(readFileSync(join(outDir, 'back2.bin')), readFileSync(join(outDir, 'shell.bin')));
// 6. the Write session (WRITE 8 item 7)
const wrvars = () => ({ WR_NL: rd16(m, S.WR_NL), WR_TOP: rd16(m, S.WR_TOP), WR_GS: rd16(m, S.WR_GS), WR_GE: rd16(m, S.WR_GE), WR_CHG: m.ram[S.WR_CHG] });
pressSeq(WR_OPEN.slice(0, 2));
press(WR_OPEN[2][1]);
const wrUp = untilProg(3);
run(30);
const wrOpenSettled = settle(300);
const wrOpen = dump('wr-open', wrOpenSettled);
const wrOpenV = wrvars();
pressSeq(WR_TYPED);
const wrTypedSettled = settle(120);
const wrTyped = dump('wr-typed', wrTypedSettled);
const wrTypedV = wrvars();
pressSeq(WR_EDIT);
const wrEditSettled = settle(120);
const wrEdit = dump('wr-edit', wrEditSettled);
const wrEditV = wrvars();
press(CLOSEKEYS);
const wrDlgSettled = (run(30), settle(300));
const wrDlg = dump('wr-dialog', wrDlgSettled);
press([ENTER]);
const wrBackUp = untilProg(0);
run(30);
const wrBackSettled = settle(300);
const wrBack = dump('wr-back', wrBackSettled);
const wrBackEqShell = same(readFileSync(join(outDir, 'wr-back.bin')), readFileSync(join(outDir, 'shell.bin')));
const wrNames = ['wr-open', 'wr-typed', 'wr-edit', 'wr-dialog'];
const rdb = (n) => readFileSync(join(outDir, `${n}.bin`));
const wrDistinct = wrNames.every((n, i) => i === 0 || !same(rdb(n), rdb(wrNames[i - 1])));
const wrOk = wrUp && wrOpenSettled && wrOpen.K_PROG === 3 && wrTypedSettled && wrTyped.K_PROG === 3 && wrEditSettled && wrEdit.K_PROG === 3 &&
  wrDlgSettled && wrDlg.K_PROG === 3 && wrBackUp && wrBackSettled && wrBack.K_PROG === 0 && wrBackEqShell && wrDistinct &&
  wrTypedV.WR_NL >= 18 && wrTypedV.WR_TOP > 0 && wrTypedV.WR_CHG === 1;
console.log(`write session: lines/top/changed after typing ${JSON.stringify(wrTypedV)}, after edit ${JSON.stringify(wrEditV)}; wr-back equals shell ${wrBackEqShell}; ${WR_TYPED.length} typing presses`);
// 7. the W2 session (WRITE 12.9 item 7)
let w2 = null;
if (['WR_AN', 'WR_MK', 'WR_CLN', 'WR_MENU', 'MB_ENT', 'ME_SIZE', 'ME_EN'].every((n) => S[n] !== undefined)) {
  const MARKK = keymap.get(18) ?? [SS, KE], MENUK = keymap.get(16) ?? [CS, [4, 1]], RIGHTK = keymap.get(9) ?? [CS, [4, 2]];
  const W2_TYPED = typeText('alpha beta gamma delta\nsecond line here\nthird');
  const W2_SEL = [['MARK', MARKK], ['UP', UP], ['UP', UP], ['LEFT', LEFT], ['LEFT', LEFT]];
  const W2_MENU = [['MENU', MENUK], ['RIGHT', RIGHTK]];
  const W2_COPY = [['DOWN', DOWN], ['ENTER', [ENTER]]];
  const W2_MOVE = [['RIGHT', RIGHTK], ['ENTER', [ENTER]]];
  const W2_PASTE = [['MENU', MENUK], ['RIGHT', RIGHTK], ['ENTER', [ENTER]]];
  const vars2 = () => ({ ...wrvars(), WR_AN: rd16(m, S.WR_AN), WR_MK: m.ram[S.WR_MK], WR_CLN: rd16(m, S.WR_CLN), EDIT_EN: rd16(m, S.MB_ENT + S.ME_SIZE + S.ME_EN),
    CLIP: Buffer.from(m.ram.subarray(0x7800, 0x7800 + Math.min(rd16(m, S.WR_CLN), 2048))).toString('hex') });
  pressSeq(WR_OPEN.slice(0, 2));
  press(WR_OPEN[2][1]);
  const up = untilProg(3);
  run(30);
  const open = dump('w2-open', settle(300)); const vOpen = vars2();
  pressSeq(W2_TYPED); const typed = dump('w2-typed', settle(120)); const vTyped = vars2();
  pressSeq(W2_SEL); const sel = dump('w2-sel', settle(120)); const vSel = vars2();
  pressSeq(W2_MENU); const menu = dump('w2-menu', settle(120)); const vMenu = vars2();
  pressSeq(W2_COPY); const copy = dump('w2-copy', settle(120)); const vCopy = vars2();
  pressSeq(W2_MOVE); pressSeq(W2_PASTE); const paste = dump('w2-paste', settle(120)); const vPaste = vars2();
  press(CLOSEKEYS); const dlgSettled = (run(30), settle(300)); const dlg = dump('w2-dialog', dlgSettled);
  press([ENTER]); const backUp = untilProg(0); run(30); const backSettled = settle(300); const back = dump('w2-back', backSettled);
  const backEq = same(readFileSync(join(outDir, 'w2-back.bin')), readFileSync(join(outDir, 'shell.bin')));
  const names = ['w2-open', 'w2-typed', 'w2-sel', 'w2-menu', 'w2-copy', 'w2-paste', 'w2-dialog'];
  const distinct = names.every((n, i) => i === 0 || !same(rd_(n), rd_(names[i - 1])));
  const okW2 = up && open.K_PROG === 3 && typed.K_PROG === 3 && sel.K_PROG === 3 && menu.K_PROG === 3 && copy.K_PROG === 3 && paste.K_PROG === 3 && dlg.K_PROG === 3 && backUp && backSettled && back.K_PROG === 0 && backEq && distinct &&
    vOpen.WR_CLN === 0 && vOpen.EDIT_EN === 1 && vSel.WR_MK === 1 && vSel.WR_AN !== vSel.WR_GS && vCopy.WR_CLN > 0 && vCopy.WR_MK === 0 && vPaste.WR_CLN === vCopy.WR_CLN && vPaste.WR_AN === vPaste.WR_GS && vPaste.WR_CHG === 1;
  console.log(`w2 session: open ${JSON.stringify(vOpen)}, typed ${JSON.stringify(vTyped)}, sel ${JSON.stringify(vSel)}, menu ${JSON.stringify(vMenu)}, copy ${JSON.stringify(vCopy)}, paste ${JSON.stringify(vPaste)}; w2-back equals shell ${backEq}`);
  w2 = { ok: okW2, keys: { open: WR_OPEN, typed: W2_TYPED, sel: W2_SEL, menu: W2_MENU, copy: W2_COPY, move: W2_MOVE, paste: W2_PASTE, close: CLOSEKEYS, enter: [ENTER] },
    vars: { open: vOpen, typed: vTyped, sel: vSel, menu: vMenu, copy: vCopy, paste: vPaste }, kprog: { open: open.K_PROG, typed: typed.K_PROG, sel: sel.K_PROG, menu: menu.K_PROG, copy: copy.K_PROG, paste: paste.K_PROG, dialog: dlg.K_PROG, back: back.K_PROG }, backEqShell: backEq };
} else console.log('w2 session: skipped (the build has no Write W2 symbols)');
// 8. the W3 session (WRITE 13.7 item 5): no bridge, so "Save..." ends in the alert and nothing else changes
let w3 = null;
if (['WR_NAME', 'WR_SDLG', 'WR_ADLG', 'WR_DK', 'WR_TITLE', 'WR_GB', 'WR_BUF', 'FS_OPEN'].every((n) => S[n] !== undefined)) {
  const MENUK = keymap.get(16) ?? [CS, [4, 1]];
  const W3_TYPED = typeText('abc');
  const W3_SAVE = [['MENU', MENUK], ['DOWN', DOWN], ['DOWN', DOWN], ['ENTER', [ENTER]]];
  const W3_NAME = [...Array(8).fill(['DELETE', DELETE]), ...typeText('t1')];
  const W3_GO = [['ENTER', [ENTER]]];
  const hex = (a, n) => Buffer.from(m.ram.subarray(a, a + n)).toString('hex');
  const vars3 = () => {
    const gs = rd16(m, S.WR_GS), ge = rd16(m, S.WR_GE), buf = rd16(m, S.WR_BUF), gb = rd16(m, S.WR_GB);
    return { ...wrvars(), DOC: hex(buf, gs) + '|' + hex(gb, 0x1400 - ge), NAME: hex(S.WR_NAME, 1 + Math.min(m.ram[S.WR_NAME], 30)), TITLE: hex(S.WR_TITLE, 1 + Math.min(m.ram[S.WR_TITLE], 41)),
      WR_DK: m.ram[S.WR_DK], SDLG_MADE: rd16(m, S.WR_SDLG) !== 0, ADLG_MADE: rd16(m, S.WR_ADLG) !== 0 };
  };
  const hostNone = m.host === null || m.host === undefined;
  pressSeq(WR_OPEN.slice(0, 2));
  press(WR_OPEN[2][1]);
  const up = untilProg(3);
  run(30);
  const open = dump('w3-open', settle(300)); const vOpen = vars3();
  pressSeq(W3_TYPED); const typed = dump('w3-typed', settle(120)); const vTyped = vars3();
  pressSeq(W3_SAVE); const dlg = dump('w3-dialog', settle(120)); const vDlg = vars3();
  pressSeq(W3_NAME); const name = dump('w3-name', settle(120)); const vName = vars3();
  pressSeq(W3_GO); const alert = dump('w3-alert', settle(120)); const vAlert = vars3();
  pressSeq(W3_GO); const after = dump('w3-after', settle(120)); const vAfter = vars3();
  press(CLOSEKEYS); const discSettled = (run(30), settle(300)); const disc = dump('w3-discard', discSettled); const vDisc = vars3();
  press([ENTER]); const backUp = untilProg(0); run(30); const backSettled = settle(300); const back = dump('w3-back', backSettled);
  const backEq = same(rd_('w3-back'), rd_('shell'));
  const afterEqTyped = same(rd_('w3-after'), rd_('w3-typed'));
  const names = ['w3-open', 'w3-typed', 'w3-dialog', 'w3-name', 'w3-alert'];
  const distinct = names.every((n, i) => i === 0 || !same(rd_(n), rd_(names[i - 1])));
  const textHex = Buffer.from('abc').toString('hex');
  const nameU = Buffer.from('\x08Untitled', 'latin1').toString('hex');
  const okW3 = hostNone && up && [open, typed, dlg, name, alert, after, disc].every((x) => x.K_PROG === 3) && backUp && backSettled && back.K_PROG === 0 && backEq && distinct && afterEqTyped &&
    vTyped.DOC === `${textHex}|` + '' && vTyped.NAME === nameU && vTyped.WR_CHG === 1 && vDlg.WR_DK === 1 && vDlg.SDLG_MADE && vAlert.WR_DK === 2 && vAlert.ADLG_MADE && vAlert.NAME === nameU &&
    vAfter.WR_DK === 0 && vAfter.DOC === vTyped.DOC && vAfter.NAME === nameU && vAfter.WR_CHG === 1 && vDisc.WR_CHG === 1;
  console.log(`w3 session (m.host unset: ${hostNone}): typed ${JSON.stringify(vTyped)}, alert ${JSON.stringify(vAlert)}, after ${JSON.stringify(vAfter)}; w3-after equals w3-typed ${afterEqTyped}; w3-back equals shell ${backEq}`);
  w3 = { ok: okW3, keys: { open: WR_OPEN, typed: W3_TYPED, save: W3_SAVE, name: W3_NAME, go: W3_GO, close: CLOSEKEYS, enter: [ENTER] },
    vars: { open: vOpen, typed: vTyped, dialog: vDlg, name: vName, alert: vAlert, after: vAfter, discard: vDisc },
    kprog: { open: open.K_PROG, typed: typed.K_PROG, dialog: dlg.K_PROG, name: name.K_PROG, alert: alert.K_PROG, after: after.K_PROG, discard: disc.K_PROG, back: back.K_PROG }, backEqShell: backEq, afterEqTyped };
} else console.log('w3 session: skipped (the build has no Write W3 symbols)');
const ctlKeys = { tabIcon: CTL[0][1], enter: CTL[1][1], list: LISTSEQ, field: FIELDSEQ, status: STATUSSEQ, close: CLOSEKEYS };

writeFileSync(join(outDir, 'keys.json'), JSON.stringify({ seq: SEQ.map((s) => s[0]), afterKey, expect: EXPECT, kprog, ctl: ctlKeys, ctlKprog: { ctl: ctl.K_PROG, list: list.K_PROG, field: field.K_PROG, status: status.K_PROG, back2: back2.K_PROG }, back2EqShell,
  wr: { open: WR_OPEN, typed: WR_TYPED, edit: WR_EDIT, close: CLOSEKEYS, enter: [ENTER], text: WR_PARA, vars: { open: wrOpenV, typed: wrTypedV, edit: wrEditV }, kprog: { open: wrOpen.K_PROG, typed: wrTyped.K_PROG, edit: wrEdit.K_PROG, dialog: wrDlg.K_PROG, back: wrBack.K_PROG }, backEqShell: wrBackEqShell }, w2, w3 }) + '\n');
console.log('display after each key: ' + afterKey.map(([k, s]) => `${k}:"${s}"`).join(' '));
const backEqShell = same(rd_('back'), rd_('shell'));
console.log(`back screen equals shell screen byte for byte: ${backEqShell}`);
const ok = shellUp && shellSettled && shell.K_PROG === 0 && calcUp && calcSettled && calc.K_PROG === 1 && calc.display === '0' &&
  typedSettled && typed.K_PROG === 1 && typed.display === EXPECT && backUp && backSettled && back.K_PROG === 0 && backEqShell && mismatch === 0 &&
  !same(rd_('shell'), rd_('calc')) && !same(rd_('calc'), rd_('typed')) &&
  ctlUp && ctlSettled && ctl.K_PROG === 2 && listSettled && list.K_PROG === 2 && fieldSettled && field.K_PROG === 2 && statusSettled && status.K_PROG === 2 &&
  back2Up && back2Settled && back2.K_PROG === 0 &&
  ['ctl', 'list', 'field', 'status'].every((n, i, a) => i === 0 || !same(rd_(n), rd_(a[i - 1]))) && wrOk && (w2 === null || w2.ok) && (w3 === null || w3.ok);
console.log(`controls session: ctl/list/field/status K_PROG ${ctl.K_PROG}/${list.K_PROG}/${field.K_PROG}/${status.K_PROG}, back2 K_PROG ${back2.K_PROG}, back2 equals shell ${back2EqShell}`);
console.log(`${ok ? 'PASS' : 'FAIL'}: desk5 reference: shell up after ${framesToShell} frames (settled ${shellSettled}), calc "${calc.display}" K_PROG ${calc.K_PROG}, typed "${typed.display}" (expected "${EXPECT}") K_PROG ${typed.K_PROG}, ` +
  `back K_PROG ${back.K_PROG} = shell ${backEqShell}, rendered-vs-RAM mismatches ${mismatch}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
