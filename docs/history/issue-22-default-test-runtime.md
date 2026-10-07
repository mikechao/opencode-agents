# Issue #22 default test runtime regression

Measured on 2026-10-07, macOS arm64, Bun 1.4.2. Production uses
`/usr/bin/git` 2.50.1 (Apple Git-155); the existing fixture helper's `git`
resolves to 2.54.0. The previously supplied 37.33s figure is historical;
the fresh baseline below measures the already-split working tree at the start
of this pass. The existing `test:large-git` split is preserved unchanged.

## Uninstrumented timings

Three serial fresh processes for each command, alternating the two commands.
Each command ran under `/usr/bin/time -p`. No concurrent test job, profiler,
forced cache clearing, OpenCode launch, commit, or push was involved.

| Command | Before samples, s | Before median, s | After samples, s | After median, s |
| --- | --- | ---: | --- | ---: |
| `bun test` | 38.856, 40.302, 37.566 | **38.856** | 9.769, 9.284, 10.111 | **9.769** |
| `bun test test/git.test.ts` | 34.298, 34.623, 33.259 | **34.298** | 5.284, 5.381, 5.594 | **5.381** |

The default median fell 74.9%; the Git-file median fell 84.3%. The default
median is single-digit, but the preferred 5–7s target was **not achieved**, and
one final sample exceeded 10s. All before and after runs passed. The default
suite has 369 tests before and after, with 8,963 and 8,972 assertions respectively.
Test counts are not a coverage proof; the decomposition below describes what
moved to a cheaper substrate and which real boundaries remain.

## Where the time went

Separate diagnostic runs temporarily bracketed function bodies, real
`execFileSync` calls, filesystem calls, and production hash updates/finalization.
The profiler forwarded actual commands and observed existing test doubles;
mocked commands are not counted as subprocess launches. Instrumentation was
removed before wall-time validation. The per-test timing tables use medians of
Bun's uninstrumented individual-test times, including its hook accounting.

Direct trusted `/usr/bin/git` launches in the Git test bodies fell from
**2,091 to 289**. Fixture-helper/test-action Git launches fell from **87 to 61**.
Thus all direct body launches fell from **2,178 to 350**. Seed setup separately
uses five before and six after fixture-helper launches. These counts exclude
Git-internal subprocesses and commands launched by hooks: the modifying hook
runs `git add`, and the ambiguous hook runs an additional `git commit`. Those
hooks still actually execute after this change.

The before diagnostic test bodies took 37,895.62ms. Real subprocess calls
consumed **37,593.97ms (99.2%)**. Measured filesystem calls took **138.20ms**;
production hashing took **9.92ms**. Fixture setup took **225.75ms** for 17 private
copies, including their index refreshes; seed setup took **55.94ms**, cleanup
**66.01ms** including seed cleanup. These are nested measurements and must not
be added to subprocess/function totals.

The after diagnostic bodies took 5,361.50ms, including **5,199.23ms** in real
subprocess calls, **67.88ms** in filesystem calls and **9.88ms** in production
hashing. Seven private-copy setups took **96.24ms**, seed setup **68.05ms**, and
cleanup **29.18ms** including the seed. Hashing did not drive either runtime.

Thirty no-repository `/usr/bin/git --version` probes had a median of 15.88ms.
A separate 30-sample comparison measured `/usr/bin/true` at 1.52ms and
`/usr/bin/git --version` at 13.20ms. This isolates substantial Git executable
startup cost before any repository scan or content hashing. The profiler does
not separate kernel spawn overhead from Apple Git driver initialization; the
measurement supports startup as the dominant cost, not an exact breakdown of
those two components.

### Trusted operation totals

Inclusive milliseconds and descendant direct trusted launch counts; these
rows overlap. Calls include real primitive execution against test-scoped doubles.

| Operation | Before calls | Before ms | Before launches | After calls | After ms | After launches |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `observeGit` | 289 | 27,803.21 | 1,575 | 90 | 3,166.84 | 198 |
| `observeReviewTarget` | 48 | 16,042.02 | 878 | 23 | 1,216.26 | 75 |
| `contentDigest` | 86 | 3,098.96 | 171 | 36 | 205.69 | 12 |
| `prepareCommit` | 11 | 13,630.38 | 676 | 3 | 1,212.77 | 77 |
| `requirePreparedCommit` | 77 | 7,847.76 | 422 | 63 | 1,236.82 | 72 |
| `requireIndexContent` | 83 | 1,390.42 | 81 | 63 | 453.23 | 21 |
| `verifyCommitted` | 14 | 3,712.48 | 226 | 6 | 1,014.90 | 64 |

`observeGit` accounts for 75.3% of the before trusted launches. One successful
ordinary observation uses seven commands; a full review target uses three
ordinary observations plus two two-command content digests, totaling 25.
Complete prepared and successful committed proofs each use 22 for these small
fixtures. Most repeated cost therefore came from whole observations surrounding
otherwise inexpensive byte/index proofs.

## Slowest tests before

Counts are direct trusted `/usr/bin/git` launches, excluding fixture/action
commands. Complete per-test wall times, fixture/action counts and operation
breakdowns are retained in the linked evidence.

| Test/scenario | Median ms | Trusted launches |
| --- | ---: | ---: |
| Complete bytes/modes/deletions/symlinks CommitGit transition | 4,185.52 | 266 |
| Message-only external amend at final settlement | 3,759.66 | 242 |
| External reset after successful postflight | 3,095.34 | 192 |
| Preparation drift / partial and substituted index / HEAD drift | 3,023.02 | 191 |
| Complete SHA-256 CommitGit lifecycle | 2,961.33 | 185 |
| Ambiguous real hook | 2,628.50 | 167 |
| Modifying real hook | 2,626.37 | 167 |
| Rejecting real hook | 2,623.51 | 166 |
| Closed preparation failure refreshes terminal facts | 1,752.49 | 109 |
| Observed HEAD drift permanently retires authority | 1,604.13 | 100 |

For the complete transition's before diagnostic run:
`CommitGit.prepare` took 1,206.50ms / 78 launches, `staged` 657.34ms / 46,
`commit` 675.00ms / 46, and the deliberately failing mode-drift `final`
272.18ms / 18. Its `prepareCommit` cost was 1,190.34ms / 77 launches;
four prepared proofs cost 1,280.25ms / 88 launches. The extra test assertions
also performed full review/path observations that were redundant with the
already-tested index-digest and postflight primitives.

## Exact changes

- `test/committer-git.test.ts`: four settlement/state tests now use a local
  trusted-observation double instead of real prepare/commit/final lifecycles.
  They retain exact postflight HEAD binding, immutable historical facts and
  failure reasons, fresh terminal observations, permanent retirement after
  restored HEAD, and one-shot/no-retry assertions. All four launch zero Git
  processes and have 0.11–0.34ms median wall times in the default runs.
- Inspection tests assert the number of proofs around each read: one for
  status, two for diff/staged. A new staged-inspection case mutates the trusted
  state during the fixed diff command and proves the second content gate
  rejects output and permanently closes authority.
- `test/git.test.ts`: digest cases retain real byte hashing, modes, deletions,
  symlinks, and filesystem topology with explicit trusted index/path doubles.
  They still execute the production digest implementation, including repeated
  digest comparison; no expected digest is reimplemented in tests.
- Scope/root equality uses a real directory and fixed trusted root output.
  The real ordinary observation test now also proves ignored and newline-path
  behavior. HEAD changes still reject through a real prepared-proof observation;
  pure scope/freshness checks retain independent HEAD/root substitution cases.
- The default complete CommitGit integration still uses real target observation,
  preparation, commit, postflight and final mode-drift rejection. It omits the
  separately proven staged-inspection operation and redundant surrounding
  observations, and reads tree output once. The existing large-Git successful
  lifecycle still proves successful final settlement with actual Git.
- SHA-256 coverage begins with a real prepared index and keeps actual 64-digit
  index/blob/commit/tree parsing and byte verification. Only the ordinary
  root/HEAD/path observation is doubled; real composition is covered by the
  complete transition. No duplicate full authority lifecycle is needed to
  assert object-format support.
- Fresh preparation scope/byte rejection uses the real preparation primitive
  with trusted observations and real files; every unconfigured command,
  including staging, fails. Partial/substituted index and stat-flag behavior
  retain actual Git mutations and blob reads, beginning at a prepared fixture;
  the external HEAD rejection uses the real observer.
- Hooks execute real fixed-argv commits and real postflight verification from
  prepared fixtures. Exact rejection reasons distinguish failed HEAD advance,
  changed tree and extra parent advance. HEAD/index observations prove no
  cleanup occurred. Existing state-machine tests separately prove one-shot
  spending and no retry for these outcomes.

No test was moved to the slow suite. `package.json` and
`test/git-large.integration.ts` retain the split present at the start of this
pass. No production file changed and no production test seam was added.

## Slowest tests after

| Test/scenario | Median ms | Trusted launches |
| --- | ---: | ---: |
| Complete bytes/modes/deletions/symlinks CommitGit transition | 2,631.27 | 167 |
| Real ordinary observation variants, ignored and unusual paths | 705.68 | 42 |
| Real partial/substituted index and changed HEAD | 393.56 | 20 |
| Real SHA-256 index/postflight proofs | 377.71 | 17 |
| Ordinary staged and unstaged paths together | 283.92 | 14 |
| Modifying real hook / real postflight rejection | 240.35 | 10 |
| Ambiguous real hook / real postflight rejection | 240.28 | 10 |
| Rejecting real hook / real postflight rejection | 203.30 | 9 |

## Production authority assessment and remaining cost

Production code is unchanged. A normal successful prepare → staged → commit →
final sequence requires **192 direct trusted commands** in these small fixtures:
78 + 46 + 46 + 22. Initial review-target capture adds another 25. The repeated
complete proofs are materially expensive, but sit at distinct boundaries:

- Preparation checks the current target, captures complete approved entries,
  rechecks the target before staging, and verifies the resulting complete index.
- Staged inspection brackets the Git diff subprocess with prepared-content
  proofs. External mutation can occur while that subprocess runs.
- Commit rechecks content after any model/tool activity and immediately before
  the live gate, synchronous authority spend and fixed-argv commit spawn.
- Postflight validates actual commit parent/tree/path identities and complete
  index/worktree content after hooks. Final repeats settlement proof after
  another external-mutation window and binds the exact postflight commit ID.

No authority-equivalent production consolidation was established. An earlier
proof cannot replace a later proof across those windows. All freshness,
complete-index/content, parent, root, HEAD and one-shot checks remain intact.

The residual measured cost is explicit: the complete default transition takes
2.63s, other retained real-Git primitive tests about 2.45s, and non-Git-file
work/process overhead about 4.39s (difference of separate suite medians, not a
strict additive decomposition). In the after profile, 350 direct body launches
alone consumed 5.20s; hashing and fixture cleanup are small. That is the
remaining cost of the current integration coverage and unchanged production
proofs, not a claimed universal lower bound. Reaching 5–7s would require further
work beyond the repeated lifecycles eliminated here; deleting current proofs or
hiding these integrations in the slow suite was not used to meet that target.

## Validation and retained evidence

- `bun run check`: formatting, lint, typecheck and all 369 default tests passed.
- `bun run test:large-git`: both existing real >16 MiB threshold tests passed.
- `git diff --check`: passed.
- No OpenCode launch, commit, push, sibling repository modification, or work on
  Issues #33/#34.

[Per-test timings and counts](test-performance/issue-22-regression-tests.csv)
and [timing samples / per-test operation measurements](test-performance/issue-22-regression.json)
include every Git-file test before and after, plus the migrated settlement
cases. Operation timings are diagnostic; uninstrumented medians are the budget
measurements.
