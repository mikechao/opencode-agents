# Issue #30: Repair and re-review source investigation

Investigated on 2026-10-06 from clean `main`, commit
`22a8da9170354a098e36401594a0be4d9ea55df4`. The selected sibling OpenCode
checkout reports `v2.0.24`; installed project dependencies pin
`@opencode/plugin` and `@opencode/schema` to `2.0.24`, and OpenTUI core/solid
to `0.5.14`.

The current GitHub bodies were read through `gh issue view`, including
[Issue #30](https://github.com/mikechao/opencode-agents/issues/30)
(updated `2026-10-06T20:31:20Z`) and
[Issue #22](https://github.com/mikechao/opencode-agents/issues/22)
(updated `2026-10-04T19:27:18Z`). #30 correctly treats review findings as
evidence and asks for a separate Repair boundary. #22 already requires a
separate Commit decision, but describes the original single implementation/review
path and references OpenCode 2.0.22. Its future integration must use the current
host and the latest review cycle.

This is historical evidence and a recommended architectural decision, not the
current product contract or a second normative specification. References below
name symbols in the investigated revision. Current normative owners remain
`docs/coding-authority-protocol.md` and `docs/v1-orchestration.md`. No OpenCode
execution, implementation, test changes, predecessor architecture import, issue
update, commit, or push was part of this investigation.

## 1. Current lifecycle and ownership

### Exact delivered path

| Stage | Owner and source symbols | Trusted state and effect |
| --- | --- | --- |
| Establish eligible root and publish Plan | `.opencode/plugins/opencode-agents/tui.tsx`: `setup`, `preparations`, `ownRoot`, `complete`; `src/attempt.ts`: `activationEvidence`, `publishPlan`, `bindNativeAttempt`, `verifyPublishedAttempt` | Original location/Git observation predates exact root creation. `PublishedAttempt` freezes activation, native Planner binding, candidate and synthetic publication. Initial mutation eligibility requires the original baseline to be clean. |
| Human Authorize | TUI `DecisionStrip`, `decide`, `guard.transfer`; `src/attempt.ts`: `authorizePublishedAttempt` | A current readable-frame callback claims the exact pending object synchronously. TUI rechecks Planner/publication, root/location, candidate, initial eligibility and fresh clean Git state. It transfers one `AuthorizeClaim`, then relinquishes local ownership. |
| Server acceptance and exclusion | `src/authorize-rpc.ts`: `authorizeRpc.methods.authorize`; `.opencode/plugins/opencode-agents/server.ts`: RPC registration; `src/native.ts`: `nativeAdmission`, `authorize`; `src/cap.ts`: `NativeCap.accept` | `caps` occupies the root slot before any RPC await. Acceptance copies/freezes the claim and creates an exact control ID/text. `authorize` claims location-local `executing` before clean admission observation and the synthetic wake. |
| Fresh Implementer | `src/native.ts`: `controlText`, `before`, `execute`, `actualCall`, `rootIdentity`, `local`; `NativeCap.reserve`, `enter`, `consume`, `receipt` | Exact first root contender reserves message/tool identity. Original published and decoded arguments must match the three-key contract. Model settings preparation precedes the final synchronous path/root/HEAD/clean barrier. CAP is consumed immediately before calling the original native executor with the Implementer-only sponsor actor. Native progress/result binds the fresh child. |
| Trusted implementation verification | `src/native.ts`: `authorize` settlement path, `verifyImplementation`; `src/git.ts`: `observeGit`, `requireInScope`, `observeReviewTarget` | Wait for root and exact child, establish supported successful child/bootstrap and persisted parent call agreement, then independently observe unchanged original HEAD and cumulative paths within proposal scope. Deep-frozen `VerifiedImplementation` contains original claim facts, invocation/child identity and exact content-bound `ReviewTarget`. CAP closes before the implementation receipt. |
| Fresh Reviewer | `src/native.ts`: `runReview`, `before`, `executeReview`; `src/review.ts`: `reviewerArguments` | Same accepted Authorize RPC automatically creates one `ReviewAttempt` under the root. It has its own control, exact arguments, admission, child binding and original structured result. Reviewer-only sponsorship leaves root static denial unchanged. The target is freshly rechecked before Reviewer consumption/native entry. |
| Trusted review verification | `src/native.ts`: `runReview` settlement path, `verifyReview`; `src/review.ts`: `parseReviewResult` | Root and exact Reviewer must settle. Role/parent/location/no-overrides, bootstrap, supported read-only history, one terminal assistant, structured native text and parent completion must agree. Final independent target and scope observation precedes parsing/acceptance. `ReviewOutcome` distinguishes verified results from unverified execution. |
| Root receipt and TUI result | `src/native.ts`: `publishReceipt`, `authorize`; `src/review.ts`: `reviewReceipt`; `src/receipt.ts`: `receiptInput`; `src/attempt.ts`: `authorizePublishedAttempt`; TUI `decide` promise callback | The server publishes implementation and review receipts as non-waking synthetic steers, then returns their combined **string** through the same Authorize RPC. TUI validates that it is a string, closes initial ownership and only toasts STOP if the text contains `unverified`. There is no structured final-review decision surface. |
| Cleanup | `src/native.ts`: `authorize`'s `Effect.ensuring`, `executeReview`'s ensuring, `teardown`; TUI `closeAuthority`, `dispose` | CAP and Reviewer admission close. `executing` releases only when exact settlement is proven; unknown settlement retains exclusion until activation teardown. `caps` and `reviews` entries remain in the closure. TUI initial `Ownership` becomes `closed`. |

`authorizePublishedAttempt` does not launch or verify workers itself. After
`guard.transfer`, the accepted server RPC is the execution and receipt owner;
TUI loss cannot resend the claim or publish a competing disposition. Server
`publishReceipt` catches publication failures and logs them without retrying or
changing the verified outcome. If root settlement is unreadable, review
publication may be withheld (`runReview` returns `publish: false`).

### Relevant host facts, checked only where needed

The authoritative host references are in `../opencode`:

- `packages/core/src/tool/plugin/subagent.ts`, `SubagentTool.Input` and
  `SubagentTool.Plugin`: omission of `sessionID` creates a new child; passing it
  continues a child. Native execution asserts permission using the explicitly
  supplied execution actor and actual parent/message/call **before** child
  creation. The child retains `parentID: context.sessionID`. Progress reports
  its ID before prompting. Fresh bootstrap is the fixed subagent prefix plus
  the supplied prompt. Foreground execution blocks through `jobs.block` and
  returns `{ sessionID, status, output }` with corresponding metadata. Host
  backgrounding is possible even for an originally foreground job, so root idle
  alone still cannot establish child settlement.
- The same module counts **ancestor depth**, using
  `experimental.subagent_depth`, rather than child count or prior launches.
  Repeated root siblings do not increase depth. There is no host requirement
  for a persisted repair count or numeric cycle limit.
- `packages/core/src/permission.ts`, `configured`, `evaluateInput`, `assert`:
  explicit actor takes precedence over the session agent; actual session
  overrides are merged; effective configured deny returns before permission
  hooks; effective ask otherwise creates a permission request. Project
  `sponsorPermission` narrows sponsors and rejects ask. Reusing a sponsor actor
  is safe only with a newly admitted exact call; an actor is capability policy,
  not a reusable human grant.
- `packages/core/src/session/session.ts`, `synthetic`, `wait`:
  synthetic input is admitted to the inbox; `resume: false` skips the wake.
  `wait` calls `execution.awaitIdle` and does not wake anything. It does not
  return a successful-outcome attestation; project code reads the session too.
  `packages/core/src/session/run-coordinator.ts`, `make`, serializes each
  session key, permits different keys concurrently, and follows successor busy
  periods in `awaitIdle`. It supplies no shared-repository lock.
- `packages/core/src/session/store.ts`, `SessionStore.context`, uses
  `SessionHistory.load(..., "latest")`. `packages/core/src/session/history.ts`,
  `latestCompaction` and `messageEntries`, can bound context at completed
  compactions. Existing verification fails closed if its control/call disappears;
  old transcript availability must not become authority recovery.
- `packages/core/src/rpc.ts`, `register`, `call`: latest registration for an ID
  selects the whole definition/handlers, schemas validate input/output, and
  scoped disposal removes registration. Calls race location closure. Promise
  routing in `packages/client/src/promise/rpc.ts` and
  `packages/server/src/location.ts`, `requestRef`, routes explicit directory;
  HTTP location selection does not provide a workspace selector. No independent
  human/TUI principal authentication exists at this RPC boundary.
- Installed `@opencode/plugin/dist/effect/session.d.ts`, `SessionDomain`, and
  host `packages/core/src/plugin/host.ts`, `PluginHost` context construction,
  expose `get`, `context`, `wait`, `synthetic` and session hooks, **not** server
  plugin `session.active` or `session.inbox`. The TUI Promise client exposes
  those reads and existing `src/attempt.ts` uses them. A follow-up must not call
  nonexistent Effect-context methods. Installed `EventDomain.subscribe` is a
  supported event stream, not a synchronous admission lock.

The original native input decoder and result publication remain host-owned.
`test/native-compatibility.test.ts` guards original published input, explicit
actor policy, fresh child/foreground completion and scoped RPC assumptions.
Repair must preserve those seams, including checking original input independently
of host-decoded input; the host normalizes some empty optional fields.

## 2. State available after `CHANGES_REQUESTED`

Distinguish the instant `verifyReview` returns from the state after the Authorize
RPC completes. The result is fully verified at that instant, but not all of it
is retained as a single reusable trusted object today.

| Evidence | What actually survives in the current server activation |
| --- | --- |
| Original frozen proposal | `caps.get(root).claim.candidate.proposal`; also a deep-frozen copy in `reviews.get(root).implementation.claim.candidate`. Closing CAP does not erase its data, though later lifecycle code should use captured evidence rather than CAP getters. |
| Original authorized path ceiling | Exact ordered `candidate.proposal.files`, with original encoding/digest. It is distinct from the smaller sorted **observed changed-path set** in `ReviewTarget.paths`. |
| Root/session identity | Accepted `rootSessionID` in the claim and `VerifiedImplementation.identity.rootSessionID`; root invocation message/tool IDs in implementation and review execution. Full TUI `Bound` includes original user/Planner/root-created evidence before transfer. The server claim does not retain that full binding or separately pin root creation time. |
| Repository root/location | `candidate.root`, `claim.location` (directory and optional workspace identity), and `ReviewTarget.root`. `local` compares host location and reruns path validation; Git observation independently canonicalizes the root. |
| Original bound HEAD | `candidate.head`, duplicated in `ReviewTarget.head`; it is the original pre-implementation HEAD, never a repair baseline replacement. |
| Implementation child/result identity | Frozen `VerifiedImplementation.identity`: root, parent assistant message, tool call and child IDs. `NativeCap` separately retains reservation and `{ childID, status: "completed" }`. It does **not** retain the full implementation `Tool.Result` or terminal implementation assistant ID. |
| Exact review target | Deep-frozen `ReviewAttempt.implementation.target`: root, HEAD, sorted cumulative paths and digest. |
| Exact parsed verified `ReviewResult` | `parseReviewResult` recursively freezes it. It flows through local `ReviewOutcome`, `runReview`, receipt rendering and the RPC string. **It is not installed in `reviews` or another long-lived verified-result slot.** After the call, only its text/result ingredients survive; those are not a pending repair grant. |
| Reviewer child/result identity | `ReviewAttempt.execution.call` is frozen, its child binding is a mutable discriminated object, and `execution.result` is the frozen original full native `Tool.Result`. The verified terminal Reviewer assistant ID is read by `verifyReview` but not captured in a retained verified-review identity. |

The `reviews` map retains a **closed attempt with execution ingredients**, not a
persisted verified disposition. `ReviewAttempt.failure` and admission are mutable.
The final RPC string and durable receipt are presentation/history, not a substitute
for a retained verified object. TUI `closeAuthority` discards its `PublishedAttempt`
from active `Ownership`; retained callback captures cannot restore eligibility.

For repair, capture a small deep-frozen verified-review evidence object while
`verifyReview` still has all the proven facts: `VerifiedImplementation`, parsed
result, Reviewer parent-call/child/terminal-result identity, and a root completion
boundary useful for pending-decision validation. This object certifies what
happened, without granting mutation. No original planning transcript reload is
needed: initial authority already transferred the frozen candidate intact.

### Current consumption and release points

| Resource | Exact current transition |
| --- | --- |
| Initial implementation CAP | `NativeCap.accept` permanently occupies the root; `before` reserves; `execute` enters once and consumes after final synchronous freshness checks immediately before native execution. `authorize` closes after implementation verification, including failures, before review/receipt transition. Ensuring closes again. Acceptance can never run again on that slot. |
| Implementer sponsorship/admission | `actor` and configured sponsor rules live for the plugin activation. Per-call authority is CAP, not the actor. After consumption no second reservation/entry is possible; terminal close does not restore it. `executing.native` retains settlement binding until the lease is released. |
| Reviewer sponsorship/admission | `runReview` creates one `ReviewAdmission`; `before` reserves; `executeReview` enters, checks target and consumes before native execution. Its ensuring and root settlement close admission. `reviewerActor` remains installed until teardown, without live admission. |
| Review state | Not released per outcome: `reviews` keeps the closed `ReviewAttempt`. `runReview` rejects `reviews.has(rootID)`, so it cannot currently create review B. Teardown closes and clears reviews. Parsed verified outcome remains transient. |
| Shared-worktree exclusion | `authorize` sets `executing = { cap }` before wake. It spans implementation, review, verification and receipt publication. `runReview` resets settlement proof for the new execution. Final ensuring clears it only if settlement is proven and this CAP still owns it; unknown settlement retains it until teardown. |

## 3. Human Repair / Stop seam

The smallest trusted seam is **after server review verification and factual
publication, before another mutation cycle**. It belongs to `nativeAdmission`,
which already owns accepted execution, target verification, worker sponsorship,
settlement, receipts and exclusion. The TUI owns understandable presentation and
the explicit positive human callback. Orchestrator owns neither decision nor
authority.

The existing Authorize strip is a useful presentation technique, not the existing
authority owner to reopen. Its `guard.transfer`/`closeAuthority` contract ends
initial Plan ownership. Its initial clean checks also cannot admit the dirty,
already-reviewed repair target. Add a distinct post-review presentation owner
bound to a **server-created pending decision identity** and verified evidence.

Recommended transport: let the completed Authorize RPC, and each later Repair RPC,
return a validated structured outcome containing factual receipt text and either
a terminal disposition or a pending Repair/Stop presentation. The server retains
the evidence; the presentation includes the decision identity, root/target
binding, original path ceiling and exact verified findings needed for a readable
choice. A decision RPC sends only the selected action and exact pending identity
for that root; it never supplies a replacement proposal, result or path set.
The existing `authorizeRpc` definition/server registration can accommodate this
without a new status service, polling, long RPC suspended on a human, or workflow
module. Its string output and TUI string check would need to change.

Prepare the pending evidence during the verified-result path, but make it
selectable only when publication has finished and the settled execution lease
has been synchronously released. Return the presentation after that transition.
The current server RPC remains the sole receipt owner. A failed receipt attempt
cannot forge success or retry execution; if the structured verified evidence is
still received and rendered, it can support the decision independently of receipt
delivery. If the evidence cannot be shown/readably bound, expose no Repair grant.

`Stop` closes that pending decision with no claim, execution wake, or filesystem
cleanup. A factual stop receipt may follow safe settlement. A lost response after
Repair transfer remains uncertain; no resend. A lost initial/follow-up outcome
provides no new TUI callback and must not be recovered from receipt text. Any
unreachable server-side evidence remains inert and is cleared/revoked on teardown
or competing execution.

### Supported presentation boundary

Installed plugin `Context` supplies `ui.slot.register`, the
`session.composer.top` slot, `keymap.layer` with `mode`, `enabled` and `priority`,
and host dialogs. Installed OpenTUI supplies `Renderable` geometry/liveness,
`onMouseUp`, and renderer `frame` events. Existing `DecisionStrip` composes
ordinary boxes/text, logical selection and a base-mode keymap; it does not take
global renderer focus. Use that small local composition for Repair/Stop with
the reviewed evidence and original authority ceiling visible, rather than
creating a generic decision framework.

Host `packages/tui/src/routes/session/index.tsx` mounts the slot above the composer;
`packages/tui/src/app.tsx` keys `SessionFrame` by route session ID. Normal navigation
disposes the rendered slot. Pending evidence must live outside the mount; return
to the root needs a new readable-frame proof. Preserve host dialogs, keymap modes,
mouse propagation and focus. TUI teardown drops callbacks; historical receipts
cannot recreate them. A deliberate Stop and presentation disappearance are
different factual events, though neither grants authority.

## 4. Worktree exclusion decision

### A: Hold through the human pause

Keeping `executing` attached to the old attempt avoids a governed lease handoff.
It still does not prevent external edits, so Repair would still require a fresh
target observation. An indefinitely open question would block every other
governed execution in this location even though all workers have settled. The
current TUI permits navigation away from pending surfaces; an absent or lost TUI
could strand that lease. Keeping the Authorize RPC open across the human pause
would also tie execution ownership to a long transport wait unnecessarily.
This is viable within the current trust boundary but has a substantial product
cost and does not eliminate freshness checks.

### B: Release during the pause — recommended

Keep exclusion through exact Reviewer settlement, final target verification and
receipt publication, as today. Then release it and retain only in-memory verified
evidence and a pending decision. Reacquire exclusion before Repair freshness
checks. This follows current cleanup ownership and avoids idle-human blocking.

The precise ordering should be:

1. The readable TUI callback synchronously claims its captured pending identity,
   removing duplicate callbacks. It validates root selection/location/evidence
   presentation and observes root activity/inbox through the supported Promise
   client. Only known pending receipts from this governed execution are acceptable;
   arbitrary pending user/synthetic/compaction input is not. The **Repair action**
   is the positive authorization, not finding publication.
2. On server receipt, synchronously select the exact current pending object and
   spend its decision eligibility before any await. Create a distinct one-shot
   repair claim bound to its server-held evidence. A Stop/Repair race has one
   winner; losers cannot close or replace that winner.
3. Synchronously acquire the location's `executing` lease for this repair owner
   before any worktree freshness observation. If occupied, close the new claim
   and terminate this repair request. Do not queue it, retry it, or restore the
   consumed decision. Reacquisition and ownership selection can share a single
   synchronous barrier.
4. Complete supported awaited root/context reads and any preparation. Confirm
   root ID, Orchestrator role, no parent/fork/revert/archive, unchanged location,
   empty overrides and a supported settled root boundary. Check that no unrelated
   continuation or competing child/input has superseded the pending decision.
   Use exact recorded receipt/control identities where needed; receipts are
   allowed presentation inputs, not evidence reconstructed into authority.
5. After those reads, synchronously recheck live activation, exact claim/decision
   ownership, lease ownership and frozen candidate integrity; rerun
   `parseProposal` against the original canonical root for current path topology.
   Observe and compare the **entire exact reviewed target**, including unchanged
   canonical root, original HEAD, exact changed paths and content/index digest.
   `requireInScope` must still pass against original `proposal.files`.
6. Only then issue the one deterministic Repair control wake. The native wrapper
   independently binds original/decoded arguments and first contender, prepares
   settings, reads current root/context and repeats the final synchronous target,
   scope and ownership checks. Consume repair execution authority immediately
   before calling the original executor. Hold the lease through implementation,
   new review, settlement and publication.

The first observation is under the acquired lease; checks before reacquisition
cannot serve as the release gate. The second observation covers the asynchronous
control/wrapper interval. There must be no awaited preparation between the final
synchronous observation/consumption and entry to native execution.

### Checks and limitations that must not be lost

- Canonical root and selected location remain the original ones. Use
  `observeGit`'s `realpath`/top-level checks and original root/HEAD baseline;
  a replacement directory or HEAD cannot be rebound.
- `observeReviewTarget(location, oldTarget)` and
  `requireReviewTarget(current, oldTarget)` compare sorted changed paths **and**
  digest; `requireInScope` preserves the original path ceiling.
- Digest observes staged index identities and actual tracked/ordinary untracked
  bytes, types, executable bits, symlinks and deletions. It hashes more than just
  changed paths. Same path names or the same HEAD alone are insufficient. Ignored
  untracked content remains outside the established ordinary Git boundary.
- Exact verified `CHANGES_REQUESTED` result and Reviewer provenance must be the
  immutable object selected by the current pending identity, never client prose.
- No competing governed execution may leave the old decision live. The current
  `executing` variable records only the current lease and forgets prior owners.
  Retire other pending review decisions synchronously whenever a new governed
  execution acquires the shared lease, before it can wake/mutate. This can be a
  local revocation of pending objects; no counter or persisted epoch is needed.
  Conservatively retiring them even if that new admission later fails is simpler
  and fail-closed. It also detects an intervening governed execution that ends
  with an identical digest. Exact bytes alone cannot prove no intervening owner.
- Ordinary user continuation or alteration of the pending root closes its
  eligibility. TUI event invalidation plus independent decision reads follows
  the existing pattern. The server must recheck supported root/control binding;
  it cannot assume `context.session.active()`/`inbox.list()` exist. Supported event
  subscriptions can retire observed changes but do not replace final reads.

This exclusion is scoped to a location's **server plugin activation**, not an
OS/process/filesystem lock. Another host or ungoverned external writer is not
serialized by it. Neither A nor B establishes atomic external containment or
an atomic lock on root policy through the later native permission assertion.
Preserve the protocol's existing release-observation guarantee and fail on
observed drift; do not advertise a stronger transaction. Unexpected control/input
must also be rejected by `observedCall` at native admission.

## 5. Repair authority design

Use a distinct in-memory one-shot Repair claim. Keep the initial `NativeCap`
occupied and closed forever; neither `accept`, `consume`, nor a phase reset on it
can represent repair. A pending verified review object itself grants nothing.

Minimum binding is a repair purpose, exact pending-decision identity, and the
server's immutable verified `CHANGES_REQUESTED` evidence reference. That evidence
transitively includes the accepted original claim facts, implementation target
and provenance, and Reviewer result/provenance. A client needs root plus pending
identity/action to select it; copying all fields through RPC creates unnecessary
sources of disagreement. An opaque ID prevents misselection/replay within the
live owner; it is not an independently authenticated human credential.

| Proposed binding | Necessity and existing representation |
| --- | --- |
| Governed root | Required to distinguish attempts; already in `VerifiedImplementation.claim.rootSessionID` and invocation identity. |
| Exact originally authorized proposal | Required: preserve accepted intent/plan/path ceiling, not a Reviewer/Orchestrator rewrite. Already in intact frozen `IntentCandidate`. |
| Exact original path set | Required hard ceiling; already in `candidate.proposal.files` and candidate encoding/digest. Do not store a second independently mutable scope. |
| Original bound HEAD | Required; already in candidate and review target. Validate their coherence, retain original value. |
| Canonical repository location | Required for effect routing/correspondence. Candidate supplies canonical root; original claim supplies location including any workspace identity. Neither a digest nor a root ID replaces location checks. |
| Current review target/fingerprint | Required because repair begins from a dirty reviewed worktree. Retain the complete `ReviewTarget`, including paths, not only its digest. |
| Exact verified `CHANGES_REQUESTED` | Required status guard and exact actionable task. Newly retain parsed frozen result in verified evidence; summary/findings copied from arbitrary text are insufficient. |
| Exact Reviewer child/result identity | Required provenance/decision disambiguation for this result. Newly capture parent message/tool, child and terminal assistant ID when verifying. Existing `ReviewAttempt.execution` supplies most ingredients, but is not itself immutable verified evidence. |
| Implementation identity | Already proven and retained with target; retain transitively rather than making human/model supply it again. It binds the reviewed execution. |
| Initial Plan publication ID/full planning transcript | Not a new repair authority requirement. Initial claim acceptance already bound the frozen proposal through the trusted TUI. Keep historical provenance if useful; do not rerun Plan authorization or recover it from transcript. |

Place the claim and its available/reserved/entered/consumed/closed lifecycle
beside existing execution admission in `nativeAdmission`; only extract a small
pure one-shot primitive into `src/cap.ts` if it meaningfully reduces duplicated
admission rules. A new `repair.ts` module, stored workflow, digest format or
credential protocol is not needed merely to name the lifecycle.

Decision eligibility is spent at server acceptance; **execution authority** is
consumed at the final fresh native-entry barrier. Distinguish those events.
Before consumption, any validation, exclusion acquisition, control/wake,
settings, first-contender or root/target failure closes the claim and ends the
request. No child starts if validation fails before native entry; no decision
is restored. After consumption, native policy denial, failed/ambiguous result
or settlement never restores it or authorizes replacement. Unknown settlement
retains exclusion as today.

Stop, supersession, competing lease acquisition and plugin teardown revoke
pending eligibility. Teardown also revokes accepted repair admission and retained
executor closures. A later verified `CHANGES_REQUESTED` creates a **new** pending
object for a later human choice, not a recycled claim. Stale callbacks/RPCs must
compare their exact object/identity and never close a newer owner.

Reviewer findings cannot alter claim fields. Even a correct remediation requesting
a new path or Git-history operation is evidence of work that is not currently
authorized. The trusted human Repair action grants this bounded new mutation
attempt; successful review alone does not.

## 6. Repair Implementer and re-review

Reuse `authorized_implementer` as a fresh native child. Its existing permissions
and responsibility cover bounded editing/testing and deny delegation/obvious
commit commands. There is no authority reason for a second agent role or model
preference. The trusted repair prompt must differ from `implementerPrompt`: its
statement that the worktree is clean is false for repair.

Smallest trusted input:

- Original frozen proposal, exact original authorized paths, canonical root,
  original HEAD and unchanged root identity.
- Exact currently reviewed target (paths/digest) and selected verified review
  identity, plus exact summary/actionable findings.
- Repair those findings only insofar as they fit the original proposal and path
  ceiling; preserve the existing reviewed implementation as the starting point.
  If a necessary remedy requires unauthorized work, stop and explain that fact.
- Leave original HEAD unchanged; no Commit/history authority, delegation,
  scope negotiation, concealed Git state or extra approval seeking.

No planning conversation or continued worker context is necessary. No
`sessionID`, `background` or model-authored override key enters the three-key
control contract. Existing trusted model preference preparation can apply anew
to each fresh Implementer/Reviewer.

Findings' optional `path` fields are diagnostic, not a scope language. Do not
mechanically intersect `files` with `findings.map(path)`: some findings omit a
path, refer to outside content, or require a related authorized test file.
The machine-enforced path ceiling remains the original exact set; the repair
task is semantically bounded by the original proposal and verified findings.
Current Implementer edit/shell policy is not per-path physical containment;
prompts require obedience and the trusted Git gate rejects observable outside
delta. Issue #30 must not claim that the gate prevents all unauthorized shell
effects before they occur.

### Reusable gates and required adaptations

Reuse `observeGit(location, originalBaseline)` and
`requireInScope(snapshot, originalBaseline, originalFiles)` after successful
repair. This verifies the **cumulative** worktree delta from the original clean
HEAD. Do not treat the previous dirty target as a new clean baseline or subtract
its paths from scope observations. Repair may introduce a newly changed original
authorized path, or remove a prior delta; post-repair paths need not equal the
old review paths. Exact old-target equality is a **pre-repair** condition.

Then call `observeReviewTarget` on the newly accepted snapshot, build a fresh
`VerifiedImplementation`, use `reviewerArguments` for that new target/implementation
identity, and run a fresh read-only Reviewer. `requireReviewTarget` and
`parseReviewResult` remain the post-settlement review gate. Successful repair
does not establish semantic correctness; its new Reviewer does.

Reuse verification algorithms, not their initial-only CAP assumptions:

- `verifyImplementation`, `actualCall`, `exactArguments` and bootstrap checks
  currently derive task/control/reservation/result from the initial `NativeCap`
  and `implementerPrompt`. They need the current cycle's admitted claim, exact
  prompt/control and execution evidence. They must never reread old initial
  reservation/result as proof of repair.
- `executing` currently names `{ cap, native? }`; it must identify the current
  initial-or-repair execution owner while preserving exact settlement rules.
- `before`/`execute` currently prefer a root's retained review entry and then
  its CAP entry. A closed review entry would intercept a repair call; dispatch
  must use only the current cycle's actionable admission. Old entries remain
  inert and cannot authorize or consume the next call.
- `runReview` currently rejects `reviews.has(rootID)` permanently. Admit one
  Reviewer **per verified implementation**, retiring the previous review owner
  and binding new callbacks to the new object. `ReviewAdmission` already provides
  useful one-shot transitions. Sponsor actors/rules need not multiply per cycle.
- `executeReview` currently forbids reuse of the current implementation child;
  fresh native creation remains mandatory. Keep exact prior child identities
  available in execution bookkeeping if needed to reject malformed host reuse
  across cycles. Native fresh creation plus unique control/message/tool/child
  identities supplies normal distinction; no persisted cycle number is needed.

Previous review evidence is historical immediately when its decision is spent
and repair becomes the current execution owner; no approval slot remains live
through possible mutation. An unchanged/no-op repair still receives a fresh
review. Never rerun `verifyReview` on an old review after appending later controls
as a way to recover eligibility: its current first/sole post-control contender
checks deliberately reject that changed execution history. Use frozen verified
facts for the selected decision and verify the new cycle against its own control.

## 7. Out-of-scope findings

`src/review.ts`, `finding`/`parseReviewResult`, validates diagnostic relative paths
but does not require them to be in `proposal.files`. Reviewer may therefore
identify an outside-scope problem without invalidating its evidence. That report
adds no path authority. A reference to an outside path does not alone prove that
the repair must edit it; diagnosis can concern a caller, contract or previous
content while an authorized local fix is possible.

If the needed fix truly requires an unauthorized path or a change outside the
original proposal, Repair cannot grant it. The fresh Implementer must stop
without that mutation and report the requirement. Known impossibility can be
explained before granting Repair, but there is no deterministic requirement to
infer this from free-text findings. Any observable outside path fails the normal
Git gate without review, scope enlargement or automatic cleanup. A worker that
reports inability does not create a new planning grant; a technically successful
no-op may still go through normal review and be rejected again.

Same-root post-implementation replanning is **not** safely supported now:

- `nativeAdmission.revise` requires completed Planner admission **and no CAP
  entry** (`caps.has(parentID)` rejects even a closed initial claim).
- `executePlanner` rejects a root with an admitted CAP claim. `before` also
  preserves the spent planning latch/root CAP boundary.
- TUI `revise` acts only on an exact pending, pre-transfer Plan. Initial
  `Ownership` is closed after the server result.
- Orchestrator instructions explicitly reserve revisions for pre-authorization
  controls and require a fresh root for unrelated changes.

Smallest behavior: Stop this attempt and require a **fresh root/new governed Plan
authorization**, rather than adding post-implementation replanning to #30. This
is not a promise that a new root can immediately authorize edits to the dirty
rejected worktree. Current clean-before-root eligibility means a fresh root
started with that delta can plan only. The user must explicitly resolve/preserve
the existing uncommitted work through an independently authorized path and
establish a clean starting baseline before a new implementation-eligible root.
No automatic reset, stash, commit, patch migration or adoption of old dirty work
is implied. Supporting governed dirty-baseline adoption would be a separate
architecture change.

## 8. Repeated cycles, `INCONCLUSIVE`, restart, and receipts

### Repeated explicit choices

Allow repeated `CHANGES_REQUESTED → human Repair → fresh Implementer → fresh
Reviewer` cycles within the same root and original proposal/path/HEAD ceiling.
Each review B/C/etc. creates a new pending decision only after independent
verification. Every Repair is another positive human grant, and Stop remains
available every time. No automatic repair, generic retry or persisted attempt
counter is justified by the source.

Bookkeeping is current execution ownership, verified evidence, one-shot admission
and obsolete identity rejection. Existing TUI revision code's captured planning
object and retired callback discipline is a useful local technique, not a reason
to import its Plan lifecycle into repair. No predecessor workflow architecture
is needed.

Host context growth/compaction can make a current control unavailable and thus
fail verification. This is a supported-history limitation that can stop a
particular cycle; it does not require an arbitrary numeric repair bound. Each
new cycle verifies its own control/child. Do not persist every phase or recover
lost controls to make an unbounded promise about context capacity.

### `INCONCLUSIVE`

Remain terminal. `parseReviewResult` requires empty findings, unlike the 1–8
actionable findings for `CHANGES_REQUESTED`. It supplies no bounded repair task.
Unverified Reviewer execution is also not actionable `CHANGES_REQUESTED`.
Neither gets Repair or an automatic replacement Reviewer. Current source shows
no correctness need for a separate re-review action; that would require its own
future decision rather than turning #30 into a retry system.

### Restart and recovery

Pending decision evidence and accepted Repair authority live only in the plugin
activation. Plugin/process restart loses them; historical `CHANGES_REQUESTED`
cannot recreate the pending object or claim. Current TUI eligibility originates
from new-root creation correlation, not revisiting old sessions. Enter a fresh
governed path with zero authority.

This agrees with `NativeCap.teardown`, `nativeAdmission.teardown` and protocol
sections “Authority and trust”, “Human decision and server-owned claim”, and
“Future separate Commit contract”. Distinguish lost CAP admission from native
worker recovery: host `session/execution.ts` has durable execution recovery, and
current CAP docs already allow ordinary recovery of an admitted child. A worker's
installed edit capability is not surviving or restored CAP. Pending human Repair
has no worker to recover. This report does not promise that teardown physically
contains all already-running/recovered worker effects.

### Receipts and history

Keep every verified `CHANGES_REQUESTED` receipt factual and durable. A later
decision does not erase what the Reviewer found about that exact target.
Historical `APPROVED` is equally factual even when later work invalidates its
current eligibility. Receipts must never reconstruct claims or select the latest
actionable review by parsing root prose.

Current `reviewReceipt` ends every status with:

> Review target remained unchanged. This attempt ended before Commit. No repair, additional review, or Commit authority was granted.

The observation and absence of authority **from review** remain valid; “This
attempt ended” becomes wrong for a paused repair-eligible attempt. Replace that
unconditional ending with factual cycle-result wording: target unchanged at
verification, review grants no mutation/Commit authority, and a fresh explicit
Repair decision is required if offered by live trusted controls. Stop and
terminal statuses can say the attempt ended. Do not make pending receipt prose
itself an instruction capable of admitting repair.

`reviewUnverified` currently says no retry/replacement/repair/Commit **was issued**;
that remains accurate for an unverified cycle. Do not turn failures into Repair.
Orchestrator's one eventual implementation/no repair language and role description
must be updated for exact trusted repair controls, preserving ordinary denials.

Keep root history as successive factual implementation-gate and review receipts,
plus explicit decision dispositions where useful. Native controls, root
message/tool IDs, child IDs and terminal result IDs already distinguish cycles.
Include the target/Reviewer provenance in receipt presentation if needed to
identify which review is being described; a numeric retry counter is unnecessary.
`receiptInput` remains non-waking presentation. Because steered receipts are
pending inbox inputs and later model context, future verification must tolerate
its own exact receipts without admitting arbitrary pending input. Recording
receipt admission identities for that local check is execution bookkeeping,
not persisted workflow state.

## 9. Interaction with #22

The invariant available to future Commit work should be:

> A separately human-authorized Commit may select only the newest live, exactly
> bound, trusted `APPROVED` review target for this governed root and original
> authority, freshly equal to current repository reality at the Commit effect.

`CHANGES_REQUESTED`, `INCONCLUSIVE`, unverified review and stale evidence are
never Commit-eligible. Any repair admission conservatively retires previous
current review eligibility before possible mutation; any observed worktree/HEAD
drift invalidates approval. Only successful fresh review of the repaired target
can establish a new approved candidate. A historical approved receipt cannot
replay authority, even if bytes later happen to return to an older fingerprint.

#22 already separates approval from Commit authority and requires exact
fingerprint/staged-content verification. Preserve that. Revise its assumptions
as follows when #30 is settled:

- “After Implementer/Reviewer” means the **latest cycle**, not the initial
  Implementer CAP/result or first Reviewer under the root.
- Commit input binds the latest verified result **and Reviewer provenance**,
  frozen original candidate/path ceiling, original HEAD and latest target.
- Commit/Stop needs a distinct server-owned pending decision, including the
  human-pause exclusion/freshness rule; merely retaining an approval string
  after Authorize returns is insufficient.
- Any pending Commit selection must be retired by repair/competing governed
  execution and reject stale callbacks. Commit effects and pre-commit enforcement
  remain #22's separate investigation/implementation responsibility.
- The cited 2.0.22 seam must be checked against the selected 2.0.24 host. Approval
  does not add Reviewer-owned executable validation, which the current protocol
  mentions as a future Commit obligation; #30 supplies no such validation.

No Committer tool/role, staging authorization, commit effect or automatic Commit
is proposed here.

## 10. Recommended lifecycle

```text
exact settled Reviewer A + unchanged target T_A
  → verify native provenance and strict CHANGES_REQUESTED result
  → freeze verified review evidence E_A (not authority)
  → publish factual findings / receipt
  → close admissions; release worktree exclusion
  → live server-owned Repair / Stop decision D_A

Stop(D_A)
  → atomically retire D_A
  → no claim, wake or mutation
  → factual stop receipt; attempt closed

human Repair(D_A)
  → atomically spend D_A; create distinct one-shot repair claim R_A
  → acquire worktree exclusion; retire competing pending review decisions
  → check original root/location/HEAD/path ceiling and exact T_A/E_A freshness
  → issue exact trusted control; bind first native contender
  → recheck after awaited reads/preparation; consume R_A immediately at entry
  → fresh authorized_implementer B (never continue A)
  → exact root/child settlement and normal trusted implementation/Git gate
  → new target T_B from original HEAD and cumulative authorized delta
  → implementation receipt
  → fresh Reviewer B (never continue A)
  → exact settlement, provenance/result verification and target revalidation
  → factual review receipt; release exclusion if settlement is proven
       APPROVED          → terminal before Commit in current feature scope
       CHANGES_REQUESTED → new evidence E_B and new Repair / Stop decision D_B
       INCONCLUSIVE      → terminal
```

Every pre-entry validation failure closes the selected claim without a child or
replacement grant. Post-entry failures/ambiguity never reopen authority; unknown
settlement retains exclusion. Out-of-scope required work ends this attempt and
requires a fresh governed Plan path. The original CAP never becomes available.

This is option B with one additional bounded evidence/decision owner and per-cycle
admission. Option A's indefinite exclusion is unnecessary; no third architecture
is needed to satisfy the lifecycle under current trust assumptions.

## 11. Likely implementation surface

These are future changes, not edits made by this investigation.

| File/symbols | Smallest likely responsibility |
| --- | --- |
| `src/native.ts`: `VerifiedImplementation`, `ReviewOutcome`, `ReviewAttempt`, `nativeAdmission`, `authorize`, `before`, `execute`, `verifyImplementation`, `executeReview`, `verifyReview`, `runReview`, `executing`, `publishReceipt`, `teardown` | Capture immutable verified review/result identity; own pending decision and distinct repair admission; discriminate current cycle; acquire/release/revoke under existing lease; use exact initial-or-repair prompt/contract; retain current settlement and provenance gates. |
| `src/cap.ts`: existing frozen-copy/exact-key/reservation helpers; distinct repair primitive only if useful | Preserve `NativeCap` root latch and closed initial authority. Factor only concrete duplicated one-shot admission rules; never add a reopen/reset path. A new module is not currently justified. |
| `src/review.ts`: `reviewReceipt`, optionally pure evidence/presentation typing | Status-aware factual receipt wording and verified findings projection; preserve strict parser/read-only contract. No widened finding-path authority. |
| `src/authorize-rpc.ts`: `authorizeRpc`; server RPC registration | Validated structured cycle outcome plus Repair/Stop decision method, using supported local RPC. No model tool, status polling or durable recovery API. Portable schema technique in `src/agent-models-rpc.ts` is an existing reference if Effect runtime codec issues matter. |
| `src/attempt.ts`: `authorizePublishedAttempt` and small post-review transport checks | Adapt outcome validation and TUI transport; leave pre-transfer Plan binding/initial clean admission intact. Do not route repair through `verifyPublishedAttempt`/`requireFresh` on the dirty target. |
| `.opencode/plugins/opencode-agents/tui.tsx`: `Ownership`, `Presentation`, `decide`, result handler, slot/frame/keymap lifetime | Add a distinct post-review presentation owner without reopening initial Plan ownership. Readable exact evidence, positive action/Stop, root navigation/remount, stale callback rejection and lost-response behavior. |
| `.opencode/plugins/opencode-agents/server.ts` | Register bounded decision handler and any necessary event-driven revocation, preserving native wrapper, model preparation and separate narrow sponsors. |
| `.opencode/agents/authorized_implementer.md`, `.opencode/agents/orchestrator.md` | Describe fresh authorized repair input/cycles and exact control handling, out-of-scope stop and no Commit. Retain role permissions. Reviewer role and `reviewerArguments` already support fresh exact targets; only clarify wording if needed, without expanding tools. |
| `src/git.ts`: `observeGit`, `requireInScope`, `observeReviewTarget`, `requireReviewTarget`; `src/receipt.ts`: `receiptInput` | Existing algorithms are sufficient. No second fingerprint system, weakened observations or new receipt store. Change only if concrete implementation needs require it. |
| Current orchestration/CAP docs | Later update one-shot-per-root normative wording to distinct per-repair grants/per-implementation review, explicit human pause and latest-approved semantics after the architecture decision. This history report does not update them. |

### Existing tests affected by initial-only assumptions

`test/attempt.test.ts` uses `snapshotTest`, `SnapshotObserver`, `serverFake` and
TUI handler capture. Relevant concrete test names include:

- “verified implementation automatically launches one separate read-only Reviewer
  and accepts APPROVED”: permanent one-review/wake assertions and receipt strings.
- “Reviewer uses verified implementation evidence without reading closed CAP
  evidence”: preserve this separation for repair, not old getters.
- “Reviewer accepts bounded changes requested and inconclusive evidence without
  repair or another review”: split pending human Repair from terminal INCONCLUSIVE;
  keep the assertion that review alone launches nothing.
- “Reviewer admits only the exact first original foreground call, without
  replacement”, “concurrent Reviewer reservation and executor losers cannot alter
  the in-flight owner”: retain one-shot semantics per cycle and reject prior owners.
- “exclusion spans both receipts and releases after terminal review publication”,
  “worktree exclusion spans Reviewer, terminal receipt, and unknown Reviewer
  settlement”: extend pause/reacquisition coverage while preserving unknown-child
  holding and receipt ordering.
- “claim transport occupies synchronously before wake awaits, freezes inputs, and
  rejects retransmission”, “teardown at acceptance, reservation or execution
  revokes old closures; fresh activation cannot recover transcript authority”:
  initial claim must remain spent; repair has its own one-shot/revocation cases.
- “positive readable-frame callback transfers one exact verified claim and receives
  trusted RPC outcome”, “server-owned accepted attempt survives TUI route,
  projection and cleanup changes without retransmission”, “lost Authorize response
  retires controls without a competing receipt or resubmission”: structured outcome
  and independent post-review ownership, preserving no retransmission.
- “a spent Planner latch remains spent through successful or failed implementation
  authority”, “Planner rewrite leaves nested delegation untouched and rejects later
  planning after eligibility is spent”: continue barring same-root post-implementation
  replanning; do not relax to solve outside-scope repair.
- “Effect server keeps Authorize and model settings RPCs separate with two narrow
  sponsors and a native wrapper”: register decision RPC without weakening sponsors.

`test/review.test.ts`, “strict review accepts CHANGES_REQUESTED” (generated from
the valid-result table), currently asserts “No repair, additional review, or Commit”
for all statuses. Update factual receipt expectations while preserving bounded,
contradictory/malformed/duplicate-key rejection. `test/cap.test.ts` explicitly
proves original slot occupancy, no second executor/consume and teardown; those
invariants must remain. `test/git.test.ts` already covers same-path content/index
drift, hidden tracked bytes, mode/type/deletion changes, root/HEAD/scope drift,
untracked content and unsupported topology; reuse those integration boundaries.

### Focused additions

Use the existing test-scoped trusted doubles for:

- Verified findings alone create no Implementer; Repair and Stop race once against
  the exact pending evidence. Reject wrong root/result/target identity, stale
  callback, duplicate RPC, old worker result and lost-response replay.
- Pause releases exclusion; Repair acquires it **before** freshness observation.
  Drift during awaited reads or the wake interval rejects before native entry.
  Competing governed lease acquisition retires old eligibility even if the mock
  target digest later returns to the same value. Busy acquisition is terminal,
  not queued. Unknown worker settlement retains exclusion.
- Distinct repair claim freezing/consumption/closure and teardown; failures before
  entry start no worker and never reopen initial CAP or pending decision.
- Fresh Implementer and fresh Reviewer with distinct controls/IDs in two or more
  human-granted cycles; cumulative Git gate uses original HEAD/path ceiling and
  accepts changing subsets of originally authorized paths.
- Diagnostic outside-scope findings grant no path; necessary outside work stops;
  observable widening fails the gate. Optional finding paths never serve as a
  machine-generated replacement scope.
- INCONCLUSIVE/unverified review never offers Repair; newest exact approval is
  the only current approved evidence; older receipts remain factual and inert.
- TUI readable evidence/frame, keyboard/mouse modes, navigation/remount, stale
  return, surface loss, Stop and transport loss; own pending receipts tolerated
  without permitting unrelated queued input to cross the native control boundary.

Do not duplicate real-Git repositories for these lifecycle cases or add production
DI/environment hooks to facilitate mocking. Existing immutable-seed/private-copy
Git tests remain the cheap explicit production boundary. Source compatibility
guards need additions only for newly relied-on pinned host APIs, not a host launch
or generalized integration harness.

## 12. Open questions

No unresolved source/API question blocks the recommended architecture. The source
supports a distinct human decision, new one-shot admission, repeated fresh native
siblings and exact-target revalidation without durable workflow state.

Static evidence does not establish real terminal readability, deployed model
obedience or successful live repeated cycles. Those require focused validation
when implementation is authorized, not a new architecture or an OpenCode launch
in this investigation. The external-writer/ordinary-Git boundary and absence of
atomic host-policy locking are known current limits, not unanswered questions.

Dirty-work adoption/replanning after a stopped attempt and Commit's pre-effect
enforcement remain separate future scope. Current code already answers #30's
necessary decision: neither is supplied by Repair, historical findings, an old
CAP, or a receipt.
