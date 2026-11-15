# The 15-tile puzzle (contract, draft 1, 2026-11-15; owner chose a game: "4"; planned since the Paint order, CLAUDE.md)

**What:** program 5, "Puzzle": the sliding-tile game. A 4 x 4 board, 15 numbered tiles and a gap; a click on a tile next to the gap slides it (a click on a tile in the gap's row or column slides the whole run); arrow keys move the gap's neighbour. A move counter and a "Solved!" message with the win sound. The first **K-resident program** (`docs/SPACE_PLAN.md`): its code is in the pool and runs under mapping K, so it draws with direct `G_` calls.

## 1. The window and the game
- **Window** `CWindow` (id 255, "Puzzle"), content about 208 x 140: the board 4 x 4 cells of 40 x 32 pixels = 160 x 128 at the window's left, and a column on the right with the move counter ("Moves: 12") and a "New game" `Button`. The window can be dragged: everything is drawn from the board view's origin (the rule of CLAUDE.md).
- **A tile:** a 38 x 30 frame (rounded corners as the Rounded rectangle) holding its number in large digits: the 8 x 8 font scaled 2 x 2 (a tile is 16 pixels wide for two digits: the digits are drawn by `G_TEXT8` rows doubled, or from a 10-glyph 16 x 16 table in the pool, 160 bytes: chosen by measure). The gap is paper with a dotted outline.
- **The board is a model of 16 nibbles** (the tile in each cell, 0 = the gap) in the program's RAM image. **New game:** from the solved board, 120 random legal moves (a 16-bit LFSR seeded from the frame counter, as Paint's spray), so every game is solvable; the counter 0. **Moves:** the tile slides in one redraw of the cells that changed (not the board). **Solved:** when the cells are 1..15 and the gap last: "Solved!" in the counter's place and the win sound; clicks do nothing until "New game".
- **Menus:** Game (New game N, Quit). Keys: arrows slide the tile that would move into the gap from that side; N = new game. SS+Q or the close box quits.

## 2. Numbers to measure and bounds
| Measure | Bound |
|---|---|
| Pool bytes | <= 1,500 (**report**; EST 1,300); DOCK 2-3 0 |
| A move (one tile, one cell redrawn), the click to HALT | <= 100,000 T |
| A run of 3 tiles | <= 250,000 T |
| New game (120 moves, no drawing) then the board drawn | <= 500,000 T |
| Stack, all paths | <= 128 |
| Frames lost, DI held | 0 |

## 3. Tests (Sonnet): `tests/pz-p1.mjs`
A model of the board and the moves (legal moves, runs, the solved test, the shuffle's solvability by inversion parity), the screen against the model at the default and a dragged position, scripted games on a fixed LFSR seed, the keys, the menu, the close and the quit back to an open shell, the counter, the win. The K-resident launch itself: the start in the pool, `K_PROG` 5, mapping K at the program's first instruction.

## 4. Questions for the owner (recommendations first)
1. **Numbers or a picture?** (Recommended: numbers first. A later option is to load a `.pbm` from Paint and slide its 4 x 4 pieces: 80 x 36 pixels each, a nice link between the programs, after the file manager.)
2. **Slide a whole run on one click?** (Recommended: yes, as the real puzzle does.)
3. **A best-moves record?** (Recommended: no, nothing is saved yet.)

## 5. Owner's decisions (2026-11-15)
- **Numbered tiles first; a picture mode (slide a Paint `.pbm`) later**, after the file manager (it needs a way to pick a picture). Moves of a run on one click as recommended; no record.
- **Program 5 is a K-resident program** (`docs/SPACE_PLAN.md`), built after sound. The file manager (`docs/FILEMGR.md`) is **deferred** (the owner asked to "just do" sound and the puzzle); the marquee and FatBits stay waiting.

## 6. As built (2026-11-15)
**Files:** `src/apps/puzzle.asm` (pool, chunk 1 after `tk2.asm`: **about 920 bytes**; the pool then has 4,690 free, `shell-perf`, program 5, `PZ_START` in `K_PROGS`), the shell (five icons, window 384 wide, the Leap menu's 9th item "Puzzle", id 9 shown after Paint; `S_NICONS` 5), `icon PUZZLE` in `src/apps/icons.txt` (a grid with a gap, 32 x 16). The class, strings and the window's table are in the pool (K reads them there); the variables are the first bytes of `PROG_IMG` (`PZ_B` .. `PZ_VEND`, 40 bytes), cleared at the start by `k_zero`; nothing is copied to the image.
**What differs from the draft:** the cells are **64 x 32 pixels** (the board 256 x 128, physically square on the 1 : 2 pixels; not 40 x 32), the window 400 x 160 at (64, 24); the tile is a 62 x 30 frame with its number in bold (the proportional font drawn twice, one pixel apart, not scaled 2 x 2); **no Game menu** (the New game button, N, and the close box / SS+Q cover it); the frame has square corners. A larger digit font and rounded corners are later options (bytes: about 160 and 50).
**Calls:** direct `G_FRAME`, `G_TEXTW`, `G_TEXTP`, `G_SETOP`, `W_INVAL`, `W_UPDATE`, `W_DRAWVIEW`, `K_BEEP` (id 5, the win) and `TK_DISPATCH`; `AL_NEW` / `AL_VIEW` by `KFAR`. A move invalidates the changed cells' rectangles and one `W_UPDATE` repaints them (the board's `M_DRAW` draws all 16 tiles, each clipped to the repaint rectangle).
**Speed (measured, `pz-p1` group 10):** `pz_draw` tests each cell against the clip (`pz_vis`) before drawing it (a move was 190,566 T without it, **90,240 T now**, bound 100,000); the number is centred by its digit count (x + 32 - 3 n: no `G_TEXTW` per tile). One tile 90,240 T, a run of 2 113,484 T, a run of 3 138,519 T (bound 250,000), New game by the N key 499,939 T (bound 500,000), **New game by the button 544,408 T: MISSED by 44,408 T** (the button's own redraws are in the figure; for the owner to accept or for a cheaper tile).
**Verified by hand (TSRun screenshots):** the launch from the Leap menu, the board and label, a click that completes the picture ("Solved:" and the win), the window home position. **Tests:** `tests/pz-p1.mjs` (Sonnet; the shell's tests move to five icons and nine menu items).
