"use strict";
// kern-model.mjs -- reference model of the K1 kernel (docs/OBJECTS_EVENTS.md sections 2-5, 13).  Written from the contract only.
//
// The model owns a 64 KB byte image `mem` (a copy of the machine's RAM when the model is created) and applies every routine's
// documented writes to it, so a test can compare the image with the machine byte for byte and every returned value with the
// model's prediction.  Class layouts are declared below from section 3 / 13.2 / 13.3 / 13.6 (flattened here, independently of
// tools/gen-classes.mjs); the addresses come from the symbol table `S` (CL_<Name>, K_KARENA, ..., T_LOG, T_LOGN).
//
//   node tests/kern-model.mjs --self-test
import { fileURLToPath } from 'node:url';

export const MSG = { DESTROY: 0, DRAW: 1, EVENT: 2, HITTEST: 3, FOCUS: 4, BLUR: 5, POKE: 6, POKE2: 7 };

// ---------------------------------------------------------------------------------------------------------------------------
// Class declarations (13.3 for Object / View, 13.6 for the test classes), as the class file would give them.
const OBJ_METHODS = [['Destroy', 'obj_destroy'], ['Draw', 'k_nop'], ['Event', 'k_nop'], ['HitTest', 'k_nop'], ['Focus', 'k_nop'],
  ['Blur', 'k_nop']];
export const DECL = [
  { name: 'Object', parent: null, fields: [], methods: OBJ_METHODS },
  { name: 'View', parent: 'Object', fields: [['parent', 2], ['child', 2], ['next', 2], ['x', 2], ['y', 1], ['w', 2], ['h', 1],
    ['flags', 1], ['id', 1]], methods: [['Destroy', 'view_destroy'], ['HitTest', 'view_hittest']] },
  { name: 'TLog', parent: 'View', fields: [['tag', 1]], methods: [['Destroy', 't_destroy'], ['Draw', 't_draw'], ['Event', 't_event'],
    ['HitTest', 't_hittest'], ['Focus', 't_focus'], ['Blur', 't_blur'], ['Poke', 't_poke']] },
  { name: 'TLog2', parent: 'TLog', fields: [], methods: [['Draw', 't_draw2'], ['Poke2', 't_poke2']] },
  ...[8, 9, 16, 24, 32, 33, 40, 255].map((n) => ({ name: `TSz${n}`, parent: 'Object', fields: [['pad', n - 2]], methods: [] })),
];

/** The pool (an offset in an arena record) for an instance size (13.2). */
export const poolOf = (size) => (size <= 8 ? 6 : size <= 16 ? 8 : size <= 24 ? 10 : size <= 32 ? 12 : 14);
/** The block size of a pool: 8 / 16 / 24 / 32; null for pool 14 (exact size). */
export const blockOf = (pool) => (pool === 14 ? null : 8 * ((pool - 6) / 2 + 1));

/** Flatten the declarations: returns { list, byName }; each class { name, parent, size, pool, count, offsets, fields, slots: [{ n, name, label }] }. */
export function buildClasses(decl = DECL) {
  const list = [], byName = {};
  for (const d of decl) {
    const par = d.parent ? byName[d.parent] : null;
    if (d.parent && !par) throw new Error(`class ${d.name}: parent ${d.parent} not defined earlier`);
    const slots = par ? par.slots.map((s) => ({ ...s })) : [];
    for (const [mname, label] of d.methods) {
      const s = slots.find((x) => x.name === mname);
      if (s) s.label = label; else slots.push({ n: slots.length, name: mname, label });
    }
    const offsets = par ? { ...par.offsets } : {};
    const fields = par ? par.fields.map((f) => ({ ...f })) : [];
    let size = par ? par.size : 2;
    for (const [fname, fsz] of d.fields) { offsets[fname] = size; fields.push({ name: fname, offset: size, size: fsz, owner: d.name }); size += fsz; }
    if (size > 255) throw new Error(`class ${d.name}: size ${size} > 255`);
    const c = { name: d.name, parent: d.parent, size, pool: poolOf(size), count: slots.length, offsets, fields, slots, decl: d };
    list.push(c); byName[d.name] = c;
  }
  return { list, byName };
}

/** The expected descriptor bytes of a class given the symbol table: { parent, id, count, size, pool, table: [addresses] }. */
export function expectedDescriptor(cls, S, id) {
  return { parent: cls.parent ? S[`CL_${cls.parent}`] : 0, id, count: cls.count, size: cls.size, pool: cls.pool,
    table: cls.slots.map((s) => S[s.label]) };
}

// ---------------------------------------------------------------------------------------------------------------------------
const VIEW = { parent: 2, child: 4, next: 6, x: 8, y: 10, w: 11, h: 13, flags: 14, id: 15 };      // 13.3
const TAG = 16;                                                                                    // TLog_tag
export const F = { ...VIEW, tag: TAG };

export class KernelModel {
  /** S: symbols (K_KARENA, K_AARENA, K_CURA, K_FOCUS, K_CAPTURE, K_ROOT, T_LOG, T_LOGN, CL_<Name>, ...); mem: Uint8Array(65536) (owned). */
  constructor(S, mem, classes = buildClasses()) {
    this.S = S; this.mem = mem; this.classes = classes;
    this.byPtr = new Map();
    for (const c of classes.list) if (S[`CL_${c.name}`] !== undefined) this.byPtr.set(S[`CL_${c.name}`], c);
    this.wild = [];            // [addr, len] ranges the contract leaves unspecified (BC / DE of a recursive M_DESTROY's log record)
    this.stat = { sends: 0, news: 0, frees: 0, allocs: 0, fromList: 0 };
  }
  rd8(a) { return this.mem[a & 0xFFFF]; }
  wr8(a, v) { this.mem[a & 0xFFFF] = v & 0xFF; }
  rd16(a) { return this.mem[a & 0xFFFF] | (this.mem[(a + 1) & 0xFFFF] << 8); }
  wr16(a, v) { this.mem[a & 0xFFFF] = v & 0xFF; this.mem[(a + 1) & 0xFFFF] = (v >> 8) & 0xFF; }
  classAt(ptr) { const c = this.byPtr.get(ptr); if (!c) throw new Error(`model: no class at $${ptr.toString(16)}`); return c; }
  classOf(inst) { return this.classAt(this.rd16(inst)); }
  clsPtr(name) { return this.S[`CL_${name}`]; }

  // ---- arenas (section 4, 13.4) -----------------------------------------------------------------------------------------
  rec(r) { return { top: this.rd16(r), end: this.rd16(r + 2), base: this.rd16(r + 4), heads: [6, 8, 10, 12, 14].map((o) => this.rd16(r + o)) }; }
  /** K_AINIT: HL = record, DE = base, BC = end (page aligned, base <= end).  Zeroes all of [base, end). */
  aInit(r, base, end) {
    if ((base & 0xFF) || (end & 0xFF) || base > end) throw new Error('model: K_AINIT with an unaligned or inverted range');
    this.wr16(r, base); this.wr16(r + 2, end); this.wr16(r + 4, base);
    for (let o = 6; o <= 14; o += 2) this.wr16(r + o, 0);
    this.mem.fill(0, base, end);
  }
  /** K_ARENA: K_CURA = r. */
  arena(r) { this.wr16(this.S.K_CURA, r); }
  get cur() { return this.rd16(this.S.K_CURA); }
  /** K_ARESET: top = base, the four heads = 0, [base, end) = 0, K_FOCUS / K_CAPTURE / K_ROOT cleared when pointing into the arena. */
  aReset(r) {
    const { end, base } = this.rec(r);
    this.wr16(r, base);
    for (const o of [6, 8, 10, 12]) this.wr16(r + o, 0);
    this.mem.fill(0, base, end);
    for (const a of [this.S.K_FOCUS, this.S.K_CAPTURE, this.S.K_ROOT]) {
      const hi = this.rd16(a) >> 8;
      if (hi >= (base >> 8) && hi < (end >> 8)) this.wr16(a, 0);
    }
  }
  /** K_NEW (class pointer): { carry, addr }.  From the arena top only the class pointer is written (the rest is 0 by the invariant). */
  newObj(clsPtr) {
    const c = this.classAt(clsPtr), r = this.cur, rc = this.rec(r), pool = c.pool;
    const head = pool === 14 ? 0 : rc.heads[(pool - 6) / 2];
    if (head !== 0) {
      this.wr16(r + pool, this.rd16(head));
      this.wr16(head, clsPtr);
      this.mem.fill(0, head + 2, head + c.size);
      this.stat.news++; this.stat.fromList++;
      return { carry: 0, addr: head, fromList: true };
    }
    const bsz = pool === 14 ? c.size : blockOf(pool);
    if (bsz > ((rc.end - rc.top) & 0xFFFF)) return { carry: 1, addr: null };
    this.wr16(r, rc.top + bsz);
    this.wr16(rc.top, clsPtr);
    this.stat.news++;
    return { carry: 0, addr: rc.top, fromList: false };
  }
  /** The record holding block addr (13.4): the app arena when its high byte is in [app base high, app end high), else the kernel arena's. */
  arenaOf(addr) {
    const a = this.rec(this.S.K_AARENA), hi = addr >> 8;
    return (hi >= (a.base >> 8) && hi < (a.end >> 8)) ? this.S.K_AARENA : this.S.K_KARENA;
  }
  /** K_FREE (IX = instance). */
  free(inst) {
    const c = this.classOf(inst);
    this.stat.frees++;
    if (c.pool === 14) return;
    const r = this.arenaOf(inst);
    this.wr16(inst, this.rd16(r + c.pool));
    this.wr16(r + c.pool, inst);
  }
  /** K_ALLOC (BC = bytes): { carry, addr }. */
  alloc(bc) {
    const r = this.cur, rc = this.rec(r);
    this.stat.allocs++;
    if (bc > ((rc.end - rc.top) & 0xFFFF)) return { carry: 1, addr: null };
    this.wr16(r, rc.top + bc);
    return { carry: 0, addr: rc.top };
  }

  // ---- view tree (13.3, 13.4) --------------------------------------------------------------------------------------------
  parentOf(v) { return this.rd16(v + VIEW.parent); }
  childOf(v) { return this.rd16(v + VIEW.child); }
  nextOf(v) { return this.rd16(v + VIEW.next); }
  children(v) { const out = []; for (let c = this.childOf(v); c; c = this.nextOf(c)) { out.push(c); if (out.length > 4096) throw new Error('model: cyclic child list'); } return out; }
  subtree(v) { const out = [v]; for (const c of this.children(v)) out.push(...this.subtree(c)); return out; }
  ancestors(v) { const out = []; for (let p = this.parentOf(v); p; p = this.parentOf(p)) { out.push(p); if (out.length > 4096) throw new Error('model: cyclic parents'); } return out; }
  /** Nodes on the path from the root to v, v included. */
  pathLen(v) { return this.ancestors(v).length + 1; }
  /** Nodes on the longest path from v down, v included. */
  height(v) { let h = 0; for (const c of this.children(v)) h = Math.max(h, this.height(c)); return h + 1; }
  /** K_ADDCHILD (IX = parent, DE = child): the child becomes the parent's last child. */
  addChild(p, c) {
    this.wr16(c + VIEW.parent, p); this.wr16(c + VIEW.next, 0);
    let link = p + VIEW.child;
    while (this.rd16(link) !== 0) link = this.rd16(link) + VIEW.next;
    this.wr16(link, c);
  }
  /** K_UNLINK (IX = view). */
  unlink(v) {
    const p = this.parentOf(v);
    if (p === 0) return;
    let link = p + VIEW.child;
    while (this.rd16(link) !== v) {
      if (this.rd16(link) === 0) throw new Error('model: K_UNLINK of a view that is not in its parent\'s list');
      link = this.rd16(link) + VIEW.next;
    }
    this.wr16(link, this.nextOf(v));
    this.wr16(v + VIEW.parent, 0); this.wr16(v + VIEW.next, 0);
  }
  /** K_SETROOT (DE). */
  setRoot(v) { this.wr16(this.S.K_ROOT, v); this.wr16(this.S.K_FOCUS, 0); this.wr16(this.S.K_CAPTURE, 0); }

  /** view_destroy (13.3, exactly): children first (each by a send of M_DESTROY), then K_UNLINK, the three pointers, K_FREE. */
  destroyView(v) {
    while (this.childOf(v) !== 0) this.send(this.childOf(v), MSG.DESTROY, null, null);     // BC / DE of the recursive send: unspecified
    this.unlink(v);
    for (const a of [this.S.K_FOCUS, this.S.K_CAPTURE, this.S.K_ROOT]) if (this.rd16(a) === v) this.wr16(a, 0);
    this.free(v);
  }
  /** view_hittest (13.3): unsigned 16-bit differences, y with D = 0 (D > 0 is a miss).  Flags are not consulted. */
  hit(v, x, y) {
    const dx = (x - this.rd16(v + VIEW.x)) & 0xFFFF;
    if (dx >= this.rd16(v + VIEW.w)) return 0;
    if ((y >> 8) !== 0) return 0;
    const dy = ((y & 0xFF) - this.rd8(v + VIEW.y)) & 0xFFFF;
    return dy < this.rd8(v + VIEW.h) ? 1 : 0;
  }

  // ---- the log (13.6) ----------------------------------------------------------------------------------------------------
  /** A test method's record: code, IX, C, B, E, D, tag; T_LOGN + 1.  bc / de null = unspecified by the contract (a wild range). */
  log(code, ix, bc, de) {
    const k = this.rd16(this.S.T_LOGN), a = this.S.T_LOG + 8 * (k & 255);
    this.wr8(a, code); this.wr8(a + 1, ix); this.wr8(a + 2, ix >> 8);
    if (bc === null) { this.wild.push([a + 3, 4]); }
    else { this.wr8(a + 3, bc); this.wr8(a + 4, bc >> 8); this.wr8(a + 5, de); this.wr8(a + 6, de >> 8); }
    this.wr8(a + 7, this.rd8(ix + TAG));
    this.wr16(this.S.T_LOGN, k + 1);
  }
  /** The method label (class, message) reaches. */
  label(cls, msg) { const s = cls.slots[msg]; return s ? s.label : undefined; }
  /**
   * Send (K_SEND): returns { label, carry (0 / 1, or null when the contract leaves it open) } and applies the method's effects.
   * bc / de may be null for a send made by the kernel itself (unspecified registers).
   */
  send(ix, msg, bc, de) {
    const cls = this.classOf(ix), label = this.label(cls, msg);
    if (label === undefined) throw new Error(`model: message ${msg} out of range for ${cls.name}`);
    this.stat.sends++;
    const code = msg | ((label === 't_draw2' || label === 't_poke2') ? 0x80 : 0);
    const tag = () => this.rd8(ix + TAG);
    switch (label) {
      case 'k_nop': return { label, carry: 0 };
      case 'obj_destroy': this.free(ix); return { label, carry: null };
      case 'view_destroy': this.destroyView(ix); return { label, carry: null };
      case 'view_hittest': return { label, carry: this.hit(ix, bc, de) };
      case 't_destroy': this.log(code, ix, bc, de); this.destroyView(ix); return { label, carry: null };
      case 't_event': this.log(code, ix, bc, de); return { label, carry: tag() & 1 };
      case 't_hittest': this.log(code, ix, bc, de); return { label, carry: (tag() >> 1) & 1 };
      case 't_draw': case 't_draw2': case 't_focus': case 't_blur': case 't_poke': case 't_poke2':
        this.log(code, ix, bc, de); return { label, carry: 0 };
      default: throw new Error(`model: unknown method label ${label}`);
    }
  }
  /** Take (and clear) the wild ranges recorded since the last call. */
  takeWild() { const w = this.wild; this.wild = []; return w; }
}

// ===========================================================================================================================
// Self-test: hand-computed cases against a fake symbol table, then random sequences checked against invariants.
function selfTest() {
  let fails = 0, n = 0;
  const eq = (name, got, want) => { n++; if (JSON.stringify(got) !== JSON.stringify(want)) { fails++; console.log(`FAIL: ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); } };
  const cls = buildClasses();
  // fake symbols
  const S = { K_KARENA: 0xF050, K_AARENA: 0xF060, K_CURA: 0xF070, K_FOCUS: 0xF072, K_CAPTURE: 0xF074, K_ROOT: 0xF076, T_LOG: 0xE800, T_LOGN: 0xE090,
    obj_destroy: 0xA000, k_nop: 0xA010, view_destroy: 0xA020, view_hittest: 0xA030, t_destroy: 0xB000, t_draw: 0xB010, t_event: 0xB020,
    t_hittest: 0xB030, t_focus: 0xB040, t_blur: 0xB050, t_poke: 0xB060, t_draw2: 0xB070, t_poke2: 0xB080 };
  cls.list.forEach((c, i) => { S[`CL_${c.name}`] = 0xA100 + 0x40 * i; });
  const fresh = () => {
    const mem = new Uint8Array(65536); for (let i = 0; i < mem.length; i++) mem[i] = (i * 2654435761 >>> 13) & 0xFF;     // junk
    const k = new KernelModel(S, mem, cls);
    k.aInit(S.K_KARENA, 0xF100, 0xFB00); k.aInit(S.K_AARENA, 0xC000, 0xE000); k.arena(S.K_AARENA);
    for (const a of [S.K_FOCUS, S.K_CAPTURE, S.K_ROOT, S.T_LOGN]) k.wr16(a, 0);
    return k;
  };
  const P = (name) => S[`CL_${name}`];

  // flattening and layout
  const by = cls.byName;
  eq('Object', [by.Object.size, by.Object.pool, by.Object.count], [2, 6, 6]);
  eq('View', [by.View.size, by.View.pool, by.View.count], [16, 8, 6]);
  eq('View offsets', Object.values(by.View.offsets), [2, 4, 6, 8, 10, 11, 13, 14, 15]);
  eq('TLog', [by.TLog.size, by.TLog.pool, by.TLog.count, by.TLog.offsets.tag], [17, 10, 7, 16]);
  eq('TLog2 table', by.TLog2.slots.map((s) => s.label), ['t_destroy', 't_draw2', 't_event', 't_hittest', 't_focus', 't_blur', 't_poke', 't_poke2']);
  eq('View table', by.View.slots.map((s) => s.label), ['view_destroy', 'k_nop', 'k_nop', 'view_hittest', 'k_nop', 'k_nop']);
  eq('pools', ['TSz8', 'TSz9', 'TSz16', 'TSz24', 'TSz32', 'TSz33', 'TSz40', 'TSz255'].map((x) => by[x].pool), [6, 8, 8, 10, 12, 14, 14, 14]);
  eq('blocks', [6, 8, 10, 12, 14].map(blockOf), [8, 16, 24, 32, null]);

  // arenas
  let k = fresh();
  eq('AINIT record', Array.from(k.mem.subarray(S.K_AARENA, S.K_AARENA + 16)), [0, 0xC0, 0, 0xE0, 0, 0xC0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  eq('AINIT zeroes', [k.mem[0xC000], k.mem[0xDFFF], k.mem[0xF1FF]], [0, 0, 0]);
  let r = k.newObj(P('TSz16'));
  eq('NEW first', r, { carry: 0, addr: 0xC000, fromList: false });
  eq('top', k.rd16(S.K_AARENA), 0xC010);
  eq('class ptr', k.rd16(0xC000), P('TSz16'));
  r = k.newObj(P('TSz9')); eq('NEW 9', [r.addr, k.rd16(S.K_AARENA)], [0xC010, 0xC020]);
  r = k.newObj(P('TSz40')); eq('NEW 40 exact', [r.addr, k.rd16(S.K_AARENA)], [0xC020, 0xC048]);
  r = k.newObj(P('TSz8')); eq('NEW 8', [r.addr, k.rd16(S.K_AARENA)], [0xC048, 0xC050]);
  k.free(0xC000); k.free(0xC010);
  eq('FREE LIFO head16', k.rd16(S.K_AARENA + 8), 0xC010); eq('link', k.rd16(0xC010), 0xC000); eq('link end', k.rd16(0xC000), 0);
  k.mem[0xC013] = 0x55; k.mem[0xC00F] = 0x66;
  r = k.newObj(P('TSz16')); eq('NEW from list', [r.addr, r.fromList, k.rd16(S.K_AARENA + 8)], [0xC010, true, 0xC000]);
  eq('zeroed size bytes', [k.mem[0xC013], k.rd16(0xC010)], [0, P('TSz16')]);
  k.free(0xC020); eq('FREE pool 14 noop', k.rd16(0xC020), P('TSz40'));
  eq('pool 14 head', k.rd16(S.K_AARENA + 14), 0);
  // kernel arena routing of a free
  k.arena(S.K_KARENA); r = k.newObj(P('TSz24')); eq('kernel NEW', [r.addr, k.rd16(S.K_KARENA)], [0xF100, 0xF118]);
  k.free(r.addr); eq('kernel FREE head24', k.rd16(S.K_KARENA + 10), 0xF100);
  // alloc and full
  k = fresh(); r = k.alloc(0x1FFF); eq('ALLOC', r, { carry: 0, addr: 0xC000 }); r = k.alloc(2); eq('ALLOC full', r.carry, 1); eq('top unchanged', k.rd16(S.K_AARENA), 0xDFFF);
  r = k.alloc(1); eq('ALLOC exact', [r.carry, k.rd16(S.K_AARENA)], [0, 0xE000]); r = k.alloc(0); eq('ALLOC 0 at full', r.carry, 0);
  r = k.newObj(P('TSz8')); eq('NEW at full', r.carry, 1); r = k.alloc(65535); eq('ALLOC huge', r.carry, 1);
  // NEW full by one byte
  k = fresh(); k.alloc(0x2000 - 7); r = k.newObj(P('TSz8')); eq('NEW 8 with 7 left', r.carry, 1);
  k = fresh(); k.alloc(0x2000 - 8); r = k.newObj(P('TSz8')); eq('NEW 8 with 8 left', [r.carry, r.addr], [0, 0xDFF8]);
  // reset
  k = fresh(); k.newObj(P('TSz8')); k.wr16(S.K_FOCUS, 0xC010); k.wr16(S.K_CAPTURE, 0xE000); k.wr16(S.K_ROOT, 0xDF00);
  k.mem[0xC003] = 9; k.wr16(S.K_AARENA + 6, 0xC000);
  k.aReset(S.K_AARENA);
  eq('ARESET', [k.rd16(S.K_AARENA), k.rd16(S.K_AARENA + 6), k.mem[0xC003], k.rd16(S.K_FOCUS), k.rd16(S.K_CAPTURE), k.rd16(S.K_ROOT)], [0xC000, 0, 0, 0, 0xE000, 0]);

  // tree
  k = fresh();
  const mk = (name) => { const x = k.newObj(P(name)).addr; return x; };
  const a = mk('View'), b = mk('TLog'), c = mk('TLog2'), d = mk('View');
  k.addChild(a, b); k.addChild(a, c); k.addChild(c, d);
  eq('children', [k.children(a), k.children(c), k.parentOf(d)], [[b, c], [d], c]);
  eq('depth', [k.pathLen(d), k.height(a)], [3, 3]);
  k.wr16(S.K_FOCUS, c); k.wr16(S.K_CAPTURE, d); k.wr16(S.K_ROOT, a);
  k.wr8(b + TAG, 0x5A);
  k.unlink(b); eq('unlink first', [k.children(a), k.parentOf(b), k.nextOf(b)], [[c], 0, 0]);
  k.addChild(a, b); eq('addchild last', k.children(a), [c, b]);
  k.unlink(a); eq('unlink root noop', k.children(a), [c, b]);
  k.setRoot(a); eq('setroot', [k.rd16(S.K_ROOT), k.rd16(S.K_FOCUS), k.rd16(S.K_CAPTURE)], [a, 0, 0]);
  k.wr16(S.K_FOCUS, d); k.wr16(S.K_CAPTURE, c);
  const lg0 = k.rd16(S.T_LOGN);
  const res = k.send(a, MSG.DESTROY, 0x1234, 0x5678);
  eq('destroy View: carry open', res, { label: 'view_destroy', carry: null });
  eq('log count: c (TLog2) then b (TLog), d is a View', k.rd16(S.T_LOGN) - lg0, 2);
  const rec0 = S.T_LOG + 8 * (lg0 & 255);
  eq('log order (pre-order, front to back)', [k.mem[rec0], k.mem[rec0 + 1] | (k.mem[rec0 + 2] << 8), k.mem[rec0 + 7]], [0, c, 0]);
  const rec1 = rec0 + 8;
  eq('log 2', [k.mem[rec1], k.mem[rec1 + 1] | (k.mem[rec1 + 2] << 8), k.mem[rec1 + 7]], [0, b, 0x5A]);
  eq('wild', k.takeWild().length, 2);
  eq('pointers cleared', [k.rd16(S.K_FOCUS), k.rd16(S.K_CAPTURE), k.rd16(S.K_ROOT)], [0, 0, 0]);
  // everything freed: a (View, pool 8) head is the last freed = a; d freed before c? order: c's children first (d), then c, then b, then a
  eq('free order (pool 8: d then a)', [k.rd16(S.K_AARENA + 8), k.rd16(a)], [a, d]);
  eq('pool 10: c freed before b', [k.rd16(S.K_AARENA + 10), k.rd16(b)], [b, c]);

  // hittest
  k = fresh(); const v = k.newObj(P('View')).addr;
  k.wr16(v + 8, 100); k.wr8(v + 10, 20); k.wr16(v + 11, 50); k.wr8(v + 13, 10);
  const H = (x, y) => k.hit(v, x, y);
  eq('hit edges x', [H(99, 20), H(100, 20), H(149, 20), H(150, 20)], [0, 1, 1, 0]);
  eq('hit edges y', [H(100, 19), H(100, 20), H(100, 29), H(100, 30)], [0, 1, 1, 0]);
  eq('D > 0', [H(100, 256 + 20), H(100, 0xFF00 + 20)], [0, 0]);
  eq('x near 65535', [H(65535, 20), H(65535 - 100, 20)], [0, 0]);
  k.wr16(v + 11, 0); eq('w = 0', H(100, 20), 0);
  k.wr16(v + 8, 0); k.wr16(v + 11, 512); eq('x wraps below View_x = 0', [H(65535, 20), H(511, 20), H(512, 20)], [0, 1, 0]);

  // random sequences: invariants (live blocks never overlap, every byte in [top, end) is 0, returned blocks inside the arena)
  let seed = 12345; const rnd = (m) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % m; };
  k = fresh();
  const live = new Map(), raws = new Map();               // addr -> end (instances / raw blocks)
  const names = ['View', 'TLog', 'TLog2', 'Object', ...cls.list.filter((x) => x.name.startsWith('TSz')).map((x) => x.name)];
  let bad = 0;
  for (let i = 0; i < 20000; i++) {
    const op = rnd(100);
    if (op < 55) {
      const c = cls.byName[names[rnd(names.length)]], r2 = k.newObj(P(c.name));
      if (!r2.carry) {
        const e = r2.addr + c.size;
        for (const [a0, e0] of [...live, ...raws]) if (r2.addr < e0 && a0 < e) bad++;
        live.set(r2.addr, e);
        const rc = k.rec(k.cur); if (r2.addr < rc.base || e > rc.end) bad++;
      }
    } else if (op < 85 && live.size) {
      const keys = [...live.keys()], a0 = keys[rnd(keys.length)];
      const c = k.classOf(a0); k.free(a0); live.delete(a0);
      if (c.pool === 14) live.set(a0, a0 + c.size); else live.delete(a0);   // a pool 14 block is never reused until reset: keep it live
    } else if (op < 92) { const nb = [0, 1, 7, 100, 255, 4000, 65535][rnd(7)], r2 = k.alloc(nb); if (!r2.carry && nb) raws.set(r2.addr, r2.addr + nb); }
    else if (op < 96) k.arena(rnd(2) ? S.K_AARENA : S.K_KARENA);
    else if (op < 97) { k.aReset(rnd(2) ? S.K_AARENA : S.K_KARENA); live.clear(); raws.clear(); }
    for (const rr of [S.K_AARENA, S.K_KARENA]) { const rc = k.rec(rr); if (rc.top < rc.base || rc.top > rc.end) bad++; if (rnd(50) === 0) { for (let x = rc.top; x < rc.end; x++) if (k.mem[x]) { bad++; break; } } }
  }
  eq('random sequence invariants', bad, 0);
  console.log(`kern-model self-test: ${n - fails} passed, ${fails} failed`);
  if (fails) process.exitCode = 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--self-test')) selfTest();
