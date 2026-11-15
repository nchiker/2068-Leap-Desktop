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
