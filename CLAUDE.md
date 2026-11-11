# Leap Desktop — brief for Claude sessions

Read `docs/FEASIBILITY.md` first (the architecture and the roadmap), then this file.

## Decisions (owner, 2026-11-11; do not re-ask)

- Separate project from Leap V2 and Leap-IDE. Reuse by **copying** with an entry in `docs/PROVENANCE.md`; never edit `~/2068-Leap`
  (frozen) or `~/Projects/Leap-IDE` from here.
- Desktop video mode **6** (512x192, black ink on white paper, `$FF = $06`); per-app modes 0 and 2 on the same memory map.
- Test target: **emulators** (TSRun headless and in `web/`; ZEsarUX 13.0 and Fuse 1.9.1 for cross-checks). Real hardware later.
- Own **private** GitHub repo. A separate test page here, not a Leap-IDE profile. Files reach the desktop as **tapes**.
- Implementation goes step by step through the roadmap in `docs/FEASIBILITY.md`; each step starts with a short contract doc
  (what to build, the numbers to measure, the pass/fail bounds), as Leap Arcade does.

## Facts that bind the code

- Cartridge: LROS header `DB $00,$01 / DW ENTRY / DB $BC` at DOCK chunk 0. Entry starts with `DI`, sets its own stack
  (`$FF00` downward, chunk 7), `$FF` (DOCK selected) before `$F4`, then `$F4 = $33` (DOCK 0, 1, 4, 5).
- Never map a DOCK chunk over the stack. Keep RAM shadows of `$F4` and `$FF`; never read the ports back.
- TSRun fills RAM with random bytes at power-on: initialise every variable, and give test records a marker
  (see `RESULT` in `src/hello.asm`).
- TSRun drops a frame interrupt that arrives under `DI`: never hold `DI` across a frame boundary.
- Mode 6: byte column c is in file `c AND 1` (`$4000` / `$6000`) at offset `c >> 1`; the border follows the paper, so it
  cannot signal PASS/FAIL.
- TSRun's timings have no memory contention; real hardware will be slower on `$4000-$7FFF`.

## Working method

- Every routine gets a headless test against a reference model written from its spec (`tests/hello.mjs` is the pattern).
- Delegate routine research, doc updates and test runs to cheaper models (Sonnet / Haiku); keep design and debugging here.
- Commit only when the owner asks.
