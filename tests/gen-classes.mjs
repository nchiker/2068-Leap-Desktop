"use strict";
// gen-classes.mjs (test) -- the class generator, no emulator: node tests/gen-classes.mjs
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { genClasses } from '../tools/gen-classes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = join(ROOT, 'build', 'test-gen-classes');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

let fails = 0, checks = 0;
function eq(a, b, what) {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) { fails++; console.log(`FAIL ${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }
}

// ---- the two real class files
const out = join(tmp, 'real');
const written = genClasses([join(ROOT, 'src/kernel/classes.txt'), join(ROOT, 'src/kern3-classes.txt')], out);
eq(written.map(p => p.slice(out.length + 1)), ['classes.inc', 'kern3-classes.inc', 'classes.json'], 'written files');
const js = JSON.parse(readFileSync(join(out, 'classes.json'), 'utf8'));
const cls = Object.fromEntries(js.classes.map(c => [c.name, c]));
const off = c => Object.fromEntries(cls[c].fields.map(f => [f.name, f.offset]));

eq(js.classes.map(c => c.name),
  ['Object', 'View', 'TLog', 'TLog2', 'TSz8', 'TSz9', 'TSz16', 'TSz24', 'TSz32', 'TSz33', 'TSz40', 'TSz255'], 'definition order');
eq(js.classes.map(c => c.id), js.classes.map((_, i) => i + 1), 'ids in definition order');
eq(js.classes.map(c => c.parent),
  [null, 'Object', 'View', 'TLog', ...Array(8).fill('Object')], 'parents');

const v = off('View');
eq(['parent', 'child', 'next', 'x', 'y', 'w', 'h', 'flags', 'id'].map(n => v[n]), [2, 4, 6, 8, 10, 11, 13, 14, 15], 'View offsets');
eq(cls.View.size, 16, 'View size'); eq(cls.View.pool, 8, 'View pool');
eq(cls.Object.size, 2, 'Object size'); eq(cls.Object.pool, 6, 'Object pool');
eq(off('TLog'), { tag: 16 }, 'TLog.tag'); eq(cls.TLog.size, 17, 'TLog size'); eq(cls.TLog.pool, 10, 'TLog pool');
eq(cls.TLog2.size, 17, 'TLog2 size'); eq(cls.TLog2.pool, 10, 'TLog2 pool'); eq(cls.TLog2.fields, [], 'TLog2 own fields');
for (const [n, size, pool] of [[8, 8, 6], [9, 9, 8], [16, 16, 8], [24, 24, 10], [32, 32, 12], [33, 33, 14], [40, 40, 14], [255, 255, 14]]) {
  eq([cls['TSz' + n].size, cls['TSz' + n].pool], [size, pool], `TSz${n} size, pool`);
  eq(cls['TSz' + n].fields, [{ name: 'pad', offset: 2, size: size - 2 }], `TSz${n} pad`);
}

eq(js.messages, { DESTROY: 0, DRAW: 1, EVENT: 2, HITTEST: 3, FOCUS: 4, BLUR: 5, POKE: 6, POKE2: 7 }, 'message numbers');
const labels = c => cls[c].methods.map(m => m.label);
eq(labels('Object'), ['obj_destroy', 'k_nop', 'k_nop', 'k_nop', 'k_nop', 'k_nop'], 'Object table');
eq(labels('View'), ['view_destroy', 'k_nop', 'k_nop', 'view_hittest', 'k_nop', 'k_nop'], 'View table');
eq(labels('TLog'), ['t_destroy', 't_draw', 't_event', 't_hittest', 't_focus', 't_blur', 't_poke'], 'TLog table');
eq(labels('TLog2'), ['t_destroy', 't_draw2', 't_event', 't_hittest', 't_focus', 't_blur', 't_poke', 't_poke2'], 'TLog2 table');
eq(cls.TLog2.methods.map(m => m.n), [0, 1, 2, 3, 4, 5, 6, 7], 'TLog2 slot numbers');

// the .inc text
const inc = readFileSync(join(out, 'classes.inc'), 'utf8');
const has = (s, what) => { checks++; if (!inc.includes(s)) { fails++; console.log(`FAIL inc: ${what}: missing "${s}"`); } };
has('    DW CL_Object\n    DB 2, 6, 16, 8\nCL_View:\n    DW view_destroy, k_nop, k_nop, view_hittest, k_nop, k_nop\n', 'View block');
has('    DW 0\n    DB 1, 6, 2, 6\nCL_Object:\n', 'Object block');
has('    IF ((($ + 6) & $FF) + 2 * 6) > 256', 'page guard'); has('    ALIGN 256, 0\n    ENDIF', 'align');
has('M_DESTROY EQU 0\n', 'M_DESTROY'); has('M_BLUR EQU 5\n', 'M_BLUR'); has('View_id EQU 15\n', 'View_id'); has('View_SIZE EQU 16\n', 'View_SIZE');
has('Object_SIZE EQU 2\n', 'Object_SIZE');
const inc2 = readFileSync(join(out, 'kern3-classes.inc'), 'utf8');
for (const s of ['M_POKE EQU 6\n', 'M_POKE2 EQU 7\n', 'TLog_tag EQU 16\n', 'TLog_SIZE EQU 17\n', 'TSz255_pad EQU 2\n', 'TSz255_SIZE EQU 255\n', 'DW CL_View\n']) {
  checks++; if (!inc2.includes(s)) { fails++; console.log(`FAIL kern3-classes.inc: missing "${s}"`); }
}
checks++; if (inc2.includes('M_DESTROY')) { fails++; console.log('FAIL kern3-classes.inc defines M_DESTROY (belongs to classes.inc)'); }

// ---- error cases: [name, file text(s), expected message fragment]
let n = 0;
function bad(name, texts, frag) {
  const files = (Array.isArray(texts) ? texts : [texts]).map((t, i) => {
    const p = join(tmp, `bad${n++}-${i}.txt`); writeFileSync(p, t); return p;
  });
  checks++;
  try { genClasses(files, join(tmp, 'badout')); fails++; console.log(`FAIL ${name}: no error`); }
  catch (e) {
    if (!e.message.includes(frag)) { fails++; console.log(`FAIL ${name}: error "${e.message}" lacks "${frag}"`); }
    else if (!/bad\d+-\d\.txt:\d+:/.test(e.message)) { fails++; console.log(`FAIL ${name}: error does not name file and line: "${e.message}"`); }
  }
}
bad('unknown parent', 'class A : Nope\n', 'unknown parent');
bad('parent defined later', 'class B : A\nclass A\n', 'defined later');
bad('parent in later file', ['class B : A\n', 'class A\n'], 'defined later');
bad('duplicate class', 'class A\nclass A\n', 'duplicate class');
bad('duplicate class across files', ['class A\n', 'class A\n'], 'duplicate class');
bad('message new in two classes', 'class A\nclass B : A\n  method Foo f1\nclass C : A\n  method Foo f2\n', 'already defined');
bad('message redefined down a path', 'class A\n  method Foo f1\n  method Foo f2\n', 'duplicate method');
bad('size over 255', 'class A\n  field a 200\n  field b 54\n', 'over 255');
bad('size over 255 via parent', 'class A\n  field a 253\nclass B : A\n  field b 1\n', 'over 255');
bad('field size 0', 'class A\n  field a 0\n', 'out of 1..253');
bad('field size 254', 'class A\n  field a 254\n', 'out of 1..253');
bad('malformed: unknown keyword', 'class A\n  frobnicate x\n', 'malformed');
bad('malformed: field arity', 'class A\n  field a\n', 'malformed');
bad('malformed: field size text', 'class A\n  field a two\n', 'malformed');
bad('malformed: method arity', 'class A\n  method Foo\n', 'malformed');
bad('malformed: class name', 'class 9A\n', 'malformed');
bad('malformed: field before class', '  field a 1\n', 'before any class');
bad('count over 127', 'class A\n' + Array.from({ length: 128 }, (_, i) => `  method M${i} l${i}\n`).join(''), '127');
// accepted edge cases: 127 methods, 255 size, comments anywhere, colon without spaces
checks++;
try {
  const p = join(tmp, 'ok.txt');
  writeFileSync(p, '# c\nclass A # x\n' + Array.from({ length: 127 }, (_, i) => `  method M${i} l${i} # c\n`).join('') + 'class B:A\n  field a 253 # max\n');
  genClasses([p], join(tmp, 'okout'));
} catch (e) { fails++; console.log(`FAIL edge cases rejected: ${e.message}`); }

console.log(fails ? `FAIL gen-classes: ${fails} of ${checks} checks failed` : `PASS gen-classes: ${checks} checks`);
process.exit(fails ? 1 : 0);
