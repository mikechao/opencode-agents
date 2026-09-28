# Stock OpenCode path to the selected hybrid UX

Investigation only, 2026-09-28. All host conclusions below come from static declarations and the matching read-only source checkout. OpenCode was not launched. This report narrows the earlier [transcript projection investigation](trusted-transcript-projection-investigation.md) to transcript content that normal execution already produces and to supported project tools.

## 1. Verified baseline

| Item | Verified state |
| --- | --- |
| Implementation checkout | `6cd6ab4369ffd318ab1e92f1f9bdeed691bea932`, branch `main`; `git status --short` was empty before this report. |
| Project SDK | [`package.json`](../package.json) pins `@opencode/plugin` to `2.0.17`; installed `@opencode/plugin`, `@opencode/client`, and `@opencode/schema` manifests all report `2.0.17`. |
| Installed CLI | The `opencode` symlink resolves to the global `@opencode/cli` package; its manifest reports `2.0.18`. The executable was not invoked. |
| Host reference | Read-only `../opencode` is commit `cd9a14a6b688d4021bee381dfd39d2cef9c0f862`, exact tag `v2.0.18`. |

The relevant public plugin declarations are [`promise/tool.d.ts`](../node_modules/@opencode/plugin/dist/promise/tool.d.ts), [`promise/plugin.d.ts`](../node_modules/@opencode/plugin/dist/promise/plugin.d.ts), and [`tui/context.d.ts`](../node_modules/@opencode/plugin/dist/tui/context.d.ts). Host behavior is evidenced by the v2.0.18 source; the SDK declaration/host patch difference is explicit. The [hybrid decision](hybrid-authorization-ux-decision.md), [DX investigation](native-dx-ux-investigation.md), [nonmodal investigation](native-nonmodal-authorization-investigation.md), [Question reassessment](native-question-cap-reassessment.md), [M2 dogfood](milestone-2-live-dogfood.md), [native-child threat reassessment](milestone-2-native-child-threat-model-reassessment.md), and [CAP protocol](coding-authority-protocol.md) supply the settled product and authority boundaries.

## 2. Hard product constraint

**opencode-agents must run on unmodified stock OpenCode. Upstream host changes cannot be a prerequisite.** The production path cannot require a fork, installed-package patch, custom host build, or new OpenCode API. A future upstream rendering feature could improve presentation, but the project must already work without it.

The trusted active TUI generation still owns candidate construction, exact encoding/digest, canonical root, bound HEAD, session/message/tool IDs, whole-history snapshots, freshness, the local decision, and the one-use CAP grant. Conversation and tool results are presentation, never authorization. The selected compact `session.composer.top` strip uses direct local callbacks. No Form, Question, command, keymap, model prose, durable attempt state, or cross-process CAP service enters that decision path.

## 3. Existing Planner result in the root transcript

The native `subagent` executor completes the Planner child, returns `{sessionID, status: "completed", output}`, and supplies a text tool result `<subagent sessionID="…" state="completed">\nP\n</subagent>` ([host subagent tool, lines 200–267](../../opencode/packages/core/src/tool/plugin/subagent.ts)). The result is stored as a completed tool part of a root assistant message, alongside the original `agent`, `description`, and `prompt` input and the child `sessionID` metadata. It becomes later root model context through [tool-result lowering](../../opencode/packages/core/src/session/runner/to-llm-message.ts). Current M2 [`completedCall`, `resultMatches`, and `bind`](../src/m2/attempt.ts) already prove that the entire wrapper contains the exact Planner child final text, with the expected child ID, after separately checking child identity/history. This is canonical root history: it scrolls with that transcript and is rehydrated on route navigation/TUI reload ([row projection](../../opencode/packages/tui/src/routes/session/rows.ts), [session scrollbox](../../opencode/packages/tui/src/routes/session/index.tsx)). The Planner child itself remains navigable and persistent through the row's session ID. M2 live dogfood observed a navigable child and its ordinary result view.

The decisive UX detail is in [stock `ToolPart`/`Subagent`](../../opencode/packages/tui/src/routes/session/index.tsx): `ToolPart` dispatches `subagent` to a dedicated `Subagent` component; that component renders an `InlineTool` with a completion icon and `Planner Subagent — <description>`, and its click navigates to the child. It **never renders `props.output`**. There is no native result expansion in the parent row. The child result is available after navigation into the child, where assistant text uses the normal Markdown renderer, but it is not a readable plan block in the root transcript. At default medium verbosity the row stands alone; low verbosity can first collapse tool activity into a group ([grouping rules](../../opencode/packages/tui/src/routes/session/grouping/session.ts)). The `description` argument is documented as a short task label, also used as the child's title; it controls the label/title, not output visibility ([subagent schema and child create](../../opencode/packages/core/src/tool/plugin/subagent.ts)). The project can choose a clearer label by changing the model contract, but no supported field makes the result expanded or Markdown-rendered in the parent. Markdown in Planner output would render in the child, but current [`planner.md`](../.opencode/agents/planner.md) deliberately returns exact JSON, and the parent `Subagent` renderer ignores its text. No public TUI plugin hook replaces that native renderer; the public Markdown hook targets code blocks, not tool rows ([TUI plugin API](../../opencode/packages/tui/src/plugin/api.tsx)).

Thus this result already satisfies exactness, canonical scrolling/persistence, no model copy, no new state, and no upstream change **as stored data**, but it does not give conversation-native plan reading in the root. The user sees a label and must leave the root to inspect P. This is a material difference from the selected prototype, not a mere assistant-role distinction.

**EXISTING PLANNER RESULT IS EXACT BUT UX-INSUFFICIENT**

## 4. Verified root-final presentation

The root model receives the completed native subagent result as tool context ([LLM lowering](../../opencode/packages/core/src/session/runner/to-llm-message.ts)). The Orchestrator could be told to make its existing final answer equal to a deterministic wrapper of P. No extra user prompt or model turn is required: the root already produces one final answer after its two calls ([current role contract](../.opencode/agents/opencode-agents.md), [M2 `oneFinal`](../src/m2/attempt.ts)). The TUI renders assistant text as ordinary Markdown, making this the closest visual match to the hybrid screenshot ([`TextPart`](../../opencode/packages/tui/src/routes/session/message-parts.tsx)). M2 can compare final text byte-for-byte to `F(P)` before freezing/enabling the strip. Extra assistant text parts must be joined in host order, and any nonconforming text must STOP. That would keep prose out of CAP authority; the final is only verified presentation.

The dependency is still a model-mediated copy of potentially long, structured JSON or derived Markdown. Instructions cannot guarantee byte identity. Trailing whitespace, escaping, normalization, omissions, or an added sentence make the attempt unavailable even when the Planner and candidate are valid. The observed root-to-Planner prompt loss of one trailing space already demonstrates this class of fail-closed availability failure ([M2 dogfood](milestone-2-live-dogfood.md)). A deterministic wrapper adds exact bytes to reproduce; it does not remove the dependency. Correct byte comparison makes copying failure a DX/availability problem rather than a CAP correctness failure. An incorrect or relaxed comparison would create a correctness problem, so it is excluded. Extra model prose after a verified plan would require a fixed final contract to avoid a competing presentation.

This could be a fail-closed stock-host fallback. It is structurally a poor primary dependency when a supported tool can carry the exact result without another model copy. **VERIFIED ROOT FINAL IS TOO FRAGILE** as the production presentation primitive.

## 5. Self-contained presentation tool

### Supported definition, runtime, and context

The installed 2.0.17 Promise plugin API exposes `context.tool.transform(editor => editor.add(...))`, and the matching v2.0.18 host installs these definitions into its normal Location-scoped tool registry ([declaration](../node_modules/@opencode/plugin/dist/promise/tool.d.ts), [host adapter](../../opencode/packages/plugin/src/promise/adapter.ts), [core tool registry](../../opencode/packages/core/src/tool.ts)). A project-shipped server plugin can register a uniquely named direct tool, for example `present_plan`, with `options: {codemode: false}`; the root agent's deny-all permissions would then explicitly allow only that tool plus the two existing `subagent` targets. A custom tool returns `content: string` or text content items; the host normalizes, records, and exposes them to later model context just like other local tool results ([tool schema](../../opencode/packages/schema/src/tool.ts), [runtime](../../opencode/packages/core/src/tool/runtime.ts), [publisher](../../opencode/packages/core/src/session/runner/publish-llm-event.ts)). The server plugin runs in the host's server/Location plugin graph, separate from the TUI plugin and its activation-private CAP state ([server plugin loader](../../opencode/packages/core/src/plugin/module.ts), [TUI plugin loader](../../opencode/packages/tui/src/plugin/context.tsx)). No mutable candidate/grant state should be shared across those processes.

The execute context supplies `sessionID`, `agent`, `messageID`, tool-call `id`, abort signal, and progress callback. The plugin setup context supplies the current Location and `session.get`/other session methods, but **does not expose `message.list` or a Planner child transcript reader** ([tool context](../node_modules/@opencode/plugin/dist/promise/tool.d.ts), [Promise session domain](../../opencode/packages/plugin/src/promise/session.ts)). The TUI plugin has a separate full `OpenCodeClient` and can perform the authoritative readback. A server plugin could construct its own public HTTP client, but that adds endpoint/credential/race coupling and is unnecessary here.

### Exact-content choices

| Form | Feasibility and consequence |
| --- | --- |
| C1: `{text: P}` | Supported as a schema input. The tool can echo/format it, and M2 can compare its recorded input/output to the bound Planner P. A bad copy merely STOPs; the tool grants nothing. But it repeats the model-copy reliability problem and can put a large plan into the generic row's argument summary. |
| C2: `{plannerSessionID}` | The execute context does not itself provide child history or a message-list method. A model-chosen child ID could be rejected by the later binder, but obtaining the final child text directly requires an additional client path or the hook below. The ID argument alone is not evidence of which child belongs to the current root. |
| C3: `{}` with a captured native result | **Supported and preferred.** The same server plugin can subscribe to `context.tool.hook("execute.after", …)`. This event exposes the completed native call's root `sessionID`, root agent, assistant `messageID`, tool-call ID, input, and normalized result. The native `subagent` result includes exact `output.output` P and `output.sessionID` ([hook declaration](../node_modules/@opencode/plugin/dist/promise/tool.d.ts), [core hook dispatch](../../opencode/packages/core/src/tool.ts), [subagent result](../../opencode/packages/core/src/tool/plugin/subagent.ts)). A short-lived map keyed by root session ID can retain one Planner observation until `present_plan({})` executes; reject missing, duplicate, mismatched-agent, or already-consumed observations. This map is **presentation cache only**, not candidate/approval state. The later TUI M2 binder independently checks the canonical parent and child histories and the exact presentation output. A server reload/cache loss simply makes the tool fail and the attempt STOP. |

The C3 tool can decode P's exact `intent`/`plan`/`files` shape and produce a deterministic, complete plain-text layout `F(P)` with those fields. Formatting must preserve every decoded field string exactly and be byte-reproducible from P; the TUI binder recomputes `F(P)`, requires equality, and separately runs the authoritative `parseProposal(P, canonicalRoot)` validation. The tool can alternatively return P itself, but the existing JSON is less readable. A meaningful root/HEAD/digest cannot be frozen inside this tool while the parent is still executing: M2 freezes the candidate after the parent finishes, using trusted TUI Git observations. The tool must not maintain candidate state or ask the TUI server for a grant. The compact trusted strip can show the canonical root, bound HEAD, candidate digest, and implementation-only scope after M2 freezes C. Together the plan row and strip display the complete candidate meaning; the strip should not silently abbreviate away the worktree identity.

The tool result is subject to stock output truncation before it enters history: the runner calls `ToolOutput.truncate`, with defaults of 2,000 lines and 50 KiB ([runner](../../opencode/packages/core/src/session/runner/step.ts), [limits](../../opencode/packages/core/src/tool-output.ts)). The binder must reject `metadata.truncated`, non-exact text, multiple text chunks where the contract expects one, and any oversized proposal that cannot be presented completely. The tool should impose a smaller explicit bound and fail rather than present a knowingly clipped plan.

### Actual stock rendering

An unknown custom tool goes to `GenericTool`, an ordinary root transcript tool part ([`ToolPart` and `GenericTool`](../../opencode/packages/tui/src/routes/session/index.tsx)). The default row shows the tool name and a primitive input summary; with `{}` it reads essentially `present_plan`. **Output is collapsed by default.** Clicking the row expands an `output:` field in the normal scrollable transcript. The full returned text is plain wrapped text, **not Markdown-rendered**; `GenericTool` uses `<text wrapMode="word">`, while only assistant `TextPart` uses `<markdown>` ([generic component](../../opencode/packages/tui/src/routes/session/index.tsx), [assistant text component](../../opencode/packages/tui/src/routes/session/message-parts.tsx)). At low verbosity an activity group can require an additional click before the tool row is available. Expansion is local UI state and may reset on navigation or TUI reload, but the canonical tool content persists and can be expanded again. No SDK option sets a title/subtitle, expanded-by-default flag, result visibility, Markdown renderer, or per-tool TUI component. Tool `description` describes the callable tool to the model; return `metadata` is not a generic display template. The public TUI registration surfaces provide page/slot and Markdown code-block contributions, not a tool-name renderer. There is no supported override for the native `subagent` renderer either.

This is a real stock-host path to an exact, persistent, inspectable plan in the root transcript, with no copy and no new CAP state. It does **not** reproduce the prototype's immediately visible Markdown assistant block. The expanded plain-text tool block is an accepted UX compromise subject to the one bounded user-run probe in §12.

**SELF-CONTAINED PRESENTATION TOOL IS VIABLE**

## 6. Best stock-host ordering

| Order | Assessment |
| --- | --- |
| A: Planner → `present_plan` → `implementer_slot` → root final | **Preferred.** The capture exists as soon as Planner completes; the user can inspect the plan before the harmless slot bootstrap finishes. The current post-parent freeze still has both child identities/history. Only one extra root tool part and one call permission are added. Require a tiny fixed final acknowledgment so later prose cannot present another plan. |
| B: Planner → `implementer_slot` → `present_plan` → root final | Technically valid and perhaps puts the plan nearer the final line, but it delays presentation and changes the established Planner-first/slot-second relationship more in the binder's ordered contract. It gains no binding fact needed by the presentation-only tool. |
| C: Planner → `present_plan` → root final → create/warm slot later | Creates a trusted post-parent child path and changes the settled same-child native M2 bootstrap identity/order. It is unnecessary and not the smallest M2 change. |

In A, the root can still emit confusing text after the tool unless the binder constrains all assistant text to empty before the final and makes the final one fixed, non-plan acknowledgment. The selected plan presentation is specifically the unique `present_plan` result. Candidate freeze remains after successful root completion, as today; `implementer_slot` still exists before authorization and is switched only after the local affirmative decision and existing checks.

## 7. Rendering / UX comparison

| Surface | Root visibility and interaction | Scroll, reload, and fidelity to prototype |
| --- | --- | --- |
| Native Planner `subagent` | Default root label; click navigates to child. No parent expansion of result. | Root tool wrapper persists, but the full plan is read in the child. Fails the conversation-native root reading goal. |
| `present_plan({})` result | Default root `present_plan` row; one click expands `output:` (possibly another click for low-verbosity activity group). Plain text, no Markdown. | Expanded block scrolls in normal root transcript. Content persists across reload/navigation; expansion state need not. Exact deterministic plan; closest non-copy supported path. |
| Verified root final | Immediately visible ordinary Markdown assistant text. | Best screenshot match and persistent, but exact model echo can frequently STOP. |
| Hybrid prototype | Immediately visible ordinary assistant-style plan block plus compact strip. | Visual target; its `session.import` fixture did not append to the live bound root ([decision](hybrid-authorization-ux-decision.md)). |

The selected decision seeks conversation-native reading, not a particular database role. A correctly expanded tool result is usable in that sense, but it requires a click and lacks Markdown typography. The compact `session.composer.top` strip should identify the candidate and provide direct local Authorize/Cancel, while making clear that the plan to inspect is the `present_plan` row. It does not need to duplicate the full proposal. A full composer-top card remains the safe fallback if the live interaction proves the collapsed row too awkward for informed authorization.

## 8. Threat analysis

The property is: **can a model-controlled actor make the local strip authorize C while trusted code accepts a different plan presentation as C?** Under the strict binder below, no: the presentation tool result must equal `F(P)` for the exact child P used to freeze C. Unrelated prose is not an accepted presentation, and the final acknowledgment must not contain a competing plan. A bad call, absent call, duplicate call, or changed history means STOP rather than an altered grant.

| Actor | Capability and required boundary |
| --- | --- |
| Stock host/TUI | Trusted to execute tools, store canonical results, render the tool row/strip, and invoke direct local callbacks. Its generic renderer is a UX limit, not CAP authority. |
| Active `opencode-agents` server and TUI plugins | Server plugin captures and formats P for display; TUI generation independently binds histories, freezes C, and owns the unregistered local callback/grant. No shared authority store. Reload revokes TUI authority and a lost server cache fails closed. |
| Local human / trusted local client | Can inspect the row, navigate to the child, and click the local control. Other direct session operations can change history and make this attempt STOP; same-user TCB/OS input spoofing is outside V1. |
| Root Orchestrator | Can call its narrow tools and emit prose, but cannot settle the local callback. Zero/two/early presentation calls or extra/changed text fail the exact contract. A model-chosen P is not trusted merely because it appears in an argument; C3 has no P argument. |
| Planner | Can choose P, subject to trusted parse/scope/freshness checks. The deterministic displayed fields and C derive from that same P. Its instructions/prose cannot authorize. |
| `implementer_slot` | Read-only bootstrap; no access to the TUI resolver. Its input/result/identity must remain exact, as in M2. |
| Current/prior shell-capable Implementer | Could use ordinary client/CLI APIs or a background shell process to prompt/change sessions or create misleading content, but cannot call the unregistered TUI-local Authorize closure. A modified root/child transcript, queued input, changed HEAD, or wrong tool shape fails before grant. The presentation tool itself grants nothing. |
| Unrelated same-user process | Can cause similar transcript interference; exact root ID/history/inbox and freshness checks reject it. Deliberate installed-TCB modification is outside the accepted local threat model. |

There is no need for cryptographic unforgeability of transcript prose. There is a need for an exact accepted presentation row, whole-history equality, and a local decision bound to the frozen C.

## 9. Exact binder implications

For the recommended C3 order, let P be the Planner child's final text, `F(P)` the deterministic complete plan display, C the frozen candidate, and H0 the entire successful parent history **including** the presentation call/result. The narrow contract is:

```text
one exact plain root user message (capture user message ID and bytes)
→ one completed foreground native planner call (capture parent assistant ID,
  tool-call ID, prompt, child ID, wrapper; verify P == child final)
→ exactly one completed present_plan({}) call (capture parent assistant ID,
  tool-call ID; require its sole untruncated text result == F(P))
→ one completed foreground native implementer_slot call (capture its IDs,
  exact fixed prompt, child bootstrap result READY)
→ one root final assistant completion with exact fixed acknowledgment
→ one successful idle message; no extra user/control/tool/assistant text
```

The parent assistant message IDs for successive calls should be distinct as current M2 already requires for its native children; every tool-call ID must be unique. The server hook's captured child ID/call ID is convenient for the tool, but **canonical TUI readback** establishes the authoritative planner/slot/presentation IDs and exact contents. Require one presentation call at that position, not the first matching call or an arbitrary suffix. No duplicate presentation, unexpected tool, different child, stale hook entry, wrong order, modified input/result, unexpected root prose, or failed/unfinished step may be accepted. Capture serialized complete parent, Planner, and slot histories and the session identity/outcome/idle facts as current [`bind`](../src/m2/attempt.ts) does. `parseProposal(P)` and `makeCandidate` then freeze C from the original trusted Git baseline. The strip is mounted only for that exact C/root and only after H0 and the children pass.

Immediately before a grant, recheck active generation and bound route/decision, `candidateIntact(C)`, the whole H0 and child histories, idle/no inbox, original canonical root and HEAD, and Git cleanliness. Preserve current post-switch parent/Planner checks before the one trusted Implementer prompt. Any later root transcript extension or changed tool result invalidates H0 and STOPs; do not accept a prefix, suffix, whitespace-normalized text, or semantic equivalence. After one local affirmative callback, existing [`grantIntent`/`consumeIntent`](../src/m1/attempt.ts) remain the only admission path.

The two alternatives have simple shapes but weaker product fit: native result would bind H0/P without a presentation part yet leave P hidden in the root; verified final would require `finalText === F(P)` plus the existing two child calls and whole-history snapshot. Neither changes CAP authority.

## 10. Candidate comparison

| Stock-host option | Exactness / model copy | Root UX and persistence | Cost, binder, CAP, failure |
| --- | --- | --- | --- |
| Existing native result | Exact P already proven; no copy. | Persistent root tool row, but only label; full result in child. | Zero new calls/code; UX-insufficient. |
| Self-contained C3 presentation tool | Exact `F(P)` from server hook; no model-authored plan argument. | Persistent root row; expand to read plain text in normal scroll. | One additional model-request continuation/tool call inside the existing root turn, small server plugin plus strict third-call binder; no CAP authority. Missing cache, truncation, wrong order/content STOP. Supported APIs, no version-private renderer. |
| Verified root final | Exact equality only if model copies perfectly. | Immediate Markdown assistant block; persistent and visually closest. | No extra tool call, but model-copy availability failures; strict final binder. No CAP breach on mismatch. |
| Narrow internal integration | No supported exported host renderer/append helper accessible from a project plugin. | Would aim for immediate block. | Installed CLI is a binary package, while transcript row/renderer code lives in internal host/TUI modules; importing source paths or altering render internals would be version fragile and lack TUI-private context. Reject. |
| Full composer-top card | Trusted exact candidate; no model copy. | Full plan above composer, outside normal transcript; generation-local. | Small public TUI component and current binder; accepted nonmodal fallback, but less natural/persistent. |

The internal path does not offer a small version-checked module: the installed `@opencode/cli` package exposes the executable, while the relevant renderer is internal TUI source and needs route/render context ([installed CLI manifest](../../../.nvm/versions/node/v22.20.0/lib/node_modules/@opencode/cli/package.json), [TUI session renderer](../../opencode/packages/tui/src/routes/session/index.tsx)). Direct database writes, fake model-step events, monkey-patching, or bundling an alternate transcript renderer would cross the settled boundary and be larger than the supported tool-result compromise. There is no production reason to pursue them.

## 11. Recommended stock-OpenCode architecture

```text
User request → native Planner P
→ server-plugin execute.after captures the exact completed Planner result
→ root calls present_plan({}); tool returns deterministic complete F(P)
→ native implementer_slot bootstrap → fixed short root final
→ TUI M2 binds whole root/child history and F(P), freezes C after root finish
→ root transcript offers expandable exact plan; compact composer-top strip shows
  canonical worktree + HEAD + digest and [ Authorize ] [ Cancel ]
→ direct TUI-local Authorize callback → existing CAP liveness/freshness/binding
  checks → one-use grant → same-child Implementer admission
```

This ships entirely in `opencode-agents` against unmodified stock OpenCode. The presentation tool has no authority side effect. The strip is the only affirmative decision source. The plan row is canonical history and can be revisited after root↔child navigation or TUI reload; a restarted plugin has no resurrected grant or pending authorization.

## 12. Required proof before implementation planning

**One bounded user-run probe remains.** Static source proves the registration, hook, storage, and renderer paths, but not the actual visual quality/interaction of the generic expanded row in the installed 2.0.18 TUI or the end-to-end local hook/tool timing with the 2.0.17 plugin SDK. In a disposable sibling or `/tmp` project, run one inert flow with a read-only Planner-like native child, a server plugin `execute.after` capture, and a zero-argument `present_plan` custom tool returning a multiline sample via `{codemode:false}`. Inspect the root at default medium verbosity and, if available, low verbosity: record the collapsed label, click count to full output, wrapping/scrolling, complete text, root↔child navigation, and reload re-expansion. Confirm the tool receives the hook-captured exact sample and that a missing capture fails; do not create an authorization control, edit repository files, or run an Implementer. A yes/no UX judgment on whether this expanded plain-text block supports informed plan reading decides whether to use the tool or the full composer-top fallback. **Codex could build that disposable prototype later without launching OpenCode itself; the user must run the TUI probe.** No probe was run here.

## 13. Likely implementation surface

Likely project files are a new `.opencode/plugins/opencode-agents/server.ts` entrypoint (the stock [plugin resolver](../../opencode/packages/plugin/src/host.ts) looks for `server` beside `tui`), [`src/m2/attempt.ts`](../src/m2/attempt.ts) for the strict third-call/result contract and local decision handoff, [`src/m1/proposal.ts`](../src/m1/proposal.ts) or a small shared project formatter for deterministic `F(P)`, [`tui.ts`](../.opencode/plugins/opencode-agents/tui.ts) plus a small local strip component, and [`opencode-agents.md`](../.opencode/agents/opencode-agents.md) for the extra allowed tool and fixed call/final contract. Project dependency declarations may need to load the strip component's JSX peers. No implementation plan is specified here and none of these files was changed.

## 14. Secondary observation: exact root → Planner request

The presentation tool does not itself remove the existing model-authored Planner prompt, whose trailing-space mismatch caused one M2 STOP ([dogfood](milestone-2-live-dogfood.md)). The stock server plugin API does expose `session.prompt` and mutable `tool.execute.before` hooks with session/tool context ([session hooks](../../opencode/packages/plugin/src/promise/session.ts), [tool hooks](../../opencode/packages/plugin/src/promise/tool.ts), [core dispatch](../../opencode/packages/core/src/tool.ts)). They suggest a possible trusted path to capture the exact root prompt and replace/validate the native Planner call's prompt before execution, then let M2 verify the stored call and child input. This requires separate proof of prompt-hook timing, root identity, and interaction with native child creation; it is not needed for the presentation recommendation and is not adopted here. The previously investigated trusted prompt to the existing Planner child is another supported but larger path ([DX investigation](native-dx-ux-investigation.md)).

## 15. Open blockers / accepted UX compromises

- The exact hybrid screenshot's immediately visible Markdown assistant plan cannot be produced by the supported stock custom-tool renderer. The recommended plan needs an expand click, is plain text with an `output:` label, and may need an extra group click at low verbosity. Expansion state can reset; canonical content does not.
- The one user-run probe in §12 must establish that this is an acceptable reading interaction on the installed host. If it is not, use the full trusted composer-top plan card with the compact local control as the stock-host UX compromise; do not require upstream work.
- The proposal is shown by the tool during root execution, while the full candidate's trusted root/HEAD/digest is frozen after parent completion and shown in the strip. Strict exact binding joins those displays before Authorize becomes active. Oversized/truncated output, hook-cache loss, or any transcript change means STOP.

**STOCK OPENCODE SUPPORTS HYBRID UX VIA A SELF-CONTAINED PRESENTATION TOOL**
