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
→ eligible clean-initial attempt: compact root-only Authorize / Cancel strip
→ local Authorize claims exact PublishedAttempt synchronously
→ fresh publication/native/Git/liveness verification
→ one-use intent grant
→ same retained slot switches to authorized_implementer
→ exact switch + unchanged parent / Planner / publication verification
→ final read + clean Git + liveness barrier
→ consume grant → immediately dispatch one frozen implementation prompt
→ exact admitted input / switch / result binding
→ unchanged HEAD + exact Git changed-path scope gate
→ STOP before Reviewer / Commit
```

There is one authorization path. `runImplementationAttempt()` and its independent
modal confirmation have been removed. Reviewer, reviewed-target construction,
and Commit remain later work. Automated bridge checks pass; focused live
OpenCode 2.0.20 pointer/layout dogfood remains required and has not been run.

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
The strip shows the complete canonical worktree, Plan/HEAD prefixes,
“Implementation only,” Authorize and Cancel. It occupies at most three rows:
worktree at most two wrapped rows and controls on one row. It requires an
80×24-or-larger terminal and visible, unclipped worktree/control geometry.
Controls become live only after a completed renderer frame proves the layout. Unusable
layout, lost view, or later shrink permanently ends the pending authorization.
The full Plan is not duplicated in the strip.

Direct left-pointer handlers call an unregistered closure. There is no
keyboard authorization, Form/Question, slash/palette action, keymap command ID,
RPC route, session message, or model-callable tool for the decision. Authorize
and Cancel synchronously claim the exact pending object and remove controls
before asynchronous work. Duplicates, stale handlers, and racing decisions are
inert after the first claim. The click is a decision, not a grant.

Cancel clears authority-capable ownership, keeps the Plan readable, and reports
`Cancelled — no implementation admitted`; it creates no grant, switch or prompt.
Dirty/ordering statuses retain only presentation data and have no callbacks.

Observers are installed before publication. Only exact expected synthetic,
switch and implementation events are admitted, with RPC/history reconciliation.
Unexpected root execution, inbox lifecycle, transcript/control mutation,
permission/role/location changes, missing children, deletion/fork/revert/
compaction, route loss, renderer errors, or unreadable layout terminate the
attempt. Events revoke on receipt; independent server reads cover delayed
notifications. There is no broad busy-period event exemption.

Every awaited operation/page is followed by owner/generation/location and fresh
Git checks. Publication uses baseline path stability, pre-admission uses clean
freshness, and post-dispatch preserves root/HEAD without requiring cleanliness.
Cleanup synchronously revokes first, discards private ownership, then removes
contributions/subscriptions. Old promises cannot grant, dispatch, or report a
passing gate after revocation. New activations inherit no authority.

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
root/HEAD and exact changed-path membership in C's file set. The terminal gate
reports resulting paths and STOP before Reviewer / Commit. Ordinary Git limits,
including exclusion of ignored untracked files, remain those defined by CAP.

Any failed or ambiguous switch stops without retry/replacement; the role may
already have switched. Ambiguous, rejected or malformed prompt admission stops
without redispatch and reports that implementation may have started. Later
failure grants no passing gate. There is no rollback, automatic role restoration,
review, commit, recovery, or retry.

## Verification and remaining work

CAP/session/callback sequencing uses pure tests and test-scoped trusted host,
observer and JSX handler doubles. Real Git remains confined to production Git
boundary cases with immutable seed/private copies. Production freshness is not
cached or weakened for test speed. The diagnostic profiler follows the new
published authorization entry; timing checks must use the updated test count.

A focused, explicitly authorized live OpenCode 2.0.20 dogfood remains required:
clean pointer Authorize; Cancel with no switch/prompt; dirty inert status;
readable/scrollable Plan and compact strip; root/view/navigation/location/resize/
reload fail closed; same retained slot and one prompt; unchanged-HEAD/exact-scope
acceptance and rejection; STOP before Reviewer/Commit. Keyboard authorization
is not implemented. No live dogfood or automatic launcher is part of the
current implementation verification.

One fresh root and one attempt per activation remain the milestone's limit.
Later work establishes independent Reviewer, an exact reviewed target, and
separate Commit authorization/execution under CAP. None is implemented here.
