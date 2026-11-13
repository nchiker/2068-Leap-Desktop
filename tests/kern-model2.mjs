"use strict";
// kern-model2.mjs -- reference model of the K2 kernel slice (docs/OBJECTS_EVENTS.md sections 2, 5-7, 14).  Written from the contract only.
//
// What it models: the event ring (16 x 4 bytes, free-running head / tail), the posted queue (4 x 4), K_GETEV / K_POST, the input
// part of the frame ISR K_POLL (14.3 step by step: warp, keyboard decode with the key map, caps lock, auto-repeat, rollover order,
// keyboard-pointer mode, joystick, acceleration, clamps, button, event order, coalescing, K_LOST), K_WARP, and what K_POLL hands to
// the pointer (P_ISRMOVE).  The key map is read from src/kernel/keymap.txt by this file's own parser (14.4), independently of
// tools/gen-keymap.mjs.
//
// Every state variable of 14.1 is predicted byte for byte: `ifaceBytes(S)` lists [address, byte] pairs for K_RING, K_POSTQ, K_RHEAD,
// K_RTAIL, K_PHEAD, K_PN, K_LOST, K_EV, K_PX, K_PY, K_BTN, K_KPMODE, K_CAPS (and K_MOUSE, WINDOWS 15.2, when the symbol exists).
//
//   node tests/kern-model2.mjs --self-test
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const E = { KEY: 1, MOVE: 2, DOWN: 3, UP: 4, TIMER: 5, REDRAW: 6, MENU: 7, QUIT: 8, MODE: 9 };
export const REPEAT_FIRST = 30, REPEAT_NEXT = 4, HOLD_MAX = 30;
export const KEY_CS = 0, KEY_SS = 36, KEY_Q = 10, KEY_A = 5, KEY_O = 26, KEY_P = 25, KEY_SPACE = 35;
export const KEY_NAMES = ['CS', 'Z', 'X', 'C', 'V', 'A', 'S', 'D', 'F', 'G', 'Q', 'W', 'E', 'R', 'T', '1', '2', '3', '4', '5', '0', '9', '8', '7', '6',
  'P', 'O', 'I', 'U', 'Y', 'ENTER', 'L', 'K', 'J', 'H', 'SPACE', 'SS', 'M', 'N', 'B'];          // 14.3: key index k = 5 r + b

export const QUIRK = { seqClampY: false };
export const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
export const s16 = (v) => ((v & 0xFFFF) ^ 0x8000) - 0x8000;
/** An 8-bit value as a signed byte (-128..127): the mouse's counter differences (WINDOWS 15.2). */
export const s8 = (v) => ((v & 0xFF) ^ 0x80) - 0x80;
/** S_STEP[hold] = min(1 + floor(hold / 6), 6) (section 7, spike6 17.5). */
export const sStep = (hold) => Math.min(1 + Math.floor(hold / 6), 6);

// ---------------------------------------------------------------------------------------------------------------------------
// The key map (14.4): parse keymap.txt.
const NAMED = { ENTER: 13, LEFT: 8, RIGHT: 9, DOWN: 10, UP: 11, DELETE: 12, TAB: 14, BACKTAB: 15, MENU: 16, CLOSE: 17, MARK: 18, ESC: 27, BREAK: 3, CAPS: 1,
  SPACE: 32, HASH: 35, DASH: 45 };

/** Parse the text of keymap.txt: returns { names: [40], planes: [plain[40], cs[40], ss[40]] }. */
export function parseKeymap(text) {
  const names = [], planes = [[], [], []];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^\s*#.*$/, '').trim();           // a comment line; `#` as an entry is spelled HASH
    if (!line) continue;
    const t = line.split(/\s+/);
    if (t.length !== 4) throw new Error(`keymap.txt: want 4 columns, got ${t.length}: "${raw}"`);
    names.push(t[0]);
    for (let p = 0; p < 3; p++) {
      const e = t[1 + p];
      let code;
      if (e === '-') code = 0;
      else if (NAMED[e] !== undefined) code = NAMED[e];
      else if (e.length === 1 && e.charCodeAt(0) >= 32 && e.charCodeAt(0) <= 126) code = e.charCodeAt(0);
      else throw new Error(`keymap.txt: bad entry "${e}" in "${raw}"`);
      planes[p].push(code);
    }
  }
  if (names.length !== 40) throw new Error(`keymap.txt: ${names.length} key lines, want 40`);
  return { names, planes };
}
export function loadKeymap(root) { return parseKeymap(readFileSync(join(root, 'src/kernel/keymap.txt'), 'utf8')); }
/** The 120 bytes of KEYMAP: plain, CS, SS (KEYMAP + 40 plane + k). */
export const keymapBytes = (km) => [...km.planes[0], ...km.planes[1], ...km.planes[2]];

// ---------------------------------------------------------------------------------------------------------------------------
/** Key matrix rows (8 bytes, bits 0-4, active low) with the given key indices down. */
export function rowsOf(keys) {
  const rows = new Array(8).fill(0x1F);
  for (const k of keys) rows[(k / 5) | 0] &= ~(1 << (k % 5));
  return rows;
}
/** The joystick byte (active low: bit 0 up, 1 down, 2 left, 3 right, 7 fire) for a string of letters u d l r f. */
export function joyOf(s) {
  const bit = { u: 0, d: 1, l: 2, r: 3, f: 7 };
  let j = 0xFF;
  for (const c of s) j &= ~(1 << bit[c]);
  return j;
}

export class K2Model {
  /** km: parseKeymap() result; init: { px, py } (boot's P_INIT position). */
  constructor(km, init = { px: 256, py: 96 }) {
    this.km = km;
    this.ring = new Uint8Array(64); this.postq = new Uint8Array(16);
    this.rhead = 0; this.rtail = 0; this.phead = 0; this.pn = 0; this.lost = 0;
    this.ev = [0, 0, 0, 0];
    this.px = init.px; this.py = init.py; this.btn = 0; this.kpmode = 0; this.caps = 0;
    // K_POLL's internal state (14.3)
    this.old = new Array(40).fill(false); this.hold = 0; this.rep = null; this.pend = 0;
    this.wreq = 0; this.wx = 0; this.wy = 0;
    // slice M, the Kempston mouse (docs/WINDOWS.md 15.2): K_MOUSE, the last counters, this frame's motion, the mouse's button (mb).  Off at boot.
    this.mouseOn = 0; this.mlx = 0; this.mly = 0; this.mdx = 0; this.mdy = 0; this.mb = 0;
  }
  clone() {
    const c = new K2Model(this.km);
    Object.assign(c, this);
    c.ring = this.ring.slice(); c.postq = this.postq.slice(); c.ev = this.ev.slice(); c.old = this.old.slice();
    c.rep = this.rep && { ...this.rep };
    return c;
  }
  /** Copy all state from another model (for the "ISR before / after" candidates). */
  assign(o) { const c = o.clone(); Object.assign(this, c); return this; }

  // ---- queues (14.2) --------------------------------------------------------------------------------------------------------
  get count() { return ((this.rtail - this.rhead) & 0xFF) >> 2; }
  /** K_GETEV: { carry, a }.  Posted first, then the ring.  Nothing is written when carry is set. */
  getev() {
    if (this.pn > 0) {
      const o = 4 * this.phead;
      this.ev = [this.postq[o], this.postq[o + 1], this.postq[o + 2], this.postq[o + 3]];
      this.phead = (this.phead + 1) & 3; this.pn -= 1;
      return { carry: 0, a: this.ev[0] };
    }
    if (this.rhead !== this.rtail) {
      const o = this.rhead & 0x3F;
      this.ev = [this.ring[o], this.ring[o + 1], this.ring[o + 2], this.ring[o + 3]];
      this.rhead = (this.rhead + 4) & 0xFF;
      return { carry: 0, a: this.ev[0] };
    }
    return { carry: 1, a: null };
  }
  /** K_POST (A = type, C, E, D = data 1-3): carry 1 when the posted queue is full (nothing written). */
  post(a, c, e, d) {
    if (this.pn === 4) return 1;
    const o = 4 * ((this.phead + this.pn) & 3);
    this.postq[o] = a & 0xFF; this.postq[o + 1] = c & 0xFF; this.postq[o + 2] = e & 0xFF; this.postq[o + 3] = d & 0xFF;
    this.pn += 1;
    return 0;
  }
  /** The ISR's append (14.2): coalescing of an E_MOVE first, then the full check (K_LOST), then the write.  Returns what happened. */
  append(type, d1, d2, d3) {
    const used = (this.rtail - this.rhead) & 0xFF;
    if (type === E.MOVE && used >= 8) {
      const o = (this.rtail - 4) & 0x3F;
      if (this.ring[o] === E.MOVE) { this.ring[o + 1] = d1; this.ring[o + 2] = d2; this.ring[o + 3] = d3; return 'coalesced'; }
    }
    if (used === 64) { if (this.lost < 255) this.lost++; return 'lost'; }
    const o = this.rtail & 0x3F;
    this.ring[o] = type; this.ring[o + 1] = d1; this.ring[o + 2] = d2; this.ring[o + 3] = d3;
    this.rtail = (this.rtail + 4) & 0xFF;
    return 'appended';
  }

  // ---- K_MSET (WINDOWS 15.2) --------------------------------------------------------------------------------------------------
  /**
   * K_MSET: on (A != 0): the counters are read into the last-seen values, then K_MOUSE = 1 (so turning it on never moves the pointer).
   * Off (A = 0): K_MOUSE = 0 and the mouse's button and motion for the next frame are cleared.  mouse = { x, y, buttons } as the ports read now.
   */
  mset(on, mouse) {
    if (on) { this.mlx = mouse.x & 0xFF; this.mly = mouse.y & 0xFF; this.mouseOn = 1; }
    else { this.mouseOn = 0; this.mb = 0; this.mdx = 0; this.mdy = 0; }
  }

  // ---- K_WARP (14.5) --------------------------------------------------------------------------------------------------------
  /** HL = x, DE = y as signed words: clamped; the next poll takes it. */
  warp(x, y) { this.wx = clamp(s16(x), 0, 511); this.wy = clamp(s16(y), 0, 191); this.wreq = 1; }

  // ---- K_POLL (14.3) --------------------------------------------------------------------------------------------------------
  /**
   * One K_POLL.  rows: the 8 half-rows (bits 0-4, active low); joy: the joystick byte as AY register 14 reads it; lock: PT_LOCK is held
   * (P_ISRMOVE refuses); mouse: { x, y, buttons } as the ports $FBDF, $FFDF, $FADF read now (WINDOWS 15.2 step 1b; only used while the mouse is on;
   * omitted while on = the counters unchanged and no button).  Returns { appended: [{ rec, how }], isrMove: { x, y } | null (P_ISRMOVE called and accepted), refused }.
   */
  poll(rows, joy = 0xFF, lock = false, mouse = undefined) {
    const out = { appended: [], isrMove: null, refused: false, idle: false, notes: [] };
    const add = (type, d1, d2, d3) => { out.appended.push({ rec: [type, d1, d2, d3], how: this.append(type, d1, d2, d3) }); };
    // 1. warp
    if (this.wreq) { this.px = this.wx; this.py = this.wy; this.pend = 1; this.wreq = 0; }
    // 1b. the mouse (WINDOWS 15.2), only when K_MOUSE = 1: mdx = x - last x, mdy = last y - y (signed 8-bit), mb = the left button (bit 1, active low)
    if (this.mouseOn) {
      const mo = mouse ?? { x: this.mlx, y: this.mly, buttons: 0xFF };
      this.mdx = s8(mo.x - this.mlx); this.mdy = s8(this.mly - mo.y);
      this.mlx = mo.x & 0xFF; this.mly = mo.y & 0xFF;
      this.mb = (mo.buttons & 2) ? 0 : 1;
    } else { this.mdx = 0; this.mdy = 0; }
    // 2. keyboard
    const down = new Array(40);
    for (let k = 0; k < 40; k++) down[k] = !(rows[(k / 5) | 0] & (1 << (k % 5)));
    const anyNow = down.some(Boolean), anyOld = this.old.some(Boolean);
    if (!anyNow && !anyOld) out.idle = true;
    else {
      const cs = down[KEY_CS], ss = down[KEY_SS], newly = (k) => down[k] && !this.old[k];
      const other = down.some((d, k) => d && k !== KEY_CS && k !== KEY_SS);
      if (cs && ss && !other && (newly(KEY_CS) || newly(KEY_SS))) {
        this.kpmode ^= 1; add(E.MODE, this.kpmode, 0, 0); this.rep = null;
      }
      let anyNew = false;
      for (let k = 0; k < 40; k++) if (k !== KEY_CS && k !== KEY_SS && newly(k)) anyNew = true;
      if (this.kpmode === 0) {
        for (let k = 0; k < 40; k++) {
          if (k === KEY_CS || k === KEY_SS || !newly(k)) continue;
          const plane = ss ? 2 : cs ? 1 : 0;
          let code = this.km.planes[plane][k];
          if (code === 0) continue;
          if (code === 1) { this.caps ^= 1; this.rep = null; continue; }
          if (plane === 0 && this.caps === 1 && code >= 97 && code <= 122) code -= 32;
          const mods = (cs ? 1 : 0) | (ss ? 2 : 0) | (this.caps ? 4 : 0);
          add(E.KEY, code, mods, 0);
          this.rep = { k, code, mods, count: REPEAT_FIRST };
        }
      }
      if (this.rep && !anyNew) {
        if (!down[this.rep.k]) this.rep = null;
        else {
          this.rep.count -= 1;
          if (this.rep.count === 0) { add(E.KEY, this.rep.code, this.rep.mods | 0x80, 0); this.rep.count = REPEAT_NEXT; }
        }
      }
      this.old = down.slice();
    }
    // 3. joystick (all four directions at once: nothing, fire included)
    let u = !(joy & 1), d = !(joy & 2), l = !(joy & 4), r = !(joy & 8), fire = !(joy & 0x80);
    if (u && d && l && r) { u = d = l = r = fire = false; }
    // 4. directions and button, ORed with keyboard-pointer mode's keys
    if (this.kpmode) {
      u = u || down[KEY_Q]; d = d || down[KEY_A]; l = l || down[KEY_O]; r = r || down[KEY_P]; fire = fire || down[KEY_SPACE];
    }
    fire = fire || this.mb === 1;                                  // WINDOWS 15.2 step 4: fire is also ORed with mb
    // 5. move
    let s = 0;
    if (u || d || l || r) { s = sStep(this.hold); this.hold = Math.min(this.hold + 1, HOLD_MAX); } else this.hold = 0;
    const nx = clamp(this.px + 2 * s * ((r ? 1 : 0) - (l ? 1 : 0)) + this.mdx, 0, 511);       // WINDOWS 15.2: + mdx (one clamp of the sum)
    // (QUIRK_SEQ_CLAMP: a debugging aid of the test runs, off by default: the order y = clamp(clamp(y + s d) - s u) that a fault found in K2 follows)
    const ny = QUIRK.seqClampY ? clamp(clamp(this.py + s * (d ? 1 : 0), 0, 191) - s * (u ? 1 : 0), 0, 191) : clamp(this.py + s * ((d ? 1 : 0) - (u ? 1 : 0)) + this.mdy, 0, 191);
    const fireN = fire ? 1 : 0;                                   // data 3 bit 1 is K_BTN after step 6
    const data = () => [this.px & 0xFF, this.py & 0xFF, ((this.px >> 8) & 1) | (fireN << 1)];
    if (nx !== this.px || ny !== this.py) {
      this.px = nx; this.py = ny; this.pend = 1;
      add(E.MOVE, ...data());
    }
    // 6. button
    if (fireN !== this.btn) {
      this.btn = fireN;
      add(fireN ? E.DOWN : E.UP, ...data());
    }
    // 7. pointer
    if (this.pend) {
      if (lock) out.refused = true;
      else { out.isrMove = { x: this.px, y: this.py }; this.pend = 0; }
    }
    return out;
  }

  // ---- the variables of 14.1, as bytes ---------------------------------------------------------------------------------------
  /** [address, byte] for every interface variable the model predicts. */
  ifaceBytes(S) {
    const out = [];
    for (let i = 0; i < 64; i++) out.push([S.K_RING + i, this.ring[i]]);
    for (let i = 0; i < 16; i++) out.push([S.K_POSTQ + i, this.postq[i]]);
    out.push([S.K_RHEAD, this.rhead], [S.K_RTAIL, this.rtail], [S.K_PHEAD, this.phead], [S.K_PN, this.pn], [S.K_LOST, this.lost]);
    for (let i = 0; i < 4; i++) out.push([S.K_EV + i, this.ev[i]]);
    out.push([S.K_PX, this.px & 0xFF], [S.K_PX + 1, this.px >> 8], [S.K_PY, this.py], [S.K_BTN, this.btn], [S.K_KPMODE, this.kpmode], [S.K_CAPS, this.caps]);
    if (S.K_MOUSE !== undefined) out.push([S.K_MOUSE, this.mouseOn]);
    return out;
  }
  /** Load the 14.1 variables from a machine RAM image (the poll state keeps its idle values: the caller knows it is idle). */
  loadIface(ram, S) {
    this.ring.set(ram.subarray(S.K_RING, S.K_RING + 64)); this.postq.set(ram.subarray(S.K_POSTQ, S.K_POSTQ + 16));
    this.rhead = ram[S.K_RHEAD]; this.rtail = ram[S.K_RTAIL]; this.phead = ram[S.K_PHEAD]; this.pn = ram[S.K_PN]; this.lost = ram[S.K_LOST];
    this.ev = Array.from(ram.subarray(S.K_EV, S.K_EV + 4));
    this.px = ram[S.K_PX] | (ram[S.K_PX + 1] << 8); this.py = ram[S.K_PY]; this.btn = ram[S.K_BTN]; this.kpmode = ram[S.K_KPMODE]; this.caps = ram[S.K_CAPS];
    if (S.K_MOUSE !== undefined) this.mouseOn = ram[S.K_MOUSE];
    return this;
  }
  /** Write the 14.1 variables into a RAM image. */
  storeIface(ram, S) { for (const [a, v] of this.ifaceBytes(S)) ram[a] = v; return ram; }
  /** The idle poll state (nothing held, no repeat, nothing pending). */
  idlePoll() { this.old = new Array(40).fill(false); this.hold = 0; this.rep = null; this.pend = 0; this.wreq = 0; this.mdx = 0; this.mdy = 0; this.mb = 0; return this; }
  /** Drain: every event K_GETEV would return now, in order (copies of K_EV). */
  drain() { const out = []; for (;;) { const r = this.getev(); if (r.carry) break; out.push(this.ev.slice()); } return out; }
  /** All records currently queued, posted first then ring, without consuming (a view). */
  queued() { return this.clone().drain(); }
}

// ---------------------------------------------------------------------------------------------------------------------------
// Self-test:  node tests/kern-model2.mjs --self-test
async function selfTest() {
  const { checks } = await import('./lib.mjs');
  const { ROOT } = await import('../tools/build.mjs');
  const C = checks('kern-model2 self-test');
  const km = loadKeymap(ROOT);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const K = (n) => KEY_NAMES.indexOf(n);
  const fresh = () => new K2Model(km);
  const evs = (m) => m.drain();

  C.check('key names are in matrix order: 40 distinct, CS first, SS at 36', new Set(KEY_NAMES).size === 40 && KEY_NAMES[0] === 'CS' && KEY_NAMES[36] === 'SS' && eq(km.names, KEY_NAMES));
  // keymap spec (section 7): hand-listed codes
  const P = km.planes;
  C.check('plain: lower-case letters, digits, space, ENTER 13', 'zxcvasdfgqwertyuiopljkhmnb'.split('').every((c) => P[0][K(c.toUpperCase())] === c.charCodeAt(0))
    && '1234567890'.split('').every((c) => P[0][K(c)] === c.charCodeAt(0)) && P[0][K('SPACE')] === 32 && P[0][K('ENTER')] === 13);
  C.check('CS: upper-case letters; CS+5/6/7/8 = 8, 10, 11, 9; CS+0 12; CS+1 14; CS+2 caps (1); CS+3 15; CS+4 27; CS+9 16; CS+SPACE 3',
    'ZXCVASDFGQWERTYUIOPLKJHMNB'.split('').every((c) => P[1][K(c)] === c.charCodeAt(0)) && P[1][K('5')] === 8 && P[1][K('6')] === 10 && P[1][K('7')] === 11
    && P[1][K('8')] === 9 && P[1][K('0')] === 12 && P[1][K('1')] === 14 && P[1][K('2')] === 1 && P[1][K('3')] === 15 && P[1][K('4')] === 27
    && P[1][K('9')] === 16 && P[1][K('SPACE')] === 3);
  C.check('keys 0 and 36 are all "-"; every printable ASCII 32..126 is reachable', [0, 1, 2].every((p) => P[p][0] === 0 && P[p][36] === 0)
    && Array.from({ length: 95 }, (_, i) => 32 + i).every((c) => P.some((pl) => pl.includes(c))));

  // an idle poll appends nothing
  { const m = fresh(), r = m.poll(rowsOf([]), 0xFF); C.check('idle poll: no event, idle path, no pointer call', r.idle && r.appended.length === 0 && r.isrMove === null && m.rtail === 0); }
  // key A down in frame 1: E_KEY 97; repeat at n + 30, n + 34
  {
    const m = fresh(), frames = [];
    for (let f = 0; f < 40; f++) { m.poll(rowsOf([K('A')]), 0xFF); frames.push(m.drain()); }
    const at = frames.map((e, f) => (e.length ? f : -1)).filter((f) => f >= 0);
    C.check('hand-worked: A held from frame 0: events in frames 0, 30, 34, 38', eq(at, [0, 30, 34, 38]) && eq(frames[0], [[1, 97, 0, 0]]) && eq(frames[30], [[1, 97, 0x80, 0]]), JSON.stringify(at));
  }
  // release cancels; another held key does not take over
  {
    const m = fresh(); let n = 0;
    for (let f = 0; f < 10; f++) m.poll(rowsOf([K('A'), K('S')]), 0xFF);
    const first = evs(m);                                              // A, S in key order, once
    for (let f = 0; f < 80; f++) { m.poll(rowsOf([K('A')]), 0xFF); n += evs(m).length; }            // S released: S's repeat is cancelled, A does not take over
    C.check('rollover: A then S (increasing key index) once; releasing the repeating key stops all repeats', eq(first, [[1, 97, 0, 0], [1, 115, 0, 0]]) && n === 0, `${JSON.stringify(first)} ${n}`);
  }
  // CS + A: upper case, mods 1; SS + Z: ':'; caps lock via CS+2 gives no event and upper-cases the next plain letter with bit 2
  {
    const m = fresh();
    m.poll(rowsOf([K('CS'), K('A')]), 0xFF); const e1 = evs(m);
    m.poll(rowsOf([]), 0xFF);
    m.poll(rowsOf([K('SS'), K('Z')]), 0xFF); const e2 = evs(m);
    m.poll(rowsOf([]), 0xFF);
    m.poll(rowsOf([K('CS'), K('2')]), 0xFF); const e3 = evs(m);
    m.poll(rowsOf([]), 0xFF);
    m.poll(rowsOf([K('A')]), 0xFF); const e4 = evs(m);
    m.poll(rowsOf([]), 0xFF);
    m.poll(rowsOf([K('CS'), K('A')]), 0xFF); const e5 = evs(m);
    C.check('CS+A = 65 mods 1; SS+Z = 58 mods 2; CS+2 = caps lock, no event; then A = 65 mods 4; CS+A mods 5',
      eq(e1, [[1, 65, 1, 0]]) && eq(e2, [[1, 58, 2, 0]]) && eq(e3, []) && m.caps === 1 && eq(e4, [[1, 65, 4, 0]]) && eq(e5, [[1, 65, 5, 0]]), JSON.stringify([e1, e2, e3, e4, e5]));
  }
  // mode toggle: CS + SS together; E_MODE; second toggle; keys in kp mode make no E_KEY and Q moves
  {
    const m = fresh();
    m.poll(rowsOf([K('CS'), K('SS')]), 0xFF); const t1 = evs(m);
    m.poll(rowsOf([]), 0xFF);
    m.poll(rowsOf([K('Q')]), 0xFF); const q = evs(m);                  // (256, 96) -> up: s = 1: y 95
    m.poll(rowsOf([K('CS'), K('SS')]), 0xFF); const t2 = evs(m);
    C.check('mode toggle: E_MODE 1; Q then moves with no E_KEY (E_MOVE: x 256 = low 0, bit 8 -> data 3 = 1; y 95); E_MODE 0 on the second toggle', eq(t1, [[9, 1, 0, 0]]) && eq(q, [[2, 0, 95, 1]]) && eq(t2, [[9, 0, 0, 0]]), JSON.stringify([t1, q, t2]));
  }
  // acceleration from (391, 131), spike6 hand-worked: right 10 frames: s = 1 x6 then 2 x4: x + 12 + 16 = 419
  {
    const m = fresh(); m.px = 391; m.py = 131;
    for (let f = 0; f < 10; f++) m.poll(rowsOf([]), joyOf('r'));
    const a = m.px;
    m.poll(rowsOf([]), 0xFF); for (let f = 0; f < 6; f++) m.poll(rowsOf([]), joyOf('ul'));
    C.check('hand-worked: right 10 frames (6 x 2 + 4 x 4) -> x 419; up + left 6 frames -> (-12, -6)', a === 419 && m.px === 407 && m.py === 125, `${a} ${m.px} ${m.py}`);
  }
  // all four directions: nothing, fire included; opposite directions cancel (hold still grows)
  {
    const m = fresh(); m.poll(rowsOf([]), joyOf('udlrf'));
    const nothing = m.px === 256 && m.py === 96 && m.btn === 0 && m.rtail === 0;
    for (let f = 0; f < 7; f++) m.poll(rowsOf([]), joyOf('lr'));
    C.check('udlr + fire: no motion, no button; l + r: no motion but the hold counter grows (s = 2 after 7 frames)', nothing && m.px === 256 && m.hold === 7 && m.rtail === 0);
  }
  // button: DOWN / UP data (bit 1 = button after step 6), also on the E_MOVE of the same frame
  {
    const m = fresh(); m.poll(rowsOf([]), joyOf('rf')); const a = evs(m); m.poll(rowsOf([]), joyOf('')); const b = evs(m);
    // (258, 96): x low 2, y 96, data 3 = bit 8 of 258 (1) | button 2 = 3
    C.check('button: E_MOVE (data 3 bit 1 already set) then E_DOWN in one frame; E_UP when released', eq(a, [[2, 2, 96, 3], [3, 2, 96, 3]]) && eq(b, [[4, 2, 96, 1]]), JSON.stringify([a, b]));
  }
  // warp: clamps, no event, then a move from the warped position; K_PX after
  {
    const m = fresh(); m.warp(-5, 1000); const r0 = m.rtail; const r = m.poll(rowsOf([]), 0xFF);
    m.warp(0x7FFF, -32768); m.warp(600, 50);
    m.poll(rowsOf([]), 0xFF);
    C.check('warp: signed clamp (-5, 1000) -> (0, 191); the last of several wins ((600, 50) -> (511, 50)); no event; P_ISRMOVE called',
      r0 === 0 && m.rtail === 0 && r.isrMove && r.isrMove.x === 0 && r.isrMove.y === 191 && m.px === 511 && m.py === 50);
  }
  // the mouse (WINDOWS 15.2): hand-worked.  Off: counters change nothing.  On: no jump; x + 10 right, y counter + 5 (away from the user) = 5 up; wrap; clamp
  {
    const m = fresh(); const A = (x, y, b = 0xFF) => ({ x, y, buttons: b });
    m.poll(rowsOf([]), 0xFF, false, A(200, 7, 0xFD));
    const off = m.px === 256 && m.py === 96 && m.btn === 0 && m.rtail === 0;
    m.mset(1, A(250, 3));                                                  // on: no jump, even though the counters differ from anything seen
    m.poll(rowsOf([]), 0xFF, false, A(250, 3)); const quiet = m.px === 256 && m.rtail === 0;
    m.poll(rowsOf([]), 0xFF, false, A(4, 8)); const wrap = m.px === 256 + 10 && m.py === 96 - 5;      // 250 -> 4: +10 (wrap); y 3 -> 8: up 5
    const e1 = evs(m);
    m.poll(rowsOf([]), 0xFF, false, A(4, 8, 0xFD)); const left = m.btn === 1; const e2 = evs(m);       // left button (bit 1)
    m.poll(rowsOf([]), 0xFF, false, A(4, 8, 0xFC)); const e3 = evs(m);                                 // + right: no more events
    m.poll(rowsOf([]), 0xFF, false, A(4, 8, 0xFB)); const e4 = evs(m);                                 // middle only: left released: E_UP
    m.poll(rowsOf([]), 0xFF, false, A(4, 8, 0xFD)); evs(m); m.mset(0, A(0, 0)); m.poll(rowsOf([]), 0xFF, false, A(99, 99, 0xFD)); const e5 = evs(m);   // off: no stuck button
    m.mset(1, A(0, 0)); m.poll(rowsOf([]), 0xFF, false, A(129, 0));        // +129 = -127 as a signed byte
    C.check('mouse (hand-worked): off changes nothing; on = no jump; x wrap 250 -> 4 = +10, y counter +5 = 5 up; left only; E_UP on release; off releases the button; +129 = -127',
      off && quiet && wrap && eq(e1, [[2, 10, 91, 1]]) && left && eq(e2, [[3, 10, 91, 3]]) && eq(e3, []) && eq(e4, [[4, 10, 91, 1]]) && eq(e5, [[4, 10, 91, 1]]) && m.px === 266 - 127 && m.mouseOn === 1,
      JSON.stringify([off, quiet, wrap, e1, left, e2, e3, e4, e5, m.px]));
    const k = fresh(); k.px = 5; k.py = 5; k.mset(1, A(100, 100)); k.poll(rowsOf([]), 0xFF, false, A(100 - 127, 100 + 127));
    const k2 = fresh(); k2.px = 500; k2.py = 185; k2.mset(1, A(100, 100)); k2.poll(rowsOf([]), 0xFF, false, A(100 + 127, 100 - 127));
    C.check('mouse clamps: (5, 5) + (-127, up 127) = (0, 0); (500, 185) + (127, down 127) = (511, 191)', k.px === 0 && k.py === 0 && k2.px === 511 && k2.py === 191);
    const j = fresh(); j.px = 510; j.py = 96; j.hold = 30; j.mset(1, A(0, 0)); j.poll(rowsOf([]), joyOf('r'), false, A(256 - 5, 0));    // right at full speed (+12) and mouse -5: one clamp of the sum
    C.check('mouse + joystick: the sum is clamped once: 510 + 12 - 5 = 517 -> 511 (clamping first would give 506)', j.px === 511);
    const j2 = fresh(); j2.px = 400; j2.hold = 30; j2.mset(1, A(0, 0)); j2.poll(rowsOf([]), joyOf('r'), false, A(256 - 5, 0));
    C.check('mouse + joystick: 400 + 12 - 5 = 407', j2.px === 407);
    const f = fresh(); f.mset(1, A(0, 0)); f.poll(rowsOf([]), joyOf('udlrf'), false, A(0, 0, 0xFD));
    C.check('mouse left + four directions with fire: mb is ORed after the joystick rule (button down)', f.btn === 1);
  }
  // P_ISRMOVE refused while locked: retried next poll
  {
    const m = fresh(); const a = m.poll(rowsOf([]), joyOf('r'), true); const b = m.poll(rowsOf([]), 0xFF, false);
    C.check('locked: P_ISRMOVE refused (pend kept), the next poll retries it with the current position', a.refused && !a.isrMove && b.isrMove && b.isrMove.x === 258 && b.isrMove.y === 96);
  }
  // queues
  {
    const m = fresh();
    for (let i = 0; i < 5; i++) m.post(16 + i, 1, 2, 3);
    const carry = m.post(99, 0, 0, 0);
    m.append(E.KEY, 1, 0, 0);
    const first = m.getev();
    C.check('posted queue holds 4 (the 5th: carry), K_GETEV returns posted first in order', m.pn === 3 && carry === 1 && first.a === 16 && m.getev().a === 17);
  }
  {
    const m = fresh();
    for (let i = 0; i < 16; i++) m.append(E.DOWN, i, 0, 0);
    const how17 = m.append(E.UP, 0, 0, 0);
    for (let i = 0; i < 300; i++) m.append(E.UP, 0, 0, 0);
    C.check('ring: 16 usable, the 17th is dropped and counted, K_LOST saturates at 255', m.count === 16 && how17 === 'lost' && m.lost === 255 && m.rtail === 64);
    const d = m.drain();
    C.check('drained 16 records in order; head = tail = 64', d.length === 16 && d.every((e, i) => e[1] === i) && m.rhead === 64 && m.rtail === 64);
  }
  {
    const m = fresh();                                                   // coalescing: needs tail - head >= 8 and the last is an E_MOVE
    m.append(E.MOVE, 1, 1, 0); const a = m.append(E.MOVE, 2, 2, 0); m.append(E.DOWN, 0, 0, 0); m.append(E.MOVE, 3, 3, 0); const c = m.append(E.MOVE, 4, 4, 0);
    C.check('coalescing: the first move is the head (appended), a move after a DOWN appends, a move after a move overwrites',
      a === 'appended' && c === 'coalesced' && m.count === 4 && eq(m.drain().map((e) => e[1]), [1, 2, 0, 4]));
  }
  {
    const m = fresh();                                                   // a full ring whose last record is an E_MOVE coalesces (no loss)
    for (let i = 0; i < 15; i++) m.append(E.DOWN, 1, 0, 0); m.append(E.MOVE, 1, 0, 0);
    const h = m.append(E.MOVE, 9, 9, 9);
    C.check('a full ring ending in an E_MOVE: the new move coalesces (14.2), nothing is lost', m.count === 16 && h === 'coalesced' && m.lost === 0);
  }
  C.done();
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) await selfTest();
