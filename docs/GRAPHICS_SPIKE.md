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
| Pointer save-under and pre-shifted pointer images | `$E100-$E6FF` (15.1; `$E700-$E7FF` is `GCODE`) |
| Save-under buffer for `G_SAVERECT` (menus, dialogs) and scratch | `$E800-$EFFF` (2 KB) |
| Stack | `$FB00-$FEFF` (1 KB), canary at `$FB00` |
| Result record | `$FF00`: marker `$A5 $5A`, state, then measurement slots |
| Not used | `$5800-$5FFF`, `$7800-$7FFF` (cold data later), `$C000-$DFFF` (heap later) |

**Coordinates:** x 0..511, y 0..191. A rectangle is `(x, y, w, h)` with `w, h >= 0`; it covers x..x+w-1, y..y+h-1.

**Addressing:** byte column `bc = x >> 3`, file `bc AND 1` (`$4000` or `$6000`), offset `bc >> 1`, bit `7 - (x AND 7)`.
Pixel row y has the Spectrum row address within each file.

## 4. Conventions

- **Registers:** arguments in registers or in a fixed argument block `GA` (16 bytes at `$E000`) for routines with more than three arguments. Every routine says its clobbers; IX, IY and the alternate set are preserved unless stated.
- **Interrupts:** no code keeps interrupts disabled for more than **1,500 T** (the frame ISR itself is exempt, 16.1). Two things depend on it: TSRun drops a frame interrupt that arrives under `DI`, and the pointer must be redrawn before the beam reaches it (section 5).
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
| `G_BLIT` | masked bitmap (w <= 32, h <= 32, mask + image per byte, Arcade's pair format) at any (x, y), clipped, drawn from 8 pre-shifted copies that `G_PRESHIFT` builds once per bitmap (**amended 2026-11-11, owner approved:** shifting at draw time measured about 5 times the bounds) | v3 masked blitter: pre-shifted copies, unrolled bytes |
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
| S4 | Pointer in the ISR, shield, the flicker test (interface: section 16) | Z80: main model. Model and tests: a Sonnet agent, from section 16. Review of `P_ISR`: a Fable agent |
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

**Closed (2026-11-11, after S2):** a separate change to `G_FILL`'s setup and `G_SEG` brought the XOR case to **3,246 T** (SET
2,830), both at x 9, y 5; the bound is unchanged.
- **Clipping:** compares through A on the high byte (no `SBC HL` / `ADD HL` pair; the differences cannot overflow in the argument
  range). About 75 T.
- **Setup:** the first byte column and the left mask stay in registers. About 47 T.
- **`G_SEG`:** tests rows-left first, so the exit is cheap. About 28 T.

Other S1 figures after it: 512 x 192 SET 146,365; `G_HLINE` 2,103; `G_VLINE` 6,582. S2 figures and the code size (6,266 bytes)
are unchanged. Re-run by the main model: S1 (seeds 1, 2, 9), S2 (seeds 1, 5), `gfx6-cls` and `gfx6-perf` (28 of 28) pass.

#### How `G_FILL` is built

After clipping, n is the number of byte columns.
- **n = 1:** a vertical walk, with the 8 rows of a character row unrolled.
- **n = 2..8:** straight-line row bodies, one per op and n. The walk is a serpentine: rows alternate left-to-right and right-to-left, so no row resets its pointers. The left mask is in C and the right mask in IXl.
- **n >= 9:** the edge columns by the vertical walk, then the whole bytes row-major through 64-element unrolled blocks entered at an offset.
- Rows are walked one character row at a time (`INC H`), with a crossing between character rows.
- `G_FILL` uses the undocumented 8-bit halves of IX: the masks while it sets up, then in the 2..8-column bodies the right mask (IXl) and the rows left (IXh). TSRun runs them; ZEsarUX and Fuse are to be checked in S5. S5 checked them: ZEsarUX 13.0 and Fuse 1.9.1 give the same screens as TSRun (13.5).
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

**Applied later (2026-11-11, owner: clean-up after the code-size decision, `docs/CODE_SIZE.md` section 0):** the O blocks are
gone. Pass blocks end with `JP (IX)`, and an odd two-column glyph runs two S passes (`tpf_on` / `tpf_od`, then `tpf_o3`).
Measured: gfx6 13,326 -> 12,451 bytes; 681.5 T a glyph (`XOR` 681.5, `CLR` 713.0); one-code calls about 455 T cheaper (two
trampoline sets a line, not three).

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

### 13.3 Slice S3 (2026-11-11)

**Result: `G_LINE` and both `G_BLIT` bounds pass. Save, restore and both scroll bounds are missed and recorded (the owner
chose: optimize, then record). Every S3 routine passes its tests.** Interface: section 15, with two owner-approved changes made
during S3: the line's pixels no longer depend on the order of its ends, and `G_BLIT` draws from pre-shifted copies built by a
new routine, `G_PRESHIFT`.

| Measure (15.4) | Measured | Bound | Result |
|---|---|---|---|
| `G_LINE` per pixel, `SET` (200 random lines) | 109.0 (x major 104.5, y major 139.7) | <= 150 | pass |
| `G_LINE` long clipped lines (-16384, -16384)-(16383, 16383) / (-16384, 0)-(16383, 191) | 35,669 / 47,327 | report | reported |
| `G_BLIT` 16 x 16, worst of 16 positions | 4,442 (x 71, y 5) | <= 4,500 | pass |
| `G_BLIT` 32 x 32, worst of 16 positions | 10,760 (x 71, y 5) | <= 14,000 | pass |
| `G_BLIT` 16 x 16 at y 0, p = 0 / 1..7 | 3,677 / 4,302-4,314 | report | reported |
| `G_PRESHIFT` 16 x 16 / 32 x 32 (once per bitmap) | 191,622 / 615,686 | report | reported |
| `G_SAVERECT` 96 x 80 | 22,974 (x 72, y 53) | <= 20,000 | **missed by 2,974** |
| `G_RESTRECT` 96 x 80 | 22,177 (x 72, y 53) | <= 20,000 | **missed by 2,177** |
| `G_SCROLLV` 256 x 96 by 1 row | 75,840 (y 53, n 1) | <= 55,000 | **missed by 20,840** |
| `G_SCROLLV` 512 x 192 by 8 rows | 234,886 (n 8) | <= 200,000 | **missed by 34,886** |
| `G_SCROLLV` 512 x 192 by 1 / by 10 rows | 246,985 / 242,567 | report | reported |
| Longest `DI` | 0 | <= 1,500 | pass |
| Code size of `gfx6` | 11,222 bytes (6,266 after S2) | target <= 4 KB, report | over the target |

#### Why save, restore and scroll miss

They copy with `LDI` (16 T a byte), the fastest copy that keeps interrupts on. Each row also needs both files' starts set
(one register set per file, `EXX` between them) and a loop jump. The row code alone measures:

| Measure | Row code alone | Bound |
|---|---|---|
| Save / restore 96 x 80 | 18,510 (15,360 of it `LDI`) | 20,000 |
| Scroll 256 x 96 by 1 | 54,780 (48,640 of it `LDI`) | 55,000 |
| Scroll 512 x 192 by 8 | 200,054 (188,416 of it `LDI`) | 200,000 |

So scroll cannot meet its bounds with `LDI`, and save / restore would need setup, code writing and crossings in about 1,500 T
(they take about 4,400 now). A faster copy uses `POP` / `PUSH`, which needs `DI`, and section 4 / 15.2 rule that out.

| Part of the worst save (x 72, y 53) | T |
|---|---|
| Row code: 80 rows x (12 `LDI` + 38) | 18,510 |
| Clip, header, sizes, first segment | about 2,200 |
| Writing the row code (24 opcodes, heads, tail) | about 900 |
| 11 character-row crossings | 1,211 |
| Return | 119 |

#### How S3 is built (`src/gfx6/s3.asm`)

- **Row code in RAM (`GCODE`, `$E700`, section 15.1):** save, restore and scroll write one row of code for each call: "head,
  `LDI` x n1, `EXX`, head, `LDI` x n2, `EXX`, `JP PE`". The main set copies one display file, the alternate set the other.
  `BC'` counts the alternate set's bytes in a segment (the rows of one character row), so the last `LDI` clears P/V and the
  loop falls out to the segment handler in ROM.
- **Wrap:** a row whose last byte is offset 31 of character row 7 makes `L` wrap and carry into `H`. That set's head then
  gets a `NOP` instead of `INC H` for that character row (save / restore: `rw_in` / `rw_out`; scroll: the `XG` crossings).
  Scroll down copies right to left with `LDD`, so its wrap is offset 0 of character row 0.
- **Scroll segments:** the first is set up from `ROWTAB`. After that a crossing only moves the crossed pointer's two
  immediates by 32 and its high bytes (`sc_x*`, or `sc_g*` when a row may wrap). The paper rows are a `G_FILL` (`CLR`).
- **`G_LINE`:** the closed form of 15.2. When the clip cuts the minor axis, the first and last drawn pixels come from a 32 / 16
  division, so clipping never walks off-screen pixels. Then one of 12 loops (axis x minor direction x op) steps with
  `e' = e - dmaj` in `HL'` (`ADD HL,DE` carries when the minor axis steps).
- **`G_BLIT`:** a bitmap wholly inside the clip takes the fast path. Each row enters one of four unrolled chains (X / Y by the
  first byte column's parity, x 2 for a skipped last pair) by `JP (IX)`. A byte costs "`LD A,(DE) ; AND (HL) ; INC HL ;
  OR (HL) ; INC HL ; LD (DE),A`" (40 T) plus the step to the next byte column, and the row's last byte has no step. `IYl` /
  `IYh` count rows in the character row and after it. A bitmap the clip cuts goes through a general loop that masks each
  byte with its clip mask.
- **`G_PRESHIFT`:** straightforward, about 245 T a set byte.

#### Tests

- **`tests/gfx6-model.mjs`:** the S3 model (line, blit, `preshift`, a per-pixel `blitSet`, byte rectangle, scroll region).
  Self-test of 143 checks.
- **`tests/gfx6-s3.mjs`:** 33 checks, about 27,000 checked calls a seed.
  - Each call is followed by the whole-screen model compare, poisoned RAM, preserved registers, and `GA`, `GOP`, `GLH`,
    `GCLIP` unchanged.
  - The edge cases of section 8.3 and 15, and the longest `DI`.
  - The final code passes on seeds 21 and 22 at 600 calls a routine (earlier versions on seeds 4-12 at 300).
- **`tests/gfx6-perf.mjs`:** the S3 bounds and reports above.
- The model and tests were written by a separate agent from section 15, without reading the code.
  - The agent tried about 30 deliberate faults against a JavaScript stub before the Z80 existed, including the old
    direction-dependent line rule and swapped shifts in `G_PRESHIFT`. All were caught.
  - S1, S2, `gfx6-cls` and `hello` still pass.

#### Changes and interpretations made in S3

- **`$E700-$E7FF` is gfx6's code scratch** (15.1). The pointer area of section 3 becomes `$E100-$E6FF`; S4 needs about 900
  bytes.
- **Line rule** (owner): the pixels start from the end with the smaller major coordinate, so both orders give the same line.
- **Pre-shifted blit** (owner): section 5 and 15.2. The shifted set's format is specified, so a tool can build sets for ROM
  icons. Shifting at draw time measured 23,486 / 67,050 T.
- **S4 note:** `G_BLIT` writes back whole screen bytes, so its shield must cover the bytes (15.2).
- **"`GA` unchanged"** is tested over all 16 bytes of `GA`.

#### Options for the misses (the owner decides)

1. **Record them, as the S1 miss was, and go on to S4.**
2. **Save / restore:** a Fable attempt in a LeapG worktree. The floor above makes about 20,000 possible only with every part
   tight: a persistent `LDI` template instead of writing it each call, a register for the odd column's offset, cheaper
   crossings.
3. **Scroll:** these bounds need a copy faster than `LDI`. `POP` / `PUSH` in pieces under 1,500 T of `DI` would need an
   exception to section 4 and 15.2, and a check that the pointer's deadline still holds.

### 13.4 Slice S4 (2026-11-11)

**Result: every S4 bound passes.** Interface: section 16, with three changes made during S4:
- 16.3 gained the callers' rules;
- 16.7's grid was widened after the review;
- `P_ARROW` was redrawn with an outline on every side.

| Measure (16.7) | Measured | Bound | Result |
|---|---|---|---|
| `P_ISR` moving, worst of 408 cases | 6,779 (B (8, 0), A (8, 40), a shield on row 100 that meets neither); 6,554 with no shield | <= 7,000 | pass (221 T margin) |
| `P_ISR` skipped | 50 | <= 300 | pass |
| Deadline: largest `T_ISRP` offset + 1,500 | 6,694 + 1,500 = 8,194 (perf grid); 6,889 + 1,500 = 8,389 (flicker test) | <= 8,960 | pass |
| `P_ISR` draw only / erase only | 4,004 / 2,788 | report | reported |
| `P_ISR` after a `P_MOVE` to the same place / a move while hidden | 234 / 365 | report | reported |
| `P_SHIELD` with an erase / without | 3,446 / 1,010 | report | reported |
| `P_UNSHIELD` / `P_MOVE` | 73 / 194 | report | reported |
| `P_INIT` (once) | 192,052 (stack 12 bytes) | report | reported |
| Whole frame ISR in the flicker test (counter, `P_ISR`, stack fill) | min 496, mean about 5,000, max 7,195 | none | reported |
| `G_CLS` interrupt safety with the pointer moving | 300 interrupts in 300 frames, about 235 clears; display all 0 and the poisoned RAM unchanged | 0 lost | pass |
| Longest `DI` | 0 | <= 1,500 | pass |
| Code size | pointer 2,106 bytes; gfx6 13,326 bytes in all (11,222 after S3) | report | over the 4 KB target |

Chunk 0-1 now has about 450 bytes free below `ROWTAB` (`$3800`).

#### How S4 is built (`src/gfx6/pointer.asm`)

- **State and lock:**
  - `P_MOVE`, `P_SHIELD` and `P_UNSHIELD` change the state with `PT_LOCK` held and set `PT_DIRTY`.
  - `P_ISR` returns at once while the lock is held, and otherwise only when `PT_DIRTY` is set (the 50 T skip).
  - Since the main program never runs inside the ISR, the lock is all the exclusion needed; there is no `DI`.
- **Kinds:** by the first byte column c0: even c0 <= 60 and odd c0 <= 61 draw 3 byte columns through unrolled 8-row blocks,
  entered by a table at the row count (1..16 rows = one partial pass then one full pass); c0 = 62 and 63 use row loops.
- **Drawing (in the ISR)** reads the pre-shifted copy with `POP DE` (E mask, D image): SP points at the copy and is restored
  afterwards. Each screen byte is saved to `PT_SAVE` (3 a row) before `(old AND mask) OR image` is written.
- **Erasing** writes `PT_SAVE` back with ordinary loads, so `P_SHIELD` can erase with interrupts on.
- **Rows** step with `INC H` and an inline character-row crossing.

Where a 6,514 T move goes (review figures):

| Part | T |
|---|---|
| Draw rows | 2,944 |
| Erase rows | 1,744 |
| Fixed overhead: entry tables, geometry, setup, `P_ISR`'s checks, pass ends | about 1,830 |

#### Tests

- **`tests/gfx6-model.mjs`:**
  - the S4 model (16.2, 16.4): `PointerModel`, byte rectangles, meets, clamp;
  - self-test of 172 checks.
- **`tests/gfx6-s4.mjs`:** 50 checks, about 37 s a seed. It covers:
  - more than 3,000 random direct calls, with coverage checks for every path and all 48 edge positions;
  - interrupt injection at every instruction boundary of `P_MOVE`, `P_SHIELD`, `P_UNSHIELD` and a shielded `G_FILL` (8,412 runs);
  - the flicker test: 601 strict frames compared pixel for pixel through `m.pixels`, and 12 script batches (83 frames) of shielded
    drawing with interrupts on, including one `G_CLS`;
  - `G_CLS` with the pointer moving;
  - the longest `DI`.

  Passes on seeds 1, 7, 12345 (the agent) and 99 (re-run by the main model).
- **`tests/gfx6-perf.mjs`:** the S4 bounds and reports above.
- **Other changes:** `gfx6-lib.mjs` `CLS_REGIONS` follows 16.1. S1, S2, S3, `gfx6-cls`, `hello` and `probe23` still pass.
- **Written blind:** a Sonnet agent wrote the model and tests from section 16, without reading the code.
  - Seven model-side faults were all caught, among them meets in pixels instead of bytes, no clamp, a pointer one row late and a
    shield that does not erase.
  - Run against an independent Z80 stub, removing the lock made the injection test fail.

#### Independent review (Fable agent, given the code and the contract)

**No confirmed defects.** The reviewer's own model and runs:
- about 40,000 interrupt-injection runs (every boundary of the four routines and of shielded `G_FILL`, `G_SCROLLV` and `G_CLS`);
- 24,000 random programs with random interrupts;
- `P_ISR` and `P_SHIELD` at all 98,304 positions;
- 600 frames of `T_CLSPLOOP`.

It found the worst case that the first 16.7 grid missed (a shield that meets neither position), which led to the wider grid.

**Risks it raised, now rules in 16.3:**
- an ISR must not call the main-program routines, because the lock is one flag;
- `P_SHIELD` needs the display mapped;
- a second `P_INIT` leaves a drawn pointer on the screen.

**Noted, not changed:**
- During back-to-back shielded drawing near the pointer, the pointer stays hidden until a frame interrupt arrives outside any shield. Drawing in `P_UNSHIELD` is not possible: the drawing reads the copy with `POP`, so it needs interrupts off.
- An NMI during the drawing would corrupt the copy; nothing raises one today.

#### Options for more margin (the owner decides; estimates from the review)

| Change | Saves |
|---|---|
| Keep the erase geometry (address, entry, passes) from the draw, so `pt_erase` skips `pt_geom` and `pt_entry` | about 330 T |
| Work out the new position's geometry in `P_MOVE` (outside the ISR) | about 570 T more (`P_MOVE` grows to about 800 T) |
| Erase with `POP` (needs 32 free bytes below `PT_SAVE`) | about 290 T |
| `JP NZ` in the row step; drop the step after the last row | about 60-180 T |

### 13.5 Slice S5 (2026-11-11)

**Result: the demo cartridge `spike6` is built to section 17, its test passes, and ZEsarUX 13.0 and Fuse 1.9.1 agree with TSRun at all 8 checkpoints.** Interface: section 17 (one amendment: 17.5 "release", see below). `src/spike6.asm`, build target `spike6`, `web/?cart=spike6`. S5 adds no bounds: its figures are reports. The S1-S4 figures and the four S3 misses are unchanged.

| Measure (17.7, TSRun T-states; a frame is 58,688 T) | Measured | Bound | Result |
|---|---|---|---|
| `D_SCENE` (whole mock desktop, on a cleared screen) | 709,534 (about 12 frames; drawn once at boot, before `P_INIT`) | none | reported |
| `D_MENU_OPEN` i = 0..4 (Leap 3 items, File 5, Edit 4, View 3, Window 3) | 77,660 / 87,040 / 76,732 / 65,477 / 70,833 | none | reported |
| `D_MENU_CLOSE` i = 0..4 | 21,442 / 27,190 / 24,533 / 21,294 / 21,442 | none | reported |
| Menu switch (close + open) 0->1 / 1->2 / 2->3 / 3->4 / 4->0 | 108,482 / 103,922 / 90,010 / 92,127 / 99,102 | none | reported |
| Drag step (erase + draw of window B's 256 x 112 outline) | 43,586 for (0,0) -> (12,6); 35,432 for (0,0) -> (-72,36), clipped at the bottom | none | reported |
| One `D_OUTLINE` at (0,0) | 19,026 | none | reported |
| Main-loop frames missed over the 426-iteration script | 4 of 430 frames: the "File" open and the switches to Edit, View and Window (each costs more than a frame); 1 more in the test's live phase | none | reported |
| Boot, reset to the record | 134 frames | none | reported |
| Demo code and data (`DEMO_CODE_END - DEMO_CODE`, chunk 5) | 4,811 bytes (with the strings, the 128-byte icon, the script and the command tables); gfx6 unchanged | none | reported |
| ZEsarUX 13.0 (17.8) | 12 of 12 rows pass | all rows | pass |
| Fuse 1.9.1 (17.8) | 10 of 10 rows pass | all rows | pass |

#### How S5 is built (`src/spike6.asm`)

- **Command tables:** the scene and each menu's open and close are tables of commands (routine, A, HL, DE, BC, and n bytes copied to `GA`). A small interpreter, `run_cmds`, runs them, so 17.4 is in the code as data, line for line.
- **Main loop:** one iteration per `HALT`: input (script or live), move with acceleration (the `S_STEP` table), the fire state machine (press, held, release), checkpoint.
- **`D_OUTLINE`** puts each edge under its own shield (one 1-pixel shield per edge). The pointer sits in the title bar, so a shield round the whole outline would hide it every frame while dragging.
- **Joystick read:** copied from Leap Arcade `RT_STICK` (`docs/PROVENANCE.md`).
- **ISR:** that of `gfx6t`, without the `$FF` fill.

#### Tests

- **`tests/spike6.mjs` and `tests/spike6-model.mjs`:**
  - 106 checks, about 3 s; the model's self-test is 12 checks.
  - Passes on seeds 1, 3 and 5 (the agent) and 5 and 7 (the main model).
  - Written by a Sonnet agent from section 17, without reading the code.
  - Covers the 8 checkpoints (display RAM, the rendered frame, and `V_PX`, `V_PY`, `V_MENU`, `V_DRAG` against the model), 134 strict pointer frames in the moving entries, `V_FRAMES` rising by exactly 1 in all 430 frames, the poisoned RAM unchanged, live input (joystick, Q/A/O/P/Space, all four directions = nothing), menus and drags that return the screen to the scene exactly, and direct calls of `D_SCENE`, `D_MENU_OPEN`, `D_MENU_CLOSE` and `D_OUTLINE`.
  - Deliberate faults in the model were caught (menu item y + 1: 35 failures; outline offset sign: 3).
- **`tests/gfx6-perf.mjs`:** now ends with section 7 as a table (measured, bound, pass / MISSED / reported). The checks are unchanged: 62 pass, and the 4 known S3 misses fail.
- **The test found a cartridge bug.** Releasing fire on an iteration that also moved the pointer erased the outline at the new offset and left the old one on the screen. Fixed: the erase is at the position before the move. 17.5 "release" was amended to say so, and two live checks were added (release while moving, for a drag and for a menu). The main model confirmed that they fail on the old code (2 failures) and pass on the fixed code.

#### Cross-emulator runs (17.8)

- **TSRun reference:** `node tools/xemu/spike6-ref.mjs`. The checkpoint dumps are in `build/xemu/spike6-ref/`.
- **ZEsarUX 13.0:** `python3 tools/xemu/zesarux-spike6.py`; 12 of 12 rows pass.
  - A breakpoint at `S_CHECK`. At all 8 stops the 12,288 display bytes are identical to TSRun's, and `V_PX`, `V_PY`, `V_MENU`, `V_DRAG` and `V_TICK` are equal.
  - The record ends in state 2.
  - Interrupts: `V_FRAMES` rose by 400 in 27,955,227 T, which is 400.00 frames of 69,888 T. ZEsarUX's TS2068 frame is 69,888 T; TSRun's is 58,688 T.
  - `V_FRAMES - V_TICK` rises by 4 over the script on both emulators (the same missed frames).
  - DOCK chunks 0, 1, 4 and 5 are unchanged (0 bytes differ).
- **Fuse 1.9.1:** `sh tools/xemu/fuse-spike6.sh`; 10 of 10 rows pass.
  - The movie has 2,100 frames, 1,983 of them hi-res. All 8 checkpoint bitmaps are found, in order (first frames 139, 201, 312, 333, 406, 426, 476, 550).
  - `fmfconv` 0.5 cannot read Fuse 1.9.1's Timex hi-res movie chunks ("Unknown FMF chunk type"), and `-S` writes only 6,912-byte screens. So `tools/xemu/fuse-spike6-check.mjs` decodes the `.fmf` itself (the format is from Fuse's `movie.c`; recorded with `--movie-compr None`).
- **`G_FILL`'s `IXh` / `IXl` instructions** (13.1) behave the same on ZEsarUX and Fuse as on TSRun: the scene, the menus and the outline use its 2..8-column bodies.

#### Changes and interpretations

- 17.5 "release" was amended after the bug above.
- The Sonnet test agent resolved three ambiguities in section 17, and they match the code: the op of an unnamed step is SET; the press position is after the move; up and down together advance "hold".
- The pointer deadline of section 5 was measured on TSRun's timing. ZEsarUX's frame is longer (69,888 T against 58,688 T).

#### What the owner may want to change (findings, not defects)

1. **A menu open costs more than a frame (65,477 to 87,040 T),** so the pointer lags one frame at each open or switch. The item texts are separate `G_TEXTP` calls, and each pays the line setup (about 2,760 T, 13.2). The options below are estimates, not measured:

   | Change | Saves |
   |---|---|
   | All items in one `G_TEXTP` call with code 13 and `GLH` 10 (one setup instead of k) | about 2,700 T per item after the first |
   | Draw the drop-down over two frames | the pointer keeps its frame |

2. **The pointer is invisible at the far corner.** At (511, 191) only the hot-spot pixel is on the screen, and `P_ARROW`'s top-left pixel is its paper outline. On the right and bottom edges only a sliver shows. Option: an arrow whose hot spot is ink. For the same reason Fuse's picture check cannot tell checkpoint 7 from the scene; ZEsarUX's byte compare covers it.
3. **The frame lengths differ:** TSRun's frame is 58,688 T (262 lines of 224 T, the NTSC TS2068), ZEsarUX's 69,888 T. The deadline of section 5 uses TSRun's beam timing (row 0 at 8,960 T); real hardware's timing, with contention, is a check for the hardware phase.

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

## 15. S3 interface (designed 2026-11-11, binding for the S3 code and tests)

Section 15 fills in what sections 3-7 leave open for slice S3 (`G_LINE`, `G_BLIT`, `G_SAVERECT` / `G_RESTRECT`, `G_SCROLLV`). It
adds to sections 12 and 14; nothing in them changes except where 15.1 says so. The tests are written from sections 3-7, 12, 14
and this section, never from the code.

### 15.1 Memory and arguments

- **`GA+8`** (word) is a fifth argument: the shifted set (`G_BLIT`), the source bitmap (`G_PRESHIFT`), the buffer address
  (`G_SAVERECT`) or the row count n (`G_SCROLLV`). **`GA+10`** (word) is a sixth, only for `G_PRESHIFT` (the destination).
  `GA+12..GA+15` stay unused.
- **Scratch:** S3 routines use gfx6's own variables (`$E01A-$E07F`, 14.1) and **`$E700-$E7FF` (`GCODE`, 256 bytes, amends
  section 3)**: row-copy code that `G_SAVERECT`, `G_RESTRECT` and `G_SCROLLV` write for each call (one row of `LDI` chains
  for the call's width, so a row costs no computed jumps). Any gfx6 routine may write it; nothing else may. Section 3's pointer
  area becomes `$E100-$E6FF` (1,536 bytes; S4 needs about 900).
- **Save-under buffer (amends section 3):** the buffer is an argument, so menus can nest (each save goes after the last one).
  `$E800-$EFFF` stays the area the demo uses; the heap is where the kernel will take it from (FEASIBILITY section 3).
- **Tables:** S3 may add internal tables to `tables.inc` / `tables4.inc` through `tools/gen-tables.mjs`. They are not part of the
  interface. `G_PRESHIFT` reads `SHR` / `SHL` (14.2).

### 15.2 Routines

All preserve IX, IY and the alternate registers, execute no `DI` or `EI`, use at most 32 bytes of stack below their return
address, leave `GA`, `GOP`, `GLH` and `GCLIP` unchanged, and clobber AF, BC, DE, HL. Coordinates, sizes and n are signed words in
-16384..16383, as 12.1.

| Routine | In | Out / effect |
|---|---|---|
| `G_LINE` | `GA+0` x0, `GA+2` y0, `GA+4` x1, `GA+6` y1 | The pixels P(i), i = 0..dmaj, of the line below that are inside the clip get the draw op (`SET`, `CLR`, `XOR`); nothing else changes |
| `G_PRESHIFT` | `GA+4` w, `GA+6` h, `GA+8` source bitmap, `GA+10` destination | Writes the **shifted set** of the bitmap (below) at the destination: exactly the bytes `[dest, dest + 16 h (wb + 1))`. Returns **HL = dest + 16 h (wb + 1)**. w <= 0 or h <= 0 writes nothing (HL = dest); w and h above 32 are not allowed. Ignores the clip and `GOP`. Not bounded (built once per bitmap); its time is reported |
| `G_BLIT` | `GA+0` x, `GA+2` y, `GA+4` w, `GA+6` h, `GA+8` shifted set (from `G_PRESHIFT` with the same w, h) | Bitmap pixel (j, k), j < w, k < h, at screen (x + j, y + k), if inside the clip: new = (old AND m) OR i, with m and i its mask and image bits in the source bitmap. Ignores `GOP`. w <= 0 or h <= 0 draws nothing; w and h above 32 are not allowed (undefined). The set is only read |
| `G_SAVERECT` | `GA+0` x, `GA+2` y, `GA+4` w, `GA+6` h, `GA+8` buffer address | Saves the **byte rectangle** of (x, y, w, h) (below) into the buffer. Writes exactly the bytes `[buf, buf + 4 + nc x nr)`. Returns **HL = buf + 4 + nc x nr** (the first byte after it). Ignores the clip and `GOP` |
| `G_RESTRECT` | HL = buffer address | Writes the saved bytes back to the screen bytes they came from. Changes nothing else, and only reads the buffer. Ignores the clip and `GOP`. The buffer must hold what `G_SAVERECT` wrote, unchanged; anything else is undefined |
| `G_SCROLLV` | `GA+0` x, `GA+2` y, `GA+4` w, `GA+6` h, `GA+8` n | Scrolls the **scroll region** (below) by n pixel rows: n > 0 moves the content up, n < 0 down, n = 0 does nothing. Rows uncovered by the move become paper (bytes 0). When abs(n) >= the region's row count, the whole region becomes paper. Ignores `GOP`. Nothing outside the region changes |

**The line** (amended 2026-11-11, owner approved: the same pixels whichever end is given first). The major axis is x when
abs(x1 - x0) >= abs(y1 - y0), else y. The **start** S is the end with the smaller major coordinate (either end when they are
equal), and E is the other. dmaj = E's major coordinate - S's (>= 0), dmin = abs(E's minor coordinate - S's), smin = the sign
of E's minor coordinate - S's (+1 for 0). For i = 0..dmaj:

- major coordinate of P(i) = S's + i;
- minor coordinate of P(i) = S's + smin x floor((2 i dmin + dmaj) / (2 dmaj)) (0 when dmaj = 0: a single pixel, the two ends
  being the same point).

This is Leap V2's `GFX_LINE` rule (error from dmaj / 2, the minor axis steps when the error reaches dmaj) in closed form, always
run left to right (x major) or top to bottom (y major). So (x0, y0)-(x1, y1) and (x1, y1)-(x0, y0) give the same pixels. Both
ends are drawn. The P(i) are all different (their major coordinates differ), so `XOR` twice restores the screen, with the ends
in either order. Clipping keeps exactly the P(i) that are inside the clip: it never moves a pixel. The intermediate values
2 i dmin reach about 2^31, so the model uses exact arithmetic.

**`G_BLIT` data format** (Leap Arcade's pair format, unshifted): wb = (w + 7) >> 3 pairs a row; h rows, top row first; each row
is wb (mask, image) byte pairs, left pair first; bit 7 of a byte is its leftmost pixel. So pixel (j, k) has its pair at
`data + 2 (k wb + (j >> 3))`, mask byte first, and bit `7 - (j AND 7)`. Mask 1 keeps the screen pixel; image 1 then sets it
to ink. The columns w..8 wb - 1 of every row **must** be transparent (mask 1, image 0), so it makes no difference whether the
routine processes them. The data is only read, and must not be in the display files.

**Shifted set** (written by `G_PRESHIFT`; a tool may also build one, for example for icons in ROM): ws = wb + 1 pairs a row.
Copy p (p = 0..7) starts at `set + 2 p h ws`; its row k at `+ 2 k ws`; its pair q (q = 0..wb) at `+ 2 q`, mask byte first:
- mask = (M(q - 1) << (8 - p) OR M(q) >> p) AND $FF, with M(-1) = M(wb) = $FF;
- image = the same with the image bytes, I(-1) = I(wb) = 0.

So pair q of copy x AND 7 is the screen byte at byte column (x >> 3) + q (an arithmetic shift for negative x). The whole set is
16 h ws bytes: 768 for 16 x 16, 2,560 for 32 x 32.

**Byte rectangle** (`G_SAVERECT`): clamp (x, y, w, h) to the screen as `G_SETCLIP` does, giving the half-open ranges
[ax, bx) and [ay, by). When either is empty, nc = nr = 0. Otherwise the byte columns c0 = ax >> 3 to c1 = (bx - 1) >> 3, so
nc = c1 - c0 + 1 (every byte that holds a pixel of the rectangle), and the rows ay to by - 1, so nr = by - ay. The buffer's
layout is internal: a 4-byte header and then nc x nr screen bytes in an order of the code's choosing. Only `G_RESTRECT` reads it.
The caller allocates 4 + nc x nr bytes; the largest (whole screen) is 12,292.

**Scroll region** (`G_SCROLLV`): intersect (x, y, w, h) with the clip, giving [cx0, cx1) and [cy0, cy1). The region is the
byte columns lying wholly inside [cx0, cx1) (c from ceil(cx0 / 8) to floor(cx1 / 8) - 1) and the rows cy0 to cy1 - 1. A partial
byte at either edge is left alone, so `G_SCROLLV` never writes outside the clip. The region is empty when it has no whole byte
column or no row. With nr rows and m = abs(n) < nr:

- n > 0 (up): row cy0 + r gets the old row cy0 + r + m for r = 0..nr - 1 - m; the last m rows become paper;
- n < 0 (down): row cy0 + m + r gets the old row cy0 + r for r = 0..nr - 1 - m; the first m rows become paper.

A window's content area that should scroll whole is placed on byte columns.

**Pointer (S4):** `G_LINE`, `G_BLIT`, `G_SAVERECT`, `G_RESTRECT` and `G_SCROLLV` read or write the screen, so once the pointer
exists they are called shielded (section 4). `G_SAVERECT` unshielded would save the pointer's image. `G_BLIT` writes back whole
screen bytes (unchanged pixels included), so its shield rectangle must cover the bytes, not only the bitmap's pixels.

### 15.3 Test cartridge additions

- `gfx6t` exports `G_LINE`, `G_BLIT`, `G_PRESHIFT`, `G_SAVERECT`, `G_RESTRECT`, `G_SCROLLV`.
- **Blit source bitmaps** go in `T_STR` (`$D000-$D1FF`, 14.5; a 32 x 32 bitmap is 256 bytes), and **shifted sets** in `T_BUF`
  (up to 2,560 bytes). `G_PRESHIFT` must leave `T_STR` unchanged and write exactly `[dest, returned HL)`; `G_BLIT` must leave both
  unchanged. Each shifted set is checked byte for byte against the model's (the format above).
- **Save buffer:** `T_BUF` = `$C000`, 4 KB (`$C000-$CFFF`). Tests use buffer addresses inside it and rectangles whose
  4 + nc x nr fits before `$D000`. It **is** poisoned like the rest of 12.4's RAM:
  - after `G_SAVERECT` every poisoned byte outside `[buf, returned HL)` is unchanged;
  - after `G_RESTRECT` all of `T_BUF` is unchanged.
- **`G_SAVERECT` / `G_RESTRECT` are checked as a pair:**
  1. seed the display with random bytes;
  2. save;
  3. change the display (random bytes, or random `G_FILL` calls), and mirror the change in the model;
  4. restore.

  Then the bytes of the byte rectangle equal their values at step 2, and every other display byte equals its value after step 3.
  Nested saves (several buffers one after another, restored in reverse order) are part of the random runs.
- `G_SCROLLV` and `G_BLIT` start from random display bytes, so the edges show any stray write.

### 15.4 How the S3 bounds are measured

| Measure (section 7) | Calls |
|---|---|
| `G_LINE` per pixel | 200 lines, ends uniform on the screen (x 0..511, y 0..191), fixed seed, op `SET`, clip whole screen. Total T / total pixels (sum of dmaj + 1). **Report:** `XOR`; the `SET` figure split by major axis (x / y) |
| `G_LINE` long clipped lines | **Report:** (-16384, -16384)-(16383, 16383) and (-16384, 0)-(16383, 191), op `SET`, clip whole screen, T a call |
| `G_BLIT` 16 x 16 / 32 x 32 at any x | The worst over x = 64 + p, p = 0..7, and y in {0, 5}. Fixed random data (mask and image bytes uniform), its shifted set built by `G_PRESHIFT` first (not counted), clip whole screen. **Report** the 16 x 16 figure for each p at y = 0, and `G_PRESHIFT` for 16 x 16 and 32 x 32 |
| `G_SAVERECT` / `G_RESTRECT` 96 x 80 | The worst over x in {64, 72} (even and odd first byte column) and y in {0, 53}; buffer `T_BUF`. Each restore puts back its own save |
| `G_SCROLLV` 256 x 96 by 1 row | (128, y, 256, 96) for y in {48, 53}, n in {1, -1}, clip whole screen: the worst |
| `G_SCROLLV` 512 x 192 by 8 rows | (0, 0, 512, 192), n in {8, -8}: the worst. **Report:** the same by 1 row and by 10 rows (n = 1, 10) |
| Longest `DI` | `G_LINE`, `G_BLIT`, `G_PRESHIFT`, `G_SAVERECT`, `G_RESTRECT`, `G_SCROLLV`: as 12.5 |
| Code size | as 12.5, report |

## 16. S4 interface (designed 2026-11-11, binding for the S4 code and tests)

Section 16 fills in what sections 4, 5 and 7 leave open for slice S4: the pointer, drawn by the frame interrupt, and the shield.
It adds to sections 12, 14 and 15; nothing in them changes except where 16.1 says so. The tests are written from sections 3-7,
12, 14, 15 and this section, never from the code.

### 16.1 Amendments and memory

- **Section 4, interrupts:** the 1,500 T limit is for code that runs with interrupts on and turns them off. The frame ISR is
  exempt: it runs once per frame, right after the interrupt, and its own bound is section 7's pointer row. `P_ISR` never
  executes `EI` or `DI`.
- **Section 5, shield:** `P_SHIELD` must erase the pointer **at once** (in the caller, before it returns) when the pointer is
  drawn where the shield is, because the caller draws there next. Only the redraw is left to the ISR. `P_UNSHIELD` only sets a
  flag.
- **Section 11:** S4's model and tests are written by a Sonnet agent from this section (owner's standing instruction, CLAUDE.md);
  the Z80 code is the main model's. An independent review of `P_ISR` is done by a separate Fable agent.
- **Pointer area `$E100-$E6FF`** (section 3, 15.1) belongs to the pointer routines. Its layout is internal. It must be all 0
  before `P_INIT` is called (`gfx6t` clears `$E000-$EFFF` at boot), and nothing else writes it.
  - **Tests that run frames** (the ISR calls `P_ISR`) must not poison it.
  - **Amends 12.5:** `G_CLS` interrupt safety poisons `$5800-$5FFF`, `$7800-$7FFF`, `$C000-$DFFF` and `$E700-$FAFF` (not
    `$E100-$E6FF`).
- **The pointer shape** is `P_ARROW`: a 16 x 16 bitmap in `G_BLIT`'s pair format (15.2: wb = 2, 64 bytes) in the cartridge. The
  model reads these 64 bytes from the image. The hot spot is the bitmap's top-left pixel (0, 0), so the pointer is cut only at
  the right and bottom screen edges.

### 16.2 Definitions

- **Position** `(px, py)`: the hot spot, always on the screen: 0 <= px <= 511, 0 <= py <= 191.
- **The pointer's byte rectangle** at (px, py): byte columns `c0 = px >> 3` to `min(c0 + 2, 63)`, rows py to `min(py + 15, 191)`.
  These are the only display bytes the pointer code ever writes.
- **The shield's byte rectangle** of (x, y, w, h): clamp to the screen as `G_SETCLIP` does, giving [ax, bx) and [ay, by). Empty
  when either range is empty. Otherwise byte columns `ax >> 3` to `(bx - 1) >> 3`, rows ay to by - 1.
- **Meets:** two byte rectangles meet when they share at least one (byte column, row). An empty rectangle meets nothing.
- **Pointer image** at (px, py) over a screen: bitmap pixel (j, k), j, k in 0..15, at screen (px + j, py + k) when that is on the
  screen: new = (old AND m) OR i (m, i: its mask and image bits in `P_ARROW`). This is `G_BLIT` with the clip set to the
  whole screen.

### 16.3 Routines

All preserve IX, IY and the alternate registers, and clobber AF, BC, DE, HL. None executes `DI` or `EI`. None changes `GOP`,
`GLH` or `GCLIP`.

**Callers (added after the S4 review):**
- `P_INIT`, `P_MOVE`, `P_SHIELD` and `P_UNSHIELD` are called **only from the main program, never from an ISR**. The lock is one flag, not a count, so an ISR's call would release the main program's lock. A future mouse poll in the ISR records its movement elsewhere and calls nothing here.
- `P_SHIELD` may write the display, so it runs with the display mapped (`$F4` = `$33`). An application in DOCK 2-3 reaches it through a kernel trampoline.
- `P_INIT` is called once. Calling it again while the pointer is drawn would leave the drawn image on the screen.

| Routine | In | Effect | Stack |
|---|---|---|---|
| `P_INIT` | HL = x, DE = y (signed words) | Builds the pointer's 8 pre-shifted copies from `P_ARROW` (with `G_PRESHIFT`), sets the position to (x, y) clamped, removes the shield, turns the pointer **on**. Draws nothing: the next `P_ISR` draws it. Called once, after boot and before anything else in 16.3. Interrupts may be on. `GA` is undefined afterwards | <= 48 |
| `P_MOVE` | HL = x, DE = y (signed words) | Position = (clamp(x, 0, 511), clamp(y, 0, 191)). Draws nothing: the next `P_ISR` moves the pointer. `GA` unchanged | <= 32 |
| `P_SHIELD` | `GA`: x, y, w, h | The shield becomes this rectangle (replacing any shield). If the pointer is drawn and its byte rectangle (where it is drawn) meets the shield's byte rectangle, it is erased before `P_SHIELD` returns. `GA` unchanged | <= 32 |
| `P_UNSHIELD` | | Removes the shield. Draws nothing: the next `P_ISR` redraws a pointer that was hidden | <= 32 |
| `P_ISR` | | Called by the frame ISR, interrupts off, with the display mapped (`$F4` = `$33`). Brings the drawn pointer up to date (16.4). Does nothing before `P_INIT` | <= 16 |

"Stack" is the most bytes used below the routine's return address. The cartridge's whole ISR (return address included) stays within
12.2's 32 bytes.

**How to use the shield** (binding on callers): a routine that reads or writes display bytes runs between `P_SHIELD` and
`P_UNSHIELD`, and the shield's byte rectangle covers every display byte it reads or writes. For `G_FILL`, `G_TEXT*`, `G_LINE`
and `G_SCROLLV` the routine's own rectangle is enough (they write only bytes that hold its pixels). For `G_BLIT`, `G_SAVERECT`
and `G_RESTRECT` the shield covers the whole bytes (15.2). For `G_CLS` it is the whole screen.

### 16.4 The pointer's state (the model)

State: position (px, py); on (false until `P_INIT`); shield S (a byte rectangle, or none); drawn D (a position, or none). The
display always equals **the screen with the pointer image at D** when D is a position. "The screen" is what shielded drawing
made of it; the pointer code never changes it.

- `P_INIT(x, y)`: position = clamped (x, y); on = true; S = none; D = none.
- `P_MOVE(x, y)`: position = clamped (x, y).
- `P_SHIELD(r)`: S = byte rectangle of r; if D is a position whose byte rectangle meets S: erase (D = none).
- `P_UNSHIELD`: S = none.
- `P_ISR`: visible = on, and not (S is set and the byte rectangle at the position meets S).
  - If D is a position and (not visible, or D differs from the position): erase (D = none).
  - Then if visible and D is none: draw at the position (D = the position).
  - Erasing restores exactly the bytes the drawing changed; drawing changes only the pointer's byte rectangle.

**Interrupts during the other routines:** the frame ISR may arrive at any instruction of `P_MOVE`, `P_SHIELD`, `P_UNSHIELD` or
a shielded drawing routine. However that falls, once the routine has returned and `P_ISR` has run once more, the display
equals what this model gives for "the routine, then `P_ISR`". (The routines take a lock that makes `P_ISR` skip a frame; the
lock is internal.)

**Skip:** when nothing in 16.3 was called since the last `P_ISR`, `P_ISR` writes nothing and costs at most 300 T.

**Tearing:** `P_ISR` erases and draws the whole pointer before the beam reaches the first row of either the old position or the
new one (section 5), so no frame shows part of a pointer. Erasing in `P_SHIELD` runs in the main program at any moment and may
show a part of a pointer for one frame. The main program's drawing may also show part-drawn shapes. Both are drawing on the visible
screen, not pointer tearing.

### 16.5 Test cartridge additions (`gfx6t`)

**Symbols:** `P_INIT`, `P_MOVE`, `P_SHIELD`, `P_UNSHIELD`, `P_ISR`, `P_ARROW`, `P_CODE`, `P_CODE_END` (the pointer code, inside
`GFX6_CODE`..`GFX6_CODE_END`), `T_ISRP`, `T_WAIT`, `T_SCRIPT`, `T_SCRDONE`, `T_SCR`, `V_SCRN`, `T_CLSPLOOP`, `T_CLSPDONE`.

- **Boot is unchanged.** It does not call `P_INIT`: the pointer stays off until a test calls it.
- **ISR** (IM 1, at `$0038`):
  1. saves AF, BC, DE, HL;
  2. increments `V_FRAMES`;
  3. sets `$F4` = `$33`, calls `P_ISR`, writes the shadow `V_SHADOW_F4` back to `$F4`. `T_ISRP` is the address right after
     `CALL P_ISR`;
  4. leaves `$FF` bytes in its frame down to 32 bytes below the interrupted SP (as 12.4, now 32 deep);
  5. restores the registers, `EI`, `RET`.
- **`T_WAIT`:** `HALT`, `RET`. A script command that waits for the next frame interrupt.
- **Script runner** `T_SCRIPT`: entered with interrupts off (it executes `EI`) and SP = `$FF00`. It runs the commands at `T_SCR`
  = `$D200` (`$D200-$DFFF`, 137 commands at most), then idles at `T_SCRDONE` (a `HALT` loop).
  - A command is 26 bytes: +0 the routine's address (word; 0 = end of the script), +2 HL, +4 DE, +6 BC, +8 A, +9 unused,
    +10..+25 sixteen bytes copied to `GA` before the call.
  - After each command returns, the word `V_SCRN` is incremented.
  - The runner keeps its place in IX. Routines only read `T_SCR`, and tests do not poison it.
- **`T_CLSPLOOP`:** `EI`, then forever:
  1. move the pointer: x = (x + 37) mod 512, y = (y + 13) mod 192, from (0, 0), with `P_MOVE`;
  2. `P_SHIELD` (0, 0, 512, 192), `G_CLS`;
  3. `T_CLSPDONE`: `P_UNSHIELD`, increment `V_CLS`.

  The test calls `P_INIT` first.

### 16.6 Tests (`tests/gfx6-s4.mjs`; S1-S3, `gfx6-cls` and `hello` must still pass)

Each comparison below is of all 512 x 192 pixels against the model (16.4 over the S1-S3 model).

1. **Random direct calls** (interrupts off, as 12.4):
   - at least 3,000 steps a seed, each a random one of `P_MOVE`, `P_SHIELD`, `P_UNSHIELD`, `P_ISR` and "shielded drawing"
     (`P_SHIELD` r, then `G_FILL`, `G_TEXTP` or `G_SCROLLV` inside r, then `P_UNSHIELD`), over a random background;
   - positions include every edge case of 16.2: x in {0, 7, 8, 495, 496, 503, 504, 511} and y in {0, 7, 8, 176, 177, 191};
   - the display RAM is compared with the model after every step;
   - registers (16.3) are checked; `GA`, `GOP`, `GLH` and `GCLIP` are unchanged (except after `P_INIT`);
   - RAM outside the display files, the pointer area, `$E000-$E0FF`, `$E700-$E7FF`, `T_STR` and `T_SCR` is poisoned and
     unchanged; the stack limits of 16.3 are checked by poisoning below them.
2. **Interrupt injection:**
   - For `P_MOVE`, `P_SHIELD` (one rectangle that meets the drawn pointer, one that does not), `P_UNSHIELD` and a shielded
     `G_FILL` (32 x 16): for **every** instruction boundary k of the routine, restore a fixed starting state, call the routine
     with interrupts on, raise the frame interrupt after k instructions (`Z.irqZ80`), and run on until it returns. Then call
     `P_ISR` once and compare with the model.
   - The starting state has the pointer drawn at A and a `P_MOVE` to B pending. Both cases are covered: B meets the rectangle,
     and B does not.
   - `V_FRAMES` rises by exactly 1 each time.
3. **Flicker test (frames, 16.4 "Tearing"):**
   - **Setup:** `P_INIT` (256, 96) and a background of `G_FILL` rectangles (`SET` and `XOR`), `G_TEXT8` and `G_TEXTP` lines,
     drawn by direct calls; then two settling frames.
   - **600 strict frames.** For each frame, in this order:
     1. step the pending frame interrupt to the ISR's `RET`, logging the ISR's T and the offset `m.tstates - m.frameStart` at
        `T_ISRP`;
     2. make this frame's calls from the scripted path by direct calls: `P_MOVE`, sometimes `P_SHIELD` / `P_UNSHIELD`;
     3. assert the offset is still below 8,960 (a harness check, so that everything is written before the beam reaches the
        screen);
     4. put the CPU back at `T_IDLE` (SP `$FF00`, interrupts on, not halted);
     5. `runFrame`.

     The rendered frame (`m.pixels`) must equal the model after step 2, exactly.
   - **The path:**
     - straight runs at 1 to 24 pixels a frame;
     - stops (the skip);
     - jumps to the corners and to every edge position of test 1;
     - both parities of c0 and every px AND 7;
     - shields held over several frames, some meeting the pointer's path and some not.
   - **Every 50 strict frames, a script batch** (`T_SCRIPT`) of shielded drawing with interrupts on, interleaved with `P_MOVE`
     and `T_WAIT`, so that the pointer moves while long drawings run:
     - `G_FILL`, `G_TEXTP`, `G_SCROLLV` (one of at least 256 x 96);
     - once in the test, `G_CLS` and a redrawn background.

     Frames run until `T_SCRDONE`. In each of these frames, the pixels outside the volatile area must equal the model. The
     volatile area is the union of the batch's shield byte rectangles and of the pointer's byte rectangles at every position
     before and during the batch. The next strict frame then checks the whole screen.
   - **In every frame**, `V_FRAMES` rises by exactly 1.
   - **Report:** the ISR's T (minimum, mean, maximum), the frames, and the largest `T_ISRP` offset.
4. **`G_CLS` with the pointer moving** (section 7; replaces the S1 note in 13.1):
   - `P_INIT` (0, 0), poison the regions of 16.1, run `T_CLSPLOOP` for 300 frames;
   - `V_FRAMES` rises by exactly 300;
   - stepped on to `T_CLSPDONE`, the display is all 0 and the poisoned RAM is unchanged.
5. **Longest `DI`** (as 12.5): `P_INIT`, `P_MOVE`, `P_SHIELD`, `P_UNSHIELD`: <= 1,500. `P_ISR` called with interrupts off returns
   with them off.

### 16.7 How the S4 bounds are measured (section 7, pointer row)

| Measure | Calls |
|---|---|
| `P_ISR` moving (erase + draw) | Direct call, interrupts off, after `P_INIT`, `P_ISR` (drawn at A), `P_MOVE` (B). B over x in {64..71, 0, 7, 8, 488, 495, 496, 503, 504, 511}, y in {0, 5, 7, 176, 183, 191}; A = ((Bx + 200) mod 512, (By + 50) mod 192), and also A = (Bx, (By + 40) mod 192). Each pair twice: with no shield, and with a shield set that meets neither A nor B (when one exists; for example a 1-row shield on a row neither covers). The worst: <= 7,000 (**amended 2026-11-11** after the S4 review: a shield that meets neither position costs about 225 T more, and the first grid missed it) |
| `P_ISR` skipped | `P_ISR` again with no call in between: the worst over the same positions, <= 300 |
| `P_ISR` other paths | **Report:** draw only (after `P_UNSHIELD`), erase only (a `P_SHIELD` that meets the new position, after a `P_MOVE`), `P_MOVE` to the same position, a move while hidden by the shield |
| Deadline | The largest `T_ISRP` offset over the strict frames of 16.6.3, plus 1,500 (the worst interrupt delay, section 4): <= 8,960 (pixel row 0, section 5) |
| `P_SHIELD` / `P_UNSHIELD` / `P_MOVE` | **Report:** `P_SHIELD` with and without an erase, the worst over the positions above; `P_UNSHIELD`; `P_MOVE` |
| `P_INIT` | **Report** (once, at boot) |
| Code size | **Report:** `P_CODE_END - P_CODE`, and the new `GFX6_CODE_END - GFX6_CODE` |

## 17. S5 interface (designed 2026-11-11, binding for the S5 code and tests)

Section 17 fills in what sections 9-11 leave open for slice S5: the demo cartridge `spike6`, its tests and cross-emulator runs, and
the closing reports. It adds to sections 12-16; nothing in them changes. The tests are written from sections 3-7, 12, 14-16 and
this section, never from the code.

### 17.1 Amendments to section 9 and section 11

- **Who** (section 11, following CLAUDE.md): the `spike6` Z80 code (it has an ISR) is the main model's. Its reference model and
  tests, the cross-emulator runners and the doc updates from measured figures are Sonnet agents'; test runs are Haiku agents'.
  The main model checks every result and writes the mode decision.
- **A menu opens** while fire is held on its title (section 9 said none opens). It costs little and shows the one thing the
  S3 misses leave open: whether a save-under menu at 23,000 T looks right. It does nothing when released.
- **An attract script.** After boot the demo plays a fixed input script (17.5) for 426 main-loop iterations, then reads the
  joystick and keys. ZEsarUX and Fuse run headless without input, so the script is what they are compared on.
- **The icon is 32 x 16**, so it looks about square on mode 6's tall pixels.

### 17.2 Memory and cartridge

The shape of `gfx6t` (12.4): DOCK chunks 0, 1, 4, 5; `$F4 = $33`; stack top `$FF00`; record at `$FF00`. Build target `spike6`
(`src/spike6.asm`, tables as `gfx6t`). It includes `gfx6/gfx6.asm` and the tables exactly as `gfx6t` does; the demo's own code
and data go in chunk 5 (`$A000-$BFFF`).

| Address | What |
|---|---|
| `$C000-$C4FF` | `S_SET`: the icon's shifted set (`G_PRESHIFT`, 16 x 16 x 5 = 1,280 bytes) |
| `$E800-$EFFF` | The menu's save-under buffer (`G_SAVERECT` at `$E800`) |
| `$E080-$E0FF` | The demo's variables (below) |
| `$5800-$5FFF`, `$7800-$7FFF`, `$C500-$DFFF`, `$F000-$FAFF` | Not written by the demo after boot |

**Symbols** the tests use (from `build/spike6/out.sym`): all of `gfx6t`'s gfx6 and pointer symbols that exist in `spike6`, and
`S_ICON`, `S_SET`, `S_SCRIPT`, `D_SCENE`, `D_MENU_OPEN`, `D_MENU_CLOSE`, `D_OUTLINE`, `S_LOOP`, `S_WAIT`, `S_CHECK`, `T_RET`,
`RESULT`, `DEMO_CODE` and `DEMO_CODE_END` (the demo's own code and data in chunk 5), and the variables `V_FRAMES` (word), `V_TICK` (word: main-loop iterations), `V_PX` (word), `V_PY` (byte), `V_MENU` (byte:
the open menu 0..4, `$FF` none), `V_DRAG` (byte: 0 none, 1 window A, 2 window B), `V_CHECKS` (byte: checkpoints passed).

**Record** at `$FF00`: marker `$A5 $5A` (written last, once the scene is drawn and `P_INIT` called), +2 state: 1 = the script is
playing, 2 = the script has ended (live input).

### 17.3 Boot and ISR

**Boot:**
1. as `gfx6t` (`DI`, stack, ports with shadows stored before each `OUT`, AY registers 0, `$E000-$FFFF` and `$4000-$7FFF` cleared,
   mode 6, `G_INIT`);
2. `EI`;
3. `G_PRESHIFT` of `S_ICON` (w 32, h 16) to `S_SET`;
4. `D_SCENE`;
5. `P_INIT` (256, 96);
6. the record (state 1), then the main loop at `S_WAIT`.

**ISR** (IM 1, `$0038`): saves AF, BC, DE, HL; increments `V_FRAMES`; sets `$F4 = $33`, calls `P_ISR`, writes the shadow back to
`$F4`; restores; `EI`; `RET`. It touches nothing else (no `$FF` fill, no AY).

### 17.4 The scene and the drawing routines

**Settings between drawing steps:** `GOP` = `SET`, `GLH` = 8, clip = the whole screen. Every routine below leaves them so.

**Menu titles** i = 0..4: "Leap", "File", "Edit", "View", "Window". Title rectangle `T_i` = (8 + 56 i, 0, 56, 10).

**Menu items** (drop-down of title i, k_i items):

| i | Items |
|---|---|
| 0 | "About Leap Desktop", "Calculator", "Notepad" |
| 1 | "New", "Open...", "Close", "Save", "Quit" |
| 2 | "Undo", "Cut", "Copy", "Paste" |
| 3 | "By Icon", "By Name", "By Size" |
| 4 | "Bring to Front", "Tile", "Close All" |

Drop-down rectangle `M_i` = (8 + 56 i, 10, 128, 10 k_i + 4).

**Windows:**

| | Rectangle | Title |
|---|---|---|
| A | (32, 24, 288, 104) | "Notes (8x8)" |
| B | (224, 64, 256, 112) | "About mode 6 (proportional)" |

The title bar of a window (x, y, w, h) is (x, y, w, 11); its interior is (x + 1, y + 11, w - 2, h - 12).

**Drawing a window** (x, y, w, h) with title t:
1. `CLR` `G_FILL` (x, y, w, h);
2. `SET` `G_FRAME` (x, y, w, h);
3. `SET` `G_FILL` (x, y, w, 11);
4. `XOR` `G_TEXTP` t at (x + 8, y + 2);
5. clip = the interior, `SET`, the window's content, clip = the whole screen.

**Content of A:** `G_TEXT8` lines (column 5, row r):

| r | Text |
|---|---|
| 5 | "Leap Desktop spike6" |
| 6 | "Mode 6: 512 x 192, 64 columns." |
| 7 | "This window uses the 8x8 font." |
| 9 | "The pointer is drawn by the" |
| 10 | "frame interrupt. Hold fire on" |
| 11 | "a menu title to open its list," |
| 12 | "or on a title bar to drag an" |
| 13 | "outline. Nothing else works." |

**Content of B:** line j = 0..12 by `G_TEXTP` at (232, 78 + 8 j):

| j | Text |
|---|---|
| 0 | "The quick brown fox jumps over the lazy dog." |
| 1 | "Mode 6 gives the desktop 512 pixels across, so a" |
| 2 | "proportional font fits about eighty characters on a" |
| 3 | "line. Each glyph is shifted into place through byte" |
| 4 | "tables and clipped to its window. This line is long enough to run past the right edge of the window." |
| 5 | "Menus, title bars and dialogs all use it:" |
| 6 | "(1) open, (2) scroll, [3] close;" |
| 7 | `"quotes", 'apostrophes' & 100% {braces}` |
| 8 | "<angles> @home #tags $5 ~ok? Yes!" |
| 9 | "0123456789 ABCDEFGHIJKLM NOPQRSTUVWXYZ" |
| 10 | "abcdefghijklm nopqrstuvwxyz" |
| 11 | "Twelve lines fit; the thirteenth is cut by the clip." |
| 12 | "(clipped)" |

**The icon** `S_ICON`: 32 x 16 in `G_BLIT`'s pair format (wb = 4, 128 bytes). `#` = ink (mask 0, image 1), `.` = paper (mask 0,
image 0), space = transparent (mask 1, image 0). Rows 0 and 15 end in one space (column 31).

```
 ##############################
#..............................#
#.############################.#
#.#..........................#.#
#.#....####..........####....#.#
#.#...#....#........#....#...#.#
#.#...#.##.#..####..#.##.#...#.#
#.#...#....#........#....#...#.#
#.#....####..........####....#.#
#.#..........................#.#
#.############################.#
#..............................#
#.......################.......#
#......#..##........##..#......#
#.....#...##........##...#.....#
 ##############################
```

**`D_SCENE`** (no arguments; called before `P_INIT`, so unshielded): in this order
1. `G_HLINE` (0, 10, 512);
2. title i = 0..4: `G_TEXTP` at (16 + 56 i, 1);
3. `G_BLIT` (432, 24, 32, 16, `S_SET`); `G_TEXTP` "Tapes" at (436, 42);
4. window A, then window B.

**`D_MENU_OPEN`** (A = i, 0..4): `P_SHIELD` `T_i`, `XOR` `G_FILL` `T_i`, `P_UNSHIELD`; `P_SHIELD` `M_i`, `G_SAVERECT` `M_i` to `$E800`,
`CLR` `G_FILL` `M_i`, `SET` `G_FRAME` `M_i`, item j at (16 + 56 i, 13 + 10 j), `P_UNSHIELD`; `V_MENU` = i.

**`D_MENU_CLOSE`**: when `V_MENU` = i (not `$FF`): `P_SHIELD` `M_i`, `G_RESTRECT` `$E800`, `P_UNSHIELD`; `P_SHIELD` `T_i`, `XOR`
`G_FILL` `T_i`, `P_UNSHIELD`; `V_MENU` = `$FF`. Otherwise nothing.

**`D_OUTLINE`** (`GA`: x, y, w, h; w >= 1, h >= 3): the XOR outline, each edge under its own shield (so the pointer, which sits
inside the title bar, is not hidden by the far edges):
- top `G_HLINE` (x, y, w), bottom `G_HLINE` (x, y + h - 1, w), left `G_VLINE` (x, y + 1, h - 2), right `G_VLINE`
  (x + w - 1, y + 1, h - 2);
- each one is `P_SHIELD` (its own 1-pixel rectangle), the line in `XOR`, `P_UNSHIELD`.

The four edges are the pixels of `G_FRAME` (x, y, w, h), each once, so a second call restores the screen. `GA` is undefined
afterwards.

All of these may be called directly by a test (12.4's sentinel return `T_RET`, interrupts off). `D_MENU_OPEN` and `D_MENU_CLOSE`
work whether or not `P_INIT` has been called.

### 17.5 The main loop and the input

**State** (all set at boot): position (px, py) = (256, 96); hold = 0; fire before = off; `V_MENU` = `$FF`; `V_DRAG` = 0.

**Iteration** (from `S_LOOP`, right after the `HALT` at `S_WAIT` returns):
1. `V_TICK` += 1.
2. **Input** bits u, d, l, r, f: from the script while it plays, else live (below).
3. **Move:**
   - if any of u, d, l, r: s = min(1 + floor(hold / 6), 6); hold += 1; else hold = 0;
   - px = clamp(px + 2 s (r - l), 0, 511), py = clamp(py + s (d - u), 0, 191) (s = 0 when no direction);
   - if (px, py) changed: `P_MOVE` (px, py).
4. **Fire:**
   - **press** (f on, fire before off): if the hot spot is in a title `T_i` (py <= 9 and 8 + 56 i <= px < 64 + 56 i): `D_MENU_OPEN` i.
     Else if it is in window B's title bar, then A's (B first: B is in front): `V_DRAG` = that window, press point Q = (px, py),
     `D_OUTLINE` (the window's rectangle).
   - **held** (f on, fire before on):
     - with a menu i open: if the hot spot is in a title `T_j`, j != i: `D_MENU_CLOSE`, `D_MENU_OPEN` j;
     - while dragging and the position changed: `D_OUTLINE` at the old offset, then at the new one. The offset is (px - Qx,
       py - Qy) added to the window's x and y.
   - **release** (f off, fire before on): `D_MENU_CLOSE` with a menu open; while dragging, `D_OUTLINE` at the offset where the
     outline is drawn (from the position before this iteration's move, so a move on the release iteration leaves nothing behind)
     and `V_DRAG` = 0.
   - fire before = f.
5. **Script:** when this iteration was the last of a script entry with the checkpoint flag: `CALL S_CHECK` (it increments
   `V_CHECKS`). When it was the script's last iteration: record state = 2.
6. Back to `S_WAIT`.

Nothing in an iteration happens unless the steps above say so (no other drawing).

**Live input:** joystick 1 (AY register 14 read with A8 high, active low, Leap V2 `STICK` / Arcade `RT_STICK`: all four direction
lines active reads as no input, fire included) OR the keys Q (u), A (d), O (l), P (r), Space (f).

**The script** `S_SCRIPT`: entries of 2 bytes, count n (1..255) then bits (bit 0 u, 1 d, 2 l, 3 r, 4 f, bit 7 checkpoint on the
entry's last iteration); n = 0 ends it. Each entry gives its bits to n iterations.

| # | n | Input | Checkpoint | Position after it (17.5 rule) | What it shows |
|---|---|---|---|---|---|
| 1 | 30 | none | 1 | (256, 96) | the scene, the pointer |
| 2 | 30 | u l | | (76, 6) | pointer travel with acceleration |
| 3 | 40 | f | 2 | (76, 6) | "File" open |
| 4 | 18 | r f | | (148, 6) | menu tracking: "Edit" |
| 5 | 10 | f | | (148, 6) | |
| 6 | 18 | r f | | (220, 6) | "View" |
| 7 | 10 | f | | (220, 6) | |
| 8 | 12 | r f | | (256, 6) | "Window" |
| 9 | 20 | f | 3 | (256, 6) | "Window" open over both windows |
| 10 | 20 | none | 4 | (256, 6) | closed: the scene restored |
| 11 | 24 | d | | (256, 66) | to B's title bar |
| 12 | 2 | none | | (256, 66) | |
| 13 | 10 | f | | (256, 66) | drag starts: B's outline |
| 14 | 18 | d l f | | (184, 102) | the outline follows, clipped at the bottom |
| 15 | 20 | f | 5 | (184, 102) | |
| 16 | 20 | none | 6 | (184, 102) | released: outline gone |
| 17 | 60 | d r | | (511, 191) | to the corner (clamped; the pointer cut at both edges) |
| 18 | 20 | none | 7 | (511, 191) | |
| 19 | 24 | u l | | (391, 131) | |
| 20 | 20 | none | 8 | (391, 131) | the script's end |

426 iterations in all. A checkpoint ends a quiet stretch of at least 20 iterations, so the pointer is drawn and nothing is
pending: the display at `S_CHECK` does not depend on how an emulator's frames fell.

### 17.6 Tests (`tests/spike6.mjs`, TSRun headless; S1-S4, `gfx6-cls`, `hello`, `probe23` must still pass)

The model is the gfx6 model (`tests/gfx6-model.mjs`) with the S4 pointer model, plus a model of 17.4-17.5 written from this
section. The icon and `P_ARROW` bytes are read from the image; the icon's bytes are also checked against the art in 17.4.

1. **Build and boot:** the record's marker and state 1.
2. **Checkpoints:** run frames normally (`runFrame`) through the script. After the frame in which `V_CHECKS` becomes k:
   - display RAM = the model (the scene, the menu or outline state, the pointer drawn at the position) for all 98,304 pixels;
   - the rendered frame (`m.pixels`) = the same image;
   - `V_PX`, `V_PY`, `V_MENU`, `V_DRAG` = the model's.
3. **Pointer frames:** in entries 2, 11, 17 and 19 (moving, no fire), from each entry's second iteration on, every rendered frame
   equals the model's screen with the pointer at the position the previous iteration set.
4. **Interrupts:** `V_FRAMES` rises by exactly 1 in every frame run. **Report** the frames in which the main loop did not run (an
   iteration that overran its frame) and where they fell.
5. **RAM:** after boot, poison `$5800-$5FFF`, `$7800-$7FFF`, `$C500-$DFFF` and `$F000-$FAFF`; after the script they are unchanged.
6. **End of script:** state 2 after iteration 426.
7. **Live input** (after the script): joystick right for 10 frames, then each of the keys Q, A, O, P for 10 frames: the positions
   follow 17.5. All four joystick directions at once moves nothing. Then a menu opened and closed with Space over a title, and a
   window outline dragged and released: the display returns to the scene exactly (with the pointer).
8. **Direct calls** (interrupts off, as 12.4), each followed by a model compare: `D_SCENE` on a clear screen; `D_MENU_OPEN` /
   `D_MENU_CLOSE` for each i; `D_OUTLINE` of B at offsets (0, 0) and (-72, 36), twice each (the screen restored).

### 17.7 Reports (TSRun T-states, direct calls; no new bounds)

| Measure | How |
|---|---|
| `D_SCENE` | one call after boot's `G_CLS`-equivalent clear |
| Menu open / close | `D_MENU_OPEN` i and `D_MENU_CLOSE` for i = 0..4; the switch (close + open) |
| Drag step | two `D_OUTLINE` of B (erase at one offset, draw at another) |
| Main-loop frames missed | 17.6 test 4, over the script |
| Boot | frames from reset to the record |
| Code size | the demo's own code (chunk 5) |

### 17.8 Cross-emulator runs (section 8.8; method of `docs/PROBE_DOCK23.md`)

The reference is TSRun: `tools/xemu/spike6-ref.mjs` runs the script and writes, for each checkpoint k, the display RAM
(`$4000-$57FF` + `$6000-$77FF`, 12,288 bytes) and the 512 x 192 bitmap.

| | ZEsarUX 13.0 (`tools/xemu/zesarux-spike6.py`, ZRCP) | Fuse 1.9.1 (`tools/xemu/fuse-spike6.sh`, movie) |
|---|---|---|
| Boots | the record: marker, then state 2 after the script | — |
| Checkpoints | a breakpoint at `S_CHECK`: at each hit, the display RAM equals TSRun's checkpoint k byte for byte, and `V_PX`, `V_PY`, `V_MENU`, `V_DRAG` equal TSRun's | each checkpoint's bitmap appears among the movie's frames, in checkpoint order |
| Interrupts | `V_FRAMES` against the T-states run (within 1); `V_FRAMES - V_TICK` reported | — |
| DOCK unchanged | DOCK chunks 0, 1, 4, 5 equal the DCK after the run | — |

Pass = every row on both emulators. Either emulator's answer to the undocumented `IXh` / `IXl` instructions (13.1) is covered: the
scene, the menus and the outline use `G_FILL`'s 2..8-column bodies.

### 17.9 Closing (S5 deliverables)

- `tests/gfx6-perf.mjs` ends by printing section 7 as a table: every row with its measured figure, its bound and pass / missed /
  reported. The `G_CLS` interrupt-safety row comes from `gfx6-cls` / `gfx6-s4` and is printed as "see test". Bounds are not
  changed; the known misses stay failures.
- "As built" 13.5 for S5, with every figure of 17.7 and 17.8.
- `docs/FEASIBILITY.md`: what the spike's numbers mean for the mode decision (the main model's judgement).
- `README.md` status; `docs/PROVENANCE.md` for anything copied (the joystick read).
