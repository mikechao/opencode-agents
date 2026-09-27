import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, renameSync, symlinkSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import { assertLive, candidateFits, consumeIntent, grantIntent, runM1, type Generation } from "../src/m1/attempt.ts"
import { observeGit, requireFresh, requireInScope } from "../src/m1/git.ts"
import { candidateIntact, candidateMessage, makeCandidate, parseProposal } from "../src/m1/proposal.ts"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim()
}

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-agents-m1-"))
  roots.push(root)
  git(root, "init", "-q")
  git(root, "config", "user.name", "M1 Test")
  git(root, "config", "user.email", "m1@example.invalid")
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  git(root, "add", "old.txt")
  git(root, "commit", "-qm", "baseline")
  return root
}

test("proposal must preserve three exact fields and reject expanded scope", () => {
  const root = fixture()
  const text = JSON.stringify({ intent: "change", plan: "edit", files: ["old.txt", "new.txt"] })
  const proposal = parseProposal(text, root)
  expect(proposal.files).toEqual(["old.txt", "new.txt"])
  expect(Object.isFrozen(proposal.files)).toBe(true)
  symlinkSync(tmpdir(), path.join(root, "outside"))
  for (const files of [["old.txt", "old.txt"], ["../outside"], ["*.txt"], ["."], ["/tmp/file"], [".git/config"]]) {
    expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files }), root)).toThrow()
  }
  expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files: ["old.txt"], extra: true }), root)).toThrow()
  expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files: ["outside/file.txt"] }), root)).toThrow()
  expect(() => parseProposal("```json\n" + text + "\n```", root)).toThrow()
})

test("candidate binds proposal and one-use grant stays private to live generation", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, git(root, "rev-parse", "HEAD"))
  const generation: Generation = { revoked: false, busy: false }
  expect(candidateIntact(candidate)).toBe(true)
  expect(candidateMessage(candidate)).toContain(candidate.proposal.plan)
  expect(candidateFits(candidateMessage(candidate), 120, 50)).toBe(true)
  expect(candidateFits(candidateMessage(candidate), 40, 15)).toBe(false)
  expect(() => grantIntent(candidate, false, generation)).toThrow()
  expect(() => grantIntent(candidate, undefined, generation)).toThrow()
  const grant = grantIntent(candidate, true, generation)
  consumeIntent(grant, candidate, generation)
  expect(() => consumeIntent(grant, candidate, generation)).toThrow()
  generation.revoked = true
  expect(() => assertLive(generation)).toThrow()
  expect(() => grantIntent(candidate, true, generation)).toThrow()
})

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

function fakeContext(root: string, generation: Generation, options: {
  confirm?: boolean | undefined
  onConfirm?: () => void
  onImplement?: () => void
  extraInput?: boolean
} = {}) {
  const sessions = new Map<string, { prompt?: { id: string; text: string }; outcome?: string }>()
  const calls: { created: string[]; prompted: string[]; texts: string[]; permissions: unknown[] } = {
    created: [], prompted: [], texts: [], permissions: [],
  }
  let next = 0
  const context = {
    location: { directory: root },
    renderer: { terminalWidth: 120, terminalHeight: 50 },
    client: {
      session: {
        create: async (input: { permissions: unknown }) => {
          const id = `session-${++next}`
          calls.created.push(id)
          calls.permissions.push(input.permissions)
          sessions.set(id, {})
          return { id }
        },
        prompt: async (input: { sessionID: string; text: string }) => {
          calls.prompted.push(input.sessionID)
          calls.texts.push(input.text)
          const session = sessions.get(input.sessionID)!
          session.prompt = { id: `prompt-${next}`, text: input.text }
          if (next === 2) options.onImplement?.()
          return { id: session.prompt.id }
        },
        wait: async () => undefined,
        get: async ({ sessionID }: { sessionID: string }) => ({ id: sessionID, agent: "general", outcome: "succeeded" }),
      },
      message: {
        list: async ({ sessionID }: { sessionID: string }) => {
          const session = sessions.get(sessionID)!
          return {
            data: [
              { type: "user", id: session.prompt!.id, text: session.prompt!.text },
              ...(options.extraInput ? [{ type: "user", id: "unexpected", text: "another input" }] : []),
              { type: "assistant", id: `answer-${sessionID}`, agent: "general", finish: "stop", content: [{ type: "text", text: sessionID === "session-1"
                ? JSON.stringify({ intent: "Change old file", plan: "Update its contents", files: ["old.txt"] })
                : "Done" }] },
            ],
            cursor: {},
          }
        },
      },
    },
    ui: { dialog: { confirm: async () => { options.onConfirm?.(); return options.confirm }, set: () => undefined } },
  } as unknown as Context
  return { context, calls }
}

test("one confirmed request admits one fresh Implementer and checks its resulting path", async () => {
  const root = fixture()
  const generation: Generation = { revoked: false, busy: false }
  const { context, calls } = fakeContext(root, generation, {
    confirm: true,
    onImplement: () => writeFileSync(path.join(root, "old.txt"), "implemented\n"),
  })
  expect(await runM1(context, generation, "Change the file")).toStartWith("M1 PASS")
  expect(calls.created).toEqual(["session-1", "session-2"])
  expect(calls.prompted).toEqual(["session-1", "session-2"])
  expect(calls.texts[1]).toContain("Modify only its exact authorized repository paths")
  expect(calls.texts[1]).toContain("Do not intentionally manipulate Git configuration, index metadata, ignore rules")
  expect(JSON.stringify(calls.permissions)).toContain("git commit")
})

test("dismissal, stale worktree, and late revocation never admit Implementer", async () => {
  for (const scenario of ["dismiss", "stale", "revoked"] as const) {
    const root = fixture()
    const generation: Generation = { revoked: false, busy: false }
    const { context, calls } = fakeContext(root, generation, {
      confirm: scenario === "dismiss" ? undefined : true,
      onConfirm: () => {
        if (scenario === "stale") writeFileSync(path.join(root, "old.txt"), "changed during confirmation")
        if (scenario === "revoked") generation.revoked = true
      },
    })
    await expect(runM1(context, generation, "Change the file")).rejects.toThrow()
    expect(calls.prompted).toEqual(["session-1"])
  }
})

test("dirty initial worktree stops before creating Planner", async () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "already dirty")
  const generation: Generation = { revoked: false, busy: false }
  const { context, calls } = fakeContext(root, generation)
  await expect(runM1(context, generation, "Change the file")).rejects.toThrow("clean initial")
  expect(calls.created).toEqual([])
})

test("extra role input, out-of-scope delta, and changed HEAD cannot pass", async () => {
  for (const scenario of ["extra-input", "out-of-scope", "changed-head"] as const) {
    const root = fixture()
    const generation: Generation = { revoked: false, busy: false }
    const { context, calls } = fakeContext(root, generation, {
      confirm: true,
      extraInput: scenario === "extra-input",
      onImplement: () => {
        if (scenario === "out-of-scope") writeFileSync(path.join(root, "other.txt"), "not authorized")
        if (scenario === "changed-head") {
          writeFileSync(path.join(root, "old.txt"), "committed")
          git(root, "add", "old.txt")
          git(root, "commit", "-qm", "unexpected head")
        }
      },
    })
    await expect(runM1(context, generation, "Change the file")).rejects.toThrow()
    expect(calls.prompted).toHaveLength(scenario === "extra-input" ? 1 : 2)
  }
})
