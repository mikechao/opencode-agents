import type { Context } from "@opencode/plugin/tui/context"
import { formatSelection, type RolePreference } from "../../../src/agent-models.ts"
import { agentModelsRpc } from "../../../src/agent-models-rpc.ts"

function summary(row: RolePreference) {
  const preference = row.preference
  const override =
    preference.kind === "override"
      ? formatSelection(preference.model)
      : preference.kind === "invalid"
        ? "Invalid saved preference"
        : "None"
  const status =
    preference.kind === "override"
      ? preference.available
        ? "Available"
        : "Unavailable"
      : preference.kind === "invalid"
        ? preference.message
        : "Native behavior"
  return {
    description: `Override: ${override}`,
    footer: `${status}${row.loaded ? "" : " · Agent not loaded"}`,
  }
}

export function registerAgentModels(context: Context) {
  let disposed = false
  let active: { location: NonNullable<Context["location"]> } | undefined
  const show = async () => {
    if (disposed || active) return
    const invocation = { location: { ...(context.location ?? context.data.location.default()) } }
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
    const options = { location: invocation.location }
    try {
      const rpc = context.client.rpc(agentModelsRpc)
      while (current()) {
        const rows = await rpc.list(undefined, options)
        if (!current()) return
        const role = await context.ui.dialog.select({
          title: "Agent models · future fresh subagents",
          options: rows.map((row) => ({ title: row.label, value: row.role, ...summary(row) })),
        })
        if (!current() || role === undefined) return
        const row = rows.find((row) => row.role === role)!
        const action = await context.ui.dialog.select({
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
        const selected = await context.ui.dialog.select({
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
        let variant: string | undefined
        if (model.variants.length) {
          const choice = await context.ui.dialog.select<{ variant: string | undefined }>({
            title: `${row.label} · variant`,
            current: {
              variant:
                row.preference.kind === "override" &&
                row.preference.model.providerID === selected.providerID &&
                row.preference.model.id === selected.id
                  ? row.preference.model.variant
                  : undefined,
            },
            options: [
              { title: "Model default", value: { variant: undefined } },
              ...model.variants
                .filter((variant) => variant.id !== "default")
                .map((variant) => ({ title: variant.id, value: { variant: variant.id } })),
            ],
          })
          if (!current() || choice === undefined) return
          variant = choice.variant
        }
        await rpc.set({ role, model: { ...selected, ...(variant === undefined ? {} : { variant }) } }, options)
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
    if (active) context.ui.dialog.clear()
    active = undefined
    remove()
  }
}
