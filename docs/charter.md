# opencode-agents Project Charter

`opencode-agents` is a blank-sheet, OpenCode-only experiment in enforcing a small Coding Authority Protocol for AI-assisted repository changes.

Its purpose is to determine whether the useful safety guarantees learned from `codex-agents` can be preserved without a general workflow engine, repair/recovery lifecycle, or large model-facing state protocol.

The protocol protects six facts: the exact intent and repository scope approved by the human; the exact resulting target; an independent review and its reviewer-owned validation; a fresh human authorization of the reviewed commit; the exact prepared Git effect; and the verified Git outcome.

Authority is mechanical, not conversational. Model output, agent prose, prompts, session transcripts, previous runs, generic OpenCode permission state, and model-supplied tool arguments do not constitute authorization. Facts that can be independently observed by trusted code are recomputed rather than accepted from an agent.

A run is one attempt to advance one approved intent, in one canonical worktree and against one bound repository baseline, toward one reviewed and explicitly authorized commit. Ordinary failures terminate the run. A later run starts from current repository reality with fresh authority; it inherits no approval, validation, review, or repair lineage.

The first version deliberately excludes in-run repair, mutable scope, finding adjudication, inherited authority, general recovery, changed-HEAD recovery, child or parallel workflows, old Workflow MCP compatibility, multi-host portability, and a generic workflow abstraction.

OpenCode provides orchestration, agents, and a replaceable interaction boundary that presents authorization candidates and returns explicit approve, reject, or dismiss decisions. The installed OpenCode host/TUI, installed `opencode-agents` integration and CAP kernel, OpenCode's trusted role/tool enforcement, and the local OS/user-account boundary are the V1 trusted computing base. The authority kernel constructs and freezes candidates, binds each decision to its exact candidate, checks freshness, and creates and consumes process-local authority. Durable storage is optional for audit, diagnostics, or non-authorizing reconciliation hints; it is never the source of usable authority. Git and validation components provide observations and narrowly bounded effects.

CAP authority exists only in the currently trusted runtime and is lost when it ends, reloads, crashes, or restarts. Every later process starts with zero authority, derives current repository reality, and requires fresh authorization for any further effect. Repository contents, worktree state, model output, tool arguments, agent prose, and durable records do not create authority merely because they exist. V1 does not defend installed trusted components against deliberate same-user modification, and does not require Docker, general sandboxing, filesystem isolation, a separate OS user, runtime attestation, or a separate authority service.

Trusted OpenCode role/tool configuration reserves the final CAP-governed commit effect: Planner, Implementer, and Reviewer cannot invoke it directly. The Implementer retains ordinary editing, testing, and development shell capabilities. Generic OpenCode permission approval controls tool capability only and is never CAP authorization. The trusted CAP path performs the separately authorized bounded commit.

Ambiguous completion of `git commit` permits read-only Git reconciliation only while the trusted process remains alive. The consumed capability is never replayed. If the trusted process dies, the run ends; a later run inspects current Git reality and requires fresh authority for any further effect.

`codex-agents` remains a sibling research repository. It is an invariant corpus, adversarial/failure corpus, and technique library. It is neither a dependency nor an architecture template.

Milestone 0 completed with **PASS** and is settled. It established the trusted `ui.dialog.confirm` decision boundary; it did not implement the CAP kernel, candidate binding, freshness checks, process-local single consumption, or bounded Git effects. These remain V1 implementation obligations. The interaction mechanism is a host integration detail; replacing it must not change CAP authority semantics. The project should add infrastructure only after a demonstrated requirement.
