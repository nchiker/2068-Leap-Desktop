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
 * keyboard: TS2068 keys through tsrun/keyboard.js, always (owner, 2026-11-12: the TS2068 joystick is not mapped to keys).
 * Joysticks 1 and 2 come from connected gamepads (tsrun/joystick.js, polled every animation frame). Sound is on (starts on
 * first click/key).
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
import { initJoysticks, pollJoysticks, padLabel } from '../tsrun/joystick.js';
import { createFileHost } from './fshost.js';

const TSRUN = new URL('../tsrun/', import.meta.url);
const FPS = cpuHz / tStatesPerFrame, FRAME_MS = 1000 / FPS;
const $ = (id) => document.getElementById(id);
const hex = (v) => '$' + v.toString(16).toUpperCase().padStart(2, '0');

const keyMatrix = new Uint8Array(8).fill(0x1F);
const joystick = new Uint8Array(2).fill(0xFF);
initJoysticks(joystick);
const padIds = ['', ''];
const m = createMachine(keyMatrix, joystick);
const kbd = initKeyboard($('screen'), keyMatrix);   // no .keyboard-face inside: no onscreen board, just the key map
const app = { m, host: null, gfx: null, sfx: null, frames: 0, paused: false, cart: 'none', lastNow: 0, carryMs: 0, error: '' };
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

// Whole-number scaling (owner, 2026-11-13).  TSRun's resizeScreen fills the slot at any size, so a frame pixel can be 1 or 2
// display pixels wide in turn, and a one-pixel dither (the desk's grey, docs/LOOK.md) shows moire stripes.  fitScreen lets it
// fit first (it records the pixel ratio), then sets the buffer to k x 640 by k x 480 display pixels (TSRun's 640 x 240 frame,
// rows doubled for 4:3), k the largest whole number that fits the slot (at least 1): every frame pixel is k by 2k pixels.
const FRAME_W = 640, VIEW_H = 480;
function fitScreen(gfx) {
  resizeScreen(gfx);
  const canvas = gfx.gl.canvas, slot = canvas.parentElement, cs = getComputedStyle(slot), dpr = window.devicePixelRatio;
  const w = (slot.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) * dpr;
  const h = (slot.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) * dpr;
  const k = Math.max(1, Math.floor(Math.min(w / FRAME_W, h / VIEW_H)));
  if (canvas.width !== FRAME_W * k) canvas.width = FRAME_W * k;
  if (canvas.height !== VIEW_H * k) canvas.height = VIEW_H * k;
  canvas.style.width = `${(FRAME_W * k) / dpr}px`;
  canvas.style.height = `${(VIEW_H * k) / dpr}px`;
  gfx.gl.viewport(0, 0, FRAME_W * k, VIEW_H * k);
}

function onFrame(now) {
  requestAnimationFrame(onFrame);
  if (app.lastNow === 0) { app.lastNow = now; app.carryMs = FRAME_MS; }
  app.carryMs += Math.min(now - app.lastNow, 80);   // a backgrounded tab does not fast-forward on return
  app.lastNow = now;
  for (let ran = 0; app.carryMs >= FRAME_MS && ran < 4; ran++) { step(); app.carryMs -= FRAME_MS; }
  pollJoysticks(joystick, padIds);                   // gamepads only: keys never drive the joystick
  $('joy').textContent = padIds[0] ? `joystick: ${padLabel(padIds[0])}` : 'joystick: no gamepad';
  if (app.gfx) {
    const g = app.gfx;
    if (g.pixelRatio !== window.devicePixelRatio || g.gl.canvas.width % FRAME_W) fitScreen(g);   // a zoom, a monitor change, a lost context
    drawScreen(g, m.pixels);
  }
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
const screen = $('screen');
screen.addEventListener('keydown', (e) => { if (app.sfx) resumeSound(app.sfx); handleKeyDown(kbd, e); });
screen.addEventListener('keyup', (e) => handleKeyUp(kbd, e));
screen.addEventListener('blur', () => handleBlur(kbd));
screen.addEventListener('pointerdown', () => { screen.focus(); if (app.sfx) resumeSound(app.sfx); });

// Kempston mouse (docs/WINDOWS.md 15.1): with Mouse on, a click on the screen captures the host mouse (pointer lock; Esc
// releases it). Host motion becomes counter steps of one TS2068 pixel (x: 640 frame columns across the canvas, of which 512
// are the screen; y: 240 frame rows, 192 the screen), y inverted; the left / right / middle buttons are bits 1 / 0 / 2, low.
const mouse = { fx: 0, fy: 0 };
const mouseOn = () => $('mouse').checked;
function setMouse() {
  m.mouse.attached = mouseOn();
  m.mouse.buttons = 0xFF;
  if (!mouseOn() && document.pointerLockElement === screen) document.exitPointerLock();
}
const MOUSE_BIT = [0x02, 0x04, 0x01];                 // event.button 0 left, 1 middle, 2 right
screen.addEventListener('pointermove', (e) => {
  if (!mouseOn() || document.pointerLockElement !== screen) return;
  const r = screen.getBoundingClientRect();
  mouse.fx += e.movementX * 640 / r.width;
  mouse.fy += e.movementY * 240 / r.height;
  const dx = Math.trunc(mouse.fx), dy = Math.trunc(mouse.fy);
  mouse.fx -= dx; mouse.fy -= dy;
  m.mouse.x = (m.mouse.x + dx) & 0xFF;
  m.mouse.y = (m.mouse.y - dy) & 0xFF;
});
screen.addEventListener('mousedown', (e) => {
  if (!mouseOn()) return;
  if (document.pointerLockElement !== screen) { screen.requestPointerLock(); return; }
  m.mouse.buttons &= ~(MOUSE_BIT[e.button] ?? 0);
  e.preventDefault();
});
screen.addEventListener('mouseup', (e) => { if (mouseOn()) m.mouse.buttons |= MOUSE_BIT[e.button] ?? 0; });
screen.addEventListener('contextmenu', (e) => { if (mouseOn()) e.preventDefault(); });
document.addEventListener('pointerlockchange', () => { if (document.pointerLockElement !== screen) m.mouse.buttons = 0xFF; });
$('mouse').addEventListener('change', () => { setMouse(); screen.focus(); });
setMouse();                                           // the browser may restore the switch on reload

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

// ── Files (docs/FILES.md 4): the host that answers the desktop's FS_ calls on the bridge ports $6F / $6D ──
// Pick: the browser's file picker (input.showPicker); when the browser refuses it (no user activation), a bar asks for a click.
// Save: a download of the closed file (as Leap-IDE's download()).
const fspick = $('fspick'), fsbar = $('fsbar');
let pickAnswer = null;                                // answer(name, bytes) of the pick in progress, or null

function finishPick(name, bytes) {
  const answer = pickAnswer;
  pickAnswer = null;
  fsbar.hidden = true;
  if (answer) answer(name, bytes);
}
function showPicker() {
  try { fspick.showPicker(); return true; } catch { return false; }
}
function download(name, bytes, binary) {
  const url = URL.createObjectURL(new Blob([bytes], { type: binary ? 'application/octet-stream' : 'text/plain' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
app.host = m.host = createFileHost({
  pick(answer) {
    pickAnswer = answer;
    fspick.value = '';
    if (!showPicker()) fsbar.hidden = false;
  },
  cancelPick() { pickAnswer = null; fsbar.hidden = true; },   // the native picker cannot be closed: a later change is ignored
  saved: download,
});
fspick.addEventListener('change', async () => {
  const mine = pickAnswer, f = fspick.files[0];
  if (!mine || !f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  fspick.value = '';                                  // the same file can be chosen again
  if (pickAnswer === mine) finishPick(f.name, bytes);
});
fspick.addEventListener('cancel', () => { if (pickAnswer) finishPick(null); screen.focus(); });
$('fschoose').onclick = () => { showPicker(); screen.focus(); };
$('fscancel').onclick = () => { finishPick(null); screen.focus(); };

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
    fitScreen(gfx);
  });
  new ResizeObserver(() => { if (app.gfx) fitScreen(app.gfx); }).observe($('slot'));
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
