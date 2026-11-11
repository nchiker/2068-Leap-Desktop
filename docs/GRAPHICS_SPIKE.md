# Mode 6 graphics spike: contract (draft 2, 2026-11-11)

Roadmap step 2's first slice (`docs/FEASIBILITY.md`). Binding for the spike's code, tools and tests. An "As built" section is added
when it is done.

**Draft 2 (owner approved the changes, 2026-11-11):**
- `G_CLS` keeps interrupts enabled (draft 1's `DI` pieces would lose interrupts on TSRun and push the pointer past its deadline);
- no code keeps interrupts off for more than 1,500 T;
- bounds re-based on cycle counts (full-screen fill, vertical line, inverted 8x8 text, proportional text);
- an exact pointer deadline, and the ISR skips an unmoved pointer;
- proportional glyphs up to 8 columns wide;
- a line-height setting;
- `G_SAVERECT`, `G_RESTRECT` and `G_SCROLLV` added.

Style as Leap Arcade's contracts: every number in section 7 is a bound; **a missed bound is reported with its
numbers before anything is changed, and the engineer never weakens a bound**.

## 1. Why

The feasibility review left three mode 6 questions that only running code can answer:

1. **Text speed:** 8x8 text and proportional text in the alternating display files.
2. **Drawing on the visible screen:** mode 6 has no spare file, so there is no flip. Can a pointer and repaints be drawn without flicker or tearing?
3. **What the alternating files cost:** pixel-precise rectangles, lines and blits.

The spike answers them with a small graphics library, `gfx6`, and measurements. It is not the kernel: no objects, no events, no windows.
If the spike passes, its routines become the kernel's graphics core. If it misses bounds, the review's mode decision is revisited with
the numbers.

## 2. Scope

**In:**
- the `gfx6` routines of section 5;
- the table and font generators of section 6;
- the tests of section 8;
- a demo cartridge `spike6` for looking at by eye (section 9).

**Out:**
- banking (DOCK 2-3: the separate probe, `docs/PROBE_DOCK23.md`);
- the object system, events and window manager;
- modes 0 and 2 (the core is written so they can be added: one row table, a per-mode byte step);
- contention (TSRun has none; real hardware is a later phase).

## 3. Machine and memory (cartridge shape of `hello`)

| What | Where |
|---|---|
| Code and constant tables | DOCK chunks 0-1 (`$0000-$3FFF`) and 4-5 (`$8000-$BFFF`), mapped all the time (`$F4 = $33`). Page-aligned tables in chunk 4-5 |
| Display | `$4000-$57FF` (even byte columns), `$6000-$77FF` (odd byte columns). `$FF = $06`: black ink, white paper |
| Variables | `$E000-$E0FF` |
| Pointer save-under and pre-shifted pointer images | `$E100-$E7FF` |
| Save-under buffer for `G_SAVERECT` (menus, dialogs) and scratch | `$E800-$EFFF` (2 KB) |
| Stack | `$FB00-$FEFF` (1 KB), canary at `$FB00` |
| Result record | `$FF00`: marker `$A5 $5A`, state, then measurement slots |
| Not used | `$5800-$5FFF`, `$7800-$7FFF` (cold data later), `$C000-$DFFF` (heap later) |

**Coordinates:** x 0..511, y 0..191. A rectangle is `(x, y, w, h)` with `w, h >= 0`; it covers x..x+w-1, y..y+h-1.

**Addressing:** byte column `bc = x >> 3`, file `bc AND 1` (`$4000` or `$6000`), offset `bc >> 1`, bit `7 - (x AND 7)`.
Pixel row y has the Spectrum row address within each file.

## 4. Conventions

- **Registers:** arguments in registers or in a fixed argument block `GA` (16 bytes at `$E000`) for routines with more than three arguments. Every routine says its clobbers; IX, IY and the alternate set are preserved unless stated.
- **Interrupts:** no code keeps interrupts disabled for more than **1,500 T**. Two things depend on it: TSRun drops a frame interrupt that arrives under `DI`, and the pointer must be redrawn before the beam reaches it (section 5).
- **Clipping:** every drawing routine clips to the **clip rectangle** set by `G_SETCLIP` (default: the whole screen). Nothing is ever written outside it. Coordinates are signed 16-bit, so a shape can start off screen.
- **Draw op** (byte `GOP`, set by `G_SETOP`): `SET` (ink), `CLR` (paper), `XOR` (invert). Lines, rectangles, frames and text honour it; blits have their own mask rule.
- **Pointer shield:** any routine that draws where the pointer may be must be bracketed by `P_SHIELD` (rectangle) / `P_UNSHIELD`, as the classic Mac's `ShieldCursor`. The pointer is hidden only if it meets the rectangle.

## 5. Routines

| Routine | Does | Built from (FEASIBILITY "Graphics core") |
|---|---|---|
| `G_ADDR` | (x, y) -> HL screen byte, A bit mask | new (mode 6 addressing) |
| `G_ROWADDR` | y -> row base in file 1 (table in ROM, 192 words) | Leap V2 `ROW_BASE_TABLE` idea; Arcade `ROW_TAB` |
| `G_SETCLIP`, `G_SETOP` | clip rectangle, draw op | new |
| `G_FILL` | rectangle in the draw op, pixel precise, clipped | Arcade rectangle walker (`tileops.asm` `walk_setup`, `clip_axis`): left partial byte, whole bytes alternating files, right partial byte |
| `G_FRAME` | 1-pixel rectangle outline in the draw op (XOR: the drag outline) | `G_HLINE` + `G_VLINE` |
| `G_HLINE`, `G_VLINE` | fast horizontal and vertical lines | walker row; v4 column-step idea |
| `G_LINE` | any line (x0, y0)-(x1, y1), clipped | Leap V2 `GFX_LINE` (`~/2068-Leap/kernel/graphics/graphics.asm:1401`) adapted to mode 6 |
| `G_CLS` | whole screen to paper | PUSH fill (`spike/native/b3_crunch.asm`) **with interrupts enabled**, filling downward. An interrupt during the fill pushes into the bytes just below SP, which the fill overwrites next, so its stack writes heal. The last 32 bytes at the bottom of each file region are cleared with ordinary stores, so the ISR's pushes never reach below a display file. SP is restored before return. Shielded as a whole (the pointer is hidden) |
| `G_TEXT8` | 8x8 string at a character cell (column 0..63, row 0..23), op SET or XOR, clipped by cell | glyph planes (Arcade `video.asm`), table in ROM |
| `G_TEXTP` | proportional string at any (x, y), ORed (SET) or XORed, clipped; returns the end x | byte-value shift tables (section 6), new |
| `G_TEXTW` | width in pixels of a proportional string | new |
| `G_BLIT` | masked bitmap (w <= 32, h <= 32, mask + image per byte, Arcade's pair format) at any (x, y), clipped | v3 masked blitter idea, shifted through the shift tables (no pre-shift) |
| `G_SAVERECT`, `G_RESTRECT` | copy a rectangle (whole byte columns, both files) to the save-under buffer and back: menu and dialog save-under | new: row copies with `LDI`, alternating files |
| `G_SCROLLV` | scroll a rectangle up or down by n pixel rows (whole byte columns); the uncovered rows are filled with paper | new: row copies with `LDI` |
| `P_INIT`, `P_MOVE`, `P_SHIELD`, `P_UNSHIELD` | the pointer: 16x16 masked arrow, 8 pre-shifted phases built at boot, save-under | v3 blitter (unrolled rows, both parities), `build_frame` |

**Pointer drawing is in the frame interrupt.** The ISR restores the old save-under and draws the pointer at its new position.
- **Deadline:** on TSRun, pixel row y is drawn from 8,960 + 224 y T after the interrupt. The ISR must finish restoring the old position before the beam reaches its first row, and finish drawing the new one before the beam reaches that first row. A 16x16 erase + draw is about 5,500 T (**EST**), and the worst interrupt delay is 1,500 T (section 4), so the pointer is tear-free.
- **Skip:** when the pointer has not moved and no shield changed since the last frame, the ISR does not touch it.
- **Division of work:** `P_MOVE` only records the new position. `P_SHIELD` and `P_UNSHIELD` set a flag that the ISR reads, which is atomic with respect to it. Shielded drawing in the main loop never meets a half-drawn pointer.

## 6. Tables and fonts (generated by `tools/gen-tables.mjs` into `src/gfx6/tables.inc`; never hand-edited)

| Table | Content | Size | Place |
|---|---|---|---|
| `SHR_p` | p = 1..7: `v >> p` for v = 0..255 | 7 pages | chunk 4, page aligned |
| `SHL_p` | p = 1..7: `(v << (8 - p)) AND $FF` | 7 pages | chunk 4 |
| `GLYPH8` | 8 planes: row k of the 8x8 glyph of code c at `GLYPH8 + 256 k + c` (codes 32..127 from `src/font.inc`) | 2 KB | chunk 4 |
| `ROWTAB` | 192 words: row y's address in file 1 | 384 B | chunk 0-1 |
| `PROP6` | proportional font (below) | about 1 KB | chunk 5 |

**The proportional font, `PROP6`,** is new and drawn for mode 6's tall pixels:
- **Size:** 8 rows high (baseline at row 6, descenders to row 7). ASCII 32..126.
- **Width:** 1..8 pixel columns of glyph data (one byte per row, so the fast path holds), plus spacing included in its advance width. Mode 6 pixels are half as wide as they are tall, so glyphs are drawn about twice as wide as on a square-pixel screen; expect about 75-80 characters per line.
- **Line height:** a setting (`GLH`), not part of the font. 8 rows for body text, 10 for menus and title bars.
- **Source:** ASCII art in `fonts/prop6.txt` (`#` = ink), one glyph per block. The generator derives the widths.
- **Format:** `PROP6_W` (95 widths) then 8 bytes per glyph, left-aligned (bit 7 = the glyph's leftmost pixel).
- **Review:** the owner reviews it by eye in the demo and may redraw glyphs in the text file.

## 7. Bounds (TSRun, T-states, measured by calling each routine directly with a sentinel return, interrupts off unless stated)

| Measure | Bound |
|---|---|
| `G_CLS` whole screen | <= 80,000 (interrupts on; ISR time excluded) |
| `G_CLS` interrupt safety | 0 frame interrupts lost over 300 frames of back-to-back clears with the pointer moving. Afterwards the screen is all paper, and the RAM outside the display files (`$5800-$5FFF`, `$7800-$7FFF`, stack, variables) is unchanged |
| Longest `DI` anywhere | <= 1,500 (measured by single-stepping each routine) |
| `G_FILL` 512 x 192, SET | <= 150,000 |
| `G_FILL` 32 x 16 at odd x, SET / XOR | <= 3,000 / 3,300 |
| `G_HLINE` 512 wide / `G_VLINE` 192 high | <= 2,500 / <= 7,000 |
| `G_LINE` | <= 150 per pixel, mean over 200 random lines |
| `G_TEXT8` | <= 260 per character SET, <= 340 XOR, mean over a 64-character line |
| `G_TEXTP` | <= 700 per glyph, mean over a sample paragraph; **report** the per-width figures |
| `G_BLIT` 16 x 16 / 32 x 32 at any x | <= 4,500 / 14,000 |
| `G_SAVERECT` / `G_RESTRECT` 96 x 80 | <= 20,000 each |
| `G_SCROLLV` 256 x 96 by 1 row / 512 x 192 by 8 rows | <= 55,000 / 200,000 |
| Pointer, in the ISR (erase + draw, worst parity and position) | <= 7,000 when it moves, <= 300 when it is skipped; old and new positions done before the beam reaches their first rows (section 5) |
| Code size of `gfx6` (without tables and fonts) | **report**; target <= 4 KB |

Figures marked **report** are measured and written down, not judged.

## 8. Tests (all on TSRun headless, Node; pattern of `tests/hello.mjs`)

1. **Reference model** (`tests/gfx6-model.mjs`), written from sections 3-6, not from the code: a 512 x 192 bit array with the same operations, clip and op. Every routine is checked by comparing the **whole** screen with the model.
2. **Random runs:** for each routine, at least 500 random calls (random rectangles, lines, strings, positions including off-screen and negative, every op, random clip rectangles), each followed by the whole-screen comparison.
3. **Edge cases written out:**
   - x = 0, 7, 8, 15, 16, 255, 256, 503, 504, 511;
   - widths 0..17;
   - even and odd starting byte columns;
   - rectangles crossing every file boundary;
   - empty clip;
   - text running off the right edge.
4. **Clip safety:** RAM outside the display files and the routine's own variables is poisoned before each call and checked after (Arcade's memory test), so nothing is written outside the clip.
5. **Pointer:** 600 frames of a scripted pointer path over text and filled rectangles, with shielded drawing in between (`G_FILL`, `G_TEXTP`, `G_SCROLLV`, `G_CLS`).
   - Every rendered frame (`m.pixels`) equals the model's "screen plus pointer at that frame's position": never a half pointer, never a left-over.
   - The ISR's cost is logged for every frame.
6. **Interrupts:** the frame counter equals the frames run in every test with interrupts on.
7. **Bounds:** section 7 as checks (`tests/gfx6-perf.mjs`), each printing the measured figure.
8. **Cross-emulator** (after the TSRun tests pass): the demo on ZEsarUX 13.0 and Fuse 1.9.1, screens compared with TSRun's at fixed points, using the method of `docs/PROBE_DOCK23.md`.

## 9. Demo cartridge `spike6` (for the owner to look at in `web/?cart=spike6`)

A mock desktop drawn only with `gfx6`. Nothing in it works: no menus open and no windows move.
- a menu bar in `PROP6` (inverted when "selected");
- two overlapping framed windows with inverted title bars, one with 8x8 text and one with proportional text;
- an icon (`G_BLIT`);
- an XOR drag outline that follows the pointer;
- the pointer, moved by joystick (arrows + Space) or the keys Q/A/O/P.

## 10. Deliverables

- `src/gfx6/*.asm` and `src/spike6.asm`;
- `tools/gen-tables.mjs` and `fonts/prop6.txt`;
- `tests/gfx6-*.mjs`;
- a build target `spike6`;
- "As built" in this file with every measured figure;
- `docs/FEASIBILITY.md` updated with what the numbers mean for the mode decision.

## 11. Slices (each passes its tests against the model before the next starts)

| Slice | Content | Who |
|---|---|---|
| **S1** | Mode 6 addressing (`G_ADDR`, `ROWTAB`), `G_SETCLIP` / `G_SETOP`, `G_FILL`, `G_HLINE` / `G_VLINE`, `G_FRAME`, `G_CLS`; `tools/gen-tables.mjs` (`ROWTAB`); the reference model `tests/gfx6-model.mjs` and the random / edge / clip-safety tests for these routines; their section 7 bounds | Drawing code: main model. Model and tests: a Sonnet agent, from this contract, not from the code |
| S2 | `GLYPH8` + `G_TEXT8`; shift tables; `fonts/prop6.txt` (first version drawn by the main model, reviewed by the owner) + `G_TEXTP` / `G_TEXTW` | as S1 |
| S3 | `G_LINE` (from Leap V2 `GFX_LINE`), `G_BLIT`, `G_SAVERECT` / `G_RESTRECT`, `G_SCROLLV` | as S1 |
| S4 | Pointer in the ISR, shield, the flicker test | main model |
| S5 | Demo cartridge `spike6`, `tests/gfx6-perf.mjs` complete, ZEsarUX and Fuse runs, "As built", the mode decision in `docs/FEASIBILITY.md` | Sonnet, results checked by the main model |
