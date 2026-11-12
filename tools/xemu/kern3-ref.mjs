"use strict";
// kern3-ref.mjs -- the TSRun reference for the cross-emulator runs of kern3demo (docs/OBJECTS_EVENTS.md 9 test 10, 15.4).
//   node tools/xemu/kern3-ref.mjs [OUTDIR]        (default build/xemu/kern3-ref; builds kern3demo itself)
// Boots build/kern3demo.dck on TSRun and runs frames normally until the record state (+2) is 3, then 100 more frames (the demo
// rebuilds the tree and draws the scene meanwhile; without input the screen then stays constant).  Writes:
//   settled.bin   display RAM: $4000-$57FF (file 0) then $6000-$77FF (file 1), 12,288 bytes
//   settled.pbm   the 512x192 rendered frame (P4, 1 = ink)
//   settled.json  K_FOCUS, T_VIEWS word 1 (view A), record, frame counts
//   record.bin    the 8 bytes at $FF00-$FF07
// Checkpoint 2 (TAB): CAPS SHIFT + 4 held for 2 frames, then released, then 10 frames; writes tab.bin / tab.pbm / tab.json.
// Also checked: the screen is unchanged over 20 further frames at each checkpoint (settled), the rendered frame equals the display
// RAM, and the focus moved from 0 to view A at the TAB.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { boot, M, screenPixel, SCR_W, SCR_H } from '../../tests/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(ROOT, 'build/xemu/kern3-ref');
mkdirSync(outDir, { recursive: true });

const { dck, syms: S } = build('kern3demo');
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
const marked = () => m.ram[S.RESULT] === 0xA5 && m.ram[S.RESULT + 1] === 0x5A;
let frames = 0;
const run = (n) => { for (let i = 0; i < n; i++) { M.runFrame(m); frames++; } };
while (!(marked() && m.ram[S.RESULT + 2] === 3) && frames < 3000) run(1);
const framesToState3 = frames;
run(100);

let mismatch = 0;
function dump(name, extra) {
  const d = displayRam(m);
  const pbm = Buffer.alloc(SCR_W / 8 * SCR_H);
  let bad = 0;
  for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
    const ink = screenPixel(m, x, y) === 0 ? 1 : 0;
    if (ink !== ramPixel(d, x, y)) bad++;
    if (ink) pbm[y * (SCR_W / 8) + (x >> 3)] |= 0x80 >> (x & 7);
  }
  mismatch += bad;
  const vars = { frame: frames, K_FOCUS: rd16(m, S.K_FOCUS), viewA: rd16(m, S.T_VIEWS + 2), record: [...m.ram.subarray(S.RESULT, S.RESULT + 8)], ...extra };
  writeFileSync(join(outDir, `${name}.bin`), d);
  writeFileSync(join(outDir, `${name}.pbm`), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(vars) + '\n');
  const ink = [...pbm].reduce((a, b) => a + b.toString(2).replace(/0/g, '').length, 0);
  console.log(`${name}: frame ${frames}, K_FOCUS $${vars.K_FOCUS.toString(16)}, view A $${vars.viewA.toString(16)}, ink pixels ${ink}, rendered vs RAM mismatches ${bad}`);
  return { d, vars };
}
const settled = dump('settled', { framesToState3 });
writeFileSync(join(outDir, 'record.bin'), Buffer.from(settled.vars.record));
run(20);
const stable0 = same(settled.d, displayRam(m));

// checkpoint 2: CS + 4 (TAB): key 0 is CAPS SHIFT (row 0 bit 0), '4' is index 18 = row 3 bit 3
m.keyMatrix[0] &= ~1; m.keyMatrix[3] &= ~(1 << 3);
run(2);
m.keyMatrix[0] |= 1; m.keyMatrix[3] |= (1 << 3);
run(10);
const tab = dump('tab', {});
run(20);
const stable1 = same(tab.d, displayRam(m));

const rec = settled.vars.record;
const recOk = rec[0] === 0xA5 && rec[1] === 0x5A && rec[2] === 3 && rec[3] === 26 && (rec[4] | rec[5] << 8) === 0x1D7E && rec[6] === 2;
const focusOk = settled.vars.K_FOCUS === 0 && tab.vars.K_FOCUS === tab.vars.viewA && tab.vars.viewA !== 0;
const differs = !same(settled.d, tab.d);
const ok = recOk && focusOk && differs && stable0 && stable1 && mismatch === 0;
console.log(`${ok ? 'PASS' : 'FAIL'}: kern3demo reference: state 3 after ${framesToState3} frames, record ${recOk ? 'as specified' : 'WRONG ' + rec.map((x) => x.toString(16)).join(' ')}, ` +
  `settled over 20 frames ${stable0}/${stable1}, focus 0 -> A after TAB ${focusOk}, TAB screen differs from settled ${differs}, rendered-vs-RAM mismatches ${mismatch}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
