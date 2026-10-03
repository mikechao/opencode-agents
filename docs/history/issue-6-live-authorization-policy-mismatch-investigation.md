# Issue #6 Live Authorization Policy/Model Mismatch Investigation

## Executive Conclusion

**MORE LIVE EVIDENCE REQUIRED.** The clean attempt failed in the first agent-policy predicate of `creationPolicy()`, before model-catalog lookup, grant creation, child import, or prompt dispatch. Persisted evidence and the pinned source do not identify the failing subcondition. Ordinary host defaults and HTTP location serialization do not explain the failure. A normalization change would therefore be speculative; the direct post-authorization architecture remains supported by source, with successful live admission still unverified.

Investigation only, 2026-10-01. Only this report was added. No OpenCode command, host launch/restart/stop, HTTP inspection of the service, Docker, implementation/test/agent change, commit, push, or GitHub mutation was performed. Session inspection used Python SQLite URI `mode=ro`, `PRAGMA query_only=ON`, and SELECT queries. Offline schema experiments used dependency functions and literal objects, without instantiating OpenCode services or accessing the host.

## Reproduction / Live Evidence

Primary attempt:

- Repository: `mikechao/opencode-agents`, `/Users/mike/projects/opencode-agents`.
- Implementation HEAD: `216e58b48ade1bd340548d3aacee5d472b428a3a`; initially clean worktree. The persisted trusted Plan names this same bound HEAD.
- Root: `ses_f06c2f28fffelCbrgqbrKKK79t`, agent `orchestrator`, slug `shiny-engine`.
- Only persisted child: `ses_f06c2e958ffeXL3jNrZw93VV8I`, agent `planner`, exact root parent.
- Host: persisted session version and startup logs both say `2.0.21`.
- User request: `Update README.md by adding a final line containing exactly: # issue-6-dogfood`.
- Root and Planner selected/executed model: `{ "id": "gpt-6-luna", "providerID": "openai", "variant": "xhigh" }`. This is the dogfood model, independently of the requested investigation model.

User-reported outcome after clicking Authorize:

```text
STOP — Implementation was not admitted; no child created or implementation prompt was dispatched. Attempt binding failed: loaded authorized Implementer policy or model override changed
```

Evidence sources are `/Users/mike/.local/share/opencode/opencode.db`, especially `session_v2`, `session_message`, `session_inbox`, `event_sequence`, and the model-cache entry in `kv`; and `/Users/mike/.local/share/opencode/log/opencode.log`. Exact database timestamps below are UTC:

| Time | Evidence |
| --- | --- |
| 20:51:40.718 | Clean TUI startup, log run `ce7b1f3c`, version `2.0.21`, `args=[]`. |
| 20:51:40.813 | Background service startup, run `f58f592a`, `args=["serve","--service"]`. These are historical records, not commands run by this investigation. |
| 20:51:41.354 / .382 | Repository-scoped startup `model.updated` / `agent.updated`, before the root existed. |
| 20:52:03.102 | Root created, `time_created=1790887923102`; selected model above; no workspace, parent, fork, revert, or session permission override. |
| 20:52:03.122 | Single root user input persisted. |
| 20:52:05.440 | Planner child created, `time_created=1790887925440`. Root transcript contains one completed native `subagent` call targeting this child. |
| 20:52:11.795 / .802 | Planner final completed / successful idle. No Planner tool call is present. Its proposal names only `README.md`. |
| 20:52:12.943 / .945 | Root final completed / successful idle; historical model prose reported that the Plan was prepared and awaiting human authorization. |
| 20:52:14.304 | Trusted synthetic Plan enqueued, `msg_17f616a0-f4cd-473a-994d-972dd3830870`, delivery `steer`, metadata `{source:"planner",planHash:"280e96824eed"}`. It remains in the root inbox. |
| After publication; exact time unavailable | Authorize click, popup, and STOP are user-reported. The click and trusted closure state are not persisted in these tables or logs. |
| 20:54:28.282 | Log records interruption of the TUI event-stream request. This suggests the end of its connected UI interval; it does not timestamp the click or STOP. |
| 20:56:41.347 | Next repository-scoped `model.updated`, following `provider.updated`; after the apparent UI interval. |

The root has four persisted transcript records: one user, two assistants, one idle. Its last assistant is the planning final. The family query `id = root OR parent_id = root` returns exactly root and Planner. No `authorized_implementer` child or implementation input is present. Together with the pre-creation STOP branch and control flow below, this confirms that this CAP continuation did not import or prompt an implementation child. No complete historical event log is available: the database `event` table has **zero rows**, although `event_sequence` retains root sequence 21.

The earlier contaminated root is separately persisted as `ses_f06cc7dcfffePKY45lJLI25zJ1`, created at 20:41:37.630, idle at 20:41:46.668. Logs show subsequent `session --help`, `session list`, and sanitized export CLI activity at 20:44–20:48, plus repository `model.updated` at 20:46:03.940 and 20:51:03.984. Those facts do not establish which action caused its update. There is no corresponding CLI probing startup in the clean run before its reported authorization. **Do not attribute the clean failure to the earlier probing.**

## Exact Failing Predicate

The exact throwing condition is [src/attempt.ts:351](../../src/attempt.ts#L351):

```ts
if (!same(loaded.location, location) ||
    role.id !== "authorized_implementer" ||
    role.mode !== "subagent" ||
    !role.hidden ||
    role.model !== undefined ||
    reset < 0 ||
    !same(role.permissions.slice(reset), implementerRules) ||
    (expected && !same(role, expected)))
  stop("loaded authorized Implementer policy or model override changed")
```

**The precise false equality/identity subcheck cannot be recovered.** The code emits one message for these alternatives and retains neither the response nor per-predicate diagnostics. It would be incorrect to identify location, model override, or permissions as the proven culprit.

What can be resolved exactly:

| Candidate | Finding |
| --- | --- |
| `agent.get(...)` rejection/not found | Excluded as the reported throw site: the response reached this branch. An endpoint/transport error would propagate its own error. |
| Missing role/non-array permissions | Excluded: line 349 has a different STOP, `loaded authorized Implementer policy is unavailable`. |
| Loaded location comparison | Possible; actual response unavailable. Ordinary source HTTP behavior predicts an exact matching directory, not extra project metadata on the wire. |
| Agent id / mode / hidden | Possible live discrepancy; checked-in definition plus normal loader predicts matching values. |
| `role.model !== undefined` | Possible live override; normal loader does not inherit the selected root model into `AgentInfo`. No override appears in the repository definition. |
| Missing deny-all reset / unequal ordered suffix | Possible live discrepancy; normal loader predicts the exact expected suffix. |
| `(expected && !same(role, expected))` | Excluded for this failure: first invocation at line 472 supplies no `expected`. Later invocations are after import, incompatible with this STOP's `creationAttempted` being false. |
| `model.list`, provider/id lookup, enabled state, variant lookup | Not reached by this invocation. Their failure message is `frozen root model or variant is unavailable`, at line 356. |
| Registry/owner/Git check after the awaited agent read | Returned successfully before line 351. It would throw its own reason rather than this policy message. |

`authorizePublishedAttempt()` first revalidates publication, root/Planner, presentation, ownership, and fresh clean Git. `executeBoundImplementation()` then calls `creationPolicy()` at line 472. Grant creation is line 477; `owner.creationAttempted = true` is line 483; import is line 485; consume/prompt are lines 504–505. The TUI's [terminate()](../../.opencode/plugins/opencode-agents/tui.tsx#L78) chooses the reported prefix only when creation has not been attempted. Thus this is the initial role check, not post-import drift or an expected-policy readback failure.

## OpenCode 2.0.21 Host Behavior

### Version and transport identity

The authoritative sibling checkout is clean, commit `8a8bd622a3d7dc29ccf30ec17f84e363ed95ed72`, exact tag `v2.0.21`; package versions match. The installed executable's package also reports `2.0.21`, at `/Users/mike/.nvm/versions/node/v22.20.0/lib/node_modules/@opencode/cli/bin/opencode.exe`. Read-only examination of embedded JavaScript corroborated the agent handler, config-agent loader, location response constructor, and HTTP encoder structure. This is substantial version evidence, not a cryptographic proof of identical build inputs.

The TUI plugin context receives `host.client.api` directly: [plugin/api.tsx:143](../../../opencode/packages/tui/src/plugin/api.tsx#L143), [context/client.tsx](../../../opencode/packages/tui/src/context/client.tsx). The generated promise client sends `GET /api/agent/:agentID` and `GET /api/model` with `location[directory]`, then parses JSON without an additional response schema/defaulting pass: [generated/client.ts:347](../../../opencode/packages/client/src/promise/generated/client.ts#L347), agent methods at 467 and model methods at 1108. This is not the in-process server-plugin adapter.

### Loaded agent and permissions

[Agent.Info defaults](../../../opencode/packages/schema/src/agent.ts#L39) create `name=id`, `request={settings:{},headers:{},body:{}}`, mode `primary`, hidden `false`, and no model field. [Agent service](../../../opencode/packages/core/src/agent.ts#L59) adds defaults before config rules. [ConfigAgentPlugin](../../../opencode/packages/core/src/config/plugin/agent.ts#L83) appends global permissions and then authored agent permissions; it assigns mode/hidden/model only when supplied. `agent.get` reads the current registry entry, not session-selected/inherited model data: [agent.ts:109](../../../opencode/packages/core/src/agent.ts#L109), [server handler](../../../opencode/packages/server/src/handlers/agent.ts#L16).

For the checked-in [authorized_implementer.md](../../.opencode/agents/authorized_implementer.md), under the ordinary inspected configuration, the **source-derived, not recovered live** result is:

```text
id/name: authorized_implementer
mode: subagent
hidden: true
model: undefined in process; key omitted from encoded JSON
request: { settings: {}, headers: {}, body: {} }
description: Implement one trusted CAP admitted proposal
system: trimmed Markdown body of authorized_implementer.md
permissions: host/default prefix, then the eight authored rules below
```

Default prefix in order:

1. `allow *:*`.
2. `ask external_directory:*`.
3. `ask read:*.env`.
4. `ask read:*.env.*`.
5. `allow read:*.env.example`.
6. `allow external_directory:<global.data>/shell/*/*`.
7. `allow external_directory:<global.data>/tool-output/*`.
8. `allow external_directory:<global.tmp>/*`.
9. `allow external_directory:<global.config>/*`.

Authored suffix in order:

```text
deny  *:*
allow read:*
allow glob:*
allow grep:*
allow edit:*
allow shell:*
deny  shell:git commit
deny  shell:git commit *
```

The inspected user-global `opencode.jsonc` contains only `$schema`; no agent or permission override. Current files are not a snapshot of all live environment/remote/plugin inputs. No full live `AgentInfo` is persisted. Do not present the derived object or the runtime temp-path expansion as an actual captured response.

Native frontmatter decoding preserves these permission triples and array order. Path resource expansion applies only to `external_directory`, `read`, and `edit`; `*` is unchanged, and shell resources are deliberately not expanded. Legacy migration is selected only for non-native keys; this definition uses native keys. The relevant implementation is [config/plugin/agent.ts:141](../../../opencode/packages/core/src/config/plugin/agent.ts#L141), decode at 177. No inspected generic transform appends extra rules to every agent after these authored rules; the built-in agent and Plan transforms target their own named agents.

[Permission.evaluate](../../../opencode/packages/core/src/permission.ts#L87) uses the **last matching rule**; merge concatenates without sorting. Consequently all prefix rules are overridden by the later deny-all for this role. The current comparison already finds the last reset and compares only its suffix. Merely adding the nine default rules to the fixture would not make the current production check fail. Array ordering is meaningful; sorting or deduplicating the suffix is not justified.

The optional-field codec [schema.ts:12](../../../opencode/packages/schema/src/schema.ts#L12) omits `undefined` on encoding. It does not define absent model as `null`, or populate it from root/session selection. A genuinely loaded non-undefined role model should continue to fail admission under the present policy.

### Location: handler object versus actual HTTP contract

[server/location.ts:17](../../../opencode/packages/server/src/location.ts#L17) constructs a `Location.Info` containing directory **and project metadata**. However, [Location.response](../../../opencode/packages/schema/src/location.ts#L34) declares `location: PublicRef`, containing only `directory`. The endpoint uses that schema. Effect's HTTP success encoder encodes the schema before JSON serialization; excess struct fields are stripped by default. The source dependency is Effect `4.0.0-rc.112`.

Offline literal-object experiments with both installed Effect and the sibling's dependency confirmed that the PublicRef response codec, including the HTTP-builder-equivalent `decodeTo` response transformation, converts `{directory,project}` to `{directory}`. No server was run. The generated client then preserves that JSON.

The source therefore predicts `loaded.location = {directory:"/Users/mike/projects/opencode-agents"}`, equal to the activation's primitive snapshot. The internal project id is `67dd51024a86ad893879ccf5edbdcd8b4b68cb5c`; its persisted worktree is the same repository directory. **Extra internal project metadata alone is not a proven normalization bug in the CAP check.** Actual response bytes are missing, so build/transport anomalies or a different directory cannot be conclusively excluded.

`requestRef` retains the supplied directory; project resolution does not replace it with canonical worktree identity. Public endpoints cannot represent workspace identity. The current unsupported-workspace rejection must remain; no recommendation here discards `workspaceID`.

### Model catalog and `xhigh`

Exact selected and assistant-executed model references are recovered from session rows/transcripts, as listed above. Exact `model.list` output at authorization is **not recovered**, and CAP did not reach that call.

The relevant persisted `kv` key is `models-dev:catalog`, updated `2026-10-01T20:41:04.244Z`, before both attempts. Its raw OpenAI entry has id `gpt-6-luna`, reasoning support values `none`, `low`, `medium`, `high`, `xhigh`, `max`, tool support true, and input modalities text/image/pdf. This is a cached catalog input, not a location-specific enabled model readback. The old `/Users/mike/.cache/opencode/models.json` lacks this model and is not the appropriate v2 cache evidence.

[ModelsDev normalization](../../../opencode/packages/core/src/models-dev.ts#L87), [Variant.resolve](../../../opencode/packages/core/src/variant.ts#L16), and the OpenAI Responses variant constructor at lines 82–89 derive variants as an array of objects. In the ordinary Responses provider, `xhigh` is `{id:"xhigh",settings:{reasoningEffort:"xhigh",reasoningSummary:"auto",include:["reasoning.encrypted_content"]}}`, not an alias or boolean capability. Provider/plugin transforms may adjust effective entries. [Model.available](../../../opencode/packages/core/src/model.ts#L210) filters enabled entries; the server list returns this current available snapshot. Authentication/config transforms can affect availability. Earlier successful root/Planner execution is evidence of earlier usability, not independent proof of enabled state at the later barrier.

## Test-vs-Host Mismatch

The fake at [test/attempt.test.ts:163](../../test/attempt.test.ts#L163) parses frontmatter directly with `Bun.YAML`, spreads it into the role, and sets `request:{}`. It omits the nine default permission rules, global config merging, populated request subfields, and Markdown `system` body. Host loading supplies these fields. The fake catalog at line 251 has only selected-model fields, `enabled:true`, and `variants:[]`; named-variant tests substitute arrays containing `{id:"high"}`. Real model entries have additional ids, provider settings/body/headers, capabilities, costs, status, release time, limits, and variant overlays.

These are concrete fixture omissions, but **none independently establishes this failure**:

- Prefix permissions are deliberately outside the checked suffix.
- Additional role fields matter to whole-role stability only when `expected` is supplied, which was not this failing call.
- Request/system defaults do not participate in the initial role predicate.
- The fake location's directory-only shape matches the source HTTP response contract, despite differing from the handler's internal object.
- Catalog simplification cannot explain a STOP before catalog lookup.

Existing tests cover altered role model/mode/hidden/permissions/location and unavailable/disabled model or variant, plus later role/catalog drift. They prove fail-closed sequencing for their supplied objects. They do not record the rejected live object, and cannot settle which live check failed. The committed [Issue #6 design investigation](issue-6-post-authorization-implementer-creation-investigation.md), [CAP](../coding-authority-protocol.md), and [orchestration](../v1-orchestration.md) require independent loaded-policy/catalog checks; they do not authorize treating unknown mismatches as benign defaults.

Mismatch category: **6. Other — unresolved live agent/location evidence discrepancy, obscured by a combined diagnostic.** Fixture incompleteness is established; classifying the actual STOP as category 1, 2, 3, 4, or 5 is not supported by the recovered evidence.

## Registry Event Analysis

The recent P1 fix is in [tui.tsx:307](../../.opencode/plugins/opencode-agents/tui.tsx#L307): before session filtering, same-location `agent.updated` / `model.updated` with empty data terminates the owned attempt; other location/workspace events do not. It snapshots event location identity, so extra presentation fields are irrelevant there. Tests at [attempt.test.ts:2193](../../test/attempt.test.ts#L2193) specifically cover updates during the final awaited child verification and unrelated-location isolation.

[EventLogger](../../../opencode/packages/core/src/event-logger.ts#L7) logs agent/model/provider/config registry events. In clean service run `f58f592a`, repository events occur at startup, before root creation, and next at 20:56:41.347. **No registry update is logged between root creation and the event-stream disconnection at 20:54:28.282.** There is no evidence that a registry event caused this clean failure. More decisively, its STOP reason is the role-comparison throw; event invalidation would report `Unexpected ...; policy evidence invalidated` or ownership closure, not the observed branch.

The popup has a strong ordinary explanation: `terminate()` both sets persistent STOP status and calls `context.ui.toast.show({title:"STOP",message,...,variant:"error"})`. It is likely that error toast, not evidence of a separate host mutation. Its exact content was not captured. The 404 permission/form polling responses at root startup are timestamped before publication and do not establish an authorization-time popup cause.

Normal `agent.get` does not publish an update: it calls `state.get()`. Registration, disposal, and reload invoke notifications; config/agent file changes can trigger reload. `model.list` reads a snapshot and can rebuild changed provider dependencies without itself publishing a normal update. [Model notification](../../../opencode/packages/core/src/model.ts#L226) runs for registered transforms/reloads and provider-update subscription, and publishes when snapshot identity changes. A transform failure while reading can disable a plugin group and schedule notifications, so read-triggered events are possible in abnormal/reconciliation conditions; a stable read alone is not a mutation.

Background updates can happen without any CLI probing. Source includes a five-minute model-source refresh and provider subscriptions to integration/credential changes. Model-source refresh suppresses byte-identical-body notifications; provider/model notifications compare snapshot identity, not a CAP-specific authority delta. The clean log's later provider/model pair is compatible with ordinary background activity; its exact trigger is not recorded. Thus the earlier contaminated failure cannot automatically be blamed on CLI activity either.

The event policy is conservative: broad within the exact location, and appropriate to close the gap after independent policy reads. It may reject a normal background refresh even without a demonstrated relevant policy change. That availability issue is distinct from this STOP. Do not suppress these events, narrow them by nonexistent session ids, or claim that normal reads require ignoring them. A future attempt stopped by such an event would need its own before/after evidence.

## CAP / Security Assessment

There is no evidence here of unsafe permission broadening, a loaded model override, or a semantically harmless normalization. There is also no evidence that the public agent/model APIs are inherently unusable or unstable for this design. The branch correctly refuses to proceed when its evidence differs; an unidentified difference is not permission to relax it.

The direct flow remains source-supported for ordinary local topology: exact Authorize, revalidation, policy/catalog evidence, one empty `session.import`, independent child verification, final barrier, adjacent one-use consume/exact prompt. This attempt never exercised import. Its failure therefore does not prove the architecture unsupported, nor constitute a live PASS of that architecture.

Retain: no preauthorization child; zero creation on Cancel/stale decision; exact candidate/root/HEAD/scope/model binding; one child at most; no ambiguous-operation retry/replacement/adoption; independent role/catalog readbacks; same-location registry revocation; exact child/input/result verification; adjacent one-use consumption; and Git scope checks. A leftover ordinary host capability cannot restore CAP authority. Do not restore retained-slot/READY/switch-agent behavior.

## Recommended Narrow Fix

**No admission-behavior fix is justified yet.** The smallest safe next change is diagnostic, followed by one separately authorized clean reproduction. Do not implement normalization or alter permission equality based on this report alone.

In `src/attempt.ts`, keep `creationPolicy()` checks and sequencing, but give the existing alternatives distinct fail-closed diagnostics: returned-location mismatch, id/mode/hidden mismatch, loaded model override, missing reset, ordered suffix mismatch, expected-role drift, catalog location, unique enabled model, and named variant. Include enough structured evidence to distinguish absent/undefined/null fields and the differing rule/index. Capture the **original agent response envelope**, not just a location snapshot or normalized suffix, at the initial and later barriers. Avoid dumping unrelated request headers/body that may contain secrets; an authorized local diagnostic capture can retain/redact the full response as appropriate. Diagnostics must neither grant authority nor issue extra reads/retries inside the final consumption/prompt boundary.

Missing decisive evidence is:

1. `agent.get({agentID:"authorized_implementer",location})` response at the first post-click barrier: exact envelope location and role id/mode/hidden/model/permissions, including field presence, reset index, and comparison results.
2. The effective config/agent-source provenance for any differing field, and timestamp relative to the click and registry events.
3. If admission advances: actual model-catalog matching entries, `enabled`, variant ids/overlays, response location, and repeated readback differences. These cannot explain the present branch, but are needed for successful admission verification.

If the capture proves extra location *metadata* only, compare the complete primitive location identity while retaining workspace rejection and separate project/root checks; first explain why that deployed response differs from the pinned codec. If it proves an exact benign host-added rule, specify that rule and last-match semantics before accepting it. A loaded model override, missing reset, or new effective tool allow is authority drift under the current contract and must continue to stop. There is no supported blanket “relax equality” recommendation.

Correcting the fake's missing host fields is independently useful, in `test/attempt.test.ts`'s local `fake()` helper. Keep this substitution test-scoped, with a source-faithful ordered prefix and full role/request/system representation. No production injection seam or generalized harness is needed.

## Regression Tests Required

These are follow-up requirements, not tests added or run here:

1. Distinct diagnostics for each initial policy subcondition, all asserting zero import and zero prompt. Before the diagnostic change these cases share the misleading error; afterward they identify the exact check.
2. Realistic host-derived `AgentInfo`: nine-rule default prefix, exact authored suffix, filled request object, description/system, absent model. Assert admission succeeds and repeated full-role drift still fails. This should already pass production behavior; it validates fixture fidelity, not a causal fix.
3. Explicit absent versus undefined versus null/model-object cases: absent/undefined match the supported contract; null/non-undefined override remains rejected.
4. Ordered permission tests: prefix defaults cannot change the last-reset suffix; extra effective allow, reordered commit-deny precedence, absent reset, and changed resource/effect stop before import. Do not sort rules.
5. Response-location cases using the established HTTP PublicRef contract; changed directory and any unsupported workspace remain rejected. Preserve root/project/subpath checks. Add a captured anomalous shape only after its provenance is established.
6. Named `xhigh` represented as a real variant object with settings; frozen model and variant forwarded exactly. Reject missing/disabled/duplicate matching models and absent named variant.
7. Preserve P1 same-location events at final awaited child verification, unrelated-location/workspace isolation, Cancel/stale no-child cases, import ambiguity/no retry, and exact consume/prompt adjacency.
8. Once the actual mismatch is captured, add its exact minimal fixture as the regression for any proposed normalization change. It must fail before that change and pass afterward while neighboring unsafe cases still fail.

Use trusted doubles for these tests. No real Git fixture or OpenCode process is necessary for policy/transport-shape assertions. Run typecheck, focused attempt tests, and required full checks only in the later implementation task.

## Live Dogfood Retest

After the diagnostic change, obtain one fresh, clean 2.0.21 attempt at a recorded implementation commit, using the single-file request and selected `openai/gpt-6-luna#xhigh`. Do not run CLI probes or alter config while the authorization frame is live. Capture response/predicate diagnostics from the trusted continuation itself and record click/STOP/toast timestamps. This evidence-collection reproduction requires separate authorization; it was not run here.

After a justified fix, minimum acceptance is one positive and one fresh Cancel attempt. Record no implementation child before decision; Authorize creates exactly one fresh empty authorized child with exact parent/location/model/variant; final independent policy/catalog/child checks pass; one exact trusted prompt follows adjacent grant consumption; only `README.md` changes; HEAD remains unchanged; persistent completion STOP and no retry/root resumption follow. Cancel must create no child or prompt. Record registry events without generating activity from a second client. A production fix is not validated merely because the shared STOP disappears.

## Final Classification

**MORE LIVE EVIDENCE REQUIRED**

Proven failure site: first `creationPolicy()` compound role predicate, lines 351–352. Unknown: which live subcondition failed. Design: viable in pinned source, live admission unverified. Next action: predicate-specific, non-authoritative diagnostic capture and a separately authorized clean reproduction; no speculative policy/model relaxation.
