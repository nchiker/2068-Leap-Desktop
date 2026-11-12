"use strict";
// bank5-ref.mjs -- the TSRun reference for the cross-emulator runs of bank5 (docs/BANKING.md 7 test 8, 10.5).
//   node tools/xemu/bank5-ref.mjs [OUTDIR]        (default build/xemu/bank5-ref)
// Does NOT build: it boots the existing build/bank5.dck (symbols from build/bank5/out.sym).  Runs frames until the self-test record at
// $FF00 has the marker $A5,$5A and 400 iterations (at most 1,000 frames), then 30 frames more, then until the display is unchanged over
// 20 frames.  Writes bank5.json (the record fields of 10.5, the sums, the frame counts) and bank5.bin (display RAM: $4000-$57FF then
// $6000-$77FF, 12,288 bytes) and bank5.pbm (the rendered 512x192 frame, P4, 1 = ink, as kern4-ref writes it).
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, M, screenPixel, SCR_W, SCR_H } from '../../tests/lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = process.argv[2] ?? join(ROOT, 'build/xemu/bank5-ref');
mkdirSync(outDir, { recursive: true });

const S = {};
for (const line of readFileSync(join(ROOT, 'build/bank5/out.sym'), 'utf8').split('\n')) {
  const mm = line.match(/^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)/);
  if (mm) S[mm[1]] = parseInt(mm[2], 16);
}
const rd16 = (m, a) => m.ram[a] | (m.ram[a + 1] << 8);
const displayRam = (m) => {
  const out = new Uint8Array(12288);
  out.set(m.ram.subarray(0x4000, 0x5800), 0);
  out.set(m.ram.subarray(0x6000, 0x7800), 6144);
  return out;
};
const sum16 = (a) => a.reduce((s, v) => (s + v) & 0xFFFF, 0);
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const rowOff = (y) => ((y & 0xC0) << 5) | ((y & 7) << 8) | ((y & 0x38) << 2);
const ramPixel = (d, x, y) => { const c = x >> 3; return (d[(c & 1) * 6144 + rowOff(y) + (c >> 1)] >> (7 - (x & 7))) & 1; };

const m = boot(readFileSync(join(ROOT, 'build/bank5.dck')));
let frames = 0;
const run = (n) => { for (let i = 0; i < n; i++) { M.runFrame(m); frames++; } };
const have = () => m.ram[0xFF00] === 0xA5 && m.ram[0xFF01] === 0x5A && rd16(m, 0xFF04) === 400;
while (!have() && frames < 1000) run(1);
const framesToRecord = frames;
const found = have();
const rec = { state: m.ram[0xFF02], kind: m.ram[0xFF03], iterations: rd16(m, 0xFF04), V_FRAMES: rd16(m, 0xFF06), V_IRQA: rd16(m, 0xFF08),
  V_IRQR: rd16(m, 0xFF0A), T_LOGN: rd16(m, 0xFF0C), T_LOGSUM: rd16(m, 0xFF0E), DISPSUM: rd16(m, 0xFF10), failPair: rd16(m, 0xFF12) & 0xFF };
// the same numbers recomputed from memory, as a check of the record itself
const logn = rd16(m, S.T_LOGN), logsum = sum16(m.ram.subarray(S.T_LOG, S.T_LOG + 2048));
run(30);
let prev = displayRam(m), settled = false;
for (let used = 0; used < 200 && !settled; used += 20) {
  run(20);
  const cur = displayRam(m);
  settled = same(prev, cur);
  prev = cur;
}
const d = prev;
const dispsum = sum16(d);
const pbm = Buffer.alloc(SCR_W / 8 * SCR_H);
let bad = 0;
for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) {
  const ink = screenPixel(m, x, y) === 0 ? 1 : 0;
  if (ink !== ramPixel(d, x, y)) bad++;
  if (ink) pbm[y * (SCR_W / 8) + (x >> 3)] |= 0x80 >> (x & 7);
}
const out = { ...rec, framesToRecord, framesTotal: frames, settled, T_LOGN_mem: logn, T_LOGSUM_mem: logsum, DISPSUM_settled: dispsum };
writeFileSync(join(outDir, 'bank5.bin'), d);
writeFileSync(join(outDir, 'bank5.pbm'), Buffer.concat([Buffer.from(`P4\n${SCR_W} ${SCR_H}\n`), pbm]));
writeFileSync(join(outDir, 'bank5.json'), JSON.stringify(out, null, 1) + '\n');
const ok = found && rec.state === 1 && rec.kind === 0 && rec.iterations === 400 && settled && rec.T_LOGN === logn && rec.T_LOGSUM === logsum &&
  bad === 0 && rec.V_IRQA > 0 && rec.V_IRQR > 0;   // the record's display sum is taken before the verdict text is drawn (10.5): reported
console.log(`record: state ${rec.state} kind ${rec.kind} iterations ${rec.iterations} V_FRAMES ${rec.V_FRAMES} V_IRQA ${rec.V_IRQA} V_IRQR ${rec.V_IRQR} ` +
  `T_LOGN ${rec.T_LOGN} T_LOG sum $${rec.T_LOGSUM.toString(16)} display sum $${rec.DISPSUM.toString(16)} (settled display sum $${dispsum.toString(16)}) failPair ${rec.failPair}`);
console.log(`${ok ? 'PASS' : 'FAIL'}: bank5 reference: record found after ${framesToRecord} frames (${frames} in all), settled ${settled}, record sums = memory sums ${rec.T_LOGN === logn && rec.T_LOGSUM === logsum}, ` +
  `record display sum (before the verdict text) $${rec.DISPSUM.toString(16)}, settled $${dispsum.toString(16)}, rendered-vs-RAM mismatches ${bad}; written to ${outDir}`);
process.exitCode = ok ? 0 : 1;
