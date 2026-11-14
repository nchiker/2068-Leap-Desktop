"use strict";
// tk-t2.mjs -- toolkit slice T2 (List) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/TOOLKIT.md (1-10; section 10.3 and 10.8 items 1-2 are what is tested), docs/WINDOWS.md (4, 5, 7, 17) and docs/OBJECTS_EVENTS.md (5, 6, 15); never from src/kernel/tk.asm,
// tk2.asm.  The reference is tests/tk-model2.mjs (built on tk-model.mjs and gfx6-model.mjs); the harness is tests/tk-lib.mjs and tests/tk-lib2.mjs.
//   node tests/tk-t2.mjs [--seed N] [--nlook N] [--nclip N] [--ntree N] [--nev N] [--nset N] [--ndirect N] [--only LIST] [--verbose]
//     --nlook N    random Lists drawn whole by W_DRAWVIEW (default 1200)
//     --nclip N    random Lists drawn by M_DRAW under a random clip (default 800)
//     --ntree N    random windows for the behaviour sequences (default 40), --nev N events in each (default 45)
//     --nset N     random TK_SETITEMS calls (default 150)
//     --ndirect N  random windows for the direct M_EVENT sends (default 25)
//     --only LIST  groups: 0 model hand cases, 1 looks, 2 clips, 3 behaviour, 4 TK_SETITEMS, 5 direct M_EVENT, 6 double click, 7 stack / registers / DI, 8 watch,
//                  9 pointer events read through DE (10.1: "A List reads every event through DE"), with K_EV holding garbage (default all)
// The last line is "tk-t2: N of M groups pass"; exit code 1 on any failure.
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import * as X from './tk-lib2.mjs';

const { L, hex, rd16 } = T;
const { argv, argNum } = L;
const { FF } = X;
const SEED = argNum('--seed', 1);
const NLOOK = argNum('--nlook', 1200), NCLIP = argNum('--nclip', 800), NTREE = argNum('--ntree', 40), NEV = argNum('--nev', 45), NSET = argNum('--nset', 150), NDIRECT = argNum('--ndirect', 25);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = makeGroups();
function makeGroups() { return X.makeGroups('tk-t2', VERBOSE); }
console.log(`seed ${SEED} (rerun with --seed ${SEED}); looks ${NLOOK}, clips ${NCLIP}, behaviour ${NTREE} windows x ${NEV}, TK_SETITEMS ${NSET}, direct ${NDIRECT} windows`);

const WIN0 = { x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Looks') };
const envs = [];
const canFocus = (flags) => (flags & 7) === 1;
const listBytes = (l) => l.items.reduce((a, c) => a + c.length + 1, 2 * l.count + 2);

// ===========================================================================================================================
// 0. The model's own hand-worked cases (so that a model bug shows up as a model failure)
if (ONLY.includes(0)) {
  const sec = new Sec('0 model hand-worked cases (tk-model2 selfTest: section 10 worked on paper)');
  const out = [];
  const bad = M2.selfTest(false, out);
  sec.n = out.length; sec.nf = bad;
  for (const l of out) if (l.startsWith('FAIL')) sec.fails.push(l);
  sec.end(`${out.length} cases`);
}

// ===========================================================================================================================
// Random List look parameters (10.3): both modes, any count / top / sel, focus, disabled look, rectangles partly off the grid
function randListLook() {
  for (let guard = 0; guard < 1000; guard++) {
    const cell = rng.chance(0.5), aligned = cell && rng.chance(0.3);
    let x, y, w, h;
    if (aligned) {
      const nl = rng.int(1, 16), mm = rng.int(4, 26);
      w = 8 * mm + 4; h = 8 * nl + 2;
      const a0 = 2, a1 = Math.floor((494 - w - 6) / 8), b0 = 2, b1 = Math.floor((190 - h - 7) / 8);
      if (a1 < a0 || b1 < b0) continue;
      x = 8 * rng.int(a0, a1) + 6; y = 8 * rng.int(b0, b1) + 7;
    } else {
      w = rng.int(24, 230); h = rng.chance(0.2) ? rng.int(11, 30) : rng.int(11, 170);
      x = rng.int(18, 494 - w); y = rng.int(19, 190 - h);
    }
    const dis = rng.chance(0.15);
    const flags = (rng.chance(0.7) ? 1 : 0) | (cell ? 16 : 0) | (dis ? 8 | (rng.chance(0.5) ? 4 : 0) : 0);
    const geo = M2.listGeom({ x, y, w, h, flags });
    if (geo.n < 1) continue;
    const r = rng.next(), count = r < 0.1 ? 0 : r < 0.4 ? rng.int(1, geo.n) : Math.min(60, rng.int(geo.n, geo.n + 40));
    const l = { kind: 'List', id: 150, x, y, w, h, flags, items: X.genItems(rng, count), count, sel: FF, top: 0, bar: null };
    if (listBytes(l) > 900) continue;
    const q = rng.next();
    l.top = q < 0.5 ? 0 : q < 0.9 ? rng.int(0, Math.max(0, count - geo.n)) : rng.int(0, count);
    l.sel = count === 0 || rng.chance(0.25) ? FF : rng.int(0, count - 1);
    return l;
  }
  throw new Error('no list');
}
/** Write the List's whole state (and its items) into the machine's view; mark = env.bufp after buildTree. */
function applyList(env, node, l, mark) {
  const S = env.S, a = node.addr;
  env.bufp = mark;
  T.poke16(env, a + S.List_items, T.itemsArray(env, l.items));
  T.poke8(env, a + S.List_count, l.count); T.poke8(env, a + S.List_sel, l.sel); T.poke8(env, a + S.List_top, l.top);
  T.poke8(env, a + S.View_flags, l.flags); T.setRect(env, a, l.x, l.y, l.w, l.h); T.poke16(env, a + S.List_bar, 0);
}
function singleListEnv() {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const node = { kind: 'List', id: 150, x: 30, y: 30, w: 60, h: 40, flags: 1, items: [[65]], count: 1, sel: FF, top: 0, bar: null };
  const tree = new M2.TkTree2(WIN0, [node]);
  T.buildTree(env, tree);
  return { env, node, tree, mark: env.bufp };
}
/** Redraw a List in the machine (after its state was poked) so that the screen is the model's again. */
const syncDraw = (env, node) => T.runCall(env, env.S.W_DRAWVIEW, { ix: node.addr }, { ints: false });
const setFocus = (env, addr) => { T.runCall(env, env.S.K_SETFOCUS, { de: 0 }, { ints: false }); if (addr) T.runCall(env, env.S.K_SETFOCUS, { de: addr }, { ints: false }); };

// ===========================================================================================================================
// 1. Looks: one List drawn by W_DRAWVIEW; the rectangle equals the model's full draw, the rest of the screen is unchanged
if (ONLY.includes(1)) {
  const { env, node, tree, mark } = singleListEnv();
  const { m, S } = env;
  const sec = new Sec('1 List look: W_DRAWVIEW of a random List (both modes, count, top, sel, focus, disabled look, off-grid rectangles) against 10.3');
  const st = { cell: 0, aligned: 0, dis: 0, foc: 0, empty: 0, selShown: 0, scrolled: 0, wideText: 0 };
  for (let i = 0; i < NLOOK; i++) {
    let l;
    try { l = randListLook(); applyList(env, node, l, mark); } catch (e) { if (/buffer area full/.test(e.message)) { i--; continue; } throw e; }
    const foc = rng.chance(0.5) && canFocus(l.flags);
    setFocus(env, foc ? node.addr : 0);
    const before = T.readDisp(m);
    const r = T.runCall(env, S.W_DRAWVIEW, { ix: node.addr });
    const after = T.readDisp(m);
    const g = new M.Gfx6Model(); g.setClip(l.x, l.y, l.w, l.h); M2.listLook(g, l, foc);
    const d1 = T.diffRect(env, g, l.x, l.y, l.w, l.h), d2 = T.diffOutside(before, after, l.x, l.y, l.w, l.h);
    const what = `List (${l.x}, ${l.y}, ${l.w}, ${l.h}) flags ${hex(l.flags, 2)} count ${l.count} top ${l.top} sel ${l.sel === FF ? '$FF' : l.sel} focused ${foc}, items ${X.show(l.items[0] || []).slice(0, 20)}...`;
    sec.ok(d1 === null, () => `${what}: rectangle: ${d1}`);
    sec.ok(d2 === null, () => `${what}: outside the rectangle: ${d2}`);
    sec.ok(rd16(m, S.K_FOCUS) === (foc ? node.addr : 0), () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}`);
    X.noteRun(sec, r, what);
    st.cell += (l.flags & 16) !== 0; st.aligned += (l.flags & 16) !== 0 && (l.x - 6) % 8 === 0 && (l.y - 7) % 8 === 0 && (l.h - 2) % 8 === 0; st.dis += (l.flags & 8) !== 0; st.foc += foc; st.empty += l.count === 0;
    st.selShown += M2.listShown(l, l.sel); st.scrolled += l.top > 0;
    if (sec.nf > 12) break;
  }
  sec.end(`${st.cell} cell-line lists (${st.aligned} on the 8 x 8 grid), ${st.dis} disabled looks, ${st.foc} focused, ${st.empty} empty, ${st.selShown} with the selected line shown, ${st.scrolled} scrolled`);
}

// ===========================================================================================================================
// 2. Looks under random clips: M_DRAW sent with GCLIP set to a rectangle that cuts the List (a window partly covered); the clip is back afterwards (10.2)
if (ONLY.includes(2)) {
  const { env, node, mark } = singleListEnv();
  const { m, S } = env;
  const sec = new Sec('2 List under a clip: M_DRAW with a random clip that cuts the List; the whole display against the model, GCLIP put back (10.2)');
  const st = { cut: 0, inside: 0, cell: 0 };
  for (let i = 0; i < NCLIP; i++) {
    let l;
    try { l = randListLook(); applyList(env, node, l, mark); } catch (e) { if (/buffer area full/.test(e.message)) { i--; continue; } throw e; }
    const foc = rng.chance(0.5) && canFocus(l.flags);
    setFocus(env, foc ? node.addr : 0);
    // a clip that overlaps the List: x0 / y0 anywhere from 20 pixels outside to the far edge, the other corner up to 20 outside
    const x0 = rng.int(Math.max(0, l.x - 20), l.x + l.w - 1), x1 = Math.min(512, rng.int(x0 + 1, l.x + l.w + 20));
    const y0 = rng.int(Math.max(0, l.y - 20), l.y + l.h - 1), y1 = Math.min(192, rng.int(y0 + 1, l.y + l.h + 20));
    const clip = [x0, y0, x1 - x0, y1 - y0];
    const insideOnly = x0 >= l.x && x1 <= l.x + l.w && y0 >= l.y && y1 <= l.y + l.h;
    const what = `List (${l.x}, ${l.y}, ${l.w}, ${l.h}) flags ${hex(l.flags, 2)} count ${l.count} top ${l.top} sel ${l.sel === FF ? '$FF' : l.sel} focused ${foc}, clip ${clip}`;
    X.drawUnderClip(env, sec, what, node, (g) => M2.listLook(g, l, foc), clip);
    st.inside += insideOnly; st.cut += !insideOnly; st.cell += (l.flags & 16) !== 0;
    if (sec.nf > 12) break;
  }
  sec.end(`${st.inside} clips inside the List, ${st.cut} cutting its edge, ${st.cell} cell-line lists`);
}

// ===========================================================================================================================
// 3. Behaviour: random keys, clicks, double clicks, E_SCROLL, TK_SETITEMS and bar clicks in a window with two Lists (the first with its bar), a Check; the screen after every step.
const STR_SCRATCH = X.SCR_REC;
function randTree2() {
  for (;;) {
    const ww = 288, wh = 136, [wx, wy] = X.winPos(rng, ww, wh);
    const cellA = rng.chance(0.4), hasBar = rng.chance(0.7);
    const wA = rng.int(48, 120), hA = hasBar ? rng.int(32, 100) : rng.int(11, 100), xA = wx + 8 + rng.int(0, 7), yA = wy + 14 + rng.int(0, 6);
    const flagsA = 1 | (cellA ? 16 : 0);
    if (M2.listN({ x: xA, y: yA, w: wA, h: hA, flags: flagsA }) < 1) continue;
    const A = X.mkList(rng, 150, [xA, yA, wA, hA], flagsA, rng.int(0, 30));
    const wB = rng.int(40, 110), hB = rng.int(11, 100), xB = wx + 164, yB = wy + 14 + rng.int(0, 6);
    const dis = rng.chance(0.15), flagsB = (rng.chance(0.8) ? 1 : 0) | (rng.chance(0.4) ? 16 : 0) | (dis ? 4 | 8 : 0);
    if (M2.listN({ x: xB, y: yB, w: wB, h: hB, flags: flagsB }) < 1) continue;
    const B = X.mkList(rng, 151, [xB, yB, wB, hB], flagsB, rng.int(0, 16));
    if (listBytes(A) + listBytes(B) > 640) continue;
    const kids = [A];
    if (hasBar) {
      const bar = { kind: 'VScroll', id: 152, x: xA + wA, y: yA, w: 12, h: hA, value: 0, max: 0, page: 0, target: 0, press: 0, targetNode: A };
      A.bar = bar; M.setBar(bar, A.top, M2.listMaxTop(A), M2.listN(A)); kids.push(bar);
    }
    kids.push(B, { kind: 'Check', id: 153, x: wx + 8, y: wy + 124, w: 72, h: 9, flags: 1, codes: T.codesOf('Opt') });
    return new M2.TkTree2({ x: wx, y: wy, w: ww, h: wh, slot: 0, title: T.codesOf('Lists') }, kids);
  }
}
/** Items for a TK_SETITEMS in the behaviour trees: <= 24 items of <= 10 codes (the buffer area is small), sometimes the standard ones. */
function genSetItems(count) {
  if (count === 24 && rng.chance(0.3)) return X.STD_ITEMS.map((c) => c.slice());
  const o = [];
  for (let i = 0; i < count; i++) o.push(rng.chance(0.06) ? [] : X.genText(rng, 1, 10));
  return o;
}
function doSetItems(env, tree, sec, ctx, l, items, mark) {
  const { S } = env;
  env.bufp = mark;
  const arr = T.itemsArray(env, items);
  const before = T.readDisp(env.m);
  tree.resetLog(); M2.listSetItems(tree, l, items);
  let r;
  try { r = T.runCall(env, S.TK_SETITEMS, { ix: l.addr, hl: arr, a: items.length }, {}); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); return null; }
  X.afterStep(env, tree, sec, r, ctx, before);
  return r;
}

if (ONLY.includes(3)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('3 List behaviour: keys, clicks, double clicks, E_SCROLL, TK_SETITEMS and bar clicks through K_DISPATCH / the routines; W_DRAWVIEWs, E_CMD posts, state, bar value / max / page, focus and the screen after each step');
  const st = { steps: 0, keys: 0, clicks: 0, dbl: 0, dblPosts: 0, scroll: 0, setItems: 0, barClicks: 0, posts: 0, fullDraws: 0, lineOnly: 0, enter: 0, stray: 0, trees: 0, scrollsDone: 0, selMoves: 0 };
  for (let ti = 0; ti < NTREE && sec.nf < 12; ti++) {
    const tree = randTree2(), win = tree.win, A = tree.nodes().find((n) => n.id === 150), B = tree.nodes().find((n) => n.id === 151), bar = A.bar;
    const ctxT = `tree ${ti} (window ${win.x},${win.y}; A (${A.x}, ${A.y}, ${A.w}, ${A.h}) flags ${hex(A.flags, 2)} count ${A.count}${bar ? ' with a bar' : ''}; B (${B.x}, ${B.y}, ${B.w}, ${B.h}) flags ${hex(B.flags, 2)} count ${B.count})`;
    if (!X.openTree(env, tree, sec, ctxT)) break;
    st.trees++;
    const mark = env.bufp, trail = [];
    let vf = rng.int(100, 30000);
    const lists = [A, B], enabled = (l) => (l.flags & 6) === 0;
    const nextVf = (gap) => { vf += gap ?? rng.pick([1, 2, 5, 12, 25, 60]); return vf; };
    const ctx = () => `${ctxT}: ${trail.join(' > ')}`;
    const note = (s) => { trail.push(s); if (trail.length > 7) trail.shift(); };
    const feed = (ev) => { note(X.describeEv(ev)); st.steps++; const r = X.feedEv(env, tree, sec, ev, ctx()); if (r) st.posts += r.posts.length; return r; };
    const pointInList = (l) => X.pointIn(rng, l);
    const itemPoint = (l, item) => {
      const geo = M2.listGeom(l), k = item - l.top;
      return [rng.int(l.x + 1, l.x + l.w - 2), geo.LY0 + geo.P * k + rng.int(0, geo.P - 1)];
    };
    const winPoint = () => { for (let k = 0; k < 50; k++) { const p = [rng.int(win.x, win.x + win.w - 1), rng.int(win.y + 9, win.y + win.h - 1)]; if (!bar || !X.overlap(bar, p[0], p[1])) return p; } return [win.x + 2, win.y + win.h - 2]; };
    const deskPoint = () => { for (;;) { const p = [rng.int(0, 511), rng.int(8, 191)]; if (!X.overlap(win, p[0], p[1])) return p; } };
    const click = (p, gap, moves = rng.int(0, 2)) => {
      let r = feed({ t: M.E.DOWN, px: p[0], py: p[1], vf: nextVf(gap) });
      for (let i = 0; i < moves && r; i++) { const q = rng.chance(0.5) ? p : winPoint(); r = feed({ t: M.E.MOVE, px: q[0], py: q[1] }); }
      if (r) feed({ t: M.E.UP, px: p[0], py: p[1] });
    };
    const itemsShown = (l) => { const o = [], geo = M2.listGeom(l); for (let k = 0; k < geo.n && l.top + k < l.count; k++) o.push(l.top + k); return o; };
    const keyList = [10, 10, 10, 10, 11, 11, 11, 13, 13, 14, 14, 15, 8, 9, 32, 97, 27, 12, 10, 11];
    for (let k = 0; k < NEV && sec.nf < 12; k++) {
      const r = rng.next();
      if (r < 0.22) {
        const key = rng.pick(keyList); st.keys++; st.enter += key === 13;
        feed({ t: M.E.KEY, key });
      } else if (r < 0.40) {                                                       // a click on a List (an item, or any point of it: the frame, the blank lines)
        const l = rng.pick(lists.filter(enabled)); st.clicks++;
        const sh = itemsShown(l);
        const p = sh.length && rng.chance(0.75) ? itemPoint(l, rng.pick(sh)) : pointInList(l);
        click(p);
      } else if (r < 0.52) {                                                       // a double click scenario: the same item again after a gap of 0..40 frames
        const l = rng.pick(lists.filter(enabled)), sh = itemsShown(l);
        if (!sh.length) continue;
        const j = rng.pick(sh), gap = rng.pick([0, 3, 10, 19, 20, 21, 22, 40]);
        st.dbl++;
        const nPosts = st.posts;
        // the presses are mostly within a few pixels of each other (the kernel flags a press at most 8 across and 4 down from the one before, WRITE 14.9), on the same item
        const p1 = itemPoint(l, j), geo = M2.listGeom(l), ylo = geo.LY0 + geo.P * (j - l.top), clampTo = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
        const near = (p) => [clampTo(p[0] + rng.int(-9, 9), l.x + 1, l.x + l.w - 2), clampTo(p[1] + rng.int(-5, 5), ylo, ylo + geo.P - 1)];
        click(p1, undefined, 0);
        let p2 = p1;
        if (M2.listShown(l, j)) { p2 = rng.chance(0.75) ? near(p1) : itemPoint(l, j); click(p2, gap, 0); }
        if (rng.chance(0.4) && M2.listShown(l, j)) click(rng.chance(0.75) ? near(p2) : itemPoint(l, j), rng.pick([1, 5, 20]), 0);     // a third click: not flagged after a double-click, so it starts again
        st.dblPosts += st.posts - nPosts;
      } else if (r < 0.60) {                                                       // E_SCROLL straight to a List, DE -> a record that is not K_EV
        const l = rng.pick(lists.filter(enabled)); st.scroll++;
        const n = M2.listN(l), val = rng.chance(0.2) ? rng.int(0, 255) : rng.int(0, Math.max(0, l.count - n) + 2);
        note(`E_SCROLL ${val} to List ${l.id}`);
        const before = M2.listMaxTop(l) >= 0 ? l.top : 0;
        X.sendDirect(env, tree, sec, ctx(), l, { t: M.E.SCROLL, val, barId: 152 }); st.steps++; st.scrollsDone += l.top !== before;
      } else if (r < 0.66) {                                                       // TK_SETITEMS on List A
        st.setItems++; st.steps++;
        const items = genSetItems(rng.chance(0.15) ? 0 : rng.int(1, 24));
        note(`TK_SETITEMS ${items.length} items on A`);
        doSetItems(env, tree, sec, ctx(), A, items, mark);
      } else if (r < 0.78 && bar) {                                                // a click on the bar's arrow or track: E_SCROLL from the real bar to the List
        const gm = M.vsGeom(bar), parts = ['up', 'down'];
        if (gm.thumb && gm.ty > bar.y + 10) parts.push('pgup'); if (gm.thumb && gm.ty + gm.th < bar.y + bar.h - 10) parts.push('pgdn');
        const part = rng.pick(parts);
        const rows = { up: [bar.y, bar.y + 9], down: [bar.y + bar.h - 10, bar.y + bar.h - 1], pgup: [bar.y + 10, gm.ty - 1], pgdn: [gm.ty + gm.th, bar.y + bar.h - 11] }[part];
        const py = rng.int(rows[0], rows[1]), px = rng.int(bar.x, bar.x + bar.w - 1), H = rng.int(2, 8), vf0 = nextVf();
        const frames = []; for (let i = 0; i < H; i++) frames.push([]); frames[H - 1].push({ t: 'up' });
        const sim = M.simulateTrack({ ...bar }, 'tell', { px, py, pre: [] }, vf0, frames, 'rect');
        if (!sim) continue;
        note(`bar ${part} click at (${px}, ${py}) held ${H} frames`); st.barClicks++; st.steps++;
        const before = T.readDisp(m);
        T.drainEvents(env); T.setVframes(env, vf0); tree.resetLog(); tree.vf = vf0;
        T.setEv(env, T.ptRec(M.E.DOWN, px, py, 1));
        let wakes = 0, rr;
        try {
          rr = T.runCall(env, S.K_DISPATCH, {}, { onHalt: () => { wakes++; if (wakes > H) throw new Error('the bar\'s loop is still waiting after the scripted frames'); T.setVframes(env, (vf0 + wakes) & 0xFFFF); for (const e of frames[wakes - 1]) T.ringPut(env, T.ptRec(M.E.UP, px, py, 0)); } });
        } catch (e) { sec.ok(false, `${ctx()}: ${e.message}`); break; }
        // the model: the bar's value is the simulation's, each change told to the List as E_SCROLL
        for (const t of sim.t.tells) M2.listScroll(tree, A, t.value);
        bar.value = sim.v.value;
        T.poke16(env, S.K_CAPTURE, 0); tree.capture = null;
        X.afterStep(env, tree, sec, rr, ctx(), before, { noDraws: true, noPosts: true });
        sec.ok(rr.posts.length === 0, () => `${ctx()}: a bar with a target posted E_CMD`);
      } else if (r < 0.80) {                                                       // TK_SETITEMS on B is not exercised here (B's items are the window's); a click on the Check / the desk / a stray move or up
        const rr = rng.next(); st.stray++;
        if (rr < 0.35) { const c = tree.nodes().find((n) => n.kind === 'Check'); click(X.pointIn(rng, c), undefined, 0); }
        else if (rr < 0.6) { const p = deskPoint(); click(p, undefined, 0); }
        else if (rr < 0.8) { const p = rng.chance(0.5) ? winPoint() : deskPoint(); feed({ t: M.E.MOVE, px: p[0], py: p[1] }); }
        else { const p = rng.chance(0.5) ? winPoint() : deskPoint(); if (!bar || !X.overlap(bar, p[0], p[1]) || tree.capture) feed({ t: M.E.UP, px: p[0], py: p[1] }); }
      } else {
        const key = rng.pick([10, 11, 10, 11, 14]); st.keys++;
        feed({ t: M.E.KEY, key });
      }
    }
    for (const l of lists) st.selMoves += l.sel !== FF;
    T.clearTree(env, tree);
  }
  sec.end(`${st.trees} windows, ${st.steps} steps (${st.keys} keys incl. ${st.enter} ENTER, ${st.clicks} clicks, ${st.dbl} double-click scenarios, ${st.scroll} E_SCROLL of which ${st.scrollsDone} moved the List, ${st.setItems} TK_SETITEMS, ${st.barClicks} bar clicks, ${st.stray} others), ${st.posts} E_CMD posted (${st.dblPosts} in the double-click scenarios)`);
}

// ===========================================================================================================================
// 4. TK_SETITEMS directly: a List alone (with or without its bar, either mode), random items, random state before; sel $FF, top 0, the bar set, a full draw
if (ONLY.includes(4)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('4 TK_SETITEMS: items and count stored, sel $FF, top 0, the bar set (value 0, max max(0, count - n), page n), a full draw of both; IX kept, no DI');
  const st = { n: 0, empty: 0, shorter: 0, longer: 0, bar: 0, cell: 0, focused: 0 };
  for (let rep = 0; rep < Math.max(1, Math.floor(NSET / 15)) && sec.nf < 12; rep++) {
    const cell = rng.chance(0.5), hasBar = rng.chance(0.6), w = rng.int(40, 130), h = hasBar ? rng.int(32, 120) : rng.int(11, 120), x = rng.int(20, 300), y = rng.int(20, 190 - h);
    const flags = 1 | (cell ? 16 : 0);
    if (M2.listN({ x, y, w, h, flags }) < 1) continue;
    const A = X.mkList(rng, 150, [x, y, w, h], flags, rng.int(0, 20));
    const kids = [A];
    if (hasBar) { const bar = { kind: 'VScroll', id: 152, x: x + w, y, w: 12, h, value: 0, max: 0, page: 0, target: 0, press: 0, targetNode: A }; A.bar = bar; M.setBar(bar, A.top, M2.listMaxTop(A), M2.listN(A)); kids.push(bar); }
    const tree = new M2.TkTree2({ x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Items') }, kids);
    if (!X.openTree(env, tree, sec, `window ${rep}`)) break;
    const mark = env.bufp;
    const n = M2.listN(A);
    for (let i = 0; i < 15; i++) {
      // the list gets a different state first: a selection, a scroll (through the model's own events), the focus
      if (rng.chance(0.5) && A.count) { tree.resetLog(); M2.listSelect(tree, A, rng.int(0, A.count - 1)); }
      // (the machine is brought to the same state by a plain call of the same events, so the next TK_SETITEMS starts from a state the model knows)
      const items = rng.chance(0.7) ? genSetItems(rng.chance(0.1) ? 0 : rng.int(1, 24)) : genSetItems(rng.int(0, Math.max(0, n + 3)));
      // resynchronise the machine's List with the model's state (the model moved above without the machine)
      const S2 = env.S;
      T.poke8(env, A.addr + S2.List_sel, A.sel); T.poke8(env, A.addr + S2.List_top, A.top);
      if (A.bar) { T.poke8(env, A.bar.addr + S2.VScroll_value, A.bar.value); T.poke8(env, A.bar.addr + S2.VScroll_max, A.bar.max); T.poke8(env, A.bar.addr + S2.VScroll_page, A.bar.page); }
      if (rng.chance(0.5)) { setFocus(env, A.addr); tree.focus = A; st.focused++; } else { setFocus(env, 0); tree.focus = null; }
      st.n++; st.empty += items.length === 0; st.shorter += items.length <= n; st.longer += items.length > n; st.bar += !!A.bar; st.cell += cell;
      doSetItems(env, tree, sec, `window ${rep} (${x}, ${y}, ${w}, ${h}) flags ${hex(flags, 2)} bar ${!!A.bar}: TK_SETITEMS ${items.length} items (n = ${n})`, A, items, mark);
      sec.ok(m.ram[A.addr + S.List_sel] === FF && m.ram[A.addr + S.List_top] === 0, () => `after TK_SETITEMS: sel ${m.ram[A.addr + S.List_sel]} top ${m.ram[A.addr + S.List_top]}, want $FF and 0`);
      // then use it: a few keys, the same tree model against the machine
      for (let k = 0; k < 4; k++) X.feedEv(env, tree, sec, { t: M.E.KEY, key: rng.pick([10, 10, 11, 13]) }, `window ${rep} after TK_SETITEMS: key`);
    }
    T.clearTree(env, tree);
  }
  sec.end(`${st.n} calls (${st.empty} with no items, ${st.shorter} with <= n items, ${st.longer} with more, ${st.bar} with a bar, ${st.cell} cell-line lists, ${st.focused} with the focus)`);
}

// ===========================================================================================================================
// 5. Direct M_EVENT sends (T_SEND, DE -> a record that is not K_EV): which events a List consumes (the carry), E_CMD posts (A = 10, C = id, E = slot), E_SCROLL, E_MOVE with and without the capture
if (ONLY.includes(5)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('5 List M_EVENT direct: consumed (carry) for every key 0..255 and each pointer event, E_CMD posts, E_SCROLL through DE, E_MOVE only with the capture; state and screen against the model');
  const st = { keys: 0, consumed: 0, pointer: 0, scroll: 0, posts: 0, moveCap: 0, moveNo: 0, trees: 0 };
  for (let ti = 0; ti < NDIRECT && sec.nf < 12; ti++) {
    const tree = randTree2(), win = tree.win, A = tree.nodes().find((n) => n.id === 150);
    const ctxT = `window ${ti} (A (${A.x}, ${A.y}, ${A.w}, ${A.h}) flags ${hex(A.flags, 2)} count ${A.count} sel ${A.sel === FF ? '$FF' : A.sel} top ${A.top})`;
    if (!X.openTree(env, tree, sec, ctxT)) break;
    st.trees++;
    // the List has the focus (and the model says so)
    setFocus(env, A.addr); tree.focus = A;
    let vf = rng.int(100, 30000);
    const sel0 = A.sel;
    // pointer events here have K_EV = the record too (group 9 tests, strictly, that the List reads them through DE as 10.1 says); keys and E_SCROLL are strict
    const send = (ev, what) => X.sendDirect(env, tree, sec, `${ctxT}: ${what}`, A, ev, { kevSame: ev.t === M.E.DOWN || ev.t === M.E.MOVE || ev.t === M.E.UP });
    const keys = new Set([10, 11, 13, 12, 8, 9, 14, 15, 32, 27, 0, 255, 16, 17]);
    while (keys.size < 24) keys.add(rng.int(0, 255));
    for (const key of keys) {
      if (sec.nf > 12) break;
      // a state with a selection, and one without
      if (rng.chance(0.4)) { T.poke8(env, A.addr + S.List_sel, FF); A.sel = FF; syncDraw(env, A); }
      const r = send({ t: M.E.KEY, key }, `key ${key}`);
      st.keys++; if (r) { st.consumed += r.carry; st.posts += r.posts.length; }
    }
    for (let i = 0; i < 6 && sec.nf < 12; i++) {                                    // pointer events
      const geo = M2.listGeom(A), p = X.pointIn(rng, A);
      vf += rng.pick([1, 10, 20, 21, 30]);
      st.pointer++;
      const r1 = send({ t: M.E.DOWN, px: p[0], py: p[1], vf }, `E_DOWN (${p}) vf ${vf}`); if (r1) st.posts += r1.posts.length;
      send({ t: M.E.UP, px: p[0], py: p[1] }, `E_UP (${p})`);
      T.poke16(env, S.K_CAPTURE, 0); tree.capture = null;
      send({ t: M.E.MOVE, px: p[0], py: p[1] }, `E_MOVE, no capture`); st.moveNo++;
      T.poke16(env, S.K_CAPTURE, A.addr); tree.capture = A;
      send({ t: M.E.MOVE, px: rng.int(0, 511), py: rng.int(8, 191) }, `E_MOVE with the capture`); st.moveCap++;
      T.poke16(env, S.K_CAPTURE, 0); tree.capture = null;
    }
    for (let i = 0; i < 4 && sec.nf < 12; i++) {
      const val = rng.chance(0.3) ? rng.int(0, 255) : rng.int(0, Math.max(0, A.count - M2.listN(A)));
      send({ t: M.E.SCROLL, val, barId: 152 }, `E_SCROLL ${val}`); st.scroll++;
    }
    T.clearTree(env, tree);
  }
  sec.end(`${st.trees} windows, ${st.keys} keys (${st.consumed} consumed), ${st.pointer} press / release / move sets (${st.moveNo} E_MOVE without the capture, ${st.moveCap} with), ${st.scroll} E_SCROLL, ${st.posts} E_CMD posted`);
}

// ===========================================================================================================================
// 6. The double click: 20 frames and not 21, the third click starts again, other lines and other Lists, a press on a blank line, other controls in between (10.3 Pointer as amended by WRITE 14.9 item 2: the kernel's flag plus the List's own same-List / same-item / selection test)
if (ONLY.includes(6)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const { m, S } = env;
  const sec = new Sec('6 List double click: a second press on the selected line 20 frames after the first posts E_CMD, 21 does not; the memory is cleared by a post, by a press elsewhere in the List and by another List\'s press');
  const mkTree = (cell) => {
    const A = X.mkList(rng, 150, [80, 40, 100, 74], 1 | (cell ? 16 : 0), 14, { items: X.genItems(rng, 14).map((c) => (c.length ? c : [65])) }), B = X.mkList(rng, 151, [220, 40, 100, 74], 1 | (cell ? 16 : 0), 10);
    A.top = 0; A.sel = FF; B.top = 0; B.sel = FF;
    const chk = { kind: 'Check', id: 153, x: 90, y: 130, w: 72, h: 9, flags: 1, codes: T.codesOf('Opt') };
    return new M2.TkTree2({ x: 64, y: 24, w: 288, h: 136, slot: 0, title: T.codesOf('Click') }, [A, B, chk]);
  };
  for (const cell of [false, true]) {
    const tree = mkTree(cell), A = tree.nodes()[0], B = tree.nodes()[1], chk = tree.nodes()[2];
    if (!X.openTree(env, tree, sec, `cell ${cell}`)) break;
    let vf = 1000;
    const ctxOf = (s) => `${cell ? 'cell lines' : 'proportional'}: ${s}`;
    const geoA = M2.listGeom(A), lineY = (l, k) => { const g = M2.listGeom(l); return g.LY0 + g.P * k + 2; };
    const press = (l, k, at, expectPost, what) => {
      vf = at;
      const p = [l.x + 20, k === null ? l.y : lineY(l, k)];           // k null: the frame row (not an item)
      const r1 = X.feedEv(env, tree, sec, { t: M.E.DOWN, px: p[0], py: p[1], vf }, ctxOf(`${what}: E_DOWN vf ${vf}`));
      X.feedEv(env, tree, sec, { t: M.E.UP, px: p[0], py: p[1] }, ctxOf(`${what}: E_UP`));
      if (r1) sec.ok(r1.posts.length === (expectPost ? 1 : 0), () => ctxOf(`${what}: ${r1.posts.length} E_CMD posted at vf ${vf}, the contract says ${expectPost ? 1 : 0}`));
      if (r1 && expectPost) sec.ok(r1.posts[0].a === 10 && r1.posts[0].c === l.id && r1.posts[0].e === tree.win.slot, () => ctxOf(`${what}: post ${JSON.stringify(r1.posts[0])}`));
    };
    // gaps 0 .. 22 and 30: the first press selects item 2; the second, `gap` frames later, posts only when gap <= 20
    for (const gap of [0, 1, 10, 19, 20, 21, 22, 30]) {
      A.sel = FF; T.poke8(env, A.addr + S.List_sel, FF); syncDraw(env, A); tree.mem.list = null;
      press(A, 2, 1000, false, `gap ${gap}, first`);
      press(A, 2, 1000 + gap, gap <= 20, `gap ${gap}, second`);
    }
    // a third click starts again: press (select), press within 20 (post), press (select again, no post), press within 20 (post)
    A.sel = FF; T.poke8(env, A.addr + S.List_sel, FF); syncDraw(env, A); tree.mem.list = null;
    press(A, 1, 2000, false, 'third: 1st'); press(A, 1, 2005, true, 'third: 2nd'); press(A, 1, 2008, false, 'third: 3rd starts again'); press(A, 1, 2012, true, 'third: 4th');
    // another line in between: the memory is of the other line
    press(A, 3, 3000, false, 'line 3'); press(A, 4, 3002, false, 'line 4 in between'); press(A, 3, 3004, false, 'line 3 again: the memory is line 4\'s');
    press(A, 3, 3010, true, 'line 3 twice');
    // a press on a blank / frame row of the List clears the memory
    press(A, 2, 4000, false, 'blank: item'); press(A, null, 4002, false, 'blank: the frame row'); press(A, 2, 4004, false, 'blank: the item again after the frame row');
    // the same row of another List: the memory is B's now
    press(A, 2, 5000, false, 'other List: A'); press(B, 2, 5002, false, 'other List: B'); press(A, 2, 5004, false, 'other List: A again');
    // a press on a Check in between: the memory stays (the last E_DOWN taken by a List)
    press(A, 5, 6000, false, 'Check: A');
    { vf = 6003; const p = X.pointIn(rng, chk); X.feedEv(env, tree, sec, { t: M.E.DOWN, px: p[0], py: p[1], vf }, ctxOf('Check press')); X.feedEv(env, tree, sec, { t: M.E.UP, px: p[0], py: p[1] }, ctxOf('Check release')); }
    press(A, 5, 6006, false, 'Check: A again (the press before it was on the Check, far away: the kernel does not flag it; WRITE 14.9)');
    // the item must be selected for the post: a selection by the keys in between breaks it
    press(A, 4, 7000, false, 'keys: A line 4');
    X.feedEv(env, tree, sec, { t: M.E.KEY, key: 10 }, ctxOf('key DOWN'));            // the selection moves to item 5
    press(A, 4, 7003, false, 'keys: line 4 again, but it is not the selected line');
    T.clearTree(env, tree);
  }
  sec.end(`2 modes, gaps 0 to 30 around the 20-frame limit, the third click, other lines, blank rows, the other List, a Check in between, a key move in between`);
}

// ===========================================================================================================================
// 7. Stack (<= 64 bytes in M_DRAW and M_EVENT), registers, DI: the figures seen in the direct calls of groups 2 and 5 and all stepped calls
if (ONLY.includes(7)) {
  const sec = new Sec('7 List: stack of M_DRAW and M_EVENT <= 64 bytes, IX / IY / the alternate set kept, SP right after every return, no DI (over every stepped call of this run)');
  sec.ok(X.stk.draw > 0 || !ONLY.includes(2), 'group 2 has run M_DRAW');
  sec.ok(X.stk.draw <= 64, () => `M_DRAW used ${X.stk.draw} bytes of stack (${X.stk.drawWhat}), bound 64`);
  sec.ok(X.stk.event <= 64, () => `M_EVENT used ${X.stk.event} bytes of stack (${X.stk.eventWhat}), bound 64`);
  sec.ok(X.totals.di === 0, () => `${X.totals.di} DI instruction(s) executed in the stepped calls`);
  sec.ok(X.totals.badPreserved === 0, () => `${X.totals.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(X.totals.badSp === 0, () => `${X.totals.badSp} call(s) returned with a wrong SP`);
  sec.end(`deepest M_DRAW ${X.stk.draw} bytes (${X.stk.drawWhat}), deepest M_EVENT ${X.stk.event} bytes (${X.stk.eventWhat}), deepest K_DISPATCH step ${X.totals.maxStack}`);
}

// ===========================================================================================================================
// 8. The memory watch of BANKING 10.7 and V_FRAMES over every machine of this run
if (ONLY.includes(8)) {
  const sec = new Sec('8 memory watch (BANKING 10.7), no pointer to DOCK 2-3 / 6 handed to K code');
  envs.forEach((env, i) => {
    sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`);
  });
  sec.end(`${envs.length} machines`);
}
// ===========================================================================================================================
// 9. 10.1: "A List reads every event through DE": the pointer events too, with K_EV holding garbage and DE -> the record
if (ONLY.includes(9)) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const sec = new Sec('9 List E_DOWN / E_MOVE / E_UP read through DE (K_EV holds garbage, DE -> the record elsewhere): the press selects the line it is on, as 10.1 says');
  let n = 0;
  for (let ti = 0; ti < 10 && sec.nf < 6; ti++) {
    const tree = randTree2(), A = tree.nodes().find((q) => q.id === 150);
    if (!X.openTree(env, tree, sec, `window ${ti}`)) break;
    X.sendDirect(env, tree, sec, `window ${ti}: E_DOWN read through DE`, A, { t: M.E.DOWN, px: A.x + 10, py: M2.listGeom(A).LY0 + 1, vf: 5000 + 100 * ti }); n++;   // 100 frames apart: each window's List is new but at the same arena address, so presses 1 frame apart would be a double click (10.3)
    T.clearTree(env, tree);
  }
  sec.end(`${n} presses on the first line`);
}
// ===========================================================================================================================
// 9b. WRITE 14.9 items 2 and 9: the double-click flag is read from K_EV + 3 bit 2 (the same record the kernel's own pointer code reads); the record DE points to is read for the type, data 1 and y
if (ONLY.includes(9) || ONLY.includes('9b')) {
  const env = T.bootParked({ rng, cart: 'desk5l' }); envs.push(env);
  T.needSyms(env, T.NEEDED2);
  const sec = new Sec('9b List double-click flag read from K_EV + 3 bit 2 (WRITE 14.9 item 9): with the record DE points to carrying the opposite flag, the List follows K_EV\'s (a flagged K_EV on the selected, remembered item posts E_CMD; an unflagged one does not)');
  let n = 0, posts = 0;
  for (let ti = 0; ti < 30 && sec.nf < 6; ti++) {
    const tree = randTree2(), A = tree.nodes().find((q) => q.id === 150);
    if (!X.openTree(env, tree, sec, `window ${ti}`)) break;
    if (A.count < 1) { T.clearTree(env, tree); continue; }
    const p = [A.x + 10, M2.listGeom(A).LY0 + 1];
    const flagged = ti % 2 === 0;       // the flag in K_EV on press 2; DE's record carries the opposite
    // press 1: unflagged in K_EV (DE flagged): selects the item and remembers it
    X.sendDirect(env, tree, sec, `window ${ti}: press 1 (unflagged in K_EV, flagged in DE)`, A, { t: M.E.DOWN, px: p[0], py: p[1], vf: 9000 + 100 * ti, dbl: false }, { garb: T.ptRec(M.E.DOWN, p[0], p[1], 1, 0), deDbl: true });
    const r = X.sendDirect(env, tree, sec, `window ${ti}: press 2 (${flagged ? 'flagged in K_EV, unflagged in DE' : 'unflagged in K_EV, flagged in DE'})`, A, { t: M.E.DOWN, px: p[0], py: p[1], vf: 9002 + 100 * ti, dbl: flagged }, { garb: T.ptRec(M.E.DOWN, p[0], p[1], 1, flagged), deDbl: !flagged });
    n++; if (r) { posts += r.posts.length; sec.ok(r.posts.length === (flagged ? 1 : 0), () => `window ${ti}: press 2 ${flagged ? 'flagged in K_EV (DE unflagged)' : 'unflagged in K_EV (DE flagged)'}: ${r.posts.length} E_CMD posted, want ${flagged ? 1 : 0}`); }
    T.clearTree(env, tree);
  }
  sec.end(`${n} second presses, ${posts} E_CMD posted`);
}
finish();
