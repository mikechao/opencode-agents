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
const authorizationQuestion = "Do you authorize this plan for implementation?"
const columns = (text: string) => [...text].reduce((size, char) => size + (char.codePointAt(0)! > 127 ? 2 : 1), 0)
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)

type Presentation =
  | { kind: "pending"; published: PublishedAttempt }
  | { kind: "status"; message: string }

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
    let rootSessionID: string | undefined
    let attempted = false
    let closed = false
    let completionID: string | undefined
    let pending: PublishedAttempt | undefined
    let deciding: PublishedAttempt | undefined
    let pendingSurfaceUsable: (() => boolean) | undefined
    let invalidateLayout: (() => void) | undefined
    let removePresentation: (() => void) | undefined
    let switchEcho: unknown
    let publicationEcho: unknown
    let promptEnqueued = false
    let promptDelivered = false
    let executionStarted = false
    let executionSucceeded = false
    const [presentation, setPresentation] = createSignal<Presentation>()
    const [layoutRevision, setLayoutRevision] = createSignal(0)
    const closeAuthority = () => {
      if (closed) return
      closed = true
      pending = undefined
      deciding = undefined
      guard.bound = undefined
      guard.publishing = undefined
      guard.publication = undefined
      guard.switchRecord = undefined
      guard.switching = undefined
      guard.prompt = undefined
      guard.dispatched = undefined
      switchEcho = undefined
      publicationEcho = undefined
      creation = undefined
      completionID = undefined
    }
    const present = (title: string, message: string) => {
      if (generation.revoked) return
      try { context.ui.toast.show({ title, message, sessionID: rootSessionID, variant: title === "STOP" ? "error" : "info" }) }
      catch { /* The persistent composer status remains the trusted outcome. */ }
    }
    const terminate = (error: unknown) => {
      if (closed || generation.revoked) return
      const mayHaveStarted = guard.dispatched
      const reason = error instanceof Error ? error.message : String(error)
      const message = mayHaveStarted
        ? `STOP — Implementation may already have started; no prompt will be resent. ${reason}`
        : `STOP — Implementation was not admitted; no implementation prompt was dispatched. ${reason}`
      closeAuthority()
      if (rootSessionID) showStatus(message)
      present("STOP", message)
    }
    const rootSelected = () => {
      const route = context.ui.router.current()
      return route.type === "session" && route.sessionID === creation?.data.sessionID &&
        same(snapshotLocation(context.location ?? context.data.location.default()), location)
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
          if (!publishedPresentationMatches(context, retained)) throw new Error("Published Plan projection changed")
        }
        if (guard.switchRecord && switchEcho && !same(guard.switchRecord, switchEcho)) throw new Error("Slot switch echo identity changed")
        if (guard.publication && publicationEcho && !same(guard.publication, publicationEcho)) throw new Error("Publication echo identity changed")
      },
    }
    const binding = (published: PublishedAttempt) => `Plan ${published.publication.payload.metadata!.planHash} · HEAD ${published.candidate.head.slice(0, 12)}`
    const ensurePresentation = (sessionID: string) => {
      rootSessionID = sessionID
      if (removePresentation) return
      removePresentation = context.ui.slot({ append: "session.composer.top", render: (input) =>
        <Show when={input.sessionID === rootSessionID}>
          <Show when={presentation()} keyed>
            {(state) => state.kind === "pending"
              ? <DecisionStrip published={state.published} />
              : <text wrapMode="char">{state.message}</text>}
          </Show>
        </Show> })
    }
    const showStatus = (message: string) => {
      if (!rootSessionID) return
      ensurePresentation(rootSessionID)
      setPresentation({ kind: "status", message })
    }
    const decide = (captured: PublishedAttempt, decision: "authorize" | "cancel") => {
      if (closed || generation.revoked || pending !== captured || deciding || generation.busy) return
      try {
        guard.assertCurrent()
        // Only a complete current frame can support a pending human decision.
        // Invalid geometry leaves this exact attempt pending for a later frame.
        if (!pendingSurfaceUsable?.()) { invalidateLayout?.(); return }
        // Run-to-completion claims the exact object before any asynchronous work.
        pending = undefined
        deciding = captured
        invalidateLayout?.()
        if (decision === "cancel") {
          const message = "Cancelled — no implementation admitted"
          closeAuthority()
          showStatus(message)
          present("Cancelled", message)
          return
        }
        setPresentation({ kind: "status", message: "Authorization claimed — implementation admission in progress…" })
        void authorizePublishedAttempt(context, captured, guard).then(
          (message) => {
            guard.assertCurrent()
            closeAuthority()
            showStatus(message)
            present("Implementation gate", message)
          },
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
      let bindingText: Renderable | undefined
      let questionText: Renderable | undefined
      const [ready, setReady] = createSignal(false)
      const [width, setWidth] = createSignal(context.renderer.terminalWidth)
      let layoutProof: { width: number; height: number; surface: Renderable; frame: Renderable } | undefined
      const rootLines = () => Math.min(2, Math.max(1, Math.ceil(columns(`Worktree: ${JSON.stringify(captured.candidate.root)}`) / Math.max(1, width()))))
      const invalidate = () => { layoutProof = undefined; setReady(false) }
      invalidateLayout = invalidate
      const live = (node: Renderable | undefined) => {
        if (!node) return false
        for (let ancestor: Renderable | null = node; ancestor; ancestor = ancestor.parent) {
          if (!ancestor.visible || ancestor.isDestroyed) return false
        }
        return true
      }
      const validGeometry = () => {
        const frame = surface?.parent ?? surface
        const viewport = { width: context.renderer.terminalWidth, height: context.renderer.terminalHeight }
        if (context.renderer.isDestroyed || viewport.width < 80 || viewport.height < 24 || !live(surface) || !frame ||
            frame.width <= 0 || frame.width > viewport.width || width() !== frame.width ||
            columns(`Worktree: ${JSON.stringify(captured.candidate.root)}`) > frame.width * 2 ||
            columns(binding(captured)) > frame.width || columns(authorizationQuestion) > frame.width) return false
        const inViewport = (node: Renderable | undefined, height = 1) => node && live(node) && node.width > 0 && node.height === height &&
          node.screenX >= 0 && node.screenY >= 0 && node.screenX + node.width <= viewport.width &&
          node.screenY + node.height <= viewport.height
        return !!(inViewport(surface, rootLines() + 3) &&
          inViewport(worktreeText, rootLines()) && columns(`Worktree: ${JSON.stringify(captured.candidate.root)}`) <= worktreeText!.width * rootLines() &&
          inViewport(bindingText) && columns(binding(captured)) <= bindingText!.width &&
          inViewport(questionText) && columns(authorizationQuestion) <= questionText!.width &&
          inViewport(authorizeButton) && authorizeButton!.width >= 11 && inViewport(cancelButton) && cancelButton!.width >= 8)
      }
      pendingSurfaceUsable = () => {
        if (pending !== captured) return false
        if (!live(surface)) { terminate(new Error("Authorization surface is unavailable")); return false }
        return ready() && !!layoutProof && layoutProof.surface === surface && layoutProof.frame === (surface!.parent ?? surface!) &&
          layoutProof.width === context.renderer.terminalWidth && layoutProof.height === context.renderer.terminalHeight && validGeometry()
      }
      const checkLayout = () => {
        if (closed || pending !== captured) return
        invalidate()
        guard.assertCurrent()
        if (!live(surface)) {
          terminate(new Error("Authorization surface is unavailable"))
          return
        }
        const frame = surface!.parent ?? surface!
        // Measure after the complete parent/child layout pass. A width change
        // schedules the correct path wrapping; wait for that frame before enabling.
        if (width() !== frame.width) { setWidth(frame.width); return }
        if (!validGeometry()) return
        // Publish proof only after the entire completed-frame validation passes.
        layoutProof = { width: context.renderer.terminalWidth, height: context.renderer.terminalHeight, surface: surface!, frame }
        setReady(true)
      }
      const completedFrame = () => { try { checkLayout() } catch (error) { terminate(error) } }
      context.renderer.on("frame", completedFrame)
      onCleanup(() => {
        context.renderer.off("frame", completedFrame)
        invalidate()
        pendingSurfaceUsable = undefined
        invalidateLayout = undefined
        if (pending === captured && !closed) {
          // The view is already disposing. Close ownership synchronously while
          // leaving the root-scoped status contribution registered.
          terminate(new Error("Authorization view was lost"))
        }
      })
      return <box ref={(node) => { surface = node }} flexDirection="column" flexShrink={0} height={rootLines() + 3}>
        <text ref={(node) => { worktreeText = node }} height={rootLines()} wrapMode="char">{`Worktree: ${JSON.stringify(captured.candidate.root)}`}</text>
        <text ref={(node) => { bindingText = node }} height={1} wrapMode="char">{binding(captured)}</text>
        <text ref={(node) => { questionText = node }} height={1} wrapMode="char">{authorizationQuestion}</text>
        <box flexDirection="row" height={1}>
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
      rootSessionID = event.data.sessionID
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
          closeAuthority()
          ensurePresentation(published.bound.parentID)
          setPresentation({ kind: "status", message })
          return
        }
        requireFresh(observeGit(location.directory!, baseline), baseline!)
        pending = published
        setLayoutRevision((value) => value + 1)
        ensurePresentation(published.bound.parentID)
        setPresentation({ kind: "pending", published })
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
      // Resize precedes descendant layout. A pending decision needs a fresh
      // completed frame; geometry is presentation-only after the exact claim.
      invalidateLayout?.()
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
          guard.assertCurrent()
        } catch (error) { terminate(error) }
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
      creation = undefined
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
