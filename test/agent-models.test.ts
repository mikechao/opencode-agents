import { expect, mock, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { StandardSchemaV1 } from "@standard-schema/spec"
import type { Context } from "@opencode/plugin/effect/plugin"
import type { Context as TuiContext } from "@opencode/plugin/tui/context"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Agent } from "@opencode/schema/agent"
import { Tool } from "@opencode/schema/tool"
import { Effect, Schema } from "effect"
import { createRoot, createEffect, createMemo, createComponent, createSignal } from "solid-js"
import {
  agentModels,
  managedRoles,
  requireRole,
  parseSelection,
  formatSelection,
  preferenceKey,
  selectionAvailable,
  type RolePreference,
} from "../src/agent-models.ts"
import { agentModelsHandlers, agentModelsRpc } from "../src/agent-models-rpc.ts"
import { authorizeRpc } from "../src/authorize-rpc.ts"
import { registerAgentModels } from "../.opencode/plugins/opencode-agents/agent-models-ui.ts"
import { displayRows, columnWidths } from "../.opencode/plugins/opencode-agents/AgentModelsView.tsx"

// Test-scoped JSX capture, matching the existing attempt UI tests. Render the
// actual view and capture cells/handlers without a terminal or OpenCode process.
const modelElements: any[] = []
const [dimensions, resize] = createSignal({ width: 120, height: 40 })
mock.module("@opentui/solid", () => ({
  createElement: (type: string) => {
    const node = {
      type,
      children: [] as any[],
      y: 0,
      height: 20,
      getChildren() {
        return this.children
      },
      scrollBy() {},
    }
    modelElements.push(node)
    return node
  },
  createTextNode: (value: unknown) => ({ type: "literal", value }),
  setProp: (node: any, key: string, value: unknown) => {
    node[key] = value
  },
  use: (fn: (node: any) => void, node: any) => fn(node),
  insertNode: (parent: any, child: any) => {
    parent.children.push(child)
  },
  insert: (parent: any, value: any) => {
    let previous: any[] = []
    createEffect(() => {
      const child = typeof value === "function" ? value() : value
      const next = [child].flat(Infinity).filter((item) => item !== null && item !== undefined && item !== false)
      parent.children = parent.children.filter((item: any) => !previous.includes(item))
      parent.children.push(...next)
      previous = next
    })
  },
  effect: createEffect,
  memo: createMemo,
  createComponent,
  useTerminalDimensions: () => dimensions,
}))
const nodeText = (node: any): string =>
  typeof node === "string"
    ? node
    : node?.type === "literal"
      ? String(node.value)
      : (node?.children ?? []).map(nodeText).join("")
const wire = <A>(value: A): A => (value === undefined ? value : JSON.parse(JSON.stringify(value)))

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
    ["reviewer", "Reviewer"],
  ])
  for (const role of managedRoles) expect(requireRole(role.id)).toBe(role.id)
  for (const value of ["committer", "build", undefined, {}, "__proto__"]) expect(() => requireRole(value)).toThrow()
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
    expect(row.preference).toEqual({
      kind: "override",
      model: chosen,
      availability: change === "model" ? "model-unavailable" : "variant-unavailable",
    })
    expect(displayRows([row])[0]).toMatchObject({
      model: "test/chosen",
      variant: "high",
      status: change === "model" ? "Model unavailable" : "Variant unavailable",
    })
    expect(await hostParse(agentModelsRpc.methods.list.output, wire([row]))).toEqual([row])
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
  expect(f.state.agents).toHaveLength(3)
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

// Match pinned core/rpc.ts: Effect schemas take priority over Standard Schema.
// Passing an independent runtime reproduces the compiled host/plugin boundary.
async function hostParse(
  schema: Schema.Codec<unknown, any> | StandardSchemaV1<any, any>,
  value: unknown,
  host = Schema,
  encode = false,
): Promise<any> {
  if (host.isSchema(schema))
    return encode ? host.encodeUnknownSync(schema)(value) : host.decodeUnknownSync(schema)(value)
  const result = await schema["~standard"].validate(value)
  if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("\n"))
  return result.value
}

test("settings RPC contracts validate on both sides and expose no authorization method", async () => {
  const f = fixture(),
    handlers = agentModelsHandlers(f.settings)
  const rpc = { error: (type: string, message: string) => ({ type, message }) } as any
  expect(agentModelsRpc.id).not.toBe(authorizeRpc.id)
  expect(Object.keys(agentModelsRpc.methods)).toEqual(["list", "set", "reset"])
  expect(Object.keys(authorizeRpc.methods)).toEqual(["authorize"])
  for (const method of Object.values(agentModelsRpc.methods)) {
    for (const schema of [method.input, method.output, ...Object.values(method.errors)]) {
      expect(Reflect.ownKeys(schema)).toEqual(["~standard"])
      expect(Schema.isSchema(schema)).toBe(false)
    }
  }
  const request = { role: "planner", model: chosen }
  const decoded = await hostParse(agentModelsRpc.methods.set.input, request)
  await Effect.runPromise(handlers.set(decoded, rpc))
  const rows = await Effect.runPromise(handlers.list(undefined, rpc))
  expect(await hostParse(agentModelsRpc.methods.list.output, wire(rows))).toEqual(rows)
  expect(rows[0].preference).toEqual({ kind: "override", model: chosen, availability: "available" })
  for (const request of [
    { role: "committer", model: chosen },
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

function uiFixture(host = Schema) {
  const f = fixture()
  const dialogs: any[] = [],
    replies: any[] = [],
    toasts: any[] = [],
    methods: any[] = []
  let command: any,
    removed = false,
    clears = 0,
    listed: ReturnType<typeof displayRows> = []
  let closeDialog: (() => void) | undefined
  const presentations: any[] = [],
    layers: any[] = []
  const handlers = agentModelsHandlers(f.settings)
  const rpcContext = { error: (type: string, message: string) => ({ type, message }) } as any
  const callRpc = async <Name extends "list" | "set" | "reset">(name: Name, input: any) => {
    const method = agentModelsRpc.methods[name]
    const decoded = await hostParse(method.input, wire(input), host)
    const output = await Effect.runPromise((handlers[name] as any)(decoded, rpcContext))
    return wire(await hostParse(method.output, output, host, true))
  }
  const close = () => {
    const previous = closeDialog
    closeDialog = undefined
    previous?.()
  }
  const context = {
    location: f.location,
    keymap: {
      layer: (read: any) => {
        const layer = read()
        if (layer.mode === "global") command = layer.commands[0]
        else layers.push(read)
      },
    },
    theme: { surface: () => ({ text: { base: "white", muted: "gray" }, background: { raised: { high: "blue" } } }) },
    ui: {
      slot: (claim: any) => {
        expect(claim.append).toBe("app")
        claim.render()
        return () => {
          removed = true
        }
      },
      dialog: {
        show: (render: () => unknown, onClose: () => void) => {
          close()
          const start = modelElements.length
          const record = { rows: listed, nodes: [] as any[], closed: false }
          dialogs.push(record)
          let dispose!: () => void
          createRoot((cleanup) => {
            dispose = cleanup
            render()
          })
          record.nodes = modelElements.slice(start)
          closeDialog = () => {
            record.closed = true
            onClose()
            dispose()
          }
          const reply = replies.shift()
          void Promise.resolve(typeof reply === "function" ? reply(record) : reply).then((role) => {
            if (record.closed) return
            if (role === undefined) close()
            else record.nodes.find((node) => node.id === `agent-models-row-${role}`).onMouseUp()
          })
        },
        set: (options: any) => {
          presentations.push(options)
        },
        select: async (options: any) => {
          close()
          dialogs.push(options)
          const reply = replies.shift()
          return typeof reply === "function" ? await reply(options) : reply
        },
        clear: () => {
          clears++
          close()
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
            const rows = await callRpc("list", undefined)
            listed = displayRows(rows)
            return rows
          },
          set: async (input: any, options: any) => {
            methods.push(["set", options, wire(input)])
            return callRpc("set", input)
          },
          reset: async (input: any, options: any) => {
            methods.push(["reset", options])
            return callRpc("reset", input)
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
    presentations,
    layers,
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
  f.replies.push(
    "planner",
    "choose",
    (picker: any) => picker.options.find((option: any) => option.value.id === "chosen").value,
    (picker: any) => {
      let selected = picker.options.findIndex((option: any) => option.value === picker.current)
      // This double supplies the public API value; it does not run the host keymap.
      while (picker.options[selected].title !== "high") selected = (selected + 1) % picker.options.length
      expect(picker.options[selected].value).toBe("high")
      return picker.options[selected].value
    },
    undefined,
  )
  await f.command.run()
  expect(f.dialogs[4].rows[0]).toMatchObject({ model: "test/chosen", variant: "high", status: "" })
  expect(nodeText(f.dialogs[4].nodes.find((node: any) => node.id === "agent-models-row-planner"))).toBe(
    "Plannertest/chosenhigh",
  )
  expect(f.dialogs[4].rows[1]).toMatchObject({ model: "Native behavior", variant: "—", status: "" })
  expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual(chosen)
  expect(f.methods.find(([method]) => method === "set")[2].model).toEqual(chosen)
  await f.dispatch(f.call("planner"))
  expect(f.state.calls[0].input.model).toBe("test/chosen#high")
  expect(f.presentations.every((options) => options.size === "large" && options.centered)).toBe(true)
  f.replies.push("planner", "reset", undefined)
  await f.command.run()
  expect(f.dialogs[5].rows[0]).toMatchObject({ model: "test/chosen", variant: "high", status: "" })
  expect(f.store.size).toBe(0)
  expect(f.methods.every(([, options]) => options.location.directory === "/checkout")).toBe(true)
  expect(f.toasts).toEqual([])
  f.dispose()
  expect(f.removed()).toBe(true)
})

test("host and plugin with independent Effect runtimes preserve high through selection, RPC, storage, reopening and execution", async () => {
  // Bundle only the installed, pinned Schema module into a temporary test artifact.
  // This creates the host's distinct parser/sentinels without starting OpenCode.
  const directory = await mkdtemp(join(tmpdir(), "agent-models-rpc-"))
  try {
    const build = await Bun.build({
      entrypoints: [fileURLToPath(import.meta.resolve("effect/Schema"))],
      outdir: directory,
      target: "bun",
      format: "esm",
    })
    expect(build.success).toBe(true)
    const host: typeof Schema = await import(build.outputs[0].path)
    expect(host.decodeUnknownSync).not.toBe(Schema.decodeUnknownSync)
    const f = uiFixture(host)
    try {
      f.replies.push(
        "planner",
        "choose",
        (picker: any) => picker.options.find((option: any) => option.value.id === "chosen").value,
        // Pinned public dialog.select resolves option.value, not the whole option.
        (picker: any) => picker.options.find((option: any) => option.title === "high").value,
        undefined,
      )
      await f.command.run()
      expect(f.methods.find(([method]) => method === "set")[2].model).toEqual(chosen)
      expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual(chosen)
      f.replies.push(undefined)
      await f.command.run()
      expect(f.dialogs.at(-1).rows[0]).toMatchObject({ model: "test/chosen", variant: "high", status: "" })
      expect(nodeText(f.dialogs.at(-1).nodes.find((node: any) => node.id === "agent-models-row-planner"))).toBe(
        "Plannertest/chosenhigh",
      )
      await f.dispatch(f.call("planner"))
      expect(f.state.calls[0].input.model).toBe("test/chosen#high")
      expect(f.state.children[0].model).toEqual(chosen)
      expect(f.toasts).toEqual([])
      for (const method of Object.values(agentModelsRpc.methods)) {
        expect(host.isSchema(method.input)).toBe(false)
        expect(host.isSchema(method.output)).toBe(false)
      }
    } finally {
      f.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("healthy explicit/default overrides and native behavior render only Agent, Model, Variant", async () => {
  const f = uiFixture()
  try {
    await Effect.runPromise(f.settings.set("planner", chosen))
    await Effect.runPromise(f.settings.set("explorer", native))
    await f.command.run()
    expect(f.dialogs[0].rows).toMatchObject([
      { agent: "Planner", model: "test/chosen", variant: "high", status: "" },
      { agent: "Explorer", model: "test/native", variant: "default", status: "" },
      { agent: "Implementer", model: "Native behavior", variant: "—", status: "" },
      { agent: "Reviewer", model: "Native behavior", variant: "—", status: "" },
    ])
    const scroll = f.dialogs[0].nodes.find((node: any) => node.type === "scrollbox")
    const dialog = f.dialogs[0].nodes.find((node: any) => node.children.includes(scroll))
    const text = dialog.children.filter((node: any) => node.type === "text")
    expect(text.map(nodeText)).toEqual([
      "Agent models",
      "Model preferences for new subagents",
      "↑/↓ select · enter or click to edit · esc close",
    ])
    for (const node of text.slice(1)) expect(node).toMatchObject({ fg: "gray", wrapMode: "word" })
    expect(nodeText(scroll.children[0])).toBe("AgentModelVariant")
    expect(nodeText(scroll)).not.toContain("Available")
    for (const row of scroll.children.slice(1)) {
      expect(row.children[2].children).toHaveLength(1)
      expect(row.paddingBottom).toBe(1)
      expect(row.paddingY).toBeUndefined()
    }
  } finally {
    f.dispose()
  }
})

test("exceptional rows show precise independent reasons and leave healthy Status cells blank", async () => {
  const cases = [
    { saved: undefined, model: "Native behavior", variant: "—", status: "" },
    { saved: chosen, model: "test/chosen", variant: "high", status: "" },
    { saved: { ...chosen, id: "removed" }, model: "test/removed", variant: "high", status: "Model unavailable" },
    {
      saved: { ...chosen, variant: "removed" },
      model: "test/chosen",
      variant: "removed",
      status: "Variant unavailable",
    },
    {
      saved: { ...chosen, variant: " " },
      model: "Invalid saved preference",
      variant: "—",
      status: "Invalid saved preference: Malformed model preference",
    },
  ]
  for (const loaded of [true, false]) {
    for (const input of cases) {
      const f = uiFixture()
      try {
        const key = preferenceKey(f.location, "explorer")
        if (input.saved) f.store.set(key, input.saved)
        if (!loaded) f.state.agents = f.state.agents.filter((agent) => agent.id !== "explorer")
        const status = [input.status, loaded ? "" : "Agent not loaded"].filter(Boolean).join(" · ")
        f.replies.push(undefined)
        await f.command.run()
        const record = f.dialogs[0]
        expect(record.rows[1]).toMatchObject({ model: input.model, variant: input.variant, status })
        const scroll = record.nodes.find((node: any) => node.type === "scrollbox")
        expect(nodeText(scroll.children[0])).toBe(status ? "AgentModelVariantStatus" : "AgentModelVariant")
        expect(nodeText(scroll.children[2])).toBe(`Explorer${input.model}${input.variant}${status}`)
        for (const index of [0, 2]) {
          expect(record.rows[index].status).toBe("")
          const cells = scroll.children[index + 1].children[2].children
          expect(cells).toHaveLength(status ? 2 : 1)
          if (status) expect(nodeText(cells[1])).toBe("")
        }
        expect(f.store.get(key)).toEqual(input.saved)
        const rows = await Effect.runPromise(f.settings.list())
        expect(await hostParse(agentModelsRpc.methods.list.output, wire(rows))).toEqual(rows)
      } finally {
        f.dispose()
      }
    }
  }
})

test("exceptional saved preferences remain editable and can be explicitly replaced or reset", async () => {
  for (const saved of [{ ...chosen, id: "removed" }, { ...chosen, variant: "removed" }, { invalid: true }]) {
    for (const action of ["choose", "reset"]) {
      const f = uiFixture()
      try {
        const key = preferenceKey(f.location, "planner")
        f.store.set(key, saved)
        f.replies.push("planner", action)
        if (action === "choose") {
          f.replies.push(
            (picker: any) => picker.options.find((option: any) => option.value.id === "chosen").value,
            (picker: any) => picker.options.find((option: any) => option.title === "high").value,
          )
        }
        f.replies.push(undefined)
        await f.command.run()
        expect(f.dialogs[0].rows[0].status).not.toBe("")
        expect(f.store.get(key)).toEqual(action === "choose" ? chosen : undefined)
        expect(f.dialogs.at(-1).rows[0]).toMatchObject({
          model: action === "choose" ? "test/chosen" : "Native behavior",
          variant: action === "choose" ? "high" : "—",
          status: "",
        })
        expect(f.toasts).toEqual([])
      } finally {
        f.dispose()
      }
    }
  }
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

test("native default variant selection omits only the explicit variant and Reset preserves native behavior", async () => {
  const f = uiFixture()
  try {
    f.replies.push(
      "planner",
      "choose",
      (picker: any) => picker.options.find((option: any) => option.value.id === "chosen").value,
      (picker: any) => {
        expect(picker.current).toBe("default")
        return picker.options.find((option: any) => option.title === "Model default").value
      },
      undefined,
    )
    await f.command.run()
    expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual({ providerID: "test", id: "chosen" })
    expect(f.dialogs[4].rows[0]).toMatchObject({ model: "test/chosen", variant: "default", status: "" })
    await f.dispatch(f.call("planner"))
    expect(f.state.calls[0].input.model).toBe("test/chosen")
    f.replies.push("planner", "reset", undefined)
    await f.command.run()
    expect(f.dialogs.at(-1).rows[0]).toMatchObject({ model: "Native behavior", variant: "—", status: "" })
    expect(f.store.size).toBe(0)
  } finally {
    f.dispose()
  }
})

test("unexpected variant picker results fail visibly instead of being persisted as default", async () => {
  for (const saved of [undefined, chosen]) {
    for (const invalid of ["missing", { variant: "high" }, { title: "high", value: "high" }, 3, null]) {
      const f = uiFixture()
      try {
        if (saved) await Effect.runPromise(f.settings.set("planner", saved))
        f.replies.push("planner", "choose", { providerID: "test", id: "chosen" }, invalid)
        await f.command.run()
        expect(f.dialogs[3].current).toBe(saved ? "high" : "default")
        expect(f.methods.some(([method]) => method === "set")).toBe(false)
        expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual(saved)
        expect(f.toasts[0].message).toContain("unknown variant")
      } finally {
        f.dispose()
      }
    }
  }
})

for (const exceptional of [false, true]) {
  test(`long model IDs wrap without clipping in wide/narrow terminals ${exceptional ? "with" : "without"} Status`, async () => {
    const f = uiFixture()
    const id = `gpt-6.1-sol-${"long-model-identifier".repeat(12)}`
    f.state.models.push(catalogModel(id, ["high"]))
    const saved = parseSelection({ providerID: "test", id, variant: "high" })
    await Effect.runPromise(f.settings.set("planner", saved))
    if (exceptional) {
      f.state.models = f.state.models.filter((model) => model.id !== id)
      f.state.agents = f.state.agents.filter((agent) => agent.id !== "planner")
    }
    const status = exceptional ? "Model unavailable · Agent not loaded" : ""
    let opened!: () => void, finish!: () => void
    const ready = new Promise<void>((resolve) => {
      opened = resolve
    })
    f.replies.push(() => {
      opened()
      return new Promise((resolve) => {
        finish = () => resolve(undefined)
      })
    })
    const pending = f.command.run()
    await ready
    try {
      const record = f.dialogs[0]
      const row = record.nodes.find((node: any) => node.id === "agent-models-row-planner")
      const scroll = record.nodes.find((node: any) => node.type === "scrollbox")
      expect(record.rows[0]).toMatchObject({ model: `test/${id}`, variant: "high", status })
      expect(row.children.map(nodeText)).toEqual(["Planner", `test/${id}`, `high${status}`])
      expect(row.children[1]).toMatchObject({ flexGrow: 1, flexBasis: 0, minWidth: 0 })
      expect(row.children[1].children[0].wrapMode).toBe("char")
      expect(row.children[1].children[0].maxHeight).toBeUndefined()
      expect(row.children[1].children[0].overflow).toBeUndefined()
      expect(row.children[2].flexShrink).toBe(0)
      expect(row.children[2].children).toHaveLength(exceptional ? 2 : 1)
      if (exceptional) {
        expect(row.children[2].children[1].children[0].maxHeight).toBeUndefined()
        expect(row.children[2].children[1].children[0].overflow).toBeUndefined()
      }
      expect(f.presentations[0]).toEqual({ size: "large", centered: true })
      for (const width of [120, 48, 120]) {
        resize({ width, height: width === 48 ? 20 : 40 })
        const widths = columnWidths(width, exceptional)
        expect(widths).toEqual({
          agent: width === 48 ? 8 : 14,
          variant: width === 48 ? 8 : 12,
          status: exceptional ? (width === 48 ? 10 : 20) : 0,
          compact: exceptional && width === 48,
        })
        expect(nodeText(scroll.children[0])).toBe(
          exceptional
            ? widths.compact
              ? "AgentModelVariant / Status"
              : "AgentModelVariantStatus"
            : "AgentModelVariant",
        )
        expect(row.children[2].flexDirection).toBe(widths.compact ? "column" : "row")
        expect(row.children[0].width).toBe(widths.agent)
        expect(row.children[2].width).toBe(widths.variant + (widths.compact ? 0 : widths.status))
        expect(nodeText(row.children[2])).toBe(`high${status}`)
        expect(scroll.maxHeight).toBe(width === 48 ? 10 : 30)
        const tableWidth = Math.min(88, width - 2) - 4
        expect(tableWidth - row.children[0].width - row.children[2].width).toBeGreaterThan(0)
      }
      expect(f.store.get(preferenceKey(f.location, "planner"))).toEqual(saved)
    } finally {
      resize({ width: 120, height: 40 })
      finish()
      await pending
      f.dispose()
    }
  })
}

test("table arrow navigation and Enter open the selected role's editable controls", async () => {
  const f = uiFixture()
  try {
    f.replies.push(
      () => {
        const commands = f.layers.at(-1)().commands
        commands.find((command: any) => command.id === "dialog.select.next").run()
        commands.find((command: any) => command.id === "dialog.select.submit").run()
      },
      "reset",
      undefined,
    )
    await f.command.run()
    expect(f.dialogs[1].title).toBe("Explorer")
    expect(f.methods.find(([method]) => method === "reset")).toBeDefined()
    expect(f.dialogs[0].closed).toBe(true)
    expect(f.store.size).toBe(0)
    expect(f.toasts).toEqual([])
  } finally {
    f.dispose()
  }
})

test("cleanup while settings are loading does not close an unrelated dialog", async () => {
  const f = uiFixture()
  let resume!: (rows: readonly RolePreference[]) => void
  const pendingList = new Promise<readonly RolePreference[]>((resolve) => {
    resume = resolve
  })
  ;(f.context.client as any).rpc = () => ({ list: () => pendingList })
  const pending = f.command.run()
  f.dispose()
  resume(await Effect.runPromise(f.settings.list()))
  await pending
  expect(f.clears()).toBe(0)
  expect(f.dialogs).toEqual([])
})
