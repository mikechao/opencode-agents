import { afterAll, afterEach, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import type { Generation } from "../src/cap.ts"
import * as gitModule from "../src/git.ts"
import { observeGit, type GitSnapshot } from "../src/git.ts"
import { makeCandidate, parseProposal, candidateMessage, renderPlan } from "../src/proposal.ts"
import { candidateFits, implementerPrompt, plannerInput, publishPlan, runImplementationAttempt, SLOT_PROMPT } from "../src/attempt.ts"
import plugin from "../.opencode/plugins/opencode-agents/tui.ts"

const roots: string[] = []
let seed: string | undefined
function createSeed() {
  seed = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-attempt-seed-")))
  git(seed, "init", "-q")
  git(seed, "config", "user.name", "Attempt Test")
  git(seed, "config", "user.email", "attempt@example.invalid")
  writeFileSync(path.join(seed, "old.txt"), "initial\n")
  git(seed, "add", "old.txt")
  git(seed, "commit", "-qm", "baseline")
}
afterAll(() => { if (seed) rmSync(seed, { recursive: true, force: true }) })
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function git(root: string, ...args: string[]) { return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim() }
function fixture() {
  if (gitModule.observeGit !== realGit.observeGit) throw new Error("Real-Git fixture used while observer is doubled")
  if (!seed) createSeed()
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-attempt-")))
  roots.push(root)
  // Copy all Git state privately; refresh index stat data for the destination.
  cpSync(seed!, root, { recursive: true, preserveTimestamps: true })
  git(root, "update-index", "--refresh")
  return root
}

// Capture real exports before interception. Bun updates existing ESM consumers,
// including attempt.ts and the plugin, when this module is mocked/restored.
const realGit = { ...gitModule }
const gitModulePath = path.resolve(import.meta.dir, "../src/git.ts")
const HEAD = "1".repeat(40)
class SnapshotObserver {
  private active = true
  readonly locations = new Map<string, { current: GitSnapshot; calls: Array<{ baseline?: GitSnapshot; current: GitSnapshot }> }>()

  configure(location: string, head = HEAD, paths: readonly string[] = []) {
    if (!this.active) throw new Error("Snapshot observer is closed")
    const root = realpathSync(location)
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(head)) throw new Error("Invalid Git HEAD")
    if (paths.some((name) => !name || name.startsWith("/") || name.split("/").some((part) => !part || part === "." || part === ".." || part === ".git"))) {
      throw new Error("Invalid repository path in Git observation")
    }
    const current = Object.freeze({ root, head, paths: Object.freeze([...new Set(paths)].sort()) })
    const state = this.locations.get(root)
    if (state) state.current = current
    else this.locations.set(root, { current, calls: [] })
  }

  observe = (location: string, baseline?: GitSnapshot): GitSnapshot => {
    if (!this.active) throw new Error("Snapshot observer is closed")
    const state = this.locations.get(realpathSync(location))
    if (!state) throw new Error("Unconfigured snapshot observer location")
    const current = state.current
    state.calls.push({ baseline, current })
    if (baseline && (current.root !== baseline.root || current.head !== baseline.head)) {
      throw new Error("Worktree root or HEAD changed before Git observation")
    }
    return current
  }

  calls(root: string) { return this.locations.get(realpathSync(root))!.calls }
  close() { this.active = false; this.locations.clear() }
}

// Serial, case-local interception only. Unconfigured/closed doubles fail closed;
// finally restores the real exports even if a rejection/assertion fails.
function snapshotTest(name: string, run: (observer: SnapshotObserver) => Promise<void>) {
  test(name, async () => {
    if (gitModule.observeGit !== realGit.observeGit) throw new Error("Leaked Git observer interception")
    const observer = new SnapshotObserver()
    mock.module(gitModulePath, () => ({ ...realGit, observeGit: observer.observe }))
    try { await run(observer) }
    finally {
      observer.close()
      mock.module(gitModulePath, () => realGit)
    }
  })
}

function snapshotFixture(observer: SnapshotObserver) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-attempt-snapshot-")))
  roots.push(root)
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  observer.configure(root)
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
  confirm?: boolean | undefined
  onConfirm?: () => void
  onSwitch?: () => void
  onPrompt?: (value: string) => void
  onWait?: (sessionID: string) => void | Promise<void>
  onGet?: (sessionID: string) => void
  promptError?: boolean
  promptMismatch?: boolean
  promptIDMismatch?: boolean
}
function fake(root: string, options: FakeOptions = {}) {
  const generation: Generation = { revoked: false, busy: false }
  const histories: Record<string, any[]> = {
    parent: [user("parent-user", request),
      { type: "assistant", id: "planner-tool-message", agent: "orchestrator", content: [call("planner-call", "planner", plannerInput(request), "planner-child", proposal)] },
      { type: "assistant", id: "slot-tool-message", agent: "orchestrator", content: [call("slot-call", "implementer_slot", SLOT_PROMPT, "slot-child", "READY")] },
      answer("parent-final", "orchestrator", "Ready for trusted handoff"), idle("parent-idle")],
    "planner-child": [user("planner-user", prefix + plannerInput(request)), answer("planner-final", "planner", proposal), idle("planner-idle")],
    "slot-child": [user("slot-user", prefix + SLOT_PROMPT), answer("slot-final", "implementer_slot", "READY"), idle("slot-idle")],
  }
  const sessions: Record<string, any> = {
    parent: { id: "parent", agent: "orchestrator", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
    "planner-child": { id: "planner-child", parentID: "parent", agent: "planner", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
    "slot-child": { id: "slot-child", parentID: "parent", agent: "implementer_slot", location: { directory: root }, outcome: "succeeded", time: { idle: 1 } },
  }
  const calls = { switched: [] as string[], prompted: [] as Array<{ sessionID: string; text: string }>, confirmed: [] as string[],
    synthetic: [] as Array<{ sessionID: string; text: string; description: string; metadata: { source: string; planHash: string }; resume: boolean }>, toasts: [] as string[] }
  const context = {
    location: { directory: root }, renderer: { terminalWidth: 120, terminalHeight: 60 },
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => { options.onGet?.(sessionID); return sessions[sessionID] },
        active: async () => options.rootActive || (options.wakeOnSynthetic && calls.synthetic.length > 0)
          ? { parent: { type: "running" } } : {},
        inbox: { list: async () => [] }, wait: async ({ sessionID }: { sessionID: string }) => { await options.onWait?.(sessionID) },
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

snapshotTest("post-idle publication binds exact Planner P and publishes it without authorizing implementation", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { onWait: (sessionID) => { if (sessionID === "parent") f.calls.toasts.push("root wait returned") } })
  const baseline = observeGit(root)
  const result = await publishPlan(f.context, f.generation, baseline, "parent", { directory: root })
  expect(result.candidate).toEqual(makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head))
  expect(result.syntheticID).toBe("synthetic-plan")
  expect(f.calls.synthetic).toEqual([{ sessionID: "parent", text: proposal, description: renderPlan(result.candidate),
    metadata: { source: "planner", planHash: result.planHash }, resume: false }])
  expect(f.calls.toasts[0]).toBe("root wait returned")
  expect(f.calls.toasts.at(-1)).toContain(result.planHash)
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(observer.calls(root).map((call) => call.baseline)).toEqual([undefined, baseline, baseline])

  // Exercise the double's contract separately from the production call records.
  const isolated = new SnapshotObserver()
  expect(() => isolated.observe(root)).toThrow("Unconfigured")
  isolated.configure(root)
  const trusted = isolated.observe(root + "/.")
  expect([trusted.root, trusted.head, trusted.paths, Object.isFrozen(trusted), Object.isFrozen(trusted.paths)])
    .toEqual([root, HEAD, [], true, true])
  for (const bound of [{ ...trusted, root: root + "/other" }, { ...trusted, head: "0".repeat(40) }]) {
    expect(() => isolated.observe(root, bound)).toThrow("root or HEAD changed")
  }
  isolated.configure(root, "2".repeat(40), ["old.txt", "new.txt", "old.txt"])
  expect(() => isolated.observe(root, trusted)).toThrow("root or HEAD changed")
  expect(isolated.observe(root).paths).toEqual(["new.txt", "old.txt"])
  expect(trusted).toEqual({ root, head: HEAD, paths: [] })
  isolated.close()
  expect(() => isolated.observe(root)).toThrow("closed")
})

snapshotTest("publication refuses to publish while the root execution is active", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { rootActive: true })
  await expect(publishPlan(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("running")
  expect(f.calls.synthetic).toEqual([])
})

snapshotTest("publication reports an immediate root wake after synthetic admission", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { wakeOnSynthetic: true })
  await expect(publishPlan(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("resumed immediately")
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.prompted).toEqual([])
})

test("binds native calls and exact Planner result, confirms candidate, switches and prompts exact slot once", async () => {
  const root = fixture()
  const f = fake(root, { confirm: true, onPrompt: () => writeFileSync(path.join(root, "old.txt"), "implemented\n") })
  const baseline = observeGit(root)
  const candidate = makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head)
  expect(await runImplementationAttempt(f.context, f.generation, baseline, "parent", { directory: root })).toContain("Implementation gate complete")
  expect(f.calls.confirmed).toEqual([candidateMessage(candidate)])
  expect(f.calls.switched).toEqual(["slot-child"])
  const trustedPrompt = [
    "You are the Implementer for one authorized implementation attempt.",
    "Implement the frozen proposal below. Modify only its exact authorized repository paths; do not add, edit, or delete any other repository path.",
    "Do not intentionally perform Git commit or other history effects reserved for the trusted CAP path.",
    "Do not intentionally manipulate Git configuration, index metadata, ignore rules, repository metadata, or other shell-accessible state to conceal changes or evade ordinary Git changed-path scope observation.",
    "You may read, edit, test, and use ordinary development shell commands. Do not alter scope or seek another approval.",
    "The worktree was clean when the intent was authorized. Leave HEAD unchanged.",
    `Canonical worktree root: ${baseline.root}`,
    `Bound HEAD: ${baseline.head}`,
    "Frozen proposal:",
    JSON.stringify(candidate.proposal),
  ].join("\n")
  expect(implementerPrompt(candidate)).toBe(trustedPrompt)
  expect(f.calls.prompted).toEqual([{ sessionID: "slot-child", text: trustedPrompt }])
  expect(f.calls.prompted[0].text).toContain(`Bound HEAD: ${baseline.head}`)
})

snapshotTest("Planner may complete read and search tools while the slot remains inert", async (observer) => {
  for (const tool of ["read", "glob", "grep"]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: false })
    f.histories["planner-child"].splice(1, 0, { type: "assistant", id: "planner-read", agent: "planner", content: [
      { type: "tool", id: "read-call", name: tool, state: { status: "completed", input: { path: "old.txt" }, content: [text("initial")], metadata: {} } },
    ] })
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("cancelled")
    expect(f.calls.confirmed).toHaveLength(1)
    expect(f.calls.switched).toEqual([])
  }
})

snapshotTest("missing, duplicate, continued, background, or substituted native child evidence stops before confirmation", async (observer) => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content.pop() },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content.push(f.histories.parent[1].content[0]) },
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content[0].state.input.sessionID = "old-child" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.background = false },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.model = "other" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.prompt += " " },
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content[0].state.input.prompt += " " },
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].id = f.histories.parent[1].id },
    (f: ReturnType<typeof fake>) => { f.histories.parent[2].content[0].state.metadata.sessionID = "planner-child" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.metadata.status = "running" },
    (f: ReturnType<typeof fake>) => { f.sessions["slot-child"].parentID = "other" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.content[0].text = "paraphrase" },
    (f: ReturnType<typeof fake>) => { f.histories["planner-child"].push(user("extra", "extra")) },
    (f: ReturnType<typeof fake>) => { f.histories["slot-child"].push({ type: "agent-switched", id: "early", agent: "authorized_implementer" }) },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true })
    mutate(f)
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.switched).toEqual([])
  }
})

test("dirty baseline, dismissal, changed candidate state, and revoked generation cannot admit", async () => {
  const root = fixture()
  const baseline = observeGit(root)
  writeFileSync(path.join(root, "old.txt"), "dirty")
  const dirty = fake(root, { confirm: true })
  await expect(runImplementationAttempt(dirty.context, dirty.generation, baseline, "parent", { directory: root })).rejects.toThrow()
  expect(dirty.calls.confirmed).toEqual([])
  git(root, "reset", "--hard", "HEAD")
  for (const options of [
    { confirm: false },
    { confirm: undefined },
    { confirm: true, onConfirm: () => writeFileSync(path.join(root, "old.txt"), "stale") },
  ]) {
    const f = fake(root, options)
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toEqual([])
    expect(f.calls.switched).toEqual([])
    git(root, "reset", "--hard", "HEAD")
  }
  const revoked = fake(root, { confirm: true })
  revoked.generation.revoked = true
  await expect(runImplementationAttempt(revoked.context, revoked.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
  expect(revoked.calls.switched).toEqual([])
})

snapshotTest("after switch or ambiguous prompt, no second dispatch or child is created", async (observer) => {
  for (const options of [
    { confirm: true, onSwitch: () => { throw new Error("switch uncertain") } },
    { confirm: true, promptError: true },
    { confirm: true, promptMismatch: true },
    { confirm: true, promptIDMismatch: true },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, options)
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted.length).toBeLessThanOrEqual(1)
  }
})

snapshotTest("stale binding after confirmation or switch and revoked generation after prompt stop without redispatch", async (observer) => {
  for (const boundary of ["confirm", "switch", "prompt"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { confirm: true,
      onConfirm: boundary === "confirm" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onSwitch: boundary === "switch" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onPrompt: boundary === "prompt" ? () => { f.generation.revoked = true } : undefined,
    })
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(boundary === "prompt" ? 1 : 0)
  }
})

snapshotTest("authorized result must remain in the exact slot with one successful trusted input", async (observer) => {
  for (const mutation of ["none", "extra-input", "wrong-agent", "failed-outcome"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { confirm: true,
      onPrompt: mutation === "none" ? () => observer.configure(root, HEAD, ["old.txt"]) : undefined,
      onWait: (sessionID) => {
      if (sessionID !== "slot-child") return
      if (mutation === "extra-input") f.histories["slot-child"].push(user("extra", "more"))
      if (mutation === "wrong-agent") f.sessions["slot-child"].agent = "planner"
      if (mutation === "failed-outcome") f.sessions["slot-child"].outcome = "failed"
    } })
    const result = runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })
    if (mutation === "none") {
      expect(await result).toContain("Resulting paths (1): old.txt")
      expect(observer.calls(root).map((call) => call.current.paths)).toEqual([[], [], [], [], [], ["old.txt"]])
    } else await expect(result).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

test("changed HEAD and out-of-scope implementation cannot pass the Git gate", async () => {
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
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

test("native role files deny mutation and delegation through ordered effective rules", () => {
  type Rule = { action: string; resource: string; effect: string }
  const load = (name: string): Rule[] => {
    const source = readFileSync(path.join(import.meta.dir, `../.opencode/agents/${name}.md`), "utf8")
    expect(source.startsWith("---\n")).toBe(true)
    const frontmatter = Bun.YAML.parse(source.split("---\n")[1]!) as { mode: string; permissions: Rule[] }
    expect(frontmatter.mode).toBe(name === "orchestrator" ? "primary" : "subagent")
    expect(frontmatter.permissions.length).toBeGreaterThan(0)
    return frontmatter.permissions
  }
  const effect = (rules: Rule[], action: string, resource = "*") =>
    rules.filter((rule) => (rule.action === "*" || rule.action === action) && (rule.resource === "*" || rule.resource === resource)).at(-1)?.effect
  for (const name of ["orchestrator", "planner", "implementer_slot", "authorized_implementer"]) {
    const rules = load(name)
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    for (const action of ["execute", "session_move", "session_rename", "opencode", "mcp", "question"]) {
      expect(effect(rules, action)).toBe("deny")
    }
    expect(effect(rules, "subagent", "authorized_implementer")).toBe("deny")
    expect(effect(rules, "subagent", "other")).toBe("deny")
  }
  const orchestrator = load("orchestrator")
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
  expect(effect(authorized, "shell", "git commit")).toBe("deny")
  expect(effect(authorized, "shell", "git commit *")).toBe("deny")
  expect(effect(authorized, "subagent", "planner")).toBe("deny")
  const instructions = readFileSync(path.join(import.meta.dir, "../.opencode/agents/authorized_implementer.md"), "utf8")
  expect(instructions).toContain("Do not intentionally perform Git commit or other history effects reserved for the trusted CAP path.")
  expect(instructions).toContain("Do not intentionally manipulate Git configuration, index metadata, ignore rules, repository metadata, or other shell accessible state to conceal changes or evade ordinary Git changed-path scope observation.")
})

snapshotTest("session permission overrides and changed bound transcripts stop before role switch", async (observer) => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.sessions["slot-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.sessions.parent.permissions = [{ action: "shell", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.sessions["planner-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.histories.parent.push(user("extra-parent", "another request")) },
    (f: ReturnType<typeof fake>) => { f.histories["slot-child"].push(user("continuation", "again")) },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true })
    mutate(f)
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual([])
  }
})

snapshotTest("generation revocation after confirmation or switch stops before trusted prompt", async (observer) => {
  for (const boundary of ["confirm", "switch"] as const) {
    const root = snapshotFixture(observer)
    let generation: Generation
    const f = fake(root, {
      confirm: true,
      onConfirm: boundary === "confirm" ? () => { generation.revoked = true } : undefined,
      onSwitch: boundary === "switch" ? () => { generation.revoked = true } : undefined,
    })
    generation = f.generation
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("revoked")
    expect(f.calls.prompted).toEqual([])
  }
})

test("TUI activation publishes only after a newly observed parent completes", async () => {
  const root = fixture()
  const f = fake(root)
  const handlers = new Map<string, (event: any) => void>()
  const host = f.context as unknown as any
  host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
  host.ui.dialog.alert = async () => { throw new Error("unexpected alert") }
  const cleanup = await plugin.setup(f.context)
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  expect(f.calls.synthetic).toEqual([])
  handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } } })
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

test("publication accepts a stable pre-existing diff but does not authorize it", async () => {
  const root = fixture()
  writeFileSync(path.join(root, "old.txt"), "dirty")
  const f = fake(root, { confirm: true })
  const handlers = new Map<string, (event: any) => void>()
  const host = f.context as unknown as any
  host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
  const cleanup = await plugin.setup(f.context)
  handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } } })
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  for (let i = 0; i < 100 && !f.calls.synthetic.length; i++) await Bun.sleep(1)
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.switched).toEqual([])
  if (typeof cleanup === "function") await cleanup()
})

test("candidate fit preserves complete confirmation text and terminal sizing policy", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-attempt-")))
  roots.push(root)
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, "1".repeat(40))
  expect(candidateFits(candidateMessage(candidate), 120, 50)).toBe(true)
  expect(candidateFits(candidateMessage(candidate), 40, 15)).toBe(false)
  expect(candidateFits("x".repeat(270), 36, 20)).toBe(true)
  expect(candidateFits("x".repeat(271), 36, 20)).toBe(false)
  expect(candidateFits("界".repeat(135), 36, 20)).toBe(true)
  expect(candidateFits("界".repeat(136), 36, 20)).toBe(false)
  expect(candidateFits("x", 35, 20)).toBe(false)
  expect(candidateFits("x", 120, 18)).toBe(false)
})

snapshotTest("unreadable candidate before or during confirmation cannot switch or prompt", async (observer) => {
  for (const boundary of ["before", "confirm"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true, onConfirm: () => { f.context.renderer.terminalHeight = 15 } })
    if (boundary === "before") f.context.renderer.terminalHeight = 15
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(/fit|unreadable/)
    expect(f.calls.confirmed).toHaveLength(boundary === "before" ? 0 : 1)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("Planner bootstrap rejects forbidden or unfinished tools and slot rejects any tool or non-READY result", async (observer) => {
  for (const [sessionID, name, status] of [
    ["planner-child", "edit", "completed"], ["planner-child", "read", "running"],
    ["slot-child", "read", "completed"], ["slot-child", "glob", "completed"],
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true })
    f.histories[sessionID!].splice(1, 0, { type: "assistant", id: "bootstrap-tool", agent: f.sessions[sessionID!].agent,
      content: [{ type: "tool", id: "bootstrap-call", name, state: { status, input: {}, content: [], metadata: {} } }] })
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("disallowed tool")
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.switched).toEqual([])
  }
  const root = snapshotFixture(observer)
  const f = fake(root, { confirm: true })
  f.histories["slot-child"][1].content[0].text = "READY\n"
  await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("final text")
  expect(f.calls.confirmed).toEqual([])
})

snapshotTest("repeated message cursors and duplicate IDs across pages reject native binding", async (observer) => {
  for (const mutation of ["cursor", "id"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true })
    const host = f.context as unknown as any
    host.client.message.list = async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
      const all = f.histories[sessionID]
      return cursor
        ? { data: mutation === "id" ? all : [], cursor: mutation === "cursor" ? { next: "rest" } : {} }
        : { data: all.slice(0, 2), cursor: { next: "rest" } }
    }
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(mutation === "cursor" ? "repeated a cursor" : "duplicate message ID")
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("existing parent and Planner content remains immutable across confirmation and switch", async (observer) => {
  for (const boundary of ["confirm", "switch"] as const) {
    for (const sessionID of ["parent", "planner-child"]) {
      const root = snapshotFixture(observer)
      const mutate = () => { f.histories[sessionID][sessionID === "parent" ? 3 : 1].content[0].text += " changed" }
      const f = fake(root, { confirm: true, onConfirm: boundary === "confirm" ? mutate : undefined,
        onSwitch: boundary === "switch" ? mutate : undefined })
      await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(/transcript changed|output differs from exact child result/)
      expect(f.calls.prompted).toEqual([])
      expect(f.calls.switched).toHaveLength(boundary === "confirm" ? 0 : 1)
    }
  }
})

snapshotTest("slot is rechecked after awaited parent verification before trusted prompt", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { confirm: true, onGet: (sessionID) => {
    if (sessionID === "parent" && f.calls.switched.length) f.histories["slot-child"].push(user("late-input", "continued"))
  } })
  await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("before trusted prompt")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("post-switch session permission overrides cannot admit the trusted prompt", async (observer) => {
  for (const sessionID of ["parent", "planner-child", "slot-child"]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true, onSwitch: () => {
      f.sessions[sessionID].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
    } })
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("permissions")
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("publication preserves pretty-printed raw Planner P and rejects altered synthetic admission", async (observer) => {
  for (const mutation of ["none", "text", "description"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const raw = " \n" + JSON.stringify(JSON.parse(proposal), null, 2) + "\n "
    f.histories["planner-child"][1].content[0].text = raw
    f.histories.parent[1].content[0].state.content[0].text = `<subagent sessionID="planner-child" state="completed">\n${raw}\n</subagent>`
    const host = f.context as unknown as any
    const synthetic = host.client.session.synthetic
    host.client.session.synthetic = async (input: any) => {
      const admitted = await synthetic(input)
      if (mutation !== "none") admitted.payload[mutation] += " changed"
      return admitted
    }
    const result = publishPlan(f.context, f.generation, observeGit(root), "parent", { directory: root })
    if (mutation === "none") {
      const published = await result
      expect(f.calls.synthetic[0].description).toBe(renderPlan(published.candidate))
      expect(published.candidate.proposal.plan).toBe("Update its contents\nCheck the result")
    } else await expect(result).rejects.toThrow("admission changed")
    expect(f.calls.synthetic[0].text).toBe(raw)
    expect(f.calls.synthetic[0].resume).toBe(false)
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("published candidate, hash and synthetic presentation do not relax implementation binding", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { confirm: true })
  const baseline = observeGit(root)
  const published = await publishPlan(f.context, f.generation, baseline, "parent", { directory: root })
  f.histories.parent.push({ type: "synthetic", id: published.syntheticID, text: proposal,
    description: renderPlan(published.candidate), metadata: { source: "planner", planHash: published.planHash } })
  await expect(runImplementationAttempt(f.context, f.generation, baseline, "parent", { directory: root })).rejects.toThrow("unexpected parent input")
  expect(f.calls.confirmed).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
})

test("publication refuses pending inbox input and a changed publication path set", async () => {
  for (const mutation of ["inbox", "paths"] as const) {
    const root = fixture()
    writeFileSync(path.join(root, "old.txt"), "pre-existing")
    const baseline = observeGit(root)
    const f = fake(root)
    if (mutation === "paths") writeFileSync(path.join(root, "new.txt"), "new path")
    else (f.context as unknown as any).client.session.inbox.list = async () => [{ id: "pending" }]
    await expect(publishPlan(f.context, f.generation, baseline, "parent", { directory: root })).rejects.toThrow(mutation === "paths" ? "publication worktree paths changed" : "pending input")
    expect(f.calls.synthetic).toEqual([])
    expect(f.calls.confirmed).toEqual([])
  }
})

snapshotTest("trusted prompt admission rejects substituted identity or attachments without redispatch", async (observer) => {
  for (const mutation of ["sessionID", "type", "id", "files", "agents", "skills"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { confirm: true })
    const host = f.context as unknown as any
    const prompt = host.client.session.prompt
    host.client.session.prompt = async (input: any) => {
      const returned = await prompt(input)
      if (["files", "agents", "skills"].includes(mutation)) returned.payload[mutation] = ["attachment"]
      else returned[mutation] = mutation === "id" ? "" : "substituted"
      return returned
    }
    await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("unexpected input")
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted).toHaveLength(1)
  }
})

snapshotTest("activation location substitution during confirmation cannot switch or dispatch", async (observer) => {
  const root = snapshotFixture(observer)
  const otherRoot = snapshotFixture(observer)
  const f = fake(root, { confirm: true, onConfirm: () => { (f.context as unknown as any).location.directory = otherRoot } })
  await expect(runImplementationAttempt(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("TUI location changed")
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("TUI duplicate completions and failed or interrupted roots cannot start another publication", async (observer) => {
  for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const handlers = new Map<string, (event: any) => void>()
    const alerts: unknown[] = []
    const host = f.context as unknown as any
    host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
    host.ui.dialog.alert = async (input: unknown) => { alerts.push(input) }
    const cleanup = await plugin.setup(f.context)
    try {
      handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } } })
      handlers.get(`session.execution.${outcome}`)?.({ data: { sessionID: "parent" } })
      handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
      if (outcome === "succeeded") {
        for (let i = 0; i < 100 && !f.calls.synthetic.length; i++) await Bun.sleep(1)
      }
      expect(f.calls.synthetic).toHaveLength(outcome === "succeeded" ? 1 : 0)
      expect(alerts).toHaveLength(outcome === "succeeded" ? 0 : 1)
      expect(f.calls.confirmed).toEqual([])
      expect(f.calls.switched).toEqual([])
      expect(f.calls.prompted).toEqual([])
    } finally {
      if (typeof cleanup === "function") await cleanup()
    }
    expect(handlers.size).toBe(0)
  }
})

snapshotTest("TUI cleanup revokes pending publication and a fresh activation has no inherited authority", async (observer) => {
  const root = snapshotFixture(observer)
  let release!: () => void
  let waited = false
  const pending = new Promise<void>((resolve) => { release = resolve })
  const f = fake(root, { onWait: async () => { waited = true; await pending } })
  const handlers = new Map<string, (event: any) => void>()
  const alerts: unknown[] = []
  const host = f.context as unknown as any
  host.data = { on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) } }
  host.ui.dialog.alert = async (input: unknown) => { alerts.push(input) }
  const cleanup = await plugin.setup(f.context)
  handlers.get("session.created")?.({ data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } } })
  handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
  expect(waited).toBe(true)
  if (typeof cleanup === "function") await cleanup()
  expect(handlers.size).toBe(0)
  release()
  await Bun.sleep(1)
  expect(f.calls.synthetic).toEqual([])
  expect(alerts).toEqual([])
  const replacementCleanup = await plugin.setup(f.context)
  try {
    handlers.get("session.execution.succeeded")?.({ data: { sessionID: "parent" } })
    await Bun.sleep(1)
    expect(f.calls.synthetic).toEqual([])
    expect(f.calls.confirmed).toEqual([])
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
  } finally {
    if (typeof replacementCleanup === "function") await replacementCleanup()
  }
  expect(handlers.size).toBe(0)
})
