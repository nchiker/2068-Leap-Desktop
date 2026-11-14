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
