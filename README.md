# Leap Desktop

A GEOS-style graphical desktop for the **Timex Sinclair 2068**, built from Leap technology (Leap V2 and Leap Arcade). It runs from a
DOCK cartridge, uses the 512x192 64-column video mode, and is tested on emulators.

**Status:** `desk5`, a 56 KB DOCK cartridge, boots into a desktop with overlapping windows, menus, a Kempston mouse and sound, and six programs: the shell, Calculator, Key Caps, Notepad, Paint and a 15-tile Puzzle. It is tested on TSRun (headless and in the browser), ZEsarUX 13.0 and Fuse 1.9.1; the design and the plan are in [`docs/FEASIBILITY.md`](docs/FEASIBILITY.md), and `CLAUDE.md` holds the working notes.

| ▶ [**Try it in your browser**](https://nchiker.github.io/2068-Leap-Desktop/web/?cart=desk5) | 📖 [**Technical document**](https://nchiker.github.io/2068-Leap-Desktop/) | ⬇ [**desk5.dck**](pages/desk5.dck) | 🗂 [**Design docs**](docs/) |
|:---:|:---:|:---:|:---:|

![The Leap Desktop window with five program icons](docs/screens/desktop.png)

The live page runs the cartridge on [TSRun](https://github.com/nchiker/TSRun), a TS2068 emulator in the browser; click the screen to give it the keyboard.
[`docs/TECHNICAL.md`](docs/TECHNICAL.md) explains how it works (the same text is the front page of the live site). The page serves the prebuilt
`pages/desk5.dck`; refresh it with `node tools/build.mjs desk5 && cp build/desk5.dck pages/desk5.dck`. Emulator-qualified, not yet tried on a real TS2068.

## Layout

| Path | What |
|---|---|
| `src/` | Z80 assembly (sjasmplus). `hello.asm` is the smoke cartridge |
| `tools/build.mjs` | Assembles every target into `build/<name>.dck` (DOCK bank 0, chunks 0, 1, 4, 5) |
| `tests/` | Headless tests on TSRun under Node (`lib.mjs` is the harness) |
| `web/` | Browser test page: TSRun running a cartridge |
| `tsrun/` | TSRun emulator, git submodule, pinned to the commit Leap-IDE uses |
| `docs/` | Feasibility review, provenance of reused code |

## Use

Needs `sjasmplus` (1.23) on the PATH and Node 24.

```sh
git submodule update --init       # TSRun
node tools/build.mjs              # build/hello.dck
node tests/hello.mjs --pgm        # headless test; --pgm writes build/hello.pgm
python3 -m http.server 8080       # then open http://localhost:8080/web/?cart=hello
```

## Reused code

Code copied from the other Leap projects is listed, with source commits, in [`docs/PROVENANCE.md`](docs/PROVENANCE.md). Leap V2
(`~/2068-Leap`) stays frozen and is never edited from here.

The TS2068 Technical Manual is the hardware reference. It is kept locally in `docs/` and is not committed (third-party document).
Download: https://www.retromaniek.pl/wp-content/uploads/2019/09/Timex-Sinclair-2068-Technical-Manual-best.pdf
