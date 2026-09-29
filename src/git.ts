import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"

export interface GitSnapshot {
  readonly root: string
  readonly head: string
  readonly paths: readonly string[]
}

const decoder = new TextDecoder("utf-8", { fatal: true })

function git(root: string, args: readonly string[]): Buffer {
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    timeout: 10_000,
    maxBuffer: 16 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  })
}

function line(root: string, args: readonly string[]): string {
  return decoder.decode(git(root, args)).trimEnd()
}

function paths(bytes: Buffer): string[] {
  if (!bytes.length) return []
  if (bytes.at(-1) !== 0) throw new Error("Incomplete NUL-delimited Git output")
  return decoder.decode(bytes.subarray(0, -1)).split("\0").map((name) => {
    if (!name || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")) {
      throw new Error("Invalid repository path in Git observation")
    }
    return name
  })
}

export function observeGit(location: string, baseline?: GitSnapshot): GitSnapshot {
  const root = realpathSync(location)
  if (realpathSync(line(root, ["rev-parse", "--show-toplevel"])) !== root) {
    throw new Error("OpenCode worktree and Git root differ")
  }
  const head = line(root, ["rev-parse", "--verify", "HEAD^{commit}"])
  if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(head)) throw new Error("Invalid Git HEAD")
  if (baseline && (root !== baseline.root || head !== baseline.head)) {
    throw new Error("Worktree root or HEAD changed before Git observation")
  }

  const staged = paths(git(root, ["diff-index", "--cached", "--no-renames", "--name-only", "-z", head, "--"]))
  const unstaged = paths(git(root, ["diff-files", "--no-renames", "--name-only", "-z", "--"]))
  const untracked = paths(git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]))

  if (realpathSync(location) !== root || realpathSync(line(root, ["rev-parse", "--show-toplevel"])) !== root) {
    throw new Error("OpenCode worktree or Git root changed during observation")
  }
  if (line(root, ["rev-parse", "--verify", "HEAD^{commit}"]) !== head) {
    throw new Error("Git HEAD changed during observation")
  }
  return Object.freeze({ root, head, paths: Object.freeze([...new Set([...staged, ...unstaged, ...untracked])].sort()) })
}

export function requireFresh(snapshot: GitSnapshot, baseline: GitSnapshot): void {
  if (snapshot.root !== baseline.root || snapshot.head !== baseline.head || snapshot.paths.length !== 0) {
    throw new Error("Worktree root, HEAD, or cleanliness changed before admission")
  }
}

export function requireInScope(snapshot: GitSnapshot, baseline: GitSnapshot, files: readonly string[]): readonly string[] {
  if (snapshot.root !== baseline.root || snapshot.head !== baseline.head) {
    throw new Error("Worktree root or HEAD changed during implementation")
  }
  const allowed = new Set(files)
  const outside = snapshot.paths.filter((file) => !allowed.has(file))
  if (outside.length) throw new Error(`Out-of-scope Git delta: ${outside.join(", ")}`)
  return snapshot.paths
}
