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
  assumes the port equals the shadow. Safe at every instruction boundary by reasoning; exercised by `docs/PROBE_DOCK23.md` (about
  900 interrupts per emulator), not yet by interrupt injection at every instruction.
- Application code may run in DOCK 2-3 (`$F4 = $3F`); it reaches the display only through kernel trampolines.
- TSRun fills RAM with random bytes at power-on: initialise every variable, and give test records a marker
  (see `RESULT` in `src/hello.asm`).
- TSRun drops a frame interrupt that arrives under `DI`: never hold `DI` across a frame boundary.
- Mode 6: byte column c is in file `c AND 1` (`$4000` / `$6000`) at offset `c >> 1`; the border follows the paper, so it
  cannot signal PASS/FAIL.
- TSRun's timings have no memory contention; real hardware will be slower on `$4000-$7FFF`.
- Kernel layout (step 4): the main part is in DOCK chunk 5 (`$A000-$BFFF`, full); the menus are a second part,
  `src/kernel/kernel1.asm`, assembled by each cartridge in chunk 1 after the gfx6 tables. Test cartridges keep their own code in
  chunk 1 too. About 4.5 KB of the always-mapped pool is left (`docs/WINDOWS.md` 16.8).
- Input: CAPS SHIFT + 1 = TAB, CS + 4 = ESC; BREAK counts as ESC in the window manager. A Kempston mouse (ports `$xxDF`) is
  read when `K_MSET` turns it on; TSRun emulates it as `m.mouse`, and the test page has a Mouse switch.
- Step 5 starts with a short contract on what stays always mapped and what runs banked (chunks 2-3, 6), with the trampoline
  cost measured, before any toolkit or app code.

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
- Commit only when the owner asks.
