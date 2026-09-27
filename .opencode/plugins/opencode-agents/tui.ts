import type { Definition } from "@opencode/plugin/tui/plugin"
import { runM1, type Generation } from "../../../src/m1/attempt.ts"

const plugin: Definition = {
  id: "opencode-agents.m1",
  setup(context) {
    const generation: Generation = { revoked: false, busy: false }
    const removeSlot = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "opencode-agents.m1.run",
            title: "M1: authorized implementation attempt",
            description: "Plan, confirm, implement, and check exact Git scope once.",
            group: "opencode-agents",
            slash: { name: "m1", arguments: true },
            run: async (input) => {
              try {
                const report = await runM1(context, generation, input ?? "")
                if (!generation.revoked) await context.ui.dialog.alert({ title: "M1 PASS", message: report })
              } catch (error) {
                if (!generation.revoked) await context.ui.dialog.alert({
                  title: "M1 STOP", message: error instanceof Error ? error.message : String(error),
                })
              }
            },
          }],
        }))
        return null
      },
    })
    return () => {
      generation.revoked = true
      removeSlot()
    }
  },
}

export default plugin
