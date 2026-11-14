"use strict";
// kern-dclick.mjs -- the kernel's double-click flag of `desk5` (docs/WRITE.md 14.9 item 1; docs/OBJECTS_EVENTS.md section 6): every E_DOWN the ISR queues carries data 3 bit 2 = 1 when it is a double-click.
// Written from the contract only (the Z80 sources were not read; src/kernel/events.asm's header comments gave the ring's addresses).  The mouse is driven through the real ISR (m.mouse, frames run
// normally), the records are read from the ring (K_RING, K_RTAIL: the records the ISR appended in a frame), the reference is tests/kdc-model.mjs.
//   node tests/kern-dclick.mjs [--seed N] [--nrand N] [--only LIST]
//     --only LIST  groups: 1 boot values, 2 presses 2..45 frames apart (19, 20, 21 around the limit), 3 the distance grid (dx -10..10, dy -6..6, both signs, bases across x = 255 / 256, the edges),
//                  4 triples, quadruples and held presses, 5 bit 2 on E_MOVE / E_UP and bits 0-1 of data 3 unchanged, 6 random sessions against the model, 7 memory watch / frames
// The presses are on the bare desk (x >= 300, y >= 120: no window, no menu, no icon), so the shell does nothing with them.  The last line is "kern-dclick: N of M groups pass".
import * as L from './calc-lib.mjs';
import * as X from './tk-lib2.mjs';
import { KDc } from './kdc-model.mjs';

const { argv, argNum, hex, rd16 } = L;
const SEED = argNum('--seed', 1), NRAND = argNum('--nrand', 600);
const ONLY = argv.includes('--only') ? String(argv[argv.indexOf('--only') + 1]).split(',') : ['1', '2', '3', '4', '5', '6', '7'];
const has = (g) => ONLY.includes(g);
const VERBOSE = argv.includes('--verbose');
const rng = L.makeRng(SEED);
const { Sec, finish } = X.makeGroups('kern-dclick', VERBOSE);
console.log(`seed ${SEED} (rerun with --seed ${SEED}); ${NRAND} random steps`);
const S0 = L.loadDesk5().S;
{ const miss = ['K_DCN', 'K_DCX', 'K_DCY', 'K_RING', 'K_RTAIL', 'K_RHEAD', 'K_PX', 'K_PY', 'K_BTN'].filter((n) => S0[n] === undefined); if (miss.length) { console.log(`FAIL: desk5 does not define ${miss.join(', ')}`); process.exit(1); } }
if (S0.K_DCN !== 0xF0B5 || S0.K_DCX !== 0xF0B6 || S0.K_DCY !== 0xF0B8) { console.log(`FAIL: K_DCN / K_DCX / K_DCY are ${hex(S0.K_DCN)} / ${hex(S0.K_DCX)} / ${hex(S0.K_DCY)}, 14.9 says $F0B5 / $F0B6 / $F0B8`); process.exit(1); }

const E_DOWN = 3, E_UP = 4, E_MOVE = 2;
const envs = [];

/** A fresh machine (the shell running, nothing pressed since the boot) and its driver: every frame goes through frame() so that the model sees each K_POLL. */
function newMachine() {
  const env = L.bootDesk5({ prog: 0, rng }); envs.push(env);
  const { m, S } = env, kd = new KDc();
  const M = { env, m, S, kd, sec: null, ctx: '', log: [], presses: 0, flagged: 0, frames: 0 };
  M.frame = () => {
    const t0 = m.ram[S.K_RTAIL]; kd.frame(); env.frame(); M.frames++;
    const t1 = m.ram[S.K_RTAIL], recs = [];
    for (let t = t0; t !== t1 && recs.length < 16; t = (t + 4) & 0xFF) { const a = S.K_RING + (t & 0x3F); recs.push([m.ram[a], m.ram[a + 1], m.ram[a + 2], m.ram[a + 3]]); }
    // every E_DOWN of every frame is judged against the model here (a press is polled after this frame's decrement of K_DCN)
    for (const d of recs) if (d[0] === E_DOWN) {
      const px = d[1] + 256 * (d[3] & 1), py = d[2], prev = [kd.x, kd.y, kd.n], want = kd.press(px, py), flag = (d[3] & 4) !== 0;
      M.presses++; if (flag) M.flagged++;
      M.sec.ok(flag === want, () => `${M.ctx}: E_DOWN at (${px}, ${py}) data 3 ${d[3]}: the double-click flag is ${flag ? 1 : 0}, the rule says ${want ? 1 : 0} (the previous press at (${prev[0]}, ${prev[1]}), K_DCN ${prev[2]} at the poll)`);
      d.want = want;
    }
    const n = m.ram[S.K_DCN];
    M.sec.ok(n === kd.n, () => `${M.ctx}: after frame ${M.frames}: K_DCN ${n}, the rule says ${kd.n}`);
    return recs;
  };
  M.idle = (k) => { const all = []; for (let i = 0; i < k; i++) all.push(...M.frame()); return all; };
  /** The pointer's position now. */
  M.pos = () => L.pointerPos(m, S);
  /** Move the pointer (no press) to (x, y) in steps of <= 60 counts a frame. */
  M.goto = (x, y) => {
    for (let i = 0; i < 40; i++) {
      const [px, py] = M.pos(), dx = x - px, dy = y - py;
      if (dx === 0 && dy === 0) return true;
      m.mouse.x = (m.mouse.x + Math.max(-60, Math.min(60, dx))) & 0xFF; m.mouse.y = (m.mouse.y - Math.max(-60, Math.min(60, dy))) & 0xFF;
      M.frame();
    }
    return false;
  };
  /** One frame with the pointer moved by (dx, dy) counts AND the button changed in that same frame: returns { recs, down: the E_DOWN record or null, flag, x, y }. */
  M.step = (dx, dy, buttons) => {
    if (dx) m.mouse.x = (m.mouse.x + dx) & 0xFF;
    if (dy) m.mouse.y = (m.mouse.y - dy) & 0xFF;
    if (buttons !== undefined) m.mouse.buttons = buttons;
    const recs = M.frame(), [x, y] = M.pos();
    const down = recs.find((r) => r[0] === E_DOWN) || null;
    return { recs, down, x, y };
  };
  /** A press at the pointer offset (dx, dy) from where it is, held `hold` frames, then released; checks the flag, K_DCN, K_DCX, K_DCY, and every record's data 3. Returns { flag, x, y }. */
  M.press = (dx, dy, hold = 1) => {
    const r = M.step(dx, dy, L.MOUSE_LEFT);
    const sec = M.sec, ctx = M.ctx;
    sec.ok(!!r.down, () => `${ctx}: no E_DOWN queued for a press (records ${JSON.stringify(r.recs)})`);
    if (!r.down) { m.mouse.buttons = L.MOUSE_UP; M.frame(); return { flag: false, x: r.x, y: r.y, ok: false }; }
    const d = r.down, px = d[1] + 256 * (d[3] & 1), py = d[2], flag = (d[3] & 4) !== 0;
    sec.ok(px === r.x && py === r.y, () => `${ctx}: the E_DOWN is at (${px}, ${py}), the pointer is at (${r.x}, ${r.y})`);
    // data 3: bit 0 x bit 8, bit 1 the button held (an E_DOWN: 1), bit 2 the flag, nothing else
    sec.ok((d[3] & 3) === (((px >> 8) & 1) | 2), () => `${ctx}: E_DOWN data 3 bits 0-1 are ${d[3] & 3}, want ${((px >> 8) & 1) | 2}`);
    sec.ok((d[3] & 0xF8) === 0, () => `${ctx}: E_DOWN data 3 ${d[3]} has bits above bit 2`);
    sec.ok(m.ram[S.K_DCN] === kd.n && rd16(m, S.K_DCX) === px && m.ram[S.K_DCY] === py, () => `${ctx}: after the press at (${px}, ${py}): K_DCN ${m.ram[S.K_DCN]} (rule ${kd.n}), K_DCX ${rd16(m, S.K_DCX)}, K_DCY ${m.ram[S.K_DCY]}`);
    for (const rec of r.recs) if (rec[0] === E_MOVE) sec.ok((rec[3] & 4) === 0, () => `${ctx}: an E_MOVE has data 3 bit 2 set (${rec[3]})`);
    for (let i = 1; i < hold; i++) for (const rec of M.frame()) if (rec[0] !== E_DOWN) sec.ok((rec[3] & 4) === 0, () => `${ctx}: a held press: record ${JSON.stringify(rec)} has bit 2`);
    const u = M.step(0, 0, L.MOUSE_UP);
    const up = u.recs.find((q) => q[0] === E_UP);
    sec.ok(!!up, () => `${ctx}: no E_UP after the release (records ${JSON.stringify(u.recs)})`);
    if (up) {
      sec.ok((up[3] & 4) === 0, () => `${ctx}: E_UP data 3 ${up[3]} has bit 2 set (a double-click is marked on E_DOWN only)`);
      sec.ok((up[3] & 3) === ((u.x >> 8) & 1), () => `${ctx}: E_UP data 3 bits 0-1 are ${up[3] & 3}, want ${(u.x >> 8) & 1} (x bit 8, no button)`);
      sec.ok(up[1] === (u.x & 255) && up[2] === u.y, () => `${ctx}: E_UP at (${up[1]}, ${up[2]}), the pointer is at (${u.x & 255}, ${u.y})`);
    }
    for (const rec of u.recs) if (rec[0] === E_MOVE) sec.ok((rec[3] & 4) === 0, () => `${ctx}: an E_MOVE has data 3 bit 2 set (${rec[3]})`);
    return { flag, x: px, y: py, ok: true };
  };
  return M;
}
const wait = (M, n = 24) => M.idle(n);                          // the 21 frames of K_DCN run out

// ===========================================================================================================================
if (has('1')) {
  const M = newMachine(); M.sec = new Sec('1 boot: K_DCN, K_DCX and K_DCY are 0 after the boot (14.9: "Boot clears all three"), no flag on the first press, and K_DCN counts down by one a frame from 21 (K_POLL)');
  const { sec, m, S } = M;
  M.ctx = 'boot';
  sec.ok(m.ram[S.K_DCN] === 0 && rd16(m, S.K_DCX) === 0 && m.ram[S.K_DCY] === 0, () => `after the boot K_DCN ${m.ram[S.K_DCN]}, K_DCX ${rd16(m, S.K_DCX)}, K_DCY ${m.ram[S.K_DCY]}`);
  M.idle(5); sec.ok(m.ram[S.K_DCN] === 0, 'K_DCN stays 0 over idle frames (it drops only when it is not 0)');
  M.goto(400, 150); M.idle(3);
  M.ctx = 'first press';
  const r = M.press(0, 0);
  sec.ok(!r.flag, 'the first press of the run has no flag (K_DCN was 0)');
  sec.ok(m.ram[S.K_DCN] === 21 - 1, () => `after a press and its release frame K_DCN ${m.ram[S.K_DCN]}, want 20 (21 at the press, one frame of release)`);
  for (let k = 1; k <= 22; k++) { M.frame(); const want = Math.max(0, 20 - k); sec.ok(m.ram[S.K_DCN] === want, () => `${k} frames later K_DCN ${m.ram[S.K_DCN]}, want ${want}`); }
  sec.end(`${M.presses} press, ${M.frames} frames`);
}

// ===========================================================================================================================
if (has('2')) {
  const M = newMachine(); M.sec = new Sec('2 the 20-frame limit: a second press at the same place f2 - f1 frames after the first is a double-click for f2 - f1 <= 20 and not for 21 or more (gaps 2-45, 19 / 20 / 21 included, each several times); K_DCN after each press is 0 (a double) or 21 (not)');
  const { sec, m, S } = M;
  const gaps = [2, 3, 4, 5, 8, 12, 17, 18, 19, 20, 21, 22, 23, 24, 30, 45, 60];
  let n = 0;
  for (let rep = 0; rep < 3; rep++) for (const gap of gaps) {
    M.goto(rng.int(320, 480), rng.int(130, 180)); wait(M);
    M.ctx = `gap ${gap}`;
    // press at frame f (hold 1) and release at f + 1; the second press polled in frame f + gap
    const a = M.press(0, 0);
    // the press() helper already ran the release frame (f + 1): run gap - 2 more idle frames, so the next frame is f + gap
    M.idle(gap - 2);
    const b = M.press(0, 0);
    n++;
    sec.ok(!a.flag, () => `gap ${gap}: the first press (K_DCN 0 before) is flagged`);
    sec.ok(b.flag === (gap <= 20), () => `gap ${gap}: the second press is ${b.flag ? '' : 'not '}a double-click, the contract says ${gap <= 20 ? '' : 'not '}one (K_DCN after: ${m.ram[S.K_DCN]})`);
    // K_DCN right after a press: 0 for a double, 21 for not, then one release frame has run: read it via the model (checked every frame) and directly here
    sec.ok(m.ram[S.K_DCN] === (b.flag ? 0 : 20), () => `gap ${gap}: K_DCN ${m.ram[S.K_DCN]} after the second press and its release frame, want ${b.flag ? 0 : 20}`);
  }
  sec.end(`${n} pairs, ${M.flagged} flagged`);
}

// ===========================================================================================================================
if (has('3')) {
  const M = newMachine(); M.sec = new Sec('3 the distance: |dx| <= 8 (9-bit x) and |dy| <= 4: the whole grid dx -10..10, dy -6..6 from bases that alternate far apart (so no trial is a double of the one before), the bases across x = 255 / 256 and near the edges, 4 frames apart');
  const { sec, m, S } = M;
  const bases = [[400, 150], [330, 170], [255, 140], [256, 160], [252, 130], [260, 175], [4, 150], [500, 150], [3, 125], [508, 180], [24, 120], [511, 190]];
  let n = 0, flagged = 0, calib = 0;
  const near = (dx, dy) => Math.abs(dx) <= 8 && Math.abs(dy) <= 4;
  // the desk is bare at x >= 300 or y >= 120 (the shell's window ends at (288, 104)); bases at x < 300 stay at y >= 120.  Far apart bases alternate: each trial's first press is far from the previous trial's second.
  for (let bi = 0; bi < bases.length; bi++) {
    const [bx, by] = bases[bi], far = bases[(bi + 6) % bases.length];
    for (let dy = -6; dy <= 6; dy++) for (let dx = -10; dx <= 10; dx++) {
      if (sec.nf > 8) break;
      // go to the base (the pointer's frames are not a press), let K_DCN run out, then press at the base and 4 frames later at the offset
      M.goto(bx, by); wait(M, 22);
      M.ctx = `base (${bx}, ${by}) offset (${dx}, ${dy})`;
      const a = M.press(0, 0);                              // the release frame has run: frame f + 1
      M.idle(2);                                            // f + 2, f + 3
      const [px, py] = M.pos();
      if (px !== bx || py !== by) { calib++; continue; }
      const tx = Math.max(0, Math.min(511, bx + dx)), ty = Math.max(0, Math.min(191, by + dy));
      const b = M.press(tx - px, ty - py);                  // polled in frame f + 4
      n++;
      const rdx = b.x - bx, rdy = b.y - by;
      if (b.flag) flagged++;
      sec.ok(b.flag === (near(rdx, rdy) && true), () => `first press (${bx}, ${by}), second (${b.x}, ${b.y}) = offset (${rdx}, ${rdy}), 4 frames later: flag ${b.flag ? 1 : 0}, want ${near(rdx, rdy) ? 1 : 0} (|dx| <= 8 and |dy| <= 4)`);
      void far; void a;
    }
  }
  sec.end(`${n} pairs (${flagged} flagged), ${calib} skipped (the pointer was not at the base)`);
}

// ===========================================================================================================================
if (has('4')) {
  const M = newMachine(); M.sec = new Sec('4 triples and longer chains: the second press of a chain is flagged, the third is not (the second was a double-click), the fourth is, the fifth is not; held presses count from the press, not the release; a double does not make the next press near an older one');
  const { sec, m, S } = M;
  const chain = (name, gaps, offs, want) => {
    M.goto(380, 150); wait(M, 24);
    M.ctx = name;
    const got = [];
    for (let i = 0; i <= gaps.length; i++) {
      if (i > 0) { const used = 2; M.idle(Math.max(0, gaps[i - 1] - used)); }
      const [ox, oy] = offs[i] || [0, 0];
      got.push(M.press(ox, oy).flag);
    }
    sec.ok(JSON.stringify(got) === JSON.stringify(want), () => `${name}: flags ${JSON.stringify(got.map(Number))}, want ${JSON.stringify(want.map(Number))}`);
  };
  chain('triple, 5 frames apart', [5, 5], [], [false, true, false]);
  chain('quadruple, 5 frames apart', [5, 5, 5], [], [false, true, false, true]);
  chain('five, 3 frames apart', [3, 3, 3, 3], [], [false, true, false, true, false]);
  chain('six, 4 frames apart', [4, 4, 4, 4, 4], [], [false, true, false, true, false, true]);
  chain('triple: the third 20 frames after the second (still not a double)', [5, 20], [], [false, true, false]);
  chain('quadruple: the third unflagged at 20 frames, the fourth 20 after it', [5, 20, 20], [], [false, true, false, true]);
  chain('the third 21 frames after the second, the fourth 5 after the third', [5, 21, 5], [], [false, true, false, true]);
  chain('a far second press starts again: the third near the second is the double', [4, 4], [[0, 0], [60, 0], [3, 2]], [false, false, true]);
  chain('the third near the FIRST but far from the second is not a double', [4, 4], [[0, 0], [30, 0], [-30, 0]], [false, false, false]);
  chain('the second 9 across, the third 8 from the second and 17 from the first', [4, 4], [[0, 0], [9, 0], [8, 0]], [false, false, true]);
  chain('a 4 down / 8 across chain: 2nd flagged, then 3rd unflagged, 4th at (+8, +4) from the 3rd flagged', [4, 4, 4], [[0, 0], [8, 4], [8, 4], [8, 4]], [false, true, false, true]);
  // held presses: K_DCN counts from the press, so a long hold uses up the 20 frames
  {
    M.goto(380, 150); wait(M, 24); M.ctx = 'held 10 frames, second press 8 frames after the release';
    const a = M.press(0, 0, 10);           // press at f, held to f + 9, released in f + 10; the helper ran frame f + 10
    M.idle(7);                             // f + 11 .. f + 17
    const b = M.press(0, 0, 1);            // f + 18: 18 frames after the first: a double
    sec.ok(!a.flag && b.flag, () => `held 10, then a press 18 frames after the first: flags ${a.flag}, ${b.flag}, want false, true`);
    wait(M, 24); M.ctx = 'held 25 frames, then a press 2 frames after the release';
    const c = M.press(0, 0, 25), d = M.press(0, 0, 1);
    sec.ok(!c.flag && !d.flag, () => `held 25 frames then a press: flags ${c.flag}, ${d.flag}, want false, false (the 21 frames ran out while the button was down)`);
  }
  sec.end(`${M.presses} presses, ${M.flagged} flagged`);
}

// ===========================================================================================================================
if (has('5')) {
  const M = newMachine(); M.sec = new Sec('5 data 3: bit 2 is never set on E_MOVE or E_UP (also right after a double-click, near it, and while K_DCN is not 0), bits 0-1 are the pointer\'s x bit 8 and the button as before on every record; data 1 and 2 are the pointer\'s x (low byte) and y');
  const { sec, m, S } = M;
  const seen = { move: 0, up: 0, down: 0, downFlag: 0, moveHi: 0, upHi: 0 };
  // a driver that checks every record of every frame, whatever it is
  const check = (recs, x, y, held, what) => {
    for (const r of recs) {
      sec.ok((r[3] & 0xF8) === 0, () => `${what}: record ${JSON.stringify(r)} has bits above bit 2 in data 3`);
      if (r[0] === E_MOVE) { seen.move++; sec.ok((r[3] & 4) === 0, () => `${what}: E_MOVE ${JSON.stringify(r)} has bit 2`); sec.ok((r[3] & 1) === ((x >> 8) & 1), () => `${what}: E_MOVE data 3 bit 0 ${r[3] & 1}, the pointer's x is ${x}`); if (x > 255) seen.moveHi++; }
      else if (r[0] === E_UP) { seen.up++; sec.ok((r[3] & 4) === 0, () => `${what}: E_UP ${JSON.stringify(r)} has bit 2`); sec.ok((r[3] & 3) === ((x >> 8) & 1), () => `${what}: E_UP data 3 bits 0-1 ${r[3] & 3}, want ${(x >> 8) & 1}`); if (x > 255) seen.upHi++; }
      else if (r[0] === E_DOWN) { seen.down++; if (r[3] & 4) seen.downFlag++; sec.ok((r[3] & 3) === (((x >> 8) & 1) | 2), () => `${what}: E_DOWN data 3 bits 0-1 ${r[3] & 3}, want ${((x >> 8) & 1) | 2}`); }
    }
  };
  M.ctx = 'records';
  // a long drag across x = 255 / 256 with the button held, then a release, a quick second press (double), drag again, release (E_UP near a double), a third press
  M.goto(252, 150); wait(M, 24);
  let r = M.step(0, 0, L.MOUSE_LEFT); check(r.recs, r.x, r.y, true, 'press 1');
  for (let i = 0; i < 4; i++) { r = M.step(2, 0); check(r.recs, r.x, r.y, true, `drag ${i}`); }       // across 256: x 252 -> 260, 8 from the press
  r = M.step(0, 0, L.MOUSE_UP); check(r.recs, r.x, r.y, false, 'release 1');
  r = M.step(0, 0, L.MOUSE_LEFT); check(r.recs, r.x, r.y, true, 'press 2 (a double: near, 2 frames)');
  sec.ok(r.down && (r.down[3] & 4) !== 0, 'the second press is a double-click');
  for (let i = 0; i < 4; i++) { r = M.step(-2, 0); check(r.recs, r.x, r.y, true, `drag again ${i}`); }
  r = M.step(0, 0, L.MOUSE_UP); check(r.recs, r.x, r.y, false, 'release 2 (E_UP right after a double-click)');
  r = M.step(0, 0, L.MOUSE_LEFT); check(r.recs, r.x, r.y, true, 'press 3 (not a double: the second was one)');
  sec.ok(r.down && (r.down[3] & 4) === 0, 'the third press is not flagged');
  r = M.step(0, 0, L.MOUSE_UP); check(r.recs, r.x, r.y, false, 'release 3');
  // E_MOVE alone while K_DCN is not 0 and the pointer is "near": no bit 2
  M.step(0, 0, L.MOUSE_LEFT); M.step(0, 0, L.MOUSE_UP);
  for (let i = 0; i < 6; i++) { r = M.step(rng.int(-2, 2), rng.int(-1, 1)); check(r.recs, r.x, r.y, false, `moves while K_DCN > 0 (${i})`); }
  // x > 255 in the high half with a double: bit 0 and bit 2 together
  wait(M, 24); M.goto(300, 150); M.goto(480, 150); wait(M, 24);
  r = M.step(0, 0, L.MOUSE_LEFT); check(r.recs, r.x, r.y, true, 'press at x 480'); r = M.step(0, 0, L.MOUSE_UP); check(r.recs, r.x, r.y, false, 'release at 480');
  r = M.step(0, 0, L.MOUSE_LEFT); check(r.recs, r.x, r.y, true, 'press 2 at x 480');
  sec.ok(r.down && r.down[3] === (1 | 2 | 4), () => `a double-click at x 480 has data 3 ${r.down && r.down[3]}, want 7 (x bit 8, button, double-click)`);
  r = M.step(0, 0, L.MOUSE_UP); check(r.recs, r.x, r.y, false, 'release 2 at 480');
  sec.ok(seen.move > 0 && seen.up > 0 && seen.downFlag > 0, () => `the scenario saw ${JSON.stringify(seen)}`);
  sec.end(`${seen.move} E_MOVE (${seen.moveHi} above 255), ${seen.up} E_UP (${seen.upHi} above 255), ${seen.down} E_DOWN (${seen.downFlag} flagged)`);
}

// ===========================================================================================================================
if (has('6')) {
  const M = newMachine(); M.sec = new Sec('6 random sessions against the model: random moves, presses of 1-6 frames, idle runs of 0-40 frames, positions mostly within a few pixels of the last press; every flag, K_DCN every frame, K_DCX / K_DCY at each press');
  const { sec, m, S } = M;
  M.goto(400, 150); wait(M, 24);
  let steps = 0, presses = 0, double = 0;
  const clampX = (x) => Math.max(256 - 40, Math.min(511, x)), clampY = (y) => Math.max(120, Math.min(190, y));
  for (let k = 0; k < NRAND && sec.nf < 8; k++) {
    steps++;
    const r = rng.next();
    if (r < 0.50) {
      // a press near the last press (or anywhere on the desk) after a random gap
      const [px, py] = M.pos();
      M.idle(rng.pick([0, 0, 1, 2, 3, 6, 10, 15, 18, 19, 20, 21, 22, 30]));
      const tx = clampX(rng.chance(0.7) ? M.kd.x + rng.int(-10, 10) : rng.int(250, 511)), ty = clampY(rng.chance(0.7) ? M.kd.y + rng.int(-6, 6) : rng.int(120, 190));
      // the pointer may have to travel more than the counters allow in one frame: go there first when far
      if (Math.abs(tx - px) > 100 || Math.abs(ty - py) > 100) M.goto(tx, ty);
      const [qx, qy] = M.pos();
      M.ctx = `random step ${k}`;
      const p = M.press(tx - qx, ty - qy, rng.int(1, 6)); presses++; double += p.flag;
    } else if (r < 0.75) M.idle(rng.int(1, 40));
    else { const [px, py] = M.pos(); M.step(clampX(px + rng.int(-12, 12)) - px, clampY(py + rng.int(-6, 6)) - py); }
    M.ctx = `random step ${k}`;
  }
  sec.end(`${steps} steps, ${presses} presses, ${double} flagged`);
}

// ===========================================================================================================================
if (has('7')) {
  const sec = new Sec('7 frames and memory: V_FRAMES rose by 1 on every frame run normally (no DI held across a frame), the memory watch of BANKING 10.7 over every machine of the run');
  envs.forEach((env, i) => {
    sec.ok(env.vf.bad === 0, () => `machine ${i}: V_FRAMES did not rise by 1 on ${env.vf.bad} of ${env.vf.checked} frames, first ${env.vf.first}`);
    sec.ok(env.w.n === 0, () => `machine ${i}: memory watch: ${env.w.summary()}`);
  });
  sec.end(`${envs.length} machines, ${envs.reduce((a, e) => a + e.vf.checked, 0)} frames checked`);
}
finish();
