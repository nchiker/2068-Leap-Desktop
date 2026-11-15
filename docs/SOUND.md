# Sound (contract, draft 1, 2026-11-15; owner chose it: "1,4,5")

**What:** short UI sounds on the TS2068's AY chip (ports `$F5` register, `$F6` data; the kernel keeps `K_AYREG`, the register latch's shadow, and the ISR puts it back). Polish, not a sound engine: one voice (channel A), tone only, a few fixed sounds. Built from Arcade's AY ideas
(`~/Projects/Leap-IDE/arcade/runtime/v2/sound.asm`, read-only; copy with a `docs/PROVENANCE.md` entry if any code is taken). The browser page has sound on, so the owner hears it; tests read the AY registers.

## 1. The calls and the sounds
- **`K_BEEP`** (pool, `KFAR` or `call`): A = a sound id. Starts the sound: channel A's tone period (registers 0, 1), its volume (register 8) and the mixer (register 7: tone A on, noise off, the other channels as they were). A sound in progress is replaced. Nothing when sound is off.
- **The ISR's tick** (`K_POLL`'s frame work, pool): each frame the sound's remaining frames count down; at 0 the volume is set to 0. About 25 T a frame when idle.
- **The sounds** (a 4-byte row each: period word, volume, frames): 1 **click** (a button press: a high short tick, about 2 frames), 2 **select** (a menu item chosen: 3 frames), 3 **alert** (an alert or ask dialog opens: two-tone, 12 frames, the second tone by the tick), 4 **error** (a refused save or a failed read: low, 15 frames), 5 **win** (the puzzle: a rising run, 20 frames). The table is data: sounds are added by rows.
- **Where it is called:** `Button` presses (the toolkit), a menu item chosen (`menu.asm`), `AL_ALERT` / `AL_ASK` opening, Paint's "Fill too complex" and "Too big to undo", the puzzle. A program calls `K_BEEP` itself for its own sounds.
- **On / off:** `K_SOUND` (a byte, 1 at start); the shell's Leap menu gets "Sound Off" / "Sound On" (the item shows the other state, as Options' Filled / Hollow do). The setting is kept while the machine runs (not saved to a file).

## 2. Numbers to measure and bounds
| Measure | Bound |
|---|---|
| Pool bytes (`K_BEEP`, the tick, the table, `K_SOUND`) | <= 300 (**report**; EST 250) |
| The tick, no sound playing / playing, T a frame | <= 60 / <= 120 |
| `K_BEEP`, T | <= 400 |
| Frames lost, DI held | 0 |
| Every existing suite | passes, the screens identical (a sound writes no display byte) |
| AY registers while no sound plays | volume 0, as at boot |

## 3. Tests (Sonnet)
A model of the AY writes (register, value, frame) for each event; `tests/snd-s1.mjs`: every sound's registers frame by frame (period, volume, mixer, the volume 0 at the end), a sound replaced by another, off / on through the Leap menu (the item's text, no write when off), the events (a button press, a menu choice, an alert, the Paint messages), the ISR's `K_AYREG` shadow restored, no DI, the stack. ZEsarUX runner: the AY registers equal TSRun's after a click.

## 4. Questions for the owner (recommendations first)
1. **Which events sound?** (Recommended: the five above; no sound per key press or per mouse move.)
2. **Default on?** (Recommended: yes, with the Leap menu toggle; the browser page may be muted by the browser until the first click.)
3. **Volume:** a quiet level (AY volume 8 of 15). Agreed?

## 5. Owner's decisions (2026-11-15: "how about if we just do - Sound: ...")
- **The events:** a button press (a `Button` activated), a menu choice, an alert (an alert or ask dialog opening), an error, the puzzle's win. **On by default**, with a **"Sound Off" item in the Leap menu** (the one item, its text "Sound Off" while sound is on and "Sound On " while it is off: the menu's record is in RAM, so the program rewrites the 9 characters). Volume quiet (AY 8 of 15).
- **Reading "error" (the builder's choice, to be amended if the owner wants more):** the alert sound plays on every `AL_ALERT` / `AL_ASK`, which already covers the file errors of Notepad and Paint (they are alerts); the separate **error sound** is Paint's refusal messages ("Too big to undo", "Fill too complex", "Not built yet"), played by `pn_msg`.
- **The sounds chain** (a row has a next-sound id, 0 = none): so the two-tone alert and the rising win are rows, not code. A row is 5 bytes: period word, volume, frames, next.
- **Where it lives:** pool, `src/kernel/sound.asm`, behind a `SOUND` build switch (`desk5` defines it); `K_BEEP` is callable by `call` under K and by `KFAR` from A. Writes to the AY set `K_AYREG` **before** each `OUT` (the shadow rule), and the mixer value is `$3E` (tone A only; bits 6 and 7 stay 0: the joystick port is an input).

## 6. As built (2026-11-15; the reference for the tests)
**Files:** `src/kernel/sound.asm` (pool, chunk 5 after the launcher; 175 bytes: `K_BEEP`, `snd_play`, `snd_w`, `K_SNDSET`, `K_SNDTICK`, `SND_TAB`), `DEFINE SOUND` in `desk5.asm`; hot RAM `K_SOUND` `$E084`, `K_SNDN` `$E085`, `K_SNDX` `$E086`; `K_SOUND` = 1 at boot.
**The calls:** `K_BEEP` (A = id 1-9; keeps every register but AF; nothing when `K_SOUND` = 0); `K_SNDSET` (A = 1 on, 0 off: off sets `K_SNDN` = 0 and writes AY register 8 = 0); `K_SNDTICK` is called by the frame ISR after `K_POLL`.
**A sound** (`snd_play`): `K_SNDN` = 0 first, then AY registers **7 = `$3E`**, **0 = period low**, **1 = period high**, **8 = volume** (each `OUT` of the register select preceded by `K_AYREG` = the register), then `K_SNDX` = the row's next id and `K_SNDN` = the row's frames last.
**The tick:** `K_SNDN` = 0: nothing. Else `K_SNDN` is decremented; at 0: `K_SNDX` non-zero starts that row (`snd_play`), else register 8 = 0.
**The table** (period, volume, frames, next): 1 click (60, 8, 2, -), 2 select (90, 8, 3, -), 3 alert (125, 8, 6, 6) then 6 (165, 8, 6, -), 4 error (500, 8, 12, -), 5 win (125, 8, 3, 7), 7 (94, 8, 3, 8), 8 (74, 8, 3, 9), 9 (62, 8, 10, -).
**Where it is called:** `b_click` (a `Button` pressed, by mouse or key: id 1, before the press is drawn), the menu's `.choose` (id 2, when an item was highlighted, before `E_MENU` is posted), `AL_ALERT` and `AL_ASK` (id 3, at the start of the call), Paint's `pn_msg` (id 4: "Not built yet", "Too big to undo", "Fill too complex"). The puzzle will call id 5.
**The Leap menu** has an 8th item (id 8, 9 characters at `S_SNDTXT` in the shell's image): "Sound Off" while sound is on, "Sound On " while off; choosing it calls `K_SNDSET` with the opposite and rewrites the text.
**Observed (TSRun, 2026-11-15):** About from the Leap menu: frame 156 the select row (r7 62, r0 90, r1 0, r8 8) then at once the alert (r0 125 ...), frame 162 the alert's second tone (r0 165), frame 168 r8 = 0; ENTER on the alert's OK: r0 60 at the press, r8 = 0 two frames later; the toggle: the select sound then r8 = 0; with sound off nothing is written.
**Pool bytes:** 175 in `sound.asm` plus the hooks (`b_click` +5, menu +5, the ISR +3). **Other targets** (`hello`, `probe23`, `gfx6t`, `spike6`, `kern3`, `kern3demo`, `kern4`, `kern4demo`, `bank5`) are byte-identical (the hooks are under `IFDEF SOUND`).
