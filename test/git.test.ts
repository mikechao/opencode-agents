import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { observeGit, requireFresh, requireInScope } from "../src/git.ts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim()
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-agents-primitives-"))
  roots.push(root)
  git(root, "init", "-q")
  git(root, "config", "user.name", "Primitive Test")
  git(root, "config", "user.email", "primitives@example.invalid")
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  git(root, "add", "old.txt")
  git(root, "commit", "-qm", "baseline")
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
  expect(new Set(observeGit(root).paths)).toEqual(new Set(["old.txt", "new.txt"]))
  expect(() => requireFresh(observeGit(root), baseline)).toThrow()
  expect(() => requireInScope(observeGit(root), baseline, ["old.txt"])).toThrow()
  expect(requireInScope(observeGit(root), baseline, ["old.txt", "new.txt"])).toHaveLength(2)
  unlinkSync(path.join(root, "new.txt"))
  git(root, "reset", "-q", "--hard", "HEAD")
  unlinkSync(path.join(root, "old.txt"))
  expect(observeGit(root).paths).toEqual(["old.txt"])
  git(root, "reset", "-q", "--hard", "HEAD")
  renameSync(path.join(root, "old.txt"), path.join(root, "new.txt"))
  git(root, "add", "-A")
  expect(new Set(observeGit(root).paths)).toEqual(new Set(["old.txt", "new.txt"]))
  expect(() => requireInScope(observeGit(root), baseline, ["new.txt"])).toThrow()
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
  expect(observeGit(root).paths).toEqual([])
  expect(() => requireFresh(observeGit(root), baseline)).not.toThrow()
  writeFileSync(path.join(root, "visible.txt"), "visible")
  expect(observeGit(root).paths).toEqual(["visible.txt"])
})

test("scope uses exact path equality and observation requires the worktree root", () => {
  const root = fixture()
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "old.txt.bak"), "different path")
  expect(observeGit(root).paths).toEqual(["old.txt.bak"])
  expect(() => requireInScope(observeGit(root), baseline, ["old.txt"])).toThrow("old.txt.bak")
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
  const root = fixture()
  const baseline = observeGit(root)
  for (const substituted of [{ ...baseline, root: baseline.root + "/other" }, { ...baseline, head: "0".repeat(40) }]) {
    expect(() => requireFresh(substituted, baseline)).toThrow()
    expect(() => requireInScope(substituted, baseline, [])).toThrow()
  }
  expect(() => requireFresh(baseline, baseline)).not.toThrow()
  expect(requireInScope(baseline, baseline, [])).toEqual([])
})
