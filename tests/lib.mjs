"use strict";
// lib.mjs -- headless TSRun harness for Leap Desktop tests (the pattern of Leap-IDE's arcade/spike/xip/lib.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from '../tools/build.mjs';

const TSRUN = join(ROOT, 'tsrun');
import { bootedMachine, bootSkip } from './fast-boot.mjs';
export { bootSkip };
export const M = await import(pathToFileURL(join(TSRUN, 'machine.js')).href);
export const Z = await import(pathToFileURL(join(TSRUN, 'z80.js')).href);
export const FRAME_T = M.tStatesPerFrame;          // 58,688 on TSRun

// TSRun's frame buffer: 640 x 240 palette indices at the hi-res pixel clock; the 512 x 192 screen starts at (64, 24).
export const FRAME_W = 640, SCR_X0 = 64, SCR_Y0 = 24, SCR_W = 512, SCR_H = 192;

/**
 * TESTSPEED S1: turn screen drawing off. TSRun paints m.pixels every frame, even headless; with drawing off it only keeps the beam position, and
 * the T-states are the same (no memory contention). m.pixels then throws on any read or write, so a check that needs the picture fails loudly
 * instead of reading a stale buffer. The display RAM ($4000 / $6000) is unaffected.
 */
export function videoOff(m) {
  M.setVideoOn(m, false);
  const buf = m.pixels;
  // a plain data property (a getter would turn m into a slow dictionary-mode object): any read through it throws
  const trap = () => { throw new Error('m.pixels used with screen drawing off: boot with { video: true } (tests/lib.mjs videoOff)'); };
  m.pixels = new Proxy(new Uint8Array(0), { get: trap, set: trap, has: trap, getOwnPropertyDescriptor: trap });
  return buf;
}

// TESTSPEED S2 measure: TS_BOOTS=1 prints how many machines this process booted (and the frames it ran in total) when it exits.
export const bootStats = { boots: 0 };
if (process.env.TS_BOOTS === '1') { process.on('exit', () => console.error(`TS_BOOTS ${bootStats.boots}`)); process.on('SIGTERM', () => process.exit(143)); }

/** New stock TS2068 (stock ROMs) with the DCK inserted and reset. opts.video: false turns screen drawing off (videoOff); default true. */
export function boot(dck, opts = {}) {
  bootStats.boots++;
  // TESTSPEED S2: a machine with video off is restored from the process's shared ROM-boot snapshot (tests/fast-boot.mjs) unless TS_COLDBOOT=1;
  // bootSkip(m) is the number of boot frames it skipped (0 for a cold boot), so callers count frames from reset.
  if (opts.video === false && process.env.TS_COLDBOOT !== '1') {
    const m = bootedMachine(new Uint8Array(dck), { video: false });
    videoOff(m);
    return m;
  }
  const m = M.createMachine(new Uint8Array(9).fill(0x1F), new Uint8Array(2).fill(0xFF));
  const must = (e) => { if (e) throw new Error(e); };
  must(M.setHomeRom(m, new Uint8Array(readFileSync(join(TSRUN, 'roms/ts2068-0.rom')))));
  must(M.setExRom(m, new Uint8Array(readFileSync(join(TSRUN, 'roms/ts2068-1.rom')))));
  must(M.insertDock(m, new Uint8Array(dck)));
  M.resetMachine(m);
  if (opts.video === false) videoOff(m);
  return m;
}

/** Run whole frames until pred(m) holds after a frame; returns the frames run, or -1. */
export function runFramesUntil(m, pred, max = 400) {
  for (let f = 1; f <= max; f++) { M.runFrame(m); if (pred(m)) return f; }
  return -1;
}

/** Palette index shown at screen pixel (x 0..511, y 0..191) in the last rendered frame. */
export const screenPixel = (m, x, y) => m.pixels[(SCR_Y0 + y) * FRAME_W + SCR_X0 + x];

/** Write the 512 x 192 screen as a PGM image (ink dark, paper light) for looking at by eye. */
export function savePgm(m, path) {
  const head = `P5\n${SCR_W} ${SCR_H}\n255\n`;
  const out = new Uint8Array(head.length + SCR_W * SCR_H);
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i);
  let k = head.length;
  for (let y = 0; y < SCR_H; y++) for (let x = 0; x < SCR_W; x++) out[k++] = (screenPixel(m, x, y) & 7) * 36;
  writeFileSync(path, out);
}

/** The 96 glyphs of src/font.inc (codes 32..127), 8 bytes each. */
export function loadFont() {
  const bytes = [];
  for (const line of readFileSync(join(ROOT, 'src/font.inc'), 'utf8').split('\n')) {
    const m = line.match(/^\s*DB\s+([^;]*)/);
    if (m) for (const s of m[1].split(',')) bytes.push(parseInt(s.trim().replace('$', ''), 16));
  }
  return (code) => bytes.slice((code - 32) * 8, (code - 32) * 8 + 8);
}

/** Tiny check collector: check(name, ok, detail); done() prints a summary and sets the exit code. */
export function checks(title) {
  let pass = 0, fail = 0;
  return {
    check(name, ok, detail = '') {
      if (ok) pass++; else fail++;
      console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
    },
    done() {
      console.log(`${title}: ${pass} passed, ${fail} failed`);
      if (fail) process.exitCode = 1;
    },
  };
}
