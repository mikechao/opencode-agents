import { execFileSync } from "node:child_process"
import { realpathSync, lstatSync, openSync, fstatSync, readSync, closeSync, readlinkSync, constants } from "node:fs"
import { createHash } from "node:crypto"
import path from "node:path"

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
  return decoder
    .decode(bytes.subarray(0, -1))
    .split("\0")
    .map((name) => {
      if (
        !name ||
        name.startsWith("/") ||
        name.split("/").some((part) => !part || part === "." || part === ".." || part === ".git")
      ) {
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
  return Object.freeze({
    root,
    head,
    paths: Object.freeze([...new Set([...staged, ...unstaged, ...untracked])].sort()),
  })
}

export function requireFresh(snapshot: GitSnapshot, baseline: GitSnapshot): void {
  if (snapshot.root !== baseline.root || snapshot.head !== baseline.head || snapshot.paths.length !== 0) {
    throw new Error("Worktree root, HEAD, or cleanliness changed before admission")
  }
}

export function requireInScope(
  snapshot: GitSnapshot,
  baseline: GitSnapshot,
  files: readonly string[],
): readonly string[] {
  if (snapshot.root !== baseline.root || snapshot.head !== baseline.head) {
    throw new Error("Worktree root or HEAD changed during implementation")
  }
  const allowed = new Set(files)
  const outside = snapshot.paths.filter((file) => !allowed.has(file))
  if (outside.length) throw new Error(`Out-of-scope Git delta: ${outside.join(", ")}`)
  return snapshot.paths
}

export interface ReviewTarget extends GitSnapshot {
  readonly digest: string
}

export class ReviewTargetChanged extends Error {
  constructor() {
    super("Review target changed")
  }
}

// Index identities plus actual worktree bytes, independent of Git's stat cache,
// assume-unchanged flags, filters and diff drivers. Ignored untracked files remain
// outside the ordinary Git boundary. Gitlinks/unmerged entries fail closed.
function contentDigest(root: string, head: string): string {
  const index = git(root, ["ls-files", "--stage", "-z", "--"])
  if (index.length && index.at(-1) !== 0) throw new Error("Incomplete index observation")
  const tracked = new Set<string>()
  for (const record of index.length ? decoder.decode(index.subarray(0, -1)).split("\0") : []) {
    const match = /^(100644|100755|120000) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error("Unsupported or ambiguous index entry for review")
    const name = paths(Buffer.from(`${match[3]}\0`))[0]!
    if (tracked.has(name)) throw new Error("Duplicate review index path")
    tracked.add(name)
  }
  const untracked = paths(git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]))
  if (new Set(untracked).size !== untracked.length || untracked.some((name) => tracked.has(name)))
    throw new Error("Ambiguous review worktree paths")
  const digest = createHash("sha256")
  digest.update(JSON.stringify(["review-target-v1", root, head, index.toString("base64")]))
  for (const name of [...tracked, ...untracked].sort()) {
    // Never traverse a substituted ancestor symlink while hashing repository files.
    const segments = name.split("/")
    for (let index = 1; index < segments.length; index++) {
      const ancestor = lstatSync(path.join(root, ...segments.slice(0, index)), { throwIfNoEntry: false })
      if (ancestor && !ancestor.isDirectory()) throw new Error("Invalid review path ancestor")
    }
    const file = path.join(root, name)
    const before = lstatSync(file, { bigint: true, throwIfNoEntry: false })
    if (!before) {
      if (!tracked.has(name)) throw new Error("Untracked review file disappeared")
      digest.update(JSON.stringify([name, "deleted"]))
      continue
    }
    const stable = (after: typeof before | undefined) => {
      if (
        !after ||
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.mode !== after.mode ||
        before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs ||
        before.ctimeNs !== after.ctimeNs
      )
        throw new Error("Review file changed during observation")
    }
    if (before.isSymbolicLink()) {
      digest.update(JSON.stringify([name, "symlink", readlinkSync(file, { encoding: "buffer" }).toString("base64")]))
    } else if (before.isFile()) {
      const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try {
        stable(fstatSync(descriptor, { bigint: true }))
        const content = createHash("sha256")
        const buffer = Buffer.allocUnsafe(64 * 1024)
        for (;;) {
          const count = readSync(descriptor, buffer, 0, buffer.length, null)
          if (count === 0) break
          content.update(buffer.subarray(0, count))
        }
        stable(fstatSync(descriptor, { bigint: true }))
        digest.update(JSON.stringify([name, "file", (before.mode & 0o111n) !== 0n, content.digest("hex")]))
      } finally {
        closeSync(descriptor)
      }
    } else throw new Error("Unsupported review worktree entry")
    stable(lstatSync(file, { bigint: true, throwIfNoEntry: false }))
  }
  return digest.digest("hex")
}

export function requireReviewTarget(current: ReviewTarget, expected: ReviewTarget): void {
  if (
    current.root !== expected.root ||
    current.head !== expected.head ||
    current.digest !== expected.digest ||
    JSON.stringify(current.paths) !== JSON.stringify(expected.paths)
  )
    throw new ReviewTargetChanged()
}

export function observeReviewTarget(location: string, accepted: GitSnapshot): ReviewTarget {
  const snapshot = observeGit(location)
  if (
    snapshot.root !== accepted.root ||
    snapshot.head !== accepted.head ||
    JSON.stringify(snapshot.paths) !== JSON.stringify(accepted.paths)
  )
    throw new ReviewTargetChanged()
  const first = contentDigest(snapshot.root, snapshot.head)
  const middle = observeGit(location)
  const second = contentDigest(snapshot.root, snapshot.head)
  const last = observeGit(location)
  const target = Object.freeze({ ...snapshot, digest: first })
  requireReviewTarget({ ...middle, digest: second }, target)
  requireReviewTarget({ ...last, digest: second }, target)
  return target
}
