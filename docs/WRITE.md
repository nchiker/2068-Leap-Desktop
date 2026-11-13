# Write: contract (draft 1, 2026-11-12, owner approved)

Roadmap step 5 (`docs/FEASIBILITY.md`): the word processor, the first program that holds a document. It is program 3 of
`desk5`, in DOCK 2-3 like Calculator (`docs/BANKING.md` 3), and uses the toolkit (`docs/TOOLKIT.md`). Marks as in FEASIBILITY:
**EMU** measured, **EST** estimated.

Style as `docs/WINDOWS.md`: every number in section 7 is a bound. **A missed bound is reported with its numbers before anything
is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

## 1. What it builds

**Write** (program 3), started from a new icon in the shell. One document, one window:
- **A text view** (`TextView`, a banked class in Write's image): word-wrapped paragraphs in PROP6, a caret, scrolling. It is
  Write's own view, not a toolkit control (TOOLKIT 1: multi-line text is out of the toolkit).
- **Its `VScroll`** (T1), whose target is the text view.
- **A "File" menu:** "New" (W1); "Open..." and "Save..." later (W3).

**Out (later or never):** fonts and styles (PROP6 is the only proportional font; bold and underline need gfx work); several
documents or windows; rulers, tabs and justification; undo; find and replace; printing.

## 2. The document

- **Text:** codes 32-126, and 13 as the end of a paragraph. Nothing else is stored.
- **Storage:** a **gap buffer** in the app arena (BANKING rule 4: the kernel draws from it, so it is RAM visible under K; Write's
  code edits it under A). The gap sits at the caret, so typing and deleting cost the same anywhere in the document.
- **Capacity:** **5,120 codes** (decision 2). The arena holds 7,168 bytes: the buffer, the line table (2.1), the window and
  its views, and later the clipboard (W2).
- **Full:** a code typed into a full document changes nothing (no draw); the menu's "New" still works.

### 2.1 Display lines

- The text view's width W (pixels for text) wraps each paragraph into **display lines**, PROP6 advances summed:
  - a line breaks after the last space that fits;
  - a word wider than W breaks at the last code that fits;
  - spaces at a break stay at the end of the line they follow (they are not drawn past W);
  - an empty paragraph is one empty line.
- **The line table** holds each display line's start (a word: an offset in the document). After an edit, lines are wrapped
  again from the edited paragraph's first line until a line start matches the old table (the rest only moves by the edit's
  length).

## 3. Looks (exact pixels in each slice's interface section)

- **The window:** a `CWindow` "Write" filling the desk below the menu bar (decision 3; **EST** (16, 16, 480, 168)). Its text
  view has a 3-pixel margin and 9-pixel lines (PROP6 with one row between lines, as `List`), about 16 lines of about 80 codes.
- **The caret:** a 1 x 9 `SET` bar in the blank column before the code at the caret (PROP6's last column is blank in every
  glyph, so a caret is drawn or erased without touching text). It shows while the text view has the focus.
- **The bar:** T1's `VScroll` at the window's right; value = the first line shown, max = lines - lines shown, page = lines
  shown.

## 4. Behaviour

- **Keys** (the text view has the focus; it is the window's only focusable view):

| Key | Action |
|---|---|
| 32-126 | inserted at the caret |
| ENTER (13) | a paragraph end inserted |
| DELETE (12) | the code before the caret removed (a paragraph end too: paragraphs join) |
| LEFT / RIGHT | the caret by one code, across lines and paragraphs |
| UP / DOWN | the caret to the line above / below, at the code nearest the same x |
| SS+Q (`CLOSE`) | quit (section 4.1) |

- **Pointer:** a click puts the caret at the nearest code boundary (TOOLKIT 10.4's rule, per line; below the last line, the
  document's end).
- **The caret stays shown:** a move or an edit that takes it off the lines shown scrolls the view (section 5).
- **The bar** scrolls the view without moving the caret.

### 4.1 Quitting and "New"

- The close box or SS+Q quits to the shell; "New" empties the document.
- When the document has changed since it was started or emptied, both ask first (decision 5): a `Dialog` "Discard the
  document?" with "Discard" and "Cancel" (the default and the cancel).

## 5. Drawing (all through `W_DRAWVIEW`, so a covered window draws correctly)

The text view's `M_DRAW` has internal modes, as `List`'s one-line draw (TOOLKIT 10.1). Each gives exactly the pixels of a full
draw:
- **caret only:** the old caret column cleared, the new one set (a caret move within the lines shown);
- **line from x:** one line redrawn from a pixel column on (an edit that changes only the caret's line: typing at the end of a
  line draws one glyph);
- **lines:** a range of lines (an edit that rewraps them);
- **full.**

**Scrolling by n lines:** `G_SCROLLV` of the text area by 9 n rows, then the n uncovered lines drawn (decision 4). A full
redraw of 16 long lines is about 15 frames (**EST** 870 k T: 16 x 80 glyphs at about 680 T); a one-line scroll this way is
**EST** about 190 k T. A scroll by more than the lines shown less one is a full draw.

## 6. Where things live

| Where | What |
|---|---|
| DOCK 2-3 | `src/apps/write.asm`: program 3's start, `TextView`'s methods, the editing and wrapping code (A; PROP6's advances are read from chunk 4, mapped under A) |
| Its RAM image (`$C000`, <= 1 KB) | `TextView`'s class and thunks, strings, the menu table |
| App arena | the gap buffer, the line table, the window and views |
| Pool | **nothing** (0 bytes; step 5 has 371 of its 3,400 left). `G_TEXTP`, `G_FILL`, `G_SCROLLV` and `W_DRAWVIEW` are reached by `KFAR` |
| Shell | a third icon, "Write", at (176, 40) (SHELL 10.4; the main model draws it in `icons.txt`, the owner reviews it) |

## 7. Bounds (TSRun, T-states; direct calls with a sentinel return, interrupts on for dispatch rows, unless stated)

| Measure | Bound |
|---|---|
| Write's bytes in DOCK 2-3 (code and image), per slice | **report**; W1 **EST** 3,000-4,000, all of Write <= 7,000 (FEASIBILITY 4) |
| Pool bytes | **0** |
| RAM image | <= 1,024 |
| A typed code at the end of a line (no rewrap), `K_DISPATCH` of `E_KEY` to the return | <= 58,000 (one frame) |
| A typed code at the start of an 80-code line that does not rewrap | <= 117,000 (two frames; auto-repeat is every 4) |
| A typed code that rewraps the rest of a 10-line paragraph | **report** |
| A caret move (LEFT, RIGHT, UP, DOWN) within the lines shown | <= 58,000 |
| Scroll by one line (DOWN off the bottom, or a bar arrow) | **report** (**EST** 190 k); the bound is set from the measurement, as `List`'s (TOOLKIT 10.10) |
| `W_DRAWVIEW` of the text view, 16 lines of 80 codes | **report** (**EST** 870 k) |
| Launch, the second click to Write's window drawn (empty document) | <= 30 frames (SHELL 7) |
| Stack: the text view's `M_DRAW` and `M_EVENT`, crossings included | <= 128 bytes |
| `DI` / frame interrupts lost | none / 0 |

## 8. Tests (Sonnet, from this contract; TSRun headless, the pattern of `tests/tk-t3.mjs`)

1. **The document model:** random editing (insert, ENTER, DELETE, the caret keys, clicks, a full buffer) against a string
   model of the text and the caret; the gap buffer read back as text after each step.
2. **Wrapping:** the line table against a model of 2.1, for random paragraphs (long words, runs of spaces, empty paragraphs).
3. **Looks:** the window against a gfx6-model rendering after each step, covered windows included; every drawing mode equal to
   a full draw.
4. **Scrolling:** the caret kept shown, the bar's value / max / page, `G_SCROLLV` results equal to a full draw.
5. **Quit and New:** the dialog only when changed; Cancel keeps everything.
6. **Bounds:** section 7 as a table.
7. **Cross-emulator:** on ZEsarUX, a typed paragraph that wraps and scrolls, every screen identical to TSRun's.

## 9. Slices

| Slice | Content |
|---|---|
| **W1** | The document, wrapping, the text view, caret keys and clicks, scrolling and the bar, "New", the discard dialog, the shell icon |
| **W2** | A selection (SHIFT with the caret keys, a drag), Cut / Copy / Paste in an "Edit" menu, the clipboard in the arena |
| **W3** | "Open..." and "Save..." on tape, after the tape services contract (FEASIBILITY roadmap 5; files reach the desktop as tapes) |

- Each slice starts with its interface section here: exact pixels, routines, and how each bound is measured.
- Z80: main model. Models and tests: Sonnet, from this contract. Runs: Haiku. A missed speed bound is recorded with options.

## 10. Decisions (owner, 2026-11-12: "i agree with your decisions", every recommendation taken)

1. **Scope and slices** as section 9: editing first, then the clipboard, then files once tape services exist. *Alternative:*
   tape services before Write, so that W1 can save.
2. **Capacity 5,120 codes** (about 900 words), in the app arena. More needs RAM that banked code cannot see today (`$5800`,
   `$7800`) or a smaller window and clipboard.
3. **One large window** below the menu bar (**EST** (16, 16, 480, 168): 16 lines of about 80 codes).
4. **Scroll with `G_SCROLLV`** plus the new lines. Unlike `List` (where the owner took the full redraw), a full redraw here is
   about 15 frames.
5. **Ask before discarding a changed document** (quit or "New"), since nothing can be saved until W3.
6. **No Home / End or word moves in W1:** the TS2068 has no free keys for them; they can take SS combinations later if wanted.

## 11. W1 interface (designed 2026-11-12, binding for the W1 code and tests)

The tests are written from sections 1-10 and this section, never from the code.

### 11.1 Amendments

- **The line table holds a byte per display line, its length in codes** (2.1 said a word, its start). An edit then changes only
  the lengths of the lines it rewraps; starts would all move by the edit's length.
- **At most 1,024 display lines** (the table's room). A code or a paragraph end is inserted only when L < 5,120 **and** the
  document has fewer than 1,024 lines; otherwise nothing changes (no draw).
- **The text view is on the byte grid** (x and w multiples of 8), so that `G_SCROLLV` moves all of it.
- **Scrolling is a drawing mode** of the text view (section 5's list gains "scroll by d lines"): inside `M_DRAW`, under each
  clip `W_DRAWVIEW` gives, `G_SCROLLV` of the clipped text view, then the lines that meet the uncovered rows. A covered window
  scrolls correctly that way.

### 11.2 Program 3 and the shell

- `K_PROGS` gains `WR_START` (program 3). The shell gains a third icon, "Write", at (176, 40) (64 x 26, SHELL 10.5), its bitmap
  in `icons.txt`, and its "Leap" menu an item "Write" (id 5) after "Controls". `S_NICONS` = 3.
- **Start** (SHELL 10.3): the image copied; `MB_SET` of the "File" menu; the buffer (5,120) and the line table (1,024) taken
  with `K_ALLOC`; an empty document; the window built and opened; the focus on the text view; `K_MSET` 1; the event loop
  (`TK_DISPATCH`).

### 11.3 The window

| View | Class | Rectangle | Notes |
|---|---|---|---|
| The window, "Write" | `CWindow` | (16, 16, 480, 168) | id 255 |
| The text view | `TextView` (banked, in the image) | (24, 30, 448, 144) | id 1, focusable |
| Its bar | `VScroll` | (478, 28, 12, 148) | id 2, target the text view |

- **The menu** (id 1) "File": "New" (id 1).
- **The text view:** lines shown n = 16; text width W = w - 4 = 444. Line j shown (0 <= j < 16) is document line top + j:
  - its band is (24, 30 + 9 j, 448, 9);
  - its text is `G_TEXTP` at (27, 30 + 9 j): the line's codes, without a final 13 (PROP6's row 0 is blank: ink rows 1-7);
  - a band with no line is paper.
- **The caret,** when the text view has the focus (`K_FOCUS`, not being drawn by its blur): `SET` fill
  (min(26 + tw, 471), 30 + 9 j, 1, 9), where j is the caret's line less top and tw the width of the codes from the line's start
  to the caret. Nothing when that line is not shown.

### 11.4 Lines (2.1, exact)

- **A line from a start s:** walk the codes from s, summing advances.
  - Code 13 ends the line, included in it.
  - When a code that is not a space makes the sum exceed W: the line ends after the last space in it, when it has one;
    otherwise before that code (but it always holds at least one code).
  - When a space makes the sum exceed W: the line ends after that space and every space directly after it.
  - The end of the document ends the line.
  - **A line holds at most 255 codes** (its length is a byte): the 255th code ends it (only a long run of spaces can reach it).
- **The lines of the document:** from 0, line after line, until the end. When the document is empty, or ends with 13, the last
  line is an empty line at the end. So there is always at least one line, and the lengths sum to L.
- **The caret's line** is the last line whose start <= caret.
- **Positions in a line** (for UP, DOWN and clicks): its start up to its last code when another line follows; up to L for the
  last line.

### 11.5 Behaviour (section 4, exact)

- **Insert** (32-126 or ENTER), when allowed (11.1): the code at the caret; caret + 1.
- **DELETE:** when caret > 0, the code before it removed; caret - 1.
- **LEFT / RIGHT:** caret - 1 / + 1, within 0..L.
- **UP / DOWN:** to the line above / below. The target x is the caret's tw when the first UP or DOWN of a run was pressed (any
  other key, a click or an edit ends the run). The caret goes to the position in that line given by TOOLKIT 10.4's click rule
  with px - pen = target x. On the first line UP puts the caret at 0; on the last line DOWN puts it at L.
- **Click** (`E_DOWN` in the text view) at (px, py): the line top + floor((py - 30) / 9), or the last line when that is past
  it; the position by TOOLKIT 10.4's rule with r = px - 27, within the line's positions. `E_UP`, and `E_MOVE` with the capture,
  are consumed.
- **Shown:** after each of these, when the caret's line is above top, top = that line; when it is at or below top + 16, top =
  that line - 15.
- **The bar** (its fields are bytes): with M = max(0, lines - 16), the scale k is the smallest of 1, 2, 4 with
  ceil(M / k) <= 255. Value = floor(top / k), max = ceil(M / k), page = 16 / k, set (`TK_SETBAR`, which makes the
  value at most max: top can be past M after lines are deleted) whenever one of them changes. Its `E_SCROLL`: top = min(value x k, M); the caret does not move.
- **Changed:** any insert or delete sets it; the start and "New" clear it.
- Keys not listed are not consumed (TAB has no other view to go to).

### 11.6 Quit and "New"

- **Quit:** the `CWindow`'s `E_CMD` (its close box, or SS+Q through `TK_DISPATCH`). **"New":** `E_MENU` 1, 1.
- When the document has not changed: quit is `K_QUIT`; "New" empties the document (top 0, caret 0, the view drawn).
- When it has: the **dialog** opens first: a `Dialog` (128, 64, 256, 64) with a `Label` "Discard the document?" at
  (144, 76, 200, 9), a `Button` "Discard" at (224, 100, 64, 16), id 1, the default, and a `Button` "Cancel" at
  (304, 100, 64, 16), id 2, the cancel.
  - "Discard": the dialog closes, then the quit or the "New" goes ahead.
  - "Cancel": the dialog closes; nothing else changes.

### 11.7 Symbols for the tests (prefix `WR_`: the window manager has `W_`)

`WR_START`, `WR_END` (Write's bytes in DOCK 2-3), `WR_IMG`, `WR_IMG_LEN`, `WR_WIN`, `WR_TV` (the text view), `WR_BAR`, `WR_DLG` (the
dialog, 0 until first opened), `CL_TextView`; the document: `WR_BUF` (word: the buffer), `WR_GS` and `WR_GE` (words: the gap's
start and end, offsets in the buffer; the caret is `WR_GS`), `WR_LT` (word: the line table), `WR_NL` (word: lines), `WR_TOP`
(word), `WR_CHG` (byte: changed). The text is the buffer's [0, `WR_GS`) then [`WR_GE`, 5,120).

### 11.8 How the bounds are measured (section 7)

- **Typed code at the end of a line:** the document "The quick brown fox jumps over the lazy dog. " repeated until the first
  line is full, the caret at the end of line 0's last word, which still fits one more code; `E_KEY` 'x' through
  `K_DISPATCH`.
- **At the start of an 80-code line:** line 0 of 80 codes with room for one more code, the caret at 0, `E_KEY` 'x'.
- **Rewrap of a 10-line paragraph:** one paragraph of 10 lines, the caret at 0, `E_KEY` 'x' (every line rewraps).
- **Caret moves:** RIGHT, LEFT, DOWN, UP with the caret in line 5 of 16 full lines.
- **Scroll by one line:** 40 lines, top 0, the caret on line 15, `E_KEY` DOWN.
- **Full draw:** 16 lines of about 80 codes, `W_DRAWVIEW` of the text view, focused.
- Each the worst of three, with the text view focused and the window in front.

### 11.9 As built (2026-11-12)

**W1 is done on emulators.** The owner has not yet tried it.

**Bytes:**
- Write is 3,406 in DOCK 2-3 (`WR_END - WR_START`; EST 3,000-4,000). Its image is 185 (<= 1,024). Pool growth 0.
- DOCK 2-3 has about 8,000 bytes left.

**Bounds** (TSRun T-states; `tests/wr-perf.mjs`):

| Measure | Measured | Bound |
|---|---|---|
| Typed code at the end of a line | 53,346 | <= 58,000 |
| Typed code at the start of an 80-code line | 104,175 | <= 117,000 |
| Rewrap of a 10-line paragraph | 98,686 | report |
| Caret RIGHT / LEFT / DOWN / UP | 16,202 / 23,084 / 20,768 / 20,383 | <= 58,000 |
| Scroll by one line: by DOWN / by a bar arrow | 341,357 / 411,888 | report (EST 190 k) |
| `W_DRAWVIEW` of 16 lines of about 80 codes | 950,427 | report (EST 870 k) |
| Stack: deepest `M_EVENT` / `M_DRAW` | 70 / 36 bytes | <= 128 |
| Launch | 14 frames | <= 30 |
| `DI` / interrupts lost | none / 0 | none / 0 |

- **The scroll bound waits for the owner,** as `List`'s did (`docs/TOOLKIT.md` 10.10).

**Where the scroll's time goes** (profiled):
- `G_SCROLLV` of the text area about 163 k.
- The bar's redraw (`TK_SETBAR`) about 67 k.
- `W_DRAWVIEW`'s cell-row scans about 40 k.
- The new line about 24 k.

**How partial draws stay cheap (as built):**
- For the caret, one-line and lines modes, Write narrows the text view's `View_y` / `View_h` to the rows it draws for the
  `W_DRAWVIEW` call, then puts them back.
- The text view draws from the fixed rectangle of 11.3, so the pixels are the same. `W_DRAWVIEW` scans and clips only those
  rows (a caret move went from 51 k to 21 k T).
- Text widths are summed in at most two runs, either side of the gap.

**Tests (Sonnet, from the contract; the main model re-ran them on seeds 1 and 2):**
- `tests/wr-w1.mjs` 12 of 12 groups; `tests/wr-demo.mjs` 7 of 7 over real frames; `tests/wr-perf.mjs` 14 pass, 0 missed, 5 reported.
- Model `tests/wr-model.mjs` (`--self-test`, 49 hand cases); harness `tests/wr-lib.mjs`.
- **Regression:** the shell suites cover three icons (`shell-s1` 13 of 13, `shell-perf` 24 pass); the Calculator and toolkit
  suites pass.

**Cross-emulator:**
- ZEsarUX 13.0: 62 of 62 rows. 22 are new: Write opened by keys; a 169-code paragraph and 16 short lines typed with 11 SYMBOL
  SHIFT characters, so the view wraps and scrolls; an edit; the discard dialog; Discard back to the shell. Every screen is
  identical to TSRun's, the document variables are equal, and DOCK is unchanged.
- Fuse: boot rows only.

**Found and fixed by the tests:**
- A scroll of exactly 15 lines: 9 x 15 = 135 overflowed a signed byte in `G_SCROLLV`'s argument.
- The "to the bottom" redraw after a change of the line count used line 1,016 as its end, so past that line nothing below was
  redrawn (a caret was left on screen).
- At 1,024 lines a DELETE that joins paragraphs lost a line (the rewrap opened a slot for an old line it was about to replace).

**Clarifications the tests adopted (binding from now on):**
- A click below the last line puts the caret in the last line by x (11.5; section 4's "the document's end" is superseded).
- A refused insert changes nothing, the run and the changed flag included.
- DELETE at 0 does not set changed.
- UP on the first line and DOWN on the last stay in the target-x run.
- The dialog opens with "Discard" focused; after it closes the focus is the text view.
- A 13 directly after a run of overflow spaces starts its own one-code line.

**For the owner:**
1. The scroll figures: set the bound as for `List` (`docs/TOOLKIT.md` 10.10), or ask for a faster scroll.
2. Try Write in the browser (`web/?cart=desk5`, the Write icon or the "Leap" menu's "Write").

### 11.10 Owner review (2026-11-12)

- **The owner tried Write:** "The scrolling was smooth and everything looked really good." W1 is accepted.
- **Scroll bounds at the measured figures** (rounded up to 100 T, as `List`'s, TOOLKIT 10.10): a scroll by one line
  **<= 341,400 T** by DOWN and **<= 411,900 T** by a bar arrow.
- **Found while trying it: the test page's "Joystick" switch,** on by default, sent Space and the arrow keys to joystick 1,
  so Space did not type. The owner's decision: the TS2068 joystick is not mapped to keys. `web/` now sends every key to the
  keyboard and reads joysticks 1 and 2 from connected gamepads (`tsrun/joystick.js`); the header shows the pad on joystick 1.
  `tests/web-smoke.mjs` checks that Space and the arrows reach the key matrix and leave the joystick idle.

## 12. W2 interface (drafted 2026-11-12, **awaiting the owner's approval**; binding for the W2 code and tests once approved)

The tests are written from sections 1-11 and this section, never from the code. The decisions in 12.10 are recommendations
until the owner takes them.

### 12.1 Amendments

- **Selecting with the keys is a mark, not SHIFT** (section 9 said "SHIFT with the caret keys"). On the TS2068 that cannot work:
  CAPS SHIFT already makes the caret keys (CS + 5-8), SYMBOL SHIFT + 5-8 type `%`, `&`, `'` and `(`, and CS + SS together
  toggles keyboard-pointer mode (OBJECTS_EVENTS 14.3). So a new key, **MARK** (code 18, on **SS+E**, "E for extend"), turns on
  extending: the caret keys then move one end of the selection (12.4). This is the platform's own tradition (Tasword's block
  marks). On the test page SS is Ctrl, so MARK is Ctrl+E.
  - `keymap.txt`: SS+E becomes `MARK` (was `-`), and `tools/gen-keymap.mjs` gains the name `MARK: 18`. Same bytes; every
    cartridge's map changes in that one entry (as SS+Q did). SS+W and SS+I stay without a code (Ctrl+W closes a browser tab).
- **The clipboard is in cold RAM**, not the arena (section 9): **`$7800-$7FFF`, 2,048 codes**, as FEASIBILITY 3 planned
  (cold kernel data, free in modes 0, 2 and 6). The arena has 960 bytes free after Write starts, and the dialog needs some of
  them, so an arena clipboard would hold about 700 codes.
  - `$7800` is RAM under K and R, not under A (BANKING 1), so Write copies to and from it by `KFAR K_LDIR`.
  - **`K_LDIR`** is a new label on the `ldir` / `ret` that ends `k_zero` (`src/kernel/kernel.asm`, chunk 5): HL, DE and BC
    reach it unchanged through `KFAR`, and BC is never 0. **Pool growth stays 0 bytes.**
  - The clipboard is **Write's own:** its length is a variable in Write's image, 0 at each start; "New" keeps it; quitting
    loses it. (Making it the desktop's, shared by `Field` and later programs, moves one word to kernel RAM: a later decision.)
- **Section 4's key table** gains MARK, and the caret keys, DELETE and typing change when there is a selection (12.4).
- **Section 5's drawing modes** gain **"selection":** the pixels that a change of the selection alters. It still gives exactly
  the pixels of a full draw.

### 12.2 The selection

- **State:** the caret (`WR_GS`, as W1), an **anchor** (a document offset 0..L), and the **mark** (a byte: 0 off, 1 on).
- **The selection** is [min(anchor, caret), max(anchor, caret)); S = its length. It is **empty** when anchor = caret.
- After every edit (a typed code, ENTER, DELETE, Cut, Paste), "New", and the start: anchor = caret, mark 0.
- `E_SCROLL` from the bar changes neither the selection nor the mark.

### 12.3 Looks (exact pixels)

Shown line j (0 <= j < 16) is document line t = top + j; it holds codes [s, s + n). tw(i, k) is as 11.3 (PROP6 advances of
codes i..k - 1).
- **The caret** (11.3) is drawn only when the selection is empty.
- **The selected part of line t:** a' = max(a, s), b' = min(b, s + n), where [a, b) is the selection. When a' < b':
  - x0 = min(26 + tw(s, a'), 471): the blank column before code a' (the caret's column for a');
  - x1 = 472 when b' = s + n and t is not the last line (the line's last code, a 13 or the end of a wrapped line, is selected:
    the inversion runs to the text view's right edge); otherwise x1 = min(27 + tw(s, b'), 472) (through the blank column of
    code b' - 1);
  - **`XOR` fill (x0, 30 + 9 j, x1 - x0, 9)**, drawn after the line's text, whether or not the text view has the focus.
- So a selection inside one line inverts its codes with one blank column either side; a selection over several lines inverts
  each whole line between to the right edge, as on a Macintosh.
- **The "Edit" menu** is the kernel's drop-down (WINDOWS 8); a disabled item is drawn as the kernel draws it.

### 12.4 Behaviour (exact)

**Keys** (the text view has the focus):

| Key | Mark 0, selection empty | Mark 0, a selection | Mark 1 |
|---|---|---|---|
| MARK (18) | mark 1 (anchor = caret, already) | mark 1 (the anchor kept: the selection is extended from here) | mark 0, anchor = caret (the selection is cleared) |
| LEFT / RIGHT | as W1 (11.5) | caret = the selection's start / end; nothing else moves | the caret moves as W1; the anchor stays |
| UP / DOWN | as W1 | caret = the start / end, then UP / DOWN as W1 from there | the caret moves as W1; the anchor stays |
| 32-126, ENTER | as W1 | the selection deleted, then the code inserted by W1's rule (11.1) | as the columns before (by whether the selection is empty) |
| DELETE | as W1 | the selection deleted (caret = its start) | as the columns before |

- In the first two columns anchor = caret after the key; in the last column (caret keys) the anchor stays.
- **The UP / DOWN run** (11.5) is unchanged: MARK is "any other key" and ends it; caret keys with the mark on keep it.
- **The caret stays shown** (11.5, "Shown") after each of these, scrolling as W1.
- **Typing over a selection when the insert is refused** (W1's rule: 1,024 lines): the deletion stands and nothing is inserted.

**Pointer** (`E_DOWN` and `E_MOVE` with the capture; the position by 11.5's click rule):
- **`E_DOWN`** at (px, py): the caret goes to the position. Mark 0: anchor = caret. **Mark 1: the anchor stays** (a click
  extends the selection, as SHIFT + click elsewhere). The mark is unchanged.
- **`E_MOVE` with the capture** (a drag): the caret goes to the position of (px, py), the line **clamped to the lines shown**:
  the line top + floor((py - 30) / 9) when py >= 30, else top; at most top + 15 and at most the last line. The anchor stays.
  **No autoscroll** (12.10, decision 4).
- **`E_UP`:** consumed; nothing changes.
- A click on the text view (`E_DOWN` then `E_UP` at one point) with the mark off leaves an empty selection: W1's click.

**The "Edit" menu** (id 2, after "File"):

| Item | Id | Enabled | Action (`E_MENU` 2, id) |
|---|---|---|---|
| Cut | 1 | 1 <= S <= 2,048 | the clipboard = the selection's codes; the selection deleted |
| Copy | 2 | 1 <= S <= 2,048 | the clipboard = the selection's codes; the selection is kept, mark 0 |
| Paste | 3 | clipboard length C >= 1 | when the result holds at most 5,120 codes and at most 1,024 lines: the selection deleted, then the C codes inserted at the caret, the caret after them. Otherwise nothing changes (the selection kept) |
| (separator) | 0 | never | |
| Select all | 4 | always | anchor = 0, caret = L, mark 0 (the view follows the caret: "Shown") |

- **The enabled bits** are set with `MB_ENABLE` whenever they change (Write keeps the last bits it set); at the start Cut,
  Copy and Paste are disabled (their flags in the menu table).
- A disabled item never sends `E_MENU` (the kernel's), so Cut and Copy never see S = 0 or S > 2,048, nor Paste C = 0.
- **Paste's 1,024-line check is exact:** the lines of the text after the paste, wrapped by 11.4, counted before anything
  changes.
- **Changed** (11.5) is set by Cut, Paste, a typed code, ENTER and DELETE that change the text; not by Copy, Select all, MARK or
  a selection.
- The dialog (11.6) is unchanged. While it is open no menu opens (the kernel's modal rule: WINDOWS 8 and 17), so "Edit"
  cannot act behind it.

### 12.5 The clipboard

- **`WR_CLIP` = `$7800`**, codes only, no length byte; **`WR_CLN`** (word, in the image) its length C, 0..2,048.
- Cut and Copy write [selection start, end) of the document's text (32-126 and 13) to `$7800`; Paste reads `$7800`.
- Copies go by `KFAR K_LDIR`, at most two runs a copy (the selection or the insert either side of the gap).
- `$7800-$7FFF` is written only by Cut and Copy. Nothing else in `desk5` uses it (the tests' memory watch allows it).

### 12.6 Where things live (section 6 for W2)

| Where | What |
|---|---|
| DOCK 2-3 | the selection, MARK, the "Edit" menu's handler, the clipboard copies, Paste's line count, the selection drawing |
| The image | the "Edit" menu in the menu table; `WR_AN` (word, the anchor), `WR_MK` (byte, the mark), `WR_CLN` (word), the enabled bits |
| Cold RAM `$7800-$7FFF` | the clipboard |
| Arena | unchanged (960 bytes free after the start, as W1) |
| Pool | **0 bytes** (the label `K_LDIR` only); `keymap.txt`: SS+E = `MARK` |

### 12.7 Symbols for the tests (11.7, plus)

`WR_AN` (word), `WR_MK` (byte), `WR_CLN` (word), `WR_CLIP` (EQU `$7800`), `WR_MENU` (Write's `E_MENU` handler: called with
`K_EV` holding an `E_MENU` record, it returns when done; it is what Write's loop calls), `K_LDIR`, `MARK` (18, from the key
map).

### 12.8 Bounds and how they are measured (section 7 for W2)

| Measure | Bound |
|---|---|
| Write's bytes in DOCK 2-3 for W2 | **report** (**EST** +1,200-1,800; all of Write <= 7,000 still) |
| Pool bytes / RAM image | **0** / <= 1,024 |
| **Extend by one code:** mark 1, a 10-code selection inside line 5 of 16 full lines, RIGHT | <= 58,000 |
| **Extend by one line:** the same, DOWN | <= 58,000 |
| **A drag step:** the capture held, a selection ending in line 5, `E_MOVE` to the same x in line 6 | <= 58,000 |
| A drag over the view: anchor at line 0's start, `E_MOVE` to the end of line 15 | **report** |
| **A typed code over a selection:** a document whose line 0 is a whole paragraph of 70 codes, codes 20-29 selected, 'x' | <= 117,000 (as W1's line start) |
| DELETE of a selection of 3 whole lines (lines 4-6 of a 40-line document, top 0) | **report** |
| Copy of 2,048 codes (`WR_MENU` with `E_MENU` 2, 2) | **report** (**EST** 46 k: `LDIR` is 21 T a code) |
| Cut of lines 0-15 (about 1,280 codes) of a 40-line document, top 0 | **report** (rewrap and a full draw, **EST** about 1.1 M) |
| Paste of 1,280 codes at the start of line 5 of a 40-line document | **report** |
| Select all of a 5,120-code document, the caret at 0 | **report** |
| `W_DRAWVIEW` of 16 lines of about 80 codes, all selected | **report** (W1's 950 k plus 16 fills) |
| W1's rows (11.9) again, after W2 | W1's bounds (11.9-11.10) |
| Stack: the text view's `M_DRAW` / `M_EVENT`, and `WR_MENU`, crossings included | <= 128 bytes |
| `DI` / frame interrupts lost | none / 0 |

- Key rows: `K_DISPATCH` of `E_KEY` to the return; pointer rows: `K_DISPATCH` of the `E_MOVE` with `K_CAPTURE` = the text view;
  menu rows: `WR_MENU` with a sentinel return. The documents are built as 11.8's ("The quick brown fox ..." repeated), the
  text view focused, the window in front, interrupts on, the worst of three.
- The **report** rows become bounds once the owner has tried them, as the scroll did (11.10).

### 12.9 Tests (Sonnet, from this contract; TSRun headless, `tests/wr-w2.mjs` and the W1 harness)

1. **The model** (`tests/wr-model.mjs` grows): anchor, mark, clipboard, the Edit menu's enabled bits; hand cases for every cell
   of 12.4's table, Paste's refusals at 5,120 codes and 1,024 lines, a selection of 2,048 and 2,049 codes.
2. **Random editing** with MARK, the caret keys, drags, clicks with and without the mark, Cut, Copy, Paste, Select all and
   "New", against the model: the text, caret, anchor, mark, clipboard (read from `$7800`), changed, top, the bar.
3. **Looks:** the screen after each step against the model's rendering of 12.3 (covered windows included); every drawing mode,
   "selection" included, equal to a full draw.
4. **The menu:** the enabled bits read from the kernel's menu entry after each step; a disabled item clicked sends nothing.
5. **Regression:** `wr-w1`, `wr-demo`, the shell, Calculator and toolkit suites, and the kernel's key-map tests with SS+E =
   `MARK`.
6. **Bounds:** 12.8 as a table (`tests/wr-perf.mjs` extended).
7. **Cross-emulator:** on ZEsarUX, a key-driven session: text typed, MARK and the caret keys select across lines, the "Edit"
   menu by MENU (CS+9) and the arrows: Copy, then Paste further on; every screen identical to TSRun's.

### 12.10 For the owner: decisions (recommendations; nothing is built until approved)

1. **MARK on SS+E** (Ctrl+E on the test page) for selecting with the keys (12.1). *Alternatives:* SS+I (no mnemonic); a
   different key moved off its SS character.
2. **The clipboard in cold RAM `$7800`, 2,048 codes, Write's own** (12.1). *Alternative:* in the arena as section 9 drafted,
   about 700 codes, and no `K_LDIR`.
3. **"Select all"** in the "Edit" menu beside Cut, Copy and Paste. *Alternative:* leave it out (it is about 40 bytes).
4. **No autoscroll while dragging;** a selection longer than the view is made with MARK and the caret keys (which scroll), or
   MARK, the bar, then a click (a click extends while the mark is on). *Alternative:* autoscroll, a tracking loop inside the
   text view like `VScroll`'s, a line per scroll (about 6 frames each, 11.10), **EST** +250 bytes.
5. **No sign that the mark is on** until the selection grows. *Alternative:* "Write" in the title becomes "Write: mark"
   (a title redraw on each MARK).
6. **No key shortcuts for Cut, Copy and Paste** (only SS+I and SS+W are free, and Ctrl+W closes the browser tab); the "Edit"
   menu is reached by MENU (CS+9) and RIGHT.
