"use strict";
/*
 * Leap Desktop browser test page: runs a LeapG cartridge (.dck) on TSRun, the
 * TS2068 emulator in ../tsrun/, in a canvas. Modelled on Leap-IDE's src/emulator.js.
 *
 * Serve from the LeapG root and open the page:
 *   node tools/build.mjs                     # builds build/<name>.dck
 *   python3 -m http.server 8080
 *   http://localhost:8080/web/               # ?cart=<name> picks build/<name>.dck (default hello)
 * "Load .dck" opens any cartridge file instead. Click the screen to give it the
 * keyboard: TS2068 keys through tsrun/keyboard.js; with Joystick on, the arrow
 * keys and Space drive joystick 1 instead. Sound is on (starts on first click/key).
 *
 * Planned next feature: tapes (loading .tap files into TSRun).
 */
import {
  createMachine, setHomeRom, setExRom, resetMachine, runFrame, enableSound, setSoundRate, takeAudio,
  cpuHz, tStatesPerFrame, homeRomSize, exRomSize, insertDock,
} from '../tsrun/machine.js';
import { initScreen, resizeScreen, drawScreen } from '../tsrun/screen.js';
import {
  initSound, resumeSound, soundWantsFrame, soundIsRunning, setSoundNeedCallback, setSoundStateCallback, pushSound,
} from '../tsrun/sound.js';
import { initKeyboard, handleKeyDown, handleKeyUp, handleBlur } from '../tsrun/keyboard.js';

const TSRUN = new URL('../tsrun/', import.meta.url);
const FPS = cpuHz / tStatesPerFrame, FRAME_MS = 1000 / FPS;
const $ = (id) => document.getElementById(id);
const hex = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');

// Joystick 1 is active low: bit 0 up, 1 down, 2 left, 3 right, 7 fire.
const JOY_BITS = { ArrowUp: 0x01, ArrowDown: 0x02, ArrowLeft: 0x04, ArrowRight: 0x08, Space: 0x80 };

const keyMatrix = new Uint8Array(8).fill(0x1F);
const joystick = new Uint8Array(2).fill(0xFF);
const m = createMachine(keyMatrix, joystick);
const kbd = initKeyboard($('screen'), keyMatrix);   // no .keyboard-face inside: no onscreen board, just the key map
const app = { m, gfx: null, sfx: null, frames: 0, paused: false, cart: 'none', lastNow: 0, carryMs: 0, error: '' };
window.leapG = app;                                   // for tests and the console

async function fetchBytes(url, size) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length !== size) throw new Error(`${url}: ${b.length} bytes, expected ${size}`);
  return b;
}

/** Stock TS2068 ROMs plus this cartridge, then a reset. */
function insertCart(bytes, name) {
  const err = insertDock(m, bytes);
  if (err !== null) throw new Error(`Not a cartridge the TS2068 can take: ${err}`);
  app.cart = name;
  $('cart').textContent = name;
  reset();
}

function reset() {
  joystick.fill(0xFF);
  held.clear();
  resetMachine(m);
  app.frames = 0;
}

// ── Frame loop (after Leap-IDE emulator.js onFrame / stepMachine) ──
function step() {
  if (app.paused) return;
  enableSound(m, app.sfx !== null && soundIsRunning(app.sfx));
  runFrame(m);
  app.frames++;
  const chunk = takeAudio(m);
  if (chunk.n > 0 && app.sfx && soundIsRunning(app.sfx)) pushSound(app.sfx, chunk);
}

function onFrame(now) {
  requestAnimationFrame(onFrame);
  if (app.lastNow === 0) { app.lastNow = now; app.carryMs = FRAME_MS; }
  app.carryMs += Math.min(now - app.lastNow, 80);   // a backgrounded tab does not fast-forward on return
  app.lastNow = now;
  for (let ran = 0; app.carryMs >= FRAME_MS && ran < 4; ran++) { step(); app.carryMs -= FRAME_MS; }
  if (app.gfx) drawScreen(app.gfx, m.pixels);
  $('status').textContent = app.error ||
    `frames ${app.frames}  $F4=${hex(m.portF4)}  $FF=${hex(m.portFF)}${app.paused ? '  paused' : ''}`;
}

// The audio worklet asks for frames when its queue runs low; they count against the wall-clock budget.
function fillSoundQueue() {
  if (!app.sfx || !soundIsRunning(app.sfx) || app.paused) return;
  for (let ran = 0; ran < 4 && soundWantsFrame(app.sfx); ran++) {
    step();
    app.carryMs = Math.max(app.carryMs - FRAME_MS, -4 * FRAME_MS);
  }
}

// ── Input ──
const held = new Set();                               // joystick keys held (event.code)
const joyOn = () => $('joy').checked;
function setJoy(e, down) {
  const bit = JOY_BITS[e.code];
  if (bit === undefined) return false;
  e.preventDefault();
  if (down) held.add(e.code); else held.delete(e.code);
  let v = 0xFF;
  for (const c of held) v &= ~JOY_BITS[c];
  joystick[0] = v;
  return true;
}
const screen = $('screen');
screen.addEventListener('keydown', (e) => { if (app.sfx) resumeSound(app.sfx); if (!(joyOn() && setJoy(e, true))) handleKeyDown(kbd, e); });
screen.addEventListener('keyup', (e) => { if (!(joyOn() && setJoy(e, false))) handleKeyUp(kbd, e); });
screen.addEventListener('blur', () => { handleBlur(kbd); held.clear(); joystick[0] = 0xFF; });
screen.addEventListener('pointerdown', () => { screen.focus(); if (app.sfx) resumeSound(app.sfx); });
$('joy').addEventListener('change', () => { held.clear(); joystick[0] = 0xFF; handleBlur(kbd); screen.focus(); });

// ── Controls ──
$('reset').onclick = () => { reset(); screen.focus(); };
$('pause').onclick = () => { app.paused = !app.paused; $('pause').textContent = app.paused ? 'Run' : 'Pause'; screen.focus(); };
$('load').onclick = () => $('file').click();
$('file').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { insertCart(new Uint8Array(await f.arrayBuffer()), f.name); app.error = ''; } catch (err) { app.error = String(err.message ?? err); }
  e.target.value = '';
  screen.focus();
};

// ── Start ──
async function start() {
  const name = new URLSearchParams(location.search).get('cart') ?? 'hello';
  const [home, exrom, vert, frag, dck] = await Promise.all([
    fetchBytes(new URL('roms/ts2068-0.rom', TSRUN), homeRomSize),
    fetchBytes(new URL('roms/ts2068-1.rom', TSRUN), exRomSize),
    fetch(new URL('screen.vert.glsl', TSRUN)).then((r) => r.text()),
    fetch(new URL('screen.frag.glsl', TSRUN)).then((r) => r.text()),
    fetch(new URL(`../build/${encodeURIComponent(name)}.dck`, import.meta.url)).then((r) => {
      if (!r.ok) throw new Error(`build/${name}.dck: ${r.status} (run node tools/build.mjs)`);
      return r.arrayBuffer();
    }),
  ]);
  const err = setHomeRom(m, home) ?? setExRom(m, exrom);
  if (err) throw new Error(err);
  insertCart(new Uint8Array(dck), `${name}.dck`);

  initScreen(screen, { vert, frag }, (e, gfx) => {
    if (e !== null || gfx === null) { app.error = e ?? 'No graphics context'; return; }
    app.gfx = gfx;
    resizeScreen(gfx);
  });
  new ResizeObserver(() => { if (app.gfx) resizeScreen(app.gfx); }).observe($('slot'));
  initSound(FPS, (e, sfx) => {
    if (e !== null || sfx === null) { console.warn('no sound:', e); return; }
    app.sfx = sfx;
    setSoundNeedCallback(sfx, fillSoundQueue);
    setSoundRate(m, sfx.context.sampleRate);
    setSoundStateCallback(sfx, (running) => enableSound(m, running));
    enableSound(m, soundIsRunning(sfx));
  });
  requestAnimationFrame(onFrame);
  screen.focus();
}
start().catch((e) => { app.error = String(e.message ?? e); $('status').textContent = app.error; });
