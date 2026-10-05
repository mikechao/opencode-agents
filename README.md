## Known Limits / Deferred work

### Trusted transcript publication

OpenCode currently does not expose a supported plugin API for appending trusted, display-only assistant/status content directly to an existing root transcript without also treating that content as model-facing session input.

`opencode-agents` therefore uses synthetic publication with `resume: false` for Plans and lifecycle receipts. This provides the required visible root-session UX, but it is not equivalent to a native display-only transcript projection.

Revisit this if OpenCode adds a supported API for trusted transcript output that:

- targets an existing session;
- renders as assistant/status content;
- does not resume or wake the model;
- does not become synthetic user/model input solely for presentation.

### Dirty-worktree Planner admission

A root created from a dirty worktree may still run Planner and publish a
planning-only Plan, but trusted authorization remains unavailable.

Pre-Planner rejection was investigated in #25 and deferred because the current
OpenCode plugin lifecycle does not expose a sufficiently small deterministic
admission seam.

See `docs/investigations/issue-25-planner-admission.md`.