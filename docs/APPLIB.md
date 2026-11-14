# The app library (contract, 2026-11-14; owner: "do the application library")

**Why:** the owner's standing rule (CLAUDE.md, 2026-11-14) is to look for code to share. Notepad's dialogs, alert and title
are general: Paint needs them, and so does every later program. This slice moves them into a documented library in DOCK
2-3, so that a new program calls them instead of copying them. Like `files.asm` (docs/FILES.md), it costs no pool bytes.

**What must not change:** what any program does or shows. The tests of Notepad, the shell and Controls pass unchanged,
except where a symbol they read moves (section 7).

## 1. Where it lives and how it is called

| | |
|---|---|
| **Source** | `src/apps/applib.asm`, assembled in DOCK 2-3 before the programs. Prefix `AL_` (calls), `al_` (internal). |
| **Callers** | Banked programs, with `CALL` under mapping A, interrupts on, as the `FS_` calls. Never kernel code. |
| **Registers** | Each call lists what it takes and what it clobbers. IY and the alternate set are always kept; IX only where a call says so. |
| **State** | None of its own between calls. The program keeps its objects (a dialog's pointer, its buffers) in its own image, and passes their addresses. Every object dies with the program's arena when it quits. |
| **RAM** | `AL_RAM` = $C3C0-$C3FF (64 bytes), the top of the 1 KB program-image area. `AL_INIT` writes the library's strings there. A program's image and the RAM it uses after it must end at or below $C3C0 (an `ASSERT` in each program). |

Strings and tables shown on the screen must be in RAM, because the kernel draws them under mapping K, where DOCK 2-3 is not
mapped (BANKING). So:
- **The library's own strings** live in `AL_RAM`: "OK", "Cancel", "Discard", "Discard the document?".
- **A program's strings** live in its image.
- **Dialog tables** are read only by the library, under A, so they may stay in DOCK 2-3.

## 2. The calls

| Call | Takes | Does | Clobbers |
|---|---|---|---|
| `AL_INIT` | — | Writes `AL_RAM`. Called once by each program, after it copies its image. | AF, BC, DE, HL |
| `AL_NEW` | HL -> a view-table entry (section 3) | Makes a view of the entry's class (`K_NEW`), sets its rectangle, flags, id, its word, and a Field's cap. Returns IX = the view, C = its role, HL past the entry. Used for a program's window. | AF, B, DE |
| `AL_VIEW` | IX = a parent; HL -> an entry | `AL_NEW`, then adds the view as the parent's last child, setting a Dialog parent's default and cancel by the role. Returns DE = the view, IX = the parent, HL past the entry. | AF, BC |
| `AL_ADD` | IX = a view; HL -> the word holding its parent | Adds the view as the parent's last child, for views a program builds itself, such as computed grids. IX is kept. | AF, BC, DE, HL |
| `AL_VIEWS` | IX = a parent view (a Window or a Dialog); HL -> a view table (section 3) | Makes each view in the table (`K_NEW`), sets its rectangle, flags, id and word, and adds it as the parent's last child (`K_ADDCHILD`). For a Dialog parent, it also sets the default and cancel buttons by their roles. Returns IX = the parent. | AF, BC, DE, HL |
| `AL_DIALOG` | HL -> a word holding a dialog (0 until made); DE -> a dialog table: the Dialog's 8 bytes, then a view table | Returns IX = the dialog, made with its views the first time and kept in the word. | AF, BC, DE, HL |
| `AL_ALERT` | HL -> the program's alert word; DE -> a message (a length byte and codes in RAM; a 13 breaks it into two lines) | Opens the alert (section 4), making it the first time. | AF, BC, DE, HL, IX |
| `AL_ASK` | HL -> the program's ask word | Opens "Discard the document?" with Discard (id 1, default) and Cancel (id 2, cancel), making it the first time. | AF, BC, DE, HL, IX |
| `AL_NAMEDLG` | HL -> the program's name-dialog word; DE -> 4 words: the Label's text, the Field's buffer (31 bytes), the Button's text, the text to put in the Field | Sets the dialog's Label, Field buffer and Button, puts the text in the Field (caret at the end) and opens the dialog with the Field focused, making it the first time (section 4). Returns IX = the Field. | AF, BC, DE, HL, IX |
| `AL_TITLE` | IX = a window; HL -> a prefix ("Notepad: "); DE -> a name (both length-prefixed, either may be empty, together <= 39 codes); BC -> the title buffer (40 bytes); carry set to mark the title row dirty | Builds the title: the prefix, then the name. It sets the window's title word; with carry set on entry, it also marks the title row dirty (`W_INVAL` of (x, y, w, 8)). | AF, BC, DE, HL |
| `AL_EXTNAME` | HL -> a name (length-prefixed, cap 30); DE -> an extension (4 codes, ".txt") | Adds the extension when the name has no "." and the result fits in 30 codes (WRITE 13.2's rule). An empty name is left empty: a program saves nothing under an empty name. | AF, BC, DE, HL |

Dialogs report through the program's own event loop, as now: a button's `E_CMD` carries its id, and the program knows which
dialog it opened. Closing is the program's `W_CLOSE` of its own word. The library adds no event handling.

## 3. The view table (`AL_VIEWS`, `AL_DIALOG`)

The table is the one Notepad's `wr_mkdlg` reads (WRITE 13.9). Each view takes 13 bytes:

| Bytes | Field |
|---|---|
| 0-1 | Its class (`DW`). A class of 0 ends the table. |
| 2-9 | x (`DW`), y (`DB`), w (`DW`), h (`DB`), flags (`DB`), id (`DB`): the View fields at offsets 8-15, in order. |
| 10 | Its role: bit 0 the Dialog's default button, bit 1 its cancel button (bits 0 and 1 only in a Dialog's table: they write the parent's Dialog fields), bit 2 a `Field` of cap 30, bit 3 the word goes at offset 17 (a Window's title, an Icon's name). |
| 11-12 | The word at offset 16 (17 with role bit 3): a Label's or Button's text, a Field's buffer, a Window's title. |

A dialog table starts with the Dialog's own 8 bytes, then a view table.

## 4. The standard dialogs (pixels as today)

| Dialog | Dialog rect | Views |
|---|---|---|
| **The alert** (WRITE 13.4) | (128, 64, 256, 64) | Label (144, 76, 224, 18), the message; Button "OK" (304, 100, 64, 16), id 1, default and cancel |
| **The ask** (WRITE 11.6) | (128, 64, 256, 64) | Label (144, 76, 200, 9) "Discard the document?"; Button "Discard" (224, 100, 64, 16), id 1, default; Button "Cancel" (304, 100, 64, 16), id 2, cancel |
| **The name dialog** (WRITE 13.2, 14.4) | (128, 56, 256, 80) | Label (144, 68, 200, 9); Field (144, 84, 224, 12), cap 30; Button (224, 108, 64, 16), id 1, default; Button "Cancel" (304, 108, 64, 16), id 2, cancel |

## 5. Who moves onto it

**Notepad:**
- `wr_dlg`, `wr_mkdlg`, `wr_alert`, `wr_tdo`, the title part of `wr_nm` / `wr_setname`, and the ".txt" rule of `wr_save`
  become calls.
- Its three tables (`WR_TDIS`, `WR_TSAV`, `WR_TALR`) and the strings "OK", "Cancel", "Discard" and "Discard the
  document?" go.
- Its variables `WR_DLG`, `WR_SDLG`, `WR_ADLG`, `WR_DK` and `WR_SFLD` stay.

**The shell:**
- The About box (SHELL 10.4) becomes `AL_ALERT` with "Leap Desktop, step 5", so `s_mkabout` and `s_addabout` go. Its
  Label is then the alert's (144, 76, 224, 18) instead of (144, 76, 200, 9). The text is drawn at the same place, so the
  screen must be identical: the tests judge it.
- Its icon loop's "add to the window" becomes `AL_VIEWS` only if that saves bytes.

**Controls (the demo):** its `D_TBL` views move to `AL_VIEWS` only if that saves bytes. Its table format differs (w is a
byte).

**Calculator:** its window and display are an `AL_NEW` / `AL_VIEW` table, and its computed button grid is added with
`AL_ADD`. It has no dialogs, so it does not call `AL_INIT`.

**Every program's window** (owner, 2026-11-14: "move the opportunities you found into the library"):
- **Notepad:** its window, text view and bar are a table (`WR_TWIN`); `wr_rect` and `wr_add` go.
- **The shell:** its window is a table (`S_TWIN`), and its icons are added with `AL_ADD`.
- **Calculator:** as above; `c_addchild` goes.
- Objects are made in the same order as before, so the arena's layout is unchanged.
- **Controls:** waits for the owner's decision on replacing it.

## 6. Measures and bounds

| Measure | Bound |
|---|---|
| Pool bytes | **0** |
| Notepad's bytes (WR_END - WR_START) | <= 7,000; **report** the drop (**EST** -300 to -400) |
| The library's bytes; DOCK 2-3 in all (FS_END) | **report**; DOCK 2-3 must not grow by more than 64 bytes net |
| Each program's image and the RAM after it | <= $C3C0 (`ASSERT`) |
| Every test of Notepad, the shell, Controls, Calculator and the toolkit | passes, the screens identical |
| The perf rows | unchanged, except the few T of an added `CALL` on a dialog's path (**report** each row that moves) |
| Stack of each call, crossings included | <= 128 bytes |

## 7. Tests

**Haiku:** the existing suites (W1-W4, `wr-demo`, `fs-f1`, `shell-s1`, the toolkit, Calculator, `kern-dclick`, the perf
suites) on the new build. Symbols the tests read stay, with these exceptions, whose tests change with them:
- **`WR_TDIS`, `WR_TSAV`, `WR_TALR`** move to the library, as `AL_TASK`, `AL_TNAME` and `AL_TALR`.
- **`s_mkabout`** goes.

**Sonnet, `tests/al-a1.mjs`:** each call against a model written from sections 2-4:
- `AL_VIEWS` with tables of every role;
- `AL_DIALOG` made once, then reused;
- `AL_EXTNAME` at 25, 26, 27 and 30 codes, with and without a ".";
- `AL_TITLE` at 39 codes, and the dirty title row;
- `AL_ALERT`, `AL_ASK` and `AL_NAMEDLG` against the standard dialogs' pixels;
- `AL_INIT`'s RAM;
- the stack of each call.

**Main model:** re-runs everything before the owner is told.

## 8. Readings fixed by the tests (2026-11-14, `tests/al-a1.mjs`)

- **`AL_TITLE` with an empty prefix or name** copied 64 KB (`LDIR` with BC = 0). It now copies nothing for an empty part:
  `al_ldir`, +6 bytes.
- **`AL_EXTNAME` leaves an empty name empty** (section 2).
- **Roles 0 and 1 are for a Dialog's table only** (section 3): on any other parent they would write past a Window's fields.
- **The alert and the ask open with the focus on their default button,** as the discard dialog always did.

