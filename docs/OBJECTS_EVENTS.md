# Objects and events: contract (draft 2, 2026-11-11, owner approved)

Roadmap step 3 (`docs/FEASIBILITY.md` sections 6 and 7). Binding for step 3's code, generators and tests once approved. An
"As built" section is added when it is done. Marks as in FEASIBILITY: **EMU** measured, **EST** estimated.

Style as `docs/GRAPHICS_SPIKE.md`: every number in section 8 is a bound. **A missed bound is reported with its numbers before
anything is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

## 1. What step 3 builds

The kernel's middle layer, between gfx6 and the window manager (step 4):

1. **Classes and message send:** class descriptors in the cartridge, single inheritance flattened at build time, `RST $08` send.
2. **Arenas and pools:** a kernel arena and an app arena, each with free-list pools for small objects.
3. **The input ISR:** keyboard, joystick 1 and the pointer read every frame by the frame interrupt, after `P_ISR`.
4. **The event queue:** 16 entries of 4 bytes filled by the ISR, plus a small queue for events the program posts.
5. **Views and focus:** a view tree (first child / next sibling), hit testing, pointer capture, keyboard focus and TAB navigation.
6. **The pointer redrawn with an ink hot spot** (FEASIBILITY 5a, S5 finding 2).

**Out:** windows, damage repaint, menus and dialogs (step 4); the jump table and `desktop.json` (step 6; section 5's tables are its
source); banked classes in DOCK 2-3 (step 6: the dispatcher touches no port, so nothing here blocks it); timers (the event type is
reserved); the mode 0 and mode 2 variants (deferred, owner 2026-11-11); contention.

## 2. Memory and cartridge

Cartridge shape of `spike6`: DOCK chunks 0, 1, 4, 5; `$F4 = $33`; stack `$FB00-$FEFF` (top `$FF00`), record at `$FF00`.

| Where | What |
|---|---|
| Chunk 0 | `RST $08` (the dispatcher, may run on into `$0010-$0017`: RST `$10` is then unused); the ISR entry at `$0038` |
| Chunk 5 from `$A000` | Kernel code `K_CODE..K_CODE_END` (step 3's routines, base classes, key map), then the test cartridge's own code |
| `$E000-$E0FF`, `$E100-$E6FF`, `$E700-$E7FF`, `$E800-$EFFF` | gfx6, pointer, `GCODE`, save-under: unchanged (GRAPHICS_SPIKE 12.1, 14.1, 15.1) |
| `$F000-$F03F` | `K_RING`: the event ring, 16 x 4 bytes, 64-byte aligned (an index steps with `ADD 4` / `AND $3F` on `L`) |
| `$F040-$F04F` | `K_POSTQ`: the posted queue, 4 x 4 bytes |
| `$F050-$F0FF` | Kernel variables (`K_VARS`): ring indices, input state, `K_EV`, `K_FOCUS`, `K_CAPTURE`, `K_ROOT`, the two arena records, port shadows |
| `$F100-$FAFF` | Kernel arena (2,560 bytes) |
| `$C000-$DFFF` | App arena in the test cartridge (8 KB). The final heap map is step 4's |

Boot initialises every variable above (TSRun fills RAM with random bytes). The key-map, class and acceleration tables are in
the cartridge.

## 3. Classes and message send

**Descriptor** (in the cartridge; the class pointer points at method 0, the header is below it):

| Offset | Size | What |
|---|---|---|
| -6 | word | Parent class (0 for `Object`) |
| -4 | byte | Class id (unique, for tests and debugging) |
| -3 | byte | Method count (1..127) |
| -2 | byte | Instance size in bytes, class pointer included (2..255) |
| -1 | byte | Pool: the offset of its free-list head in an arena record (section 4): 6, 8, 10, 12 for sizes 2-8, 9-16, 17-24, 25-32; 14 for larger (arena only) |
| 0 | 2 x count | Method addresses, **flattened**: every inherited slot is filled. The table never crosses a 256-byte page |

**Instance** (in RAM): word 0 is the class pointer, then the fields. Fields are reached as `(IX + <Class>_<field>)` (the kernel's routing walks views through HL instead, 16.4, option D).

**Generator** `tools/gen-classes.mjs` reads `src/kernel/classes.txt` and writes `src/kernel/classes.inc` (never hand-edited):
descriptors, `M_<Name>` message numbers and `<Class>_<field>` offsets. A subclass's new messages are numbered after its parent's;
a message name is defined once in the hierarchy (siblings may reuse numbers under different names). The generator fails the build
on an unknown method label, a page-crossing table, a duplicate name or an instance over 255 bytes.

**Send** (`RST $08`, `K_SEND`): IX = self, A = message number, BC and DE = arguments.
- Reads the class pointer from `(IX+0)`, indexes the table and jumps to the method. No check of A against the count: messages are
  sent only to objects known to have them (the count byte is for tests and a later debug build).
- The method starts with IX, IY, BC, DE as the caller left them; A, HL and F are undefined. It returns with a plain `RET` to the
  sender.
- Methods follow FEASIBILITY 7: they clobber AF, BC, DE, HL and preserve IX, IY and the alternate set. Results in carry, A or HL.
- A send to a known class, or to the parent's method ("super"), is a direct `CALL <label>`.

**Standard messages** (`Object`, numbers fixed):

| # | Name | In | Out | `Object` default | `View` default |
|---|---|---|---|---|---|
| 0 | `M_DESTROY` | | | `K_FREE` self | Destroy each child, unlink from the parent, clear `K_FOCUS` / `K_CAPTURE` if they are self, `K_FREE` self |
| 1 | `M_DRAW` | | | nothing | nothing (step 4 defines drawing) |
| 2 | `M_EVENT` | DE = `K_EV` | carry = consumed | not consumed | not consumed |
| 3 | `M_HITTEST` | BC = x, DE = y | carry = hit | no hit | hit when (x, y) is inside the view's rectangle |
| 4 | `M_FOCUS` | | | nothing | nothing |
| 5 | `M_BLUR` | | | nothing | nothing |

**Base classes** (kernel, chunk 5):
- **`Object`:** the class pointer only.
- **`View` (Object), 16 bytes:**

  | Field | Size | What |
  |---|---|---|
  | `View_parent` | word | Parent view (0 for the root) |
  | `View_child` | word | First child (front-most) |
  | `View_next` | word | Next sibling (behind this one) |
  | `View_x` | word | Rectangle x (0..511) |
  | `View_y` | byte | Rectangle y (0..191) |
  | `View_w` | word | Rectangle width (0..512) |
  | `View_h` | byte | Rectangle height (0..192) |
  | `View_flags` | byte | Bit 0 focusable, bit 1 hidden, bit 2 disabled; bits 3-7 belong to the class |
  | `View_id` | byte | Free for the app |

  Coordinates are absolute screen pixels in step 3; step 4 decides whether they become window-relative.
- **`Group` (View):** its `M_EVENT` routes pointer events to its children (section 6). Same fields.

## 4. Arenas and pools

An **arena** is a bump allocator over [base, end) with four pools (free lists of 8-, 16-, 24- and 32-byte blocks). Base and end are
page aligned (low byte 0), so an address's arena is found from its high byte. Record (16 bytes, in `K_VARS`): +0 top, +2 end, +4
base, +6 / +8 / +10 / +12 the free-list heads of the 8- / 16- / 24- / 32-byte pools (0 = empty), +14 a word that is always 0. Two arenas: **kernel** (`K_KARENA`, `$F100-$FAFF`) and **app** (`K_AARENA`).
One is **current**; `K_NEW` and `K_ALLOC` take from it.

- **`K_NEW`:** takes a block from the current arena's pool for the class's size (the head of its free list; if empty, a fresh block
  of the pool's size from the arena top), writes the class pointer, zeroes the other bytes of the instance size. A class with pool
  14 is bump-allocated exactly (its "head", +14, is always 0).
- **`K_FREE`:** puts the block on the head of the right pool of the arena whose range holds it (the free list's link is the block's
  first word). A pool 14 block is not reclaimed until its arena is reset. It sends no message.
- **`K_ALLOC`:** raw bytes from the current arena top, never freed singly (buffers, documents).
- **`K_ARESET`:** top = base, free lists empty. Clears `K_FOCUS`, `K_CAPTURE` and `K_ROOT` when they point into the arena. Sends
  no `M_DESTROY` (the app is quitting).

Allocation is deterministic: the model predicts every returned address (free lists are LIFO).

## 5. Routines

All preserve IY and the alternate set; IX is preserved unless it is an output. None executes `DI` or `EI`. Stack: at most 32
bytes below the return address, except the routing routines and `View`'s `M_DESTROY` (128 bytes at tree depth 8).

| Routine | In | Out / effect | Clobbers |
|---|---|---|---|
| `K_SEND` (`RST $08`) | IX self, A message, BC, DE | the method (section 3) | AF, HL before the method |
| `K_AINIT` | HL = arena record, DE = base, BC = end | an empty arena | AF, BC, DE, HL |
| `K_ARENA` | HL = arena record | the current arena | |
| `K_ARESET` | HL = arena record | section 4 | AF, BC, DE, HL |
| `K_NEW` | HL = class | IX = the instance, carry clear; carry set (IX unchanged) when the arena is full | AF, BC, DE, HL |
| `K_FREE` | IX = instance | section 4 | AF, BC, DE, HL |
| `K_ALLOC` | BC = bytes | HL = block, carry clear; carry set when full | AF, BC, DE |
| `K_ADDCHILD` | IX = parent, DE = child | the child becomes the parent's **last** child (back-most); its `View_parent` is set | AF, BC, DE, HL |
| `K_UNLINK` | IX = view | removed from its parent's list (no-op for a root); its own children stay | AF, BC, DE, HL |
| `K_SETROOT` | DE = view or 0 | `K_ROOT` = DE; focus and capture cleared (no `M_BLUR`) | AF, DE, HL |
| `K_POST` | A = type, C, E, D = data 1-3 | appended to the posted queue; carry set (dropped) when it is full | AF, HL |
| `K_GETEV` | | carry set: no event. Else the next event is copied to `K_EV` (4 bytes), A = its type. Posted events come first, then the ring | AF, BC, DE, HL |
| `K_DISPATCH` | `K_EV` | routes the event (section 6) | AF, BC, DE, HL |
| `K_SETFOCUS` | DE = view or 0 | if DE differs from `K_FOCUS` and is 0 or focusable (not hidden, not disabled): `M_BLUR` to the old, `K_FOCUS` = DE, `M_FOCUS` to the new. Carry set (nothing changed) when DE cannot take focus | AF, BC, DE, HL |
| `K_FOCUSNEXT` / `K_FOCUSPREV` | | the next / previous view that can take focus in pre-order under `K_ROOT`, wrapping; a hidden or disabled view's subtree is skipped. Nothing when none can | AF, BC, DE, HL |
| `K_WARP` | HL = x, DE = y | the input's pointer position becomes the clamped (x, y) at the next frame (section 7); no event | AF, HL |
| `K_POLL` | | the input part of the frame ISR (section 7); not called by programs | AF, BC, DE, HL |

**The event loop** of a program: `K_GETEV`; if carry, `HALT` and repeat; else `K_DISPATCH` (or handle `K_EV` itself) and repeat.

## 6. Events and routing

**Record** (4 bytes): type, then data 1-3.

| Type | Name | Data | Source |
|---|---|---|---|
| 1 | `E_KEY` | 1: key code (section 7); 2: bit 0 CAPS SHIFT, bit 1 SYMBOL SHIFT, bit 2 caps lock, bit 7 auto-repeat; 3: 0 | ISR |
| 2 | `E_MOVE` | 1: x bits 0-7; 2: y; 3: bit 0 x bit 8, bit 1 button held | ISR |
| 3 | `E_DOWN` | as `E_MOVE` | ISR |
| 4 | `E_UP` | as `E_MOVE` | ISR |
| 5 | `E_TIMER` | reserved | — |
| 6, 7, 8 | `E_REDRAW`, `E_MENU`, `E_QUIT` | the poster's | `K_POST` |
| 9 | `E_MODE` | 1: 1 = keyboard-pointer mode on, 0 = off; 2, 3: 0 | ISR |
| 16-255 | the app's | the poster's | `K_POST` |

**Queues.** The ring is filled only by the ISR and emptied only by `K_GETEV`: one producer, one consumer, no lock and no `DI`.
The ISR writes the record, then advances the tail; `K_GETEV` copies the record, then advances the head. Programs post into the
separate 4-entry posted queue, which the ISR never touches, so no producer races another. When the ring holds 16 events, a new
ISR event is dropped and `K_LOST` (byte, saturating) counts it.

**Move coalescing.** When the ring's last record is an `E_MOVE` and it is not the record at the head (which `K_GETEV` may be
copying), a new `E_MOVE` overwrites it instead of being appended. So a slow program sees at most one move between other events,
and moves never fill the ring.

**Routing (`K_DISPATCH`):**
- **`E_KEY`:** `M_EVENT` to `K_FOCUS` (to `K_ROOT` when there is no focus). Not consumed: to its parent, and so up to the root.
  Still not consumed: the kernel's defaults. TAB and the down / right arrows: `K_FOCUSNEXT`. Back-TAB and up / left:
  `K_FOCUSPREV`. Other keys are dropped.
- **`E_DOWN`:** `M_EVENT` to `K_ROOT`. A `Group` sends `M_HITTEST` to its children front to back (hidden and disabled ones
  skipped); the first hit child, if focusable, gets `K_SETFOCUS`, then the event. When a child consumes a DOWN and `K_CAPTURE` is
  still 0, `K_CAPTURE` = that child (so the innermost view that consumed it wins).
- **`E_MOVE`:** to `K_CAPTURE` when set; else routed as `E_DOWN` without the focus change and without capture.
- **`E_UP`:** to `K_CAPTURE` when set, then `K_CAPTURE` = 0; else as `E_MOVE`.
- **Others:** `M_EVENT` to `K_ROOT`.
- Nothing is delivered when the target is 0. Routing depth is at most 8 views.

## 7. The input ISR and the pointer

**Frame ISR** (IM 1, `$0038`), in this order:
1. save the registers; increment `V_FRAMES`;
2. `$F4 = $33`; `P_ISR` (unchanged: the pointer deadline depends only on what comes before it);
3. `K_POLL`;
4. write the shadows back: `$F4`, and the AY register latch (`K_AYREG`);
5. restore, `EI`, `RET`. Stack: at most 32 bytes with the return address (binding: `G_CLS`).

**AY rule.** Boot sets AY register 7 bit 6 = 0 once. `K_POLL` selects register 14 to read the joystick; the ISR's item 4 puts
the shadow latch back. Any other code that selects an AY register stores `K_AYREG` before the `OUT` (as `$F4`), so the ISR may arrive
between select and access. Code that writes AY register 7 (the mixer) keeps bit 6 = 0, or the joystick read fails.

**Keyboard** (port `$FE`):
- One read with all rows selected; if no key is down and none was down last frame, the keyboard part ends (the idle path).
- Otherwise all 8 half-rows are read and compared with last frame's 8 bytes. Each key that went down this frame gives an `E_KEY`,
  in half-row order (`$FEFE` first, A8..A15), bit 0 to bit 4.
- CAPS SHIFT and SYMBOL SHIFT are modifiers only. CS + SS pressed together with no other key toggles **keyboard-pointer mode**
  and gives an `E_MODE` event (section 6), so the program can show the mode.
- **Codes** come from a 3 x 40-byte table (plain, CS, SS) written by `tools/gen-keymap.mjs` from `src/kernel/keymap.txt`:
  - plain: lower-case letters, digits, space, ENTER = 13;
  - CS: upper-case letters; CS+5/6/7/8 = left 8, down 10, up 11, right 9; CS+0 = DELETE 12; CS+1 = ESC 27; CS+2 toggles caps lock (no event);
    CS+3 = back-TAB 15; CS+4 = TAB 14; CS+9 = MENU 16; CS+SPACE = BREAK 3;
  - SS: the TS2068 symbol where the key's legend shows an ASCII character; the rest of printable ASCII 33-126 spread over the
    remaining SS keys. Every printable character is reachable with at most one modifier. The main model drafts `keymap.txt`; the
    owner reviews it.
  - Caps lock makes plain letters upper case.
- **Auto-repeat:** the most recently pressed non-modifier key repeats after 30 frames held, then every 4 frames (bit 7 of data 2).
  Releasing it stops the repeat; another held key does not take over.
- In keyboard-pointer mode, no `E_KEY` is made: Q / A / O / P move the pointer and SPACE is the button.

**Joystick 1** (AY register 14, active low, as `spike6`'s `live_input`, `docs/PROVENANCE.md`): all four directions at once reads
as no input, fire included.

**Pointer motion:** the directions of the joystick ORed with keyboard-pointer mode's keys. Acceleration exactly as `spike6` 17.5
step 3 (`S_STEP[hold] = min(1 + floor(hold / 6), 6)`, hold 0..30, x moves 2s, y moves s, opposite directions cancel), clamped to
0..511 x 0..191. The button is fire ORed with SPACE in keyboard-pointer mode. Per frame: a pending `K_WARP` replaces the position;
then `E_MODE` if the mode toggled, the `E_KEY` events, `E_MOVE` if the position changed, `E_DOWN` or `E_UP` if the button changed
(at the new position). The exact steps are 14.3.

**Handing the position to the pointer.** The input owns the position (`K_PX`, `K_PY`). `K_POLL` hands it on with a new pointer
routine, **`P_ISRMOVE`** (HL = x, DE = y, already clamped): called only from the ISR, after `P_ISR`; if `PT_LOCK` is held it
returns carry and changes nothing, and `K_POLL` tries again next frame. Otherwise it sets the position and `PT_DIRTY`, so the next
`P_ISR` draws it. Latency: input read in frame n's ISR is drawn by frame n+1's ISR. **Amends GRAPHICS_SPIKE 16.3:** from step 3
on, programs call `K_WARP`, not `P_MOVE` (which stays internal to `P_INIT`).

**The arrow (amends GRAPHICS_SPIKE 16.1).** `P_ARROW` is redrawn so the hot spot pixel (0, 0) is **ink**:
- column 0 is ink for at least rows 0-10, so a pointer at x = 511 shows a line;
- row 0 is ink at columns 0 and 1, so a pointer at y = 191 shows two thin pixels (one square pixel's width);
- the paper outline stays on the right and lower sides (the left and top would fall outside the bitmap).

Same size, format and pointer code, so the S4 bounds and tests carry over. The main model draws it; the owner reviews it by eye.

## 8. Bounds (TSRun, T-states, direct call with a sentinel return, interrupts off unless stated)

**The three headline numbers:**

| Measure | Bound |
|---|---|
| **Bytes in the always-mapped pool:** `K_CODE_END - K_CODE` plus the chunk 0 bytes (`RST $08`, ISR) and the class, key-map and acceleration tables; **report** each part and the pool's free bytes after (11,739 before, CODE_SIZE 0) | <= 2,400 (owner 2026-11-12, 16.4: the measured size accepted; was 2,048, **EST** about 1,500) |
| **Message send:** `RST $08` to the method's first instruction | <= 100 (**EST** 87) |
| **Per event:** an `E_KEY` through `K_GETEV` + `K_DISPATCH` to the focused view's handler (its first instruction), the event in the ring | <= 500 (**EST** 350) |

**The rest:**

| Measure | Bound |
|---|---|
| `K_NEW` of a 16-byte class: from the free list / from the arena top | <= 450 / <= 550 |
| `K_FREE` | <= 250 |
| `K_ALLOC` | <= 200 |
| `K_POST` / `K_GETEV` (posted or ring) / `K_GETEV` empty | <= 200 / <= 250 / <= 100 |
| `K_DISPATCH` `E_KEY`, each bubble level to a parent | <= 200 |
| `K_DISPATCH` `E_DOWN` through a root `Group` of 8 `View` children, the last one hit (focusable, consumes), to its handler | <= 3,500 |
| `K_DISPATCH` `E_MOVE`, no capture, through the same `Group` of 8, the last one hit, to its handler (the path taken every frame the pointer moves; added 16.4) | <= 2,500 |
| `K_SETFOCUS` (handlers that `RET`) | <= 500 |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, tree of 32 views, the worst start | <= 11,000 / <= 18,000 (owner 2026-11-12, option G, 16.4; were 5,000 / 8,000) |
| `K_POLL`: nothing pressed, joystick idle / a key held (no change) / the worst frame (a move, a button change, two new keys) | <= 300 / <= 900 / <= 5,250 (owner 2026-11-12, option C, 16.4; was 2,000) |
| Whole frame ISR, worst (`P_ISR` moving + `K_POLL` worst) | <= 12,000 (owner 2026-11-12, option C, 16.4; was 9,500) |
| Pointer deadline with the kernel ISR (GRAPHICS_SPIKE 16.7) | <= 8,960 |
| S4's pointer bounds with the new `P_ARROW` | unchanged (16.7) |
| ISR stack, return address included | <= 32 bytes |
| `DI` in step 3 code (outside boot) | none |
| Frame interrupts lost in every frame test | 0 |
| Events lost with at most 16 in the ring | 0; the 17th is dropped and counted |
| Kernel RAM: `$F000-$F0FF` used | **report** (bound: it fits) |
| `P_ISRMOVE`, `K_WARP`, `K_ARESET`, direct `CALL` send | **report** |

## 9. Tests (TSRun headless, Node, the pattern of `tests/gfx6-s4.mjs`)

Written from this contract, never from the code. Each comparison is against a reference model, `tests/kern-model.mjs`: classes,
arenas, queues, input decoding (key map, repeat, acceleration, keyboard-pointer mode), routing and focus.

1. **Send:** every message to every class of the test cartridge; the method reached, IX / BC / DE intact, IY unchanged.
2. **Allocation:** at least 5,000 random `K_NEW` / `K_FREE` / `K_ALLOC` / `K_ARENA` / `K_ARESET` steps a seed; every address
   equals the model's; instances zeroed; out-of-memory carry at the exact step; RAM outside the arenas and `K_VARS` poisoned and
   unchanged.
3. **Queues:** interrupt injection at every instruction boundary of `K_GETEV`, `K_POST` and `K_DISPATCH`, with an ISR that adds an
   event (and a coalescing move): no event lost, duplicated, torn or reordered. 17 events: one dropped, `K_LOST` = 1.
4. **Input over frames:** keys pressed through TSRun's keyboard matrix and joystick, scripted over frames: each of the 40 keys
   plain / CS / SS, caps lock, repeat timing, rollover order, keyboard-pointer mode, warp, acceleration paths to all four
   edges. The event stream equals the model's exactly; the pointer is drawn at the model's position one frame later.
5. **Routing and focus:** random trees (up to 32 views, depth up to 8, random flags) and random events, focus calls and
   `M_DESTROY`s; the log of methods called (each test class records self, message and data) equals the model's.
6. **Pointer with the ISR moving it:** injection at every boundary of `P_SHIELD`, `P_UNSHIELD` and a shielded `G_FILL` while the
   joystick moves the pointer (`P_ISRMOVE` refused, then retried); after two more frames the display equals the model. The S4 flicker
   test re-run with the position from the joystick.
7. **Regression:** S1-S4, `gfx6-cls`, `hello`, `probe23` and `spike6` pass with the new `P_ARROW` (their models read it from the
   image); `gfx6-perf` unchanged apart from reported pointer rows.
8. **Frames:** `V_FRAMES` rises by exactly 1 per frame in every frame test.
9. **Bounds:** section 8 as checks in `tests/kern-perf.mjs`, printed as a table (measured, bound, pass / MISSED / reported).
10. **Cross-emulator:** the test cartridge's self-test (below) on ZEsarUX 13.0 and Fuse 1.9.1, its result screen identical to
    TSRun's; on ZEsarUX also typed keys through ZRCP if it can send them (else reported as not run).

## 10. Test cartridge `kern3` (`src/kern3.asm`, build target `kern3`, `web/?cart=kern3`)

- **Boot** as `spike6` 17.3 with the kernel ISR, `K_AINIT` of both arenas, `P_INIT` (256, 96).
- **Self-test** (runs at boot, the same on every emulator): builds a tree of test views, runs a fixed script of `K_POST`ed events,
  focus calls and allocations, and draws a result screen (the log's checksum and PASS / FAIL in text). The record holds the state.
- **Then live:** a few framed views drawn with gfx6 (the focused one inverted), a status line showing the last event, the pointer
  on joystick 1 or keyboard-pointer mode. For the owner to try the keys, the focus moves and the new arrow.
- **Script runner and symbols** as `gfx6t` 16.5, for direct calls.

## 11. Slices and who does what (CLAUDE.md)

| Slice | Content | Who |
|---|---|---|
| **K1** | `gen-classes.mjs`, `classes.txt`; `RST $08`; `Object` / `View` / `Group` with the non-routing defaults; arenas and pools; tests 1-2 | Z80: main model. Generator, model and tests: Sonnet, from this contract |
| **K2** | Kernel ISR, `K_POLL`, `gen-keymap.mjs` and `keymap.txt` (draft by the main model), the queues, `P_ISRMOVE`, `K_WARP`, the new `P_ARROW`; tests 3, 4, 6, 7, 8 | as K1 |
| **K3** | `K_DISPATCH`, routing, focus; `kern3`; tests 5, 9, 10; "As built"; FEASIBILITY updated | as K1; cross-emulator runners Sonnet; test runs Haiku |

Each slice passes its tests before the next starts. The main model re-runs every agent's tests before reporting.

## 12. Decisions (owner, 2026-11-11)

1. **The posted queue** stays beside the 16-entry ring, so the ring has one producer and needs no `DI`. Posted events overtake
   ring events already waiting; they are mostly consequences of input already handled.
2. **Keyboard-pointer mode** (CS + SS toggles; Q / A / O / P / SPACE), with an `E_MODE` event so the program shows the mode.
3. **The edit keys and the SS map** are a draft, judged by the owner in `kern3` after K2 (one generated text file).
4. **A Fable review after K2**, narrow: `K_POLL`, `P_ISRMOVE` and the two queues, given the code and this contract.
5. **Overnight run:** K1, K2, the review, K3. Each slice is committed once its tests pass and the main model has re-run them. A
   missed bound is recorded with its numbers in "As built", the bound unchanged, and work that does not depend on it goes on.

## 13. K1 interface (designed 2026-11-11, binding for the K1 code, generator and tests)

Fills in what sections 2-5 leave open for slice K1. The tests are written from sections 2-5, 8 and this section, never from the code.

### 13.1 Files and build

| File | What |
|---|---|
| `src/kernel/kernel.asm` | Kernel code and variable `EQU`s. Included by `kern3.asm` in chunk 5 between `K_CODE` and `K_CODE_END` |
| `src/kernel/send.asm` | The dispatcher, assembled at `$0008` (`K_SEND`, 14 bytes, runs into `$0010-$0015`) |
| `src/kernel/classes.txt` | The kernel's classes (`Object`, `View`; `Group` comes in K3) |
| `src/kern3.asm`, `src/kern3-classes.txt` | The test cartridge and its test classes |
| `tools/gen-classes.mjs` | The generator (13.2). `tools/build.mjs` runs it for a target with a `classes` list, as it runs the table generators |

Build target `kern3`: `{ src: 'src/kern3.asm', chunks: [0, 1, 4, 5], tables: true, classes: ['src/kernel/classes.txt',
'src/kern3-classes.txt'] }`. For each listed file the generator writes `build/kern3/<basename>.inc` (`kernel/classes.txt` gives
`classes.inc`, `kern3-classes.txt` gives `kern3-classes.inc`) and one `build/kern3/classes.json` for all of them. `build.mjs` adds
`-I build/<target>` to sjasmplus's include paths. Generated files are never hand-edited and not committed.

### 13.2 The class file and the generator

```
# comment (also after any line)
class Object                     # a root class: no parent
  method Destroy obj_destroy     # a new message, or an override when an ancestor defines the name
  method Draw    k_nop
class View : Object              # single parent, defined earlier (in this file or an earlier file of the list)
  field parent 2                 # name, size in bytes (1..253)
  method HitTest view_hittest    # override
```

- **Fields** are laid out in order after the parent's (offset 0 is the class pointer). Instance size = 2 + all fields of the class
  and its ancestors; over 255 is an error.
- **Messages:** a `method` whose name no ancestor defines is a new message, numbered after the parent's count (the root's first
  is 0). A name defined twice on one path, or as a new message in two classes (siblings included), is an error. Numbers may repeat
  across siblings under different names.
- **Pool** (the descriptor's byte -1, section 3): 6 / 8 / 10 / 12 for sizes up to 8 / 16 / 24 / 32, else 14.
- **Class id:** 1, 2, 3, ... in order of definition over the whole list of files.

**Output** for each class, in order of definition (sjasmplus):

```
; class View : Object
    IF ((($ + 6) & $FF) + 2 * 6) > 256    ; the method table must not cross a page
    ALIGN 256, 0
    ENDIF
    DW CL_Object                          ; -6 parent (DW 0 for a root)
    DB 2, 6, 16, 8                        ; -4 id, -3 count, -2 size, -1 pool
CL_View:
    DW obj_destroy, k_nop, k_nop, view_hittest, k_nop, k_nop
```

and in the same `.inc`, after the classes: `M_<NAME> EQU n` for each message defined in this file (the name in upper case:
`Destroy` gives `M_DESTROY`), `<Class>_<field> EQU offset` for each field the class defines, `<Class>_SIZE EQU size` for each
class. `classes.json`: `{ messages: { NAME: n }, classes: [{ name, id, parent, size, pool, fields: [{ name, offset, size }],
methods: [{ n, name, label }] }] }` (methods flattened, in slot order).

### 13.3 The kernel classes (`src/kernel/classes.txt`)

- **`Object`:** no fields. Messages 0-5 of section 3 in that order. Destroy `obj_destroy` (= `K_FREE`), the others `k_nop`
  (`OR A`, `RET`: carry clear).
- **`View : Object`:** fields `parent` 2, `child` 2, `next` 2, `x` 2, `y` 1, `w` 2, `h` 1, `flags` 1, `id` 1 (offsets 2, 4, 6, 8,
  10, 11, 13, 14, 15; size 16). Destroy `view_destroy`, HitTest `view_hittest`.

**`view_destroy`**, exactly: while `View_child` is not 0, send `M_DESTROY` to that child (a child's destroy unlinks it, so the
loop ends); then `K_UNLINK` self; then each of `K_FOCUS`, `K_CAPTURE`, `K_ROOT` that equals self becomes 0; then `K_FREE` self.
**Rule:** a View subclass that overrides `M_DESTROY` ends by jumping to `view_destroy`.

**`view_hittest`:** BC = x, DE = y (unsigned words). Hit (carry set) when `x - View_x` is in 0..`View_w`-1 and `y - View_y` is in
0..`View_h`-1, as unsigned 16-bit differences (y with D = 0; D > 0 is a miss). Flags are not consulted.

### 13.4 Exactly what each routine writes (the model predicts every byte)

| Routine | Writes |
|---|---|
| `K_AINIT` | The 16-byte record: top = base, end, base, all heads and +14 = 0. Base and end are page aligned, base <= end. All of [base, end) = 0 |
| `K_ARENA` | `K_CURA` |
| `K_ARESET` | top = base, the four heads = 0; all of [base, end) = 0; `K_FOCUS` / `K_CAPTURE` / `K_ROOT` = 0 when their high byte is in [base high, end high) |
| `K_NEW` | From a non-empty free list: the head = the block's first word; the block's first `size` bytes = class pointer, then zeros. From the arena: top += block size (the pool's 8 / 16 / 24 / 32, or exactly `size` for pool 14); the block's first word = the class pointer (the rest is already 0, below). Full (the block size > end - top): nothing |
| `K_FREE` | Pool 14: nothing. Else the block's first word = the head, the head = the block, in the record of the app arena when the block's high byte is in [app base high, app end high), else the kernel arena's |
| `K_ALLOC` | top += BC (the block is already 0). Full (BC > end - top): nothing |
| `K_ADDCHILD` | Child: `View_parent` = parent, `View_next` = 0. The last link of the parent's list (its `View_child` when empty, else the last child's `View_next`) = child |
| `K_UNLINK` | No parent: nothing. Else the link that pointed at the view (the parent's `View_child` or the previous sibling's `View_next`) = the view's `View_next`; then the view's `View_parent` and `View_next` = 0. The view must be in its parent's list |
| `K_SETROOT` | `K_ROOT` = DE, `K_FOCUS` = `K_CAPTURE` = 0 |

**Invariant (amended in K1, so `K_NEW` from the top meets its bound):** every byte in [top, end) of an arena is 0. `K_AINIT`
and `K_ARESET` zero the arena; nothing else writes above top. So `K_NEW` from the top writes only the class pointer, and
`K_ALLOC` returns zeroed memory. A program that writes past its block breaks this, as it would corrupt a neighbour anyway.

### 13.5 Memory (`$F050-$F07F` in K1)

| Address | Name | What |
|---|---|---|
| `$F050` | `K_KARENA` | The kernel arena's record |
| `$F060` | `K_AARENA` | The app arena's record |
| `$F070` | `K_CURA` | Word: the current arena's record |
| `$F072` | `K_FOCUS` | Word |
| `$F074` | `K_CAPTURE` | Word |
| `$F076` | `K_ROOT` | Word |
| `$F078-$F07F` | | Kernel scratch (K1 may write it) |

### 13.6 Test cartridge `kern3` (K1)

- **Boot** as `gfx6t` (12.4: clears `$E000-$FFFF` and the display, mode 6, `G_INIT`, the same ISR), then `K_AINIT` kernel arena
  [`$F100`, `$FB00`) and app arena [`$C000`, `$E000`), `K_ARENA` app, record state 1, `T_IDLE`. No `P_INIT`.
- **Symbols** (from `build/kern3/out.sym`): `K_SEND`, `K_AINIT`, `K_ARENA`, `K_ARESET`, `K_NEW`, `K_FREE`, `K_ALLOC`,
  `K_ADDCHILD`, `K_UNLINK`, `K_SETROOT`, `K_KARENA`, `K_AARENA`, `K_CURA`, `K_FOCUS`, `K_CAPTURE`, `K_ROOT`, `K_CODE`,
  `K_CODE_END`, `obj_destroy`, `view_destroy`, `view_hittest`, `k_nop`, every `CL_*`, `M_*` and field `EQU`, `T_SEND`, `T_LOG`,
  `T_LOGN`, `T_IDLE`, `T_RET`, `RESULT`, `V_FRAMES`, and the test methods below.
- **`T_SEND`:** `RST $08`, `RET`. Tests call it to send (IX, A, BC, DE as for `K_SEND`).
- **Test classes** (`src/kern3-classes.txt`):

  | Class | Parent | Fields | Methods |
  |---|---|---|---|
  | `TLog` | `View` | `tag` 1 (size 17) | Destroy `t_destroy`, Draw `t_draw`, Event `t_event`, HitTest `t_hittest`, Focus `t_focus`, Blur `t_blur`, new `Poke` `t_poke` |
  | `TLog2` | `TLog` | | Draw `t_draw2`, new `Poke2` `t_poke2` |
  | `TSz8`, `TSz9`, `TSz16`, `TSz24`, `TSz32`, `TSz33`, `TSz40`, `TSz255` | `Object` | `pad` of size - 2 | none |

- **The log** (`T_LOG` = `$E800`, 256 records of 8 bytes, `$E800-$EFFF`; `T_LOGN` a word at `$E090`, records written so far,
  record k at `T_LOG + 8 * (k mod 256)`): each test method writes one record and increments `T_LOGN`: +0 a code, +1 IX low, +2 IX
  high, +3 C, +4 B, +5 E, +6 D, +7 `TLog_tag` of self. The code is the message number, plus `$80` for `t_draw2` and `t_poke2`.
  - `t_event` returns carry = tag bit 0, `t_hittest` carry = tag bit 1, the others carry clear.
  - `t_destroy` logs, then jumps to `view_destroy`.
  - Test methods preserve IX and IY.

### 13.7 How the K1 bounds are measured (section 8)

| Measure | How |
|---|---|
| Message send | Call `T_SEND` with interrupts off; step until PC = the method's address; the T-states from `T_SEND`'s first instruction. The worst over every class and message of `kern3` |
| `K_NEW` 16-byte class (`TSz16`), from the free list / the arena top | Direct call; the worst over 20 calls each, in both arenas |
| `K_FREE`, `K_ALLOC` | Direct call; the worst over 20 calls each (`K_FREE` of blocks of every pool in both arenas, and of `TSz40`; `K_ALLOC` of 0, 1, 255, 4,000 bytes, and a full arena) |
| Report | `K_NEW` of `TSz255`; `K_AINIT`, `K_ARESET`, `K_ADDCHILD` (at child counts 0, 1, 8), `K_UNLINK` (first, last of 8), `view_hittest` (hit, miss), `view_destroy` of a leaf and of a tree of 8 |
| Bytes | `K_CODE_END - K_CODE` plus 14 (`K_SEND`): report, with K1's share of section 8's 2,048 |
| Stack | Poison below the return address: 32 bytes for all K1 routines; 128 for `view_destroy` of a tree of depth 8 |

## 14. K2 interface (designed 2026-11-11, binding for the K2 code, generator and tests)

Fills in what sections 6 and 7 leave open for slice K2: the queues, the input ISR, the pointer hand-over and the new arrow. The
tests are written from sections 2, 5-9, 13 and this section, never from the code.

### 14.1 Memory (adds to 13.5)

| Address | Name | What |
|---|---|---|
| `$F000-$F03F` | `K_RING` | 16 records. Record of index i at `K_RING + (i AND $3F)` |
| `$F040-$F04F` | `K_POSTQ` | 4 records |
| `$F080` | `K_RHEAD` | Byte, written only by `K_GETEV`: the ring's head, free running in steps of 4 (mod 256) |
| `$F081` | `K_RTAIL` | Byte, written only by the ISR: the tail, the same way. Empty when head = tail; full when tail - head = 64 (mod 256). All 16 records are usable |
| `$F082` | `K_PHEAD` | Byte 0..3: the posted queue's first record |
| `$F083` | `K_PN` | Byte 0..4: records in the posted queue. Record k (k < `K_PN`) at `K_POSTQ + 4 ((K_PHEAD + k) AND 3)` |
| `$F084` | `K_LOST` | Byte: ISR events dropped because the ring was full, saturating at 255 |
| `$F085` | `K_AYREG` | The AY register latch's shadow (section 7) |
| `$F086-$F089` | `K_EV` | The event `K_GETEV` returned |
| `$F08A` | `K_PX` | Word: the input's pointer x (0..511) |
| `$F08C` | `K_PY` | Byte: y (0..191) |
| `$F08D` | `K_BTN` | Byte: the button, 0 or 1, as of the last `K_POLL` |
| `$F08E` | `K_KPMODE` | Byte: 1 in keyboard-pointer mode, else 0 |
| `$F08F` | `K_CAPS` | Byte: 1 with caps lock on, else 0 |
| `$F090-$F0BF` | | `K_POLL`'s and `K_WARP`'s internal state (not part of the interface) |

Boot sets `K_PX` / `K_PY` to the position it gives `P_INIT`, and everything else here to 0 (internal state to its idle values).

### 14.2 The queues

- **`K_GETEV`:** if `K_PN` > 0, copies record `K_PHEAD` of the posted queue to `K_EV`, `K_PHEAD` = (+1) AND 3, `K_PN` -= 1.
  Else if `K_RHEAD` != `K_RTAIL`, copies the ring record at `K_RHEAD` to `K_EV`, then `K_RHEAD` += 4. Else carry set, nothing
  written. A = `K_EV`'s type when an event is returned.
- **`K_POST`:** if `K_PN` = 4, carry set, nothing written. Else the record at `K_POSTQ + 4 ((K_PHEAD + K_PN) AND 3)` = A, C, E,
  D; `K_PN` += 1.
- **ISR append** (`K_POLL`): when tail - head = 64, `K_LOST` += 1 (not past 255) and nothing else. Else the record at `K_RTAIL` is
  written, then `K_RTAIL` += 4.
- **Coalescing** (section 6): an `E_MOVE` overwrites data 1-3 of the record at `K_RTAIL - 4` instead of being appended when
  tail - head >= 8 and that record's type is `E_MOVE`. The type byte is not rewritten and `K_RTAIL` does not change.

### 14.3 `K_POLL`, exactly

State kept between frames: the 8 half-rows seen last time (`old`), the button, hold (0..30), the repeat (key, code, modifiers,
count), keyboard-pointer mode, caps lock, and whether the pointer still has to be told the position (`pend`).

1. **Warp:** if a `K_WARP` (x, y) is pending, (`K_PX`, `K_PY`) = (x, y) and `pend` = 1. No event.
2. **Keyboard.** Half-row r = 0..7 is port `$FE` read with the address high byte `$FE`, `$FD`, `$FB`, `$F7`, `$EF`, `$DF`,
   `$BF`, `$7F`; bit b = 0..4 down when 0. Key index k = 5 r + b (the Spectrum matrix: 0 CAPS SHIFT, 1 Z, 2 X, 3 C, 4 V, 5 A ...
   9 G, 10 Q ... 14 T, 15 1 ... 19 5, 20 0, 21 9, 22 8, 23 7, 24 6, 25 P, 26 O, 27 I, 28 U, 29 Y, 30 ENTER, 31 L, 32 K, 33 J,
   34 H, 35 SPACE, 36 SYMBOL SHIFT, 37 M, 38 N, 39 B).
   - If no key is down now and none was down last time, skip to step 3 (`new` = all up).
   - CS = key 0 down now, SS = key 36 down now. **Newly down** = down now and not in `old`.
   - **Mode toggle:** if CS and SS are both down, no other key is down, and at least one of them is newly down: `K_KPMODE` ^= 1,
     append `E_MODE` (data 1 = the new mode, data 2, 3 = 0), and cancel the repeat.
   - **Keys** (only when `K_KPMODE` = 0): for each newly down key k other than 0 and 36, in increasing k: the plane is SS if SS is
     down, else CS if CS is down, else plain; code = `KEYMAP[plane][k]` (14.4).
     - Code 0: nothing. Code 1 (caps lock): `K_CAPS` ^= 1, no event, the repeat is cancelled.
     - Otherwise: if the plane is plain, `K_CAPS` = 1 and the code is `a`..`z`, the code becomes upper case. Append `E_KEY`
       (data 1 = code, data 2 = bit 0 CS, bit 1 SS, bit 2 `K_CAPS`, data 3 = 0). The repeat becomes (k, code, data 2, count 30).
   - **Repeat:** if a repeat is set and no key was newly down this frame (other than CS and SS): if its key is not down now, it is
     cancelled; else count -= 1, and at 0 append `E_KEY` (its code, its data 2 OR `$80`) and count = 4. (So a key first seen
     down in frame n repeats in frames n + 30, n + 34, ...)
   - `old` = now.
3. **Joystick:** AY register 14 read with the address high byte 1 (port `$F6`), active low: bit 0 up, 1 down, 2 left, 3 right,
   7 fire. All four directions down reads as nothing (fire included). `K_POLL` selects register 14 itself; the ISR puts
   `K_AYREG` back afterwards (section 7).
4. **Directions and button:** u, d, l, r, fire from the joystick, ORed in keyboard-pointer mode with Q (key 10), A (5), O (26),
   P (25), SPACE (35) down now.
5. **Move:** if any of u, d, l, r: s = min(1 + floor(hold / 6), 6), hold = min(hold + 1, 30); else s = 0 and hold = 0.
   x = clamp(`K_PX` + 2 s (r - l), 0, 511), y = clamp(`K_PY` + s (d - u), 0, 191). If (x, y) differs from (`K_PX`, `K_PY`):
   store it, `pend` = 1, append `E_MOVE` (coalescing, 14.2).
6. **Button:** if fire differs from `K_BTN`: `K_BTN` = fire, append `E_DOWN` (fire = 1) or `E_UP`.
   Data of `E_MOVE`, `E_DOWN` and `E_UP`: 1 = `K_PX` low, 2 = `K_PY`, 3 = bit 0 `K_PX` bit 8, bit 1 `K_BTN` **after step 6**.
7. **Pointer:** if `pend`: `P_ISRMOVE` (`K_PX`, `K_PY`); `pend` = 0 unless it returned carry.

**Event order within a frame:** `E_MODE`, the `E_KEY`s in key order, a repeat `E_KEY`, `E_MOVE`, `E_DOWN` / `E_UP`. (This
replaces section 7's order: the keys are read first so the mode toggle applies to the same frame's motion.)

### 14.4 The key map (`src/kernel/keymap.txt` -> `build/<target>/keymap.inc`)

`tools/gen-keymap.mjs` (run by `build.mjs` for a target with `keymap: 'src/kernel/keymap.txt'`) writes `KEYMAP`: 120 bytes, plain
codes for k = 0..39, then CS, then SS (`KEYMAP + 40 plane + k`). The text file has one line per key in matrix order (40 lines,
`#` comments): the key's name, then the plain, CS and SS entries. An entry is a single printable character (itself), `-` (code 0),
or a name: `ENTER` 13, `LEFT` 8, `RIGHT` 9, `DOWN` 10, `UP` 11, `DELETE` 12, `TAB` 14, `BACKTAB` 15, `MENU` 16, `ESC` 27,
`BREAK` 3, `CAPS` 1, `SPACE` 32, `HASH` 35 (`#`), `DASH` 45 (`-`). The generator checks 40 lines in matrix order, keys 0 and 36
all `-`, and that every printable ASCII character 32..126 appears at least once. Codes are the kernel's own (`K_` names in
`desktop.json` later), not ASCII below 32.

### 14.5 Routines (adds to section 5)

| Routine | In | Effect | Clobbers |
|---|---|---|---|
| `K_WARP` | HL = x, DE = y (signed words) | clamps; the next `K_POLL` takes it (14.3 step 1). Lock-free: it clears its own pending flag, writes x and y, then sets the flag | AF, HL |
| `K_POLL` | | 14.3. Called only by the ISR, after `P_ISR`, with the display mapped; uses at most 20 bytes of stack below its return address | AF, BC, DE, HL |
| `P_ISRMOVE` | HL = x (0..511), E = y (0..191) | if `PT_LOCK` is set: carry, nothing. Else the pointer's position = (x, y) and `PT_DIRTY` set, carry clear. Only from the ISR, after `P_ISR` | AF |

`P_MOVE` stays (it is `P_INIT`'s second half) but programs no longer call it (section 7).

### 14.6 The arrow

`P_ARROW` becomes (pair format, `#` ink, `o` paper, `.` transparent):

```
##o.............    #######o........    #####ooooooo....    ...o###o........
###o............    ########oo......    ##o###o.........    ....o###o.......
####o...........    ##########o.....    #oo###o.........    ....ooooo.......
#####oo.........    ###########o....    o.oo###o........    ................
```

(rows 0-3 in the first column, 4-7 in the second, and so on). Ink at (0, 0), column 0 ink for rows 0-10, row 0 ink at columns
0-1.

### 14.7 Test cartridge `kern3` (K2 additions)

- **Boot** adds: `P_INIT` (256, 96), `K_PX` = 256, `K_PY` = 96, `K_AYREG` = 0 (boot's AY loop leaves register 0 selected).
- **ISR:** saves AF, BC, DE, HL; `V_FRAMES` += 1; `$F4 = $33`; `P_ISR`; `T_ISRP:` `K_POLL`; `T_POLLD:` writes `V_SHADOW_F4` to
  `$F4` and `K_AYREG` to the AY latch; restores; `EI`; `RET`.
- **`T_EVLOOP`:** `EI`, then forever: `K_GETEV`; on an event, append `K_EV` to `T_EVLOG` (`$5800`, 512 records of 4 bytes,
  record n at `$5800 + 4 (n mod 512)`) and increment the word `T_EVN` (`$E092`); with no event, `HALT`.
- **Symbols** add: `K_POLL`, `K_WARP`, `K_GETEV`, `K_POST`, `P_ISRMOVE`, `KEYMAP`, `T_ISRP`, `T_POLLD`, `T_EVLOOP`, `T_EVLOG`,
  `T_EVN`, and those of 14.1.

### 14.8 How the K2 bounds are measured (section 8)

| Measure | How |
|---|---|
| Per event (`E_KEY`) | K3 (it includes `K_DISPATCH`). K2 reports `K_GETEV` |
| `K_POST` / `K_GETEV` | Direct call; the worst over every queue state (posted 0-4 records, ring 0-16, both wrapping) |
| `K_POLL` idle / key held / worst | Direct call, interrupts off, input set in TSRun's keyboard and joystick state first, `K_POLL`'s state prepared by earlier calls. Idle: no key, joystick idle, nothing pending. Held: one key held since an earlier call, its repeat count not at 1. Worst: the worst over frames that move at full speed into an edge, change the button and press two keys at once, with the pointer locked and unlocked |
| Whole ISR / deadline | Over the frame tests (section 9 test 4 and 6): the ISR's T and the `T_ISRP` offset, as GRAPHICS_SPIKE 16.6 |
| `P_ISR` bounds with the new arrow | GRAPHICS_SPIKE 16.7, re-run |

## 15. K3 interface (designed 2026-11-12, binding for the K3 code and tests)

Fills in what sections 5, 6 and 10 leave open for slice K3: routing, `Group`, focus, and the `kern3` self-test and demo. The tests
are written from sections 2-10, 13, 14 and this section, never from the code.

### 15.1 Classes

- **Kernel** (`src/kernel/classes.txt`): `Group : View`, no fields, Event `group_event`.
- **Test** (`src/kern3-classes.txt`): `TBox : View`, field `tag` 1 (size 17), Destroy `t_destroy`, Draw `t_draw`, Event `t_event`,
  Focus `t_focus`, Blur `t_blur`; HitTest is `View`'s (geometric). Its log records are as `TLog`'s (13.6; `TBox_tag` = 16).

### 15.2 `K_DISPATCH`, exactly

Preserves IX and IY. Uses at most 128 bytes of stack at tree depth 8. "Send to v" means: nothing when v = 0, else `M_EVENT` with
DE = `K_EV`; its carry is "consumed".

| Type | Routing |
|---|---|
| `E_KEY` | v = `K_FOCUS`, or `K_ROOT` when it is 0. While v != 0: send to v; consumed: stop; else v = v's `View_parent`. Not consumed by anyone: data 1 = `TAB` (14), `DOWN` (10) or `RIGHT` (9): `K_FOCUSNEXT`; `BACKTAB` (15), `UP` (11) or `LEFT` (8): `K_FOCUSPREV`; others: nothing |
| `E_DOWN` | `K_CAPTURE` = 0, then send to `K_ROOT` |
| `E_MOVE` | send to `K_CAPTURE` when it is not 0, else to `K_ROOT` |
| `E_UP` | when `K_CAPTURE` != 0: v = `K_CAPTURE`, `K_CAPTURE` = 0, send to v. Else send to `K_ROOT` |
| any other | send to `K_ROOT` |

**`group_event`** (Group's `M_EVENT`): for `E_MOVE`, `E_DOWN`, `E_UP` only (others: not consumed, nothing sent). The point is x =
data 1 + 256 (data 3 AND 1), y = data 2. For each child from `View_child` along `View_next`: skip it when its flags AND 6 != 0;
send it `M_HITTEST` (BC = x, DE = y; a child whose HitTest slot holds `view_hittest` is tested in place with the same arithmetic instead, 16.4); the first that hits is the target, and no later child is tested. No target: not consumed.
Else:
1. if the event is `E_DOWN` and the target's flags bit 0 is set: `K_SETFOCUS` (target);
2. send `M_EVENT` to the target;
3. if it consumed it and the event is `E_DOWN` and `K_CAPTURE` = 0: `K_CAPTURE` = the target;
4. the group returns the target's carry.

### 15.3 Focus

- **Can take focus:** flags AND 7 = 1 (focusable, not hidden, not disabled).
- **Pre-order step** from view n: if n's flags AND 6 = 0 and n has a child: the child. Else the first `View_next` found on n, n's
  parent, its parent, ... ; when that runs off the root (parent 0), the walk **wraps** to `K_ROOT`.
- **`K_FOCUSNEXT`:** the start s = `K_FOCUS`; with no focus, s = `K_ROOT` and the root itself is tested first. Step from s and
  test each view until a view can take focus (it gets `K_SETFOCUS`), the walk returns to s (nothing), or it would wrap a second time
  (nothing).
- **`K_FOCUSPREV`:** the same walk to its end (back at s, or a second wrap), remembering the last view that can take focus (with no
  focus, the root counts when it can). If there is one: `K_SETFOCUS` (it).
- With `K_ROOT` = 0, `K_FOCUSNEXT` and `K_FOCUSPREV` do nothing.
- **Stack:** `K_SETFOCUS`, `K_FOCUSNEXT` and `K_FOCUSPREV` count as routing routines (128 bytes, section 5), as they send messages.
- `K_SETFOCUS` as section 5: same view: nothing (carry clear); cannot take focus: carry, nothing; else `M_BLUR` (old, if any),
  `K_FOCUS` = new, `M_FOCUS` (new, if any).

### 15.4 `kern3` K3 additions

- **The self-test** `T_SELFTEST` (called with interrupts on; the pointer may be on), in the current arena:
  1. `K_ARESET` the app arena, `K_ARENA` app, `T_LOGN` = 0.
  2. Build this tree with `K_NEW` and `K_ADDCHILD` in this order (fields set after `K_NEW`; x, y, w, h in pixels):

     | View | Class | Parent | x, y, w, h | Flags | Tag | Id |
     |---|---|---|---|---|---|---|
     | R | `Group` | none (`K_SETROOT`) | 0, 16, 512, 176 | 0 | — | 0 |
     | A | `TBox` | R | 16, 24, 112, 24 | 1 | 0 | 1 |
     | B | `TBox` | R | 144, 24, 112, 24 | 1 | 0 | 2 |
     | C | `TBox` | R | 272, 24, 112, 24 | 3 | 0 | 3 |
     | D | `TBox` | R | 400, 24, 96, 24 | 5 | 0 | 4 |
     | G | `Group` | R | 16, 64, 480, 112 | 0 | — | 5 |
     | E | `TBox` | G | 32, 80, 200, 24 | 1 | 1 | 6 |
     | F | `TBox` | G | 256, 80, 200, 24 | 1 | 0 | 7 |

  3. Run the script: each line is `K_POST` then `K_GETEV` and `K_DISPATCH` until `K_GETEV` returns carry (pointer events at
     (x, y) carry data 3 bit 1 = 1 for `E_DOWN` and `E_MOVE` while "held", else 0):
     (`E_KEY` lines carry data 2 = data 3 = 0; type 16 carries 1, 2, 3) `E_KEY TAB`; `E_KEY TAB`; `E_KEY TAB`; `E_KEY TAB`; `E_DOWN` (356, 92); `E_MOVE` (360, 95) held; `E_UP` (360, 95);
     `E_KEY BACKTAB`; `E_DOWN` (100, 92); `E_MOVE` (40, 30) held; `E_UP` (40, 30); `E_MOVE` (40, 30); `E_KEY 'x'`; type 16
     (data 1, 2, 3); `M_DESTROY` sent to G (directly, not an event); `E_KEY TAB`; then `K_FOCUSPREV` called directly.
  4. The record: +3 = `T_LOGN` low byte, +4 = the 16-bit sum of bytes +0, +1, +2 and +7 (code, IX, tag) of records 0 ..
     `T_LOGN` - 1 (BC and DE are not fixed for messages the kernel sends itself, so they are left out), +6 = the id of the
     focused view (or `$FF`), state (+2) = 3.
- **Build target `kern3demo`:** `kern3.asm` assembled with `DEMO = 1` (`build.mjs` gains a `defs` field for a target). After boot it
  runs `T_SELFTEST`, then the demo: `T_BUILD` (the self-test's steps 1 and 2 again, so the tree is whole), `D_SCENE` draws
R's children and E, F (`G_FRAME`, the id in `G_TEXT8`, a focused
  view's frame drawn twice as thick), a status line at the top (row 0: "LEAP KERNEL K3", the self-test's sum in hex and PASS when it
  equals `T_EXPECT`, the last event's 4 bytes in hex), then loops: `K_GETEV`, `K_DISPATCH`, and after each event redraws the status
  line and, when `K_FOCUS` changed, the old and new focused frames (shielded). `T_EXPECT` is the sum the model computes, written in
  `kern3.asm` as a constant once the model has it.
- With `DEMO` undefined (`kern3`), boot is as K2 (idle at `T_IDLE`); `T_SELFTEST` is still in the image for the tests.
- **Symbols** add: `K_DISPATCH`, `K_SETFOCUS`, `K_FOCUSNEXT`, `K_FOCUSPREV`, `group_event`, `CL_Group`, `CL_TBox`, `T_SELFTEST`,
  `T_EXPECT`.

### 15.5 How the K3 bounds are measured (section 8)

| Measure | How |
|---|---|
| Per event (`E_KEY`) | Event in the ring (or posted: the worse), `K_FOCUS` = a `TBox` that consumes: direct call of a stub `T_EVONE` (`CALL K_GETEV`, `CALL K_DISPATCH`, `RET`), stepped until PC = `t_event`; T from `T_EVONE`'s first instruction |
| Bubble level | The same with a focus k levels deep that does not consume, a consuming ancestor: (T(k) - T(0)) / k, the worst for k = 1..7 |
| `E_DOWN`, `Group` of 8 `TBox` children | Root `Group` with 8 children side by side, the point in the last (focusable, consumes), focus elsewhere: to `t_event` of the last |
| `E_MOVE`, `Group` of 8 `TBox` children (16.4) | The same tree, `K_CAPTURE` = 0, the point in the last: to `t_event` of the last; no child hit and the first hit are reported |
| `K_SETFOCUS` | Old and new views whose `M_FOCUS` / `M_BLUR` are `k_nop` (section 8: "handlers that RET"), the whole call. **Amended in K3**: draft 2 said `TBox` here, which counts about 900 T of the test methods' own bodies; `TBox` is reported |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, 32 views | Trees of 32 views (a root `Group` and 31 `TBox` in chains and fans, depth <= 8), every start, the candidates placed for the longest walk: the worst |
| Bytes | `K_CODE_END - K_CODE` + 14: <= 2,400 (section 8, as amended in 16.4) |

## 16. As built

### 16.1 Slice K1 (2026-11-12)

**Result: every K1 bound passes.** Interface: section 13, with one amendment made during K1 (13.4: arenas are kept zeroed, so
`K_NEW` from the arena top writes only the class pointer; without it that path was estimated, not measured, at about 600 T against 550).

| Measure (13.7) | Measured | Bound | Result |
|---|---|---|---|
| Message send, `RST $08` to the method | 87 | <= 100 | pass |
| `K_NEW` 16-byte class, from the free list / from the arena top | 437 / 351 | <= 450 / <= 550 | pass (13 T margin on the free list) |
| `K_FREE` | 243 | <= 250 | pass |
| `K_ALLOC` | 181 | <= 200 | pass |
| `K_AINIT` / `K_ARESET` of the 8 KB app arena (they zero it with `LDIR`) | 172,424 / 172,669 | report | about 3 frames, interrupts on |
| `view_hittest` hit / miss in x | 186 / 76 | report | |
| `view_destroy` of a leaf / of a root with 7 children | 594 / 7,944 | report | |
| Stack: every K1 routine / `view_destroy` of a chain of depth 8 | at most 4 / 32 bytes | 32 / 128 | pass |
| Bytes: `K_CODE_END - K_CODE` + `K_SEND` | 588 + 14 = **602** | report (2,048 for step 3) | |

**How K1 is built** (`src/kernel/kernel.asm`, `send.asm`):
- `K_SEND` is 10 instructions at `$0008`: the class pointer, `ADD A,A`, `ADD A,L`, two loads, `JP (HL)`. The page rule on method
  tables makes `INC L` enough.
- `K_NEW` zeroes a reused block by jumping into an unrolled chain of 30 `LD (DE),A` / `INC DE` (13 T a byte) at the start of
  `K_CODE` (`ZCHAIN`, page aligned). The descriptor's pool byte is the head's offset in the arena record, so the head is one
  `ADD A,L` away. A class over 32 bytes has offset 14, a head that is always 0, so it always takes the arena-top path.
- `K_FREE` finds the arena from the block's high byte against the app arena's page-aligned base and end.

**Tests** (`tests/kern-model.mjs`, `kern-lib.mjs`, `kern-k1.mjs`, `kern-perf.mjs`; `tests/gen-classes.mjs` for the generator):
- Written by a Sonnet agent from sections 2-5, 8 and 13, without reading the Z80.
- Every call runs with interrupts on and random registers. After every call the machine's RAM (display, `$C000` up to the stack
  guard, the record) is compared byte for byte with the model.
- About 115,000 assertions a seed: 5,000 allocation steps, random trees with destroys, every message to every class, hit-test
  edges.
- Passes on seeds 1, 2, 3 (20,000 steps) for the agent and seed 4 for the main model.
- **Mutations** (the main model): `K_FREE` always to the kernel arena gave 10 failures in 3 tests; `view_hittest` comparing with
  the wrong byte gave 4. Both were caught.

**Readings the test agent made** (they match the code):
- A nested `M_DESTROY` leaves BC and DE unspecified in the log.
- `K_ARENA` preserves every register.
- "A tree of 8" is a root with 7 children.

### 16.2 Slice K2 (2026-11-12)

**Result: two bounds missed, both in the ISR's input part; everything else passes.** Interface: section 14 (one amendment during
K2: 14.3's event order, keys before the move, also written into section 7). The bounds are unchanged; options for the owner are
below.

| Measure (14.8) | Measured | Bound | Result |
|---|---|---|---|
| `K_POST` | 166 | <= 200 | pass |
| `K_GETEV` posted / ring / empty | 218 / 207 / 63 | <= 250 / 250 / 100 | pass |
| `K_POLL` idle | 280 | <= 300 | pass |
| `K_POLL` a key held | 851 | <= 900 | pass |
| `K_POLL` worst frame (full-speed move, button change, two new keys): the perf grid of 1,296 frames / the review's search over every pair of keys | **4,736** / **4,954** (5,202 with a shift key also newly down) | <= 2,000 | **MISSED** |
| Whole frame ISR, worst (`P_ISR` moving + `K_POLL`; 2,508 frames) | **11,074** (about 11,900 with the review's worst `K_POLL`, **EST**) | <= 9,500 | **MISSED** |
| Pointer deadline (largest `T_ISRP` offset + 1,500) | 8,194 | <= 8,960 | pass (unchanged: `K_POLL` runs after `P_ISR`) |
| ISR stack, return address included | 26 bytes | <= 32 | pass |
| `K_POLL`: one new key / a repeat fires / mode toggle / joystick move only / button only | 2,046 / 1,072 / 2,418 / 1,266 / 668 | report | |
| `K_WARP` / `P_ISRMOVE` unlocked / locked | 184 / 93 / 32 | report | |
| S4 pointer bounds with the new arrow | 6,779 / 50 / deadline 8,194 | unchanged | pass |
| Bytes, K1 + K2: `K_CODE_END - K_CODE` + 14 (with the 120-byte `KEYMAP`) | 1,793 | report | |

**Why the worst frame misses.** Decoding one new key in the ISR costs about 1,750 T:
- reading and storing the half-rows, about 400;
- the modifiers and the plane, about 200;
- the key-map lookup, caps lock, the repeat state and the append, about 1,100.

A full-speed move with its event costs about 975, and a button change about 380. Two new keys, a move and a button in one
frame come to about 4,500. The bound of 2,000 was an estimate (section 8) made before the decode was written. The first version
measured 5,308 / 11,612. Merging the half-row compare with the decode, and skipping unchanged rows, brought it to the figures above.

**Options (the owner decides; estimates, not measured):**

| Change | Effect |
|---|---|
| **A.** The ISR appends a raw key event (key index, CS / SS, caps lock, repeat bit); `K_GETEV` decodes it through `KEYMAP` | 150-250 T less per key in the ISR (the review's estimate; the main model's first estimate of 700 was too high); `K_GETEV` more per key event. Events seen by programs are unchanged; the ring's contents change |
| **B.** At most one new key decoded per frame; further new keys wait a frame | The worst frame drops by the second key's cost, measured at 740-974 T. A second key held down together appears a frame later |
| **A + B + small code changes** (the review: skip the second `k_pdata`, tighten `k_row`, store the repeat state once a frame; about 350-400 T) | A frame with a move, a button change and **one** key already measures 3,352 T, so 2,000 is not reachable this way. Only C, or an ISR that records changed half-rows and leaves all decoding to `K_GETEV`, removes the miss |
| **C.** Keep the code; replace the bound with the measured worst | No change. Programs lose up to about 4,500 T (8 %) of a frame in the worst input frame, and the pointer is unaffected |

**How K2 is built** (`src/kernel/events.asm`; `P_ISRMOVE` and `P_ARROW` in `src/gfx6/pointer.asm`):
- **Ring:** head and tail are bytes next to each other, read together with one `LD HL,(K_RHEAD)`, so `K_GETEV` and the ISR
  each see a consistent pair. The ISR writes the record and then the tail; `K_GETEV` copies and then moves the head.
- **Keyboard:** one read of all rows decides whether to look further. Then an unrolled pass reads each half-row and compares it with
  last frame's. Only a changed half-row is stored and decoded. The modifiers and the plane are read once, at the first change.
- **Joystick:** an idle port (`$FF`) skips the decode.
- **Keyboard-pointer keys** are worked out only in frames where the keys change.

**Independent review (Fable agent, given the code and the contract; 2026-11-12).**
- **Interleavings:** no fault in the queues, `K_POLL`, `P_ISRMOVE` or the ISR with input that changes between frames.
  - About 109,000 injected runs and 293,000 whole ISRs per seed (4 seeds), with **two** interrupts inside one routine.
  - Every boundary pair of `K_GETEV`, `K_POST`, `K_WARP` and `P_MOVE`, and shielded `G_FILL` and `G_CLS` with input.
  - Every key x plane x caps lock, the repeat schedule, the toggles, warps and clamps.
  - Stack 26 / 14 bytes.
  - The AY rule is shown necessary and sufficient: the shadow stored after the `OUT` fails 18 of 66 runs.
- **Defect D1, fixed:** a key that changed between `K_POLL`'s all-rows read and its half-row reads (contact bounce on hardware;
  not reachable on an emulator) left `K_NOW` stale.
  - The idle test used the previous all-rows read, so later frames skipped the keyboard.
  - Effects: a missed `E_KEY`, an armed repeat, and in keyboard-pointer mode a pointer running to the edge.
  - Now `K_KANY` is the OR of the stored half-rows.
  - The review's reproducer (`tests/review-hw.mjs` parts 1 and 1b) shows the right behaviour after the fix.
- **D2, corrected above:** the worst frame was under-measured (4,560 reported; 4,954 by an exhaustive search after the D1 fix).
- **D3, fixed:** test 3c's own precondition (see 16.3, test fixes).
- **Noted, not changed:**
  - An interrupt inside a second `K_WARP` drops the first warp if the ISR had not taken it yet.
  - An event that arrives between `K_GETEV`'s empty check and the loop's `HALT` waits a frame.
- **The review's checkers are kept** as `tests/review-*.mjs` (`review-inject`, `review-kpoll`, `review-hw`, `review-ay`,
  `review-profile`, with `review-lib`).

**A fault the tests found:** `K_POLL` clamped y between adding the down step and subtracting the up step, so up + down at the bottom
edge drifted upward with a spurious `E_MOVE` (against 14.3 step 5). Fixed: up and down together leave y alone. The main model's
smoke run found a second fault before the tests ran: the mode toggle never fired, because `INC L` after the `OR (HL)` chain set
the zero flag.

**Tests** (`tests/kern-model2.mjs`, `tests/kern-k2.mjs`, K2 rows in `tests/kern-perf.mjs`): written by a Sonnet agent from
sections 2, 5-9, 13 and 14 without reading the code.
- About 70,000 assertions a seed, covering:
  - every queue state;
  - interrupt injection at every boundary of `K_GETEV` and `K_POST` (2,046 runs), and of `P_SHIELD`, `P_UNSHIELD` and a shielded
    `G_FILL` while the joystick moves the pointer (about 15,900 runs, `P_ISRMOVE` refused in about 10,000);
  - 3,000 random `K_POLL` steps;
  - 3,700 frames of keys, joystick, modes and warps against the model;
  - a 401-frame flicker test.
- `V_FRAMES` rose by exactly 1 in every frame.
- Passes on seeds 1, 2 (the agent; before the fix only the y-clamp checks failed) and 1, 3, 4 (the main model, after the fix and
  the rewrite).
- Eight deliberate model mutations were each caught.
- S1-S4, `gfx6-cls`, `hello`, `spike6`, `probe23` and `kern-k1` pass with the new arrow.

**Readings the test agent made** (they match the code):
- A full ring whose last record is a move still coalesces.
- A key with code 0 counts as newly down for the repeat rule.
- An interrupt during `K_GETEV` from the ring may land before or after the copy; either order is correct.

### 16.3 Slice K3 (2026-11-12)

**Result: routing, `Group` and focus behave exactly as the model says, and the self-test matches it (26 records, sum 7,550,
focus on B). Of the K3 bounds, only `K_SETFOCUS` and the stack pass; six are missed.** Interface: section 15. Amendments during K3:
- 15.4: the self-test sum covers the code, IX and tag bytes only (BC and DE are not fixed for messages the kernel sends);
- 15.3: `K_ROOT` = 0 makes the focus walk do nothing, and the focus routines count as routing routines for the stack;
- 15.5: `K_SETFOCUS` is measured as section 8 words it.

| Measure (15.5) | Measured | Bound | Result |
|---|---|---|---|
| Per event: `E_KEY` through `K_GETEV` + `K_DISPATCH` to the focused view's handler (posted / ring) | **537** / 526 | <= 500 | **MISSED** (37 T) |
| Bubble, each level to a parent (`View` ancestors) | **278** | <= 200 | **MISSED** |
| `E_DOWN` through a root `Group` of 8 `TBox`, the last hit, focus moving from the first | **5,142** | <= 3,500 | **MISSED** |
| The same with the focus already on the last child (no focus change) / the first child hit | 4,016 / 2,160 | report | |
| `K_SETFOCUS`, handlers that return at once / `TBox` to `TBox` (with the test methods' bodies) | 498 / 1,172 | <= 500 / report | pass (2 T margin) |
| `K_FOCUSNEXT`, 32 views, worst of 1,188 walks | **10,881** | <= 5,000 | **MISSED** |
| `K_FOCUSPREV`, 32 views, worst of 1,188 walks | **17,952** | <= 8,000 | **MISSED** |
| Stack: `K_DISPATCH` through 7 `Group`s / `K_FOCUSNEXT` from depth 8 | 46 / 18 bytes | <= 128 | pass |
| `T_SELFTEST` (two 8 KB arena resets, 8 views, 17 script lines) | 244,240 | report | |
| **Bytes in the always-mapped pool**: `K_CODE_END - K_CODE` + 14 | **2,272** (K1 602, K2 1,191 with the 120-byte `KEYMAP`, K3 479); **2,279** after the review's D1 fix (16.2) | <= 2,048 | **MISSED** |

**Why they miss.**
- **Fields through IX.** Every field of a view is read with `LD r,(IX+d)` at 19 T, and moving from view to view costs a
  `PUSH` / `POP IX` pair (25 T).
- **The focus walk:** about 300 T per view. Each child, sibling or parent step reads two fields and moves IX, and climbing out of a
  subtree visits each ancestor again. `K_FOCUSPREV` always walks the whole tree.
- **`Group` hit testing** sends `M_HITTEST` to each child in turn, about 450 T a child, and the focus change adds the
  `M_BLUR` / `M_FOCUS` sends.
- **The estimates in section 8 assumed about 100 T per view.**
- **Bytes:** K2's input decode came to about twice its estimate.
- **The pool still has room:** after step 3 it has about 9,470 bytes free (11,739 - 2,272), against about 6-9 KB still to place
  (CODE_SIZE 1).

**Options (the owner decides; estimates, not measured):**

| Change | Effect |
|---|---|
| **D.** Walk the tree with HL / DE pointers instead of IX | About 30 % off the walk and the routing loops; about 20 bytes more |
| **E.** `Group` tests a child's rectangle itself when the child's HitTest is `view_hittest` (one compare of the method slot), sending `M_HITTEST` only to other classes | About 250 T less per child tested |
| **F.** Keep a ring of the focusable views (one more word in `View`), kept up to date by `K_ADDCHILD`, `K_UNLINK` and the flag changes | `K_FOCUSNEXT` / `K_FOCUSPREV` become a few hundred T; `View` grows to 18 bytes (a 24-byte pool block) |
| **G.** Keep the code; set the bounds to the measured figures | No change. A TAB costs at most about 18 k T (a third of a frame) at 32 views |

**How K3 is built** (`src/kernel/focus.asm`, the `Group` class; `src/kern3k3.asm` for the self-test and demo):
- `K_DISPATCH` keeps IX by one `PUSH` around the routing.
- `group_event` walks the children with IX, saving the group on the stack.
- The focus walk is one loop for both directions: IY holds the last candidate, BC the start, and `K_SCRATCH` counts the wraps.

**A fault the main model found before the tests ran:** `k_evto` ended with `RST $08` and no `RET`. `RST` is a call, so after the
method returned, execution fell into `group_event`, and every unconsumed event reached its view twice (the self-test logged 31
records, not 26). Fixed.

**Tests** (`tests/kern-model3.mjs`, `tests/kern-k3.mjs`, K3 rows in `tests/kern-perf.mjs`): written by a Sonnet agent from
sections 2-10 and 13-15 without reading the code.
- About 28,000 assertions a seed:
  - the self-test three times;
  - 3,500 random steps over trees of up to 32 views with every class, random events, focus calls, destroys and re-roots;
  - stack probes at depth 8.
- Six deliberate model faults were each caught by the harness.
- Passes on seeds 1, 2 (the agent) and 3 (the main model). K1 (seed 6) and K2 (seeds 1, 2, 6) pass with K3 included.
- **Two test fixes by the main model:**
  - K2 test 3c assumed the pointer could move right, and seed 6 left it at the right edge. It now moves away from the nearer edge.
  - The generator self-test listed the class set before `Group` and `TBox`.

**Cross-emulator (section 9 test 10)**, runners by a Sonnet agent, re-run by the main model:
- **TSRun reference:** `node tools/xemu/kern3-ref.mjs`.
- **ZEsarUX 13.0:** `python3 tools/xemu/zesarux-kern3.py`, 11 of 11 rows pass.
  - The self-test record (`a5 5a 03 1a 7e 1d 02`) equals TSRun's.
  - The settled demo screen is identical in all 12,288 bytes to TSRun's and stays so for 20 frames.
  - A TAB (CAPS SHIFT + 4) sent through ZRCP `send-keys-event` moves the focus to view A, and the screen then equals TSRun's after
    the same key, also in all 12,288 bytes.
  - The DOCK chunks are unchanged.
- **Fuse 1.9.1:** `sh tools/xemu/fuse-kern3.sh`, 4 of 4 rows pass.
  - The settled screen is in every hi-res frame from #136 to #1200.
  - Fuse gets no keys, so the TAB row is not run there.

**The demo** (`kern3demo`, `web/?cart=kern3demo`):
- The status line reads `LEAP K3 SUM 1D7E PASS` and then the last event's bytes and the keyboard-pointer mode.
- Views 0-2 and 4-7 are framed; 3 is hidden.
- TAB (CAPS SHIFT + 4), the arrows and a click move the focus, shown by a thicker frame.

### 16.4 Owner decisions on the missed bounds (2026-11-12)

The owner took the main model's recommendations:

| Miss | Decision |
|---|---|
| `K_POLL` worst frame, whole frame ISR (16.2) | **C:** the measured figures become the bounds, 5,250 and 12,000 (section 8). Redesign only if a program measures a shortfall: the way to 2,000 is an ISR that records changed half-rows and leaves all decoding to `K_GETEV` |
| Routing: `Group` hit testing (16.3) | **E**, built by the main model (below) |
| Per event, bubble level, `E_DOWN` and `E_MOVE` through a `Group` | **D** (walk with pointers instead of IX), a bounded job for a Fable agent in its own worktree; the bounds stay as section 8. **All four now pass** (below) |
| `K_FOCUSNEXT` / `K_FOCUSPREV` (16.3) | **G:** the measured figures, rounded up, become the bounds, 11,000 / 18,000. F is not taken: an extra word in every view, and an invariant that a program writing `View_flags` directly would break without a sign |
| Bytes (16.3) | Accepted: <= 2,400 (about 9.4 KB of the pool left, against 6-9 KB still to place) |
| The review's two notes (16.2) | Left as they are. The usual fix for the event that waits a frame needs a `DI` window, and TSRun drops a frame interrupt that arrives under `DI`; a second `K_WARP` in one frame is a program's own choice |

**A new row:** `E_MOVE` with no capture through a root `Group` of 8 is the path taken in every frame the pointer moves; the
contract had no row for it. Bound 2,500 (section 8), set from an estimate before option E was written.

**Option E as built** (`group_event`, `src/kernel/focus.asm`): the point is unpacked once into BC / DE and kept through the loop;
a child whose class's HitTest slot holds `view_hittest` is tested in place with the same arithmetic, and any other child is sent
`M_HITTEST` with BC and DE saved around the send. The group stays on the stack for the whole walk.

| Measure | Before E | After E | Bound |
|---|---|---|---|
| `E_MOVE` through 8, the last hit, to its handler | 3,930 | **3,315** | <= 2,500 **MISSED** |
| `E_MOVE` through 8, no child hit (the whole `K_DISPATCH`) | 3,517 | 2,799 | report |
| `E_DOWN` through 8, the last hit, focus moving from the first | 5,142 | **4,527** | <= 3,500 **MISSED** |
| Bytes, step 3 | 2,279 | 2,354 | <= 2,400 |

E saves about 90 T a child, not the 250 estimated in 16.3. The send it removes is only part of a child's cost; most of the rest is
the child's fields read through IX (19 T each), which is D's subject.

**Tests:** `tests/kern-hit.mjs` (new) compares the in-place test with `view_hittest` itself, at both edges of random rectangles
and one step either side (x above 255 and w above 255 included), for `E_MOVE`, `E_DOWN` and `E_UP`: about 9,500 points a seed,
seeds 1 and 2. Weakening the in-place width test (`SBC A,0` for the high byte) is caught (256 points disagree). K1, K2, K3 and the
generator test pass with E.

**Found during this round, outside step 3:** a `G_SCROLLV` fault from the graphics spike: one byte column at column 0 scrolled
down, or at column 63 scrolled up, across a third. It is fixed and recorded in GRAPHICS_SPIKE 13.3, with a new edge test.

**Perf test corrections:**
- The `K_SETFOCUS` `TBox` row in `tests/kern-perf.mjs` still carried the 500 bound. It now only reports the figure, as 15.5 was
  amended in K3.
- The accepted bounds above are in the test.

**Option D as built** (Fable agent, worktree `route-d`; reviewed and re-run by the main model, 2026-11-12). Only
`src/kernel/focus.asm` changed. **Every step 3 bound now passes.**

| Measure (kern-perf) | After E | After D | Bound |
|---|---|---|---|
| Per event, worse of ring / posted | 537 | **472** | <= 500 pass |
| Bubble level (`View` ancestors) | 278 | **186** | <= 200 pass |
| `E_DOWN` through 8 `TBox`, the last hit, focus moving from the first | 4,527 | **3,463** | <= 3,500 pass |
| `E_MOVE` through 8 `TBox`, the last hit / no child hit | 3,315 / 2,799 | **2,443** / 2,001 | <= 2,500 pass |
| `K_SETFOCUS` `View` -> `View` / `TBox` -> `TBox` | 498 / 1,172 | 456 / 1,130 | <= 500 pass / report |
| `K_FOCUSNEXT` / `K_FOCUSPREV`, 32 views | 10,881 / 17,952 | 10,839 / 17,910 | <= 11,000 / 18,000 pass |
| Stack: `E_DOWN` through 7 `Group`s / focus walk | 46 / 18 | 44 / 20 bytes | <= 128 pass |
| Bytes, step 3 | 2,354 | **2,394** | <= 2,400 pass (6 left) |

**What changed:**
- **`k_sendhl` / `k_evto`:** a send for a caller that holds the view in HL. It sets IX, reads the class through HL and jumps to
  the method, entered as `K_SEND` enters it. 75 T, against 119 for `PUSH HL / POP IX / LD A,n / RST $08`.
- **`K_DISPATCH`:**
  - the root send falls straight into `k_evto`;
  - a bubble level reads the parent through IX after the send, since a method preserves IX (section 3);
  - the six key defaults are one bit-mask loop. That saves 7 bytes and costs about 80 T on an unconsumed key, which no row
    measures.
- **`group_event` walks the children with HL**, in field order; BC holds x for the whole walk. A child the point misses costs
  about 220 T, against 342 after E.
  - IX caches the last class whose HitTest is `view_hittest`, so children of one class cost two compares, not the slot lookup.
  - "No class known" is IX = the group itself: a class pointer is never a view's address.
  - The flags are read only for a child the point is inside (the tests are pure, so their order does not change the result).
  - A child with a HitTest of its own still has its flags tested before the send, as 15.2 says.
- **`K_SETFOCUS`** is a wrapper around `k_setf` (blur, set, focus). On `E_DOWN` the group calls `k_setf` itself, since it has
  already read the target's flags.

**Readings:** `K_EV` is not changed by an `M_HITTEST` method; y is read again from `K_EV+2`.

**Tests:**
- The agent's runs: `kern-k3` seeds 1-4, `kern-hit` 1-2, `kern-k1` 6, `kern-k2` 1, `kern-perf` 1.
- The main model's runs on new seeds: `kern-k3` 5-7, `kern-hit` 5-6, `kern-k1` 3, `kern-k2` 4 and 6, `kern-perf` 4.
- `kern3demo`, cross-emulator: ZEsarUX 13.0 11 of 11 (TAB included), Fuse 1.9.1 4 of 4.
- Margins are thin: `E_DOWN` 37 T, bytes 6. `E_DOWN` includes about 700 T of the test methods' own bodies (`t_blur`, `t_focus`).
