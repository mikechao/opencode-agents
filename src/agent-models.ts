import type { Context } from "@opencode/plugin/effect/plugin"
import type { ToolHooks } from "@opencode/plugin/effect/tool"
import { Model } from "@opencode/schema/model"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"

export const managedRoles = [
  { id: "planner", label: "Planner" },
  { id: "explorer", label: "Explorer" },
  { id: "authorized_implementer", label: "Implementer" },
  { id: "reviewer", label: "Reviewer" },
  { id: "committer", label: "Committer" },
] as const
export const Role = Schema.Literals(managedRoles.map((role) => role.id))
export type Role = typeof Role.Type

const nonempty = Schema.String.check(Schema.isMinLength(1))
const Call = Schema.Struct({ agent: Role, description: nonempty, prompt: nonempty })
const decodeCall = Schema.decodeUnknownSync(Call, { onExcessProperty: "error" })
const decodeSelection = Schema.decodeUnknownSync(Model.Ref, { onExcessProperty: "error" })

export const Preference = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("native") }),
  Schema.Struct({
    kind: Schema.Literal("override"),
    model: Model.Ref,
    availability: Schema.Literals(["available", "model-unavailable", "variant-unavailable"]),
  }),
  Schema.Struct({ kind: Schema.Literal("invalid"), message: Schema.String }),
])
export const RolePreference = Schema.Struct({
  role: Role,
  label: Schema.String,
  loaded: Schema.Boolean,
  nativeModel: Schema.NullOr(Model.Ref),
  preference: Preference,
})
export type RolePreference = typeof RolePreference.Type

export class ModelSettingsError extends Schema.TaggedError<ModelSettingsError>()("ModelSettingsError", {
  message: Schema.String,
}) {}
const error = (cause: unknown) =>
  new ModelSettingsError({ message: cause instanceof Error ? cause.message : String(cause) })
const checked = <A>(read: () => A) => Effect.try({ try: read, catch: error })

export function managedRole(value: unknown): Role | undefined {
  return managedRoles.find((role) => role.id === value)?.id
}
export function requireRole(value: unknown): Role {
  const role = managedRole(value)
  if (!role) throw new Error("Unknown project-managed role")
  return role
}
export function formatSelection(model: Model.Ref): string {
  return `${model.providerID}/${model.id}${model.variant === undefined ? "" : `#${model.variant}`}`
}
export function parseSelection(value: unknown): Model.Ref {
  const model = decodeSelection(value)
  const parsed = Model.Ref.parse(formatSelection(model))
  if (
    !model.providerID.trim() ||
    !model.id.trim() ||
    (model.variant !== undefined && !model.variant.trim()) ||
    parsed.providerID !== model.providerID ||
    parsed.id !== model.id ||
    parsed.variant !== model.variant
  )
    throw new Error("Malformed model preference")
  return parsed
}
export function preferenceKey(location: Pick<Context["location"], "directory" | "workspaceID">, role: Role) {
  // Exact host location, not project ID (which may be shared across clones).
  return `agent-models:v1:${JSON.stringify([location.directory, location.workspaceID ?? null, role])}`
}
function selectionAvailability(selection: Model.Ref, models: readonly Model.Info[]) {
  const model = models.find((model) => model.providerID === selection.providerID && model.id === selection.id)
  if (!model) return "model-unavailable"
  if (selection.variant !== undefined && !model.variants.some((variant) => variant.id === selection.variant))
    return "variant-unavailable"
  return "available"
}
export function selectionAvailable(selection: Model.Ref, models: readonly Model.Info[]) {
  return selectionAvailability(selection, models) === "available"
}
const callRole = (input: unknown) =>
  input && typeof input === "object" && "agent" in input ? managedRole(input.agent) : undefined
const toolError = (cause: unknown) =>
  new Tool.Error({ message: `Agent model settings: ${cause instanceof Error ? cause.message : String(cause)}` })

export function agentModels(context: Context) {
  // Read per role at use time: no registry state, cached policy, or restart/open prerequisite.
  const read = (role: Role) =>
    context.storage
      .get(preferenceKey(context.location, role))
      .pipe(
        Effect.flatMap((value) =>
          value === undefined ? Effect.succeed(undefined) : checked(() => parseSelection(value)),
        ),
      )
  const catalog = () =>
    context.model.list().pipe(
      Effect.map((result) => result.data),
      Effect.mapError(error),
    )
  const list = () =>
    Effect.gen(function* () {
      const models = yield* catalog()
      const agents = yield* context.agent.list().pipe(Effect.mapError(error))
      return yield* Effect.forEach(managedRoles, (role) =>
        Effect.gen(function* () {
          const agent = agents.data.find((agent) => agent.id === role.id)
          const preference: RolePreference["preference"] = yield* read(role.id).pipe(
            Effect.map((model): RolePreference["preference"] =>
              model
                ? { kind: "override", model, availability: selectionAvailability(model, models) }
                : { kind: "native" },
            ),
            Effect.catch((cause) => Effect.succeed({ kind: "invalid" as const, message: cause.message })),
          )
          return {
            role: role.id,
            label: role.label,
            loaded: agent !== undefined,
            nativeModel: agent?.model ?? null,
            preference,
          }
        }),
      )
    })
  const set = (roleInput: unknown, modelInput: unknown) =>
    Effect.gen(function* () {
      const role = yield* checked(() => requireRole(roleInput))
      const model = yield* checked(() => parseSelection(modelInput))
      const agents = yield* context.agent.list().pipe(Effect.mapError(error))
      if (!agents.data.some((agent) => agent.id === role))
        return yield* new ModelSettingsError({ message: "Managed agent is not loaded" })
      if (!selectionAvailable(model, yield* catalog()))
        return yield* new ModelSettingsError({ message: `Model or variant unavailable: ${formatSelection(model)}` })
      yield* context.storage.set(preferenceKey(context.location, role), model)
    })
  const reset = (roleInput: unknown) =>
    checked(() => requireRole(roleInput)).pipe(
      Effect.flatMap((role) => context.storage.remove(preferenceKey(context.location, role))),
    )

  // The host normalizes empty model/sessionID keys before external hooks and
  // decoding can discard unknown keys. Validate the *published* original too.
  const before = (event: ToolHooks["execute.before"]) =>
    Effect.gen(function* () {
      if (event.tool !== "subagent" || !callRole(event.input)) return
      const decoded = yield* checked(() => decodeCall(event.input))
      const history = yield* context.session.context({ sessionID: event.sessionID }).pipe(Effect.mapError(error))
      const messages = history.filter((message) => message.id === event.messageID)
      const message = messages[0]
      const parts =
        message?.type === "assistant"
          ? message.content.filter((part) => part.type === "tool" && part.id === event.id)
          : []
      const part = parts[0]
      if (
        messages.length !== 1 ||
        parts.length !== 1 ||
        part?.type !== "tool" ||
        part.name !== "subagent" ||
        part.state.status !== "running"
      )
        return yield* new ModelSettingsError({ message: "Original managed subagent call is missing or ambiguous" })
      const original = yield* checked(() => decodeCall(part.state.input))
      if (
        original.agent !== decoded.agent ||
        original.description !== decoded.description ||
        original.prompt !== decoded.prompt
      )
        return yield* new ModelSettingsError({ message: "Managed subagent input changed before execution" })
    }).pipe(Effect.mapError(toolError))

  // Admission calls preparation after original-input verification, before its
  // one-shot barrier. All settings reads and catalog checks finish here. Copy
  // only the executor input; published calls and receipts stay three-key.
  const prepare = (input: unknown) =>
    Effect.gen(function* () {
      if (!callRole(input)) return input
      const call = yield* checked(() => decodeCall(input))
      const model = yield* read(call.agent)
      if (model === undefined) return input
      if (!selectionAvailable(model, yield* catalog()))
        return yield* new ModelSettingsError({ message: `Model or variant unavailable: ${formatSelection(model)}` })
      return { ...call, model: formatSelection(model) }
    }).pipe(Effect.mapError(toolError))
  return { list, set, reset, before, prepare }
}
