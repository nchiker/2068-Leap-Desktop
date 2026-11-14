# Provenance of reused code

Leap Desktop reuses code from the owner's other Leap projects. Those projects are never edited from here: files are **copied**
into this repo, and each copy is listed below with its source and the source's commit. A file changed after copying says what
changed. Leap V2 (`~/2068-Leap`) is frozen.

| File here | Source | Source commit | SHA-256 at copy (first 16) | Changed since copy |
|---|---|---|---|---|
| `tools/mkdck.mjs` | `~/Projects/Leap-IDE/arcade/spike/xip/mkdck.mjs` (nchiker/2068-Leap-IDE) | `fead962` | `fa6405dff784c51d` | no |
| `src/font.inc` | `~/Projects/Leap-IDE/arcade/runtime/v2/font.inc`, itself generated from `~/2068-Leap/kernel/graphics/graphics.asm` `FONT_TABLE` (Leap V2, MIT) by `arcade/tools/gen-font.mjs` | Leap-IDE `fead962`; 2068-Leap `29356c7` | `86124c45869ae676` | no |
| `src/spike6.asm` `live_input` (the joystick read only) | `~/Projects/Leap-IDE/arcade/runtime/v3/api.asm` `RT_STICK` (itself Leap V2's `BUILTIN_FN_STICK`) | Leap-IDE `b81f8fd` | (a routine, not a file) | yes: no `DI` / `EI` (the demo's ISR never selects an AY register), result bits rearranged to the demo's u d l r f, ORed with the keys |
| `tests/tsrun-ay-silent.mjs` | `~/Projects/Leap-IDE/tests/tsrun-ay-silent.mjs` (nchiker/2068-Leap-IDE), the proof of TSRun's closed-form silent AY (`6ccf56e`) | Leap-IDE `b4cdf2d` | `2fc3cf9dac1416b0` | no |

## Submodules

| Path | Upstream | Pinned commit | Why this commit |
|---|---|---|---|
| `tsrun/` | https://github.com/nchiker/TSRun (fork of josef-jelinek/TSRun) | `6ccf56e` | Leap-IDE's pin (`9893b46`) plus two local commits for Leap Desktop: the Kempston mouse (`d9302b8`, step 4) and the host bridge on ports `$6D` / `$6F` (`b4dc564`, `docs/FILES.md` 4.1). Both are off by default (`m.mouse.attached`, `m.host`), so Leap-IDE's behaviour is unchanged. Pushed to the fork (2026-11-13). Moved on to `6ccf56e` (2026-11-14, TESTSPEED S3): the fork's main, `b4dc564` plus Arcade's closed-form silent AY (`ay.js` only) |

TSRun's own code has no licence file in the fork. Its ROM licences are in `tsrun/roms/README.md` (TS2068 ROMs: free for
non-commercial use / abandonware). This repo uses TSRun as a submodule and does not copy it.
