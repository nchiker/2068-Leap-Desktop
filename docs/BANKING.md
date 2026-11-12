# Where code lives: contract (draft 1, 2026-11-12, owner approved)

Roadmap step 5's first contract (`docs/FEASIBILITY.md` roadmap 5; `CLAUDE.md`: "Step 5 starts with a short contract on what
stays always mapped and what runs banked"). It decides where the toolkit, the shell and Calculator go and how banked code
reaches the kernel and the display. It comes before any toolkit or app code. Marks as in FEASIBILITY: **EMU** measured,
**EST** estimated, **TM** the Technical Manual. Counted T-states are **EST** until slice B0 measures them.

Style as `docs/WINDOWS.md`: every number in section 6 is a bound. **A missed bound is reported with its numbers before
anything is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not
judged.

## 1. The pressure

**What is free.** Counted from today's `kern4` build, without its test code:

| Where | Free bytes |
|---|---|
| Chunks 0-1: after `K1_CODE_END` (`$3C80-$3FFF`) | 896 |
| Chunks 0-1: test code a desktop does not carry (`$3590-$37F9`, `$0183-$01E1`) | 713 |
| Chunks 0-1: holes in page 0 (`$0016-$0037`, `$003B-$0065`, `$0068-$00FF`) | 229 (34 + 43 + 152) |
| Chunk 4: after the tables (`$9E00-$9FFF`) | 512 |
| Chunk 5: after `K_CODE_END` (`$B7AB-$BFFF`) | 2,133 |
| **Pool free** | **4,483** |

**What is wanted** (FEASIBILITY 4, **EST**): toolkit 3-4 KB, shell 3 KB, Calculator 2 KB, then Write 6-7 KB, Paint 5-6 KB
and tape services 1-2 KB. The pool cannot take all of the first three.

## 2. The three mappings

`$F4` takes one of three values. A routine runs under exactly one of them, chosen by where it lives.

| Name | `$F4` | DOCK mapped | What it **sees** | What it **does not see** |
|---|---|---|---|---|
| **K** (kernel) | `$33` | 0, 1, 4, 5 | pool code; display; cold RAM `$5800-$5FFF`, `$7800-$7FFF`; heap `$C000-$DFFF`; hot RAM `$E000-$FFFF` | code in 2-3 and 6 |
| **A** (app) | `$3F` | + 2, 3 | pool code; **code in 2-3**; heap; hot RAM | display, cold RAM |
| **R** (resource) | `$73` | + 6 | pool code; **code in 6**; display; cold RAM; hot RAM | heap |

- **R can draw.** Chunks 2-3 are RAM under `$73`, so code in chunk 6 calls gfx6 directly. (`docs/CODE_SIZE.md` C2 said chunk 6
  code must not touch the display; that was more cautious than the ports require.) It cannot see the heap, which holds the app
  arena and so every window and control of an app.
- **A cannot draw.** It reaches the display only through a crossing into K (section 5).
- `$7F` (2, 3 and 6 together) and `$FF` bit 7 (EXROM) are never used.
- **Proven so far:** A on three emulators (probe (a), **EMU**); reading chunk 6 (**EMU**, Arcade). **Executing in chunk 6 and
  drawing under `$73` are not proven**: slice B0 proves them.

## 3. Where code lives

| Place | Mapping | Holds | Bytes |
|---|---|---|---|
| **Pool** (0, 1, 4, 5) | K | gfx6 and its tables; the kernel (steps 3-4); **the crossing routine** (section 5); **the toolkit** (controls); the launcher | 4,483 free today; step 5's growth bounded in 6.1 |
| **Chunks 2-3** | A | **The shell, Calculator, Write**; the test cartridges' own code | 16,384; shell + Calculator + Write **EST** 11-12 KB |
| **Chunk 6** | R | Resources (icons, a second font, strings drawn by R code); later Paint's drawing core and, if the pool runs short, the kernel's init code (3.1) | 8,192; nothing required in step 5 beyond B0's test code |
| Chunk 7 | — | Never mapped: the stack and hot RAM | — |

**Why the toolkit stays in the pool:** a control's `M_DRAW` reads its fields (heap) and draws (display). Only K sees both.
- In chunks 2-3, every control drawn costs an up-call plus a down-call per gfx call: about 1.5-2 k T a control (**EST**), or
  about 40 k T for a 20-button Calculator repaint.
- In chunk 6 it cannot read the controls at all.
- In the pool, `W_UPDATE` draws controls with no crossing, whichever program owns them.

**Chunks 2-3 are one region, not a bank per program.** The DOCK port has one chunk 2 and one chunk 3, so the shell, Calculator
and Write are all present whenever A is mapped. Nothing is switched between programs; a program is just an entry point.

### 3.1 (option) Init code into chunk 6

`G_INIT`, `P_INIT`, `W_INIT`, the boot's tail and the `P_ARROW` image run once, at boot. They need only pool code, hot RAM and
the display, so they can run under R. That frees about 250-350 bytes (**EST**) at no run-time cost.

`G_PRESHIFT` stays: apps preshift icons into the heap. `MB_SET` stays too: menu tables are in the heap (rule 4), which R cannot
see. Recommended only when the toolkit's bytes show the need.

## 4. Rules

1. **Shadow first.** Every change of `$F4` stores `V_SHADOW_F4`, then does the `OUT`. Unchanged from `CLAUDE.md`.
2. **The ISR is unchanged.** It already maps K (`$33`) before `P_ISR` and `K_POLL`, and writes the shadow back to the port.
   That is correct under A and R as well.
3. **Banked code calls pool code only through the crossing** (section 5), except routines listed as A-direct or R-direct in
   section 5.4.
4. **Every pointer handed to the kernel must be visible under K.** That covers class descriptors and method slots, strings
   (titles, labels, button text), menu tables, view trees and gfx6 arguments. They live in RAM: the heap for an A program.
   **Never pass a pointer into chunks 2-3 or 6 to K code.**
5. **A program's RAM image.** A banked program assembles its K-visible data for its RAM address (sjasmplus `DISP`): its class
   descriptors with their thunks (5.3), strings and menu tables. At launch the kernel copies the image to the app arena's base
   and sets the arena's top past it. This runs under A, which sees both the image in 2-3 and the heap. Then it far-calls the
   entry.
6. **R code never touches the heap.** It passes K code only pointers into RAM outside `$C000-$DFFF`. It may pass an R-direct
   routine (5.4) a pointer into chunk 6: that is how R code draws its own strings and icons.
7. **Nothing writes into a mapped window.** That means no write to `$4000-$7FFF` under A and none to `$C000-$DFFF` under R.
   ZEsarUX writes through into the DOCK image (FEASIBILITY risk 8), so a stray write corrupts the cartridge there.
8. **No `DI` in crossing code.**

## 5. Crossings

### 5.1 The far call: `RST $28` with an inline target

Every crossing, in either direction, uses one routine:

```
    rst $28             ; 3 bytes at the call site, nothing per entry in the pool
    dw  target
```

`K_FAR`:
1. reads the target from the call site;
2. picks the mapping from the target's address: `$0000-$3FFF` and `$8000-$BFFF` give K, `$4000-$7FFF` gives A, and
   `$C000-$DFFF` gives R (a target at `$E000` or above is refused by the assembler macro);
3. pushes the caller's shadow;
4. sets the new mapping (shadow, then `OUT`) and calls the target;
5. on return, restores the caller's mapping (shadow, then `OUT`) and returns past the `dw`.

**Registers:**
- **In:** A, BC, DE, HL, IX and IY reach the target unchanged. F does not (flags are not arguments across a crossing).
- **Out:** A, F, BC, DE, HL and IX are returned exactly as the target left them; IY and the alternate set are preserved.
- **RAM:** 4 bytes of hot RAM (`K_FA` and a `JP nnnn`), used only between entry and the call, so nesting is safe. The ISR never
  uses them.
- **Stack:** 6 bytes per crossing level.

**Placement:** the vector at `$0028`, with the body (53 bytes as built in B0) in the free page-0 hole `$0068-$00FF`. That
costs nothing from the counted pool.

**Cost** (a round trip from the `RST` to the instruction after the `dw`, with the target a `RET`). Draft 1 counted 357-378 T
for a first version of the code. B0's version, counted and then measured on TSRun, is the same from every caller mapping:

| Target | B0 (**EMU**) | A direct `CALL` + `RET` |
|---|---|---|
| K (an app calling the kernel: the down-call) | 331 T | 27 T |
| A (the kernel calling an app) | 350 T | 27 T |
| R | 352 T | 27 T |

FEASIBILITY's "about 50 T a call" was optimistic: a crossing is about 300-325 T more than a direct call.

### 5.2 Down-calls (A or R code calling the kernel)

`rst $28 / dw G_FILL`, and so on. A send from banked code is `rst $28 / dw K_SEND` (`K_FAR` calls the `RST $08` routine at
`$0008`, and the method returns into `K_FAR`), so a kernel method never runs under A.

### 5.3 Up-calls (the kernel sending to a banked method)

A banked class's method slot points to a **4-byte thunk** in the program's RAM image:

```
th: rst $28
    dw  method          ; in chunks 2-3 (or 6)
    ret
```

`K_SEND` jumps to the thunk as to any method. **`K_SEND` is unchanged (87 T)**, so kernel-to-kernel sends cost nothing more.
The generator (`gen-classes`) emits the thunks for a program's classes into its image. Inherited kernel methods stay direct.

**Counted:** a send to a banked method that is a `RET` costs 87 + 350 + 10 = **447 T**, against 97 T for a kernel method.

### 5.4 Direct calls without a crossing (audited, then listed)

Under A or R, pool code may be called directly only if it touches nothing the mapping hides:
- **A-direct candidates:** `K_NEW`, `K_ALLOC`, `K_FREE`, `K_POST`, `K_ARENA` and `K_GETEV` (if it never paints).
- **R-direct candidates:** the gfx6 drawing routines, with pointer arguments outside the heap.

Slice B0 runs each candidate under its mapping with the hidden range watched (6.3). Only those that pass are listed here. Every
other routine is reached through `K_FAR`. Step 6's `desktop.json` records the list for each entry.

### 5.5 If the crossing bound is missed

The fallback is a per-entry pool stub (the mapping fixed in the stub, no address test): about 250 T, but about 8 bytes of pool a
kernel entry. That would be used only for the few hot entries a measurement points at.

## 6. Bounds

TSRun T-states, direct calls with a sentinel return, interrupts off so ISR time is excluded, unless stated.

### 6.1 Bytes

| Measure | Bound |
|---|---|
| `K_FAR` and its vector | <= 80 (B0: 56), inside page 0 |
| **Step 5's growth of the always-mapped pool** (crossing, toolkit, launcher, anything else) | **<= 3,400 (owner to set)**. **Report** each part |
| Pool free at the end of step 5 (reserve for step 6: jump table, app header) | >= 1,000 (follows from the line above) |
| Chunks 2-3, chunk 6 | the assembler `ASSERT`s 16,384 / 8,192; **report** each program's bytes |
| RAM image per program; thunks | **report** (4 bytes a banked method) |

### 6.2 Speed (each crossing measured before anything moves)

| Measure | Bound |
|---|---|
| `rst $28` round trip, target a `RET`, under each of the 9 (caller, target) mapping pairs | <= 400 (B0 counted 331 / 350 / 352) |
| A send to a banked method that is a `RET` (`RST $08` to the instruction after it) | <= 520 (**EST** 447) |
| Nested: K -> up-call into A -> down-call into K -> `RET` | **report** (**EST** about 700) |
| Whole ISR, entered under A and under R (pointer moving, input) | <= 12,000 (step 3's bound, unchanged) |
| `DI` in crossing code / frame interrupts lost over normal frames | none / 0 |
| Stack per crossing level | 6 bytes exactly |
| End to end: a 64 x 16 `Button` drawn through `W_DRAWVIEW` from K code, and from A code through `K_FAR` | **report** both |
| `W_UPDATE` of a window whose class is banked (one up-call for `M_DRAW`), against the same window with a kernel class | **report** the difference |
| `E_MOVE` over a banked view that overrides `M_EVENT` | **report** (the 3,900 bound is for kernel classes) |

### 6.3 Safety

- After every crossing, in both directions: the mapping during the target is the derived one, and after the return it is the
  caller's. Port = shadow at every instruction boundary, except between a shadow store and its `OUT`.
- No write to `$4000-$7FFF` while A is mapped, and none to `$C000-$DFFF` while R is mapped, over every B0 test. No read of
  them either (it would return DOCK bytes).

## 7. Tests (slice B0; the pattern of `tests/probe23.mjs` and `tests/review-inject.mjs`)

Written from this contract, never from the code.

1. **Registers:** random values in A, BC, DE, HL, IX and IY through all 9 mapping pairs. The target sees the inputs of 5.1, and
   the caller sees the target's outputs.
2. **Mappings:** the target and the caller each record the port and the shadow; they must equal section 2's values.
3. **Interrupt injection at every instruction boundary** of `K_FAR` and the thunk, entry and exit paths, for all 9 pairs:
   - the ISR runs under K: the pointer is drawn and erased correctly, and input is posted;
   - it returns with port = shadow;
   - the crossing still lands in the right mapping.

   This also closes `CLAUDE.md`'s note that the ISR rule was exercised only by about 900 interrupts, not by injection.
4. **Memory watch:** every TSRun memory access is checked against rule 7 and 6.3 for the whole run.
5. **The direct-call audit** (5.4): each candidate run under its mapping, with the hidden range poisoned and watched.
6. **Frames:** `V_FRAMES` rises by exactly 1 per normal frame, with A or R code running most of the time.
7. **Mutations:** the main model plants faults:
   - the shadow stored after the `OUT`;
   - the exit path not restoring the mapping;
   - `$C000` derived as K;
   - an ISR that assumes port = shadow.

   Each must be caught.
8. **Cross-emulator** (`tools/xemu/`, as probe (a)): a `bank5` self-test record identical on TSRun, ZEsarUX 13.0 and Fuse 1.9.1.
   - **Code executing in chunk 6, drawing directly** (R), shows on every emulator.
   - ZEsarUX's DOCK chunks 2, 3 and 6 are unchanged after the run.
9. **Bounds:** 6.1-6.2 as a table in `tests/bank-perf.mjs` (measured, bound, pass / MISSED / reported).
10. **Regression:** every step 3-4 suite, unchanged (`kern3`, `kern4` and the demos keep chunks 0, 1, 4, 5).

## 8. Slices and who does what (`CLAUDE.md`)

| Slice | Content | Who |
|---|---|---|
| **B0** | `src/kernel/far.asm` (`K_FAR`, the vector, the macro); test cartridge `bank5` (chunks 0-6), with test code in 2-3 and 6 and a banked class with thunks; tests 1-10; the measured costs. **Stop: the owner sees the numbers before anything moves** | Z80: main model. Tests and model: Sonnet. Runs: Haiku. Cross-emulator runners: Sonnet |
| B1 | Only if 6.1 needs it: the kernel's init code into chunk 6 (3.1) | Main model |
| Then | The toolkit contract, then the shell and Calculator contracts, each with its own interface section, using this contract's rules. Test cartridges from here on are 56 KB (chunks 0-6), their own code in 2-3 | — |

## 9. Decisions (owner, 2026-11-12: every recommendation taken)

1. **Placement (section 3):** the toolkit in the pool; the shell, Calculator and Write in chunks 2-3; chunk 6 for resources,
   later Paint's drawing core, and the init code if needed.
2. **The crossing (5.1):** one `RST $28` far call, the mapping taken from the target's address. The per-entry stubs (5.5) stay
   the fallback for a missed bound.
3. **The pool bound for step 5 (6.1):** growth <= 3,400 bytes, keeping >= 1,000 for step 6.
4. **Calculator:** an app in chunks 2-3, like the shell (option (a)).
5. **Init code to chunk 6 (3.1):** only when the pool runs short.

## 10. B0 interface (designed 2026-11-12, binding for the B0 code and tests)

The tests are written from sections 2, 4-7 and this section, never from the code. Names below are symbols in
`build/bank5/out.sym`.

### 10.1 Files and build

- `src/kernel/far.asm`: `K_FAR`, `K_FAR_END`, the constants `F4_K` / `F4_A` / `F4_R`, the macros `KFAR target` (3 bytes) and
  `KTHUNK method` (4 bytes).
- **Target `bank5`** (`node tools/build.mjs bank5`): `src/kern4.asm` with `BANK5 = 1`, DOCK chunks 0-6 (a 57,353-byte DCK). It is
  `kern4` plus:
  - `jp K_FAR` at `$0028` and `far.asm` at `$0068`;
  - `src/bank5k.asm` in chunk 1 after `K1_CODE_END`;
  - `src/bank5.asm` in chunks 2, 3 and 6.
- **`kern4` and `kern4demo` are byte-identical** to before B0: every `BANK5` addition is conditional.

### 10.2 Memory

| Where | What |
|---|---|
| `$F0D0-$F0D2` | `K_FJP`: `JP nnnn`. Boot writes `$C3` at `$F0D0`; each crossing writes the target |
| `$F0D3` | `K_FA`: A on entry |
| `$C000-$C0FF` | The RAM image (`B_IMG_ADDR`, `B_IMG_LEN` bytes), copied by `B_INIT` at boot. The app arena is `$C100-$DFFF` in `bank5` |
| `$E0A0` / `$E0A2` | `V_IRQA` / `V_IRQR`: words, frame interrupts whose ISR found the shadow `F4_A` / `F4_R` (the `bank5` ISR counts them; nothing else differs from `kern4`'s ISR) |
| `$E0A4` | `T_IN`, 14 bytes: what `t_regs` saw: HL, AF, BC, DE, IX, IY (words), then `V_SHADOW_F4`; byte 13 is not written |
| `$E0B2` | `T_OUT`, 10 bytes: what `t_regs` returns: HL, AF, BC, DE, IX (words) |
| `$E0BC-$E0CF` | The self-test's state (`B_GOT`, `T_STUB`, `B_IDX`, `B_EXP`, `B_FAILK`, `B_FAILP`, `B_ITER`) |
| `$FF00` | The record (10.5) |

**The image** holds two classes, copies of `kern4`'s test classes with banked methods:
- **`B_CLWIN`** (id 200, size 22, like `TWin`): Draw, Focus and Blur are thunks into chunk 2;
- **`B_CLCTL`** (id 201, size 17, like `TCtl`): Draw, Event, Focus and Blur are thunks.

The banked Draw, Focus and Blur methods (`b_wdraw`, `b_cdraw`, `b_focus`, `b_blur`) each cross back with `KFAR` to `kern4`'s
`t_wdraw`, `t_cdraw`, `t_focus` or `t_blur`. So a banked view logs and draws exactly as its `TWin` / `TCtl` twin, by one up-call
and one nested down-call. `b_event` is `OR A` / `RET` (not consumed), entered through the thunk `B_THEVENT`.

### 10.3 Callers and targets

| Mapping | Timing target (a `RET`) | Register target | Callers (each `KFAR target`, then `RET`) |
|---|---|---|---|
| K (pool) | `XT_K` | `XR_K` = `t_regs` | `CT_KK`, `CT_KA`, `CT_KR` (timing), `CR_KK`, `CR_KA`, `CR_KR` (registers) |
| A (chunk 2 callers, chunk 3 targets) | `XT_A` (`$6000`) | `XR_A` (`JP t_regs`) | `CT_AK` ... `CR_AR` |
| R (chunk 6) | `XT_R` (`$C000`) | `XR_R` (`JP t_regs`) | `CT_RK` ... `CR_RR` |

`CT_<from><to>` crosses from its own mapping to `XT_<to>`; `CR_<from><to>` crosses to `XR_<to>`. A caller must be entered with
`$F4` and `V_SHADOW_F4` both set to its own mapping.

### 10.4 End-to-end entries

- `B_BTN` (chunk 2): `KFAR W_DRAWVIEW`, `RET`. IX = the view.
- `B_RDRAW` (chunk 6): sets the clip to the whole screen, shields (16, 176, 192, 8), and draws `B_RSTR` (in chunk 6,
  `B_RSTR_N` codes) with `G_TEXTP` in SET at (16, 176) directly, under R. Then it unshields.

### 10.5 The self-test (`B5_START`, after boot's `EI`; `B5_MAIN` runs under A)

1. Clears the record's marker.
2. **Up-calls:** a `B_CLWIN` window at (64, 40, 192, 80), titled "Banked", tag 1, with a `B_CLCTL` child at (80, 64, 64, 16),
   tag 2. It is made by `K_NEW` and `K_ADDCHILD` in the app arena, opened with `W_OPEN` and painted with `W_UPDATE`, all
   through `KFAR`.
3. **R drawing:** `KFAR B_RDRAW`.
4. **Stress, 400 iterations** (`B5_N`) with interrupts on. Each iteration:
   - **the 9 register pairs**, through a RAM stub `rst $28 / DW CR_xy / RET`, entered from A with A = `$5A`, BC = `$1234`,
     DE = `$5678`, HL = `$9ABC`, IX = `$DEF0`, IY = `$1357`;
   - `T_OUT` = 10 bytes from (16 x pair + the iteration's low byte), in steps of 37;
   - **failure kinds:** 1 the outputs differ from `T_OUT`; 2 the inputs `t_regs` saw differ (F not checked); 3 the shadow
     `t_regs` saw is not the target's mapping; 4 the shadow after the return is not `F4_A`;
   - then about 3.3 k T of delay in A and about 3.3 k T in R (`B_RDELAY`).
5. **The record** (`t_record`, K), with the marker `$A5`, `$5A` written last:

   | Offset | Content |
   |---|---|
   | +2 | state: 1 pass, 2 fail |
   | +3 | the first failure's kind: 0 none, 1-4 as above, 5 no interrupt under A, 6 none under R |
   | +4 | word: iterations done (400) |
   | +6 / +8 / +10 | words: `V_FRAMES`, `V_IRQA`, `V_IRQR` (**report**; they differ between emulators) |
   | +12 / +14 | words: `T_LOGN`, and the sum of `T_LOG`'s 2,048 bytes |
   | +16 | word: the sum of the display's 12,288 bytes (`$4000-$57FF`, `$6000-$77FF`) |
   | +18 | the failing pair's index (0-8: KK, KA, KR, AK, AA, AR, RK, RA, RR) |

   After the display sum and before the marker, it draws "B0 PASS" or "B0 FAIL" with `G_TEXTP` at (320, 176), shielded, so
   an emulator that shows only the screen (Fuse) shows the verdict. Then the cartridge idles (`T_IDLE`) with interrupts on, so
   the tests can make direct calls as with `kern4`.

**TSRun, main model's smoke run (2026-11-12):** pass, 400 iterations, `V_FRAMES` 270, `V_IRQA` 213, `V_IRQR` 36, `T_LOGN` 2.
The banked window, its control and the chunk 6 line show as expected.

### 10.6 How the bounds are measured

- **Crossing round trip** (6.2 row 1): `traceCall` of `CT_<from><to>` with `$F4` = shadow = the caller's mapping, the sentinel
  return, interrupts off. Round trip = T - 10 (the caller's `RET`). After the return `$F4` and the shadow are the caller's
  mapping again.
- **Send to a banked method:** IX = a `B_CLCTL` instance, A = `M_EVENT`, `traceCall` of `T_SEND` under K. Subtract `T_SEND`'s own
  `RET` (10) and `b_event`'s `OR A` (4).
- **Nested:** `W_DRAWVIEW` of a `B_CLCTL` instance, against the same view built as a `TCtl`. The difference is **reported** as
  the cost of one up-call plus one nested down-call.
- **`B_BTN`:** a 64 x 16 `Button` in an open window. `traceCall(B_BTN)` under A, against `traceCall(W_DRAWVIEW)` under K. Both
  **reported**, and the screens after them must be equal.
- **`W_UPDATE` banked against kernel:** the same window and child built from `B_CLWIN` / `B_CLCTL` and from `TWin` / `TCtl`, each
  alone over the desk. **Report** both. The display, `T_LOG` and `T_LOGN` after them must be equal.
- **`E_MOVE`:** the 6.2 row, with the `B_CLCTL` child under the pointer: **report**.
- **ISR:** the whole ISR (`ISR_BODY` to its `RET`), entered with the shadow and `$F4` at each mapping, idle and with the pointer
  moving. It must stay <= 12,000.
- **Stack:** 6 bytes a level (`armStack` / `stackUsed` around `CT_KA` and around a nested call).

### 10.7 The memory watch (6.3, test 4)

The test wraps TSRun's `m.bus.read` and `m.bus.write`. For each access, M is the mapping `$F4` holds at that moment, and PC is
the address of the instruction being executed:
- **Under A,** a write to `$4000-$7FFF` is a violation. A read there is a violation unless PC is in `$4000-$7FFF` (A code
  fetching itself or reading its own data) or in `K_FAR..K_FAR_END - 1` (reading its call site).
- **Under R,** the same for `$C000-$DFFF`, with PC in `$C000-$DFFF`, in `K_FAR`, or in gfx6's code
  (`GFX6_CODE..GFX6_CODE_END - 1`): an R-direct routine reading the chunk 6 data it was handed (rule 6). Amended after B0's first
  run, which found `B_RDRAW`'s `G_TEXTP` reading its string from chunk 6, as 10.4 intends. The first draft forbade it.
- **Under K,** there is no rule.

The watch runs over the whole self-test and over every B0 test that runs code.

### 10.8 The direct-call audit (5.4, test 5)

- **Under A:** `K_NEW`, `K_ALLOC`, `K_FREE`, `K_POST`, `K_ARENA` and `K_GETEV`. `K_GETEV` is run with the posted queue, the ring
  and `W_DIRTY` each in turn non-empty.
- **Under R:** `G_SETCLIP`, `G_SETOP`, `G_FILL`, `G_FRAME`, `G_HLINE`, `G_VLINE`, `G_TEXT8`, `G_TEXTP`, `P_SHIELD` and
  `P_UNSHIELD`. String arguments are in hot RAM.

A routine passes when, under its mapping, the watch reports nothing, and RAM and the display afterwards equal the same call made
under K. The list of those that pass replaces 5.4's candidates in "As built".

## 11. As built

### 11.1 Slice B0 (2026-11-12)

**Every B0 bound passes, every test passes, and the crossing works on TSRun, ZEsarUX 13.0 and Fuse 1.9.1.** Code running in
chunk 6 and drawing straight onto the display under R (`$73`) is now proven on all three (**EMU**).

**Speed** (`node tests/bank-perf.mjs --seed 1` and `--seed 2`, identical; 21 rows, no bound missed):

| Measure | Measured | Bound |
|---|---|---|
| Round trip to K / A / R, from each of K, A and R | 331 / 350 / 352 | 400 |
| Send to a banked method that is a `RET` | 447 | 520 |
| Whole ISR from `$0038`, idle, under K / A / R | 8,623 / 8,656 / 8,656 | 12,000 |
| Whole ISR, pointer moving, button and 2 keys, K / A / R | 9,055 / 9,088 / 9,088 | 12,000 |
| Stack per crossing level, all 9 pairs | 6 | 6 |
| `DI` in the crossing / frame interrupts lost (583 frames) | 0 / 0 | 0 / 0 |
| `K_FAR` and its vector | 56 bytes | 80 |
| `W_DRAWVIEW` of a `TCtl` / the same as a banked `B_CLCTL` | 31,231 / 31,943 (+712: one up-call and one nested down-call) | report |
| `W_UPDATE` of `TWin` + `TCtl` / banked `B_CLWIN` + `B_CLCTL` | 100,005 / 101,365 (+1,360) | report |
| A `Button`: `W_DRAWVIEW` from K / `B_BTN` from A | 28,816 / 29,147 (+331) | report |
| `E_MOVE` to the handler, kernel child / banked child | 3,823 / 3,909 | report |
| Stack of `W_DRAWVIEW`, `TCtl` / `B_CLCTL` | 30 / 42 bytes | report |
| RAM image / thunks | 63 bytes / 5 x 4 | report |

The banked and kernel versions draw identical screens and identical `T_LOG`s.

**Tests** (`node tests/bank-b0.mjs --seed 1` and `--seed 2`: 11 of 11 groups each):
- **Registers:** 3,240 + 2,160 checks through the 9 pairs.
- **Mappings:** 7,560 checks.
- **Interrupt injection at every instruction boundary:**
  - 765 boundaries of the 18 callers, each injected with the pointer idle and moving (19,890 checks);
  - the thunk path, 47 boundaries;
  - a nested `W_DRAWVIEW`, 58 boundaries.

  After every injected ISR, port = shadow, and the display equals the same ISR run under K. This closes `CLAUDE.md`'s note that the
  ISR rule had only been exercised by about 900 interrupts.
- **Memory watch:** about 2.05 M accesses under A and 224 k under R, none violating 10.7 (amended).
- **Frames:** `V_FRAMES` rises by exactly 1 per frame over 403 frames.
- **The self-test:** passes. On TSRun: `V_FRAMES` 270, 213 interrupts under A, 36 under R.

**The direct-call audit (10.8):** all 16 routines pass, in 25 cases. The two controls are caught as intended: `G_FILL` under A and
`K_NEW` under R. **5.4's lists are therefore:**
- **A-direct:** `K_NEW`, `K_ALLOC`, `K_FREE`, `K_POST`, `K_ARENA`, `K_GETEV`.
- **R-direct:** `G_SETCLIP`, `G_SETOP`, `G_FILL`, `G_FRAME`, `G_HLINE`, `G_VLINE`, `G_TEXT8`, `G_TEXTP`, `P_SHIELD`, `P_UNSHIELD`.

  For these, string arguments may be in chunk 6 (rule 6), but never in the heap.

**Mutations** (the main model, `--patch`). Each is caught by tests 1-3 (and, for the first, by the watch):

| Mutation | Patch |
|---|---|
| The shadow stored after the `OUT` on entry | `$0087-$008B` reordered |
| The exit path not restoring the mapping | `$0095-$0099` set to `NOP` |
| `$C000` derived as K | `$0086` = `$33` |
| An ISR that does not map K before drawing | `$0211-$0214` set to `NOP` |

**Cross-emulator** (`tools/xemu/`: `bank5-ref.mjs`, `zesarux-bank5.py`, `fuse-bank5.sh`):
- **ZEsarUX 13.0:** 7 of 7 rows.
  - The record matches TSRun's, the settled display is identical byte for byte, and DOCK chunks 2, 3 and 6 are unchanged after
    the run.
  - 250 frames, 190 interrupts under A, 35 under R.
- **Fuse 1.9.1:** 4 of 4 rows. TSRun's settled screen, with "B0 PASS", is every hi-res frame from #459 to the end.

**Amendments that came with B0:**
- **10.7 / rule 6:** an R-direct routine may read the chunk 6 data it is handed. The first draft's watch forbade the drawing that
  10.4 intends.
- **10.2:** `T_IN`'s byte 13 is not written.
- **10.5:** the verdict is drawn on the screen for Fuse. The record's display sum is taken before it is drawn.
- **Regression:** `kern4` and `kern4demo` build byte-identical to before B0, and `kern3` is untouched. So the step 3-4 suites are
  unaffected, and they were not re-run.

**Who did what:**
- The main model wrote `far.asm` and `bank5`, the contract, the mutations, and the fixes to the watch rule and the runners.
- Sonnet wrote `tests/bank-lib.mjs`, `bank-b0.mjs`, `bank-perf.mjs` and the `tools/xemu` bank5 runners.
- The main model re-ran every one of them: both seeds, the two emulators, and the four mutations.
