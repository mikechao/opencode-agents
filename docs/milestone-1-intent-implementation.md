# Milestone 1 — Authorized Plan → Implementation

## Contract and boundary

M1 proves one local, authorized Plan → Implement attempt. It begins with one user request and ends after trusted code derives and checks the Implementer's complete Git delta. It stops before review or commit.

```text
User request → Orchestrator → fresh Planner → explicit proposal
             → trusted CAP candidate → human confirmation
             → trusted freshness recheck → one fresh Implementer
             → trusted complete Git delta → exact-scope check → STOP
```

The active installed `opencode-agents` TUI plugin generation is the local V1 CAP runtime. Its activation-private state holds the candidate/result binding and transient authority. Cleanup synchronously revokes that generation; an authority-bearing continuation checks revocation after awaits and before acting. A dead or replaced generation ends the attempt. OpenCode session work that outlives it has no CAP authority.

## Proposal, candidate, and authorization

The Orchestrator receives the request and creates one fresh OpenCode Planner sub-agent invocation. The Planner owns one explicit proposal containing **all three** fields: human-readable intent, human-readable plan text, and a finite set of exact repository-relative file paths. Directory, subtree, glob, wildcard, and implicit scope entries are invalid. The proposal is an immutable run artifact and grants no authority. CAP and the Orchestrator must not invent, expand, silently repair, substitute, or reinterpret any of its fields.

Trusted CAP validates the proposal and freezes it intact in an intent candidate. CAP adds only the trusted-derived canonical local worktree root and trusted-observed `HEAD`; a separate repository identifier or Git tree hash is not required for M1. Candidate construction requires a clean canonical worktree: no staged changes, unstaged tracked changes, or untracked files. Ignored files are outside the CAP delta model. Cleanliness is a trusted precondition and freshness fact, not a fourth Planner field. Internal encoding remains an implementation choice.

CAP presents the exact frozen candidate through the validated trusted OpenCode TUI confirmation path and binds that invocation's result to that candidate. Only an affirmative result may proceed. The human authorizes **one implementation attempt of this exact intent, using this exact plan, limited to these exact files**, in the bound worktree at the bound `HEAD`. The plan is visible, mandatory, and authority-bearing. Generic tool permission, model text, agent output, and a prior approval do not authorize the attempt.

Immediately after confirmation and immediately before Implementer admission, trusted code verifies the same canonical worktree root, the same `HEAD`, and continued cleanliness. A mismatch ends the attempt; CAP does not refresh, amend, rebind, rebase, or reuse the confirmation. On success, the current TUI plugin generation holds a process-local, single-use **intent authorization capability** for admitting one fresh Implementer. That capability is consumed at admission and is never passed to an agent. It cannot be reconstructed from repository or session state, storage, prior output, or prior approval. The frozen Planner proposal itself is **not consumed**: it remains intact as the authoritative artifact for this attempt and the later Reviewer milestone.

## Minimal Orchestrator and role handoff

The Orchestrator sequences one Planner invocation, captures its proposal, requests CAP authorization, admits one Implementer only after the trusted authorization and freshness checks, waits for its completion, requests trusted post-implementation Git derivation and scope checking, reports the result, and stops. CAP alone constructs candidates, interprets the bound UI result, and creates and consumes authority. Trusted code, rather than Orchestrator interpretation of agent prose, establishes Git facts.

The Orchestrator must not modify the proposal; manufacture or infer CAP authority; enlarge, repair, reuse, revive, or rebind it; silently expand scope; derive `HEAD`, cleanliness, or delta from model claims; retry either role; repair or resume a failed attempt; or become a workflow engine. It may retain only attempt-local references needed to bind the Planner invocation and proposal, canonical worktree root and `HEAD`, Implementer invocation, and returned artifacts/results. These ephemeral references confer no authority, are not persisted workflow phases, and may die with the attempt.

Trusted orchestration binds the proposal to the specific Planner invocation that produced it and binds the admitted Implementer invocation to its returned result. Role names and model claims alone do not establish invocation identity. Each role starts in a fresh OpenCode sub-agent context distinct from the Orchestrator, the other role, and any previous invocation. The exact OpenCode session/reference mechanism is an implementation choice; M1 adds no durable invocation history or runtime-affinity machinery.

Admission consumes the one-shot capability and creates exactly one fresh Implementer invocation. The Implementer receives the **exact frozen authorized intent, plan, and file set**, plus trusted baseline facts needed to operate safely, such as the canonical worktree root and bound `HEAD`. It receives neither the capability nor the Planner's conversational history, hidden reasoning, or the Orchestrator's conversational context. It retains ordinary read, edit, test, and development shell abilities. Trusted OpenCode role/tool enforcement keeps the reserved final CAP-governed commit effect unavailable to both Planner and Implementer; M1 does not impose a general filesystem or shell sandbox.

## Post-implementation gate and result

Once that Implementer invocation completes, trusted code verifies that `HEAD` is still bound and derives the **complete** Git delta against that `HEAD` in the canonical worktree. The derivation covers staged tracked changes, unstaged tracked changes, additions and untracked files, deletions, and renames. Scope membership is exact path equality: a modified or added path, a deleted old path, and **both** old and new rename paths must belong to the authorized file set, including when Git reports a rename as delete plus add. All resulting changes count, including concurrent or unattributed changes. Agent summaries never replace this derivation. A changed `HEAD` or any path outside the set fails M1 and ends the attempt. Passing this gate makes no claim that the implementation semantically fulfills the intent or plan.

**M1 PASS** requires one request, one fresh Planner invocation and its three-field proposal; trusted clean-worktree, canonical-root, and `HEAD` observations; freezing and presentation of the exact candidate; explicit human confirmation; a successful immediate pre-admission root/`HEAD`/cleanliness recheck; one valid process-local intent capability consumed to admit exactly one distinct fresh Implementer; handoff of the intact proposal without Planner context or commit authority; unchanged `HEAD` after implementation; trusted complete-delta derivation with every resulting path inside the exact file set; and a stop without review or commit.

**Ordinary failure means stop.** A malformed or missing proposal, role failure or unbound role/result identity, reject or dismiss decision, stale or ambiguous authorization, revoked TUI generation, failed freshness check, changed `HEAD`, or out-of-scope delta ends the current attempt. There is no retry, repair, continuation, recovery, scope amendment, or grant reuse. A later attempt begins from current repository reality with a fresh Planner proposal, trusted observations, human authorization, and, if admitted, fresh Implementer. It inherits no authority or workflow phase.

## Explicit deferrals and production foundation

M1 defers Reviewer orchestration and semantic adjudication; reviewer-owned validation; reviewed-target construction and commit authorization; commit-effect preparation, `git commit`, post-commit verification, and ambiguous-commit reconciliation; repair, retry, recovery, mutable scope, changed-`HEAD` recovery, durable audit/storage, and persisted workflow phases. A later fresh Reviewer should receive this same frozen authorized intent, plan, and file set to judge the resulting target, but M1 stops before that role exists.

M1 may establish the smallest maintained Bun + TypeScript production foundation needed to implement this contract: a root `package.json`, Bun package management/runtime, TypeScript `^7.0.2` unless current environment inspection shows a concrete incompatibility, a current compatible `@opencode/plugin`, minimal check/typecheck scripts, and maintained TypeScript source. Implementation should determine the plugin version from the current `../opencode` checkout and installed environment, not the historical `codex-agents` version. No complete file layout is prescribed. Do not carry forward `@opencode/theme`, `@opentui/core`, or `@opentui/solid` automatically, or add a bundler, workspace/monorepo, publishing setup, UI framework, generalized plugin/orchestration framework, workflow engine, or speculative test framework.

## Follow-up documentation reconciliation

- [Coding Authority Protocol](coding-authority-protocol.md) §5.1 and [V1 Orchestration](v1-orchestration.md) §§3–5 describe the Planner proposal and intent candidate as intent plus exact files. They need to require Planner-produced plan text as part of the proposal, candidate, and exact human authorization. V1 Orchestration currently makes the Implementer plan handoff optional; M1 requires the intact authorized plan.
- CAP §5.1 and V1 Orchestration §§5 and 7 require a separate canonical repository identity alongside worktree identity. M1 binds the canonical local worktree root and `HEAD`; those documents should align unless a concrete need for another identifier is shown.
- V1 Orchestration §7 lists approved intent and exact scope as attempt-local references but omits the frozen plan. Its reference list should include the complete immutable proposal. The process-local capability, rather than that artifact, is what admission consumes; existing CAP language already makes this distinction.
