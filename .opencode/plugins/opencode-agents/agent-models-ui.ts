import type { Context } from "@opencode/plugin/tui/context"
import { formatSelection } from "../../../src/agent-models.ts"
import { agentModelsRpc } from "../../../src/agent-models-rpc.ts"
import { selectAgentRole } from "./AgentModelsView.tsx"

export function registerAgentModels(context: Context) {
  let disposed = false
  let active: { location: NonNullable<Context["location"]>; dialogOpen: boolean } | undefined
  const show = async () => {
    if (disposed || active) return
    const invocation = { location: { ...(context.location ?? context.data.location.default()) }, dialogOpen: false }
    active = invocation
    const current = () => {
      const location = context.location ?? context.data.location.default()
      return (
        !disposed &&
        active === invocation &&
        location.directory === invocation.location.directory &&
        location.workspaceID === invocation.location.workspaceID
      )
    }
    const ownDialog = async <A>(open: () => Promise<A>) => {
      invocation.dialogOpen = true
      try {
        return await open()
      } finally {
        invocation.dialogOpen = false
      }
    }
    const select: Context["ui"]["dialog"]["select"] = (options) => ownDialog(() => context.ui.dialog.select(options))
    const options = { location: invocation.location }
    try {
      const rpc = context.client.rpc(agentModelsRpc)
      while (current()) {
        const rows = await rpc.list(undefined, options)
        if (!current()) return
        const role = await ownDialog(() => selectAgentRole(context, rows))
        if (!current() || role === undefined) return
        const row = rows.find((row) => row.role === role)!
        const action = await select({
          title: row.label,
          options: [
            { title: "Choose model", value: "choose" as const, disabled: !row.loaded },
            {
              title: "Reset to native behavior",
              value: "reset" as const,
              description: row.nativeModel ? formatSelection(row.nativeModel) : "Parent session / OpenCode default",
            },
          ],
        })
        if (!current() || action === undefined) return
        if (action === "reset") {
          await rpc.reset({ role }, options)
          continue
        }
        await Promise.all([
          context.data.location.model.sync(invocation.location),
          context.data.location.provider.sync(invocation.location),
        ])
        if (!current()) return
        const models = context.data.location.model.list(invocation.location) ?? []
        if (!models.length) throw new Error("No models are available for this location")
        const providers = context.data.location.provider.list(invocation.location) ?? []
        const selected = await select({
          title: `${row.label} · model`,
          current:
            row.preference.kind === "override"
              ? { providerID: row.preference.model.providerID, id: row.preference.model.id }
              : undefined,
          options: models.map((model) => ({
            title: model.name,
            value: { providerID: model.providerID, id: model.id },
            category: providers.find((provider) => provider.id === model.providerID)?.name ?? model.providerID,
            description: `${model.providerID}/${model.id}`,
          })),
        })
        if (!current() || selected === undefined) return
        const model = models.find((model) => model.providerID === selected.providerID && model.id === selected.id)!
        // Temporary, nonpersistent diagnostic for the reported live selection.
        const diagnose = role === "planner" && selected.providerID === "openai" && selected.id === "gpt-6.1-sol"
        let pickerResult: unknown = "picker not opened"
        const diagnostic = (details: Record<string, unknown>) => {
          if (!diagnose || !current()) return
          context.ui.toast.show({
            title: "Agent models diagnostic",
            message: [
              `Selector: ${typeof pickerResult} ${JSON.stringify(pickerResult) ?? "undefined"}`,
              `Offered: ${JSON.stringify(model.variants.length ? ["default", ...model.variants.filter((variant) => variant.id !== "default").map((variant) => variant.id)] : [])}`,
              ...Object.entries(details).map(([key, value]) => `${key}: ${JSON.stringify(value)}`),
            ].join("\n"),
            duration: 60000,
          })
        }
        let variant: string | undefined
        if (model.variants.length) {
          // Match the native variant picker: return the ID itself, and never
          // interpret a failed object-property projection as Model default.
          const choice = await select({
            title: `${row.label} · variant`,
            current:
              row.preference.kind === "override" &&
              row.preference.model.providerID === selected.providerID &&
              row.preference.model.id === selected.id
                ? (row.preference.model.variant ?? "default")
                : "default",
            options: [
              { title: "Model default", value: "default" },
              ...model.variants
                .filter((variant) => variant.id !== "default")
                .map((variant) => ({ title: variant.id, value: variant.id })),
            ],
          })
          pickerResult = choice
          if (!current() || choice === undefined) {
            diagnostic({ Outcome: "cancelled before RPC set" })
            return
          }
          if (choice !== "default" && !model.variants.some((variant) => variant.id === choice)) {
            diagnostic({ Outcome: "unknown variant; no RPC set" })
            throw new Error("Variant picker returned an unknown variant")
          }
          variant = choice === "default" ? undefined : choice
        }
        const request = { role, model: { ...selected, ...(variant === undefined ? {} : { variant }) } }
        await rpc.set(request, options)
        if (diagnose && current()) {
          const saved = (await rpc.list(undefined, options)).find((row) => row.role === role)
          diagnostic({ "RPC set": request, "RPC read": saved?.preference })
        }
      }
    } catch (error) {
      if (current()) {
        const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error)
        context.ui.toast.show({ title: "Agent models", message, variant: "error" })
      }
    } finally {
      if (active === invocation) active = undefined
    }
  }
  const remove = context.ui.slot({
    append: "app",
    render: () => {
      context.keymap.layer(() => ({
        mode: "global",
        commands: [
          {
            id: "opencode-agents.agent-models",
            title: "Edit agent models",
            group: "OpenCode Agents",
            palette: true,
            slash: { name: "agent-models" },
            run: show,
          },
        ],
      }))
      return null
    },
  })
  return () => {
    disposed = true
    if (active?.dialogOpen) context.ui.dialog.clear()
    active = undefined
    remove()
  }
}
