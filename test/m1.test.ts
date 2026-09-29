import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import { type Generation } from "../src/cap.ts"
import { runM1 } from "../src/m1/attempt.ts"

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

function fakeContext(root: string, generation: Generation, options: {
  confirm?: boolean | undefined
  onConfirm?: () => void
  onImplement?: () => void
  extraInput?: boolean
  selectedModel?: { providerID: string; modelID: string; variant?: string } | null
} = {}) {
  const sessions = new Map<string, { prompt?: { id: string; text: string }; outcome?: string }>()
  const calls: {
    created: string[]
    prompted: string[]
    texts: string[]
    permissions: unknown[]
    models: Array<{ providerID: string; id: string; variant?: string } | undefined>
  } = {
    created: [], prompted: [], texts: [], permissions: [], models: [],
  }
  let next = 0
  let modelReads = 0
  const context = {
    location: { directory: root },
    renderer: { terminalWidth: 120, terminalHeight: 50 },
    client: {
      session: {
        create: async (input: { permissions: unknown; model?: { providerID: string; id: string; variant?: string } }) => {
          const id = `session-${++next}`
          calls.created.push(id)
          calls.permissions.push(input.permissions)
          calls.models.push(input.model)
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
    ui: {
      model: {
        current: () => {
          modelReads++
          return options.selectedModel === null
            ? undefined
            : options.selectedModel ?? { providerID: "test-provider", modelID: "test-model", variant: "high" }
        },
      },
      dialog: { confirm: async () => { options.onConfirm?.(); return options.confirm }, set: () => undefined },
    },
  } as unknown as Context
  return { context, calls, modelReads: () => modelReads }
}

test("one confirmed request admits one fresh Implementer and checks its resulting path", async () => {
  const root = fixture()
  const generation: Generation = { revoked: false, busy: false }
  const { context, calls, modelReads } = fakeContext(root, generation, {
    confirm: true,
    onImplement: () => writeFileSync(path.join(root, "old.txt"), "implemented\n"),
  })
  expect(await runM1(context, generation, "Change the file")).toStartWith("M1 PASS")
  expect(modelReads()).toBe(1)
  expect(calls.created).toEqual(["session-1", "session-2"])
  expect(calls.models).toEqual([
    { providerID: "test-provider", id: "test-model", variant: "high" },
    { providerID: "test-provider", id: "test-model", variant: "high" },
  ])
  expect(calls.models[0]).toBe(calls.models[1])
  expect(calls.prompted).toEqual(["session-1", "session-2"])
  expect(calls.texts[1]).toContain("Modify only its exact authorized repository paths")
  expect(calls.texts[1]).toContain("Do not intentionally manipulate Git configuration, index metadata, ignore rules")
  expect(JSON.stringify(calls.permissions)).toContain("git commit")
})

test("no selected TUI model stops before creating Planner", async () => {
  const root = fixture()
  const generation: Generation = { revoked: false, busy: false }
  const { context, calls, modelReads } = fakeContext(root, generation, { selectedModel: null })
  await expect(runM1(context, generation, "Change the file")).rejects.toThrow("selected TUI model")
  expect(modelReads()).toBe(1)
  expect(calls.created).toEqual([])
  expect(calls.prompted).toEqual([])
})

test("selected model without a variant omits variant from Planner session", async () => {
  const root = fixture()
  const generation: Generation = { revoked: false, busy: false }
  const { context, calls, modelReads } = fakeContext(root, generation, {
    selectedModel: { providerID: "test-provider", modelID: "test-model" },
  })
  await expect(runM1(context, generation, "Change the file")).rejects.toThrow(/authorization was cancelled/i)
  expect(modelReads()).toBe(1)
  expect(calls.models).toEqual([{ providerID: "test-provider", id: "test-model" }])
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
