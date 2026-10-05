import { Cause, Effect, Exit } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Session } from "@opencode/schema/session"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { randomUUID } from "node:crypto"
import { NativeCap, exactKeys, frozenCopy, type Reservation } from "./cap.ts"
import {
  exactEvidence,
  implementerPrompt,
  snapshotLocation,
  nativeBootstrap,
  plannerArguments,
  plannerTurnInput,
  directRootTool,
  plannerReceiptKey,
  nativeReadInstruction,
} from "./attempt.ts"
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
import { reviewerArguments, parseReviewResult, reviewReceipt } from "./review.ts"
import { reviewerGitName, reviewerGitArguments } from "./reviewer-git.ts"

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
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)
const fail = (message: string) => new Tool.Error({ message: `CAP admission: ${message}` })
const attempt = <T>(body: () => T) =>
  Effect.try({
    try: body,
    catch: (error) =>
      new Tool.Error({ message: `CAP admission: ${error instanceof Error ? error.message : String(error)}`, error }),
  })
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
function exactArguments(value: unknown, candidate: IntentCandidate): void {
  if (!exactKeys(value, ["agent", "description", "prompt"]) || !same(value, nativeArguments(candidate)))
    throw new Error("Native arguments differ from frozen contract")
}
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
type ReviewAdmission =
  | { kind: "available" }
  | { kind: "reserved"; call: Readonly<Reservation> }
  | { kind: "entered"; call: Readonly<Reservation> }
  | { kind: "consumed"; call: Readonly<Reservation> }
  | { kind: "closed" }
type ReviewAttempt = {
  readonly target: ReviewTarget
  readonly arguments: ReturnType<typeof reviewerArguments>
  readonly control: Readonly<{ id: string; text: string }>
  readonly implementerID: string
  admission: ReviewAdmission
  failure?: Cause.Cause<unknown>
  execution?: { call: Readonly<Reservation>; child: ChildBinding; result?: Readonly<Tool.Result> }
}

// Server-only host adapter. All reads use the supported Effect session API.
// Root-local one-shot slots live only in this closure; no transcript recovery.
export function nativeAdmission(context: Context) {
  const caps = new Map<string, NativeCap>()
  const reviews = new Map<string, ReviewAttempt>()
  // Only successful trusted admission spends eligibility. Failed syntax and
  // denied pre-admission calls create neither a slot nor CAP authority.
  const planners = new Map<
    string,
    Readonly<{ call: Readonly<Reservation>; receipt: ReturnType<typeof plannerTurnInput>["effective"] }>
  >()
  let revoked = false
  // The location-scoped host activation owns one worktree. Hold exclusion from
  // before the wake through settlement/verification, independently of the root slots.
  let executing: { cap: NativeCap; native?: { call: Reservation; child: ChildBinding } } | undefined
  const live = () => {
    if (revoked) throw new Error("Server CAP activation was revoked")
  }
  const actor = Agent.ID.make(`cap_sponsor_${randomUUID()}`)
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
      if (event.agent === "reviewer" && (!reviewerTool(event.action) || event.effect !== "allow")) event.effect = "deny"
    })
  const local = (cap: NativeCap) => {
    live()
    cap.live()
    const claim = cap.claim
    if (!same(snapshotLocation(context.location), claim.location)) throw new Error("Server location changed")
    parseProposal(JSON.stringify(claim.candidate.proposal), claim.candidate.root)
  }
  const rootIdentity = (cap: NativeCap, root: Session.Info) => {
    const claim = cap.claim
    if (!orchestratorRootMatches(root, claim.rootSessionID, claim.location))
      throw new Error("Root role, location, or permissions changed")
  }
  const baseline = (cap: NativeCap) => ({ root: cap.claim.candidate.root, head: cap.claim.candidate.head, paths: [] })
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
        .some((item) => !["assistant", "idle", "compaction", "model-switched"].includes(item.type))
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
  const actualCall = (
    cap: NativeCap,
    history: readonly SessionMessage.Info[],
    call: Reservation,
    status: "running" | "completed",
  ) => observedCall(cap.control, nativeArguments(cap.claim.candidate), history, call, status)
  const before = (event: ToolHooks["execute.before"]) =>
    Effect.gen(function* () {
      yield* attempt(live)
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
          if (review.admission.kind !== "available")
            throw new Error("Reviewer admission is reserved, consumed, or closed")
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
      const cap = caps.get(event.sessionID)
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
          if (planners.has(event.sessionID)) throw new Error("One governed Planner attempt per root")
          if (event.tool !== "subagent") throw new Error("Forbidden root tool contender")
          if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === target)
            throw new Error("No reserved Implementer call")
          plannerArguments(event.input)
        })
        return
      }
      // Select the owner before any awaits. A losing contender cannot close it.
      yield* attempt(() =>
        cap.reserve({ sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id }),
      )
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
    cap: NativeCap,
  ) =>
    Effect.gen(function* () {
      const call = frozenCopy({
        sessionID: invocation.sessionID,
        agent: invocation.agent,
        messageID: invocation.messageID,
        id: invocation.id,
      })
      // Claim executor entry synchronously. Losers cannot close this owner.
      yield* attempt(() => {
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
        const root = yield* context.session.get({ sessionID: invocation.sessionID })
        const execution = yield* attempt(() => {
          local(cap)
          rootIdentity(cap, root)
          if (cap.phase !== "closed" || executing?.cap !== cap)
            throw new Error("Reviewer does not own verified execution exclusion")
          requireReviewTarget(observeReviewTarget(cap.claim.location.directory!, review.target), review.target)
          review.admission = { kind: "consumed", call }
          const execution: NonNullable<ReviewAttempt["execution"]> = { call, child: { kind: "unknown" } }
          review.execution = execution
          return execution
        })
        const result = yield* original(effective, {
          ...invocation,
          agent: reviewerActor,
          progress: (update) =>
            Effect.sync(() => bindChild(execution, update.sessionID, call.sessionID, [review.implementerID])).pipe(
              Effect.andThen(() => invocation.progress(update)),
            ),
        })
        yield* attempt(() => {
          const output = result.output
          bindChild(execution, output?.sessionID, call.sessionID, [review.implementerID])
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
        if (planners.has(invocation.sessionID)) throw new Error("One governed Planner attempt per root")
        return frozenCopy({
          sessionID: invocation.sessionID,
          agent: invocation.agent,
          messageID: invocation.messageID,
          id: invocation.id,
        })
      })
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
        const bound = plannerTurnInput(history, call)
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
        const observed = plannerTurnInput(latest, call)
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
        if (planners.has(invocation.sessionID)) throw new Error("One governed Planner attempt per root")
        // One synchronous insertion records both admission and its exact input
        // evidence. Native code cannot run between spending and recording it.
        planners.set(invocation.sessionID, Object.freeze({ call, receipt }))
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
          const owner = caps.get(invocation.sessionID)
          if (!owner) return yield* Effect.fail(fail("Reviewer has no implementation owner"))
          return yield* executeReview(original, prepare, input, invocation, review, owner)
        }
        if (input && typeof input === "object" && "agent" in input && input.agent === "reviewer")
          return yield* Effect.fail(fail("No reserved Reviewer call"))
        const cap = caps.get(invocation.sessionID)
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
        yield* attempt(() => cap.enter(call))
        return yield* Effect.gen(function* () {
          const history = yield* context.session.context({ sessionID: invocation.sessionID })
          yield* attempt(() => {
            actualCall(cap, history, call, "running")
            exactArguments(input, cap.claim.candidate)
          })
          // Decode/validate settings before consuming CAP or claiming an unknown
          // child. On failure the existing pre-admission close/settlement releases
          // exclusion, without changing this root's accepted-claim contract.
          const effectiveInput = yield* prepare(input)
          const root = yield* context.session.get({ sessionID: invocation.sessionID })
          // All awaited reads precede the final synchronous freshness/consume barrier.
          const lease = yield* attempt(() => {
            rootIdentity(cap, root)
            local(cap)
            exactArguments(input, cap.claim.candidate)
            if (!candidateIntact(cap.claim.candidate)) throw new Error("Frozen claim integrity changed")
            if (executing?.cap !== cap) throw new Error("Root does not own worktree implementation exclusion")
            requireFresh(observeGit(cap.claim.location.directory!, baseline(cap)), baseline(cap))
            cap.consume(call)
            return executing
          })
          const execution: { call: Reservation; child: ChildBinding } = { call, child: { kind: "unknown" } }
          lease.native = execution
          // Pinned OpenCode seam: native Permission.assert uses this explicit actor,
          // the real parent/source IDs, and effective policy before creating a child.
          const result = yield* original(effectiveInput, {
            ...invocation,
            agent: actor,
            progress: (update) =>
              Effect.sync(() => bindChild(execution, update.sessionID, call.sessionID)).pipe(
                Effect.andThen(() => invocation.progress(update)),
              ),
          })
          yield* attempt(() => {
            cap.receipt(result)
            bindChild(execution, cap.childID, call.sessionID)
          })
          return result // Native output normalization, after hooks and publication remain native.
        }).pipe(
          Effect.onError(() => Effect.sync(() => cap.close())),
          Effect.onInterrupt(() => Effect.sync(() => cap.close())),
        )
      }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : fail(String(error)))))
  const verifyResult = (cap: NativeCap) =>
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
        rootIdentity(cap, root)
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
          users[0]?.text !== nativeBootstrap(implementerPrompt(claim.candidate)) ||
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
          observeGit(claim.location.directory!, baseline(cap)),
          baseline(cap),
          claim.candidate.proposal.files,
        )
        cap.live()
        return observeReviewTarget(claim.location.directory!, { ...baseline(cap), paths })
      })
    })
  const verifyReview = (cap: NativeCap, review: ReviewAttempt) =>
    Effect.gen(function* () {
      const execution = yield* attempt(() => {
        local(cap)
        if (!review.execution || review.execution.child.kind !== "exact" || !review.execution.result)
          throw new Error("Reviewer settled without a verified native execution")
        return review.execution
      })
      const childID = yield* attempt(() => {
        if (execution.child.kind !== "exact") throw new Error("Reviewer identity ambiguous")
        return Session.ID.make(execution.child.childID)
      })
      const root = yield* context.session.get({ sessionID: Session.ID.make(cap.claim.rootSessionID) })
      const child = yield* context.session.get({ sessionID: childID })
      const history = yield* context.session.context({ sessionID: root.id })
      const childHistory = yield* context.session.context({ sessionID: childID })
      return yield* attempt(() => {
        local(cap)
        rootIdentity(cap, root)
        if (
          root.outcome !== "succeeded" ||
          !root.time.idle ||
          child.id !== childID ||
          child.parentID !== root.id ||
          child.agent !== "reviewer" ||
          child.fork ||
          child.revert ||
          child.time.archived ||
          !same(snapshotLocation(child.location), cap.claim.location) ||
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
        const current = observeReviewTarget(cap.claim.location.directory!, review.target)
        requireInScope(current, baseline(cap), cap.claim.candidate.proposal.files)
        requireReviewTarget(current, review.target)
        const parsed = parseReviewResult(text)
        local(cap)
        return reviewReceipt(parsed)
      })
    })
  const runReview = (cap: NativeCap, target: ReviewTarget, settlement: (proven: boolean) => void) =>
    Effect.gen(function* () {
      const rootID = Session.ID.make(cap.claim.rootSessionID)
      const review = yield* attempt(() => {
        local(cap)
        if (reviews.has(rootID) || !cap.childID || executing?.cap !== cap)
          throw new Error("Reviewer attempt is unavailable")
        const call = cap.reservation
        const args = reviewerArguments(cap.claim.candidate, target, {
          rootSessionID: rootID,
          messageID: call.messageID,
          toolID: call.id,
          childID: cap.childID,
        })
        const review: ReviewAttempt = {
          target,
          arguments: args,
          implementerID: cap.childID,
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
          local(cap)
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
      if (Exit.isFailure(rootSettled)) return { outcome: reviewUnverified(rootSettled.cause), publish: false }
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
          local(cap)
          if (
            child.id !== id ||
            child.parentID !== rootID ||
            child.agent !== "reviewer" ||
            child.fork ||
            child.revert ||
            child.time.archived ||
            !same(snapshotLocation(child.location), cap.claim.location) ||
            !emptyPermissions(child.permissions) ||
            !child.time.idle ||
            !["succeeded", "failed", "interrupted"].includes(child.outcome ?? "")
          )
            throw new Error("Exact Reviewer terminal settlement was not proven")
          settlement(true)
        })
      }).pipe(Effect.exit)
      const outcome = Exit.isFailure(wake)
        ? reviewUnverified(wake.cause)
        : Exit.isFailure(childSettled)
          ? reviewUnverified(childSettled.cause)
          : review.failure
            ? reviewUnverified(review.failure)
            : yield* verifyReview(cap, review).pipe(
                Effect.catchCause((cause) => Effect.succeed(reviewUnverified(cause))),
              )
      return { outcome, publish: true }
    })
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
      const rootSessionID = cap.claim.rootSessionID
      let settlementProven = false
      return yield* Effect.gen(function* () {
        const admission = yield* Effect.gen(function* () {
          yield* attempt(() => {
            local(cap)
          })
          const root = yield* context.session.get({ sessionID: Session.ID.make(rootSessionID) })
          yield* attempt(() => {
            rootIdentity(cap, root)
            local(cap)
            if (executing) throw new Error("Another root owns worktree implementation exclusion")
            executing = { cap }
            requireFresh(observeGit(cap.claim.location.directory!, baseline(cap)), baseline(cap))
          })
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
        if (Exit.isFailure(settled)) return unverified(settled.cause)
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
        const implementation = Exit.isFailure(admission)
          ? unverified(admission.cause)
          : settlementFailure
            ? unverified(settlementFailure)
            : yield* verifyResult(cap).pipe(Effect.catchCause((cause) => Effect.succeed(unverified(cause))))
        cap.close()
        let outcome: string
        if (typeof implementation === "string") outcome = implementation
        else {
          const review = yield* runReview(cap, implementation, (proven) => {
            settlementProven = proven
          }).pipe(Effect.catchCause((cause) => Effect.succeed({ outcome: reviewUnverified(cause), publish: false })))
          outcome = [
            "Implementation gate completed successfully.",
            `HEAD ${implementation.head} remained unchanged.`,
            `Resulting paths (${implementation.paths.length}): ${implementation.paths.map(displayPath).join(", ") || "(none)"}.`,
            review.outcome,
          ].join("\n")
          if (!review.publish) return outcome
        }
        // This accepted RPC alone owns terminal publication. Losing RPCs never
        // reach it; publication failure cannot change or retry the outcome.
        yield* Effect.suspend(() =>
          context.session.synthetic(receiptInput(Session.ID.make(rootSessionID), outcome)),
        ).pipe(
          Effect.catchCause((cause) => Effect.logWarning("Terminal receipt publication failed", Cause.pretty(cause))),
        )
        return outcome
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cap.close()
            const review = reviews.get(rootSessionID)
            if (review) review.admission = { kind: "closed" }
            // Unknown settlement retains exclusion until activation teardown.
            if (settlementProven && executing?.cap === cap) executing = undefined
          }),
        ),
      )
    }).pipe(Effect.catchCause((cause) => Effect.succeed(unverified(cause))))
  const teardown = () => {
    revoked = true
    for (const cap of caps.values()) cap.teardown()
    planners.clear()
    for (const review of reviews.values()) review.admission = { kind: "closed" }
    reviews.clear()
    executing = undefined
  }
  return { before, execute, authorize, teardown, sponsorPermission, actor, reviewerActor, caps }
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
