# opencode-agents Project Charter

`opencode-agents` is a blank-sheet, OpenCode-only experiment in enforcing a small Coding Authority Protocol for AI-assisted repository changes.

Its purpose is to determine whether the useful safety guarantees learned from `codex-agents` can be preserved without a general workflow engine, repair/recovery lifecycle, or large model-facing state protocol.

## Milestone status and direction

Milestone 0 is complete with **PASS**. Milestone 1 is complete, including live
dogfood, with **PASS**. The current `/m1` command is the working M1 harness and
reference implementation; it ends after the trusted ordinary Git
changed-path scope gate, before Review or Commit. M1 did not prove the
long-term invocation or operator experience described below.

M2 architecture/investigation is complete, and M2 implementation is complete.
Candidate 1, the native-child design in the
[threat-model reassessment](milestone-2-native-child-threat-model-reassessment.md),
is CAP-compatible under the existing V1/M1 threat model. M2 live dogfood
achieved **PASS**; see the [M2 live dogfood report](milestone-2-live-dogfood.md).
The selected same-child native Planner / read-only slot → authorized
Implementer flow is the working M2 path. The Reviewer / exact reviewed-target
milestone is next. Commit authorization and trusted Commit execution remain
later work.

The intended experience is that the user selects an `opencode-agents`
conversational Orchestrator and gives it an ordinary natural-language request.
It delegates to a fresh native Planner child and a fresh native read-only
`implementer_slot` child. Creating that slot grants no repository mutation
authority. After trusted code binds and freezes the exact Planner
proposal, presents it for explicit human confirmation, and passes freshness
and exact-child checks, trusted TUI code switches that same child to
`authorized_implementer`, consumes the one-use intent capability, and submits
the frozen proposal to it. That trusted transition is the CAP implementation
admission; the Orchestrator does not authorize or dispatch an
implementation-capable worker. M2 adds no CAP authority kind.

The same native child retains its Orchestrator parent relationship and
ordinary transcript, so the operator can navigate to its normally exposed
reasoning or thoughts, tool activity, and output where OpenCode provides
them. Private hidden chain-of-thought is not required. Session visibility,
agent selection, tool permission, and role output do not grant CAP authority.
M2 preserves M1's explicit human authorization, exact candidate binding,
freshness checks, exact-file scope, and fresh-context separation, then stops
after the existing M1 Git scope gate. The next Reviewer milestone defines
exact reviewed-target construction and Reviewer behavior; Commit authorization
and trusted Commit execution remain later work.

The protocol protects six facts: the exact Planner proposal (intent, plan, and repository file scope) approved by the human; the exact reviewed target established after M2; an independent review and its reviewer-owned validation; a fresh human authorization of the reviewed commit; the exact prepared Git effect; and the verified Git outcome.

Authority is mechanical, not conversational. Model output, agent prose, prompts, session transcripts, previous runs, generic OpenCode permission state, and model-supplied tool arguments do not constitute authorization. Facts that can be independently observed by trusted code are recomputed rather than accepted from an agent.

M1 is one authorized Plan → Implement attempt followed by an ordinary
Git-observed changed-path scope gate. Before authorization, trusted code
establishes the canonical repository/worktree root, binds the attempt to
current `HEAD`, and requires ordinary Git observation to report no staged
changed paths, no unstaged tracked changes, and no ordinary untracked paths.
Ignored untracked files remain outside this observation. Immediately before
Implementer admission, trusted code rechecks the same root, bound `HEAD`, and
cleanliness. After the Implementer finishes, trusted code verifies the same
canonical root and bound `HEAD`, independently derives ordinary Git-observed
changed paths, and requires every observed path to belong by exact path
equality to the authorized file set. Rename handling preserves exact-file
scope when both old and new paths are observable. These observations are read-only with
respect to repository content and Git history; their implementation
mechanism is not normative. M1 PASS means only that the ordinary observed
changes are within authorized scope, and M1 stops before Review or Commit.
M1 does not construct or bind an exact review target.

After M2, the later Reviewer milestone defines how an exact reviewed target
is constructed and bound to independent review and reviewer-owned validation,
then bound to reviewed-target commit authorization. This preserves V1's goal
of protecting an exact reviewed target and the resulting Git effect without
claiming that M1 has established that target.

A run is one attempt to advance one approved intent, in one canonical worktree and against one bound repository baseline, toward one reviewed and explicitly authorized commit. Ordinary failures terminate the run. A later run starts from current repository reality with fresh authority; it inherits no approval, validation, review, or repair lineage.

The architecture deliberately excludes in-run repair, mutable scope, finding adjudication, inherited authority, general recovery, changed-HEAD recovery, arbitrary child or parallel workflows, old Workflow MCP compatibility, multi-host portability, and a generic workflow abstraction. M2 is limited to the selected native Orchestrator, Planner, and read-only-slot-to-authorized-Implementer path through the existing M1 Git scope gate.

OpenCode provides orchestration, agents, and a replaceable interaction boundary that presents authorization candidates and returns explicit approve, reject, or dismiss decisions. The installed OpenCode host/TUI, installed `opencode-agents` integration and CAP kernel, OpenCode's role/tool permission checks, and the local OS/user-account boundary are the V1 trusted computing base. The authority kernel constructs and freezes candidates, binds each decision to its exact candidate, checks freshness, and creates and consumes process-local authority. Durable storage is optional for audit, diagnostics, or non-authorizing reconciliation hints; it is never the source of usable authority. Git and validation components provide observations and narrowly bounded effects.

For local V1, the current trusted CAP runtime is the active installed opencode-agents TUI plugin generation in the local OpenCode TUI process. Candidates, confirmation-result binding, and process-local capabilities live only in ordinary activation-private state for that generation. Its cleanup synchronously revokes the generation before other cleanup or awaited work; every later continuation checks revocation after an await and before an authority-bearing action. Reloaded or later TUI generations start with zero CAP authority.

The supported V1 topology is ordinary local OpenCode. The hosting checks establish local addressability and correspondence between OpenCode's reported worktree and direct local Git observations in that configuration; the TUI API does not provide general same-machine or local-versus-remote attestation. Remote/multi-host operation is outside V1, and this lack of attestation is not a blocker within that scope. CAP authority does not move to a server plugin, MCP service, OpenCode session state, or durable storage. Repository contents, worktree state, model output, tool arguments, agent prose, and durable records do not create authority merely because they exist. V1 does not defend installed trusted components against deliberate same-user modification, and does not require Docker, general sandboxing, filesystem isolation, a separate OS user, runtime attestation, or a separate authority service.

Planner, Implementer, and Reviewer role instructions MUST prohibit
intentionally performing reserved final commit/history effects. The
Implementer's system instructions MUST also require modification only within
the exact authorized repository paths and prohibit intentional manipulation
of Git configuration, index metadata, ignore rules, repository metadata, or
other shell-accessible state to conceal changes or evade ordinary M1
observation. The Implementer retains ordinary editing, testing, and
development shell capabilities. OpenCode permissions SHOULD deny obvious
direct reserved Git/shell operations as defense in depth while preserving
normal development ability. These role restrictions are behavioral
constraints, not CAP authorization or an adversarial containment boundary.
Agent compliance is not trusted evidence. M1 does not guarantee detection or
prevention of every deliberately concealed repository or filesystem mutation
available to an Implementer with ordinary development shell access; V1 adds
no sandbox, alternate OS user, custom filesystem snapshot engine, hardened
Git environment, or exhaustive Git-feature sanitizer. Trusted code
independently checks that `HEAD` remains bound through implementation and the
ordinary changed-path gate; a changed `HEAD` ends the attempt without PASS.
Generic OpenCode permission approval controls tool capability only and is
never CAP authorization. Only the trusted CAP path is authorized to perform
the eventual reviewed-target commit effect.

Ambiguous completion of `git commit` permits read-only Git reconciliation only while the trusted process remains alive. The consumed capability is never replayed. If the trusted process dies, the run ends; a later run inspects current Git reality and requires fresh authority for any further effect.

`codex-agents` remains a sibling research repository. It is an invariant corpus, adversarial/failure corpus, and technique library. It is neither a dependency nor an architecture template.

Milestone 0 completed with **PASS** and is settled. It established the trusted `ui.dialog.confirm` decision boundary; it did not implement the CAP kernel, candidate binding, freshness checks, process-local single consumption, or bounded Git effects. These remain V1 implementation obligations. The interaction mechanism is a host integration detail; replacing it must not change CAP authority semantics. The project should add infrastructure only after a demonstrated requirement.
