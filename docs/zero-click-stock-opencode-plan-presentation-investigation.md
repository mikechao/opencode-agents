# Zero-click plan presentation on stock OpenCode

Investigation only, 2026-09-28. This is static inspection of the installed SDK declarations and the matching read-only OpenCode host source. OpenCode was not launched; no implementation was changed.

## 1. Verified baseline

| Item | Observed state |
| --- | --- |
| Implementation checkout | `main` at `5c90a675416f5687fc817481c8eb12228d5a2ffc`, tracking `origin/main`. `git status --short --branch` showed no changes at the start. |
| Project SDK | [`package.json`](../package.json) pins `@opencode/plugin` to `2.0.17`; installed `@opencode/plugin`, `@opencode/client`, and `@opencode/schema` manifests each report `2.0.17`. |
| Installed CLI | The `opencode` path resolves to the global `@opencode/cli/bin/opencode.exe`; its package manifest reports `2.0.18`. The executable was not invoked. |
| Host reference | Read-only `../opencode` is `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`, exact tag `v2.0.18`, detached and clean. |

The SDK is one patch behind the host. The installed [Promise tool declarations](../node_modules/@opencode/plugin/dist/promise/tool.d.ts) establish the public hook; the v2.0.18 [tool dispatcher](../../opencode/packages/core/src/tool.ts), [runner](../../opencode/packages/core/src/session/runner/step.ts), and [TUI renderer](../../opencode/packages/tui/src/routes/session/index.tsx) establish its actual behavior. The [previous stock-host report](stock-opencode-hybrid-ux-investigation.md), [hybrid UX decision](hybrid-authorization-ux-decision.md), [transcript investigation](trusted-transcript-projection-investigation.md), [nonmodal investigation](native-nonmodal-authorization-investigation.md), and [M2 dogfood](milestone-2-live-dogfood.md) supply the settled baseline.

## 2. Narrow question and fixed constraints

**Stock OpenCode only. Zero-click plan reading is preferred. Conversation is presentation, not authority. The compact local `session.composer.top` authorization strip remains selected.** Its Authorize/Cancel actions must be direct TUI-local callbacks. No upstream API, fork, package patch, host monkey patch, Form/Question, command, slash command, keymap dispatch, model prose, workflow store, persisted attempt state, or cross-process CAP authority is part of this investigation.

The question is whether the always-visible *input* of a custom `present_plan` tool can carry trusted `F(P)`—a deterministic complete rendering of the exact Planner result `P`—without expansion or model copying.

## 3. GenericTool visible-input rendering

An unrecognized custom tool is dispatched by `ToolPart` to `GenericTool` ([session renderer, `ToolPart`, `GenericTool`](../../opencode/packages/tui/src/routes/session/index.tsx); [tool-name dispatch](../../opencode/packages/tui/src/routes/session/message-parts.tsx)). `GenericTool` initially sets `expanded` to `false`. Its always-visible `InlineTool` child is **only** `genericToolSummary(props.tool, props.input)`. The complete `Object.entries(props.input)` and output appear only inside `<Show when={expanded()}>`, after a click. Thus the visible input is the summary, not the expanded `plan:` value field.

`primitiveInputSummary` in [tool-display.ts](../../opencode/packages/tui/src/util/tool-display.ts) includes **all top-level string, number, and boolean entries**, in object iteration order, as `[key=String(value), ...]`; it excludes arrays, objects, null, and nested fields. `genericToolSummary` then applies `.replace(/\s+/g, " ")` to that entire result and prefixes the tool name. An input `{ plan: "Intent: A\nPlan: B\nFiles: C" }` therefore becomes one logical summary string, `present_plan [plan=Intent: A Plan: B Files: C]`. Actual newline characters are turned into spaces, not preserved and not displayed as literal `\\n`. Other whitespace sequences collapse too. There is no first-field-only filter or explicit character/line cap in these two summary functions.

The summary sits in an `InlineToolRow` `<text flexGrow={1}>` inside a compact flex row ([`InlineToolRow`](../../opencode/packages/tui/src/routes/session/message-parts.tsx)); it is not a separate formatted plan block or Markdown. This call site specifies neither `wrapMode="word"` nor `truncate`. It does not explicitly ellipsize, set a one-line height, or impose a width cap. Terminal width and the underlying text layout can affect where that one logical line occupies screen cells, but wrapping, if any, cannot recover the removed line breaks or field structure. A long value is passed as part of the row label; the source does not promise a complete readable plan or controlled row height. We need no runtime layout judgment to reject *complete multiline plan* display: the newline information is already destroyed by `genericToolSummary`.

In contrast, an expanded GenericTool renders each input entry in a `<text wrapMode="word">` and its output in another wrapped `<text>`. Those exact string values retain embedded newline characters, but that entire region is behind `expanded()`. The tool's `description` is a model-facing definition; generic return metadata supplies no summary template, title, input formatter, or default-expanded flag ([tool schema](../../opencode/packages/schema/src/tool.ts)).

At the default **medium** verbosity, this custom tool is a direct row. At **low** verbosity, `partPath` wraps all non-text parts in an activity group, which starts collapsed; an additional group click may be needed ([grouping rules](../../opencode/packages/tui/src/routes/session/grouping/session.ts), [`groupExpanded`](../../opencode/packages/tui/src/routes/session/index.tsx)). The visible summary exists during the tool's running state after `session.tool.called`, and remains after completion because success retains the call input ([message updater](../../opencode/packages/core/src/session/message-updater.ts)). The row is rebuilt from canonical history after navigation/reload; its expansion signal need not persist ([row projection](../../opencode/packages/tui/src/routes/session/rows.ts), [session scrollbox](../../opencode/packages/tui/src/routes/session/index.tsx)).

GENERIC TOOL INPUT CANNOT SHOW A COMPLETE MULTILINE PLAN ZERO-CLICK

## 4. Trusted pre-execution input injection

The installed 2.0.17 [`ToolHooks` declaration](../node_modules/@opencode/plugin/dist/promise/tool.d.ts) gives `execute.before` `{ tool, sessionID, agent, messageID, id, input }`; the four identity fields are readonly while `tool` and `input` are assignable. The v2.0.18 [hook service](../../opencode/packages/core/src/plugin/hooks.ts) invokes callbacks on one event object and returns it. The [Promise adapter](../../opencode/packages/plugin/src/promise/adapter.ts) registers the callback with that service. The hook can replace `event.input` or mutate a mutable object it receives. It sees the root session ID, root agent, assistant message ID, tool-call ID, and tool name, but not a proven whole root history or Planner child identity.

The crucial order is in [`SessionRunner.step`](../../opencode/packages/core/src/session/runner/step.ts) and [`publishLLMEvent`](../../opencode/packages/core/src/session/runner/publish-llm-event.ts):

```text
provider emits model-authored tool-call event with input X
→ publisher completes tool-input streaming and publishes durable Tool.Called(input: X)
→ local execution fiber starts
→ Tool.snapshot.execute triggers execute.before
→ dispatcher passes event.input to Tool.runtime.execute
→ runtime validates that input against the declared schema
→ tool implementation executes
→ terminal Tool.Success/Failed event is published without any replacement input
```

`Tool.Called` uses `asRecord(event.input)`. [`SessionMessageUpdater`](../../opencode/packages/core/src/session/message-updater.ts) stores that published input in the running tool part and copies **the same input** into the completed part. The success event contains content and metadata, not a new input ([event schema](../../opencode/packages/schema/src/session-event.ts)). The TUI renders `part.state.input`, and [later model-context lowering](../../opencode/packages/core/src/session/runner/to-llm-message.ts) also uses `part.state.input`. Reassigning `execute.before`'s `event.input` therefore changes what the tool implementation validates and receives, **but does not replace the already published canonical call input**. In-place mutation of an aliased provider object after publication is not a supported canonical rewrite; the durable event/projection path has no corresponding input update and cannot establish the required invariant.

For example, if the model emits `present_plan({})` and the hook supplies `{ plan: F(P) }`, a declared required `plan` field can pass the *runtime* schema check because that check occurs after the hook. The advertised schema still tells the model the field is required, so `{}` may also be rejected or avoided by the model/provider before the hook. An optional/defaulted field can advertise `{}` and the hook can set/overwrite the execution value; a required placeholder field can likewise be overwritten for execution. **Neither schema choice changes the recorded input**, which stays the model's `{}` or placeholder. The TUI-side binder cannot read back `recorded input.plan === F(P)` unless the model itself supplied that exact value. That reintroduces model copying, and the visible summary would still flatten it.

The existing `execute.after` capture remains real: a server plugin can observe a completed native Planner call and its structured exact result, keep a short-lived presentation-only cache keyed by root/call facts, and have a later tool return `F(P)` ([tool dispatcher](../../opencode/packages/core/src/tool.ts), [native subagent output](../../opencode/packages/core/src/tool/plugin/subagent.ts)). A `present_plan` hook/tool can reject a missing, consumed, duplicate, wrong-agent, wrong-session, or early cache entry and fail closed; the TUI binder would still have to prove call order and exact child history. Hook loss or reload can STOP. Those guards cannot make post-hook input canonical. `execute.before` is not a pre-recording input injection API.

TRUSTED PRE-EXECUTION INPUT INJECTION IS NOT SUPPORTED

## 5. Zero-click tool-input design

The proposed path fails both required properties. Trusted `F(P)` can reach the tool implementation as post-hook input, but stock history and TUI retain the model-authored input; the only always-visible GenericTool input rendering removes its newlines and presents a compact summary. Returning a fixed tiny marker such as `presented` would avoid a substantial collapsed output, but would leave no complete plan visible. Returning `F(P)` restores the [previous report's](stock-opencode-hybrid-ux-investigation.md) exact **collapsed output** path, with its expand click.

There is no separate complete-plan size limit found for a recorded tool *input* in the inspected path; the 2,000-line/50-KiB [`ToolOutput.truncate`](../../opencode/packages/core/src/tool-output.ts) applies to results, not call input. That does not help this design: the canonical value is the wrong one, and the visible summary alters its layout. A very large model-supplied input can encounter provider/context/terminal constraints without any source-backed full-visibility guarantee. No binder may infer what the human saw solely from an untruncated stored input. The compact strip could show `Plan <digest-prefix> · HEAD <head-prefix>` with Authorize/Cancel only after a trusted candidate freeze, but it cannot imply the flattened row is a verified full plan.

## 6. Exact binder implications

There is **no viable zero-click tool-input contract** to add to M2. In particular, the desired `recorded input === { plan: F(P) }` cannot be asserted after a hook supplies that value; the history contains the model's original arguments. A binder that checked only the tool implementation's marker/result would fail to prove the always-visible text. A binder that accepted the summary would accept a presentation with collapsed line breaks, not the complete `F(P)`.

Any later presentation approach must preserve current [`src/m2/attempt.ts`](../src/m2/attempt.ts) fail-closed checks: one exact root user message/ID and bytes; distinct ordered assistant/tool-call IDs; one exact Planner child ID, prompt, history, and P/result wrapper; one exact `implementer_slot` child ID, fixed prompt, history, and `READY`; one fixed final and successful idle; no duplicate/unexpected call, tool, prose, control message, or truncated presentation; and exact whole-history snapshots. Immediately before any grant, recheck the same parent, Planner, and slot histories, intact candidate, root/session/location, clean bound HEAD/worktree, idle/no inbox, and active TUI generation. Presentation cache and transcript text never freeze C or grant CAP authority.

## 7. Threat analysis

Question: can a model-controlled actor make an active compact strip authorize candidate C while the visible zero-click plan differs from trusted `F(P)`? **There is no active strip for the rejected tool-input design.** A safe binder stops because it cannot prove the proposed input/visibility relation. The accepted fallback keeps the exact candidate in the trusted TUI component.

| Actor | Capability and fail-closed boundary |
| --- | --- |
| Root Orchestrator | Can choose a `plan` argument, call `present_plan` early/twice/not at all, and emit competing prose. The hook cannot canonicalize its argument. Reject any such call/order/prose outside an exact contract; none is authorization. |
| Planner | Produces P. Trusted TUI code validates its exact child history and proposal before freezing C. Planner instructions cannot activate the local callback. |
| `implementer_slot` | Harmless bootstrap child; exact role, input, result `READY`, identity, and order remain required. It has no route to the local resolver. |
| Prior/current shell-capable Implementer | Under the accepted V1/M2 threat model it may use ordinary local client/shell routes and disturb sessions. Changed parent/child history, pending inbox, Git state, or location causes STOP before grant. It cannot invoke an unregistered TUI-local Authorize closure through those routes. |
| Trusted server plugin | May cache P briefly and format/return `F(P)` for presentation. Stale cache, wrong root/agent/call, loss on reload, or hook failure must fail closed. It must hold no C, HEAD binding, grant, or affirmative decision. |
| Trusted TUI plugin | Owns exact binding, candidate freeze, direct local callback, liveness, freshness, and one-use grant. It must never treat tool input/prose or a cache hit as approval. Reload revokes its generation. |
| Local human/trusted local client | May inspect/navigate and click the direct control, or perform ordinary trusted local operations. The decision is bound to the current exact C and history; local changes invalidate the pending attempt. |
| Unrelated same-user process | Can interfere with ordinary host/session/Git state but cannot use a supported server endpoint to invoke the private TUI callback. Whole-history and freshness checks reject interference. Deliberate TCB replacement/OS input spoofing remains outside the accepted local model. |

Even a model-authored `{ plan: F(P) }` could match by luck, but the GenericTool summary still changes its visible layout. A truncated or abbreviated *visible* plan must never be rescued by the fact that canonical history holds more bytes. STOP is the correct response to any unproven presentation.

## 8. Verified root-final fallback

The stock TUI renders root assistant `TextPart` with Markdown directly in normal transcript flow ([`TextPart`](../../opencode/packages/tui/src/routes/session/message-parts.tsx)). The Planner's exact result enters later root model context as a completed native tool result ([LLM lowering](../../opencode/packages/core/src/session/runner/to-llm-message.ts)). Therefore F1, a raw exact P echo, or F2, an exact readable `F(P)` echo, can be checked byte-for-byte by trusted M2 before enabling the strip. Both are zero-click when correct, and both require the model to copy a potentially long value exactly. F2 improves typography but does not reduce that burden; adding a deterministic wrapper may increase it. The existing M2 live STOP from a single missing trailing space in the root-to-Planner prompt demonstrates this availability failure class.

F3 does not remove the copy: a custom tool result is stored and lowered into later model context, but the host does not automatically turn it into an assistant `TextPart`. The root must generate its final text itself. The custom tool result still renders collapsed under GenericTool. No supported tool metadata promotes result content to assistant prose. F4, allowing an inexact final while the strip names C, would make the user authorize a presentation that the binder has not proved equals P and is rejected. A strict final comparison preserves CAP correctness by STOPping on mismatch, yet exact long copying remains an avoidable availability dependency. The final Markdown renderer also uses `.trim()` for display, so byte comparison belongs on canonical text, with a deterministic format whose meaningful content remains clear after rendering.

VERIFIED ROOT FINAL REMAINS TOO FRAGILE

## 9. UX comparison

| Surface | Reading, flow, persistence | Exactness and authorization relationship |
| --- | --- | --- |
| Trusted visible tool input, **hypothetical** | Would occupy a GenericTool summary row in normal transcript scrolling; default medium shows it, low may group it. Its newlines are flattened, typography is a label, and screen width gives no complete structured view. The original input row persists, not the post-hook value. | No stock-supported trusted input substitution before recording. Cannot prove the visible plan equals `F(P)` without model copying, and even an exact input is not readable as a multiline plan. |
| Collapsed custom tool output | Exact complete plain text persists in root history and scrolls there after expansion. `<text wrapMode="word">` wraps the expanded content; default medium needs a click, low may need a group click too. Expansion state may reset. | Server can derive `F(P)` without a model copy and TUI can verify it. Compact strip can be nearby, but reading is not zero-click. |
| Verified root final | Immediate, Markdown-formatted plan in normal scroll and persistent history; closest stock visual match to the prototype. | Exact canonical comparison can prove P/C relationship, but the root model must copy all bytes. Mismatch STOPs. |
| Full composer-top plan card fallback | Trusted complete plan in a bounded scroll area above the composer, with compact direct local controls. No transcript navigation/expansion; the composer can remain primary if height is capped. Card is generation-local, not a persistent transcript row. | Directly renders the frozen C and bound HEAD/digest without a model copy. The relationship to Authorize/Cancel is explicit. Requires the small public-slot TUI component and its bounded UI proof. |
| Hybrid prototype visual target | Immediate assistant-style plan in ordinary conversation scroll with compact strip; natural typography and persistence in its imported fixture. | It was a visual simulation using a new imported session, not a supported append to the live bound root ([decision](hybrid-authorization-ux-decision.md)). It establishes preference, not production projection. |

## 10. Secondary observation: Planner prompt exactness

`execute.before` also runs for the direct native `subagent` tool ([tool snapshot dispatcher](../../opencode/packages/core/src/tool.ts)). Its input can identify `agent: "planner"`; its event supplies root session/agent and call/message IDs. Changing `event.input.prompt` before [`Tool.runtime.execute`](../../opencode/packages/core/src/tool/runtime.ts) can change the prompt the native [subagent implementation](../../opencode/packages/core/src/tool/plugin/subagent.ts) passes to the child. A plugin might capture a root user prompt through the separate `session.prompt` hook, but that is before canonical delivery, and the Promise session domain does not itself provide a message-list reader. More decisively, the native **recorded** subagent call still contains the original model-authored prompt because `Tool.Called` precedes `execute.before`. The current M2 binder requires exact recorded `planner.prompt === plannerInput(U)` and exact child input. Thus this hook cannot fix both sides of the known root-model copying problem while retaining the existing canonical contract. Its limited execution-input repair is not an adopted follow-up path.

## 11. Recommended stock-OpenCode direction

Use the **full composer-top plan card fallback** for zero-click plan reading, with compact direct TUI-local Authorize/Cancel controls. Render the exact frozen C from trusted TUI M2 state, including Intent, Plan, exact Files, canonical worktree, HEAD, digest, and implementation-only scope. Bind to the existing Planner/slot histories and run all current liveness/freshness checks before the one-use grant. The card can be bounded and scrollable so the regular composer remains visually primary; unreadable size or lost component/generation must remove affirmative action and STOP. It is less conversation-native and less persistent than the hybrid prototype, but it meets zero-click inspectability and exactness on unmodified stock OpenCode. The collapsed-result tool remains an optional UX alternative only if the user later accepts its click; it is not the selected direction here.

## 12. Required proof before implementation planning

**One bounded user-run probe remains** for the selected composer-top component. Source proves the public slot and direct local callback path, but cannot decide whether its complete text, bounded scroll, and fixed controls remain readable and operable on the installed TUI with the required JSX peers at a normal and narrow supported terminal size. In one disposable `/tmp` project, have the user launch stock OpenCode with an inert sample plan in `session.composer.top` and local sample buttons that record only disposable events. Check that every plan line can be read by scrolling without hiding the action row, that direct pointer/focus activation works, and that route change/reload/unreadable resize removes or disables the affirmative control. Do not create a CAP request, run an Implementer, or touch this repository. This is the same narrow UI fact left open by the [nonmodal investigation](native-nonmodal-authorization-investigation.md); no tool-input or root-final runtime probe is needed to decide their source-established limits. Codex did not run this probe.

## 13. Likely implementation surface

Within `opencode-agents` only: [`.opencode/plugins/opencode-agents/tui.ts`](../.opencode/plugins/opencode-agents/tui.ts) and a small colocated TUI component for the bounded card/local controls; [`src/m2/attempt.ts`](../src/m2/attempt.ts) for presentation and decision handoff while retaining exact binding and rechecks; [`src/m1/proposal.ts`](../src/m1/proposal.ts) for the existing candidate text/digest formatting. Optional JSX peer declarations may be needed for the component. There is no need for a `present_plan` server plugin or a new root tool contract for this direction. This names surfaces only; it is not an implementation plan.

## 14. Open blockers / accepted UX compromise

- The one disposable user-run UI probe in §12 must establish a readable bounded card and reliable direct local controls on the installed TUI before implementation planning.
- The exact plan lives in a generation-local composer-top card rather than a persistent root conversation row. It uses some vertical space; at too-small terminal dimensions, authorization must STOP. The existing Planner child and native root tool histories remain persistent and inspectable, but they do not provide the selected zero-click plan presentation.

STOCK OPENCODE REQUIRES THE COMPOSER-TOP PLAN FALLBACK
