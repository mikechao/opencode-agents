import type { SessionMessage } from "@opencode/schema/session-message"
import type { SessionMessageInfo } from "@opencode/client"
import { exactKeys, frozenCopy } from "./cap.ts"
import type { Proposal } from "./proposal.ts"
import {
  exactEvidence,
  nativeBootstrap,
  directRootTool,
  nativeReadInstruction,
  type RootMessage,
} from "./host-evidence.ts"

// Stateless proof of exact admitted Planner input and completion lineage.
// Native admission and TUI publication own their respective lifecycle state.
// Fixed advisory planning guidance; this wrapper grants no authority.
export const plannerInput = (request: string) => `User request:\n${request}

Planning execution reminder:
Before launching Explorer work, identify useful independent investigations already apparent from the request.
Once multiple useful independent Explorer investigations are known, emit all corresponding \`subagent\` tool calls in the same assistant response before consuming any Explorer result.
Do not emit one known-independent Explorer call, wait for its result, and then emit another already-known independent call.`
export const plannerReceiptKey = "opencodeAgentsPlannerInput"
// Literal input selected by the publication owner, never inferred from root prose.
export type Revision = Readonly<{
  controlID: string
  publicationID: string
  parentID: string
  userID: string
  request: string
  proposal: Proposal
  text: string
  precedingIdleID: string
  source: Readonly<{ messageID: string; toolID: string; childID: string }>
}>
export function checkedRevision(value: unknown): Revision {
  if (
    !exactKeys(value, [
      "controlID",
      "publicationID",
      "parentID",
      "userID",
      "request",
      "proposal",
      "text",
      "precedingIdleID",
      "source",
    ]) ||
    ![
      value.controlID,
      value.publicationID,
      value.parentID,
      value.userID,
      value.request,
      value.text,
      value.precedingIdleID,
    ].every((item) => typeof item === "string" && !!item.trim()) ||
    !exactKeys(value.source, ["messageID", "toolID", "childID"]) ||
    !Object.values(value.source).every((item) => typeof item === "string" && !!item.trim()) ||
    !exactKeys(value.proposal, ["intent", "plan", "files"]) ||
    typeof value.proposal.intent !== "string" ||
    !value.proposal.intent.trim() ||
    typeof value.proposal.plan !== "string" ||
    !value.proposal.plan.trim() ||
    !Array.isArray(value.proposal.files) ||
    !value.proposal.files.every((item) => typeof item === "string")
  )
    stop("malformed trusted revision input")
  return frozenCopy(value) as Revision
}
const revisionPrompt = (revision: Revision) =>
  `${plannerInput(revision.request)}\n\nRevise this exact frozen proposal:\n${JSON.stringify(revision.proposal)}\n\nExact human revision instruction:\n${JSON.stringify(revision.text)}`
export const revisionArguments = (revision: Revision) => ({
  agent: "planner" as const,
  description: "Revise the published plan",
  prompt: revisionPrompt(revision),
})
export const revisionControl = (revision: Revision) =>
  [
    "Propose exactly one foreground native subagent call with exactly these arguments:",
    JSON.stringify(revisionArguments(revision)),
    "Do not add keys, reuse a session, or change these values. After its result, finish with prose. Trusted runtime owns Plan publication; no implementation is authorized.",
  ].join("\n")
export function plannerArguments(value: unknown) {
  if (
    !exactKeys(value, ["agent", "description", "prompt"]) ||
    value.agent !== "planner" ||
    typeof value.description !== "string" ||
    !value.description ||
    typeof value.prompt !== "string" ||
    !value.prompt
  )
    stop("native subagent arguments differ from the fixed contract")
  return { agent: "planner" as const, description: value.description, prompt: value.prompt }
}
type PlannerTurn = Readonly<{ precedingIdleID: string | null; messageID: string; toolID: string }>
export const plannerReceipt = (
  userID: string,
  description: string,
  request: string,
  turn: PlannerTurn,
  revision?: Revision,
) => ({
  userID,
  input: revision
    ? revisionArguments(revision)
    : { agent: "planner" as const, description, prompt: plannerInput(request) },
  turn,
  ...(revision ? { revision } : {}),
})
function effectivePlannerReceipt(
  value: unknown,
  userID: string,
  request: string,
  proposed: ReturnType<typeof plannerArguments>,
  turn: PlannerTurn,
  revision?: Revision,
) {
  if (!exactKeys(value, revision ? ["userID", "input", "turn", "revision"] : ["userID", "input", "turn"]))
    stop("missing or malformed trusted Planner input receipt")
  plannerArguments(value.input)
  const expected = plannerReceipt(userID, proposed.description, request, turn, revision)
  if (!same(value, expected)) stop("trusted Planner input receipt differs from the root request")
  return expected
}
export type Call = Readonly<{
  messageID: string
  toolID: string
  childID: string
  proposed: Readonly<ReturnType<typeof plannerArguments>>
  effective: Readonly<ReturnType<typeof plannerReceipt>>
}>
export type Child = Readonly<{ inputID: string; finalID: string; text: string }>
function same(a: unknown, b: unknown): boolean {
  return exactEvidence(a) === exactEvidence(b)
}

function stop(message: string): never {
  throw new Error(`Attempt binding failed: ${message}`)
}
function empty(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0)
}
function plain(
  message: Pick<Extract<SessionMessageInfo | SessionMessage.Info, { type: "user" }>, "files" | "agents" | "skills">,
): boolean {
  return empty(message.files) && empty(message.agents) && empty(message.skills)
}
function oneFinal(history: readonly RootMessage[], agent: string) {
  const assistants = history.filter((message) => message.type === "assistant")
  const final = assistants.at(-1)
  if (!final || final.finish !== "stop" || assistants.some((message) => message.agent !== agent || message.error)) {
    stop(`unexpected ${agent} assistant result`)
  }
  return final
}
function finalText(message: Extract<RootMessage, { type: "assistant" }>): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}
type RootTool = Extract<Extract<RootMessage, { type: "assistant" }>["content"][number], { type: "tool" }>
// Failed local calls without trusted execution evidence created no authority.
// Completed mutation-capable calls and any admitted Planner metadata fail closed.
function nonGovernedTool(part: RootTool): boolean {
  if (part.state.status !== "completed" && part.state.status !== "error") return false
  const metadata = part.state.metadata
  if (metadata && (plannerReceiptKey in metadata || "sessionID" in metadata)) return false
  return directRootTool(part.name) || part.state.status === "error"
}
function rootTools(history: readonly RootMessage[]) {
  const tools: { messageID: string; part: RootTool }[] = []
  const ids = new Set<string>()
  for (const message of history) {
    if (message.type !== "assistant") continue
    if (message.agent !== "orchestrator" || message.error) stop("unexpected Orchestrator assistant result")
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (!part.id.trim() || ids.has(part.id) || part.executed === true) stop("duplicate or nonlocal root tool")
      ids.add(part.id)
      tools.push({ messageID: message.id, part })
    }
  }
  return tools
}
function rootUser(history: readonly RootMessage[]) {
  const users = history.filter((message) => message.type === "user")
  const user = users[0]
  if (users.length !== 1 || !user || history[0] !== user || !plain(user) || !user.text)
    stop("parent does not have one exact plain user input in its turn")
  return user
}
function nonGovernedTurn(history: readonly RootMessage[]): void {
  rootUser(history)
  if (
    history.some(
      (message) =>
        !["user", "assistant", "idle", "model-switched"].includes(message.type) && !nativeReadInstruction(message),
    )
  )
    stop("unexpected direct root input or control message")
  const final = history.filter((message) => message.type === "assistant").at(-1)
  if (final?.type !== "assistant" || final.finish !== "stop") stop("direct root final result is missing")
  for (const { part } of rootTools(history)) {
    if (!nonGovernedTool(part)) stop("earlier root turn contains governed or unsafe execution evidence")
  }
}
function rootSegment(history: readonly RootMessage[], terminalIdleID?: string, revision?: Revision) {
  if (new Set(history.map((message) => message.id)).size !== history.length) stop("duplicate message ID")
  let end = history.length
  if (terminalIdleID !== undefined) {
    const index = history.findIndex((message) => message.id === terminalIdleID)
    const idle = history[index]
    if (index < 0 || idle?.type !== "idle" || idle.outcome !== "succeeded") stop("governed terminal idle is missing")
    end = index + 1
  }
  rootTools(history.slice(0, end))
  let start = 0
  let precedingIdleID: string | null = null
  let previous: ReturnType<typeof completedCalls> | undefined
  for (let index = 0; index < end - (terminalIdleID === undefined ? 0 : 1); index++) {
    const message = history[index]!
    if (message.type !== "idle") continue
    if (message.outcome !== "succeeded") stop("earlier root turn did not succeed")
    const earlier = history.slice(start, index + 1)
    const governed = rootTools(earlier).filter(({ part }) => !nonGovernedTool(part))
    if (revision && governed.length) {
      // Denied pre-admission calls have no trusted execution evidence. Recover
      // the receipt from the sole governed call, then verify its full binding.
      const call = governed[0]
      if (governed.length !== 1 || !call || call.part.name !== "subagent")
        stop("parent did not make exactly one native Planner call")
      const receipt = "metadata" in call.part.state ? call.part.state.metadata?.[plannerReceiptKey] : undefined
      const priorRevision =
        receipt && typeof receipt === "object" && "revision" in receipt ? checkedRevision(receipt.revision) : undefined
      if (priorRevision) {
        if (!previous || !revisionFollows(priorRevision, previous)) stop("revision history lineage changed")
      } else if (previous) stop("ungranted second initial Planner")
      previous = completedCalls(governedSegment(earlier, precedingIdleID, undefined, priorRevision), message.id)
      if (previous.userID !== revision.userID || previous.request !== revision.request)
        stop("original revision request changed")
    } else {
      if (previous) stop("unrelated input follows planning")
      nonGovernedTurn(earlier)
    }
    start = index + 1
    precedingIdleID = message.id
  }
  if (revision && (!previous || !revisionFollows(revision, previous)))
    stop("revision does not follow the bound Planner")
  return { segment: history.slice(start, end), precedingIdleID, end }
}
function revisionFollows(revision: Revision, previous: ReturnType<typeof completedCalls>) {
  return (
    revision.userID === previous.userID &&
    revision.request === previous.request &&
    revision.precedingIdleID === previous.terminalIdleID &&
    same(revision.source, {
      messageID: previous.planner.messageID,
      toolID: previous.planner.toolID,
      childID: previous.planner.childID,
    })
  )
}
function governedTurn(
  history: readonly RootMessage[],
  terminalIdleID?: string,
  invocation?: { messageID: string; id: string },
  revision?: Revision,
) {
  const { segment, precedingIdleID, end } = rootSegment(history, terminalIdleID, revision)
  if (end !== history.length) stop("new input follows governed completion")
  return governedSegment(segment, precedingIdleID, invocation, revision)
}
function governedSegment(
  segment: readonly RootMessage[],
  precedingIdleID: string | null,
  invocation?: { messageID: string; id: string },
  revision?: Revision,
) {
  const control = segment[0]
  if (
    revision &&
    (precedingIdleID !== revision.precedingIdleID ||
      control?.type !== "synthetic" ||
      control.id !== revision.controlID ||
      control.text !== revisionControl(revision) ||
      !exactKeys(control.metadata, ["source"]) ||
      control.metadata.source !== "opencode-agents-revision")
  )
    stop("trusted revision control changed")
  const user = revision ? { id: revision.userID, text: revision.request } : rootUser(segment)
  if (
    segment.some(
      (message, index) =>
        !(revision && index === 0) &&
        ![...(revision ? [] : ["user"]), "assistant", "idle", "model-switched"].includes(message.type),
    )
  )
    stop("unexpected parent input or control message")
  const tools = rootTools(segment).filter(
    ({ messageID, part }) =>
      (invocation && messageID === invocation.messageID && part.id === invocation.id) || !nonGovernedTool(part),
  )
  const call = tools[0]
  if (tools.length !== 1 || !call || call.part.name !== "subagent")
    stop("parent did not make exactly one native Planner call")
  const proposed = plannerArguments(call.part.state.input)
  if (revision && !same(proposed, revisionArguments(revision))) stop("revision Planner arguments changed")
  const turn = { precedingIdleID, messageID: call.messageID, toolID: call.part.id }
  return { user, call, proposed, turn, segment, revision }
}
export function plannerTurnInput(
  history: readonly RootMessage[],
  invocation: { messageID: string; id: string },
  revision?: Revision,
) {
  const { user, call, proposed, turn } = governedTurn(history, undefined, invocation, revision)
  if (call.messageID !== invocation.messageID || call.part.id !== invocation.id || call.part.state.status !== "running")
    stop("Planner native contender identity changed")
  return { proposed, effective: plannerReceipt(user.id, proposed.description, user.text, turn, revision) }
}
export function completedPlannerTurn(history: readonly RootMessage[], terminalIdleID: string, revision?: Revision) {
  return completedCalls(governedTurn(history, terminalIdleID, undefined, revision), terminalIdleID)
}
const parentCalls = completedPlannerTurn
function completedCalls(
  { user, call, proposed, turn, segment, revision }: ReturnType<typeof governedSegment>,
  terminalIdleID: string,
) {
  const final = segment.filter((message) => message.type === "assistant").at(-1)
  if (final?.type !== "assistant" || final.finish !== "stop") stop("parent final result is missing")
  const tool = call.part
  if (tool.state.status !== "completed") stop("unexpected parent tool")
  const childID = tool.state.metadata?.sessionID
  if (typeof childID !== "string" || !childID || tool.state.metadata?.status !== "completed")
    stop("missing completed native child metadata")
  const effective = effectivePlannerReceipt(
    tool.state.metadata?.[plannerReceiptKey],
    user.id,
    user.text,
    proposed,
    turn,
    revision,
  )
  return {
    userID: user.id,
    request: user.text,
    planner: { messageID: call.messageID, toolID: tool.id, childID, proposed, effective },
    terminalIdleID,
    ...(revision ? { revision } : {}),
  }
}
export function inspectCompletedRootTurn(
  history: SessionMessageInfo[],
  terminalIdleID: string,
  revision?: Revision,
): { kind: "non-governed" } | { kind: "governed"; terminalIdleID: string } | { kind: "invalid"; reason: string } {
  try {
    const { segment } = rootSegment(history, terminalIdleID, revision)
    if (rootTools(segment).some(({ part }) => !nonGovernedTool(part))) {
      parentCalls(history, terminalIdleID, revision)
      return { kind: "governed", terminalIdleID }
    }
    nonGovernedTurn(segment)
    return { kind: "non-governed" }
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) }
  }
}
// Native permissions govern observations; history binds supported input and final output.
export function verifyChildHistory(
  history: readonly RootMessage[],
  agent: "planner" | "explorer",
  prompt: string,
): Child {
  const users = history.filter((message) => message.type === "user")
  if (
    users.length !== 1 ||
    users[0]?.type !== "user" ||
    history[0] !== users[0] ||
    !plain(users[0]) ||
    users[0].text !== nativeBootstrap(prompt) ||
    history.some((message) => !["user", "assistant", "idle", "model-switched"].includes(message.type))
  )
    stop(`unexpected ${agent} bootstrap input`)
  const idles = history.filter((message) => message.type === "idle")
  if (!idles.length || idles.some((message) => message.outcome !== "succeeded") || history.at(-1)?.type !== "idle") {
    stop(`unexpected ${agent} bootstrap completion`)
  }
  const final = oneFinal(history, agent)
  const text = finalText(final)
  if (!text.trim()) stop(`unexpected ${agent} final text`)
  return { inputID: users[0].id, finalID: final.id, text }
}
