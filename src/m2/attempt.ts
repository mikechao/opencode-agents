import type { Context } from "@opencode/plugin/tui/context"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createHash } from "node:crypto"
import { realpathSync } from "node:fs"
import { assertLive, candidateFits, consumeIntent, grantIntent, implementerPrompt, type Generation } from "../m1/attempt.ts"
import { observeGit, requireFresh, requireInScope, type GitSnapshot } from "../m1/git.ts"
import { candidateIntact, candidateMessage, makeCandidate, parseProposal } from "../m1/proposal.ts"
import type { IntentCandidate } from "../m1/proposal.ts"

export const SLOT_PROMPT = "Reply READY only. Do not inspect or modify the repository."
export const plannerInput = (request: string) => `User request:\n${request}`
const prefix = "You are a subagent spawned by another session.\n"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Tool = Extract<Assistant["content"][number], { type: "tool" }>
type Location = SessionInfo["location"]
type Call = { messageID: string; toolID: string; childID: string; prompt: string; agent: "planner" | "implementer_slot" }
type Child = { inputID: string; finalID: string; text: string }
type Bound = { parentID: string; userID: string; request: string; planner: Call; slot: Call; plannerChild: Child; slotChild: Child;
  parentHistory: string; plannerHistory: string; slotHistory: string }

function stop(message: string): never { throw new Error(`M2 binding failed: ${message}`) }
function plain(message: Extract<SessionMessageInfo, { type: "user" }>): boolean {
  return !message.files?.length && !message.agents?.length && !message.skills?.length
}
function sameLocation(session: SessionInfo, location: Location): boolean {
  return session.location.directory === location.directory
}
function requireActivationLocation(context: Context, location: Location): string {
  const current = context.location ?? context.data.location.default()
  if (current.directory !== location.directory || !location.directory) stop("TUI location changed")
  return location.directory
}
function requireDogfoodBaseline(directory: string, baseline: GitSnapshot): void {
  const current = observeGit(directory, baseline)
  if (JSON.stringify(current.paths) !== JSON.stringify(baseline.paths)) stop("dogfood worktree paths changed")
}
async function after<T>(generation: Generation, operation: Promise<T>): Promise<T> {
  const value = await operation
  assertLive(generation)
  return value
}
async function messages(context: Context, sessionID: string, generation: Generation): Promise<SessionMessageInfo[]> {
  const all: SessionMessageInfo[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await after(generation, context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }))
    all.push(...page.data)
    cursor = page.cursor.next ?? undefined
    if (cursor && seen.has(cursor)) stop("message pagination repeated a cursor")
    if (cursor) seen.add(cursor)
  } while (cursor)
  if (new Set(all.map((message) => message.id)).size !== all.length) stop("duplicate message ID")
  return all
}
async function idle(context: Context, sessionID: string, generation: Generation): Promise<void> {
  const [active, inbox] = await Promise.all([
    after(generation, context.client.session.active()),
    after(generation, context.client.session.inbox.list({ sessionID })),
  ])
  if (active[sessionID] || inbox.length) stop("session is running or has pending input")
}
function successful(session: SessionInfo, id: string, agent: string, location: Location, parentID?: string): void {
  if (session.id !== id || session.parentID !== parentID || session.fork || session.agent !== agent ||
      !sameLocation(session, location) || session.outcome !== "succeeded" || !session.time.idle ||
      (session.permissions?.length ?? 0) !== 0) stop(`unexpected ${agent} session identity, outcome, or permissions`)
}
function oneFinal(history: SessionMessageInfo[], agent: string): Assistant {
  const assistants = history.filter((message): message is Assistant => message.type === "assistant")
  const finals = assistants.filter((message) => message.finish === "stop")
  if (finals.length !== 1 || assistants.at(-1) !== finals[0] ||
      assistants.some((message) => message.agent !== agent || message.error)) {
    stop(`unexpected ${agent} assistant result`)
  }
  return finals[0]!
}
function finalText(message: Assistant): string {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("")
}
function completedCall(messageID: string, tool: Tool, agent: Call["agent"]): Call {
  if (tool.name !== "subagent" || tool.state.status !== "completed") stop("unexpected parent tool")
  const input = tool.state.input
  const keys = Object.keys(input).sort()
  if (JSON.stringify(keys) !== JSON.stringify(["agent", "description", "prompt"].sort()) ||
      input.agent !== agent || typeof input.description !== "string" || !input.description ||
      typeof input.prompt !== "string" || !input.prompt) stop("native subagent arguments differ from the fixed contract")
  const childID = tool.state.metadata?.sessionID
  if (typeof childID !== "string" || tool.state.metadata?.status !== "completed") stop("missing completed native child metadata")
  const expected = `<subagent sessionID="${childID}" state="completed">\n`
  if (tool.state.content.length !== 1 || tool.state.content[0]?.type !== "text" ||
      !tool.state.content[0].text.startsWith(expected) || !tool.state.content[0].text.endsWith("\n</subagent>")) {
    stop("native subagent result wrapper is malformed")
  }
  return { messageID, toolID: tool.id, childID, prompt: input.prompt, agent }
}
function parentCalls(history: SessionMessageInfo[], expectedUserID?: string): { userID: string; request: string; planner: Call; slot: Call } {
  const users = history.filter((message) => message.type === "user")
  if (users.length !== 1 || users[0]?.type !== "user" || history[0] !== users[0] || !plain(users[0]) || !users[0].text ||
      (expectedUserID !== undefined && users[0].id !== expectedUserID)) stop("parent does not have one exact plain user input")
  if (history.some((message) => !["user", "assistant", "idle"].includes(message.type))) stop("unexpected parent input or control message")
  const idles = history.filter((message) => message.type === "idle")
  if (idles.length !== 1 || idles[0]?.type !== "idle" || idles[0].outcome !== "succeeded") stop("parent did not complete one successful turn")
  const final = oneFinal(history, "opencode-agents")
  if (!finalText(final) || history.at(-1)?.type !== "idle") stop("parent final result is missing")
  const tools = history.flatMap((message) => message.type === "assistant"
    ? message.content.filter((part): part is Tool => part.type === "tool").map((part) => ({ messageID: message.id, part })) : [])
  if (tools.length !== 2 || tools[0]?.part.name !== "subagent" || tools[1]?.part.name !== "subagent" ||
      tools[0].part.id === tools[1].part.id) stop("parent did not make exactly two native subagent calls")
  const planner = completedCall(tools[0].messageID, tools[0].part, "planner")
  const slot = completedCall(tools[1].messageID, tools[1].part, "implementer_slot")
  if (planner.childID === slot.childID || planner.messageID === slot.messageID ||
      planner.prompt !== plannerInput(users[0].text) || slot.prompt !== SLOT_PROMPT) {
    stop("native child prompts or identities differ from contract")
  }
  return { userID: users[0].id, request: users[0].text, planner, slot }
}
function verifyChildHistory(history: SessionMessageInfo[], agent: Call["agent"], prompt: string): Child {
  const users = history.filter((message) => message.type === "user")
  if (users.length !== 1 || users[0]?.type !== "user" || history[0] !== users[0] || !plain(users[0]) || users[0].text !== prefix + prompt ||
      history.some((message) => !["user", "assistant", "idle"].includes(message.type))) stop(`unexpected ${agent} bootstrap input`)
  const idles = history.filter((message) => message.type === "idle")
  if (idles.length !== 1 || idles[0]?.type !== "idle" || idles[0].outcome !== "succeeded" || history.at(-1)?.type !== "idle") {
    stop(`unexpected ${agent} bootstrap completion`)
  }
  const final = oneFinal(history, agent)
  if (history.some((message) => message.type === "assistant" && message.content.some((part) =>
    part.type === "tool" && (agent === "implementer_slot" || !["read", "glob", "grep"].includes(part.name) || part.state.status !== "completed")))) {
    stop(`${agent} used a disallowed tool during bootstrap`)
  }
  const text = finalText(final)
  if (!text || (agent === "implementer_slot" && text !== "READY")) stop(`unexpected ${agent} final text`)
  return { inputID: users[0].id, finalID: final.id, text }
}
function resultMatches(history: SessionMessageInfo[], call: Call, child: Child): void {
  const message = history.find((item) => item.id === call.messageID)
  const tool = message?.type === "assistant" ? message.content.find((part) => part.type === "tool" && part.id === call.toolID) : undefined
  if (!tool || tool.type !== "tool" || tool.state.status !== "completed") stop("parent native call disappeared")
  const output = tool.state.content.map((part) => part.type === "text" ? part.text : "").join("")
  if (output !== `<subagent sessionID="${call.childID}" state="completed">\n${child.text}\n</subagent>`) {
    stop("parent native output differs from exact child result")
  }
}
async function bind(context: Context, generation: Generation, parentID: string, location: Location, expected?: Bound): Promise<Bound> {
  const parent = await after(generation, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "opencode-agents", location)
  await idle(context, parentID, generation)
  const parentHistory = await messages(context, parentID, generation)
  if (expected && JSON.stringify(parentHistory) !== expected.parentHistory) stop("parent transcript changed")
  const calls = parentCalls(parentHistory, expected?.userID)
  if (expected && (calls.request !== expected.request || JSON.stringify(calls.planner) !== JSON.stringify(expected.planner) ||
      JSON.stringify(calls.slot) !== JSON.stringify(expected.slot))) stop("parent native invocation changed")
  const children: Child[] = []
  const histories: string[] = []
  for (const call of [calls.planner, calls.slot]) {
    const session = await after(generation, context.client.session.get({ sessionID: call.childID }))
    successful(session, call.childID, call.agent, location, parentID)
    await idle(context, call.childID, generation)
    const childHistory = await messages(context, call.childID, generation)
    histories.push(JSON.stringify(childHistory))
    const child = verifyChildHistory(childHistory, call.agent, call.prompt)
    resultMatches(parentHistory, call, child)
    children.push(child)
  }
  const bound = { parentID, ...calls, plannerChild: children[0]!, slotChild: children[1]!,
    parentHistory: JSON.stringify(parentHistory), plannerHistory: histories[0]!, slotHistory: histories[1]! }
  if (expected && (JSON.stringify(bound.plannerChild) !== JSON.stringify(expected.plannerChild) ||
      JSON.stringify(bound.slotChild) !== JSON.stringify(expected.slotChild) ||
      bound.plannerHistory !== expected.plannerHistory || bound.slotHistory !== expected.slotHistory)) stop("native child transcript changed")
  return bound
}
async function verifyParentPlanner(context: Context, generation: Generation, bound: Bound, location: Location): Promise<void> {
  const parent = await after(generation, context.client.session.get({ sessionID: bound.parentID }))
  successful(parent, bound.parentID, "opencode-agents", location)
  await idle(context, bound.parentID, generation)
  const parentHistory = await messages(context, bound.parentID, generation)
  if (JSON.stringify(parentHistory) !== bound.parentHistory) stop("parent transcript changed after slot switch")
  const calls = parentCalls(parentHistory, bound.userID)
  if (JSON.stringify(calls.planner) !== JSON.stringify(bound.planner) ||
      JSON.stringify(calls.slot) !== JSON.stringify(bound.slot)) stop("parent call binding changed")
  const planner = await after(generation, context.client.session.get({ sessionID: bound.planner.childID }))
  successful(planner, bound.planner.childID, "planner", location, bound.parentID)
  await idle(context, bound.planner.childID, generation)
  const history = await messages(context, bound.planner.childID, generation)
  if (JSON.stringify(history) !== bound.plannerHistory) stop("Planner transcript changed after slot switch")
  const child = verifyChildHistory(history, "planner", bound.planner.prompt)
  if (JSON.stringify(child) !== JSON.stringify(bound.plannerChild)) stop("Planner result changed after slot switch")
  resultMatches(parentHistory, bound.planner, child)
  resultMatches(parentHistory, bound.slot, bound.slotChild)
}
async function switchedSlot(context: Context, generation: Generation, bound: Bound, location: Location, input?: { id: string; text: string }): Promise<void> {
  const session = await after(generation, context.client.session.get({ sessionID: bound.slot.childID }))
  successful(session, bound.slot.childID, "authorized_implementer", location, bound.parentID)
  await idle(context, bound.slot.childID, generation)
  const history = await messages(context, bound.slot.childID, generation)
  const switches = history.filter((message) => message.type === "agent-switched")
  if (switches.length !== 1 || switches[0]?.type !== "agent-switched" || switches[0].agent !== "authorized_implementer" ||
      switches[0].previous !== "implementer_slot") stop("slot role switch is missing or ambiguous")
  const before = history.slice(0, history.indexOf(switches[0]))
  if (JSON.stringify(before) !== bound.slotHistory) stop("slot bootstrap transcript changed")
  const bootstrap = verifyChildHistory(before, "implementer_slot", bound.slot.prompt)
  if (JSON.stringify(bootstrap) !== JSON.stringify(bound.slotChild)) stop("slot bootstrap changed")
  const afterSwitch = history.slice(history.indexOf(switches[0]) + 1)
  if (!input) {
    if (afterSwitch.length) stop("slot received input before trusted prompt")
    return
  }
  const users = afterSwitch.filter((message) => message.type === "user")
  const idles = afterSwitch.filter((message) => message.type === "idle")
  if (users.length !== 1 || users[0]?.type !== "user" || afterSwitch[0] !== users[0] ||
      users[0].id !== input.id || users[0].text !== input.text || !plain(users[0]) ||
      idles.length !== 1 || idles[0]?.type !== "idle" || idles[0].outcome !== "succeeded" || afterSwitch.at(-1)?.type !== "idle" ||
      afterSwitch.some((message) => !["user", "assistant", "idle"].includes(message.type))) stop("authorized slot input/result mismatch")
  const final = oneFinal(afterSwitch, "authorized_implementer")
  if (!finalText(final)) stop("authorized Implementer returned no text")
}

// Temporary live dogfood: this runs from the root execution-succeeded event, after the root turn returns.
export async function publishM2PlanDogfood(
  context: Context, generation: Generation, baseline: GitSnapshot, parentID: string, activationLocation: Location,
): Promise<{ candidate: IntentCandidate; planHash: string; syntheticID: string }> {
  assertLive(generation)
  if (generation.busy) throw new Error("Another CAP attempt is already running")
  generation.busy = true
  try {
    const directory = requireActivationLocation(context, activationLocation)
    if (realpathSync(directory) !== baseline.root) stop("worktree location changed")
    requireDogfoodBaseline(directory, baseline)
    await after(generation, context.client.session.wait({ sessionID: parentID }))
    const bound = await bind(context, generation, parentID, activationLocation)
    requireDogfoodBaseline(directory, baseline)
    const plan = bound.plannerChild.text
    const candidate = makeCandidate(parseProposal(plan, baseline.root), baseline.root, baseline.head)
    const planHash = createHash("sha256").update(plan).digest("hex").slice(0, 12)
    context.ui.toast.show({ title: "M2 plan dogfood", message: `Root turn returned; idle confirmed; Planner bound (${planHash}).`, sessionID: parentID })
    // bind() checked the parent has no active execution or pending input. Check once more at admission.
    await idle(context, parentID, generation)
    assertLive(generation)
    context.ui.toast.show({ title: "M2 plan dogfood", message: `Publishing synthetic plan ${planHash}.`, sessionID: parentID })
    const admitted = await after(generation, context.client.session.synthetic({
      sessionID: parentID, text: plan, description: plan, metadata: { source: "planner", planHash }, resume: false,
    }))
    if (admitted.type !== "synthetic" || admitted.sessionID !== parentID ||
        admitted.payload.text !== plan || admitted.payload.description !== plan) stop("synthetic admission changed Planner text")
    if ((await after(generation, context.client.session.active()))[parentID]) stop("root resumed immediately after synthetic admission")
    return { candidate, planHash, syntheticID: admitted.id }
  } finally {
    generation.busy = false
  }
}

export async function runM2(context: Context, generation: Generation, baseline: GitSnapshot, parentID: string, activationLocation: Location): Promise<string> {
  assertLive(generation)
  if (generation.busy) throw new Error("Another CAP attempt is already running")
  generation.busy = true
  try {
    const directory = requireActivationLocation(context, activationLocation)
    if (!directory || realpathSync(directory) !== baseline.root) stop("worktree location changed")
    requireFresh(observeGit(directory, baseline), baseline)
    await after(generation, context.client.session.wait({ sessionID: parentID }))
    const bound = await bind(context, generation, parentID, activationLocation)
    requireFresh(observeGit(directory, baseline), baseline)
    const candidate = makeCandidate(parseProposal(bound.plannerChild.text, baseline.root), baseline.root, baseline.head)
    const message = candidateMessage(candidate)
    if (!candidateFits(message, context.renderer.terminalWidth, context.renderer.terminalHeight)) {
      throw new Error("The full authorization candidate will not fit in this terminal")
    }
    const confirmation = context.ui.dialog.confirm({ title: "Authorize M2 implementation", message,
      label: { confirm: "Authorize", cancel: "Cancel" } })
    assertLive(generation)
    context.ui.dialog.set({ size: "xlarge" })
    const confirmed = await after(generation, confirmation)
    if (confirmed !== true) throw new Error("M2 authorization was cancelled or dismissed")
    requireActivationLocation(context, activationLocation)
    if (!candidateIntact(candidate) || !candidateFits(message, context.renderer.terminalWidth, context.renderer.terminalHeight)) {
      stop("candidate changed or became unreadable")
    }
    await bind(context, generation, parentID, activationLocation, bound)
    requireFresh(observeGit(directory, baseline), baseline)
    const grant = grantIntent(candidate, confirmed, generation)
    assertLive(generation)
    await after(generation, context.client.session.switchAgent({ sessionID: bound.slot.childID, agent: "authorized_implementer" }))
    await switchedSlot(context, generation, bound, activationLocation)
    await verifyParentPlanner(context, generation, bound, activationLocation)
    await switchedSlot(context, generation, bound, activationLocation)
    requireActivationLocation(context, activationLocation)
    requireFresh(observeGit(directory, baseline), baseline)
    const frozenText = implementerPrompt(candidate, "Milestone 2")
    assertLive(generation)
    consumeIntent(grant, candidate, generation)
    // One dispatch only. Any rejection here may follow host admission; never retry it.
    const returned = await after(generation, context.client.session.prompt({ sessionID: bound.slot.childID, text: frozenText }))
    if (returned.sessionID !== bound.slot.childID || returned.type !== "user" || returned.payload.text !== frozenText ||
        returned.payload.files?.length || returned.payload.agents?.length || returned.payload.skills?.length || !returned.id) {
      stop("trusted prompt returned an unexpected input")
    }
    await after(generation, context.client.session.wait({ sessionID: bound.slot.childID }))
    await switchedSlot(context, generation, bound, activationLocation, { id: returned.id, text: frozenText })
    const result = observeGit(directory, baseline)
    assertLive(generation)
    const paths = requireInScope(result, baseline, candidate.proposal.files)
    assertLive(generation)
    return `M2 implementation gate complete: HEAD ${baseline.head} unchanged. Resulting paths (${paths.length}): ${paths.join(", ") || "(none)"}. No review or commit was performed.`
  } finally {
    generation.busy = false
  }
}
