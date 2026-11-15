#!/usr/bin/env node
"use strict";
// Assembles the GitHub Pages site into _site/ (or the directory given as argv[2]).
// The browser page (web/main.js) reaches TSRun as ../tsrun/ and the cartridge as ../build/<name>.dck,
// so _site/ mirrors that layout: _site/web, _site/tsrun, _site/build/desk5.dck, and an index.html that
// opens web/?cart=desk5. The cartridge is the prebuilt pages/desk5.dck (refresh it with
//   node tools/build.mjs desk5 && cp build/desk5.dck pages/desk5.dck).
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? `${ROOT}/_site`);
for (const need of ['pages/desk5.dck', 'web/main.js', 'tsrun/machine.js', 'tsrun/roms/ts2068-0.rom'])
  if (!existsSync(`${ROOT}/${need}`)) { console.error(`missing ${need} (git submodule update --init?)`); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/build`, { recursive: true });
cpSync(`${ROOT}/web`, `${OUT}/web`, { recursive: true });
// TSRun: the modules, shaders and the stock ROM the page loads (the other ROM sets and the Go server are not needed)
cpSync(`${ROOT}/tsrun`, `${OUT}/tsrun`, { recursive: true, filter: (s) => !/[\\/](\.git|server\.go|leap[a-z]*-[01]\.rom)$/.test(s) });
cpSync(`${ROOT}/pages/desk5.dck`, `${OUT}/build/desk5.dck`);
writeFileSync(`${OUT}/index.html`, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Leap Desktop</title>
<meta http-equiv="refresh" content="0; url=web/?cart=desk5">
</head><body><p><a href="web/?cart=desk5">Leap Desktop on TSRun</a></p></body></html>
`);
writeFileSync(`${OUT}/.nojekyll`, '');
console.log(`site assembled in ${OUT}`);
