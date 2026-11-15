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
