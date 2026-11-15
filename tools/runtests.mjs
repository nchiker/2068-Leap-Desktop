"use strict";
// runtests.mjs -- a parallel runner for the headless suites that only read prebuilt cartridges (docs/TESTSPEED.md 1, S4, and 2).
//   node tools/runtests.mjs [--jobs N] [--log DIR] [--compare DIR] [suite ...]
// Each suite is `node tests/<name>.mjs`, run through /usr/bin/time; its stdout and stderr go to <log dir>/<name>.log, followed by
// time's `WALL s CPU s RSS_KB kb` line and `EXIT code`.  The runner never builds anything.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, appendFileSync, renameSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SUITES = ['al-a1', 'kc-k1', 'calc-c1', 'shell-s1', 'tk-t1', 'tk-t2', 'tk-t3', 'wr-w1', 'wr-w2', 'wr-w3', 'wr-w4', 'wr-drag', 'wr-demo',
  'fs-f1', 'kern-dclick', 'web-smoke', 'calc-perf', 'shell-perf', 'tk-perf', 'wr-perf', 'boot-snapshot', 'g6-line', 'g6-patfill', 'g6-rrect', 'g6-flood', 'pt-p1', 'snd-s1'];
const PREFLIGHT = ['build/desk5.dck', 'build/desk5/out.sym', 'build/desk5/mem.bin', 'build/desk5l.dck', 'build/desk5l/out.sym', 'build/kern4.dck', 'build/hello.dck'];
const TIMES_FILE = join(ROOT, 'tests', '.suite-times.json');
const LIMIT_S = 1200;

// ---- arguments ----
let jobs = Math.min(cpus().length, 6), logDir = null, compareDir = null;
const names = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--jobs') jobs = parseInt(argv[++i], 10);
  else if (a === '--log') logDir = argv[++i];
  else if (a === '--compare') compareDir = argv[++i];
  else if (a.startsWith('--')) { console.error(`unknown option ${a}`); process.exit(2); }
  else names.push(a);
}
if (!(jobs >= 1)) { console.error('--jobs needs a number >= 1'); process.exit(2); }
const useDefault = names.length === 0;
const suites = useDefault ? DEFAULT_SUITES.slice() : names;
for (const s of suites) if (!existsSync(join(ROOT, 'tests', `${s}.mjs`))) { console.error(`no such suite: tests/${s}.mjs`); process.exit(2); }

// ---- preflight ----
const missing = PREFLIGHT.filter(p => !existsSync(join(ROOT, p)));
if (missing.length) {
  console.error('missing prebuilt files (the runner builds nothing):');
  for (const p of missing) console.error(`  ${p}`);
  process.exit(2);
}

// ---- log directory ----
if (!logDir) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  logDir = join(ROOT, 'build', 'test-logs', ts);
}
mkdirSync(logDir, { recursive: true });

// ---- order: longest first, no record first ----
let times = {};
try { times = JSON.parse(readFileSync(TIMES_FILE, 'utf8')); } catch { /* no record yet */ }
const est = s => (typeof times[s] === 'number' ? times[s] : Infinity);
const queue = suites.slice().sort((a, b) => est(b) - est(a));

// ---- one suite ----
function runSuite(name, log) {
  return new Promise(resolve => {
    const fd = openSync(log, 'w');
    const t0 = Date.now();
    const child = spawn('/usr/bin/time', ['-f', 'WALL %e CPU %U RSS_KB %M', 'node', join('tests', `${name}.mjs`)],
      { cwd: ROOT, stdio: ['ignore', fd, fd], detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
    }, LIMIT_S * 1000);
    child.on('error', err => { clearTimeout(timer); closeSync(fd); appendFileSync(log, `spawn error: ${err.message}\nEXIT 127\n`); resolve({ name, code: 127, wall: 0, cpu: 0, timedOut: false, log }); });
    child.on('close', code => {
      clearTimeout(timer);
      closeSync(fd);
      const wall = (Date.now() - t0) / 1000;
      if (timedOut) { appendFileSync(log, `TIMEOUT after ${LIMIT_S} s, killed\n`); code = 124; }
      else if (code === null) code = 128;
      appendFileSync(log, `EXIT ${code}\n`);
      const m = /^WALL ([\d.]+) CPU ([\d.]+)/m.exec(readFileSync(log, 'utf8'));
      resolve({ name, code, wall, cpu: m ? parseFloat(m[2]) : 0, timedOut, log });
    });
  });
}

function lastMatch(log) {
  const lines = readFileSync(log, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) if (/pass|passed|All checks/i.test(lines[i]) && !/^(WALL|EXIT) /.test(lines[i])) return lines[i].trim();
  return '';
}
const pad = (s, n) => String(s).padEnd(n);
function report(r, note = '') {
  console.log(`${pad(r.name, 14)} ${r.code === 0 ? 'PASS' : 'FAIL'}  ${pad(r.wall.toFixed(1) + ' s', 9)} ${lastMatch(r.log)}${r.timedOut ? '  (killed at the 1,200 s limit)' : ''}${note}`);
}

// ---- pool ----
const t0 = Date.now();
console.log(`${suites.length} suite(s), ${jobs} job(s), logs in ${logDir}`);
const results = [];
async function worker() {
  while (queue.length) {
    const name = queue.shift();
    const r = await runSuite(name, join(logDir, `${name}.log`));
    results.push(r);
    report(r);
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, suites.length) }, worker));

// ---- web-smoke: a wall-clock check that can fail under load; rerun it alone once ----
const rerun = {};
const ws = results.find(r => r.name === 'web-smoke' && r.code !== 0);
if (ws && jobs > 1 && suites.length > 1) {
  console.log('web-smoke failed in the pool; rerunning it alone once');
  const poolLog = join(logDir, 'web-smoke.pool-fail.log');
  renameSync(ws.log, poolLog);
  const r2 = await runSuite('web-smoke', join(logDir, 'web-smoke.log'));
  report(r2, `  (rerun alone; the pool run FAILED, log ${poolLog})`);
  rerun['web-smoke'] = { pool: ws, alone: r2 };
  results.splice(results.indexOf(ws), 1, r2);
}

const totalWall = (Date.now() - t0) / 1000;
const byName = Object.fromEntries(results.map(r => [r.name, r]));

// ---- update the recorded times ----
const passed = results.filter(r => r.code === 0);
if (passed.length) {
  for (const r of passed) times[r.name] = Math.round(r.wall * 10) / 10;
  writeFileSync(TIMES_FILE, JSON.stringify(times, null, 2) + '\n');
}

// ---- compare ----
function normalise(name, text) {
  let lines = text.split('\n').filter(l => !/^(WALL|EXIT) /.test(l) && !l.includes('TS_BOOTS') && !/^TIMEOUT /.test(l));
  if (name === 'web-smoke') lines = lines.filter(l => !l.includes('frames') && !l.includes('Screenshot in'));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map(l => l.replace(/\d+(\.\d+)? s\b/g, 'N s'));
}
if (compareDir) {
  console.log(`\nCompared with ${compareDir}:`);
  for (const name of suites) {
    const mine = join(logDir, `${name}.log`), theirs = join(compareDir, `${name}.log`);
    if (!existsSync(mine) || !existsSync(theirs)) { console.log(`${pad(name, 14)} cannot compare (${!existsSync(mine) ? 'no new log' : 'no log in ' + compareDir})`); continue; }
    const a = normalise(name, readFileSync(mine, 'utf8')), b = normalise(name, readFileSync(theirs, 'utf8'));
    const diffs = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) diffs.push(`  line ${i + 1}: new ${JSON.stringify(a[i] ?? '<none>')} | old ${JSON.stringify(b[i] ?? '<none>')}`);
    if (!diffs.length) console.log(`${pad(name, 14)} same`);
    else { console.log(`${pad(name, 14)} ${diffs.length} differing line(s)`); for (const d of diffs.slice(0, 5)) console.log(d); }
  }
}

// ---- summary ----
const nPass = results.filter(r => r.code === 0).length, nFail = results.length - nPass;
const cpuSum = results.reduce((s, r) => s + r.cpu, 0);
console.log(`\nSummary: ${nPass} passed, ${nFail} failed; wall ${totalWall.toFixed(1)} s; CPU (sum of user seconds) ${cpuSum.toFixed(1)} s`);
if (nFail) console.log(`Failed: ${results.filter(r => r.code !== 0).map(r => r.name).join(', ')}`);
console.log('Slowest:');
for (const r of results.slice().sort((a, b) => b.wall - a.wall).slice(0, 5)) console.log(`  ${pad(r.name, 14)} wall ${pad(r.wall.toFixed(1) + ' s', 9)} CPU ${r.cpu.toFixed(1)} s`);
for (const [n, x] of Object.entries(rerun)) console.log(`${n}: pool run ${x.pool.code === 0 ? 'PASS' : 'FAIL'} (${x.pool.wall.toFixed(1)} s), alone ${x.alone.code === 0 ? 'PASS' : 'FAIL'} (${x.alone.wall.toFixed(1)} s)`);
process.exit(nFail ? 1 : 0);
