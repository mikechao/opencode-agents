import type { Context } from "@opencode/plugin/tui/context"
import type { LocationRef, OpenCodeEvent, SessionInboxInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { createHash, randomUUID } from "node:crypto"
import { assertLive, exactKeys, frozenCopy, type Generation } from "./cap.ts"
import { observeGit, requireFresh, type GitSnapshot } from "./git.ts"
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
export const plannerReceipt = (userID: string, description: string, request: string) => ({
  userID,
  input: { agent: "planner" as const, description, prompt: plannerInput(request) },
})
function effectivePlannerReceipt(
  value: unknown,
  userID: string,
  request: string,
  proposed: ReturnType<typeof plannerArguments>,
) {
  if (!exactKeys(value, ["userID", "input"])) stop("missing or malformed trusted Planner input receipt")
  plannerArguments(value.input)
  const expected = plannerReceipt(userID, proposed.description, request)
  if (!same(value, expected)) stop("trusted Planner input receipt differs from the root request")
  return expected
}
// Pinned native bootstrap; authorized payload remains exact.
export const nativeBootstrap = (prompt: string): string => `You are a subagent spawned by another session.\n${prompt}`

type Assistant = Extract<SessionMessageInfo, { type: "assistant" }>
type Tool = Extract<Assistant["content"][number], { type: "tool" }>
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
// These are operation expectations and local lifetime checks, never authority flags.
// The TUI setup closure owns this object and its pending/claimed identity.
export interface AttemptGuard {
  assertCurrent(): void
  bound?: Bound
  publishing?: Readonly<{
    id: string
    text: string
    description: string
    metadata: { source: string; planHash: string }
  }>
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
function plain(message: Pick<Extract<SessionMessageInfo, { type: "user" }>, "files" | "agents" | "skills">): boolean {
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
function completedCall(messageID: string, tool: Tool, userID: string, request: string): Call {
  if (tool.name !== "subagent" || tool.state.status !== "completed") stop("unexpected parent tool")
  const proposed = plannerArguments(tool.state.input)
  const childID = tool.state.metadata?.sessionID
  if (typeof childID !== "string" || tool.state.metadata?.status !== "completed")
    stop("missing completed native child metadata")
  const effective = effectivePlannerReceipt(tool.state.metadata?.[plannerReceiptKey], userID, request, proposed)
  return { messageID, toolID: tool.id, childID, proposed, effective }
}
function parentCalls(history: SessionMessageInfo[]): { userID: string; request: string; planner: Call } {
  const users = history.filter((message) => message.type === "user")
  if (users.length !== 1 || users[0]?.type !== "user" || history[0] !== users[0] || !plain(users[0]) || !users[0].text)
    stop("parent does not have one exact plain user input")
  if (history.some((message) => !["user", "assistant", "idle", "model-switched"].includes(message.type)))
    stop("unexpected parent input or control message")
  const idles = history.filter((message) => message.type === "idle")
  if (!idles.length || idles.some((message) => message.outcome !== "succeeded"))
    stop("parent did not complete one successful turn")
  oneFinal(history, "orchestrator")
  if (history.at(-1)?.type !== "idle") stop("parent final result is missing")
  const tools = history.flatMap((message) =>
    message.type === "assistant"
      ? message.content
          .filter((part): part is Tool => part.type === "tool")
          .map((part) => ({ messageID: message.id, part }))
      : [],
  )
  if (tools.length !== 1 || tools[0]?.part.name !== "subagent")
    stop("parent did not make exactly one native Planner call")
  const planner = completedCall(tools[0].messageID, tools[0].part, users[0].id, users[0].text)
  return { userID: users[0].id, request: users[0].text, planner }
}
function verifyChildHistory(history: SessionMessageInfo[], agent: "planner", prompt: string): Child {
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
  if (
    history.some(
      (message) =>
        message.type === "assistant" &&
        message.content.some(
          (part) =>
            part.type === "tool" &&
            (["edit", "write", "apply_patch", "bash", "subagent", "execute"].includes(part.name) ||
              part.name.startsWith("session_") ||
              part.state.status !== "completed"),
        ),
    )
  ) {
    stop(`${agent} used a disallowed tool during bootstrap`)
  }
  const text = finalText(final)
  if (!text) stop(`unexpected ${agent} final text`)
  return { inputID: users[0].id, finalID: final.id, text }
}
async function bindNativeAttempt(
  context: Context,
  check: () => void,
  parentID: string,
  location: Location,
): Promise<Bound> {
  const parent = await after(check, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "orchestrator", location)
  await idle(context, parentID, check)
  const parentHistory = await messages(context, parentID, check)
  const calls = parentCalls(parentHistory)
  if (calls.planner.childID === parentID) stop("Planner is not a fresh child")
  const planner = await after(check, context.client.session.get({ sessionID: calls.planner.childID }))
  successful(planner, calls.planner.childID, "planner", location, parentID)
  await idle(context, planner.id, check)
  const history = await messages(context, planner.id, check)
  const plannerChild = verifyChildHistory(history, "planner", calls.planner.effective.input.prompt)
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
    !same(bound.planner.effective, plannerReceipt(bound.userID, bound.planner.proposed.description, bound.request)) ||
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
  const calls = parentCalls(parentHistory)
  if (!same(calls, { userID: bound.userID, request: bound.request, planner: bound.planner }))
    stop("parent call binding changed")
  const planner = await after(check, context.client.session.get({ sessionID: bound.planner.childID }))
  successful(planner, bound.planner.childID, "planner", activation.location, bound.parentID)
  await idle(context, bound.planner.childID, check)
  const history = await messages(context, bound.planner.childID, check)
  const child = verifyChildHistory(history, "planner", bound.planner.effective.input.prompt)
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

// One publication per activation; no implementation authority is created here.
export async function publishPlan(
  context: Context,
  activation: ActivationEvidence,
  guard: AttemptGuard,
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
    const bound = await bindNativeAttempt(context, check, parentID, location)
    guard.bound = bound
    if (Number.isFinite(creation.created) && bound.parentCreatedAt !== creation.created)
      stop("root creation evidence changed")
    const candidate = makeCandidate(parseProposal(bound.plannerChild.text, baseline.root), baseline.root, baseline.head)
    const planHash = createHash("sha256").update(bound.plannerChild.text).digest("hex").slice(0, 12)
    guard.publishing = frozenCopy({
      id: `msg_${randomUUID()}`,
      text: bound.plannerChild.text,
      description: renderPlan(candidate),
      metadata: { source: "planner", planHash },
    })
    check()
    observePublication(activation)
    const admitted = await after(
      check,
      context.client.session.synthetic({ sessionID: parentID, ...guard.publishing, delivery: "steer", resume: false }),
    )
    checkedPublication(admitted, bound, candidate)
    if (admitted.id !== guard.publishing.id) stop("synthetic admission identity changed")
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
