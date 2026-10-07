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

test("live inspections validate the approved or prepared target and permanently retire observed drift; fixed history does not", () => {
  const filters = spyOn(git, "requireNoCommitFilters").mockImplementation(() => {})
  const preparing = spyOn(git, "prepareCommit").mockReturnValue(prepared)
  const observed = spyOn(git, "observeGit").mockReturnValue(target)
  const reviewed = spyOn(git, "observeReviewTarget").mockReturnValue(target)
  const staged = spyOn(git, "requirePreparedCommit").mockImplementation(() => {})
  const command = spyOn(git, "trustedGit").mockReturnValue(Buffer.from("Trusted inspection"))
  try {
    for (const state of ["unprepared", "prepared"] as const) {
      for (const operation of state === "prepared" ? ["status", "diff", "staged"] : ["status", "diff"]) {
        reviewed.mockReturnValue(target)
        staged.mockImplementation(() => {})
        const owner = new CommitGit(target)
        if (state === "prepared") owner.execute({ operation: "prepare" }, () => {})
        const before = state === "prepared" ? staged.mock.calls.length : reviewed.mock.calls.length
        const inspected = owner.execute({ operation }, () => {})
        expect(inspected).toContain(operation === "status" ? target.head : "Trusted inspection")
        const after = state === "prepared" ? staged.mock.calls.length : reviewed.mock.calls.length
        expect(after - before).toBe(operation === "status" ? 1 : 2)
        if (state === "prepared") expect(staged).toHaveBeenLastCalledWith(prepared)
        else expect(reviewed).toHaveBeenLastCalledWith(target.root, target)

        if (state === "prepared")
          staged.mockImplementation(() => {
            throw new Error("Prepared target drift")
          })
        else
          reviewed.mockImplementation(() => {
            throw new Error("Approved target drift")
          })
        // Explicitly pinned historical reads observe no live target. They remain
        // available until a live operation actually detects incompatible state.
        const reads = reviewed.mock.calls.length + staged.mock.calls.length
        expect(owner.execute({ operation: "history" }, () => {})).toBe("Trusted inspection")
        expect(command.mock.calls.at(-1)?.[1]).toContain(target.head)
        expect(reviewed.mock.calls.length + staged.mock.calls.length).toBe(reads)
        expect(() => owner.execute({ operation }, () => {})).toThrow("target drift")
        reviewed.mockReturnValue(target)
        staged.mockImplementation(() => {})
        expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("closed")
        expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("closed")
        expect(owner.final()).toContain(`${state === "prepared" ? "Prepared" : "Approved"} target drift`)
      }
    }
    expect(command.mock.calls.some(([, args]) => args[0] === "commit")).toBe(false)
  } finally {
    filters.mockRestore()
    preparing.mockRestore()
    observed.mockRestore()
    reviewed.mockRestore()
    staged.mockRestore()
    command.mockRestore()
  }
})

test("staged inspection brackets the fixed diff command with content proofs and closes on intervening drift", () => {
  const filters = spyOn(git, "requireNoCommitFilters").mockImplementation(() => {})
  const preparing = spyOn(git, "prepareCommit").mockReturnValue(prepared)
  let changed = false
  const proof = spyOn(git, "requirePreparedCommit").mockImplementation(() => {
    if (changed) throw new Error("Prepared content changed during staged inspection")
  })
  const observed = spyOn(git, "observeGit").mockReturnValue(target)
  const command = spyOn(git, "trustedGit").mockImplementation((_root, args) => {
    if (args[0] === "diff") {
      expect(proof).toHaveBeenCalledTimes(1)
      expect(args).toEqual([
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-color",
        target.head,
        "--",
        ...target.paths,
      ])
      changed = true
      return Buffer.from("Drifting diff must not be returned")
    }
    if (args[0] === "rev-parse") return Buffer.from(target.head)
    if (args[0] === "diff-index") return Buffer.from("old.txt\0")
    throw new Error(`Unexpected inspection command: ${args.join(" ")}`)
  })
  try {
    const owner = new CommitGit(target)
    owner.execute({ operation: "prepare" }, () => {})
    expect(() => owner.execute({ operation: "staged" }, () => {})).toThrow("changed during staged inspection")
    expect(proof).toHaveBeenCalledTimes(2)
    changed = false
    expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("closed")
    expect(command.mock.calls.some(([, args]) => args[0] === "commit")).toBe(false)
    expect(owner.final()).toContain("changed during staged inspection")
  } finally {
    filters.mockRestore()
    preparing.mockRestore()
    proof.mockRestore()
    observed.mockRestore()
    command.mockRestore()
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

// Settlement assertions concern activation-local state and receipt binding. Real
// content/history proofs and hook execution belong to git.test.ts; these doubles
// expose each trusted observation explicitly without replaying preparation.
function settlement(
  run: (facts: {
    owner: CommitGit
    head: string
    paths: string[]
    staged: string[]
    drift: boolean
    attempts: number
    proofs: number
  }) => void,
) {
  const facts = {
    owner: new CommitGit(target),
    head: target.head,
    paths: [...target.paths],
    staged: [] as string[],
    drift: false,
    attempts: 0,
    proofs: 0,
  }
  const subject = "Implement approved content"
  const filters = spyOn(git, "requireNoCommitFilters").mockImplementation(() => {})
  const preparing = spyOn(git, "prepareCommit").mockImplementation(() => {
    if (facts.drift) throw new Error("Review target changed")
    facts.staged = [...target.paths]
    return prepared
  })
  const proof = spyOn(git, "requirePreparedCommit").mockImplementation(() => {})
  const observed = spyOn(git, "observeGit").mockImplementation((_root, baseline) => {
    if (baseline && facts.head !== baseline.head) throw new Error("HEAD changed before Git observation")
    return { root: target.root, head: facts.head, paths: [...facts.paths] }
  })
  const verify = spyOn(git, "verifyCommitted").mockImplementation(() => {
    facts.proofs++
    if (facts.head === target.head || facts.paths.length) throw new Error("Unexpected final HEAD/worktree state")
    return { root: target.root, head: facts.head, paths: [], subject }
  })
  const command = spyOn(git, "trustedGit").mockImplementation((_root, args) => {
    if (args[0] === "commit") {
      facts.attempts++
      facts.head = "2".repeat(40)
      facts.paths = []
      facts.staged = []
      return Buffer.alloc(0)
    }
    if (args[0] === "rev-parse") return Buffer.from(facts.head + "\n")
    if (args[0] === "diff-index") return Buffer.from(facts.staged.map((name) => name + "\0").join(""))
    throw new Error(`Unexpected settlement command: ${args.join(" ")}`)
  })
  try {
    run(facts)
  } finally {
    filters.mockRestore()
    preparing.mockRestore()
    proof.mockRestore()
    observed.mockRestore()
    verify.mockRestore()
    command.mockRestore()
  }
}

test("final settlement rejects a message-only external amend of the exact postflight commit", () => {
  settlement((facts) => {
    const { owner } = facts
    owner.execute({ operation: "prepare" }, () => {})
    const receipt = owner.execute({ operation: "commit", message: "Implement approved content" }, () => {})
    const committed = facts.head
    expect(receipt).toContain(`Commit succeeded.\nCommit: ${committed}`)
    expect(owner.final()).toBe(receipt)
    // The lower-level verifier accepts an identical approved tree/parent under
    // a new commit identity. Final must additionally bind the postflight HEAD.
    facts.head = "3".repeat(40)
    const final = owner.final()
    expect(final).toContain("did not reach a verified successful terminal state")
    expect(final).toContain("history uncertain")
    expect(final).toContain(`Known HEAD: ${facts.head}`)
    expect(final).toContain(`Known postflight commit: ${committed}`)
    expect(final).toContain('Known postflight subject: "Implement approved content"')
    expect(final).not.toContain("Commit succeeded")
    expect(owner.final()).toBe(final)
    expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
    expect(facts.attempts).toBe(1)
    expect(facts.head).toBe("3".repeat(40))
    expect(facts.paths).toEqual([])
    expect(facts.proofs).toBe(4)
  })
})

test("observed HEAD drift through status permanently retires Commit authority even after the approved HEAD is restored", () => {
  settlement((facts) => {
    const { owner } = facts
    facts.head = "3".repeat(40)
    expect(() => owner.execute({ operation: "status" }, () => {})).toThrow("HEAD changed")
    expect(owner.receipt).toContain(`Known HEAD: ${facts.head}`)
    facts.head = target.head
    expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("closed")
    expect(() => owner.execute({ operation: "commit", message: "Retry restored target" }, () => {})).toThrow("closed")
    expect(owner.final()).toContain("HEAD changed")
    expect(facts.head).toBe(target.head)
    expect(facts.staged).toEqual([])
    expect(facts.attempts).toBe(0)
  })
})

test("closed preparation failure refreshes final HEAD/index/worktree facts without replacing its original reason", () => {
  settlement((facts) => {
    const { owner } = facts
    facts.drift = true
    expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("Review target changed")
    const original = owner.receipt!
    const reason = original.split("\n").find((line) => line.startsWith("Reason:"))!
    expect(original).toContain(`Known HEAD: ${target.head}`)
    expect(original).toContain("Final staged paths (NUL bytes, base64): (empty)")
    facts.head = "3".repeat(40)
    facts.paths = ["old.txt", "outside.txt"]
    facts.staged = ["outside.txt"]
    const final = owner.final()
    expect(final).toContain(reason)
    expect(final).toContain(`Known HEAD: ${facts.head}`)
    expect(final).not.toContain(`Known HEAD: ${target.head}`)
    expect(final).toContain('Final ordinary changed paths: ["old.txt","outside.txt"]')
    expect(final).toContain(
      `Final staged paths (NUL bytes, base64): ${Buffer.from("outside.txt\0").toString("base64")}`,
    )
    expect(() => owner.execute({ operation: "prepare" }, () => {})).toThrow("closed")
    expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("closed")
    expect(owner.final()).toContain(reason)
    expect(facts.head).toBe("3".repeat(40))
    expect(facts.staged).toEqual(["outside.txt"])
    expect(facts.attempts).toBe(0)
  })
})

test("postflight commit facts survive an external reset to the approved parent as terminal history uncertainty", () => {
  settlement((facts) => {
    const { owner } = facts
    owner.execute({ operation: "prepare" }, () => {})
    const subject = "Implement approved content"
    const receipt = owner.execute({ operation: "commit", message: subject }, () => {})
    const committed = facts.head
    expect(receipt).toContain(`Commit succeeded.\nCommit: ${committed}\nSubject: ${JSON.stringify(subject)}`)
    facts.head = target.head
    facts.paths = ["old.txt"]
    facts.staged = ["old.txt"]
    const final = owner.final()
    expect(final).toContain("did not reach a verified successful terminal state")
    expect(final).toContain("history uncertain")
    expect(final).toContain(`Known postflight commit: ${committed}`)
    expect(final).toContain(`Known postflight subject: ${JSON.stringify(subject)}`)
    expect(final).toContain(`Verified prepared approved tree at postflight: ${prepared.tree}`)
    expect(final).toContain(`Known HEAD: ${target.head}`)
    expect(final).toContain('Final ordinary changed paths: ["old.txt"]')
    expect(final).toContain(`Final staged paths (NUL bytes, base64): ${Buffer.from("old.txt\0").toString("base64")}`)
    expect(final).not.toContain("observed unchanged")
    expect(final).not.toContain("Commit succeeded")
    expect(() => owner.execute({ operation: "commit", message: "Retry" }, () => {})).toThrow("spent")
    expect(owner.final()).toBe(final)
    expect(facts.head).toBe(target.head)
    expect(facts.staged).toEqual(["old.txt"])
    expect(facts.attempts).toBe(1)
  })
})
