"use strict";
// kern4-ref.mjs -- the TSRun reference for the cross-emulator runs of kern4demo (docs/WINDOWS.md 18.6, the amendment of 11 and 10's test 10).
//   node tools/xemu/kern4-ref.mjs [OUTDIR]        (default build/xemu/kern4-ref; builds kern4demo itself)
// Boots build/kern4demo.dck on TSRun, runs frames until the screen is settled (at least 30 frames, then unchanged over 20 frames), then
// plays the fixed key script, each key held 2 frames and released, 10 frames after it (then waiting, 60 frames at most, until the
// screen is stable over 20 frames).  The checkpoints:
//   boot  settled after boot
//   s1    MENU, LEFT, ENTER                (LEFT wraps "Leap" to "Window", item "Text": the Text window to the front; s1 must differ from boot)
//   s2    MENU, ENTER                      (the About dialog opens)
//   s3    ENTER                            (the dialog closes)
// Keys (docs/OBJECTS_EVENTS.md 14.3, src/kernel/keymap.txt): MENU = CAPS SHIFT + 9, LEFT = CS + 5, ENTER = ENTER.
// No mouse is attached: the Kempston ports read $FF and nothing moves; the pointer sits at (500, 180) and is part of every screen.
// Writes, per checkpoint NAME: NAME.bin (display RAM: $4000-$57FF then $6000-$77FF, 12,288 bytes), NAME.pbm (the rendered 512x192
// frame, P4, 1 = ink), NAME.json (D_ABOUT, D_TEXT, D_BUTTONS, K_FOCUS, frame counts).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { boot, M, screenPixel, SCR_W, SCR_H } from '../../tests/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(ROOT, 'build/xemu/kern4-ref');
mkdirSync(outDir, { recursive: true });

// key = [row, bit] pairs of the matrix (index k = 5 r + b)
const CS = [0, 0], K9 = [4, 1], K5 = [3, 4], ENTER = [6, 0];
const KEYS = { MENU: [CS, K9], LEFT: [CS, K5], ENTER: [ENTER] };
const SCRIPT = [
  ['s1', ['MENU', 'LEFT', 'ENTER']],
  ['s2', ['MENU', 'ENTER']],
  ['s3', ['ENTER']],
];

const { dck, syms: S } = build('kern4demo');
const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
const rowOff = (y) => ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
const displayRam = (m) => {
  const out = new Uint8Array(12288);
  out.set(m.ram.subarray(0x4000, 0x5800), 0);
  out.set(m.ram.subarray(0x6000, 0x7800), 6144);
  return out;
};
const ramPixel = (d, x, y) => { const c = x >> 3; return (d[(c & 1) * 6144 + rowOff(y) + (c >> 1)] >> (7 - (x & 7))) & 1; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

const m = boot(dck);
let frames = 0;
const run = (n) => { for (let i = 0; i < n; i++) { M.runFrame(m); frames++; } };
/** run until the screen has been unchanged over 20 frames (checked every 20 frames), at most maxExtra frames; returns whether it settled */
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
/** also written after each key (10 frames after its release, not settled): NAME-kI.bin, I = 1..n; returns their hashes by name */
function press(name, keys) {
  keys.forEach((k, i) => {
    for (const [r, b] of KEYS[k]) m.keyMatrix[r] &= ~(1 << b);
    run(2);
    for (const [r, b] of KEYS[k]) m.keyMatrix[r] |= 1 << b;
    run(10);
    writeFileSync(join(outDir, `${name}-k${i + 1}.bin`), displayRam(m));
  });
}

let mismatch = 0;
const shots = {};
function dump(name) {
  const d = displayRam(m);
  const pbm = Buffer.alloc(SCR_W / 8 * SCR_H);
  let bad = 0;
  for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
    const ink = screenPixel(m, x, y) === 0 ? 1 : 0;
    if (ink !== ramPixel(d, x, y)) bad++;
    if (ink) pbm[y * (SCR_W / 8) + (x >> 3)] |= 0x80 >> (x & 7);
  }
  mismatch += bad;
  const vars = { frame: frames, K_FOCUS: rd16(m, S.K_FOCUS), D_TEXT: rd16(m, S.D_TEXT), D_BUTTONS: rd16(m, S.D_BUTTONS), D_ABOUT: rd16(m, S.D_ABOUT) };
  writeFileSync(join(outDir, `${name}.bin`), d);
  writeFileSync(join(outDir, `${name}.pbm`), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(vars) + '\n');
  const ink = [...pbm].reduce((a, b) => a + b.toString(2).replace(/0/g, '').length, 0);
  console.log(`${name}: frame ${frames}, K_FOCUS $${vars.K_FOCUS.toString(16)}, D_TEXT $${vars.D_TEXT.toString(16)}, D_BUTTONS $${vars.D_BUTTONS.toString(16)}, D_ABOUT $${vars.D_ABOUT.toString(16)}, ink pixels ${ink}, rendered vs RAM mismatches ${bad}`);
  shots[name] = { d, vars };
}

// boot: RAM is random at power-on and the boot takes about 120 frames: wait until the demo has built its windows (D_TEXT and D_BUTTONS
// are heap addresses, $C000-$DFFF, and differ), then 30 frames more, then until settled
const built = () => { const t = rd16(m, S.D_TEXT), b = rd16(m, S.D_BUTTONS); return t >= 0xC000 && t < 0xE000 && b >= 0xC000 && b < 0xE000 && t !== b; };
while (!built() && frames < 1000) run(1);
const framesToBuilt = frames;
run(30);
const settled = { boot: settle(200) };
dump('boot');
for (const [name, keys] of SCRIPT) {
  press(name, keys);
  settled[name] = settle(60);
  dump(name);
}
const names = ['boot', ...SCRIPT.map((s) => s[0])];
let ok = mismatch === 0;
const notes = [];
for (let i = 0; i < names.length; i++) {
  if (!settled[names[i]]) { ok = false; notes.push(`${names[i]} not settled`); }
  if (i > 0 && same(shots[names[i]].d, shots[names[i - 1]].d)) { ok = false; notes.push(`${names[i]} equals ${names[i - 1]}`); }
}
const k1 = new Uint8Array(readFileSync(join(outDir, 's1-k1.bin')));
const menuShown = !same(k1, shots.boot.d);
if (!menuShown) { ok = false; notes.push('the first MENU key did not change the screen'); }
const aboutOk = shots.s1.vars.D_ABOUT === 0 && shots.s2.vars.D_ABOUT !== 0 && shots.s3.vars.D_ABOUT === 0;
if (!aboutOk) { ok = false; notes.push('D_ABOUT not 0 / nonzero / 0 over s1 / s2 / s3'); }
console.log(`${ok ? 'PASS' : 'FAIL'}: kern4demo reference: windows built after ${framesToBuilt} frames, settled ${names.map((n) => `${n} ${settled[n]}`).join(', ')}, each screen differs from the one before (s1 from boot), MENU opens something ${menuShown}, ` +
  `About dialog open only after s2 ${aboutOk}, rendered-vs-RAM mismatches ${mismatch}${notes.length ? '; ' + notes.join('; ') : ''}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
