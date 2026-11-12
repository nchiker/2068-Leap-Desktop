"use strict";
// calc-c1.mjs -- Calculator, tests 1-5 of docs/CALCULATOR.md section 8, on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from the contract (sections 3-8) and docs/BANKING.md (2, 4, 10.7, 11.1), never from src/apps/calc.asm.  The reference is tests/calc-model.mjs.
// SHELL.md 9-10 changed the cartridge: it boots into the shell, and Calculator is program 1, launched from the shell (tests/calc-lib.mjs bootDesk5 double-clicks its
// icon) and left by its close box (CWindow, SHELL 10.1) or SYMBOL SHIFT + Q (key code CLOSE).  It has no menu (SHELL 9.4: "the menu bar is empty"), so the old "Calc" menu
// choices of test 4 are replaced by: a click on the menu bar does nothing, the close box and SS+Q quit to the shell, and Calculator starts at 0 again (SHELL 1).
//   node tests/calc-c1.mjs [--seed N] [--n1 N] [--n2 N] [--n4 N] [--only LIST] [--nowatch] [--verbose]
//     --n1 N      random X OP y pairs in test 1 (default 20000)
//     --n2 N      random key sequences in test 2 (default 3000)
//     --n4 N      random inputs in test 4 (default 400; scripted inputs come on top)
//     --only LIST tests to run, e.g. 1,3 (default 1,2,3,4,5; 5 reports on what the others did)
//     --nowatch   leave the memory watch out of tests 1 and 2 (the direct calls; the watch slows them down)
// Exit code 1 on any failure.
import { checks } from './lib.mjs';
import { Calc, typeValue, keyCodes, KEYSET, fmt, scaled } from './calc-model.mjs';
import * as L from './calc-lib.mjs';

const { argv, argNum, hex } = L;
const SEED = argNum('--seed', 1);
const N1 = argNum('--n1', 20000), N2 = argNum('--n2', 3000), N4 = argNum('--n4', 400);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5];
const VERBOSE = argv.includes('--verbose');
const NOWATCH = argv.includes('--nowatch');
const rng = L.makeRng(SEED);
const C = checks('calc-c1');
console.log(`seed ${SEED} (rerun with --seed ${SEED}); test 1: ${N1} operations, test 2: ${N2} sequences, test 4: ${N4} random inputs`);

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; }
  ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 40 : 6)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  end(extra = '') { C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : ''); }
}
const show = (codes) => Array.from(codes, (k) => (k >= 32 && k < 127 ? String.fromCharCode(k) : `<${k}>`)).join('');
const envs = [];                                   // every machine the tests built, for test 5
const mk = (label, opts = {}) => { const e = L.bootDesk5(opts); e.label = label; envs.push(e); return e; };

// ===========================================================================================================================
// Random values and keys.
/** A random value [s, M, d]: edge cases and random digit counts (typed digits at most 8: M < 10^8, d <= 7, so max(len M, d + 1) <= 8). */
const EDGE = [[1, 0, 0], [-1, 0, 0], [1, 1, 0], [1, 99999999, 0], [-1, 99999999, 0], [1, 1, 7], [-1, 1, 7], [1, 5, 7], [1, 4, 7], [1, 99999999, 7], [1, 10000000, 7],
  [1, 5, 1], [1, 95, 1], [1, 9999999, 0], [1, 99999995, 1], [1, 1, 1], [1, 3, 0], [1, 7, 0], [1, 12345678, 0], [1, 12345678, 7], [1, 50000000, 1], [1, 99999999, 1],
  [1, 25, 2], [1, 100, 2], [1, 3333333, 7], [1, 66666667, 7]];
function randValue() {
  if (rng.chance(0.22)) { const e = rng.pick(EDGE); return [rng.chance(0.3) ? -e[0] : e[0], e[1], e[2]]; }
  const len = rng.int(1, 8), M = rng.chance(0.25) ? rng.int(0, 9) : rng.int(Math.pow(10, len - 1), Math.pow(10, len) - 1);
  const m2 = rng.chance(0.15) ? Math.floor(M / 10) * 10 : M;                    // trailing zeros: E is typed as is, the value is normalised
  const d = rng.chance(0.2) ? 0 : rng.int(0, 7);
  return [rng.chance(0.4) ? -1 : 1, Math.min(m2, 99999999), d];
}
const valueKeys = (v) => typeValue(v[0], v[1], v[2]);

/** The direct-call driver: a Calc model in step with the machine; every key compared. */
function mkSession(env, sec, label) {
  const model = new Calc();
  const trail = [];
  return {
    model, trail,
    press(k) {
      const want = model.key(k);
      L.directKey(env, k, rng);
      const got = L.readDstr(env.m, env.S);
      trail.push(k); if (trail.length > 40) trail.shift();
      sec.ok(got === want, () => `${label}: after "${show(trail)}" (last key ${k}): display "${got}", model "${want}"`);
      return got === want;
    },
    clear() { this.press(99); },
  };
}

// ===========================================================================================================================
// Tests 1 and 2 share one machine: the program booted, then parked, C_KEY called directly under mapping A (CALCULATOR 3).
let envD = null;
const direct = () => { if (!envD) { envD = mk('direct calls', { watch: !NOWATCH }); L.park(envD); } return envD; };

// 1. Arithmetic ---------------------------------------------------------------------------------------------------------------
if (ONLY.includes(1)) {
  const env = direct(), sec = new Sec('1 arithmetic: random X OP y through C_KEY key strings, the display after every key against the model');
  const t0 = Date.now(), ses = mkSession(env, sec, 'test 1');
  const counts = { '+': 0, '-': 0, '*': 0, '/': 0, errors: 0, divzero: 0, rounded10to8: 0 };
  const seen = new Set();
  for (let i = 0; i < N1; i++) {
    const x = randValue(); let y = randValue();
    const op = rng.pick(['+', '-', '*', '/', '/', '+', '-', '*']);
    if (op === '/' && rng.chance(0.06)) y = [1, 0, rng.int(0, 7)];
    if (rng.chance(0.03)) y = [x[0], x[1], x[2]];                              // x OP x
    const str = 'c' + valueKeys(x) + op + valueKeys(y) + '=';
    ses.trail.length = 0;
    for (const k of keyCodes(str)) ses.press(k);
    counts[op]++;
    const d = ses.model.display();
    if (d === 'Error') { counts.errors++; if (op === '/' && y[1] === 0) counts.divzero++; }
    seen.add(d);
    if (sec.nf > 20) break;
  }
  // the targeted cases of the contract: results that round up to 10^8, the half rule, division by 0, tiny products
  const targeted = ['99999999+0.5=', '99999999-0.5=', '9999999.9+0.05=', '9999999.95+0=', '99999999+1=', '99999998+1=', '0.0000001*0.5=', '0.0000001*0.4=', '0.0000001n*0.4=', '1/0=', '0/0=', '0n/0=',
    '1/3=', '2/3=', '100/3=', '99999999/3=', '99999999/7=', '1/99999999=', '0.0000001/3=', '0.0000001/2=', '0.0000003/2=', '99999999*99999999=', '99999999*0.0000001=', '5n/2=', '5/2n=',
    '0.0000001n/0.0000002=', '12345678*8=', '1234.5678*100=', '9999999.9*10=', '9999999.9*10.01=', '0.5+0.5=', '0-0=', '0n+0=', '0.0000001+0.0000001=', '99999999n-1=', '99999999n/0.0000001='];
  for (const t of targeted) { ses.clear(); ses.trail.length = 0; for (const k of keyCodes(t)) ses.press(k); }
  sec.end(`${N1} random + ${targeted.length} targeted; + ${counts['+']} - ${counts['-']} * ${counts['*']} / ${counts['/']}; ${counts.errors} errors (${counts.divzero} divisions by 0); ${seen.size} distinct results; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// 2. Random key sequences -----------------------------------------------------------------------------------------------------
const NONKEYS = [120, 88, 65, 69, 78, 67, 32, 14, 15, 8, 9, 10, 11, 16, 1, 2, 4, 5, 6, 7, 17, 100, 255, 127, 13 + 128, 48 + 128, 61 + 128, 35, 44, 58, 64, 92];
function randKey() {
  const r = rng.next();
  if (r < 0.40) return 48 + rng.int(0, 9);
  if (r < 0.46) return 46;
  if (r < 0.60) return rng.pick([43, 45, 42, 47]);
  if (r < 0.68) return 61;
  if (r < 0.71) return 13;
  if (r < 0.77) return 12;
  if (r < 0.80) return rng.pick([27, 3, 99]);
  if (r < 0.84) return 101;
  if (r < 0.90) return 110;
  return rng.pick(NONKEYS);
}
if (ONLY.includes(2)) {
  const env = direct(), sec = new Sec('2 key sequences: 1-30 keys over the whole key set and some non-keys, the display after every key against the model');
  const t0 = Date.now(), ses = mkSession(env, sec, 'test 2');
  ses.clear();                                                                 // the machine holds test 1's last state: both start from "C"
  let keys = 0, nonkeys = 0, errs = 0, ents = 0, maxLen = 0;
  for (let i = 0; i < N2; i++) {
    ses.trail.length = 0;
    if (rng.chance(0.3)) ses.press(rng.pick([99, 27, 3]));
    const len = rng.int(1, 30);
    for (let j = 0; j < len; j++) {
      const k = rng.chance(0.08) && j > 0 ? 47 : randKey();                    // a division soon after something: reaches Error often enough
      if (!KEYSET.includes(k)) nonkeys++;
      ses.press(k); keys++;
      const d = ses.model.display(); if (d === 'Error') errs++; if (ses.model.ENT) ents++; if (d.length > maxLen) maxLen = d.length;
    }
    if (sec.nf > 20) break;
  }
  // some forced paths: the 8-digit limit, back space down to nothing, the '-' and '.' rules, ERR rules
  const forced = ['123456789012', '0.1234567890', '.....', '1.2.3.4', '0000000000', '00000001', '-', 'n', 'nn', '5nnn', '5nD', '5n.D', '1.5nD', '.nD', 'DDDD', '12345678nD', '12345678.', '12345678.9',
    '+', '+5', '5+', '5+n', '5+nn', '5+n3=', '5=+', '5++5=', '5+*5=', '1/0n', '1/0.', '1/0D', '1/0+', '1/0=5', '1/0e', '1/0e5', '1/0c5', '1/0S5', '1/0B5', '3+e', '3+e=', '3+e5=', 'ee', '5ee7', '7e8+1=',
    '1+2+3+4=', '1+2=+', '1+2=+3=', '1+2=5', '1+2=D', '1+2=n', '1+2=nn', '1+2=.', '1+2=e', '9*9*9*9*9*9*9*9*9*9=', '1/3*3=', '1/3+', '0.1+0.2+0.3=', '5n+5=', '0n+0=', '0.0000001', '0.00000001',
    '2/3', '2/3=n', '2/3=nD', '2/3=n.5', '2/3=+', '2/3=+=', '2/3=*=', '2/3=-=', '2/3=/=', '8=', '8=+', '8=+=', '8D=', '8.D=', 'e=', 'e+', 'e+e=', '.+.=', '.5+.5=', '5.=', '5.+5.=', '.R'];
  for (const f of forced) { ses.clear(); ses.trail.length = 0; for (const k of keyCodes(f)) ses.press(k); ses.press(61); ses.press(13); ses.press(110); ses.press(12); }
  sec.end(`${N2} sequences, ${keys} keys (${nonkeys} non-keys), ${forced.length} forced paths; ${errs} keys left Error showing, ${ents} showed an entry; longest display ${maxLen}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ===========================================================================================================================
// 3. The screen ---------------------------------------------------------------------------------------------------------------
if (ONLY.includes(3)) {
  const env = mk('screen'), { m, S } = env, sec = new Sec('3 screen: the window, the display and the 20 buttons against the contract\'s section 4 as a gfx6-model rendering');
  const views = L.allViews(m, S);
  const win = views.find((v) => v.kind === 'Window'), disp = views.find((v) => v.kind === 'CDisp'), btns = views.filter((v) => v.kind === 'Button');
  sec.ok(!!win && win.x === L.WIN.x && win.y === L.WIN.y && win.w === L.WIN.w && win.h === L.WIN.h, () => `window rect ${win ? [win.x, win.y, win.w, win.h] : 'missing'}, want ${[L.WIN.x, L.WIN.y, L.WIN.w, L.WIN.h]}`);
  sec.ok(!!win && win.cls === S.CL_CWindow, () => `the window's class ${win && hex(win.cls)}, want CWindow ${hex(S.CL_CWindow)} (SHELL 9.4: Calculator has a close box)`);
  sec.ok(!!win && String.fromCharCode(...(win.title || [])) === L.WIN.title, () => `window title "${win && win.title ? String.fromCharCode(...win.title) : null}"`);
  sec.ok(!!disp && disp.x === L.DISP.x && disp.y === L.DISP.y && disp.w === L.DISP.w && disp.h === L.DISP.h, () => `CDisp rect ${disp ? [disp.x, disp.y, disp.w, disp.h] : 'missing'}, want ${[L.DISP.x, L.DISP.y, L.DISP.w, L.DISP.h]}`);
  sec.ok(!!disp && (disp.flags & 1) === 0, () => `CDisp flags ${disp && disp.flags}: not focusable (bit 0 clear)`);
  sec.ok(!!disp && !!win && disp.depth === win.depth + 1, 'CDisp is a child of the window');
  sec.ok(btns.length === 20, () => `${btns.length} buttons, want 20`);
  let flagsExtra = 0;
  for (const b of L.BUTTONS) {
    const v = btns.find((x) => x.x === b.x && x.y === b.y);
    sec.ok(!!v && v.w === 32 && v.h === 16, () => `button "${b.text}" at (${b.x}, ${b.y}): ${v ? `${v.w}x${v.h}` : 'missing'}, want 32x16`);
    if (!v) continue;
    sec.ok(v.id === b.id, () => `button "${b.text}": View_id ${v.id}, want ${b.id}`);
    sec.ok(String.fromCharCode(...(v.text || [])) === b.text, () => `button at (${b.x}, ${b.y}): text "${String.fromCharCode(...(v.text || []))}", want "${b.text}"`);
    sec.ok((v.flags & 1) === 1, () => `button "${b.text}": flags ${v.flags}, focusable (bit 0)`);
    if ((v.flags & ~1) !== 0) flagsExtra++;
    sec.ok(v.depth === (win ? win.depth + 1 : -1), () => `button "${b.text}": a child of the window`);
  }
  sec.ok(flagsExtra === 0, () => `${flagsExtra} button(s) with flag bits other than "focusable" at idle (pressed 8, default $10 change the look)`);
  const d0 = L.screenDiff(env, '0');
  sec.ok(d0 === null, () => `boot screen against the rendering: ${d0}`);
  const fi = L.focusIndex(m, S, views);
  sec.ok(fi >= -1, () => `K_FOCUS is not a Calculator button (index ${fi})`);
  // the pointer rectangle is left out of the comparison; to be sure the rest is not hiding behind it, move the pointer to a corner and compare everything outside the corner
  L.moveTo(env, 500, 180); env.frames_(4);
  const d1 = L.screenDiff(env, '0');
  sec.ok(d1 === null, () => `pointer moved away (500, 180): ${d1}`);
  // the typed sequences: the display text and its right alignment (the rendering draws it at x + w - 4 - G_TEXTW)
  const types = [['0', ''], ['7', '7'], ['12.5', '12.5'], ['12.5+', '12.5'], ['12.5+0.0000001n', '-0.0000001'], ['12.5+0.0000001n=', '12.4999999'], ['1/0=', 'Error'], ['c', '0'], ['99999999', '99999999'], ['n', '-99999999'], ['c', '0'],
    ['0.0000001n', '-0.0000001'], ['c', '0'], ['iiiii', '0']];
  const model = new Calc();
  let shown = 0;
  for (const [s, _] of types) {
    for (const ch of s) { const code = ch.charCodeAt(0); model.key(code); L.typeCode(env, code); }
    const want = model.display(), got = L.readDstr(m, S);
    sec.ok(got === want, () => `typed "${s}": C_DSTR "${got}", model "${want}"`);
    const dd = L.screenDiff(env, want);
    sec.ok(dd === null, () => `typed "${s}": screen shows "${want}": ${dd}`);
    shown++;
  }
  sec.end(`rects: window, display, 20 buttons; ${shown} typed states compared pixel for pixel (except under the pointer)`);
}

// ===========================================================================================================================
// 4. Input over frames --------------------------------------------------------------------------------------------------------
if (ONLY.includes(4)) {
  const env = mk('input'), { m, S } = env, sec = new Sec('4 input over frames: keys through the keyboard matrix, clicks through the Kempston mouse, close box and SS+Q back to the shell, C_DSTR and the screen against the model');
  const model = new Calc();
  let nKey = 0, nClick = 0, nMenu = 0, screens = 0, maxFramesToShow = 0;
  const trail = [];
  const check = (what) => {
    const want = model.display(), got = L.readDstr(m, S);
    sec.ok(got === want, () => `${what} after "${show(trail)}": C_DSTR "${got}", model "${want}"`);
    const dd = L.screenDiff(env, got === want ? want : got);
    screens++;
    sec.ok(dd === null, () => `${what} after "${show(trail)}": screen for "${got === want ? want : got}": ${dd}`);
  };
  const byKey = (code) => { model.key(code); trail.push(code); if (trail.length > 30) trail.shift(); L.typeCode(env, code); nKey++; check(`key ${code}`); };
  const buttonFor = (code) => L.BUTTONS.find((b) => b.id === code);
  const byClick = (code) => {
    const b = buttonFor(code); if (!b) throw new Error(`no button for ${code}`);
    model.key(code); trail.push(code); if (trail.length > 30) trail.shift();
    const [cx, cy] = L.centre(b), ok = L.click(env, cx, cy); nClick++;
    sec.ok(ok, () => `pointer did not arrive at (${cx}, ${cy}): at ${L.pointerPos(m, S)}`);
    check(`click "${b.text}"`);
  };
  const clearKey = () => byKey(99);
  // scripted: the contract's keys, typed
  for (const [s, label] of [['12+34=', 'ENTER-less'], ['7*8=', ''], ['9/3R', 'ENTER as ='], ['1/0=', 'error'], ['5', 'digit while Error'], ['c', 'C'], ['123D', 'DELETE'], ['5nD', ''], ['2+3', ''], ['S', 'ESC'], ['1.5+2.25=', ''],
    ['3B', 'BREAK'], ['100/8=', ''], ['1/3=', 'rounds'], ['2/3=n', ''], ['c', ''], ['9999999.9+0.05=', 'rounds up'], ['0.0000001n', ''], ['c', ''], ['99999999+1=', 'overflow'], ['e', 'CE while Error'], ['6e7+1=', 'CE'], ['c', '']]) {
    for (const ch of s) byKey(ch === 'D' ? 12 : ch === 'R' ? 13 : ch === 'S' ? 27 : ch === 'B' ? 3 : ch.charCodeAt(0));
  }
  // non-keys typed: nothing changes (SPACE and MENU would act on the focus and the menu: not used); TAB moves the focus, which the screen check follows
  for (const code of [120, 14, 14, 15, 97]) byKey(code);
  clearKey();
  // scripted clicks: every button once through a real calculation, then random
  const clickSeq = (str) => { for (const ch of str) byClick(ch === 'D' ? 12 : ch === 'S' ? 27 : ch.charCodeAt(0)); };
  clickSeq('S12+34='); clickSeq('S7*8='); clickSeq('S9/3='); clickSeq('S1/0='); clickSeq('S5.5nn+.5=');
  clickSeq('S1/3='); clickSeq('S2/3=n'); clickSeq('S123DD'); clickSeq('S45e67+8='); clickSeq('S0.0000001n'); clickSeq('S');
  for (const b of L.BUTTONS) { byClick(48); byClick(b.id); }                    // every button after a digit
  clickSeq('S');
  // random mix of both, over the Calculator's own keys; only keys with a button can be clicked
  const clickable = L.BUTTONS.map((b) => b.id);
  const kbOnly = [13, 3, 99, 27];
  for (let i = 0; i < N4; i++) {
    const r = rng.next();
    if (r < 0.45) byClick(rng.chance(0.6) ? 48 + rng.int(0, 9) : rng.pick(clickable));
    else if (r < 0.9) { const k = randKey(); if (KEYSET.includes(k)) byKey(k); else if (rng.chance(0.5)) byKey(120); else byKey(14); }
    else byKey(rng.pick(kbOnly));
    if (sec.nf > 12) break;
  }
  // SHELL 9.4: Calculator has no menu, the menu bar is empty.  A press on the bar where "Calc" used to be (20, 4), moved down over where its items were and released,
  // changes nothing: the display, the screen (CALCULATOR 4 rendering with the empty bar) and the program all stay.
  {
    for (const s2 of ['1', '2', '+', '3']) byKey(s2.charCodeAt(0));
    L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, 30, 14); env.frames_(2);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(8); nMenu++;
    check('a press on the empty menu bar, moved down and released');
    sec.ok(m.ram[S.K_PROG] === 1 && L.progUp(env, 1), () => `after the press on the menu bar: K_PROG ${m.ram[S.K_PROG]}, Calculator window up ${L.progUp(env, 1)}`);
    for (const s2 of '5=') byKey(s2.charCodeAt(0));
    byKey(99);
  }
  // Quit by the close box (SHELL 9.4, 10.1: a click on the box of the front CWindow), back to the shell; Calculator starts at 0 again (SHELL 1: nothing kept).
  let nQuit = 0;
  const wasShell = () => L.shellUp(env) && m.ram[S.K_PROG] === 0;
  const relaunch = (how) => {
    const ok = L.launchByDoubleClick(env, 1); env.frames_(8);
    sec.ok(ok, () => `${how}: Calculator did not start again from the shell (K_PROG ${m.ram[S.K_PROG]})`);
    model.key(99); trail.length = 0;                                             // a fresh Calculator is in the "C" state
    check(`Calculator launched again after ${how}`);
  };
  for (const s2 of '47*') byKey(s2.charCodeAt(0));
  {
    const ok = L.quitByCloseBox(env, 1); env.frames_(8); nQuit++;
    sec.ok(ok && wasShell(), () => `close box: back to the shell: ${ok}, K_PROG ${m.ram[S.K_PROG]}`);
    relaunch('the close box');
  }
  for (const s2 of '9+') byKey(s2.charCodeAt(0));
  {
    const ok = L.quitBySSQ(env); env.frames_(8); nQuit++;
    sec.ok(ok && wasShell(), () => `SYMBOL SHIFT + Q: back to the shell: ${ok}, K_PROG ${m.ram[S.K_PROG]}`);
    relaunch('SYMBOL SHIFT + Q');
  }
  // the close box pressed with the pointer moved out and released outside does not close (SHELL 10.1 tracking: E_UP closes only when pressed); then in, release in: closes
  {
    const b = L.closeBoxOf(L.WIN.x, L.WIN.y, L.WIN.w), cx = b.x + 7, cy = b.y + 3;
    L.moveTo(env, cx, cy); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, cx, cy + 40); env.frames_(2); m.mouse.buttons = L.MOUSE_UP; env.frames_(10);
    sec.ok(m.ram[S.K_PROG] === 1 && L.progUp(env, 1), () => `close box pressed, moved out and released outside: K_PROG ${m.ram[S.K_PROG]} (still Calculator wanted)`);
    check('after a close box press released outside');
    byKey(55);
    const ok = L.quitByCloseBox(env, 1); env.frames_(8); nQuit++;
    sec.ok(ok && wasShell(), () => `close box after the aborted press: back to the shell: ${ok}`);
    relaunch('the close box again');
  }
  sec.end(`${nKey} typed inputs, ${nClick} clicks, ${nMenu} presses on the empty menu bar, ${nQuit} quits to the shell, ${screens} screens compared; ${env.frames} frames run`);
}

// ===========================================================================================================================
// 5. Banking ------------------------------------------------------------------------------------------------------------------
if (ONLY.includes(5)) {
  const sec = new Sec('5 banking: the memory watch of BANKING 10.7, the RAM image, V_FRAMES');
  for (const env of envs) {
    const { m, S, w, vf, wr, load } = env;
    if (env.label === 'direct calls' && NOWATCH) { console.log('  (memory watch off for the direct-call machine: --nowatch)'); }
    else sec.ok(w.n === 0, () => `${env.label}: memory watch: ${w.summary()}`);
    sec.ok(wr.n === 0, () => `${env.label}: ${wr.n} write(s) to $C000-$${(S.C_WIN - 1).toString(16).toUpperCase()} (the image outside Calculator's variables), first: ${wr.first.join('; ')}`);
    // the constant part of the image (class, thunk, title, strings, menu table) is as the cartridge holds it
    const img = load.mem.subarray(S.C_IMG, S.C_IMG + S.C_IMG_LEN);
    let bad = -1; for (let i = 0; i < S.C_WIN - S.C_IMG_ADDR; i++) if (m.ram[S.C_IMG_ADDR + i] !== img[i]) { bad = i; break; }
    sec.ok(bad < 0, () => `${env.label}: RAM image byte ${bad} (${hex(S.C_IMG_ADDR + bad)}) is ${hex(m.ram[S.C_IMG_ADDR + bad], 2)}, the cartridge has ${hex(img[bad], 2)}`);
    if (env.label !== 'direct calls') {
      sec.ok(vf.started && vf.checked > 50, () => `${env.label}: only ${vf.checked} frames checked`);
      sec.ok(vf.bad === 0, () => `${env.label}: V_FRAMES did not rise by 1 on ${vf.bad} of ${vf.checked} frames, first: ${vf.first}`);
    }
  }
  const tot = envs.filter((e) => e.w.accA !== undefined).reduce((a, e) => ({ accA: a.accA + e.w.accA, codeA: a.codeA + e.w.codeA, accR: a.accR + e.w.accR, frames: a.frames + e.vf.checked }), { accA: 0, codeA: 0, accR: 0, frames: 0 });
  sec.end(`${envs.length} machines; ${tot.accA} accesses to $4000-$7FFF under A (${tot.codeA} by A code reading itself or the far call), ${tot.accR} to $C000-$DFFF under R; ${tot.frames} frames with V_FRAMES checked`);
}

C.done();
