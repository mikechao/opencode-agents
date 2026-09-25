# opencode-agents Project Charter

`opencode-agents` is a blank-sheet, OpenCode-only experiment in enforcing a small Coding Authority Protocol for AI-assisted repository changes.

Its purpose is to determine whether the useful safety guarantees learned from `codex-agents` can be preserved without a general workflow engine, repair/recovery lifecycle, or large model-facing state protocol.

The protocol protects six facts: the exact intent and repository scope approved by the human; the exact resulting target; an independent review and its reviewer-owned validation; a fresh human authorization of the reviewed commit; the exact prepared Git effect; and the verified Git outcome.

Authority is mechanical, not conversational. Model output, prompts, session transcripts, previous runs, and generic tool permissions do not constitute approval. Facts that can be independently observed by trusted code are recomputed rather than accepted from an agent.

A run is one attempt to advance one approved intent, in one canonical worktree and against one bound repository baseline, toward one reviewed and explicitly authorized commit. Ordinary failures terminate the run. A later run starts from current repository reality with fresh authority; it inherits no approval, validation, review, or repair lineage.

The first version deliberately excludes in-run repair, mutable scope, finding adjudication, inherited authority, general recovery, changed-HEAD recovery, child or parallel workflows, old Workflow MCP compatibility, multi-host portability, and a generic workflow abstraction.

OpenCode provides orchestration, agents, user interaction, and defense-in-depth permissions. A small authority kernel owns approval binding, protocol ordering, freshness checks, and authorization decisions. SQLite provides durable transactional ordering. Git and validation components provide observations and narrowly bounded effects.

Ambiguous completion of `git commit` is the sole planned exception to ordinary terminal-failure semantics. Because Git is an external non-transactional side effect, a prepared attempt may enter an unknown state from which only read-only reconciliation is permitted.

`codex-agents` remains a sibling research repository. It is an invariant corpus, adversarial/failure corpus, and technique library. It is neither a dependency nor an architecture template.

The project should add infrastructure only after a demonstrated requirement. Its first milestone is to prove or falsify that an OpenCode-native human interaction can be bound by the authority kernel to one exact kernel-generated digest, consumed exactly once, without model, permission-policy, auto-approval, replay, or session ambiguity. If this boundary cannot be demonstrated without substantial new infrastructure, the architecture must be reconsidered before implementation proceeds.
