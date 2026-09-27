# M1 Git commit-effect boundary follow-up

## Verdict

**Section 9 of the [M1 implementation planning investigation](m1-implementation-planning-investigation.md) is confirmed for the checked-out OpenCode host and the settled ordinary local topology.** OpenCode can deny a submitted shell command that matches `git commit`, but its current role/tool permissions do not prevent an allowed shell command from producing the same Git commit effect through a child process. The M1 requirement to leave the Implementer ordinary development shell access while reserving that effect remains unresolved. This is a source-level finding, not a runtime bypass probe.

The applicable contract requires trusted role/tool enforcement to keep the commit effect unavailable to Planner and Implementer while the Implementer retains ordinary read, edit, test, and development shell abilities ([M1 contract](milestone-1-intent-implementation.md), [CAP bounded-effects rule](coding-authority-protocol.md)). It also requires unchanged `HEAD` at the final gate. A changed-`HEAD` STOP detects an unauthorized commit after it has happened; it cannot make the effect unavailable.

## Narrow source trace

1. Session permission rules are action/resource patterns with `allow`, `ask`, or `deny` effects ([schema](../../opencode/packages/schema/src/permission.ts)). OpenCode combines agent and session rules and uses the last matching rule; a configured denial is checked before saved approvals ([evaluation](../../opencode/packages/core/src/permission.ts)). A rule for the textual `git commit` resource can therefore deny a matching direct shell command.
2. The shell tool scans the **submitted command string**, passes the scanner's textual resources to the permission service, and does so before launching the shell ([shell tool](../../opencode/packages/core/src/tool/plugin/shell.ts)). Both the legacy and portable scanner produce resources from commands visible in that input string ([scanner](../../opencode/packages/core/src/shell/parse.ts)). They do not inspect future child processes.
3. After that check, the local execution path spawns the selected shell with the approved command and its environment ([shell process](../../opencode/packages/core/src/shell.ts), [local environment](../../opencode/packages/core/src/environment/environment.ts)). There is no per-child Git operation check on this path.

For example, the unexecuted command `python -c 'import subprocess; subprocess.run(["git", "commit", "-m", "example"], check=True)'` presents an outer `python` command to OpenCode's shell check. Python's later Git child invocation does not pass through that check. An allowed build or test script can do the same. This is enough to defeat a guarantee about the *effect*, regardless of how many direct `git commit` spellings a textual deny rule covers.

## Why the apparent substitutes do not close it

- Broader command patterns still inspect only the submitted shell text. Denying every interpreter, task runner, and executable capable of starting a child process would remove ordinary development shell access.
- Keeping CAP's future commit function private prevents agents from calling that function; it does not mediate Git launched from their shell.
- Git hooks are repository or Git configuration mechanisms available to the same local shell context. They are not an independent OpenCode role/effect boundary.
- The post-implementation `HEAD` check is essential for M1's result gate, but a commit that changes `HEAD` has already occurred when the check stops the attempt.

## Consequence and evidence limit

Do not claim an M1 PASS from a direct-command deny rule plus the final `HEAD` gate. A solution would need an independently enforced process or Git-write boundary that preserves the specified development abilities, or an explicit change to the M1 contract. This follow-up selects neither.

The finding is scoped to OpenCode checkout `00738c5b2d2c3f0bce804b9e15107e3a02dd205d` and its ordinary local process spawner. No OpenCode runtime, Git commit, or sibling-repository mutation was used for this investigation.
