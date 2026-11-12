"use strict";
// kern-model3.mjs -- reference model of the K3 kernel (docs/OBJECTS_EVENTS.md sections 5, 6, 13, 14, 15): event routing
// (K_DISPATCH), Group, focus (K_SETFOCUS / K_FOCUSNEXT / K_FOCUSPREV), the posted queue (K_POST / K_GETEV, 14.2) and the kern3
// self-test of 15.4.  Written from the contract only.  It extends tests/kern-model.mjs (K1) by subclassing; nothing there changes.
//
//   node tests/kern-model3.mjs --self-test      (hand-derived log of the 15.4 self-test, an independent walk check, invariants)
//
// What the contract leaves open is modelled as "wild" (the bytes are copied from the machine, never predicted):
//   W1. BC and DE of a method the kernel sends on its own: M_EVENT gets DE = K_EV (15.2) but BC is open; M_BLUR / M_FOCUS (K_SETFOCUS)
//       and the recursive M_DESTROY of view_destroy leave both open.  M_HITTEST from group_event has BC = x, DE = y (15.2).
//   W2. The log records written by those methods therefore have wild bytes at +3/+4 (BC) and/or +5/+6 (DE).
import { fileURLToPath } from 'node:url';
import { KernelModel, DECL, buildClasses, MSG } from './kern-model.mjs';

export { MSG };
export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, TIMER: 5, REDRAW: 6, MENU: 7, QUIT: 8, MODE: 9 };
export const KEY = { LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, DELETE: 12, ENTER: 13, TAB: 14, BACKTAB: 15 };
export const FL = { FOCUSABLE: 1, HIDDEN: 2, DISABLED: 4 };

// Class declarations (15.1) in the order of the class files: Object, View, Group (kernel), then the test classes.
export const DECL3 = [
  DECL[0], DECL[1],
  { name: 'Group', parent: 'View', fields: [], methods: [['Event', 'group_event']] },
  ...DECL.slice(2, 4),
  { name: 'TBox', parent: 'View', fields: [['tag', 1]], methods: [['Destroy', 't_destroy'], ['Draw', 't_draw'], ['Event', 't_event'],
    ['Focus', 't_focus'], ['Blur', 't_blur']] },
  ...DECL.slice(4),
];
export const buildClasses3 = () => buildClasses(DECL3);

const VIEW = { parent: 2, child: 4, next: 6, x: 8, y: 10, w: 11, h: 13, flags: 14, id: 15 };
const TAG = 16;
export const SYM3 = {                                   // contract addresses (13.5, 14.1, 13.6); the code's symbol table has the same
  K_KARENA: 0xF050, K_AARENA: 0xF060, K_CURA: 0xF070, K_FOCUS: 0xF072, K_CAPTURE: 0xF074, K_ROOT: 0xF076,
  K_RING: 0xF000, K_POSTQ: 0xF040, K_RHEAD: 0xF080, K_RTAIL: 0xF081, K_PHEAD: 0xF082, K_PN: 0xF083, K_EV: 0xF086,
  T_LOG: 0xE800, T_LOGN: 0xE090,
};

export class KernelModel3 extends KernelModel {
  constructor(S, mem, classes = buildClasses3()) {
    super(S, mem, classes);
    this.wildAddr = new Set();                          // addresses of log bytes the contract leaves open (for the sum)
    this.trace = null;                                  // optional array: every send is pushed as a string
  }
  fl(v) { return this.rd8(v + VIEW.flags); }
  canFocus(v) { return (this.fl(v) & 7) === 1; }        // 15.3
  ev() { const a = this.S.K_EV; return [this.rd8(a), this.rd8(a + 1), this.rd8(a + 2), this.rd8(a + 3)]; }
  setEv(type, d1, d2, d3) { const a = this.S.K_EV; this.wr8(a, type); this.wr8(a + 1, d1); this.wr8(a + 2, d2); this.wr8(a + 3, d3); }
  get focus() { return this.rd16(this.S.K_FOCUS); }
  get capture() { return this.rd16(this.S.K_CAPTURE); }
  get root() { return this.rd16(this.S.K_ROOT); }

  /** The log record of a test method (13.6); bc / de null = open (wild), independently. */
  log(code, ix, bc, de) {
    const k = this.rd16(this.S.T_LOGN), a = this.S.T_LOG + 8 * (k & 255);
    this.wr8(a, code); this.wr8(a + 1, ix); this.wr8(a + 2, ix >> 8);
    if (bc === null) { this.wild.push([a + 3, 2]); this.wildAddr.add(a + 3); this.wildAddr.add(a + 4); }
    else { this.wr8(a + 3, bc); this.wr8(a + 4, bc >> 8); this.wildAddr.delete(a + 3); this.wildAddr.delete(a + 4); }
    if (de === null) { this.wild.push([a + 5, 2]); this.wildAddr.add(a + 5); this.wildAddr.add(a + 6); }
    else { this.wr8(a + 5, de); this.wr8(a + 6, de >> 8); this.wildAddr.delete(a + 5); this.wildAddr.delete(a + 6); }
    this.wr8(a + 7, this.rd8(ix + TAG));
    this.wr16(this.S.T_LOGN, k + 1);
  }

  /** K_SEND, with Group's Event (group_event) added to the K1 methods. */
  send(ix, msg, bc, de) {
    const cls = this.classOf(ix), label = this.label(cls, msg);
    if (this.trace) this.trace.push(`${cls.name}@${ix.toString(16)}.${msg}`);
    if (label === 'group_event') { this.stat.sends++; return { label, carry: this.groupEvent(ix, de) }; }
    return super.send(ix, msg, bc, de);
  }

  // ---- routing (15.2) ----------------------------------------------------------------------------------------------------
  /** "Send to v": nothing when v = 0, else M_EVENT with DE = K_EV (BC open); returns the carry (null when nothing was sent). */
  sendEvent(v) { return v === 0 ? null : this.send(v, MSG.EVENT, null, this.S.K_EV).carry; }

  /** K_DISPATCH: routes the event in K_EV.  Returns a description { consumed } for tests that want it. */
  dispatch() {
    const [type, d1] = this.ev(), S = this.S;
    switch (type) {
      case E.KEY: {
        let v = this.focus || this.root, consumed = false, guard = 0;
        while (v !== 0) {
          if (this.sendEvent(v)) { consumed = true; break; }
          v = this.parentOf(v);
          if (++guard > 64) throw new Error('model: cyclic parents in the key bubble');
        }
        if (!consumed) {
          if (d1 === KEY.TAB || d1 === KEY.DOWN || d1 === KEY.RIGHT) this.focusNext();
          else if (d1 === KEY.BACKTAB || d1 === KEY.UP || d1 === KEY.LEFT) this.focusPrev();
        }
        return { consumed };
      }
      case E.DOWN: this.wr16(S.K_CAPTURE, 0); return { consumed: !!this.sendEvent(this.root) };
      case E.MOVE: return { consumed: !!this.sendEvent(this.capture || this.root) };
      case E.UP: {
        const c = this.capture;
        if (c !== 0) { this.wr16(S.K_CAPTURE, 0); return { consumed: !!this.sendEvent(c) }; }
        return { consumed: !!this.sendEvent(this.root) };
      }
      default: return { consumed: !!this.sendEvent(this.root) };
    }
  }

  /** group_event (15.2): de = the event record's address (K_EV); returns the carry. */
  groupEvent(g, de) {
    const type = this.rd8(de), d1 = this.rd8(de + 1), d2 = this.rd8(de + 2), d3 = this.rd8(de + 3);
    if (type !== E.MOVE && type !== E.DOWN && type !== E.UP) return 0;
    const x = d1 + 256 * (d3 & 1), y = d2;
    let target = 0;
    for (let c = this.childOf(g), n = 0; c !== 0; c = this.nextOf(c)) {
      if (++n > 4096) throw new Error('model: cyclic child list in group_event');
      if (this.fl(c) & 6) continue;
      if (this.send(c, MSG.HITTEST, x, y).carry) { target = c; break; }
    }
    if (target === 0) return 0;
    if (type === E.DOWN && (this.fl(target) & 1)) this.setFocus(target);
    const carry = this.send(target, MSG.EVENT, null, de).carry;
    if (carry && type === E.DOWN && this.capture === 0) this.wr16(this.S.K_CAPTURE, target);
    return carry;
  }

  // ---- focus (15.3, section 5) -------------------------------------------------------------------------------------------
  /** K_SETFOCUS (DE = v): returns the carry (1 = nothing changed because v cannot take focus). */
  setFocus(v) {
    const f = this.focus;
    if (v === f) return 0;
    if (v !== 0 && !this.canFocus(v)) return 1;
    if (f !== 0) this.send(f, MSG.BLUR, null, null);
    this.wr16(this.S.K_FOCUS, v);
    if (v !== 0) this.send(v, MSG.FOCUS, null, null);
    return 0;
  }
  /** The pre-order step from n (15.3): { n } or { wrap: true } when it runs off the root (parent 0). */
  step(n) {
    if ((this.fl(n) & 6) === 0 && this.childOf(n) !== 0) return { n: this.childOf(n) };
    let x = n, g = 0;
    while (x !== 0) {
      if (this.nextOf(x) !== 0) return { n: this.nextOf(x) };
      x = this.parentOf(x);
      if (++g > 64) throw new Error('model: cyclic parents in step');
    }
    return { wrap: true };
  }
  /**
   * The focus walk (15.3) shared by NEXT and PREV: the views that can take focus, in the order the walk tests them, and whether
   * it ran at all.  With no focus, s = K_ROOT and the root is tested first.  Ends when the walk returns to s or would wrap a
   * second time.  With K_ROOT = 0 (15.3, amended): nothing.
   */
  walk() {
    let s = this.focus; const root = this.root, cands = [];
    if (root === 0) return cands;                       // 15.3: with K_ROOT = 0 K_FOCUSNEXT and K_FOCUSPREV do nothing
    if (s === 0) {
      s = root;
      if (this.canFocus(s)) cands.push(s);
    }
    let n = s, wraps = 0, guard = 0;
    for (;;) {
      const st = this.step(n);
      if (st.wrap) { if (wraps === 1) break; wraps = 1; n = root; } else n = st.n;
      if (n === s) break;
      if (this.canFocus(n)) cands.push(n);
      if (++guard > 4096) throw new Error('model: focus walk does not end');
    }
    return cands;
  }
  focusNext() { const c = this.walk(); if (c.length) this.setFocus(c[0]); }
  focusPrev() { const c = this.walk(); if (c.length) this.setFocus(c[c.length - 1]); }
  /** The focus walk is defined for every state since 15.3 amended K_ROOT = 0 (nothing happens). */
  walkSafe() { return true; }
  /** Pre-order of the tree under v, hidden / disabled subtrees not entered (the order the walk visits). */
  preorder(v) { const out = [v]; if ((this.fl(v) & 6) === 0) for (const c of this.children(v)) out.push(...this.preorder(c)); return out; }

  // ---- the posted queue (14.2), and the ring's empty case ----------------------------------------------------------------
  /** K_POST: carry 1 when full. */
  post(a, c, e, d) {
    const S = this.S, pn = this.rd8(S.K_PN);
    if (pn === 4) return 1;
    const q = S.K_POSTQ + 4 * ((this.rd8(S.K_PHEAD) + pn) & 3);
    this.wr8(q, a); this.wr8(q + 1, c); this.wr8(q + 2, e); this.wr8(q + 3, d); this.wr8(S.K_PN, pn + 1);
    return 0;
  }
  /** K_GETEV: { carry, type }. */
  getev() {
    const S = this.S, pn = this.rd8(S.K_PN);
    let src;
    if (pn > 0) { const ph = this.rd8(S.K_PHEAD); src = S.K_POSTQ + 4 * ph; this.wr8(S.K_PHEAD, (ph + 1) & 3); this.wr8(S.K_PN, pn - 1); }
    else {
      const h = this.rd8(S.K_RHEAD);
      if (h === this.rd8(S.K_RTAIL)) return { carry: 1, type: null };
      src = S.K_RING + (h & 0x3F); this.wr8(S.K_RHEAD, (h + 4) & 0xFF);
    }
    for (let i = 0; i < 4; i++) this.wr8(S.K_EV + i, this.rd8(src + i));
    return { carry: 0, type: this.rd8(S.K_EV) };
  }
  /** The whole "K_POST then K_GETEV and K_DISPATCH until carry" line of 15.4 (the queue is empty before). */
  scriptLine(type, d1, d2, d3) {
    if (this.post(type, d1, d2, d3)) throw new Error('model: posted queue full');
    for (let g = 0; ; g++) { const r = this.getev(); if (r.carry) break; this.dispatch(); if (g > 8) throw new Error('model: script line loops'); }
  }

  // ---- the kern3 self-test (15.4) ----------------------------------------------------------------------------------------
  /**
   * T_SELFTEST on the model.  Applies every effect except the record (the caller writes it, see selfTestRecord).  Returns { v: { R, A,
   * B, C, D, G, E, F } } addresses.
   */
  runSelfTest() {
    const S = this.S, P = (n) => S[`CL_${n}`], v = {};
    this.aReset(S.K_AARENA); this.arena(S.K_AARENA); this.wr16(S.T_LOGN, 0);
    this.buildSelfTestTree(v);
    const key = (c) => this.scriptLine(E.KEY, c, 0, 0);
    const ptr = (type, x, y, held) => this.scriptLine(type, x & 255, y, ((x >> 8) & 1) | (held ? 2 : 0));
    key(KEY.TAB); key(KEY.TAB); key(KEY.TAB); key(KEY.TAB);
    ptr(E.DOWN, 356, 92, true); ptr(E.MOVE, 360, 95, true); ptr(E.UP, 360, 95, false);
    key(KEY.BACKTAB);
    ptr(E.DOWN, 100, 92, true); ptr(E.MOVE, 40, 30, true); ptr(E.UP, 40, 30, false); ptr(E.MOVE, 40, 30, false);
    this.scriptLine(E.KEY, 0x78, 0, 0);
    this.scriptLine(16, 1, 2, 3);
    this.send(v.G, MSG.DESTROY, 0, 0);                  // directly (BC, DE: whatever the test program had; open for a Group, which logs nothing)
    key(KEY.TAB);
    this.focusPrev();
    return { v };
  }
  /** Steps 1-2 of 15.4 without the arena reset (T_BUILD of the demo): the tree, in table order. */
  buildSelfTestTree(v = {}) {
    const S = this.S, P = (n) => S[`CL_${n}`];
    const mk = (name, x, y, w, h, flags, tag, id, parent) => {
      const r = this.newObj(P(name));
      if (r.carry) throw new Error('model: arena full in the self-test');
      const a = r.addr;
      this.wr16(a + VIEW.x, x); this.wr8(a + VIEW.y, y); this.wr16(a + VIEW.w, w); this.wr8(a + VIEW.h, h);
      this.wr8(a + VIEW.flags, flags); this.wr8(a + VIEW.id, id); if (name === 'TBox') this.wr8(a + TAG, tag);
      if (parent) this.addChild(parent, a); else this.setRoot(a);
      return a;
    };
    v.R = mk('Group', 0, 16, 512, 176, 0, 0, 0, 0);
    v.A = mk('TBox', 16, 24, 112, 24, 1, 0, 1, v.R);
    v.B = mk('TBox', 144, 24, 112, 24, 1, 0, 2, v.R);
    v.C = mk('TBox', 272, 24, 112, 24, 3, 0, 3, v.R);
    v.D = mk('TBox', 400, 24, 96, 24, 5, 0, 4, v.R);
    v.G = mk('Group', 16, 64, 480, 112, 0, 0, 5, v.R);
    v.E = mk('TBox', 32, 80, 200, 24, 1, 1, 6, v.G);
    v.F = mk('TBox', 256, 80, 200, 24, 1, 0, 7, v.G);
    return v;
  }
  /** The log as an array of 8-byte records with `null` for open bytes (records 0 .. T_LOGN - 1, last 256 at most). */
  logRecords() {
    const S = this.S, n = this.rd16(S.T_LOGN), out = [];
    for (let k = Math.max(0, n - 256); k < n; k++) {
      const a = S.T_LOG + 8 * (k & 255);
      out.push(Array.from({ length: 8 }, (_, i) => (this.wildAddr.has(a + i) ? null : this.rd8(a + i))));
    }
    return out;
  }
  /** 15.4 (amended): the 16-bit sum of bytes +0, +1, +2 and +7 (code, IX, tag) of records 0 .. T_LOGN - 1; BC and DE are left out. */
  logSum() {
    const S = this.S, n = this.rd16(S.T_LOGN); let sum = 0;
    for (let k = 0; k < n; k++) { const a = S.T_LOG + 8 * (k & 255); sum += this.rd8(a) + this.rd8(a + 1) + this.rd8(a + 2) + this.rd8(a + 7); }
    return { n, sum: sum & 0xFFFF };
  }
}

// ===========================================================================================================================
function selfTest() {
  let fails = 0, n = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  const cls = buildClasses3();
  const S = { ...SYM3, RESULT: 0xFF00, obj_destroy: 0xA000, k_nop: 0xA010, view_destroy: 0xA020, view_hittest: 0xA030, group_event: 0xA040,
    t_destroy: 0xB000, t_draw: 0xB010, t_event: 0xB020, t_hittest: 0xB030, t_focus: 0xB040, t_blur: 0xB050, t_poke: 0xB060, t_draw2: 0xB070, t_poke2: 0xB080 };
  cls.list.forEach((c, i) => { S[`CL_${c.name}`] = 0xA100 + 0x40 * i; });
  const fresh = () => {
    const mem = new Uint8Array(65536); for (let i = 0; i < mem.length; i++) mem[i] = (i * 2654435761 >>> 13) & 0xFF;
    const k = new KernelModel3(S, mem, cls);
    k.aInit(S.K_KARENA, 0xF100, 0xFB00); k.aInit(S.K_AARENA, 0xC000, 0xE000); k.arena(S.K_AARENA);
    for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT, S.T_LOGN, S.K_RHEAD, S.K_RTAIL, S.K_PHEAD, S.K_PN]) k.wr16(a, 0);
    k.wr8(S.K_PHEAD + 1, 0);
    return k;
  };

  // class layout
  eq('Group', [cls.byName.Group.size, cls.byName.Group.count, cls.byName.Group.slots[2].label], [16, 6, 'group_event']);
  eq('TBox', [cls.byName.TBox.size, cls.byName.TBox.pool, cls.byName.TBox.offsets.tag, cls.byName.TBox.slots.map((s) => s.label)],
    [17, 10, 16, ['t_destroy', 't_draw', 't_event', 'view_hittest', 't_focus', 't_blur']]);

  // ---- the 15.4 self-test, against a log derived by hand from the contract (see the report) --------------------------------
  const k = fresh();
  const { v } = k.runSelfTest();
  eq('addresses (K_NEW from the app arena top, 16 / 24 byte blocks)', [v.R, v.A, v.B, v.C, v.D, v.G, v.E, v.F].map((a) => a.toString(16)),
    ['c000', 'c010', 'c028', 'c040', 'c058', 'c070', 'c080', 'c098']);
  const idOf = Object.fromEntries(Object.entries(v).map(([name, a]) => [a, name]));
  const FOCUS = 4, BLUR = 5, EVT = 2, DESTR = 0;
  const want = [[FOCUS, 'A'], [EVT, 'A'], [BLUR, 'A'], [FOCUS, 'B'], [EVT, 'B'], [BLUR, 'B'], [FOCUS, 'E'], [EVT, 'E'],
    [BLUR, 'E'], [FOCUS, 'F'], [EVT, 'F'], [EVT, 'F'], [EVT, 'F'], [EVT, 'F'], [BLUR, 'F'], [FOCUS, 'E'], [EVT, 'E'], [EVT, 'E'], [EVT, 'E'],
    [EVT, 'A'], [EVT, 'E'], [DESTR, 'E'], [DESTR, 'F'], [FOCUS, 'A'], [BLUR, 'A'], [FOCUS, 'B']];
  const recs = k.logRecords();
  eq('T_LOGN', k.rd16(S.T_LOGN), 26);
  eq('log (code, view)', recs.map((r) => [r[0], idOf[r[1] | (r[2] << 8)]]), want);
  eq('log tags', recs.map((r) => r[7]), want.map(([, name]) => (name === 'E' ? 1 : 0)));
  // M_EVENT: DE = K_EV, BC open; M_FOCUS / M_BLUR / nested M_DESTROY: both open
  eq('open bytes', recs.map((r) => [r[3] === null, r[5] === null]),
    want.map(([c]) => (c === EVT ? [true, false] : [true, true])));
  eq('M_EVENT DE = K_EV', recs.filter((r) => r[0] === EVT).every((r) => (r[5] | (r[6] << 8)) === S.K_EV), true);
  eq('final state: focus B, capture 0, root R', [k.focus === v.B, k.capture, k.root === v.R], [true, 0, true]);
  eq('G destroyed and unlinked', [k.childOf(v.R) === v.A, k.children(v.R).includes(v.G), k.nextOf(v.D)], [true, false, 0]);
  eq('free lists: pool 8 head G (R, G were View-sized), pool 10 head F -> E', [k.rd16(S.K_AARENA + 8) === v.G, k.rd16(S.K_AARENA + 10) === v.F, k.rd16(v.F) === v.E], [true, true, true]);
  eq('app arena top', k.rd16(S.K_AARENA), 0xC0B0);
  eq('posted queue empty, head advanced by the 15 events', [k.rd8(S.K_PN), k.rd8(S.K_PHEAD)], [0, 15 & 3]);
  eq('type 16 posted with data 1, 2, 3 (the 14th post, slot 13 mod 4)', Array.from({ length: 4 }, (_, i) => k.rd8(S.K_POSTQ + 4 * (13 & 3) + i)), [16, 1, 2, 3]);
  eq('K_EV is the last event (E_KEY TAB, data 2 = data 3 = 0)', k.ev(), [E.KEY, KEY.TAB, 0, 0]);
  const sum = k.logSum();
  eq('log count', sum.n, 26);
  if (process.argv.includes('--print-log')) recs.forEach((r, i) => console.log(`  rec ${String(i).padStart(2)}: code ${r[0]} ${idOf[r[1] | (r[2] << 8)]} bc ${r[3] === null ? '*' : r[3] | (r[4] << 8)} de ${r[5] === null ? '*' : '$' + (r[5] | (r[6] << 8)).toString(16)} tag ${r[7]}`));
  eq('sum of code, IX, tag bytes (coordinator hand count: 7550)', sum.sum, 7550);
  console.log(`self-test log: T_LOGN ${sum.n}, sum of bytes +0 +1 +2 +7 = ${sum.sum} ($${sum.sum.toString(16)}), focused id ${k.rd8(k.focus + VIEW.id)}`);

  // ---- the focus walk against an independent formulation (rotation of the pre-order list) ----------------------------------
  let seed = 4242; const rnd = (m) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % m; };
  const randTree = (k2, count, flagsFn) => {
    const nodes = [];
    for (let i = 0; i < count; i++) {
      const a = k2.newObj(S.CL_TBox).addr; k2.wr8(a + VIEW.flags, flagsFn()); nodes.push(a);
      if (i === 0) k2.setRoot(a); else {
        const cand = nodes.slice(0, i).filter((p) => k2.pathLen(p) < 8);
        k2.addChild(cand[rnd(cand.length)], a);
      }
    }
    return nodes;
  };
  let walkChecks = 0;
  for (let t = 0; t < 400; t++) {
    const k2 = fresh(), nodes = randTree(k2, 2 + rnd(30), () => [0, 1, 1, 1, 3, 5, 2, 4, 7][rnd(9)]);
    const L = k2.preorder(k2.root);
    for (const s of [0, ...nodes.filter((x) => L.includes(x))]) {
      k2.wr16(S.K_FOCUS, s);
      const order = s === 0 ? L : [...L.slice(L.indexOf(s) + 1), ...L.slice(0, L.indexOf(s))];
      const cands = order.filter((x) => k2.canFocus(x));
      eq(`walk t${t} s${s ? nodes.indexOf(s) : '-'}`, k2.walk(), cands); walkChecks++;
    }
  }
  // a focus outside the root's tree: the second wrap ends the walk after one pass of the root's tree
  {
    const k2 = fresh(), a = randTree(k2, 6, () => 1), root = k2.root;
    const s = k2.newObj(S.CL_TBox).addr; k2.wr8(s + VIEW.flags, 1);
    const kid = k2.newObj(S.CL_TBox).addr; k2.wr8(kid + VIEW.flags, 1); k2.addChild(s, kid);
    k2.wr16(S.K_FOCUS, s);
    eq('outside focus: walk = s\'s own subtree after s, then the whole root tree', k2.walk(), [kid, ...k2.preorder(root)]);
    k2.wr16(S.K_FOCUS, 0); k2.wr16(S.K_ROOT, 0); eq('no root, no focus: nothing', k2.walk(), []);
    k2.wr16(S.K_FOCUS, s); eq('no root, a focus: nothing', k2.walk(), []);
    void a;
  }
  console.log(`  ${walkChecks} walk comparisons`);

  // ---- routing details ------------------------------------------------------------------------------------------------------
  {
    const k2 = fresh(), P = (nme) => S[`CL_${nme}`], mk = (name, x, y, w, h, flags, tag) => {
      const a = k2.newObj(P(name)).addr; k2.wr16(a + 8, x); k2.wr8(a + 10, y); k2.wr16(a + 11, w); k2.wr8(a + 13, h); k2.wr8(a + 14, flags); if (name !== 'Group' && name !== 'View') k2.wr8(a + 16, tag); return a;
    };
    const r = mk('Group', 0, 0, 512, 192, 0, 0); k2.setRoot(r);
    const g = mk('Group', 10, 10, 300, 100, 0, 0), l2 = mk('TLog2', 20, 20, 50, 50, 1, 3);       // TLog2: tag 3: consumes and its hit test says hit
    k2.addChild(r, g); k2.addChild(g, l2);
    k2.setEv(E.DOWN, 5, 5, 0); k2.dispatch();                                                    // (5,5) misses g
    eq('miss: no capture, no log', [k2.capture, k2.rd16(S.T_LOGN)], [0, 0]);
    k2.setEv(E.DOWN, 500 & 255, 150, 1); k2.dispatch(); eq('x = 500 hits nothing', k2.capture, 0);
    k2.setEv(E.DOWN, 100, 100, 2); k2.dispatch();                                                // TLog2 hit by tag bit 1 wherever the point is
    eq('TLog2 hits by tag bit 1, takes focus (flags 1), consumes, captures', [k2.focus === l2, k2.capture === l2], [true, true]);
    const codes = k2.logRecords().map((x) => x[0]); eq('hit test (3), focus (4), event (2)', codes, [3, 4, 2]);
    eq('hit test record has BC = x, DE = y', k2.logRecords()[0].slice(3, 7), [100, 0, 100, 0]);
    k2.setEv(E.UP, 0, 0, 0); k2.dispatch(); eq('UP releases capture', k2.capture, 0);
    // a hidden child is skipped, not tested
    k2.wr8(l2 + 14, 3); k2.wr16(S.T_LOGN, 0); k2.setEv(E.MOVE, 30, 30, 0); k2.dispatch(); eq('hidden child skipped: no log', k2.rd16(S.T_LOGN), 0);
    // key defaults with no root and no focus: nothing
    const k3 = fresh(); k3.setEv(E.KEY, KEY.TAB, 0, 0); k3.dispatch(); eq('TAB with no tree', [k3.focus, k3.rd16(S.T_LOGN)], [0, 0]);
  }
  console.log(`kern-model3 self-test: ${n - fails} passed, ${fails} failed`);
  if (fails) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
