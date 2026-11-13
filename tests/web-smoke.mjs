"use strict";
// web-smoke.mjs -- loads web/ in headless Chrome (served from this repo by a throwaway static server), waits ~200
// frames and checks the status line ($FF = $06 for the hello cartridge), the keyboard, and that keys never drive the joystick.
//   node tests/web-smoke.mjs [outdir]       Chrome: $CHROME, else Playwright's headless shell in ~/.cache/ms-playwright,
//                                           else google-chrome / chromium on the PATH. Needs Node 22+ (global WebSocket).
// Same server / Chrome / CDP pattern as Leap-IDE's tests/browser-lib.mjs, which serves its own root, so it is not imported.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'leapg-web-'));
mkdirSync(outDir, { recursive: true });

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

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.glsl': 'text/plain', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try {
    const file = path.endsWith('/') ? path + 'index.html' : path;
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(join(ROOT, file)));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'leapg-prof-'))}`,
  '--headless', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 100 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let msgId = 0; const waiting = new Map(), pageErrors = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') pageErrors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') pageErrors.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++msgId; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async () => (${expr}))()`, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return r.result.result.value;
};
async function waitFor(expr, ms = 20000) {
  for (const end = Date.now() + ms; ; await sleep(100)) {
    const v = await evaluate(expr).catch(() => null);
    if (v || Date.now() > end) return v;
  }
}
let failed = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`); if (!ok) failed++; };
const keyEv = (type, key, code, vk) => send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk });

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Page.navigate', { url: base + 'web/' });

const frames = await waitFor('window.leapG && window.leapG.frames >= 200 && window.leapG.frames');
check('runs 200+ frames', !!frames, `frames ${frames}`);
const status = await evaluate(`document.getElementById('status').textContent`);
check('status shows $FF = $06 (mode 6)', /\$FF=\$06\b/.test(status), status);
check('cartridge name shown', (await evaluate(`document.getElementById('cart').textContent`)) === 'hello.dck');
const lit = await evaluate(`(() => { const p = leapG.m.pixels; let n = 0; for (let i = 0; i < p.length; i++) if (p[i] !== p[0]) n++; return n; })()`);
check('frame buffer has text on it', lit > 100, `${lit} pixels differ from the background`);

// Keys never drive the joystick (owner, 2026-11-12): Space and the arrows reach the key matrix; joystick 1 stays idle with
// no gamepad (it comes from the Gamepad API only).
await evaluate(`document.getElementById('screen').focus()`);
await keyEv('rawKeyDown', ' ', 'Space', 32);
await sleep(50);
check('Space: SPACE pressed in matrix (row 7 bit 0), joystick idle', ((await evaluate('leapG.m.keyMatrix[7]')) & 1) === 0 && (await evaluate('leapG.m.joystick[0]')) === 0xFF);
await keyEv('keyUp', ' ', 'Space', 32);
check('joystick shows no gamepad', /no gamepad/.test(await evaluate(`document.getElementById('joy').textContent`)));

// A letter key reaches the keyboard matrix (A = row 1, bit 0).
await keyEv('rawKeyDown', 'a', 'KeyA', 65);
await sleep(50);
check('keyboard: A pressed in matrix', ((await evaluate('leapG.m.keyMatrix[1]')) & 1) === 0);
await keyEv('keyUp', 'a', 'KeyA', 65);

// An arrow goes to the keyboard (CAPS SHIFT + 8 = row 0 bit 0, row 4 bit 2), never the joystick.
await keyEv('rawKeyDown', 'ArrowRight', 'ArrowRight', 39);
await sleep(50);
check('arrow goes to the keyboard', (await evaluate('leapG.m.joystick[0]')) === 0xFF && ((await evaluate('leapG.m.keyMatrix[4]')) & 4) === 0);
await keyEv('keyUp', 'ArrowRight', 'ArrowRight', 39);

// Pause stops the frame counter, Run resumes, Reset restarts it.
await evaluate(`document.getElementById('pause').click()`);
const f1 = await evaluate('leapG.frames'); await sleep(300);
check('pause holds the frame counter', (await evaluate('leapG.frames')) === f1);
await evaluate(`document.getElementById('pause').click()`);
await sleep(300);
check('run resumes', (await evaluate('leapG.frames')) > f1);
await evaluate(`document.getElementById('reset').click()`);
check('reset restarts the counter and reaches mode 6 again', !!(await waitFor(`leapG.frames > 100 && (leapG.m.portFF & 7) === 6`)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(outDir, 'web-smoke.png'), Buffer.from(shot.result.data, 'base64'));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

ws.close(); chrome.kill(); server.close();
console.log(`\nScreenshot in ${outDir}`);
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
