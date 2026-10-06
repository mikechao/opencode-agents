import type { Context } from "@opencode/plugin/tui/context"
import { Content as ToolContent } from "@opencode/schema/tool"
import { Schema } from "effect"
import type { LocationRef, OpenCodeEvent, SessionInboxInfo, SessionInfo, SessionMessageInfo } from "@opencode/client"
import { randomUUID } from "node:crypto"
import { assertLive, exactKeys, frozenCopy, type Generation } from "./cap.ts"
import { observeGit, requireFresh, type GitSnapshot } from "./git.ts"
import { candidateIntact, makeCandidate, parseProposal, renderPlan } from "./proposal.ts"
import type { IntentCandidate } from "./proposal.ts"
import { authorizeRpc, checkedCycleOutcome, type CycleOutcome } from "./authorize-rpc.ts"
import { receiptInput } from "./receipt.ts"
import { exactEvidence, snapshotLocation } from "./host-evidence.ts"
import {
  checkedRevision,
  plannerReceipt,
  completedPlannerTurn as parentCalls,
  inspectCompletedRootTurn,
  verifyChildHistory,
  type Revision,
  type Call,
  type Child,
} from "./planner-history.ts"

export function revisionInput(published: PublishedAttempt, text: string): Revision {
  return frozenCopy({
    controlID: `msg_${randomUUID()}`,
    publicationID: published.publication.id,
    parentID: published.bound.parentID,
    userID: published.bound.userID,
    request: published.bound.request,
    proposal: published.candidate.proposal,
    text,
    precedingIdleID: published.bound.terminalIdleID,
    source: {
      messageID: published.bound.planner.messageID,
      toolID: published.bound.planner.toolID,
      childID: published.bound.planner.childID,
    },
  })
}
type Location = SessionInfo["location"]
export type Bound = Readonly<{
  parentID: string
  userID: string
  request: string
  planner: Call
  plannerChild: Child
  parentCreatedAt: number
  terminalIdleID: string
  revision?: Revision
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
function same(a: unknown, b: unknown): boolean {
  return exactEvidence(a) === exactEvidence(b)
}

function stop(message: string): never {
  throw new Error(`Attempt binding failed: ${message}`)
}
function empty(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0)
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
export async function inspectRootCompletion(
  context: Context,
  activation: ActivationEvidence,
  guard: AttemptGuard,
  terminalIdleID: string,
  revision?: Revision,
) {
  const check = checks(context, activation, guard)
  check()
  return inspectCompletedRootTurn(
    await messages(context, activation.creation.data.sessionID, check),
    terminalIdleID,
    revision,
  )
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
  revision?: Revision,
): Promise<Bound> {
  const parent = await after(check, context.client.session.get({ sessionID: parentID }))
  successful(parent, parentID, "orchestrator", location)
  await idle(context, parentID, check)
  const parentHistory = await messages(context, parentID, check)
  const calls = parentCalls(parentHistory, terminalIdleID, revision)
  if (calls.planner.childID === parentID) stop("Planner is not a fresh child")
  const planner = await after(check, context.client.session.get({ sessionID: calls.planner.childID }))
  successful(planner, calls.planner.childID, "planner", location, parentID)
  await idle(context, planner.id, check)
  const plannerChild = await verifyPlannerHistory(context, check, planner, calls.planner.effective.input.prompt)
  if (revision) {
    // Retired native Planners remain root children. Unknown children must not
    // hide in the interval before the new bound child is installed in Ownership.
    const plannerIDs = parentHistory.flatMap((message) =>
      message.type === "assistant"
        ? message.content.flatMap((part) =>
            part.type === "tool" &&
            part.name === "subagent" &&
            part.state.status === "completed" &&
            typeof part.state.metadata?.sessionID === "string"
              ? [part.state.metadata.sessionID]
              : [],
          )
        : [],
    )
    const expected = new Set(plannerIDs)
    if (expected.size !== plannerIDs.length) stop("Planner generations reused a child")
    const actual = await children(context, parentID, check)
    if (actual.size !== expected.size || [...actual].some((id) => !expected.has(id)))
      stop("root children differ from trusted Planner generations")
  }
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
  if (bound.revision) {
    const revision = checkedRevision(bound.revision)
    if (
      revision.parentID !== bound.parentID ||
      revision.userID !== bound.userID ||
      revision.request !== bound.request ||
      revision.precedingIdleID !== bound.planner.effective.turn.precedingIdleID
    )
      stop("retained revision input is incoherent")
  }
  if (
    bound.parentID !== activation.creation.data.sessionID ||
    (Number.isFinite(activation.creation.created) && bound.parentCreatedAt !== activation.creation.created) ||
    !same(
      bound.planner.effective,
      plannerReceipt(
        bound.userID,
        bound.planner.proposed.description,
        bound.request,
        {
          precedingIdleID: bound.planner.effective.turn.precedingIdleID,
          messageID: bound.planner.messageID,
          toolID: bound.planner.toolID,
        },
        bound.revision,
      ),
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
  const calls = parentCalls(parentHistory, bound.terminalIdleID, bound.revision)
  if (
    !same(calls, {
      userID: bound.userID,
      request: bound.request,
      planner: bound.planner,
      terminalIdleID: bound.terminalIdleID,
      ...(bound.revision ? { revision: bound.revision } : {}),
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

// One publication per granted planning generation; no implementation authority is created here.
export async function publishPlan(
  context: Context,
  activation: ActivationEvidence,
  guard: PublicationOwner,
  terminalIdleID: string,
  revision?: Revision,
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
    const bound = await bindNativeAttempt(context, check, parentID, location, terminalIdleID, revision)
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
): Promise<CycleOutcome> {
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
    return checkedCycleOutcome(outcome)
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
