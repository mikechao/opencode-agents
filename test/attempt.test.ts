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
import { activationEvidence, initiallyAuthorizable, assertPublishedCoherence, exactEvidence, publishedPresentationMatches,
  authorizePublishedAttempt, implementerPrompt, plannerInput, publishPlan as publish, snapshotLocation, verifyPublishedAttempt,
  type DecisionOwner, type PublishedAttempt, SLOT_PROMPT } from "../src/attempt.ts"
import { createRoot, createEffect, createMemo, createComponent } from "solid-js"
import { createStore } from "solid-js/store"
import { EventEmitter } from "node:events"

// Test-scoped JSX property/handler capture. No renderer, terminal, or native UI integration.
const elements: any[] = []
mock.module("@opentui/solid", () => ({
  createElement: (type: string) => {
    const node = { type, children: [] as any[], parent: null as any, width: 120, height: type === "text" ? 1 : 3,
      screenX: 0, screenY: 0, visible: true, isDestroyed: false }
    elements.push(node)
    return node
  },
  createTextNode: (value: unknown) => { const node = { type: "literal", value }; elements.push(node); return node },
  setProp: (node: any, key: string, value: unknown) => { node[key] = value; if (key === "onMouseUp") { node.height = 1; node.width = 13 } },
  use: (fn: (node: any) => void, node: any) => fn(node),
  insertNode: (parent: any, child: any) => { child.parent = parent; parent.children.push(child) },
  insert: (parent: any, value: any) => {
    const update = () => { const child = typeof value === "function" ? value() : value; if (typeof child === "string") elements.push({ type: "literal", value: child }); if (child && typeof child === "object") { child.parent = parent; parent.children.push(child) } }
    createEffect(update)
  },
  effect: createEffect, memo: createMemo, createComponent,
}))
const { default: plugin } = await import("../.opencode/plugins/opencode-agents/tui.tsx")

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
  events?: boolean
  singlePage?: boolean
  rootActive?: boolean
  wakeOnSynthetic?: boolean
  decision?: boolean | undefined
  onDecision?: () => void
  onSwitch?: () => void
  onPrompt?: (value: string) => void
  onWait?: (sessionID: string) => void | Promise<void>
  onGet?: (sessionID: string) => void
  onRead?: (kind: string, sessionID?: string) => void
  promptError?: boolean
  promptMismatch?: boolean
  promptIDMismatch?: boolean
}
const fakes = new WeakMap<Context, ReturnType<typeof fake>>()
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
    parent: { id: "parent", agent: "orchestrator", location: { directory: root }, outcome: "succeeded", time: { created: 1, idle: 2 } },
    "planner-child": { id: "planner-child", parentID: "parent", agent: "planner", location: { directory: root }, outcome: "succeeded", time: { created: 1, idle: 2 } },
    "slot-child": { id: "slot-child", parentID: "parent", agent: "implementer_slot", location: { directory: root }, outcome: "succeeded", time: { created: 1, idle: 2 } },
  }
  const inboxes: Record<string, any[]> = { parent: [], "planner-child": [], "slot-child": [] }
  const cache: Record<string, any[]> = structuredClone(histories)
  const handlers = new Map<string, (event: any) => void>()
  const listeners = new Set<(event: any) => void>()
  const slots: any[] = []
  const renderer = Object.assign(new EventEmitter(), { terminalWidth: 120, terminalHeight: 60, isDestroyed: false })
  const calls = { switched: [] as string[], prompted: [] as Array<{ sessionID: string; text: string }>, decided: [] as string[],
    synthetic: [] as any[], toasts: [] as string[] }
  const syncCache = (sessionID: string) => {
    cache[sessionID] = structuredClone([...histories[sessionID], ...inboxes[sessionID].filter((item) => item.type === "synthetic")
      .map((item) => ({ id: item.id, type: item.type, ...item.payload, time: item.time }))])
  }
  const context = {
    location: { directory: root }, renderer,
    data: {
      on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) },
      listen: (listener: (event: any) => void) => { listeners.add(listener); return () => listeners.delete(listener) },
      location: { default: () => ({ directory: root }) },
      session: {
        message: { list: (id: string) => cache[id], invalidate: () => {}, sync: async (id: string) => { options.onRead?.("hydrate", id); syncCache(id) } },
        pending: { list: (id: string) => inboxes[id], invalidate: () => {}, sync: async (id: string) => { options.onRead?.("pending-sync", id) } },
      },
    },
    client: {
      session: {
        get: async ({ sessionID }: { sessionID: string }) => { options.onRead?.("get", sessionID); options.onGet?.(sessionID); return sessions[sessionID] },
        active: async () => { options.onRead?.("active"); return options.rootActive || (options.wakeOnSynthetic && calls.synthetic.length > 0) ? { parent: { type: "running" } } : {} },
        inbox: { list: async ({ sessionID }: { sessionID: string }) => { options.onRead?.("inbox", sessionID); return structuredClone(inboxes[sessionID]) } },
        wait: async ({ sessionID }: { sessionID: string }) => { await options.onWait?.(sessionID) },
        synthetic: async (input: any) => {
          calls.synthetic.push(input)
          const admitted = { id: input.id, type: "synthetic", sessionID: input.sessionID, delivery: input.delivery,
            time: { created: 3 }, payload: { text: input.text, description: input.description, metadata: input.metadata } }
          inboxes[input.sessionID].push(structuredClone(admitted))
          syncCache(input.sessionID)
          if (options.events) emit({ type: "session.inbox.enqueued", id: "evt_publication", created: admitted.time.created,
            data: { sessionID: input.sessionID, inboxID: input.id, item: { type: admitted.type, payload: admitted.payload, delivery: admitted.delivery } } })
          return admitted
        },
        switchAgent: async ({ sessionID, agent }: { sessionID: string; agent: string }) => {
          calls.switched.push(sessionID)
          sessions[sessionID].agent = agent
          histories[sessionID].push({ type: "agent-switched", id: "msg_switch", agent, previous: "implementer_slot", time: { created: 4 } })
          if (options.events) emit({ type: "session.agent.selected", id: "evt_switch", created: 4,
            data: { sessionID, agent, previous: "implementer_slot" } })
          options.onSwitch?.()
        },
        prompt: async ({ sessionID, text: value, id }: { sessionID: string; text: string; id: string }) => {
          calls.prompted.push({ sessionID, text: value })
          if (options.events) {
            emit({ type: "session.inbox.enqueued", id: "evt_prompt", created: 5,
              data: { sessionID, inboxID: id, item: { type: "user", delivery: "steer", payload: { text: value } } } })
            emit({ type: "session.execution.started", id: "evt_start", created: 6, data: { sessionID } })
            emit({ type: "session.inbox.delivered", id: "evt_delivered", created: 7, data: { sessionID, inboxID: id } })
            for (const type of ["session.step.started", "session.text.started", "session.text.ended", "session.step.ended"])
              emit({ type, id: `evt_${type}`, data: { sessionID } })
          }
          options.onPrompt?.(value)
          if (options.promptError) throw new Error("ambiguous prompt transport failure")
          histories[sessionID].push(user(id, value), answer("implementer-final", "authorized_implementer", "Done"), idle("implementer-idle"))
          if (options.events) emit({ type: "session.execution.succeeded", id: "evt_implemented", created: 8, data: { sessionID } })
          return { type: "user", id: options.promptIDMismatch ? "different-id" : id, sessionID, delivery: "steer", time: { created: 5 },
            payload: { text: options.promptMismatch ? "different" : value, files: [], agents: [], skills: [] } }
        },
      },
      message: { list: async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
        options.onRead?.("messages", sessionID)
        const all = histories[sessionID]
        return structuredClone(options.singlePage ? { data: all, cursor: {} } :
          cursor ? { data: all.slice(2), cursor: {} } : { data: all.slice(0, 2), cursor: { next: "rest" } })
      } },
    },
    theme: { text: { feedback: { info: { base: "blue" } } } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "parent" }) },
      slot: (claim: any) => { const registration = { claim, removed: false }; slots.push(registration); return () => { registration.removed = true; (registration as any).dispose?.() } },
      toast: { show: ({ message }: { message: string }) => { calls.toasts.push(message) } },
      dialog: { confirm: () => { throw new Error("Modal authorization must never be called") } },
    },
  } as unknown as Context
  let claimed: PublishedAttempt | undefined
  const claim = (published: PublishedAttempt) => { if (claimed) throw new Error("already claimed"); claimed = published }
  const guard: DecisionOwner = {
    assertCurrent: () => { if (generation.revoked) throw new Error("revoked") },
    assertDecision: (published) => { if (claimed !== published) throw new Error("wrong decision owner"); guard.assertCurrent() },
  }
  const created = () => ({ type: "session.created", id: "evt_created", created: sessions.parent.time.created,
    data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } } })
  const emit = (event: any) => { handlers.get(event.type)?.(event); for (const listener of listeners) listener({ details: event }) }
  const f = { context, generation, histories, sessions, inboxes, cache, slots, handlers, listeners, calls, options, guard, claim, created, emit, renderer }
  fakes.set(context, f)
  return f
}
function evidence(context: Context, generation: Generation, baseline: GitSnapshot, location: { directory: string }) {
  return activationEvidence(generation, location, baseline, 0, fakes.get(context)!.created() as any)
}
function publication(context: Context, generation: Generation, baseline: GitSnapshot, _parent: string, location: { directory: string }) {
  return publish(context, evidence(context, generation, baseline, location), fakes.get(context)!.guard)
}
// Test-only positive/negative decision driver for native executor invariants.
// The live-path cases below exercise the real closure's synchronous ownership separately.
async function implement(context: Context, generation: Generation, baseline: GitSnapshot, parent: string, location: { directory: string }) {
  const f = fakes.get(context)!
  const published = await publication(context, generation, baseline, parent, location)
  f.claim(published)
  f.calls.decided.push(candidateMessage(published.candidate))
  f.options.onDecision?.()
  if (f.options.decision !== true) throw new Error("Implementation authorization was cancelled")
  return authorizePublishedAttempt(context, published, f.guard)
}

// Native/CAP sequencing is doubled. Only post-dispatch Git boundary observations
// use the real repository in these two integration cases.
async function realImplementationGate(f: ReturnType<typeof fake>, baseline: GitSnapshot) {
  // These small histories fit one real API page. Pagination invariants are
  // proved with doubles; do not multiply Git observations for artificial pages.
  f.options.singlePage = true
  const observer = new SnapshotObserver()
  observer.configure(baseline.root, baseline.head, baseline.paths)
  const onPrompt = f.options.onPrompt
  f.options.onPrompt = (value) => {
    mock.module(gitModulePath, () => realGit)
    onPrompt?.(value)
  }
  mock.module(gitModulePath, () => ({ ...realGit, observeGit: observer.observe }))
  try { return await implement(f.context, f.generation, baseline, "parent", { directory: baseline.root }) }
  finally { observer.close(); mock.module(gitModulePath, () => realGit) }
}

snapshotTest("post-idle publication binds exact Planner P and publishes it without authorizing implementation", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { onWait: (sessionID) => { if (sessionID === "parent") f.calls.toasts.push("root wait returned") } })
  const baseline = observeGit(root)
  const result = await publication(f.context, f.generation, baseline, "parent", { directory: root })
  expect(result.candidate).toEqual(makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head))
  expect(result.publication.id).toStartWith("msg_")
  expect(f.calls.synthetic).toEqual([{ id: result.publication.id, delivery: "steer", sessionID: "parent", text: proposal, description: renderPlan(result.candidate),
    metadata: { source: "planner", planHash: result.publication.payload.metadata!.planHash }, resume: false }])
  expect(f.calls.toasts[0]).toBe("root wait returned")
  expect(f.calls.decided).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(observer.calls(root).slice(1).every((call) => call.baseline !== undefined)).toBe(true)

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
  await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("running")
  expect(f.calls.synthetic).toEqual([])
})

snapshotTest("publication reports an immediate root wake after synthetic admission", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { wakeOnSynthetic: true })
  await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("running")
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.prompted).toEqual([])
})

test("binds native calls and exact Planner result, authorizes the published candidate, switches and prompts exact slot once", async () => {
  const root = fixture()
  const f = fake(root, { decision: true, onPrompt: () => writeFileSync(path.join(root, "old.txt"), "implemented\n") })
  const baseline = observeGit(root)
  const candidate = makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head)
  expect(await realImplementationGate(f, baseline)).toContain("Implementation gate complete")
  expect(f.calls.decided).toEqual([candidateMessage(candidate)])
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
    const f = fake(root, { decision: false })
    f.histories["planner-child"].splice(1, 0, { type: "assistant", id: "planner-read", agent: "planner", content: [
      { type: "tool", id: "read-call", name: tool, state: { status: "completed", input: { path: "old.txt" }, content: [text("initial")], metadata: {} } },
    ] })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("cancelled")
    expect(f.calls.decided).toHaveLength(1)
    expect(f.calls.switched).toEqual([])
  }
})

snapshotTest("missing, duplicate, continued, background, or substituted native child evidence stops before decision", async (observer) => {
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
    const f = fake(root, { decision: true })
    mutate(f)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.decided).toEqual([])
    expect(f.calls.switched).toEqual([])
  }
})

snapshotTest("dirty baseline, negative decision, changed worktree, and revoked generation cannot admit", async (observer) => {
  const root = snapshotFixture(observer)
  const baseline = observeGit(root)
  observer.configure(root, HEAD, ["old.txt"])
  const dirty = fake(root, { decision: true })
  await expect(implement(dirty.context, dirty.generation, baseline, "parent", { directory: root })).rejects.toThrow()
  expect(dirty.calls.decided).toEqual([])
  observer.configure(root)
  for (const options of [
    { decision: false },
    { decision: undefined },
    { decision: true, onDecision: () => observer.configure(root, HEAD, ["old.txt"]) },
  ]) {
    const f = fake(root, options)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toEqual([])
    expect(f.calls.switched).toEqual([])
    observer.configure(root)
  }
  const revoked = fake(root, { decision: true })
  revoked.generation.revoked = true
  await expect(implement(revoked.context, revoked.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
  expect(revoked.calls.switched).toEqual([])
})

snapshotTest("after switch or ambiguous prompt, no second dispatch or child is created", async (observer) => {
  for (const options of [
    { decision: true, onSwitch: () => { throw new Error("switch uncertain") } },
    { decision: true, promptError: true },
    { decision: true, promptMismatch: true },
    { decision: true, promptIDMismatch: true },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, options)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted.length).toBeLessThanOrEqual(1)
  }
})

snapshotTest("stale binding after decision or switch and revoked generation after prompt stop without redispatch", async (observer) => {
  for (const boundary of ["decision", "switch", "prompt"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { decision: true,
      onDecision: boundary === "decision" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onSwitch: boundary === "switch" ? () => { f.histories["slot-child"].push(user("extra-slot", "continued")) } : undefined,
      onPrompt: boundary === "prompt" ? () => { f.generation.revoked = true } : undefined,
    })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(boundary === "prompt" ? 1 : 0)
  }
})

snapshotTest("authorized result must remain in the exact slot with one successful trusted input", async (observer) => {
  for (const mutation of ["none", "extra-input", "wrong-agent", "failed-outcome"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { decision: true,
      onPrompt: mutation === "none" ? () => observer.configure(root, HEAD, ["old.txt"]) : undefined,
      onWait: (sessionID) => {
      if (sessionID !== "slot-child") return
      if (mutation === "extra-input") f.histories["slot-child"].push(user("extra", "more"))
      if (mutation === "wrong-agent") f.sessions["slot-child"].agent = "planner"
      if (mutation === "failed-outcome") f.sessions["slot-child"].outcome = "failed"
    } })
    const result = implement(f.context, f.generation, observeGit(root), "parent", { directory: root })
    if (mutation === "none") {
      expect(await result).toContain("Resulting paths (1): old.txt")
      expect(observer.calls(root).at(-1)!.current.paths).toEqual(["old.txt"])
    } else await expect(result).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

test("changed HEAD and out-of-scope implementation cannot pass the Git gate", async () => {
  for (const effect of ["head", "scope"] as const) {
    const root = fixture()
    const f = fake(root, { decision: true, onPrompt: () => {
      if (effect === "scope") writeFileSync(path.join(root, "other.txt"), "outside")
      else {
        writeFileSync(path.join(root, "old.txt"), "committed")
        git(root, "add", "old.txt")
        git(root, "commit", "-qm", "changed head")
      }
    } })
    await expect(realImplementationGate(f, observeGit(root))).rejects.toThrow()
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
    const f = fake(root, { decision: true })
    mutate(f)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual([])
  }
})

snapshotTest("generation revocation after decision or switch stops before trusted prompt", async (observer) => {
  for (const boundary of ["decision", "switch"] as const) {
    const root = snapshotFixture(observer)
    let generation: Generation
    const f = fake(root, {
      decision: true,
      onDecision: boundary === "decision" ? () => { generation.revoked = true } : undefined,
      onSwitch: boundary === "switch" ? () => { generation.revoked = true } : undefined,
    })
    generation = f.generation
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("revoked")
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("Planner bootstrap rejects forbidden or unfinished tools and slot rejects any tool or non-READY result", async (observer) => {
  for (const [sessionID, name, status] of [
    ["planner-child", "edit", "completed"], ["planner-child", "read", "running"],
    ["slot-child", "read", "completed"], ["slot-child", "glob", "completed"],
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    f.histories[sessionID!].splice(1, 0, { type: "assistant", id: "bootstrap-tool", agent: f.sessions[sessionID!].agent,
      content: [{ type: "tool", id: "bootstrap-call", name, state: { status, input: {}, content: [], metadata: {} } }] })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("disallowed tool")
    expect(f.calls.decided).toEqual([])
    expect(f.calls.switched).toEqual([])
  }
  const root = snapshotFixture(observer)
  const f = fake(root, { decision: true })
  f.histories["slot-child"][1].content[0].text = "READY\n"
  await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("final text")
  expect(f.calls.decided).toEqual([])
})

snapshotTest("repeated message cursors and duplicate IDs across pages reject native binding", async (observer) => {
  for (const mutation of ["cursor", "id"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    const host = f.context as unknown as any
    host.client.message.list = async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
      const all = f.histories[sessionID]
      return cursor
        ? { data: mutation === "id" ? all : [], cursor: mutation === "cursor" ? { next: "rest" } : {} }
        : { data: all.slice(0, 2), cursor: { next: "rest" } }
    }
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(mutation === "cursor" ? "repeated a cursor" : "duplicate message ID")
    expect(f.calls.decided).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("existing parent and Planner content remains immutable across decision and switch", async (observer) => {
  for (const boundary of ["decision", "switch"] as const) {
    for (const sessionID of ["parent", "planner-child"]) {
      const root = snapshotFixture(observer)
      const mutate = () => { f.histories[sessionID][sessionID === "parent" ? 3 : 1].content[0].text += " changed" }
      const f = fake(root, { decision: true, onDecision: boundary === "decision" ? mutate : undefined,
        onSwitch: boundary === "switch" ? mutate : undefined })
      await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(/transcript changed|output differs from exact child result/)
      expect(f.calls.prompted).toEqual([])
      expect(f.calls.switched).toHaveLength(boundary === "decision" ? 0 : 1)
    }
  }
})

snapshotTest("slot is rechecked after awaited parent verification before trusted prompt", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { decision: true, onGet: (sessionID) => {
    if (sessionID === "parent" && f.calls.switched.length) f.histories["slot-child"].push(user("late-input", "continued"))
  } })
  await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("before trusted prompt")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("post-switch session permission overrides cannot admit the trusted prompt", async (observer) => {
  for (const sessionID of ["parent", "planner-child", "slot-child"]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true, onSwitch: () => {
      f.sessions[sessionID].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
    } })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("permissions")
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
    const result = publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    if (mutation === "none") {
      const published = await result
      expect(f.calls.synthetic[0].description).toBe(renderPlan(published.candidate))
      expect(published.candidate.proposal.plan).toBe("Update its contents\nCheck the result")
    } else await expect(result).rejects.toThrow("admission changed")
    expect(f.calls.synthetic[0].text).toBe(raw)
    expect(f.calls.synthetic[0].resume).toBe(false)
    expect(f.calls.decided).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("a delivered Plan never relaxes the original native history binding", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { decision: true })
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  f.claim(published)
  f.histories.parent.push({ type: "synthetic", id: published.publication.id, text: proposal,
    description: renderPlan(published.candidate), metadata: published.publication.payload.metadata })
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("parent transcript changed")
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("publication refuses pending inbox input and a changed publication path set", async (observer) => {
  for (const mutation of ["inbox", "paths"] as const) {
    const root = snapshotFixture(observer)
    observer.configure(root, HEAD, ["old.txt"])
    const baseline = observeGit(root)
    const f = fake(root)
    if (mutation === "paths") observer.configure(root, HEAD, ["old.txt", "new.txt"])
    else (f.context as unknown as any).client.session.inbox.list = async () => [{ id: "pending" }]
    await expect(publication(f.context, f.generation, baseline, "parent", { directory: root })).rejects.toThrow(mutation === "paths" ? "publication worktree paths changed" : "pending input")
    expect(f.calls.synthetic).toEqual([])
    expect(f.calls.decided).toEqual([])
  }
})

snapshotTest("trusted prompt admission rejects substituted identity or attachments without redispatch", async (observer) => {
  for (const mutation of ["sessionID", "type", "id", "files", "agents", "skills"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    const host = f.context as unknown as any
    const prompt = host.client.session.prompt
    host.client.session.prompt = async (input: any) => {
      const returned = await prompt(input)
      if (["files", "agents", "skills"].includes(mutation)) returned.payload[mutation] = ["attachment"]
      else returned[mutation] = mutation === "id" ? "" : "substituted"
      return returned
    }
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("unexpected input")
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted).toHaveLength(1)
  }
})

snapshotTest("activation location substitution during decision cannot switch or dispatch", async (observer) => {
  for (const field of ["directory", "workspaceID"] as const) {
    const root = snapshotFixture(observer)
    const [location, setLocation] = createStore({ directory: root, workspaceID: undefined as string | undefined,
      project: { id: "project", directory: root, canonical: root } })
    const f = fake(root, { decision: true, onDecision: () => { setLocation(field, "changed") } })
    Object.defineProperty(f.context, "location", { get: () => location })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("TUI location changed")
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})


async function settleUntil(done: () => boolean) {
  for (let i = 0; i < 2000 && !done(); i++) await Promise.resolve()
  expect(done()).toBe(true)
}
async function activate(f: ReturnType<typeof fake>, created?: number) {
  const cleanup = await plugin.setup(f.context)
  f.sessions.parent.time.created = created ?? Date.now() + 10
  f.emit(f.created())
  f.emit({ type: "session.execution.succeeded", id: "evt_completed", created: Date.now() + 20, data: { sessionID: "parent" } })
  await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
  return () => { if (typeof cleanup === "function") cleanup() }
}
function mount(f: ReturnType<typeof fake>, sessionID = "parent", completeLayout = true) {
  const registration = f.slots.at(-1)!
  expect(registration.claim.append).toBe("session.composer.top")
  const begin = elements.length
  let dispose!: () => void
  const view = createRoot((release) => { dispose = release; return registration.claim.render({ sessionID }) })
  const mounted = elements.slice(begin)
  registration.dispose = dispose
  if (completeLayout) f.renderer.emit("frame")
  const buttons = mounted.filter((node) => node.onMouseUp)
  const click = (index: number, button = 0) => buttons[index]?.onMouseUp({ button, stopPropagation() {} })
  const text = () => elements.slice(begin).filter((node) => node.type === "literal").map((node) => String(node.value)).join(" ")
  return { view, mounted, buttons, click, text, dispose }
}

test("location snapshots detach and freeze the identity fields of non-cloneable host info", () => {
  const [location, setLocation] = createStore({ directory: "/original", workspaceID: "workspace-original",
    project: { id: "project", directory: "/project", canonical: "/canonical" } })
  expect(() => structuredClone(location)).toThrow()
  const snapshot = snapshotLocation(location)
  expect(snapshot).toEqual({ directory: "/original", workspaceID: "workspace-original" })
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(() => { (snapshot as any).directory = "/forged" }).toThrow()
  setLocation("directory", "/changed")
  setLocation("workspaceID", "workspace-changed")
  setLocation("project", "canonical", "/changed")
  expect(snapshot).toEqual({ directory: "/original", workspaceID: "workspace-original" })
  expect(snapshotLocation({ directory: "/default", workspaceID: undefined })).toEqual({ directory: "/default" })
})

snapshotTest("TUI startup accepts non-cloneable synchronized location info and default refs", async (observer) => {
  for (const source of ["current", "default"] as const) {
    const root = snapshotFixture(observer)
    // OpenCode 2.0.20 returns store-backed Location.PublicInfo from context.location.
    // Before sync, the plugin falls back to a Location.Ref instead.
    const [store] = createStore({ info: { directory: root, project: { id: "project", directory: root, canonical: root } },
      ref: { directory: root } })
    expect(() => structuredClone(source === "current" ? store.info : store.ref)).toThrow()
    const f = fake(root)
    let synchronized = source === "current"
    Object.defineProperty(f.context, "location", { get: () => synchronized ? store.info : undefined })
    Object.assign(f.context.data.location, { default: () => store.ref })
    const cleanup = await plugin.setup(f.context)
    expect(f.handlers.has("session.created")).toBe(true)
    expect(f.calls.synthetic).toEqual([])
    expect(f.calls.prompted).toEqual([])
    expect(observer.calls(root)).toHaveLength(1)
    synchronized = true
    f.sessions.parent.time.created = Date.now() + 10
    f.emit(f.created())
    f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
    await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
    const view = mount(f)
    expect(view.buttons).toHaveLength(2)
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted).toHaveLength(1)
    if (typeof cleanup === "function") cleanup()
    view.dispose()
  }
})

snapshotTest("TUI startup location evidence survives proxy mutation and rejects identity drift", async (observer) => {
  for (const field of ["directory", "workspaceID"] as const) {
    const root = snapshotFixture(observer)
    const [location, setLocation] = createStore({ directory: root, workspaceID: undefined as string | undefined,
      project: { id: "project", directory: root, canonical: root } })
    const f = fake(root)
    Object.defineProperty(f.context, "location", { get: () => location })
    const cleanup = await plugin.setup(f.context)
    setLocation(field, "changed")
    f.sessions.parent.time.created = Date.now() + 10
    f.emit(f.created())
    f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("TUI location changed")
    expect(f.calls.synthetic).toEqual([])
    expect(f.slots).toHaveLength(1)
    const view = mount(f)
    expect(view.buttons).toEqual([])
    expect(view.text()).toContain("STOP — Implementation was not admitted")
    view.dispose()
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    if (typeof cleanup === "function") cleanup()
  }
})

snapshotTest("retained evidence is copied, deeply immutable, and coherent", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  for (const value of [published, published.activation, published.activation.location, published.activation.creation,
    published.activation.creation.data, published.bound, published.bound.slot, published.bound.plannerChild,
    published.publication, published.publication.payload, published.publication.payload.metadata, published.publication.time]) expect(Object.isFrozen(value)).toBe(true)
  expect(() => { (published.bound.slot as any).childID = "replacement" }).toThrow()
  f.sessions.parent.location.directory = "different"
  expect(published.activation.location.directory).toBe(root)
  assertPublishedCoherence(published)
  for (const mutation of [
    { ...published, candidate: { ...published.candidate, root: "different" } },
    { ...published, bound: { ...published.bound, slot: { ...published.bound.slot, childID: "replacement" } } },
    { ...published, publication: { ...published.publication, payload: { ...published.publication.payload, metadata: { source: "planner", planHash: "forged" } } } },
  ]) expect(() => assertPublishedCoherence(mutation as PublishedAttempt)).toThrow()
})

snapshotTest("initial eligibility requires clean observation strictly before matching root creation", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const baseline = observeGit(root)
  for (const created of [undefined, NaN, 0, 1, 2]) {
    const event = { ...f.created(), created }
    const activation = activationEvidence(f.generation, { directory: root }, baseline, 1, event as any)
    expect(initiallyAuthorizable(activation)).toBe(created === 2)
  }
  observer.configure(root, HEAD, ["old.txt"])
  const dirty = activationEvidence(f.generation, { directory: root }, observeGit(root), 0, f.created() as any)
  observer.configure(root)
  expect(initiallyAuthorizable(dirty)).toBe(false)
  const changed = await publication(f.context, f.generation, baseline, "parent", { directory: root })
  f.sessions.parent.time.created = 20
  await expect(verifyPublishedAttempt(f.context, changed, f.guard)).rejects.toThrow("creation identity changed")
})

snapshotTest("exact pending publication admits reordered keys and rejects every altered field or extra item", async (observer) => {
  for (const mutation of ["keys", "id", "sessionID", "delivery", "time", "text", "description", "metadata", "payload-key", "item-key", "extra", "promotion"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    const item = f.inboxes.parent[0]
    if (mutation === "keys") {
      f.inboxes.parent[0] = Object.fromEntries(Object.entries(item).reverse())
      expect(publishedPresentationMatches(f.context, published)).toBe(true)
      await verifyPublishedAttempt(f.context, published, f.guard)
    } else {
      if (mutation === "extra") f.inboxes.parent.push({ ...item, id: "extra" })
      else if (mutation === "promotion") { f.inboxes.parent = []; f.histories.parent.push(f.cache.parent.at(-1)) }
      else if (mutation === "time") item.time.created++
      else if (["text", "description"].includes(mutation)) item.payload[mutation] += " "
      else if (mutation === "metadata") item.payload.metadata.planHash = "forged"
      else if (mutation === "payload-key") item.payload.extra = true
      else if (mutation === "item-key") item.extra = true
      else item[mutation] = "different"
      await expect(verifyPublishedAttempt(f.context, published, f.guard)).rejects.toThrow()
    }
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("TUI pointer authorization claims synchronously and dispatches one exact retained slot", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { onPrompt: () => observer.configure(root, HEAD, ["old.txt"]) })
  const cleanup = await activate(f)
  const view = mount(f)
  const retainedCache = structuredClone(f.cache.parent)
  const retainedPublication = structuredClone(f.inboxes.parent)
  const planHash = f.inboxes.parent[0].payload.metadata.planHash
  expect(view.buttons).toHaveLength(2)
  expect(view.text()).toContain("Do you authorize this plan for implementation?")
  expect(view.text()).toContain(`Worktree: ${JSON.stringify(root)}`)
  expect(view.text()).toContain(`Plan ${planHash} · HEAD ${HEAD.slice(0, 12)}`)
  expect(view.text()).toContain("Authorize")
  expect(view.text()).toContain("Cancel")
  view.click(0, 2)
  expect(f.calls.switched).toEqual([])
  view.click(0)
  expect(f.slots[0].removed).toBe(false)
  expect(view.text()).toContain("Authorization claimed — implementation admission in progress…")
  view.click(0)
  view.click(1)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("STOP before Reviewer / Commit")
  expect(view.text()).toContain("Implementation gate complete")
  expect(view.text()).toContain(`HEAD ${HEAD} unchanged`)
  expect(view.text()).toContain("Resulting paths (1): old.txt")
  expect(view.text()).toContain("STOP before Reviewer / Commit")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toHaveLength(1)
  expect(f.calls.prompted[0].text).toContain(`Bound HEAD: ${HEAD}`)
  expect(f.inboxes.parent).toHaveLength(1)
  expect(f.cache.parent).toEqual(retainedCache)
  expect(f.inboxes.parent).toEqual(retainedPublication)
  cleanup(); view.dispose()
  expect(f.handlers.size).toBe(0)
  expect(f.listeners.size).toBe(0)
})

snapshotTest("Cancel wins once, keeps the Plan, and stale Authorize stays inert", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const plan = structuredClone(f.cache.parent)
  const publication = structuredClone(f.inboxes.parent)
  view.click(1); view.click(0); view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expect(view.text()).toContain("Cancelled — no implementation admitted")
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(f.cache.parent).toEqual(plan)
  expect(f.inboxes.parent).toHaveLength(1)
  expect(f.inboxes.parent).toEqual(publication)
  cleanup(); view.dispose()
})

snapshotTest("trusted STOP status persists before dispatch and keeps the Plan unchanged", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const retainedCache = structuredClone(f.cache.parent)
  const retainedPublication = structuredClone(f.inboxes.parent)
  f.emit({ type: "session.execution.started", id: "evt_unexpected", data: { sessionID: "parent" } })
  expect(view.text()).toContain("STOP — Implementation was not admitted; no implementation prompt was dispatched.")
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(f.cache.parent).toEqual(retainedCache)
  expect(f.inboxes.parent).toEqual(retainedPublication)
  view.click(0)
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  cleanup(); view.dispose()
})

snapshotTest("trusted STOP status after dispatch warns implementation may have started without resending", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { promptError: true })
  const cleanup = await activate(f)
  const view = mount(f)
  const retainedCache = structuredClone(f.cache.parent)
  const retainedPublication = structuredClone(f.inboxes.parent)
  view.click(0)
  expect(view.text()).toContain("Authorization claimed — implementation admission in progress…")
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(view.text()).toContain("STOP — Implementation may already have started; no prompt will be resent.")
  expect(f.calls.prompted).toHaveLength(1)
  expect(f.cache.parent).toEqual(retainedCache)
  expect(f.inboxes.parent).toEqual(retainedPublication)
  cleanup(); view.dispose()
})

snapshotTest("initially dirty stable Plan publishes explicit inert UX and cannot become authorizable", async (observer) => {
  const root = snapshotFixture(observer)
  observer.configure(root, HEAD, ["old.txt"])
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  expect(view.buttons).toEqual([])
  expect(view.mounted.filter((node) => node.type === "literal").map((node) => String(node.value)).join(" ")).toContain("worktree was dirty")
  observer.configure(root)
  f.renderer.emit("resize")
  expect(f.slots).toHaveLength(1)
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(f.calls.synthetic).toHaveLength(1)
  cleanup(); view.dispose()
})

snapshotTest("buffered, equal, and missing Created times only publish non-authorizing status", async (observer) => {
  for (const time of [1, undefined]) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await plugin.setup(f.context)
    f.emit({ ...f.created(), created: time })
    f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
    await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
    const view = mount(f)
    expect(view.buttons).toEqual([])
    expect(view.mounted.filter((node) => node.type === "literal").map((node) => String(node.value)).join(" ")).toContain("ordering could not be proven")
    if (typeof cleanup === "function") cleanup()
    view.dispose()
  }
})

snapshotTest("root wake during publication permanently stops before installing controls", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const host = f.context as any
  const synthetic = host.client.session.synthetic
  host.client.session.synthetic = async (input: any) => {
    const admitted = await synthetic(input)
    f.emit({ type: "session.execution.started", id: "evt_wake", data: { sessionID: "parent" } })
    return admitted
  }
  const cleanup = await activate(f)
  expect(f.slots).toHaveLength(1)
  expect(f.calls.toasts.at(-1)).toContain("Unexpected session.execution.started")
  const view = mount(f)
  expect(view.buttons).toEqual([])
  expect(view.text()).toContain("STOP — Implementation was not admitted")
  view.dispose()
  expect(f.calls.switched).toEqual([])
  cleanup()
})

snapshotTest("lost view, navigation, projection mutation, and cleanup cannot restore controls", async (observer) => {
  for (const loss of ["unmount", "navigation", "location", "projection", "wake", "cleanup"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    if (loss === "unmount") view.dispose()
    if (loss === "navigation") (f.context.ui.router as any).current = () => ({ type: "session", sessionID: "planner-child" })
    if (loss === "location") (f.context as any).location.directory = "different"
    if (loss === "projection") f.cache.parent.at(-1).description += " changed"
    if (loss === "wake") f.emit({ type: "session.execution.started", id: "evt_wake", data: { sessionID: "parent" } })
    if (loss === "cleanup") cleanup()
    view.click(0)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    if (loss === "unmount") expect(f.calls.toasts.at(-1)).toContain("Authorization view was lost")
    f.renderer.terminalWidth = 120
    f.renderer.emit("resize")
    f.renderer.emit("frame")
    view.click(0)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    if (loss === "unmount") {
      const later = mount(f)
      expect(later.buttons).toEqual([])
      expect(later.text()).toContain("STOP — Implementation was not admitted")
      later.dispose()
    }
    cleanup(); view.dispose()
  }
})

snapshotTest("claimed authorization still stops on non-layout drift during awaited switch", async (observer) => {
  for (const drift of ["route", "location", "head", "dirty", "projection", "native", "permissions", "cleanup"] as const) {
    const root = snapshotFixture(observer)
    let cleanup!: () => void
    const f = fake(root, { onSwitch: () => {
      if (drift === "route") (f.context.ui.router as any).current = () => ({ type: "home" })
      if (drift === "location") (f.context as any).location.workspaceID = "different"
      if (drift === "head") observer.configure(root, "2".repeat(40))
      if (drift === "dirty") observer.configure(root, HEAD, ["old.txt"])
      if (drift === "projection") f.cache.parent.at(-1).description += " changed"
      if (drift === "native") f.histories["planner-child"][1].content[0].text += " changed"
      if (drift === "permissions") f.sessions["slot-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
      if (drift === "cleanup") cleanup()
    } })
    cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    await settleUntil(() => drift === "cleanup" ? f.calls.switched.length > 0 : f.calls.toasts.length > 0)
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted).toEqual([])
    view.click(0)
    expect(f.calls.switched).toHaveLength(1)
    cleanup(); view.dispose()
  }
})

snapshotTest("pending resize rejects stale callbacks and resize back needs a fresh completed frame", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const retainedPublication = structuredClone(f.inboxes.parent)
  f.renderer.terminalWidth = 80
  f.renderer.emit("resize")
  // Descendants and captured callbacks still belong to the old valid frame.
  expect(view.mounted[0].width).toBe(120)
  view.click(0); view.click(1)
  f.renderer.terminalWidth = 120
  f.renderer.emit("resize")
  view.click(0); view.click(1)
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  expect(f.calls.toasts).toEqual([])
  expect(view.text()).not.toContain("Authorization claimed")
  expect(f.inboxes.parent).toEqual(retainedPublication)
  f.renderer.emit("frame")
  view.click(0)
  expect(view.text()).toContain("Authorization claimed")
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toHaveLength(1)
  expect(f.calls.synthetic).toHaveLength(1)
  cleanup(); view.dispose()
})

snapshotTest("pending invalid frames clear the entire proof and recover only on a valid completed frame", async (observer) => {
  for (const invalid of ["small-width", "small-height", "surface", "wrap", "worktree", "binding", "question", "authorize", "cancel", "viewport"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    const copy = view.mounted.filter((node) => node.type === "text" && node.wrapMode === "char")
    // Keep viewport identity unchanged for detailed-check failures: an early
    // viewport snapshot must not turn a partially validated frame into proof.
    if (invalid === "small-width") { f.renderer.terminalWidth = 79; f.renderer.emit("resize") }
    if (invalid === "small-height") { f.renderer.terminalHeight = 23; f.renderer.emit("resize") }
    if (invalid === "surface") view.mounted[0].height = 2
    if (invalid === "wrap") copy[0].height = 2
    if (invalid === "worktree") copy[0].width = 1
    if (invalid === "binding") copy[1].width = 1
    if (invalid === "question") copy[2].width = 1
    if (invalid === "authorize") view.buttons[0].width = 3
    if (invalid === "cancel") view.buttons[1].width = 3
    if (invalid === "viewport") view.buttons[1].screenY = 60
    f.renderer.emit("frame")
    view.click(0); view.click(1)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    expect(f.calls.toasts).toEqual([])
    // Repair all geometry without a completed frame. This is still inert.
    f.renderer.terminalWidth = 120
    f.renderer.terminalHeight = 60
    if (invalid.startsWith("small-")) f.renderer.emit("resize")
    view.mounted[0].height = 4
    for (const node of copy) { node.height = 1; node.width = 120 }
    for (const node of view.buttons) { node.width = 13; node.screenY = 0 }
    view.click(0); view.click(1)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    expect(f.calls.toasts).toEqual([])
    f.renderer.emit("frame")
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
    expect(f.calls.switched).toEqual(["slot-child"])
    expect(f.calls.prompted).toHaveLength(1)
    expect(f.calls.synthetic).toHaveLength(1)
    cleanup(); view.dispose()
  }
})

snapshotTest("pending resize remeasures current wrapping and waits for the follow-up frame", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const surface = view.mounted[0]
  const copy = view.mounted.filter((node) => node.type === "text" && node.wrapMode === "char")
  f.renderer.terminalWidth = 80
  f.renderer.emit("resize")
  // Supply current descendant bounds; the first frame still schedules wrapping.
  for (const node of view.mounted.filter((node) => node.type === "box" || node.type === "text")) {
    if (!node.onMouseUp) node.width = 80
  }
  f.renderer.emit("frame")
  view.click(0); view.click(1)
  expect(f.calls.toasts).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  const rows = Math.ceil([...`Worktree: ${JSON.stringify(root)}`].length / 80)
  expect(rows).toBeLessThanOrEqual(2)
  surface.height = rows + 3
  copy[0].height = rows
  f.renderer.emit("frame")
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toHaveLength(1)
  cleanup(); view.dispose()
})

snapshotTest("the synchronous decision boundary rechecks detailed geometry against its completed-frame proof", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  // Mutate a descendant after a valid frame without delivering another frame.
  view.buttons[1].screenX = 120
  view.click(0)
  expect(f.calls.toasts).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  view.buttons[1].screenX = 0
  view.click(0); view.click(1)
  expect(f.calls.toasts).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  f.renderer.emit("frame")
  view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  cleanup(); view.dispose()
})

snapshotTest("sub-minimum pending geometry before mount can recover without replacing the publication", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  f.renderer.terminalWidth = 40
  f.renderer.terminalHeight = 20
  const cleanup = await activate(f)
  const view = mount(f)
  view.click(0); view.click(1)
  expect(f.calls.toasts).toEqual([])
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  f.renderer.terminalWidth = 120
  f.renderer.terminalHeight = 60
  f.renderer.emit("resize")
  view.click(0)
  expect(f.calls.switched).toEqual([])
  f.renderer.emit("frame")
  view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expect(f.calls.synthetic).toHaveLength(1)
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
  cleanup(); view.dispose()
})

snapshotTest("post-claim resize and DecisionStrip replacement cleanup preserve the same continuation", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  let release!: () => void
  let waiting = false
  const paused = new Promise<void>((resolve) => { release = resolve })
  const host = f.context as any
  const get = host.client.session.get
  host.client.session.get = async (input: any) => {
    const result = await get(input)
    if (f.calls.switched.length && !waiting) {
      waiting = true
      await paused
    }
    return result
  }
  const cleanup = await activate(f)
  const view = mount(f)
  expect(f.renderer.listenerCount("frame")).toBe(2)
  view.click(0)
  expect(view.text()).toContain("Authorization claimed — implementation admission in progress…")
  // Keyed status replacement disposed the DecisionStrip frame subscription.
  expect(f.renderer.listenerCount("frame")).toBe(1)
  await settleUntil(() => waiting)
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(view.mounted[0].width).toBe(120)
  f.renderer.emit("frame")
  for (const width of [80, 40, 160]) {
    f.renderer.terminalWidth = width
    f.renderer.emit("resize")
    // Both stale and freshly changed presentation geometry are harmless.
    f.renderer.emit("frame")
    view.mounted[0].width = width
    f.renderer.emit("frame")
    view.click(0); view.click(1)
    expect(f.calls.toasts).toEqual([])
    expect(f.calls.prompted).toEqual([])
    expect(f.renderer.listenerCount("frame")).toBe(1)
  }
  view.dispose()
  const status = mount(f)
  expect(status.buttons).toEqual([])
  expect(status.text()).toContain("Authorization claimed — implementation admission in progress…")
  release()
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(status.text()).toContain("Implementation gate complete")
  expect(f.calls.toasts.at(-1)).toContain("STOP before Reviewer / Commit")
  expect(f.calls.switched).toEqual(["slot-child"])
  expect(f.calls.prompted).toHaveLength(1)
  expect(f.calls.prompted[0]).toEqual({ sessionID: "slot-child", text: implementerPrompt(makeCandidate(parseProposal(proposal, root), root, HEAD)) })
  expect(Object.keys(f.sessions).sort()).toEqual(["parent", "planner-child", "slot-child"])
  view.click(0); view.click(1)
  f.renderer.emit("resize")
  f.renderer.emit("frame")
  expect(status.buttons).toEqual([])
  expect(f.calls.switched).toHaveLength(1)
  expect(f.calls.prompted).toHaveLength(1)
  cleanup(); status.dispose()
})

snapshotTest("switch identity, parent evidence, and slot results remain bound after implementation", async (observer) => {
  for (const mutation of ["switch-id", "switch-time", "switch-metadata", "parent", "planner", "permissions"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true, onPrompt: () => {
      const marker = f.histories["slot-child"].find((item) => item.type === "agent-switched")
      if (mutation === "switch-id") marker.id += "different"
      if (mutation === "switch-time") marker.time.created++
      if (mutation === "switch-metadata") marker.metadata = { altered: true }
      if (mutation === "parent") f.histories.parent.push(user("extra", "continued"))
      if (mutation === "planner") f.histories["planner-child"][1].content[0].text += " changed"
      if (mutation === "permissions") f.sessions["slot-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
    } })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(1)
  }
})

snapshotTest("publication and authorization reject drift at read, pagination, hydration, and admission boundaries", async (observer) => {
  for (const boundary of ["get", "active", "inbox", "messages", "pending-sync", "hydrate"] as const) {
    const root = snapshotFixture(observer)
    let mutated = false
    const f = fake(root, { onRead: (kind) => {
      if (!mutated && kind === boundary) { mutated = true; observer.configure(root, HEAD, ["old.txt"]) }
    } })
    await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("expected synthetic, switch, and implementation events reconcile before RPC responses", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { events: true })
  const cleanup = await activate(f)
  const view = mount(f)
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.prompted).toHaveLength(1)
  cleanup(); view.dispose()
})

snapshotTest("unexpected native events and mismatched late switch echoes permanently invalidate", async (observer) => {
  for (const event of [
    { type: "session.permissions", data: { sessionID: "parent", permissions: [] } },
    { type: "session.inbox.cancelled", data: { sessionID: "parent", inboxID: "different" } },
    { type: "session.inbox.delivery.changed", data: { sessionID: "parent", inboxID: "different", delivery: "queue" } },
    { type: "session.deleted", data: { sessionID: "planner-child" } },
    { type: "session.inbox.enqueued", data: { sessionID: "slot-child", inboxID: "extra", item: { type: "user", delivery: "steer", payload: { text: "extra" } } } },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    f.emit({ id: "evt_interference", created: 20, ...event })
    view.click(0)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    cleanup(); view.dispose()
  }
  const root = snapshotFixture(observer)
  let injected = false
  const f = fake(root, { onGet: (id) => {
    if (id === "parent" && f.calls.switched.length && !injected) {
      injected = true
      f.emit({ type: "session.agent.selected", id: "evt_substituted", created: 50,
        data: { sessionID: "slot-child", agent: "authorized_implementer", previous: "implementer_slot" } })
    }
  } })
  const cleanup = await activate(f)
  const view = mount(f)
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.prompted).toEqual([])
  cleanup(); view.dispose()
})

snapshotTest("cleanup revokes an awaited publication and replacement activation cannot inherit authority", async (observer) => {
  const root = snapshotFixture(observer)
  let release!: () => void
  let waiting = false
  const paused = new Promise<void>((resolve) => { release = resolve })
  const f = fake(root, { onWait: async () => { waiting = true; await paused } })
  const cleanup = await plugin.setup(f.context)
  f.emit(f.created())
  f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
  expect(waiting).toBe(true)
  if (typeof cleanup === "function") cleanup()
  release()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  expect(f.calls.synthetic).toEqual([])
  expect(f.calls.toasts).toEqual([])
  const replacement = await plugin.setup(f.context)
  f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
  expect(f.slots).toEqual([])
  expect(f.calls.synthetic).toEqual([])
  if (typeof replacement === "function") replacement()
})

snapshotTest("implementation result is frozen across the final parent/Planner await barrier", async (observer) => {
  const root = snapshotFixture(observer)
  let parentReads = 0
  const f = fake(root, { decision: true, onGet: (id) => {
    if (id === "parent" && f.calls.prompted.length && ++parentReads === 2)
      f.histories["slot-child"].find((item) => item.id === "implementer-final").content[0].text += " changed"
  } })
  await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("result transcript changed")
  expect(f.calls.prompted).toHaveLength(1)
})

snapshotTest("wrong or unclaimed decision ownership cannot grant or switch", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("decision owner")
  f.claim(published)
  await expect(authorizePublishedAttempt(f.context, { ...published }, f.guard)).rejects.toThrow("decision owner")
  expect(f.calls.switched).toEqual([])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("only a fresh successful root publishes, and duplicate completions never publish again", async (observer) => {
  for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await plugin.setup(f.context)
    const completed = { type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } }
    f.emit(completed)
    expect(f.calls.synthetic).toEqual([])
    f.sessions.parent.time.created = Date.now() + 10
    f.emit(f.created())
    f.emit({ ...completed, type: `session.execution.${outcome}`, id: outcome === "succeeded" ? completed.id : "evt_failed" })
    f.emit(completed)
    f.emit(completed)
    await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
    expect(f.calls.synthetic).toHaveLength(outcome === "succeeded" ? 1 : 0)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.prompted).toEqual([])
    if (typeof cleanup === "function") cleanup()
  }
})

snapshotTest("pointer controls wait for completed layout and reject clipped decision copy or hidden surfaces", async (observer) => {
  for (const layout of ["partial", "button-clipped", "hidden", "path-clipped", "binding-clipped", "question-clipped"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f, "parent", false)
    view.click(0)
    expect(f.calls.switched).toEqual([])
    expect(f.calls.toasts).toEqual([])
    if (layout === "button-clipped") view.buttons[0].width = 3
    if (layout === "hidden") view.mounted[0].visible = false
    const copy = view.mounted.filter((node) => node.type === "text" && node.wrapMode === "char")
    if (layout === "path-clipped") copy[0].width = 1
    if (layout === "binding-clipped") copy[1].width = 1
    if (layout === "question-clipped") copy[2].width = 1
    f.renderer.emit("frame")
    if (layout === "partial") {
      view.click(1)
      expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
    } else {
      view.click(0)
      if (layout === "hidden") expect(f.calls.toasts.at(-1)).toContain("surface")
      else expect(f.calls.toasts).toEqual([])
      expect(f.calls.switched).toEqual([])
      expect(f.calls.prompted).toEqual([])
    }
    cleanup(); view.dispose()
  }
})

snapshotTest("reactive navigation loss during a publication await latches before returning to root", async (observer) => {
  const root = snapshotFixture(observer)
  let release!: () => void
  let waiting = false
  const paused = new Promise<void>((resolve) => { release = resolve })
  const f = fake(root, { onWait: async () => { waiting = true; await paused } })
  const [route, setRoute] = (await import("solid-js")).createSignal<any>({ type: "session", sessionID: "parent" })
  ;(f.context.ui.router as any).current = route
  const cleanup = await plugin.setup(f.context)
  f.emit(f.created())
  f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
  expect(waiting).toBe(true)
  setRoute({ type: "home" })
  expect(f.calls.toasts.at(-1)).toContain("Root view")
  setRoute({ type: "session", sessionID: "parent" })
  release()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  expect(f.calls.synthetic).toEqual([])
  expect(f.calls.switched).toEqual([])
  if (typeof cleanup === "function") cleanup()
})
