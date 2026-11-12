# The shell and the launcher: contract (draft 1, 2026-11-12, for the owner)

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

## 9. Decisions for the owner

1. **A window of icons now; icons on the desk itself later** (section 1). **Recommended.** It needs no kernel change.
2. **One program at a time, nothing kept across a switch.** Calculator starts at 0 again each time. **Recommended:** it is what
   was decided for programs, and it keeps the launcher small.
3. **Opening:** double-click (within 20 frames), ENTER, or the "Leap" menu. **Recommended:** all three.
4. **Quitting:** a "Quit" item in each program's menu (no close boxes yet). **Recommended.**
5. **Icons:** 32 x 16 bitmaps that the main model draws in `icons.txt` (a Calculator and a "controls" picture). The owner
   reviews them on screen.
6. **The Controls demo becomes a program** (program 2), out of Calculator's menu. **Recommended:** each program owns its
   menu, and the demo grows with T2 and T3.
