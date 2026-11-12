"use strict";
// spike6-ref.mjs -- the TSRun reference for the cross-emulator runs of spike6 (docs/GRAPHICS_SPIKE.md 17.8).
//   node tools/xemu/spike6-ref.mjs [OUTDIR]        (default build/xemu/spike6-ref; run after `node tools/build.mjs spike6`)
// Boots build/spike6.dck on TSRun, runs frames normally until the record state is 2, and after the frame in which V_CHECKS
// rises to k (k = 1..8) writes, for checkpoint k:
//   cpK.bin   display RAM: $4000-$57FF (file 0) then $6000-$77FF (file 1), 12,288 bytes
//   cpK.json  V_PX (word), V_PY (byte), V_MENU, V_DRAG, V_TICK, V_FRAMES (+ V_CHECKS, the frame number)
//   cpK.pbm   the 512x192 rendered frame (P4, 1 = ink)
// Mode 6 layout: byte column c (0..63) of pixel row y is in file c AND 1 at the Spectrum row address of y + (c >> 1).
// Also checks that the rendered frame equals the bitmap decoded from the display RAM (bit set = black ink).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../build.mjs';
import { boot, M, screenPixel, SCR_W, SCR_H } from '../../tests/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(ROOT, 'build/xemu/spike6-ref');
mkdirSync(outDir, { recursive: true });

const { dck, syms: S } = build('spike6');
const rd8 = (m, a) => m.ram[a];
const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
const rowOff = (y) => ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);

/** 12,288 bytes: file 0 ($4000-$57FF) then file 1 ($6000-$77FF). */
export const displayRam = (m) => {
  const out = new Uint8Array(12288);
  out.set(m.ram.subarray(0x4000, 0x5800), 0);
  out.set(m.ram.subarray(0x6000, 0x7800), 6144);
  return out;
};
/** pixel (x, y) from the display bytes: bit set = ink */
const ramPixel = (d, x, y) => {
  const c = x >> 3, file = c & 1, off = rowOff(y) + (c >> 1);
  return (d[file * 6144 + off] >> (7 - (x & 7))) & 1;
};

const m = boot(dck);
const marked = () => m.ram[S.RESULT] === 0xA5 && m.ram[S.RESULT + 1] === 0x5A;
let frames = 0, last = 0, mismatchPixels = 0;
const cps = [];
while (!(marked() && m.ram[S.RESULT + 2] === 2) && frames < 3000) {
  M.runFrame(m); frames++;
  if (!marked()) continue;                    // RAM is random until the cartridge has initialised (the marker is written then)
  const k = rd8(m, S.V_CHECKS);
  if (k !== last) {
    if (k !== last + 1 || k > 8) throw new Error(`V_CHECKS jumped ${last} -> ${k} at frame ${frames}`);
    last = k;
    const d = displayRam(m);
    const rows = [];
    let bad = 0, firstBad = '';
    const pbm = Buffer.alloc(SCR_W / 8 * SCR_H);
    for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
      const ink = screenPixel(m, x, y) === 0 ? 1 : 0;
      if (ink !== ramPixel(d, x, y)) { bad++; if (!firstBad) firstBad = `(${x},${y}) frame ${ink}, RAM ${ramPixel(d, x, y)}`; }
      if (ink) pbm[y * (SCR_W / 8) + (x >> 3)] |= 0x80 >> (x & 7);
    }
    mismatchPixels += bad;
    const vars = { V_CHECKS: k, frame: frames, V_PX: rd16(m, S.V_PX), V_PY: rd8(m, S.V_PY), V_MENU: rd8(m, S.V_MENU),
      V_DRAG: rd8(m, S.V_DRAG), V_TICK: rd16(m, S.V_TICK), V_FRAMES: rd16(m, S.V_FRAMES) };
    writeFileSync(join(outDir, `cp${k}.bin`), d);
    writeFileSync(join(outDir, `cp${k}.json`), JSON.stringify(vars) + '\n');
    writeFileSync(join(outDir, `cp${k}.pbm`), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
    cps.push(vars);
    console.log(`checkpoint ${k}: frame ${frames}, V_PX ${vars.V_PX}, V_PY ${vars.V_PY}, V_MENU ${vars.V_MENU}, V_DRAG ${vars.V_DRAG}, V_TICK ${vars.V_TICK}, V_FRAMES ${vars.V_FRAMES}; ` +
      `ink pixels ${[...pbm].reduce((a, b) => a + b.toString(2).replace(/0/g, '').length, 0)}; rendered frame vs display RAM: ${bad ? `${bad} differ, first ${firstBad}` : 'identical'}`);
  }
}
const ok = marked() && m.ram[S.RESULT + 2] === 2 && cps.length === 8 && mismatchPixels === 0;
console.log(`${ok ? 'PASS' : 'FAIL'}: spike6 reference: ${frames} frames, state ${m.ram[S.RESULT + 2]}, ${cps.length} checkpoints, rendered-vs-RAM pixel mismatches ${mismatchPixels}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
