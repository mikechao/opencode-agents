import type { Context } from "@opencode/plugin/tui/context"
import type { LocationRef, OpenCodeEvent, SessionInboxInfo, SessionInfo, SessionMessageInfo, AgentInfo, ModelRef } from "@opencode/client"
import { createHash, randomUUID } from "node:crypto"
import { assertLive, type Generation } from "./cap.ts"
import { observeGit, requireFresh, requireInScope, type GitSnapshot } from "./git.ts"
import { candidateIntact, makeCandidate, parseProposal, renderPlan } from "./proposal.ts"
import type { IntentCandidate } from "./proposal.ts"
import { authorizeRpc } from "./authorize-rpc.ts"

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

export const plannerInput = (request: string) => `User request:\n${request}`
const prefix = "You are a subagent spawned by another session.\n"

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Tool = Extract<Assistant["content"][number], { type: "tool" }>
type Location = SessionInfo["location"]
// OpenCode's TUI supplies reactive location info, including project metadata.
// Retain only Location.Ref's primitive identity fields, never the host proxy.
export function snapshotLocation(location: LocationRef): Readonly<LocationRef> {
  const { directory, workspaceID } = location
  return Object.freeze({ directory, ...(workspaceID === undefined ? {} : { workspaceID }) })
}
type Call = Readonly<{ messageID: string; toolID: string; childID: string; prompt: string; agent: "planner" }>
type Child = Readonly<{ inputID: string; finalID: string; text: string }>
export type Bound = Readonly<{ parentID: string; userID: string; request: string; planner: Call; plannerChild: Child;
  parentHistory: string; plannerHistory: string; parentCreatedAt: number; plannerCreatedAt: number;
  model: Readonly<Required<ModelRef>>; projectID: string; subpath?: string; metadata?: SessionInfo["metadata"] }>

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
// These are operation expectations and local lifetime checks, never authority flags.
// The TUI setup closure owns this object and its pending/claimed identity.
export interface AttemptGuard {
  assertCurrent(): void
  bound?: Bound
  publishing?: Readonly<{ id: string; text: string; description: string; metadata: { source: string; planHash: string } }>
  publication?: Frozen<Synthetic>
}

export interface DecisionOwner extends AttemptGuard {
  assertDecision(published: PublishedAttempt): void
  transfer(): void
}

function immutable<T>(value: T): Frozen<T> {
  const copy = structuredClone(value)
  function freeze(item: unknown): void {
    if (item && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child)
      Object.freeze(item)
    }
  }
  freeze(copy)
  return copy as Frozen<T>
}
export function activationEvidence(
  generation: Generation, location: Location, baseline: GitSnapshot, observationCompletedAt: number, creation: Created,
): ActivationEvidence {
  return Object.freeze({ generation, location: immutable(location), baseline: immutable(baseline),
    observationCompletedAt, creation: immutable(creation) })
}
export function initiallyAuthorizable(activation: ActivationEvidence): boolean {
  const { creation, baseline, observationCompletedAt } = activation
  return baseline.paths.length === 0 && Number.isFinite(observationCompletedAt) && Number.isFinite(creation.created) &&
    creation.created > observationCompletedAt && creation.data.agent === "orchestrator" && !creation.data.parentID &&
    sameLocation({ location: creation.data.location } as SessionInfo, activation.location)
}
// Canonical JSON comparisons preserve every JSON field and array position, not key insertion order.
export function exactEvidence(value: unknown): string {
  return JSON.stringify(value, (_, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item)
}
function same(a: unknown, b: unknown): boolean { return exactEvidence(a) === exactEvidence(b) }
function keys(value: object, expected: string[]): boolean { return same(Object.keys(value).sort(), expected.sort()) }

function stop(message: string): never { throw new Error(`Attempt binding failed: ${message}`) }
function empty(value: unknown): boolean { return value === undefined || (Array.isArray(value) && value.length === 0) }
function plain(message: Pick<Extract<SessionMessageInfo, { type: "user" }>, "files" | "agents" | "skills">): boolean {
  return empty(message.files) && empty(message.agents) && empty(message.skills)
}
function sameLocation(session: SessionInfo, location: Location): boolean {
  return same(session.location, location)
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
function checks(context: Context, activation: ActivationEvidence, guard: AttemptGuard, policy: "publication" | "clean" | "implemented"): () => void {
  return () => {
    assertLive(activation.generation)
    guard.assertCurrent()
    const directory = requireActivationLocation(context, activation.location)
    const current = observeGit(directory, activation.baseline)
    if (policy === "clean") requireFresh(current, activation.baseline)
    else if (policy === "publication" && !same(current.paths, activation.baseline.paths)) stop("publication worktree paths changed")
    guard.assertCurrent()
    assertLive(activation.generation)
  }
}
async function messages(context: Context, sessionID: string, check: () => void): Promise<SessionMessageInfo[]> {
  const all: SessionMessageInfo[] = []
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await after(check, context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }))
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
  if (session.id !== id || session.parentID !== parentID || session.fork || session.revert || session.time.archived || session.agent !== agent ||
      !sameLocation(session, location) || session.outcome !== "succeeded" || !session.time.idle || !Number.isFinite(session.time.created) ||
      !empty(session.permissions)) stop(`unexpected ${agent} session identity, outcome, or permissions`)
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
function parentCalls(history: SessionMessageInfo[], expectedUserID?: string): { userID: string; request: string; planner: Call } {
  const users = history.filter((message) => message.type === "user")
  if (users.length !== 1 || users[0]?.type !== "user" || history[0] !== users[0] || !plain(users[0]) || !users[0].text ||
      (expectedUserID !== undefined && users[0].id !== expectedUserID)) stop("parent does not have one exact plain user input")
  if (history.some((message) => !["user", "assistant", "idle"].includes(message.type))) stop("unexpected parent input or control message")
  const idles = history.filter((message) => message.type === "idle")
  if (idles.length !== 1 || idles[0]?.type !== "idle" || idles[0].outcome !== "succeeded") stop("parent did not complete one successful turn")
  const final = oneFinal(history, "orchestrator")
  if (!finalText(final) || history.at(-1)?.type !== "idle") stop("parent final result is missing")
  const tools = history.flatMap((message) => message.type === "assistant"
    ? message.content.filter((part): part is Tool => part.type === "tool").map((part) => ({ messageID: message.id, part })) : [])
  if (tools.length !== 1 || tools[0]?.part.name !== "subagent") stop("parent did not make exactly one native Planner call")
  const planner = completedCall(tools[0].messageID, tools[0].part, "planner")
  if (planner.prompt !== plannerInput(users[0].text)) stop("native Planner prompt or identity differs from contract")
  return { userID: users[0].id, request: users[0].text, planner }
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
    part.type === "tool" && (!["read", "glob", "grep"].includes(part.name) || part.state.status !== "completed")))) {
    stop(`${agent} used a disallowed tool during bootstrap`)
  }
  const text = finalText(final)
  if (!text) stop(`unexpected ${agent} final text`)
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
function selectedModel(model: ModelRef | undefined): Readonly<Required<ModelRef>> {
  if (!model || typeof model.providerID !== "string" || !model.providerID || typeof model.id !== "string" || !model.id ||
      (model.variant !== undefined && (typeof model.variant !== "string" || !model.variant))) stop("explicit root-selected model evidence is missing")
  return immutable({ providerID: model.providerID, id: model.id, variant: model.variant ?? "default" })
}
function executionModel(history: SessionMessageInfo[], model: Readonly<Required<ModelRef>>): void {
  if (history.some((message) => message.type === "assistant" && !same(selectedModel(message.model), model))) stop("assistant execution model differs from frozen root model")
}
function rootEvidence(parent: SessionInfo, bound: Bound): void {
  if (!same(selectedModel(parent.model), bound.model) || parent.projectID !== bound.projectID || parent.subpath !== bound.subpath ||
      !same(parent.metadata, bound.metadata)) stop("root model, project, subpath, or metadata changed")
}
async function bindNativeAttempt(context: Context, check: () => void, parentID: string, location: Location, expected?: Bound): Promise<Bound> {
  const parent = await after(check, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "orchestrator", location)
  const model = selectedModel(parent.model)
  if (!parent.projectID) stop("root project identity missing")
  if (expected) rootEvidence(parent, expected)
  await idle(context, parentID, check)
  const parentHistory = await messages(context, parentID, check)
  executionModel(parentHistory, model)
  if (expected && JSON.stringify(parentHistory) !== expected.parentHistory) stop("parent transcript changed")
  const calls = parentCalls(parentHistory, expected?.userID)
  if (calls.planner.childID === parentID) stop("Planner is not a fresh child")
  const planner = await after(check, context.client.session.get({ sessionID: calls.planner.childID }))
  successful(planner, calls.planner.childID, "planner", location, parentID)
  if (planner.projectID !== parent.projectID || planner.subpath !== parent.subpath) stop("Planner project or subpath changed")
  await idle(context, planner.id, check)
  const history = await messages(context, planner.id, check)
  const plannerChild = verifyChildHistory(history, "planner", calls.planner.prompt)
  resultMatches(parentHistory, calls.planner, plannerChild)
  const bound = { parentID, ...calls, plannerChild, parentHistory: JSON.stringify(parentHistory), plannerHistory: JSON.stringify(history),
    parentCreatedAt: parent.time.created, plannerCreatedAt: planner.time.created, model, projectID: parent.projectID,
    ...(parent.subpath === undefined ? {} : { subpath: parent.subpath }), ...(parent.metadata === undefined ? {} : { metadata: parent.metadata }) }
  if (expected && !same(bound, expected)) stop("native child transcript changed")
  return immutable(bound)
}
function checkedPublication(publication: Synthetic | Frozen<Synthetic>, bound: Bound, candidate: IntentCandidate): void {
  const planHash = createHash("sha256").update(bound.plannerChild.text).digest("hex").slice(0, 12)
  if (!keys(publication, ["id", "sessionID", "time", "type", "payload", "delivery"]) ||
      !publication.id || publication.type !== "synthetic" || publication.sessionID !== bound.parentID ||
      publication.delivery !== "steer" || !keys(publication.time, ["created"]) || !Number.isFinite(publication.time.created) ||
      !keys(publication.payload, ["text", "description", "metadata"]) ||
      publication.payload.text !== bound.plannerChild.text || publication.payload.description !== renderPlan(candidate) ||
      !same(publication.payload.metadata, { source: "planner", planHash })) stop("synthetic admission changed Planner text, description, or admission evidence")
}
export function assertPublishedCoherence(published: PublishedAttempt): void {
  const { activation, bound, candidate, publication } = published
  const h0: SessionMessageInfo[] = JSON.parse(bound.parentHistory)
  const calls = parentCalls(h0, bound.userID)
  if (!same(calls, { userID: bound.userID, request: bound.request, planner: bound.planner }) ||
      !same(verifyChildHistory(JSON.parse(bound.plannerHistory), "planner", bound.planner.prompt), bound.plannerChild)) stop("retained native evidence is incoherent")
  resultMatches(h0, bound.planner, bound.plannerChild)
  executionModel(h0, bound.model)
  if (bound.parentID !== activation.creation.data.sessionID ||
      (Number.isFinite(activation.creation.created) && bound.parentCreatedAt !== activation.creation.created) ||
      !candidateIntact(candidate) || candidate.root !== activation.baseline.root || candidate.head !== activation.baseline.head ||
      !same(JSON.parse(bound.plannerChild.text), candidate.proposal)) stop("retained candidate or root creation evidence is incoherent")
  checkedPublication(publication, bound, candidate)
}
export function publishedPresentationMatches(context: Context, published: PublishedAttempt): boolean {
  const { bound, publication } = published
  const materialized = { id: publication.id, type: "synthetic", ...publication.payload, time: { created: publication.time.created } }
  return same(context.data.session.message.list(bound.parentID), [...JSON.parse(bound.parentHistory), materialized]) &&
    same(context.data.session.pending.list(bound.parentID), [publication])
}
async function verifyParentPlanner(context: Context, published: PublishedAttempt, check: () => void): Promise<void> {
  const { bound, activation, publication } = published
  const parent = await after(check, context.client.session.get({ sessionID: bound.parentID }))
  successful(parent, bound.parentID, "orchestrator", activation.location)
  rootEvidence(parent, bound)
  if (parent.time.created !== bound.parentCreatedAt) stop("root creation identity changed")
  const active = await after(check, context.client.session.active())
  const inbox = await after(check, context.client.session.inbox.list({ sessionID: bound.parentID }))
  if (active[bound.parentID] || !same(inbox, [publication])) stop("root is running or pending publication changed")
  const parentHistory = await messages(context, bound.parentID, check)
  if (JSON.stringify(parentHistory) !== bound.parentHistory) stop("parent transcript changed")
  const calls = parentCalls(parentHistory, bound.userID)
  if (!same(calls.planner, bound.planner)) stop("parent call binding changed")
  const planner = await after(check, context.client.session.get({ sessionID: bound.planner.childID }))
  successful(planner, bound.planner.childID, "planner", activation.location, bound.parentID)
  if (planner.projectID !== bound.projectID || planner.subpath !== bound.subpath) stop("Planner project or subpath changed")
  if (planner.time.created !== bound.plannerCreatedAt) stop("Planner creation identity changed")
  await idle(context, bound.planner.childID, check)
  const history = await messages(context, bound.planner.childID, check)
  if (JSON.stringify(history) !== bound.plannerHistory) stop("Planner transcript changed")
  const child = verifyChildHistory(history, "planner", bound.planner.prompt)
  if (!same(child, bound.plannerChild)) stop("Planner result changed")
  resultMatches(parentHistory, bound.planner, child)
}
export async function verifyPublishedAttempt(context: Context, published: PublishedAttempt, guard: AttemptGuard): Promise<void> {
  assertPublishedCoherence(published)
  const check = checks(context, published.activation, guard, "publication")
  check()
  await verifyParentPlanner(context, published, check)
  check()
}

// One publication per activation; no implementation authority is created here.
export async function publishPlan(context: Context, activation: ActivationEvidence, guard: AttemptGuard): Promise<PublishedAttempt> {
  const { generation, baseline, location, creation } = activation
  const parentID = creation.data.sessionID
  assertLive(generation)
  if (generation.busy) stop("another CAP attempt is already running")
  generation.busy = true
  const check = checks(context, activation, guard, "publication")
  try {
    check()
    await after(check, context.client.session.wait({ sessionID: parentID }))
    const bound = await bindNativeAttempt(context, check, parentID, location)
    guard.bound = bound
    if (Number.isFinite(creation.created) && bound.parentCreatedAt !== creation.created) stop("root creation evidence changed")
    const candidate = makeCandidate(parseProposal(bound.plannerChild.text, baseline.root), baseline.root, baseline.head)
    const planHash = createHash("sha256").update(bound.plannerChild.text).digest("hex").slice(0, 12)
    await bindNativeAttempt(context, check, parentID, location, bound)
    guard.publishing = immutable({ id: `msg_${randomUUID()}`, text: bound.plannerChild.text,
      description: renderPlan(candidate), metadata: { source: "planner", planHash } })
    check()
    const admitted = await after(check, context.client.session.synthetic({ sessionID: parentID, ...guard.publishing,
      delivery: "steer", resume: false }))
    checkedPublication(admitted, bound, candidate)
    if (admitted.id !== guard.publishing.id) stop("synthetic admission identity changed")
    const published = Object.freeze({ activation, bound, candidate, publication: immutable(admitted) })
    guard.publication = published.publication
    await verifyPublishedAttempt(context, published, guard)
    // Hydration supplies presentation only. Failure never retries the publication.
    context.data.session.pending.invalidate(parentID)
    await after(check, context.data.session.pending.sync(parentID))
    context.data.session.message.invalidate(parentID)
    await after(check, context.data.session.message.sync(parentID))
    if (!publishedPresentationMatches(context, published)) stop("published Plan is unavailable or changed in the TUI")
    // The hydration awaits cannot replace the server freshness barrier.
    await verifyPublishedAttempt(context, published, guard)
    check()
    return published
  } finally {
    generation.busy = false
  }
}

// The positive readable-frame callback is the only TUI caller of this transport.
// The server owns the attempt after transfer; transport ambiguity never retries.
export async function authorizePublishedAttempt(context: Context, published: PublishedAttempt, owner: DecisionOwner): Promise<string> {
  const { activation } = published
  assertLive(activation.generation)
  owner.assertDecision(published)
  if (!initiallyAuthorizable(activation)) stop("initial clean-before-bootstrap evidence is unavailable")
  if (activation.generation.busy) stop("another CAP attempt is already running")
  activation.generation.busy = true
  try {
    await verifyPublishedAttempt(context, published, owner)
    if (!publishedPresentationMatches(context, published)) stop("published Plan view changed")
    checks(context, activation, owner, "clean")()
    owner.assertDecision(published)
    owner.transfer()
    const outcome = await context.client.rpc(authorizeRpc).authorize({
      purpose: "implement", candidate: published.candidate, rootSessionID: published.bound.parentID,
      location: activation.location, publicationID: published.publication.id,
    }, { location: activation.location })
    if (typeof outcome !== "string") stop("Authorize RPC returned an invalid outcome")
    return outcome
  } finally {
    activation.generation.busy = false
  }
}
