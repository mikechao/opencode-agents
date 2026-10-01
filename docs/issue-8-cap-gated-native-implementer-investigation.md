# Issue #8 CAP-Gated Native Implementer Investigation

## Executive Conclusion

Keep the Issue #6 `session.import` architecture and solve Issue #8 with a small trusted status/navigation contribution. OpenCode 2.0.21 **can resume the root through synthetic input and has a genuine server-plugin pre-execution tool rejection hook**; a native Implementer call is therefore not inherently model-authorized. However, neither facility supplies the complete existing CAP boundary: the grant lives in the TUI, the server permission hook cannot elevate the Orchestrator's configured denial, session permission elevation persists and is inherited by children, and ordinary native execution creates and prompts its child without the current intervening verification barrier. Public tool wrapping offers additional possibilities, but integrating it requires authority transfer, new permission/lifetime rules, root-continuation validation, and version-sensitive lifecycle interception. A genuine model-emitted native call would provide the desired row/navigation automatically; direct execution of the public tool callback would not. Replacing the current path for this presentation requirement is not recommended.

Source investigation only, 2026-10-01. Project HEAD: `cf0c628a71e988ec71ac042884f2b7ac6e0b98b1`; initially clean. Authoritative sibling OpenCode: tag `v2.0.21`, HEAD `8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`; initially clean. The project pins `@opencode/plugin` to `2.0.21`. No host execution, build, tests, dogfood, Docker, GitHub mutation, commit, or push was performed. Findings below distinguish inspected behavior from possible future designs. Historical project investigations were treated as context, not evidence of current behavior; their former slot and role-switch architecture is not the current baseline.

## Current Issue #6 Baseline

The [Orchestrator definition](../.opencode/agents/orchestrator.md) starts with deny-all and allows only native delegation to `planner`. It makes one fresh foreground Planner call, returns the fixed waiting sentence, and ends. The hidden [authorized Implementer](../.opencode/agents/authorized_implementer.md) has the bounded implementation role, no configured model override, and no delegation or session-control capability.

[src/attempt.ts](../src/attempt.ts), `bindNativeAttempt`, `publishPlan`, `verifyPublishedAttempt`, and `verifyParentPlanner`, bind the root request, exact native Planner call/result, complete histories, session identities, location, project/subpath, explicit root execution model, immutable proposal, Git baseline, and exact trusted publication. The publication is a synthetic inbox item admitted with `resume:false`; the root remains idle, its completed transcript unchanged, with exactly that publication pending. Publication ownership is trusted TUI ownership, not an Orchestrator summary.

The [TUI plugin](../.opencode/plugins/opencode-agents/tui.tsx), `decide`, claims the exact published object synchronously before any await. `authorizePublishedAttempt` revalidates it. `executeBoundImplementation` then:

1. Checks loaded Implementer policy/model and publication/Git freshness.
2. Constructs a fresh local child ID, exact root parent, explicit frozen model/location, empty permissions, zero usage and empty transcript; calls `session.import` exactly once.
3. Verifies returned and reread empty-child identity, policy/catalog evidence, root/Planner/publication evidence, and local generation/decision ownership.
4. Performs the final read barrier and fresh synchronous Git/local checks; marks dispatch and consumes the one-use candidate grant immediately before invoking the exact `session.prompt` request.
5. Verifies returned prompt admission, sole exact child input, successful bound result, unchanged HEAD/root, and changed-path membership in the exact authorized scope. Stops before Reviewer / Commit.

[src/cap.ts](../src/cap.ts), `grantIntent` and `consumeIntent`, keep authorization process-local and candidate-bound. Irreversible creation/dispatch flags prohibit retry or replacement after ambiguity. Events invalidate evidence promptly; independent read barriers detect changes even when event delivery is delayed.

Issue #8 exists because import creates a real parented session, but never creates an assistant `subagent` tool part in the root transcript. The current composer-top status is a separate trusted presentation surface. Child parenting alone does not generate the Planner's inline row.

## Native Subagent Execution Trace

The inspected path is:

```text
root provider emits assistant tool-call
  -> SessionStep publishes Tool.Called, then forks local execution
  -> SessionModelRequest.executeTool
  -> Tool.snapshot.execute
  -> server tool.execute.before hooks
  -> tool lookup / request availability / input decoding
  -> native subagent.execute
       parent/depth/agent checks
       Permission.assert(subagent, target agent)
       create child (or reuse/switch an existing child)
       awaited progress({sessionID, status:"running"})
       child prompt admission + execution wake
       subagent job start + foreground block
       child result wrapper + sessionID metadata
  -> output normalization / tool.execute.after
  -> Tool.Success publication
  -> root assistant tool-part projection + TUI rendering/navigation
```

Concrete source anchors:

| Boundary | Inspected implementation |
| --- | --- |
| Model call becomes real execution | [runner/step.ts](../../opencode/packages/core/src/session/runner/step.ts), `make`, lines 88–129: `publisher.publish(event)` completes before `executeTool` starts in a scoped fiber. Multiple distinct calls can execute concurrently. |
| Persisted call input | [runner/publish-llm-event.ts](../../opencode/packages/core/src/session/runner/publish-llm-event.ts), `tool-call`, lines 458–474: records root session, assistant message, call ID, and input. Duplicate identical call IDs are rejected; distinct call IDs are not deduplicated by semantic intent. |
| Tool dispatch | [model-request.ts](../../opencode/packages/core/src/session/model-request.ts), `executeTool`, lines 399–413; [tool.ts](../../opencode/packages/core/src/tool.ts), `beforeExecute`, `snapshot.execute`, lines 103–111, 263–284. |
| Input validation | [tool/runtime.ts](../../opencode/packages/core/src/tool/runtime.ts), `execute` / `decodeInput`, lines 28–78: runs after the before hook and before the body. |
| Native child lifecycle | [tool/plugin/subagent.ts](../../opencode/packages/core/src/tool/plugin/subagent.ts), `Plugin`, lines 109–265: actual permission/create/prompt/job/result path. |
| Parenting/inheritance | [session.ts](../../opencode/packages/core/src/session.ts), `create`, lines 250–305: child inherits parent location, metadata and session permissions unless explicitly supplied. Native subagent does not supply explicit child permissions. |
| Assistant tool records | [session/message-updater.ts](../../opencode/packages/core/src/session/message-updater.ts), `session.tool.input.started`, `session.tool.called`, `session.tool.success`, `session.tool.failed`, lines 302–375. [projector.ts](../../opencode/packages/core/src/session/projector.ts), lines 699–705, persists their projection. |
| Live metadata/result | [runner/publish-llm-event.ts](../../opencode/packages/core/src/session/runner/publish-llm-event.ts), `progress` / `toolExecution`, lines 561–590, publishes `Tool.Progress` and terminal `Tool.Success`. |
| Native TUI row and click | [routes/session/index.tsx](../../opencode/packages/tui/src/routes/session/index.tsx), `Subagent`, lines 3106–3138: renders agent/description/model from tool input, reads child ID from tool metadata, and navigates to that session. |

Native input includes `agent`, `description`, `prompt`, optional `model`, `sessionID`, and `background`. Hidden agents are callable by explicit ID: the available-agent description filters hidden roles, but execution resolves the supplied ID and rejects only unknown/primary agents at that boundary. Hiding `authorized_implementer` is not an authorization gate.

For a fresh child, the actual first input is **`"You are a subagent spawned by another session.\n" + input.prompt`**. Foreground success returns structured output `{sessionID,status:"completed",output}` and content `<subagent sessionID="…" state="completed">…</subagent>`, with `{sessionID,status}` metadata. Progress exposes the child ID before completion. The TUI live transport handles progress; terminal success persists the child ID for later hydration. See [stream-v2.transport.ts](../../opencode/packages/tui/src/mini/stream-v2.transport.ts), `session.tool.progress`, and [stream-v2.subagent.ts](../../opencode/packages/tui/src/mini/stream-v2.subagent.ts), child metadata tracking. Progress alone is not the settled assistant tool-result record.

**Presentation answers:** the inline row is fundamentally an assistant tool part, with live or settled child metadata. There is no inspected public attach-existing-child or insert-native-row API. `sessionID` can continue an existing child through a *new actual model tool call*, but it prompts that child again and may switch its agent/model; it is not a presentation-only attachment. An imported child has normal family identity/navigation, but does not acquire this exact row without an actual root tool call. Writing artificial tool records would fabricate provenance and is excluded.

## Root Resume After Authorization

**Supported: trusted synthetic input can start another root model turn without a human-authored text message.** [protocol/groups/session.ts](../../opencode/packages/protocol/src/groups/session.ts), `session.synthetic`, lines 453–472, exposes exact ID/text/description/metadata/delivery/resume fields. The public TUI client and server plugin context can call it. [session/session.ts](../../opencode/packages/core/src/session/session.ts), `synthetic`, lines 274–313, durably admits a synthetic inbox item, then wakes execution unless `resume:false` or the session is reverted.

The runner promotes eligible inbox work and loads context before executing the model: [runner/llm.ts](../../opencode/packages/core/src/session/runner/llm.ts), `drain` / `advanceToStep`, lines 54–195. [projector.ts](../../opencode/packages/core/src/session/projector.ts), `InboxDelivered`, lines 611–640, projects synthetic inputs distinctly from user inputs. However, [runner/to-llm-message.ts](../../opencode/packages/core/src/session/runner/to-llm-message.ts), `case "synthetic"`, lines 284–285, converts synthetic text into a **provider user-role message** and does not carry its synthetic description/metadata into that message. The host can distinguish its type and exact ID; the model sees prose, not an unforgeable CAP privilege.

Other mechanisms:

| Mechanism | Actual semantics / relevance |
| --- | --- |
| `session.prompt` | Programmatic use is supported, but records a user input, even if a trusted plugin supplied its text. It does not attest human authorship or CAP authorization. Default steer delivery wakes execution; `resume:false` admits without waking. |
| `session.inbox.update` to `steer` | Supported for an existing pending item. `steerInbox` changes delivery and wakes execution; it does not create a grant. Queue/steer are scheduling modes, not authorization flags. |
| Existing pending Plan + another synthetic control item | A later wake can promote the pending Plan too. Candidate design must account for its exact delivery and new control input, rather than assuming the old pending-inbox invariant remains true. |
| `resume:true` | On prompt/synthetic, schedules admitted work. On `session.interrupt`, resumes eligible pending steering/control work after interruption; it is not a privileged arbitrary-tool executor or a bare public root-resume endpoint. |
| Internal `Session.resume` / execution service | Present in core, but not a general public TUI/client `session.resume` API. The public plugin adapter also does not expose that operation. Do not import core services into the TUI to obtain it. |
| `session.command` | Runs a registered command callback. Ordinary commands may prompt/switch the root; configured subagent commands use a different child/background path, not a root assistant native call. |

The smallest initiation proposal would be a trusted synthetic control item after the exact positive claim, with a trusted local expectation for its ID and text. **Its prose is an instruction to propose a call, never authorization.** A later server gate must independently bind the real call to the claimed attempt.

Resuming does not inherently transfer Plan ownership to the model: retain trusted publication, candidate and local human decision. It **does change Issue #5's observation contract**. Today `verifyParentPlanner` requires an idle root, unchanged `bound.parentHistory`, and inbox `[publication]`; root execution events revoke the attempt. Native continuation would deliberately violate all three. A redesign must retain the immutable planning prefix while validating an exact continuation suffix, publication delivery, new assistant identities/model evidence, concurrent input and all unexpected events. Removing those checks wholesale would weaken publication ownership.

## Pre-Execution Admission Hooks

### Supported server tool hook

**Yes: `tool.execute.before` is a trusted, awaited pre-body gate.** It receives tool name, root session ID, executing agent, assistant message ID, call ID, and the complete parsed JSON input as `unknown`. It runs before native child creation and before tool-schema decoding, not merely after execution. It can inspect own keys and reject extra arguments before schema normalization discards them. It can replace input; CAP should reject mismatches rather than silently repair a different requested operation.

[plugin/effect/tool.ts](../../opencode/packages/plugin/src/effect/tool.ts), `ToolHooks` / `ToolFailures`, expressly permits `Tool.Error` failure for `execute.before`. [core/plugin/hooks.ts](../../opencode/packages/core/src/plugin/hooks.ts), `trigger`, awaits callbacks sequentially and propagates that failure. [core/tool.ts](../../opencode/packages/core/src/tool.ts), `snapshot.execute`, never calls the tool body on failure. [runner/step.ts](../../opencode/packages/core/src/session/runner/step.ts), lines 120–128, turns typed `Tool.Error` into a failed tool part. **Denial prevents that call's child creation and child model execution, although the root proposal/tool part has already been recorded.** A failed tool can be visible to the model, which may subsequently retry with a different call ID.

Use the Effect plugin form when relying on the declared typed rejection. The Promise adapter registers callbacks through `Effect.promise` ([promise/adapter.ts](../../opencode/packages/plugin/src/promise/adapter.ts), lines 504–505); a thrown/rejected callback is a defect rather than the typed failure described by `ToolFailures`. It still prevents the body from running, but ordinary error settlement is not interchangeable. This distinction should be tested if ever adopted.

A prospective gate can validate every requested argument:

| Required check | Evidence / enforcement point |
| --- | --- |
| Tool and target | Exact effective native `subagent` name, exact `authorized_implementer` ID; account for aliases and subsequent trusted transforms. |
| Exact prompt | Compare against trusted frozen `implementerPrompt(candidate)`, not model-provided digest/approval. Also freeze/check the host-prefixed effective child input. |
| Description | Exact trusted presentation string; never authority or scope. |
| No reuse/background/model drift | Reject `sessionID`, `background`, and `model` keys, including explicit false/empty values, unless the contract expressly permits an exact trusted model reference. |
| No unexpected arguments | Reject non-object/array input and enforce exact own-key set before schema decoding. |
| Root/attempt/model binding | Hook supplies real call identities; independent state/history/session/catalog reads must bind them to the authorized continuation and frozen attempt. |
| One live use | Trusted process-local reservation/consumption state, serialized before releasing any call to the native body. Never session metadata or model prose. |

The built-in subagent before hook normalizes empty optional `model`/`sessionID` strings. Other trusted hooks can mutate tool/input and request definitions can resolve aliases. Hook order is registration order, not a special final CAP priority. An exact raw-input contract needs explicit ordering, or a final tool wrapper check plus retained original call evidence; inspecting one mutable hook event and assuming it remains unchanged is insufficient.

### Atomicity and the final barrier

The hook can synchronously reserve/consume one local grant at its final successful check. Parallel candidate calls must reserve **before awaits**, so another call cannot also enter validation. A conservative design burns the attempt on ambiguity and never reopens a reservation. OpenCode supplies no transaction joining CAP consumption, permission evaluation, child creation and child prompt admission.

After the before hook, the native body still awaits parent/depth reads, agent resolution, permission evaluation, child creation and progress publication. Consuming there is adjacent to releasing the *tool body*, not adjacent to admitting the *implementation prompt*. It does not reproduce Issue #6's verification of an empty child's identity/policy/model followed by a final barrier and adjacent consume/prompt invocation. Policy, revocation and publication can change across these awaits.

### Public wrappers and the progress boundary

`tool.transform` / `ToolEditor.update` publicly support wrapping the registered native executor. [plugin/effect/tool.ts](../../opencode/packages/plugin/src/effect/tool.ts), lines 8–18, and [promise/adapter.ts](../../opencode/packages/plugin/src/promise/adapter.ts), lines 471–499, expose the existing callback; wrapping it is not itself a private-core import.

There is an additional **source-demonstrated option**, not a dedicated admission API: native subagent awaits `context.progress({sessionID,status:"running"})` after creation and immediately before `sessions.prompt` (lines 200–213). An Effect wrapper could replace progress, capture/bind the freshly created child, forward native progress, then perform empty-child/policy/publication/Git checks before returning. Interruption/defect can stop the body before prompt; `Tool.Context.progress` has no typed denial channel. Forward progress **before**, not after, the final barrier, otherwise its publication adds another await. A wrapper would also need an irreversible pre-body reservation to prevent a second child, with final grant consumption at this later boundary.

This option deserves explicit acknowledgment: source does not prove that a native path is universally impossible. It preserves a genuine model tool record and the native body. But using an output/progress callback as authorization depends on this pinned tool's ordering, exception/interruption behavior, and a guarantee that it is called exactly once before any child input. It also cannot choose or receive the native prompt ID before admission; it must bind that input afterward through independent transcript/inbox evidence. It does not solve permission elevation or cross-process grant ownership. No supplied API offers an explicit verified-child, exact-prompt admission callback with those semantics.

### Other hooks/events

`permission.evaluate` runs before child creation but sees action/resources/source IDs, **not full native arguments**. `tool.execute.after`, `session.created`, progress events delivered to the TUI, and terminal tool/session events are observation seams, not synchronous vetoes. Reacting to a child event by interrupting it can race prompt/model execution and cannot replace pre-execution admission. Session context hooks can hide/change tool definitions for a model request, but hiding is not one-use admission and does not freeze later permission/policy state.

### Where the current grant lives

The TUI [Context](../../opencode/packages/plugin/src/tui/context.ts), lines 516–532, has `client`, `data`, `ui`, and storage; it has **no** server `tool.hook`, `tool.transform`, or `permission.hook`. The current private `deciding` reference and generation cannot be directly consumed by a native server hook.

Public server-plugin RPC registration exists ([promise/rpc.ts](../../opencode/packages/plugin/src/promise/rpc.ts), `RpcDomain.register`; [core/plugin/host.ts](../../opencode/packages/core/src/plugin/host.ts), `rpc`; [protocol/groups/rpc.ts](../../opencode/packages/protocol/src/groups/rpc.ts), `rpc.call`). TUI client traffic can call such an endpoint. Therefore an explicit **new server-side CAP ownership design** is possible without assuming shared TUI memory or treating model prose as a grant. It would need trusted registration/claim identity, process-local one-use state, independent evidence, and a defined revocation boundary on TUI disposal/route change/server restart. A message to register a grant and a later message to revoke it introduce ordering/acknowledgment windows; no current TUI pre-tool callback closes those windows synchronously. This is new authority machinery, not merely a hook added to today's executor.

## Dynamic Permission Analysis

[core/permission.ts](../../opencode/packages/core/src/permission.ts), `configured`, `evaluateInput`, `assert`, lines 158–188 and 231–263, establishes the critical order:

```text
current agent rules + current session overrides
  -> configured deny? return deny immediately
  -> merge saved allowances
  -> permission.evaluate hook
  -> allow / deny / ordinary pending permission request
```

Last matching configured rules win. **The hook cannot turn today's configured Implementer denial into allow, because it is never called for that denial.** Model-hidden status also does not change this.

| Mechanism | Supported behavior, timing, and CAP assessment |
| --- | --- |
| `permission.evaluate` | Can change allow/ask to deny or allow when configured policy has not already denied. Source IDs can bind a reservation established by the tool hook. Cannot elevate today's denial; has no complete argument payload or one-use grant primitive. |
| Session permissions via `session.update` | Supported durable replacement ruleset, immediately recorded through `setPermissions`; native tool re-reads policy when asserting. Can narrowly override deny after Authorize without editing agent config or reloading. **Not call/turn scoped**, no expiration/CAS/consume. Permission assertion already allowed is not undone by a later deny. |
| One-turn permission override | No corresponding supported API found. `resume`, steer, metadata and ordinary permission `once` do not provide it. |
| Ordinary permission reply `once` | Releases one pending assertion, not exact CAP scope/prompt or candidate. A generic user/autoaccept path can answer it. Native request metadata omits the full input. Not CAP by itself. |
| `always` / saved permission | Can persist project-wide and release other requests. Cannot override configured denial, but can bypass a static ask policy. Not an acceptable authority lifetime. |
| Static `ask` plus server gate | Can keep actual preauthorization calls rejected if a correctly loaded trusted gate denies before permission. It changes defense-in-depth: missing/disposed gate falls back to ordinary permission approval, not CAP. Requires a new fail-closed lifecycle; do not substitute model instructions. |
| Static target allow plus server gate | Host hook can technically deny every preauth/malformed call. Permanently broadens root delegation capability and relies entirely on gate lifetime. Excluded by the requested architecture constraints. |
| Tool input transforms / wrappers | Supported server extensions; can validate/replace input or wrap execute. Input changes cannot elevate configured denial. A custom replacement body or altered permission actor is a new trusted delegation architecture, not a stock dynamic root permission API. |
| Session context tool removal | Supported per-request tool shaping. Does not elevate target restrictions, provide one-use admission, or invalidate an already prepared/executing call. |
| Agent config transforms/reload | Server-supported registry changes, but global/revision-sensitive and subject to tool/request snapshots. Runtime config rewriting is excluded here. |
| Root `switchAgent` | Supported and persisted; subsequent model context changes. No bounded one-call editing-free permission role switch primitive. Changes frozen root-role/history evidence; not recommended. |

Session overrides have another concrete consequence: native child creation inherits them from the root. A temporary `subagent:authorized_implementer=allow` becomes a child override too, defeating the role's delegation denial wherever other host limits permit it. Resetting root permissions afterward does not reset the child's copied permissions. Current `childIdentity` rejects overrides and import explicitly supplies `[]`. A native redesign must sanitize and verify child permissions before execution or enforce a separate trusted gate for every inherited delegation path; ordinary depth limits are not CAP authority.

With only a temporary allow, concurrent tool fibers can both pass permission and create children. A server reservation gate can close that duplicate-call race while loaded, but the durable allow itself can survive TUI/server failure or plugin removal. Cleanup is not a transaction or expiration mechanism. Rehydrating permission records must never revive authority. Therefore **permission-only unlocking is not CAP-compatible**, and supported session-local changes do not by themselves meet all requested lifetime constraints.

## Trusted Direct Native Invocation

There is an important distinction between invoking a callback and invoking a managed root tool lifecycle.

**Server plugin code can directly call the native executor through the public tool domain.** `ctx.tool.list()` and the transform editor expose `Info.execute`; the Promise adapter wraps the real Effect executor (`promiseExecutor`, lines 251–260 and 465–499). A trusted caller can supply exact inputs and a `ToolContext`. The native body still performs permission checks using that context, creates a parented child, prefixes its input, runs the job, and returns native output/metadata. TUI code cannot access this domain directly, but could request a newly implemented server RPC.

**There is no inspected supported managed-tool invocation API that also creates the genuine root assistant part without a root model call.** Calling `Info.execute` bypasses `SessionStep`/publisher record creation, the snapshot's before/after hook machinery, and tool-runtime input/output validation unless the caller reconstructs those layers. Supplying message/call IDs does not create an assistant or tool part; a caller-supplied progress callback does not create one either. Returning `sessionID` to an RPC caller produces no root tool result record. This route can avoid the new root model turn, but does **not** get Planner presentation automatically.

`session.command` is not an escape hatch. [session/command.ts](../../opencode/packages/core/src/session/command.ts), `execute`, invokes a registered command; [config/plugin/command.ts](../../opencode/packages/core/src/config/plugin/command.ts), lines 98–122, creates/prompts a background child for subagent commands. It returns no exact child/prompt binding to the client and does not pass through the assistant native-tool publisher. Native background notification/family navigation is not the same inline root tool row.

No fake assistant/tool records, imported artificial tool messages, or private publisher calls are recommended.

## CAP Comparison

The comparison below is against **ordinary native execution with a before hook and permission elevation**, not an imagined host transaction. A stronger wrapper/server-kernel design must explicitly repair each identified gap.

| Guarantee or failure | Current Issue #6 path | Candidate native path |
| --- | --- | --- |
| Trusted human input | Exact TUI callback claims frozen published object. | Can remain the same; synthetic/root prose must carry no authority. Server admission needs an explicit trusted transfer/ownership design. |
| No Implementer before Authorize | Root cannot delegate it; trusted import occurs only after claim/freshness checks. | Before hook can deny without creating a child. Permission-only unlocking cannot establish exact CAP admission. |
| Immutable candidate/exact scope | Private candidate digest and deterministic prompt. | Gate can compare all input fields to trusted candidate. Native permission resources alone bind only target role. |
| Root/HEAD/location/model | Repeated independent observations; explicit child model and readback. | Hook can observe them initially. Native awaits create drift windows; wrapper needs later revalidation and exact new root assistant/model evidence. |
| One-use / at most one child | Irreversible creation attempt with locally chosen ID; consume once before prompt. | Must reserve before any awaited validation and native body. Grant consumption alone after creation lets duplicate calls create multiple children. |
| Exactly one successful run | One exact trusted prompt if all barriers pass; failures may leave no run. | Can enforce at most one with added machinery; cannot force model to propose a call or guarantee native completion. |
| No retry/replacement after ambiguity | Creation/prompt flags remain spent even on lost response. | All hook/native/job/transport outcomes must burn reservation. Root provider retry or a new call ID must not reopen it. Host tool failure text can encourage retry. |
| Exact implementation input | Trusted caller sends byte-exact `implementerPrompt(candidate)` with predetermined prompt ID. | Exact tool argument still receives the native host prefix. Freeze the whole effective input if changing contracts; do not claim byte-equivalence. Native prompt ID is host-created, not caller-selected. |
| Final barrier adjacent to dispatch | Empty child/policy/publication verified, then synchronous checks/consume followed immediately by prompt invocation. | Before hook is too early. Awaited progress wrapper could restore a later pinned-host barrier, with additional failure/lifetime rules; no dedicated admission callback exists. |
| Stale Planner/publication/Git | Unchanged planning histories, pending publication, fresh observations required. | Retain immutable planning prefix and all freshness checks; root continuation changes inbox and history. Existing validators cannot simply be reused unchanged. |
| Policy/model drift | Loaded role/catalog and empty-child evidence rechecked before dispatch; registry events revoke. | Native resolves role/model and inherits parent state across awaits. Late wrapper checks/event invalidation needed; effective prompt/model evidence must be validated afterward. |
| Duplicate/multiple tool calls | Additional root calls invalidate; static Implementer denial prevents unauthorized creation. | Host forks distinct calls. One-use reservation rejects duplicates; a later duplicate can still terminate an already admitted attempt. Cannot know future calls at first admission without buffering/replacing streaming semantics. |
| Model alters arguments | Model does not choose implementation arguments. | Trusted before gate rejects mismatch. Record original input and guard later transforms/aliases. Never consume merely because target name matches. |
| Model refuses / emits another tool first | No new root model turn required. | May result in zero implementation. Deny unexpected calls and end claim; never rescue with automatic import or another resume using the same authorization. |
| Model emits Planner again | Root remains idle under trusted execution; unexpected root events invalidate. | Planner still has static host capability. New gate must reject it during continuation; do not rely on instruction ordering. |
| Ambiguous native execution | Separate trusted create/prompt observations and exact expected identities. | Parent stream, concurrent fibers, child job/progress, tool failure and notification add ambiguity. Native failure may expose child ID and recommend continuation; CAP must deny continuation/replacement. |
| Implementation result binding | Exact child/input/result rereads with no ambiguous prompt ID. | Bind root message/call, native child progress/result, exact prefixed child input and final, model evidence and terminal wrapper. Tool success is not trusted scope verification. |
| Git/HEAD/exact scope | `requireInScope` plus independent root/HEAD observations; shell-observation limits remain explicit. | Same Git checks and limits are required; native lifecycle adds no repository authority protection. |
| STOP before Reviewer / Commit | Trusted final status; no later role dispatch. | Root continues after tool result by design. Gate must deny all subsequent delegation/effects; root's final sentence is informational only. |
| Revocation/reload | TUI generation revokes synchronously; post-await checks prevent new local admission. No persisted grant/permission elevation. | Server-held state and durable overrides need a defined cutoff and failure behavior; asynchronous TUI revoke delivery is weaker than today's local cutoff. |

Native records improve observability and call/result correlation. They do not strengthen human authorization, freshness or scope. The new model turn introduces a liveness dependency, not necessarily an authority leak: refusal can safely yield no run. Malformed/duplicate calls are safe only when mechanically rejected before the body; cancellation after child creation is too late to establish the no-child guarantee.

## UX / OpenCode-Native Comparison

A successful genuine native foreground call buys the exact built-in inline Implementer row, clickable child navigation, running status from progress/child activity, persisted result metadata, and ordinary native job/cancellation behavior. These are real benefits at the correct transcript layer. The TUI would label the row from actual `authorized_implementer` input and the allowed description; role hiding does not prevent rendering.

The root also runs another model turn and normally continues after receiving the child result. Native subagent supports continuation, background conversion/notification and failure surfaces intended to help the model recover. CAP must constrain those ordinary behaviors rather than inherit their recovery semantics. “Foreground requested” is not alone evidence that no background job outcome occurred; terminal tool/job/result evidence must match the exact accepted contract.

The existing imported Implementer is already a real OpenCode child, with normal transcript and parent identity. A trusted contribution can navigate to its verified ID through `context.ui.router.navigate({type:"session",sessionID})` ([TUI Context](../../opencode/packages/plugin/src/tui/context.ts), `UI.router`). It can truthfully show creation/running/completed/failed status from current trusted ownership and observations without impersonating a root assistant tool call. Navigation must account for today's root-route invalidation: deliberately leaving the root can close authority, so new links must either open only when admission has ended or come with an explicit, bounded view-lifetime design.

## Simplification Assessment

No precise line-removal count is justified without an implementation, which this investigation intentionally does not provide. The concrete tradeoff is:

| Current machinery potentially removed | Native machinery added or retained |
| --- | --- |
| Constructed import request, caller-created child ID/time, import readback plumbing. | Server plugin registration and gate ownership; trusted TUI-to-server claim/revocation protocol. |
| Separate direct prompt call/response checks. | Native prompt-prefix contract, host-generated input identity, tool/progress/job result correlation. |
| Some custom status presentation. | Root continuation input/assistant evidence, permission elevation lifetime, inherited-child permission handling. |
| Imported-child navigation gap. | Hook/transform ordering, concurrent-call reservation, root retries/other-tool rejection, lifecycle failure handling. |
| Nothing from candidate/Git/policy/freshness guarantees. | Those checks remain and need placement at both pre-create and pre-prompt boundaries. |

`session.import` is experimental and its local empty-session use is deliberately narrow. Native subagent is ordinary host behavior, but the necessary CAP composition would rely on more APIs and on the exact internal sequencing of a public executor's progress callback. A public extension point is not automatically a stable verified-child admission contract. Permission overrides would weaken today's static defense and leave additional durable state to police.

Tests would expand from local TUI claim/create/prompt barriers to cross-runtime ownership, concurrent tool fibers, raw-input transforms, permission inheritance, progress-before-prompt blocking, provider retries, and root suffix validation. These should use test-scoped trusted doubles, not replicated real-Git fixtures; retain only the existing real-Git boundary coverage. Documentation would need to explain two authority owners and distinguish capability permission from the one-use grant, while still explaining native recovery that CAP rejects.

The model-proposed candidate is not a simplification under the current constraints. It moves direct trusted sequencing into a more complicated host lifecycle to obtain presentation.

## Recommended Architecture

Retain Issue #6 unchanged:

```text
native Planner -> trusted immutable Plan -> exact human Authorize
  -> trusted fresh empty authorized_implementer import
  -> verified child/policy/model/publication + final barrier
  -> consume -> exact prompt -> exact result / Git scope -> STOP
```

Implement Issue #8 later as a minimal trusted root-scoped status/navigation contribution associated with the verified child ID. Reuse the existing ownership/status surface and supported router. Keep the Orchestrator's Implementer delegation denied, leave the root model idle, and preserve the publication record as evidence. Label the UI as trusted implementation status, not a native assistant tool call.

This recommendation does **not** say OpenCode lacks a pre-execution gate or a root wake mechanism. It says the supported pieces do not compose into a smaller replacement with the current exact barriers and generation-local authority ownership. A larger server CAP redesign could explore them, but would need an explicit scope decision and proof of the lifetime/permission/progress invariants before being called CAP-compatible.

For a future host-native solution, useful upstream support would be either:

- A managed trusted native subagent invocation operation that creates authentic tool provenance/presentation without fabricated assistant messages, returns exact child/input identities, and exposes a verified-child admission barrier; or
- A dedicated before-create/before-prompt admission contract with call-scoped permission admission, exact trusted arguments, and a defined revocation/one-use boundary.

These are proposed upstream capabilities, not existing v2.0.21 APIs. No OpenCode core patch is recommended for Issue #8 in this run.

## Required Changes If Adopted

For the recommended presentation approach, likely changes are limited to:

- [.opencode/plugins/opencode-agents/tui.tsx](../.opencode/plugins/opencode-agents/tui.tsx): `presentation`, `ensurePresentation`, `showStatus`, decision settlement, and child-event handling; retain a verified presentation-only child ID and add accessible navigation with explicit route/lifetime behavior.
- [src/attempt.ts](../src/attempt.ts): only if the UI needs a small trusted result/presentation handoff beyond the existing `AttemptGuard.child`; do not alter authorization or creation/prompt barriers to obtain a link.
- Focused UI verification and [docs/v1-orchestration.md](v1-orchestration.md) once the UX is actually implemented. No role changes are needed.

If a native redesign is separately approved, the likely change inventory is substantially larger:

- New server plugin entry alongside the TUI entry, with `tool.execute.before`, an Effect `tool.transform` wrapper if preserving the progress barrier, and explicit RPC claim/revoke handling. No such project entry exists today.
- [src/cap.ts](../src/cap.ts): authority ownership, reservation versus consumption, revocation cutoff and process lifetime; no durable grant replay.
- [src/attempt.ts](../src/attempt.ts): `Bound`, `AttemptGuard`, `DecisionOwner`, `parentCalls`, `verifyParentPlanner`, `creationPolicy`, `childIdentity`, `verifiedChild`, `authorizePublishedAttempt`, and replacement of `executeBoundImplementation`; exact planning-prefix/continuation-suffix validation and host-generated prompt binding.
- TUI entry: `decide`, `closeAuthority`, cleanup/route invalidation, root/child event allowlists, publication delivery and server acknowledgment handling.
- [.opencode/agents/orchestrator.md](../.opencode/agents/orchestrator.md): continuation proposal instructions and a deliberately chosen permission design. Instructions remain liveness guidance; the server gate is authority. Do not simply add a permanent Implementer allow.
- [test/attempt.test.ts](../test/attempt.test.ts), [test/cap.test.ts](../test/cap.test.ts), and narrowly scoped native/server seam cases: duplicate calls, failure/ambiguity, permission inheritance/reload, before-prompt blocking, argument transforms and unrelated root tools.
- [docs/coding-authority-protocol.md](coding-authority-protocol.md), [docs/v1-orchestration.md](v1-orchestration.md), and affected runtime-boundary documentation if authority ownership changes. `proposal.ts` and production Git freshness/scope checks should remain the canonical boundaries.

This is a prospective file/symbol inventory, not an implementation plan authorized by this investigation.

## Live Validation Plan

No live validation was performed. For the recommended status/navigation layer, later dogfood needs one Authorize success showing the root status and verified child link, one Cancel showing no child, and navigation during/after admission proving the declared view-lifetime behavior. Verify STOP and no extra prompt/delegation. Use the pinned host and isolated ordinary local fixtures.

If native execution is later adopted, first prove the selected server seam with cheap trusted doubles, then perform the minimum pinned-host dogfood below. Do not use live attempts as a substitute for admission proof:

1. **Successful native lifecycle:** one fresh Planner, exact trusted publication/claim/control input, one root native Implementer call, one postauth child, expected permission policy/model, exact effective prefixed child input, native row while running and after restart/hydration, clickable child/back navigation, exact result and Git scope, STOP.
2. **Before-body rejection:** preauth and malformed calls with changed prompt/agent/description, extra keys, continuation, background and model override. Confirm zero child creation and zero child input/execution, not merely a visible error.
3. **One-use/concurrency:** two distinct calls emitted in one assistant response, a retry after error/lost response, and another tool/Planner call first. Confirm at most one child, no continuation/replacement, and no automatic fallback/resume on the old claim.
4. **Both admission boundaries:** force staleness/revocation/policy/model/Git change before the tool gate and between native creation and prompt. Confirm the final gate blocks child input; an inert postauth child on failure is acceptable, a replacement is not.
5. **Lifecycle/permissions:** TUI route departure/disposal, server/plugin reload, interruption, native background conversion and failure before/after progress. Confirm no stale server grant or persistent session permission can revive authority, and child permissions do not broaden delegation.
6. **Model liveness failure:** root declines to call or emits only prose. End safely with no implementation; do not repeat authorization implicitly.

Inject deterministic adversarial call sequences at a test/probe layer rather than expecting a model to produce them reliably. Any host ordering assumption used for CAP, especially progress-before-prompt, must be verified against the exact installed version and fail closed when it cannot be established.

## Final Classification

**CURRENT SESSION.IMPORT ARCHITECTURE SHOULD REMAIN**

- Trusted pre-execution native gate exists: **yes, in server Effect plugins; not in TUI plugin Context**.
- Trusted initiation/resume exists: **yes, synthetic inbox input can wake the root; model call production is not guaranteed**.
- Trusted direct callback invocation exists: **yes, server tool domain; no managed native root-row lifecycle API found**.
- Genuine native model call gets row/navigation automatically: **yes, from the assistant tool part and native child metadata**.
- Replace `session.import` for Issue #8: **no; retain CAP sequencing and add a small honest trusted presentation/navigation layer**.
