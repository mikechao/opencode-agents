# Milestone 1 Live Dogfood Report

**MILESTONE 1 LIVE DOGFOOD PASS**

Runtime: OpenCode 2.0.18; repository: `mikechao/opencode-agents`.

M1 runs one bounded flow:

```text
Planner → frozen proposal → trusted human authorization
        → freshness recheck → one fresh Implementer
        → trusted ordinary Git changed-path check
        → STOP before Review or Commit
```

This report separates behavior observed in the live TUI and independent Git
checks from the invariants enforced by trusted M1 code. It records evidence for
the implemented M1 boundary; it does not expand that boundary.

## Initial role-session failure and model binding

The first live request was:

```text
/m1 In README.md only, add a single Markdown heading: # opencode-agents
```

The initial worktree was clean at `3a700dcba0147ffcfdad55a25532ece85b228dcb`.
The Planner attempt stopped before authorization with:

```text
Role session did not complete successfully with the expected agent
```

`HEAD` remained unchanged and the worktree remained clean. The error proved
that the Planner did not reach a successful outcome; it did not establish the
underlying cause of that outcome.

A bounded investigation found a separate, concrete integration defect: M1
created fresh Planner and Implementer root sessions with `agent: "general"`
but omitted the selected TUI model. OpenCode 2.0.18 does not attach the active
TUI model selection to a newly created root session; an omitted model goes
through OpenCode's model resolver. This finding does not establish that model
resolution caused the first Planner's unsuccessful outcome.

The narrow fix snapshots `context.ui.model.current()` once per attempt, stops
before Planner creation if there is no selection, and passes the same explicit
model reference to both fresh role sessions. It does not add model data to the
CAP proposal or candidate. The fix was committed as
`3065d9beb13557dfbae752c250c232bff04fb7ec`.

Focused verification after the fix passed: `bun run typecheck`,
`bun test test/m1.test.ts` (13/13), and `git diff --check`. Focused review
found no blocking or important issues.

## Live cases

### Happy path — PASS

From a clean worktree at
`3065d9beb13557dfbae752c250c232bff04fb7ec`, the same request was run again.
The TUI displayed the frozen proposal with intent limited to the requested
README heading, a plan limited to `README.md`, and the exact authorized file
set containing only `README.md`. It showed canonical worktree
`/Users/mike/projects/opencode-agents`, the bound `HEAD`, and implementation-
only authorization with no commit. The human explicitly selected **Authorize**.

Trusted M1 returned `M1 PASS`: `HEAD` was unchanged, the resulting path set was
exactly `README.md`, and M1 stopped before Review or Commit. Independent Git
verification found only ` M README.md` in
`git status --porcelain=v1 --untracked-files=all`; `git diff -- README.md`
showed the single added heading:

```markdown
# opencode-agents
```

No other repository path changed. This passing result means trusted M1's
ordinary root, `HEAD`, freshness, and changed-path scope gates passed. It does
not claim detection of deliberately concealed filesystem or Git changes.

### Authorization cancellation — PASS

After restoring a clean worktree, the same request displayed its proposal and
the human selected **Cancel**. Trusted M1 returned:

```text
M1 STOP
M1 authorization was cancelled or dismissed
```

Independent verification found `HEAD` unchanged at
`3065d9beb13557dfbae752c250c232bff04fb7ec` and the worktree clean. This
confirms fail-closed behavior at the human authorization boundary.

### Out-of-scope Git delta rejection — PASS

After restoring a clean baseline, `README.md` was empty and the worktree was
clean. `M1_OUT_OF_SCOPE_DOGFOOD.txt` was confirmed not ignored. The displayed
proposal authorized only `README.md`. While the authorized Implementer changed
that file, a second terminal created `M1_OUT_OF_SCOPE_DOGFOOD.txt`.

After authorization and implementation, trusted M1 returned:

```text
M1 STOP
Out-of-scope Git delta: M1_OUT_OF_SCOPE_DOGFOOD.txt
```

Independent Git verification found `HEAD` unchanged at
`3065d9beb13557dfbae752c250c232bff04fb7ec`, `README.md` modified, and
`M1_OUT_OF_SCOPE_DOGFOOD.txt` present as an ordinary untracked path. This
directly demonstrates rejection by the trusted post-Implementer ordinary Git
changed-path scope check.

## Result and limits

- **M1 happy path: PASS.**
- **M1 authorization cancellation: PASS.**
- **M1 out-of-scope Git delta rejection: PASS.**

Together these live cases establish **MILESTONE 1 LIVE DOGFOOD PASS** for the
documented M1 boundary. They do not establish adversarial filesystem/Git
containment, exact reviewed-target construction, Review, or Commit. Changed
`HEAD` was not live-dogfooded; it remains covered by focused automated tests.
