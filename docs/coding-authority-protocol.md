# Coding Authority Protocol — V1 Architecture

## 1. Purpose and status

This document defines the normative V1 architecture for the Coding Authority
Protocol (CAP) in `opencode-agents`. It follows Milestone 0's **PASS** and
defines the protocol built on the established OpenCode trusted-UI decision
boundary. Requirements stated as **MUST** or **MUST NOT** are normative.

V1 uses OpenCode's plugin-owned `ui.dialog.confirm` call to present a kernel
constructed authorization candidate. The trusted UI returns a decision to the
authority kernel. The kernel binds that result to the exact frozen candidate,
rechecks freshness, interprets the authority, and uses durable local state to
record and consume the grant once before a bounded effect.

Milestone 0 established the host interaction boundary. It did not implement or
prove the protocol kernel, candidate binding, freshness checks, durable
recording, single consumption, replay prevention, or restart behavior. Those
remain required V1 system properties.

## 2. Authority model

Authority is mechanical, never conversational. A statement or signal is
authorizing only when trusted kernel code obtains the affirmative result from
the trusted UI for the exact frozen candidate, validates that candidate and
its freshness, and successfully records and consumes the resulting grant
through the durable kernel/store boundary.

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

## 3. Trust boundary

The V1 trusted computing base (TCB) consists of the OpenCode host and TUI, the
installed `opencode-agents` plugin, the authority kernel, its durable local
store, and the local OS/user-account boundary. V1 trusts these components to
present the candidate, handle the UI result, maintain authority state, and
perform the checks and effects assigned to them.

Milestone 0 established `ui.dialog.confirm` as the V1 trusted UI decision
boundary. A programmatic or model-triggered request may open the dialog. Opening
it is not approval. Only the affirmative Confirm result returned by this
trusted UI may enter the kernel's authorization path.

Model output and tool arguments, agent prose, session/chat contents, generic
OpenCode permission state, and previous runs remain outside the authority
boundary. V1 does not require physical-human attestation and does not defend
against compromised OpenCode, hostile code already running inside the TCB,
OS-level input injection, or synthetic UI input originating inside the TCB.

## 4. Responsibility split

| Component | V1 responsibility |
| --- | --- |
| OpenCode trusted UI | Display the meaningful candidate; collect and return the UI decision. It does not construct authority, bind a result to a candidate, check repository freshness, persist a grant, or prevent replay. |
| Authority kernel | Derive trusted facts; construct, canonicalize, digest, and freeze candidates; associate the UI result with the exact presented candidate; recheck candidate and repository freshness; determine the grant; and request durable record/consumption. |
| Durable local store | Persist grant state and enforce one-time consumption and replay prevention across process restarts. SQLite is an acceptable V1 implementation. |
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
6. **Record and consume.** The durable kernel/store boundary records the
   grant and permits exactly one consumption for its bound purpose. No
   effect may rely on an unrecorded or unconsumed grant.
7. **Perform bounded effect and verify.** The kernel invokes only the effect
   covered by the consumed grant, through the bounded Git or validation
   operation, and verifies the resulting repository state from trusted
   observations.

If a check, binding, persistence operation, or effect cannot complete with an
unambiguous result, the kernel fails closed. A changed or stale candidate
requires a new candidate and a new authorization attempt; the old UI result
cannot be rebound to it.

## 7. Fail-closed decision semantics

| UI or kernel outcome | Authority consequence |
| --- | --- |
| `ui.dialog.confirm` returns `true` | Necessary input to authorization only. Kernel binding, freshness checks, grant interpretation, and durable record/consumption must still succeed. |
| Confirm returns `false` (Cancel) | No authority is granted. |
| Dialog is dismissed, escaped, closed, or returns `undefined` | No authority is granted. This means no authority was granted; it need not mean the user explicitly rejected the request. |
| Invocation is interrupted, errors, crashes, times out, or produces no or ambiguous result | No authority is granted or inferred. |
| Candidate binding, freshness, or store operation fails | No authority is granted for use and no bounded effect is performed. |

The kernel MUST NOT automatically re-prompt after Cancel or dismissal as part
of the same authorization attempt. A later explicit request is a new attempt
and requires a newly constructed, freshly checked candidate and a new trusted
UI decision. No missing, malformed, interrupted, or ambiguous result may be
coerced to `true`.

## 8. Durable authority and single-use consumption

The durable store is the source of truth for whether a grant exists and has
been consumed. The kernel/store transaction boundary MUST bind each durable
grant to its candidate kind, exact candidate identity/digest, and bounded
purpose. It MUST persist the authorization and enforce an atomic one-time
consumption so that a second consumer or replay cannot authorize another
effect, including after restart.

The UI result alone is not a durable grant. If durable recording or
consumption fails or has an ambiguous outcome, the kernel MUST perform no
authorized effect. After restart, an unconsumed decision from a prior process
MUST NOT silently resume or be inherited by a later run; fresh authority is
required. A consumed grant remains consumed and MUST NOT be reactivated. The
store may retain records for audit or safe reconciliation, but retaining a
record does not make its authority reusable.

SQLite is acceptable for this local durable transaction boundary. V1 does not
require a host-issued receipt, physical-user provenance token, or separate
authority server.

## 9. Bounded effects and verification

Intent authorization bounds one attempt to the approved intent, exact scope,
canonical worktree, and baseline. It does not grant a general workflow
capability, mutable scope, or permission to commit. The kernel and effect
adapters MUST prevent operations outside that bound and MUST derive the
resulting target from trusted repository observations.

The reviewed-target commit grant is separate and bounds one prepared Git
effect to the exact reviewed target, exact commit paths, and relevant current
baseline in its candidate. Immediately before the effect, the kernel MUST
recheck that these facts still match. Git performs only the authorized bounded
effect; validation and review provide their own trusted observations. The
kernel MUST verify the resulting Git outcome rather than accepting an agent's
claim that it succeeded.

Ordinary failures terminate the attempt; V1 defines no repair or general
recovery lifecycle. The charter's sole planned exception is an ambiguous
completion of `git commit`: that attempt is unknown, and only read-only
reconciliation of Git state is permitted. The consumed authorization is not
replayed to retry the commit.

## 10. V1 invariants

1. Only the affirmative result from the trusted `ui.dialog.confirm` call can
   enter the authority path.
2. The kernel binds that result to the exact immutable candidate shown.
3. The kernel, not the model or UI, constructs and canonicalizes candidates,
   computes their digests, checks freshness, and interprets authority.
4. Intent and reviewed-target commit authorization are different grant kinds
   and cannot substitute for one another.
5. Every grant is bound to its exact purpose and bounded effect, recorded
   durably, and consumed once.
6. Cancel, dismissal, interruption, errors, crashes, and ambiguity grant no
   authority; dismissal does not have to represent an explicit rejection.
7. No approval, review, validation, or repair authority carries to a later
   run.
8. Git and validation outputs are trusted only as observations or bounded
   effects; they never create authority.
9. A commit is made only for a fresh, reviewed target under a distinct,
   consumed commit grant, and its outcome is independently verified.

## 11. Non-goals

V1 deliberately has no general workflow engine, MCP authority server, repair
or recovery lifecycle, inherited authority, mutable scope, child or parallel
workflow protocol, physical-human attestation requirement, multi-host
portability, or defense against hostile code already inside the TCB. It does
not add changed-HEAD recovery, finding adjudication, or compatibility with the
predecessor project's Workflow MCP. OpenCode permissions remain defense in
depth and are not CAP grants.

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
durable authorization, one-time consumption, replay prevention, or restart
safety. These protocol and kernel/store properties are normative here but
were not proven by M0. M0 also did not establish physical-user provenance or
protection against hostile code inside the TCB.

## 13. Open questions for the next implementation milestone

The next milestone should implement and validate the kernel/store obligations
without reopening M0's established host-boundary conclusion. It should settle
the following implementation questions:

* What canonical encoding and digest inputs represent each candidate kind,
  exact repository/worktree identity, path scope, baseline, reviewed target,
  and validation evidence?
* Which Git observations establish candidate freshness and the exact prepared
  effect, and at what points must the kernel repeat them?
* What minimal durable transaction and restart policy enforces grant binding,
  one-time consumption, and replay prevention in the local store?
* How does the plugin pass the frozen candidate to the TUI clearly while the
  kernel retains an unambiguous association between that invocation, result,
  and candidate?
* Which focused implementation checks demonstrate the invariants, including
  stale candidates, repeated consumption, process restart, bounded Git effect,
  and verified outcome?

These questions concern candidate representation, kernel/store behavior, and
effect boundaries. They do not require a broader workflow protocol or new
host authorization primitive.
