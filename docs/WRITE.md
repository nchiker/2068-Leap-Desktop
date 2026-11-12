# Write: contract (draft 1, 2026-11-12, for the owner)

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

## 10. Decisions for the owner (recommendations first)

1. **Scope and slices** as section 9: editing first, then the clipboard, then files once tape services exist. *Alternative:*
   tape services before Write, so that W1 can save.
2. **Capacity 5,120 codes** (about 900 words), in the app arena. More needs RAM that banked code cannot see today (`$5800`,
   `$7800`) or a smaller window and clipboard.
3. **One large window** below the menu bar (**EST** (16, 16, 480, 168): 16 lines of about 80 codes).
4. **Scroll with `G_SCROLLV`** plus the new lines. Unlike `List` (where the owner took the full redraw), a full redraw here is
   about 15 frames.
5. **Ask before discarding a changed document** (quit or "New"), since nothing can be saved until W3.
6. **No Home / End or word moves in W1:** the TS2068 has no free keys for them; they can take SS combinations later if wanted.
