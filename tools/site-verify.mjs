#!/usr/bin/env node
"use strict";
// site-verify.mjs -- checks the assembled site (default _site/) in headless Chrome: leap-desktop.html at 1280 and 390 px wide
// (every image loads after scrolling the whole page, every local link resolves, no horizontal scroll, no console errors), plus the
// technical document (/) and the live page (/web/?cart=desk5) still start. Writes screenshots to the directory given as argv[3].
//   node tools/site-verify.mjs [siteDir] [outDir]
import { spawn, execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, extname, normalize, resolve } from 'node:path';

const SITE = resolve(process.argv[2] ?? '_site'), OUT = resolve(process.argv[3] ?? join(tmpdir(), 'site-verify'));
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const pw = join(homedir(), '.cache/ms-playwright');
  for (const d of existsSync(pw) ? readdirSync(pw).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : []) {
    const bin = join(pw, d, 'chrome-headless-shell-linux64/chrome-headless-shell'); if (existsSync(bin)) return bin;
  }
  for (const n of ['google-chrome', 'chromium']) { try { return execSync(`command -v ${n}`).toString().trim(); } catch { /* none */ } }
  throw new Error('no Chrome');
}
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glsl': 'text/plain', '.png': 'image/png', '.gif': 'image/gif', '.dck': 'application/octet-stream' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  try { const f = path.endsWith('/') ? path + 'index.html' : path; res.writeHead(200, { 'Content-Type': TYPES[extname(f)] ?? 'application/octet-stream' }); res.end(await readFile(join(SITE, f))); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(findChrome(), [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'leapg-ver-'))}`, '--headless', '--mute-audio', '--no-sandbox',
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const closeAll = () => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } try { server.close(); } catch { /* gone */ } };
process.on('exit', closeAll);
let failed = 0;
const check = (n, ok, d = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -- ' + d : ''}`); if (!ok) failed++; };
try {
  let targets; for (let i = 0; i < 100 && !targets; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(100); } }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl); await new Promise((r) => { ws.onopen = r; });
  let id = 0; const waiting = new Map(); let errors = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push(`${m.params.entry.text} ${m.params.entry.url ?? ''}`); };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: `(async()=>(${e}))()`, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description); return r.result.result.value; };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const open = async (url, w, h) => { errors = []; await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 }); await send('Page.navigate', { url: base + url }); await sleep(1200); };
  const shot = async (name, full = false) => { const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full }); writeFileSync(join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); };

  for (const [w, h] of [[1280, 900], [390, 800]]) {
    await open('leap-desktop.html', w, h);
    // scroll the whole page so lazy images load
    const H = await ev('document.documentElement.scrollHeight');
    for (let y = 0; y < H + 800; y += 500) { await ev(`window.scrollTo(0, ${y})`); await sleep(120); }
    await sleep(800);
    const imgs = await ev(`[...document.images].map(i => ({src: i.getAttribute('src'), ok: i.complete && i.naturalWidth > 0}))`);
    check(`${w}px: ${imgs.length} images, all loaded`, imgs.every((i) => i.ok), imgs.filter((i) => !i.ok).map((i) => i.src).join(', '));
    check(`${w}px: no horizontal scroll`, await ev('document.documentElement.scrollWidth <= window.innerWidth'), `scrollWidth ${await ev('document.documentElement.scrollWidth')} vs ${w}`);
    check(`${w}px: no console errors`, errors.length === 0, errors.join(' | '));
    if (w === 1280) {
      const links = await ev(`[...new Set([...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')))]`);
      const local = links.filter((l) => !/^(https?:|#|mailto:)/.test(l));
      for (const l of local) { const r = await ev(`fetch(${JSON.stringify(l)}).then(r => r.status)`); check(`local link ${l}`, r === 200, `HTTP ${r}`); }
      const ids = await ev(`[...document.querySelectorAll('a[href^="#"]')].map(a => a.getAttribute('href').slice(1)).filter(i => i && !document.getElementById(i))`);
      check('every #anchor exists', ids.length === 0, ids.join(', '));
      const ext = links.filter((l) => /^https?:/.test(l));
      console.log(`      ${ext.length} external links (not fetched):`, ext.filter((l) => /nchiker\.github\.io/.test(l)).join(' '));
      await open('leap-desktop.html', 1280, 900); await shot('desktop-wide-top'); await shot('desktop-wide-full', true);
    } else { await open('leap-desktop.html', 390, 800); await shot('desktop-390-top'); await shot('desktop-390-full', true); }
  }
  await open('', 1280, 800); check('technical document (/) loads', (await ev('document.title')) === 'Leap Desktop' && (await ev(`!!document.querySelector('a[href="leap-desktop.html"]')`)), errors.join('|')); check('/: no errors', errors.length === 0, errors.join(' | '));
  await open('web/?cart=desk5', 1280, 800);
  const ok = await (async () => { for (let i = 0; i < 100; i++) { if (await ev('!!(window.leapG && window.leapG.frames > 300)').catch(() => false)) return true; await sleep(200); } return false; })();
  const st = await ev(`({ frames: window.leapG.frames, ff: window.leapG.m.portFF, err: window.leapG.error })`);
  check('web/?cart=desk5 runs the desktop', ok && st.ff === 6, JSON.stringify(st));
  const dck = await fetch(base + 'build/desk5.dck'); check('build/desk5.dck downloads', dck.status === 200 && (await dck.arrayBuffer()).byteLength > 50000);
  ws.close();
} finally { closeAll(); }
console.log(failed ? `${failed} FAILED` : 'all passed'); process.exit(failed ? 1 : 0);
