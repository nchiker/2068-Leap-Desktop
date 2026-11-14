"use strict";
// tk-t3.mjs -- toolkit slice T3 (Field) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/TOOLKIT.md (1-10; section 10.4 and 10.8 items 1 and 3 are what is tested), docs/WINDOWS.md (4, 5, 7, 17) and docs/OBJECTS_EVENTS.md (5, 6, 15); never from src/kernel/tk.asm,
// tk2.asm.  The reference is tests/tk-model2.mjs (built on tk-model.mjs and gfx6-model.mjs); the harness is tests/tk-lib.mjs and tests/tk-lib2.mjs.
//   node tests/tk-t3.mjs [--seed N] [--nlook N] [--nclip N] [--ntree N] [--nev N] [--nset N] [--ndirect N] [--only LIST] [--verbose]
//     --nlook N    random Fields drawn whole by W_DRAWVIEW (default 1200)
//     --nclip N    random Fields drawn by M_DRAW under a random clip (default 800)
//     --ntree N    random windows for the editing sequences (default 40), --nev N events in each (default 60)
//     --nset N     random TK_SETTEXT calls (default 200)
//     --ndirect N  random windows for the direct M_EVENT sends (default 25)
//     --only LIST  groups: 0 model hand cases, 1 looks, 2 clips, 3 editing, 4 TK_SETTEXT, 5 direct M_EVENT, 6 hand-worked "first adjusted" and click cases on the machine,
//                  7 stack / registers / DI, 8 watch (default all)
// The last line is "tk-t3: N of M groups pass"; exit code 1 on any failure.
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import * as X from './tk-lib2.mjs';

const { L, hex, rd16 } = T;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NLOOK = argNum('--nlook', 1200), NCLIP = argNum('--nclip', 800), NTREE = argNum('--ntree', 40), NEV = argNum('--nev', 60), NSET = argNum('--nset', 200), NDIRECT = argNum('--ndirect', 25);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('tk-t3', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); looks ${NLOOK}, clips ${NCLIP}, editing ${NTREE} windows x ${NEV}, TK_SETTEXT ${NSET}, direct ${NDIRECT} windows`);

const WIN0 = { x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Looks') };
const envs = [];
const canFocus = (flags) => (flags & 7) === 1;
const text = (codes) => String.fromCharCode(...codes);

// ===========================================================================================================================
// 0. The model's own hand-worked cases
if (ONLY.includes(0)) {
  const sec = new Sec('0 model hand-worked cases (tk-model2 selfTest: section 10 worked on paper)');
  const out = [];
  const bad = M2.selfTest(false, out);
  sec.n = out.length; sec.nf = bad;
  for (const l of out) if (l.startsWith('FAIL')) sec.fails.push(l);
  sec.end(`${out.length} cases`);
}

// ===========================================================================================================================
// Random Field look parameters (10.4): any text, cap, caret, first, focus, disabled look, rectangle (w >= 16, h >= 11)
function randFieldLook() {
  const w = rng.chance(0.15) ? rng.int(16, 30) : rng.int(16, 220), h = rng.chance(0.6) ? rng.int(11, 16) : rng.int(11, 40);
  const x = rng.int(18, 494 - w), y = rng.int(19, 190 - h);
  const cap = rng.chance(0.2) ? rng.int(1, 6) : rng.int(1, 80);
  const len = rng.chance(0.1) ? 0 : rng.chance(0.15) ? cap : rng.int(0, Math.min(cap, rng.chance(0.5) ? 10 : 50));
  const buf = X.genText(rng, len, len);
  const dis = rng.chance(0.15), flags = (rng.chance(0.75) ? 1 : 0) | (dis ? 8 | (rng.chance(0.5) ? 4 : 0) : 0);
  const f = { kind: 'Field', id: 154, x, y, w, h, flags, buf, cap, caret: rng.int(0, len), first: 0 };
  if (rng.chance(0.85)) { M2.fieldAdjust(f); if (rng.chance(0.3)) { f.caret = rng.int(0, len); M2.fieldAdjust(f); } }
  else f.first = rng.int(0, len);                                         // any state the draw rules cover (first beyond the caret too)
  return f;
}
function applyField(env, node, f, mark) {
  const S = env.S, a = node.addr;
  env.bufp = mark;
  const b = T.balloc(env, f.cap + 1);
  env.m.ram[b] = f.buf.length; f.buf.forEach((c, i) => { env.m.ram[b + 1 + i] = c; });
  T.poke16(env, a + S.Field_buf, b); T.poke8(env, a + S.Field_cap, f.cap); T.poke8(env, a + S.Field_caret, f.caret); T.poke8(env, a + S.Field_first, f.first);
  T.poke8(env, a + S.View_flags, f.flags); T.setRect(env, a, f.x, f.y, f.w, f.h);
}
function singleFieldEnv() {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const node = { kind: 'Field', id: 154, x: 30, y: 30, w: 100, h: 12, flags: 1, buf: T.codesOf('Leap'), cap: 40, caret: 4, first: 0 };
  const tree = new M2.TkTree2(WIN0, [node]);
  T.buildTree(env, tree);
  return { env, node, tree, mark: env.bufp };
}
const setFocus = (env, addr) => { T.runCall(env, env.S.K_SETFOCUS, { de: 0 }, { ints: false }); if (addr) T.runCall(env, env.S.K_SETFOCUS, { de: addr }, { ints: false }); };
const describeF = (f, foc) => `Field (${f.x}, ${f.y}, ${f.w}, ${f.h}) flags ${hex(f.flags, 2)} cap ${f.cap} text ${X.show(f.buf).slice(0, 40)} (${f.buf.length}) caret ${f.caret} first ${f.first} focused ${foc}`;

// ===========================================================================================================================
// 1. Looks
if (ONLY.includes(1)) {
  const { env, node, mark } = singleFieldEnv();
  const { m, S } = env;
  const sec = new Sec('1 Field look: W_DRAWVIEW of a random Field (text, cap, caret, first, focus, disabled look, h 11..40, w 16..220) against 10.4');
  const st = { foc: 0, dis: 0, scrolled: 0, long: 0, empty: 0, full: 0, oddH: 0 };
  for (let i = 0; i < NLOOK; i++) {
    const f = randFieldLook();
    applyField(env, node, f, mark);
    const foc = rng.chance(0.5) && canFocus(f.flags);
    setFocus(env, foc ? node.addr : 0);
    const before = T.readDisp(m);
    const r = T.runCall(env, S.W_DRAWVIEW, { ix: node.addr });
    const after = T.readDisp(m);
    const g = new M.Gfx6Model(); g.setClip(f.x, f.y, f.w, f.h); M2.fieldLook(g, f, foc);
    const d1 = T.diffRect(env, g, f.x, f.y, f.w, f.h), d2 = T.diffOutside(before, after, f.x, f.y, f.w, f.h);
    const what = describeF(f, foc);
    sec.ok(d1 === null, () => `${what}: rectangle: ${d1}`);
    sec.ok(d2 === null, () => `${what}: outside the rectangle: ${d2}`);
    sec.ok(rd16(m, S.K_FOCUS) === (foc ? node.addr : 0), () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}`);
    X.noteRun(sec, r, what);
    st.foc += foc; st.dis += (f.flags & 8) !== 0; st.scrolled += f.first > 0; st.long += M2.tw(f.buf, f.first, f.buf.length) > f.w - 5; st.empty += f.buf.length === 0; st.full += f.buf.length === f.cap; st.oddH += f.h % 2;
    if (sec.nf > 12) break;
  }
  sec.end(`${st.foc} focused, ${st.dis} disabled looks, ${st.scrolled} with first > 0, ${st.long} with text running past the frame, ${st.empty} empty, ${st.full} full, ${st.oddH} odd heights`);
}

// ===========================================================================================================================
// 2. Looks under random clips
if (ONLY.includes(2)) {
  const { env, node, mark } = singleFieldEnv();
  const sec = new Sec('2 Field under a clip: M_DRAW with a random clip that cuts the Field; the whole display against the model, GCLIP put back (10.2)');
  const st = { cut: 0, inside: 0 };
  for (let i = 0; i < NCLIP; i++) {
    const f = randFieldLook();
    applyField(env, node, f, mark);
    const foc = rng.chance(0.5) && canFocus(f.flags);
    setFocus(env, foc ? node.addr : 0);
    const x0 = rng.int(Math.max(0, f.x - 20), f.x + f.w - 1), x1 = Math.min(512, rng.int(x0 + 1, f.x + f.w + 20));
    const y0 = rng.int(Math.max(0, f.y - 20), f.y + f.h - 1), y1 = Math.min(192, rng.int(y0 + 1, f.y + f.h + 20));
    const clip = [x0, y0, x1 - x0, y1 - y0];
    st.inside += x0 >= f.x && x1 <= f.x + f.w && y0 >= f.y && y1 <= f.y + f.h; st.cut += !(x0 >= f.x && x1 <= f.x + f.w && y0 >= f.y && y1 <= f.y + f.h);
    X.drawUnderClip(env, sec, `${describeF(f, foc)}, clip ${clip}`, node, (g) => M2.fieldLook(g, f, foc), clip);
    if (sec.nf > 12) break;
  }
  sec.end(`${st.inside} clips inside the Field, ${st.cut} cutting its edge`);
}

// ===========================================================================================================================
// 3. Editing sequences through K_DISPATCH: a window with two Fields, a Check and a List; the screen after every step
function randTree3() {
  for (;;) {
    const ww = 288, wh = 136, [wx, wy] = X.winPos(rng, ww, wh);
    const cap1 = rng.chance(0.4) ? rng.int(1, 12) : rng.int(8, 60), cap2 = rng.int(1, 30);
    const F1 = X.mkField(rng, 154, [wx + 8, wy + 14, rng.int(40, 150), rng.int(11, 18)], 1, cap1);
    const dis = rng.chance(0.12);
    const F2 = X.mkField(rng, 155, [wx + 8, wy + 38, rng.int(16, 150), rng.int(11, 16)], dis ? 4 | 8 | 1 : 1, cap2);
    const lw = rng.int(50, 100), lcell = rng.chance(0.4), lflags = 1 | (lcell ? 16 : 0);
    if (M2.listN({ x: wx + 170, y: wy + 14, w: lw, h: 74, flags: lflags }) < 1) continue;
    const Li = X.mkList(rng, 150, [wx + 170, wy + 14, lw, 74], lflags, rng.int(0, 10));
    const chk = { kind: 'Check', id: 153, x: wx + 8, y: wy + 64, w: 72, h: 9, flags: 1, codes: T.codesOf('Opt') };
    return new M2.TkTree2({ x: wx, y: wy, w: ww, h: wh, slot: 0, title: T.codesOf('Fields') }, [F1, F2, chk, Li]);
  }
}
const PRINTABLE = (() => { const o = []; for (let c = 32; c <= 126; c++) o.push(c); return o; })();
const LETTERS = T.codesOf('abcdefghijklmnopqrstuvwxyz');
/** The string source of TK_SETTEXT: a length-prefixed string in the string area after the window's own strings. */
function srcString(env, codes, strMark) { env.strp = strMark; return T.str(env, codes); }
function doSetText(env, tree, sec, ctx, f, codes, strMark) {
  const { S } = env;
  const src = srcString(env, codes, strMark);
  const before = T.readDisp(env.m);
  tree.resetLog(); M2.fieldSetText(tree, f, codes);
  let r;
  try { r = T.runCall(env, S.TK_SETTEXT, { ix: f.addr, hl: src }, {}); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return null; }
  X.afterStep(env, tree, sec, r, ctx, before);
  return r;
}

if (ONLY.includes(3)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('3 Field editing: codes, DELETE, LEFT, RIGHT, ENTER, clicks, a full buffer, TK_SETTEXT, focus keys through K_DISPATCH; text, caret, first, W_DRAWVIEWs, E_CMD posts and the screen after each step');
  const st = { steps: 0, typed: 0, full: 0, del: 0, move: 0, enter: 0, click: 0, focusKeys: 0, other: 0, setText: 0, posts: 0, scrolled: 0, trees: 0, noDraw: 0, others: 0 };
  for (let ti = 0; ti < NTREE && sec.nf < 12; ti++) {
    const tree = randTree3(), win = tree.win, [F1, F2] = tree.nodes();
    const ctxT = `tree ${ti} (window ${win.x},${win.y}; F1 (${F1.x}, ${F1.y}, ${F1.w}, ${F1.h}) cap ${F1.cap} ${X.show(F1.buf).slice(0, 30)}; F2 (${F2.x}, ${F2.y}, ${F2.w}, ${F2.h}) cap ${F2.cap} flags ${hex(F2.flags, 2)})`;
    if (!X.openTree(env, tree, sec, ctxT)) break;
    st.trees++;
    const strMark = env.strp, trail = [];
    const fields = [F1, F2], chk = tree.nodes().find((n) => n.kind === 'Check'), Li = tree.nodes().find((n) => n.kind === 'List');
    const ctx = () => `${ctxT}: ${trail.join(' > ')}`;
    const note = (s) => { trail.push(s); if (trail.length > 7) trail.shift(); };
    const feed = (ev) => { note(X.describeEv(ev)); st.steps++; const r = X.feedEv(env, tree, sec, ev, ctx()); if (r) { st.posts += r.posts.length; } return r; };
    const winPoint = () => [rng.int(win.x, win.x + win.w - 1), rng.int(win.y + 9, win.y + win.h - 1)];
    const deskPoint = () => { for (;;) { const p = [rng.int(0, 511), rng.int(8, 191)]; if (!X.overlap(win, p[0], p[1])) return p; } };
    const focusField = () => (tree.focus && tree.focus.kind === 'Field' ? tree.focus : null);
    // a typing-heavy tree 50 % of the time (to fill the buffers), an editing-heavy one otherwise
    const typingHeavy = rng.chance(0.5);
    for (let k = 0; k < NEV && sec.nf < 12; k++) {
      const r = rng.next();
      if (r < (typingHeavy ? 0.55 : 0.30)) {                                       // a printable code
        const code = rng.chance(0.7) ? rng.pick(LETTERS) : rng.pick(PRINTABLE);
        const f = focusField();
        if (f) { st.typed++; if (f.buf.length === f.cap) st.full++; }
        const rr = feed({ t: M.E.KEY, key: code });
        if (f && rr && f.buf.length === f.cap && rr.draws.length === 0) st.noDraw++;
      } else if (r < 0.66) {                                                       // DELETE / LEFT / RIGHT / ENTER
        const key = rng.pick([12, 12, 8, 8, 9, 9, 13]);
        const f = focusField(); if (key === 12) st.del++; else if (key === 13) st.enter++; else st.move++;
        feed({ t: M.E.KEY, key });
      } else if (r < 0.76) {                                                       // a click in a Field (the text, the blank part, the frame)
        const f = rng.pick(fields.filter((q) => (q.flags & 6) === 0));
        if (!f) continue;
        const p = X.pointIn(rng, f); st.click++;
        feed({ t: M.E.DOWN, px: p[0], py: p[1] });
        if (rng.chance(0.5)) { const q = winPoint(); feed({ t: M.E.MOVE, px: q[0], py: q[1] }); }
        feed({ t: M.E.UP, px: p[0], py: p[1] });
      } else if (r < 0.84) {                                                       // the keys that move the focus
        const key = rng.pick([14, 14, 15, 10, 11]); st.focusKeys++;
        feed({ t: M.E.KEY, key });
      } else if (r < 0.92) {                                                       // TK_SETTEXT
        const f = rng.pick(fields.filter((q) => (q.flags & 6) === 0)); if (!f) continue;
        const long = rng.chance(0.3), codes = X.genText(rng, long ? f.cap : 0, long ? f.cap + 20 : Math.min(f.cap, 20));
        note(`TK_SETTEXT ${X.show(codes).slice(0, 24)} (${codes.length}) on Field ${f.id} (cap ${f.cap})`); st.steps++; st.setText++;
        doSetText(env, tree, sec, ctx(), f, codes, strMark);
      } else if (r < 0.95) {                                                       // keys the Field does not take (they bubble up), and codes outside 32..126
        const key = rng.pick([27, 0, 1, 2, 127, 128, 200, 255, 31, 5]); st.other++;
        feed({ t: M.E.KEY, key });
      } else {                                                                     // a click on the Check, the List, the desk; a stray move or up
        const rr = rng.next(); st.others++;
        if (rr < 0.3) { const p = X.pointIn(rng, chk); feed({ t: M.E.DOWN, px: p[0], py: p[1] }); feed({ t: M.E.UP, px: p[0], py: p[1] }); }
        else if (rr < 0.55) { const p = X.pointIn(rng, Li); feed({ t: M.E.DOWN, px: p[0], py: p[1], vf: rng.int(100, 30000) }); feed({ t: M.E.UP, px: p[0], py: p[1] }); }
        else if (rr < 0.7) { const p = deskPoint(); feed({ t: M.E.DOWN, px: p[0], py: p[1] }); feed({ t: M.E.UP, px: p[0], py: p[1] }); }
        else { const p = rng.chance(0.5) ? winPoint() : deskPoint(); feed({ t: M.E.MOVE, px: p[0], py: p[1] }); }
      }
    }
    st.scrolled += fields.filter((f) => f.first > 0).length;
    T.clearTree(env, tree);
  }
  sec.end(`${st.trees} windows, ${st.steps} steps (${st.typed} codes typed into a focused Field of which ${st.full} into a full one, ${st.del} DELETE, ${st.move} LEFT / RIGHT, ${st.enter} ENTER, ${st.click} clicks, ${st.focusKeys} focus keys, ${st.setText} TK_SETTEXT, ${st.other} untaken keys, ${st.others} other clicks), ${st.posts} E_CMD posted, ${st.scrolled} Fields ended scrolled`);
}

// ===========================================================================================================================
// 4. TK_SETTEXT directly: strings shorter and longer than cap, empty, exactly cap; copied, cut, caret at the end, first adjusted, drawn; IX kept
if (ONLY.includes(4)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('4 TK_SETTEXT: L = min(length, cap), the first L codes copied, caret = L, first = 0 then adjusted, drawn (W_DRAWVIEW once); IX / IY / the alternate set kept');
  const st = { n: 0, cut: 0, empty: 0, exact: 0, scrolled: 0, focused: 0, longer: 0 };
  for (let rep = 0; rep < Math.max(1, Math.floor(NSET / 20)) && sec.nf < 12; rep++) {
    const w = rng.int(16, 200), h = rng.int(11, 20), x = rng.int(20, 280), y = rng.int(20, 190 - h), cap = rng.chance(0.3) ? rng.int(1, 8) : rng.int(8, 120);
    const F = X.mkField(rng, 154, [x, y, w, h], 1, cap, { buf: X.genText(rng, 0, Math.min(cap, 15)) });
    const tree = new M2.TkTree2({ x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Text') }, [F]);
    if (!X.openTree(env, tree, sec, `window ${rep}`)) break;
    const strMark = env.strp;
    for (let i = 0; i < 20; i++) {
      const r = rng.next(), len = r < 0.1 ? 0 : r < 0.25 ? cap : r < 0.5 ? cap + rng.int(1, 30) : rng.int(0, Math.min(cap, 60));
      const codes = X.genText(rng, Math.min(len, 200), Math.min(len, 200));
      if (rng.chance(0.5)) { setFocus(env, F.addr); tree.focus = F; st.focused++; } else { setFocus(env, 0); tree.focus = null; }
      st.n++; st.empty += codes.length === 0; st.exact += codes.length === cap; st.cut += codes.length > cap; st.longer += codes.length > cap;
      doSetText(env, tree, sec, `window ${rep} (${x}, ${y}, ${w}, ${h}) cap ${cap}: TK_SETTEXT ${X.show(codes).slice(0, 30)} (${codes.length})`, F, codes, strMark);
      st.scrolled += F.first > 0;
      sec.ok(m.ram[rd16(m, F.addr + S.Field_buf)] === Math.min(codes.length, cap), () => `length byte ${m.ram[rd16(m, F.addr + S.Field_buf)]}, want ${Math.min(codes.length, cap)}`);
    }
    T.clearTree(env, tree);
  }
  sec.end(`${st.n} calls (${st.empty} empty, ${st.exact} exactly cap long, ${st.cut} cut at cap, ${st.scrolled} left scrolled, ${st.focused} with the focus)`);
}

// ===========================================================================================================================
// 5. Direct M_EVENT sends (T_SEND, DE -> a record that is not K_EV)
if (ONLY.includes(5)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('5 Field M_EVENT direct: consumed (carry) for every key 0..255 (32-126, DELETE, LEFT, RIGHT, ENTER only) and each pointer event, E_CMD posts, E_MOVE only with the capture; state and screen against the model');
  const st = { keys: 0, consumed: 0, pointer: 0, posts: 0, trees: 0 };
  for (let ti = 0; ti < NDIRECT && sec.nf < 12; ti++) {
    const tree = randTree3(), F1 = tree.nodes()[0];
    const ctxT = `window ${ti} (F1 (${F1.x}, ${F1.y}, ${F1.w}, ${F1.h}) cap ${F1.cap} text ${X.show(F1.buf).slice(0, 20)} caret ${F1.caret} first ${F1.first})`;
    if (!X.openTree(env, tree, sec, ctxT)) break;
    st.trees++;
    setFocus(env, F1.addr); tree.focus = F1;
    // CONTRACT? 10.1 says a List reads every event through DE; for a Field the contract says only M_EVENT (DE = K_EV, OBJECTS_EVENTS 15.2), so K_EV holds the record too here
    const send = (ev, what) => X.sendDirect(env, tree, sec, `${ctxT}: ${what}`, F1, ev, { kevSame: true });
    const keys = new Set([12, 8, 9, 13, 14, 15, 10, 11, 27, 0, 31, 32, 126, 127, 255, 97]);
    while (keys.size < 36) keys.add(rng.int(0, 255));
    for (const key of keys) {
      if (sec.nf > 12) break;
      const r = send({ t: M.E.KEY, key }, `key ${key}`);
      const want = (key >= 32 && key <= 126) || [12, 8, 9, 13].includes(key);
      if (r) sec.ok(!!r.carry === want, () => `${ctxT}: key ${key}: consumed ${r.carry}, the contract says ${want ? 'consumed' : 'not consumed'}`);
      st.keys++; if (r) { st.consumed += r.carry; st.posts += r.posts.length; }
    }
    for (let i = 0; i < 5 && sec.nf < 12; i++) {
      const p = X.pointIn(rng, F1); st.pointer++;
      send({ t: M.E.DOWN, px: p[0], py: p[1] }, `E_DOWN (${p})`);
      send({ t: M.E.UP, px: p[0], py: p[1] }, `E_UP (${p})`);
      T.poke16(env, S.K_CAPTURE, 0); tree.capture = null;
      send({ t: M.E.MOVE, px: p[0], py: p[1] }, `E_MOVE, no capture`);
      T.poke16(env, S.K_CAPTURE, F1.addr); tree.capture = F1;
      send({ t: M.E.MOVE, px: rng.int(0, 511), py: rng.int(8, 191) }, `E_MOVE with the capture`);
      T.poke16(env, S.K_CAPTURE, 0); tree.capture = null;
    }
    T.clearTree(env, tree);
  }
  sec.end(`${st.trees} windows, ${st.keys} keys (${st.consumed} consumed), ${st.pointer} press / release / move sets, ${st.posts} E_CMD posted`);
}

// ===========================================================================================================================
// 6. Hand-worked cases on the machine (numbers worked on paper from 10.4, asserted as literals): the three-step "first adjusted" rule, click-to-caret, the full buffer, the caret pixels
if (ONLY.includes(6)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('6 Field hand-worked cases: first adjusted (ten 0s in a 60-wide Field), click-to-caret at the pixel, a full buffer draws nothing, the caret column');
  // '0' is 7 pixels wide, 'a' 7, 'b' 7, 'c' 6 (PROP6); w = 60 gives A = 55
  const F = { kind: 'Field', id: 154, x: 100, y: 40, w: 60, h: 12, flags: 1, buf: [], cap: 20, caret: 0, first: 0 };
  const tree = new M2.TkTree2({ x: 64, y: 24, w: 288, h: 136, slot: 0, title: T.codesOf('Hand') }, [F]);
  if (X.openTree(env, tree, sec, 'hand window')) {
    const strMark = env.strp;
    const first = () => m.ram[F.addr + S.Field_first], caret = () => m.ram[F.addr + S.Field_caret], len = () => m.ram[rd16(m, F.addr + S.Field_buf)];
    const key = (k, what) => X.feedEv(env, tree, sec, { t: M.E.KEY, key: k }, `hand: ${what}`);
    doSetText(env, tree, sec, 'hand: TK_SETTEXT ten 0s', F, T.codesOf('0000000000'), strMark);
    sec.ok(caret() === 10 && first() === 3 && len() === 10, () => `ten 0s: caret ${caret()} first ${first()} length ${len()}; hand-worked: tw(0, 10) = 70 > 55, first 3 (7 x 7 = 49 <= 55), step 3: tw(2, 10) = 56 > 55 keeps it: want 10, 3, 10`);
    const got = [];
    for (let i = 0; i < 10; i++) { key(8, `LEFT ${i + 1}`); got.push(first()); }
    sec.ok(got.join() === '3,3,3,3,3,3,3,2,1,0', () => `LEFT x 10 from caret 10: first goes ${got}, hand-worked 3,3,3,3,3,3,3,2,1,0 (caret 9 .. 3 keep 3; caret 2: first = caret ...)`);
    const got2 = [];
    for (let i = 0; i < 10; i++) { key(9, `RIGHT ${i + 1}`); got2.push(first()); }
    sec.ok(got2.join() === '0,0,0,0,0,0,0,1,2,3', () => `RIGHT x 10 from caret 0: first goes ${got2}, hand-worked 0,0,0,0,0,0,0,1,2,3 (caret 8: tw(0, 8) = 56 > 55)`);
    const got3 = [];
    for (let i = 0; i < 3; i++) { key(12, `DELETE ${i + 1}`); got3.push(first()); }
    sec.ok(got3.join() === '2,1,0' && len() === 7 && caret() === 7, () => `DELETE x 3 at the end: first goes ${got3}, length ${len()} caret ${caret()}; hand-worked 2,1,0, 7, 7 (step 3 slides the text right while tw(first - 1, L) <= 55)`);
    // click-to-caret on "abc" in a Field at x = 100: codes start at x + 3 = 103; a = 7, b = 7, c = 6; the middles are 103 + 3 = 106, 110 + 3 = 113, 117 + 3 = 120
    doSetText(env, tree, sec, 'hand: TK_SETTEXT abc', F, T.codesOf('abc'), strMark);
    const wantCaret = [[104, 0], [105, 0], [106, 1], [112, 1], [113, 2], [119, 2], [120, 3], [150, 3]];
    for (const [px, want] of wantCaret) {
      X.feedEv(env, tree, sec, { t: M.E.DOWN, px, py: 46 }, `hand: click at px ${px}`); X.feedEv(env, tree, sec, { t: M.E.UP, px, py: 46 }, `hand: release at px ${px}`);
      sec.ok(caret() === want, () => `click at px ${px} in "abc" at x = 100: caret ${caret()}, hand-worked ${want} (middles 106, 113, 120; the caret goes before the first code whose middle is right of px)`);
    }
    // the caret's column: the 1 x 9 bar at x + 2 + tw(first, caret), rows ty = y + floor((h - 8) / 2) = 42 .. 50; "abc" with the caret before c: 100 + 2 + 14 = 116
    X.feedEv(env, tree, sec, { t: M.E.DOWN, px: 119, py: 46 }, 'hand: caret before c'); X.feedEv(env, tree, sec, { t: M.E.UP, px: 119, py: 46 }, 'hand: release');
    const px = (x, y) => { const d = T.readDisp(m); return (d[y * 64 + (x >> 3)] >> (7 - (x & 7))) & 1; };
    sec.ok(caret() === 2 && px(116, 42) === 1 && px(116, 50) === 1 && px(116, 41) === 0 && px(115, 42) === 0, () => `the caret bar at x = 116, rows 42..50: ${[px(116, 42), px(116, 50), px(116, 41), px(115, 42)]} (caret ${caret()}); want 1,1,0,0`);
    // a full buffer: cap 3, a fourth code changes nothing and draws nothing
    F.cap = 3; T.poke8(env, F.addr + S.Field_cap, 3);
    doSetText(env, tree, sec, 'hand: TK_SETTEXT abcd (cap 3)', F, T.codesOf('abcd'), strMark);
    sec.ok(len() === 3 && text(F.buf) === 'abc' && caret() === 3, () => `TK_SETTEXT "abcd" with cap 3: length ${len()} caret ${caret()}, want "abc", 3`);
    const rr = key(120, 'x into a full buffer');
    sec.ok(rr && rr.draws.length === 0 && rr.posts.length === 0, () => `x into a full buffer: ${rr && rr.draws.length} W_DRAWVIEW, want none (nothing changes, nothing drawn)`);
    sec.ok(len() === 3 && caret() === 3, 'a full buffer is unchanged');
    // DELETE at caret 0 and LEFT at caret 0 draw nothing; RIGHT at the end draws nothing; ENTER posts and draws nothing
    F.caret = 0; T.poke8(env, F.addr + S.Field_caret, 0); T.poke8(env, F.addr + S.Field_first, 0); F.first = 0; T.runCall(env, S.W_DRAWVIEW, { ix: F.addr }, { ints: false });
    const r1 = key(12, 'DELETE at caret 0'), r2 = key(8, 'LEFT at caret 0');
    sec.ok(r1 && r2 && r1.draws.length + r2.draws.length === 0, () => `DELETE / LEFT at caret 0 drew ${r1 && r1.draws.length}, ${r2 && r2.draws.length}; want 0`);
    F.caret = 3; T.poke8(env, F.addr + S.Field_caret, 3); T.runCall(env, S.W_DRAWVIEW, { ix: F.addr }, { ints: false });
    const r3 = key(9, 'RIGHT at the end'), r4 = key(13, 'ENTER');
    sec.ok(r3 && r3.draws.length === 0, () => `RIGHT at the end drew ${r3 && r3.draws.length}`);
    sec.ok(r4 && r4.draws.length === 0 && r4.posts.length === 1 && r4.posts[0].a === 10 && r4.posts[0].c === 154 && r4.posts[0].e === tree.win.slot, () => `ENTER: ${r4 && r4.draws.length} draws, posts ${JSON.stringify(r4 && r4.posts)}; want no draw and E_CMD (A 10, C 154, E ${tree.win.slot})`);
    T.clearTree(env, tree);
  }
  sec.end('ten 0s: first 3; LEFT / RIGHT / DELETE sequences; 8 click positions around the middles; the caret pixels; full buffer; no-change keys');
}

// ===========================================================================================================================
// 7. Stack, registers, DI
if (ONLY.includes(7)) {
  const sec = new Sec('7 Field: stack of M_DRAW and M_EVENT <= 64 bytes, IX / IY / the alternate set kept, SP right after every return, no DI (over every stepped call of this run)');
  sec.ok(X.stk.draw <= 64, () => `M_DRAW used ${X.stk.draw} bytes of stack (${X.stk.drawWhat}), bound 64`);
  sec.ok(X.stk.event <= 64, () => `M_EVENT used ${X.stk.event} bytes of stack (${X.stk.eventWhat}), bound 64`);
  sec.ok(X.totals.di === 0, () => `${X.totals.di} DI instruction(s) executed in the stepped calls`);
  sec.ok(X.totals.badPreserved === 0, () => `${X.totals.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(X.totals.badSp === 0, () => `${X.totals.badSp} call(s) returned with a wrong SP`);
  sec.end(`deepest M_DRAW ${X.stk.draw} bytes (${X.stk.drawWhat}), deepest M_EVENT ${X.stk.event} bytes (${X.stk.eventWhat}), deepest K_DISPATCH step ${X.totals.maxStack}`);
}

// ===========================================================================================================================
// 8. The memory watch
if (ONLY.includes(8)) {
  const sec = new Sec('8 memory watch (BANKING 10.7), no pointer to DOCK 2-3 / 6 handed to K code');
  envs.forEach((env, i) => { sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`); });
  sec.end(`${envs.length} machines`);
}
finish();
