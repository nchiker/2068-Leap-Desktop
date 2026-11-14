"use strict";
// boot-snapshot.mjs -- proof of TESTSPEED S2 (boot once): a machine restored from the shared ROM-boot snapshot (tests/fast-boot.mjs, copied from
// Arcade) is the machine a cold boot gives.  For build/desk5.dck the COMPLETE state of both machines (every non-function field of the TSRun machine,
// the frame buffer excluded: video is off) is compared right after the snapshot frame, 50 frames later, and 200 frames later (the shell is up).
//   node tests/boot-snapshot.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { M } from './lib.mjs';
import { bootedMachine, coldMachine, snapshotMachine, snapshotFrame, bootSkip } from './fast-boot.mjs';

let passed = 0, failed = 0;
const check = (name, ok, detail = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); ok ? passed++ : failed++; return ok; };

function firstDiff(a, b, path) {
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor || a.length !== b.length) return `${path} (type or length)`;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return `${path}[${i}] ${a[i]} vs ${b[i]}`;
    return null;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `${path} (array length)`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${path}[${i}]`); if (d) return d; }
    return null;
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length || ka.some((k) => !(k in b))) return `${path} (keys)`;
    for (const k of ka) { const d = firstDiff(a[k], b[k], `${path}.${k}`); if (d) return d; }
    return null;
  }
  return Object.is(a, b) ? null : `${path} ${a} vs ${b}`;
}
/** Everything the machine holds, including what the snapshot does not restore (the cartridge, the key and stick arrays). */
function fullState(m) {
  const s = snapshotMachine(m);
  for (const k of ['dock', 'dockRam', 'exCart', 'exCartRam', 'homeCart', 'homeCartRam', 'homeRamSave']) s[k] = Array.isArray(m[k]) ? m[k].map((v) => (v && v.slice ? v.slice() : v)) : m[k];
  s.keyMatrix = m.keyMatrix.slice(); s.joystick = m.joystick.slice();
  return s;
}

const dck = new Uint8Array(readFileSync(join(ROOT, 'build/desk5.dck')));
const skip = snapshotFrame();
console.log(`snapshot frame ${skip} (the stock ROM's first write to port $F4 / $FF is in that frame)`);
const cold = coldMachine(dck), warm = bootedMachine(dck);
check('the restored machine reports the frames it skipped', bootSkip(warm) === skip && bootSkip(cold) === 0, `skip ${bootSkip(warm)}`);
for (let f = 0; f < skip; f++) M.runFrame(cold);
let at = 0;
for (const extra of [0, 50, 200]) {
  for (; at < extra; at++) { M.runFrame(cold); M.runFrame(warm); }
  const d = firstDiff(fullState(cold), fullState(warm), 'm');
  check(`complete machine state, cold boot = restored, ${extra} frames after the snapshot frame`, d === null, d ?? '');
}
// two restored machines are independent of each other (no shared typed arrays)
const w2 = bootedMachine(dck);
warm.ram[0x8000] ^= 0xFF;
check('a second restored machine does not share RAM with the first', w2.ram[0x8000] !== warm.ram[0x8000]);
console.log(`boot-snapshot: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
