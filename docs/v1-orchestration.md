# V1 Orchestration

## Current architecture and status

This document owns actual OpenCode host/runtime sequencing and implementation
status. [CAP](coding-authority-protocol.md) owns normative authority invariants;
[the charter](charter.md) owns purpose and scope. Runtime simplification is
complete: the milestone-named runtime architecture has been retired. Its
[reconciliation report](m1-m2-runtime-simplification-reconciliation.md) is
historical evidence, not a current reading prerequisite.

The live TUI reaches trusted Plan publication and then remains idle. It does
not offer authorization of that Plan. `runImplementationAttempt()` currently
has no production caller; it is retained and tested, but not wired from the
published-plan flow. Reviewer, exact reviewed target and Commit are later work.

```text
LIVE TODAY
activation baseline
→ fresh root Orchestrator
→ Planner child
→ implementer_slot child
→ root completes
→ trusted exact binding
→ Proposal / IntentCandidate
→ trusted synthetic Plan publication
→ root remains idle

RETAINED AND TESTED, BUT NOT WIRED FROM PUBLICATION
clean/fresh native binding
→ trusted human authorization
→ same implementer_slot child switches to authorized_implementer
→ consume one-use authority
→ one exact implementation prompt
→ result binding
→ unchanged HEAD + exact Git changed-path scope gate
→ stop
```

The second path requires pre-publication native evidence and current clean
checks. It does not implement a handoff from the first path. In particular,
its binder rejects the synthetic parent extension created by publication.

## Runtime modules and live entry

| Source | Responsibility |
| --- | --- |
| [proposal.ts](../src/proposal.ts) | Exact `{ intent, plan, files }` parsing/path validation; frozen proposal/candidate; fixed encoding and SHA-256 digest; integrity checks; deterministic Plan and full confirmation rendering. |
| [cap.ts](../src/cap.ts) | Process-local generation liveness; intent grant creation and one-use consumption with exact digest/purpose checks. |
| [git.ts](../src/git.ts) | Read-only canonical root/HEAD/ordinary changed-path observation; clean freshness and exact scope gates. |
| [attempt.ts](../src/attempt.ts) | Native invocation/transcript binding; live `publishPlan()`; retained `runImplementationAttempt()`; exact prompt and modal readability checks. |

The [TUI plugin](../.opencode/plugins/opencode-agents/tui.ts) is the live
integration entry. It observes the activation Git baseline and calls only
`publishPlan()` when the adopted root emits `session.execution.succeeded`.
It imports no implementation entry, installs no authorization strip/callback,
and creates no grant. `attempt.ts` uses the three independent primitives;
there is no workflow service or milestone compatibility layer.

Git observation verifies the supplied location is the canonical worktree
root, binds HEAD, unions staged/unstaged tracked/ordinary untracked paths,
then rechecks root and HEAD. NUL-delimited paths are decoded exactly, deduplicated
and sorted; rename detection is disabled to preserve observable endpoints.
Ignored untracked paths are excluded. CAP defines the observation's authority
requirements and limits.

## Native roles and inputs

All four roles are host-loaded from [.opencode/agents](../.opencode/agents).
Rules start with deny-all, then allow the listed capabilities; binding rejects
session-level permission overrides.

| Role | Current configuration and meaningful behavior |
| --- | --- |
| `opencode-agents` | Primary Orchestrator; only native delegation to `planner` and `implementer_slot`. No edit, shell, execute, session-control, MCP, question or authorized-Implementer delegation. |
| `planner` | Fresh subagent; read/glob/grep only. Returns the exact three-field JSON proposal. No mutation, shell, execute or delegation. |
| `implementer_slot` | Fresh read-only subagent; read/glob/grep permissions, but bootstrap must use no tools and return exactly `READY`. Creating it grants no implementation authority. |
| `authorized_implementer` | Hidden subagent used only by the retained trusted switch path; read/glob/grep/edit/shell. Execute, delegation, session-control, MCP and question remain denied. Explicit `git commit` / `git commit *` denials provide defense in depth. |

For one exact plain user request, the Orchestrator is instructed to make two
fresh, sequential foreground `subagent` calls: Planner first, slot second.
Each call contains exactly `agent`, nonempty `description`, and `prompt`,
without `sessionID`, `model` or `background`. Planner receives `User request:\n`
followed by the exact request; the slot receives
`Reply READY only. Do not inspect or modify the repository.`

The Orchestrator then ends its turn without copying the proposal. Its final
prose is informational; binding requires nonempty final text rather than exact
sentence equality. The Planner and slot have distinct fresh child contexts.
The retained authorized turn uses the same slot child, receiving the frozen
artifact directly without the Planner's conversation context. Persistent role
capability is distinct from CAP authority as specified by CAP.

## Trusted native binding

`attempt.ts` waits for root completion and independently reads parent and
child session identities, activity/inbox state and complete message histories.
Pagination rejects repeated cursors and duplicate message IDs. Binding checks:

- Exact IDs, roles, parent relationships, activation directory, no fork,
  successful idle outcomes, and zero session permission overrides. Location
  comparison is directory-based and makes no broader host attestation claim.
- One first plain root user input without file/agent/skill attachments; one
  successful completed turn, nonempty final, and exactly two distinct native
  calls in Planner-then-slot order with fixed prompts and arguments.
- Distinct child/call/assistant-message IDs, completed native metadata, and
  full native result wrappers equal to independently read child results.
- Each child's single plain bootstrap input with the host's subagent prefix.
  Planner tools must be completed read/glob/grep calls; the slot must have no
  tools and exact `READY`. Bound sessions must be inactive with empty inboxes.

Attempt-local binding retains invocation, input and final-result IDs, exact
child text, and serialized parent/Planner/slot histories. Exact Planner P is
the concatenation of final text parts without trimming. It is parsed and frozen
with the trusted activation root and HEAD; Orchestrator output is not the
proposal transport.

## Plan publication semantics

Publication checks activation location, canonical root, bound HEAD and equality
of the observed changed-path set before and after native binding. A stable
pre-existing ordinary Git delta is permitted because publication grants no
authority. This policy compares paths, not file contents; it does not establish
clean implementation admission.

After another parent idle/inbox check, trusted code submits:

```text
session.synthetic(
  sessionID = bound root,
  text = exact raw Planner P,
  description = deterministic renderPlan(IntentCandidate),
  metadata = { source: "planner", planHash },
  resume = false
)
```

Raw P is the model-facing synthetic text. The human-facing description shows
the Plan, exact files, bound HEAD and explicit notice that no implementation
has been authorized. `planHash` is a truncated SHA-256 of raw P for diagnostics;
it differs from the candidate digest over proposal/root/HEAD. Neither hash,
the candidate, metadata nor presentation grants authority.

Returned admission is checked for synthetic type, exact parent session, exact
P and exact description. An immediately active root after admission is rejected
and reported. After successful publication, the plugin diagnoses later root
execution with a toast. These checks do not guarantee perpetual idleness;
a later human prompt can wake the root.

On the selected OpenCode host, `resume:false` prevents this synthetic call from
waking execution, and the TUI presents the synthetic description. Synthetic is
an inbox input, not a general display-only append API: a later root turn can
see P as model input. The retained implementation binder allows only the
original parent input/control history and therefore rejects publication's
synthetic addition before confirmation, switch or prompt.

## Retained implementation path

`runImplementationAttempt()` independently binds pre-publication native
evidence and constructs its own candidate; it accepts neither a published
candidate nor a cross-publication binding. Its tested sequence is:

1. Check current canonical root/HEAD and cleanliness, wait/bind native evidence,
   recheck cleanliness, then render the full candidate. Refuse if it cannot fit
   readably in the terminal.
2. Await trusted `ui.dialog.confirm`; require strict `true`. Recheck activation
   location, candidate integrity/readability, full bound histories and clean
   freshness; create the process-local intent grant.
3. Switch the exact slot child to `authorized_implementer`. Verify its unchanged
   bootstrap and single exact role switch, no input after switch, parent/Planner
   immutability, then verify the switched slot again after those awaits. Recheck
   location and clean freshness immediately before consuming the one-use grant.
4. Submit exactly one prompt containing the frozen proposal and bound root/HEAD.
   Check returned session/type, exact text, nonempty input ID and no attachments.
   Wait and bind the exact authorized input and successful result in that child.
5. Independently observe Git, require unchanged root/HEAD and exact changed-path
   membership in the authorized file set, return the gate result, and stop before
   Review or Commit.

An ambiguous switch/prompt or failed check ends the attempt without redispatch.
The original Orchestrator subagent row describes the inert bootstrap; the later
implementation turn is in the same child transcript, not a rewritten result
for that original row.

These checks establish current cleanliness after native bootstrap.
`requireFresh()` does not prove the activation baseline was clean. CAP also
requires cleanliness before Planner/slot bootstrap; future integration must
enforce that stronger condition, which publication currently does not require.

## Activation lifetime and current limitations

Each setup creates one activation-private generation and Git baseline. Only
one newly observed root `opencode-agents` session at the activation directory
is adopted; existing roots, children and later roots cannot replace it.
`attempted` is set synchronously before async publication or a failed/interrupted
root alert, and is never reset. The current limitation is **one fresh root and
one attempt per activation**, including failure; this document does not redesign
it. Multi-turn conversational routing and casual Planner bypass are absent.

The plugin retains only the frozen non-authorizing candidate and diagnostic
plan hash. Other native evidence is attempt-local. Cleanup first marks the
generation revoked, then clears the candidate and removes all five subscriptions.
Awaited host operations are followed by liveness checks; attempt busy state is
released in `finally`. Late retention/authority actions cannot cross revocation.
A replacement activation starts without inherited authority, even if server
sessions continue. There is no retry/recovery workflow.

## Future work: published-plan authorization, then review and commit

The selected future UX direction from the historical
[hybrid decision](hybrid-authorization-ux-decision.md) is a readable trusted
bound Plan in conversation plus a compact local `session.composer.top`
authorization surface with direct TUI-local **Authorize / Cancel** callbacks.
No model-mediated affirmative authorization is permitted. The Plan projection
already exists; the authorization strip and published-plan handoff are
**future/unimplemented**. A user cannot currently authorize the published Plan.

The next architectural problem is retaining and validating the exact
P/candidate and native evidence across synthetic publication, establishing
CAP's pre-bootstrap clean baseline and final freshness, and connecting a bound
positive local decision to one-use implementation admission. Result/STOP
presentation also remains future integration work. This is new authorization
integration, not unfinished runtime simplification.

Later work establishes an exact reviewed target, integrated independent Reviewer
and Reviewer-owned validation, followed by separate Commit authorization,
bounded execution and verified Git outcome. None is implemented today. Their
normative obligations are in [CAP's future contract](coding-authority-protocol.md#future-reviewer-and-separate-commit-contract);
this document does not design those subsystems.
