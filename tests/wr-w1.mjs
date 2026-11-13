"use strict";
// wr-w1.mjs -- Write slice W1 (docs/WRITE.md 1-11) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).  8 items 1-5 of WRITE.md, plus the bounds'
// stack / DI rows.  Written from the contract only (WRITE 1-11, TOOLKIT 9.3 / 10.4, SHELL 10); src/apps/write.asm, src/apps/shell.asm and src/kernel/*.asm were never read.
// The reference is tests/wr-model.mjs; the harness is tests/wr-lib.mjs (on tests/calc-lib.mjs, tests/tk-lib.mjs, tests/tk-lib2.mjs).
//   node tests/wr-w1.mjs [--seed N] [--nseq N] [--nsteps N] [--ncover N] [--nclip N] [--only LIST] [--verbose]
//     --nseq N     random documents in the editing groups 1-4 (default 28), --nsteps N steps on each (default 40)
//     --ncover N   covering windows in group 3b (default 12), each with 20 steps;  --nclip N  random clips in group 3c (default 120)
//     --only LIST  groups: 0 model hand cases, 1 document and caret, 2 line table (the wrapper), 3 screen (3 = the steps, 3b covered, 3c clips), 4 bar and scrolling (+ hand cases),
//                  5 the limits (full buffer, 1,024 lines), 6 consumed / not consumed (M_EVENT direct), 7 quit / "New" / the dialog (real frames), 8 stack / DI / registers, 9 memory watch
//                  (default all).  Groups 1-4 share one run of random steps (a failure in a step is attributed to the group of the thing that differed).
// The last line is "wr-w1: N of M groups pass"; exit code 1 on any failure.
import * as W from './wr-lib.mjs';

const { L, T, X, WM, hex, rd16, E } = W;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NSEQ = argNum('--nseq', 28), NSTEPS = argNum('--nsteps', 40), NCOVER = argNum('--ncover', 12), NCLIP = argNum('--nclip', 120);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['0', '1', '2', '3', '3b', '3c', '4', '5', '6', '7', '8', '9'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('wr-w1', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NSEQ} documents x ${NSTEPS} steps, ${NCOVER} covers, ${NCLIP} clips`);
const envs = [];
const newEnv = () => { const e = W.bootWrite({ rng }); envs.push(e); return e; };
const LET = WM.codesOf('abcdefghijklmnopqrstuvwxyz');
const PRINT = (() => { const o = []; for (let c = 32; c <= 126; c++) o.push(c); return o; })();
const fails = (...secs) => secs.reduce((n, s) => n + s.nf, 0);

// ===========================================================================================================================
// 0. The model's own hand-worked cases
if (has('0')) {
  const sec = new Sec('0 wr-model hand-worked cases (11.4 wrapping, 11.5 caret / UP / DOWN / click / shown / bar, the limits, the looks)');
  const out = []; const bad = WM.selfTest(out);
  sec.n = out.length; sec.nf = bad;
  for (const l of out) if (l.startsWith('FAIL')) sec.fails.push(l);
  sec.end(`${out.length} cases`);
}

// ===========================================================================================================================
// The action generator: legal for the model's ambiguities (see wr-model.mjs R4, R5, R7)
const sizes = [0, 0, 12, 60, 150, 300, 450, 700, 1000];
function applyTo(c, a) {
  if (a.k === 'key') return W.Doc_key(c, a.code);
  if (a.k === 'click') return c.click(a.px, a.py);
  if (a.k === 'scroll') return c.scrollTo(a.v);
  if (a.k === 'bar') { const p = W.barPlan(c, a.part, a.py2); if (!p) return false; p.tells.forEach((v) => c.scrollTo(v)); return true; }
  return false;
}
function pickAction(doc, mode) {
  const typing = mode === 'typing';
  for (let tries = 0; tries < 40; tries++) {
    const r = rng.next(); let a;
    const t = typing ? [0.62, 0.70, 0.76, 0.82, 0.84, 0.86, 0.90, 0.94, 0.97, 0.985, 1] : [0.30, 0.38, 0.44, 0.54, 0.60, 0.66, 0.74, 0.82, 0.90, 0.95, 1];
    if (r < t[0]) a = { k: 'key', code: rng.chance(0.85) ? rng.pick(LET) : rng.pick(PRINT) };
    else if (r < t[1]) a = { k: 'key', code: 32 };
    else if (r < t[2]) a = { k: 'key', code: 13 };
    else if (r < t[3]) a = { k: 'key', code: 12 };
    else if (r < t[4]) a = { k: 'key', code: 8 };
    else if (r < t[5]) a = { k: 'key', code: 9 };
    else if (r < t[6]) a = { k: 'key', code: 11 };
    else if (r < t[7]) a = { k: 'key', code: 10 };
    else if (r < t[8]) a = { k: 'click', px: rng.chance(0.15) ? rng.pick([24, 25, 26, 27, 28, 470, 471]) : rng.int(24, 471), py: rng.chance(0.2) ? rng.int(150, 173) : rng.int(30, 173) };
    else if (r < t[9]) { if (doc.run !== null) continue; a = rng.chance(0.5) ? { k: 'scroll', v: rng.int(0, doc.bar().max) } : { k: 'bar', part: rng.pick(['up', 'down', 'pgup', 'pgdn', 'thumb']), py2: rng.int(38, 170) }; }
    else { if (doc.run !== null) continue; a = { k: 'key', code: rng.pick([14, 15, 27, 3, 0, 5, 17, 127, 128, 200, 255, 31]) }; }
    const c = doc.clone(); applyTo(c, a);
    const ln = doc.caretLine(), off = ln < doc.top || ln >= doc.top + WM.NSHOWN;
    if (off && a.k === 'key' && !((a.code >= 32 && a.code <= 126) || a.code === 13) && c.caret === doc.caret && c.L === doc.L) continue;   // R5: a no-op while the caret is off screen: whether the view follows is not settled
    if (a.k === 'bar' && !W.barPlan(doc, a.part, a.py2)) continue;
    return a;
  }
  return { k: 'key', code: 97 };
}
function perform(drv, a) {
  switch (a.k) {
    case 'key': return drv.key(a.code);
    case 'click': return drv.click(a.px, a.py);
    case 'scroll': return drv.scroll(a.v);
    case 'bar': return drv.barClick(a.part, a.py2);
    default: return null;
  }
}
/** Type `target` into a fresh machine (W.loadDoc), check it, and run `nSteps` random steps; stops the sequence at the first failing step. */
function runSequence(drv, target, nSteps, mode, st) {
  const env = drv.env, doc = W.loadDoc(env, target);
  drv.doc = doc;
  drv.trail = []; drv.verify(`typed ${doc.L} codes`);
  if (drv.total() > 0) return false;
  for (let i = 0; i < nSteps; i++) {
    const n0 = drv.total();
    const a = pickAction(doc, mode);
    perform(drv, a);
    if (doc.topBeyond()) st.beyond++;
    if (a.k === 'key' && doc.nl > st.maxLines) st.maxLines = doc.nl;
    if (drv.total() > n0) return false;
  }
  return true;
}

// ===========================================================================================================================
// 1-4. The random steps
const s1 = new Sec('1 document and caret: random editing (letters, space, ENTER, DELETE, LEFT, RIGHT, UP / DOWN with the target-x run, clicks, keys not consumed) through K_DISPATCH on documents of 0-1,000 codes typed into a fresh machine (the buffer is never poked: the cartridge keeps state of its own beside WR_GS / WR_GE); the gap buffer (WR_BUF / WR_GS / WR_GE) read back as text, the caret, WR_TOP, WR_CHG, K_FOCUS, K_CAPTURE and the W_DRAWVIEW addresses after each step');
const s2 = new Sec('2 line table: WR_NL and the bytes of WR_LT against the wrapper of 11.4 (long words, runs of spaces, empty paragraphs, words wider than W, the 255-code cap) after each step');
const s3 = new Sec('3 screen: the window\'s rectangle against wr-model\'s rendering (window, close box, text view, caret, bar) and the pixels outside it unchanged, after each step, scrolling steps included');
const s4 = new Sec('4 bar and scrolling: the bar\'s value / max / page (the scale k of 11.5) and E_SCROLL from the bar through its real tracking loop (arrows, pages, thumb): top changes, the caret does not; the caret kept shown');
let mainDrv = null; const st = { beyond: 0, maxLines: 0 };
if (['1', '2', '3', '4'].some(has)) {
  const env = newEnv(); W.parkDirect(env);
  const secs = { doc: s1, lt: s2, scr: s3, bar: s4 };
  const drv = mainDrv = new W.Drv(env, secs, new WM.Doc());
  // the first document is empty, typed from nothing
  runSequence(drv, new WM.Doc(), Math.max(NSTEPS, 80), 'typing', st);
  for (let i = 0; i < NSEQ && fails(s1, s2, s3, s4) < 12; i++) {
    const n = rng.pick(sizes), doc = W.randomDoc(rng, n);
    if (rng.chance(0.2)) doc.top = Math.min(doc.caretLine(), doc.top + 3);
    runSequence(drv, doc, NSTEPS, i % 3 === 0 ? 'typing' : 'edit', st);
  }
  const t = drv.stat;
  s1.note(`${t.steps} steps: ${t.keys} keys (${t.noops} that changed nothing), ${t.clicks} clicks, ${t.scrolls} E_SCROLL, ${t.barClicks} bar clicks; ${st.beyond} steps ended with top beyond the last page, the longest document had ${st.maxLines} lines`);
}
if (has('1')) s1.end();
if (has('2')) s2.end();
if (has('3')) s3.end();            // group 4 ends after its hand cases below

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3b. A plain Window over Write: its draws go through W_DRAWVIEW, so the covered part must stay the cover's
if (has('3b')) {
  const sec = new Sec('3b covered window: a plain Window over part of Write; each step\'s draws leave the cover alone and the rest of Write equals the model (Write behind: inactive look, no close box); the cover closed, Write is whole again');
  const env = newEnv(); W.parkDirect(env);
  const secs = { doc: sec, lt: sec, scr: sec, bar: sec };
  const drv = new W.Drv(env, secs, new WM.Doc());
  let ok = 0, skipped = 0;
  for (let i = 0; i < NCOVER && sec.nf < 8; i++) {
    const cx = 16 * rng.int(9, 22), cy = 8 * rng.int(4, 14), rect = { x: cx, y: cy, w: 16 * rng.int(5, Math.min(13, (512 - cx) / 16)), h: 8 * rng.int(5, Math.min(12, (192 - cy) / 8)) };           // windows sit on the 16 x 8 cell grid (WINDOWS 3)
    const doc = W.loadDoc(env, W.randomDoc(rng, rng.pick([100, 300, 600])));
    const cover = W.openCover(env, rect, 'Cover');
    if (!cover) { skipped++; sec.note('W_OPEN of the covering window failed (arena?)'); continue; }
    if (rd16(env.m, env.S.K_FOCUS) !== W.objs(env).tv) { skipped++; sec.note('K_SETFOCUS did not give the text view the focus while it is behind a plain Window: covered steps skipped'); W.closeCover(env, cover); continue; }
    drv.covers = [cover]; drv.doc = doc;
    W.drawTv(env);                                                       // a full draw of the text view, as W_DRAWVIEW under the cover's clip
    drv.trail = []; drv.verify(`cover (${rect.x}, ${rect.y}, ${rect.w}, ${rect.h}) over ${doc.L} codes`);
    for (let k = 0; k < 20 && sec.nf < 8; k++) {
      const a = pickAction(doc, k % 2 ? 'edit' : 'typing');
      if (a.k === 'click' || a.k === 'bar') continue;           // a pointer press on a window behind the front one raises it (the desk's rule): not a covered-draw test
      const n0 = drv.total(); perform(drv, a); if (drv.total() > n0) break;
    }
    W.closeCover(env, cover); drv.covers = [];
    drv.verify('the cover closed');
    ok++;
  }
  sec.end(`${ok} covers (${skipped} skipped), ${drv.stat.steps} steps`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 3c. M_DRAW under a random clip (a covered window's visible part): the same pixels as a full draw
if (has('3c')) {
  const sec = new Sec('3c M_DRAW of the text view under a random clip (W_DRAWVIEW gives it one per visible rectangle): the display equals the model\'s full draw inside the clip, GCLIP put back; focused and not');
  const env = newEnv(); W.parkDirect(env);
  const { S } = env, o = W.objs(env);
  let n = 0;
  for (let i = 0; i < NCLIP && sec.nf < 8; i++) {
    if (i % 12 === 0) sec.doc = W.loadDoc(env, W.randomDoc(rng, rng.pick([0, 120, 300, 700])));
    const doc = sec.doc, foc = rng.chance(0.6);
    if (foc) W.focusTv(env); else T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
    const tv = WM.TVR, x0 = rng.int(tv.x - 10, tv.x + tv.w - 1), y0 = rng.int(tv.y - 6, tv.y + tv.h - 1);
    const clip = rng.chance(0.2) ? [tv.x, tv.y, tv.w, tv.h] : [x0, y0, rng.int(1, 160), rng.int(1, 70)];
    // the caret is drawn when the text view has the focus: K_FOCUS decides
    X.drawUnderClip(env, sec, `${W.describe(doc)}, focus ${foc}, clip ${clip}`, { addr: o.tv }, (g) => WM.tvLook(g, doc, foc), clip);
    n++;
  }
  W.focusTv(env);
  sec.end(`${n} clips`);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 4 (hand cases). The bar's scale and E_SCROLL on documents of exactly 17, 100, 271, 272, 526, 527 and 1,024 lines
if (has('4')) {
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv(env, { doc: s4, lt: s4, scr: s4, bar: s4 }, new WM.Doc());
  const lines = [17, 100, 271, 272, 526, 527, 1024];
  const seen = {};
  for (const nl of lines) {
    if (s4.nf > 12) break;
    const t0 = new WM.Doc(new Array(nl - 1).fill(13), nl - 1); t0.top = null;
    const d = W.loadDoc(env, t0, `enters${nl}`);   // nl - 1 paragraph ends: nl lines, the caret in the last, top = M
    seen[nl] = `k ${d.k} max ${d.bar().max} page ${d.bar().page}`;
    drv.doc = d; drv.trail = [];
    drv.verify(`${nl} lines, top ${d.top} (the caret in the last line)`);
    for (const v of [0, 1, d.bar().max >> 1, d.bar().max, 255]) { const n0 = drv.total(); drv.scroll(v); if (drv.total() > n0) break; }
    for (const part of ['up', 'down', 'pgup', 'pgdn', 'thumb', 'thumb']) { const n0 = drv.total(); drv.barClick(part, rng.int(40, 165)); if (drv.total() > n0) break; }
    // the caret key brings the view back to the caret's line (shown), top = caret line - 15 or the caret line
    drv.key(11); drv.key(10);
  }
  // every scroll distance d = 1..20 (and a few larger) down and up on a document of text (an ENTER-only document hides a scroll that loses text): 11.1 "G_SCROLLV, then the lines that meet the
  // uncovered rows"; a scroll by more than the lines shown less one is a full draw (WRITE 5)
  {
    const t = new WM.Doc(WM.genText(rng, 2600, { para: 0.004 })); t.caret = t.L; t.top = null;
    const d = W.loadDoc(env, t, 'text-scroll'); drv.doc = d; drv.trail = [];
    drv.verify(`a text document of ${d.nl} lines for the scroll distances`);
    const bad = [];
    for (const dist of [1, 2, 3, 4, 5, 7, 8, 9, 12, 14, 15, 16, 17, 20, 30]) {
      for (const dir of [1, -1]) {
        if (s4.nf > 12) break;
        const a0 = Math.min(d.M, 24) - (dir === 1 ? dist : 0), from = dir === 1 ? Math.max(0, d.top - dist) : Math.min(d.M, d.top + dist);
        void a0; void from;
        const start = dir === 1 ? Math.min(d.M - dist, 25) : 25 - dist > 0 ? 25 - dist : 0;   // top before the step, so that top + dir * dist stays inside 0..M
        const lo = dir === 1 ? Math.max(0, Math.min(25, d.M - dist)) : Math.min(d.M, 25 + dist);
        const n0 = drv.total();
        drv.scroll(lo);                                                    // to the start position (any distance)
        drv.scroll(lo + dir * dist);                                       // the distance under test
        void start;
        if (drv.total() > n0) bad.push(`${dir === 1 ? 'down' : 'up'} ${dist}`);
      }
    }
    if (bad.length) s4.note(`scroll distances that failed: ${bad.join(', ')}`);
  }
  // hand-worked: 20 ENTERs, top 5; the caret kept shown (11.5): UP x 17 -> top 3, E_SCROLL 100 -> top = M = 5, the caret stays in line 3 (off screen: no caret drawn)
  {
    const d = W.loadDoc(env, new WM.Doc()); drv.doc = d; drv.trail = [];
    for (let i = 0; i < 20; i++) drv.key(13);
    s4.ok(d.top === 5 && W.readState(env).top === 5 && W.readState(env).nl === 21, () => `20 ENTERs: top ${W.readState(env).top}, lines ${W.readState(env).nl}, hand-worked top 5, 21 lines`);
    for (let i = 0; i < 17; i++) drv.key(11);
    s4.ok(W.readState(env).top === 3 && W.readState(env).gs === 3, () => `UP x 17: top ${W.readState(env).top}, caret ${W.readState(env).gs}; hand-worked top 3, caret 3`);
    drv.scroll(100);
    s4.ok(W.readState(env).top === 5 && W.readState(env).gs === 3, () => `E_SCROLL 100: top ${W.readState(env).top}, caret ${W.readState(env).gs}; hand-worked top 5 (= max), caret unchanged`);
    drv.key(9);
    s4.ok(W.readState(env).top === 4, () => `RIGHT with the caret off screen: top ${W.readState(env).top}, hand-worked 4 (caret 3 -> 4 is line 4, above top 5: top = 4)`);
  }
  // (R6, now settled by the coordinator) lines deleted near the end: top stays past the last page, the bar holds min(floor(top / k), max)
  {
    const t0 = new WM.Doc(new Array(24).fill(13), 24); t0.top = null;
    const d = W.loadDoc(env, t0, 'enters25');       // 25 lines, M = 9, top 9 (caret in the last line)
    drv.doc = d; drv.trail = []; drv.verify('25 lines, top 9');
    for (let i = 0; i < 8; i++) drv.key(12);                                             // 17 lines: M = 1, top stays 9, the caret in line 16 (shown: 9..24)
    s4.ok(d.top === 9 && d.nl === 17 && W.readState(env).top === 9, () => `8 DELETEs at the end of 25 lines: top ${W.readState(env).top}, model ${d.top}; (WRITE 11.5: top does not move)`);
    s4.ok(W.readState(env).bar.value === 1 && W.readState(env).bar.max === 1, () => `the bar holds ${W.readState(env).bar.value} / ${W.readState(env).bar.max}, hand-worked min(9, 1) = 1 / 1`);
  }
  s4.note(`bar scales: ${Object.entries(seen).map(([k, v]) => `${k} lines: ${v}`).join('; ')}`);
  s4.end(`${drv.stat.steps} steps, ${drv.stat.barClicks} bar clicks, ${drv.stat.scrolls} E_SCROLL`);
}

// ===========================================================================================================================
// 5. The limits
if (has('5')) {
  const sec = new Sec('5 the limits: a full buffer (L = 5,120) and 1,024 lines: a code or ENTER changes nothing and draws nothing; DELETE, LEFT, RIGHT, UP, DOWN and clicks still work; one DELETE frees a place');
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv(env, { doc: sec, lt: sec, scr: sec, bar: sec }, new WM.Doc());
  const run = (title, target, key, script) => {
    const d = W.loadDoc(env, target, key);
    drv.doc = d; drv.trail = [];
    drv.verify(title);
    for (const a of script) { const n0 = drv.total(); perform(drv, a); if (drv.total() > n0) return d; }
    return d;
  };
  const K = (code) => ({ k: 'key', code });
  // a full buffer of text (about 60 lines), typed once (a snapshot), the caret at the end / the start / the middle
  {
    const t = new WM.Doc(WM.genText(rng, WM.CAP, { para: 0.02 }));
    t.caret = t.L; t.top = null;
    for (const where of ['end', 'start', 'middle']) {
      const pre = where === 'end' ? [] : where === 'start' ? [{ k: 'scroll', v: 0 }, { k: 'click', px: 25, py: 31 }] : [{ k: 'scroll', v: 12 }, { k: 'click', px: 250, py: 100 }];
      const d = run(`full buffer, caret at the ${where}`, t, 'full', pre);
      const n0 = drv.total();
      for (const a of [K(97), K(13), K(32), K(97), K(8), K(9), K(11), K(10), { k: 'click', px: 200, py: 100 }, K(97), K(12), K(97), K(97), K(13), K(12), K(13), K(13)]) { perform(drv, a); if (drv.total() > n0) break; }
      s5state(sec, d); sec.note(`full buffer: L ${d.L}, ${d.nl} lines`);
    }
  }
  // 1,023 lines (1,022 ENTERs): one more ENTER is allowed, then refused; DELETE frees one
  {
    const t = new WM.Doc(new Array(1022).fill(13), 1022); t.top = null;
    const d = run('1,023 lines (1,022 ENTERs): ENTER is allowed once, then refused', t, 'e1022', [K(97), K(13), K(13), K(97), K(32), K(12), K(13), K(13), K(12), K(97), K(97), K(13)]);
    s5state(sec, d);
    const n0 = drv.total();
    for (const a of [K(13), K(8), K(11), K(11), K(97), K(12), K(97), { k: 'bar', part: 'thumb', py2: 100 }, { k: 'bar', part: 'down' }, K(10)]) { perform(drv, a); if (drv.total() > n0) break; }
  }
  // 1,023 lines made of short paragraphs "ab" + ENTER (3,066 codes): a letter at the end adds no line and is allowed, the ENTER after it reaches 1,024, then letters and ENTER are refused
  {
    const codes = []; for (let i = 0; i < 1022; i++) codes.push(97, 98, 13);
    const t = new WM.Doc(codes, codes.length); t.top = null;
    const d = run('1,023 lines of "ab": a letter allowed, ENTER allowed once, then everything but DELETE refused', t, 'ab1022', [K(99), K(13), K(100), K(13), K(32), K(12), K(100), K(8), K(8), K(13)]);
    s5state(sec, d);
  }
  sec.end(`${drv.stat.steps} steps`);
}
function s5state(sec, d) { sec.ok(d.nl <= WM.MAXLINES + 1 && d.L <= WM.CAP, () => `model: ${d.nl} lines, L ${d.L}`); }

// ===========================================================================================================================
// 6. M_EVENT directly: consumed (carry) for every key 0..255, the pointer events, E_SCROLL
if (has('6')) {
  const sec = new Sec('6 consumed: M_EVENT of the text view by T_SEND (DE and K_EV -> the record): carry exactly for 32-126, DELETE, LEFT, RIGHT, UP, DOWN, ENTER; E_DOWN and E_UP consumed (E_SCROLL: not judged), E_MOVE only with the capture; state and screen against the model');
  const env = newEnv(); W.parkDirect(env);
  const drv = new W.Drv(env, { doc: sec, lt: sec, scr: sec, bar: sec }, new WM.Doc());
  const { S } = env, o = W.objs(env);
  let n = 0;
  for (let rep = 0; rep < 3 && sec.nf < 8; rep++) {
    const t0 = W.randomDoc(rng, 300); t0.changed = true; const d = W.loadDoc(env, t0); drv.doc = d; drv.trail = [];
    const codes = []; for (let c = 0; c < 256; c++) codes.push(c);
    for (let i = codes.length - 1; i > 0; i--) { const j = rng.int(0, i); [codes[i], codes[j]] = [codes[j], codes[i]]; }
    for (const code of codes) {
      if (sec.nf > 8) break;
      if (d.run !== null && !WM.Doc.consumes(code)) continue;       // an unconsumed key in a run: whether it ends the run is not settled (R7)
      if (code === 12 && d.caret === 0) continue;
      const ln = d.caretLine(); if ((ln < d.top || ln >= d.top + 16) && !(code >= 32 && code <= 126) && code !== 13) continue;
      drv.direct(W.keyRec(code), `M_EVENT key ${code}`); n++;
    }
    for (let i = 0; i < 6 && sec.nf < 8; i++) {
      const px = rng.int(24, 471), py = rng.int(30, 173);
      drv.direct(W.ptRec(E.DOWN, px, py, 1), `M_EVENT E_DOWN (${px}, ${py})`);
      T.poke16(env, S.K_CAPTURE, 0); drv.direct(W.ptRec(E.MOVE, px, py, 1), 'M_EVENT E_MOVE, no capture');
      T.poke16(env, S.K_CAPTURE, o.tv); drv.direct(W.ptRec(E.MOVE, rng.int(0, 511), rng.int(8, 191), 1), 'M_EVENT E_MOVE with the capture');
      drv.direct(W.ptRec(E.UP, px, py, 0), 'M_EVENT E_UP'); T.poke16(env, S.K_CAPTURE, 0);
      if (d.run === null) drv.direct([E.SCROLL, rng.int(0, d.bar().max + 2), 2, 0], 'M_EVENT E_SCROLL');
      n++;
    }
  }
  sec.end(`${n} sends`);
}

// ===========================================================================================================================
// 7. Quit, "New", the dialog: real frames from the shell
if (has('7')) {
  const sec = new Sec('7 quit and "New" (11.6): without changes K_QUIT / the document emptied with no dialog; with changes the Dialog (128, 64, 256, 64) "Discard the document?" with Discard (default, ENTER) and Cancel (ESC, BREAK), by keys and clicks; Cancel keeps everything, Discard goes ahead; the changed flag; modal');
  const env = newEnv(), { m, S } = env;
  let doc = new WM.Doc(), n = 0;
  const waitFor = (f, max = 90) => { for (let i = 0; i <= max; i++) { if (f()) return true; if (i < max) env.frame(); } return false; };
  const writeUp = () => L.progUp(env, 3);
  const dialogUp = () => { const ws = L.openWindows(m, S); return ws.length === 2 && ws.some((w) => w.cls === S.CL_Dialog && w.x === 128 && w.y === 64 && w.w === 256 && w.h === 64); };
  const typeStr = (s) => { for (const c of s) { L.typeCode(env, c.charCodeAt(0), 3, 3); doc.key(c.charCodeAt(0)); } env.frames_(6); };
  const state = (what, opts = {}) => {
    const sd = W.stateDiff(env, doc), d = sd.doc.concat(sd.lt, sd.bar).filter((x) => !(opts.focusOk && x.startsWith('K_FOCUS')));
    sec.ok(d.length === 0, () => `${what}: ${d[0]} [${W.describe(doc)}]`); n++;
  };
  const screen = (what, o = {}) => { const d = W.liveDiff(env, doc, { full: true, dialog: !!o.dialog, covers: [] }); sec.ok(d === null, () => `${what}: screen ${d}`); n++; };
  const dialogChecks = (what) => {
    sec.ok(dialogUp() && rd16(m, S.W_MODAL) !== 0, () => `${what}: the dialog is up (windows ${JSON.stringify(L.openWindows(m, S).map((w) => [w.title, w.x, w.y, w.w, w.h]))}, W_MODAL ${hex(rd16(m, S.W_MODAL))})`);
    const o = W.objs(env), views = L.allViews(m, S), dlg = o.dlg;
    sec.ok(dlg !== 0 && views.some((v) => v.a === dlg), () => `${what}: WR_DLG ${hex(dlg)} is not in the view tree`);
    if (dlg) {
      const btn = (r) => views.find((v) => v.cls === S.CL_Button && v.x === r.x && v.y === r.y && v.w === r.w && v.h === r.h);
      const bd = btn(WM.DLG.discard), bc = btn(WM.DLG.cancel), lb = views.find((v) => v.cls === S.CL_Label && v.x === 144 && v.y === 76 && v.w === 200 && v.h === 9);
      sec.ok(!!bd && !!bc && !!lb, () => `${what}: the dialog's Label (144, 76, 200, 9) ${!!lb}, Discard (224, 100, 64, 16) ${!!bd}, Cancel (304, 100, 64, 16) ${!!bc}`);
      if (bd && bc) {
        sec.ok(bd.id === 1 && bc.id === 2 && rd16(m, dlg + S.Dialog_default) === bd.a && rd16(m, dlg + S.Dialog_cancel) === bc.a, () => `${what}: ids ${bd.id} / ${bc.id} (want 1 / 2), Dialog_default ${hex(rd16(m, dlg + S.Dialog_default))} (Discard ${hex(bd.a)}), Dialog_cancel ${hex(rd16(m, dlg + S.Dialog_cancel))} (Cancel ${hex(bc.a)})`);
        sec.ok(rd16(m, S.K_FOCUS) === bd.a, () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}, the default button Discard is ${hex(bd.a)}`);
        return { discard: bd, cancel: bc };
      }
    }
    return null;
  };
  const closed = (what) => {
    const ok = waitFor(() => L.openWindows(m, S).length === 1 && rd16(m, S.W_MODAL) === 0, 60); env.frames_(20);       // the button's 4-frame flash, then E_CMD, then the repaint
    sec.ok(ok && writeUp(), () => `${what}: the dialog closed and Write is the one window (windows ${JSON.stringify(L.openWindows(m, S).map((w) => w.title))}, K_PROG ${m.ram[S.K_PROG]})`);
    sec.ok(rd16(m, S.K_FOCUS) === W.objs(env).tv, () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))} after the dialog, the text view ${hex(W.objs(env).tv)}`);   // CONTRACT? the only focusable view
  };
  const newItem = () => { H_leap(env); };
  const click = (v) => L.click(env, v.x + (v.w >> 1), v.y + (v.h >> 1), 3, 6);
  const relaunch = () => { const ok = L.launchByDoubleClick(env, 3); env.frames_(12); doc = new WM.Doc(); sec.ok(ok && writeUp(), 'Write launched again from the shell'); return ok; };
  const toShell = (what) => { const ok = waitFor(() => L.progUp(env, 0), 60); sec.ok(ok, () => `${what}: K_QUIT reached (the shell did not come back; K_PROG ${m.ram[S.K_PROG]})`); n++; return ok; };
  const noQuit = (what) => { env.frames_(25); sec.ok(m.ram[S.K_PROG] === 3 && L.openWindows(m, S).length >= 1, () => `${what}: K_PROG ${m.ram[S.K_PROG]}, the program must keep running while the dialog is up`); };

  // the fresh start
  env.frames_(6);
  state('a fresh start (empty document, not changed)'); screen('the fresh screen');
  sec.ok(m.ram[S.WR_CHG] === 0, 'WR_CHG is 0 after the start');
  // New with no changes: no dialog, the document stays empty, the view is drawn
  newItem(); env.frames_(10);
  sec.ok(!dialogUp() && writeUp(), 'New on an unchanged document: no dialog, Write still runs'); state('after New on an unchanged document'); screen('after New (unchanged)');
  // quit with no changes: SS+Q and the close box, no dialog
  { const ok = L.quitBySSQ(env); sec.ok(ok, 'SYMBOL SHIFT + Q on an unchanged document quits to the shell (no dialog)'); n++; }
  relaunch();
  { const ok = L.quitByCloseBox(env, 3); sec.ok(ok, 'the close box on an unchanged document quits to the shell'); n++; }
  relaunch();
  // a changed document: type, New -> the dialog; Cancel by ESC, by BREAK, by a click; each keeps everything
  typeStr('Hello world'); state('typed "Hello world"'); screen('after typing');
  sec.ok(m.ram[S.WR_CHG] !== 0, 'WR_CHG is set by typing');
  for (const how of ['ESC', 'BREAK', 'click']) {
    newItem(); env.frames_(10);
    const b = dialogChecks(`New with changes, Cancel by ${how}`);
    screen(`the dialog (New, ${how})`, { dialog: true }); state('the document under the dialog', { focusOk: true });
    if (how === 'ESC') L.typeCode(env, 27, 3, 3); else if (how === 'BREAK') L.typeCode(env, 3, 3, 3); else if (b) click(b.cancel);
    closed(`Cancel by ${how}`);
    state(`after Cancel by ${how}: nothing changed`); screen(`after Cancel by ${how}`);
  }
  // keys while the dialog is up go to the dialog, not the document (modal)
  newItem(); env.frames_(10); dialogChecks('New, the dialog for the modal check');
  L.typeCode(env, 122, 3, 3); L.typeCode(env, 14, 3, 3); env.frames_(6);
  sec.ok(dialogUp(), 'a letter and TAB while the dialog is up: the dialog stays'); state('keys under the dialog changed nothing', { focusOk: true });
  { const o = W.objs(env); L.click(env, 300, 50, 3, 6); state('a click on the text view under the dialog changed nothing', { focusOk: true }); sec.ok(dialogUp(), 'a click outside the dialog: still up'); void o; }
  L.typeCode(env, 27, 3, 3); closed('Cancel to leave the modal check');
  // Discard by ENTER: New goes ahead; the document is empty, not changed, the view top 0
  newItem(); env.frames_(10); dialogChecks('New, Discard by ENTER');
  L.typeCode(env, 13, 3, 3); closed('Discard by ENTER'); doc.reset();
  state('after Discard (New): the document is empty, top 0, not changed'); screen('after Discard (New)');
  sec.ok(m.ram[S.WR_CHG] === 0 && rd16(m, S.WR_TOP) === 0 && rd16(m, S.WR_GS) === 0, () => `WR_CHG ${m.ram[S.WR_CHG]}, WR_TOP ${rd16(m, S.WR_TOP)}, caret ${rd16(m, S.WR_GS)} after New`);
  newItem(); env.frames_(10);
  sec.ok(!dialogUp(), 'New right after New: the document is not changed, so no dialog');
  // a long document: Discard by a click on the button; the view returns to the top
  { for (let i = 0; i < 20; i++) { const t = 'line ' + i; typeStr(t); L.typeCode(env, 13, 3, 3); doc.key(13); } env.frames_(6); doc.top = doc.top; state('20 lines typed (the view scrolled)'); screen('after the lines');
    sec.ok(doc.top > 0 && rd16(m, S.WR_TOP) === doc.top, () => `the view scrolled: top ${rd16(m, S.WR_TOP)}, model ${doc.top}`);
    newItem(); env.frames_(10); const b = dialogChecks('New on a scrolled document, Discard by a click');
    if (b) click(b.discard); closed('Discard by a click'); doc.reset(); state('after Discard by a click (top 0)'); screen('after Discard by a click'); }
  // DELETE after typing sets changed too (any insert or delete): "x", DELETE -> empty but changed
  typeStr('x'); L.typeCode(env, 12, 3, 3); doc.key(12); env.frames_(4); state('x then DELETE: empty, changed');
  sec.ok(doc.changed && m.ram[S.WR_CHG] !== 0, 'an insert and a delete leave the document changed');
  // quit with changes: SS+Q -> the dialog; K_QUIT is not reached; Cancel by ESC; the close box -> the dialog; Cancel by a click; SS+Q, Discard by ENTER -> the shell
  L.typeCode(env, 17, 3, 3); env.frames_(10); dialogChecks('SS+Q with changes'); noQuit('SS+Q with changes'); screen('the quit dialog', { dialog: true });
  L.typeCode(env, 27, 3, 3); closed('Cancel (quit) by ESC'); state('after the quit was cancelled');
  { const w = L.PROG_WIN[3], bx = L.closeBoxOf(w.x, w.y, w.w); L.click(env, bx.x + 7, bx.y + 3, 3, 6); env.frames_(10); const b = dialogChecks('the close box with changes'); noQuit('the close box with changes');
    if (b) click(b.cancel); closed('Cancel (quit) by a click'); state('after the close box was cancelled'); screen('after Cancel'); }
  L.typeCode(env, 17, 3, 3); env.frames_(10); dialogChecks('SS+Q again'); L.typeCode(env, 13, 3, 3);
  toShell('Discard by ENTER on quit');
  env.frames_(10);
  // the next launch starts empty; changed document again, quit by the close box, Discard by a click
  relaunch(); state('a new launch: an empty document, not changed (nothing of the last one is kept)'); screen('a new launch');
  typeStr('Quit me');
  { const w = L.PROG_WIN[3], bx = L.closeBoxOf(w.x, w.y, w.w); L.click(env, bx.x + 7, bx.y + 3, 3, 6); env.frames_(10); const b = dialogChecks('the close box with changes (2)'); if (b) click(b.discard); toShell('Discard by a click on quit'); }
  sec.end(`${n} state / screen / flow checks`);
}
function H_leap(env) {
  // the "File" menu is the only menu: press its title, move to its first item ("New"), release (the same gesture as the shell's "Leap" menu)
  const { m } = env;
  L.moveTo(env, 20, 4); m.mouse.buttons = L.MOUSE_LEFT; env.frames_(3);
  L.moveTo(env, 30, 14); env.frames_(2);
  m.mouse.buttons = L.MOUSE_UP; env.frames_(8);
}

// ===========================================================================================================================
// 8. Stack, DI, registers
if (has('8')) {
  const sec = new Sec('8 stack <= 128 bytes in the text view\'s M_DRAW and M_EVENT (crossings included, interrupts off), no DI and IX / IY / the alternate set kept in every stepped call');
  const env = newEnv(); W.parkDirect(env);
  const { S } = env, o = W.objs(env);
  const drv = new W.Drv(env, { doc: sec, lt: sec, scr: sec, bar: sec }, new WM.Doc());
  let ev = { v: 0, what: '' }, dr = { v: 0, what: '' };
  const upE = (r, what) => { const u = r.stack - 2; if (u > ev.v) ev = { v: u, what }; };
  for (const [name, mk] of [['a long wrapping paragraph', () => new WM.Doc(WM.genText(rng, 900, { para: 0.003 }), 0)], ['many short paragraphs', () => new WM.Doc(WM.genText(rng, 900, { para: 0.25 }), 0)], ['an empty document', () => new WM.Doc()]]) {
    const t0 = mk(); t0.caret = Math.min(t0.L, rng.int(0, 40)); t0.top = Math.min(t0.M, Math.max(0, t0.caretLine() - 3));
    const d = W.loadDoc(env, t0); drv.doc = d; drv.trail = [];
    for (const code of [97, 97, 32, 13, 12, 12, 8, 9, 11, 10, 10, 10, 97, 97, 97, 97, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11]) {
      const was = drv.stat.steps, r = drv.direct(W.keyRec(code), `${name}: key ${code}`, { run: { ints: false } }); if (r) upE(r, `${name}, key ${code} (${W.describe(d)})`); void was;
      if (sec.nf > 6) break;
    }
    for (let i = 0; i < 6 && sec.nf < 6; i++) { const px = rng.int(24, 471), py = rng.int(30, 173); const r = drv.direct(W.ptRec(E.DOWN, px, py, 1), `${name}: click (${px}, ${py})`, { run: { ints: false } }); if (r) upE(r, `${name}, click (${px}, ${py})`); }
    for (const v of [0, 3, 200]) { if (d.run !== null) break; const r = drv.direct([E.SCROLL, v, 2, 0], `${name}: E_SCROLL ${v}`, { run: { ints: false } }); if (r) upE(r, `${name}, E_SCROLL ${v}`); }
    for (const foc of [true, false]) {
      if (foc) W.focusTv(env); else T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
      const r = W.sendDraw(env, o.tv); X.noteRun(sec, r, `${name}: M_DRAW focus ${foc}`); const u = r.stack - 2; if (u > dr.v) dr = { v: u, what: `${name}, focus ${foc}` };
    }
    W.focusTv(env);
  }
  sec.ok(ev.v <= 128, () => `M_EVENT used ${ev.v} bytes of stack (${ev.what}), bound 128`);
  sec.ok(dr.v <= 128, () => `M_DRAW used ${dr.v} bytes of stack (${dr.what}), bound 128`);
  sec.ok(X.totals.di === 0, () => `${X.totals.di} DI instruction(s) executed in the stepped calls`);
  sec.ok(X.totals.badPreserved === 0, () => `${X.totals.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(X.totals.badSp === 0, () => `${X.totals.badSp} call(s) returned with a wrong SP`);
  sec.end(`deepest M_EVENT ${ev.v} bytes (${ev.what}), deepest M_DRAW ${dr.v} bytes (${dr.what}), deepest K_DISPATCH step (interrupts on) ${X.totals.maxStack}`);
}

// ===========================================================================================================================
// 9. The memory watch
if (has('9')) {
  const sec = new Sec('9 memory watch (BANKING 10.7), no pointer to DOCK 2-3 / 6 handed to K code, V_FRAMES rose by one on every frame run normally');
  envs.forEach((env, i) => { sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`); sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} frames, first ${env.vf.first}`); });
  sec.end(`${envs.length} machines, ${envs.reduce((a, e) => a + e.frames, 0)} frames run`);
}
// groups 4 and 1-3 ended above; the shared notes
for (const s of [s1]) void s;
finish();
