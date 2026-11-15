# G_ICON: the opaque bitmap copy (contract, draft 1, 2026-11-15; owner: "this is exactly what we are looking for")

**What:** `G_ICON` copies a bitmap, opaque, to the display: the pixels inside the clip are **replaced** (ink and paper), none are left alone. It replaces `G_BLIT` for the icons (the shell's four 32 x 16 icons, Paint's ten 16 x 16 tool icons) whose data was 3 x too big because `G_BLIT` wants mask and image byte pairs and a spill pair on every row.
It is also the marquee's engine (`docs/PAINT.md` 22): it draws a lifted selection from cold RAM. DOCK 6 (mapping R), display only; it reads its bitmap from DOCK 6 (icons) or cold RAM (`$7800`), both visible under R.

## 1. The call
`G_ICON`: GA = x, y, w, h (screen pixels; **x a multiple of 8, w a multiple of 8**; h up to 192, w up to 512); GA+8 = a pointer to the bitmap: h rows of w / 8 bytes, bit 7 the leftmost pixel, **1 = ink**, rows packed (no padding). Clipped to GCLIP: a pixel outside the clip is untouched (a partial edge byte keeps the outside pixels). Anything off the screen draws nothing.
GA is kept. Clobbers AF, BC, DE, HL; scratch `$E050-$E057` (G_PATFILL's). `GOP` is ignored.
**Rows:** the row's base is `ROWTAB[y]`; byte column c is at base + (c >> 1), with bit 5 of H set when c is odd (the mode 6 files). A column wholly inside the clip is one store; an edge column is merged with its clip mask (the same masks as `G_PATFILL`).

## 2. The data (`tools/gen-icons.mjs`)
`icons.inc` and `ticons.inc` become **opaque rows**: a 32 x 16 icon is 64 bytes (`ICON_<name>`), a 16 x 16 tool icon 32 bytes (`TICON_<name>`), the same art text files. The old pair format (`G_BLIT`'s set) goes: `G_BLIT` stays in the library (`spike6` and tests use it) but nothing in `desk5` calls it, so it is **left out of `desk5`'s chunk 6** (`G_LIB6` build: `s3bl.asm` is not included; `sc_clip`, which `G_BLIT` used, stays with `G_SCROLLV`).

## 3. Who changes
The shell's `ic_draw` (`KFAR G_BLIT`, copy 0 at x + 16: now `G_ICON` with w = 32, h = 16); Paint's `pn_tdraw` (the icon at x + 8: `G_ICON` w = 16, h = 16). Nothing else. **Every screen is identical** (the pixels are the same art): the existing suites judge it.

## 4. Numbers to measure and bounds
| Measure | Bound |
|---|---|
| Chunk 6 bytes: `G_ICON` added, `G_BLIT` (948) and the icon pairs removed (shell 640 -> 256, tools 960 -> 320) | free >= 1,700 after (**report**; EST about 1,900) |
| `G_ICON`, a 16 x 16 icon / a 32 x 16 icon, unclipped | **report** (EST 1,500 / 2,500 T; `G_BLIT` took about 3,500 / 4,500) |
| `tk-perf`, `shell-perf`, Paint: every screen | identical |
| Every other suite | passes |
| Stack | <= 32 bytes |

## 5. Tests (Sonnet)
`tests/g6-icon.mjs` against a model (`Gfx6Model.icon`): random sizes (w = 8 .. 512 in steps of 8, h = 1 .. 192), random x (multiples of 8, also off screen), random y, random bitmaps in DOCK 6 (a table in the cartridge) and in cold RAM, random clips (empty, 1 pixel, edges inside a byte), the whole screen compared after every call; mapping R, no write to `$C000-$DFFF`, the stack, no DI. Then the whole regression: the screens of the shell and Paint are the proof.

## 6. The tool icons are redrawn (owner, 2026-11-15: "review the icons used in paint, some of them are hard to make out")
**Why they are hard to read:** mode 6's pixels are twice as tall as wide, so a 16 x 16 icon is physically a tall 1 : 2 rectangle, and a 1-pixel vertical stroke is half as heavy as a 1-row horizontal one (the old icons used 1-pixel strokes both ways, so
they look thin, uneven and cramped).
**The new tool icons are 32 x 16 pixels** (the whole cell, physically square) drawn for the pixel shape: horizontal strokes 1 row, vertical strokes 2 columns, diagonals 2 columns wide, round shapes twice as wide as tall, the outer column and row left blank (the cell's frame is drawn over them). The data is 64 bytes an icon
(640 for ten: 320 more than 16-wide icons, 320 less than today's pairs); `G_ICON` is called with w = 32. The source stays `src/apps/ticons.txt` (32 characters a row, 16 rows; `tools/gen-icons.mjs` and `tests/pt-model.mjs` parse it: both follow the width); the mock-up PNG of the new set is `docs/paint/icons-new.png`.

**The redrawn set (2026-11-15):** `docs/paint/icons-new-zoom.png` (the ten icons at 10 x 20 a pixel, in the toolbox layout, 1 : 2 pixels shown as they are) beside `docs/paint/icons-old-zoom.png`; the text is `docs/paint/ticons-new.txt` (32 x 16, ready to become `src/apps/ticons.txt` in the `G_ICON` slice). Changes: every stroke uses a 2-column x 1-row pen (equal weight both ways), the icons use the whole cell, and the weak ones are redrawn:
the pencil (a body with a cone, a band and a lead), the brush (handle, ferrule, bristles), the eraser (a slanted block with a solid rubber), the bucket (handle, rim, paint, a drop), the line (a bold diagonal with end blocks); the marquee, spray, rectangle, rounded rectangle and oval keep their ideas with cleaner strokes. The owner reviews the PNGs before the slice.

**The launcher's icons (owner, 2026-11-15: "review the ones in the launcher also"):** `docs/paint/shell-icons-old-zoom.png` and `docs/paint/shell-icons-new-zoom.png`. **Calculator, Key Caps and Notepad are kept** (bold, clear, already 32 x 16 in the pixel shape); **the Paint icon is redrawn**: a palette (a wide ellipse in the 2 x 1 pen), a thumb hole, five paint dabs and the brush laid across it dipped into a dab. The new art for `icon PAINT` is `docs/paint/shell-icon-paint-new.txt` (it replaces the entry in `src/apps/icons.txt` in the `G_ICON` slice). The shell's icons become 64 bytes each (256 for the four) with `G_ICON`.

## 7. As built (2026-11-15)
**Files:** `src/gfx6/icon.asm` (DOCK 6, after `flood.asm`; `desk5.asm` no longer includes `s3bl.asm`: `G_BLIT` is out of desk5, `G_LIB6` keeps `sc_clip` with `G_SCROLLV`); `tools/gen-icons.mjs` emits opaque rows (`ICON_<name>`, `TICON_<name>`: 32 x 16, 64 bytes each); the new art is in `src/apps/ticons.txt` (ten tool icons, 32 x 16) and `src/apps/icons.txt` (the redrawn PAINT icon). Callers: the shell's `ic_draw` (`G_ICON` at x + 16, 32 x 16) and Paint's `pn_tdraw` (the whole cell, x, y, 32 x 16).
**The routine:** `G_PATFILL`'s clipping (masks, byte columns, `pf_nx`) with a bitmap pointer: a general path (an edge byte merged by `old XOR ((old XOR bitmap) AND mask)`; a whole byte stored) and a **fast path** when both edge masks are `$FF`, no column is cut off the bitmap's rows and the rows are packed (an icon inside the clip: pairs of columns, one file each, stored with no merge). The multiplication for clipped-off rows is skipped when none (`mul16` cost 950 T). Scratch `$E050-$E05C`; stack 6 bytes.
**Measured (TSRun, through `KFAR`, which is about 350 T of each):** 16 x 16 7,150 T; 32 x 16 8,318 T (odd column 8,046); 128 x 16 from cold RAM 15,326 T. The contract's estimates (1,500 / 2,500 T) were wrong: about 420 T a row (the row's address, the first byte, the pair loop, the loop test) and about 1,300 T of set-up (four clip limits). The old `G_BLIT` took about 4,100 T for a 16 x 16.
**DOCK 6:** `G6_END` `$D7FA`: **free 1,542 bytes** (was about 866; the contract's 1,700 was not reached because the tool icons are now 32 wide: 640 bytes, not 320, and `G_ICON` itself is 468 bytes).
**Tests:** `tests/g6-icon.mjs` (13 groups: 1,178 calls against a model, edges, partial bytes, clips, DOCK 6 and cold RAM bitmaps, the 14 real icons against the art text, stack, no DI, memory watch); `pt-model` draws the 32-wide icons at the cell's x. `pt-p1` 49 of 49, `shell-s1` 19 of 19.
**Bound missed (for the owner):** Paint's tool box redraw is slower: 202,482 T (ten 16 x 16 `G_BLIT`s) now **241,306 T**; the **fully exposed canvas** (the window's views all redrawn) **724,945 T now 760,735 T against the bound 725,000: MISSED by 35,735 T** (about 5 %; 10 icons x about 3,900 T more). Options: accept the figure (as with the earlier misses); or speed `G_ICON` up (a 4-column special case and a cheaper set-up might save about 1,500-2,000 T an icon, about half the miss); or draw the tool box's ten icons once into a cached strip.
