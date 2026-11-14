# Leap Desktop — brief for Claude sessions

Read `docs/FEASIBILITY.md` first (the architecture and the roadmap), then this file.

## Decisions (owner, 2026-11-11; do not re-ask)

- Separate project from Leap V2 and Leap-IDE. Reuse by **copying** with an entry in `docs/PROVENANCE.md`; never edit `~/2068-Leap`
  (frozen) or `~/Projects/Leap-IDE` from here.
- Desktop video mode **6** (512x192, black ink on white paper, `$FF = $06`); per-app modes 0 and 2 on the same memory map.
- Test target: **emulators** (TSRun headless and in `web/`; ZEsarUX 13.0 and Fuse 1.9.1 for cross-checks). Real hardware later.
- Cartridge planned at **56 KB** (DOCK 0-6): always-mapped code 32 KB (chunks 0, 1, 4, 5); banked apps in 2-3; resources and
  display-free kernel code in 6 (`docs/CODE_SIZE.md`). Size work that costs speed waits for a measured shortfall.
- Own **private** GitHub repo. A separate test page here, not a Leap-IDE profile. Files reach the desktop as **tapes** (amended 2026-11-12, below: files through the browser for now, TS-Pico later).
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
- Input: CAPS SHIFT + 1 = TAB, CS + 4 = ESC; BREAK counts as ESC in the window manager. The test page sends every key to the
  keyboard; the TS2068 joystick comes only from a gamepad (owner, 2026-11-12: never mapped to keys). A Kempston mouse (ports `$xxDF`) is
  read when `K_MSET` turns it on; TSRun emulates it as `m.mouse`, and the test page has a Mouse switch.
- Step 5 placement (owner, 2026-11-12): toolkit always mapped; shell, Calculator, Write in DOCK 2-3; DOCK 6 for resources and
  later Paint's drawing core. Step 5's pool growth <= 3,400 bytes (3,029 used after T2 / T3).
- Step 5 cartridge `desk5` (DOCK 0-5): boots into the shell (`docs/SHELL.md`). Programs: 0 shell, 1 Calculator, 2 Controls (window (176, 32, 320, 144), with a `List` and a `Field`), 3 Write (`src/apps/write.asm`, `docs/WRITE.md`; its symbols take the prefix `WR_`; `WR_MENU` is banked, so tests call it under A); one
  at a time through `K_LAUNCH` / `K_QUIT`; each copies its RAM image to `$C000` (<= 1 KB); app arena `$C400-$DFFF`. Windows
  that programs close are `CWindow`s (close box; SYMBOL SHIFT + Q = key code `CLOSE` 17). Programs dispatch with `TK_DISPATCH`.
- Tests that use `desk5` boot through the shell (`tests/calc-lib.mjs` `bootDesk5`, `tests/shell-lib.mjs`).
- SYMBOL SHIFT layout: accepted by the owner after typing with it in T3's `Field` (2026-11-12).

## Working method

- Every routine gets a headless test against a reference model written from its spec (`tests/hello.mjs` is the pattern).
- Cross-emulator runs: `tools/xemu/` (ZEsarUX through ZRCP, Fuse through a movie converted to `.scr` frames).
- **TSRun is a fork shared with Leap-IDE** (`nchiker/TSRun`): follow the rules in `docs/TESTSPEED.md` 6 (main only moves by
  fast-forward, pin commits on main, push TSRun first, tell the other session; core changes are proposed to it first).
- Stepping TSRun instruction by instruction can drop that frame's interrupt: count interrupts only over frames run normally.
- Never run two tests of the same cartridge at once **when they build it** (`build/<name>` collides). Suites that only read a
  prebuilt `build/<name>.dck`, such as every `desk5` suite through `loadDesk5`, may run side by side (owner, 2026-11-14;
  `docs/TESTSPEED.md` 2).
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
- **Look for code to share (owner's standing rule, 2026-11-14).** In every contract and every slice, look for code that another
  program has or will need, and share it instead of copying it:
  Shared code goes in one of three places (owner, 2026-11-14: "keep programs light in code if there is a shared
  opportunity"):
  - **The kernel pool** (always mapped; the scarcest): what the kernel itself needs or must run under K. That is windows,
    menus, events and the toolkit, the drawing they use all the time, and flags every program reads, such as the
    double-click flag in `E_DOWN` (WRITE 14.9).
  - **The graphics library in DOCK 6** (mapping R, reached by `KFAR` from any program or the kernel): drawing that programs
    use but the kernel does not need constantly. It holds line drawing and `G_BLIT`, `G_SCROLLV`, flood fill and pattern
    fills as they come. It cannot see a program's RAM image, so its arguments go through the kernel's variables, and the
    bitmaps it draws must be visible under R.
  - **The app library in DOCK 2-3** (mapping A, a plain `CALL`): program-level helpers that use a program's RAM.
    `files.asm` (FILES) and `applib.asm` (`docs/APPLIB.md`: view tables, dialogs, the alert, the ask, the name dialog, the
    title, file naming) are here.
  A program keeps only what is its own.
  Each contract says what it shares and what it could share. This follows the object model (shared classes and calls) and
  keeps programs small.
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
- **Write W1 is done** (ZEsarUX 62 of 62; Fuse boot rows); the owner tried it and accepted it, scroll bounds at the measured
  figures (`docs/WRITE.md` 11.10).
- **Write W2 is done** (selection and clipboard, `docs/WRITE.md` 12; ZEsarUX 95 of 95, Fuse boot rows). The owner tried it
  with the mouse and accepted it; the report rows are bounds at the measured figures (12.13).
  - Selecting by keys is **MARK** (SS+E, code 18; Ctrl+E on the test page): SHIFT cannot work on the TS2068 (12.1). No
    keyboard shortcuts for Cut / Copy / Paste (owner).
  - The clipboard is Write's own, 2,048 codes at **`$7800`** (cold RAM, under K), copied by `KFAR K_LDIR` (a label on
    `k_zero`'s `ldir` / `ret`: 0 pool bytes). A paste that may be refused keeps overwritten codes at `$5800` (12.11).
  - Autoscroll while dragging may be revisited (12.10: options (a) and (b)).
- **Next:**
  - **Files (owner, 2026-11-12):** one desktop file interface shaped like TS-Pico's channel calls (open by name to read or
    write, read / write in chunks, close). For now the test page answers it, as Leap-IDE does: Save = a desktop name
    dialog, then a browser download; Open = the browser's file picker. Later a TS-Pico driver (ports `$0E` / `$0F`,
    `tpi:chopen` / `chrd` / `chwr` / `chclose`; `~/Projects/TS-Pico-Study`) answers the same calls. This replaces "tape
    services before W3". Contract `docs/FILES.md` (owner approved, 2026-11-12).
  - **Order (owner, 2026-11-12; amended 2026-11-14):** W3 (Open / Save), then double-click and Find in Write, then the test-speed slice (`docs/TESTSPEED.md`, owner approved
    2026-11-14, Arcade's TSRun speed-ups; the owner approved taking its silent-AY change into our TSRun copy), then the app
    library (`docs/APPLIB.md`: Notepad's dialogs and title shared from DOCK 2-3, Notepad moved onto it unchanged), then
    Paint in mode 6 (mono, MacPaint-style; colour waits for the mode 2 graphics). Fonts and styles in Write: not planned.
- **W3 is done (2026-11-13):** the bridge, `web/fshost.js`, the page, `src/apps/files.asm`, Write's Open and Save
  (`docs/WRITE.md` 13.9, `docs/FILES.md` 10); ZEsarUX 131 of 131 (no bridge: Save shows the alert); the owner accepted it.
  The TSRun commits `d9302b8` and `b4dc564` are pushed to the fork (2026-11-13).
- **Look slice (owner, 2026-11-13), after W3:** a Mac OS 1.0 style, no more than: a white menu bar (black text, a line under,
  the selected title inverted), striped active title bars with the title centred, the close box on the left, a grey (dithered)
  desktop, 1-pixel drop shadows on windows and menus, and a Mac-style arrow pointer. Our own bitmaps, not Apple's. Start with a
  contract and PNG mock-ups from the JS models (current beside proposed) for the owner. gfx6 has no pattern fill yet; the pool
  has about 371 bytes of step 5's growth left (DOCK 6 under R is an option for drawing code).
  - **Contract `docs/LOOK.md`; the owner chose (2026-11-13, LOOK 8):** the proposed look, a **25% grey** desk with today's
    drag outline, the **Mac arrow**, **`desk5` only** (`LOOK_MAC`). Bound <= 250 pool bytes. Mock-ups in `docs/look/`
    (`node tools/look-mock.mjs`); `tests/look-model.mjs` is the reference model.
  - **L1 built and tested on TSRun (2026-11-14, LOOK 10):** pool +157 (step 5 growth about 3,186 of 3,400); every `desk5`
    suite passes. The window draw / open / raise bounds are the measured figures (owner: about +25,000 T, 7 ms). The test
    page fits the window at any size again (owner: whole-number scaling was too small; the grey's moire there is the
    browser's scaling). ZEsarUX 131 of 131, Fuse 6 of 6. **The owner tried it and accepted it: L1 is done.**
- **W4 (2026-11-14), `docs/WRITE.md` 14 with the as-built amendments in 14.9:**
  - **Built and committed:** double-click word selection, and Find... / Find again in Notepad. The kernel marks a double-click in `E_DOWN` data 3
    bit 2 (`K_DCLICK`, `desk5` only). The shell and `List` use the flag. Find shares the Save dialog.
  - **Sizes:** Notepad 6,943 of 7,000 bytes; pool +59 (step 5's growth about 3,245 of 3,400).
  - **The owner tried it:** "double click and find work in my test run" (14.10).
  - **Tests:** `wr-w4`, `kern-dclick` and the W4 rows of `wr-perf` are written, and every suite passes. The bounds were reset
    by the owner (14.11). Still to do: the ZEsarUX key-driven Find session (14.7 item 7).
- **App library (2026-11-14), `docs/APPLIB.md`, `src/apps/applib.asm`:**
  - **What it is:** view tables (`AL_NEW`, `AL_VIEW`, `AL_VIEWS`, `AL_ADD`), dialogs, the alert, the ask, the name dialog,
    the title and the extension rule.
  - **Who uses it:** Notepad, the shell, Calculator and Key Caps. Notepad is 6,474 bytes. Its test is `tests/al-a1.mjs`.
- **Key Caps (program 2, 2026-11-14), `docs/KEYCAPS.md`:** it replaces the Controls demo, whose test `tk-demo` is retired.
  Its test is `tests/kc-k1.mjs`.
- **Key Caps on the TS2068's layout (owner, 2026-11-14), KEYCAPS 7-8:**
  - five rows, one legend a key in the plane shown;
  - the mock-ups are `docs/keycaps/kc3-*.png` (`node tools/kc-mock.mjs`);
  - 1,113 bytes, under the 1,225 bound;
  - the owner accepted its speed: "keycaps speed is fine - no effort needs to be spent on this".

## Hand-off (2026-11-14, end of the W4 / app library / Key Caps session)

**Working rule, repeated because it matters (owner, 2026-11-14: "use lower cost agents for routine tasks and testing"):**
- **Haiku runs** every test suite, baseline and regression run.
- **Sonnet does:**
  - the models and tests written from a contract;
  - updates to tests after a contract change;
  - read-only surveys and size reviews;
  - generators and runners.
- **The main model does only:**
  - design and contracts;
  - the Z80 code;
  - debugging;
  - judging results.
- **The main model re-checks before telling the owner something is done:** it reads the agent's logs and re-runs the suite it
  changed.
- **Test speed is done (2026-11-14, `docs/TESTSPEED.md` 8-11):** `node tools/runtests.mjs --compare <good run's log dir>` runs all 20 suites in a pool (about 210 s, was 1,505 s); the tsrun pin is `6ccf56e`; `desk5` suites run with drawing off (`boot(dck, { video: false })`, `TS_VIDEO=1` turns it on) and from the shared ROM-boot snapshot (`TS_COLDBOOT=1` boots cold). A test that reads `m.pixels` must ask for `{ video: true }`.
- **One `desk5` build at a time;** do not run suites while a build changes `build/desk5`.
- **Use a LeapG git worktree** for code that would rebuild under a running suite (see Working method).

**State:**
- **Branches:** `main` holds everything, and the worktrees are removed. TSRun is pinned at `6ccf56e` (the fork's main, 2026-11-14).
- **Tests:** after the last Key Caps change, `kc-k1` passes 9 of 9. The merged build passed every suite before it (all 19 and
  `desk5-ref`).
- **The test-speed baseline is recorded** in `docs/TESTSPEED.md` 7: every suite passes, 1,505 s one at a time (now 210 s through the runner, section 11). Each S step was
  compared with it.
- **The suites:**
  `al-a1 kc-k1 calc-c1 shell-s1 tk-t1 tk-t2 tk-t3 wr-w1 wr-w2 wr-w3 wr-w4 wr-demo fs-f1 kern-dclick web-smoke calc-perf
  shell-perf tk-perf wr-perf`, plus `node tools/xemu/desk5-ref.mjs`. `web-smoke` needs `build/hello.dck`, and `calc-perf`
  needs `build/kern4`.

**Next, in order (all owner-approved):**
1. **Test speed (`docs/TESTSPEED.md`): DONE (S1-S4).** The steps below are kept for the record.
   - **S3:** move the `tsrun` pin to `6ccf56e`, the fork's main. Copy Arcade's `tests/tsrun-ay-silent.mjs` from
     `~/Projects/Leap-IDE`, read only, with a `docs/PROVENANCE.md` entry. Keep the fork's rules, TESTSPEED 6.
   - **S1:** screen drawing off (`M.setVideoOn(m, false)`), with a guard on every `m.pixels` read.
   - **S2:** boot once, where it pays.
   - **S4:** the parallel runner.
2. **The safe pool changes (`docs/SIZE.md` 1): DONE with `List` made a build switch (SIZE 6-7): the pool has 2,121 bytes free (was 930), the free-space measure is in `shell-perf`.** Kept for the record, about +1,055 bytes:
   - the kernel at `$9E00`;
   - `ROWTAB` at `$0200`;
   - `G_CLS`, `G_VLINE`, `G_ROWADDR` and `K_WARP` left out of `desk5`;
   - the masks shared.

   Then the pool's free-space measure with its 1,000-byte reserve (SIZE 2), replacing step 5's growth bound in
   `shell-perf`.
3. **Notepad's faster search (SIZE 3).**
4. **The ZEsarUX runs:**
   - W4's key-driven Find session (WRITE 14.7 item 7);
   - Key Caps in `tools/xemu/zesarux-desk5.py`: what it needs is listed in the Key Caps test agent's notes, `refk["kc"]`, the
     checkpoints `kc`, `kc-q`, `kc-ss`, `kc-radio` and `back2`;
   - Fuse's boot rows.
5. **Paint:** a contract and mock-ups first. It starts with the DOCK 6 graphics library (SIZE 4): `G_LINE` with `G_ADDR`,
   `G_BLIT` with the shell's icons, `G_SCROLLV`; Check's X as five rectangles. Then the **15-tile Puzzle** (after Paint).

- **Owner (2026-11-13):** W3 tried in the browser and accepted. Program 3 is now shown as **Notepad** (icon, "Leap" menu,
  title "Notepad: name", alerts); the code, `docs/WRITE.md` and the `WR_` symbols keep the name Write (WRITE 13.10).
