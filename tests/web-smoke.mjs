"use strict";
// web-smoke.mjs -- loads web/ in headless Chrome (served from this repo by a throwaway static server), waits ~200
// frames and checks the status line ($FF = $06 for the hello cartridge), the keyboard, and that keys never drive the joystick.
//   node tests/web-smoke.mjs [outdir]       Chrome: $CHROME, else Playwright's headless shell in ~/.cache/ms-playwright,
//                                           else google-chrome / chromium on the PATH. Needs Node 22+ (global WebSocket).
// Same server / Chrome / CDP pattern as Leap-IDE's tests/browser-lib.mjs, which serves its own root, so it is not imported.
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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

// ── Files (docs/FILES.md 4.2, 8.4): the host on the bridge ports. Driven from the page through m.bus.ioWrite / ioRead as
// the Z80 would; the Write-driven rows wait for W3.
await evaluate(`(window.__fs = (() => {
  const m = leapG.m, W = (p, v) => m.bus.ioWrite(p, v), R = (p) => m.bus.ioRead(p);
  return {
    send(n, bytes = []) { W(0x6F, n); for (const b of bytes) W(0x6D, b); },
    status() { return R(0x6F); },
    take(n) { const r = []; for (let i = 0; i < n; i++) r.push(R(0x6D)); return r; },
  };
})(), true)`);
check('files: the page attached a host (leapG.host is m.host)', await evaluate('leapG.host !== null && leapG.host === leapG.m.host'));
check('files: ports read idle (status 0) at the start', (await evaluate('__fs.status()')) === 0);

// (a) a save: open write text "t.txt", write "ab\rc", close: the browser downloads "ab\nc" as t.txt.
const dlDir = mkdtempSync(join(tmpdir(), 'leapg-dl-'));
const dl = await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
check('files: download behaviour set (CDP)', !dl.error, JSON.stringify(dl.error ?? ''));
const st = await evaluate(`(() => {
  __fs.send(2, [1, 5, ...Array.from('t.txt', (c) => c.charCodeAt(0))]); const open = __fs.status(); __fs.take(2);
  __fs.send(4, [4, 0, 97, 98, 13, 99]); const wr = __fs.status();
  __fs.send(5); const cl = __fs.status();
  return [open, wr, cl];
})()`);
check('files: save: open, write, close all answer 1', JSON.stringify(st) === '[1,1,1]', JSON.stringify(st));
let got = null;
for (const end = Date.now() + 10000; Date.now() < end; await sleep(100)) {
  const f = readdirSync(dlDir).filter((n) => !n.endsWith('.crdownload') && !n.endsWith('.tmp'));
  if (f.includes('t.txt')) { got = readFileSync(join(dlDir, 't.txt')); break; }
}
check('files: save: the browser downloaded t.txt', got !== null, readdirSync(dlDir).join(','));
check('files: save: the bytes are "ab\\nc" (CR became LF)', got !== null && got.equals(Buffer.from('ab\nc')), got ? JSON.stringify(got.toString('latin1')) : '');
// A binary save keeps every byte.
await evaluate(`(() => { __fs.send(2, [3, 5, ...Array.from('b.bin', (c) => c.charCodeAt(0))]); __fs.take(2); __fs.send(4, [4, 0, 13, 10, 0, 255]); __fs.send(5); return true; })()`);
let bin = null;
for (const end = Date.now() + 10000; Date.now() < end; await sleep(100)) {
  if (readdirSync(dlDir).includes('b.bin')) { bin = readFileSync(join(dlDir, 'b.bin')); break; }
}
check('files: binary save: bytes 0D 0A 00 FF kept', bin !== null && bin.equals(Buffer.from([13, 10, 0, 255])), bin ? bin.toString('hex') : '');

// (b) a pick when showPicker throws: the bar appears; Cancel answers 12 and hides it.
await evaluate(`(() => { HTMLInputElement.prototype.showPicker = function () { throw new DOMException('no activation', 'NotAllowedError'); }; return true; })()`);
const barVisible = `(() => { const b = document.getElementById('fsbar'); return !b.hidden && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().height > 0; })()`;
check('files: the bar is hidden before a pick', !(await evaluate(barVisible)));
await evaluate(`__fs.send(1)`);
check('files: pick: busy bit set', ((await evaluate('__fs.status()')) & 0x80) !== 0);
check('files: pick with showPicker refused: #fsbar visible', await evaluate(barVisible));
check('files: the bar names Write and has Choose and Cancel', await evaluate(`(() => { const b = document.getElementById('fsbar'); return /Write wants a file/.test(b.textContent) && !!b.querySelector('#fschoose') && !!b.querySelector('#fscancel'); })()`));
await evaluate(`document.getElementById('fschoose').click()`);
check('files: Choose (picker still refused): the bar stays, still busy', (await evaluate(barVisible)) && ((await evaluate('__fs.status()')) & 0x80) !== 0);
await evaluate(`document.getElementById('fscancel').click()`);
check('files: Cancel: status 12, not busy', (await evaluate('__fs.status()')) === 12);
check('files: Cancel: the bar is hidden', !(await evaluate(barVisible)));
check('files: Cancel: the screen has the keyboard focus back', await evaluate(`document.activeElement === document.getElementById('screen')`));

// A pick answered through the native input (CDP sets the files, so "change" fires): the file is read and named.
const pickFile = join(dlDir, 'pick me.txt');
writeFileSync(pickFile, Buffer.from('one\r\ntwo\tx', 'latin1'));
await evaluate(`(() => { HTMLInputElement.prototype.showPicker = function () { window.__pickerOpened = true; }; return true; })()`);
await evaluate(`__fs.send(1)`);
check('files: pick with the picker accepted: busy, bar stays hidden', ((await evaluate('__fs.status()')) & 0x80) !== 0 && !(await evaluate(barVisible)) && (await evaluate('window.__pickerOpened')) === true);
const doc = await send('DOM.getDocument', {});
const node = await send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '#fspick' });
await send('DOM.setFileInputFiles', { files: [pickFile], nodeId: node.result.nodeId });
check('files: pick: the chosen file answers 1', !!(await waitFor('(__fs.status() & 0x80) === 0 && __fs.status() === 1', 5000)), `status ${await evaluate('__fs.status()')}`);
const nm = await evaluate(`(() => { const [n] = __fs.take(1); return [n, String.fromCharCode(...__fs.take(n))]; })()`);
check('files: pick: the name "pick me.txt" comes back (length byte, then codes)', nm[0] === 11 && nm[1] === 'pick me.txt', JSON.stringify(nm));
const rd = await evaluate(`(() => {
  __fs.send(2, [0, 11, ...Array.from('pick me.txt', (c) => c.charCodeAt(0))]); const s = __fs.status(); const len = __fs.take(2);
  __fs.send(3, [100, 0]); const s2 = __fs.status(); const cnt = __fs.take(2); const data = __fs.take(cnt[0] | (cnt[1] << 8));
  __fs.send(5); return [s, len, s2, data];
})()`);
check('files: pick: the picked file opens, text-converted (CR LF -> CR, TAB -> space)', rd[0] === 1 && rd[1][0] === 9 && rd[2] === 1 && String.fromCharCode(...rd[3]) === 'one\rtwo x', JSON.stringify(rd));
// The input's own "cancel" event answers 12; a change after an abort is ignored.
await evaluate(`__fs.send(1)`);
await evaluate(`document.getElementById('fspick').dispatchEvent(new Event('cancel'))`);
check('files: the picker\'s cancel event answers 12', (await evaluate('__fs.status()')) === 12);
await evaluate(`__fs.send(1)`);
await evaluate(`__fs.send(0)`);
check('files: abort during a pick: status 12 and the bar hidden', (await evaluate('__fs.status()')) === 12 && !(await evaluate(barVisible)));
await send('DOM.setFileInputFiles', { files: [pickFile], nodeId: node.result.nodeId });
await sleep(300);
check('files: a change after an abort is ignored (status stays 12)', (await evaluate('__fs.status()')) === 12);
// Abort while the bar is showing hides it (cancelPick).
await evaluate(`(() => { HTMLInputElement.prototype.showPicker = function () { throw new DOMException('x', 'NotAllowedError'); }; return true; })()`);
await evaluate(`__fs.send(1)`);
const shown = await evaluate(barVisible);
await evaluate(`__fs.send(0)`);
check('files: an abort hides the bar', shown && !(await evaluate(barVisible)));

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(outDir, 'web-smoke.png'), Buffer.from(shot.result.data, 'base64'));
check('no page errors', pageErrors.length === 0, pageErrors.join(' | '));

ws.close(); chrome.kill(); server.close();
console.log(`\nScreenshot in ${outDir}`);
console.log(failed ? `${failed} check(s) FAILED` : 'All checks passed');
process.exit(failed ? 1 : 0);
