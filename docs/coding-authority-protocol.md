# Coding Authority Protocol — V1 Architecture

## 1. Purpose and status

This document defines the normative V1 architecture for the Coding Authority
Protocol (CAP) in `opencode-agents`. It follows Milestone 0's **PASS** and
defines the protocol built on the established OpenCode trusted-UI decision
boundary. Requirements stated as **MUST** or **MUST NOT** are normative.

V1 uses OpenCode's plugin-owned `ui.dialog.confirm` call to present a kernel
constructed authorization candidate. The trusted UI returns a decision to the
authority kernel. The kernel binds that result to the exact frozen candidate,
rechecks freshness, and creates a process-scoped authorization for its exact
purpose. Trusted process state enforces single use before the bounded effect.
Durable records, if any, are optional and non-authorizing.

Milestone 0 established the host interaction boundary. It did not implement or
prove the protocol kernel, candidate binding, freshness checks, process-local
single consumption, or bounded effects. Those remain required V1 system
properties. M0 is complete and its **PASS** remains settled.

## 2. Authority model

Authority is mechanical, never conversational. CAP authority exists only in
the currently trusted CAP runtime. It is created only after trusted kernel
code obtains `true` from the trusted UI for the exact frozen candidate
presented by that invocation and rechecks that candidate and its freshness.
The resulting process-local capability is bound to its exact purpose and is
single-use. Trusted process state consumes it; no durable record is required
to create, use, or consume it.

The following MUST NOT grant or enlarge CAP authority on their own: model
output, agent prose, prompts or session text, tool arguments, candidate IDs or
digests supplied by a model, generic OpenCode permissions, successful tool
execution, lack of a denial, prior runs, or prior approvals. Trusted code
recomputes facts it can independently observe instead of accepting them from
an agent.

V1 has two distinct grant kinds:

1. **Intent authorization** grants one bounded attempt to advance one exact
   approved intent in one bound repository/worktree from one bound baseline.
2. **Reviewed-target commit authorization** grants one bounded Git commit
   effect for one exact reviewed target and its prepared paths, subject to a
   fresh check immediately before use.

These grants use the same UI primitive, but one MUST NOT stand in for the
other. Intent authorization does not authorize a commit. Commit authorization
does not authorize changing the reviewed target. A later attempt starts from
current repository reality and requires fresh authority; no approval,
validation, review, or repair authority is inherited.

The intent capability authorizes one bounded implementation attempt and is
consumed in trusted process state when CAP admits that attempt. The
reviewed-target commit capability is consumed immediately before its bounded
commit effect. Neither capability can authorize a second attempt or effect.
Both disappear when the trusted CAP runtime ends, reloads, crashes, or
restarts. A later process starts with zero CAP authority and derives current
repository reality before seeking fresh authorization.

## 3. Trust boundary

The V1 trusted computing base (TCB) consists of the installed OpenCode
host/TUI, the installed `opencode-agents` integration and CAP kernel,
OpenCode's trusted role/tool permission enforcement, and the local
OS/user-account boundary. V1 trusts these installed components to present the
candidate, handle the UI result, maintain process-local authority state,
enforce role capabilities, and perform the checks and effects assigned to
them. V1 does not defend these installed components against deliberate
modification by a same-user actor.

Milestone 0 established `ui.dialog.confirm` as the V1 trusted UI decision
boundary. A programmatic or model-triggered request may open the dialog. Opening
it is not approval. Only the affirmative Confirm result returned by this
trusted UI may enter the kernel's authorization path.

Model output, tool arguments, agent prose, session/chat contents,
repository-controlled code or configuration, durable records, and prior
process output are not authority merely because they exist. Repository-
controlled code/configuration MUST NOT be a substitute source of CAP
authority. V1 does not require general filesystem isolation from such state,
and does not defend against deliberate same-user modification of installed
TCB components, compromised OpenCode, hostile code already running inside the
TCB, OS-level input injection, or synthetic UI input originating inside the
TCB. V1 does not require physical-human attestation.

## 4. Responsibility split

| Component | V1 responsibility |
| --- | --- |
| OpenCode trusted UI | Display the meaningful candidate and collect and return the UI decision. It does not construct authority, bind a result to a candidate, or check repository freshness. |
| Authority kernel | Derive trusted facts; construct, canonicalize, digest, and freeze candidates; associate the UI result with the exact presented candidate; recheck candidate and repository freshness; and create, bind, and consume process-local capabilities. |
| Optional durable local store | Keep audit records, diagnostics, or non-authorizing reconciliation hints. SQLite is an acceptable optional implementation. Its contents MUST NOT create, restore, mark usable, reactivate, or substitute for a capability or trusted observation. V1 permits no durable store. |
| OpenCode role/tool enforcement | Reserve the final CAP-governed commit effect from Planner, Implementer, and Reviewer. Generic OpenCode permission approval is never CAP authorization. |
| Git and validation components | Supply trusted repository observations and perform only narrowly bounded effects authorized by the kernel. They do not grant authority. |
| OpenCode agents and models | Orchestrate work and request candidate presentation. Their claims, arguments, and output are not authorization or trusted observations. |

The UI's `true` result is necessary but not sufficient. The kernel MUST retain
the frozen candidate used for presentation and bind the result to that exact
candidate. Candidate construction, canonical serialization and digesting,
result binding, repository freshness, and authority interpretation belong to
the kernel, not to the UI or a model-facing caller.

## 5. Authorization candidates

A candidate is the kernel's immutable description of the exact authority being
requested. Before presentation, the kernel MUST construct the candidate from
trusted observations and validated request data, canonicalize its
authority-bearing contents, compute its digest, and freeze the resulting
snapshot. The candidate shown to the user MUST make the authority and its
important bounds understandable. Display formatting does not replace or alter
the frozen authority-bearing contents.

### 5.1 Intent candidate

An intent candidate MUST identify, at minimum:

* the requested intent;
* the exact repository scope, including the authorized paths;
* the canonical repository and worktree identity; and
* the repository baseline to which the approval is bound.

The kernel MUST derive repository identity, scope interpretation, and baseline
facts from trusted observations. A model may request intent and provide
proposed values, but those values do not become trusted facts merely because
they appear in a tool call or candidate display. An approved intent is limited
to one attempt in the bound worktree and baseline; it does not grant commit
authority.

### 5.2 Reviewed-target commit candidate

A reviewed-target commit candidate MUST identify, at minimum:

* the passing independent review and its identity or digest;
* the exact reviewed target, or a digest that unambiguously binds that target;
* the reviewer-owned validation result, bound to that review and target;
* the exact paths prepared for commit;
* the relevant current Git baseline; and
* the human-readable commit intent or summary.

The kernel MUST obtain or verify review, validation, target, path, and Git
facts through trusted observations. The candidate authorizes only a commit of
that reviewed target over those paths from the bound current baseline. It does
not authorize edits, a different target, additional paths, or a substitute
commit. The kernel MUST refuse use if any authority-bearing candidate value,
review/validation fact, or relevant repository state is stale or changed.

## 6. Authorization lifecycle

For either grant kind, V1 follows this sequence:

1. **Request.** An agent or model may request that trusted code seek
   authorization. The request itself grants nothing.
2. **Construct and freeze.** The kernel validates request data, obtains
   independent repository and validation observations as applicable, creates
   the candidate, and freezes its canonical representation and digest.
3. **Present.** The plugin asks OpenCode's trusted TUI to display the
   candidate through `ui.dialog.confirm`. The request may originate from a
   programmatic or model-triggered flow; this does not change the decision
   semantics.
4. **Receive and bind.** The kernel accepts only the result of that trusted
   UI invocation and associates it with the exact frozen candidate presented
   by that invocation. It MUST NOT look for approval in session text, agent
   output, or caller-supplied fields.
5. **Check and interpret.** Only a result equal to `true` is eligible to
   authorize. The kernel rechecks candidate integrity and all relevant
   repository, review, validation, and target freshness conditions, then
   determines the grant from the candidate kind and contents.
6. **Create and consume process-local authority.** After the trusted UI result
   and freshness checks succeed, the kernel creates a capability in the
   current trusted runtime, bound to the exact candidate and purpose. Trusted
   process state permits one use only: CAP consumes intent authorization
   when admitting its one implementation attempt and consumes commit
   authorization immediately before its bounded Git commit effect. Durable
   records are optional and cannot create or change this authority.
7. **Perform the authorized operation and verify.** For intent authorization,
   implementation may use normal OpenCode editing and shell capabilities; CAP
   constrains which resulting target may advance to review as specified in
   Section 9. For reviewed-target commit authorization, the kernel invokes
   only the bounded Git effect covered by the consumed grant. Trusted code
   verifies the relevant resulting repository state.

If a check, binding, process-local consumption, or effect cannot complete with
an unambiguous result, the kernel fails closed. A changed or stale candidate
requires a new candidate and a new authorization attempt; the old UI result
cannot be rebound to it. Failure to write an optional audit or diagnostic
record does not create, remove, or restore authority and is not a V1
authorization condition.

## 7. Fail-closed decision semantics

| UI or kernel outcome | Authority consequence |
| --- | --- |
| `ui.dialog.confirm` returns `true` | Necessary input to authorization only. Kernel binding, freshness checks, purpose binding, and process-local single-use consumption must still succeed. |
| Confirm returns `false` (Cancel) | No authority is granted. |
| Dialog is dismissed, escaped, closed, or returns `undefined` | No authority is granted. This means no authority was granted; it need not mean the user explicitly rejected the request. |
| Authorization invocation is interrupted, errors, times out, or produces no or ambiguous UI result | No new authority is granted or inferred. If the trusted runtime terminates, any authority already created in it is lost. |
| Candidate binding, freshness, or process-local authority-state operation fails | No authority is granted for use and no bounded effect is performed. |

The kernel MUST NOT automatically re-prompt after Cancel or dismissal as part
of the same authorization attempt. A later explicit request is a new attempt
and requires a newly constructed, freshly checked candidate and a new trusted
UI decision. No missing, malformed, interrupted, or ambiguous result may be
coerced to `true`.

## 8. Process-scoped authority and optional durable records

The current trusted CAP runtime is the source of usable authority. The kernel
MUST bind each process-local capability to its candidate kind, exact frozen
candidate identity, and bounded purpose, and MUST consume it once in trusted
process state. A live capability cannot be reused or reactivated after
consumption.

All CAP authority ends when that trusted runtime ends, reloads, crashes, or
restarts. A later process MUST start with zero authority: it MUST NOT recover
an approval, grant, consumed bit, candidate identity, or capability from a
durable record, prior process output, or repository state. It derives current
repository reality and requires fresh trusted UI authorization for any new
effect. Prefer losing authority over recovering it.

Durable storage is optional. SQLite or another local store MAY retain audit
records, diagnostics, or non-authorizing reconciliation hints, but its
contents MUST NOT create a grant, restore a grant, mark a grant usable,
reactivate a consumed grant, substitute for a current trusted UI result, or
substitute for fresh trusted Git/repository observations. A fake or corrupted
row MUST be incapable of producing authority. If a V1 slice needs no durable
records, it MUST be permitted to have no durable store.

For intent authorization, a crash or restart ends the attempt. Worktree
changes may remain as ordinary repository reality and inherit no authority;
a later run requires fresh authorization.

For commit authorization, CAP consumes the current process-scoped capability
immediately before the bounded commit effect and MUST NOT retry that effect
using the same capability. If the result is ambiguous while the trusted
process remains alive, read-only Git reconciliation is allowed. If that
process dies, the run is over. A later run inspects current Git reality and
requires fresh authority for any further effect. Durable reconciliation
evidence may be kept but is not required to preserve authority.

V1 does not require a host-issued receipt, physical-user provenance token,
atomic cross-restart grant consumption, or a separate authority server.

## 9. Bounded effects and verification

Intent authorization bounds which resulting repository target from one
attempt may advance to review. Implementation may use normal OpenCode editing,
testing, and development shell capabilities; CAP does not mediate or
individually authorize each transient filesystem mutation. Trusted OpenCode
role/tool configuration MUST prevent Planner, Implementer, and Reviewer from
invoking the final CAP-governed commit effect directly. The Implementer
retains ordinary capabilities needed for implementation but cannot bypass
that commit gate. Generic OpenCode permission approval MAY control whether a
role can invoke a tool, but it is never CAP authorization. Before the target
may enter review,
trusted code MUST derive the complete resulting Git delta from the bound
baseline and canonical worktree. Every changed path in that delta MUST be
within the exact authorized intent scope. If any resulting change is out of
scope, the attempt MUST NOT advance to review, and no out-of-scope resulting
change may become part of the reviewed target or a later commit authorization
candidate. This authorization does not grant a general workflow capability,
mutable scope, or permission to commit.

The reviewed-target commit authorization is separate and bounds one prepared
Git effect to the exact reviewed target, exact commit paths, and relevant
current baseline in its candidate. Immediately before the effect, the kernel
MUST recheck that these facts still match, consume the process-local
capability, and execute the authorized bounded commit through the trusted CAP
path. Trusted OpenCode role/tool enforcement reserves that final effect from
ordinary agents. Validation and review provide their own trusted observations.
The kernel MUST verify the resulting Git outcome rather than accepting an
agent's claim that it succeeded.

Ordinary failures terminate the attempt; V1 defines no repair or general
recovery lifecycle. An ambiguous completion of `git commit` permits only
read-only reconciliation while the trusted process remains alive. The
consumed authorization is never replayed. If the process dies, the run ends;
a later run starts without authority and derives current Git reality.

## 10. V1 invariants

1. Only the affirmative result from the trusted `ui.dialog.confirm` call can
   enter the authority path.
2. The kernel binds that result to the exact immutable candidate shown.
3. The kernel, not the model or UI, constructs and canonicalizes candidates,
   computes their digests, checks freshness, and interprets authority.
4. Intent and reviewed-target commit authorization are different grant kinds
   and cannot substitute for one another.
5. Every capability is bound to its exact purpose and bounded effect, exists
   only in the current trusted CAP runtime, and is consumed once in trusted
   process state.
6. Cancel, dismissal, interruption, errors, crashes, and ambiguity grant no
   authority; dismissal does not have to represent an explicit rejection.
7. No approval, capability, consumed state, review, validation, or repair
   authority carries to a later process or run; every later process starts
   with zero CAP authority.
8. Git and validation outputs are trusted only as observations or bounded
   effects; they never create authority.
9. Trusted OpenCode role/tool enforcement prevents Planner, Implementer, and
   Reviewer from invoking the final CAP-governed commit effect; generic
   permission approval is not CAP authorization.
10. CAP performs a commit only for a fresh, reviewed target under distinct,
    consumed commit authority, and trusted code independently verifies its
    outcome.
11. Durable records are optional and non-authorizing; mutable inputs,
    repository-controlled state, and records cannot create, enlarge, restore,
    replay, reuse, or substitute CAP authority. CAP-related files need not be
    physically unwritable for authority correctness. Tampering that only
    causes failure, lost audit data, or denial of service does not create
    authority and is outside B1's purpose.

## 11. Non-goals

V1 deliberately has no general workflow engine, MCP authority server, repair
or recovery lifecycle, inherited authority, mutable scope, child or parallel
workflow protocol, physical-human attestation requirement, multi-host
portability, or defense against hostile code already inside the TCB or
deliberate same-user modification of installed TCB components. It does not
require Docker, a general sandbox, a separate OS user, runtime attestation,
general filesystem isolation, or changed-HEAD recovery. It does not add
finding adjudication or compatibility with the predecessor project's
Workflow MCP. OpenCode permissions govern role/tool capability and are not
CAP authorization. Preventing transient out-of-scope filesystem mutations
during implementation is not a CAP V1 guarantee.

## 12. Relationship to Milestone 0

Milestone 0 completed with **PASS** on 2026-09-25. Dogfood established that
OpenCode `ui.dialog.confirm` could display both representative candidate
types readably; explicit Confirm returned `true`; Cancel returned `false`;
Escape/dismissal and interruption did not return a positive result; and the
tested generic permission and supported model/session/non-interactive routes
did not positively resolve a pending confirmation without trusted TUI Confirm.
The dogfood covered OpenCode `v2.0.16` and relevant bypass checks on
`v2.0.16`/`v2.0.18`.

That evidence establishes the host-side decision boundary under the V1 trust
model. The M0 harness used fixed representative fixtures and did not provide
production Git observations, production candidate binding, freshness checks,
process-local capability consumption, or bounded effects. These protocol and
kernel properties are normative here but were not proven by M0. M0 also did
not establish physical-user provenance or protection against hostile code
inside the TCB. M0 is complete; these implementation questions do not reopen
its PASS.

## 13. Open questions for the next implementation milestone

The next milestone should implement and validate the process-scoped kernel
and effect obligations without reopening M0's established host-boundary
conclusion. It should settle the following implementation questions:

* What canonical encoding and digest inputs represent each candidate kind,
  exact repository/worktree identity, path scope, baseline, reviewed target,
  and validation evidence?
* Which Git observations establish candidate freshness and the exact prepared
  effect, and at what points must the kernel repeat them?
* How does the plugin pass the frozen candidate to the TUI clearly while the
  kernel retains an unambiguous association between that invocation, result,
  and candidate?
* What trusted OpenCode role/tool configuration reserves the final bounded
  commit effect from Planner, Implementer, and Reviewer while leaving the
  Implementer its ordinary development capabilities? The exact configuration
  is an implementation detail to verify.
* Which focused implementation checks demonstrate stale-candidate handling,
  process-local single consumption, zero authority after restart, reserved
  commit execution, bounded Git effect, and verified outcome?

These questions concern candidate representation, trusted observations,
process-local kernel behavior, role/effect boundaries, and bounded Git
effects. They do not require durable reusable grants, a broader workflow
protocol, or a new host authorization primitive.
