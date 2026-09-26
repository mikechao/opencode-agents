import { execFileSync } from "node:child_process";
import { appendFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

const LOG_PATH = path.join(tmpdir(), "opencode-pre-m1-git-hosting-probe.jsonl");
const COMMAND_ID = "opencode-agents.pre-m1-git-hosting-probe";

function runGit(directory, args) {
  try {
    return {
      ok: true,
      output: execFileSync("git", ["-C", directory, ...args], {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      }),
    };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
      stderr: typeof cause?.stderr === "string" ? cause.stderr : undefined,
    };
  }
}

function statusKind(code) {
  if (code === "??" || (code.includes("A") && !code.includes("D"))) return "added";
  if (code.includes("D") && !code.includes("A")) return "deleted";
  return "modified";
}

function localStatusEntries(output) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((item) => ({
      file: item.slice(3),
      status: statusKind(item.slice(0, 2)),
    }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.status.localeCompare(b.status));
}

function hostStatusEntries(output) {
  return output
    .map(({ file, status }) => ({ file, status }))
    .sort((a, b) => a.file.localeCompare(b.file) || a.status.localeCompare(b.status));
}

function pathContains(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function displayCommandResult(value) {
  if (!value) return "unavailable";
  if (!value.ok) return `ERROR: ${value.error}${value.stderr ? `\n${value.stderr.trim()}` : ""}`;
  return value.output.trimEnd() || "(empty)";
}

async function collect(context) {
  const activeLocation = context.location?.directory;
  const target = activeLocation ?? context.data.location.default().directory;
  const locationSource = activeLocation ? "context.location.directory" : "context.data.location.default().directory";
  const report = {
    timestamp: new Date().toISOString(),
    openCodeLocation: { source: locationSource, directory: target ?? null },
    tuiProcess: { cwd: process.cwd() },
    locality: {
      connectionSignal:
        "unavailable: the CLI has an internal updater.remote value, but TUI plugin Context does not expose it",
      locallyAddressable: false,
      reason: "not checked",
    },
    openCode: {},
    git: {},
    correspondence: {},
  };

  if (typeof target !== "string" || !path.isAbsolute(target)) {
    report.locality.reason = "OpenCode did not provide an absolute location path";
    return report;
  }

  let targetRealPath;
  try {
    targetRealPath = realpathSync(target);
    if (!statSync(targetRealPath).isDirectory()) throw new Error("OpenCode location is not a directory");
    report.locality.resolvedPath = targetRealPath;
  } catch (cause) {
    report.locality.reason = `TUI process cannot resolve OpenCode location: ${cause instanceof Error ? cause.message : String(cause)}`;
    return report;
  }

  let hostLocation;
  const locationRef = { directory: target };
  try {
    hostLocation = await context.client.location.get({ location: locationRef });
    report.openCode.projectDirectory = hostLocation.project?.directory;
    report.openCode.canonicalProjectDirectory = hostLocation.project?.canonical;
    report.openCode.locationResponseDirectory = hostLocation.directory;
  } catch (cause) {
    report.openCode.locationError = cause instanceof Error ? cause.message : String(cause);
    report.locality.reason = "OpenCode could not confirm the target worktree root; Git observation was skipped";
    return report;
  }

  const git = { topLevel: runGit(target, ["rev-parse", "--show-toplevel"]) };
  report.git.topLevel = displayCommandResult(git.topLevel);
  if (!git.topLevel.ok) {
    report.locality.reason = "Git could not establish a top-level directory; further Git observations were skipped";
    return report;
  }

  try {
    const localGitRoot = realpathSync(git.topLevel.output.trim());
    const hostRootPath = hostLocation.project?.directory;
    const hostGitRoot = typeof hostRootPath === "string" ? realpathSync(hostRootPath) : undefined;
    const targetInsideGitRoot = pathContains(localGitRoot, targetRealPath);
    const rootsMatch = Boolean(localGitRoot && hostGitRoot && localGitRoot === hostGitRoot);
    report.correspondence = {
      openCodeReportedWorktreeRoot: hostRootPath ?? "unavailable",
      localGitTopLevelRealPath: localGitRoot,
      targetIsInsideGitWorktree: targetInsideGitRoot,
      localGitRootMatchesOpenCodeWorktreeRoot: rootsMatch,
    };
    if (!targetInsideGitRoot || !rootsMatch) {
      report.locality.reason =
        "local Git top-level does not match OpenCode's locally resolved worktree root; HEAD, branch, and status observations were skipped";
      return report;
    }
  } catch (cause) {
    report.locality.reason = `OpenCode's reported worktree root is not locally addressable: ${cause instanceof Error ? cause.message : String(cause)}`;
    return report;
  }

  git.head = runGit(target, ["rev-parse", "HEAD"]);
  git.branch = runGit(target, ["branch", "--show-current"]);
  git.status = runGit(target, ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z", "--", "."]);
  report.git = {
    ...report.git,
    head: displayCommandResult(git.head),
    branch: displayCommandResult(git.branch),
    statusPorcelain: git.status.ok
      ? localStatusEntries(git.status.output).map(({ file, status }) => `${status}: ${file}`)
      : displayCommandResult(git.status),
    rawStatusPorcelainZ: git.status.ok ? git.status.output : undefined,
  };

  let hostVcs;
  let hostStatus;
  try {
    [hostVcs, hostStatus] = await Promise.all([
      context.client.vcs.get({ location: locationRef }),
      context.client.vcs.status({ location: locationRef }),
    ]);
    report.openCode.vcsBranch = hostVcs.data.branch.current ?? "(unavailable)";
    report.openCode.vcsStatus = hostStatus.data.map(({ file, status }) => `${status}: ${file}`);
  } catch (cause) {
    report.openCode.vcsError = cause instanceof Error ? cause.message : String(cause);
  }

  report.locality.locallyAddressable = git.head.ok && git.status.ok;
  report.locality.reason = report.locality.locallyAddressable
    ? "filesystem resolution, direct Git observations, and the OpenCode-reported worktree root agree"
    : "a required direct Git observation failed; the worktree is not treated as established";
  report.correspondence.branchMatches =
    hostVcs && git.branch.ok
      ? hostVcs.data.branch.current === (git.branch.output.trim() || undefined)
      : "unavailable";
  report.correspondence.statusEntriesMatch = hostStatus && git.status.ok
    ? JSON.stringify(hostStatusEntries(hostStatus.data)) === JSON.stringify(localStatusEntries(git.status.output))
    : "unavailable";

  return report;
}

function format(report) {
  const status = Array.isArray(report.git.statusPorcelain)
    ? report.git.statusPorcelain.join("\n") || "(clean)"
    : report.git.statusPorcelain;
  return [
    "Disposable pre-M1 TUI/Git hosting probe",
    `OpenCode location (${report.openCodeLocation.source}): ${report.openCodeLocation.directory ?? "unavailable"}`,
    `TUI process cwd: ${report.tuiProcess.cwd}`,
    `Locally addressable: ${report.locality.locallyAddressable}`,
    `Addressability detail: ${report.locality.reason}`,
    `Host local/remote signal: ${report.locality.connectionSignal}`,
    `OpenCode worktree root: ${report.openCode.projectDirectory ?? "unavailable"}`,
    `Git top-level: ${report.git.topLevel}`,
    `Git HEAD: ${report.git.head}`,
    `Git branch: ${report.git.branch}`,
    `Git status --porcelain:\n${status}`,
    `OpenCode VCS branch: ${report.openCode.vcsBranch ?? report.openCode.vcsError ?? "unavailable"}`,
    `OpenCode VCS status:\n${(report.openCode.vcsStatus ?? []).join("\n") || (report.openCode.vcsStatus ? "(clean)" : report.openCode.vcsError ?? "unavailable")}`,
    `Git root matches OpenCode worktree root: ${report.correspondence.localGitRootMatchesOpenCodeWorktreeRoot ?? "unavailable"}`,
    `Branch matches OpenCode VCS: ${report.correspondence.branchMatches ?? "unavailable"}`,
    `Status entries match OpenCode VCS: ${report.correspondence.statusEntriesMatch ?? "unavailable"}`,
    `Diagnostic log: ${LOG_PATH}`,
  ].join("\n");
}

async function runProbe(context) {
  const report = await collect(context);
  try {
    appendFileSync(LOG_PATH, `${JSON.stringify(report)}\n`, "utf8");
  } catch (cause) {
    report.logError = cause instanceof Error ? cause.message : String(cause);
  }
  await context.ui.dialog.alert({ title: "Pre-M1 Git hosting probe", message: format(report) });
}

export default {
  id: "opencode-agents.pre-m1-git-hosting-probe",
  setup(context) {
    let disposed = false;
    const removeSlot = context.ui.slot({
      append: "app",
      render: () => {
        if (disposed) return null;
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: COMMAND_ID,
              title: "Pre-M1: inspect local Git hosting",
              description: "Read OpenCode's location and compare it with direct read-only Git observations.",
              group: "Pre-M1 Hosting Probe",
              palette: true,
              slash: { name: "pre-m1-git-probe" },
              run: async () => runProbe(context),
            },
          ],
        }));
        return null;
      },
    });
    return () => {
      if (disposed) return;
      disposed = true;
      removeSlot();
    };
  },
};
