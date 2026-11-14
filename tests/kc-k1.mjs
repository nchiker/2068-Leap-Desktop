"use strict";
// kc-k1.mjs -- Key Caps (program 2, docs/KEYCAPS.md) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  Test plan: KEYCAPS 5.
// Written from KEYCAPS.md 1-4 and 7 (the TS2068 layout) and APPLIB.md; src/apps/keycaps.asm was read only for symbol names.  The reference is tests/kc-model.mjs (the labels from KEYMAP read out of the cartridge, the plane
// shown P, the status text, the pixels with LOOK's macWindowLook); the harness is tests/kc-lib.mjs (on tests/calc-lib.mjs).
//   node tests/kc-k1.mjs [--seed N] [--nkeys N] [--nradio N] [--only LIST] [--verbose]
//     --nkeys N    random key presses in group 3 on top of the exhaustive ones (default 60)
//     --nradio N   random radio actions (mouse and keys) in group 5 (default 80)
//     --only LIST  groups: 1 window as opened, 2 every key alone in each plane, 3 shifts over a radio's plane, 4 radios (mouse, keys), 5 mode 1 (one frame, only the changed caps),
//                  6 covering window, 7 quit (close box, SS+Q) and relaunch, 8 bounds (KEYCAPS 4) (default all)
// Exit code 1 on any failure.  The last line is "kc-k1: N of M groups pass".
import { checks } from './lib.mjs';
import * as KL from './kc-lib.mjs';
import * as H from './shell-lib.mjs';

const { L, K, hex, rd16 } = KL;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1), NKEYS = argNum('--nkeys', 60), NRADIO = argNum('--nradio', 80);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const C = checks('kc-k1');
const FRAME_T = 58688;
const SETTLE = 24;                                          // frames after an input before the screen is compared (a plane change redraws the 42 caps over about 12 frames, KEYCAPS 7; SPACE on a focused radio adds the radio and the status line)
console.log(`seed ${SEED} (rerun with --seed ${SEED}); random keys ${NKEYS}, random radio actions ${NRADIO}`);

const groupsOk = [];
class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.notes = []; }
  ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 40 : 6)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  note(s) { if (!this.notes.includes(s) && this.notes.length < 10) this.notes.push(s); }
  end(extra = '') {
    groupsOk.push(this.nf === 0);
    C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : '');
    for (const s of this.notes) console.log(`  note: ${s}`);
  }
}
const rows = [];
const row = (name, measured, bound, note = '') => {
  const status = bound === null ? 'reported' : measured <= bound ? 'pass' : 'MISSED';
  rows.push({ name, measured, bound, status });
  const f = (n) => (typeof n === 'number' ? n.toLocaleString('en') : String(n));
  C.check(`${name}: measured ${f(measured)}, bound ${bound === null ? 'report' : '<= ' + f(bound)}${note ? ' (' + note + ')' : ''}`, status !== 'MISSED');
};

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A machine with Key Caps running (launched through the shell), the pointer parked off the keyboard, the stack and image-write watches armed.
function mkKC(opts = {}) {
  const env = L.bootDesk5({ prog: 2, settle: 36, ...opts }), { m, S } = env;
  KL.needKC(S);
  env.keymap = KL.readKeymap(env);
  L.moveTo(env, 500, 185); env.frames_(4);
  env.sim = new K.KCSim(env.keymap);
  env.stack = KL.watchStack(m);
  // the RAM image (KEYCAPS: $C000 .. AL_RAM): written only in Key Caps' variables (KC_STAT .. KC_K) and in AL_RAM (the library's)
  env.img = { n: 0, first: [], armed: true, lo: S.KC_STAT, hi: S.KC_K + 1 };
  const w0 = m.bus.write;
  m.bus.write = function (addr, v) {
    const a = addr & 0xFFFF;
    if (env.img.armed && a >= 0xC000 && a < 0xC400 && (a < env.img.lo || a >= env.img.hi) && a < S.AL_RAM) { env.img.n++; if (env.img.first.length < 8) env.img.first.push(`${hex(a)} <- ${hex(v, 2)}, PC ${hex(m.cpu.pc)}`); }
    w0(addr, v);
  };
  return env;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setStr = (s) => JSON.stringify([...s].sort((a, b) => a - b));

/** The machine against the model after the frames have run: flags, focus, status, keys down, the plane (P and the keys drawn), the screen.  Returns true when all hold. */
function check(env, sec, what, opts = {}) {
  const { m, S } = env, sim = env.sim, st = KL.readKC(env);
  if (!sec.ok(!!st, () => `${what}: Key Caps' window is not on the desk`)) return false;
  let good = true;
  const t = (c, msg) => { good = sec.ok(c, msg) && good; };
  t(same(st.flags, sim.flags), () => `${what}: radio flags ${st.flags.map((f) => hex(f, 2))}, model ${sim.flags.map((f) => hex(f, 2))}`);
  if (!opts.noFocus) t(st.focus === sim.focus, () => `${what}: focused radio ${st.focus}, model ${sim.focus}`);
  t(st.status === sim.status, () => `${what}: status "${st.status}", model "${sim.status}"`);
  t(setStr(st.down) === setStr(sim.down), () => `${what}: K_NOW keys ${[...st.down]}, held ${[...sim.down]}`);
  t(st.plane === sim.plane, () => `${what}: plane from K_MODS and the radio ${st.plane}, model P ${sim.plane}`);
  t(m.ram[S.K_CAPS] === sim.caps && m.ram[S.K_KPMODE] === sim.kp, () => `${what}: K_CAPS ${m.ram[S.K_CAPS]} / K_KPMODE ${m.ram[S.K_KPMODE]}, model ${sim.caps} / ${sim.kp}`);
  t(m.ram[S.KC_P] === sim.plane, () => `${what}: KC_P ${m.ram[S.KC_P]}, model P ${sim.plane}`);
  const kd = Array.from(m.ram.subarray(S.K_NOW, S.K_NOW + 8)), dn = Array.from(m.ram.subarray(S.KC_DOWN, S.KC_DOWN + 8));
  t(same(kd, dn), () => `${what}: KC_DOWN ${dn} is not K_NOW ${kd} after the frames`);
  const g = sim.screen(opts.covers ? { covers: opts.covers, active: false, focus: st.focus } : {});        // behind a cover the focus is the kernel's own business: read from the machine
  const d = KL.diffDisp(KL.readDisp(m), K.toDisp(g), L.pointerMask(m, S, opts.extra || []));
  t(d === null, () => `${what}: the screen: ${d}`);
  return good;
}
/** Hold the matrix keys `ks`, the model told, settle, check; release, settle, check.  Returns the model's typed codes. */
function press(env, sec, what, ks, opts = {}) {
  const { m, sim } = env, hf = opts.hold ?? SETTLE;
  const codes = sim.hold(ks);
  L.setKeys(m, ks); env.frames_(hf);
  check(env, sec, `${what} held`, opts);
  sim.hold([]); L.setKeys(m, []); env.frames_(hf);
  check(env, sec, `${what} released`, opts);
  return codes;
}
const keyOf = (name) => K.kOf(name);

// ===========================================================================================================================================
// 1. The window as opened
function g1() {
  const env = mkKC(), { m, S } = env;
  const sec = new Sec('1 the window as opened (KEYCAPS 1, 3): the CWindow (32, 24, 448, 160) id 255 "Key Caps", the three radios at y 40, the keyboard (40, 54, 432, 102) of class KeyCaps, the status line (48, 162) "Press a key."; screen = the model; P = 0');
  const v = KL.kcViews(env);
  sec.ok(L.progUp(env, 2), () => `K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))}`);
  sec.ok(!!v, 'the window is open');
  if (v) {
    const w = v.win;
    sec.ok([w.x, w.y, w.w, w.h, w.id, w.flags].join() === '32,24,448,160,255,0' && w.cls === S.CL_CWindow, () => `window ${[w.x, w.y, w.w, w.h, w.id, w.flags]} class ${hex(w.cls)}`);
    sec.ok(v.kids.length === 5, () => `${v.kids.length} children, want 5 (3 radios, the keyboard, the status line)`);
    const want = [[48, 40, 96, 9, 0x19, 1, 'Plain'], [160, 40, 120, 9, 0x11, 2, 'Caps Shift'], [296, 40, 136, 9, 0x11, 3, 'Symbol Shift']];
    v.radios.forEach((r, i) => {
      const w = want[i];
      sec.ok([r.x, r.y, r.w, r.h, r.flags, r.id].join() === w.slice(0, 6).join() && KL.readStrText(m, rd16(m, r.a + S.Check_text)) === w[6], () => `radio ${i}: ${[r.x, r.y, r.w, r.h, hex(r.flags, 2), r.id]} "${KL.readStrText(m, rd16(m, r.a + S.Check_text))}", want ${w}`);
    });
    sec.ok(v.radios.length === 3, () => `${v.radios.length} Checks`);
    sec.ok(!!v.kb && [v.kb.x, v.kb.y, v.kb.w, v.kb.h, v.kb.flags, v.kb.id].join() === '40,54,432,102,0,4' && v.kb.cls === S.CL_KeyCaps, () => `keyboard ${v.kb && [v.kb.x, v.kb.y, v.kb.w, v.kb.h, v.kb.flags, v.kb.id]} class ${v.kb && hex(v.kb.cls)}`);
    sec.ok(!!v.lbl && [v.lbl.x, v.lbl.y, v.lbl.w, v.lbl.h, v.lbl.flags, v.lbl.id].join() === '48,162,400,9,0,5' && KL.readStrText(m, rd16(m, v.lbl.a + S.Label_text)) === 'Press a key.', () => `status ${v.lbl && [v.lbl.x, v.lbl.y, v.lbl.w, v.lbl.h, v.lbl.flags, v.lbl.id]} "${v.lbl && KL.readStrText(m, rd16(m, v.lbl.a + S.Label_text))}"`);
    sec.ok(rd16(m, S.K_FOCUS) === v.radios[0].a, () => `K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, the Plain radio is ${hex(v.radios[0].a)}`);
  }
  // the labels: KEYMAP read out of the cartridge against the names table (every code is 0, printable, or has a name)
  const km = env.keymap; let odd = [];
  for (let i = 0; i < 120; i++) { const c = km[i]; if (!(c === 0 || (c >= 33 && c <= 126) || K.NAMES[c])) odd.push([i, c]); }
  sec.ok(odd.length === 0, () => `KEYMAP codes with no label rule (not 0, not 33-126, not in the names table): ${JSON.stringify(odd)}`);
  sec.ok(km[K.kOf('Q') + 80] === 17 && km[K.kOf('E') + 80] === 18 && km[K.kOf('1') + 40] === 14, () => `KEYMAP: SS+Q ${km[K.kOf('Q') + 80]}, SS+E ${km[K.kOf('E') + 80]}, CS+1 ${km[K.kOf('1') + 40]}`);
  // KEYCAPS 7: the layout's own numbers (five rows, 42 caps, two CAPS SHIFTs, BREAK as k 40), and the SPACE bar's label in each plane
  sec.ok(K.CAPS.length === 42 && K.CAPS.filter((c) => c.k === 0).length === 2 && K.CAPS.filter((c) => c.k === 40).length === 1 && K.CAPS.every((c) => c.k >= 0), () => `the model's caps: ${K.CAPS.length}`);
  sec.ok([0, 1, 2].map((p) => K.capLabel(km, p, K.KSPACE)).join() === 'Space,Brk,Space' && K.capLabel(km, 0, K.KBREAK) === 'Brk' && K.capLabel(km, 2, K.KBREAK) === 'Brk', () => `SPACE bar labels ${[0, 1, 2].map((p) => K.capLabel(km, p, K.KSPACE))}, want Space, Brk, Space`);
  const labs = [0, 1, 2].map((p) => K.CAPS.map((c) => K.capLabel(km, p, c.k)));
  sec.note(`labels, plane 0: ${labs[0].join(' ')}`); sec.note(`labels, plane 1: ${labs[1].join(' ')}`); sec.note(`labels, plane 2: ${labs[2].join(' ')}`);
  check(env, sec, 'as opened', {});
  sec.ok(m.ram[S.KC_P] === 0, () => `P at the start ${m.ram[S.KC_P]}`);
  // idle frames change nothing, and write nothing to the display
  const w = KL.watchDisplay(m); env.frames_(10); const wr = w.stop();
  sec.ok(wr.size === 0, () => `10 idle frames wrote ${wr.size} display bytes`);
  // a status of 3-digit codes: the model's text for every code that exists is checked in group 2; here the text rule itself
  sec.ok(K.statusFor(113) === 'Last key: q (code 113)' && K.statusFor(14) === 'Last key: Tab (code 14)', 'the model: status text');
  sec.end(`opened in ${env.bootFrames} + settle frames; stack so far ${env.stack.depth()} bytes`);
  return env;
}

// ===========================================================================================================================================
// 2. Every key alone in each plane: plane 0 the key alone, plane 1 CAPS SHIFT + the key, plane 2 SYMBOL SHIFT + the key; then, with the Caps Shift and the Symbol Shift radios checked, the key alone.
function g2() {
  const env = mkKC();
  const sec = new Sec('2 every key held alone: plain, with CAPS SHIFT, with SYMBOL SHIFT (the 38 non-shift keys in each, the shift keys alone), then alone again with each radio checked: caps, P, status, focus and the screen after each (held and released)');
  let n = 0, quitKey = 0;
  const skip = (ks) => ks.includes(K.KSS) && ks.includes(keyOf('Q'));        // SS+Q is CLOSE: it quits (group 7)
  const plan = (label, list) => { for (const ks of list) { if (skip(ks)) { quitKey++; continue; } press(env, sec, `${label} ${ks.map((k) => K.KEYNAMES[k]).join('+')}`, ks); n++; } };
  const all = [...Array(40).keys()], nonShift = all.filter((k) => k !== K.KCS && k !== K.KSS);
  plan('plain', all.map((k) => [k]));                                               // the shift keys alone: P changes, no event
  plan('CAPS SHIFT', nonShift.map((k) => [K.KCS, k]));
  plan('SYMBOL SHIFT', nonShift.map((k) => [K.KSS, k]));
  // both shifts held together with no other key toggle keyboard-pointer mode (OBJECTS_EVENTS 14.4: nothing typed); P is 1 (CAPS SHIFT first); twice, so that the mode is off again
  press(env, sec, 'CS+SS (mode on)', [K.KCS, K.KSS]); press(env, sec, 'CS+SS (mode off)', [K.KCS, K.KSS]); n += 2;
  // both shifts and a key: no mode toggle; the key is typed in the SS plane (SS before CS), P is 1
  for (const nm of ['A', '1', 'M', 'T', '9']) { press(env, sec, `CS+SS+${nm}`, [K.KCS, K.KSS, keyOf(nm)]); n++; }
  // caps lock (CS+2: no event): the plain letters are upper case while it is on; the shifted planes are as before
  press(env, sec, 'CS+2 (caps lock on)', [K.KCS, keyOf('2')]); n++;
  for (const nm of ['Q', 'A', 'Z', '1', 'ENTER']) { press(env, sec, `caps lock on, ${nm}`, [keyOf(nm)]); n++; }
  press(env, sec, 'caps lock on, CS+Q', [K.KCS, keyOf('Q')]); press(env, sec, 'caps lock on, SS+A', [K.KSS, keyOf('A')]); n += 2;
  press(env, sec, 'CS+2 (caps lock off)', [K.KCS, keyOf('2')]); n++;
  // the radios checked in turn (by the mouse, through the model), every key alone: the caps show the radio's plane, the code is the plain key's
  for (const r of [1, 2]) {
    clickRadio(env, sec, r);
    plan(`radio ${r} checked,`, nonShift.map((k) => [k]).filter((ks) => ks[0] !== keyOf('SPACE')));
    clickRadio(env, sec, 0);
  }
  sec.end(`${n} key sets held and released; ${quitKey} (SS+Q) left to group 7; stack ${env.stack.depth()} bytes`);
  return env;
}

// The Key Caps window's radio r checked by a click through the model.
function clickRadio(env, sec, r, what = `click radio ${r}`) {
  const R = K.RADIOS[r], x = R.x + 10, y = R.y + 4, sim = env.sim;
  L.moveTo(env, x, y); env.frames_(2);
  sim.point(K.E.DOWN, x, y); env.m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
  check(env, sec, `${what}: pressed`, { extra: [[x, y]] });
  sim.point(K.E.UP, x, y); env.m.mouse.buttons = L.MOUSE_UP; env.frames_(SETTLE);
  check(env, sec, `${what}: released`, { extra: [[x, y]] });
  L.moveTo(env, 500, 185); env.frames_(4);
}

// ===========================================================================================================================================
// 3. CAPS SHIFT and SYMBOL SHIFT held while a radio shows another plane, and the random keys on top
function g3() {
  const env = mkKC(), { m, S } = env, sim = env.sim;
  const sec = new Sec('3 the shifts held over each radio\'s plane (CAPS SHIFT wins over SYMBOL SHIFT; the radio\'s plane comes back on release), the keys of the shifted planes with the keyboard in a third plane, random keys');
  for (const r of [0, 1, 2]) {
    if (r) clickRadio(env, sec, r);
    for (const ks of [[K.KCS], [K.KSS], [K.KCS, K.KSS], [K.KCS, K.KSS], [K.KSS, keyOf('A')], [K.KCS, keyOf('7')]]) press(env, sec, `radio ${r}, hold ${ks.map((k) => K.KEYNAMES[k]).join('+')}`, ks);   // CS+SS twice: keyboard-pointer mode on, then off
    // one shift held for a long time: P stays, the others' keys come and go (the keyboard stays in the shifted plane)
    sim.hold([K.KCS]); L.setKeys(m, [K.KCS]); env.frames_(SETTLE); check(env, sec, `radio ${r}, CS held`);
    for (const k of [keyOf('Q'), keyOf('M'), keyOf('0')]) {
      sim.hold([K.KCS, k]); L.setKeys(m, [K.KCS, k]); env.frames_(SETTLE); check(env, sec, `radio ${r}, CS held, then ${K.KEYNAMES[k]} too`);
      sim.hold([K.KCS]); L.setKeys(m, [K.KCS]); env.frames_(SETTLE); check(env, sec, `radio ${r}, CS held, ${K.KEYNAMES[k]} released`);
    }
    sim.hold([]); L.setKeys(m, []); env.frames_(SETTLE); check(env, sec, `radio ${r}, all released`);
    sim.hold([K.KSS]); L.setKeys(m, [K.KSS]); env.frames_(SETTLE); check(env, sec, `radio ${r}, SS held`);
    sim.hold([K.KSS, K.KCS]); L.setKeys(m, [K.KSS, K.KCS]); env.frames_(SETTLE); check(env, sec, `radio ${r}, SS held, then CS too (P 1; keyboard-pointer mode on)`);
    sim.hold([K.KSS]); L.setKeys(m, [K.KSS]); env.frames_(SETTLE); check(env, sec, `radio ${r}, CS released, SS still held (P 2)`);
    sim.hold([]); L.setKeys(m, []); env.frames_(SETTLE); check(env, sec, `radio ${r}, SS released`);
    press(env, sec, `radio ${r}, CS+SS (keyboard-pointer mode off again)`, [K.KCS, K.KSS]);
    sec.ok(sim.kp === 0, 'the model: keyboard-pointer mode is off');
  }
  clickRadio(env, sec, 0);
  // random sets of keys: up to three keys, with and without a shift
  const nonShift = [...Array(40).keys()].filter((k) => k !== K.KCS && k !== K.KSS && k !== keyOf('SPACE'));
  for (let i = 0; i < NKEYS; i++) {
    const ks = []; const sh = rng.pick([[], [], [K.KCS], [K.KSS], [K.KCS, K.KSS]]); ks.push(...sh);
    for (let j = rng.int(1, 3); j > 0; j--) { const k = rng.pick(nonShift); if (!ks.includes(k)) ks.push(k); }
    if (ks.includes(K.KSS) && ks.includes(keyOf('Q'))) continue;
    // several keys typed in one frame: the order of their events is the kernel's (a matrix scan), so only the keys down, P and the caps are judged, not the status
    const typed = ks.filter((k) => k !== K.KCS && k !== K.KSS);
    if (typed.length > 1) {
      L.setKeys(m, ks); env.frames_(3 * SETTLE);                    // up to three events in a frame: each redraws the status line and may move the focus
      const st = KL.readKC(env);
      sec.ok(setStr(st.down) === setStr(new Set(ks)), () => `keys ${ks.map((k) => K.KEYNAMES[k])}: K_NOW ${[...st.down]}`);
      sim.down = new Set(ks); sim.status = st.status; sim.tree.resetLog(); sim.caps = m.ram[S.K_CAPS];
      // the radios may have moved by a TAB-like code among the keys: take the focus and the checked radio from the machine
      sim.radios.forEach((r, ri) => { r.flags = st.flags[ri]; }); sim.tree.focus = st.focus >= 0 ? sim.radios[st.focus] : null;
      check(env, sec, `random ${ks.map((k) => K.KEYNAMES[k]).join('+')}`);
      sim.hold([]); L.setKeys(m, []); env.frames_(SETTLE);
      sim.radios.forEach((r, ri) => { r.flags = KL.readKC(env).flags[ri]; });
      sim.caps = m.ram[S.K_CAPS];
      check(env, sec, `random ${ks.map((k) => K.KEYNAMES[k]).join('+')} released`);
    } else press(env, sec, `random ${ks.map((k) => K.KEYNAMES[k]).join('+')}`, ks);
  }
  sec.end(`stack ${env.stack.depth()} bytes`);
  return env;
}

// ===========================================================================================================================================
// 4. The radios by mouse and by keys (TOOLKIT 9 behaviour: a click, or SPACE on the focused one, checks it; E_CMD id 1-3 sets the plane)
function g4() {
  const env = mkKC(), { m } = env, sim = env.sim;
  const sec = new Sec('4 the radios: clicks, a press dragged out and back, a press released outside, a click beside a radio, TAB / BACKTAB / arrows moving the focus, SPACE checking the focused radio; the keyboard follows the checked radio');
  for (const r of [1, 2, 0, 2, 1, 1, 0]) clickRadio(env, sec, r);
  // the whole row: a click on the label text (x + 60), at the first and the last pixel column and row of the rectangle, and one pixel outside
  for (const [r, dx, dy, inside] of [[1, 60, 4, true], [2, 0, 0, true], [2, 135, 8, true], [0, 95, 8, true], [1, -1, 4, false], [1, 120, 4, false], [2, 50, -1, false], [2, 50, 9, false]]) {
    const R = K.RADIOS[r], x = R.x + dx, y = R.y + dy;
    L.moveTo(env, x, y); env.frames_(2);
    sim.point(K.E.DOWN, x, y); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(4);
    check(env, sec, `press on radio ${r} at (${dx}, ${dy}) ${inside ? 'inside' : 'outside'}`, { extra: [[x, y]] });
    sim.point(K.E.UP, x, y); m.mouse.buttons = L.MOUSE_UP; env.frames_(SETTLE);
    check(env, sec, `release on radio ${r} at (${dx}, ${dy}) ${inside ? 'inside' : 'outside'}`, { extra: [[x, y]] });
  }
  L.moveTo(env, 500, 185); env.frames_(4);
  // press, drag out, release: nothing checked; press, drag out, back in, release: checked
  for (const back of [false, true, false, true]) {
    const r = rng.int(0, 2), R = K.RADIOS[r], x = R.x + 20, y = R.y + 4, ox = 400, oy = 188;                       // below the window (it ends at y 184)
    L.moveTo(env, x, y); env.frames_(2);
    sim.point(K.E.DOWN, x, y); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, ox, oy); sim.point(K.E.MOVE, ox, oy); env.frames_(4);
    check(env, sec, `drag out of radio ${r}`, { extra: [[ox, oy]] });
    if (back) { L.moveTo(env, x, y); sim.point(K.E.MOVE, x, y); env.frames_(4); check(env, sec, `drag back into radio ${r}`, { extra: [[x, y]] }); sim.point(K.E.UP, x, y); }
    else sim.point(K.E.UP, ox, oy);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(SETTLE);
    check(env, sec, `release ${back ? 'inside' : 'outside'} after a drag on radio ${r}`, { extra: [[x, y], [ox, oy]] });
    L.moveTo(env, 500, 185); env.frames_(4);
  }
  // by keys: the codes of TAB (CS+1), BACKTAB (CS+3), LEFT / RIGHT / UP / DOWN (CS+5, 8, 7, 6), SPACE (SPACE); each typed through the shifted plane, so P flickers to 1 and back
  const KEYCODES = { TAB: 14, BACKTAB: 15, LEFT: 8, RIGHT: 9, UP: 11, DOWN: 10, SPACE: 32 };
  for (const [name, c] of Object.entries(KEYCODES)) press(env, sec, `key ${name}`, L.keysFor(c));
  const seq = Object.values(KEYCODES);
  for (let i = 0; i < NRADIO; i++) {
    if (rng.chance(0.25)) clickRadio(env, sec, rng.int(0, 2), `random click ${i}`);
    else { const c = rng.pick(seq); press(env, sec, `random key ${i} (code ${c})`, L.keysFor(c)); }
  }
  // every radio can be reached and checked by keys alone: TAB to it, SPACE
  for (const target of [2, 0, 1]) {
    for (let g = 0; g < 4 && sim.focus !== target; g++) press(env, sec, `TAB to radio ${target}`, L.keysFor(14));
    press(env, sec, `SPACE on radio ${target}`, L.keysFor(32));
    sec.ok(sim.sel === target, () => `the model: radio ${target} checked, model has ${sim.sel}`);
  }
  sec.end(`${NRADIO} random actions; stack ${env.stack.depth()} bytes`);
  return env;
}

// ===========================================================================================================================================
// 5. Mode 1: a key change redraws only the changed caps, within one frame
/** A key set changing: the model told, the keys set, two frames run (the ISR sees the keys at the start of the first), traced and watched.  Returns what happened. */
function keyChange(env, next) {
  const { m, S } = env, sim = env.sim, kb = KL.kcViews(env).kb.a, lbl = KL.kcViews(env).lbl.a;
  const prev = [...sim.down];
  const tr = KL.traceLoop(env), wd = KL.watchDisplay(m);
  const typed = sim.hold(next);
  L.setKeys(m, next);
  env.frame();
  const d1 = KL.diffDisp(KL.readDisp(m), K.toDisp(sim.screen()), (() => { const mk = L.pointerMask(m, S); for (const b of KL.rectBytes(K.STAT.x, K.STAT.y, K.STAT.w, K.STAT.h)) mk[b] = 0; return mk; })());
  env.frame();
  const d2 = KL.diffDisp(KL.readDisp(m), K.toDisp(sim.screen()), L.pointerMask(m, S));
  env.frames_(1 + 2 * typed.length);                    // each typed code redraws the status line: the last frames finish them
  const dEnd = KL.diffDisp(KL.readDisp(m), K.toDisp(sim.screen()), L.pointerMask(m, S));
  const ev = tr.stop(), wr = wd.stop(), per = KL.periodsOf(ev)[0];
  const changed = K.changedCaps(new Set(prev), new Set(next));                 // the caps whose pressed state differs (KEYCAPS 7: both CAPS SHIFT caps for k 0, BREAK for 0 with 35)
  return { typed, d1, d2, dEnd, wr, per, kbDraws: per ? per.draws.filter((d) => d.ix === kb) : [], lblDraws: per ? per.draws.filter((d) => d.ix === lbl) : [], changed };
}
function g5() {
  const env = mkKC(), { m, S } = env, sim = env.sim;
  const sec = new Sec('5 mode 1 (KEYCAPS 3): a key going down / up in the same plane redraws only the changed caps (display writes only inside their pressed fills (x+1, y+1, w-2, h-2) and the status line), through one W_DRAWVIEW of the keyboard that returns before the next frame interrupt, with the screen complete outside the status line after the first frame and in full after the second; nothing is drawn when nothing changes');
  const statBytes = KL.rectBytes(K.STAT.x, K.STAT.y, K.STAT.w, K.STAT.h);
  const down = [], up = [], capD = [], capDone = [], statD = [];
  const cases = [['Q'], ['1'], ['0'], ['A'], ['ENTER'], ['M'], ['P'], ['Z'], ['6'], ['T'], ['Q', 'W'], ['Y', 'H', 'N']];
  for (const names of cases) {
    const ks = names.map(keyOf);
    for (const dir of ['down', 'up']) {
      const r = keyChange(env, dir === 'down' ? ks : []);
      const allowed = new Set(statBytes);
      for (const c of r.changed) { const f = K.fillRect(c); for (const b of KL.rectBytes(f.x, f.y, f.w, f.h)) allowed.add(b); }
      const bad = [...r.wr].filter((b) => !allowed.has(b));
      const tag = `${names} ${dir}`;
      sec.ok(bad.length === 0, () => `${tag}: ${bad.length} display byte(s) written outside the changed caps' fills and the status line, first (y ${bad[0] >> 6}, byte col ${bad[0] & 63})`);
      let capBytes = 0; for (const c of r.changed) { const f = K.fillRect(c); for (const b of KL.rectBytes(f.x, f.y, f.w, f.h)) if (r.wr.has(b)) capBytes++; }
      sec.ok(capBytes > 0, () => `${tag}: no write inside the changed cap(s)`);
      sec.ok(r.d1 === null, () => `${tag}: outside the status line, the screen after the first frame: ${r.d1}`);
      if (r.changed.length === 1) sec.ok(r.d2 === null, () => `${tag}: the screen after the second frame: ${r.d2}`);
      sec.ok(r.dEnd === null, () => `${tag}: the screen after the frames it takes: ${r.dEnd}`);
      sec.ok(!!r.per && r.kbDraws.length === 1, () => `${tag}: ${r.kbDraws.length} W_DRAWVIEW(s) of the keyboard in the frame's busy period`);
      if (r.per && r.kbDraws.length === 1) {
        const kd = r.kbDraws[0], done = kd.t1 - r.per.t0;
        if (r.changed.length === 1) sec.ok(done < FRAME_T, () => `${tag}: the keyboard's redraw ends ${done} T after the interrupt, past the frame (${FRAME_T})`);
        else sec.note(`${tag} (${r.changed.length} caps in one frame): the keyboard's redraw takes ${(kd.t1 - kd.t0).toLocaleString('en')} T and ends ${done.toLocaleString('en')} T after the interrupt (${FRAME_T} per frame)`);
        if (r.changed.length === 1) { capD.push(kd.t1 - kd.t0); capDone.push(done); (dir === 'down' ? down : up).push(r.per.t1 - r.per.t0); }
        if (dir === 'down') { sec.ok(r.lblDraws.length === r.typed.length, () => `${tag}: ${r.lblDraws.length} W_DRAWVIEW(s) of the status line, want ${r.typed.length} (one a typed code)`); if (r.lblDraws[0] && r.changed.length === 1) statD.push(r.lblDraws[0].t1 - r.lblDraws[0].t0); }
        else sec.ok(r.lblDraws.length === 0, () => `${tag}: the status line was redrawn on a key release`);
      }
      // nothing changes: nothing is drawn (a key held steady repeats only after 30 frames)
      const w2 = KL.watchDisplay(m); env.frames_(8); const wr2 = w2.stop();
      sec.ok(wr2.size === 0, () => `${tag}: ${wr2.size} display bytes written in 8 frames with no change`);
    }
  }
  // a plane change redraws the whole keyboard (several frames): frames until the screen equals the model, and the busy time
  const planeFrames = [];
  for (const sh of [K.KCS, K.KSS]) {
    for (const dir of ['down', 'up']) {
      const tr = KL.traceLoop(env);
      sim.hold(dir === 'down' ? [sh] : []); L.setKeys(m, dir === 'down' ? [sh] : []);
      let fr = 0, ok = false;
      for (; fr < 30; fr++) { env.frame(); if (KL.diffDisp(KL.readDisp(m), K.toDisp(sim.screen()), L.pointerMask(m, S)) === null) { ok = true; fr++; break; } }
      const per = KL.periodsOf(tr.stop())[0];
      sec.ok(ok, () => `${K.KEYNAMES[sh]} ${dir}: the screen is not complete after 30 frames`);
      planeFrames.push([K.KEYNAMES[sh] + ' ' + dir, fr, per ? per.t1 - per.t0 : 0]);
      env.frames_(6);
    }
  }
  check(env, sec, 'after the plane changes');
  env.f5 = { down, up, capD, capDone, statD, planeFrames };
  const mx = (a) => Math.max(...a).toLocaleString('en');
  sec.end(`${down.length + up.length} timed changes: keyboard W_DRAWVIEW max ${mx(capD)} T, ends within ${mx(capDone)} T of the interrupt; busy period (ISR to HALT) key down max ${mx(down)} T (status line draw max ${mx(statD)} T), key up max ${mx(up)} T; plane changes (frames until complete, busy T): ${planeFrames.map(([n, f, t]) => `${n} ${f} fr ${t.toLocaleString('en')} T`).join('; ')}`);
  return env;
}

// ===========================================================================================================================================
// 6. A covering window moved over the keyboard (W_DRAWVIEW through the kernel's clipping)
/** A routine of the kernel called under K while Key Caps runs: its stack below the program's SP, its registers and mapping restored afterwards. */
function callK(env, addr, regs = {}) {
  const { m, S } = env, cpu = m.cpu, saved = { ...cpu }, f4 = m.ram[S.V_SHADOW_F4], pf4 = m.portF4;
  const top = (cpu.sp - 32) & 0xFFFF;
  for (const r of ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'xh', 'xl', 'yh', 'yl']) cpu[r] = 0;
  const P = { bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'] };
  for (const [k, v] of Object.entries(regs)) { if (P[k]) { cpu[P[k][0]] = (v >> 8) & 0xFF; cpu[P[k][1]] = v & 0xFF; } else cpu[k] = v & 0xFF; }
  m.ram[S.V_SHADOW_F4] = L.F4K; m.portF4 = L.F4K;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = false;
  cpu.sp = top - 2; m.ram[top - 2] = S.T_RET & 0xFF; m.ram[top - 1] = S.T_RET >> 8; cpu.pc = addr;
  let steps = 0;
  while (cpu.pc !== S.T_RET) { L.Z.runZ80(cpu, m.bus, 1, m); if (++steps > 5_000_000) throw new Error(`callK ${hex(addr)}: no return`); }
  const out = { xh: cpu.xh, xl: cpu.xl, carry: cpu.f & 1 };
  Object.assign(cpu, saved); m.ram[S.V_SHADOW_F4] = f4; m.portF4 = pf4;
  return out;
}
function g6() {
  const env = mkKC(), { m, S } = env, sim = env.sim;
  const sec = new Sec('6 a covering Window dragged over the keyboard by its title bar and away again: the screen against the model (Key Caps inactive, the cover in front), keys going down under and beside it, the cover closed');
  // a plain Window "Cover" (192 x 16) at the bottom of the desk (it overlaps the window's last 8 rows: the desk is only 192 high), opened through the kernel's own calls
  const strAddr = 0x5C00, title = K.codesOf('Cover');
  m.ram[strAddr] = title.length; title.forEach((c, i) => { m.ram[strAddr + 1 + i] = c; });
  // the harness steps these calls instruction by instruction, which can drop a frame interrupt: V_FRAMES is judged again from the frame after
  const quiet = (fn) => { const b = env.vf.bad, f = env.vf.first, sm = env.stack.min; const r = fn(); env.frame(); env.resync(); env.vf.bad = b; env.vf.first = f; env.stack.min = sm; return r; };   // (the stack of these kernel calls, below the program's, is not Key Caps' own)
  const w = quiet(() => callK(env, S.K_NEW, { hl: S.CL_Window })), a = (w.xh << 8) | w.xl;
  sec.ok(!w.carry && a !== 0, 'K_NEW of a Window');
  const poke16 = (ad, v) => { m.ram[ad] = v & 255; m.ram[ad + 1] = v >> 8; };
  const cover = { x: 208, y: 176, w: 192, h: 16, title: 'Cover' };            // on the 16 x 8 cell grid (WINDOWS 2)
  poke16(a + S.View_x, cover.x); m.ram[a + S.View_y] = cover.y; poke16(a + S.View_w, cover.w); m.ram[a + S.View_h] = cover.h; poke16(a + S.Window_title, strAddr);
  const r = quiet(() => callK(env, S.W_OPEN, { ix: a })); sec.ok(!r.carry, 'W_OPEN of the cover');
  quiet(() => callK(env, S.W_UPDATE, {}));
  env.frames_(30);
  const covers = () => [{ ...cover }];
  const mk = () => ({ covers: covers(), extra: [] });
  check(env, sec, 'the cover opened below Key Caps', { ...mk(), noFocus: true });
  // drag the cover by its title bar: from (x + 40, y + 4) to the new window position + the same offset
  const drag = (nx, ny, what) => {
    const px = cover.x + 40, py = cover.y + 4, tx = px + (nx - cover.x), ty = py + (ny - cover.y);
    L.moveTo(env, px, py); env.frames_(2);
    m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
    L.moveTo(env, tx, ty); env.frames_(3);
    m.mouse.buttons = L.MOUSE_UP; env.frames_(SETTLE + 10);
    Object.assign(cover, { x: nx, y: ny });
    check(env, sec, what, { ...mk(), noFocus: true, extra: [[tx, ty]] });
    L.moveTo(env, 500, 186); env.frames_(4);
  };
  drag(208, 96, 'the cover over row 2 of the keyboard');
  // keys going down in the plane shown: under the cover, beside it
  for (const nm of ['Q', 'W', 'I', 'P', 'A', 'L', 'Z', 'N', '5', '8']) {
    sim.hold([keyOf(nm)]); L.setKeys(m, [keyOf(nm)]); env.frames_(SETTLE);
    check(env, sec, `${nm} down with the cover over the keyboard`, { ...mk(), noFocus: true });
    sim.hold([]); L.setKeys(m, []); env.frames_(SETTLE);
    check(env, sec, `${nm} up with the cover over the keyboard`, { ...mk(), noFocus: true });
  }
  // a plane change under the cover (the whole keyboard through W_DRAWVIEW, clipped); the frames it takes are noted
  const untilDone = (what) => {
    let fr = 0;
    for (; fr < 80; fr++) { const st = KL.readKC(env); const g = sim.screen({ covers: covers(), active: false, focus: st.focus }); if (KL.diffDisp(KL.readDisp(m), K.toDisp(g), L.pointerMask(m, S)) === null) break; env.frame(); }
    sec.note(`${what}: complete after ${fr} frames`);
    env.frames_(2);
  };
  for (const sh of [K.KCS, K.KSS]) {
    sim.hold([sh]); L.setKeys(m, [sh]); untilDone(`${K.KEYNAMES[sh]} down under the cover`); check(env, sec, `${K.KEYNAMES[sh]} down with the cover over the keyboard`, { ...mk(), noFocus: true });
    sim.hold([sh, keyOf('E')]); L.setKeys(m, [sh, keyOf('E')]); env.frames_(SETTLE); check(env, sec, `${K.KEYNAMES[sh]} + E`, { ...mk(), noFocus: true });
    sim.hold([]); L.setKeys(m, []); untilDone(`${K.KEYNAMES[sh]} up under the cover`); check(env, sec, `${K.KEYNAMES[sh]} up with the cover over the keyboard`, { ...mk(), noFocus: true });
  }
  // a key held while the cover is dragged away: the exposed caps are drawn pressed
  sim.hold([keyOf('R'), keyOf('Y')]); L.setKeys(m, [keyOf('R'), keyOf('Y')]); env.frames_(SETTLE);
  drag(48, 40, 'the cover over the radios and the top row, R and Y held');
  drag(304, 120, 'the cover over row 3 and the SPACE bar edge, R and Y held');
  sim.hold([]); L.setKeys(m, []); env.frames_(SETTLE);
  check(env, sec, 'R and Y released, cover still over the keyboard', { ...mk(), noFocus: true });
  drag(240, 176, 'the cover at the bottom of the desk again');
  // closed: Key Caps is the only window and active again
  quiet(() => callK(env, S.W_CLOSE, { ix: a })); quiet(() => callK(env, S.W_UPDATE, {})); env.frames_(30);
  sec.ok(L.openWindows(m, S).length === 1, () => `${L.openWindows(m, S).length} windows after the cover is closed`);
  check(env, sec, 'the cover closed', { noFocus: true });
  sec.end(`stack ${env.stack.depth()} bytes`);
  return env;
}

// ===========================================================================================================================================
// 7. Quitting: the close box and SS+Q return to the shell; Key Caps starts again as new
function g7() {
  const env = mkKC(), { m, S } = env, sim = env.sim;
  const sec = new Sec('7 quit: the close box and SYMBOL SHIFT + Q (CLOSE, E_CMD 255) return to the shell, nothing of Key Caps is kept (a relaunch shows "Press a key.", the Plain radio, P 0); a press that is not on the box does not quit');
  const drive = (what, how) => {
    // some state first: another radio, a key typed
    clickRadio(env, sec, rng.int(1, 2), `${what}: radio before the quit`);
    press(env, sec, `${what}: a key before the quit`, [keyOf('K')]);
    env.img.armed = false;
    const ok = how === 'box' ? L.quitByCloseBox(env, 2) : L.quitBySSQ(env);
    sec.ok(ok, () => `${what}: the shell did not come back (K_PROG ${m.ram[S.K_PROG]}, windows ${JSON.stringify(L.openWindows(m, S).map((w) => w.title))})`);
    env.frames_(20);
    const d = H.shellDiff(env); sec.ok(d === null, () => `${what}: the shell's screen: ${d}`);
    sec.ok(m.ram[S.K_PROG] === 0 && L.openWindows(m, S).length === 1, () => `${what}: K_PROG ${m.ram[S.K_PROG]}, ${L.openWindows(m, S).length} windows`);
    // relaunch (double click on its icon): fresh state
    const up = L.launchByDoubleClick(env, 2); sec.ok(up, () => `${what}: Key Caps did not start again`);
    env.frames_(36); L.moveTo(env, 500, 185); env.frames_(4);
    env.sim = new K.KCSim(env.keymap); env.img.armed = true;
    check(env, sec, `${what}: relaunched`);
    sec.ok(KL.readKC(env).status === 'Press a key.' && m.ram[S.KC_P] === 0, () => `${what}: after the relaunch status "${KL.readKC(env).status}", KC_P ${m.ram[S.KC_P]}`);
  };
  drive('close box', 'box');
  drive('SS+Q', 'ssq');
  // a press on the box's neighbours does not quit: just left of the box (x + 7), just right (x + 23), below it (y + 8)
  for (const [dx, dy] of [[7, 4], [23, 4], [15, 8], [15, 0]]) {
    const w = L.PROG_WIN[2], b = L.closeBoxOf(w.x, w.y, w.w);
    const x = w.x + dx, y = w.y + dy;
    const inBox = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    L.click(env, x, y, 3, 8); env.frames_(6);
    const here = m.ram[S.K_PROG] === 2;
    sec.ok(here === !inBox, () => `a click at (${x}, ${y}) (${inBox ? 'inside' : 'outside'} the close box ${JSON.stringify(b)}): Key Caps ${here ? 'still runs' : 'quit'}`);
    if (!here) { L.waitShell(env); L.launchByDoubleClick(env, 2); env.frames_(36); L.moveTo(env, 500, 185); env.frames_(4); env.sim = new K.KCSim(env.keymap); }
  }
  // SS+Q as the model's typed code 17: it is the CLOSE of the front CWindow, so Key Caps is the front window here
  sec.ok(env.keymap[2 * 40 + keyOf('Q')] === 17, 'KEYMAP: SS+Q is CLOSE (17)');
  sec.end(`image writes outside Key Caps' variables: ${env.img.n}; stack ${env.stack.depth()} bytes`);
  void sim;
  return env;
}

// ===========================================================================================================================================
// 8. Bounds (KEYCAPS 4)
function g8() {
  const sec = new Sec('8 the bounds of KEYCAPS 4: bytes, the image and the RAM after it below AL_RAM, the keyboard\'s M_DRAW (two caps pressed) against the model, stack');
  const env = mkKC({ watch: false }), { m, S } = env;
  const bytes = S.KC_END - S.KC_START;
  row('Key Caps\' bytes (KC_END - KC_START)', bytes, 1225, `KC_START ${hex(S.KC_START)}, KC_END ${hex(S.KC_END)}; Controls took 1,225`);
  row('Key Caps\' RAM image (KC_IMG_LEN)', S.KC_IMG_LEN, null, `${hex(S.PROG_IMG)}-${hex(S.PROG_IMG + S.KC_IMG_LEN - 1)}`);
  row('image end (PROG_IMG + KC_IMG_LEN) against AL_RAM', S.PROG_IMG + S.KC_IMG_LEN, S.AL_RAM, `AL_RAM ${hex(S.AL_RAM)}`);
  row('the last variable (KC_K + 1) against AL_RAM', S.KC_K + 1, S.AL_RAM);
  // the keyboard's M_DRAW with two caps pressed: W_DRAWVIEW of the view, direct, interrupts off, mapping K (the call crosses to DOCK 2-3 through KFAR as the kernel's draw does)
  env.frames_(6);
  const st = KL.readKC(env), kb = st.v.kb.a;
  const two = [keyOf('Q'), keyOf('M')];
  for (const k of two) m.ram[S.KC_DOWN + (k / 5 | 0)] |= 1 << (k % 5);
  L.park(env);
  const stk = KL.watchStack(m, 0xFC00), times = [];
  let thunk = 0; const r0 = m.bus.read; m.bus.read = function (a) { if ((a & 0xFFFF) === S.KC_THD && m.cpu.pc === S.KC_THD) thunk++; return r0(a); };
  for (let i = 0; i < 3; i++) times.push(L.directCall(env, S.W_DRAWVIEW, { ix: kb }, 'K'));
  m.bus.read = r0;
  const depth = stk.stop();
  row('the keyboard\'s M_DRAW (W_DRAWVIEW of the view: 42 caps, two pressed), T-states', times[0], null, `repeated ${times.join(', ')}; EST 150-250 k T; ${(times[0] / FRAME_T).toFixed(2)} frames; M_DRAW (the thunk) entered ${thunk / 3} times a W_DRAWVIEW`);
  row('stack of that call, crossings included (bytes below $FF00 minus the 2 of the sentinel return)', depth - 2, 128);
  const g = K.renderScreen({ keymap: env.keymap, flags: st.flags, focus: st.focus, status: st.status, plane: 0, down: new Set(two) });
  const d = KL.diffDisp(KL.readDisp(m), K.toDisp(g), L.pointerMask(m, S));
  sec.ok(d === null, () => `the screen after the direct M_DRAW (Q and M pressed): ${d}`);
  // the key-change redraw, on a fresh machine: ISR entry (the frame's wake from HALT) to the loop's next HALT, and the pieces
  const env2 = mkKC({ watch: false });
  env2.frames_(10);
  const idle = (() => { const t = KL.traceLoop(env2); env2.frames_(6); return KL.periodsOf(t.stop()).slice(1).map((p) => p.t1 - p.t0); })();
  const down = [], up = [], capD = [], capEnd = [], statD = [];
  for (const nm of ['Q', 'A', 'M', '5', 'P', 'Z', 'H', '0']) {
    const k = keyOf(nm);
    for (const dir of ['down', 'up']) {
      const r = keyChange(env2, dir === 'down' ? [k] : []);
      if (!r.per) continue;
      (dir === 'down' ? down : up).push(r.per.t1 - r.per.t0);
      if (r.kbDraws[0]) { capD.push(r.kbDraws[0].t1 - r.kbDraws[0].t0); capEnd.push(r.kbDraws[0].t1 - r.per.t0); }
      if (dir === 'down' && r.lblDraws[0]) statD.push(r.lblDraws[0].t1 - r.lblDraws[0].t0);
    }
  }
  const mx = (a) => Math.max(...a);
  row('the redraw after a key goes down, the frame\'s wake from HALT (ISR entry) to the loop\'s next HALT, worst of 8 keys, T-states', mx(down), null, `${down.join(', ')}; an idle frame's busy period ${mx(idle)} T; one frame is ${FRAME_T} T = ${(mx(down) / FRAME_T).toFixed(2)} frames`);
  row('  of it, the keyboard\'s W_DRAWVIEW in mode 1 (the changed cap only), worst of 8, T-states', mx(capD), null, `${capD.join(', ')}; it ends ${mx(capEnd)} T after the interrupt`);
  row('  of it, the status line\'s W_DRAWVIEW, worst of 8, T-states', mx(statD), null, statD.join(', '));
  row('the keyboard\'s redraw ends before the next frame interrupt (T after the interrupt)', mx(capEnd), FRAME_T - 1);
  row('the redraw after a key goes up (the cap only: ISR entry to HALT), worst of 8, T-states', mx(up), null, `${up.join(', ')}; ${(mx(up) / FRAME_T).toFixed(2)} frames`);
  row('the redraw after a key goes up leaves the loop halted before the next interrupt (busy < one frame)', mx(up), FRAME_T - 1);
  // the plane change: the whole keyboard, frames until the screen is complete
  { const out = []; for (const sh of [K.KCS, K.KSS]) { const tr = KL.traceLoop(env2); env2.sim.hold([sh]); L.setKeys(env2.m, [sh]); let fr = 0; for (; fr < 30; fr++) { env2.frame(); if (KL.diffDisp(KL.readDisp(env2.m), K.toDisp(env2.sim.screen()), L.pointerMask(env2.m, env2.S)) === null) { fr++; break; } } const per = KL.periodsOf(tr.stop()); out.push([K.KEYNAMES[sh], fr, per.reduce((a, p) => a + p.t1 - p.t0, 0)]); env2.sim.hold([]); L.setKeys(env2.m, []); env2.frames_(16); }
    row('the whole keyboard redrawn for a plane change (CAPS SHIFT / SYMBOL SHIFT down): frames until the screen is complete', Math.max(...out.map((o) => o[1])), null, out.map((o) => `${o[0]}: ${o[1]} frames, ${o[2].toLocaleString('en')} T of busy periods`).join('; ')); }
  // the stack over the whole of this run's other groups is checked in each group's note; and the watches
  sec.end(`direct stack ${depth - 2} bytes`);
}

// ===========================================================================================================================================
const envs = [];
const run = { 1: g1, 2: g2, 3: g3, 4: g4, 5: g5, 6: g6, 7: g7 };
for (const g of ONLY) {
  if (g === 8) { g8(); continue; }
  const e = run[g]();
  if (e) envs.push([g, e]);
}
{
  const sec = new Sec('9 memory watch (BANKING 10.7), V_FRAMES +1 on every frame run normally, no write to the RAM image outside Key Caps\' variables, the stack of every group <= 128 bytes');
  for (const [g, e] of envs) {
    sec.ok(e.w.n === 0, () => `group ${g}: memory watch: ${e.w.summary()}`);
    sec.ok(e.vf.bad === 0, () => `group ${g}: V_FRAMES did not rise by 1 on ${e.vf.bad} frames, first ${e.vf.first}`);
    sec.ok(e.img.n === 0, () => `group ${g}: ${e.img.n} write(s) to $C000-$C3FF outside ${hex(e.img.lo)}-${hex(e.img.hi - 1)}: ${e.img.first.join(' | ')}`);
    const d = e.stack.depth();
    sec.ok(d <= 128, () => `group ${g}: stack depth ${d} bytes (writes down to ${hex(e.stack.min)})`);
    sec.note(`group ${g}: stack ${d} bytes, ${e.vf.checked} frames checked`);
  }
  sec.end();
}
C.done();
console.log(`kc-k1: ${groupsOk.filter(Boolean).length} of ${groupsOk.length} groups pass`);
