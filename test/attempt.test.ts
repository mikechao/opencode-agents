import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import type { Generation } from "../src/cap.ts"
import * as attemptModule from "../src/attempt.ts"
import * as gitModule from "../src/git.ts"
import { observeGit, type GitSnapshot } from "../src/git.ts"
import { makeCandidate, parseProposal, renderPlan } from "../src/proposal.ts"
import {
  activationEvidence,
  initiallyAuthorizable,
  assertPublishedCoherence,
  publishedPresentationMatches,
  authorizePublishedAttempt,
  plannerInput,
  plannerReceipt,
  plannerReceiptKey,
  publishPlan as publish,
  snapshotLocation,
  verifyPublishedAttempt,
  type DecisionOwner,
  type PublishedAttempt,
} from "../src/attempt.ts"
import { createRoot, createEffect, createMemo, createComponent, createSignal } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { EventEmitter } from "node:events"

// Test-scoped JSX property/handler capture. No renderer, terminal, or native UI integration.
const elements: any[] = []
mock.module("@opentui/solid", () => ({
  createElement: (type: string) => {
    const node = {
      type,
      children: [] as any[],
      parent: null as any,
      width: 120,
      height: type === "text" ? 1 : 3,
      screenX: 0,
      screenY: 0,
      visible: true,
      isDestroyed: false,
    }
    elements.push(node)
    return node
  },
  createTextNode: (value: unknown) => {
    const node = { type: "literal", value }
    elements.push(node)
    return node
  },
  setProp: (node: any, key: string, value: unknown) => {
    node[key] = value
    if (key === "onMouseUp") {
      node.height = 1
      node.width = 13
    }
  },
  use: (fn: (node: any) => void, node: any) => fn(node),
  insertNode: (parent: any, child: any) => {
    child.parent = parent
    parent.children.push(child)
  },
  insert: (parent: any, value: any) => {
    const update = () => {
      const child = typeof value === "function" ? value() : value
      if (typeof child === "string") elements.push({ type: "literal", value: child })
      if (child && typeof child === "object") {
        child.parent = parent
        parent.children.push(child)
      }
    }
    createEffect(update)
  },
  effect: createEffect,
  memo: createMemo,
  createComponent,
}))
const { default: plugin } = await import("../.opencode/plugins/opencode-agents/tui.tsx")

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
// Capture real exports before interception. Bun updates existing ESM consumers,
// including attempt.ts and the plugin, when this module is mocked/restored.
const realGit = { ...gitModule }
const gitModulePath = path.resolve(import.meta.dir, "../src/git.ts")
const HEAD = "1".repeat(40)
class SnapshotObserver {
  private active = true
  readonly locations = new Map<
    string,
    { current: GitSnapshot; calls: Array<{ baseline?: GitSnapshot; current: GitSnapshot }> }
  >()

  configure(location: string, head = HEAD, paths: readonly string[] = []) {
    if (!this.active) throw new Error("Snapshot observer is closed")
    const root = realpathSync(location)
    if (!/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(head)) throw new Error("Invalid Git HEAD")
    if (
      paths.some(
        (name) =>
          !name ||
          name.startsWith("/") ||
          name.split("/").some((part) => !part || part === "." || part === ".." || part === ".git"),
      )
    ) {
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

  calls(root: string) {
    return this.locations.get(realpathSync(root))!.calls
  }
  close() {
    this.active = false
    this.locations.clear()
  }
}

// Serial, case-local interception only. Unconfigured/closed doubles fail closed;
// finally restores the real exports even if a rejection/assertion fails.
function snapshotTest(name: string, run: (observer: SnapshotObserver) => Promise<void>) {
  test(name, async () => {
    if (gitModule.observeGit !== realGit.observeGit) throw new Error("Leaked Git observer interception")
    const observer = new SnapshotObserver()
    mock.module(gitModulePath, () => ({ ...realGit, observeGit: observer.observe }))
    try {
      await run(observer)
    } finally {
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
const answer = (id: string, agent: string, value: string) => ({
  type: "assistant",
  id,
  agent,
  model: { ...model },
  finish: "stop",
  content: [text(value)],
})
const idle = (id: string) => ({ type: "idle", id, outcome: "succeeded" })
function call(id: string, agent: string, prompt: string, childID: string, result: string) {
  return {
    type: "tool",
    id,
    name: "subagent",
    state: {
      status: "completed",
      input: { agent, description: `${agent} work`, prompt },
      metadata: {
        sessionID: childID,
        status: "completed",
        ...(agent === "planner"
          ? { [plannerReceiptKey]: plannerReceipt("parent-user", `${agent} work`, request) }
          : {}),
      },
      content: [text(`<subagent sessionID="${childID}" state="completed">\n${result}\n</subagent>`)],
    },
  }
}
type FakeOptions = {
  events?: boolean
  singlePage?: boolean
  rootActive?: boolean
  wakeOnSynthetic?: boolean
  decision?: boolean | undefined
  onAuthorize?: (claim: any) => Promise<string>
  onDecision?: () => void
  onWait?: (sessionID: string) => void | Promise<void>
  onGet?: (sessionID: string) => void
  onRead?: (kind: string, sessionID?: string) => void
  onReceipt?: (input: any) => void | Promise<void>
}
const fakes = new WeakMap<Context, ReturnType<typeof fake>>()
function fake(root: string, options: FakeOptions = {}) {
  const generation: Generation = { revoked: false, busy: false }
  const histories: Record<string, any[]> = {
    parent: [
      user("parent-user", request),
      {
        type: "assistant",
        id: "planner-tool-message",
        agent: "orchestrator",
        model: { ...model },
        content: [call("planner-call", "planner", plannerInput(request), "planner-child", proposal)],
      },
      answer("parent-final", "orchestrator", "Plan prepared; awaiting human authorization."),
      idle("parent-idle"),
    ],
    "planner-child": [
      user("planner-user", prefix + plannerInput(request)),
      answer("planner-final", "planner", proposal),
      idle("planner-idle"),
    ],
  }
  const sessions: Record<string, any> = {
    parent: {
      id: "parent",
      agent: "orchestrator",
      model: { ...model },
      projectID: "project",
      metadata: { policy: "family" },
      location: { directory: root },
      outcome: "succeeded",
      time: { created: 1, idle: 2 },
    },
    "planner-child": {
      id: "planner-child",
      parentID: "parent",
      agent: "planner",
      model: { ...model },
      projectID: "project",
      location: { directory: root },
      outcome: "succeeded",
      time: { created: 1, idle: 2 },
    },
  }
  const inboxes: Record<string, any[]> = { parent: [], "planner-child": [] }
  const cache: Record<string, any[]> = structuredClone(histories)
  const handlers = new Map<string, (event: any) => void>()
  const listeners = new Set<(event: any) => void>()
  const slots: any[] = []
  const renderer = Object.assign(new EventEmitter(), { terminalWidth: 120, terminalHeight: 60, isDestroyed: false })
  const calls = {
    claims: [] as any[],
    decided: [] as string[],
    synthetic: [] as any[],
    receipts: [] as any[],
    toasts: [] as string[],
  }
  const syncCache = (sessionID: string) => {
    cache[sessionID] = structuredClone([
      ...histories[sessionID],
      ...inboxes[sessionID]
        .filter((item) => item.type === "synthetic")
        .map((item) => ({ id: item.id, type: item.type, ...item.payload, time: item.time })),
    ])
  }
  const context = {
    location: { directory: root },
    renderer,
    data: {
      on: (type: string, handler: (event: any) => void) => {
        handlers.set(type, handler)
        return () => handlers.delete(type)
      },
      listen: (listener: (event: any) => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      location: { default: () => ({ directory: root }) },
      session: {
        message: {
          list: (id: string) => cache[id],
          invalidate: () => {},
          sync: async (id: string) => {
            options.onRead?.("hydrate", id)
            syncCache(id)
          },
        },
        pending: {
          list: (id: string) => inboxes[id],
          invalidate: () => {},
          sync: async (id: string) => {
            options.onRead?.("pending-sync", id)
          },
        },
      },
    },
    client: {
      session: {
        list: async ({ parentID, cursor }: { parentID: string; cursor?: string }) => {
          options.onRead?.("children", parentID)
          const all = Object.values(sessions).filter((session) => session.parentID === parentID)
          return structuredClone(
            options.singlePage
              ? { data: all, cursor: {} }
              : cursor
                ? { data: all.slice(2), cursor: {} }
                : { data: all.slice(0, 2), cursor: { next: "rest" } },
          )
        },
        get: async ({ sessionID }: { sessionID: string }) => {
          options.onRead?.("get", sessionID)
          options.onGet?.(sessionID)
          return sessions[sessionID]
        },
        active: async () => {
          options.onRead?.("active")
          return options.rootActive || (options.wakeOnSynthetic && calls.synthetic.length > 0)
            ? { parent: { type: "running" } }
            : {}
        },
        inbox: {
          list: async ({ sessionID }: { sessionID: string }) => {
            options.onRead?.("inbox", sessionID)
            return structuredClone(inboxes[sessionID])
          },
        },
        wait: async ({ sessionID }: { sessionID: string }) => {
          await options.onWait?.(sessionID)
        },
        synthetic: async (input: any) => {
          if (input.metadata?.source === "opencode-agents") {
            calls.receipts.push(input)
            await options.onReceipt?.(input)
          } else calls.synthetic.push(input)
          const admitted = {
            id: input.id ?? `receipt-${calls.receipts.length}`,
            type: "synthetic",
            sessionID: input.sessionID,
            delivery: input.delivery,
            time: { created: 3 },
            payload: { text: input.text, description: input.description, metadata: input.metadata },
          }
          inboxes[input.sessionID].push(structuredClone(admitted))
          syncCache(input.sessionID)
          if (options.events)
            emit({
              type: "session.inbox.enqueued",
              id: "evt_publication",
              created: admitted.time.created,
              data: {
                sessionID: input.sessionID,
                inboxID: input.id,
                item: { type: admitted.type, payload: admitted.payload, delivery: admitted.delivery },
              },
            })
          return admitted
        },
      },
      rpc: () => ({
        authorize: async (input: any) => {
          calls.claims.push(structuredClone(input))
          if (options.onAuthorize) return await options.onAuthorize(input)
          return `Implementation gate complete: HEAD ${input.candidate.head} unchanged. Resulting paths (0): (none). STOP before Reviewer / Commit.`
        },
      }),
      message: {
        list: async ({ sessionID, cursor }: { sessionID: string; cursor?: string }) => {
          options.onRead?.("messages", sessionID)
          const all = histories[sessionID]
          return structuredClone(
            options.singlePage
              ? { data: all, cursor: {} }
              : cursor
                ? { data: all.slice(2), cursor: {} }
                : { data: all.slice(0, 2), cursor: { next: "rest" } },
          )
        },
      },
    },
    theme: { text: { feedback: { info: { base: "blue" } } } },
    ui: {
      router: { current: () => ({ type: "session", sessionID: "parent" }) },
      slot: (claim: any) => {
        const registration = { claim, removed: false }
        slots.push(registration)
        return () => {
          registration.removed = true
          ;(registration as any).dispose?.()
        }
      },
      toast: {
        show: ({ message }: { message: string }) => {
          calls.toasts.push(message)
        },
      },
      dialog: {
        confirm: () => {
          throw new Error("Modal authorization must never be called")
        },
      },
    },
  } as unknown as Context
  let claimed: PublishedAttempt | undefined
  const claim = (published: PublishedAttempt) => {
    if (claimed) throw new Error("already claimed")
    claimed = published
  }
  const guard: DecisionOwner = {
    transfer: () => guard.assertCurrent(),
    assertCurrent: () => {
      if (generation.revoked) throw new Error("revoked")
    },
    assertDecision: (published) => {
      if (claimed !== published) throw new Error("wrong decision owner")
      guard.assertCurrent()
    },
  }
  const created = () => ({
    type: "session.created",
    id: "evt_created",
    created: sessions.parent.time.created,
    data: { sessionID: "parent", agent: "orchestrator", location: { directory: root } },
  })
  const emit = (event: any) => {
    handlers.get(event.type)?.(event)
    for (const listener of listeners) listener({ details: event })
  }
  const f = {
    context,
    generation,
    histories,
    sessions,
    inboxes,
    cache,
    slots,
    handlers,
    listeners,
    calls,
    options,
    guard,
    claim,
    created,
    emit,
    renderer,
  }
  fakes.set(context, f)
  return f
}
// Native transcript fixtures only; no Git or production substitution seams.
function explorerTranscript(f: ReturnType<typeof fake>, groups: string[][]) {
  const tools: Record<string, any> = {}
  for (const [index, group] of groups.entries()) {
    const response = answer(`exploration-${index}`, "planner", "")
    response.finish = "tool-calls"
    response.content = group.map((label) => {
      const prompt =
        index === 0
          ? `Investigate approach ${label}`
          : `Investigate ${label} using approach a's finding that src/attempt.ts verifyChildHistory can be reused.`
      const findings = `Approach ${label}: reuse src/attempt.ts verifyChildHistory; consider the read-only constraints.`
      const id = `explorer-${label}`
      f.sessions[id] = {
        ...structuredClone(f.sessions["planner-child"]),
        id,
        parentID: "planner-child",
        agent: "explorer",
      }
      f.inboxes[id] = []
      f.histories[id] = [
        user(`${id}-user`, prefix + prompt),
        {
          ...answer(`${id}-research`, "explorer", ""),
          finish: "tool-calls",
          content: ["read", "glob", "grep"].map((name) => ({
            type: "tool",
            id: `${id}-${name}`,
            name,
            state: { status: "completed", input: {}, content: [text("source")], metadata: {} },
          })),
        },
        answer(`${id}-final`, "explorer", findings),
        idle(`${id}-idle`),
      ]
      tools[label] = call(`${id}-call`, "explorer", prompt, id, findings)
      return tools[label]
    })
    f.histories["planner-child"].splice(1 + index, 0, response)
  }
  return tools
}
function expectNoImplementation(f: ReturnType<typeof fake>) {
  expect(f.calls.claims).toHaveLength(0)
  expect(Object.keys(f.sessions).sort()).toEqual(["parent", "planner-child"])
}
function evidence(context: Context, generation: Generation, baseline: GitSnapshot, location: { directory: string }) {
  return activationEvidence(generation, location, baseline, 0, fakes.get(context)!.created() as any)
}
function publication(
  context: Context,
  generation: Generation,
  baseline: GitSnapshot,
  _parent: string,
  location: { directory: string },
) {
  return publish(context, evidence(context, generation, baseline, location), fakes.get(context)!.guard)
}
// Test-only positive/negative decision driver for native executor invariants.
// The live-path cases below exercise the real closure's synchronous ownership separately.
async function implement(
  context: Context,
  generation: Generation,
  baseline: GitSnapshot,
  parent: string,
  location: { directory: string },
) {
  const f = fakes.get(context)!
  const published = await publication(context, generation, baseline, parent, location)
  f.claim(published)
  f.calls.decided.push(renderPlan(published.candidate))
  f.options.onDecision?.()
  if (f.options.decision !== true) throw new Error("Implementation authorization was cancelled")
  return authorizePublishedAttempt(context, published, f.guard)
}

async function settleUntil(done: () => boolean) {
  for (let i = 0; i < 2000 && !done(); i++) await Promise.resolve()
  expect(done()).toBe(true)
}
async function activate(f: ReturnType<typeof fake>, created?: number) {
  const cleanup = await plugin.setup(f.context)
  f.sessions.parent.time.created = created ?? Date.now() + 10
  f.emit(f.created())
  f.emit({
    type: "session.execution.succeeded",
    id: "evt_completed",
    created: Date.now() + 20,
    data: { sessionID: "parent" },
  })
  await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
  return () => {
    if (typeof cleanup === "function") cleanup()
  }
}
function mount(f: ReturnType<typeof fake>, sessionID = "parent", completeLayout = true) {
  const registration = f.slots.at(-1) ?? { removed: true, claim: { append: "session.composer.top" } }
  expect(registration.claim.append).toBe("session.composer.top")
  const begin = elements.length
  let releaseRoot!: () => void
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    releaseRoot()
  }
  const view = createRoot((release) => {
    releaseRoot = release
    return registration.removed ? undefined : registration.claim.render({ sessionID })
  })
  const mounted = elements.slice(begin)
  registration.dispose = dispose
  if (completeLayout) f.renderer.emit("frame")
  const buttons = mounted.filter((node) => node.onMouseUp)
  const click = (index: number, button = 0) => buttons[index]?.onMouseUp({ button, stopPropagation() {} })
  const text = () =>
    elements
      .slice(begin)
      .filter((node) => node.type === "literal")
      .map((node) => String(node.value))
      .join(" ")
  return { view, mounted, buttons, click, text, dispose }
}

// Only these retained-publication cases intercept the real returned object.
// Restore the export before root return; the plugin keeps its private ownership.
async function startInspectedPublication(
  f: ReturnType<typeof fake>,
  beforeCompletion?: (select: (id: string) => void) => void,
) {
  const realAttempt = { ...attemptModule }
  const modulePath = path.resolve(import.meta.dir, "../src/attempt.ts")
  let resolve!: (published: PublishedAttempt) => void
  let reject!: (error: unknown) => void
  const returned = new Promise<PublishedAttempt>((done, failed) => {
    resolve = done
    reject = failed
  })
  mock.module(modulePath, () => ({
    ...realAttempt,
    publishPlan: async (...args: Parameters<typeof publish>) => {
      const published = await realAttempt.publishPlan(...args).catch((error) => {
        reject(error)
        throw error
      })
      resolve(published)
      return published
    },
  }))
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
    select,
    completed,
    finish: async () => {
      try {
        const published = await returned
        // Let the real TUI publication continuation take retained ownership.
        await Promise.resolve()
        expect(f.calls.toasts).toEqual([])
        expect(f.slots).toEqual([])
        return published
      } finally {
        mock.module(modulePath, () => realAttempt)
      }
    },
    cleanup: () => {
      mock.module(modulePath, () => realAttempt)
      if (typeof cleanup === "function") cleanup()
    },
  }
}

snapshotTest(
  "post-idle publication binds exact Planner P and publishes it without authorizing implementation",
  async (observer) => {
    const root = snapshotFixture(observer)
    const f = fake(root, {
      onWait: (sessionID) => {
        if (sessionID === "parent") f.calls.toasts.push("root wait returned")
      },
    })
    const baseline = observeGit(root)
    const result = await publication(f.context, f.generation, baseline, "parent", { directory: root })
    expect(result.candidate).toEqual(
      makeCandidate(parseProposal(proposal, baseline.root), baseline.root, baseline.head),
    )
    expect(result.publication.id).toStartWith("msg_")
    expect(f.calls.synthetic).toEqual([
      {
        id: result.publication.id,
        delivery: "steer",
        sessionID: "parent",
        text: proposal,
        description: renderPlan(result.candidate),
        metadata: { source: "planner", planHash: result.publication.payload.metadata!.planHash },
        resume: false,
      },
    ])
    expect(f.calls.toasts[0]).toBe("root wait returned")
    expect(f.calls.decided).toEqual([])
    expectNoImplementation(f)
    expect(
      observer
        .calls(root)
        .slice(1)
        .every((call) => call.baseline !== undefined),
    ).toBe(true)

    // Exercise the double's contract separately from the production call records.
    const isolated = new SnapshotObserver()
    expect(() => isolated.observe(root)).toThrow("Unconfigured")
    isolated.configure(root)
    const trusted = isolated.observe(root + "/.")
    expect([
      trusted.root,
      trusted.head,
      trusted.paths,
      Object.isFrozen(trusted),
      Object.isFrozen(trusted.paths),
    ]).toEqual([root, HEAD, [], true, true])
    for (const bound of [
      { ...trusted, root: root + "/other" },
      { ...trusted, head: "0".repeat(40) },
    ]) {
      expect(() => isolated.observe(root, bound)).toThrow("root or HEAD changed")
    }
    isolated.configure(root, "2".repeat(40), ["old.txt", "new.txt", "old.txt"])
    expect(() => isolated.observe(root, trusted)).toThrow("root or HEAD changed")
    expect(isolated.observe(root).paths).toEqual(["new.txt", "old.txt"])
    expect(trusted).toEqual({ root, head: HEAD, paths: [] })
    isolated.close()
    expect(() => isolated.observe(root)).toThrow("closed")
  },
)

snapshotTest("publication refuses to publish while the root execution is active", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { rootActive: true })
  await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
    "running",
  )
  expect(f.calls.synthetic).toEqual([])
})

snapshotTest("publication reports an immediate root wake after synthetic admission", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { wakeOnSynthetic: true })
  await expect(publication(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
    "running",
  )
  expect(f.calls.synthetic).toHaveLength(1)
})

snapshotTest(
  "Planner may complete read and search tools while the implementation child does not exist",
  async (observer) => {
    for (const tool of ["read", "glob", "grep"]) {
      const root = snapshotFixture(observer)
      const f = fake(root, { decision: false })
      f.histories["planner-child"].splice(1, 0, {
        type: "assistant",
        id: "planner-read",
        agent: "planner",
        content: [
          {
            type: "tool",
            id: "read-call",
            name: tool,
            state: { status: "completed", input: { path: "old.txt" }, content: [text("initial")], metadata: {} },
          },
        ],
      })
      await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
        "cancelled",
      )
      expect(f.calls.decided).toHaveLength(1)
      expectNoImplementation(f)
    }
  },
)

snapshotTest(
  "missing, duplicate, continued, background, or substituted native child evidence stops before decision",
  async (observer) => {
    for (const mutate of [
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content.pop()
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content.push(f.histories.parent[1].content[0])
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content[0].state.input.sessionID = "old-child"
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content[0].state.input.background = false
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content[0].state.input.model = "other"
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content[0].state.metadata[plannerReceiptKey].input.prompt += " "
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent[1].content[0].state.metadata.status = "running"
      },
      (f: ReturnType<typeof fake>) => {
        f.sessions["planner-child"].parentID = "other"
      },
      (f: ReturnType<typeof fake>) => {
        f.histories["planner-child"].push(user("extra", "extra"))
      },
    ]) {
      const root = snapshotFixture(observer)
      const f = fake(root, { decision: true })
      mutate(f)
      await expect(
        implement(f.context, f.generation, observeGit(root), "parent", { directory: root }),
      ).rejects.toThrow()
      expect(f.calls.decided).toEqual([])
      expectNoImplementation(f)
    }
  },
)

snapshotTest(
  "Planner receipt and child bootstrap tampering stop publication and later authorization",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "missing",
      "user",
      "prompt",
      "description",
      "agent",
      "optional-key",
      "missing-key",
      "receipt-extra",
      "malformed",
      "bootstrap",
    ]) {
      for (const timing of ["publication", "authorization"]) {
        const f = fake(root)
        const published =
          timing === "authorization"
            ? await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
            : undefined
        const metadata = f.histories.parent[1].content[0].state.metadata
        const receipt = metadata[plannerReceiptKey]
        if (mutation === "missing") delete metadata[plannerReceiptKey]
        if (mutation === "user") receipt.userID = "different-user"
        if (mutation === "prompt") receipt.input.prompt += " "
        if (mutation === "description") receipt.input.description = "different label"
        if (mutation === "agent") receipt.input.agent = "authorized_implementer"
        if (mutation === "optional-key") receipt.input.background = false
        if (mutation === "missing-key") delete receipt.input.description
        if (mutation === "receipt-extra") receipt.phase = "planning"
        if (mutation === "malformed") receipt.input = null
        if (mutation === "bootstrap") f.histories["planner-child"][0].text += " "
        if (published) {
          f.claim(published)
          await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow()
        } else {
          await expect(
            publication(f.context, f.generation, observeGit(root), "parent", { directory: root }),
          ).rejects.toThrow()
        }
        expectNoImplementation(f)
      }
    }
  },
)

test("native role files allow only Planner to delegate to Explorer through ordered effective rules", () => {
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
    rules
      .filter(
        (rule) =>
          (rule.action === "*" || rule.action === action) && (rule.resource === "*" || rule.resource === resource),
      )
      .at(-1)?.effect
  for (const name of ["orchestrator", "planner", "explorer", "authorized_implementer"]) {
    const rules = load(name)
    expect(rules[0]).toEqual({ action: "*", resource: "*", effect: "deny" })
    for (const action of ["execute", "session_move", "session_rename", "opencode", "mcp", "question"]) {
      expect(effect(rules, action)).toBe("deny")
    }
    expect(effect(rules, "subagent", "authorized_implementer")).toBe("deny")
    expect(effect(rules, "subagent", "other")).toBe("deny")
    expect(effect(rules, "subagent", "explorer")).toBe(name === "planner" ? "allow" : "deny")
  }
  const orchestrator = load("orchestrator")
  expect(effect(orchestrator, "subagent", "planner")).toBe("allow")
  expect(effect(orchestrator, "subagent", "authorized_implementer")).toBe("deny")
  expect(effect(orchestrator, "edit")).toBe("deny")
  expect(effect(orchestrator, "shell", "git status")).toBe("deny")
  for (const name of ["planner", "explorer"]) {
    const rules = load(name)
    for (const action of ["read", "glob", "grep"]) expect(effect(rules, action)).toBe("allow")
    for (const action of ["edit", "shell", "subagent", "write", "patch"]) expect(effect(rules, action)).toBe("deny")
  }
  expect(JSON.parse(readFileSync(path.join(import.meta.dir, "../opencode.json"), "utf8"))).toEqual({
    experimental: { subagent_depth: 2 },
  })
  const authorized = load("authorized_implementer")
  expect(effect(authorized, "edit")).toBe("allow")
  expect(effect(authorized, "shell", "git status")).toBe("allow")
  expect(effect(authorized, "shell", "git commit")).toBe("deny")
  expect(effect(authorized, "shell", "git commit *")).toBe("deny")
  expect(effect(authorized, "subagent", "planner")).toBe("deny")
  const instructions = readFileSync(path.join(import.meta.dir, "../.opencode/agents/authorized_implementer.md"), "utf8")
  expect(instructions).toContain(
    "Do not intentionally perform Git commit or other history effects reserved for the trusted CAP path.",
  )
  expect(instructions).toContain(
    "Do not intentionally manipulate Git configuration, index metadata, ignore rules, repository metadata, or other shell accessible state to conceal changes or evade ordinary Git changed-path scope observation.",
  )
})

snapshotTest(
  "session permission overrides and changed bound transcripts stop before child creation",
  async (observer) => {
    for (const mutate of [
      (f: ReturnType<typeof fake>) => {
        f.sessions.parent.permissions = [{ action: "shell", resource: "*", effect: "allow" }]
      },
      (f: ReturnType<typeof fake>) => {
        f.sessions["planner-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
      },
      (f: ReturnType<typeof fake>) => {
        f.histories.parent.push(user("extra-parent", "another request"))
      },
    ]) {
      const root = snapshotFixture(observer)
      const f = fake(root, { decision: true })
      mutate(f)
      await expect(
        implement(f.context, f.generation, observeGit(root), "parent", { directory: root }),
      ).rejects.toThrow()
      expectNoImplementation(f)
    }
  },
)

snapshotTest("Planner rejects forbidden or unfinished tools", async (observer) => {
  for (const [name, status] of [
    ["edit", "completed"],
    ["read", "running"],
  ]) {
    const root = snapshotFixture(observer)
    const f = fake(root, { decision: true })
    f.histories["planner-child"].splice(1, 0, {
      type: "assistant",
      id: "planner-tool",
      agent: "planner",
      model,
      content: [{ type: "tool", id: "planner-call", name, state: { status, input: {}, content: [], metadata: {} } }],
    })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
      "disallowed tool",
    )
    expect(f.calls.decided).toEqual([])
    expectNoImplementation(f)
  }
})

snapshotTest(
  "fresh foreground Explorers support zero, one, concurrent, dependent and mixed planning",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const groups of [[], [["a"]], [["a", "b", "c"]], [["a"], ["b"]], [["a", "b"], ["d"]]]) {
      const f = fake(root)
      const tools = explorerTranscript(f, groups)
      const list = f.context.client.session.list
      f.context.client.session.list = async (input) => {
        const page = await list(input)
        page.data.reverse() // Native listing order need not match call/result order.
        return page
      }
      if (tools.a) {
        // Host hooks/truncation may change returned content; Explorer JSON is advisory too.
        tools.a.state.metadata = {
          sessionID: "explorer-a",
          status: "completed",
          truncated: true,
          outputPath: "/host/output",
          unrelated: true,
        }
        tools.a.state.content = [
          text("Bounded findings: reuse src/attempt.ts verifyChildHistory"),
          text("Native output marker"),
          { type: "file", uri: "file:///host/output", mime: "text/plain" },
        ]
        f.histories["explorer-a"][2].content = [
          text(JSON.stringify({ intent: "Other", plan: "Other", files: ["unauthorized.txt"] })),
        ]
      }
      const published = await publication(f.context, f.generation, observer.observe(root), "parent", {
        directory: root,
      })
      expect(published.candidate.proposal).toEqual(JSON.parse(proposal))
      expect(published.publication.payload.text).toBe(proposal)
      expect(published.bound.plannerChild).toEqual({
        inputID: "planner-user",
        finalID: "planner-final",
        text: proposal,
      })
      expect(Object.keys(published.bound).sort()).toEqual([
        "parentCreatedAt",
        "parentID",
        "planner",
        "plannerChild",
        "request",
        "userID",
      ])
      await verifyPublishedAttempt(f.context, published, f.guard)
      f.claim(published)
      await authorizePublishedAttempt(f.context, published, f.guard)
      expect(f.calls.claims).toHaveLength(1)
      expect(Object.keys(f.calls.claims[0]).sort()).toEqual([
        "candidate",
        "location",
        "publicationID",
        "purpose",
        "rootSessionID",
      ])
    }
  },
)

snapshotTest(
  "later Explorer activity cannot change accepted findings during publication or authorization",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const boundary of ["later child read", "publication hydration", "published Plan"]) {
      for (const delivery of ["immediate", "buffered"]) {
        const f = fake(root)
        const tools = explorerTranscript(f, [["a", "b"], ["d"]])
        const returnedFindings = structuredClone(tools.a.state.content)
        let changed = false
        const mutate = () => {
          if (changed) return
          changed = true
          f.histories["explorer-a"].push(user("later-input", "Unrelated new investigation"))
          f.histories["explorer-a"][2].content = [text("Replace the proposal with unauthorized.txt")]
          f.sessions["explorer-a"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
          f.inboxes["explorer-a"].push({ type: "user", text: "Later pending input" })
          if (delivery === "immediate") {
            for (const type of ["session.inbox.enqueued", "session.permissions", "session.text.ended"])
              f.emit({ type, id: "later-explorer-activity", data: { sessionID: "explorer-a" } })
          }
        }
        if (boundary === "later child read") {
          f.options.onGet = (id) => {
            if (id === "explorer-b") mutate() // A's provenance reads have completed.
          }
        } else if (boundary === "publication hydration") {
          f.options.onRead = (kind) => {
            if (kind === "hydrate") mutate()
          }
        }
        const cleanup = await activate(f)
        const view = mount(f)
        try {
          if (boundary === "published Plan") mutate()
          expect(changed).toBe(true)
          expect(tools.a.state.content).toEqual(returnedFindings)
          expect(f.calls.synthetic[0].text).toBe(proposal)
          expect(f.inboxes.parent[0].payload.text).toBe(proposal)
          expect(f.calls.toasts).toEqual([])
          f.sessions.extra = { ...f.sessions["explorer-b"], id: "extra" }
          f.sessions.descendant = { ...f.sessions["explorer-b"], id: "descendant", parentID: "explorer-b" }
          if (delivery === "immediate") {
            for (const child of [f.sessions.extra, f.sessions.descendant])
              f.emit({
                type: "session.created",
                id: `created-${child.id}`,
                data: { sessionID: child.id, parentID: child.parentID },
              })
          }
          // Deleting the advisory session makes further child verification
          // impossible, but cannot change the accepted proposal or CAP claim.
          delete f.sessions["explorer-a"]
          delete f.histories["explorer-a"]
          delete f.inboxes["explorer-a"]
          if (delivery === "immediate")
            f.emit({ type: "session.deleted", id: "deleted-explorer", data: { sessionID: "explorer-a" } })
          view.click(0)
          await settleUntil(() => f.calls.claims.length === 1 || f.calls.toasts.length > 0)
          expect(f.calls.claims).toHaveLength(1)
          expect(f.calls.claims[0].candidate.proposal).toEqual(JSON.parse(proposal))
          expect(Object.keys(f.calls.claims[0]).sort()).toEqual([
            "candidate",
            "location",
            "publicationID",
            "purpose",
            "rootSessionID",
          ])
        } finally {
          cleanup()
          view.dispose()
        }
      }
    }
  },
)

snapshotTest("published authority survives later advisory topology changes", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  explorerTranscript(f, [["a", "b"]])
  const published = await publication(f.context, f.generation, observer.observe(root), "parent", { directory: root })
  const original = structuredClone(published)
  f.sessions.extra = { ...f.sessions["explorer-a"], id: "extra" }
  f.sessions.descendant = { ...f.sessions["explorer-a"], id: "descendant", parentID: "explorer-a" }
  f.histories["explorer-a"][1].content[0].name = "subagent"
  await verifyPublishedAttempt(f.context, published, f.guard)
  f.claim(published)
  await authorizePublishedAttempt(f.context, published, f.guard)
  expect(published).toEqual(original)
  expect(f.calls.claims[0].candidate).toEqual(original.candidate)
})

snapshotTest("Explorer independence does not relax root, Planner, Plan or Git authority", async (observer) => {
  const root = snapshotFixture(observer)
  for (const mutation of ["root request", "receipt", "Planner input", "Planner final", "Plan", "HEAD", "worktree"]) {
    observer.configure(root)
    const f = fake(root)
    explorerTranscript(f, [["a", "b"], ["d"]])
    const published = await publication(f.context, f.generation, observer.observe(root), "parent", { directory: root })
    if (mutation === "root request") f.histories.parent[0].text += "changed"
    if (mutation === "receipt")
      f.histories.parent[1].content[0].state.metadata[plannerReceiptKey].input.prompt += "changed"
    if (mutation === "Planner input") f.histories["planner-child"][0].text += "changed"
    if (mutation === "Planner final")
      f.histories["planner-child"].find((message) => message.id === "planner-final").content = [
        text(JSON.stringify({ ...JSON.parse(proposal), files: ["unauthorized.txt"] })),
      ]
    if (mutation === "Plan") f.inboxes.parent[0].payload.text += "changed"
    if (mutation === "HEAD") observer.configure(root, "2".repeat(40))
    if (mutation === "worktree") observer.configure(root, HEAD, ["old.txt"])
    f.claim(published)
    await expect(authorizePublishedAttempt(f.context, published, f.guard), mutation).rejects.toThrow()
    expect(f.calls.claims).toHaveLength(0)
  }
})

snapshotTest("direct root and Planner history events still close pending authority", async (observer) => {
  const root = snapshotFixture(observer)
  for (const sessionID of ["parent", "planner-child"]) {
    for (const mutation of [
      "instructions",
      "synthetic",
      "skill",
      "shell",
      "compaction",
      "final text",
      "tool input",
      "failed step",
    ]) {
      const f = fake(root)
      explorerTranscript(f, [["a", "b"]])
      const cleanup = await activate(f)
      const view = mount(f)
      try {
        const final = f.histories[sessionID].find(
          (message) => message.id === (sessionID === "parent" ? "parent-final" : "planner-final"),
        )
        const event = {
          instructions: "session.instructions.updated",
          synthetic: "session.synthetic",
          skill: "session.skill.activated",
          shell: "session.shell.started",
          compaction: "session.compaction.ended",
          "final text": "session.text.ended",
          "tool input": "session.tool.called",
          "failed step": "session.step.failed",
        }[mutation]!
        const saved = structuredClone(f.histories[sessionID])
        if (mutation === "final text") final.content = [text("Changed final text")]
        else if (mutation === "failed step") final.finish = "error"
        else if (mutation === "tool input") f.histories[sessionID][1].content[0].state.input = {}
        else
          f.histories[sessionID].push({
            id: "direct-control",
            type: mutation === "instructions" ? "system" : mutation,
            text: "New control",
          })
        f.emit({ type: event, id: "direct-history-event", data: { sessionID, text: "New control" } })
        expect(f.calls.toasts.at(-1), `${mutation} on ${sessionID}`).toContain("STOP")
        // Even restoring the evidence cannot revive a closed decision owner.
        f.histories[sessionID] = saved
        view.click(0)
        expect(f.calls.claims).toHaveLength(0)
      } finally {
        cleanup()
        view.dispose()
      }
    }
  }
})

snapshotTest("invalid Explorer calls, children and histories reject planning publication", async (observer) => {
  const root = snapshotFixture(observer)
  type Mutation = (f: ReturnType<typeof fake>, tool: any) => void
  const mutations: Record<string, Mutation> = {
    "wrong target": (_f, t) => {
      t.state.input.agent = "planner"
    },
    "missing input": (_f, t) => {
      t.state.input = null
    },
    "missing description": (_f, t) => {
      delete t.state.input.description
    },
    "empty description": (_f, t) => {
      t.state.input.description = ""
    },
    "malformed description": (_f, t) => {
      t.state.input.description = 1
    },
    "missing prompt": (_f, t) => {
      delete t.state.input.prompt
    },
    "empty prompt": (_f, t) => {
      t.state.input.prompt = " "
    },
    "malformed prompt": (_f, t) => {
      t.state.input.prompt = {}
    },
    "extra key": (_f, t) => {
      t.state.input.extra = true
    },
    continuation: (_f, t) => {
      t.state.input.sessionID = "explorer-a"
    },
    "empty continuation": (_f, t) => {
      t.state.input.sessionID = ""
    },
    "model override": (_f, t) => {
      t.state.input.model = "provider/model"
    },
    background: (_f, t) => {
      t.state.input.background = true
    },
    "background false": (_f, t) => {
      t.state.input.background = false
    },
    "streaming call": (_f, t) => {
      t.state.status = "streaming"
    },
    "running call": (_f, t) => {
      t.state.status = "running"
    },
    "failed call": (_f, t) => {
      t.state.status = "error"
    },
    "hosted call": (_f, t) => {
      t.executed = true
    },
    "missing call ID": (_f, t) => {
      t.id = ""
    },
    "malformed call ID": (_f, t) => {
      t.id = 7
    },
    "duplicate call ID": (f, t) => {
      f.histories["planner-child"][1].content[1].id = t.id
    },
    "missing metadata": (_f, t) => {
      delete t.state.metadata
    },
    "missing child metadata": (_f, t) => {
      delete t.state.metadata.sessionID
    },
    "empty child metadata": (_f, t) => {
      t.state.metadata.sessionID = ""
    },
    "malformed child metadata": (_f, t) => {
      t.state.metadata.sessionID = 1
    },
    "wrong child metadata": (_f, t) => {
      t.state.metadata.sessionID = "missing"
    },
    "missing completion metadata": (_f, t) => {
      delete t.state.metadata.status
    },
    "running result": (_f, t) => {
      t.state.metadata.status = "running"
    },
    "missing returned content": (_f, t) => {
      delete t.state.content
    },
    "empty returned content": (_f, t) => {
      t.state.content = []
    },
    "empty returned text": (_f, t) => {
      t.state.content = [text("")]
    },
    "malformed returned content": (_f, t) => {
      t.state.content = [text("valid"), { type: "text", text: 7 }]
    },
    "missing child": (f) => {
      delete f.sessions["explorer-a"]
    },
    "wrong child ID": (f) => {
      f.sessions["explorer-a"].id = "other"
    },
    "wrong parent": (f) => {
      f.sessions["explorer-a"].parentID = "parent"
    },
    "wrong role": (f) => {
      f.sessions["explorer-a"].agent = "authorized_implementer"
    },
    "wrong directory": (f) => {
      f.sessions["explorer-a"].location.directory = "/other"
    },
    "wrong workspace": (f) => {
      f.sessions["explorer-a"].location.workspaceID = "other"
    },
    fork: (f) => {
      f.sessions["explorer-a"].fork = {}
    },
    revert: (f) => {
      f.sessions["explorer-a"].revert = {}
    },
    archive: (f) => {
      f.sessions["explorer-a"].time.archived = 3
    },
    overrides: (f) => {
      f.sessions["explorer-a"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
    },
    "failed child": (f) => {
      f.sessions["explorer-a"].outcome = "failed"
    },
    "interrupted child": (f) => {
      f.sessions["explorer-a"].outcome = "interrupted"
    },
    "nonidle child": (f) => {
      delete f.sessions["explorer-a"].time.idle
    },
    "active child": (f) => {
      f.context.client.session.active = async () => ({ "explorer-a": { type: "running" } }) as any
    },
    "pending input": (f) => {
      f.inboxes["explorer-a"].push({ type: "user", text: "extra" })
    },
    "root reference": (_f, t) => {
      t.state.metadata.sessionID = "parent"
    },
    "Planner reference": (_f, t) => {
      t.state.metadata.sessionID = "planner-child"
    },
    "reused child": (f, t) => {
      f.histories["planner-child"][1].content[1].state.metadata.sessionID = t.state.metadata.sessionID
    },
    orphan: (f) => {
      f.sessions.orphan = { ...f.sessions["explorer-a"], id: "orphan" }
    },
    descendant: (f) => {
      f.sessions.nested = { ...f.sessions["explorer-a"], id: "nested", parentID: "explorer-a" }
    },
    "bootstrap drift": (f) => {
      f.histories["explorer-a"][0].text += " "
    },
    "bootstrap files": (f) => {
      f.histories["explorer-a"][0].files = [{}]
    },
    "added user": (f) => {
      f.histories["explorer-a"].splice(1, 0, user("extra", "continue"))
    },
    "wrong assistant": (f) => {
      f.histories["explorer-a"][1].agent = "planner"
    },
    "assistant error": (f) => {
      f.histories["explorer-a"][1].error = { type: "failed" }
    },
    "failed idle": (f) => {
      f.histories["explorer-a"][3].outcome = "failed"
    },
    "missing terminal idle": (f) => {
      f.histories["explorer-a"].pop()
    },
    "unfinished final": (f) => {
      f.histories["explorer-a"][2].finish = "tool-calls"
    },
    "empty findings": (f) => {
      f.histories["explorer-a"][2].content = [text(" ")]
    },
    "duplicate message": (f) => {
      f.histories["explorer-a"][2].id = f.histories["explorer-a"][1].id
    },
    "Planner final drift": (f) => {
      f.histories["planner-child"].find((m) => m.id === "planner-final").content = [text("Other proposal")]
    },
  }
  for (const agent of ["planner", "explorer"]) {
    for (const name of [
      "edit",
      "write",
      "patch",
      "apply_patch",
      "shell",
      "bash",
      "execute",
      "session_move",
      "native.read",
      "unknown",
      ...(agent === "explorer" ? ["subagent"] : []),
    ]) {
      mutations[`${agent} ${name}`] = (f) => {
        const part =
          agent === "explorer" ? f.histories["explorer-a"][1].content[0] : f.histories["planner-child"][1].content[0]
        part.name = name
      }
    }
    for (const status of ["running", "streaming", "error"]) {
      mutations[`${agent} ${status} tool`] = (f) => {
        const part =
          agent === "explorer" ? f.histories["explorer-a"][1].content[0] : f.histories["planner-child"][1].content[0]
        part.state.status = status
      }
    }
    for (const kind of ["synthetic", "system", "compaction", "agent-switched", "location-switched", "shell", "skill"]) {
      mutations[`${agent} ${kind} history`] = (f) => {
        f.histories[agent === "planner" ? "planner-child" : "explorer-a"].splice(1, 0, {
          id: "unexpected",
          type: kind,
          text: "unexpected control",
        })
      }
    }
  }
  for (const [label, mutate] of Object.entries(mutations)) {
    const f = fake(root)
    const tools = explorerTranscript(f, [["a", "b"]])
    mutate(f, tools.a)
    await expect(
      publication(f.context, f.generation, observer.observe(root), "parent", { directory: root }),
      label,
    ).rejects.toThrow()
    expect(f.calls.synthetic).toHaveLength(0)
    expect(f.calls.claims).toHaveLength(0)
  }
})

snapshotTest(
  "Explorer topology pagination fails closed and checks ownership after new awaited reads",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of ["repeated cursor", "duplicate child", "wrong listing parent", "incomplete page"]) {
      const f = fake(root)
      explorerTranscript(f, [["a", "b", "c"]])
      const original = f.context.client.session.list
      f.context.client.session.list = async (input) => {
        const page = await original(input)
        if (input?.parentID !== "planner-child") return page
        if (mutation === "repeated cursor") page.cursor.next = "rest"
        if (mutation === "duplicate child" && input.cursor) page.data.push(f.sessions["explorer-a"])
        if (mutation === "wrong listing parent") page.data[0].parentID = "other"
        if (mutation === "incomplete page" && !input.cursor) {
          page.data = []
          page.cursor.next = null
        }
        return page
      }
      await expect(
        publication(f.context, f.generation, observer.observe(root), "parent", { directory: root }),
        mutation,
      ).rejects.toThrow()
      expect(f.calls.claims).toHaveLength(0)
    }
    for (const kind of ["get", "inbox", "messages", "children"]) {
      const f = fake(root)
      explorerTranscript(f, [["a"]])
      f.options.onRead = (read, id) => {
        if (read === kind && id === "explorer-a") f.generation.revoked = true
      }
      await expect(
        publication(f.context, f.generation, observer.observe(root), "parent", { directory: root }),
      ).rejects.toThrow()
      expect(f.calls.synthetic).toHaveLength(0)
      expect(f.calls.claims).toHaveLength(0)
    }
  },
)

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
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
      mutation === "cursor" ? "repeated a cursor" : "duplicate message ID",
    )
    expect(f.calls.decided).toEqual([])
  }
})

snapshotTest(
  "publication preserves pretty-printed raw Planner P and rejects altered synthetic admission",
  async (observer) => {
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
    }
  },
)

snapshotTest("a delivered Plan never relaxes the original native history binding", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root, { decision: true })
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  f.claim(published)
  f.histories.parent.push({
    type: "synthetic",
    id: published.publication.id,
    text: proposal,
    description: renderPlan(published.candidate),
    metadata: published.publication.payload.metadata,
  })
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("unexpected parent input")
  expectNoImplementation(f)
})

snapshotTest("publication refuses pending inbox input and a changed publication path set", async (observer) => {
  for (const mutation of ["inbox", "paths"] as const) {
    const root = snapshotFixture(observer)
    observer.configure(root, HEAD, ["old.txt"])
    const baseline = observeGit(root)
    const f = fake(root)
    if (mutation === "paths") observer.configure(root, HEAD, ["old.txt", "new.txt"])
    else (f.context as unknown as any).client.session.inbox.list = async () => [{ id: "pending" }]
    await expect(publication(f.context, f.generation, baseline, "parent", { directory: root })).rejects.toThrow(
      mutation === "paths" ? "publication worktree paths changed" : "pending input",
    )
    expect(f.calls.synthetic).toEqual([])
    expect(f.calls.decided).toEqual([])
  }
})

snapshotTest("activation location substitution during decision cannot create or dispatch", async (observer) => {
  for (const field of ["directory", "workspaceID"] as const) {
    const root = snapshotFixture(observer)
    const [location, setLocation] = createStore({
      directory: root,
      workspaceID: undefined as string | undefined,
      project: { id: "project", directory: root, canonical: root },
    })
    const f = fake(root, {
      decision: true,
      onDecision: () => {
        setLocation(field, "changed")
      },
    })
    Object.defineProperty(f.context, "location", { get: () => location })
    await expect(implement(f.context, f.generation, observeGit(root), "parent", { directory: root })).rejects.toThrow(
      "TUI location changed",
    )
    expectNoImplementation(f)
  }
})

test("location snapshots detach and freeze the identity fields of non-cloneable host info", () => {
  const [location, setLocation] = createStore({
    directory: "/original",
    workspaceID: "workspace-original",
    project: { id: "project", directory: "/project", canonical: "/canonical" },
  })
  expect(() => structuredClone(location)).toThrow()
  const snapshot = snapshotLocation(location)
  expect(snapshot).toEqual({ directory: "/original", workspaceID: "workspace-original" })
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(() => {
    ;(snapshot as any).directory = "/forged"
  }).toThrow()
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
    const [store] = createStore({
      info: { directory: root, project: { id: "project", directory: root, canonical: root } },
      ref: { directory: root },
    })
    expect(() => structuredClone(source === "current" ? store.info : store.ref)).toThrow()
    const f = fake(root)
    let synchronized = source === "current"
    Object.defineProperty(f.context, "location", { get: () => (synchronized ? store.info : undefined) })
    Object.assign(f.context.data.location, { default: () => store.ref })
    const cleanup = await plugin.setup(f.context)
    expect(f.handlers.has("session.created")).toBe(true)
    expect(f.calls.synthetic).toEqual([])
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
    if (typeof cleanup === "function") cleanup()
    view.dispose()
  }
})

snapshotTest("TUI startup location evidence survives proxy mutation and rejects identity drift", async (observer) => {
  for (const field of ["directory", "workspaceID"] as const) {
    const root = snapshotFixture(observer)
    const [location, setLocation] = createStore({
      directory: root,
      workspaceID: undefined as string | undefined,
      project: { id: "project", directory: root, canonical: root },
    })
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
    expect(f.slots).toHaveLength(0)
    const view = mount(f)
    expect(view.buttons).toEqual([])
    expect(view.text()).toBe("")
    view.dispose()
    expectNoImplementation(f)
    if (typeof cleanup === "function") cleanup()
  }
})

snapshotTest(
  "semantic planning binding accepts cosmetic records, model changes and finite visible history",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    f.sessions.parent.model = { providerID: "other", id: "other" }
    f.sessions.parent.projectID = "cosmetic-project"
    f.sessions.parent.subpath = "cosmetic-subpath"
    f.sessions.parent.metadata = { unrelated: true }
    f.sessions["planner-child"].metadata = { unrelated: true }
    for (const history of Object.values(f.histories)) {
      for (let i = 0; i < history.length; i++) {
        history[i] = {
          ...Object.fromEntries(Object.entries(history[i]).reverse()),
          time: { created: 999 },
          tokens: { unrelated: true },
        }
        if (history[i].type === "assistant") history[i].model = { providerID: "other", id: "other" }
      }
    }
    f.histories.parent[1].content[0].state.content = [
      text("Host truncated the native display"),
      text("Extra presentation"),
    ]
    f.histories.parent[1].content[0].state.metadata.truncated = true
    f.histories.parent[1].content[0].state.metadata.outputPath = "/ignored/display"
    f.inboxes.parent[0].time.created++
    f.inboxes.parent[0].payload.metadata.planHash = "cosmetic-label"
    f.inboxes.parent[0].payload.extra = true
    f.inboxes.parent[0].extra = true
    // More server history than the host's visible window. Only the exact Plan
    // needs to be visible; unrelated server/store rows do not become authority.
    f.histories.parent.splice(
      2,
      0,
      ...Array.from({ length: 30 }, (_, i) => answer(`neutral-${i}`, "orchestrator", "Unrelated prose")),
    )
    f.cache.parent = [answer("unrelated-visible", "orchestrator", "Visible window"), f.cache.parent.at(-1)]
    expect(publishedPresentationMatches(f.context, published)).toBe(true)
    f.claim(published)
    await authorizePublishedAttempt(f.context, published, f.guard)
    expect(f.calls.claims).toHaveLength(1)
    expect(f.calls.claims[0].candidate).toEqual(published.candidate)
  },
)

snapshotTest(
  "decision-time semantic planning evidence rejects changed request/call/child/proposal and added input",
  async (observer) => {
    for (const mutation of [
      "request",
      "call",
      "child",
      "prompt",
      "role",
      "proposal",
      "added-input",
      "mutation-tool",
    ] as const) {
      const root = snapshotFixture(observer),
        f = fake(root)
      const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
      const tool = f.histories.parent[1].content[0]
      if (mutation === "request") f.histories.parent[0].text += "changed"
      if (mutation === "call") tool.id = "different"
      if (mutation === "child") tool.state.metadata.sessionID = "different"
      if (mutation === "prompt") tool.state.input.prompt += "changed"
      if (mutation === "role") f.sessions["planner-child"].agent = "authorized_implementer"
      if (mutation === "proposal") f.histories["planner-child"][1].content[0].text += " "
      if (mutation === "added-input") f.histories["planner-child"].push(user("added", "extra task"))
      if (mutation === "mutation-tool")
        f.histories["planner-child"][1].content.push({
          type: "tool",
          name: "edit",
          id: "edit",
          state: { status: "completed" },
        })
      f.claim(published)
      await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow()
      expectNoImplementation(f)
    }
  },
)

snapshotTest(
  "trusted publication displays unusual filenames unambiguously and transfers their original scope",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    const files = ["one.txt\n• second.txt", "bidi\u202efile.txt"]
    const raw = JSON.stringify({ intent: "i", plan: "p", files })
    f.histories["planner-child"][1].content[0].text = raw
    const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
    const labels = f.calls.synthetic[0].description.split("\n").filter((line: string) => line.startsWith("• "))
    expect(labels).toHaveLength(2)
    expect(labels.map((line: string) => JSON.parse(line.slice(2)))).toEqual(files)
    expect(f.calls.synthetic[0].text).toBe(raw)
    f.claim(published)
    await authorizePublishedAttempt(f.context, published, f.guard)
    expect(f.calls.claims[0].candidate.proposal.files).toEqual(files)
  },
)

snapshotTest("retained evidence is copied, deeply immutable, and coherent", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  for (const value of [
    published,
    published.activation,
    published.activation.location,
    published.activation.creation,
    published.activation.creation.data,
    published.bound,
    published.bound.planner,
    published.bound.plannerChild,
    published.publication,
    published.publication.payload,
    published.publication.payload.metadata,
    published.publication.time,
  ])
    expect(Object.isFrozen(value)).toBe(true)
  expect(() => {
    ;(published.bound.planner as any).childID = "replacement"
  }).toThrow()
  f.sessions.parent.location.directory = "different"
  expect(published.activation.location.directory).toBe(root)
  assertPublishedCoherence(published)
  for (const mutation of [
    { ...published, candidate: { ...published.candidate, root: "different" } },
    {
      ...published,
      publication: {
        ...published.publication,
        payload: { ...published.publication.payload, metadata: { source: "other", planHash: "forged" } },
      },
    },
  ])
    expect(() => assertPublishedCoherence(mutation as PublishedAttempt)).toThrow()
})

snapshotTest(
  "initial eligibility requires clean observation strictly before matching root creation",
  async (observer) => {
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
  },
)

snapshotTest(
  "pending publication checks semantic identity and rendering while allowing cosmetic envelope changes",
  async (observer) => {
    for (const mutation of [
      "keys",
      "id",
      "sessionID",
      "delivery",
      "time",
      "text",
      "description",
      "metadata",
      "source",
      "payload-key",
      "item-key",
      "extra",
      "promotion",
    ] as const) {
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
        else if (mutation === "promotion") {
          f.inboxes.parent = []
          f.histories.parent.push(f.cache.parent.at(-1))
        } else if (mutation === "time") item.time.created++
        else if (["text", "description"].includes(mutation)) item.payload[mutation] += " "
        else if (mutation === "metadata") item.payload.metadata.planHash = "forged"
        else if (mutation === "source") item.payload.metadata.source = "other"
        else if (mutation === "payload-key") item.payload.extra = true
        else if (mutation === "item-key") item.extra = true
        else item[mutation] = "different"
        if (["time", "metadata", "payload-key", "item-key"].includes(mutation))
          await verifyPublishedAttempt(f.context, published, f.guard)
        else await expect(verifyPublishedAttempt(f.context, published, f.guard)).rejects.toThrow()
      }
      expectNoImplementation(f)
    }
  },
)

snapshotTest("Cancel wins once, keeps the Plan, and stale Authorize stays inert", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const plan = structuredClone(f.cache.parent)
  const publication = structuredClone(f.inboxes.parent)
  view.click(1)
  view.click(0)
  view.click(1)
  expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
  expect(f.slots.at(-1).removed).toBe(true)
  expectNoImplementation(f)
  expect(f.cache.parent).toEqual(plan)
  expect(f.inboxes.parent).toHaveLength(1)
  expect(f.inboxes.parent).toEqual(publication)
  await settleUntil(() => f.calls.receipts.length === 1)
  expect(f.calls.receipts[0]).toMatchObject({
    sessionID: "parent",
    delivery: "steer",
    resume: false,
    text: "The published plan was cancelled before authorization.",
    description: "The published plan was cancelled before authorization.",
  })
  expect(f.inboxes.parent).toHaveLength(2)
  const returned = mount(f)
  returned.click(0)
  returned.click(1)
  f.emit({ type: "session.execution.succeeded", data: { sessionID: "parent" } })
  await Promise.resolve()
  expect(returned.buttons).toEqual([])
  expect(f.calls.receipts).toHaveLength(1)
  expectNoImplementation(f)
  returned.dispose()
  cleanup()
  view.dispose()
})

snapshotTest("trusted invalidation retires controls before dispatch and keeps the Plan unchanged", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const cleanup = await activate(f)
  const view = mount(f)
  const retainedCache = structuredClone(f.cache.parent)
  const retainedPublication = structuredClone(f.inboxes.parent)
  f.emit({ type: "session.execution.started", id: "evt_unexpected", data: { sessionID: "parent" } })
  expect(f.calls.toasts[0]).toContain("STOP — Implementation was not admitted.")
  expect(f.slots.at(-1).removed).toBe(true)
  expectNoImplementation(f)
  expect(f.cache.parent).toEqual(retainedCache)
  expect(f.inboxes.parent).toEqual(retainedPublication)
  view.click(0)
  expectNoImplementation(f)
  cleanup()
  view.dispose()
})

snapshotTest(
  "initially dirty stable Plan publishes explicit inert UX and cannot become authorizable",
  async (observer) => {
    const root = snapshotFixture(observer)
    observer.configure(root, HEAD, ["old.txt"])
    const f = fake(root)
    const cleanup = await activate(f)
    await settleUntil(() => f.calls.receipts.length === 1)
    expect(f.calls.receipts[0].text).toContain("worktree was dirty")
    observer.configure(root)
    f.renderer.emit("resize")
    expect(f.slots).toHaveLength(0)
    expectNoImplementation(f)
    expect(f.calls.synthetic).toHaveLength(1)
    cleanup()
  },
)

snapshotTest("buffered, equal, and missing Created times publish a non-authorizing receipt", async (observer) => {
  for (const time of [1, undefined]) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await plugin.setup(f.context)
    f.emit({ ...f.created(), created: time })
    f.emit({ type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } })
    await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
    await settleUntil(() => f.calls.receipts.length === 1)
    expect(f.slots).toEqual([])
    expect(f.calls.receipts[0].text).toContain("ordering could not be proven")
    if (typeof cleanup === "function") cleanup()
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
  expect(f.slots).toHaveLength(0)
  expect(f.calls.toasts.at(-1)).toContain("Unexpected session.execution.started")
  const view = mount(f)
  expect(view.buttons).toEqual([])
  expect(view.text()).toBe("")
  view.dispose()
  expectNoImplementation(f)
  cleanup()
})

snapshotTest(
  "completed Planner navigation disposes the host view but retains exact pending authorization",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const backing of ["signal", "store"] as const)
      for (const decision of ["authorize", "cancel"] as const) {
        const f = fake(root)
        const [signal, setSignal] = createSignal<any>({ type: "session", sessionID: "parent" })
        const [store, setStore] = createStore<any>({ type: "session", sessionID: "parent" })
        ;(f.context.ui.router as any).current = () => (backing === "store" ? store : signal())
        const setRoute = (route: any) => (backing === "store" ? setStore(reconcile(route)) : setSignal(route))
        const cleanup = await activate(f)
        const publication = structuredClone(f.calls.synthetic[0])
        const view = mount(f)
        let child: ReturnType<typeof mount> | undefined, returned: ReturnType<typeof mount> | undefined
        try {
          // Native Subagent.onClick changes route; app.tsx's keyed SessionFrame
          // disposes the root composer/slot and mounts the child's own slot.
          setRoute({ type: "session", sessionID: "planner-child" })
          view.dispose()
          f.emit({ type: "session.viewed", id: "view-child", data: { sessionID: "planner-child" } })
          expect(f.calls.toasts).toEqual([])
          child = mount(f, "planner-child")
          expect(child.buttons).toEqual([])
          f.renderer.emit("resize")
          f.renderer.emit("frame")
          view.click(0)
          view.click(1)
          expectNoImplementation(f)
          expect(f.calls.synthetic).toEqual([publication])
          expect(f.slots).toHaveLength(1)
          expect(f.slots[0].removed).toBe(false)

          setRoute({ type: "session", sessionID: "parent" })
          child.dispose()
          f.emit({ type: "session.viewed", id: "view-root", data: { sessionID: "parent" } })
          returned = mount(f, "parent", false)
          expect(returned.buttons).toHaveLength(2)
          returned.click(0)
          returned.click(1)
          expectNoImplementation(f) // The old readable frame cannot authorize.
          f.renderer.emit("frame")
          view.click(0)
          view.click(1) // Old view closures stay inert on return.
          expectNoImplementation(f)
          returned.click(decision === "authorize" ? 0 : 1)
          await settleUntil(() => f.calls.toasts.length > 0)
          expect(f.calls.toasts[0]).toContain(decision === "authorize" ? "Implementation gate complete" : "Cancelled")
          expect(f.calls.claims).toHaveLength(decision === "authorize" ? 1 : 0)
          expect(f.calls.synthetic).toEqual([publication])
        } finally {
          cleanup()
          view.dispose()
          child?.dispose()
          returned?.dispose()
        }
      }
  },
)

snapshotTest(
  "store-backed pending round trip retains route tracking and closes a departed pre-transfer decision",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    // OpenCode RouteProvider uses createStore/reconcile, and router.current()
    // returns that same proxy. Reading current() alone observes no route fields.
    const [route, setRoute] = createStore<any>({ type: "session", sessionID: "parent" })
    ;(f.context.ui.router as any).current = () => route
    const select = (sessionID: string) => setRoute(reconcile({ type: "session", sessionID }))
    const cleanup = await activate(f),
      view = mount(f)
    let release!: () => void,
      waiting = false
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    let returned: ReturnType<typeof mount> | undefined, status: ReturnType<typeof mount> | undefined
    try {
      select("planner-child")
      view.dispose()
      expect(f.calls.toasts).toEqual([])
      select("parent")
      returned = mount(f)
      expect(returned.buttons).toHaveLength(2)
      expect(f.calls.toasts).toEqual([])

      const get = f.context.client.session.get
      ;(f.context.client.session as any).get = async (input: any) => {
        const result = await get(input)
        waiting = true
        await paused
        return result
      }
      returned.click(0)
      await settleUntil(() => waiting)
      expectNoImplementation(f)
      select("planner-child")
      const departureStatus = [...f.calls.toasts]
      returned.dispose()
      // Return before releasing verification, with no new completed frame.
      select("parent")
      release()
      await settleUntil(() => f.calls.toasts.length > 0)
      for (let i = 0; i < 100; i++) await Promise.resolve()
      expectNoImplementation(f)
      expect(departureStatus).toHaveLength(1)
      expect(departureStatus[0]).toContain("Root view or TUI location changed")
      expect(f.calls.toasts).toEqual(departureStatus)
      status = mount(f)
      expect(status.buttons).toEqual([])
      expect(status.text()).toBe("")
      f.renderer.emit("frame")
      view.click(0)
      returned.click(0)
      returned.click(1)
      expectNoImplementation(f)
      expect(f.calls.synthetic).toHaveLength(1)
    } finally {
      release()
      cleanup()
      view.dispose()
      returned?.dispose()
      status?.dispose()
    }
  },
)

snapshotTest("pending authorization rejects changed trusted evidence after Planner navigation", async (observer) => {
  const root = snapshotFixture(observer)
  for (const mutation of [
    "head",
    "dirty",
    "publication",
    "identity",
    "projection",
    "candidate",
    "root",
    "location",
    "wake",
    "cleanup",
  ] as const) {
    observer.configure(root)
    const f = fake(root)
    const [route, setRoute] = createSignal<any>({ type: "session", sessionID: "parent" })
    ;(f.context.ui.router as any).current = route
    const cleanup = await activate(f),
      view = mount(f)
    let returned: ReturnType<typeof mount> | undefined
    try {
      setRoute({ type: "session", sessionID: "planner-child" })
      view.dispose()
      expect(f.calls.toasts).toEqual([])
      const saved = structuredClone({
        sessions: f.sessions,
        histories: f.histories,
        cache: f.cache,
        inboxes: f.inboxes,
      })
      if (mutation === "head") observer.configure(root, "2".repeat(40))
      if (mutation === "dirty") observer.configure(root, HEAD, ["old.txt"])
      if (mutation === "publication") f.inboxes.parent[0].payload.text += "changed"
      if (mutation === "identity") f.inboxes.parent[0].payload.metadata.source = "different"
      if (mutation === "projection") f.cache.parent.at(-1).description += " changed"
      if (mutation === "candidate") {
        const different = JSON.stringify({ ...JSON.parse(proposal), intent: "A different candidate" })
        f.histories["planner-child"][1].content[0].text = different
        f.histories.parent[1].content[0].state.content[0].text = `<subagent sessionID="planner-child" state="completed">\n${different}\n</subagent>`
      }
      if (mutation === "root") f.sessions.parent.agent = "build"
      if (mutation === "location") (f.context as any).location.directory = "different"
      if (mutation === "wake") f.emit({ type: "session.execution.started", id: "wake", data: { sessionID: "parent" } })
      if (mutation === "cleanup") cleanup()
      f.renderer.emit("resize")
      f.renderer.emit("frame")
      setRoute({ type: "session", sessionID: "parent" })
      if (mutation !== "cleanup") {
        returned = mount(f)
        returned.click(0)
        await settleUntil(() => f.calls.toasts.length > 0)
        expect(f.calls.toasts[0]).toContain("STOP — Implementation was not admitted")
      }
      expectNoImplementation(f)
      // Restoring the route and evidence cannot revive a genuinely closed owner.
      observer.configure(root)
      Object.assign(f.sessions, saved.sessions)
      Object.assign(f.histories, saved.histories)
      Object.assign(f.cache, saved.cache)
      Object.assign(f.inboxes, saved.inboxes)
      ;(f.context as any).location.directory = root
      setRoute({ type: "session", sessionID: "planner-child" })
      setRoute({ type: "session", sessionID: "parent" })
      f.renderer.emit("resize")
      f.renderer.emit("frame")
      returned?.click(0)
      returned?.click(1)
      view.click(0)
      expectNoImplementation(f)
      expect(f.calls.synthetic).toHaveLength(1)
    } finally {
      cleanup()
      view.dispose()
      returned?.dispose()
    }
  }
})

snapshotTest("lost root surface, projection mutation, and cleanup cannot restore controls", async (observer) => {
  for (const loss of ["unmount", "location", "projection", "projection-loss", "wake", "cleanup"] as const) {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    if (loss === "unmount") view.dispose()
    if (loss === "location") (f.context as any).location.directory = "different"
    if (loss === "projection") f.cache.parent.at(-1).description += " changed"
    if (loss === "projection-loss") f.cache.parent.pop()
    if (loss === "wake") f.emit({ type: "session.execution.started", id: "evt_wake", data: { sessionID: "parent" } })
    if (loss === "cleanup") cleanup()
    view.click(0)
    expectNoImplementation(f)
    if (loss === "unmount") expect(f.calls.toasts.at(-1)).toContain("Authorization view was lost")
    f.renderer.terminalWidth = 120
    f.renderer.emit("resize")
    f.renderer.emit("frame")
    view.click(0)
    expectNoImplementation(f)
    if (loss === "unmount") {
      const later = mount(f)
      expect(later.buttons).toEqual([])
      expect(later.text()).toBe("")
      later.dispose()
    }
    cleanup()
    view.dispose()
  }
})

snapshotTest(
  "pending ownership ignores cosmetic notifications and closes on known authority changes",
  async (observer) => {
    for (const event of [
      "session.renamed",
      "session.metadata.updated",
      "model.updated",
      "agent.updated",
      "future.cosmetic-event",
      "session.instructions.updated",
      "session.model.selected",
      "session.permissions",
      "session.agent.selected",
      "session.revert.staged",
    ]) {
      const root = snapshotFixture(observer),
        f = fake(root)
      const cleanup = await activate(f),
        view = mount(f)
      try {
        f.emit({ type: event, id: "notification", location: { directory: root }, data: { sessionID: "parent" } })
        view.click(0)
        await settleUntil(() => f.calls.toasts.length > 0)
        if (["session.permissions", "session.agent.selected", "session.revert.staged"].includes(event)) {
          expectNoImplementation(f)
          expect(f.calls.toasts[0]).toContain("STOP")
        } else expect(f.calls.claims).toHaveLength(1)
      } finally {
        cleanup()
        view.dispose()
      }
    }
  },
)

snapshotTest("measured readable geometry permits a viewport below the former 80 by 24 convention", async (observer) => {
  const root = snapshotFixture(observer),
    f = fake(root)
  const cleanup = await activate(f),
    view = mount(f, "parent", false)
  try {
    f.renderer.terminalWidth = 79
    f.renderer.terminalHeight = 23
    f.renderer.emit("resize")
    for (const node of view.mounted.filter((node) => node.type === "box" || node.type === "text"))
      if (!node.onMouseUp) node.width = 79
    f.renderer.emit("frame")
    view.click(0)
    expectNoImplementation(f)
    const rows = Math.ceil(`Worktree: ${JSON.stringify(root)}`.length / 79)
    view.mounted[0].height = rows + 3
    view.mounted.filter((node) => node.type === "text" && node.wrapMode === "char")[0].height = rows
    f.renderer.emit("frame")
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.claims).toHaveLength(1)
  } finally {
    cleanup()
    view.dispose()
  }
})

snapshotTest(
  "pending resize rejects stale callbacks and resize back needs a fresh completed frame",
  async (observer) => {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    const retainedPublication = structuredClone(f.inboxes.parent)
    f.renderer.terminalWidth = 80
    f.renderer.emit("resize")
    // Descendants and captured callbacks still belong to the old valid frame.
    expect(view.mounted[0].width).toBe(120)
    view.click(0)
    view.click(1)
    f.renderer.terminalWidth = 120
    f.renderer.emit("resize")
    view.click(0)
    view.click(1)
    expectNoImplementation(f)
    expect(f.calls.toasts).toEqual([])
    expect(view.text()).not.toContain("Authorization claimed")
    expect(f.inboxes.parent).toEqual(retainedPublication)
    f.renderer.emit("frame")
    view.click(0)
    expect(view.text()).toContain("Authorization claimed")
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
    expect(f.calls.synthetic).toHaveLength(1)
    cleanup()
    view.dispose()
  },
)

snapshotTest(
  "pending invalid frames clear the entire proof and recover only on a valid completed frame",
  async (observer) => {
    for (const invalid of [
      "small-width",
      "small-height",
      "surface",
      "wrap",
      "worktree",
      "binding",
      "question",
      "authorize",
      "cancel",
      "viewport",
    ] as const) {
      const root = snapshotFixture(observer)
      const f = fake(root)
      const cleanup = await activate(f)
      const view = mount(f)
      const copy = view.mounted.filter((node) => node.type === "text" && node.wrapMode === "char")
      // Keep viewport identity unchanged for detailed-check failures: an early
      // viewport snapshot must not turn a partially validated frame into proof.
      if (invalid === "small-width") {
        f.renderer.terminalWidth = 79
        f.renderer.emit("resize")
      }
      if (invalid === "small-height") {
        f.renderer.terminalHeight = 1
        f.renderer.emit("resize")
      }
      if (invalid === "surface") view.mounted[0].height = 2
      if (invalid === "wrap") copy[0].height = 2
      if (invalid === "worktree") copy[0].width = 1
      if (invalid === "binding") copy[1].width = 1
      if (invalid === "question") copy[2].width = 1
      if (invalid === "authorize") view.buttons[0].width = 3
      if (invalid === "cancel") view.buttons[1].width = 3
      if (invalid === "viewport") view.buttons[1].screenY = 60
      f.renderer.emit("frame")
      view.click(0)
      view.click(1)
      expectNoImplementation(f)
      expect(f.calls.toasts).toEqual([])
      // Repair all geometry without a completed frame. This is still inert.
      f.renderer.terminalWidth = 120
      f.renderer.terminalHeight = 60
      if (invalid.startsWith("small-")) f.renderer.emit("resize")
      view.mounted[0].height = 4
      for (const node of copy) {
        node.height = 1
        node.width = 120
      }
      for (const node of view.buttons) {
        node.width = 13
        node.screenY = 0
      }
      view.click(0)
      view.click(1)
      expectNoImplementation(f)
      expect(f.calls.toasts).toEqual([])
      f.renderer.emit("frame")
      view.click(0)
      await settleUntil(() => f.calls.toasts.length > 0)
      expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
      expect(f.calls.synthetic).toHaveLength(1)
      cleanup()
      view.dispose()
    }
  },
)

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
  view.click(0)
  view.click(1)
  expect(f.calls.toasts).toEqual([])
  expectNoImplementation(f)
  const rows = Math.ceil([...`Worktree: ${JSON.stringify(root)}`].length / 80)
  expect(rows).toBeLessThanOrEqual(2)
  surface.height = rows + 3
  copy[0].height = rows
  f.renderer.emit("frame")
  view.click(0)
  await settleUntil(() => f.calls.toasts.length > 0)
  expect(f.calls.toasts.at(-1)).toContain("Implementation gate complete")
  cleanup()
  view.dispose()
})

snapshotTest(
  "the synchronous decision boundary rechecks detailed geometry against its completed-frame proof",
  async (observer) => {
    const root = snapshotFixture(observer)
    const f = fake(root)
    const cleanup = await activate(f)
    const view = mount(f)
    // Mutate a descendant after a valid frame without delivering another frame.
    view.buttons[1].screenX = 120
    view.click(0)
    expect(f.calls.toasts).toEqual([])
    expectNoImplementation(f)
    view.buttons[1].screenX = 0
    view.click(0)
    view.click(1)
    expect(f.calls.toasts).toEqual([])
    expectNoImplementation(f)
    f.renderer.emit("frame")
    view.click(1)
    expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
    expectNoImplementation(f)
    cleanup()
    view.dispose()
  },
)

snapshotTest(
  "sub-minimum pending geometry before mount can recover without replacing the publication",
  async (observer) => {
    const root = snapshotFixture(observer)
    const f = fake(root)
    f.renderer.terminalWidth = 40
    f.renderer.terminalHeight = 20
    const cleanup = await activate(f)
    const view = mount(f)
    view.click(0)
    view.click(1)
    expect(f.calls.toasts).toEqual([])
    expectNoImplementation(f)
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
    cleanup()
    view.dispose()
  },
)

snapshotTest(
  "publication and authorization reject drift at read, pagination, hydration, and admission boundaries",
  async (observer) => {
    for (const boundary of ["get", "active", "inbox", "messages", "pending-sync", "hydrate"] as const) {
      const root = snapshotFixture(observer)
      let mutated = false
      const f = fake(root, {
        onRead: (kind) => {
          if (!mutated && kind === boundary) {
            mutated = true
            observer.configure(root, HEAD, ["old.txt"])
          }
        },
      })
      await expect(
        publication(f.context, f.generation, observeGit(root), "parent", { directory: root }),
      ).rejects.toThrow()
      expectNoImplementation(f)
    }
  },
)

snapshotTest(
  "cleanup revokes an awaited publication and replacement activation cannot inherit authority",
  async (observer) => {
    const root = snapshotFixture(observer)
    let release!: () => void
    let waiting = false
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    const f = fake(root, {
      onWait: async () => {
        waiting = true
        await paused
      },
    })
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
  },
)

snapshotTest("wrong or unclaimed decision ownership cannot grant or create", async (observer) => {
  const root = snapshotFixture(observer)
  const f = fake(root)
  const published = await publication(f.context, f.generation, observeGit(root), "parent", { directory: root })
  await expect(authorizePublishedAttempt(f.context, published, f.guard)).rejects.toThrow("decision owner")
  f.claim(published)
  await expect(authorizePublishedAttempt(f.context, { ...published }, f.guard)).rejects.toThrow("decision owner")
  expectNoImplementation(f)
})

snapshotTest(
  "only a fresh successful root publishes, and duplicate completions never publish again",
  async (observer) => {
    for (const outcome of ["succeeded", "failed", "interrupted"] as const) {
      const root = snapshotFixture(observer)
      const f = fake(root)
      const cleanup = await plugin.setup(f.context)
      const completed = { type: "session.execution.succeeded", id: "evt_completed", data: { sessionID: "parent" } }
      f.emit(completed)
      expect(f.calls.synthetic).toEqual([])
      f.sessions.parent.time.created = Date.now() + 10
      f.emit(f.created())
      f.emit({
        ...completed,
        type: `session.execution.${outcome}`,
        id: outcome === "succeeded" ? completed.id : "evt_failed",
      })
      f.emit(completed)
      f.emit(completed)
      await settleUntil(() => f.slots.length > 0 || f.calls.toasts.length > 0)
      expect(f.calls.synthetic).toHaveLength(outcome === "succeeded" ? 1 : 0)
      expectNoImplementation(f)
      if (typeof cleanup === "function") cleanup()
    }
  },
)

snapshotTest(
  "pointer controls wait for completed layout and reject clipped decision copy or hidden surfaces",
  async (observer) => {
    for (const layout of [
      "partial",
      "button-clipped",
      "hidden",
      "path-clipped",
      "binding-clipped",
      "question-clipped",
    ] as const) {
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
      }
      cleanup()
      view.dispose()
    }
  },
)

snapshotTest(
  "Planner inspection before completion or during publication retains one Plan without a decision",
  async (observer) => {
    for (const boundary of ["before-completion", "wait", "hydrate"] as const) {
      const root = snapshotFixture(observer)
      const f = fake(root, { events: true })
      let release!: () => void
      let waiting = false
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      if (boundary === "wait")
        f.options.onWait = async () => {
          waiting = true
          await paused
        }
      if (boundary === "hydrate") {
        const sync = f.context.data.session.message.sync
        ;(f.context.data.session.message as any).sync = async (id: string) => {
          await sync(id)
          waiting = true
          await paused
        }
      }
      const attempt = await startInspectedPublication(
        f,
        boundary === "before-completion" ? (select) => select("planner-child") : undefined,
      )
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
        expect(f.calls.synthetic[0]).toEqual({
          id: published.publication.id,
          sessionID: "parent",
          text: proposal,
          description: renderPlan(published.candidate),
          metadata: published.publication.payload.metadata,
          delivery: "steer",
          resume: false,
        })
        f.emit(attempt.completed)
        f.emit(attempt.completed)
        f.renderer.emit("frame")
        f.renderer.emit("resize")
        attempt.select("planner-child")
        attempt.select("unrelated-root")
        expect(f.slots).toEqual([])
        expect(f.calls.toasts).toEqual([])
        expectNoImplementation(f)
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
        view.dispose()
      } finally {
        release()
        attempt.cleanup()
      }
    }
  },
)

snapshotTest(
  "root preparation tolerates navigation but cannot survive cleanup, failure, or ownership closure",
  async (observer) => {
    for (const loss of [
      "navigation",
      "cleanup",
      "replacement-activation",
      "native-event",
      "renderer",
      "completed-verification-cleanup",
    ] as const) {
      const root = snapshotFixture(observer)
      const f = fake(root)
      const attempt = await startInspectedPublication(f, (select) => select("planner-child"))
      let release!: () => void
      const paused = new Promise<void>((resolve) => {
        release = resolve
      })
      let waiting = false
      let replacement: Awaited<ReturnType<typeof plugin.setup>> = undefined
      let restore: (() => void) | undefined
      try {
        const published = await attempt.finish()
        if (loss === "completed-verification-cleanup") {
          const realAttempt = { ...attemptModule }
          const modulePath = path.resolve(import.meta.dir, "../src/attempt.ts")
          mock.module(modulePath, () => ({
            ...realAttempt,
            verifyPublishedAttempt: async (...args: Parameters<typeof verifyPublishedAttempt>) => {
              await realAttempt.verifyPublishedAttempt(...args)
              waiting = true
              await paused
            },
          }))
          restore = () => mock.module(modulePath, () => realAttempt)
        } else {
          const get = f.context.client.session.get
          ;(f.context.client.session as any).get = async (input: any) => {
            const result = await get(input)
            waiting = true
            await paused
            return result
          }
        }
        attempt.select("parent")
        await settleUntil(() => waiting)
        expect(f.slots).toEqual([])
        if (loss === "navigation") attempt.select("planner-child")
        const revoked =
          loss === "cleanup" || loss === "replacement-activation" || loss === "completed-verification-cleanup"
        if (revoked) attempt.cleanup()
        if (loss === "replacement-activation") replacement = await plugin.setup(f.context)
        if (loss === "native-event")
          f.emit({ type: "session.deleted", id: "evt_deleted", data: { sessionID: "parent" } })
        if (loss === "renderer") f.renderer.emit("render:error")
        expect(published.activation.generation.revoked).toBe(revoked)
        release()
        for (let i = 0; i < 300; i++) await Promise.resolve()
        attempt.select("planner-child")
        attempt.select("parent")
        f.emit(attempt.completed)
        f.renderer.emit("resize")
        f.renderer.emit("frame")
        if (revoked) expect(f.slots).toEqual([])
        else if (loss === "navigation") {
          expect(f.calls.toasts).toEqual([])
          const view = mount(f)
          expect(view.buttons).toHaveLength(2)
          view.click(1)
          expect(f.calls.toasts).toEqual(["Cancelled — no implementation admitted"])
          view.dispose()
        } else {
          expect(f.calls.toasts).toHaveLength(1)
          expect(f.calls.toasts[0]).toContain("STOP — Implementation was not admitted")
          const status = mount(f)
          expect(status.buttons).toEqual([])
          expect(status.text()).toBe("")
          status.dispose()
        }
        expect(f.calls.synthetic).toHaveLength(1)
        expectNoImplementation(f)
      } finally {
        release()
        restore?.()
        attempt.cleanup()
        if (typeof replacement === "function") replacement()
      }
    }
  },
)

snapshotTest(
  "genuine retained evidence, Git, location, session, and generation invalidation cannot rearm on root return",
  async (observer) => {
    for (const mutation of [
      "head",
      "dirty",
      "publication",
      "server-publication",
      "inbox",
      "projection",
      "reactive-projection",
      "candidate-rebind",
      "planner",
      "permissions",
      "missing-root",
      "delete-planner",
      "directory",
      "workspaceID",
      "cleanup",
    ] as const) {
      const root = snapshotFixture(observer)
      const f = fake(root)
      const [location, setLocation] = createStore({ directory: root, workspaceID: undefined as string | undefined })
      Object.defineProperty(f.context, "location", { get: () => location })
      const attempt = await startInspectedPublication(f, (select) => select("planner-child"))
      let view: ReturnType<typeof mount> | undefined
      try {
        const published = await attempt.finish()
        const original = structuredClone({
          sessions: f.sessions,
          histories: f.histories,
          inbox: f.inboxes.parent,
          cache: f.cache.parent,
        })
        const inboxList = f.context.client.session.inbox.list
        const messageList = f.context.data.session.message.list
        if (mutation === "head") observer.configure(root, "2".repeat(40))
        if (mutation === "dirty") observer.configure(root, HEAD, ["old.txt"])
        if (mutation === "publication") f.inboxes.parent[0].payload.text += "changed"
        if (mutation === "server-publication") {
          const inbox = f.context.client.session.inbox.list
          ;(f.context.client.session.inbox as any).list = async (input: any) => {
            const result = await inbox(input)
            if (input.sessionID === "parent") (result[0]!.payload as any).text += "changed"
            return result
          }
        }
        if (mutation === "inbox") f.inboxes.parent.push(user("extra", "extra"))
        if (mutation === "projection") f.cache.parent.at(-1).description += " changed"
        if (mutation === "reactive-projection") {
          const [projection, setProjection] = createStore<{ messages: any[] }>({
            messages: structuredClone(f.cache.parent),
          })
          ;(f.context.data.session.message as any).list = (id: string) =>
            id === "parent" ? projection.messages : f.cache[id]
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
        if (mutation === "permissions")
          f.sessions["planner-child"].permissions = [{ action: "edit", resource: "*", effect: "allow" }]
        if (mutation === "missing-root") delete f.sessions.parent
        if (mutation === "delete-planner")
          f.emit({ type: "session.deleted", id: "evt_deleted", data: { sessionID: "planner-child" } })
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
        f.inboxes.parent = original.inbox
        f.cache.parent = original.cache
        ;(f.context.client.session.inbox as any).list = inboxList
        ;(f.context.data.session.message as any).list = messageList
        attempt.select("planner-child")
        attempt.select("parent")
        f.emit(attempt.completed)
        f.renderer.emit("resize")
        f.renderer.emit("frame")
        view?.click(0)
        view?.click(1)
        for (let i = 0; i < 100; i++) await Promise.resolve()
        expect(published.candidate.proposal.intent).toBe("Change old file")
        expect(f.calls.synthetic).toHaveLength(1)
        expectNoImplementation(f)
        if (mutation === "cleanup") {
          expect(f.slots).toEqual([])
          expect(published.activation.generation.revoked).toBe(true)
        } else expect(f.calls.toasts).toHaveLength(1)
      } finally {
        attempt.cleanup()
        view?.dispose()
      }
    }
  },
)

// Native admission uses host doubles and the same test-scoped Git observer.
// No real repositories, native child imports, or production injection seams.
import { Effect, Schema } from "effect"
import { Tool as NativeTool } from "@opencode/schema/tool"
import { nativeAdmission, nativeArguments, controlText } from "../src/native.ts"
import { authorizeRpc } from "../src/authorize-rpc.ts"
import serverPlugin from "../.opencode/plugins/opencode-agents/server.ts"

const nativeInput = Schema.Struct({
  agent: Schema.String,
  description: Schema.String,
  prompt: Schema.String,
  background: Schema.optionalKey(Schema.Boolean),
  model: Schema.optionalKey(Schema.String),
  sessionID: Schema.optionalKey(Schema.String),
})

// State transforms replay in registration order. In particular, ConfigAgentPlugin
// runs after external plugins and appends rules to already registered agents.
function sponsorHost(browser = false) {
  const transforms: Array<(editor: any) => void> = [],
    permissionHooks: Array<(event: any) => Effect.Effect<void>> = []
  const roles = () => {
    const agents = new Map<string, any>()
    const editor = {
      list: () => [...agents.values()],
      update: (id: string, update: (agent: any) => void) => {
        if (!agents.has(id)) agents.set(id, { id, mode: "primary", hidden: false, permissions: [] })
        update(agents.get(id))
      },
    }
    for (const transform of transforms) transform(editor)
    // Built-in browser policy is registered after ConfigAgentPlugin.
    if (browser)
      for (const agent of editor.list())
        editor.update(agent.id, (current) =>
          current.permissions.push({ action: "browser", resource: "*", effect: "deny" }),
        )
    return agents
  }
  const appendConfig = (global: any[], configured: Record<string, any[]> = {}) =>
    transforms.push((editor) => {
      for (const current of editor.list())
        editor.update(current.id, (agent: any) => agent.permissions.push(...structuredClone(global)))
      for (const [id, rules] of Object.entries(configured))
        editor.update(id, (agent: any) => agent.permissions.push(...structuredClone(rules)))
    })
  const evaluate = (agent: string, action: string, resources: string[]) =>
    Effect.gen(function* () {
      // Configured denies return before permission.evaluate in the native host.
      const rules = roles().get(agent).permissions
      const matches = (value: string, pattern: string) =>
        new RegExp(
          `^${pattern
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*")
            .replace(/\?/g, ".")}$`,
        ).test(value)
      const effects = resources.map(
        (resource) =>
          rules.findLast((rule: any) => matches(action, rule.action) && matches(resource, rule.resource))?.effect ??
          "ask",
      )
      if (effects.includes("deny")) return "deny"
      const event = {
        sessionID: "ses_parent",
        agent,
        action,
        resources,
        effect: effects.includes("ask") ? "ask" : "allow",
      }
      for (const hook of permissionHooks) yield* hook(event)
      return event.effect
    })
  return { transforms, permissionHooks, roles, appendConfig, evaluate }
}

function serverFake(root: string, _observer: SnapshotObserver, workspaceID?: string) {
  const location = { directory: root, ...(workspaceID ? { workspaceID } : {}) }
  const candidate = makeCandidate(parseProposal(proposal, root), root, HEAD)
  const claim = {
    purpose: "implement",
    candidate,
    rootSessionID: "ses_parent",
    location,
    publicationID: "published-plan",
  }
  const histories: Record<string, any[]> = { ses_parent: [] }
  const sessions: Record<string, any> = {
    ses_parent: {
      id: "ses_parent",
      agent: "orchestrator",
      location,
      permissions: [],
      outcome: "succeeded",
      time: { idle: 1 },
    },
  }
  const wakes: any[] = [],
    originals: any[] = [],
    nativeEntries: any[] = [],
    progress: any[] = [],
    reads: string[] = []
  const host = sponsorHost(true)
  const f = {
    claim,
    candidate,
    location,
    histories,
    sessions,
    wakes,
    receipts: [] as any[],
    originals,
    nativeEntries,
    progress,
    reads,
    host,
    onRead: undefined as ((kind: string, id: string) => void | Promise<void>) | undefined,
    run: undefined as (() => Promise<void>) | undefined,
    onNative: undefined as (() => void | Promise<void>) | undefined,
    onWake: undefined as ((wake: any) => void | Promise<void>) | undefined,
    resultMutation: undefined as ((result: any) => void) | undefined,
    nativeResultMutation: undefined as ((result: any) => void) | undefined,
    nativeProgress: [{ sessionID: "ses_child", status: "running" }] as any[],
    nativeError: false,
    wakeError: false,
    waitError: false,
    receiptError: false,
    settled: false,
    onReceipt: undefined as ((input: any) => void | Promise<void>) | undefined,
    read: (kind: string, id: string, value: () => any) =>
      Effect.promise(async () => {
        reads.push(`${kind}:${id}`)
        await f.onRead?.(kind, id)
        return structuredClone(value())
      }),
  }
  const context = {
    location,
    session: {
      get: ({ sessionID }: any) => f.read("get", sessionID, () => sessions[sessionID]),
      context: ({ sessionID }: any) => f.read("context", sessionID, () => histories[sessionID]),
      synthetic: (input: any) =>
        Effect.promise(async () => {
          if (input.resume === false) {
            f.receipts.push(structuredClone(input))
            await f.onReceipt?.(input)
            if (f.receiptError) throw new Error("receipt transport unavailable")
            return { sessionID: input.sessionID, type: "synthetic", delivery: input.delivery, payload: input }
          }
          wakes.push(structuredClone(input))
          const wake = {
            id: input.id,
            sessionID: input.sessionID,
            type: "synthetic",
            delivery: input.delivery,
            payload: { text: input.text },
          }
          histories.ses_parent.push({ id: input.id, type: "synthetic", text: input.text })
          await f.onWake?.(wake)
          if (f.wakeError) throw new Error("ambiguous wake")
          return wake
        }),
      wait: () =>
        Effect.promise(async () => {
          await f.run?.()
          if (f.waitError) throw new Error("lost root settlement")
          f.settled = true
        }),
    },
  } as any
  const admission = nativeAdmission(context)
  host.transforms.push((editor) =>
    editor.update("orchestrator", (agent: any) => {
      agent.permissions = [
        { action: "*", resource: "*", effect: "deny" },
        { action: "subagent", resource: "planner", effect: "allow" },
      ]
    }),
  )
  host.transforms.push((editor) =>
    editor.update(admission.actor, (agent: any) => {
      agent.mode = "subagent"
      agent.hidden = true
      agent.permissions = [
        { action: "*", resource: "*", effect: "deny" },
        { action: "subagent", resource: "authorized_implementer", effect: "allow" },
      ]
    }),
  )
  host.permissionHooks.push(admission.sponsorPermission)
  host.appendConfig([])
  const original: NativeTool.Info["execute"] = (input: any, invocation) =>
    Effect.gen(function* () {
      nativeEntries.push(invocation)
      const effect = yield* host.evaluate(invocation.agent, "subagent", [input.agent])
      if (effect !== "allow")
        return yield* Effect.fail(new NativeTool.Error({ message: `Native permission ${effect}` }))
      originals.push({ input: structuredClone(input), context: invocation })
      const output = input.agent === "planner" ? proposal : "Done"
      const childID = input.agent === "planner" ? "ses_planner" : "ses_child"
      sessions[childID] = {
        id: childID,
        parentID: invocation.sessionID,
        agent: input.agent,
        location: structuredClone(location),
        permissions: [],
        outcome: "succeeded",
        time: { idle: 2 },
      }
      histories[childID] = [
        user("native-input", prefix + input.prompt),
        answer(`${childID}-final`, input.agent, output),
        idle(`${childID}-idle`),
      ]
      for (const update of f.nativeProgress)
        yield* invocation.progress(input.agent === "planner" ? { ...update, sessionID: childID } : update)
      yield* Effect.promise(async () => {
        await f.onNative?.()
      })
      if (f.nativeError) throw new Error("native invocation outcome unknown")
      const result = {
        output: { sessionID: childID, status: "completed", output },
        content: `<subagent sessionID="${childID}" state="completed">\n${output}\n</subagent>`,
        metadata: { sessionID: childID, status: "completed" },
      }
      f.nativeResultMutation?.(result)
      return result
    }).pipe(Effect.mapError((error) => new NativeTool.Error({ message: String(error) })))
  const wrapped = admission.execute(original)
  const decode = Schema.decodeUnknownPromise(nativeInput)
  const dispatch = async (
    raw: any = nativeArguments(candidate),
    opts: {
      id?: string
      messageID?: string
      tool?: string
      agent?: string
      decoded?: any
      beforeInput?: any
      codecInput?: any
    } = {},
  ) => {
    const id = opts.id ?? "native-call",
      messageID = opts.messageID ?? "native-message",
      tool = opts.tool ?? "subagent",
      agent = opts.agent ?? "orchestrator"
    const part: any = {
      type: "tool",
      id,
      name: tool,
      state: { status: "running", input: structuredClone(raw), metadata: {} },
    }
    const message = histories.ses_parent.find((item) => item.id === messageID)
    if (message) message.content.push(part)
    else histories.ses_parent.push({ id: messageID, type: "assistant", agent, model, content: [part] })
    const invocation: any = {
      sessionID: "ses_parent",
      agent,
      messageID,
      id,
      progress: (update: any) => Effect.sync(() => progress.push(structuredClone(update))),
    }
    try {
      await Effect.runPromise(
        admission.before({ ...invocation, tool, input: opts.beforeInput ?? structuredClone(raw) }),
      )
      const decoded = await decode(opts.codecInput ?? opts.beforeInput ?? raw)
      const result = await Effect.runPromise(wrapped(opts.decoded ?? decoded, invocation))
      f.resultMutation?.(result)
      // ToolOutput.truncate runs after native execution/after hooks and adds
      // this field even for short, unchanged output.
      const metadata =
        result.metadata?.truncated === undefined ? { ...result.metadata, truncated: false } : result.metadata
      part.state = { status: "completed", input: raw, content: [{ type: "text", text: result.content }], metadata }
      return result
    } catch (error) {
      part.state = { status: "error", input: raw, error: String(error) }
      throw error
    }
  }
  const authorize = (input: unknown = claim) => Effect.runPromise(admission.authorize(input))
  return { ...f, state: f, context, admission, original, wrapped, dispatch, authorize }
}

snapshotTest(
  "initial Planner replaces proposed text with exact pasted input, preserves native execution and binds its receipt",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    const pasted = "Change old.txt\n  Preserve internal spaces  \nFinish here  \n\n"
    f.histories.ses_parent.push(user("root-user", pasted))
    const args = {
      agent: "planner" as const,
      description: "Plan",
      prompt: plannerInput("Change old.txt\n  Preserve internal spaces  \nFinish here"),
    }
    f.state.nativeProgress = [{ sessionID: "ses_child", status: "running", nativeProgress: "working" }]
    f.state.nativeResultMutation = (result) => {
      result.metadata.nativeDetail = { retained: true }
    }
    const expected = plannerReceipt("root-user", args.description, pasted)
    const result = await f.dispatch(args)
    expect(result).toMatchObject({ output: { sessionID: "ses_planner", status: "completed", output: proposal } })
    expect(result.metadata).toEqual({
      sessionID: "ses_planner",
      status: "completed",
      nativeDetail: { retained: true },
      [plannerReceiptKey]: expected,
    })
    expect(f.originals).toHaveLength(1)
    expect(f.originals[0].input).toEqual(expected.input)
    expect(f.originals[0].context).toMatchObject({
      agent: "orchestrator",
      sessionID: "ses_parent",
      messageID: "native-message",
      id: "native-call",
    })
    expect(f.wakes).toHaveLength(0)
    expect(f.reads).toEqual(["get:ses_parent", "context:ses_parent", "get:ses_parent"])
    expect(f.progress).toEqual([{ sessionID: "ses_planner", status: "running", nativeProgress: "working" }])
    expect(f.progress[0][plannerReceiptKey]).toBeUndefined()
    expect(f.histories.ses_parent[1].content[0].state.input).toEqual(args)
    expect(f.histories.ses_planner[0].text).toBe(prefix + plannerInput(pasted))
    expect(f.admission.cap.rootSessionID).toBeUndefined()
    expect(f.sessions.ses_parent.permissions).toEqual([])

    // Feed the completed native evidence to the existing independent TUI binding double.
    const bound = fake(root)
    bound.histories.parent = [
      ...structuredClone(f.histories.ses_parent),
      answer("root-final", "orchestrator", "Plan prepared; awaiting human authorization."),
      idle("root-idle"),
    ]
    bound.histories.parent[1].content[0].state.metadata.sessionID = "planner-child"
    bound.histories["planner-child"] = structuredClone(f.histories.ses_planner)
    const published = await publication(bound.context, bound.generation, observeGit(root), "parent", {
      directory: root,
    })
    expect(published.bound.request).toBe(pasted)
    expect(published.bound.planner.proposed).toEqual(args)
    expect(published.bound.planner.effective).toEqual(expected)
    bound.claim(published)
    await verifyPublishedAttempt(bound.context, published, bound.guard)
    expect(bound.calls.claims).toEqual([])
  },
)

snapshotTest(
  "initial Planner rejects stripped optional keys, malformed proposals and competing persisted contenders",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "extra",
      "background",
      "sessionID",
      "model",
      "empty-prompt",
      "empty-description",
      "decoded",
      "running",
      "streaming",
      "error",
      "completed",
      "call-id",
      "message-id",
      "tool-name",
      "tool-state",
    ]) {
      const f = serverFake(root, observer)
      f.histories.ses_parent.push(user("root-user", request))
      const args: any = { agent: "planner", description: "Plan", prompt: "Proposed prompt" }
      if (mutation === "extra") args.extra = "host strips this"
      if (mutation === "background") args.background = false
      if (mutation === "sessionID") args.sessionID = ""
      if (mutation === "model") args.model = ""
      if (mutation === "empty-prompt") args.prompt = ""
      if (mutation === "empty-description") args.description = ""
      if (["running", "streaming", "error", "completed"].includes(mutation)) {
        f.histories.ses_parent.push({
          ...answer("earlier", "orchestrator", ""),
          content: [
            {
              ...call("earlier-call", "planner", "Earlier prompt", "earlier-child", proposal),
              state: { status: mutation },
            },
          ],
        })
      }
      f.state.onRead = (kind) => {
        if (kind !== "context") return
        const message = f.histories.ses_parent.at(-1)
        const part = message.content[0]
        if (mutation === "call-id") part.id = "aliased-call"
        if (mutation === "message-id") message.id = "aliased-message"
        if (mutation === "tool-name") part.name = "execute"
        if (mutation === "tool-state") part.state.status = "completed"
      }
      await expect(
        f.dispatch(args, {
          // Host hooks/decoding may remove options; original persisted keys still govern shape.
          codecInput: { agent: "planner", description: args.description, prompt: args.prompt },
          ...(mutation === "decoded" ? { decoded: { ...args, prompt: "different decoded proposal" } } : {}),
        }),
      ).rejects.toThrow()
      expect(f.nativeEntries).toEqual([])
      expect(f.wakes).toEqual([])
      expect(f.admission.cap.rootSessionID).toBeUndefined()
    }
  },
)

snapshotTest(
  "initial Planner rejects later input/control, identity drift and revocation across awaited reads",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "missing-request",
      "empty-request",
      "files",
      "agents",
      "skills",
      "later-user",
      "idle",
      "synthetic",
      "compaction",
      "duplicate-message",
      "assistant-role",
      "assistant-error",
      "root-id",
      "root-role",
      "created",
      "fork",
      "revert",
      "archived",
      "location",
      "permissions",
      "server-location",
      "revoked",
      "cap",
    ]) {
      const f = serverFake(root, observer)
      f.sessions.ses_parent.time.created = 1
      f.histories.ses_parent.push(user("root-user", request))
      let gets = 0
      f.state.onRead = (kind) => {
        if (kind === "get") {
          gets++
          if (gets !== 2) return
          const session = f.sessions.ses_parent
          if (mutation === "root-id") session.id = "different-root"
          if (mutation === "root-role") session.agent = "planner"
          if (mutation === "created") session.time.created = 2
          if (mutation === "fork") session.fork = {}
          if (mutation === "revert") session.revert = {}
          if (mutation === "archived") session.time.archived = 1
          if (mutation === "location") session.location = { directory: root + "/other" }
          if (mutation === "permissions") session.permissions = [{ action: "*", resource: "*", effect: "allow" }]
          if (mutation === "server-location") f.context.location = { directory: root + "/other" }
          if (mutation === "revoked") f.admission.teardown()
          if (mutation === "cap") f.admission.cap.accept(f.claim, controlText)
          return
        }
        const history = f.histories.ses_parent
        const first = history[0]
        const message = history.at(-1)
        if (mutation === "missing-request") history.shift()
        if (mutation === "empty-request") first.text = ""
        if (["files", "agents", "skills"].includes(mutation)) first[mutation] = [{}]
        if (mutation === "later-user") history.push(user("later", "different task"))
        if (["idle", "synthetic", "compaction"].includes(mutation)) history.push({ id: "intervening", type: mutation })
        if (mutation === "duplicate-message") history.push({ ...answer(first.id, "orchestrator", "") })
        if (mutation === "assistant-role") message.agent = "planner"
        if (mutation === "assistant-error") message.error = { type: "failed" }
      }
      await expect(f.dispatch({ agent: "planner", description: "Plan", prompt: "Proposed" })).rejects.toThrow()
      expect(f.nativeEntries).toEqual([])
      expect(f.progress).toEqual([])
    }
  },
)

snapshotTest(
  "Planner rewrite leaves nested delegation untouched and does not reinterpret later root planning",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const agent of ["planner", "orchestrator"]) {
      const f = serverFake(root, observer)
      const delegated = {
        agent: agent === "planner" ? "explorer" : "planner",
        description: "Nested",
        prompt: "Child request  \n",
      }
      f.host.appendConfig([], { [agent]: [{ action: "subagent", resource: delegated.agent, effect: "allow" }] })
      f.sessions.ses_nested = { ...f.sessions.ses_parent, id: "ses_nested", agent, parentID: "ses_parent" }
      const invocation: any = {
        agent,
        sessionID: "ses_nested",
        messageID: "nested-message",
        id: "nested-call",
        progress: () => Effect.void,
      }
      const result = await Effect.runPromise(f.wrapped(delegated, invocation))
      expect(f.originals[0].input).toEqual(delegated)
      expect(f.originals[0].context).toBe(invocation)
      expect(result.metadata?.[plannerReceiptKey]).toBeUndefined()
      expect(f.reads).toEqual(agent === "planner" ? [] : ["get:ses_nested"])
    }
    const f = serverFake(root, observer)
    f.histories.ses_parent.push(user("root-user", request))
    const args = { agent: "planner", description: "Plan", prompt: "Proposed" }
    await f.dispatch(args)
    f.histories.ses_parent.push(idle("initial-idle"), user("revision", "Revise the plan"))
    await expect(f.dispatch(args, { messageID: "later-message", id: "later-call" })).rejects.toThrow()
    expect(f.originals).toHaveLength(1)
    expect(f.histories.ses_parent.at(-1).content[0].state.metadata).toBeUndefined()
  },
)

snapshotTest(
  "Planner issues no effective-input receipt for failed or incomplete native execution",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of ["error", "running", "child", "metadata", "permission"]) {
      const f = serverFake(root, observer)
      f.histories.ses_parent.push(user("root-user", request))
      if (mutation === "error") f.state.nativeError = true
      if (mutation === "permission")
        f.host.appendConfig([], { orchestrator: [{ action: "subagent", resource: "planner", effect: "deny" }] })
      f.state.nativeResultMutation = (result) => {
        if (mutation === "running") result.output.status = result.metadata.status = "running"
        if (mutation === "child") result.output.sessionID = result.metadata.sessionID = "ses_parent"
        if (mutation === "metadata") result.metadata.sessionID = "wrong-child"
      }
      await expect(f.dispatch({ agent: "planner", description: "Plan", prompt: "Proposed" })).rejects.toThrow()
      expect(f.histories.ses_parent.at(-1).content[0].state.metadata).toBeUndefined()
      expect(f.progress.every((update) => update[plannerReceiptKey] === undefined)).toBe(true)
      if (mutation === "permission") expect(f.originals).toEqual([])
    }
  },
)

snapshotTest(
  "native Authorize transfers one frozen claim, wakes once and forwards native identities/progress/result",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer, "local-workspace")
    f.histories.ses_parent.push({
      id: "planning-message",
      type: "assistant",
      agent: "orchestrator",
      model,
      content: [call("planner-call", "planner", plannerInput(request), "planner-child", proposal)],
    })
    expect(await Effect.runPromise(f.host.evaluate("orchestrator", "subagent", ["authorized_implementer"]))).toBe(
      "deny",
    )
    f.state.run = async () => {
      await f.dispatch()
      observer.configure(root, HEAD, ["old.txt"])
    }
    const outcome = await f.authorize()
    expect(outcome).toContain("Implementation gate complete")
    expect(outcome).toContain('Resulting paths (1): "old.txt"')
    expect(f.wakes).toHaveLength(1)
    expect(f.wakes[0]).toEqual({
      id: f.admission.cap.control.id,
      sessionID: "ses_parent",
      text: controlText(f.candidate),
      delivery: "steer",
      resume: true,
    })
    expect(f.originals).toHaveLength(1)
    expect(f.originals[0].input).toEqual(nativeArguments(f.candidate))
    expect(f.originals[0].context).toMatchObject({
      agent: f.admission.actor,
      sessionID: "ses_parent",
      messageID: "native-message",
      id: "native-call",
    })
    expect(f.progress).toEqual([{ sessionID: "ses_child", status: "running" }])
    expect(f.admission.cap.result).toEqual({ childID: "ses_child", status: "completed" })
    expect(f.histories.ses_parent.at(-1).content[0].state.metadata).toMatchObject({
      sessionID: "ses_child",
      status: "completed",
    })
    expect(f.sessions.ses_parent.permissions).toEqual([])
    expect(await Effect.runPromise(f.host.evaluate("orchestrator", "subagent", ["authorized_implementer"]))).toBe(
      "deny",
    )
    expect(f.admission.cap.phase).toBe("closed")
    expect(await f.authorize()).toContain("One governed implementation attempt")
    await expect(f.dispatch(undefined, { id: "second-call" })).rejects.toThrow()
    expect(f.originals).toHaveLength(1)
    expect(f.wakes).toHaveLength(1)
  },
)

snapshotTest(
  "later configured allows cannot broaden the sponsor beyond exact Implementer delegation",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const rules of [
      [],
      [{ action: "*", resource: "*", effect: "allow" }],
      [
        { action: "subagent", resource: "*", effect: "allow" },
        { action: "edit", resource: "*", effect: "allow" },
      ],
    ]) {
      const f = serverFake(root, observer)
      f.host.appendConfig(rules)
      const consume = spyOn(f.admission.cap, "consume")
      try {
        expect(
          await Effect.runPromise(f.host.evaluate(f.admission.actor, "subagent", ["authorized_implementer"])),
        ).toBe("allow")
        for (const [action, resources] of [
          ["subagent", ["planner"]],
          ["subagent", ["authorized_implementer", "planner"]],
          ["subagent", ["authorized_implementer/other"]],
          ["subagent", []],
          ["edit", ["old.txt"]],
          ["bash", ["echo hi"]],
          ["read", ["old.txt"]],
          ["browser", ["*"]],
        ] as Array<[string, string[]]>) {
          expect(await Effect.runPromise(f.host.evaluate(f.admission.actor, action, resources))).toBe("deny")
        }
        // The guard is deny-only, including for the one permitted target.
        for (const effect of ["deny", "ask"] as const) {
          const event = { agent: f.admission.actor, action: "subagent", resources: ["authorized_implementer"], effect }
          await Effect.runPromise(f.admission.sponsorPermission(event as any))
          expect(event.effect).toBe("deny")
        }
        const rootEvent = { agent: "orchestrator", action: "edit", resources: ["old.txt"], effect: "allow" }
        await Effect.runPromise(f.admission.sponsorPermission(rootEvent as any))
        expect(rootEvent.effect).toBe("allow")
        f.state.run = async () => {
          await f.dispatch()
        }
        expect(await f.authorize()).toContain("Implementation gate complete")
        expect(consume).toHaveBeenCalledTimes(1)
        expect(f.nativeEntries).toHaveLength(1)
        expect(f.originals).toHaveLength(1)
        expect(f.sessions.ses_parent.permissions).toEqual([])
        expect(await f.authorize()).toContain("One governed")
      } finally {
        consume.mockRestore()
      }
    }
  },
)

snapshotTest(
  "pinned native effective target deny/ask blocks child creation after one consumption",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const effect of ["deny", "ask"] as const) {
      const f = serverFake(root, observer)
      f.host.appendConfig([{ action: "subagent", resource: "authorized_*", effect }])
      const consume = spyOn(f.admission.cap, "consume")
      try {
        f.state.run = async () => {
          await expect(f.dispatch()).rejects.toThrow("Native permission deny")
          await expect(f.dispatch(undefined, { id: "replacement" })).rejects.toThrow()
        }
        expect(await f.authorize()).toContain("unverified")
        expect(consume).toHaveBeenCalledTimes(1)
        expect(f.nativeEntries).toHaveLength(1)
        expect(f.originals).toHaveLength(0)
        expect(f.sessions.ses_child).toBeUndefined()
        expect(f.sessions.ses_parent.permissions).toEqual([])
        expect(await f.authorize()).toContain("One governed")
        expect(f.wakes).toHaveLength(1)
      } finally {
        consume.mockRestore()
      }
    }
  },
)

snapshotTest(
  "effective last-match target allow accepts shadowed/unrelated denies and cosmetic sponsor changes",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const rules of [
      [{ action: "edit", resource: "*", effect: "deny" }],
      [
        { action: "subagent", resource: "authorized_implementer", effect: "deny" },
        { action: "subagent", resource: "authorized_implementer", effect: "allow" },
      ],
    ]) {
      const f = serverFake(root, observer)
      f.host.appendConfig(rules)
      f.host.transforms.push((editor) =>
        editor.update(f.admission.actor, (agent: any) => {
          agent.hidden = false
          agent.mode = "primary"
        }),
      )
      f.state.run = async () => {
        await f.dispatch()
      }
      expect(await f.authorize()).toContain("Implementation gate complete")
      expect(f.originals).toHaveLength(1)
      expect(f.sessions.ses_parent.permissions).toEqual([])
    }
  },
)

snapshotTest(
  "malformed first contenders burn admission; aliases, extras, reuse, model and background never execute",
  async (observer) => {
    const root = snapshotFixture(observer)
    const cases: Array<{ raw?: (args: any) => any; opts?: any }> = [
      ...["description", "prompt", "agent"].map((key) => ({ raw: (args: any) => ({ ...args, [key]: "different" }) })),
      ...[
        { extra: undefined },
        { model: "" },
        { model: "other" },
        { sessionID: "" },
        { sessionID: "ses_child" },
        { background: false },
        { background: true },
        { extra: "" },
      ].map((extra) => ({ raw: (args: any) => ({ ...args, ...extra }) })),
      { raw: () => null },
      { raw: () => [] },
      { opts: { tool: "native.subagent" } },
      { opts: { tool: "read" } },
      { opts: { agent: "build" } },
    ]
    for (const item of cases) {
      const f = serverFake(root, observer)
      f.state.run = async () => {
        await expect(
          f.dispatch(item.raw ? item.raw(nativeArguments(f.candidate)) : undefined, item.opts),
        ).rejects.toThrow()
        await expect(f.dispatch(undefined, { id: "replacement", messageID: "replacement" })).rejects.toThrow()
      }
      expect(await f.authorize()).toContain("unverified")
      expect(f.originals).toHaveLength(0)
      expect(f.wakes).toHaveLength(1)
      expect(await f.authorize()).toContain("One governed")
    }
  },
)

snapshotTest(
  "parser-failed first contenders that skip execute.before burn admission before any later valid call",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const messageID of ["native-message", "earlier-message"]) {
      for (const name of ["subagent", "read"]) {
        const f = serverFake(root, observer)
        f.state.run = async () => {
          // failMalformedToolInput publishes this part directly, without a tool
          // before hook or executor. Cover same-message and subsequent-turn retry.
          f.histories.ses_parent.push({
            id: messageID,
            type: "assistant",
            agent: "orchestrator",
            model,
            content: [
              text("Preparing the call"),
              {
                type: "tool",
                id: "malformed-first",
                name,
                executed: false,
                state: {
                  status: "error",
                  input: {},
                  error: { type: "tool.input-json", message: "Malformed JSON; retry with valid JSON." },
                },
              },
            ],
          })
          expect(f.admission.cap.phase).toBe("available")
          await expect(f.dispatch()).rejects.toThrow("Earlier tool contender")
          expect(f.admission.cap.phase).toBe("closed")
          await expect(f.dispatch(undefined, { id: "retry", messageID: "retry-message" })).rejects.toThrow()
        }
        expect(await f.authorize()).toContain("unverified")
        expect(f.originals).toHaveLength(0)
        expect(f.wakes).toHaveLength(1)
        expect(await f.authorize()).toContain("One governed")
      }
    }
  },
)

snapshotTest(
  "published completion checks child/status and tolerates host metadata and truncation",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "missing",
      "true",
      "string",
      "null",
      "extra",
      "outputPath",
      "sessionID",
      "status",
    ] as const) {
      const f = serverFake(root, observer)
      f.state.run = async () => {
        await f.dispatch()
        const metadata = f.histories.ses_parent[1].content[0].state.metadata
        expect(metadata).toMatchObject({ sessionID: "ses_child", status: "completed" })
        if (mutation === "missing") delete metadata.truncated
        if (mutation === "true") metadata.truncated = true
        if (mutation === "string") metadata.truncated = "false"
        if (mutation === "null") metadata.truncated = null
        if (mutation === "extra") metadata.extra = false
        if (mutation === "outputPath") metadata.outputPath = "/host/tool-output"
        if (mutation === "sessionID") metadata.sessionID = "ses_other"
        if (mutation === "status") metadata.status = "running"
      }
      expect(await f.authorize()).toContain(
        ["sessionID", "status"].includes(mutation) ? "unverified" : "Implementation gate complete",
      )
      expect(f.originals).toHaveLength(1)
      expect(f.admission.cap.phase).toBe("closed")
    }
  },
)

snapshotTest(
  "published original input beats native normalization; decoded authority changes never execute",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const boundary of ["published", "decoder", "executor"] as const) {
      const f = serverFake(root, observer)
      f.state.run = async () => {
        const args = nativeArguments(f.candidate)
        if (boundary === "published")
          await expect(f.dispatch({ ...args, model: "", sessionID: "" }, { beforeInput: args })).rejects.toThrow()
        if (boundary === "decoder")
          await expect(f.dispatch(args, { codecInput: { ...args, background: false } })).rejects.toThrow()
        if (boundary === "executor")
          await expect(
            f.dispatch(args, { decoded: { ...args, prompt: args.prompt + " transformed" } }),
          ).rejects.toThrow()
      }
      expect(await f.authorize()).toContain("unverified")
      expect(f.originals).toHaveLength(0)
    }
  },
)

snapshotTest("concurrent before-hook losers and executor replay cannot alter the reserved owner", async (observer) => {
  const root = snapshotFixture(observer),
    f = serverFake(root, observer)
  let release!: () => void, entered!: () => void
  const paused = new Promise<void>((resolve) => {
      release = resolve
    }),
    started = new Promise<void>((resolve) => {
      entered = resolve
    })
  f.state.onRead = async (kind) => {
    if (kind === "context") {
      entered()
      await paused
    }
  }
  f.state.run = async () => {
    const first = f.dispatch()
    await started
    await expect(f.dispatch(undefined, { id: "loser" })).rejects.toThrow()
    expect(f.admission.cap.phase).toBe("reserved")
    await expect(
      Effect.runPromise(
        f.wrapped(nativeArguments(f.candidate), {
          sessionID: "ses_parent",
          agent: "orchestrator",
          messageID: "native-message",
          id: "loser",
          progress: () => Effect.void,
        } as any),
      ),
    ).rejects.toThrow()
    expect(f.admission.cap.phase).toBe("reserved")
    release()
    await first
  }
  expect(await f.authorize()).toContain("Implementation gate complete")
  expect(f.originals).toHaveLength(1)
})

snapshotTest(
  "a captured executor cannot enter the same reserved identity twice while admission is awaiting reads",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    let release!: () => void, entered!: () => void
    const paused = new Promise<void>((resolve) => {
        release = resolve
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    let contextReads = 0
    f.state.onRead = async (kind) => {
      if (kind === "context" && ++contextReads === 1) {
        entered()
        await paused
      }
    }
    f.state.run = async () => {
      const first = f.dispatch()
      await started
      await expect(
        Effect.runPromise(
          f.wrapped(nativeArguments(f.candidate), {
            sessionID: "ses_parent",
            agent: "orchestrator",
            messageID: "native-message",
            id: "native-call",
            progress: () => Effect.void,
          } as any),
        ),
      ).rejects.toThrow("already entered")
      expect(f.admission.cap.phase).toBe("reserved")
      release()
      await first
    }
    expect(await f.authorize()).toContain("Implementation gate complete")
    expect(f.originals).toHaveLength(1)
  },
)

snapshotTest(
  "fresh role, location, permission, path, HEAD and clean checks reject drift after awaited reads",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "role",
      "location",
      "permissions",
      "head",
      "dirty",
      "control",
      "new-input",
      "call-input",
      "call-state",
      "missing-call",
      "server-location",
      "scope-ses_parent",
    ] as const) {
      observer.configure(root)
      const f = serverFake(root, observer)
      f.state.onRead = (kind, id) => {
        if (kind !== "get" || id !== "ses_parent") return
        if (mutation === "role") f.sessions.ses_parent.agent = "build"
        if (mutation === "location") f.sessions.ses_parent.location = { directory: root + "/other" }
        if (mutation === "permissions")
          f.sessions.ses_parent.permissions = [{ action: "*", resource: "*", effect: "allow" }]
        if (mutation === "head") observer.configure(root, "2".repeat(40))
        if (mutation === "dirty") observer.configure(root, HEAD, ["old.txt"])
        if (mutation === "server-location") f.context.location = { directory: root + "/other" }
        if (mutation === "scope-ses_parent") writeFileSync(path.join(root, "nested"), "not a directory")
      }
      f.state.run = async () => {
        if (["control", "new-input", "call-input", "call-state", "missing-call"].includes(mutation))
          f.state.onRead = (kind) => {
            if (kind !== "context") return
            if (mutation === "control") f.histories.ses_parent[0].text += " changed"
            if (mutation === "new-input") f.histories.ses_parent.push(user("intervening", "different request"))
            if (mutation === "call-input") f.histories.ses_parent[1].content[0].state.input.prompt += " changed"
            if (mutation === "call-state") f.histories.ses_parent[1].content[0].state.status = "completed"
            if (mutation === "missing-call") f.histories.ses_parent[1].content = []
          }
        await expect(f.dispatch()).rejects.toThrow()
      }
      expect(await f.authorize()).toContain("unverified")
      expect(f.originals).toHaveLength(0)
      if (mutation === "scope-ses_parent") rmSync(path.join(root, "nested"))
    }
  },
)

snapshotTest("a final symlink becoming dangling after transfer fails closed at late admission", async (observer) => {
  for (const outside of [false, true]) {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    const targetRoot = outside ? snapshotFixture(observer) : root
    f.state.onRead = (kind, id) => {
      if (kind === "get" && id === "ses_parent") {
        rmSync(path.join(root, "old.txt"))
        symlinkSync(path.join(targetRoot, "missing-target"), path.join(root, "old.txt"))
      }
    }
    f.state.run = async () => {
      await expect(f.dispatch()).rejects.toThrow()
    }
    expect(await f.authorize()).toContain("unverified")
    expect(f.originals).toHaveLength(0)
    expect(f.wakes).toHaveLength(1)
    expect(await f.authorize()).toContain("One governed")
  }
})

snapshotTest(
  "prose/refusal, failed execution and ambiguous wake/result/settlement close authority without another wake",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const failure of ["refusal", "wake", "native", "wait", "background-result"] as const) {
      const f = serverFake(root, observer)
      f.state.wakeError = failure === "wake"
      f.state.nativeError = failure === "native"
      f.state.waitError = failure === "wait"
      if (failure === "background-result")
        f.state.resultMutation = (result) => {
          result.output.status = "running"
          result.metadata.status = "running"
        }
      f.state.run = async () => {
        if (failure === "refusal")
          f.histories.ses_parent.push(answer("refusal", "orchestrator", "I cannot implement this."))
        else if (failure === "native" || failure === "wake") await expect(f.dispatch()).rejects.toThrow()
        else await f.dispatch()
      }
      expect(await f.authorize()).toContain("unverified")
      expect(f.admission.cap.phase).toBe("closed")
      expect(await f.authorize()).toContain("One governed")
      expect(f.wakes).toHaveLength(1)
      expect(f.originals.length).toBe(failure === "refusal" || failure === "wake" ? 0 : 1)
    }
  },
)

snapshotTest(
  "teardown at acceptance, reservation or execution revokes old closures; fresh activation cannot recover transcript authority",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const boundary of ["accepted", "reserved", "consumed"] as const) {
      const f = serverFake(root, observer)
      if (boundary === "accepted") f.state.onWake = () => f.admission.teardown()
      if (boundary === "reserved") f.state.onRead = () => f.admission.teardown()
      if (boundary === "consumed") f.state.onNative = () => f.admission.teardown()
      f.state.run = async () => {
        await expect(f.dispatch()).rejects.toThrow()
      }
      expect(await f.authorize()).toContain("unverified")
      await expect(f.dispatch()).rejects.toThrow("revoked")
      await expect(
        Effect.runPromise(
          f.wrapped(nativeArguments(f.candidate), {
            sessionID: "ses_parent",
            agent: "orchestrator",
            messageID: "native-message",
            id: "native-call",
          } as any),
        ),
      ).rejects.toThrow("revoked")
      expect(f.originals.length).toBe(boundary === "consumed" ? 1 : 0)
      const replacement = nativeAdmission(f.context)
      await expect(
        Effect.runPromise(
          replacement.execute(f.original)(nativeArguments(f.candidate), {
            sessionID: "ses_parent",
            agent: "orchestrator",
            messageID: "native-message",
            id: "native-call",
          } as any),
        ),
      ).rejects.toThrow()
    }
  },
)

snapshotTest(
  "trusted native completion binds child identity/task/outcome, persisted call and independent Git scope",
  async (observer) => {
    const root = snapshotFixture(observer)
    for (const mutation of [
      "ses_parent",
      "role",
      "location",
      "permissions",
      "outcome",
      "input",
      "metadata",
      "output",
      "head",
      "scope",
      "child-control",
      "child-attachment",
      "final-error",
      "root-outcome",
    ] as const) {
      observer.configure(root)
      const f = serverFake(root, observer)
      f.state.run = async () => {
        await f.dispatch()
        if (mutation === "ses_parent") f.sessions.ses_child.parentID = "other"
        if (mutation === "role") f.sessions.ses_child.agent = "other"
        if (mutation === "location") f.sessions.ses_child.location.directory += "/other"
        if (mutation === "permissions")
          f.sessions.ses_child.permissions = [{ action: "edit", resource: "*", effect: "allow" }]
        if (mutation === "outcome") f.sessions.ses_child.outcome = "failed"
        if (mutation === "input") f.histories.ses_child[0].text += " changed"
        if (mutation === "head") observer.configure(root, "2".repeat(40))
        if (mutation === "scope") observer.configure(root, HEAD, ["unauthorized.txt"])
        if (mutation === "child-control")
          f.histories.ses_child.splice(1, 0, { type: "synthetic", id: "extra", text: "different work" })
        if (mutation === "child-attachment") f.histories.ses_child[0].files = ["attachment"]
        if (mutation === "final-error") f.histories.ses_child[1].error = { type: "failed" }
        if (mutation === "root-outcome") f.sessions.ses_parent.outcome = "failed"
      }
      if (mutation === "output")
        f.state.nativeResultMutation = (result) => {
          result.output.sessionID = "other"
        }
      if (mutation === "metadata")
        f.state.resultMutation = (result) => {
          result.metadata.sessionID = "other"
        }
      expect(await f.authorize()).toContain("unverified")
      expect(f.originals).toHaveLength(1)
      expect(await f.authorize()).toContain("One governed")
    }
  },
)

snapshotTest(
  "native display/progress formatting and empty completion prose do not decide CAP authority",
  async (observer) => {
    for (const mutation of ["wrapper", "progress", "empty", "neutral-marker"] as const) {
      const root = snapshotFixture(observer),
        f = serverFake(root, observer)
      if (mutation === "wrapper")
        f.state.nativeResultMutation = (result) => {
          result.content = "Different native presentation"
          result.metadata.extra = true
        }
      if (mutation === "progress") f.state.nativeProgress = []
      if (mutation === "empty")
        f.state.onNative = () => {
          f.histories.ses_child[1].content = []
        }
      f.state.run = async () => {
        if (mutation === "neutral-marker")
          f.histories.ses_parent.push({
            type: "model-switched",
            id: "model-change",
            model: { providerID: "other", id: "other" },
          })
        await f.dispatch()
        f.histories.ses_parent.at(-1).content[0].state.content = [text("Truncated output"), text("Extra presentation")]
        f.histories.ses_parent.at(-1).content[0].state.metadata.truncated = true
      }
      expect(await f.authorize()).toContain("Implementation gate complete")
      expect(f.originals).toHaveLength(1)
      expect(await f.authorize()).toContain("One governed")
    }
  },
)

snapshotTest(
  "ordinary recovery of the admitted child and harmless root prose preserve native lifecycle without another admission",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    f.state.onNative = () => {
      // Host recovers the same ses_child execution with its original prompt. No root
      // CAP admission, new child ID, or replacement input is requested.
      f.histories.ses_child.splice(1, 0, {
        type: "assistant",
        id: "recovered-step",
        agent: "authorized_implementer",
        model,
        error: { type: "interrupted" },
        content: [text("Resuming the same child")],
      })
    }
    f.state.run = async () => {
      await f.dispatch()
      f.histories.ses_parent.push(answer("root-prose", "orchestrator", "Finished. STOP."))
    }
    expect(await f.authorize()).toContain("Implementation gate complete")
    expect(f.originals).toHaveLength(1)
    expect(f.histories.ses_child.filter((item) => item.type === "user")).toHaveLength(1)
  },
)

snapshotTest(
  "claim transport occupies synchronously before wake awaits, freezes inputs, and rejects retransmission",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    const transported = structuredClone(f.claim)
    let release!: () => void, entered!: () => void
    const paused = new Promise<void>((resolve) => {
        release = resolve
      }),
      started = new Promise<void>((resolve) => {
        entered = resolve
      })
    f.state.onWake = async () => {
      entered()
      await paused
    }
    f.state.run = async () => {
      await f.dispatch()
    }
    const first = f.authorize(transported)
    await started
    ;(transported as any).candidate.proposal = { ...transported.candidate.proposal, plan: "changed by caller" }
    expect(await f.authorize()).toContain("One governed")
    expect(f.wakes).toHaveLength(1)
    release()
    expect(await first).toContain("Implementation gate complete")
    expect(f.admission.cap.claim.candidate.proposal.plan).toBe("Update its contents\nCheck the result")
  },
)

snapshotTest(
  "terminal success publishes once after root settlement and CAP closure even when receipt transport fails",
  async (observer) => {
    for (const failure of ["none", "effect", "synchronous"] as const) {
      const root = snapshotFixture(observer),
        f = serverFake(root, observer)
      f.state.run = async () => {
        await f.dispatch()
        observer.configure(root, HEAD, ["old.txt"])
      }
      f.state.onReceipt = () => {
        expect(f.state.settled).toBe(true)
        expect(f.admission.cap.phase).toBe("closed")
      }
      f.state.receiptError = failure === "effect"
      if (failure === "synchronous") {
        const synthetic = f.context.session.synthetic
        f.context.session.synthetic = (input: any) => {
          if (input.resume !== false) return synthetic(input)
          expect(f.state.settled).toBe(true)
          expect(f.admission.cap.phase).toBe("closed")
          f.receipts.push(input)
          throw new Error("receipt call failed synchronously")
        }
      }
      const outcome = await f.authorize()
      expect(outcome).toBe(
        `Implementation gate completed successfully.\nHEAD ${HEAD} remained unchanged.\nResulting paths (1): "old.txt".\nThis attempt ended after the implementation gate; Reviewer and Commit were not run.`,
      )
      expect(f.receipts).toHaveLength(1)
      expect(f.receipts[0]).toEqual({
        sessionID: "ses_parent",
        delivery: "steer",
        resume: false,
        text: outcome,
        description: outcome,
        metadata: { source: "opencode-agents" },
      })
      expect(outcome).not.toContain("STOP")
      f.admission.cap.close()
      f.admission.cap.close()
      expect(await f.authorize()).toContain("One governed")
      expect(f.receipts).toHaveLength(1)
      expect(f.wakes).toHaveLength(1)
      expect(f.originals).toHaveLength(1)
    }
  },
)

snapshotTest("settled Git, admission and native failures publish only the accepted owner's facts", async (observer) => {
  for (const failure of ["scope", "head", "admission", "native", "binding"] as const) {
    const root = snapshotFixture(observer),
      f = serverFake(root, observer)
    if (failure === "admission") observer.configure(root, HEAD, ["old.txt"])
    else
      f.state.run = async () => {
        if (failure === "native") {
          f.state.nativeError = true
          await expect(f.dispatch()).rejects.toThrow()
        } else await f.dispatch()
        if (failure === "scope") observer.configure(root, HEAD, ["outside.txt"])
        if (failure === "head") observer.configure(root, "2".repeat(40))
        if (failure === "binding") f.sessions.ses_child.outcome = "failed"
      }
    f.state.onReceipt = () => {
      expect(f.state.settled).toBe(true)
      expect(f.admission.cap.phase).toBe("closed")
    }
    const outcome = await f.authorize()
    expect(outcome).toContain("outcome was unverified")
    const reason = {
      scope: "Out-of-scope Git delta: outside.txt",
      head: "Worktree root or HEAD changed",
      admission: "cleanliness changed before admission",
      native: "Root settled without a verified native execution",
      binding: "Native root/child completion binding failed",
    }[failure]
    expect(outcome).toContain(reason)
    expect(outcome).not.toContain("STOP")
    expect(f.receipts).toHaveLength(1)
    expect(f.receipts[0].text).toBe(outcome)
    expect(f.receipts[0].description).toBe(outcome)
    f.admission.cap.close()
    expect(await f.authorize()).toContain("One governed")
    expect(f.receipts).toHaveLength(1)
  }
})

snapshotTest("losing in-flight RPC and unreadable settlement do not publish terminal receipts", async (observer) => {
  const root = snapshotFixture(observer),
    f = serverFake(root, observer)
  let release!: () => void
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  let waiting = false
  f.state.onWake = async () => {
    waiting = true
    await paused
  }
  f.state.run = async () => {
    await f.dispatch()
  }
  f.state.waitError = true
  const owner = f.authorize()
  await settleUntil(() => waiting)
  expect(await f.authorize()).toContain("One governed")
  expect(f.receipts).toEqual([])
  release()
  expect(await owner).toContain("lost root settlement")
  expect(f.admission.cap.phase).toBe("closed")
  expect(f.receipts).toEqual([])
  expect(f.wakes).toHaveLength(1)
  expect(f.originals).toHaveLength(1)
})

snapshotTest(
  "cancellation retires authority immediately and waits for settlement before publishing",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    const cleanup = await activate(f),
      view = mount(f)
    let release!: () => void
    const paused = new Promise<void>((resolve) => {
      release = resolve
    })
    let waiting = false
    f.options.onWait = async () => {
      waiting = true
      await paused
    }
    f.options.onReceipt = () => {
      view.click(0)
      expectNoImplementation(f)
      expect(f.slots.at(-1).removed).toBe(true)
    }
    view.click(1)
    await settleUntil(() => waiting)
    expect(f.slots.at(-1).removed).toBe(true)
    expect(f.calls.receipts).toEqual([])
    view.click(0)
    cleanup()
    release()
    await settleUntil(() => f.inboxes.parent.length === 2)
    expect(f.calls.receipts).toHaveLength(1)
    expectNoImplementation(f)
    view.dispose()
  },
)

snapshotTest(
  "local admission and cancellation receipt failures never restore controls or send a claim",
  async (observer) => {
    for (const decision of ["authorize", "cancel"] as const) {
      const root = snapshotFixture(observer),
        f = fake(root)
      const cleanup = await activate(f),
        view = mount(f)
      if (decision === "authorize") observer.configure(root, HEAD, ["old.txt"])
      f.options.onReceipt = () => {
        expect(f.slots.at(-1).removed).toBe(true)
        throw new Error("receipt publication unavailable")
      }
      view.click(decision === "authorize" ? 0 : 1)
      await settleUntil(() => f.calls.toasts.some((message) => message.includes("receipt could not be published")))
      expect(f.calls.receipts).toHaveLength(1)
      expect(f.calls.receipts[0].text).toContain(
        decision === "authorize" ? "Implementation was not admitted" : "cancelled before authorization",
      )
      expect(f.calls.receipts[0].resume).toBe(false)
      view.click(0)
      view.click(1)
      const returned = mount(f)
      expect(returned.buttons).toEqual([])
      returned.click(0)
      expect(f.calls.receipts).toHaveLength(1)
      expectNoImplementation(f)
      cleanup()
      returned.dispose()
      view.dispose()
    }
  },
)

snapshotTest(
  "positive readable-frame callback transfers one exact verified claim and receives trusted RPC outcome",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    const cleanup = await activate(f),
      view = mount(f)
    view.click(0, 2)
    expect(f.calls.claims).toHaveLength(0)
    view.click(0)
    view.click(0)
    view.click(1)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.calls.claims).toHaveLength(1)
    expect(f.calls.claims[0]).toEqual({
      purpose: "implement",
      candidate: makeCandidate(parseProposal(proposal, root), root, HEAD),
      rootSessionID: "parent",
      location: { directory: root },
      publicationID: f.inboxes.parent[0].id,
    })
    expect(f.slots.at(-1).removed).toBe(true)
    expect(f.calls.toasts[0]).toContain("Implementation gate complete")
    expect(f.calls.synthetic).toHaveLength(1) // Plan publication only; server owns the wake.
    cleanup()
    view.dispose()
  },
)

snapshotTest(
  "server-owned accepted attempt survives TUI route, projection and cleanup changes without retransmission",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    let release!: (value: string) => void
    const outcome = new Promise<string>((resolve) => {
      release = resolve
    })
    f.options.onAuthorize = async () => await outcome
    const cleanup = await activate(f),
      view = mount(f)
    view.click(0)
    await settleUntil(() => f.calls.claims.length > 0)
    ;(f.context.ui.router as any).current = () => ({ type: "session", sessionID: "planner-child" })
    f.cache.parent.push(user("later", "native continuation"))
    f.emit({ type: "session.execution.started", id: "native-start", data: { sessionID: "parent" } })
    f.renderer.emit("resize")
    f.renderer.emit("frame")
    expect(f.calls.toasts).toHaveLength(0)
    cleanup()
    view.dispose()
    release("Implementation gate complete. STOP before Reviewer / Commit.")
    for (let i = 0; i < 100; i++) await Promise.resolve()
    expect(f.calls.claims).toHaveLength(1)
    expect(f.calls.toasts).toHaveLength(0)
  },
)

snapshotTest(
  "lost Authorize response retires controls without a competing receipt or resubmission",
  async (observer) => {
    const root = snapshotFixture(observer),
      f = fake(root)
    f.options.onAuthorize = async () => {
      throw new Error("lost RPC response")
    }
    const cleanup = await activate(f),
      view = mount(f)
    view.click(0)
    await settleUntil(() => f.calls.toasts.length > 0)
    expect(f.slots.at(-1).removed).toBe(true)
    expect(f.calls.toasts[0]).toContain("Authorized server attempt outcome unknown")
    expect(f.calls.receipts).toEqual([])
    view.click(0)
    view.click(1)
    expect(f.calls.claims).toHaveLength(1)
    cleanup()
    view.dispose()
  },
)

test("Effect server registers only local Authorize RPC, a narrow hidden sponsor and the native tool wrapper", async () => {
  const host = sponsorHost(),
    hooks: any[] = [],
    rpcs: any[] = []
  const native = { name: "subagent", input: nativeInput, execute: () => Effect.succeed({}) }
  const context = {
    location: { directory: "/local" },
    agent: { transform: (update: any) => Effect.sync(() => host.transforms.push(update)) },
    permission: {
      hook: (name: string, callback: any) =>
        Effect.sync(() => {
          expect(name).toBe("evaluate")
          host.permissionHooks.push(callback)
        }),
    },
    tool: {
      hook: (name: string, callback: any) => Effect.sync(() => hooks.push({ name, callback })),
      transform: (update: any) =>
        Effect.sync(() =>
          update({
            update: (id: string, fn: any) => {
              expect(id).toBe("subagent")
              fn(native)
            },
          }),
        ),
    },
    rpc: { register: (definition: any, handlers: any) => Effect.sync(() => rpcs.push({ definition, handlers })) },
  } as any
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const schema = native.input,
          execute = native.execute
        yield* serverPlugin.effect(context)
        expect(native.input).toBe(schema)
        expect(native.execute).not.toBe(execute)
        expect(rpcs).toHaveLength(1)
        expect(rpcs[0].definition).toBe(authorizeRpc)
        expect(Object.keys(rpcs[0].handlers)).toEqual(["authorize"])
        expect(hooks.map((item) => item.name)).toEqual(["execute.before"])
        const editors = [...host.roles().values()]
        expect(editors).toHaveLength(1)
        expect(editors[0]).toMatchObject({
          hidden: true,
          mode: "subagent",
          permissions: [
            { action: "*", resource: "*", effect: "deny" },
            { action: "subagent", resource: "authorized_implementer", effect: "allow" },
          ],
        })
        expect(host.permissionHooks).toHaveLength(1)
        // Register ConfigAgentPlugin after the real external plugin, then read the
        // transformed state: its push mutates the existing sponsor permission array.
        host.appendConfig([{ action: "*", resource: "*", effect: "allow" }])
        expect(host.roles().get(editors[0].id).permissions.at(-1)).toEqual({
          action: "*",
          resource: "*",
          effect: "allow",
        })
        expect(yield* host.evaluate(editors[0].id, "subagent", ["authorized_implementer"])).toBe("allow")
        expect(yield* host.evaluate(editors[0].id, "edit", ["old.txt"])).toBe("deny")
        host.appendConfig([{ action: "*", resource: "*", effect: "deny" }])
        expect(yield* host.evaluate(editors[0].id, "subagent", ["authorized_implementer"])).toBe("deny")
      }),
    ),
  )
  await expect(Effect.runPromise(native.execute())).rejects.toThrow("revoked")
})
