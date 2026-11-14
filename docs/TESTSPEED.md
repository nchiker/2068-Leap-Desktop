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

## 6. Sharing the TSRun fork with Leap-IDE (agreed with the Arcade session, 2026-11-14, at the owner's request)

**State:**
- `6ccf56e` ("AY: closed-form silent advance") is final on `nchiker/TSRun` main, on top of our two commits (Kempston
  mouse, host bridge).
- No other core changes are planned.
- Video off is TSRun's existing `setVideoOn(m, false)`. Snapshot and restore stay in each project's own test harness (Arcade's
  is `arcade/tests/fast-boot.mjs`), to be copied, not imported.
- Arcade's proof test `tests/tsrun-ay-silent.mjs` imports only `tsrun/ay.js`. It holds its own copy of the old per-tick
  code. It takes about 40 s; `AY_SEEDS` defaults to 4000, and `AY_BENCH=0` skips the timing section.

**Rules both projects keep:**
1. TSRun main moves only by fast-forward: never rebase or force-push it.
2. Each project pins a commit that is on main, never a side branch.
3. Before pushing to TSRun main, `git fetch` and build on the current tip. If main moved, rebase the local commit (never
   main) and re-run your own checks.
4. Every core change is off by default, or proves identical behaviour, so the other project can adopt it without
   re-testing behaviour.
5. Each project verifies its own move of the pin before committing the bump.
6. Push TSRun first, then the project that pins it.
7. Tell the other session after pushing to TSRun main. A core change that one project wants (for example video off or
   snapshots in `machine.js`) is proposed to the other session first.

**S3:** LeapG moves its pin to `6ccf56e` once the open branches are merged. It first copies the proof test (with a
`docs/PROVENANCE.md` entry), then runs every suite, which must give identical results.

## 7. The baseline (2026-11-14, main at `a817d59`, TSRun `b4dc564`; one suite at a time)

Every suite passes. Wall and CPU time are in seconds; the machine was shared with other sessions' work at the time.

| Suite | Result | Wall | CPU | Max RSS (MB) |
|---|---|---|---|---|
| al-a1 | 12 of 12 groups pass | 1 | 1 | 82 |
| kc-k1 | 9 of 9 groups pass | 24 | 25 | 100 |
| calc-c1 | 5 passed, 0 failed | 24 | 24 | 93 |
| shell-s1 | 18 passed, 0 failed | 49 | 50 | 90 |
| tk-t1 | 6 of 6 groups pass | 48 | 49 | 152 |
| tk-t2 | 11 of 11 groups pass | 23 | 24 | 124 |
| tk-t3 | 9 of 9 groups pass | 9 | 10 | 111 |
| wr-w1 | 12 of 12 groups pass | 120 | 107 | 122 |
| wr-w2 | 14 of 14 groups pass | 250 | 204 | 110 |
| wr-w3 | 7 of 7 groups pass | 86 | 72 | 109 |
| wr-w4 | 9 of 9 groups pass | 360 | 304 | 173 |
| wr-demo | 7 of 7 groups pass | 11 | 9 | 72 |
| fs-f1 | 8 of 8 groups pass | 10 | 8 | 104 |
| kern-dclick | 7 of 7 groups pass | 147 | 123 | 75 |
| web-smoke | All checks passed | 13 | 0 | 65 |
| calc-perf | 9 passed, 0 missed, 3 reported | 44 | 34 | 81 |
| shell-perf | 28 passed, 0 missed, 8 reported | 23 | 16 | 106 |
| tk-perf | 54 passed, 0 missed, 28 reported | 7 | 6 | 82 |
| wr-perf | 39 pass, 0 missed, 11 reported | 257 | 185 | 100 |
| **All, one at a time** | | **1,505 (25 min)** | | |

- **Where the time goes:** the Notepad suites (`wr-w1` to `wr-w4` and `wr-perf`) take 1,073 s, 71 % of the run, and
  `kern-dclick` another 147 s. S1 to S4 aim at these first.
- **Check counts per group:** each suite's log prints them. A step is judged against the same logs rerun, group by group.
