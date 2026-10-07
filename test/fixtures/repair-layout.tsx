import { expect, mock } from "bun:test"
import { createSignal, For, createComponent, ErrorBoundary } from "solid-js"
import { render } from "@opentui/solid"
import { createTestRenderer } from "@opentui/core/testing"
import { TextRenderable, type Renderable } from "@opentui/core"
import { makeCandidate, parseProposal } from "../../src/proposal.ts"
import { checkedCycleOutcome, type RepairDecision } from "../../src/authorize-rpc.ts"

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
const decision: RepairDecision = {
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
      {
        severity: "medium",
        scenario: "The existing title was removed.",
        impact: "The README loses its context.",
        remediation: "Restore the existing title.",
        path: "README.md",
      },
    ],
  },
  reviewer: { messageID: "review-message", toolID: "review-tool", childID: "review-child", resultID: "review-result" },
  receipts: [{ id: "msg_review-receipt", text: "Verified factual review receipt." }],
}
const singleDecision: RepairDecision = {
  ...decision,
  result: {
    status: "CHANGES_REQUESTED",
    summary: "Missing “line two”.",
    findings: [
      {
        severity: "medium",
        scenario: "“Line one”\u202e is last.",
        impact: "Incomplete.",
        remediation: "Append “line two”.",
      },
    ],
  },
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
const clickAction = async (action: string) => {
  const rows = t.captureCharFrame().split("\n")
  const y = rows.findIndex((row) => row.includes("Repair  Stop"))
  expect(y).toBeGreaterThanOrEqual(0)
  const x = rows[y]!.indexOf(action)
  expect(x).toBeGreaterThanOrEqual(0)
  await t.mockMouse.click(x, y)
}
const emit = (event: any) => {
  for (const f of listeners) f({ details: event })
}
const activity = (seq: number, ordered = true) => ({
  id: `evt_activity-${seq}`,
  type: "session.execution.started",
  data: { sessionID: "root" },
  ...(ordered ? { durable: { aggregateID: "root", seq, version: 1 } } : {}),
})
const repairEvidence = () => {
  const find = (node: Renderable): TextRenderable | undefined => {
    if (node instanceof TextRenderable && node.plainText.startsWith("Repair or stop?")) {
      const evidence = node.parent?.getChildren()[0]
      if (evidence instanceof TextRenderable) return evidence
    }
    for (const child of node.getChildren()) {
      const found = find(child)
      if (found) return found
    }
  }
  const evidence = find(t.renderer.root)
  expect(evidence).toBeDefined()
  return evidence!
}
try {
  for (const [width, height] of [
    [248, 58],
    [50, 24],
  ]) {
    for (const scenario of [
      "normal",
      "mouse-stop",
      "paging-repair",
      "single-right-stop",
      "single-left-stop",
      "single-repair",
      "single-mouse-stop",
      "resize-controls",
      "unicode-width-initial-repair",
      "unicode-width-later-repair",
      "authorize-newer",
      "authorize-unproven",
      "repair-newer",
      "repair-unproven",
      "repair-historical",
      "synthetic-copy",
    ]) {
      // The reviewer's reproducer exercises the narrow renderer specifically.
      if (scenario.startsWith("unicode-width-") && width !== 50) continue
      cleanup?.()
      t.resize(248, 58) // Establish the initial Plan separately from Repair geometry.
      setRoute({ type: "home" })
      setSessions([])
      setPadding(0)
      layers.splice(0)
      selections.splice(0)
      toasts.splice(0)
      const single = scenario.startsWith("single-")
      currentDecision = single || scenario === "resize-controls" ? singleDecision : decision
      if (scenario === "resize-controls")
        currentDecision = {
          ...singleDecision,
          result: { ...singleDecision.result, summary: "Review café 😀 " + "界".repeat(70) },
        }
      if (scenario.startsWith("unicode-width-"))
        currentDecision = {
          ...decision,
          result: { ...decision.result, summary: "\u1161".repeat(50) + " IMPORTANT SUMMARY TAIL" },
        }
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
      t.resize(width!, height!)
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
      if (scenario.startsWith("unicode-width-")) {
        const frame = t.captureCharFrame()
        const evidence = repairEvidence()
        // Check pixels/cells captured from the renderer, not just source text:
        // all 50 printable Jamo and the important tail must survive wrapping.
        expect(frame.match(/\u1161/g)).toHaveLength(50)
        expect(frame).toContain("IMPORTANT SUMMARY TAIL")
        expect(evidence.plainText.replace(/\n/g, "")).toContain(currentDecision.result.summary)
        expect(evidence.scrollWidth).toBeLessThanOrEqual(evidence.width)
        expect(evidence.virtualLineCount).toBe(evidence.height)
        expect(layers.at(-1)().enabled()).toBe(true)
        expect(frame).toContain("Repair  Stop  Previous  Next")
        expect(frame).toMatch(/Repair or stop\? Page 1\/[2-9]/)
        if (scenario === "unicode-width-later-repair") {
          key("right")
          key("right") // Next
          key("return")
          expect(layers.at(-1)().enabled()).toBe(false)
          await frames()
          expect(t.captureCharFrame()).toContain("Repair or stop? Page 2/")
          expect(layers.at(-1)().enabled()).toBe(true)
          await clickAction("Previous")
          await frames()
          expect(t.captureCharFrame()).toContain("IMPORTANT SUMMARY TAIL")
          await clickAction("Next")
          await frames()
          const nextEvidence = repairEvidence()
          expect(nextEvidence.scrollWidth).toBeLessThanOrEqual(nextEvidence.width)
          expect(nextEvidence.virtualLineCount).toBe(nextEvidence.height)
          expect(layers.at(-1)().enabled()).toBe(true)
        }
        // Initial-page selection has never visited another evidence page.
        currentDecision = { ...singleDecision, id: "unicode-next", rootIdleID: "msg_unicode-idle", rootEventSeq: 100 }
        await clickAction("Repair")
        await drain()
        expect(selections).toEqual([{ decisionID: decision.id, action: "Repair" }])
        releaseRepair()
        await drain()
        await frames()
        await clickAction("Stop")
        await drain()
        expect(selections.at(-1)).toEqual({ decisionID: "unicode-next", action: "Stop" })
        expect(claims()).toHaveLength(0)
        continue
      }
      if (scenario === "resize-controls") {
        // Narrow Unicode evidence needs paging; widening removes it. A selected
        // paging action must fall back to Stop after the actual controls change.
        if (t.renderer.terminalWidth !== 50) {
          t.resize(50, 24)
          expect(layers.at(-1)().enabled()).toBe(false)
        }
        await frames(5)
        expect(t.captureCharFrame()).toContain("Repair  Stop  Previous  Next")
        expect(t.captureCharFrame()).toMatch(/Repair or stop\? Page 1\/[2-9]/)
        expect(layers.at(-1)().enabled()).toBe(true)
        key("right")
        key("right") // Next
        t.resize(248, 58)
        expect(layers.at(-1)().enabled()).toBe(false)
        key("return")
        await drain()
        expect(selections).toEqual([])
        await frames(5)
        expect(t.captureCharFrame()).not.toContain("Previous")
        expect(t.captureCharFrame()).not.toContain("Next")
        expect(t.captureCharFrame()).not.toContain("Page 1/1")
        expect(layers.at(-1)().enabled()).toBe(true)
        key("return")
        await drain()
        expect(selections).toEqual([{ decisionID: decision.id, action: "Stop" }])
        expect(repairing).toBe(false)
        continue
      }
      if (single) {
        const frame = t.captureCharFrame()
        expect(frame).toContain("Repair  Stop")
        expect(frame).not.toContain("Previous")
        expect(frame).not.toContain("Next")
        expect(frame).not.toContain("Page 1/1")
        expect(
          frame
            .split("\n")
            .find((row) => row.includes("Repair or stop?"))!
            .trim(),
        ).toBe("Repair or stop?")
        expect(frame).toContain('Missing "line two".')
        expect(frame).toContain('Problem: "Line one"\\u202e is last.')
        expect(frame).not.toContain("\\u201c")
        expect(frame).not.toContain("\\u201d")
        expect(frame).not.toContain("\u202e")
        expect(layers.at(-1)().enabled()).toBe(true)
        if (scenario === "single-mouse-stop") await clickAction("Stop")
        else {
          const direction = scenario === "single-left-stop" ? "left" : "right"
          key(direction)
          key(direction)
          if (scenario === "single-repair") {
            key(direction) // Three steps from Stop must select Repair.
            currentDecision = { ...singleDecision, id: "single-next" }
          }
          key("return")
        }
        await drain()
        expect(selections).toEqual([
          {
            decisionID: decision.id,
            action: scenario === "single-repair" ? "Repair" : "Stop",
          },
        ])
        if (scenario === "single-repair") {
          releaseRepair()
          await drain()
          await frames()
          await clickAction("Stop")
          await drain()
          expect(selections.at(-1)).toEqual({ decisionID: "single-next", action: "Stop" })
        } else expect(repairing).toBe(false)
        expect(claims()).toHaveLength(0)
        continue
      }
      expect(t.captureCharFrame()).toContain("Repair  Stop  Previous  Next")
      expect(layers.at(-1)().enabled()).toBe(true)
      expect(t.captureCharFrame()).toMatch(/Repair or stop\? Page 1\/[2-9]/)
      expect(t.captureCharFrame()).toContain("Original authorized paths (1):")
      expect(t.captureCharFrame()).toContain("Required fix: Append line two.")
      expect(t.captureCharFrame()).not.toContain("Read every page")
      expect(t.captureCharFrame()).not.toContain("SHA-256")
      expect(t.captureCharFrame()).not.toContain("review-message")
      if (scenario === "mouse-stop") {
        await clickAction("Stop")
        await drain()
        expect(selections).toEqual([{ decisionID: decision.id, action: "Stop" }])
        expect(repairing).toBe(false)
        expect(claims()).toHaveLength(0)
        continue
      }
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
      if (scenario === "paging-repair") {
        key("right") // Previous
        key("right") // Next
        key("return")
        expect(layers.at(-1)().enabled()).toBe(false)
        await frames()
        expect(t.captureCharFrame()).toContain("Repair or stop? Page 2/")
        expect(layers.at(-1)().enabled()).toBe(true)
        await clickAction("Previous")
        await frames()
        expect(t.captureCharFrame()).toContain("Repair or stop? Page 1/")
        expect(layers.at(-1)().enabled()).toBe(true)
        key("right") // Repair
        currentDecision = { ...decision, id: "repair-after-paging", rootIdleID: "msg_paging-idle", rootEventSeq: 100 }
        key("return")
        await drain()
        expect(selections).toEqual([{ decisionID: decision.id, action: "Repair" }])
        releaseRepair()
        await drain()
        await frames()
      }
      if (scenario.startsWith("repair-")) {
        key("left") // Repair from the initial page, without paging.
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
      if (scenario === "normal") expect(repairing).toBe(false)
      expect(claims()).toHaveLength(0)
    }
  }
} finally {
  cleanup?.()
  t.renderer.destroy()
}
console.log("repair-layout-ok")
