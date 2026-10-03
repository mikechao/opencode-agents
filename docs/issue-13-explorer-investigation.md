# Issue #13: Planner delegation to Explorer — investigation

Investigation only, against the current local implementation and OpenCode 2.0.22 source. No Issue #13 implementation or live host dogfood was performed.

## 1. Source Findings

### Observed starting state and authorities

- `git status --porcelain=v1 --untracked-files=all` returned no entries before this investigation.
- `opencode-agents` HEAD: `fae0b9ec3718579ab7ede955e2d7010295fcbd4a`.
- The requested initial `opencode --version` command failed because the sandbox denied opening the normal host log at `/Users/mike/.local/share/opencode/log/opencode.log`. Repeating **only the version command** with `XDG_DATA_HOME=/private/tmp/issue-13-opencode-version` succeeded and printed `opencode v2.0.22`. No server, session, or TUI was launched.
- Local authoritative source: sibling `../opencode`, HEAD `527f0b931d1f9b3ebd34e106c51b31ce5db5b075`; its working tree was clean. Both `packages/cli/package.json` and `packages/core/package.json` declare `2.0.22`.
- Read [GitHub Issue #13](https://github.com/mikechao/opencode-agents/issues/13) through `gh issue view 13 --repo mikechao/opencode-agents --json number,title,body,state,url`. It was open, titled `[Feat]: Allow Planner to Delegate to Multiple Explorer Agents`, and matched the requested advisory, fresh foreground Explorer scope. The issue was not modified. Its invitation to implement is superseded by this pass's explicit investigation-only instruction.

All host citations below refer to files beneath `../opencode/` at the source HEAD above. File paths and symbols, rather than installed-host assumptions, establish the conclusions. No sibling source was modified, built, or run.

### Current implementation boundary

`.opencode/agents/planner.md` declares `mode: subagent`, deny-all followed by read/glob/grep allows, explicitly prohibits delegation, and requires one final `intent/plan/files` JSON object. `.opencode/agents/orchestrator.md` allows only the initial Planner target and requests one fresh foreground call with exactly `agent`, `description`, and `prompt`. `.opencode/agents/authorized_implementer.md` remains the separately admitted implementation role.

In `src/attempt.ts`:

- `plannerArguments`, `plannerReceipt`, `effectivePlannerReceipt`, and `nativeBootstrap` (lines 27–56) establish the proposed/effective root-request → Planner-input distinction from Issue #11.
- `parentCalls` and `completedCall` (lines 248–279) bind exactly one completed native Planner call and its trusted effective-input receipt.
- `successful`, `idle`, `messages`, `oneFinal`, and `verifyChildHistory` (lines 193–314) verify persisted identity, successful settlement, full paginated history, exact bootstrap, and final Planner text. `verifyChildHistory` currently rejects `subagent` explicitly. Its other tool filtering is a **denylist**, not an exhaustive read/glob/grep allowlist; simply removing `subagent` from that list would be insufficient for #13.
- `bindNativeAttempt` (line 315) and `verifyParentPlanner` (line 388) both run this child verification, before publication and again before authorization. `Bound` (line 75) retains root/request/call and final Planner identity/text, not complete histories.
- `publishPlan`, `assertPublishedCoherence`, and `verifyPublishedAttempt` publish and revalidate only that final Planner proposal. Existing Git observations, ownership checks after awaits, and exact final proposal binding remain necessary.

`src/native.ts:229–245`, `nativeAdmission`'s executor wrapper, passes ordinary Planner → Explorer calls to the original executor. The root Planner-input rewrite applies to the Orchestrator boundary, and calls targeting the Implementer remain separately governed. `test/attempt.test.ts`, test `Planner rewrite leaves nested delegation untouched and does not reinterpret later root planning` (line 2739), already covers this separation with trusted doubles. The installed Planner currently has no permission to exploit it. No adapter change is needed to carry Explorer results.

`docs/v1-orchestration.md` describes the existing publication/authorization/CAP boundary and its semantic binding assumptions. `test/native-compatibility.test.ts` currently guards native actor/permission ordering; it does not yet guard the nested depth or foreground result/context seams.

### Native invocation, nesting, selection, and permissions

`packages/core/src/tool/plugin/subagent.ts`, `SubagentTool.Input`, `Output`, and `Plugin`:

- Lines 29–48 define required `agent`, `description`, and `prompt`, and optional `model`, `sessionID`, and `background`. Omitting `background` means foreground. Omitting `sessionID` means a new conversation. The host schema uses strings; the project's verifier should additionally require nonempty descriptions/prompts and the exact three-key contract.
- Lines 111–133 walk the caller's `parentID` ancestry, count depth, and compare it with `Config.latest(..., "experimental")?.subagent_depth ?? 1`. A root caller has depth 0; Planner under Orchestrator has depth 1. **The default blocks Planner → Explorer. `experimental.subagent_depth: 2` admits it.** An Explorer at depth 2 cannot create another level under this setting, even before target permission is checked.
- Lines 134–150 resolve `input.agent` through `Agent.Service.resolve`, reject missing agents and targets whose mode is `primary`, and assert `action: "subagent"`, `resources: [agent.id]`, using the explicit caller `context.agent` and actual caller session/message/tool IDs. A caller's subagent mode does not impose a separate prohibition once depth and permission allow the call. A target may be `subagent` or `all`; use `subagent` for Explorer.
- Lines 153–191 describe continuation and agent switching if `sessionID` is supplied. Exclude that path from #13.
- Lines 194–225 create the fresh child with `parentID: context.sessionID`, target agent, task title, and inherited/configured model; publish running progress; and prompt it with the native bootstrap prefix plus the assigned prompt.
- Lines 282–307 add available subagent descriptions to normal model tool discovery, selecting non-primary, non-hidden targets that the selected agent's permissions do not deny. A normal visible Explorer definition is sufficient.

`packages/core/src/permission.ts`, `evaluate` (line 87), `merge` (line 99), `configured` (line 158), `evaluateInput` (line 173), and `assert` (line 231), establish ordered last-match wildcard policy. The effective actor is the explicit invocation agent ahead of the session agent, with that agent's permissions followed by session overrides. Effective configured deny returns before saved approvals and permission hooks can elevate it; `assert` rejects deny before child creation. Thus an allow for `action: subagent, resource: explorer` is a target-specific permission, not general delegation permission.

`packages/core/src/session/context.ts`, `SessionContext.select` (line 121), merges the selected agent policy with session permissions for tool discovery. `packages/core/src/tool.ts`, `snapshot` (line 225) and `whollyDisabled` (line 292), hide tools whose last relevant rule is wildcard deny. A later Explorer-specific subagent allow keeps Planner's subagent tool discoverable; the leaf still checks the exact target. Denying `execute` removes CodeMode execution. Read/glob/grep are direct tools (`options.codemode: false` in their respective `tool/plugin/*.ts`). Write/edit/patch share the `edit` permission; shell asserts `shell`. Those actions remain denied.

`packages/core/src/config/plugin/agent.ts`, `load`, `decode`, and its agent transform (lines 51, 83–125, 176–215), load agent Markdown frontmatter and install the body as the agent system prompt, with ordered permissions. Ordinary prompting supports Explorer's investigation role without a custom output protocol.

### Foreground completion and subsequent model context

The exact return path is established by:

| Source and symbol | Relevant behavior |
| --- | --- |
| `packages/core/src/session/subagent-job.ts`, `SubagentJob.make`, `start` (lines 16–54) | Resumes the child, then reads its most recent 20 messages in descending order and selects the newest completed, error-free assistant message. |
| `packages/core/src/session/subagent-completion.ts`, `text` (lines 8–17) | Concatenates that assistant's text parts with no inserted separator; falls back to `Subagent completed without a text response.` if no usable text exists. Reasoning and tool parts are not returned as findings. |
| `packages/core/src/tool/plugin/subagent.ts`, foreground executor (lines 228–266) | Starts the native job, waits with `jobs.block`, converts error/cancellation to tool failure, and returns structured `{ sessionID, status: "completed", output }`, model content, and child ID/status metadata. |
| `packages/core/src/tool/runtime.ts`, `execute`, `normalizeContent` | Validates/encodes machine output and normalizes the explicit string content into a text content item. |
| `packages/core/src/tool.ts`, `executeTool` (lines 110–155) | Applies normal after hooks and content normalization before returning the result to the session runner. |
| `packages/core/src/session/runner/step.ts`, `SessionStep.make` / `attempt` (lines 88–143) | Executes local tools, bounds their content through `ToolOutput.truncate`, publishes tool completion, and joins tool executions before the next step. |
| `packages/core/src/session/runner/publish-llm-event.ts`, `toolExecution` (line 583), `record` (line 617) | Publishes terminal `SessionEvent.Tool.Success` with content/metadata. Local tool activity sets `needsContinuation`. |
| `packages/core/src/session/message-updater.ts`, `session.tool.success` (line 342) | Projects a completed tool part with original published input, returned content/metadata, and completion time. |
| `packages/core/src/session/model-request.ts`, `baseTranscript` (around line 100); `packages/core/src/session/runner/to-llm-message.ts`, `toolResult`, `assistant`, `toLLMMessages` (lines 125, 153, 327) | Lowers the persisted completed tool content into the normal tool-result message paired with the original tool call. A single text item becomes a text result; multiple items become a content result. |
| `packages/core/src/session/runner/llm.ts`, `drain`, `runStep` (lines 188–295) | Continues after local tool calls, reloads session context, and makes another model request. Planner can reason over A, call B in a later response, and then finish with its own proposal. |

This is a complete native foreground result transport. It requires no plugin-created inbox, synthetic result, polling, or Explorer store.

### Persisted session and child evidence

`packages/schema/src/session-message.ts`, `AssistantTool` and `ToolStateCompleted` (lines 138–174), define tool name/ID, status, input, content, metadata, optional provider execution fields, and created/ran/completed timestamps. **Completed tool state has no separate structured `output` field.** The machine output exists at the executor boundary; persisted Planner evidence is content plus metadata, not `state.output.output`.

`packages/core/src/session.ts`, `Session.create` (lines 250–285), creates a new ID when none is supplied and inherits the parent's full location, including workspace identity, as well as metadata and session permission overrides. Target role comes from the explicit create argument. Consequently require empty session overrides for both Planner and Explorer; do not assume child creation erases a parent's overrides.

The child bootstrap is one ordinary native prompt:

```text
You are a subagent spawned by another session.
<exact Explorer call prompt>
```

There is no automatic copy of Planner's conversation into a fresh Explorer. Planner must include the focused question and relevant context in `prompt`. Model inheritance is independent of authority.

The child retains its own user, assistant, tool, and idle history. `packages/core/src/session/execution.ts`, `terminal` (line 50) and coordinator `settled` (lines 119–149), emit execution success/failure/interruption. `packages/core/src/session/projector.ts`, terminal execution projection (lines 406–433), persists `outcome: "succeeded"` and idle time. `packages/core/src/session/message-updater.ts`, execution terminal handlers (lines 142–148), also append idle history. Successful **tool** completion alone is therefore not enough to verify successful **child** settlement.

`packages/protocol/src/groups/session.ts`, `SessionsQueryFields` / `SessionsQuery` (lines 58–83, 165–172), and `packages/core/src/session/store.ts`, `SessionStore.list` (lines 99–136), expose paginated parent-ID-filtered child listing. Use this native evidence to detect unreferenced children and Explorer grandchildren, not an application lifecycle registry. A parent-ID-only list can include children with changed locations; do not filter unexpected children away by directory. `packages/server/src/handlers/session.ts`, `session.list` (line 60), supplies pagination cursors.

### Native UX

`packages/tui/src/util/session.ts`, `sessionFamily` (line 9), walks `parentID` relationships from the root and recursively includes descendants with tree prefixes. `packages/tui/src/routes/session/composer/subagents-tab.tsx`, `SubagentsTab` (line 24), uses that family with native status and navigation, including completed entries through its inactive view. `packages/tui/src/routes/session/index.tsx`, `Subagent` (line 3106), navigates a tool row using `metadata.sessionID`; its parent navigation action (around line 1291) returns to the immediate parent.

Explorer children therefore participate in the existing root → Planner → Explorers family and ordinary session routes. No custom registration, row, or UI is required. Actual rendering/navigation and return to trusted root controls still require later live validation; UX visibility is not authority evidence.

## 2. Native Explorer → Planner Result Flow

Planner invokes the native tool with exactly:

```json
{
  "agent": "explorer",
  "description": "Investigate existing extension points",
  "prompt": "Investigate the assigned goal and relevant existing mechanisms; return concrete findings, constraints, alternatives, and file/symbol references."
}
```

With effective depth 2 and the target-specific permission, OpenCode creates a fresh native Explorer child of Planner and submits the prefixed user prompt. Explorer reads/searches the codebase and ends with findings as ordinary assistant text. Native execution waits for the child and selects its newest completed, error-free assistant message; its text parts become the job output.

On ordinary success the subagent executor returns:

```ts
{
  output: { sessionID: explorerID, status: "completed", output: findings },
  content: `<subagent sessionID="${explorerID}" state="completed">\n${findings}\n</subagent>`,
  metadata: { sessionID: explorerID, status: "completed" }
}
```

The session runner normalizes this model content, applies host output bounding, and persists it on Planner's completed tool part. Subsequent Planner model requests receive that persisted content as a normal tool result. The XML-like wrapper is model text, not a proposal publication or CAP receipt. Planner can read it, compare it with its own investigation, request another fresh Explorer with a refined question, and eventually emit its own final structured proposal.

The essential persisted shape is:

```ts
{
  type: "tool",
  id: nativeCallID,
  name: "subagent",
  state: {
    status: "completed",
    input: { agent: "explorer", description, prompt },
    content: [/* normalized/bounded native model content */],
    metadata: {
      sessionID: explorerID,
      status: "completed",
      // ordinarily also truncated: false, or truncated: true and outputPath
    }
  },
  time: { created, ran, completed }
}
```

Trusted `message.list` reads can observe this same projected content/metadata; normal model lowering does not secretly substitute the structured executor output. The child session/history independently exposes its role, parent, location, exact call prompt, tools, successful settlement, and full final findings. Those native records are sufficient to associate call ↔ specific child ↔ completed result without an Explorer lifecycle in this plugin.

There are two important representation limits:

1. `packages/core/src/tool-output.ts`, `ToolOutput.truncate` (lines 65–115), defaults to 2,000 lines / 50 KiB. Normal results gain `truncated: false`. Oversized text is saved by the **host** to its ordinary tool-output file and replaced with bounded content plus a marker; `sessionID` and `status` metadata are preserved alongside `truncated: true` and `outputPath`. The structured executor output is not what Planner later receives. Its child's full assistant text can differ from persisted returned content. Do not require exact wrapper or findings equality, assume one content item, or introduce plugin storage to compensate. Recommend concise Explorer findings. Under strict deny-all plus read/glob/grep, `external_directory` is also denied, so automatic permission to reread a host output file outside the workspace must not be assumed.
2. Native context selection/compaction can later summarize earlier messages; after hooks can alter model content. Trusted full-history reads and normal model context selection serve different purposes. Preserve the current fail-closed rejection of compaction, synthetic continuation/background messages, and other unexpected history rather than adding recovery or treating summaries as binding evidence. The native `NO_TEXT` fallback also does not prove that Explorer supplied findings: require actual nonempty final child text.

For the supported uncomplicated history, the persisted result is exactly the content subsequently supplied to Planner. Neither complete child transcripts nor result metadata become Planner reasoning automatically; the tool content is the returned findings channel. No custom transport is necessary.

## 3. Recommended Minimal Issue #13 Architecture

Keep the outer lifecycle unchanged:

```text
User → Orchestrator → Planner
                       ├─ fresh foreground Explorer A → findings A
                       ├─ fresh foreground Explorer B → findings B
                       └─ optional further fresh Explorers → findings
                    → Planner's single final proposal
                    → trusted Plan publication → local Authorize / Cancel
                    → existing CAP-gated Implementer → gate → STOP
```

Planner remains read-only, may investigate directly, and chooses zero or more focused Explorer questions. It consumes each result before deciding whether another investigation is useful. It owns comparison, synthesis, exact file scope, and the single final `intent/plan/files` proposal. Explorer findings are advisory text, even if they recommend an implementation approach.

Use ordinary `.opencode/agents/explorer.md`, `mode: subagent`, visible to native discovery. Its system prompt should ask it to investigate the assigned goal in the existing codebase, identify reusable mechanisms and viable concrete approaches, describe materially different alternatives when they exist, identify constraints/trade-offs, and return useful paths/symbols with reasoning and optionally a recommendation to Planner. It must never edit, implement, delegate, seek authority, or act as the authoritative Planner. No `intent/plan/files` schema or JSON contract is needed for its findings.

Use these ordered Planner permissions:

```yaml
permissions:
  - { action: "*", resource: "*", effect: deny }
  - { action: read, resource: "*", effect: allow }
  - { action: glob, resource: "*", effect: allow }
  - { action: grep, resource: "*", effect: allow }
  - { action: subagent, resource: explorer, effect: allow }
```

Use these ordered Explorer permissions:

```yaml
permissions:
  - { action: "*", resource: "*", effect: deny }
  - { action: read, resource: "*", effect: allow }
  - { action: glob, resource: "*", effect: allow }
  - { action: grep, resource: "*", effect: allow }
```

With the correctly installed effective policies and no session overrides, Explorer cannot invoke mutation tools, shell/execute, session control, further subagents, or commit through native tools. Its prose cannot grant implementation authority. This uses the existing trusted-host/deployment assumptions; it is not an OS sandbox or protection against arbitrary trusted plugin replacement.

Enable the native nesting prerequisite with project configuration:

```json
{ "experimental": { "subagent_depth": 2 } }
```

Recommend adding this to a normal project `opencode.json` during implementation, preserving other configuration if present. This repository currently contains no project OpenCode JSON configuration or plugin code enabling that setting. `Config.latest` selects the latest experimental object, so the effective deployment value must be checked during dogfood; a higher-priority override can restore the default. This is a standard host configuration requirement, not a workflow layer or CAP change.

Every Explorer call should omit `sessionID`, `background`, and `model`. Include enough task context for its fresh conversation. Ask Planner to make one foreground Explorer call per model response and await its returned findings before another call. No mandatory number of Explorers, custom scheduling, or model selection is needed.

The native runner can fork multiple local tool calls from one provider response (`SessionStep.attempt`); foreground does not itself mean that every call in a single response is serial. Native background also has jobs, immediate running results, later synthetic completion notifications, and even a foreground wait can be backgrounded by host control. Classify background/concurrent Explorer execution as **additional lifecycle complexity outside Issue #13**. Accept only the fresh foreground sequential shape; a running-result/background notification history fails verification. Ordinary sequential A → reasoning → B has no nesting/depth accumulation: every Explorer is at the same depth 2, and each result is available before the next model response.

No Explorer store, inbox, polling, synthetic result channel, retained lifecycle, scheduler, retries/recovery, workflow phase, CAP grant, or custom UI is warranted. OpenCode's internal native job bookkeeping remains host-owned.

## 4. Recommended Trusted Verification

Make Planner-history validation capable of awaited native Explorer reads, and invoke it at **both** `bindNativeAttempt` and `verifyParentPlanner`. Reuse existing checks after awaits, identity/idle checks, and full message pagination. Keep any call/child collections local to this verification pass.

Verify these facts:

1. **Existing exact Planner boundary.** Preserve root identity, one root user request, one root native Planner call, exact proposed arguments and trusted effective-input receipt, exact Planner parent/role/location/workspace, empty permission overrides, successful idle session, no pending inbox or active execution, and exact Issue #11 bootstrap. The eventual final proposal must remain the final text of that bound Planner, with the same input/final IDs and exact text retained today.
2. **Planner activity allowlist.** All assistant messages belong to `planner` and have no error. Retain the supported history kinds (`user`, `assistant`, `idle`, `model-switched`), one exact bootstrap user, successful completion/terminal idle, and nonempty final assistant text with `finish: "stop"`. Allow only completed `read`, `glob`, `grep`, and specifically validated native `subagent` parts. Reject every other tool name, alias, streaming/running/error tool state, extra user input, agent/location switch, synthetic/control message, compaction, or other unsupported history. Do not generalize the current denylist.
3. **Each Explorer call.** Require native tool name `subagent`, local execution rather than a provider-hosted result, completed tool status, exact input keys `agent/description/prompt`, `agent === "explorer"`, and nonempty string description/prompt. Require native completion metadata with a nonempty string `sessionID` and `status === "completed"`; require valid nonempty returned model content. Reject optional keys even if `background: false` or an empty continuation value would be normalized by the host. Validate the original persisted input, not a reconstructed/stripped argument object. Ignore unrelated harmless metadata rather than fingerprinting whole metadata arrays.
4. **Fresh sequential children.** Require distinct call IDs and distinct child IDs, none equal to root or Planner. Use the supported one-Explorer-call-per-assistant-response shape, with calls in preceding Planner responses and a subsequent final synthesis response. Reject multiple Explorer calls in the same response as outside this sequential contract; native tool fibers can execute those concurrently. Do not add a clock-based scheduler or retain lifecycle phases to prove sequencing. Exact fresh bootstraps and one child per call also reject continuation/reuse.
5. **Child identity and completion.** Fetch the exact referenced session. Require `id` agreement, `agent === "explorer"`, `parentID === bound Planner ID`, matching directory/workspace, no fork/revert/archive, empty session permission overrides, successful outcome and idle time, no active execution, and empty pending inbox. Apply the same malformed/paginated-history checks as Planner.
6. **Child activity and findings.** Require one first, plain bootstrap user with text exactly `nativeBootstrap(call.prompt)`, no added input/control, only the same supported history kinds, error-free assistant messages all from `explorer`, completed `read/glob/grep` tools only, successful terminal idle, and a final `finish: "stop"` assistant with nonempty actual text. Any Explorer `subagent`, mutation, shell/execute, session control, unknown tool, or unfinished/failed tool rejects the attempt. Do not parse findings as a proposal or require their content to agree with Planner's final proposal.
7. **Closed local topology.** Read all direct children of Planner using native parent-ID-filtered paginated session listing and require its ID set to equal the unique children referenced by accepted Explorer calls, including the empty set for zero calls. Require every Explorer to have no children. Reject orphan/unreferenced children, duplicate references, wrong parent/role, or hidden extra descendants. Do not use directory-filtered listings that omit an unexpectedly moved child. Detect duplicate IDs and repeated cursors and fail when complete evidence cannot be read. This is native observation during verification, not a custom lifecycle registry.
8. **Final authority remains exact.** Return only the existing Planner `Child` binding (`inputID`, `finalID`, exact proposal text). Publication, decision-time revalidation, proposal parsing/candidate integrity, Git freshness, authorization transfer, and Implementer admission continue unchanged. Explorer verification must run again at decision time so later child input, permission changes, disallowed activity, or topology drift are caught even when Planner's final text is unchanged.

The result association rests on native completed-call metadata plus the actual successful child's identity, bootstrap, and final history. Returned content must be present and well formed, but its XML wrapper, item count, truncation marker, or byte equality with full child findings is not an authority condition. Do not read a transient host output file to make authorization depend on its retention. Native output normalization and after hooks are trusted host behavior; metadata is corroborated against the actual child, not trusted alone.

Do **not** retain Explorer calls, output text, hashes, receipts, or completion flags in `Bound`, `PublishedAttempt`, CAP state, an authority candidate, or a persisted Explorer registry. Native transcripts retain advisory evidence. Revalidation checks current supported semantic facts; it need not freeze advisory text byte-for-byte between publication and authorization. Only Planner's exact final proposal crosses the publication/authorization boundary. There is no new effective-input receipt for Planner's advisory Explorer question: it comes from the native call and is matched directly to the native child bootstrap.

A pre-existing history limitation should stay explicit: native reads can discover nested `AGENTS.md` and emit instruction synthetics (`tool/plugin/read.ts`, read executor; `session/instructions.ts`, `SessionInstructions.load`). Native instruction updates can also produce system messages. The current Planner whitelist already rejects these and compaction. Preserve that conservative rejection in this minimal pass and apply it to Explorer; do not silently whitelist arbitrary synthetic/system input while enabling delegation. Ordinary uncomplicated code exploration works, but an attempt with these additional records remains planning-only/fails trusted publication. Supporting broader instruction/recovery histories is a separate boundary question, not required transport machinery for #13.

## 5. Implementation Impact

Expected future changes:

| Repository file | Purpose |
| --- | --- |
| `.opencode/agents/explorer.md` | New read-only, non-delegating investigation role returning advisory findings. |
| `.opencode/agents/planner.md` | Target-specific delegation allow; fresh sequential foreground guidance; consume findings and own one final proposal. |
| `src/attempt.ts` | Awaited Explorer identity/history/topology verification with strict tool allowlists, before publication and again before authorization. |
| `test/attempt.test.ts` | Focused trusted-double fixtures for valid/invalid native Explorer records, child listing/pagination, policy, and unchanged final binding. |
| `docs/v1-orchestration.md` | Normative advisory topology, native result behavior, depth prerequisite, and supported history limits once implemented. |
| `test/native-compatibility.test.ts` | Small additional guards for genuinely new pinned seams: depth 2, native foreground completion metadata/content, and persisted content → model result lowering. Avoid an exhaustive host-source snapshot. |
| **`opencode.json` (new)** | **Additional concrete requirement:** enable `experimental.subagent_depth: 2`; role frontmatter alone cannot admit nesting. |

The anticipated list therefore needs one small native configuration addition. Documentation alone could instead make depth 2 a deployment prerequisite, but then installing these roles without that setting would still fail to launch Explorer. Prefer explicit project configuration for this repository.

There is no source-demonstrated requirement to modify `src/native.ts`, CAP state, Implementer admission/sponsorship, authorization RPC, or TUI authorization lifecycle. Any later proposal to touch those for Explorer result transport or bookkeeping would be an architecture concern and should be justified by new concrete evidence. No such change is recommended here.

## 6. Testing and Live Validation Implications

Keep automated verification at the current trusted-double layer in `test/attempt.test.ts`, extending the local fixtures with Explorer histories and native child listing. Use the existing test-scoped Git observation substitute; no real Git repositories or production mocking seams are needed for these behaviors.

Minimum useful coverage:

| Case | What automated coverage should prove |
| --- | --- |
| Zero calls | Existing Planner publication and exact proposal binding still succeed; no Planner children are present. |
| One call | Completed native call metadata binds the correct successful Explorer child; advisory findings may be prose; only Planner JSON is published. |
| Multiple fresh calls | Distinct Explorer IDs and exact child bootstrap prompts are admitted across successive Planner assistant responses; no extra children exist. |
| Sequential refinement | Model-independent fixture has findings A, a later B prompt using A's concrete discovery, findings B, and final Planner synthesis. This proves acceptance of the transcript shape, not that a real model consumed A. Native source guards cover persisted content lowering; live dogfood proves actual use. |
| Wrong identity/topology | Wrong target argument, child agent/assistant agent/parent/directory/workspace, self/root reference, reuse, fork/revert/archive, overrides, missing child, orphan child, or any Explorer descendant rejects. |
| Malformed/incomplete calls | Missing/wrong-typed/extra argument keys, empty question/description, missing/wrong child ID/status metadata, invalid/empty content, native no-text child, streaming/running/error call, failed/interrupted child, active execution or pending inbox rejects. Test optional `background`, `sessionID`, and `model`, including benign-looking values. |
| Disallowed Planner tool | Any tool outside read/glob/grep/validated Explorer call rejects, including native `shell`, patch/write/edit, execute, session control, namespaced aliases, and unknown tools. |
| Disallowed Explorer tool | Any tool outside read/glob/grep rejects; specifically cover mutation, shell/execute, session control and unknown tools. |
| Nested delegation | An Explorer subagent tool or child session rejects regardless of its reported success. |
| Concurrent/background shape | Multiple Explorer calls in one response, returned native status `running`, or later synthetic completion notification rejects this bounded foreground contract. |
| Native content variations | Successful association survives harmless metadata and native bounded/multiple text content items; full child findings may differ from a truncated returned result. No output hash/receipt or wrapper equality is needed. |
| Revalidation and exact final binding | Run rejection mutations both before publication and before authorization. Changed child history/topology/pending input rejects while an unchanged Planner proposal does not conceal it. Changed root request/effective receipt, final Planner ID/text/proposal, or publication still fails exactly as today. Explorer text never supplies published scope or authorizable JSON. |
| Pagination and cancellation | Paginated child/message reads handle zero/many children; duplicate IDs/repeated cursors fail; ownership/revocation/location checks remain active after newly introduced awaits. |
| Effective agent policies/config | Planner allows only the Explorer target; Explorer denies delegation/edit/shell/execute and other tools. Project depth setting is 2. Existing Orchestrator/Implementer rules and Issue #11 nested-pass-through tests remain intact. |

The small source compatibility guards should establish the new assumptions from Section 1 without executing the sibling source. The local host's `packages/core/test/tool-subagent.test.ts` already contains tests named `prevents subagents from launching subagents by default` (line 307), `allows nested subagents up to the configured depth` (line 349), and `runs a foreground child session and returns the final assistant text` (line 395). They corroborate the source design; they were inspected, not run in this pass.

Later live OpenCode 2.0.22 dogfood must demonstrate:

- Effective project depth 2, native Planner subagent visibility, and read-only Explorer permissions, with no approval escalation needed for its permitted tools.
- At least two fresh Explorer children in successive Planner responses: A investigates a concrete mechanism/constraint, Planner's next question uses A's returned finding, and B investigates the resulting focused alternative or trade-off.
- Actual returned findings in subsequent Planner context and a final proposal synthesized by Planner, not copied/published independently from Explorer.
- Normal root → Planner → Explorer navigation and return, including completed sessions and preservation of the existing trusted root Plan controls.
- One final exact Planner publication and unchanged existing Authorize/Cancel behavior; any authorized implementation validation remains through the existing CAP path and stops at its existing gate.

Unit transcripts cannot prove model reasoning, real provider tool-call behavior, effective loaded configuration, or rendered navigation. Source inspection establishes native capability; dogfood validates the installed composition. Oversized findings can be checked separately if needed, but do not build a custom truncation transport.

Eventual implementation validation commands:

```bash
bun test test/attempt.test.ts
bun test
bun run check
git diff --check
```

This investigation changes only this Markdown report. No implementation tests or live OpenCode/TUI dogfood were run; `git diff --check` was used for document review. No Docker, commit, push, or issue mutation was performed.

## 7. Open Questions / Blockers

No unresolved native transport, permission, topology, or authority question materially changes this design. The default depth gate is resolved by the supported native depth-2 configuration; it must be included in implementation/deployment, not assumed away. Model behavior and rendered navigation await the specified live validation and are not architecture blockers.

## 8. Conclusion

Architecture is straightforward; proceed with the minimal implementation.
