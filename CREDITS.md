# Credits and thanks

Leap Desktop stands on other people's work. Thank you. Every credit below comes from this repository's README, LICENSE,
`docs/PROVENANCE.md`, `tsrun/roms/README.md`, `package.json`, the commit messages, or a tool's own version output; where something could
not be checked here it says so.

## TSRun, the emulator

The desktop on the live page, and every test in `tests/`, run on [TSRun](https://github.com/josef-jelinek/TSRun), the Timex Sinclair 2068
emulator written by **Josef Jelínek** ([josef-jelinek](https://github.com/josef-jelinek)). This repository pins a
[fork](https://github.com/nchiker/TSRun) (`tsrun/`, a git submodule) that adds a Kempston mouse and a host file bridge (`docs/PROVENANCE.md`,
Submodules); the emulator itself, and the idea of testing a TS2068 program headless under Node, are Josef's. TSRun carries no licence file
of its own (stated in `docs/PROVENANCE.md`).

## The Timex Sinclair 2068

The computer itself: the **TS2068** by Timex Computer Corporation, descended from the Sinclair ZX Spectrum by **Sir Clive Sinclair** and
Sinclair Research. The live page loads TSRun's stock TS2068 ROMs, which `tsrun/roms/README.md` describes as partly released by Amstrad
for non-commercial use and partly abandonware "as far as I could verify". The Leap ROMs in that folder are MIT (also per that file) but this
desktop does not load them. The TS2068 Technical Manual is the hardware reference; it is kept locally and not distributed. Timex, Sinclair
and ZX Spectrum are trademarks of their owners. This is an independent community project, not affiliated with Timex, Sinclair, Amstrad,
Apple, Fuse or ZEsarUX.

## The Leap family

Leap Desktop is built from parts of the owner's other projects (**nchiker**), each copied file listed with its source commit in
[`docs/PROVENANCE.md`](docs/PROVENANCE.md):

- [2068-Leap](https://github.com/nchiker/2068-Leap) (Leap V2, MIT): the font table (`src/font.inc`) and the kernel conventions.
- [2068-Leap-IDE](https://github.com/nchiker/2068-Leap-IDE) (the Leap IDE and Leap Arcade): the DOCK cartridge builder
  (`tools/mkdck.mjs`), the fast-boot test helper (`tests/fast-boot.mjs`) and the proof of TSRun's silent-AY speed-up
  (`tests/tsrun-ay-silent.mjs`). The website's layout and styling follow that project's two pages
  ([Leap IDE](https://nchiker.github.io/2068-Leap-IDE/leap-ide.html), [Leap Arcade](https://nchiker.github.io/2068-Leap-IDE/arcade.html)).
- 2068-TSPico-Study: the shape of the file interface (open, read, write, close by name) follows TS-Pico's channel calls (README).

## Built with Claude Code

Much of the code, the tests and the documentation were written with **Claude Code** (Claude, by [Anthropic](https://www.anthropic.com))
working under nchiker's direction, with nchiker reviewing, choosing and approving the results. 208 of the repository's 213 commits at the
time of writing carry a `Co-Authored-By: Claude` line (counted with `git log`).

## Ideas and looks

- The look is inspired by the original Macintosh's, Paint by MacPaint, and the idea of a desktop on an 8-bit machine by GEOS. All bitmaps
  here were drawn for this project (README); I did not trace the origin of each glyph in `fonts/prop6.txt` beyond its header, which
  describes it as this project's proportional font.
- [zxdesk](https://github.com/mindbox77/zxdesk) by **Damian Cooper** (MIT), a desktop for the 48K Spectrum, was read for ideas (timing
  method, relocatable programs, interrupt-safe fills). No code was copied (README). The author's name is as the README gives it; I could not
  check it against the zxdesk repository from here.

## Tools it is built and tested with

- [SjASMPlus](https://github.com/z00m128/sjasmplus) (v1.23.1 here) assembles the Z80 code.
- [Node.js](https://nodejs.org) runs the headless tests and the tools.
- [marked](https://github.com/markedjs/marked) 15.0.12 (MIT, `package.json`) renders the technical document on the site.
- [ZEsarUX](https://github.com/chernandezba/zesarux) 13.0 by **César Hernández Baño** and [Fuse](https://fuse-emulator.sourceforge.net/) 1.9.1,
  the Free Unix Spectrum Emulator, by **Philip Kendall** and its contributors, for the cross-emulator checks (versions from `CLAUDE.md`; the
  authors' names are as the sibling Leap IDE project credits them).
- The website's screenshots and clips were captured with headless Chromium (Playwright's headless shell) driven over the DevTools protocol,
  and the GIFs assembled with [Pillow](https://python-pillow.org) (`tools/site-capture.mjs`, `tools/site-gifs.py`).
- GitHub Pages hosts the site.

## Licence

Leap Desktop's own code and documents are under the [MIT License](LICENSE). The submodule and the vendored ROMs keep their own terms (see
above). If you think a credit is missing or wrong, please open an issue.
