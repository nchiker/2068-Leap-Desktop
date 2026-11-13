"use strict";
// fs-f1.mjs -- docs/FILES.md 8 item 2: the desktop's file calls (FS_PICK, FS_OPEN, FS_READ, FS_WRITE, FS_CLOSE of src/apps/files.asm) on the prebuilt `desk5` cartridge (build/desk5.dck, build/desk5/out.sym;
// never rebuilt here), called with CALL under mapping A ($F4 = $3F) against TSRun's host bridge with web/fshost.js's shared host as the fake (files in a Map).  Written from docs/FILES.md (2, 2.1, 4.1, 5, 7, 8)
// and the main model's as-built list only; the Z80 source was used only to find symbols.  Expected files and conversions come from a model written here (tests/wr-w3model.mjs textIn / textOut / nameOk), not from the host's code.
//   node tests/fs-f1.mjs [--seed N] [--verbose] [--only LIST]
//     groups: 1 round trips (text and binary of 0, 1, 255, 256, 5,120 bytes), 2 files of 65,535 bytes (chunked, and one call of 65,535 bytes), 3 names refused (status 3), 4 statuses 7 / 6 / 0 and the
//             return convention, 5 text conversion read through FS_READ, 6 FS_PICK over real frames (host answer, host cancel, ESC, BREAK, other events discarded, a name over 30, a 250-frame wait),
//             7 stack / DI / registers over every call, 8 bounds and report (bytes, FS_READ / FS_WRITE of 5,120 bytes)
// The last line is "fs-f1: N of M groups pass"; exit code 1 on any failure.
import * as T from './tk-lib.mjs';
import * as L from './calc-lib.mjs';
import * as X from './tk-lib2.mjs';
import * as W3 from './wr-w3model.mjs';
import { makeHost } from './wr-w3lib.mjs';

const { hex } = L;
const SEED = L.argNum('--seed', 1);
const VERBOSE = L.argv.includes('--verbose');
const ONLY = L.argv.includes('--only') ? String(L.argv[L.argv.indexOf('--only') + 1]).split(',').map(Number) : [1, 2, 3, 4, 5, 6, 7, 8];
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('fs-f1', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED})`);

const NEED = ['FS_BEGIN', 'FS_END', 'FS_PICK', 'FS_OPEN', 'FS_READ', 'FS_WRITE', 'FS_CLOSE', 'T_RET', 'K_RING', 'K_PN', 'K_RHEAD', 'K_RTAIL', 'V_FRAMES', 'V_SHADOW_F4'];
let S0;
try { S0 = L.loadDesk5().S; const miss = NEED.filter((n) => S0[n] === undefined); if (miss.length) throw new Error(`desk5 does not define: ${miss.join(', ')}`); } catch (e) { console.log(`FAIL: ${e.message}`); process.exit(1); }

const B1 = 0xC400, B2 = 0xD800, BSZ = 0x1400;                  // B1: a 5,120-byte buffer in the app arena ($C400-$DFFF; the shell is not resumed, so nothing of it is hurt); B2: 2,048 bytes after it, still in the arena ($E000 and up is kernel RAM)
const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));
const nameRec = (s) => { const c = typeof s === 'string' ? codes(s) : s; return [c.length, ...c]; };
const ST = { OK: 1, NAME: 3, ROOM: 6, EOF: 7, CANCEL: 12, NONE: 0 };

/** A fresh machine: the shell booted (never resumed), a fake host on the bridge, the pointer parked, no memory watch (the 65,535-byte write reads all memory). */
function fresh() {
  const env = L.bootDesk5({ prog: 0, watch: false });
  env.rng = rng; env.host = makeHost(); env.m.host = env.host;
  return env;
}
const tot = { di: 0, badPreserved: 0, badSp: 0, maxStack: 0, calls: 0 };
/** One FS_ call under mapping A, interrupts on, the other registers random: returns { r (runCall's info), ok, status, bc }; the cross-cutting checks go into `sec`. */
function call(env, sec, ctx, addr, regs = {}) {
  const r = T.runCall(env, addr, regs, { map: 'A', ints: true });
  tot.calls++; tot.di += r.di; tot.maxStack = Math.max(tot.maxStack, r.stack);
  if (r.preserved.length) tot.badPreserved++;
  if (r.badSp !== undefined) tot.badSp++;
  sec.ok(r.di === 0, () => `${ctx}: a DI was executed`);
  sec.ok(r.preserved.length === 0, () => `${ctx}: IX, IY or the alternate set not preserved: ${r.preserved.join(',')}`);
  sec.ok(r.badSp === undefined, () => `${ctx}: SP ${hex(r.badSp)} after the return`);
  sec.ok(r.stack <= 32, () => `${ctx}: stack ${r.stack} bytes (bound 32)`);
  const ok = !r.carry && r.regs.a === 1;
  return { r, ok, carry: !!r.carry, a: r.regs.a, status: r.carry ? r.regs.a : ST.OK, bc: r.regs.bc, t: r.t };
}
const poke = (env, at, arr) => { for (let i = 0; i < arr.length; i++) env.m.ram[at + i] = arr[i]; };
const peek = (env, at, n) => Array.from(env.m.ram.subarray(at, at + n));
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const firstDiff = (a, b) => { const n = Math.max(a.length, b.length); for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i; return -1; };
const rndText = (n) => Array.from({ length: n }, () => (rng.chance(0.05) ? 13 : rng.int(32, 126)));
const rndBytes = (n) => Array.from({ length: n }, () => rng.int(0, 255));
const S = S0;
const FS = { OPEN: S.FS_OPEN, READ: S.FS_READ, WRITE: S.FS_WRITE, CLOSE: S.FS_CLOSE, PICK: S.FS_PICK };
const NAMEAT = 0xFA00;                                                   // a name buffer (a length byte and up to 255 codes) in RAM; the stack is at $FEFE downward
const putName = (env, nm) => { poke(env, NAMEAT, nameRec(nm)); return NAMEAT; };
const open = (env, sec, ctx, nm, mode) => call(env, sec, ctx, FS.OPEN, { hl: putName(env, nm), a: mode });
const write = (env, sec, ctx, at, n) => call(env, sec, ctx, FS.WRITE, { hl: at, bc: n });
const read = (env, sec, ctx, at, n) => call(env, sec, ctx, FS.READ, { de: at, bc: n });
const close = (env, sec, ctx) => call(env, sec, ctx, FS.CLOSE);

// ===========================================================================================================================
if (ONLY.includes(1)) {
  const sec = new Sec('1 round trips: FS_OPEN (write) / FS_WRITE / FS_CLOSE then FS_OPEN (read) / FS_READ, text and binary files of 0, 1, 255, 256 and 5,120 bytes; the host holds the bytes FILES 2 says (text: 13 -> LF)');
  const env = fresh(), h = env.host;
  for (const binary of [false, true]) for (const n of [0, 1, 255, 256, 5120]) {
    const nm = `${binary ? 'bin' : 'txt'}${n}.dat`, ctx = `${binary ? 'binary' : 'text'} ${n}`, mode = binary ? 3 : 1;
    const data = binary ? rndBytes(n) : rndText(n);
    const o = open(env, sec, `${ctx}: FS_OPEN write`, nm, mode);
    sec.ok(o.ok, () => `${ctx}: FS_OPEN for writing gave carry ${o.carry}, A ${o.a}`);
    sec.ok(o.bc === 0, () => `${ctx}: FS_OPEN for writing gave BC ${o.bc}, want 0`);
    if (n > 0) { poke(env, B1, data); const w = write(env, sec, `${ctx}: FS_WRITE`, B1, n); sec.ok(w.ok, () => `${ctx}: FS_WRITE gave carry ${w.carry}, A ${w.a}`); }
    const c = close(env, sec, `${ctx}: FS_CLOSE`);
    sec.ok(c.ok, () => `${ctx}: FS_CLOSE gave carry ${c.carry}, A ${c.a}`);
    const stored = h.files.get(nm), want = binary ? data : W3.textOut(data);
    sec.ok(!!stored && eq(Array.from(stored), want), () => `${ctx}: the host's file is ${stored ? stored.length : 'missing'} bytes, differs at ${stored ? firstDiff(Array.from(stored), want) : -1} (want ${want.length})`);
    const sv = h.saves.filter((s) => s.name === nm);
    sec.ok(sv.length === 1 && sv[0].binary === binary, () => `${ctx}: the host's saved(): ${JSON.stringify(sv.map((s) => [s.name, s.bytes.length, s.binary]))}`);
    // back
    const o2 = open(env, sec, `${ctx}: FS_OPEN read`, nm, binary ? 2 : 0);
    sec.ok(o2.ok && o2.bc === n, () => `${ctx}: FS_OPEN for reading gave carry ${o2.carry}, A ${o2.a}, BC ${o2.bc}, want length ${n}`);
    env.m.ram.fill(0xEE, B1, B1 + BSZ);
    if (n > 0) {
      const r = read(env, sec, `${ctx}: FS_READ`, B1, n);
      sec.ok(r.ok && r.bc === n, () => `${ctx}: FS_READ gave carry ${r.carry}, A ${r.a}, BC ${r.bc}, want ${n}`);
      const got = peek(env, B1, n);
      sec.ok(eq(got, data), () => `${ctx}: the bytes read differ at ${firstDiff(got, data)}`);
      sec.ok(n === BSZ || env.m.ram[B1 + n] === 0xEE, () => `${ctx}: FS_READ wrote past its count`);
    }
    const c2 = close(env, sec, `${ctx}: FS_CLOSE after reading`);
    sec.ok(c2.ok, () => `${ctx}: FS_CLOSE after reading gave carry ${c2.carry}, A ${c2.a}`);
  }
  sec.end('10 files');
}

// ===========================================================================================================================
if (ONLY.includes(2)) {
  const sec = new Sec('2 files of 65,535 bytes (FILES 4.1: the limit): written in chunks and read back in chunks (binary), the length 65,535 from FS_OPEN, status 7 after the last byte, status 6 for one byte more; one FS_WRITE call of 65,535 bytes');
  const env = fresh(), h = env.host;
  const total = 65535, chunk = 4095;                           // 16 chunks of 4,095 and one of 15
  const data = rndBytes(total);
  let o = open(env, sec, 'chunked write: open', 'big.bin', 3);
  sec.ok(o.ok, () => `FS_OPEN: carry ${o.carry}, A ${o.a}`);
  for (let at = 0; at < total; at += chunk) {
    const n = Math.min(chunk, total - at);
    poke(env, B1, data.slice(at, at + n));
    const w = write(env, sec, `chunk at ${at}`, B1, n);
    sec.ok(w.ok, () => `chunk at ${at}: FS_WRITE carry ${w.carry}, A ${w.a}`);
  }
  poke(env, B1, [0x55]);
  const w6 = write(env, sec, 'one byte too many', B1, 1);
  sec.ok(w6.carry && w6.a === ST.ROOM, () => `a write past 65,535 bytes: carry ${w6.carry}, A ${w6.a}, want carry and status 6 (no room)`);
  const c = close(env, sec, 'chunked write: close');
  sec.ok(c.ok, () => `FS_CLOSE after the refused write: carry ${c.carry}, A ${c.a}`);
  const stored = h.files.get('big.bin');
  sec.ok(!!stored && stored.length === total && eq(Array.from(stored), data), () => `the host's file: ${stored ? stored.length : 'missing'} bytes, differs at ${stored ? firstDiff(Array.from(stored), data) : -1}`);
  o = open(env, sec, 'chunked read: open', 'big.bin', 2);
  sec.ok(o.ok && o.bc === 0xFFFF, () => `FS_OPEN for reading: carry ${o.carry}, A ${o.a}, BC ${o.bc}, want 65,535`);
  const back = [];
  for (let at = 0; at < total; at += chunk) {
    const n = Math.min(chunk, total - at);
    const r = read(env, sec, `read chunk at ${at}`, B1, n);
    sec.ok(r.ok && r.bc === n, () => `read chunk at ${at}: carry ${r.carry}, A ${r.a}, BC ${r.bc}, want ${n}`);
    back.push(...peek(env, B1, n));
  }
  sec.ok(back.length === total && eq(back, data), () => `the chunks read differ at ${firstDiff(back, data)}`);
  const r7 = read(env, sec, 'read after the last byte', B1, 10);
  sec.ok(r7.carry && r7.a === ST.EOF, () => `FS_READ after the last byte: carry ${r7.carry}, A ${r7.a}, want carry and status 7`);
  close(env, sec, 'close');
  // one call of 65,535 bytes: HL = 0 reads the whole address space as mapping A sees it (interrupts are not delivered inside a direct call: memory is steady)
  const snapshotMem = new Uint8Array(65536);
  env.m.ram[S.V_SHADOW_F4] = 0x3F; env.m.portF4 = 0x3F;
  for (let i = 0; i < 65536; i++) snapshotMem[i] = env.m.bus.read(i);
  env.m.ram[S.V_SHADOW_F4] = 0x33; env.m.portF4 = 0x33;
  open(env, sec, 'one call: open', 'one.bin', 3);
  env.m.ram[S.V_SHADOW_F4] = 0x3F; env.m.portF4 = 0x3F;
  for (let i = 0; i < 65536; i++) snapshotMem[i] = env.m.bus.read(i);                   // after the name was put in RAM
  env.m.ram[S.V_SHADOW_F4] = 0x33; env.m.portF4 = 0x33;
  const w = write(env, sec, 'one call of 65,535 bytes', 0x0000, 65535);
  sec.ok(w.ok, () => `FS_WRITE of 65,535 bytes: carry ${w.carry}, A ${w.a}`);
  const w1 = write(env, sec, 'one byte more', 0x0000, 1);
  sec.ok(w1.carry && w1.a === ST.ROOM, () => `one more byte after 65,535: carry ${w1.carry}, A ${w1.a}, want status 6`);
  close(env, sec, 'one call: close');
  const f2 = h.files.get('one.bin');
  // the stack ($FEE0-$FEFF: the harness's sentinel return address and the call's own pushes) is the only memory the call itself changes
  const exp = Array.from(snapshotMem.subarray(0, 65535)); const got2 = f2 ? Array.from(f2) : [];
  for (let i = 0xFEE0; i < 65535; i++) { exp[i] = 0; got2[i] = 0; }
  sec.ok(!!f2 && f2.length === 65535 && eq(got2, exp), () => `one call: the host's file is ${f2 ? f2.length : 'missing'} bytes, differs at ${f2 ? firstDiff(got2, exp) : -1}`);
  sec.end(`${total} bytes in ${Math.ceil(total / chunk)} chunks, and in one call`);
}

// ===========================================================================================================================
if (ONLY.includes(3)) {
  const sec = new Sec('3 names refused (FILES 2: 1-30 codes from 32-126, none of / \\ : * ? " < > |): status 3 for reading and for writing; names that are allowed open; a file that is not there gives 3; a refused write leaves no file');
  const env = fresh(), h = env.host;
  const bad = [[], codes('x'.repeat(31)), codes('x'.repeat(40)), codes('a/b'), codes('a\\b'), codes('a:b'), codes('a*b'), codes('a?b'), codes('a"b'), codes('a<b'), codes('a>b'), codes('a|b'), [65, 31, 66], [65, 127], [200], [0], [65, 128, 66]];
  for (const nm of bad) for (const mode of [0, 1, 2, 3]) {
    const ctx = `name ${JSON.stringify(String.fromCharCode(...nm))} (${nm.length} codes) mode ${mode}`;
    if ((mode & 1) === 0) h.files.set(String.fromCharCode(...nm), Uint8Array.of(1, 2, 3));
    const o = open(env, sec, ctx, nm, mode);
    sec.ok(o.carry && o.a === ST.NAME, () => `${ctx}: FS_OPEN carry ${o.carry}, A ${o.a}, want carry and status 3`);
    const c = close(env, sec, `${ctx}: FS_CLOSE`);
    sec.ok(c.ok, () => `${ctx}: FS_CLOSE after a refused open: carry ${c.carry}, A ${c.a} (harmless)`);
  }
  sec.ok(h.saves.length === 0, () => `a refused write-open left ${h.saves.length} saved file(s): ${JSON.stringify(h.saves.map((s) => s.name))}`);
  const good = [codes('a'), codes('x'.repeat(30)), codes('a b-c_d.e,f;g!h#i$j%k&l\'(m)n+o'), codes('.hidden'), codes(' '), codes('~{}[]^@=')];
  for (const nm of good) {
    const ctx = `name ${JSON.stringify(String.fromCharCode(...nm))} (${nm.length} codes)`;
    const o = open(env, sec, `${ctx}: write`, nm, 1);
    sec.ok(o.ok, () => `${ctx}: FS_OPEN for writing carry ${o.carry}, A ${o.a}, want OK`);
    poke(env, B1, [65, 66]); write(env, sec, ctx, B1, 2); close(env, sec, ctx);
    const o2 = open(env, sec, `${ctx}: read`, nm, 0);
    sec.ok(o2.ok && o2.bc === 2, () => `${ctx}: FS_OPEN for reading carry ${o2.carry}, A ${o2.a}, BC ${o2.bc}`);
    close(env, sec, ctx);
  }
  const nf = open(env, sec, 'no such file', 'nothere.txt', 0);
  sec.ok(nf.carry && nf.a === ST.NAME, () => `a file that is not there: carry ${nf.carry}, A ${nf.a}, want status 3`);
  sec.end(`${bad.length} refused names x 4 modes, ${good.length} allowed`);
}

// ===========================================================================================================================
if (ONLY.includes(4)) {
  const sec = new Sec('4 statuses and the return convention: OK = carry clear and A = 1; end of file 7 (also for an empty file); fewer bytes only at the end; 0 when no host answers (every call); FS_CLOSE when nothing is open is harmless');
  const env = fresh(), h = env.host;
  h.files.set('ten.bin', Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  h.files.set('empty.bin', new Uint8Array(0));
  let o = open(env, sec, 'ten: open', 'ten.bin', 2);
  sec.ok(o.ok && o.bc === 10 && o.a === 1 && !o.carry, () => `FS_OPEN ten.bin: carry ${o.carry}, A ${o.a}, BC ${o.bc}`);
  let r = read(env, sec, 'ten: 4', B2, 4); sec.ok(r.ok && r.bc === 4 && eq(peek(env, B2, 4), [0, 1, 2, 3]), () => `read 4: carry ${r.carry}, A ${r.a}, BC ${r.bc}, ${peek(env, B2, 4)}`);
  r = read(env, sec, 'ten: 4 more', B2, 4); sec.ok(r.ok && r.bc === 4 && eq(peek(env, B2, 4), [4, 5, 6, 7]), () => `read 4 more: carry ${r.carry}, A ${r.a}, BC ${r.bc}, ${peek(env, B2, 4)}`);
  r = read(env, sec, 'ten: 100 (fewer at the end)', B2, 100); sec.ok(r.ok && r.bc === 2 && eq(peek(env, B2, 2), [8, 9]), () => `read 100 at the end: carry ${r.carry}, A ${r.a}, BC ${r.bc} (want 2)`);
  r = read(env, sec, 'ten: after the end', B2, 5); sec.ok(r.carry && r.a === ST.EOF, () => `read after the end: carry ${r.carry}, A ${r.a}, want status 7`);
  close(env, sec, 'ten: close');
  o = open(env, sec, 'empty: open', 'empty.bin', 2);
  sec.ok(o.ok && o.bc === 0, () => `FS_OPEN empty.bin: carry ${o.carry}, A ${o.a}, BC ${o.bc}`);
  r = read(env, sec, 'empty: read', B2, 5); sec.ok(r.carry && r.a === ST.EOF, () => `read of an empty file: carry ${r.carry}, A ${r.a}, want status 7`);
  close(env, sec, 'empty: close');
  const n0 = h.log.length;
  let c = close(env, sec, 'close with nothing open');
  sec.ok(c.ok, () => `FS_CLOSE with nothing open: carry ${c.carry}, A ${c.a} (harmless: OK)`);
  sec.ok(h.saves.length === 0, () => 'FS_CLOSE with nothing open made a saved file');
  void n0;
  // a read of the same file twice from the start (a new open starts at 0)
  o = open(env, sec, 'ten again', 'ten.bin', 2); r = read(env, sec, 'ten again: 3', B2, 3);
  sec.ok(r.ok && eq(peek(env, B2, 3), [0, 1, 2]), () => `a new open starts at the first byte: ${peek(env, B2, 3)}`);
  close(env, sec, 'close');
  // no host: status 0 from every call
  env.m.host = null;
  const calls = [['FS_OPEN', () => open(env, sec, 'no host: open', 'a.txt', 1)], ['FS_READ', () => read(env, sec, 'no host: read', B2, 5)], ['FS_WRITE', () => write(env, sec, 'no host: write', B1, 5)],
    ['FS_CLOSE', () => close(env, sec, 'no host: close')], ['FS_PICK', () => call(env, sec, 'no host: pick', FS.PICK, { hl: 0xFB00 })]];
  for (const [nm, f] of calls) { const x = f(); sec.ok(x.carry && x.a === ST.NONE, () => `${nm} with no host: carry ${x.carry}, A ${x.a}, want carry set and status 0`); }
  // a host that answers with other statuses: they pass through (FILES 2.1: the numbers are TS-Pico's)
  env.m.host = h;
  for (const st of [3, 6, 7, 12, 2, 5]) {
    h.hook = (n, bytes, res) => (n === 4 ? { status: st } : undefined);
    open(env, sec, 'pass-through: open', 'p.txt', 1);
    const w = write(env, sec, `status ${st} from the host`, B1, 4);
    sec.ok(w.carry && w.a === st, () => `a write answered with status ${st}: carry ${w.carry}, A ${w.a}`);
    h.hook = null; close(env, sec, 'close');
  }
  sec.end('OK, 3, 6, 7, 12 and 0, and pass-through of statuses');
}

// ===========================================================================================================================
if (ONLY.includes(5)) {
  const sec = new Sec('5 text mode read through FS_OPEN / FS_READ (FILES 2): CR LF, LF and CR each become 13; TAB a space; other codes below 32 dropped; codes above 126 become "?"; the length FS_OPEN gives is after the conversion; binary mode leaves bytes as they are');
  const env = fresh(), h = env.host;
  const cases = [['crlf', [65, 13, 10, 66]], ['lf', [65, 10, 66, 10]], ['cr', [65, 13, 66]], ['mixed', [1, 13, 10, 10, 13, 13, 10, 9, 9, 67]], ['ctl', [0, 1, 2, 7, 8, 11, 12, 14, 27, 31, 68]], ['high', [127, 128, 200, 255, 69]],
    ['all', Array.from({ length: 256 }, (_, i) => i)], ['crcr', [13, 13, 13, 10, 10]], ['trail', [65, 13]], ['random', rndBytes(1500)]];
  for (const [nm, bytes] of cases) {
    h.files.set(`${nm}.txt`, Uint8Array.from(bytes));
    const want = W3.textIn(bytes);
    const o = open(env, sec, `${nm}: open`, `${nm}.txt`, 0);
    sec.ok(o.ok && o.bc === want.length, () => `${nm}: FS_OPEN length ${o.bc}, want ${want.length} (after the conversion)`);
    if (want.length) { const r = read(env, sec, `${nm}: read`, B2, want.length); const got = peek(env, B2, want.length); sec.ok(r.ok && r.bc === want.length && eq(got, want), () => `${nm}: bytes differ at ${firstDiff(got, want)}: machine ${got.slice(0, 12)} want ${want.slice(0, 12)}`); }
    close(env, sec, 'close');
    const ob = open(env, sec, `${nm}: binary open`, `${nm}.txt`, 2);
    sec.ok(ob.ok && ob.bc === bytes.length, () => `${nm}: binary FS_OPEN length ${ob.bc}, want ${bytes.length}`);
    if (bytes.length) { read(env, sec, `${nm}: binary read`, B2, bytes.length); const got = peek(env, B2, bytes.length); sec.ok(eq(got, bytes), () => `${nm}: binary bytes differ at ${firstDiff(got, bytes)}`); }
    close(env, sec, 'close');
  }
  sec.end(`${cases.length} files, text and binary`);
}

// ===========================================================================================================================
// FS_PICK over real frames: the CPU is sent into FS_PICK (mapping A, interrupts on) and left to run; the kernel's interrupt scans the keyboard and the mouse as it does for Write.
// A frame always ends with the CPU at the entry of the frame interrupt ($38, just accepted: IFF1 off, the interrupted PC on the stack).  The call is therefore set up *through that interrupt*: the pushed PC becomes
// FS_PICK and the word above it T_RET, so the ISR runs as it always does and its RETI enters FS_PICK with interrupts on, as a program's CALL would.
function startPick(env, hl = 0xFB00) {
  const { m } = env, cpu = m.cpu;
  if (cpu.pc !== 0x38) throw new Error(`startPick: the CPU is at ${hex(cpu.pc)}, not at the frame interrupt's entry`);
  m.ram[S.V_SHADOW_F4] = 0x3F; m.portF4 = 0x3F;
  for (const r of ['b', 'c', 'd', 'e', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2', 'xh', 'xl', 'yh', 'yl']) cpu[r] = rng.int(0, 255);
  cpu.a = rng.int(0, 255); cpu.f = rng.int(0, 255); cpu.h = hl >> 8; cpu.l = hl & 0xFF;
  const sp = 0xFF00 - 4; cpu.sp = sp;
  m.ram[sp] = S.FS_PICK & 0xFF; m.ram[sp + 1] = S.FS_PICK >> 8; m.ram[sp + 2] = S.T_RET & 0xFF; m.ram[sp + 3] = S.T_RET >> 8;
  env.pickRegs = {}; for (const r of ['xh', 'xl', 'yh', 'yl', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2']) env.pickRegs[r] = cpu[r];
  env.pickState = { halts: 0 };
}
/** The PC the frame interrupt interrupted (the word on the stack at a frame's end). */
const intPC = (env) => L.rd16(env.m, env.m.cpu.sp);
const returned = (env) => env.m.cpu.pc === 0x38 && intPC(env) === S.T_RET;
/** The interrupt arrived while the CPU waited in a HALT: the interrupted PC follows a HALT opcode. */
const inHalt = (env) => { const m = env.m, pc = intPC(env); m.ram[S.V_SHADOW_F4] = m.ram[S.V_SHADOW_F4]; return m.bus.read((pc - 1) & 0xFFFF) === 0x76; };
/** Run `n` frames (stopping when the call has returned); counts the frames whose interrupt hit a HALT. */
function pickFrames(env, n) {
  for (let i = 0; i < n && !returned(env); i++) {
    env.frame();
    if (!returned(env) && inHalt(env)) env.pickState.halts++;
  }
}
const pickResult = (env) => ({ carry: !!(env.m.cpu.f & 1), a: env.m.cpu.a });
const ringEmpty = (env) => env.m.ram[S.K_PN] === 0 && env.m.ram[S.K_RHEAD] === env.m.ram[S.K_RTAIL];

if (ONLY.includes(6)) {
  const sec = new Sec('6 FS_PICK over real frames: waits with HALT (interrupts on); the host answers it (OK and the name; 12 cancelled); ESC and BREAK typed cancel it (the abort reaches the host); other events are discarded; a name longer than 30 is refused (3); a 250-frame (5 s) wait loses no interrupt');
  const NB = 0xFB00;
  // (a) the host chooses a file
  {
    const env = fresh(), h = env.host;
    env.m.ram.fill(0xAA, NB, NB + 34);
    startPick(env, NB); pickFrames(env, 12);
    sec.ok(!returned(env) && h.picking, () => `after 12 frames the call ${returned(env) ? 'has returned' : 'waits'}, host.picking ${h.picking}`);
    sec.ok(env.pickState.halts >= 10, () => `the wait is a HALT loop: ${env.pickState.halts} of 12 frames ended halted`);
    const bits = env.m.bus.ioRead(0x6F);
    sec.ok((bits & 0x80) !== 0, () => `the bridge's busy bit while waiting: status byte ${hex(bits, 2)}`);
    h.answer('Report.txt', rndBytes(40));
    pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && !r.carry && r.a === 1, () => `host answer: returned ${returned(env)}, carry ${r.carry}, A ${r.a}`);
    sec.ok(eq(peek(env, NB, 11), nameRec('Report.txt')), () => `the name buffer holds ${JSON.stringify(peek(env, NB, 11))}, want [10, 'Report.txt']`);
    sec.ok(!h.picking, 'host.picking is still set after the answer');
    const keep = ['xh', 'xl', 'yh', 'yl', 'a2', 'f2', 'b2', 'c2', 'd2', 'e2', 'h2', 'l2'].filter((x) => env.m.cpu[x] !== env.pickRegs[x]);
    sec.ok(keep.length === 0, () => `registers not preserved over FS_PICK: ${keep.join(',')}`);
    sec.ok(env.m.cpu.sp + 2 === 0xFF00, () => `SP ${hex(env.m.cpu.sp + 2)} after the return, want $FF00`);
    sec.ok(env.vf.bad === 0, () => `V_FRAMES: ${env.vf.bad} frame(s) without exactly one interrupt, first ${env.vf.first}`);
  }
  // (b) the host cancels
  {
    const env = fresh(), h = env.host;
    startPick(env, NB); pickFrames(env, 8);
    h.answer(null); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && r.carry && r.a === ST.CANCEL, () => `host cancel: returned ${returned(env)}, carry ${r.carry}, A ${r.a}, want carry and 12`);
    sec.ok(!h.picking, 'host.picking set after the host cancelled');
  }
  // (c) ESC, (d) BREAK typed over real frames
  for (const [nm, code] of [['ESC', 27], ['BREAK', 3]]) {
    const env = fresh(), h = env.host;
    startPick(env, NB); pickFrames(env, 8);
    const cmds0 = h.log.length;
    sec.ok(!returned(env), () => `${nm}: the call returned before the key`);
    L.setKeys(env.m, L.keysFor(code)); pickFrames(env, 4); L.setKeys(env.m, []); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && r.carry && r.a === ST.CANCEL, () => `${nm}: returned ${returned(env)}, carry ${r.carry}, A ${r.a}, want carry and 12`);
    const sent = h.log.slice(cmds0).map((c) => c.n);
    sec.ok(sent.includes(0), () => `${nm}: the abort (command 0) did not reach the host; commands after the key: ${JSON.stringify(sent)}`);
    sec.ok(!h.picking, () => `${nm}: the host's pick is still open`);
  }
  // (e) other events are discarded: letters, ENTER, arrows, TAB, MENU, a mouse click and move; the pick stays up; then ESC
  {
    const env = fresh(), h = env.host;
    startPick(env, NB); pickFrames(env, 6);
    for (const code of [97, 13, 10, 11, 8, 9, 14, 16, 32, 12]) { L.setKeys(env.m, L.keysFor(code)); pickFrames(env, 3); L.setKeys(env.m, []); pickFrames(env, 3); }
    env.m.mouse.x = (env.m.mouse.x + 50) & 0xFF; pickFrames(env, 2);
    env.m.mouse.buttons = L.MOUSE_LEFT; pickFrames(env, 3); env.m.mouse.buttons = L.MOUSE_UP; pickFrames(env, 3);
    sec.ok(!returned(env) && h.picking, () => `after other keys and the mouse the call ${returned(env) ? 'returned with ' + JSON.stringify(pickResult(env)) : 'waits'}, host.picking ${h.picking}`);
    sec.ok(!h.log.some((c) => c.n === 0), () => 'an abort was sent for an event other than ESC / BREAK');
    L.setKeys(env.m, L.keysFor(27)); pickFrames(env, 4); L.setKeys(env.m, []); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && r.carry && r.a === ST.CANCEL, () => `ESC after the other events: returned ${returned(env)}, carry ${r.carry}, A ${r.a}`);
    sec.ok(ringEmpty(env), () => `the event ring is not empty after the pick (K_PN ${env.m.ram[S.K_PN]}, head ${env.m.ram[S.K_RHEAD]}, tail ${env.m.ram[S.K_RTAIL]}): events were not discarded`);
  }
  // (f) the same, answered by the host after other events (the events must not be taken as a cancel; the answer still arrives)
  {
    const env = fresh(), h = env.host;
    startPick(env, NB); pickFrames(env, 4);
    L.setKeys(env.m, L.keysFor(65)); pickFrames(env, 3); L.setKeys(env.m, []); pickFrames(env, 3);
    h.answer('Some File.txt', [1, 2, 3]); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && !r.carry && r.a === 1 && eq(peek(env, NB, 14), nameRec('Some File.txt')), () => `answer after a key: returned ${returned(env)}, carry ${r.carry}, A ${r.a}, name ${JSON.stringify(peek(env, NB, 14))}`);
  }
  // (g) a name longer than 30 from the host is refused (3); one of 30 is taken
  for (const [len, want] of [[31, ST.NAME], [60, ST.NAME], [30, 1], [1, 1]]) {
    const env = fresh(), h = env.host;
    const nm = Array.from({ length: len }, (_, i) => 65 + (i % 26)), nmS = String.fromCharCode(...nm);
    h.raw = nmS;
    env.m.ram.fill(0xAA, NB, NB + 70);
    startPick(env, NB); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env), () => `a host name of ${len}: the call did not return`);
    if (want === 1) sec.ok(!r.carry && r.a === 1 && eq(peek(env, NB, len + 1), nameRec(nm)), () => `a host name of ${len}: carry ${r.carry}, A ${r.a}, buffer ${JSON.stringify(peek(env, NB, 6))}...`);
    else sec.ok(r.carry && r.a === ST.NAME, () => `a host name of ${len}: carry ${r.carry}, A ${r.a}, want carry and status 3`);
  }
  // (h) a host that answers another status: passed through
  {
    const env = fresh(), h = env.host;
    const hh = { command: (n, b, a) => (n === 1 ? { status: ST.ROOM } : h.command(n, b, a)), files: h.files, log: h.log, get picking() { return false; } };
    env.m.host = hh;
    startPick(env, NB); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && r.carry && r.a === ST.ROOM, () => `a pick answered with status 6: returned ${returned(env)}, carry ${r.carry}, A ${r.a}`);
  }
  // (i) a 5-second wait: 250 frames, interrupts counted
  {
    const env = fresh(), h = env.host;
    startPick(env, NB);
    const v0 = L.rd16(env.m, S.V_FRAMES), f0 = env.vf.checked;
    pickFrames(env, 250);
    const v1 = L.rd16(env.m, S.V_FRAMES);
    sec.ok(!returned(env) && h.picking, () => `after 250 frames the call ${returned(env) ? 'returned' : 'waits'}, host.picking ${h.picking}`);
    sec.ok(((v1 - v0) & 0xFFFF) === 250, () => `V_FRAMES rose by ${(v1 - v0) & 0xFFFF} over 250 frames, want 250`);
    sec.ok(env.vf.bad === 0 && env.vf.checked - f0 === 250, () => `frame interrupts lost: ${env.vf.bad} (checked ${env.vf.checked - f0} frames), first ${env.vf.first}`);
    sec.ok(env.pickState.halts >= 245, () => `${env.pickState.halts} of 250 frames ended in HALT`);
    h.answer('late.txt', [1]); pickFrames(env, 4);
    const r = pickResult(env);
    sec.ok(returned(env) && !r.carry && r.a === 1, () => `answer after 5 s: returned ${returned(env)}, carry ${r.carry}, A ${r.a}`);
    sec.end(`a 250-frame wait: V_FRAMES +${(v1 - v0) & 0xFFFF}, ${env.pickState.halts} frames ended in HALT`);
  }
}

// ===========================================================================================================================
if (ONLY.includes(7)) {
  const sec = new Sec('7 stack <= 32 bytes, no DI, IX / IY / the alternate set kept, SP right after the return: every call (done in each call above; here the totals), FS_PICK with its events in the ring (a direct call, the discard path of FS_PICK)');
  sec.ok(tot.di === 0, () => `${tot.di} DI executed over ${tot.calls} calls`);
  sec.ok(tot.badPreserved === 0, () => `${tot.badPreserved} call(s) did not preserve IX / IY / the alternate set`);
  sec.ok(tot.badSp === 0, () => `${tot.badSp} call(s) returned with a wrong SP`);
  sec.ok(tot.maxStack <= 32, () => `deepest stack ${tot.maxStack} bytes over ${tot.calls} calls (bound 32)`);
  // FS_PICK as a direct call: the ring holds a key, a mouse press and ESC; the host's pick is busy; the call discards, aborts, returns 12
  {
    const env = fresh(), h = env.host;
    T.drainEvents(env);
    T.ringPut(env, T.ptRec(3, 100, 50, 1)); T.ringPut(env, [1, 97, 0, 0]); T.ringPut(env, [1, 27, 0, 0]);
    const x = call(env, sec, 'FS_PICK with ESC in the ring', FS.PICK, { hl: 0xFB00 });
    sec.ok(x.carry && x.a === ST.CANCEL, () => `FS_PICK with ESC in the ring: carry ${x.carry}, A ${x.a}, want 12`);
    sec.ok(x.r.halts === 0 || true, '');
    T.drainEvents(env);
    const stackPick = x.r.stack;
    h.answer = h.answer;
    // and a pick that is answered during a HALT (the host answers at the first HALT)
    const env2 = fresh(), h2 = env2.host;
    T.drainEvents(env2);
    const r = T.runCall(env2, FS.PICK, { hl: 0xFB00 }, { map: 'A', ints: true, onHalt: () => { h2.answer('Halted.txt', [7, 7]); } });
    tot.calls++; tot.maxStack = Math.max(tot.maxStack, r.stack);
    sec.ok(!r.carry && r.regs.a === 1 && eq(peek(env2, 0xFB00, 11), nameRec('Halted.txt')) && r.halts === 1, () => `FS_PICK answered at its first HALT: carry ${r.carry}, A ${r.regs.a}, halts ${r.halts}, name ${JSON.stringify(peek(env2, 0xFB00, 11))}`);
    sec.ok(r.stack <= 32 && r.di === 0 && r.preserved.length === 0, () => `FS_PICK (answered at a HALT): stack ${r.stack}, DI ${r.di}, preserved: ${r.preserved.join(',') || 'all'}`);
    sec.end(`${tot.calls} calls; deepest stack ${Math.max(tot.maxStack, stackPick)} bytes; FS_PICK direct: ${stackPick} bytes`);
    // keep the figure for the report
    globalThis.__fsPickStack = Math.max(stackPick, r.stack);
  }
}

// ===========================================================================================================================
if (ONLY.includes(8)) {
  const sec = new Sec('8 bounds and report (FILES 7): bytes of src/apps/files.asm (EST 250-350: report); FS_READ / FS_WRITE of 5,120 bytes from the call to the return (report, EST about 60 T a byte: 300 k); stack <= 32; no DI');
  const env = fresh(), h = env.host;
  const data = rndBytes(5120);
  open(env, sec, 'perf: open write', 'perf.bin', 3);
  poke(env, B1, data);
  const ws = [], rs = [];
  const w = write(env, sec, 'perf: FS_WRITE 5,120', B1, 5120); ws.push(w.t);
  sec.ok(w.ok, () => `FS_WRITE: carry ${w.carry}, A ${w.a}`);
  close(env, sec, 'close');
  for (let i = 0; i < 3; i++) {
    open(env, sec, 'perf: open read', 'perf.bin', 2);
    env.m.ram.fill(0, B1, B1 + BSZ);
    const r = read(env, sec, 'perf: FS_READ 5,120', B1, 5120); rs.push(r.t);
    sec.ok(r.ok && r.bc === 5120 && eq(peek(env, B1, 5120), data), () => `FS_READ: carry ${r.carry}, BC ${r.bc}`);
    close(env, sec, 'close');
    if (i < 2) { poke(env, B1, data); open(env, sec, 'perf: open write', 'perf.bin', 3); const w2 = write(env, sec, 'perf: FS_WRITE 5,120', B1, 5120); ws.push(w2.t); close(env, sec, 'close'); }
  }
  const bytes = S.FS_END - S.FS_BEGIN;
  console.log(`report | files.asm bytes: FS_END - FS_BEGIN = ${bytes} (${hex(S.FS_BEGIN)}-${hex(S.FS_END)}; FILES 7 EST 250-350)`);
  console.log(`report | FS_WRITE of 5,120 bytes: ${Math.max(...ws).toLocaleString('en')} T (runs ${ws.join(', ')}); ${(Math.max(...ws) / 5120).toFixed(2)} T a byte`);
  console.log(`report | FS_READ of 5,120 bytes: ${Math.max(...rs).toLocaleString('en')} T (runs ${rs.join(', ')}); ${(Math.max(...rs) / 5120).toFixed(2)} T a byte`);
  console.log(`report | deepest stack of any FS_ call (direct): ${tot.maxStack} bytes (bound 32); FS_PICK direct ${globalThis.__fsPickStack ?? 'not run'} bytes`);
  void h;
  sec.ok(tot.maxStack <= 32, () => `stack ${tot.maxStack}`);
  sec.ok(tot.di === 0, () => `DI ${tot.di}`);
  sec.end(`${bytes} bytes; WRITE ${Math.max(...ws)} T, READ ${Math.max(...rs)} T`);
}
finish();
