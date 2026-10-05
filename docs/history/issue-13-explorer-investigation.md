# Issue #13: Planner delegation to Explorer — investigation

**Historical evidence.** This completed investigation is non-normative. Its
findings and recommendations describe the recorded revisions, not current
implementation status. See the [current documentation map](../README.md).

The original pass was investigation only, against the then-current local implementation and OpenCode 2.0.22 source. No Issue #13 implementation or live host dogfood was performed during that investigation.

The recommendations incorporate the subsequent architecture decision reflected in the updated Issue #13: **Planner owns Explorer orchestration**, using native foreground calls for concurrent independent investigations and later dependent follow-ups. The original source findings remain valid.

**Authority-boundary correction (2026-10-03).** The original investigation recommended repeating Explorer child/history/topology verification at authorization. Architecture review of the uncommitted implementation established that this was too strong: foreground findings are captured and persisted in Planner history before synthesis, and only the exact final Planner proposal becomes authority. Explorer verification establishes advisory planning provenance before publication; publication severs ongoing child liveness from authorization. Later Explorer-only mutations, including between a child's final verification read and publication, cannot rewrite the already-returned Planner tool result or bound proposal. The recommendations and test expectations below are corrected accordingly. The original investigation-only scope and source findings above/below remain historical; this correction accompanies implementation simplification, without live host dogfood.

## 1. Source Findings

### Observed starting state and authorities

- `git status --porcelain=v1 --untracked-files=all` returned no entries before this investigation.
- `opencode-agents` HEAD: `fae0b9ec3718579ab7ede955e2d7010295fcbd4a`.
- The requested initial `opencode --version` command failed because the sandbox denied opening the normal host log at `/Users/mike/.local/share/opencode/log/opencode.log`. Repeating **only the version command** with `XDG_DATA_HOME=/private/tmp/issue-13-opencode-version` succeeded and printed `opencode v2.0.22`. No server, session, or TUI was launched.
- Local authoritative source: sibling `../opencode`, HEAD `527f0b931d1f9b3ebd34e106c51b31ce5db5b075`; its working tree was clean. Both `packages/cli/package.json` and `packages/core/package.json` declare `2.0.22`.
- Read [GitHub Issue #13](https://github.com/mikechao/opencode-agents/issues/13) through `gh issue view 13 --repo mikechao/opencode-agents --json number,title,body,state,url`. It was open, titled `[Feat]: Allow Planner to Delegate to Multiple Explorer Agents`, and matched the requested advisory, fresh foreground Explorer scope. The issue was not modified. Its invitation to implement is superseded by this pass's explicit investigation-only instruction.
- Before revising these recommendations, reread the updated issue with `gh issue view 13 --repo mikechao/opencode-agents`. It explicitly supports independent foreground calls together and dependent follow-ups later, with orchestration owned by Planner and native concurrency owned by OpenCode. Background Explorer execution remains out of scope. No broad source reinvestigation was needed.

All host citations below refer to files beneath `../opencode/` at the source HEAD above. File paths and symbols, rather than installed-host assumptions, establish the conclusions. No sibling source was modified, built, or run.

### Implementation boundary at the original investigation

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
| `packages/core/src/session/runner/step.ts`, `SessionStep.make` / `attempt` (lines 88–143) | Forks local tool executions from one provider response, allowing multiple foreground calls to execute concurrently; bounds their content through `ToolOutput.truncate`, publishes tool completion, and joins tool executions before the next step. |
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

The session runner normalizes this model content, applies host output bounding, and persists it on Planner's completed tool part. Subsequent Planner model requests receive that persisted content as a normal tool result. When Planner emits several independent foreground Explorer calls in one response, OpenCode executes those calls using its normal native tool fibers and waits for them before the next model step. Each completed result is paired with its own tool call in Planner context. Planner can compare those findings with its own investigation, request another fresh Explorer with a dependent refined question in a later response, and eventually emit its own final structured proposal. The XML-like wrapper is model text, not a proposal publication or CAP receipt.

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
                       ├─ fresh foreground Explorer A ─┐
                       ├─ fresh foreground Explorer B ─┼─ independent investigations
                       └─ fresh foreground Explorer C ─┘
                    ← completed native results
                    → Planner reasoning
                       └─ fresh foreground Explorer D → dependent follow-up if useful
                    → Planner synthesis → single final proposal
                    → trusted Plan publication → local Authorize / Cancel
                    → existing CAP-gated Implementer → gate → STOP
```

Planner remains read-only, may investigate directly, and owns Explorer orchestration: it chooses zero, one, or multiple focused questions according to the planning goal and their dependencies. Independent questions may be issued together as multiple native foreground calls in one Planner response. After their completed findings return into normal model context, Planner may issue later dependent follow-ups. A single planning attempt may mix concurrent independent exploration and sequential dependent refinement. Planner owns comparison, synthesis, exact file scope, and the single final `intent/plan/files` proposal. Explorer findings are advisory text, even if they recommend an implementation approach.

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

Recommend adding this to a normal project `opencode.json` during implementation, preserving other configuration if present. At the original investigation, this repository contained no project OpenCode JSON configuration or plugin code enabling that setting; the subsequent implementation adds project configuration. `Config.latest` selects the latest experimental object, so the effective deployment value must be checked during dogfood; a higher-priority override can restore the default. This is a standard host configuration requirement, not a workflow layer or CAP change.

Every Explorer call should omit `sessionID`, `background`, and `model`. Include enough task context for its fresh conversation. Ask Planner to use Explorers for useful aspects or alternative ways of satisfying the goal, launch independent investigations together when useful, use later follow-ups when a question depends on earlier findings, and synthesize all useful findings into one final proposal. There is no one-call-per-response restriction or mandatory number of Explorers.

The native runner can fork multiple local tool calls from one provider response (`SessionStep.attempt`) and joins those executions before Planner continues its reasoning. This ordinary **foreground concurrency is supported** and needs no plugin-managed scheduler, worker pool, join state, or concurrency bookkeeping. Independent calls in one response and dependent calls in later responses create fresh sibling Explorers at the same depth 2; neither pattern accumulates nesting depth.

**Background Explorer execution remains outside Issue #13.** Native background introduces immediate running results and later synthetic completion notifications; even a foreground wait can be backgrounded by host control. Reject unsupported optional keys, running-result metadata, and background notification history. That lifecycle exclusion does not restrict multiple otherwise valid completed foreground calls in the same response. Trusted `opencode-agents` code verifies the resulting calls and children without scheduling Explorer work or imposing a sequencing policy.

No Explorer store, inbox, polling, synthetic result channel, retained lifecycle, scheduler, retries/recovery, workflow phase, CAP grant, or custom UI is warranted. OpenCode's internal native job bookkeeping remains host-owned.

## 4. Recommended Trusted Verification

Make planning acceptance capable of awaited native Explorer reads at `bindNativeAttempt`, before publication. Reuse existing checks after awaits, identity/idle checks, and full message pagination. Keep any call/child collections local to this verification pass. Contrary to the original recommendation, `verifyParentPlanner` must revalidate the existing authority-bearing root/Planner binding without reopening advisory Explorer sessions.

Verify these facts:

1. **Existing exact Planner boundary.** Preserve root identity, one root user request, one root native Planner call, exact proposed arguments and trusted effective-input receipt, exact Planner parent/role/location/workspace, empty permission overrides, successful idle session, no pending inbox or active execution, and exact Issue #11 bootstrap. The eventual final proposal must remain the final text of that bound Planner, with the same input/final IDs and exact text retained today.
2. **Planner activity allowlist.** All assistant messages belong to `planner` and have no error. Retain the supported history kinds (`user`, `assistant`, `idle`, `model-switched`), one exact bootstrap user, successful completion/terminal idle, and nonempty final assistant text with `finish: "stop"`. Allow only completed `read`, `glob`, `grep`, and specifically validated native `subagent` parts. Reject every other tool name, alias, streaming/running/error tool state, extra user input, agent/location switch, synthetic/control message, compaction, or other unsupported history. Do not generalize the current denylist.
3. **Each Explorer call.** Require native tool name `subagent`, local execution rather than a provider-hosted result, completed tool status, exact input keys `agent/description/prompt`, `agent === "explorer"`, and nonempty string description/prompt. Require native completion metadata with a nonempty string `sessionID` and `status === "completed"`; require valid nonempty returned model content. Reject optional keys even if `background: false` or an empty continuation value would be normalized by the host. Validate the original persisted input, not a reconstructed/stripped argument object. Ignore unrelated harmless metadata rather than fingerprinting whole metadata arrays.
4. **Fresh children, independent of execution order.** Require unique call IDs and unique fresh child IDs, none equal to root or Planner. Accept multiple valid Explorer calls in one Planner assistant response, calls across later responses, and transcripts mixing both patterns. Verify every call and its child independently; completion order and the number of calls per response are not admission conditions. Exact fresh bootstraps and one distinct child per call reject continuation/reuse. Do not introduce timestamp comparisons, scheduling state, concurrency state, ordering receipts, or lifecycle phases to distinguish concurrent from sequential execution. Planner's final synthesis still comes from the correct bound Planner after the native foreground results.
5. **Child identity and completion.** Fetch the exact referenced session. Require `id` agreement, `agent === "explorer"`, `parentID === bound Planner ID`, matching directory/workspace, no fork/revert/archive, empty session permission overrides, successful outcome and idle time, no active execution, and empty pending inbox. Apply the same malformed/paginated-history checks as Planner.
6. **Child activity and findings.** Require one first, plain bootstrap user with text exactly `nativeBootstrap(call.prompt)`, no added input/control, only the same supported history kinds, error-free assistant messages all from `explorer`, completed `read/glob/grep` tools only, successful terminal idle, and a final `finish: "stop"` assistant with nonempty actual text. Any Explorer `subagent`, mutation, shell/execute, session control, unknown tool, or unfinished/failed tool rejects the attempt. Do not parse findings as a proposal or require their content to agree with Planner's final proposal.
7. **Closed local topology.** Read all direct children of Planner using native parent-ID-filtered paginated session listing and require its ID set to equal the unique children referenced by accepted Explorer calls, including the empty set for zero calls. The invariant is accepted Planner Explorer calls ↔ the exact set of fresh Explorer children, regardless of how calls are grouped into responses or executed. Require every Explorer to have no children. Reject orphan/unreferenced children, duplicate references, wrong parent/role, or hidden extra descendants. Do not use directory-filtered listings that omit an unexpectedly moved child. Detect duplicate IDs and repeated cursors and fail when complete evidence cannot be read. This is native observation during verification, not a custom lifecycle registry.
8. **Final authority remains exact.** Return only the existing Planner `Child` binding (`inputID`, `finalID`, exact proposal text). Publication, decision-time revalidation, proposal parsing/candidate integrity, Git freshness, authorization transfer, and Implementer admission continue unchanged. Explorer verification does not run again at decision time. Later child input, permissions, activity, or topology cannot change the bound proposal; invalid provenance observed while accepting planning still rejects publication. The observations do not promise continuous child freshness through publication or transfer.

The result association rests on native completed-call metadata plus the actual successful child's identity, bootstrap, and final history. Returned content must be present and well formed, but its XML wrapper, item count, truncation marker, or byte equality with full child findings is not an authority condition. Do not read a transient host output file to make authorization depend on its retention. Native output normalization and after hooks are trusted host behavior; metadata is corroborated against the actual child, not trusted alone.

Do **not** retain Explorer calls, output text, hashes, receipts, or completion flags in `Bound`, `PublishedAttempt`, CAP state, an authority candidate, or a persisted Explorer registry. Native transcripts retain advisory evidence. Authorization revalidation checks authority-bearing root/Planner/Plan facts; it neither rereads nor freezes advisory child text, permissions, pending input, or topology between publication and authorization. No Explorer watches or notification-timing synchronization are required. Only Planner's exact final proposal crosses the publication/authorization boundary. There is no new effective-input receipt for Planner's advisory Explorer question: it comes from the native call and is matched directly to the native child bootstrap.

A pre-existing history limitation should stay explicit: native reads can discover nested `AGENTS.md` and emit instruction synthetics (`tool/plugin/read.ts`, read executor; `session/instructions.ts`, `SessionInstructions.load`). Native instruction updates can also produce system messages. The current Planner whitelist already rejects these and compaction. Preserve that conservative rejection in this minimal pass and apply it to Explorer; do not silently whitelist arbitrary synthetic/system input while enabling delegation. Ordinary uncomplicated code exploration works, but an attempt with these additional records remains planning-only/fails trusted publication. Supporting broader instruction/recovery histories is a separate boundary question, not required transport machinery for #13.

## 5. Implementation Impact

Expected future changes:

| Repository file | Purpose |
| --- | --- |
| `.opencode/agents/explorer.md` | New read-only, non-delegating investigation role returning advisory findings. |
| `.opencode/agents/planner.md` | Target-specific delegation allow; Planner-owned orchestration of useful aspects/alternatives through fresh foreground calls, independent investigations together and dependent follow-ups later; synthesize useful findings into one final proposal. |
| `src/attempt.ts` | Execution-order-agnostic Explorer call/identity/history/topology verification with strict tool allowlists when accepting planning before publication; existing root/Planner authority revalidation at authorization, without Explorer liveness machinery. |
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
| Multiple fresh calls in one response | Multiple native foreground Explorer calls in a single Planner assistant response are accepted, each with a unique call ID, distinct child ID, exact bootstrap prompt, and its own valid completed result. Completion order does not affect acceptance; no extra children exist. |
| Dependent follow-up | Model-independent fixture has earlier returned findings, a later fresh Explorer prompt using a concrete discovery from those findings, its result, and final Planner synthesis. This proves acceptance of the transcript shape, not that a real model consumed the findings. Native source guards cover persisted content lowering; live dogfood proves actual use. |
| Mixed exploration and refinement | A and B are issued together in one response with distinct fresh children/results; a later D question uses their returned findings, followed by Planner's one final proposal. Accept this mixed transcript without scheduler, ordering receipts, or concurrency state. |
| Duplicate/reused or orphan children | Duplicate call IDs, two calls referencing the same child, child continuation/reuse, or Planner children absent from the accepted call set reject before publication and authorization. |
| Wrong identity/topology | Wrong target argument, child agent/assistant agent/parent/directory/workspace, self/root reference, reuse, fork/revert/archive, overrides, missing child, orphan child, or any Explorer descendant rejects. |
| Malformed/incomplete calls | Missing/wrong-typed/extra argument keys, empty question/description, missing/wrong child ID/status metadata, invalid/empty content, native no-text child, streaming/running/error call, failed/interrupted child, active execution or pending inbox rejects. Test optional `background`, `sessionID`, and `model`, including benign-looking values. |
| Disallowed Planner tool | Any tool outside read/glob/grep/validated Explorer call rejects, including native `shell`, patch/write/edit, execute, session control, namespaced aliases, and unknown tools. |
| Disallowed Explorer tool | Any tool outside read/glob/grep rejects; specifically cover mutation, shell/execute, session control and unknown tools. |
| Nested delegation | An Explorer subagent tool or child session rejects regardless of its reported success. |
| Background/running-result shape | Any `background` input key, returned native status `running`, or later synthetic completion notification rejects the foreground contract. Multiple valid completed foreground calls in one response are a positive case. |
| Native content variations | Successful association survives harmless metadata and native bounded/multiple text content items; full child findings may differ from a truncated returned result. No output hash/receipt or wrapper equality is needed. |
| Authority boundary and exact final binding | Reject invalid Explorer provenance observed at planning acceptance. After acceptance, later child history/topology/permissions/pending input or deletion cannot alter the returned Planner tool result or bound proposal and does not block authorization. Cover later child mutations during remaining publication reads with immediate or buffered notifications. Changed root request/effective receipt, final Planner ID/text/proposal, publication, or Git authority still fails closed. Explorer text never supplies published scope or authorizable JSON. |
| Pagination and cancellation | Paginated child/message reads handle zero/many children; duplicate IDs/repeated cursors fail; ownership/revocation/location checks remain active after newly introduced awaits. |
| Effective agent policies/config | Planner allows only the Explorer target; Explorer denies delegation/edit/shell/execute and other tools. Project depth setting is 2. Existing Orchestrator/Implementer rules and Issue #11 nested-pass-through tests remain intact. |

The small source compatibility guards should establish the new assumptions from Section 1 without executing the sibling source. The local host's `packages/core/test/tool-subagent.test.ts` already contains tests named `prevents subagents from launching subagents by default` (line 307), `allows nested subagents up to the configured depth` (line 349), and `runs a foreground child session and returns the final assistant text` (line 395). They corroborate the source design; they were inspected, not run in this pass.

Later live OpenCode 2.0.22 dogfood must demonstrate:

- Effective project depth 2, native Planner subagent visibility, and read-only Explorer permissions, with no approval escalation needed for its permitted tools.
- Planner launches at least two independent fresh Explorer investigations together in one response, covering useful implementation approaches or constraints. OpenCode owns their native foreground execution/concurrency.
- Their completed findings return into subsequent Planner model context before Planner continues reasoning.
- Where the scenario naturally supports it, Planner uses those findings to form a later dependent question for another fresh Explorer and receives its findings through the same foreground path.
- Planner synthesizes all useful findings into one final structured proposal.
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
