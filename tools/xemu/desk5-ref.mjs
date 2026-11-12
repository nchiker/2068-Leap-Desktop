"use strict";
// desk5-ref.mjs -- the TSRun reference for the cross-emulator runs of desk5 (docs/CALCULATOR.md 8 test 7).
//   node tools/xemu/desk5-ref.mjs [OUTDIR]        (default build/xemu/desk5-ref)
// Does NOT build: boots the existing build/desk5.dck (symbols from build/desk5/out.sym).  No mouse is attached (the Kempston ports read $FF).
// Boot: runs frames until the display string C_DSTR is "0" (length 1, '0'), then 30 frames more, then until the display RAM is unchanged
// over 20 frames (checked every 20 frames): checkpoint "boot".  Then the typed sequence through the keyboard matrix (m.keyMatrix, active low,
// index = half-row in the order $FE $FD $FB $F7 $EF $DF $BF $7F, bit 0-4), each key (or key chord) held 3 frames, released 3 frames:
//   1 2 3 . 4 5 SS+B (*) 6 ENTER      ('.' = SYMBOL SHIFT + M; 123.45 * 6 = 740.7)
// then settled again (60 frames at most): checkpoint "typed".  Also written: the display string after every key (keys.json).
// Per checkpoint NAME: NAME.bin (display RAM: $4000-$57FF then $6000-$77FF, 12,288 bytes), NAME.pbm (rendered 512x192, P4, 1 = ink),
// NAME.json (display string, V_FRAMES, K_PX, K_PY, frame counts).  The key list is also exported as keys.json for the other runners.
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
const SS = [7, 1], KM = [7, 2], KB = [7, 4], ENTER = [6, 0];
const SEQ = [
  ['1', [D1]], ['2', [D2]], ['3', [D3]], ['.', [SS, KM]], ['4', [D4]], ['5', [D5]], ['*', [SS, KB]], ['6', [D6]], ['ENTER', [ENTER]],
];
const EXPECT = '740.7';

const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
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

const m = boot(readFileSync(join(ROOT, 'build/desk5.dck')));
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
  const vars = { frame: frames, settled, display: dstr(m), dstrLen: m.ram[S.C_DSTR], V_FRAMES: rd16(m, S.V_FRAMES), K_PX: rd16(m, S.K_PX), K_PY: rd16(m, S.K_PY), ink };
  writeFileSync(join(outDir, `${name}.bin`), d);
  writeFileSync(join(outDir, `${name}.pbm`), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(vars) + '\n');
  console.log(`${name}: frame ${frames}, display "${vars.display}", settled ${settled}, V_FRAMES ${vars.V_FRAMES}, K_PX ${vars.K_PX}, K_PY ${vars.K_PY}, ink pixels ${ink}, rendered vs RAM mismatches ${bad}`);
  return vars;
}

while (!(m.ram[S.C_DSTR] === 1 && m.ram[S.C_DSTR + 1] === 0x30) && frames < 1000) run(1);
const framesToZero = frames;
const zeroSeen = m.ram[S.C_DSTR] === 1 && m.ram[S.C_DSTR + 1] === 0x30;
run(30);
const bootSettled = settle(300);
const boot_ = dump('boot', bootSettled);

const afterKey = [];
for (const [name, keys] of SEQ) {
  for (const [r, b] of keys) m.keyMatrix[r] &= ~(1 << b);
  run(3);
  for (const [r, b] of keys) m.keyMatrix[r] |= 1 << b;
  run(3);
  afterKey.push([name, dstr(m)]);
}
const typedSettled = settle(60);
const typed = dump('typed', typedSettled);
writeFileSync(join(outDir, 'keys.json'), JSON.stringify({ seq: SEQ.map((s) => s[0]), afterKey, expect: EXPECT }) + '\n');
console.log('display after each key: ' + afterKey.map(([k, s]) => `${k}:"${s}"`).join(' '));
const ok = zeroSeen && bootSettled && boot_.display === '0' && typedSettled && typed.display === EXPECT && mismatch === 0 && !same(readFileSync(join(outDir, 'boot.bin')), readFileSync(join(outDir, 'typed.bin')));
console.log(`${ok ? 'PASS' : 'FAIL'}: desk5 reference: display "0" after ${framesToZero} frames, boot settled ${bootSettled}, typed display "${typed.display}" (expected "${EXPECT}"), typed settled ${typedSettled}, ` +
  `rendered-vs-RAM mismatches ${mismatch}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
