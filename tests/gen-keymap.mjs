"use strict";
// gen-keymap.mjs (test) -- the key map generator, no emulator: node tests/gen-keymap.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genKeymap, KEY_ORDER } from '../tools/gen-keymap.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(ROOT, 'build', 'test-gen-keymap');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let fails = 0, checks = 0;
function eq(a, b, what) {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log(`FAIL ${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}

// ---- the real file
const real = join(tmp, 'real');
const path = genKeymap(join(ROOT, 'src/kernel/keymap.txt'), real);
eq(path, join(real, 'keymap.inc'), 'written path');
const inc = readFileSync(path, 'utf8');
const bytes = [...inc.matchAll(/^\s+DB\s+(\d+)\b/gm)].map(m => Number(m[1]));
eq(inc.includes('\nKEYMAP:\n'), true, 'KEYMAP label');
eq(bytes.length, 120, '120 bytes');
const at = (plane, k) => bytes[40 * plane + k];
eq(at(0, 1), 122, 'k=1 plain z'); eq(at(1, 1), 90, 'k=1 CS Z'); eq(at(2, 1), 58, 'k=1 SS :');
eq(at(1, 16), 1, 'k=16 CS CAPS'); eq(at(1, 19), 8, 'k=19 CS LEFT');
eq([at(0, 35), at(1, 35), at(2, 35)], [32, 3, 32], 'k=35 SPACE');
eq(at(0, 30), 13, 'k=30 plain ENTER');
eq(at(2, 17), 35, 'k=17 SS HASH'); eq(at(2, 33), 45, 'k=33 SS DASH');
eq([0, 36].map(k => [at(0, k), at(1, k), at(2, k)]), [[0, 0, 0], [0, 0, 0]], 'CS and SS keys all 0');
const seen = new Set(bytes);
eq([...Array(95)].map((_, i) => 32 + i).filter(c => !seen.has(c)), [], 'all printable ASCII present');

// ---- error cases: small inline inputs
// a minimal valid map: every printable once, spread over the 38 real keys' entries
function validRows() {
  const printable = [...Array(95)].map((_, i) => String.fromCharCode(32 + i)).filter(c => c !== ' ' && c !== '#' && c !== '-');
  const pool = [...printable, 'SPACE', 'HASH', 'DASH'];
  let n = 0;
  return KEY_ORDER.map(name => {
    if (name === 'CS' || name === 'SS') return [name, '-', '-', '-'];
    return [name, ...[0, 1, 2].map(() => (n < pool.length ? pool[n++] : '-'))];
  });
}
const fmt = rows => rows.map(r => r.join(' ')).join('\n') + '\n';
function expectErr(text, re, what) {
  checks++;
  const f = join(tmp, 'bad.txt');
  writeFileSync(f, text);
  try { genKeymap(f, join(tmp, 'bad')); fails++; console.log(`FAIL ${what}: no error`); }
  catch (e) {
    if (!re.test(e.message) || !e.message.startsWith(f + ':')) { fails++; console.log(`FAIL ${what}: message "${e.message}"`); }
  }
}
// sanity: the inline valid map passes
{
  checks++;
  const f = join(tmp, 'ok.txt');
  writeFileSync(f, '# comment\n' + fmt(validRows()).replace(/\n/, '   # trailing comment\n'));
  try { genKeymap(f, join(tmp, 'ok')); } catch (e) { fails++; console.log(`FAIL inline valid map: ${e.message}`); }
}
{ const r = validRows(); r.pop(); expectErr(fmt(r), /40 key lines/, '39 lines'); }
{ const r = validRows(); r.push(['X', '-', '-', '-']); expectErr(fmt(r), /40 key lines/, '41 lines'); }
{ const r = validRows(); [r[1], r[2]] = [r[2], r[1]]; expectErr(fmt(r), /key 1 should be Z, got X/, 'keys out of order'); }
{ const r = validRows(); r[0][1] = 'a'; expectErr(fmt(r), /CS must have all/, 'CS not all -'); }
{ const r = validRows(); r[36][3] = 'ENTER'; expectErr(fmt(r), /SS must have all/, 'SS not all -'); }
{ const r = validRows(); r[1][1] = 'bogus'; expectErr(fmt(r), /bad plain entry "bogus"/, 'unknown name'); }
{ const r = validRows(); r[1].pop(); expectErr(fmt(r), /expected a key name and 3 entries/, 'short line'); }
{ const r = validRows(); r[1][1] = 'é'; expectErr(fmt(r), /bad plain entry/, 'non-ASCII entry'); }
{ // missing characters: replace 'q' and '~' wherever they are, by '-'
  const r = validRows().map(row => row.map(e => (e === 'q' || e === '~' ? '-' : e)));
  expectErr(fmt(r), /missing from the map: .*\bq\b.*~|missing from the map: .*~.*\bq\b/, 'missing printable');
}
{ // '#' mid-token is not a comment: 'a#' is a bad entry, not a trimmed one
  const r = validRows(); r[1][1] = 'a#';
  expectErr(fmt(r), /bad plain entry "a#"/, '# glued to a token is not a comment');
}

console.log(`gen-keymap: ${checks - fails}/${checks} checks passed`);
process.exit(fails ? 1 : 0);
