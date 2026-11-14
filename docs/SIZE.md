# Size work after W4 (contract, 2026-11-14; owner: "I accept your recommendations, go ahead")

The source is the read-only size review of `desk5` (2026-11-14). It counted bytes from `build/desk5/out.lst` and followed
references through the generated includes; it is summarised here. The owner's rule (CLAUDE.md): nothing that a program
might use is deleted. Shared code goes to the kernel pool, the DOCK 6 graphics library or the DOCK 2-3 app library.

## 1. Now, after the app library and Key Caps are merged (pool, about +1,055 bytes)

| # | Change | Bytes freed | Where |
|---|---|---|---|
| S1 | The kernel starts at `$9E00` instead of `$A000`, using chunk 4's free tail. The two pages it moves by keep every low-byte `IF`, `ASSERT` and `ALIGN`; `K_FAR` treats `$8000-$BFFF` as K. | +512 in chunk 5 | `desk5.asm` |
| S2 | `ALIGN 512` with `tables.inc` before `gfx6.asm`, so `ROWTAB` is at `$0200`. The 404-byte pad before it becomes 72. The three page-cross `IF`s stay under their limits. | +335 in chunks 0-1 | `desk5.asm` |
| S3 | `G_CLS` (101), `G_VLINE` (19) and `G_ROWADDR` (9) are left out of `desk5` (`IFNDEF` guards in `gfx6.asm`, defined by `desk5` only). No program needs them: a program clears its own rectangle with `G_FILL`, and `G_FILL` with width 1 is a vertical line. | +129 in chunks 0-1 | `gfx6.asm`, `desk5.asm` |
| S4 | `K_WARP` and `K_POLL`'s warp block are left out of `desk5`, and the mouse test is merged into one. | +63 in chunk 5 | `events.asm` |
| S5 | `LMASK` and `RMASK` become aliases of the identical first 8 bytes of `LMASKP` and `RMASKP`. | +16 in chunks 0-1 | `tables.inc` (a `desk5` guard) |

`kern3`, `kern4`, `bank5`, `gfx6t` and `hello` stay byte-identical: every change is under a `desk5` `DEFINE` or in
`desk5.asm`.

## 2. The pool's measure

- **What goes:** "Step 5's pool growth <= 3,400" (`tests/shell-perf.mjs`). It counts code ranges, not free space, so S1
  and S2 do not move it.
- **What replaces it:** the **free bytes of the always-mapped chunks**, read from the build's symbols:
  - chunks 0-1: from `TK2_END` to `$4000`;
  - chunk 4's tail: from the last table to the kernel;
  - chunk 5: from `K_PROGS`' table end to `$C000`.
- **The reserve:** the total must stay at or above **1,000 bytes**, the reserve for step 6. The row reports each chunk.

## 3. Notepad's search (WRITE 14.5)

- **Speed-up:** the scan of F's first code steps through each run of codes between the gap and the ends without calling
  `wr_gap` or `wr_low` for every code. A letter is tested with its case mask, as 14.9 item 7 first planned.
- **Estimate:** **EST** 4x faster, about +40 bytes.
- **Measures:** `wr-perf`'s two 5,120-code rows, reported before and after. The result of every search is unchanged, and
  `wr-w4` judges it.

## 4. At the start of Paint: the DOCK 6 graphics library

- **Moving to DOCK 6** (mapping R, reached by `KFAR`), about +3,800 pool bytes in all:
  - `G_LINE` with `G_ADDR` (1,303 bytes);
  - `G_BLIT` (948) with the shell's icons (DOCK 6 data, since R cannot see the program image);
  - `G_SCROLLV` (1,526).
- **Check's X** becomes five `G_FILL` rectangles: (3, 2, 1, 1), (8, 2, 2, 1), (4, 3, 4, 2), (8, 5, 2, 1) and (3, 5, 1, 1),
  relative to the box. The pixels must be unchanged, and the draw is judged by `tk-perf`'s Check rows.
- **Contract:** Paint's own. This section only records the decision.

## 5. Not now

- **Zero-filled variables out of the programs' images:** about 368 bytes of DOCK 2-3, which has more than 4 KB free.
- **Sharing `check_event` with `button_event`:** about 30 bytes, but it renumbers flags that `tk-t1` checks.

## 6. `List` is a build switch (2026-11-14; owner: "yes, make List a build switch")

- **What:** `src/kernel/tk2.asm` assembles `tk_div` and the whole `List` code (`ls_geom` .. `TK_SETITEMS`) only when `TK_LIST` is defined; the
  class generator has a `guard NAME` line (in `tk-classes.txt`: `guard TK_LIST` under `class List`), which wraps the descriptor in
  `IFDEF`. The `List_*` offsets stay. `Field` and the clip / dim helpers it shares are always built.
- **Targets:** `desk5` is built **without** `List`; `desk5l` (`tools/build.mjs`) is `desk5` with `-DTK_LIST=1`, byte-identical to the old `desk5`.
  A program that wants a `List` builds its cartridge with the switch.
- **Freed in `desk5`:** chunks 0-1 `TK2_END` `$3F36` to `$3CA4` (658 bytes) and the 18-byte descriptor in chunk 5 (`K_PROGS` `$BF32` to `$BF20`):
  **676 bytes of pool.**
- **Tests:** `tk-t2`, `tk-t3` and `tk-perf` boot `desk5l` (`bootParked({ cart: 'desk5l' })`, `loadDesk5('desk5l')`); every other suite uses `desk5`.
  `Field` on `desk5` itself is exercised by Notepad's dialogs (`wr-w3`, `al-a1`). The runner's preflight needs `build/desk5l.dck`.
- **Result:** all 20 suites pass; every log is identical to the previous run except `shell-perf`'s size rows (growth 1,716 to 1,698 and
  addresses; the `DI` sweep of the shell's code counts 230 instructions, not 229, because pool addresses inside it moved; still 0 `DI`).

## 7. The safe pool changes are done (2026-11-14)

- **Built (`desk5` only; `hello`, `gfx6t`, `spike6`, `kern3`, `kern3demo`, `kern4`, `kern4demo`, `bank5` and `probe23` are byte-identical to before, checked by hash against a build of the previous commit):**
  - S1: the kernel starts at `$9E00` (`K_CODE`), using chunk 4's 512-byte tail;
  - S2: `ALIGN 512` and `tables.inc` come before `gfx6.asm`: `ROWTAB` is at `$0200`, `G_INIT` at `$0380`;
  - S3: `DEFINE G_LEAN` leaves out `G_CLS`, `G_VLINE` and `G_ROWADDR`;
  - S4: `DEFINE K_NOWARP` leaves out `K_WARP` and `K_POLL`'s warp block (`K_CODE` 6,276 to 6,211, `calc-perf`'s row 264 to 199);
  - S5: `DEFINE MASKS_SHARED`: `LMASK` / `RMASK` are `EQU`s of `LMASKP` / `RMASKP` (`tools/gen-tables.mjs` emits the `IFDEF`).
- **The pool's free bytes** (the new measure, `shell-perf`, with its 1,000-byte reserve row): **2,121**, of them chunks 0-1 1,326, chunk 4 0,
  chunk 5 795. Before section 6 it was 930 (202 + 216 + 512): **+1,191 bytes in all** (`List` 676, S1-S5 515).
- **Tests:** every suite passes. The `shell-perf` `DI` sweep false-alarmed on `$4AB1` (`rst $28`'s `DW G_TEXTP` operand `$0FF3` holds a `$F3`
  byte): the decoder now knows `RST $28` takes a 2-byte operand (bound unchanged, 0). The timing rows moved by a few T (`K_POLL` is shorter: List draw
  233,181 to 233,183; Write's cut / paste +2; `kc-k1`'s single-key redraw ends within 60,679 T of the interrupt, was 60,575, bound 61,000: **the margin is now
  321 T**) and the stack-depth samples in `kc-k1` moved by a few bytes (the interrupt lands on other instructions). The `desk5-ref` run passes.
