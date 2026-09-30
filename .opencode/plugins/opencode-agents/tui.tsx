import type { Definition } from "@opencode/plugin/tui/plugin"
import type { OpenCodeEvent } from "@opencode/client"
import type { Renderable, MouseEvent } from "@opentui/core"
import { createEffect, createRoot, createSignal, onCleanup, Show } from "solid-js"
import type { Generation } from "../../../src/cap.ts"
import { observeGit, requireFresh } from "../../../src/git.ts"
import {
  activationEvidence, authorizePublishedAttempt, exactEvidence, initiallyAuthorizable,
  publishedPresentationMatches, publishPlan, snapshotLocation, type DecisionOwner, type PublishedAttempt,
} from "../../../src/attempt.ts"

const dirtyStatus = "Planning only — worktree was dirty when this attempt started. Start a new attempt from a clean worktree to enable implementation."
const columns = (text: string) => [...text].reduce((size, char) => size + (char.codePointAt(0)! > 127 ? 2 : 1), 0)
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)

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
    } catch { /* Publication requires a valid initial observation. */ }
    let creation: Extract<OpenCodeEvent, { type: "session.created" }> | undefined
    let attempted = false
    let closed = false
    let completionID: string | undefined
    let pending: PublishedAttempt | undefined
    let deciding: PublishedAttempt | undefined
    let mounted = false
    let frame: Renderable | undefined
    let layoutViewport: { width: number; height: number } | undefined
    let removeStrip: (() => void) | undefined
    let switchEcho: unknown
    let publicationEcho: unknown
    let promptEnqueued = false
    let promptDelivered = false
    let executionStarted = false
    let executionSucceeded = false
    const [visible, setVisible] = createSignal(true)
    const [layoutRevision, setLayoutRevision] = createSignal(0)
    const removeControls = () => {
      const remove = removeStrip
      removeStrip = undefined
      remove?.()
    }
    const discard = () => {
      closed = true
      pending = undefined
      deciding = undefined
      guard.bound = undefined
      guard.publishing = undefined
      guard.publication = undefined
      guard.switchRecord = undefined
      guard.switching = undefined
      guard.prompt = undefined
      switchEcho = undefined
      publicationEcho = undefined
      setVisible(false)
      removeControls()
    }
    const present = (title: string, message: string) => {
      if (generation.revoked) return
      try { context.ui.toast.show({ title, message, sessionID: creation?.data.sessionID, variant: title === "STOP" ? "error" : "info" }) }
      catch { discard() }
    }
    const terminate = (error: unknown) => {
      if (closed || generation.revoked) return
      const mayHaveStarted = guard.dispatched
      discard()
      const reason = error instanceof Error ? error.message : String(error)
      present("STOP", mayHaveStarted ? `${reason}. Implementation may have started; no prompt will be resent.` : reason)
    }
    const rootSelected = () => {
      const route = context.ui.router.current()
      return route.type === "session" && route.sessionID === creation?.data.sessionID &&
        same(snapshotLocation(context.location ?? context.data.location.default()), location)
    }
    const surfaceUsable = (published: PublishedAttempt) => {
      if (context.renderer.isDestroyed || context.renderer.terminalWidth < 80 || context.renderer.terminalHeight < 24) return false
      if (!layoutViewport || layoutViewport.width !== context.renderer.terminalWidth || layoutViewport.height !== context.renderer.terminalHeight) return false
      if (!frame || frame.isDestroyed) return false
      for (let node: Renderable | null = frame; node; node = node.parent) if (!node.visible || node.isDestroyed) return false
      const width = frame.width
      return width <= layoutViewport.width && columns(`Worktree: ${JSON.stringify(published.candidate.root)}`) <= width * 2 &&
        columns(labels(published)) + 23 <= width
    }
    const guard: DecisionOwner = {
      assertDecision(captured) {
        if (deciding !== captured) throw new Error("Local decision no longer owns the exact published attempt")
        guard.assertCurrent()
      },
      assertCurrent() {
        if (closed || generation.revoked) throw new Error("Attempt ownership was closed or revoked")
        if (attempted && ((!guard.dispatched && !rootSelected()) || !same(snapshotLocation(context.location ?? context.data.location.default()), location))) throw new Error("Root view or TUI location changed")
        const retained = pending ?? deciding
        if (retained) {
          if (!guard.dispatched && (!surfaceUsable(retained) || (pending && !mounted))) throw new Error("Authorization surface became unreadable or unavailable")
          if (!publishedPresentationMatches(context, retained)) throw new Error("Published Plan projection changed")
        }
        if (guard.switchRecord && switchEcho && !same(guard.switchRecord, switchEcho)) throw new Error("Slot switch echo identity changed")
        if (guard.publication && publicationEcho && !same(guard.publication, publicationEcho)) throw new Error("Publication echo identity changed")
      },
    }
    const labels = (published: PublishedAttempt) => `Plan ${published.publication.payload.metadata!.planHash} · HEAD ${published.candidate.head.slice(0, 12)} · Implementation only`
    const decide = (captured: PublishedAttempt, decision: "authorize" | "cancel") => {
      if (closed || generation.revoked || pending !== captured || deciding || generation.busy) return
      try {
        guard.assertCurrent()
        // Run-to-completion claims the exact object before any asynchronous work.
        pending = undefined
        deciding = captured
        removeControls()
        if (decision === "cancel") {
          discard()
          present("Cancelled", "Cancelled — no implementation admitted")
          return
        }
        void authorizePublishedAttempt(context, captured, guard).then(
          (message) => { guard.assertCurrent(); discard(); present("Implementation gate", message) },
        ).catch(terminate)
      } catch (error) { terminate(error) }
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
      const [ready, setReady] = createSignal(false)
      const [width, setWidth] = createSignal(context.renderer.terminalWidth)
      const rootLines = () => Math.min(2, Math.max(1, Math.ceil(columns(`Worktree: ${JSON.stringify(captured.candidate.root)}`) / Math.max(1, width()))))
      const checkLayout = () => {
        if (closed || pending !== captured) return
        if (!surface?.width || !surface.height || !surface.visible || surface.isDestroyed) {
          terminate(new Error("Authorization surface is unavailable"))
          return
        }
        frame = surface.parent ?? surface
        layoutViewport = { width: context.renderer.terminalWidth, height: context.renderer.terminalHeight }
        if (!rootSelected() || !surfaceUsable(captured)) {
          terminate(new Error("Authorization surface is unreadable or unavailable"))
          return
        }
        // Measure after the complete parent/child layout pass. A width change
        // schedules the correct path wrapping; wait for that frame before enabling.
        if (width() !== frame.width) { setReady(false); setWidth(frame.width); return }
        mounted = true
        const inViewport = (node: Renderable | undefined, height = 1) => node && !node.isDestroyed && node.visible && node.width > 0 && node.height === height &&
          node.screenX >= 0 && node.screenY >= 0 && node.screenX + node.width <= context.renderer.terminalWidth &&
          node.screenY + node.height <= context.renderer.terminalHeight
        if (!rootSelected() || !surfaceUsable(captured) || rootLines() > 2 || surface.height > 3 ||
            !inViewport(worktreeText, rootLines()) || columns(`Worktree: ${JSON.stringify(captured.candidate.root)}`) > worktreeText!.width * rootLines() ||
            !inViewport(authorizeButton) || authorizeButton!.width < 11 || !inViewport(cancelButton) || cancelButton!.width < 8) {
          terminate(new Error("Authorization surface is unreadable or unavailable"))
          return
        }
        setReady(true)
      }
      const completedFrame = () => checkLayout()
      context.renderer.on("frame", completedFrame)
      onCleanup(() => {
        context.renderer.off("frame", completedFrame)
        mounted = false
        if (pending === captured && !closed) {
          // The view is already disposing. Close ownership synchronously, then
          // unregister outside this cleanup to avoid recursive Solid disposal.
          const unregister = removeStrip
          removeStrip = undefined
          terminate(new Error("Authorization view was lost"))
          queueMicrotask(() => unregister?.())
        }
      })
      return <box ref={(node) => { surface = node }} flexDirection="column" flexShrink={0} height={rootLines() + 1}>
        <text ref={(node) => { worktreeText = node }} height={rootLines()} wrapMode="char">{`Worktree: ${JSON.stringify(captured.candidate.root)}`}</text>
        <box flexDirection="row" height={1}>
          <text>{labels(captured)} </text>
          <box ref={(node) => { authorizeButton = node }} paddingX={1}
            onMouseUp={(event) => { if (ready()) mouseDecision(captured, "authorize", event) }}>
            <text fg={context.theme.text.feedback.info.base}>Authorize</text>
          </box>
          <box ref={(node) => { cancelButton = node }} paddingX={1}
            onMouseUp={(event) => { if (ready()) mouseDecision(captured, "cancel", event) }}>
            <text>Cancel</text>
          </box>
        </box>
      </box>
    }
    const removeCreated = context.data.on("session.created", (event) => {
      if (generation.revoked || closed || !baseline || attempted || creation || event.data.parentID ||
          event.data.agent !== "orchestrator" || !same(event.data.location, location)) return
      creation = structuredClone(event)
    })
    const removeCompleted = context.data.on("session.execution.succeeded", (event) => {
      if (generation.revoked || closed || attempted || !baseline || !creation || event.data.sessionID !== creation.data.sessionID) return
      attempted = true
      completionID = event.id
      setLayoutRevision((value) => value + 1)
      const activation = activationEvidence(generation, location, baseline, observationCompletedAt, creation)
      void publishPlan(context, activation, guard).then((published) => {
        guard.assertCurrent()
        if (!initiallyAuthorizable(activation)) {
          const message = baseline!.paths.length ? dirtyStatus : "Planning only — clean-before-bootstrap ordering could not be proven. Start a new attempt from a clean worktree to enable implementation."
          const rootID = published.bound.parentID
          discard()
          removeStrip = context.ui.slot({ append: "session.composer.top", render: (input) =>
            <Show when={input.sessionID === rootID}><text>{message}</text></Show> })
          return
        }
        requireFresh(observeGit(location.directory!, baseline), baseline!)
        pending = published
        setLayoutRevision((value) => value + 1)
        removeStrip = context.ui.slot({ append: "session.composer.top", render: (input) =>
          <Show when={visible() && input.sessionID === published.bound.parentID}><DecisionStrip published={published} /></Show> })
      }).catch(terminate)
    })
    // Notifications revoke on receipt; server read barriers independently catch delayed events.
    const removeEvents = context.data.listen(({ details: event }) => {
      if (generation.revoked || closed || !creation) return
      const sessionID = "sessionID" in event.data ? event.data.sessionID : undefined
      if (!attempted) {
        if (sessionID === creation.data.sessionID && ["session.execution.failed", "session.execution.interrupted", "session.deleted", "session.moved", "session.permissions"].includes(event.type)) {
          attempted = true
          terminate(new Error("The fresh Orchestrator turn did not complete successfully"))
        }
        return
      }
      const bound = guard.bound
      if (typeof sessionID !== "string" || ![creation.data.sessionID, bound?.planner.childID, bound?.slot.childID].includes(sessionID as string)) return
      if (event.id === completionID || ["session.viewed", "session.renamed", "session.usage.recorded", "session.usage.updated"].includes(event.type)) return
      if (event.type === "session.inbox.enqueued" && sessionID === creation.data.sessionID && guard.publishing) {
        const expected = guard.publishing
        const observed = { id: event.data.inboxID, sessionID, time: { created: event.created }, ...event.data.item }
        if (event.data.inboxID === expected.id && same(event.data.item, { type: "synthetic", delivery: "steer",
          payload: { text: expected.text, description: expected.description, metadata: expected.metadata } }) &&
            (!publicationEcho || same(publicationEcho, observed))) {
          publicationEcho = observed
          if (guard.publication && !same(guard.publication, observed)) terminate(new Error("Publication echo identity changed"))
          return
        }
      }
      if (sessionID === bound?.slot.childID) {
        if (event.type === "session.agent.selected" && guard.switching === sessionID && event.data.agent === "authorized_implementer" && event.data.previous === "implementer_slot") {
          const observed = { id: event.id.replace(/^evt_/, "msg_"), type: "agent-switched", agent: event.data.agent,
            previous: event.data.previous, metadata: event.metadata, time: { created: event.created } }
          if ((!switchEcho || same(switchEcho, observed)) && (!guard.switchRecord || same(guard.switchRecord, observed))) { switchEcho = observed; return }
        }
        if (guard.dispatched && guard.prompt) {
          const expected = guard.prompt
          if (event.type === "session.inbox.enqueued" && event.data.inboxID === expected.id && !promptEnqueued &&
              event.data.item.type === "user" && event.data.item.delivery === "steer" && event.data.item.payload.text === expected.text &&
              !event.data.item.payload.files?.length && !event.data.item.payload.agents?.length && !event.data.item.payload.skills?.length && event.data.item.payload.metadata === undefined) { promptEnqueued = true; return }
          if (event.type === "session.inbox.delivered" && event.data.inboxID === expected.id && promptEnqueued && !promptDelivered) { promptDelivered = true; return }
          if (event.type === "session.execution.started" && promptEnqueued && !executionStarted) { executionStarted = true; return }
          if (event.type === "session.execution.succeeded" && executionStarted && !executionSucceeded) { executionSucceeded = true; return }
          if (executionStarted && !executionSucceeded && /^session\.(step\.|text\.|reasoning\.|tool\.|usage\.|instructions\.)/.test(event.type)) return
        }
      }
      terminate(new Error(`Unexpected ${event.type}; attempt terminated`))
    })
    const resized = () => {
      // Resize precedes descendant layout. Revoke its evidence synchronously;
      // a later frame or resize back cannot revive a pre-admission decision.
      layoutViewport = undefined
      if ((pending || deciding) && !guard.dispatched) terminate(new Error("Authorization layout invalidated by terminal resize"))
      setLayoutRevision((value) => value + 1)
    }
    const rendererLost = () => terminate(new Error("TUI renderer was lost"))
    const decidingFrame = () => {
      if (!deciding || guard.dispatched || closed) return
      try { guard.assertCurrent() } catch (error) { terminate(error) }
    }
    context.renderer.on("frame", decidingFrame)
    context.renderer.on("resize", resized)
    context.renderer.on("destroy", rendererLost)
    context.renderer.on("render:error", rendererLost)
    context.renderer.on("handler:error", rendererLost)
    const disposeWatch = createRoot((dispose) => {
      createEffect(() => {
        layoutRevision()
        if (closed || generation.revoked || !attempted) return
        // Track these reads during the entire claimed continuation, after strip removal too.
        context.ui.router.current()
        context.data.session.message.list(creation!.data.sessionID)
        context.data.session.pending.list(creation!.data.sessionID)
        try {
          if (pending && !mounted) {
            if (!rootSelected() || context.renderer.terminalWidth < 80 || context.renderer.terminalHeight < 24) throw new Error("Authorization view is unavailable")
          } else guard.assertCurrent()
        } catch (error) { terminate(error) }
      })
      return dispose
    })
    return () => {
      generation.revoked = true
      discard()
      creation = undefined
      frame = undefined
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
