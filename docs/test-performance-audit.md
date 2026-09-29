# Current test performance audit

Measured 2026-09-29 at implementation revision
`da4eb24bdb1647a4723c3340d48a81f9e14d2472`. No runtime or test implementation was
changed. OpenCode was not run. The added scripts only measure existing tests.

## Baseline

Apple M1 Pro, 8 cores, 16 GB RAM; macOS 26.6.2; Bun 1.3.13; Git 2.54.0.
Five serial, uninstrumented invocations of each file and the whole suite, with
no concurrent test jobs. Each invocation starts a fresh Bun process. The first
run is included; filesystem caches were not forcibly cleared. All runs passed:
45 tests and 459 assertions in each full-suite run.

Wall time includes process startup and fixture cleanup. User/system times are
differences in Python `resource.getrusage(RUSAGE_CHILDREN)`, including Bun and
its waited-for descendants, rather than just Bun's own CPU time. Values below
are independently calculated medians; rows are separate executions and should
not be added to reconstruct the suite.

| Test file | Tests | Wall, s | Wall range, s | User, s | System, s |
| --- | ---: | ---: | ---: | ---: | ---: |
| `cap.test.ts` | 4 | 0.259 | 0.251–0.269 | 0.116 | 0.123 |
| `proposal.test.ts` | 5 | 0.346 | 0.340–0.357 | 0.153 | 0.173 |
| `attempt.test.ts` | 30 | 15.177 | 14.631–15.722 | 7.366 | 6.388 |
| `git.test.ts` | 6 | 1.576 | 1.435–1.619 | 0.729 | 0.653 |
| **Whole suite** | **45** | **17.477** | **17.345–17.594** | **8.351** | **7.365** |

[Raw timing samples](test-performance/baseline.json) and
[measurements for every named test](test-performance/tests.csv) are retained.
The CSV includes the median of Bun's individual-test times from the five
per-file runs, repository/process/observation counts, fixture and cleanup time,
and the minimum fixture requirement. Bun's individual-test durations include
the runner's hook accounting; the subprocess wall measurement is authoritative
for budgeting.

## Git processes and observations

A diagnostic preload forwards to the real `execFileSync`, filesystem functions,
and `observeGit`; it does not substitute Git behavior. It hashes repository
file names, file contents, symlink targets and file modes, including `.git`,
before each observation to detect unchanged state. It does not follow symlinks
or count modification timestamps alone as content changes. Static inspection
of the tests confirms which operations mutate those repositories.

Two full diagnostic runs produced identical counts. One also enabled Git's
`GIT_TRACE2_EVENT`, which revealed subprocesses launched internally by Git.
The first diagnostic run took 18.10 s; instrumented time is not used for the
baseline budget. All 45 tests and 459 assertions still passed.

| File | Temporary repos | Direct Git launches | Git maintenance children | All Git processes | `observeGit` calls | Same-state calls |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `cap.test.ts` | 4 | 24 | 4 | 28 | 0 | 0 |
| `proposal.test.ts` | 6 | 33 | 6 | 39 | 0 | 0 |
| `attempt.test.ts` | 79 | 2,168 | 80 | 2,248 | 253 | 166 |
| `git.test.ts` | 6 | 207 | 9 | 216 | 25 | 7 |
| **Total** | **95** | **2,432** | **99** | **2,531** | **278** | **173** |

Every commit launched `git maintenance run --auto --quiet --detach` on this
Git version. Trace2 recorded 2,531 Git `start` events, including those 99
children. Direct launch counts are portable structural measurements; automatic
maintenance behavior depends on Git version/configuration.

An ordinary successful observation launches seven commands: root and HEAD
before, staged/unstaged/untracked paths, then root and HEAD again. There are
1,930 observation-related direct launches, 475 fixture launches, and 27 other
test Git commands. Two observations reject early on HEAD and one on a
subdirectory root, explaining why the observation count is less than `278 × 7`.
The median successful observation took 44.83 ms in the diagnostic run.

Most same-state calls in `attempt.test.ts` are deliberate production checks:
before/after root wait and binding, after confirmation and rebinding, after
slot switch and awaited verification, and after implementation completion.
Publication observes before and after the awaited root/binding work. Preserve
these checks: other work can mutate root, HEAD, index or worktree across those
awaits even though the steady-state fake usually does not.

There are six full observations that can safely be removed **from test
assertion setup**, by retaining the already observed snapshot:

- `git.test.ts:38–41`: reuse the untracked-path snapshot for all three freshness
  and scope assertions; three repeated observations.
- `git.test.ts:49–50`: reuse the staged rename snapshot for the scope assertion.
- `git.test.ts:81–82`: reuse the ignored-path snapshot for freshness.
- `git.test.ts:91–92`: reuse the exact-path snapshot for scope.

That saves 42 direct Git launches, approximately 0.27 s at the measured rate.
The seventh same-state observation in this file is different: lines 104–105
exercise both early rejection with a bound HEAD and successful observation of
the new HEAD followed by scope rejection. Those observer contracts must both
remain covered.

## Major fixture paths

All four helpers perform `mkdtemp → init → config name → config email → write
old.txt → add → baseline commit`. Each creates one independent repository with
five direct Git launches plus one maintenance child. All 95 were cleaned up.

| Fixture helper | Calls | Total setup wall, s | Setup median, ms | Total cleanup, s |
| --- | ---: | ---: | ---: | ---: |
| `cap.test.ts:18` | 4 | 0.214 | 53.32 | 0.010 |
| `proposal.test.ts:18` | 6 | 0.316 | 53.01 | 0.015 |
| `attempt.test.ts:16` | 79 | 3.953 | 49.72 | 0.196 |
| `git.test.ts:17` | 6 | 0.290 | 48.55 | 0.016 |
| **Total** | **95** | **4.774** | | **0.238** |

Setup durations span temporary directory creation through the successful
baseline commit. Fixture Git time is included, not additive. Command medians
across all helpers: init 11.34 ms, config 6.19 ms per invocation, add 7.40 ms,
commit 17.81 ms including its maintenance child. Creation of the directory and
small file is a minor part of setup.

Attempt observations account for 11.38 s in the diagnostic run, compared with
3.95 s of fixture setup. Git subprocess wall time across the whole suite is
17.22 s of the 18.10 s diagnostic run. These are nested measurements, so
observer, fixture, subprocess and sleep times must not be summed together.

The largest individual tests illustrate the multiplicative fixture cost:

| Attempt test, starting line | Median wall, s | Repos | Direct Git launches |
| --- | ---: | ---: | ---: |
| Missing/duplicate/substituted child evidence, 185 | 1.977 | 14 | 266 |
| Trusted prompt identity/attachments, 562 | 1.587 | 6 | 240 |
| Ambiguous switch/prompt admission, 236 | 1.018 | 4 | 153 |

Exact per-test values, including all remaining tests, are in the CSV.

The other major fixture is `attempt.test.ts:58`'s fake host: session maps,
transcripts, callbacks and call collectors. A temporary instrumented copy of
the 14-case native-evidence test measured its construction at a median
**0.020 ms**, **0.478 ms total** for fourteen calls; the selected test still
passed all 42 assertions. The original test file remained unchanged. This
fixture's construction is negligible compared with Git setup and observation;
keep constructing fresh host state for isolation.
[Construction samples](test-performance/fake-fixture-measurements.json) are retained.

## Which attempt tests require Git?

Retain real Git in these six integration tests, including their existing
subcases and assertions:

| Starting line | Behavior needing real Git |
| ---: | --- |
| 147 | Successful trusted handoff observes a real allowed file edit and unchanged HEAD. |
| 211 | Dirty baseline and a real edit during confirmation fail admission; reset restores a clean repository between subcases. |
| 280 | A real commit changes HEAD; an actual out-of-scope untracked file fails the result gate. |
| 371 | Clean TUI activation captures a real baseline and publishes after the new root completes. |
| 394 | A stable pre-existing real diff may be published without implementation authority. |
| 548 | Publication rejects a changed real path set; retain its pending-inbox subcase too. |

These six tests use eight repositories, 41 observations and 328 direct Git
launches; their individual median times total approximately 2.19 s. The clean
TUI activation is also a useful real-Git wiring check even though its specific
event-order assertions could run against a trusted observer double.

The remaining tests fall into these groups:

- Twenty-two test snapshot consumers: transcript and child identity binding,
  cancellation, transport ambiguity, completion evidence, permissions,
  revocation, terminal readability, pagination, publication text/admission,
  attachment rejection, location substitution, duplicate events and cleanup.
  They need a trusted canonical `GitSnapshot` and, because the code reobserves
  Git, a test-scoped trusted observer double. Replacing **only the baseline**
  would leave their real Git overhead. Preserve actual temporary directories
  for `realpathSync`, real filesystem scope parsing, separate locations where
  substitution is tested, and fresh histories/sessions/generations for every
  subcase. These tests currently use 70 repos, 212 observations and 1,834
  direct Git launches; individual medians total 12.76 s.
- `attempt.test.ts:411` tests candidate text and terminal sizing. A filesystem
  fixture and fixed HEAD are sufficient; it never observes Git.
- `attempt.test.ts:296` reads and evaluates real role files. It already creates
  no repository and needs no snapshot.

All four CAP tests and all five proposal tests need no Git semantics. Their
path validation still needs real filesystem files/directories and symlinks;
retain those while using a fixed HEAD. The final Git test at line 108 is a
pure `requireFresh`/`requireInScope` snapshot comparison and can use a frozen
snapshot directly. Keep real Git for the other five primitive tests.

If adopting observer doubles later, restore each double after its case,
verify that production consumers actually see it, and retain the real-Git
integration coverage above. This can be confined to the test harness: do not
add a production caller-controlled way to replace the trusted observer, or
cache observations across admission boundaries.

## Sharing and copying fixtures

A separate five-repetition probe compared fresh setup with a copy and an
independent local clone. It did not change suite fixtures.

| Path | Median setup, ms | Direct setup commands | Result |
| --- | ---: | ---: | --- |
| Current fresh setup | 47.63 | 5 | Clean independent repository. |
| Recursive copy, preserving timestamps | 6.37 | 0 | `old.txt` falsely reported dirty in all five copies. |
| Copy plus `git update-index --refresh` | 12.64 combined | 1 | Clean independent repository. |
| `clone --no-hardlinks`, configure identity, remove origin | 49.77 | 4 | Clean independent repository; no measured setup saving. |

Copying changes index stat identity despite preserved timestamps. This matters
because the current observer uses `diff-files` without refreshing the index.
An unrefreshed copy would violate clean-baseline invariants.

In all fifteen probes, editing and committing in the destination left the
seed's HEAD, observed path set and `old.txt` content unchanged. The copied
configuration is the original configuration; the tested clone explicitly sets
identity and removes origin to avoid a dependency on the seed directory.
[Probe samples](test-performance/fixture-benchmark.json) are retained.
Repeat the standalone probe with `bun run scripts/benchmark-fixtures.ts`.

The safe shared resource is an immutable, committed seed. Keep a separate
canonical directory and complete private `.git` for each test/subcase, copy
ordinary files, refresh that copy's index, and take the integration baseline
from the destination. Do not share mutable worktrees, indexes, refs or config;
linked worktrees and hardlinking those files weaken isolation. Fresh fake host
state and authority generations remain per subcase. A seed can live until
file-level teardown; destinations keep the existing per-test cleanup.

One actual repository could serve strictly read-only cases if immutability is
enforced and host state remains fresh. That is less robust against a future
test adding mutation. Private copies provide the setup saving while retaining
the current repository isolation. Keep distinct directories in escaping
symlink and location substitution tests.

## Waits and polling

`session.wait` is a fake: it returns immediately except for synchronous
callbacks and the explicit deferred promise in the cleanup/revocation test.
Eighty-four calls took 5.03 ms combined in the diagnostic run. The deferred
promise is released directly after cleanup; it is not a timer-driven wait.

There are three `100 × Bun.sleep(1)` bounded publication loops and two one-shot
`sleep(1)` yields. Each loop ran only **one iteration**. Five sleep calls took
133.61 ms elapsed in the full trace, but the publication sleeps overlap the
real synchronous Git observation executed by the background promise chain.
A separate targeted trace measured 163.06 ms of sleep elapsed, with 147.22 ms
of overlapping Git and 3.55 ms of profiling fingerprints: approximately
12.29 ms remained for scheduling, timers and other work. The two explicit
cleanup yields alone took 2.79 ms. These waits do not materially explain the
17.48 s suite. Preserve their completion/revocation ordering; changing them is
low priority.

## Smallest recommended changes, in order

1. Use filesystem-only fixtures and fixed HEADs for CAP, proposal and candidate
   sizing; use a literal frozen snapshot for the pure freshness/scope test.
   Preserve file and symlink assertions. This removes 12 repository setups,
   75 direct Git launches and 12 maintenance children, saving roughly 0.7 s.
2. Reuse the six already observed primitive snapshots listed above. Preserve
   every assertion and every distinct observer behavior; approximately 0.27 s.
3. Give the remaining Git fixture helpers one committed seed per file and
   private copies refreshed with `update-index --refresh`. The probe suggests
   roughly another 2.8–3.2 s saving, after seed setup. Verify destination
   cleanliness and seed isolation when implementing this. No production Git
   or admission logic needs to change.
4. If a larger reduction is needed, use test-scoped observer doubles in the 22
   snapshot-consumer attempt tests. This has the largest potential return but
   requires more careful harness work and coverage review than fixture changes.
   Retain all named tests and all parameterized rejection subcases, the real
   integration group, and every production observation boundary.

The first three changes suggest a suite around 13–14 s; that is a projection,
not a measured optimized result. Observer doubles could bring it into the
3–5 s range, also unmeasured. Neither optimization has been implemented.

## Proposed budget and regression detection

For the **current unoptimized 45-test suite**, propose a **22 s median wall
budget over three serial full-suite runs** on this reference machine or a
calibrated dedicated runner. That leaves about 26% over the measured 17.48 s
median. Per-file diagnostic ceilings: attempt 20 s, Git 2 s, proposal 0.5 s,
CAP 0.35 s. Track CPU times as evidence; wall time is the primary gate.

Use the standard-library-only measurement script:

```sh
python3 scripts/measure-tests.py --runs 3 --budget 22 --output /tmp/test-times.json
```

It exits nonzero on a test failure, a suite count other than 45, fewer than 459
assertions, or a median above budget. For attribution, add `--per-file`.
Run serially without tracing or coverage on a comparable runner; calibrate a
different runner rather than applying the M1 number blindly. On regression, compare per-file medians and
the retained CSV before changing the budget. Keep all 459 current assertions
and all subcases when making performance changes; count guards alone cannot
establish equivalent coverage.

The script was exercised with a passing 22 s budget (17.15 s measured) and an
intentionally impossible 0 s budget (16.78 s measured, correctly exited 1).
The latter run also confirmed the 45-test/459-assertion parsing. These
verification runs are separate from the five-run baseline above.

For a deeper audit, run in a fresh process with unused output paths:

```sh
PERF_OUTPUT=/tmp/test-profile.json GIT_TRACE2_EVENT=/tmp/git-profile.jsonl \
  bun test --preload ./scripts/profile-tests.ts
```

Trace2 appends to an existing file, so use a new path for each run. Count its
`event == "start"` records for all Git processes; the preload's `git`, `repo`,
`observe` and `sleep` events identify direct launches and their test names.
The current structural baselines are 95 repositories, 2,432 direct launches,
278 observations and 2,531 total Git processes on this Git configuration.
Unexpected growth with unchanged coverage is a useful diagnostic even when
wall-time noise masks it. Do not use traced runtimes for the wall-time gate.

After implementing and measuring the first three changes, a provisional
**15 s** budget is reasonable; adopt it only after validation. A future
snapshot-double version could provisionally target **6 s**, subject to the
same measurement and invariant review.
