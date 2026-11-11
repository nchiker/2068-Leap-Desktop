# Probe (a): application code in DOCK chunks 2-3 with a kernel trampoline (contract, 2026-11-11)

Roadmap step 0 (`docs/FEASIBILITY.md`). **Question:** can application code run in place from DOCK chunks 2-3 (mapped over the
display RAM) while:
- the kernel in chunk 0 draws on the display for it through a trampoline (unmap 2-3, draw, remap, return into chunk 2-3);
- the frame interrupt also draws on the display?

The question is asked on TSRun, ZEsarUX 13.0 and Fuse 1.9.1.

**Already known:**
- Plain execution from chunks 2 and 3 runs on TSRun (Leap-IDE `arcade/spike/xip/RESULTS.md` E1).
- Reading chunks 2+3 in place with interrupts on passes on all three emulators (`arcade/spike/bank/RESULTS.md`).

This probe adds code executing there on ZEsarUX and Fuse, calls between chunks 2 and 3, the trampoline, and an ISR that draws while
the window is mapped. Video mode 0: the question is about banking, not drawing, and Fuse's frame export reads 6,912-byte mode 0 screens.

## The cartridge (`src/probe23.asm`, build target `probe23`; DOCK chunks 0, 1, 2, 3, 4, 5)

| Chunk | Content |
|---|---|
| 0 | Kernel: entry, ISR, `K_PLOT` trampoline, main loop, final check |
| 2 (`$4000`) | `APP_A`: checks the 256-byte table `TAB2` (`$4800`) and the table `TAB3` in chunk 3 by reading them in place, then calls `APP_B` in chunk 3 |
| 3 (`$6000`) | `APP_B`: computes a screen address and value from the iteration number and calls `K_PLOT` |
| 4-5 | Unused (shipped so `$F4 = $33` maps real chunks, as in the desktop) |

**Port values:** `F4_RUN = $33` (chunks 0, 1, 4, 5) and `F4_APP = $3F` (adds 2 and 3).

**Rules (Leap Arcade's banking rules plus one new one):**
- The shadow `V_SHADOW_F4` is written before every `OUT ($F4)`.
- Application code never touches `$4000-$7FFF` RAM (it is not visible while mapped).
- Nothing the ISR needs lives in `$4000-$7FFF`.
- **New, found while designing the probe:** the ISR always maps `F4_RUN` before it touches the display, then restores the port from the shadow. It never assumes the port equals the shadow, because the main code may be between its shadow store and its `OUT`. Restoring from the shadow makes either order safe.

**Main loop** (`MAINC`): for i = 0 .. N-1 (N = 2,000):
1. map `F4_APP` and `CALL APP_A` with DE = i;
2. `APP_A` checks `TAB2[k] = (7k + 63) AND $FF` and `TAB3[k] = (7k + 94) AND $FF`;
3. `APP_A` calls `APP_B`;
4. `APP_B` calls `K_PLOT` with HL = `$4000 + 3i`, A = `(7i + 1) AND $FF`;
5. `K_PLOT` maps `F4_RUN`, writes the byte, reads it back (it must be RAM), maps `F4_APP` and returns;
6. the main loop maps `F4_RUN` again.

**ISR** (IM 1, chunk 0):
- counts frames (`V_FRAMES`);
- counts the frames whose shadow said `F4_APP` (`V_IRQAPP`: interrupts taken while application code was mapped);
- maps `F4_RUN`, writes the frame count's low byte to `$57FF` (the last byte of display file 1), and restores the port from the shadow.

**Final check** (`FINDI`, port `F4_RUN`):
- display file 1 `$4000-$57FE`: byte `3i` = `(7i + 1) AND $FF` for i < N; every other byte 0;
- display file 2 `$6000-$7AFF` all 0;
- attributes `$5800-$5AFF` all `$38`;
- the RAM holes `$5B00-$5FFF` and `$7B00-$7FFF` still hold the poison written at boot (`low byte of the address XOR $A5`);
- no failure noted by `APP_A` or `K_PLOT`;
- `V_IRQAPP` > 0.

Then the attributes are filled green (`$20`, pass) or red (`$10`, fail), and the record is written.

## The result record (`$FF00`)

| Offset | Content |
|---|---|
| +0, +1 | marker `$A5`, `$5A` (written last) |
| +2 | state: 1 pass, 2 fail |
| +3 | first failure kind: 0 none, 1 `TAB2`, 2 `TAB3`, 3 read-back in `K_PLOT`, 4 display file 1, 5 display file 2, 6 attributes, 7 holes, 8 no interrupt while mapped |
| +4, +5 | iterations done |
| +6, +7 | `V_FRAMES` at the final check |
| +8, +9 | `V_IRQAPP` |
| +10, +11 | address of the first failing byte (kinds 3-7) |

## Checks per emulator

| | TSRun (`tests/probe23.mjs`) | ZEsarUX 13.0 (`tools/xemu/zesarux-probe23.py`) | Fuse 1.9.1 (`tools/xemu/fuse-probe23.sh` + `fuse-probe23-check.mjs`) |
|---|---|---|---|
| Record says pass | yes | yes (ZRCP, memory zone 0) | final frames green |
| Code ran in chunks 2-3 | instruction sampling: PC in `$4000-$7FFF` with `$F4 = $3F` | the record (the tables can only be read in place) | the same |
| Interrupts taken in chunk 2-3 code | the return address on the stack at `$0038` lies in `$4000-$7FFF` | `V_IRQAPP` > 0 | final screen (kind 8 would be red) |
| No interrupt lost | `V_FRAMES` = frames run since `MAINC` (within 1) | `V_FRAMES` against T-states between `MAINC` and `FRCAP` (where the record takes the count) / 69,888 (within 1) | — |
| The display showed RAM while 2-3 were mapped | every rendered frame's file 1 equals the model after some number of iterations, never DOCK bytes | display RAM samples (zone 0) match the model | every movie frame's bitmap is a model prefix; then green |
| DOCK chunks 2-3 unchanged (nothing wrote into the window) | (TSRun ignores DOCK writes) | DOCK zone 19 chunks 2, 3 equal the DCK | — |

Pass = every row passes on every emulator. A failure is reported with the record before anything is changed.

## Results (2026-11-11): PASS on TSRun, ZEsarUX 13.0 and Fuse 1.9.1

All figures are emulator results; real hardware is untested (the display staying on RAM under a DOCK mapping is Arcade hardware
checklist item 0).

| | Result |
|---|---|
| **TSRun** (`node tests/probe23.mjs`, 11/11) | **Code:** 99.1 % of 468,712 sampled instructions ran in `$4000-$7FFF`, every one with `$F4 = $3F`. **Interrupts:** 50 of 50 sampled returned into chunk 2-3 code. **Display:** 929 of 929 frames showed display RAM (model bytes or 0), never DOCK bytes, and the written count never fell. **Record:** pass, 2,000 iterations, 891 of 919 interrupts taken with the window mapped. **No interrupt lost:** 869 of 869 over the normally run frames |
| **ZEsarUX 13.0** (`python3 tools/xemu/zesarux-probe23.py`) | **Record:** pass, 2,000 iterations, `V_IRQAPP` 885. **Interrupts:** `R_FRAMES` 910 against 910.22 frames of T-states (`MAINC` to `FRCAP`). **Display:** 459 samples, 443 of them with the window mapped, 0 bad. **DOCK:** chunks 2 and 3 identical to the DCK after the run (0 bytes differ), so nothing wrote into the window |
| **Fuse 1.9.1** (`sh tools/xemu/fuse-probe23.sh`) | 2,403 movie frames: 113 boot, 1,207 run, 1 transition, 1,082 final. Every run frame showed model bytes or 0 with attributes `$38`, and the count never fell (0 -> 1,992 of 1,992). Every final frame showed the full model in green |

**Findings:**
1. **The ISR must never assume the port equals the shadow** (rule above). With the shadow stored before each `OUT`, an ISR that maps `F4_RUN`, draws, and then writes the shadow back to the port is safe at every instruction boundary. That is by reasoning; the probe exercised it with about 900 interrupts per emulator. Interrupt injection at every instruction (Arcade's method) is for the kernel's tests.
2. **Single-stepping drops interrupts.** On TSRun, stepping a frame instruction by instruction can drop that frame's interrupt (60 stepped frames had 50). This is a harness effect only: normally run frames lose none. Tests count interrupts only over normally run frames.
3. **Exclude samples taken before the cartridge has initialised.** ZEsarUX samples taken then (the shadow still holds power-on RAM) show the stock ROM's screen. The runner excludes samples whose shadow is neither `$33` nor `$3F`: 53 in the last run. Every later sample is judged against the exact model.

**Consequence:** the DOCK 2-3 application bank of `docs/FEASIBILITY.md` section 4 works on all three emulators. Code runs in place,
calls between chunks 2 and 3 work, the kernel trampoline draws and returns into chunk 3, and the ISR draws while the window is mapped.
