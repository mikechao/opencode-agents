import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Read-only upgrade guards against the selected local host, complementing the
// effective-policy tests in attempt.test.ts. These neither load nor launch it.
const host = path.resolve(import.meta.dir, "../../opencode/packages/core/src")
// Ignore formatting whitespace, preserving authority-bearing string literals.
const source = (file: string) =>
  readFileSync(path.join(host, file), "utf8").replace(
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\s+/g,
    (_match, literal) => literal ?? "",
  )

test("pinned native executor accepts runtime-only model injection after parsing and before fresh child creation", () => {
  const runtime = source("tool/runtime.ts")
  expect(runtime).toContain("constdecoded=yield*decodeInput(tool,input)")
  expect(runtime).toContain("tool.execute(decoded,context)")
  const native = source("tool/plugin/subagent.ts")
  expect(native).toContain("input.model===undefined?undefined:yield*resolveModel(input.model)")
  expect(native).toContain("constmodel=override??agent.model??parent.model")
  expect(native).toContain("try:()=>Model.Ref.parse(input)")
  expect(native).toContain("model.variants.some((variant)=>variant.id===ref.variant)")
  const selection = native.indexOf("constmodel=override??agent.model??parent.model")
  expect(native.indexOf("sessions.create({")).toBeGreaterThan(selection)
  expect(native.indexOf("sessions.prompt({")).toBeGreaterThan(selection)
})

test("pinned host publishes original tool input before executor dispatch and retains it on success/failure", () => {
  const step = source("session/runner/step.ts")
  expect(step.indexOf("yield*publisher.publish(event)")).toBeLessThan(step.indexOf("restore(executeTool(event))"))
  const publisher = source("session/runner/publish-llm-event.ts")
  expect(publisher).toContain("bus.publish(SessionEvent.Tool.Called,{")
  expect(publisher).toContain("input:asRecord(event.input)")
  const projection = source("session/message-updater.ts")
  expect(projection).toContain("input:event.data.input")
  expect(projection).toContain("input:match.state.input")
  expect(projection).toContain('input:typeofmatch.state.input==="string"?{}:match.state.input')
  // Explicit selections are checked against current availability, never replaced
  // with the default; ongoing execution reads session.model, not agent.model.
  expect(source("session/runner/model.ts")).toContain("newModelUnavailableError({")
  expect(source("session/context.ts")).toContain("models.resolve(session,model.available)")
})

test("pinned host malformed JSON skips execution and projects an errored non-provider-executed tool part", () => {
  const step = source("session/runner/step.ts")
  expect(step).toContain('if(event.type!=="tool-call"||event.providerExecuted)return')
  const publisher = source("session/runner/publish-llm-event.ts")
  expect(publisher).toContain('case"tool-input-error":')
  expect(publisher).toContain("yield*failMalformedToolInput(event)")
  const start = publisher.indexOf("constfailMalformedToolInput=")
  const malformed = publisher.slice(start, publisher.indexOf("constflush=", start))
  expect(malformed).toContain("bus.publish(SessionEvent.Tool.Failed,{")
  expect(malformed).toContain('type:"tool.input-json"')
  expect(malformed).toContain(
    'message:"Tool call arguments were malformed JSON and were not executed. Retry with valid JSON."',
  )
  expect(malformed).toContain("executed:false")
  const projection = source("session/message-updater.ts")
  const failed = projection.slice(
    projection.indexOf('"session.tool.failed":'),
    projection.indexOf('"session.reasoning.started":'),
  )
  expect(failed).toContain("match.executed=event.data.executed||match.executed===true")
  expect(failed).toContain(
    'status:"error",error:event.data.error,input:typeofmatch.state.input==="string"?{}:match.state.input',
  )
})

test("pinned OpenCode native sponsorship forwards explicit actor and real parent/source before child creation", () => {
  const native = source("tool/plugin/subagent.ts")
  const assert = native.indexOf("yield*permission.assert({")
  const create = native.indexOf("sessions.create({")
  expect(assert).toBeGreaterThan(-1)
  expect(create).toBeGreaterThan(assert)
  const permission = native.slice(assert, create)
  expect(permission).toContain("resources:[agent.id]")
  expect(permission).toContain("sessionID:context.sessionID")
  expect(permission).toContain("agent:context.agent")
  expect(permission).toContain('source:{type:"tool",messageID:context.messageID,id:context.id,}')
  expect(native.slice(create)).toContain("parentID:context.sessionID")
  expect(native).toContain('["You are a subagent spawned by another session.",input.prompt].join("\\n")')
})

test("pinned OpenCode permission uses explicit actor/session policy and effective deny before hooks/ask", () => {
  const permission = source("permission.ts")
  expect(permission).toContain("agents.resolve(agentID??session.agent)")
  expect(permission).toContain("merge(agent?.permissions??missingAgentPermissions,session.permissions??[])")
  expect(permission).toContain(
    ".findLast((rule)=>Wildcard.match(action,rule.action)&&Wildcard.match(resource,rule.resource))",
  )
  const evaluation = permission.slice(permission.indexOf("constevaluateInput="), permission.indexOf("functionrequest("))
  const deny = evaluation.indexOf('if(denied(input,rules))return{effect:"deny"asconst,rules}')
  expect(deny).toBeGreaterThan(-1)
  expect(evaluation.indexOf("hooks.trigger(")).toBeGreaterThan(deny)
  expect(evaluation).toContain("agent:input.agent")
  const assertion = permission.slice(permission.indexOf("constassert="), permission.indexOf("constreply="))
  const blocked = assertion.indexOf('if(result.effect==="deny")')
  const ask = assertion.indexOf("create(request(input,result.message),input.agent)")
  expect(blocked).toBeGreaterThan(-1)
  expect(assertion.indexOf("newBlockedError(")).toBeGreaterThan(blocked)
  expect(ask).toBeGreaterThan(assertion.indexOf("newBlockedError("))
})

test("pinned OpenCode nesting and foreground result expose fresh child completion evidence", () => {
  const native = source("tool/plugin/subagent.ts")
  expect(native).toContain('Config.latest(yield*config.entries(),"experimental")?.subagent_depth??1')
  const gate = native.indexOf("if(depth>=limit)")
  expect(gate).toBeGreaterThan(-1)
  expect(gate).toBeLessThan(native.indexOf("sessions.create({"))
  expect(native).toContain("input.sessionID===undefined?undefined:")
  expect(native).toContain("yield*jobs.block({id:child.id,sessionID:context.sessionID})")
  expect(native).toContain('status:"completed"asconst,output:result?.info.output??SubagentCompletion.NO_TEXT')
  expect(native).toContain("metadata:{sessionID:output.sessionID,status:output.status}")
  expect(source("session/subagent-job.ts")).toContain("returnSubagentCompletion.text(assistant)")
})

test("pinned OpenCode joins local foreground calls and replays persisted tool content into model context", () => {
  const step = source("session/runner/step.ts")
  expect(step).toContain("Effect.forkScoped")
  expect(step).toContain("Fiber.awaitAll(toolRuns.map((run)=>run.fiber))")
  expect(step).toContain("Effect.flatMap(toolOutput.truncate)")
  const projection = source("session/message-updater.ts")
  expect(projection).toContain('status:"completed",input:match.state.input,content:event.data.content')
  const lowering = source("session/runner/to-llm-message.ts")
  expect(lowering).toContain("constcontent=tool.state.content")
  expect(lowering).toContain('single?.type==="text"?{type:"text"asconst,value:single.text}')
  expect(lowering).toContain(".map(Message.tool)")
  expect(source("session/model-request.ts")).toContain(
    "messages:toLLMMessages(input.messages,input.model.ref,providerMetadataKey)",
  )
})

test("pinned terminal execution events project their own exact idle message identities", () => {
  const projection = source("session/message-updater.ts")
  const idle = projection.slice(projection.indexOf("constidle="), projection.indexOf("constproject="))
  expect(idle).toContain("id:SessionMessage.ID.fromEvent(event.id)")
  expect(projection).toContain('"session.execution.succeeded":()=>idle("succeeded")')
  expect(source("../../schema/src/session-message.ts")).toContain('eventID.replace(/^evt_/,"msg_")')
})

test("pinned native tool failures retain trusted progress and error metadata", () => {
  const publisher = source("session/runner/publish-llm-event.ts")
  expect(publisher).toContain("return{metadata:{...tool.progress,...metadata}}")
  expect(publisher).toContain("...failureSnapshot(tool,metadata)")
  expect(source("session/runner/step.ts")).toContain(
    "publisher.failTool(event.id,toSessionError(error),error.metadata)",
  )
})

// These guard the host semantics modeled by agent-models.test.ts; its existing
// independent-runtime fixture owns variant preservation and application behavior.
test("pinned RPC codecs prefer Effect Schema and validate portable input/output through Standard Schema", () => {
  const rpc = source("rpc.ts")
  expect(rpc).toContain("constparsed=yield*parse(method.input,input).pipe(")
  expect(rpc).toContain("returnyield*encode(method.output,result).pipe(")
  const parse = rpc.slice(rpc.indexOf("functionparse("), rpc.indexOf("functionencode("))
  expect(parse).toContain(
    "if(Schema.isSchema(schema))returnSchema.decodeUnknownEffect(schema)(value)if(isStandardSchema(schema))",
  )
  expect(parse).toContain('schema["~standard"].validate(value)')
  expect(parse).toContain("if(result.issues)returnyield*Effect.fail(")
  expect(parse).toContain("returnresult.value")
  const encode = rpc.slice(rpc.indexOf("functionencode("), rpc.indexOf("functionencodeError("))
  expect(encode).toContain(
    "returnSchema.isSchema(schema)?Schema.encodeUnknownEffect(schema)(value):parse(schema,value)",
  )
  expect(rpc).toContain('return"~standard"inschema')
})

test("pinned RPC dispatch uses the latest whole definition by ID and removes scoped entries on disposal", () => {
  const rpc = source("rpc.ts")
  const register = rpc.slice(rpc.indexOf("constregister="), rpc.indexOf("constcall="))
  expect(register).toContain("constentry={definition,handlers}")
  expect(register).toContain(
    "yield*Effect.acquireRelease(Effect.sync(()=>registrations.set(definition.id,[...(registrations.get(definition.id)??[]),entry])),()=>dispose,)",
  )
  expect(register).toContain(
    "constdispose=Effect.sync(()=>{constremaining=(registrations.get(definition.id)??[]).filter((candidate)=>candidate!==entry)",
  )
  expect(register).toContain("if(remaining.length===0){registrations.delete(definition.id)return}")
  expect(register).toContain("registrations.set(definition.id,remaining)")
  const call = rpc.slice(rpc.indexOf("constcall="), rpc.indexOf("constclient="))
  expect(call).toContain("constentry=registrations.get(rpcID)?.at(-1)")
  expect(call).toContain('if(!entry)returnyield*Effect.fail(failure("rpc.unavailable",')
  expect(call).toContain("if(!Object.hasOwn(entry.definition.methods,name)||!Object.hasOwn(entry.handlers,name))")
  expect(call).toContain('failure("rpc.method_not_found",')
  expect(call).toContain("constmethod=entry.definition.methods[name]consthandler=entry.handlers[name]")
  const plugin = source("plugin.ts")
  expect(plugin).toContain("Context.make(Scope.Scope,activation.scope)")
  expect(plugin).toContain("yield*Scope.close(slot.activation.scope,Exit.void)")
})

test("pinned Promise RPC routes an explicit directory to its location graph without a workspace selector", () => {
  const client = source("../../client/src/promise/rpc.ts")
  const call = client.slice(client.indexOf("constresult=awaitraw.rpc.call("), client.indexOf("returnresult.output"))
  expect(call).toContain("rpcID:definition.id,method:name,")
  expect(call).toContain("location:options?.location,")
  const transport = source("../../client/src/promise/generated/client.ts")
  const request = transport.slice(transport.indexOf("rpc:{"), transport.indexOf("event:{"))
  expect(request).toContain(
    `path:\`/api/rpc/\${encodeURIComponent(input.rpcID)}/\${encodeURIComponent(input.method)}\``,
  )
  expect(request).toContain('query:{location:input["location"]}')
  expect(transport).toContain("appendQuery(url.searchParams,key,value)")
  expect(transport).toContain(`appendQuery(params,\`\${key}[\${child}]\`,item)`)
  expect(source("../../protocol/src/groups/rpc.ts")).toContain("query:LocationQuery,")
  expect(source("../../protocol/src/api.ts")).toContain(".add(RpcGroup.middleware(locationMiddleware))")
  const location = source("../../server/src/location.ts")
  const ref = location.slice(location.indexOf("exportfunctionrequestRef("), location.indexOf("functiondecode("))
  expect(ref).toContain('constdirectory=query.get("location[directory]")||')
  expect(ref).toContain("returnLocation.Ref.make({directory:AbsolutePath.make(directory),})")
  expect(ref).not.toContain("workspaceID")
  expect(location).toContain("Effect.provide(locations.get(requestRef(request)))")
  const query = source("../../protocol/src/groups/location.ts")
  expect(query).toContain(
    "exportconstLocationQuery=Schema.Struct({location:Schema.optional(Schema.Struct({directory:Schema.optional(Schema.String),}),),})",
  )
  expect(source("location-services.ts")).toContain(
    "get:(ref:Location.Ref)=>inner.get(LocationServiceMap.canonical(ref))",
  )
  expect(source("rpc.ts")).toContain(
    "exportconstnode=makeLocationNode({service:Service,layer,deps:[Bus.node,Location.node]})",
  )
})
