"use strict";
// review-profile.mjs -- where K_POLL's T-states go in chosen frames (direct calls, interrupts off): per label of events.asm.
import { start, setInput, setCall, step, snapshot, restore } from './review-lib.mjs';
const { m, S } = start();
const NONE = () => new Uint8Array(8);
const keys = (...ks) => { const r = NONE(); for (const k of ks) r[(k / 5) | 0] |= 1 << (k % 5); return r; };
const LABELS = ['K_POLL', 'K_POLL.keys', 'K_POLL.joy', 'k_button', 'k_dir', 'k_dir.moved', 'k_pdata', 'k_keys', 'k_keys.notog', 'k_keys.repeat', 'k_rowchg', 'k_prep', 'k_row', 'k_press', 'k_press.code', 'k_enq', 'P_ISRMOVE']
  .map((n) => [n, S[n]]).sort((a, b) => a[1] - b[1]);
const labelOf = (pc) => { let best = '?'; for (const [n, a] of LABELS) if (a <= pc) best = n; else break; return pc >= S.P_ISRMOVE && pc < S.P_ISRMOVE + 20 ? 'P_ISRMOVE' : best; };
function poll(rows, joy, prof) {
  setInput(m, rows, joy); setCall(m, S, S.K_POLL, {}, false);
  const t0 = m.tstates;
  while (m.cpu.pc !== S.T_RET) { const l = prof ? labelOf(m.cpu.pc) : null; const dt = step(m); if (prof) prof[l] = (prof[l] || 0) + dt; }
  return m.tstates - t0;
}
function prep(caps) {                                  // hold right + down for 31 frames at mid screen: full speed, hold = 30
  if (caps) { poll(keys(0), 0xFF); poll(keys(0, 16), 0xFF); poll(NONE(), 0xFF); }
  m.ram[S.K_PX] = 100; m.ram[S.K_PX + 1] = 0; m.ram[S.K_PY] = 20;
  for (let i = 0; i < 31; i++) poll(NONE(), 0xF5);
  m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL];                // the consumer has kept up: the next move is appended
}
const base = snapshot(m);
const show = (name, rows, joy, caps = false, pre = null) => {
  restore(m, base); prep(caps); if (pre) pre();
  const prof = {}; const t = poll(rows, joy, prof);
  console.log(`${name}: ${t} T   ` + Object.entries(prof).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
  return t;
};
show('idle                          ', NONE(), 0xFF);
show('move only (full speed)        ', NONE(), 0xF5);
show('move + button                 ', NONE(), 0x75);
show('one key                       ', keys(5), 0xFF);
show('two keys, one half-row        ', keys(5, 6), 0xFF);
show('two keys, two half-rows       ', keys(5, 31), 0xFF);
show('two keys (2 rows) caps lock on', keys(5, 31), 0xFF, true);
show('move + button + two keys      ', keys(5, 31), 0x75, true);
show('move + button + one key        ', keys(5), 0x75, true);
show('same, CS held before          ', keys(0, 5, 31), 0x75, false, () => poll(keys(0), 0xF5));
show('same, CS newly down too       ', keys(0, 5, 31), 0x75);
show('same, CS+SS+2 keys all new    ', keys(0, 36, 9, 39), 0x75);
show('key held (no change)          ', keys(5), 0xFF, false, () => poll(keys(5), 0xFF));

// The worst frame of 14.8 (full-speed move, button change, two keys newly down), searched over every pair of keys.
{
  const NAMES = ['none', 'CS held', 'SS held', 'CS new', 'SS new'];
  const worst = NAMES.map(() => ({ t: 0 }));
  for (const caps of [false, true]) {
    restore(m, base); prep(caps);
    const snaps = [snapshot(m)];
    poll(keys(0), 0xF5); m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; snaps.push(snapshot(m));
    restore(m, snaps[0]); poll(keys(36), 0xF5); m.ram[S.K_RHEAD] = m.ram[S.K_RTAIL]; snaps.push(snapshot(m));
    for (let a = 1; a < 40; a++) for (let b = a + 1; b < 40; b++) {
      if (a === 36 || b === 36) continue;
      for (const [mi, [sn, mods]] of [[0, []], [1, [0]], [2, [36]], [0, [0]], [0, [36]]].entries()) {
        restore(m, snaps[sn]);
        const t = poll(keys(a, b, ...mods), 0x75);
        if (t > worst[mi].t) worst[mi] = { t, a, b, caps };
      }
    }
  }
  console.log('worst K_POLL over all pairs of new keys with a full-speed move and a button change (contract bound 2,000; 16.2 reports 4,560):');
  worst.forEach((w, i) => console.log(`  modifiers ${NAMES[i].padEnd(8)}: ${w.t} T (keys ${w.a}, ${w.b}, caps lock ${w.caps ? 'on' : 'off'})`));
}
