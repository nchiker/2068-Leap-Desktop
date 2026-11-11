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

## 12. S1 interface (designed 2026-11-11, binding for the S1 code and tests)

Section 12 fills in what sections 3-5 leave open for slice S1. The tests are written from sections 3-7 and this section, never
from the code.

### 12.1 Memory

| Address | Name | What |
|---|---|---|
| `$E000-$E00F` | `GA` | Argument block. `GA+0` x, `GA+2` y, `GA+4` w, `GA+6` h: signed 16-bit words, little-endian |
| `$E010` | `GOP` | Draw op: 0 `SET` (ink, bit = 1), 1 `CLR` (paper, bit = 0), 2 `XOR` (invert) |
| `$E012-$E019` | `GCLIP` | Clip rectangle, half-open, already intersected with the screen: x0, x1, y0, y1 as words, `0 <= x0, x1 <= 512`, `0 <= y0, y1 <= 192`. Written only by `G_INIT` and `G_SETCLIP` |
| `$E000-$E03F` | | All of gfx6's variables (`GA`, `GOP`, `GCLIP`, scratch). A routine may write anywhere in here |
| `$E040-$E0FF` | | The cartridge's own variables (the test cartridge: frame counter, port shadows, counters) |

Argument ranges: x, y, w, h in -16384..16383. `w <= 0` or `h <= 0` draws nothing.

### 12.2 Routines

All routines preserve IX, IY and the alternate registers. None of them executes `DI` or `EI`: they leave the interrupt state as
they found it. Each uses at most 32 bytes of stack below its return address.

| Routine | In | Out / effect | Clobbers |
|---|---|---|---|
| `G_INIT` | | `GOP` = `SET`, clip = whole screen (0, 0, 512, 192) | AF, HL |
| `G_ADDR` | HL = x (0..511), E = y (0..191) | HL = the screen byte holding pixel (x, y), A = its bit mask (`$80 >> (x AND 7)`) | F, DE |
| `G_ROWADDR` | A = y (0..191) | HL = `ROWTAB[y]`: the address of row y, byte column 0, in file 1 | AF |
| `G_SETOP` | A = op (0, 1, 2) | `GOP` = A | |
| `G_SETCLIP` | `GA`: x, y, w, h | clip = the rectangle intersected with the screen; empty when it has no pixel on screen. `GA` unchanged | AF, BC, DE, HL |
| `G_FILL` | `GA`: x, y, w, h | every pixel of the rectangle that is inside the clip gets the draw op; nothing else changes. `GA` unchanged | AF, BC, DE, HL |
| `G_HLINE` | HL = x, DE = y, BC = w | as `G_FILL` (x, y, w, 1). `GA` undefined afterwards | AF, BC, DE, HL |
| `G_VLINE` | HL = x, DE = y, BC = h | as `G_FILL` (x, y, 1, h). `GA` undefined afterwards | AF, BC, DE, HL |
| `G_FRAME` | `GA`: x, y, w, h | the 1-pixel outline of the rectangle in the draw op, clipped: the pixels of the rectangle that lie in its first or last row or its first or last column, **each exactly once** (so `XOR` twice restores the screen). w = 1 or h = 1 gives the whole (thin) rectangle. `GA` undefined afterwards | AF, BC, DE, HL |
| `G_CLS` | | all 12,288 display bytes (`$4000-$57FF`, `$6000-$77FF`) to 0 (paper). Ignores the clip and the draw op: it is the whole-screen clear. Interrupts stay as they were; with them on, the ISR's stack depth must be at most 32 bytes (binding on every ISR, including S4's pointer ISR) | AF, BC, DE, HL |

S1 has no pointer: the shield (`P_SHIELD`) around `G_CLS` and the other routines comes in S4.

### 12.3 Tables (`src/gfx6/tables.inc`, written by `tools/gen-tables.mjs`)

`ROWTAB` (192 words, row y's address in file 1: `$4000 + (y AND $C0) * 32 + (y AND 7) * 256 + (y AND $38) * 4`), then `LMASK`
(8 bytes, `$FF >> i`) and `RMASK` (8 bytes, `($FF << (7 - i)) AND $FF`). The file has labels and data only; the including source
places it on a 512-byte boundary in chunk 0-1.

`src/gfx6/tables4.inc` holds the page-aligned tables for chunk 4-5. For S1 these are `LMASKP` and `RMASKP` (256 bytes each,
indexed by the low byte of x): `LMASKP[v] = $FF >> (v AND 7)`, `RMASKP[v] = ($FF << (7 - (v AND 7))) AND $FF`. The including
source places the file on a page boundary in chunk 4-5; the tables follow each other with no padding.

### 12.4 Test cartridge `gfx6t` (`src/gfx6t.asm`, build target `gfx6t`)

The shape of `hello`: DOCK chunks 0, 1, 4, 5; stack top `$FF00`; record at `$FF00` (marker `$A5 $5A`, then state 1 = ready).
It clears both display files and `$E000-$EFFF`, sets mode 6, calls `G_INIT`, enables interrupts, writes the record, then idles
at `T_IDLE` (`HALT` loop). Symbols the tests use (from `build/gfx6t/out.sym`): the routines above, `GA`, `GOP`, `GCLIP`,
`ROWTAB`, `LMASK`, `RMASK`, `T_IDLE`, `T_RET`, `T_CLSLOOP`, `T_CLSDONE`, `V_FRAMES`, `V_CLS`, `RESULT`, `GFX6_CODE`,
`GFX6_CODE_END`.

- **ISR** (IM 1): increments the word `V_FRAMES`, and on purpose leaves `$FF` bytes in its stack frame (16 bytes deep with the
  return address), so a stack write that the clear does not heal shows as ink.
- **`T_RET`**: the sentinel return address. It is a `JR $` loop; a test stops when PC reaches it.
- **`T_CLSLOOP`**: `EI`, then calls `G_CLS` forever, incrementing the word `V_CLS` after each clear. `T_CLSDONE` is the address
  right after the `CALL G_CLS` (a test stops there to see a finished clear).

**Calling a routine directly** (the tests): after the record is marked, set `cpu.halted = false`, `iff1 = iff2 = false`
(interrupts off; `true` for the DI measurement), `SP = $FF00`, push `T_RET`, set the input registers, `PC` = the routine, then
step `runZ80(cpu, bus, 1, m)` until `PC = T_RET`. The routine's cost is the change of `m.tstates`, including its `RET`.
Stepping never raises a frame interrupt (TSRun raises it only at the end of `runFrame`).

**Clip safety:** before a call, every RAM byte in `$4000-$FFFF` outside the display files is poisoned with random values, except
`$E000-$E03F` (gfx6's variables), `$E040-$E0FF` (the cartridge's), `$FE00-$FEFF` (the stack around the call) and
`$FF00-$FFFF` (the record). After the call all poisoned bytes must be unchanged. Display bytes are compared with the model, all
512 x 192 pixels, after every call.

### 12.5 How the S1 bounds are measured

| Measure (section 7) | Calls |
|---|---|
| `G_CLS` whole screen | one direct call, interrupts off (= ISR time excluded) |
| `G_CLS` interrupt safety | `T_CLSLOOP` for 300 frames with `runFrame`; `V_FRAMES` must rise by exactly 300; then step to `T_CLSDONE`; all display bytes 0; `$5800-$5FFF`, `$7800-$7FFF`, `$C000-$DFFF`, `$E100-$FAFF` unchanged (poisoned before). The pointer part ("with the pointer moving") is run again in S4 |
| Longest `DI` | every S1 routine, stepped from `iff1 = true`: the longest run of T-states with `iff1 = false` |
| `G_FILL` 512 x 192 `SET` | (0, 0, 512, 192), clip whole screen |
| `G_FILL` 32 x 16 at odd x, `SET` / `XOR` | the **worst** over x in {1, 3, 9, 101, 255, 477} and y in {0, 5} |
| `G_HLINE` 512 / `G_VLINE` 192 | (0, y, 512) for y in {0, 100, 191}; (x, 0, 192) for x in {0, 7, 100, 511}: the worst, `SET` |
| Code size | `GFX6_CODE_END - GFX6_CODE` (no tables): report |

## 13. As built

Measured figures are TSRun T-states, taken by `tests/gfx6-perf.mjs` as section 12.5 defines them and re-run by the main model.

### 13.1 Slice S1 (2026-11-11)

**Result: 7 measures pass, 1 is reported (code size) and 1 bound is missed (`G_FILL` 32 x 16 at odd x, XOR, by 96 T). The owner decided to record the miss and continue.**

| Measure | Measured | Bound | Result |
|---|---|---|---|
| `G_CLS` whole screen | 73,064 | <= 80,000 | pass |
| `G_CLS` interrupt safety | 300 frame interrupts in 300 frames, 239 clears; display all 0 and the guarded RAM unchanged afterwards | 0 lost | pass (the "pointer moving" part waits for S4) |
| Longest `DI` | 0 (no S1 routine executes `DI`) | <= 1,500 | pass |
| `G_FILL` 512 x 192, SET | 146,433 | <= 150,000 | pass |
| `G_FILL` 32 x 16 at odd x, SET (worst of 12 positions) | 2,980 at x 1, y 5 | <= 3,000 | pass |
| `G_FILL` 32 x 16 at odd x, XOR (worst of 12 positions) | 3,396 at x 1, y 5 | <= 3,300 | **missed by 96** |
| `G_HLINE` 512 (worst of y 0, 100, 191) | 2,169 | <= 2,500 | pass |
| `G_VLINE` 192 (worst of x 0, 7, 100, 511) | 6,643 | <= 7,000 | pass |
| Code size of `gfx6` (`GFX6_CODE_END - GFX6_CODE`) | 3,162 bytes | target <= 4 KB, report | reported |

#### The missed bound

`G_FILL` 32 x 16 at odd x, XOR, costs 3,396 T at x 1, y 5, against a bound of 3,300. The bound stands unchanged. The owner decided
(2026-11-11) to record the miss and continue with S2.

| Part of the XOR call at x 1, y 5 | T |
|---|---|
| Setup: signed 16-bit clipping of both axes (about 475 of it); byte columns, masks, row address, body selection, saving IX / IY | 967 |
| 16 rows (about 131 a row) | 2,090 |
| Two character-row crossings | 301 |
| Return | 38 |
| Total | 3,396 |

At y 0 (one crossing fewer) the same rectangle costs 3,213 (XOR) and 2,797 (SET).

Per-call setup, mostly clipping, is paid by every gfx6 routine. S2's text figures will show whether it needs a common cheaper path.
Optimisations considered and not made:

| Change | Saves | Cost |
|---|---|---|
| Count rows in pairs | about 80 T | more code |
| Keep y0 and the row count in registers | about 15 T | |

#### How `G_FILL` is built

After clipping, n is the number of byte columns.
- **n = 1:** a vertical walk, with the 8 rows of a character row unrolled.
- **n = 2..8:** straight-line row bodies, one per op and n. The walk is a serpentine: rows alternate left-to-right and right-to-left, so no row resets its pointers. The left mask is in C and the right mask in IXl.
- **n >= 9:** the edge columns by the vertical walk, then the whole bytes row-major through 64-element unrolled blocks entered at an offset.
- Rows are walked one character row at a time (`INC H`), with a crossing between character rows.
- `G_FILL` uses the undocumented 8-bit halves of IX: the masks while it sets up, then in the 2..8-column bodies the right mask (IXl) and the rows left (IXh). TSRun runs them; ZEsarUX and Fuse are to be checked in S5.
- Tables: `ROWTAB` (chunk 0-1, 512-byte boundary) in `src/gfx6/tables.inc`; `LMASKP` and `RMASKP` (256 bytes each, chunk 4) in `src/gfx6/tables4.inc`. Both files are generated by `tools/gen-tables.mjs`.

#### Tests

- `tests/gfx6-model.mjs`: the reference model, written from the contract; self-test of 36 checks.
- `tests/gfx6-s1.mjs`: 21 check categories. They cover the tables, `G_ADDR` for all 98,304 pixels, `G_ROWADDR`, `G_SETCLIP`, 600 random calls per drawing routine with random clips and ops, the section 8 edge cases, clip safety by poisoned RAM, preserved registers and the longest `DI`. It passes on several seeds.
- `tests/gfx6-cls.mjs`: `G_CLS` interrupt safety.
- `tests/gfx6-perf.mjs`: the bounds above.

The tests were written by a separate agent from the contract, without reading the code. They were shown to fail on deliberately broken copies of the code: a stray write, a clobbered IX, a frame corner drawn twice and a changed `GA`.

#### Interpretations made in S1

- `G_CLS` ignores the clip and the draw op (section 12.2).
- Every ISR is limited to 32 bytes of stack (section 12.2; binding on S4).
- The 32 x 16 bound is measured as the worst over x in {1, 3, 9, 101, 255, 477} and y in {0, 5} (section 12.5).

### 13.2 Slice S2 (2026-11-11)

**Result: every S2 bound passes. Three figures are reported:**
- code size, now over its 4 KB target;
- characters per line, more than section 6 expected;
- `CLR` and `XOR` text, which have no bounds.

The S1 miss (13.1) is unchanged. Interface: section 14, including its amendments to 12.1 (memory) and section 6 (`PROP6`
format and place).

| Measure (14.6) | Measured | Bound | Result |
|---|---|---|---|
| `G_TEXT8` per character, `SET` (64-character line) | 232.3 | <= 260 | pass |
| `G_TEXT8` per character, `XOR` | 288.3 | <= 340 | pass |
| `G_TEXT8` per character, `CLR` | 264.3 | report | reported |
| `G_TEXTP` per glyph, `SET` (sample paragraph: 5 lines, 388 codes, spaces included) | 668.0 | <= 700 | pass |
| `G_TEXTP` per glyph, `XOR` / `CLR` | 668.0 / 699.5 | report | reported |
| `G_TEXTP` one-code calls, by ink width 0 / 2 / 3 / 4 / 5 / 6 / 7 / 8 | 3,447 / 3,823 / 3,895 / 3,942 / 3,962 / 4,006 / 4,057 / 4,090 | report | reported: a one-code call is mostly the line setup (about 2,760 T) |
| `G_TEXTW` per code (255 codes) | 98.8 | none | reported |
| Characters per 512-pixel line (512 / mean advance 5.80 over the paragraph) | 88.2 | report (section 6 expected 75-80) | reported |
| Longest `DI` | 0 | <= 1,500 | pass |
| Code size of `gfx6` | 6,266 bytes after the shrink pass below (6,739 before it) | target <= 4 KB, report | **over the target** (the owner accepted the increase) |

#### How `G_TEXTP` reaches 668

The first version, which was correct, cost 749 T a glyph.

**Where the time went (sample paragraph):**
- 45% of the codes needed two byte columns, and each paid a second pass.
- Passes drew all 7 font rows, while the glyphs average 5.3 rows with ink.

| Change | T a glyph |
|---|---|
| First version: one pass per byte column, downward, entries in IX / IY | 749 |
| Two byte columns drawn in one pass (blocks E and O); passes upward, so a glyph without ink in the bottom font row (87% of the paragraph's glyphs) skips that row; entries through `JP nn` trampolines in RAM, written once per line | 708 |
| Line setup: entry offsets from per-block tables, not a multiply loop | 693 |
| Trampolines written with direct stores | 682 |
| Pass blocks end with `JP tpf_adv`, entered by `JP` (no `CALL` / `RET` per glyph) | 668 |

#### How S2 is built

- **Fonts** share 8 planes in chunk 4 (14.2): one `INC D` / `DEC D` steps a glyph row in either font.
- **`G_TEXT8`** walks a pair of cells as a serpentine:
  - the even cell top to bottom, `SET 5,H`, then the odd cell bottom to top;
  - so no pointer is reset between cells, and a cell costs 8 row moves and one file switch.
- **`G_TEXTP`** has two loops.
  - **Fast loop:** for glyphs wholly inside the clip. All its state is in registers (main set: string, count, column budget, pen
    screen byte; alternate B' = the pen's shift page), and the passes run in the alternate set.
  - **General loop:** handles code 13, invisible lines, glyphs cut by the clip (each byte column masked, `tp_mbyte` /
    `tp_mpass`) and glyphs outside it. It re-enters the fast loop as soon as the pen is in the fast region.
  - **Pass blocks:** 9 of them (S, E, O for each op), 1,808 bytes in all. They are the main reason the code is over its target.
  - **Trampolines** take `$E040-$E069`; the remaining S2 variables are in `$E06A-$E078`.
- **Shift tables** are interleaved (`SHL = SHR + 256`), so the second byte column of a row is one `INC B` away.
- **`fonts/prop6.txt`**, first version, drawn by the main model:
  - 2-pixel vertical strokes, capitals in rows 1-6, x-height rows 2-6, descenders in row 7, row 0 blank;
  - **for the owner to review by eye** (S5's demo, or any `G_TEXTP` screen).

#### Shrink pass (2026-11-11, owner approved)

A size pass (`shrink-z80`) measured its candidates in a disposable worktree, then three of them were applied here. Together
they save 473 bytes, with no speed cost.

| Change | Bytes |
|---|---|
| `G_FILL`'s whole-byte blocks: one copy per op instead of two. A run that ends in file 1 swaps HL and DE, since the row tail and `G_SEGW` treat them alike | -357 |
| Alignment padding removed: `SB_TAB` and `T8_TAB` only need to stay inside a page (conditional `ALIGN 256` guards), and `TP_OPS` moved after `SB_TAB`, where it fits | about -111 |
| Five setup jumps changed to `jr` (not the per-row `jp nz,.bwd`, which would cost 2 T a row) | -5 |

S1 figures after it (13.1 records the originals):
- `G_FILL` 512x192 SET: 146,422 T.
- 32x16 at odd x: SET 2,974 T; XOR 3,390 T (still over the 3,300 bound).
- `G_HLINE`: 2,160 T.
- `G_VLINE`: 6,647 T.

S2 figures are unchanged.

Measured and not applied: drop the O pass blocks and draw those glyphs in two S passes. It saves 891 bytes more (5,375 total)
but costs 668 -> 680.9 T a glyph, and `CLR` 699.5 -> 712.5.

#### Options if the code size matters more than the margin

Each option was estimated, not measured.

| Option | Saves | Costs |
|---|---|---|
| Two passes for odd-parity two-byte glyphs (drop the O blocks) | 891 bytes (measured) | +12.9 T a glyph (measured: 680.9) |
| Pass blocks moved to chunk 5 | no bytes; frees chunk 0-1 space | Chunk 5 is mapped all the time (section 3) |

#### Tests

- **`tests/gfx6-model.mjs`:**
  - S2 model: own parsers for `fonts/prop6.txt` and `src/font.inc`, the expected tables, `text8`, `textp`, `textw`, GLH;
  - self-test of 95 checks.
- **`tests/gfx6-s2.mjs`:** 37 checks.
  - Every generated table byte against the model.
  - 600 random calls of each routine: whole-screen compare, poisoned RAM, preserved registers, returned pen and width.
  - Edge cases: section 8.3 positions, every glyph at every shift, screen and clip edges, CR, empty clip, 255-code strings.
  - Longest `DI`.
  - Passes on seeds 1-4.
- **`tests/gfx6-perf.mjs`:** the S2 bounds and reports above.
- The model and tests were written by a separate agent from sections 12 and 14, without reading the code. About 40 blind
  mutations of `text.asm` were tried: every one that changed behaviour was caught; the ones that survived were equivalent.
- S1's tests (`gfx6-s1`, `gfx6-cls`) still pass.

#### Interpretations made in S2

- **`G_TEXT8` `SET` and `CLR` are opaque.**
  - They write the whole cell byte (`CLR` gives inverse video); `XOR` inverts the glyph's ink.
  - Section 7's `SET` / `XOR` figures match this, and a cell-based routine normally overwrites its cell.
- **`G_TEXT8` clips by whole cells:** a cell partly outside the clip is not drawn.
- **Code 13** is a new line in `G_TEXTP`: back to the start x, down `GLH`. This is what the line-height setting is for.
  `G_TEXTW` returns the widest line.
- **Strings** are 0..255 codes with a length, no terminator. Codes with no glyph draw nothing and do not advance.
- **The paragraph's per-glyph mean** counts the 388 codes actually sent. The 4 spaces at line breaks are not drawn, as with
  any word-wrapped text.
- **Viewing a screen in TSRun:** right after a test has stepped the CPU directly, the first `runFrame` can show a partial frame;
  the second one is complete. This is a harness note for S5, not a code issue.

## 14. S2 interface (designed 2026-11-11, binding for the S2 code and tests)

Section 14 fills in what sections 3-6 leave open for slice S2 (8x8 text, proportional text, shift tables, the `PROP6` font). It
adds to section 12; nothing in section 12 changes except where 14.1 says so. The tests are written from sections 3-7, 12 and this
section, never from the code.

### 14.1 Memory and settings

| Address | Name | What |
|---|---|---|
| `$E011` | `GLH` | Line height in pixel rows (byte, 1..255), used by `G_TEXTP` for code 13. A setting like `GOP`: written only by `G_INIT` (to 8) and by the caller |
| `$E01A-$E07F` | | gfx6 scratch (S1's and S2's), including code trampolines that `G_TEXTP` rewrites for each line (`JP nn` in RAM, so a pass block can be entered at a per-line offset). Any gfx6 routine may write it |
| `$E080-$E0FF` | | The cartridge's own variables (**changed from 12.1**: gfx6 now owns `$E000-$E07F`) |

`G_INIT` now also sets `GLH` = 8 (clobbers still AF, HL). No drawing routine changes `GOP`, `GLH` or `GCLIP`. 12.4's poisoning
already leaves all of `$E000-$E0FF` alone, so the clip-safety test is unchanged.

**Strings** are `n` bytes at an address, no terminator, `n` = 0..255 (a word whose high byte is 0). They may be anywhere in
memory the routine can read.

### 14.2 Fonts and tables (`src/gfx6/tables4.inc`, chunk 4, page aligned, generated)

This replaces the `PROP6` format and place of section 6 (both fonts now share 8 planes, so a glyph row is one `inc d` away from
the next, and both fonts index by code).

| Table | Content | Size |
|---|---|---|
| `LMASKP`, `RMASKP` | as 12.3 | 2 pages |
| `PROP6_W` | `PROP6_W[c]` = advance width of code c (0 for a code with no glyph) | 1 page |
| `PROP6_I` | `PROP6_I[c]` = ink width of code c: 1 + the rightmost ink column, 0 for a glyph with no ink or a code with no glyph | 1 page |
| `FONTP` | 8 planes, plane k (glyph row k, 0 = top) at `FONTP + 256 k`. Byte c (0..127) = row k of the `PROP6` glyph of code c (bit 7 = leftmost column). Byte 128 + c = row k of the 8x8 glyph of code c | 8 pages |
| `GLYPH8` | `= FONTP + 128`: row k of the 8x8 glyph of code c at `GLYPH8 + 256 k + c`, c = 0..127, as section 6 | (in `FONTP`) |
| `SHR` | `SHR + 512 p + v` = `v >> p`, p = 0..7 (pages interleaved with `SHL`) | 8 pages |
| `SHL` | `= SHR + 256`: `SHL + 512 p + v` = `(v << (8 - p)) AND $FF` (0 for p = 0) | 8 pages |
| `PROP6_A2`, `PROP6_K` | Internal to `G_TEXTP` (not part of the interface): 2 x advance, and 2 x ink width + `$80` when the glyph has ink in the font's last row | 2 pages |

**8x8 glyphs:** codes 32..126 are `src/font.inc`; codes 0..31 and 127 are blank.

**`PROP6` glyphs:** codes 32..126 from `fonts/prop6.txt`; every other code (0..31, 127..255) has no glyph: no ink, advance 0.

### 14.3 `fonts/prop6.txt` (the `PROP6` source; the owner may redraw glyphs in it)

- Lines starting with `;` are comments; blank lines are ignored.
- A glyph is a header line `= NN` (NN = decimal code, 32..126), optionally followed by a space and the character itself (for
  reading only), then exactly 8 rows of `.` (paper) and `#` (ink). Row 0 is the top.
- All 8 rows of a glyph have the same length L, 1..16. **L is the advance width.** Ink is allowed only in columns 0..7.
- Every code 32..126 appears exactly once. The generator rejects anything else.
- Design rules for the first version (not enforced): row 0 blank (the gap between lines), capitals and digits in rows 1-6,
  x-height rows 2-6, descenders in row 7; vertical strokes 2 pixels wide (mode 6 pixels are half as wide as tall); one blank
  column at the right as the letter gap.

### 14.4 Routines

All preserve IX, IY and the alternate registers (AF', BC', DE', HL'), execute no `DI` or `EI`, use at most 32 bytes of stack below
their return address, and leave `GA` unchanged.

| Routine | In | Out / effect | Clobbers |
|---|---|---|---|
| `G_TEXT8` | `GA+0` col, `GA+2` row (signed words), `GA+4` string address, `GA+6` n | For i = 0..n-1: the character s[i] is drawn in the cell (col + i, row) **if that whole cell is inside the clip** (`8(col+i) >= x0`, `8(col+i) + 8 <= x1`, `8 row >= y0`, `8 row + 8 <= y1`), else not at all. Drawing a cell: for k = 0..7, the screen byte b of byte column col + i, pixel row 8 row + k, with g = row k of the 8x8 glyph of (s[i] AND $7F): `SET` b = g; `CLR` b = NOT g; `XOR` b = b XOR g. (A cell is opaque in `SET` and `CLR`: they write the whole byte.) | AF, BC, DE, HL |
| `G_TEXTP` | `GA+0` x, `GA+2` y (signed words), `GA+4` string address, `GA+6` n | A pen starts at (x, y). For each code c of the string in order: c = 13: pen x = x (the start), pen y = pen y + `GLH`. Any other c: every ink pixel of c's `PROP6` glyph, glyph pixel (j, k) at screen (pen x + j, pen y + k), that is inside the clip gets the draw op (`SET` ink, `CLR` paper, `XOR` invert); then pen x = pen x + `PROP6_W[c]`. Returns **HL = pen x, DE = pen y** after the last code. The caller keeps x, y and the pen in -16384..16383 | AF, BC, DE, HL |
| `G_TEXTW` | `GA+4` string address, `GA+6` n | HL = the width of the widest line: lines are separated by code 13; a line's width is the sum of `PROP6_W` of its codes | AF, BC, DE, HL |

### 14.5 Test cartridge additions

- `gfx6t` exports `G_TEXT8`, `G_TEXTP`, `G_TEXTW`, `GLH`, `FONTP`, `GLYPH8`, `PROP6_W`, `PROP6_I`, `SHR`, `SHL`.
- **String buffer:** tests put strings at `T_STR` = `$D000` (512 bytes, `$D000-$D1FF`). Those bytes are not poisoned; they must be
  unchanged after every call (the routines only read them). The rest of 12.4's poisoning applies unchanged.
- The reference model reads `fonts/prop6.txt` and `src/font.inc` itself (its own parser, from 14.2-14.3) and checks the generated
  tables in the cartridge image against them byte for byte.

### 14.6 How the S2 bounds are measured

| Measure (section 7) | Calls |
|---|---|
| `G_TEXT8` per character, `SET` / `XOR` | One call: n = 64, codes 32..95, at col 0, row 10, clip whole screen. T / 64. `CLR` is reported |
| `G_TEXTP` per glyph | The sample paragraph (below), word-wrapped greedily at 500 pixels with the model's `PROP6_W` (words joined by one space; a line is never empty), one call per line at x = 5, y = 3 + 10 i (i = line index; most lines cross a character row). Op `SET`, clip whole screen. Total T / total codes (spaces included). `XOR` and `CLR` are reported |
| `G_TEXTP` per-width figures | Report: for each ink width w that occurs in the font, the mean T of one-code calls (each glyph of that width, at x = 64 + p for p = 0..7, y = 50) |
| Characters per line | Report: 512 / the mean `PROP6_W` over the paragraph's codes |
| Longest `DI` | `G_TEXT8`, `G_TEXTP`, `G_TEXTW`: as 12.5 |
| Code size | as 12.5, report |

Sample paragraph (one line here; 392 characters):

> The quick brown fox jumps over the lazy dog. Mode 6 gives the desktop 512 pixels across, so a proportional font fits about eighty characters on a line. Each glyph is shifted into place through byte tables and clipped to its window. Menus, title bars and dialogs all use it: (1) open, (2) scroll, [3] close; "quotes", 'apostrophes' & 100% of the time {braces} <angles> @home #tags $5 ~ok? Yes!
