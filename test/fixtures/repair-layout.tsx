import { expect, mock } from "bun:test"
import { createSignal, For, createComponent, ErrorBoundary } from "solid-js"
import { render } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { makeCandidate, parseProposal } from "../../src/proposal.ts"
import { checkedCycleOutcome } from "../../src/authorize-rpc.ts"

const directory = process.cwd()
const head = "a".repeat(40)
const candidate = makeCandidate(
  parseProposal(
    JSON.stringify({
      intent: "Append both requested README lines",
      plan: "Preserve existing contents. Append line one and line two, and verify the diff.",
      files: ["README.md"],
    }),
    directory,
  ),
  directory,
  head,
)
const decision = {
  id: "repair-decision",
  rootSessionID: "root",
  rootIdleID: "msg_review-idle",
  rootEventSeq: 50,
  candidate,
  target: { root: directory, head, paths: ["README.md"], digest: "b".repeat(64) },
  result: {
    status: "CHANGES_REQUESTED",
    summary: "The required second line is missing.",
    findings: [
      {
        severity: "medium",
        scenario: "README ends with line one.",
        impact: "The request needs both lines.",
        remediation: "Append line two.",
        path: "README.md",
      },
    ],
  },
  reviewer: { messageID: "review-message", toolID: "review-tool", childID: "review-child", resultID: "review-result" },
  receipts: [{ id: "msg_review-receipt", text: "Verified factual review receipt." }],
}
let currentDecision = decision
let authorizeReply = Promise.resolve()
let repairReply = Promise.resolve()
let authorizing = false
let repairing = false
const published = {
  candidate,
  bound: { parentID: "root", planner: { childID: "planner" } },
  publication: { id: "plan" },
  activation: { baseline: { root: directory, head, paths: [] } },
}
mock.module("../../src/git.ts", () => ({
  observeGit: () => ({ root: directory, head, paths: [] }),
  requireFresh: () => {},
}))
mock.module("../../src/attempt.ts", () => ({
  activationEvidence: () => published.activation,
  initiallyAuthorizable: () => true,
  inspectRootCompletion: async () => ({ kind: "governed", terminalIdleID: "msg_complete" }),
  publishPlan: async (_c: any, _a: any, guard: any) => {
    guard.expectPublication(published.bound, {})
    return published
  },
  verifyPublishedAttempt: async () => {},
  publishedPresentationMatches: () => true,
  authorizePublishedAttempt: async (_c: any, _p: any, guard: any) => {
    guard.transfer()
    setPadding(2)
    authorizing = true
    await authorizeReply
    return checkedCycleOutcome(
      JSON.parse(JSON.stringify({ kind: "repair", receipt: "verified CHANGES_REQUESTED", decision: currentDecision })),
    )
  },
  publishTerminalReceipt: async () => {},
  revisionInput: () => {},
}))
mock.module("../../.opencode/plugins/opencode-agents/agent-models-ui.ts", () => ({
  registerAgentModels: () => () => {},
}))
const { default: plugin } = await import("../../.opencode/plugins/opencode-agents/tui.tsx")
const t = await createTestRenderer({ width: 248, height: 58 })
const [padding, setPadding] = createSignal(0)
const [claims, setClaims] = createSignal<any[]>([])
const [sessions, setSessions] = createSignal<any[]>([])
const [route, setRoute] = createSignal<any>({ type: "home" })
const handlers = new Map<string, any>()
const listeners = new Set<any>()
const layers: any[] = []
const selections: any[] = []
const toasts: string[] = []
const theme = {
  text: {
    base: "white",
    muted: "gray",
    feedback: { info: { base: "blue" } },
    action: { primary: { base: "white", focused: "white", disabled: "gray" }, secondary: { base: "white" } },
  },
  background: {
    action: { primary: { base: "blue", focused: "blue", disabled: "black" }, secondary: { base: "black" } },
  },
}
const contribution = (claim: any) => (
  <ErrorBoundary
    fallback={(error) => {
      toasts.push(String(error))
      return null
    }}
  >
    {createComponent(claim.render, {
      get sessionID() {
        return route().sessionID
      },
    })}
  </ErrorBoundary>
)
const context: any = {
  location: { directory },
  renderer: t.renderer,
  theme,
  keymap: { mode: { current: () => "base" }, layer: (f: any) => layers.push(f) },
  client: {
    session: {
      get: async () => ({
        id: "root",
        agent: "orchestrator",
        location: { directory },
        time: { created: 1, idle: 2 },
        outcome: "succeeded",
      }),
      active: async () => ({}),
      inbox: { list: async () => [] },
    },
    rpc: () => ({
      decideRepair: async (input: any) => {
        selections.push(input)
        if (input.action === "Repair") {
          repairing = true
          await repairReply
          return checkedCycleOutcome({
            kind: "repair",
            receipt: "verified CHANGES_REQUESTED",
            decision: currentDecision,
          })
        }
        return { kind: "terminal", receipt: "Stopped by human" }
      },
    }),
  },
  data: {
    on: (type: string, f: any) => {
      handlers.set(type, f)
      return () => handlers.delete(type)
    },
    listen: (f: any) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    location: { default: () => ({ directory }) },
    session: {
      list: sessions,
      get: () => sessions()[0],
      creating: () => true,
      message: { list: () => [] },
      pending: { list: () => [] },
    },
  },
  ui: {
    router: { current: route },
    slot: (claim: any) => {
      setClaims((v) => [...v, claim])
      return () => setClaims((v) => v.filter((c) => c !== claim))
    },
    toast: { show: ({ message }: { message: string }) => toasts.push(message) },
  },
}
let cleanup: any
await render(() => {
  cleanup = plugin.setup(context)
  return (
    <box width="100%" height="100%" flexDirection="column">
      <box flexGrow={1} />
      <box flexShrink={0} paddingX={padding()}>
        <For each={claims()}>{contribution}</For>
        <text height={3}>Composer</text>
      </box>
    </box>
  )
}, t.renderer)
const drain = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve()
}
const frames = async (count = 3) => {
  for (let i = 0; i < count; i++) {
    await t.renderOnce()
    t.renderer.emit("frame")
  }
}
const key = (bind: string) =>
  layers
    .at(-1)()
    .commands.find((c: any) => c.bind === bind)
    .run()
const emit = (event: any) => {
  for (const f of listeners) f({ details: event })
}
const activity = (seq: number, ordered = true) => ({
  id: `evt_activity-${seq}`,
  type: "session.execution.started",
  data: { sessionID: "root" },
  ...(ordered ? { durable: { aggregateID: "root", seq, version: 1 } } : {}),
})
try {
  for (const scenario of [
    "normal",
    "authorize-newer",
    "authorize-unproven",
    "repair-newer",
    "repair-unproven",
    "repair-historical",
    "synthetic-copy",
  ]) {
    cleanup?.()
    setRoute({ type: "home" })
    setSessions([])
    setPadding(0)
    layers.splice(0)
    selections.splice(0)
    toasts.splice(0)
    currentDecision = decision
    authorizing = false
    repairing = false
    let releaseAuthorize!: () => void
    let releaseRepair!: () => void
    authorizeReply = new Promise<void>((resolve) => {
      releaseAuthorize = resolve
    })
    repairReply = new Promise<void>((resolve) => {
      releaseRepair = resolve
    })
    cleanup = plugin.setup(context)
    setSessions([{ id: "root", agent: "orchestrator", location: { directory } }])
    await drain()
    handlers.get("session.created")({
      data: { sessionID: "root", agent: "orchestrator", location: { directory } },
      created: Date.now() + 10,
    })
    setRoute({ type: "session", sessionID: "root" })
    handlers.get("session.execution.succeeded")({ id: "evt_complete", data: { sessionID: "root" } })
    await drain()
    await frames()
    expect(toasts).toEqual([])
    expect(layers.at(-1)().enabled()).toBe(true)
    key("return")
    await drain()
    expect(authorizing).toBe(true)
    // Events arrive while the RPC is outstanding, before any Repair owner exists.
    if (scenario.startsWith("authorize-")) emit(activity(51, scenario !== "authorize-unproven"))
    else {
      emit(activity(48))
      emit({ id: "evt_review-idle", type: "session.execution.succeeded", data: { sessionID: "root" } })
      // The response supplies this owned publication identity after the event.
      emit({
        id: "evt_receipt",
        type: "session.inbox.enqueued",
        data: {
          sessionID: "root",
          inboxID: "msg_review-receipt",
          item: { type: "synthetic", payload: { text: decision.receipts[0].text } },
        },
        durable: { aggregateID: "root", seq: 51, version: 1 },
      })
    }
    releaseAuthorize()
    await drain()
    await frames(5)
    if (scenario.startsWith("authorize-")) {
      expect(claims()).toHaveLength(0)
      expect(t.captureCharFrame()).not.toContain("Repair  Stop  Previous  Next")
      expect(toasts.at(-1)).toContain("superseded")
      expect(selections).toEqual([])
      continue
    }
    // Exact owned inbox events and delayed historical events remain inert.
    emit({
      id: "evt_delivery",
      type: "session.inbox.delivered",
      data: { sessionID: "root", inboxID: "msg_review-receipt" },
    })
    emit({
      id: "evt_review-control-delivered",
      type: "session.inbox.delivered",
      data: { sessionID: "root", inboxID: "review-control" },
      durable: { aggregateID: "root", seq: 49, version: 1 },
    })
    expect(toasts).toEqual([])
    expect(claims()).toHaveLength(1)
    expect(t.captureCharFrame()).toContain("Repair  Stop  Previous  Next")
    expect(layers.at(-1)().enabled()).toBe(true)
    key("left") // Repair still requires every evidence page.
    key("return")
    await drain()
    expect(selections).toEqual([])
    key("right") // Stop
    if (scenario === "synthetic-copy") {
      emit({
        id: "evt_unowned-copy",
        type: "session.synthetic",
        data: { sessionID: "root", text: decision.receipts[0].text },
        durable: { aggregateID: "root", seq: 51, version: 1 },
      })
      await frames()
      expect(claims()).toHaveLength(0)
      expect(t.captureCharFrame()).not.toContain("Repair  Stop  Previous  Next")
      expect(selections).toEqual([])
      continue
    }
    if (scenario.startsWith("repair-")) {
      key("right") // Previous
      key("right") // Next
      for (let i = 0; i < 12; i++) {
        key("return")
        await frames(1)
      }
      key("right") // Repair
      currentDecision = { ...decision, id: "repair-next", rootIdleID: "msg_next-review-idle", rootEventSeq: 100 }
      key("return")
      await drain()
      expect(repairing).toBe(true)
      expect(selections).toEqual([{ decisionID: "repair-decision", action: "Repair" }])
      emit(activity(scenario === "repair-historical" ? 99 : 101, scenario !== "repair-unproven"))
      releaseRepair()
      await drain()
      await frames(5)
      if (scenario !== "repair-historical") {
        expect(claims()).toHaveLength(0)
        expect(t.captureCharFrame()).not.toContain("Repair  Stop  Previous  Next")
        expect(toasts.at(-1)).toContain("superseded")
        expect(selections).toHaveLength(1)
        continue
      }
      expect(toasts).toEqual([])
      expect(claims()).toHaveLength(1)
      expect(t.captureCharFrame()).toContain("Repair  Stop  Previous  Next")
    }
    key("return") // Default Stop, proven in the current readable frame.
    await drain()
    expect(selections.at(-1)).toEqual({ decisionID: currentDecision.id, action: "Stop" })
    expect(claims()).toHaveLength(0)
  }
} finally {
  cleanup?.()
  t.renderer.destroy()
}
console.log("repair-layout-ok")
