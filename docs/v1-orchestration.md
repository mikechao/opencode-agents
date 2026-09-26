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
commit, and verifies its outcome. OpenCode editing and shell capabilities may
be used during implementation, subject to normal OpenCode controls and CAP's
resulting-target checks.

## 3. V1 roles

These are responsibility assignments. The names alone do not establish
security isolation or make role output a trusted observation.

### Planner

The Planner proposes the requested intent and its exact repository scope.
Its proposal is input to CAP intent authorization; it grants no authority.

### Implementer

The Implementer makes changes after CAP has granted intent authorization for
the bound intent, scope, worktree, and baseline. This is one bounded attempt.
Implementation does not authorize review or commit, and the Implementer does
not perform the final CAP-bounded commit.

### Reviewer

The Reviewer independently reviews the exact trusted-derived target and owns
the validation performed for that review. Review and validation must precede
commit authorization. Reviewer claims alone do not establish trusted review
or validation facts.

### Orchestrator

The Orchestrator sequences these responsibilities, requests CAP operations,
and passes the current run's references to the next step. It neither decides
that CAP authority exists nor substitutes its own judgment for a trusted
observation or effect.

## 4. Happy-path sequence

```text
User request
    |
    v
Planner
    |
    | proposed intent + exact scope
    v
CAP intent authorization
    |
    | trusted UI + kernel/store grant
    v
Implementer
    |
    v
Trusted target derivation
    |
    | complete Git delta
    | exact-scope check
    v
Reviewer
    |
    | independent review
    | reviewer-owned validation
    v
CAP reviewed-target commit authorization
    |
    | trusted UI + kernel/store grant
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

1. **Intent to implementation.** The Planner's proposal goes to CAP. Only
   CAP's trusted UI decision, exact-candidate binding, freshness checks, and
   durable grant consumption authorize the attempt. Intent authorization
   does not authorize commit.
2. **Implementation to review.** Trusted code derives the complete Git delta
   from the run's bound baseline and canonical worktree. It checks every
   resulting changed path against the exact authorized scope. An out-of-scope
   resulting change blocks advancement to review. Agent summaries do not
   replace the delta or scope check.
3. **Review to commit authorization.** The Reviewer reviews the same derived
   target and owns its validation. Trusted code must obtain or verify the
   review and validation facts and bind them to that target; agent prose alone
   is insufficient. Independent review and reviewer-owned validation happen
   before CAP is asked to authorize the commit.
4. **Authorization to Git effect.** CAP separately authorizes the exact
   reviewed target and prepared paths. Trusted code rechecks the bound facts,
   performs only that bounded Git commit, and verifies the Git outcome. The
   orchestrator and agents do not infer success from a command response or
   claim.

## 6. Failure and termination semantics

An ordinary failure terminates the run. V1 has no automatic retry, repair,
continuation, or reauthorization loop. A later run starts from current
repository reality, binds a current baseline, and requires fresh authority;
it inherits no approval, validation, review, or repair lineage.

The sole planned exception is ambiguous completion of `git commit`. In that
case, only read-only reconciliation of Git state is allowed, as defined by
the charter and CAP. The commit is not retried under the consumed grant.

## 7. Ephemeral coordination state

The orchestrator keeps only the coordination data needed for the current run,
such as the proposed request, references to the bound worktree/baseline and
scope, and trusted handoff results needed to request the next operation. CAP
and its durable store remain the source of truth for grants and their
consumption.

V1 does not persist workflow phases, worker-attempt state, retry counters,
continuation state, repair lineage, or reviewer-adjudication state. Such
persisted state cannot resume or authorize work in a later run.

## 8. Relationship to CAP

CAP defines intent and reviewed-target commit grants as distinct, single-use
authorizations bound to exact candidates. Only the trusted UI result, bound
and checked by the kernel and recorded/consumed by its store, can provide
those grants. Orchestration may request either CAP operation, but cannot
create or change its candidate or treat prior authority as current authority.

CAP also defines the trusted checks and bounded effects at these boundaries.
This document assigns their sequence; it does not change candidate
construction, decision semantics, grant persistence, freshness rules, scope
semantics, or commit verification.

## 9. V1 invariants

1. Orchestration selects the next step; it never supplies authorization.
2. Planner, Implementer, Reviewer, and Orchestrator are not authority sources.
3. Intent and reviewed-target commit authorization are distinct CAP grants.
4. No step advances based only on successful agent completion or agent prose
   where a trusted authorization, observation, or effect result is required.
5. The exact-scope check applies to the complete trusted-derived Git delta
   before review; review and reviewer-owned validation precede commit
   authorization.
6. A commit occurs only through the separately authorized bounded Git effect,
   and its outcome is verified by trusted code.
7. Ordinary failure ends the run; only ambiguous commit completion permits
   read-only reconciliation.
8. Later runs start from current repository reality and require fresh
   authority.

## 10. Non-goals

V1 does not define a general workflow engine, persisted workflow phases,
recovery or repair protocols, continuation machinery, retries as protocol
state, child or parallel workflows, mutable scope, inherited authority,
finding adjudication, a separate orchestration service, or an MCP workflow
server.

## 11. Open implementation questions

* How will OpenCode invoke the roles and pass handoff references while
  preserving the trusted boundaries above?
* Which trusted component will derive the complete Git delta and bind the
  admitted target to review and commit authorization?
* How will the implementation establish and verify reviewer independence and
  reviewer-owned validation as trusted facts?
