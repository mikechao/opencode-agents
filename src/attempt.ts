import type { Context } from "@opencode/plugin/tui/context"
import type { LocationRef, OpenCodeEvent, SessionInboxInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createHash, randomUUID } from "node:crypto"
import { assertLive, consumeIntent, grantIntent, type Generation } from "./cap.ts"
import { observeGit, requireFresh, requireInScope, type GitSnapshot } from "./git.ts"
import { candidateIntact, makeCandidate, parseProposal, renderPlan } from "./proposal.ts"
import type { IntentCandidate } from "./proposal.ts"

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

export const SLOT_PROMPT = "Reply READY only. Do not inspect or modify the repository."
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
type Call = Readonly<{ messageID: string; toolID: string; childID: string; prompt: string; agent: "planner" | "implementer_slot" }>
type Child = Readonly<{ inputID: string; finalID: string; text: string }>
export type Bound = Readonly<{ parentID: string; userID: string; request: string; planner: Call; slot: Call; plannerChild: Child; slotChild: Child;
  parentHistory: string; plannerHistory: string; slotHistory: string;
  parentCreatedAt: number; plannerCreatedAt: number; slotCreatedAt: number }>

type Created = Extract<OpenCodeEvent, { type: "session.created" }>
type Synthetic = Extract<SessionInboxInfo, { type: "synthetic" }>
type Switch = Extract<SessionMessageInfo, { type: "agent-switched" }>
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
  switching?: string
  switchRecord?: Frozen<Switch>
  prompt?: Readonly<{ id: string; text: string }>
  dispatched?: boolean
}

export interface DecisionOwner extends AttemptGuard {
  assertDecision(published: PublishedAttempt): void
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
function parentCalls(history: SessionMessageInfo[], expectedUserID?: string): { userID: string; request: string; planner: Call; slot: Call } {
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
async function bindNativeAttempt(context: Context, check: () => void, parentID: string, location: Location, expected?: Bound): Promise<Bound> {
  const parent = await after(check, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "orchestrator", location)
  await idle(context, parentID, check)
  const parentHistory = await messages(context, parentID, check)
  if (expected && JSON.stringify(parentHistory) !== expected.parentHistory) stop("parent transcript changed")
  const calls = parentCalls(parentHistory, expected?.userID)
  if (expected && (calls.request !== expected.request || JSON.stringify(calls.planner) !== JSON.stringify(expected.planner) ||
      JSON.stringify(calls.slot) !== JSON.stringify(expected.slot))) stop("parent native invocation changed")
  const children: Child[] = []
  const histories: string[] = []
  const created: number[] = []
  for (const call of [calls.planner, calls.slot]) {
    const session = await after(check, context.client.session.get({ sessionID: call.childID }))
    successful(session, call.childID, call.agent, location, parentID)
    await idle(context, call.childID, check)
    const childHistory = await messages(context, call.childID, check)
    histories.push(JSON.stringify(childHistory))
    created.push(session.time.created)
    const child = verifyChildHistory(childHistory, call.agent, call.prompt)
    resultMatches(parentHistory, call, child)
    children.push(child)
  }
  const bound = { parentID, ...calls, plannerChild: children[0]!, slotChild: children[1]!,
    parentHistory: JSON.stringify(parentHistory), plannerHistory: histories[0]!, slotHistory: histories[1]!,
    parentCreatedAt: parent.time.created, plannerCreatedAt: created[0]!, slotCreatedAt: created[1]! }
  if (expected && (JSON.stringify(bound.plannerChild) !== JSON.stringify(expected.plannerChild) ||
      JSON.stringify(bound.slotChild) !== JSON.stringify(expected.slotChild) ||
      bound.plannerHistory !== expected.plannerHistory || bound.slotHistory !== expected.slotHistory || bound.parentCreatedAt !== expected.parentCreatedAt ||
      bound.plannerCreatedAt !== expected.plannerCreatedAt || bound.slotCreatedAt !== expected.slotCreatedAt)) stop("native child transcript changed")
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
  if (!same(calls, { userID: bound.userID, request: bound.request, planner: bound.planner, slot: bound.slot }) ||
      !same(verifyChildHistory(JSON.parse(bound.plannerHistory), "planner", bound.planner.prompt), bound.plannerChild) ||
      !same(verifyChildHistory(JSON.parse(bound.slotHistory), "implementer_slot", bound.slot.prompt), bound.slotChild)) stop("retained native evidence is incoherent")
  resultMatches(h0, bound.planner, bound.plannerChild)
  resultMatches(h0, bound.slot, bound.slotChild)
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
  if (parent.time.created !== bound.parentCreatedAt) stop("root creation identity changed")
  const active = await after(check, context.client.session.active())
  const inbox = await after(check, context.client.session.inbox.list({ sessionID: bound.parentID }))
  if (active[bound.parentID] || !same(inbox, [publication])) stop("root is running or pending publication changed")
  const parentHistory = await messages(context, bound.parentID, check)
  if (JSON.stringify(parentHistory) !== bound.parentHistory) stop("parent transcript changed")
  const calls = parentCalls(parentHistory, bound.userID)
  if (!same(calls.planner, bound.planner) || !same(calls.slot, bound.slot)) stop("parent call binding changed")
  const planner = await after(check, context.client.session.get({ sessionID: bound.planner.childID }))
  successful(planner, bound.planner.childID, "planner", activation.location, bound.parentID)
  if (planner.time.created !== bound.plannerCreatedAt) stop("Planner creation identity changed")
  await idle(context, bound.planner.childID, check)
  const history = await messages(context, bound.planner.childID, check)
  if (JSON.stringify(history) !== bound.plannerHistory) stop("Planner transcript changed")
  const child = verifyChildHistory(history, "planner", bound.planner.prompt)
  if (!same(child, bound.plannerChild)) stop("Planner result changed")
  resultMatches(parentHistory, bound.planner, child)
  resultMatches(parentHistory, bound.slot, bound.slotChild)
}
export async function verifyPublishedAttempt(context: Context, published: PublishedAttempt, guard: AttemptGuard): Promise<void> {
  assertPublishedCoherence(published)
  const check = checks(context, published.activation, guard, "publication")
  check()
  await verifyParentPlanner(context, published, check)
  const { bound, activation } = published
  const slot = await after(check, context.client.session.get({ sessionID: bound.slot.childID }))
  successful(slot, bound.slot.childID, "implementer_slot", activation.location, bound.parentID)
  if (slot.time.created !== bound.slotCreatedAt) stop("slot creation identity changed")
  await idle(context, bound.slot.childID, check)
  if (JSON.stringify(await messages(context, bound.slot.childID, check)) !== bound.slotHistory) stop("native child transcript changed")
  check()
}
async function switchedSlot(context: Context, check: () => void, bound: Bound, location: Location, expected?: Frozen<Switch>, input?: { id: string; text: string }, expectedResult?: string): Promise<Readonly<{ switchRecord: Frozen<Switch>; resultHistory: string }>> {
  const session = await after(check, context.client.session.get({ sessionID: bound.slot.childID }))
  successful(session, bound.slot.childID, "authorized_implementer", location, bound.parentID)
  if (session.time.created !== bound.slotCreatedAt) stop("slot creation identity changed")
  await idle(context, bound.slot.childID, check)
  const history = await messages(context, bound.slot.childID, check)
  const switches = history.filter((message) => message.type === "agent-switched")
  if (switches.length !== 1 || switches[0]?.type !== "agent-switched" || switches[0].agent !== "authorized_implementer" ||
      switches[0].previous !== "implementer_slot") stop("slot role switch is missing or ambiguous")
  if (expected && !same(switches[0], expected)) stop("retained slot switch identity changed")
  const before = history.slice(0, history.indexOf(switches[0]))
  if (JSON.stringify(before) !== bound.slotHistory) stop("slot bootstrap transcript changed")
  const bootstrap = verifyChildHistory(before, "implementer_slot", bound.slot.prompt)
  if (JSON.stringify(bootstrap) !== JSON.stringify(bound.slotChild)) stop("slot bootstrap changed")
  const afterSwitch = history.slice(history.indexOf(switches[0]) + 1)
  const resultHistory = JSON.stringify(afterSwitch)
  if (expectedResult !== undefined && resultHistory !== expectedResult) stop("implementation result transcript changed")
  if (!input) {
    if (afterSwitch.length) stop("slot received input before trusted prompt")
    return Object.freeze({ switchRecord: immutable(switches[0]), resultHistory })
  }
  const users = afterSwitch.filter((message) => message.type === "user")
  const idles = afterSwitch.filter((message) => message.type === "idle")
  if (users.length !== 1 || users[0]?.type !== "user" || afterSwitch[0] !== users[0] ||
      users[0].id !== input.id || users[0].text !== input.text || !plain(users[0]) ||
      idles.length !== 1 || idles[0]?.type !== "idle" || idles[0].outcome !== "succeeded" || afterSwitch.at(-1)?.type !== "idle" ||
      afterSwitch.some((message) => !["user", "assistant", "idle"].includes(message.type))) stop("authorized slot input/result mismatch")
  const final = oneFinal(afterSwitch, "authorized_implementer")
  if (!finalText(final)) stop("authorized Implementer returned no text")
  return Object.freeze({ switchRecord: immutable(switches[0]), resultHistory })
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
    const fresh = checks(context, activation, owner, "clean")
    const check = () => { owner.assertDecision(published); fresh() }
    check()
    assertPublishedCoherence(published)
    return await executeBoundImplementation(context, published, owner, check)
  } finally {
    activation.generation.busy = false
  }
}

async function executeBoundImplementation(context: Context, published: PublishedAttempt, owner: DecisionOwner, check: () => void): Promise<string> {
  const { activation, candidate, bound } = published
  const { generation, baseline, location } = activation
  const frozenText = implementerPrompt(candidate)
  const prompt = Object.freeze({ id: `msg_${randomUUID()}`, text: frozenText })
  const grant = grantIntent(candidate, true, generation)
  owner.switching = bound.slot.childID
  check()
  await after(check, context.client.session.switchAgent({ sessionID: bound.slot.childID, agent: "authorized_implementer" }))
  const { switchRecord: switched } = await switchedSlot(context, check, bound, location)
  owner.switchRecord = switched
  await verifyParentPlanner(context, published, check)
  await switchedSlot(context, check, bound, location, switched)
  // Final full read barrier, followed by fresh synchronous Git and local checks.
  await verifyParentPlanner(context, published, check)
  await switchedSlot(context, check, bound, location, switched)
  if (!publishedPresentationMatches(context, published)) stop("published Plan view changed")
  check()
  assertPublishedCoherence(published)
  owner.prompt = prompt
  owner.dispatched = true
  consumeIntent(grant, candidate, generation)
  const admission = context.client.session.prompt({ sessionID: bound.slot.childID, ...prompt, delivery: "steer" })
  // Never require cleanliness after invocation: the child may already be editing.
  const freshResult = checks(context, activation, owner, "implemented")
  const resultCheck = () => { owner.assertDecision(published); freshResult() }
  const returned = await after(resultCheck, admission)
  if (returned.sessionID !== bound.slot.childID || returned.type !== "user" || returned.id !== prompt.id ||
      returned.payload.text !== frozenText || returned.delivery !== "steer" || !Number.isFinite(returned.time.created) ||
      returned.payload.metadata !== undefined || Object.keys(returned.payload).some((key) => !["text", "files", "agents", "skills", "metadata"].includes(key)) ||
      !plain(returned.payload)) stop("trusted prompt returned an unexpected input")
  await verifyParentPlanner(context, published, resultCheck)
  await after(resultCheck, context.client.session.wait({ sessionID: bound.slot.childID }))
  const implementation = await switchedSlot(context, resultCheck, bound, location, switched, prompt)
  await verifyParentPlanner(context, published, resultCheck)
  // Recheck the result after parent/Planner awaits as well.
  await switchedSlot(context, resultCheck, bound, location, switched, prompt, implementation.resultHistory)
  resultCheck()
  const result = observeGit(requireActivationLocation(context, location), baseline)
  const paths = requireInScope(result, baseline, candidate.proposal.files)
  owner.assertCurrent()
  assertLive(generation)
  return `Implementation gate complete: HEAD ${baseline.head} unchanged. Resulting paths (${paths.length}): ${paths.join(", ") || "(none)"}. STOP before Reviewer / Commit.`
}
