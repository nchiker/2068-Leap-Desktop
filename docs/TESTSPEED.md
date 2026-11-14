# Test speed (contract, 2026-11-14; owner approved: "do your recommendations - you can take change into our TSRun copy")

The headless TSRun suites take many minutes for a full `desk5` run. This slice makes them faster **without cutting
coverage**: every suite keeps its checks, its check counts and its results. It follows what the Leap Arcade session measured
(Leap-IDE, branch `arcade-verify`, stage 0 "validation speed"); its files are read there, never edited from here
(CLAUDE.md). Anything copied is entered in `docs/PROVENANCE.md`.

It runs after the W4 tests are checked and before the app library.

## 1. What it builds

| Step | Change | Arcade's measure |
|---|---|---|
| S1 | **Screen drawing off.** TSRun paints its frame buffer (`m.pixels`) every frame, even headless. Test machines call `M.setVideoOn(m, false)` unless a check reads `m.pixels`. Every read of `m.pixels` goes through a helper that throws when drawing is off. TSRun has no memory contention, so T-states are unchanged. | 21-39 % of the emulated time; 22-27 to 41-47 MT/s |
| S2 | **Boot once, restore per machine**, only where it pays. First count the boots per suite and the frames before the cartridge first writes port `$F4` or `$FF`, found by wrapping `m.bus.ioWrite`, not hard-coded. Then snapshot the shared ROM boot once per process and restore it in place per machine. | one suite: 216 s to 29 s |
| S3 | **Closed-form silent AY** in our TSRun copy: Arcade's commit 89208e8 "AY: closed-form silent advance" (`tsrun/ay.js` only), on 9893b46, our base. It is taken once Arcade pushes it to the fork. Arcade's proof test (`tests/tsrun-ay-silent.mjs`, 114,916 checks against the old per-tick code) is copied in with it. | 21-27 % off whole suites |
| S4 | **A parallel runner,** `tools/runtests.mjs`: builds the cartridges that the chosen suites need once, then runs the suites in a pool (jobs = cores, fewer when memory is short), longest first from recorded times. A suite that builds a cartridge itself runs alone. | — |

## 2. The rule it changes (owner approved, 2026-11-14)

CLAUDE.md's "never run two tests of the same cartridge at once" applies only to suites that **build** a cartridge.

- **May run side by side:** suites that only read a prebuilt `build/<name>.dck` and its symbols, such as every `desk5`
  suite through `loadDesk5`.
- **Run alone:** suites that build, through the runner or by hand.

## 3. Measures and bounds

| Measure | Bound |
|---|---|
| Each suite's pass lines, groups and check counts, before and after each step | **identical** |
| Every T-state row of `calc-perf`, `shell-perf`, `tk-perf`, `wr-perf` | **identical** to before |
| Each suite's time (wall and CPU), and the whole `desk5` run's wall time, before and after each step | **report** |
| S1: emulated MT/s of one long suite, before and after | **report** |
| S2: boots per suite; frames shared by every boot | **report** (S2 is built only where it saves time) |
| S3: Arcade's proof test | passes |

## 4. Tests

- **Before S1:** the baseline of every suite: pass lines, check counts, times.
- **After each step:** the same run, compared line by line.
- **S2:** a proof that the full machine state at the cartridge's entry, and 50 frames later, equals a cold boot's, as
  Arcade's `boot-snapshot.mjs` does.
- **S4:** a full run through the runner, compared with the one-at-a-time run.

## 5. Arcade's whole-run figure and a trap (from the Arcade session, 2026-11-14)

**The whole run,** with everything together (video off, boot once, silent AY, a faster interpreter, a sharded pool), on 8
cores with 8 jobs:
- **105 suites and 1,448 mutants:** 84 min wall, against a baseline of 108 min with 4 jobs, in which three suites never
  finished.
- **The suites alone:** about 8 min wall, against about 17 min before.
- **Raw speed:** 41-47 MT/s per process with video off, against 22-27 MT/s with it on.

**The trap: wall-clock checks under parallel load.** Under 8 jobs, a headless-Chrome page wait of 8 s timed out, and an
"under 20 ms" check failed.
- Here, `web-smoke`'s page waits get long timeouts.
- Any wall-clock check is measured as the best of N, spread over time.
- The T-state rows of the perf suites are not affected: they are counted, not timed.
