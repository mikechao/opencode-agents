import type { Definition } from "@opencode/plugin/tui/plugin"
import type { OpenCodeEvent } from "@opencode/client"
import type { Renderable, MouseEvent } from "@opentui/core"
import { createEffect, createRoot, createSignal, onCleanup, Show } from "solid-js"
import { displayPath } from "../../../src/proposal.ts"
import type { Generation } from "../../../src/cap.ts"
import { observeGit, requireFresh } from "../../../src/git.ts"
import {
  activationEvidence,
  authorizePublishedAttempt,
  exactEvidence,
  initiallyAuthorizable,
  publishedPresentationMatches,
  publishPlan,
  snapshotLocation,
  verifyPublishedAttempt,
  type DecisionOwner,
  type PublishedAttempt,
} from "../../../src/attempt.ts"

const dirtyStatus =
  "Planning only — worktree was dirty when this attempt started. Start a new attempt from a clean worktree to enable implementation."
const authorizationQuestion = "Do you authorize this plan for implementation?"
// Labels use single-column characters; worktree paths use ASCII JSON escapes.
const columns = (text: string) => text.length
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)

type Presentation = { kind: "pending"; published: PublishedAttempt } | { kind: "status"; message: string }

const plugin: Definition = {
  id: "opencode-agents",
  setup(context) {
    const generation: Generation = { revoked: false, busy: false }
    const location = snapshotLocation(context.location ?? context.data.location.default())
    let baseline: ReturnType<typeof observeGit> | undefined
    let observationCompletedAt = NaN
    try {
      if (location.directory) {
        baseline = observeGit(location.directory)
        observationCompletedAt = Date.now()
      }
    } catch {
      /* Publication requires a valid initial observation. */
    }
    type Created = Extract<OpenCodeEvent, { type: "session.created" }>
    type Ownership =
      | { kind: "waiting"; creation?: Created }
      | { kind: "publishing"; creation: Created }
      | { kind: "retained" | "pending" | "deciding" | "transferred"; creation: Created; published: PublishedAttempt }
      | { kind: "closed" }
    let ownership: Ownership = { kind: "waiting" }
    let rootSessionID: string | undefined
    let pendingSurfaceUsable: (() => boolean) | undefined
    let invalidateLayout: (() => void) | undefined
    let removePresentation: (() => void) | undefined
    const [presentation, setPresentation] = createSignal<Presentation>()
    const [layoutRevision, setLayoutRevision] = createSignal(0)
    const closeAuthority = () => {
      if (ownership.kind === "closed") return
      ownership = { kind: "closed" }
      guard.bound = undefined
      guard.publishing = undefined
    }
    const present = (title: string, message: string) => {
      if (generation.revoked) return
      try {
        context.ui.toast.show({
          title,
          message,
          sessionID: rootSessionID,
          variant: title === "STOP" ? "error" : "info",
        })
      } catch {
        /* The persistent composer status remains the trusted outcome. */
      }
    }
    const terminate = (error: unknown) => {
      if (ownership.kind === "closed" || generation.revoked) return
      const reason = error instanceof Error ? error.message : String(error)
      const message =
        ownership.kind === "transferred"
          ? `STOP — Authorized server attempt outcome unknown; no claim or wake will be resent. ${reason}`
          : `STOP — Implementation was not admitted. ${reason}`
      closeAuthority()
      if (rootSessionID) showStatus(message)
      present("STOP", message)
    }
    const rootSelected = () => {
      const route = context.ui.router.current()
      return (
        route.type === "session" &&
        ownership.kind !== "closed" &&
        route.sessionID === ownership.creation?.data.sessionID &&
        same(snapshotLocation(context.location ?? context.data.location.default()), location)
      )
    }
    const guard: DecisionOwner = {
      transfer() {
        guard.assertCurrent()
        if (ownership.kind !== "deciding" && ownership.kind !== "transferred")
          throw new Error("Local decision no longer owns the exact published attempt")
        ownership = { ...ownership, kind: "transferred" }
      },
      assertDecision(captured) {
        if ((ownership.kind !== "deciding" && ownership.kind !== "transferred") || ownership.published !== captured)
          throw new Error("Local decision no longer owns the exact published attempt")
        guard.assertCurrent()
      },
      assertCurrent() {
        if (ownership.kind === "closed" || generation.revoked)
          throw new Error("Attempt ownership was closed or revoked")
        if (ownership.kind === "transferred") return
        if (ownership.kind !== "waiting") {
          // A pending Plan belongs to the attempt, not the mounted route.
          // Only a claimed decision must retain the root view until transfer.
          if (
            (ownership.kind === "deciding" && !rootSelected()) ||
            !same(snapshotLocation(context.location ?? context.data.location.default()), location)
          )
            throw new Error("Root view or TUI location changed")
        }
        if ("published" in ownership && !publishedPresentationMatches(context, ownership.published))
          throw new Error("Published Plan projection changed")
      },
    }
    const binding = (published: PublishedAttempt) =>
      `Plan ${published.candidate.digest.slice(0, 12)} · HEAD ${published.candidate.head.slice(0, 12)}`
    const ensurePresentation = (sessionID: string) => {
      rootSessionID = sessionID
      if (removePresentation) return
      removePresentation = context.ui.slot({
        append: "session.composer.top",
        render: (input) => (
          <Show when={input.sessionID === rootSessionID}>
            <Show when={presentation()} keyed>
              {(state) =>
                state.kind === "pending" ? (
                  <Show when={rootSelected()}>
                    <DecisionStrip published={state.published} />
                  </Show>
                ) : (
                  <text wrapMode="char">{state.message}</text>
                )
              }
            </Show>
          </Show>
        ),
      })
    }
    const showStatus = (message: string) => {
      if (!rootSessionID) return
      ensurePresentation(rootSessionID)
      setPresentation({ kind: "status", message })
    }
    const armRetained = () => {
      if (ownership.kind !== "retained" || generation.revoked || !rootSelected()) return
      const captured = ownership.published
      // Prepare this exact Plan once. Pending ownership survives route changes;
      // navigation never starts another preparation or publication.
      ownership = { ...ownership, kind: "pending" }
      void verifyPublishedAttempt(context, captured, guard)
        .then(() => {
          guard.assertCurrent()
          if (ownership.kind !== "pending" || ownership.published !== captured)
            throw new Error("Root preparation no longer owns the exact published attempt")
          requireFresh(observeGit(location.directory!, captured.activation.baseline), captured.activation.baseline)
          guard.assertCurrent()
          ensurePresentation(captured.bound.parentID)
          setPresentation({ kind: "pending", published: captured })
        })
        .catch(terminate)
    }
    const decide = (captured: PublishedAttempt, decision: "authorize" | "cancel") => {
      if (ownership.kind !== "pending" || generation.revoked || ownership.published !== captured || generation.busy)
        return
      try {
        guard.assertCurrent()
        if (!rootSelected()) {
          invalidateLayout?.()
          return
        }
        // Only a complete current frame can support a pending human decision.
        // Invalid geometry leaves this exact attempt pending for a later frame.
        if (!pendingSurfaceUsable?.()) {
          invalidateLayout?.()
          return
        }
        // Run-to-completion claims the exact object before any asynchronous work.
        ownership = { ...ownership, kind: "deciding" }
        invalidateLayout?.()
        if (decision === "cancel") {
          const message = "Cancelled — no implementation admitted"
          closeAuthority()
          showStatus(message)
          present("Cancelled", message)
          return
        }
        setPresentation({ kind: "status", message: "Authorization claimed — implementation admission in progress…" })
        void authorizePublishedAttempt(context, captured, guard)
          .then((message) => {
            if (generation.revoked) return
            closeAuthority()
            showStatus(message)
            present(message.startsWith("STOP") ? "STOP" : "Implementation gate", message)
          })
          .catch(terminate)
      } catch (error) {
        terminate(error)
      }
    }
    const mouseDecision = (captured: PublishedAttempt, decision: "authorize" | "cancel", event: MouseEvent) => {
      if (event.button !== 0) return
      event.stopPropagation()
      decide(captured, decision)
    }
    function DecisionStrip(props: { published: PublishedAttempt }) {
      const captured = props.published
      let surface: Renderable | undefined
      let authorizeButton: Renderable | undefined
      let cancelButton: Renderable | undefined
      let worktreeText: Renderable | undefined
      let bindingText: Renderable | undefined
      let questionText: Renderable | undefined
      const [ready, setReady] = createSignal(false)
      const [width, setWidth] = createSignal(context.renderer.terminalWidth)
      let layoutProof: { width: number; height: number; surface: Renderable; frame: Renderable } | undefined
      const rootLines = () =>
        Math.min(
          2,
          Math.max(1, Math.ceil(columns(`Worktree: ${displayPath(captured.candidate.root)}`) / Math.max(1, width()))),
        )
      const invalidate = () => {
        layoutProof = undefined
        setReady(false)
      }
      invalidateLayout = invalidate
      const live = (node: Renderable | undefined): node is Renderable => {
        if (!node) return false
        for (let ancestor: Renderable | null = node; ancestor; ancestor = ancestor.parent) {
          if (!ancestor.visible || ancestor.isDestroyed) return false
        }
        return true
      }
      const validGeometry = () => {
        const frame = surface?.parent ?? surface
        const viewport = { width: context.renderer.terminalWidth, height: context.renderer.terminalHeight }
        if (
          context.renderer.isDestroyed ||
          !live(surface) ||
          !frame ||
          frame.width <= 0 ||
          frame.width > viewport.width ||
          width() !== frame.width ||
          columns(`Worktree: ${displayPath(captured.candidate.root)}`) > frame.width * 2 ||
          columns(binding(captured)) > frame.width ||
          columns(authorizationQuestion) > frame.width
        )
          return false
        const inViewport = (node: Renderable | undefined, height = 1): node is Renderable =>
          !!node &&
          live(node) &&
          node.width > 0 &&
          node.height === height &&
          node.screenX >= 0 &&
          node.screenY >= 0 &&
          node.screenX + node.width <= viewport.width &&
          node.screenY + node.height <= viewport.height
        return !!(
          inViewport(surface, rootLines() + 3) &&
          inViewport(worktreeText, rootLines()) &&
          columns(`Worktree: ${displayPath(captured.candidate.root)}`) <= worktreeText.width * rootLines() &&
          inViewport(bindingText) &&
          columns(binding(captured)) <= bindingText.width &&
          inViewport(questionText) &&
          columns(authorizationQuestion) <= questionText.width &&
          inViewport(authorizeButton) &&
          authorizeButton.width >= 11 &&
          inViewport(cancelButton) &&
          cancelButton.width >= 8
        )
      }
      pendingSurfaceUsable = () => {
        if (ownership.kind !== "pending" || ownership.published !== captured || !rootSelected()) return false
        if (!live(surface)) {
          terminate(new Error("Authorization surface is unavailable"))
          return false
        }
        return (
          ready() &&
          !!layoutProof &&
          layoutProof.surface === surface &&
          layoutProof.frame === (surface.parent ?? surface) &&
          layoutProof.width === context.renderer.terminalWidth &&
          layoutProof.height === context.renderer.terminalHeight &&
          validGeometry()
        )
      }
      const checkLayout = () => {
        if (ownership.kind !== "pending" || ownership.published !== captured) return
        invalidate()
        guard.assertCurrent()
        if (!rootSelected()) return
        if (!live(surface)) {
          terminate(new Error("Authorization surface is unavailable"))
          return
        }
        const frame = surface.parent ?? surface
        // Measure after the complete parent/child layout pass. A width change
        // schedules the correct path wrapping; wait for that frame before enabling.
        if (width() !== frame.width) {
          setWidth(frame.width)
          return
        }
        if (!validGeometry()) return
        // Publish proof only after the entire completed-frame validation passes.
        layoutProof = {
          width: context.renderer.terminalWidth,
          height: context.renderer.terminalHeight,
          surface,
          frame,
        }
        setReady(true)
      }
      const completedFrame = () => {
        try {
          checkLayout()
        } catch (error) {
          terminate(error)
        }
      }
      context.renderer.on("frame", completedFrame)
      onCleanup(() => {
        context.renderer.off("frame", completedFrame)
        invalidate()
        pendingSurfaceUsable = undefined
        invalidateLayout = undefined
        if (ownership.kind === "pending" && ownership.published === captured) {
          // The host keys SessionFrame by route.sessionID and disposes this
          // slot on ordinary navigation. Drop its proof, retaining the exact
          // pending Plan. Loss while the root is still selected fails closed.
          try {
            guard.assertCurrent()
            if (rootSelected()) terminate(new Error("Authorization view was lost"))
          } catch (error) {
            terminate(error)
          }
        }
      })
      return (
        <box
          ref={(node) => {
            surface = node
          }}
          flexDirection="column"
          flexShrink={0}
          height={rootLines() + 3}
        >
          <text
            ref={(node) => {
              worktreeText = node
            }}
            height={rootLines()}
            wrapMode="char"
          >{`Worktree: ${displayPath(captured.candidate.root)}`}</text>
          <text
            ref={(node) => {
              bindingText = node
            }}
            height={1}
            wrapMode="char"
          >
            {binding(captured)}
          </text>
          <text
            ref={(node) => {
              questionText = node
            }}
            height={1}
            wrapMode="char"
          >
            {authorizationQuestion}
          </text>
          <box flexDirection="row" height={1}>
            <box
              ref={(node) => {
                authorizeButton = node
              }}
              paddingX={1}
              onMouseUp={(event) => {
                if (ready()) mouseDecision(captured, "authorize", event)
              }}
            >
              <text fg={context.theme.text.feedback.info.base}>Authorize</text>
            </box>
            <box
              ref={(node) => {
                cancelButton = node
              }}
              paddingX={1}
              onMouseUp={(event) => {
                if (ready()) mouseDecision(captured, "cancel", event)
              }}
            >
              <text>Cancel</text>
            </box>
          </box>
        </box>
      )
    }
    const removeCreated = context.data.on("session.created", (event) => {
      if (
        generation.revoked ||
        ownership.kind !== "waiting" ||
        !baseline ||
        ownership.creation ||
        event.data.parentID ||
        event.data.agent !== "orchestrator" ||
        !same(snapshotLocation(event.data.location), location)
      )
        return
      ownership = { kind: "waiting", creation: structuredClone(event) }
      rootSessionID = event.data.sessionID
    })
    const removeCompleted = context.data.on("session.execution.succeeded", (event) => {
      if (
        generation.revoked ||
        ownership.kind !== "waiting" ||
        !baseline ||
        !ownership.creation ||
        event.data.sessionID !== ownership.creation.data.sessionID
      )
        return
      const creation = ownership.creation
      ownership = { kind: "publishing", creation }
      setLayoutRevision((value) => value + 1)
      const activation = activationEvidence(generation, location, baseline, observationCompletedAt, creation)
      void publishPlan(context, activation, guard)
        .then((published) => {
          guard.assertCurrent()
          if (!initiallyAuthorizable(activation)) {
            const message = baseline!.paths.length
              ? dirtyStatus
              : "Planning only — clean-before-bootstrap ordering could not be proven. Start a new attempt from a clean worktree to enable implementation."
            closeAuthority()
            ensurePresentation(published.bound.parentID)
            setPresentation({ kind: "status", message })
            return
          }
          requireFresh(observeGit(location.directory!, baseline), baseline!)
          ownership = { kind: "retained", creation, published }
          setLayoutRevision((value) => value + 1)
        })
        .catch(terminate)
    })
    // Before transfer, notifications invalidate TUI evidence on receipt;
    // independent publication reads also catch delayed notifications.
    const removeEvents = context.data.listen(({ details: event }) => {
      if (generation.revoked || ownership.kind === "closed" || ownership.kind === "transferred") return
      const creation = ownership.creation
      if (!creation) return
      const sessionID = "sessionID" in event.data ? event.data.sessionID : undefined
      if (ownership.kind === "waiting") {
        if (
          sessionID === creation.data.sessionID &&
          [
            "session.execution.failed",
            "session.execution.interrupted",
            "session.deleted",
            "session.moved",
            "session.permissions",
          ].includes(event.type)
        ) {
          terminate(new Error("The fresh Orchestrator turn did not complete successfully"))
        }
        return
      }
      const bound = guard.bound
      if (
        bound &&
        event.type === "session.created" &&
        event.data.parentID === creation.data.sessionID &&
        sessionID !== bound.planner.childID
      ) {
        terminate(new Error("Unexpected child creation; attempt terminated"))
        return
      }
      if (typeof sessionID !== "string" || ![creation.data.sessionID, bound?.planner.childID].includes(sessionID))
        return
      if (event.type === "session.inbox.enqueued" && sessionID === creation.data.sessionID && guard.publishing) {
        const expected = guard.publishing
        const item = event.data.item
        if (
          event.data.inboxID === expected.id &&
          item.type === "synthetic" &&
          item.delivery === "steer" &&
          item.payload.text === expected.text &&
          item.payload.description === expected.description &&
          item.payload.metadata?.source === "planner"
        )
          return
        terminate(new Error("Unexpected pending input; attempt terminated"))
        return
      }
      // Cosmetic/registry notifications do not carry authority. Known changes to
      // task, lifecycle, policy or location invalidate immediately; decision-time
      // reads independently verify the bound request/call/child and pending Plan.
      // OpenCode's session/message-updater.ts also projects direct history
      // appends and assistant mutations without an inbox or execution-start event.
      // No-text instruction baselines and stream timing do not change this evidence.
      if (
        (event.type === "session.instructions.updated" && event.data.text !== undefined) ||
        [
          "session.deleted",
          "session.moved",
          "session.permissions",
          "session.agent.selected",
          "session.execution.started",
          "session.execution.failed",
          "session.execution.interrupted",
          "session.inbox.enqueued",
          "session.inbox.delivered",
          "session.inbox.cancelled",
          "session.inbox.delivery.changed",
          "session.message.content.updated",
          "session.synthetic",
          "session.skill.activated",
          "session.shell.started",
          "session.shell.ended",
          "session.step.started",
          "session.step.ended",
          "session.step.failed",
          "session.text.started",
          "session.text.ended",
          "session.tool.input.started",
          "session.tool.input.ended",
          "session.tool.called",
          "session.tool.success",
          "session.tool.failed",
          "session.compaction.started",
          "session.compaction.ended",
          "session.compaction.failed",
          "session.forked",
          "session.revert.staged",
          "session.revert.cleared",
          "session.revert.committed",
        ].includes(event.type)
      ) {
        terminate(new Error(`Unexpected ${event.type}; attempt terminated`))
      }
    })
    const resized = () => {
      // Resize precedes descendant layout. A pending decision needs a fresh
      // completed frame; geometry is presentation-only after the exact claim.
      invalidateLayout?.()
      setLayoutRevision((value) => value + 1)
    }
    const rendererLost = () => {
      if (ownership.kind !== "transferred") terminate(new Error("TUI renderer was lost"))
    }
    const decidingFrame = () => {
      if (ownership.kind !== "deciding") return
      try {
        guard.assertCurrent()
      } catch (error) {
        terminate(error)
      }
    }
    context.renderer.on("frame", decidingFrame)
    context.renderer.on("resize", resized)
    context.renderer.on("destroy", rendererLost)
    context.renderer.on("render:error", rendererLost)
    context.renderer.on("handler:error", rendererLost)
    const disposeWatch = createRoot((dispose) => {
      createEffect(() => {
        layoutRevision()
        if (
          generation.revoked ||
          ownership.kind === "closed" ||
          ownership.kind === "transferred" ||
          ownership.kind === "waiting"
        )
          return
        // Track retained/pending preparation and the positive decision until transfer.
        context.data.session.message.list(ownership.creation.data.sessionID)
        context.data.session.pending.list(ownership.creation.data.sessionID)
        try {
          // The host returns a store proxy. Read its route fields even while
          // pending; current() alone cannot retain the departure subscription.
          rootSelected()
          guard.assertCurrent()
          armRetained()
        } catch (error) {
          terminate(error)
        }
      })
      return dispose
    })
    return () => {
      generation.revoked = true
      closeAuthority()
      setPresentation(undefined)
      const remove = removePresentation
      removePresentation = undefined
      remove?.()
      rootSessionID = undefined
      pendingSurfaceUsable = undefined
      invalidateLayout = undefined
      removeCreated()
      removeCompleted()
      removeEvents()
      disposeWatch()
      context.renderer.off("frame", decidingFrame)
      context.renderer.off("resize", resized)
      context.renderer.off("destroy", rendererLost)
      context.renderer.off("render:error", rendererLost)
      context.renderer.off("handler:error", rendererLost)
    }
  },
}
export default plugin
