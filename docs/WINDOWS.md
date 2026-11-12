# Window manager: contract (draft 2, 2026-11-12, owner approved)

Roadmap step 4 (`docs/FEASIBILITY.md` sections 3, 9 and "Recommended architecture"). Once approved, this contract binds step 4's
code, generators and tests. An "As built" section is added when it is done. Marks as in FEASIBILITY: **EMU** measured, **EST**
estimated.

Style as `docs/OBJECTS_EVENTS.md`: every number in section 9 is a bound. **A missed bound is reported with its numbers before
anything is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not
judged. Section 13 records the owner's decisions.

## 1. What step 4 builds

The top layer of the kernel. Together with steps 2 and 3 it is the proof of concept (FEASIBILITY 9), the first milestone.

1. **The cell-owner map:** 32 x 24 cells of 16 x 8 pixels. Each cell records which window shows there and whether it needs
   repainting.
2. **The window list:** windows are views. They are the desk's children, front-most first, so step 3's hit testing gives the
   z-order for free. The routines are open, close, raise and move.
3. **Damage repaint:** the dirty cells are repainted owner by owner, as a few rectangles each. Each rectangle gets one `M_DRAW`,
   with gfx6's clip set to it and the pointer shielded from it.
4. **Window behaviour:** a click on an inactive window raises it; a press on the title bar drags an XOR outline snapped to
   cells.
5. **Menus:** a menu bar with drop-downs, which save the screen under them and restore it on close. They are tracked by
   the pointer (press, drag, release) and by the keyboard (MENU, the arrows, ENTER, ESC). A choice gives an `E_MENU` event.
6. **Dialogs:** a modal window. ENTER presses the default button and ESC (or BREAK) the cancel button.
7. **Two kernel controls,** enough for dialogs and the PoC: `Button` (it posts `E_CMD`) and `Label` (8x8 or proportional text).

**Out (later steps):**
- close boxes, resizing, zooming, and windows partly off screen;
- scroll bars and the other controls (step 5's toolkit);
- menu shortcut keys, check marks, submenus;
- desktop icons and patterns (step 5's shell);
- alert helpers, and nested modal dialogs;
- more than one application at a time, and the jump table (step 6);
- the mode 0 and mode 2 variants (deferred, owner 2026-11-11);
- timers;
- contention.

## 2. Memory and cartridge

Cartridge shape as `kern3`: DOCK chunks 0, 1, 4, 5; `$F4 = $33`; stack `$FB00-$FEFF` (top `$FF00`); record at `$FF00`. Step 4's
code goes in `src/kernel/wm.asm` and `src/kernel/menu.asm`, inside `K_CODE..K_CODE_END` (chunk 5). If the test cartridge's own
code no longer fits in chunk 5, it moves to chunk 1's free bytes after the gfx6 tables.

| Where | What |
|---|---|
| `$E000-$E0FF`, `$E100-$E6FF`, `$E700-$E7FF` | gfx6, pointer, `GCODE`: unchanged |
| `$E800-$EFFF` | **`W_SAVE`: the menu save-under buffer**, 2,048 bytes. A drop-down needs `4 + nc x nr <= 2,048` (GRAPHICS_SPIKE 15.2): for example 128 pixels wide with 11 items, or 94 pixels wide with 15 items (18.2's rule; corrected in W3, it said 96). `MB_SET` refuses a menu that does not fit |
| `$F000-$F0BF` | Step 3's ring, posted queue and variables: unchanged |
| `$F0C0-$F0CF` | **Step 4 variables that step 3 code reads:** `W_DIRTY` (byte, not 0 when any cell is dirty), `K_FSCOPE` (word, the focus scope, section 7). Kept here so that `kern3`, whose boot zeroes this page, behaves exactly as before |
| `$F100-$F3FF` | **`W_MAP`: the cell-owner map**, 768 bytes, row-major. Cell (c, r) is at `W_MAP + 32 r + c`, for columns c = 0..31 and rows r = 0..23 |
| `$F400-$F4FF` | Window manager variables: `W_SLOTS` (16 words: the view of each owner), `W_MODAL`, the menu bar's computed layout and enable bits, internal state |
| `$F500-$FAFF` | Kernel arena, 1,536 bytes (**amends OBJECTS_EVENTS 2** for `kern4` and later: it was `$F100-$FAFF`) |
| `$C000-$DFFF` | App arena in the test cartridge (8 KB), as step 3 |

**`W_MAP` byte:** bits 0-3 are the owner, bit 7 is dirty, bits 4-6 are 0.
- Owner 0 is the desk, 1-14 are window slots, and 15 is the menu bar.
- Row 0 is always owner 15.
- `W_SLOTS[o]` is the view of owner o: the desk, a window, or the menu bar. A free slot holds 0.

Boot zeroes all of the above, then calls `W_INIT`.

## 3. The screen

- **Menu bar:** cell row 0 (pixel rows 0-7), the full width, drawn **inverted** (an ink bar, titles in paper). `PROP6` glyphs
  have a blank row 0 and descenders in row 7, so a title fits the 8-row bar exactly.
- **Windows** are cell aligned: x a multiple of 16, y a multiple of 8, w a multiple of 16, h a multiple of 8. They lie wholly on
  the screen below the bar: y >= 8, x + w <= 512, y + h <= 192. The minimum size is 48 x 16.
- **Window look** (the exact pixels are fixed in W1's interface, the owner reviews them by eye):
  - **Frame:** 1 pixel around the window rectangle.
  - **Title bar:** pixel rows y..y+8. The title text starts at (x + 8, y), and row y+8 is the separator line.
  - **Active (front) window:** the title bar is filled with ink and the title is drawn in paper.
  - **Inactive window:** the title bar is paper with the title in ink.
  - **Content area:** (x + 1, y + 9, w - 2, h - 10).
- **Dialog:** no title bar, a double frame, and a content area inside it.
- **Desk:** paper.
- **Coordinates stay absolute** (screen pixels), as in step 3. Moving a window adds (dx, dy) to the window and to every view
  under it. So hit testing, routing and gfx6 calls are unchanged.

## 4. Classes and drawing

**`M_DRAW`, defined at last** (it was nothing in step 3):
- **Sent** with gfx6's clip (`GCLIP`) set to the rectangle being repainted and the pointer shielded from it.
- **The method** draws its view's whole appearance and lets gfx6 discard what falls outside the clip.
- **It is opaque:** it sets every pixel of its own rectangle, ink or paper.
- **It may** set `GOP` and `GLH`, and send `M_DRAW` to other views.
- **It must not** call `G_SETCLIP`, `P_SHIELD` or `P_UNSHIELD` (the shield is a single rectangle), or change the map (the
  `W_*` routines of section 5).
- **Repaint correctness** (section 6) rests on the draw being opaque and deterministic.

| Class | Parent | Fields (after the parent's) | Methods it sets |
|---|---|---|---|
| `Group` | `View` | — | **Draw `group_draw` (new):** sends `M_DRAW` to each child in list order that is not hidden and whose rectangle meets the clip. Children of one group must not overlap. |
| `Desk` | `Group` | — | Draw: paper over (0, 8, 512, 184). It never draws its children: windows and the bar are drawn through the map. Event: section 7 |
| `MenuBar` | `View` | `table` 2 | Draw: the bar (section 8). Event: menu tracking |
| `Window` | `Group` | `slot` 1, `title` 2, `focus` 2 | Draw: frame, title bar (active or inactive look), content area to paper, then `group_draw`. Event: section 7. Destroy: `W_CLOSE` if open, then `View`'s |
| `Dialog` | `Window` | `default` 2, `cancel` 2 (Button views or 0) | Draw: dialog look. Event: ENTER / ESC (section 7) |
| `Button` | `View` | `text` 2 | Draw: framed, text centred. The normal, pressed, focused and default looks must be distinguishable (the main model draws them, the owner reviews them). Event: section 7. Focusable |
| `Label` | `View` | `text` 2 | Draw: paper, then the text at (x, y): `G_TEXTP`, or `G_TEXT8` when flags bit 3 is set (x and y on the 8x8 grid). Not focusable |

- `title` and `text` point at a **string**: a length byte n, then n codes (`G_TEXTP`'s strings with the length in front).
- `View_flags` bits 3-7 belong to each class. `Button` uses bit 3 (pressed) and bit 4 (default).
- `Desk` and `MenuBar` live in the kernel arena. Windows and controls live in the app's arena.

## 5. Routines

All preserve IX (unless it is an output), IY and the alternate set, and execute no `DI` or `EI`. "Damage" means: set the dirty
bit of the cell and set `W_DIRTY`. Nothing is drawn until `W_UPDATE`. The exceptions are `W_DRAWVIEW`, `W_DRAG` and the menu
routines, which draw at once.

| Routine | In | Out / effect | Clobbers |
|---|---|---|---|
| `W_INIT` | | Makes `Desk` and `MenuBar` (kernel arena), `K_SETROOT` desk, desk's only child the bar; the map all owner 0 (row 0 owner 15), every cell dirty; `W_SLOTS` = desk, 0 x 14, bar; no menus | AF, BC, DE, HL |
| `W_OPEN` | IX = window (rect, title and children set) | Section 6's map rule with the window in front; activation (section 7); a `Dialog` sets `W_MODAL`. Carry (nothing changed) when: already open; no free slot; the rect breaks section 3; a modal dialog is open (any second window or dialog is refused) | AF, BC, DE, HL |
| `W_CLOSE` | IX = window | Unlinked from the desk, slot freed, the map rule; if it was in front, the new front window is activated; `W_MODAL` cleared if it was the dialog; `K_FOCUS` / `K_CAPTURE` cleared if inside it. Carry when not open. It does not destroy the window | AF, BC, DE, HL |
| `W_RAISE` | IX = window | To the front (behind the bar), the map rule, activation. Nothing if already in front. Carry when not open, or when a modal dialog is open and this is not it | AF, BC, DE, HL |
| `W_MOVE` | IX = window, HL = x, DE = y | Adds (dx, dy) to the window and every view under it; the map rule, and every cell the window now owns is damaged (its content moved). Carry (nothing changed) when the new rect breaks section 3 | AF, BC, DE, HL |
| `W_INVAL` | `GA`: x, y, w, h | Damages every cell the rectangle touches (clamped to the screen), whatever its owner | AF, BC, DE, HL |
| `W_INVALV` | IX = view | `W_INVAL` of the view's rectangle | AF, BC, DE, HL |
| `W_UPDATE` | | Repaints every dirty cell (section 6), then clears every dirty bit and `W_DIRTY`. Returns at once when `W_DIRTY` = 0 | AF, BC, DE, HL |
| `W_DRAWVIEW` | IX = view | Draws the view now, wherever its top-level owner shows (section 6). Dirty bits unchanged. Nothing for a view that is hidden or not in an open window, the bar or the desk | AF, BC, DE, HL |
| `W_FRONT` | | HL = the front window, or 0 | AF, HL |
| `W_DRAG` | IX = window | The outline drag (section 7). Called by `Window`'s event method; programs may call it | AF, BC, DE, HL |
| `MB_SET` | HL = menu table (section 8) or 0 | Lays out and draws the bar. Carry (bar unchanged) when the table breaks section 8's limits | AF, BC, DE, HL |
| `MB_ENABLE` | A = menu index, C = item index, B = 1 enable / 0 disable | The item's enable bit | AF, HL |

**The event loop** of a program (amends OBJECTS_EVENTS 5):
1. `K_GETEV`; if carry, `HALT` and go back to 1.
2. Handle `E_MENU` and `E_CMD` itself, or anything else it wants.
3. `K_DISPATCH` the rest, `E_REDRAW` included.

## 6. Damage and repaint

**The map rule.** After every `W_OPEN`, `W_CLOSE`, `W_RAISE` and `W_MOVE`:
- the owner of cell (c, r), for r >= 1, is the slot of the first window in the desk's list, front to back, whose rectangle
  contains the cell's pixels; 0 when none does;
- every cell whose owner changed is damaged.

Activation damages more cells (section 7), and `W_MOVE` damages more (section 5). Dirty bits are only ever added, until
`W_UPDATE`. How the map is brought up to date (incrementally or by repainting the slots back to front) is the code's choice.

**Rectangles** of a cell set S: scan rows r = 0..23 and take the maximal runs [c0, c1) of S in row r, left to right. If row r - 1
had a rectangle ending there with the same [c0, c1), the run extends it downward. Otherwise the run starts a new rectangle. The
rectangles are ordered by the row where they start, then by c0. A window that shows whole is one rectangle.

**`W_UPDATE`:** for each owner o in the order 15 (the bar), the open windows front to back, then 0 (the desk):
1. Let S be the dirty cells owned by o.
2. For each rectangle (c0, r0)-(c1, r1) of S, in order:
   - `G_SETCLIP` (16 c0, 8 r0, 16 (c1 - c0), 8 (r1 - r0));
   - `P_SHIELD` of the same rectangle;
   - `M_DRAW` to `W_SLOTS[o]`;
   - `P_UNSHIELD`.
3. At the end: the clip is the whole screen, every dirty bit is clear, and `W_DIRTY` = 0.

**`W_DRAWVIEW`** (view v):
- o is v's top-level owner: the window v is in, or the desk or the bar.
- S is the cells of v's rectangle (snapped outward to cells) that o owns.
- For each rectangle of S, as above, the clip is also intersected with v's pixel rectangle, and `M_DRAW` goes to v itself.
- Controls use it to show a state change at once (a button pressed). Programs use it for the same purpose.

**What the screen must show.** Fix the window list and the views. For each owner o, let image(o) be the screen that results
from o's `M_DRAW` drawn alone on a blank screen with the whole-screen clip.
- **After `W_UPDATE`, every cell shows image(owner)'s bytes.**
- **No display byte outside the painted rectangles changes.**
- This is what the composition test checks (section 10).

## 7. Events, windows, dialogs, focus

**Events** (adds to OBJECTS_EVENTS 6):

| Type | Name | Data | Source |
|---|---|---|---|
| 6 | `E_REDRAW` | 0, 0, 0 | **`K_GETEV`**, not the queues: returned when both queues are empty and `W_DIRTY` != 0 (the Mac's update event: lowest priority, never queued). `K_DISPATCH` of `E_REDRAW` calls `W_UPDATE` (amends 15.2's "any other: to `K_ROOT`") |
| 7 | `E_MENU` | 1: menu id; 2: item id; 3: 0 | posted by menu tracking |
| 10 | `E_CMD` | 1: the control's `View_id`; 2: its window's slot; 3: 0 | posted by `Button` |

**`Desk`'s `M_EVENT`:**
- **`E_KEY` MENU (16)** that bubbled up unconsumed opens the menus by keyboard (section 8). This does nothing while a modal
  dialog is open.
- **Pointer events while a modal dialog is open:**
  - inside the dialog: `group_event` as usual;
  - anywhere else: consumed and ignored, menu bar included.
- **Otherwise:** `group_event`. The bar is the desk's first child, so it is hit first.

**`Window`'s `M_EVENT`:**
- **`E_DOWN` on a window that is not in front:**
  - `W_RAISE`. The click is consumed and goes no further (the first click only activates);
  - if the click was in the title bar, `W_DRAG` follows.
- **`E_DOWN` in the front window's title bar:** `W_DRAG`.
- **Everything else:** `group_event`, so the window's controls get it.

**`W_DRAG`:**
1. `W_UPDATE` first, so the outline is XORed over a settled screen.
2. Then a loop inside the kernel: `K_GETEV` / `HALT`. Only `E_MOVE`, `E_UP` and `E_KEY` ESC are acted on; other events are
   dropped (none are expected). BREAK counts as ESC.
3. **The candidate position:**
   - the start plus the pointer's movement, rounded to whole cells (16 across, 8 down);
   - clamped so the window obeys section 3.
4. **The outline:**
   - `G_FRAME` in `XOR` of the window rectangle at the candidate, drawn when the candidate first differs from the start;
   - moved (erase, draw) each time the candidate changes;
   - each side is shielded on its own.
5. **`E_UP`:** the outline is erased; `W_MOVE` follows if the candidate differs from the start.
6. **ESC or BREAK:** the outline is erased and the window stays where it was.

**Activation** of the front window f, after open, close and raise, with old the previous front:
- old's `Window_focus` = `K_FOCUS` when that view is inside old;
- `K_FSCOPE` = f (0 when there is no window);
- if f's `Window_focus` != 0, `K_SETFOCUS` it. Otherwise `K_SETFOCUS` 0, then `K_FOCUSNEXT`;
- the title-bar cells (row y / 8) of old and of f are damaged, where each still owns them.

**Focus scope** (amends OBJECTS_EVENTS 15.3):
- **The walk:** `K_FOCUSNEXT` and `K_FOCUSPREV` walk the subtree of `K_FSCOPE` (or of `K_ROOT` when it is 0), and wrap at the
  scope's root instead of the tree's root. So TAB stays inside the front window.
- **Routing is unchanged:** a key goes to `K_FOCUS` and bubbles up through the window to the desk.

**`Dialog`'s `M_EVENT`:** an `E_KEY` that bubbled up unconsumed:
- ENTER (13) "clicks" `Dialog_default`, and ESC (27) or BREAK (3) "clicks" `Dialog_cancel`, when they are set;
- otherwise `Window`'s handling.

**`Button`'s `M_EVENT`:**
- **`E_DOWN`:** pressed, `W_DRAWVIEW`, consumed. Routing then gives the button the capture.
- **`E_MOVE` while it has the capture:** pressed = the pointer is inside; `W_DRAWVIEW` when that changes.
- **`E_UP`:** if pressed, unpressed, `W_DRAWVIEW`, and `E_CMD` posted.
- **A "click" by key** (ENTER or SPACE while focused, or a dialog's ENTER / ESC):
  1. pressed and drawn;
  2. 4 frames waited with `HALT`;
  3. unpressed and drawn;
  4. `E_CMD` posted.

  The 4 frames are a 4-frame flash, so a keyboard user sees which button acted.

## 8. Menus

**Table** (cartridge or RAM, read only by the kernel):
- **Header:** a byte, the number of menus (1..8), then a word for each menu: its record.
- **Menu record:**
  - a byte, its id;
  - its title (a string);
  - a byte, the number of items (1..15);
  - then each item: a byte id, a byte of flags (bit 0 disabled at start, bit 1 separator, which cannot be chosen), and its
    text (a string).

`MB_SET` works out each title's x and each drop-down's size once, and keeps them with the enable bits in `$F400-$F4FF`. It
refuses a table whose titles do not fit in 512 pixels or whose drop-down breaks the `W_SAVE` limit (section 2).

**Look** (exact pixels in W3's interface):
- **Titles:** from x = 8, each in a box of the title's width + 16. While its menu is open, the title box is shown inverted
  (paper on the ink bar).
- **Drop-down:**
  - its left edge is under its title box, moved left if needed to stay on the screen; its top is y = 8;
  - each item is 10 rows high, separators included;
  - its width is the widest item + 24;
  - a 1-pixel frame and a shadow on the right and bottom;
  - disabled items look different from enabled ones.
- **Highlight:** the item's row inverted (`XOR`).

**Opening and closing:**
- **Open:** `P_SHIELD` the drop-down's rectangle, then `G_SAVERECT` into `W_SAVE` and draw it.
- **Close:** `G_RESTRECT`, then the title drawn normal again.
- No other drawing happens while a menu is open, so the save-under is always exact.

**Tracking by pointer** (`MenuBar`'s `E_DOWN` on a title): a loop inside the kernel, as `W_DRAG`'s.
- **`E_MOVE`:**
  - over another title: its menu opens instead;
  - over an enabled item of the open drop-down: that item is highlighted;
  - anywhere else: no item is highlighted.
- **`E_UP`:** the menu closes; with an item highlighted, `E_MENU` (menu id, item id) is posted.

**Tracking by keyboard** (the MENU key, section 7):
- **Opening:** the first menu with an enabled item opens, with that item highlighted.
- **Moving:** LEFT and RIGHT move to the previous and next menu, and UP and DOWN to the previous and next enabled item. All
  four wrap.
- **ENTER:** chooses the highlighted item, as `E_UP` does.
- **ESC, MENU or BREAK:** closes the menu with no choice.
- **`E_DOWN`:** continues as pointer tracking from that point.

## 9. Bounds (TSRun, T-states, direct calls with a sentinel return, interrupts off so ISR time is excluded, unless stated)

Estimates are from measured parts: `G_FILL` 512 x 192 takes 146 k T, `G_TEXTP` 682 T a glyph, `G_SAVERECT` 96 x 80 takes 23.0 k,
and routing is as step 3 after option D.

**The headline numbers** (FEASIBILITY 9's list):

| Measure | Bound |
|---|---|
| **Bytes in the always-mapped pool** added by step 4: the growth of `K_CODE_END - K_CODE` (step 3 at 2,394), with step 4's classes and any tables, plus `K1_CODE_END - K1_CODE` (18.6). **Report** each part, and the pool's free bytes after (9,345 before) | <= 4,850 (owner, 16.7 / 16.8: the size pass's 4,837, rounded up; was 4,096, **EST** 3,500) |
| **Window raise:** two empty 256 x 96 windows at the same place; `W_RAISE` of the hidden one + `W_UPDATE` | <= 90,000 (owner decision C, 16.3: the measured 89,500 after B, rounded up; was 80,000, **EST** 65 k) |
| **Menu open:** 8 items, 96 pixels wide: from `MenuBar`'s `E_DOWN` to the drop-down drawn (the tracking loop's first `K_GETEV`) | <= 139,000 (16.7: the measured 138,090; was 100,000, **EST** 86 k) |
| **Menu close** with no choice, the same menu | <= 30,000 (**EST** 25 k) |
| **Pointer cost per frame:** the ISR is not changed by step 4 | step 3's bounds hold (whole ISR <= 12,000); **report** `P_ISR` idle and moving in `kern4` |
| **T per glyph** in titles and menu items | **report** (the bound is S2's `G_TEXTP`) |

**The rest:**

| Measure | Bound |
|---|---|
| `W_INVAL` 256 x 96 at (128, 48) / the whole screen | <= 5,000 / <= 20,000 |
| `K_GETEV`: empty and nothing dirty / `E_REDRAW` returned | <= 100 (step 3's bound) / <= 150 |
| `W_UPDATE` overhead: the whole screen dirty, all desk (one rectangle), `M_DRAW` a `RET` | <= 31,000 (owner, 16.7; was 20,000) |
| `W_UPDATE`: each further rectangle, `M_DRAW` a `RET` | <= 2,300 (16.7; was 1,500) |
| `W_OPEN` + `W_UPDATE`: an empty 256 x 96 window over the desk | <= 89,000 (decision C; was 80,000) |
| `W_CLOSE` + `W_UPDATE`: the same window, only the desk under it | <= 63,000 (decision C; was 60,000) |
| `W_MOVE` + `W_UPDATE`: the same window to a place that does not overlap the old one | <= 168,000 (decision C; was 140,000) |
| Drag step: the outline of a 256 x 96 window moved one cell (erase + draw, shields included) | <= 32,000 (16.7; was 25,000) |
| Menu highlight moved to the next item | <= 14,500 (16.7; was 8,000) |
| `E_MOVE`, no capture: desk -> front window -> a `Group` of 8 `TBox`, the last hit, to its handler (the every-frame path) | <= 3,900 (16.7; was 3,500) |
| `E_DOWN` on a `TBox` in the front window, the same tree, focus moving | <= 5,700 (16.7; was 4,500) |
| Per event (`E_KEY` to a focused view in a window), bubble level | <= 500 / <= 200 (step 3's, unchanged) |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, 32 views in the scope, the worst start | <= 11,000 / <= 18,000 (step 3's, unchanged) |
| Stack: `W_UPDATE` with views 8 deep / menu tracking / `W_DRAG` | <= 192 bytes |
| `DI` in step 4 code / frame interrupts lost in any frame test | none / 0 |
| `MB_SET` with 5 menus (bar drawn), `W_DRAWVIEW` of a 64 x 16 `Button` pressed, a menu choice from `E_UP` to `E_MENU` posted, the worst `W_UPDATE` rectangle count over the random tests | **report** |
| Kernel RAM used in `$F0C0-$F4FF`, and the kernel arena used by `W_INIT` | **report** |

## 10. Tests (TSRun headless, Node, the pattern of `tests/kern-k3.mjs`)

The tests are written from this contract, never from the code. The reference model is `tests/wm-model.mjs`: the map, slots,
list order, decomposition, activation, focus scope, modal rule, drag and menu state machines. It builds on the step 3 models.

1. **Map:** random sequences (at least 3,000 steps a seed) of `W_OPEN`, `W_CLOSE`, `W_RAISE`, `W_MOVE`, `W_INVAL` and
   `W_UPDATE`, with up to 14 windows and invalid requests among them (carry expected). After every step, these equal the model:
   - `W_MAP` byte for byte;
   - `W_SLOTS`, the desk's list order, `W_DIRTY`, `W_MODAL`, `K_FSCOPE` and `K_FOCUS`.
2. **Repaint log:** a test window class `TWin` logs each `M_DRAW`: self, and `GCLIP`. The log of every `W_UPDATE` and
   `W_DRAWVIEW` equals the model's rectangles, in order.
3. **Composition:** image(o) for each owner is rendered by the emulator itself, alone on a blank screen with the whole-screen
   clip. After `W_UPDATE` the screen must equal, cell by cell, the image of that cell's owner (section 6).
4. **Clip safety:**
   - the display is poisoned outside the dirty cells before `W_UPDATE`, and it is unchanged afterwards;
   - RAM outside the arenas, the kernel variables and `W_SAVE` is poisoned and stays unchanged.
5. **Look:** the pixels of the window chrome, dialog, bar, drop-down, `Button` and `Label` equal a gfx6-model rendering of W1's
   and W3's geometry.
6. **Input over frames,** scripted through TSRun's keyboard and joystick:
   - raise on click;
   - drags: move, cancel, snapping, clamping at all four edges;
   - the modal rule;
   - TAB staying in the scope;
   - `E_CMD` from buttons by pointer and by key;
   - `E_MENU` by pointer and by keyboard, disabled items and separators skipped;
   - the screen after a menu closes equals the screen before it opened, byte for byte.

   The event stream equals the model's.
7. **Regression:**
   - step 3's suites (`kern-k1`, `kern-k2`, `kern-k3`, `kern-hit`, the review checkers) and gfx6's;
   - any change to them that sections 5 and 7's amendments force is recorded in "As built".
8. **Frames:** `V_FRAMES` rises by exactly 1 per frame in every frame test, through drags and menu tracking.
9. **Bounds:** section 9 as checks in `tests/wm-perf.mjs`, printed as a table (measured, bound, pass / MISSED / reported).
10. **Cross-emulator:**
    - the `kern4` self-test record and the settled `kern4demo` screen are identical on TSRun, ZEsarUX 13.0 and Fuse 1.9.1;
    - on ZEsarUX, keys through ZRCP: MENU, the arrows and ENTER choose an item, and TAB moves within a window. Each screen after
      them equals TSRun's.
11. **Mutations:** the main model plants faults to show the tests catch them, among them: a decomposition that never merges
    rows, activation without the title damage, and a drag that does not snap.

## 11. Test cartridge `kern4` and the demo `kern4demo`

**`kern4`** (`src/kern4.asm`):
- Boots as `kern3`, then `W_INIT`.
- A self-test `T_SELFTEST4` runs a fixed script and writes a record: the log's checksum, `W_MAP`'s checksum and the front
  window's id. The script:
  - opens, raises, moves and closes windows;
  - opens and closes a dialog;
  - chooses a menu item by posted keys.
- Then it idles, so the tests can make direct calls (script runner and symbols as `kern3`).

**`kern4demo`** (the PoC milestone, `web/?cart=kern4demo`). It runs the self-test, then:
- **Menus:**
  - **Leap:** "About Leap Desktop..." opens a dialog with a `Label` and an OK button;
  - **File:** "New window", "Close window", a separator, and "Quit" (disabled);
  - **Window:** one item per open window, which raises it.
- **Two overlapping windows:**
  - "Text": 8x8 lines and a proportional paragraph;
  - "Buttons": three buttons and a `Label` counting the clicks.
- The pointer works on joystick 1 or in keyboard-pointer mode.
- **For the owner to try:** raise, drag, menus by pointer and keyboard, TAB in a window, the dialog's ENTER and ESC.

## 12. Slices and who does what (CLAUDE.md)

| Slice | Content | Who |
|---|---|---|
| **W1** | Map, slots, `Desk`, `Window` (look and `group_draw`), `W_INIT` / `OPEN` / `CLOSE` / `RAISE` / `MOVE` / `INVAL` / `INVALV` / `UPDATE` / `DRAWVIEW` / `FRONT`, `E_REDRAW` in `K_GETEV` and `K_DISPATCH`, activation and the focus scope; `kern4` skeleton; tests 1-5, 7 | Z80: main model. Model and tests: Sonnet, from this contract. Runs: Haiku |
| **W2** | `Window`'s events and `W_DRAG`, `Dialog` and the modal rule, `Button`, `Label`, `E_CMD`; tests 5-6 (their parts), 8 | as W1 |
| **W3** | `MenuBar`, `MB_SET`, `MB_ENABLE`, both kinds of tracking, the save-under, `E_MENU`; `kern4demo`; tests 6 (menus), 9-11; "As built"; FEASIBILITY updated | as W1; cross-emulator runners Sonnet |

- Each slice passes its tests before the next starts.
- The main model re-runs every agent's tests before reporting.
- Each slice starts with its interface section here, as step 3's 13-15: exact pixels, addresses, and how each bound is
  measured.
- A missed speed bound is recorded with options. A bounded fix may go to a Fable agent in its own worktree, as step 3's
  option D did.

## 13. Decisions (owner, 2026-11-12)

1. **Coordinates stay absolute** (section 3). A move walks the window's views; routing and drawing need no offset.
2. **The menu bar is one cell row, inverted** (section 3).
3. **The first click on an inactive window only raises it** (section 7).
4. **The menu save-under is a fixed 2 KB at `$E800`** (section 2), which limits a drop-down to about 128 pixels x 11 items.
5. **A moved window is repainted, not copied** (section 9 bounds it). Copying can come later if the drag feels slow.
6. **The key map: TAB and ESC swapped.** CAPS SHIFT + 1 is TAB (14) and CAPS SHIFT + 4 is ESC (27), so PC Tab on the web page
   (which TSRun sends as CAPS SHIFT + 1) gives TAB.
   - **BREAK counts as ESC** everywhere in the window manager: drag, dialog cancel and menus. So PC Escape (BREAK on the
     web page) works as expected.
   - Amends OBJECTS_EVENTS 7. Changed: `src/kernel/keymap.txt`, the check in `tests/kern-model2.mjs`, and the TAB key
     in `tools/xemu/kern3-ref.mjs` and `zesarux-kern3.py`.
   - The rest of the key map draft (the SYMBOL SHIFT layout) stays for the owner to judge in `kern4demo`.
7. **How to run it:** W1, then a stop for the owner to review the window look; then W2 and W3 in one run.

## 14. W1 interface (designed 2026-11-12, binding for the W1 code, model and tests)

Fills in what sections 2-7 and 9-11 leave open for slice W1: the map, the window list, repaint, activation and the focus scope.
The tests are written from sections 1-11 and this section, never from the code.

### 14.1 Files and build

- `src/kernel/wm.asm` (included by `kernel.asm`, inside `K_CODE..K_CODE_END`).
- `src/kernel/classes.txt`:
  - `Group` gains Draw `group_draw`;
  - new classes `Desk : Group` (Draw `desk_draw`), `MenuBar : View` (field `table` 2, Draw `mbar_draw`) and
    `Window : Group` (fields `slot` 1, `title` 2, `focus` 2; Draw `window_draw`, Destroy `window_destroy`).
  - Event methods stay inherited in W1: `Desk` and `Window` route with `group_event`, and `MenuBar`'s is `k_nop`. W2 and W3
    replace them.
- The test cartridge is `src/kern4.asm`, build target `kern4`. Its classes are `src/kernel/classes.txt` and
  `src/kern4-classes.txt`.

### 14.2 Memory (exact; adds to section 2)

| Address | Name | What |
|---|---|---|
| `$F0C0` | `W_DIRTY` | Byte: 0 when no cell is dirty, else 1 |
| `$F0C2` | `K_FSCOPE` | Word: the focus scope (0 = none) |
| `$F100-$F3FF` | `W_MAP` | Section 2 |
| `$F400-$F41F` | `W_SLOTS` | 16 words; owner o's view at `W_SLOTS + 2 o` |
| `$F420` | `W_MODAL` | Word: the open dialog, or 0 (always 0 in W1) |
| `$F422-$F47F` | | W1's internal state (not part of the interface) |
| `$F480-$F4FF` | | Reserved for W3 (menus) |
| `$F500-$FAFF` | | Kernel arena |

### 14.3 Drawing, exactly

Every draw method below leaves `GLH` unchanged. Afterwards `GOP` is undefined, and so is `GA`. Each step list defines the
**pixels**: the code may draw them in another order or with other calls, as long as the result is the same.

- **`desk_draw`:** `GOP` = `CLR`; `G_FILL` (0, 8, 512, 184).
- **`mbar_draw`** (W1; W3 adds the titles): `GOP` = `SET`; `G_FILL` (0, 0, 512, 8).
- **`window_draw`,** with (x, y, w, h) = the view's rectangle, and active = (the window is open and `W_FRONT` returns it):
  1. `SET`: `G_FRAME` (x, y, w, h).
  2. `SET` if active, else `CLR`: `G_FILL` (x + 1, y + 1, w - 2, 7).
  3. `SET`: `G_HLINE` (x + 1, y + 8, w - 2).
  4. When `Window_title` != 0: `XOR` if active, else `SET`. `G_TEXTP` (x + 8, y) of the title's first n' codes. n' is the
     largest count whose `PROP6_W` sum is <= w - 16, so a long title never reaches the right frame.
  5. `CLR`: `G_FILL` (x + 1, y + 9, w - 2, h - 10).
  6. `group_draw`.

  These cover every pixel of the rectangle, so the draw is opaque.
- **`group_draw`:**
  - For each child in list order (from `View_child` along `View_next`): skip it when its flags AND 2 != 0 (hidden);
  - skip it unless its rectangle meets `GCLIP`: w > 0, h > 0, x < x1, x + w > x0, y < y1 and y + h > y0;
  - else `M_DRAW` to it.

  IX is preserved.
- **`window_destroy`:** `W_CLOSE` if `Window_slot` != 0, then `view_destroy`.

### 14.4 The routines, exactly

"Valid rect" means section 3:
- x, y, w and h are multiples of 16, 8, 16 and 8;
- w >= 48 and h >= 16;
- y >= 8, x + w <= 512 and y + h <= 192.

"Under v" means v itself or a view whose `View_parent` chain reaches v.

- **`W_INIT`:**
  1. Saves `K_CURA`; `K_ARENA` kernel.
  2. `K_NEW` `Desk`, with rect (0, 0, 512, 192), flags 0 and id 0.
  3. `K_NEW` `MenuBar`, with rect (0, 0, 512, 8), flags 0, id 0 and table 0.
  4. `K_ADDCHILD` (desk, bar); `K_SETROOT` desk.
  5. `W_MAP`: row 0 = `$8F`, rows 1-23 = `$80`. `W_DIRTY` = 1.
  6. `W_SLOTS`: [0] = desk, [15] = bar, the rest 0. `W_MODAL` = 0, `K_FSCOPE` = 0.
  7. `K_CURA` restored.

  Carry when the kernel arena is full (the state is then undefined). Called once, after `K_AINIT` of the kernel arena.
- **`W_OPEN`** (IX = w). Carry, nothing changed, when:
  - `Window_slot` != 0;
  - the rect is not valid;
  - `W_MODAL` != 0;
  - or slots 1-14 are all taken.

  Else:
  1. old = `W_FRONT`.
  2. Slot s = the lowest free; `W_SLOTS[s]` = w and `Window_slot` = s.
  3. w is linked as the bar's next sibling: w's `View_next` = the bar's old `View_next`, the bar's = w, w's `View_parent` =
     desk.
  4. The map rule.
  5. Activation (old, w).
- **`W_CLOSE`** (IX = w). Carry when `Window_slot` = 0. Else:
  1. If `K_FOCUS` is under w: `K_SETFOCUS` 0 (w's focused view gets `M_BLUR`).
  2. If `K_CAPTURE` is under w: `K_CAPTURE` = 0.
  3. wasfront = (`W_FRONT` = w).
  4. `K_UNLINK` w; `W_SLOTS[slot]` = 0 and `Window_slot` = 0.
  5. The map rule.
  6. If wasfront: `K_FSCOPE` = 0, then activation (0, `W_FRONT`). (When no window is left, activation does nothing and the
     scope stays 0, as section 7 says; amended during W1, the tests found the scope left on the closed window.)
- **`W_RAISE`** (IX = w). Carry when `Window_slot` = 0. Nothing (carry clear) when w is already in front. Else:
  1. old = `W_FRONT`.
  2. w is moved to the bar's next sibling.
  3. The map rule.
  4. Activation (old, w).
- **`W_MOVE`** (IX = w, HL = x, DE = y). Carry when `Window_slot` = 0 or the rect (x, y, w's `View_w`, `View_h`) is not
  valid. Nothing (carry clear) when (x, y) is where w is. Else:
  1. dx = x - w's `View_x`, dy = y - w's `View_y`.
  2. Every view under w gets `View_x` += dx and `View_y` += dy, w first.
  3. The map rule.
  4. Every cell owned by w is damaged.

  The program keeps every view under a window inside the window's rectangle.
- **`W_INVAL`** (`GA`: x, y, w, h, signed words):
  1. Clamp to the screen, as `G_SETCLIP` does, giving [ax, bx) and [ay, by). When either is empty, nothing happens.
  2. Else the cells with columns ax >> 4 .. (bx - 1) >> 4 and rows ay >> 3 .. (by - 1) >> 3 are damaged, and `W_DIRTY` = 1.

  `GA` is unchanged.
- **`W_INVALV`** (IX = v): `GA` = v's rectangle, then `W_INVAL`.
- **`W_UPDATE`:** section 6. Owners are taken in the order bar, the windows in the desk's list order, then desk. `M_DRAW` is
  sent with IX = the view.
  - **Batches.** The rectangles are kept in `W_SAVE` (5 bytes each, at most 396) until they are painted. So when 365 or more
    have been collected at the start of a row (rows are scanned 0 to 23), those are painted first, in section 6's owner order,
    and collection starts again. A run in the new batch never extends a rectangle of an earlier one. Only maps with many
    owners in a row, or damage in a fine pattern, reach this (16 single-cell runs a row is 368 rectangles).
  - At the end:
  - `GCLIP` is the whole screen and the shield is removed;
  - `GOP` and `GA` are undefined;
  - IX is preserved.
- **`W_DRAWVIEW`** (IX = v):
  1. Climb from v along `View_parent` to find o:
     - v is the desk: 0;
     - a view under the bar: 15;
     - a view under an open window: that window's slot;
     - anything else: nothing is drawn.
  2. Nothing is drawn when v, or any view on the way up to o's view, is hidden.
  3. S = the cells with columns x >> 4 .. (x + w - 1) >> 4 and rows y >> 3 .. (y + h - 1) >> 3 of v's rectangle (clamped)
     that o owns.
  4. For each rectangle of S (section 6's order), the clip and the shield are the rectangle's pixels intersected with v's
     rectangle. `M_DRAW` goes to v.
  5. The end state is as `W_UPDATE`'s. Dirty bits and `W_DIRTY` are unchanged.
- **`W_FRONT`:** HL = the bar's `View_next` (0 when no window is open).

**Activation (old, f):** nothing when f = old. Else:
1. If old != 0: old's `Window_focus` = `K_FOCUS` when that is under old, else 0.
2. `K_FSCOPE` = f.
3. Focus:
   - when f = 0: `K_SETFOCUS` 0;
   - else `K_SETFOCUS` (f's `Window_focus`) when that is not 0;
   - if that was 0, or returned carry: `K_SETFOCUS` 0, then `K_FOCUSNEXT`.
4. For each of old and f that is open: the cells of its title row (row y >> 3, columns x >> 4 .. (x + w) >> 4 - 1) that it
   owns are damaged.

**The focus scope (amends OBJECTS_EVENTS 15.3).** R = `K_FSCOPE` when it is not 0, else `K_ROOT`.
- `K_FOCUSNEXT` and `K_FOCUSPREV` are 15.3's walk with R in place of `K_ROOT`, over the tree as if R had no parent and no
  next sibling.
- So the walk stays in R's subtree and wraps to R.
- If `K_FOCUS` is not under R, the walk climbs out, wraps to R and searches R's subtree.
- `K_SETROOT` and `K_ARESET` (when R is in the arena) also clear `K_FSCOPE`.

**`K_GETEV` and `K_DISPATCH` (amend OBJECTS_EVENTS 14.2, 15.2):**
- When both queues are empty and `W_DIRTY` != 0, `K_GETEV` writes `K_EV` = 6, 0, 0, 0 and returns A = 6, carry clear.
- `K_DISPATCH` of type 6 calls `W_UPDATE`. In `kern3`, which never calls `W_INIT`, `W_DIRTY` stays 0, so a posted type 6 does
  nothing there. Step 3's tests that expected it at `K_ROOT` are amended, and the change is recorded in "As built".

### 14.5 Test cartridge `kern4` (W1)

- **Boot** as `kern3` (13.6, 14.7), with these changes:
  - the kernel arena is [`$F500`, `$FB00`) and the app arena [`$C000`, `$E000`);
  - `K_ARENA` app;
  - `W_INIT`;
  - `P_INIT` (500, 180), so the pointer starts clear of the measured rectangles;
  - record state 1, then `T_IDLE`.
- **The same helpers as `kern3`:** `T_RET`, `T_SEND`, `T_EVLOOP` and the ISR.
- **Test classes** (`src/kern4-classes.txt`):

  | Class | Parent | Fields | Methods |
  |---|---|---|---|
  | `TWin` | `Window` | `tag` 1 (size 22) | Draw `t_wdraw`: logs code 1, then `window_draw`. Focus / Blur: log codes 4 / 5 |
  | `TCtl` | `View` | `tag` 1 (size 17) | Draw `t_cdraw`: logs code 2, then `CLR` `G_FILL` of its rect, `SET` `G_FRAME` of its rect, `SET` `G_LINE` (x, y)-(x + w - 1, y + h - 1). Focus / Blur: log codes 4 / 5. Event: logs code 3, carry = tag bit 0 |
  | `TGrp` | `Group` | `tag` 1 (size 17) | Draw `t_gdraw`: logs code 6, `CLR` `G_FILL` of its rect, then `group_draw` |
  | `TNull` | `Group` | (size 16) | Draw `k_nop` (for the overhead bounds) |

- **The log:**
  - `T_LOG` = `$7800`: 128 records of 16 bytes (`$7800-$7FFF`, not displayed in mode 6).
  - `T_LOGN` is a word at `$E090`. Record k is at `T_LOG + 16 (k mod 128)`.
  - A record holds: +0 the code; +1 the tag; +2 IX (word); +4..+11 `GCLIP` (x0, x1, y0, y1); +12..+15 = 0.
  - Test methods preserve IX and IY.
- **Stubs** for direct calls:
  - `T_RAISEUPD` (IX = w): `W_RAISE`, `W_UPDATE`, `RET`;
  - `T_OPENUPD` and `T_CLOSEUPD`: the same with `W_OPEN` and `W_CLOSE`;
  - `T_MOVEUPD` (IX, HL, DE): `W_MOVE`, `W_UPDATE`.
- **Strings** for titles:
  - `T_TITLE1` "Untitled 1" and `T_TITLE2` "Untitled 2" (10 codes each);
  - `T_TITLEL`: 60 codes, for the truncation test.
- **Symbols:** every `W_*` routine and variable, `K_FSCOPE`, `W_DIRTY`, `group_draw`, `desk_draw`, `mbar_draw`,
  `window_draw`, `window_destroy`, every `CL_*`, `M_*` and field `EQU`, the stubs, `T_LOG`, `T_LOGN`, and the step 3
  symbols of 13.6.

### 14.6 How the W1 bounds are measured (section 9)

Direct calls with interrupts off. `P_INIT` is done, and the pointer is at (500, 180), outside every measured rectangle. Windows
are plain `Window`s (not `TWin`) with title `T_TITLE1` or `T_TITLE2` and no children, and the screen is settled (`W_UPDATE`)
before each measured call.

| Measure | How |
|---|---|
| Window raise | A and B at (128, 48, 256, 96); open A then B; `T_RAISEUPD` (A) |
| `W_OPEN` + `W_UPDATE` | A at (128, 48, 256, 96) over the bare desk: `T_OPENUPD` (A) |
| `W_CLOSE` + `W_UPDATE` | the same A, the only window: `T_CLOSEUPD` (A) |
| `W_MOVE` + `W_UPDATE` | A at (0, 8, 256, 96), the only window, to (256, 96): `T_MOVEUPD` |
| `W_INVAL` | (128, 48, 256, 96), then (0, 0, 512, 192), each on a clean map |
| `K_GETEV` | queues empty: `W_DIRTY` = 0 / 1 |
| `W_UPDATE` overhead | the map as `W_INIT` leaves it (every cell dirty: the bar's row and the desk), with `W_SLOTS[0]` and `[15]` pointed at `TNull` views for the call |
| `W_UPDATE` per further rectangle | `TNull` desk and bar, a clean map. T(1): one dirty cell (0, 5). T(16): the cells (0, 5), (2, 5), .. (30, 5). Result (T(16) - T(1)) / 15 |
| `K_FOCUSNEXT` / `K_FOCUSPREV` | 15.5's trees of 32 views (a root and 31 views), built under an open `TWin` that is the scope (the `TWin` as the root, `TCtl` for the views), every start, the worst |
| Stack | `W_UPDATE` of a `TWin` holding a chain of 7 `TGrp`s and a `TCtl` at the bottom, all meeting the clip: the most bytes used below the return address |
| Report | `W_DRAWVIEW` of a 64 x 16 `TCtl` in the front window; `W_INIT`; the kernel arena bytes after `W_INIT`; W1's bytes (`K_CODE_END - K_CODE` growth) |

## 15. Slice M: the Kempston mouse (owner 2026-11-12, before W2)

The owner asked for Kempston mouse support, to make testing easier, with an on/off setting, and approved a change to TSRun.
This section amends OBJECTS_EVENTS 7 and 14.3 (the input ISR). The tests are written from this section and OBJECTS_EVENTS 7,
14, never from the code.

### 15.1 Hardware and emulation

- **Ports** (the Spectrum Kempston mouse; the TS2068 decodes none of them, since A0 = 1 and the low byte is not `$F4`-`$F6` or
  `$FF`):
  - `$FBDF`: the x counter;
  - `$FFDF`: the y counter, which grows as the mouse moves **away from the user** (up the screen);
  - `$FADF`: the buttons, active low: bit 0 right, bit 1 left, bit 2 middle, other bits 1.
  - Counters are 8 bits and wrap.
- **With no mouse,** each port reads `$FF`: no motion, no button.
- **TSRun** (`tsrun/machine.js`, the owner's repository) gains `m.mouse = { attached, x, y, buttons }`:
  - when `attached`, a read of a port whose low byte is `$DF` returns `buttons` when A8 = 0, `x` when A8 = 1 and A10 = 0, and
    `y` when A8 = 1 and A10 = 1;
  - when not attached, such a port reads `$FF` as before;
  - `createMachine` starts it detached, so nothing that exists changes.
- **The test page** (`web/main.js`) gains a "Mouse" switch. While it is on, the page:
  - attaches the mouse;
  - turns host mouse motion over the screen into counter steps of one TS2068 pixel each (x by the screen's 512 columns, y by its
    192 rows, y inverted);
  - turns the host's left and right buttons into bits 1 and 0.

### 15.2 The kernel

- **`K_MOUSE`** (`$F0C4`, byte): 0 off, 1 on. Boot leaves it 0. Programs set it only through **`K_MSET`**:
  - A != 0: the counters are read into the last-seen values, then `K_MOUSE` = 1, so turning it on never moves the pointer;
  - A = 0: `K_MOUSE` = 0, and the mouse's button and motion for the next frame are cleared.
  - Clobbers AF, BC, HL.
- **`K_POLL`, a new step 1b** (after the warp, before the keyboard), only when `K_MOUSE` = 1:
  1. Read x, y and the buttons.
  2. Take mdx = x - the last x and mdy = the last y - y, each as a signed 8-bit difference, and store x and y as the last seen.
  3. The mouse's button mb = the left button.
- **Step 4:** fire is also ORed with mb.
- **Step 5 becomes:** if any of u, d, l, r: s and hold as before; else s = 0 and hold = 0. Then:
  - x = clamp(`K_PX` + 2 s (r - l) + mdx, 0, 511);
  - y = clamp(`K_PY` + s (d - u) + mdy, 0, 191), where up and down together still contribute 0;
  - mdx = mdy = 0 when the mouse is off;
  - the rest of step 5 (store, `pend`, `E_MOVE`) is unchanged.
- **Unchanged:** the right and middle buttons make no events in M, and nothing else in 14.3 changes.
- **Movement is 1:1:** one counter step is one pixel across or one row down, with no acceleration.
- **Internal state:** the warp flag moves to `$F0C5` (next to `K_MOUSE`, so one load tests both). The mouse's last counters
  and this frame's motion are in `$F090-$F0BF`.

### 15.3 Bounds (TSRun, as OBJECTS_EVENTS 8 and 14.8)

| Measure | Bound |
|---|---|
| Every step 3 input bound, mouse off (`K_POLL` idle 300, a key held 900, worst 5,250; whole ISR 12,000) | unchanged |
| `K_POLL`, mouse on, nothing moving or pressed | <= 650 (**EST** 560) |
| `K_POLL`, mouse on, the worst frame (a mouse move with a joystick move, a button change, two new keys) | <= 5,600 |
| Whole frame ISR, mouse on, worst | <= 12,400 |
| `K_MSET` | **report** |
| Bytes added to the always-mapped pool | **report** (counted in step 4's 4,096) |

### 15.4 Tests

1. **TSRun's port decode:**
   - detached: every `$xxDF` port reads `$FF`;
   - attached: the three ports return the right fields, and other odd ports still read `$FF`.
2. **`K_POLL` over frames against the K2 model extended by 15.2:**
   - random mouse motion (including wrap past 255 and steps of +-127), buttons, and these mixed with joystick, keys,
     keyboard-pointer mode and warps;
   - `K_MSET` on and off in the middle of a run (no jump on, no stuck button off);
   - clamping at all four edges.

   The event stream and `K_PX` / `K_PY` must equal the model's, and the pointer must be drawn at the model's position one
   frame later.
3. **With the mouse off,** step 3's `kern-k2` and `kern-perf` pass unchanged.
4. **The bounds** of 15.3, in `tests/kern-perf.mjs`.
5. **Cross-emulator** (report only): whether ZEsarUX 13.0 and Fuse 1.9.1 emulate a Kempston mouse in TS2068 mode. If one does,
   `kern3demo` with the mouse on is checked there.

**Who:**
- TSRun and the page: the main model.
- `K_POLL` and `K_MSET`: the main model.
- The model extension and the tests: a Sonnet agent.
- `kern3demo` turns the mouse on at boot (`K_MSET` 1). `kern3` and `kern4` leave it off for the tests.

## 16. As built

### 16.1 Slice W1 (2026-11-12)

**Result: W1 behaves exactly as the model says (`tests/wm-w1.mjs`, 9 of 9 parts on seeds 6-8 and 11, about 430,000
assertions a seed). Of the W1 bounds, 9 are missed: the window operations, the repaint overhead, `W_INVAL` and the scoped
focus walk. Step 4's byte bound is not yet missed, but W1 alone takes 3,153 of its 4,096 bytes.** Interface: section 14, with
these amendments made during W1:
- 14.3: each step list defines the pixels, not the order of drawing;
- 14.4: `W_UPDATE`'s rectangle batches (the records must be kept until painted, and a pathological map has more than fit);
- 14.4: `W_CLOSE` clears `K_FSCOPE` when the window was in front (the tests found the scope left on the closed window).

| Measure (14.6, `tests/wm-perf.mjs`) | Measured | Bound | Result |
|---|---|---|---|
| **Window raise** (two empty 256 x 96 windows at one place) | **109,082** | <= 80,000 | **MISSED** |
| `W_OPEN` + `W_UPDATE`, 256 x 96 over the desk | **107,007** | <= 80,000 | **MISSED** |
| `W_CLOSE` + `W_UPDATE`, only the desk under it | **80,846** | <= 60,000 | **MISSED** |
| `W_MOVE` + `W_UPDATE`, to a place clear of the old one | **201,368** | <= 140,000 | **MISSED** |
| `W_INVAL` 256 x 96 / the whole screen | **5,842** / 17,799 | <= 5,000 / <= 20,000 | **MISSED** / pass |
| `K_GETEV` empty / `E_REDRAW` returned | 91 / 148 | <= 100 / <= 150 | pass |
| `W_UPDATE` overhead, every cell dirty, `M_DRAW` a `RET` | **59,367** | <= 20,000 | **MISSED** |
| `W_UPDATE` each further rectangle | **2,747** | <= 1,500 | **MISSED** |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, 32 views under a window scope | **11,513** / **18,310** | <= 11,000 / <= 18,000 | **MISSED** |
| Stack, `W_UPDATE` with views 8 deep | 64 bytes | <= 192 | pass |
| `W_DRAWVIEW` of a 64 x 16 control / of a whole 256 x 96 window | 26,470 / 85,145 | report | |
| `W_UPDATE` of the whole screen (desk and bar, no windows) | 207,284 | report | about 3.5 frames |
| `W_INIT`; kernel arena used | 19,073 T; 40 bytes | report | |
| **Bytes:** W1's growth of `K_CODE_END - K_CODE` (`wm.asm` 2,794; the rest in classes, `K_GETEV`, `K_DISPATCH`, the focus walk) | 3,153 | <= 4,096 for all of step 4 | pass so far |

Step 3's figures with W1 in the kernel (`kern-perf`, mouse off): all pass. `K_GETEV` empty takes 92 T (bound 100), and the
scoped walk's cut-and-restore made the unscoped walk slightly faster (`K_FOCUSPREV` 17,910 -> 17,460).

**Why the window operations miss.** The raise, profiled:

| Part | T |
|---|---|
| `window_draw`: the title band and content filled (`G_FILL` 50,445), the frame, the title (`G_TEXTP` 9,066) | 62,665 |
| `W_RAISE`: the map (192 cells, about 53 T each, plus about 330 T a row), activation and the two title rows | 22,296 |
| `W_UPDATE` without the draw: the scan (192 cells at about 64 T), the records, clip, shield, the final clip | 24,094 |

- **The drawing alone is 78 % of the 80,000 bound.** gfx6 fills 254 x 86 pixels in 42,000 T (`SET` and `CLR` alike); the estimate
  assumed `G_FILL`'s whole-screen rate (146 k T for 512 x 192, 34 k here). `window_draw` already fills whole byte columns and
  draws the frame on top, which saved 12,000 T against the literal step list.
- **The rest is the window manager's own overhead.** About 46,000 T against an estimate of 8,000:
  - every cell is read, compared and written one byte at a time;
  - the per-row bookkeeping (`w_rows`, the record lookup, row flags) costs 250-350 T a row.
- **The repaint overhead row** scans and cleans 768 cells at 60-70 T. Even an unrolled `CP (HL)` / `LD (HL),E` loop (about 25 T a
  cell) would give about 25,000 T, so 20,000 is not reachable with one byte a cell.

**Faults the tests found, fixed:**
- The title was never cut: `window_draw` loaded -16 into DE while DE held the title's address.
- `K_FSCOPE` stayed on the last window closed (contract amended above).
- The `kern4` test method logged a `TWin`'s slot as its tag.

The main model's smoke run found `W_OPEN`'s slot search never stopping (`INC L` after `OR (HL)` overwrote the zero flag).

**Tests:**
- `tests/wm-model.mjs`: 73 hand-worked self-checks, including the 364 / 365-rectangle batch edge and a full checkerboard.
- `tests/wm-w1.mjs`:
  - random sequences of every W1 call with invalid requests;
  - after each step, the map, the tree, the focus state and the draw log are compared;
  - the composition and clip-safety checks on every paint;
  - the look of 40 windows against the gfx6 model.
- `tests/wm-perf.mjs`.
- All three were written by a Sonnet agent from sections 1-11 and 14, without reading the code. Six planted model faults are each
  caught.

**Step 3 tests amended** (forced by sections 2 and 14; no code fault):
- `kern-lib` and `kern-k3` no longer poison `$F0C0-$F0CF` (`W_DIRTY`, `K_FSCOPE`).
- `kern-model3`: `Group`'s Draw is now `group_draw`, and a type 6 calls `W_UPDATE`.
- `kern-perf`: the step 3 byte row only reports once step 4 is in the kernel.

**Options for the owner (estimates, not measured):**

| Change | Effect |
|---|---|
| **A.** An overhead pass on W1: unrolled scan and clean, row bookkeeping done once a call, a faster record lookup | Raise and open about 85-90 k, close about 65 k; the overhead row about 25-30 k. About 100-200 bytes more. The window rows still miss |
| **B.** A as a Fable job in its own worktree (as step 3's option D), with `wm-perf` as the measure and `wm-w1` as the guard; the focus walk and `W_INVAL` included | As A, perhaps more; runs beside W2 |
| **C.** After A or B, the window-operation bounds set to the measured figures | Raise, open and close each about 1.5 frames; a move about 2.5 |
| **D.** Draw less: a window's content is not cleared where its children cover it, or the clear is left to the application | 10-35 k less per window, but every control must then be opaque and tile the content, a burden on every app |
| **E.** Bytes: a size pass at the end of step 4, and placing the toolkit is decided at step 5 (`docs/CODE_SIZE.md`). W2 and W3 at about 2 KB would take step 4 to about 5.2 KB, leaving about 4 KB of the pool against 6-9 KB still planned | — |

### 16.2 Slice M, the Kempston mouse (2026-11-12)

**Result: every M bound passes and the machine matches the model (`tests/kern-mouse.mjs`, 11 of 11 parts on seeds 1-6, about
77,000 assertions a seed). With the mouse off, every step 3 input bound is unchanged.**

| Measure (15.3) | Measured | Bound | Result |
|---|---|---|---|
| `K_POLL` idle, mouse off / a key held / worst frame | 294 / 865 / 4,920 | <= 300 / 900 / 5,250 | pass |
| Whole frame ISR, mouse off | 11,239 | <= 12,000 | pass |
| `K_POLL`, mouse on, nothing moving | 565 | <= 650 | pass |
| `K_POLL`, mouse on, worst frame (10,692 frames searched) | 5,263 | <= 5,600 | pass |
| Whole frame ISR, mouse on, worst (5,016 frames) | 11,582 | <= 12,400 | pass |
| Pointer deadline / ISR stack, mouse on | 8,194 / 26 bytes | <= 8,960 / 32 | pass |
| `K_MSET` on / off | 108 / 52 | report | |
| `K_POLL`, mouse on: a move only / the left button only / a move and the button | 1,638 / 874 / 1,952 | report | |

**How it is built:**
- `K_MOUSE` and the warp flag are adjacent, so `K_POLL`'s first `LD HL` tests both (+7 T on the idle path).
- The mouse's button-and-moved byte sits next to keyboard-pointer mode's directions, so step 4 ORs both from one `LD HL` (+7 T).
- Step 5's y is now worked out in 16 bits, so the mouse's dy and the joystick's step clamp once.
- TSRun: `m.mouse` and the `$DF` decode in `tsrun/machine.js` (37 lines). The test page: a Mouse switch with pointer lock.
  `kern3demo` turns the mouse on at boot.

**Tests:**
- `tests/kern-mouse.mjs`:
  - TSRun's decode on all 256 high bytes, through `IN A,(C)` and through the bus;
  - 3,000 direct `K_POLL` / `K_MSET` steps and 800 whole frames a seed against the extended K2 model (`tests/kern-model2.mjs`),
    including counter wrap, warps, keyboard-pointer mode, the pointer lock and the edges;
  - with the mouse off, nothing moves.
- Mouse rows added to `tests/kern-perf.mjs`.
- Written by a Sonnet agent from section 15 without reading the code. Three planted model faults were each caught.
- Its readings: a counter difference of 128 reads as -128; a second `K_MSET 1` drops motion since the last poll; a pending warp
  is applied before the mouse's motion.

**Step 3 test fixes made with M:**
- `kern-k2` treats `$F0C5` (the warp flag's new place) as internal.
- One `kern-k2` check computed tail - head without `AND 255`. It was a latent fault that first showed when the ring indices
  wrapped (seed 9).

**Not run:** 15.4 test 5. Whether ZEsarUX 13.0 and Fuse 1.9.1 emulate a Kempston mouse in TS2068 mode is still unchecked.

**Owner's test in a browser (2026-11-12, `web/?cart=kern4demo` on TSRun):**
- the pointer followed the host mouse, and Esc released it;
- a window could be dragged;
- a menu opened on a click;
- the counter updated on clicks.

No issues were noted.

### 16.3 Owner decisions after W1 (2026-11-12)

- **The window look** (14.3, the W1 screen) is approved as it is.
- **Speed: B then C.**
  - B: a Fable agent cuts W1's overhead in its own worktree, with `wm-perf` as the measure and `wm-w1` as the guard.
  - C: then the window-operation bounds (raise, open, close, move) become the measured figures, rounded up.
  - The other W1 bounds stay as section 9 has them; any still missed after B are recorded with the figures.
- **A size pass at the end of step 4** (section 9's 4,096 bytes). Where the toolkit goes is decided at step 5.
- W2 goes on beside B. Its code is in `src/kernel/wm2.asm`, so the two touch different files.
- **The key map and the arrow** (owner, 2026-11-12, after trying `kern4demo`): the pointer arrow (OBJECTS_EVENTS 14.6) is
  approved. The SYMBOL SHIFT layout of `src/kernel/keymap.txt` stays as drafted until a step needs those characters (step 5's
  text editing). This closes step 3's deferred review.

### 16.4 Slice W2 (2026-11-12)

**Result: W2 behaves exactly as the model says (`tests/wm-w2.mjs`, 11 of 11 parts on seeds 1-12, 77-80 and 91, about 55,000
assertions and 7,000 frames a seed, including the 4-frame click flash frame by frame). Three of its bounds are missed.**

Amendments made during W2:
- 17.3 / 17.5: Button's Blur is `button_blur`, which draws without the focus look. `M_BLUR` comes before the focus changes,
  and the first build left the underline on the button that lost the focus (seen by the main model in a screenshot).
- 17.5: a button's text must fit (the test agent found the overflow).
- Section 2 / 18.6: the kernel's second part (`kernel1.asm`) is in chunk 1, because the kernel outgrew chunk 5.

| Measure (17.7) | Measured | Bound | Result |
|---|---|---|---|
| Drag step: `w_outline` 256 x 96 twice | **31,622** (15,811 each) | <= 25,000 | **MISSED** |
| `E_MOVE` through the desk and the front window to the last of 8 controls | **3,885** | <= 3,500 | **MISSED** |
| `E_DOWN`, the same, focus moving | **5,685** | <= 4,500 | **MISSED** |
| `button_draw` 64 x 16: normal / pressed / default / focused / all three | 21,522 / 28,793 / 31,141 / 22,761 / 39,651 | report | |
| `W_DRAWVIEW` of a pressed button; a key click without its 4 frames | 36,574; 69,299 | report | |
| `W_DRAG`, from the `E_DOWN` to the first outline | 3,256 | report | |
| Stack during a drag (ISR included) | 46 bytes | <= 192 | pass |
| Bytes: `wm2.asm` | 1,217 | (step 4's 4,096) | |

**Why they miss:**
- **A drag step** is two outlines. Each has four sides, and each side has its own shield (about 820 T a side); the two
  vertical sides are 94-row `G_FILL`s (about 3,900 T each). One step still takes about half a frame, and the owner's drag in
  the browser felt fine.
- **`E_MOVE` and `E_DOWN`** pay for two routing levels over step 3's figures: the desk's `desk_event` and the window's
  `window_event` before `group_event`. With the focus moving, they also pay for the redraws of `M_BLUR` and `M_FOCUS`.

**Options (estimates):**
- Shield the outline once, as its bounding rectangle, when the pointer is outside it: about 2,400 T less a step. The rectangle
  always meets the pointer during a drag, so this needs a test of the pointer's own rectangle first.
- Route `E_MOVE` from the desk straight to `group_event` (about 150 T).
- Or set these three bounds to the measured figures with C.

**Tests** (written by a Sonnet agent from sections 1-11, 14, 15 and 17, without reading the code):
- `tests/wm-model2.mjs`: 83 hand-worked self-checks.
- `tests/wm-w2.mjs`: the CPU runs `T_APPLOOP` with the mouse and keys. At every idle point it compares the map, the tree, the
  focus, the capture, the modal state, the `E_CMD` log and the whole screen (the drag outline included).
- Three planted model faults were each caught.

**The main model's runs:**
- a scripted session (click to raise, drag with snapping, ESC, buttons pressed and dragged off, modal refusals, ENTER /
  BREAK in a dialog);
- `wm-w1`, `kern-k1` to `kern-k3` and `kern-mouse` after W2: all pass.

## 17. W2 interface (designed 2026-11-12, binding for the W2 code, model and tests)

Fills in what sections 4, 5, 7 and 9-11 leave open for slice W2:
- window clicks and the outline drag;
- dialogs and the modal rule;
- `Button`, `Label` and `E_CMD`.

The tests are written from sections 1-11, 14, 15 and this section, never from the code.

### 17.1 Files, classes, constants

- **Code:** `src/kernel/wm2.asm`, included by `kernel.asm` after `wm.asm`.
- **Classes** (`src/kernel/classes.txt`):

  | Class | Change |
  |---|---|
  | `Desk` | Event `desk_event` |
  | `Window` | Event `window_event` |
  | `Dialog : Window` (new) | Fields `default` 2 and `cancel` 2 (size 25); Draw `dialog_draw`, Event `dialog_event` |
  | `Button : View` (new) | Field `text` 2 (size 18); Draw `button_draw`, Event `button_event`, Focus `button_fb`, Blur `button_blur` |
  | `Label : View` (new) | Field `text` 2 (size 18); Draw `label_draw` |

  A class "is a Dialog" when `CL_Dialog` is on its parent chain (descriptor offset -6).
- **Constants:**
  - `E_CMD` = 10;
  - the keys ENTER 13, ESC 27, BREAK 3, SPACE 32, MENU 16;
  - `Button` flags: bit 3 pressed, bit 4 default.

### 17.2 Amendments to W1's routines (section 14.4)

- **`W_OPEN`:** a window that is a Dialog sets `W_MODAL` to itself (after activation).
- **`W_CLOSE`:** `W_MODAL` = 0 when it was this window (before activation).
- **`W_RAISE`:** carry (nothing changed) when `W_MODAL` != 0 and the window is not `W_MODAL`.

### 17.3 Events

The point of a pointer event is (x, y) = (data 1 + 256 (data 3 AND 1), data 2). "In the title bar" of a window at (wx, wy)
means wy <= y < wy + 9.

- **`desk_event`** (Desk's `M_EVENT`):
  - **`E_KEY`:** not consumed. W3 adds the MENU key.
  - **`E_DOWN`, `E_MOVE`, `E_UP` while `W_MODAL` = d != 0:**
    - the point inside d's rectangle: `M_EVENT` to d, and the desk returns d's carry;
    - else: consumed, nothing else happens.
  - **Everything else:** `group_event`.
- **`window_event`** (Window's `M_EVENT`, IX = the window, not a Dialog):
  - **`E_DOWN` and the window is not `W_FRONT`:** `W_RAISE`. Then, if the point is in the title bar, `W_DRAG`. Not consumed.
  - **`E_DOWN` on the front window, in the title bar:** `W_DRAG`. Not consumed.
  - **Otherwise:** `group_event`.
  - "Not consumed" here means no view takes the capture after a raise or a drag: the drag has already taken the button's
    release.
- **`dialog_event`** (Dialog's `M_EVENT`):
  - **`E_KEY` with data 1 = 13:** when `Dialog_default` != 0, a click of that button; consumed.
  - **`E_KEY` with data 1 = 27 or 3:** when `Dialog_cancel` != 0, a click of that button; consumed.
  - **Everything else:** `group_event`. A dialog has no title bar, and it is always in front, so it is never raised or dragged.
- **`button_event`** (IX = the button):
  - **`E_DOWN`:** pressed = 1, `W_DRAWVIEW`; consumed. Routing then makes it the capture.
  - **`E_MOVE` while `K_CAPTURE` = the button:** in = the point is inside its rectangle; when in != pressed: pressed = in,
    `W_DRAWVIEW`. Consumed.
  - **`E_MOVE` otherwise:** not consumed.
  - **`E_UP`:** if pressed: pressed = 0, `W_DRAWVIEW`, then `E_CMD` is posted. Consumed either way.
  - **`E_KEY` with data 1 = 13 or 32:** a click; consumed. Other keys are not consumed.
- **A click of button b:**
  1. pressed = 1, `W_DRAWVIEW` b;
  2. four `HALT`s (four frames; interrupts must be on);
  3. pressed = 0, `W_DRAWVIEW` b;
  4. `E_CMD` is posted.
- **`E_CMD`** is posted with `K_POST` (A = 10, C = b's `View_id`, E = the slot of the window b is in, D = 0). The slot is 0 when
  b is not in an open window. When the posted queue is full, the event is lost.
- **`button_fb`** (Focus) and **`button_blur`** (Blur): `W_DRAWVIEW` of the button, so the focus look follows the focus.
  - During `M_BLUR`, `K_FOCUS` still points at the button (OBJECTS_EVENTS 5 sends `M_BLUR` before it changes the focus).
  - So `button_blur` draws the button **without** the focus look. (Amended during W2: the first build left the underline on
    the button that lost the focus.)

### 17.4 `W_DRAG` (IX = a window; called on an `E_DOWN` that is in `K_EV`)

1. `W_UPDATE`. The start is (sx, sy) = the window's (x, y), and the press p0 = the point of the `E_DOWN` in `K_EV`.
2. The candidate c = the start. No outline is drawn yet.
3. Loop: `K_GETEV`; carry: `HALT` and loop again. Then by type:
   - **`E_MOVE` or `E_UP`,** at point p:
     - the new candidate is cx = sx + 16 floor((px - p0x + 8) / 16) and cy = sy + 8 floor((py - p0y + 4) / 8);
     - cx is clamped to [0, 512 - w] and cy to [8, 192 - h];
     - when it differs from c: the outline at c is erased (if it is drawn), c = the new candidate, and the outline is drawn at c
       unless c is the start.
     - On `E_UP`: the outline is erased (if it is drawn); if c != the start, `W_MOVE` (c); the drag ends.
   - **`E_KEY` with data 1 = 27 or 3:** the outline is erased (if it is drawn); the drag ends with no move.
   - **Anything else:** dropped.
4. **The outline at (x, y)** is the XOR of the pixels `G_FRAME` (x, y, w, h) would set, each exactly once:
   - each of its four sides is drawn between its own `P_SHIELD` and `P_UNSHIELD`: top (x, y, w, 1), bottom (x, y + h - 1, w, 1),
     left (x, y + 1, 1, h - 2) and right (x + w - 1, y + 1, 1, h - 2);
   - the clip is the whole screen;
   - erasing draws it again.
   - Exported as **`w_outline`** (IX = the window, HL = x, DE = y) for the measurement.
5. At the end, `GOP` is undefined and the clip is the whole screen. `W_DRAG` preserves IX.

### 17.5 Drawing (exact pixels; the order of drawing is free, 14.3)

- **`dialog_draw`,** with (x, y, w, h) the dialog's rectangle:
  1. `CLR` fill (x, y, w, h);
  2. `SET` frame (x, y, w, h);
  3. `SET` frame (x + 4, y + 2, w - 8, h - 4);
  4. `group_draw`.

  The content area is inside the inner frame.
- **`button_draw`,** with (x, y, w, h) the button's rectangle, and tw = `G_TEXTW` of its text (0 with no text):
  1. `CLR` fill (x, y, w, h); `SET` frame (x, y, w, h).
  2. Default (bit 4): `SET` frame (x + 2, y + 1, w - 4, h - 2).
  3. The text, `SET`, by `G_TEXTP` at (tx, ty), where tx = x + floor((w - tw) / 2) and ty = y + floor((h - 8) / 2).
  4. Focused (`K_FOCUS` = the button, except while it is drawn by `button_blur`): `SET` `G_HLINE` (tx, ty + 8, tw).
  5. Pressed (bit 3): `XOR` fill (x + 1, y + 1, w - 2, h - 2).

  **The text must fit:** tw <= w - 4 and h >= 10 (binding on programs; amended during W2). A wider text would draw outside
  the button's rectangle, and `W_DRAWVIEW`, clipped to that rectangle, could not clean it up.
- **`label_draw`:**
  1. `CLR` fill of its rectangle.
  2. Flags bit 3 clear: `SET` `G_TEXTP` at (x, y). Set: `SET` `G_TEXT8` at column x / 8, row y / 8.

### 17.6 Test cartridge `kern4` (W2 additions)

- **`T_APPLOOP`:** a program's event loop, entered with a jump; it never returns.
  - `EI`; `K_GETEV`; carry: `HALT`, again.
  - Type 7 (`E_MENU`) or 10 (`E_CMD`): the 4 bytes are appended to `T_EVLOG` (`$5800`, 512 records; the count is `T_EVN`).
  - Else `K_DISPATCH`.
- **`T_EVONE`:** `K_GETEV`; carry: return; else `K_DISPATCH`, return.
- **Strings:** `T_SOK` "OK" and `T_SCANCEL` "Cancel", for buttons.
- **Symbols:** add `desk_event`, `window_event`, `dialog_event`, `button_event`, `button_draw`, `label_draw`, `dialog_draw`,
  `button_fb`, `W_DRAG`, `w_outline`, `K_MSET`, `CL_Dialog`, `CL_Button`, `CL_Label`, the field `EQU`s, `T_APPLOOP`,
  `T_EVONE`, `T_EVLOG`, `T_EVN`.
- **The mouse** (section 15) is the easiest way for tests to drive the pointer: `K_MSET` 1 with TSRun's mouse attached.

### 17.7 How the W2 bounds are measured (section 9)

| Measure | How |
|---|---|
| Drag step | `w_outline` of a 256 x 96 window at (128, 48), then at (144, 48): the sum of the two calls, with the pointer at (500, 180) |
| `E_MOVE`, the every-frame path | The desk, a bar, three open windows; the front window (256 x 96) holds 8 `TCtl` children side by side (24 x 16), all focusable; `K_CAPTURE` = 0; the point in the last child: `T_EVONE` stepped until PC = `t_event`; T from `T_EVONE`'s first instruction |
| `E_DOWN`, focus moving | The same tree, the focus on the first child, the point in the last: to `t_event` of the last |
| Report | `button_draw` 64 x 16 (normal, pressed, default and focused); a key click (excluding the 4 frames); `W_DRAG` from the `E_DOWN` to the first outline drawn |

## 18. W3 interface (designed 2026-11-12, binding for the W3 code, model and tests)

Fills in what sections 5, 7 and 8 leave open for slice W3: the menu bar, the drop-downs, both kinds of tracking and `E_MENU`.
Then the demo. The tests are written from sections 1-11, 14, 15, 17 and this section, never from the code.

### 18.1 Files, classes, memory

- **Code:** `src/kernel/menu.asm`.
- **Classes:** `MenuBar`'s Draw stays `mbar_draw` (now with the titles) and its Event becomes `mbar_event`.
- **Memory:** `$F480-$F4EF` (the W3 area, internal), holding:
  - the table pointer and the menu count;
  - for each menu: its record, its title box x and width, the drop-down's x, width and height, and its enable bits;
  - the tracking state.
- **The save-under** is `W_SAVE` (`$E800`), as section 2 says.

### 18.2 Layout (computed by `MB_SET`; tw = `G_TEXTW` of a string, in pixels)

- **Title boxes:** box 0 starts at x = 8. Box i is tw(title i) + 16 wide, and box i + 1 starts where box i ends. The title text is
  at (box x + 8, 0).
- **Drop-down of menu i,** with n items:
  - width W = (the widest item's tw) + 24, height H = 10 n + 2;
  - x = the box's x, or 512 - (W + 2) when that is smaller (the shadow stays on the screen);
  - its rectangle is (x, 8, W, H);
  - item k occupies rows 9 + 10 k .. 18 + 10 k, and its text is at (x + 8, 10 + 10 k).
- **What `MB_SET` refuses** (carry, nothing changed):
  - a count outside 1..8, or a menu with 0 or more than 15 items;
  - titles whose last box ends past 512;
  - a drop-down whose save-under could need more than 2,048 bytes: 4 + ((W + 2 + 7) >> 3 + 1) x (H + 1) > 2,048, whatever its
    x.
- **On success,** each item's enable bit is set from its flags (bit 0 disabled at start; a separator is never enabled), and
  the bar's cells are **damaged**. The bar is drawn at the next `W_UPDATE`. (This amends section 5's "draws the bar".)
- **`MB_SET` 0** removes the menus: the bar is damaged, and the MENU key does nothing.

### 18.3 Drawing (exact pixels; the order of drawing is free)

- **`mbar_draw`:** `SET` fill (0, 0, 512, 8); then each title, `XOR`, by `G_TEXTP` at (box x + 8, 0).
- **Opening menu i** (shielded on the save-under's rectangle):
  1. `G_SAVERECT` (x, 8, W + 2, H + 1) into `W_SAVE`;
  2. `CLR` fill (x, 8, W, H); `SET` frame (x, 8, W, H);
  3. the shadow: `SET` fill (x + W, 10, 2, H - 1) and `SET` fill (x + 2, 8 + H, W, 1);
  4. each item k:
     - a separator: `SET` `G_HLINE` (x + 1, 13 + 10 k, W - 2);
     - else its text, `SET`, at (x + 8, 10 + 10 k);
     - a disabled item: then `CLR` fill (x + 8, r, tw, 1) for r = 11, 13, 15 and 17 + 10 k (every second row of the glyphs:
       the dimmed look);
  5. the title box inverted: `XOR` fill (box x, 0, box width, 8), shielded on its own.
- **A highlight** on item k: `XOR` fill (x + 1, 9 + 10 k, W - 2, 10), shielded on its own. Removing it draws it again.
- **Closing:** a highlight is removed first if shown; then `G_RESTRECT` (`W_SAVE`) and the title box `XOR`ed again, each
  shielded.

### 18.4 Tracking

Tracking is a loop inside the kernel: `K_GETEV`; carry: `HALT`. At most one menu is open. h is the highlighted item, or none.
- **Enabled** means the item's enable bit is set; a separator never is.
- An item's **hit** area is x + 1 <= px < x + W - 1 and 9 <= py < 9 + 10 n.

**By pointer.** `mbar_event` handles an `E_DOWN` whose point is on a title box: that menu opens and tracking starts. An `E_DOWN`
elsewhere on the bar is not consumed, and nothing opens. In the loop:
- **`E_MOVE` at p:**
  - p on another title box: the open menu closes and that one opens (h = none);
  - p in an item's hit area: h becomes that item when it is enabled, else none;
  - anywhere else: h = none;
  - the highlight is redrawn only when h changes.
- **`E_UP`:** the menu closes. If h was an item, `E_MENU` (menu id, item id, 0) is posted. Tracking ends.
- **`E_KEY` ESC (27) or BREAK (3):** the menu closes; tracking ends.
- **Anything else** is dropped.

**By keyboard.** `desk_event` handles an `E_KEY` MENU (16) when `W_MODAL` = 0 and menus are set: consumed, and tracking starts.
- **Opening:** the first menu with an enabled item opens, with h = its first enabled item. With none, nothing opens and tracking
  does not start.
- **LEFT (8) / RIGHT (9):** the previous / next menu, wrapping, with h = its first enabled item (none if it has none).
- **UP (11) / DOWN (10):** h = the previous / next enabled item, wrapping. Nothing when there is none.
- **ENTER (13):** as `E_UP` (choose h if set; close).
- **ESC, BREAK or MENU:** close.
- **`E_DOWN` at p:**
  - on a title box: that menu opens if it is not the open one; tracking continues by pointer;
  - in the open menu's hit area: h as for `E_MOVE`; tracking continues by pointer;
  - elsewhere: close.
- **Anything else** (moves included) is dropped.

**`E_MENU`** is posted with `K_POST` (A = 7, C = the menu's id, E = the item's id, D = 0).

### 18.5 Routines (adds to section 5)

| Routine | In | Out / effect |
|---|---|---|
| `MB_SET` | HL = table (section 8) or 0 | 18.2. Clobbers AF, BC, DE, HL; GA |
| `MB_ENABLE` | A = menu index, C = item index, B = 0 / 1 | The enable bit (a separator stays disabled). Nothing for an index out of range. Clobbers AF, HL |
| `MB_KEY` | | The keyboard tracking (called by `desk_event`); exported for tests |

### 18.6 Test cartridge `kern4` (W3 additions) and the demo

- **`kern4` gains `T_MENUS`,** a table of 3 menus: "Leap" (2 items), "File" (5 items, one separator, one disabled) and "Edit"
  (4 items). Tests set it with `MB_SET`.
- **`kern4demo`** (`DEMO = 1`; section 11):
  - the menus "Leap", "File" and "Window";
  - the windows "Text" and "Buttons";
  - the About dialog;
  - the mouse on.
  Its main loop handles `E_MENU` and `E_CMD`, and dispatches the rest.
- **Symbols:** add `MB_SET`, `MB_ENABLE`, `MB_KEY`, `mbar_event`, `T_MENUS`, `T_MENU8`, `D_MAIN` (demo), `D_COUNT`, `D_TEXT`,
  `D_BUTTONS`, `D_ABOUT`.
- **Amends section 11 and section 10's test 10** (W3, 2026-11-12): `kern4` has no `T_SELFTEST4`. Its random tests cover more
  than a fixed script would. The cross-emulator check compares `kern4demo`'s screen with TSRun's, byte for byte:
  - settled after boot;
  - after a fixed key script, each step's settled screen: MENU, LEFT, ENTER (LEFT wraps to "Window"; its first item brings
    "Text" to the front); then MENU, ENTER to open the About dialog; then ENTER to close it.
  The keys are sent through ZRCP on ZEsarUX; Fuse checks the boot screen only, as for `kern3demo`.
- **The kernel's second part:** chunk 5 is full, so `src/kernel/kernel1.asm` (the menus, `menu.asm`) is assembled by each
  cartridge in chunk 1 after the gfx6 tables. It is always mapped too, and its bytes (`K1_CODE_END - K1_CODE`) count with
  `K_CODE`'s. The test cartridges' own code moved into chunk 1 as well (section 2 allowed it), except `kern3`'s self-test and
  demo (`kern3k3.asm`), which stay in chunk 5.

### 18.7 How the W3 bounds are measured (section 9)

| Measure | How |
|---|---|
| Menu open | `T_MENUS`, menu "File" set to 8 items about 96 pixels wide (a variant table `T_MENU8`), pointer at (500, 180): from `mbar_event`'s first instruction (`E_DOWN` on the title in `K_EV`) to the loop's first `K_GETEV` |
| Menu close | From the `E_UP` taken by the loop (no item highlighted) to `mbar_event`'s return |
| Highlight moved | From the `E_MOVE` taken by the loop, one item to the next, until the loop's next `K_GETEV` |
| Report | `MB_SET` of `T_MENUS`; the bar's repaint; a choice from `E_UP` to `E_MENU` posted |

### 16.5 Speed pass B and decision C (2026-11-12)

**B** (Fable agent, worktree `wm-speed`; merged and re-run by the main model). W1's overhead was cut; 94 bytes were added
(W1's growth 3,153 -> 3,247).

| Row | Before | After B | Bound | Result |
|---|---|---|---|---|
| Raise / open / close / move | 109,082 / 107,007 / 80,846 / 201,368 | 89,500 / 88,044 / 62,412 / 167,402 | C: 90,000 / 89,000 / 63,000 / 168,000 | pass |
| `W_INVAL` 256 x 96 / whole screen | 5,842 / 17,799 | **4,977** / 16,437 | <= 5,000 / 20,000 | pass |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, scoped | 11,513 / 18,310 | **10,525** / **16,471** | <= 11,000 / 18,000 | pass |
| The same, unscoped (`kern-perf`) | 10,655 / 17,460 | 9,730 / 15,684 | <= 11,000 / 18,000 | pass |
| `W_UPDATE` overhead, every cell dirty | 59,367 | **30,646** | <= 20,000 | **MISSED** |
| `W_UPDATE` per further rectangle | 2,747 | **2,235** | <= 1,500 | **MISSED** |

**What B changed:**
- **One unrolled run chain** (`CP (HL)` / `RET NZ` / `LD (HL),E` / `INC L`, 23 T a cell) now serves:
  - the map operations;
  - the repaint scan;
  - `W_DRAWVIEW`'s scan.
- **`W_INVAL`** has a fast path for on-screen rectangles.
- **`W_UPDATE` writes `GCLIP` directly.** A record is always on the screen, so this gives what `G_SETCLIP` would. It ties
  `wm.asm` to `GCLIP`'s layout, as `w_meets` already was.
- **Row prediction:** a row that continues the row above's single run extends its record without a lookup.
- **Shared clamping.**
- **The focus walk:**
  - links are tested by their high byte (a view is never in page 0);
  - flags are decoded once per view.

**Why the two rows still miss** (B's analysis, which the main model accepts):
- **The overhead row:** reading and comparing every cell costs at least 23 T, and there are 768 cells: about 17,700 T before
  any per-row cost. The contract's two shields add about 2,600. So 20,000 cannot be reached with one byte a cell.
  - The cheapest way past it is a per-row window count, kept by the window operations, so that rows wholly owned by the desk
    are cleaned by a write-only chain: about 120 bytes for about 18,500 T less.
- **The per-rectangle row:** each rectangle's own `P_SHIELD` / `P_UNSHIELD` and its `M_DRAW` dispatch cost about 915 T, which
  the contract fixes. The window manager's part is about 1,320 T.
  - 1,500 needs a cheaper shield in gfx6, or one shield per owner instead of one per rectangle (a contract change).

**After the merge:**
- **A latent fault closed** (found by B): a pointer in `W_OPENAT` is trusted by its range alone, and the menus' save-under can
  leave garbage there. `w_openz` clears it in `W_INIT` and whenever a menu closes (10 bytes, about 1,500 T a close).
- **Tests:** every suite passes on new seeds:
  - `wm-w1` 21, 22; `wm-w2` 21; `wm-w3` 21, 22;
  - `kern-k1`, `kern-k2`, `kern-k3`, `kern-hit`, `kern-mouse` 21;
  - `kern-perf` 21: no bound missed.

### 16.6 Slice W3 and the demo (2026-11-12)

**Result: W3 behaves exactly as the model says (`tests/wm-w3.mjs`, 10 of 10 parts on seeds 21 and 22, about 89,000
assertions a seed). The checks include:**
- every drop-down pixel;
- the screen after closing equals the screen before opening, byte for byte;
- both kinds of tracking;
- `E_MENU`;
- the modal rule.

**`kern4demo`** is the PoC milestone:
- **Cross-emulator:** it matches TSRun byte for byte on ZEsarUX 13.0 (23 of 23 rows, after boot and after each step of the key
  script) and on Fuse 1.9.1 (5 of 5 rows, the boot screen).
- **The owner's browser test** (16.2) found no issues.

| Measure (18.7) | Measured | Bound | Result |
|---|---|---|---|
| Menu open, 8 items, 96 pixels wide | **138,090** | <= 100,000 | **MISSED** |
| Menu close, no choice | 26,061 | <= 30,000 | pass |
| Highlight moved to the next item | **14,298** | <= 8,000 | **MISSED** |
| A choice, `E_UP` to `E_MENU` posted / `MB_SET` of `T_MENUS` / the bar's repaint (3 titles) | 34,718 / 25,680 / 30,057 | report | |
| Stack, tracking | 28 bytes | <= 192 | pass |
| **Bytes, step 4 in all:** `K_CODE` growth + `K1_CODE` (W1 3,247, W2 1,217, W3 1,674, classes and the rest) | **6,308** | <= 4,096 | **MISSED** |

**Faults the W3 tests found, fixed:**
- An `E_DOWN` on a drop-down's frame during keyboard tracking did not close it. The code tested the whole drop-down, not 18.4's
  hit area.
- `T_MENU8`'s data had two wrong length bytes.
- **The contract contradicted itself:** section 2's example "96 pixels wide with 15 items" breaks 18.2's save-under rule.
  Corrected to 94.

**Why the menu rows miss:**
- **Opening** costs eight proportional item texts (about 50 k at 682 T a glyph), the save-under (about 25 k), the paper fill,
  the frame and the shadow, and the title box. The estimate assumed fewer glyphs and no shadow.
- **A highlight move** is two `XOR` fills of 94 x 10, each shielded on its own, plus the hit test.

**Options:**
- Set the bounds to the measured figures.
- Or, for the highlight: one shield over both items when they are adjacent, about 1,500 T less.

**The kernel's size.** Chunk 5 overflowed during W3, so the menus (`kernel1.asm`) are assembled in chunk 1 (18.6). Free
bytes left: about 600-700 in chunk 1 and 400-1,300 in chunk 5, depending on the test cartridge.

### 16.7 Owner decisions after W3 (2026-11-12)

- **The seven bounds missed after B** become the measured figures, rounded up (section 9 and `tests/wm-perf.mjs`):

  | Measure | Bound now | Was |
  |---|---|---|
  | `W_UPDATE` overhead | 31,000 | 20,000 |
  | Each further rectangle | 2,300 | 1,500 |
  | Drag step | 32,000 | 25,000 |
  | `E_MOVE` | 3,900 | 3,500 |
  | `E_DOWN` | 5,700 | 4,500 |
  | Menu open | 139,000 | 100,000 |
  | Highlight move | 14,500 | 8,000 |

  None is noticeable in use, and each speed-up would cost bytes, which are now scarcer.
- **Step 4 is committed** as it stands, with TSRun's mouse in its own repository first.
- **Then a size pass by a Fable agent** in a worktree: the fewest bytes, every test as the guard, and no speed bound made
  worse. Its result becomes step 4's byte bound. Where the toolkit and apps go (banked chunks) is decided at the start of
  step 5.

### 16.8 The size pass (2026-11-12)

A Fable agent ran the pass in worktree `wm-size` (commit `ef02475`). The main model applied it and re-ran everything.

**Step 4's bytes: 6,308 -> 4,837 (-1,471, -23 %), which becomes the bound (4,850, 16.7). Every test and every speed bound
passes.**

| Part | Before | After |
|---|---|---|
| `menu.asm` (chunk 1) | 1,686 | 1,158 |
| `wm2.asm` | 1,266 | 831 |
| `wm.asm` (its two chains now in `kernel.asm`) | 2,974 | 2,619 |
| Step 3's `kernel.asm` / `events.asm` / `focus.asm` | 561 / 1,241 / 670 | 506 / 1,182 / 639 |
| Classes | 170 | 162 |
| **Kernel in all** (`K_CODE` + `K1_CODE`, the key map included) | **8,688** | **7,217** |

- **The pool:** about 4,500 bytes of the always-mapped pool are left for step 5 (9,345 before step 4, less step 4's 4,837,
  plus step 3's 145 saved).
- **The test cartridges:** they have 900-1,200 bytes free in chunk 1 and 1,070-2,130 in chunk 5.

**Speed** (`tests/wm-perf.mjs`, `kern-perf`): no bound missed. The figures nearest their bounds:

| Measure | Measured | Bound |
|---|---|---|
| Raise | 89,476 | 90,000 |
| `W_INVAL` 256 x 96 | 4,983 | 5,000 |
| `K_FOCUSNEXT`, scoped | 10,893 | 11,000 |
| `E_DOWN` | 5,667 | 5,700 |
| `K_POLL` idle | 294 | 300 |

`K_POLL`'s worst frame and the whole ISR got faster (4,920 -> 4,712; 11,239 -> 11,055).

Some reported figures got slower: `W_INIT` 20,652 -> 38,656, `MB_SET`, `MB_ENABLE`, `K_WARP` 184 -> 282.

**Amendments that came with it:**
- **14.4:** `W_INIT` also leaves `GA` undefined (it damages the screen through `W_INVALV`).
- **17.1 / 18.1:** the internal state moved within the window manager's page `$F400-$F4FF`. W2's scratch is at `$F470-$F478`;
  the menus' working copy of one menu's entry is at `$F4F0-$F4FC`. Neither is part of the interface.
- **`K_SCRATCH`:** +4..+7 are 0 between focus walks (boot zeroes them, and the walk leaves them zero).
- **17.3:** `window_event` now checks the title bar even when `W_RAISE` refused, which is the contract's literal text. The case
  cannot arise through the desk's modal rule.

**What else could be saved** (estimates; B's report):

| Change | Bytes | Cost |
|---|---|---|
| RST `$18`-`$30` for the commonest calls | about 70 | No T; four RST vectors of page 0 |
| Contract changes: the drag outline as one shielded `G_FRAME`, `W_DRAWVIEW` clipped to cells only, no drop-down shadow, titles cut by the clip | 40-75 each | — |
| `MB_SET` / `MB_ENABLE` banked into chunk 6 | about 330 | A trampoline a call |
| Four more | 20-80 each | Each misses a speed bound |

**Tests:**
- **The agent:** every suite on seeds 1-2 and more, `review-inject` / `review-kpoll`, `web-smoke`, and the TSRun references.
- **The main model, after applying it:**
  - `wm-w1` 31, 32; `wm-w2` 31; `wm-w3` 31, 32;
  - `kern-k1`, `k2`, `k3`, `hit`, `mouse` and `gfx6-s4` 31;
  - `kern-perf` 31 and `wm-perf`;
  - `kern4-ref` and `kern3-ref`;
  - ZEsarUX 13.0, 23 of 23 rows; Fuse 1.9.1, 5 of 5 rows.

