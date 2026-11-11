"use strict";
// build.mjs -- assemble Leap Desktop cartridges with sjasmplus and write DCKs.
//   node tools/build.mjs            build every target
//   node tools/build.mjs hello      build one
// Per target: build/<name>/{mem.bin,out.lst,out.sym} and build/<name>.dck (DOCK bank 0, kinds 0 and 2; chunks 0,1,4,5 is
// the shape Leap Arcade proved on TSRun, ZEsarUX 13.0 and Fuse 1.9.1).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDck, chunksFromImage } from './mkdck.mjs';
import { genTables, genTables4 } from './gen-tables.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const TARGETS = {
  hello: { src: 'src/hello.asm', chunks: [0, 1, 4, 5] },
  probe23: { src: 'src/probe23.asm', chunks: [0, 1, 2, 3, 4, 5] },   // docs/PROBE_DOCK23.md
  gfx6t: { src: 'src/gfx6t.asm', chunks: [0, 1, 4, 5], tables: true }, // docs/GRAPHICS_SPIKE.md section 12.4
};

/** Assemble one target; returns { img (64 KB), syms, dck, dckPath }. */
export function build(name, defs = {}) {
  const src = TARGETS[name]?.src;
  if (!src) throw new Error(`unknown target ${name} (known: ${Object.keys(TARGETS).join(', ')})`);
  if (TARGETS[name].tables) {                 // src/gfx6/tables*.inc are generated, never hand-edited: regenerate before assembling
    for (const [file, gen] of [['src/gfx6/tables.inc', genTables], ['src/gfx6/tables4.inc', genTables4]]) {
      const path = join(ROOT, file), text = gen();
      let old = null;
      try { old = readFileSync(path, 'utf8'); } catch { /* first build */ }
      if (old !== text) writeFileSync(path, text);
    }
  }
  const dir = join(ROOT, 'build', name);
  mkdirSync(dir, { recursive: true });
  const args = ['--nologo', '--lstlab', `--lst=${join(dir, 'out.lst')}`, `--sym=${join(dir, 'out.sym')}`,
    `-I${join(ROOT, 'src')}`];
  for (const [k, v] of Object.entries(defs)) args.push(`-D${k}=${v}`);
  args.push(join(ROOT, src));
  try { execFileSync('sjasmplus', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`sjasmplus failed on ${src}:\n${e.stdout || ''}${e.stderr || ''}`); }
  const img = new Uint8Array(readFileSync(join(dir, 'mem.bin')));
  const syms = {};
  for (const line of readFileSync(join(dir, 'out.sym'), 'utf8').split('\n')) {
    const m = line.match(/^(\S+):\s+EQU\s+0x([0-9A-Fa-f]+)/);
    if (m) syms[m[1]] = parseInt(m[2], 16);
  }
  const dck = buildDck(chunksFromImage(img, TARGETS[name].chunks));
  const dckPath = join(ROOT, 'build', `${name}.dck`);
  writeFileSync(dckPath, dck);
  return { img, syms, dck, dckPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
  for (const n of names) {
    const { dck, dckPath } = build(n);
    console.log(`${n}: ${dckPath.replace(ROOT + '/', '')} (${dck.length} bytes)`);
  }
}
