# Published-Plan authorization investigation

Investigation/design only, 2026-09-30. **Recommendation: supported on OpenCode 2.0.20 without upstream changes.** Retain the exact publication binding in the active TUI generation, verify the original server histories plus exactly one pending synthetic Plan, accept a direct local decision once, and reuse a single same-slot implementation executor. Only attempts whose trusted initial clean observation preceded native bootstrap may offer Authorize. A dirty-baseline Plan remains presentation and can never become authorizable by becoming clean later.

This report changes no runtime, tests, agents, package metadata, or normative document. No OpenCode, Docker, upstream build, commit, push, or live probe was run. Source support below is not a claim of live verification of the new integration.

## 1. Baseline and evidence conventions

The first commands were `git rev-parse HEAD` and `git status --porcelain=v1 --untracked-files=all`.

| Fact | Observed value |
| --- | --- |
| Starting implementation HEAD | `1974b28717a1e42bef758424980b0a91597d9ea6` (expected checkpoint) |
| Starting worktree | Clean; porcelain output empty |
| Selected read-only host | `../opencode`, HEAD `84c9be93a56304a108f1a22df0c5d62c26d5b6ca`, exact tag `v2.0.20` |
| Declared/installed plugin | `@opencode/plugin` 2.0.20; both project and installed manifests checked |
| Installed client | Plugin dependency/installed client 2.0.20 |
| Host OpenTUI packages inspected | `../opencode/packages/tui/node_modules/@opentui/core` and `@opentui/solid`, both 0.5.12 |
| Project UI peers | `solid-js`, `@opentui/core`, `@opentui/solid` absent in this project's `node_modules` |

**Verified current behavior** means static inspection of the checkpoint or selected host. **Historical evidence** means the seven requested history documents, not current proof. **Design inference** explains a consequence of those sources. **Recommended behavior** describes future changes only.

Host citations use paths relative to the implementation root, symbols and line ranges at the host commit above. They can be resolved in the read-only sibling; installed `node_modules` references are explicitly distinguished from committed host source. Project citations use paths/symbols at the starting HEAD. CAP remains normative, particularly [clean admission](../coding-authority-protocol.md#clean-admission-and-freshness), [human decision](../coding-authority-protocol.md#human-decision-and-process-local-grant), and [failure/roles](../coding-authority-protocol.md#roles-bounded-implementation-and-failure).

The requested current files were read before the historical evidence. The historical hybrid decision supplies the selected layout; nonmodal investigation supplies the closure-provenance hypothesis; Question reassessment supplies the public-reply threat; projection investigation supplies distinctions between pending input and history. The three native Implementer investigations record the original host-seam proposal, the stronger residual-role objection, and its subsequent correction under the accepted CAP threat model. The present recommendation uses current code/CAP and independently rechecked 2.0.20 paths. It does not inherit their old M1/M2 architecture or their obsolete blocked verdicts.

Historical sources read: [hybrid UX decision](hybrid-authorization-ux-decision.md), [nonmodal authorization](native-nonmodal-authorization-investigation.md), [Question reassessment](native-question-cap-reassessment.md), [transcript projection](trusted-transcript-projection-investigation.md), [CAP-gated native Implementer](milestone-2-cap-gated-native-implementer-investigation.md), [native-child handoff](milestone-2-native-child-authority-handoff-investigation.md), and [native-child threat-model reassessment](milestone-2-native-child-threat-model-reassessment.md). Their 2.0.17/2.0.18 prototype/probe conclusions are historical evidence only.

## 2. Current-state diagnosis

Verified at this checkpoint:

- `src/attempt.ts:Bound` (40–46) contains exact root input, native calls, child results, and serialized complete parent/Planner/slot histories. `bind` (170–197) validates these independently of root narration. `parentCalls` (115–140) permits one plain user input, one successful turn, exactly two native calls, and no synthetic/control extension.
- `publishPlan` (244–277) binds locally, freezes the exact Planner final text into a candidate, sends `session.synthetic(...resume:false)`, checks returned text/description and immediate root inactivity, and returns only `{candidate, planHash, syntheticID}`. The native `Bound` is lost. Metadata/delivery/time and full post-publication readback are not checked today.
- `.opencode/plugins/opencode-agents/tui.ts:setup` (9–66) takes the activation Git snapshot, adopts one newly observed root, publishes from `session.execution.succeeded`, and retains only candidate plus diagnostic plan hash. Root wake produces a warning, not revocation. No authorization control or implementation caller exists.
- `runImplementationAttempt` (279–334) constructs another candidate from pre-publication binding and awaits a modal confirmation. It then grants, switches the same slot, consumes once, prompts once, binds the result, and applies the Git gate. Passing a published root to this function fails before confirmation: on the actual host, its `idle` rejects the pending Plan inbox item; after delivery, `parentCalls`/whole-history equality reject the synthetic extension. `test/attempt.test.ts:633–644` covers the latter with a deliberately appended synthetic double, not the actual idle pending representation.
- `requireFresh` (`src/git.ts:57–61`) checks the current snapshot, not that `baseline.paths` was initially empty. Publication intentionally allows stable dirty paths. Neither a clean check after bootstrap nor a positive UI result repairs a dirty initial baseline (CAP 101–122).

Thus connecting the existing functions is insufficient. Required changes are retention, a precise publication-aware verifier, initial eligibility, local decision ownership, and factoring the shared executor. Plan text, metadata, IDs, digest, and root final prose remain non-authorizing evidence/presentation.

## 3. OpenCode 2.0.20 host findings

### 3.1 Composer-top registration, rendering and local events

| Verified host/API fact | Evidence at `v2.0.20` |
| --- | --- |
| `session.composer.top` takes `{sessionID}`; claim render returns Solid JSX; `ui.slot` returns a remover | `../opencode/packages/plugin/src/tui/context.ts:SlotMap` 181–204, `SlotClaim` 224–260, `UI.slot` 512–513; installed `node_modules/@opencode/plugin/dist/tui/context.d.ts:SlotClaim` 199–231, `UI.slot` 455–456 |
| Slot is outside the scrollable transcript, directly above the normal Composer | `../opencode/packages/tui/src/routes/session/index.tsx:Session` 1416–1466, especially 1462 |
| Registration stores a local function, wraps it in `PluginContextProvider`, and returns idempotent unregister | `../opencode/packages/tui/src/plugin/api.tsx:createPluginContext` 92–96, 123–135, 270–283 |
| Render body runs once/untracked per contribution mount; input getters remain reactive | `../opencode/packages/tui/src/plugin/render.tsx:Slot` 85–119 (`createComponent`, `mergeProps`); 122–141 renders claims |
| There is no claim-update method | Same `UI.slot` contract and implementation. Registry placement is immutable; `../opencode/packages/tui/src/plugin/context.tsx:resolved` 494–520 keeps claim references stable |
| Removing a claim removes the contribution; changing reactive component state updates content | `registration` above; `Slot`'s `For`/`Show` above. Update via a Solid signal/accessor, or dispose/register a replacement; do not mutate placement or expect render to rerun on a plain variable assignment |
| Root/child navigation destroys/recreates the selected frame | `../opencode/packages/tui/src/app.tsx` 1363–1375, keyed `Show` around `SessionFrame` |
| Render exceptions become a toast and a null contribution, not a negative/positive decision | `../opencode/packages/tui/src/plugin/render.tsx:PluginBoundary` 24–45 |

The pointer route is concrete: Solid applies ordinary properties to OpenTUI renderables; the local renderer dispatches a mouse event to a hit target; `Renderable.processMouseEvent` calls its registered listener synchronously. It does not serialize a callback to the server. Host Confirm and the root jump control use the same `onMouseUp` shape (`../opencode/packages/tui/src/ui/dialog-confirm.tsx:DialogConfirm` 73–87; `routes/session/index.tsx` 1443–1448).

The installed host dependency gives the lower-level evidence: `../opencode/packages/tui/node_modules/@opentui/solid/index.bun.js:setProperty` 669–678, 792–794 assigns callbacks; `@opentui/core/chunk-bun-91mz470w.js:sendMouseEvent` 9268–9275 calls `processMouseEvent`, whose 1455–1462 calls `_mouseListeners[event.type]` and bubbles locally. `Renderable.d.ts:RenderableOptions` 74–86 declares mouse and key callbacks. These dependency files are package 0.5.12 evidence, not commit-tracked OpenCode files.

Keyboard can likewise remain local: a focusable renderable's `onKeyDown` is called from its local internal keypress subscription (`chunk-bun-91mz470w.js:Renderable.focus` 523–550; blur removes it at 571–574). Alternatively `@opentui/solid/index.js:useKeyboard` 136–150 subscribes/unsubscribes a local renderer listener. Prefer a deliberately focused strip with local left/right selection and Return/Space confirmation; no implicit affirmative default on merely focusing it, and no global plain Return that also submits the composer. Consume the key event locally. Exact focus acquisition, propagation, selection guards, and resize usability require later UI dogfood.

**Callback provenance remains supported.** The exposed TUI event inventory has prompt append, command execute, toast, and session selection, without a pointer/key injection or lexical-callback endpoint (`../opencode/packages/schema/src/tui-event.ts:Definitions` 11–60). `tui.command.execute` invokes `keymap.dispatch` (`app.tsx` 1260–1263). Therefore never register Authorize as a command ID, slash/palette action, keymap-dispatch target, RPC, Form answer, or session event handler. Neither Authorize nor Cancel needs any such route. A prior shell-capable model can call ordinary session/TUI APIs and cause interference/STOP, but those APIs cannot name this unregistered closure. This is the accepted local TCB boundary, not physical-human attestation against OS input automation or compromised installed UI code.

Question/Form is still publicly answerable. `../opencode/packages/server/src/handlers/session.ts:session.form.list/reply` 637–640, 675–688 accepts a session-owned ID and answer; `../opencode/packages/core/src/form.ts:reply` 176–190 validates shape/pending state and resolves the deferred, without local-gesture provenance. There is no material 2.0.20 change supporting reconsideration. Keep it excluded.

### 3.2 Synthetic: pending input versus projected history

This is the critical correction to the conceptual phrase “root transcript extended.”

1. `session.synthetic` builds a synthetic inbox payload, defaults delivery to `steer`, admits it, and wakes only if `resume !== false` (and no revert). It returns the admitted **inbox item**. Evidence: `../opencode/packages/core/src/session/session.ts:synthetic` 274–313; `../opencode/packages/client/src/effect/api/api.ts:SessionSyntheticInput/Output` 301–313; installed `node_modules/@opencode/client/dist/effect/api/api.d.ts` 340–352.
2. Admission publishes `session.inbox.enqueued`, retaining `id`, `sessionID`, payload, delivery and admission creation time (`../opencode/packages/core/src/session/inbox.ts:admit` 169–201). Pending storage is separate from messages (`projectAdmitted` 277–317). `session.inbox.list` is ordered, pending-only (`list` 386–394); promotion deletes the pending row (`projectDelivered` 319–335).
3. **With an idle root and `resume:false`, it does not yet appear in server `context.client.message.list()`.** That endpoint reads only `SessionMessageTable`: `../opencode/packages/server/src/handlers/message.ts:MessageHandler` 29–63 → `../opencode/packages/core/src/session.ts:messages` 369–371 → `session/store.ts:messages` 140–176. No inbox union exists there.
4. The **TUI** does include the pending Plan in `context.data.session.message.list()`: `../opencode/packages/client/src/solid/data.ts:admitLocal/materializeInboxMessage` 370–400 constructs `{id,type:"synthetic",...payload,time}`; `session.inbox.enqueued` 773–782 feeds that path. Its message sync preserves pending materialized rows (1614–1645). The root row reducer admits a nonblank synthetic description (`../opencode/packages/tui/src/routes/session/rows.ts` 241–247, 348–359). The notice renders the description without the completion-row truncation used for shell/subagent notices (`index.tsx:Notice` 1953–1984).
5. If later root execution delivers it, server history gets a `synthetic` message with **the same inbox ID**, raw text, description, metadata and **delivery-event** creation time (`../opencode/packages/core/src/session/projector.ts:InboxDelivered` 609–638). Pending disappears. The ordinary `session.synthetic` durable-event projector is a different historical/internal path (`message-updater.ts` 161–171), not what this API call emits. Do not confuse its event-derived ID with this call's admitted ID.
6. Delivered synthetic text becomes user-role model input (`../opencode/packages/core/src/session/runner/to-llm-message.ts` 284–285). Publication is not display-only. This milestone never resumes the root.

Rebinding answers: raw P, description, metadata, ID, delivery, time and session identity are available through the retained returned inbox object and subsequent `session.inbox.list`. Message records omit sessionID because the query supplies it; pending records include it (`../opencode/packages/schema/src/session-inbox.ts:SyntheticPayload/Synthetic` 20–25, 52–64; `session-message.ts:Base/Synthetic` 32–36, 83–89). **`resume` is not persisted in either representation.** Retain the trusted fact that this exact call used `resume:false`; verify inactivity, pending position and lack of root execution. A reread cannot attest the original resume flag by itself.

### 3.3 Session operations, ordering and lifetime

| Host fact | Exact selected source |
| --- | --- |
| `switchAgent` publishes selection and does not wake or prompt | `../opencode/packages/core/src/session/session.ts:switchAgent` 90–96 |
| Switch persists agent and appends `agent-switched` | `session/projector.ts:AgentSelected` 546–555; `session/message-updater.ts:AgentSelected` 90–102 |
| `prompt` admits an input, normally wakes, returns input admission, not implementation completion | `session/session.ts:prompt` 146–177; client `SessionPromptInput/Output` 267–279 (no per-prompt executing agent) |
| `wait` waits for execution idleness; it neither starts work nor proves empty inbox/success | `session/session.ts:wait` 266–269; `session/run-coordinator.ts:awaitIdle` 169–175. Waiters resolve after settlement, following successor executions |
| `active` is process-local active execution, not a lease or cross-process transaction | `session/execution.ts:Service` 18–42; `../opencode/packages/server/src/handlers/session.ts:session.active` 179–184 |
| Execution Started precedes drain in core; Succeeded follows drain and projects idle | `session/run-coordinator.ts` 94–106; `session/execution.ts` 111–147; `session/message-updater.ts` 63–75, 142–147; `session/projector.ts:projectIdle` 403–430 |
| A TUI subscription is a delivered notification, not a blocking before-run hook | `../opencode/packages/core/src/bus.ts:publishEvent/notify` 450–475, 494–503; `../opencode/packages/client/src/solid/connection.ts:publish` 65–73 batches events on a timer; `solid/data.ts` 1334 delegates `on` |
| Root Created timestamps are host-supplied; session created time retains them | `bus.ts:publish` 507–525 uses `Clock.currentTimeMillis`; `session/projector.ts:Created` 438–456; installed client API event declares numeric `created` |
| Deleting a session interrupts/waits, closes resources, removes children, then deletes | `../opencode/packages/core/src/session.ts:remove` 355–364 |
| Plugin setup returns cleanup; cleanup runs in reverse owned-registration order | `../opencode/packages/plugin/src/tui/plugin.ts` 5–9; `../opencode/packages/tui/src/plugin/context.tsx:activate/deactivate` 182–229, `disposeAll/setup` 633–644 |

Core Started-before-drain does **not** mean a TUI `data.on("session.execution.started")` handler runs before the model can launch a child. The server does not await the remote UI callback. Succeeded can also reach the TUI before coordinator cleanup finishes; publication must keep its `session.wait` and independent outcome/idle/binding checks.

Host deactivation marks the registration inactive, then runs returned plugin cleanup (registered last, disposed first), then clears contributions. The plugin's own cleanup must synchronously revoke generation and attempt before any other operation. Component unmount, renderer error handling and automatic slot removal do not substitute for revocation. Already admitted server work may continue after UI teardown; a new plugin activation starts with zero authority.

## 4. Clean-before-bootstrap decision

**Select Option A: only demonstrably clean-initial-baseline attempts can be authorizable.** Keep current stable dirty publication for reading, without an Authorize surface. Establish eligibility synchronously at activation, before adopting/launching any fresh-root attempt, from the actual frozen `observeGit` result; require `baseline.paths.length === 0`. Preserve original canonical root/HEAD. Never derive eligibility from a later observation, a caller-supplied `clean:true`, a transcript field, or candidate metadata.

| Option | CAP proof, races and UX | Complexity / decision |
| --- | --- | --- |
| A: clean-initial attempts only | A trusted clean observation before this newly created root necessarily precedes both native child launches. Recheck original root/HEAD/cleanliness after bootstrap before offering the strip and again at admission. Dirty publication remains useful as a bounded planning artifact; cleaning it later does not qualify it. Natural two-child Orchestrator interaction survives unchanged | Small private initial-eligibility record; recommended |
| B: STOP all dirty planning bootstrap | Sound if trusted code actually prevents root/native launch until the clean observation passes. Merely refusing publication or showing STOP from Created/Started is too late. Would remove useful dirty planning. A trusted root create/prompt entry could enforce it but changes the normal human composer entry/routing | No current TUI pre-tool veto; extra entry/gating machinery not needed for A |
| C: current before-bootstrap host hook | Core Started is before drain, but remote TUI notification is asynchronous. Server tool-before hooks are a different process/plugin surface, not a closure in this activation (`../opencode/packages/plugin/src/effect/tool.ts:ToolHooks` 20–51). Making them consult UI state requires new cross-process machinery | No reliable blocking TUI-local gate at native launch. Do not recommend it |

**Prove ordering, not just “newly observed.”** The present `freshParent` adoption does not record whether an asynchronously buffered Created event predates activation's observation. For an eligible attempt, retain the local observation completion time and the trusted Created event's session identity/time; reject authorization unless the root's host creation time is strictly later, and rebind the session's creation time to that event. Equal millisecond timestamps or inconsistent/missing time are ambiguous and yield no strip. This uses the supported ordinary local topology's trusted shared OS clock; it is not remote attestation. If ordering/clock correspondence is ambiguous, retain only non-authorizing publication or STOP. Do not recover eligibility by observing a clean repository after the root has already run. Existing roots and reconnect/replayed evidence cannot qualify a new activation.

An initial baseline is an observation, not a filesystem lock or a promise of continuously clean contents. There is an interval between activation and root/child execution in which ordinary local activity can occur. A fresh clean check before the authorization strip and the final admission checks reject observable drift; they cannot detect every transient edit followed by restoration. CAP prescribes a clean **initial observation before launch**, subsequent freshness observations, and ordinary Git limits; it does not prescribe an atomic filesystem/host transaction (CAP 101–114, 180–211). Option A proves that initial ordering rather than claiming a TUI event is a launch-time lock. If a future requirement demands a blocking observation immediately at each model-originated child launch, current TUI events cannot supply it; that would be a different host-gate requirement.

At publication, a baseline with dirty paths may still pass the existing path-set equality policy. An initially clean eligible baseline requires an actual fresh clean check after all publication/readback awaits before the strip is offered. Any failed eligible check terminates rather than turning into a pending attempt that later becomes clean. A published dirty Plan requires a new activation/root, clean initial observation, fresh planning and fresh decision to enter CAP.

## 5. Minimum trusted retained state

Recommended shape, illustrative only:

```ts
// Owned only by one setup closure. No persistence or model-facing getter.
type PublishedAttempt = Readonly<{
  generation: Generation                 // reference identity, not serialized ID
  location: Readonly<Location>           // copied activation location
  baseline: GitSnapshot                  // frozen root/head/initial paths
  initialObservationCompletedAt: number  // trusted ordering evidence
  rootCreatedAt: number                  // from this root's trusted Created event
  bound: Bound                          // deeply immutable native evidence
  candidate: IntentCandidate            // existing frozen encoding/digest
  publication: Readonly<SessionInboxSynthetic> // complete checked host admission
}>
```

No separate activation UUID is needed: generation object reference plus single activation-owned attempt identity suffices. The root session ID is already `bound.parentID`; the Created event ID would be diagnostic only and need not be retained. The initial timing record is retained for authorization eligibility, not a model-supplied timestamp or a bearer token. The plugin derives eligibility from this private evidence and `baseline.paths`, rather than storing a transferable approved/clean flag.

**Retain/refactor `Bound` safely.** Deep-freeze copied nested Call/Child records; its history strings are already immutable primitives. The current parsed records are useful indexes for exact result/same-child checks. Keep them rather than reparsing Planner output from current conversation; verify they still correspond to the frozen whole-history encodings. This is small evidence duplication, not a workflow state machine. It avoids new trust in whatever root is open when Authorize runs.

| Value | Retain or derive; significance |
| --- | --- |
| Original root user ID/text, native message/tool/child IDs, exact bootstrap prompts, child input/final IDs/text | Already in `Bound`; retain. Independently reread sessions/history and compare; IDs alone are not authority |
| Complete original root/Planner/slot message arrays | Retain their exact serialized encodings in `Bound`. Include IDs, ordering, content, tool arguments/descriptions/results, timestamps and metadata. Do not retain only summaries/hashes |
| Raw Planner P | Already `bound.plannerChild.text`; no duplicate `rawP` field. Verify exact parent result wrapper and child final again |
| Candidate digest/encoding/proposal/root/HEAD | Already `candidate`; no duplicate digest/root/HEAD field. Recompute integrity and compare candidate construction from retained P when checking retained-object coherence |
| Plan hash | Derive truncated SHA-256(P) for display/metadata; never authority. Retained publication already contains it in payload metadata |
| Human-readable description | Derive `renderPlan(candidate)` and compare with retained publication. No separate mutable presentation string |
| Synthetic ID and full publication facts | Retain copied/frozen complete checked returned item: ID/type/sessionID/time/delivery/payload. No duplicate ID or second post-publication root-history encoding needed for the pending representation |
| `resume:false` | Fixed trusted call-site invariant, not a fact recoverable from server storage. A generic publication abstraction would need to retain its call policy; this single-purpose function can hard-code it |
| Display labels, digest/HEAD prefixes, toast text, gate prose | Diagnostics/presentation only; must never select candidate, establish initial cleanliness, reconstruct grants, or authorize |

`publishPlan` should return the richer `PublishedAttempt`, after strict readback/coherence checks, instead of leaking only candidate/hash/ID. It remains non-authorizing; the plugin decides whether to offer a strip using trusted initial eligibility. Prefer the same retention shape for non-authorizable publication until its presentation is settled, then discard its authority-capable references without installing callbacks.

The plugin needs only one private pending reference, one synchronous decision-owner reference, an irreversible closed/invalidated bit, generation liveness/busy, and the slot remover. These are invocation ownership/lifetime facts, not workflow phases. The grant exists only as a local variable in the claimed positive continuation. No server/session record, durable attempt storage, Workflow phase enum, service, global registry, or recovery state is needed.

Cancel/STOP clears pending/owner references, closes the attempt, and removes callbacks. Cleanup first revokes generation, closes any attempt, clears retained state, then disposes slot/subscriptions. A running promise may still hold its immutable evidence in memory; guards render it unusable after revocation. This means revocation/discard, not secure memory erasure. No replacement activation can restore authority from publication or the switched child.

## 6. Exact post-publication verification

Let `H0`, `HP`, `HS` be the complete serialized server histories validated before publication. Let `S` be the checked returned synthetic inbox item. The smallest supported **pending-publication** rule is:

```text
server root message.list == H0 exactly
server root inbox.list   == [S] exactly
root inactive, same successful Orchestrator identity/outcome/location
Planner message.list    == HP exactly, Planner inactive/inbox empty
slot message.list       == HS exactly, exact inert slot inactive/inbox empty
TUI root materialized messages == H0 followed by materialize(S)
candidate intact and coherent with retained exact Planner P/root/HEAD
```

Use the root session query identity and the whole pending object's sessionID, ID, type, payload, delivery and admission time. Recompute description and exact `{source:"planner",planHash}` metadata from private P/candidate; reject omitted/substituted metadata or extra payload fields rather than accepting “similar Plan” text. Require `S.delivery === "steer"`, the fixed publication policy. Check no duplicate synthetic ID in projected history and no additional pending item of any type. The full initial histories remain strict; do not make `parentCalls` accept synthetic or filter arbitrary messages out of its input.

Exact pending/presentation equality means identical allowed keys, scalar values, metadata contents and array order, using a fixed explicit encoding for comparison; it must not depend on incidental JavaScript object property insertion order across the admission, inbox reread and TUI materialization. Raw P is compared as the untouched string, including JSON whitespace. The existing complete native-history encodings continue to use the same server list representation on both reads. This is precise representation binding, not semantic proposal matching.

The root exception is **one exact known pending item**, not a general “ignore extra messages” rule or an assumption that inbox is empty. Child inboxes remain empty. Split the activity check from the inbox expectation so ordinary `idle` stays strict for unpublished sessions/children.

Server readback is the binding evidence. The TUI check is an additional presentation/liveness condition, not an authority source. Before enabling buttons, require the selected root's `context.data` to contain exactly the materialized S with full description/P/metadata and the original history; hydrate/invalidate/sync as needed and await its reactive availability before mounting enabled controls. Do not treat the HTTP return or a publication toast as proof that the user has access to the Plan. The Plan can be offscreen within the normal scrollable conversation; every line must be available, without clipping/truncation. The API supplies no paint/read acknowledgment, and the design does not claim the human actually read it. Source proves the materialization/render path; later dogfood must prove readability and scrolling. A tiny/unusable viewport removes Authorize and terminates the pending decision; the modal `candidateFits` is not the scrollable-Plan sizing policy.

**Reject a delivered S even if its content is exact.** Promotion changes both stores and indicates root execution/admission that this one-idle-root milestone never requested. A `synthetic` suffix in server history, missing pending S, changed time/delivery, new user/assistant/tool/control message, altered original byte/string representation, extra inbox item, session/role/permissions change, missing/replaced child, or unexpected root wake invalidates the attempt. There is no need to support a second `H0 + delivered S` form. `resume:false` prevents this call's wake, but it is not a continuing session lock.

Install invalidation observers before synthetic admission. While the admission call is pending, treat only the exact expected synthetic-enqueue payload as provisionally expected; the returned ID/full readback must subsequently match that observed event. Do not show buttons during this interval. Any competing enqueue, execution, or mutation wins STOP; never reset an invalidation flag after the promise returns. This closes the current gap where the plugin starts diagnosing wakes only after its `.then` retention.

After publication, remove the strip synchronously **when an invalidating event is received**, especially root `session.execution.started`, any unexpected enqueue/delivery/cancel/delivery-change, root/Planner message mutation/turn, role/location/permission change, deletion/fork/revert/compaction, or slot work before trusted dispatch. Also react to local route/location/visibility loss. API snapshots catch mismatches not yet delivered to the TUI. Event delivery is asynchronous, so “immediately” means on local receipt, not an upstream guarantee that a server wake cannot precede removal. Never authorize using the event cache alone.

## 7. Local Authorize / Cancel ownership and lifecycle

Register one `append:"session.composer.top"` claim for the pending attempt. Its render function closes over **that immutable object**, and its reactive view gates on current input.sessionID, `ui.router.current()`, activation directory, live generation, private pending-reference identity, readable layout, and exact local Plan projection. Do not destructure the reactive slot input into a permanent session ID. An identity comparison protects stale event closures even after the claim disappears.

The compact strip can show `Plan <hash> · HEAD <prefix> · Implementation only · Authorize · Cancel`, with the current worktree location available/visible as a bound meaningful limit. It must not duplicate the full Plan. Existing `renderPlan` already shows intent, full plan, exact files, bound HEAD, and “No implementation has been authorized.” If the root view's location is not clear, include a compact trusted root path in the strip; do not silently omit the candidate's canonical worktree bound. Hash prefixes label the view but are never equality tests for authority.

Both direct pointer and focused-key handlers call a small synchronous `decide(capturedAttempt, decision)` closure:

1. Check live generation, pending identity, correct selected root/location, mounted/usable view and not closed/busy.
2. **Before any await**, atomically claim the pending object, clear its pending reference, mark the decision owner, and remove both buttons. JavaScript run-to-completion supplies serialization within this process.
3. For Cancel, irreversibly close/discard and show a local negative result. No grant, switch, or prompt.
4. For Authorize, record the literal local positive decision bound to this object and start `void authorizePublishedAttempt(...).then(success, stop)` with a final cleanup handler. Catch synchronous handler errors as STOP too. No unhandled rejection or callback exception may leave an actionable strip.

Double-clicks, key repeats, and a queued Cancel after Authorize are inert because the pending reference is already gone. If Cancel wins first, Authorize is inert. There is no later substitution of a new candidate into a captured handler. Positive selection claims a single attempt; it is not yet a grant and can fail all subsequent checks. The decision cannot be changed/retried once claimed.

The UI does not await async event callbacks (`processMouseEvent` calls them synchronously); async work is safe when explicitly detached and guarded after every await. Keep Solid effects/hooks inside component setup and capture ordinary trusted objects/context for the detached continuation; do not rely on the component owner remaining mounted to authorize.

Recommended navigation policy: while buttons are pending, leaving the exact root/location, unmounting/hiding the decision surface, or losing usable layout closes it as STOP. Returning to the root shows no resurrected buttons. Register the claim only when the correct root/presentation is ready; unrelated session mounts must not invalidate an attempt merely by failing its session filter. On a genuine bound-view cleanup, invalidate only if still pending, so intentional claim removal for Authorize does not cancel its own deciding continuation. During pre-admission async work, route/location loss also invalidates the decision owner. Once the prompt is spent/admitted, child navigation may be allowed for inspection; generation/liveness/binding and final Git gate still apply. There is no implicit approval from disappearance, focus, dismissal, render fallback, exception, or cleanup.

## 8. Ordered freshness, grant and implementation admission

Recommended sequence, including publication. Every awaited host call uses a guarded continuation, not just the old generation-only `after` helper.

1. **Activation:** synchronously observe canonical root/HEAD/initial paths; freeze location and observation-completion evidence. Adopt only the exact fresh Orchestrator with proven post-observation creation. Derive permanent initial eligibility from the initial snapshot.
2. **Root completion:** synchronously reserve the one attempt. Await `session.wait`; recheck generation/attempt/location, then bind exact root/Planner/slot identities, outcomes, histories and empty inboxes. Require original root/HEAD and publication path-set stability. Eligible attempts also require continued cleanliness.
3. **Freeze:** parse exact raw P, make existing immutable candidate; check retained-object coherence. Rebind native evidence/idle before publishing; install invalidation observations before admission.
4. **Publish once:** call exact synthetic P/description/metadata with `resume:false`. After await, verify full returned item, generation/invalidations/location; independently read root H0, inbox `[S]`, inactive state and unchanged child evidence. Recheck Git after those awaits. Never redispatch publication on ambiguity in this milestone.
5. **Offer decision:** only for initial-clean eligibility plus fresh clean snapshot, intact candidate/evidence, selected root and exact locally materialized Plan. Mount compact local controls. Dirty publication terminates its authority-capable retention without offering Authorize.
6. **Positive local event:** atomically claim exact pending attempt before any await. Remove buttons; guard owner identity, generation and invalidation bit. This is a decision for C, never a caller-provided digest lookup.
7. **Reverify before grant:** read complete original parent/Planner/slot histories and identity/outcome/permissions; require the exact published root pair `(H0,[S])`; require root/children inactive and no unexpected inbox. Require slot still `implementer_slot`. After these awaits, synchronously recheck location/canonical root/original HEAD/cleanliness, candidate/coherence and owner liveness. Then call `grantIntent(C, true, generation)` once.
8. **Switch exact retained child:** guard and await `session.switchAgent({sessionID:bound.slot.childID,agent:"authorized_implementer"})`. This creates capability only; it neither consumes the grant nor admits model work.
9. **Post-switch binding:** after the switch await, check guards/Git and read exact child identity/permissions/inactivity/empty inbox. Require original HS plus exactly one `agent-switched` record with `previous:"implementer_slot"`, `agent:"authorized_implementer"` and no subsequent input. Capture that exact switch record for later equality, including its ID/time/metadata. Reverify parent `(H0,[S])` and unchanged HP. Recheck slot after those parent/Planner awaits.
10. **Final admission barrier:** reread relevant sessions/histories/activity/inboxes and local Plan availability under the invalidation guard; validate the same parent/Planner and exact switched-slot evidence again. Perform fresh synchronous activation-location/canonical-root/HEAD/cleanliness observation after the final awaited read; recheck candidate, owner, generation and unused grant. Prepare exact `implementerPrompt(C)` before this barrier so no extra awaited presentation work intervenes.
11. **Spend and dispatch:** `consumeIntent(grant,C,generation)` immediately followed, without an await or UI call between them, by one `session.prompt` to the exact child with the exact frozen text and no attachments/agent override. This is the precise CAP admission/spent boundary. No grant survives a failed call.
12. **Returned input:** after prompt await, check generation/attempt; bind nonempty returned ID, exact child/type/text, delivery policy and empty attachments. Failure/ambiguity stops without replay even if admission already happened. Cleanliness is no longer required: admitted implementation may already be editing. Continue to preserve baseline root/HEAD and parent/Planner/publication immutability.
13. **Completion:** await child `session.wait`; then independently bind exact authorized result: same child/parent/role/location, zero permission overrides, inactive/empty inbox, exact HS and retained switch prefix, exactly one returned trusted user input, only expected authorized assistant turn and one successful idle. Recheck root/Planner/publication immutability after implementation as well; an unexpected root wake cannot produce a passing governed result.
14. **Gate and STOP:** after final result/binding awaits, synchronously observe Git at the current activation directory; require canonical root and unchanged HEAD, then `requireInScope` exact path membership. Guard generation before reporting. Return successful gate result and end before Review/Commit.

### Await obligations and the limit of snapshots

| Await | Required checks when it returns; evidence that must be refreshed before the next effect |
| --- | --- |
| Every read, every pagination page, `wait`, UI hydration | `assertLive`, exact decision/publication owner, irreversible invalidation, current activation directory, candidate integrity. While pre-admission, repeat synchronous Git root/HEAD/cleanliness checks; publication-only dirty attempts use baseline path-set stability instead. Validate each returned page/record and reject repeated cursors/duplicate IDs |
| Pre-grant full binding | Compare all frozen histories/identities and precise pending S; read inactivity/inboxes, then fresh Git/owner checks before grant. A pre-click snapshot is insufficient |
| Switch | Guards plus fresh Git, then reread slot agent/control history/no input. Parent/Planner checks performed before switch are insufficient |
| Parent/Planner verification after switch | Guards/Git; recheck switched slot afterward because it could change during those awaits |
| Slot re-verification / final barrier | Guards/Git; invalidate on any intervening root/Planner/slot mutation; final fresh read batch must cover parent, Planner, slot and activity/inboxes, not just the slot. Final synchronous checks precede consumption/prompt without another await |
| Prompt response | Guards, exact returned admission; rebind root/Planner/publication after the dispatch. Do not require a still-clean worktree or interpret prompt rejection as proof of non-admission |
| Implementation wait/result reads | Guards, current location/root/HEAD and exact trusted-input/result binding. Scope observation comes after all these awaits, not before them |
| Toast/alert presentation | It cannot enable admission; failure in presentation closes/discards. Do not await an alert in the admission gap |

Keep a monotone attempt invalidation latch across all reads. Watch expected switch/implementation events specifically so trusted work is not mistaken for interference: before prompt, no slot input is allowed; after the trusted prompt is invoked, only its exact input/result pattern is eligible. The full post-result binder still rejects extra inputs, including background synthetic completions. Exemption is by exact operation/evidence, not by broadly suppressing all events while busy.

Multiple RPC reads are not an atomic snapshot, and 2.0.20 offers no compare-and-prompt transaction or multi-session read lease. An async verification pass itself contains awaits; a final read batch plus local invalidation checks and synchronous Git checks is the smallest honest freshness barrier, not proof that every remote record is locked until prompt. On delivered changes or mismatched reads, STOP; never loop until state appears clean. Relevant native model routes remain read-only/denied while the root is idle. Concurrent direct trusted-local client actions are outside the governed admission and can make this attempt fail; the design does not promise adversarial serialization against the trusted host/user or shell containment. These are the existing CAP/local-host limits, not permission to reuse an old snapshot after a known intervening change. A requirement for atomic prevention of every concurrent server action would need a new host primitive; it is not CAP's current observation contract.

## 9. Shared code structure and exact same-slot boundary

Recommended ownership stays in `src/attempt.ts` and the TUI entry:

- Retain `Bound`, rename `bind` to `bindNativeAttempt` for clarity if useful; keep its unpublished shape/parser strict. Add a publication-aware parent verifier that compares **H0 plus exact pending S across the two stores**, then uses unchanged `parentCalls(H0)`, `verifyChildHistory`, `resultMatches`, `successful`, and complete-history comparisons.
- Make `publishPlan` return the immutable richer object after checked admission/readback. It owns native evidence/publication, not a UI pending resolver or grant.
- Add `verifyPublishedAttempt` and a parent/Planner verification form reusable before and after switching. Share child/session/history validation; do not copy the old binder into a second implementation path or add an `ignoreExtras` flag.
- Add `authorizePublishedAttempt(context, published, guardedDecisionOwner)` as the live bridge. Its argument is created/claimed only by the local closure; it verifies eligibility, publication and positive binding, then invokes the shared implementation executor.
- Factor the grant→switch→verify→consume→prompt→wait→bind→Git-gate tail into one `executeBoundImplementation` within `attempt.ts`. It uses the concrete published-parent verification contract. Keep expected switch identity as an immutable run-local result so later result binding cannot accept a replaced switch marker. No abstract service or configurable executor callbacks are needed.
- **Remove `runImplementationAttempt` as a separate modal production/reference path after migrating its useful tests to the shared tail/new live bridge.** It has no production caller. Its invariants deserve coverage, not a permanent second authorization path. During incremental development it may be a thin transitional wrapper using the same extracted executor; the milestone's finished code should delete that wrapper and its modal-only `candidateFits` use/export/tests. Do not delete the proven switch/result/Git checks along with it. `candidateMessage` can remain an existing formatter unless cleanup is concretely needed; its deletion is not required here.
- `src/cap.ts:assertLive/grantIntent/consumeIntent`, `src/git.ts:observeGit/requireFresh/requireInScope`, `src/proposal.ts:parseProposal/makeCandidate/candidateIntact/renderPlan` and `implementerPrompt`, fixed bootstrap prompts, native result/child validators remain reusable. Add owner/location checks around awaits; the existing `after` checks only generation and needs stronger attempt guarding. Strengthen switched-result comparison to retain the actual switch record; current `switchedSlot` only checks its count/roles and bootstrap prefix.

The implementation context remains exactly the previously bound slot's READY bootstrap plus its switch marker and direct trusted frozen implementation prompt. No Planner conversation is copied, no parent is resumed, no replacement child is created, and no proposal-fetch MCP/getter is introduced. Host `subagent` fresh creation supplies only its fixed prefix and requested prompt (`../opencode/packages/core/src/tool/plugin/subagent.ts` 184–213); the later direct prompt stays in that child. Parent's original row remains the bootstrap result, not a newly rewritten implementation result.

The role boundary still matters: native target permission is asserted before child lookup/continuation; allowed continuation to `implementer_slot` switches back before prompting (`subagent.ts` 134–181, 205–213). Agent selection merges current role rules then session rules (`../opencode/packages/core/src/session/context.ts:select` 121–142). Existing zero-session-overrides checks and deny-all role configurations must remain. Durable editing role capability is not a reusable CAP grant; persistent capability and manual outside-CAP prompts are already distinguished by CAP. No unlock/relock permissions window or post-prompt role restoration is proposed.

## 10. Cancel, failures, revocation and terminal UX

Cancel is a first-class local negative result: atomically close/discard the exact pending attempt, remove its strip, clear authority-capable retained references, and report `Cancelled — no implementation admitted`. It creates no grant, calls no switch and sends no prompt. Leave the published Plan and its pending inbox item intact. Canceling the host inbox item would remove its materialized Plan presentation (`../opencode/packages/client/src/solid/data.ts:retractLocal` 403–419), contrary to the desired intact conversation. The leftover pending Plan is non-authorizing; a later manual root turn can deliver it, outside this completed milestone. No later activation may adopt it as authority.

| Condition | Terminal behavior |
| --- | --- |
| Stale root/HEAD/worktree, unreadable view, transcript/publication mutation, root wake, missing/replaced slot | Close/invalidate, remove controls, discard any unused grant and decision, report STOP. No amended scope or later “clean again” resumption |
| Cancel/failure/cleanup before switch | No grant or prompt; no model mutation admitted by this integration |
| Switch succeeded but later verification/freshness fails | Discard unused grant and STOP without prompt. Slot may retain authorized role capability; no approval inferred from it. Do not restore role or create a replacement child |
| Switch response ambiguous | It may have switched. STOP without prompt or second switch; no recovery |
| Prompt response ambiguous, rejected, malformed or missing | Grant already consumed. Input may have been admitted; STOP, never resend, never use another ID/child, never grant again |
| Plugin cleanup/revocation | Synchronously revoke first; clear private state and remove strip/subscriptions. After each await, old continuations fail liveness. Already admitted server work can continue; no passing result can be reported by revoked generation |
| Callback/render/presentation error | Close/discard, no affirmative fallback. Catch callback errors locally; component cleanup invalidates pending view even if host error boundary only shows a toast |
| Implementation failed/extra input/out-of-scope delta/changed HEAD | No passing gate. Report STOP with reason; leave ordinary repository reality intact. No rollback, review, commit, retry or recovery |

V1 terminal presentation can be a session-associated local toast (success/cancel) or a local STOP alert plus permanent removal of decision controls. A compact inert terminal line can replace the strip if visibility needs it; it contains no affirmative action and is generation-local diagnostic UX. The passing text must say unchanged HEAD, resulting exact paths, and that the gate stops before Review/Commit. An ambiguous prompt failure should say implementation may have started. No new synthetic root result message is necessary; that would introduce another pending-input projection to bind and is subordinate work. Presentation cannot restore a grant or decide the gate. Toast APIs already support session routing (`../opencode/packages/tui/src/plugin/api.tsx:toastApi` 98–120).

## 11. Future test architecture

No tests are implemented or executed for this report. The checkpoint's documented/current baseline is 45 tests; keep authorization tests at the cheapest proving layer per `AGENTS.md`.

**Pure/unit:** retained-object immutability/coherence (nested Call/Child, candidate and publication); initial eligibility requires originally empty paths and proven ordering, dirty→clean never qualifies; exact pending-item materialization/equality; candidate/digest-purpose/single consumption; synchronous Authorize/Cancel ownership and duplicate/stale callbacks. Exercise actual validation behavior rather than tests mirroring private fields.

**Test-scoped trusted host/observer doubles:** extend `test/attempt.test.ts`'s local fake and `SnapshotObserver`/module interception (1–186), not production DI hooks. Model real 2.0.20 semantics: synthetic initially enters pending inbox and TUI cache, server history remains H0; promotion moves the item to server history with the same ID and new delivery time. Separate server lists from TUI materialization. Existing publication doubles return incomplete synthetic fields/empty inbox (145–177); correcting those is necessary for the new verifier, not evidence that current host is different.

Cover the full local bridge: correct root-only slot registration, once/untracked render with reactive input, claim removal/update, lost view, min-size/focus gates, immediate callback claim before awaits, double-click/repeat/simultaneous Cancel, stale closure after cleanup, observed root wake during publication and decision, async error handling, buffered pre-activation Created event, and no recovered authority after reload. Capture slot claims/local handlers directly in a small local double; do not spin up a renderer for CAP sequencing tests.

Inject transcript/session/inbox/Git/location drift at each meaningful await, including pagination, after switch, during parent/Planner verification, during final barrier, after prompt, and during result binding. Assert exact same child, one switch, exactly one frozen prompt or none, permanent no-redispatch, exact returned-input binding, retained switch identity, and no gate on revocation/extra input/scope failure. Include falsified hashes/metadata and a visually identical Plan with the wrong ID/session. These cases use doubled Git observations and ordinary temporary directories needed for path/canonicalization; they do not require `.git` repositories.

**Real Git:** preserve the existing explicit Git boundary cases in `test/git.test.ts` (ordinary staged/unstaged/untracked, ignored exclusion, rename endpoints/deletion, exact paths/canonical root, changed HEAD). Preserve the small existing `attempt.test.ts` production-boundary happy path and scope/HEAD failure coverage by moving it to the new executor, using the existing immutable seed/private-copy pattern. The new UI path adds no Git semantics requiring another matrix of real repositories. Cancellation, grants, callbacks, transcript permutations, revocation and dirty-eligibility sequencing stay doubled. Measure fixture/process/observation growth against the current fast suite; never cache/weaken production freshness to keep tests fast.

**Later live dogfood remains required:** one explicitly authorized OpenCode 2.0.20 dogfood after implementation must demonstrate actual readable/scrollable root Plan, compact composer-top pointer and focused-key callbacks, resize/focus/navigation disposal, Cancel with no switch/prompt, and one same-slot implementation reaching unchanged-HEAD/exact-scope gate then STOP. Existing dogfood is historical proof of components, not this bridge. Use ordinary local sessions; no Docker, hidden integration harness, automatic launcher or new performance machinery. This report did not conduct it.

## 12. Projected target files and packaging

| Future path | Reason |
| --- | --- |
| `src/attempt.ts` | Immutable retained binding/publication, exact pending-aware verification, eligibility guards, shared implementation tail; remove independent modal attempt path |
| `.opencode/plugins/opencode-agents/tui.ts` → `tui.tsx` | Small Solid strip, local decision ownership, reactive root/view gates, publication invalidation and cleanup. Rename only if using JSX; keeping a separate UI module is unnecessary for this small ownership boundary |
| `test/attempt.test.ts` | Faithful pending-versus-history doubles; bridge/callback/await-invalidation tests; migrate retained executor tests rather than duplicate the old path |
| `package.json`, `bun.lock`, `tsconfig.json`; possibly a minimal test preload configuration | UI peers/types and `.tsx` typecheck/test setup, if adopting the recommended JSX entry |
| `docs/v1-orchestration.md` | Replace future-status description with actual publication→local decision→same-slot sequence and initial-eligibility/terminal behavior after implementation |
| `docs/README.md` | Update its current implementation status (currently explicitly disconnected); no larger documentation rewrite |

No planned changes to agents, `src/git.ts`, `src/cap.ts`, `src/proposal.ts` or `test/git.test.ts` are required for this bridge. CAP needs no normative weakening or edit: its clean-initial-baseline and direct-local-decision requirements already cover the design. An explanatory clarification is optional only if implementation exposes a genuine ambiguity; this investigation does not require one. Existing role tests can remain.

Packaging is supported by current host, not an upstream gap. `../opencode/packages/tui/src/plugin/context.tsx` 24 imports `#runtime-plugin-support`; `plugin/runtime-plugin-support.bun.ts` 1–8 configures shared OpenTUI/Solid and plugin runtime modules. The host's installed `@opentui/solid/scripts/runtime-plugin-support-configure.js` provides Solid JSX transformation and runtime rewrites, preventing a plugin's separate runtime from becoming the UI owner. `../opencode/packages/tui/bunfig.toml` preloads `@opentui/solid/preload`; its `tsconfig.json` uses `jsx:"preserve"`/`jsxImportSource:"@opentui/solid"`.

Project optional peers are currently absent. A future JSX implementation should pin host-compatible `@opentui/core`/`@opentui/solid` 0.5.12 and `solid-js` 1.9.15 (the inspected host installation) for types/local tests; add `.tsx` includes and matching JSX options. Do not install/upgrade them in this investigation. Standalone Bun test import of `tui.tsx` needs the minimal OpenTUI transform preload (or a test-scoped UI-module substitute for logic tests); host runtime support does not automatically configure this project's test process. Keep UI focus/layout proof in the one live dogfood rather than expanding this into a renderer harness. No OpenCode dependency upgrade or upstream change is required.

## 13. Implementation order and concrete proposed architecture

1. Retain immutable native `Bound` and full checked synthetic admission; capture trusted initial clean/creation ordering facts at activation. Preserve dirty publication as permanently non-authorizable.
2. Introduce the exact `(H0,[S])` publication verifier, coherent TUI materialization gate, and irreversible invalidation guards. Keep unpublished parsing strict.
3. Extract one shared same-slot implementation tail, retaining switch/input/result/Git checks and tightening retained switch identity. Migrate the old path tests; remove the independent modal `runImplementationAttempt` path when migration is complete.
4. Add the compact Solid claim and unregistered local pointer/focused-key Authorize/Cancel callbacks, with atomic private ownership, session/location/view guards and synchronous cleanup revocation. Finish packaging/typecheck setup only as needed.
5. Connect the exact claimed positive decision through fresh verification, grant, exact role switch, final barrier, one-use consumption and one prompt. Add negative/ambiguous await cases using host/observer doubles; preserve the real-Git boundary subset and suite cost.
6. Add minimal local terminal presentation, update status/orchestration docs, run existing checks and the explicitly authorized focused live dogfood, then stop at the Git gate. No further role or effect is included.

The finished architecture is **one immutable activation-private published binding, one compact root-only local decision, one pending-item verifier, and one same-slot executor**. The exact initial-clean attempt and exact published P/C/S remain bound across the decision; nothing is looked up as authority from the conversation. Grant creation follows positive local selection and fresh evidence; spending occurs immediately before the sole exact implementation prompt. All negative or ambiguous outcomes irreversibly end the attempt.

Explicit non-goals: Reviewer; reviewed-target construction; Commit authorization/execution; multi-turn root routing; casual Planner bypass; retries/recovery; persistent workflow state/storage/service/phase enum; remote/web authorization; Form/Question authorization; upstream changes; automatic OpenCode launch; Docker; Planner/Implementer redesign; unrelated performance work. One fresh root and one attempt per activation remain acceptable.

## 14. Investigation verification

Only this report is intended to be new. Final checks are `git status --short`, `git diff --check`, and `git diff --name-status`. As an untracked new report, ordinary `git diff --name-status` is empty; `git status --short` identifies it. No files are staged, committed or pushed, and no runtime/test/package/agent/normative-doc change is part of this task.

Observed verification: `git diff --check` passed with no output; `git diff --name-status` produced no output. Checking the untracked report with `git diff --no-index --check /dev/null docs/published-plan-authorization-investigation.md` produced no whitespace diagnostics (no-index status 1 indicates content differs from the empty file). An independent trailing-whitespace/final-newline check also passed. Final short status:

```text
?? docs/published-plan-authorization-investigation.md
```

PUBLISHED-PLAN AUTHORIZATION: SUPPORTED — OpenCode 2.0.20 supplies local composer callbacks, exact pending synthetic rebinding and same-child switch/prompt; clean-initial eligibility preserves CAP without upstream changes.
