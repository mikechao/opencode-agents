# Agent Guidance

## Repository roles

This repository, `opencode-agents`, is the active implementation repository.

Two sibling repositories may be used as read-only references:

- `../opencode` — OpenCode upstream source checkout. Treat this as the authoritative local reference for OpenCode host behavior and APIs. It is checked out at the version selected for this project. Do not modify, build, or run it unless the task explicitly requires that.
- `../codex-agents` — predecessor project. Use it as a read-only research, failure, and implementation-technique reference. Do not treat its architecture as the design template for `opencode-agents`.

## Boundaries

- Modify only `opencode-agents` unless explicitly instructed otherwise.
- Never modify `../opencode` or `../codex-agents` as part of work in this repository.
- Prefer `../opencode` over web searches when determining OpenCode implementation behavior.
- Reuse useful techniques from `../codex-agents` selectively; do not inherit its workflow, recovery, installer, or compatibility machinery without an explicit requirement.
- Do not run OpenCode during preparation or static-analysis tasks unless the task explicitly authorizes it.

## Test architecture

- Keep tests at the cheapest layer that proves the behavior under test.
- Use real Git repositories only when the test depends on actual Git semantics. Tests for orchestration, transcript binding, CAP state, permissions, cancellation, revocation, or other host behavior should use test-scoped trusted doubles instead of spawning Git processes.
- Preserve a small explicit set of real-Git integration tests for production Git boundaries. Do not duplicate that integration cost across unrelated cases.
- Do not weaken, cache, merge, or remove production freshness/observation checks merely to make tests faster. Optimize the test substrate, not the trusted runtime boundary.
- Do not add production dependency-injection seams, environment switches, or test hooks solely to support mocks. Test substitution must remain test-scoped.
- When real repositories are needed, keep fixtures isolated and prefer the established immutable-seed/private-copy pattern rather than repeatedly initializing repositories.
- Avoid introducing generalized test harness machinery unless it is required by multiple concrete behaviors. Prefer small, local test helpers.
- Treat unexpected growth in test wall time, temporary repositories, subprocess launches, or Git observations as an architectural regression to investigate rather than simply increasing the performance budget.