# Milestone 1 implementation planning investigation

## 1. Executive conclusion

The smallest M1 shape is a project-local Bun/TypeScript TUI plugin. Its current activation owns a single attempt: it starts fresh Planner and Implementer sessions, freezes and presents the Planner proposal, consumes a one-use authorization at Implementer admission, then derives the Git delta and stops.

**One contract requirement is blocked by current OpenCode behavior.** OpenCode can deny a parsed shell command such as `git commit`, but it cannot reserve the *commit effect* while leaving an agent ordinary development shell access. An allowed interpreter or script can invoke Git internally. The post-implementation `HEAD` check detects such a commit after it happens; it does not prevent it. Section 9 gives the source evidence. Per the requested contradiction rule, this report does not propose a substitute architecture or claim that the file plan is ready for an M1 PASS.

## 2. Verified current repository/environment facts

- `opencode-agents` was clean on `main` at `9f889558dcf4aa9d8e367d0cc1d30e27b1244f37` during this investigation. No files were changed during the investigation.
- There was no production `package.json`, lockfile, TypeScript configuration, source tree, or `.gitignore`. The existing `.opencode/plugins` entries were disposable probes.
- The sibling OpenCode checkout was `00738c5b2d2c3f0bce804b9e15107e3a02dd205d`; its [`@opencode/plugin` package declares version `2.0.17`](../../opencode/packages/plugin/package.json). The locally installed CLI package declared `2.0.18`. Bun `1.3.13` was installed. The checkout used TypeScript `5.8.2` internally; that alone is not evidence against M1's requested `^7.0.2`.
- The prior local hosting and late-confirmation revocation probes recorded PASS for the ordinary local TUI configuration ([Git hosting result](pre-m1-tui-git-hosting-probe.md), [revocation result](pre-m1-plugin-generation-revocation-probe.md)). Those results support the settled runtime choice; they are not production CAP tests.

## 3. Verified OpenCode API/lifecycle facts

- A TUI plugin exports a default definition with `id` and `setup(context)`; setup may return cleanup ([definition](../../opencode/packages/plugin/src/tui/plugin.ts), [loader validation](../../opencode/packages/tui/src/plugin/context.tsx)). Local project plugin directories are discovered under `.opencode/plugins` ([discovery](../../opencode/packages/tui/src/plugin/discovery.ts)). Bun's local loader scans `.ts` imports, so a directly loaded TypeScript entrypoint is the smallest source-supported packaging candidate ([loader](../../opencode/packages/plugin/src/source.bun.ts)); loading that exact new entrypoint still needs dogfood evidence.
- Reload deactivates the old plugin before activating its replacement. Returned cleanup is run during deactivation, and registered cleanups unwind in reverse order ([activation/deactivation](../../opencode/packages/tui/src/plugin/context.tsx)). The plugin must set its own `revoked` flag synchronously in that cleanup.
- `context.ui.dialog.confirm` returns `true`, `false`, or `undefined` ([API](../../opencode/packages/plugin/src/tui/context.ts), [implementation](../../opencode/packages/tui/src/plugin/api.tsx)). Candidate and returned decision can remain in the same activation closure. `storage.memory()` survives hot reload, so it is unsuitable for CAP authority ([storage contract](../../opencode/packages/plugin/src/tui/context.ts)).
- The TUI context supplies the host client and current location ([context](../../opencode/packages/plugin/src/tui/context.ts)). A slash command can receive raw request text through `KeymapCommand.run` ([command API](../../opencode/packages/plugin/src/tui/context.ts)); the historical revocation probe demonstrates registration through an app slot ([probe entrypoint in Git history](https://github.com/mikechao/opencode-agents/blob/bb739a993be156150482fd471c457386afff8fdc/.opencode/plugins/pre-m1-plugin-generation-revocation-probe/tui.js)).
- Public `session.create` accepts an agent, location, and session permissions, and returns a session with an ID; it does **not** accept `parentID` ([route](../../opencode/packages/protocol/src/groups/session.ts)). OpenCode's internal subagent tool uses parent-linked creation, but that operation is not exposed by this public TUI client route ([internal use](../../opencode/packages/core/src/tool/plugin/subagent.ts)). A fresh session selected to a subagent-mode agent supplies the separate role context contemplated by the settled hosting investigation; it is not a parent-linked child session.
- `session.prompt` returns an inbox item with its own ID; `session.wait` waits until the loop is idle; `session.get` exposes terminal outcome ([prompt and wait](../../opencode/packages/protocol/src/groups/session.ts), [session info](../../opencode/packages/schema/src/session.ts)). `message.list` returns the session timeline, including assistant content ([route](../../opencode/packages/protocol/src/groups/message.ts), [assistant schema](../../opencode/packages/schema/src/session-message.ts)). The assistant message has no direct prompt-ID field; binding therefore depends on a fresh session containing exactly this one admitted user prompt.

## 4. Proposed minimal M1 implementation shape

Use one TUI slash command, for example `/m1 <request>`, as the user entrypoint. The plugin's trusted code is the minimal Orchestrator and CAP owner. It starts one fresh Planner session, strictly parses one proposal, observes Git, presents the entire candidate through `ui.dialog.confirm`, admits one fresh Implementer session after confirmation and freshness checks, derives the complete delta, reports PASS or STOP, and returns.

OpenCode's built-in `general` agent is already subagent-mode and has ordinary tools ([agent setup](../../opencode/packages/core/src/plugin/agent.ts)). Separate fresh sessions and explicit bounded prompts are sufficient for the two M1 roles; custom role agents or a server plugin are not needed for the first shape. The Planner session can receive read-oriented permissions. Session IDs and prompt IDs, never `general` or a model's role claim, identify invocations.

The foundation would be a private root package, Bun lockfile, TypeScript `^7.0.2`, source-matched `@opencode/plugin@2.0.17`, `@types/bun` if needed for tests/types, and `typecheck`/`test` scripts. Version `2.0.17` is the source-derived pin; compatibility with the installed CLI `2.0.18` must be verified during runtime dogfood. Add optional TUI peer packages only if the actual typecheck or loader proves they are required.

## 5. Exact proposed target files and responsibility of each

These are **conditional implementation targets**, not changes made by this investigation and not an implementation-ready M1 PASS plan.

| Target file | Responsibility |
| --- | --- |
| `package.json` | Private Bun package, exact plugin dependency, TypeScript dependency, minimal scripts. |
| `bun.lock` | Reproducible installed dependency versions. |
| `tsconfig.json` | Strict, no-emit checking of the directly loaded TypeScript source and tests. |
| `.gitignore` | Ignore `node_modules` and generated local artifacts so package installation does not invalidate M1's clean-worktree precondition. |
| `.opencode/plugins/opencode-agents/tui.ts` | Discoverable TUI entrypoint; registers the slash command, creates activation-private state, synchronously revokes it in cleanup. |
| `src/m1/attempt.ts` | One-attempt sequencing, OpenCode session calls and identity checks, candidate/result binding, confirmation, one-use admission, generation guards, final report. |
| `src/m1/proposal.ts` | Strict three-field JSON validation, exact-path validation, frozen proposal/candidate, deterministic encoding and digest, complete confirmation rendering. |
| `src/m1/git.ts` | Small direct Git command runner and the three trusted observation points; NUL-delimited status parsing and exact-scope check. |
| `test/m1.test.ts` | Focused pure-state/proposal cases and temporary-repository Git delta cases using Bun's test runner. |

No documentation update, bundler, workspace, server entrypoint, or role-agent configuration is needed for this shape.

## 6. Planner/Implementer invocation and handoff design

1. The command accepts one nonempty raw user request and allows one active attempt per plugin generation.
2. Create a new session at the trusted host location with `agent: "general"`; record the returned **Planner session ID**. Prompt it once with the user request and an instruction to return exactly one JSON object: `{"intent": "...", "plan": "...", "files": ["..."]}`. Record the returned **inbox/prompt ID**.
3. Await idle, fetch the session and its paginated messages, and require successful outcome, the expected session/agent, exactly the one user prompt with that ID, and an unambiguous completed final assistant text. If other user input, failure, missing output, or ambiguous output appears, STOP. Parse only that final text. A fresh session plus the one verified input binds the result to this invocation despite the absence of an assistant prompt-ID field.
4. After authorization, make a **different** fresh `general` session; record its returned ID. Send a single prompt containing a serialization of the intact frozen intent, plan, and files, plus the trusted canonical root, bound HEAD, and clean-start fact. Send no Planner transcript, reasoning, or Orchestrator conversation. Record the Implementer prompt ID and use the same session/input/completion checks when collecting its result.
5. Empty session creation is an awaited host call. To satisfy both "immediately after confirmation" and "immediately before admission," check freshness as soon as confirmation returns, create the empty Implementer session, then check freshness again immediately before consuming the capability and calling `session.prompt`. Prompt admission is the one-use boundary. Any failure consumes or abandons the attempt; no second prompt is sent.

The public session route's lack of `parentID` is an **OpenCode API fact**, not a reason to add a server orchestration layer. Source supports fresh role-selected contexts and concrete session/prompt references.

## 7. Minimal CAP state and lifecycle

The activation closure needs `revoked`, `busy`, and the current attempt closure. The attempt holds the Planner session/prompt IDs, a deeply frozen proposal, canonical root and HEAD, a fixed-key candidate encoding and SHA-256 digest, and the pending confirmation promise. This meets the candidate canonicalization/digest obligation in the [CAP document](coding-authority-protocol.md) without an artifact framework.

Only `result === true` from that exact dialog call is eligible. Recompute/check candidate integrity and freshness, then create an activation-private marker bound to that candidate and purpose. Flip its one-use `consumed` bit synchronously immediately before the single Implementer prompt call. The marker and affirmative result never enter OpenCode session or storage data. The proposal remains frozen after consumption.

Cleanup sets `revoked = true` before any other cleanup. Check it on resumption from every awaited OpenCode operation—session create, prompt, wait, get/message collection, location lookup, and especially confirmation—and before candidate grant, capability consumption, Implementer prompt, and final trusted gate/report. A late response may exist, but its old continuation cannot grant or use authority. The [late-affirmative probe](pre-m1-plugin-generation-revocation-probe.md) already demonstrated this lifecycle pattern; its live plugin source was retired after the probe completed.

## 8. Trusted Git observation/delta design

Use direct `git` subprocess calls from the local TUI plugin with argument arrays, a fixed canonical working directory, bounded output, no command shell, and failure on nonzero exit or incomplete output. Do not accept Git facts from agent text. Compare the real path of `git rev-parse --show-toplevel` with OpenCode's reported project worktree root; the earlier local probe validated that correspondence in the supported launch.

- **Candidate construction:** canonicalize the host location and Git top-level; read `git rev-parse --verify HEAD^{commit}`; require empty `git status --porcelain=v1 -z --untracked-files=all --no-renames --ignore-submodules=none` over the *whole* worktree.
- **After confirmation and before prompt admission:** repeat root, HEAD, and whole-worktree status. If creating the empty session intervenes, perform the second check immediately before prompt admission.
- **After Implementer completion:** require the same canonical root and HEAD; run the same NUL-delimited status command. Parse every pathname and require exact membership in the frozen file set. `--no-renames` makes a rename's old and new paths appear as deletion and addition, so both are checked. Porcelain status covers staged and unstaged tracked changes, deletions, and untracked additions; ignored paths are outside the settled model. Count concurrent changes exactly as observed.

Path validation rejects non-strings, duplicates, empty/absolute paths, `.` or `..` components, separators or wildcard syntax that represent patterns, and existing directories. It never normalizes a proposed path into a different authorized path. Invalid UTF-8 or malformed status output fails closed. HEAD should be read on both sides of a status observation so a concurrent HEAD change during that observation also fails. This is a small observation routine, not a Git abstraction or attribution mechanism.

## 9. Commit-effect restriction

**OpenCode API fact:** session permission rules support `allow`, `ask`, and `deny` by action/resource ([schema](../../opencode/packages/schema/src/permission.ts)). Session rules follow agent rules, and the last matching rule wins ([merge/evaluation](../../opencode/packages/core/src/permission.ts)). The shell tool scans the submitted command into textual resources and checks those resources *before spawning the shell* ([shell check](../../opencode/packages/core/src/tool/plugin/shell.ts), [scanner](../../opencode/packages/core/src/shell/parse.ts)).

Thus a session rule such as `{action:"shell", resource:"git commit *", effect:"deny"}` can block that parsed direct command. It **cannot** establish that Planner or Implementer cannot invoke the reserved Git commit effect. The scan sees an allowed command such as an interpreter or build script as that outer command; it does not mediate subprocesses the command later launches. Even Git options that precede `commit` change the textual resource. Widening string patterns still cannot close the interpreter/script path while ordinary shell remains available.

**Genuine contradiction:** the [M1 contract](milestone-1-intent-implementation.md) requires the Implementer to retain development shell access *and* trusted role/tool enforcement to make the commit effect unavailable. The current permission mechanism shown above cannot express both. M1's changed-HEAD gate will STOP after a commit, but the unauthorized effect has already occurred. No commit tool should be exposed by this plugin, but keeping its own future commit method private does not block direct Git execution from the agent's shell. This is the unresolved boundary that prevents an honest M1 PASS plan under the settled constraints.

## 10. Test/probe plan

- **Unit-testable:** strict proposal parsing; invalid and duplicate paths; frozen candidate encoding/digest; true/false/undefined confirmation handling through an injected dialog; single consumption; revocation after a delayed affirmative result. These tests should exercise real state transitions, not mirror formatting helpers.
- **Integration-testable:** in temporary Git repositories, clean precondition; staged and unstaged changes; untracked additions; deletion; staged and unstaged renames; both rename paths; out-of-scope path; changed HEAD; NUL-safe unusual pathnames. No OpenCode runtime is needed for these.
- **OpenCode dogfood evidence:** loading the TypeScript entrypoint with the installed CLI; complete untruncated candidate display; fresh session/prompt identity and output collection; distinct Implementer context and intact handoff; late reload revocation; stale HEAD/dirty worktree STOP; in-scope and out-of-scope final gates. Run against a clean committed checkout or separate clean fixture, because an uncommitted production implementation itself fails the clean-start rule. A focused shell test may demonstrate the commit bypass, but the source already identifies the mechanism.

No disposable probe logging framework needs migration into production.

## 11. Remaining uncertainties, classified

| Classification | Item |
| --- | --- |
| **SETTLED ARCHITECTURE** | TUI generation owns CAP; proposal has exactly intent, plan, files; clean baseline and one-use admission; complete exact-scope delta; no Reviewer or Commit in M1. |
| **IMPLEMENTATION CHOICE** | Direct slash command, built-in `general` in two fresh sessions, strict JSON representation, fixed-key SHA-256 encoding, NUL-delimited `git status`, source-matched plugin pin, and the conditional target files above. |
| **OPENCODE API FACT — VERIFIED FROM SOURCE** | TUI setup/cleanup and dialog result; fresh session and prompt IDs; no public `parentID`; session outcome/message APIs; textual shell permission scanning and its effect-boundary gap. |
| **RUNTIME BEHAVIOR — FOCUSED PROBE NEEDED** | Actual `.ts` entrypoint loading/type compatibility on CLI `2.0.18`; readable presentation of a full realistic proposal; exact one-prompt transcript collection; end-to-end M1 dogfood after the effect-boundary contradiction is resolved. |

The installed CLI/source package patch-version difference is a compatibility test item, not an architecture question.

## 12. Overengineering risks / things explicitly not to build

Do not add a server CAP plugin, MCP service, RPC approval transport, stored grants, persisted workflow phases, role history, retries, repair/recovery, Reviewer, commit execution, UI framework, bundler, workspace, generic orchestration or capability framework, or a shell-command regex catalogue. None repairs the demonstrated commit-effect gap while preserving the settled shell boundary.

## 13. Recommended implementation sequence

1. Resolve the section 9 contradiction against the settled contract or obtain new OpenCode host evidence of an effect-specific enforcement mechanism. Do not label a textual `git commit` deny rule as complete enforcement.
2. Establish the minimal Bun/TypeScript files and typecheck the source-matched plugin API against the installed CLI.
3. Implement proposal validation and direct Git observations, with focused Bun tests.
4. Implement the TUI generation, one-attempt state, Planner identity binding, candidate presentation, freshness checks, one-use Implementer admission, and final scope gate.
5. Dogfood the complete sequence in a clean local checkout and record the M1 PASS/STOP evidence.

The investigation made no repository changes and did not run the OpenCode TUI.
