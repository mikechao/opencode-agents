import { Rpc } from "@opencode/plugin/effect"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { Effect, Schema } from "effect"
import { Model } from "@opencode/schema/model"
import { RolePreference, type agentModels } from "./agent-models.ts"

// Expose only Standard Schema. toStandardSchemaV1 also retains the Effect AST;
// the host would prefer that AST and decode it with a different Effect runtime,
// which can omit optional fields. The validator keeps native Model.Ref decoding
// in the runtime that owns the schema.
const portable = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => ({
  "~standard": Schema.toStandardSchemaV1(schema)["~standard"],
})
const nothing = portable(Schema.Void)
const errors = { settings: nothing }
export const agentModelsRpc = Rpc.define({
  id: "opencode-agents.models",
  methods: {
    list: { input: nothing, output: portable(Schema.Array(RolePreference)), errors },
    set: { input: portable(Schema.Struct({ role: Schema.String, model: Model.Ref })), output: nothing, errors },
    reset: { input: portable(Schema.Struct({ role: Schema.String })), output: nothing, errors },
  },
  events: {},
})

export function agentModelsHandlers(models: ReturnType<typeof agentModels>): RpcHandlers<typeof agentModelsRpc> {
  return {
    list: (_input, rpc) =>
      models.list().pipe(Effect.catch((error) => Effect.fail(rpc.error("settings", error.message)))),
    set: (input, rpc) =>
      models
        .set(input.role, input.model)
        .pipe(Effect.catch((error) => Effect.fail(rpc.error("settings", error.message)))),
    reset: (input, rpc) =>
      models.reset(input.role).pipe(Effect.catch((error) => Effect.fail(rpc.error("settings", error.message)))),
  }
}
