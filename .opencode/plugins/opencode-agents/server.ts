import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"
import { nativeAdmission, sponsorRules } from "../../../src/native.ts"
import { authorizeRpc } from "../../../src/authorize-rpc.ts"
import { agentModels } from "../../../src/agent-models.ts"
import { agentModelsHandlers, agentModelsRpc } from "../../../src/agent-models-rpc.ts"

export default Plugin.define({
  id: "opencode-agents",
  effect: (context) =>
    Effect.gen(function* () {
      const admission = nativeAdmission(context)
      const models = agentModels(context)
      yield* Effect.addFinalizer(() => Effect.sync(admission.teardown))
      yield* context.agent.transform((editor) =>
        editor.update(admission.actor, (agent) => {
          agent.mode = "subagent"
          agent.hidden = true
          agent.permissions = sponsorRules.map((rule) => ({ ...rule }))
        }),
      )
      yield* context.permission.hook("evaluate", admission.sponsorPermission)
      yield* context.tool.hook("execute.before", (event) =>
        admission.before(event).pipe(Effect.andThen(models.before(event))),
      )
      yield* context.tool.transform((editor) =>
        editor.update("subagent", (tool) => {
          tool.execute = admission.execute(tool.execute, models.prepare)
        }),
      )
      yield* context.rpc.register(authorizeRpc, { authorize: (claim) => admission.authorize(claim) }).pipe(Effect.orDie)
      yield* context.rpc.register(agentModelsRpc, agentModelsHandlers(models)).pipe(Effect.orDie)
    }),
})
