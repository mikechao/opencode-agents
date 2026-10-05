# Issue #25 — bounded Planner admission investigation

## Finding and disposition

**The smallest supported seam is a narrow TUI-to-server initial-evidence RPC,
checked by the existing governed Planner executor wrapper before model
preparation and again at its final synchronous admission barrier.** The RPC
transports an immutable observation; it creates no CAP authority.

However, **post-creation registration can race the first Planner invocation**.
OpenCode does not await TUI creation listeners or their RPCs before prompting
the root. Missing registration can safely reject Planner, but there is no
supported ordering guarantee that a valid clean root's first call will find its
registration. Generation/reload rejection also needs an explicit bounded rule;
ordinary plugin RPC does not supply a caller-generation identity.

These trigger the requested stop conditions. This is an implementation handoff,
not approval to proceed directly to implementation. Choose whether fail-closed
rejection of a racing clean call is acceptable before implementing B. If
registration must reliably precede the first Planner call, the inspected public
interfaces do not establish that seam; do not compensate with retries, model
instructions, or a lifecycle registry.

Baseline: `opencode-agents` was clean on `main` at
`70d1ee61a333b514abaf822397be11b3e363a9b7`. Read-only upstream:
`../opencode`, plugin version 2.0.22, commit
`527f0b931d1f9b3ebd34e106c51b31ce5db5b075`. No OpenCode launch or implementation
changes. Only this document was created.

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
| B: TUI registers bound evidence | Public plugin RPC already joins these layers. TUI can send the existing trusted evidence after exact Created binding; the native wrapper can refuse until validated evidence exists. | Preferred conditional seam. Safe denial is supported; reliable registration-before-first-call ordering is not established. |
| C: TUI pre-execution veto | TUI `Context` supplies client/data/UI/storage APIs, but no awaited tool-execution veto. `data.on/listen` handlers return void. The rejecting `tool.execute.before` hook belongs to the server Effect plugin. | Reject. Notification, navigation, UI disabling or cancellation cannot veto the exact call deterministically. |
| D: smaller existing seam | The current executor wrapper and root-keyed Planner latch are already the admission boundary. Neither shares TUI evidence. Public session metadata/creation payload and transcript claims are not trusted eligibility sources. | Reuse the wrapper; no smaller supported evidence-transfer mechanism was found. |

A is source-backed by upstream `packages/plugin/src/effect/session.ts`,
`effect/event.ts`, `packages/core/src/session.ts:250` and `bus.ts`.
C is source-backed by `packages/plugin/src/tui/context.ts`, `tui/plugin.ts` and
`packages/core/src/plugin/hooks.ts` (only tool-before hooks have a rejection
channel). Server event streams do not intercept creation; even replay would
recover Created identity, not an earlier Git observation.

## B: minimum bookkeeping and its limits

**Why it works:** the intended trusted TUI transfers the observation it actually
made, bound to the root it actually prepared. The server checks that binding
before spending Planner admission. Later Git cleanup cannot change the frozen
initial result. Registration supplies no implementation permission, authorization
claim, native wake, Plan, or workflow transition.

**Evidence/state:** retain only an activation-local root record sufficient to
recompute initial eligibility and compare actual host identity: root session ID,
exact location ref, canonical baseline root/HEAD/paths, observation completion
time, and trusted creation identity/time/initial role/parent/location. Do not
serialize the mutable TUI `Generation` object as an assertion of liveness.
The server must compare the creation time with `Session.Info.time.created`,
not merely its own two reads with each other. Upstream
`packages/core/src/session/projector.ts` derives that time from Created.
Keep initial eligibility separate from the existing consumed Planner latch.

**RPC trust:** `context.rpc.register()` and TUI `context.client.rpc(definition)`
are supported and already used by [authorize-rpc.ts](../../src/authorize-rpc.ts).
Upstream `packages/server/src/handlers/rpc.ts` waits for location plugin
activation; `packages/core/src/rpc.ts` validates the method contract, invokes the
selected handler and scopes its registration to plugin lifetime. Its handler
context contains an error factory, **not authenticated caller/TUI identity**.
Explicitly route to the captured location and validate it against server location
and root identity. Canonical local correspondence must remain required.

This uses the existing host/TUI/local OS TCB described in
[CAP](../coding-authority-protocol.md), “Authority and trust”; it does not
materially change origin assumptions within that boundary. A model argument,
synthetic record or claimed eligibility flag is not an alternate producer. Do
not extend this finding to independently authenticated remote callers/topologies.

**Earliest safe registration:** synchronously freeze the evidence at matching
Created consumption/`ownRoot()` entry, then submit that exact object. Optimistic
preparation has a root ID but not yet the authoritative creation event/time;
registering it earlier would require pending-registration machinery and still
lacks an awaited ordering guarantee.

**Latest required completion:** validated server insertion must complete before
`prepare(receipt.input)`. After all awaited preparation/history work, the final
synchronous barrier must verify that the same admissible record remains live
and bound, immediately before the existing one-shot insertion/native call.
An optional early before-hook rejection is not a substitute for these checks.

**Ordering/race:** upstream `packages/client/src/solid/data.ts:1445` returns an
optimistic ID plus a create promise. `sendAdmission()` (line 356) waits for create,
the previous send and the caller's gate. TUI prompt submission supplies a gate
for creation/environment setup (`packages/tui/src/component/prompt/index.tsx`,
lines 1249, 1368). It contains **no plugin registration promise**. The create
response and the Created event reaching the TUI are separate delivery paths.

```text
server commits Created → create response → root prompt → root Planner tool
                      ↘ TUI receives Created → registration RPC → insertion
```

There is no happens-before edge from insertion to the tool. Even when the
notification arrives first, asynchronous registration need not finish first.
The data layer has a caller-owned prompt `gate`, but the public plugin Context
does not expose a way to add to the host composer's gate. Monkey-patching client,
data or host internals is not a supported smaller seam.

Rejecting immediately when evidence is missing closes the **unsafe execution**
race without waits or retry machinery. It leaves a possible clean-call rejection.
Do not burn successful Planner admission or stamp its receipt on this rejection.
Do not promise automatic retry or first-call success. Whether a later explicit
call may use a subsequently arrived valid *original* record needs a stated policy;
it must never create a new baseline or resurrect a dirty/revoked record.

**Generation/teardown limit:** server teardown must clear admission records and
make retained handlers/executors reject. Root deletion, identity mismatch and
explicit retirement must prevent late registration from reopening that root.
TUI cleanup must retire local producers and prevent queued local work from
sending evidence. An already-sent registration/revocation can be delayed or
reordered; it cannot synchronously revoke server state by itself.

RPC chooses the newest registration by static ID and does not attach a producer
epoch. Consequently, checking a caller-supplied generation string, or clearing a
map on reload, alone does not prove that a delayed old request cannot reach a
new activation. Root ID plus creation time prevents replacement-root confusion,
but does not by itself reject the same old root across activation replacement.
A bounded rule proving current activation origin/retirement is still required
before accepting such evidence. No handshake, epoch exchange or lifecycle
registry is selected here; this is a remaining implementation prerequisite,
not a guarantee furnished by RPC.

## Fail-closed requirements and preserved invariants

- Absent, uncorrelated or unvalidated evidence: reject governed Planner before
  preparation/native entry. Ordinary root prose and `read`/`glob`/`grep` remain
  available; do not gate root creation or all prompts.
- Dirty or invalid initial ordering: immutable ineligible record for that root;
  no rescan, cleanup, home navigation, direct completion or later registration
  may turn it eligible.
- Duplicate registration: reject the duplicate without replacing the original.
  Conflicting/ambiguous evidence must close eligibility rather than select a
  convenient version. Registration is not a retry protocol.
- Mismatched root, creation time, role/parent, location/workspace or canonical
  baseline binding: reject. Old/deleted roots and stale activation generations
  must not inherit records. Unknown generation/retirement is a denial.
- Revocation during awaited reads/preparation: reject at the final barrier.
  Registration/revocation must never reset consumed Planner admission.
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

If the stop conditions are resolved, B affects the TUI preparation/Created/
cleanup path, a small project-owned admission RPC contract, its registration in
`server.ts`, and root-local checks/storage in `nativeAdmission()`.
`attempt.ts` may share the existing eligibility predicate without weakening
runtime validation or later authorization. Extend `test/attempt.test.ts` with
trusted host/RPC/Git-observer doubles for ordering, dirty→clean permanence,
missing evidence, duplicate/conflict, identity/location mismatch, delayed
registration, revocation and reload. Keep real Git tests at the existing Git
boundary; these orchestration cases do not need repositories or subprocesses.

Existing source/test anchors include initial ordering and dirty-clean permanence
(test lines 2507–2527), optimistic rollback/delayed creation/missing support
(850–1141), model preparation failure (4458–4485), root/turn/revocation admission
(5423–5490), and root-local one-shot/failed-admitted Planner coverage
(5272 onward, 5644 onward). These prove existing mechanics, not the proposed
registration ordering.

**Recommend B plus the existing executor wrapper, with denial on missing proof.**
A/C cannot prove or enforce the historical invariant through supported hooks;
D contributes the already-sufficient admission boundary but no evidence bridge.
B is the sole supported small transport candidate. Stop here: reliable
first-call ordering and stale-generation handling are not established enough
to claim an unconditional implementation-ready design. Do not expand this
investigation into recovery machinery to make them appear solved.
