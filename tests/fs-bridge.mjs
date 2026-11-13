"use strict";
// fs-bridge.mjs -- docs/FILES.md 8.1: TSRun's host bridge (ports $6F command / status, $6D data) driven the way the Z80
// does, with (a) a raw fake host that records what it is given and (b) the shared file host (web/fshost.js) with a files
// map and a test-controlled pick hook. No cartridge: the ports are driven through m.bus.ioWrite / ioRead.
//   node tests/fs-bridge.mjs
import { M, checks } from './lib.mjs';
import { createFileHost, nameOk, textIn } from '../web/fshost.js';

const C = checks('fs-bridge');
const { check } = C;

const newMachine = () => M.createMachine(new Uint8Array(9).fill(0x1F), new Uint8Array(2).fill(0xFF));
const P_CMD = 0x6F, P_DATA = 0x6D;
const out = (m, p, v) => m.bus.ioWrite(p, v);
const inp = (m, p) => m.bus.ioRead(p);
const send = (m, n, bytes = []) => { out(m, P_CMD, n); for (const b of bytes) out(m, P_DATA, b); };
const status = (m) => inp(m, P_CMD);
const busy = (m) => (status(m) & 0x80) !== 0;
const take = (m, n) => { const r = []; for (let i = 0; i < n; i++) r.push(inp(m, P_DATA)); return r; };
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const hexs = (a) => Array.from(a.slice(0, 12), (v) => v.toString(16)).join(' ') + (a.length > 12 ? ` ...(${a.length})` : '');
const codes = (s) => Array.from(s, (c) => c.charCodeAt(0));
const ser = (n) => [n & 0xFF, (n >> 8) & 0xFF];

// Deterministic pseudo-random bytes (xorshift), so a failure reproduces.
let seed = 0x2068;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };
const randBytes = (n) => Uint8Array.from({ length: n }, () => rnd() & 0xFF);
const textBytes = (n) => Uint8Array.from({ length: n }, () => { const r = rnd() % 96; return r === 95 ? 13 : 32 + r; });   // 32..126 and CR

// ---- (a) raw fake host --------------------------------------------------------------------------------------------------
{
  const m = newMachine();
  const seen = [];
  let reply = { status: 1, data: [] };
  let pending = null;
  m.host = {
    command(n, bytes, answer) {
      seen.push({ n, bytes: Array.from(bytes) });
      if (reply === null) { pending = answer; return null; }
      return reply;
    },
  };

  // Every command and the bytes the host receives.
  send(m, 0);       check('raw: abort (0) gives the host no bytes', seen.length === 1 && seen[0].n === 0 && seen[0].bytes.length === 0);
  send(m, 1);
  check('raw: pick (1) gives the host no bytes', seen.length === 2 && seen[1].n === 1 && seen[1].bytes.length === 0);
  send(m, 5);       check('raw: close (5) gives the host no bytes', seen.length === 3 && seen[2].n === 5 && seen[2].bytes.length === 0);

  for (const len of [0, 1, 30, 31, 255]) {
    seen.length = 0;
    const name = Array.from({ length: len }, (_, i) => 65 + (i % 26));
    send(m, 2, [3, len, ...name]);
    check(`raw: open with a name of ${len} bytes`, seen.length === 1 && seen[0].n === 2 && eq(seen[0].bytes, [3, len, ...name]), hexs(seen[0]?.bytes ?? []));
  }
  for (const cnt of [1, 255, 256, 5120, 65535]) {
    seen.length = 0;
    send(m, 3, ser(cnt));
    check(`raw: read count ${cnt}`, seen.length === 1 && seen[0].n === 3 && eq(seen[0].bytes, ser(cnt)));
  }
  for (const n of [0, 1, 255, 256, 5120, 65535]) {
    seen.length = 0;
    const data = randBytes(n);
    send(m, 4, [...ser(n), ...data]);
    check(`raw: write of ${n} bytes`, seen.length === 1 && seen[0].n === 4 && seen[0].bytes.length === n + 2 &&
      eq(seen[0].bytes.slice(0, 2), ser(n)) && eq(seen[0].bytes.slice(2), Array.from(data)));
  }

  // A command's bytes are all in only when the count says so: nothing reaches the host before, extra bytes after are ignored.
  seen.length = 0;
  out(m, P_CMD, 4); out(m, P_DATA, 3); out(m, P_DATA, 0); out(m, P_DATA, 9); out(m, P_DATA, 8);
  check('raw: a write of 3 waits for its third byte (nothing to the host yet)', seen.length === 0);
  out(m, P_DATA, 7);
  check('raw: ... and goes to the host when the third byte is in', seen.length === 1 && eq(seen[0].bytes, [3, 0, 9, 8, 7]));
  out(m, P_DATA, 99); out(m, P_DATA, 98);
  check('raw: bytes after a complete command are ignored', seen.length === 1);
  seen.length = 0;
  out(m, P_DATA, 1); out(m, P_DATA, 2);
  check('raw: OUT $6D with no command started is ignored', seen.length === 0);

  // A new OUT $6F while a command is still taking bytes drops that command.
  seen.length = 0;
  out(m, P_CMD, 4); out(m, P_DATA, 5); out(m, P_DATA, 0); out(m, P_DATA, 1);
  send(m, 5);
  check('raw: a new command drops an incomplete one', seen.length === 1 && seen[0].n === 5);

  // Answers: status on $6F, data on $6D, $00 when none is left.
  reply = { status: 1, data: [10, 20, 30] };
  send(m, 3, ser(3));
  check('answer: status 1, not busy', status(m) === 1);
  check('answer: data bytes in order, then $00 when none is left', eq(take(m, 6), [10, 20, 30, 0, 0, 0]));
  check('answer: reading $6D does not change the status', status(m) === 1);
  reply = { status: 7 };
  send(m, 3, ser(1));
  check('answer: a status with no data (7)', status(m) === 7 && inp(m, P_DATA) === 0);
  reply = { status: 0x85, data: [] };
  send(m, 5);
  check('answer: status uses bits 0-6 (0x85 reads 5)', status(m) === 5);

  // A new command drops what is left of the previous answer.
  reply = { status: 1, data: [1, 2, 3, 4] };
  send(m, 3, ser(4));
  take(m, 1);
  reply = { status: 1, data: [] };
  send(m, 5);
  check('new command drops unread answer bytes', eq(take(m, 3), [0, 0, 0]));
  reply = { status: 1, data: [1, 2, 3, 4] };
  send(m, 3, ser(4));
  out(m, P_CMD, 4);                                  // starting a command (still taking bytes) also drops them
  check('a command being started drops unread answer bytes at once', inp(m, P_DATA) === 0);
  reply = { status: 1, data: [] };
  send(m, 5);

  // Pending answers: the busy bit, then the answer.
  reply = null;
  send(m, 1);
  check('pending: busy bit set', busy(m));
  check('pending: $6D reads $00 meanwhile', inp(m, P_DATA) === 0);
  pending(1, [3, 65, 66, 67]);
  check('pending: answered: not busy, status 1', !busy(m) && status(m) === 1);
  check('pending: the answer data', eq(take(m, 5), [3, 65, 66, 67, 0]));
  pending(12);                                       // a second answer to the same command is ignored
  check('pending: a second answer() is ignored', status(m) === 1);

  // Abort during a pending command: the late answer is ignored.
  send(m, 1);
  const late = pending;
  check('abort: busy before', busy(m));
  reply = { status: 12 };
  seen.length = 0;
  send(m, 0);
  check('abort: the host gets command 0', seen.length === 1 && seen[0].n === 0);
  check('abort: status 12, not busy', status(m) === 12 && !busy(m));
  late(1, [1, 66]);
  check('abort: the late answer is ignored', status(m) === 12 && !busy(m) && inp(m, P_DATA) === 0);

  // A new (different) command also drops a pending one.
  reply = null; send(m, 1); const late2 = pending;
  reply = { status: 1 }; send(m, 5);
  late2(12);
  check('a new command drops a pending answer (late answer ignored)', status(m) === 1);

  // resetMachine clears the bridge: pending answer, status, queued data.
  reply = null; send(m, 1); const late3 = pending;
  check('reset: pending before', busy(m));
  M.resetMachine(m);
  check('reset: not busy, status 0', status(m) === 0);
  late3(1, [1, 2]);
  check('reset: a late answer from before it is ignored', status(m) === 0 && inp(m, P_DATA) === 0);
  reply = { status: 1, data: [5, 6, 7] }; send(m, 3, ser(3)); take(m, 1);
  M.resetMachine(m);
  check('reset: unread answer bytes are gone', status(m) === 0 && inp(m, P_DATA) === 0);
  seen.length = 0;
  out(m, P_CMD, 4); out(m, P_DATA, 2); M.resetMachine(m); out(m, P_DATA, 0); out(m, P_DATA, 1); out(m, P_DATA, 1);
  check('reset: a half-sent command is forgotten', seen.length === 0);
}

// ---- No host ------------------------------------------------------------------------------------------------------------
{
  const m = newMachine();
  check('no host: $6F reads $FF', inp(m, P_CMD) === 0xFF);
  check('no host: $6D reads $FF', inp(m, P_DATA) === 0xFF);
  send(m, 2, [0, 1, 65]); send(m, 4, [1, 0, 7]); send(m, 1);
  check('no host: writes are ignored, ports still read $FF', inp(m, P_CMD) === 0xFF && inp(m, P_DATA) === 0xFF);
  // Attaching a host later starts clean: the earlier writes did nothing.
  const seen = [];
  m.host = { command(n, b) { seen.push({ n, b: Array.from(b) }); return { status: 1 }; } };
  out(m, P_DATA, 5);
  check('no host: attaching one later: earlier bytes are not replayed', seen.length === 0 && status(m) === 0);
  m.host = null;
  check('no host: detached again: $FF', inp(m, P_CMD) === 0xFF && inp(m, P_DATA) === 0xFF);
  check('other ports: $FF still reads the port', inp(m, 0xFF) === m.portFF);
}

// ---- (b) the shared file host on the bridge -----------------------------------------------------------------------------
const mkHost = () => {
  const m = newMachine();
  const ev = { picks: [], cancels: 0, saved: [] };
  const host = createFileHost({
    pick(answer) { ev.picks.push(answer); },
    cancelPick() { ev.cancels++; },
    saved(name, bytes, binary) { ev.saved.push({ name, bytes, binary }); },
  });
  m.host = host;
  return { m, host, ev };
};
const open = (m, name, mode) => { send(m, 2, [mode, name.length, ...codes(name)]); return status(m); };
const openLen = (m) => { const [a, b] = take(m, 2); return a | (b << 8); };
const writeAll = (m, data, chunk = 65535) => {
  for (let i = 0; i < data.length || i === 0; i += chunk) {
    const part = data.subarray(i, i + chunk);
    send(m, 4, [...ser(part.length), ...part]);
    if (status(m) !== 1) return status(m);
    if (data.length === 0) break;
  }
  return 1;
};
// Reads everything in chunks of `chunk`; returns { bytes, st } where st is the status that ended it (7 at the end).
const readAll = (m, chunk) => {
  const got = []; let st;
  for (;;) {
    send(m, 3, ser(chunk));
    st = status(m);
    if (st !== 1) break;
    const [lo, hi] = take(m, 2);
    const n = lo | (hi << 8);
    for (const b of take(m, n)) got.push(b);
    if (n === 0) break;                            // a host that answers 1 with nothing would loop for ever
  }
  return { bytes: got, st };
};

{
  const { m, host, ev } = mkHost();
  const SIZES = [0, 1, 255, 256, 5120, 65535];

  // Names: lengths and bad characters (status 3).
  const t = (label, name, mode, want) => check(`name ${label}: open ${mode & 1 ? 'write' : 'read'} gives ${want}`, open(m, name, mode) === want, `got ${status(m)}`);
  t('length 0', '', 1, 3);
  t('length 1', 'a', 1, 1); send(m, 5);
  t('length 30', 'x'.repeat(30), 1, 1); send(m, 5);
  t('length 31', 'x'.repeat(31), 1, 3);
  t('length 31 (read)', 'x'.repeat(31), 0, 3);
  for (const c of '/\\:*?"<>|') t(`with ${JSON.stringify(c)}`, `a${c}b`, 1, 3);
  t('with code 31', `a${String.fromCharCode(31)}b`, 1, 3);
  t('with code 127', `a${String.fromCharCode(127)}b`, 1, 3);
  t('with code 128', `a${String.fromCharCode(128)}b`, 1, 3);
  t('with spaces and dots (legal)', ' a b.c.d ', 1, 1); send(m, 5);
  t('of a missing file', 'missing.txt', 0, 3);

  // No file open.
  host.files.clear(); send(m, 5);
  send(m, 3, ser(10)); check('read with no file open: 3', status(m) === 3);
  send(m, 4, [1, 0, 65]); check('write with no file open: 3', status(m) === 3);
  send(m, 5); check('close with no file open: 1 (harmless)', status(m) === 1);
  open(m, 'w.txt', 1);
  send(m, 3, ser(10)); check('read on a file opened for writing: 3', status(m) === 3);
  send(m, 5);
  host.files.set('r.txt', Uint8Array.from([65, 66]));
  open(m, 'r.txt', 0);
  send(m, 4, [1, 0, 65]); check('write on a file opened for reading: 3', status(m) === 3);
  send(m, 5);

  // Round trips: write then read, text and binary, in chunks.
  for (const binary of [false, true]) for (const n of SIZES) {
    const src = binary ? randBytes(n) : textBytes(n);
    const kind = `${binary ? 'binary' : 'text'} ${n}`;
    const name = `rt${n}.${binary ? 'bin' : 'txt'}`;
    const st0 = open(m, name, 1 | (binary ? 2 : 0));
    check(`${kind}: open for write: status 1, length 0`, st0 === 1 && openLen(m) === 0);
    const stw = writeAll(m, src);
    check(`${kind}: write: status 1`, stw === 1, `status ${stw}`);
    ev.saved.length = 0;
    send(m, 5);
    check(`${kind}: close: status 1, saved() called once with the name and kind`, status(m) === 1 &&
      ev.saved.length === 1 && ev.saved[0].name === name && ev.saved[0].binary === binary);
    const hostBytes = host.files.get(name);
    const wantHost = binary ? Array.from(src) : Array.from(src, (b) => (b === 13 ? 10 : b));
    check(`${kind}: the host stores ${binary ? 'the bytes' : 'LF for CR'}`, hostBytes !== undefined && eq(Array.from(hostBytes), wantHost));
    check(`${kind}: saved() gets the stored bytes`, ev.saved[0] && eq(Array.from(ev.saved[0].bytes), wantHost));

    for (const chunk of [1000, 255, 65535]) {
      if (chunk === 255 && n > 5120) continue;       // 257 round trips of 255 for 65,535 bytes add nothing
      const st1 = open(m, name, binary ? 2 : 0);
      const len = st1 === 1 ? openLen(m) : -1;
      const { bytes, st } = readAll(m, chunk);
      check(`${kind}: read back in chunks of ${chunk}: length ${len}, bytes equal, ended by 7`,
        st1 === 1 && len === n && st === 7 && eq(bytes, Array.from(src)), `len ${len}, got ${bytes.length}, end status ${st}`);
      send(m, 5);
    }
  }

  // Writing in many small chunks gives the same file.
  {
    const src = textBytes(5120);
    open(m, 'chunks.txt', 1); take(m, 2);
    check('chunked write 5120 in 255s', writeAll(m, src, 255) === 1);
    send(m, 5);
    check('chunked write: file equal', eq(Array.from(host.files.get('chunks.txt')), Array.from(src, (b) => (b === 13 ? 10 : b))));
  }

  // A text file with every line-end form reads as CR; the length is after the conversion.
  const LE = [65, 13, 10, 66, 10, 67, 13, 9, 1, 200, 68];
  host.files.set('le.txt', Uint8Array.from(LE));
  check('text read: open gives the converted length (9)', open(m, 'le.txt', 0) === 1 && openLen(m) === 9);
  check('text read: bytes are converted', eq(readAll(m, 100).bytes, Array.from(textIn(Uint8Array.from(LE)))) && eq(Array.from(textIn(Uint8Array.from(LE))), [65, 13, 66, 13, 67, 13, 32, 63, 68]));
  send(m, 5);
  check('binary read of the same file: raw', open(m, 'le.txt', 2) === 1 && openLen(m) === 11 && eq(readAll(m, 100).bytes, LE));
  send(m, 5);

  // Read at the end: 7; a read of more than is left gives what is left.
  open(m, 'le.txt', 2); take(m, 2);
  send(m, 3, ser(65535));
  const [lo, hi] = take(m, 2);
  check('read: more than is left gives what is left (11)', status(m) === 1 && (lo | (hi << 8)) === 11);
  take(m, 11);
  send(m, 3, ser(1)); check('read at the end: 7', status(m) === 7);
  check('read at the end: no data bytes', inp(m, P_DATA) === 0);
  send(m, 5);
  host.files.set('empty.bin', new Uint8Array(0));
  open(m, 'empty.bin', 2); take(m, 2);
  send(m, 3, ser(5)); check('read of an empty file: 7', status(m) === 7);
  send(m, 5);

  // Past 65,535: status 6, and the file keeps what was accepted.
  open(m, 'big.bin', 3); take(m, 2);
  const a = randBytes(40000), b = randBytes(30000), c = randBytes(25535);
  check('limit: 40,000 accepted', writeAll(m, a) === 1);
  send(m, 4, [...ser(b.length), ...b]);
  check('limit: 40,000 + 30,000 refused with status 6', status(m) === 6);
  check('limit: a refused write adds nothing: 25,535 more fit exactly', writeAll(m, c) === 1);
  send(m, 4, [1, 0, 7]);
  check('limit: one byte past 65,535: status 6', status(m) === 6);
  send(m, 5);
  check('limit: the file is the 65,535 accepted bytes', eq(Array.from(host.files.get('big.bin')), [...a, ...c]));
  host.files.set('toolong.bin', new Uint8Array(65536));
  check('a 65,536-byte binary file cannot be opened: 3', open(m, 'toolong.bin', 2) === 3);

  // Open for write replaces; a write of 0 bytes is fine.
  open(m, 'rep.txt', 1); take(m, 2); writeAll(m, Uint8Array.from([65, 66])); send(m, 5);
  open(m, 'rep.txt', 1); take(m, 2);
  check('write of 0 bytes: status 1', writeAll(m, new Uint8Array(0)) === 1);
  send(m, 5);
  check('open for write replaces the file', host.files.get('rep.txt').length === 0);

  // Pick: busy, then the answer; cancel; abort.
  ev.picks.length = 0;
  send(m, 1);
  check('pick: busy while the host waits; the hook was called', busy(m) && ev.picks.length === 1);
  check('pick: $6D reads $00 while busy', inp(m, P_DATA) === 0);
  ev.picks[0]('hello world.txt', Uint8Array.from([72, 105]));
  check('pick: answered: not busy, status 1', !busy(m) && status(m) === 1);
  const nm = take(m, 1 + 'hello world.txt'.length);
  check('pick: the name: a length byte, then the codes', nm[0] === 15 && String.fromCharCode(...nm.slice(1)) === 'hello world.txt');
  check('pick: the file is in the host and opens', open(m, 'hello world.txt', 0) === 1 && openLen(m) === 2 && eq(readAll(m, 9).bytes, [72, 105]));
  send(m, 5);
  ev.picks.length = 0;
  send(m, 1); ev.picks[0]('bad/name:x.txt', Uint8Array.from([1]));
  const nm2 = take(m, 1 + 14);
  check('pick: a name with bad codes is made usable (bad_name_x.txt)', nm2[0] === 14 && String.fromCharCode(...nm2.slice(1)) === 'bad_name_x.txt' && host.files.has('bad_name_x.txt'));
  ev.picks.length = 0;
  send(m, 1); ev.picks[0]('z'.repeat(40) + '.txt', Uint8Array.from([1]));
  const nm3 = take(m, 31);
  check('pick: a long name is cut to 30 and keeps its extension', nm3[0] === 30 && String.fromCharCode(...nm3.slice(1)).endsWith('.txt') && nameOk(String.fromCharCode(...nm3.slice(1))));
  ev.picks.length = 0;
  send(m, 1); ev.picks[0](null);
  check('pick cancelled by the user: status 12, not busy, no name', status(m) === 12 && !busy(m) && inp(m, P_DATA) === 0 && !host.picking);
  ev.picks.length = 0; ev.cancels = 0;
  send(m, 1);
  const lateAnswer = ev.picks[0];
  check('pick: abort: busy before', busy(m) && host.picking);
  send(m, 0);
  check('pick abort: status 12, not busy, cancelPick called once', status(m) === 12 && !busy(m) && ev.cancels === 1 && !host.picking);
  const filesBefore = host.files.size;
  lateAnswer('late.txt', Uint8Array.from([1, 2]));
  check('pick abort: the late answer is ignored (status, data, files)', status(m) === 12 && inp(m, P_DATA) === 0 && host.files.size === filesBefore && !host.files.has('late.txt'));
  send(m, 0);
  check('abort with no pick: 12, cancelPick not called again', status(m) === 12 && ev.cancels === 1);
  open(m, 'abort.txt', 1); take(m, 2); writeAll(m, Uint8Array.from([65]));
  ev.saved.length = 0;
  send(m, 0);
  send(m, 4, [1, 0, 65]);
  check('abort drops the open file: a write after it gives 3, nothing saved', status(m) === 3 && ev.saved.length === 0 && !host.files.has('abort.txt'));

  // A new pick after an abandoned one (the first answered late, then the second).
  ev.picks.length = 0;
  send(m, 1); const first = ev.picks[0];
  send(m, 1); const second = ev.picks[1];
  first('one.txt', Uint8Array.from([1]));
  second('two.txt', Uint8Array.from([2]));
  const nm4 = take(m, 8);
  check('a second pick after an abandoned first: the second answer is the one seen', status(m) === 1 && nm4[0] === 7 && String.fromCharCode(...nm4.slice(1, 8)) === 'two.txt', `${hexs(nm4)}, status ${status(m)}`);
  check('... and the abandoned first answer added no file', !host.files.has('one.txt'));

  // No pick hook: a pick is cancelled at once.
  const bare = newMachine();
  bare.host = createFileHost({});
  send(bare, 1);
  check('no pick hook: pick answers 12 at once', status(bare) === 12 && !busy(bare));

  // resetMachine with a pick pending: a late answer is not seen by the Z80.
  ev.picks.length = 0;
  send(m, 1); const preReset = ev.picks[0];
  M.resetMachine(m);
  check('reset with a pick pending: not busy, status 0', !busy(m) && status(m) === 0);
  preReset('afterreset.txt', Uint8Array.from([1]));
  check('reset: the late pick answer is not seen by the Z80', status(m) === 0 && inp(m, P_DATA) === 0);

  // Unknown command numbers are refused (3) by the file host.
  send(m, 9);
  check('unknown command 9: status 3', status(m) === 3);
}

C.done();
