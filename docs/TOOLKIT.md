# Toolkit: contract (draft 1, 2026-11-12, owner approved)

Roadmap step 5 (`docs/FEASIBILITY.md`): the controls the shell, Write and later programs need, beside the kernel's `Button`
and `Label` (`docs/WINDOWS.md` 4). They live in the always-mapped pool (`docs/BANKING.md` 3, decision 1), so `W_UPDATE`
draws them with no crossing, whichever program owns them. Marks as in FEASIBILITY: **EMU** measured, **EST** estimated.

Style as `docs/WINDOWS.md`: every number in section 7 is a bound. **A missed bound is reported with its numbers before anything
is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

## 1. What it builds

Four classes, kernel code in the pool, with the kernel's conventions (WINDOWS 4-5: opaque, deterministic `M_DRAW`; IX, IY and
the alternate set preserved; no `DI`):

| Class | Parent | What it is | Used by |
|---|---|---|---|
| `Check` | `View` | A box and its text. A click or SPACE toggles it and posts `E_CMD`. Flags bit 4 makes it a **radio** button: a click only sets it, and clears every other radio among its siblings | Dialogs, the shell's options |
| `Field` | `View` | One line of editable text: a caret, insert and delete, the caret moved by LEFT / RIGHT, the text scrolled sideways to keep the caret visible. ENTER posts `E_CMD` | "Save as" and every name or number a dialog asks for |
| `List` | `View` | Lines of text (an array of strings), one selected. UP / DOWN, a click, and scrolling. ENTER or a second click on the selected line posts `E_CMD` | The shell's tape catalogue, Write's font menu |
| `VScroll` | `View` | A vertical scroll bar: arrows, a track and a thumb. A click on an arrow steps by 1, on the track by a page; the thumb drags. It tells its target with `M_SCROLL` | `List`, Write's text view |

**Out (later or never):** horizontal scroll bars; multi-line text (Write's own view); a selection inside a `Field` and the
clipboard; a blinking caret (timers are not implemented: section 8, decision 2); `Icon` (the shell's contract decides it);
pop-up menus; sliders.

## 2. Fields and messages

Coordinates absolute (WINDOWS 3). Text is the kernel's string form (a length byte, then the codes) and `G_TEXTP`'s PROP6 font.
Every pointer is in RAM visible under K (BANKING rule 4).

| Class | Fields (after `View`'s) | Size |
|---|---|---|
| `Check` | `text` 2 | 18 |
| `Field` | `buf` 2 (a string with room for `cap` codes), `cap` 1, `caret` 1 (0..length), `first` 1 (the first code shown) | 21 |
| `List` | `items` 2 (an array of string pointers), `count` 1, `sel` 1 ($FF none), `top` 1 (the first line shown), `bar` 2 (a `VScroll` or 0) | 23 |
| `VScroll` | `value` 1, `max` 1, `page` 1, `target` 2 (the view told, or 0) | 21 |

- **Flags** (`View_flags` bits 3-7, the class's): `Check` bit 3 checked, bit 4 radio. `Field`, `List`: bit 3 disabled look (with
  `View`'s bit 2).
- **`M_SCROLL`** (new, numbered after `M_BLUR` for `View`'s descendants that take it): DE = the new value. `VScroll` sends it
  to `target` after each change; `List` takes it (top = value) and sends `VScroll` its own changes back by setting `value` and
  `W_DRAWVIEW`. No loop: a view never sends `M_SCROLL` while handling one.
- **`E_CMD`** as `Button`'s (WINDOWS 17.3): A = 10, C = the control's `View_id`, E = the window's slot. The program reads the
  control's fields to see what changed.
- **Routines** for programs (pool, K):
  - `TK_SETTEXT` (IX = a `Field`, HL = a string): copies it into `buf`, cut at `cap`; caret at the end; `first` adjusted;
    `W_DRAWVIEW`;
  - `TK_SETITEMS` (IX = a `List`, HL = items, A = count): sel = $FF, top = 0, the bar's max and page set; `W_DRAWVIEW` of both.

## 3. Looks (exact pixels in the slices' interface sections; the owner reviews them by eye)

All 8 pixels of text line height, PROP6 (rows 1-7 inked), as `Button`.
- **`Check`:** a 7 x 7 box framed at (x, y + 1); checked: an X inside (a filled 3 x 3 centre for a radio). The text at
  (x + 11, y). Focused: the text underlined, as `Button`.
- **`Field`:** framed; the text at (x + 3, y + (h - 8) / 2), clipped inside the frame; while focused, the caret is a 1-pixel
  vertical bar, 9 rows tall, at the pen position of code `caret`.
- **`List`:** framed; line i at y + 1 + 9 (i - top); the selected line inverted across the inside width.
- **`VScroll`:** 12 pixels wide (it lines up with the 16-pixel cell grid when placed at a cell's right edge); arrows 12 x 10 at
  the ends; the track between; the thumb a filled box whose height is track x page / (max + page), at least 6 rows.

## 4. Behaviour (exact in the slices' interface sections)

- **Focus:** `Check`, `Field` and `List` are focusable; `VScroll` is not (the keys of its target scroll it).
- **Keys** each control consumes: `Check` SPACE (ENTER stays with the dialog's default button); `Field` printable codes 32-126,
  DELETE, LEFT, RIGHT, ENTER; `List` UP, DOWN, ENTER. Everything else is not consumed, so TAB and the kernel's defaults still
  work.
  - In a `Field`, DOWN and UP are not consumed, so they move the focus (OBJECTS_EVENTS 6). LEFT and RIGHT are, so in a
    `Field` they no longer move the focus.
- **Pointer:** a press takes the capture as `Button`'s; `VScroll` repeats an arrow or track press every 6 frames while held
  (it counts frames itself from `V_FRAMES` while it has the capture; no timer event).
- **Drawing:** every change draws only the changed control (`W_DRAWVIEW`), except `List`'s scroll by one line, which uses
  `G_SCROLLV` on the inside and draws the one new line.

## 5. Where things live

- **Code:** `src/kernel/tk.asm`, assembled in chunk 5 after the kernel (the pool) by every step 5 cartridge. The classes go into
  `src/kernel/classes.txt`.
- **The test cartridge `tk5`:** `desk5`'s shape plus test code in DOCK 2-3 (BANKING 8). Its test classes are banked, like
  `bank5`'s, so the toolkit is exercised from a banked program from the start.
- **The demo:** a "Controls" window in `desk5`'s menu ("Calc" gains "Controls..."): one of each control, for the owner to try.

## 6. Slices

| Slice | Content |
|---|---|
| **T1** | `Check` (and radio), `VScroll` |
| **T2** | `List` (with its bar) |
| **T3** | `Field`: the first text entry. **The owner tries the SYMBOL SHIFT layout here** (accepted as drafted until tried, 2026-11-12) |

- Each slice starts with its interface section here: exact pixels, routines, and how each bound is measured.
- Z80: main model. Models and tests: Sonnet, from this contract. Runs: Haiku. A missed speed bound is recorded with options.

## 7. Bounds (TSRun, T-states, direct calls with a sentinel return, interrupts off, unless stated)

| Measure | Bound |
|---|---|
| **Bytes in the pool,** the four classes, their code and the two routines (**report** each) | **<= 2,600** (**EST** 1,800-2,400); step 5's pool growth stays <= 3,400 (BANKING 6.1) |
| `W_DRAWVIEW` of a `Check` with a 40-pixel text / of a 16-line `List` 128 x 146 / of a `VScroll` 12 x 146 / of a `Field` 160 x 12 showing 30 codes | **report** each; none over 1.5 x `Button`'s 64 x 16 figure per 1,000 pixels of area (**EST**) |
| A typed code in a `Field` of 30 codes, from `K_DISPATCH` of the `E_KEY` to the field redrawn | <= 58,000 (one frame: typing must keep up with auto-repeat) |
| `List` scrolled by one line (an arrow click, or DOWN past the bottom), 16 lines shown | <= 40,000 |
| `E_MOVE`, no capture, over a window holding one of each control | <= 3,900 (step 4's bound, unchanged) |
| Stack: any control's `M_DRAW` / `M_EVENT` | <= 64 bytes each |
| `DI` / frame interrupts lost | none / 0 |

## 8. Decisions (owner, 2026-11-12: the recommendations taken)

1. **The four controls,** and what is out (section 1). `Icon` is the shell's contract's; alerts are built from `Dialog`,
   `Label` and `Button`.
2. **A solid caret** until a contract that needs timers adds `E_TIMER`.
3. **In a `Field`, LEFT and RIGHT move the caret;** TAB, UP and DOWN move the focus.
4. **<= 2,600 bytes** in the pool for the toolkit.
5. **Order:** T1, then a stop for the owner to review the look in a demo; then T2 and T3 in one run, the demo at the end (where
   the owner tries the SYMBOL SHIFT layout).

## 9. T1 interface (designed 2026-11-12, binding for the T1 code and tests)

The tests are written from sections 1-7 and this section, never from the code.

### 9.1 Amendments to sections 2 and 5

- **No `M_SCROLL`.** `VScroll` tells its target by sending **`M_EVENT` with DE -> a 4-byte record `TK_EV`:** type
  `E_SCROLL` (11), data 1 = the new value, data 2 = the bar's `View_id`, data 3 = 0.
  - A new message would add a slot to every `View` class's method table, and change `kern3`'s and `kern4`'s cartridges.
  - Every view already takes `M_EVENT`, and one that does not know `E_SCROLL` does not consume it.
  - With `target` = 0 the bar posts `E_CMD` instead, as `Button` does.
- **The classes are in their own file, `src/kernel/tk-classes.txt`** (generated `tk-classes.inc`). `tk.asm` and the classes are
  assembled only by step 5 cartridges (`desk5` now), in chunk 5 after the kernel. `kern3`, `kern4` and `bank5` stay
  byte-identical.
- **T1's tests run on `desk5`.** The demo is banked program code (in Calculator's chunk), so the controls are already driven
  from a banked program. There is no `tk5` cartridge in T1.
- **The toolkit uses `V_FRAMES`** (the cartridge's word, incremented by the ISR; `$E080` in every step 5 cartridge) to time
  repeats.

### 9.2 `Check` (`View`; `text` 2 at offset 16; size 18)

**Flags:** bit 0 focusable (the program sets it), bit 3 checked, bit 4 radio, bit 5 pressed (internal).

**Draw** (x, y, w, h = its rectangle; tw = `G_TEXTW` of its text):
1. `CLR` fill (x, y, w, h).
2. `SET` frame (x, y, 13, 8). It is 13 pixels by 8 rows: in mode 6 that looks about square.
3. Checked:
   - **a check box:** `SET` lines (x + 3, y + 2)-(x + 9, y + 5) and (x + 3, y + 5)-(x + 9, y + 2);
   - **a radio:** `SET` fill (x + 4, y + 3, 5, 2).
4. A radio's box has its 4 corner pixels cleared (`CLR`): (x, y), (x + 12, y), (x, y + 7), (x + 12, y + 7).
5. The text, `SET`, `G_TEXTP` at (x + 17, y).
6. Focused (as `Button`, 17.5 step 4): `SET` `G_HLINE` (x + 17, y + 8, tw).
7. Pressed: `XOR` fill (x + 1, y + 1, 11, 6).

The program must make h >= 9, and w >= 17 + tw.

**Events:**
- **`E_DOWN`:** pressed = 1, `W_DRAWVIEW`; consumed.
- **`E_MOVE` while `K_CAPTURE` = self:** pressed = the point is inside the rectangle; `W_DRAWVIEW` when that changes; consumed.
  `E_MOVE` otherwise: not consumed.
- **`E_UP`:** if pressed: pressed = 0, then *activate*. Consumed either way.
- **`E_KEY` SPACE (32):** *activate*; consumed. Other keys are not consumed.
- ***Activate*:**
  - **a check box:** checked toggles;
  - **a radio:** every sibling (the same parent) whose class is `Check` with the radio bit and checked gets checked = 0 and is
    drawn; then self's checked = 1;
  - then `W_DRAWVIEW` of self, and `E_CMD` posted as `Button`'s (17.3: C = `View_id`, E = the window's slot).
- **Focus / Blur:** as `Button`'s (drawn again; the blur without the focus look).

### 9.3 `VScroll` (`View`; `value` 1 @16, `max` 1 @17, `page` 1 @18, `target` 2 @19, internal 2 @21; size 23)

**Geometry** (x, y, w, h; h >= 32):
- the up box (x, y, w, 10); the down box (x, y + h - 10, w, 10);
- the track: rows y + 10 .. y + h - 11, tl = h - 20 rows;
- the thumb, when max > 0:
  - th = max(6, floor(tl x page / (max + page))), but never more than tl;
  - ty = y + 10 + floor((tl - th) x value / max).

  With max = 0 there is no thumb.

**Draw:**
1. `CLR` fill (x, y, w, h); `SET` frame (x, y, w, h).
2. `SET` `G_HLINE` (x, y + 9, w) and (x, y + h - 10, w).
3. **The arrows,** with cx = x + floor(w / 2):
   - up: `SET` `G_HLINE` (cx - 2k, y + 3 + k, 4k + 1) for k = 0, 1, 2;
   - down: the same at rows y + h - 4 - k.
4. **The thumb:** `SET` fill (x + 2, ty, w - 4, th).
5. **A pressed arrow** (internal state): `XOR` fill (x + 1, y + 1, w - 2, 8) for up, (x + 1, y + h - 9, w - 2, 8) for down.

**`E_DOWN` at the point (px, py)** starts **tracking**: a loop inside the handler, like `W_DRAG`'s (WINDOWS 17.4).
- **The part pressed:**
  - **up arrow:** py < y + 10;
  - **down arrow:** py >= y + h - 10;
  - **thumb:** ty <= py < ty + th;
  - **page up:** above the thumb;
  - **page down:** below the thumb.
- **A step:** -1 or +1 (an arrow), -page or +page (the track), clamped to 0..max. The arrow is drawn pressed.
- **The step is taken at once.** It repeats 15 frames after the press, then every 6 frames (counted by `V_FRAMES`), while the
  pointer is inside that part. For the track, the part is the side of the thumb it started on.
- **The thumb:** the grab is py - ty. On each `E_MOVE`:
  - ty' = clamp(py - grab, y + 10, y + 10 + tl - th);
  - value = round((ty' - y - 10) x max / (tl - th)), with halves up; when tl - th = 0, value is unchanged.
- **The loop:** `K_GETEV`; with carry, `HALT`, the repeat check, and loop.
  - **`E_MOVE`:** as above.
  - **`E_UP`:** the arrow is drawn released; tracking ends.
  - **Anything else:** dropped.
- **After each change of value:** `W_DRAWVIEW` of the bar, then the target is told (9.1).
- `E_DOWN` is consumed. The bar takes no keys and is not focusable.

**`TK_SETBAR`** (IX = a `VScroll`; A = value, C = max, B = page): max and page stored, value = min(A, max), `W_DRAWVIEW`. It
tells nobody.

### 9.4 The demo (`desk5`; the "Calc" menu gains item 3, "Controls...")

A window "Controls" at (352, 16, 144, 112). It is built by Calculator's code (DOCK 2-3), once; afterwards the item raises it.
It holds:
- **check boxes** "Sound" and "Grid", at (360, 32, 72, 9) and (360, 44, 72, 9);
- **radios** "Small", "Medium" and "Large", at (360, 60, 72, 9), (360, 72, 72, 9) and (360, 84, 72, 9), with "Medium" checked;
- **a `VScroll`** at (476, 32, 12, 80), with max 20 and page 5. Its target is a demo view, so `E_SCROLL` reaches it.
- **a `Label`** at (360, 100, 100, 9), showing "Value: n".

`E_CMD` from the demo's controls carry ids >= 128, so Calculator's loop sends them to the demo, not to `C_KEY`.

### 9.5 How the T1 bounds are measured (section 7)

- **Bytes:** `TK_END - TK_CODE`, plus the descriptors in `tk-classes.inc`, reported per class.
- **`W_DRAWVIEW`:**
  - of "Sound" checked and focused;
  - of the bar 12 x 80 with max 20, page 5 and value 10.

  Both are reported, with the figure per 1,000 pixels against `Button`'s 64 x 16 (28,816 T).
- **An arrow click:** from `K_DISPATCH` of the `E_DOWN` to the bar redrawn and the target told. **Report.**
- **The stack:** in `Check`'s and `VScroll`'s `M_EVENT` and `M_DRAW` (tracking included). <= 64 bytes each.

### 9.6 Owner review (2026-11-12)

The owner tried the "Controls" demo (`web/?cart=desk5`, Calc -> Controls...): **"The controls look good."** T1's looks
(9.2-9.3) are approved. T2 and T3 follow in one run (decision 5).

### 9.7 Amendments after T1's tests (2026-11-12)

Found by Sonnet's tests and fixed in `tk.asm`:
1. **The repeat keeps its cadence.** The deadlines are the press's frame + 15, then each deadline + 6, whatever a step costs.
   - Before, each step's time was added: 16, then 7, 7, ... frames.
   - On the demo it is now: the first step 2 frames after the press (the poll and one draw), then +17, +23, +29.
2. **`target` = 0: one `E_CMD` when tracking ends,** if the value changed during it. Posting one per change could not work:
   the tracking loop's own `K_GETEV` takes posted records first and drops them.
3. **The press is drawn once:** the arrow pressed and the first step together. An arrow click went from about 108 k to 58 k T.
4. **A radio does not clear itself:** "every sibling" excludes self, so it is drawn once.
5. **"Inside that part" means the part's rectangle:** x within the bar, and the part's rows.
6. **`VScroll` needs w >= 12** (binding on programs): its widest arrow row is 9 pixels.

**Missed bound, for the owner (not changed):** `W_DRAWVIEW` of a `Check` with a 40-pixel text, focused, takes 26,007 T, which
is 50,696 T per 1,000 pixels. That is 1.80 x `Button`'s, against the 1.5 x bound of section 7.
- Fixed costs dominate a view this small: `W_DRAWVIEW`'s setup, the fill, the frame, `G_TEXTW` and the text's line setup
  (about 2,760 T).
- So a per-area ratio judges small views unfairly. The bar 12 x 146 passes (1.31 x).
- **Proposed:** absolute bounds at the measured figures (`Check` 72 x 9, checked and focused: 31,185 T; the bar 12 x 80:
  47,574 T), in place of the ratio.

**Owner's decision (2026-11-12):** the proposal is taken.
- The 1.5 x ratio is replaced by **absolute bounds at the measured figures:** `W_DRAWVIEW` of a `Check` 72 x 9, checked and
  focused, <= 31,200 T; of the bar 12 x 80 (max 20, page 5, value 10) <= 47,700 T (owner, 2026-11-12: was 47,600, set from
  a single draw of 47,574; the test takes the worst of three draws, 47,605).
- The owner tried the controls again after the fixes: "I saw nothing wrong with my interaction of the controls."

### 9.8 Owner decisions for T2 and T3 (2026-11-12)

- **The shell comes first,** then T2 and T3.
- **`List` redraws in full** to scroll (option (a)). The 40,000 T one-line scroll bound of section 7 cannot be met.
  - Shifting a 128 x 144 box with `G_SCROLLV` costs about 57 k T alone (**EST**).
  - So T2's interface will replace that bound with the measured figure (**EST** about 150 k T for 16 proportional lines).
- **The owner's idea, for T2's interface: lists drawn like Arcade's tiles.**
  - gfx6's `G_TEXT8` is Arcade's glyph-plane technique: fixed-width 8 x 8 cells, 64 columns, 232 T a character.
  - A `List` flag ("cell lines", as `Label`'s flags bit 3) would draw its lines with it on the 8 x 8 grid: 16 lines of 16
    characters in about 60 k T (**EST**), against about 150 k proportional.
  - Its one-line scroll is then a whole character row (byte-aligned).
  - It suits the tape catalogue: tape names are fixed width.

## 10. T2 and T3 interface (designed 2026-11-12, binding for the T2 / T3 code and tests)

The tests are written from sections 1-9 and this section, never from the code. Coordinates are absolute; x, y, w, h are the
view's rectangle. "Fill", "frame", "line" are gfx6's `G_FILL`, `G_FRAME`, `G_HLINE`, in the op named.

### 10.1 Amendments to sections 2-7

- **Placement.** Chunk 5 has 445 bytes left after the launcher, so `List`'s and `Field`'s code goes in a new file,
  `src/kernel/tk2.asm`, assembled by `desk5` in **chunk 1 after `kernel1.asm`** (1,514 bytes free there). It is pool code like
  `tk.asm` (mapping K, always mapped). The two class descriptors join `tk-classes.txt` (chunk 5).
- **`List`'s scroll** redraws the whole `List` (9.8). There is no `G_SCROLLV` and no 40,000 T bound; 10.6 sets the bound at the
  figure measured.
- **A `List` draws one line only** when that is all that changed: a selection moved within the lines shown, the focus or the
  blur. It is still `W_DRAWVIEW` of the `List` (section 4), with an internal "one line" mode that `M_DRAW` reads; the pixels are
  exactly those of a full draw.
- **`E_SCROLL` reaches a `List` through `M_EVENT` with DE -> the record** (9.1). A `List` reads every event through DE.
- **A `List`'s focus look** (section 3 left it open): the selected line is **inverted when the `List` has the focus, and outlined
  when it has not**.
- **Disabled look** (section 2, bit 3, for `List` and `Field`): drawn last, `CLR` fill (x + 1, r, w - 2, 1) for every row
  r = y + 2, y + 4, ... below y + h - 1. The program sets it together with `View`'s bit 2 (disabled: no events, no focus); a
  `List` with bit 3 is always drawn in full.

### 10.2 Shared drawing rules

- **The inside clip.** Both controls draw their frame, then narrow the clip to its intersection with the inside
  (x + 1, y + 1, w - 2, h - 2), and **put the caller's clip back before returning** (`group_draw` draws the siblings with it).
- **Text** is `SET`. PROP6 is drawn by `G_TEXTP` (row 0 of the 8 is blank, so the ink is rows 1-7); the 8 x 8 font by
  `G_TEXT8`, which draws only whole cells inside the clip, opaque.

### 10.3 `List` (`View`; `items` 2 @16, `count` 1 @18, `sel` 1 @19, `top` 1 @20, `bar` 2 @21; size 23)

**Flags:** bit 0 focusable (the program's), bit 3 disabled look, bit 4 **cell lines**.

**Line geometry** (LY0 = the first line's top row, P = the pitch, n = the lines shown):

| | LY0 | P | n | Line k's text |
|---|---|---|---|---|
| Proportional (bit 4 = 0) | y + 1 | 9 | floor((h - 2) / 9) | `G_TEXTP` at (x + 3, LY0 + 9 k) |
| Cell lines (bit 4 = 1) | 8 r0, r0 = (y + 8) >> 3 | 8 | floor((y + h - 1) / 8) - r0 | `G_TEXT8` at the cell (c0, r0 + k), c0 = (x + 9) >> 3 |

- Line k (0 <= k < n) shows item top + k when top + k < count. Its **band** is (x + 1, LY0 + P k, w - 2, P).
- Cell lines: c0 is the first whole cell at or right of x + 2, r0 the first whole cell row at or below y + 1. A program puts the
  `List` at x = 8 a + 6, y = 8 b + 7 and h = 8 n + 2 to waste nothing; then w = 8 m + 4 shows m codes. Any rectangle works.
- **Binding on programs:** h >= 11 (one line); `top` and `sel` are the `List`'s, set only through `TK_SETITEMS`.

**Draw (full):**
1. `CLR` fill (x, y, w, h); `SET` frame (x, y, w, h).
2. The inside clip (10.2).
3. Each line shown with an item: its text, then, when the item is `sel`:
   - focused (`K_FOCUS` = the `List`, and not being drawn by its blur): `XOR` fill of the band;
   - otherwise: `SET` frame of the band.
4. The disabled look (bit 3), then the caller's clip back.

**Draw (one line, item i):** the same steps for line i - top only: the inside clip, `CLR` fill of its band, its text, its
selection look, the clip back. Nothing else is touched.

**Keys** (`E_KEY`):
- **DOWN:** sel = top when sel = $FF, else sel + 1 when sel + 1 < count. **UP:** sel = top when sel = $FF, else sel - 1 when
  sel > 0. Consumed always (an empty `List` changes nothing).
- **Selecting item j** (keys or pointer): old = sel, sel = j. Then top' = j when j < top; j - n + 1 when j >= top + n; else
  top.
  - top' = top: one-line draws of old (when it is not $FF and shown) and of j.
  - top' differs: top = top', a full draw, then the bar is set (below).
- **ENTER:** when sel is not $FF, `E_CMD` posted as `Button`'s (WINDOWS 17.3); consumed. With sel = $FF it is not consumed.
- Every other key is not consumed (LEFT, RIGHT, TAB move the focus).

**Pointer:**
- **`E_DOWN`** at (px, py): k = floor((py - LY0) / P) when py >= LY0. When k < n and top + k < count, the item is
  j = top + k:
  - if the last `E_DOWN` taken by a `List` was on this `List`, on item j, and `V_FRAMES` - its frame <= 20, and j = sel:
    `E_CMD` is posted and the memory cleared (a third click starts again);
  - otherwise j is selected (above), and this `List`, j and `V_FRAMES` are remembered.

  A press elsewhere in the `List` clears the memory. `E_DOWN` is always consumed.
- **`E_UP`:** consumed. **`E_MOVE`:** consumed when `K_CAPTURE` is the `List`, else not.

**`E_SCROLL`** (from its bar, DE -> the record): top' = min(data 1, max(0, count - n)). When top' differs: top = top', a full
draw. Consumed. The bar is not told (no loop, section 2).

**Focus / Blur:** a one-line draw of `sel` when it is not $FF and shown (the blur without the focus look, as `Button`'s).

**The bar** (when `bar` is not 0): "set" means `TK_SETBAR` with value = top, max = max(0, count - n), page = n. The program
makes the bar's `target` the `List`.

**`TK_SETITEMS`** (IX = a `List`, HL = items, A = count): items and count stored; sel = $FF; top = 0; the click memory cleared;
the bar set; a full draw. Clobbers AF, BC, DE, HL; preserves IX.

### 10.4 `Field` (`View`; `buf` 2 @16, `cap` 1 @18, `caret` 1 @19, `first` 1 @20; size 21)

**Flags:** bit 0 focusable (the program's), bit 3 disabled look. `buf` -> a string: a length byte L (0..cap), then room for
`cap` codes. tw(i, j) is the width of codes i..j - 1 (PROP6 advances; 0 when j <= i). ty = y + floor((h - 8) / 2).

**Draw:**
1. `CLR` fill (x, y, w, h); `SET` frame (x, y, w, h).
2. The inside clip.
3. Codes first..L - 1 by `G_TEXTP` at (x + 3, ty).
4. Focused (as `List`'s): the **caret**, `SET` fill (x + 2 + tw(first, caret), ty, 1, 9). It is in the blank column after the
   code before it (PROP6's last column of every glyph is blank).
5. The disabled look, then the caller's clip back.

**Binding on programs:** h >= 11, w >= 16, cap <= 254.

**First adjusted** (after every change, A = w - 5):
1. first = caret when first > caret;
2. while tw(first, caret) > A: first + 1;
3. while first > 0 and tw(first - 1, L) <= A: first - 1.

So the caret always shows (its column is at most x + w - 3), and when there is room the text slides right to fill it.

**Keys** (`E_KEY`), each consumed:
- **32-126:** when L < cap, the code is inserted at caret, L + 1, caret + 1; when L = cap nothing changes (no draw).
- **DELETE (12):** when caret > 0, code caret - 1 is removed, caret - 1.
- **LEFT (8) / RIGHT (9):** caret - 1 when > 0 / caret + 1 when < L.
- **ENTER (13):** `E_CMD` posted as `Button`'s. Nothing is drawn.
- After a change of the text or the caret: first adjusted, then `W_DRAWVIEW`. A key that changes nothing draws nothing.
- Every other key is not consumed (TAB, UP, DOWN move the focus; section 8 decision 3).

**Pointer:**
- **`E_DOWN`** at px: the caret goes before the first code (from `first`) whose middle is right of px. Walking k = first..L - 1
  with pen = x + 3 + tw(first, k) and a = the advance of code k: caret = the first k with px < pen + floor(a / 2); caret = L when
  there is none. Then first adjusted and `W_DRAWVIEW` (always). Consumed.
- **`E_UP`:** consumed. **`E_MOVE`:** consumed when `K_CAPTURE` is the `Field`, else not.

**Focus / Blur:** as `Button`'s (drawn again; the blur without the caret).

**`TK_SETTEXT`** (IX = a `Field`, HL = a string): L = min(its length, cap), its first L codes copied; caret = L; first = 0, then
adjusted; `W_DRAWVIEW`. Clobbers AF, BC, DE, HL; preserves IX.

### 10.5 The demo grows (`desk5`, program 2)

The window is now a `CWindow` at **(176, 32, 320, 144)**. T1's controls keep their rectangles and behaviour (9.4, SHELL 5).
Added, after them in the window's children:
- **a `List`** at (326, 47, 132, 74), id 136, focusable: 24 items (10.7); proportional it shows 8 lines, with cell lines 9 (16
  codes wide);
- **its `VScroll`** at (458, 47, 12, 74), id 135, target the `List`;
- **a `Label`** "Name:" at (184, 134, 32, 9), id 138;
- **a `Field`** at (220, 132, 160, 12), id 137, focusable, cap 40, starting with "Leap";
- **a status `Label`** at (184, 152, 280, 9), id 139, starting empty.

Behaviour:
- **"Grid"** (id 129) now switches the `List`'s cell lines: its checked flag is copied to the `List`'s bit 4, then
  `TK_SETITEMS` with the same items (the selection is cleared).
- **The `List`'s `E_CMD`:** the status reads "Open: " and the item.
- **The `Field`'s `E_CMD`:** the status reads "Name: " and the field's text (cut at 40 codes).

The focus order (pre-order) is the five T1 controls, then the `List`, then the `Field`: TAB reaches the `Field`, where the owner
types to try the SYMBOL SHIFT layout.

### 10.6 Bounds and how they are measured (section 7, for T2 and T3)

| Measure | Bound |
|---|---|
| Bytes: `tk2.asm` (`TK2_END - TK2_CODE`) plus the two descriptors (18 each); **report** `List`, `Field` and the shared code | **<= 1,382** (the toolkit's 2,600 less T1's 1,218); step 5's pool growth stays <= 3,400 |
| `W_DRAWVIEW` of a `List` 128 x 146, proportional, 16 lines of the standard items, item 3 selected, focused | **report** |
| `W_DRAWVIEW` of a cell-lines `List` 132 x 130 at x = 8 a + 6, y = 8 b + 7 (16 lines of 16 cells), item 3 selected, focused | **report** |
| **`List` scrolled by one line:** `K_DISPATCH` of `E_KEY` DOWN with sel the last line shown (top 0, sel 15), to the return. It includes the full draw and the bar's (12 x 146, or 12 x 130) | **report** each mode; the bound becomes the figure measured (9.8), rounded up to 100 T, once the owner has seen it |
| A selection moved by DOWN within the lines shown (sel 3 -> 4), `K_DISPATCH` to the return | **report** each mode |
| `W_DRAWVIEW` of a `Field` 160 x 12 showing 30 codes, focused | **report** |
| **A typed code:** a `Field` 160 x 12, cap 40, holding the 30 codes "abcdefghijklmnopqrstuvwxyzabcd" set by `TK_SETTEXT`, focused; `K_DISPATCH` of `E_KEY` 'x' to the return | **<= 58,000** |
| `E_MOVE`, no capture, over a window holding one of each control (`Check`, `VScroll`, `List`, `Field`, a `Label`) | <= 3,900 |
| Stack: `List`'s and `Field`'s `M_DRAW` and `M_EVENT` | <= 64 bytes each |
| `DI` / frame interrupts lost | none / 0 |

Direct calls under K with a sentinel return, interrupts on for the `K_DISPATCH` rows (an `E_CMD` post needs none), the worst of
three runs.

### 10.7 The standard items

24 strings, in order: "Accounts", "Address book", "Budget 1987", "Calendar", "Chess", "Diary", "Drawing 1", "Drawing 2",
"Font editor", "Games", "Letter to Ann", "Loader", "Music", "Notes", "Phone list", "Poems", "Recipes", "Shopping", "Sprites",
"Stock list", "To do", "Travel", "Utilities", "Zebra". The demo shows them; the bounds use them.

### 10.8 Tests (Sonnet, from this contract; TSRun headless, the pattern of `tests/tk-t1.mjs`)

1. **Looks:** random `List`s (both modes, any count, top, sel, focus, disabled look, rectangles partly off the grid) and
   `Field`s (any text, cap, caret, first, focus) against a gfx6-model rendering of 10.3-10.4, drawn whole and under random
   clips (a window partly covered); the caller's clip back after `M_DRAW`.
2. **`List` behaviour:** random key and click sequences against a model (sel, top, the bar's value / max / page, `E_CMD`s,
   the double click at 20 frames and not 21, `E_SCROLL` from the bar, the screen after each step).
3. **`Field` behaviour:** random editing sequences (codes, DELETE, LEFT, RIGHT, ENTER, clicks, a full buffer) against a model
   of the text, caret and first, and the screen after each step; `TK_SETTEXT` with strings longer than cap.
4. **The demo** over real frames: TAB to the `List` and the `Field`, typing with SYMBOL SHIFT characters, "Grid", the status
   line; the T1 groups updated to the new window.
5. **Bounds:** 10.6 as a table (`tests/tk-perf.mjs` extended).
6. **Cross-emulator:** on ZEsarUX, the Controls window after a key-driven session (a `List` selection, typed text) identical to
   TSRun's.

### 10.9 As built (2026-11-12)

**T2 and T3 are done on emulators.** The owner has not yet reviewed the grown demo.

**Bytes:**
- `tk2.asm` is 1,290 (`List` 666, `Field` 466, shared helpers 158); the two descriptors add 36: 1,326, against the bound 1,382.
- The descriptors cost 51 bytes of chunk 5 with their page alignment.
- Chunk 1 has 224 bytes left after `tk2.asm`; chunk 5 about 394.
- **Step 5's pool growth is now 3,029 of 3,400** (1,688 before, + 1,290 + 51).

**Bounds** (TSRun T-states; `tests/tk-perf.mjs`, seeds 1 and 2: 52 pass, 0 missed, 30 reported):

| Measure | Measured | Bound |
|---|---|---|
| `W_DRAWVIEW` `List` 128 x 146, proportional, 16 lines | 233,181 | report |
| `W_DRAWVIEW` `List` 132 x 130, cell lines, 16 lines | 142,687 | report |
| `List` scrolled by one line (DOWN past the bottom, includes the bar): proportional / cell lines | 303,420 / 209,355 | <= 303,500 / 209,400 (owner, 10.10) |
| Selection moved within the lines shown: proportional / cell lines | 86,047 / 72,967 | report |
| `W_DRAWVIEW` `Field` 160 x 12, 30 codes, focused | 47,092 | report |
| A typed code | 55,778 | <= 58,000 |
| `E_MOVE` over one of each control | 3,772 | <= 3,900 |
| Stack: deepest `M_EVENT` / `M_DRAW` | 42 / 24 bytes | <= 64 |
| `DI` / interrupts lost | none / 0 | none / 0 |

**Where the time goes** (profiling one draw):
- The proportional `List`'s full draw: `w_box` (clear and frame of 128 x 146) about 53 k; `G_TEXTP` about 8.2 k a line (132 k
  for 16); the selection about 5 k.
- A one-line draw is about 47 k, of which about 17 k is `W_DRAWVIEW` scanning the whole `List`'s cell rows.
- The 150 k estimate of 9.8 left out the box and the bar (the 12 x 146 bar redraw is about 70 k of the scroll).

**Tests (Sonnet, from the contract; the main model re-ran them on seeds 1 and 2):**
- `tests/tk-t2.mjs` 10 of 10 groups; `tests/tk-t3.mjs` 9 of 9.
- `tests/tk-demo.mjs` 7 of 7: the demo over real frames, all 33 SYMBOL SHIFT characters typed.
- `tests/tk-t1.mjs` 8 of 8 on the grown window.
- Model `tests/tk-model2.mjs` (45 hand-worked cases); harness `tests/tk-lib2.mjs`.
- **Regression:** shell and Calculator suites pass (`shell-s1` 13 of 13, `shell-perf` 21 pass, `calc-c1` 5 of 5, `calc-perf` 9 of 9);
  the step 3-4 suites, `bank-b0` and `gfx6-s1` pass.

**Cross-emulator:**
- ZEsarUX 13.0: 42 of 42 rows. 17 are new: Controls opened by keys, the `List` scrolled by DOWN, the `Field` edited with SS+P,
  SS+Z and DELETE, ENTER's status line, SS+Q back. Every screen identical to TSRun's.
- Fuse 1.9.1: its 6 boot rows (the runner sends no keys).

**Found and fixed:** the `List` read a pointer event's y from `K_EV` instead of through DE (10.1); found by `tk-t2` group 9.
Same bytes.

**Clarifications the tests adopted (binding from now on):**
- The click memory is one for all `List`s: a press on another control does not clear it; `TK_SETITEMS` does.
- A click on the selected line draws it once.
- Focus / Blur draw nothing when `sel` is `$FF` or the `List` is not shown.
- `V_FRAMES` differences are mod 65,536.

**For the owner:**
1. The scroll figures and their proposed bounds. If 303 k (about 5 frames) is too slow, the alternative of 9.8 option (b),
   `G_SCROLLV` of the inside plus one new line, is now estimated at about 105 k plus the bar.
2. In cell-lines mode the unfocused selection's outline shares its top row with the 8 x 8 glyphs' top row (the Leap V2 font
   inks row 0), so capitals touch the box. The owner judges it on screen.

### 10.10 Owner decisions after trying the demo (2026-11-12)

- **The one-line scroll is fast enough** ("The demo seems fast to me"). Its bounds are the measured figures rounded up to 100 T:
  `List` scrolled by one line, bar included, **<= 303,500 T** proportional and **<= 209,400 T** with cell lines. Option (b),
  `G_SCROLLV`, is not taken.
- **The cell-lines outline is accepted** (10.9, for the owner 2: "yes, that is acceptable"). The unfocused selection stays
  outlined in both modes.
- **The SYMBOL SHIFT layout is accepted after trying it** in the `Field` ("symbol shift worked with P to give me \""). The key
  map stays as drafted.
- "Grid" switching the `List` between PROP6 and the 8 x 8 font is as designed (10.5); the owner saw it.
- **T2 and T3 are closed.**
