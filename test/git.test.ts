import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import { execFileSync } from "node:child_process"
import * as childProcess from "node:child_process"
import * as fs from "node:fs"
import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  symlinkSync,
  chmodSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { CommitGit } from "../src/committer-git.ts"
import * as gitModule from "../src/git.ts"
import {
  observeGit,
  requireFresh,
  requireInScope,
  observeReviewTarget,
  requireReviewTarget,
  type GitSnapshot,
} from "../src/git.ts"

const roots: string[] = []
let seed: string
let seedHead: string
beforeAll(() => {
  seed = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-primitives-seed-")))
  git(seed, "init", "-q")
  git(seed, "config", "user.name", "Primitive Test")
  git(seed, "config", "user.email", "primitives@example.invalid")
  writeFileSync(path.join(seed, "old.txt"), "initial\n")
  git(seed, "add", "old.txt")
  git(seed, "commit", "-qm", "baseline")
  seedHead = git(seed, "rev-parse", "HEAD")
})
afterAll(() => {
  rmSync(seed, { recursive: true, force: true })
})
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim()
}

function fixture(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-primitives-")))
  roots.push(root)
  // Copy all Git state privately; refresh index stat data for the destination.
  cpSync(seed, root, { recursive: true, preserveTimestamps: true })
  git(root, "update-index", "--refresh")
  return root
}

test("trusted Git observation covers staged, unstaged, ignored/unusual untracked paths, deletion, and both rename paths", () => {
  const root = fixture()
  writeFileSync(path.join(root, ".git", "info", "exclude"), "ignored.txt\n")
  writeFileSync(path.join(root, "ignored.txt"), "ignored")
  const baseline = observeGit(root)
  expect(baseline.paths).toEqual([])
  expect(() => requireFresh(baseline, { root, head: seedHead, paths: [] })).not.toThrow()
  writeFileSync(path.join(root, "old.txt"), "changed\n")
  expect(observeGit(root).paths).toEqual(["old.txt"])
  git(root, "add", "old.txt")
  expect(observeGit(root).paths).toEqual(["old.txt"])
  const unusual = "line\nbreak.txt"
  writeFileSync(path.join(root, unusual), "new\n")
  const untracked = observeGit(root)
  expect(new Set(untracked.paths)).toEqual(new Set(["old.txt", unusual]))
  expect(() => requireFresh(untracked, baseline)).toThrow()
  expect(() => requireInScope(untracked, baseline, ["old.txt"])).toThrow()
  expect(requireInScope(untracked, baseline, ["old.txt", unusual])).toHaveLength(2)
  unlinkSync(path.join(root, unusual))
  git(root, "reset", "-q", "--hard", "HEAD")
  unlinkSync(path.join(root, "old.txt"))
  expect(observeGit(root).paths).toEqual(["old.txt"])
  git(root, "reset", "-q", "--hard", "HEAD")
  renameSync(path.join(root, "old.txt"), path.join(root, "new.txt"))
  git(root, "add", "-A")
  const renamed = observeGit(root)
  expect(new Set(renamed.paths)).toEqual(new Set(["old.txt", "new.txt"]))
  expect(() => requireInScope(renamed, baseline, ["new.txt"])).toThrow()
})

test("ordinary staged and unstaged paths are observed together", () => {
  const root = fixture()
  writeFileSync(path.join(root, "second.txt"), "baseline\n")
  git(root, "add", "second.txt")
  git(root, "commit", "-qm", "second tracked file")
  const baseline = observeGit(root)
  expect(baseline.paths).toEqual([])

  writeFileSync(path.join(root, "old.txt"), "staged version\n")
  git(root, "add", "old.txt")
  writeFileSync(path.join(root, "old.txt"), "different working version\n")
  writeFileSync(path.join(root, "second.txt"), "unstaged version\n")
  const indexBefore = git(root, "ls-files", "--stage", "-z")
  const observed = observeGit(root)
  expect(observed.paths).toEqual(["old.txt", "second.txt"])
  expect(git(root, "ls-files", "--stage", "-z")).toBe(indexBefore)
  expect(() => requireFresh(observed, baseline)).toThrow()
  expect(() => requireInScope(observed, baseline, ["old.txt"])).toThrow("second.txt")
  expect(requireInScope(observed, baseline, ["old.txt", "second.txt"])).toEqual(observed.paths)
})

test("scope uses exact path equality and observation requires the worktree root", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-root-")))
  roots.push(root)
  const baseline = { root, head: seedHead, paths: [] }
  const observed = { ...baseline, paths: ["old.txt.bak"] }
  expect(() => requireInScope(observed, baseline, ["old.txt"])).toThrow("old.txt.bak")
  mkdirSync(path.join(root, "subdirectory"))
  // Root equality is a canonical-path check on trusted rev-parse output, not a
  // Git mutation. An actual directory and fixed output prove the rejection.
  const command = spyOn(childProcess, "execFileSync").mockReturnValue(Buffer.from(root + "\n"))
  try {
    expect(() => observeGit(path.join(root, "subdirectory"))).toThrow("Git root differ")
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]![1]).toContain("--show-toplevel")
  } finally {
    command.mockRestore()
  }
})

test("freshness and exact scope reject substituted root or HEAD independently of paths", () => {
  const baseline: GitSnapshot = Object.freeze({
    root: "/trusted/worktree",
    head: "1".repeat(40),
    paths: Object.freeze([]),
  })
  for (const substituted of [
    { ...baseline, root: baseline.root + "/other" },
    { ...baseline, head: "0".repeat(40) },
  ]) {
    expect(() => requireFresh(substituted, baseline)).toThrow()
    expect(() => requireInScope(substituted, baseline, [])).toThrow()
  }
  expect(() => requireFresh(baseline, baseline)).not.toThrow()
  expect(requireInScope(baseline, baseline, [])).toEqual([])
})

// Content-digest cases need actual filesystem bytes/modes/topology, but not a
// repeated seven-process path observation. The real transition test below proves
// composition with observeGit and the real index. Only trusted observations are
// doubled here; contentDigest/worktreeEntries and their race checks stay real.
function reviewFiles(run: (state: { snapshot: GitSnapshot; index: string; untracked: string[] }) => void) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-review-files-")))
  roots.push(root)
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  const state = {
    snapshot: { root, head: "1".repeat(40), paths: [] as string[] },
    index: `100644 ${"2".repeat(40)} 0\told.txt\0`,
    untracked: [] as string[],
  }
  const observer = spyOn(gitModule, "observeGit").mockImplementation(() => state.snapshot)
  const command = spyOn(childProcess, "execFileSync").mockImplementation((_file, argv = []): any => {
    const args = argv as string[]
    const operation = args.slice(args.indexOf("-C") + 2)
    if (operation[0] === "config") return Buffer.alloc(0)
    if (JSON.stringify(operation) === JSON.stringify(["ls-files", "--stage", "-z", "--"]))
      return Buffer.from(state.index)
    if (JSON.stringify(operation) === JSON.stringify(["ls-files", "--others", "--exclude-standard", "-z", "--"]))
      return Buffer.from(state.untracked.map((name) => name + "\0").join(""))
    throw new Error(`Unexpected review command: ${operation.join(" ")}`)
  })
  try {
    run(state)
  } finally {
    observer.mockRestore()
    command.mockRestore()
  }
}

test("review fingerprint binds worktree bytes and staged identities, including same-path and untracked drift", () => {
  reviewFiles((state) => {
    const { root } = state.snapshot
    writeFileSync(path.join(root, "old.txt"), "implemented\n")
    writeFileSync(path.join(root, "new.txt"), "untracked\n")
    state.snapshot = { ...state.snapshot, paths: ["new.txt", "old.txt"] }
    state.untracked = ["new.txt"]
    const snapshot = state.snapshot
    const target = observeReviewTarget(root, snapshot)
    expect(observeReviewTarget(root, snapshot)).toEqual(target)
    const assertDrift = () => {
      expect(state.snapshot.paths).toEqual(snapshot.paths)
      expect(() => requireReviewTarget(observeReviewTarget(root, snapshot), target)).toThrow("Review target changed")
    }
    writeFileSync(path.join(root, "old.txt"), "different!!\n")
    assertDrift()
    writeFileSync(path.join(root, "old.txt"), "implemented\n")
    writeFileSync(path.join(root, "new.txt"), "different\n")
    assertDrift()
    writeFileSync(path.join(root, "new.txt"), "untracked\n")
    state.index = `100644 ${"3".repeat(40)} 0\told.txt\0`
    assertDrift() // Identical worktree bytes and changed paths, different index identity.
  })
})

test("review fingerprint detects tracked bytes hidden from diff, mode/type/deletion changes and rejects widening/HEAD changes", () => {
  reviewFiles((state) => {
    const { root } = state.snapshot
    const snapshot = state.snapshot
    const target = observeReviewTarget(root, snapshot)
    // A stat/assume-unchanged observation can retain an empty delta. Digest
    // hashing must still reject changed tracked bytes independently of Git.
    writeFileSync(path.join(root, "old.txt"), "hidden change\n")
    expect(state.snapshot.paths).toEqual([])
    expect(() => requireReviewTarget(observeReviewTarget(root, snapshot), target)).toThrow()
    writeFileSync(path.join(root, "old.txt"), "changed\n")
    state.snapshot = { ...snapshot, paths: ["old.txt"] }
    const changed = state.snapshot
    const changedTarget = observeReviewTarget(root, changed)
    chmodSync(path.join(root, "old.txt"), 0o755)
    expect(() => requireReviewTarget(observeReviewTarget(root, changed), changedTarget)).toThrow()
    unlinkSync(path.join(root, "old.txt"))
    expect(observeReviewTarget(root, changed).digest).not.toBe(changedTarget.digest)
    symlinkSync("missing-one", path.join(root, "old.txt"))
    const link = observeReviewTarget(root, changed)
    unlinkSync(path.join(root, "old.txt"))
    symlinkSync("missing-two", path.join(root, "old.txt"))
    expect(observeReviewTarget(root, changed).digest).not.toBe(link.digest)
    state.snapshot = { ...changed, paths: ["old.txt", "outside.txt"] }
    expect(() => observeReviewTarget(root, changed)).toThrow("Review target changed")
    state.snapshot = { ...changed, head: "4".repeat(40) }
    expect(() => observeReviewTarget(root, changed)).toThrow("Review target changed")
  })
})

test("review target rejects unsupported Git entries and ambiguous file topology", () => {
  reviewFiles((state) => {
    const { root } = state.snapshot
    state.index = `160000 ${state.snapshot.head} 0\tmodule\0`
    expect(() => observeReviewTarget(root, state.snapshot)).toThrow("Unsupported or ambiguous index")
    state.index = `100644 ${"2".repeat(40)} 0\told.txt\0`
    unlinkSync(path.join(root, "old.txt"))
    mkdirSync(path.join(root, "old.txt"))
    expect(() => observeReviewTarget(root, state.snapshot)).toThrow("Unsupported review worktree entry")
    expect(() => observeReviewTarget("/does-not-exist", { ...state.snapshot, root: "/does-not-exist" })).toThrow()
  })
})

// Object-format coverage starts at the index-content primitive. The complete
// authority lifecycle below and the large-Git suite already prove orchestration.
test("complete-index and postflight proofs preserve real SHA-256 Git object identities", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-sha256-")))
  roots.push(root)
  git(root, "init", "-q", "--object-format=sha256")
  git(root, "config", "user.name", "Primitive Test")
  git(root, "config", "user.email", "primitives@example.invalid")
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  git(root, "add", "old.txt")
  git(root, "commit", "-qm", "SHA-256 baseline")
  const head = git(root, "rev-parse", "HEAD")
  const data = "approved SHA-256 change\n"
  writeFileSync(path.join(root, "old.txt"), data)
  git(root, "add", "old.txt")
  const prepared = {
    target: { root, head, paths: ["old.txt"], digest: "a".repeat(64) },
    tree: git(root, "write-tree"),
    names: ["old.txt"],
    entries: [["old.txt", "file", false, createHash("sha256").update(data).digest("hex")] as const],
  }
  expect(head).toHaveLength(64)
  expect(prepared.tree).toHaveLength(64)
  // Ordinary root/HEAD/path observation is independent of object width and is
  // integrated below. Retain real 64-character index/blob/commit object reads.
  const observer = spyOn(gitModule, "observeGit").mockReturnValue(prepared.target)
  try {
    gitModule.requirePreparedCommit(prepared)
    gitModule.trustedGit(root, ["commit", "-qm", "Implement SHA-256 change"])
    observer.mockReturnValue({ root, head: git(root, "rev-parse", "HEAD"), paths: [] })
    const final = gitModule.verifyCommitted(prepared)
    expect(final.head).toHaveLength(64)
    expect(final.paths).toEqual([])
    expect(final.subject).toBe("Implement SHA-256 change")
  } finally {
    observer.mockRestore()
  }
  expect(git(root, "rev-parse", "HEAD^")).toBe(head)
  expect(git(root, "show", "HEAD:old.txt")).toBe(data.trimEnd())
})

test("bounded blob proof rejects malformed output and races, and closes/unlinks large-object resources on failure", () => {
  // These parser/resource cases use only test-scoped Git doubles and tiny files;
  // real-Git content, scope and object-format behavior is covered separately.
  for (const width of [40, 64]) {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-blob-proof-")))
    roots.push(root)
    for (const scenario of [
      "index-extra",
      "index-duplicate",
      "index-mode",
      "metadata-id",
      "metadata-type",
      "metadata-size",
      "metadata-cr",
      "metadata-truncated",
      "metadata-extra",
      "body-truncated",
      "body-extra",
      "body-size",
      "body-header",
      "body-id",
      "body-content",
      "body-terminator",
      "worktree-race",
      "large-header",
      "large-id",
      "large-size",
      "large-truncated",
      "large-extra",
      "large-terminator",
      "large-process",
      "large-timeout",
      "large-success",
    ]) {
      const data = scenario === "large-success" ? Buffer.alloc(1024 * 1024 + 1024, 0x61) : Buffer.from("ok\n")
      writeFileSync(path.join(root, "old.txt"), data)
      const oid = "c".repeat(width),
        head = "1".repeat(width),
        tree = "b".repeat(width)
      const prepared = {
        target: { root, head, paths: ["old.txt"], digest: "a".repeat(64) },
        names: ["old.txt"],
        entries: [["old.txt", "file", false, createHash("sha256").update(data).digest("hex")] as const],
        tree,
      }
      const size = scenario.startsWith("large-") ? 1024 * 1024 + 1024 : data.length
      const header = `${oid} blob ${size}\n`
      const descriptors: number[] = [],
        directories: string[] = []
      const makeDirectory = fs.mkdtempSync
      const temporary = spyOn(fs, "mkdtempSync").mockImplementation((prefix) => {
        const directory = makeDirectory(prefix)
        directories.push(directory)
        roots.push(directory)
        return directory as any
      })
      const command = spyOn(childProcess, "execFileSync").mockImplementation((_file, argv = [], options = {}) => {
        const args = argv as string[]
        const operation = args.slice(args.indexOf("-C") + 2)
        if (operation[0] === "rev-parse")
          return Buffer.from(operation.includes("--show-toplevel") ? root + "\n" : head + "\n")
        if (operation[0] === "ls-files" && operation.includes("--stage")) {
          const record = `${scenario === "index-mode" ? "160000" : "100644"} ${oid} 0\told.txt\0`
          return Buffer.from(
            record +
              (scenario === "index-extra"
                ? `100644 ${oid} 0\toutside.txt\0`
                : scenario === "index-duplicate"
                  ? record
                  : ""),
          )
        }
        if (operation[0] === "diff-index" && operation.includes(head)) return Buffer.from("old.txt\0")
        if (operation[0] !== "cat-file") return Buffer.alloc(0)
        if (operation[1] === "--batch-check") {
          if (scenario === "metadata-id") return Buffer.from(`${"d".repeat(width)} blob ${size}\n`)
          if (scenario === "metadata-type") return Buffer.from(`${oid} tree ${size}\n`)
          if (scenario === "metadata-size") return Buffer.from(`${oid} blob 99999999999999999999\n`)
          if (scenario === "metadata-cr") return Buffer.from(`${oid} blob ${size}\r\n`)
          if (scenario === "metadata-truncated") return Buffer.from(header.trimEnd())
          if (scenario === "metadata-extra") return Buffer.from(header + header)
          return Buffer.from(header)
        }
        const output = (options as any).stdio[1]
        if (typeof output === "number") {
          descriptors.push(output)
          expect(fs.fstatSync(output).nlink).toBe(0)
          expect(fs.fstatSync(output).mode & 0o077).toBe(0)
          fs.writeSync(
            output,
            scenario === "large-header"
              ? `${oid} tree ${size}\n`
              : scenario === "large-id"
                ? `${"d".repeat(width)} blob ${size}\n`
                : scenario === "large-size"
                  ? `${oid} blob ${size + 1}\n`
                  : header,
          )
          if (scenario === "large-process" || scenario === "large-timeout")
            throw Object.assign(new Error(scenario), {
              status: scenario === "large-process" ? 1 : null,
              code: scenario === "large-timeout" ? "ETIMEDOUT" : undefined,
            })
          fs.writeSync(
            output,
            scenario === "large-truncated" || scenario === "large-header" || scenario === "large-size"
              ? data
              : Buffer.alloc(size, 0x61),
          )
          fs.writeSync(output, scenario === "large-terminator" ? "!" : scenario === "large-extra" ? "\nextra" : "\n")
          return null as any
        }
        if (scenario === "body-header") return Buffer.from(`${oid} tree ${size}\n`)
        if (scenario === "body-id") return Buffer.from(`${"d".repeat(width)} blob ${size}\n`)
        if (scenario === "body-content")
          return Buffer.concat([Buffer.from(header), Buffer.from("no\n"), Buffer.from("\n")])
        if (scenario === "body-size")
          return Buffer.concat([Buffer.from(`${oid} blob ${size + 1}\n`), data, Buffer.from("\n")])
        if (scenario === "body-truncated") return Buffer.concat([Buffer.from(header), data])
        if (scenario === "worktree-race") writeFileSync(path.join(root, "old.txt"), "raced bytes\n")
        return Buffer.concat([
          Buffer.from(header),
          data,
          Buffer.from(scenario === "body-extra" ? "\nextra" : scenario === "body-terminator" ? "!" : "\n"),
        ])
      })
      try {
        const proof = () => gitModule.requirePreparedCommit(prepared)
        if (scenario === "large-success") expect(proof).not.toThrow()
        else
          expect(proof).toThrow(
            scenario === "worktree-race"
              ? "Approved worktree content changed"
              : scenario === "index-extra"
                ? "Unexpected prepared index paths"
                : scenario === "index-duplicate"
                  ? "Duplicate commit index entry"
                  : scenario === "index-mode"
                    ? "Unsupported commit index entry"
                    : scenario.startsWith("large-") && ["large-process", "large-timeout"].includes(scenario)
                      ? scenario
                      : scenario === "body-content"
                        ? "Prepared staged content differs from approved content"
                        : /staged blob/,
          )
        expect(descriptors.length).toBe(scenario.startsWith("large-") ? 1 : 0)
        for (const descriptor of descriptors) expect(() => fs.fstatSync(descriptor)).toThrow()
        for (const directory of directories) expect(fs.existsSync(directory)).toBe(false)
        expect(command.mock.calls.some(([, args]) => (args as string[]).includes("commit"))).toBe(false)
      } finally {
        command.mockRestore()
        temporary.mockRestore()
      }
    }
  }
})

// Cross the internal batching boundaries with tiny metadata fixtures and only
// 1.2 MiB of content. The >16 MiB real-Git proofs live in git-large.integration.ts.
for (const width of [40, 64]) {
  for (const { count, size, expectedMetadata, expectedReads } of [
    { count: 4097, size: 0, expectedMetadata: [4096, 1], expectedReads: [4096, 1] },
    { count: 3, size: 400 * 1024, expectedMetadata: [3], expectedReads: [2, 1] },
  ]) {
    test(`${size ? "complete index" : "blob metadata"} proof bounds batches and deduplicates ${width * 4}-bit OIDs`, () => {
      const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-batches-")))
      roots.push(root)
      const content = Buffer.alloc(size, 0x61),
        digest = createHash("sha256").update(content).digest("hex")
      const objects = Array.from({ length: count }, (_, index) => ({
        name: `file-${String(index).padStart(4, "0")}.bin`,
        oid: (index + 10).toString(16).padStart(width, "0"),
      }))
      const entries = [...objects, { name: "duplicate.bin", oid: objects[0]!.oid }]
      // The metadata case reaches all 4097 unique IDs before rejecting the
      // deliberately incomplete prepared path set. Only two physical files are
      // needed; the byte-budget case verifies every path through a complete proof.
      const approved = size ? entries : [entries[0]!, entries.at(-1)!]
      for (const { name } of approved) writeFileSync(path.join(root, name), content)
      const names = approved.map(({ name }) => name).sort(),
        head = "1".repeat(width)
      const prepared = {
        target: { root, head, paths: names, digest: "a".repeat(64) },
        tree: "b".repeat(width),
        names,
        entries: names.map((name) => [name, "file", false, digest] as const),
      }
      const metadataGroups: string[][] = [],
        readGroups: string[][] = []
      const command = spyOn(childProcess, "execFileSync").mockImplementation((_file, argv = [], options = {}): any => {
        const args = argv as string[],
          operation = args.slice(args.indexOf("-C") + 2)
        if (operation[0] === "rev-parse")
          return Buffer.from(operation.includes("--show-toplevel") ? root + "\n" : head + "\n")
        if (operation[0] === "ls-files" && operation.includes("--stage"))
          return Buffer.from(entries.map(({ name, oid }) => `100644 ${oid} 0\t${name}\0`).join(""))
        if (operation[0] === "diff-index" && operation.includes(head)) return Buffer.from(names.join("\0") + "\0")
        if (operation[0] !== "cat-file") return Buffer.alloc(0)
        const ids = (options as any).input.toString("utf8").trimEnd().split("\n") as string[]
        if (operation[1] === "--batch-check") {
          metadataGroups.push(ids)
          return Buffer.from(ids.map((oid) => `${oid} blob ${size}\n`).join(""))
        }
        expect((options as any).stdio[1]).toBe("pipe")
        readGroups.push(ids)
        const output = Buffer.concat(
          ids.flatMap((oid) => [Buffer.from(`${oid} blob ${size}\n`), content, Buffer.from("\n")]),
        )
        expect(output.length).toBeLessThanOrEqual(1024 * 1024)
        return output
      })
      try {
        if (size) expect(() => gitModule.requirePreparedCommit(prepared)).not.toThrow()
        else expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("Unexpected prepared index paths")
        expect(metadataGroups.map((group) => group.length)).toEqual(expectedMetadata)
        expect(readGroups.map((group) => group.length)).toEqual(expectedReads)
        expect(metadataGroups.flat()).toEqual(objects.map(({ oid }) => oid))
        expect(readGroups.flat()).toEqual(metadataGroups.flat())
      } finally {
        command.mockRestore()
      }
    })
  }
}

test("approved worktree transitions through exact staged bytes/modes/deletions/symlinks to one verified commit", () => {
  const root = fixture()
  const head = seedHead
  unlinkSync(path.join(root, "old.txt"))
  writeFileSync(path.join(root, "new.txt"), "new approved executable\n")
  chmodSync(path.join(root, "new.txt"), 0o755)
  symlinkSync("new.txt", path.join(root, "link.txt"))
  const target = observeReviewTarget(root, { root, head, paths: ["link.txt", "new.txt", "old.txt"] })
  const owner = new CommitGit(target)
  owner.execute({ operation: "prepare" }, () => {})
  expect(
    owner.execute(
      { operation: "commit", message: "Implement approved content\n\nLiteral --amend --no-verify $(touch nope)" },
      () => {},
    ),
  ).toContain("Commit succeeded")
  expect(git(root, "status", "--porcelain")).toBe("")
  expect(git(root, "rev-parse", "HEAD")).not.toBe(head)
  expect(git(root, "rev-parse", "HEAD^")).toBe(head)
  expect(git(root, "show", "HEAD:new.txt")).toBe("new approved executable")
  expect(git(root, "show", "HEAD:link.txt")).toBe("new.txt")
  const tree = git(root, "ls-tree", "HEAD")
  expect(tree).toContain("100755")
  expect(tree).not.toContain("old.txt")
  chmodSync(path.join(root, "new.txt"), 0o644)
  expect(owner.final()).toContain("did not reach a verified successful")
})

test("preparation rejects widened scope and same-path byte drift before staging", () => {
  reviewFiles((state) => {
    const { root } = state.snapshot
    state.snapshot = { ...state.snapshot, paths: ["old.txt"] }
    writeFileSync(path.join(root, "old.txt"), "approved\n")
    const target = observeReviewTarget(root, state.snapshot)
    state.snapshot = { ...state.snapshot, paths: ["old.txt", "outside.txt"] }
    expect(() => gitModule.prepareCommit(target)).toThrow("Review target changed")
    state.snapshot = { ...state.snapshot, paths: ["old.txt"] }
    writeFileSync(path.join(root, "old.txt"), "drift\n")
    expect(() => gitModule.prepareCommit(target)).toThrow("Review target changed")
    // The double rejects every unconfigured command, including add/write-tree.
  })
})

test("prepared content proof rejects real partial/substituted index hidden by stat flags, and changed HEAD", () => {
  const root = fixture()
  const data = "approved\n"
  writeFileSync(path.join(root, "old.txt"), data)
  git(root, "add", "old.txt")
  const target = { root, head: seedHead, paths: ["old.txt"], digest: "a".repeat(64) }
  const prepared = {
    target,
    tree: git(root, "write-tree"),
    names: ["old.txt"],
    entries: [["old.txt", "file", false, createHash("sha256").update(data).digest("hex")] as const],
  }
  // This case holds the exact ordinary delta fixed and tests the real index
  // proof. Root/HEAD observation is covered independently and again below.
  const observer = spyOn(gitModule, "observeGit").mockReturnValue(target)
  try {
    git(root, "reset", "-q", "HEAD", "--", "old.txt")
    expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("Staged paths")
    writeFileSync(path.join(root, "old.txt"), "substituted\n")
    git(root, "add", "old.txt")
    writeFileSync(path.join(root, "old.txt"), data)
    git(root, "update-index", "--assume-unchanged", "old.txt")
    expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("staged content differs from approved")
    git(root, "update-index", "--no-assume-unchanged", "old.txt")
    git(root, "add", "old.txt")
    gitModule.requirePreparedCommit(prepared)
  } finally {
    observer.mockRestore()
  }
  git(root, "commit", "-qm", "External commit")
  expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("HEAD changed")
})

// Hook execution and postflight object semantics require real Git. Authority
// spending for all three outcomes is tested at the state-machine layer instead
// of replaying prepare, pre-spawn verification and failure receipt observation.
for (const hook of ["reject", "modify", "ambiguous"] as const) {
  test(`real ${hook} hook is honored and postflight fails closed without cleanup`, () => {
    const root = fixture()
    writeFileSync(path.join(root, "old.txt"), "approved\n")
    git(root, "add", "old.txt")
    const target = { root, head: seedHead, paths: ["old.txt"], digest: "a".repeat(64) }
    const prepared = {
      target,
      tree: git(root, "write-tree"),
      names: ["old.txt"],
      entries: [["old.txt", "file", false, createHash("sha256").update("approved\n").digest("hex")] as const],
    }
    const hookName = hook === "ambiguous" ? "post-commit" : "pre-commit"
    writeFileSync(
      path.join(root, ".git", "hooks", hookName),
      hook === "reject"
        ? "#!/bin/sh\nexit 1\n"
        : hook === "modify"
          ? "#!/bin/sh\nprintf 'hook modified\\n' > old.txt\ngit add -- old.txt\n"
          : "#!/bin/sh\ngit -c core.hooksPath=/dev/null commit --allow-empty -qm 'hook extra commit'\n",
    )
    chmodSync(path.join(root, ".git", "hooks", hookName), 0o755)
    const commit = () => gitModule.trustedGit(root, ["commit", "--cleanup=verbatim", "-m", "Implement reviewed change"])
    if (hook === "reject") expect(commit).toThrow()
    else expect(commit).not.toThrow()
    const headAfter = git(root, "rev-parse", "HEAD")
    const indexAfter = git(root, "ls-files", "--stage")
    expect(headAfter === target.head).toBe(hook === "reject")
    expect(() => gitModule.verifyCommitted(prepared)).toThrow(
      hook === "reject"
        ? "Unexpected final HEAD/worktree state"
        : hook === "modify"
          ? "Committed tree differs from prepared approved content"
          : "Commit did not advance the approved HEAD by exactly one parent",
    )
    expect(git(root, "rev-parse", "HEAD")).toBe(headAfter)
    expect(git(root, "ls-files", "--stage")).toBe(indexAfter)
    if (hook === "reject") expect(git(root, "diff", "--cached", "--name-only")).toBe("old.txt")
    if (hook === "modify") expect(git(root, "show", "HEAD:old.txt")).toBe("hook modified")
  })
}
