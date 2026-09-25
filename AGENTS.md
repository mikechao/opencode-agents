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