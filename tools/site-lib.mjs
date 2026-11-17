"use strict";
// site-lib.mjs -- drives web/?cart=desk5 in headless Chrome for the website's screenshots and clips (tools/site-capture.mjs).
//   - serves the repo root on a throwaway port, starts ONE headless Chrome (this process owns it and kills only that process);
//   - pauses the page's own frame loop and steps the emulator frame by frame (runFrame from the page's own tsrun module), so
//     every clip is deterministic and the speed of the machine running this script does not matter;
//   - keys are REAL key events (CDP Input.dispatchKeyEvent) to the focused screen canvas, through the page's keyboard.js;
//   - the mouse: headless Chrome cannot take pointer lock, so the pointer is moved by writing the Kempston counters of the
//     emulator (m.mouse.x / y / buttons, the same fields web/main.js writes from host mouse motion);
//   - the picture is the emulator's own pixel buffer (m.pixels), the 512 x 192 screen cropped out of the 640 x 240 frame, 1 bit a pixel.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const W = 512, H = 192;

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const pw = join(homedir(), '.cache/ms-playwright');
  if (existsSync(pw)) {
    for (const d of readdirSync(pw).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse()) {
      const bin = join(pw, d, 'chrome-headless-shell-linux64/chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  for (const n of ['google-chrome', 'chromium', 'chromium-browser']) {
    try { return execSync(`command -v ${n}`).toString().trim(); } catch { /* not found */ }
  }
  throw new Error('No Chrome found: set CHROME=/path/to/chrome');
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.glsl': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.gif': 'image/gif', '.md': 'text/markdown' };

/** The symbols of build/desk5/out.sym (a prebuilt cartridge is needed: node tools/build.mjs desk5). */
export function loadSyms() {
  const S = {};
  for (const line of readFileSync(join(ROOT, 'build/desk5/out.sym'), 'utf8').split('\n')) {
    const m = /^(\w+): EQU 0x([0-9A-Fa-f]+)/.exec(line);
    if (m) S[m[1]] = parseInt(m[2], 16);
  }
  return S;
}

/** A 1-bit grayscale PNG (0 = ink = black) from a Uint8Array of W*H values 0 / 1 (1 = ink). */
export function pngOf(bits, w = W, h = H) {
  const stride = (w + 7) >> 3, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (!bits[y * w + x]) raw[y * (stride + 1) + 1 + (x >> 3)] |= 0x80 >> (x & 7);   // ink 1 -> pixel 0 (black)
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 1; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export async function startSession({ root = ROOT, page = 'web/?cart=desk5', width = 1280, height = 800 } = {}) {
  const S = loadSyms();
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    try {
      const file = path.endsWith('/') ? path + 'index.html' : path;
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
      res.end(await readFile(join(root, file)));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'leapg-site-'))}`,
    '--headless', '--mute-audio', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let closed = false;
  const closeAll = () => { if (closed) return; closed = true; try { chrome.kill('SIGKILL'); } catch { /* gone */ } try { server.close(); } catch { /* gone */ } };
  process.on('exit', closeAll);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { closeAll(); process.exit(130); });
  try {
    let targets;
    for (let i = 0; i < 100 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
    const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => { ws.onopen = r; });
    let msgId = 0; const waiting = new Map(), errors = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') errors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
    };
    const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
      return r.result.result.value;
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + page });
    for (const end = Date.now() + 30000; ; await sleep(100)) {
      if (await evaluate('!!(window.leapG && window.leapG.gfx && window.leapG.frames > 2)').catch(() => false)) break;
      if (Date.now() > end) throw new Error('the page did not start: ' + errors.join('; '));
    }
    // From here the page's own loop is paused and this script steps the machine.
    await evaluate(`(async () => {
      const app = window.leapG, m = app.m;
      app.paused = true;
      const T = await import('/tsrun/machine.js');
      const S = ${JSON.stringify({ K_PX: S.K_PX, K_PY: S.K_PY, K_PROG: S.K_PROG })};
      m.mouse.attached = true; m.mouse.buttons = 0xFF;
      window.__run = (n, every = 0) => {
        const out = [];
        for (let i = 1; i <= n; i++) { T.runFrame(m); if (every && i % every === 0) out.push(window.__snap()); }
        return out;
      };
      window.__snap = () => {
        const p = m.pixels, o = new Uint8Array(12288);
        for (let y = 0; y < 192; y++) for (let x = 0; x < 512; x++) if ((p[(24 + y) * 640 + 64 + x] & 7) === 0) o[(y * 512 + x) >> 3] |= 0x80 >> (x & 7);
        let s = ''; for (let i = 0; i < o.length; i += 4096) s += String.fromCharCode(...o.subarray(i, i + 4096));
        return btoa(s);
      };
      window.__ptr = () => [m.ram[S.K_PX] | (m.ram[S.K_PX + 1] << 8), m.ram[S.K_PY]];
      window.__prog = () => m.ram[S.K_PROG];
      window.__mouse = (dx, dy, buttons) => { m.mouse.x = (m.mouse.x + dx) & 0xFF; m.mouse.y = (m.mouse.y - dy) & 0xFF; if (buttons !== undefined) m.mouse.buttons = buttons; };
      document.getElementById('screen').focus();
      return true;
    })()`);

    const decode = (b64) => {                     // base64 1-bit -> Uint8Array(W*H) of 0 / 1 (1 = ink)
      const buf = Buffer.from(b64, 'base64'), out = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) out[i] = (buf[i >> 3] >> (7 - (i & 7))) & 1;
      return out;
    };
    const api = {
      S, errors, base, send, evaluate,
      /** Run n frames; returns the screens (every `every`-th frame) as Uint8Array(W*H) when every > 0. */
      async frames(n, every = 0) {
        const r = await evaluate(`window.__run(${n}, ${every})`);
        return every ? r.map(decode) : [];
      },
      async snap() { return decode(await evaluate('window.__snap()')); },
      ptr: () => evaluate('window.__ptr()'),
      /** n bytes of the machine's RAM at addr (reading only; used to choose legal Puzzle moves). */
      ram: (addr, n = 1) => evaluate(`Array.from(window.leapG.m.ram.subarray(${addr}, ${addr + n}))`),
      prog: () => evaluate('window.__prog()'),
      /** A real key press: down, `hold` frames, up, `rel` frames. `rec` > 0 records every rec-th frame; returns those screens. */
      async key(key, { code = key, vk = 0, text, hold = 4, rel = 4, shift = false, ctrl = false, rec = 0 } = {}) {
        const mods = (shift ? 8 : 0) | (ctrl ? 2 : 0);
        const out = [];
        if (shift) await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16, modifiers: 8 });
        if (ctrl) await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17, modifiers: 2 });
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers: mods });
        out.push(...await api.frames(hold, rec));
        await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers: mods });
        if (ctrl) await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Control', code: 'ControlLeft', windowsVirtualKeyCode: 17 });
        if (shift) await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16 });
        out.push(...await api.frames(rel, rec));
        return out;
      },
      /** Type a string of characters (letters, digits, space, and the punctuation the PC keys give). */
      async type(str, opts = {}) {
        const out = [];
        for (const ch of str) {
          const up = ch >= 'A' && ch <= 'Z', lc = ch.toLowerCase();
          let code, key = ch, shift = up;
          if (/[a-z]/i.test(ch)) code = 'Key' + ch.toUpperCase();
          else if (/[0-9]/.test(ch)) code = 'Digit' + ch;
          else if (ch === ' ') code = 'Space';
          else if (ch === '.') code = 'Period';
          else if (ch === ',') code = 'Comma';
          else if (ch === '\n') { code = 'Enter'; key = 'Enter'; }
          else if (ch === '-') code = 'Minus';
          else if (ch === '=') code = 'Equal';
          else if (ch === '/') code = 'Slash';
          else throw new Error(`type: no key for ${JSON.stringify(ch)}`);
          out.push(...await api.key(key, { code, shift, vk: ch === '\n' ? 13 : ch.toUpperCase().charCodeAt(0), text: ch === '\n' ? '\r' : ch, ...opts }));
        }
        return out;
      },
      /** Move the pointer to (x, y) in steps of at most `step` counts a frame (a real mouse arrives gradually). */
      async moveTo(tx, ty, { step = 12, rec = 0 } = {}) {
        const out = [];
        for (let i = 0; i < 200; i++) {
          const [px, py] = await api.ptr(), dx = tx - px, dy = ty - py;
          if (!dx && !dy) break;
          const sx = Math.max(-step, Math.min(step, dx)), sy = Math.max(-step, Math.min(step, dy));
          await evaluate(`window.__mouse(${sx}, ${sy})`);
          out.push(...await api.frames(1, rec));
        }
        return out;
      },
      async buttons(b) { await evaluate(`window.__mouse(0, 0, ${b})`); },
      /** Click (left button; 0xFD = left down): move, press, release. */
      async click(x, y, { hold = 3, rel = 6, rec = 0, step = 12 } = {}) {
        const out = await api.moveTo(x, y, { rec, step });
        await api.buttons(0xFD); out.push(...await api.frames(hold, rec));
        await api.buttons(0xFF); out.push(...await api.frames(rel, rec));
        return out;
      },
      async dblclick(x, y, opts = {}) { const a = await api.click(x, y, { hold: 3, rel: 6, ...opts }); const b = await api.click(x, y, { hold: 3, rel: 8, ...opts }); return [...a, ...b]; },
      /** Press at (x, y), move to (x2, y2) with the button down, release (a drag). */
      async drag(x, y, x2, y2, { rec = 0, step = 8 } = {}) {
        const out = await api.moveTo(x, y, { rec });
        await api.buttons(0xFD); out.push(...await api.frames(3, rec));
        out.push(...await api.moveTo(x2, y2, { rec, step }));
        out.push(...await api.frames(2, rec));
        await api.buttons(0xFF); out.push(...await api.frames(6, rec));
        return out;
      },
      /** Wait (in frames, at most max) until the pointer is parked and `pred` (page-side expression) is true. */
      async until(expr, max = 300) { for (let i = 0; i < max; i += 5) { if (await evaluate(expr)) return true; await api.frames(5); } return false; },
      async close() { try { ws.close(); } catch { /* gone */ } closeAll(); },
    };
    return api;
  } catch (e) { closeAll(); throw e; }
}

/** Write bits as a PNG file. */
export function savePng(path, bits) { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, pngOf(bits)); }
