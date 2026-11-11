"use strict";
// fuse-probe23-check.mjs -- check every .scr frame (6,912 bytes: bitmap + attributes of the displayed screen) of a Fuse movie of the
// probe23 cartridge (docs/PROBE_DOCK23.md, Fuse column).
//   node tools/xemu/fuse-probe23-check.mjs DIR
// Model (as tests/probe23.mjs): display file 1 byte at offset off = (7*(off/3)+1)&255 when off%3==0 and off/3 < 2000, else 0; offset $17FF
// (the ISR's frame stamp) is excluded.  Run frame: every bitmap byte is the model value or 0, attributes all $38.  Final frame: bitmap equals
// the full model, attributes all $20.  Up to 2 transition frames (the final attribute fill happening mid-frame) are allowed before the first
// final frame, as in Leap-IDE's arcade/spike/bank/fuse-check.mjs.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const N = 2000, ISR_OFF = 0x17FF;
const model = (off) => (off % 3 === 0 && off / 3 < N) ? ((7 * (off / 3) + 1) & 0xFF) : 0;
const files = readdirSync(dir).filter((f) => /^frame-.*\.scr$/.test(f)).sort();

// Per frame: shown (non-zero model bytes present), wrong (bytes that are neither model nor 0), missing (model bytes absent), attribute counts.
const info = files.map((f) => {
  const b = readFileSync(join(dir, f));
  const r = { f, size: b.length, shown: 0, wrong: 0, missing: 0, a38: 0, a20: 0, firstWrong: '' };
  if (b.length !== 6912) return r;
  for (let off = 0; off < 0x1800; off++) {
    if (off === ISR_OFF) continue;
    const want = model(off), v = b[off];
    if (want !== 0 && v === want) r.shown++;
    else if (v !== 0) { r.wrong++; if (!r.firstWrong) r.firstWrong = `offset $${off.toString(16)}: ${v}, model ${want}`; }
    if (want !== 0 && v === 0) r.missing++;
  }
  for (let k = 6144; k < 6912; k++) { if (b[k] === 0x38) r.a38++; else if (b[k] === 0x20) r.a20++; }
  return r;
});
const isRun = (r) => r.size === 6912 && r.wrong === 0 && r.a38 === 768;
const isFinal = (r) => r.size === 6912 && r.wrong === 0 && r.missing === 0 && r.a20 === 768;
let totalModel = 0; for (let off = 0; off < 0x1800; off++) if (off !== ISR_OFF && model(off) !== 0) totalModel++;

const first = info.findIndex(isRun);
const fin = info.findIndex((r, i) => i > first && first >= 0 && isFinal(r));
let lastRun = fin < 0 ? info.length - 1 : fin - 1, trans = 0;
while (lastRun > first && !isRun(info[lastRun]) && trans < 2) { lastRun--; trans++; }
const boot = first < 0 ? info.length : first;
const run = first < 0 ? [] : info.slice(first, lastRun + 1);
const badRun = run.filter((r) => !isRun(r));
let decreases = 0, firstDec = '';
for (let i = 1; i < run.length; i++) if (isRun(run[i]) && isRun(run[i - 1]) && run[i].shown < run[i - 1].shown) { decreases++; if (!firstDec) firstDec = `${run[i - 1].f}: ${run[i - 1].shown} -> ${run[i].f}: ${run[i].shown}`; }
const finals = fin < 0 ? [] : info.slice(fin);
const badFinal = finals.filter((r) => !isFinal(r));
const tail = info.slice(lastRun + 1, fin < 0 ? info.length : fin);

console.log(`frames: ${info.length} (boot frames before the first run frame: ${boot}; run frames: ${run.length}; transition frames before the final: ${trans}; final frames: ${finals.length})`);
console.log(`model bytes shown in run frames: first ${run[0]?.shown ?? '-'}, last ${run.at(-1)?.shown ?? '-'} of ${totalModel}`);
const checks = [
  ['run frames exist', run.length > 0, `${run.length}`],
  ['every run frame: bitmap bytes are model or 0, attributes all $38', run.length > 0 && badRun.length === 0,
   badRun.length ? `${badRun.length} bad, first ${badRun[0].f}: wrong ${badRun[0].wrong} (${badRun[0].firstWrong}), attrs $38 ${badRun[0].a38}` : `${run.length} frames`],
  ['model bytes shown never decrease', decreases === 0, decreases ? `${decreases} decreases, first ${firstDec}` : `0 in ${run.length} frames`],
  ['final frames exist', finals.length > 0, `${finals.length}`],
  ['final frames: full model, attributes all $20', finals.length > 0 && badFinal.length === 0,
   badFinal.length ? `${badFinal.length} bad, first ${badFinal[0].f}: wrong ${badFinal[0].wrong}, missing ${badFinal[0].missing}, attrs $20 ${badFinal[0].a20}` : `${finals.length} frames`],
  ['at most 2 transition frames', trans <= 2 && tail.length === trans, `${trans} (unclassified frames before the final: ${tail.length})`],
];
let ok = true;
for (const [n, v, num] of checks) { console.log(`  ${v ? 'PASS' : 'FAIL'}  ${n}: ${num}`); ok = ok && v; }
process.exitCode = ok ? 0 : 1;
