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

### Milestone status and M2 boundary

M1 is complete and live-dogfooded with **PASS**; the `/m1` harness stops after
its trusted ordinary Git changed-path scope gate and before Review or Commit.
M2 investigates a user-selectable OpenCode Orchestrator that receives an
ordinary request and delegates fresh native Planner and Implementer child
subagents where supported. M2 is an invocation and operator-observability
change, not a CAP change: it introduces no authority kind and does not relax
M1's exact candidate confirmation, freshness, exact-file scope, or
fresh-context requirements. Session navigation, exposed role reasoning or
thoughts, tool activity, and output are observability only; private hidden
chain-of-thought is not required. Exact reviewed-target construction and
Reviewer behavior remain deferred until after M2. Commit authorization and
trusted commit execution remain later work.

## 2. Authority model

Authority is mechanical, never conversational. CAP authority exists only in
the currently trusted CAP runtime. It is created only after trusted kernel
code obtains `true` from the trusted UI for the exact frozen candidate
presented by that invocation and rechecks that candidate and its freshness.
The resulting process-local capability is bound to its exact purpose and is
single-use. Trusted process state consumes it; no durable record is required
to create, use, or consume it.

For local V1, the current trusted CAP runtime is the active installed
opencode-agents TUI plugin generation in the local OpenCode TUI process.
Candidate/result binding and every process-local capability MUST remain in
that generation's ordinary activation-private state. The plugin cleanup MUST
synchronously mark the generation revoked before other cleanup or awaited
work. Every authority-bearing continuation MUST check that generation-local
revocation after each await and immediately before creating, consuming, or
using a capability or performing a CAP-governed effect. An old async
continuation may resume, but it cannot cross that guard. A replacement
generation starts with zero CAP authority. In this topology, the generation
also owns trusted local Git observations and the bounded CAP effect.

The following MUST NOT grant or enlarge CAP authority on their own: model
output, agent prose, prompts or session text, tool arguments, candidate IDs or
digests supplied by a model, generic OpenCode permissions, successful tool
execution, lack of a denial, prior runs, or prior approvals. Trusted code
recomputes facts it can independently observe instead of accepting them from
an agent.

V1 has two distinct grant kinds:

1. **Intent authorization** grants one bounded attempt to implement one exact
   approved intent and plan within exact file scope in one bound worktree from
   one bound baseline.
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

The supported V1 topology is ordinary local OpenCode. The local TUI/Git
validation established local addressability and correspondence between the
host-reported worktree and direct local Git observations in that
configuration. The TUI plugin API does not expose reliable general
local-versus-remote or same-machine identity, so CAP does not claim general
topology attestation. Remote/multi-host operation is outside V1; no
attestation or separate authority service is added for it.

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
| OpenCode role/tool configuration | Require role instructions to prohibit intentional reserved final commit/history effects. Implementer instructions also require exact authorized-path scope and prohibit intentional Git/configuration or shell-state manipulation to evade M1 observation. Permissions SHOULD deny obvious direct reserved Git/shell operations as defense in depth while preserving normal development ability. These behavioral constraints do not contain an Implementer with ordinary shell access. Generic OpenCode permission approval is never CAP authorization. |
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

An intent candidate MUST contain the frozen Planner proposal and trusted
binding:

* the requested intent;
* the Planner's plan text;
* the finite set of exact authorized repository-relative file paths;
* the canonical local worktree root; and
* the trusted-observed `HEAD` commit to which the approval is bound.

For each requested implementation attempt, the Planner decides and proposes
the intent, plan text, and exact file set. The proposal is an immutable attempt
artifact and grants no authority. V1 scope entries MUST be exact
repository-relative file paths; directory, subtree, glob, wildcard, and other
pattern-based entries are not supported. The scope is immutable for the
attempt. CAP MUST validate the proposed paths and freeze the complete proposal
intact in the intent candidate. CAP MUST NOT silently add, expand, infer, or
substitute any proposal field for the Planner.

At candidate construction, trusted code MUST establish the canonical local
worktree root, observe the current `HEAD` commit, and require ordinary Git
observation to report a clean baseline: no staged changed paths, no unstaged
tracked changed paths, and no ordinary untracked paths. Ignored untracked
files remain outside this M1 observation. The observation MUST be read-only
with respect to repository content and Git history. Its implementation
mechanism is not normative; M1 does not prescribe Git tree construction,
index parsing, content hashing, filesystem snapshots, or similar machinery.
This trusted-observed `HEAD` is the intent baseline. The kernel MUST derive
the canonical worktree root, cleanliness, and baseline facts from trusted
observations; model or Planner claims do not establish them. CAP MUST show the
complete frozen proposal to the human. The human authorizes one implementation
attempt of the exact frozen intent, plan, and file set in that worktree at
that `HEAD`. The frozen proposal remains available for later Review; the
single-use intent capability is what admission consumes. Intent authorization
does not grant commit authority.

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
   determines the grant from the candidate kind and contents. For intent,
   after the trusted UI confirmation and immediately before admitting the
   Implementer, the trusted boundary MUST verify the same canonical worktree
   root, the same bound `HEAD`, and continued ordinary Git-observed
   cleanliness. If any check fails, the authorization attempt
   fails closed; the old UI result MUST NOT be recovered or rebound.
6. **Create and consume process-local authority.** After the trusted UI result
   and freshness checks succeed, the kernel creates a capability in the
   current trusted runtime, bound to the exact candidate and purpose. Trusted
   process state permits one use only: CAP consumes intent authorization
   when admitting its one implementation attempt and consumes commit
   authorization immediately before its bounded Git commit effect. Durable
   records are optional and cannot create or change this authority.
7. **Perform the authorized operation and verify.** For intent authorization,
   implementation may use normal OpenCode editing and shell capabilities; M1
   applies the ordinary changed-path scope gate in Section 9 and stops before
   Review. A later milestone constructs and binds the exact reviewed target.
   For reviewed-target commit authorization, the kernel invokes only the
   bounded Git effect covered by the consumed grant. Trusted code verifies
   the relevant resulting repository state.

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
restarts. A later plugin generation or process MUST start with zero authority.
It MUST NOT recover an approval, grant, consumed bit, candidate identity, or
capability from a durable record, prior process output, or repository state.
It derives current repository reality and requires fresh trusted UI
authorization for any new effect. Prefer losing authority over recovering it.

Durable storage is optional. SQLite or another local store MAY retain audit
records, diagnostics, or non-authorizing reconciliation hints, but its
contents MUST NOT create a grant, restore a grant, mark a grant usable,
reactivate a consumed grant, substitute for a current trusted UI result, or
substitute for fresh trusted Git/repository observations. A fake or corrupted
row MUST be incapable of producing authority. If a V1 slice needs no durable
records, it MUST be permitted to have no durable store. OpenCode's
storage.memory(), storage.store(), server state, session state, and MCP state
are likewise non-authorizing and MUST NOT carry or restore CAP authority.

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

Intent authorization permits one bounded Plan → Implement attempt. M1 checks
scope after that attempt with trusted ordinary Git observations; it does not
construct, materialize, certify, or bind an exact review target. Implementation
may use normal OpenCode editing, testing, and development shell capabilities;
CAP does not mediate or individually authorize each transient filesystem
mutation. Once implementation begins, `HEAD` MUST remain the bound baseline
commit. After the Implementer finishes, trusted code MUST verify the same
canonical worktree root and bound `HEAD`, then independently derive the
ordinary Git-observed set of changed repository paths. Conceptually, that set
includes staged changed paths, unstaged tracked changes, and ordinary
untracked paths; ignored untracked files remain outside the observation. The
observation MUST be read-only with respect to repository content and Git
history, but its implementation mechanism is not normative.

Every observed path MUST belong by exact path equality to the authorized file
set. Rename handling need only preserve exact-file scope semantics: when both
old and new paths are observable as part of the change, both must be
authorized. Concurrent or unattributed observed changes receive the same
scope check. After this gate, M1 stops before Review and Commit. Passing the
gate does not establish semantic satisfaction, complete physical mutation
detection, an exact review target, or commit readiness. Exact reviewed-target
construction and binding belong to the later review/commit boundary.

Planner, Implementer, and Reviewer role instructions MUST prohibit
intentionally performing reserved final commit/history effects. The
Implementer's system instructions MUST also require it to modify only the
exact authorized repository paths and prohibit intentionally manipulating
Git configuration, index metadata, ignore rules, repository metadata, or
other shell-accessible state to conceal changes or evade M1 observation.
OpenCode permissions SHOULD deny obvious direct reserved Git/shell operations
as defense in depth while preserving normal development ability. These are
behavioral constraints, not CAP authorization or an adversarial containment
boundary. Agent compliance is not trusted evidence. Generic OpenCode
permission approval MAY control whether a role can invoke a tool, but it is
never CAP authorization.

M1 does not claim to detect or prevent every deliberately concealed repository
or filesystem mutation available to an Implementer with ordinary development
shell access. It is not required to defend against deliberate use of Git
configuration, index flags, child processes, filesystem tricks, or equivalent
means to evade ordinary Git observation. V1 adds no sandbox, alternate OS
user, custom filesystem snapshot engine, hardened Git execution environment,
or exhaustive Git-feature sanitizer. These restrictions do not change the
separate trusted CAP authority for the eventual reviewed-target commit.

The attempt MUST end without M1 PASS if `HEAD` changes, the canonical root or
ordinary Git observation cannot be established, or any observed path falls
outside the authorized set. A changed-`HEAD` check detects the effect after
it occurs; V1 makes no claim that ordinary development shell access physically
prevents an unauthorized Git-history effect. CAP MUST NOT expand or amend the
scope in place or recover against a changed `HEAD`. A later run may start from
current repository reality with a fresh Planner proposal and fresh intent
authorization. This authorization does not grant a general workflow
capability, mutable scope, or permission to commit.

The reviewed-target commit authorization is separate and bounds one prepared
Git effect to the exact reviewed target, exact commit paths, and relevant
current baseline in its candidate. Immediately before the effect, the kernel
MUST recheck that these facts still match, consume the process-local
capability, and execute the authorized bounded commit through the trusted CAP
path. Only this trusted CAP path is authorized to perform the reviewed-target
commit effect; ordinary agents have no CAP commit authority, even though their
development shell access cannot physically exclude a violation. Validation
and review provide their own trusted observations. The kernel MUST verify the
resulting Git outcome rather than accepting an agent's claim that it succeeded.

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
9. At candidate construction, M1 establishes the canonical root, bound `HEAD`,
   and ordinary Git-observed cleanliness (no staged, unstaged tracked, or
   ordinary untracked changed paths; ignored untracked files are excluded).
   Immediately before Implementer admission, trusted code rechecks the same
   root, bound `HEAD`, and cleanliness. After implementation, it verifies the
   same root and bound `HEAD`, independently observes ordinary changed paths, and
   requires every observed path to equal an authorized file path. M1 then
   stops before Review or Commit; it does not construct an exact target.
10. Implementer system instructions MUST require exact authorized-path scope,
    prohibit intentionally performing reserved commit/history effects, and
    prohibit intentional manipulation of Git configuration, index metadata,
    ignore rules, repository metadata, or other shell-accessible state to
    conceal changes or evade ordinary M1 observation. OpenCode permissions
    SHOULD deny obvious direct reserved Git/shell operations as defense in
    depth while preserving normal development ability. These are behavioral
    constraints, not CAP authorization or an adversarial containment boundary;
    agent compliance is not trusted evidence. M1 does not guarantee detection
    of deliberate concealment by an Implementer with ordinary shell access.
11. CAP performs a commit only for a fresh, reviewed target under distinct,
    consumed commit authority, and trusted code independently verifies its
    outcome.
12. Durable records are optional and non-authorizing; mutable inputs,
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
CAP authorization. M1 checks ordinary Git-observed cleanliness and changed
paths at its trusted gates. It does not claim to detect or prevent every
physical or deliberately concealed repository mutation available to an
Implementer with ordinary development shell access.

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
conclusion or the settled intent-scope and intent-freshness semantics above.
The following implementation details remain:

* What canonical encoding and digest inputs represent each candidate kind,
  the trusted-derived canonical worktree root, the exact proposed intent,
  plan, and path set, the bound `HEAD`, reviewed target, and validation evidence?
* Which concrete trusted observations implement the exact prepared-effect
  checks for reviewed-target commit authorization?
* How does the plugin pass the frozen candidate to the TUI clearly while the
  kernel retains an unambiguous association between that invocation, result,
  and candidate?
* How will the later Reviewer milestone construct and bind an exact reviewed
  target to independent review, reviewer-owned validation, and subsequent
  commit authorization?
* How will role instructions prohibit intentional reserved commit/history
  effects and intentional attempts to evade ordinary M1 observation, and which
  direct permission denials should provide defense in depth while retaining
  ordinary development shell access?
* Which focused implementation checks demonstrate stale-candidate handling,
  process-local single consumption, zero authority after restart, reserved
  commit execution, bounded Git effect, and verified outcome?

These questions concern implementation of settled candidate, scope, and
freshness semantics, process-local kernel behavior, role/effect boundaries,
and bounded Git effects. The trusted evidence for reviewer-owned validation
remains deferred to the Review → Commit milestone. None of these questions
requires durable reusable grants, a broader workflow protocol, or a new host
authorization primitive.
