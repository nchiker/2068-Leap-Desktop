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
