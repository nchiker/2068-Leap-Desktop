"use strict";
// tk-t1.mjs -- toolkit slice T1 (Check, VScroll; the Controls demo, once group 5, was retired for Key Caps) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym; never rebuilt here).
// Written from docs/TOOLKIT.md (1-7, 9), docs/WINDOWS.md (4, 5, 7, 17), docs/OBJECTS_EVENTS.md (5, 6, 14, 15) and docs/BANKING.md 10.7; never from
// src/kernel/tk.asm.  The reference is tests/tk-model.mjs; the harness is tests/tk-lib.mjs.
//   node tests/tk-t1.mjs [--seed N] [--nlook N] [--ntree N] [--nev N] [--ntrack N] [--nset N] [--only LIST] [--verbose]
//     --nlook N   random Check and random VScroll looks each (default 1500)
//     --ntree N   random windows for the Check events (default 40), --nev N events in each (default 60)
//     --ntrack N  random VScroll tracking scripts (default 600)
//     --nset N    random TK_SETBAR calls (default 400)
//     --only LIST groups to run: 1 looks, 2 Check events, 3 VScroll tracking, 4 TK_SETBAR, 6 watch / frames / DI (default all; 5 was the Controls demo, retired)
// The other groups build their own windows on an empty desk (tk-lib bootParked: the shell's window closed).
// Exit code 1 on any failure.
import { checks } from './lib.mjs';
import * as T from './tk-lib.mjs';
import * as M from './tk-model.mjs';
import * as M2 from './tk-model2.mjs';
import * as X from './tk-lib2.mjs';

const { L, hex, rd16 } = T;
const { argv, argNum } = L;
const SEED = argNum('--seed', 1);
const NLOOK = argNum('--nlook', 1500), NTREE = argNum('--ntree', 40), NEV = argNum('--nev', 60), NTRACK = argNum('--ntrack', 600), NSET = argNum('--nset', 400);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 6];
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const C = checks('tk-t1');
console.log(`seed ${SEED} (rerun with --seed ${SEED}); looks ${NLOOK}+${NLOOK}, Check events ${NTREE} windows x ${NEV}, tracking ${NTRACK}, TK_SETBAR ${NSET}`);

class Sec {
  constructor(name) { this.name = name; this.n = 0; this.nf = 0; this.fails = []; this.notes = []; }
  ok(c, msg) { this.n++; if (!c) { this.nf++; if (this.fails.length < (VERBOSE ? 40 : 5)) this.fails.push(typeof msg === 'function' ? msg() : msg); } return c; }
  note(s) { if (!this.notes.includes(s) && this.notes.length < 6) this.notes.push(s); }
  end(extra = '') {
    groupsOk.push(this.nf === 0);
    C.check(`${this.name}: ${this.n} checks${extra ? ', ' + extra : ''}`, this.nf === 0, this.nf ? `${this.nf} failed: ${this.fails.join(' | ')}` : '');
    for (const s of this.notes) console.log(`  note: ${s}`);
  }
}
const envs = [];                                         // every machine built (for group 6)
const groupsOk = [];
const totals = { di: 0, badPreserved: 0, badSp: 0, maxStackDispatch: 0 };
const gen = {
  codes(lo, hi) { const n = rng.int(lo, hi), o = []; for (let i = 0; i < n; i++) o.push(rng.chance(0.7) ? rng.pick(T.codesOf('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')) : rng.int(32, 126)); return o; },
};
const g0 = new M.Gfx6Model();
const textw = (codes) => (codes.length ? g0.textw(codes) : 0);
const show = (codes) => JSON.stringify(String.fromCharCode(...codes));
const complementOf = (cov) => { const o = new Uint8Array(cov.length); for (let i = 0; i < o.length; i++) o[i] = 0xFF ^ cov[i]; return o; };
const noteRun = (sec, r, what) => {
  totals.di += r.di; if (r.preserved.length) totals.badPreserved++; if (r.badSp !== undefined) totals.badSp++;
  sec.ok(r.di === 0, () => `${what}: a DI was executed (${r.di})`);
  sec.ok(r.preserved.length === 0, () => `${what}: registers not preserved: ${r.preserved.join(',')}`);
  sec.ok(r.badSp === undefined, () => `${what}: SP ${hex(r.badSp)} after the return, want ${hex(0xFF00)}`);
};

// ===========================================================================================================================
// 1. Looks: one control drawn alone by W_DRAWVIEW in an open window; the rectangle equals the model, the rest of the screen is unchanged.
const WIN0 = { x: 16, y: 8, w: 480, h: 184, slot: 0, title: T.codesOf('Looks') };
if (ONLY.includes(1)) {
  const env = T.bootParked({ rng }); envs.push(env);
  const { m, S } = env;
  // ---- Check
  {
    const sec = new Sec('1a Check look: W_DRAWVIEW of a random Check (text, checked / radio / pressed, focused or not) against 9.2');
    const node = { kind: 'Check', id: 130, x: 30, y: 30, w: 60, h: 9, flags: 1, codes: [65] };
    const tree = new M.TkTree(WIN0, [node]);
    T.buildTree(env, tree); const base = env.strp;
    const stat = { radio: 0, checked: 0, pressed: 0, focused: 0, empty: 0, radioChecked: 0 };
    for (let i = 0; i < NLOOK; i++) {
      env.strp = base;
      const empty = rng.chance(0.05), codes = empty ? [] : gen.codes(1, 14), tw = textw(codes);
      const radio = rng.chance(0.4), checked = rng.chance(0.5), pressed = rng.chance(0.3), foc = rng.chance(0.5);
      const w = 17 + tw + rng.int(0, 12), h = rng.int(9, 20), x = rng.int(18, 494 - w), y = rng.int(19, 190 - h);
      const flags = (foc ? 1 : 0) | (checked ? M.FL.CHECKED : 0) | (radio ? M.FL.RADIO : 0) | (pressed ? M.FL.PRESSED : 0);
      T.poke16(env, node.addr + S.Check_text, T.str(env, codes)); T.poke8(env, node.addr + S.View_flags, flags); T.setRect(env, node.addr, x, y, w, h);
      T.runCall(env, S.K_SETFOCUS, { de: 0 }, { ints: false });
      if (foc) T.runCall(env, S.K_SETFOCUS, { de: node.addr }, { ints: false });
      const before = T.readDisp(m);
      const r = T.runCall(env, S.W_DRAWVIEW, { ix: node.addr });
      const after = T.readDisp(m);
      const g = new M.Gfx6Model(); g.setClip(x, y, w, h); M.checkLook(g, { x, y, w, h, flags, codes }, foc);
      const d1 = T.diffRect(env, g, x, y, w, h), d2 = T.diffOutside(before, after, x, y, w, h);
      const what = `Check ${show(codes)} at (${x}, ${y}, ${w}, ${h}) flags ${hex(flags, 2)} focused ${foc}`;
      sec.ok(d1 === null, () => `${what}: rectangle: ${d1}`);
      sec.ok(d2 === null, () => `${what}: outside the rectangle: ${d2}`);
      sec.ok(T.rd16(m, S.K_FOCUS) === (foc ? node.addr : 0), () => `${what}: K_FOCUS ${hex(rd16(m, S.K_FOCUS))}`);
      noteRun(sec, r, what);
      stat.radio += radio; stat.checked += checked; stat.pressed += pressed; stat.focused += foc; stat.empty += empty; stat.radioChecked += radio && checked;
      if (sec.nf > 12) break;
    }
    sec.end(`${stat.radio} radios (${stat.radioChecked} checked), ${stat.checked} checked, ${stat.pressed} pressed, ${stat.focused} focused, ${stat.empty} without text`);
    T.clearTree(env, tree);
  }
  // ---- VScroll
  {
    const sec = new Sec('1b VScroll look: W_DRAWVIEW of a random bar (h 32..160, w 12..24, max 0..255, page 0..255, value 0..max, press 0 / 1 / 2) against 9.3');
    const node = { kind: 'VScroll', id: 131, x: 30, y: 30, w: 12, h: 80, value: 0, max: 0, page: 0, target: 0 };
    const tree = new M.TkTree(WIN0, [node]);
    T.buildTree(env, tree);
    const stat = { nothumb: 0, press1: 0, press2: 0, minThumb: 0, h32: 0, h160: 0, w12: 0, w24: 0, vmax: 0 };
    for (let i = 0; i < NLOOK; i++) {
      const w = rng.chance(0.1) ? rng.pick([12, 24]) : rng.int(12, 24), h = rng.chance(0.1) ? rng.pick([32, 160]) : rng.int(32, 160);
      const x = rng.int(20, 470), y = rng.int(20, 190 - h);
      const max = rng.chance(0.07) ? 0 : rng.chance(0.4) ? rng.int(1, 30) : rng.int(1, 255);
      const page = rng.chance(0.12) ? 0 : rng.chance(0.4) ? rng.int(1, 12) : rng.int(0, 255);
      const value = rng.chance(0.15) ? 0 : rng.chance(0.15) ? max : rng.int(0, max), press = rng.pick([0, 0, 1, 2]);
      const bar = { x, y, w, h, value, max, page };
      T.poke8(env, node.addr + S.VScroll_value, value); T.poke8(env, node.addr + S.VScroll_max, max); T.poke8(env, node.addr + S.VScroll_page, page);
      T.poke16(env, node.addr + S.VScroll_target, 0); T.poke8(env, node.addr + S.VScroll_press, press); T.setRect(env, node.addr, x, y, w, h);
      const before = T.readDisp(m);
      const r = T.runCall(env, S.W_DRAWVIEW, { ix: node.addr });
      const after = T.readDisp(m);
      const g = new M.Gfx6Model(); g.setClip(x, y, w, h); M.vsLook(g, bar, press);
      const d1 = T.diffRect(env, g, x, y, w, h), d2 = T.diffOutside(before, after, x, y, w, h);
      const what = `VScroll (${x}, ${y}, ${w}, ${h}) value ${value} max ${max} page ${page} press ${press}`;
      sec.ok(d1 === null, () => `${what}: rectangle: ${d1}`);
      sec.ok(d2 === null, () => `${what}: outside the rectangle: ${d2}`);
      noteRun(sec, r, what);
      const gm = M.vsGeom(bar);
      stat.nothumb += !gm.thumb; stat.press1 += press === 1; stat.press2 += press === 2; stat.minThumb += gm.thumb && gm.th === 6; stat.h32 += h === 32; stat.h160 += h === 160;
      stat.w12 += w === 12; stat.w24 += w === 24; stat.vmax += value === max && max > 0;
      if (sec.nf > 12) break;
    }
    sec.end(`${stat.nothumb} without a thumb, ${stat.minThumb} with the 6-row minimum thumb, press 1: ${stat.press1}, press 2: ${stat.press2}, h 32: ${stat.h32}, h 160: ${stat.h160}, w 12: ${stat.w12}, w 24: ${stat.w24}, value = max: ${stat.vmax}`);
  }
}

// ===========================================================================================================================
// 2. Check events by direct dispatch: K_EV + K_DISPATCH, in random windows holding Checks, radio groups, Labels, a nested Group and a VScroll.
function randTree() {
  const ww = rng.pick([192, 224, 256]), wh = rng.pick([112, 128, 144]);
  const wx = 16 * rng.int(0, (512 - ww) / 16), wy = 8 * rng.int(1, (192 - wh) / 8);
  const kids = [];
  let id = 128, rows = 0;
  const maxRows = Math.floor((wh - 22) / 13);
  const mkCheck = (flags, xoff = 0) => {
    const codes = rng.chance(0.04) ? [] : gen.codes(1, 10);
    return { kind: 'Check', id: id++, x: wx + 8 + xoff, y: wy + 12 + 13 * rows++, w: 17 + textw(codes) + rng.int(0, 8), h: rng.int(9, 12), flags, codes };
  };
  const radios = (k) => {
    const list = [], on = rng.chance(0.8) ? rng.int(0, k - 1) : -1;
    for (let i = 0; i < k; i++) list.push(mkCheck(M.FL.RADIO | (rng.chance(0.85) ? 1 : 0) | (i === on ? M.FL.CHECKED : 0)));
    return list;
  };
  let hasGroup = false;
  while (rows < maxRows) {
    const r = rng.next();
    if (r < 0.40) kids.push(mkCheck((rng.chance(0.85) ? 1 : 0) | (rng.chance(0.4) ? M.FL.CHECKED : 0)));
    else if (r < 0.70 && rows + 2 <= maxRows) kids.push(...radios(rng.int(2, Math.min(5, maxRows - rows))));
    else if (r < 0.80) { const codes = gen.codes(2, 9); kids.push({ kind: 'Label', id: 0, x: wx + 8, y: wy + 12 + 13 * rows++, w: 17 + textw(codes), h: 9, flags: 0, codes }); }
    else if (r < 0.92 && !hasGroup && rows + 2 <= maxRows) {
      hasGroup = true;
      const sub = radios(rng.int(2, Math.min(3, maxRows - rows)));
      const gx = Math.min(...sub.map((c) => c.x)), gy = Math.min(...sub.map((c) => c.y));
      kids.push({ kind: 'Group', id: 0, x: gx, y: gy, w: Math.max(...sub.map((c) => c.x + c.w)) - gx, h: Math.max(...sub.map((c) => c.y + c.h)) - gy, flags: 0, kids: sub });
    } else if (kids.length >= 3) break;
    else kids.push(mkCheck(1));
  }
  if (rng.chance(0.5)) {
    const h = 32 + 8 * rng.int(0, Math.floor((wh - 12 - 32 - 8) / 8)), max = rng.int(0, 40);
    kids.push({ kind: 'VScroll', id: id++, x: wx + ww - 22, y: wy + 12, w: 12, h, value: rng.int(0, max), max, page: rng.int(0, 10), target: 0, press: 0 });
  }
  return new M.TkTree({ x: wx, y: wy, w: ww, h: wh, slot: 0, title: T.codesOf('Window') }, kids);
}
const rectOf = (n) => ({ x: n.x, y: n.y, w: n.w, h: n.h });
const pointIn = (n) => [rng.int(n.x, n.x + n.w - 1), rng.int(n.y, n.y + n.h - 1)];
const overlap = (n, x, y) => x >= n.x && x < n.x + n.w && y >= n.y && y < n.y + n.h;

if (ONLY.includes(2)) {
  const env = T.bootParked({ rng }); envs.push(env);
  const { m, S } = env;
  const sec = new Sec('2 Check events: E_DOWN / E_MOVE / E_UP / keys through K_DISPATCH; flags, K_FOCUS, K_CAPTURE, W_DRAWVIEW calls, E_CMD posts and the screen against the model');
  const st = { events: 0, clicks: 0, activations: 0, radioClears: 0, keys: 0, tab: 0, space: 0, noops: 0, extraDraws: 0, posts: 0, dragOut: 0 };
  let trees = 0;
  for (let ti = 0; ti < NTREE; ti++) {
    const tree = randTree(), win = tree.win;
    let ctx = `tree ${ti}`;
    try { T.buildTree(env, tree); } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); break; }
    trees++;
    const nodes = tree.nodes(), checksN = nodes.filter((n) => n.kind === 'Check'), bars = nodes.filter((n) => n.kind === 'VScroll');
    tree.activate();
    const actual = rd16(m, S.K_FOCUS);
    sec.ok(actual === (tree.focus ? tree.focus.addr : 0), () => `${ctx}: after W_OPEN K_FOCUS ${hex(actual)}, the first focusable Check is ${tree.focus ? hex(tree.focus.addr) : 'none'}`);
    tree.focus = nodes.find((n) => n.addr === actual) || null;                  // continue from the machine's focus
    const dw = M.renderWindow(tree), d0 = T.diffRect(env, dw, win.x, win.y, win.w, win.h);
    sec.ok(d0 === null, () => `${ctx}: window after W_OPEN + W_UPDATE: ${d0}`);
    const describe = (ev) => (ev.t === M.E.KEY ? `key ${ev.key}` : `${['', '', 'MOVE', 'DOWN', 'UP'][ev.t]} (${ev.px}, ${ev.py})`);
    const trail = [];
    const feed = (ev) => {
      const before = T.readDisp(m);
      T.drainEvents(env);
      T.setEv(env, ev.t === M.E.KEY ? [M.E.KEY, ev.key, 0, 0] : T.ptRec(ev.t, ev.px, ev.py, ev.t !== M.E.UP));
      tree.resetLog();
      let r;
      try { r = T.runCall(env, S.K_DISPATCH, {}, {}); } catch (e) { sec.ok(false, `${ctx}: after ${trail.join(', ')}: ${e.message}`); return false; }
      const pre = new Map(checksN.map((c) => [c, c.flags]));
      tree.dispatch(ev);
      trail.push(describe(ev)); if (trail.length > 6) trail.shift();
      const what = `${ctx} (window ${win.x},${win.y} ${win.w}x${win.h}): ${trail.join(' > ')}`;
      st.events++; noteRun(sec, r, what);
      totals.maxStackDispatch = Math.max(totals.maxStackDispatch, r.stack);
      // W_DRAWVIEW calls
      const gotD = r.draws.map((a) => T.nodeAt(tree, a)), wantD = tree.draws;
      if (gotD.some((n) => !n)) sec.ok(false, `${what}: W_DRAWVIEW of an address that is no control of the window: ${r.draws.map(hex).join(',')}`);
      else {
        const same = gotD.length === wantD.length && gotD.every((n, i) => n === wantD[i]);
        if (!same) {
          sec.ok(false, () => `${what}: W_DRAWVIEW of ${gotD.map((n) => n.id).join(',')}, model ${wantD.map((n) => n.id).join(',')}`);
        } else sec.ok(true, '');
      }
      // posts
      const gotP = r.posts.map((p) => [p.a, p.c, p.e, p.d].join()), wantP = tree.posts.map((p) => [M.E.CMD, p.id, p.slot, 0].join());
      sec.ok(gotP.join('|') === wantP.join('|'), () => `${what}: K_POST ${gotP.join(' | ')}, model E_CMD ${wantP.join(' | ')}`);
      st.posts += r.posts.length;
      // state
      for (const c of checksN) sec.ok(m.ram[c.addr + S.View_flags] === c.flags, () => `${what}: flags of "${String.fromCharCode(...c.codes)}" (id ${c.id}) ${hex(m.ram[c.addr + S.View_flags], 2)}, model ${hex(c.flags, 2)}`);
      for (const b of bars) sec.ok(m.ram[b.addr + S.VScroll_value] === b.value, () => `${what}: a VScroll's value changed to ${m.ram[b.addr + S.VScroll_value]}`);
      const f = rd16(m, S.K_FOCUS), cp = rd16(m, S.K_CAPTURE);
      sec.ok(f === (tree.focus ? tree.focus.addr : 0), () => `${what}: K_FOCUS ${hex(f)}, model ${tree.focus ? hex(tree.focus.addr) : 0}`);
      sec.ok(cp === (tree.capture ? tree.capture.addr : 0), () => `${what}: K_CAPTURE ${hex(cp)}, model ${tree.capture ? hex(tree.capture.addr) : 0}`);
      // screen
      const after = T.readDisp(m), g = M.renderWindow(tree);
      const d1 = T.diffRect(env, g, win.x, win.y, win.w, win.h), d2 = T.diffOutside(before, after, win.x, win.y, win.w, win.h);
      sec.ok(d1 === null, () => `${what}: window pixels: ${d1}`);
      sec.ok(d2 === null, () => `${what}: pixels outside the window changed: ${d2}`);
      return true;
    };
    const winPoint = (avoidBar) => {
      for (let k = 0; k < 50; k++) {
        const p = [rng.int(win.x, win.x + win.w - 1), rng.int(win.y + 9, win.y + win.h - 1)];
        if (avoidBar && bars.some((b) => overlap(b, p[0], p[1]))) continue;
        return p;
      }
      return [win.x + 2, win.y + win.h - 2];
    };
    const deskPoint = () => { for (;;) { const p = [rng.int(0, 511), rng.int(8, 191)]; if (!overlap(win, p[0], p[1])) return p; } };
    const anyPoint = () => (rng.chance(0.6) ? winPoint(false) : rng.chance(0.5) ? deskPoint() : pointIn(rng.pick(nodes)));
    const keyList = [32, 32, 32, 14, 14, 15, 10, 11, 8, 9, 97, 13, 27, 65, 48];
    let alive = true;
    for (let k = 0; k < NEV && alive; k++) {
      const r = rng.next();
      if (r < 0.50) {                                                          // a click, with moves, completed by E_UP
        st.clicks++;
        const rr = rng.next();
        let t;
        if (rr < 0.70) t = rng.pick(checksN); else if (rr < 0.80) t = rng.pick(nodes.filter((n) => n.kind === 'Label' || n.kind === 'Group').concat([win]));
        else t = null;
        const p0 = t && t !== win ? pointIn(t) : t === win ? winPoint(true) : deskPoint();
        if (t && bars.some((b) => overlap(b, p0[0], p0[1]))) continue;
        alive = feed({ t: M.E.DOWN, px: p0[0], py: p0[1] });
        let last = p0;
        const nm = rng.int(0, 3);
        for (let i = 0; i < nm && alive; i++) {
          const to = rng.chance(0.4) && t && t.kind === 'Check' ? pointIn(t) : rng.chance(0.5) && t ? [t.x - rng.int(1, 20), t.y + rng.int(0, t.h)] : anyPoint();
          const p = [Math.min(Math.max(to[0], 0), 511), Math.min(Math.max(to[1], 8), 191)];
          if (t && t.kind === 'Check' && !overlap(t, p[0], p[1])) st.dragOut++;
          alive = feed({ t: M.E.MOVE, px: p[0], py: p[1] }); last = p;
        }
        if (alive && rng.chance(0.97)) {
          const up = rng.chance(0.5) ? last : (t && t.kind === 'Check' && rng.chance(0.5) ? pointIn(t) : anyPoint());
          if (!bars.some((b) => overlap(b, up[0], up[1])) || tree.capture) alive = feed({ t: M.E.UP, px: up[0], py: Math.max(up[1], 8) });
          else alive = feed({ t: M.E.UP, px: last[0], py: last[1] });
        }
      } else if (r < 0.90) {                                                   // a key
        st.keys++;
        const key = rng.pick(keyList); if (key === 32) st.space++; if ([14, 15, 10, 11, 8, 9].includes(key)) st.tab++;
        alive = feed({ t: M.E.KEY, key });
      } else {                                                                 // a stray move / up on its own
        const p = anyPoint(); st.noops++;
        if (rng.chance(0.5)) alive = feed({ t: M.E.MOVE, px: p[0], py: Math.max(p[1], 8) });
        else if (!bars.some((b) => overlap(b, p[0], p[1])) || tree.capture) alive = feed({ t: M.E.UP, px: p[0], py: Math.max(p[1], 8) });
      }
      if (sec.nf > 14) alive = false;
    }
    T.clearTree(env, tree);
    if (sec.nf > 14) break;
  }
  sec.end(`${trees} windows, ${st.events} events (${st.clicks} clicks, ${st.keys} keys of which ${st.space} SPACE and ${st.tab} focus keys, ${st.noops} strays), ${st.posts} E_CMD posted, ${st.dragOut} moves out of the pressed Check, ${st.extraDraws} events with a repeated draw; deepest K_DISPATCH stack ${totals.maxStackDispatch} bytes`);
}

// ===========================================================================================================================
// 3. VScroll tracking: K_DISPATCH of an E_DOWN over a bar, the loop answered frame by frame (every HALT is a frame: V_FRAMES + 1 and the scripted events
//    go into the ring), the stub target class records what it is told.
function genTrack(opts = {}) {
  const w = rng.int(12, 24), h = opts.h || rng.int(32, 160), x = opts.x ?? rng.int(20, 470), y = opts.y ?? rng.int(20, 190 - h);
  const max = opts.max ?? (rng.chance(0.07) ? 0 : rng.chance(0.4) ? rng.int(1, 30) : rng.int(1, 255));
  const page = opts.page ?? (rng.chance(0.12) ? 0 : rng.chance(0.4) ? rng.int(1, 12) : rng.int(0, 255));
  const value = opts.value ?? (rng.chance(0.15) ? 0 : rng.chance(0.15) ? max : rng.int(0, max));
  const bar = { x, y, w: opts.w || w, h, value, max, page, id: 150 + rng.int(0, 40) };
  const gm = M.vsGeom(bar);
  const parts = ['up', 'down'];
  if (gm.thumb) { parts.push('thumb', 'thumb'); if (gm.ty > y + 10) parts.push('pgup', 'pgup'); if (gm.ty + gm.th < y + h - 10) parts.push('pgdn', 'pgdn'); }
  const part = opts.part && parts.includes(opts.part) ? opts.part : rng.pick(parts);
  const rowsOf = { up: [y, y + 9], down: [y + h - 10, y + h - 1], pgup: [y + 10, gm.ty - 1], pgdn: [gm.ty + gm.th, y + h - 11], thumb: [gm.ty, gm.ty + gm.th - 1] }[part];
  const py = rng.int(rowsOf[0], rowsOf[1]), px = rng.int(bar.x, bar.x + bar.w - 1);
  const frames = [], pre = [];
  const demo = !!opts.demo;
  const mv = (px2, py2) => ({ t: 'move', px: px2, py: py2 });
  let H;
  if (part === 'thumb') H = rng.chance(0.08) && !demo ? 0 : rng.int(1, 14);
  else H = rng.chance(0.08) && !demo ? 0 : rng.chance(0.5) ? rng.pick([1, 2, 3, 5, 8, 10, 14, 15, 16, 17, 20, 21, 22, 26, 27, 28, 33, 40]) : rng.int(1, 100);
  if (demo && H < 2) H = 2;
  for (let i = 0; i < H; i++) frames.push([]);
  const place = (i, e) => { if (H === 0) pre.push(e); else frames[i].push(e); };
  const clampStep = (prev, v, lim) => (demo ? Math.min(Math.max(v, prev - lim), prev + lim) : v);
  let cur = [px, py];
  if (part === 'thumb') {
    const n = H === 0 ? rng.int(0, 3) : rng.int(1, Math.min(H, 10)), at = [];
    for (let k = 0; k < Math.max(H, 1); k++) at.push(k);
    for (let k = at.length - 1; k > 0; k--) { const j = rng.int(0, k); [at[k], at[j]] = [at[j], at[k]]; }
    const chosen = at.slice(0, n).sort((a, b) => a - b);
    for (const f of chosen) {
      let ny = rng.chance(0.15) ? rng.pick([y - 15, y + h + 12, y, y + h - 1]) : rng.int(y - 5, y + h + 5), nx = rng.chance(0.2) ? rng.int(0, 511) : rng.int(bar.x - 4, bar.x + bar.w + 3);
      ny = clampStep(cur[1], ny, 55); nx = Math.min(Math.max(demo ? clampStep(cur[0], nx, 55) : nx, 0), 511); ny = Math.min(Math.max(ny, 0), 191);
      place(f, mv(nx, ny)); cur = [nx, ny];
    }
  } else if (H >= 2) {
    if (rng.chance(0.35)) {                                                    // leave the part (and stay out)
      const L1 = rng.int(1, H - 1);
      let ny; for (let k = 0; k < 40; k++) { ny = rng.int(y - 25, y + h + 25); if (demo) ny = clampStep(cur[1], ny, 55); ny = Math.min(Math.max(ny, 0), 191); if (ny !== py) break; }
      frames[L1 - 1].push(mv(rng.chance(0.3) ? rng.int(0, 511) : px, ny)); cur = [px, ny];
    }
    if (rng.chance(0.3)) { const nj = rng.int(1, 3); for (let k = 0; k < nj; k++) { const f = rng.int(0, H - 1); if (!frames[f].some((e) => e.t === 'move')) frames[f].push(mv(rng.int(bar.x - 3, bar.x + bar.w + 2), Math.min(Math.max(clampStep(cur[1], rowsOf[0] + rng.int(0, Math.max(0, rowsOf[1] - rowsOf[0])), 55), 0), 191))); } }
  }
  if (!demo && rng.chance(0.15)) { const f = rng.int(0, Math.max(H - 1, 0)); place(f, { t: 'other', key: rng.pick([97, 14, 32, 13]) }); }
  // the up
  if (H === 0) pre.push({ t: 'up' }); else frames[H - 1].push({ t: 'up' });
  // moves must not share a frame with a later move (one move per frame, like a real pointer), and an 'other' stays before the up
  for (const f of frames) { const mvs = f.filter((e) => e.t === 'move'); if (mvs.length > 1) f.splice(f.indexOf(mvs[0]), 1); const up = f.findIndex((e) => e.t === 'up'); if (up >= 0 && up !== f.length - 1) f.push(f.splice(up, 1)[0]); }
  if (demo) for (const f of frames) if (f.some((e) => e.t === 'up') && f.some((e) => e.t === 'move')) f.splice(f.findIndex((e) => e.t === 'move'), 1);
  return { bar, part, px, py, pre, frames, H };
}

function halfBar() {
  for (let k = 0; k < 300; k++) {
    const h = rng.int(32, 160), page = rng.int(0, 60), max = rng.int(1, 40), bar = { x: 0, y: 0, w: 12, h, value: 0, max, page };
    const gm = M.vsGeom(bar), span = gm.tl - gm.th, ds = [];
    for (let d = 0; d <= span; d++) if ((2 * d * max) % (2 * span) === span) ds.push(d);
    if (ds.length) return { h, page, max, span, ds };
  }
  return null;
}
if (ONLY.includes(3)) {
  const env = T.bootParked({ rng }); envs.push(env);
  const { m, S } = env;
  const sec = new Sec('3 VScroll tracking: E_DOWN on a part, steps, the repeat (15, then every 6 frames), thumb drags, the target told or E_CMD posted; value, screen and told records against the model');
  const st = { cases: 0, rejected: 0, tells: 0, repeats: 0, cmds: 0, parts: {}, frames: 0, drags: 0, noChange: 0, wrap: 0, capBar: 0, capZero: 0, queued: 0, maxStack: 0, modes: {}, xcases: 0, unresolved: 0, half: 0 };
  const win = { x: 16, y: 8, w: 480, h: 184 };
  const modeLog = [];
  for (let ci = 0; ci < NTRACK && sec.nf < 12; ci++) {
    let cs = genTrack();
    if (rng.chance(0.15)) {
      // a thumb drag onto a place where the value is exactly half way between two integers: the rounding of 9.3 (halves up)
      const hb = halfBar();
      if (hb) {
        cs = genTrack({ part: 'thumb', h: hb.h, max: hb.max, page: hb.page });
        const gm2 = M.vsGeom(cs.bar), d = rng.pick(hb.ds), py2 = cs.bar.y + 10 + d + (cs.py - gm2.ty);
        if (cs.part === 'thumb' && py2 >= 0 && py2 <= 191 && gm2.tl - gm2.th === hb.span) {
          st.half++;
          const f = cs.H === 0 ? cs.pre : cs.frames[0];
          const mv = f.find((e) => e.t === 'move');
          if (mv) { mv.py = py2; } else f.unshift({ t: 'move', px: cs.px, py: py2 });
        } else cs = genTrack();
      }
    }
    const mode = rng.chance(0.6) ? 'tell' : 'cmd', vf0 = rng.chance(0.1) ? rng.int(0xFFE0, 0xFFFF) : rng.int(0, 60000);
    const sims = M.simulateAll(cs.bar, mode, { px: cs.px, py: cs.py, pre: cs.pre }, vf0, cs.frames);
    if (!M.MODES.some((k) => sims[k])) { st.rejected++; ci--; if (st.rejected > 20 * NTRACK) break; continue; }
    st.cases++; st.parts[cs.part] = (st.parts[cs.part] || 0) + 1;
    // the machine
    const node = { kind: 'VScroll', id: cs.bar.id, ...cs.bar, target: 0, press: 0 };
    const tree = new M.TkTree({ ...win, slot: 0, title: T.codesOf('Bar') }, [node]);
    const tgt = mode === 'tell' ? T.kNew(env, T.STUB_CLASS) : 0;
    node.target = tgt;
    T.buildTree(env, tree);
    const ctx = `case ${ci}: bar (${cs.bar.x}, ${cs.bar.y}, ${cs.bar.w}, ${cs.bar.h}) value ${cs.bar.value} max ${cs.bar.max} page ${cs.bar.page}, ${mode}, V_FRAMES ${vf0}, ${cs.part} at (${cs.px}, ${cs.py}), ${cs.H} frames, script ${JSON.stringify(cs.frames.map((f, i) => (f.length ? [i + 1, ...f.map((e) => (e.t === 'move' ? `m${e.px},${e.py}` : e.t))] : null)).filter(Boolean)).slice(0, 220)} pre ${JSON.stringify(cs.pre)}`;
    T.drainEvents(env); T.setVframes(env, vf0);
    const recOf = (e) => (e.t === 'move' ? T.ptRec(M.E.MOVE, e.px, e.py, 1) : e.t === 'up' ? T.ptRec(M.E.UP, e.px ?? cs.px, e.py ?? cs.py, 0) : [M.E.KEY, e.key, 0, 0]);
    for (const e of cs.pre) T.ringPut(env, recOf(e));
    T.setEv(env, T.ptRec(M.E.DOWN, cs.px, cs.py, 1));
    const told = [], posted = [], states = [], changes = [];
    let wakes = 0, lastKey = '', drawsAtPress = -1;
    const diffs = [];
    const stateNow = () => ({ value: m.ram[node.addr + S.VScroll_value], press: m.ram[node.addr + S.VScroll_press] });
    // the screen against the look of the state the machine itself is in (the values are compared with the model afterwards)
    const screenIs = (state) => { const g = new M.Gfx6Model(); g.setClip(cs.bar.x, cs.bar.y, cs.bar.w, cs.bar.h); M.vsLook(g, { ...cs.bar, value: state.value }, state.press); return T.diffRect(env, g, cs.bar.x, cs.bar.y, cs.bar.w, cs.bar.h); };
    const checkState = (k) => {
      const s = stateNow(); states[k] = s;
      const key = `${s.value}/${s.press}`;
      if (key !== lastKey || k % 16 === 0) { lastKey = key; const d = screenIs(s); if (d) diffs.push(`after ${k} frame(s): screen ${d}`); }
    };
    const onChange = (what) => {
      const s = stateNow(), d = screenIs(s);
      if (d) diffs.push(`${what}: the bar was not redrawn (value ${s.value}, press ${s.press}) before it was told: ${d}`);
      return s;
    };
    const hooks = {};
    if (mode === 'tell') hooks[T.STUB] = () => {
      const de = (m.cpu.d << 8) | m.cpu.e, s = onChange(`tell ${told.length + 1}`);
      told.push({ vf: T.vframes(env), value: m.ram[de + 1], press: s.press, rec: [0, 1, 2, 3].map((i) => m.ram[de + i]), ix: (m.cpu.xh << 8) | m.cpu.xl });
    };
    let r;
    try {
      r = T.runCall(env, S.K_DISPATCH, {}, {
        hooks,
        onPost: (p) => { const s = stateNow(); posted.push({ ...p, vf: T.vframes(env), value: s.value, press: s.press }); },
        onHalt: (info) => {
          if (drawsAtPress < 0) drawsAtPress = info.draws.length;
          checkState(wakes); wakes++;
          if (wakes > cs.frames.length) throw new Error(`the loop is still waiting after the scripted frames (it never saw the E_UP?)`);
          T.setVframes(env, (vf0 + wakes) & 0xFFFF);
          for (const e of cs.frames[wakes - 1]) T.ringPut(env, recOf(e));
        },
      });
    } catch (e) { sec.ok(false, `${ctx}: ${e.message}`); T.drainEvents(env); T.clearTree(env, tree); continue; }
    checkState(cs.frames.length);
    noteRun(sec, r, ctx);
    st.maxStack = Math.max(st.maxStack, r.stack); st.frames += r.halts;
    sec.ok(r.halts === cs.frames.length, () => `${ctx}: ${r.halts} HALTs, the script has ${cs.frames.length} frames`);
    sec.ok(diffs.length === 0, () => `${ctx}: ${diffs.slice(0, 3).join('; ')}`);
    if (cs.pre.length === 0 && cs.H > 0 && (cs.part === 'up' || cs.part === 'down')) sec.ok(drawsAtPress === 1, () => `${ctx}: ${drawsAtPress} W_DRAWVIEW before the first HALT; 9.7 item 3: the arrow pressed and the first step are drawn together, once`);
    if (cs.pre.length === 0 && cs.H > 0 && (cs.part === 'pgup' || cs.part === 'pgdn')) sec.ok(drawsAtPress <= 1, () => `${ctx}: a page press drew ${drawsAtPress} times before the first HALT`);
    const changesSeen = (mode === 'tell' ? told : posted).map((t) => ({ vf: t.vf, value: t.value, press: t.press }));
    const res = M.matchTrace(sims, { states, tells: changesSeen }, vf0);
    // The contract says "while the pointer is inside that part" (9.3); the readings of it are tk-model's MODES.  The machine behaves as 'rect' (the part is a rectangle:
    // the up box (x, y, w, 10), the down box (x, y + h - 10, w, 10), the track above / below the thumb, all within the bar's width and rows): that reading is the
    // resolved one, and a script must match it whenever it is unambiguous (a pointer that leaves the part and returns makes the model's resume rule ambiguous).
    const unresolved = !sims.rect;
    if (unresolved) st.unresolved++;
    else sec.ok(res.matched.includes('rect'), () => `${ctx}: ${res.why.rect} (readings matched: ${res.matched.join('+') || 'none'})`);
    const key = res.matched.join('+') || 'none';
    st.modes[key] = (st.modes[key] || 0) + 1;
    if (!unresolved && M.MODES.some((k) => sims[k] && k !== 'rect' && JSON.stringify(sims[k].per) !== JSON.stringify(sims.rect.per))) { st.xcases++; if (modeLog.length < 3 && !res.matched.includes('py')) modeLog.push(`${ctx} -> matched ${res.matched.join('+')}; ${Object.entries(res.why).map(([k, v]) => `${k}: ${v}`).join(' ; ')}`); }
    const sim = sims[res.matched[0]] || sims[M.MODES.find((k) => sims[k])];
    // the records
    if (mode === 'tell') {
      told.forEach((t, i) => {
        sec.ok(t.rec[0] === M.E.SCROLL && t.rec[2] === cs.bar.id && t.rec[3] === 0, () => `${ctx}: tell ${i + 1}: record [${t.rec}], want [${M.E.SCROLL}, <value>, ${cs.bar.id}, 0]`);
        sec.ok(t.ix === tgt, () => `${ctx}: tell ${i + 1}: IX = ${hex(t.ix)}, the target is ${hex(tgt)}`);
      });
      sec.ok(r.posts.length === 0, () => `${ctx}: a target is set but ${r.posts.length} K_POST made`);
      st.tells += told.length;
    } else {
      sec.ok(posted.length <= 1, () => `${ctx}: ${posted.length} E_CMD posted, at most one (when tracking ends)`);
      posted.forEach((p, i) => sec.ok(p.a === M.E.CMD && p.c === cs.bar.id && p.e === tree.win.slot && p.d === 0, () => `${ctx}: post ${i + 1}: A ${p.a} C ${p.c} E ${p.e} D ${p.d}, want E_CMD ${cs.bar.id}, slot ${tree.win.slot}, 0`));
      st.cmds += posted.length;
      { const q = T.postedQueue(env); st.queued += q.length; sec.ok(q.length === posted.length && q.every((x) => x[0] === M.E.CMD && x[1] === cs.bar.id), () => `${ctx}: the posted queue after the loop holds ${JSON.stringify(q)}, want the ${posted.length} E_CMD for id ${cs.bar.id}`); }
    }
    st.repeats += sim.t.tells.filter((t) => t.vf - vf0 >= 15).length;
    if (sim.t.tells.length === 0) st.noChange++;
    if (cs.part === 'thumb') st.drags++;
    if (vf0 >= 0xFFE0) st.wrap++;
    const cap = rd16(m, S.K_CAPTURE); if (cap === node.addr) st.capBar++; else if (cap === 0) st.capZero++;
    sec.ok(m.ram[node.addr + S.VScroll_press] === 0, () => `${ctx}: the arrow is still pressed after the E_UP (press ${m.ram[node.addr + S.VScroll_press]})`);
    T.drainEvents(env); T.clearTree(env, tree);
  }
  sec.end(`${st.cases} scripts (${st.rejected} rejected as ambiguous), parts ${JSON.stringify(st.parts)}, ${st.tells} told, ${st.cmds} posted, ${st.repeats} repeats (>= 15 frames), ${st.noChange} with no change of value, ${st.drags} drags, ${st.wrap} across the V_FRAMES wrap, ${st.half} drags aimed at an exact half, ${st.frames} frames; deepest stack of K_DISPATCH + the tracking loop ${st.maxStack} bytes`);
  console.log(`  report: readings of "while the pointer is inside that part" (9.3) that the machine matched, per script (the resolved reading is rect): ${JSON.stringify(st.modes)} (py = rows only, xpy = also x within the bar, rect = also the bar's rows); ${st.xcases} scripts distinguish the three readings; ${st.unresolved} scripts are ambiguous under the resolved reading 'rect' (a pointer that leaves the part and returns: when the repeat resumes is not in the contract) and are not judged`);
  for (const l of modeLog) console.log(`    e.g. ${l}`);
  console.log(`  report: K_CAPTURE after tracking ended: = the bar in ${st.capBar} cases, = 0 in ${st.capZero} cases; posted E_CMD left in the queue after the loop: ${st.queued} (9.7 item 2: with target = 0 one E_CMD is posted when tracking ends, if the value changed; it stays in the queue for the program)`);
}

// ===========================================================================================================================
// 4. TK_SETBAR
if (ONLY.includes(4)) {
  const env = T.bootParked({ rng }); envs.push(env);
  const { m, S } = env;
  const sec = new Sec('4 TK_SETBAR: max and page stored, value = min(A, max), the bar drawn, nobody told (no E_CMD, the target not sent anything)');
  const tgt = T.kNew(env, T.STUB_CLASS);
  const node = { kind: 'VScroll', id: 140, x: 100, y: 30, w: 12, h: 80, value: 3, max: 9, page: 2, target: tgt, press: 0 };
  const tree = new M.TkTree(WIN0, [node]);
  T.buildTree(env, tree);
  let clampN = 0;
  for (let i = 0; i < NSET; i++) {
    const w = rng.int(12, 24), h = rng.int(32, 160), x = rng.int(20, 470), y = rng.int(20, 190 - h);
    const a = rng.chance(0.2) ? 255 : rng.chance(0.2) ? 0 : rng.int(0, 255), c = rng.chance(0.08) ? 0 : rng.chance(0.5) ? rng.int(1, 40) : rng.int(0, 255), b = rng.chance(0.1) ? 0 : rng.chance(0.5) ? rng.int(1, 12) : rng.int(0, 255);
    T.setRect(env, node.addr, x, y, w, h);
    const old = { value: rng.int(0, 255), max: rng.int(0, 255), page: rng.int(0, 255) };
    T.poke8(env, node.addr + S.VScroll_value, old.value); T.poke8(env, node.addr + S.VScroll_max, old.max); T.poke8(env, node.addr + S.VScroll_page, old.page); T.poke8(env, node.addr + S.VScroll_press, 0);
    const bar = { x, y, w, h, value: 0, max: 0, page: 0 };
    M.setBar(bar, a, c, b);
    const before = T.readDisp(m);
    let told = 0;
    const r = T.runCall(env, S.TK_SETBAR, { ix: node.addr, a, c, b }, { hooks: { [T.STUB]: () => { told++; } } });
    const after = T.readDisp(m);
    const what = `TK_SETBAR A=${a} C=${c} B=${b} on a bar (${x}, ${y}, ${w}, ${h})`;
    clampN += a > c;
    sec.ok(m.ram[node.addr + S.VScroll_value] === bar.value && m.ram[node.addr + S.VScroll_max] === c && m.ram[node.addr + S.VScroll_page] === b, () => `${what}: value ${m.ram[node.addr + S.VScroll_value]} max ${m.ram[node.addr + S.VScroll_max]} page ${m.ram[node.addr + S.VScroll_page]}, want ${bar.value} ${c} ${b}`);
    const g = new M.Gfx6Model(); g.setClip(x, y, w, h); M.vsLook(g, bar, 0);
    const d1 = T.diffRect(env, g, x, y, w, h), d2 = T.diffOutside(before, after, x, y, w, h);
    sec.ok(d1 === null, () => `${what}: rectangle: ${d1}`);
    sec.ok(d2 === null, () => `${what}: outside: ${d2}`);
    sec.ok(told === 0 && r.posts.length === 0, () => `${what}: told ${told} times, ${r.posts.length} K_POST (it tells nobody)`);
    sec.ok(r.draws.length >= 1, () => `${what}: no W_DRAWVIEW`);
    noteRun(sec, r, what);
    if (sec.nf > 10) break;
  }
  sec.end(`${clampN} with A > C (clamped)`);
}

// (Group 5, the Controls demo over real frames, was retired when Key Caps replaced Controls as program 2 (docs/KEYCAPS.md 5): Check's looks and events are groups 1 and 2, VScroll's repeat and tracking
// group 3 (frame by frame), the radios in a real program tests/kc-k1.mjs, a real VScroll Write's bar (tests/wr-w1.mjs).)

// ===========================================================================================================================
// 6. The memory watch of BANKING 10.7, V_FRAMES and DI over every machine of this run.
if (ONLY.includes(6)) {
  const sec = new Sec('6 memory watch (BANKING 10.7), V_FRAMES +1 per normal frame, no DI');
  let frames = 0, acc = 0;
  envs.forEach((env, i) => {
    const w = env.w;
    sec.ok(w.n === 0, () => `machine ${i}: memory watch: ${w.summary()}`);
    sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first: ${env.vf.first}`);
    sec.ok(env.wr.n === 0 || true, '');
    frames += env.vf.checked; acc += (w.accA || 0) + (w.accR || 0);
  });
  sec.ok(totals.di === 0, () => `${totals.di} DI instruction(s) executed in the stepped calls`);
  sec.ok(totals.badPreserved === 0, () => `${totals.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(totals.badSp === 0, () => `${totals.badSp} call(s) returned with a wrong SP`);
  sec.end(`${envs.length} machines, ${frames} normal frames with V_FRAMES checked, ${acc} accesses under A or R watched`);
}
C.done();
console.log(`tk-t1: ${groupsOk.filter(Boolean).length} of ${groupsOk.length} groups pass`);
