# Milestone 1 — Authorized Plan → Implementation

## Contract and boundary

M1 proves one local, authorized Plan → Implement attempt. It begins with one
user request and ends after trusted code derives the Git target path set and
checks it against the exact authorized file set. It stops before review or
commit.

```text
User request → Orchestrator → fresh Planner → explicit proposal
             → trusted CAP candidate → human confirmation
             → trusted freshness recheck → one fresh Implementer
             → trusted Git target derivation → exact-scope check → STOP
```

The active installed `opencode-agents` TUI plugin generation is the local V1 CAP runtime. Its activation-private state holds the candidate/result binding and transient authority. Cleanup synchronously revokes that generation; an authority-bearing continuation checks revocation after awaits and before acting. A dead or replaced generation ends the attempt. OpenCode session work that outlives it has no CAP authority.

## Proposal, candidate, and authorization

The Orchestrator receives the request and creates one fresh OpenCode Planner sub-agent invocation. The Planner owns one explicit proposal containing **all three** fields: human-readable intent, human-readable plan text, and a finite set of exact repository-relative file paths. Directory, subtree, glob, wildcard, and implicit scope entries are invalid. The proposal is an immutable run artifact and grants no authority. CAP and the Orchestrator must not invent, expand, silently repair, substitute, or reinterpret any of its fields.

Trusted CAP validates the proposal and freezes it intact in an intent candidate.
CAP adds only the trusted-derived canonical local worktree root and
trusted-observed `HEAD`; a separate repository identifier or Git tree hash is
not required for M1. At baseline, the M1 clean-target condition requires both
(1) no difference between the real staged target and bound `HEAD`, and (2) no
difference between a fresh Git-staged worktree target and bound `HEAD`.
Git-staged worktree targets are derived using isolated temporary indexes seeded
from bound `HEAD` and Git's ordinary staging semantics; the resulting Git trees
from two independent derivations must agree. The real index MUST NOT be
modified. Ignored untracked files remain outside this target under ordinary
Git ignore semantics. This clean-target condition is a trusted precondition
and freshness fact, not a fourth Planner field. Internal encoding remains an
implementation choice.

CAP presents the exact frozen candidate through the validated trusted OpenCode TUI confirmation path and binds that invocation's result to that candidate. Only an affirmative result may proceed. The human authorizes **one implementation attempt of this exact intent, using this exact plan, limited to these exact files**, in the bound worktree at the bound `HEAD`. The plan is visible, mandatory, and authority-bearing. Generic tool permission, model text, agent output, and a prior approval do not authorize the attempt.

Immediately after confirmation and immediately before Implementer admission, trusted code verifies the same canonical worktree root, the same `HEAD`, and continued satisfaction of the M1 clean-target condition. A mismatch ends the attempt; CAP does not refresh, amend, rebind, rebase, or reuse the confirmation. On success, the current TUI plugin generation holds a process-local, single-use **intent authorization capability** for admitting one fresh Implementer. That capability is consumed at admission and is never passed to an agent. It cannot be reconstructed from repository or session state, storage, prior output, or prior approval. The frozen Planner proposal itself is **not consumed**: it remains intact as the authoritative artifact for this attempt and the later Reviewer milestone.

## Minimal Orchestrator and role handoff

The Orchestrator sequences one Planner invocation, captures its proposal, requests CAP authorization, admits one Implementer only after the trusted authorization and freshness checks, waits for its completion, requests trusted post-implementation Git derivation and scope checking, reports the result, and stops. CAP alone constructs candidates, interprets the bound UI result, and creates and consumes authority. Trusted code, rather than Orchestrator interpretation of agent prose, establishes Git facts.

The Orchestrator must not modify the proposal; manufacture or infer CAP authority; enlarge, repair, reuse, revive, or rebind it; silently expand scope; derive `HEAD`, the clean-target condition, or the Git target path set from model claims; retry either role; repair or resume a failed attempt; or become a workflow engine. It may retain only attempt-local references needed to bind the Planner invocation and proposal, canonical worktree root and `HEAD`, Implementer invocation, and returned artifacts/results. These ephemeral references confer no authority, are not persisted workflow phases, and may die with the attempt.

Trusted orchestration binds the proposal to the specific Planner invocation that produced it and binds the admitted Implementer invocation to its returned result. Role names and model claims alone do not establish invocation identity. Each role starts in a fresh OpenCode sub-agent context distinct from the Orchestrator, the other role, and any previous invocation. The exact OpenCode session/reference mechanism is an implementation choice; M1 adds no durable invocation history or runtime-affinity machinery.

Admission consumes the one-shot capability and creates exactly one fresh Implementer invocation. The Implementer receives the **exact frozen authorized intent, plan, and file set**, plus trusted baseline facts needed to operate safely, such as the canonical worktree root and bound `HEAD`. It receives neither the capability nor the Planner's conversational history, hidden reasoning, or the Orchestrator's conversational context. It retains ordinary read, edit, test, and development shell abilities. Planner and Implementer role instructions MUST prohibit intentionally performing reserved final commit/history effects. OpenCode permissions MAY deny obvious direct commit commands as defense in depth, but cannot prevent an allowed development shell command from causing such an effect through a child process. Agent compliance is not trusted evidence. Only the trusted CAP path is authorized to perform the eventual reviewed-target commit effect; M1 does not impose a general filesystem or shell sandbox.

## Post-implementation gate and result

Once that Implementer invocation completes, trusted code derives the Git target
path set against bound `HEAD` in the canonical worktree. The set is the union
of (1) paths changed in the real staged target and (2) paths changed in a fresh
Git-staged worktree target, each compared with the same bound `HEAD`. The
worktree target is derived twice using independent temporary indexes; the
resulting Git trees MUST agree. Trusted code MUST verify the real index's
Git-observed entry state is stable across derivation, require `HEAD` to remain
bound, and recheck the canonical root and `HEAD` before returning the target.
Derivation MUST NOT modify the real index. Every pathname in either target
difference must belong to the exact authorized file set. Rename detection is
unnecessary: a rename represented as deletion plus addition requires both the
old and new paths to be authorized. Ignored untracked files are outside the
target under ordinary Git ignore semantics; a path already staged in the real
index remains part of the real staged target. All in-scope target paths count,
including concurrent or unattributed changes. Agent summaries and compliance
claims never replace these trusted observations. The bound `HEAD` MUST remain
unchanged through implementation and final target derivation. Any changed
`HEAD`, unsupported or ambiguous repository state, derivation disagreement,
unstable real index, or out-of-scope path ends the attempt without PASS or
advancement. M1 governs Git-materializable targets: it does not claim to
detect, prohibit, or attest to every physical filesystem mutation. Physical-
only differences that Git would not materialize into either target are outside
M1's advancement target. Independent temporary-target agreement and
index/root/`HEAD` rechecks provide bounded consistency, not an atomic
filesystem snapshot; transient away-and-back mutations that leave the same
final Git target need not be detected. Passing this gate makes no claim that
the implementation semantically fulfills the intent or plan.

**M1 PASS** requires one request, one fresh Planner invocation and its three-field proposal; trusted clean-target, canonical-root, and `HEAD` observations; freezing and presentation of the exact candidate; explicit human confirmation; a successful immediate pre-admission root/`HEAD`/clean-target recheck; one valid process-local intent capability consumed to admit exactly one distinct fresh Implementer; handoff of the intact proposal without Planner context or commit authority; unchanged `HEAD` after implementation; trusted Git target derivation with every resulting path inside the exact file set; and a stop without review or commit.

**Ordinary failure means stop.** A malformed or missing proposal, role failure or unbound role/result identity, reject or dismiss decision, stale or ambiguous authorization, revoked TUI generation, failed freshness check, changed `HEAD`, unsupported or ambiguous repository state, or out-of-scope target path ends the current attempt. There is no retry, repair, continuation, recovery, scope amendment, or grant reuse. A later attempt begins from current repository reality with a fresh Planner proposal, trusted observations, human authorization, and, if admitted, fresh Implementer. It inherits no authority or workflow phase.

## Explicit deferrals and production foundation

M1 defers Reviewer orchestration and semantic adjudication; reviewer-owned validation; reviewed-target construction and commit authorization; commit-effect preparation, `git commit`, post-commit verification, and ambiguous-commit reconciliation; repair, retry, recovery, mutable scope, changed-`HEAD` recovery, durable audit/storage, and persisted workflow phases. A later fresh Reviewer should receive this same frozen authorized intent, plan, and file set to judge the resulting target, but M1 stops before that role exists.

M1 may establish the smallest maintained Bun + TypeScript production foundation needed to implement this contract: a root `package.json`, Bun package management/runtime, TypeScript `^7.0.2` unless current environment inspection shows a concrete incompatibility, a current compatible `@opencode/plugin`, minimal check/typecheck scripts, and maintained TypeScript source. Implementation should determine the plugin version from the current `../opencode` checkout and installed environment, not the historical `codex-agents` version. No complete file layout is prescribed. Do not carry forward `@opencode/theme`, `@opentui/core`, or `@opentui/solid` automatically, or add a bundler, workspace/monorepo, publishing setup, UI framework, generalized plugin/orchestration framework, workflow engine, or speculative test framework.
