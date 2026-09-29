import type { Definition } from "@opencode/plugin/tui/plugin"
import type { Generation } from "../../../src/cap.ts"
import { runM1 } from "../../../src/m1/attempt.ts"
import { observeGit } from "../../../src/git.ts"
import { publishM2PlanDogfood } from "../../../src/m2/attempt.ts"
import type { IntentCandidate } from "../../../src/proposal.ts"

const plugin: Definition = {
  id: "opencode-agents",
  setup(context) {
    const generation: Generation = { revoked: false, busy: false }
    const location = context.location ?? context.data.location.default()
    const directory = location.directory
    let baseline: ReturnType<typeof observeGit> | undefined
    try {
      if (directory) baseline = observeGit(directory)
    } catch { /* A valid Git baseline is required for the plan dogfood. */ }
    let freshParent: string | undefined
    let attempted = false
    let boundCandidate: IntentCandidate | undefined
    let publishedPlanHash: string | undefined
    const removeCreated = context.data.on("session.created", (event) => {
      if (generation.revoked || !baseline || attempted || freshParent || event.data.parentID ||
          event.data.agent !== "opencode-agents" || event.data.location.directory !== location.directory) return
      freshParent = event.data.sessionID
    })
    const removeCompleted = context.data.on("session.execution.succeeded", (event) => {
      if (generation.revoked || attempted || !baseline || event.data.sessionID !== freshParent) return
      attempted = true
      void publishM2PlanDogfood(context, generation, baseline, freshParent, location).then(
        ({ candidate, planHash, syntheticID }) => {
          if (generation.revoked) return
          boundCandidate = candidate
          publishedPlanHash = planHash
          context.ui.toast.show({ title: "M2 plan dogfood", message: `Synthetic plan ${planHash} published (${syntheticID}); CAP candidate ${boundCandidate.digest.slice(0, 12)} retained; root should remain idle.`, sessionID: freshParent })
        },
        async (error) => {
          if (!generation.revoked) await context.ui.dialog.alert({
            title: "M2 STOP", message: error instanceof Error ? error.message : String(error),
          })
        },
      )
    })
    const removeStarted = context.data.on("session.execution.started", (event) => {
      if (generation.revoked || !publishedPlanHash || event.data.sessionID !== freshParent) return
      context.ui.toast.show({ title: "M2 plan dogfood: root woke", message: `Root execution started after synthetic plan ${publishedPlanHash}. Check whether a human prompted it.`, variant: "warning", sessionID: freshParent })
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
      boundCandidate = undefined
      removeCreated()
      removeCompleted()
      removeStarted()
      removeFailed()
      removeInterrupted()
      removeSlot()
    }
  },
}

export default plugin
