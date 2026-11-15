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
