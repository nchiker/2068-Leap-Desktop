# Leap Desktop: technical feasibility and architecture review

2026-11-11. This is the first assessment, written before any implementation. It answers the brief "Leap Desktop – Technical
Feasibility and Architecture Review" (a GEOS-inspired graphical environment for the TS2068, derived from Leap technology).

**Revision 2 (2026-11-11):** the desktop mode changes from mode 0 to **mode 6 (512x192)**, following the owner's question about
resolution. The owner also set the test target:

- **Target for now: emulators**, driven from an environment like Leap-IDE (TSRun in the browser; ZEsarUX and Fuse for cross-checks).
- **Real hardware later.** How 512-pixel lines look on a TV or monitor is a question for that phase.
- **TSRun shows mode 6 at full resolution.** Its frame buffer runs at the hi-res pixel clock (`~/Projects/Leap-IDE/tsrun/machine.js:141-147`: 640 x 240 buffer, 512-pixel screen area).

**Revision 3 (2026-11-11):** a second, deeper look at Leap Arcade's graphics code, at the owner's request. It added:
- the section "Graphics core: what comes from Arcade", from three source surveys of `arcade/runtime/v2-v4`, `arcade/spike/` and `src/lang/arcade/` on branch `arcade-window-fastpath`;
- answers from the active Leap-IDE session about uncommitted work and traps;
- the XIP spike's result that code runs from DOCK chunks 2 and 3 (on TSRun);
- a new risk: in mode 6 the desktop draws directly on the visible screen.

## How sure each fact is

| Mark | Meaning |
|---|---|
| **EMU** | Measured or proven on emulators (TSRun, and where stated ZEsarUX 13.0 and Fuse 1.9.1) |
| **TM** | Stated in the TS2068 Technical Manual (`docs/TS2068_Technical_Manual.pdf` / `.txt`; pages are the "Page N of 401" footers). This is documentary, not a hardware test |
| **EST** | My estimate. It has not been measured and must be checked |
| **HW** | Verified on a real TS2068. **Nothing in Leap V2, Leap-C, Forth or Arcade has this status yet.** Every release is "emulator-qualified, not hardware-qualified" |

Timing figures come from TSRun. ZEsarUX uses 48K Spectrum frame timing, and TSRun models no memory contention (see risk 2).

Sources read:
- Leap Arcade in `~/Projects/Leap-IDE`:
  - `docs/ARCADE_CARTRIDGE_MAP.md`, `ARCADE_BANKING_CONTRACT.md`, `ARCADE_HARDWARE_NOTES.md`, `ARCADE_RUNTIME_SPEC.md`, `ARCADE_SPACE_PLAN.md`, `ARCADE_WINDOW_FASTPATH.md`, `ARCADE_RUNTIME_API_V2.md`
  - `arcade/runtime/v2-v4/`
- Leap V2 in `~/2068-Leap`:
  - `kernel/` (graphics, math, io, interrupt, memory, storage, bank)
  - `docs/V2_ROM_RAM_BUDGET.md`, `docs/AUTHORITATIVE_SOURCE.md`
- The Leap-C manual (`~/2068-Leap-C/docs/manual/`).
- The Technical Manual, through a targeted question list. Its key quotes were spot-checked in the text.

## Verdict

**Feasible, as a small, mostly monochrome, one-app-at-a-time GEOS-style system.** Most of the groundwork already exists in Leap
Arcade, which is newer than Leap V2 and closer to what a desktop needs. Three conditions apply:

1. Treat the cartridge as **48-64 KB, not 32 KB**.
2. Use **video mode 6 (512x192, black and white)** for the desktop, with windows snapped to a grid of 16 pixels across by 8 lines down. Other modes stay available per app (Q5).
3. Accept that **file storage is tape**. The manual documents no other storage, and this limits what a file manager can be.

## Corrections to the brief

| Brief says | Sources show |
|---|---|
| 32 KB ROM cartridge | The cartridge port addresses "up to 64K" in eight 8 KB chunks (**TM** 1.1.1 p.6). Arcade already ships 40,969-byte DCKs (DOCK chunks 0, 1, 2, 4, 5) on three emulators (**EMU**). |
| 48 KB RAM | Mapping a DOCK chunk above `$4000` hides the 8 KB of RAM under it from the CPU. Only DOCK chunks 0-1 are "free" code space, because they shadow the Home ROM, not RAM. Video takes 6.75-12 KB on top of that. |
| 256x192 extended colour for the primary desktop | That mode gives colour, not resolution. Mode 6 (512x192) uses exactly the same 12 KB and doubles the horizontal resolution. For a text-and-menu desktop that is the better use of the memory (Q5). |
| Execute from ROM without copying into RAM | Proven for DOCK chunks 0-1 and 4-5 (**EMU**, all Arcade games). Code in DOCK chunk 3 is documented (**TM** 5.1.1 p.76). Code running from DOCK chunks 2 and 3, with the frame interrupt serviced, is proven on TSRun only (**EMU**, `arcade/spike/xip/RESULTS.md` E1). Running from them while the kernel draws through trampolines is untested. |

## Hardware facts this design rests on

- **Clock and frame.** The CPU runs at 3.528 MHz (14.112 MHz / 4). A frame is 262 lines at 60.1145 Hz, so 224 T a line and 58,688 T a frame (**TM** 2.1.3.1, 2.1.8.3 for the clock, lines and rate; the T-state figures are arithmetic). The manual's "15.635 ms" figure is an internal inconsistency.
- **Banking.**
  - Port `$F4` bit n maps chunk n from the alternate bank. Writing to it uses 1 = mapped; the cartridge header uses 0 = in use.
  - Port `$FF` bit 7 picks the bank: 0 = DOCK, 1 = EXROM. DOCK and EXROM are mutually exclusive (**TM** 2.1.13.5, 5.1).
  - The EXROM is unusable while a cartridge is mapped (**TM** 3.2.2.4).
- **Display while banked.** Display RAM "is accessed independently by the video hardware. The software only needs to enable it when actually reading or writing it" (**TM** 5.1.1 p.76). This implies the picture stays while a DOCK chunk is mapped over `$4000-$7FFF`. It is modelled by all three emulators (**EMU**: the Arcade bank probe) and not tested on hardware (Arcade checklist item 0).
- **Code in DOCK chunk 3.** "LROS may contain code in Chunk 3, but it should be enabled after the OS RAM code has finished execution" (**TM** p.76). The cartridge must not mark chunk 3 in its header, because start-up runs and keeps its stack (SP `$6200`) there. Arcade's boot already handles this.
- **Contention.** "the CPU clock is stopped in the high state until the video display processor access has been completed" whenever the CPU addresses the 16 KB of RAM holding the display file while video needs it (**TM** 2.1.8.2 p.23). The RAM above `$8000` is a separate bank and is not slowed. The manual gives no figures. Not measured anywhere.
- **Video modes** (port `$FF` bits 0-2; **TM** 2.1.13.1, 5.2):

  | Value | Mode | Memory |
  |---|---|---|
  | 0 | Normal, 8x8 attributes | `$4000-$5AFF` (6,912 B) |
  | 1 | Second display file | `$6000-$7AFF` |
  | 2 | Extended colour, 8x1 ("High Resolution Graphics" in the manual) | Pixels `$4000-$57FF`, colour byte at pixel + `$2000` (`$6000-$77FF`); `$5800` and `$7800` unused |
  | 6 | 64-column, 512x192 | Even byte columns from `$4000`, odd from `$6000`. Ink = bits 3-5, paper = complement, one of 8 fixed pairs for the whole screen, no bright or flash, border = paper |

  Other values give "unpredictable results". **Modes 2 and 6 use exactly the same memory, and mode 0 is a subset of it.**
- **Interrupt.**
  - Fires in vertical blanking when `$FF` bit 6 = 0. The cartridge is entered in IM 1 with interrupts enabled (**TM**).
  - How long /INT is held, and whether an interrupt that arrives during `DI` is held or lost: **not documented**. TSRun drops it, so design for the worst case.
- **Storage.** No disk or drive interface is documented. Only tape, the 2040 printer and joysticks are (**TM**).

## 1. Which Leap components can be reused

### From Leap Arcade (`~/Projects/Leap-IDE/arcade/runtime/`; all EMU)

| Component | Where | Use in Leap Desktop |
|---|---|---|
| LROS boot and handoff (spec byte `$BC`, `DI`, own stack, shadows of `$F4`/`$FF`) | `v2/boot.asm`, `ARCADE_CARTRIDGE_MAP.md` | As is |
| 46-byte IM 1 interrupt handler at `$0038` (frame counter, flip handshake) | `v2/isr.asm` | Base of the kernel ISR; add input polling and the event queue |
| Keyboard matrix table; joystick through AY register 14 | `v2/keys.asm`, `ARCADE_HARDWARE_NOTES.md` section 4 | Input layer (the joystick is proven on TSRun only) |
| Masked, pre-shifted, unrolled blitters (1/2/3-byte widths; 16x16 draw about 2,240 T) | `v2/sprite.asm`, `assets.asm` | Pointer, icon drag, cursor |
| Cell map, dirty bitmaps and redraw (94-400 T a cell); rectangle walker with clipping and memmove copy | `v2/video.asm`, `text.asm`, `tileops.asm` | Damage tracking and the cell-grid window manager (section "Recommended architecture") |
| Bank window discipline (`bank_on`/`bank_off`, shadow `$F4`, loaders map and unmap themselves, rules 1-5) | `ARCADE_BANKING_CONTRACT.md`, `tileops.asm` | Kernel banking rules, verbatim |
| AY delta-stream sound tick | `v2/sound.asm` | UI sounds (optional) |
| Build: runtime builders, DCK linker, `runtime.json` single spec, relocation proposal, Studio size panel | `arcade/tools/`, `src/lang/arcade/arcade-link.js`, `ARCADE_RUNTIME_SPEC.md` | Kernel and app build; ABI spec generator |
| Tests: TSRun harness, interrupt injection at every instruction, memory poisoning, mutation runs, three-emulator compare scripts | `arcade/tests/`, `arcade/tools/xemu/` | Test method for every kernel module |

The graphics pieces, with measured costs, adaptations, traps and gaps, are in the section "Graphics core: what comes from Arcade".

### From Leap V2 (`~/2068-Leap`; EMU)

| Component | Where | Notes |
|---|---|---|
| Screen addressing, `ROW_BASE_TABLE`, `GFX_LINE` (the Forth port, with a hi-res path), `GFX_PLOT_CLIPPED`, `GFX_PIXEL_AT` | `kernel/graphics/graphics.asm` | Reuse |
| `FONT_TABLE`: 95 glyphs, 8x8, about 760 B | same file | System font (Arcade's `gen-font.mjs` already extracts it) |
| `GFX_SET_MODE` | same file | Remove the `VM_ERR_ARRAY_SPACE` coupling |
| 16-bit mul/div/mod/sqrt/abs/sgn/random | `kernel/math/math.asm` | Reuse |
| `IO_DECODE_KEY` and its ASCII tables, including SYMBOL SHIFT | `kernel/io/io.asm` | Text entry (Write, dialogs) |
| Clean-room tape block I/O and header handling | `kernel/storage/storage.asm`, `tapeblock.asm` | File services |
| 5-byte float library and exact formatter | EXROM (`rom/exrom_calc.asm`, `exrom_v2_float_fn.asm`, ...) | **Maybe**, for Calculator. It is tied into the VM; extraction effort unknown |

**Keeping V2 frozen.** Copy these files into LeapG with a provenance manifest (source repo, commit, path, what was changed), or read
them read-only at build time as `gen-font.mjs` does. Never edit them in `~/2068-Leap`.

## 2. What to discard or redesign

**Discard:**
- the lexer, compiler, VM, decompiler, editor, highlighter, help, symbol table and Array Store;
- `kernel/memory/memory.asm` (a BASIC line store, not a heap);
- the extension registry and package ABI;
- V2's cell-aligned, background-saving sprite package;
- `KBD_ISR_TICK`;
- `kernel/bank/bank.asm` (EXROM paging; the EXROM cannot be mapped with a cartridge).

**Redesign:** Arcade's game-tick frame loop, its fixed 16-instance sprite table and its game header. These become the event loop,
the object heap and the app header.

## 3. Is 48 KB of RAM enough?

Yes, for one application at a time.

Recommended map: mode 6 desktop, with the active app running in place from DOCK chunks 4-5. The contention fact moves everything speed-critical above `$8000`.

| Range | Size | Use |
|---|---|---|
| `$4000-$57FF` | 6,144 | Screen, even byte columns (modes 2 and 6: pixels) |
| `$5800-$5FFF` | 2,048 | Cold kernel data: clipboard, dialog scratch, tape header buffer. Not displayed in modes 2 and 6. In mode 0 `$5800-$5AFF` is the attribute file and only `$5B00-$5FFF` is free |
| `$6000-$77FF` | 6,144 | Screen, odd byte columns (mode 6), or the colour file (mode 2). In mode 0 this is a free off-screen buffer |
| `$7800-$7FFF` | 2,048 | Cold kernel data, as `$5800` |
| `$8000-$BFFF` | 16 KB | DOCK 4-5 mapped (RAM hidden). RAM for an app loaded from tape |
| `$C000-$DFFF` | 8 KB | App heap (not contended) |
| `$E000-$FFFF` | 8 KB | Kernel hot data, about 1.5 KB **EST** (vars, 16 x 4 B event queue, window table, 768 B cell-owner map, 96 B dirty map, pointer save-under); stack 1 KB; the rest is app heap |

All of `$4000-$7FFF` is contended, and hidden while DOCK 2-3 is mapped. Nothing the ISR or a bank loader needs may live there.

- **App heap:** about **13.5 KB** **EST**, the same in every mode.
- **Menu save-under:** comes from the heap. A drop-down 96 pixels wide and 80 lines tall is 12 bytes x 80 = 960 B in mode 6.
- **App in mode 0:** may borrow the 6.9 KB at `$6000` as an off-screen buffer.
- **App loaded from tape into `$8000-$BFFF`:** gets 16 KB more.
- **Comparison:** about the same as GEOS 64's application area, but with no disk to page from.
- **Limits this implies:** a Write document of about 8-10 KB; a Paint picture of one screen (12 KB in mode 6 or mode 2, 6 KB in mode 0) with no full-screen undo buffer.

## 4. Organising and running software from the cartridge

| DOCK chunks | Size | Content | Status |
|---|---|---|---|
| 0-1 (always mapped) | 16 KB | Kernel, about 12-15 KB **EST**: boot, ISR, input, event queue, graphics core, text and fonts, window manager, menus, dialogs, object dispatch, allocator, far-call trampolines, jump table | Pattern proven (EMU) |
| 4-5 | 16 KB | Toolkit (controls, about 3-4 KB **EST**), desktop shell (about 3 KB), Calculator (about 2 KB) | Pattern proven (EMU) |
| 2-3 | 16 KB | Write (about 6-7 KB **EST**) and Paint (about 5-6 KB), executing in place. Every display access goes through kernel trampolines that unmap 2-3, draw and remap (about 50 T a call **EST**). The ISR runs from chunk 0 with its stack in chunk 7, and saves and restores `$F4` itself if it must touch the screen | **TM** allows it. **Probe (a) passed on TSRun, ZEsarUX 13.0 and Fuse 1.9.1** (**EMU**, `docs/PROBE_DOCK23.md`): code in place, calls between 2 and 3, the trampoline, an ISR drawing while mapped |
| 6 | 8 KB | Resources: icons, a second font, dialog templates. Can be blitted straight to the screen; the heap at `$C000-$DFFF` is hidden while it is mapped, so the blit source must not be heap | Reads proven (EMU) |
| 7 | — | Never mapped: the stack lives there | — |

- **What an app in chunks 2-3 sees:** 48 KB of code (chunks 0-5) and 16 KB of RAM (`$C000-$FFFF`).
- **32 KB variant (chunks 0, 1, 4, 5 only):** kernel, shell, toolkit and Calculator. Enough for the proof of concept, not for Write plus Paint.
- **Physical cartridge:** how large one can be depends on the cartridge hardware (for example a TS-Pico design). The manual's reference board takes four 27128 EPROMs (4 x 16 KB).

## 5. Video mode

**Desktop: mode 6 (the manual's "64 Column Mode", 512x192), black on white.** This is the highest resolution the TS2068 has.

| | Mode 0, mono | **Mode 6** | Mode 2, 8x1 colour |
|---|---|---|---|
| Resolution | 256x192 | **512x192** | 256x192 |
| Text per line, 8-pixel font | 32 | **64** (about 85 with a 6-pixel font) | 32 |
| Screen memory | 6.9 KB | 12 KB | 12 KB |
| App heap | about 13.5 KB | about 13.5 KB | about 13.5 KB |
| Spare 6.9 KB buffer at `$6000` | yes | no | no |
| Colour | 8x8 cells | none: one fixed ink/paper pair, no bright or flash, border = paper | 8x1 |
| Pixel shape | about square | half as wide as tall | about square |
| Whole-screen clear, fill or scroll | 1x | 2x | 1x (2x when the colour also changes) |
| Cost per character of 8-pixel text | 1x | about 1x (twice the text for the same work) | 1x (plus colour) |

**Why mode 6:**
- A GEOS-style desktop is mostly text, menus and dialogs, and mode 6 doubles what fits. GEOS 128's 640x200 black-and-white 80-column mode is the historical precedent (general knowledge, not from the project sources).
- No colour clash, because there is no colour.
- App RAM is the same as in mode 0. The only loss is the spare buffer, and menu save-under comes from the heap instead (Q3).

**What mode 6 costs:**
- **Tall, thin pixels.** Icons, the pointer and shapes must be drawn for a 1:2 pixel. A circle needs x scaled by 2.
- **Twice the bytes per screen.** Full-screen clears, fills and scrolls take twice as long as in mode 0.
- **Alternating files.** Pixel x lives in byte column `x >> 3`: file `(x >> 3) AND 1`, offset `x >> 4` within the row (**TM** 5.2.3). Horizontal spans toggle `H xor $20` at every byte and step `L` every second byte. Every primitive needs this addressing; the per-byte cost is small.
- **Pointer travel.** A joystick or keyboard pointer has 512 positions to cross, so it needs acceleration.
- **Display readability.** A 512-pixel line on an RF or composite TV is a question for the hardware phase. The emulator target shows it exactly (see the revision note).

**Grid.** Windows snap to cells 16 pixels wide and 8 lines tall: the same physical positions as mode 0's 8x8 cells. So the
cell-owner map stays 32 x 24 = 768 B, and a window edge always falls on a byte pair (one byte in each file).

**Per-app modes, on the same memory map.** All three modes fit the reserved `$4000-$7FFF`, so switching needs no memory changes,
only a redraw:
- **Mode 6:** the desktop, Write, the shell.
- **Mode 2 (8x1 colour):** Paint and anything that needs colour.
- **Mode 0:** an app that wants the spare 6.9 KB buffer, or Arcade-style colour cells.

The kernel's graphics core is written for all three from the start. Within each display file all three use the normal Spectrum
row layout (32 bytes a row). Mode 6 changes only which file a byte column lives in; modes 0 and 2 differ only in where the colour
goes. So one row table and one set of per-row routines serve all three, with a per-mode "next byte" step and colour hook.

## 5a. The mode decision after the graphics spike (2026-11-11)

The spike (`docs/GRAPHICS_SPIKE.md`, slices S1-S5) built the mode 6 graphics core and a mock desktop, `spike6`. All figures are
TSRun T-states (**EMU**, no contention); the demo's screens are identical on ZEsarUX 13.0 and Fuse 1.9.1.

**Judgement: keep mode 6.** Its three open questions (spike section 1) are answered well enough. Its real costs are code size and
whole-window copies, not drawing speed, and neither is solved by changing the mode.

| Question | Answer from the spike |
|---|---|
| **1. Text speed** | 8x8 text 232 T a character; proportional text 668 T a glyph at about 88 characters a line, against the 400-500 T this review estimated. A full screen of proportional text (about 2,100 glyphs) is about 1.4 M T, a quarter of a second on TSRun. Short strings pay a line setup of about 2,760 T each, so a menu of five items costs 65-87 k T: the kernel should draw a list in one call. |
| **2. Drawing on the visible screen** | Solved for the pointer. The frame ISR erases and draws it in at most 6,779 T, before the beam reaches it (8,194 T with the worst interrupt delay, against 8,960), and the shield keeps drawing and pointer apart. In the demo, menus with save-under, an XOR drag outline and the pointer leave no trace on three emulators. Drawing that runs longer than a frame makes the pointer lag one frame (4 frames in the demo's script). Per-edge shields keep the pointer visible during a drag. |
| **3. Cost of the alternating files** | Fills, lines, blits and text meet their bounds. Copies of screen rectangles do not: save / restore 96 x 80 take 23 k T (bound 20 k), and vertical scroll 75.8 k T for 256 x 96 by 1 row and 235 k T for the whole screen by 8 rows (bounds 55 k and 200 k). These are limited by `LDI` with interrupts on, so they would be half as long in mode 0 only because mode 0 has half the bytes. A scrolling Write window (about 4 frames a step at full screen) is usable but not smooth. |

**What the spike changes in this review:**
- **Code size is the binding constraint.** gfx6 is 13.3 KB (target 4 KB): the speed came from unrolled bodies and per-op pass
  blocks. With its tables (about 8 KB in chunk 4) it takes most of what section 4 gave the kernel in chunks 0, 1, 4 and 5. The kernel
  (objects, events, windows, menus) must fit in the rest, or gfx6 must shrink (spike 13.2 lists 891 bytes measured; the text pass
  blocks and the `G_FILL` bodies are the large parts), or the cartridge grows past 32 KB of always-mapped code (Verdict, condition 1).
  This is the first decision for roadmap step 3. **Decided (owner, 2026-11-11): plan for a 56 KB cartridge (DOCK 0-6)**, with
  always-mapped code still 32 KB; gfx6 cleaned up to 12,451 bytes (`docs/CODE_SIZE.md`).
- **Section 3's map:** chunk 4 now holds gfx6's page-aligned tables, so "the active app running in place from DOCK chunks 4-5" needs
  revisiting: apps in DOCK 2-3 (probe (a), passed) are the remaining place.
- **Contention** (section 8, risk 2) still applies to all of the above: every figure here is a lower bound for real hardware.
- **Pointer design:** the arrow's hot spot is a paper pixel, so the pointer cannot be seen in the bottom-right corner. Redraw it with
  an ink hot spot before the kernel.

**Not answered by the spike:** the mode 0 and mode 2 variants (roadmap step 2's last item), and how 512-pixel lines look on a real
display (hardware phase).

## 6. Object model

- **Class descriptor (in the cartridge):** parent pointer, instance size, method count, and a vtable of 2-byte method addresses. Single inheritance is **flattened at build time** by the IDE linker (or assembler macros), so there are no run-time lookups.
- **Instance (in RAM):** a 2-byte class pointer, then the fields. Typical control: class 2, parent 2, next sibling 2, rect 4 (x, y, w, h in cells or pixels), flags 1, id 1, text or data pointer 2 = 12-16 B. 100 controls take about 1.6 KB.
- **Message send:** `IX` = self, `A` = message number, `RST` to the dispatcher. It reads the class pointer from `(IX+0)`, indexes the vtable and does `JP (HL)`. About 100 T **EST**. Calls are direct where the class is known.
- **Polymorphism and encapsulation:** standard messages (`Draw`, `HandleEvent`, `HitTest`, `Destroy`) with base-class defaults. Fields are reached only through `IX+offset` constants generated from the class definition.
- **Allocation:** one arena per app, freed in one step when the app quits, plus small pools for each size of object. No garbage collection and no fragmentation. The window tree uses first-child / next-sibling links.
- **Bank rule:** an object can exist only while its class's chunk can be mapped. Kernel, toolkit and active-app objects only.
- **Leap-C:** already has `struct` and function pointers, so C with hand-built vtables works today with no language change. Classes would be syntax on top. But Leap-C compiles inside its own ROM against its own library, so linking against this kernel needs a cross-compiler in the IDE. Arcade's JavaScript compiler is the precedent.

## 7. OS ABI and application interface

- **Kernel jump table** at fixed addresses in DOCK chunk 0 (`JP` entries), plus RSTs for the hottest calls (message send, far call).
  - Arcade relinks every game against its runtime and has no stable entry points.
  - A desktop that runs separately built apps needs them. The jump table is versioned; entries are added, never moved.
- **One machine-readable spec** (`desktop.json`, in the style of Arcade's `runtime.json`): name, arguments and registers, clobbers, bytes, banks touched. It generates the assembly `.inc`, the IDE tables and the help.
- **Registers** (Arcade's convention):
  - arguments in registers, results in `HL` or `A`;
  - AF, BC, DE, HL clobbered; IX (self) and IY preserved;
  - the shadow register set belongs to the ISR.
- **App header** (at the start of the app's chunk, as Arcade's game header at `$8000`): magic, ABI version, entry (init), class table, resource directory, RAM needed, display mode, name, icon.
- **Events:** 4-byte records (type: key, joystick, pointer move, button, timer, redraw, menu, quit; 3 data bytes) in a 16-entry ring that the ISR fills. The app calls `GetEvent`; the kernel delivers `HandleEvent` to the focused window and its controls; base classes do the defaults.
- **Input with no mouse:**
  - keyboard focus navigation first (TAB, arrows, ENTER, menu keys);
  - a joystick or keyboard pointer with acceleration second.

## Recommended architecture in one picture

**Applications** (shell, Calculator, Write, Paint, third-party): event loop, objects, messages, kernel jump table.

**Toolkit** (DOCK 4-5): Button, Checkbox, List, TextField, Scrollbar, Dialog classes.

**Kernel** (DOCK 0-1):

| Area | Contents |
|---|---|
| Window manager | Cell-owner map (32 x 24 cells of 16 x 8 pixels in mode 6, 768 B), damage via dirty bitmaps, z-order, outline drag, menus with save-under from the heap |
| Objects and events | Dispatcher, arenas and pools, event queue, focus |
| Graphics | Rect fill / invert / frame, lines, clipping by cell ownership, masked and opaque blits, 8x8 and proportional text; mode 6 addressing first, modes 0 and 2 through the same row routines |
| Platform | Boot, ISR, input, banking trampolines, tape, 16-bit maths |

The key simplification is the **cell-grid window manager**. Windows snap to cells (16 x 8 pixels in mode 6, 8 x 8 in modes 0 and
2: the same positions on screen), and a 768-byte map records which window owns each cell. Clipping becomes a lookup, and damage
tracking is Arcade's dirty bitmap. There is no general region arithmetic as in GEOS, GEM or the Mac. Drawing inside a window is
still pixel-precise.

## Graphics core: what comes from Arcade

**Summary.** Arcade has no ready-made desktop primitives. Every routine assumes mode 0, 8x8 cells and flipping between two display
files, and nothing in Arcade draws in mode 6 or mode 2. What it has is a set of proven techniques and measured inner loops. My
estimate is that about two-thirds of the kernel's graphics core can be adapted from them (**EST**). All costs are **EMU** (TSRun,
no contention) unless marked.

Paths are under `~/Projects/Leap-IDE/arcade/` (runtime file:line is v2 unless a version is given).

### Adapt

| Arcade piece | Desktop use | Measured cost | Adaptation |
|---|---|---|---|
| **v3 masked blitter**: windows 1-5 bytes wide and 1-48 rows, unrolled 8-row blocks entered at an offset through a `PUSH`/`RET` table, row groups split at cell boundaries so a row step is `inc d` (`runtime/v3/sprite.asm`; v2 `sprite.asm:15-171`) | Pointer, icons, drag images | 38-40 T a byte; 16x16 at 8 phases: draw 3,468 T, erase 2,093 T (`docs/ARCADE_RUNTIME_API_V3.md`) | Steps right with `INC E`, so needs the mode 6 file step: toggle `H xor $20`, `L` +1 every second byte. Two unrolled variants per width, by starting column parity |
| **Pre-shift builder**: 24-bit window, mask filled with 1s (`runtime/v2/assets.asm` `build_asset`/`shift_vbuf`; v3 `build_frame`) | Pointer and icon shifts, built at boot | about 1,300 T a row | Fixed pool addresses (`$C200-$CDFF`, `$F000-$FA7F`) move into the kernel map |
| **Pre-shifted left/right tables**: byte = `LTAB[p][a] OR RTAB[p][b]` (`runtime/v3/scroll.asm` `rows_pn:734`; built by `src/lang/arcade/arcade-window.js:59`; chosen in `spike/scroll/RESULTS.md` V2) | **Proportional text** and drawing any unshifted bitmap at any x | 33 T a byte in the scroller | The shipped tables are indexed by tile (32 tiles). A version indexed by byte value has the same size (14 pages, 3.5 KB) and does not exist yet. About **400-500 T a glyph** (**EST**) |
| **Glyph planes**: row k of glyph v at `GLYPH_TAB + 256k + v`, one `inc b` per row (`runtime/v2/video.asm:146-160, 193-255`) | Fast 8x8 text: 64 columns in mode 6 | `draw_cell` 333 T including the colour byte (`ARCADE_RUNTIME_API_V1.md`) | No colour byte in mode 6. The 2 KB table can be ROM, built at assembly time |
| **Dirty bitmap** with 8-cell mask bytes, `redraw_dirty` (`video.asm:262`), `cell_set`/`mark_dirty` (`text.asm:39/64`), `BIT_TAB` | Damage tracking for the cell-grid window manager | clean scan 1,339 T; 460-716 T a dirty cell | Simpler: mode 6 has no flip, so one dirty map, not two |
| **Rectangle walker** (`runtime/v2/tileops.asm`): `clip_axis:82` signed clipping; `walk_setup:386` cuts each row into first, whole-byte and last groups; sentinel-bit masks (no loop counter); memmove ordering in `RT_COPY:728` | **Pixel rectangle fill, invert, XOR, frame**; window moves; area copy | cell fill 94-220 T a cell; copy 123-194 T a cell | Same structure with partial-byte masks at the left and right edges |
| **PUSH fill** (`spike/native/b3_crunch.asm:19-32`) | Clearing the screen or a large rectangle | about 11.5 T a push (23k T for 2,000). A full mode 6 clear is about 70k T, 1.2 frames (**EST**), against about 258k T with `LDIR` | Uses `SP`, so needs `DI`. Clear in pieces shorter than a frame (TSRun drops an interrupt that arrives under `DI`) |
| **Horizontal shift of drawn pixels**: `rl (hl)` in place 19 T a byte, `LDI` byte shift 16 T a byte (`spike/scroll/v4.asm:90-141`, `v5.asm:153`) | Scrolling a document window's contents | measured | Whole-screen only today; rewrite for a rectangle. Vertical scroll by row copies is not in Arcade (16 T a byte with `LDI`) |
| **Column chain**: one unrolled sequence draws a run of any length, ended by an `RST` patched into it (`runtime/v4/ray.asm:1229` `rw_column`, `CHAIN_T:1392`) | Fast vertical spans: vertical lines, rectangle sides, Paint fills | about 17.6 T a byte | Modifies itself, so it runs from RAM |
| **Nearest-neighbour (DDA) scaling**, 8.8 accumulators (`runtime/v4/raybb.asm:477` `bb_draw`; `spike/raycast/sprite.asm:23-46`) | Paint zoom (FatBits), scaled icons | 76-143 T a pixel | Mono only; no masks needed |
| **Fixed-point maths**: `RT_FXMUL` (`raybb.asm:953`), `mul8x16`, `gen_mul` (builds a multiply-by-constant routine at run time, `ray.asm:1031`), quarter-wave sine table, reciprocal table with incremental rebuild (`ray.asm:355-425`), `RT_MUL`/`RT_DIV` (`runtime/v4/api.asm:167/196`) | Paint circles and ellipses, line slopes, scaling | `FXMUL` 1,029-1,354 T; `COSA`/`SINA` 256-324 T | — |
| **Code copied to RAM** (`ray.asm` copies a 473-byte image to `$5B00`) and **code generated at run time** (`gen_mul`, `bb_draw` writing per-column code) | Hot inner loops that modify themselves | — | Put them above `$8000`, not at `$5B00`: that area is contended and hidden while DOCK 2-3 is mapped |

### Use as is or nearly

- **ISR and frame handshake:** the 46-byte handler, `V_SYNC`, the frame counter (`isr.asm:16-39`, 151 T idle). The flip part drops out in mode 6.
- **Stack canary:** checked every tick (`main.asm:20-43`).
- **Register rules:** the shadow registers belong to the ISR; routines save `AF'` if they borrow it (`tileops.asm:576-589`).
- **Small techniques:**
  - page-aligned tables indexed through `L`;
  - cell-index arithmetic with `rrca` x3 (`text.asm:13`);
  - self-placing macros that avoid alignment padding (`v3/sprite.asm:131-250`).
- **Test method:** reference models in JS, interrupt injection at every instruction, memory poisoning, mutation runs, three-emulator compares.

### Traps (from the surveys and the Leap-IDE session)

1. **No flipping in mode 6.** Arcade draws into the hidden display file and flips, which is how it never tears, and it keeps dirty state and caches per file. Mode 6 uses both files as one screen, so the desktop draws **directly on the visible screen**. That calls for:
   - a pointer drawn with save-under and erased before anything under it is drawn;
   - repaints timed against the beam where flicker matters;
   - outline drags.
2. **Page-aligned tables wrap silently.** They are walked with `INC L` / `INC E`, which wrap past `$FF` without a carry.
3. **The runtime is ROM.** Self-modifying code must be copied to RAM.
4. **Special cases cost more than they save if tested per cell.** A jump out of an unrolled loop to a special case costs about 75-90 T, which eats most of the saving. Decide at a coarser granularity (v3 tests one bit per pair of cells, about 9 T a cell). Spare low bits of `tile * 8` bytes are a cheap place for per-cell flags.
5. **Display-file tails are not free.** v3/v4 keep tables and RAM code in `$5B00-$5EFF`, and the bank window hides them. In this design they hold only cold data (Q3).
6. **`SP` tricks need `DI`.** `pop` as a fast read, return threading and `push` fills (`spike/native`, `spike/G1.md`) were measured without the ISR running, so their figures are upper bounds.

### Still to write (no Arcade equivalent)

| Gap | Starting point |
|---|---|
| Mode 6 addressing layer (row table, file-parity step) | — |
| Pixel rectangle fill / invert / XOR / frame | The rectangle walker above |
| Proportional text, glyph-width tables | Byte-value shift tables (above) |
| Lines | Leap V2's `GFX_LINE` (`~/2068-Leap/kernel/graphics/graphics.asm:1401`), adapted to mode 6 |
| Pixel clip rectangles | `clip_axis` |
| Save-under / restore rectangle | Row copies |
| Opaque blit | Masked blitter with the mask step removed |
| Vertical scroll of a rectangle | Row copies |

## 8. Biggest risks and constraints

0. **Test target.** For now the target is the emulators, so items 1 and 2 do not block development. They become blocking when the project moves to real hardware.
1. **Real hardware.** Banking depends on the display staying visible while a DOCK chunk is mapped over it (**TM** implies yes; Arcade checklist item 0). Running code from DOCK 2-3 is untested. Whether an interrupt that arrives during `DI` is held or lost is undocumented.
2. **Contention** (**TM**: real, no figures; TSRun: not modelled). Every drawing timing from Arcade's TSRun runs is optimistic by an unknown amount. Measure it on hardware. ZEsarUX's Spectrum-style model is at best a rough stand-in.
3. **Text speed.** No proportional-font renderer exists in Leap or Arcade, and none for mode 6's alternating files. With Arcade's pre-shifted table method, about 400-500 T a glyph **EST**. A full mode 6 screen (64-85 x 24 characters) takes about 0.2-0.3 s before contention.
3a. **Drawing on the visible screen.** Mode 6 has no spare display file, so Arcade's tear-free flip model does not apply (Graphics core, trap 1). Flicker under the pointer and during repaints must be designed out, and checked by eye in TSRun.
4. **No backing store.** Exposed areas are redrawn from the object model. Window drags must use an XOR outline, not live moving. In mode 6 every repaint touches twice the bytes of mode 0.
5. **The 16 KB kernel budget.** V2's HOME ROM filled to 16,330 of 16,384 bytes.
6. **Storage is tape only** (**TM**). A file manager is a tape catalogue; documents save and load by name.
7. **Toolchain.** Apps are assembly-only until a cross-compiler exists.
8. **Bank bugs can hide.** ZEsarUX lets writes reach a mapped DOCK chunk above `$4000`, which corrupts the bank (**EMU**); TSRun and Fuse ignore such writes. The kernel tests must check that nothing writes into a mapped window.

## 9. Smallest proof of concept

One 32 KB DCK (DOCK chunks 0, 1, 4, 5: the shape Arcade has already proven), run in TSRun from a Leap-IDE-style page and
cross-checked on ZEsarUX and Fuse. It shows:
- a mode 6 (512x192) desktop;
- two overlapping cell-snapped windows with z-order and damage repaint;
- a menu bar with one drop-down using save-under from the heap;
- a joystick / keyboard pointer, drawn by Arcade's blitter adapted to mode 6's alternating files;
- an outline drag;
- one button dispatched through its vtable;
- 8x8 text and one proportional-font string.

**Measured and reported:** T per glyph, menu open and close, window raise, pointer cost per frame, kernel bytes and RAM.

**Mode check.** The same graphics core draws one window's contents in mode 0 and mode 2, to prove that the per-app modes work on one code base.

**Side probes:**
- **(a)** code executing from DOCK 2-3 through a kernel trampoline, with interrupts on: **done, PASS on TSRun, ZEsarUX and Fuse** (`docs/PROBE_DOCK23.md`);
- **(b)** later, for the hardware phase: a contention test cartridge (a timed loop from `$4000`, `$6000`, `$8000` and `$C000`, and from DOCK chunks), plus how mode 6 looks on a real display.

## Roadmap (priority order)

0. **Probe (a): done, PASS on all three emulators** (`docs/PROBE_DOCK23.md`). Probe (b) and Arcade hardware checklist item 0 wait for the hardware phase.
1. **Project setup:** the LeapG repo, vendored sources with a provenance manifest, Arcade's build tools and DCK linker, a test page in the style of Leap-IDE running TSRun, the memory map, and `desktop.json` (the ABI spec).
2. **Graphics core, mode 6 first:** mode 6 core and demo **done on emulators** (`docs/GRAPHICS_SPIKE.md` S1-S5; decision in section 5a). Code size decided (56 KB cartridge, `docs/CODE_SIZE.md`). Left: the mode 0 and 2 variants.
   - Adapt the Arcade pieces in "Graphics core: what comes from Arcade": masked blitter, pre-shift builder, shift tables, glyph planes, dirty bitmap, rectangle walker, PUSH fill.
   - Write the gaps: mode 6 addressing, lines, clip rectangles, save-under, opaque blit.
   - Then add the mode 0 and 2 variants.
   - Test each piece against a reference model on TSRun, as Arcade does.
3. **Objects and events:** class descriptors, message send, arenas and pools, the input ISR, the event queue, focus. Contract: `docs/OBJECTS_EVENTS.md` (owner approved). **Built on emulators (2026-11-12):** slices K1-K3, the `kern3`
   test cartridge and the `kern3demo` demo; the pointer has an ink hot spot (5a).
   - K1's bounds pass: send 87 T, `K_NEW` 437 T.
   - Speed bounds missed and recorded with options (OBJECTS_EVENTS 16.2, 16.3); the owner's decisions are in 16.4 (2026-11-12):
     - the ISR's worst input frame, 4,954 T against 2,000: the measured figures accepted (bounds 5,250, whole ISR 12,000);
     - the focus walk at 32 views, 10,881 / 17,952 T: accepted (bounds 11,000 / 18,000);
     - routing: plain views hit-tested in place (option E) and the tree walked through HL (option D, a Fable job). Every bound
       now passes: per event 472 T (500), bubble 186 (200), `E_DOWN` through 8 children 3,463 (3,500), `E_MOVE` 2,443 (2,500).
   - Step 3 takes 2,394 bytes of the always-mapped pool (bound now 2,400), leaving about 9.3 KB.
4. **Window manager:** window list, damage repaint, menus, dialogs. Together with steps 2-3 this is the proof of concept, the first milestone. Contract: `docs/WINDOWS.md` (owner approved). **Built on emulators (2026-11-12):**
   - **The slices:** W1 (the cell map, repaint, activation), M (the Kempston mouse, with TSRun's emulation and the page's Mouse switch), W2 (clicks, drag, dialogs, `Button`, `Label`) and W3 (menus).
   - **The demo:** `kern4demo` is the PoC demo. It matches TSRun byte for byte on ZEsarUX and Fuse, and the owner tried it in a browser with the mouse.
   - **Speed:** a Fable pass (B) cut the overhead. The window operations' bounds are the measured figures (C): raise and open about 89 k T, close 62 k, move 167 k. Seven other bounds are missed and recorded (WINDOWS 16.4-16.6).
   - **Size:** a size pass (Fable) brought step 4 from 6,308 to 4,837 bytes, which is now the bound (owner; was 4,096). The kernel is 7,217 bytes, the menus in chunk 1. About 4.5 KB of the always-mapped pool is left; where the toolkit and apps go is decided at the start of step 5.
5. **First applications:** controls, the shell, Calculator, then Write (mode 6), Paint, tape file services.
   - **Where code lives:** contract `docs/BANKING.md` (owner approved, 2026-11-12). The toolkit stays always mapped; the apps go
     in DOCK 2-3. One `RST $28` far call crosses between the mappings K, A and R. **Slice B0 done on three emulators:**
     331-352 T a crossing (FEASIBILITY 4's "about 50 T" was optimistic), code in DOCK 6 drawing directly, every bound passing.
6. **Banking and SDK:** banked apps in DOCK 2-3, the third-party app header, the IDE SDK and templates, later a Leap-C cross-compiler and a visual designer.

## Open questions

- For the hardware phase: is a real TS2068 available for probe (b) and checklist item 0? Which cartridge hardware, and how many KB can it hold?
- Is any storage other than tape in reach? On the emulators, the IDE could supply files as tapes, as Leap-IDE already does. A file manager depends on the answer.
- Mode 6 ink/paper pair for the desktop: black ink on white paper is assumed (bits 3-5 = 000, the manual's "Black/White"). Any of the 8 pairs is a one-byte change.

Decided (owner, 2026-11-11): the desktop runs in mode 6, tested on emulators for now. Colour is per app (mode 2), not on the desktop.
