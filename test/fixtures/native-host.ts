// Bundled only by the regression test, to reproduce the host's separate Effect
// instance without building or running OpenCode. Mirrors 2.0.21 SubagentTool.Input.
import * as Schema from "effect/Schema"

const sessionID = Schema.String.check(Schema.isStartsWith("ses")).pipe(Schema.brand("SessionID"))
export const Input = Schema.Struct({
  agent: Schema.String,
  description: Schema.String,
  prompt: Schema.String,
  model: Schema.optionalKey(Schema.String),
  sessionID: Schema.optionalKey(sessionID),
  background: Schema.optionalKey(Schema.Boolean),
})
export const decode = Schema.decodeUnknownPromise(Input, { errors: "all" })
export const validate = Schema.toStandardSchemaV1(Input.rebuild(Input.ast))["~standard"].validate
export const json = Schema.toStandardJSONSchemaV1
