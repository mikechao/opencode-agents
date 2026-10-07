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
beforeAll(() => {
  seed = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-primitives-seed-")))
  git(seed, "init", "-q")
  git(seed, "config", "user.name", "Primitive Test")
  git(seed, "config", "user.email", "primitives@example.invalid")
  writeFileSync(path.join(seed, "old.txt"), "initial\n")
  git(seed, "add", "old.txt")
  git(seed, "commit", "-qm", "baseline")
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

test("trusted Git observation covers staged, unstaged, untracked, deletion, and both rename paths", () => {
  const root = fixture()
  const baseline = observeGit(root)
  expect(baseline.paths).toEqual([])
  writeFileSync(path.join(root, "old.txt"), "changed\n")
  expect(observeGit(root).paths).toEqual(["old.txt"])
  git(root, "add", "old.txt")
  expect(observeGit(root).paths).toEqual(["old.txt"])
  writeFileSync(path.join(root, "new.txt"), "new\n")
  const untracked = observeGit(root)
  expect(new Set(untracked.paths)).toEqual(new Set(["old.txt", "new.txt"]))
  expect(() => requireFresh(untracked, baseline)).toThrow()
  expect(() => requireInScope(untracked, baseline, ["old.txt"])).toThrow()
  expect(requireInScope(untracked, baseline, ["old.txt", "new.txt"])).toHaveLength(2)
  unlinkSync(path.join(root, "new.txt"))
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

test("ignored untracked paths are excluded from ordinary cleanliness", () => {
  const root = fixture()
  writeFileSync(path.join(root, ".gitignore"), "ignored.txt\n")
  git(root, "add", ".gitignore")
  git(root, "commit", "-qm", "ignore rule")
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "ignored.txt"), "ignored")
  const ignored = observeGit(root)
  expect(ignored.paths).toEqual([])
  expect(() => requireFresh(ignored, baseline)).not.toThrow()
  writeFileSync(path.join(root, "visible.txt"), "visible")
  expect(observeGit(root).paths).toEqual(["visible.txt"])
})

test("scope uses exact path equality and observation requires the worktree root", () => {
  const root = fixture()
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "old.txt.bak"), "different path")
  const observed = observeGit(root)
  expect(observed.paths).toEqual(["old.txt.bak"])
  expect(() => requireInScope(observed, baseline, ["old.txt"])).toThrow("old.txt.bak")
  mkdirSync(path.join(root, "subdirectory"))
  expect(() => observeGit(path.join(root, "subdirectory"))).toThrow("Git root differ")
})

test("changed HEAD cannot pass; unusual pathnames remain exact", () => {
  const root = fixture()
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "line\nbreak.txt"), "data")
  expect(observeGit(root).paths).toEqual(["line\nbreak.txt"])
  git(root, "add", "-A")
  git(root, "commit", "-qm", "new head")
  expect(() => observeGit(root, baseline)).toThrow("HEAD changed before Git observation")
  expect(() => requireInScope(observeGit(root), baseline, ["line\nbreak.txt"])).toThrow()
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

// Digest-only checks retain real index reads and filesystem hashing. Reuse the
// exact observed path/HEAD state while the case holds it fixed; initial targets,
// scope/HEAD rejection and unsupported topology below use the full observer.
function fingerprintAt(snapshot: GitSnapshot) {
  const observer = spyOn(gitModule, "observeGit").mockReturnValue(snapshot)
  try {
    return observeReviewTarget(snapshot.root, snapshot)
  } finally {
    observer.mockRestore()
  }
}

test("review fingerprint binds worktree bytes and staged identities, including same-path and untracked drift", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "implemented\n")
  writeFileSync(path.join(root, "new.txt"), "untracked\n")
  const snapshot = observeGit(root)
  const target = observeReviewTarget(root, snapshot)
  expect(fingerprintAt(snapshot)).toEqual(target)
  const assertDrift = () => {
    const current = observeGit(root)
    expect(current.paths).toEqual(snapshot.paths)
    expect(() => requireReviewTarget(fingerprintAt(current), target)).toThrow("Review target changed")
  }
  writeFileSync(path.join(root, "old.txt"), "different!!\n")
  assertDrift()
  writeFileSync(path.join(root, "old.txt"), "implemented\n")
  writeFileSync(path.join(root, "new.txt"), "different\n")
  assertDrift()
  writeFileSync(path.join(root, "new.txt"), "untracked\n")
  git(root, "add", "old.txt")
  assertDrift() // Identical worktree bytes, different index content.
  expect(git(root, "status", "--porcelain")).toContain("old.txt")
})

test("review fingerprint detects tracked bytes hidden from diff, mode/type/deletion changes and rejects widening/HEAD changes", () => {
  const root = fixture()
  const snapshot = observeGit(root)
  const target = observeReviewTarget(root, snapshot)
  git(root, "update-index", "--assume-unchanged", "old.txt")
  writeFileSync(path.join(root, "old.txt"), "hidden change\n")
  const hidden = observeGit(root)
  expect(hidden.paths).toEqual([])
  expect(() => requireReviewTarget(fingerprintAt(hidden), target)).toThrow()
  git(root, "update-index", "--no-assume-unchanged", "old.txt")
  writeFileSync(path.join(root, "old.txt"), "changed\n")
  const changed = observeGit(root)
  const changedTarget = fingerprintAt(changed)
  chmodSync(path.join(root, "old.txt"), 0o755)
  expect(() => requireReviewTarget(fingerprintAt(changed), changedTarget)).toThrow()
  unlinkSync(path.join(root, "old.txt"))
  const deletion = fingerprintAt(changed)
  expect(deletion.digest).not.toBe(changedTarget.digest)
  symlinkSync("missing-one", path.join(root, "old.txt"))
  const link = fingerprintAt(changed)
  unlinkSync(path.join(root, "old.txt"))
  symlinkSync("missing-two", path.join(root, "old.txt"))
  expect(fingerprintAt(changed).digest).not.toBe(link.digest)
  writeFileSync(path.join(root, "outside.txt"), "outside")
  expect(() => observeReviewTarget(root, changed)).toThrow("Review target changed")
  git(root, "add", "-A")
  git(root, "commit", "-qm", "changed head")
  expect(() => observeReviewTarget(root, changed)).toThrow("Review target changed")
})

test("review target rejects unsupported Git entries and ambiguous file topology", () => {
  const root = fixture()
  const snapshot = observeGit(root)
  const head = git(root, "rev-parse", "HEAD")
  git(root, "update-index", "--add", "--cacheinfo", `160000,${head},module`)
  expect(() => observeReviewTarget(root, observeGit(root))).toThrow("Unsupported or ambiguous index")
  git(root, "reset", "-q", "HEAD")
  unlinkSync(path.join(root, "old.txt"))
  mkdirSync(path.join(root, "old.txt"))
  expect(() => observeReviewTarget(root, observeGit(root))).toThrow("Unsupported review worktree entry")
  expect(() => observeReviewTarget("/does-not-exist", snapshot)).toThrow()
})

test("complete-index proof commits a tiny reviewed edit with an unchanged tracked blob larger than 16 MiB", () => {
  const root = fixture()
  const asset = Buffer.alloc(17 * 1024 * 1024, 0x61)
  writeFileSync(path.join(root, "large.bin"), asset)
  writeFileSync(path.join(root, "duplicate.bin"), asset)
  git(root, "add", "large.bin", "duplicate.bin")
  git(root, "commit", "-qm", "Track large unchanged assets")
  const oid = git(root, "rev-parse", "HEAD:large.bin")
  expect(git(root, "rev-parse", "HEAD:duplicate.bin")).toBe(oid)
  expect(Number(git(root, "cat-file", "-s", oid))).toBeGreaterThan(16 * 1024 * 1024)
  writeFileSync(path.join(root, "old.txt"), "Tiny approved edit\n")
  const target = observeReviewTarget(root, observeGit(root))
  expect(target.paths).toEqual(["old.txt"])
  const owner = new CommitGit(target)
  expect(owner.execute({ operation: "prepare" }, () => {})).toContain('Complete reviewed paths prepared: ["old.txt"]')
  expect(git(root, "diff", "--cached", "--name-only")).toBe("old.txt")
  expect(git(root, "ls-files", "--stage")).toContain(`${oid} 0\tlarge.bin`)
  expect(git(root, "ls-files", "--stage")).toContain(`${oid} 0\tduplicate.bin`)
  const receipt = owner.execute({ operation: "commit", message: "Make tiny approved edit" }, () => {})
  expect(receipt).toContain("Commit succeeded")
  expect(receipt).toContain('Exact committed paths: ["old.txt"]')
  expect(owner.final()).toBe(receipt)
  expect(git(root, "rev-parse", "HEAD^")).toBe(target.head)
  expect(git(root, "rev-parse", "HEAD:large.bin")).toBe(oid)
  expect(git(root, "rev-parse", "HEAD:duplicate.bin")).toBe(oid)
  expect(git(root, "show", "HEAD:old.txt")).toBe("Tiny approved edit")
  expect(observeGit(root).paths).toEqual([])
})

test("complete-index preparation and final proof preserve SHA-256 Git object identities", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-sha256-")))
  roots.push(root)
  git(root, "init", "-q", "--object-format=sha256")
  git(root, "config", "user.name", "Primitive Test")
  git(root, "config", "user.email", "primitives@example.invalid")
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  git(root, "add", "old.txt")
  git(root, "commit", "-qm", "SHA-256 baseline")
  writeFileSync(path.join(root, "old.txt"), "approved SHA-256 change\n")
  const target = observeReviewTarget(root, observeGit(root))
  expect(target.head).toHaveLength(64)
  const owner = new CommitGit(target)
  owner.execute({ operation: "prepare" }, () => {})
  expect(owner.execute({ operation: "commit", message: "Implement SHA-256 change" }, () => {})).toContain(
    "Commit succeeded",
  )
  expect(owner.final()).toContain("Commit succeeded")
  expect(git(root, "rev-parse", "HEAD^")).toBe(target.head)
  expect(git(root, "show", "HEAD:old.txt")).toBe("approved SHA-256 change")
  expect(observeGit(root).paths).toEqual([])
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
      "body-terminator",
      "worktree-race",
      "large-header",
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

test("small staged blobs exceeding 16 MiB in aggregate are split by byte budget without retaining whole-index content", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-small-blobs-")))
  roots.push(root)
  const size = 900 * 1024
  const objects = Array.from({ length: 20 }, (_, index) => {
    const name = `file-${String(index).padStart(2, "0")}.bin`
    const bytes = Buffer.alloc(size, index)
    writeFileSync(path.join(root, name), bytes)
    return {
      name,
      fill: index,
      oid: (index + 10).toString(16).padStart(40, "0"),
      digest: createHash("sha256").update(bytes).digest("hex"),
    }
  })
  const names = objects.map(({ name }) => name),
    head = "1".repeat(40),
    tree = "b".repeat(40)
  const prepared = {
    target: { root, head, paths: names, digest: "a".repeat(64) },
    tree,
    names,
    entries: objects.map(({ name, digest }) => [name, "file", false, digest] as const),
  }
  let largestBatch = 0
  const readIDs: string[] = []
  const command = spyOn(childProcess, "execFileSync").mockImplementation((_file, argv = [], options = {}): any => {
    const args = argv as string[],
      operation = args.slice(args.indexOf("-C") + 2)
    if (operation[0] === "rev-parse")
      return Buffer.from(operation.includes("--show-toplevel") ? root + "\n" : head + "\n")
    if (operation[0] === "ls-files" && operation.includes("--stage"))
      return Buffer.from(objects.map(({ name, oid }) => `100644 ${oid} 0\t${name}\0`).join(""))
    if (operation[0] === "diff-index" && operation.includes(head)) return Buffer.from(names.join("\0") + "\0")
    if (operation[0] !== "cat-file") return Buffer.alloc(0)
    const ids = (options as any).input.toString("utf8").trimEnd().split("\n") as string[]
    const blobs = ids.map((id) => objects.find(({ oid }) => oid === id)!)
    if (operation[1] === "--batch-check") return Buffer.from(blobs.map(({ oid }) => `${oid} blob ${size}\n`).join(""))
    expect((options as any).stdio[1]).toBe("pipe")
    readIDs.push(...ids)
    const bytes = Buffer.concat(
      blobs.flatMap(({ oid, fill }) => [
        Buffer.from(`${oid} blob ${size}\n`),
        Buffer.alloc(size, fill),
        Buffer.from("\n"),
      ]),
    )
    largestBatch = Math.max(largestBatch, bytes.length)
    return bytes
  })
  try {
    expect(size * objects.length).toBeGreaterThan(16 * 1024 * 1024)
    expect(() => gitModule.requirePreparedCommit(prepared)).not.toThrow()
    expect(largestBatch).toBeLessThanOrEqual(1024 * 1024)
    expect(readIDs).toEqual(objects.map(({ oid }) => oid))
  } finally {
    command.mockRestore()
  }
})

test("approved worktree transitions through exact staged bytes/modes/deletions/symlinks to one verified commit", () => {
  const root = fixture()
  const head = observeGit(root).head
  unlinkSync(path.join(root, "old.txt"))
  writeFileSync(path.join(root, "new.txt"), "new approved executable\n")
  chmodSync(path.join(root, "new.txt"), 0o755)
  symlinkSync("new.txt", path.join(root, "link.txt"))
  const target = observeReviewTarget(root, observeGit(root))
  const owner = new CommitGit(target)
  owner.execute({ operation: "prepare" }, () => {})
  expect(() => requireReviewTarget(observeReviewTarget(root, observeGit(root)), target)).toThrow() // Staging changes original digest.
  expect(owner.execute({ operation: "staged" }, () => {})).toContain("new approved executable")
  expect(
    owner.execute(
      { operation: "commit", message: "Implement approved content\n\nLiteral --amend --no-verify $(touch nope)" },
      () => {},
    ),
  ).toContain("Commit succeeded")
  const final = observeGit(root)
  expect(final.paths).toEqual([])
  expect(final.head).not.toBe(head)
  expect(git(root, "rev-parse", "HEAD^")).toBe(head)
  expect(git(root, "show", "HEAD:new.txt")).toBe("new approved executable")
  expect(git(root, "show", "HEAD:link.txt")).toBe("new.txt")
  expect(git(root, "ls-tree", "HEAD")).toContain("100755")
  expect(git(root, "ls-tree", "HEAD")).not.toContain("old.txt")
  chmodSync(path.join(root, "new.txt"), 0o644)
  expect(owner.final()).toContain("did not reach a verified successful")
})

test("final settlement rejects a message-only external amend of the exact postflight commit", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const target = observeReviewTarget(root, observeGit(root))
  const owner = new CommitGit(target)
  owner.execute({ operation: "prepare" }, () => {})
  const receipt = owner.execute({ operation: "commit", message: "Implement approved content" }, () => {})
  const committed = git(root, "rev-parse", "HEAD")
  const tree = git(root, "rev-parse", "HEAD^{tree}")
  expect(receipt).toContain(`Commit succeeded.\nCommit: ${committed}`)
  expect(owner.final()).toBe(receipt)

  git(root, "commit", "--amend", "-qm", "Externally replace only the message")
  const replacement = git(root, "rev-parse", "HEAD")
  expect(replacement).not.toBe(committed)
  expect(git(root, "rev-parse", "HEAD^{tree}")).toBe(tree)
  expect(git(root, "rev-parse", "HEAD^")).toBe(target.head)
  const final = owner.final()
  expect(final).toContain("did not reach a verified successful terminal state")
  expect(final).toContain("history uncertain")
  expect(final).toContain(`Known HEAD: ${replacement}`)
  expect(final).toContain(`Known postflight commit: ${committed}`)
  expect(final).toContain('Known postflight subject: "Implement approved content"')
  expect(final).not.toContain("Commit succeeded")
  expect(owner.final()).toBe(final)
  expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
  expect(git(root, "rev-parse", "HEAD")).toBe(replacement)
  expect(git(root, "status", "--porcelain")).toBe("")
})

test("observed HEAD drift through status permanently retires Commit authority even after the approved HEAD is restored", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const target = observeReviewTarget(root, observeGit(root))
  const owner = new CommitGit(target)
  git(root, "commit", "--allow-empty", "-qm", "External empty commit")
  const external = git(root, "rev-parse", "HEAD")
  expect(external).not.toBe(target.head)
  expect(() => owner.execute({ operation: "status" }, () => {})).toThrow("HEAD changed")
  expect(owner.receipt).toContain(`Known HEAD: ${external}`)
  git(root, "reset", "--soft", target.head)
  requireReviewTarget(observeReviewTarget(root, target), target)
  expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("closed")
  expect(() => owner.execute({ operation: "commit", message: "Retry restored target" }, () => {})).toThrow("closed")
  expect(owner.final()).toContain("HEAD changed")
  expect(git(root, "rev-parse", "HEAD")).toBe(target.head)
  expect(git(root, "diff", "--cached", "--name-only")).toBe("")
})

test("closed preparation failure refreshes final HEAD/index/worktree facts without replacing its original reason", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const target = observeReviewTarget(root, observeGit(root))
  const owner = new CommitGit(target)
  writeFileSync(path.join(root, "old.txt"), "External content drift\n")
  expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("Review target changed")
  const original = owner.receipt!
  const reason = original.split("\n").find((line) => line.startsWith("Reason:"))!
  expect(original).toContain(`Known HEAD: ${target.head}`)
  expect(original).toContain("Final staged paths (NUL bytes, base64): (empty)")

  git(root, "commit", "--allow-empty", "-qm", "External HEAD drift during settlement")
  const external = git(root, "rev-parse", "HEAD")
  writeFileSync(path.join(root, "outside.txt"), "External staged content\n")
  git(root, "add", "outside.txt")
  const index = git(root, "ls-files", "--stage")
  const final = owner.final()
  expect(final).toContain(reason)
  expect(final).toContain(`Known HEAD: ${external}`)
  expect(final).not.toContain(`Known HEAD: ${target.head}`)
  expect(final).toContain('Final ordinary changed paths: ["old.txt","outside.txt"]')
  expect(final).toContain(`Final staged paths (NUL bytes, base64): ${Buffer.from("outside.txt\0").toString("base64")}`)
  expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("closed")
  expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("closed")
  expect(owner.final()).toContain(reason)
  expect(git(root, "rev-parse", "HEAD")).toBe(external)
  expect(git(root, "ls-files", "--stage")).toBe(index)
})

test("postflight commit facts survive an external reset to the approved parent as terminal history uncertainty", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const target = observeReviewTarget(root, observeGit(root))
  const owner = new CommitGit(target)
  owner.execute({ operation: "prepare" }, () => {})
  const subject = "Implement approved content"
  const receipt = owner.execute({ operation: "commit", message: subject }, () => {})
  const committed = git(root, "rev-parse", "HEAD")
  const tree = git(root, "rev-parse", "HEAD^{tree}")
  expect(receipt).toContain(`Commit succeeded.\nCommit: ${committed}\nSubject: ${JSON.stringify(subject)}`)
  git(root, "reset", "--soft", target.head)
  const index = git(root, "ls-files", "--stage")
  const final = owner.final()
  expect(final).toContain("did not reach a verified successful terminal state")
  expect(final).toContain("history uncertain")
  expect(final).toContain(`Known postflight commit: ${committed}`)
  expect(final).toContain(`Known postflight subject: ${JSON.stringify(subject)}`)
  expect(final).toContain(`Verified prepared approved tree at postflight: ${tree}`)
  expect(final).toContain(`Known HEAD: ${target.head}`)
  expect(final).toContain('Final ordinary changed paths: ["old.txt"]')
  expect(final).toContain(`Final staged paths (NUL bytes, base64): ${Buffer.from("old.txt\0").toString("base64")}`)
  expect(final).not.toContain("observed unchanged")
  expect(final).not.toContain("Commit succeeded")
  expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
  expect(owner.final()).toBe(final)
  expect(git(root, "rev-parse", "HEAD")).toBe(target.head)
  expect(git(root, "ls-files", "--stage")).toBe(index)
  expect(git(root, "cat-file", "-t", committed)).toBe("commit")
})

test("commit preparation rejects fresh drift, unrelated staged content, partial or substituted index, and changed HEAD", () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const target = observeReviewTarget(root, observeGit(root))
  writeFileSync(path.join(root, "outside.txt"), "outside\n")
  git(root, "add", "outside.txt")
  expect(() => gitModule.prepareCommit(target)).toThrow("Review target changed")
  git(root, "reset", "-q", "HEAD", "--", "outside.txt")
  unlinkSync(path.join(root, "outside.txt"))
  writeFileSync(path.join(root, "old.txt"), "drift\n")
  expect(() => gitModule.prepareCommit(target)).toThrow("Review target changed")
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  const prepared = gitModule.prepareCommit(target)
  git(root, "reset", "-q", "HEAD", "--", "old.txt")
  expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("Staged paths")
  writeFileSync(path.join(root, "old.txt"), "substituted\n")
  git(root, "add", "old.txt")
  writeFileSync(path.join(root, "old.txt"), "approved\n")
  git(root, "update-index", "--assume-unchanged", "old.txt")
  expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("staged content differs from approved")
  git(root, "update-index", "--no-assume-unchanged", "old.txt")
  git(root, "add", "old.txt")
  gitModule.requirePreparedCommit(prepared)
  git(root, "commit", "-qm", "External commit")
  expect(() => gitModule.requirePreparedCommit(prepared)).toThrow("HEAD changed")
})

for (const hook of ["reject", "modify", "ambiguous"] as const) {
  test(`real ${hook} hook is honored and remains terminal without cleanup or a second commit`, () => {
    const root = fixture()
    writeFileSync(path.join(root, "old.txt"), "approved\n")
    const target = observeReviewTarget(root, observeGit(root))
    const owner = new CommitGit(target)
    owner.execute({ operation: "prepare" }, () => {})
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
    const receipt = owner.execute({ operation: "commit", message: "Implement reviewed change" }, () => {})
    expect(receipt).toContain("did not reach a verified successful")
    const headAfter = observeGit(root).head
    expect(headAfter === target.head).toBe(hook === "reject")
    expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
    expect(observeGit(root).head).toBe(headAfter)
    if (hook === "reject") expect(git(root, "diff", "--cached", "--name-only")).toBe("old.txt")
    if (hook === "modify") expect(git(root, "show", "HEAD:old.txt")).toBe("hook modified")
  })
}
