# Files: contract (draft 1, 2026-11-12, owner approved)

Roadmap step 5 (`docs/FEASIBILITY.md`): how programs open and save files. Decided by the owner (2026-11-12, `docs/WRITE.md`
12.14): **one desktop file interface, shaped like TS-Pico's channel calls; for now the test page answers it through the
browser, as Leap-IDE's Open and Save do; later a TS-Pico driver answers the same calls**, so programs do not change. This
replaces "tape services before W3". Marks as in FEASIBILITY: **EMU** measured, **EST** estimated.

Style as `docs/WINDOWS.md`: every number in section 7 is a bound. **A missed bound is reported with its numbers before anything
is changed, and the engineer never weakens a bound.** Figures marked **report** are measured and written down, not judged.

## 1. What it builds

- **`FS_` calls** (section 2): pick a file, open one by name to read or write, read and write bytes, close. One file open at a
  time. Programs (Write in W3, Paint later) call nothing else for files.
- **The browser backend** (section 4): a small Z80 module that speaks a **host bridge** (two emulator-only I/O ports), and the
  JavaScript that answers it: TSRun gets the ports and a `host` hook; the test page (`web/`) supplies the browser side
  (the file picker, downloads).
- **Later, not built here:** the TS-Pico backend (section 6). The `FS_` calls are chosen so that it fits.

**Out:** several files open at once; directories, delete and rename (TS-Pico has them: a later file manager); real tape.

### 1.1 What the surveys found (2026-11-12, Sonnet, checked by the main model)

- **Leap-IDE:** Open and Save are page buttons. Save makes a `Blob` and clicks a link with `download`; Open clicks a hidden
  `<input type=file>`. The emulated machine takes no part, so only the browser half carries over.
- **TS-Pico** (`~/Projects/TS-Pico-Study`, `upstream/.../docs/PROTOCOL.md`):
  - ports `$0E` (data) and `$0F` (status, SYNC); text commands: `tpi:chopen <mode> <path>`, `tpi:chrd`, `tpi:chwr <hex>`,
    `tpi:chclose`, `tpi:dir`;
  - a status byte: 1 OK, 3 bad or missing name, 6 no room, 7 end of file, 0 no answer;
  - no ROM needed; interrupts may stay on; about 47 us a byte, plus 1-4 s to write the SD card;
  - "text" mode turns CR into the card's line ends.
  - Tried in an emulator fork and on a test panel, never on a real board. TSRun has no TS-Pico, and it decodes every even port
    as the keyboard, so `$0E` cannot be the bridge.

## 2. The interface (`FS_` calls, mapping A, interrupts on)

Called by `call` from DOCK 2-3 code (section 3). Names and buffers are in RAM that mapping A sees (the app arena or the
program's image). Every call returns **carry clear and A = 1 (OK)**, or **carry set and A = a status** (section 2.1).
They preserve IX, IY and the alternate set.

| Call | In | Out (OK) | Notes |
|---|---|---|---|
| `FS_PICK` | HL -> a name buffer (32 bytes) | the buffer holds the chosen file's name (a length byte, then the codes) | The user chooses a file to read. Waits (with `HALT`, interrupts on) until chosen or cancelled; BREAK or ESC cancels |
| `FS_OPEN` | HL -> a name (length byte, codes), A = mode | BC = the file's length in bytes (reading; 0 when writing) | Mode bit 0: 1 write (create or replace), 0 read. Bit 1: 1 binary, 0 text |
| `FS_READ` | DE -> a buffer, BC = bytes wanted (1-65,535) | BC = bytes read (fewer only at the end) | Status 7 when no byte is left |
| `FS_WRITE` | HL -> bytes, BC = how many (1-65,535) | | |
| `FS_CLOSE` | | | Writing: the file is finished (the browser backend: the download starts). Harmless when none is open |

- **Names:** 1-30 codes from 32-126, none of `/ \ : * ? " < > |` (FAT-safe, as TS-Pico's paths). Others give status 3.
- **Text mode** (the backend's job, as TS-Pico's):
  - writing, each 13 becomes the host's line end (the browser: LF);
  - reading, CR LF, LF and CR each become 13; TAB becomes a space; other codes below 32 are dropped; codes above 126 become
    `?`. The length `FS_OPEN` gives is after this.
- **Binary mode:** bytes as they are (for Paint later).

### 2.1 Status codes (TS-Pico's numbers, so that its backend passes them through)

| A | Meaning |
|---|---|
| 1 | OK |
| 3 | No such file, or the name cannot be used |
| 6 | No room |
| 7 | End of file |
| 12 | Cancelled (by the user, in `FS_PICK`) |
| 0 | No answer (no backend: a real TS2068 without the bridge) |

## 3. Where things live

| Where | What |
|---|---|
| DOCK 2-3 | `src/apps/files.asm`: the `FS_` calls and the browser backend (assembled by `desk5` after Write; any banked program may call it). **EST** 250-350 bytes |
| Pool | **0 bytes** |
| TSRun (`tsrun/machine.js`) | the bridge ports and `m.host` (section 4.1). The submodule gets a commit, as for the Kempston mouse |
| Test page (`web/main.js`, `web/index.html`) | the browser side (section 4.2) |

## 4. The browser backend

### 4.1 The host bridge (emulator only)

Two odd ports, so that TSRun's keyboard decoding (every even port) and TS-Pico (`$0E` / `$0F`) are not touched:
- **`$6F` command / status:** `OUT` starts a command (below); `IN` gives the status: bit 7 = busy, bits 0-6 = the status of
  the last command (2.1). With no host attached it reads `$FF` (a floating bus): the Z80 module treats that as status 0.
- **`$6D` data:** `OUT` gives the host a byte; `IN` takes the next byte the host has for the Z80 (`$00` when there is none).

| Command (`OUT $6F`) | Then | The host's answer |
|---|---|---|
| 1 pick | | busy until chosen or cancelled; then 1 and the name on `$6D` (a length byte, then codes), or 12 |
| 2 open | `OUT $6D`: mode, name length, name codes | 1 and the length on `$6D` (two bytes, low first), or 3 |
| 3 read | `OUT $6D`: count low, count high | 1 and up to that many bytes on `$6D`, the count read first (two bytes); or 7 |
| 4 write | `OUT $6D`: count low, count high, the bytes | 1 (or 6) |
| 5 close | | 1 |
| 0 abort | | 12: a pick in progress is cancelled; the open file is dropped |

- TSRun calls `m.host.command(n, bytesIn)` when a command's bytes are complete and queues what it returns. Headless tests
  give `m.host` a fake (files in a JS map); the page gives the browser one. `m.host` absent: status 0.
- Every command but pick answers within the `OUT` (the busy bit is never seen).

### 4.2 The page

- **Pick:** `input.showPicker()` (the file input, `accept` none). Browsers allow it only shortly after a click or key press;
  the user has just chosen "Open..." with one, so it normally works. When it throws (no user activation), a bar appears above
  the screen: "Write wants a file: [Choose...] [Cancel]". The input's `cancel` event, or the bar's Cancel, answers 12.
- **Open / read:** the picked file's bytes, text-converted (2), held until close.
- **Write / close:** the bytes are collected; at close a `Blob` is downloaded under the name (Leap-IDE's `download()`), as
  `text/plain` for text, `application/octet-stream` for binary.
- **Limit:** 65,535 bytes a file (the length is two bytes).

## 5. Behaviour of the Z80 module

- **Interrupts stay on.** A wait (pick) is a loop of `HALT`, reading the keyboard state for BREAK / ESC (`K_GETEV`: any
  `E_KEY` ESC or BREAK sends abort; other events are discarded while the picker is up).
- Reads and writes move one byte per `IN` / `OUT` (no `INIR` / `OTIR`, as TS-Pico requires).

## 6. TS-Pico later (for the record; not built)

| `FS_` call | TS-Pico |
|---|---|
| `FS_PICK` | a desktop dialog: a `List` of `tpi:dir` names, Open and Cancel (the browser's picker has no TS-Pico twin) |
| `FS_OPEN` | `tpi:chopen r` / `w`, `b` for binary; the length by `tpi:chwr 170000` then `tpi:chrd` |
| `FS_READ` / `FS_WRITE` | `tpi:chrd` (255 a call) / `tpi:chwr` (about 128 a call, as hex) |
| `FS_CLOSE` | `tpi:chclose` |
| Status | passed through |

## 7. Bounds (TSRun, T-states)

| Measure | Bound |
|---|---|
| `src/apps/files.asm` bytes | **report** (**EST** 250-350) |
| Pool bytes | **0** |
| `FS_READ` / `FS_WRITE` of 5,120 bytes, from the call to the return | **report** each (**EST** about 60 T a byte: 300 k) |
| `DI` / frame interrupts lost (a pick held for 5 s included) | none / 0 |
| Stack of any `FS_` call | <= 32 bytes |

## 8. Tests (Sonnet, from this contract)

1. **TSRun's bridge** (`tests/fs-bridge.mjs`): the ports with a fake host: every command, the busy bit, `$FF` with no host,
   abort.
2. **The module** (`tests/fs-f1.mjs`, on `desk5`): every `FS_` call against a fake host holding files: round trips of text and
   binary files (0, 1, 255, 256, 5,120, 65,535 bytes), names refused, statuses, pick and cancel (by the host and by BREAK /
   ESC), the stack, `DI`, interrupts over a 5 s pick.
3. **Text conversion** (JS, the page's code): CR LF, LF, CR, TAB, control codes, codes above 126.
4. **The page** (`tests/web-smoke.mjs` extended): a Write save produces a download of the right bytes; the picker fallback bar
   appears when `showPicker` throws.

## 9. Decisions (owner, 2026-11-12: "I approve"; every recommendation taken)

1. **Ports `$6D` / `$6F`** for the bridge (odd, unused by the TS2068, TSRun or TS-Pico).
2. **`FS_PICK` waits** (the program stops until the user chooses), with BREAK / ESC to cancel. *Alternative:* returns at once
   and the program polls (more code in every program).
3. **The fallback bar** when the browser refuses the picker.
4. **Text files are plain text with LF line ends**, so they open in any editor; text mode converts.
5. **The module in DOCK 2-3** (A), outside Write's 7,000-byte budget. *Alternative:* inside Write (simpler build, but Paint
   could not share it).

## 10. As built (2026-11-13)

- **TSRun:** `m.host = { command(n, bytes, answer) }` (submodule commit `b4dc564`, local, not pushed). The host answers at
  once (`{status, data}`) or later through `answer()` (the pick); a new command drops a pending answer.
- **The host:** `web/fshost.js`, shared by the page and the headless tests. Reading a file longer than 65,535 bytes (after
  text conversion) gives status 3. A picked file's name is made usable (other codes become `_`; a name over 30 keeps an
  extension of up to 8).
- **The page:** a hidden file input and `showPicker()`, the fallback bar (`#fsbar`), downloads by `<a download>`.
- **`src/apps/files.asm`:** 181 bytes; `FS_READ` / `FS_WRITE` at 50 T a byte; stack 4 bytes. A name longer than 30 from the
  host is refused (3).
- **Tests:** `fs-bridge` 206, `fs-text` 120, `fs-f1` 8 of 8 groups, `web-smoke` 35.
