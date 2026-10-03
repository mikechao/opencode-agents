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

Issue #9 implements minimal native CAP admission on pinned OpenCode 2.0.21.
Trusted TUI Planner binding, Plan publication, clean initial eligibility and
readable-frame pointer authorization are preserved. Authorize transfers a
frozen claim to one local RPC; a private server slot reserves/consumes one exact
native invocation and verifies its result plus fresh Git scope before STOP.
The root's static denial and all session permissions stay intact. OpenCode owns
Implementer child creation, execution, lifecycle, row and navigation;
`opencode-agents` owns one-use CAP admission and the independent Git/result gate.
Issue #8's custom-row work is superseded.

The trusted TUI is the intended producer of Authorize claims. Same-user local
processes and localhost OpenCode RPC access belong to the trusted host boundary;
RPC caller origin is not independently authenticated. CAP is not an OS/process
sandbox.

Issue #9's one-shot CAP semantics remain intact. Issue #16 gives each eligible
root its own governed attempt within the plugin activation, with shared-worktree
implementation exclusion. Repeated authorization of the same root is rejected.
Cancel sends no claim/wake. Failure, lost response, settlement and teardown
never reopen authority. Restart cannot reconstruct a claim from transcripts;
ordinary native recovery of the same admitted child remains supported.

Automated checks use trusted host/transport/Git-observer/JSX doubles; real Git
remains limited to Git semantics. Final OpenCode 2.0.21 live dogfood verified
the native Planner and Implementer path, navigation and readable-frame behavior,
the exact `README.md` Git gate, and post-Planner Cancel. See
[live validation](v1-orchestration.md#live-validation-on-opencode-2021).
Reviewer, reviewed-target construction and Commit are later work.

The runtime modules are `attempt.ts`, `cap.ts`, `authorize-rpc.ts`, `native.ts`,
`git.ts` and `proposal.ts`, with directory TUI and Effect server entries.
Historical investigations describe proposals and older paths; the approved
minimal scope supersedes Issue #9's proposed enrollment and provider policing.

## Historical evidence

Issue investigations, dogfood reports, milestone and probe documents are
retained under [`history/`](history/README.md) as non-normative historical
evidence. Superseded material was pruned according to the archived
[cleanup plan](history/documentation-cleanup-plan.md).
