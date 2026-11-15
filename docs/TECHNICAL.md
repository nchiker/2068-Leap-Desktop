# Leap Desktop: how it works (technical overview)

Audience: an engineer who knows the Z80 and the Timex Sinclair TS2068 but has not seen this project. Every statement here was
checked against the source (`src/`), the contracts in `docs/`, or the build output in `build/desk5/` (`out.sym`, `out.lst`) as it
stood on 2026-11-15 (209 commits on `main`). Numbers that come from a document and not from the source or a symbol are marked
with the document and section, for example `BANKING 5.1`. Where a document and the source disagree, the source is quoted and the
disagreement is noted in section 12.3.

Source citations are `file:label`. Addresses are hexadecimal with a `$` prefix. "T" means T-states.

---

## 1. What it is, and where it stands

**Leap Desktop** (the repository directory is `LeapG`) is a small graphical desktop for the TS2068, written in Z80 assembly
(sjasmplus). It runs from a DOCK cartridge in the TS2068's 64-column video mode (mode 6, 512 x 192, one ink and one paper
colour for the whole screen). It has a mouse pointer, overlapping windows, drop-down menus, dialogs, and six programs. It is
built from parts of Leap V2 and Leap Arcade (the owner's other projects); what was copied is listed in `docs/PROVENANCE.md`.
The `docs/FEASIBILITY.md` review (2026-11-11) is the design origin; its roadmap steps are the order the work followed.

### 1.1 The programs

One program runs at a time; the shell is program 0. The table is `K_PROGS` in `src/desk5.asm`.

| # | Program | Source | Lives in | What it is |
|---|---|---|---|---|
| 0 | Shell ("Leap Desktop" window, "Leap" menu) | `src/apps/shell.asm` | DOCK 2-3 | A window of program icons; launches the others; Show Desktop; sound on/off |
| 1 | Calculator | `src/apps/calc.asm` | DOCK 2-3 | 8-digit decimal pocket calculator, packed BCD, 20 buttons |
| 2 | Key Caps | `src/apps/keycaps.asm` | DOCK 2-3 | Shows the TS2068 keyboard and what each key types in each plane (plain, CAPS SHIFT, SYMBOL SHIFT) |
| 3 | Notepad (the code and symbols keep the name Write, prefix `WR_`) | `src/apps/write.asm` | DOCK 2-3 | Word-wrapped text editor: selection, clipboard, Find, Open / Save |
| 4 | Paint | `src/apps/paint.asm` | DOCK 2-3 | MacPaint-style bitmap editor, 320 x 144 picture, ten tools, one-level Undo, PBM files |
| 5 | Puzzle (15-tile sliding game) | `src/apps/puzzle.asm` | **the pool** (K-resident) | The first program whose code lives in the always-mapped area |

### 1.2 The cartridge

The main target is **`desk5`** (`src/desk5.asm`): a DOCK cartridge of chunks 0-6, **57,353 bytes** (`build/desk5.dck`):
a 9-byte DCK header (`tools/mkdck.mjs`) and seven 8 KB chunks. The owner planned it at "56 KB" (`CODE_SIZE 0`): 7 x 8,192 = 56 KiB
of chunk data. Chunks 0, 1, 4, 5 are mapped all the time (32 KB of always-mapped code, "the pool"); chunks 2-3 hold the banked
programs; chunk 6 holds the graphics library and resources.

Other build targets (`tools/build.mjs`, `TARGETS`): `desk5l` (`desk5` with the `List` control, `-DTK_LIST=1`), and the step 1-5
test cartridges `hello`, `probe23`, `gfx6t`, `spike6`, `kern3`, `kern3demo`, `kern4`, `kern4demo` and `bank5`.

### 1.3 What it runs on

| Where | Status (from the docs; not re-run for this document) |
|---|---|
| **TSRun** (a browser TS2068 emulator in plain JavaScript, used here as a git submodule, and headless under Node) | Primary target. Every test suite and the browser test page run on it. |
| **ZEsarUX 13.0** (driven through its remote protocol, ZRCP) | Cross-check. 240 of 240 rows at the last recorded run (`CLAUDE.md`, before the Marquee and Puzzle, which have no session in the runner yet). |
| **Fuse 1.9.1** (headless, a recorded movie decoded by a script) | Cross-check of the boot screen: 6 of 6 rows. |
| **Real TS2068** | Not tested. "Emulator-qualified, not hardware-qualified" (`FEASIBILITY` marks table: HW). |

### 1.4 What is not built

- Roadmap step 6 (a jump table, an app header for third-party programs, `desktop.json` as an ABI spec, an SDK): not started.
- The mode 0 and mode 2 variants of the graphics core (colour per program): not started. The desktop is mode 6 only.
- The file manager and shared file dialog (`docs/FILEMGR.md`): contract only, deferred. FatBits in Paint: deferred.
- A TS-Pico backend for the file calls (`FILES 6`): described, not built. The only backend is the browser page.
- Windows cannot be resized (no grow box); they are drag-movable and closable only.
- Tape storage: dropped in favour of the file interface (`CLAUDE.md`, 2026-11-12).

### 1.5 History in one paragraph

Work started on 2026-11-11 with the project set-up and a graphics spike (slices S1-S5) that settled the video mode and the
56 KB cartridge. On 2026-11-12 came the object model and events (step 3), the window manager with menus and the Kempston mouse
(step 4), the far call between memory mappings (`B0`), and the first programs (Calculator, the shell, the toolkit, Notepad's
first two slices). On 2026-11-13 and 2026-11-14: Open / Save through a browser file bridge, the Mac-OS-1-style look, double-click and
Find, the app library, and a faster test runner. On 2026-11-14 and 2026-11-15: Paint (P0 on the 14th; P1-P3 on the 15th), sound, `G_ICON`, the BCD Calculator, the Marquee,
the Puzzle, and the GitHub Pages workflow.

---

## 2. Hardware context and the video mode

### 2.1 The machine

- CPU 3.528 MHz; a frame is 262 lines of 224 T, **58,688 T**, at 60.1145 Hz (`FEASIBILITY`, Hardware facts; TSRun exports this as
  `tStatesPerFrame`, `tests/lib.mjs:FRAME_T`).
- Memory is eight 8 KB **chunks**, chunk n at `$2000 * n`. The cartridge port (DOCK) can put its own chunk n in place of the
  machine's chunk n.
- The ports this project uses (`src/desk5.asm`):

| Port | Name in source | Use |
|---|---|---|
| `$F4` | `PORT_HSR` | Bit n = 1: DOCK chunk n is mapped in. `F4_RUN` = `$33` = chunks 0, 1, 4, 5 |
| `$FF` | `PORT_SCLD` | Video mode in bits 0-2, ink colour in bits 3-5, bit 6 = interrupt disable, bit 7 = EXROM instead of DOCK. `SCLD_MODE6` = `%00000110` |
| `$F5` / `$F6` | `PORT_AY_REG` / `PORT_AY_DAT` | AY-3-8912 register select / data. The joystick is read from AY register 14 |
| `$FE` | (keyboard) | Keyboard half-rows |
| `$FBDF`, `$FFDF`, `$FADF` (low byte `$DF`) | (events.asm `k_mouse`) | Kempston mouse x counter, y counter, buttons (`WINDOWS 15.1`) |
| `$6D` / `$6F` | `FS_PDAT` / `FS_PCMD` | The emulator-only file bridge (section 6.6) |

- The EXROM (`$FF` bit 7 = 1) cannot be mapped while a cartridge is mapped (`FEASIBILITY`, TM 3.2.2.4); this project never uses
  it. DOCK and EXROM are mutually exclusive.
- Display RAM is read by the video hardware independently of the CPU's mapping, so the picture stays visible while a DOCK chunk
  is mapped over `$4000-$7FFF` (`FEASIBILITY`, TM 5.1.1 p.76; proven on the three emulators by the B0 probe).
- TSRun models **no memory contention** on `$4000-$7FFF`; the manual says the CPU is slowed there when the video chip needs the
  RAM. Every T-state figure in the docs is therefore a lower bound for a real machine (`CLAUDE.md`).

### 2.2 Mode 6 (512 x 192)

`$FF = $06`: mode 6, black ink on white paper, frame interrupt on, DOCK selected (`desk5.asm: SCLD_MODE6`).

- **Pixel to byte.** Byte column `c = x >> 3`. Column c lives in display file `c AND 1` (`$4000` for even, `$6000` for odd columns)
  at offset `c >> 1` from the start of the row. Bit `7 - (x AND 7)` is the pixel. The two files each use the ordinary Spectrum
  row layout, so `ROWTAB[y]` (a table of 192 words, `src/gfx6/tables.inc`) gives row y's address in file 1, and file 2 is the
  same address + `$2000` (`GRAPHICS_SPIKE 3`; `G_ADDR` in `gfx6.asm`: HL = x, E = y gives HL = the byte, A = the mask).
- **Aspect.** Pixels are **twice as tall as they are wide** (512 x 192 on a 4:3 screen). Everything graphical is drawn for this:
  vertical strokes are 2 pixels wide, circles are twice as wide as tall, and the 11 x 5 pixel close box is square on screen
  (`LOOK 2`, `ICON 6`).
- **Unused RAM.** Only `$4000-$57FF` and `$6000-$77FF` are pixel data. `$5800-$5FFF` and `$7800-$7FFF` are free in mode 6; the
  project calls them **cold RAM** (section 3.2).
- **Border.** In mode 6 the border colour follows the paper colour, so the border cannot be used to signal PASS or FAIL
  (`CLAUDE.md`). Tests write a result record to RAM instead (`RESULT`, `$FF00`).
- **Alternation.** Because byte columns alternate between two files, row-major code keeps HL on file 1 and DE on file 2 at the same
  offset (`gfx6.asm` header). This is the reason copies of rectangles (`G_SAVERECT`, `G_SCROLLV`) are slower than in a linear layout.

### 2.3 The binding rules for banking and interrupts

These are stated in `CLAUDE.md` ("Facts that bind the code") and proven by `BANKING 11.1`:

1. **Never read the ports back.** Each of `$F4` and `$FF` has a RAM shadow, `V_SHADOW_F4` (`$E083`) and `V_SHADOW_FF` (`$E082`).
2. **Store the shadow before the `OUT`**, so an interrupt that arrives between the two sees a shadow that is at least as new as the
   port. `K_FAR` does this in both directions.
3. **An ISR that draws maps the display itself** (`$F4 = $33`) and, when it is done, writes the **shadow** back to the port; it
   never assumes the port equals the shadow. This was proven by injecting an interrupt at every instruction boundary of the far
   call (765 boundaries of the 18 callers, `BANKING 11.1`).
4. **Never map a DOCK chunk over the stack.** The stack is at the top of RAM (`$FF00` downward, chunk 7), which is never mapped.
5. **No `DI` is held across a frame boundary**: TSRun drops a frame interrupt that arrives under `DI`. The project uses no `DI`
   in kernel or program code (`tests/shell-perf.mjs` sweeps the pool code for `DI` opcodes; the bound is 0). The only code that runs
   with interrupts off is the ISR itself.
6. **AY rule.** Any code that selects an AY register first stores the register number in `K_AYREG` (`$F085`), so the ISR can restore
   the latch (`sound.asm:snd_w`: "the shadow before the OUT"). The mixer value keeps bit 6 clear so the joystick read keeps working.
7. **Nothing writes into a mapped window**: no write to `$4000-$7FFF` while the display is covered (mapping A), none to
   `$C000-$DFFF` while chunk 6 is mapped (mapping R). ZEsarUX writes through into the cartridge image, so a stray write corrupts
   the cartridge there (`BANKING 4` rule 7).
8. **TSRun fills RAM with random bytes at power-on**, so boot initialises every variable, and tests give result records a marker.

---

## 3. Memory map and cartridge layout

### 3.1 The cartridge header and the entry sequence

`src/desk5.asm` starts with the LROS header at DOCK chunk 0 (copied exactly):

```
    ORG $0000
    DB $00, $01                 ; LROS header
    DW ENTRY
    DB $BC
```

The machine's stock HOME ROM finds this header and jumps to `ENTRY` (`$0100`). TSRun runs 97 frames of ROM start-up before the
cartridge first writes `$F4` or `$FF` (`TESTSPEED 10`). `ENTRY` (all from `desk5.asm`):

1. `di`, `ld sp,STACK_TOP` (`$FF00`), `xor a / out (PORT_SCLD),a` (DOCK selected), then `ld a,F4_RUN / out (PORT_HSR),a`,
   `im 1`. The order matters: `$FF` before `$F4` (`CLAUDE.md`).
2. All 16 AY registers cleared.
3. `$E000-$FFFF` cleared (variables, kernel area, stack and the result record), then `$4000-$7FFF` cleared (display files and
   the cold tails).
4. The mode is set (`SCLD_MODE6`), shadows `V_SHADOW_FF` / `V_SHADOW_F4` stored, `K_FJP` set to `$C3` (the `JP` opcode the far
   call patches), sound switched on (`K_SOUND` = 1).
5. `G_INIT` (draw op, line height, whole-screen clip), `K_AINIT` for the kernel arena (`$F500-$FAFF`), `W_INIT` (desk, menu bar,
   cell map), `P_INIT` (the pointer, placed at (256, 96)); the record `$5AA5` written to `RESULT`.
6. `K_AINIT` for the app arena (`$C400-$DFFF`), `K_ARENA` selects it, `ei`, `A = 0`, `jp K_LAUNCH`: **program 0, the shell**.
   `K_LAUNCH` never returns.

### 3.2 The memory map

| Range | Size | Contents | Mapped when |
|---|---|---|---|
| `$0000-$00FF` | 256 | Page 0: header, `RST $08` = `K_SEND`, `RST $28` = `jp K_FAR`, `$0038` the ISR vector, `$0066` `retn`, `K_FAR` at `$0068-$009D` (53 bytes) | always (DOCK 0) |
| `$0100-$01FF` | | `ENTRY`, the boot tail (`T_IDLE` `$0191`), `ISR_BODY` (`$0198`) | always |
| `$0200-$037F` | 384 | `ROWTAB` (`ALIGN 512`, `SIZE 1` S2) | always |
| `$0380-$24FD` | 8,574 | gfx6: `G_INIT` at `$0380` to `GFX6_CODE_END`, including the pointer (`P_CODE` `$1CB0`) and text routines | always |
| `$24FE-$29AE` | | Menus (`kernel1.asm` includes `menu.asm`; `MB_SET` `$24FE`) | always |
| `$29AF-$2C16` | | The toolkit's `Field` (`tk2.asm`; `List` only with `TK_LIST`) | always |
| `$2C17-$2FD4` | 958 | The Puzzle (`PZ_START`-`PZ_END`) | always |
| `$2FD5-$3FFF` | 4,139 | **free** | always |
| `$4000-$7FFF` | 16 KB | **Under K and R: the display files** (`$4000-$57FF` even byte columns, `$6000-$77FF` odd) with cold RAM `$5800-$5FFF` and `$7800-$7FFF`. **Under A: DOCK chunks 2-3, the banked programs** | RAM (K, R) or DOCK (A) |
| `$8000-$9DFF` | 7,680 | gfx6's page-aligned tables (`tables4.inc`): `LMASKP` `$8000`, `RMASKP` `$8100`, `PROP6_W` `$8200`, `PROP6_I` `$8300`, `PROP6_A2` `$8400`, `PROP6_K` `$8500`, `FONTP` `$8600` (8 planes), `SHR` `$8E00` / `SHL` `$8F00` (interleaved) | always (DOCK 4) |
| `$9E00-$B687` | 6,280 | The kernel: `K_CODE`..`K_CODE_END` (`SIZE 1` S1 moved its start from `$A000` into chunk 4's tail) | always |
| `$B688-$BC8E` | | The toolkit: `TK_CODE`..`TK_END` (`Check`, `VScroll`, `CWindow`, `TK_DISPATCH`) | always |
| `$BC8F-$BDD8` | | The toolkit's class descriptors (`CL_Check` `$BC95`), the launcher (`K_LAUNCH` `$BCD7`, `K_QUIT` `$BD20`), sound (`K_BEEP` `$BD23`, `SND_TAB` `$BDA0`), `K_PROGS` `$BDCD` (6 words) | always |
| `$BDD9-$BFFF` | 551 | **free** | always (DOCK 5) |
| `$C000-$C3BF` | 960 | The running program's **RAM image** (`PROG_IMG`), copied from DOCK 2-3 at launch | RAM (K, A); **hidden under R** |
| `$C3C0-$C3FF` | 64 | `AL_RAM`: the app library's strings | RAM |
| `$C400-$DFFF` | 7,168 | The **app arena** (windows, controls, a program's buffers) | RAM; hidden under R |
| `$C000-$D8CE` (DOCK) | | **DOCK 6**: the graphics library and the icons (`G6_START` `$C000`, `G6_END` `$D8CF`) | only under R |
| `$E000-$E07F` | | gfx6 variables: `GA` `$E000`, `GOP` `$E010`, `GLH` `$E011`, `GCLIP` `$E012`, scratch | hot RAM |
| `$E080-$E0FF` | | Cartridge variables: `V_FRAMES` `$E080`, `V_SHADOW_FF` `$E082`, `V_SHADOW_F4` `$E083`, sound `$E084-$E086`, `DESK_STR` `$E090` (64 zero bytes), flood-fill state `$E0D0-$E0E7` | hot RAM |
| `$E100-$E6FF` | | Pointer: `PT_*` variables, `PT_SAVE` `$E120` (48 bytes), `PT_SET` `$E200` (the pre-shifted arrow, 768 bytes) | hot RAM |
| `$E700-$E7FF` | | `GCODE`: row code that `G_SAVERECT` / `G_SCROLLV` generate | hot RAM |
| `$E800-$EFFF` | 2,048 | Menu save-under buffer (`W_SAVE_BASE`); also rectangle records (`W_RL`) and `MB_TMP` while no menu is open | hot RAM |
| `$F000-$F03F`, `$F040-$F04F` | | Event ring (16 x 4 bytes, `K_RING`) and the posted queue (`K_POSTQ`) | hot RAM |
| `$F050-$F0FF` | | Kernel variables: arena records `K_KARENA` `$F050` and `K_AARENA` `$F060`, `K_FOCUS`, `K_CAPTURE`, `K_ROOT`, input state, `K_FJP` `$F0D0`, `K_PROG` `$F0E9` ... | hot RAM |
| `$F100-$F3FF` | 768 | `W_MAP`: the cell-owner map (32 x 24 cells) | hot RAM |
| `$F400-$F4FF` | | `W_SLOTS`, window-manager variables, menu entries (`MB_*`) | hot RAM |
| `$F500-$FAFF` | 1,536 | The kernel arena (`KARENA_BASE`..`KARENA_END`) | hot RAM |
| `$FB00-$FEFF` | 1,024 | The stack (top `$FF00`) | hot RAM |
| `$FF00-` | | `RESULT`: the boot marker and test record | hot RAM |

Sources for the table: `src/desk5.asm` (ORG lines, `KARENA_*`, `AARENA_*`, `PROG_IMG`), `build/desk5/out.sym`, and the variable
blocks at the head of `wm.asm`, `events.asm`, `menu.asm`, `pointer.asm`, `gfx6.asm`. The split of hot RAM between gfx6, the pointer
and the window manager follows `WINDOWS 2` and `OBJECTS_EVENTS 2`; `$E700` as `GCODE` is `s3.asm:GCODE`.

**Cold RAM** (`$5800-$5FFF`, `$7800-$7FFF`) is visible under K and R but not under A, and is shared by programs that never run
together: Notepad's clipboard (2,048 codes at `WR_CLIP`, `$7800`) and its refused-paste scratch (`WR_SCR`, `$5800`); Paint's undo
area (`$5800`, 2,048 bytes), the flood fill's span list and seed stack (`$7800-$7FFF`) and the Marquee's lifted bitmap (`$7800`).
A program in DOCK 2-3 reaches cold RAM only through `KFAR K_LDIR` or `KFAR K_BOX` (`kernel.asm`).

**The arena `$C400-$DFFF`** is reset by `K_LAUNCH` whenever a program starts. A program's RAM image is at most 1 KB; each program
asserts that it ends at or below `AL_RAM` (`$C3C0`), so the real room is 960 bytes (`PAINT 0` item 6).

### 3.3 The cartridge chunks, in the file

`tools/build.mjs` slices a 64 KB memory image (`mem.bin`, written by the `SAVEBIN` at the end of `desk5.asm`) into chunks 0-6 and
writes the DCK. `desk5.asm` uses `ASSERT` at each chunk boundary: `ASSERT $ <= $4000` after the pool in chunks 0-1,
`ASSERT $ <= $9E00` after the tables, `ASSERT $ <= $C000` after the kernel pool, `ASSERT $ <= $8000` after the programs in DOCK 2-3,
and `ASSERT $ <= $E000` after DOCK 6.

---

## 4. The three mappings and the far call

### 4.1 K, A and R

`$F4` takes one of three values while the desktop runs (`far.asm`: `F4_K`, `F4_A`, `F4_R`; `BANKING 2`). A routine runs under
exactly one of them, chosen by where it lives.

| Name | `$F4` | DOCK chunks mapped | Sees | Does not see |
|---|---|---|---|---|
| **K** (kernel) | `$33` | 0, 1, 4, 5 | pool code; the display; cold RAM; the heap (`$C000-$DFFF`); hot RAM | code in DOCK 2-3 and 6 |
| **A** (app) | `$3F` | 0, 1, 2, 3, 4, 5 | pool code; **code in DOCK 2-3**; the heap; hot RAM | the display and cold RAM (DOCK 2-3 covers them) |
| **R** (resource) | `$73` | 0, 1, 4, 5, 6 | pool code; **code in DOCK 6**; the display; cold RAM; hot RAM | the heap (DOCK 6 covers `$C000-$DFFF`) |

`$7F` (2, 3 and 6 together) and EXROM are never used. Consequences:

- **R can draw.** Chunks 2-3 are RAM under `$73`, so code in chunk 6 calls gfx6 directly. It cannot see a program's views or
  buffers, which are in the heap, so a graphics routine in DOCK 6 receives its arguments in hot RAM (`GA`) and may read only
  bitmaps that are in DOCK 6 or cold RAM.
- **A cannot draw.** A program in DOCK 2-3 reaches the display only by crossing into K.
- **Every pointer handed to K code must be in RAM visible under K**: a banked program's class descriptors, strings and menu tables
  live in its RAM image at `$C000`, never in DOCK 2-3 or 6 (`BANKING 4` rules 4, 5, 6). The kernel reads a window title or a
  button label under K, where DOCK 2-3 is not mapped.

### 4.2 The far call

All crossings, in either direction, use one routine entered through `RST $28` with an inline target word. The macro (`src/kernel/far.asm`):

```
    MACRO KFAR target
        ASSERT (target) < $E000
        rst $28
        DW target
    ENDM
```

The vector is `jp K_FAR` at `$0028`; the body is at `$0068` in page 0's free hole. The mapping for the target is chosen **from
its address** by two bit tests (`far.asm:K_FAR`):

```
    add a,a                     ; S = address bit 14, carry = bit 15
    ld a,(V_SHADOW_F4)
    push af                     ; the caller's mapping (A; F is not kept)
    ld a,F4_K
    jp p,.set                   ; bit 14 clear: $0000-$3FFF, $8000-$BFFF
    ld a,F4_A
    jr nc,.set                  ; $4000-$7FFF
    ld a,F4_R                   ; $C000-$DFFF
.set:
    ld (V_SHADOW_F4),a
    out (PORT_HSR),a
```

The code saves the caller's mapping on the stack, sets the shadow and then the port, calls the target through a 3-byte RAM
`JP nnnn` at `K_FJP` (`$F0D0`), and on return restores the caller's mapping (shadow first) and returns past the `DW`.

| Property | Value (source: `far.asm` header, `BANKING 11.1`) |
|---|---|
| Registers in | A, BC, DE, HL, IX, IY unchanged (F is not an argument) |
| Registers out | A, F, BC, DE, HL, IX as the target left them; IY and the alternate set preserved |
| RAM | `K_FJP` (3 bytes) and `K_FA` (1 byte) at `$F0D0-$F0D3`, used only between entry and the call, so nesting is safe |
| Stack | 6 bytes a crossing level |
| Cost | round trip to a `RET` 331 T (to K), 350 T (to A), 352 T (to R); a direct `CALL`+`RET` is 27 T |
| Size | 53 bytes (`K_FAR`..`K_FAR_END`), inside page 0's hole `$0068-$00FF` |

### 4.3 Calling banked code from the kernel: thunks

The kernel calls a program's methods (Draw, Event, Focus, Blur) through the ordinary message send (`RST $08`, 87 T). A banked
class's method table holds the address of a **4-byte thunk** in the program's RAM image (the macro `KTHUNK`, `far.asm`):

```
    MACRO KTHUNK method
        ASSERT ((method) >= $4000 && (method) < $8000) || ((method) >= $C000 && (method) < $E000)
        rst $28
        DW method
        ret
    ENDM
```

`K_SEND` is unchanged by banking: a send to a thunk costs 87 + the thunk's crossing (447 T for a `RET` method against 97 T for a
kernel method, `BANKING 5.3`). A banked method that draws crosses back into K with `KFAR` for every gfx6 call.

### 4.4 Direct calls without a crossing

Some pool routines touch nothing that A or R hides, and banked code may `CALL` them directly (`BANKING 11.1`, proven by an audit that
runs each under its mapping with the hidden range watched):

- **A-direct:** `K_NEW`, `K_ALLOC`, `K_FREE`, `K_POST`, `K_ARENA`, `K_GETEV`.
- **R-direct:** `G_SETCLIP`, `G_SETOP`, `G_FILL`, `G_FRAME`, `G_HLINE`, `G_VLINE`, `G_TEXT8`, `G_TEXTP`, `P_SHIELD`, `P_UNSHIELD`.

Programs use `K_GETEV` and `K_NEW` with a plain `call` (see the shell's `s_loop` in section 8.2); everything else goes through `KFAR`.

### 4.5 K-resident programs

A program's start is a word in `K_PROGS`, and `K_LAUNCH` enters it with `rst $28 / DW start`. The mapping is chosen from that
address (4.2), so a program whose start is in the pool runs under **K**. The Puzzle is the only one (`SPACE_PLAN 1`):

- it calls `G_*`, `W_*`, `K_*` and the toolkit with a plain `call` (17 T) rather than `KFAR` (331 T);
- it sees the arena, cold RAM and the display without crossings; its classes and strings stay in the pool (K reads them there);
- it reaches the app library (`AL_*`, DOCK 2-3, mapping A) with `KFAR`;
- it costs pool bytes (958) instead of DOCK 2-3 bytes.

This exists because DOCK 2-3 was full (7 bytes free on 2026-11-15) while the pool still had room above its reserve (section 9.1).

---

## 5. The kernel

### 5.1 The frame interrupt

The ISR vector at `$0038` is `jp ISR_BODY`. `ISR_BODY` (`src/desk5.asm`, copied):

```
ISR_BODY:
    push af
    push hl
    ld hl,(V_FRAMES)
    inc hl
    ld (V_FRAMES),hl
    push bc
    push de
    ld a,F4_RUN
    out (PORT_HSR),a
    call P_ISR
    call K_POLL
    call K_SNDTICK
    ld a,(V_SHADOW_F4)
    out (PORT_HSR),a
    ld a,(K_AYREG)
    out (PORT_AY_REG),a
    pop de
    pop bc
    pop hl
    pop af
    ei
    ret
```

In order: count the frame (`V_FRAMES`, a 16-bit counter used by every double-click and repeat timer); map K; **`P_ISR`** draws or
erases the pointer; **`K_POLL`** reads the input; **`K_SNDTICK`** advances the sound; then the mapping and the AY register latch
are put back from the **shadows**. The B0 measurement of the whole ISR was 8,623-9,088 T (`BANKING 11.1`; sound added a few T
since), against a bound of 12,000 T. There is no IM 2: the machine stays in IM 1.

### 5.2 Time

The frame (58,688 T) is the only timer. `V_FRAMES` is the clock; there is no timer event (`E_TIMER` is reserved,
`OBJECTS_EVENTS 6`). The double-click window is 20 frames; key auto-repeat starts after 30 frames and then repeats every 4 frames
(`events.asm`; `OBJECTS_EVENTS 7`). The Kempston mouse gives counters; the pointer moves 1:1 with no acceleration; joystick and
keyboard-pointer movement accelerate (`K_STEP[hold] = min(1 + floor(hold / 6), 6)`, `events.asm:K_STEP`).

### 5.3 Input (`K_POLL`, `src/kernel/events.asm`)

Each frame, in order: the double-click counter `K_DCN` counts down; the Kempston mouse is read when `K_MOUSE` is 1 (turned on by
`K_MSET`, which a program calls once); then the keyboard half-rows; then the joystick via AY register 14; then pointer motion,
button state and the events they produce.

**Keyboard.** One read of port `$FE` with all rows selected; if no key is down and none was, it stops. Otherwise all eight half-rows
are read and compared with last frame's `K_NOW`, and each key that went down gives an `E_KEY`. CAPS SHIFT and SYMBOL SHIFT are
modifiers only. The key map is generated from `src/kernel/keymap.txt` by `tools/gen-keymap.mjs` into `build/<target>/keymap.inc`
(three columns: plain, CAPS SHIFT, SYMBOL SHIFT):

| Key | Code | Meaning |
|---|---|---|
| CAPS SHIFT + 1 | 14 | TAB (the PC Tab key gives this on the test page) |
| CAPS SHIFT + 3 | 15 | BACKTAB |
| CAPS SHIFT + 4 | 27 | ESC |
| CAPS SHIFT + 5/6/7/8 | 8/10/11/9 | LEFT / DOWN / UP / RIGHT |
| CAPS SHIFT + 0 | 12 | DELETE |
| CAPS SHIFT + 9 | 16 | MENU (opens the menus from the keyboard) |
| CAPS SHIFT + SPACE | 3 | BREAK |
| CAPS SHIFT + 2 | | caps lock (no event) |
| SYMBOL SHIFT + Q | 17 | `CLOSE` (closes the front `CWindow`) |
| SYMBOL SHIFT + E | 18 | `MARK` (Notepad's keyboard selection) |

Other SYMBOL SHIFT keys give the printable ASCII characters (the TS2068 legend where it is ASCII, the rest spread over keys
whose legends are keywords); every printable character is reachable with at most one modifier. The owner accepted this layout
after typing with it (`CLAUDE.md`). The TS2068 joystick never maps to keys in the page (owner decision): it comes only from a
gamepad. CAPS SHIFT + SYMBOL SHIFT together toggles **keyboard-pointer mode** (events: `E_MODE`), where Q / A / O / P move the
pointer and SPACE is the button (`OBJECTS_EVENTS 7`).

**Mouse.** Left button = fire. The right and middle buttons make no events. Motion is the signed difference of the counters
since last frame.

### 5.4 Events and the queue

An event is 4 bytes: type, then three data bytes (`K_EV` after `K_GETEV`).

| Type | Name | Data |
|---|---|---|
| 1 | `E_KEY` | 1: key code; 2: modifier bits (CS, SS, caps lock; bit 7 = auto-repeat); 3: 0 |
| 2 | `E_MOVE` | 1: x low; 2: y; 3: bit 0 = x bit 8, bit 1 = button held |
| 3 | `E_DOWN` | as `E_MOVE`; with `K_DCLICK` (desk5), data 3 bit 2 marks a **double-click** |
| 4 | `E_UP` | as `E_MOVE` |
| 5 | `E_TIMER` | reserved |
| 6 | `E_REDRAW` | not queued: `K_GETEV` returns it when both queues are empty and `W_DIRTY` is set (the lowest priority event) |
| 7 | `E_MENU` | 1: menu id; 2: item id |
| 8 | `E_QUIT` | defined (`events.asm`) |
| 9 | `E_MODE` | keyboard-pointer mode on / off |
| 10 | `E_CMD` | 1: the control's `View_id`; 2: the window's slot (posted by buttons and closes) |
| 11 | `E_SCROLL` | `VScroll` to its target |
| 16-255 | the program's | via `K_POST` |

Two queues, neither needs `DI`: the **ring** (16 records at `K_RING`, `$F000`) has one producer (the ISR, which advances the tail)
and one consumer (`K_GETEV`, which advances the head). The **posted queue** (4 records, `K_POSTQ`) belongs to the main program.
A new `E_MOVE` overwrites the previous one if that one is still the last record and not the one at the head, so moves never fill the
ring; when the ring is full, an ISR event is dropped and `K_LOST` counts it (`OBJECTS_EVENTS 6`).

**Double-click** (`events.asm`, `K_DCLICK`): a press within 20 frames of the previous press, at most 8 pixels across and 4 down
from it, and which was not itself a double-click, sets bit 2 of data 3. The shell's icons, `List`, and Notepad's word selection
all read it (`WRITE 14.9`).

### 5.5 Views, focus and routing

The object model (section 6.1) gives each on-screen thing a **view**: a 16-byte `View` has a parent, first child and next sibling,
x (word), y (byte), w (word), h (byte), flags and an id. Flags: bit 0 focusable, bit 1 hidden, bit 2 disabled; the higher bits
belong to the class. **Coordinates are absolute screen pixels**; moving a window adds (dx, dy) to the window and to every view
under it.

`K_DISPATCH` (`src/kernel/focus.asm`) routes one event:

- **`E_KEY`:** `M_EVENT` to `K_FOCUS` (or `K_ROOT` when nothing has focus); not consumed, it bubbles up to the parent, up to the
  root; still not consumed: TAB and the arrows move focus (`K_FOCUSNEXT` / `K_FOCUSPREV`), other keys are dropped.
- **`E_DOWN`:** `M_EVENT` to `K_ROOT`; a `Group` hit-tests its children front to back; a focusable hit child receives focus then
  the event; a child that consumes the press takes pointer **capture** (`K_CAPTURE`).
- **`E_MOVE` / `E_UP`:** to the capture view if any (and `E_UP` ends the capture), otherwise routed like `E_DOWN`.
- **`E_REDRAW`:** calls `W_UPDATE`.

Programs call `TK_DISPATCH` (the toolkit) instead of `K_DISPATCH`: it is the same except that key code `CLOSE` closes the front
`CWindow` (`tk.asm:TK_DISPATCH` posts the window's close command, `E_CMD`; the program decides what closing means).

### 5.6 The window manager

Contract `docs/WINDOWS.md`; code `src/kernel/wm.asm`, `wm2.asm`, `menu.asm`.

- **The cell map.** The screen is 32 x 24 **cells of 16 x 8 pixels**. `W_MAP` (`$F100`, 768 bytes) holds one byte a cell: bits 0-3 the
  **owner** (0 the desk, 1-14 window slots, 15 the menu bar), bit 7 "dirty". Row 0 is always owner 15. `W_SLOTS` (`$F400`) maps each
  owner to its view.
- **Windows are cell-aligned**: x and w multiples of 16, y and h multiples of 8, wholly on the screen below the menu bar
  (minimum size 48 x 16). Up to 14 windows.
- **No backing store.** A window's pixels are never saved. When a window opens, closes, raises or moves (`W_OPEN`, `W_CLOSE`,
  `W_RAISE`, `W_MOVE`), the map is updated, and every cell whose owner changed is marked dirty. Nothing is drawn until `W_UPDATE`.
- **Repaint.** `W_UPDATE` takes the dirty cells owner by owner (the bar, then the windows front to back, then the desk), groups
  each owner's dirty cells into maximal rectangles, and for each rectangle sets `G_SETCLIP`, shields the pointer, and sends the
  owner's view `M_DRAW`. Because windows are opaque and drawing is deterministic, repainting a cell is always correct, whatever
  was on it before. `W_INVAL` (GA = a rectangle) and `W_INVALV` (IX = a view) mark cells dirty; `W_DRAWVIEW` draws one view now
  (clipped to what its window owns) and is how controls show a state change at once.
- **The drawing rule** for any view's `M_DRAW` (`WINDOWS 4`): draw the view's whole appearance, opaque (every pixel of its
  rectangle, ink or paper), deterministic; let the clip discard what is outside; never change the clip, the shield or the map;
  and **draw from `View_x` / `View_y`, never from fixed screen positions** (a rule added after Key Caps and Notepad broke when
  dragged; `CLAUDE.md`).
- **Dragging** (`W_DRAG`): a press on the title bar of the front window (or the first press on a back window raises it, a drag
  follows from the same press) runs a loop inside the kernel. It draws an `XOR` outline of the window rectangle, snapped to whole
  cells (16 across, 8 down), erases and redraws it as the pointer moves, and on `E_UP` moves the window (`W_MOVE`) if the position
  changed. ESC or BREAK cancels. `W_UPDATE` runs first so the outline is XORed over a settled screen.
- **Modal dialogs.** A `Dialog` sets `W_MODAL`; pointer events outside it are consumed and ignored, `W_OPEN` of anything else is
  refused. ENTER clicks the dialog's default button, ESC or BREAK its cancel button. A button's key "click" holds the pressed
  look for 4 frames.
- **Menus** (`menu.asm`, assembled in chunk 1 by `kernel1.asm`). `MB_SET` takes a table: 1-8 menus, each with an id, title, and
  1-15 items (id, flags: disabled, separator; text). The kernel draws the bar and the drop-downs and tracks the pointer (press,
  drag, release) or the keyboard (MENU, arrows, ENTER, ESC). A drop-down saves the screen under it in `W_SAVE_BASE` (`$E800`,
  2,048 bytes) and restores it on close; `MB_SET` refuses a menu that would not fit. The result is an `E_MENU` event. `MB_ENABLE`
  sets an item's enabled bit.
- **Kernel drawing classes:** `Desk` (the grey desk), `MenuBar`, `Window` (frame, title bar, content), `Dialog` (modal,
  double frame, no title bar), `Button` (focusable; posts `E_CMD`; plays a click when sound is on), `Label`.

### 5.7 The look (`docs/LOOK.md`, `LOOK_MAC`)

The look is a Mac-OS-1-style drawn with this project's own bitmaps, assembled only in `desk5` (`DEFINE LOOK_MAC`; `kern3`, `kern4`
and `bank5` keep the original look and are byte-for-byte unchanged). From `LOOK 3, 8, 9`:

- White menu bar (ink title text, a 1-pixel line under it, the open title inverted).
- Windows: a frame, a 2-column x 1-row drop shadow (one "Mac pixel"), the title centred, **stripes in the title bar when
  the window is active**; the close box (`CWindow` only) is at the left, hit rectangle (x + 8, y + 1, 15, 7).
- The desk is a **25% grey** (`$88, $22` alternating rows). It is drawn as text: `desk_draw` (`wm.asm`) draws character rows
  1-23 with `G_TEXT8` of the 64 bytes of `DESK_STR` (all zero), and `desk5.asm` replaces the 8 x 8 glyph of **code 0** in `FONTP` with
  the tile, so the pattern costs no code:

```
    ORG GLYPH8
    DUP 4
        DB $88
        ORG $ + 255
        DB $22
        ORG $ + 255
    EDUP
```

  (`LOOK 9` says code 127; the source patches code 0; see section 12.3.)
- The pointer is a Mac-style arrow (`P_ARROW`, 64 bytes), with the hot spot pixel (0, 0) as ink.
- Costs: window draw 107,174 T (bound 108,000), window open 115,166 T, raise 116,721 T (`LOOK 10`), about 25,000 T more than before
  the look.

### 5.8 The pointer

The pointer is **drawn by the frame ISR** (`pointer.asm`, `P_ISR`): an arrow, 3 byte columns x 16 rows at any x. The ISR erases the
old image by writing back the bytes saved in `PT_SAVE`, saves the bytes under the new position, then draws a pre-shifted copy
(the 8 shifts of the arrow, `PT_SET`, made once by `G_PRESHIFT`). Main-program code moves it with the input's `K_PX` / `K_PY` and
coordinates with it by a **shield**: `P_SHIELD` (GA = a rectangle) erases the pointer at once if it overlaps and keeps it from
being drawn into that rectangle until `P_UNSHIELD`. The main program holds `PT_LOCK` while it changes the state; `P_ISR` does
nothing while the lock is held and catches up next frame. Latency: input read in frame n is drawn by frame n+1. The kernel's
repaint (`W_UPDATE`) shields each rectangle it draws; programs that draw directly (Paint) shield around each drawing step.

### 5.9 The launcher

`K_LAUNCH` (`src/kernel/launch.asm`), A = a program number; never returns:

1. `SP` = `STACK_TOP`; `K_PROG` = A; mapping K (shadow first).
2. Every open window is closed, front first (`W_FRONT`, `W_CLOSE`); `MB_SET 0` removes the menus.
3. `K_ARESET` clears the app arena; focus, capture and the posted queue are cleared; `W_UPDATE` repaints the desk.
4. It builds `rst $28 / DW <start>` in `K_LSTUB` (`$F0EA`) from `K_PROGS[A]` and jumps there. The start copies the program's
   image, sets its menu, builds and opens its windows, turns the mouse on and runs its event loop. It never returns.

`K_QUIT` is `K_LAUNCH` with A = 0 (back to the shell). Nothing of a program is kept across a switch.

---

## 6. The object model, the toolkit, the app library and the file bridge

### 6.1 Classes and send

Classes are generated from text files by `tools/gen-classes.mjs`: `src/kernel/classes.txt` (the kernel's) and
`src/kernel/tk-classes.txt` (the toolkit's) become `build/desk5/classes.inc`, `tk-classes.inc`, and `classes.json`. The format is
`class Name : Parent`, `field name size`, `method Message label`, optional `guard SWITCH`. The generator flattens single
inheritance (every inherited slot is filled), numbers new messages after the parent's, writes `M_*` message numbers,
`<Class>_<field>` offsets and `<Class>_SIZE`, and refuses a method table that would cross a page.

A **class descriptor** is 6 header bytes then the method table; the class pointer points at method 0. Copied from
`build/desk5/classes.inc` (the generated file; the page-alignment guard before each descriptor is omitted):

```
    DW CL_Object
    DB 2, 6, 16, 8
CL_View:
    DW view_destroy, k_nop, k_nop, view_hittest, k_nop, k_nop
```

The header is parent (word), class id, method count, instance size, and the pool: the offset in an arena record of the free-list
head for that size (6, 8, 10, 12 for sizes up to 8, 16, 24, 32; 14 for larger). Messages (`M_DESTROY` 0, `M_DRAW` 1, `M_EVENT` 2,
`M_HITTEST` 3, `M_FOCUS` 4, `M_BLUR` 5) are sent with `RST $08`: IX = the object, A = the message number, BC and DE the arguments.
`K_SEND` (`src/kernel/send.asm`, copied):

```
K_SEND:
    ld l,(ix+0)
    ld h,(ix+1)                 ; HL = the class (its method table)
    add a,a
    add a,l
    ld l,a                      ; HL = the method's slot
    ld a,(hl)
    inc l
    ld h,(hl)
    ld l,a
    jp (hl)
```

It takes 87 T from the `RST` to the first instruction of the method. `INC L` is enough because each table lies in one page.
Methods preserve IX, IY and the alternate set and clobber AF, BC, DE, HL; results come back in carry, A or HL.

**Instances** are word 0 = the class pointer, then the fields, zeroed by `K_NEW`. They are allocated from an **arena**: a bump
allocator with four free-list pools (8, 16, 24, 32 bytes); every byte above the arena's top is zero (`K_NEW`'s zeroing relies on it).
Two arenas exist: the kernel arena (`K_KARENA`, `$F500-$FAFF`, holds `Desk` and the menu bar) and the app arena
(`K_AARENA`, `$C400-$DFFF`). One is current (`K_ARENA`).

**Programs never send messages.** They create objects with `K_NEW` and only **receive** sends (Draw, Event, Focus, Blur) through
their RAM thunks; the build audited on 2026-11-14 had 5 `rst $08` sends, all in the kernel (`OO_AUDIT 1`). The audit's verdict was that more
object machinery (an `App` base class, a kernel-driven loop) would cost pool bytes, the scarce resource, to save bytes where there is
room.

### 6.2 The toolkit (`docs/TOOLKIT.md`)

Always-mapped pool code (`src/kernel/tk.asm`, `tk2.asm`), same conventions as the window manager.

| Class | Parent | Size | What | Where |
|---|---|---|---|---|
| `Check` | `View` | 18 | Check box; radio button when flags bit 4 is set (a click clears the other radios among its siblings) | `tk.asm` |
| `VScroll` | `View` | 23 | Vertical scroll bar: arrows, track, thumb; tells its target with an `E_SCROLL` through `M_EVENT` | `tk.asm` |
| `CWindow` | `Window` | 21 | A `Window` with a close box; the box or key code `CLOSE` posts `E_CMD` with the window's `View_id` and slot; the program decides what closing means | `tk.asm` |
| `Field` | `View` | 21 | One line of editable text, with a caret and sideways scroll | `tk2.asm` |
| `List` | `View` | 23 | A list of strings with a selection and a scroll bar | `tk2.asm`, **only with `TK_LIST`** (target `desk5l`; no `desk5` program uses it) |

Routines for programs: `TK_SETTEXT`, `TK_SETITEMS`, `TK_DISPATCH`. `List` became a build switch (`SIZE 6`), freeing 676 pool
bytes in `desk5`.

Programs also define their own view classes in their RAM image: `Icon` (the shell), `CDisp` (Calculator's display), `KeyCaps`,
`TextView` (Notepad), `Canvas` and `Palette` (Paint; one `Palette` class serves the tool box, the patterns and the brushes by
the view's id), and in the pool `Board` (the Puzzle: `CL_Board` `$2F83`). Each has a `Draw` and an `Event` method and, for a
banked class, thunks.

### 6.3 The app library (`docs/APPLIB.md`, `src/apps/applib.asm`)

Shared helpers in DOCK 2-3 that programs `CALL` under mapping A (K-resident programs `KFAR` them). It holds no state of its own.
Its strings that the kernel draws ("OK", "Cancel", "Discard", "Discard the document?") are written into `AL_RAM` (`$C3C0-$C3FF`)
by `AL_INIT`, because the kernel reads them under K.

| Call | Does |
|---|---|
| `AL_INIT` | writes `AL_RAM` |
| `AL_NEW` | makes a view from a table entry (class, rectangle, flags, id, a word) |
| `AL_VIEW` | `AL_NEW`, then adds it as the parent's last child (sets a Dialog's default / cancel by role) |
| `AL_ADD` | adds a view built by hand to a parent |
| `AL_VIEWS` | makes every view of a table under a parent |
| `AL_DIALOG` | makes a dialog and its views the first time, remembers it in the program's word |
| `AL_ALERT`, `AL_ASK` | the standard alert ("OK") and the "Discard the document?" question; both play the alert sound |
| `AL_NAMEDLG` | the standard name dialog: a label, a `Field` (cap 30), a button whose text the caller supplies, and Cancel |
| `AL_TITLE` | builds a window title ("Notepad: name") |
| `AL_EXTNAME` | adds a default extension to a file name that has none |

The view-table format (13 bytes a view) is in `APPLIB 3`. It exists because of the owner's standing rule to share code instead of
copying it (`CLAUDE.md`); Notepad, the shell, Calculator, Key Caps and Paint use it. Its test is `tests/al-a1.mjs`.

### 6.4 Shared code: where it goes

The owner's rule (`CLAUDE.md`) names three places:

- **The pool** (always mapped; the scarcest): the kernel's own needs: windows, menus, events, the toolkit, and the flags every
  program reads.
- **The graphics library in DOCK 6** (mapping R, reached with `KFAR`): drawing programs use but the kernel does not need
  constantly.
- **The app library in DOCK 2-3** (mapping A, a plain `CALL`): helpers that use a program's RAM. `applib.asm` and `files.asm`.

### 6.5 Sound (`docs/SOUND.md`, `src/kernel/sound.asm`)

One AY voice (channel A), tone only. `K_BEEP` (A = a sound id 1-9) starts a sound: AY registers 7 (mixer `$3E`), 0 and 1 (period),
8 (volume), each preceded by storing `K_AYREG`. `K_SNDTICK`, in the frame ISR, counts frames down and then either starts the
row's `next` sound or sets the volume to 0. `SND_TAB` has five bytes a sound (period word, volume, frames, next). The sounds chain,
so the two-tone alert and the rising win are rows, not code. The five events: a `Button` pressed (id 1), a menu item chosen (2),
an alert or ask opening (3), Paint's refusal messages (4), the Puzzle's win (5, then 7, 8, 9). `K_SOUND` (`$E084`) turns it on
and off; the shell's Leap menu item toggles it (`K_SNDSET`). 175 pool bytes. First lines of the table (copied from `sound.asm`):

```
SND_TAB:
    DW 60                       ; 1 click: about 1.8 kHz
    DB 8, 2, 0
    DW 90                       ; 2 select: about 1.2 kHz
    DB 8, 3, 0
```

### 6.6 Files (`docs/FILES.md`, `src/apps/files.asm`)

Programs open and save files through one interface shaped like TS-Pico's channel calls (open by name to read or write, read and
write in chunks, close). One file is open at a time. All calls run under mapping A with interrupts on; each returns carry clear and
A = 1 (`FS_OK`), or carry set and A = a status (3 `FS_BADNAME`, 6 no room, 7 end of file, 12 `FS_CANCEL`, 0 no answer).

| Call | In | Does |
|---|---|---|
| `FS_PICK` | HL -> a 32-byte buffer | The user chooses a file to read; waits with `HALT`; ESC or BREAK cancels |
| `FS_OPEN` | HL -> name, A = mode (bit 0 write, bit 1 binary) | Opens; BC = the file's length when reading |
| `FS_READ` | DE -> buffer, BC = count | |
| `FS_WRITE` | HL -> bytes, BC = count | |
| `FS_CLOSE` | | Finishes a write (the browser: the download starts) |

Names are 1-30 characters from codes 32-126, none of `/ \ : * ? " < > |`. Text mode converts line ends (the backend's job).

**The browser backend** is a **host bridge**: two I/O ports that exist only in the emulator. `FS_PCMD` = `$6F` (`OUT` a command;
`IN` the status with bit 7 = busy; `$FF` when no host is attached, treated as status 0) and `FS_PDAT` = `$6D` (data, one byte per
`IN` / `OUT`; no `INIR` / `OTIR`, as TS-Pico requires). The fork of TSRun adds `m.host = { command(n, bytes, answer) }`;
`web/fshost.js` is the host, shared by the page and the headless tests; `web/main.js` supplies the browser side: `showPicker()` on a
hidden file input (with a fallback bar when the browser refuses it), and a download for Save.

The TS-Pico backend (ports `$0E` / `$0F`, `tpi:chopen` etc.) is described in `FILES 6` and not built.

---

## 7. The graphics library (gfx6)

Contract `docs/GRAPHICS_SPIKE.md`; code `src/gfx6/*.asm`. The rules for every routine (`gfx6.asm` header): IX, IY and the alternate set
are preserved; no `DI` or `EI`; at most 32 bytes of stack; `GA` (`$E000`, x, y, w, h as signed words, plus more words at `GA+4..`)
is the argument block; `GOP` (`OP_SET` 0, `OP_CLR` 1, `OP_XOR` 2) is the draw op; `GCLIP` is the clip rectangle (x0, x1, y0, y1,
half-open, inside the screen). No drawing routine changes `GOP`, `GLH` (the line height for text) or `GCLIP`.

**The clipping model.** There is one clip. The window manager sets it to the rectangle being repainted before it sends `M_DRAW`,
so a view draws its whole appearance and gfx6 discards what is outside. `G_SETCLIP` intersects its rectangle with the screen.
(Exception: `G_RESTRECT` ignores the clip, which is why Paint redraws its canvas in bands; `PAINT 0` item 1.)

### 7.1 Where each routine is

| Routine | Does | Where |
|---|---|---|
| `G_INIT`, `G_SETOP`, `G_SETCLIP` | state | pool |
| `G_ADDR` | pixel to byte address and mask | pool |
| `G_FILL` | the op on every pixel of a rectangle in the clip; the workhorse (a 1-pixel-wide or -high rectangle is a vertical or horizontal line) | pool |
| `G_HLINE`, `G_FRAME` | a horizontal line; the outline, each pixel once | pool |
| `G_TEXT8` | 8 x 8 text in cells | pool |
| `G_TEXTP`, `G_TEXTW` | proportional text at any (x, y); its width | pool |
| `G_SAVERECT`, `G_RESTRECT` | a screen rectangle to a buffer and back (menu save-under) | pool |
| `G_PRESHIFT` | the pre-shifted copies of a bitmap (used for the pointer) | pool |
| `P_ISR`, `P_INIT`, `P_SHIELD`, `P_UNSHIELD`, `P_ISRMOVE` | the pointer | pool |
| `G_SCROLLV` | scroll a rectangle's whole byte columns vertically | **DOCK 6** (`s3sv.asm`) |
| `G_LINE` | a line in the op, pixel by pixel | DOCK 6 (`s3ln.asm`) |
| `G_PATFILL` | fill a rectangle with an 8 x 8 pattern (16 patterns) | DOCK 6 (`patfill.asm`) |
| `G_RRECT` | rounded rectangle and oval (radii in `GA+10`, `GA+12`) | DOCK 6 (`rrect.asm`) |
| `G_FLOOD` | scanline flood fill with a pattern | DOCK 6 (`flood.asm`) |
| `G_ICON` | opaque copy of a packed bitmap to the screen | DOCK 6 (`icon.asm`) |
| `G_LIFT` | the screen to a packed bitmap (the mirror of `G_ICON`) | DOCK 6 (`lift.asm`) |
| `G_CLS`, `G_VLINE`, `G_ROWADDR` | not in `desk5` (`DEFINE G_LEAN`; `SIZE 1` S3) | other targets only |
| `G_BLIT` (the masked blit) | not in `desk5` since `G_ICON` replaced it | `spike6` and tests |

### 7.2 Tables and fonts

The page-aligned tables are generated by `tools/gen-tables.mjs` into `src/gfx6/tables.inc` and `tables4.inc` (never hand-edited;
`tools/build.mjs` regenerates them before assembling any target with `tables: true`): `ROWTAB`, the left and right edge masks
(`LMASKP`, `RMASKP`), shift tables (`SHR`, `SHL`: `v >> p` and `(v << (8 - p)) AND $FF`), and the **font planes** `FONTP`: plane k
(row k of every glyph) is one page, so a glyph row is one `INC D` away from the next. Each plane holds the proportional font
(`PROP6`, codes 0-127) in bytes 0-127 and the 8 x 8 font (`GLYPH8 = FONTP + 128`) in bytes 128-255.

- **`PROP6`** (`fonts/prop6.txt`, ASCII art, 8 rows high, ASCII 32-126): the advance width is the row length; `PROP6_W` and
  `PROP6_I` hold advance and ink width. Vertical strokes are 2 pixels wide to suit the tall pixels.
- **The 8 x 8 font** is `src/font.inc`, copied from Leap V2 (`PROVENANCE`).
- `G_TEXTP` (GA = x, y, string, n) draws a string of n bytes, code 13 starts a new line `GLH` rows down; it returns the pen position
  in HL, DE. It writes small RAM trampolines per line so that an unrolled pass block can be entered at a per-line offset
  (`GRAPHICS_SPIKE 14.1`). Cost: about 682 T a glyph (`CODE_SIZE 0`).

### 7.3 Costs worth knowing

From the docs (TSRun, direct call, interrupts off): `G_FILL` 512 x 192 about 146,000 T (`WINDOWS 9`); `G_SAVERECT` 96 x 80 about
23,000 T; vertical scroll is limited by `LDI` with interrupts on and is "usable but not smooth" at full-screen (`FEASIBILITY 5a`).
`G_ICON`: 7,150 T for 16 x 16 and 8,318 T for 32 x 16 through `KFAR` (`ICON 7`).
The graphics library is the largest user of the pool; `gfx6` assembled to 12,451 bytes before it was split, and `desk5`
moved 3,776 bytes of it (the scroll, line and blit code) into DOCK 6 (`SIZE 8`).

---

## 8. Programs

### 8.1 Anatomy of a banked program

All banked programs follow one pattern (`docs/SHELL.md 10.3`, `APPLIB`):

- The code is in DOCK 2-3. Its **RAM image** (class descriptors, thunks, strings, menu tables, initialised variables) is
  assembled for `$C000` with sjasmplus `DISP`, and copied there by the program's start.
- Zero-filled variables are **not** in the image; they follow it and are cleared at start (`SIZE 9.1`).
- The start builds the window and views from tables with the app library, calls `MB_SET` for the menu, `W_OPEN`, `K_MSET` with
  A = 1, then runs a loop of `K_GETEV` and `TK_DISPATCH`. It handles `E_MENU` and `E_CMD` itself.
- Quitting is `KFAR K_QUIT`; it never returns.

### 8.2 The shell (`src/apps/shell.asm`)

A `CWindow` "Leap Desktop" (384 x 80 at (32, 24)) of five `Icon` views (64 x 26, one per program 1-5, 32 x 16 art drawn with `G_ICON`);
a double-click or ENTER on an icon launches it. The **"Leap" menu** has: About (an `AL_ALERT`), Calculator, Key Caps, Notepad, Paint,
Puzzle, Show Desktop, and Sound Off / Sound On. Closing the shell window (close box or SS+Q) leaves the empty grey desk and the
menu; Show Desktop opens or raises it again. Its loop (`shell.asm:s_loop`, copied):

```
s_loop:
    call K_GETEV
    jr nc,.ev
    halt
    jr s_loop
.ev:
    cp E_MENU
    jr z,.menu
    cp E_CMD
    jr z,.cmd
    KFAR TK_DISPATCH
    jr s_loop
```

Every program uses this same shape.

### 8.3 Calculator (`src/apps/calc.asm`, `docs/CALCULATOR.md`)

A `CWindow` (176 x 144) of 20 `Button`s and `CDisp`, a banked view that draws the display. It has no menu; its close box or SS+Q
quits to the shell. It is a pocket calculator with immediate execution. **Numbers are 8 significant digits of packed BCD**
(`CALCULATOR 10`): two digits a byte, lowest first, records of sign, digit count after the point and a 4-byte mantissa. Addition and
subtraction use `DAA`; multiply and divide by 10 are digit shifts with `RLD` / `RRD`; multiplication adds the multiplicand once per
digit of the multiplier; division is decimal long division; `c_scale` (shared) rounds, half away from zero, by the first dropped digit. A division
takes 161,071 T. It is tested against a BigInt model (20,000+ operations; 3,000 key sequences). The Calculator is the first
banked program and was the proof of the far call end to end.

### 8.4 Key Caps (`src/apps/keycaps.asm`, `docs/KEYCAPS.md`)

A `CWindow` (448 x 160) showing the TS2068 keyboard in five rows. Three radio `Check` buttons choose the plane (plain, CAPS
SHIFT, SYMBOL SHIFT); keys that are down are drawn pressed; a status line names the last key and its code. It reads the kernel's
own `KEYMAP`, so it always shows the map in force. A key change redraws only the changed caps (the full redraw crosses about 10
`KFAR` calls per cap and is kept for plane changes). It replaced the toolkit's "Controls" demo (program 2).

### 8.5 Notepad (`src/apps/write.asm`, `docs/WRITE.md`)

The largest program (`WR_START` `$4B30` to `WR_END` `$6445`, 6,421 bytes). A `CWindow` (480 x 168) with a banked `TextView` and a
`VScroll` bar. Menus: File (New, Open..., Save...) and Edit (Cut, Copy, Paste, Select all, Find..., Find again).

- **Text** is codes 32-126 and 13 (paragraph end), stored in a **gap buffer** in the app arena: 5,120 codes (`WR_CAP`). The gap sits
  at the caret, so editing costs the same anywhere.
- **Display lines** are word-wrapped in `PROP6` advances (a line breaks after the last space that fits). A **line table** (one byte a display line, its length,
  in a `WR_MAXL` = 1,024-byte block) is re-wrapped from the edited paragraph until a line start matches the old table.
- **Selection** by mouse drag, by double-click (a word, a run of spaces, or one punctuation code), or by keyboard with **MARK**
  (SS+E; SHIFT cannot work on the TS2068, `WRITE 12.1`). **Clipboard**: 2,048 codes at `$7800` (cold RAM), reached by `KFAR K_LDIR`.
  No keyboard shortcuts for Cut / Copy / Paste (owner decision).
- **Find** (`WRITE 14`) shares the Save dialog. **Open / Save** use `FS_PICK` / `FS_OPEN` and the name dialog; extension ".txt".
- Scrolling uses `G_SCROLLV` through `KFAR`; scroll bounds are the measured figures.
- It follows its window when dragged: `wr_org` derives the text origin from the view at each full draw.

### 8.6 Paint (`src/apps/paint.asm`, `docs/PAINT.md`)

A `CWindow` "Paint: name" (416 x 176 at (48, 16)). Views: tool box (`Palette`, 2 x 5 cells of 32 x 16), patterns (4 x 4 swatches),
brushes (4 cells), the `Canvas`, and a status `Label`. The picture is **320 x 144 pixels** (40 byte columns, 5,760 bytes) at (128, 32)
in the first window position. Menus: File (New, Open..., Save..., Quit), Edit (Undo, Clear), Options (Filled shapes / Hollow shapes).
Symbols are `PN_` / `pn_` (`PT_` is the pointer's).

- **The picture and its copy.** The display is the working surface. A copy of the picture is kept in the app arena in
  `G_SAVERECT`'s buffer layout (a header, then the odd byte columns' rows, then the even), so saving the whole picture after a
  stroke is one `KFAR G_SAVERECT`. The copy is used for exposure redraws, Undo and files.
- **Redrawing an exposed canvas** is done in **8-row bands**: the band is packed from the copy into a small buffer in
  `G_RESTRECT`'s layout and restored, because `G_RESTRECT` ignores the clip.
- **Commit protocol.** Each drawing step: `P_SHIELD`, clip to the picture, gfx6 calls, `P_UNSHIELD`. At `E_UP`: save the undo box, then
  save the whole picture into the copy, mark the picture changed.
- **Undo** is one level and swaps (a second Undo redoes). The undo area is cold RAM `$5800` (2,048 bytes, holding a `G_SAVERECT`-format
  buffer of the changed box); a bigger change says "Too big to undo". `K_BOX` (pool) moves a box of rows between the arena and cold RAM
  in one crossing. Clear and New ask first.
- **Tools** (the tool box, in order): Marquee, Pencil, Brush, Eraser, Spray, Bucket, Line, Rectangle, Rounded rectangle, Oval.
  Pencil is `G_LINE`; brush and eraser stamp along a Bresenham walk; shapes use an XOR rubber band; filled shapes and the bucket
  use `G_PATFILL` / `G_FLOOD` with the chosen pattern.
- **The bucket** (`G_FLOOD`): pass 1 fills the region with a solid marker (the colour opposite to the target) and records spans in
  cold RAM `$7800` (5 bytes a span, 204 spans); pass 2 paints them with the pattern. A solid fill is one pass with a 512-seed stack.
  On overflow Paint says "Fill too complex" and restores the picture from the copy. A whole-picture fill takes about 9.2 million T
  (reported, not bounded; `PAINT 21`).
- **The Marquee** (`PAINT 22.2`): drag a band; a press inside the selection starts a move. The box is lifted with `G_LIFT` into cold
  RAM `$7800`; an XOR outline follows the pointer in steps of 8 pixels across and 1 down; on release the source is erased (unless
  CAPS SHIFT is held: copy), the box is drawn with `G_ICON`, and the union is the undo box. Selections are snapped to byte columns
  and limited to 2,048 bytes. DELETE clears the selection, ESC drops it.
- **Files** are PBM P4 (an 11-byte header "P4", "320 144", then 40 bytes a row; `PN_FILELEN`); the default extension is ".pbm".
- **Reported (not met) bounds**, accepted by the owner at the measured figures: Undo of a 2,016-byte box 265,442 T; the fully exposed
  canvas 759,700 T.

### 8.7 Puzzle (`src/apps/puzzle.asm`, `docs/PUZZLE.md`)

A K-resident program (section 4.5). A `CWindow` 400 x 160 at (64, 24): a 4 x 4 board of 64 x 32 pixel cells and a column with "Moves: n" and
a "New game" button. A click on a tile in the gap's row or column slides the run between it and the gap; arrow keys slide the neighbour;
N or the button deals again (120 random legal moves from the solved board, so every deal is solvable; a 16-bit LFSR seeded from
`V_FRAMES`). Solved plays the win sound. The board is 16 bytes (`PZ_B`, the tile in each cell, 0 = the gap); each tile is a frame with its number drawn twice, one pixel apart. The
`M_DRAW` tests each cell against the clip before drawing it (a move fell from 190,566 T to 90,240 T). It has no menu.

---

## 9. Space and speed engineering

### 9.1 The size budget

Size is the binding constraint (`FEASIBILITY 5a`); the method is to **measure free bytes from the build and report them** instead of
guessing. `tests/shell-perf.mjs` computes the pool's free bytes from the symbols and checks the reserve:

- chunks 0-1: from the end of the last pool part to `$4000` (`PZ_END` `$2FD5`: 4,139 bytes);
- chunk 4's tail: 0 (the kernel starts at `$9E00`, directly after the tables);
- chunk 5: from the end of the `K_PROGS` table (`$BDD9`) to `$C000`: 551 bytes.

| Area | Free now | Source |
|---|---|---|
| **Pool** (chunks 0, 1, 4, 5) | **4,690** bytes; a 1,000-byte reserve is kept for roadmap step 6, so 3,690 are usable | `PUZZLE 6`; recomputed from `build/desk5/out.sym` (4,139 + 0 + 551) |
| **DOCK 2-3** | **7** bytes (`PN_END` `$7FF9` of `$8000`) | `PAINT 22.2`; `out.sym` |
| **DOCK 6** | 1,841 bytes (`G6_END` `$D8CF` to `$E000`) | `out.sym` (`ICON 7` quotes 1,542 at an earlier `G6_END`; see 12.3) |

DOCK 2-3 layout (`out.sym`): Calculator `$4000-$4805`, shell `$4818-$4B2F`, Notepad `$4B30-$6444`, app library `$6445-$6691`,
Key Caps `$6692-$6AEF`, file calls `$6AF0-$6BA4`, Paint `$6BA5-$7FF8`.

How the room was made, in order (`SIZE.md`): the kernel's start moved into chunk 4's tail (+512 in chunk 5); `ALIGN 512` so
`ROWTAB` sits at `$0200` (+335); `G_CLS`, `G_VLINE` and `G_ROWADDR` left out of `desk5` (+129); `K_WARP` left out (+63); the
mask tables shared (+16); `List` made a build switch (+676); the graphics library moved to DOCK 6 (pool free 2,121 to 5,898);
zero-filled variables taken out of the program images (DOCK 2-3 +about 480); the BCD Calculator (-175 bytes of code) paid for the
Marquee; the Puzzle and sound went into the pool. A rule behind all of it: **nothing a program might use is deleted**; savings are
moves, build switches and sharing.

Speed work that costs bytes waits for a measured shortfall (`CLAUDE.md`).

### 9.2 How T-state bounds are measured

Each contract has a table of bounds; each row is a number the test suite measures:

- **Direct-call rows** call the routine with a sentinel return address, **interrupts off** (so the ISR is excluded), and count T-states from
  the first instruction to the `RET`. TSRun counts T-states exactly and models no contention.
- **End-to-end rows** (a click to idle, a key to the settled screen) run normal frames with interrupts on, counting from the frame
  interrupt that polls the input to the next `HALT`.
- A row is **pass**, **MISSED** or **report** (measured and written down, not judged).
- **Policy** (every contract header): a missed bound is **reported with its numbers before anything is changed, and the
  engineer never weakens a bound.** Only the owner resets a bound, and does so to the measured figure; the doc records the date
  and the reason. The commit `c503048` ("Bounds reset to the measured figures (owner accepted, 2026-11-15)") is an example: `snd-s1`
  `K_BEEP` 652 T, `calc-perf` pool 278, `kc-k1` 61,052 T, `pt-p1` canvas 759,700 T, `pz-p1` New game by the button 544,408 T.

The newest recorded full run of the runner (`build/test-logs/2026-11-15_10-17-42`, UTC; before that commit) passed every suite
except those five rows, which were then reset. This document did not re-run it.

### 9.3 Frequent figures

| Measure | T | Source |
|---|---|---|
| Frame | 58,688 | `FEASIBILITY` |
| `K_SEND` to the method | 87 | `send.asm` |
| `K_NEW` | 437 | `FEASIBILITY` roadmap 3 |
| Far call round trip (K / A / R) | 331 / 350 / 352 | `BANKING 11.1` |
| Whole ISR (idle / pointer moving), B0 build | 8,623-8,656 / 9,055-9,088 | `BANKING 11.1` |
| Window open / raise (desk5, Mac look) | 115,166 / 116,721 | `LOOK 10` |
| Calculator division | 161,071 | `CALCULATOR 10` |
| Paint: whole-picture bucket fill | about 9,200,000 | `PAINT 21` |

---

## 10. Build and test

### 10.1 Build

Needs `sjasmplus` 1.23 on the PATH and Node 24 (`README.md`); `git submodule update --init` fetches TSRun.

```
node tools/build.mjs            # every target, build/<name>.dck
node tools/build.mjs desk5      # one target
```

`tools/build.mjs`: for targets with `tables: true` it regenerates `src/gfx6/tables.inc` and `tables4.inc` (`gen-tables.mjs`); for
targets with `classes`, `keymap`, `icons`, `ticons` it generates `build/<name>/classes.inc`, `keymap.inc`, `icons.inc`, `ticons.inc`
(`gen-classes.mjs`, `gen-keymap.mjs`, `gen-icons.mjs`); then runs `sjasmplus --nologo --lstlab --lst=... --sym=... -I<src> [-I<build/name>]
-D<defs>`; reads `mem.bin` (the 64 KB image `SAVEBIN`ed by the source) and the symbols; and writes the DCK with `tools/mkdck.mjs`
(kinds 0 and 2 only, the subset every emulator accepts). `build/` is not committed. Each target has its own `build/<name>/` with
`out.lst` and `out.sym`.

Feature switches are `DEFINE`s at the top of `desk5.asm`: `LOOK_MAC`, `K_DCLICK`, `G_LEAN`, `K_NOWARP`, `G_LIB6`, `SOUND`, `K_BOXES`,
`MASKS_SHARED`, plus `TK_LIST` from the build. Other targets assemble the same source files without them, so their bytes do not
change.

### 10.2 TSRun

TSRun is a browser TS2068 emulator in plain JavaScript (ES modules, no build step), here a git submodule (`tsrun/`) pinned at
`6ccf56e`, a fork that adds three things: the Kempston mouse (`m.mouse`) and the host bridge on ports `$6D` / `$6F`
(`m.host`), both off by default, and a closed-form silent AY that gives identical results faster. The fork is shared with another project of the owner's: `docs/TESTSPEED.md 6` lists the rules
(main moves only by fast-forward, pin commits that are on main, push TSRun first). The same code runs headless under Node (the tests
`import tsrun/machine.js` directly) and in the browser page.

Behaviours that matter to test code: it fills RAM with random bytes at power-on; it drops a frame interrupt that arrives while
interrupts are disabled; it has no memory contention; `m.pixels` is the 640 x 240 hi-res frame buffer (the 512 x 192 screen starts
at (64, 24), `tests/lib.mjs`).

### 10.3 The harness and the model-based method

Every routine gets a headless test against a **reference model written from the spec**, never from the code (`CLAUDE.md`, "Working
method"; the pattern is `tests/hello.mjs`, which builds `hello`, boots it with the stock ROMs and compares the whole 512 x 192 picture
with a model). The model files are `tests/*-model*.mjs` (`gfx6-model`, `kern-model*`, `wm-model*`, `tk-model*`, `calc-model` (BigInt),
`wr-model`, `pt-model`, `pz-model`, `kc-model`, `shell-model`, `look-model`). Helper libraries: `lib.mjs` (`boot`, video control),
`bank-lib.mjs` (the memory watch of `BANKING 10.7`, which checks every memory access against the mapping rules), `calc-lib.mjs`
(`loadDesk5`, `bootDesk5`, `progUp`: boot through the shell and launch a program), `kern-lib`, `tk-lib` (`runCall`, a call with
a sentinel return), `wr-lib`, `pt-lib`, `pz-lib`, `snd-lib`.

Typical checks: interrupt injection at every instruction boundary of a routine; poisoning memory that a mapping must not touch;
planted-bug mutations that the tests must catch; reference screens compared byte for byte. Test records carry a marker because RAM
starts random.

### 10.4 The suites

`node tools/runtests.mjs [--jobs N] [--log DIR] [--compare DIR] [suite ...]` runs the `desk5`-era suites in a pool of up to 6 jobs
(longest first, from `tests/.suite-times.json`), logs in `build/test-logs/<time>/`, and with `--compare` checks each log against a
reference run (ignoring timing lines). It builds nothing (it stops if a prebuilt cartridge is missing: `build/desk5.dck`,
`desk5l.dck`, `kern4.dck`, `hello.dck`). The default list (`DEFAULT_SUITES`, 30 suites):

| Area | Suites |
|---|---|
| App library, files | `al-a1`, `fs-f1`, `web-smoke` |
| Programs | `calc-c1`, `kc-k1`, `shell-s1`, `wr-w1`, `wr-w2`, `wr-w3`, `wr-w4`, `wr-drag`, `wr-demo`, `pt-p1`, `pz-p1` |
| Toolkit, kernel | `tk-t1`, `tk-t2`, `tk-t3`, `kern-dclick`, `snd-s1`, `boot-snapshot` |
| gfx6 in DOCK 6 | `g6-line`, `g6-patfill`, `g6-icon`, `g6-lift`, `g6-rrect`, `g6-flood` |
| Performance bounds | `calc-perf`, `shell-perf`, `tk-perf`, `wr-perf` |

Suites that **build** their own cartridge (`hello`, `probe23`) must not run beside another that builds the same one (`build/<name>`
collides); suites that only read a prebuilt `.dck` through `loadDesk5` may run side by side. The older suites for steps 1-4 and the
far call are run one at a time and are not in the runner's list: `gfx6-s1`..`gfx6-s4`, `gfx6-cls`, `gfx6-perf`, `spike6`,
`kern-k1`..`kern-k3`, `kern-mouse`, `kern-hit`, `kern-perf`, `wm-w1`..`wm-w3`, `wm-perf`, `bank-b0`, `bank-perf`, `probe23`, `hello`,
`review-*`, `fs-bridge`, `fs-text`.

### 10.5 Test speed (`docs/TESTSPEED.md`)

A full `desk5` run of the 20 suites then existing took 1,505 s one at a time and about 210 s in the runner (`TESTSPEED 11`; the list has since grown to 30). The changes:

- **Video off.** `boot(dck, { video: false })` (the default for `desk5` suites) calls TSRun's `setVideoOn(m, false)`; `m.pixels` is replaced
  by a proxy that throws on use, so a test that reads the picture must ask for `{ video: true }` (or `TS_VIDEO=1`). T-states are unchanged.
- **Shared ROM boot.** `tests/fast-boot.mjs` snapshots the stock ROM's boot (97 of a `desk5` boot's 142 frames) once per process and restores a
  machine from it; `TS_COLDBOOT=1` boots cold. `tests/boot-snapshot.mjs` proves a restored machine equals a cold-booted one.
- **A closed-form silent AY** in TSRun; the proof test `tests/tsrun-ay-silent.mjs` is copied from the other project (`PROVENANCE`).
- **The runner** above.

### 10.6 Cross-emulator runs (`tools/xemu/`)

- `desk5-ref.mjs` boots `build/desk5.dck` on TSRun and records reference screens and variables for scripted sessions (the shell,
  Calculator, Key Caps, Notepad W2-W4, Paint).
- `zesarux-desk5.py` starts ZEsarUX 13.0 headless with the stock ROM, drives it over ZRCP with one breakpoint at the interrupt entry
  so that each key is held an exact number of frames, and compares every settled screen with TSRun's byte for byte, plus `K_PROG` and
  variables. ZEsarUX has no file bridge, so Notepad's Save ends in the alert; the Paint session drives the pointer through
  keyboard-pointer mode because ZEsarUX has no ZRCP command for its Kempston mouse.
- `fuse-desk5.sh` runs Fuse 1.9.1 headless, records a movie, and `fuse-desk5-check.mjs` decodes it itself (the installed
  converter cannot read Fuse's Timex hi-res movies) and compares the settled boot screen.
- The same trio exists for `kern3`, `kern4`, `bank5`, `spike6` and `probe23`.

### 10.7 How the work is organised

Each step or slice begins with a short **contract** document (what to build, the numbers to measure, the pass or fail bounds, owner
decisions recorded with dates), is approved by the owner, then is built with a model and tests written from the contract, then one
regression run, then the owner tries it and accepts or resets the bounds. Commits are checkpoints as the work goes (`CLAUDE.md`).
Routine work (test runs, models, doc updates) is delegated to cheaper models; design, contracts, Z80 code and judging results stay
with the main model.

---

## 11. The browser page and the Pages workflow

### 11.1 The test page (`web/`)

`web/index.html` + `web/main.js` + `web/fshost.js` + `web/style.css`: TSRun runs a cartridge in a canvas.

- Serve the repository root (`python3 -m http.server 8080`) and open `http://localhost:8080/web/?cart=desk5`. `?cart=<name>` loads
  `build/<name>.dck` (default `hello`); the **Load .dck** button loads any file.
- The page loads the stock TS2068 ROMs from `tsrun/roms/`, the WebGL shaders, inserts the cartridge with `insertDock` and resets. The
  frame loop calls `runFrame` once per 1/60.11 s, with audio fed to an AudioWorklet (sound starts on the first click or key).
- Keys go to the TS2068 keyboard through `tsrun/keyboard.js`, always; the TS2068 joystick comes only from a connected gamepad.
- **Mouse** switch: attaches `m.mouse`; clicking the screen captures the pointer (Esc releases); motion becomes counter steps (one
  per pixel, y inverted), left and right buttons become bits 1 and 0.
- **Files:** `createFileHost` answers the bridge ports (section 6.6): Open is the browser's file picker (`showPicker`, with a "Choose..."
  bar as a fallback when the browser refuses it), Save is a download. A file is limited to 65,535 bytes.
- The screen is fitted to the window at any size; the grey desk's moiré at fractional scales is the browser's scaling, not the cartridge.
- `window.leapG` exposes the machine for tests; `tests/web-smoke.mjs` drives the page in headless Chrome.

### 11.2 GitHub Pages

`.github/workflows/pages.yml` runs on a push to `main` that touches `pages/**`, `web/**`, `tsrun`, `tools/pages-prep.mjs` or the workflow:
it checks out with submodules, runs `node tools/pages-prep.mjs _site`, and deploys the result with the standard Pages actions.
`tools/pages-prep.mjs` assembles `_site/` as `_site/web`, `_site/tsrun` (the modules, shaders and stock ROM, not the Go server or the
other ROM sets), `_site/build/desk5.dck` (copied from the prebuilt `pages/desk5.dck`, 57,353 bytes), and an `index.html` that redirects to
`web/?cart=desk5`. `pages/desk5.dck` is refreshed by hand (`node tools/build.mjs desk5 && cp build/desk5.dck pages/desk5.dck`).
The site is live at https://nchiker.github.io/2068-Leap-Desktop/ (the repository was made public on 2026-11-15, because Pages is not available for a private repository on the owner's plan).

---

## 12. Repository map, reading order, glossary

### 12.1 The repository

| Path | What |
|---|---|
| `CLAUDE.md` | The project's binding facts, working method, owner decisions, hand-offs |
| `README.md` | Short overview, build and use |
| `docs/` | Contracts and as-built notes (12.2); `docs/look/`, `docs/keycaps/`, `docs/paint/` are PNG mock-ups |
| `src/desk5.asm` | The main cartridge: header, boot, ISR, the chunk layout, the program table `K_PROGS` |
| `src/kernel/` | `kernel.asm` (arenas, classes, `K_NEW`), `send.asm`, `far.asm`, `events.asm` (input), `focus.asm` (routing), `wm.asm` and `wm2.asm` (windows), `menu.asm` (menus, in chunk 1 through `kernel1.asm`), `tk.asm` and `tk2.asm` (toolkit), `launch.asm`, `sound.asm`; `classes.txt`, `tk-classes.txt`, `keymap.txt` |
| `src/gfx6/` | The graphics core: `gfx6.asm` (fill, frame, state), `text.asm`, `pointer.asm`, `s3.asm` (save / restore rectangle, preshift), `s3sv.asm`, `s3ln.asm`, `s3bl.asm`, `patfill.asm`, `rrect.asm`, `flood.asm`, `icon.asm`, `lift.asm`; `tables.inc` and `tables4.inc` are generated |
| `src/apps/` | `shell.asm`, `calc.asm`, `keycaps.asm`, `write.asm` (Notepad), `paint.asm`, `puzzle.asm`, `applib.asm`, `files.asm`, `demo.asm` (the retired Controls demo, not assembled); `icons.txt`, `ticons.txt` icon art |
| `src/*.asm` (others) | The test cartridges: `hello`, `probe23`, `gfx6t`, `spike6`, `kern3`, `kern3k3`, `kern4`, `kern4demo`, `bank5`, `bank5k` |
| `fonts/prop6.txt` | The proportional font source |
| `tools/` | `build.mjs`, `mkdck.mjs`, `runtests.mjs`, generators (`gen-classes`, `gen-keymap`, `gen-tables`, `gen-icons`), mock-up makers (`look-mock`, `kc-mock`, `paint-mock`), `pages-prep.mjs`, `xemu/` (cross-emulator runners) |
| `tests/` | Headless suites, reference models and harness libraries (10.3, 10.4) |
| `web/` | The browser test page |
| `pages/desk5.dck` | The prebuilt cartridge the Pages workflow serves |
| `tsrun/` | The emulator (git submodule) |
| `build/`, `_site/` | Generated, not committed |

### 12.2 Reading order for the docs

1. `docs/FEASIBILITY.md` (architecture, the roadmap), then `CLAUDE.md` (the facts that bind the code).
2. `docs/BANKING.md` (mappings and the far call), `docs/CODE_SIZE.md` and `docs/SIZE.md` (where bytes go), `docs/SPACE_PLAN.md`.
3. `docs/GRAPHICS_SPIKE.md` (gfx6), `docs/OBJECTS_EVENTS.md` (classes, events, input), `docs/WINDOWS.md` (windows, menus, the mouse),
   `docs/LOOK.md`.
4. `docs/TOOLKIT.md`, `docs/SHELL.md`, `docs/APPLIB.md`, `docs/FILES.md`, `docs/SOUND.md`, `docs/ICON.md`.
5. The programs: `docs/CALCULATOR.md`, `docs/KEYCAPS.md`, `docs/WRITE.md` (Notepad), `docs/PAINT.md`, `docs/PUZZLE.md`.
6. `docs/TESTSPEED.md`, `docs/PROVENANCE.md`, `docs/OO_AUDIT.md`; `docs/FILEMGR.md` and `docs/PAINT_PLAYBOOK.md` are plans.

The contracts were written before the code and are amended in place with "As built" sections, so older sections may describe a first design
that a later section changed. `SHELL.md` 4-10 describe the first shell (Calculator and a Controls demo) and `SHELL.md` 12 the current one.

### 12.3 Disagreements found between the documents and the source

These were found while preparing this document; the source is what this document follows.

- **Desk tile glyph.** `LOOK 9` says the 25% tile replaces the blank glyph of code 127 and `DESK_STR` is filled with 127 at boot.
  `src/kernel/wm.asm:desk_draw` and `src/desk5.asm` use **code 0** and a `DESK_STR` of zeros that boot clears.
- **Menus of Calculator and the shell.** `CALCULATOR 3` and `SHELL 5` describe a "Calc" menu and a "Controls" program. In the source Calculator
  has no menu (`calc.asm:C_START` comment), program 2 is Key Caps, and the Leap menu has nine items including Puzzle and Sound.
- **Puzzle size.** `CLAUDE.md` and the commit that added it say 888 pool bytes; `PUZZLE 6` says "about 920"; the symbols give
  `PZ_END - PZ_START` = 958.
- **DOCK 6 free space.** `ICON 7` quotes 1,542 free at `G6_END` `$D7FA`; `$E000 - $D7FA` is 2,054, and with the present `G6_END` `$D8CF`
  it is 1,841.
- **Notepad's line table.** `WRITE 2.1` says the table holds each line's start as a word; `write.asm`'s header says it holds a byte a
  display line, its length.
- **Number of suites.** `CLAUDE.md`'s older hand-off says 20 suites; `tools/runtests.mjs` now lists 30.
- **Calculator size.** `CALCULATOR 10` says 2,089 bytes; the symbol span `C_START`..`C_END` is `$4000-$4806` (2,054 bytes).
- **`SIZE 8`** says `desk5` DOCK 2-3 had about 5,020 bytes free after P0; that figure was later superseded by the program growth
  recorded in `PAINT 22.2` (7 bytes).

### 12.4 Glossary

| Term | Meaning |
|---|---|
| **A** | Mapping `$F4 = $3F`: DOCK 0-5 mapped, so banked code in DOCK 2-3 is visible and the display and cold RAM are hidden |
| **Arena** | A bump allocator with four free-list pools (8, 16, 24, 32 bytes); `K_KARENA` (kernel) and `K_AARENA` (app) |
| **Cell** | A 16 x 8 pixel unit; the window manager's grid (32 x 24); a window is a whole number of cells |
| **Chunk** | An 8 KB unit of the address space (chunk n at `$2000 n`); the unit of DOCK mapping |
| **Cold RAM** | `$5800-$5FFF` and `$7800-$7FFF`: unused tails of the display files in mode 6, visible under K and R |
| **DCK** | The cartridge file format: a 9-byte header and the chunks |
| **DOCK** | The TS2068's cartridge port and its bank of up to eight 8 KB chunks |
| **EXROM** | The TS2068's extension ROM bank (`$FF` bit 7); unusable while a cartridge is mapped; unused here |
| **Far call** | `rst $28 / DW target` (`KFAR`): crosses between mappings, chosen from the target's address |
| **GA** | gfx6's argument block at `$E000` |
| **Heap** | `$C000-$DFFF` in RAM: the program image and the app arena |
| **Hot RAM** | `$E000-$FFFF`: variables, buffers, the stack; always visible |
| **Image (RAM image)** | A banked program's K-visible data assembled for `$C000` and copied there at launch (at most 960 bytes) |
| **K** | Mapping `$F4 = $33`: the kernel's view; DOCK 0, 1, 4, 5 |
| **K-resident program** | A program whose start is in the pool; it runs under K and calls the kernel directly |
| **LROS** | The cartridge header format the stock ROM recognises (`DB $00,$01 / DW ENTRY / DB $BC`) |
| **Mode 6** | The 512 x 192 mode: even byte columns in `$4000`, odd in `$6000` |
| **Owner** | The single person who sets the project's decisions; recorded with dates in the docs |
| **Pool** | The always-mapped code area: DOCK 0, 1, 4, 5 (32 KB): kernel, toolkit, gfx6 core, the Puzzle |
| **Pointer shield** | `P_SHIELD`: keeps the ISR from drawing the pointer into a rectangle being drawn |
| **R** | Mapping `$F4 = $73`: DOCK 6 mapped over the heap; the graphics library's view |
| **Shadow** | A RAM copy of a write-only port (`V_SHADOW_F4`, `V_SHADOW_FF`), stored before the `OUT` |
| **T-state** | One clock cycle of the Z80; the unit of every speed bound |
| **Thunk** | A 4-byte `rst $28 / DW method / ret` in a program's image, standing in for a banked method |
| **TSRun** | The TS2068 emulator used for tests and the page |
| **View** | An object with a rectangle in the view tree (`View` class); windows and controls are views |
