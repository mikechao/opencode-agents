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
but cannot create, infer, enlarge, reuse, or revive authority. A successful
agent response, tool call, or task completion is not proof that a required
authorization or trusted observation exists.

Trusted code, rather than agent prose, derives repository and Git facts,
checks scope, establishes review and validation facts, performs the bounded
commit, and verifies its outcome. Trusted OpenCode configuration enforces
which role/tool effects agents can invoke. The Implementer retains ordinary
editing, testing, and development shell capabilities but cannot invoke the
final CAP-governed commit effect. Generic OpenCode permission approval is not
CAP authorization.

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
request. It decides and proposes the requested intent and a finite set of
exact repository-relative file paths as an explicit handoff artifact. V1 does
not support directory, subtree, glob, wildcard, or other pattern-based scope
entries. Its proposal grants no authority. CAP validates and canonicalizes
the proposed paths, then freezes that exact set in the intent candidate; CAP
does not silently add, expand, infer, or substitute scope for the Planner.

### Implementer

The Implementer runs in a new sub-agent context separate from the Planner and
Orchestrator contexts. After trusted UI confirmation and immediately before
admitting the attempt, the trusted boundary verifies the same
repository/worktree, the same `HEAD`, and continued worktree cleanliness. If
any check fails, the attempt ends and the UI result is not recovered or
rebound. On success, CAP consumes the intent authorization and the Implementer
receives the approved intent, frozen exact scope, bound repository/worktree
identity, and clean-worktree and `HEAD` baseline facts, plus any explicit plan
artifact intentionally included in the handoff. The Implementer does not
inherit the Planner's conversational or reasoning context. This is one bounded
attempt. Implementation does not authorize review or commit. Trusted OpenCode
role/tool configuration prevents the Implementer from invoking the final
CAP-governed commit effect, which is performed only through the separately
authorized trusted CAP path.

### Reviewer

The Reviewer runs in a new sub-agent context separate from the Implementer and
Orchestrator contexts. It receives the exact trusted-derived target admitted
to review and the bounded review inputs it needs. It does not inherit the
Implementer's conversational or reasoning context. The Reviewer independently
reviews that target and owns the validation performed for the review. Its
claims alone do not establish trusted review or validation facts.

### Orchestrator

The Orchestrator sequences these responsibilities, requests CAP operations,
and passes only the current run's explicit handoff artifacts and references
to the next step. It neither decides that CAP authority exists nor
substitutes its own judgment for a trusted observation or effect.

## 4. Happy-path sequence

```text
User request
    |
    v
Planner (fresh sub-agent context)
    |
    | proposed intent + exact scope
    v
CAP intent authorization
    |
    | trusted UI result + exact-candidate binding
    v
Trusted pre-implementation freshness check
    |
    | same repository/worktree + same HEAD + still clean; consume intent grant
    v
Implementer (fresh sub-agent context)
    |
    v
Trusted target derivation
    |
    | complete Git delta
    | exact-scope check
    v
Reviewer (fresh sub-agent context)
    |
    | PASS independent review
    | successful reviewer-owned validation
    v
CAP reviewed-target commit authorization
    |
    | trusted UI + process-scoped CAP authorization
    v
Bounded Git commit
    |
    v
Verified Git outcome
```

The sequence advances only on trusted results at the handoffs described
below. The target admitted to review is the target that must be reviewed and
later named by commit authorization.

## 5. Trusted handoff boundaries

1. **Intent to implementation.** The Planner's proposed intent and finite
   exact-file scope go to CAP. Candidate construction establishes the trusted
   repository/worktree identity, observes `HEAD` as the baseline, and verifies
   the canonical worktree is clean (no staged changes, unstaged tracked-file
   changes, or untracked files; ignored files are excluded). Only CAP's
   trusted UI decision for the candidate, candidate binding, and
   process-local single-use authorization can admit the attempt. Immediately
   before admitting the Implementer, the trusted boundary verifies the same
   repository/worktree, the same `HEAD`, and continued cleanliness. Failure
   ends the attempt; the UI result is not recovered or rebound. Intent
   authorization does not authorize commit.
2. **Implementation to review.** Trusted code verifies that `HEAD` remains
   the bound baseline and derives the complete resulting Git delta against
   that `HEAD` from the canonical worktree, including staged and unstaged
   tracked changes and untracked files; ignored files are excluded. Resulting
   path membership uses exact path equality: a modified file's path, an added
   or untracked file's path, and a deleted file's old path must each be in the
   authorized set. A rename must have both its old and new paths in the set,
   including when Git represents it as delete plus add. No edit attribution is
   required; all concurrent or otherwise unattributed changes are included in
   the complete delta and checked the same way. A changed `HEAD` or any
   out-of-scope path terminates the attempt and prevents review. Scope is not
   amended or expanded in place, and there is no changed-`HEAD` recovery.
   Agent summaries do not replace the delta or scope check.
3. **Review to commit authorization.** Trusted orchestration/plugin context
   verifies that the Reviewer is a fresh sub-agent invocation distinct from
   the Implementer, and binds its review and reviewer-owned validation
   results to that invocation and the same derived target. Only a PASS
   independent review together with successful reviewer-owned validation may
   advance to CAP reviewed-target commit authorization. CAP receives the
   trusted review and validation facts bound to the exact target.
4. **Authorization to Git effect.** CAP separately authorizes the exact
   reviewed target and prepared paths. Trusted OpenCode role/tool
   configuration prevents Planner, Implementer, and Reviewer from invoking
   the final CAP-governed commit effect. The trusted CAP path rechecks the
   bound facts, consumes the process-local capability immediately before the
   effect, performs only that bounded Git commit, and verifies the Git
   outcome. Generic OpenCode permission approval is never CAP authorization.
   The orchestrator and agents do not infer success from a command response
   or claim.

## 6. Failure and termination semantics

An ordinary failure terminates the run. This includes a failed
pre-implementation repository/worktree, `HEAD`, or cleanliness check; a
changed `HEAD` during implementation; any out-of-scope resulting path; a
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

* approved intent and frozen exact-file scope;
* bound repository, worktree, clean-start condition, and `HEAD` baseline;
* Planner invocation/reference;
* Implementer invocation/reference;
* derived target identity or digest;
* Reviewer invocation/reference;
* review result/reference; and
* reviewer-owned validation result/reference.

These are run-local coordination references only. They are not durable
workflow state and do not confer authority. The current trusted CAP runtime's
process-local state is the source of usable authorization and its consumption.
Optional durable records may support audit or diagnostics but cannot create or
restore authority.

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
6. The intent attempt starts from a clean canonical worktree and a
   trusted-observed `HEAD`; immediately before implementation the trusted
   boundary verifies the same repository/worktree and `HEAD` and continued
   cleanliness.
7. The exact-scope check applies to the complete trusted-derived delta against
   the bound `HEAD` before review, with exact-path membership and both paths
   required for renames; changed `HEAD` or any out-of-scope path terminates
   the attempt. Only a PASS independent review and successful reviewer-owned
   validation advance to commit authorization.
8. Trusted OpenCode role/tool configuration prevents Planner, Implementer, and
   Reviewer from invoking the final CAP-governed commit effect; the trusted
   CAP path performs the separately authorized bounded commit, and trusted
   code verifies its outcome.
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
* Which trusted component will derive the complete Git delta and bind the
  admitted target to review and commit authorization?
* Which trusted observations establish successful reviewer-owned validation?
* Which trusted OpenCode role/tool configuration reserves the final commit
  effect while retaining the Implementer's ordinary development capabilities?
  This remains an M1 implementation obligation; the exact configuration is
  an implementation detail to verify.
