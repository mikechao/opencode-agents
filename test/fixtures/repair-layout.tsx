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
  receipts: [],
}
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
    return checkedCycleOutcome(
      JSON.parse(JSON.stringify({ kind: "repair", receipt: "verified CHANGES_REQUESTED", decision })),
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
try {
  setSessions([{ id: "root", agent: "orchestrator", location: { directory } }])
  await Promise.resolve()
  handlers.get("session.created")({
    data: { sessionID: "root", agent: "orchestrator", location: { directory } },
    created: Date.now() + 10,
  })
  setRoute({ type: "session", sessionID: "root" })
  handlers.get("session.execution.succeeded")({ id: "evt_complete", data: { sessionID: "root" } })
  for (let i = 0; i < 100; i++) await Promise.resolve()
  for (let i = 0; i < 3; i++) {
    await t.renderOnce()
    t.renderer.emit("frame")
  }
  expect(toasts).toEqual([])
  expect(layers.at(-1)().enabled()).toBe(true)
  layers
    .at(-1)()
    .commands.find((c: any) => c.bind === "return")
    .run()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  // RPC may beat the separately batched SSE terminal event, before any Repair frame.
  for (const f of listeners)
    f({ details: { id: "evt_review-idle", type: "session.execution.succeeded", data: { sessionID: "root" } } })
  // Earlier durable events can lag the same RPC too; their verified log
  // positions prove they are historical even though no terminal ID matches.
  for (const [type, seq] of [
    ["session.execution.started", 48],
    ["session.inbox.delivered", 49],
  ] as const)
    for (const f of listeners)
      f({
        details: {
          id: `evt_review-${seq}`,
          type,
          data: { sessionID: "root", inboxID: "review-control" },
          durable: { aggregateID: "root", seq, version: 1 },
        },
      })
  for (let i = 0; i < 5; i++) {
    await t.renderOnce()
    t.renderer.emit("frame")
  }
  expect(toasts).toEqual([])
  expect(claims()).toHaveLength(1)
  const repairLayer = layers.at(-1)()
  expect(t.captureCharFrame()).toContain("Repair  Stop  Previous  Next")
  expect(repairLayer.enabled()).toBe(true)
  // No automatic mutation, and the first readable page cannot grant Repair.
  repairLayer.commands.find((c: any) => c.bind === "left").run()
  repairLayer.commands.find((c: any) => c.bind === "return").run()
  for (let i = 0; i < 50; i++) await Promise.resolve()
  expect(selections).toEqual([])
  // Default Stop's positive action remains readable even with the host inset.
  repairLayer.commands.find((c: any) => c.bind === "right").run()
  repairLayer.commands.find((c: any) => c.bind === "return").run()
  for (let i = 0; i < 100; i++) await Promise.resolve()
  expect(selections).toEqual([{ decisionID: "repair-decision", action: "Stop" }])
  expect(claims()).toHaveLength(0)
} finally {
  cleanup?.()
  t.renderer.destroy()
}
console.log("repair-layout-ok")
