# The file manager and the file dialog (contract, draft 1, 2026-11-15; owner chose it: "1")

**What:** (a) a **shared file dialog** (`AL_FILEDLG`): a modal list of the files, used by Notepad and Paint for Open and Save instead of the browser picker and the name dialog; (b) a **Files program** (program 6): a window listing the files with sizes, Open, Rename, Delete; double-clicking a `.txt` or `.pbm` starts Notepad or Paint on it. The browser page gets a **virtual disk** (kept in the page's storage), and later the TS-Pico driver answers the same calls from its SD card (`tpi:dir`, `tpi:chopen`, the delete and rename commands), so nothing in the programs changes.

## 1. The file interface grows (`docs/FILES.md`)
New host commands on the bridge (`$6F` command, `$6D` data), each answered in the `OUT` like open / read / write:
| Cmd | Then | Answer |
|---|---|---|
| 6 dir | `OUT $6D`: the first entry wanted (a word) | status 1 and a count (a word), then up to 32 entries of `name` (a length byte and 30 codes) and `size` (a word, saturating at 65,535), or 7 when none are left |
| 7 delete | name length, name | 1, or 3 (no such file) |
| 8 rename | old length and name, new length and name | 1, or 3 (no such file or the new name is taken or refused) |
`FS_DIR` (HL -> a buffer for 32 entries of 34 bytes, DE = the first entry wanted: BC = the count), `FS_DELETE` (HL -> a name), `FS_RENAME` (HL -> the old name, DE -> the new): `files.asm` (DOCK 2-3), about 150 bytes. The mode bits of `FS_OPEN` are as now.
**The virtual disk (the page, `web/fshost.js`):** a name -> bytes store in `localStorage` (or IndexedDB for files over its limit; **about 5 MB**; a refused write is status 6, "no room"). `Save` writes it and **also** offers the download as today when "Download copy" is on in the page (the page's switch; off by default once the disk exists). Files the user brings in through the picker are added to the disk. A page button "Export disk" downloads every file (one `.zip` is not needed: one file each). Headless tests get a Map-backed fake as today.

## 2. The file dialog (`AL_FILEDLG`, pool code behind a `KFAR` from A programs)
A modal `Dialog` (256 x 144): a `List` of names with their sizes (`name  size`), a `Field` for the name (Save), buttons Open / Save and Cancel, a `VScroll`. Open: choose and press Open, or double-click, or ENTER; Save: choose a row to fill the name or type one; an existing name asks to replace (`AL_ASK`-style). The extension rule (`AL_EXTNAME`) as now. The list is read with `FS_DIR` when the dialog opens and after each change. Notepad's Open / Save and Paint's move onto it (their own name dialogs and the `FS_PICK` call stay as the fallback when `FS_DIR` is refused with status 0, i.e. a machine with no file host).
**`List`** returns to `desk5` (it is a build switch, SIZE 6): +676 pool bytes.

## 3. The Files program (program 6)
- `CWindow` "Files" (about 320 x 144): a `List` of the files (name, size, 16 rows, a `VScroll`), buttons **Open**, **Rename...** (the name dialog), **Delete** (an `AL_ASK` "Delete the file?"), and a status line ("12 files, 31 KB"). A K-resident program (`docs/SPACE_PLAN.md`).
- **Open** (or a double-click, or ENTER) on a `.txt` starts Notepad, on a `.pbm` Paint, with the file: **a launch argument** (the file's name in a kernel buffer `K_ARG`, 31 bytes in the app arena's header; `K_LAUNCH` keeps it across the arena reset) that Notepad and Paint read at start and open (their `wr_open` / `pn_open` read a given name instead of asking `FS_PICK`). Other names: the alert "No program opens this file." The Files program restarts when the program quits (as the shell does).

## 4. Numbers to measure and bounds
| Measure | Bound |
|---|---|
| Pool bytes: the dialog + the Files program + the host plumbing (+ `List`) | <= 2,900 (**report**; EST 2,100 + 676) |
| DOCK 2-3: `FS_DIR` / `FS_DELETE` / `FS_RENAME` | <= 200 (**report**; EST 150) |
| Opening the dialog (the `FS_DIR` of 32 entries and the first draw), the click to HALT | <= 700,000 T |
| Scrolling the list one row | <= 120,000 T |
| `FS_DIR`, 32 entries, host answered | <= 250,000 T |
| Stack, all paths, crossings included | <= 128 |
| Frames lost, DI held | 0 |

## 5. Slices and tests (Sonnet)
F1 the host commands, `web/fshost.js` (the virtual disk, a fake with limits), `FS_DIR` / `FS_DELETE` / `FS_RENAME`, `tests/fs-f2.mjs` (the bridge, every command, 0 / 1 / 32 / 33 / 100 entries, names refused, delete and rename of missing files, status codes) and a `web-smoke` row. F2 `AL_FILEDLG` and the two programs on it: `tests/fd-d1.mjs` (the dialog's screen against a model, Open and Save flows, replace, cancel, the fallback with no host), the Notepad and Paint suites' Open / Save groups updated. F3 the Files program: `tests/fm-m1.mjs` (the list, Open by extension with the launch argument, Rename, Delete, the status line, a dragged window). One regression after each slice; the ZEsarUX runner gains a Files session.

## 6. Questions for the owner (recommendations first)
1. **The virtual disk in the page's storage** (about 5 MB, kept between visits). Approved? (Recommended: yes; without it a file manager has nothing to manage in the browser.)
2. **Download on Save:** keep downloading a copy when you Save? (Recommended: off once the disk exists, with the "Export disk" button, so a Save does not pop a download each time.)
3. **Launch by extension** (a kernel launch argument, `K_ARG`). Approved? (Recommended: yes; it is the point of a file manager.)
4. **Notepad and Paint use the new dialog by default** (the old picker stays as the fallback). Approved?
