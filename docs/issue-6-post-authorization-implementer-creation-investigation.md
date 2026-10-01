# Issue #6: post-authorization Implementer creation investigation

Investigation/design only, 2026-10-01. No OpenCode execution or live verification was performed. **Verified** below means inspected implementation source or read-only repository/GitHub evidence; **Recommendation/inference** means a proposed architecture, not implemented behavior.

## 1. Executive finding

**Recommend no implementation child before authorization and direct creation in the `authorized_implementer` role afterward. Remove `implementer_slot` and the CAP path's `switchAgent` step.** Pre-binding a worker is not necessary to authorize an immutable candidate. Freeze the new worker's identity as execution evidence after the positive decision, before dispatch.

There is an important qualification to “supported in OpenCode 2.0.21”:

| Boundary | Verified finding |
| --- | --- |
| Core `Session.Service.create` | Supports an empty child with exact `parentID`, explicit agent/model, inherited location/metadata/permissions. Creation does not execute a model. |
| TUI client `session.create` | **Cannot create a parented child.** Its protocol and handler omit `parentID`; adding an extra property or casting the types does not repair this. |
| Server plugin context `ctx.session.create` | Also omits parent forwarding. It is not a supported escape from the public API limitation. |
| TUI client `session.import` | A supported, experimental **equivalent for this local topology**: a fresh identity plus `messages: []` creates a parented, empty session directly with the specified agent/model. It returns session identity and does not prompt, wake execution, copy history, or start a subagent job. |

**Recommended pinned-host mechanism:** one `context.client.session.import` call with a locally minted fresh session ID, exact root parent, explicit frozen root model, exact local location, zero usage, no terminal outcome, no idle/archive/revert/fork state, and **an empty transcript**. This is direct creation as the authorized role through an existing session-transfer endpoint, not a root tool call. The endpoint name and experimental status must be documented honestly. Do not pass root/Planner messages to it.

The source establishes feasibility for ordinary local sessions with no `workspaceID`. The public location schema excludes `workspaceID`; reject a nonlocal/workspace-bound attempt **before** creation rather than silently losing location identity. Import's `time.created` is supplied by the trusted caller, unlike core create's host timestamp. Keep that distinction explicit in creation evidence; it does not authorize anything. See sections 4 and 12.

The only architecture fallback evaluated is post-authorization inert child creation followed by switching that same child. It does not fix the public parenting limitation and buys no necessary CAP property under the accepted threat model. Direct role creation removes an additional mutation, transcript record, await, and event correlation.

## 2. Verified baseline and current architecture

Read-only checks at investigation start found:

- Local branch `main`, HEAD `244f31af1e3fb05ac57f995dbbd597959b38fb6f`; worktree initially clean.
- [package.json](../package.json) pins `@opencode/plugin` to `2.0.21`; [bun.lock](../bun.lock) also resolves `@opencode/client` to `2.0.21`. The installed client's declarations expose `session.import`.
- [Issue #6](https://github.com/mikechao/opencode-agents/issues/6) is OPEN, titled `[Feat]: Defer Implementer Creation Until Authorization`, updated `2026-10-01T19:28:39Z`. Its current body requires no preauthorization implementation child, prefers direct authorized-role creation, and treats candidate/scope as the subject of authorization. No issue was edited or commented on.
- [Issue #5](https://github.com/mikechao/opencode-agents/issues/5) is CLOSED.
- Authoritative sibling `../opencode` is HEAD `8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`; root and plugin package versions are `2.0.21`. It was inspected only.

### Why the slot exists today

[orchestrator.md](../.opencode/agents/orchestrator.md) requires exactly two fresh, sequential, foreground native `subagent` calls: Planner, then the slot. Both must have only `agent`, `description`, and `prompt`. The slot receives `SLOT_PROMPT`, runs a real model turn, returns exactly `READY`, and remains a read-only session. The root then emits a nonempty final and becomes idle.

[src/attempt.ts](../src/attempt.ts), `parentCalls`, `bindNativeAttempt`, and `verifyChildHistory`, bind all of:

- One exact first plain root user message, exact request, one successful idle root turn, root agent/location/creation identity, and no session permission overrides, fork, revert, or archive.
- Exactly two completed native calls; distinct tool/message/child identities; exact inputs and native result wrappers independently matched to child output.
- Planner's exact parent, role, location, creation time, successful idle state, empty inbox, complete paginated transcript, one exact prefixed input and final proposal. Only completed read/glob/grep tools are permitted.
- Slot's exact parent, role, location, creation time, successful idle state, empty inbox, complete transcript, one exact prefixed bootstrap input, no tools, and final `READY`.
- Full root/Planner/slot histories `H0/HP/HS`, call/result indexes, and creation times retained in frozen `Bound`.
- Activation generation/location/Git baseline/root Created evidence; immutable candidate digest/root/HEAD/proposal; exact synthetic publication admission, including ID, time, raw Planner text, rendered description, metadata and delivery.

`PublishedAttempt` contains activation, `Bound` (including the slot), candidate, and publication. `assertPublishedCoherence` proves their internal agreement. `verifyPublishedAttempt` requires unchanged root/Planner/publication and the same inert slot. `verifyParentPlanner` still parses both root calls and checks both native wrappers despite its name.

After a synchronous TUI claim, `authorizePublishedAttempt` revalidates publication and clean Git. `executeBoundImplementation` grants candidate authority, sets `owner.switching`, calls `session.switchAgent` on the retained slot, records `owner.switchRecord`, and uses `switchedSlot` to require exactly `HS + one agent-switched record + no new input`. Repeated full barriers precede adjacent grant consumption and one prompt. Afterward `switchedSlot` binds the exact implementation suffix and result across further awaits; Git checks root/HEAD/exact path membership.

### What pre-binding protects today

**Verified current protections:** it prevents substitution of a different already-existing child, reuse/continuation, altered bootstrap input/result, pre-decision role switching, unexpected child tools or input, changed creation identity/permissions/location, and prompt dispatch to an unverified worker. It preserves a native clickable root tool row. Creation/model inheritance happened through native host code before the human decision, so CAP did not need a callable trusted child-creation API.

**Architecture inference:** these are principally provenance, freshness, and exact-target properties. Their essential parts survive through trusted post-decision creation and independent verification of an empty session. The `READY` turn and pre-decision worker identity are not themselves authority. The row is a presentation consequence, not a security prerequisite. The earlier investigation recorded the same public parenting gap in [the native Implementer investigation](history/milestone-2-cap-gated-native-implementer-investigation.md), “Smallest host changes”; it must not be mistaken for a currently available `session.create` argument.

## 3. Authorization semantics

**Verified:** `grantIntent` in [src/cap.ts](../src/cap.ts) binds `candidate.digest`, purpose `implement`, and one-use consumption; it contains no child ID. The implementation prompt is a deterministic rendering of the candidate. The trusted UI displays Plan/HEAD binding, not a request to approve a particular session ID. Today's `PublishedAttempt` structurally bundles worker evidence, but that is not what the grant authorizes.

**Recommendation:** human authorization admits one implementation operation for the exact immutable candidate/scope. After claiming the exact object, trusted code may create and freeze the worker identity as separate local execution evidence. The grant remains candidate-bound; the guarded caller binds its sole use to that one verified child and exact prompt. Child ID, metadata, title, timestamps, events, or native rows cannot create or restore CAP authority.

No replacement child is admissible after failed or ambiguous creation. A claim is irreversible for this attempt even if the grant has not yet been consumed. Do not turn an unused grant into retry permission.

## 4. OpenCode 2.0.21 child-creation trace

The following links refer to the inspected sibling checkout, not an online version or TypeScript declarations used in place of implementation.

### Creation, parenting, empty state, and execution

- [packages/core/src/session.ts](../../opencode/packages/core/src/session.ts), `CreateInput` (lines 80–91), `Session.create` (250–307): core input is either `location` or existing `parentID`. It reads the parent from the store, fails on a missing parent, takes `parent.location`, resolves project/subpath, publishes `SessionEvent.Created`, and returns the projected session. Explicit `agent` and `model` are recorded. Metadata and permissions default to the parent's. It never calls `prompt`, `execution.wake`, or a model runner.
- Core create returns an existing session for an already-recorded caller ID, including a concurrent projection collision. Therefore a future core-create implementation would still need a fresh expected ID and independent empty-state/identity verification; “create returned something” is insufficient.
- [packages/core/src/session/projector.ts](../../opencode/packages/core/src/session/projector.ts), Created projector (439–465): inserts session identity/parent/agent/model/location/metadata/permissions with event-created timestamps. It inserts no input or assistant message. [session/message-updater.ts](../../opencode/packages/core/src/session/message-updater.ts), `update`, maps `session.created` to no transcript operation.
- [packages/core/src/session/session.ts](../../opencode/packages/core/src/session/session.ts), `prompt` (151–178): prepares/adopts one inbox input and calls `execution.wake` unless `resume:false`. Creation and prompting are separate. An empty never-run child has **no outcome or `time.idle`**; the current `successful()` helper is inappropriate for pre-dispatch verification.

### The public create gap is real

[packages/protocol/src/groups/session.ts](../../opencode/packages/protocol/src/groups/session.ts), `makeSessionGroup`, `session.create` (220–239), exposes ID/title/agent/model/location/metadata/permissions, but no parent. [packages/server/src/handlers/session.ts](../../opencode/packages/server/src/handlers/session.ts), `SessionHandler`, create handler (125–140), forwards only those fields and defaults location to server CWD. [packages/client/src/promise/generated/client.ts](../../opencode/packages/client/src/promise/generated/client.ts), `make`, create request (573–590), serializes only that explicit field list. A forced `parentID` property would never reach core creation through this client.

[packages/core/src/plugin/host.ts](../../opencode/packages/core/src/plugin/host.ts), `PluginHost.make`, `session.create` (527–541), also forwards location and omits parent. The TUI [Context](../../opencode/packages/plugin/src/tui/context.ts) exposes a client, not an in-process `Session.Service`. Do not import core into the TUI and instantiate another host/database, or infer that an internal service used by a built-in tool is a supported TUI API.

### Supported equivalent: empty session import

[packages/protocol/src/groups/session.ts](../../opencode/packages/protocol/src/groups/session.ts), `PublicSessionTransfer` and `session.import` (242–256), explicitly support importing a child whose parent already exists. [packages/server/src/handlers/session.ts](../../opencode/packages/server/src/handlers/session.ts), import handler (145 onward), passes `info`, `messages`, and explicit location to `SessionTransfer.import`. The generated client exposes this as **`context.client.session.import`**, although the URL is `/api/experimental/session/import`; it returns unwrapped `SessionInfo`.

[packages/core/src/session/transfer.ts](../../opencode/packages/core/src/session/transfer.ts), `SessionTransfer.import` (73–162), verifies implementation semantics:

1. Reject an already-recorded session ID; unlike core create it does not adopt an existing session.
2. Verify the specified parent exists.
3. Resolve project from the separately supplied location; parenting does **not** automatically inherit location, metadata, model, or permissions here.
4. Publish `SessionEvent.Created` with exact supplied parent/agent/model/metadata/permissions and resolved project/subpath/location.
5. In the publication transaction, insert only supplied settled messages. `messages: []` inserts none. Initialize supplied usage/timestamps and return `sessions.get`.
6. Never prompt, wake execution, start a job, or notify/resume the root.

[packages/core/src/bus.ts](../../opencode/packages/core/src/bus.ts), `commitDurableEvent` and `publish`: projectors and the local commit hook execute transactionally; routing/listener notification follows commit. Thus the import's empty message set and initialized session record precede its successful response/event exposure. This is source evidence, not a live concurrency test.

**Recommendation/inference:** this endpoint is safe as a narrowly constructed empty-session creation equivalent under the local trusted-host model. Supply a fresh ID; `messages: []`; exact root parent; agent `authorized_implementer`; explicit model; exact location; zero cost/token counters; no outcome/idle/viewed/archive/revert/fork; and a trusted caller-created timestamp. Do not accept a transferred artifact or a model-provided `Info`. Build a small local request directly; no generalized import adapter or compatibility machinery is needed.

Import computes actual project/subpath from location, rather than trusting the supplied `projectID`. Independently verify returned and reread project/subpath against the root. Copy the root's trusted metadata explicitly if present to preserve native family policy inheritance; reject session permission overrides and request an explicit empty override list. Do not clone root `SessionInfo` wholesale: that would accidentally carry usage, terminal/fork/revert/archive state.

Import overwrites `time.created` with the supplied value, while `time.updated` is host import time. Its durable Created event has a separate host-created timestamp. Freeze the returned creation identity and compare it on every later child read, but **never describe the supplied timestamp as host attestation** or require equality with `event.created`. The local positive claim, one invocation with a fresh ID, collision rejection, and exact readback/empty-state barriers establish freshness. Event and response identity must agree on fields actually shared. The existing strict root creation-after-Git-observation check stays unchanged.

### Agent and permission selection

[packages/core/src/agent.ts](../../opencode/packages/core/src/agent.ts), `resolve`, `select`, `selectable`: explicit agent resolution/selection does not reject hidden agents; hidden/subagent filtering applies to default selectable roles. [session/context.ts](../../opencode/packages/core/src/session/context.ts), `SessionContext.select`, resolves the explicit session agent and snapshots tools from agent rules plus session overrides. Creation records an agent ID, not a frozen copy of an agent definition. Before creation, verify the location's actual loaded `authorized_implementer` exists and has the intended role/model/permissions contract; after creation/final barrier, require it remains the same trusted definition. The files alone are not readback evidence of loaded host policy.

[packages/core/src/config/plugin/agent.ts](../../opencode/packages/core/src/config/plugin/agent.ts), `Plugin` (84–123), loads configured model/mode/hidden/system and appends configured permissions. [packages/core/src/permission.ts](../../opencode/packages/core/src/permission.ts), `configured`, `evaluateInput` (158–184), evaluates agent rules followed by session rules; a configured deny stops before saved allow rules. Permission hooks and the installed host remain trusted. Empty session overrides retain the expected agent policy; they are not a deny-all role.

For this role, ordinary read/glob/grep/edit/shell capability is permitted; delegation/session-control/execute and other mutation admission routes remain denied. Keep the exact obvious Git commit denials and scope/history instructions. `hidden:true` affects discovery/default selection, not execution authority or session invisibility. The native subagent context hook in [tool/plugin/subagent.ts](../../opencode/packages/core/src/tool/plugin/subagent.ts) excludes hidden agents from its advertised list, but explicit native execution resolves the agent and checks mode/permission independently.

### Deterministic model binding

**Verified:** [tool/plugin/subagent.ts](../../opencode/packages/core/src/tool/plugin/subagent.ts), `Plugin`, native creation model calculation, is `override ?? agent.model ?? parent.model`. Core create itself **does not inherit `parent.model`**, choose the agent's configured model, or resolve a default. Empty import likewise records only the supplied model. [session/runner/model.ts](../../opencode/packages/core/src/session/runner/model.ts), `SessionRunnerModel.resolve`, uses an explicit session model when present and otherwise resolves a host default. Relying on that default would be model guessing.

[packages/tui/src/component/prompt/index.tsx](../../opencode/packages/tui/src/component/prompt/index.tsx), `submit`, captures the local selection and passes `{providerID, id, variant}` when creating the root; for an existing session it commits selection via `switchModel`. [session/info.ts](../../opencode/packages/core/src/session/info.ts), `fromRow`, returns stored model and normalizes missing variant to `default`. The runner's projected assistant records also carry the actual model reference; see [runner/step.ts](../../opencode/packages/core/src/session/runner/step.ts), initial step publication, and [schema/src/session-message.ts](../../opencode/packages/schema/src/session-message.ts), `Assistant`.

**Recommendation:** during initial trusted root/Planner binding, read and deep-freeze the server root's explicit `SessionInfo.model` as `{providerID, id, variant}`. Require it is present and agrees, with host default-variant normalization, with the root assistant execution evidence already being retained. Both repository worker definitions currently have no model override. Verify the loaded authorized role has no override for this root-inheritance contract; fail closed if configuration changes it rather than inventing precedence. Do not obtain a model name from the proposal, title, root prose, current Planner route, or catalog ordering.

Revalidate the root model during publication, root-return preparation, authorization before creation, after creation, the final barrier, and result checks. Model selection events on bound sessions remain invalidating. Explicitly pass the frozen reference to the creation equivalent; verify returned/reread child model and each implementation assistant model equal it. Read the trusted location's model catalog before creation to check availability/variant support; its eventual disappearance still fails closed at execution/result verification. Do not substitute an available model.

This is one additional immutable field in existing evidence, not mutable workflow state. No `switchModel` is needed. `Context.model.current` is useful UI selection but server root model plus exact execution evidence is the authoritative source for the root that actually planned. No simpler public automatic inheritance mechanism was found.

### Location and workspace limitation

Core child create inherits the full `{directory, workspaceID?}` from its parent. Import requires explicit location. [schema/src/location.ts](../../opencode/packages/schema/src/location.ts), `PublicRef`, excludes `workspaceID`; `PublicSessionInfo` and `PublicSessionTransfer` use that schema. [server/src/location.ts](../../opencode/packages/server/src/location.ts), `requestRef`, routes public location by directory. Neither an extra JSON property nor a header establishes workspace inheritance through these handlers.

For the supported ordinary local topology, pass the frozen directory explicitly, then verify exact root/child location on every read. If activation has `workspaceID`, stop before creation with a trusted explanation. Supporting such a topology requires a host API seam that preserves full parent location; it is not justified to weaken `snapshotLocation` equality. This limitation also affects the existing public identity reads; this investigation does not broaden the topology.

### Navigation and root presentation

- [packages/client/src/solid/data.ts](../../opencode/packages/client/src/solid/data.ts), Created event handling (631 onward), syncs session info; `registerSession`/`resolveRoot`/`session.family` index actual parent relationships. A newly created session begins with empty message/pending collections. Subsequent input/execution events populate it.
- [packages/tui/src/util/session.ts](../../opencode/packages/tui/src/util/session.ts), `sessionFamily`, builds the family from session `parentID`; [routes/session/composer/subagents-tab.tsx](../../opencode/packages/tui/src/routes/session/composer/subagents-tab.tsx), `SubagentsTab`, displays family entries by agent/title/activity and navigates to the selected session. No native tool-call or hidden-agent predicate is required. A created but unprompted child is **inactive**; the picker defaults to active and has a toggle for inactive entries. After execution it is inactive again.
- [routes/session/index.tsx](../../opencode/packages/tui/src/routes/session/index.tsx), commands `session.child.first`, `session.parent`, provide picker and parent navigation. The general session dialog primarily lists roots; do not promise a child appears as its own root entry.
- Native `Subagent` renderer (same file, 3106–3139) renders an assistant tool part and uses its metadata session ID for click navigation. [runner/step.ts](../../opencode/packages/core/src/session/runner/step.ts), `executeTool`, [runner/publish-llm-event.ts](../../opencode/packages/core/src/session/runner/publish-llm-event.ts), tool-call publication, and [message-updater.ts](../../opencode/packages/core/src/session/message-updater.ts), tool projection, explain the root row: the root model called a tool in its own assistant message; progress/result metadata supplies the child ID.
- Created/imported children do **not** automatically add any root tool part or completion synthetic. Native background notifications come from [session/subagent-completion.ts](../../opencode/packages/core/src/session/subagent-completion.ts), `deliver`, on the subagent job path, not from generic parenting or `session.prompt`.

**Recommendation:** native family navigation plus persistent trusted composer status is sufficient. Show “Implementation child created; verifying admission…” and then running/result status in the existing `session.composer.top` slot. A small explicit “Inspect Implementer” action may use supported `context.ui.router.navigate({type:'session', sessionID})`; enable it only once dispatch permits leaving root. Before dispatch, root departure still invalidates the attempt. The [plugin TUI Context](../../opencode/packages/plugin/src/tui/context.ts), `SlotMap`/`UI.router`, supports this without model-history fabrication. No root model resumption, model-authored row, or additional synthetic input is needed.

### Why switching can disappear

[session/session.ts](../../opencode/packages/core/src/session/session.ts), `switchAgent` (90–96), reads the session and publishes `AgentSelected`. The projector updates the agent and creates an `agent-switched` transcript record through `SessionMessageUpdater`. It does not prompt or grant CAP authority and does not automatically apply the agent's model; native continuation separately handles model precedence.

Direct creation already sets the desired agent. The switch's only remaining value would be temporarily delaying ordinary editing capability during part of post-claim validation. It provides no additional candidate authorization, exact-child binding, or one-use property. Removing it avoids the retained switch/echo transcript invariants.

## 5. Recommended ordered flow and barriers

Preauthorization: retain activation observation/Created ordering; allow only one fresh foreground Planner native call; root completes; bind exact root/Planner/native output and explicit root model; build immutable candidate; publish exact Plan once with `resume:false`; retain/revalidate privately during Planner inspection; on root return, revalidate the same object and require a fresh readable completed frame. No grant or implementation child exists. Dirty/ambiguous-initial attempts remain planning-only; Cancel closes the attempt with no child.

On the exact positive local decision:

1. **Synchronously claim** the exact immutable `PublishedAttempt`; remove decision callbacks, retain existing owner/generation confinement, and show persistent admission progress. Duplicate clicks or callbacks cannot claim again.
2. **Pre-creation barrier:** independently revalidate full root/Planner histories and identities, root selected/location, server pending publication and TUI projection, candidate coherence, explicit root model/loaded role, and fresh canonical root/HEAD/clean Git. Reject unsupported workspace/model/policy before creation. Checks after every awaited read retain owner/liveness/location/Git protection.
3. Produce the frozen exact implementation prompt and one candidate-bound grant. Mint a fresh expected child ID **after** the claim. Set the one operation's expected identity for event guards before calling the host. No retry counter or replacement policy exists.
4. Invoke **one** empty `session.import` creation equivalent as `authorized_implementer`, with explicit bound model/parent/location and narrowly initialized state. Mark the invocation as attempted through run-to-completion ownership; an exception cannot rearm controls. Do not issue any bootstrap prompt.
5. **Creation verification barrier:** validate the response and independent session read against the expected ID, exact root parent, role/model/location/project/subpath/metadata/empty overrides, finite stable creation identity, no fork/revert/archive/terminal outcome/idle, empty full paginated transcript, empty inbox, and no active execution. Freeze returned creation evidence. Expected Created echoes may arrive before the response; mismatches invalidate. No unrequested agent switch/model switch/control record is allowed.
6. **Post-creation evidence barrier:** revalidate root/Planner/publication/candidate/model/role and clean Git again; then recheck the exact child and empty state after those awaits. Drift detected here leaves the created child but admits no prompt.
7. **Final full trusted barrier:** repeat full parent/Planner/publication and exact empty-child verification; require unchanged TUI Plan projection, exact claimed owner, live generation, intact candidate and prompt binding, root selected/full location identity, and fresh synchronous canonical root/HEAD/clean Git. Layout geometry is no longer authority after claim. No prompt precedes this barrier.
8. Set the exact prompt/event expectations and conservative dispatch marker, **consume the grant and immediately invoke the sole `session.prompt` for that exact child**, with exact local message ID/text and delivery `steer`. No await, UI action, navigation, or host operation intervenes between consumption and invocation. Transport ambiguity is terminal; never resend.
9. After invocation, use implementation freshness checks rather than clean-worktree checks. Verify returned admission ID/session/type/text/delivery/time/empty attachments and metadata; wait for the exact child; independently bind exactly one trusted user input, only permitted transcript types, expected role/model, successful final/idle, inactive empty inbox, stable identity, and nonempty final text. Freeze and recheck the complete result across parent/Planner/publication awaits.
10. Fresh Git observation requires unchanged canonical root/HEAD and exact observed changed-path membership in the authorized set. Preserve the current gate's meaning: paths may be a subset, but every observed path must exactly match an authorized path. Persist trusted completion/STOP, close CAP ownership, and **STOP before Reviewer / Commit**.

The existing publication pending semantics remain: server root history `H0`, server inbox `[S]`, TUI `H0 + materialize(S)`. Creating the child must not deliver `S` or change/resume the root. Reuse the current repeated barriers rather than reducing observations because creation is now trusted. Child evidence belongs to the local execution continuation, not a modified `PublishedAttempt` or domain candidate.

## 6. Threat-model reassessment and the one fallback

**Verified current contract:** [coding-authority-protocol.md](coding-authority-protocol.md), “Authority lifetime” and “Roles, bounded implementation and failure”, distinguishes host capability from CAP authority and places later local-human/trusted-client manual prompting outside governed CAP admission. [v1-orchestration.md](v1-orchestration.md), “Same-slot implementation and terminal behavior”, permits ambiguous switch failure with a possibly switched child and no rollback/restoration. The charter trusts installed host/runtime and the local process/account boundary; ordinary shell capability is not adversarial containment.

**Direct-created child before the prompt:** it has the host ability to run an editing/shell-capable role if subsequently prompted. Existence does not itself execute that role or modify files. It has no candidate, trusted implementation input, grant object, permission to consume/replay that grant, authority to widen scope, admission to Reviewer/Commit, or means through its denied tools to admit another CAP-controlled turn. The grant exists only in trusted local code and is not session metadata.

**Material difference from today's post-switch failure:** the interval of ordinary editing capability starts at child creation instead of at the subsequent switch. There is no read-only bootstrap turn, so an empty failed child has less conversation content. But after today's switch succeeds or ambiguously succeeds and before the final barrier/prompt, the same editing-capable, unprompted-for-implementation state already exists. New creation failure can leave an unknown/known child rather than a previously inspected slot; fail-closed no-retry behavior and explicit status must acknowledge that difference. Neither case leaves surviving CAP authority.

An external/manual prompt can run the role outside CAP under the current threat model. It can dirty the worktree while CAP is validating, which fresh checks catch, or race a read: event guards and exact transcript/result verification prevent declaring a valid CAP gate for an extra input. CAP is not an atomic OS lock or defense against a malicious trusted host/local human; neither direct creation nor a switch makes that stronger promise. If global prevention of manual edits were required, today's accepted post-switch/post-turn design would already violate it and would require a different containment architecture.

**Inference:** direct creation is acceptable under the accepted boundary. It changes when host capability appears within an already-positive claim, not the authority required for the exact trusted prompt. Failure status must say a child may remain; do not claim that no child or ordinary capability exists just because no CAP input was dispatched.

**Only fallback:** after Authorize and pre-creation validation, create one inert slot, verify it empty, switch the same child, verify switch and identity, run final barrier, consume, prompt once. It may reduce ordinary editing capability during creation/first readback failure, but still leaves an editing-capable child after a later switch/barrier failure. It does not remove the accepted persistence window or fix public `parentID`/workspace/model limitations. Through the same empty import it is callable, but adds no essential property; **do not retain it**. No `READY` bootstrap is needed even in this fallback. No preauthorization slot is an alternative.

## 7. Failure matrix

“Prompt possible” refers to the governed trusted implementation prompt, not external/manual host prompting. “Child” means this attempt's implementation child. Retry/replacement is forbidden throughout the claimed continuation; later entirely fresh attempts receive no inherited authority.

| Failure boundary | Child exists? | Trusted prompt possible? | Retry/replacement | Persistent trusted status |
| --- | --- | --- | --- | --- |
| Authorization claim fails | No | No | None from rejected/stale callback; no claim is invented | Keep current pending/terminal status; invalid ownership fails closed |
| Fresh Git/root/publication validation fails before creation | No | No | Forbidden for this failed claim | STOP: validation failed; no child created or prompt dispatched |
| Creation transport fails ambiguously | Unknown, possibly yes | No: this path has not invoked prompt | Forbidden, including replay with the same ID or replacement ID | STOP: child creation outcome unknown; no trusted prompt dispatched; no creation retry |
| Creation succeeds but returned identity is malformed | Possibly yes, including the expected child | No | Forbidden; do not adopt a different returned identity | STOP: child identity unverified; child may remain; no prompt dispatched |
| Child identity/empty-state verification fails | A host session may exist; verified child binding failed | No | Forbidden | STOP: admission failed; child may remain; no prompt dispatched |
| Location/HEAD/Git changes while creation is awaited | Possibly/actually yes depending on host completion | No; post-await check stops | Forbidden | STOP: freshness changed during creation; child may remain; no prompt dispatched |
| Parent/Planner/publication evidence changes after creation | Yes if creation verified | No | Forbidden | STOP: evidence changed; child remains without trusted implementation input |
| Final full barrier fails | Yes | No | Forbidden; unused grant closes with owner | STOP: final admission failed; no prompt dispatched; child remains |
| Prompt transport fails ambiguously | Yes | Yes, possibly accepted/running/completed | Forbidden; grant already consumed | STOP: implementation may have started; no prompt will be resent |
| Implementation result verification fails | Yes | Already invoked | Forbidden | STOP: result cannot be verified; no passing gate, no resend |
| Git scope/HEAD gate fails | Yes | Already invoked | Forbidden | STOP: Git gate failed; report reason, no passing result/Reviewer/Commit |

Cancel/planning-only/pre-creation stale rejection explicitly creates no child. Do not automatically delete, restore role, clean the worktree, retry reads to salvage admission, or replace a failed actor. Ambiguous creation can be inspected manually for diagnostics, but finding a session later cannot resurrect the claim. A known expected ID can be displayed diagnostically without becoming authority.

## 8. Simplification impact

| Current assumption/code | Recommended change |
| --- | --- |
| `SLOT_PROMPT`, prefix/`READY` slot bootstrap | Delete slot constant and branches; retain prefix verification only for the native Planner. |
| `Call` union, `Bound.slot/slotChild/slotHistory/slotCreatedAt` | Make native call evidence Planner-only; delete all slot fields rather than replace them with empty placeholders. |
| `parentCalls(...)` exact two native calls | Require exactly one fresh Planner call, exact input/wrapper and successful root final/idle. Reject any additional root tool call. |
| `bindNativeAttempt(...)` loop over both children | Bind only Planner; retain exact root/Planner histories, IDs, creation evidence and add immutable explicit root model (and metadata needed for inherited policy). |
| `PublishedAttempt`, coherence checks | Keep candidate/publication immutable and complete without worker evidence. No post-claim worker mutation of the published object. |
| `verifyPublishedAttempt(...)` slot reads | Delete; retain full root/Planner/pending publication/projection/Git checks. |
| `verifyParentPlanner(...)` slot wrapper comparisons | Delete; require the exact one-call root transcript and root model throughout. |
| `switchedSlot(...)` | Delete. Small local empty-child and exact-result verifiers replace its useful identity/input/result properties; no bootstrap/switch suffix parsing. |
| `executeBoundImplementation(...)` retained slot switch | Create one child after claim; freeze exact creation evidence; final barrier/consume/prompt/result/Git sequencing remains. Rename if helpful, without a workflow abstraction. |
| `owner.switching`, `owner.switchRecord`, `Switch` type | Delete. |
| TUI `switchEcho`, close/reset checks, `session.agent.selected` exception | Delete switch allowance and switch echo reconciliation. Unrequested agent/model changes on the child fail closed. |
| TUI event watched `bound.slot.childID` | Use the post-claim locally expected/verified child ID; require exact Created and existing prompt/execution lifecycle echoes. |
| Original inert native Implementer root row | Disappears. Keep persistent trusted status and normal family navigation. |
| Fake host's initial slot/`READY`/switch implementation | Delete. Initialize only parent/Planner; add a test-scoped creation double that creates an empty exact child and can fail ambiguously. |

**Unavoidable local evidence:** expected fresh child ID/request before invocation (for synchronous event correlation), frozen creation identity afterward, frozen explicit root model in existing published evidence, and existing exact prompt/dispatch expectations. These are bounded function/owner expectations, not worker-attempt domain state. Metadata inheritance, if present, can be held in the existing immutable root evidence. No phase enum, durable WorkflowState, generalized execution registry, retry/replacement counters, or recovery machine is required. A Created echo guard replaces an obsolete switch echo only where event ordering requires correlation; do not recreate switch machinery wholesale.

## 9. Expected implementation target files

- Change [.opencode/agents/orchestrator.md](../.opencode/agents/orchestrator.md): Planner-only delegation permission and one-call contract; root still completes normally without copying the proposal.
- Delete [.opencode/agents/implementer_slot.md](../.opencode/agents/implementer_slot.md).
- Keep [.opencode/agents/authorized_implementer.md](../.opencode/agents/authorized_implementer.md) as the direct role. Its hidden/read/edit/shell/denial contract already fits; change only wording if needed, not permissions for a bootstrap.
- Change [src/attempt.ts](../src/attempt.ts): Planner-only publication, root-model evidence, narrow empty import, direct-child verification, preserved final admission/result/Git barriers.
- Change [.opencode/plugins/opencode-agents/tui.tsx](../.opencode/plugins/opencode-agents/tui.tsx): post-claim child expectation/event guards, remove switching state, precise child-creation STOP status; keep publication, root-return and resize behavior.
- Change [test/attempt.test.ts](../test/attempt.test.ts): remove slot fixtures and switch-only cases, add focused creation/model/empty-state/ambiguity regressions with trusted doubles.
- Change [docs/v1-orchestration.md](v1-orchestration.md): remove “same retained slot” architecture/native/history statements, document actual pinned API and navigation.
- Change [docs/coding-authority-protocol.md](coding-authority-protocol.md) in the future implementation: its normative Roles/failure wording currently explicitly mentions slot bootstrap/later switch/ambiguous switch. Replace those obsolete clauses with post-authorization creation/no-replacement semantics while retaining capability/authority and manual prompting boundaries. This is an additional consistency target discovered during investigation, not edited here.

No `src/cap.ts` change is required by the recommended grant semantics. No sibling checkout, host upgrade, new runtime plugin, root-model adapter, or host API patch is required for the ordinary local empty-import recommendation. Historical investigation documents should remain historical evidence, not be mechanically rewritten.

## 10. Focused regression design

No tests were added/run in this pass. Use existing `snapshotTest` trusted Git observer, local fake-host/event/JSX machinery and existing isolated real-Git integration cases. Do not create Git repositories for creation/permissions/resize/transcript sequencing tests or add production injection hooks.

1. Planning/publication/root-return succeeds with only parent and Planner sessions; zero creation calls, no worker evidence in `PublishedAttempt`, exact one native call.
2. Cancel wins once and permanently prevents child creation, grant, or prompt despite stale Authorize callbacks and subsequent frames.
3. Dirty/planning-only and ambiguous-initial ordering publish without a child; later cleaning does not enable that attempt.
4. Invalid/stale callback, root/Git/HEAD/location/publication/Planner/candidate/model/policy drift detected before creation yields zero creation calls. Unsupported workspace/missing model fails before child creation.
5. Exact positive claim causes one creation invocation despite duplicate clicks, events, callbacks, and frames. Existing owner rules reject invoking the executor twice.
6. Assert the actual public operation is `session.import`, not a fictitious `session.create({parentID})`; exact empty messages and parent/agent/directory/model/variant/permissions/metadata/zero usage. Verify response and independent reads, with wrong ID/parent/role/model/location/project/time/override mutations rejected. Include collision and malformed response.
7. Fresh child has no outcome/idle/active run/inbox/history; an injected input, synthetic/control record or execution before dispatch stops. Do not require a successful empty session.
8. Assert no `implementer_slot` definition/delegation permission/bootstrap constant, `READY` user/final transcript, or agent-switched record remains. Planner's native prefix/read-tool constraints remain.
9. Mutate each evidence class during awaited creation and after returned identity/readback, including during final parent reads. Final barrier fails with one created child and zero prompts.
10. Creation commits then rejects ambiguously; uncommitted transport failure; response lost; mismatched early/late Created echo. No second invocation, same-ID replay, replacement, rearm, or prompt. STOP distinguishes unknown creation from prompt ambiguity.
11. Verify final barrier precedes consumption and one exact prompt to the exact created child with exact message ID/text/delivery. Include wrong returned input ID/session/text/type/attachments/metadata. Retain the existing no-await consume/dispatch property.
12. Prompt commits/runs then rejects ambiguously: grant consumed, no resend/replacement, persistent “may have started” status.
13. Result requires stable creation/agent/model/parent/location, one exact input and successful final/idle, no extra control/input; freeze whole result across later parent reads. Preserve actual real-Git unchanged HEAD and exact scope cases, including out-of-scope/concurrent paths. Do not duplicate their Git cost.
14. Issue #4: pause creation/readback after synchronous claim; resize/reflow and DecisionStrip replacement cleanup preserve the same continuation and one child. Before claim, stale-frame/clipped/incomplete controls cannot create anything. Actual root departure/location/projection/generation/renderer loss still stops; resize itself does not.
15. Issue #5: inspection of Planner before completion/during publication retains exactly the same immutable Plan without decision/child. Root return revalidates once and needs a fresh readable frame. Stale preparation/cleanup/retained evidence drift cannot rearm. Replace old preauthorization slot-navigation scenarios with Planner/home navigation, preserving their ownership tests.

### Existing tests to delete or rewrite

In [test/attempt.test.ts](../test/attempt.test.ts), remove the switch-specific assertions/cases inside “Planner bootstrap rejects forbidden or unfinished tools and slot rejects any tool or non-READY result” (582), “switch identity, parent evidence, and slot results remain bound after implementation” (1323), and late-switch echo mutation in “unexpected native events and mismatched late switch echoes permanently invalidate” (1365). Delete READY/bootstrap/switch-only mutations rather than translate every historical case into a new state.

Rewrite the positive same-slot test (352), two-call evidence rejection (390), post-switch/ambiguity cases (441, 456, 567), slot-after-parent verification (633), permissions after switch (643), TUI positive claim (903), claimed drift during switch (1081), post-claim resize (1263), expected echo reconciliation (1353), and root-return authorization (1586) around direct empty creation. Keep their meaningful freshness/ownership/one-use/input/result assertions. Agent-rule test (507) checks three roles and Planner-only delegation. Fake host (154 onward) must start with no implementation session and bind real model fields; it currently omits model evidence altogether.

Keep publication exactness, pagination/duplicate-ID, initial eligibility, immutable evidence, Plan hydration, dirty UX, Cancel, status persistence, pointer/frame readability, revocation, and #4/#5 regression substance. Replace shared fixture assumptions once instead of retaining a hidden compatibility slot. After implementation: `bun run typecheck`, focused attempt suite, full `bun test`; broaden only for failures/new concerns.

## 11. Minimal live OpenCode 2.0.21 dogfood plan

This is a future validation plan, **not executed**. Use a disposable isolated worktree and a single trivial authorized file; record root/Planner/implementation IDs and before/after child listings, HEAD, Git paths, exact model/role/location and trusted status. Read-only client session/message inspection can supplement the native picker; do not infer “no child” merely from a missing row or the active-only picker.

### Positive

1. Start clean, record HEAD, activate the plugin, submit a small one-file request to Orchestrator with a known selected model/variant.
2. Planner runs; root completes; trusted Plan and readable Authorize/Cancel appear. Inspect the native family, including inactive entries, and independent child listing: only Planner, **no Implementer**. Worktree remains clean.
3. Authorize once. Confirm one new child appears afterward in `authorized_implementer`, with exact root parent/location/model and no permission overrides. Inspect its transcript/native navigation; no `READY` bootstrap or role switch. If observing the pre-dispatch verification interval, use inactive navigation/inspection carefully: leaving root before dispatch intentionally stops admission.
4. Once running, navigate through the normal picker to the child and back. Confirm implementation input is exactly the trusted proposal/scope; only the authorized file changes, HEAD stays unchanged.
5. Completion status stays visible in the root composer; no root Implementer tool row is expected. Confirm no Reviewer/Commit, no root resumption, and no extra child/prompt.

### Cancel

1. Start a fresh clean attempt; Planner and trusted Plan appear. Native inactive-family plus independent listing confirms no implementation child before decision.
2. Cancel. Wait through normal event/frame processing; verify no implementation child appears, no prompt is sent, persistent cancellation remains, worktree stays clean and HEAD unchanged.

### One additional negative: ambiguous post-authorization creation

Use a test-scoped client transport wrapper/proxy in an isolated dogfood setup that allows the one import request to reach the host and then drops its response. Do not alter production host code or introduce a runtime test switch. Verify trusted STOP reports unknown creation and no implementation prompt, one import attempt only, and no replacement/rearm. Independently inspect whether the single empty editing-capable child remains; verify no trusted input and clean worktree. This validates the new creation ambiguity boundary rather than repeating old Cancel/scope cases. If no safe scoped transport fixture is available, keep this as automated coverage and record the live gap rather than manufacture failure with retries or production hooks.

## 12. Blockers and unresolved host limitations

- **Public `session.create` parenting is unavailable in 2.0.21.** The recommended local equivalent is empty `session.import`. If project policy rejects using this documented experimental transfer endpoint for empty creation, implementation is blocked pending a supported parent-aware create API. The inert-switch fallback has the same parenting obstacle and is not a remedy. Do not restore a preauthorization slot.
- **Workspace identity is not representable through public create/import.** Reject workspace-bound activation before creation. A future host seam would need actual parent-location inheritance/full identity in requests and readback, not a type assertion. Ordinary local topology remains supported.
- **Import timestamp provenance differs from create.** Local initialization time is trusted caller evidence, not host-created time. Preserve both meanings and do not copy the root's old creation time. Native Created echoes remain host evidence of the specific committed operation; compare only normalized fields that the operation actually shares.
- **No native root tool row is produced.** Source supports family/picker navigation and trusted slot/router presentation. Live visibility of the empty imported child, inactive filtering, selected model/variant, and event timing still need dogfood; this report claims no live PASS.
- **Role/model registry is mutable trusted host policy.** Explicit root model and loaded role readback/revalidation avoid guessing; no check turns the trusted host into an adversarial attested sandbox. Future config overrides must be rejected or deliberately designed, not silently defaulted.
- **Normative documentation still contains slot/switch language.** The user/issue architecture supersedes it for this design; future implementation must update CAP and orchestration docs together. No existing document was changed in this investigation.

These limitations do not establish a security reason to pre-bind a worker. For the pinned ordinary local host, the supported empty creation equivalent lets the project remove the slot, bootstrap model turn, and switch machinery while keeping exact candidate authorization and final prompt admission intact.

Docs-only validation: `git diff --check`, `git diff --stat`, `git status --porcelain=v1 --untracked-files=all`, and `git rev-parse HEAD` were run. The report is the sole untracked addition; ordinary `git diff --stat` excludes it, so a separate no-index diff checks the new file itself. HEAD remains the baseline above. No production code, tests, agent definitions, existing docs, or GitHub records were changed; no implementation tests, OpenCode, Docker, commit, or push were run.
