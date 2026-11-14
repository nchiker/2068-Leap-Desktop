"use strict";
// calc-perf.mjs -- Calculator's bounds, docs/CALCULATOR.md section 7, as a table (test 6 of section 8), on the prebuilt `desk5` cartridge.  Written from the contract only.
//   node tests/calc-perf.mjs [--seed N] [--ndiv N] [--nops N] [--nsel N]
//     --ndiv N   random divisions measured through '=' (default 8000)
//     --nops N   random other operations (+ - *) measured through '=' (default 2000)
//     --nsel N   random digit keys measured over random states (default 20000)
// Cartridge since SHELL.md 9-10: it boots the shell; bootDesk5 launches Calculator through the shell (a double click on its icon), then everything below is as before.
// Rows: measured, bound, pass / MISSED / reported.  Exit code 1 on a missed bound.  T-states are TSRun's (no memory contention); direct calls, sentinel return, interrupts off.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../tools/build.mjs';
import { parseSym } from './wm-lib.mjs';
import { Calc, typeValue, keyCodes, scaled, fmt } from './calc-model.mjs';
import * as L from './calc-lib.mjs';
import { toDisp } from './wm-model2.mjs';

const { argNum, hex } = L;
const SEED = argNum('--seed', 1), NDIV = argNum('--ndiv', 8000), NOPS = argNum('--nops', 2000), NSEL = argNum('--nsel', 20000);
const rng = L.makeRng(SEED);
console.log(`seed ${SEED} (rerun with --seed ${SEED})`);
const rows = [];
let missed = 0;
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  if (status === 'MISSED') missed++;
  rows.push({ name, measured, bound, status, note });
  console.log(`${status === 'MISSED' ? 'FAIL' : 'ok  '} | ${name} | measured ${measured} | bound ${bound === null ? 'report' : '<= ' + bound.toLocaleString('en')} | ${status}${note ? ' | ' + note : ''}`);
};

const load = L.loadDesk5(), S = load.S;

// ---- bytes ---------------------------------------------------------------------------------------------------------------------------------
row('Calculator bytes in DOCK 2-3 (C_END - C_START: code and image; C_START replaces C_INIT since SHELL 10.3)', S.C_END - S.C_START, 2500, `C_START ${hex(S.C_START)}, C_END ${hex(S.C_END)}, 1,800 estimated`);
row('Calculator RAM image (C_IMG_LEN)', S.C_IMG_LEN, 512);
{
  // desk5's pool bytes beyond kern4's kernel: kern4 (build/kern4/out.sym) is the kernel plus its test code; desk5 is the same kernel, gfx6 and menus without test code.
  // The kernel parts are the same size in both builds (K_CODE, K1_CODE: reported), so what is left is the boot code of page 0 at ENTRY (far.asm in $0068-$009D not counted:
  // BANKING 6.1): T_IDLE - ENTRY, the code that sets the machine up and, in desk5, launches Calculator (KFAR C_INIT, the arena set-up, KFAR C_MAIN).
  const k4 = join(ROOT, 'build', 'kern4', 'out.sym');
  if (!existsSync(k4)) row('desk5 pool bytes beyond kern4\'s kernel', NaN, 264, 'build/kern4/out.sym is missing');
  else {
    const K = parseSym(readFileSync(k4, 'utf8'));
    const boot5 = S.T_IDLE - S.ENTRY, boot4 = K.T_IDLE - K.ENTRY;
    const kc5 = S.K_CODE_END - S.K_CODE, kc4 = K.K_CODE_END - K.K_CODE, k15 = S.K1_CODE_END - S.K1_CODE, k14 = K.K1_CODE_END - K.K1_CODE;
    const extra = (boot5 - boot4) + (kc5 - kc4) + (k15 - k14);
    row('desk5 pool bytes beyond kern4\'s kernel (boot code ENTRY..T_IDLE + K_CODE + K1_CODE, each against kern4; 264 since W4\'s double-click flag, WRITE 14.11)', extra, 264,
      `boot ${boot5} against ${boot4} (${boot5 - boot4 >= 0 ? '+' : ''}${boot5 - boot4}); K_CODE ${kc5} against ${kc4}; K1_CODE ${k15} against ${k14}; 40 estimated; far.asm not counted`);
  }
}

// ---- C_KEY: digits and '=' ----------------------------------------------------------------------------------------------------------------
const env = L.bootDesk5({ watch: false });
L.park(env);
const { m } = env;
const model = new Calc();
const press = (k) => { const t = L.directKey(env, k, rng); const want = model.key(k), got = L.readDstr(m, S); if (got !== want) throw new Error(`measuring: display "${got}" against the model "${want}" after key ${k}`); return t; };
const run = (str) => { let t = 0; for (const k of keyCodes(str)) t = press(k); return t; };
const fmtIn = (x, op, y) => `${typeValue(x[0], x[1], x[2])} ${op} ${typeValue(y[0], y[1], y[2])}`;

// digits: random keys over the states random sequences reach, and every digit after a set of values and entries
{
  let worst = 0, worstWhere = '', n = 0, sum = 0;
  const trail = [];
  const measureDigit = (d, where) => { const t = press(48 + d); n++; sum += t; if (t > worst) { worst = t; worstWhere = where; } };
  const entries = ['', '0', '1', '12', '1234567', '12345678', '123456789', '0.', '0.1', '0.0000001', '1.234567', '12345678.', '-', '-1', 'n', '5n', '12345678n', '0.0000001n', '9.9999999n', '.', '.5n'];
  for (const e of entries) for (let d = 0; d <= 9; d++) { press(99); run(e); measureDigit(d, `after "c${e}"`); }
  // after an operation (ENT = 0 with a long X on show), and with a pending operator
  for (const xs of ['99999999', '0.0000001n', '1/3', '99999999n', '9999999.9', '2/3n', '12345678', '0.0000001n*1']) {
    for (let d = 0; d <= 9; d++) { press(99); run(xs.includes('/') ? xs + '=' : xs + '+0='); measureDigit(d, `after "${xs}" =`); }
  }
  for (let i = 0; i < NSEL; i++) {
    if (rng.chance(0.1)) press(99);
    const k = rng.next() < 0.5 ? 48 + rng.int(0, 9) : [46, 43, 45, 42, 47, 61, 12, 110, 101][rng.int(0, 8)];
    if (k >= 48 && k <= 57) { trail.length = 0; measureDigit(k - 48, `state "${model.display()}", ENT ${model.ENT}, OP ${model.OP}`); } else press(k);
  }
  row(`C_KEY for a digit, with the display string written (worst of ${n} digit keys, mean ${Math.round(sum / n)})`, worst, 3000, `worst: ${worstWhere}`);
}

// '=' over many operations; the slowest inputs are kept
{
  const EDGES = [[1, 0, 0], [1, 1, 0], [1, 3, 0], [1, 7, 0], [1, 99999999, 0], [-1, 99999999, 0], [1, 1, 7], [-1, 1, 7], [1, 99999999, 7], [1, 12345678, 0], [1, 12345678, 7], [1, 10000000, 7], [1, 3333333, 7],
    [1, 66666667, 7], [1, 5, 1], [1, 25, 2], [1, 1, 1], [1, 9999999, 0], [1, 50000000, 1], [1, 31415927, 7], [1, 14142136, 7], [1, 2, 0], [1, 8, 0], [1, 100, 0]];
  const randV = () => {
    const len = rng.int(1, 8), M = rng.int(Math.pow(10, len - 1), Math.pow(10, len) - 1), d = rng.chance(0.2) ? 0 : rng.int(0, 7);
    return [rng.chance(0.4) ? -1 : 1, Math.min(M, 99999999), d];
  };
  const stats = { '/': { n: 0, max: 0, sum: 0, top: [] }, '+': { n: 0, max: 0, sum: 0, top: [] }, '-': { n: 0, max: 0, sum: 0, top: [] }, '*': { n: 0, max: 0, sum: 0, top: [] } };
  const one = (x, op, y) => {
    run('c' + typeValue(...x) + op + typeValue(...y));
    const t = press(61), st = stats[op]; st.n++; st.sum += t;
    st.top.push([t, fmtIn(x, op, y)]); if (st.top.length > 40) { st.top.sort((a, b) => b[0] - a[0]); st.top.length = 3; }
    if (t > st.max) st.max = t;
  };
  for (const x of EDGES) for (const y of EDGES) for (const op of ['/', '+', '-', '*']) one(x, op, y);                       // the corner grid: 24 x 24 x 4
  for (let i = 0; i < NDIV; i++) one(randV(), '/', rng.chance(0.1) ? EDGES[rng.int(0, EDGES.length - 1)] : randV());
  for (let i = 0; i < NOPS; i++) one(randV(), rng.pick(['+', '-', '*']), randV());
  const top = (op) => { const s = stats[op].top.sort((a, b) => b[0] - a[0]).slice(0, 3); return s.map(([t, w]) => `${t} for ${w}`).join('; '); };
  row(`C_KEY '=' doing a division (worst of ${stats['/'].n}, mean ${Math.round(stats['/'].sum / stats['/'].n)})`, stats['/'].max, 175000, `slowest: ${top('/')}; the owner set 175,000 from the measured 174,661 (option A)`);
  for (const op of ['+', '-', '*']) row(`C_KEY '=' doing ${op} (worst of ${stats[op].n}, mean ${Math.round(stats[op].sum / stats[op].n)})`, stats[op].max, 175000, `slowest: ${top(op)}`);
  // the operator key that performs the pending operation (chained calculation) does the same arithmetic: reported against the same 175,000
  let chain = { max: 0, where: '' };
  for (let i = 0; i < 1500; i++) {
    const x = randV(), y = rng.chance(0.15) ? EDGES[rng.int(0, EDGES.length - 1)] : randV(), op = rng.pick(['/', '/', '*', '+', '-']);
    run('c' + typeValue(...x) + op + typeValue(...y));
    const t = press(rng.pick([43, 45, 42, 47]));
    if (t > chain.max) chain = { max: t, where: fmtIn(x, op, y) + ' then an operator key' };
  }
  row('C_KEY of an operator key that performs the pending operation (chained; contract bounds only "="; same 175,000 shown for reference)', chain.max, null, `slowest: ${chain.max} for ${chain.where}${chain.max > 175000 ? ' (OVER 175,000)' : ''}`);
}

// ---- W_DRAWVIEW of the display showing "-0.0000001" ------------------------------------------------------------------------------------------
let dispAddr = 0;
{
  press(99); run('0.0000001n');
  dispAddr = L.rd16(m, S.C_DISP);
  const v = L.readView(m, S, dispAddr);
  const ok = v.cls === S.CL_CDisp && v.x === 168 && v.y === 40 && v.w === 160 && v.h === 16;
  if (!ok) row('W_DRAWVIEW of the display "-0.0000001"', NaN, null, `C_DISP ${hex(dispAddr)} is not the CDisp (class ${hex(v.cls)})`);
  else {
    const times = [];
    for (let i = 0; i < 3; i++) times.push(L.directCall(env, S.W_DRAWVIEW, { ix: dispAddr }, 'K'));
    const d = L.screenDiff(env, '-0.0000001');
    row('W_DRAWVIEW of the display showing "-0.0000001" (direct call under K, up-call into banked CDisp M_DRAW)', times[0], null, `T-states; repeated ${times.join(', ')}; the screen then shows the string: ${d === null ? 'yes' : 'NO: ' + d}`);
    if (d !== null) { missed++; console.log('FAIL | the display drawn by W_DRAWVIEW does not equal the rendering'); }
  }
  press(99);
}

// ---- a click to the display redrawn; interrupts lost -----------------------------------------------------------------------------------------
{
  const e2 = L.bootDesk5({ watch: false }), m2 = e2.m, S2 = e2.S, cm = new Calc();
  // does the display rectangle of the screen show `dstr` (the contract's CDisp rendering; the pointer's bytes left out)?
  const dispShows = (dstr) => {
    const exp = toDisp(L.renderScreen(dstr, -1)), full = L.readDisp(m2), mask = L.pointerMask(m2, S2), keep = new Uint8Array(mask.length);
    for (let y = L.DISP.y; y < L.DISP.y + L.DISP.h; y++) for (let bc = L.DISP.x >> 3; bc <= (L.DISP.x + L.DISP.w - 1) >> 3; bc++) keep[y * 64 + bc] = mask[y * 64 + bc];
    return L.diffMasked(full, exp, keep) === null;
  };
  const trials = [];
  for (const id of [55, 56, 57, 12, 110, 27, 49, 50, 12, 12]) {                     // every one of these changes what the display shows
    const b = L.BUTTONS.find((x) => x.id === id), [cx, cy] = L.centre(b);
    const arrived = L.moveTo(e2, cx, cy); e2.frames_(6);                            // pointer on the button, everything idle
    const before = L.readDstr(m2, S2);
    cm.key(id); const want = cm.display();
    m2.mouse.buttons = L.MOUSE_LEFT;
    let early = -1;
    for (let f = 1; f <= 3; f++) { e2.frame(); if (early < 0 && L.readDstr(m2, S2) === want && dispShows(want)) early = f; }     // held for 3 frames
    m2.mouse.buttons = L.MOUSE_UP;
    let n = -1;
    for (let f = 1; f <= 12; f++) { e2.frame(); if (L.readDstr(m2, S2) === want && dispShows(want)) { n = f; break; } }
    trials.push({ b, arrived, n, early, before, want, got: L.readDstr(m2, S2) });
    e2.frames_(8);
  }
  const bad = trials.filter((t) => t.n < 0 || !t.arrived);
  const worst = Math.max(...trials.map((t) => t.n));
  row('a click on a button to the display redrawn: frames after the release until the screen shows the new text (report; the press is held 3 frames)', worst, null,
    `per button: ${trials.map((t) => `"${t.b.text}" ${t.n}`).join(', ')}${trials.some((t) => t.early > 0) ? `; shown already during the press for ${trials.filter((t) => t.early > 0).map((t) => t.b.text).join(',')}` : ''}${bad.length ? `; NOT REDRAWN: ${bad.map((t) => t.b.text + ' wanted "' + t.want + '" got "' + t.got + '"').join(',')}` : ''}`);
  if (bad.length) { missed++; console.log('FAIL | a click was not followed by a redraw of the display within 12 frames'); }
  // interrupts lost: V_FRAMES over every normally run frame of this machine: idle, moving the pointer, clicking and typing
  for (let i = 0; i < 40; i++) e2.frame();
  for (const code of [55, 43, 51, 61, 12, 99, 47, 48, 61]) L.typeCode(e2, code);
  L.moveTo(e2, 100, 150); L.moveTo(e2, 400, 20); L.moveTo(e2, 256, 96);
  row('interrupts lost over the click machine\'s normal frames (V_FRAMES must rise by 1 a frame)', e2.vf.bad, 0, `${e2.vf.checked} frames checked: idle, pointer moving, clicks, typing${e2.vf.bad ? '; first ' + e2.vf.first : ''}`);
}

// ---- summary -------------------------------------------------------------------------------------------------------------------------------
console.log('\n| Measure | Measured | Bound | Result |\n|---|---|---|---|');
for (const r of rows) console.log(`| ${r.name} | ${r.measured} | ${r.bound === null ? 'report' : '<= ' + r.bound.toLocaleString('en')} | ${r.status} |`);
console.log(`calc-perf: ${rows.filter((r) => r.status === 'pass').length} passed, ${missed} missed, ${rows.filter((r) => r.status === 'reported').length} reported`);
if (missed) process.exitCode = 1;
