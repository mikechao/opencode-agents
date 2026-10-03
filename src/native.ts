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
  plannerReceipt,
  plannerReceiptKey,
} from "./attempt.ts"
import { parseProposal, candidateIntact, displayPath, type IntentCandidate } from "./proposal.ts"
import { observeGit, requireFresh, requireInScope } from "./git.ts"
import { receiptInput } from "./receipt.ts"

const target = "authorized_implementer"
export const sponsorRules = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "subagent", resource: target, effect: "allow" },
] as const
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)
const fail = (message: string) => new Tool.Error({ message: `CAP admission: ${message}` })
const attempt = <T>(body: () => T) =>
  Effect.try({ try: body, catch: (error) => fail(error instanceof Error ? error.message : String(error)) })
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
    "Do not add keys, reuse a session, or change these values. After its result, finish with prose and STOP before Reviewer / Commit.",
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

// Server-only host adapter. All reads use the supported Effect session API.
// Root-local one-shot slots live only in this closure; no transcript recovery.
export function nativeAdmission(context: Context) {
  const caps = new Map<string, NativeCap>()
  let revoked = false
  // The location-scoped host activation owns one worktree. Hold exclusion from
  // before the wake through settlement/verification, independently of the root slots.
  let executing: { cap: NativeCap; native?: { call: Reservation; child: ChildBinding } } | undefined
  const live = () => {
    if (revoked) throw new Error("Server CAP activation was revoked")
  }
  const actor = Agent.ID.make(`cap_sponsor_${randomUUID()}`)
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
  const actualCall = (
    cap: NativeCap,
    history: readonly SessionMessage.Info[],
    call: Reservation,
    status: "running" | "completed",
  ) => {
    const control = cap.control
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
    exactArguments(parts[0].state.input, cap.claim.candidate) // Original, before native empty-key normalization.
    return parts[0]
  }
  const before = (event: ToolHooks["execute.before"]) =>
    Effect.gen(function* () {
      yield* attempt(live)
      const cap = caps.get(event.sessionID)
      if (!cap || event.sessionID !== cap.rootSessionID) {
        if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === target)
          yield* Effect.fail(fail("No reserved Implementer call"))
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
    })
  const executePlanner = (original: Tool.Info["execute"], input: unknown, invocation: Tool.Context) =>
    Effect.gen(function* () {
      const location = snapshotLocation(context.location)
      const root = yield* context.session.get({ sessionID: invocation.sessionID })
      // A nested Orchestrator is outside the initial root boundary.
      if (root.id === invocation.sessionID && root.parentID) return yield* original(input, invocation)
      const history = yield* context.session.context({ sessionID: invocation.sessionID })
      const current = yield* context.session.get({ sessionID: invocation.sessionID })
      const receipt = yield* attempt(() => {
        live()
        if (caps.get(invocation.sessionID)?.rootSessionID === invocation.sessionID)
          throw new Error("Planner follows an admitted CAP claim")
        if (!location.directory || !same(root.time.created, current.time.created))
          throw new Error("Initial Planner root creation or location changed")
        for (const session of [root, current]) {
          if (!orchestratorRootMatches(session, invocation.sessionID, location))
            throw new Error("Initial Planner root identity changed")
        }
        if (!same(snapshotLocation(context.location), location)) throw new Error("Server location changed")
        const users = history.filter((message) => message.type === "user")
        const user = users[0]
        if (
          users.length !== 1 ||
          !user ||
          history[0] !== user ||
          !user.text ||
          [user.files, user.agents, user.skills].some((items) => items && items.length) ||
          new Set(history.map((message) => message.id)).size !== history.length ||
          history.some((message) => !["user", "assistant", "model-switched"].includes(message.type))
        )
          throw new Error("Planner is not bound to one initial plain root request")
        const assistants = history.filter((message) => message.type === "assistant")
        if (assistants.some((message) => message.agent !== "orchestrator" || message.error))
          throw new Error("Initial Planner assistant identity changed")
        const tools = assistants.flatMap((message) =>
          message.content.flatMap((part) => (part.type === "tool" ? [{ messageID: message.id, part }] : [])),
        )
        const call = tools[0]
        if (
          tools.length !== 1 ||
          !call ||
          call.messageID !== invocation.messageID ||
          call.part.id !== invocation.id ||
          call.part.name !== "subagent" ||
          call.part.state.status !== "running"
        )
          throw new Error("Initial Planner native contender identity changed")
        // Published proposal precedes host normalization/decoding; reject stripped keys too.
        const proposed = plannerArguments(call.part.state.input)
        if (!same(plannerArguments(input), proposed)) throw new Error("Decoded Planner proposal changed")
        return frozenCopy(plannerReceipt(user.id, proposed.description, user.text))
      })
      // Keep native permissions, parent/source IDs, child creation and progress unchanged.
      const result = yield* original(receipt.input, invocation)
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
      // Tool.Called retains proposed state.input. Only terminal result metadata records execution.
      return { ...result, metadata: { ...result.metadata, [plannerReceiptKey]: receipt } }
    })
  const execute = (original: Tool.Info["execute"]) => (input: unknown, invocation: Tool.Context) =>
    Effect.gen(function* () {
      yield* attempt(live)
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
          return yield* executePlanner(original, input, invocation)
        return yield* original(input, invocation)
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
        yield* attempt(() => actualCall(cap, history, call, "running"))
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
        const bindChild = (childID: unknown) => {
          if (execution.child.kind === "ambiguous") return
          if (
            typeof childID !== "string" ||
            !childID ||
            childID === call.sessionID ||
            (execution.child.kind === "exact" && execution.child.childID !== childID)
          ) {
            execution.child = { kind: "ambiguous" }
            return
          }
          execution.child = { kind: "exact", childID }
        }
        // Pinned OpenCode seam: native Permission.assert uses this explicit actor,
        // the real parent/source IDs, and effective policy before creating a child.
        const result = yield* original(input, {
          ...invocation,
          agent: actor,
          progress: (update) =>
            Effect.sync(() => bindChild(update.sessionID)).pipe(Effect.andThen(() => invocation.progress(update))),
        })
        yield* attempt(() => {
          cap.receipt(result)
          bindChild(cap.childID)
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
        return [
          "Implementation gate completed successfully.",
          `HEAD ${claim.candidate.head} remained unchanged.`,
          `Resulting paths (${paths.length}): ${paths.map(displayPath).join(", ") || "(none)"}.`,
          "This attempt ended after the implementation gate; Reviewer and Commit were not run.",
        ].join("\n")
      })
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
        const outcome = Exit.isFailure(admission)
          ? unverified(admission.cause)
          : settlementFailure
            ? unverified(settlementFailure)
            : yield* verifyResult(cap).pipe(Effect.catchCause((cause) => Effect.succeed(unverified(cause))))
        cap.close()
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
            // Unknown settlement retains exclusion until activation teardown.
            if (settlementProven && executing?.cap === cap) executing = undefined
          }),
        ),
      )
    }).pipe(Effect.catchCause((cause) => Effect.succeed(unverified(cause))))
  const teardown = () => {
    revoked = true
    for (const cap of caps.values()) cap.teardown()
    executing = undefined
  }
  return { before, execute, authorize, teardown, sponsorPermission, actor, caps }
}

function unverified(cause: Cause.Cause<unknown>): string {
  return `Native implementation outcome was unverified. No retry or replacement was issued.\nReason: ${String(Cause.squash(cause))}`
}
