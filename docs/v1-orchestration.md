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
request. It proposes the requested intent and exact repository scope as an
explicit handoff artifact. Its proposal grants no authority.

### Implementer

The Implementer runs in a new sub-agent context separate from the Planner and
Orchestrator contexts. After CAP grants intent authorization, it receives the
approved intent, exact scope, bound worktree and baseline, and any explicit
plan artifact intentionally included in the handoff. It does not inherit the
Planner's conversational or reasoning context. This is one bounded attempt.
Implementation does not authorize review or commit. Trusted OpenCode
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
    | trusted UI + process-scoped CAP authorization
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

1. **Intent to implementation.** The Planner's proposed intent and scope go
   to CAP. Only CAP's trusted UI decision for the exact frozen candidate,
   candidate binding, freshness checks, and process-local single-use
   authorization admit the attempt. Intent authorization does not authorize
   commit.
2. **Implementation to review.** Trusted code derives the complete Git delta
   from the run's bound baseline and canonical worktree. It checks every
   resulting changed path against the exact authorized scope. An out-of-scope
   resulting change blocks advancement to review. Agent summaries do not
   replace the delta or scope check.
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

An ordinary failure terminates the run. This includes a failing review or
validation, missing or ambiguous review/validation evidence, inability to
establish the required fresh Reviewer context or invocation identity, and a
target mismatch. No automatic repair, retry, continuation, or reauthorization
follows. A later run starts from current repository reality, binds a current
baseline, and requires fresh authority; it inherits no approval, validation,
review, or repair lineage.

An ambiguous completion of `git commit` permits only read-only reconciliation
while the trusted CAP process remains alive. The effect is not retried under
the consumed capability. If that process dies, the run is over. A later run
starts with zero CAP authority, inspects current repository reality, and
requires fresh authorization for any further effect.

## 7. Ephemeral coordination state

For the current run only, the Orchestrator may retain these coordination
references as needed:

* approved intent and exact scope;
* bound repository, worktree, and baseline;
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
6. The exact-scope check applies to the complete trusted-derived Git delta
   before review; only a PASS independent review and successful
   reviewer-owned validation advance to commit authorization.
7. Trusted OpenCode role/tool configuration prevents Planner, Implementer, and
   Reviewer from invoking the final CAP-governed commit effect; the trusted
   CAP path performs the separately authorized bounded commit, and trusted
   code verifies its outcome.
8. Generic OpenCode permission approval controls tool capability only and is
   never CAP authorization.
9. Ordinary failure ends the run. Ambiguous commit completion permits
   read-only reconciliation only while the trusted CAP process remains alive.
10. Later processes start with zero CAP authority, derive current repository
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
  The exact configuration is an implementation detail to verify.
