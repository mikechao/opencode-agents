import { expect, test } from "bun:test"
import {
  checkedRevision,
  completedPlannerTurn,
  inspectCompletedRootTurn,
  plannerInput,
  plannerReceipt,
  plannerReceiptKey,
  plannerTurnInput,
  revisionArguments,
  revisionControl,
  verifyChildHistory,
  type Revision,
} from "../src/planner-history.ts"
import { nativeBootstrap } from "../src/host-evidence.ts"

// Local persisted-history doubles: no TUI, native execution, filesystem, or Git.
const text = (value: string) => ({ type: "text", text: value })
const user = (id: string, value: string) => ({ type: "user", id, text: value, files: [], agents: [], skills: [] })
const answer = (id: string, agent: string, value: string) => ({
  type: "assistant",
  id,
  agent,
  finish: "stop",
  content: [text(value)],
})
const idle = (id: string) => ({ type: "idle", id, outcome: "succeeded" })

const request = "  Change the file\nPreserve spaces  \n"
const proposal = { intent: "Change", plan: "Edit and check", files: ["file.txt"] }

function plannerCall(label: string, precedingIdleID: string | null, revision?: Revision): any {
  const input = revision
    ? revisionArguments(revision)
    : { agent: "planner", description: "Plan", prompt: "Model-proposed advisory prompt" }
  return {
    type: "tool",
    id: `${label}-tool`,
    name: "subagent",
    state: {
      status: "completed",
      input,
      content: [text("Native display output")],
      metadata: {
        sessionID: `${label}-child`,
        status: "completed",
        [plannerReceiptKey]: plannerReceipt(
          "root-user",
          input.description,
          request,
          { precedingIdleID, messageID: `${label}-message`, toolID: `${label}-tool` },
          revision,
        ),
      },
    },
  }
}

function toolMessage(label: string, part: any): any {
  return { ...answer(`${label}-message`, "orchestrator", ""), finish: "tool-calls", content: [part] }
}

function deniedCall(label: string): any {
  return toolMessage(label, {
    type: "tool",
    id: `${label}-tool`,
    name: "subagent",
    state: {
      status: "error",
      input: { agent: "planner", description: "Denied", prompt: "Untrusted revision contender" },
      error: { type: "unknown", message: "Denied before trusted admission" },
    },
  })
}

function revisionFrom(label: string, previous: ReturnType<typeof completedPlannerTurn>): Revision {
  return checkedRevision({
    controlID: `${label}-control`,
    publicationID: `${label}-publication`,
    parentID: "root",
    userID: previous.userID,
    request: previous.request,
    proposal,
    text: ` \nRevise ${label}: "quotes", $literal and Unicode ☃\n `,
    precedingIdleID: previous.terminalIdleID,
    source: {
      messageID: previous.planner.messageID,
      toolID: previous.planner.toolID,
      childID: previous.planner.childID,
    },
  })
}

function control(revision: Revision): any {
  return {
    type: "synthetic",
    id: revision.controlID,
    text: revisionControl(revision),
    metadata: { source: "opencode-agents-revision" },
  }
}

function lineage(denials: "before" | "after" | "both") {
  const history: any[] = [
    user("root-user", request),
    toolMessage("A", plannerCall("A", null)),
    answer("A-final", "orchestrator", "Done"),
    idle("A-idle"),
  ]
  const a = completedPlannerTurn(history, "A-idle")
  const revisionB = revisionFrom("B", a)
  history.push(
    control(revisionB),
    ...(denials !== "after" ? [deniedCall("denied-before")] : []),
    toolMessage("B", plannerCall("B", "A-idle", revisionB)),
    ...(denials !== "before" ? [deniedCall("denied-after")] : []),
    answer("B-final", "orchestrator", "Done"),
    idle("B-idle"),
  )
  const b = completedPlannerTurn(history, "B-idle", revisionB)
  return { history, b, revisionB, revisionC: revisionFrom("C", b) }
}

for (const denials of ["before", "after", "both"] as const) {
  test(`revision lineage follows admitted B with denied contenders ${denials} its call`, () => {
    const { history, b, revisionB, revisionC } = lineage(denials)
    expect(b.planner).toMatchObject({ messageID: "B-message", toolID: "B-tool", childID: "B-child" })
    expect(b.planner.effective.revision).toEqual(revisionB)
    expect(revisionC.source).toEqual({ messageID: "B-message", toolID: "B-tool", childID: "B-child" })
    const call = plannerCall("C", "B-idle", revisionC)
    call.state = { status: "running", input: call.state.input, metadata: {} }
    history.push(control(revisionC), toolMessage("C", call))
    const admitted = plannerTurnInput(history, { messageID: "C-message", id: "C-tool" }, revisionC)
    expect(admitted.effective.revision?.text).toBe(revisionC.text)
    expect(admitted.effective.turn).toEqual({ precedingIdleID: "B-idle", messageID: "C-message", toolID: "C-tool" })
    expect(admitted.effective.input).toEqual(revisionArguments(revisionC))

    call.state = plannerCall("C", "B-idle", revisionC).state
    history.push(answer("C-final", "orchestrator", "Done"), idle("C-idle"))
    const c = completedPlannerTurn(history, "C-idle", revisionC)
    expect(c.planner.effective).toEqual(admitted.effective)
    expect(c.request).toBe(request)
    expect(inspectCompletedRootTurn(history, "C-idle", revisionC)).toEqual({
      kind: "governed",
      terminalIdleID: "C-idle",
    })
  })
}

for (const denied of ["denied-before", "denied-after"]) {
  test(`revision source bound to ${denied} fails closed at admission and completion`, () => {
    const { history, revisionC } = lineage("both")
    const forged = checkedRevision({
      ...revisionC,
      source: { messageID: `${denied}-message`, toolID: `${denied}-tool`, childID: "B-child" },
    })
    // Rebuild control, arguments, and receipt consistently: only lineage is wrong.
    const call = plannerCall("C", "B-idle", forged)
    const completed = call.state
    call.state = { status: "running", input: call.state.input, metadata: {} }
    history.push(control(forged), toolMessage("C", call))
    expect(() => plannerTurnInput(history, { messageID: "C-message", id: "C-tool" }, forged)).toThrow(
      "revision does not follow the bound Planner",
    )
    call.state = completed
    history.push(answer("C-final", "orchestrator", "Done"), idle("C-idle"))
    expect(() => completedPlannerTurn(history, "C-idle", forged)).toThrow("revision does not follow the bound Planner")
    expect(inspectCompletedRootTurn(history, "C-idle", forged).kind).toBe("invalid")
  })
}

test("initial Planner derives literal input and planning children bind the exact bootstrap and final text", () => {
  const call = plannerCall("A", null)
  call.state = { status: "running", input: call.state.input, metadata: {} }
  const history = [user("root-user", request), toolMessage("A", call)]
  const admitted = plannerTurnInput(history, { messageID: "A-message", id: "A-tool" })
  expect(admitted.proposed.prompt).toBe("Model-proposed advisory prompt")
  expect(admitted.effective.input.prompt).toBe(plannerInput(request))
  for (const agent of ["planner", "explorer"] as const) {
    const prompt = agent === "planner" ? admitted.effective.input.prompt : "Inspect one question"
    const result = agent === "planner" ? JSON.stringify(proposal) : "Advisory findings"
    const child: any[] = [
      user(`${agent}-user`, nativeBootstrap(prompt)),
      answer(`${agent}-final`, agent, result),
      idle(`${agent}-idle`),
    ]
    expect(verifyChildHistory(child, agent, prompt)).toEqual({
      inputID: `${agent}-user`,
      finalID: `${agent}-final`,
      text: result,
    })
    child[0]!.text += " changed"
    expect(() => verifyChildHistory(child, agent, prompt)).toThrow("bootstrap input")
  }
})

function directHistory(label: string, tools: string[] = [], instructions = false): any[] {
  const response = answer(`${label}-final`, "orchestrator", "A direct answer")
  response.content.push(
    ...tools.map((name, index): any => ({
      type: "tool",
      id: `${label}-read-${index}`,
      name,
      state: { status: "completed", input: {}, content: [text("Read-only findings")], metadata: {} },
    })),
  )
  return [
    user(`${label}-user`, "What does this project do?"),
    response,
    ...(instructions
      ? [
          {
            type: "synthetic",
            id: `${label}-instructions`,
            text: "Instructions from: /project/sub/AGENTS.md\nRead-only guidance",
            metadata: { instruction: { paths: ["/project/sub/AGENTS.md"] } },
          },
        ]
      : []),
    idle(`msg_${label}-idle`),
  ]
}

test("completed-turn inspection rejects unsafe tools, malformed instructions and missing boundaries", () => {
  for (const mutation of [
    "delegation",
    "wrong-target",
    "missing-receipt",
    "forbidden",
    "unfinished-read",
    "provider-read",
    "instructions",
    "control",
    "compaction",
    "duplicate",
    "missing-idle",
    "multiple-inputs",
  ] as const) {
    const history = directHistory("hello", ["read"], true)
    const part = history[1].content[1]
    if (["delegation", "wrong-target", "missing-receipt"].includes(mutation)) {
      part.name = "subagent"
      part.state.input = {
        agent: mutation === "wrong-target" ? "explorer" : "planner",
        description: "Plan",
        prompt: "Proposed",
      }
    }
    if (mutation === "forbidden") part.name = "shell"
    if (mutation === "unfinished-read") part.state.status = "streaming"
    if (mutation === "provider-read") part.executed = true
    if (mutation === "instructions") history[2].metadata.instruction.extra = true
    if (mutation === "control") history[2].metadata = { source: "planner" }
    if (mutation === "compaction") history[2].type = "compaction"
    if (mutation === "duplicate") history[2].id = history[0].id
    if (mutation === "missing-idle") history.pop()
    if (mutation === "multiple-inputs") history.splice(1, 0, user("another-user", "Do something else"))
    expect(inspectCompletedRootTurn(history, "msg_hello-idle").kind).toBe("invalid")
  }
})

test("completion distinguishes non-admitted failures from admitted or child-bearing failures", () => {
  for (const name of ["subagent", "shell", "read", "glob", "grep"]) {
    const history = directHistory("failed", [name])
    const part = history[1].content[1]
    part.state = { status: "error", input: {}, error: { type: "tool.input-json", message: "Not admitted" } }
    expect(inspectCompletedRootTurn(history, "msg_failed-idle").kind).toBe("non-governed")
    for (const metadata of [
      { [plannerReceiptKey]: {} },
      { sessionID: "native-child" },
      { [plannerReceiptKey]: undefined },
    ]) {
      part.state.metadata = metadata
      expect(inspectCompletedRootTurn(history, "msg_failed-idle").kind).toBe("invalid")
    }
  }
})
