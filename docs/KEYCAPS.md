# Key Caps (contract, 2026-11-14; owner: replace the Controls demo with "Key Caps")

**What it is.** Program 2 becomes Key Caps, replacing Controls, the toolkit demo, which has served its purpose. It shows the
TS2068 keyboard and what every key types:
- in the plane the user picks: plain, CAPS SHIFT or SYMBOL SHIFT;
- or in the plane of the shift keys being held.

Keys that are down are shown pressed. A status line names the last key typed and its code.

It helps with the symbol layout (`src/kernel/keymap.txt`: MARK = SS+E, CLOSE = SS+Q, TAB = CS+1, ESC = CS+4, ...). It reads
the kernel's own `KEYMAP`, so it always shows the map in force.

**Where it lives:**
- Code in DOCK 2-3; symbols take the prefix `KC_`.
- Its RAM image is at `PROG_IMG`, ending at or below `AL_RAM`.
- No pool bytes, no kernel change.
- It uses the app library (APPLIB) for its window and views. Under the owner's rule, anything Key Caps needs that another
  program could use goes into the library.

## 1. The window (pixels)

| View | Class | Rect (x, y, w, h) | Flags, id | Word |
|---|---|---|---|---|
| The window | `CWindow` | (32, 32, 448, 136) | 0, 255 | title "Key Caps" (role bit 3) |
| "Plain" | `Check`, a radio | (48, 48, 96, 9) | $19 (checked at start), 1 | "Plain" |
| "Caps Shift" | `Check`, a radio | (160, 48, 120, 9) | $11, 2 | "Caps Shift" |
| "Symbol Shift" | `Check`, a radio | (296, 48, 136, 9) | $11, 3 | "Symbol Shift" |
| The keyboard | `KeyCaps` (a View; `M_DRAW` banked) | (40, 62, 432, 88) | 0, 4 | — |
| The status line | `Label` | (48, 154, 400, 9) | 0, 5 | the status text |

The radios behave as Controls' did (TOOLKIT 9): one is checked; a click, or SPACE when one is focused, checks it and posts
`E_CMD` with its id.

## 2. The keyboard

**Layout.** Four rows of 10 caps, in the TS2068's order:

| Row r | Keys, left to right | Stagger s_r |
|---|---|---|
| 0 | 1 2 3 4 5 6 7 8 9 0 | 0 |
| 1 | Q W E R T Y U I O P | 6 |
| 2 | A S D F G H J K L ENTER | 12 |
| 3 | CAPS SHIFT, Z X C V B N M, SYMBOL SHIFT, SPACE | 0 |

Each key is identified by its index k = 5 x half-row + bit, the `KEYMAP` index (keymap.txt order).

**One cap.** Column c of row r is the frame (x, y, 36, 18), with x = 40 + s_r + 40 c and y = 62 + 22 r. Its label is drawn
with `G_TEXTP` in SET at (x + floor((36 - tw) / 2), y + 5), where tw is the label's `G_TEXTW` width.

**The label** comes from the plane P shown (section 3):
- **The two shift keys** (k = 0 and 36) are labelled "CS" and "SS" in every plane.
- **Otherwise** the label is c = `KEYMAP[40 P + k]`:
  - 0: no label;
  - 33-126: that character;
  - otherwise the name below.

| Code | 1 | 3 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 27 | 32 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Name | Caps | Brk | Left | Right | Down | Up | Del | Enter | Tab | BTab | Menu | Close | Mark | Esc | Space |

**A pressed cap:** a key is down when its bit is set in `K_NOW` (8 half-row bytes). Its cap gets an XOR fill
(x + 1, y + 1, 34, 16), after its label.

**`M_DRAW`** clears the view's rectangle to paper, then draws the 40 caps.

## 3. Behaviour

- **The plane shown, P:**
  - 1 while CAPS SHIFT is held (`K_MODS` bit 0);
  - otherwise 2 while SYMBOL SHIFT is held (bit 1);
  - otherwise the checked radio's: Plain 0, Caps Shift 1, Symbol Shift 2.
- **Each frame without an event:** when P or any of the 8 `K_NOW` bytes differs from what the keyboard was last drawn
  with, the keyboard is redrawn (`W_DRAWVIEW`). It is not redrawn otherwise.
- **`E_KEY`** with code c (before the event is dispatched):
  - the status line becomes "Last key: " followed by the label of c (as section 2; a code with no name is shown as its
    character), then " (code " c in decimal ")";
  - the status line is redrawn;
  - then the event goes to `TK_DISPATCH` as usual, so arrows and TAB still move the focus among the radios.
- **At the start** the status line is "Press a key." and P = 0.
- **`E_CMD`:**
  - from a radio (id 1-3): the plane is set, and the keyboard redrawn when P changes;
  - 255 (the close box, or SS+Q): `K_QUIT`.
- **The shell:**
  - icon 2 becomes "Key Caps", with a keyboard icon (`src/apps/icons.txt`);
  - the "Leap" menu's "Controls" item becomes "Key Caps";
  - program 2 in `K_PROGS` is `KC_START`.

## 4. Bounds

| Measure | Bound |
|---|---|
| Key Caps' bytes (`KC_END` - `KC_START`, code and image) | <= 1,225 (what Controls took); **report** |
| Pool bytes | **0** |
| Its image and the RAM after it | <= `AL_RAM` |
| The keyboard's `M_DRAW` (40 caps, two of them pressed) | **report** (**EST** 150-250 k T: up to 4 frames) |
| The redraw after a key goes down, from the frame's `HALT` to the loop's next `HALT` | **report** |
| Stack (`M_DRAW`, the loop's paths), crossings included | <= 128 bytes |

## 5. Tests (Sonnet: `tests/kc-k1.mjs`, from this contract)

- **The model:** the labels of the 40 keys in each plane, from `KEYMAP` read out of the cartridge and the names table; P;
  the status text.
- **On the machine:**
  - the opened window against the model's rendering;
  - every key pressed alone, in each plane, through TSRun's keyboard: the caps, P and the status after each;
  - CAPS SHIFT and SYMBOL SHIFT held while the radios show another plane;
  - the radios by mouse and by keys;
  - the close box and SS+Q quitting to the shell;
  - a covering window moved over the keyboard (the redraw through `W_DRAWVIEW`).
- **Retired with Controls:** `tk-demo`, and Controls' rows in other suites, such as the shell's icon names, the "Leap"
  menu, and the ZEsarUX `desk5` runner's Controls session. They become Key Caps' rows. `List` and `Field` keep their own
  suites (`tk-t2`, `tk-t3`) and the dialogs.
- **Regression:** every `desk5` suite.
