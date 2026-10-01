import { afterAll, afterEach, expect, mock, test } from "bun:test"
import { execFileSync } from "node:child_process"
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import type { Generation } from "../src/cap.ts"
import * as attemptModule from "../src/attempt.ts"
import * as gitModule from "../src/git.ts"
import { observeGit, type GitSnapshot } from "../src/git.ts"
import { makeCandidate, parseProposal, candidateMessage, renderPlan } from "../src/proposal.ts"
import { activationEvidence, initiallyAuthorizable, assertPublishedCoherence, exactEvidence, publishedPresentationMatches,
  authorizePublishedAttempt, implementerPrompt, plannerInput, publishPlan as publish, snapshotLocation, verifyPublishedAttempt,
  type DecisionOwner, type PublishedAttempt } from "../src/attempt.ts"
import { createRoot, createEffect, createMemo, createComponent, createSignal } from "solid-js"
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
const model = { providerID: "provider", id: "model", variant: "default" }
const answer = (id: string, agent: string, value: string) => ({ type: "assistant", id, agent, model: { ...model }, finish: "stop", content: [text(value)] })
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
  onImport?: () => void
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
  const source = readFileSync(path.join(import.meta.dir, "../.opencode/agents/authorized_implementer.md"), "utf8").split("---\n")
  const frontmatter = Bun.YAML.parse(source[1]!) as any
  // OpenCode 2.0.21 Agent.Info.default + Agent.Service prefix, with isolated
  // stand-ins for global paths; config appends the exact authored rules in order.
  const defaults = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "ask" },
    { action: "read", resource: "*.env", effect: "ask" },
    { action: "read", resource: "*.env.*", effect: "ask" },
    { action: "read", resource: "*.env.example", effect: "allow" },
    ...["data/shell/*/*", "data/tool-output/*", "tmp/*", "config/*"].map((resource) =>
      ({ action: "external_directory", resource: `/test/opencode-global/${resource}`, effect: "allow" })),
  ]
  const role = { ...frontmatter, id: "authorized_implementer", name: "authorized_implementer",
    request: { settings: {}, headers: {}, body: {} }, system: source[2]!.trim(),
    // The built-in browser plugin appends this after config for every agent.
    permissions: [...defaults, ...frontmatter.permissions, { action: "browser", resource: "*", effect: "deny" }] }
  const histories: Record<string, any[]> = {
    parent: [user("parent-user", request),
      { type: "assistant", id: "planner-tool-message", agent: "orchestrator", model: { ...model }, content: [call("planner-call", "planner", plannerInput(request), "planner-child", proposal)] },
      answer("parent-final", "orchestrator", "Plan prepared; awaiting human authorization."), idle("parent-idle")],
    "planner-child": [user("planner-user", prefix + plannerInput(request)), answer("planner-final", "planner", proposal), idle("planner-idle")],
  }
  const sessions: Record<string, any> = {
    parent: { id: "parent", agent: "orchestrator", model: { ...model }, projectID: "project", metadata: { policy: "family" }, location: { directory: root }, outcome: "succeeded", time: { created: 1, idle: 2 } },
    "planner-child": { id: "planner-child", parentID: "parent", agent: "planner", model: { ...model }, projectID: "project", location: { directory: root }, outcome: "succeeded", time: { created: 1, idle: 2 } },
  }
  const inboxes: Record<string, any[]> = { parent: [], "planner-child": [] }
  const cache: Record<string, any[]> = structuredClone(histories)
  const handlers = new Map<string, (event: any) => void>()
  const listeners = new Set<(event: any) => void>()
  const slots: any[] = []
  const renderer = Object.assign(new EventEmitter(), { terminalWidth: 120, terminalHeight: 60, isDestroyed: false })
  const calls = { created: [] as string[], imported: [] as any[], prompted: [] as Array<{ sessionID: string; text: string }>, decided: [] as string[],
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
        import: async (input: any) => {
          calls.imported.push(structuredClone(input))
          const info = structuredClone(input.info)
          if (sessions[info.id]) throw new Error("import collision")
          calls.created.push(info.id)
          sessions[info.id] = info
          histories[info.id] = []
          inboxes[info.id] = []
          if (options.events) emit({ type: "session.created", id: "evt_child_created", created: info.time.created + 1,
            data: { sessionID: info.id, parentID: info.parentID, agent: info.agent, model: info.model, projectID: info.projectID,
              subpath: info.subpath ?? "", location: info.location, metadata: info.metadata, permissions: info.permissions } })
          options.onImport?.()
          return structuredClone(info)
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
          sessions[sessionID].outcome = "succeeded"
          sessions[sessionID].time.idle = sessions[sessionID].time.created + 1
          const final = answer("implementer-final", "authorized_implementer", "Done")
          final.model = structuredClone(sessions[sessionID].model)
          histories[sessionID].push(user(id, value), final, idle("implementer-idle"))
          if (options.events) emit({ type: "session.execution.succeeded", id: "evt_implemented", created: 8, data: { sessionID } })
          if (options.promptError) throw new Error("ambiguous prompt transport failure")
          return { type: "user", id: options.promptIDMismatch ? "different-id" : id, sessionID, delivery: "steer", time: { created: 5 },
            payload: { text: options.promptMismatch ? "different" : value, files: [], agents: [], skills: [] } }
        },
      },
      agent: { get: async () => { options.onRead?.("role"); return { location: { directory: root }, data: role } } },
      model: { list: async () => { options.onRead?.("catalog"); return { location: { directory: root }, data: [{ ...model, enabled: true, variants: [] }] } } },
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
  const f = { context, generation, role, get childID(): string { return calls.created[0]! }, histories, sessions, inboxes, cache, slots, handlers, listeners, calls, options, guard, claim, created, emit, renderer }
  fakes.set(context, f)
  return f
}
function expectNoImplementation(f: ReturnType<typeof fake>) {
  expect(f.calls.imported).toHaveLength(0)
  expect(f.calls.created).toHaveLength(0)
  expect(Object.keys(f.sessions).sort()).toEqual(["parent", "planner-child"])
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

// Native/CAP sequencing is doubled. The final result-read barrier and Git gate
// observe the real repository; unrelated host/policy reads use the snapshot double.
async function realImplementationGate(f: ReturnType<typeof fake>, baseline: GitSnapshot) {
  f.options.singlePage = true
  const observer = new SnapshotObserver()
  observer.configure(baseline.root, baseline.head, baseline.paths)
  const onRead = f.options.onRead
  let resultReads = 0
  f.options.onRead = (kind, id) => {
    onRead?.(kind, id)
    if (kind === "messages" && id === f.childID && f.calls.prompted.length && ++resultReads === 2)
      mock.module(gitModulePath, () => realGit)
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
  expectNoImplementation(f)
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

test("binds native calls and exact Planner result, authorizes the published candidate, creates and prompts exact child once", async () => {
  const root = fixture()
  const f = fake(root, { decision: true, onPrompt: () => writeFileSync(path.join(root, "old.txt"), "implemented\n") })
  const baseline = observeGit(root)
  const candidate = makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head)
  expect(await realImplementationGate(f, baseline)).toContain("Implementation gate complete")
  expect(f.calls.decided).toEqual([candidateMessage(candidate)])
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
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
  expect(f.calls.prompted).toEqual([{ sessionID: f.childID, text: trustedPrompt }])
  expect(f.calls.prompted[0].text).toContain(`Bound HEAD: ${baseline.head}`)
})

snapshotTest("Planner may complete read and search tools while the implementation child does not exist", async (observer) => {
  for (const tool of ["read", "glob", "grep"]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: false })
    f.histories["planner-child"].splice(1, 0, { type: "assistant", id: "planner-read", agent: "planner", content: [
      { type: "tool", id: "read-call", name: tool, state: { status: "completed", input: { path: "old.txt" }, content: [text("initial")], metadata: {} } },
    ] })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("cancelled")
    expect(f.calls.decided).toHaveLength(1)
    expectNoImplementation(f)
  }
})

snapshotTest("missing, duplicate, continued, background, or substituted native child evidence stops before decision", async (observer) => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content.pop() },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content.push(f.histories.parent[1].content[0]) },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.sessionID = "old-child" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.background = false },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.model = "other" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.input.prompt += " " },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.metadata.status = "running" },
    (f: ReturnType<typeof fake>) => { f.sessions["planner-child"].parentID = "other" },
    (f: ReturnType<typeof fake>) => { f.histories.parent[1].content[0].state.content[0].text = "paraphrase" },
    (f: ReturnType<typeof fake>) => { f.histories["planner-child"].push(user("extra", "extra")) },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    mutate(f)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.decided).toEqual([])
    expectNoImplementation(f)
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
    expectNoImplementation(f)
    observer.configure(root)
  }
  const revoked = fake(root, { decision: true })
  revoked.generation.revoked = true
  await expect(implement(revoked.context, revoked.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
  expectNoImplementation(revoked)
})

snapshotTest("after creation or ambiguous prompt, no second dispatch or child is created", async (observer) => {
  for (const options of [
    { decision: true, onImport: () => { throw new Error("creation uncertain") } },
    { decision: true, promptError: true },
    { decision: true, promptMismatch: true },
    { decision: true, promptIDMismatch: true },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, options)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
    expect(f.calls.prompted.length).toBeLessThanOrEqual(1)
  }
})

snapshotTest("stale binding after decision or creation and revoked generation after prompt stop without redispatch", async (observer) => {
  for (const boundary of ["decision", "creation", "prompt"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { decision: true,
      onDecision: boundary === "decision" ? () => { f.histories["planner-child"].push(user("extra-planner", "continued")) } : undefined,
      onImport: boundary === "creation" ? () => { f.histories[f.childID].push(user("extra-child", "continued")) } : undefined,
      onPrompt: boundary === "prompt" ? () => { f.generation.revoked = true } : undefined,
    })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.prompted).toHaveLength(boundary === "prompt" ? 1 : 0)
  }
})

snapshotTest("authorized result must remain in the exact child with one successful trusted input", async (observer) => {
  for (const mutation of ["none", "extra-input", "wrong-agent", "failed-outcome", "wrong-execution-model", "extra-control", "input-metadata", "wrong-input-id", "wrong-input-text"] as const) {
    const root = snapshotFixture(observer)
    let f: ReturnType<typeof fake>
    f = fake(root, { decision: true,
      onPrompt: mutation === "none" ? () => observer.configure(root, HEAD, ["old.txt"]) : undefined,
      onWait: (sessionID) => {
      if (sessionID !== f.childID) return
      if (mutation === "extra-input") f.histories[f.childID].push(user("extra", "more"))
      if (mutation === "wrong-agent") f.sessions[f.childID].agent = "planner"
      if (mutation === "failed-outcome") f.sessions[f.childID].outcome = "failed"
      if (mutation === "wrong-execution-model") f.histories[f.childID][1].model.id = "different"
      if (mutation === "extra-control") f.histories[f.childID].push({ type: "location-switched", id: "external" })
      if (mutation === "input-metadata") f.histories[f.childID][0].metadata = { altered: true }
      if (mutation === "wrong-input-id") f.histories[f.childID][0].id = "different"
      if (mutation === "wrong-input-text") f.histories[f.childID][0].text += " changed"
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
  for (const name of ["orchestrator", "planner", "authorized_implementer"]) {
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
  expect(effect(orchestrator, "subagent", "authorized_implementer")).toBe("deny")
  expect(effect(orchestrator, "edit")).toBe("deny")
  expect(effect(orchestrator, "shell", "git status")).toBe("deny")
  for (const name of ["planner"]) {
    const rules = load(name)
    for (const action of ["read", "glob", "grep"]) expect(effect(rules, action)).toBe("allow")
    for (const action of ["edit", "shell", "subagent", "write", "patch"]) expect(effect(rules, action)).toBe("deny")
  }
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

snapshotTest("session permission overrides and changed bound transcripts stop before child creation", async (observer) => {
  for (const mutate of [
    (f: ReturnType<typeof fake>) => { f.sessions.parent.permissions = [{ action: "shell", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.sessions["planner-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }] },
    (f: ReturnType<typeof fake>) => { f.histories.parent.push(user("extra-parent", "another request")) },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    mutate(f)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expectNoImplementation(f)
  }
})

snapshotTest("generation revocation after decision or creation stops before trusted prompt", async (observer) => {
  for (const boundary of ["decision", "creation"] as const) {
    const root = snapshotFixture(observer)
    let generation: Generation
    const f = fake(root, {
      decision: true,
      onDecision: boundary === "decision" ? () => { generation.revoked = true } : undefined,
      onImport: boundary === "creation" ? () => { generation.revoked = true } : undefined,
    })
    generation = f.generation
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("revoked")
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("Planner rejects forbidden or unfinished tools", async (observer) => {
  for (const [name, status] of [["edit", "completed"], ["read", "running"]]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    f.histories["planner-child"].splice(1, 0, { type: "assistant", id: "planner-tool", agent: "planner", model,
      content: [{ type: "tool", id: "planner-call", name, state: { status, input: {}, content: [], metadata: {} } }] })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("disallowed tool")
    expect(f.calls.decided).toEqual([])
    expectNoImplementation(f)
  }
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

snapshotTest("existing parent and Planner content remains immutable across decision and creation", async (observer) => {
  for (const boundary of ["decision", "creation"] as const) {
    for (const sessionID of ["parent", "planner-child"]) {
      const root = snapshotFixture(observer)
      const mutate = () => { f.histories[sessionID][sessionID === "parent" ? 2 : 1].content[0].text += " changed" }
      const f = fake(root, { decision: true, onDecision: boundary === "decision" ? mutate : undefined,
        onImport: boundary === "creation" ? mutate : undefined })
      await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(/transcript changed|output differs from exact child result/)
      expect(f.calls.prompted).toEqual([])
      expect(f.calls.created).toHaveLength(boundary === "decision" ? 0 : 1)
    }
  }
})

snapshotTest("child is rechecked after awaited parent verification before trusted prompt", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { decision: true, onGet: (sessionID) => {
    if (sessionID === "parent" && f.calls.created.length) f.histories[f.childID].push(user("late-input", "continued"))
  } })
  await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("before trusted prompt")
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
  expect(f.calls.prompted).toEqual([])
})

snapshotTest("post-creation session permission overrides cannot admit the trusted prompt", async (observer) => {
  for (const target of ["parent", "planner-child", "child"]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true, onImport: () => {
      f.sessions[target === "child" ? f.childID : target].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
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
  expectNoImplementation(f)
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
  for (const mutation of ["sessionID", "type", "id", "files", "agents", "skills", "metadata", "delivery", "time", "payload-extra"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    const host = f.context as unknown as any
    const prompt = host.client.session.prompt
    host.client.session.prompt = async (input: any) => {
      const returned = await prompt(input)
      if (["files", "agents", "skills"].includes(mutation)) returned.payload[mutation] = ["attachment"]
      else if (mutation === "metadata") returned.payload.metadata = { altered: true }
      else if (mutation === "payload-extra") returned.payload.unexpected = true
      else if (mutation === "time") returned.time.created = NaN
      else returned[mutation] = mutation === "id" ? "" : "substituted"
      return returned
    }
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("unexpected input")
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
    expect(f.calls.prompted).toHaveLength(1)
  }
})

snapshotTest("activation location substitution during decision cannot create or dispatch", async (observer) => {
  for (const field of ["directory", "workspaceID"] as const) {
    const root = snapshotFixture(observer)
    const [location, setLocation] = createStore({ directory: root, workspaceID: undefined as string | undefined,
      project: { id: "project", directory: root, canonical: root } })
    const f = fake(root, { decision: true, onDecision: () => { setLocation(field, "changed") } })
    Object.defineProperty(f.context, "location", { get: () => location })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("TUI location changed")
    expectNoImplementation(f)
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
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
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
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
    if (typeof cleanup === "function") cleanup()
  }
})

snapshotTest("retained evidence is copied, deeply immutable, and coherent", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  for (const value of [published, published.activation, published.activation.location, published.activation.creation,
    published.activation.creation.data, published.bound, published.bound.planner, published.bound.plannerChild,
    published.publication, published.publication.payload, published.publication.payload.metadata, published.publication.time]) expect(Object.isFrozen(value)).toBe(true)
  expect(() => { (published.bound.planner as any).childID = "replacement" }).toThrow()
  f.sessions.parent.location.directory = "different"
  expect(published.activation.location.directory).toBe(root)
  assertPublishedCoherence(published)
  for (const mutation of [
    { ...published, candidate: { ...published.candidate, root: "different" } },
    { ...published, bound: { ...published.bound, planner: { ...published.bound.planner, childID: "replacement" } } },
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
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("TUI pointer authorization claims synchronously and dispatches one exact created child", async (observer) => {
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
  expectNoImplementation(f)
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
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
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
  expectNoImplementation(f)
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
  expect(view.text()).toContain("STOP — Implementation was not admitted; no child created or implementation prompt was dispatched.")
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  expect(f.cache.parent).toEqual(retainedCache)
  expect(f.inboxes.parent).toEqual(retainedPublication)
  view.click(0)
  expectNoImplementation(f)
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
  expectNoImplementation(f)
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
  expectNoImplementation(f)
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
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
    if (loss === "unmount") expect(f.calls.toasts.at(-1)).toContain("Authorization view was lost")
    f.renderer.terminalWidth = 120
    f.renderer.emit("resize")
    f.renderer.emit("frame")
    view.click(0)
    expectNoImplementation(f)
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

snapshotTest("claimed authorization still stops on non-layout drift during awaited creation", async (observer) => {
  for (const drift of ["route", "location", "head", "dirty", "projection", "native", "permissions", "cleanup"] as const) {
    const root = snapshotFixture(observer)
    let cleanup!: () => void
    const f = fake(root, { onImport: () => {
      if (drift === "route") (f.context.ui.router as any).current = () => ({ type: "home" })
      if (drift === "location") (f.context as any).location.workspaceID = "different"
      if (drift === "head") observer.configure(root, "2".repeat(40))
      if (drift === "dirty") observer.configure(root, HEAD, ["old.txt"])
      if (drift === "projection") f.cache.parent.at(-1).description += " changed"
      if (drift === "native") f.histories["planner-child"][1].content[0].text += " changed"
      if (drift === "permissions") f.sessions[f.childID].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
      if (drift === "cleanup") cleanup()
    } })
    cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    await settleUntil(() => drift === "cleanup" ? f.calls.created.length > 0 : f.calls.toasts.length > 0)
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
    expect(f.calls.prompted).toEqual([])
    view.click(0)
    expect(f.calls.created).toHaveLength(1)
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
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  expect(f.calls.toasts).toEqual([])
  expect(view.text()).not.toContain("Authorization claimed")
  expect(f.inboxes.parent).toEqual(retainedPublication)
  f.renderer.emit("frame")
  view.click(0)
  expect(view.text()).toContain("Authorization claimed")
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
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
    expectNoImplementation(f)
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
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
    expect(f.calls.toasts).toEqual([])
    f.renderer.emit("frame")
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
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
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  const rows = Math.ceil([...`Worktree: ${JSON.stringify(root)}`].length / 80)
  expect(rows).toBeLessThanOrEqual(2)
  surface.height = rows + 3
  copy[0].height = rows
  f.renderer.emit("frame")
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
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
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  view.buttons[1].screenX = 0
  view.click(0); view.click(1)
  expect(f.calls.toasts).toEqual([])
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  f.renderer.emit("frame")
  view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expectNoImplementation(f)
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
  expectNoImplementation(f)
  expect(f.calls.prompted).toEqual([])
  f.renderer.terminalWidth = 120
  f.renderer.terminalHeight = 60
  f.renderer.emit("resize")
  view.click(0)
  expectNoImplementation(f)
  f.renderer.emit("frame")
  view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expect(f.calls.synthetic).toHaveLength(1)
  expectNoImplementation(f)
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
    if (f.calls.created.length && !waiting) {
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
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
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
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.created).toEqual([f.childID])
  expect(f.calls.prompted).toHaveLength(1)
  expect(f.calls.prompted[0]).toEqual({ sessionID: f.childID, text: implementerPrompt(makeCandidate(parseProposal(proposal, root), root, HEAD)) })
  expect(Object.keys(f.sessions).sort()).toEqual(["parent", "planner-child", f.childID])
  view.click(0); view.click(1)
  f.renderer.emit("resize")
  f.renderer.emit("frame")
  expect(status.buttons).toEqual([])
  expect(f.calls.created).toHaveLength(1)
  expect(f.calls.prompted).toHaveLength(1)
  cleanup(); status.dispose()
})

snapshotTest("creation identity, parent evidence, and child results remain bound after implementation", async (observer) => {
  for (const mutation of ["created", "model", "metadata", "parent", "planner", "permissions"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { onPrompt: () => {
      if (mutation === "created") f.sessions[f.childID].time.created++
      if (mutation === "model") f.sessions[f.childID].model.id += "different"
      if (mutation === "metadata") f.sessions[f.childID].metadata = { altered: true }
      if (mutation === "parent") f.histories.parent[2].content[0].text += " changed"
      if (mutation === "planner") f.histories["planner-child"][1].content[0].text += " changed"
      if (mutation === "permissions") f.sessions[f.childID].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
    } })
    const cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("STOP")
    expect(f.calls.prompted).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    cleanup(); view.dispose()
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
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
  }
})

snapshotTest("expected synthetic, creation, and implementation events reconcile before RPC responses", async (observer) => {
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

snapshotTest("unexpected native events and mismatched late creation echoes permanently invalidate", async (observer) => {
  for (const event of [
    { type: "session.permissions", data: { sessionID: "parent", permissions: [] } },
    { type: "session.inbox.cancelled", data: { sessionID: "parent", inboxID: "different" } },
    { type: "session.inbox.delivery.changed", data: { sessionID: "parent", inboxID: "different", delivery: "queue" } },
    { type: "session.deleted", data: { sessionID: "planner-child" } },
    { type: "session.inbox.enqueued", data: { sessionID: "planner-child", inboxID: "extra", item: { type: "user", delivery: "steer", payload: { text: "extra" } } } },
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    f.emit({ id: "evt_interference", created: 20, ...event })
    view.click(0)
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
    cleanup(); view.dispose()
  }
  const root = snapshotFixture(observer)
  let injected = false
  const f = fake(root, { onGet: (id) => {
    if (id === "parent" && f.calls.created.length && !injected) {
      injected = true
      f.emit({ type: "session.created", id: "evt_substituted", created: Date.now(),
        data: { sessionID: f.childID, agent: "authorized_implementer", parentID: "wrong" } })
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
      f.histories[f.childID].find((item) => item.id === "implementer-final").content[0].text += " changed"
  } })
  await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("result transcript changed")
  expect(f.calls.prompted).toHaveLength(1)
})

snapshotTest("wrong or unclaimed decision ownership cannot grant or create", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("decision owner")
  f.claim(published)
  await expect(authorizePublishedAttempt(f.context, { ...published }, f.guard)).rejects.toThrow("decision owner")
  expectNoImplementation(f)
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
    expectNoImplementation(f)
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
    expectNoImplementation(f)
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
      expectNoImplementation(f)
      expect(f.calls.prompted).toEqual([])
    }
    cleanup(); view.dispose()
  }
})

// Only these retained-publication cases intercept the real returned object.
// Restore the export before root return; the plugin keeps its private ownership.
async function startInspectedPublication(f: ReturnType<typeof fake>, beforeCompletion?: (select: (id: string) => void) => void) {
  const realAttempt = { ...attemptModule }
  const modulePath = path.resolve(import.meta.dir, "../src/attempt.ts")
  let resolve!: (published: PublishedAttempt) => void
  let reject!: (error: unknown) => void
  const returned = new Promise<PublishedAttempt>((done, failed) => { resolve = done; reject = failed })
  mock.module(modulePath, () => ({ ...realAttempt, publishPlan: async (...args: Parameters<typeof publish>) => {
    const published = await realAttempt.publishPlan(...args).catch((error) => { reject(error); throw error })
    resolve(published)
    return published
  } }))
  const [route, setRoute] = createSignal<any>({ type: "session", sessionID: "parent" })
  ;(f.context.ui.router as any).current = route
  const cleanup = await plugin.setup(f.context)
  const select = (sessionID: string) => setRoute({ type: "session", sessionID })
  f.sessions.parent.time.created = Date.now() + 10
  f.emit(f.created())
  beforeCompletion?.(select)
  const completed = { type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } }
  f.emit(completed)
  return {
    select, completed,
    finish: async () => {
      try {
        const published = await returned
        // Let the real TUI publication continuation take retained ownership.
        await Promise.resolve()
        expect(f.calls.toasts).toEqual([])
        expect(f.slots).toEqual([])
        return published
      } finally { mock.module(modulePath, () => realAttempt) }
    },
    cleanup: () => { mock.module(modulePath, () => realAttempt); if (typeof cleanup === "function") cleanup() },
  }
}

snapshotTest("Planner inspection before completion or during publication retains one Plan without a decision", async (observer) => {
  for (const boundary of ["before-completion", "wait", "hydrate"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root, { events: true })
    let release!: () => void
    let waiting = false
    const paused = new Promise<void>((resolve) => { release = resolve })
    if (boundary === "wait") f.options.onWait = async () => { waiting = true; await paused }
    if (boundary === "hydrate") {
      const sync = f.context.data.session.message.sync
      ;(f.context.data.session.message as any).sync = async (id: string) => {
        await sync(id)
        waiting = true
        await paused
      }
    }
    const attempt = await startInspectedPublication(f, boundary === "before-completion" ? (select) => select("planner-child") : undefined)
    try {
      if (boundary !== "before-completion") {
        await settleUntil(() => waiting)
        attempt.select("planner-child")
        release()
      }
      const published = await attempt.finish()
      expect(initiallyAuthorizable(published.activation)).toBe(true)
      expect(publishedPresentationMatches(f.context, published)).toBe(true)
      expect(f.calls.synthetic).toHaveLength(1)
      expect(f.calls.synthetic[0]).toEqual({ id: published.publication.id, sessionID: "parent", text: proposal,
        description: renderPlan(published.candidate), metadata: published.publication.payload.metadata, delivery: "steer", resume: false })
      f.emit(attempt.completed); f.emit(attempt.completed)
      f.renderer.emit("frame"); f.renderer.emit("resize")
      attempt.select("planner-child")
      attempt.select("unrelated-root")
      expect(f.slots).toEqual([])
      expect(f.calls.toasts).toEqual([])
      expectNoImplementation(f)
      expect(f.calls.prompted).toEqual([])
      attempt.select("parent")
      await settleUntil(() => f.slots.length > 0)
      const child = mount(f, "planner-child")
      expect(child.buttons).toEqual([])
      child.dispose()
      const view = mount(f)
      view.click(1)
      expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
      expect(f.calls.synthetic).toHaveLength(1)
      expectNoImplementation(f)
      expect(f.calls.prompted).toEqual([])
      view.dispose()
    } finally { release(); attempt.cleanup() }
  }
})

snapshotTest("root return revalidates the same retained object and needs a fresh root frame before one authorization", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { events: true, onPrompt: () => observer.configure(root, HEAD, ["old.txt"]) })
  f.renderer.emit("frame")
  const attempt = await startInspectedPublication(f, (select) => select("planner-child"))
  const modulePath = path.resolve(import.meta.dir, "../src/attempt.ts")
  let release!: () => void
  const paused = new Promise<void>((resolve) => { release = resolve })
  let waiting = false
  let view: ReturnType<typeof mount> | undefined
  try {
    const published = await attempt.finish()
    const evidence = structuredClone({ sessions: f.sessions, histories: f.histories, inbox: f.inboxes.parent, cache: f.cache.parent })
    const verified: PublishedAttempt[] = []
    const authorized: PublishedAttempt[] = []
    // Capture identity only in test scope, forwarding to the complete trusted operations.
    const restoredAttempt = { ...attemptModule }
    mock.module(modulePath, () => ({ ...restoredAttempt,
      verifyPublishedAttempt: async (...args: Parameters<typeof verifyPublishedAttempt>) => {
        verified.push(args[1])
        return restoredAttempt.verifyPublishedAttempt(...args)
      },
      authorizePublishedAttempt: (...args: Parameters<typeof authorizePublishedAttempt>) => {
        authorized.push(args[1]); return restoredAttempt.authorizePublishedAttempt(...args)
      },
    }))
    const get = f.context.client.session.get
    ;(f.context.client.session as any).get = async (input: any) => {
      const result = await get(input)
      if (!waiting) { waiting = true; await paused }
      return result
    }
    // Completed child and earlier root frames carry no decision proof.
    f.renderer.emit("frame")
    attempt.select("planner-child")
    attempt.select("parent")
    await settleUntil(() => waiting)
    f.emit(attempt.completed); f.renderer.emit("frame"); f.renderer.emit("resize")
    expect(f.slots).toEqual([])
    expectNoImplementation(f)
    expect(f.calls.prompted).toEqual([])
    release()
    await settleUntil(() => f.slots.length > 0)
    expect(verified).toEqual([published])
    expect(verified[0]).toBe(published)
    const child = mount(f, "planner-child")
    expect(child.buttons).toEqual([])
    child.dispose()
    view = mount(f, "parent", false)
    expect(view.buttons).toHaveLength(2)
    view.click(0); view.click(1)
    expect(authorized).toEqual([])
    // A newly mounted root at invalid geometry also stays inert.
    f.renderer.terminalWidth = 79
    f.renderer.emit("resize"); f.renderer.emit("frame")
    view.click(0); view.click(1)
    f.renderer.terminalWidth = 120
    f.renderer.emit("resize")
    view.click(0); view.click(1)
    expect(authorized).toEqual([])
    f.renderer.emit("frame")
    view.click(0); view.click(0); view.click(1)
    expect(authorized).toHaveLength(1)
    expect(authorized[0]).toBe(published)
    expect(authorized[0]!.candidate).toBe(published.candidate)
    expect(authorized[0]!.bound).toBe(published.bound)
    expect(authorized[0]!.publication).toBe(published.publication)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toEqual([f.childID])
    expect(f.calls.prompted).toEqual([{ sessionID: f.childID, text: implementerPrompt(published.candidate) }])
    expect(f.calls.synthetic).toHaveLength(1)
    expect(Object.keys(f.sessions).sort()).toEqual([...Object.keys(evidence.sessions), f.childID].sort())
    expect(f.histories.parent).toEqual(evidence.histories.parent)
    expect(f.histories["planner-child"]).toEqual(evidence.histories["planner-child"])
    expect(f.histories[f.childID]).toHaveLength(3)
    expect(f.inboxes.parent).toEqual(evidence.inbox)
    expect(f.cache.parent).toEqual(evidence.cache)
    expect(observer.calls(root).at(-1)!.current).toEqual({ root, head: HEAD, paths: ["old.txt"] })
  } finally {
    release(); attempt.cleanup(); view?.dispose()
  }
})

snapshotTest("stale root preparation cannot install a surface after navigation, cleanup, failure, or ownership closure", async (observer) => {
  for (const loss of ["navigation", "cleanup", "replacement-activation", "native-event", "renderer", "completed-verification-cleanup"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const attempt = await startInspectedPublication(f, (select) => select("planner-child"))
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    let waiting = false
    let replacement: Awaited<ReturnType<typeof plugin.setup>> = undefined
    let restore: (() => void) | undefined
    try {
      const published = await attempt.finish()
      if (loss === "completed-verification-cleanup") {
        const realAttempt = { ...attemptModule }
        const modulePath = path.resolve(import.meta.dir, "../src/attempt.ts")
        mock.module(modulePath, () => ({ ...realAttempt, verifyPublishedAttempt: async (...args: Parameters<typeof verifyPublishedAttempt>) => {
          await realAttempt.verifyPublishedAttempt(...args)
          waiting = true; await paused
        } }))
        restore = () => mock.module(modulePath, () => realAttempt)
      } else {
        const get = f.context.client.session.get
        ;(f.context.client.session as any).get = async (input: any) => {
          const result = await get(input)
          waiting = true; await paused
          return result
        }
      }
      attempt.select("parent")
      await settleUntil(() => waiting)
      expect(f.slots).toEqual([])
      if (loss === "navigation") { attempt.select("planner-child"); attempt.select("parent") }
      const revoked = loss === "cleanup" || loss === "replacement-activation" || loss === "completed-verification-cleanup"
      if (revoked) attempt.cleanup()
      if (loss === "replacement-activation") replacement = await plugin.setup(f.context)
      if (loss === "native-event") f.emit({ type: "session.deleted", id: "evt_deleted", data: { sessionID: "parent" } })
      if (loss === "renderer") f.renderer.emit("render:error")
      expect(published.activation.generation.revoked).toBe(revoked)
      release()
      for (let i = 0; i < 300; i++) await Promise.resolve()
      attempt.select("planner-child"); attempt.select("parent")
      f.emit(attempt.completed); f.renderer.emit("resize"); f.renderer.emit("frame")
      if (revoked) expect(f.slots).toEqual([])
      else {
        expect(f.calls.toasts).toHaveLength(1)
        expect(f.calls.toasts[0]).toContain("STOP — Implementation was not admitted")
        const status = mount(f)
        expect(status.buttons).toEqual([])
        expect(status.text()).toContain("STOP")
        status.dispose()
      }
      expect(f.calls.synthetic).toHaveLength(1)
      expectNoImplementation(f)
      expect(f.calls.prompted).toEqual([])
    } finally { release(); restore?.(); attempt.cleanup(); if (typeof replacement === "function") replacement() }
  }
})

snapshotTest("genuine retained evidence, Git, location, session, and generation invalidation cannot rearm on root return", async (observer) => {
  for (const mutation of ["head", "dirty", "publication", "server-publication", "inbox", "projection", "reactive-projection", "candidate-rebind", "planner", "permissions",
    "missing-root", "delete-planner", "directory", "workspaceID", "cleanup"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const [location, setLocation] = createStore({ directory: root, workspaceID: undefined as string | undefined })
    Object.defineProperty(f.context, "location", { get: () => location })
    const attempt = await startInspectedPublication(f, (select) => select("planner-child"))
    let view: ReturnType<typeof mount> | undefined
    try {
      const published = await attempt.finish()
      const original = structuredClone({ sessions: f.sessions, histories: f.histories, inbox: f.inboxes.parent, cache: f.cache.parent })
      const inboxList = f.context.client.session.inbox.list
      const messageList = f.context.data.session.message.list
      if (mutation === "head") observer.configure(root, "2".repeat(40))
      if (mutation === "dirty") observer.configure(root, HEAD, ["old.txt"])
      if (mutation === "publication") f.inboxes.parent[0].time.created++
      if (mutation === "server-publication") {
        const inbox = f.context.client.session.inbox.list
        ;(f.context.client.session.inbox as any).list = async (input: any) => {
          const result = await inbox(input)
          if (input.sessionID === "parent") result[0]!.time.created++
          return result
        }
      }
      if (mutation === "inbox") f.inboxes.parent.push(user("extra", "extra"))
      if (mutation === "projection") f.cache.parent.at(-1).description += " changed"
      if (mutation === "reactive-projection") {
        const [projection, setProjection] = createStore<{ messages: any[] }>({ messages: structuredClone(f.cache.parent) })
        ;(f.context.data.session.message as any).list = (id: string) => id === "parent" ? projection.messages : f.cache[id]
        f.renderer.emit("resize")
        setProjection("messages", f.cache.parent.length - 1, "description", "changed")
        expect(f.calls.toasts.at(-1)).toContain("Published Plan projection changed")
      }
      if (mutation === "candidate-rebind") {
        const different = JSON.stringify({ ...JSON.parse(proposal), intent: "A different candidate" })
        f.histories["planner-child"][1].content[0].text = different
        f.histories.parent[1].content[0].state.content[0].text = `<subagent sessionID="planner-child" state="completed">\n${different}\n</subagent>`
      }
      if (mutation === "planner") f.histories["planner-child"][1].content[0].text += " changed"
      if (mutation === "permissions") f.sessions["planner-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
      if (mutation === "missing-root") delete f.sessions.parent
      if (mutation === "delete-planner") f.emit({ type: "session.deleted", id: "evt_deleted", data: { sessionID: "planner-child" } })
      if (mutation === "directory" || mutation === "workspaceID") {
        setLocation(mutation, "changed")
        // The reactive guard must close even while Planner is selected.
        expect(f.calls.toasts.at(-1)).toContain("TUI location changed")
        setLocation(mutation, mutation === "directory" ? root : undefined)
      }
      if (mutation === "cleanup") attempt.cleanup()
      attempt.select("parent")
      if (mutation !== "cleanup") {
        await settleUntil(() => f.calls.toasts.length > 0)
        expect(f.calls.toasts[0]).toContain("STOP — Implementation was not admitted")
        view = mount(f)
        expect(view.buttons).toEqual([])
      }
      // Restore all data and selection after STOP; the old owner remains closed.
      observer.configure(root)
      Object.assign(f.sessions, original.sessions)
      Object.assign(f.histories, original.histories)
      f.inboxes.parent = original.inbox; f.cache.parent = original.cache
      ;(f.context.client.session.inbox as any).list = inboxList
      ;(f.context.data.session.message as any).list = messageList
      attempt.select("planner-child"); attempt.select("parent")
      f.emit(attempt.completed); f.renderer.emit("resize"); f.renderer.emit("frame")
      view?.click(0); view?.click(1)
      for (let i = 0; i < 100; i++) await Promise.resolve()
      expect(published.candidate.proposal.intent).toBe("Change old file")
      expect(f.calls.synthetic).toHaveLength(1)
      expectNoImplementation(f)
      expect(f.calls.prompted).toEqual([])
      if (mutation === "cleanup") {
        expect(f.slots).toEqual([])
        expect(published.activation.generation.revoked).toBe(true)
      } else expect(f.calls.toasts).toHaveLength(1)
    } finally { attempt.cleanup(); view?.dispose() }
  }
})

snapshotTest("root model evidence is required, normalized, immutable, and revalidated before creation", async (observer) => {
  const root = snapshotFixture(observer)
  for (const mutation of ["missing", "execution", "changed", "changed-variant"] as const) {
    const f = fake(root)
    if (mutation === "missing") delete f.sessions.parent.model
    if (mutation === "execution") f.histories.parent[1].model.id = "different"
    if (mutation === "missing" || mutation === "execution") {
      await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("model")
    } else {
      const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
      expect(Object.isFrozen(published.bound.model)).toBe(true)
      f.claim(published)
      if (mutation === "changed") delete f.sessions.parent.model
      else f.sessions.parent.model.variant = "other"
      await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("model")
    }
    expectNoImplementation(f)
    expect(f.calls.prompted).toHaveLength(0)
  }
  const f = fake(root, { decision: true })
  delete f.sessions.parent.model.variant
  for (const message of f.histories.parent) if (message.type === "assistant") delete message.model.variant
  expect(await implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).toContain("Implementation gate complete")
  expect(f.calls.imported[0].info.model).toEqual(model)
})

snapshotTest("realistic host defaults, absent or undefined role model, and xhigh variant admit the exact prompt", async (observer) => {
  const root = snapshotFixture(observer)
  for (const modelState of ["absent", "undefined"] as const) {
    const f = fake(root, { decision: true })
    expect(Object.hasOwn(f.role, "model")).toBe(false)
    if (modelState === "undefined") f.role.model = undefined
    const authored = Bun.YAML.parse(readFileSync(path.join(import.meta.dir, "../.opencode/agents/authorized_implementer.md"), "utf8").split("---\n")[1]!) as any
    expect(f.role.permissions.slice(9, -1)).toEqual(authored.permissions)
    expect(f.role.permissions.at(-1)).toEqual({ action: "browser", resource: "*", effect: "deny" })
    expect(f.role.permissions.slice(0, 9)).toHaveLength(9)
    expect(f.role.permissions[0]).toEqual({ action: "*", resource: "*", effect: "allow" })
    expect(f.role.request).toEqual({ settings: {}, headers: {}, body: {} })
    expect(f.role.description).toBe("Implement one trusted CAP admitted proposal")
    expect(f.role.system).toStartWith("Implement only the trusted frozen proposal")
    f.sessions.parent.model.variant = "xhigh"
    for (const message of f.histories.parent) if (message.type === "assistant") message.model.variant = "xhigh"
    ;(f.context as any).client.model.list = async () => ({ location: { directory: root }, data: [{ ...model, enabled: true,
      variants: [{ id: "xhigh", settings: { reasoningEffort: "xhigh", reasoningSummary: "auto", include: ["reasoning.encrypted_content"] } }] }] })
    expect(await implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).toContain("Implementation gate complete")
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(1)
    expect(f.calls.imported[0].info.model).toEqual({ ...model, variant: "xhigh" })
    expect(f.histories[f.childID].find((message) => message.type === "assistant").model).toEqual({ ...model, variant: "xhigh" })
  }
})

snapshotTest("browser-deny compatibility accepts only the two exact ordered suffix shapes", async (observer) => {
  const root = snapshotFixture(observer)
  for (const browserDeny of [false, true]) {
    const f = fake(root, { decision: true })
    if (!browserDeny) f.role.permissions.pop()
    const loadedRole = structuredClone(f.role)
    let roleReads = 0
    let catalogReads = 0
    f.options.onRead = (kind) => { if (kind === "role") roleReads++; if (kind === "catalog") catalogReads++ }
    expectNoImplementation(f)
    expect(await implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).toContain("Implementation gate complete")
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(1)
    expect(roleReads).toBe(5)
    expect(catalogReads).toBe(5)
    expect(f.role).toEqual(loadedRole)
  }
})

snapshotTest("browser-deny compatibility rejects altered, misplaced, duplicate, and extra trailing rules before import", async (observer) => {
  const root = snapshotFixture(observer)
  for (const mutation of ["browser-allow", "browser-resource", "browser-position", "browser-duplicate", "unknown-deny",
    "trailing-allow", "unknown-deny-without-browser", "trailing-allow-without-browser", "browser-extra-field",
    "missing-commit-deny", "missing-commit-wildcard-deny"] as const) {
    const f = fake(root, { decision: true })
    if (mutation === "browser-allow") f.role.permissions.at(-1)!.effect = "allow"
    if (mutation === "browser-resource") f.role.permissions.at(-1)!.resource = "foo"
    if (mutation === "browser-position") f.role.permissions.splice(15, 0, f.role.permissions.pop()!)
    if (mutation === "browser-duplicate") f.role.permissions.push({ action: "browser", resource: "*", effect: "deny" })
    if (mutation === "unknown-deny-without-browser" || mutation === "trailing-allow-without-browser") f.role.permissions.pop()
    if (mutation === "unknown-deny" || mutation === "unknown-deny-without-browser") f.role.permissions.push({ action: "unknown", resource: "*", effect: "deny" })
    if (mutation === "trailing-allow" || mutation === "trailing-allow-without-browser") f.role.permissions.push({ action: "browser", resource: "*", effect: "allow" })
    if (mutation === "browser-extra-field") f.role.permissions.at(-1)!.extra = true
    if (mutation === "missing-commit-deny") f.role.permissions.splice(15, 1)
    if (mutation === "missing-commit-wildcard-deny") f.role.permissions.splice(16, 1)
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("policy ordered permission suffix mismatch")
    expectNoImplementation(f)
    expect(f.calls.prompted).toHaveLength(0)
  }
})

snapshotTest("browser-deny compatibility never accepts changed or reordered authored rules", async (observer) => {
  const root = snapshotFixture(observer)
  for (const browserDeny of [false, true]) {
    for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
      for (const field of ["action", "resource", "effect"] as const) {
        const f = fake(root, { decision: true })
        if (!browserDeny) f.role.permissions.pop()
        f.role.permissions[9 + index][field] = field === "effect" ? "ask" : "changed"
        await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
          index === 0 ? "policy deny-all reset missing" : "policy ordered permission suffix mismatch")
        expectNoImplementation(f)
        expect(f.calls.prompted).toHaveLength(0)
      }
    }
    const f = fake(root, { decision: true })
    if (!browserDeny) f.role.permissions.pop()
    ;[f.role.permissions[15], f.role.permissions[16]] = [f.role.permissions[16], f.role.permissions[15]]
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow("policy ordered permission suffix mismatch")
    expectNoImplementation(f)
    expect(f.calls.prompted).toHaveLength(0)
  }
})

snapshotTest("browser-deny compatibility preserves exact later role readbacks without prompt, retry, or replacement", async (observer) => {
  const root = snapshotFixture(observer)
  for (const barrier of [2, 3]) {
    for (const mutation of ["add", "remove", "resource", "effect", "position", "duplicate"] as const) {
      const f = fake(root)
      if (mutation === "add") f.role.permissions.pop()
      const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
      f.claim(published)
      let reads = 0
      f.options.onRead = (kind) => {
        if (kind !== "role" || ++reads !== barrier) return
        if (mutation === "add" || mutation === "duplicate") f.role.permissions.push({ action: "browser", resource: "*", effect: "deny" })
        if (mutation === "remove") f.role.permissions.pop()
        if (mutation === "resource") f.role.permissions.at(-1)!.resource = "foo"
        if (mutation === "effect") f.role.permissions.at(-1)!.effect = "allow"
        if (mutation === "position") f.role.permissions.splice(15, 0, f.role.permissions.pop()!)
      }
      const error = await authorizePublishedAttempt(f.context, published, f.guard).catch((error: Error) => error)
      expect(error).toBeInstanceOf(Error)
      const message = (error as Error).message
      expect(message).toContain(mutation === "add" || mutation === "remove" ? "policy expected-role drift" : "policy ordered permission suffix mismatch")
      expect(JSON.parse(message.split("; evidence=")[1]!).fullRoleEquality).toBe(false)
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.created).toHaveLength(1)
      expect(f.calls.prompted).toHaveLength(0)
      const childID = f.childID
      await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("cannot retry")
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.created).toEqual([childID])
      expect(f.calls.prompted).toHaveLength(0)
      expect(reads).toBe(barrier)
    }
  }
})

snapshotTest("initial policy predicates report distinct safe evidence and create zero authority", async (observer) => {
  const root = snapshotFixture(observer)
  const cases = [
    ["role-absent", "policy is unavailable: permissions are not an array or role is absent"],
    ["permissions-not-array", "policy is unavailable: permissions are not an array or role is absent"],
    ["location", "policy location mismatch"],
    ["id", "policy role id mismatch"],
    ["mode", "policy role mode mismatch"],
    ["hidden", "policy role hidden mismatch"],
    ["model-null", "policy model override is present"],
    ["model-object", "policy model override is present"],
    ["model-value", "policy model override is present"],
    ["reset", "policy deny-all reset missing"],
    ["extra-allow", "policy ordered permission suffix mismatch"],
    ["order", "policy ordered permission suffix mismatch"],
    ["resource", "policy ordered permission suffix mismatch"],
    ["effect", "policy ordered permission suffix mismatch"],
    ["extra-field", "policy ordered permission suffix mismatch"],
  ] as const
  for (const [mutation, reason] of cases) {
    const f = fake(root)
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    f.claim(published)
    const host = f.context as any
    const secret = "DO-NOT-PRINT-REQUEST-OR-SYSTEM"
    f.role.request = { settings: { secret }, headers: { Authorization: secret }, body: { secret } }
    f.role.system = secret
    let returnedLocation = { directory: root }
    if (mutation === "role-absent") host.client.agent.get = async () => ({ location: returnedLocation, data: undefined })
    if (mutation === "permissions-not-array") f.role.permissions = {}
    if (mutation === "location") {
      returnedLocation = { directory: root + "/other" }
      host.client.agent.get = async () => ({ location: returnedLocation, data: f.role })
    }
    if (mutation === "id") { f.role.id = "other"; f.role.model = undefined }
    if (mutation === "mode") f.role.mode = "primary"
    if (mutation === "hidden") f.role.hidden = false
    if (mutation === "model-null") f.role.model = null
    if (mutation === "model-object") f.role.model = { ...model, request: { headers: { Authorization: secret } } }
    if (mutation === "model-value") f.role.model = "model-override"
    if (mutation === "reset") f.role.permissions.splice(9, 1)
    if (mutation === "extra-allow") f.role.permissions.push({ action: "subagent", resource: "*", effect: "allow" })
    if (mutation === "order") [f.role.permissions[15], f.role.permissions[16]] = [f.role.permissions[16], f.role.permissions[15]]
    if (mutation === "resource") f.role.permissions[15].resource = "git commit --amend"
    if (mutation === "effect") f.role.permissions[15].effect = "allow"
    if (mutation === "extra-field") f.role.permissions[15].request = { headers: { Authorization: secret } }
    let catalogReads = 0
    f.options.onRead = (kind) => { if (kind === "catalog") catalogReads++ }
    const error = await authorizePublishedAttempt(f.context, published, f.guard).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toStartWith(`Attempt binding failed: loaded authorized Implementer ${reason}; evidence=`)
    expect(message).not.toContain(secret)
    expectNoImplementation(f)
    expect(f.calls.prompted).toHaveLength(0)
    expect(catalogReads).toBe(0)
    const diagnostic = JSON.parse(message.split("; evidence=")[1]!)
    expect(diagnostic.location).toEqual({ ...returnedLocation, extraFieldCount: 0 })
    expect(diagnostic.role.id).toEqual(mutation === "role-absent" ? { type: "undefined" } : f.role.id)
    expect(diagnostic.role.mode).toEqual(mutation === "role-absent" ? { type: "undefined" } : f.role.mode)
    expect(diagnostic.role.hidden).toEqual(mutation === "role-absent" ? { type: "undefined" } : f.role.hidden)
    expect(diagnostic.role.model.state).toBe(mutation === "id" ? "undefined" : mutation === "model-null" ? "null"
      : mutation === "model-object" || mutation === "model-value" ? "value" : "absent")
    if (mutation === "model-object") expect(diagnostic.role.model.value).toEqual({ ...model, extraFieldCount: 1 })
    if (mutation === "model-value") expect(diagnostic.role.model.value).toEqual({ value: "model-override" })
    expect(diagnostic.permissionsAreArray).toBe(!["role-absent", "permissions-not-array"].includes(mutation))
    expect(diagnostic.permissionCount).toBe(Array.isArray(f.role.permissions) && mutation !== "role-absent" ? f.role.permissions.length : null)
    expect(diagnostic.lastDenyAllResetIndex).toBe(["role-absent", "permissions-not-array", "reset"].includes(mutation) ? -1 : 9)
    const authored = Bun.YAML.parse(readFileSync(path.join(import.meta.dir, "../.opencode/agents/authorized_implementer.md"), "utf8").split("---\n")[1]!) as any
    expect(diagnostic.expectedOrderedSuffix).toEqual(authored.permissions)
    expect(diagnostic.allowedTrailingHostRule).toEqual({ action: "browser", resource: "*", effect: "deny" })
    expect(diagnostic.actualOrderedSuffix).toEqual(diagnostic.lastDenyAllResetIndex < 0 ? null
      : f.role.permissions.slice(9).map(({ action, resource, effect, ...extra }: any) => ({ action, resource, effect, extraFieldCount: Object.keys(extra).length })))
    expect(diagnostic.fullRoleEquality).toBe("not-checked")
  }
})

snapshotTest("later expected-role drift reports full-role inequality without another child or any prompt", async (observer) => {
  const root = snapshotFixture(observer)
  for (const barrier of [2, 3]) {
    const f = fake(root)
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    f.claim(published)
    let reads = 0
    f.options.onRead = (kind) => {
      if (kind === "role" && ++reads === barrier) f.role.request.headers = { Authorization: "SECRET-DRIFT" }
    }
    const error = await authorizePublishedAttempt(f.context, published, f.guard).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toStartWith("Attempt binding failed: loaded authorized Implementer policy expected-role drift; evidence=")
    expect(message).not.toContain("SECRET-DRIFT")
    expect(JSON.parse(message.split("; evidence=")[1]!).fullRoleEquality).toBe(false)
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
    expect(reads).toBe(barrier)
  }
})

snapshotTest("model catalog predicates report distinct evidence and create zero authority", async (observer) => {
  const root = snapshotFixture(observer)
  for (const [mutation, reason, matchCount] of [
    ["location", "model catalog location mismatch", 1],
    ["missing", "frozen provider/model has zero enabled exact matches", 0],
    ["disabled", "frozen provider/model has zero enabled exact matches", 0],
    ["wrong-id", "frozen provider/model has zero enabled exact matches", 0],
    ["wrong-provider", "frozen provider/model has zero enabled exact matches", 0],
    ["duplicate", "frozen provider/model has multiple enabled exact matches", 2],
    ["variant", "frozen named variant is unavailable", 1],
  ] as const) {
    const f = fake(root)
    f.sessions.parent.model.variant = "xhigh"
    for (const message of f.histories.parent) if (message.type === "assistant") message.model.variant = "xhigh"
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    f.claim(published)
    const returnedLocation = { directory: mutation === "location" ? root + "/other" : root }
    const entry = { ...model, enabled: mutation !== "disabled", variants: [{ id: mutation === "variant" ? "high" : "xhigh",
      settings: { secret: "SECRET-CATALOG" } }], request: { headers: { Authorization: "SECRET-CATALOG" } } }
    if (mutation === "wrong-id") entry.id = "other"
    if (mutation === "wrong-provider") entry.providerID = "other"
    ;(f.context as any).client.model.list = async () => ({ location: returnedLocation,
      data: mutation === "missing" ? [] : mutation === "duplicate" ? [entry, structuredClone(entry)] : [entry] })
    const error = await authorizePublishedAttempt(f.context, published, f.guard).catch((error: Error) => error)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toStartWith(`Attempt binding failed: ${reason}; evidence=`)
    expect(message).not.toContain("SECRET-CATALOG")
    expect(JSON.parse(message.split("; evidence=")[1]!)).toEqual({
      location: { ...returnedLocation, extraFieldCount: 0 }, expectedLocation: { directory: root, extraFieldCount: 0 },
      frozenModel: { ...model, variant: "xhigh" }, enabledExactMatchCount: matchCount,
      availableVariantIDs: matchCount === 1 ? [mutation === "variant" ? "high" : "xhigh"] : null,
    })
    expectNoImplementation(f)
    expect(f.calls.prompted).toHaveLength(0)
  }
})

snapshotTest("unsupported workspace topology stops before import", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  const captured = { ...published, activation: { ...published.activation, location: { directory: root, workspaceID: "workspace" } } }
  f.claim(captured)
  await expect(authorizePublishedAttempt(f.context, captured, f.guard)).rejects.toThrow("cannot preserve workspaceID")
  expectNoImplementation(f)
  expect(f.calls.prompted).toHaveLength(0)
  const fresh = fake(root)
  ;(fresh.context as any).location.workspaceID = "workspace"
  await expect(publication(fresh.context, fresh.generation, observeGit(root), "parent", { directory: root, workspaceID: "workspace" } as any)).rejects.toThrow("unsupported workspace-bound topology")
  expectNoImplementation(fresh)
})

snapshotTest("one Authorize imports an exact fresh empty child with frozen root model and family policy", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  f.sessions.parent.subpath = "local/subpath"
  f.sessions["planner-child"].subpath = "local/subpath"
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  expectNoImplementation(f)
  f.claim(published)
  const startedAt = Date.now()
  let release!: () => void
  let importing = false
  const paused = new Promise<void>((resolve) => { release = resolve })
  const host = f.context as any
  const importChild = host.client.session.import
  host.client.session.import = async (input: any) => {
    const returned = await importChild(input)
    importing = true
    await paused
    // Host import time is distinct from caller-created time.
    returned.time.updated += 7
    f.sessions[f.childID].time.updated = returned.time.updated
    return returned
  }
  const execution = authorizePublishedAttempt(f.context, published, f.guard)
  await settleUntil(() => importing)
  try {
    expect(f.calls.imported).toHaveLength(1)
    expect(f.childID).toMatch(/^ses_[0-9a-f-]{36}$/)
    expect(f.childID).not.toBe("parent")
    expect(f.childID).not.toBe("planner-child")
    const time = f.calls.imported[0].info.time
    expect(Number.isFinite(time.created)).toBe(true)
    expect(time.created).toBeGreaterThanOrEqual(startedAt)
    expect(f.calls.imported[0]).toEqual({ location: { directory: root }, messages: [], info: {
      id: f.childID, parentID: "parent", agent: "authorized_implementer", model,
      location: { directory: root }, projectID: "project", subpath: "local/subpath", metadata: { policy: "family" }, permissions: [],
      cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, time: { created: time.created, updated: time.created },
    } })
    expect(f.histories[f.childID]).toEqual([])
    expect(f.inboxes[f.childID]).toEqual([])
    expect(f.sessions[f.childID].outcome).toBeUndefined()
    expect(f.guard.creationAttempted).toBe(true)
    expect(f.guard.creationReturned).toBeUndefined()
    expect(f.calls.prompted).toHaveLength(0)
    await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("cannot retry")
  } finally { release() }
  expect(await execution).toContain("Implementation gate complete")
  expect(f.calls.imported).toHaveLength(1)
  expect(f.calls.prompted).toEqual([{ sessionID: f.childID, text: implementerPrompt(published.candidate) }])
  expect(Object.isFrozen(f.guard.child)).toBe(true)
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("cannot retry")
  expect(f.calls.imported).toHaveLength(1)
})

snapshotTest("creation response and independent readback reject every identity and initial-state mismatch", async (observer) => {
  const root = snapshotFixture(observer)
  const mutations: Array<(info: any) => void> = [
    (info) => { info.id = "ses_wrong" }, (info) => { info.parentID = "different" },
    (info) => { info.agent = "planner" }, (info) => { delete info.model },
    (info) => { info.model.id = "different" }, (info) => { info.model.providerID = "different" }, (info) => { info.model.variant = "different" },
    (info) => { info.location.directory += "/other" }, (info) => { info.location.workspaceID = "workspace" },
    (info) => { info.projectID = "different" }, (info) => { info.subpath = "different" },
    (info) => { info.metadata = { policy: "different" } }, (info) => { info.title = "unexpected" },
    (info) => { info.permissions = [{ action: "edit", resource: "*", effect: "allow" }] }, (info) => { delete info.permissions },
    (info) => { info.time.created-- }, (info) => { info.time.created = NaN }, (info) => { info.time.updated = NaN },
    (info) => { info.time.updated = info.time.created - 1 }, (info) => { info.time.idle = info.time.created },
    (info) => { info.time.viewed = info.time.created }, (info) => { info.time.archived = info.time.created },
    (info) => { info.outcome = "succeeded" }, (info) => { info.fork = { sessionID: "other", boundary: {} } },
    (info) => { info.revert = { messageID: "other" } }, (info) => { info.cost = 1 },
    ...["input", "output", "reasoning"].map((field) => (info: any) => { info.tokens[field] = 1 }),
    ...["read", "write"].map((field) => (info: any) => { info.tokens.cache[field] = 1 }),
  ]
  for (const boundary of ["response", "readback"] as const) for (const mutate of mutations) {
    const f = fake(root, { decision: true })
    const host = f.context as any
    const importChild = host.client.session.import
    host.client.session.import = async (input: any) => {
      const returned = await importChild(input)
      mutate(boundary === "response" ? returned : f.sessions[f.childID])
      return returned
    }
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
  }
})

snapshotTest("an active child or any inbox or transcript content before prompt fails admission", async (observer) => {
  const root = snapshotFixture(observer)
  for (const mutation of ["active", "inbox", "user", "synthetic", "control"] as const) {
    const f = fake(root, { decision: true, onImport: () => {
      if (mutation === "active") (f.context as any).client.session.active = async () => ({ [f.childID]: { type: "running" } })
      if (mutation === "inbox") f.inboxes[f.childID].push({ type: "user", id: "external" })
      if (mutation === "user") f.histories[f.childID].push(user("external", "input"))
      if (mutation === "synthetic") f.histories[f.childID].push({ type: "synthetic", id: "external", text: "input" })
      if (mutation === "control") f.histories[f.childID].push({ type: "model-switched", id: "external", model })
    } })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow()
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.created).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
  }
})

snapshotTest("creation rejection, timeout, lost response, collision, and malformed response never retry or adopt", async (observer) => {
  const root = snapshotFixture(observer)
  for (const failure of ["uncommitted", "committed", "timeout", "collision", "malformed"] as const) {
    const f = fake(root)
    const host = f.context as any
    const importChild = host.client.session.import
    host.client.session.import = async (input: any) => {
      if (failure === "uncommitted") { f.calls.imported.push(structuredClone(input)); throw new Error("transport rejected") }
      if (failure === "collision") f.sessions[input.info.id] = { ...input.info, parentID: "external" }
      const returned = await importChild(input)
      if (failure === "malformed") return undefined
      if (failure === "committed" || failure === "timeout") throw new Error(failure === "timeout" ? "creation timed out" : "response lost")
      return returned
    }
    const cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    const message = f.calls.toasts.at(-1)!
    expect(message).toContain(failure === "malformed" ? "Child admission failed" : "Child creation outcome unknown")
    expect(message).toContain("no trusted implementation prompt was dispatched; no creation retry")
    expect(view.text()).toContain(message)
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
    const id = f.calls.imported[0].info.id
    // Discovering a child later never supplies permission to continue.
    if (!f.sessions[id]) f.sessions[id] = structuredClone(f.calls.imported[0].info)
    f.emit({ type: "session.created", id: "evt_late", created: Date.now(), data: { sessionID: id, parentID: "parent" } })
    f.renderer.emit("frame"); f.renderer.emit("resize")
    view.click(0); view.click(1)
    await Promise.resolve()
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
    expect(f.sessions[id]).toBeDefined()
    cleanup(); view.dispose()
  }
})

snapshotTest("creation and final barriers revalidate model, policy, native evidence, publication, and Git", async (observer) => {
  const root = snapshotFixture(observer)
  for (const boundary of ["creation", "after-readback", "final"] as const) {
    for (const evidence of ["root", "planner", "publication", "model", "role", "catalog", "location", "head", "dirty", "child"] as const) {
      const f = fake(root)
      let parentReads = 0
      const mutate = () => {
        if (evidence === "root") f.histories.parent[2].content[0].text += " changed"
        if (evidence === "planner") f.histories["planner-child"][1].content[0].text += " changed"
        if (evidence === "publication") f.inboxes.parent[0].payload.text += " changed"
        if (evidence === "model") f.sessions.parent.model.id = "other"
        if (evidence === "role") f.role.system = "changed policy"
        if (evidence === "catalog") (f.context as any).client.model.list = async () => ({ location: { directory: root }, data: [] })
        if (evidence === "location") (f.context as any).location.workspaceID = "workspace"
        if (evidence === "head") observer.configure(root, "2".repeat(40))
        if (evidence === "dirty") observer.configure(root, HEAD, ["old.txt"])
        if (evidence === "child") f.histories[f.childID].push(user("external", "input"))
      }
      if (boundary === "creation") f.options.onImport = mutate
      else f.options.onGet = (id) => {
        if (id === "parent" && f.calls.created.length && ++parentReads === (boundary === "final" ? 2 : 1)) mutate()
      }
      const cleanup = await activate(f)
      const view = mount(f)
      view.click(0)
      await settleUntil(() => f.calls.toasts.length > 0)
      expect(f.calls.toasts.at(-1)).toContain("Child admission failed; child may remain")
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.created).toHaveLength(1)
      expect(f.calls.prompted).toHaveLength(0)
      expect(f.sessions[f.childID].agent).toBe("authorized_implementer")
      // Failed admission leaves ordinary host capability, never a CAP prompt/retry.
      view.click(0); f.renderer.emit("frame")
      expect(f.calls.imported).toHaveLength(1)
      cleanup(); view.dispose()
      observer.configure(root)
    }
  }
})

snapshotTest("Created echoes correlate shared fields, tolerate distinct host time, and reject early or late mismatch", async (observer) => {
  const root = snapshotFixture(observer)
  for (const boundary of ["early", "late"] as const) for (const mismatch of ["id", "parent", "model", "project", "subpath", "time"] as const) {
    const f = fake(root)
    const emit = () => {
      const info = f.sessions[f.childID]
      const event = { type: "session.created", id: "evt_created_child", created: info.time.created + 20,
        data: { sessionID: info.id, parentID: info.parentID, agent: info.agent, model: structuredClone(info.model), projectID: info.projectID,
          location: info.location, subpath: info.subpath, metadata: info.metadata, permissions: info.permissions } }
      if (mismatch === "id") event.data.sessionID = "ses_unexpected"
      if (mismatch === "parent") event.data.parentID = "wrong"
      if (mismatch === "model") event.data.model.id = "wrong"
      if (mismatch === "project") event.data.projectID = "wrong"
      if (mismatch === "subpath") event.data.subpath = "wrong"
      if (mismatch === "time") event.created = NaN
      f.emit(event)
    }
    if (boundary === "early") f.options.onImport = emit
    else f.options.onGet = (id) => { if (id === "parent" && f.calls.created.length) emit() }
    const cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.imported).toHaveLength(1)
    expect(f.calls.prompted).toHaveLength(0)
    cleanup(); view.dispose()
  }
  const f = fake(root, { events: true })
  let seen = false
  let childEvent: any
  f.context.data.listen(({ details }) => { if (details.type === "session.created" && details.data.parentID === "parent") childEvent = structuredClone(details) })
  f.options.onImport = () => {
    seen = true
    expect(childEvent.created).not.toBe(f.sessions[f.childID].time.created)
    expect(childEvent.data.subpath).toBe("")
    f.emit(childEvent); f.emit(childEvent)
    f.renderer.emit("frame")
  }
  const cleanup = await activate(f)
  const view = mount(f)
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(seen).toBe(true)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  expect(f.calls.imported).toHaveLength(1)
  cleanup(); view.dispose()
})

snapshotTest("grant consumption is adjacent to one exact prompt and cannot be replayed after dispatch ambiguity", async (observer) => {
  const root = snapshotFixture(observer)
  const cap = await import("../src/cap.ts")
  const original = { ...cap }
  const modulePath = path.resolve(import.meta.dir, "../src/cap.ts")
  for (const ambiguous of [false, true]) {
    const operations: string[] = []
    let queued = false
    let used: Parameters<typeof cap.consumeIntent> | undefined
    const f = fake(root, { decision: true, promptError: ambiguous, onRead: () => operations.push("read") })
    const prompt = f.context.client.session.prompt
    ;(f.context.client.session as any).prompt = (input: any) => {
      expect(operations.at(-1)).toBe("consume")
      expect(queued).toBe(false)
      expect(f.guard.dispatched).toBe(true)
      expect(input).toEqual({ sessionID: f.childID, id: f.guard.prompt!.id, text: f.guard.prompt!.text, delivery: "steer" })
      expect(f.histories[f.childID]).toHaveLength(0)
      operations.push("prompt")
      return prompt(input)
    }
    mock.module(modulePath, () => ({ ...original, consumeIntent: (...args: Parameters<typeof cap.consumeIntent>) => {
      original.consumeIntent(...args)
      used = args
      operations.push("consume")
      queueMicrotask(() => { queued = true })
    } }))
    try {
      const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
      f.claim(published)
      const execution = authorizePublishedAttempt(f.context, published, f.guard)
      if (ambiguous) await expect(execution).rejects.toThrow("ambiguous prompt")
      else expect(await execution).toContain("Implementation gate complete")
      expect(used).toBeDefined()
      expect(() => original.consumeIntent(...used!)).toThrow("consumed")
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.prompted).toHaveLength(1)
      await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("cannot retry")
      expect(f.calls.prompted).toHaveLength(1)
    } finally { mock.module(modulePath, () => original) }
  }
})

test("active definitions and CAP source contain no retained worker bootstrap or agent-switch path", () => {
  const agents = path.join(import.meta.dir, "../.opencode/agents")
  expect(() => readFileSync(path.join(agents, "implementer_slot.md"))).toThrow()
  for (const file of ["../src/attempt.ts", "../.opencode/plugins/opencode-agents/tui.tsx", "../.opencode/agents/orchestrator.md"]) {
    const source = readFileSync(path.join(import.meta.dir, file), "utf8")
    expect(source).not.toMatch(/implementer_slot|SLOT_PROMPT|READY|switchAgent|switchRecord|switching|agent-switched/)
  }
})

snapshotTest("relevant registry updates during final awaited child verification block admission without another child", async (observer) => {
  const root = snapshotFixture(observer)
  for (const type of ["agent.updated", "model.updated"] as const) {
    const f = fake(root, { singlePage: true })
    const host = f.context as any
    const list = host.client.message.list
    let childReads = 0
    let waiting = false
    let release!: () => void
    const paused = new Promise<void>((resolve) => { release = resolve })
    host.client.message.list = async (input: any) => {
      const page = await list(input)
      // The third empty-child history read is after the final loaded policy/catalog reads.
      if (input.sessionID === f.childID && ++childReads === 3) {
        waiting = true
        await paused
      }
      return page
    }
    const cleanup = await activate(f)
    const view = mount(f)
    try {
      view.click(0)
      await settleUntil(() => waiting)
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.prompted).toHaveLength(0)
      if (type === "agent.updated") f.role.permissions.push({ action: "subagent", resource: "*", effect: "allow" })
      else host.client.model.list = async () => ({ location: { directory: root }, data: [] })
      // Actual 2.0.21 registry events have empty data and an envelope Location.Ref.
      f.emit({ type, id: `evt_${type}`, created: Date.now(), location: { directory: root }, data: {} })
      release()
      await settleUntil(() => f.calls.toasts.length > 0)
      expect(f.calls.prompted).toHaveLength(0)
      expect(f.calls.toasts.at(-1)).toContain(`Unexpected ${type}`)
      expect(view.text()).toContain("no trusted implementation prompt was dispatched; no creation retry")
      // Let the failed continuation finish, then repeat events and stale decisions.
      for (let i = 0; i < 10; i++) await Promise.resolve()
      f.emit({ type, id: `evt_late_${type}`, created: Date.now(), location: { directory: root }, data: {} })
      view.click(0); view.click(1)
      f.renderer.emit("resize"); f.renderer.emit("frame")
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.created).toEqual([f.childID])
      expect(Object.keys(f.sessions).sort()).toEqual(["parent", "planner-child", f.childID].sort())
      expect(f.histories[f.childID]).toEqual([])
      expect(f.inboxes[f.childID]).toEqual([])
      expect(f.calls.prompted).toHaveLength(0)
    } finally { release(); cleanup(); view.dispose() }
  }
})

snapshotTest("registry updates for other locations or workspaces do not invalidate the governed local attempt", async (observer) => {
  const root = snapshotFixture(observer)
  for (const type of ["agent.updated", "model.updated"] as const) {
    const f = fake(root, { singlePage: true })
    let childReads = 0
    f.options.onRead = (kind, id) => {
      if (kind !== "messages" || id !== f.childID || ++childReads !== 3) return
      for (const location of [{ directory: root + "/other-project" }, { directory: root, workspaceID: "other-workspace" }])
        f.emit({ type, id: `evt_other_${location.directory}`, created: Date.now(), location, data: {} })
    }
    const cleanup = await activate(f)
    const view = mount(f)
    try {
      view.click(0)
      await settleUntil(() => f.calls.toasts.length > 0)
      expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
      expect(f.calls.imported).toHaveLength(1)
      expect(f.calls.prompted).toHaveLength(1)
    } finally { cleanup(); view.dispose() }
  }
})
