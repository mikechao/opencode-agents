import { Cause, Effect } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Session } from "@opencode/schema/session"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { randomUUID } from "node:crypto"
import { NativeCap, exactKeys, type Reservation } from "./cap.ts"
import { exactEvidence, implementerPrompt, snapshotLocation, nativeBootstrap } from "./attempt.ts"
import { parseProposal, candidateIntact, displayPath, type IntentCandidate } from "./proposal.ts"
import { observeGit, requireFresh, requireInScope } from "./git.ts"

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

// Server-only host adapter. All reads use the supported Effect session API.
// The slot belongs to this closure, with no persistence or transcript recovery.
export function nativeAdmission(context: Context) {
  const cap = new NativeCap()
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
  const local = () => {
    cap.live()
    const claim = cap.claim
    if (!same(snapshotLocation(context.location), claim.location)) throw new Error("Server location changed")
    parseProposal(JSON.stringify(claim.candidate.proposal), claim.candidate.root)
  }
  const rootIdentity = (root: Session.Info) => {
    const claim = cap.claim
    if (
      root.id !== claim.rootSessionID ||
      root.agent !== "orchestrator" ||
      root.parentID ||
      root.fork ||
      root.revert ||
      root.time.archived ||
      !same(snapshotLocation(root.location), claim.location) ||
      !emptyPermissions(root.permissions)
    )
      throw new Error("Root role, location, or permissions changed")
  }
  const baseline = () => ({ root: cap.claim.candidate.root, head: cap.claim.candidate.head, paths: [] })
  const actualCall = (history: readonly SessionMessage.Info[], call: Reservation, status: "running" | "completed") => {
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
      yield* attempt(() => cap.live())
      if (event.sessionID !== cap.rootSessionID) {
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
  const execute = (original: Tool.Info["execute"]) => (input: unknown, invocation: Tool.Context) =>
    Effect.gen(function* () {
      yield* attempt(() => cap.live())
      const governed =
        invocation.sessionID === cap.rootSessionID ||
        (!!input && typeof input === "object" && "agent" in input && input.agent === target)
      if (!governed) return yield* original(input, invocation)
      const call: Reservation = {
        sessionID: invocation.sessionID,
        agent: invocation.agent,
        messageID: invocation.messageID,
        id: invocation.id,
      }
      // Executor losers also cannot change an in-flight owner's state.
      yield* attempt(() => cap.enter(call))
      return yield* Effect.gen(function* () {
        const history = yield* context.session.context({ sessionID: invocation.sessionID })
        yield* attempt(() => actualCall(history, call, "running"))
        const root = yield* context.session.get({ sessionID: invocation.sessionID })
        // All awaited reads precede the final synchronous freshness/consume barrier.
        yield* attempt(() => {
          rootIdentity(root)
          local()
          exactArguments(input, cap.claim.candidate)
          if (!candidateIntact(cap.claim.candidate)) throw new Error("Frozen claim integrity changed")
          requireFresh(observeGit(cap.claim.location.directory!, baseline()), baseline())
          cap.consume(call)
        })
        // Pinned OpenCode seam: native Permission.assert uses this explicit actor,
        // the real parent/source IDs, and effective policy before creating a child.
        const result = yield* original(input, { ...invocation, agent: actor })
        yield* attempt(() => cap.receipt(result))
        return result // Native output normalization, after hooks and publication remain native.
      }).pipe(
        Effect.onError(() => Effect.sync(() => cap.close())),
        Effect.onInterrupt(() => Effect.sync(() => cap.close())),
      )
    }).pipe(Effect.mapError((error) => (error instanceof Tool.Error ? error : fail(String(error)))))
  const verifyResult = () =>
    Effect.gen(function* () {
      yield* attempt(local)
      if (cap.phase !== "consumed" || !cap.childID || !cap.result)
        return yield* Effect.fail(fail("Root settled without a verified native execution"))
      const claim = cap.claim
      const childID = Session.ID.make(cap.childID)
      const root = yield* context.session.get({ sessionID: Session.ID.make(claim.rootSessionID) })
      const child = yield* context.session.get({ sessionID: childID })
      const history = yield* context.session.context({ sessionID: Session.ID.make(claim.rootSessionID) })
      const childHistory = yield* context.session.context({ sessionID: childID })
      return yield* attempt(() => {
        rootIdentity(root)
        local()
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
        const part = actualCall(history, reservation, "completed")
        if (
          part.state.status !== "completed" ||
          part.state.metadata?.sessionID !== childID ||
          part.state.metadata?.status !== "completed"
        )
          throw new Error("Published native completion identity changed")
        const paths = requireInScope(
          observeGit(claim.location.directory!, baseline()),
          baseline(),
          claim.candidate.proposal.files,
        )
        cap.live()
        return `Implementation gate complete: HEAD ${claim.candidate.head} unchanged. Resulting paths (${paths.length}): ${paths.map(displayPath).join(", ") || "(none)"}. STOP before Reviewer / Commit.`
      })
    })
  const authorize = (input: unknown) =>
    Effect.gen(function* () {
      yield* attempt(() => {
        cap.accept(input, controlText)
      })
      return yield* Effect.gen(function* () {
        yield* attempt(() => {
          local()
          requireFresh(observeGit(cap.claim.location.directory!, baseline()), baseline())
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
        yield* context.session.wait({ sessionID: Session.ID.make(cap.claim.rootSessionID) })
        return yield* verifyResult()
      }).pipe(Effect.ensuring(Effect.sync(() => cap.close())))
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.succeed(
          `STOP — Native implementation outcome unverified; no retry or replacement. ${String(Cause.squash(cause))}`,
        ),
      ),
    )
  return { before, execute, authorize, teardown: () => cap.teardown(), sponsorPermission, actor, cap }
}
