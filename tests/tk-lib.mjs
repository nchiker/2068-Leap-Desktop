"use strict";
// tk-lib.mjs -- shared harness of the toolkit T1 tests (tests/tk-t1.mjs, tests/tk-perf.mjs).  Written from docs/TOOLKIT.md (sections 1-9), docs/WINDOWS.md
// and docs/BANKING.md only; src/kernel/tk.asm was never read.  It never builds: it loads the prebuilt build/desk5.dck and
// build/desk5/out.sym through tests/calc-lib.mjs.
//   - bootParked: desk5 booted (it runs the shell since SHELL.md 9-10), the pointer erased, the shell's window closed and the app arena reset: an empty desk for direct
//     calls under K (the groups that build their own windows do not need a program, so none is launched);
//   - runCall: a routine called under K with a sentinel return, stepped instruction by instruction, interrupts ON (so a DI is seen), with hooks:
//     every W_DRAWVIEW (IX) and every K_POST is logged, a HALT is a frame boundary the test answers (V_FRAMES + 1, events put in the ring), the stack
//     depth, the T-states, the preserved registers; user hooks at chosen addresses (a stub target, a method's entry);
//   - tree building from model nodes (tk-model's TkTree nodes) with K_NEW / K_ADDCHILD / W_OPEN / W_UPDATE, the strings in RAM at $5C00;
//   - a stub target class (a copy of Label's descriptor whose M_EVENT is `OR A / RET` at a known address): VScroll's target in the tests.
import * as L from './calc-lib.mjs';
import { Z } from './lib.mjs';
import { coverage, diffDisp, readDisp } from './wm-lib.mjs';
import { Gfx6Model, toDisp } from './tk-model.mjs';

export { L, readDisp, diffDisp };
export const { hex, rd16 } = L;
export const F4K = 0x33;
export const STR0 = 0x5C00, STR_END = 0x5E00, STUB = 0x5E00, STUBCL = 0x5E10;   // free RAM under K ($5800-$5FFF is unused in mode 6)

export const TK_NEEDED = ['CL_Check', 'CL_VScroll', 'CL_Group', 'CL_Window', 'CL_Label', 'Check_text', 'VScroll_value', 'VScroll_max', 'VScroll_page', 'VScroll_target',
  'VScroll_press', 'Window_slot', 'Window_title', 'Label_text', 'K_NEW', 'K_ADDCHILD', 'K_ARESET', 'K_AARENA', 'K_ARENA', 'W_OPEN', 'W_CLOSE', 'W_UPDATE', 'W_DRAWVIEW',
  'K_DISPATCH', 'K_EV', 'K_FOCUS', 'K_CAPTURE', 'K_FSCOPE', 'K_SETFOCUS', 'K_POST', 'K_PN', 'K_PHEAD', 'K_POSTQ', 'K_RING', 'K_RHEAD', 'K_RTAIL', 'K_GETEV', 'K_PX', 'K_PY', 'K_BTN',
  'TK_SETBAR', 'TK_CODE', 'TK_END', 'TK_EV', 'V_FRAMES', 'T_SEND', 'T_RET', 'E_SCROLL', 'E_CMD', 'M_EVENT', 'M_DRAW', 'P_SHIELD', 'P_UNSHIELD', 'GA', 'G_SETCLIP',
  'S_WIN', 'CL_CWindow', 'W_DIRTY'];

// T2 / T3: item arrays, their strings and Field buffers live in $5800-$5BFF (free RAM under K; reset by buildTree)
export const BUF0 = 0x5800, BUF_END = 0x5C00;
export const NEEDED2 = ['CL_List', 'CL_Field', 'List_items', 'List_count', 'List_sel', 'List_top', 'List_bar', 'Field_buf', 'Field_cap', 'Field_caret', 'Field_first', 'TK_SETITEMS', 'TK_SETTEXT', 'TK2_CODE', 'TK2_END'];   // List is in desk5l (desk5 built with TK_LIST; docs/SIZE.md 6)
/** Throw "desk5 does not define: ..." when a symbol is missing. */
export function needSyms(env, names) {
  const missing = names.filter((n) => env.S[n] === undefined);
  if (missing.length) throw new Error(`desk5 does not define: ${missing.join(', ')}`);
}
export const poke8 = (env, a, v) => { env.m.ram[a] = v & 0xFF; };
export const poke16 = (env, a, v) => { env.m.ram[a] = v & 0xFF; env.m.ram[a + 1] = (v >> 8) & 0xFF; };
export const peek8 = (env, a) => env.m.ram[a];

const R8 = ['a', 'f', 'b', 'c', 'd', 'e', 'h', 'l', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl'];
const PAIRS = { af: ['a', 'f'], bc: ['b', 'c'], de: ['d', 'e'], hl: ['h', 'l'], ix: ['xh', 'xl'], iy: ['yh', 'yl'] };
const KEEP_ALT = ['a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'yh', 'yl'];

/**
 * Call `addr` under mapping K with the sentinel return and step it.  regs: registers (8-bit names or pairs); the others are random when env.rng is set.
 * o: { ints (default true), hooks: { pc: fn(info) }, onHalt(info), onDraw(ix, info), stopPc, guard, ixOut, keepIx }.
 * A hook returns 'stop' to stop there (the instruction at that pc is not executed).
 * Returns { t, regs, draws, posts, halts, di, minSp, stack, stopped, preserved, sp }.
 */
export function runCall(env, addr, regs = {}, o = {}) {
  const { m, S } = env, cpu = m.cpu, ints = o.ints !== false, guard = o.guard ?? 8_000_000;
  const rng = env.rng, want = {};
  for (const [k, v] of Object.entries(regs)) { if (PAIRS[k]) { want[PAIRS[k][0]] = (v >> 8) & 0xFF; want[PAIRS[k][1]] = v & 0xFF; } else want[k] = v & 0xFF; }
  const regsIn = {};
  for (const r of R8) { regsIn[r] = want[r] !== undefined ? want[r] : (rng ? rng.int(0, 255) : 0); cpu[r] = regsIn[r]; }
  const f4 = o.map === 'A' ? 0x3F : F4K;                          // o.map 'A': the callee is code in DOCK 2-3 (a program's own routine), as calc-lib's directKey / directCall
  m.ram[S.V_SHADOW_F4] = f4; m.portF4 = f4;
  cpu.halted = false; cpu.nmiPending = false; cpu.eiDelay = false; cpu.iff1 = cpu.iff2 = ints;
  const sp0 = 0xFF00 - 2;
  cpu.sp = sp0; m.ram[sp0] = S.T_RET & 0xFF; m.ram[sp0 + 1] = S.T_RET >> 8;
  cpu.pc = addr;
  const info = { draws: [], posts: [], halts: 0, di: 0, minSp: sp0, stopped: false, steps: 0 };
  const t0 = m.tstates, ret = S.T_RET, hooks = o.hooks || {};
  let steps = 0;
  while (cpu.pc !== ret) {
    const pc = cpu.pc;
    if (pc === S.W_DRAWVIEW) { const ix = (cpu.xh << 8) | cpu.xl; info.draws.push(ix); if (o.onDraw) o.onDraw(ix, info); }
    else if (pc === S.K_POST) { const p = { a: cpu.a, c: cpu.c, e: cpu.e, d: cpu.d }; info.posts.push(p); if (o.onPost) o.onPost(p, info); }
    if (o.stopPc !== undefined && pc === o.stopPc && steps > 0) { info.stopped = true; break; }
    const h = hooks[pc];
    if (h && h(info) === 'stop') { info.stopped = true; break; }
    Z.runZ80(cpu, m.bus, 1, m);
    steps++;
    if (cpu.sp < info.minSp) info.minSp = cpu.sp;
    if (ints && !cpu.iff1) { info.di++; cpu.iff1 = cpu.iff2 = true; }
    if (cpu.halted) {
      cpu.halted = false; info.halts++;
      if (!ints) throw new Error(`runCall ${hex(addr)}: a HALT with interrupts off at ${hex(cpu.pc)}`);
      if (o.onHalt) o.onHalt(info); else if (!o.allowHalt) throw new Error(`runCall ${hex(addr)}: an unexpected HALT at ${hex(cpu.pc)}`);
    }
    if (steps > guard) throw new Error(`runCall ${hex(addr)}: no return after ${steps} instructions (PC ${hex(cpu.pc)})`);
  }
  info.t = m.tstates - t0; info.steps = steps;
  if (o.map === 'A') { m.ram[S.V_SHADOW_F4] = F4K; m.portF4 = F4K; }
  const out = {};
  for (const r of R8) out[r] = cpu[r];
  for (const [k, [hi, lo]] of Object.entries(PAIRS)) out[k] = (out[hi] << 8) | out[lo];
  info.regs = out; info.sp = cpu.sp;
  info.stack = sp0 - info.minSp;             // bytes pushed below the return address (the sentinel's own 2 not counted)
  const bad = KEEP_ALT.filter((r) => out[r] !== regsIn[r]);
  if (!o.ixOut && (out.xh !== regsIn.xh || out.xl !== regsIn.xl)) bad.push('ix');
  info.preserved = bad;
  info.carry = out.f & 1;
  if (!info.stopped && cpu.sp !== sp0 + 2) info.badSp = cpu.sp;
  return info;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
/** The pointer erased and parked out of the way, the shell's window closed, the app arena reset: an empty desk.  No frame is run afterwards. */
export function bootParked(opts = {}) {
  const env = L.bootDesk5({ ...opts, prog: 0 }), { m, S } = env;
  env.rng = opts.rng || null;
  const missing = TK_NEEDED.filter((n) => S[n] === undefined);
  if (missing.length) throw new Error(`desk5 does not define: ${missing.join(', ')}`);
  poke16(env, S.GA, 0); poke16(env, S.GA + 2, 0); poke16(env, S.GA + 4, 512); poke16(env, S.GA + 6, 192);
  runCall(env, S.P_SHIELD, {}, { ints: false }); runCall(env, S.P_UNSHIELD, {}, { ints: false });
  const cw = rd16(m, S.S_WIN);
  runCall(env, S.W_CLOSE, { ix: cw }, { ints: false });
  runCall(env, S.W_UPDATE, {}, { ints: false });
  runCall(env, S.K_ARESET, { hl: S.K_AARENA }, { ints: false });
  runCall(env, S.K_ARENA, { hl: S.K_AARENA }, { ints: false });
  env.strp = STR0;
  installStub(env);
  L.park(env);
  return env;
}
/** The stub target: a class that is Label's descriptor with M_EVENT = `OR A / RET` at STUB.  Returns the class pointer. */
export function installStub(env) {
  const { m, S } = env, rb = (a) => m.bus.read(a);
  m.ram[STUB] = 0xB7; m.ram[STUB + 1] = 0xC9;
  for (let i = 0; i < 18; i++) m.ram[STUBCL - 6 + i] = rb(S.CL_Label - 6 + i);
  m.ram[STUBCL + 4] = STUB & 0xFF; m.ram[STUBCL + 5] = STUB >> 8;
  return STUBCL;
}
export const STUB_CLASS = STUBCL + 0;

/** A length-prefixed string in the buffer area (env.bufp); returns its address. */
export function bstr(env, codes) {
  const a = balloc(env, codes.length + 1);
  env.m.ram[a] = codes.length; for (let i = 0; i < codes.length; i++) env.m.ram[a + 1 + i] = codes[i];
  return a;
}
export function balloc(env, n) {
  const a = env.bufp ?? BUF0;
  if (a + n > BUF_END) throw new Error('buffer area full');
  env.bufp = a + n;
  return a;
}
/** An array of string pointers for a List (codes[][]); returns its address. */
export function itemsArray(env, items) {
  const ptrs = items.map((c) => bstr(env, c)), arr = balloc(env, Math.max(2, 2 * ptrs.length));
  ptrs.forEach((p, i) => poke16(env, arr + 2 * i, p));
  return arr;
}
export function str(env, codes) {
  const a = env.strp, n = codes.length;
  if (a + n + 1 > STR_END) throw new Error('string area full');
  env.m.ram[a] = n; for (let i = 0; i < n; i++) env.m.ram[a + 1 + i] = codes[i];
  env.strp = a + n + 1;
  return a;
}
export const codesOf = (s) => Array.from(s, (c) => c.charCodeAt(0));
export const textOf = (m, a) => (a ? String.fromCharCode(...m.ram.subarray(a + 1, a + 1 + m.ram[a])) : null);

export function kNew(env, cls) {
  const r = runCall(env, env.S.K_NEW, { hl: cls }, { ints: false, ixOut: true });
  if (r.carry) throw new Error(`K_NEW ${hex(cls)}: arena full`);
  return r.regs.ix;
}
export function setRect(env, a, x, y, w, h) {
  const S = env.S;
  poke16(env, a + S.View_x, x); poke8(env, a + S.View_y, y); poke16(env, a + S.View_w, w); poke8(env, a + S.View_h, h);
}
export const addChild = (env, parent, child) => runCall(env, env.S.K_ADDCHILD, { ix: parent, de: child }, { ints: false });

/**
 * Build the window of a TkTree (tk-model) in the machine: K_NEW, fields, K_ADDCHILD in list order, W_OPEN, W_UPDATE.  Sets node.addr on every node and tree.win.addr
 * and tree.win.slot (read back).  Returns the window's address.
 */
export function buildTree(env, tree) {
  const S = env.S, w = tree.win;
  env.strp = STR0; env.bufp = BUF0;
  const fix = [];
  const win = kNew(env, S.CL_Window);
  setRect(env, win, w.x, w.y, w.w, w.h);
  poke16(env, win + S.Window_title, str(env, w.title));
  w.addr = win;
  const mk = (n) => {
    let a;
    switch (n.kind) {
      case 'Check': a = kNew(env, S.CL_Check); poke16(env, a + S.Check_text, str(env, n.codes)); break;
      case 'Label': a = kNew(env, S.CL_Label); poke16(env, a + S.Label_text, str(env, n.codes)); break;
      case 'VScroll':
        a = kNew(env, S.CL_VScroll);
        poke8(env, a + S.VScroll_value, n.value); poke8(env, a + S.VScroll_max, n.max); poke8(env, a + S.VScroll_page, n.page);
        poke16(env, a + S.VScroll_target, n.target || 0); break;
      case 'Group': a = kNew(env, S.CL_Group); break;
      case 'List':
        a = kNew(env, S.CL_List);
        poke16(env, a + S.List_items, itemsArray(env, n.items)); poke8(env, a + S.List_count, n.count); poke8(env, a + S.List_sel, n.sel); poke8(env, a + S.List_top, n.top);
        poke16(env, a + S.List_bar, 0);
        if (n.bar) fix.push(() => poke16(env, a + S.List_bar, n.bar.addr));
        break;
      case 'Field': {
        a = kNew(env, S.CL_Field);
        const b = balloc(env, n.cap + 1);
        env.m.ram[b] = n.buf.length; n.buf.forEach((c, i) => { env.m.ram[b + 1 + i] = c; });
        poke16(env, a + S.Field_buf, b); poke8(env, a + S.Field_cap, n.cap); poke8(env, a + S.Field_caret, n.caret); poke8(env, a + S.Field_first, n.first);
        break;
      }
      default: throw new Error(`buildTree: ${n.kind}`);
    }
    setRect(env, a, n.x, n.y, n.w, n.h); poke8(env, a + S.View_flags, n.flags || 0); poke8(env, a + S.View_id, n.id || 0);
    n.addr = a;
    if (n.kind === 'VScroll' && n.targetNode) fix.push(() => poke16(env, a + S.VScroll_target, n.targetNode.addr));
    for (const k of n.kids || []) addChild(env, a, mk(k));
    return a;
  };
  for (const k of w.kids) addChild(env, win, mk(k));
  for (const f of fix) f();
  const r = runCall(env, S.W_OPEN, { ix: win }, { ints: false });
  if (r.carry) throw new Error('W_OPEN refused the test window');
  runCall(env, S.W_UPDATE, {}, { ints: false });
  w.slot = env.m.ram[win + S.Window_slot];
  return win;
}
/** Close the window and empty the arena (the machine is back to an empty desk). */
export function clearTree(env, tree) {
  const S = env.S;
  runCall(env, S.W_CLOSE, { ix: tree.win.addr }, { ints: false });
  runCall(env, S.W_UPDATE, {}, { ints: false });
  runCall(env, S.K_ARESET, { hl: S.K_AARENA }, { ints: false });
  poke16(env, S.K_FOCUS, 0); poke16(env, S.K_CAPTURE, 0); poke16(env, S.K_FSCOPE, 0);
}
export const nodeAt = (tree, addr) => (tree.win.addr === addr ? tree.win : tree.nodes().find((n) => n.addr === addr));

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Events
export function setEv(env, rec) { for (let i = 0; i < 4; i++) env.m.ram[env.S.K_EV + i] = rec[i] || 0; }
/** A pointer record: data 3 = x bit 8, bit 1 the button held, bit 2 the kernel's double-click flag (E_DOWN only; WRITE 14.9 item 1). */
export const ptRec = (t, px, py, held = 0, dbl = 0) => [t, px & 255, py & 255, ((px >> 8) & 1) | (held ? 2 : 0) | (dbl ? 4 : 0)];
export function ringPut(env, rec) {
  const { m, S } = env, tail = m.ram[S.K_RTAIL], a = S.K_RING + (tail & 0x3F);
  for (let i = 0; i < 4; i++) m.ram[a + i] = rec[i] || 0;
  m.ram[S.K_RTAIL] = (tail + 4) & 0xFF;
}
export const drainEvents = (env) => { env.m.ram[env.S.K_PN] = 0; env.m.ram[env.S.K_RHEAD] = env.m.ram[env.S.K_RTAIL]; };
export const postedQueue = (env) => {
  const { m, S } = env, n = m.ram[S.K_PN], h = m.ram[S.K_PHEAD], out = [];
  for (let k = 0; k < n; k++) { const a = S.K_POSTQ + 4 * ((h + k) & 3); out.push([m.ram[a], m.ram[a + 1], m.ram[a + 2], m.ram[a + 3]]); }
  return out;
};
export const vframes = (env) => rd16(env.m, env.S.V_FRAMES);
export const setVframes = (env, v) => poke16(env, env.S.V_FRAMES, v);

// ---------------------------------------------------------------------------------------------------------------------------------------------
// The screen
const complement = (cov) => { const o = new Uint8Array(cov.length); for (let i = 0; i < o.length; i++) o[i] = 0xFF ^ cov[i]; return o; };
export const rectCov = (x, y, w, h) => coverage([[x, x + w, y, y + h]]);
/** Compare the machine's display inside the rectangle with the model's pixels; null when equal. */
export function diffRect(env, g, x, y, w, h) { return diffDisp(readDisp(env.m), toDisp(g), rectCov(x, y, w, h)); }
/** The display bytes before / after must be equal outside the rectangle. */
export function diffOutside(before, after, x, y, w, h) { return diffDisp(before, after, complement(rectCov(x, y, w, h))); }
export { Gfx6Model };
