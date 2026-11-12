# The shell and the launcher: contract (draft 2, 2026-11-12, owner approved)

Roadmap step 5 (`docs/FEASIBILITY.md`), moved ahead of the toolkit's T2 and T3 (owner, 2026-11-12) so that a complete desktop
with Calculator comes first. One application at a time (FEASIBILITY 3; BANKING 9 decision 4). Marks as in FEASIBILITY:
**EMU** measured, **EST** estimated.

Style as `docs/WINDOWS.md`: every number in section 7 is a bound. **A missed bound is reported with its numbers before anything
is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

## 1. What it builds

1. **The launcher** (kernel, pool): `K_LAUNCH` starts a program, and `K_QUIT` ends the running one and starts the shell again.
   One program runs at a time; nothing of the last one is kept.
2. **The shell** (program 0, DOCK 2-3): a window "Leap Desktop" of program icons, and the "Leap" menu.
3. **The programs it starts:** Calculator (program 1), and the toolkit demo "Controls" (program 2), which moves out of
   Calculator into a program of its own. Each gains a "Quit" item that returns to the shell.

**Out:**
- **Icons on the desk itself** (GEOS-style). `Desk` is a kernel class that draws only paper, so icons on it need a kernel
  change. A window of icons needs none. Desk icons can come later under their own contract.
- **Tape files and the tape catalogue:** they need T2's `List`.
- **Desk accessories:** a program running over another.
- **Keeping a program's state across a switch:** Calculator starts at 0 again.
- **Close boxes** (WINDOWS 1: out): programs quit from their menu.

## 2. Memory

| Where | What |
|---|---|
| `$C000-$C3FF` | **The running program's RAM image** (BANKING rule 5), at most 1 KB, copied by the program's start. Was 512 bytes (Calculator) |
| `$C400-$DFFF` | The app arena (7 KB). `K_LAUNCH` resets it (`K_ARESET`) |
| Pool | `K_LAUNCH`, `K_QUIT`; the program table `K_PROGS` (the cartridge's: a word per program, its start in DOCK 2-3) |
| `$F0E9` | `K_PROG`: byte, the running program's number |

## 3. The launcher (pool, K)

**`K_LAUNCH`** (A = a program number; never returns):
1. SP = the stack's top, then the mapping K (the shadow first).
2. `K_PROG` = A.
3. Every open window is closed, front first (`W_FRONT`, `W_CLOSE`), and `MB_SET` 0 removes the menus.
4. `K_ARESET` of the app arena. `K_FOCUS`, `K_CAPTURE`, `W_MODAL` and the posted queue are cleared.
5. `W_UPDATE` repaints the desk.
6. `KFAR` to the program's start, `K_PROGS[A]`.
7. The start copies its image, sets its menu, opens its windows and runs its event loop. It never returns.

**`K_QUIT`** (no input): `K_LAUNCH` 0.

Programs call both through `KFAR`. Interrupts stay on throughout. There is no `DI`.

## 4. The shell (program 0)

**The window** "Leap Desktop" at (32, 24, 256, 80) holds one **icon** per program 1..n.
- Icons sit 64 pixels apart from (48, 40).
- An icon is a 32 x 16 bitmap (on the byte grid), with its name centred under it.

**`Icon`** is a banked class (the shell's, in its image; TOOLKIT decision 1). Its `M_DRAW`, through `KFAR`:
1. `CLR` fill of its rectangle (48 x 26: the bitmap and the name's row).
2. The bitmap by `G_BLIT`. The icons are built at assembly time, as one shifted copy each: x is a multiple of 8, so copy 0 is
   the only one `G_BLIT` reads. They are in the shell's image.
3. The name, `G_TEXTP`, centred, at y + 17.
4. **Selected:** the name's box (tw + 4 by 9) is inverted (`XOR`).
5. **Focused** (the kernel's focus): a dotted underline is not needed, because selected follows focus. The selected icon is the
   focused one.

**Events:**
- **`E_DOWN` on an icon:** focus and selection move to it, both drawn. A second `E_DOWN` on the same icon within 20 frames
  (`V_FRAMES`) opens it.
- **ENTER on the focused icon:** opens it.
- TAB and the arrows move the focus, as the kernel's defaults do.

**Opening:** `KFAR K_LAUNCH` with the icon's program number.

**The "Leap" menu:**
- "About Leap Desktop..." opens a `Dialog` with a `Label` and an OK button.
- A separator.
- "Calculator" and "Controls" launch those programs.

## 5. The programs

- **Calculator (program 1):** as `docs/CALCULATOR.md`, except:
  - its start copies its image and sets up its arena (no longer boot's job);
  - its menu becomes "Calc": "Clear", "Clear entry", a separator, "Quit" (`KFAR K_QUIT`);
  - "Controls..." leaves its menu.
- **Controls (program 2):** the demo of TOOLKIT 9.4 as a program of its own.
  - Its window is placed at (176, 32, 144, 112), and its menu is "Controls": "Quit".
  - It grows a `List` and a `Field` after T2 and T3.
- **Boot** (`desk5`): `K_LAUNCH` 0 after the kernel is set up. Boot no longer copies Calculator's image.

## 6. Where things live

- **Pool:** `src/kernel/launch.asm`, after the toolkit in chunk 5.
- **DOCK 2-3:**
  - `src/apps/shell.asm` and its icon art, `src/apps/icons.txt`, with a generator `tools/gen-icons.mjs`;
  - Calculator's `calc.asm`;
  - `demo.asm`, which becomes program 2.

## 7. Bounds (TSRun; direct calls with a sentinel return, interrupts off, unless stated)

| Measure | Bound |
|---|---|
| The launcher's bytes in the pool | <= 150 (**EST** 90). Step 5's pool growth stays <= 3,400 (BANKING 6.1) |
| The shell's bytes in DOCK 2-3 (code, image, icons) | <= 1,600 (**EST** 1,100) |
| A program's RAM image | <= 1,024 |
| Launch: from the shell's `E_DOWN` (the second click) to the program's window drawn, over frames | <= 30 frames (half a second; **EST** about 8) |
| Quit: from the "Quit" `E_MENU` to the shell's window drawn | <= 30 frames |
| `W_DRAWVIEW` of an icon, selected | **report** |
| 50 launch / quit cycles: the app arena's top back at its base, no window open but the program's, `K_FOCUS` / `K_CAPTURE` / `W_MODAL` / the posted queue as after a fresh launch, the shell's screen identical each time | exact |
| Stack: at a program's event loop after any number of launches | the same depth every time (no growth) |
| `DI` / frame interrupts lost | none / 0 |

## 8. Tests (Sonnet, from this contract; TSRun headless, the pattern of `tests/calc-c1.mjs`)

1. **The launcher:** random launch / quit sequences (direct and through the menus):
   - after each, the state of section 7's cycle row;
   - the memory watch (BANKING 10.7);
   - `V_FRAMES` +1 a frame.
2. **The shell:**
   - its screen against a gfx6-model rendering of section 4 (the window, the icons' bitmaps from `icons.txt`, the names, the
     selection);
   - clicks, double clicks (inside and outside 20 frames), TAB, the arrows and ENTER, against a model;
   - the About dialog by mouse and keys.
3. **The programs:** Calculator's and the toolkit's suites run unchanged on the new cartridge, entered through the shell.
4. **Bounds** (section 7) as a table.
5. **Cross-emulator:**
   - the shell's boot screen identical on TSRun, ZEsarUX 13.0 and Fuse 1.9.1;
   - on ZEsarUX, a key-driven launch of Calculator, a calculation, and Quit back to the shell, each screen identical to TSRun's.

## 9. Decisions (owner, 2026-11-12)

1. **A window of icons now;** icons on the desk itself later.
2. **One program at a time,** nothing kept across a switch.
3. **Opening:** double-click (within 20 frames), ENTER, or the "Leap" menu.
4. **Quitting: a close box,** not a menu item (the owner's question: "would adding a close box make it easier").
   - **Calculator and Controls have no menu.** Calculator's "Clear" and "Clear entry" only repeated its C and CE buttons. While
     they run the menu bar is empty.
   - The close box is `CWindow`, a toolkit `Window` subclass (10.1). The kernel's `Window` is unchanged, so `kern3` / `kern4`
     are too.
   - **From the keyboard: SYMBOL SHIFT + Q** ("Quit") closes the front `CWindow`. A new key code `CLOSE` (17) goes in the key
     map's free SS slot of Q.
   - SYMBOL SHIFT + X (the owner's other choice) holds `` ` ``. X's £ legend is not ASCII, and the key map must hold every
     printable ASCII character, so X would cost one.
5. **Icons:** 32 x 16 bitmaps that the main model draws in `src/apps/icons.txt`; the owner reviews them on screen.
6. **The Controls demo becomes program 2.**

Sections 1, 4 and 5 above are amended by 10: no "Quit" menu items; Calculator and Controls have no menu.

## 10. Shell slice interface (designed 2026-11-12, binding for the code and the tests)

### 10.1 `CWindow` (`Window`; no new fields; flags bit 5 = the close box pressed, internal) and `TK_DISPATCH`, in `tk.asm`

- **Draw:**
  1. `window_draw` (WINDOWS 14.3, 17.5): the frame, the title bar, the content, then the children.
  2. Then, only when the window has the **active** look (it is in front), the close box at the right end of the title bar,
     with (x, y, w) the window's:
     - `CLR` fill (x + w - 19, y + 1, 15, 7);
     - `SET` frame (x + w - 18, y + 2, 13, 5).

  The title must end before x + w - 21 (binding on programs).
- **Pressed look:** `XOR` fill (x + w - 17, y + 3, 11, 3). It is drawn directly by the event handler with the clip set to the
  box, shielded, then the clip set back to the whole screen, as `W_DRAG` does (WINDOWS 17.4).
- **`E_DOWN`** on the front `CWindow` inside (x + w - 19, y + 1, 15, 7) starts **tracking**, a loop like `W_DRAG`'s:
  - the box is pressed;
  - `E_MOVE`: the pressed look follows whether the point is inside the box;
  - `E_UP`: if it is pressed, it is released and the window is **closed by the user**;
  - anything else is dropped.

  Consumed. Every other event goes to `window_event`.
- **Closed by the user:** `E_CMD` is posted as `Button`'s (WINDOWS 17.3): C = the window's `View_id`, E = its slot. The
  program decides what closing means. Calculator and Controls quit to the shell.
- **`TK_DISPATCH`** (in place of `K_DISPATCH`, for programs):
  - an `E_KEY` with code `CLOSE` (17), when `W_FRONT` is a `CWindow`: closed by the user, as above;
  - otherwise not consumed, so it is dropped;
  - every other event: `K_DISPATCH`.

### 10.2 The key map

`src/kernel/keymap.txt`: Q's SYMBOL SHIFT entry becomes `CLOSE`. `tools/gen-keymap.mjs` learns the name `CLOSE` = 17, and so do
the step 3 tests' key-map readers. That is the only change to `kern3` and `kern4`: one byte of `KEYMAP`.

### 10.3 The launcher (`src/kernel/launch.asm`; section 3)

- **`K_LAUNCH`:** A = a program number, below `K_NPROGS`.
- **`K_PROGS`:** the cartridge's table, a word per program. The first is the shell's start.
- **`K_QUIT`:** `K_LAUNCH` 0.
- **The stack:** SP = `$FF00` (the stack's top) at step 1.
- **A program's start** (in DOCK 2-3, under A):
  1. copy its image to `$C000`;
  2. `MB_SET` (its menu, or 0);
  3. build and `W_OPEN` its windows;
  4. `K_MSET` 1;
  5. run its event loop, which uses `TK_DISPATCH`.

### 10.4 The shell

- **The window** "Leap Desktop" is a plain `Window` (the shell is not closed) at (32, 24, 256, 80).
- **Icons**, `Icon` views 48 x 26:
  - "Calculator" at (48, 40), program 1;
  - "Controls" at (112, 40), program 2.
- **An icon's bitmap** is drawn at (x + 8, y) by `G_BLIT`. The set is built by `tools/gen-icons.mjs` from `src/apps/icons.txt`:
  - 32 x 16 pixels, `#` ink and `.` paper;
  - opaque: mask 0;
  - copy 0 only (ws = 5 pairs a row, 160 bytes).
- **The name** is centred at (x + floor((48 - tw) / 2), y + 17).
- **Selected** (= focused, `K_FOCUS` = the icon): `XOR` fill of (tx - 2, y + 17, tw + 4, 9), the name's box.
- **`Icon` fields** after `View`'s: `prog` 1, `name` 2. Its flags bit 0 is focusable. The class is in the shell's image.
- **`E_DOWN`:** routing focuses it (Focus and Blur draw it). If the last `E_DOWN` on an icon was on this one, and
  `V_FRAMES` - its frame <= 20, it opens. Otherwise the frame and the icon are remembered. Consumed.
- **`E_KEY` ENTER:** it opens. Other keys are not consumed (TAB and the arrows move the focus).
- **Open:** `KFAR K_LAUNCH` with `prog`.
- **The menu** "Leap" (id 1):
  - "About Leap Desktop..." (1) opens a `Dialog` at (128, 64, 256, 64): a `Label` "Leap Desktop, step 5" at (144, 76, 200, 9)
    and an OK `Button` at (304, 100, 64, 16), which is the default and the cancel.
  - A separator (2).
  - "Calculator" (3) and "Controls" (4) launch those programs.

### 10.5 Amendment after the shell's tests (2026-11-12)

**`Icon` views are 64 x 26, not 48 x 26.**
- The bitmap is at (x + 16, y), still on the byte grid (x = 48 + 64 n).
- The name is centred in 64: tx = x + floor((64 - tw) / 2).

**Why:** Sonnet's test (`shell-s1` 2a) found that "Calculator" is 58 pixels wide, wider than a 48-pixel view.
- Its inverted name box was drawn outside the view's rectangle, which breaks `M_DRAW`'s rule (WINDOWS 4).
- When the selection moved on, the redraw, clipped to the view, left 7-pixel bars on screen.
- At 64 the widest name box (tw + 4 = 62) fits, and the icons, 64 apart, still do not overlap.
- **Binding on programs:** an icon's name is at most 60 pixels.

## 11. As built (2026-11-12)

**The shell slice is done on emulators.** `desk5` boots into the shell; Calculator and Controls launch from it and quit back
by their close box or SYMBOL SHIFT + Q. **Every bound passes** (`tests/shell-perf.mjs`, seeds 1 and 2: 21 pass, 5 reported):

| Measure | Measured | Bound |
|---|---|---|
| The launcher's bytes in the pool | 76 (82 with the program table) | 150 |
| The shell's bytes in DOCK 2-3 | 1,115 | 1,600 |
| Images: shell / Calculator / Controls | 483 / 205 / 81 | 1,024 |
| Launch, from the second click to the window drawn: Calculator / Controls | 14 / 10 frames | 30 |
| Quit, by the close box or SS+Q: Calculator / Controls | 9 / 9 frames | 30 |
| 50 launch / quit cycles | exact: the arena top, windows, focus, capture, modal, posted queue and the shell's screen identical each time; the event loop's SP one value | exact |
| `W_DRAWVIEW` of an icon, selected / not | 35,295 / 30,640 T | report |
| `K_LAUNCH` to a program's start | 264,044 T | report |
| `DI` / interrupts lost | none / 0 | none / 0 |

- **Step 5's pool growth so far:** 1,688 bytes (the toolkit's T1, `CWindow`, `TK_DISPATCH` and the launcher), of 3,400.

**Tests (Sonnet, from the contract; the main model re-ran them):**
- **`tests/shell-s1.mjs`:** 13 of 13 groups on seeds 1 and 2:
  - the launcher, by every way in and out;
  - the shell's look, strict against the model;
  - clicks, double clicks (opening at 20 frames, not at 21) and keys;
  - `CWindow`'s look and close-box tracking, and `TK_DISPATCH`;
  - the About dialog;
  - SS+Q in the shell;
  - the memory watch.
- **The Calculator and toolkit suites,** adapted to launch through the shell, pass as before.
  - `calc-c1` 5 of 5, `calc-perf` 9 of 9, `tk-t1` 8 of 8.
  - `tk-perf`'s one open row is the bar draw: 47,605 T against 47,600, the owner's call.
- **Cross-emulator:**
  - ZEsarUX 13.0: 25 of 25 rows. Boot, the shell, Calculator by ENTER, 123.45 x 6 = 740.7, SS+Q back: every screen
    identical to TSRun's, and DOCK unchanged.
  - Fuse 1.9.1: 6 of 6 rows, the boot screen.
- **Regression:** the step 3-4 suites pass. `kern-k2`'s hand-worked SS+Q now expects `CLOSE` (10.2).

**Found and fixed:** the 48-pixel `Icon` (10.5).

**Owner review (2026-11-12):** "desktop looks great". The shell's look and the two icons (`src/apps/icons.txt`) are approved.
