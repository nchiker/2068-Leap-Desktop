# Space plan and K-resident programs (draft 1, 2026-11-15; for the owner's approval)

**Why:** the owner chose three add-ons (2026-11-15: "1,4,5"): the **file manager** with real Open / Save dialogs, a **mouse game** (the 15-tile puzzle) and **sound**. DOCK 2-3 has about **289 bytes free**, so no new program fits where programs live today. The pool has about **5,800**
free (the reserve for step 6 is 1,000: **4,800 usable**), DOCK 6 about 900. This note fixes where the new code goes.

## 1. The idea: a program whose start is in the pool runs under mapping K

`K_LAUNCH` starts a program with `rst $28 / DW start` (`launch.asm`): the mapping comes from the address (BANKING 5.1). A start in the pool (`$0000-$3FFF` or `$8000-$BFFF`) runs under **K**. A **K-resident program**:
- calls `G_*`, `W_*`, `K_*` and the toolkit **directly** (a `call`, 17 T, not a `KFAR`, 331 T), and may draw on the display (under the pointer shield rule: `P_SHIELD` around direct drawing);
- reaches the arena, cold RAM (`$5800`, `$7800`) and the display without crossings; its RAM image is at `PROG_IMG` as any program's (the arena is visible under K);
- calls the app library (`AL_`) and the file calls (`FS_`), which are A code, with `KFAR` (registers pass through);
- has banked-class methods that are plain pool addresses (no `KTHUNK`);
- costs pool bytes instead of DOCK 2-3 bytes. Its entry in `K_PROGS` is the same word.
The shell's icon, the Leap menu item and `S_NICONS` are as for any program (SHELL 10). Programs stay one at a time.

## 2. Budget (EST; measured when built)

| Item | Where | Bytes |
|---|---|---|
| Sound (`docs/SOUND.md`) | pool | 250 |
| The puzzle (`docs/PUZZLE.md`), the first K-resident program | pool | 1,300 |
| `List` back in `desk5` (it is a build switch, `TK_LIST`, SIZE 6) | pool | 676 |
| The file dialog, the Files program and the host calls (`docs/FILEMGR.md`) | pool (+ about 150 in DOCK 2-3) | 2,100 |
| **Total** | | **about 4,350 of the 4,800 usable** |

That leaves about 450 bytes above the reserve: **the marquee and FatBits (PAINT 21 onward) do not fit with these**, unless DOCK 2-3 is freed first (the zero-filled variables of the programs' images, about 336 bytes, `SIZE.md` 5; `w_gaview` sharing, about 85) or an add-on is dropped.
Each add-on is a **build switch** (`SOUND`, `GAME_PUZZLE`, `FILEMGR`), so a cartridge can leave any out (the builder idea); `desk5` builds all three.

## 3. Order and gates
1. **Sound** (small, no space question). 2. **The puzzle** (proves the K-resident program model: launch, windows, events, drawing, quit). 3. **Files** in three slices: F1 the host and file-interface calls (directory, delete, rename; the page's virtual disk), F2 the shared file dialog and Notepad / Paint on it, F3 the Files program and launch by extension.
Each starts with its contract (the notes in this folder), the owner's approval, then the slice with a model and tests (Sonnet), the Z80 (main model), one regression after the slice, the owner tries it.

## 4. Questions for the owner (recommendations first)
1. **Programs in the pool.** Approved? (Recommended: yes; it is the only place with room, and it makes the game faster.) The alternative is to free DOCK 2-3 first by retrofitting the four programs, which is about 420 bytes: not enough for the Files program.
2. **The marquee and FatBits** wait (or are dropped) while these three are built. Agreed?
3. **Pool reserve:** the 1,000-byte reserve for step 6 stays. Agreed?

## 5. Owner's decisions (2026-11-15)
The owner chose **sound and the puzzle now** ("how about if we just do ..."). So the first K-resident program is the puzzle (pool, about 1,300 bytes) and sound takes about 250 pool bytes; the file manager's pool cost (about 2,800) is **not** taken yet, so about 3,200 of the 4,800 usable pool bytes stay free for it or for the marquee and FatBits.
The owner also remarked that **the Calculator seems large** (2,382 bytes, the biggest program after Notepad and Paint): a read-only size review was asked for (below, when it reports).
