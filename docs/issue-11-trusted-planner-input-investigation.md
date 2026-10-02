# Issue #11 — Trusted Planner Input Investigation

## Conclusion

**B. Supported, but with an important host caveat.** OpenCode 2.0.22 supports trusted replacement before native child creation, through either `execute.before` or a transformed executor. However, it persists the model-proposed arguments **before** either boundary; neither replacement updates root `state.input`.

Use the existing transformed native `subagent` executor to read the persisted root request, derive `plannerInput(request)`, and delegate with that replacement and the unchanged invocation context. Add a small trusted execution receipt to the native result's metadata, identifying the root user message and exact effective arguments. Later binding must compare this receipt and the independently read child bootstrap against the persisted request, while retaining the proposed arguments as audit evidence. Merely rewriting the executor input and deleting the current prompt equality check is insufficient.

Inspected repository HEAD: `291abeafe2618cd86def23ee79b5b8469cd160d4`, branch `main`, initially clean. Authoritative host checkout: `../opencode`, HEAD `527f0b931d1f9b3ebd34e106c51b31ce5db5b075`, clean; root, core, plugin, and schema package manifests report **2.0.22**. Repository `package.json:14–16` and `bun.lock:8–9,213–223` pin the relevant OpenCode packages to 2.0.22. This was a static source investigation; OpenCode was not launched.

## Current Repository Seam

- `src/attempt.ts:25–27`: `plannerInput(request)` adds only `User request:\n`; `nativeBootstrap(prompt)` adds the pinned native subagent prefix. Neither normalizes text.
- `parentCalls`, `src/attempt.ts:231–253`: requires one initial plain user message and one completed native Planner call, then compares persisted `state.input.prompt` exactly with `plannerInput(user.text)`.
- `completedCall`, `src/attempt.ts:213–229`: requires exactly `agent`, `description`, and `prompt`, plus completed native child metadata. `verifyChildHistory` and `bindNativeAttempt`, lines 255–307, independently verify the child's exact bootstrap, identity, successful completion, and result.
- `.opencode/agents/orchestrator.md:8` places exact request copying on the model.
- `.opencode/plugins/opencode-agents/server.ts:20–24` registers `admission.before` and wraps the existing native executor. `src/native.ts:124–175` currently governs authorized implementation; ordinary Planner execution passes through at lines 146–149. Its supported server session reads are already demonstrated at lines 159–161 and 188–191.
- `test/attempt.test.ts:674–714` covers strict call/child rejection. The server double at lines 2430–2478 already models original-input persistence separately from decoded execution input; lines 2485–2504 currently expect Planner passthrough.

## OpenCode 2.0.22 Argument Lifecycle

All host references below are relative to `../opencode` at the inspected HEAD.

| Stage | Prompt representation and behavior | Source |
| --- | --- | --- |
| Root request admission | `SessionPrompt.prepare` passes text through session prompt hooks; the authority for #11 is the resulting persisted user text, not raw composer state. `InboxDelivered` projects `payload.text` directly into the user message. | `packages/core/src/session/prompt.ts:29–89`; `session/projector.ts:609–639` |
| Before model execution | Runner promotes pending input before loading context and requesting the model. The root user message is therefore persisted before its tool proposal exists. | `packages/core/src/session/runner/llm.ts:163–179,224–239`; `session/context.ts:163–177` |
| Proposed tool input | Provider tool streams produce a parsed input value from accumulated JSON. This remains model-authored. JSON parsing and native tool schema validation are separate stages. | `packages/ai/src/protocols/shared.ts:178–185`, `parseToolInput`; `protocols/utils/tool-stream.ts:72–96`, `toolCall` |
| Persisted root call | Publisher emits `Tool.Called` with `asRecord(event.input)`. The projector stores this as running `state.input`. Publication completes before the executor fiber starts. | `packages/core/src/session/runner/publish-llm-event.ts:27–28,458–475`; `session/message-updater.ts:323–338`; `session/runner/step.ts:100–128` |
| `execute.before` | Receives the parsed proposed value, **before native schema decoding**. Hooks can replace `event.input`; the snapshot explicitly passes the returned event's input onward. | `packages/core/src/tool.ts:103–111,263–283`; `plugin/hooks.ts:88–95` |
| Validation and transformed wrapper | `runtime.execute` decodes the hook's input against the registered native schema, then calls the transformed `tool.execute(decoded, context)`. The wrapper can delegate to the captured native executor with a new trusted object. | `packages/core/src/tool/runtime.ts:28–44,62–83`; `tool.ts:186–200`; `packages/plugin/src/effect/tool.ts:8–16` |
| Native executor | Reads parent, resolves target/depth, asserts native permission using invocation session/agent/source IDs, then creates the child. Prompt replacement does not require replacing any of this behavior. | `packages/core/src/tool/plugin/subagent.ts:108–151,153–198` |
| Child bootstrap | For a fresh child, native `sessions.prompt` uses `"You are a subagent spawned by another session.\n" + input.prompt`. Thus the effective executor prompt becomes the child's admitted input, subject to normal session prompt hooks. | `packages/core/src/tool/plugin/subagent.ts:200–218`; `session/prompt.ts:40–52,77–89` |
| Progress and result | Native progress exposes child `sessionID`; native foreground job blocking, cancellation, completion, output, and metadata continue unchanged. After hooks and output normalization run outside the wrapper. | `packages/core/src/tool/plugin/subagent.ts:200–201,220–265`; `tool.ts:119–155`; `session/runner/step.ts:121–125` |
| Completed root evidence | Success publishes result content/metadata but no replacement input. The completed projector explicitly copies **the existing running input**. | `packages/core/src/session/runner/publish-llm-event.ts:581–598`; `session/message-updater.ts:340–358` |

### Question 1: `execute.before`

Input replacement is intentional, not an accidental aliasing capability. The public hook exposes mutable `input` (`packages/plugin/src/effect/tool.ts:20–28`); the hook runner returns the event; the tool snapshot consumes `event.input`. More decisively, OpenCode itself assigns a replacement in `ToolInputRepairPlugin.Plugin` (`packages/core/src/plugin/tool-input-repair.ts:21–35`) and in `SubagentTool.Plugin`'s empty optional-key normalization (`tool/plugin/subagent.ts:271–279`).

Replacing `event.input` changes what is decoded, passed to the transformed executor, and ultimately used for child bootstrap. It does **not** replace root `state.input`: that value was already committed by `Tool.Called`. Durable projectors run in the publication transaction (`packages/core/src/bus.ts:317–320,395–403`). Mutating nested properties instead of replacing the object cannot safely repair persisted evidence; do not depend on object sharing with provider events or projection state.

### Question 2: transformed `tool.execute`

The wrapper can call `original(trustedInput, invocation)` before any child exists. Preserve the native schema registration and validate the constructed replacement in trusted code: calling the captured executor directly does not perform another schema decode. For #11 the replacement has only the already validated target/description and the derived string prompt.

The three outcomes are distinct: root `state.input` retains proposed arguments; the native executor receives replacement arguments; the child receives the native prefix plus replacement prompt. There is no supported input-update return channel at this seam.

A small additional receipt resolves the verification caveat: add one plugin-owned metadata field containing `{ userID, input }`, where `input` is the exact effective three-key argument object actually passed to `original`. Emit it only after a successful native completion, preserving native `sessionID`, `status`, content, and structured output. Metadata is a supported result field (`packages/schema/src/tool.ts:9,89`), survives normal output handling (`packages/core/src/tool.ts:140–155`; `tool-output.ts:65–74,110–115`), and is persisted by the success projector. A progress-only receipt would be insufficient: completed state uses terminal metadata, not accumulated progress.

This is execution evidence on the existing native call, not persisted worker-attempt bookkeeping. Verification must require the receipt, recompute its prompt from the exact root text, compare its other arguments with the proposed call, and independently verify the child. Metadata alone supplies no authority to publish or authorize a Plan. Other plugins remain trusted host code; after-hook alterations that break receipt/bootstrap coherence must fail closed.

## Trusted Root Request Availability

Use the existing Effect server API: `context.session.get({ sessionID: invocation.sessionID })` and `context.session.context({ sessionID: invocation.sessionID })`. Public exposure is in `packages/plugin/src/effect/session.ts:153–170`; host forwarding is in `packages/core/src/plugin/host.ts:545,568`. `Session.context` reads stored messages (`packages/core/src/session.ts:374–377`; `session/store.ts:179`; `session/history.ts:78–115`). No client bridge or composer read is needed.

These are awaited Effect reads. They finish before delegating to `original`, so child creation waits for request derivation. The current running native call is already available to identify by the exact `(sessionID, messageID, tool id)` supplied by the host. Require one nonempty plain root user message at the beginning of history and retain its ID and exact text; never choose “the latest user” heuristically.

`session.context` is bounded by the latest completed compaction (`session/history.ts:28–59,83–94`). That is sufficient for the existing initial, uncompacted attempt; reject missing initial history or any compaction/control/continuation structure instead of recovering earlier input. Final TUI binding continues to use its paginated message API.

Reads are not an atomic lock across the later native permission/creation awaits. Recheck applicable local CAP/lifetime conditions after reads; reject observed intervening input or changed identity, and preserve later root-idle/inbox/history checks. An input arriving after the read may invalidate the attempt even if native work has started; it must never grant authorization. #11 does not add cancellation or transcript recovery to solve that pre-existing concurrency boundary.

## Recommended #11 Boundary

Extend the existing `subagent` executor wrapper's ordinary Planner branch, before its pass-through to `original`. Derive the request there and return the receipt with the native result. The hook could perform the rewrite, but would still need a wrapper for effective-input evidence; doing both adds unnecessary coordination.

The smallest discriminator combines existing facts:

1. Invocation agent is `orchestrator`, decoded target is exactly `planner`, and persisted session identity is an unforked, unreverted, unarchived root Orchestrator at the plugin location with expected permissions.
2. History starts with exactly one plain user message; only the initial attempt's allowed message kinds occur, with no synthetic Plan/control input, earlier idle turn, or second user. Assistant roles remain Orchestrator.
3. Exactly one native tool contender exists in the observed transcript, in any tool state. It is the running `subagent` part with this invocation's exact message/tool IDs. Its **persisted proposed** input has exactly `agent`, `description`, and `prompt`, with target `planner` and valid nonempty strings. Checking persisted keys avoids silently accepting options/extras removed by host normalization or decoding.
4. The same root has no admitted CAP claim. The existing CAP identity is a supplementary exclusion, not the definition of a planning phase: `NativeCap.phase` initially equals `closed`, while `rootSessionID` is undefined (`src/cap.ts:47–71`). Preserve the existing implementation-admission branch and its precedence.

No server copy of the TUI activation state is required. Root session and transcript identity select the candidate boundary; existing TUI activation/root/HEAD checks independently decide whether that result belongs to an authorizable attempt. Additional contenders or later input invalidate binding; no planning reservation, workflow phase, or persisted generation is introduced.

Change later binding to distinguish proposed arguments from effective arguments. Preserve the original proposed input for exact subsequent evidence checks, require the trusted receipt's `userID` to match the sole root user ID, and use its derived prompt for `Call.prompt`, publication coherence, and child bootstrap verification. Remove the model's exact-copy obligation from the Orchestrator instructions. **Do not trim or canonicalize the request.** Trusted derivation is viable, so fallback canonicalization was not investigated.

## Fail-Closed Properties

Exact equality remains between persisted root text, derived effective prompt, receipt, and child bootstrap, including trailing spaces, EOF newlines, internal whitespace, and filenames. A different model-proposed prompt is overwritten deliberately; it is retained as proposal evidence and never used as request authority.

Missing/changed receipt, wrong user/message/tool IDs, substituted or continued child, optional argument keys, extra contenders, later root input, altered effective prompt, changed child bootstrap/result, or unexpected session identity/permissions still reject binding. Child prompt hooks do not bypass verification: an altered persisted bootstrap fails the exact comparison.

Keep independent Planner result parsing, proposal integrity, exact child/session identity, root/worktree/HEAD observations, scope checks, one-shot CAP, sponsorship, and current human authorization unchanged. The receipt grants no implementation permission and creates no second authorization path.

## Future Compatibility

For **#13**, the rewrite targets a root Orchestrator's initial Planner invocation. Planner-to-Explorer calls do not match that boundary. Current child verification explicitly rejects `subagent` during Planner bootstrap (`src/attempt.ts:272–284`); #13 must separately address that existing restriction and host depth/permission policy. #11 introduces no Explorer topology coupling.

For **#14**, the proposed discriminator intentionally rejects later root planning turns. A future trusted planning generation can define its own request identity and effective-input receipt; #11 must not silently reinterpret revisions as the original request. No revision phase or generation mechanism is needed here.

## Implementation Guidance

Likely implementation touchpoints, without an implementation diff:

- `src/native.ts`: `nativeAdmission.execute`, narrowly scoped initial Planner identification, trusted request derivation, unchanged native delegation, and terminal execution receipt. Use existing CAP identity only to exclude authorized continuation.
- `.opencode/plugins/opencode-agents/server.ts`: existing `tool.transform` wiring; no new tool or child creator is needed.
- `src/attempt.ts`: `completedCall`, `parentCalls`, `Call`/`Bound` evidence, and publication/reverification coherence. Keep `plannerInput` and `nativeBootstrap` exact.
- `.opencode/agents/orchestrator.md`: replace exact-copy instructions with the trusted input contract.
- `test/attempt.test.ts`: focused server/binding coverage using test-scoped session/native doubles. Update Planner passthrough expectations and retain existing CAP regressions.

Focused tests should prove: pasted trailing spaces/newlines survive into effective execution and child history despite a different proposed prompt; persisted proposed input remains unchanged; receipt/user/call/bootstrap tampering rejects publication and authorization; extra/normalized-away optional keys and competing tool states reject admission; child Planner calls and later planning turns do not receive the initial-root rewrite; intervening input or identity changes during awaited reads fail closed. Preserve ordinary native permissions, invocation IDs, progress, child navigation metadata, and results. No real Git fixture is needed for these host-boundary cases.

No unresolved host/API uncertainty blocks implementation. The remaining engineering work is implementing and testing the explicit proposed/effective evidence distinction against the pinned lifecycle. No source/config/test changes were made during this investigation.

Validation: `bun run check` passed (87 tests); `git diff --check` passed. These validate the unchanged implementation, not a prototype of the proposed boundary.
