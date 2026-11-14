# Paint: the playbook for the next session (2026-11-14)

**What this is.** A start-here guide for the session that builds Paint, written at the end of the session that did test speed, the
pool changes and the object-model audit. It gathers every decision and idea from that session and the ones before it. It is **not
the contract**: step 1 below writes `docs/PAINT.md`, and the owner approves it before any Z80 is written.

**Standing instruction (owner, 2026-11-14): "use lower cost agents for routine tasks and testing."** Pass `model` explicitly on every Agent call:
**Haiku** runs every test suite, baseline, regression run and emulator run and reports (give it the exact command and what to report, and tell it not to
modify files); **Sonnet** writes the reference models, the tests from a contract, generators, runners, doc updates and read-only surveys; the **main
model** does only design and contracts, the Z80 code, debugging and judging results. **Re-check an agent's result yourself** (read its logs, re-run the
suite it changed) before telling the owner it is done. Section 5 has the detail.

**Read first, in this order:** `CLAUDE.md` (the brief, the standing rules, the hand-off), `docs/FEASIBILITY.md` (the architecture), then this
file. Then, as the steps ask: `docs/SIZE.md`, `docs/OO_AUDIT.md`, `docs/APPLIB.md`, `docs/FILES.md`, `docs/WRITE.md` 14.9, `docs/KEYCAPS.md`
(the best small model of a program and its contract), `docs/TESTSPEED.md` 8-11.

## 0. Where things stand (end of the 2026-11-14 session)

- **Done and tested on TSRun** (20 suites: `node tools/runtests.mjs --compare <a good run's log dir>`, about 3-5 minutes; Fuse boot rows
  pass; the ZEsarUX runner covers Key Caps and Notepad's Find). Programs: 0 shell, 1 Calculator, 2 Key Caps, 3 Notepad.
- **The pool** (always-mapped chunks 0, 1, 4, 5) has **2,121 bytes free**, with a **1,000-byte reserve** for step 6 (the `shell-perf` row
  enforces it). DOCK 2-3 has **4,540 bytes free** (it holds `$4000-$6E44` of `$4000-$7FFF`). DOCK 6 is **not built yet** (`desk5` is
  chunks 0-5; the cartridge is planned at 56 KB, chunks 0-6).
- **`List` is a build switch** (`TK_LIST`, target `desk5l`): not in `desk5`. A tool palette or other grid is a new class, or `List`
  on a `desk5l`-style build; the contract decides, with the pool numbers.
- **Deferred to the end of the project (owner):** Notepad's faster search (`SIZE.md` 3).
- **Owner's vision (2026-11-14):** LeapG may become, like Leap Arcade, a **builder for graphical environments and apps**. So prefer
  selectable parts (build switches, the class generator's `guard`, table-driven tools) and a clean kernel ABI.

## 1. What Paint is (owner's words and decisions)

- **Paint in mode 6, mono, MacPaint-style** (CLAUDE.md, owner 2026-11-12). **Colour waits for the mode 2 graphics.** Mouse-driven (the
  Kempston mouse, `K_MSET`); the test page has a Mouse switch.
- **The Mac OS 1.0 look** is in place (`docs/LOOK.md`): white menu bar, striped title bars, close box on the left, 25% grey desk, 1-pixel shadows, the
  Mac arrow. Paint's tool box and patterns should look like that, with our own bitmaps, never Apple's.
- **Files through the desktop file interface** (`docs/FILES.md`): `FS_PICK`, `FS_OPEN`, `FS_READ`, `FS_WRITE`, `FS_CLOSE` and the name
  dialog from the app library. For now the browser answers (Save = name dialog then a download; Open = the file picker); TS-Pico later. Binary
  mode is "for Paint later" (FILES 2).
- **The order (owner):** Paint, then the **15-tile Puzzle**. Paint starts with the **DOCK 6 graphics library** (`SIZE.md` 4).
- **Every program is one at a time** and copies its RAM image (<= 1 KB, ends at or below `AL_RAM` = `$C3C0`) to `$C000`; its arena is `$C400-$DFFF`.
- **Do not re-ask the owner what CLAUDE.md "Decisions" already settles.** Ask only for what is genuinely new (section 6).

## 2. The ideas to use (from the whole conversation)

1. **Look for code to share before writing any** (the standing rule). Use `applib.asm` (view tables `AL_NEW` / `AL_VIEW` / `AL_VIEWS`, `AL_ALERT`,
   `AL_ASK`, `AL_NAMEDLG`, `AL_TITLE`, `AL_EXTNAME`), `files.asm`, `G_SAVERECT` / `G_RESTRECT` (already in the pool for the menus),
   `CWindow`, `Check`, `VScroll`, `Field`, and the kernel's double-click flag (`E_DOWN` data 3 bit 2, `K_DCLICK`: the owner added it
   "thinking specifically of Paint"). Put new shared code in the right place: the pool only if the kernel needs it always; the **DOCK 6 graphics
   library** for drawing that programs use but the kernel does not; the **app library in DOCK 2-3** for helpers that use a program's RAM.
2. **Keep the program procedural, objects at the UI layer** (`docs/OO_AUDIT.md`): programs never send messages; they define one `View` subclass
   for their own piece (the canvas) with banked `Draw` / `Event` through thunks, and use the toolkit's classes. No `App` base class (it costs about +60
   pool bytes and 340 T a message and saves nothing). `AL_RUN`, a shared app frame, saves about 5 bytes now and about 65 at six programs: **decide it
   in the contract** with Paint and the Puzzle in view (it is the only candidate that grows with programs).
3. **Make the parts selectable** (the builder vision): tools as a table (name, icon, handler, a build flag each), so a tool can be left out of a build.
4. **Measure before design** (`OO_AUDIT`, `SIZE`): bytes from `build/desk5/out.lst`, the free space from `shell-perf`, T-states from the perf rows.
   Contracts carry numbers to measure and pass / fail bounds, as `KEYCAPS.md` 4 does.
5. **Test everything against a model written from the contract** (`tests/kc-model.mjs`, `tests/kc-lib.mjs`, `tests/kc-k1.mjs` are the pattern), and
   keep the test machines fast (section 5).

## 3. Hard constraints (the numbers that shape the design)

- **Mapping.** K `$33` (display and heap), A `$3F` (+ DOCK 2-3: heap, **no display**), R `$73` (+ DOCK 6: display, **no heap**). Paint's code runs
  under A and **cannot touch the display directly**: it draws through the kernel (`KFAR`, `rst $28`). Every pointer handed to K code is in RAM, never
  in DOCK 2-3 or 6 (`docs/BANKING.md`). A DOCK 6 routine **cannot see the app arena** (`$C000-$DFFF` is DOCK 6 under R): its bitmaps and patterns
  must be in DOCK 6 or passed through the kernel's variables.
- **The picture does not fit the screen size.** A mode 6 screen is 12,288 bytes (two files of 6,144, byte column c in file `c AND 1` at offset
  `c >> 1`). The app arena is 7,168 bytes. So the canvas is a **window smaller than the screen**: for example 320 x 144 = 5,760 bytes, or 384 x 128 =
  6,144, less Paint's own variables. The contract fixes the size (FEASIBILITY 3: "no full-screen undo buffer").
- **DOCK 2-3 has 4,540 free bytes; FEASIBILITY guessed Paint at 5-6 KB.** That does not fit unless the drawing core moves to DOCK 6 (SIZE 4),
  Paint is kept lean, or something else gives (the zero-filled variables out of the images are about -336, sharing `w_gaview` about -85;
  `SIZE.md` / `OO_AUDIT` 3). **The contract must budget Paint's bytes first**, and ask the owner if the budget does not close.
- **Pool:** 2,121 free, reserve 1,000: 1,121 to spend. `SIZE.md` 4 moves `G_LINE` + `G_ADDR` (1,303), `G_BLIT` (948), `G_SCROLLV` (1,526) to DOCK 6:
  about **+3,800** pool. (The audit measured `G_LINE` + `LN_TAB` at about 1.3 KB and found `G_ADDR` has no caller in `desk5`; use the build's numbers.)
  `G_SAVERECT` + `G_RESTRECT` (about 950 bytes) stay in the pool for the menus; Paint can use them.
- **DOCK 6 is 8 KB**, read-only, for resources and display-free or display-only code. It holds the moved library (about 3.8 KB), Paint's patterns,
  brushes, tool icons and cursors, and later fills and shapes. Budget it too.
- **No backing store for windows** (the kernel redraws from the object model). A Paint window that is exposed redraws its canvas from Paint's own
  copy of the picture. **Drawing on the visible screen has no flip, so flicker is designed out** (`GRAPHICS_SPIKE`, FEASIBILITY 3a): the pointer
  is shielded (`P_SHIELD` / `P_UNSHIELD`) around any drawing under it; follow how Notepad's selection and the window-drag outline do it.
- **TSRun's timings have no memory contention;** real hardware is slower on `$4000-$7FFF`. State bounds with that in mind.

## 4. Architecture to evaluate in the contract (a proposal, not a decision)

- **The canvas lives in the arena in the screen's own byte layout** (byte-aligned x, the mode 6 file split), with a small header. Then a redraw is
  `G_RESTRECT` of the visible byte rectangle (already built, already tested), a save is `G_SAVERECT`, and a file is the rows written out.
- **Tools draw on the display with gfx6, then the changed byte rectangle is saved back** with `G_SAVERECT`. That reuses the existing drawing
  (`G_FILL`, `G_FRAME`, `G_LINE`, `G_TEXTP`) without a retargetable gfx6, and costs one rectangle save a stroke. Measure it: if it is too slow for a
  freehand stroke at mouse speed, the alternative is a retargetable draw (a base address in the library), which is a bigger change.
- **Rubber-banding with the XOR op** (`G_SETOP` 2) for lines, rectangles and ovals, as the window drag outline already does; commit on release.
- **A one-level undo that fits:** save the byte rectangle a tool is about to change (known up front for shapes and fills of a region, grown as a
  stroke goes for freehand) into a second buffer; undo restores it. Bound the buffer; say what Undo cannot do (MacPaint had one level too).
- **File format:** a small header + the packed rows, or **PBM (P4)**, written by the Z80 (a text header and packed 1-bit rows; any viewer opens it,
  no converter in the page). The contract chooses; the browser backend already handles binary mode.
- **FatBits zoom** by nearest-neighbour scaling (FEASIBILITY: Arcade's DDA scaling, 76-143 T a pixel). It is a late slice.

## 5. How to work (the standing rules, with what this session learned)

- **Models:** the **main model** does design, contracts, Z80 code, debugging and judging results. **Sonnet** writes the reference models, the tests
  from the contract, generators, runners, doc updates and read-only surveys. **Haiku** runs suites and emulator runs and reports (give it the exact
  command and what to report). Pass `model` explicitly. **Re-check an agent's result yourself** (read its logs, re-run the suite it changed) before
  telling the owner it is done. A **Fable** worktree only for a bounded hard problem with a measurable result (for example a flood fill or an
  oval that misses its speed bound), and it costs twice Opus: not for routine work.
- **Tests:** `node tools/runtests.mjs --compare <a good run's log dir>` runs all 20 suites in a pool (about 3-5 minutes; the logs are in
  `build/test-logs/<time>/`); add Paint's suites to its list (`tools/runtests.mjs` `DEFAULT_SUITES`) and to the hand-off's suite list. Test machines run
  **with drawing off** and from the **shared ROM-boot snapshot** (`boot(dck, { video: false })`): compare the **display RAM** (`$4000-$57FF`,
  `$6000-$77FF`) with the model, not `m.pixels` (it throws when drawing is off; `TS_VIDEO=1` turns drawing on, `TS_COLDBOOT=1` boots cold).
  **Never edit a test or rebuild `build/desk5` while a run is in progress** (processes that start later read the edit). One build at a time. Suites
  that only read the prebuilt `build/desk5.dck` may run side by side. A suite that needs `List` boots `desk5l`.
- **Cross-emulator:** `tools/xemu/zesarux-desk5.py` (ZEsarUX 13.0 through ZRCP; it runs `desk5-ref.mjs` first) and `fuse-desk5.sh` (Fuse 1.9.1).
  Give Paint a session in both, in the style of the Key Caps and W4 ones. The kernel now straddles chunks 4 and 5 (it starts at `$9E00`); Fuse and ZEsarUX both pass.
- **Commit checkpoints as the work goes** (the owner's standing request): a slice's code once it runs, then its tests once re-run. Push when the owner asks.
- **The gates, in order, each with the owner:** the contract and its mock-ups (PNG from a JS model, current beside proposed, in `docs/paint/`, as
  `tools/kc-mock.mjs` and `tools/look-mock.mjs` do); then each slice **tried by the owner in the browser** (`web/`) and accepted, with the bounds set to the
  measured figures.
- **Gotchas found on the way:** TSRun fills RAM with random bytes at power-on, so initialise every variable and give test records a marker; a frame
  interrupt that arrives under `DI` is dropped; stepping instruction by instruction can drop a frame's interrupt; the `shell-perf` `DI` sweep is a
  linear decode and now knows `rst $28` takes a 2-byte operand; a new class goes through `tools/gen-classes.mjs` (the `guard` line makes one
  optional); a worktree comes from the LeapG repo, not the Agent tool (CLAUDE.md "Worktrees").

## 6. The steps

1. **Orientation (30 minutes).** `git log -5`, `node tools/build.mjs`, `node tools/runtests.mjs --compare <the latest good log dir in build/test-logs>` through
   Haiku (all 20 pass, 0 differing lines), read the files named above, and look at `src/apps/keycaps.asm` start to end (519 lines; the smallest real program).
2. **The contract `docs/PAINT.md`** (main model, with a Sonnet survey for any facts it needs, and mock-ups from `tools/paint-mock.mjs`):
   - the window, the tool box, the pattern palette, the menus (Leap, File: New / Open / Save / Quit; Edit: Undo / Clear; Options), with pixel sizes;
   - the tools and their order of arrival; the canvas size; the byte budget for Paint in DOCK 2-3 and for the library in DOCK 6 and the pool;
   - the behaviour (the mouse, the keys, the status line, the cursor shapes), the file format, the undo, the numbers to measure, the pass / fail bounds;
   - the questions for the owner (section 7), **asked in the contract, not by chat**.
   Stop for the owner's approval.
3. **SIZE 4: the DOCK 6 graphics library** (its own small contract in `SIZE.md` 4 / `docs/GFXLIB.md`): build chunk 6 into `desk5` (56 KB), move
   `G_LINE` + `G_ADDR`, `G_BLIT` (with the shell's icons in DOCK 6) and `G_SCROLLV`, reach them by `KFAR` / the thunks, replace Check's X by five `G_FILL`
   rectangles. The pixels must be unchanged: every existing suite passes with identical logs, then the pool's free bytes are re-measured. Check Fuse and ZEsarUX.
4. **The slices, each: a contract section, a model + tests (Sonnet), the Z80 (main model), tests re-run (Haiku, then you), the owner tries it, commit.**
   A suggested order, for the owner to change:
   - **P1** the program, the window, the canvas in the arena, redraw after exposure, the pencil and eraser, Clear, New, Open, Save, Quit with the discard question.
   - **P2** the pattern fill (a new DOCK 6 routine taking an 8 x 8 pattern) and the brush shapes; line, rectangle, rounded rectangle, oval, outlined and filled, with the XOR rubber band.
   - **P3** the flood fill, the marquee / lasso select, move and Undo.
   - **P4** FatBits (zoom), the grabber (hand), a status line; text if there is room.
   - Then the **15-tile Puzzle** (its own contract), then colour with mode 2.
5. **Hand-off at the end of each session:** update `CLAUDE.md` (state, next steps, the suites list), `docs/PROVENANCE.md` for anything copied, and record each
   slice's measured figures in its contract (as `TESTSPEED.md` 8-11 and `SIZE.md` 6-7 do).

## 7. Questions to put to the owner in the contract

1. The **canvas size** (one number of bytes: 320 x 144, 384 x 128, or other) and whether a picture bigger than the window (scrolling over a larger
   canvas) is wanted, given the 7 KB arena.
2. **Paint's byte budget** in DOCK 2-3 (4,540 free for everything else too) and whether to take the zero-filled-variable and `w_gaview` savings now.
3. The **tools and patterns** to build first (the suggested order above) and which can wait.
4. The **file format** (a private header, or PBM P4) and the extension.
5. **Undo:** what it covers (the last shape or fill, not a whole freehand stroke?).
6. **`AL_RUN`:** build the shared app frame now for Paint and the Puzzle, or keep each program's own frame.
