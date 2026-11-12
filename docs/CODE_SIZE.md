# Code size: contract (draft 1, 2026-11-11, for the owner to choose from)

The first decision of roadmap step 3 (`docs/FEASIBILITY.md` 5a): how gfx6 and the kernel fit the cartridge. The owner's order:
**consolidate first** (merge gfx6's duplicated copies), **then a `shrink-z80` pass** on what remains, then move or grow if still
short. Marks as in FEASIBILITY: **EMU** measured, **EST** estimated. Byte figures without a mark are counted from today's
`build/spike6` listing and symbols (fresh against the source, `shrink-z80` freshness gate).

## 0. Decision and result (owner, 2026-11-11)

**The cartridge is planned at 56 KB: DOCK chunks 0-6 (D2).**
- Always-mapped code stays 32 KB (chunks 0, 1, 4, 5).
- Chunks 2-3 (16 KB) take banked apps.
- Chunk 6 (8 KB) takes resources and kernel code that never touches the display or the heap (C2).
- The proof of concept may still ship as 32 KB.

**Clean-up now: only what pays for itself.**

| Done | Bytes | Speed (EMU) |
|---|---|---|
| **A1 applied.** Odd two-column glyphs are drawn by two S passes (`tpf_on` / `tpf_od` / `tpf_o3`), and the O blocks, their trampolines and their `TP_OPS` entries are gone. Every pass block now ends with `JP (IX)` (IX = `tpf_adv`, saved by `G_TEXTP`). | gfx6 13,326 -> **12,451** (-875) | Paragraph 668.0 -> **681.5** T a glyph (bound 700; XOR 681.5, CLR 713.0, report only). A one-code call costs about 455 T less (2,993-3,634, was 3,447-4,090): a line writes two trampoline sets, not three. No other section 7 row changed |

- **Tests:** all pass (S1-S4 on two seeds each, S2 on five, `gfx6-cls`, `hello`, `spike6` on two seeds, `probe23`), and
  `gfx6-perf` is unchanged apart from the rows above (62 pass, the 4 known S3 misses unchanged).
- **Cross-emulator:** ZEsarUX 13.0 passes 12 of 12 rows and Fuse 1.9.1 10 of 10.
- **Pool after A1:** about 11.7 KB free (10,864 + 875).

**Not done, with the reason** (the `shrink-z80` and `optimize-z80` scans, upstream 0.8.10 merged into the local skills as
0.9.6):
- The scans found **no zero-cost clean-up**. There are no dead routines.
  - The clip, axis and LDI-chain helpers are already shared (`sc_axis`, `sc_clip`, `rc_wrlx`), so **A4 is smaller than estimated**.
  - The flagged tail calls are false positives (`call sc_clip` is followed by `ret c`).
  - The other repeats are 2-8-byte setup idioms in routines at or past their bounds.
- **A2-A6 and B1-B4 stay open.**
  - Each spends speed where the margin is 32-221 T (text, `G_BLIT`, `G_FILL` XOR, the pointer), or makes the recorded S3 misses worse.
  - Each also needs a RAM trade.
  - With 56 KB planned, they wait until a kernel build shows a real shortfall in the always-mapped pool.

## 1. The pressure

**The binding limit is 32 KB of always-mapped code, whatever the cartridge size.**
- Everything that draws must run with `$F4 = $33`, so it lives in DOCK chunks 0, 1, 4 or 5.
- Chunks 2-3 map over the display, chunk 6 over the heap, and chunk 7 holds the stack.
- A bigger cartridge adds only banked space.
- Code moves between chunks 0-1 and 4-5 at no speed cost (all DOCK, no contention). They are one 32 KB pool; only the
  page-aligned tables are tied to page boundaries.

| Chunk | Holds today | Bytes | Free |
|---|---|---|---|
| 0-1 | header, vectors, boot, ISR (320); gfx6 code (13,315); padding to `ROWTAB` (189); `ROWTAB`, `LMASK`, `RMASK` (400) | 14,224 | 2,160 |
| 4 | `LMASKP`/`RMASKP` 512, `PROP6_*` 1,024, `FONTP` 2,048, `SHR`/`SHL` 4,096 | 7,680 | 512 |
| 5 | the spike6 demo (not kept) | 0 | 8,192 |
| **Pool** | | **21,904** | **10,864** |

**What has to fit in the free pool** (FEASIBILITY section 4, all **EST**):

| Part | Size |
|---|---|
| Kernel without graphics: boot, ISR, input, events, objects, allocator, windows, menus, dialogs, trampolines, jump table | 8-11 KB |
| Toolkit (controls) | 3-4 KB |
| Shell | 3 KB |
| Calculator | 2 KB |

- **The proof of concept** (roadmap steps 3-4) fits only if the kernel stays at the low end of its estimate.
- **Section 4's 32 KB variant** (adding toolkit, shell and Calculator) is 5-9 KB short.

## 2. Where gfx6's bytes are

| Family | Copies | Bytes |
|---|---|---|
| `G_TEXTP` pass blocks (`TP_*`) | 3 ops x S / E / O | 1,766 |
| Save, restore, scroll (`G_SAVERECT`, `G_RESTRECT`, `G_SCROLLV`) | 3 routines with the same row-code idea | 2,506 |
| Pointer, unrolled 3-column kinds (`pt_de3`, `pt_do3`, `pt_ee3`, `pt_eo3`) | draw / erase x even / odd | 1,236 |
| `G_FILL` 2..8-column bodies (`SB_*`) | SET 339, CLR 327, XOR 399 | 1,065 |
| `G_BLIT` | 4 chains | 948 |
| `G_LINE` loops (`lx_*`, `ly_*`) | 2 axes x 2 directions x 3 ops | 588 |
| `G_TEXT8` cell bodies (`T8_*`) | 3 ops x even / odd | 296 |
| `G_VLINE` bodies (`V_SET`, `V_CLR`, `V_XOR`) | 3 ops | 135 |
| Everything else (setup, clipping, whole-byte blocks, small routines) | | 4,775 |

**About 7 KB of the 13.3 KB is per-op or per-parity copies.** That is where consolidation can save bytes. The `shrink-z80`
scanners (dead code, repeated sequences, patterns) found no dead gfx6 routine. The routines the demo does not call are still
kernel interface. The repeated sequences they found are small setup idioms (B2).

## 3. Options

Within a group, the order is the proposed trial order. "Saves" is bytes off the pool. "Costs" is T-states against section 7 of
`docs/GRAPHICS_SPIKE.md`, plus any RAM.

### A. Consolidation (first)

| # | Change | Saves | Costs | Bound at risk |
|---|---|---|---|---|
| A1 | `G_TEXTP`: draw odd-parity two-column glyphs as two S passes (drop the O blocks) | **891 (EMU, S2)** | 668 -> 680.9 T a glyph (EMU); CLR 712.5 (report only) | `G_TEXTP` <= 700: passes |
| A2 | **Op in RAM:** keep one copy of each per-op family (fill edges SET/CLR, text S/E, `T8`, `V_x`, line loops). `G_INIT` copies it to `$E000-$FFFF`, and `G_SETOP` patches the op opcodes. Chunk 7 is never hidden, so the copy is always reachable. Precedent: S2's trampolines and S3's `GCODE` already run from RAM | 1,300-1,800 (EST; after A1) | 0 T a byte; `G_SETOP` about 1-3 k T (EST, rare); **900-1,200 B of RAM** taken from the heap | none expected; the tests' poisoned-RAM areas must give gfx6 the copy's range |
| A3 | `G_LINE`: 12 loops become 4 (axis x direction), with the op as `(old AND k) XOR m` in registers. Not needed if A2 takes the line loops | 300-390 (EST) | about +8-15 T a pixel (EST), mean 109 now | `G_LINE` <= 150: margin 41 |
| A4 | Save, restore and scroll share one row-code writer and one character-row walker | 400-800 (EST) | about 100-300 T a call (EST) | all three already miss; the trial must not make them worse |
| A5 | Pointer: merge the even and odd kinds (toggle `H` bit 5 in place of fixed `SET` / `RES`) | about 600 (EST) | about +300-400 T in the ISR (EST); margin 221 T | `P_ISR` <= 7,000. Only together with S4's review speedups: erase keeps the draw's geometry (-330), geometry worked out in `P_MOVE` (-570). A bounded job for a Fable worktree |
| A6 | `G_FILL`: one 2..8 body set for SET and CLR in ROM (edge `(a AND k) OR m`, fill byte in a register). Not needed if A2 takes the fill edges | about 320 (EST) | about +8 T a row (EST) | 32 x 16 SET: 2,830 vs 3,000, so it fits; XOR is not touched (3,246 vs 3,300) |

### B. `shrink-z80` pass (after A, on what remains)

| # | Change | Saves | Costs |
|---|---|---|---|
| B1 | Drop `LMASKP` / `RMASKP` (chunk 4). Use the 8-byte `LMASK` / `RMASK` already in chunk 0-1 with `AND 7` | 512 | about +15 T a `G_FILL` call and a clipped glyph (EST). Leaves `G_FILL` 32 x 16 XOR a 54 T margin, so it is tight |
| B2 | Shared setup helpers for the inlined idioms (the `ROWTAB` lookup is inlined 8 times, byte-column arithmetic 11 times). Not in `G_FILL` | 100-250 (EST) | +17-27 T a call where used (EST) |
| B3 | Micro and dedup lanes (`shrink-z80 micro` / `dedup`) | 100-300 (EST; S2's pass found 473, mostly structural) | 0 by rule: no change on a per-byte path |
| B4 | Build `SHR` / `SHL` at boot into RAM, not ROM. Not recommended | 4,096 less about 30 for the generator | **4 KB of RAM** (heap about 13.5 -> 9.5 KB **EST**); boot about +200 k T. Placing them in the cold RAM at `$5800` / `$7800` is worse: contended, hidden under 2-3, and in mode 0 `$5800` is the attribute file |

### C. Moving code between chunks (frees nothing in the pool, except C2)

| # | Change | Effect |
|---|---|---|
| C1 | Use the pool as one: gfx6 code and kernel spread over 0-1 and 4-5 | 0 T, 0 bytes. Removes the per-chunk squeeze: today 0-1 has 2,160 free, 5 has 8,192 |
| C2 | Kernel code that never touches the display or the heap (object dispatch, allocator, event logic, menu and dialog layout, tape) goes banked into chunk 6 (with D2) | Frees up to 8 KB of pool. Costs a trampoline per call, about 50 T (**EST**; probe (a) proved the pattern but did not time it). The heap `$C000-$DFFF` is hidden while chunk 6 runs |
| — | gfx6 into chunks 2-3 | **Not possible:** it draws on the display that 2-3 hide. Only `G_PRESHIFT` and `mul16` / `div3216` (about 250 B) are display-free |

### D. Growing the cartridge

| # | Shape | Adds | Status |
|---|---|---|---|
| D1 | 48 KB: chunks 0-5 | 16 KB banked in 2-3. Section 4 gave this space to Write and Paint, so the shell, toolkit or Calculator here compete with them | **EMU**: probe (a) on three emulators; Arcade ships 40 KB DCKs (0, 1, 2, 4, 5) |
| D2 | 56 KB: chunks 0-6 | + 8 KB banked in 6, for resources and C2's cold kernel code. A font in 6 cannot draw strings that live in the heap | **EMU**: reads from 6 |
| — | Beyond 56 KB | Not on the DOCK port: chunk 7 is the stack, and 8 x 8 KB is the port's limit | Out of scope |

## 4. What the trials measure, and the bounds

**Method.**
- Each A or B candidate is tried alone, in a disposable LeapG worktree (`CLAUDE.md`), never in the main tree.
- It is rebuilt, then runs `gfx6-s1` to `gfx6-s4`, `gfx6-cls`, `hello` and `spike6` on two seeds, and `gfx6-perf`.
- Z80 changes are written by the main model. A5 goes to a Fable worktree. Haiku runs the suites.

**Reported for each candidate:**
- `GFX6_CODE_END - GFX6_CODE`;
- chunk 4 table bytes;
- RAM bytes added;
- the pool's free bytes;
- the change in T for every row of section 7.

**A candidate is accepted only if all of these hold:**
- every section 7 bound that passes today still passes;
- the four recorded S3 misses (save, restore, both scrolls) are no worse than today's figures;
- the pointer still meets its deadline (`P_ISR` <= 7,000, + 1,500 <= 8,960);
- the longest `DI` is still 0;
- every test passes.

**After the accepted candidates are applied together:**
- the whole suite is re-run;
- the cross-emulator `spike6` runs (ZEsarUX, Fuse; `tools/xemu/`) are re-run once.

**Step bound (owner to set):** the pool's free bytes after the step. EST outcomes:

| Applied | gfx6 + tables saving | Pool free | Enough for |
|---|---|---|---|
| Nothing | 0 | 10.9 KB | the PoC only if the kernel is at its low end |
| A1 + A2 + A4 + B1-B3 | about 3.2-4.4 KB | about 14-15 KB | the PoC with margin; the 32 KB variant still about 1-6 KB short |
| Also A5 | about +0.6 KB | about 15-16 KB | as above |
| Any of these + D2 with C2 | + up to 8 KB | about 22 KB | the PoC plus toolkit, shell and Calculator |

**Recommendation.**
1. Do A1, A2, A4 and B1-B3 first: SAFE or near-SAFE, about 3-4 KB.
2. Take A5 only with the review's ISR speedups.
3. Set the step bound at **>= 14 KB free**, enough for the PoC.
4. Decide D (48 or 56 KB) at roadmap step 5, when the shell and the apps exist.

## 5. For the owner to choose

1. Which candidates to try: all of A and B1-B3 (recommended), or a subset. Is B4 (4 KB of RAM for 4 KB of ROM) out?
2. A2 spends 0.9-1.2 KB of RAM to save cartridge bytes. Accept that trade?
3. The step bound: free bytes in the pool after the step (recommended: >= 14 KB).
4. Whether to plan now for a 56 KB cartridge (D2 + C2) or keep 32 KB until step 5.
