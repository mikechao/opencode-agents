# Pre-M1 Documentation Readiness Review

**Status:** Historical, non-normative review snapshot. Its findings preserve the pre-decision readiness assessment and do not describe current V1 requirements or readiness. [Coding Authority Protocol](coding-authority-protocol.md) and [V1 Orchestration](v1-orchestration.md) contain the current normative architecture.

## 1. Executive Status

**NOT READY FOR M1 if the slice activates durable CAP authority.** CAP and orchestration are internally coherent, and the M0 **PASS** remains supported. But the documents do not establish that agent tools cannot modify the active authority kernel or its durable grant store. Without that boundary, replay protection could be bypassed through filesystem changes rather than authorization text. Two intent-side contracts also need clarification while defining M1: exact scope membership and what repository/worktree state the baseline and freshness checks bind.

This does not require reopening M0 or redesigning V1. The blocking item is a missing statement and verification of an existing trust assumption.

## 2. Repository Documentation Inventory

The working tree was clean on main...origin/main before review. git ls-files found the documents below, the M0 plugin harness, and LICENSE; no other tracked architecture, notes, configuration, package metadata, tests, or source artifacts were present.

| Artifact | Role and current relevance | Authority relationship |
|---|---|---|
| [AGENTS.md](../AGENTS.md) | Project boundaries and source-of-truth guidance. Current. | Governs repository work; not protocol semantics. |
| [README.md](../README.md) | Empty, tracked placeholder. | No architecture authority. |
| [docs/charter.md](charter.md) | High-level purpose, constraints, trust boundary, and exclusions. Relevant, but its final paragraph still describes M0 as upcoming. | CAP is authoritative for authorization; orchestration is authoritative for role sequencing. |
| [docs/coding-authority-protocol.md](coding-authority-protocol.md) | Normative V1 authority and effect contract. Current and central. | Normative source for CAP semantics. |
| [docs/v1-orchestration.md](v1-orchestration.md) | Normative V1 sequencing, roles, handoffs, and ephemeral coordination. Current. | Subordinate to CAP on authority semantics. |
| [docs/milestone-0-human-authorization.md](milestone-0-human-authorization.md) | M0 objective, evidence standard, and outcome criteria; status records PASS. Relevant as historical M0 contract. | CAP §12 and the investigation record the completed outcome; this document does not define production CAP behavior. |
| [docs/milestone-0-investigation.md](milestone-0-investigation.md) | Detailed M0 source research and runtime evidence. Current as evidence. | Evidentiary, not normative for kernel implementation. |
| [docs/milestone-0-dogfood-harness.md](milestone-0-dogfood-harness.md) | Completed experimental procedure and observations. Relevant as M0 evidence. | Describes a fixture harness, not production authorization. |
| [docs/legacy-reference.md](legacy-reference.md) | Explicit predecessor-reference boundaries. Current. | Historical/reference-only; not an architecture template. |
| [.opencode/plugins/m0-dogfood/tui.js](../.opencode/plugins/m0-dogfood/tui.js) | The only tracked implementation artifact: an experimental TUI probe. Current only as M0 evidence. | Not a production kernel, authority store, or orchestration implementation. |

LICENSE is a legal artifact, not an architecture source.

## 3. Cross-Document Architecture Check

There is **no contradiction between CAP and V1 orchestration** on the core division of responsibility:

- M0 establishes the TUI result boundary. CAP correctly treats true as necessary but insufficient; the kernel must bind it to the frozen candidate, check freshness, and durably record and consume the grant.
- Intent and reviewed-target commit authorization are distinct grants. The M0 harness presents both as fixtures and does not claim to prove production binding or effects.
- CAP’s post-result scope gate is consistent with orchestration’s implementation-to-review handoff: derive the complete delta, reject out-of-scope results, and do not gate every transient edit.
- Planner, Implementer, and Reviewer use fresh contexts. Handoffs use explicit artifacts and trusted references; agent claims do not establish observations.
- Ordinary failure terminates the run; only ambiguous commit completion allows read-only reconciliation. Orchestration state remains ephemeral, while grant consumption is durable.
- The named boundaries—TUI, kernel, store, agents, Git, and validation—agree at the responsibility level. The M0 source and harness documentation agree that fixed fixtures and /private/tmp logs are experimental evidence, not CAP state.

The incomplete contracts below do not contradict that structure, but leave different materially relevant interpretations open.

## 4. Findings

### BLOCKING

**B1 — The trusted kernel/store is named but not protected from agent-directed writes.**

**Files/sections:** CAP §§3–4, 8–9; orchestration §§2–3; [M0 harness source](../.opencode/plugins/m0-dogfood/tui.js).

CAP makes the installed plugin, kernel, and durable store part of the TCB, and makes the store the source of truth for grant consumption. At the same time, CAP and orchestration permit normal OpenCode editing and shell capabilities. The documents do not state that model-controlled tools cannot modify the active kernel or grant database, or cause unreviewed kernel code to be loaded on a later run.

The local OpenCode source supports the concern: the write tool accepts a model-supplied path and relies on ordinary permissions (sibling source: ../opencode/packages/core/src/tool/plugin/write.ts:60); shell commands run through OpenCode’s process spawner (sibling sources: ../opencode/packages/core/src/tool/plugin/shell.ts:113 and ../opencode/packages/core/src/shell.ts:299). Those paths do not establish a CAP-specific isolation guarantee. M0 also demonstrates loading a local TUI plugin from the checkout, though that harness is explicitly not production CAP.

If agent tools can alter a live grant record or replace the code that checks it, durable single-use consumption and replay prevention cease to be authoritative. Generic permission approval does not grant CAP authority, but it can still permit a filesystem effect that corrupts CAP state.

**Smallest clarification:** require that only trusted kernel code can mutate authority state, and that agent-directed tools cannot change the active kernel/store or cause unreviewed code to become the trusted runtime—including across a restart. The enforcement method remains an implementation choice; the selected OpenCode/OS boundary must demonstrate this property before an M1 slice relies on persisted grants.

### IMPORTANT

**I1 — “Exact scope” and “complete Git delta” lack path-membership semantics.**

**Files/sections:** CAP §§5.1, 9; orchestration §5, item 2. The harness’s fixed path list is only a fixture.

The documents require every changed path to be “within” the exact scope, but do not say whether a scope entry names one literal path or a subtree, or how the delta represents additions, deletions, renames, and untracked paths. Different reasonable interpretations could admit different targets.

**Smallest clarification:** define scope-entry membership and which pathnames count in the complete resulting delta. Git commands and internal representations can remain implementation choices.

**I2 — Repository/worktree identity and baseline freshness are required but not fully defined.**

**Files/sections:** CAP §§5.1–5.2, 6, 9, 13; charter’s run definition; orchestration §§5, 7.

The candidate must bind a canonical repository and worktree and a baseline; freshness must be checked; and the resulting delta must be derived from that baseline. The docs do not specify the equality guarantees of “canonical” identity or exactly which repository/worktree state constitutes the baseline and must remain fresh. For example, it is unclear whether freshness concerns only the Git HEAD or also the initial index/worktree state.

**Smallest clarification:** state that the binding distinguishes the specific repository and worktree, identify the baseline comparison point, and specify which observed state changes invalidate it. Identity encoding and the observations used to establish it are implementation choices.

**I3 — “Reviewer-owned validation” needs a trusted-result contract before the review/commit gate.**

**Files/sections:** orchestration §§3, 5, 11; CAP §§5.2, 9.

The Reviewer owns validation, but its claims alone are untrusted. The documents require trusted code to establish a successful validation result bound to the review and exact target without defining what evidence constitutes that result.

This is explicitly listed as an open implementation question in orchestration §11. It can be deferred until the Reviewer/commit milestone, provided M1 does not implement that gate.

**Smallest clarification then:** define the trusted evidence that counts as successful reviewer-owned validation and how it binds to the Reviewer invocation and target. No generalized validation framework is implied.

### MINOR

**The charter retains stale pre-M0 milestone wording.** Its final paragraph says the first milestone is to prove a trusted interaction can present a “kernel-generated” candidate, while CAP §12 and the M0 investigation record M0 as PASS and state that the harness used fixed representative fixtures without a production kernel. The M0 acceptance docs define the tested requirement as a trusted-code-supplied frozen candidate. This is stale charter wording, not grounds to reopen M0. Update the charter’s status and describe M0 at the same evidence level as CAP §12.

The charter also calls dismissal an “explicit” decision, while CAP correctly says dismissal may mean only that no authority was granted, not an explicit rejection. This is terminology debt.

## 5. OpenCode Assumptions Requiring Verification

The local ../opencode checkout is at commit 00738c5b…; package metadata identifies it as 2.0.17. I inspected only the relevant TUI, sub-agent, tool-hook, write, and shell paths. OpenCode was not run.

- **Trusted confirmation result:** M0 runtime evidence covers dialog behavior on 2.0.16 and relevant bypass checks on 2.0.16/2.0.18. The local 2.0.17 source still types ui.dialog.confirm as Promise<boolean | undefined> (sibling source: ../opencode/packages/plugin/src/tui/context.ts:379); its adapter settles Confirm/Cancel/close as true/false/undefined (sibling source: ../opencode/packages/tui/src/plugin/api.tsx:322). This supports the current API assumption; it does not reopen M0. No additional M1 blocker was found here.

- **Fresh sub-agent invocation and reference:** 2.0.17’s subagent tool creates a child session when no sessionID is supplied, documents fresh context, and returns a sessionID (sibling source: ../opencode/packages/core/src/tool/plugin/subagent.ts:29). Its optional sessionID input can continue an existing child, so a trusted role caller must enforce fresh invocation. Plugin tool hooks expose the call/session context and completed result (sibling source: ../opencode/packages/plugin/src/promise/tool.ts:39). This supports the orchestration requirement at source level. If M1 includes role handoffs, verify in the chosen integration that the plugin captures and binds the fresh child ID/result and rejects continuation; it does not block a kernel/store-only M1.

- **Agent access to TCB state:** OpenCode’s current tool paths use ordinary edit/path permissions and spawn shell commands through the host environment; they do not establish the CAP store/code exclusion required by B1. This blocks an M1 that enables durable authority until the selected access boundary is specified and verified.

## 6. Durable vs Ephemeral State Check

| State | Classification | Notes |
|---|---|---|
| Intent or commit grant, candidate kind and identity/digest, bounded purpose, consumed status | **Must be durable for CAP correctness** | Store must bind to the exact candidate and enforce one-time consumption across restart. |
| Full candidate snapshot and active UI invocation/result | **Ephemeral for authorization use** | Kernel retains and binds the snapshot during the decision path. A prior unconsumed decision cannot resume after restart. Full records may be retained for audit, but are not reusable authority. |
| Orchestrator run references, role invocation IDs, plan/review/validation references | **Must remain ephemeral orchestration state** | V1 explicitly rejects persisted phases, attempt records, retries, continuation state, and repair lineage. |
| Repository/worktree identity, baseline facts, resulting delta, target and current Git state | **Derived/recomputed trusted observations** | Git/worktree state is not authority merely because an agent reports it. |
| Review and validation artifacts | **Unclear retention, not unclear authority** | Their contents and run-local references may be passed as artifacts, but the documents do not require workflow-state persistence. They cannot authorize without trusted binding. |
| Ambiguous commit outcome | **Durable consumed grant plus derived Git observation** | The grant is not replayed; reconciliation is read-only. No durable workflow phase is authorized. |
| M0 JSONL evidence | **Experimental evidence only** | Written outside the repository under /private/tmp; it is not CAP state. |

No tracked document currently proposes persistent workflow phases or worker-attempt bookkeeping. The unresolved issue is whether the trusted grant store and active kernel are actually protected from model-directed mutation.

## 7. M1 Readiness Constraints

Before defining an M1 slice that records or uses grants, make these facts unambiguous:

1. Agent-directed tools cannot modify the active CAP kernel/store or load an unreviewed replacement.
2. Scope entries have explicit path-membership semantics, and the complete delta includes the path changes the scope check is meant to cover.
3. Repository/worktree identity and the baseline’s freshness comparison are defined.
4. A TUI true remains only an input: CAP binds it to the exact frozen candidate, checks freshness, then durably records and consumes the grant once.
5. Coordination remains ephemeral; ordinary failure ends the run and does not leave resumable workflow state.

The following can safely wait until the corresponding later milestones: trusted reviewer-owned validation evidence, exact reviewed-target/commit-candidate representation, bounded Git preparation and result verification, and the read-only observations used to reconcile an ambiguous commit.

## 8. Recommended Documentation Actions Before M1

- Add the TCB write/execution exclusion requirement to CAP’s trust/store sections; keep the enforcement method open.
- Clarify path-scope membership and baseline/freshness comparison in CAP §§5 and 9.
- Update the charter’s completed-M0 wording and the dismissal terminology.
- Keep reviewer/commit details in their milestone boundary discussion unless M1 includes them.

No new document or abstraction is warranted.

## 9. Final Readiness Assessment

1. **Is the architecture internally coherent enough to proceed to M1?** The core authority and orchestration model is coherent, and M0 remains PASS. It is not ready to enable a durable CAP grant path until B1’s trusted-state access boundary is explicit and verified.
2. **Are unresolved points genuine architecture questions?** Yes: who can mutate the active authority kernel/store, what exact paths belong to scope, and what baseline state freshness binds. The concrete encoding, storage format, and Git command choices remain implementation choices.
3. **Could a requirement recreate codex-agents complexity?** No current document does. Persisted workflow phases, retries, recovery, or repair machinery would conflict with the stated architecture.
4. **Facts to carry into M1 discussion:**
   - The TUI result is necessary but never sufficient authority.
   - Intent and commit grants are distinct and single-use.
   - Scope enforcement checks the complete result before review; it is not a per-edit gate.
   - Active TCB code and grant state must remain outside model-controlled mutation.
   - Orchestration references stay ephemeral, and ordinary failures require fresh authority on a later run.
