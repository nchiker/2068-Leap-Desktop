"use strict";
// desk5-ref.mjs -- the TSRun reference for the cross-emulator runs of desk5 (docs/SHELL.md 8 test 5).
//   node tools/xemu/desk5-ref.mjs [OUTDIR]        (default build/xemu/desk5-ref)
// Does NOT build: boots the existing build/desk5.dck (symbols from build/desk5/out.sym).  No mouse is attached (the Kempston ports read $FF).
// The cartridge boots into the shell (K_PROG 0: "Leap Desktop" window, icons Calculator, Key Caps and Notepad, Calculator focused).  Steps:
//   1. boot (K_PROG poisoned with $FF after reset, RAM being random) until K_PROG = 0, then 30 frames more, then until the display RAM is unchanged over 20 frames (checked every 20): "shell"
//   2. ENTER (opens the focused icon); until K_PROG = 1, 30 frames more, settled: "calc" (C_DSTR = "0")
//   3. 1 2 3 . 4 5 SS+B 6 ENTER through the keyboard matrix (m.keyMatrix, active low, index = half-row in the order $FE $FD $FB $F7 $EF $DF
//      $BF $7F, bit 0-4), each key (or chord) held 3 frames, released 3 frames ('.' = SS+M; 123.45 * 6 = 740.7); settled: "typed"
//   4. SYMBOL SHIFT + Q (CLOSE, held 3 frames); until K_PROG = 0, 30 frames more, settled: "back", which must equal "shell" byte for byte.
//   5. (docs/KEYCAPS.md) the Key Caps session: TAB (CAPS SHIFT + 1) focuses the Key Caps icon, ENTER opens it: "kc" (K_PROG 2; status "Press a key.", the Plain radio checked);
//      Q: "kc-q" (the status reads "Last key: q (code 113)", Q drawn pressed only while held, so the settled screen has no pressed cap); SYMBOL SHIFT + P ('"'): "kc-ss" (status "Last key: " (code 34));
//      TAB (the Caps Shift radio takes the focus), SPACE (it is checked: the keyboard shows plane 1, the status reads "Last key: Space (code 32)"): "kc-radio";
//      SYMBOL SHIFT + Q: "back2" (K_PROG 0; whether it equals "shell" is reported, not required).
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
//   10. (docs/PAINT.md 15; only when the build has the Paint symbols PN_PIC, PN_TOOL, PN_DIRTY, PN_UNDO, PN_UB0, PN_NAME, PN_TITLE, PN_LBL) the Paint session.  No mouse is attached (the Kempston ports read $FF, as in the
//      other sessions and on ZEsarUX, which has no ZRCP command for its Kempston mouse), so the POINTER IS DRIVEN BY THE KEYBOARD: keyboard-pointer mode (CAPS SHIFT + SYMBOL SHIFT toggles it; Q / A / O / P move the
//      pointer, SPACE is the button; OBJECTS_EVENTS 14.3).  Every key set is held for an exact number of frames (a step [label, keys, n]: the keys down exactly as listed, n frames), so the pointer's acceleration
//      and the strokes are the same on any emulator that polls the keys once a frame.  From the shell: TAB x3 (CS + 1; the fourth icon), ENTER (K_PROG 4, the pointer at (256, 96), inside the picture, the Pencil
//      chosen): "pt-open"; kp mode on, O 14 frames, SPACE 2, then four 8-frame segments with SPACE + P + A / Q alternating (a pencil zig-zag), SPACE released: "pt-pencil" (PN_DIRTY 1, Undo enabled); O 40 frames,
//      Q 12 frames (the pointer on the Eraser's cell), SPACE tapped 3 frames: "pt-eraser" (PN_TOOL 3, the status reads "Eraser"); P + A 20 frames (back into the picture), SPACE down, two 8-frame segments with
//      SPACE + P + A / Q (the eraser across the first segments), released: "pt-erase" (the copy has changed, Undo box = the stroke's); kp mode off, MENU (CS + 9), DOWN x2, ENTER (File > Save...): "pt-sdlg" (the name dialog,
//      "Untitled"); ENTER (Save: no host attached, so the alert "Cannot save the picture."): "pt-alert"; ENTER (OK): "pt-after" (the picture and PN_DIRTY unchanged; no file reached any host: m.host is unset);
//      MENU, RIGHT, ENTER (Edit > Undo): "pt-undo" (the copy equals "pt-eraser"'s again); SYMBOL SHIFT + Q (the picture is dirty: the discard question): "pt-discard"; ENTER (Discard): "pt-back" (K_PROG 0; NOT equal to
//      "shell": the pointer has moved).  Extra files per checkpoint: NAME.pic (Paint's picture copy PN_PIC: 4 header + 5,760 bytes; the address is read from the variable PN_PIC) and NAME.und (the undo area from $5800,
//      the box's nc x nr bytes when PN_UNDO is 1, else empty); extra data: the pointer (K_PX, K_PY, K_BTN, K_KPMODE), PN_TOOL, PN_DIRTY, PN_UNDO, the box, the File / Edit enable words, PN_NAME, PN_TITLE (hex),
//      the status line text, whether a dialog is modal.
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
const KSPACE = [7, 0], KQQ = [2, 0];
const KC_OPEN = [['TAB', TAB], ['ENTER', [ENTER]]];
const KC_Q = [['q', [KQQ]]];
const KC_SS = [['SS+P', SSP]];
const KC_RADIO = [['TAB', TAB], ['SPACE', [KSPACE]]];

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

// 5. the Key Caps session
const pressSeq = (seq) => { for (const [, keys] of seq) press(keys); };
pressSeq(KC_OPEN.slice(0, 1));              // TAB: the focus to the Key Caps icon
press(KC_OPEN[1][1]);                        // ENTER: opens it
const kcUp = untilProg(2);
run(30);
const kcSettled = settle(300);
const kc = dump('kc', kcSettled);
pressSeq(KC_Q);
const kcqSettled = settle(60);
const kcq = dump('kc-q', kcqSettled);
pressSeq(KC_SS);
const kcssSettled = settle(60);
const kcss = dump('kc-ss', kcssSettled);
pressSeq(KC_RADIO);
const kcrSettled = settle(60);
const kcr = dump('kc-radio', kcrSettled);
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
    vOpen.WR_CLN === 0 && vOpen.EDIT_EN === 0x0A /* Select all and Find... (8 items, bit 7 - k: WRITE 14.3) */ && vSel.WR_MK === 1 && vSel.WR_AN !== vSel.WR_GS && vCopy.WR_CLN > 0 && vCopy.WR_MK === 0 && vPaste.WR_CLN === vCopy.WR_CLN && vPaste.WR_AN === vPaste.WR_GS && vPaste.WR_CHG === 1;
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
// 9. the W4 session (WRITE 14.7 item 7; only when the build has the W4 symbols WR_FN, WR_FCODES, WR_LCK): Find... and Find again by the Edit menu's keys, from the shell: TAB x2, ENTER (K_PROG 3): "w4-open";
//    three lines typed ("one two three" / "four two six" / "three", the caret at the end): "w4-typed"; MENU, RIGHT, DOWN x1 (the first enabled item after Select all... is Find...), ENTER: "w4-fdlg" (the Find dialog, F empty);
//    "two", ENTER: "w4-found" (no match after the caret, so the search wraps to the first "two"); Find again (the Edit menu's DOWN steps are counted over the enabled items, read from the enable word): "w4-again" (the second "two");
//    Find again: "w4-again2" (wraps to the first); Find... with F = "two" shown: "w4-fdlg2"; DELETE x3, "zzz", ENTER: "w4-notfound" (the alert "Not found."); ENTER (OK): "w4-after" (as "w4-again2" on the screen);
//    SYMBOL SHIFT + Q: "w4-discard" (the discard dialog); ENTER (Discard): "w4-back" (= "shell").  Extra data per checkpoint: the W2 variables, WR_FN, F's codes (hex), WR_LCK, WR_DK and the document's codes.
let w4 = null;
if (['WR_FN', 'WR_FCODES', 'WR_LCK', 'WR_DK', 'WR_AN', 'WR_MK', 'WR_CLN', 'WR_BUF', 'WR_GB', 'MB_ENT', 'ME_SIZE', 'ME_EN'].every((n) => S[n] !== undefined)) {
  const MENUK = keymap.get(16) ?? [CS, [4, 1]], RIGHTK = keymap.get(9) ?? [CS, [4, 2]];
  const ITEM_IDX = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 6, 6: 7 };
  const hex = (a, n) => Buffer.from(m.ram.subarray(a, a + n)).toString('hex');
  const editEn = () => rd16(m, S.MB_ENT + S.ME_SIZE + S.ME_EN);
  // MENU, RIGHT (Edit), DOWN over the enabled items up to `item` (ids 1 Cut .. 4 Select all, 5 Find..., 6 Find again), ENTER; steps counted from the live enable word
  const editSeq = (item) => {
    const en = editEn(), order = [1, 2, 3, 4, 5, 6].filter((i) => (en >> (7 - ITEM_IDX[i])) & 1), steps = order.indexOf(item);
    if (steps < 0) throw new Error(`w4: Edit item ${item} is disabled (enable word ${en.toString(16)})`);
    return [['MENU', MENUK], ['RIGHT', RIGHTK], ...Array(steps).fill(['DOWN', DOWN]), ['ENTER', [ENTER]]];
  };
  const vars4 = () => {
    const gs = rd16(m, S.WR_GS), ge = rd16(m, S.WR_GE), buf = rd16(m, S.WR_BUF), gb = rd16(m, S.WR_GB), fn = m.ram[S.WR_FN];
    return { ...wrvars(), WR_AN: rd16(m, S.WR_AN), WR_MK: m.ram[S.WR_MK], WR_CLN: rd16(m, S.WR_CLN), EDIT_EN: editEn(), WR_FN: fn, FCODES: hex(S.WR_FCODES, Math.min(fn, 30)),
      WR_LCK: rd16(m, S.WR_LCK), WR_DK: m.ram[S.WR_DK], DOC: hex(buf, gs) + '|' + hex(gb, 0x1400 - ge) };
  };
  const W4_TYPED = typeText('one two three\nfour two six\nthree');
  const W4_TWO = typeText('two');
  const W4_ZZZ = [...Array(3).fill(['DELETE', DELETE]), ...typeText('zzz')];
  const W4_GO = [['ENTER', [ENTER]]];
  const k4 = {};
  pressSeq(WR_OPEN.slice(0, 2));
  press(WR_OPEN[2][1]);
  const up = untilProg(3);
  run(30);
  const open = dump('w4-open', settle(300)); const vOpen = vars4();
  pressSeq(W4_TYPED); const typed = dump('w4-typed', settle(120)); const vTyped = vars4();
  k4.find1 = editSeq(5); pressSeq(k4.find1); const fdlg = dump('w4-fdlg', settle(120)); const vFdlg = vars4();
  pressSeq(W4_TWO); pressSeq(W4_GO); const found = dump('w4-found', settle(120)); const vFound = vars4();
  k4.again1 = editSeq(6); pressSeq(k4.again1); const again = dump('w4-again', settle(120)); const vAgain = vars4();
  k4.again2 = editSeq(6); pressSeq(k4.again2); const again2 = dump('w4-again2', settle(120)); const vAgain2 = vars4();
  k4.find2 = editSeq(5); pressSeq(k4.find2); const fdlg2 = dump('w4-fdlg2', settle(120)); const vFdlg2 = vars4();
  pressSeq(W4_ZZZ); pressSeq(W4_GO); const notfound = dump('w4-notfound', settle(120)); const vNotfound = vars4();
  pressSeq(W4_GO); const after = dump('w4-after', settle(120)); const vAfter = vars4();
  press(CLOSEKEYS); const discSettled = (run(30), settle(300)); const disc = dump('w4-discard', discSettled); const vDisc = vars4();
  press([ENTER]); const backUp = untilProg(0); run(30); const backSettled = settle(300); const back = dump('w4-back', backSettled);
  const backEq = same(rd_('w4-back'), rd_('shell'));
  const afterEqAgain2 = same(rd_('w4-after'), rd_('w4-again2'));
  const names = ['w4-open', 'w4-typed', 'w4-fdlg', 'w4-found', 'w4-again', 'w4-again2', 'w4-fdlg2', 'w4-notfound'];
  const distinct = names.every((n, i) => i === 0 || !same(rd_(n), rd_(names[i - 1])));
  const two = Buffer.from('two').toString('hex');
  const okW4 = up && [open, typed, fdlg, found, again, again2, fdlg2, notfound, after, disc].every((x) => x.K_PROG === 3) && backUp && backSettled && back.K_PROG === 0 && backEq && distinct &&
    vOpen.EDIT_EN === 0x0A && vFdlg.WR_DK === 3 && vFound.WR_FN === 3 && vFound.FCODES === two && vFound.WR_AN === 4 && vFound.WR_GS === 7 && vAgain.WR_AN === 19 && vAgain.WR_GS === 22 &&
    vAgain2.WR_AN === 4 && vNotfound.WR_DK === 2 && vNotfound.FCODES === 'zzz'.split('').map((ch) => ch.charCodeAt(0).toString(16)).join('') && vAfter.WR_DK === 0 && afterEqAgain2 && vAfter.DOC === vAgain2.DOC && vAfter.WR_AN === vAgain2.WR_AN;
  console.log(`w4 session: typed ${JSON.stringify(vTyped)}, found ${JSON.stringify(vFound)}, again ${JSON.stringify(vAgain)}, again2 ${JSON.stringify(vAgain2)}, notfound ${JSON.stringify(vNotfound)}, after ${JSON.stringify(vAfter)}; w4-after equals w4-again2 ${afterEqAgain2}; w4-back equals shell ${backEq}`);
  w4 = { ok: okW4, keys: { open: WR_OPEN, typed: W4_TYPED, find1: k4.find1, two: W4_TWO, go: W4_GO, again1: k4.again1, again2: k4.again2, find2: k4.find2, zzz: W4_ZZZ, close: CLOSEKEYS, enter: [ENTER] },
    vars: { open: vOpen, typed: vTyped, fdlg: vFdlg, found: vFound, again: vAgain, again2: vAgain2, fdlg2: vFdlg2, notfound: vNotfound, after: vAfter, discard: vDisc },
    kprog: { open: open.K_PROG, typed: typed.K_PROG, fdlg: fdlg.K_PROG, found: found.K_PROG, again: again.K_PROG, again2: again2.K_PROG, fdlg2: fdlg2.K_PROG, notfound: notfound.K_PROG, after: after.K_PROG, discard: disc.K_PROG, back: back.K_PROG },
    backEqShell: backEq, afterEqAgain2 };
} else console.log('w4 session: skipped (the build has no Write W4 symbols)');
// 10. the Paint session (docs/PAINT.md 15): the pointer by keyboard-pointer mode, every key set held for an exact number of frames (see the header)
let pt = null;
if (['PN_PIC', 'PN_TOOL', 'PN_DIRTY', 'PN_UNDO', 'PN_UB0', 'PN_UBN', 'PN_UR0', 'PN_URN', 'PN_NAME', 'PN_TITLE', 'PN_LBL', 'Label_text', 'W_MODAL', 'MB_ENT', 'ME_SIZE', 'ME_EN', 'K_KPMODE', 'K_BTN'].every((n) => S[n] !== undefined)) {
  const MENUK = keymap.get(16) ?? [CS, [4, 1]], RIGHTK = keymap.get(9) ?? [CS, [4, 2]];
  const KA = [1, 0], KO = [5, 1];
  const chord = (label, keys) => [[label, keys, 3], ['', [], 3]];             // a key (chord) held 3 frames, released 3 frames, as `press`
  const T_OPEN = [...chord('TAB', TAB), ...chord('TAB', TAB), ...chord('TAB', TAB)];
  const T_ENTER = chord('ENTER', [ENTER]);
  const T_PENCIL = [...chord('kp on (CS+SS)', [CS, SS]), ['left', [KO], 14], ['', [], 2], ['press', [KSPACE], 2],
    ['zig0', [KSPACE, KP, KA], 8], ['zig1', [KSPACE, KP, KQQ], 8], ['zig2', [KSPACE, KP, KA], 8], ['zig3', [KSPACE, KP, KQQ], 8], ['release', [], 3]];
  const T_ERASER = [['to the Eraser x', [KO], 40], ['', [], 2], ['to the Eraser y', [KQQ], 12], ['', [], 2], ['tap', [KSPACE], 3], ['', [], 4]];
  const T_ERASE = [['into the picture', [KP, KA], 20], ['', [], 2], ['press', [KSPACE], 2], ['erase0', [KSPACE, KP, KA], 8], ['erase1', [KSPACE, KP, KQQ], 8], ['release', [], 4]];
  const T_SAVE = [...chord('kp off (CS+SS)', [CS, SS]), ...chord('MENU', MENUK), ...chord('DOWN', DOWN), ...chord('DOWN', DOWN), ...chord('ENTER', [ENTER])];
  const T_UNDO = [...chord('MENU', MENUK), ...chord('RIGHT', RIGHTK), ...chord('ENTER', [ENTER])];
  const T_CLOSE = chord('SS+Q', CLOSEKEYS);
  const kdown = [];                                                            // the keys held now, as 'r,b' strings
  const playSteps = (steps) => {
    for (const [, keys, n] of steps) {
      const want = new Set(keys.map((k) => k.join()));
      for (const h of [...kdown]) if (!want.has(h)) { const [r, b] = h.split(',').map(Number); m.keyMatrix[r] |= 1 << b; kdown.splice(kdown.indexOf(h), 1); }
      for (const [r, b] of keys) { m.keyMatrix[r] &= ~(1 << b); if (!kdown.includes(`${r},${b}`)) kdown.push(`${r},${b}`); }
      run(n);
      if (process.env.PT_TRACE) console.log(`    step ${JSON.stringify(keys)} x${n}: pointer (${rd16(m, S.K_PX)}, ${m.ram[S.K_PY]}) btn ${m.ram[S.K_BTN]} kp ${m.ram[S.K_KPMODE]}`);
    }
  };
  const hex = (a, n) => Buffer.from(m.ram.subarray(a, a + n)).toString('hex');
  const str = (a) => (a ? String.fromCharCode(...m.ram.subarray(a + 1, a + 1 + Math.min(m.ram[a], 40))) : '');
  const menuWord = (i) => rd16(m, S.MB_ENT + S.ME_SIZE * i + S.ME_EN);
  const ptvars = () => ({ K_PX: rd16(m, S.K_PX), K_PY: m.ram[S.K_PY], K_BTN: m.ram[S.K_BTN], K_KPMODE: m.ram[S.K_KPMODE], PN_TOOL: m.ram[S.PN_TOOL], PN_DIRTY: m.ram[S.PN_DIRTY], PN_UNDO: m.ram[S.PN_UNDO],
    BOX: [m.ram[S.PN_UB0], m.ram[S.PN_UBN], m.ram[S.PN_UR0], m.ram[S.PN_URN]], FILE_EN: menuWord(0) & 0x1F, EDIT_EN: menuWord(1) & 3, NAME: hex(S.PN_NAME, 1 + Math.min(m.ram[S.PN_NAME], 30)),
    TITLE: hex(S.PN_TITLE, 1 + Math.min(m.ram[S.PN_TITLE], 41)), STATUS: str(rd16(m, rd16(m, S.PN_LBL) + S.Label_text)), MODAL: rd16(m, S.W_MODAL) !== 0, PIC: rd16(m, S.PN_PIC) });
  const picOf = () => { const a = rd16(m, S.PN_PIC); return Buffer.from(m.ram.subarray(a, a + 4 + 5760)); };
  const undoOf = () => (m.ram[S.PN_UNDO] ? Buffer.from(m.ram.subarray(0x5800, 0x5800 + Math.min(m.ram[S.PN_UBN] * m.ram[S.PN_URN], 2048))) : Buffer.alloc(0));
  const ptDump = (name, extra, maxSettle = 120) => {
    const settled = settle(maxSettle);
    const d = dump(name, settled);
    const v = ptvars();
    const pic = picOf(), und = undoOf();
    writeFileSync(join(outDir, `${name}.pic`), pic);
    writeFileSync(join(outDir, `${name}.und`), und);
    console.log(`  ${name}: pointer (${v.K_PX}, ${v.K_PY}) button ${v.K_BTN} kp ${v.K_KPMODE}; tool ${v.PN_TOOL}, dirty ${v.PN_DIRTY}, undo ${v.PN_UNDO} box ${v.BOX}, status "${v.STATUS}", modal ${v.MODAL}; copy ${pic.length} bytes, undo area ${und.length} bytes`);
    return { ...d, v, pic, und, settled, ...extra };
  };
  const hostNone = m.host === null || m.host === undefined;
  const steps = { open: [...T_OPEN, ...T_ENTER], pencil: T_PENCIL, eraser: T_ERASER, erase: T_ERASE, save: T_SAVE, undo: T_UNDO, close: T_CLOSE };
  playSteps(T_OPEN); playSteps(T_ENTER);
  const up = untilProg(4);
  run(30);
  const open = ptDump('pt-open', {}, 300);
  playSteps(T_PENCIL); const pencil = ptDump('pt-pencil');
  playSteps(T_ERASER); const eraser = ptDump('pt-eraser');
  playSteps(T_ERASE); const erase = ptDump('pt-erase');
  playSteps(T_SAVE); const sdlg = ptDump('pt-sdlg');
  playSteps(chord('ENTER', [ENTER])); const alert = ptDump('pt-alert');
  playSteps(chord('ENTER', [ENTER])); const after = ptDump('pt-after');
  playSteps(T_UNDO); const undo = ptDump('pt-undo');
  playSteps(T_CLOSE); const discard = ptDump('pt-discard', {}, 300);
  playSteps(chord('ENTER', [ENTER])); const backUp = untilProg(0); run(30); const back = ptDump('pt-back', {}, 300);
  const backEqShell = same(rd_('pt-back'), rd_('shell'));
  const all = [open, pencil, eraser, erase, sdlg, alert, after, undo, discard];
  const names = ['pt-open', 'pt-pencil', 'pt-eraser', 'pt-erase', 'pt-sdlg', 'pt-alert', 'pt-after', 'pt-undo', 'pt-discard'];
  const distinct = names.every((n, i) => i === 0 || !same(rd_(n), rd_(names[i - 1])));
  const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++; return a.length === b.length ? n : -1; };
  const nameU = Buffer.from('\x08Untitled', 'latin1').toString('hex');
  const copyChanged = { pencil: diff(pencil.pic, open.pic), erase: diff(erase.pic, eraser.pic), undo: diff(undo.pic, erase.pic), undoVsEraser: diff(undo.pic, eraser.pic), afterVsErase: diff(after.pic, erase.pic) };
  const okPt = hostNone && up && backUp && back.settled && all.every((x) => x.settled && x.K_PROG === 4) && back.K_PROG === 0 && distinct &&
    open.v.PN_TOOL === 1 && open.v.PN_DIRTY === 0 && open.v.PN_UNDO === 0 && open.v.K_KPMODE === 0 && open.v.K_PX === 256 && open.v.K_PY === 96 && open.v.NAME === nameU &&
    pencil.v.K_KPMODE === 1 && pencil.v.PN_DIRTY === 1 && pencil.v.K_BTN === 0 && copyChanged.pencil > 0 &&
    eraser.v.PN_TOOL === 3 && diff(eraser.pic, pencil.pic) === 0 &&
    erase.v.PN_UNDO === 1 && copyChanged.erase > 0 && erase.und.length > 0 &&
    sdlg.v.K_KPMODE === 0 && sdlg.v.MODAL && sdlg.v.NAME === nameU && alert.v.MODAL && !after.v.MODAL && after.v.PN_DIRTY === 1 && after.v.NAME === nameU && copyChanged.afterVsErase === 0 &&
    copyChanged.undoVsEraser === 0 && copyChanged.undo > 0 && undo.v.PN_UNDO === 1 && discard.v.MODAL;
  console.log(`paint session (m.host unset: ${hostNone}): kp mode and pointer after the pencil ${pencil.v.K_KPMODE}/(${pencil.v.K_PX}, ${pencil.v.K_PY}); copy bytes changed: pencil ${copyChanged.pencil}, eraser stroke ${copyChanged.erase}, ` +
    `Undo vs "pt-erase" ${copyChanged.undo}, Undo vs "pt-eraser" ${copyChanged.undoVsEraser}, "pt-after" vs "pt-erase" ${copyChanged.afterVsErase}; pt-back equals shell ${backEqShell} (the pointer has moved, so it is not required)`);
  pt = { ok: okPt, steps, vars: Object.fromEntries(['open', 'pencil', 'eraser', 'erase', 'sdlg', 'alert', 'after', 'undo', 'discard', 'back'].map((k, i) => [k, [open, pencil, eraser, erase, sdlg, alert, after, undo, discard, back][i].v])),
    kprog: Object.fromEntries(['open', 'pencil', 'eraser', 'erase', 'sdlg', 'alert', 'after', 'undo', 'discard', 'back'].map((k, i) => [k, [open, pencil, eraser, erase, sdlg, alert, after, undo, discard, back][i].K_PROG])),
    copyChanged, backEqShell };
} else console.log('paint session: skipped (the build has no Paint symbols)');
const kcKeys = { tabIcon: KC_OPEN[0][1], enter: KC_OPEN[1][1], q: KC_Q, ss: KC_SS, radio: KC_RADIO, close: CLOSEKEYS };

writeFileSync(join(outDir, 'keys.json'), JSON.stringify({ seq: SEQ.map((s) => s[0]), afterKey, expect: EXPECT, kprog, kc: kcKeys, kcKprog: { kc: kc.K_PROG, q: kcq.K_PROG, ss: kcss.K_PROG, radio: kcr.K_PROG, back2: back2.K_PROG }, back2EqShell,
  wr: { open: WR_OPEN, typed: WR_TYPED, edit: WR_EDIT, close: CLOSEKEYS, enter: [ENTER], text: WR_PARA, vars: { open: wrOpenV, typed: wrTypedV, edit: wrEditV }, kprog: { open: wrOpen.K_PROG, typed: wrTyped.K_PROG, edit: wrEdit.K_PROG, dialog: wrDlg.K_PROG, back: wrBack.K_PROG }, backEqShell: wrBackEqShell }, w2, w3, w4, pt }) + '\n');
console.log('display after each key: ' + afterKey.map(([k, s]) => `${k}:"${s}"`).join(' '));
const backEqShell = same(rd_('back'), rd_('shell'));
console.log(`back screen equals shell screen byte for byte: ${backEqShell}`);
const ok = shellUp && shellSettled && shell.K_PROG === 0 && calcUp && calcSettled && calc.K_PROG === 1 && calc.display === '0' &&
  typedSettled && typed.K_PROG === 1 && typed.display === EXPECT && backUp && backSettled && back.K_PROG === 0 && backEqShell && mismatch === 0 &&
  !same(rd_('shell'), rd_('calc')) && !same(rd_('calc'), rd_('typed')) &&
  kcUp && kcSettled && kc.K_PROG === 2 && kcqSettled && kcq.K_PROG === 2 && kcssSettled && kcss.K_PROG === 2 && kcrSettled && kcr.K_PROG === 2 &&
  back2Up && back2Settled && back2.K_PROG === 0 &&
  ['kc', 'kc-q', 'kc-ss', 'kc-radio'].every((n, i, a) => i === 0 || !same(rd_(n), rd_(a[i - 1]))) && wrOk && (w2 === null || w2.ok) && (w3 === null || w3.ok) && (w4 === null || w4.ok) && (pt === null || pt.ok);
console.log(`key caps session: kc/kc-q/kc-ss/kc-radio K_PROG ${kc.K_PROG}/${kcq.K_PROG}/${kcss.K_PROG}/${kcr.K_PROG}, back2 K_PROG ${back2.K_PROG}, back2 equals shell ${back2EqShell}`);
console.log(`${ok ? 'PASS' : 'FAIL'}: desk5 reference: shell up after ${framesToShell} frames (settled ${shellSettled}), calc "${calc.display}" K_PROG ${calc.K_PROG}, typed "${typed.display}" (expected "${EXPECT}") K_PROG ${typed.K_PROG}, ` +
  `back K_PROG ${back.K_PROG} = shell ${backEqShell}, rendered-vs-RAM mismatches ${mismatch}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
