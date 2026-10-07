import * as childProcess from "node:child_process"
import { expect, spyOn, test } from "bun:test"
import { CommitGit, decodeCommitterInput } from "../src/committer-git.ts"
import * as git from "../src/git.ts"

const target = Object.freeze({
  root: "/trusted/root",
  head: "1".repeat(40),
  paths: ["old.txt"],
  digest: "a".repeat(64),
})
const prepared = { target, tree: "b".repeat(40), names: ["old.txt"], entries: [] }

test("structured Committer surface rejects commands, arbitrary paths, flags, environment and message controls", () => {
  for (const operation of [
    "shell",
    "add",
    "amend",
    "push",
    "rebase",
    "reset",
    "checkout",
    "switch",
    "restore",
    "stash",
    "clean",
    "add -p",
    "--no-verify",
  ])
    expect(() => decodeCommitterInput({ operation })).toThrow()
  for (const extra of [
    { paths: ["other.txt"] },
    { flags: ["--amend"] },
    { environment: { GIT_INDEX_FILE: "other" } },
    { directory: "/other" },
    { command: "git commit" },
    { background: true },
  ])
    expect(() => decodeCommitterInput({ operation: "prepare", ...extra })).toThrow()
  for (const message of ["", "\nbody", "bad\0message", "bad\rmessage", "bad\x1bmessage"])
    expect(() => decodeCommitterInput({ operation: "commit", message })).toThrow()
  expect(decodeCommitterInput({ operation: "commit", message: "--amend $(touch nope)\n\nLiteral body" })).toEqual({
    operation: "commit",
    message: "--amend $(touch nope)\n\nLiteral body",
  })
})

test("one-shot pre-spawn spending and postflight inspection survive success, hook failure, and ambiguous mutation", () => {
  for (const outcome of ["success", "hook-failure", "ambiguous", "hook-mutated"] as const) {
    const filters = spyOn(git, "requireNoCommitFilters").mockImplementation(() => {})
    const preparing = spyOn(git, "prepareCommit").mockReturnValue(prepared)
    const gate = spyOn(git, "requirePreparedCommit").mockImplementation(() => {})
    const observed = spyOn(git, "observeGit").mockReturnValue({ ...target, paths: [] })
    const verify = spyOn(git, "verifyCommitted").mockImplementation(() => {
      if (outcome === "hook-failure" || outcome === "hook-mutated") throw new Error("Unexpected final state")
      return { root: target.root, head: "2".repeat(40), paths: [], subject: "Implement change" }
    })
    let attempts = 0
    const command = spyOn(git, "trustedGit").mockImplementation((_root, args) => {
      if (args[0] === "commit") {
        attempts++
        // Reentrant entry at the process boundary observes already-spent state.
        expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
        expect(args).toEqual(["commit", "--cleanup=verbatim", "-m", "Implement change"])
        if (outcome === "hook-failure" || outcome === "ambiguous") throw new Error("Commit failed")
      }
      return Buffer.alloc(0)
    })
    const owner = new CommitGit(target)
    try {
      expect(() => new CommitGit(target).execute({ operation: "commit", message: "Premature" }, () => {})).toThrow(
        "requires",
      )
      owner.execute({ operation: "prepare" }, () => {})
      const receipt = owner.execute({ operation: "commit", message: "Implement change" }, () => {})
      expect(receipt).toContain(outcome === "success" ? "Commit succeeded" : "did not reach a verified successful")
      expect(verify).toHaveBeenCalledTimes(1)
      expect(attempts).toBe(1)
      expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("spent")
      expect(() => owner.execute({ operation: "commit", message: "Again" }, () => {})).toThrow("spent")
      expect(owner.execute({ operation: "result" }, () => {})).toBe(receipt)
      expect(attempts).toBe(1)
    } finally {
      filters.mockRestore()
      preparing.mockRestore()
      gate.mockRestore()
      observed.mockRestore()
      verify.mockRestore()
      command.mockRestore()
    }
  }
})

test("lost live authority or final content proof blocks the commit process", () => {
  const filters = spyOn(git, "requireNoCommitFilters").mockImplementation(() => {})
  const preparing = spyOn(git, "prepareCommit").mockReturnValue(prepared)
  const proof = spyOn(git, "requirePreparedCommit").mockImplementation(() => {})
  const command = spyOn(git, "trustedGit")
  try {
    const owner = new CommitGit(target)
    owner.execute({ operation: "prepare" }, () => {})
    let checks = 0
    expect(() =>
      owner.execute({ operation: "commit", message: "Change" }, () => {
        if (++checks === 2) throw new Error("Owner revoked")
      }),
    ).toThrow("revoked")
    expect(command.mock.calls.filter(([, args]) => args[0] === "commit")).toHaveLength(0)
    const next = new CommitGit(target)
    next.execute({ operation: "prepare" }, () => {})
    proof.mockImplementation(() => {
      throw new Error("Staged bytes changed")
    })
    expect(() => next.execute({ operation: "commit", message: "Change" }, () => {})).toThrow("bytes changed")
    expect(command.mock.calls.filter(([, args]) => args[0] === "commit")).toHaveLength(0)
  } finally {
    filters.mockRestore()
    preparing.mockRestore()
    proof.mockRestore()
    command.mockRestore()
  }
})

test("trusted Git runner isolates inherited repository/index/environment overrides and never uses a shell", () => {
  const command = spyOn(childProcess, "execFileSync").mockReturnValue(Buffer.from("trusted"))
  const inherited = process.env.GIT_INDEX_FILE
  process.env.GIT_INDEX_FILE = "/untrusted/alternate-index"
  try {
    expect(git.trustedGit("/trusted/root", ["commit", "--cleanup=verbatim", "-m", "--amend $(touch nope)"])).toEqual(
      Buffer.from("trusted"),
    )
    expect(command.mock.calls[0]![0]).toBe("/usr/bin/git")
    const options = command.mock.calls[0]![2] as any
    expect(options.shell).toBe(false)
    expect(options.env.GIT_INDEX_FILE).toBeUndefined()
    expect(options.env.GIT_DIR).toBeUndefined()
    expect(options.env.GIT_WORK_TREE).toBeUndefined()
    expect(options.env.GIT_CONFIG_COUNT).toBeUndefined()
    expect(options.env.DYLD_INSERT_LIBRARIES).toBeUndefined()
    expect(options.env.HOME).toBe(process.env.HOME)
    expect(options.env.PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin")
    expect(command.mock.calls[0]![1]).not.toContain("core.hooksPath=/dev/null")
  } finally {
    if (inherited === undefined) delete process.env.GIT_INDEX_FILE
    else process.env.GIT_INDEX_FILE = inherited
    command.mockRestore()
  }
})
