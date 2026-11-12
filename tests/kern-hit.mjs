"use strict";
// kern-hit.mjs -- option E (docs/OBJECTS_EVENTS.md 16.4): Group tests a child whose HitTest is view_hittest in place.  Checks that the
// in-place test and view_hittest itself (sent with M_HITTEST) agree at every rectangle edge and one step either side, over random
// rectangles (x high bit included), for E_MOVE, E_DOWN and E_UP routed from a root Group to one consuming TBox.
//   node tests/kern-hit.mjs [--seed N]
import { start, makeRng, call } from './gfx6-lib.mjs';
import { checks } from './lib.mjs';
import { buildClasses, MSG } from './kern-model.mjs';
import { neededFor } from './kern-lib.mjs';

const argv = process.argv.slice(2);
const SEED = argv.includes('--seed') ? Number(argv[argv.indexOf('--seed') + 1]) : (Date.now() >>> 0);
console.log(`seed ${SEED}`);
const C = checks('kern hit (option E)');
const classes = buildClasses();
const ctx = start(C, [...neededFor(classes), 'K_DISPATCH', 'K_EV', 'K_CAPTURE', 'K_FOCUS', 'T_SEND', 'view_hittest'], 'kern3');
if (!ctx) { C.done(); process.exit(); }
const { m, S } = ctx;
const rng = makeRng(SEED);
const run = (name, regs = {}) => call(m, S, name, regs, { ints: false, rng });
const wr16 = (a, v) => { m.ram[a] = v & 0xFF; m.ram[a + 1] = (v >> 8) & 0xFF; };
const ARENAS = [[S.K_AARENA, 0xC000, 0xE000], [S.K_KARENA, 0xF100, 0xFB00]];
const fresh = () => { for (const [rec, b, e] of ARENAS) run('K_AINIT', { hl: rec, de: b, bc: e }); run('K_ARENA', { hl: S.K_AARENA }); };

let n = 0, bad = 0;
for (let r = 0; r < 300; r++) {
  fresh();
  const root = run('K_NEW', { hl: S.CL_Group }).regs.ix;
  wr16(root + 8, 0); m.ram[root + 10] = 0; wr16(root + 11, 512); m.ram[root + 13] = 192; m.ram[root + 14] = 0;
  const box = run('K_NEW', { hl: S.CL_TBox }).regs.ix;
  const x = rng.int(0, 511), y = rng.int(0, 191), w = rng.int(0, 600), h = rng.int(0, 255);
  wr16(box + 8, x); m.ram[box + 10] = y; wr16(box + 11, w); m.ram[box + 13] = h; m.ram[box + 14] = 0; m.ram[box + 16] = 1;
  run('K_SETROOT', { de: root }); run('K_ADDCHILD', { ix: root, de: box });
  const xs = new Set(), ys = new Set();
  for (const e of [x, x + w]) for (const d of [-1, 0, 1]) if (e + d >= 0 && e + d <= 511) xs.add(e + d);
  for (const e of [y, y + h]) for (const d of [-1, 0, 1]) if (e + d >= 0 && e + d <= 255) ys.add(e + d);
  xs.add(rng.int(0, 511)); ys.add(rng.int(0, 191));
  for (const px of xs) for (const py of ys) {
    const want = run('T_SEND', { ix: box, a: MSG.HITTEST, bc: px, de: py }).regs.f & 1;
    const ev = [2, 3, 4][rng.int(0, 2)];
    wr16(S.K_CAPTURE, 0); wr16(S.K_FOCUS, 0);
    m.ram.set([ev, px & 255, py, (px >> 8) & 1], S.K_EV);
    const got = run('K_DISPATCH').regs.f & 1;
    n++;
    if (got !== want && bad++ < 10) console.log(`  rect (${x},${y}) ${w}x${h}, point (${px},${py}), event ${ev}: Group ${got}, view_hittest ${want}`);
  }
}
C.check(`in-place test agrees with view_hittest at ${n} edge points`, bad === 0, `${bad} disagree`);
C.done();
