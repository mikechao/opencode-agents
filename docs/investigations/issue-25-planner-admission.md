# Issue #25 — bounded Planner admission investigation

**Deferred; closed as not planned.** Current OpenCode does not provide a
sufficiently clean pre-Planner admission seam. The current runtime permits
planning from a dirty baseline and denies implementation authorization.
Retain this non-normative investigation for a future host update that could
resolve the evidence-delivery and authoritative creation-identity gaps below.
Its proposed implementation is not an active plan or a runtime requirement.
See [current orchestration](../v1-orchestration.md#current-limitations).

## Finding and disposition

**The smallest supported seam is a narrow TUI-to-server initial-evidence RPC,
checked by the existing governed Planner executor wrapper before model
preparation and again at its final synchronous admission barrier.** The RPC
transports an immutable observation; it creates no CAP authority.

Follow-up conclusion: **a root-local one-shot rendezvous can await registration
without deadlocking its delivery path, but cannot guarantee bounded failure
without a deadline.** No supported signal guarantees notification that an absent
TUI producer can no longer register. A deadline would safely deny, not prove
producer loss; no duration is selected here. Immediate rejection remains safe.

**Producer generation/epoch identity is unnecessary for the historical fact.**
Reload or producer teardown does not invalidate a true observation about the
same exact root. Correct binding needs authoritative *root creation* identity,
not producer identity. Session ID and millisecond creation time alone have a
reuse/collision limitation described below.

**Not implementation-ready under the requested timer-free bounded rendezvous.**
The remaining decision is a bounded missing-evidence policy (deadline or
immediate rejection). Authoritative current Created-event verification also
needs a supported path for ID/time aliasing and acceptance across replacement;
the server plugin Context exposes live events but not session-log replay.

Baseline: `opencode-agents` was clean on `main` at
`70d1ee61a333b514abaf822397be11b3e363a9b7`. Read-only upstream:
`../opencode`, plugin version 2.0.22, commit
`527f0b931d1f9b3ebd34e106c51b31ce5db5b075`. No OpenCode launch or implementation
changes. Only this document was created.

Follow-up started with a clean working tree at `a9736e2` (the committed first
investigation). It changes only this handoff and does not revisit the established
Planner lifecycle, implement code, run OpenCode, commit, or push.

## Execution boundary and existing evidence

In [native.ts](../../src/native.ts), `execute()` routes Orchestrator-to-Planner
calls through `executePlanner()` (lines 385–495, 515–521). For a governed root,
it reads root/history identity, constructs the trusted effective input, calls
`prepare(receipt.input)` (line 426), rereads history, synchronously inserts the
one-shot `planners` entry, then invokes `original()` (line 450).

Thus there are two relevant boundaries:

- The project gate must precede **managed model preparation** at line 426.
  [agent-models.ts](../../src/agent-models.ts), `prepare()`, reads preferences and
  validates the catalog; it currently carries no admission authority and creates
  no child.
- Calling the **original native executor** is the last project-controlled
  boundary before native work. Upstream
  `packages/core/src/tool/plugin/subagent.ts`, `Plugin.execute`, resolves parent,
  depth, agent, permission and model, then calls `sessions.create()` for a fresh
  child, emits progress, admits its prompt, and starts/joins native work.
  Child creation is the first durable child effect; the prompt can wake model
  execution. A veto after child creation or progress is too late.

The server's `execute.before` hook is earlier and can reject a call. Its
composition precedes `models.before()` in
[server.ts](../../.opencode/plugins/opencode-agents/server.ts). Upstream
`packages/core/src/tool.ts` and `tool/runtime.ts` await the before hook and then
decode/invoke the transformed executor. The executor wrapper remains the
essential boundary: hook-only admission would not protect retained/direct
executor entry or revocation across its awaited reads.

Trusted initial evidence already originates in
[tui.tsx](../../.opencode/plugins/opencode-agents/tui.tsx):

1. Setup and subsequent home/location preparation call synchronous `observeGit`
   and retain `Date.now()` **after** observation completes (lines 41–54).
2. A reactive watcher sees a new optimistic Orchestrator root ID at the matching
   location. A microtask checks `session.creating(id)` and binds that exact ID
   to the retained home observation before the deferred create RPC starts
   (lines 77–117).
3. Only the matching `session.created` event consumes that preparation once and
   installs `ownRoot()` (lines 725–740). Child sessions, location mismatches,
   duplicate roots, rollback/deletion tombstones and absent correlation are
   excluded. Returning to an existing root does not observe a replacement
   baseline.
4. The root owns its original baseline and creation event. Today,
   `ActivationEvidence` is assembled later during completion inspection; the
   ingredients are already available at `ownRoot()` entry.

[attempt.ts](../../src/attempt.ts), `activationEvidence()` and
`initiallyAuthorizable()` (lines 133–159), freeze evidence and require empty
baseline paths, finite observation/creation timestamps, strict
`creation.created > observationCompletedAt`, initial Orchestrator role, no
parent, and exact primitive location identity (`directory`, `workspaceID`).
[git.ts](../../src/git.ts), `observeGit()`, establishes canonical local Git root,
valid commit HEAD and staged/unstaged/ordinary-untracked paths, excluding ignored
untracked files. It checks root/HEAD again at observation completion.

This is trusted observed-baseline evidence, not an atomic filesystem snapshot
or a guarantee that no file changes occur between observation and creation.
Equal timestamps, clock/order uncertainty and observation failure are
ineligible. Do not broaden the existing guarantee in #25.

The TUI process/setup closure owns this evidence. The server has root identity,
creation time, location and transcript evidence, but no original Git baseline or
trusted correlation to the TUI's pre-create observation. Current Git and session
history cannot reconstruct those missing historical facts.

## Candidate seams

| Approach | Finding | Decision |
| --- | --- | --- |
| A: server observes before each creation | Public `SessionHooks` contain prompt/context/model hooks, not a pre-create interceptor. `Session.create()` checks/creates the session and publishes Created; plugin event subscription observes already-published events. No exposed hook couples a pre-create Git scan to that exact root. | Reject. Created-time or prompt-time scans are too late; an activation-time scan cannot prove each later root's baseline. |
| B: TUI registers bound evidence | Public plugin RPC joins these layers. A root-local deferred in the native admission closure can receive either arrival order without blocking registration. | Preferred seam; timer-free bounded termination for absent evidence is not supported. No producer epoch is required. |
| C: TUI pre-execution veto | TUI `Context` supplies client/data/UI/storage APIs, but no awaited tool-execution veto. `data.on/listen` handlers return void. The rejecting `tool.execute.before` hook belongs to the server Effect plugin. | Reject. Notification, navigation, UI disabling or cancellation cannot veto the exact call deterministically. |
| D: smaller existing seam | The current executor wrapper and root-keyed Planner latch are already the admission boundary. Neither shares TUI evidence. Public session metadata/creation payload and transcript claims are not trusted eligibility sources. | Reuse the wrapper; no smaller supported evidence-transfer mechanism was found. |

A is source-backed by upstream `packages/plugin/src/effect/session.ts`,
`effect/event.ts`, `packages/core/src/session.ts:250` and `bus.ts`.
C is source-backed by `packages/plugin/src/tui/context.ts`, `tui/plugin.ts` and
`packages/core/src/plugin/hooks.ts` (only tool-before hooks have a rejection
channel). Server event streams do not intercept creation; even replay would
recover Created identity, not an earlier Git observation.

## B: trust and registration timing

Freeze the original fact at matching Created consumption/`ownRoot()` entry.
It already contains everything needed to recompute initial eligibility; do not
serialize mutable TUI `Generation` as a liveness assertion. Compare creation
with the host's actual identity/time, not merely two server reads with each other.
Registration carries no CAP claim, permission, native wake, Plan or transition.

Public `context.rpc.register()` / TUI `context.client.rpc(definition)` are
already used by [authorize-rpc.ts](../../src/authorize-rpc.ts). The host validates
the contract and scopes registrations to plugin lifetime, but supplies no
authenticated TUI caller identity. Explicitly route to the captured location,
validate against server/root location and require canonical local correspondence.
This retains the existing host/TUI/local OS TCB in
[CAP](../coding-authority-protocol.md), “Authority and trust”; it introduces no
new origin assumptions or remote authentication guarantee. Model arguments,
synthetic records and claimed eligibility are not alternate producers.

Upstream `client/src/solid/data.ts`, `create()` / `sendAdmission()`, and
`tui/src/component/prompt/index.tsx`, `newSession.gate`, gate prompts on creation
and environment setup, not plugin registration. Created-event delivery is
separate from the create response. The public plugin Context cannot add a promise
to the host composer's gate. Thus registration may finish before or after the
first Planner call. The rendezvous below addresses either arrival order; it does
not guarantee that registration will ever arrive.

## Follow-up 1 — one-shot rendezvous

### Delivery can run while Planner awaits

The following paths have no shared lock held across the proposed wait:

- Upstream `session/run-coordinator.ts`, `start()`, forks a session execution
  fiber. `session/runner/step.ts:100–145` publishes Tool.Called, then forks an
  **interruptible** tool execution and later joins it. `tool.ts`, `snapshot()` /
  `executeTool()`, invokes the transformed executor without an execution-wide
  database transaction or plugin activation lock.
- TUI registration uses a separate HTTP plugin RPC request.
  `server/src/handlers/rpc.ts` waits for plugin readiness, then invokes
  `Rpc.Service.call()`. `core/src/rpc.ts:108–149` decodes and invokes the handler
  directly; there is no session-run join, per-root send chain, RPC-call mutex,
  or requirement that the root be idle. `server/src/location.ts` supplies the
  shared location services to each request without a request-wide execution lock.
- A registration handler may read `context.session.get()` to validate identity.
  `plugin/host.ts:545` delegates to Session.get; `session/store.ts:95` reads the
  projected row. It does not wait for root execution. Any short database work
  precedes the deferred await; the wait must not be inside a transaction.
- `Plugin.awaitActivation` is a readiness latch (`core/src/plugin.ts`), not a
  latch held by tool execution. Current `server.ts` completes setup after
  registering its transforms/RPCs. Do **not** await admission in plugin setup
  or acquire a readiness hold: that would block the registration request.

Therefore a handler that validates identity, synchronously settles the
root-local deferred, and returns can unblock the tool. It must not call
`session.wait(root)`, await root settlement, steer/wake the root, or wait for
Planner: those would introduce a circular dependency. TUI event delivery also
continues independently; the already-committed Created notification is not
waiting for this tool result.

This establishes absence of a lock/ownership deadlock for the proposed narrow
path, not eventual delivery or a bound on network/database scheduling.

### Smallest owner and both arrival orders

Keep one admission map in the existing `nativeAdmission(context)` closure,
separate from `planners`. Its entry has one immutable root identity and one
one-shot deferred/result, with pending, validated fact or terminal denial as
mutually exclusive cases. No worker, queue, scheduler or persisted state.

- Registration first: validate actual root binding, select/create its record,
  freeze the fact and settle it. Planner later reads the same result.
- Planner first: validate the exact governed root/call, synchronously
  select/create that record, then await its deferred. Registration selects that
  same record and settles it with eligible or ineligible evidence.
- Select/create must be atomic with no await between lookup and insertion.
  Duplicate invocations share one deferred; multiple subscribers do not create
  independent admission attempts. The existing transcript checks still reject
  ambiguous call contenders. After evidence arrives, the existing final
  `planners.has()` / `planners.set()` barrier admits at most one winner.
- Dirty or invalid original ordering settles denial. Exact duplicate registration
  cannot replace the result; conflicting evidence closes admission. A legitimate
  root has only one original observation binding, not a sequence of baselines.
- Server teardown marks the owner closed and settles every pending deferred with
  failure immediately. Its finalizer must never await registration. Retained
  executor/handler closures continue to check `live()`.
- Native tool interruption remains interruptible; it cancels that invocation's
  subscription, not the historical fact. Session deletion interrupts execution
  before awaiting idle (`Session.remove():355–365`), so deletion need not wait
  for a successful registration. Terminal session identity loss denies admission.

Waiting, syntax failure or pre-admission interruption does not insert `planners`
or stamp its admission receipt. Dirty/invalid proof remains terminally
ineligible independently of that successful-execution latch. If a deadline is
chosen, its terminal denial must not be reopened by late registration or reset
by another invocation; it still does not masquerade as successful Planner
admission. No automatic or model-driven retry follows any outcome.

### Gate location

Place the wait after exact governed root/call checks and before
`prepare(receipt.input)`. Because waiting adds an arbitrarily long suspension,
reread and validate current root/creation/location and the exact transcript/call
**after** it resolves, before preparation. The original timestamps and baseline
stay frozen. After preparation and the existing final history read, the
synchronous barrier rechecks the selected record's identity/result, live server
owner, current admission invariants and the existing one-shot latch, then inserts
`planners` and calls `original()`. No Planner preparation, child or model work
occurs while admission is pending.

### No timer-free bounded absence result

Success and explicit ineligible registration deterministically settle the wait.
Server teardown and invocation interruption deterministically stop their own
waits. None guarantees a terminal result for every missing registration:

```text
root is created and prompted
→ TUI has no valid preparation, misses Created, or exits before sending
→ server and root execution remain alive
→ Planner awaits an admission result that nobody will send
```

The current TUI Created handler silently returns without matching preparation.
Changing it to send a negative result would cover a live, informed TUI only.
A disconnected/exited producer or failed RPC still cannot deliver that negative.
The live bus explicitly offers no replay across disconnects (`core/src/bus.ts`,
`Subscribe`); its session log contains no project admission-producer completion.
Public plugin/TUI event contracts expose no root-bound producer-loss signal.
`location.shutdown` means the location services ended, not that the TUI died.
TUI teardown cannot guarantee a farewell RPC, and surviving server execution is
not scoped to the TUI HTTP connection. Root completion is also unusable as an
absence signal: it is waiting for this tool. User interruption is possible, not
an automatic bound on inability to establish evidence.

Thus **the timeout-free rendezvous is safe to suspend but can hang forever**.
A finite admission deadline is required if every missing-proof call must settle
without external cancellation. A deadline can be CAP-safe: atomically resolve
terminal denial, never success; racing/late registration cannot reopen it.
Its duration expresses an availability/product policy, not evidence validity or
proof that the producer is gone. No delay is proposed just to make transport
races unlikely. Without deciding that policy, the requested bounded design is
not implementation-ready. A producer epoch would not solve this absence case.

## Follow-up 2 — historical identity, not producer generation

### Same root after reload, navigation or teardown

For the **same actual host root and Created event**, its original observation
remains exactly the fact #25 needs after TUI reload, plugin reactivation,
navigation, producer teardown, server re-registration or delayed RPC delivery.
No concrete violation follows merely because the producer is old. Baseline
cleanliness is historical; teardown cannot make it false, nor can Git cleanup
make an originally dirty baseline clean.

The prior pass incorrectly required current producer-generation identity and
remote eligibility revocation. Neither is an initial-evidence invariant.
Keep server-owner `live()` checks for retained code, but do not add a producer
epoch, activation handshake, generation registry or TUI revocation protocol.
A replacement server may accept a delayed immutable fact if it independently
proves the same root binding; registration must never reset an existing consumed
Planner latch or recreate a CAP claim. The existing root role/no-parent/location,
fork/revert/archive/permissions and exact-turn checks govern present admission.
Earlier admitted/governed turns fail `plannerTurnInput()` / `nonGovernedTurn()`;
missing/compacted history cannot prove a fresh governed turn. Those checks, and
later independent TUI/CAP authorization checks, stay in place. A never-governed,
initially clean root may correctly start Planner later if its current identity
and turn remain admissible; producer disappearance is not a new lifecycle veto.

### Deleted root, reused ID and creation identity

Normal new IDs use randomized `SessionID.create()`, but the host accepts explicit
IDs. `Session.create():250–253` returns an existing row if present; deletion
removes the projected row and event aggregate (`Session.remove()` and
`bus.remove()`). There is no permanent ID tombstone. A deleted ID **can be reused**.
An unacknowledged optimistic retry is also supported; the TUI's existing rollback
tombstones prevent it from borrowing an abandoned preparation. That producer
rule must remain, regardless of server rendezvous design.

Different authoritative creation times distinguish ordinary same-ID recreation.
They are millisecond wall-clock values (`Bus.publish()` uses
`Clock.currentTimeMillis`), not a uniqueness/monotonic-incarnation guarantee.
Consequently ID + time + location alone cannot prove every incarnation:

```text
clean observation O → old root R created at wall time C → registration delayed
→ R deleted → wall clock revisits C → explicit ID R recreated dirty at same L
→ old registration matches R, C and L → original-clean claim applied to new root
```

The same-millisecond case likewise has no source-level uniqueness guarantee.
The missing field is **current authoritative Created event identity**, not
producer epoch. A caller-provided event ID alone is insufficient: it must match
the host's current root creation, rather than merely an old event the caller
retains.

The sufficient tuple is:

```text
K = (sessionID, authoritative Created event ID, Created timestamp,
     exact Location.Ref(directory, workspaceID))
F = (K, original canonical Git root/HEAD/paths, observationCompletedAt,
     initial Created role/parent/location)
```

Verify `K` against current authoritative host creation evidence and Session.Info;
freeze `F`, check the existing initial-eligibility predicate, and never replace
it. One exact `K` cannot legitimately have both a clean and a dirty initial
baseline. Conflict means ambiguous/invalid trusted evidence and denies; producer
recency is not a rule for choosing a winner. Differing `K`s must not share a
waiter or fact even when their session IDs coincide.

The public HTTP/client `session.log` endpoint supplies current durable creation
evidence (`Session.log():393`, server session handler `session.log`), but it is
**not** included in Effect plugin SessionDomain or `plugin/host.ts`. Session.Info
exposes time, not Created event ID. Live `context.event.subscribe()` supplies
Created IDs, but its asynchronous consumer is not a barrier guaranteeing that a
cached event describes the current incarnation during ID/time aliasing. A
caller-supplied event ID or such a cache alone cannot solve that counterexample.
Do not assume a replay API on Context or introduce an HTTP/authentication
arrangement implicitly. Authoritative current-creation verification remains a
specific requirement if supporting explicit ID reuse/time aliasing or accepting
old roots after replacement. No producer epoch or persisted registry is selected.

### Revocation versus eligibility

A delayed TUI farewell must not invalidate or compete with a true historical
fact; no such RPC is required. Current root removal/identity change, server
owner teardown, invocation cancellation and the existing admission/authorization
checks govern whether work may proceed now. Server teardown rejects its pending
waiters and discards its ephemeral records; a new owner starts empty, but
producer age alone does not disqualify any subsequently verified historical
fact. This does not persist or recover implementation authority.

## Fail-closed requirements and preserved invariants

- Pending evidence: suspend before preparation only under a selected bounded
  absence policy; absent/uncorrelated/unvalidated evidence never admits native
  work. Ordinary prose and `read`/`glob`/`grep` remain available outside the
  pending tool; do not gate root creation or all prompts. A waiting tool keeps
  that root turn busy until it settles or is interrupted.
- Dirty or invalid initial ordering: immutable ineligible record for that root;
  no rescan, cleanup, home navigation, direct completion or later registration
  may turn it eligible.
- Duplicate registration: reject the duplicate without replacing the original.
  Conflicting/ambiguous evidence must close eligibility rather than select a
  convenient version. Registration is not a retry protocol.
- Mismatched/unknown current root incarnation, creation, role/parent,
  location/workspace or canonical baseline binding: reject. Producer age is
  irrelevant once the exact historical root/fact is proven.
- Server-owner teardown, invocation cancellation or terminal admission closure
  during awaits: reject. Neither registration nor teardown resets consumed
  Planner admission. No historical-eligibility revocation RPC is required.
- Admission remains limited to the existing governed root boundary; preserve
  nested passthrough, exact original/decoded arguments, trusted request/turn
  binding, no CAP-following Planner and one successfully admitted Planner per
  root. Failed syntax/settings/pre-admission calls remain non-authoritative.
- Preserve the independent TUI `initiallyAuthorizable()` check in
  `authorizePublishedAttempt()` (`attempt.ts:719`), published-attempt coherence,
  exact Planner/child/publication verification, positive readable-frame decision,
  candidate integrity and fresh Git root/HEAD/clean checks. Preserve server CAP
  claim/native admission/freshness checks. #25 only adds an earlier gate.
- No persisted eligibility, transcript recovery, workflow state machine, generic
  event bus, model-authored proof or current-Git-only substitute.

## Likely implementation touch points and recommendation

If the remaining policies/proofs are resolved, B affects the TUI Created binding,
a small admission RPC contract registered in `server.ts`, and one root-local
fact/deferred in `nativeAdmission()`. Cleanup closes pending server waits;
it does not send historical-fact revocations or producer epochs.
`attempt.ts` may share the existing eligibility predicate without weakening
runtime validation or later authorization. Extend `test/attempt.test.ts` with
trusted host/RPC/Git-observer doubles for ordering, dirty→clean permanence,
missing evidence, duplicate/conflict, identity/location mismatch, delayed
registration, cancellation/teardown, ID reuse and reload. Keep real Git tests at
the existing Git boundary; these cases do not need repositories or subprocesses.

Existing source/test anchors include initial ordering and dirty-clean permanence
(test lines 2507–2527), optimistic rollback/delayed creation/missing support
(850–1141), model preparation failure (4458–4485), root/turn/revocation admission
(5423–5490), and root-local one-shot/failed-admitted Planner coverage
(5272 onward, 5644 onward). These prove existing mechanics, not the proposed
registration ordering.

**Recommendation: B in the existing native admission closure; no producer epoch.**
Registration-first stores the immutable fact; Planner-first awaits its one-shot
result before preparation, then rereads current binding and preserves the final
one-successful-execution barrier. This has no delivery-path deadlock and adds no
authority or workflow state.

**Stop before implementation.** A timeout-free bounded absence result is not
supported: select immediate rejection or an explicit deny-only deadline policy.
Also establish current authoritative creation verification for the demonstrated
same-ID/time alias case; otherwise deny roots whose incarnation cannot be proven.
Do not silently assume timestamps are unique. These are the precise
remaining blockers. A producer-generation/revocation protocol solves neither.
