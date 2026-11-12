# Calculator: contract (draft 1, 2026-11-12; provisional points for the owner's review on screen)

Roadmap step 5 (`docs/FEASIBILITY.md`), the first banked application (`docs/BANKING.md` 3, decision 4: an app in DOCK 2-3).
It comes before the toolkit because it needs only the kernel's `Window` and `Button`, plus one view class of its own. So it
tests B0's crossing end to end in a real program. Marks as in FEASIBILITY: **EMU** measured, **EST** estimated.

Style as `docs/WINDOWS.md`: every number in section 7 is a bound. **A missed bound is reported with its numbers before anything
is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

**Provisional (owner to review on screen):** the look (section 4); the pocket-calculator rules (section 5); the extra keys `e`,
`n`, `c`; and booting straight into Calculator (section 3). The shell's contract will replace the boot with a launcher.

## 1. What it builds

- **The cartridge `desk5`** (DOCK 0-5). It boots the desktop as `kern4` does, without test code, then launches Calculator.
- **Calculator:** a window of 20 kernel `Button`s and one banked view, `CDisp` (the display). Its menu is "Calc": "Clear",
  "Clear entry". It runs its own event loop in DOCK 2-3 (mapping A).
- **Decimal arithmetic:** 8 significant digits, with exact rounding (section 6).

**Out:** quitting (there is no shell to return to), memory keys, percent, square root, the clipboard, scientific notation, and
showing which button a key stands for.

## 2. Where things live (`docs/BANKING.md` rules)

| What | Where |
|---|---|
| Calculator's code: event loop, key logic, arithmetic, `CDisp`'s draw | DOCK 2-3 (A); `src/apps/calc.asm` |
| **The RAM image:** `CDisp`'s class and its thunk, the window title, the button texts, the menu table, Calculator's variables | Assembled for `$C000`, copied there at launch; at most 512 bytes (`$C000-$C1FF`) |
| The app arena (window, buttons, display) | `$C200-$DFFF` |
| The launch: copy the image, `K_AINIT` / `K_ARENA` the app arena, `KFAR C_MAIN` | `desk5`'s boot (pool, about 30 bytes) |

- Calculator calls the kernel through `KFAR`, except the A-direct routines of BANKING 11.1 (`K_GETEV` in the loop, `K_NEW`).
- It never touches `$4000-$7FFF`.

## 3. The program

**`C_MAIN`** (A, never returns):
1. `MB_SET` the menu table.
2. Build the window and its children (section 4) and `W_OPEN` it.
3. `K_MSET` 1 (the mouse on).
4. The state is cleared ("C"), then the event loop:
   - **`K_GETEV`;** with carry, `HALT` and go back.
   - **`E_KEY`** whose code is a Calculator key (section 5): handled. Otherwise dispatched, so TAB and the MENU key work as
     usual.
   - **`E_CMD`:** the button's `View_id` is the key it stands for: handled as that key.
   - **`E_MENU`** (1, 1) = "C", (1, 2) = "CE".
   - **Everything else:** `KFAR K_DISPATCH`.
5. After a key changes what the display shows, `W_DRAWVIEW` of the display.

**`C_KEY`** (A, A = a key code): the state machine of section 5, then the display string. Exported for the tests.

## 4. The look (exact; the owner reviews it by eye)

- **The window:** a `Window` at (160, 24, 176, 144), titled "Calculator".
- **`CDisp`:** at (168, 40, 160, 16), a `View` subclass, not focusable. Its `M_DRAW` (banked, one thunk):
  1. `CLR` fill of its rectangle;
  2. `SET` frame of its rectangle;
  3. the display string `C_DSTR` in `SET` by `G_TEXTP` at (x + w - 4 - tw, y + 4), where tw = `G_TEXTW` of it (right
     aligned).
- **The buttons:** `Button`s 32 x 16, focusable, in 5 rows of 4. Button (column c, row r) is at (172 + 40 c, 64 + 20 r):

  | Row | Buttons (text: `View_id`) |
  |---|---|
  | 0 | `C`: 27, `CE`: 'e', `+/-`: 'n', `/`: '/' |
  | 1 | `7`, `8`, `9`, `*` |
  | 2 | `4`, `5`, `6`, `-` |
  | 3 | `1`, `2`, `3`, `+` |
  | 4 | `0`, `.`, `Del`: 12, `=` |

  A digit, an operator, `.` or `=` has its own ASCII code as id.

## 5. The rules (a pocket calculator with immediate execution)

**Keys** (`E_KEY` data 1, or a button's id):
- the digits `0`-`9`;
- `.`;
- the operators `+`, `-`, `*`, `/`, entered on the TS2068 with SYMBOL SHIFT + K, J, B and V (their own legends, so they do not
  depend on the open key-map review);
- `=`, and ENTER (13), which works as `=`;
- DELETE (12, CAPS SHIFT + 0): back space;
- ESC (27), BREAK (3) and `c`: clear all ("C");
- `e`: clear the entry ("CE");
- `n`: change the sign (`+/-`).

Any other code is not a Calculator key.

**State:**
- X, a value;
- OP: none, `+`, `-`, `*` or `/`;
- E, the entry: a string of at most 8 digits (a leading `0` before `.` counts as one), at most one `.`, and an optional
  leading `-`;
- ENT: 1 while a number is being typed;
- ERR.

**After "C":** X = 0, OP none, ENT 0, ERR 0, and the display shows "0".

**The display shows:**
- "Error" while ERR;
- otherwise E while ENT;
- otherwise the format of X (section 6).

**Each key:**
- **While ERR,** only C and CE do anything, and both act as C.
- **A digit:** if ENT is 0, E = "" and ENT = 1. If E then has fewer than 8 digits, the digit is appended, except that an E of
  "0" or "-0" has its 0 replaced.
- **`.`:** if ENT is 0, E = "0." and ENT = 1. Otherwise it is appended when E has no `.` yet.
- **Back space:** only while ENT. It removes E's last character; an E left as "" or "-" becomes "0".
- **`+/-`:** while ENT, it adds or removes E's leading `-`. Otherwise X = -X.
- **An operator o:**
  - While ENT: y = the value of E. If OP is not none, X = X OP y (section 6, which may set ERR); otherwise X = y. Then ENT = 0.
  - Then OP = o, in both cases. So with ENT = 0 a second operator only replaces the first.
- **`=`:**
  - If OP is not none: y = the value of E while ENT, else y = X. Then X = X OP y, OP = none, ENT = 0.
  - If OP is none and ENT is 1: X = the value of E, and ENT = 0.
  - Otherwise nothing.
- **CE:** E = "0", ENT = 1.

## 6. Numbers

- **A value** is s x M / 10^d, with M an integer, 0 <= M < 10^8, 0 <= d <= 7, and s = +1 or -1.
- **Normal form:** d is as small as it can be (no trailing zeros after the point), and 0 has s = +1.
- **The value of E:** its digits read as M, d the number of digits after its `.`, s from its `-`, then put in normal form. It is
  always exact, because E has at most 8 digits.
- **An operation** X OP y takes the exact rational result v, then rounds it:
  - **division by 0 sets ERR;**
  - otherwise the result is the representable value with the **largest** d <= 7 such that round(|v| x 10^d) < 10^8, where
    round is to the nearest integer, halves away from zero;
  - it is then put in normal form;
  - if no d >= 0 works, ERR is set.
- **Format:**
  - a `-` if s = -1;
  - then the integer part's digits (at least "0");
  - then, if d > 0, a `.` and the d fraction digits, zero-padded on the left.

  The longest string is "-0.0000001" (10 characters).

## 7. Bounds (TSRun, T-states, direct calls with a sentinel return, interrupts off, unless stated)

| Measure | Bound |
|---|---|
| Calculator's bytes in DOCK 2-3 (code and image) | <= 2,500 (**EST** 1,800) |
| Its RAM image | <= 512 |
| `desk5`'s pool bytes beyond `kern4`'s kernel (`far.asm` in page 0 not counted: BANKING 6.1) | <= 100 (**EST** 40) |
| `C_KEY` for a digit, with the display string written | <= 3,000 |
| `C_KEY` for `=` doing the slowest operation (a division) | <= 120,000 (**EST** 70 k, about 1.2 frames) |
| `W_DRAWVIEW` of the display, "-0.0000001" | **report** |
| A click on a button to the display redrawn | **report** |
| Interrupts lost over every frame test | 0 |

## 8. Tests (Sonnet, from this contract; TSRun headless, the pattern of `tests/bank-b0.mjs`)

1. **Arithmetic:**
   - at least 20,000 random X OP y pairs (random M, d and s, plus edge cases: 0, 99999999, 0.0000001, results that round up to
     10^8, division by 0), set through `C_KEY` key strings;
   - the display must equal a BigInt-rational model of section 6.
2. **Key sequences:** at least 3,000 random sequences of 1-30 keys over the whole key set (and some non-keys). After each key,
   `C_DSTR` must equal the model's display.
3. **The screen:**
   - after `desk5` boots, the window, the buttons and the display equal a gfx6-model rendering of section 4 (the pixels,
     except under the pointer);
   - a typed sequence shows the right text, right aligned.
4. **Input over frames:** keys through TSRun's keyboard (digits, SYMBOL SHIFT operators, ENTER, DELETE, BREAK), and clicks
   through TSRun's mouse (`m.mouse`). The display must follow the model.
5. **Banking:**
   - the memory watch of BANKING 10.7 over all of the above;
   - no write to `$C000-$C1FF` except Calculator's variables;
   - frames: `V_FRAMES` rises by exactly 1 per frame.
6. **Bounds** (section 7) as a table, `tests/calc-perf.mjs`.
7. **Cross-emulator:** `desk5` after boot and a fixed typed sequence: the screen identical on TSRun, ZEsarUX 13.0 and Fuse
   1.9.1.

## 9. Status (2026-11-12, work in progress; updated as it goes)

**Built** by the main model: `src/desk5.asm`, `src/apps/calc.asm`, and the build target `desk5`. It runs on TSRun.

**Main model's smoke checks:**
- **The display:** after boot it shows "0".
- **Key strings** through `C_KEY` give the section 6 results: 12+7*3= 57; 2/3= 0.6666667; 1/3*3= 0.9999999; 0.1+0.2= 0.3;
  99999999+1= Error; 5/0= Error; 0.0000001/2= 0.0000001.
- **Input over frames:** typed "12", SYMBOL SHIFT + K, "3", ENTER gives "15". Mouse clicks on C 7 * 2 = give "14".

**Measured on TSRun:**

| Measure | Measured | Bound |
|---|---|---|
| Bytes in DOCK 2-3 | 2,489 | 2,500 |
| Slowest `=` seen (a division) | 103,660 T | 120,000 |
| A digit key | at most 1,184 T | 3,000 |

**Design change during the build:** sums and products are exact decimals, so they are only trimmed to 8 digits (`c_scale`:
drop digits from the right, and the last one dropped rounds half away from zero). Only division uses the 64-bit long
division (`c_round`). This took `=` from 155 k to 104 k T at worst.

**Tests (Sonnet, from the contract; the main model re-ran them):**
- **`tests/calc-c1.mjs`:** 5 of 5 on seeds 1 and 2.
  - **Arithmetic:** 20,036 operations, 311,904 checks against the BigInt model.
  - **Key sequences:** 3,000 sequences.
  - **The screen:** pixel for pixel against the section 4 rendering, in 14 states.
  - **Input over frames:** typed keys, mouse clicks and menu choices.
  - **Banking:** the memory watch over 325 M accesses with 0 violations, the image intact, and no frame lost.
- **Cross-emulator:**
  - ZEsarUX 13.0: 16 of 16 rows, the boot and typed screens identical to TSRun's.
  - Fuse 1.9.1: the boot screen, 5 of 5 rows. Fuse cannot take typed input headless.
- **`tests/calc-perf.mjs`:** 8 pass, **1 missed**, 3 reported.

**Missed bound, reported to the owner before any change:** `C_KEY` for `=` doing a division takes **174,661 T** at worst,
against 120,000 (about 3 frames).
- The mean is 100,806 T.
- The slowest inputs found are 9.9999999 / 6.6666667 and 9.9999999 / 1.
- `+`, `-` and `*` take at most 66,002, 65,985 and 80,899 T.
- An operator key that performs a pending division takes up to 157,810 T (reported; it has no bound).
- The results are correct; only the time is over.

**Options:**
- **(A)** The bound becomes the measured figure, 175,000. That is about 50 ms after the key, which no one will notice. No bytes.
- **(B)** Speed up the long division: unrolled 64-bit shift and compare, the dividend and remainder shifted as one 16-byte
  number, and a one-pass multiply by 10. **EST** 100-110 k T, but about 60-100 more bytes. The byte bound (2,489 of 2,500)
  would then need raising to about 2,600.

**Not yet done:**
- **The owner's choice** on the missed bound (A or B above).
- **The owner's review on screen:** `web/?cart=desk5`, with the Mouse switch on.
