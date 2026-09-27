# V1 Orchestration

## 1. Purpose and status

This document normatively defines the V1 OpenCode orchestration layer for
`opencode-agents`. It specifies sequencing and role boundaries for one run.
The Coding Authority Protocol (CAP) remains the normative source for
authorization semantics; this document does not redefine CAP.

The separation is:

* **OpenCode orchestration:** what happens next?
* **CAP:** is this exact action authorized?
* **Trusted observations and effects:** what is actually true, and what
  bounded effect may be performed?

The orchestrator controls sequencing but MUST NOT own or manufacture
authority.

## 2. Responsibility of the orchestrator

The orchestrator requests work from the roles below and advances only when
the required trusted handoff has completed. It may request CAP operations,
but cannot modify the Planner proposal or create, infer, enlarge, reuse, or
revive authority. A successful agent response, tool call, or task completion
is not proof that a required
authorization or trusted observation exists.

Trusted code, rather than agent prose, derives repository and Git facts,
checks scope, establishes review and validation facts, performs the bounded
commit, and verifies its outcome. Planner, Implementer, and Reviewer role
instructions MUST prohibit intentionally performing reserved final
commit/history effects. Implementer system instructions MUST also require
exact authorized-path scope and prohibit intentional Git/configuration or
shell-state manipulation to conceal changes or evade M1 observation. The
Implementer retains ordinary editing, testing, and development shell
capabilities. OpenCode permissions SHOULD deny obvious direct reserved
Git/shell operations as defense in depth while preserving normal development
ability. These are behavioral constraints, not CAP authorization or an
adversarial containment boundary. Agent compliance is not trusted evidence;
ordinary shell access means M1 does not guarantee detection of deliberate
evasion. Generic OpenCode permission approval is not CAP authorization.

For local V1, the active installed opencode-agents TUI plugin generation owns
CAP authority in ordinary activation-private state. OpenCode client/session
traffic may carry role inputs, artifacts, and results, but it does not carry
CAP authority. Server-side role/session work may outlive a TUI generation;
that work inherits no authority, and no lifecycle coupling is required. Any
resulting repository changes are current repository reality for a later run,
which follows the existing stop, derive current reality, and ask again rule.

## 3. V1 roles and context boundaries

Planner, Implementer, and Reviewer each MUST run as separate OpenCode
sub-agent invocations, each with a fresh context distinct from the other role
invocations and the Orchestrator context. The Orchestrator MUST NOT pass one
role's conversational or reasoning context into another role. Cross-role
handoffs use only explicit artifacts, trusted references, and bounded inputs
required by this contract.

Role names alone are not trusted evidence. Trusted orchestration/plugin
context MUST distinguish the relevant role invocations and bind their results
to the current run and, where applicable, the exact target. Fresh sub-agent
context separation defines Reviewer independence in V1. It does not require
cryptographic attestation, process isolation, or model/provider diversity;
the Implementer and Reviewer MAY use the same underlying model or model family.

### Planner

The Planner runs in its own fresh sub-agent context and receives the user
request. It proposes the requested intent, plan text, and a finite set of exact
repository-relative file paths as one explicit immutable artifact. V1 does not
support directory, subtree, glob, wildcard, or other pattern-based scope
entries. Its proposal grants no authority. CAP validates the proposed paths
and freezes the complete proposal intact in the intent candidate; CAP does not
silently add, expand, infer, or substitute any proposal field for the Planner.

### Implementer

The Implementer runs in a new sub-agent context separate from the Planner and
Orchestrator contexts. After trusted UI confirmation and immediately before
admitting the attempt, the trusted boundary verifies the same canonical
worktree root, bound `HEAD`, and ordinary Git-observed cleanliness: no staged
changed paths, no unstaged tracked changed paths, and no ordinary untracked
paths. Ignored untracked files remain outside this observation. If any check
fails, the attempt ends and the UI result is not recovered or rebound. On
success, CAP consumes the single-use intent capability and the Implementer
receives the exact frozen authorized intent, plan, and file set, plus the
canonical worktree root and bound `HEAD` baseline facts. The Implementer does
not inherit the Planner's conversational or reasoning context.

The Implementer's system instructions MUST require it to modify only the exact
authorized repository paths; not intentionally perform commit/history effects
reserved for the trusted CAP path; and not intentionally manipulate Git
configuration, index metadata, ignore rules, repository metadata, or other
shell-accessible state to conceal changes or evade ordinary M1 scope
observation. It retains ordinary read, edit, test, and development shell
abilities. OpenCode permissions SHOULD deny obvious direct reserved Git/shell
operations as defense in depth while preserving normal development ability.
These role restrictions are behavioral constraints, not CAP authorization or
an adversarial containment boundary. Implementation is one bounded attempt;
it does not itself authorize review or commit.

### Reviewer

The Reviewer runs in a new sub-agent context separate from the Implementer and
Orchestrator contexts. It receives the same frozen authorized Planner proposal,
the later established exact reviewed target and the bounded review inputs it
needs. It does not inherit the Implementer's conversational or
reasoning context. The Reviewer independently
reviews that target and owns the validation performed for the review. Its
claims alone do not establish trusted review or validation facts.

### Orchestrator

The Orchestrator sequences these responsibilities, requests CAP operations,
and passes only the current run's explicit handoff artifacts and references
to the next step. It neither decides that CAP authority exists nor
substitutes its own judgment for a trusted observation or effect.

## 4. Happy-path sequence

```text
M1
User request → Planner → intent authorization → fresh Implementer
             → trusted bound-HEAD + ordinary changed-path observation
             → exact-scope check → M1 STOP

Later V1
exact reviewed-target construction and binding
             → fresh Reviewer → reviewer-owned validation
             → reviewed-target commit authorization
             → bounded commit → verified Git outcome
```

M1 ends after the trusted changed-path scope gate. It does not construct,
materialize, certify, or bind an exact target for Review. The later Reviewer
milestone defines exact reviewed-target construction and binding to
independent review and reviewer-owned validation, followed by binding that
reviewed target to commit authorization. The Reviewer receives that later
established exact target, not an M1 target.

## 5. Trusted handoff boundaries

1. **Intent to implementation.** The Planner's proposed intent, plan text,
   and finite exact-file scope go to CAP. Before authorization, candidate
   construction establishes the trusted canonical local worktree root,
   observes `HEAD` as the baseline, and requires ordinary Git observation to
   report no staged changed paths, no unstaged tracked changed paths, and no
   ordinary untracked paths. Ignored untracked files remain outside this
   observation. The observation is read-only with respect to repository
   content and Git history; its implementation mechanism is not normative.
   Only CAP's trusted UI decision for the candidate, candidate binding, and
   process-local single-use authorization can admit the attempt. Immediately
   before Implementer admission, trusted code rechecks the same canonical
   root, bound `HEAD`, and ordinary cleanliness. Failure ends the attempt; the
   UI result is not recovered or rebound. Intent authorization does not
   authorize commit.
2. **Implementation to M1 STOP.** After the Implementer completes, trusted
   code verifies the same canonical root and that `HEAD` remains bound, then
   independently derives the ordinary Git-observed changed-path set. It
   conceptually includes staged changed paths, unstaged tracked changes, and
   ordinary untracked paths; ignored untracked files remain excluded. The
   observation is read-only with respect to repository content and Git
   history; its implementation mechanism is not normative. Every observed
   path is compared by exact path equality with the authorized file set.
   Rename handling preserves exact-file scope semantics: when both old and
   new paths are observable as part of the change, both must be authorized.
   Concurrent or unattributed observed changes receive the same check. A
   changed `HEAD`, failure to establish the canonical root or ordinary
   observation, or any out-of-scope path ends the attempt. Otherwise M1 may
   PASS and stops before Review or Commit. This gate does not establish
   semantic satisfaction, detect every physical mutation, or construct an
   exact reviewed target.
3. **Later target construction, then review to commit authorization.** The
   later Reviewer milestone first defines how trusted code constructs the
   exact reviewed target and binds it for independent review, reviewer-owned
   validation, and subsequent commit authorization. Trusted orchestration/plugin
   context verifies that the Reviewer is a fresh sub-agent invocation distinct
   from the Implementer and binds its review and validation results to that
   invocation and that later established target. Only a PASS independent
   review together with successful reviewer-owned validation may advance to
   CAP reviewed-target commit authorization. CAP receives trusted review and
   validation facts bound to the exact target.
4. **Authorization to Git effect.** CAP separately authorizes the exact
   reviewed target and prepared paths. Planner, Implementer, and Reviewer
   have no CAP commit authority; their ordinary development shell access
   cannot physically prevent an unauthorized Git-history effect. The trusted
   CAP path rechecks the bound facts, consumes the process-local capability
   immediately before the effect, performs only that bounded Git commit, and
   verifies the Git outcome. Generic OpenCode permission approval is never CAP
   authorization.
   The orchestrator and agents do not infer success from a command response
   or claim.

## 6. Failure and termination semantics

An ordinary failure terminates the run. This includes a failed
pre-implementation worktree-root, `HEAD`, or ordinary cleanliness check; a
changed `HEAD` during implementation; any out-of-scope observed path; a
failing review or validation; missing or ambiguous review/validation evidence;
inability to establish the required fresh Reviewer context or invocation
identity; and a target mismatch. No automatic repair, scope amendment, retry,
continuation, or reauthorization follows. Stop, derive current repository
reality, and ask again in a later run with a fresh Planner proposal and fresh
authority. The later run inherits no approval, validation, review, or repair
lineage.

An ambiguous completion of `git commit` permits only read-only reconciliation
while the trusted CAP process remains alive. The effect is not retried under
the consumed capability. If that process dies, the run is over. A later run
starts with zero CAP authority, inspects current repository reality, and
requires fresh authorization for any further effect.

When the TUI plugin generation reloads or deactivates, cleanup synchronously
revokes its CAP authority. A late continuation from that generation must check
revocation after awaiting host or role operations and before any
authority-bearing action. OpenCode server/session activity can continue, but
cannot inherit or restore that authority.

## 7. Ephemeral coordination state

For the current run only, the Orchestrator may retain these coordination
references as needed:

* frozen authorized Planner proposal (intent, plan, and exact-file scope);
* bound canonical worktree root, ordinary cleanliness, and `HEAD` baseline;
* Planner invocation/reference;
* Implementer invocation/reference;
* later reviewed-target identity or digest, once that target is constructed;
* Reviewer invocation/reference;
* review result/reference; and
* reviewer-owned validation result/reference.

These are run-local coordination references and artifacts only. The frozen
proposal remains available through the run and later Review; admission
consumes the process-local intent capability, not the proposal. These
references are not durable workflow state and do not confer authority. The
current trusted CAP runtime's process-local state is the source of usable
authorization and its consumption. Optional durable records may support audit
or diagnostics but cannot create or restore authority.

V1 does not persist workflow phases, worker-attempt state, retry counters,
continuation state, repair lineage, or reviewer-adjudication state. Such
persisted state cannot resume or authorize work in a later run.

## 8. Relationship to CAP

CAP defines intent and reviewed-target commit authorizations as distinct,
single-use capabilities bound to exact candidates and held only in the current
trusted runtime. Only the trusted UI result for the exact frozen candidate,
bound and checked by the kernel, can create them. Trusted process state
consumes them; durable records are optional and non-authorizing. Orchestration
may request either CAP operation, but cannot create or change its candidate
or treat prior authority as current authority.

CAP also defines the trusted checks and bounded effects at these boundaries.
This document assigns their sequence; it does not change candidate
construction, decision semantics, process-scoped authority, freshness rules,
scope semantics, or commit verification.

## 9. V1 invariants

1. Orchestration selects the next step; it never supplies authorization.
2. Planner, Implementer, Reviewer, and Orchestrator are not authority sources.
3. Each Planner, Implementer, and Reviewer invocation starts in its own fresh
   sub-agent context. Cross-role information is passed only through explicit
   handoff artifacts or trusted references and bounded inputs required by
   this contract.
4. Intent and reviewed-target commit authorizations are distinct, single-use
   CAP capabilities held only in the current trusted runtime.
5. No step advances based only on successful agent completion or agent prose
   where a trusted authorization, observation, or effect result is required.
6. Before authorization, the intent attempt establishes the canonical
   worktree root, bound `HEAD`, and ordinary Git-observed cleanliness;
   immediately before implementation the trusted boundary verifies the same
   root and `HEAD` and continued cleanliness.
7. After implementation, trusted code verifies the same canonical root and
   bound `HEAD`, independently observes ordinary changed paths, and checks each by
   exact path equality against the authorized file set. Staged, unstaged
   tracked, and ordinary untracked paths are conceptually included; ignored
   untracked files remain excluded. Rename handling checks both old and new
   paths when both are observable. M1 PASS stops before Review and does not
   construct an exact target. A later milestone defines exact reviewed-target
   construction and binding. Only a PASS independent review and successful
   reviewer-owned validation of that later established target advance to
   commit authorization.
8. Planner, Implementer, and Reviewer instructions prohibit intentional
   reserved final commit/history effects. Optional direct-command permission
   denials are defense in depth, not a complete effect boundary; agent
   compliance is not trusted evidence. Only the trusted CAP path is authorized
   to perform the reviewed-target commit, and trusted code verifies its outcome.
9. Generic OpenCode permission approval controls tool capability only and is
   never CAP authorization.
10. Ordinary failure ends the run. Ambiguous commit completion permits
   read-only reconciliation only while the trusted CAP process remains alive.
11. Later processes start with zero CAP authority, derive current repository
    reality, and require fresh authorization for any further effect.

## 10. Non-goals

V1 does not define a general workflow engine, persisted workflow phases,
recovery or repair protocols, continuation machinery, retries as protocol
state, child or parallel workflows, mutable scope, inherited authority,
finding adjudication, a separate orchestration service, or an MCP workflow
server. Reviewer context separation does not imply process isolation or
cryptographic attestation.

## 11. Open implementation questions

* How will OpenCode expose invocation references and bounded handoff artifacts
  so trusted orchestration can distinguish roles and bind results to the
  current run and exact target?
* How will the later Reviewer milestone construct an exact reviewed target,
  bind it to independent review and reviewer-owned validation, and then bind
  it to commit authorization?
* Which trusted observations establish successful reviewer-owned validation?
* How will role instructions prohibit intentional reserved commit/history
  effects, and which direct-command permission denials, if any, should provide
  defense in depth while retaining ordinary development capabilities?
