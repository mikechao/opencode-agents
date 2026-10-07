import { Cause, DateTime, Deferred, Effect, Exit } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Session } from "@opencode/schema/session"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { createHash, randomUUID } from "node:crypto"
import { NativeCap, NativeExecution, exactKeys, frozenCopy, type AuthorizeClaim, type Reservation } from "./cap.ts"
import {
  plannerArguments,
  plannerTurnInput,
  plannerReceiptKey,
  checkedRevision,
  completedPlannerTurn,
  plannerInput,
  revisionArguments,
  type Revision,
  verifyChildHistory,
} from "./planner-history.ts"
import {
  exactEvidence,
  snapshotLocation,
  nativeBootstrap,
  directRootTool,
  nativeReadInstruction,
} from "./host-evidence.ts"
import { parseProposal, candidateIntact, displayPath, type IntentCandidate } from "./proposal.ts"
import {
  observeGit,
  requireFresh,
  requireInScope,
  observeReviewTarget,
  requireReviewTarget,
  type ReviewTarget,
  ReviewTargetChanged,
} from "./git.ts"
import { receiptInput } from "./receipt.ts"
import { reviewerArguments, parseReviewResult, reviewReceipt, type ReviewResult } from "./review.ts"
import {
  historicalReviewEvent,
  ownedReceiptEvent,
  sessionEventSeq,
  type CycleOutcome,
  type RepairDecision,
} from "./authorize-rpc.ts"
import { reviewerGitName, reviewerGitArguments } from "./reviewer-git.ts"
import { CommitGit, committerGitName, decodeCommitterInput } from "./committer-git.ts"

const reviewerTool = (name: string) => directRootTool(name) || name === reviewerGitName

const target = "authorized_implementer"
export const sponsorRules = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "subagent", resource: target, effect: "allow" },
] as const
export const reviewerSponsorRules = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "subagent", resource: "reviewer", effect: "allow" },
] as const
export const committerSponsorRules = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "subagent", resource: "committer", effect: "allow" },
] as const
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)
const fail = (message: string) => new Tool.Error({ message: `CAP admission: ${message}` })
const attempt = <T>(body: () => T) =>
  Effect.try({
    try: body,
    catch: (error) =>
      new Tool.Error({ message: `CAP admission: ${error instanceof Error ? error.message : String(error)}`, error }),
  })
function implementerPrompt(candidate: IntentCandidate): string {
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

export const nativeArguments = (candidate: IntentCandidate) =>
  Object.freeze({
    agent: target,
    description: "Implement the authorized plan",
    prompt: implementerPrompt(candidate),
  })
export const controlText = (candidate: IntentCandidate) =>
  [
    "Propose exactly one foreground native subagent call with exactly these arguments:",
    JSON.stringify(nativeArguments(candidate)),
    "Do not add keys, reuse a session, or change these values. After its result, finish with prose. Trusted runtime owns the automatic review transition. STOP before Commit.",
  ].join("\n")
const emptyPermissions = (permissions: unknown) =>
  permissions === undefined || (Array.isArray(permissions) && permissions.length === 0)

function orchestratorRootMatches(
  root: Session.Info,
  rootSessionID: string,
  location: ReturnType<typeof snapshotLocation>,
): boolean {
  return (
    root.id === rootSessionID &&
    root.agent === "orchestrator" &&
    !root.parentID &&
    !root.fork &&
    !root.revert &&
    !root.time.archived &&
    same(snapshotLocation(root.location), location) &&
    emptyPermissions(root.permissions)
  )
}

type ChildBinding = { kind: "unknown" } | { kind: "exact"; childID: string } | { kind: "ambiguous" }
function bindChild(
  execution: { child: ChildBinding },
  childID: unknown,
  parentID: string,
  forbidden: readonly string[] = [],
) {
  if (execution.child.kind === "ambiguous") return
  if (
    typeof childID !== "string" ||
    !childID ||
    childID === parentID ||
    forbidden.includes(childID) ||
    (execution.child.kind === "exact" && execution.child.childID !== childID)
  )
    execution.child = { kind: "ambiguous" }
  else execution.child = { kind: "exact", childID }
}
// Successful prior verification only; this evidence grants no execution authority
// and cannot replace later freshness, admission, or settlement checks.
type VerifiedImplementation = Readonly<{
  claim: Readonly<Pick<AuthorizeClaim, "candidate" | "rootSessionID" | "location">>
  identity: Readonly<{
    rootSessionID: string
    messageID: string
    toolID: string
    childID: string
  }>
  target: ReviewTarget
}>
type ImplementationGate =
  | { kind: "verified"; implementation: VerifiedImplementation }
  | { kind: "unverified"; cause: Cause.Cause<unknown> }
type VerifiedReview = Readonly<{
  implementation: VerifiedImplementation
  result: ReviewResult
  reviewer: RepairDecision["reviewer"]
  boundary: Readonly<{
    length: number
    digest: string
    created: number
    idle: number
    rootIdleID: string
    rootEventSeq: number
  }>
}>
const sameSettlement = (root: Session.Info, boundary: Pick<VerifiedReview["boundary"], "created" | "idle">) =>
  root.outcome === "succeeded" &&
  !!root.time.idle &&
  DateTime.toEpochMillis(root.time.created) === boundary.created &&
  DateTime.toEpochMillis(root.time.idle) === boundary.idle
const historyDigest = (history: readonly SessionMessage.Info[]) =>
  createHash("sha256").update(exactEvidence(history)).digest("hex")
class RepairClaim extends NativeExecution<VerifiedImplementation["claim"]> {
  readonly arguments: Readonly<{ agent: typeof target; description: string; prompt: string }>
  constructor(
    readonly decisionID: string,
    readonly evidence: VerifiedReview,
  ) {
    super()
    const { claim, target: reviewTarget } = evidence.implementation
    this.arguments = frozenCopy({
      agent: target,
      description: "Repair the authorized implementation",
      prompt: [
        "You are a fresh Implementer for one human-authorized repair of the dirty reviewed worktree.",
        "Address the verified findings only insofar as they fit the original frozen proposal and exact path ceiling. Preserve the reviewed implementation as your starting point.",
        "If required work exceeds that authority, stop and report it. Finding paths are diagnostic and grant no scope.",
        "Do not commit, change Git history, delegate, manipulate repository/index/ignore metadata to conceal changes, expand scope, or seek another approval. Leave original HEAD unchanged.",
        `Canonical worktree root: ${claim.candidate.root}`,
        `Original bound HEAD: ${claim.candidate.head}`,
        `Original exact authorized paths: ${JSON.stringify(claim.candidate.proposal.files)}`,
        `Frozen proposal: ${JSON.stringify(claim.candidate.proposal)}`,
        `Exact reviewed target: ${JSON.stringify(reviewTarget)}`,
        `Verified Reviewer identity: ${JSON.stringify(evidence.reviewer)}`,
        `Exact verified review result: ${JSON.stringify(evidence.result)}`,
      ].join("\n"),
    })
    this.install(
      claim,
      Object.freeze({
        id: `msg_${randomUUID()}`,
        text: [
          "Propose exactly one foreground native subagent call with exactly these arguments:",
          JSON.stringify(this.arguments),
          "Do not add keys, reuse a session, change values, or retry. Finish after its result. Trusted runtime owns fresh review. STOP before Commit.",
        ].join("\n"),
      }),
    )
  }
}
class CommitClaim extends NativeExecution<VerifiedImplementation["claim"]> {
  readonly arguments: Readonly<{ agent: "committer"; description: string; prompt: string }>
  readonly git: CommitGit
  toolFailure?: string
  nativeText?: string
  constructor(
    readonly decisionID: string,
    readonly evidence: VerifiedReview,
  ) {
    super()
    if (evidence.result.status !== "APPROVED") throw new Error("Commit requires verified APPROVED evidence")
    const { claim, target } = evidence.implementation
    this.git = new CommitGit(target)
    this.arguments = frozenCopy({
      agent: "committer",
      description: "Commit the approved implementation",
      prompt: [
        "You are a fresh Committer for one explicit human Commit decision. Use only committer_git.",
        "Inspect status, diff and recent history; prepare the complete server-selected paths; inspect staged; choose a concise accurate imperative message; request commit once; inspect result and finish.",
        "Never edit, delegate, use shell, widen scope, retry, amend, use no-verify, reset, restore, clean, or push. A failed/ambiguous tool result is terminal. Do not invent issue references or metadata.",
        `Frozen proposal: ${JSON.stringify(claim.candidate.proposal)}`,
        `Approved target: ${JSON.stringify(target)}`,
        `Verified Reviewer: ${JSON.stringify(evidence.reviewer)}`,
        `Verified review: ${JSON.stringify(evidence.result)}`,
      ].join("\n"),
    })
    this.install(
      claim,
      Object.freeze({
        id: `msg_${randomUUID()}`,
        text: [
          "Propose exactly one foreground native subagent call with exactly these arguments:",
          JSON.stringify(this.arguments),
          "Do not add keys, reuse a session, change values, or retry. After its result finish with prose. Commit authority belongs only to the trusted structured tool.",
        ].join("\n"),
      }),
    )
  }
}
type ExecutionOwner = NativeCap | RepairClaim | CommitClaim
type ReviewOutcome =
  | { kind: "verified"; evidence: VerifiedReview }
  | { kind: "unverified"; cause: Cause.Cause<unknown> }
type ReviewAdmission =
  | { kind: "available" }
  | { kind: "reserved"; call: Readonly<Reservation> }
  | { kind: "entered"; call: Readonly<Reservation> }
  | { kind: "consumed"; call: Readonly<Reservation> }
  | { kind: "closed" }
type ReviewAttempt = {
  readonly implementation: VerifiedImplementation
  readonly arguments: ReturnType<typeof reviewerArguments>
  readonly control: Readonly<{ id: string; text: string }>
  admission: ReviewAdmission
  failure?: Cause.Cause<unknown>
  execution?: { call: Readonly<Reservation>; child: ChildBinding; result?: Readonly<Tool.Result> }
}

// Server-only host adapter. All reads use the supported Effect session API.
// Root-local one-shot slots live only in this closure; no transcript recovery.
export function nativeAdmission(context: Context) {
  const caps = new Map<string, NativeCap>()
  const reviews = new Map<string, ReviewAttempt>()
  const workers = new Map<string, ExecutionOwner>()
  const pending = new Map<string, Readonly<{ id: string; evidence: VerifiedReview }>>()
  const pendingCommits = new Map<string, Readonly<{ id: string; evidence: VerifiedReview }>>()
  const currentReviews = new Map<string, VerifiedReview>()
  const children = new Map<string, object>()
  const contenders = new Map<string, object>()
  const contenderKeys = (call: Reservation) => [
    JSON.stringify([call.sessionID, "message", call.messageID]),
    JSON.stringify([call.sessionID, "tool", call.id]),
  ]
  const currentContender = (call: Reservation, owner: object) => {
    if (contenderKeys(call).some((key) => contenders.has(key) && contenders.get(key) !== owner))
      throw new Error("Native message/tool identity belongs to an obsolete execution")
  }
  const recordContender = (call: Reservation, owner: object) => {
    for (const key of contenderKeys(call)) contenders.set(key, owner)
  }
  const receipts = new Map<string, Readonly<{ rootSessionID: string; text: string }>>()
  // Settlement notifications can arrive after the RPC that verified them.
  // These exact historical identities are inert facts, never admission evidence.
  const settledRoots = new Map<string, string>()
  const reviewBoundaries = new Map<string, Pick<RepairDecision, "rootSessionID" | "rootEventSeq">>()
  // Infinity marks unproven activity: no later log boundary can make it historical.
  const latestActivity = new Map<string, number>()
  // Join the supported event subscription to the exact idle verified by context
  // reads. Notification processing may lag those reads; never guess its seq.
  const terminalNotifications = new Map<
    string,
    Deferred.Deferred<Pick<RepairDecision, "rootSessionID" | "rootEventSeq">, Tool.Error>
  >()
  const terminalNotification = (rootIdleID: string) => {
    let notification = terminalNotifications.get(rootIdleID)
    if (!notification) {
      notification = Deferred.makeUnsafe<Pick<RepairDecision, "rootSessionID" | "rootEventSeq">, Tool.Error>()
      terminalNotifications.set(rootIdleID, notification)
    }
    return notification
  }
  const knownReceipt = (message: SessionMessage.Info) =>
    message.type === "synthetic" && receipts.get(message.id)?.text === message.text
  const bindFreshChild = (execution: { child: ChildBinding }, id: unknown, root: string) => {
    const previous = typeof id === "string" ? children.get(id) : undefined
    bindChild(execution, id, root, previous && previous !== execution ? [String(id)] : [])
    if (execution.child.kind === "exact") children.set(execution.child.childID, execution)
  }
  const acquire = (cap: ExecutionOwner) => {
    if (executing) throw new Error("Another root owns worktree implementation exclusion")
    pending.clear()
    pendingCommits.clear()
    currentReviews.clear()
    executing = { cap }
  }
  // Only successful trusted admission spends eligibility. Failed syntax and
  // denied pre-admission calls create neither a slot nor CAP authority.
  const planners = new Map<
    string,
    | (({ kind: "admitted" } | { kind: "completed"; childID: string }) & {
        call: Readonly<Reservation>
        receipt: ReturnType<typeof plannerTurnInput>["effective"]
      })
    | { kind: "registering" | "granted"; revision: Revision }
    | { kind: "closed" }
  >()
  const revise = (input: unknown) =>
    Effect.gen(function* () {
      const { revision, previous, registration } = yield* attempt(() => {
        live()
        const revision = checkedRevision(input)
        const previous = planners.get(revision.parentID)
        if (
          !previous ||
          previous.kind !== "completed" ||
          caps.has(revision.parentID) ||
          !same(revision.source, {
            messageID: previous.call.messageID,
            toolID: previous.call.id,
            childID: previous.childID,
          }) ||
          revision.userID !== previous.receipt.userID ||
          (previous.receipt.revision
            ? revision.request !== previous.receipt.revision.request
            : previous.receipt.input.prompt !== plannerInput(revision.request))
        )
          throw new Error("No completed Planner admission for revision grant")
        const registration = { kind: "registering" as const, revision }
        planners.set(revision.parentID, registration)
        return { revision, previous, registration }
      })
      return yield* Effect.gen(function* () {
        const root = yield* context.session.get({ sessionID: Session.ID.make(revision.parentID) })
        const history = yield* context.session.context({ sessionID: root.id })
        const child = yield* context.session.get({ sessionID: Session.ID.make(revision.source.childID) })
        const childHistory = yield* context.session.context({ sessionID: child.id })
        yield* attempt(() => {
          live()
          if (
            planners.get(revision.parentID) !== registration ||
            caps.has(revision.parentID) ||
            !orchestratorRootMatches(root, revision.parentID, snapshotLocation(context.location)) ||
            root.outcome !== "succeeded" ||
            !root.time.idle ||
            child.parentID !== root.id ||
            child.agent !== "planner" ||
            child.outcome !== "succeeded" ||
            child.fork ||
            child.revert ||
            child.time.archived ||
            !child.time.idle ||
            !emptyPermissions(child.permissions) ||
            !same(snapshotLocation(child.location), snapshotLocation(root.location))
          )
            throw new Error("Revision root or Planner identity changed")
          const bound = completedPlannerTurn(history, revision.precedingIdleID, previous.receipt.revision)
          if (!same(bound.planner.effective, previous.receipt) || bound.planner.childID !== child.id)
            throw new Error("Revision source binding changed")
          const result = verifyChildHistory(childHistory, "planner", previous.receipt.input.prompt)
          if (!same(parseProposal(result.text, context.location.directory), revision.proposal))
            throw new Error("Revision proposal changed")
          planners.set(revision.parentID, { kind: "granted", revision })
        })
        return null
      }).pipe(
        Effect.onExit((exit) =>
          Effect.sync(() => {
            if (Exit.isFailure(exit) && planners.get(revision.parentID) === registration)
              planners.set(revision.parentID, { kind: "closed" })
          }),
        ),
      )
    })
  let revoked = false
  // The location-scoped host activation owns one worktree. Hold exclusion from
  // before the wake through settlement/verification, independently of the root slots.
  let executing: { cap: ExecutionOwner; native?: { call: Reservation; child: ChildBinding } } | undefined
  const live = () => {
    if (revoked) throw new Error("Server CAP activation was revoked")
  }
  const actor = Agent.ID.make(`cap_sponsor_${randomUUID()}`)
  const committerActor = Agent.ID.make(`commit_sponsor_${randomUUID()}`)
  const reviewerActor = Agent.ID.make(`review_sponsor_${randomUUID()}`)
  // ConfigAgentPlugin runs after external plugins and appends global/agent
  // rules. Narrow even configured allows, without ever elevating a host deny.
  const sponsorPermission = (event: PermissionEvaluation) =>
    Effect.sync(() => {
      if (
        event.agent === actor &&
        (event.action !== "subagent" ||
          event.resources.length !== 1 ||
          event.resources[0] !== target ||
          event.effect !== "allow")
      )
        event.effect = "deny"
      if (
        event.agent === reviewerActor &&
        (event.action !== "subagent" ||
          event.resources.length !== 1 ||
          event.resources[0] !== "reviewer" ||
          event.effect !== "allow")
      )
        event.effect = "deny"
      if (
        event.agent === committerActor &&
        (event.action !== "subagent" ||
          event.resources.length !== 1 ||
          event.resources[0] !== "committer" ||
          event.effect !== "allow")
      )
        event.effect = "deny"
      if (event.agent === "committer" && (event.action !== committerGitName || event.effect !== "allow"))
        event.effect = "deny"
      if (event.agent === "reviewer" && (!reviewerTool(event.action) || event.effect !== "allow")) event.effect = "deny"
    })
  const local = (cap: ExecutionOwner, claim: VerifiedImplementation["claim"] = cap.claim) => {
    live()
    cap.live()
    if (workers.get(claim.rootSessionID) !== cap) throw new Error("Execution owner was superseded")
    if (!candidateIntact(claim.candidate)) throw new Error("Frozen proposal integrity changed")
    if (!same(snapshotLocation(context.location), claim.location)) throw new Error("Server location changed")
    parseProposal(JSON.stringify(claim.candidate.proposal), claim.candidate.root)
  }
  const rootIdentity = (claim: VerifiedImplementation["claim"], root: Session.Info) => {
    if (!orchestratorRootMatches(root, claim.rootSessionID, claim.location))
      throw new Error("Root role, location, or permissions changed")
  }
  const baseline = (claim: VerifiedImplementation["claim"]) => ({
    root: claim.candidate.root,
    head: claim.candidate.head,
    paths: [],
  })
  const observedCall = (
    control: Readonly<{ id: string; text: string }>,
    expected: unknown,
    history: readonly SessionMessage.Info[],
    call: Reservation,
    status: "running" | "completed",
  ) => {
    const controls = history.filter((message) => message.id === control.id)
    const messages = history.filter((message) => message.id === call.messageID)
    const message = messages[0]
    if (
      controls.length !== 1 ||
      controls[0]?.type !== "synthetic" ||
      controls[0].text !== control.text ||
      messages.length !== 1 ||
      message?.type !== "assistant" ||
      message.agent !== "orchestrator" ||
      message.error
    )
      throw new Error("Published call/control identity changed")
    const start = history.indexOf(controls[0])
    const end = history.indexOf(message)
    if (
      start >= end ||
      history
        .slice(start + 1)
        .some(
          (item) => !["assistant", "idle", "compaction", "model-switched"].includes(item.type) && !knownReceipt(item),
        )
    )
      throw new Error("Call does not follow its exact control input")
    const parts = message.content.filter((part) => part.type === "tool" && part.id === call.id)
    if (
      parts.length !== 1 ||
      parts[0]?.type !== "tool" ||
      parts[0].name !== "subagent" ||
      parts[0].state.status !== status
    )
      throw new Error("Published native call is missing or aliased")
    // Parser-failed calls skip execute.before but remain published tool parts.
    // Include every tool state when identifying the first post-control contender.
    const first = history
      .slice(start + 1)
      .flatMap((item) => (item.type === "assistant" ? item.content : []))
      .find((part) => part.type === "tool")
    if (first !== parts[0]) throw new Error("Earlier tool contender follows CAP control input")
    if (!exactKeys(parts[0].state.input, ["agent", "description", "prompt"]) || !same(parts[0].state.input, expected))
      throw new Error("Native arguments differ from frozen contract")
    return parts[0]
  }
  const argumentsFor = (cap: ExecutionOwner) =>
    cap instanceof RepairClaim || cap instanceof CommitClaim ? cap.arguments : nativeArguments(cap.claim.candidate)
  const requireArguments = (input: unknown, cap: ExecutionOwner) => {
    if (!exactKeys(input, ["agent", "description", "prompt"]) || !same(input, argumentsFor(cap)))
      throw new Error("Native arguments differ from frozen contract")
  }
  const reviewedFresh = (cap: RepairClaim | CommitClaim) => {
    local(cap)
    if (executing?.cap !== cap) throw new Error("Reviewed execution claim lost exclusion")
    const { claim, target } = cap.evidence.implementation
    requireInScope(
      observeGit(claim.location.directory!, baseline(claim)),
      baseline(claim),
      claim.candidate.proposal.files,
    )
    requireReviewTarget(observeReviewTarget(claim.location.directory!, target), target)
  }
  const reviewBoundary = (evidence: VerifiedReview, history: readonly SessionMessage.Info[], controlID?: string) => {
    const { boundary } = evidence
    const prefix = history.slice(0, boundary.length)
    const tail = history.slice(boundary.length)
    const control = tail.findIndex((message) => message.id === controlID)
    if (
      prefix.length !== boundary.length ||
      historyDigest(prefix) !== boundary.digest ||
      (control < 0 ? tail : tail.slice(0, control)).some((message) => !knownReceipt(message))
    )
      throw new Error("Reviewed root history was superseded")
  }
  const actualCall = (
    cap: ExecutionOwner,
    history: readonly SessionMessage.Info[],
    call: Reservation,
    status: "running" | "completed",
  ) => observedCall(cap.control, argumentsFor(cap), history, call, status)
  const before = (event: ToolHooks["execute.before"]) =>
    Effect.gen(function* () {
      yield* attempt(live)
      if (event.agent === "committer" && event.tool !== committerGitName) {
        retireCommitCaller(event.sessionID, "Committer requested a forbidden tool")
        return yield* Effect.fail(fail("Committer may use only committer_git"))
      }
      if (event.tool === committerGitName) {
        yield* commitToolOwner(event.input, event).pipe(
          Effect.onError(() =>
            Effect.sync(() => retireCommitCaller(event.sessionID, "Committer tool admission failed")),
          ),
        )
        return
      }
      if (
        event.input &&
        typeof event.input === "object" &&
        "agent" in event.input &&
        event.input.agent === "committer" &&
        !(workers.get(event.sessionID) instanceof CommitClaim)
      )
        return yield* Effect.fail(fail("No explicitly authorized Committer call"))
      if (event.agent === "reviewer" && !reviewerTool(event.tool))
        return yield* Effect.fail(fail("Reviewer is read-only"))
      if (event.tool === reviewerGitName) {
        yield* attempt(() => {
          if (event.agent !== "reviewer") throw new Error("Git inspection is Reviewer-only")
          reviewerGitArguments(event.input)
        })
        return
      }
      const review = reviews.get(event.sessionID)
      if (review) {
        yield* attempt(() => {
          const call = { sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id }
          currentContender(call, review)
          if (review.admission.kind !== "available")
            throw new Error("Reviewer admission is reserved, consumed, or closed")
          recordContender(call, review)
          review.admission = {
            kind: "reserved",
            call: frozenCopy({
              sessionID: event.sessionID,
              agent: event.agent,
              messageID: event.messageID,
              id: event.id,
            }),
          }
        })
        yield* attempt(() => {
          if (event.tool !== "subagent" || event.agent !== "orchestrator")
            throw new Error("Unexpected first Reviewer contender")
        }).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              review.admission = { kind: "closed" }
            }),
          ),
        )
        return
      }
      if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === "reviewer")
        return yield* Effect.fail(fail("No reserved Reviewer call"))
      const cap = workers.get(event.sessionID) ?? caps.get(event.sessionID)
      if (!cap || event.sessionID !== cap.rootSessionID) {
        if (event.agent !== "orchestrator" || directRootTool(event.tool)) {
          if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === target)
            yield* Effect.fail(fail("No reserved Implementer call"))
          return
        }
        // Tool hooks expose no parent identity. Preserve nested passthrough.
        const root = yield* context.session.get({ sessionID: event.sessionID })
        if (root.id === event.sessionID && root.parentID) return
        yield* attempt(() => {
          live()
          const slot = planners.get(event.sessionID)
          if (slot && (slot.kind !== "granted" || !same(event.input, revisionArguments(slot.revision))))
            throw new Error("One governed Planner attempt per trusted grant")
          if (event.tool !== "subagent") throw new Error("Forbidden root tool contender")
          if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === target)
            throw new Error("No reserved Implementer call")
          plannerArguments(event.input)
        })
        return
      }
      // Select the owner before any awaits. A losing contender cannot close it.
      yield* attempt(() => {
        const call = { sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id }
        currentContender(call, cap)
        cap.reserve(call)
        recordContender(call, cap)
      })
      yield* attempt(() => {
        if (event.tool !== "subagent" || event.agent !== "orchestrator") throw new Error("Unexpected first contender")
      }).pipe(
        Effect.onError(() => Effect.sync(() => cap.close())),
        Effect.onInterrupt(() => Effect.sync(() => cap.close())),
      )
    }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : fail(String(error)))))
  type PrepareInput = (input: unknown) => Effect.Effect<unknown, Tool.Error>
  const executeReview = (
    original: Tool.Info["execute"],
    prepare: PrepareInput,
    input: unknown,
    invocation: Tool.Context,
    review: ReviewAttempt,
    cap: ExecutionOwner,
  ) =>
    Effect.gen(function* () {
      const { claim, target } = review.implementation
      const call = frozenCopy({
        sessionID: invocation.sessionID,
        agent: invocation.agent,
        messageID: invocation.messageID,
        id: invocation.id,
      })
      // Claim executor entry synchronously. Losers cannot close this owner.
      yield* attempt(() => {
        currentContender(call, review)
        if (review.admission.kind !== "reserved" || !same(review.admission.call, call))
          throw new Error("Reviewer reservation mismatch")
        review.admission = { kind: "entered", call }
      })
      return yield* Effect.gen(function* () {
        const history = yield* context.session.context({ sessionID: invocation.sessionID })
        yield* attempt(() => {
          observedCall(review.control, review.arguments, history, call, "running")
          if (!exactKeys(input, ["agent", "description", "prompt"]) || !same(input, review.arguments))
            throw new Error("Reviewer arguments changed")
        })
        const effective = yield* prepare(input)
        const latest = yield* context.session.context({ sessionID: invocation.sessionID })
        const root = yield* context.session.get({ sessionID: invocation.sessionID })
        const execution = yield* attempt(() => {
          local(cap, claim)
          rootIdentity(claim, root)
          observedCall(review.control, review.arguments, latest, call, "running")
          if (review.admission.kind !== "entered" || !same(review.admission.call, call))
            throw new Error("Reviewer entry lost its exact owner")
          if (reviews.get(claim.rootSessionID) !== review || cap.phase !== "closed" || executing?.cap !== cap)
            throw new Error("Reviewer does not own verified execution exclusion")
          requireReviewTarget(observeReviewTarget(claim.location.directory!, target), target)
          review.admission = { kind: "consumed", call }
          const execution: NonNullable<ReviewAttempt["execution"]> = { call, child: { kind: "unknown" } }
          review.execution = execution
          return execution
        })
        const result = yield* original(effective, {
          ...invocation,
          agent: reviewerActor,
          progress: (update) =>
            Effect.sync(() => bindFreshChild(execution, update.sessionID, call.sessionID)).pipe(
              Effect.andThen(() => invocation.progress(update)),
            ),
        })
        yield* attempt(() => {
          const output = result.output
          bindFreshChild(execution, output?.sessionID, call.sessionID)
          if (
            !exactKeys(output, ["sessionID", "status", "output"]) ||
            typeof output.sessionID !== "string" ||
            !output.sessionID ||
            output.status !== "completed" ||
            typeof output.output !== "string" ||
            result.metadata?.sessionID !== output.sessionID ||
            result.metadata?.status !== "completed"
          )
            throw new Error("Reviewer native completion receipt mismatch")
          if (execution.child.kind !== "exact") throw new Error("Reviewer child identity ambiguous")
          execution.result = frozenCopy(result)
        })
        return result
      }).pipe(
        Effect.catchCause((cause) => {
          review.failure = cause
          return Effect.failCause(cause)
        }),
        Effect.ensuring(
          Effect.sync(() => {
            review.admission = { kind: "closed" }
          }),
        ),
      )
    })
  const executePlanner = (
    original: Tool.Info["execute"],
    prepare: PrepareInput,
    input: unknown,
    invocation: Tool.Context,
  ) =>
    Effect.gen(function* () {
      const location = snapshotLocation(context.location)
      const root = yield* context.session.get({ sessionID: invocation.sessionID })
      // A nested Orchestrator is outside the initial root boundary.
      if (root.id === invocation.sessionID && root.parentID) return yield* original(yield* prepare(input), invocation)
      const call = yield* attempt(() => {
        live()
        const slot = planners.get(invocation.sessionID)
        if (slot && slot.kind !== "granted") throw new Error("One governed Planner attempt per trusted grant")
        return frozenCopy({
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          messageID: invocation.messageID,
          id: invocation.id,
        })
      })
      const grant = planners.get(invocation.sessionID)
      const revision = grant?.kind === "granted" ? grant.revision : undefined
      const history = yield* context.session.context({ sessionID: invocation.sessionID })
      const current = yield* context.session.get({ sessionID: invocation.sessionID })
      const receipt = yield* attempt(() => {
        live()
        if (caps.get(invocation.sessionID)?.rootSessionID === invocation.sessionID)
          throw new Error("Planner follows an admitted CAP claim")
        if (!location.directory || !same(root.time.created, current.time.created))
          throw new Error("Planner root creation or location changed")
        for (const session of [root, current]) {
          if (!orchestratorRootMatches(session, invocation.sessionID, location))
            throw new Error("Planner root identity changed")
        }
        if (!same(snapshotLocation(context.location), location)) throw new Error("Server location changed")
        const bound = plannerTurnInput(history, call, revision)
        if (!same(plannerArguments(input), bound.proposed)) throw new Error("Decoded Planner proposal changed")
        return frozenCopy(bound.effective)
      })
      // Settings preparation is fallible but carries no admission authority.
      // Finish it before the final evidence read and one-shot insertion.
      const effectiveInput = yield* prepare(receipt.input)
      // A later input/history mutation during the identity reads must not be
      // hidden by the earlier context snapshot. This is evidence, not recovery.
      const latest = yield* context.session.context({ sessionID: invocation.sessionID })
      yield* attempt(() => {
        live()
        const observed = plannerTurnInput(latest, call, revision)
        if (
          caps.get(invocation.sessionID)?.rootSessionID === invocation.sessionID ||
          !same(snapshotLocation(context.location), location) ||
          !same(observed.effective, receipt) ||
          !same(observed.proposed, plannerArguments(input))
        )
          throw new Error("Planner turn changed before native execution")
        // The final synchronous barrier owns this exact invocation. No failure
        // or cancellation after entry restores eligibility; contenders before
        // this point never acquired it.
        if (planners.get(invocation.sessionID) !== grant)
          throw new Error("One governed Planner attempt per trusted grant")
        // One synchronous insertion records both admission and its exact input
        // evidence. Native code cannot run between spending and recording it.
        planners.set(invocation.sessionID, Object.freeze({ kind: "admitted", call, receipt }))
      })
      return yield* Effect.gen(function* () {
        // Persist admitted-but-failed evidence through native progress/failure
        // metadata too, so completion cannot downgrade it to a non-governed turn.
        const result = yield* original(effectiveInput, {
          ...invocation,
          progress: (update) => invocation.progress({ ...update, [plannerReceiptKey]: receipt }),
        })
        yield* attempt(() => {
          live()
          if (
            !exactKeys(result.output, ["sessionID", "status", "output"]) ||
            typeof result.output.sessionID !== "string" ||
            !result.output.sessionID ||
            result.output.sessionID === invocation.sessionID ||
            result.output.status !== "completed" ||
            result.metadata?.sessionID !== result.output.sessionID ||
            result.metadata?.status !== "completed"
          )
            throw new Error("Planner did not return a completed native child")
          const slot = planners.get(invocation.sessionID)
          if (slot?.kind !== "admitted" || !same(slot.call, call)) throw new Error("Planner admission changed")
          planners.set(
            invocation.sessionID,
            Object.freeze({ ...slot, kind: "completed", childID: result.output.sessionID }),
          )
        })
        // Tool.Called retains proposed state.input; only trusted metadata records admission.
        const stamped: Tool.Result = { ...result, metadata: { ...result.metadata, [plannerReceiptKey]: receipt } }
        return stamped
      })
    }).pipe(
      Effect.catchCause((cause) => {
        const admitted = planners.get(invocation.sessionID)
        if (
          !admitted ||
          (admitted.kind !== "admitted" && admitted.kind !== "completed") ||
          !same(admitted.call, {
            sessionID: invocation.sessionID,
            agent: invocation.agent,
            messageID: invocation.messageID,
            id: invocation.id,
          })
        )
          return Effect.failCause(cause)
        // Project the already-recorded admission through the supported native
        // failure metadata path, including defects before the first progress.
        const error = Cause.squash(cause)
        return Effect.fail(
          new Tool.Error({
            message: error instanceof Tool.Error ? error.message : String(error),
            error,
            metadata: { ...(error instanceof Tool.Error ? error.metadata : {}), [plannerReceiptKey]: admitted.receipt },
          }),
        )
      }),
    )
  const execute =
    (original: Tool.Info["execute"], prepare: PrepareInput = Effect.succeed) =>
    (input: unknown, invocation: Tool.Context) =>
      Effect.gen(function* () {
        yield* attempt(live)
        const review = reviews.get(invocation.sessionID)
        if (review) {
          const owner = workers.get(invocation.sessionID) ?? caps.get(invocation.sessionID)
          if (!owner) return yield* Effect.fail(fail("Reviewer has no implementation owner"))
          return yield* executeReview(original, prepare, input, invocation, review, owner)
        }
        if (
          input &&
          typeof input === "object" &&
          "agent" in input &&
          input.agent === "committer" &&
          !(workers.get(invocation.sessionID) instanceof CommitClaim)
        )
          return yield* Effect.fail(fail("No explicitly authorized Committer call"))
        if (input && typeof input === "object" && "agent" in input && input.agent === "reviewer")
          return yield* Effect.fail(fail("No reserved Reviewer call"))
        const cap = workers.get(invocation.sessionID) ?? caps.get(invocation.sessionID)
        const governed =
          (!!cap && invocation.sessionID === cap.rootSessionID) ||
          (!!input && typeof input === "object" && "agent" in input && input.agent === target)
        if (!governed) {
          if (
            invocation.agent === "orchestrator" &&
            input !== null &&
            typeof input === "object" &&
            "agent" in input &&
            input.agent === "planner"
          )
            return yield* executePlanner(original, prepare, input, invocation)
          return yield* original(yield* prepare(input), invocation)
        }
        const call: Reservation = {
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          messageID: invocation.messageID,
          id: invocation.id,
        }
        if (!cap) return yield* Effect.fail(fail("No reserved Implementer call"))
        // Executor losers also cannot change an in-flight owner's state.
        yield* attempt(() => {
          currentContender(call, cap)
          cap.enter(call)
        })
        return yield* Effect.gen(function* () {
          const history = yield* context.session.context({ sessionID: invocation.sessionID })
          yield* attempt(() => {
            if (cap instanceof RepairClaim || cap instanceof CommitClaim)
              reviewBoundary(cap.evidence, history, cap.control.id)
            actualCall(cap, history, call, "running")
            requireArguments(input, cap)
          })
          // Decode/validate settings before consuming CAP or claiming an unknown
          // child. On failure the existing pre-admission close/settlement releases
          // exclusion, without changing this root's accepted-claim contract.
          const effectiveInput = yield* prepare(input)
          const latest =
            cap instanceof RepairClaim || cap instanceof CommitClaim
              ? yield* context.session.context({ sessionID: invocation.sessionID })
              : undefined
          const root = yield* context.session.get({ sessionID: invocation.sessionID })
          // All awaited reads precede the final synchronous freshness/consume barrier.
          const lease = yield* attempt(() => {
            rootIdentity(cap.claim, root)
            local(cap)
            requireArguments(input, cap)
            if (!candidateIntact(cap.claim.candidate)) throw new Error("Frozen claim integrity changed")
            if (executing?.cap !== cap) throw new Error("Root does not own worktree implementation exclusion")
            if (cap instanceof RepairClaim || cap instanceof CommitClaim) {
              if (!sameSettlement(root, cap.evidence.boundary)) throw new Error("Reviewed root settlement changed")
              if (latest) {
                reviewBoundary(cap.evidence, latest, cap.control.id)
                actualCall(cap, latest, call, "running")
              }
              reviewedFresh(cap)
            } else requireFresh(observeGit(cap.claim.location.directory!, baseline(cap.claim)), baseline(cap.claim))
            cap.consume(call)
            return executing
          })
          const execution: { call: Reservation; child: ChildBinding } = { call, child: { kind: "unknown" } }
          lease.native = execution
          // Pinned OpenCode seam: native Permission.assert uses this explicit actor,
          // the real parent/source IDs, and effective policy before creating a child.
          const result = yield* original(effectiveInput, {
            ...invocation,
            agent: cap instanceof CommitClaim ? committerActor : actor,
            progress: (update) =>
              Effect.sync(() => bindFreshChild(execution, update.sessionID, call.sessionID)).pipe(
                Effect.andThen(() => invocation.progress(update)),
              ),
          })
          yield* attempt(() => {
            if (
              cap instanceof CommitClaim &&
              (!exactKeys(result.output, ["sessionID", "status", "output"]) ||
                result.metadata?.sessionID !== result.output?.sessionID ||
                result.metadata?.status !== "completed")
            )
              throw new Error("Committer native completion mismatch")
            if (cap instanceof CommitClaim) cap.nativeText = result.output?.output
            cap.receipt(result)
            bindFreshChild(execution, cap.childID, call.sessionID)
          })
          return result // Native output normalization, after hooks and publication remain native.
        }).pipe(
          Effect.onError(() => Effect.sync(() => cap.close())),
          Effect.onInterrupt(() => Effect.sync(() => cap.close())),
        )
      }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : fail(String(error)))))
  const verifyImplementation = (cap: ExecutionOwner) =>
    Effect.gen(function* () {
      yield* attempt(() => local(cap))
      if (cap.phase !== "consumed" || !cap.childID || !cap.result)
        return yield* Effect.fail(fail("Root settled without a verified native execution"))
      const claim = cap.claim
      const childID = Session.ID.make(cap.childID)
      const root = yield* context.session.get({ sessionID: Session.ID.make(claim.rootSessionID) })
      const child = yield* context.session.get({ sessionID: childID })
      const history = yield* context.session.context({ sessionID: Session.ID.make(claim.rootSessionID) })
      const childHistory = yield* context.session.context({ sessionID: childID })
      return yield* attempt(() => {
        rootIdentity(claim, root)
        local(cap)
        if (
          root.outcome !== "succeeded" ||
          !root.time.idle ||
          child.id !== childID ||
          child.parentID !== root.id ||
          child.agent !== target ||
          child.fork ||
          child.revert ||
          child.time.archived ||
          !same(snapshotLocation(child.location), claim.location) ||
          !emptyPermissions(child.permissions) ||
          child.outcome !== "succeeded" ||
          !child.time.idle
        )
          throw new Error("Native root/child completion binding failed")
        const users = childHistory.filter((message) => message.type === "user")
        const assistants = childHistory.filter((message) => message.type === "assistant")
        const final = assistants.at(-1)
        if (
          users.length !== 1 ||
          childHistory[0] !== users[0] ||
          childHistory.some((message) => !["user", "assistant", "idle", "model-switched"].includes(message.type)) ||
          users[0]?.text !== nativeBootstrap(argumentsFor(cap).prompt) ||
          [users[0]?.files, users[0]?.agents, users[0]?.skills].some((items) => items && items.length) ||
          !final ||
          final.finish !== "stop" ||
          final.agent !== target ||
          final.error ||
          assistants.some((message) => message.agent !== target)
        )
          throw new Error("Native child input/result binding failed")
        // The original structured completion was captured before after hooks.
        // Persisted display formatting/truncation supplies no authority.
        const reservation = cap.reservation
        cap.assertConsumed(reservation)
        const part = actualCall(cap, history, reservation, "completed")
        if (
          part.state.status !== "completed" ||
          part.state.metadata?.sessionID !== childID ||
          part.state.metadata?.status !== "completed"
        )
          throw new Error("Published native completion identity changed")
        const paths = requireInScope(
          observeGit(claim.location.directory!, baseline(claim)),
          baseline(claim),
          claim.candidate.proposal.files,
        )
        cap.live()
        const reviewTarget = observeReviewTarget(claim.location.directory!, { ...baseline(claim), paths })
        const implementation: VerifiedImplementation = frozenCopy({
          claim: { candidate: claim.candidate, rootSessionID: claim.rootSessionID, location: claim.location },
          identity: {
            rootSessionID: claim.rootSessionID,
            messageID: reservation.messageID,
            toolID: reservation.id,
            childID,
          },
          target: reviewTarget,
        })
        return implementation
      })
    })
  const verifyReview = (cap: ExecutionOwner, review: ReviewAttempt) =>
    Effect.gen(function* () {
      const { claim, target } = review.implementation
      const execution = yield* attempt(() => {
        local(cap, claim)
        if (!review.execution || review.execution.child.kind !== "exact" || !review.execution.result)
          throw new Error("Reviewer settled without a verified native execution")
        return review.execution
      })
      const childID = yield* attempt(() => {
        if (execution.child.kind !== "exact") throw new Error("Reviewer identity ambiguous")
        return Session.ID.make(execution.child.childID)
      })
      const root = yield* context.session.get({ sessionID: Session.ID.make(claim.rootSessionID) })
      const child = yield* context.session.get({ sessionID: childID })
      const history = yield* context.session.context({ sessionID: root.id })
      const childHistory = yield* context.session.context({ sessionID: childID })
      const evidence = yield* attempt(() => {
        local(cap, claim)
        rootIdentity(claim, root)
        if (
          root.outcome !== "succeeded" ||
          !root.time.idle ||
          child.id !== childID ||
          child.parentID !== root.id ||
          child.agent !== "reviewer" ||
          child.fork ||
          child.revert ||
          child.time.archived ||
          !same(snapshotLocation(child.location), claim.location) ||
          !emptyPermissions(child.permissions) ||
          child.outcome !== "succeeded" ||
          !child.time.idle
        )
          throw new Error("Reviewer root/child completion binding failed")
        const users = childHistory.filter((message) => message.type === "user")
        const assistants = childHistory.filter((message) => message.type === "assistant")
        const final = assistants.at(-1)
        const terminals = assistants.filter((message) => message.finish === "stop")
        if (
          users.length !== 1 ||
          childHistory[0] !== users[0] ||
          users[0]?.text !== nativeBootstrap(review.arguments.prompt) ||
          [users[0]?.files, users[0]?.agents, users[0]?.skills].some((items) => items && items.length) ||
          childHistory.some(
            (message) =>
              !["user", "assistant", "idle", "model-switched"].includes(message.type) &&
              !nativeReadInstruction(message),
          ) ||
          childHistory.at(-1)?.type !== "idle" ||
          childHistory.some((message) => message.type === "idle" && message.outcome !== "succeeded") ||
          !final ||
          terminals.length !== 1 ||
          terminals[0] !== final ||
          assistants.some(
            (message) =>
              message.agent !== "reviewer" ||
              message.error ||
              message.content.some(
                (part) =>
                  part.type === "tool" &&
                  (part.executed === true ||
                    !reviewerTool(part.name) ||
                    !["completed", "error"].includes(part.state.status)),
              ),
          )
        )
          throw new Error("Reviewer input/final history is missing or ambiguous")
        const result = execution.result
        const text = final.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
        if (!result || result.output?.sessionID !== childID || result.output?.output !== text)
          throw new Error("Reviewer structured result differs from terminal child text")
        const part = observedCall(review.control, review.arguments, history, execution.call, "completed")
        const start = history.findIndex((message) => message.id === review.control.id)
        const contenders = history
          .slice(start + 1)
          .flatMap((message) =>
            message.type === "assistant" ? message.content.filter((part) => part.type === "tool") : [],
          )
        if (
          contenders.length !== 1 ||
          part.state.status !== "completed" ||
          part.state.metadata?.sessionID !== childID ||
          part.state.metadata?.status !== "completed"
        )
          throw new Error("Reviewer published completion mismatch")
        // Re-observe exact bytes only after the final trusted host reads.
        const current = observeReviewTarget(claim.location.directory!, target)
        requireInScope(current, baseline(claim), claim.candidate.proposal.files)
        requireReviewTarget(current, target)
        const parsed = parseReviewResult(text)
        const rootIdle = history.filter((message) => message.type === "idle").at(-1)
        if (
          rootIdle?.type !== "idle" ||
          rootIdle.outcome !== "succeeded" ||
          !rootIdle.id.startsWith("msg_") ||
          history.filter((message) => message.id === rootIdle.id).length !== 1 ||
          history.indexOf(rootIdle) <= history.findIndex((message) => message.id === execution.call.messageID)
        )
          throw new Error("Reviewer root terminal identity is missing")
        local(cap, claim)
        if (reviews.get(claim.rootSessionID) !== review) throw new Error("Reviewer owner was superseded")
        return frozenCopy({
          implementation: review.implementation,
          result: parsed,
          reviewer: { messageID: execution.call.messageID, toolID: execution.call.id, childID, resultID: final.id },
          boundary: {
            length: history.length,
            digest: historyDigest(history),
            // structuredClone strips host DateTime prototypes. Bind the exact
            // creation and settlement epochs before freezing later evidence.
            created: DateTime.toEpochMillis(root.time.created),
            idle: DateTime.toEpochMillis(root.time.idle),
            rootIdleID: rootIdle.id,
          },
        })
      })
      const boundary = yield* Deferred.await(terminalNotification(evidence.boundary.rootIdleID))
      return yield* attempt(() => {
        local(cap, claim)
        if (boundary.rootSessionID !== claim.rootSessionID || reviews.get(claim.rootSessionID) !== review)
          throw new Error("Reviewer terminal notification belongs to another root or owner")
        return frozenCopy({ ...evidence, boundary: { ...evidence.boundary, rootEventSeq: boundary.rootEventSeq } })
      })
    })
  const runReview = (
    cap: ExecutionOwner,
    implementation: VerifiedImplementation,
    settlement: (proven: boolean) => void,
  ) =>
    Effect.gen(function* () {
      const { claim, identity, target } = implementation
      const rootID = Session.ID.make(claim.rootSessionID)
      const review = yield* attempt(() => {
        local(cap, claim)
        if (reviews.get(rootID)?.implementation === implementation || executing?.cap !== cap)
          throw new Error("Reviewer attempt is unavailable")
        const args = reviewerArguments(claim.candidate, target, identity)
        const review: ReviewAttempt = {
          implementation,
          arguments: args,
          control: Object.freeze({
            id: `msg_${randomUUID()}`,
            text: [
              "Propose exactly one foreground native subagent call with exactly these arguments:",
              JSON.stringify(args),
              "Do not add keys, reuse a session, alter values, substitute roles, or retry. After its result finish with prose and STOP before Commit.",
            ].join("\n"),
          }),
          admission: { kind: "available" },
        }
        cap.close()
        reviews.set(rootID, review)
        return review
      })
      // Implementation settlement cannot settle this new root/child execution.
      settlement(false)
      const wake = yield* Effect.gen(function* () {
        const admitted = yield* context.session.synthetic({
          sessionID: rootID,
          id: SessionMessage.ID.make(review.control.id),
          text: review.control.text,
          delivery: "steer",
          resume: true,
        })
        yield* attempt(() => {
          local(cap, claim)
          if (
            admitted.id !== review.control.id ||
            admitted.sessionID !== rootID ||
            admitted.type !== "synthetic" ||
            admitted.delivery !== "steer" ||
            admitted.payload.text !== review.control.text
          )
            throw new Error("Reviewer synthetic wake changed")
        })
      }).pipe(Effect.exit)
      if (Exit.isFailure(wake)) review.admission = { kind: "closed" }
      const rootSettled = yield* context.session.wait({ sessionID: rootID }).pipe(Effect.exit)
      review.admission = { kind: "closed" }
      if (Exit.isFailure(rootSettled))
        return { outcome: { kind: "unverified" as const, cause: rootSettled.cause }, publish: false }
      const childSettled = yield* Effect.gen(function* () {
        const execution = review.execution
        if (!execution) {
          settlement(true)
          return
        }
        const id = yield* attempt(() => {
          if (execution.child.kind !== "exact") throw new Error("Reviewer settlement identity unknown")
          return Session.ID.make(execution.child.childID)
        })
        yield* context.session.wait({ sessionID: id })
        const child = yield* context.session.get({ sessionID: id })
        yield* attempt(() => {
          local(cap, claim)
          if (
            child.id !== id ||
            child.parentID !== rootID ||
            child.agent !== "reviewer" ||
            child.fork ||
            child.revert ||
            child.time.archived ||
            !same(snapshotLocation(child.location), claim.location) ||
            !emptyPermissions(child.permissions) ||
            !child.time.idle ||
            !["succeeded", "failed", "interrupted"].includes(child.outcome ?? "")
          )
            throw new Error("Exact Reviewer terminal settlement was not proven")
          settlement(true)
        })
      }).pipe(Effect.exit)
      const outcome: ReviewOutcome = Exit.isFailure(wake)
        ? { kind: "unverified", cause: wake.cause }
        : Exit.isFailure(childSettled)
          ? { kind: "unverified", cause: childSettled.cause }
          : review.failure
            ? { kind: "unverified", cause: review.failure }
            : yield* verifyReview(cap, review).pipe(
                Effect.map((evidence): ReviewOutcome => ({ kind: "verified", evidence })),
                Effect.catchCause((cause) => Effect.succeed<ReviewOutcome>({ kind: "unverified", cause })),
              )
      return { outcome, publish: true }
    })
  const publishReceipt = (rootSessionID: string, receipt: string) =>
    Effect.suspend(() => {
      const id = `msg_${randomUUID()}`
      receipts.set(id, Object.freeze({ rootSessionID, text: receipt }))
      return context.session.synthetic({
        ...receiptInput(Session.ID.make(rootSessionID), receipt),
        id: SessionMessage.ID.make(id),
      })
    }).pipe(Effect.catchCause((cause) => Effect.logWarning("Terminal receipt publication failed", Cause.pretty(cause))))
  const authorize = (input: unknown) =>
    Effect.gen(function* () {
      const cap = yield* attempt(() => {
        live()
        if (
          !input ||
          typeof input !== "object" ||
          !("rootSessionID" in input) ||
          typeof input.rootSessionID !== "string" ||
          !input.rootSessionID
        )
          throw new Error("Malformed Authorize root identity")
        const id = input.rootSessionID
        let slot = caps.get(id)
        if (!slot) {
          slot = new NativeCap()
          caps.set(id, slot)
        }
        slot.accept(input, controlText)
        if (slot.rootSessionID !== id) {
          slot.close()
          throw new Error("Authorize root identity changed during transfer")
        }
        return slot
      })
      workers.set(cap.claim.rootSessionID, cap)
      return yield* runCycle(cap)
    }).pipe(Effect.catchCause((cause) => Effect.succeed(terminal(unverified(cause)))))
  const terminal = (receipt: string): CycleOutcome => ({ kind: "terminal", receipt })
  const runCycle = (cap: ExecutionOwner) =>
    Effect.gen(function* () {
      const rootSessionID = cap.claim.rootSessionID
      let settlementProven = false
      return yield* Effect.gen(function* () {
        const admission = yield* Effect.gen(function* () {
          yield* attempt(() => {
            local(cap)
          })
          const root = yield* context.session.get({ sessionID: Session.ID.make(rootSessionID) })
          yield* attempt(() => {
            rootIdentity(cap.claim, root)
            local(cap)
            if (cap instanceof RepairClaim || cap instanceof CommitClaim) {
              if (!sameSettlement(root, cap.evidence.boundary))
                throw new Error("Repair root is not the reviewed settled root")
              reviewedFresh(cap)
            } else {
              acquire(cap)
              requireFresh(observeGit(cap.claim.location.directory!, baseline(cap.claim)), baseline(cap.claim))
            }
          })
          if (cap instanceof RepairClaim) {
            const history = yield* context.session.context({ sessionID: Session.ID.make(rootSessionID) })
            const latestRoot = yield* context.session.get({ sessionID: Session.ID.make(rootSessionID) })
            yield* attempt(() => {
              rootIdentity(cap.claim, latestRoot)
              if (!sameSettlement(latestRoot, cap.evidence.boundary))
                throw new Error("Repair root changed during preparation")
              reviewBoundary(cap.evidence, history, cap.control.id)
              reviewedFresh(cap)
            })
          }
          const { id, text } = cap.control
          const wake = yield* context.session.synthetic({
            sessionID: Session.ID.make(cap.claim.rootSessionID),
            id: SessionMessage.ID.make(id),
            text,
            delivery: "steer",
            resume: true,
          })
          yield* attempt(() => {
            cap.live()
            if (
              wake.id !== id ||
              wake.sessionID !== cap.rootSessionID ||
              wake.type !== "synthetic" ||
              wake.delivery !== "steer" ||
              wake.payload.text !== text
            )
              throw new Error("Synthetic wake admission changed")
          })
        }).pipe(Effect.exit)
        if (Exit.isFailure(admission)) cap.close()
        // Even ambiguous wake/admission failures must finish their native busy
        // period before a new steer can safely be presentation-only.
        const settled = yield* context.session.wait({ sessionID: Session.ID.make(rootSessionID) }).pipe(Effect.exit)
        if (Exit.isFailure(settled)) return terminal(unverified(settled.cause))
        const lease = executing?.cap === cap ? executing : undefined
        let settlementFailure: Cause.Cause<unknown> | undefined
        if (lease?.native) {
          // Root idle does not settle a backgrounded native child. Progress is
          // emitted by the built-in executor after creation and before its prompt;
          // a completed structured receipt can supply the same identity.
          const execution = lease.native
          const childSettled = yield* Effect.gen(function* () {
            const childID = yield* attempt(() => {
              if (execution.child.kind !== "exact") throw new Error("Implementer settlement identity unknown")
              if (execution.call.sessionID !== rootSessionID) throw new Error("Implementer settlement root changed")
              return Session.ID.make(execution.child.childID)
            })
            yield* context.session.wait({ sessionID: childID })
            const child = yield* context.session.get({ sessionID: childID })
            yield* attempt(() => {
              live()
              if (
                child.id !== childID ||
                child.parentID !== rootSessionID ||
                child.agent !== target ||
                child.fork ||
                child.revert ||
                child.time.archived ||
                !same(snapshotLocation(child.location), cap.claim.location) ||
                !child.time.idle ||
                !["succeeded", "failed", "interrupted"].includes(child.outcome ?? "")
              )
                throw new Error("Exact Implementer terminal settlement was not proven")
            })
          }).pipe(Effect.exit)
          settlementProven = Exit.isSuccess(childSettled)
          if (Exit.isFailure(childSettled)) settlementFailure = childSettled.cause
        } else {
          // The root finished without entering the native executor. Closing its
          // CAP prevents any later contender from creating a child.
          settlementProven = true
        }
        const gate: ImplementationGate = Exit.isFailure(admission)
          ? { kind: "unverified", cause: admission.cause }
          : settlementFailure
            ? { kind: "unverified", cause: settlementFailure }
            : yield* verifyImplementation(cap).pipe(
                Effect.map((implementation): ImplementationGate => ({ kind: "verified", implementation })),
                Effect.catchCause((cause) => Effect.succeed<ImplementationGate>({ kind: "unverified", cause })),
              )
        cap.close()
        // This accepted RPC alone owns presentation. Publication failure cannot
        // change or retry the verified outcome or grant execution authority.
        if (gate.kind === "unverified") {
          const receipt = unverified(gate.cause)
          yield* publishReceipt(rootSessionID, receipt)
          return terminal(receipt)
        }
        const implementation = gate.implementation
        const { target: reviewTarget } = implementation
        const implementationReceipt = [
          "Implementation gate completed successfully.",
          `HEAD ${reviewTarget.head} remained unchanged.`,
          `Resulting paths (${reviewTarget.paths.length}): ${reviewTarget.paths.map(displayPath).join(", ") || "(none)"}.`,
        ].join("\n")
        yield* publishReceipt(rootSessionID, implementationReceipt)
        const review = yield* runReview(cap, implementation, (proven) => {
          settlementProven = proven
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.succeed({ outcome: { kind: "unverified" as const, cause }, publish: false }),
          ),
        )
        const receipt =
          review.outcome.kind === "verified"
            ? reviewReceipt(review.outcome.evidence.result)
            : reviewUnverified(review.outcome.cause)
        if (review.publish) yield* publishReceipt(rootSessionID, receipt)
        const combined = [implementationReceipt, receipt].join("\n")
        if (review.outcome.kind !== "verified" || !settlementProven || executing?.cap !== cap) return terminal(combined)
        const finalHistory = yield* context.session.context({ sessionID: Session.ID.make(rootSessionID) })
        const finalRoot = yield* context.session.get({ sessionID: Session.ID.make(rootSessionID) })
        return yield* attempt((): CycleOutcome => {
          if (review.outcome.kind !== "verified" || !settlementProven || executing?.cap !== cap)
            return terminal(combined)
          local(cap, implementation.claim)
          const evidence = review.outcome.evidence
          rootIdentity(implementation.claim, finalRoot)
          if (!sameSettlement(finalRoot, evidence.boundary)) throw new Error("Reviewed root changed during publication")
          reviewBoundary(evidence, finalHistory)
          settledRoots.set(evidence.boundary.rootIdleID, rootSessionID)
          // Publication may await external activity. Keep exclusion until its
          // completion and reject any drift before making a decision selectable.
          requireInScope(
            observeGit(implementation.claim.location.directory!, baseline(implementation.claim)),
            baseline(implementation.claim),
            implementation.claim.candidate.proposal.files,
          )
          requireReviewTarget(
            observeReviewTarget(implementation.claim.location.directory!, evidence.implementation.target),
            evidence.implementation.target,
          )
          if ((latestActivity.get(rootSessionID) ?? -1) > evidence.boundary.rootEventSeq)
            throw new Error("Reviewed root activity was superseded during publication")
          reviewBoundaries.set(rootSessionID, { rootSessionID, rootEventSeq: evidence.boundary.rootEventSeq })
          executing = undefined
          if (evidence.result.status === "APPROVED") currentReviews.set(rootSessionID, evidence)
          if (evidence.result.status === "INCONCLUSIVE") return terminal(combined)
          const decision = Object.freeze({ id: randomUUID(), evidence })
          if (evidence.result.status === "APPROVED") pendingCommits.set(decision.id, decision)
          else pending.set(decision.id, decision)
          const presented = frozenCopy({
            id: decision.id,
            rootSessionID,
            rootIdleID: evidence.boundary.rootIdleID,
            rootEventSeq: evidence.boundary.rootEventSeq,
            candidate: implementation.claim.candidate,
            target: evidence.implementation.target,
            reviewer: evidence.reviewer,
            receipts: [...receipts]
              .filter(([, receipt]) => receipt.rootSessionID === rootSessionID)
              .map(([id, receipt]) => ({ id, text: receipt.text })),
          })
          return evidence.result.status === "APPROVED"
            ? { kind: "commit", receipt: combined, decision: frozenCopy({ ...presented, result: evidence.result }) }
            : { kind: "repair", receipt: combined, decision: frozenCopy({ ...presented, result: evidence.result }) }
        })
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cap.close()
            const review = workers.get(rootSessionID) === cap ? reviews.get(rootSessionID) : undefined
            if (review) review.admission = { kind: "closed" }
            // Unknown settlement retains exclusion until activation teardown.
            if (settlementProven && executing?.cap === cap) executing = undefined
          }),
        ),
      )
    }).pipe(Effect.catchCause((cause) => Effect.succeed(terminal(unverified(cause)))))
  const retireCommitCaller = (sessionID: string, reason: string) => {
    const cap = executing?.cap
    if (
      cap instanceof CommitClaim &&
      executing?.native?.child.kind === "exact" &&
      executing.native.child.childID === sessionID
    ) {
      cap.toolFailure = reason
      cap.git.close()
      cap.close()
    }
  }
  const commitChild = (cap: CommitClaim, child: Session.Info, history: readonly SessionMessage.Info[]) => {
    const lease = executing
    if (
      lease?.cap !== cap ||
      lease.native?.child.kind !== "exact" ||
      child.id !== lease.native.child.childID ||
      child.parentID !== cap.rootSessionID ||
      child.agent !== "committer" ||
      child.fork ||
      child.revert ||
      child.time.archived ||
      !same(snapshotLocation(child.location), cap.claim.location) ||
      !emptyPermissions(child.permissions)
    )
      throw new Error("Exact fresh Committer identity changed")
    const users = history.filter((message) => message.type === "user")
    if (
      users.length !== 1 ||
      history[0] !== users[0] ||
      users[0]?.text !== nativeBootstrap(cap.arguments.prompt) ||
      [users[0]?.files, users[0]?.agents, users[0]?.skills].some((items) => items && items.length) ||
      history.some((message) => !["user", "assistant", "idle", "model-switched"].includes(message.type)) ||
      history.some(
        (message) =>
          message.type === "assistant" &&
          (message.agent !== "committer" ||
            message.error ||
            message.content.some(
              // The host publishes malformed JSON as an errored local tool
              // without invoking execution hooks. executed=false also occurs
              // on valid local calls, so only the error state retires those.
              (part) =>
                part.type === "tool" &&
                (part.name !== committerGitName || part.executed === true || part.state.status === "error"),
            )),
      )
    )
      throw new Error("Committer bootstrap/history changed or forbidden/errored tool appeared")
  }
  const commitGate = (cap: CommitClaim) => {
    local(cap)
    if (cap.phase !== "consumed" || executing?.cap !== cap || executing.native?.child.kind !== "exact")
      throw new Error("Commit tool lost live consumed authority or exact child")
  }
  const commitToolOwner = (
    input: unknown,
    invocation: Pick<Tool.Context, "sessionID" | "agent" | "messageID" | "id">,
  ) =>
    Effect.gen(function* () {
      const cap = yield* attempt(() => {
        live()
        decodeCommitterInput(input)
        const cap = executing?.cap
        if (
          !(cap instanceof CommitClaim) ||
          invocation.agent !== "committer" ||
          executing?.native?.child.kind !== "exact" ||
          executing.native.child.childID !== invocation.sessionID
        )
          throw new Error("Caller is not the admitted Committer")
        commitGate(cap)
        return cap
      })
      const rootHistory = yield* context.session.context({ sessionID: Session.ID.make(cap.claim.rootSessionID) })
      const root = yield* context.session.get({ sessionID: Session.ID.make(cap.claim.rootSessionID) })
      const history = yield* context.session.context({ sessionID: invocation.sessionID })
      const child = yield* context.session.get({ sessionID: invocation.sessionID })
      return yield* attempt(() => {
        commitGate(cap)
        rootIdentity(cap.claim, root)
        if (DateTime.toEpochMillis(root.time.created) !== cap.evidence.boundary.created)
          throw new Error("Commit root creation changed")
        reviewBoundary(cap.evidence, rootHistory, cap.control.id)
        actualCall(cap, rootHistory, cap.reservation, "running")
        commitChild(cap, child, history)
        const messages = history.filter((message) => message.id === invocation.messageID)
        const message = messages[0]
        const parts =
          message?.type === "assistant"
            ? message.content.filter((part) => part.type === "tool" && part.id === invocation.id)
            : []
        const part = parts[0]
        if (
          messages.length !== 1 ||
          parts.length !== 1 ||
          part?.type !== "tool" ||
          part.name !== committerGitName ||
          part.state.status !== "running" ||
          !same(part.state.input, input)
        )
          throw new Error("Committer tool input/caller is missing or ambiguous")
        return cap
      })
    }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : fail(String(error)))))
  const commitReceipt = (cap: CommitClaim, facts: string) =>
    [
      facts,
      `Approved Reviewer provenance: ${JSON.stringify(cap.evidence.reviewer)}`,
      `Committer provenance: ${JSON.stringify({ decisionID: cap.decisionID, call: executing?.cap === cap ? executing.native?.call : undefined, child: executing?.cap === cap ? executing.native?.child : undefined })}`,
      `Approved target: ${JSON.stringify(cap.evidence.implementation.target)}`,
    ].join("\n")
  const executeCommitterGit = (input: unknown, invocation: Tool.Context) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const cap = yield* restore(commitToolOwner(input, invocation))
        const operation = decodeCommitterInput(input).operation
        const content = yield* attempt(() => cap.git.execute(input, () => commitGate(cap)))
        if (operation === "commit") {
          // Once history may have changed, retain observed facts before handing
          // control back to an interruptible model/transport/native completion.
          const receipt = commitReceipt(cap, content)
          yield* context.storage
            .set(`commit-receipt:v1:${cap.decisionID}`, {
              rootSessionID: cap.evidence.implementation.claim.rootSessionID,
              receipt,
            })
            .pipe(Effect.mapError((error) => fail(`Commit facts storage failed; no retry: ${String(error)}`)))
        }
        return { content }
      }),
    ).pipe(
      Effect.onError(() =>
        Effect.sync(() => retireCommitCaller(invocation.sessionID, "Committer tool execution failed")),
      ),
      Effect.onInterrupt(() =>
        Effect.sync(() => retireCommitCaller(invocation.sessionID, "Committer tool execution interrupted")),
      ),
    )
  const decideCommit = (input: unknown) =>
    Effect.gen(function* () {
      const selected = yield* attempt(() => {
        live()
        // Recognize server-owned identity before accepting the payload. An
        // identifiable malformed selection burns only its exact decision/evidence.
        const decision =
          input && typeof input === "object" && "decisionID" in input && typeof input.decisionID === "string"
            ? pendingCommits.get(input.decisionID)
            : undefined
        if (
          !exactKeys(input, ["decisionID", "action"]) ||
          typeof input.decisionID !== "string" ||
          (input.action !== "Commit" && input.action !== "Stop")
        ) {
          if (decision) {
            pendingCommits.delete(decision.id)
            const rootID = decision.evidence.implementation.claim.rootSessionID
            if (currentReviews.get(rootID) === decision.evidence) currentReviews.delete(rootID)
          }
          throw new Error("Malformed Commit selection")
        }
        if (!decision) throw new Error("Commit decision is stale, spent, or unavailable")
        pendingCommits.delete(decision.id) // Human grant spent synchronously before any await.
        const rootID = decision.evidence.implementation.claim.rootSessionID
        if (currentReviews.get(rootID) !== decision.evidence || decision.evidence.result.status !== "APPROVED")
          throw new Error("Commit decision no longer owns exact APPROVED evidence")
        currentReviews.delete(rootID)
        return { decision, action: input.action }
      })
      const { decision, action } = selected
      const rootID = Session.ID.make(decision.evidence.implementation.claim.rootSessionID)
      if (action === "Stop") {
        const receipt =
          "Stopped by human decision after APPROVED. No Committer was launched and no Git mutation was issued."
        yield* publishReceipt(rootID, receipt)
        return terminal(receipt)
      }
      const cap = new CommitClaim(decision.id, decision.evidence)
      return yield* Effect.gen(function* () {
        let settled = false
        let wakeAttempted = false
        const outcome = yield* Effect.gen(function* () {
          yield* attempt(() => {
            acquire(cap)
            workers.set(rootID, cap)
            reviews.delete(rootID)
            reviewedFresh(cap)
          })
          const history = yield* context.session.context({ sessionID: rootID })
          const root = yield* context.session.get({ sessionID: rootID })
          yield* attempt(() => {
            local(cap)
            rootIdentity(cap.claim, root)
            if (!sameSettlement(root, cap.evidence.boundary)) throw new Error("Commit root settlement changed")
            reviewBoundary(cap.evidence, history)
            if ((latestActivity.get(rootID) ?? -1) > cap.evidence.boundary.rootEventSeq)
              throw new Error("Commit review history/activity superseded")
            reviewedFresh(cap)
          })
          wakeAttempted = true
          const wake = yield* context.session.synthetic({
            sessionID: rootID,
            id: SessionMessage.ID.make(cap.control.id),
            text: cap.control.text,
            delivery: "steer",
            resume: true,
          })
          yield* attempt(() => {
            local(cap)
            if (
              wake.id !== cap.control.id ||
              wake.sessionID !== rootID ||
              wake.type !== "synthetic" ||
              wake.delivery !== "steer" ||
              wake.payload.text !== cap.control.text
            )
              throw new Error("Commit wake admission changed")
          })
        }).pipe(Effect.exit)
        if (Exit.isFailure(outcome)) cap.close()
        const completion = yield* Effect.gen(function* () {
          if (!wakeAttempted) {
            settled = true
            if (Exit.isFailure(outcome)) throw Cause.squash(outcome.cause)
            throw new Error("Commit wake was not admitted")
          }
          yield* context.session.wait({ sessionID: rootID }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                cap.close()
                cap.git.close()
              }),
            ),
          )
          const lease = executing?.cap === cap ? executing : undefined
          if (!lease?.native) {
            settled = true
            throw new Error("No Committer entered")
          }
          const childID = yield* attempt(() => {
            if (lease.native?.child.kind !== "exact") throw new Error("Committer settlement identity unknown")
            return Session.ID.make(lease.native.child.childID)
          })
          yield* context.session.wait({ sessionID: childID }).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                cap.close()
                cap.git.close()
              }),
            ),
          )
          const child = yield* context.session.get({ sessionID: childID })
          yield* attempt(() => {
            live()
            // Both waits completed. Prove exact terminal execution independently
            // of authority/history validity, so a rejected settled child can
            // release exclusion. Unknown child or Git-process settlement cannot.
            if (
              executing !== lease ||
              lease.native?.child.kind !== "exact" ||
              lease.native.child.childID !== childID ||
              lease.native.call.sessionID !== rootID ||
              child.id !== childID ||
              child.parentID !== rootID ||
              child.agent !== "committer" ||
              child.fork ||
              child.revert ||
              child.time.archived ||
              !same(snapshotLocation(child.location), cap.claim.location) ||
              !child.time.idle ||
              !["succeeded", "failed", "interrupted"].includes(child.outcome ?? "")
            )
              throw new Error("Exact Committer terminal settlement was not proven")
            settled = true
          })
          const childHistory = yield* context.session.context({ sessionID: childID })
          const rootHistory = yield* context.session.context({ sessionID: rootID })
          const root = yield* context.session.get({ sessionID: rootID })
          yield* attempt(() => {
            local(cap)
            rootIdentity(cap.claim, root)
            commitChild(cap, child, childHistory)
            if (Exit.isFailure(outcome)) throw Cause.squash(outcome.cause)
            if (
              cap.toolFailure ||
              cap.phase !== "consumed" ||
              !cap.result ||
              cap.childID !== childID ||
              child.outcome !== "succeeded" ||
              root.outcome !== "succeeded"
            )
              throw new Error(cap.toolFailure ?? "Committer completion was unverified")
            const assistants = childHistory.filter((message) => message.type === "assistant")
            const final = assistants.at(-1)
            const terminals = assistants.filter((message) => message.finish === "stop")
            if (
              !final ||
              terminals.length !== 1 ||
              terminals[0] !== final ||
              childHistory.at(-1)?.type !== "idle" ||
              childHistory.some((message) => message.type === "idle" && message.outcome !== "succeeded") ||
              assistants.some((message) =>
                message.content.some(
                  (part) => part.type === "tool" && !["completed", "error"].includes(part.state.status),
                ),
              ) ||
              final.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join("") !== cap.nativeText
            )
              throw new Error("Committer terminal native result/history mismatch")
            reviewBoundary(cap.evidence, rootHistory, cap.control.id)
            const part = actualCall(cap, rootHistory, cap.reservation, "completed")
            if (
              part.state.status !== "completed" ||
              part.state.metadata?.sessionID !== childID ||
              part.state.metadata?.status !== "completed"
            )
              throw new Error("Committer published completion mismatch")
          })
        }).pipe(Effect.exit)
        const facts = cap.git.final()
        const receipt = commitReceipt(
          cap,
          Exit.isFailure(completion)
            ? `Commit did not reach a verified successful terminal state.\nNative completion unverified: ${String(Cause.squash(completion.cause)).slice(0, 2000)}\nObserved Git operation facts:\n${facts}`
            : facts,
        )
        cap.git.close()
        cap.close()
        // Facts are persisted once, without any loader or authority recovery path.
        // Keep exclusion through durable publication; failure cannot resend a wake.
        const receiptID = `msg_${randomUUID()}`
        receipts.set(receiptID, Object.freeze({ rootSessionID: rootID, text: receipt }))
        return yield* context.storage
          .set(`commit-receipt:v1:${decision.id}`, { rootSessionID: rootID, id: receiptID, receipt })
          .pipe(
            Effect.andThen(() =>
              settled && wakeAttempted
                ? context.session
                    .synthetic({ ...receiptInput(rootID, receipt), id: SessionMessage.ID.make(receiptID) })
                    .pipe(
                      Effect.as(terminal(receipt)),
                      Effect.catchCause((cause) =>
                        Effect.succeed(
                          terminal(
                            `${receipt}\nDurable facts stored; root receipt publication unavailable: ${String(Cause.squash(cause))}`,
                          ),
                        ),
                      ),
                    )
                : Effect.succeed(
                    terminal(
                      `${receipt}\nDurable facts stored; root publication withheld without proven execution settlement.`,
                    ),
                  ),
            ),
            Effect.catchCause((cause) =>
              Effect.succeed(terminal(`${receipt}\nDurable receipt storage failed: ${String(Cause.squash(cause))}`)),
            ),
            Effect.ensuring(
              Effect.sync(() => {
                if (settled && cap.git.processSettled && executing?.cap === cap) executing = undefined
              }),
            ),
          )
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cap.close()
            cap.git.close()
            if (executing?.cap === cap && !executing.native) executing = undefined
          }),
        ),
      )
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          terminal(`Commit admission was unverified; no retry was issued.\nReason: ${String(Cause.squash(cause))}`),
        ),
      ),
    )

  const decideRepair = (input: unknown) =>
    Effect.gen(function* () {
      const selected = yield* attempt(() => {
        live()
        if (
          !exactKeys(input, ["decisionID", "action"]) ||
          typeof input.decisionID !== "string" ||
          (input.action !== "Repair" && input.action !== "Stop")
        )
          throw new Error("Malformed Repair selection")
        const decision = pending.get(input.decisionID)
        if (!decision) throw new Error("Repair decision is stale, spent, or unavailable")
        pending.delete(decision.id) // Exact selection is spent before any await.
        return { decision, action: input.action }
      })
      const { decision, action } = selected
      const rootID = decision.evidence.implementation.claim.rootSessionID
      currentReviews.delete(rootID)
      if (action === "Stop") {
        const receipt =
          "Stopped by human decision. This attempt ended before Commit. No Repair worker or mutation authority was granted."
        yield* publishReceipt(rootID, receipt)
        return terminal(receipt)
      }
      const cap = new RepairClaim(decision.id, decision.evidence)
      return yield* Effect.gen(function* () {
        yield* attempt(() => {
          acquire(cap) // No queue/retry, and observations must follow acquisition.
          workers.set(rootID, cap)
          reviews.delete(rootID)
          reviewedFresh(cap)
        })
        return yield* runCycle(cap)
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cap.close()
            // A failure before wake/native entry can safely release its lease.
            if (executing?.cap === cap && !executing.native) executing = undefined
          }),
        ),
      )
    }).pipe(Effect.catchCause((cause) => Effect.succeed(terminal(unverified(cause)))))
  const eventReceived = (event: { id?: string; type: string; data: Record<string, unknown>; durable?: unknown }) => {
    if (!("sessionID" in event.data)) return
    const id = event.data.sessionID
    if (typeof id !== "string") return
    if (
      event.type === "session.execution.succeeded" &&
      typeof event.id === "string" &&
      event.id.startsWith("evt_") &&
      workers.has(id)
    ) {
      const notification = terminalNotification(event.id.replace(/^evt_/, "msg_"))
      const seq = sessionEventSeq(event, id)
      Deferred.doneUnsafe(
        notification,
        seq !== undefined
          ? Effect.succeed({ rootSessionID: id, rootEventSeq: seq })
          : Effect.fail(fail("Reviewer terminal notification lacks a trusted session-log position")),
      )
    }
    if (
      /^session\.(permissions|agent\.selected|moved|deleted|forked|revert|compaction|instructions)/.test(event.type) &&
      !(event.type === "session.instructions.updated" && event.data.text === undefined)
    )
      retireCommitCaller(id, "Admitted Committer policy/location/history was superseded")
    const boundary = reviewBoundaries.get(id)
    if (boundary && historicalReviewEvent(event, boundary)) return
    if (
      event.type === "session.execution.succeeded" &&
      typeof event.id === "string" &&
      event.id.startsWith("evt_") &&
      event.durable === undefined &&
      settledRoots.get(event.id.replace(/^evt_/, "msg_")) === id
    )
      return
    if (typeof event.data.inboxID === "string") {
      const receipt = receipts.get(event.data.inboxID)
      if (receipt?.rootSessionID === id && ownedReceiptEvent(event, id, { id: event.data.inboxID, text: receipt.text }))
        return
    }
    if (event.type === "session.instructions.updated" && event.data.text === undefined) return
    if (
      !/^session\.(inbox|message|synthetic|instructions|execution|permissions|agent\.selected|moved|deleted|forked|revert|compaction|shell|skill)/.test(
        event.type,
      )
    )
      return
    if (workers.has(id)) {
      const seq = sessionEventSeq(event, id) ?? Number.POSITIVE_INFINITY
      latestActivity.set(id, Math.max(latestActivity.get(id) ?? -1, seq))
    }
    const owner = workers.get(id)
    if (
      owner instanceof CommitClaim ||
      (owner instanceof RepairClaim && (owner.phase === "available" || owner.phase === "reserved"))
    ) {
      const control = owner.control
      const item = event.data.item as { type?: unknown; payload?: { text?: unknown } } | undefined
      const ownControl =
        (event.type === "session.inbox.enqueued" &&
          event.data.inboxID === control.id &&
          item?.type === "synthetic" &&
          item.payload?.text === control.text) ||
        (event.type === "session.inbox.delivered" && event.data.inboxID === control.id)
      if (
        !ownControl &&
        /^session\.(inbox|synthetic|instructions|permissions|agent\.selected|moved|deleted|forked|revert)/.test(
          event.type,
        )
      )
        owner.close()
    }
    for (const [key, decision] of pending)
      if (decision.evidence.implementation.claim.rootSessionID === id) pending.delete(key)
    for (const [key, decision] of pendingCommits)
      if (decision.evidence.implementation.claim.rootSessionID === id) pendingCommits.delete(key)
    currentReviews.delete(id)
  }
  const currentApproval = (rootID: string) => {
    const evidence = currentReviews.get(rootID)
    if (!evidence || evidence.result.status !== "APPROVED") return undefined
    try {
      live()
      const { claim, target } = evidence.implementation
      const owner = workers.get(rootID)
      if (!owner) throw new Error("No current review owner")
      local(owner, claim)
      requireInScope(
        observeGit(claim.location.directory!, baseline(claim)),
        baseline(claim),
        claim.candidate.proposal.files,
      )
      requireReviewTarget(observeReviewTarget(claim.location.directory!, target), target)
      return evidence
    } catch {
      currentReviews.delete(rootID)
      return undefined
    }
  }
  const teardown = () => {
    revoked = true
    for (const cap of caps.values()) cap.teardown()
    for (const cap of workers.values()) cap.teardown()
    workers.clear()
    pending.clear()
    pendingCommits.clear()
    currentReviews.clear()
    receipts.clear()
    settledRoots.clear()
    reviewBoundaries.clear()
    latestActivity.clear()
    for (const notification of terminalNotifications.values())
      Deferred.doneUnsafe(notification, Effect.fail(fail("Server CAP activation was revoked")))
    terminalNotifications.clear()
    children.clear()
    contenders.clear()
    planners.clear()
    for (const review of reviews.values()) review.admission = { kind: "closed" }
    reviews.clear()
    executing = undefined
  }
  return {
    before,
    execute,
    authorize,
    decideRepair,
    decideCommit,
    executeCommitterGit,
    revise,
    teardown,
    eventReceived,
    currentApproval,
    sponsorPermission,
    actor,
    reviewerActor,
    committerActor,
    caps,
  }
}

function reviewUnverified(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause)
  if (
    error instanceof ReviewTargetChanged ||
    (error instanceof Tool.Error && error.error instanceof ReviewTargetChanged)
  )
    return "Review target changed. Reviewer outcome was unverified; result was rejected. No retry, replacement, repair, or Commit was issued."
  return `Reviewer outcome was unverified. No retry, replacement, repair, or Commit was issued.\nReason: ${String(Cause.squash(cause))}`
}

function unverified(cause: Cause.Cause<unknown>): string {
  return `Native implementation outcome was unverified. No retry or replacement was issued.\nReason: ${String(Cause.squash(cause))}`
}
