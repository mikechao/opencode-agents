import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// Read-only upgrade guards against the selected local host, complementing the
// effective-policy tests in attempt.test.ts. These neither load nor launch it.
const host = path.resolve(import.meta.dir, "../../opencode/packages/core/src")
// Ignore formatting whitespace, preserving authority-bearing string literals.
const source = (file: string) => readFileSync(path.join(host, file), "utf8")
  .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\s+/g, (match, literal) => literal ?? "")

test("pinned OpenCode native sponsorship forwards explicit actor and real parent/source before child creation", () => {
  const native = source("tool/plugin/subagent.ts")
  const assert = native.indexOf('yield*permission.assert({')
  const create = native.indexOf('sessions.create({')
  expect(assert).toBeGreaterThan(-1)
  expect(create).toBeGreaterThan(assert)
  const permission = native.slice(assert, create)
  expect(permission).toContain('resources:[agent.id]')
  expect(permission).toContain('sessionID:context.sessionID')
  expect(permission).toContain('agent:context.agent')
  expect(permission).toContain('source:{type:"tool",messageID:context.messageID,id:context.id,}')
  expect(native.slice(create)).toContain('parentID:context.sessionID')
  expect(native).toContain('["You are a subagent spawned by another session.",input.prompt].join("\\n")')
})

test("pinned OpenCode permission uses explicit actor/session policy and effective deny before hooks/ask", () => {
  const permission = source("permission.ts")
  expect(permission).toContain('agents.resolve(agentID??session.agent)')
  expect(permission).toContain('merge(agent?.permissions??missingAgentPermissions,session.permissions??[])')
  expect(permission).toContain('.findLast((rule)=>Wildcard.match(action,rule.action)&&Wildcard.match(resource,rule.resource))')
  const evaluation = permission.slice(permission.indexOf('constevaluateInput='), permission.indexOf('functionrequest('))
  const deny = evaluation.indexOf('if(denied(input,rules))return{effect:"deny"asconst,rules}')
  expect(deny).toBeGreaterThan(-1)
  expect(evaluation.indexOf('hooks.trigger(')).toBeGreaterThan(deny)
  expect(evaluation).toContain('agent:input.agent')
  const assertion = permission.slice(permission.indexOf('constassert='), permission.indexOf('constreply='))
  const blocked = assertion.indexOf('if(result.effect==="deny")')
  const ask = assertion.indexOf('create(request(input,result.message),input.agent)')
  expect(blocked).toBeGreaterThan(-1)
  expect(assertion.indexOf('newBlockedError(')).toBeGreaterThan(blocked)
  expect(ask).toBeGreaterThan(assertion.indexOf('newBlockedError('))
})
