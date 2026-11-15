# Paint (contract, 2026-11-14; **approved by the owner 2026-11-14: "accept the recommendations, start P0"**, every recommendation in section 13 taken)

Program 4 of `desk5` (after the shell, Calculator, Key Caps and Notepad): **a MacPaint-style bitmap editor in mode 6, black ink on
white paper, driven by the Kempston mouse.** Style as `docs/KEYCAPS.md` and `docs/FILES.md`: numbers are bounds or **report**
(measured and written down). **A missed bound is reported with its numbers before anything is changed; a bound is never weakened by
the engineer** (the owner resets them to the measured figures, as in WRITE 14.11). Marks: **EMU** measured, **EST** estimated.

**Decided already (CLAUDE.md, the playbook; not asked again):** mode 6 mono; colour waits for the mode 2 graphics; the Mac OS 1.0
look with our own bitmaps; files through the desktop file interface (`FS_`); the DOCK 6 graphics library comes first (`SIZE.md` 4);
the Puzzle follows Paint. Everything else is in section 13 as a question with a recommendation.

## 0. What the survey found that changes the playbook's proposal (2026-11-14, read from `s3.asm` and `BANKING.md`)

1. **`G_RESTRECT` ignores the clip.** It cannot redraw the canvas when another window covers part of it: it would paint over that window.
   The playbook's "a redraw is `G_RESTRECT` of the visible rectangle" does not work as written. Section 4 uses **banded restores**:
   the program packs one 8-row band at a time into a small buffer in the layout `G_RESTRECT` wants, restores it, and repeats. Cost: no pool
   bytes, about 60 bytes of Paint's own code; the time is bounded in section 12.
2. **`G_SAVERECT` is the one way to read the display from a program.** Its buffer is not screen-row order: a header (c0, nc, y0, nr), then
   the rows of one display file (`nc >> 1` bytes a row), then the rows of the other (`nc - (nc >> 1)`). Section 3 makes the canvas copy
   *exactly* that layout (the "planar" layout), so saving the whole canvas is one call and needs no conversion.
3. **No program-level call reads or writes single pixels,** and **no routine fills with a pattern** (`G_FILL` is solid). Pattern fill is new
   (section 7, DOCK 6).
4. **No pointer-shape call exists** (`P_ARROW` is preshifted once at start). Paint keeps the arrow in P1-P3; tool cursors are an option
   (section 13, question 7).
5. **The shell's window is too narrow for a fourth icon** (icons at x = 48 + 64 (p - 1): icon 4 spans 240-304, the window ends at 288).
   Registering Paint widens the shell window from 256 to 320 pixels (section 10). The shell tests that read its rectangle change.
6. **Program-image room is about 960 bytes** (`PROG_IMG` $C000 to `AL_RAM` $C3C0), not 1 KB.

## 1. What it builds

- **The program** `src/apps/paint.asm` (symbols `PN_` and `pn_`: `PT_` is the pointer's), in DOCK 2-3 (mapping A), one at a time like every program: the RAM image at
  `PROG_IMG`, the arena `$C400-$DFFF`.
- **Three view classes in its image** (each a `View` subclass with banked methods through `KTHUNK`s, as `KeyCaps`):
  `Canvas` (the picture and every tool), `Palette` (tools, patterns and brushes, **one class, three instances**: a descriptor says how many
  columns and rows, the cell size, what a cell draws, and which variable the choice goes to), and the status `Label` (the toolkit's own).
- **Drawing code in DOCK 6** (mapping R, display only, arguments through hot RAM): pattern fill, shapes, flood fill (section 7), after the
  graphics library moves there (SIZE 4, section 11).
- **Pool:** two bytes (`K_PROGS`) and **`K_BOX`** (about 60 bytes, `desk5` only: `K_BOXES`): a box of rows between the app arena and cold RAM in one crossing (`KFAR K_BOX`),
  because the undo area is in cold RAM, which a program cannot see, and the copy's rows are 20 bytes apart; row by row through `K_LDIR` would be 4 crossings a row.

## 2. The window (pixels, mode 6)

Window `CWindow` (48, 16, 416, 176), title "Paint: name" (`AL_TITLE`, prefix "Paint: "). Its content area is (49, 25, 412, 165)
(LOOK 3.2: x + 1, y + 9, w - 4, h - 11). Every rectangle below is screen-absolute and inside it.

| View | Class | Rect (x, y, w, h) | Id | Notes |
|---|---|---|---|---|
| Tool box | `Palette` | **(55, 28, 66, 82)** | 1 | 2 columns x 5 rows of cells 32 x 16 at (56 + 32 c, 29 + 16 r), a frame 1 pixel outside each (shared); the icon is 16 x 16 at the cell's x + 8 (**byte-aligned**, so `G_BLIT` copy 0 draws it) |
| Patterns (P2) | `Palette` | (55, 112, 66, 50) | 2 | 4 x 4 swatches of 16 x 12: the 8 x 8 pattern tiled |
| Brushes (P2) | `Palette` | (55, 164, 66, 18) | 3 | 4 cells of 16 x 16 |
| Canvas | `Canvas` | (126, 30, 324, 148) | 4 | border 2 px; the picture 320 x 144 at **(128, 32)** (x a multiple of 16) |
| Status | `Label` | (127, 180, 324, 9) | 5 | the tool's name, or a message |

Window id 255 (`PT_WINID`): the close box and SS+Q post `E_CMD` 255; the program then asks to discard if the picture changed
(section 9), then `K_QUIT`. The mock-ups are `docs/paint/pt1-*.png` (`node tools/paint-mock.mjs`, section 14).

## 3. The picture and its copy

- **The picture is 320 x 144 pixels** (question 1): 40 byte columns, 144 rows, 5,760 bytes. A mode 6 screen is 12,288 bytes and the arena
  7,168, so the canvas is a part of the screen, and there is no full-screen undo (FEASIBILITY 3).
- **The copy** `PN_PIC` is held in the arena in `G_SAVERECT`'s layout for the picture's rectangle (OX, OY, 320, 144), where (OX, OY) is the canvas view's (x + 2, y + 2) (128, 32 in the window's
  first position; the window can be dragged by whole cells, so OX stays a multiple of 16): the header `(OX >> 3, 40, OY, 144)` (what `G_SAVERECT` wrote last), then the **part 1** (20 bytes a row,
  144 rows, at +4) holding the **odd** byte columns of the picture and the **part 2** (at +4 + 2,880) holding the **even** ones (`G_SAVERECT`'s order for an even first column: the odd
  columns, which live in the second display file, come first). Byte column k (0-39) of the picture's row r is at `PN_PIC + 4 + (k AND 1 ? 0 : 2,880) + 20 r + (k >> 1)`. Bit 1 is ink.
  The header is not used by Paint; only the two parts are.
- **The display is the working surface.** A tool draws on the display with gfx6 (shielded, clipped to the picture rectangle); the copy is
  brought up to date when the stroke or shape ends (section 5). While a stroke is in progress the copy is the picture's state before it.
- **The copy is needed only for three things:** redrawing an exposed canvas, Undo, and the file.

## 4. Redrawing the canvas (the `Canvas` view's `M_DRAW`)

`M_DRAW` runs under A with the clip set to the repaint rectangle (cells of 16 x 8 pixels, intersected with the view). It must not change
the clip, the shield or the window map, and it must be opaque (BANKING; keycaps' notes).

1. Draw the 2-pixel border (`G_FRAME` and a one-pixel inner frame; clipped by the kernel's clip as every `G_*` draw is).
2. For each **8-row band** of the picture that meets the clip (18 bands): pack the band into `PT_BAND` (a buffer in the arena, header + up
   to 40 x 8 bytes = 324 bytes) **for the columns of the clip only**, then `KFAR G_RESTRECT`. Packing a band of nc columns (nc even, first
   column even: true when the clip is cell-aligned, which the repaint rectangles are) copies `nc / 2` bytes a row from each part of the copy
   to the same row of the buffer's two parts: 16 `LDIR`s of `nc / 2` bytes. The rows of a band are the clip's rows; a partial band packs
   fewer rows.
3. **Assumption to verify in P1:** the repaint clip is cell-aligned. `G_RESTRECT` widens to whole byte columns anyway, so a clip edge that is
   not on a byte pair would be restored too wide: P1's test drags a window over the canvas at every offset of 1 pixel and compares.

**Cost (EST):** packing 5,760 bytes about 21 T a byte (`LDIR`) = 121 k T; restoring 24 T a byte = 138 k T; 18 crossings 6 k T: **EST 265,000 T,
4.5 frames** for a fully exposed canvas, which is the rare case (a window closing over it). A partial exposure costs in proportion.
**If the measure fails its bound** (section 12) the option is `G_PUTRECT` (a pool routine that restores a sub-rectangle with a row stride,
EST +150 pool bytes), proposed to the owner with the numbers before anything is built.

## 5. Drawing and the commit protocol

- **Every tool's drawing runs in the `Canvas` view's `M_EVENT`** (under A, from `TK_DISPATCH`), not in `M_DRAW`. The view takes the capture on
  `E_DOWN` (the toolkit does it when `M_EVENT` returns carry), then gets `E_MOVE` (at most one a frame, coalesced) and `E_UP`.
- **Each drawing step** is: `KFAR P_SHIELD` (GA = the step's rectangle), `G_SETCLIP` to the picture, the gfx6 calls, `KFAR P_UNSHIELD`. The
  shield stops the pointer's image being drawn into the picture or saved into the copy.
- **Freehand (pencil, brush, eraser, spray):** a step per `E_MOVE`: `G_LINE` from the last point to this one (pencil), or a **stamp** at each
  point a Bresenham walk produces between them (brush, eraser), or random stamps (spray). The stroke's bounding box grows with each step.
- **Shapes (line, rectangle, rounded rectangle, oval):** the rubber band is XOR (`G_SETOP` 2): erase the old outline, draw the new one,
  each `E_MOVE`; at `E_UP` erase the band and draw the shape for real (SET, or the pattern for filled shapes). XOR drawing is symmetric
  (`G_LINE` is XOR-twice-safe, GRAPHICS_SPIKE 15.2; `G_FRAME` draws each pixel once).
- **The commit,** at `E_UP`, in this order:
  1. **Undo save** (section 6): the stroke's bounding box, widened to whole byte columns, from the copy to the undo area.
  2. **`KFAR G_SAVERECT`** of the whole picture (128, 32, 320, 144) into `PT_PIC` (the pointer shielded for the call). **EST 138,000 T
     (2.4 frames), once per stroke.**
  3. Mark the picture changed (`PT_DIRTY`), enable Undo (`MB_ENABLE`).
- A drag that leaves the picture keeps drawing along the clip; the capture continues until `E_UP` (the pointer position is clamped by the clip,
  not by the program).

## 6. Undo (question 5)

- **One level.** `Undo` swaps: it restores the picture to the state before the last stroke, shape, fill, clear or paste, and enables itself
  again so a second `Undo` redoes it (MacPaint's behaviour).
- **The undo area is 2,048 bytes of cold RAM at `$5800`** (visible under K and R, not A; free once Notepad is not running). It holds one
  `G_SAVERECT`-format buffer of the stroke's bounding box (header 4 + nc x nr <= 2,044: for example 40 columns x 51 rows, or 20 x 102).
  A is blind there, so the program reaches it with `KFAR K_LDIR` (HL to DE, BC bytes; the Notepad clipboard does).
- **What Undo cannot do:** a change whose bounding box is over 2,044 bytes (a large flood fill, a Clear, a big shape) is not undoable. The
  program says so in the status line ("Too big to undo") and disables Undo. **Clear and New ask first** (`AL_ASK`, "Discard the document?")
  when the picture has changed, so no data is lost by an unrecoverable Clear.
- **How a stroke saves:** the bounding box is known only when the stroke ends, but the copy still holds the state before it (section 5),
  so the undo save is a row copy from the copy to `$5800` (two `K_LDIR`s a row in the worst case; **EST 95,000 T at 144 rows, report**).
  Undo itself = swap the area with the same rectangle of the copy, then redraw those rows from the copy by banded restore (section 4).
- **Larger undo (not built):** both cold areas (`$5800` and `$7800`) would give 4,088 bytes in two buffers. Left as a later option.

## 7. The tools (a table; each can be built out)

The tool box has ten cells, each a row in `PT_TOOLS` (name, icon, handler, build flag), so a tool can be left out of a cartridge (the builder
idea): the table is in Paint's own code, the handlers are labels.

| # | Tool | Slice | Behaviour |
|---|---|---|---|
| 0 | Marquee (select) | P3 | Drag a rectangle (XOR band); a drag inside a selection moves a copy; click outside to drop. Cut, Copy, Paste are not planned (WRITE: no shortcuts) |
| 1 | Pencil | **P1** | 1-pixel freehand with `G_LINE`, always ink (SET); the eraser clears |
| 2 | Brush | P2 | Stamps of the chosen brush shape along the stroke, drawn with the chosen pattern |
| 3 | Eraser | **P1** | A **16 x 8** paper (CLR) stamp (a square on mode 6's 1 : 2 pixels) along the stroke, one stamp every 4th step of a Bresenham walk |
| 4 | Spray | P2 | Random pixels inside a 16 x 16 disc around the pointer, a burst a frame, in the chosen pattern's ink |
| 5 | Bucket | P3 | Flood fill from the clicked pixel with the chosen pattern, bounded by ink (4-connected) |
| 6 | Line | P2 | XOR rubber band, then a line of the chosen brush width (1, 2, 4, 6) |
| 7 | Rectangle | P2 | Outline (hollow) or filled with the pattern: the Options menu's "Filled" toggle (section 8) |
| 8 | Rounded rectangle | P2 | As the rectangle, corner radius 8 |
| 9 | Oval | P2 | As the rectangle, inscribed in the dragged rectangle (midpoint ellipse, integer) |

- **Patterns:** 16 entries of 8 x 8 bits in DOCK 6 (128 bytes): solid ink, 75%, 50% checker, 25%, 12%, horizontal and vertical lines, diagonals,
  dots, bricks, white (paper). The current pattern is variable `PT_PAT`; the DOCK 6 fill reads its 8 bytes from hot RAM (`PT_PATBUF`), so
  a pattern is copied there by the program when chosen. Pencil, line and shape outlines use solid ink; brush, spray, fills and filled shapes use the pattern.
- **Brushes:** 4 entries, each a list of 1-3 rectangles (a round 3, a round 6, a square 4, a diagonal 6), in DOCK 6: a stamp is a few `G_FILL`s
  (or one pattern fill) at the pointer, so a brush needs no per-pixel code.
- **New DOCK 6 routines** (display only; mapping R; arguments in hot RAM; each is a `KFAR` target):

| Routine | Does | EST bytes |
|---|---|---|
| `G_PATFILL` | fill a rectangle (GA) with the 8 x 8 pattern in `PT_PATBUF`, the pattern anchored to the picture (x AND 7, y AND 7), by `GOP` | 300 |
| `G_OVAL`, `G_RRECT` | outline of an ellipse / rounded rectangle in the rect (GA) with the op; the filled forms through `G_PATFILL` spans | 700 |
| `G_FLOOD` | scanline flood fill reading the display; the span stack in cold RAM `$7800` (2 KB); a full stack ends the fill with the status "Fill too complex" | 500 |

- **Icons:** the ten tool icons (32 x 16, 64 bytes each in mask-less form, 640) in DOCK 6.

## 8. Menus

Built with `MB_SET`, as Notepad's: the table is in Paint's image.

| Menu | Items |
|---|---|
| File (id 1) | New, Open..., Save..., (separator), Quit |
| Edit (id 2) | Undo (disabled until there is something to undo), Clear |
| Options (id 3), from P2 | Filled shapes (a check); Invert (P3, XOR the selection or the picture) |

There is no "Leap" menu in a program (Notepad has none): the shell's own "Leap" menu gains "Paint" (section 10). A program ends with File > Quit, the close box or SS+Q.

`New`, `Open`, `Clear` and `Quit` ask "Discard the document?" first when the picture has changed. `Open` is `FS_PICK`; `Save` and the name dialog are
the app library's (`AL_NAMEDLG`, default extension ".pbm"). `Clear` fills the picture with paper (one `G_FILL` of the picture rectangle, then the whole-picture save) and is not undoable.

## 9. Files (question 4)

- **Format: PBM, type P4** (portable bitmap, binary): the text header `P4`, a newline, `320 144`, a newline (11 bytes), then 144 rows of 40
  bytes, 1 = ink (black) = the screen's bit. Any viewer or editor opens it, no converter in the page, and **it is the first Z80 use of the
  desk's binary file mode** (`FS_OPEN` mode 3 to write, 2 to read; FILES 2). Extension ".pbm".
- **Save:** open (binary, write), write the header, then per row: build the 40 bytes from the two parts of the copy into a row buffer (arena,
  40 bytes), `FS_WRITE` them; close. **EST** 5,760 bytes at 50 T a byte plus the row work (about 20 T a byte) = 400 k T, report.
- **Open:** `FS_PICK`, `FS_OPEN` (binary, read), the file's length must be 5,771 and its first 11 bytes exactly `P4`, a newline, `320 144`, a newline (anything else, a comment or other white space included:
  the alert "Not a 320 x 144 PBM picture."); read the rows into the copy (the inverse of Save: 40 bytes a row split into the two parts); then restore
  the whole picture to the screen by banded restore. A PBM with comments (`#` lines) is refused in P1 (the alert).
- **The title and the name** follow Notepad (`AL_TITLE`, `AL_EXTNAME`). A picture never saved is named "Untitled", which the Save dialog's Field shows as Notepad's does (type over it).

## 10. The shell and the cartridge (the edits that register Paint)

- `K_PROGS`: the fifth entry (program 4; the shell is program 0) `PT_START` (+2 pool bytes). `src/desk5.asm`: assemble `paint.asm` after Key Caps and chunk 6 (section 11).
- The shell: `S_NICONS` 3 to 4 (icon 4 = program 4); a name string, an `S_NAMES` entry, an `ICON_PAINT` in `src/apps/icons.txt` (32 x 16, a
  paintbrush) and `S_SETS`; the "Leap" menu gets "Paint" (item id 6, the item count 5 to 6). **The shell window widens from 256 to 320 pixels**
  (`S_TWIN`), so that four icons at x = 48 + 64 (p - 1) fit; `shell-s1` and `al-a1` rows that read its rectangle are updated.
- `desk5l` (the build with `List`) takes the same changes.

## 11. Size: where the bytes go

The playbook's constraint: DOCK 2-3 has **4,540 bytes free**, and FEASIBILITY guessed Paint at 5-6 KB. The plan that closes it:

| Where | Item | EST bytes |
|---|---|---|
| DOCK 2-3 | P1: program, loop, `Canvas` (draw, events, commit, undo), `Palette` class, menus, PBM save and open | 2,400 |
| | P2: brush and spray logic, shape rubber band and commit, options | 800 |
| | P3: marquee, move, bucket driver | 600 |
| | P4: FatBits (a view mode), optional text | 600 |
| | **Total** | **about 4,400** |
| DOCK 6 | the moved library (`G_LINE` + `G_ADDR`, `G_BLIT`, `G_SCROLLV`; SIZE 4) | 3,800 |
| | patterns 128, brushes 40, tool icons 640 | 810 |
| | `G_PATFILL` 300, `G_OVAL` + `G_RRECT` 700, `G_FLOOD` 500 | 1,500 |
| | **Total** | **about 6,100 of 8,192** |
| Pool | `K_PROGS` + 2; the library leaving frees about **+3,800** (free 2,121 to about 5,900) | +2 |
| Arena | the copy 5,760; the window and views (about 170); three dialogs made on demand (about 450, as Notepad's); the band buffer 324 | **about 6,700 of 7,168** |

- **DOCK 2-3 does not close without discipline:** 4,400 against 4,540 leaves 140 bytes. So (question 2) **the zero-filled variables of Paint's own
  image are not in the image** (cleared at start; about -100 for Paint), the tool table and `Palette` are shared between three instances,
  and the shapes and the fill live in DOCK 6. If P3 shows the total above 4,540, the owner is asked before any other program is touched
  (the zero-filled variables of the other four, about -336, or `w_gaview`, about -85, are the known savings).
- **The arena has about 460 spare bytes.** It is tight: the report row measures it (bound >= 256).

### 11.1 SIZE 4 (the DOCK 6 graphics library) is slice P0

Its own small contract in `SIZE.md` 4 (kept there) and measured before any Paint code:
- build chunk 6 into `desk5` and `desk5l` (`tools/build.mjs` `chunks` = 0-6; `desk5.asm`: an `ORG $C000` section ending at `$E000`; the cartridge is
  57 KB);
- move `G_LINE` + `G_ADDR`, `G_BLIT` (with the shell's icons: its data must be visible under R) and `G_SCROLLV`, reach them by `KFAR`, replace
  Check's X by five `G_FILL` rectangles;
- **first check, before moving.** Done by grep (2026-11-14): the only callers outside the library are Check's X (`tk.asm:139`, `jp G_LINE`: becomes
  five `G_FILL`s), the shell's icons (`shell.asm:145`, `KFAR G_BLIT`) and Notepad's scroll (`write.asm:2636`, `KFAR G_SCROLLV`); `pointer.asm` calls only
  `G_PRESHIFT`, at start (it stays in the pool). **Still to check in P0:** that the pointer's drawing does not use `G_BLIT`'s internal labels, and that
  `G_LINE`, `G_BLIT` and `G_SCROLLV` are safe under R (BANKING 5.4 audits only `G_SETCLIP G_SETOP G_FILL G_FRAME G_HLINE G_VLINE G_TEXT8 G_TEXTP
  P_SHIELD P_UNSHIELD` under R: they use `GCODE` and tables in the pool, which R sees, but the audit must be extended and tested);
- the pixels are unchanged: every existing suite passes with identical logs; the pool's free bytes are re-measured (bound: >= 5,000).

## 12. Numbers to measure and the bounds

TSRun T-states, no contention (real hardware is slower on `$4000-$7FFF`). **EST** figures are my estimates; the bound is the estimate with a
margin, to be reset to the measure by the owner as before.

| Measure | Bound |
|---|---|
| Pool bytes added by Paint (`K_PROGS` + `K_BOX`) | <= 100 |
| Pool free bytes after SIZE 4 | >= 5,000 (reserve 1,000 stays) |
| DOCK 2-3: Paint's total (`PT_END` - `PT_START`) after P4 | <= 4,400, and DOCK 2-3 free >= 100 |
| DOCK 6 used | <= 7,000 of 8,192 |
| Paint's image and the RAM after it | <= `AL_RAM` (`ASSERT`) |
| Arena spare with all three dialogs made | >= 256 |
| Stack of every path, crossings included | <= 128 |
| One pencil step (a 30-pixel `G_LINE`, shielded, clipped), from the `E_MOVE` | <= 58,000 (one frame) **report** |
| The commit (the whole-picture `G_SAVERECT` + undo save) | <= 260,000 |
| A fully exposed canvas, redrawn (section 4) | <= 330,000 |
| Undo (swap + redraw of a 2,044-byte box) | <= 150,000 |
| `G_PATFILL` 320 x 144 | **report** (EST 250,000) |
| `G_OVAL` of 320 x 144 (outline) | <= 100,000 |
| `G_FLOOD` of an empty picture (EST worst case) | **report** |
| Save / Open 5,760 bytes | **report** (EST 400 k / 450 k) |
| Frames lost, `DI` held across a frame | 0 |

## 13. Questions for the owner (with my recommendation; the answers go into this contract)

1. **Canvas size.** (a) **320 x 144, 5,760 bytes** (recommended: the largest that leaves the arena room for dialogs and a band buffer);
   (b) 256 x 128, 4,096 bytes, which leaves 3 KB and would let the undo area live in the arena instead of cold RAM; (c) other. A picture larger
   than the window with scrolling is **not** proposed: the arena cannot hold it.
2. **Paint's byte budget.** DOCK 2-3 has 4,540 free and Paint is estimated at 4,400. **Recommended:** build Paint with its zero-filled variables
   out of the image from the start (no retrofit of the other programs), and move shapes and fills to DOCK 6. If the total still goes over, ask
   before changing another program.
3. **The tools and their order.** P1 Pencil and Eraser (with Undo, New, Open, Save); P2 patterns, Brush, Spray, Line, Rectangle, Rounded rectangle,
   Oval; P3 Marquee (select and move) and Bucket; P4 FatBits. Which can wait, and is the Spray wanted (it costs about 80 bytes)?
4. **File format.** **Recommended: PBM P4**, 320 x 144 only, ".pbm". The alternative is a private header, which no viewer opens.
5. **Undo.** **Recommended:** one level, swap-style, for changes whose box fits 2,044 bytes; larger ones say "Too big to undo" and Clear / New ask first.
   The alternative is a smaller canvas (question 1b) with a bigger area.
6. **`AL_RUN`** (a shared app frame). **Recommended: not now.** It saves about 5 bytes now and about 65 at six programs, and costs about 60 T an
   event; Paint's loop is not the plain shape it assumes (the tools hang off the capture). Reconsider at the Puzzle.
7. **Tool cursors** (crosshair, pencil). **Recommended: arrow only** for P1-P3. A new pointer image needs a pool routine to preshift a second
   bitmap (EST +60 bytes) and an ISR choice; it is cheap to add later and the status line names the tool meanwhile.
8. **Clear and Undo.** A Clear is too big to undo (section 6); the question asked first ("Discard the document?") is what protects the user.
   Acceptable, or should Clear be allowed to keep the cold area's 2 KB by being a rectangle-by-rectangle clear? (Recommended: accept.)

## 14. The slices, tests and gates

| Slice | Builds | Owner tries |
|---|---|---|
| **P0** | SIZE 4: chunk 6, the library moved (section 11.1) | pixels unchanged on every suite |
| **P1** | the program, window, `Palette`, `Canvas`, pencil, eraser, commit, Undo, Clear, New, Open, Save, Quit; the shell edits | draw, undo, save to a ".pbm", open it again |
| **P2** | patterns, brushes, spray, line and shapes; `G_PATFILL`, `G_OVAL`, `G_RRECT` | |
| **P3** | `G_FLOOD`, the bucket, marquee select and move | |
| **P4** | FatBits, optional text | |

Each slice: a contract section here (the as-built figures), the model and tests (Sonnet, `tests/pt-model.mjs`, `tests/pt-lib.mjs`, `tests/pt-p1.mjs` ...),
the Z80 (main model), tests re-run (Haiku, then the main model), the owner tries it in `web/`, commit. **The model** is the picture as a 320 x 144 bit
array: pencil lines by the same algorithm as `G_LINE` (copied from gfx6's own reference model), stamps, fills, the PBM bytes. **The machine tests**
compare the display RAM (`$4000-$57FF`, `$6000-$77FF`, with drawing off) and the copy in the arena with the model after scripted mouse strokes
(TSRun's `m.mouse`); a window dragged over the canvas at 1-pixel offsets; Save and Open round trips through the fake host (`tests/fs-lib`); every
`desk5` suite on the new build. ZEsarUX and Fuse sessions in the style of Key Caps' and the Find session.

**The mock-ups** (`node tools/paint-mock.mjs` -> `docs/paint/pt1-window.png`, `pt1-shell.png`): the Paint window at 1:1 and at 2x in the Mac look,
with the tool icons, the pattern swatches and the brush cells; and the shell's window with four icons. Current beside proposed for the shell.

**Mock-up notes (2026-11-14, from the generator's report):** in the mock the palette grids draw each cell's right column and bottom row as its
border, so the top row and left column sit 1 pixel outside the section 2 rectangles (still inside the content area); the tool icons are 16 x 12
in a 31 x 15 interior; the selected pattern has a 2-pixel solid frame (an XOR ring is invisible on the checker); the 16 patterns include a weave, a
2 x 2 checker and a back diagonal; the Options menu is a title only. These are the figures P1 builds unless the owner changes them.

## 15. As built: P0 and P1 (2026-11-14; the reference for the tests)

**Symbols and files.** `src/apps/paint.asm` (`PN_`, `pn_`; the build's `out.sym` has every `PN_` variable), `src/apps/ticons.txt` (the ten 16 x 16 tool icons, in tool
order: MARQUEE PENCIL BRUSH ERASER SPRAY BUCKET LINE RECT RRECT OVAL), `src/apps/icons.txt` (`PAINT`, the shell's fourth icon), `K_BOX` in `kernel.asm` (`desk5` only).
Paint is program 4; the shell is 320 wide with four icons; its "Leap" menu has the items About, a separator, Calculator, Key Caps, Notepad, Paint (item id 6).

**The window (as built).** `CWindow` (48, 16, 416, 176), id 255, title "Paint: name" (AL_TITLE); children in this order: the tool box `Palette` (55, 28, 66, 82) id 1, the `Canvas`
(126, 30, 324, 148) id 4, the status `Label` (127, 180, 324, 9) id 5. (The pattern and brush palettes of section 2 arrive in P2.) The menus: File (New, Open..., Save..., separator, Quit),
Edit (Undo, disabled at the start; Clear). The picture is at (OX, OY) = the canvas view's (x + 2, y + 2) = (128, 32) while the window is where it opens; **the window may be dragged** (by whole cells) and everything
Paint draws, clips and reads follows the canvas view (`pn_org`, run at the start of the Canvas' `M_DRAW` and `M_EVENT`).

**The tool box.** Cell t (0-9, row-major, 2 columns) has its interior at (56 + 32 (t AND 1), 29 + 16 (t >> 1)), 32 x 16; the icon (`TICON_<name>`, 16 x 16, opaque) is drawn at the interior's x + 8, y;
then the frame (x - 1, y - 1, 33, 17) in SET; the chosen tool's interior (x, y, 31, 15) is inverted (XOR). A press on a cell chooses that tool and the status line shows its name
(Marquee, Pencil, Brush, Eraser, Spray, Bucket, Line, Rectangle, Rounded rectangle, Oval). At start the Pencil is chosen. Only the Pencil (1) and the Eraser (3) draw in P1: a press in the picture with
another tool sets the status "Not built yet".

**The canvas.** Its `M_DRAW` draws two frames (the view's rectangle and the one inside it, each 1 pixel, SET), then the picture from the copy by bands (section 4). A stroke is a press inside
the picture (x - 128 in 0..319, y - 32 in 0..143) with the Pencil or the Eraser; the view takes the capture; every `E_MOVE` while it is held adds a segment from the last point to the pointer; the
release commits. Drawing is clipped to the picture (128, 32, 320, 144) and the pointer is shielded from it.
- **Pencil:** `G_LINE` in SET from the last point to the new point (the first press draws the single pixel).
- **Eraser:** CLR stamps of 16 x 8 at (x - 8, y - 4). The walk from the last point (lx, ly) to the new one (nx, ny): dx = |nx - lx|, dy = |ny - ly|, sx, sy the signs (a zero difference steps +1 and is
  never used); the steps n = max(dx, dy) (x major when dx > dy, else y major); with the error e = 0 and the counter c = 0: for each of the n steps, the major coordinate steps; e = e + (the minor delta);
  when e >= the major delta, e = e - the major delta and the minor coordinate steps; c = c + 1; **a stamp at the new point when c is a multiple of 4**; after the last step **one stamp at the end** (and when n = 0, one stamp
  at the point). Each segment starts its own walk (c = 0). (A stamp the first press: n = 0.)
- **The commit (release):** the stroke's box in byte columns (the picture's columns 0-39 = (x - 128) >> 3, each point's column +-1, clamped) and rows (y - 32 +- 4, clamped) is widened to an even first column
  and an even column count; with nc columns and nr rows the box is "fit" when nc x nr <= 2,048. Fit: the box's bytes (both parts, rows nr, H = nc / 2 bytes a row of each part) are copied from the copy to
  cold RAM `$5800` (part 1's rows, then part 2's, packed) by `K_BOX`, `PN_UNDO` = 1 and Undo is enabled. Not fit: `PN_UNDO` = 0, Undo is disabled and the status says "Too big to undo". Either way the whole
  picture is then saved from the screen into the copy (`G_SAVERECT`) and `PN_DIRTY` = 1.
- **Undo:** if `PN_UNDO`, the box (`PN_UB0`, `PN_UBN`, `PN_UR0`, `PN_URN`) is swapped between the copy and `$5800`, and its rows are redrawn from the copy; Undo stays enabled (a second Undo redoes).
- **Clear:** paper over the picture, the copy saved, `PN_UNDO` = 0 (Undo disabled), `PN_DIRTY` = 1. **New:** Clear, `PN_DIRTY` = 0, the name "Untitled".
- **The discard question** (`AL_ASK`, "Discard the document?") comes first for New, Open, Clear and Quit (File > Quit, the close box, SS+Q) when `PN_DIRTY` = 1: Discard (id 1) does the action, Cancel (id 2) does nothing.
- **Save:** the name dialog (`AL_NAMEDLG`: "Save as:", the name, "Save"), ".pbm" added when the name has no "."; the PBM (section 9: 11 header bytes, then 144 rows of 40 bytes, binary, 5,771 in all); on success `PN_DIRTY` = 0
  and the title is "Paint: name"; a host failure shows the alert "Cannot save the picture.". **Open:** `FS_PICK`, the file's length must be 5,771 and its first 11 bytes the header, else the alert
  "Not a 320 x 144 PBM picture."; a read failure shows "Cannot read the file."; on success the copy is replaced, the picture redrawn, `PN_DIRTY` = 0, Undo disabled, the title "Paint: name".

**Sizes (P1, 2026-11-14):** Paint's code and image 2,753 bytes (`PN_END - PN_START`), its image 377, its variables 201; `K_BOX` in the pool (`calc-perf`'s row 258 of 264); the cartridge 57 KB (chunk 6 holds the library, the shell's and the tool icons).

**Status messages (as built):** "Not built yet" (a press in the picture with a tool that is not built) and "Too big to undo" replace the tool's name in the status line; the name returns at the next
choice of a tool or the next stroke whose box fits the undo area (`PN_MSG`).
**Measured (TSRun, 2026-11-14, `tests/pt-p1.mjs` group 9):** the pencil step 18,596 T from the frame ISR to the HALT (bound 58,000), `pn_seg` 11,327; the commit 115,653 (4 x 9 box), 168,035 (32 x 64), 144,123 (too big)
(bound 260,000); **Undo of a 2,016-byte box 263,667 T (bound 150,000: MISSED by 113,667)**; **a fully exposed canvas 582,978 T (bound 330,000: MISSED by 252,978; the kernel's cell repaint also redraws the
tool box and the label, about 100-170 k of it)**; Save 947,157 T and Open 1,054,422 T (EST 400 k / 450 k); the question closing over the canvas 337,015; stack at most 86 bytes; 0 frames lost; Paint's
variables end at `$C246`, 378 bytes below `AL_RAM`. Awaiting the owner's decision on the two missed bounds (section 16 of the report to the owner: accept the measured figures, or speed up).
