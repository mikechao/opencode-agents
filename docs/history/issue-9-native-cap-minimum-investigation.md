# Issue #9 Native CAP Minimum Investigation

## Executive Conclusion

CAP-gated native Implementer delegation is viable and architecturally simpler on OpenCode 2.0.21 **if admission uses a scoped server tool wrapper, rather than unlocking the root's session permissions**. Keep the Orchestrator's configured denial, let one trusted synthetic input solicit one proposal, and let a private server CAP consume the exact human claim before calling the original native executor inside the existing managed tool invocation. The wrapper supplies a private, narrowly permitted execution actor; it does not switch the root agent. To fail closed on restart, the Implementer role must also be server-scoped, with execution bound to the one admitted child, rather than remaining an always-loaded writable role. This removes import construction, empty-child verification, direct prompt dispatch, and custom Implementer lifecycle presentation. It adds a real TUI/server claim boundary and small scoped role/tool adapters. A before hook alone, an ordinary permission approval, or a temporary persisted session allow is insufficient. This recommendation changes the current authority lifetime and role hosting deliberately; it does not preserve the Issue #6 pipeline around a native child.

Static investigation, 2026-10-01. Project baseline verified as `72beab0d159d0aa5a5a88936e30ab72e1a2b78c8`, initially clean. Read-only upstream checkout verified as tag `v2.0.21`, commit `8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`, initially clean. [Issue #8](issue-8-cap-gated-native-implementer-investigation.md) supplies prior source evidence, not the architecture decision. The design below is a source-supported composition of public plugin APIs, not an implemented or live-validated feature. No OpenCode execution, Docker, tests, probes, GitHub writes, commits, or pushes were performed.

## Security Properties That Actually Matter

The controlling invariants are:

1. Only the direct trusted human Authorize callback can initiate a claim for implementation.
2. That claim binds the immutable proposal, exact ordered path array, canonical repository root, baseline HEAD, and the exact trusted Plan publication. A digest identifies these bytes; it cannot authorize anything.
3. Native input, synthetic text, session metadata, persisted transcripts, and model acknowledgments cannot mint, expand, or restore a claim.
4. One claim can release at most one exact native foreground Implementer invocation. Reservation happens before asynchronous validation; consumption happens before entering its native executor.
5. Extra arguments, another tool/target, another root/message/call, duplicate/retried calls, changed evidence, and concurrent contenders cannot reach implementation execution under that claim.
6. Once reservation, wake delivery, or native execution becomes ambiguous, there is no reset to available, replacement child, re-prompt, or new proposal opportunity under the same claim.
7. Native success is lifecycle evidence only. Trusted completion/child/result binding and independent unchanged-HEAD/exact-path verification determine the repository outcome.
8. Neither the root nor child gets Reviewer, Commit, session-control, or further delegation authority from this claim.

Current implementation-derived invariants that are **not** independently required include a locally chosen child ID and timestamp, imported zero token counters, two empty-child readbacks, a caller-selected child prompt ID, an unchanged idle root throughout implementation, publication remaining in the pending inbox forever, and authority remaining in the TUI after its positive decision. The minimum design preserves the immutable planning prefix and publication contents while permitting their native delivery and a precisely bounded execution suffix.

Freshness is checked at the trusted admission linearization point. CAP is not an atomic lock against arbitrary external filesystem changes throughout subsequent host execution; the current HTTP prompt path is not such a lock either. A later external change fails the result/Git gate and does not reopen authority. Installed host/plugin integrity and the local OS/user boundary remain the TCB described in [the CAP contract](../coding-authority-protocol.md). This design does not claim an adversarial shell sandbox or physical-human attestation.

## Current Architecture Cost

[src/attempt.ts](../../src/attempt.ts) has 584 lines, [src/cap.ts](../../src/cap.ts) 30, and the [TUI entry](../../.opencode/plugins/opencode-agents/tui.tsx) 412. Those counts include useful planning/publication logic and must not be interpreted as wholly removable. The 2,509-line [attempt test file](../../test/attempt.test.ts) mixes necessary CAP cases with import-specific cases.

The implementation path in `authorizePublishedAttempt` / `executeBoundImplementation` currently constructs an entire `SessionInfo`, mints `ses_…` and `msg_…` identifiers, initializes time/cost/tokens, imports an empty parented child, verifies its returned and reread identity, repeatedly verifies policy/catalog/root/Planner/publication and emptiness, consumes the grant adjacent to direct `session.prompt`, and validates that prompt's admission response. It then verifies exact result and Git scope. `AttemptGuard` and the TUI reconcile creation echoes, caller IDs, prompt enqueued/delivered events, and execution flags across those RPCs.

`creationPolicy`, `roleDiagnostic`, `implementerRules`, and `openCodeBrowserDeny` exist partly because a TUI importing a child must establish what server-loaded policy/model it is about to dispatch into. Browser suffix compatibility and timestamp normalization have already generated dedicated investigations and tests. These should not become requirements of a server-owned native path simply because they are present today.

The current child is a real session, but import never creates the root assistant `subagent` tool part. Hence custom status/navigation work is needed to obtain implementation presentation; native execution already has that presentation.

## Native OpenCode Execution Path

The exact relevant source path is:

```text
provider tool-call
  -> durable Tool.Called publication for root assistant/message/call
  -> concurrent local tool fiber
  -> tool.execute.before
  -> effective tool lookup / request alias lookup / schema decoding
  -> registered native subagent executor (through the proposed CAP wrapper)
       parent + depth + target-agent resolution
       Permission.assert(subagent, target-agent, execution actor)
       create fresh parented child
       awaited progress({sessionID, status: "running"})
       session.prompt(host prefix + exact input.prompt)
       native subagent job / foreground block
       native structured result + content + child metadata
  -> output normalization / tool.execute.after
  -> durable tool success/failure projection
  -> ordinary root follow-up and native TUI row/navigation
```

Source anchors, relative to this report:

| Evidence | Source |
| --- | --- |
| Calls are published before local execution; distinct calls fork concurrently | [runner/step.ts](../../../opencode/packages/core/src/session/runner/step.ts), `make`, especially lines 88–129 |
| Original call input and call IDs; duplicate identical IDs rejected within the publisher | [publish-llm-event.ts](../../../opencode/packages/core/src/session/runner/publish-llm-event.ts), `tool-call`, lines 458–474 |
| Before hook precedes lookup and decoding; after hooks can alter results | [tool.ts](../../../opencode/packages/core/src/tool.ts), `beforeExecute`, `snapshot.execute`, `executeTool` |
| Input decoding precedes registered executor; output validation follows it | [tool/runtime.ts](../../../opencode/packages/core/src/tool/runtime.ts), `execute`, `decodeInput` |
| Actual permission/create/progress/prompt/job/result sequence | [tool/plugin/subagent.ts](../../../opencode/packages/core/src/tool/plugin/subagent.ts), `Input`, `Plugin`, lines 109–265 |
| Children inherit parent location, metadata, permissions; host mints IDs | [session.ts](../../../opencode/packages/core/src/session.ts), `create`, lines 250–305 |
| Persisted assistant tool states | [message-updater.ts](../../../opencode/packages/core/src/session/message-updater.ts), tool event cases; [projector.ts](../../../opencode/packages/core/src/session/projector.ts) |
| Real row uses actual input and child metadata for navigation | [TUI session route](../../../opencode/packages/tui/src/routes/session/index.tsx), `Subagent`, lines 3106–3138 |
| Live progress/family tracking | [stream-v2.transport.ts](../../../opencode/packages/tui/src/mini/stream-v2.transport.ts), tool progress; [stream-v2.subagent.ts](../../../opencode/packages/tui/src/mini/stream-v2.subagent.ts) |

A genuine managed call supplies running/completed presentation, exact child navigation, terminal persisted hydration, and ordinary parent/child family behavior automatically. Calling a callback from an RPC does not: it bypasses the model publisher. The proposed wrapper instead runs **inside** the genuine model call's registered executor, preserving that publisher, progress callback, tool row, and source IDs.

One additional lifecycle fact must be included beyond Issue #8's comparison: [execution.ts](../../../opencode/packages/core/src/session/execution.ts), lines 76–139, records durable in-flight claims and intentionally retains them on shutdown. [execution/restart.ts](../../../opencode/packages/core/src/session/execution/restart.ts), `prepareResume` / `resumeSuspendedSessions`, resumes orphaned sessions with at-least-once semantics; [server/process.ts](../../../opencode/packages/server/src/process.ts) and [server/fetch.ts](../../../opencode/packages/server/src/fetch.ts) invoke that recovery. Foreground does **not** imply no restart continuation. This is why merely forgetting a root grant on restart is insufficient if the child retains an always-loaded writable role.

## Post-Authorize Root Continuation

Select `session.synthetic` with one trusted chosen input ID, exact control text, `delivery:"steer"`, and `resume:true`. It changes less semantic state than `session.prompt`: it records a synthetic input rather than manufacturing another user-authored request, and it does not switch root agent/model or alter permissions.

[Protocol `session.synthetic`](../../../opencode/packages/protocol/src/groups/session.ts), lines 453–472, accepts these fields. [Session.synthetic](../../../opencode/packages/core/src/session/session.ts), lines 274–313, durably enqueues the item and wakes execution unless `resume:false` or reverted. [Runner promotion](../../../opencode/packages/core/src/session/runner/llm.ts), `advanceToStep`, delivers eligible inbox inputs. [to-llm-message.ts](../../../opencode/packages/core/src/session/runner/to-llm-message.ts) turns synthetic text into provider user-role content, without its trusted metadata. Its text is therefore a call-proposal instruction, never authority.

Other supported choices are inferior here:

| Mechanism | Result |
| --- | --- |
| `session.prompt` | Also enqueues/wakes, but creates a user input and adds unnecessary user-request identity plumbing. |
| `session.inbox.update` / steer | Wakes an existing pending item; steering the Plan alone could save a control item, but mixes publication text with continuation instruction and provides no explicit control identity. |
| `session.interrupt({resume:true})` | Resumes eligible pending steering/control work after interruption, not a general permission-bearing wake. Introduces cancellation unnecessarily. |
| Internal `Session.resume` | Exposed as an internal core operation, not a general public TUI session-resume endpoint. Server plugins should use the public synthetic API here. |
| `session.command` | Command/subagent command execution has different provenance and does not supply the desired root assistant native call. |

The existing pending Plan will normally be delivered with the control input. Trusted evidence must establish: the exact original root/planning transcript prefix; unchanged Planner result/history; the exact publication now delivered once with unchanged payload; the exact control ID/text delivered once after publication; no unrelated user/synthetic/control input; unchanged root identity/location; and one first primary root request after that delivery. The gate obtains the assistant message and call IDs from actual tool execution, then rereads their published transcript input. Neither control metadata nor a model-echoed token is sufficient.

There is no public `synthetic(maxTurns:1)` transaction. Bound the **proposal opportunity** with server state: only the first primary request after this exact delivery can propose an implementation call. A `session.context` hook recognizes the expected delivered inputs; a later primary request while still available/reserved closes admission. The real call must belong to the sole new proposal assistant message. Disable root retry decisions through the public `session.retry` hook; reject retry/compaction/restart suffixes at the gate rather than attempting recovery. There is no automatic second wake on a lost synthetic response. A persisted control item delivered after restart has zero CAP authority.

Reasoning or prose before the call in that same response is harmless. A different tool first closes the attempt. An entirely prose/refusal response ends with zero implementation and closes availability at root settlement; a subsequent request is independently ineligible even if event observation is delayed. Distinct calls can appear in one assistant response and run concurrently; the one-use gate, not an instruction, limits them. Native post-result prose is a separate harmless conversational step, addressed below.

## Implementer Capability Admission

The selected mechanism is a **public `tool.transform` wrapper around the original native executor, backed by a private scoped permission actor**, with `tool.execute.before` providing early raw-call rejection/reservation. It avoids both a root agent transition and a session permission write.

The critical permissions ordering is [permission.ts](../../../opencode/packages/core/src/permission.ts), `configured` / `evaluateInput` / `assert`, lines 158–188 and 231–263:

```text
agent rules + session overrides
  -> configured deny returns immediately
  -> saved allowances
  -> permission.evaluate hooks
  -> allow / deny / ordinary ask
```

Thus `permission.evaluate` cannot elevate the configured Orchestrator denial. However, the native executor explicitly passes **`context.agent`** to `Permission.assert`; it separately uses **`context.sessionID`** to read the real parent and create the child. Public [Tool.Context / Tool.Info](../../../opencode/packages/schema/src/tool.ts) expose both fields and the executor callback. Public [ToolEditor.update](../../../opencode/packages/plugin/src/effect/tool.ts) permits wrapping that callback. Public [AgentEditor.update](../../../opencode/packages/plugin/src/effect/agent.ts) can create a previously absent role: [agent.ts](../../../opencode/packages/core/src/agent.ts), lines 73–85, initializes absent IDs before applying the update.

The trusted wrapper can therefore do this, conceptually, without importing private core services:

```text
validate actual Orchestrator context + exact reserved call
validate final decoded input + frozen evidence
consume CAP irreversibly
call originalExecute(exactInput, {
  ...actualContext,
  agent: privateScopedAdmissionActorID
})
```

That actor is a plugin-generation-specific hidden, nonselectable subagent definition with deny-all and **only** `subagent:authorized_implementer=allow`. No session ever runs its model. Its ID is never sent to the model; knowing it cannot override a call's host-supplied Context. Root message, call, parent, and progress identities remain the real Orchestrator's. The permission actor intentionally differs from the transcript actor; record that distinction in trusted diagnostics. Do not borrow the broad built-in `build` actor or use an undocumented Effect service override.

The native tool remains available to the root because Planner is allowed; per-target denial does not remove the whole tool. The available-agent description can omit the hidden Implementer, but execution still resolves an explicitly named hidden subagent. The synthetic instruction can therefore name the intended target without changing the root's tool inventory or granting it permission.

This is a trusted executor adapter, not a stock permission hook overriding denial. The original native body still performs its own permission/depth/target checks, creates/prompts the child, runs the job, and returns its native result. Directly invoking the original callback **inside this managed invocation** preserves native provenance; invoking it from a separate RPC would not.

Install the scoped actor and Implementer definitions while reserved, after the human claim and raw-call validation but before the final barrier. Consuming and calling the original executor then requires no intervening role-registration await.

| Candidate | Supported / before child? / full input? | Can pass current denial? | Lifetime, failure, and decision |
| --- | --- | --- | --- |
| `tool.execute.before` alone | Yes; awaited; full unknown JSON before body/decoding; typed `Tool.Error` rejection | No | Essential early veto; no permission elevation or authority persistence. |
| `permission.evaluate` alone | Yes; before create; action/resources/source IDs, not complete arguments | No | Cannot replace configured deny. No grant primitive. |
| Session override via `session.update` | Yes; native assertion rereads it; does not bind full arguments | Yes | Durable, inherited by child, not call-scoped, no expiration/CAS/consume. Crash/reload can retain it. Reject. |
| Ordinary permission `once` | Yes for an existing ask; not full candidate/input | No against configured deny | Generic permission UX is not the CAP human claim. `always` can persist allowances. Reject as CAP admission. |
| Static ask/allow plus hook | Supported; gate has full input | Requires changing root rules | Missing/unloaded gate falls back to ordinary ask/allow. Permanent capability relaxation is unnecessary. Reject. |
| Persisted root `switchAgent` | Supported; new role can allow | Yes via another role | Durable role change and changed root behavior; no automatic one-call lifetime. Reject. |
| Scoped root agent transform plus gate | Supported, non-durable registry changes | Yes while transformed | Globally alters that role's permissions and requires careful teardown/snapshot handling. Broader than a wrapper-local actor; not selected. |
| Input repair/alias alone | Supported | No | Cannot overcome actor denial, and silently repairing a different operation is inappropriate. |
| Selected native executor wrapper + scoped actor | Public API; final input validation before original body; original permission still runs before create | Yes, with an explicit trusted execution actor; root denial remains | No root/session elevation; actor exists only in plugin scope; live closure and consumed tuple gate every invocation. |
| Dedicated native CAP callback / call-scoped permission override | No such API found | Would be useful | Not required for the scoped-actor composition; do not claim it already exists. |

All plugin callbacks are trusted code. [PluginHooks.trigger](../../../opencode/packages/core/src/plugin/hooks.ts) awaits them in registration order; there is no special final CAP priority. Use the Effect plugin form for typed before-hook failure. A rejected Promise adapter callback is a defect, not the same ordinary failed-tool settlement.

**Fail-closed role hosting is part of the choice.** Move the writable `authorized_implementer` definition out of its always-loaded Markdown agent file into the server integration. Register its fixed installed policy/system and frozen selected model only for the live consumed invocation; remove it on completion/failure/teardown. Before auth, on server restart, or when the server plugin is absent, the target role is absent and the root still denies it. A scoped context/tool gate accepts this role only for the child ID captured by the native progress callback. Old children cannot gain access when a later attempt temporarily registers the same target name.

[State transforms](../../../opencode/packages/core/src/state.ts) are scoped and rebuild synchronously on invalidation; they are not persisted session permissions. [Plugin loading/teardown](../../../opencode/packages/core/src/plugin.ts) closes scopes and removes transforms. Register a finalizer that closes the private epoch before other disposal. Old tool snapshots retain a wrapper referencing that closed epoch and reject; unwrapped new snapshots face the root's unchanged denial. An already consumed invocation that crossed admission may have started before teardown; its outcome is ambiguous and never permits another admission. Teardown cannot retroactively undo an executed shell operation.

## Exact Native Call Contract

The only admitted model proposal is:

```ts
{
  agent: "authorized_implementer",
  description: "Implement the authorized plan",
  prompt: implementerPrompt(frozenCandidate)
}
```

Require a plain JSON object with exactly those three own keys and exact string values. Reject any `sessionID`, `background`, or `model` key, including `null`, empty string, and `false`. Reject every extra property. Description is the fixed four-word title/row label; the host describes it as a 3–5 word label but its schema only enforces string type. It must not carry another task or scope.

Keep [the existing deterministic `implementerPrompt`](../../src/attempt.ts) byte contract: its fixed instruction lines, bound canonical root and HEAD, and `JSON.stringify(candidate.proposal)` in preserved property/file order, joined by LF. Do not trim, paraphrase, reorder, normalize Unicode, or accept a hash in place of the full prompt. The admitted fresh child's initial text is exactly:

```text
"You are a subagent spawned by another session.\n" + implementerPrompt(candidate)
```

The native [Input schema](../../../opencode/packages/core/src/tool/plugin/subagent.ts), lines 29–48, has required `agent`, `description`, `prompt` and optional `model`, `sessionID`, `background`. It does not authorize the extras. Canonical tool name is `subagent`, registered direct with `codemode:false`. Reject aliases, `execute`/CodeMode, tool-name rewrites, and alternative subagent tools for this attempt.

Two ordering details prevent a falsely exact contract:

- Native `execute.before` normalization can delete empty `model` / `sessionID` before a later CAP before hook sees them. The **already published original root tool input** must also pass the exact-own-key check; checking only the hook's current input would incorrectly accept those keys.
- Later before hooks can mutate input/tool names, and decoding can strip unknown properties. The transformed native tool must use a strict validation adapter **before the original schema decoder** for Implementer-target inputs, followed by an executor comparison with the stored exact input/context. Do not rely solely on comparing the decoded three fields. The input codec has no execution Context: identify the Implementer target from the raw input there, and perform root/message/call checks in the executor. Delegate to the original public `Info.input` after strict validation; preserve its ordinary behavior for other targets. A reserved call mutated to another target still fails the executor's exact comparison.

Tool snapshots resolve request aliases after the before hook. Require agreement between the published original canonical name, the effective hook name, and the wrapped native executor identity. A different executor cannot use the reserved tuple. The native host prefix is added inside the body after CAP validation. [SessionPrompt.prepare](../../../opencode/packages/core/src/session/prompt.ts) also runs mutable `session.prompt` hooks before admission. The supported installation must retain a known trusted hook/transform composition that does not rewrite this child's prompt, attachments, role, or executor after validation. No public hook guarantees precedence over arbitrary later trusted plugins; compromised or deliberately hostile trusted plugins are outside CAP. Independently verify the admitted child bytes/result, and fail closed on unknown/drifting composition rather than attempt to support arbitrary prompt rewriting.

## One-Use and Concurrency Design

Use one private server activation slot, not durable WorkflowState or a worker registry. It contains the frozen claim/evidence, continuation ID, first proposal-request marker, exact reserved `(rootID,messageID,callID)` and input, optional captured native child ID, and a closed epoch flag. The authority states are:

| State | Meaning / transition |
| --- | --- |
| `available` | A positive trusted claim has been accepted and its single root control input may solicit the first proposal. No implementation has been released. |
| `reserved` | The first root tool contender synchronously occupies the slot before any await. Exact raw-call/evidence validation is in progress. Any failure goes to closed. |
| `consumed` | The final wrapper has irreversibly released the exact original native executor. There is no second reservation or release, even if no child was actually created. Child/result observations are receipts, not new authority. |
| `closed` | No admission is possible. Rejection, refusal, staleness, retry, interruption, failed/ambiguous wake, teardown, and terminal outcome never restore availability. |

Only the reservation owner can release its native body. Losing concurrent contenders receive rejection and cannot acquire, reset, or transfer the slot; owner validation failure burns the reservation. A late duplicate cannot make an already consumed invocation unconsumed.

While consumed, ordinary tools inside the exact admitted child belong to its one native implementation run. A small child-context/tool membership check rejects other `authorized_implementer` sessions and further delegation/session-control. It does not schedule the child's work or count its editing/testing steps. Preserve the host's native foreground job.

| Event | Mechanical behavior |
| --- | --- |
| Two valid distinct calls in one assistant response | First hook entry reserves; second cannot reserve and is rejected before its body. At most one native child. There is no retroactive requirement to undo a first admission when a later streamed call appears. |
| Valid plus malformed | If malformed arrives first, it closes without child creation. If valid already reserved/consumed, malformed is rejected and never obtains a second admission. A bad later call cannot unconsume the first. |
| New call ID retry | Rejected because the slot is already reserved/consumed/closed, or belongs to a later request. |
| Same call ID replay | Host publisher already rejects duplicates within its step; CAP independently rejects reuse. Never treat matching IDs as an idempotent execute request. |
| Planner or another tool first | Reserve/close and reject during the authorization continuation, despite Planner's static permission. No fallback delegation. |
| Prose/reasoning before exact call | Allowed in that same first proposal response; neither consumes nor grants authority. |
| Only prose/refusal | Close with zero implementation; no second control input. |
| Failure before native child creation | Consumed/closed once body entry was released. Do not prove “nothing happened” and reopen it. |
| Failure after child creation / prompt | Child may remain or have edited. Close; no prompt replay, child adoption, continuation, or replacement. |
| Lost tool result or RPC transport | Outcome unknown; hold only diagnostics/receipts. No authority recreation from native persisted output. |
| Root interruption/restart or unexpected input | Close proposal eligibility. Native transcript/control recovery cannot recreate the private server slot. |
| Server/plugin teardown | Close epoch first; remove scoped roles; no grant/role recovery from storage. Orphan child recovery cannot acquire the missing role. |
| TUI failure during transfer | Before server acceptance, no server claim. After acceptance, the already clicked exact claim belongs to the server until admission/closure; no duplicate resend from the TUI. See boundary semantics below. |
| Foreground converted to background | Never count a running/background result as success. Close, best-effort interrupt the captured child with `resume:false`, and deny further authority. No replacement. |

Disable provider retry decisions for the proposal opportunity and for an implementation whose execution has failed ambiguously. Ordinary child multi-step tool use is one admitted run, not a new CAP admission. At-least-once **restart recovery** is different: it must not resume implementation authority from durable execution claims. Role absence plus exact-child context gating supplies that distinction without maintaining CAP recovery state.

## Minimum Pre-Execution Barrier

Immediately before releasing the native executor, require:

1. Live server epoch, exact reserved tuple, positive claim provenance, and intact candidate encoding/digest.
2. Exact original and final call contract; the genuine canonical managed root call; the expected first proposal request/message and exact delivered control/publication.
3. Original root identity, canonical local location, unchanged planning prefix/Planner result/publication contents, and no new conflicting input, revert, move, role switch, or session permission override.
4. Independently fresh canonical Git root, unchanged bound HEAD, clean ordinary staged/unstaged/untracked baseline, and exact path validity. Perform synchronous final Git/local checks after the awaited evidence reads, then consume/release without another plugin-side await.
5. The installed native executor/codec composition and trusted role policy; a frozen explicit supported model; the private actor's narrow permission; no root session permission elevation.

Native child creation then needs **no second empty-child/pre-prompt verification pipeline**. Omitting `sessionID` mechanically selects host fresh creation; the original native body supplies parentage, target, location inheritance, and exact initial prefix/prompt. Consumption authorizes this bounded native invocation, rather than a later direct prompt RPC. The progress wrapper captures its new child ID and forwards native progress; it is a binding receipt, not a hidden second authorization barrier.

This is sufficient under the minimum contract's admission-time freshness semantics. Moving the same full read barrier into `progress` would mostly recreate the import architecture and still would not make arbitrary external Git changes transactional. An upstream verified-child admission callback would be needed only if the product separately required that stronger intervening observation, which this RFC does not.

Policy/model handling must remain precise without reproducing loaded-policy fingerprint compatibility: server code owns the bounded Implementer role and pins its model to the trusted root-selected model/variant for this invocation. Native selection `input.model ?? target.model ?? parent.model` then takes the pinned target model; model input is forbidden. Relevant trusted registry/config changes close a not-yet-consumed attempt; fixed scoped definitions prevent ordinary parent-model drift from silently broadening the child. Native target resolution verifies existence/subagent mode, **not** the required bounded tool policy, so resolution alone is insufficient. Availability failure is a failure, never permission to choose another model. Check actual child execution model afterward.

Delete caller time/cost/token initialization, empty transcript/inbox readbacks, caller/import echo equality, zero-state assertions, and direct prompt admission response checks. Retain the initial clean-before-planning evidence, candidate integrity, one-use boundary, actual native child/result binding, and independent post-run Git verification. Event observation helps close promptly; it cannot substitute for the gate's independent reads.

## Root Post-Tool Behavior

Allow normal final prose after the admitted native result. It is informational and has no repository authority. An updated Orchestrator instruction can require `Implementation attempt finished; trusted verification determines the result. STOP before Reviewer / Commit.` Trusted status must separately report whether verification passed or failed.

During consumed/closed state, reject **all subsequent root tools for this attempt**, including Planner, another Implementer, Reviewer, Commit, and session controls. Remove root tool definitions in the follow-up context as a convenience, while retaining the execution gate for already prepared/requested calls. Static Orchestrator deny-all except Planner remains defense in depth when the server plugin is unavailable; Planner remains read-only and cannot promote its result into another claim.

No immediate interrupt is necessary on ordinary native completion. Interrupt only to settle refusal/error/unexpected continuation, or to stop a background/ambiguous attempt. Interrupt is not the CAP admission primitive. Do not delay closing the one-use authority until final prose appears, and do not trust the fixed sentence as evidence that Reviewer/Commit did not run.

## Post-Run Result and Git Verification

Bind the execution with three independent sources:

- The server receipt for the exact released root `(session,message,call)` and immutable admitted input.
- The original executor's awaited progress and terminal structured result. Capture exactly one `sessionID`; terminal `{sessionID,status:"completed",output}` and metadata must agree with it. Reject missing/replaced IDs, background `status:"running"`, error/cancellation, or a transport-ambiguous outcome.
- Host rereads of the actual root tool part and child session/history/inbox. Require exact parent/role/location/model, the sole initial user input with the native-prefixed prompt, no extra input/steering/reuse, successful settled execution, and a final assistant result matching the native output/content wrapper. Bind the host-created input/final message IDs from these reads; never mint or substitute them locally.

The wrapper sees the original result before mutable after hooks; reconcile it with the persisted tool part after those hooks. A forged/different after-hook result cannot be accepted merely because it has the right child ID. Root post-tool prose may follow, so bind the specific tool part rather than requiring the whole root transcript to remain frozen forever. Preserve the immutable planning prefix and reject authority-bearing/unexpected suffixes.

The host's subagent job selects an assistant from a limited descending message window and can return `Subagent completed without a text response.` See [subagent-job.ts](../../../opencode/packages/core/src/session/subagent-job.ts) and [subagent-completion.ts](../../../opencode/packages/core/src/session/subagent-completion.ts). Neither a completed wrapper nor that fallback proves the exact successful child history. The existing Planner call/result helpers illustrate the necessary independent correlation; generalize only the concrete shared binding, not a worker registry.

After completion, use the existing [Git boundary](../../src/git.ts), `observeGit` / `requireInScope`, to reread canonical root and HEAD and derive the union of staged, unstaged tracked, and ordinary untracked paths. Require exact membership in the authorized array, including unrelated concurrent deltas; ignore only the existing ordinary ignored-untracked category. Both rename endpoints must be authorized when observable. Freeze result evidence across later awaited reads and finish with fresh Git/local checks. No native tool status can skip this gate or authorize Reviewer/Commit.

## TUI / Server Authority Boundary

A transfer is required: the [TUI Context](../../../opencode/packages/plugin/src/tui/context.ts) has client/data/UI/storage, not server tool/permission hooks. The actual supported channel is plugin `rpc.register` plus TUI `client.rpc.call`: [Effect RPC API](../../../opencode/packages/plugin/src/effect/rpc.ts), [core RPC](../../../opencode/packages/core/src/rpc.ts), and [HTTP RPC route](../../../opencode/packages/protocol/src/groups/rpc.ts). It is not shared TUI memory and not a model-visible synthetic grant.

Use one server-generation enrollment and one exact claim, with these concrete messages:

1. **Enroll during trusted TUI activation, before the governed root is created.** Server returns an unpredictable activation-private bearer handle and server epoch, retaining its own initial Git observation and completion boundary. Store the handle/epoch only in the TUI closure and server slot. Enrollment is one-shot per server plugin activation; no second/replacement handle, no public lookup/reissue, no storage/session/event emission of the secret. The server records subsequent root creation evidence and uses its original observation for clean-before-planning eligibility; an already existing root cannot be rebound after restart.
2. **Authorize once from the claimed button callback.** Send `{epoch, handle, rootID, publicationID, candidateEncoding, candidateDigest, boundPlanningEvidence, controlID}`. Include exact proposal/scope/root/HEAD through the encoding and initial clean/location/creation evidence through the binding. The server independently recomputes the candidate and rebinds the publication/native Planner/root facts. A `true` Boolean or digest alone is not a claim. Atomically occupy the only claim slot before awaits. Then admit its one synthetic root control input. Return an acknowledgment/attempt identifier containing no new authority.
3. **Cancel/revoke/status.** Cancel before authorization sends no claim. A revoke uses the same private handle and exact attempt identity; server closure is irreversible. Status can expose non-authoritative receipt/outcome data. Neither duplicate Authorize nor a lost response resends/reopens/wakes. There is no durable grant recovery.

Authentication here means possession of an activation-private handle obtained over the trusted local client channel, not authentication of a physical human by RPC. The inspected `RpcCallContext` supplies error handling, **not a TUI principal or per-connection identity**. HTTP authentication is server access authentication, not CAP attestation: [server authorization middleware](../../../opencode/packages/server/src/middleware/authorization.ts) allows unauthenticated operation when no password is configured. Do not describe a publicly callable `authorize(root,digest,true)` method as secure.

The enrollment assumption is the existing ordinary local TCB/client boundary: trusted TUI setup obtains the handle before any governed mutable model execution; Orchestrator/Planner deny shell, `execute`, RPC/equivalent tools, and session control. RPC is not automatically registered as a model tool. The one enrollment and consumed slot prevent an admitted child's ordinary shell capability from enrolling again or reviving its old attempt. Secrets never enter prompts/transcripts/repository files. Arbitrary hostile same-user clients, or adversarial shell access to host internals, require an upstream authenticated UI channel and stronger OS isolation; that is outside the current CAP shell/TCB contract, not a property provided by this RPC API. If that stronger threat model is desired, this recommendation must change.

**Ownership changes at server claim acceptance.** Before that, the TUI's local positive claim and generation guards apply. After that, the server owns the one already human-authorized attempt; root route changes or TUI disappearance do not instantly revoke an accepted server grant. An explicit revoke takes effect when the server synchronously closes its slot, acknowledged over RPC. A call consumed before that boundary may run; a call after it cannot. Do not promise synchronous remote revocation on local TUI cleanup. This removes an implementation-derived TUI-view lifetime requirement rather than silently weakening one of the eight controlling properties.

On TUI failure before acceptance, no server authority is established. On lost acknowledgment after acceptance, at most that one authorized attempt may proceed; TUI reports uncertainty and never retries. On server/plugin restart, the private epoch/handle/slot and scoped roles disappear; old inputs/results cannot rebuild them. Reloaded TUI cannot recover a previous handle. A later attempt needs fresh activation/root evidence, a new trusted Plan, and a new explicit decision. No heartbeat lease or durable workflow is needed.

## Machinery Removed

These removals are prospective; this investigation changes none of them.

| Current file/symbol/state | Removal / native replacement |
| --- | --- |
| `src/attempt.ts::executeBoundImplementation` import request and `SessionInfo` initialization | Remove. Original native `subagent` creates the fresh real child with host ID, timestamps, parent/location/family projection. |
| Locally minted `ses_…`, `initializedAt`, `zeroTokens`; imported event time normalization | Remove. Host child identity comes from native progress/result and host records. |
| `childIdentity(..., emptyState)` / empty branch of `verifiedChild` | Remove pre-run empty-child verification. No caller import/dispatch gap remains; preserve a smaller settled native identity/history verifier. |
| `childCreatedMatches` and TUI `childEcho` | Remove import echo/readback reconciliation. Bind actual native progress and terminal child ID. |
| `AttemptGuard.creationAttempted`, `creationReturned`, caller `prompt`, `dispatched` | Remove split import/prompt ownership. Replace with one reserved/consumed call and native child receipt; consumed covers all ambiguity. |
| Direct `context.client.session.prompt` and returned admission checks | Remove. Original native executor admits its prefixed prompt; verify actual child input afterward. |
| Repeated post-import `creationPolicy`/root/Planner/empty-child barriers | Remove. One final native call barrier, fixed server-owned scoped roles/model, and post-run independent verification. |
| `creationPolicy`, `roleDiagnostic`, `diagnosticScalar`, `diagnosticFields`, browser-suffix compatibility | Replace TUI-side pre-import loaded-role fingerprinting with trusted server role construction and known native composition. Host browser deny remains a normal host restriction; no custom suffix whitelist is needed solely to import a child. |
| `supportedTopology`'s import-specific `workspaceID` rejection | Remove that API limitation. Native create inherits location/workspace. Retain ordinary local Git correspondence; accepting workspace support still requires evidence of local mapping, not merely removing the guard. |
| TUI `promptEnqueued`, `promptDelivered`, `executionStarted`, `executionSucceeded` and child event sequence imitation | Remove custom Implementer lifecycle reconciliation. Native tool row/job/child records supply lifecycle; retain only CAP invalidation and trusted outcome display. |
| Root must stay idle; whole-root-history equality after decision; inbox must remain `[publication]` forever | Replace with immutable planning prefix + exact delivered publication/control + bounded native suffix. |
| Root-route restriction throughout imported-child admission, `decidingFrame` for that restriction | Remove after server transfer. Root view/readable frame remains necessary to claim the human decision, not to preserve server-owned authority. |
| Proposed custom inline Implementer status/navigation work from Issue #8 | Unnecessary. Native root tool part gives the real row and exact child navigation/hydration. Keep trusted Plan and Git-verdict surfaces. |
| Always-loaded `.opencode/agents/authorized_implementer.md` writable role | Move definition into scoped server hosting. No restart authority from the persisted child agent name. Preserve its bounded instructions/permissions as installed policy. |
| Import-only portions of `test/attempt.test.ts` | Remove exact import request/time/zero-state tests, empty-child/readback mismatch matrix, import collision/lost response distinctions, prompt admission RPC substitution tests, browser-suffix tests, and pre-import workspace rejection tests. Native admission/ambiguity/result tests replace behaviors that still matter. |
| Import sequencing in `docs/coding-authority-protocol.md` and `docs/v1-orchestration.md` | Rewrite around exact human claim and native admission. Keep historical investigation reports as history, rather than deleting source evidence. |

Keep `src/proposal.ts`, `src/git.ts`, trusted Plan rendering/frame/click checks, initial eligibility, immutable native Planner binding, and the independent result/scope verdict. They are not import machinery.

## Machinery Added

The minimum additions are:

- One Effect server entry, `.opencode/plugins/opencode-agents/server.ts`, using the supported directory server entrypoint resolution in [plugin Host](../../../opencode/packages/plugin/src/host.ts) / [core module loader](../../../opencode/packages/core/src/plugin/module.ts). No new server service or private core import.
- One activation-private slot/epoch, bearer enrollment, exact claim/revoke/status RPC definition, and one synthetic continuation expectation. No stored grants, reissue endpoint, WorkflowState, attempt counter, or recovery engine.
- A before-hook reservation/veto, strict raw schema adapter, and final native-executor wrapper. Preserve original executor/output/progress rather than reimplement them.
- Scoped narrow admission actor plus scoped installed Implementer role with frozen model. Exact-child context/tool membership checks prevent old-session/restart execution. These are authority lifetime controls, not worker orchestration.
- Root primary-request eligibility and retry rejection; harmless final-prose handling; native progress/result receipts and independent settled transcript/Git verification.
- Focused trusted-double cases for cross-runtime claims, exact/raw/normalized call input, concurrency/replay, teardown with old snapshots, orphan-child/new-epoch denial, and native result binding. Real Git tests remain limited to actual Git semantics.

The private actor and scoped Implementer role are essential additions. A proposal that omits them and just installs `tool.execute.before` has not answered the permission and restart seams.

## Complexity Comparison

| Dimension | Current imported child | Selected native candidate |
| --- | --- | --- |
| Human/candidate authority | TUI-owned exact local decision/grant | Same decision; exact one-shot authenticated-handle transfer to server |
| Capability admission | Trusted import/direct prompt; root denies target | Root still denies target; trusted wrapper consumes then sponsors one native call |
| Trusted state | Grant plus local child/import/prompt identities, echoes, dispatch/ambiguity flags | One slot/epoch/handle, control expectation, reserved call, captured child/result |
| Runtime boundaries | TUI reads server policy/state and orchestrates create/readbacks/prompt/result | TUI transfers decision; server gate owns native call; TUI receives verdict |
| Async authority transitions | Decision, import, multiple empty-child barriers, prompt admission | Decision transfer, one synthetic wake, one native call release; result verification grants nothing |
| Lifecycle/presentation | Custom import/prompt/event sequencing and separate status/navigation | Original host create/prompt/job/progress/result/row/navigation |
| Model dependence | No new root proposal needed | Exact proposal required; refusal/mismatch safely yields zero implementation |
| Permissions | Explicit empty import overrides; repeated loaded policy compatibility checks | No root/session overrides; scoped narrow actor and fixed scoped child role |
| Concurrency | Trusted caller serializes create/prompt | Host concurrent calls remain native; one synchronous reservation selects at most one |
| Ambiguity | Separate uncertain create and prompt states, no replacement | Single consumed invocation, no replacement; no CAP revival on host restart |
| Validation | Import/time/emptiness/response matrix plus core CAP/Git tests | Raw/native-call, claim transfer, role scope/restart, concurrency and result tests; core CAP/Git retained |
| Version sensitivity | Experimental `session.import`, projection/default normalization | Public tool/agent/RPC hooks plus pinned executor use of Context.actor/progress/prefix; still requires version audit |
| UX | Real family child without authentic root Implementer tool row | Genuine row, live lifecycle, exact navigation and persisted completed hydration |

A defensible source-level estimate is removal/replacement of roughly 200–300 lines of import/policy/child-dispatch code and 40–80 lines of custom child reconciliation, while adding roughly 200–300 lines of server CAP/role/tool/RPC glue and smaller TUI handoff changes. These are architectural estimates, not a measured patch or a promised net line reduction. Existing useful Planner/Plan/Git code remains. Test line counts cannot be inferred from runtime line counts.

The simplification is substantive even if executable line totals are close: custom creation and prompt ownership, intervening empty-child validation, import projection compatibility, and custom lifecycle presentation disappear. The remaining state decides whether one native invocation is authorized and verifies its outcome. It does not drive child creation, scheduling, completion, retries, family relationships, or tool rows. The new cross-runtime claim and scoped roles are a real cost, explicitly accepted; they avoid durable permission elevation and CAP recovery machinery. This meets the decision standard through a narrower authority layer aligned with native orchestration, not merely a nicer row.

## Recommended Architecture

Adopt this minimum design for a later implementation:

```text
trusted TUI activation -> one private server enrollment
User -> native Orchestrator/Planner -> trusted frozen Plan
human Authorize -> exact one-shot server claim
server -> one synthetic root control input
root -> genuine native subagent proposal
before hook -> reserve and reject unexpected/raw input
strict native-tool wrapper -> final evidence/Git checks -> consume
  -> original executor with private scoped permission actor
OpenCode -> fresh child / prefixed prompt / foreground lifecycle / native row
trusted native receipt + child/result reread + independent HEAD/path gate
root may finish with prose; no further authority-bearing tools
STOP before Reviewer / Commit
```

Keep the root's static denial. Host the writable Implementer role only in the live server invocation. Define server ownership/revocation at the acknowledged server boundary, not the old TUI route lifetime. Treat root proposal refusal and all ambiguous outcomes as terminal for that authorization. Suppress background/reuse/model overrides, subsequent root delegation, child delegation/session controls, and CAP revival through provider/native recovery suggestions.

The design requires no upstream patch under the existing local TCB threat model. An upstream call-scoped sponsorship API would make the actor adapter more explicit, and an authenticated TUI-origin channel would support a stronger client threat model; neither is an existing 2.0.21 facility. If the project refuses scoped server role hosting or insists on synchronous TUI-local revocation after transfer, this native design is not viable as written. Do not replace those decisions with session permission elevation or an unauthenticated claim Boolean.

## Implementation Target Files

For a separately authorized implementation, likely targets are:

- `.opencode/plugins/opencode-agents/server.ts` — new Effect entry: private epoch/RPC, scoped role transforms, native tool adapter/gate, continuation/child membership, terminal verification.
- `src/cap.ts` — replace TUI-only consumption semantics with the private server one-use state/tuple and irreversible closure; retain candidate-purpose binding.
- `src/attempt.ts` — retain `implementerPrompt`, `bindNativeAttempt`, publication/candidate helpers; replace `verifyParentPlanner`'s whole-root/pending-only contract with the concrete prefix/suffix checks; remove/replace `executeBoundImplementation`, `creationPolicy`, `childIdentity`, `childCreatedMatches`, `verifiedChild`, `supportedTopology`, and import guard fields as described above. Share only concrete non-UI verification between entries.
- `.opencode/plugins/opencode-agents/tui.tsx` — `decide`, `closeAuthority`, `terminate`, cleanup, and imported-child event flags become exact one-shot claim/revoke/receipt handling; preserve trusted Plan presentation and readable-frame checks.
- `.opencode/agents/orchestrator.md` — add the exact postauth proposal/final-prose instructions; retain configured deny-all except Planner.
- `.opencode/agents/authorized_implementer.md` — move its bounded installed policy/system into server-scoped role hosting; no always-loaded writable fallback. Planner remains native/read-only.
- `test/cap.test.ts`, `test/attempt.test.ts`, and a small focused server/native-admission test file — trusted doubles for claims, concurrency, before/after normalization, actor scope, restart denial and native receipts. Keep `test/git.test.ts` as the production Git boundary coverage; do not multiply real repositories.
- `docs/coding-authority-protocol.md`, `docs/v1-orchestration.md`, and the docs index if appropriate — document changed ownership, call-admission freshness, role lifetime, native outcome evidence, and STOP. Historical investigations remain evidence.
- `package.json` / lockfile only if the Effect implementation needs an explicit direct dependency already exported/used by the pinned plugin API; determine that during implementation, not by changing dependency state in this investigation.

These are target files/symbols, not changes performed by this report.

## Minimal Live Dogfood Plan

First prove the gate with cheap test-scoped host/tool/role/RPC doubles, including captured old snapshots and server-epoch loss. Later pinned-host dogfood should cover only the new native boundaries:

1. One success: fresh native Planner, trusted publication/click/claim/control delivery, one exact Implementer call/child/input/result, unchanged HEAD and exact scope, real running/completed row and child/back navigation, final prose and STOP. Restart **after completion** to inspect native persisted row/navigation without restoring CAP authority.
2. Deterministic hostile call sequence: preauth, wrong prompt/description/agent, extra keys including empty optionals, aliases, two concurrent valid calls, malformed-first, Planner-first, and retry/reuse. Check zero child execution for rejected calls and at most one admitted child, not merely visible errors.
3. Boundary failure: stale Git/input before release, lost wake/claim/result acknowledgment, explicit revoke racing reservation, server/plugin reload with captured old executor, and an interrupted child at server restart. Confirm no replacement and no orphan implementation authority; verify the scoped role is absent/denied before any recovered child can perform effects.
4. Native liveness: root refusal/prose only; foreground-to-background conversion or native failure. Confirm terminal uncertainty/STOP and no automatic second proposal/continuation. No second pre-prompt probe is needed because this design does not use progress as an authorization barrier.

Live execution is future work. Static source inspection establishes the supported composition; dogfood must validate actual installed registration ordering, Effect failure settlement, request/child gating, and RPC/private-handle handling before release.

Docs-only validation for this run is `git diff --check` and status inspection confirming this report is the sole project change. No production/test/agent definition was modified and no runtime verification was claimed.

## Final Classification

CAP-GATED NATIVE IMPLEMENTER IS VIABLE AND SIMPLER
