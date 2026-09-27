# Milestone 1 — Authorized Plan → Implementation

## Contract and boundary

M1 proves one local, authorized Plan → Implement attempt. Before authorization,
trusted code establishes the canonical repository/worktree root, binds the
attempt to current `HEAD`, and requires an ordinarily clean Git-observed
baseline. It repeats the root, `HEAD`, and cleanliness checks immediately
before Implementer admission. After implementation, trusted code confirms the
same canonical root and bound `HEAD`, derives the ordinary Git-observed
changed-path set, and checks every observed path against the exact authorized
file set. M1 then
stops before Review or Commit; it does not construct or bind an exact review
target.

```text
User request → Orchestrator → fresh Planner → explicit proposal
             → trusted CAP candidate → human confirmation
             → trusted freshness recheck → one fresh Implementer
             → trusted HEAD + ordinary changed-path observation
             → exact-scope check → M1 STOP
```

The active installed `opencode-agents` TUI plugin generation is the local V1 CAP runtime. Its activation-private state holds the candidate/result binding and transient authority. Cleanup synchronously revokes that generation; an authority-bearing continuation checks revocation after awaits and before acting. A dead or replaced generation ends the attempt. OpenCode session work that outlives it has no CAP authority.

## Proposal, candidate, and authorization

The Orchestrator receives the request and creates one fresh OpenCode Planner sub-agent invocation. The Planner owns one explicit proposal containing **all three** fields: human-readable intent, human-readable plan text, and a finite set of exact repository-relative file paths. Directory, subtree, glob, wildcard, and implicit scope entries are invalid. The proposal is an immutable run artifact and grants no authority. CAP and the Orchestrator must not invent, expand, silently repair, substitute, or reinterpret any of its fields.

Trusted CAP validates the proposal and freezes it intact in an intent
candidate. CAP adds the trusted-derived canonical local worktree root and
trusted-observed `HEAD`; a separate repository identifier or Git tree hash is
not required for M1. Before authorization, trusted code requires ordinary Git
observation to report no staged changes, no unstaged tracked changes, and no
ordinary untracked paths. Ignored untracked files remain outside this
observation. This trusted-observed cleanliness is a precondition and
freshness fact, not a fourth Planner field. The observation is read-only with
respect to repository content and Git history; its implementation mechanism
is not normative.

CAP presents the exact frozen candidate through the validated trusted OpenCode TUI confirmation path and binds that invocation's result to that candidate. Only an affirmative result may proceed. The human authorizes **one implementation attempt of this exact intent, using this exact plan, limited to these exact files**, in the bound worktree at the bound `HEAD`. The plan is visible, mandatory, and authority-bearing. Generic tool permission, model text, agent output, and a prior approval do not authorize the attempt.

Immediately after confirmation and immediately before Implementer admission,
trusted code rechecks the same canonical worktree root, bound `HEAD`, and
ordinary Git-observed cleanliness. A mismatch ends the attempt; CAP does not
refresh, amend, rebind, rebase, or reuse the confirmation. On success, the
current TUI plugin generation holds a process-local, single-use **intent
authorization capability** for admitting one fresh Implementer. That
capability is consumed at admission and is never passed to an agent. It cannot
be reconstructed from repository or session state, storage, prior output, or
prior approval. The frozen Planner proposal itself is **not consumed**: it
remains intact as the authoritative artifact for this attempt and the later
Reviewer milestone.

## Minimal Orchestrator and role handoff

The Orchestrator sequences one Planner invocation, captures its proposal,
requests CAP authorization, admits one Implementer only after trusted
authorization and freshness checks, waits for its completion, requests
trusted post-implementation ordinary changed-path observation and scope
checking, reports the result, and stops. CAP alone constructs candidates,
interprets the bound UI result, and creates and consumes authority. Trusted
code, rather than Orchestrator interpretation of agent prose, establishes Git
facts.

The Orchestrator must not modify the proposal; manufacture or infer CAP
authority; enlarge, repair, reuse, revive, or rebind it; silently expand
scope; derive `HEAD`, baseline cleanliness, or the changed-path set from model
claims; retry either role; repair or resume a failed attempt; or become a
workflow engine. It may retain only attempt-local references needed to bind
the Planner invocation and proposal, canonical worktree root and `HEAD`,
Implementer invocation, and returned artifacts/results. These ephemeral
references confer no authority, are not persisted workflow phases, and may
die with the attempt.

Trusted orchestration binds the proposal to the specific Planner invocation that produced it and binds the admitted Implementer invocation to its returned result. Role names and model claims alone do not establish invocation identity. Each role starts in a fresh OpenCode sub-agent context distinct from the Orchestrator, the other role, and any previous invocation. The exact OpenCode session/reference mechanism is an implementation choice; M1 adds no durable invocation history or runtime-affinity machinery.

Admission consumes the one-shot capability and creates exactly one fresh
Implementer invocation. The Implementer receives the **exact frozen
authorized intent, plan, and file set**, plus trusted baseline facts needed to
operate safely, such as the canonical worktree root and bound `HEAD`. It
receives neither the capability nor the Planner's conversational history,
hidden reasoning, or the Orchestrator's conversational context. Its system
instructions MUST require it to modify only the exact authorized repository
paths; not intentionally perform commit/history effects reserved for the
trusted CAP path; and not intentionally manipulate Git configuration, index
metadata, ignore rules, repository metadata, or other shell-accessible state
to conceal changes or evade ordinary M1 scope observation. It retains
ordinary read, edit, test, and development shell abilities. OpenCode
permissions SHOULD deny obvious direct reserved Git/shell operations as
defense in depth while preserving normal development ability. These role
restrictions are behavioral constraints, not CAP authorization or an
adversarial containment boundary. Agent compliance is not trusted evidence.
Only the trusted CAP path is authorized to perform the eventual
reviewed-target commit effect.

## Post-implementation gate and result

Once that Implementer invocation completes, trusted code verifies the same
canonical root and that `HEAD` is still the bound `HEAD`, then independently
derives the ordinary Git-observed set of changed repository paths. This
observation conceptually includes staged changed paths, unstaged tracked
changes, and ordinary untracked paths. Ignored untracked files remain
excluded. The observation is read-only with respect to repository content and
Git history; its implementation mechanism is not normative. Rename handling
need only preserve exact-file scope semantics: when both old and new paths
are observable as part of a change, both must be authorized. Every observed
path, including concurrent or unattributed changes, must belong by exact path
equality to the authorized file set. Agent summaries and compliance claims
never replace these trusted observations. A changed `HEAD`, inability to
establish the canonical root or ordinary changed-path observation, or any
out-of-scope path ends the attempt without PASS.

Passing this gate means only that the ordinary observed changes are within
the authorized file scope. M1 does not claim to detect or prevent every
deliberately concealed repository or filesystem mutation available to an
Implementer with ordinary development shell access. It is not required to
defend against deliberate use of Git configuration, index flags, child
processes, filesystem tricks, or equivalent means to evade ordinary Git
observation. V1 adds no sandbox, alternate OS user, custom filesystem
snapshot engine, hardened Git execution environment, or exhaustive
Git-feature sanitizer. M1 does not establish semantic satisfaction of the
plan, construct an exact review target, or establish commit readiness.

**M1 PASS** requires one request and exact three-field Planner proposal;
CAP freezing and presentation of that exact candidate and explicit human
confirmation; a fresh one-use Implementer admission with no Planner context
or commit authority; an initially clean
ordinary Git-observed baseline and successful immediate pre-admission checks
of canonical root, bound `HEAD`, and cleanliness; unchanged bound `HEAD` after
implementation; ordinary Git-observed changed paths all within the exact
authorized file set; and a stop before Review or Commit. This gate does not
construct an exact reviewed target.

**Ordinary failure means stop.** A malformed or missing proposal, role failure
or unbound role/result identity, reject or dismiss decision, stale or
ambiguous authorization, revoked TUI generation, failed freshness check,
changed `HEAD`, inability to establish ordinary Git observations, or an
out-of-scope observed path ends the current attempt. There is no retry,
repair, continuation, recovery, scope amendment, or grant reuse. A later
attempt begins from current repository reality with a fresh Planner proposal,
trusted observations, human authorization, and, if admitted, fresh
Implementer. It inherits no authority or workflow phase.

## Explicit deferrals and production foundation

M1 defers exact reviewed-target construction and binding, Reviewer
orchestration and semantic adjudication, reviewer-owned validation,
reviewed-target commit authorization, commit-effect preparation, `git commit`,
post-commit verification, and ambiguous-commit reconciliation;
repair, retry, recovery, mutable scope, changed-`HEAD` recovery, durable
audit/storage, and persisted workflow phases. The later Reviewer milestone
must define how the exact target is constructed, bound to independent review
and reviewer-owned validation, and subsequently bound to commit
authorization. A later fresh Reviewer receives the frozen authorized intent,
plan, and file set together with that later established target. M1 stops
before constructing that target or admitting that role.

M1 may establish the smallest maintained Bun + TypeScript production foundation needed to implement this contract: a root `package.json`, Bun package management/runtime, TypeScript `^7.0.2` unless current environment inspection shows a concrete incompatibility, a current compatible `@opencode/plugin`, minimal check/typecheck scripts, and maintained TypeScript source. Implementation should determine the plugin version from the current `../opencode` checkout and installed environment, not the historical `codex-agents` version. No complete file layout is prescribed. Do not carry forward `@opencode/theme`, `@opentui/core`, or `@opentui/solid` automatically, or add a bundler, workspace/monorepo, publishing setup, UI framework, generalized plugin/orchestration framework, workflow engine, or speculative test framework.
