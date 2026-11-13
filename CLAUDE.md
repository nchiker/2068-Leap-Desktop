# Leap Desktop — brief for Claude sessions

Read `docs/FEASIBILITY.md` first (the architecture and the roadmap), then this file.

## Decisions (owner, 2026-11-11; do not re-ask)

- Separate project from Leap V2 and Leap-IDE. Reuse by **copying** with an entry in `docs/PROVENANCE.md`; never edit `~/2068-Leap`
  (frozen) or `~/Projects/Leap-IDE` from here.
- Desktop video mode **6** (512x192, black ink on white paper, `$FF = $06`); per-app modes 0 and 2 on the same memory map.
- Test target: **emulators** (TSRun headless and in `web/`; ZEsarUX 13.0 and Fuse 1.9.1 for cross-checks). Real hardware later.
- Cartridge planned at **56 KB** (DOCK 0-6): always-mapped code 32 KB (chunks 0, 1, 4, 5); banked apps in 2-3; resources and
  display-free kernel code in 6 (`docs/CODE_SIZE.md`). Size work that costs speed waits for a measured shortfall.
- Own **private** GitHub repo. A separate test page here, not a Leap-IDE profile. Files reach the desktop as **tapes**.
- Implementation goes step by step through the roadmap in `docs/FEASIBILITY.md`; each step starts with a short contract doc
  (what to build, the numbers to measure, the pass/fail bounds), as Leap Arcade does.

## Facts that bind the code

- Cartridge: LROS header `DB $00,$01 / DW ENTRY / DB $BC` at DOCK chunk 0. Entry starts with `DI`, sets its own stack
  (`$FF00` downward, chunk 7), `$FF` (DOCK selected) before `$F4`, then `$F4 = $33` (DOCK 0, 1, 4, 5).
- Never map a DOCK chunk over the stack. Keep RAM shadows of `$F4` and `$FF`; never read the ports back. Store the shadow
  **before** each `OUT`.
- An ISR that touches the display maps the display (`$F4 = $33`) itself, then writes the **shadow** back to the port. It never
  assumes the port equals the shadow. Proven by interrupt injection at every instruction boundary of the far call
  (`docs/BANKING.md` 11.1).
- Three mappings (`docs/BANKING.md`, owner approved): K `$33` (kernel: display and heap), A `$3F` (+ DOCK 2-3: heap, no
  display), R `$73` (+ DOCK 6: display, no heap). Banked code crosses with `rst $28 / DW target` (`KFAR`, `src/kernel/far.asm`;
  331-352 T a round trip); the kernel reaches banked methods through 4-byte RAM thunks (`KTHUNK`). Every pointer handed to K
  code is in RAM, never in DOCK 2-3 or 6; a banked program's classes, strings and menu tables live in its RAM image.
- TSRun fills RAM with random bytes at power-on: initialise every variable, and give test records a marker
  (see `RESULT` in `src/hello.asm`).
- TSRun drops a frame interrupt that arrives under `DI`: never hold `DI` across a frame boundary.
- Mode 6: byte column c is in file `c AND 1` (`$4000` / `$6000`) at offset `c >> 1`; the border follows the paper, so it
  cannot signal PASS/FAIL.
- TSRun's timings have no memory contention; real hardware will be slower on `$4000-$7FFF`.
- Kernel layout: the main part is in DOCK chunk 5 from `$A000`; the menus are a second part, `src/kernel/kernel1.asm`,
  assembled by each cartridge in chunk 1 after the gfx6 tables. Step 5 cartridges add, after the kernel in chunk 5, the toolkit
  (`src/kernel/tk.asm`, classes in `tk-classes.txt`) and the launcher (`launch.asm`); `far.asm` sits in page 0's hole at
  `$0068`. `List` and `Field` are in `src/kernel/tk2.asm`, assembled in chunk 1 after `kernel1.asm`. The pool had 4,483 bytes
  free before step 5 (`docs/BANKING.md` 1); step 5 has used 3,029 of its 3,400.
  `kern3` / `kern4` / `bank5` keep their own layouts and stay as they were (one `KEYMAP` byte changed: SS+Q).
- Input: CAPS SHIFT + 1 = TAB, CS + 4 = ESC; BREAK counts as ESC in the window manager. A Kempston mouse (ports `$xxDF`) is
  read when `K_MSET` turns it on; TSRun emulates it as `m.mouse`, and the test page has a Mouse switch.
- Step 5 placement (owner, 2026-11-12): toolkit always mapped; shell, Calculator, Write in DOCK 2-3; DOCK 6 for resources and
  later Paint's drawing core. Step 5's pool growth <= 3,400 bytes (3,029 used after T2 / T3).
- Step 5 cartridge `desk5` (DOCK 0-5): boots into the shell (`docs/SHELL.md`). Programs: 0 shell, 1 Calculator, 2 Controls (window (176, 32, 320, 144), with a `List` and a `Field`), 3 Write (`src/apps/write.asm`, `docs/WRITE.md`; its symbols take the prefix `WR_`); one
  at a time through `K_LAUNCH` / `K_QUIT`; each copies its RAM image to `$C000` (<= 1 KB); app arena `$C400-$DFFF`. Windows
  that programs close are `CWindow`s (close box; SYMBOL SHIFT + Q = key code `CLOSE` 17). Programs dispatch with `TK_DISPATCH`.
- Tests that use `desk5` boot through the shell (`tests/calc-lib.mjs` `bootDesk5`, `tests/shell-lib.mjs`).
- SYMBOL SHIFT layout: accepted by the owner after typing with it in T3's `Field` (2026-11-12).

## Working method

- Every routine gets a headless test against a reference model written from its spec (`tests/hello.mjs` is the pattern).
- Cross-emulator runs: `tools/xemu/` (ZEsarUX through ZRCP, Fuse through a movie converted to `.scr` frames).
- Stepping TSRun instruction by instruction can drop that frame's interrupt: count interrupts only over frames run normally.
- Never run two tests of the same cartridge at once: each rebuilds `build/<name>`, and they collide.
- **Use lower-cost subagents for routine work (owner's standing instruction).** Pass the `model` explicitly when spawning:
  - **Sonnet:**
    - source surveys and research (reading Leap-IDE, Leap V2, TSRun, the manual);
    - reference models and test files written from a contract;
    - generators (`tools/gen-*.mjs`);
    - doc updates from known facts;
    - cross-emulator runners.
  - **Haiku:** running test suites and emulator runs, and reporting the results (give the exact commands and what to report).
  - **Main model only:** design, contracts, Z80 drawing / ISR / banking code, debugging, and judging results. Check a subagent's result (re-run its tests) before telling the owner it is done.
  - **Fable (owner, 2026-11-11):** bounded hard problems that can run beside the main work, each in its own git worktree with a
    measurable result:
    - closing a missed or tight speed bound, as step 3's option D did (`G_FILL` 32x16 XOR, once listed here, already passes at 3,246);
    - an independent review of the S4 pointer ISR, given the code and the contract, not the main model's reasoning.

    Fable costs twice Opus per token: not for routine work.
  - **Worktrees come from the LeapG repo,** not from the Agent tool's `isolation: "worktree"`: that one branches `~/Projects`,
    a different repo. Before spawning, from `~/Projects/LeapG`:
    `git worktree add .claude/worktrees/<name> -b <name>`, then in it `rmdir tsrun && ln -s ../../../tsrun tsrun`
    (`tsrun` is a submodule). Give the agent that path. Remove it with `git worktree remove --force` and `git branch -D`.
    A worktree starts from a commit: commit first (or copy the uncommitted state in), and merge the agent's diff back only after
    re-running its tests in the main tree.
- Commit only when the owner asks. **Standing request (owner, 2026-11-12): commit checkpoints as the work goes** (a slice's
  code once it runs, then its tests once re-run), so that nothing is lost if a usage limit cuts a session off.

## Where step 5 stands (hand-off, 2026-11-12)

- **Done on three emulators**, each with Sonnet's model and tests, re-run by the main model:
  - B0, the far call (`docs/BANKING.md`);
  - Calculator (`docs/CALCULATOR.md`);
  - toolkit T1: `Check`, `VScroll`, and `CWindow` (`docs/TOOLKIT.md`);
  - the shell and the launcher (`docs/SHELL.md`).
- **Toolkit T2 (`List`) and T3 (`Field`) are done** (ZEsarUX 42 of 42; Fuse boot rows); the owner reviewed the grown
  Controls demo and accepted it (`docs/TOOLKIT.md` 10.10).
- **The owner approved the desktop's look,** icons included (2026-11-12: "desktop looks great").
- **The `VScroll` 12 x 80 draw bound is 47,700 T** (owner, 2026-11-12).
- **Write W1 is done on emulators** (ZEsarUX 62 of 62; Fuse boot rows). It awaits the owner's try and the scroll bound
  (`docs/WRITE.md` 11.9).
- **Next:**
  - The owner's try of Write and the scroll bound.
  - Then W2 (selection and clipboard), then tape services before W3.
