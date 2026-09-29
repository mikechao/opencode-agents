# Documentation

## Current documents

Start here, then read the owner for the question at hand:

- [Charter](charter.md) — project purpose, principles, goals and non-goals.
- [Coding Authority Protocol (CAP)](coding-authority-protocol.md) — normative coding-authority contract.
- [V1 orchestration](v1-orchestration.md) — current OpenCode runtime architecture and implementation status.

The implementation is authoritative for current runtime behavior; CAP defines
its required authority invariants. This README owns navigation and status.

## Current implementation status

Runtime simplification is complete: milestone-named runtime architecture has
been retired. The runtime modules are `attempt.ts`, `cap.ts`, `git.ts`, and
`proposal.ts` under `src/`.

The live TUI reaches trusted Plan publication and then remains idle.
Publication grants no implementation authority. `runImplementationAttempt()`
is retained and tested but not wired from the published-plan flow; it has no
production caller. Published-plan → trusted authorization integration,
including the compact authorization strip, is future work. Reviewer, exact
reviewed-target construction, and Commit are later work.

## Historical evidence

Other investigation, milestone, probe and audit documents record historical
reasoning and evidence, rather than current contracts. They remain at their
existing paths during Phase 1 and will move under `docs/history/` in the next
cleanup phase, with superseded material pruned according to the
[cleanup plan](documentation-cleanup-plan.md).
