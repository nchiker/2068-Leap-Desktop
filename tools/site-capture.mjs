#!/usr/bin/env node
"use strict";
// site-capture.mjs -- captures the screenshots and clip frames of the Leap Desktop website (pages/leap-desktop.html) from the REAL
// desktop in headless Chrome: web/?cart=desk5 (the page the site's "Try it" button opens), the prebuilt build/desk5.dck.
//   node tools/site-capture.mjs [scenario ...]        (no argument: every scenario)
//   python3 tools/site-gifs.py                        (then: frames -> GIFs, in pages/img/)
// Screens go to pages/img/shots/NAME.png (the 512 x 192 mode-6 picture at 4:3, 1024 x 768); clip frames to build/site-frames/CLIP/NNNN.png
// (512 x 192, every 3rd emulator frame = 20 a second). See tools/site-lib.mjs for what is real (keys) and what is injected (the pointer).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startSession, pngOf, ROOT, W, H } from './site-lib.mjs';

const SHOTS = join(ROOT, 'pages/img/shots'), FRAMES = join(ROOT, 'build/site-frames');
mkdirSync(SHOTS, { recursive: true });

/** x2 across, x4 down: the TS2068's mode-6 pixels are twice as tall as wide, so this is the 4:3 picture the screen shows. */
function scaled(bits, sx = 2, sy = 4) {
  const w = W * sx, h = H * sy, out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = bits[((y / sy) | 0) * W + ((x / sx) | 0)];
  return out;
}
const shot = (name) => async (bits) => { writeFileSync(join(SHOTS, name + '.png'), pngOf(scaled(bits), W * 2, H * 4)); console.log('  shot', name); };

class Clip {
  constructor(name) { this.name = name; this.dir = join(FRAMES, name); rmSync(this.dir, { recursive: true, force: true }); mkdirSync(this.dir, { recursive: true }); this.n = 0; }
  add(list) { for (const b of list) writeFileSync(join(this.dir, String(this.n++).padStart(4, '0') + '.png'), pngOf(b)); }
  done() { console.log(`  clip ${this.name}: ${this.n} frames`); }
}
const EVERY = 3;
const CALC_1234 = [[0, 3], [1, 3], [3, 1], [2, 3], [0, 2], [3, 4]];   // 1 2 * 3 4 =

// --- geometry (screen pixels; PROG_WIN / ICON_RECT of tests/calc-lib.mjs, checked against the screenshots) ---
const ICON = { calc: [80, 53], keycaps: [144, 53], notepad: [208, 53], paint: [272, 53], puzzle: [336, 53] };
const calcBtn = (col, row) => [172 + 40 * col + 16, 64 + 20 * row + 8];
const menuItem = (titleX, k) => [titleX + 10, 14 + 10 * (k - 1)];

async function boot(s) {
  await s.frames(250);
  if ((await s.prog()) !== 0) throw new Error('the desktop did not reach the shell');
}
/** Open menu title at x, hold, and (when item is given) slide to item k and release on it. rec > 0 records frames. */
async function menu(s, titleX, item, { rec = 0, hold = 8, shotFn = null } = {}) {
  const out = await s.moveTo(titleX, 4, { rec });
  await s.buttons(0xFD); out.push(...await s.frames(4, rec));
  if (item) {
    const [x, y] = menuItem(titleX, item);
    out.push(...await s.moveTo(x, y, { rec, step: 6 }));
    out.push(...await s.frames(hold, rec));
    if (shotFn) await shotFn(await s.snap());
    await s.buttons(0xFF); out.push(...await s.frames(10, rec));
  } else {
    out.push(...await s.frames(hold, rec));
    if (shotFn) await shotFn(await s.snap());
  }
  return out;
}
async function launch(s, name, { rec = 0 } = {}) {
  const out = await s.dblclick(...ICON[name], { rec });
  out.push(...await s.frames(50, rec));
  return out;
}
async function quit(s, { rec = 0 } = {}) {
  const out = await s.key('q', { code: 'KeyQ', vk: 81, ctrl: true, rec });
  out.push(...await s.frames(40, rec));
  return out;
}
const KEY = {
  enter: ['Enter', { code: 'Enter', vk: 13, text: '\r' }], backspace: ['Backspace', { code: 'Backspace', vk: 8 }],
  left: ['ArrowLeft', { code: 'ArrowLeft', vk: 37 }], right: ['ArrowRight', { code: 'ArrowRight', vk: 39 }],
  up: ['ArrowUp', { code: 'ArrowUp', vk: 38 }], down: ['ArrowDown', { code: 'ArrowDown', vk: 40 }],
  esc: ['Escape', { code: 'Escape', vk: 27 }], tab: ['Tab', { code: 'Tab', vk: 9 }],
};
const press = (s, k, o = {}) => s.key(KEY[k][0], { ...KEY[k][1], ...o });

// --- Paint: tool box cells (2 x 5, row-major: Marquee Pencil / Brush Eraser / Spray Bucket / Line Rectangle / Rounded Oval), patterns (4 x 4), brushes (4)
const TOOL = { marquee: [0, 0], pencil: [1, 0], brush: [0, 1], eraser: [1, 1], spray: [0, 2], bucket: [1, 2], line: [0, 3], rect: [1, 3], rrect: [0, 4], oval: [1, 4] };
const toolXY = (n) => [72 + 32 * TOOL[n][0], 36 + 16 * TOOL[n][1]];
const patXY = (c, r) => [64 + 16 * c, 118 + 12 * r];
const brushXY = (c) => [64 + 16 * c, 172];
async function stroke(s, pts, rec) {
  const out = await s.moveTo(...pts[0], { rec, step: 6 });
  await s.buttons(0xFD); out.push(...await s.frames(2, rec));
  for (const p of pts.slice(1)) out.push(...await s.moveTo(...p, { rec, step: 5 }));
  await s.buttons(0xFF); out.push(...await s.frames(4, rec));
  return out;
}
async function paintPicture(s, c) {
  const add = (l) => { if (c) c.add(l); };
  const pick = async (xy) => add(await s.click(...xy, { hold: 3, rel: 4, rec: c ? EVERY : 0, step: 20 }));
  const dr = async (pts) => add(await stroke(s, pts, c ? EVERY : 0));
  add(await menu(s, 105, 1, { rec: c ? EVERY : 0, hold: 4 }));          // Options > Filled shapes
  await pick(toolXY('rect')); await pick(patXY(1, 1));                    // a brick-pattern wall
  await dr([[170, 100], [250, 150]]);
  await pick(toolXY('line'));                                              // the roof
  await dr([[160, 100], [210, 60]]); await dr([[210, 60], [260, 100]]); await dr([[160, 100], [260, 100]]);
  await pick(toolXY('oval')); await pick(patXY(3, 0)); await dr([[330, 50], [400, 100]]);   // a sun, filled with a pattern
  await pick(toolXY('bucket')); await pick(patXY(1, 0)); add(await s.click(210, 88, { rec: c ? EVERY : 0, step: 20 })); add(await s.frames(c ? 70 : 200, c ? EVERY : 0));   // the bucket fills the roof
  await pick(toolXY('spray')); await pick(patXY(0, 0)); await dr([[300, 140], [330, 125], [360, 140], [390, 125], [420, 140]]);
  await pick(toolXY('pencil')); await dr([[190, 150], [190, 125], [212, 125], [212, 150]]);   // a door
}
// --- Puzzle: tiles are 64 x 32 from (82, 49); legal moves chosen from the board in RAM (PZ_B, PZ_G): click a tile next to the gap
const cellXY = (i) => [82 + 64 * (i & 3) + 32, 49 + 32 * (i >> 2) + 16];
async function playPuzzle(s, c, n) {
  const add = (l) => { if (c) c.add(l); };
  add(await s.click(400, 104, { rec: c ? EVERY : 0, step: 20 })); add(await s.frames(c ? 40 : 120, c ? EVERY : 0));   // New game
  let last = -1;
  for (let k = 0; k < n; k++) {
    const gap = (await s.ram(s.S.PZ_G, 1))[0], nb = [];
    if (gap & 3) nb.push(gap - 1); if ((gap & 3) < 3) nb.push(gap + 1); if (gap >> 2) nb.push(gap - 4); if ((gap >> 2) < 3) nb.push(gap + 4);
    const opts = nb.filter((x) => x !== last); const pick = opts[(k * 7 + 3) % opts.length];
    add(await s.click(...cellXY(pick), { hold: 3, rel: 12, rec: c ? EVERY : 0, step: 20 }));
    last = gap;
  }
}

const scenarios = {
  // ------------------------------------------------------------------ the desktop and the shell
  async desktop(s) {
    await boot(s);
    await shot('desktop')(await s.snap());
    // the Leap menu
    await menu(s, 20, null, { shotFn: shot('leap-menu') });
    await s.buttons(0xFF); await s.frames(10);
    // About
    await menu(s, 20, 1);
    await s.frames(10);
    await shot('about')(await s.snap());
    await s.key('Enter', { code: 'Enter', vk: 13, text: '\r' }); await s.frames(15);
    // an icon selected by a single click
    await s.click(...ICON.puzzle); await s.frames(10);
    await shot('icon-selected')(await s.snap());
    // drag the shell window: the outline
    await s.moveTo(200, 28); await s.buttons(0xFD); await s.frames(3);
    await s.moveTo(260, 90, { step: 8 }); await s.frames(3);
    await shot('drag-outline')(await s.snap());
    await s.buttons(0xFF); await s.frames(15);
    await shot('drag-dropped')(await s.snap());
    // close the shell window; Leap > Show Desktop brings it back
    await s.click(107, 92); await s.frames(10);   // the close box of the moved window
    await shot('shell-closed')(await s.snap());
    await menu(s, 20, 8); await s.frames(15);      // Leap > Show Desktop
    await shot('shell-reopened')(await s.snap());
  },
  async 'clip-shell'(s) {
    const c = new Clip('shell');
    await boot(s);
    c.add(await s.frames(20, EVERY));
    c.add(await menu(s, 20, 3, { rec: EVERY, hold: 20 }));          // Leap > Calculator
    c.add(await s.frames(50, EVERY));
    c.add(await quit(s, { rec: EVERY }));
    c.add(await s.dblclick(...ICON.paint, { rec: EVERY }));
    c.add(await s.frames(40, EVERY));
    c.add(await quit(s, { rec: EVERY }));
    c.add(await s.drag(200, 28, 250, 80, { rec: EVERY }));
    c.add(await s.frames(30, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ Calculator
  async calc(s) {
    await boot(s); await launch(s, 'calc');
    await shot('calc-open')(await s.snap());
    for (const [c, r] of CALC_1234) await s.click(...calcBtn(c, r), { hold: 4, rel: 6 });
    await shot('calc-result')(await s.snap());
    await s.key('c', { code: 'KeyC', vk: 67 }); await s.frames(10);
    await s.type('7'); await s.type('.'); await s.type('5'); await s.frames(8);   // the keyboard works too
    await shot('calc-keys')(await s.snap());
  },
  async 'clip-calc'(s) {
    const c = new Clip('calc');
    await boot(s); c.add(await launch(s, 'calc', { rec: EVERY }));
    c.add(await s.frames(15, EVERY));
    for (const [x, y] of CALC_1234) c.add(await s.click(...calcBtn(x, y), { hold: 4, rel: 8, rec: EVERY, step: 20 }));
    c.add(await s.frames(40, EVERY));
    c.add(await s.click(...calcBtn(0, 0), { rec: EVERY, step: 20 }));      // C
    c.add(await s.frames(20, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ Key Caps
  async keycaps(s) {
    await boot(s); await launch(s, 'keycaps');
    await shot('keycaps-open')(await s.snap());
    await s.key('h', { code: 'KeyH', vk: 72, hold: 20, rel: 0 }); await shot('keycaps-h')(await s.snap()); await s.frames(10);
    await s.key('w', { code: 'KeyW', vk: 87, shift: true, hold: 40, rel: 0 }); await shot('keycaps-caps')(await s.snap());
    await s.frames(10);
    await s.key('a', { code: 'KeyA', vk: 65, ctrl: true, hold: 40, rel: 0 }); await shot('keycaps-symbol')(await s.snap());
  },
  async 'clip-keycaps'(s) {
    const c = new Clip('keycaps');
    await boot(s); c.add(await launch(s, 'keycaps', { rec: EVERY }));
    c.add(await s.frames(15, EVERY));
    for (const ch of 'leap') c.add(await s.key(ch, { code: 'Key' + ch.toUpperCase(), vk: ch.toUpperCase().charCodeAt(0), hold: 14, rel: 8, rec: EVERY }));
    c.add(await s.key('a', { code: 'KeyA', vk: 65, shift: true, hold: 30, rel: 8, rec: EVERY }));
    c.add(await s.key('a', { code: 'KeyA', vk: 65, ctrl: true, hold: 30, rel: 8, rec: EVERY }));
    c.add(await s.frames(20, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ Notepad
  async notepad(s) {
    await boot(s); await launch(s, 'notepad');
    await shot('notepad-open')(await s.snap());
    await s.type('Dear desktop,', { hold: 3, rel: 2 }); await press(s, 'enter'); await s.type('hello from the TS2068. It has windows, menus and a mouse.', { hold: 3, rel: 2 });
    await s.frames(10); await shot('notepad-typed')(await s.snap());
    await s.dblclick(150, 44); await s.frames(10); await shot('notepad-word')(await s.snap());   // double-click a word
    await menu(s, 60, null, { shotFn: shot('notepad-edit-menu') }); await s.buttons(0xFF); await s.frames(10);
    await menu(s, 60, 7); await s.frames(15); await shot('notepad-find')(await s.snap());
    await press(s, 'esc'); await s.frames(15);
    await menu(s, 24, null, { shotFn: shot('notepad-file-menu') }); await s.buttons(0xFF); await s.frames(10);
    await menu(s, 24, 3); await s.frames(15); await shot('notepad-save')(await s.snap());
  },
  async 'clip-notepad'(s) {
    const c = new Clip('notepad');
    await boot(s); c.add(await launch(s, 'notepad', { rec: EVERY }));
    c.add(await s.frames(10, EVERY));
    c.add(await s.type('A desktop for the TS2068.', { hold: 3, rel: 2, rec: EVERY }));
    c.add(await press(s, 'enter', { rec: EVERY, hold: 3, rel: 2 }));
    c.add(await s.type('Windows, menus, a mouse.', { hold: 3, rel: 2, rec: EVERY }));
    c.add(await s.frames(20, EVERY));
    c.add(await s.dblclick(70, 44, { rec: EVERY, step: 20 }));              // select a word
    c.add(await s.frames(30, EVERY));
    c.add(await menu(s, 60, null, { rec: EVERY, hold: 30 })); c.add(await s.frames(2, EVERY));
    await s.buttons(0xFF); c.add(await s.frames(20, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ Paint
  async paint(s) {
    await boot(s); await launch(s, 'paint');
    await shot('paint-open')(await s.snap());
    await paintPicture(s, null);
    await shot('paint-picture')(await s.snap());
    await menu(s, 24, null, { shotFn: shot('paint-file-menu') }); await s.buttons(0xFF); await s.frames(10);
    await menu(s, 105, null, { shotFn: shot('paint-options-menu') }); await s.buttons(0xFF); await s.frames(10);
  },
  async 'clip-paint'(s) {
    const c = new Clip('paint');
    await boot(s); c.add(await launch(s, 'paint', { rec: EVERY }));
    c.add(await s.frames(10, EVERY));
    await paintPicture(s, c);
    c.add(await s.frames(30, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ Puzzle
  async puzzle(s) {
    await boot(s); await launch(s, 'puzzle');
    await shot('puzzle-open')(await s.snap());
    await playPuzzle(s, null, 12);
    await shot('puzzle-played')(await s.snap());
  },
  async 'clip-puzzle'(s) {
    const c = new Clip('puzzle');
    await boot(s); c.add(await launch(s, 'puzzle', { rec: EVERY }));
    c.add(await s.frames(15, EVERY));
    await playPuzzle(s, c, 10);
    c.add(await s.frames(20, EVERY));
    c.done();
  },
  // ------------------------------------------------------------------ the browser page itself (a real page screenshot)
  async webpage(s) {
    await boot(s); await s.frames(30);
    await s.evaluate('(window.leapG.paused = false, true)');               // hand the machine back to the page's own loop
    await new Promise((r) => setTimeout(r, 1500));
    const save = async (name, clip) => {
      const r = await s.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  shot', name);
    };
    await save('page-open');
    await s.evaluate("(document.getElementById('mouse').click(), true)");   // tick Mouse
    await new Promise((r) => setTimeout(r, 400));
    await save('page-mouse');
  },
};
export { scenarios, boot, menu, launch, quit, press, shot, Clip, EVERY, ICON, calcBtn, menuItem, KEY };

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const want = process.argv.slice(2);
  const names = want.length ? want : Object.keys(scenarios);
  for (const n of names) {
    if (!scenarios[n]) { console.error('no scenario', n); process.exit(2); }
    console.log('scenario', n);
    const s = await startSession(n === 'webpage' ? { width: 1100, height: 640 } : {});
    try { await scenarios[n](s); if (s.errors.length) console.log('  page errors:', s.errors); }
    finally { await s.close(); }
  }
}
