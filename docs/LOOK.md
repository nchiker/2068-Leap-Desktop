# The look slice: a Mac OS 1.0 style (step 5; contract, owner's choices made 2026-11-13: section 8)

The owner's list (CLAUDE.md, 2026-11-13), and no more than it: a white menu bar (black text, a line under, the selected title
inverted), striped active title bars with the title centred, the close box on the left, a grey (dithered) desktop, 1-pixel drop
shadows on windows and menus, and a Mac-style arrow pointer. Our own bitmaps, not Apple's.

Nothing here is built yet. Section 5 lists the mock-ups; section 6 the choices for the owner.

## 1. What it builds

- The look of `desk5`'s desk, menu bar, menus, windows, close box and pointer, as in section 3.
- Not changed: dialogs (double frame, no shadow), buttons, labels, the toolkit's controls, icons, fonts, the window manager's
  geometry (cell-aligned rectangles, damage, hit testing), the menu layout (WINDOWS 18.2), every program's own rectangles.
- **Scope (recommended, 6.4):** `desk5` only, by an assembly switch `LOOK_MAC` that `desk5.asm` sets. `kern3`, `kern4` and
  `bank5` assemble the same kernel files and keep today's look, so their tests stay as they are (CLAUDE.md: they keep their
  layouts).

## 2. Mode 6's pixels

Mode 6 has 512 x 192 pixels on a 4:3 screen: a pixel is **twice as tall as it is wide**. One Mac pixel is therefore 2 columns
by 1 row here. This sets the sizes below: the shadow is 2 columns and 1 row, the close box 11 x 5 (square on the screen), and
the arrow is widened 1.5 times. The mock-ups are drawn at 2 x 4 PNG pixels a screen pixel, so they show the real proportions.

## 3. The look (exact pixels; the order of drawing is free; `tests/look-model.mjs` is the draft model)

### 3.1 The menu bar and the menus

- **`mbar_draw`:** `CLR` fill (0, 0, 512, 7); `SET` `G_HLINE` (0, 7, 512); each title `SET` (today `XOR`) by `G_TEXTP` at
  (box x + 8, 0). The glyphs' rows 1-6 hold the letters; a descender (row 7, as in "Leap"'s p) rests on the line.
- **The open title:** `XOR` fill (box x, 0, box width, **7**): rows 0-6, the line stays.
- **The drop-down:** as WINDOWS 18.3, except that it has **no top line**: the bar's line is its top edge. Its sides start at
  row 8; its shadow (2 columns right from row 10, 1 row under) is today's and is already "1 Mac pixel". Save-under, items,
  highlight, dimmed items and layout are unchanged.

### 3.2 Windows (`window_draw`), active and inactive

The window keeps its cell-aligned rectangle (x, y, w, h). Inside it:

1. **Frame:** `SET` frame (x, y, w - 2, h - 1).
2. **Shadow:** `SET` fill (x + w - 2, y + 1, 2, h - 1) and `SET` fill (x + 2, y + h - 1, w - 2, 1).
3. **The two corners the shadow leaves,** (x + w - 2, y, 2, 1) and (x, y + h - 1, 2, 1): the desk pattern (3.4). Over another
   window these 4 pixels show the pattern, not that window: accepted, since the window manager has no "what is under" (each
   cell has one owner) and drawing nothing outside the rectangle keeps damage and repaint exactly as they are.
4. **Title bar:** `CLR` fill (x + 1, y + 1, w - 4, 7); separator `SET` `G_HLINE` (x + 1, y + 8, w - 4).
5. **Active only, the stripes:** `SET` `G_HLINE` (x + 2, y + r, w - 6) for r = 2, 4, 6.
6. **Title,** when `Window_title` != 0: n' = the largest count of codes whose `PROP6_W` sum is <= w - 66 (room for the close
   box and its mirror); tw = their width; tx = x + floor((w - 2 - tw) / 2).
   - active: `CLR` fill (tx - 6, y + 1, tw + 12, 7), the gap in the stripes;
   - both: `SET` `G_TEXTP` (tx, y) (today the active title is paper on ink).
7. **Content:** `CLR` fill (x + 1, y + 9, w - 4, h - 11) (today (x + 1, y + 9, w - 2, h - 10)), then `group_draw`.

**Binding on programs:** every child view lies inside (x + 1, y + 9, w - 4, h - 11). The slice checks every window of `desk5`
(the shell, Calculator, Controls, Notepad); Notepad's text view and bar fit (its bar ends at column 489, the content at 491).

### 3.3 The close box (`CWindow`, active only)

- `CLR` fill (x + 8, y + 1, 15, 7); `SET` frame (x + 10, y + 2, 11, 5). Pressed: `XOR` fill (x + 11, y + 3, 9, 3).
- Its hit rectangle (SHELL 10.1) moves with it: (x + 8, y + 1, 15, 7).

### 3.4 The desk (`desk_draw`) and the drag outline

- The desk is a **pattern fill** of (0, 8, 512, 184): row y takes byte `PAT[y & 1]` (bit 7 the leftmost pixel). The desk is
  drawn cell by cell under the clip, and cells are 2 bytes wide, so the fill is byte-aligned. gfx6 has no pattern fill today:
  a byte-aligned band fill beside `w_bandfill` is enough for the desk; the corners of 3.2 step 3 need 2 pixels of one byte.
- **The pattern is the owner's choice (6.2):**
  - **50% grey,** `$AA, $55` (Mac OS 1.0's desktop). Today's drag outline (`XOR` of a 1-pixel frame, WINDOWS 17.4) all but
    disappears on it: an `XOR`ed row of a checkerboard is the next row's pattern, so the horizontal edges vanish and the
    vertical ones are a faint seam (mock-up 7, left). With 50% the outline must change: **`XOR` with the pattern** instead of
    ink (Mac's own way): solid paper over the desk, dotted over a window (mock-up 7, middle). W_DRAG's four `XOR` fills become
    pattern-`XOR` fills: a second new gfx6 op.
  - **25% grey,** `$88, $22`. Today's outline stays visible (dotted over the desk, solid over a window; mock-up 7, right). No
    change to `W_DRAG`.

### 3.5 Menus' and windows' shadows

Both are 2 columns right and 1 row down (one Mac pixel, section 2). Windows: inside their rectangle (3.2). Menus: today's.

### 3.6 The arrow (`P_ARROW`)

QuickDraw's arrow shape (8 rows widening, a notch, a two-pixel tail going down and right), widened 1.5 times for mode 6, black
with a paper outline right and below. The hot spot is pixel (0, 0), ink, as OBJECTS_EVENTS 14.6 requires (the Mac's own hot
spot is inside a white outline; ours has no outline on the left, so the tip stays where the click is). 64 bytes, the same
format: data only, `P_ISR` unchanged.

```
##o.............    #######o........    ########ooooo...    ......o###o.....
###o............    #########o......    ###oo###o.......    ......o###o.....
####o...........    ##########o.....    ##oo.o###o......    .......ooo......
######o.........    ############o...    oo...o###o......    ................
```

(rows 0-3 in the first column, 4-7 in the second, and so on; `#` ink, `o` paper, `.` transparent.)

## 4. Code, bytes, speed (**EST** until built)

| Part | Where | **EST** bytes |
|---|---|---|
| Pattern band fill for the desk; the 2-pixel corners | `wm.asm` beside `w_bandfill` | 40-70 |
| `mbar_draw` paper + line + `SET` titles; the open title's 7 rows; no top line on the drop-down | `menu.asm` | 10-25 |
| `window_draw`: frame and content sizes, shadow, stripes, centred title with its gap | `wm.asm` | 70-120 |
| Close box on the left (constants, hit rectangle) | `tk.asm` | 0-5 |
| The arrow | `pointer.asm` | 0 (data replaced) |
| Option 50%: pattern-`XOR` in `G_FILL` for the drag outline | `gfx6.asm`, `wm2.asm` | 40-80 |

- **Bound:** step 5's pool growth stays <= 3,400 (371 left): **<= 250 bytes with 25%, <= 320 with 50%**. The code goes in
  `IF LOOK_MAC` blocks; `kern4`'s bytes and pixels are unchanged (checked: its DCK byte for byte, 6.4).
- **Speed** (TSRun, `tests/wm-perf.mjs` and `tests/shell-perf.mjs` rows re-measured on `desk5`): every existing bound holds,
  except that window draw, open, raise and `W_UPDATE` of a whole-screen desk may grow by at most 10% each (**report** each:
  the stripes, the title width and the pattern cost time). `G_FILL`'s `SET` / `CLR` / `XOR` paths gain at most 0 T (a new op
  must not slow the old ones). The pointer bounds (GRAPHICS_SPIKE 16.7) are unchanged: same format, same sizes.
- `DI` never held across a frame; 0 interrupts lost (as every slice).

## 5. Mock-ups (`docs/look/`, made by `node tools/look-mock.mjs`)

Each is drawn by the JS models: today's look by the models the tests use (the generator checks its "today" screens pixel for
pixel against `renderShell` and `renderScreen` before it writes), the proposal by `tests/look-model.mjs`. 2 x 4 PNG pixels a
screen pixel.

| File | Shows |
|---|---|
| `1-shell.png` | The shell, today beside proposed (50%) |
| `2-shell-menu.png` | The Leap menu open, "Calculator" highlighted |
| `3-notepad.png` | Notepad with text, active (close box, stripes, shadow) |
| `4-notepad-menu.png` | Notepad, the File menu open |
| `5-notepad-save.png` | Notepad inactive behind the Save dialog (no stripes, no close box; the dialog unchanged) |
| `6-drag.png` | Dragging the shell window: today's outline |
| `7-grey.png` | The desk choice: 50% with today's outline, 50% with the patterned outline, 25% with today's outline |
| `8-detail-title.png` | x 3: the menu bar, the title bar, the close box |
| `9-detail-menu.png` | x 4: an open menu under the bar's line |
| `10-detail-shadow.png` | x 4: a window's shadow and its corner |
| `11-detail-arrow.png` | x 12: today's arrow and the Mac arrow, on paper and on each grey |

## 6. For the owner to choose

1. **The look as a whole** (3.1-3.3, 3.5): proposed, or keep today's, or per element.
2. **The desk:** (a) 25% grey, today's drag outline (**recommended:** cheaper, nothing else changes); (b) 50% grey with the
   patterned outline (truer to Mac OS 1.0, about 40-80 bytes more, a new gfx6 op); (c) white, as today.
3. **The arrow:** the Mac arrow (3.6), or today's (OBJECTS_EVENTS 14.6, already black with a paper outline; narrower).
4. **Scope:** `desk5` only through `LOOK_MAC` (**recommended**), or every cartridge (then `kern3` / `kern4` / `bank5` and their
   tests change too).

## 7. Slices and tests (after the choice)

- **L1 (main model):** the code of section 3 as chosen, in `IF LOOK_MAC` blocks; the arrow's data.
- **Tests (Sonnet, from this contract):** `tests/look-model.mjs` becomes the reference; the models that draw chrome for
  `desk5` (`wm-model2` `windowLook`, `wm-model3` `drawBar` / `drawOpen`, `shell-model` and `wr-model` close boxes and desks)
  take the look from it when the cartridge is `desk5`; `shell-s1`, `tk-t1`-`t3`, `tk-demo`, `wr-w1`-`w3`, `wr-demo`, `fs-f1`,
  `web-smoke` re-run against it; new rows: each element of section 3 against the model, the close box's new hit rectangle, the
  drag outline over the desk and over a window, the corners, a title cut by a narrow window. `kern4`'s DCK unchanged byte for
  byte.
- **Cross-emulator:** the `desk5` ZEsarUX and Fuse runners re-run (their references are TSRun's, so they need no change).
- **The owner** tries it in the browser.

## 8. Owner's choices (2026-11-13)

"I like the new look - 25% grey ... I like the Mac Arrow - Desk5 only is fine."

1. **The look as proposed** (3.1-3.3, 3.5).
2. **The desk: 25% grey** (`$88, $22`), today's drag outline (6.2 (a)). The pattern-`XOR` outline and its gfx6 op are not built.
3. **The Mac arrow** (3.6).
4. **`desk5` only,** through `LOOK_MAC`; `kern3`, `kern4` and `bank5` keep today's look.

The byte bound is therefore section 4's **<= 250**. Section 3.4's 50% option and its rows in sections 4 and 5 stay as the record
of the choice.

## 9. How the desk is drawn, and the corners (owner, 2026-11-13: "put option 1 and the corner finding into the docs")

**The desk is drawn as text** (amends 3.4's "pattern fill" for the build; the pixels are the same).
- Code 127 of the 8x8 font (`src/font.inc`) is blank and nothing in Leap draws it. Under `LOOK_MAC` its glyph becomes the
  25% tile: rows `$88, $22, $88, $22, $88, $22, $88, $22`. That data takes the place of the blank glyph, so it costs 0 bytes.
- `desk_draw` draws character rows 1-23, each one `G_TEXT8` (column 0, row r) of 64 codes 127, opaque. `G_TEXT8` draws only
  the cells wholly inside the clip, and the desk is always drawn under a clip of whole cells (16 x 8). The glyph's row parity
  is the screen row's (cells start on rows that are multiples of 8), so the pattern is 3.4's exactly.
- The 64 codes are a string in RAM, `DESK_STR` (64 bytes), filled with 127 at boot.
- **EST** about 35 bytes (the loop about 25, the boot fill about 11).
- **Speed:** a whole-desk repaint (1,472 cells) is **EST** about 0.3 M T, against perhaps 0.1 M T for today's paper fill.
  It is **reported**, with the `W_UPDATE` rows of 4. A repaint of the whole desk happens at boot and when a large window
  closes; smaller repaints scale with the cells damaged.

**The corners of 3.2 step 3 cost nothing.**
- With the 25% pattern they are always paper. Windows have x and w multiples of 16 and y and h multiples of 8.
  - The top-right corner is columns 6-7 of a byte on an even row (`$88`: bits 1-0 clear).
  - The bottom-left corner is columns 0-1 on an odd row (`$22`: bits 7-6 clear).
- Checked over every legal window rectangle: 0 ink pixels.
- `window_draw` already clears the band and the content across the whole width, and the frame and the shadow do not cover
  the corners. So the corners need no code: step 3 is met by the paper already there.

**Revised estimates (replace section 4's table rows):** desk 30-40; menu bar 10-25; `window_draw` 50-90 (no corner code);
close box 0-5; arrow 0. **Total EST 100-170**, bound <= 250 (section 8).

## 10. As built (slice L1, 2026-11-14)

**Done on TSRun.** Code in `IF LOOK_MAC` blocks, set by `desk5.asm` only: `wm.asm` (`desk_draw`, `window_draw` and its
table `W_LINES`), `menu.asm` (`mbar_draw`, the drop-down's top line, `mb_titlex`), `tk.asm` (the close box), `pointer.asm` (the
arrow). `desk5.asm` defines `DESK_STR` and patches the tile.

**How it differs from sections 3 and 9:**
- **The tile is code 0's glyph,** not 127's. `DESK_STR` (`$E090`, 64 bytes) is RAM that boot clears and nothing writes, so
  it needs no fill code. Code 0's 8x8 glyph was blank and is never drawn.
- **`window_draw`** clears the whole rectangle, then draws its lines from a table of (dx, dy, dw, dh): 6 lines, 9 when active.
  A negative entry counts from the right or the bottom. Then it draws the title.
- **The arrow's tip is 2 columns wide** (`##o` in row 0). OBJECTS_EVENTS 14.6 asks for ink at columns 0-1 of row 0. The
  section 3.6 block and `tests/look-model.mjs` show it; mock-ups 1-11 were redrawn.
- **The close box** amends SHELL 10.1 on `desk5`. Its hit rectangle is (x + 8, y + 1, 15, 7).

**Bytes:** pool +157 (chunk 5 +119, chunk 1 +38): the kernel +142, the menus +38, the close box -23. That is within the 250 of
section 8. Step 5's pool growth stands at about 3,186 of 3,400 (214 left).

- `kern3`, `kern4`, `bank5`, `gfx6t` and `hello` are unchanged byte for byte. Each was built with and without the change and
  compared.

**Speed** (TSRun T-states, `tests/shell-perf.mjs`; before = commit 800e9dc):

| Measure | Before | After | Bound |
|---|---|---|---|
| Window draw (`W_DRAWVIEW`, empty 256 x 96, active) | 82,397 | 107,174 | <= 108,000 |
| Window open (`W_OPEN` + `W_UPDATE`) | 90,389 | 115,166 | <= 116,000 |
| Window raise (`W_RAISE` + `W_UPDATE`) | 91,944 | 116,721 | <= 117,000 |
| Whole-desk repaint (every cell dirty, no window) | 184,963 | 389,420 | report |
| Whole screen with a window (every cell dirty) | 249,839 | 440,519 | report |
| Window close | 99,791 | 124,568 | report |
| `K_LAUNCH` to Calculator's start | 264,044 | 313,621 | report |
| Launch / quit, frames | 14-15 / 10-11 | 15-16 / 11-15 | <= 30 |

- The window rows cost about 25,000 T more: about 7 ms, a third of a frame.
  - The new calls are nine line fills, the title's width, and the gap in the stripes.
  - Each 1-row `G_FILL` costs about 2,000-3,000 T, nearly all of it per-call setup.
  - The old draw made 5 fills.
- **Owner (2026-11-14):** the window rows' bounds are the measured figures, rounded up. Section 4's +10% would have needed a
  dedicated line routine of 70-90 bytes, and even that would only just have made it. The whole-screen `W_UPDATE` is reported,
  as section 9 already has it for the whole-desk repaint.
- **`calc-perf`'s row** (desk5's pool bytes beyond kern4) moves from <= 100 to <= 190 (owner); it measures 189.

**Tests** (Sonnet from this contract; re-run by the main model on the final build):
- `calc-c1` 5/5, `shell-s1` 18/18, `tk-t1` 8/8, `tk-t2` 10/10, `tk-t3` 9/9, `tk-demo` 7/7, `wr-w1` 12/12, `wr-w2` 14/14,
  `wr-w3` 7/7, `wr-demo` 7/7, `fs-f1` 8/8, `web-smoke` pass.
- `calc-perf` 9 pass, `shell-perf` 27 pass, `tk-perf` 54 pass, `wr-perf` 33 pass.
- The new rows are in `shell-s1`:
  - the desk against its bytes;
  - 60 windows from 48 to 320 wide, including cut titles and titles cut to nothing;
  - the close box's hit rectangle, inside and just outside;
  - 40 drags of the XOR outline over the desk and over windows;
  - the open menu;
  - the arrow at 4 places.
- No `desk5` program has a window narrow enough to cut its title, so cut titles are tested on kernel windows opened on `desk5`.

**The test page** (owner, 2026-11-14) scales the screen to a whole multiple of 640 x 480 (`web/main.js` `fitScreen`). At a
fractional size the 25% grey showed moire stripes; the owner saw this in the browser.

**Still to do:** the cross-emulator runs (ZEsarUX and Fuse, `desk5`) on the new look, and the owner's try.

