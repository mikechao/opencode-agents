# V1 Orchestration

## Current architecture and status

This document owns actual OpenCode host/runtime sequencing and implementation
status. [CAP](coding-authority-protocol.md) owns normative coding-authority
invariants; [the charter](charter.md) owns purpose and scope. The accepted
[published-Plan investigation](history/published-plan-authorization-investigation.md)
is non-normative design evidence, not current status.

The live TUI implements trusted Plan publication, a direct local pointer
decision, and same-slot implementation through the Git gate:

```text
activation Git observation + completion time
→ adopted fresh Orchestrator creation evidence
→ fresh Planner child → fresh read-only implementer_slot child
→ root completes → exact native histories H0 / HP / HS
→ frozen IntentCandidate C
→ exact synthetic admission S, delivery:steer, resume:false
→ root remains idle → exact pending publication verification
→ eligible clean-initial attempt: root-only question, binding context, Authorize / Cancel
→ local Authorize claims exact PublishedAttempt synchronously and shows persistent progress
→ fresh publication/native/Git/liveness verification
→ one-use intent grant
→ same retained slot switches to authorized_implementer
→ exact switch + unchanged parent / Planner / publication verification
→ final read + clean Git + liveness barrier
→ consume grant → immediately dispatch one frozen implementation prompt
→ exact admitted input / switch / result binding
→ unchanged HEAD + exact Git changed-path scope gate
→ persistent trusted gate result: STOP before Reviewer / Commit
```

Cancel and fail-closed STOP also leave persistent root-scoped status. The
published Plan synthetic remains immutable retained evidence throughout; the
separate composer-top status is presentation only and carries no CAP authority.

There is one authorization path. `runImplementationAttempt()` and its independent
modal confirmation have been removed. Reviewer, reviewed-target construction,
and Commit remain later work. Automated verification and focused live OpenCode
2.0.20 dogfood have exercised the published-Plan authorization path; see
Verification for the evidence and remaining live cases.

Issue #4's pending-resize recovery, post-claim resize tolerance, and continued
fail-closed behavior on root-route invalidation have now passed live dogfood at
the implementation HEAD recorded in [the issue #4 report](issue-4-live-dogfood.md).

## Runtime modules and live entry

| Source | Responsibility |
| --- | --- |
| [proposal.ts](../src/proposal.ts) | Exact `{ intent, plan, files }` parsing/path validation; frozen candidate; deterministic encoding/digest and Plan rendering. |
| [cap.ts](../src/cap.ts) | Generation liveness, process-local grant creation, and one-use consumption. |
| [git.ts](../src/git.ts) | Canonical root/HEAD/ordinary changed-path observation; clean freshness and exact scope gates. |
| [attempt.ts](../src/attempt.ts) | Activation/publication evidence, exact native and pending-publication verification, guarded authorization bridge, one same-slot executor, exact prompt/result binding. |

The [TUI plugin](../.opencode/plugins/opencode-agents/tui.tsx) owns one activation,
its pending/claimed references, local decision callbacks, irreversible
invalidation, reactive view guards, and cleanup. It does not persist authority
in session state or either plugin storage API. There is no workflow service,
phase enum, retry counter, compatibility path, or recovery mechanism.

## Native roles and binding

All four roles are host-loaded from [.opencode/agents](../.opencode/agents).
Rules start with deny-all; every binding rejects session permission overrides.

| Role | Capabilities and contract |
| --- | --- |
| `orchestrator` | Primary; native delegation only to Planner and inert slot. No mutation, shell, session-control, MCP, question, or authorized-Implementer delegation. |
| `planner` | Fresh read/glob/grep-only child; returns the exact three-field JSON proposal. |
| `implementer_slot` | Fresh read-only child; bootstrap must use no tools and return exactly `READY`. |
| `authorized_implementer` | Hidden implementation role with read/glob/grep/edit/shell; delegation, session-control, execute, MCP and question remain denied. Explicit Git commit denials provide defense in depth. |

For one plain root request, native calls are fresh, sequential, foreground
Planner then slot. Each contains exactly `agent`, nonempty `description`, and
`prompt`; continuation, model override and background arguments are rejected.
Planner receives `User request:\n` followed by the exact request. The slot
receives `Reply READY only. Do not inspect or modify the repository.`

Binding independently reads session identities, activity, inboxes, and complete
paginated server histories. It requires the expected role/parent/location,
creation identity, successful idle outcome, no fork/revert/archive, and zero
permission overrides. Pagination rejects duplicate IDs and repeated cursors.
The root has one first plain user input, two exact native calls, one successful
turn, and a nonempty final. Native result wrappers must equal independently
read child results. Planner tools are completed read/glob/grep calls; the slot
has no tools and exact `READY`. Unpublished inboxes are empty.

`Bound` retains complete H0/HP/HS encodings plus immutable native call/result
indexes and session creation times. Planner P is the untouched concatenation
of its final text parts. Root narration never transports authority. Candidate
construction binds P to the original canonical worktree root and HEAD.

## Initial eligibility and publication

Setup synchronously observes Git, then records observation completion time.
The adopted root's host Created evidence is copied and its time is rebound to
`session.time.created`. Authorization requires initially empty changed paths
and creation strictly later than observation completion. Equal, missing,
replayed/pre-observation, or ambiguous clock evidence cannot authorize. This
uses the supported local topology's shared OS clock, not remote attestation.
Activation retains an immutable snapshot of only the plain primitive location
identity fields (`directory` and optional `workspaceID`), rather than cloning
OpenCode's Solid-store-backed location object.

A stable dirty baseline still runs planning and publishes the normal readable
Plan. It receives this inert local status, with no decision callbacks:

> Planning only — worktree was dirty when this attempt started. Start a new attempt from a clean worktree to enable implementation.

Cleaning later never enables that attempt. Ambiguous initial ordering likewise
produces planning-only status. A contradictory root creation identity stops.
A new activation and fresh clean planning attempt are required to authorize.

Publication requires the original root/HEAD and stable baseline changed-path
set across waits/reads. It binds native evidence again before calling synthetic
once, with exact P, deterministic `renderPlan(C)`, exact metadata
`{ source: "planner", planHash }`, delivery `steer`, and `resume:false`.
Trusted locally generated message IDs correlate admission events with RPC
responses; they are not authority and are never reused to retry a dispatch.

The complete checked admission is copied/deep-frozen into `PublishedAttempt`,
alongside generation identity, activation location, original Git snapshot,
observation/creation evidence, native binding and C. Nested records are copied;
generation itself remains mutable only for liveness. Coherence checks compare
retained P/native results, candidate/root/HEAD, and publication. Neither IDs,
hashes, metadata, cached messages, nor prose replace full evidence.

## Exact pending synthetic semantics

On OpenCode 2.0.20, while S is pending:

```text
server root message.list = H0 exactly
server root inbox.list   = [S] exactly
TUI materialization      = H0 + materialize(S)
```

The publication-aware verifier requires inactive root, unchanged successful
identity/creation, exact H0, exact full S, unchanged HP, and the expected slot
history. Child inboxes remain empty. Original native parsers remain strict;
there is no extra-message filter or generalized synthetic exception.

S comparisons retain all allowed fields, scalar values, array order, ID,
session, raw text, description, metadata, delivery, and admission time. Object
key insertion order is immaterial. Returned admission is independently read
back from the server. One guarded initial pending/message hydration makes the
complete Plan available in the TUI; incomplete or inconsistent projection
fails closed. Cache availability supplements server binding and never grants
authority. The Plan may be offscreen in the ordinary scrollable transcript.

Promotion/delivery of S is rejected even with identical text: pending disappears
and server history changes. Synthetic is eventual model input, not a display-only
append. This attempt never resumes the root. Cancel/STOP do not cancel S;
a later manual root turn may deliver it outside the completed attempt, without
restoring any authority.

## Local decision and lifetime

The plugin appends one reactive `session.composer.top` claim for the exact root.
While pending, it shows the complete canonical worktree, Plan hash and bound
HEAD prefix, the question “Do you authorize this plan for implementation?”,
and Authorize / Cancel on separate lines. The question and controls are not
concatenated with the binding row. The surface occupies at most five rows:
worktree at most two wrapped rows, then one row each for binding, question, and
controls. It requires an 80×24-or-larger terminal and visible, unclipped
worktree, binding, question, and control geometry. Controls become live only
after a completed renderer frame proves the entire layout. Pending resize
synchronously invalidates that proof and disables decisions before descendants
reflow. Stale geometry or resizing back to the previous dimensions cannot
restore readiness: a fresh completed frame must validate the current viewport,
ancestor visibility/liveness, wrapping, dimensions, and every required text and
control's bounds and clipping before publishing a new proof. Invalid geometry,
including a terminal below 80×24, leaves the exact attempt pending and inert;
a later valid completed frame may restore readiness. True pending-surface loss
or unmount remains fail-closed and permanently ends that attempt. The full Plan
is not duplicated in the composer surface.

Direct left-pointer handlers call an unregistered closure. There is no
keyboard authorization, Form/Question, slash/palette action, keymap command ID,
RPC route, session message, or model-callable tool for the decision. Authorize
and Cancel synchronously verify exact pending ownership and a valid current
completed-frame surface proof, then claim that immutable object and disable/
remove controls before asynchronous work. Authorize replaces them with persistent
`Authorization claimed — implementation admission in progress…` status while
the existing authorization bridge runs. This wording does not claim that the
implementation prompt has been dispatched. Duplicates, stale handlers, and
racing decisions are inert after the first claim. The click is a decision, not
a grant. After the exact claim, terminal geometry is presentation-only: resize
alone, including below the authorization minimum and back wider, does not
revoke continuation. Authorize / Cancel never return for that attempt. Cleanup
of the replaced DecisionStrip cannot terminate its already-claimed continuation.

Cancel clears authority-capable ownership and leaves persistent
`Cancelled — no implementation admitted` status; it creates no grant, switch
or prompt. Success leaves the trusted implementation-gate result visible,
including unchanged bound HEAD, resulting paths, and STOP before Reviewer /
Commit. Fail-closed STOP remains visible with trusted dispatch-state wording:
before dispatch it states that implementation was not admitted and no prompt
was dispatched; after dispatch it states that implementation may already have
started and no prompt will be resent. Toasts are supplemental. Dirty/ordering
statuses retain only presentation data and have no callbacks.

Observers are installed before publication. Only exact expected synthetic,
switch and implementation events are admitted, with RPC/history reconciliation.
Unexpected root execution, inbox lifecycle, transcript/control mutation,
permission/role/location changes, missing children, deletion/fork/revert/
compaction, route loss, renderer errors, or true pending-surface loss terminate
the attempt. Global frame/reactive watchers and continuation-wide owner checks
retain non-layout invariants after claim; they do not recheck the disposed
decision surface. Events revoke on receipt; independent server reads cover delayed
notifications. There is no broad busy-period event exemption.

Every awaited operation/page is followed by owner/generation/location and fresh
Git checks. Publication uses baseline path stability, pre-admission uses clean
freshness, and post-dispatch preserves root/HEAD without requiring cleanliness.
Authority closure clears the retained attempt, decision, guard, and echo
references independently of the status surface. The status retains only
trusted display text, no callback or PublishedAttempt. Plugin cleanup
synchronously revokes first, clears presentation, then removes the slot and
subscriptions. Old promises cannot grant, dispatch, or report a passing gate
after revocation. New activations inherit no authority.

## Same-slot implementation and terminal behavior

After a claimed positive decision, `authorizePublishedAttempt()` verifies exact
publication/native evidence and fresh clean Git before granting. The executor
switches only the bound slot; the switch creates ordinary role capability,
not CAP authority. It retains the complete exact switch record and requires HS
plus that single switch and no input. Parent/Planner/publication and slot are
rechecked, followed by the final complete read barrier and synchronous fresh
Git/owner/candidate/generation checks.

Consumption is adjacent to the sole `session.prompt()` invocation, without
an await or UI operation between them. The exact frozen prompt contains the
proposal, canonical root, bound HEAD, exact path scope and history-effect
constraints. No Planner conversation is copied and no replacement child is
created. The original parent subagent row remains the inert bootstrap result.

Prompt admission binds exact trusted ID, child/type/text/delivery and empty
attachments. After dispatch, editing may already be underway, so cleanliness
is no longer required. Completion independently requires the same slot/role/
parent/creation, inactive empty inbox, unchanged bootstrap and switch record,
one exact trusted input, one successful authorized turn, and nonempty result.
The complete result suffix is retained and compared across later parent/Planner
awaits. Root/Planner/publication evidence remains unchanged.

Fresh Git observation after result verification requires unchanged canonical
root/HEAD and exact changed-path membership in C's file set. The trusted gate
result remains visible in the root composer-top surface and reports resulting
paths and STOP before Reviewer / Commit. Ordinary Git limits, including
exclusion of ignored untracked files, remain those defined by CAP.

Any failed or ambiguous switch stops without retry/replacement; the role may
already have switched. Ambiguous, rejected or malformed prompt admission stops
without redispatch and reports that implementation may have started. Later
failure grants no passing gate. There is no rollback, automatic role restoration,
review, commit, recovery, or retry.

## Verification and remaining work

### Automated verification

CAP/session/callback sequencing uses pure tests and test-scoped trusted host,
observer and JSX handler doubles. Real Git remains confined to production Git
boundary cases with immutable seed/private copies. Production freshness is not
cached or weakened for test speed. The diagnostic profiler follows the new
published authorization entry. The full baseline suite had 63 tests. The
issue #3 presentation change passed typecheck, the focused attempt suite (50
tests), and the full suite (65 tests). Issue #4 adds pending stale-frame,
full-proof invalidation/recovery, and post-claim resize/replacement-cleanup
regressions with the same test-scoped doubles. Claimed non-layout drift tests
also cover location, projection, native transcript and permission mutation.
The issue #4 implementation passes typecheck, the focused attempt suite (55
tests), and the full suite (70 tests).

### Live PASS evidence

Live OpenCode 2.0.20 dogfood verified the following:

- A clean fresh attempt ran Orchestrator → Planner → inert implementer slot.
  The readable trusted Plan appeared in the root TUI, and the composer-top
  authorization surface appeared only after publication and readability checks.
- Before Authorize, `git status` stayed clean and `README.md` stayed unchanged.
  Clicking the trusted local pointer Authorize admitted implementation, and
  `README.md` contained exactly `# published-plan-authorization-dogfood`.
  The Git delta contained only `README.md`, HEAD was unchanged, and the flow
  stopped before Reviewer / Commit.
- Clicking Cancel admitted no implementation, left the worktree clean, and did
  not restore authorization later in that attempt.
- An ordinary untracked dirty path at startup still allowed planning and trusted
  Plan publication, with no Authorize / Cancel controls and a planning-only
  explanation that the worktree was dirty when the attempt started. Removing
  the file did not make that attempt authorizable.
- During a claimed pre-admission continuation, resizing caused STOP before an
  implementation prompt or repository edit. Restoring the old size did not
  restore authorization; the worktree remained clean. This is the historical
  behavior before the issue #4 fix, not the new implemented resize policy.
- After the issue #4 fix, live dogfood at HEAD
  `9754a33057efa894aac2e65826129b656a66c636` passed pending resize recovery,
  post-claim shrink, an additional shrink that completed while still narrow, and
  root-route invalidation after claim. The successful attempts retained
  unchanged HEAD and exact `README.md` scope, and stopped before Reviewer /
  Commit. See [the issue #4 live dogfood report](issue-4-live-dogfood.md) for
  the full evidence and limits.
- Dogfood found the startup failure caused by applying `structuredClone` to
  OpenCode 2.0.20's Solid-store-backed `context.location`. The implementation
  now snapshots only immutable primitive identity fields (`directory`, optional
  `workspaceID`), and fresh plugin startup was verified afterward.

### Dogfood findings and tracked follow-ups

- Issue #4, `[Feat]: Allow terminal resize after authorization claim`: baseline
  dogfood permanently stopped a claimed attempt on resize before prompt dispatch.
  The implemented fix keeps pending resize inert until a fresh fully valid frame
  and allows resize after a valid local click synchronously claims the exact
  immutable attempt. Non-layout CAP admission checks remain active. Pending
  recovery, post-claim shrink, and root-route invalidation after claim passed
  live; the old STOP remains documented as pre-fix history. Automated regression
  coverage includes the narrow-to-wide claimed sequence, but live implementation
  completed while still narrow before a deliberate resize back could be made.
  See [the issue #4 live dogfood report](issue-4-live-dogfood.md).
- Issue #7, `[Feat]: Allow authorization at narrow readable terminal sizes`, is
  a separate layout-policy follow-up from issue #4 dogfood: at roughly 70
  columns the pending surface remained readable and the attempt stayed alive,
  while Authorize remained inert under the existing fixed 80×24 minimum. This
  restriction does not block issue #4's resize-recovery or post-claim behavior.
- Issue #5, `[Fix]: Allow Plan publication while inspecting Planner`: entering
  Planner before trusted root Plan publication, then allowing Planner/root to
  complete, reproduced the root-view guard STOP. Returning to root showed only
  model-authored `Plan prepared; awaiting human authorization.`; the trusted
  synthetic Plan had not been published, and the worktree stayed clean. This is
  CAP safety fail-closed behavior and a publication/DX failure. Desired behavior
  is to let child inspection coexist with trusted Plan publication while
  keeping authorization root-only.
- On a dirty initial worktree, the trusted planning-only strip correctly says
  the attempt cannot be authorized, while Orchestrator model-authored prose may
  still say `awaiting human authorization`. Model-authored prose is not
  authority.

### Remaining unverified live cases

The following live cases remain unverified: reload/restart during a pending
authorization attempt fails closed; location/workspace identity changes during
an attempt; unexpected root wake or additional root input after publication;
direct inspection that the exact same retained implementer slot receives
exactly one trusted implementation prompt; exact-scope rejection for an
out-of-scope implementation result; and longer or scrollable Plan presentation
with a compact authorization surface under realistic content. Keyboard
authorization is unimplemented and out of this milestone.

The issue #2/#3 copy and persistent status lifecycle are covered by automated
callback/layout doubles but have not yet been rechecked in live OpenCode 2.0.20.
Live verification should confirm the pending question fits, the status remains
visible after Authorize and Cancel, completion shows the trusted gate result,
and pre-dispatch versus post-dispatch STOP copy matches the actual outcome.

One fresh root and one attempt per activation remain the milestone's limit.
Later work establishes independent Reviewer, an exact reviewed target, and
separate Commit authorization/execution under CAP. None is implemented here.
