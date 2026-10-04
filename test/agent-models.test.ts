import { expect, test } from "bun:test"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Context as TuiContext } from "@opencode/plugin/tui/context"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Agent } from "@opencode/schema/agent"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import {
  agentModels,
  managedRoles,
  requireRole,
  parseSelection,
  formatSelection,
  preferenceKey,
  selectionAvailable,
} from "../src/agent-models.ts"
import { agentModelsHandlers, agentModelsRpc } from "../src/agent-models-rpc.ts"
import { authorizeRpc } from "../src/authorize-rpc.ts"
import { registerAgentModels } from "../.opencode/plugins/opencode-agents/agent-models-ui.ts"

const chosen = parseSelection({ providerID: "test", id: "chosen", variant: "high" })
const native = parseSelection({ providerID: "test", id: "native" })
const inherited = parseSelection({ providerID: "test", id: "parent", variant: "low" })
const catalogModel = (id: string, variants: string[] = []) => ({
  ...Model.Info.default(Provider.ID.make("test"), Model.ID.make(id)),
  variants: variants.map((id) => ({ id: Model.VariantID.make(id) })),
})

// Small trusted host double. Persistence is shared explicitly between lifecycle
// instances; native creation semantics are pinned separately by source guards.
function fixture(directory = "/checkout", store = new Map<string, any>(), workspaceID?: string) {
  const location = { directory, ...(workspaceID ? { workspaceID } : {}) } as Context["location"]
  const agents: Agent.Info[] = managedRoles.map((role) => ({
    ...Agent.Info.default(Agent.ID.make(role.id)),
    model: native,
  }))
  const state = {
    models: [catalogModel("chosen", ["high", "low"]), catalogModel("native"), catalogModel("parent", ["low"])],
    agents,
    history: [] as any[],
    reads: [] as string[],
    calls: [] as any[],
    children: [] as any[],
  }
  const context = {
    location,
    storage: {
      get: (key: string) =>
        Effect.sync(() => {
          state.reads.push(key)
          return structuredClone(store.get(key))
        }),
      set: (key: string, value: any) =>
        Effect.sync(() => {
          store.set(key, structuredClone(value))
        }),
      remove: (key: string) =>
        Effect.sync(() => {
          store.delete(key)
        }),
    },
    model: { list: () => Effect.sync(() => ({ location, data: state.models })) },
    agent: { list: () => Effect.sync(() => ({ location, data: state.agents })) },
    session: { context: () => Effect.sync(() => structuredClone(state.history)) },
  } as unknown as Context
  const settings = agentModels(context)
  const original: Tool.Info["execute"] = (input: any, invocation) =>
    Effect.gen(function* () {
      state.calls.push({ input, invocation })
      const ref =
        input.model === undefined
          ? (state.agents.find((agent) => agent.id === input.agent)?.model ?? inherited)
          : Model.Ref.parse(input.model)
      if (!selectionAvailable(ref, state.models))
        return yield* new Tool.Error({ message: "Model or variant unavailable" })
      const child = { id: `child-${state.children.length}`, model: ref }
      state.children.push(child)
      return { output: { sessionID: child.id }, metadata: { sessionID: child.id } }
    })
  const executor: Tool.Info["execute"] = (input, invocation) =>
    settings.prepare(input).pipe(Effect.flatMap((effective) => original(effective, invocation)))
  const invocation = {
    sessionID: "parent",
    messageID: "message",
    id: "call",
    agent: "planner",
    progress: () => Effect.void,
  } as unknown as Tool.Context
  const call = (role: string, extras: Record<string, unknown> = {}) => ({
    agent: role,
    description: "Role work",
    prompt: "Focused request",
    ...extras,
  })
  const publish = (input: any) => {
    const part = {
      type: "tool",
      name: "subagent",
      id: "call",
      state: { status: "running", input: structuredClone(input) },
    }
    state.history = [{ type: "assistant", id: "message", content: [part] }]
    return part
  }
  const dispatch = async (input: any) => {
    const part = publish(input)
    // Built-in native empty-key normalization precedes external hooks.
    const normalized = { ...input }
    for (const key of ["model", "sessionID"]) if (normalized[key] === "") delete normalized[key]
    await Effect.runPromise(settings.before({ ...invocation, tool: "subagent", input: normalized }))
    const result = await Effect.runPromise(executor(normalized, invocation))
    part.state.status = "completed"
    return { result, part }
  }
  return { context, location, store, state, settings, executor, original, invocation, call, publish, dispatch }
}

test("managed roster is explicit; native selections round trip without a reasoning field", () => {
  expect(managedRoles.map((role) => [role.id, role.label])).toEqual([
    ["planner", "Planner"],
    ["explorer", "Explorer"],
    ["authorized_implementer", "Implementer"],
  ])
  for (const role of managedRoles) expect(requireRole(role.id)).toBe(role.id)
  for (const value of ["reviewer", "committer", "build", undefined, {}, "__proto__"])
    expect(() => requireRole(value)).toThrow()
  expect(parseSelection(JSON.parse(JSON.stringify(chosen)))).toEqual(chosen)
  expect(Model.Ref.parse(formatSelection(chosen))).toEqual(chosen)
  expect(formatSelection(native)).toBe("test/native")
  for (const value of [
    null,
    {},
    "test/chosen",
    { ...chosen, reasoning: "high" },
    { id: "", providerID: "test" },
    { id: "chosen#other", providerID: "test" },
    { id: "chosen", providerID: "test/other" },
    { ...chosen, variant: "" },
    { ...chosen, variant: " " },
  ])
    expect(() => parseSelection(value)).toThrow()
})

test("per-role location/workspace keys isolate clones, worktrees, and concurrent role writes", async () => {
  const f = fixture(),
    clone = fixture("/clone", f.store),
    workspace = fixture("/checkout", f.store, "workspace")
  await Promise.all([
    Effect.runPromise(f.settings.set("planner", chosen)),
    Effect.runPromise(f.settings.set("explorer", native)),
  ])
  expect(f.store.size).toBe(2)
  expect((await Effect.runPromise(clone.settings.list())).every((row) => row.preference.kind === "native")).toBe(true)
  expect((await Effect.runPromise(workspace.settings.list())).every((row) => row.preference.kind === "native")).toBe(
    true,
  )
  expect(preferenceKey(f.location, "planner")).not.toBe(preferenceKey(clone.location, "planner"))
  expect(preferenceKey(f.location, "planner")).not.toBe(preferenceKey(workspace.location, "planner"))
  await Effect.runPromise(f.settings.reset("planner"))
  expect(f.store.size).toBe(1)
  expect((await Effect.runPromise(f.settings.list()))[1].preference).toMatchObject({ kind: "override", model: native })
})

test("persisted preferences survive new settings instances without opening a dialog", async () => {
  const f = fixture()
  await Effect.runPromise(f.settings.set("planner", chosen))
  const restarted = fixture("/checkout", f.store)
  await restarted.dispatch(restarted.call("planner"))
  expect(restarted.state.children[0].model).toEqual(chosen)
  expect(restarted.state.agents[0].model).toEqual(native)
})

for (const role of managedRoles) {
  test(`${role.label}: trusted override wins, preserves published input, and Reset restores native/inherited resolution`, async () => {
    const f = fixture()
    await Effect.runPromise(f.settings.set(role.id, chosen))
    const input = f.call(role.id)
    const published = await f.dispatch(input)
    expect(published.part.state.input).toEqual(input)
    expect(Object.keys(published.part.state.input)).toEqual(["agent", "description", "prompt"])
    expect(input).toEqual(f.call(role.id))
    expect(f.state.calls[0].input).toEqual({ ...input, model: "test/chosen#high" })
    expect(f.state.calls[0].invocation).toBe(f.invocation)
    const existing = structuredClone(f.state.children[0])
    await Effect.runPromise(f.settings.set(role.id, native))
    await f.dispatch(input)
    expect(f.state.children[1].model).toEqual(native)
    expect(f.state.children[0]).toEqual(existing)
    await Effect.runPromise(f.settings.reset(role.id))
    await f.dispatch(input)
    expect(f.state.calls[2].input).toEqual(input)
    expect(f.state.children[2].model).toEqual(native)
    f.state.agents = f.state.agents.map((agent) => (agent.id === role.id ? { ...agent, model: undefined } : agent))
    await f.dispatch(input)
    expect(f.state.children[3].model).toEqual(inherited)
    expect(f.state.children[0]).toEqual(existing)
  })

  test(`${role.label}: authored overrides/continuations/extra keys reject before preference reads or child creation`, async () => {
    for (const extras of [
      { model: "test/chosen#high" },
      { model: "" },
      { sessionID: "" },
      { sessionID: "existing" },
      { background: false },
      { other: true },
    ]) {
      const f = fixture()
      await Effect.runPromise(f.settings.set(role.id, chosen))
      await expect(f.dispatch(f.call(role.id, extras))).rejects.toThrow()
      expect(f.state.calls).toEqual([])
      expect(f.state.children).toEqual([])
      expect(f.state.reads).toEqual([])
      await expect(Effect.runPromise(f.executor(f.call(role.id, extras), f.invocation))).rejects.toThrow()
    }
  })
}

test("unset preferences and unrelated subagents pass their executor input through unchanged", async () => {
  const f = fixture()
  const input = f.call("explorer")
  await Effect.runPromise(f.executor(input, f.invocation))
  expect(f.state.calls[0].input).toBe(input)
  f.state.reads.length = 0
  const other = f.call("general", { sessionID: "existing", model: "test/native" })
  await Effect.runPromise(f.settings.before({ ...f.invocation, tool: "subagent", input: other }))
  await Effect.runPromise(f.executor(other, f.invocation))
  expect(f.state.calls[1].input).toBe(other)
  expect(f.state.reads).toEqual([])
})

test("catalog loss preserves unavailable preferences and preparation fails visibly without fallback", async () => {
  for (const change of ["model", "variant"] as const) {
    const f = fixture()
    await Effect.runPromise(f.settings.set("planner", chosen))
    if (change === "model") f.state.models = f.state.models.filter((model) => model.id !== "chosen")
    else f.state.models[0].variants = []
    const row = (await Effect.runPromise(f.settings.list()))[0]
    expect(row.preference).toEqual({ kind: "override", model: chosen, available: false })
    await expect(f.dispatch(f.call("planner"))).rejects.toThrow("unavailable")
    expect(f.state.calls).toEqual([])
    expect(f.state.children).toEqual([])
    expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual(chosen)
  }
})

test("malformed saved preferences remain visible and block execution until explicit Reset", async () => {
  const f = fixture()
  f.store.set(preferenceKey(f.location, "planner"), { id: "bad" })
  expect((await Effect.runPromise(f.settings.list()))[0].preference.kind).toBe("invalid")
  await expect(f.dispatch(f.call("planner"))).rejects.toThrow()
  expect(f.store.size).toBe(1)
  expect(f.state.calls).toEqual([])
  await Effect.runPromise(f.settings.reset("planner"))
  await f.dispatch(f.call("planner"))
  expect(f.state.children[0].model).toEqual(native)
})

test("missing roles are never manufactured and cannot acquire a new saved override", async () => {
  const f = fixture()
  f.state.agents = f.state.agents.filter((agent) => agent.id !== "explorer")
  await expect(Effect.runPromise(f.settings.set("explorer", chosen))).rejects.toThrow("not loaded")
  expect((await Effect.runPromise(f.settings.list()))[1]).toMatchObject({
    loaded: false,
    preference: { kind: "native" },
  })
  expect(f.state.agents).toHaveLength(2)
  expect(f.store.size).toBe(0)
})

test("published-call verification rejects empty-key normalization, schema key loss, and identity drift", async () => {
  const f = fixture(),
    input = f.call("explorer")
  for (const raw of [
    { ...input, model: "" },
    { ...input, sessionID: "" },
    { ...input, unknown: true },
    { ...input, prompt: "other" },
  ]) {
    f.publish(raw)
    await expect(Effect.runPromise(f.settings.before({ ...f.invocation, tool: "subagent", input }))).rejects.toThrow()
  }
  f.publish(input)
  f.state.history.push(structuredClone(f.state.history[0]))
  await expect(Effect.runPromise(f.settings.before({ ...f.invocation, tool: "subagent", input }))).rejects.toThrow(
    "ambiguous",
  )
  expect(f.state.calls).toEqual([])
})

test("settings RPC contracts validate on both sides and expose no authorization method", async () => {
  const f = fixture(),
    handlers = agentModelsHandlers(f.settings)
  const rpc = { error: (type: string, message: string) => ({ type, message }) } as any
  expect(agentModelsRpc.id).not.toBe(authorizeRpc.id)
  expect(Object.keys(agentModelsRpc.methods)).toEqual(["list", "set", "reset"])
  expect(Object.keys(authorizeRpc.methods)).toEqual(["authorize"])
  const request = { role: "planner", model: chosen }
  const decoded = Schema.decodeUnknownSync(agentModelsRpc.methods.set.input)(request)
  await Effect.runPromise(handlers.set(decoded, rpc))
  const rows = await Effect.runPromise(handlers.list(undefined, rpc))
  expect(Schema.decodeUnknownSync(agentModelsRpc.methods.list.output)(JSON.parse(JSON.stringify(rows)))).toEqual(rows)
  expect(rows[0].preference).toMatchObject({ kind: "override", model: chosen })
  for (const request of [
    { role: "reviewer", model: chosen },
    { role: "planner", model: { ...chosen, id: Model.ID.make("missing") } },
    { role: "planner", model: { ...chosen, variant: Model.VariantID.make("missing") } },
  ])
    expect(await Effect.runPromise(handlers.set(request, rpc).pipe(Effect.flip))).toMatchObject({ type: "settings" })
  expect(await Effect.runPromise(handlers.reset({ role: "committer" }, rpc).pipe(Effect.flip))).toMatchObject({
    type: "settings",
  })
  await Effect.runPromise(handlers.reset({ role: "planner" }, rpc))
  expect((await Effect.runPromise(handlers.list(undefined, rpc)))[0].preference).toEqual({ kind: "native" })
})

function uiFixture() {
  const f = fixture()
  const dialogs: any[] = [],
    replies: any[] = [],
    toasts: any[] = [],
    methods: any[] = []
  let command: any,
    removed = false,
    clears = 0
  const context = {
    location: f.location,
    keymap: {
      layer: (read: any) => {
        command = read().commands[0]
      },
    },
    ui: {
      slot: (claim: any) => {
        expect(claim.append).toBe("app")
        claim.render()
        return () => {
          removed = true
        }
      },
      dialog: {
        select: async (options: any) => {
          dialogs.push(options)
          const reply = replies.shift()
          return typeof reply === "function" ? await reply(options) : reply
        },
        clear: () => {
          clears++
        },
      },
      toast: { show: (input: any) => toasts.push(input) },
    },
    data: {
      location: {
        default: () => f.location,
        model: { sync: async () => {}, list: () => f.state.models },
        provider: { sync: async () => {}, list: () => [{ id: "test", name: "Test" }] },
      },
    },
    client: {
      rpc: (definition: any) => {
        expect(definition).toBe(agentModelsRpc)
        return {
          list: async (_input: any, options: any) => {
            methods.push(["list", options])
            return Effect.runPromise(f.settings.list())
          },
          set: async (input: any, options: any) => {
            methods.push(["set", options])
            return Effect.runPromise(f.settings.set(input.role, input.model))
          },
          reset: async (input: any, options: any) => {
            methods.push(["reset", options])
            return Effect.runPromise(f.settings.reset(input.role))
          },
        }
      },
    },
  } as unknown as TuiContext
  const dispose = registerAgentModels(context)
  return {
    ...f,
    dialogs,
    replies,
    toasts,
    methods,
    context,
    dispose,
    command,
    removed: () => removed,
    clears: () => clears,
  }
}

test("slash/palette picker persists a variant, reopens with saved state, and resets only that role", async () => {
  const f = uiFixture()
  expect(f.command).toMatchObject({ palette: true, slash: { name: "agent-models" } })
  f.replies.push("planner", "choose", { providerID: "test", id: "chosen" }, { variant: "high" }, undefined)
  await f.command.run()
  expect(f.dialogs[4].options[0].description).toBe("Override: test/chosen")
  expect(f.dialogs[4].options[0].footer).toBe("high · Available")
  expect(f.dialogs[4].options[1].description).toContain("Override: None")
  f.replies.push("planner", "reset", undefined)
  await f.command.run()
  expect(f.dialogs[5].options[0].description).toBe("Override: test/chosen")
  expect(f.dialogs[5].options[0].footer).toBe("high · Available")
  expect(f.store.size).toBe(0)
  expect(f.methods.every(([, options]) => options.location.directory === "/checkout")).toBe(true)
  expect(f.toasts).toEqual([])
  f.dispose()
  expect(f.removed()).toBe(true)
})

test("role rows show explicit or default override variants and preserve native behavior", async () => {
  const f = uiFixture()
  try {
    await Effect.runPromise(f.settings.set("planner", chosen))
    await Effect.runPromise(f.settings.set("explorer", native))
    await f.command.run()
    expect(f.dialogs[0].options).toMatchObject([
      { title: "Planner", description: "Override: test/chosen", footer: "high · Available" },
      { title: "Explorer", description: "Override: test/native", footer: "default · Available" },
      { title: "Implementer", description: "Override: None", footer: "Native behavior" },
    ])
  } finally {
    f.dispose()
  }
})

test("picker displays unavailable/invalid preferences and permits replacement or reset", async () => {
  const f = uiFixture()
  f.store.set(preferenceKey(f.location, "planner"), { ...chosen, id: "removed" })
  f.store.set(preferenceKey(f.location, "explorer"), { invalid: true })
  f.replies.push(undefined)
  await f.command.run()
  expect(f.dialogs[0].options[0].footer).toContain("Unavailable")
  expect(f.dialogs[0].options[1].description).toContain("Invalid saved preference")
  f.dispose()
})

test("picker teardown/location departure suppresses stale writes and duplicate invocations", async () => {
  for (const cleanup of ["dispose", "location"] as const) {
    const f = uiFixture()
    let resume!: (role: string) => void, started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    f.replies.push(() => {
      started()
      return new Promise((resolve) => {
        resume = resolve
      })
    })
    const pending = f.command.run()
    await ready
    await f.command.run()
    expect(f.dialogs).toHaveLength(1)
    if (cleanup === "dispose") f.dispose()
    else (f.context as any).location = { directory: "/other" }
    resume("planner")
    await pending
    expect(f.methods.map(([method]) => method)).toEqual(["list"])
    expect(f.store.size).toBe(0)
    if (cleanup === "dispose") expect(f.clears()).toBe(1)
    else f.dispose()
  }
})
