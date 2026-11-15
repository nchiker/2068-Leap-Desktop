#!/usr/bin/env node
"use strict";
// Assembles the GitHub Pages site into _site/ (or the directory given as argv[2]): the landing page (pages/index.template.html with
// docs/TECHNICAL.md rendered into it by `marked`: `npm install` first), the browser page and the emulator.
// The browser page (web/main.js) reaches TSRun as ../tsrun/ and the cartridge as ../build/<name>.dck,
// so _site/ mirrors that layout: _site/web, _site/tsrun, _site/build/desk5.dck, and an index.html that
// opens web/?cart=desk5. The cartridge is the prebuilt pages/desk5.dck (refresh it with
//   node tools/build.mjs desk5 && cp build/desk5.dck pages/desk5.dck).
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? `${ROOT}/_site`);
for (const need of ['pages/desk5.dck', 'pages/index.template.html', 'docs/TECHNICAL.md', 'node_modules/marked/package.json', 'web/main.js', 'tsrun/machine.js', 'tsrun/roms/ts2068-0.rom'])
  if (!existsSync(`${ROOT}/${need}`)) { console.error(`missing ${need} (git submodule update --init? npm install?)`); process.exit(1); }

rmSync(OUT, { recursive: true, force: true });
mkdirSync(`${OUT}/build`, { recursive: true });
cpSync(`${ROOT}/web`, `${OUT}/web`, { recursive: true });
// TSRun: the modules, shaders and the stock ROM the page loads (the other ROM sets and the Go server are not needed)
cpSync(`${ROOT}/tsrun`, `${OUT}/tsrun`, { recursive: true, filter: (s) => !/[\\/](\.git|server\.go|leap[a-z]*-[01]\.rom)$/.test(s) });
cpSync(`${ROOT}/pages/desk5.dck`, `${OUT}/build/desk5.dck`);
// The landing page: the technical document rendered, with a table of contents from its headings.
const { marked } = await import('marked');
const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slug = (t) => t.toLowerCase().replace(/<[^>]*>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const toc = [];
const seen = new Set();
marked.use({ renderer: {
  heading({ tokens, depth }) {
    const html = this.parser.parseInline(tokens);
    let id = slug(html) || 'section'; for (let n = 2; seen.has(id); n++) id = `${slug(html)}-${n}`; seen.add(id);
    if (depth === 2 || depth === 3) toc.push({ depth, id, text: html.replace(/<[^>]*>/g, '') });
    return `<h${depth} id="${id}">${html}</h${depth}>\n`;
  },
  // `docs/NAME.md` in a code span links to that file on GitHub
  codespan({ text }) {
    const m = /^docs\/([A-Za-z0-9_.\/-]+\.md)$/.exec(text);
    return m ? `<a href="https://github.com/nchiker/2068-Leap-Desktop/blob/main/docs/${m[1]}"><code>${text}</code></a>` : `<code>${text}</code>`;
  },
} });
const doc = marked.parse(readFileSync(`${ROOT}/docs/TECHNICAL.md`, 'utf8'));
const tocHtml = '    <ul>\n' + toc.map((t) => `      <li class="h${t.depth}"><a href="#${t.id}">${esc(t.text)}</a></li>`).join('\n') + '\n    </ul>';
cpSync(`${ROOT}/docs/screens`, `${OUT}/docs/screens`, { recursive: true });
writeFileSync(`${OUT}/index.html`, readFileSync(`${ROOT}/pages/index.template.html`, 'utf8').replace('{{TOC}}', () => tocHtml).replace('{{DOC}}', () => doc));
writeFileSync(`${OUT}/.nojekyll`, '');
console.log(`site assembled in ${OUT}`);
