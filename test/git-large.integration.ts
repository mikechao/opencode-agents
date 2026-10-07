// Intentionally uses .integration.ts: Bun's automatic discovery excludes this
// file. Run both real size-threshold proofs with bun run test:large-git.
import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { cpSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { CommitGit } from "../src/committer-git.ts"
import { observeGit, observeReviewTarget, prepareCommit } from "../src/git.ts"

const roots: string[] = []
let seed: string
function git(root: string, ...args: string[]): string {
  return childProcess.execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8" }).trim()
}
beforeAll(() => {
  seed = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-large-git-seed-")))
  git(seed, "init", "-q")
  git(seed, "config", "user.name", "Large Git Test")
  git(seed, "config", "user.email", "large-git@example.invalid")
  writeFileSync(path.join(seed, "old.txt"), "initial\n")
  git(seed, "add", "old.txt")
  git(seed, "commit", "-qm", "baseline")
})
afterAll(() => rmSync(seed, { recursive: true, force: true }))
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function fixture(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-large-git-")))
  roots.push(root)
  cpSync(seed, root, { recursive: true, preserveTimestamps: true })
  git(root, "update-index", "--refresh")
  return root
}

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
}, 30_000)

test("small staged blobs exceeding 16 MiB in aggregate are split by byte budget without retaining whole-index content", () => {
  const root = fixture()
  const size = 900 * 1024
  const names = Array.from({ length: 20 }, (_, index) => {
    const name = `file-${String(index).padStart(2, "0")}.bin`
    writeFileSync(path.join(root, name), Buffer.alloc(size, index))
    return name
  })
  expect(size * names.length).toBeGreaterThan(16 * 1024 * 1024)
  const target = observeReviewTarget(root, observeGit(root))
  expect(target.paths).toEqual(names)
  const execute = childProcess.execFileSync
  const metadataIDs: string[] = [],
    readIDs: string[] = [],
    batchSizes: number[] = []
  // Observe real Git requests/responses without changing argv, environment,
  // limits, output destinations or freshness checks.
  const command = spyOn(childProcess, "execFileSync").mockImplementation((file, argv = [], options = {}): any => {
    const result = execute(file, argv as string[], options as any)
    const args = argv as string[]
    if (args.includes("cat-file")) {
      const ids = (options as any).input.toString("utf8").trimEnd().split("\n") as string[]
      if (args.includes("--batch-check")) metadataIDs.push(...ids)
      else {
        expect((options as any).stdio[1]).toBe("pipe")
        readIDs.push(...ids)
        expect(Buffer.isBuffer(result)).toBe(true)
        batchSizes.push(Buffer.byteLength(result))
      }
    }
    return result
  })
  try {
    const prepared = prepareCommit(target)
    expect(prepared.names).toEqual([...names, "old.txt"])
    expect(prepared.entries).toHaveLength(names.length + 1)
    const expectedIDs = git(root, "ls-files", "--stage")
      .split("\n")
      .map((record) => record.split(" ")[1]!)
    expect(metadataIDs).toEqual([...new Set(expectedIDs)])
    expect(readIDs).toEqual(metadataIDs)
    expect(batchSizes.length).toBeGreaterThan(1)
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(1024 * 1024)
    expect(git(root, "diff", "--cached", "--name-only").split("\n")).toEqual(names)
  } finally {
    command.mockRestore()
  }
}, 30_000)
