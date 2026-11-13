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
