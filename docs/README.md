# Documentation

## Current documents

Start here, then read the owner for the question at hand:

- [Charter](charter.md) — project purpose, principles, goals and non-goals.
- [Coding Authority Protocol (CAP)](coding-authority-protocol.md) — normative coding-authority contract.
- [V1 orchestration](v1-orchestration.md) — current OpenCode runtime architecture and implementation status.

The implementation is authoritative for current runtime behavior; CAP defines
its required authority invariants. This README owns navigation and status.

[Test performance audit](test-performance-audit.md) records the earlier 45-test
baseline, fixture and Git process measurements, and proposed regression budget.
Its measurements predate the published-plan authorization bridge.

## Current implementation status

Runtime simplification is complete: milestone-named runtime architecture has
been retired. The runtime modules are `attempt.ts`, `cap.ts`, `git.ts`, and
`proposal.ts` under `src/`.

The live TUI publishes a trusted Plan, then offers root-only local pointer
Authorize / Cancel controls when a clean initial observation demonstrably
preceded the adopted root's creation. Authorization verifies the exact pending
publication and native binding, switches the same retained Implementer slot,
consumes one-use authority, and dispatches one frozen prompt. The unchanged-HEAD
and exact Git path scope gate stops before Reviewer / Commit.

A stable initially dirty worktree still receives a readable Plan and explicit
planning-only status. That attempt can never become authorizable by cleaning
later. Cancel and STOP preserve the Plan while permanently discarding authority.
The independent modal implementation path has been removed.

Automated validation covers the bridge with trusted host/observer doubles and
the small real-Git boundary. Focused live OpenCode 2.0.20 dogfood of the new
pointer/layout integration remains required; it has not been run. Reviewer,
reviewed-target construction, and Commit remain later work.

## Historical evidence

Investigation, milestone, probe and audit documents are retained under
[`history/`](history/README.md) as non-normative historical evidence. Superseded
material was pruned according to the archived
[cleanup plan](history/documentation-cleanup-plan.md).
