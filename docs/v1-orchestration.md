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

### Current milestone boundary

M0 is complete with **PASS**. M1 is complete and live-dogfooded with
**PASS**. Its `/m1` command remains the known-good harness/reference and
stops after the trusted ordinary Git changed-path scope gate, before Review
or Commit. M1's trusted plugin code coordinates fresh role sessions; it did
not establish a user-selectable OpenCode Orchestrator delegating navigable
native child subagents.

M2 architecture investigation is complete enough for implementation
planning. Candidate 1 in the [threat-model reassessment](milestone-2-native-child-threat-model-reassessment.md)
is selected as CAP-compatible under the existing V1/M1 threat model; M2
implementation planning is next. M2 itself has not been implemented or passed,
and live dogfood has not happened.

The selected flow is an ordinary user request to a conversational Orchestrator,
a fresh native Planner child, then a fresh native read-only
`implementer_slot` child. The Orchestrator creates that slot, but the
slot's creation grants no repository-mutation authority. Trusted code must
bind the exact Planner result and slot child to the current attempt. Trusted
TUI code constructs and freezes `{intent, plan, files}` with the canonical
worktree root and bound `HEAD`, presents the candidate, obtains explicit
human confirmation, and checks freshness and exact-child identity. It then
switches that same child to `authorized_implementer`, consumes the
process-local intent capability, and submits the exact frozen proposal and
baseline facts to that child. It binds the admitted input and result, runs
the existing M1 Git scope gate, and stops. The Orchestrator does not authorize
or directly dispatch an implementation-capable worker.

The native child retains its parent relationship and ordinary transcript.
The operator can navigate through the original Orchestrator subagent row or
family view and inspect the child's normally exposed reasoning or thoughts,
tool activity, and output where OpenCode provides them. Private hidden
chain-of-thought is not required. This invocation and observability change
creates no CAP authority and preserves M1's explicit confirmation, freshness,
exact-file scope, and fresh-context guarantees. M1 did not prove this M2
interaction model.

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

Each role MUST have a context distinct from the other role contexts and the
Orchestrator context. The Orchestrator MUST NOT pass one role's conversational
or reasoning context into another role. Cross-role handoffs use only explicit
artifacts, trusted references, and bounded inputs required by this contract.
For M1, Planner and Implementer are separate fresh role sessions. For M2,
Planner is a fresh native child, while the Implementer context is the fresh
native `implementer_slot` child established before authorization and later
switched for the authorized turn. It is the same session across those two
turns, not a second child invocation. The authorized turn receives no Planner
conversation context; trusted code supplies the frozen proposal directly.
The later Reviewer remains a separate fresh sub-agent invocation.

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

For M2, the Orchestrator MUST establish one fresh native `implementer_slot`
child for this role. Its effective permissions MUST make it mechanically
read-only: deny edit, shell, `execute`, subagent delegation,
session-control tools, custom mutation tools, MCP routes, and equivalent
model-callable mutation paths. This bootstrap receives no CAP authority and
the Orchestrator MUST NOT create an `authorized_implementer` child. The child
is the same session that will later run the authorized turn.

After explicit trusted UI confirmation, trusted code verifies the same
canonical worktree root, bound `HEAD`, and ordinary Git-observed cleanliness:
no staged changed paths, no unstaged tracked changed paths, and no ordinary
untracked paths. Ignored untracked files remain outside this observation. It
also binds and verifies the exact Planner result and exact slot child for the
current attempt. If any check fails, the attempt ends and the UI result is not
recovered or rebound. Trusted TUI code switches that exact child to
`authorized_implementer`; after the awaited switch it rechecks the child and
freshness immediately before admission. CAP consumes the single-use intent
capability and trusted TUI code submits the exact frozen authorized intent,
plan, and file set, plus canonical worktree root and bound `HEAD`, to that
same child. Creating the child and switching its role are not themselves CAP
admission. The Implementer receives no Planner conversational or reasoning
context.

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

### M2 permission boundary

The `authorized_implementer` role MUST deny native subagent delegation,
`execute`, ordinary session-control routes, and any equivalent exposed tool
that could admit another model-controlled turn or switch roles. The
Orchestrator's effective permissions MUST allow `subagent:planner` and
`subagent:implementer_slot`, deny `subagent:authorized_implementer`, and deny
other subagents unless later explicitly required. They MUST also deny
Orchestrator mutation paths, including edit, shell, `execute`,
session-control tools, custom mutation tools, MCP routes, and equivalent
model-callable paths. A native continuation naming the denied
`authorized_implementer` target is denied before child lookup; a permitted
continuation naming `implementer_slot` switches the existing child to that
read-only role before prompting it. Effective inherited permissions must keep
that continuation read-only. These controls block native model-controlled
reuse routes but do not create a shell sandbox. The accepted M1 limitations
for ordinary development shell access remain. After one trusted CAP admission,
the child may remain selected as `authorized_implementer`; that persistent
OpenCode capability does not restore the consumed process-local grant. A
local human or trusted client manually prompting the session later is outside
the governed CAP admission, as it is for the M1 root Implementer.

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

For M2, the Orchestrator's native subagent target permissions allow only
`planner` and `implementer_slot`. The Planner invocation and the slot
bootstrap for an attempt MUST be fresh. The Orchestrator MUST NOT name or
continue `authorized_implementer`, invoke another subagent role, or expose
another model-callable mutation or session-control route. A permitted
continuation naming `implementer_slot` switches that child back to its
read-only role before prompting it. The Orchestrator's proposal prose or
paraphrase is never the authoritative Planner-to-Implementer transport;
trusted code freezes the exact Planner proposal and supplies it directly to
the verified child after CAP admission.

## 4. Happy-path sequence

```text
M1 (complete; current /m1 harness)
User request → /m1 harness → fresh Planner → intent authorization
             → fresh Implementer
             → trusted bound-HEAD + ordinary changed-path observation
             → exact-scope check → M1 STOP

M2 (selected Candidate 1; implementation planning next)
Select Orchestrator + ordinary request → trusted initial root/HEAD/clean check
             → fresh native Planner child
             → fresh native read-only implementer_slot child
             → bind exact Planner result/child and slot child to current attempt
             → recheck initial root, HEAD, and clean baseline
             → freeze {intent, plan, files} with trusted root and HEAD
             → present candidate → explicit human confirmation
             → trusted freshness and exact-child checks
             → trusted TUI switches the same child to authorized_implementer
             → recheck liveness, exact child/role, root, HEAD, cleanliness
             → consume one process-local intent capability
             → submit exact frozen proposal and baseline to that child
             → bind exact input/result → existing trusted M1 Git scope gate
             → STOP

After M2
exact reviewed-target construction and binding
             → fresh Reviewer → reviewer-owned validation
             → reviewed-target commit authorization
             → bounded commit → verified Git outcome
```

The Orchestrator's original subagent row for `implementer_slot` represents
only the harmless bootstrap invocation. It is not rewritten to report the
later trusted implementation result. That later turn appears in the same
child transcript. This is a presentation detail and carries no authority.

M1 ends after the trusted changed-path scope gate. It does not construct,
materialize, certify, or bind an exact target for Review. The later Reviewer
milestone, after M2, defines exact reviewed-target construction and binding to
independent review and reviewer-owned validation, followed by binding that
reviewed target to commit authorization. The Reviewer receives that later
established exact target, not an M1 target.

## 5. Trusted handoff boundaries

1. **Intent to implementation.** At attempt start, before either native child
   is launched, trusted code establishes the canonical local worktree root,
   bound `HEAD`, and ordinary Git-observed cleanliness: no staged changed
   paths, no unstaged tracked changed paths, and no ordinary untracked paths.
   Ignored untracked files remain outside this observation. The observation is
   read-only with respect to repository content and Git history; its
   implementation mechanism is not normative. The Orchestrator then launches
   a fresh native Planner child and creates a fresh native `implementer_slot`
   child whose effective permissions deny all mutation routes. This child
   creation grants no authority. Trusted code binds the exact Planner result
   and Planner child, plus the exact slot child, to the current attempt. After
   Planner and slot work, trusted code rechecks the original root, bound
   `HEAD`, and clean baseline, then freezes the exact proposal and trusted
   baseline in the candidate. CAP presents that candidate for explicit human
   confirmation. After confirmation, trusted code verifies freshness and
   child identity, switches that same child to `authorized_implementer`, then
   rechecks liveness, child identity, and freshness immediately before
   consuming the process-local intent capability and submitting the exact
   frozen proposal. Failure ends the attempt; the UI result is not recovered
   or rebound. Intent authorization does not authorize commit.
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
* M2 Planner invocation/reference and exact result binding;
* M2 `implementer_slot` child and bootstrap invocation/result reference;
* Implementer invocation/reference (the same child after its trusted role
  switch in M2);
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
3. Each role receives a context distinct from the other roles and the
   Orchestrator. In M2, a fresh native Planner child and a fresh native
   `implementer_slot` child are created; trusted TUI code later switches that
   same slot child for the authorized implementation turn. The Implementer
   receives the frozen Planner artifact directly and no Planner conversation
   context. Cross-role information is passed only through explicit handoff
   artifacts or trusted references and bounded inputs required by this
   contract.
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

* Which smallest mechanism supported by current OpenCode APIs will let
  trusted code bind the exact native Planner result and exact
  `implementer_slot` child to the current attempt before CAP admission?
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
