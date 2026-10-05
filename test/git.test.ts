import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import { execFileSync } from "node:child_process"
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
