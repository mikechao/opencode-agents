# Issue #5 — Plan Publication While Inspecting Planner

## 1. Executive conclusion

[Issue #5](https://github.com/mikechao/opencode-agents/issues/5) is valid. The
reported failure follows directly from current `main` at
`7de69a82b18461e92dd4bb0379997a22a8171c7b`. Trusted publication currently
inherits an authorization route requirement from the TUI-owned
`guard.assertCurrent()`. Selecting Planner therefore closes the attempt even
though the exact native result, root identity, Git evidence, and publication
APIs need no selected root view.

The proposed boundary is compatible with CAP: publication and private retention
may proceed independently of the selected route, with every existing
publication/native/Git/location check preserved. Selecting the exact root is a
prerequisite for preparing the human decision surface. Returning to root must
revalidate the same retained object and current evidence, then obtain a fresh
completed-frame readability proof before either decision is actionable.

**Recommendation: change only the TUI production lifecycle. Keep
`src/attempt.ts` unchanged.** Add one private `retained: PublishedAttempt |
undefined` reference alongside `pending` and `deciding`. It means publication
has succeeded but root authorization presentation has not begun. Transfer that
same object once into root-bound `pending` ownership when the exact root is
selected; revalidate before installing `DecisionStrip`. There is no transfer
back to `retained`, retry, second publication, or replacement child. Once this
root presentation preparation begins, preserve fail-closed navigation loss,
including while its validation is awaited. This conservatively preserves the
existing pending policy and avoids adding another resumable presentation phase.

This is an investigation only. No code or tests were changed, no OpenCode or
Docker process was launched, and no GitHub write, commit, or push was performed.
The working tree was clean at the start. All cited implementation line numbers
refer to the baseline above.

Verified repository notes:

- `src/m1/attempt.ts` and `src/m2/attempt.ts` do not exist or appear in the
  tracked file list; relevant logic is in [attempt.ts](../src/attempt.ts).
- [package.json](../package.json) and `bun.lock` pin `@opencode/plugin` 2.0.21.
- [attempt.test.ts](../test/attempt.test.ts), lines 1494–1514, contains the exact
  regression `reactive navigation loss during a publication await latches
  before returning to root`.
- [tui.tsx](../.opencode/plugins/opencode-agents/tui.tsx), lines 85–104, owns
  `rootSelected()` and the route-requiring `assertCurrent()` implementation.
- `publishPlan()` calls injected guard checks; it never reads the router.

The GitHub issue records OpenCode 2.0.20 dogfood. This report uses the current
2.0.21 pin and matching local upstream source. Earlier charter/CAP status prose
still describes publication-only runtime and a removed modal executor;
[v1-orchestration.md](v1-orchestration.md) and current code establish that direct
pointer authorization and same-slot implementation now exist. Those historical
status statements are not evidence that the current bridge is absent. Their
general cleanup is outside this pass; the normative authority requirements
still apply.

## 2. Current publication pipeline

### Activation and root completion

`plugin.setup(context)` creates the process-local `generation`, snapshots
primitive `location` identity, synchronously calls `observeGit()`, and records
`observationCompletedAt` only after observation finishes (`tui.tsx`, 23–33).
`removeCreated` adopts one copied `session.created` event into `creation` and
sets `rootSessionID`. It requires a root `orchestrator`, matching location, a
baseline, and no previously adopted/attempted/closed activation (247–252).

The root agent instructions in
[orchestrator.md](../.opencode/agents/orchestrator.md) require two sequential
foreground native calls: fresh Planner, then fresh inert `implementer_slot`.
Planner receives the exact user request; the slot receives `SLOT_PROMPT` and
must return `READY`. The root ends with informational prose. Trusted code does
not extract a proposal from that prose.

`removeCompleted`, the `context.data.on("session.execution.succeeded", ...)`
callback (253–274), matches the adopted root ID, sets `attempted = true`, saves
`completionID`, increments `layoutRevision`, constructs `activation` through
`activationEvidence(...)`, and invokes exactly one
`publishPlan(context, activation, guard)`. Its `.then(...)` is the sole current
publication-to-pending bridge; `.catch(terminate)` closes on any failure.

### Trusted native and Git binding

`publishPlan()` (`attempt.ts`, 372–410) first checks `assertLive(generation)` and
the `generation.busy` exclusion, sets busy, and creates
`check = checks(context, activation, guard, "publication")`. Each `check()`:

1. Checks generation and injected local ownership.
2. Requires the original primitive TUI `location` through
   `requireActivationLocation()`.
3. Independently observes Git with the original baseline. `observeGit()` rejects
   canonical-root or HEAD substitution, including changes during observation.
4. Requires the same baseline changed-path set under publication policy.
5. Rechecks the guard and generation.

`after(check, operation)` checks after each successfully resolved await.
`messages()` applies it to every page, rejecting repeated cursors and duplicate
message IDs. Failed operations propagate to termination. `idle()` independently
requires an inactive session and empty inbox.

After `session.wait({ sessionID: parentID })`, `bindNativeAttempt()` reads the
root session, inactivity/inbox, complete H0, and each child session, inactivity/
inbox and complete HP/HS (`attempt.ts`, 241–271). Its helpers are:

- `successful()`: exact ID, role, parent, location, creation time, successful
  idle outcome; no fork, revert, archive, or permission overrides.
- `parentCalls()`, `completedCall()`, `oneFinal()`: one first plain root input,
  one successful turn, nonempty final, exactly two distinct completed native
  calls in the fixed Planner/slot order, exact allowed arguments and prompts,
  distinct child IDs, exact native wrapper shape.
- `verifyChildHistory()`: one exact bootstrap input/result; Planner tools must
  be completed read/glob/grep calls, slot has no tools and exact `READY`.
- `resultMatches()`: parent native wrappers equal independently read child
  text, rather than accepting metadata or root narration as the result.

The immutable `bound` contains root/user/call/tool/child/input/final IDs, exact
request/prompts/results, complete history encodings, and all three session
creation times. `guard.bound = bound` lets the TUI event observer constrain
native events. Root creation time is checked against `activation.creation`.

### Candidate and synthetic admission

`parseProposal(bound.plannerChild.text, baseline.root)` validates one exact
`{ intent, plan, files }` object. It preserves strings and ordered exact file
paths, validates path ancestry/symlink constraints, and freezes proposal/scope.
`makeCandidate(..., baseline.root, baseline.head)` freezes `candidate`, with
deterministic JSON `encoding` and SHA-256 `digest`
([proposal.ts](../src/proposal.ts)). These remain the initial root/HEAD; later
reads cannot replace them. `candidateIntact()` recomputes both identifiers.

`planHash` is the first 12 hexadecimal characters of SHA-256 of raw Planner P;
it is distinct from the candidate digest and is not authority. A second
`bindNativeAttempt(..., bound)` checks unchanged native evidence before
publication. `guard.publishing` is a copied/frozen expectation containing one
new `msg_<UUID>`, exact raw P, `renderPlan(candidate)`, and exact
`{ source: "planner", planHash }` metadata.

After another `check()`, the sole synthetic call is:

```ts
context.client.session.synthetic({
  sessionID: parentID, ...guard.publishing,
  delivery: "steer", resume: false,
})
```

The global `removeEvents` listener may receive its admission echo before the
RPC returns. It accepts only the exact expected `session.inbox.enqueued` item
and retains `publicationEcho`. `checkedPublication()` validates the complete
returned schema/values, raw P, deterministic description, metadata, root ID,
delivery, and finite admission time. Returned ID must equal the proposed ID.

### Published object, server verification, and hydration

The local `published = Object.freeze({ activation, bound, candidate,
publication: immutable(admitted) })` is constructed **after admission, before
the subsequent verification and hydration** (`attempt.ts`, 395). This is not
yet TUI retention or successful return. `guard.publication` retains the full
frozen admission record for echo reconciliation.

`verifyPublishedAttempt()` (326–338) calls `assertPublishedCoherence()`, then
`verifyParentPlanner()`, then verifies the unchanged bootstrap slot. Coherence
reconstructs retained native calls/results, checks candidate integrity and
baseline binding, and validates S. Server reads require:

```text
root inactive, original successful identity/creation
root server history = exact H0
root server inbox   = exactly [S]
Planner history     = exact HP, idle with empty inbox
slot history        = exact HS, original inert role, idle with empty inbox
```

Promotion of S changes inbox/history and fails even if text is identical.
The original native parsers are never relaxed to filter out synthetic rows.

`publishPlan()` then invalidates and awaits
`context.data.session.pending.sync(parentID)`, invalidates and awaits
`context.data.session.message.sync(parentID)`, and checks
`publishedPresentationMatches(context, published)` (398–403). It requires exact
root-keyed TUI projection `H0 + materialize(S)` and exact pending `[S]`.
Hydration is attempted once, with checks after both awaits; there is no repair
or publication retry. A second full `verifyPublishedAttempt()` and final
`check()` protect the hydration waits. Only then does the function return the
same `published`. `finally` clears `generation.busy` on success or failure.

### Current retention and authorization installation

The TUI `.then(published => ...)` calls `guard.assertCurrent()`. Ineligible dirty
or unproven initial ordering gets planning-only status and `closeAuthority()`;
the server Plan remains but no callback is retained. Eligible publication
requires fresh clean Git, then assigns `pending = published`, increments
`layoutRevision`, calls `ensurePresentation(published.bound.parentID)`, and sets
`presentation = { kind: "pending", published }` (259–272).

`ensurePresentation()` registers one `session.composer.top` append claim through
`removePresentation`. Its render callback conditions on
`input.sessionID === rootSessionID`, then keyed `presentation()`. Only the
pending branch creates `DecisionStrip`; status holds trusted display text.
Registration, actual mount, and decision readiness are different facts.

`DecisionStrip` captures `props.published`, starts `ready(false)` with no
`layoutProof`, registers `completedFrame`, and installs local
`pendingSurfaceUsable`/`invalidateLayout` callbacks. `checkLayout()` validates
current ownership, live surface/ancestors, wrapping, viewport, every binding/
question/control bound, and the existing 80×24 minimum. A width reflow waits for
another frame. Only a complete valid renderer frame publishes the proof and
sets `ready(true)`. The full trusted Plan remains in the scrollable transcript;
the strip does not duplicate it.

## 3. Exact cause of the live failure

`rootSelected()` reads `context.ui.router.current()` and requires the route's
session ID equal **`creation.data.sessionID`**, with matching location.
`guard.assertCurrent()` contains this current condition (95–104):

```ts
if (attempted && (
  (!guard.dispatched && !rootSelected()) ||
  !same(snapshotLocation(context.location ?? context.data.location.default()), location)
)) throw new Error("Root view or TUI location changed")
```

This is enabled by `attempted`, not by a mounted decision surface or a captured
decision. The publication guard therefore requires root selection from the
instant root completion is accepted until prompt dispatch.

For the reported sequence:

1. The user selects Planner before root completion. `attempted` is still false,
   so the global reactive effect returns without enforcing the route.
2. Planner and slot complete, followed by successful root completion.
   `removeCompleted` sets `attempted = true` and increments `layoutRevision`.
3. `publishPlan()` invokes its initial `check()`, whose
   `guard.assertCurrent()` rejects the Planner route. The reactive watcher may
   also run because of the revision and reject the same state. Whichever first
   calls `terminate()` irreversibly closes ownership; later rejection is inert.
4. In this sequence no initial publication read must succeed: failure precedes
   `session.synthetic()`, `PublishedAttempt` construction, synthetic admission,
   and hydration. H0's model-authored final remains the only handoff prose.

Navigation **can also terminate during any publication await**. If publication
begins on root, `after(check, ...)` rejects when an awaited wait/read/page,
synthetic admission, or hydration resolves with a child selected. Independently,
`disposeWatch`'s Solid effect (335–346) tracks `layoutRevision`, the router, and
root message/pending stores once `attempted` is true. Route loss can call
`terminate()` while the promise is still suspended. Returning to root before
that await finishes cannot undo the already-latched closure. The existing
1494 regression proves that case by pausing root `session.wait`, navigating
home and back, then releasing the await; zero synthetics result.

Timing matters for what already happened. Before the sole synthetic invocation,
there is no S or published object. If navigation occurs after invocation, the
host may already admit S even though the post-await guard throws. The object
may not yet be constructed; if it was constructed, it may fail later server or
hydration checks. Hydration occurs only after initial post-admission native
verification succeeds. Neither failure removes an already-admitted S or retries
it. These later cases must not be described as proving S was never admitted.

`guard.publishing` is only the expected synthetic identity/payload for the event
listener; it never exempts route loss. The synthetic event exception permits
that exact echo, not publication liveness on a child route.

`terminate()` snapshots `guard.dispatched` for truthful STOP wording, calls
`closeAuthority()`, installs root-scoped status, and shows a supplemental toast.
`closeAuthority()` (52–68) sets `closed = true` and clears:

- `pending`, `deciding`, `creation`, `completionID`;
- `guard.bound`, `guard.publishing`, `guard.publication`, `guard.switchRecord`,
  `guard.switching`, `guard.prompt`, `guard.dispatched`;
- `switchEcho`, `publicationEcho`.

It does not reset `attempted`, baseline, location, or `rootSessionID`, revoke
the entire generation, cancel S, or directly clear all presentation helpers.
Replacing a mounted strip disposes its helpers/listener; plugin teardown also
clears them explicitly. `generation.busy` is released by the kernel's `finally`.
Async stack locals can still exist, but closed owner checks forbid using them.
The status holds only text. Returning to root cannot restore `creation`, reset
`closed`, reset `attempted`, or rerun the completion callback. There is no
retained exact attempt to recover in the reported failure.

## 4. Publication evidence vs authorization-surface evidence

| Evidence | Purpose and required boundary |
| --- | --- |
| Live original generation and activation; original location/workspace | Required throughout publication, retention, preparation, claim, and execution. Route independence does not mean location independence. |
| Copied root Created event and matching server creation/role/parent/location | Binds the actual root; required for publication and all later validation. Selected root UI is a separate fact. |
| Exact H0/HP/HS, calls, child IDs, creation times, results and permissions | Required to publish and to revalidate the same native attempt. |
| Valid frozen proposal, candidate encoding/digest, original canonical root/HEAD | Required for publication and all authority checks. |
| Stable ordinary baseline path set | Publication requirement, including after every await. May be initially dirty; no content snapshot is implied. |
| Exact single admitted S and independently read server `[S]`; inactive root | Required for publication and later validation. Promotion/wake/input changes invalidate. |
| Exact root-keyed TUI pending and message projection | Required for successful publication and retained availability. Offscreen is allowed; selected route is irrelevant to equality. |
| Initially clean baseline with strict observation-before-root-creation ordering | Required for authorization eligibility; publication can produce inert planning-only status without it. |
| Current clean Git/root/HEAD after bootstrap and before presentation/claim/admission | Required for authority-seeking preparation and admission. A retained publication alone is insufficient. |
| Exact selected root route and matching slot input session | Required for authorization preparation/presentation and claim, and claimed liveness before dispatch. Not a fact proving P or S. |
| Mounted strip, current visible/living ancestor chain, unclipped readable complete authorization surface, fresh completed frame | Required at decision capture. Resize invalidates pending proof; these are presentation facts, not publication facts. |
| Exact `pending === captured`, then synchronous `deciding === captured` | Binds the local decision to this immutable publication. Required for callbacks/claimed continuation, not synthetic admission. |
| One-use intent grant and exact same-slot prompt/result gates | Created only after trusted positive claim and fresh validation. Publication/navigation never creates them. |

The normative CAP document explicitly distinguishes non-authoritative
publication from clean authority admission. Its presentation requirements and
local trust model do not require selecting root to admit a non-authorizing S.
The proposed separation preserves the existing complete-candidate projection
and decision-time readability policy, including the scrollable Plan boundary;
it does not add an attestation that every transcript line was physically read.

## 5. Route/root-selection dependency classification

Classification: **P** required publication/retention evidence; **A** authorization
presentation/capture; **C** after claim before dispatch; **D** after dispatch;
**X** accidental coupling; **Design** an explicit local policy choice.

| Current dependency/site | Classification and finding |
| --- | --- |
| `rootSelected()` / `router.current()` (`tui.tsx`, 85–89) | **A/C** exact selected root; the embedded primitive location comparison is **P/A/C/D**. Family root equality would not suffice for a decision. |
| `assertCurrent()` route condition keyed by `attempted` (97) | **X** while publishing or retaining before root preparation; **A/C** once pending/claimed. `!guard.dispatched` intentionally ends route enforcement after dispatch. |
| Root ID from `creation`, `rootSessionID`, `completionID` | **P** immutable adoption/completion/native binding; root slot filtering is **A**. Never derive the bound root from the newly selected session. |
| `attempted = true`, creation/completion callback exclusions | **P** one-shot initiation, not proof a decision surface exists. Using it to require route is **X**. |
| `checks()` and `after()` invoking `guard.assertCurrent()` | **P/A/C/D** delegated local liveness plus unchanged trusted Git/location barriers. No router in the kernel; correct the injected policy. |
| `.then(published)`'s `guard.assertCurrent()` (260) | **P** final local ownership, projection/echo/location; current inherited route is **X** until root preparation. |
| `pending = published` directly after publication (269) | **X** conflates successful retention and root presentation; add private retained ownership first. |
| `pending`, `deciding`, `assertDecision()` | **A/C/D** exact object ownership. `assertDecision` must never accept retained-only ownership. |
| `presentation` keyed pending/status, `ensurePresentation()` | **A** display lifecycle; not a grant or workflow phase. Status contains no candidate/callback. |
| `session.composer.top` registration vs mount; input session equality (110–117) | **A** actual root view rendering. Registration can exist off-route. Conditional rendering alone cannot guarantee selected-route authority because host slot instances can coexist. |
| `DecisionStrip` cleanup (220–229) | **A** true pending surface loss terminates; after synchronous claim it is harmless because `pending !== captured`. Retained-only absence must never be interpreted as lost pending surface. |
| `layoutRevision`, resize callback, `invalidateLayout` | **A** invalidates proof/triggers reactive non-layout checks. No publication geometry prerequisite; resize remains presentation-only after claim. |
| `pendingSurfaceUsable`, `ready`, `layoutProof`, `live`, `validGeometry`, `completedFrame` | **A** whole-surface proof immediately before claim; not **P/C/D**. Fresh mount starts with no proof. |
| `decide()` / `mouseDecision()` | **A** unregistered left-pointer path and run-to-completion claim. Must explicitly retain exact root and valid proof requirements after relaxing publication guard. |
| Global Solid effect `disposeWatch` (335–346) | **P/A/C/D** track location/projection/echo/liveness; current route STOP before any surface is **X**. Root-return scheduling is a **Design** addition, never evidence or a decision. |
| `decidingFrame` (326–330) | **C** preserves claimed route/location/projection checks after strip disposal. Existing early return after dispatch stays. |
| `removeEvents`, expected synthetic/switch/prompt echoes (275–317) | **P/C/D** exact native lifecycle/echo guards. `session.viewed` is explicitly ignored; client selection is caught elsewhere. Navigation does not create a new native result. |
| Renderer destroy/render/handler errors | **P/A/C/D** trusted TUI lifetime failure closes the attempt even off-root. Missing frame proof leaves pending inert; actual renderer loss stops. |
| `terminate`, `closeAuthority`, plugin cleanup | **P/A/C/D** irreversible closure/revocation. Must clear the added retained reference before other cleanup. |
| Departure during first root preparation before the surface is readable | **Design**: latch root-bound pending before async preparation and STOP on departure. Do not add a rearm/retry loop. |
| Departing a live pending surface | **A**, preserve existing STOP; not part of the publication exception. |
| Departing after prompt dispatch | **D**, route alone is currently permitted; location, exact evidence, generation and result checks remain. No redesign in #5. |

Reactive tracking must remain explicit: a plain local reference assignment is
not a Solid signal. Reuse `layoutRevision` to notify the effect when retained/
pending ownership changes. The effect must read route primitives as well as
root projection stores and current primitive location, without interpreting
off-route state as evidence loss during publication/retention.

## 6. Recommended architecture

Keep one TUI-local `retained` reference. The ownership progression is:

```text
publish once → retained exact PublishedAttempt, no decision component
exact root selected → transfer once to pending; revalidate; mount inert strip
fresh complete valid frame → same pending strip may capture one decision
positive claim → deciding; existing admission/executor
cancel / genuine invalidation / teardown → closed, no rearm
```

This is presentation ownership, not durable workflow phases. There is no new
kernel phase, exported lifecycle interface, or continuation service.

### Guard policy

Change the TUI's `assertCurrent()` so closure/revocation, attempted-location
identity, publication/switch echo integrity, and retained projection remain
mandatory. Its projection reference becomes `retained ?? pending ?? deciding`
(these references must be mutually exclusive). Require selected root when
`pending || deciding` and `!guard.dispatched`. During publication and
retained-only ownership, selection has no bearing on this assertion.

Keep `assertDecision(captured)` requiring `deciding === captured`, then this
guard. No retained object is a decision owner. Keep an explicit exact-root
check at `decide()`/surface validation so permissive publication liveness can
never accidentally authorize off-root.

### Retention and one root preparation

After `publishPlan()` returns and its final TUI owner check passes, retain the
same object privately for an eligible clean-initial activation. Preserve the
existing fresh clean Git check there. Ineligible activations keep their normal
planning-only status and close authority, even if a child is selected. They
never become authorizable after cleaning or navigating later.

One small local helper, provisionally `armRetained()`, is called by the
reactive watcher when an open eligible retained object and exact root coincide.
It must synchronously transfer `retained` to `pending` **before any await**.
Thus repeated frames/revisions/effects cannot start another preparation. It
captures that object and keeps the usual root-required guard active while
running existing `verifyPublishedAttempt(context, captured, guard)`.

On successful validation, synchronously require the same pending object,
live generation/open owner, exact root/location, unchanged
`publishedPresentationMatches()`, and
`requireFresh(observeGit(originalDirectory, originalBaseline), originalBaseline)`.
Only then call `ensurePresentation(bound.parentID)` and set the pending
presentation for that exact object. Failure terminates; no rehydration repair,
second synthetic, or new candidate. This full server barrier plus final fresh
Git read is needed before exposing the surface; merely rendering the old cache
and postponing all validation to the Authorize click is insufficient.

`pending` may temporarily mean root-bound ownership awaiting preparation, with
no pending `presentation` yet. No additional readiness flag is needed: the
existing presentation signal and strip's frame proof already control rendering
and actionability. A route departure during preparation terminates, including
departure and return during an await; the reactive latch prevents recovery.
Old promise completions must check closed/generation/exact pending ownership
before installing any presentation.

### Fresh decision surface

Create a new strip only after root preparation. It starts with no `layoutProof`
and `ready(false)`. Child frames, root navigation, successful server reads,
matching old terminal dimensions, or a cached frame cannot make it ready.
Only its subsequent completed frame proves current mounted root geometry.
Preserve every detailed issue #4 layout predicate, resize invalidation and
follow-up-frame rule. Controls may be rendered inert while awaiting that proof;
neither Authorize nor Cancel is a valid decision until it succeeds.

When a root instance renders, require both its input root ID and selected root
before creating an authority-capable strip. Host documentation permits multiple
slot instances, so input equality alone is not sufficient. Preserve true
pending-strip unmount STOP and the exact claimed cleanup exemption. Never mount
a DecisionStrip merely to retain publication in a child view.

`src/attempt.ts` needs no change: `verifyPublishedAttempt()` is already public,
route-free except for the injected guard, and performs exactly the full barrier
needed here. `checks()` should keep its publication/clean/implemented Git
policies. A separate kernel route-free guard, weaker verifier, or UI phase in
the authority kernel would move presentation policy into the wrong owner.

## 7. Navigation/lifecycle semantics by phase

| Case | Recommended behavior |
| --- | --- |
| A. Enter Planner before root completion | Harmless selection change. Native bootstrap proceeds; same location and valid evidence remain required. |
| B. Root completes while Planner selected | `attempted` latches once; publication/native/Git checks proceed, one S is admitted and hydrated, and the exact result is retained privately. |
| C. Stay in Planner after publication | Retained publication stays alive without a strip or decision callbacks. No grant, slot switch or prompt. No root resume. |
| D. Return to exact root | Transfer the same retained object once into root-bound preparation. Revalidate full publication/native evidence, exact projection, original location and fresh clean Git. Mount inert strip, then require a new complete readable frame. |
| E. Leave an already-live pending surface | Preserve permanent STOP. Do not demote it to retained or let returning restore controls. The recommended conservative boundary also stops departure after root preparation starts but before a valid frame. |
| F. Leave after synchronous Authorize claim, before dispatch | Preserve issue #4 STOP. `decidingFrame`, reactive route/location checks and per-await owner checks remain active; zero implementation prompts after invalidation. A role switch may already have happened. |
| G. Navigate after prompt dispatch | Preserve existing route-independent dispatched continuation and exact location/native/result/Git gates. No resend, recovery, rollback, or status redesign. |

Before root preparation, Planner → another child → root is allowed if location
and retained evidence stay valid. A different root session is not the exact
root and cannot prepare this surface. Pure selection of it does not authorize
or substitute its identity; actual location/projection/native invalidation
still terminates. This report chooses route independence for all selections
before preparation, avoiding an invented child-selection whitelist. Once
preparation begins, every non-root route remains terminal until dispatch.

## 8. Publication uniqueness and stale-state analysis

| Existing identity/mechanism | Guarantee and required preservation |
| --- | --- |
| Activation-private `generation` object, `creation`, original location/baseline | Immutable activation binds one fresh root; teardown revokes the generation. Later setup starts with no creation, retained publication, or authority. |
| `attempted` set before `publishPlan()` | Completion handler cannot publish again, including during waits. Same completion ID is ignored by the generic observer; a different unexpected root completion terminates rather than republishes. |
| `generation.busy` | Excludes concurrent CAP operations. It is not idempotence by itself: direct repeated `publishPlan()` calls could publish again after busy clears. One-shot safety comes from the trusted TUI caller's `attempted` latch. |
| Exact `bound` call/tool/root/Planner/slot IDs and creation times; H0/HP/HS | No Planner rerun, continuation, replacement slot, substituted result, or identity alias can satisfy revalidation. There is no code path creating a new child during preparation. |
| Frozen candidate encoding/digest and untouched proposal | Same semantic object with exact strings/order/root/HEAD, rather than a callback rebound to a newly parsed candidate. Do not construct another candidate for root return. |
| `guard.publishing.id`, full S, `publicationEcho`, `guard.publication` | Exactly one proposed message ID and one admitted record, independently verified. The truncated Plan hash alone is not unique or authority evidence. |
| Added retained reference, then `pending === captured`, then `deciding === captured` | Transfer object identity, not a copied `PublishedAttempt`. Only one holder at a time; synchronous transfer prevents duplicate preparation and synchronous claim prevents duplicate/racing decisions. |
| Original pending S plus exact TUI materialization | Root return uses the same ID/time/payload and server evidence. It does not append a second synthetic to make the Plan visible. |
| `closed` and generation revocation, checked after async work | Delayed preparation completions, stale strip handlers, and old-generation promises cannot install a surface, grant, or dispatch. Clearing retained/pending/deciding is irreversible. |
| One-use grant adjacent to exact prompt invocation | Only an explicit current positive claim reaches the existing grant path; once consumed, dispatch is not repeated. |

No root-return callback should capture a mutable “latest candidate.” Capture
the retained object before the synchronous transfer and compare exact ownership
again before presentation. Do not add a rearm callback after Cancel/STOP/claim.
The helper needs no retry counter or navigation ticket because preparation is
one-shot and any departure once started closes the attempt.

A newer activation must dispose/revoke the old one before use; the host owns
activation disposal and the plugin cleanup revokes synchronously first. The
plugin does not keep a global latest-publication register and must not invent
cross-generation authority restoration. An old transcript Plan can remain
visible as inert history, but no old closure can become actionable. Navigation
selects a possible place to prepare evidence; it creates no decision, grant,
or child operation.

Tighten only the added holder's cleanup, mutually exclusive identity transfer,
selected-root rendering/capture, and pre-surface root-return barrier. Preserve
all production freshness reads. No change to digest, grants, synthetic IDs,
native binding, or dispatch idempotence is required.

## 9. Cleanup and failure behavior

| Situation | Required behavior |
| --- | --- |
| Publication completes in Planner | Store one exact eligible retained object; do not mount a pending strip there. No authority granted. |
| Extended child inspection | Keep activation-private retention; keep event/reactive/renderer observers. No expiry/retry/workflow state is introduced. Git is not continuously polled while idle; it must be observed again before surface preparation and admission. |
| Planner → same-location other child → root | Retain before preparation; on exact root perform the full one-shot preparation. Same-family navigation does not replace IDs or wake root. |
| Root disappears/moves/changes permissions or receives unexpected input/execution | On receipt of the native event terminate; independent server reads catch delayed/missing notifications. No root reconstruction. |
| Bound Planner or slot disappears/mutates | Same: bound IDs in the observer terminate; `session.get`, idle/history checks reject on root return. Children cannot be replaced. |
| Plugin/TUI destroyed or newer generation supersedes | Cleanup first sets `generation.revoked = true`, clears retained/pending/deciding/guard/echo references, then clears presentation and removes slot, subscriptions, watcher and renderer handlers. Old async work cannot publish a passing outcome or grant. An in-flight host admission may still leave inert S; never retry/cancel it as recovery. |
| Renderer destroyed or render/handler error | Existing `rendererLost` permanently closes ownership even during retention. No later frame may restore readiness. |
| Current primitive location/directory/workspace changes | Terminate independently of route. Kernel barriers and explicit reactive reads must preserve this check. Returning to the old location cannot reopen a latched failure. |
| Publication/native/server evidence changes before root return | Received events or reactive projection changes stop immediately; otherwise root-return reads reject. No hydration repair or evidence replacement. |
| Git/HEAD changes before root return | Publication-time awaits retain existing checks. After idle retention, root-return `verifyPublishedAttempt()` and fresh clean check reject currently changed evidence. No snapshot claim or detection of every transient undone filesystem mutation is added. |
| Root projection cache disappears/changes | Exact projection mismatch terminates once retained. Cache availability remains required; no silent weakening to server-only authorization. |
| Pending strip later mounts | Fresh proof only after validation and completed frame; no proof inherited from a child or prior mount. |
| Pending strip unmounts | Preserve terminal true-view-loss behavior, including pending-but-not-readable strip loss. Replacing after exact claim is exempt because pending ownership was synchronously cleared. |

Events before `guard.bound` is available cannot yet be matched to retained child
IDs by the generic listener; initial and repeated native reads independently
bind them. This existing boundary is sufficient for publication and is not a
reason to infer IDs from navigation.

`closeAuthority()` should additionally clear `retained` synchronously. The
status contribution can remain root-scoped for STOP/Cancel/gate reporting,
with display text only. The retained-only branch must not create a fake pending
surface whose routine absence/unmount immediately calls `terminate()`.

## 10. OpenCode 2.0.21 host/API findings

Read-only authoritative upstream checkout: `../opencode`, HEAD
`8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`; its
`packages/plugin/package.json` reports 2.0.21, matching the project pin.
Nothing in upstream was modified, built, or run. Paths below are relative to
that sibling checkout.

| Operation/source | Finding |
| --- | --- |
| `packages/client/src/promise/generated/client.ts`, 617–642, 762–780, 875–889 | `session.active()` returns session-keyed activity. `get`, `synthetic`, and `inbox.list` use explicit `sessionID` HTTP paths. No selected UI session enters these arguments. |
| `packages/core/src/session.ts`, 449 | Dispatches `synthetic(input)` to `sessions.forSession(input.sessionID)`. |
| `packages/core/src/session/session.ts`, 275–314 | Synthetic admission verifies the target exists, admits exact ID/session/item, returns the admitted record, and wakes execution only when `resume !== false`. It has no TUI router. `resume:false` keeps this call from waking root; external input/wake remains independently invalidating. |
| `packages/plugin/src/tui/context.ts`, 76–88 | Pending/message `list`, `sync`, and `invalidate` are explicitly session-keyed; none requires root selection. |
| `packages/client/src/solid/data.ts`, 1394–1438 | Pending sync fetches `api().session.inbox.list({ sessionID })`, reconciles overtaking events, writes the session-keyed store and materializes synthetic/user rows. It does not inspect a selected route. |
| Same file, 390–400 and 1619–1652 | Synthetic projection is `{ id, type, ...payload, time: { created } }`. Message sync reads the requested session and preserves materialized pending inputs not in server history. Both match the current verifier's exact H0 + S model. |
| `packages/tui/src/plugin/api.tsx`, 138–140, 182–200 | `context.location` adapts the current location service; `ui.router.current()` returns the separate reactive `host.route.data`. Route is client-local selection, not a server admission condition. |
| Same file, 270–289; `packages/tui/src/plugin/render.tsx`, 85 onward | `ui.slot()` registers a persistent claim in the plugin registry and returns unregistration. Rendering is separate; Slot supports multiple instances and reactive input through merged getters. Registration does not require a selected root or create a decision. |
| `packages/tui/src/routes/session/index.tsx`, 1462 | Host mounts `session.composer.top` with the rendered route's session ID. The plugin can conditionally show only root. Actual selected-root checking is still required for authority. |
| `packages/tui/src/context/session-retention.ts`; `session-tabs.tsx`, 138–145 | Host retention groups sessions by family root, retains the current root family, open tabs, and three recent roots. Inspecting Planner or a sibling child preserves the root family. Pure child selection does not force root cache eviction. |

**There is no host API requirement to select root for synthetic admission,
root/inbox queries, root-keyed pending/message hydration, or retaining a
conditional composer contribution.** No publication verification is inherently
impossible while Planner is selected. The observed restriction comes from the
plugin guard.

Real host limits still exist: message hydration is a bounded initial window,
so exact full H0 projection can fail for oversized histories; visiting enough
unrelated root families can evict cached publication data. Missing or changed
projection must still fail closed. #5 does not promise indefinite cache pinning
across unrelated tabs or relax complete projection. Current-family child
inspection does not have that eviction problem.

The project's installed OpenTUI 0.5.12 source emits `frame` after root rendering,
post-processing and successful native render (`node_modules/@opentui/core/
chunk-bun-91mz470w.js`, around 10045–10082). The upstream 2.0.21 catalog uses
OpenTUI 0.5.14, so this is corroboration for the existing layout mechanism, not
an independent execution proof of the live host's renderer. Upstream
`packages/tui/src/app.tsx`, around 487, also notes that native output can still
be flushing when FRAME fires. Preserve issue #4's existing completed-layout
interpretation; #5 introduces no physical-display attestation. Live root-return
dogfood should verify mounting/readability under the pinned host.

No unresolved session/publication/slot API question blocks implementation.
Actual renderer scheduling and root-return presentation remain live validation
items, using the already-established issue #4 frame boundary.

## 11. Security / CAP analysis

The recommendation keeps publication non-authoritative. P, candidate digest,
S, metadata, route changes, server records and visible prose cannot call
`grantIntent()`. Retained-only ownership has no DecisionStrip, no decision
callback, no valid surface proof and no `deciding` identity. It cannot invoke
the authorized executor.

Root selection enables a place for trusted presentation only after exact
revalidation. The human still supplies an explicit local left-pointer decision
for the captured immutable pending object. `decide()` rechecks root/current
ownership and the complete current frame proof before synchronously claiming.
Cancel closes without a grant. Authorize reaches `authorizePublishedAttempt()`
only with exact `deciding` ownership, then independently verifies publication,
initial eligibility and current clean Git.

Preserve the existing same-slot implementation path: trusted grant creation,
one role switch, exact switch/native barriers, final clean freshness, candidate
coherence, one-use consumption adjacent to the single exact prompt, exact
admission/result binding, unchanged HEAD and exact scope gate. After dispatch,
cleanliness is intentionally not required because implementation may be editing.
The root is not resumed; S stays pending, and synthetic delivery or root wake
still stops. Failed or ambiguous transport never retries.

Issue #4's live-established pre-dispatch route/location STOP is untouched.
Pending resize remains inert until a fresh valid frame; claimed resize remains
presentation-only. The 80×24 policy is preserved. No additional threat model,
same-user containment, durable authority, workflow recovery, Reviewer or Commit
mechanism is introduced.

## 12. Target files

Later implementation should change exactly:

1. `.opencode/plugins/opencode-agents/tui.tsx`: private retained ownership,
   lifecycle-sensitive injected route policy, one root preparation helper and
   full existing verifier call, root-only strip gating, exact stale callback
   checks, and retained cleanup.
2. `test/attempt.test.ts`: focused trusted-double regressions below.
3. `docs/v1-orchestration.md`: describe independent publication/retention,
   one root presentation preparation and fresh frame, while preserving live
   pending/claimed/post-dispatch policies and updating #5 status accurately.

Keep `src/attempt.ts`, `src/proposal.ts`, `src/cap.ts`, `src/git.ts`, all other
production files, role instructions, manifests/lockfile, other tests,
`docs/charter.md`, `docs/coding-authority-protocol.md`, and both issue #4 reports
unchanged. No upstream or predecessor changes. This investigation document is
the only repository change in the present pass.

## 13. Automated regression plan

Use existing `snapshotTest`, `SnapshotObserver`, `snapshotFixture`, `fake`,
reactive Solid route/store doubles, `settleUntil`, `mount`, captured pointer
handlers, fake `EventEmitter` renderer, and local awaited-operation wrappers.
No real Git fixtures are needed for these route/native/CAP behaviors. Keep
production observations unchanged and intercept only at test scope. Extend
local doubles only where a concrete case needs it; no hidden integration
harness, production hook, new framework, Docker or host process.

### Primary regression and existing test replacement

Replace `reactive navigation loss during a publication await latches before
returning to root` (1494) with a positive case named, for example, `Planner
inspection during a publication await retains one Plan without a decision`.
Keep the local deferred root-wait promise and real plugin setup/reactive route.
Set fresh root creation time **after setup's baseline observation** and emit the
matching Created event, so this case exercises an eligible activation. The
current original test's early creation time was sufficient for a failure test
but would only prove planning-only behavior after #5.

Start publication on root, pause at `session.wait`, select
`{ type: "session", sessionID: "planner-child" }`, release the wait, and keep
Planner selected until publication and both hydrations finish. Assert:

- One synthetic invocation, `resume:false`, exact root/P/description/metadata.
- Exact server pending S and root TUI H0 + materialized S are available.
- No STOP merely for selection; zero slot switches and implementation prompts.
- Rendering child slot input and emitting child frames exposes no decision
  handlers/valid surface. Revisions and duplicate same-ID completions cannot
  publish or prepare again.
- Exact publication persists after microtasks/frames and Planner → sibling
  child navigation. Successful later root use proves private retention rather
  than only server storage.

Add one short variant selecting Planner before the completion event. It proves
that `attempted = true` no longer closes an already-away route. Parameterize a
small number of local await barriers, including root wait and an await after
synthetic admission/hydration, to prove the guard remains route-safe throughout
publication without duplicating expensive fixtures.

### Root return and identity/uniqueness

Continue the primary retained attempt or add a focused same-sequence case:

1. Save the admitted S ID/full record, expected candidate, H0/HP/HS and bound
   child IDs. Return to exact root with a reactive route change.
2. Hold a root-return server read. During that await assert no actionable
   surface, no switch/prompt, and still one synthetic. Release and settle the
   full validation barrier before mounting the root strip.
3. Mount with `completeLayout = false`. Invoke captured Authorize/Cancel:
   neither claims. A frame emitted while in Planner must not count. Matching
   old viewport dimensions alone must not count.
4. Emit a fresh valid completed frame for the root surface. Click Authorize
   once, then stale/duplicate Authorize and Cancel handlers. Observe synchronous
   claimed status, exactly one switch of `slot-child`, exactly one prompt with
   the expected `implementerPrompt(candidate)`, and the ordinary successful gate.
5. Require unchanged S ID/time/full payload and H0/HP, exactly the original
   three sessions, no extra root/Planner inputs or native calls, and exactly
   one synthetic throughout. Observe unchanged baseline HEAD and exact result
   scope with `SnapshotObserver`.

To assert object identity without a production hook, locally wrap the module's
existing `publishPlan` export in this one test to capture its real returned
object (restore it in `finally`), or extend existing test-scoped JSX prop
capture to retain the actual `DecisionStrip` props. Compare the rendered/
claimed object with that captured result, plus its candidate and `bound`
references; do not expose closure state in production. Kernel tests already
cover a copied/unclaimed `PublishedAttempt` being rejected. The observable
same-ID/same-prompt test remains necessary even with the identity assertion.

The fake host has no child-creation method. Unchanged session keys, H0 native
calls and HP/HS plus no extra child inputs prove no Planner rerun/replacement
within this path. A test-scoped rejecting/counting method is sufficient if
later implementation accidentally adds a host create call; no live integration
is needed.

### Negative cases at the retained-to-root boundary

Use small focused cases or one local table with fresh doubled attempts. Mutate
while retained, before root becomes authorizable, then return/mount/frame/click:

- `SnapshotObserver.configure`: changed HEAD or ordinary changed paths. Require
  STOP, no valid surface, no switch/prompt, and no second publication. Preserve
  initial dirty planning-only tests separately.
- Exact S fields, extra inbox item, synthetic promotion, H0, or root TUI
  description/pending/message projection. Reactive mutation should latch when
  observed; silent server-only drift must fail at preparation reads.
- Planner transcript/result/creation/permissions, slot identity/permissions,
  or native root call binding. Reject rather than replace children/evidence.
- Select another root: no preparation or decision there, one retained S only.
  Separately substitute bound/root creation evidence and require STOP. Do not
  use pure pre-presentation child navigation as the negative case.
- Reactive directory or `workspaceID` drift: STOP despite child selection;
  restoring the old location cannot reopen the attempt.
- Root, Planner, or slot deletion event: immediate STOP. A silent deletion/
  rejected get must fail before mounting on return too.
- Plugin cleanup while retained or while root-return verification is awaited:
  revoke, release the promise, and prove no old presentation/grant/prompt.
  Replacement activation has no adopted root and cannot inherit S/authority.
- Renderer destruction/error while retained: permanent closure. Late frames
  and stale callbacks stay inert.
- Enter root preparation, pause a read, navigate away and back before release:
  STOP stays latched. No later mount from the stale continuation.

Retain existing `lost view, navigation, projection mutation, and cleanup cannot
restore controls` (1048) for **already-presented pending** state; do not reverse
its navigation assertion. Retain `claimed authorization still stops on
non-layout drift during awaited switch` (1080), especially route/location, with
one switch permitted and zero prompts. Keep exact synthetic/switch event and
late echo reconciliation, permission/native/pagination integrity, duplicate
completion, prompt ambiguity, result binding and real Git boundary tests.

### Issue #4 compatibility and later checks

Leave existing pending resize proof invalidation/recovery, detailed invalid
frame, wrapping/follow-up frame, synchronous geometry recheck, sub-minimum
pending recovery, and post-claim resize/strip replacement tests semantically
unchanged. Keep true pending unmount terminal. Exercise a root-return mount at
invalid geometry with recovery through a later valid frame for the same Plan;
this uses existing 80×24 policy and does not solve #7.

Later implementation validation: `bun run typecheck`,
`bun test test/attempt.test.ts`, and `bun test`, followed by diff/status review.
This documentation pass runs no implementation tests.

## 14. Live dogfood plan

Do not run during this investigation. Run manually only after implementation
and automated validation, using the pinned OpenCode version and a fresh
activation for each scenario.

### Positive: Planner inspection through publication

1. Confirm a clean worktree and record initial HEAD. Manually start OpenCode.
2. From a fresh root Orchestrator, request one harmless exact edit, such as
   appending a unique dogfood marker to `README.md`.
3. Immediately enter native Planner while it is working. Stay through Planner,
   retained slot, and root completion. Confirm selection alone causes no STOP
   and no edit occurs before a trusted decision.
4. Return to the exact root. Confirm the complete trusted synthetic Plan,
   exact file scope and bound HEAD are present for that same root/Planner/slot
   attempt, alongside the model-authored final rather than copied Planner prose.
5. Confirm Authorize / Cancel becomes actionable only after current root
   validation and a fresh readable redraw. Use comfortable ≥80×24 geometry.
6. Click Authorize once. Confirm claimed status and exactly one continuation of
   the existing slot. Inspect native slot history for one role switch and one
   trusted implementation input; confirm there was no second Planner, slot or
   synthetic Plan. No extra root model turn should occur.
7. Confirm the normal trusted unchanged-HEAD/exact-`README.md` scope gate and
   STOP before Reviewer / Commit. Stop the manual session, restore only the
   known test edit, and confirm clean worktree and unchanged HEAD.

### Negative: genuine retained evidence invalidation

Start another clean fresh activation, repeat Planner inspection, and stay in
Planner after publication. Before first root preparation, externally create
one uniquely named ordinary untracked file in the test worktree (avoid ignored
paths). This produces a genuine Git freshness invalidation without altering
history or using navigation as the invalidating event.

Return to exact root. Require trusted STOP, no valid decision surface, no slot
switch or implementation prompt, and no second publication. Restoring the file
state or revisiting root must not reopen that closed attempt. Stop OpenCode,
remove only the known dogfood file, and verify clean worktree and initial HEAD.
No new attempt should inherit the prior Plan or authority.

## 15. Non-goals / deferred issues

No issue #1 dirty-prose cleanup, issue #6 retained-slot root presentation,
issue #7 narrow-terminal policy, Reviewer, Commit, recovery/retry/replacement
children, durable phases, generic continuation, keyboard/model authorization,
root-model Plan copying, or automatic launch. No issue #4 reopening: its pending
resize behavior and post-claim route/location policy remain established.

No broader change to navigation after a live pending surface or after dispatch.
No indefinite pinning of unrelated-root cache families, extra-large-history
hydration redesign, synthetic cancellation, or root-turn resumption. Genuine
invalidation still ends the attempt; returning to root is first presentation
of retained evidence, not recovery from STOP.

## 16. Implementation checklist for a later execution pass

- Add one private retained publication holder and clear it in `closeAuthority`.
- Scope route requirements to root-bound pending/claimed ownership before
  dispatch; preserve unconditional attempted-location, generation, echo and
  exact retained projection checks.
- Retain the exact eligible returned publication; preserve planning-only
  closure for initially dirty/unproven-order activations.
- Add one root preparation helper: synchronously transfer retained to pending,
  capture exact identity, call existing `verifyPublishedAttempt`, recheck full
  projection/root/location and fresh clean Git, then install pending presentation.
- Reuse the reactive watcher and revision notification; prevent duplicate
  preparation and ensure stale async success cannot install a surface.
- Require selected root as well as slot input root when creating/capturing the
  strip. Obtain a new completed-frame proof, preserving all issue #4 predicates.
- Preserve pending/claimed route-loss STOP, claim cleanup, same-slot dispatch,
  all native/server/Git barriers, and post-dispatch behavior.
- Replace the publication navigation-STOP regression and add retained/root
  return/uniqueness/invalidation cases with existing cheap trusted doubles.
- Update only the runtime owner document `docs/v1-orchestration.md` for this
  behavior; run later typecheck/focused/full tests and the two manual dogfoods.

Investigation validation: `git diff --check` produced no diagnostics;
`git diff --stat` was empty because the sole new document remains untracked.
`git status --porcelain=v1 --untracked-files=all` listed only this document.
`git rev-parse HEAD` remained
`7de69a82b18461e92dd4bb0379997a22a8171c7b`. A supplemental
`git diff --no-index --check /dev/null <document>` produced no whitespace
diagnostics (exit 1 denotes the new-file difference). A corresponding no-index
stat confirmed one added document. No implementation tests were run.

**Final recommendation:** issue #5 is valid as written, with its historical
2.0.20 dogfood version interpreted against the current 2.0.21 pin. The exact
cause is `attempted` enabling the TUI's root-route guard throughout publication,
with both awaited checks and the reactive watcher irreversibly closing
ownership. Correct the boundary in the TUI: publish/retain independently of
selection; on exact-root return revalidate the same object, then require fresh
readable-frame evidence for the explicit decision. Keep `src/attempt.ts`
unchanged. Later change exactly `tui.tsx`, `test/attempt.test.ts`, and
`docs/v1-orchestration.md`; leave the kernel, proposal/CAP/Git code, role files,
dependency files, other tests, normative CAP/charter and issue #4 reports
unchanged. Key regressions are publication while Planner remains selected,
same-object root-return validation/frame/one dispatch, immutable identity and
single synthetic, genuine retained invalidation, and unchanged pending/claimed
issue #4 behavior. Minimum live proof is one successful Planner-inspection
authorization and one retained Git-invalidation STOP. No unresolved host API
question must be answered before implementation; pinned-host root-return layout
and renderer scheduling are live validation items.
