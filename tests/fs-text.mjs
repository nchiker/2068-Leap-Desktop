"use strict";
// fs-text.mjs -- docs/FILES.md 8.3: the file host's text conversion and name rules (web/fshost.js: textIn, textOut, nameOk,
// usableName) against reference models written from FILES 2 (not from the code under test).
//   node tests/fs-text.mjs
import { checks } from './lib.mjs';
import { textIn, textOut, nameOk, usableName } from '../web/fshost.js';

const C = checks('fs-text');
const { check } = C;
const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const L = (a) => Array.from(a);

// ---- Reference models ---------------------------------------------------------------------------------------------------
// Reading: line ends first (CR LF, then LF, then CR all become 13), then per code: TAB -> space, other codes below 32 dropped,
// above 126 -> '?'. Done on a string with regular expressions, a different method from the byte loop it checks.
function modelIn(bytes) {
  let s = String.fromCharCode(...bytes);
  s = s.replace(/\r\n/g, '\r').replace(/\n/g, '\r');
  s = s.replace(/\t/g, ' ');
  s = s.replace(/[\x00-\x0C\x0E-\x1F]/g, '');       // all of 0..31 but 13
  s = s.replace(/[\x7F-￿]/g, '?');
  return Array.from(s, (c) => c.charCodeAt(0));
}
// Writing: each 13 becomes LF (10); every other byte as it is.
const modelOut = (bytes) => Array.from(bytes, (b) => (b === 13 ? 10 : b));
// Names: 1-30 codes, each 32-126, none of / \ : * ? " < > |
const BADSET = new Set('/\\:*?"<>|'.split(''));
function modelNameOk(s) {
  const u = Array.from(s);
  if (u.length < 1 || u.length > 30) return false;
  return u.every((ch) => { const k = ch.codePointAt(0); return k >= 32 && k <= 126 && !BADSET.has(ch); });
}

let seed = 0x1234567;
const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed; };

// ---- textIn: hand cases -------------------------------------------------------------------------------------------------
const CR = 13, LF = 10, TAB = 9, A = 65, B = 66;
const cases = [
  ['empty', [], []],
  ['plain text', [A, B], [A, B]],
  ['CR LF', [A, CR, LF, B], [A, CR, B]],
  ['LF', [A, LF, B], [A, CR, B]],
  ['CR', [A, CR, B], [A, CR, B]],
  ['CR CR LF', [CR, CR, LF], [CR, CR]],
  ['LF CR', [LF, CR], [CR, CR]],
  ['LF LF', [LF, LF], [CR, CR]],
  ['CR LF LF', [CR, LF, LF], [CR, CR]],
  ['LF CR LF', [LF, CR, LF], [CR, CR]],
  ['CR code CR', [CR, 0, LF], [CR, CR]],           // a dropped code between them: the LF stands alone
  ['trailing CR', [A, CR], [A, CR]],
  ['trailing LF', [A, LF], [A, CR]],
  ['TAB', [A, TAB, B], [A, 32, B]],
  ['TABs', [TAB, TAB], [32, 32]],
  ['NUL dropped', [A, 0, B], [A, B]],
  ['code 1 dropped', [1], []],
  ['BEL, BS, FF, ESC, US dropped', [7, 8, 12, 27, 31], []],
  ['code 11 and 14 dropped', [11, 14], []],
  ['32 kept', [32], [32]],
  ['126 kept', [126], [126]],
  ['127 -> ?', [127], [63]],
  ['128 -> ?', [128], [63]],
  ['255 -> ?', [255], [63]],
  ['mixed', [A, 200, CR, LF, TAB, 0, 127, B, LF], [A, 63, CR, 32, 63, B, CR]],
];
for (const [name, input, want] of cases) {
  const got = L(textIn(Uint8Array.from(input)));
  check(`textIn ${name}`, eq(got, want), `got [${got}] want [${want}]`);
  check(`textIn ${name}: matches the reference model`, eq(modelIn(input), want), `model [${modelIn(input)}]`);
}
check('textIn returns a Uint8Array', textIn(Uint8Array.from([1, 2, 65])) instanceof Uint8Array);
{
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  const got = L(textIn(all)), want = modelIn(all);
  check('textIn every code 0..255 once', eq(got, want), `${got.length} vs ${want.length}`);
  // Single codes in isolation, against the spec table.
  let bad = [];
  for (let k = 0; k < 256; k++) {
    const w = k === 13 || k === 10 ? [13] : k === 9 ? [32] : k < 32 ? [] : k > 126 ? [63] : [k];
    if (!eq(L(textIn(Uint8Array.from([k]))), w)) bad.push(k);
  }
  check('textIn each single code 0..255 as the table says', bad.length === 0, `wrong for ${bad.join(',')}`);
}
check('textIn does not change its input', (() => { const x = Uint8Array.from([A, CR, LF, 200]); textIn(x); return eq(L(x), [A, CR, LF, 200]); })());

// ---- textIn: random -----------------------------------------------------------------------------------------------------
{
  let bad = 0, firstBad = '';
  for (let t = 0; t < 500; t++) {
    const n = rnd() % 200;
    // A mix weighted towards the interesting codes: line ends, TAB, controls, high codes, and letters.
    const bytes = Uint8Array.from({ length: n }, () => {
      const r = rnd() % 10;
      if (r < 2) return 13; if (r < 4) return 10; if (r === 4) return 9;
      if (r === 5) return rnd() % 32; if (r === 6) return 127 + (rnd() % 129);
      return 32 + (rnd() % 95);
    });
    if (!eq(L(textIn(bytes)), modelIn(bytes))) { bad++; firstBad ||= L(bytes).join(','); }
  }
  check('textIn 500 random byte strings (weighted mix) match the model', bad === 0, `${bad} differ, first: ${firstBad}`);
  bad = 0;
  for (let t = 0; t < 200; t++) {
    const bytes = Uint8Array.from({ length: rnd() % 1000 }, () => rnd() & 0xFF);
    if (!eq(L(textIn(bytes)), modelIn(bytes))) bad++;
  }
  check('textIn 200 uniformly random byte strings match the model', bad === 0, `${bad} differ`);
  const big = Uint8Array.from({ length: 65535 }, () => rnd() & 0xFF);
  check('textIn 65,535 random bytes match the model', eq(L(textIn(big)), modelIn(big)));
  // Every output is 13 or in 32..126; never longer than the input.
  const res = textIn(big);
  check('textIn output codes are 13 or 32..126 and no longer than the input', res.length <= big.length && L(res).every((b) => b === 13 || (b >= 32 && b <= 126)));
}

// ---- textOut ------------------------------------------------------------------------------------------------------------
{
  const w = [[[], []], [[A, CR, B], [A, LF, B]], [[CR, CR], [LF, LF]], [[LF, CR, LF], [LF, LF, LF]], [[0, 255, 127, 9], [0, 255, 127, 9]]];
  for (const [i, o] of w) check(`textOut [${i}]`, eq(L(textOut(Uint8Array.from(i))), o));
  let bad = 0;
  for (let t = 0; t < 200; t++) {
    const bytes = Uint8Array.from({ length: rnd() % 500 }, () => (rnd() % 4 === 0 ? 13 : rnd() & 0xFF));
    if (!eq(L(textOut(bytes)), modelOut(bytes))) bad++;
  }
  check('textOut 200 random byte strings match the model', bad === 0, `${bad} differ`);
  check('textOut returns a Uint8Array', textOut(Uint8Array.from([13])) instanceof Uint8Array);
  const x = Uint8Array.from([13, 65]); textOut(x);
  check('textOut does not change its input', eq(L(x), [13, 65]));
  // What a Write file goes through: out then in gives the same codes for 13 and 32..126.
  const doc = Uint8Array.from({ length: 3000 }, () => (rnd() % 12 === 0 ? 13 : 32 + (rnd() % 95)));
  check('text out then in is the identity for CR and 32..126', eq(L(textIn(textOut(doc))), L(doc)));
  // Text with LF line ends from the host: in then out gives LF again.
  const lf = Uint8Array.from([A, LF, B, LF]);
  check('LF text in then out is the identity', eq(L(textOut(textIn(lf))), L(lf)));
}

// ---- nameOk -------------------------------------------------------------------------------------------------------------
{
  const yes = ['a', 'x'.repeat(30), 'readme.txt', ' ', 'a b', '~', '.hidden', 'a.b.c', 'A-Z_0.9', '!#$%&\'()+,;=@[]^`{}~'];
  const no = ['', 'x'.repeat(31), 'x'.repeat(100), ...[...'/\\:*?"<>|'].map((c) => `a${c}`), '/', '|',
    `a${String.fromCharCode(31)}`, String.fromCharCode(0), 'a\tb', 'a\nb', `a${String.fromCharCode(127)}`, 'aé', 'aĀ', 'a€', 'x'.repeat(29) + 'é'];
  for (const s of yes) check(`nameOk accepts ${JSON.stringify(s.length > 12 ? s.slice(0, 8) + `...(${s.length})` : s)}`, nameOk(s) === true);
  for (const s of no) check(`nameOk refuses ${JSON.stringify(s.length > 12 ? s.slice(0, 8) + `...(${s.length})` : s)}`, nameOk(s) === false);
  let bad = 0, firstBad = '';
  for (let t = 0; t < 3000; t++) {
    const n = rnd() % 34;
    const s = Array.from({ length: n }, () => String.fromCharCode(rnd() % 8 === 0 ? rnd() % 256 : (rnd() % 3 === 0 ? '/\\:*?"<>|'.charCodeAt(rnd() % 9) : 32 + (rnd() % 95)))).join('');
    if (nameOk(s) !== modelNameOk(s)) { bad++; firstBad ||= JSON.stringify(s); }
  }
  check('nameOk 3,000 random names match the model', bad === 0, `${bad} differ, first ${firstBad}`);
  // Boundary: all 95 printable codes, one at a time.
  let wrong = [];
  for (let k = 0; k < 256; k++) {
    const want = k >= 32 && k <= 126 && !BADSET.has(String.fromCharCode(k));
    if (nameOk(`a${String.fromCharCode(k)}b`) !== want) wrong.push(k);
  }
  check('nameOk each code 0..255 inside a name as the rule says', wrong.length === 0, `wrong for ${wrong.join(',')}`);
}

// ---- usableName ---------------------------------------------------------------------------------------------------------
{
  const hand = [
    ['plain.txt', 'plain.txt'],
    ['a/b.txt', 'a_b.txt'],
    ['a:b*c?d"e<f>g|h\\i', 'a_b_c_d_e_f_g_h_i'],
    ['café.txt', 'caf_.txt'],
    ['\u{1F600}.txt', '_.txt'],                      // one code point, one underscore
    ['', '_'],
    ['tab\there', 'tab_here'],
  ];
  for (const [i, o] of hand) check(`usableName ${JSON.stringify(i)} -> ${JSON.stringify(o)}`, usableName(i) === o, usableName(i));
  const long = 'q'.repeat(50) + '.txt';
  check('usableName: a long name keeps its short extension, 30 long', usableName(long) === 'q'.repeat(26) + '.txt');
  check('usableName: a long name with an 8-code extension (.mdtexts, the longest kept)', usableName('w'.repeat(40) + '.mdtexts') === 'w'.repeat(22) + '.mdtexts');
  check('usableName: a long name with a 9-code extension is cut at 30, extension lost', usableName('w'.repeat(40) + '.markdown') === 'w'.repeat(30));
  check('usableName: exactly 30 stays as it is', usableName('e'.repeat(26) + '.txt') === 'e'.repeat(26) + '.txt');
  check('usableName: 31 long gets cut to 30 and keeps its extension', usableName('r'.repeat(27) + '.txt') === 'r'.repeat(26) + '.txt');
  check('usableName: a long name with no extension is cut to 30', usableName('n'.repeat(45)) === 'n'.repeat(30));
  check('usableName: a long name with a bad char inside the extension is made usable first', nameOk(usableName('p'.repeat(40) + '.t*t')));
  check('usableName: a leading dot is not an extension', usableName('.' + 'h'.repeat(40)) === '.' + 'h'.repeat(29));
  let bad = 0, shortExtBad = 0, firstBad = '';
  for (let t = 0; t < 3000; t++) {
    const n = rnd() % 70;
    let s = Array.from({ length: n }, () => {
      const r = rnd() % 12;
      if (r === 0) return '/\\:*?"<>|'[rnd() % 9];
      if (r === 1) return String.fromCharCode(rnd() % 32);
      if (r === 2) return String.fromCodePoint(127 + (rnd() % 0x300));
      if (r === 3) return '.';
      return String.fromCharCode(97 + (rnd() % 26));
    }).join('');
    if (rnd() % 2) s += '.' + 'abcdefg'.slice(0, 1 + (rnd() % 4));     // a short extension, 2-5 codes with the dot
    const u = usableName(s);
    if (!nameOk(u)) { bad++; firstBad ||= JSON.stringify(s); }
    // A name already acceptable stays as it is; a long name keeps a short extension.
    if (nameOk(s) && u !== s) bad++;
    const clean = Array.from(s, (c) => { const k = c.codePointAt(0); return k < 32 || k > 126 || BADSET.has(c) ? '_' : c; }).join('');
    const dot = clean.lastIndexOf('.');
    if (clean.length > 30 && dot > 0 && clean.length - dot <= 8) {
      if (!u.endsWith(clean.slice(dot)) || u.length !== 30) shortExtBad++;
    }
  }
  check('usableName: 3,000 random names: every result passes nameOk, acceptable names unchanged', bad === 0, `${bad} bad, first ${firstBad}`);
  check('usableName: 3,000 random names: a long name keeps its short extension (and is 30 long)', shortExtBad === 0, `${shortExtBad} bad`);
}

C.done();
