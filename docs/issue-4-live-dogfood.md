# Issue #4 Live Dogfood Report

## Baseline

All runs used OpenCode with the `opencode-agents` implementation from repository
HEAD `9754a33057efa894aac2e65826129b656a66c636`, in the live TUI environment.
The worktree was verified clean before each fresh attempt. This live
verification covers [issue #4](https://github.com/mikechao/opencode-agents/issues/4), “[Feat]: Allow terminal resize after authorization claim”: pending resize recovery and resize tolerance after the exact local Authorize decision has synchronously claimed the published attempt.

## Scenario results

### 1. Pending resize recovery — PASS

Request: Append a line containing exactly `# issue-4-pending-resize-dogfood` to `README.md`.

The trusted Plan and Authorize / Cancel controls appeared. Before Authorize was
clicked, the terminal was resized to roughly 70 columns while remaining tall
enough for the TUI. Resize did not STOP the attempt, and the same pending
authorization surface remained visible. Authorize was visible but inert at this
size because the current policy requires at least 80×24. No implementation was
admitted while narrow.

After resizing back to a comfortably valid width and allowing a fresh TUI
redraw, Authorize became usable for the same pending attempt. Clicking it
changed persistent status to:

> Authorization claimed — implementation admission in progress…

The attempt completed with:

> Implementation gate complete: HEAD 9754a33057efa894aac2e65826129b656a66c636 unchanged. Resulting paths (1): README.md. STOP before Reviewer / Commit.

`README.md` was restored and the worktree returned clean. This proves pending
resize no longer permanently terminates the attempt, invalid geometry does not
admit implementation, and a fresh valid frame can restore readiness for the
same pending attempt.

### 2. Resize after exact authorization claim — PASS

Request: Append a line containing exactly `# issue-4-post-claim-resize-dogfood` to `README.md`.

After the trusted controls appeared, Authorize was clicked once and persistent
claimed/in-progress status appeared. While that continuation was still active
and before its final gate result, the terminal was resized significantly
narrower. The former resize STOP did not occur, Authorize / Cancel did not
return, and the same continuation completed with unchanged HEAD, exactly
`README.md` as the resulting path, and STOP before Reviewer / Commit.

`README.md` was restored and the worktree returned clean. This is the primary
live proof that terminal geometry alone no longer revokes an already-captured
trusted authorization decision.

### 3. Additional post-claim narrow resize — PASS

Request: Append a line containing exactly `# issue-4-post-claim-narrow-wide-dogfood` to `README.md`.

After Authorize was clicked and claimed status appeared, the terminal was
resized substantially narrower while the continuation was active. The attempt
remained alive and implementation completed while the terminal was still
narrow. The final trusted status again reported unchanged HEAD, exactly
`README.md` as the resulting path, and STOP before Reviewer / Commit.

The implementation finished before a deliberate live resize back to a wider
size could be performed. Therefore this run does not prove a complete live
narrow-to-wide sequence. Automated regression coverage exercises that sequence
in `test/attempt.test.ts`.

### 4. Non-layout invalidation after claim — PASS

Request: Append a line containing exactly `# issue-4-non-layout-stop-dogfood` to `README.md`.

After Authorize was clicked and claimed status appeared, the user navigated from
the root session to the Planner child session while the continuation was still
pre-dispatch. The attempt immediately showed the trusted persistent STOP:

> STOP — Implementation was not admitted; no implementation prompt was dispatched. Root view or TUI location changed

No implementation change was made. After OpenCode stopped,
`git status --porcelain=v1 --untracked-files=all` was empty. This confirms that
allowing post-claim resize did not weaken the root-route/TUI-location guard.

## Safety and CAP observations

- **Pending frame evidence:** a resize left the pending attempt alive but made
  the narrow surface non-authorizing under the existing size policy. Readiness
  returned only after a fresh redraw at valid geometry; the stale narrow frame
  admitted no implementation.
- **Exact local decision claim:** the Authorize click produced persistent
  claimed status, removed the decision controls, and continued for that exact
  pending attempt. This matches the TUI's synchronous claim of the captured
  `PublishedAttempt` before async admission begins; the live observation does
  not independently instrument JavaScript scheduling.
- **Post-claim geometry:** shrinking the terminal after claim did not revoke the
  continuation, and Authorize / Cancel did not return. Geometry was presentation
  state for the claimed continuation.
- **Non-layout liveness:** navigating away from the root session after claim
  still stopped before prompt dispatch with the trusted route/location reason.
  This run directly exercised route/location liveness; it did not independently
  exercise every other non-layout admission check.
- **HEAD, path scope, and workflow boundary:** successful gate results reported
  unchanged HEAD and exactly `README.md`; each stopped before Reviewer / Commit.
  The test requests were undone, and cleanup left the worktree clean.

These observations establish the listed live behaviors for these attempts. They
do not establish the unobserved narrow-to-wide timing sequence from scenario 3
or unrelated workflow behavior.

## Separate follow-up: issue #7

At roughly 70 columns, the complete authorization surface appeared readable,
but Authorize stayed inert because the current pending-surface policy enforces
an 80×24 minimum. This is tracked separately as
[issue #7, Allow authorization at narrow readable terminal sizes](https://github.com/mikechao/opencode-agents/issues/7).
It is a usability/layout-policy finding, not an issue #4 failure or blocker.
Issues #5 and #6 remain separate and unchanged.

## Final result

**ISSUE #4 LIVE DOGFOOD PASS**
