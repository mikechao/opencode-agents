import { execFileSync } from "node:child_process"
import {
  realpathSync,
  lstatSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  readlinkSync,
  mkdtempSync,
  unlinkSync,
  rmSync,
  constants,
} from "node:fs"
import { createHash } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

export interface GitSnapshot {
  readonly root: string
  readonly head: string
  readonly paths: readonly string[]
}

const decoder = new TextDecoder("utf-8", { fatal: true })

export function trustedGit(
  root: string,
  args: readonly string[],
  timeout = 10_000,
  input?: Buffer,
  output?: number,
): Buffer {
  return (
    execFileSync(
      "/usr/bin/git",
      [
        "--no-pager",
        "--no-optional-locks",
        "--no-lazy-fetch",
        "--literal-pathspecs",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "protocol.allow=never",
        "-C",
        root,
        ...args,
      ],
      {
        env: {
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          HOME: process.env.HOME,
          USER: process.env.USER,
          LOGNAME: process.env.LOGNAME,
          TMPDIR: process.env.TMPDIR,
          LC_ALL: "C",
          GIT_NO_REPLACE_OBJECTS: "1",
          GIT_NO_LAZY_FETCH: "1",
          GIT_TERMINAL_PROMPT: "0",
        },
        timeout,
        maxBuffer: 16 * 1024 * 1024,
        shell: false,
        input,
        stdio: [input ? "pipe" : "ignore", output ?? "pipe", "pipe"],
      },
    ) ?? Buffer.alloc(0)
  )
}

const git = trustedGit

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
  const entries = worktreeEntries(root, [...tracked, ...untracked].sort())
  if (entries.some(([name, type]) => type === "deleted" && !tracked.has(name)))
    throw new Error("Untracked review file disappeared")
  return createHash("sha256")
    .update(JSON.stringify(["review-target-v1", root, head, index.toString("base64")]))
    .update(entries.map((entry) => JSON.stringify(entry)).join(""))
    .digest("hex")
}

type WorktreeEntry =
  | readonly [name: string, type: "deleted"]
  | readonly [name: string, type: "symlink", bytes: string]
  | readonly [name: string, type: "file", executable: boolean, digest: string]

function worktreeEntries(root: string, names: readonly string[]): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  for (const name of names) {
    // Never traverse a substituted ancestor symlink while hashing repository files.
    const segments = name.split("/")
    for (let index = 1; index < segments.length; index++) {
      const ancestor = lstatSync(path.join(root, ...segments.slice(0, index)), { throwIfNoEntry: false })
      if (ancestor && !ancestor.isDirectory()) throw new Error("Invalid review path ancestor")
    }
    const file = path.join(root, name)
    const before = lstatSync(file, { bigint: true, throwIfNoEntry: false })
    if (!before) {
      entries.push([name, "deleted"])
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
      entries.push([name, "symlink", readlinkSync(file, { encoding: "buffer" }).toString("base64")])
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
        entries.push([name, "file", (before.mode & 0o111n) !== 0n, content.digest("hex")])
      } finally {
        closeSync(descriptor)
      }
    } else throw new Error("Unsupported review worktree entry")
    stable(lstatSync(file, { bigint: true, throwIfNoEntry: false }))
  }
  return entries.map((entry) => Object.freeze(entry))
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

export interface PreparedCommit {
  readonly target: ReviewTarget
  readonly tree: string
  readonly names: readonly string[]
  readonly entries: readonly WorktreeEntry[]
}

function indexEntries(root: string): Map<string, { mode: string; oid: string }> {
  const result = new Map<string, { mode: string; oid: string }>()
  const bytes = git(root, ["ls-files", "--stage", "-z", "--"])
  if (bytes.length && bytes.at(-1) !== 0) throw new Error("Incomplete commit index observation")
  for (const record of bytes.length ? decoder.decode(bytes.subarray(0, -1)).split("\0") : []) {
    const match = /^(100644|100755|120000) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t([\s\S]+)$/.exec(record)
    if (!match) throw new Error("Unsupported commit index entry")
    const name = paths(Buffer.from(`${match[3]}\0`))[0]!
    if (result.has(name)) throw new Error("Duplicate commit index entry")
    result.set(name, { mode: match[1]!, oid: match[2]! })
  }
  return result
}

const blobBatchBytes = 1024 * 1024
function blobSize(header: string, id: string): number {
  const match = /^([0-9a-f]{40}|[0-9a-f]{64}) blob (0|[1-9][0-9]*)$/.exec(header)
  if (!match || match[0] !== header || match[1] !== id) throw new Error("Unexpected staged blob identity/type")
  const size = Number(match[2])
  if (!Number.isSafeInteger(size) || size > Number.MAX_SAFE_INTEGER - 128) throw new Error("Invalid staged blob size")
  return size
}

// Retain only digests (and bounded symlink bytes), never the complete index's
// blob contents. Metadata batches are bounded independently of object sizes.
function indexBlobs(
  root: string,
  objects: readonly string[],
  links: ReadonlyMap<string, number>,
): Map<string, { digest: string; link?: string }> {
  const ids = [...new Set(objects)]
  const result = new Map<string, { digest: string; link?: string }>()
  for (let start = 0; start < ids.length; start += 4096) {
    const group = ids.slice(start, start + 4096)
    const metadata = trustedGit(root, ["cat-file", "--batch-check"], 10_000, Buffer.from(group.join("\n") + "\n"))
    const headers = decoder.decode(metadata).split("\n")
    if (headers.length !== group.length + 1 || headers.at(-1) !== "")
      throw new Error("Incomplete or unexpected staged blob metadata")
    const sizes = new Map(group.map((id, index) => [id, blobSize(headers[index]!, id)]))
    let batch: string[] = [],
      budget = 0
    const flush = () => {
      if (!batch.length) return
      const bytes = trustedGit(root, ["cat-file", "--batch"], 10_000, Buffer.from(batch.join("\n") + "\n"))
      if (bytes.length > blobBatchBytes) throw new Error("Unexpected staged blob batch size")
      let offset = 0
      for (const id of batch) {
        const end = bytes.indexOf(10, offset)
        if (end < 0) throw new Error("Incomplete staged blob header")
        const size = blobSize(decoder.decode(bytes.subarray(offset, end)), id)
        offset = end + 1
        if (size !== sizes.get(id) || offset + size >= bytes.length || bytes[offset + size] !== 10)
          throw new Error("Incomplete or changed staged blob content")
        const content = bytes.subarray(offset, offset + size)
        result.set(id, {
          digest: createHash("sha256").update(content).digest("hex"),
          ...(links.has(id) ? { link: content.toString("base64") } : {}),
        })
        offset += size + 1
      }
      if (offset !== bytes.length) throw new Error("Unexpected staged blob output")
      batch = []
      budget = 0
    }
    for (let index = 0; index < group.length; index++) {
      const id = group[index]!,
        size = sizes.get(id)!
      if (links.has(id) && size !== links.get(id))
        throw new Error("Prepared staged content differs from approved content")
      // A physical symlink's expected bytes are bounded by the filesystem, and
      // large blob output must never be retained for symlink comparison.
      if (links.has(id) && size > blobBatchBytes) throw new Error("Unsupported staged symlink size")
      const framedSize = headers[index]!.length + 1 + size + 1
      if (framedSize > blobBatchBytes) {
        flush()
        result.set(id, { digest: largeBlobDigest(root, id, size) })
      } else {
        if (budget + framedSize > blobBatchBytes) flush()
        batch.push(id)
        budget += framedSize
      }
    }
    flush()
  }
  return result
}

function largeBlobDigest(root: string, id: string, size: number): string {
  // Redirect stdout directly to an unlinked private file: the synchronous Git
  // boundary remains intact without buffering this object in process memory.
  // Only one large object occupies temporary disk at a time, never the index.
  const directory = mkdtempSync(path.join(tmpdir(), "opencode-agents-blob-"))
  let descriptor: number | undefined
  try {
    const file = path.join(directory, "blob")
    descriptor = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    unlinkSync(file)
    trustedGit(root, ["cat-file", "--batch"], 10_000, Buffer.from(id + "\n"), descriptor)
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const count = readSync(descriptor, buffer, 0, 128, 0)
    const end = buffer.subarray(0, count).indexOf(10)
    if (end < 0) throw new Error("Incomplete staged blob header")
    if (blobSize(decoder.decode(buffer.subarray(0, end)), id) !== size) throw new Error("Changed staged blob size")
    if (fstatSync(descriptor).size !== end + 1 + size + 1)
      throw new Error("Incomplete or unexpected staged blob output")
    const digest = createHash("sha256")
    let offset = end + 1,
      remaining = size
    while (remaining) {
      const read = readSync(descriptor, buffer, 0, Math.min(buffer.length, remaining), offset)
      if (!read) throw new Error("Incomplete staged blob content")
      digest.update(buffer.subarray(0, read))
      offset += read
      remaining -= read
    }
    if (readSync(descriptor, buffer, 0, 1, offset) !== 1 || buffer[0] !== 10)
      throw new Error("Incomplete staged blob terminator")
    return digest.digest("hex")
  } finally {
    try {
      if (descriptor !== undefined) closeSync(descriptor)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function requireIndexContent(root: string, prepared: Pick<PreparedCommit, "names" | "entries">): void {
  const index = indexEntries(root)
  if (JSON.stringify(worktreeEntries(root, prepared.names)) !== JSON.stringify(prepared.entries))
    throw new Error("Approved worktree content changed during commit transition")
  const blobs = indexBlobs(
    root,
    [...index.values()].map((entry) => entry.oid),
    new Map(
      prepared.entries.flatMap(([name, type, value]) => {
        const entry = index.get(name)
        return type === "symlink" && entry ? [[entry.oid, Buffer.from(value, "base64").length] as const] : []
      }),
    ),
  )
  for (const [name, type, value, digest] of prepared.entries) {
    const entry = index.get(name)
    if (type === "deleted") {
      if (entry) throw new Error("Approved deletion remains in index")
      continue
    }
    const mode = type === "symlink" ? "120000" : value ? "100755" : "100644"
    if (!entry || entry.mode !== mode) throw new Error("Prepared index mode/path differs from approved content")
    const blob = blobs.get(entry.oid)
    if (!blob) throw new Error("Missing staged blob")
    if (type === "symlink" ? blob.link !== value : blob.digest !== digest)
      throw new Error("Prepared staged content differs from approved content")
    index.delete(name)
  }
  if (index.size) throw new Error("Unexpected prepared index paths")
  if (JSON.stringify(worktreeEntries(root, prepared.names)) !== JSON.stringify(prepared.entries))
    throw new Error("Approved worktree content changed during commit transition")
}

export function prepareCommit(target: ReviewTarget): PreparedCommit {
  requireNoCommitFilters(target.root)
  requireReviewTarget(observeReviewTarget(target.root, target), target)
  if (!target.paths.length) throw new Error("No reviewed delta to commit")
  const names = [
    ...new Set([
      ...indexEntries(target.root).keys(),
      ...paths(git(target.root, ["ls-files", "--others", "--exclude-standard", "-z", "--"])),
    ]),
  ].sort()
  const entries = worktreeEntries(target.root, names)
  requireReviewTarget(observeReviewTarget(target.root, target), target)
  git(target.root, ["add", "--all", "--", ...target.paths])
  const prepared = Object.freeze({
    target,
    names: Object.freeze(names),
    entries: Object.freeze(entries),
    tree: line(target.root, ["write-tree"]),
  })
  requirePreparedCommit(prepared)
  return prepared
}

export function requirePreparedCommit(prepared: PreparedCommit): void {
  const { target } = prepared
  requireNoCommitFilters(target.root)
  const current = observeGit(target.root, target)
  if (JSON.stringify(current.paths) !== JSON.stringify(target.paths))
    throw new Error("Prepared delta differs from reviewed paths")
  const staged = paths(
    git(target.root, ["diff-index", "--cached", "--no-renames", "--name-only", "-z", target.head, "--"]),
  )
  if (JSON.stringify([...new Set(staged)].sort()) !== JSON.stringify(target.paths))
    throw new Error("Staged paths differ from reviewed paths")
  if (
    git(target.root, ["diff-files", "--no-renames", "--name-only", "-z", "--"]).length ||
    git(target.root, ["ls-files", "--others", "--exclude-standard", "-z", "--"]).length
  )
    throw new Error("Incomplete staging or unexpected worktree delta")
  requireIndexContent(target.root, prepared)
  if (git(target.root, ["diff-index", "--cached", "--no-renames", "--name-only", "-z", prepared.tree, "--"]).length)
    throw new Error("Prepared index tree changed")
  observeGit(target.root, target)
}

export function verifyCommitted(prepared: PreparedCommit): GitSnapshot & { subject: string } {
  const { target, tree } = prepared
  requireNoCommitFilters(target.root)
  const current = observeGit(target.root)
  if (current.root !== target.root || current.head === target.head || current.paths.length)
    throw new Error("Unexpected final HEAD/worktree state")
  // Read actual commit headers, independent of shallow/graft traversal views.
  const object = git(target.root, ["cat-file", "commit", current.head])
  const separator = object.indexOf("\n\n")
  if (separator < 0) throw new Error("Incomplete committed object")
  const headers = decoder.decode(object.subarray(0, separator)).split("\n")
  if (
    JSON.stringify(headers.filter((header) => header.startsWith("parent "))) !==
    JSON.stringify([`parent ${target.head}`])
  )
    throw new Error("Commit did not advance the approved HEAD by exactly one parent")
  if (headers[0] !== `tree ${tree}`) throw new Error("Committed tree differs from prepared approved content")
  const committed = paths(
    git(target.root, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "--no-renames",
      "--name-only",
      "-z",
      target.head,
      current.head,
      "--",
    ]),
  )
  if (JSON.stringify(committed.sort()) !== JSON.stringify(target.paths))
    throw new Error("Committed paths differ from reviewed paths")
  requireIndexContent(target.root, prepared)
  if (git(target.root, ["diff-index", "--cached", "--no-renames", "--name-only", "-z", tree, "--"]).length)
    throw new Error("Final staged state differs from committed tree")
  const subject = line(target.root, ["show", "--no-show-signature", "-s", "--format=%s", current.head])
  requireFresh(observeGit(target.root), current)
  return Object.freeze({ ...current, subject })
}

export function requireNoCommitFilters(root: string): void {
  try {
    const filters = git(root, [
      "config",
      "--includes",
      "--null",
      "--name-only",
      "--get-regexp",
      "^filter\\..*\\.(clean|process)$",
    ])
    if (filters.length) throw new Error("Commit preparation does not support clean/process filters")
  } catch (error) {
    if (!error || typeof error !== "object" || !("status" in error) || error.status !== 1) throw error
  }
}
