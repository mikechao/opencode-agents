import type { Context } from "@opencode/plugin/tui/context"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Content as ToolContent } from "@opencode/schema/tool"
import { Schema } from "effect"
import type { LocationRef, OpenCodeEvent, SessionInboxInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { randomUUID } from "node:crypto"
import { assertLive, exactKeys, frozenCopy, type Generation } from "./cap.ts"
import { observeGit, requireFresh, type GitSnapshot } from "./git.ts"
import { candidateIntact, makeCandidate, parseProposal, renderPlan } from "./proposal.ts"
import type { IntentCandidate } from "./proposal.ts"
import { authorizeRpc } from "./authorize-rpc.ts"
import { receiptInput } from "./receipt.ts"

export function implementerPrompt(candidate: IntentCandidate): string {
  return [
    "You are the Implementer for one authorized implementation attempt.",
    "Implement the frozen proposal below. Modify only its exact authorized repository paths; do not add, edit, or delete any other repository path.",
    "Do not intentionally perform Git commit or other history effects reserved for the trusted CAP path.",
    "Do not intentionally manipulate Git configuration, index metadata, ignore rules, repository metadata, or other shell-accessible state to conceal changes or evade ordinary Git changed-path scope observation.",
    "You may read, edit, test, and use ordinary development shell commands. Do not alter scope or seek another approval.",
    "The worktree was clean when the intent was authorized. Leave HEAD unchanged.",
    `Canonical worktree root: ${candidate.root}`,
    `Bound HEAD: ${candidate.head}`,
    "Frozen proposal:",
    JSON.stringify(candidate.proposal),
  ].join("\n")
}

// Fixed advisory planning guidance; this wrapper grants no authority.
export const plannerInput = (request: string) => `User request:\n${request}

Planning execution reminder:
Before launching Explorer work, identify useful independent investigations already apparent from the request.
Once multiple useful independent Explorer investigations are known, emit all corresponding \`subagent\` tool calls in the same assistant response before consuming any Explorer result.
Do not emit one known-independent Explorer call, wait for its result, and then emit another already-known independent call.`
export const plannerReceiptKey = "opencodeAgentsPlannerInput"
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
export const plannerReceipt = (userID: string, description: string, request: string, turn: PlannerTurn) => ({
  userID,
  input: { agent: "planner" as const, description, prompt: plannerInput(request) },
  turn,
})
function effectivePlannerReceipt(
  value: unknown,
  userID: string,
  request: string,
  proposed: ReturnType<typeof plannerArguments>,
  turn: PlannerTurn,
) {
  if (!exactKeys(value, ["userID", "input", "turn"])) stop("missing or malformed trusted Planner input receipt")
  plannerArguments(value.input)
  const expected = plannerReceipt(userID, proposed.description, request, turn)
  if (!same(value, expected)) stop("trusted Planner input receipt differs from the root request")
  return expected
}
// Pinned native bootstrap; authorized payload remains exact.
export const nativeBootstrap = (prompt: string): string => `You are a subagent spawned by another session.\n${prompt}`

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Location = SessionInfo["location"]
// OpenCode's TUI supplies reactive location info, including project metadata.
// Retain only Location.Ref's primitive identity fields, never the host proxy.
export function snapshotLocation(location: LocationRef): Readonly<LocationRef> {
  const { directory, workspaceID } = location
  return Object.freeze({ directory, ...(workspaceID === undefined ? {} : { workspaceID }) })
}
type Call = Readonly<{
  messageID: string
  toolID: string
  childID: string
  proposed: Readonly<ReturnType<typeof plannerArguments>>
  effective: Readonly<ReturnType<typeof plannerReceipt>>
}>
type Child = Readonly<{ inputID: string; finalID: string; text: string }>
export type Bound = Readonly<{
  parentID: string
  userID: string
  request: string
  planner: Call
  plannerChild: Child
  parentCreatedAt: number
  terminalIdleID: string
}>

type Created = Extract<OpenCodeEvent, { type: "session.created" }>
type Synthetic = Extract<SessionInboxInfo, { type: "synthetic" }>
// Runtime copying/freezing is recursive; metadata types can themselves be recursive JSON.
type Frozen<T> = Readonly<T>

export type ActivationEvidence = Readonly<{
  generation: Generation
  location: Readonly<Location>
  baseline: GitSnapshot
  observationCompletedAt: number
  creation: Frozen<Created>
}>
export type PublishedAttempt = Readonly<{
  activation: ActivationEvidence
  bound: Bound
  candidate: IntentCandidate
  publication: Frozen<Synthetic>
}>
// Attempt-side checks carry no publication bookkeeping or authority.
export interface AttemptGuard {
  assertCurrent(): void
}

export type ExpectedPublication = Readonly<Pick<Synthetic, "id" | "payload">>
export interface PublicationOwner extends AttemptGuard {
  // Synchronous: the host can notify inside synthetic(), before its promise settles.
  expectPublication(bound: Bound, expected: ExpectedPublication): void
}

export interface DecisionOwner extends AttemptGuard {
  assertDecision(published: PublishedAttempt): void
  transfer(): void
}

export function activationEvidence(
  generation: Generation,
  location: Location,
  baseline: GitSnapshot,
  observationCompletedAt: number,
  creation: Created,
): ActivationEvidence {
  return Object.freeze({
    generation,
    location: frozenCopy(location),
    baseline: frozenCopy(baseline),
    observationCompletedAt,
    creation: frozenCopy(creation),
  })
}
export function initiallyAuthorizable(activation: ActivationEvidence): boolean {
  const { creation, baseline, observationCompletedAt } = activation
  return (
    baseline.paths.length === 0 &&
    Number.isFinite(observationCompletedAt) &&
    Number.isFinite(creation.created) &&
    creation.created > observationCompletedAt &&
    creation.data.agent === "orchestrator" &&
    !creation.data.parentID &&
    sameLocation(creation.data.location, activation.location)
  )
}
// Canonical JSON comparisons preserve every JSON field and array position, not key insertion order.
export function exactEvidence(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
}
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
function sameLocation(current: LocationRef, location: LocationRef): boolean {
  return same(snapshotLocation(current), location)
}
function requireActivationLocation(context: Context, location: Location): string {
  const current = snapshotLocation(context.location ?? context.data.location.default())
  if (!same(current, location) || !location.directory) stop("TUI location changed")
  return location.directory
}
async function after<T>(check: () => void, operation: Promise<T>): Promise<T> {
  const value = await operation
  check()
  return value
}
function checks(context: Context, activation: ActivationEvidence, guard: AttemptGuard): () => void {
  return () => {
    assertLive(activation.generation)
    guard.assertCurrent()
    requireActivationLocation(context, activation.location)
    guard.assertCurrent()
    assertLive(activation.generation)
  }
}
async function messages(context: Context, sessionID: string, check: () => void): Promise<SessionMessageInfo[]> {
  const all: SessionMessageInfo[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await after(
      check,
      context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }),
    )
    all.push(...page.data)
    cursor = page.cursor.next ?? undefined
    if (cursor && seen.has(cursor)) stop("message pagination repeated a cursor")
    if (cursor) seen.add(cursor)
  } while (cursor)
  if (new Set(all.map((message) => message.id)).size !== all.length) stop("duplicate message ID")
  return all
}
async function idle(context: Context, sessionID: string, check: () => void): Promise<void> {
  const [active, inbox] = await Promise.all([
    after(check, context.client.session.active()),
    after(check, context.client.session.inbox.list({ sessionID })),
  ])
  if (active[sessionID] || inbox.length) stop("session is running or has pending input")
}
function successful(session: SessionInfo, id: string, agent: string, location: Location, parentID?: string): void {
  if (
    session.id !== id ||
    session.parentID !== parentID ||
    session.fork ||
    session.revert ||
    session.time.archived ||
    session.agent !== agent ||
    !sameLocation(session.location, location) ||
    session.outcome !== "succeeded" ||
    !session.time.idle ||
    !Number.isFinite(session.time.created) ||
    !empty(session.permissions)
  )
    stop(`unexpected ${agent} session identity, outcome, or permissions`)
}
function oneFinal(history: SessionMessageInfo[], agent: string): Assistant {
  const assistants = history.filter((message): message is Assistant => message.type === "assistant")
  const final = assistants.at(-1)
  if (!final || final.finish !== "stop" || assistants.some((message) => message.agent !== agent || message.error)) {
    stop(`unexpected ${agent} assistant result`)
  }
  return final
}
function finalText(message: Assistant): string {
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
}
// Both the server's decoded schema and the TUI's encoded API expose these
// structural fields. No timestamps or model representations bind authority.
type RootMessage = SessionMessageInfo | SessionMessage.Info
type RootTool = Extract<Extract<RootMessage, { type: "assistant" }>["content"][number], { type: "tool" }>
export const directRootTool = (name: string): boolean => ["read", "glob", "grep"].includes(name)
// Failed local calls without trusted execution evidence created no authority.
// Completed mutation-capable calls and any admitted Planner metadata fail closed.
function nonGovernedTool(part: RootTool): boolean {
  if (part.state.status !== "completed" && part.state.status !== "error") return false
  const metadata = part.state.metadata
  if (metadata && (plannerReceiptKey in metadata || "sessionID" in metadata)) return false
  return directRootTool(part.name) || part.state.status === "error"
}
export function nativeReadInstruction(message: RootMessage): boolean {
  if (message.type !== "synthetic" || !message.text.trim() || !exactKeys(message.metadata, ["instruction"]))
    return false
  const instruction = message.metadata.instruction
  return (
    exactKeys(instruction, ["paths"]) &&
    Array.isArray(instruction.paths) &&
    instruction.paths.length > 0 &&
    instruction.paths.every((item) => typeof item === "string" && item.startsWith("/")) &&
    new Set(instruction.paths).size === instruction.paths.length
  )
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
function rootSegment(history: readonly RootMessage[], terminalIdleID?: string) {
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
  for (let index = 0; index < end - (terminalIdleID === undefined ? 0 : 1); index++) {
    const message = history[index]!
    if (message.type !== "idle") continue
    if (message.outcome !== "succeeded") stop("earlier root turn did not succeed")
    nonGovernedTurn(history.slice(start, index + 1))
    start = index + 1
    precedingIdleID = message.id
  }
  return { segment: history.slice(start, end), precedingIdleID, end }
}
function governedTurn(
  history: readonly RootMessage[],
  terminalIdleID?: string,
  invocation?: { messageID: string; id: string },
) {
  const { segment, precedingIdleID, end } = rootSegment(history, terminalIdleID)
  const user = rootUser(segment)
  if (segment.some((message) => !["user", "assistant", "idle", "model-switched"].includes(message.type)))
    stop("unexpected parent input or control message")
  const tools = rootTools(segment).filter(
    ({ messageID, part }) =>
      (invocation && messageID === invocation.messageID && part.id === invocation.id) || !nonGovernedTool(part),
  )
  const call = tools[0]
  if (tools.length !== 1 || !call || call.part.name !== "subagent")
    stop("parent did not make exactly one native Planner call")
  const proposed = plannerArguments(call.part.state.input)
  const turn = { precedingIdleID, messageID: call.messageID, toolID: call.part.id }
  if (end !== history.length) stop("new input follows governed completion")
  return { user, call, proposed, turn, segment }
}
export function plannerTurnInput(history: readonly RootMessage[], invocation: { messageID: string; id: string }) {
  const { user, call, proposed, turn } = governedTurn(history, undefined, invocation)
  if (call.messageID !== invocation.messageID || call.part.id !== invocation.id || call.part.state.status !== "running")
    stop("Planner native contender identity changed")
  return { proposed, effective: plannerReceipt(user.id, proposed.description, user.text, turn) }
}
function parentCalls(history: SessionMessageInfo[], terminalIdleID: string) {
  const { user, call, proposed, turn, segment } = governedTurn(history, terminalIdleID)
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
  )
  return {
    userID: user.id,
    request: user.text,
    planner: { messageID: call.messageID, toolID: tool.id, childID, proposed, effective },
    terminalIdleID,
  }
}
export function inspectCompletedRootTurn(
  history: SessionMessageInfo[],
  terminalIdleID: string,
): { kind: "non-governed" } | { kind: "governed"; terminalIdleID: string } | { kind: "invalid"; reason: string } {
  try {
    const { segment } = rootSegment(history, terminalIdleID)
    if (rootTools(segment).some(({ part }) => !nonGovernedTool(part))) {
      parentCalls(history, terminalIdleID)
      return { kind: "governed", terminalIdleID }
    }
    nonGovernedTurn(segment)
    return { kind: "non-governed" }
  } catch (error) {
    return { kind: "invalid", reason: error instanceof Error ? error.message : String(error) }
  }
}
export async function inspectRootCompletion(
  context: Context,
  activation: ActivationEvidence,
  guard: AttemptGuard,
  terminalIdleID: string,
) {
  const check = checks(context, activation, guard)
  check()
  return inspectCompletedRootTurn(await messages(context, activation.creation.data.sessionID, check), terminalIdleID)
}
// Native permissions govern observations; history binds supported input and final output.
function verifyChildHistory(history: SessionMessageInfo[], agent: "planner" | "explorer", prompt: string): Child {
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
// Complete native topology observations are transient verification evidence.
// Do not filter by location: that could hide an unexpectedly moved child.
async function children(context: Context, parentID: string, check: () => void): Promise<Set<string>> {
  const ids = new Set<string>()
  const cursors = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await after(
      check,
      context.client.session.list({ parentID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }),
    )
    for (const child of page.data) {
      if (typeof child.id !== "string" || !child.id.trim() || child.parentID !== parentID || ids.has(child.id))
        stop("unexpected or duplicate child session")
      ids.add(child.id)
    }
    cursor = page.cursor.next ?? undefined
    if (cursor && cursors.has(cursor)) stop("child pagination repeated a cursor")
    if (cursor) cursors.add(cursor)
  } while (cursor)
  return ids
}
async function verifyPlannerHistory(
  context: Context,
  check: () => void,
  planner: SessionInfo,
  prompt: string,
): Promise<Child> {
  const history = await messages(context, planner.id, check)
  const result = verifyChildHistory(history, "planner", prompt)
  const tools = history.flatMap((message) =>
    message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
  )
  // Only delegation identities must be unambiguous; observation IDs are not certified.
  const toolIDs = new Map<string, number>()
  for (const tool of tools) toolIDs.set(tool.id, (toolIDs.get(tool.id) ?? 0) + 1)
  const explorerIDs = new Set<string>()
  const explorers: { id: string; prompt: string }[] = []
  for (const tool of tools) {
    if (tool.name !== "subagent") continue
    if (typeof tool.id !== "string" || !tool.id.trim() || toolIDs.get(tool.id) !== 1)
      stop("duplicate or missing Explorer call ID")
    if (tool.executed === true) stop("nonlocal Explorer call")
    if (tool.state.status !== "completed") stop("incomplete Explorer call")
    const input = tool.state.input
    if (
      !exactKeys(input, ["agent", "description", "prompt"]) ||
      input.agent !== "explorer" ||
      typeof input.description !== "string" ||
      !input.description.trim() ||
      typeof input.prompt !== "string" ||
      !input.prompt.trim()
    )
      stop("unexpected Explorer call input")
    const childID = tool.state.metadata?.sessionID
    if (
      typeof childID !== "string" ||
      !childID.trim() ||
      tool.state.metadata?.status !== "completed" ||
      !Array.isArray(tool.state.content) ||
      !tool.state.content.every(Schema.is(ToolContent)) ||
      !tool.state.content.some((part) => part?.type === "text" && typeof part.text === "string" && part.text.trim())
    )
      stop("missing completed Explorer result")
    if (childID === planner.id || childID === planner.parentID || explorerIDs.has(childID))
      stop("Explorer is not a unique fresh child")
    explorerIDs.add(childID)
    explorers.push({ id: childID, prompt: input.prompt })
  }
  // Advisory provenance is observed once when accepting this planning execution.
  // Later child activity cannot rewrite the completed tool result in Planner history.
  for (const child of explorers) {
    const explorer = await after(check, context.client.session.get({ sessionID: child.id }))
    successful(explorer, child.id, "explorer", planner.location, planner.id)
    await idle(context, child.id, check)
    verifyChildHistory(await messages(context, child.id, check), "explorer", child.prompt)
    if ((await children(context, child.id, check)).size) stop("Explorer has unexpected descendants")
  }
  const actual = await children(context, planner.id, check)
  if (actual.size !== explorerIDs.size || [...actual].some((id) => !explorerIDs.has(id)))
    stop("Planner children differ from completed Explorer calls")
  return result // Only the existing exact final Planner binding becomes authority.
}
async function bindNativeAttempt(
  context: Context,
  check: () => void,
  parentID: string,
  location: Location,
  terminalIdleID: string,
): Promise<Bound> {
  const parent = await after(check, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "orchestrator", location)
  await idle(context, parentID, check)
  const parentHistory = await messages(context, parentID, check)
  const calls = parentCalls(parentHistory, terminalIdleID)
  if (calls.planner.childID === parentID) stop("Planner is not a fresh child")
  const planner = await after(check, context.client.session.get({ sessionID: calls.planner.childID }))
  successful(planner, calls.planner.childID, "planner", location, parentID)
  await idle(context, planner.id, check)
  const plannerChild = await verifyPlannerHistory(context, check, planner, calls.planner.effective.input.prompt)
  return frozenCopy({ parentID, ...calls, plannerChild, parentCreatedAt: parent.time.created })
}
function checkedPublication(
  publication: Synthetic | Frozen<Synthetic>,
  bound: Bound,
  candidate: IntentCandidate,
): void {
  if (
    !publication.id ||
    publication.type !== "synthetic" ||
    publication.sessionID !== bound.parentID ||
    publication.delivery !== "steer" ||
    publication.payload.text !== bound.plannerChild.text ||
    publication.payload.description !== renderPlan(candidate) ||
    publication.payload.metadata?.source !== "planner"
  ) {
    stop("synthetic admission changed Planner text, description, or admission evidence")
  }
}
export function assertPublishedCoherence(published: PublishedAttempt): void {
  const { activation, bound, candidate, publication } = published
  if (
    bound.parentID !== activation.creation.data.sessionID ||
    (Number.isFinite(activation.creation.created) && bound.parentCreatedAt !== activation.creation.created) ||
    !same(
      bound.planner.effective,
      plannerReceipt(bound.userID, bound.planner.proposed.description, bound.request, {
        precedingIdleID: bound.planner.effective.turn.precedingIdleID,
        messageID: bound.planner.messageID,
        toolID: bound.planner.toolID,
      }),
    ) ||
    !candidateIntact(candidate) ||
    candidate.root !== activation.baseline.root ||
    candidate.head !== activation.baseline.head ||
    !same(JSON.parse(bound.plannerChild.text), candidate.proposal)
  )
    stop("retained candidate or root creation evidence is incoherent")
  checkedPublication(publication, bound, candidate)
}
export function publishedPresentationMatches(context: Context, published: PublishedAttempt): boolean {
  const { bound, publication } = published
  const visible = context.data.session.message.list(bound.parentID).filter((message) => message.id === publication.id)
  const pending = context.data.session.pending.list(bound.parentID)
  return (
    visible.length === 1 &&
    visible[0]?.type === "synthetic" &&
    visible[0].text === publication.payload.text &&
    visible[0].description === publication.payload.description &&
    visible[0].metadata?.source === "planner" &&
    pending.length === 1 &&
    publicationMatches(pending[0], published)
  )
}
function publicationMatches(item: SessionInboxInfo | undefined, published: PublishedAttempt): boolean {
  if (!item || item.id !== published.publication.id || item.type !== "synthetic") return false
  try {
    checkedPublication(item, published.bound, published.candidate)
    return true
  } catch {
    return false
  }
}
async function verifyParentPlanner(context: Context, published: PublishedAttempt, check: () => void): Promise<void> {
  const { bound, activation } = published
  const parent = await after(check, context.client.session.get({ sessionID: bound.parentID }))
  successful(parent, bound.parentID, "orchestrator", activation.location)
  if (parent.time.created !== bound.parentCreatedAt) stop("root creation identity changed")
  const active = await after(check, context.client.session.active())
  const inbox = await after(check, context.client.session.inbox.list({ sessionID: bound.parentID }))
  if (active[bound.parentID] || inbox.length !== 1 || !publicationMatches(inbox[0], published))
    stop("root is running or pending publication changed")
  const parentHistory = await messages(context, bound.parentID, check)
  const calls = parentCalls(parentHistory, bound.terminalIdleID)
  if (
    !same(calls, {
      userID: bound.userID,
      request: bound.request,
      planner: bound.planner,
      terminalIdleID: bound.terminalIdleID,
    })
  )
    stop("parent call binding changed")
  const planner = await after(check, context.client.session.get({ sessionID: bound.planner.childID }))
  successful(planner, bound.planner.childID, "planner", activation.location, bound.parentID)
  await idle(context, bound.planner.childID, check)
  // Publication binds the exact Planner proposal. Explorer sessions are no longer
  // authority; revalidate the existing root/Planner binding without reopening them.
  const child = verifyChildHistory(
    await messages(context, planner.id, check),
    "planner",
    bound.planner.effective.input.prompt,
  )
  if (!same(child, bound.plannerChild)) stop("Planner result changed")
}
function observePublication(activation: ActivationEvidence): void {
  const current = observeGit(activation.location.directory!, activation.baseline)
  if (!same(current.paths, activation.baseline.paths)) stop("publication worktree paths changed")
}
export async function verifyPublishedAttempt(
  context: Context,
  published: PublishedAttempt,
  guard: AttemptGuard,
): Promise<void> {
  assertPublishedCoherence(published)
  const check = checks(context, published.activation, guard)
  check()
  await verifyParentPlanner(context, published, check)
  observePublication(published.activation)
  check()
}

// One publication per root attempt; no implementation authority is created here.
export async function publishPlan(
  context: Context,
  activation: ActivationEvidence,
  guard: PublicationOwner,
  terminalIdleID: string,
): Promise<PublishedAttempt> {
  const { generation, baseline, location, creation } = activation
  const parentID = creation.data.sessionID
  assertLive(generation)
  if (generation.busy) stop("another CAP attempt is already running")
  generation.busy = true
  const check = checks(context, activation, guard)
  try {
    check()
    observePublication(activation)
    await after(check, context.client.session.wait({ sessionID: parentID }))
    const bound = await bindNativeAttempt(context, check, parentID, location, terminalIdleID)
    if (Number.isFinite(creation.created) && bound.parentCreatedAt !== creation.created)
      stop("root creation evidence changed")
    const candidate = makeCandidate(parseProposal(bound.plannerChild.text, baseline.root), baseline.root, baseline.head)
    const expected = frozenCopy({
      id: `msg_${randomUUID()}`,
      payload: {
        text: bound.plannerChild.text,
        description: renderPlan(candidate),
        metadata: { source: "planner" },
      },
    })
    // Binding and candidate construction have no intervening await. Record the
    // established binding and publication expectation together in their owner.
    guard.expectPublication(bound, expected)
    check()
    observePublication(activation)
    const admitted = await after(
      check,
      context.client.session.synthetic({
        sessionID: parentID,
        id: expected.id,
        ...expected.payload,
        delivery: "steer",
        resume: false,
      }),
    )
    checkedPublication(admitted, bound, candidate)
    if (admitted.id !== expected.id) stop("synthetic admission identity changed")
    const published = Object.freeze({ activation, bound, candidate, publication: frozenCopy(admitted) })
    await verifyPublishedAttempt(context, published, guard)
    // Hydration supplies presentation only. Failure never retries the publication.
    context.data.session.pending.invalidate(parentID)
    await after(check, context.data.session.pending.sync(parentID))
    context.data.session.message.invalidate(parentID)
    await after(check, context.data.session.message.sync(parentID))
    if (!publishedPresentationMatches(context, published)) stop("published Plan is unavailable or changed in the TUI")
    observePublication(activation)
    check()
    return published
  } finally {
    generation.busy = false
  }
}

// The positive readable-frame callback is the only TUI caller of this transport.
// The server owns the attempt after transfer; transport ambiguity never retries.
export async function authorizePublishedAttempt(
  context: Context,
  published: PublishedAttempt,
  owner: DecisionOwner,
): Promise<string> {
  const { activation } = published
  assertLive(activation.generation)
  owner.assertDecision(published)
  if (!initiallyAuthorizable(activation)) stop("initial clean-before-bootstrap evidence is unavailable")
  if (activation.generation.busy) stop("another CAP attempt is already running")
  activation.generation.busy = true
  try {
    await verifyPublishedAttempt(context, published, owner)
    if (!publishedPresentationMatches(context, published)) stop("published Plan view changed")
    checks(context, activation, owner)()
    requireFresh(observeGit(activation.location.directory!, activation.baseline), activation.baseline)
    owner.assertDecision(published)
    owner.transfer()
    const outcome = await context.client.rpc(authorizeRpc).authorize(
      {
        purpose: "implement",
        candidate: published.candidate,
        rootSessionID: published.bound.parentID,
        location: activation.location,
        publicationID: published.publication.id,
      },
      { location: activation.location },
    )
    if (typeof outcome !== "string") stop("Authorize RPC returned an invalid outcome")
    return outcome
  } finally {
    activation.generation.busy = false
  }
}

// The decision owner has already closed. Waiting never wakes or retries work;
// a failed settlement read must not inject a receipt into an active execution.
export async function publishTerminalReceipt(context: Context, rootSessionID: string, receipt: string): Promise<void> {
  await context.client.session.wait({ sessionID: rootSessionID })
  await context.client.session.synthetic(receiptInput(rootSessionID, receipt))
}
