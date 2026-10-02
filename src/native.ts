import { Cause, Effect, Schema } from "effect"
import { Tool } from "@opencode/schema/tool"
import { Session } from "@opencode/schema/session"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import type { PermissionEvaluation } from "@opencode/plugin/effect/permission"
import { SessionMessage } from "@opencode/schema/session-message"
import { Agent } from "@opencode/schema/agent"
import { randomUUID } from "node:crypto"
import { NativeCap, exactKeys, type Reservation } from "./cap.ts"
import { exactEvidence, implementerPrompt, snapshotLocation } from "./attempt.ts"
import { parseProposal, candidateIntact, type IntentCandidate } from "./proposal.ts"
import { observeGit, requireFresh, requireInScope } from "./git.ts"

const target = "authorized_implementer"
export const sponsorRules = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "subagent", resource: target, effect: "allow" },
] as const
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)
const fail = (message: string) => new Tool.Error({ message: `CAP admission: ${message}` })
const attempt = <T>(body: () => T) => Effect.try({ try: body, catch: (error) => fail(error instanceof Error ? error.message : String(error)) })
export const nativeArguments = (candidate: IntentCandidate) => Object.freeze({
  agent: target, description: "Implement the authorized plan", prompt: implementerPrompt(candidate),
})
export const controlText = (candidate: IntentCandidate) => [
  "Propose exactly one foreground native subagent call with exactly these arguments:",
  JSON.stringify(nativeArguments(candidate)),
  "Do not add keys, reuse a session, or change these values. After its result, finish with prose and STOP before Reviewer / Commit.",
].join("\n")
function exactArguments(value: unknown, candidate: IntentCandidate): void {
  if (!exactKeys(value, ["agent", "description", "prompt"]) || !same(value, nativeArguments(candidate))) throw new Error("Native arguments differ from frozen contract")
}
const emptyPermissions = (permissions: unknown) => permissions === undefined || (Array.isArray(permissions) && permissions.length === 0)

// Server-only host adapter. All reads use the supported Effect session API.
// The slot belongs to this closure, with no persistence or transcript recovery.
export function nativeAdmission(context: Context) {
  const cap = new NativeCap()
  const actor = Agent.ID.make(`cap_sponsor_${randomUUID()}`)
  // ConfigAgentPlugin runs after external plugins and appends global/agent
  // rules. Narrow even configured allows, without ever elevating a host deny.
  const sponsorPermission = (event: PermissionEvaluation) => Effect.sync(() => {
    if (event.agent === actor && (event.action !== "subagent" || event.resources.length !== 1 || event.resources[0] !== target)) event.effect = "deny"
  })
  const local = () => {
    cap.live()
    const claim = cap.claim
    if (!same(snapshotLocation(context.location), claim.location) || !candidateIntact(claim.candidate)) throw new Error("Claim or server location changed")
    parseProposal(JSON.stringify(claim.candidate.proposal), claim.candidate.root)
  }
  const rootIdentity = (root: Session.Info) => {
    const claim = cap.claim
    if (root.id !== claim.rootSessionID || root.agent !== "orchestrator" || root.parentID || root.fork || root.revert ||
        root.time.archived || !same(root.location, claim.location) || !emptyPermissions(root.permissions)) throw new Error("Root role, location, or permissions changed")
  }
  const baseline = () => ({ root: cap.claim.candidate.root, head: cap.claim.candidate.head, paths: [] })
  const actualCall = (history: readonly SessionMessage.Info[], call: Reservation, status: "running" | "completed") => {
    const control = cap.control
    const controls = history.filter((message) => message.id === control.id)
    const messages = history.filter((message) => message.id === call.messageID)
    const message = messages[0]
    if (controls.length !== 1 || controls[0]?.type !== "synthetic" || controls[0].text !== control.text ||
        messages.length !== 1 || message?.type !== "assistant" || message.agent !== "orchestrator" || message.error) throw new Error("Published call/control identity changed")
    const start = history.indexOf(controls[0])
    const end = history.indexOf(message)
    if (start >= end || history.slice(start + 1).some((item) => !["assistant", "idle"].includes(item.type))) throw new Error("Call does not follow its exact control input")
    const parts = message.content.filter((part) => part.type === "tool" && part.id === call.id)
    if (parts.length !== 1 || parts[0]?.type !== "tool" || parts[0].name !== "subagent" || parts[0].state.status !== status) throw new Error("Published native call is missing or aliased")
    // Parser-failed calls skip execute.before but remain published tool parts.
    // Include every tool state when identifying the first post-control contender.
    const first = history.slice(start + 1).flatMap((item) => item.type === "assistant" ? item.content : [])
      .find((part) => part.type === "tool")
    if (first !== parts[0]) throw new Error("Earlier tool contender follows CAP control input")
    exactArguments(parts[0].state.input, cap.claim.candidate) // Original, before native empty-key normalization.
    return parts[0]
  }
  const before = (event: ToolHooks["execute.before"]) => Effect.gen(function* () {
    yield* attempt(() => cap.live())
    if (event.sessionID !== cap.rootSessionID) {
      if (event.input && typeof event.input === "object" && "agent" in event.input && event.input.agent === target) yield* Effect.fail(fail("No reserved Implementer call"))
      return
    }
    // Select the owner before any awaits. A losing contender cannot close it.
    yield* attempt(() => cap.reserve({ sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id }))
    yield* Effect.gen(function* () {
      yield* attempt(() => {
        if (event.tool !== "subagent" || event.agent !== "orchestrator") throw new Error("Unexpected first contender")
        exactArguments(event.input, cap.claim.candidate)
      })
      const history = yield* context.session.context({ sessionID: event.sessionID }).pipe(Effect.mapError((error) => fail(String(error))))
      yield* attempt(() => {
        cap.assertReserved({ sessionID: event.sessionID, agent: event.agent, messageID: event.messageID, id: event.id })
        actualCall(history, event, "running")
      })
    }).pipe(Effect.onError(() => Effect.sync(() => cap.close())), Effect.onInterrupt(() => Effect.sync(() => cap.close())))
  })
  const execute = (original: Tool.Info["execute"]) => (input: unknown, invocation: Tool.Context) => Effect.gen(function* () {
    yield* attempt(() => cap.live())
    const governed = invocation.sessionID === cap.rootSessionID || (!!input && typeof input === "object" && "agent" in input && input.agent === target)
    if (!governed) return yield* original(input, invocation)
    const call: Reservation = { sessionID: invocation.sessionID, agent: invocation.agent, messageID: invocation.messageID, id: invocation.id }
    // Executor losers also cannot change an in-flight owner's state.
    yield* attempt(() => cap.enter(call))
    return yield* Effect.gen(function* () {
      yield* attempt(() => { local(); exactArguments(input, cap.claim.candidate) })
      const history = yield* context.session.context({ sessionID: invocation.sessionID })
      yield* attempt(() => actualCall(history, call, "running"))
      const root = yield* context.session.get({ sessionID: invocation.sessionID })
      const sponsor = yield* context.agent.get({ agentID: actor })
      // All awaited reads precede the final synchronous freshness/consume barrier.
      yield* attempt(() => {
        rootIdentity(root); local(); cap.assertReserved(call); exactArguments(input, cap.claim.candidate)
        // Inspect the final transformed definition, not the registration-time
        // array. Allow additions are bounded by the deny-only hook. Reject all
        // other additions except the host's unrelated browser deny; no wildcard
        // permission evaluator or override of configured denies is needed.
        const role = sponsor.data
        if (role.id !== actor || !role.hidden || role.mode !== "subagent" ||
            !same(role.permissions.slice(0, sponsorRules.length), sponsorRules) ||
            role.permissions.slice(sponsorRules.length).some((rule) => rule.effect !== "allow" &&
              !same(rule, { action: "browser", resource: "*", effect: "deny" }))) throw new Error("Sponsor effective host policy is unsupported or denies delegation")
        requireFresh(observeGit(cap.claim.location.directory!, baseline()), baseline())
        cap.consume(call)
      })
      const result = yield* original(input, {
        ...invocation, agent: actor,
        progress: (update) => Effect.gen(function* () {
          yield* attempt(() => {
            if (typeof update.sessionID !== "string" || update.status !== "running") throw new Error("Unexpected native progress receipt")
            cap.progress(update.sessionID)
          }).pipe(Effect.orDie)
          yield* invocation.progress(update)
        }),
      })
      yield* attempt(() => cap.receipt(result))
      return result // Native output normalization, after hooks and publication remain native.
    }).pipe(Effect.onError(() => Effect.sync(() => cap.close())), Effect.onInterrupt(() => Effect.sync(() => cap.close())))
  }).pipe(Effect.mapError((error) => error instanceof Tool.Error ? error : fail(String(error))))
  const verifyResult = () => Effect.gen(function* () {
    yield* attempt(local)
    if (cap.phase !== "consumed" || !cap.childID || !cap.result) return yield* Effect.fail(fail("Root settled without a verified native execution"))
    const claim = cap.claim
    const childID = Session.ID.make(cap.childID)
    const root = yield* context.session.get({ sessionID: Session.ID.make(claim.rootSessionID) })
    const child = yield* context.session.get({ sessionID: childID })
    const history = yield* context.session.context({ sessionID: Session.ID.make(claim.rootSessionID) })
    const childHistory = yield* context.session.context({ sessionID: childID })
    return yield* attempt(() => {
      rootIdentity(root); local()
      if (root.outcome !== "succeeded" || !root.time.idle || child.id !== childID || child.parentID !== root.id || child.agent !== target ||
          child.fork || child.revert || child.time.archived || !same(child.location, claim.location) || !emptyPermissions(child.permissions) ||
          child.outcome !== "succeeded" || !child.time.idle) throw new Error("Native root/child completion binding failed")
      const users = childHistory.filter((message) => message.type === "user")
      const assistants = childHistory.filter((message) => message.type === "assistant")
      const final = assistants.at(-1)
      if (users.length !== 1 || childHistory[0] !== users[0] || childHistory.some((message) => !["user", "assistant", "idle"].includes(message.type)) || users[0]?.text !== `You are a subagent spawned by another session.\n${implementerPrompt(claim.candidate)}` ||
          [users[0]?.files, users[0]?.agents, users[0]?.skills].some((items) => items && items.length) ||
          !final || final.finish !== "stop" || final.agent !== target || final.error ||
          assistants.some((message) => message.agent !== target)) throw new Error("Native child input/result binding failed")
      const text = final.content.filter((part) => part.type === "text").map((part) => part.text).join("")
      const result = cap.result as Tool.Result
      const output = result.output as { sessionID?: unknown; status?: unknown; output?: unknown } | undefined
      const wrapper = `<subagent sessionID="${childID}" state="completed">\n${text}\n</subagent>`
      if (!text || output?.sessionID !== childID || output.status !== "completed" || output.output !== text ||
          !same(result.metadata, { sessionID: childID, status: "completed" }) || result.content !== wrapper) throw new Error("Native result/progress/metadata disagreement")
      // Bind the native persisted result after normalization/after hooks to the
      // original receipt, rather than trusting a mutable result hook's success.
      const call = history.flatMap((message) => message.type === "assistant" ? message.content.filter((part) =>
        part.type === "tool" && part.state.status === "completed" && part.state.metadata?.sessionID === childID)
        .map((part) => ({ messageID: message.id, part })) : [])
      if (call.length !== 1 || call[0]?.part.type !== "tool") throw new Error("Native result call is ambiguous")
      const reservation = { sessionID: root.id, agent: "orchestrator", messageID: call[0].messageID, id: call[0].part.id }
      cap.assertConsumed(reservation)
      const part = actualCall(history, reservation, "completed")
      // ToolOutput.truncate adds truncated:false to unchanged short results.
      // Any other metadata or content transformation remains unverified.
      if (part.state.status !== "completed" || !same(part.state.metadata, { ...result.metadata, truncated: false }) ||
          !same(part.state.content, [{ type: "text", text: wrapper }])) throw new Error("Published native result differs from original receipt")
      const paths = requireInScope(observeGit(claim.location.directory!, baseline()), baseline(), claim.candidate.proposal.files)
      cap.live()
      return `Implementation gate complete: HEAD ${claim.candidate.head} unchanged. Resulting paths (${paths.length}): ${paths.join(", ") || "(none)"}. STOP before Reviewer / Commit.`
    })
  })
  const authorize = (input: unknown) => Effect.gen(function* () {
    yield* attempt(() => { cap.accept(input, controlText) })
    return yield* Effect.gen(function* () {
      yield* attempt(() => { local(); requireFresh(observeGit(cap.claim.location.directory!, baseline()), baseline()) })
      const { id, text } = cap.control
      const wake = yield* context.session.synthetic({ sessionID: Session.ID.make(cap.claim.rootSessionID), id: SessionMessage.ID.make(id), text, delivery: "steer", resume: true })
      yield* attempt(() => {
        cap.live()
        if (wake.id !== id || wake.sessionID !== cap.rootSessionID || wake.type !== "synthetic" || wake.delivery !== "steer" || wake.payload.text !== text) throw new Error("Synthetic wake admission changed")
      })
      yield* context.session.wait({ sessionID: Session.ID.make(cap.claim.rootSessionID) })
      return yield* verifyResult()
    }).pipe(Effect.ensuring(Effect.sync(() => cap.close())))
  }).pipe(Effect.catchCause((cause) => Effect.succeed(`STOP — Native implementation outcome unverified; no retry or replacement. ${String(Cause.squash(cause))}`)))
  return { before, execute, authorize, teardown: () => cap.teardown(), sponsorPermission, actor, cap }
}

// Preserve the native decoder and its model-facing schema, but check authority
// arguments before decoding can discard extras. Planner calls remain native.
export function strictNativeInput(input: Tool.ValueSchema<any>, cap: NativeCap): Tool.ValueSchema<any> {
  if (!Schema.isSchema(input)) throw new Error("Pinned native subagent input codec is unavailable")
  const native = Schema.toStandardSchemaV1(input)
  const json = Schema.toStandardJSONSchemaV1(input)
  return { "~standard": {
    ...native["~standard"], ...json["~standard"],
    validate: (value: unknown) => {
      try {
        cap.live()
        if (value && typeof value === "object" && "agent" in value && value.agent === target) exactArguments(value, cap.claim.candidate)
      } catch (error) { return { issues: [{ message: String(error) }] } }
      return native["~standard"].validate(value)
    },
  } }
}
