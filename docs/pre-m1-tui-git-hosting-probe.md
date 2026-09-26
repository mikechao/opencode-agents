# Disposable Pre-M1 TUI/Git Hosting Probe

This is a temporary dogfood probe for the hosting assumption in
`cap-kernel-hosting-investigation.md`. It is not CAP code and adds no workflow,
authorization, or commit behavior. The plugin only runs read-only Git commands.

## Run the probe

From this checkout, start the ordinary local OpenCode TUI without `--server`:

```sh
cd /Users/mike/projects/opencode-agents
opencode
```

No package install or build is required. OpenCode discovers this project-local
plugin from `.opencode/plugins` and imports its `tui.js` entrypoint directly.

In the TUI, run `/pre-m1-git-probe`. The command takes no arguments. It reads
the location from the TUI plugin context, checks the path in the TUI process,
then runs Git directly against it. The diagnostic appears in an OpenCode alert
and is appended as JSON Lines to `${TMPDIR:-/tmp}/opencode-pre-m1-git-hosting-probe.jsonl`.

The direct observations are:

```sh
git -C <location> rev-parse --show-toplevel
git -C <location> rev-parse HEAD
git -C <location> branch --show-current
git -C <location> status --porcelain=v1 --untracked-files=all --no-renames -z -- .
```

The status flags match OpenCode's current Git VCS implementation and retain
unambiguous paths. The plugin also asks the OpenCode client for the resolved
worktree root, current branch, and status. It reports whether the TUI's real
path for the Git top-level equals OpenCode's reported worktree root, and
whether branch and status observations agree. If that root check fails, it
skips `HEAD`, branch, and status observations.

## Expected local evidence

For the default local TUI launch, expect:

- `OpenCode location` contains the host-provided directory, with no path in the
  slash command or model input;
- `Locally addressable: true`;
- the Git top-level equals the OpenCode-reported worktree root after local
  real-path resolution;
- `Git HEAD` is the current commit for this checkout;
- `Git status --porcelain` directly lists the current worktree changes (or
  says `(clean)`);
- the OpenCode VCS branch and status entries match the direct Git
  observations.

The host does not expose the CLI's local-versus-remote connection flag in the
TUI plugin `Context`. The plugin can establish that the reported path resolves
and that local Git and OpenCode's reported worktree root agree by path, but it
cannot prove from plugin context alone that a separately hosted server is on
the same machine. The expected local run uses the ordinary `opencode` command
above; do not use `--server` for this experiment. A remote/multi-host session
cannot be reliably classified by this plugin API and remains a host limitation.

## Observed dogfood result

On 2026-09-26, the manual probe ran in OpenCode `2.0.18` and reported
`Locally addressable: true`. The host location, TUI cwd, Git top-level, and
OpenCode-reported worktree root all resolved to
`/Users/mike/projects/opencode-agents`; branch `main` and the two untracked
probe files matched OpenCode's VCS branch/status results. Git returned the
current `HEAD` beginning `ffe5adf`. This is a **PASS for the ordinary local
launch**. The screenshot also confirmed that the plugin cannot classify a
remote connection; this run does not establish remote/multi-host support.
