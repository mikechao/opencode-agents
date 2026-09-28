import type { Definition } from "@opencode/plugin/tui/plugin"
import { runM1, type Generation } from "../../../src/m1/attempt.ts"
import { observeGit } from "../../../src/m1/git.ts"
import { runM2 } from "../../../src/m2/attempt.ts"

const plugin: Definition = {
  id: "opencode-agents",
  setup(context) {
    const generation: Generation = { revoked: false, busy: false }
    const location = context.location ?? context.data.location.default()
    const directory = location.directory
    let baseline: ReturnType<typeof observeGit> | undefined
    try {
      if (directory) {
        const observed = observeGit(directory)
        if (observed.paths.length === 0) baseline = observed
      }
    } catch { /* A fresh clean activation is required for M2. */ }
    let freshParent: string | undefined
    let attempted = false
    const removeCreated = context.data.on("session.created", (event) => {
      if (generation.revoked || !baseline || attempted || freshParent || event.data.parentID ||
          event.data.agent !== "opencode-agents" || event.data.location.directory !== location.directory) return
      freshParent = event.data.sessionID
    })
    const removeCompleted = context.data.on("session.execution.succeeded", (event) => {
      if (generation.revoked || attempted || !baseline || event.data.sessionID !== freshParent) return
      attempted = true
      void runM2(context, generation, baseline, freshParent, location).then(
        async (report) => {
          if (!generation.revoked) await context.ui.dialog.alert({ title: "M2 gate complete", message: report })
        },
        async (error) => {
          if (!generation.revoked) await context.ui.dialog.alert({
            title: "M2 STOP", message: error instanceof Error ? error.message : String(error),
          })
        },
      )
    })
    const stopParent = (sessionID: string) => {
      if (generation.revoked || attempted || sessionID !== freshParent) return
      attempted = true
      void context.ui.dialog.alert({ title: "M2 STOP", message: "The fresh Orchestrator turn did not complete successfully." })
    }
    const removeFailed = context.data.on("session.execution.failed", (event) => stopParent(event.data.sessionID))
    const removeInterrupted = context.data.on("session.execution.interrupted", (event) => stopParent(event.data.sessionID))
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
      removeCreated()
      removeCompleted()
      removeFailed()
      removeInterrupted()
      removeSlot()
    }
  },
}

export default plugin
