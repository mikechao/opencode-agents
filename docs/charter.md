# opencode-agents Project Charter

`opencode-agents` is a blank-sheet, OpenCode-only experiment in enforcing a small Coding Authority Protocol for AI-assisted repository changes.

Its purpose is to determine whether the useful safety guarantees learned from `codex-agents` can be preserved without a general workflow engine, repair/recovery lifecycle, or large model-facing state protocol.

The protocol protects six facts: the exact Planner proposal (intent, plan, and repository file scope) approved by the human; the exact resulting target; an independent review and its reviewer-owned validation; a fresh human authorization of the reviewed commit; the exact prepared Git effect; and the verified Git outcome.

Authority is mechanical, not conversational. Model output, agent prose, prompts, session transcripts, previous runs, generic OpenCode permission state, and model-supplied tool arguments do not constitute authorization. Facts that can be independently observed by trusted code are recomputed rather than accepted from an agent.

For M1, the advancement target is the exact Git target path set: the union of
paths changed in the real staged target and paths changed in a fresh
Git-staged worktree target, each relative to the bound `HEAD`. A fresh
worktree target is derived with an isolated temporary index seeded from that
`HEAD` and Git's ordinary staging semantics. The real index is never modified,
resulting Git trees from two independent worktree derivations must agree, and
every path in either difference must belong to the exact authorized file set.
M1 starts only when both targets have no changed paths. Ignored untracked files
follow ordinary Git ignore semantics. These observations provide bounded
consistency for Git-materializable targets; they do not claim to detect,
prohibit, or attest to every physical filesystem mutation or transient
away-and-back change. Physical-only differences outside both Git targets are
outside M1's advancement target, and M1 does not require custom filesystem
machinery to reproduce Git configuration behavior.

A run is one attempt to advance one approved intent, in one canonical worktree and against one bound repository baseline, toward one reviewed and explicitly authorized commit. Ordinary failures terminate the run. A later run starts from current repository reality with fresh authority; it inherits no approval, validation, review, or repair lineage.

The first version deliberately excludes in-run repair, mutable scope, finding adjudication, inherited authority, general recovery, changed-HEAD recovery, child or parallel workflows, old Workflow MCP compatibility, multi-host portability, and a generic workflow abstraction.

OpenCode provides orchestration, agents, and a replaceable interaction boundary that presents authorization candidates and returns explicit approve, reject, or dismiss decisions. The installed OpenCode host/TUI, installed `opencode-agents` integration and CAP kernel, OpenCode's role/tool permission checks, and the local OS/user-account boundary are the V1 trusted computing base. The authority kernel constructs and freezes candidates, binds each decision to its exact candidate, checks freshness, and creates and consumes process-local authority. Durable storage is optional for audit, diagnostics, or non-authorizing reconciliation hints; it is never the source of usable authority. Git and validation components provide observations and narrowly bounded effects.

For local V1, the current trusted CAP runtime is the active installed opencode-agents TUI plugin generation in the local OpenCode TUI process. Candidates, confirmation-result binding, and process-local capabilities live only in ordinary activation-private state for that generation. Its cleanup synchronously revokes the generation before other cleanup or awaited work; every later continuation checks revocation after an await and before an authority-bearing action. Reloaded or later TUI generations start with zero CAP authority.

The supported V1 topology is ordinary local OpenCode. The hosting checks establish local addressability and correspondence between OpenCode's reported worktree and direct local Git observations in that configuration; the TUI API does not provide general same-machine or local-versus-remote attestation. Remote/multi-host operation is outside V1, and this lack of attestation is not a blocker within that scope. CAP authority does not move to a server plugin, MCP service, OpenCode session state, or durable storage. Repository contents, worktree state, model output, tool arguments, agent prose, and durable records do not create authority merely because they exist. V1 does not defend installed trusted components against deliberate same-user modification, and does not require Docker, general sandboxing, filesystem isolation, a separate OS user, runtime attestation, or a separate authority service.

Planner, Implementer, and Reviewer role instructions MUST prohibit intentionally performing reserved final commit/history effects. The Implementer retains ordinary editing, testing, and development shell capabilities. OpenCode permissions MAY deny obvious direct commit commands as defense in depth, but they cannot prevent an allowed shell command from causing a Git-history effect through a child process. Agent compliance is not trusted evidence. Trusted code independently verifies Git invariants: for M1, the bound `HEAD` MUST remain unchanged through implementation and final target derivation, and any change ends the attempt without PASS or advancement. This check detects a violation after its effect; M1 does not claim physical prevention. Generic OpenCode permission approval controls tool capability only and is never CAP authorization. Only the trusted CAP path is authorized to perform the eventual reviewed-target commit effect.

Ambiguous completion of `git commit` permits read-only Git reconciliation only while the trusted process remains alive. The consumed capability is never replayed. If the trusted process dies, the run ends; a later run inspects current Git reality and requires fresh authority for any further effect.

`codex-agents` remains a sibling research repository. It is an invariant corpus, adversarial/failure corpus, and technique library. It is neither a dependency nor an architecture template.

Milestone 0 completed with **PASS** and is settled. It established the trusted `ui.dialog.confirm` decision boundary; it did not implement the CAP kernel, candidate binding, freshness checks, process-local single consumption, or bounded Git effects. These remain V1 implementation obligations. The interaction mechanism is a host integration detail; replacing it must not change CAP authority semantics. The project should add infrastructure only after a demonstrated requirement.
