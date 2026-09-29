import { afterEach, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import { implementerPrompt, type Generation } from "../src/m1/attempt.ts"
import { observeGit } from "../src/m1/git.ts"
import { makeCandidate, parseProposal, candidateMessage, renderPlan } from "../src/m1/proposal.ts"
import { plannerInput, publishM2PlanDogfood, runM2, SLOT_PROMPT } from "../src/m2/attempt.ts"
import plugin from "../.opencode/plugins/opencode-agents/tui.ts"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function git(root: string, ...args: string[]) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim() }
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "opencode-agents-m2-"))
  roots.push(root)
  git(root, "init", "-q")
  git(root, "config", "user.name", "M2 Test")
  git(root, "config", "user.email", "m2@example.invalid")
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  git(root, "add", "old.txt")
  git(root, "commit", "-qm", "baseline")
  return root
}

const proposal = JSON.stringify({
  intent: "Change old file",
  plan: "Update its contents\nCheck the result",
  files: ["old.txt", "new.txt", "nested/three.txt"],
})
const request = "Change the file"
const prefix = "You are a subagent spawned by another session.\n"
const text = (value: string) => ({ type: "text", text: value })
const user = (id: string, value: string) => ({ type: "user", id, text: value, files: [], agents: [], skills: [] })
const answer = (id: string, agent: string, value: string) => ({ type: "assistant", id, agent, finish: "stop", content: [text(value)] })
const idle = (id: string) => ({ type: "idle", id, outcome: "succeeded" })
function call(id: string, agent: string, prompt: string, childID: string, result: string) {
  return { type: "tool", id, name: "subagent", state: {
    status: "completed", input: { agent, description: `${agent} work`, prompt }, metadata: { sessionID: childID, status: "completed" },
    content: [text(`<subagent sessionID="${childID}" state="completed">\n${result}\n</subagent>`)],
  } }
}
type FakeOptions = {
  rootActive?: boolean
  wakeOnSynthetic?: boolean
  confirm?: boolean
  onConfirm?: () => void
  onSwitch?: () => void
  onPrompt?: (value: string) => void
  onWait?: (sessionID: string) => void
  promptError?: boolean
  promptMismatch?: boolean
  promptIDMismatch?: boolean
}
function fake(root: string, options: FakeOptions = {}) {
  const generation: Generation = { revoked: false, busy: false }
  const histories: Record<string, any[]> = {
    parent: [user("parent-user", request),
      { type: "assistant", id: "planner-tool-message", agent: "opencode-agents", content: [call("planner-call", "planner", plannerInput(request), "planner-child", proposal)] },
      { type: "assistant", id: "slot-tool-message", agent: "opencode-agents", content: [call("slot-call", "implementer_slot", SLOT_PROMPT, "slot-child", "READY")] },
      answer("parent-final", "opencode-agents", "Ready for trusted handoff"), idle("parent-idle")],
    "planner-child": [user("planner-user", prefix + plannerInput(request)), answer("planner-final", "planner", proposal), idle("planner-idle")],
    "slot-child": [user("slot-user", prefix + SLOT_PROMPT), answer("slot-final", "implementer_slot", "READY"), idle("slot-idle")],
  }
  const sessions: Record<string, any> = {
    parent: { id: "parent", agent: "opencode-agents", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
    "planner-child": { id: "planner-child", parentID: "parent", agent: "planner", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
    "slot-child": { id: "slot-child", parentID: "parent", agent: "implementer_slot", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
  }
  const calls = { switched: [] as string[], prompted: [] as Array<{ sessionID: string; text: string }>, confirmed: [] as string[],
    synthetic: [] as Array<{ sessionID: string; text: string; description: string; metadata: { source: string; planHash: string }; resume: boolean }>, toasts: [] as string[] }
  const context = {
    location: { directory: root }, renderer: { terminalWidth: 120, terminalHeight: 60 },
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => sessions[sessionID],
        active: async () => options.rootActive || (options.wakeOnSynthetic && calls.synthetic.length > 0)
          ? { parent: { type: "running" } } : {},
        inbox: { list: async () => [] }, wait: async ({ sessionID }: { sessionID: string }) => { options.onWait?.(sessionID) },
        synthetic: async (input: { sessionID: string; text: string; description: string; metadata: { source: string; planHash: string }; resume: boolean }) => {
          calls.synthetic.push(input)
          return { id: "synthetic-plan", type: "synthetic", sessionID: input.sessionID,
            payload: { text: input.text, description: input.description } }
        },
        switchAgent: async ({ sessionID, agent }: { sessionID: string; agent: string }) => {
          calls.switched.push(sessionID)
          sessions[sessionID].agent = agent
          histories[sessionID].push({ type: "agent-switched", id: "switch", agent, previous: "implementer_slot" })
          options.onSwitch?.()
        },
        prompt: async ({ sessionID, text: value }: { sessionID: string; text: string }) => {
          calls.prompted.push({ sessionID, text: value })
          options.onPrompt?.(value)
          if (options.promptError) throw new Error("ambiguous prompt transport failure")
          histories[sessionID].push(user("trusted-input", value), answer("implementer-final", "authorized_implementer", "Done"), idle("implementer-idle"))
          return { type: "user", id: options.promptIDMismatch ? "different-id" : "trusted-input", sessionID,
            payload: { text: options.promptMismatch ? "different" : value, files: [], agents: [], skills: [] } }
        },
      },
      message: { list: async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
        const all = histories[sessionID]
        return cursor ? { data: all.slice(2), cursor: {} } : { data: all.slice(0, 2), cursor: { next: "rest" } }
      } },
    },
    ui: { toast: { show: ({ message }: { message: string }) => { calls.toasts.push(message) } }, dialog: {
      confirm: async ({ message }: { message: string }) => { calls.confirmed.push(message); options.onConfirm?.(); return options.confirm },
      set: () => undefined,
    } },
  } as unknown as Context
  return { context, generation, histories, sessions, calls }
}

test("trusted plan rendering preserves multiline text and exact candidate scope", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal(proposal, root), root, git(root, "rev-parse", "HEAD"))
  const expected = [
    "Plan", "", "Change old file", "", "Update its contents", "Check the result", "",
    "Exact files", "• old.txt", "• new.txt", "• nested/three.txt", "",
    "Bound HEAD", candidate.head, "", "No implementation has been authorized.",
  ].join("\n")
  expect(renderPlan(candidate)).toBe(expected)
  expect(renderPlan(candidate)).not.toContain("\\n")
  expect(renderPlan(candidate)).not.toBe(proposal)
  expect(candidate.proposal.plan).toBe("Update its contents\nCheck the result")
})

test("post-idle dogfood binds exact Planner P and publishes it without authorizing implementation", async () => {
  const root = fixture()
  const f = fake(root, { onWait: (sessionID) => { if (sessionID === "parent") f.calls.toasts.push("root wait returned") } })
  const baseline = observeGit(root)
  const result = await publishM2PlanDogfood(f.context, f.generation, baseline, "parent", { directory: root })
  expect(result.candidate).toEqual(makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head))
  expect(result.syntheticID).toBe("synthetic-plan")
  expect(f.calls.synthetic).toEqual([{ sessionID: "parent", text: proposal, description: renderPlan(result.candidate),
    metadata: { source: "planner", planHash: result.planHash }, resume: false }])
  expect(f.calls.toasts[0]).toBe("root wait returned")
  expect(f.calls.toasts.at(-1)).toContain(result.planHash)
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
})

test("dogfood refuses to publish while the root execution is active", async () => {
  const root = fixture()
  const f = fake(root, { rootActive: true })
  await expect(publishM2PlanDogfood(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("running")
  expect(f.calls.synthetic).toEqual([])
})

test("dogfood reports an immediate root wake after synthetic admission", async () => {
  const root = fixture()
  const f = fake(root, { wakeOnSynthetic: true })
  await expect(publishM2PlanDogfood(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("resumed immediately")
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.prompted).toEqual([])
})

test("binds native calls and exact Planner result, confirms candidate, switches and prompts exact slot once", async () => {
  const root = fixture()
  const f = fake(root, { confirm: true, onPrompt: () => writeFileSync(path.join(root, "old.txt"), "implemented\n") })
  const baseline = observeGit(root)
  const candidate = makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head)
  expect(await runM2(f.context, f.generation, baseline, "parent", { directory: root })).toContain("M2 implementation gate complete")
  expect(f.calls.confirmed).toEqual([candidateMessage(candidate)])
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toEqual([{ sessionID: "slot-child", text: implementerPrompt(candidate, "Milestone 2") }])
  expect(f.calls.prompted[0].text).toContain(`Bound HEAD: ${baseline.head}`)
})

test("Planner may complete read and search tools while the slot remains inert", async () => {
  const root = fixture()
  const f = fake(root, { confirm: false })
  f.histories["planner-child"].splice(1, 0, { type: "assistant", id: "planner-read", agent: "planner", content: [
    { type: "tool", id: "read-call", name: "read", state: { status: "completed", input: { path: "old.txt" }, content: [text("initial")], metadata: {} } },
  ] })
  await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("cancelled")
  expect(f.calls.confirmed).toHaveLength(1)
  expect(f.calls.switched).toEqual([])
})

test("missing, duplicate, continued, background, or substituted native child evidence stops before confirmation", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content.pop() },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content.push(f.histories.parent[1].content[0]) },
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content[0].state.input.sessionID = "old-child" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.metadata.status = "running" },
    (f: ReturnType<typeof fake>) => { f.sessions["slot-child"].parentID = "other" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.content[0].text = "paraphrase" },
    (f: ReturnType<typeof fake>) => { f.histories["planner-child"].push(user("extra", "extra")) },
    (f: ReturnType<typeof fake>) => { f.histories["slot-child"].push({ type: "agent-switched", id: "early", agent: "authorized_implementer" }) },
  ]) {
    const root = fixture()
    const f = fake(root, { confirm: true })
    mutate(f)
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.switched).toEqual([])
  }
})

test("dirty baseline, dismissal, changed candidate state, and revoked generation cannot admit", async () => {
  const root = fixture()
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "old.txt"), "dirty")
  const dirty = fake(root, { confirm: true })
  await expect(runM2(dirty.context, dirty.generation, baseline, "parent", { directory: root })).rejects.toThrow()
  expect(dirty.calls.confirmed).toEqual([])
  git(root, "reset", "--hard", "HEAD")
  for (const options of [
    { confirm: false },
    { confirm: true, onConfirm: () => writeFileSync(path.join(root, "old.txt"), "stale") },
  ]) {
    const f = fake(root, options)
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toEqual([])
    git(root, "reset", "--hard", "HEAD")
  }
  const revoked = fake(root, { confirm: true })
  revoked.generation.revoked = true
  await expect(runM2(revoked.context, revoked.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
  expect(revoked.calls.switched).toEqual([])
})

test("after switch or ambiguous prompt, no second dispatch or child is created", async () => {
  for (const options of [
    { confirm: true, onSwitch: () => { throw new Error("switch uncertain") } },
    { confirm: true, promptError: true },
    { confirm: true, promptMismatch: true },
    { confirm: true, promptIDMismatch: true },
  ]) {
    const root = fixture()
    const f = fake(root, options)
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted.length).toBeLessThanOrEqual(1)
  }
})

test("stale binding after confirmation or switch and revoked generation after prompt stop without redispatch", async () => {
  for (const boundary of ["confirm", "switch", "prompt"] as const) {
    const root = fixture()
    let f: ReturnType<typeof fake>
    f = fake(root, { confirm: true,
      onConfirm: boundary === "confirm" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onSwitch: boundary === "switch" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onPrompt: boundary === "prompt" ? () => { f.generation.revoked = true } : undefined,
    })
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(boundary === "prompt" ? 1 : 0)
  }
})

test("authorized result must remain in the exact slot with one successful trusted input", async () => {
  for (const mutation of ["extra-input", "wrong-agent", "failed-outcome"] as const) {
    const root = fixture()
    let f: ReturnType<typeof fake>
    f = fake(root, { confirm: true, onWait: (sessionID) => {
      if (sessionID !== "slot-child") return
      if (mutation === "extra-input") f.histories["slot-child"].push(user("extra", "more"))
      if (mutation === "wrong-agent") f.sessions["slot-child"].agent = "planner"
      if (mutation === "failed-outcome") f.sessions["slot-child"].outcome = "failed"
    } })
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

test("changed HEAD and out-of-scope implementation cannot pass the M1 Git gate", async () => {
  for (const effect of ["head", "scope"] as const) {
    const root = fixture()
    const f = fake(root, { confirm: true, onPrompt: () => {
      if (effect === "scope") writeFileSync(path.join(root, "other.txt"), "outside")
      else {
        writeFileSync(path.join(root, "old.txt"), "committed")
        git(root, "add", "old.txt")
        git(root, "commit", "-qm", "changed head")
      }
    } })
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

test("native role files deny mutation and delegation through ordered effective rules", () => {
  type Rule = { action: string; resource: string; effect: string }
  const load = (name: string): Rule[] => {
    const source = readFileSync(path.join(import.meta.dir, `../.opencode/agents/${name}.md`), "utf8")
    expect(source.startsWith("---\n")).toBe(true)
    const frontmatter = Bun.YAML.parse(source.split("---\n")[1]!) as { mode: string; permissions: Rule[] }
    expect(frontmatter.mode).toBe(name === "opencode-agents" ? "primary" : "subagent")
    expect(frontmatter.permissions.length).toBeGreaterThan(0)
    return frontmatter.permissions
  }
  const effect = (rules: Rule[], action: string, resource = "*") =>
    rules.filter((rule) => (rule.action === "*" || rule.action === action) && (rule.resource === "*" || rule.resource === resource)).at(-1)?.effect
  for (const name of ["opencode-agents", "planner", "implementer_slot", "authorized_implementer"]) {
    const rules = load(name)
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    for (const action of ["execute", "session_move", "session_rename", "opencode", "mcp", "question"]) {
      expect(effect(rules, action)).toBe("deny")
    }
    expect(effect(rules, "subagent", "authorized_implementer")).toBe("deny")
    expect(effect(rules, "subagent", "other")).toBe("deny")
  }
  const orchestrator = load("opencode-agents")
  expect(effect(orchestrator, "subagent", "planner")).toBe("allow")
  expect(effect(orchestrator, "subagent", "implementer_slot")).toBe("allow")
  expect(effect(orchestrator, "edit")).toBe("deny")
  expect(effect(orchestrator, "shell", "git status")).toBe("deny")
  for (const name of ["planner", "implementer_slot"]) {
    const rules = load(name)
    for (const action of ["read", "glob", "grep"]) expect(effect(rules, action)).toBe("allow")
    for (const action of ["edit", "shell", "subagent", "write", "patch"]) expect(effect(rules, action)).toBe("deny")
  }
  const slot = load("implementer_slot")
  expect(effect(slot, "execute")).toBe("deny")
  const authorized = load("authorized_implementer")
  expect(effect(authorized, "edit")).toBe("allow")
  expect(effect(authorized, "shell", "git status")).toBe("allow")
  expect(effect(authorized, "subagent", "planner")).toBe("deny")
})

test("session permission overrides and changed bound transcripts stop before role switch", async () => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.sessions["slot-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.histories.parent.push(user("extra-parent", "another request")) },
    (f: ReturnType<typeof fake>) => { f.histories["slot-child"].push(user("continuation", "again")) },
  ]) {
    const root = fixture()
    const f = fake(root, { confirm: true })
    mutate(f)
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual([])
  }
})

test("generation revocation after confirmation or switch stops before trusted prompt", async () => {
  for (const boundary of ["confirm", "switch"] as const) {
    const root = fixture()
    let generation: Generation
    const f = fake(root, {
      confirm: true,
      onConfirm: boundary === "confirm" ? () => { generation.revoked = true } : undefined,
      onSwitch: boundary === "switch" ? () => { generation.revoked = true } : undefined,
    })
    generation = f.generation
    await expect(runM2(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("revoked")
    expect(f.calls.prompted).toEqual([])
  }
})

test("TUI activation publishes only after a newly observed parent completes", async () => {
  const root = fixture()
  const f = fake(root)
  const handlers = new Map<string, (event: any) => void>()
  const host = f.context as unknown as any
  host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
  host.ui.slot = () => () => undefined
  host.ui.dialog.alert = async () => { throw new Error("unexpected alert") }
  const cleanup = await plugin.setup(f.context)
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  expect(f.calls.synthetic).toEqual([])
  handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "opencode-agents", location: { directory: root } } })
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  await Promise.resolve()
  for (let i = 0; i < 100 && !f.calls.synthetic.length; i++) await Bun.sleep(1)
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.prompted).toEqual([])
  handlers.get("session.execution.started")?.({ data: { sessionID: "parent" } })
  expect(f.calls.toasts.at(-1)).toContain("Root execution started")
  if (typeof cleanup === "function") await cleanup()
  expect(handlers.size).toBe(0)
})

test("dogfood accepts a stable pre-existing diff but does not authorize it", async () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "dirty")
  const f = fake(root, { confirm: true })
  const handlers = new Map<string, (event: any) => void>()
  const host = f.context as unknown as any
  host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
  host.ui.slot = () => () => undefined
  const cleanup = await plugin.setup(f.context)
  handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "opencode-agents", location: { directory: root } } })
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  for (let i = 0; i < 100 && !f.calls.synthetic.length; i++) await Bun.sleep(1)
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.switched).toEqual([])
  if (typeof cleanup === "function") await cleanup()
})
