# Object-model audit: where the programs duplicate code (2026-11-14; owner asked: is the OO / reuse balance right for the size?)

A read-only survey by a Sonnet agent over `build/desk5/out.lst` (bytes measured, not guessed); the main model re-checked the two largest
claims (section 4, items 1 and 3). The agent's scripts and full report were in the session scratchpad only. Verdict: **the balance is right;
the object model has already given the reuse it can, and the remaining savings are mostly not object questions.**

## 1. Facts

- `desk5` assembles the shell, Calculator, Notepad, Key Caps, `applib.asm` and `files.asm`. `demo.asm` (Controls) is **not** assembled.
- DOCK 2-3 holds 11,844 of 16,384 bytes: **4,540 free**.
- **Programs never send messages.** They create objects with `K_NEW` and only *receive* sends (Draw, Event, Focus, Blur) through RAM
  thunks. The whole build has 5 `rst $08` sends and 2 `k_sendhl` callers, all in the kernel. There is no `App`, `Run`, `Menu` or `Quit` message.
- Per program (bytes): Calculator 2,382 (one class, `CDisp`), shell 1,115 (`Icon`), Notepad 6,474 (`TextView`), Key Caps 1,113 (`KeyCaps`).
  Each defines one `View` subclass and overrides one to four methods; everything else is its own logic.
- A class costs 18 bytes (6 header + 12 table). The pool has 14 (252 bytes; 26 of the 84 slots are `k_nop` and 44 repeat the parent's, about
  140 bytes that could be reclaimed only by a slower inheritance walk, +40 T a send, EST).

## 2. Duplication

- **Generic app frame** (image copy 11 B, event-loop head 8 B, window build 10 B, open + mouse 12 B, close-to-quit 10 B): **241 bytes
  over four programs, 2.0 % of DOCK 2-3.** Calculator's arithmetic and Notepad's text engine are program-specific.
- Runs of 6 or more identical instructions: 43 repeats, 701 bytes gross, **373 net** of call overhead. Of that, 257 are inside one program
  (Notepad has 12 of the top 15) and only **1 repeat (6 bytes net) is between two programs**. Runs of 3 or more: 912 bytes net, mostly noise.
- The app library already took the large duplicates (alert, ask, name dialog, view tables, title, file naming).

## 3. Candidates, ranked by net benefit (bytes: DOCK 2-3 / pool; T-states EST)

| # | Candidate | DOCK 2-3 | Pool | T | Verdict |
|---|---|---|---|---|---|
| 1 | Leave `List` (650 bytes, `ls_geom` to `fd_buf`) out of `desk5`; no program uses it | 0 | **-650** | 0 | **Owner's call:** the rule "nothing a program might use is deleted" |
| 2 | Zero-filled variables out of the images (388 bytes: Calculator 127, shell 9, Key Caps 57, Notepad 195), cleared at start | **about -336** | 0 | 0 | Already in SIZE 5, now measured |
| 3 | Export `w_gaview`; replace Calculator's `cd_rect` (35), the shell's `ic_draw` (29 to 3) and `AL_TITLE` (33 to 9) | -85 | 0 | +27 on two | Small and safe |
| 4 | `AL_RUN`, a shared app frame in the app library (111 bytes plus about 20 a program) | about -5 now, about -65 at six programs | 0 | about +60 an event | For ergonomics and Paint / Puzzle, not size |
| 5 | Table-driven menu dispatch | about 0 | 0 | about 0 | No |
| 6 | Compact method tables | 0 | at most -140 | +40 a send | No |
| 7 | An `App` base class with a kernel-driven loop | +22 a program | about +60 | +340 a message (`KFAR`) against 17 for a call | **No: costs more than it saves** |

## 4. Checked by the main model

1. **`List` is unused by the programs:** `src/apps` has no `CL_List`; `Field` (same file, `tk2.asm`) *is* used, by the name dialog in
   `applib.asm`. `ls_geom` = `$3ADA`, `fd_buf` = `$3D64`: 650 bytes in chunks 0-1.
2. **Not checked:** whether `tk_clipin`, `tk_clipout`, `tk_dim` and `tk_div` (158 bytes) are `List`-only; the T-state figures; whether `IX`
   is the text view at Notepad's `wr_gav` call sites (the extra 25 bytes in item 3).
3. **Verified:** Calculator's `cd_rect` is the same sequence as `w_gaview` (`wm.asm` 1787-1793), with `GA_X..GA_H` for `GA`.

## 5. What it means

- The savings that matter are **not object questions:** `List` (pool, 650), the zero-filled variables (programs, 336), gfx6's per-op copies
  (about 7 KB, a speed trade, `CODE_SIZE` 2), cold kernel code in DOCK 6 (up to 8 KB, `CODE_SIZE` C2).
- More object machinery would **spend** pool bytes, the scarce resource, to save bytes where there is room.
- Together with `SIZE` 1 (+1,055 bytes) the pool would gain **about 1,700 bytes** if the owner agrees to item 1.
