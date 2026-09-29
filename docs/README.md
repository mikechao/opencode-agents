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

Investigation, milestone, probe and audit documents are retained under
[`history/`](history/README.md) as non-normative historical evidence. Superseded
material was pruned according to the archived
[cleanup plan](history/documentation-cleanup-plan.md).
