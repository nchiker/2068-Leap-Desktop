# Toolkit: contract (draft 1, 2026-11-12, for the owner)

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

## 8. Decisions for the owner

1. **The four controls and what is out** (section 1). Is anything missing that the shell or Write will need first?
2. **The caret does not blink** until timers exist (a solid bar while focused). Or: add `E_TIMER` to the ISR now (a small
   kernel change: one event every N frames when a program asks), and blink it. **Recommended: solid now.**
3. **In a `Field`, LEFT and RIGHT move the caret,** so focus moves on with TAB, UP and DOWN only (section 4).
4. **The pool budget:** <= 2,600 bytes for the toolkit (section 7). That leaves about 700 bytes of step 5's 3,400 for the
   shell's always-mapped needs (the launcher, `Icon` if the shell wants it in the pool).
5. **Order:** T1, T2, T3, with a demo window in `desk5` after each slice, or all three, then the demo.
