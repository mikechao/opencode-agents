import { Rpc } from "@opencode/plugin/effect"
import type { RpcHandlers } from "@opencode/plugin/effect/rpc"
import { Effect, Schema } from "effect"
import { Model } from "@opencode/schema/model"
import { RolePreference, type agentModels } from "./agent-models.ts"

// Promise/TUI RPC accepts portable Standard Schema contracts; Effect handlers
// retain the same native schema types and validation on the server.
const portable = Schema.toStandardSchemaV1
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
