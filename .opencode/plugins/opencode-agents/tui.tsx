import type { Definition } from "@opencode/plugin/tui/plugin"
import type { OpenCodeEvent } from "@opencode/client"
import type { Data } from "@opencode/client/solid"
import type { Renderable, MouseEvent } from "@opentui/core"
import { createEffect, createRenderEffect, createRoot, createSignal, onCleanup, untrack, Show } from "solid-js"
import { displayPath } from "../../../src/proposal.ts"
import type { Generation } from "../../../src/cap.ts"
import { registerAgentModels } from "./agent-models-ui.ts"
import { editRevision } from "./revision-editor.tsx"
import { observeGit, requireFresh } from "../../../src/git.ts"
import {
  authorizeRpc,
  checkedCycleOutcome,
  type CycleOutcome,
  type RepairDecision,
} from "../../../src/authorize-rpc.ts"
import {
  activationEvidence,
  authorizePublishedAttempt,
  initiallyAuthorizable,
  inspectRootCompletion,
  publishedPresentationMatches,
  publishPlan,
  publishTerminalReceipt,
  verifyPublishedAttempt,
  type DecisionOwner,
  type Bound,
  type ExpectedPublication,
  type PublicationOwner,
  type PublishedAttempt,
  revisionInput,
} from "../../../src/attempt.ts"
import { exactEvidence, snapshotLocation } from "../../../src/host-evidence.ts"
import { revisionControl, type Revision } from "../../../src/planner-history.ts"

const dirtyStatus =
  "Planning only — worktree was dirty when this attempt started. Start a new attempt from a clean worktree to enable implementation."
const authorizationQuestion = "Do you authorize this plan for implementation?"
// Labels use single-column characters; worktree paths use ASCII JSON escapes.
const columns = (text: string) => text.length
const same = (a: unknown, b: unknown) => exactEvidence(a) === exactEvidence(b)

type Presentation =
  | { kind: "pending"; published: PublishedAttempt }
  | { kind: "repair"; decision: RepairDecision }
  | { kind: "status"; message: string }

const plugin: Definition = {
  id: "opencode-agents",
  setup(context) {
    const removeAgentModels = registerAgentModels(context)
    type Created = Extract<OpenCodeEvent, { type: "session.created" }>
    let revoked = false
    let implementing = false
    const observe = () => {
      const location = snapshotLocation(context.location ?? context.data.location.default())
      try {
        if (location.directory) {
          const baseline = observeGit(location.directory)
          return { location, baseline, observationCompletedAt: Date.now() }
        }
      } catch {
        /* Publication requires a valid pre-creation observation. */
      }
    }
    const preparations = new Map<string, NonNullable<ReturnType<typeof observe>>>()
    const tombstones = new Set<string>()
    // OpenCode 2.0.22 supplies its Solid data object to plugins. Its creating()
    // API identifies optimistic admissions awaiting the create RPC; the narrower
    // plugin Data type omits it. Missing host support must fail closed.
    const sessions = context.data.session as typeof context.data.session & Partial<Pick<Data["session"], "creating">>
    // A rejected unacknowledged create removes its optimistic SessionInfo. The
    // pinned host can retry the same ID, but supplies no creation-generation
    // token. Watch removal across routes (ordinary eviction preserves info),
    // and permanently retire that identity for this activation, even before a
    // queued preparation has been registered. Deletion is likewise fail-closed.
    const disposeRollback = createRoot((dispose) => {
      let visible = new Set<string>()
      createRenderEffect(() => {
        const current = new Set(sessions.list().map((session) => session.id))
        for (const id of visible) {
          if (current.has(id)) continue
          preparations.delete(id)
          tombstones.add(id)
        }
        visible = current
      })
      return dispose
    })
    let initial = true
    const disposePreparation = createRoot((dispose) => {
      createEffect(() => {
        const home = context.ui.router.current().type === "home"
        snapshotLocation(context.location ?? context.data.location.default())
        if (!home && !initial) return
        initial = false
        const observation = observe()
        const known = new Set(untrack(() => sessions.list().map((session) => session.id)))
        createRenderEffect(() => {
          for (const session of sessions.list()) {
            if (known.has(session.id)) continue
            known.add(session.id)
            const id = session.id
            if (
              !observation ||
              session.parentID ||
              session.agent !== "orchestrator" ||
              !same(snapshotLocation(session.location), observation.location)
            )
              continue
            // remember() updates the reactive list before create() registers its
            // in-flight promise. This microtask runs after that registration and
            // before the deferred RPC starts, retaining this home's observation.
            queueMicrotask(() => {
              if (
                !revoked &&
                !tombstones.has(id) &&
                typeof sessions.creating === "function" &&
                sessions.creating(id) === true &&
                !preparations.has(id) &&
                !roots.has(id)
              )
                preparations.set(id, observation)
            })
          }
        })
      })
      return dispose
    })
    const roots = new Map<string, ReturnType<typeof ownRoot>>()
    function ownRoot(creation: Created, observation: NonNullable<ReturnType<typeof observe>>) {
      const generation: Generation = { revoked: false, busy: false }
      const { location, baseline, observationCompletedAt } = observation
      type Planning = { readonly revision?: Revision }
      type Ownership =
        | ((
            | { kind: "waiting"; creation: Created }
            | { kind: "binding"; creation: Created }
            | { kind: "publishing"; creation: Created; bound: Bound; expected: ExpectedPublication }
            | {
                kind: "retained" | "pending" | "deciding" | "transferred"
                creation: Created
                published: PublishedAttempt
              }
          ) & { planning: Planning })
        | { kind: "closed" }
      let repairOwner: { kind: "pending" | "deciding" | "transferred"; decision: RepairDecision } | undefined
      let repairUsable: ((action: "Repair" | "Stop") => boolean) | undefined
      let repairInvalidate: (() => void) | undefined
      let ownership: Ownership = { kind: "waiting", creation, planning: {} }
      const retiredPublications = new Set<string>()
      const retiredPlanners = new Set<string>()
      const retiredCalls = new Set<string>()
      const rootSessionID = creation.data.sessionID
      let pendingSurfaceUsable: (() => boolean) | undefined
      let invalidateLayout: (() => void) | undefined
      let removePresentation: (() => void) | undefined
      const [presentation, setPresentation] = createSignal<Presentation>()
      const [layoutRevision, setLayoutRevision] = createSignal(0)
      const closeAuthority = () => {
        if (ownership.kind === "closed") return
        ownership = { kind: "closed" }
        setPresentation(undefined)
        const remove = removePresentation
        removePresentation = undefined
        remove?.()
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
          /* Toast presentation never changes the settled outcome. */
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
        present("STOP", message)
      }
      const publishReceipt = (sessionID: string, receipt: string) => {
        void publishTerminalReceipt(context, sessionID, receipt).catch(() => {
          present("Receipt unavailable", "The terminal receipt could not be published. The attempt remains closed.")
        })
      }
      // Operation failures have a genuine owner. Render/mount loss and uncertain
      // post-transfer transport failures never publish a competing disposition.
      const admissionFailed = (error: unknown) => {
        if (ownership.kind === "closed" || generation.revoked) return
        const sessionID = ownership.kind === "transferred" ? undefined : rootSessionID
        terminate(error)
        if (sessionID) {
          const reason = error instanceof Error ? error.message : String(error)
          publishReceipt(sessionID, `Implementation was not admitted.\nReason: ${reason}`)
        }
      }
      const repairSelected = () => {
        const route = context.ui.router.current()
        return (
          route.type === "session" &&
          route.sessionID === rootSessionID &&
          same(snapshotLocation(context.location ?? context.data.location.default()), location)
        )
      }
      const loseRepair = (reason: string) => {
        if (!repairOwner) return
        repairOwner = undefined
        setPresentation(undefined)
        const remove = removePresentation
        removePresentation = undefined
        remove?.()
        present("STOP", reason)
      }
      const acceptOutcome = (outcome: CycleOutcome) => {
        if (generation.revoked) return
        if (
          outcome.kind === "repair" &&
          (outcome.decision.rootSessionID !== rootSessionID ||
            outcome.decision.candidate.root !== baseline.root ||
            outcome.decision.candidate.head !== baseline.head)
        )
          throw new Error("Repair outcome belongs to another root or baseline")
        repairOwner = undefined
        setPresentation(undefined)
        const remove = removePresentation
        removePresentation = undefined
        remove?.()
        closeAuthority() // Initial Plan ownership never reopens.
        if (outcome.kind === "terminal") {
          if (outcome.receipt.includes("unverified")) present("STOP", outcome.receipt)
          return
        }
        repairOwner = { kind: "pending", decision: outcome.decision }
        ensurePresentation()
        setPresentation({ kind: "repair", decision: outcome.decision })
        setLayoutRevision((value) => value + 1)
      }
      const repairCurrent = (captured: RepairDecision) => {
        if (
          generation.revoked ||
          !repairOwner ||
          repairOwner.decision !== captured ||
          (repairOwner.kind === "deciding" && !repairSelected()) ||
          !same(snapshotLocation(context.location ?? context.data.location.default()), location)
        )
          throw new Error("Repair presentation was retired or moved")
      }
      const selectRepair = (captured: RepairDecision, action: "Repair" | "Stop") => {
        if (repairOwner?.kind !== "pending" || repairOwner.decision !== captured || implementing || generation.busy)
          return
        try {
          repairCurrent(captured)
          if (!repairSelected() || !repairUsable?.(action)) return
          repairOwner = { kind: "deciding", decision: captured }
          repairInvalidate?.()
          setPresentation({
            kind: "status",
            message:
              action === "Repair" ? "Repair claimed — implementation and fresh review in progress…" : "Stopping…",
          })
          implementing = true
          void (async () => {
            const root = await context.client.session.get({ sessionID: rootSessionID })
            repairCurrent(captured)
            if (
              !repairSelected() ||
              root.id !== rootSessionID ||
              root.agent !== "orchestrator" ||
              root.parentID ||
              root.fork ||
              root.revert ||
              root.time.archived ||
              !root.time.idle ||
              root.outcome !== "succeeded" ||
              !same(snapshotLocation(root.location), location) ||
              (root.permissions && root.permissions.length)
            )
              throw new Error("Repair root is unavailable or changed")
            const active = await context.client.session.active()
            repairCurrent(captured)
            if (active[rootSessionID]) throw new Error("Repair root is active")
            const inbox = await context.client.session.inbox.list({ sessionID: rootSessionID })
            repairCurrent(captured)
            if (
              !repairSelected() ||
              inbox.some(
                (item) =>
                  item.type !== "synthetic" ||
                  item.delivery !== "steer" ||
                  !captured.receipts.some((receipt) => receipt.id === item.id && receipt.text === item.payload.text),
              )
            )
              throw new Error("Unexpected pending input before Repair selection")
            repairOwner = { kind: "transferred", decision: captured }
            return checkedCycleOutcome(
              await context.client.rpc(authorizeRpc).decideRepair({ decisionID: captured.id, action }, { location }),
            )
          })()
            .finally(() => {
              implementing = false
            })
            .then((outcome) => {
              if (repairOwner?.kind !== "transferred" || repairOwner.decision !== captured || generation.revoked) return
              acceptOutcome(outcome)
            })
            .catch((error) => {
              if (repairOwner?.decision !== captured) return
              loseRepair(`STOP — Repair/Stop outcome unavailable; no selection will be resent. ${String(error)}`)
            })
        } catch (error) {
          loseRepair(String(error))
        }
      }
      const rootSelected = () => {
        const route = context.ui.router.current()
        return (
          route.type === "session" &&
          ownership.kind !== "closed" &&
          route.sessionID === ownership.creation.data.sessionID &&
          same(snapshotLocation(context.location ?? context.data.location.default()), location)
        )
      }
      const boundEvidence = () =>
        ownership.kind === "publishing"
          ? ownership.bound
          : "published" in ownership
            ? ownership.published.bound
            : undefined
      const guard: DecisionOwner & PublicationOwner = {
        expectPublication(bound, expected) {
          if (generation.revoked || ownership.kind !== "binding")
            throw new Error("Publication no longer owns the binding attempt")
          ownership = {
            kind: "publishing",
            creation: ownership.creation,
            bound,
            expected,
            planning: ownership.planning,
          }
        },
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
          if (ownership.kind !== "waiting" || ownership.planning.revision) {
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
      const currentPlanning = (planning: Planning) =>
        !generation.revoked && ownership.kind !== "closed" && ownership.planning === planning
      const planningGuard = (planning: Planning): PublicationOwner => ({
        assertCurrent() {
          if (ownership.kind === "closed" || generation.revoked) guard.assertCurrent()
          if (!currentPlanning(planning)) throw new Error("Planning generation no longer owns this root")
          guard.assertCurrent()
        },
        expectPublication(bound, expected) {
          this.assertCurrent()
          guard.expectPublication(bound, expected)
        },
      })
      const planningFailed = (planning: Planning, error: unknown) => {
        if (currentPlanning(planning)) admissionFailed(error)
      }
      const binding = (published: PublishedAttempt) =>
        `Plan ${published.candidate.digest.slice(0, 12)} · HEAD ${published.candidate.head.slice(0, 12)}`
      const ensurePresentation = () => {
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
                  ) : state.kind === "repair" ? (
                    <Show when={repairSelected()}>
                      <RepairStrip decision={state.decision} />
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
      const armRetained = () => {
        if (ownership.kind !== "retained" || generation.revoked || !rootSelected()) return
        const captured = ownership.published
        const planning = ownership.planning
        const owned = planningGuard(planning)
        // Prepare this exact Plan once. Pending ownership survives route changes;
        // navigation never starts another preparation or publication.
        ownership = { ...ownership, kind: "pending" }
        void verifyPublishedAttempt(context, captured, owned)
          .then(() => {
            owned.assertCurrent()
            if (ownership.kind !== "pending" || ownership.published !== captured)
              throw new Error("Root preparation no longer owns the exact published attempt")
            requireFresh(observeGit(location.directory!, captured.activation.baseline), captured.activation.baseline)
            guard.assertCurrent()
            ensurePresentation()
            setPresentation({ kind: "pending", published: captured })
          })
          .catch((error) => planningFailed(planning, error))
      }
      const revise = async (captured: PublishedAttempt) => {
        if (
          ownership.kind !== "pending" ||
          ownership.published !== captured ||
          generation.revoked ||
          generation.busy ||
          !rootSelected() ||
          !pendingSurfaceUsable?.()
        )
          return
        const planning = ownership.planning
        let failurePlanning = planning
        try {
          guard.assertCurrent()
          const text = await editRevision(context, binding(captured))
          if (text === undefined) return
          if (!text.trim()) {
            if (currentPlanning(planning)) present("Revise", "Enter a nonempty revision instruction.")
            return
          }
          if (
            ownership.kind !== "pending" ||
            ownership.published !== captured ||
            generation.revoked ||
            generation.busy ||
            !rootSelected() ||
            !pendingSurfaceUsable?.()
          )
            return
          guard.assertCurrent()
          const revision = revisionInput(captured, text)
          const next = { revision }
          // Run-to-completion permanently removes A's decision authority. Every
          // fallible/asynchronous replanning operation begins after this assignment.
          ownership = { kind: "waiting", creation: ownership.creation, planning: next }
          failurePlanning = next
          retiredPublications.add(captured.publication.id)
          retiredPlanners.add(captured.bound.planner.childID)
          retiredCalls.add(JSON.stringify([captured.bound.planner.messageID, captured.bound.planner.toolID]))
          invalidateLayout?.()
          setPresentation({ kind: "status", message: "Plan superseded — replanning…" })
          const owned = planningGuard(next)
          void (async () => {
            owned.assertCurrent()
            await context.client.rpc(authorizeRpc).revise(revision, { location })
            owned.assertCurrent()
            await context.client.session.inbox.cancel({ sessionID: rootSessionID, inboxID: captured.publication.id })
            owned.assertCurrent()
            const admitted = await context.client.session.synthetic({
              sessionID: rootSessionID,
              id: revision.controlID,
              text: revisionControl(revision),
              metadata: { source: "opencode-agents-revision" },
              delivery: "steer",
              resume: true,
            })
            owned.assertCurrent()
            if (
              admitted.id !== revision.controlID ||
              admitted.sessionID !== rootSessionID ||
              admitted.type !== "synthetic" ||
              admitted.delivery !== "steer" ||
              admitted.payload.text !== revisionControl(revision) ||
              admitted.payload.metadata?.source !== "opencode-agents-revision"
            )
              throw new Error("Revision control admission changed")
          })().catch((error) => planningFailed(next, error))
          setLayoutRevision((value) => value + 1)
        } catch (error) {
          planningFailed(failurePlanning, error)
        }
      }
      const decide = (captured: PublishedAttempt, decision: "authorize" | "cancel") => {
        if (ownership.kind !== "pending" || generation.revoked || ownership.published !== captured || generation.busy)
          return
        if (decision === "authorize" && implementing) return
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
            publishReceipt(captured.bound.parentID, "The published plan was cancelled before authorization.")
            present("Cancelled", message)
            return
          }
          setPresentation({
            kind: "status",
            message: "Authorization claimed — implementation and automatic review in progress…",
          })
          implementing = true
          void authorizePublishedAttempt(context, captured, guard)
            .finally(() => {
              implementing = false
            })
            .then(acceptOutcome)
            .catch(admissionFailed)
        } catch (error) {
          admissionFailed(error)
        }
      }
      const mouseDecision = (captured: PublishedAttempt, decision: "authorize" | "cancel", event: MouseEvent) => {
        if (event.button !== 0) return
        event.stopPropagation()
        decide(captured, decision)
      }
      function RepairStrip(props: { decision: RepairDecision }) {
        const captured = props.decision
        const theme = context.theme
        const actions = ["Repair", "Stop", "Previous", "Next"] as const
        const [selected, setSelected] = createSignal<(typeof actions)[number]>("Stop")
        const [page, setPage] = createSignal(0)
        const [width, setWidth] = createSignal(context.renderer.terminalWidth)
        const [rows, setRows] = createSignal(Math.max(1, Math.min(10, context.renderer.terminalHeight - 10)))
        const [ready, setReady] = createSignal(false)
        const [readAll, setReadAll] = createSignal(false)
        const viewed = new Set<number>()
        let surface: Renderable | undefined
        let evidence: Renderable | undefined
        let question: Renderable | undefined
        const buttons: Renderable[] = []
        let proof: { width: number; height: number; frame: Renderable } | undefined
        // ASCII escaping prevents finding/proposal text from changing terminal
        // geometry. Every page must have a completed readable frame before Repair.
        const content = [
          `Verified CHANGES_REQUESTED: ${displayPath(captured.result.summary)}`,
          `Worktree: ${displayPath(captured.candidate.root)}`,
          `Original HEAD: ${captured.candidate.head}`,
          "Original frozen proposal and exact path ceiling:",
          `Intent: ${displayPath(captured.candidate.proposal.intent)}`,
          `Plan: ${displayPath(captured.candidate.proposal.plan)}`,
          `Authorized paths (${captured.candidate.proposal.files.length}):`,
          ...captured.candidate.proposal.files.map((path) => displayPath(path)),
          `Reviewed target SHA-256: ${captured.target.digest}`,
          `Reviewed changed paths (${captured.target.paths.length}):`,
          ...captured.target.paths.map((path) => displayPath(path)),
          `Reviewer message: ${displayPath(captured.reviewer.messageID)}`,
          `Reviewer tool: ${displayPath(captured.reviewer.toolID)}`,
          `Reviewer child: ${displayPath(captured.reviewer.childID)}`,
          `Reviewer terminal result: ${displayPath(captured.reviewer.resultID)}`,
          ...captured.result.findings.flatMap((item, index) => [
            `Finding ${index + 1} (${item.severity}):`,
            `Scenario: ${displayPath(item.scenario)}`,
            `Impact: ${displayPath(item.impact)}`,
            `Remediation: ${displayPath(item.remediation)}`,
            ...(item.path ? [`Diagnostic path: ${displayPath(item.path)}`] : []),
            ...(item.location ? [`Location: ${displayPath(item.location)}`] : []),
            ...(item.testGap ? [`Test gap: ${displayPath(item.testGap)}`] : []),
          ]),
          "Findings grant no scope. Repair is one new human grant within the original proposal/paths. No Commit authority.",
        ]
        const lines = () =>
          content.flatMap((line) => {
            const result: string[] = []
            for (let offset = 0; offset < line.length; offset += Math.max(1, width()))
              result.push(line.slice(offset, offset + Math.max(1, width())))
            return result
          })
        const pages = () => Math.max(1, Math.ceil(lines().length / rows()))
        const evidenceText = () =>
          lines()
            .slice(page() * rows(), (page() + 1) * rows())
            .join("\n")
        const evidenceHeight = () => Math.max(1, lines().slice(page() * rows(), (page() + 1) * rows()).length)
        const questionText = () =>
          `Review evidence ${page() + 1}/${pages()}. ${readAll() ? "Repair / Stop?" : "Read every page to enable Repair."}`
        const invalidate = () => {
          proof = undefined
          setReady(false)
        }
        repairInvalidate = invalidate
        const live = (node: Renderable | undefined): node is Renderable => {
          if (!node) return false
          for (let parent: Renderable | null = node; parent; parent = parent.parent)
            if (!parent.visible || parent.isDestroyed) return false
          return true
        }
        const inViewport = (node: Renderable | undefined, height: number) =>
          live(node) &&
          node.height === height &&
          node.width > 0 &&
          node.screenX >= 0 &&
          node.screenY >= 0 &&
          node.screenX + node.width <= context.renderer.terminalWidth &&
          node.screenY + node.height <= context.renderer.terminalHeight
        const valid = () =>
          !context.renderer.isDestroyed &&
          inViewport(surface, evidenceHeight() + 2) &&
          inViewport(evidence, evidenceHeight()) &&
          evidence!.width >= width() &&
          inViewport(question, 1) &&
          question!.width >= columns(questionText()) &&
          buttons.length === 4 &&
          buttons.every((button, index) => inViewport(button, 1) && button.width >= actions[index]!.length + 2)
        const usable = (action: "Repair" | "Stop") => {
          repairCurrent(captured)
          if (!repairSelected()) return false
          if (!live(surface)) {
            loseRepair("Repair surface is unavailable")
            return false
          }
          return (
            ready() &&
            (action === "Stop" || readAll()) &&
            !!proof &&
            proof.frame === (surface?.parent ?? surface) &&
            proof.width === context.renderer.terminalWidth &&
            proof.height === context.renderer.terminalHeight &&
            valid()
          )
        }
        repairUsable = usable
        const keyboardUsable = () =>
          repairOwner?.kind === "pending" &&
          repairOwner.decision === captured &&
          repairSelected() &&
          context.keymap.mode.current() === "base" &&
          ready() &&
          !!proof &&
          valid()
        const activate = (action: (typeof actions)[number]) => {
          if (!keyboardUsable()) return
          if (action === "Previous" || action === "Next") {
            invalidate()
            setPage((value) => Math.max(0, Math.min(pages() - 1, value + (action === "Next" ? 1 : -1))))
          } else selectRepair(captured, action)
        }
        context.keymap.layer(() => ({
          mode: "base",
          enabled: keyboardUsable,
          priority: 1,
          commands: [
            {
              bind: "left",
              title: "Previous Repair option",
              run: () => {
                if (keyboardUsable()) setSelected((value) => actions[(actions.indexOf(value) + 3) % 4]!)
              },
            },
            {
              bind: "right",
              title: "Next Repair option",
              run: () => {
                if (keyboardUsable()) setSelected((value) => actions[(actions.indexOf(value) + 1) % 4]!)
              },
            },
            { bind: "return", title: "Select Repair option", run: () => activate(selected()) },
          ],
        }))
        const completedFrame = () => {
          if (repairOwner?.kind !== "pending" || repairOwner.decision !== captured) return
          invalidate()
          try {
            repairCurrent(captured)
            if (!repairSelected()) return
            if (!live(surface)) {
              loseRepair("Repair surface is unavailable")
              return
            }
            const frame = surface.parent ?? surface
            const nextRows = Math.max(1, Math.min(10, context.renderer.terminalHeight - 10))
            if (width() !== frame.width || rows() !== nextRows) {
              viewed.clear()
              setReadAll(false)
              setPage(0)
              setWidth(frame.width)
              setRows(nextRows)
              return
            }
            if (!valid()) return
            viewed.add(page())
            setReadAll(viewed.size === pages())
            proof = { width: context.renderer.terminalWidth, height: context.renderer.terminalHeight, frame }
            setReady(true)
          } catch (error) {
            loseRepair(String(error))
          }
        }
        context.renderer.on("frame", completedFrame)
        onCleanup(() => {
          context.renderer.off("frame", completedFrame)
          invalidate()
          if (repairUsable === usable) repairUsable = undefined
          if (repairInvalidate === invalidate) repairInvalidate = undefined
          if (repairOwner?.kind === "pending" && repairOwner.decision === captured && repairSelected())
            loseRepair("Repair view was lost")
        })
        return (
          <box
            ref={(node) => {
              surface = node
            }}
            flexDirection="column"
            flexShrink={0}
            height={evidenceHeight() + 2}
          >
            <text
              ref={(node) => {
                evidence = node
              }}
              height={evidenceHeight()}
              wrapMode="char"
            >
              {evidenceText()}
            </text>
            <text
              ref={(node) => {
                question = node
              }}
              height={1}
              wrapMode="char"
            >
              {questionText()}
            </text>
            <box flexDirection="row" height={1}>
              {actions.map((action, index) => (
                <box
                  ref={(node) => {
                    buttons[index] = node
                  }}
                  paddingX={1}
                  flexShrink={0}
                  backgroundColor={
                    selected() === action
                      ? theme.background.action.primary.focused
                      : theme.background.action.secondary.base
                  }
                  onMouseUp={(event) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    activate(action)
                  }}
                >
                  <text
                    fg={selected() === action ? theme.text.action.primary.focused : theme.text.action.secondary.base}
                  >
                    {action}
                  </text>
                </box>
              ))}
            </box>
          </box>
        )
      }
      function DecisionStrip(props: { published: PublishedAttempt }) {
        const captured = props.published
        const theme = context.theme
        const actions = ["authorize", "cancel", "revise"] as const
        const [selected, setSelected] = createSignal<(typeof actions)[number]>("authorize")
        const authorizeState = () => (selected() === "authorize" ? "focused" : "base")
        let surface: Renderable | undefined
        let authorizeButton: Renderable | undefined
        let cancelButton: Renderable | undefined
        let reviseButton: Renderable | undefined
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
            cancelButton.width >= 8 &&
            inViewport(reviseButton) &&
            reviseButton.width >= 8
          )
        }
        const usable = () => {
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
        pendingSurfaceUsable = usable
        const keyboardUsable = () =>
          context.keymap.mode.current() === "base" &&
          !generation.revoked &&
          !generation.busy &&
          pendingSurfaceUsable === usable &&
          usable() &&
          publishedPresentationMatches(context, captured)
        const moveSelection = (direction: -1 | 1) => {
          if (keyboardUsable())
            setSelected((action) => actions[(actions.indexOf(action) + direction + actions.length) % actions.length])
        }
        // Local logical selection, scoped to this strip.
        // Base mode leaves dialogs/composer modes with the host; no renderer
        // focus changes. The accessor rechecks even nonreactive ownership/bounds.
        context.keymap.layer(() => ({
          mode: "base",
          enabled: keyboardUsable,
          priority: 1,
          commands: [
            { bind: "left", title: "Previous authorization option", run: () => moveSelection(-1) },
            { bind: "right", title: "Next authorization option", run: () => moveSelection(1) },
            {
              bind: "return",
              title: "Activate authorization selection",
              run: () => {
                if (!keyboardUsable()) return
                const action = selected()
                if (action === "revise") void revise(captured)
                else decide(captured, action)
              },
            },
          ],
        }))
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
          if (pendingSurfaceUsable === usable) pendingSurfaceUsable = undefined
          if (invalidateLayout === invalidate) invalidateLayout = undefined
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
                flexShrink={0}
                backgroundColor={theme.background.action.primary[authorizeState()]}
                onMouseUp={(event) => {
                  if (ready()) mouseDecision(captured, "authorize", event)
                }}
              >
                <text fg={theme.text.action.primary[authorizeState()]}>Authorize</text>
              </box>
              <box
                ref={(node) => {
                  cancelButton = node
                }}
                paddingX={1}
                flexShrink={0}
                backgroundColor={
                  selected() === "cancel"
                    ? theme.background.action.primary.focused
                    : theme.background.action.secondary.base
                }
                onMouseUp={(event) => {
                  if (ready()) mouseDecision(captured, "cancel", event)
                }}
              >
                <text
                  fg={selected() === "cancel" ? theme.text.action.primary.focused : theme.text.action.secondary.base}
                >
                  Cancel
                </text>
              </box>
              <box
                ref={(node) => {
                  reviseButton = node
                }}
                paddingX={1}
                flexShrink={0}
                backgroundColor={
                  selected() === "revise"
                    ? theme.background.action.primary.focused
                    : theme.background.action.secondary.base
                }
                onMouseUp={(event) => {
                  if (ready() && event.button === 0) {
                    event.stopPropagation()
                    void revise(captured)
                  }
                }}
              >
                <text
                  fg={selected() === "revise" ? theme.text.action.primary.focused : theme.text.action.secondary.base}
                >
                  Revise
                </text>
              </box>
            </box>
          </box>
        )
      }
      // Event identity anchors each inspection to its own native idle marker.
      // This notification queue owns no conversational or mutation authority.
      const completed = new Set<string>()
      let completionInspection = Promise.resolve()
      const complete = (event: Extract<OpenCodeEvent, { type: "session.execution.succeeded" }>) => {
        if (
          generation.revoked ||
          ownership.kind !== "waiting" ||
          event.data.sessionID !== rootSessionID ||
          completed.has(event.id)
        )
          return
        completed.add(event.id)
        const planning = ownership.planning
        const owned = planningGuard(planning)
        completionInspection = completionInspection
          .then(async () => {
            if (!currentPlanning(planning) || ownership.kind !== "waiting") return
            const creation = ownership.creation
            const activation = activationEvidence(generation, location, baseline, observationCompletedAt, creation)
            if (!event.id.startsWith("evt_")) throw new Error("Completion event identity is missing")
            const terminalIdleID = event.id.replace(/^evt_/, "msg_")
            const result = await inspectRootCompletion(context, activation, owned, terminalIdleID, planning.revision)
            owned.assertCurrent()
            if (ownership.kind !== "waiting") return
            if (result.kind === "invalid") throw new Error(result.reason)
            if (result.kind === "non-governed") {
              if (planning.revision) throw new Error("Revision did not execute its granted Planner")
              return
            }
            ownership = { kind: "binding", creation, planning }
            if (planning.revision) retiredPublications.add(planning.revision.controlID)
            setLayoutRevision((value) => value + 1)
            const published = await publishPlan(context, activation, owned, result.terminalIdleID, planning.revision)
            owned.assertCurrent()
            if (!initiallyAuthorizable(activation)) {
              const message = baseline.paths.length
                ? dirtyStatus
                : "Planning only — clean-before-bootstrap ordering could not be proven. Start a new attempt from a clean worktree to enable implementation."
              closeAuthority()
              present("Planning only", message)
              publishReceipt(
                published.bound.parentID,
                baseline.paths.length
                  ? "Implementation was not admitted because the worktree was dirty when this attempt started."
                  : "Implementation was not admitted because clean-before-bootstrap ordering could not be proven.",
              )
              return
            }
            requireFresh(observeGit(location.directory!, baseline), baseline)
            ownership = { kind: "retained", creation, published, planning }
            setLayoutRevision((value) => value + 1)
          })
          .catch((error) => planningFailed(planning, error))
      }
      // Before transfer, notifications invalidate TUI evidence on receipt;
      // independent publication reads also catch delayed notifications.
      const eventReceived = (event: OpenCodeEvent) => {
        if (repairOwner && repairOwner.kind !== "transferred") {
          const captured = repairOwner.decision
          if ("sessionID" in event.data && event.data.sessionID === rootSessionID) {
            if (event.type === "session.inbox.enqueued" && event.data.item.type === "synthetic") {
              const text = event.data.item.payload.text
              if (captured.receipts.some((receipt) => receipt.id === event.data.inboxID && receipt.text === text))
                return
            }
            if (
              event.type === "session.inbox.delivered" &&
              captured.receipts.some((receipt) => receipt.id === event.data.inboxID)
            )
              return
            if (
              event.type === "session.synthetic" &&
              captured.receipts.some((receipt) => receipt.text === event.data.text)
            )
              return
            if (event.type === "session.instructions.updated" && event.data.text === undefined) return
            if (
              /^session\.(inbox|message|synthetic|instructions|execution|permissions|agent\.selected|moved|deleted|forked|revert|compaction|shell|skill)/.test(
                event.type,
              )
            )
              loseRepair(`Repair decision lost after ${event.type}`)
          }
        }
        if (generation.revoked || ownership.kind === "closed" || ownership.kind === "transferred") return
        const creation = ownership.creation
        const sessionID = "sessionID" in event.data ? event.data.sessionID : undefined
        if (typeof sessionID === "string" && retiredPlanners.has(sessionID)) return
        if (
          sessionID === rootSessionID &&
          event.type.startsWith("session.tool.") &&
          "assistantMessageID" in event.data &&
          "id" in event.data &&
          retiredCalls.has(JSON.stringify([event.data.assistantMessageID, event.data.id]))
        )
          return
        if (
          (event.type === "session.inbox.enqueued" ||
            event.type === "session.inbox.delivered" ||
            event.type === "session.inbox.cancelled" ||
            event.type === "session.inbox.delivery.changed") &&
          retiredPublications.has(event.data.inboxID)
        )
          return
        if (ownership.kind === "waiting") {
          const revision = ownership.planning.revision
          if (revision && sessionID === rootSessionID && event.type === "session.inbox.enqueued") {
            const item = event.data.item
            if (
              event.data.inboxID !== revision.controlID ||
              item.type !== "synthetic" ||
              item.delivery !== "steer" ||
              item.payload.text !== revisionControl(revision) ||
              item.payload.metadata?.source !== "opencode-agents-revision"
            )
              terminate(new Error("Unexpected revision input; attempt terminated"))
            return
          }
          if (
            sessionID === creation.data.sessionID &&
            [
              "session.execution.failed",
              "session.execution.interrupted",
              "session.deleted",
              "session.moved",
              "session.permissions",
              "session.agent.selected",
              "session.compaction.started",
              "session.compaction.ended",
              "session.compaction.failed",
              "session.forked",
            ].includes(event.type)
          ) {
            terminate(new Error("The fresh Orchestrator turn did not complete successfully"))
          }
          return
        }
        const bound = boundEvidence()
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
        const expected =
          ownership.kind === "publishing"
            ? ownership.expected
            : "published" in ownership
              ? ownership.published.publication
              : undefined
        if (event.type === "session.inbox.enqueued" && sessionID === creation.data.sessionID && expected) {
          const item = event.data.item
          if (
            event.data.inboxID === expected.id &&
            item.type === "synthetic" &&
            item.delivery === "steer" &&
            item.payload.text === expected.payload.text &&
            item.payload.description === expected.payload.description &&
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
      }
      const resized = () => {
        // Resize precedes descendant layout. A pending decision needs a fresh
        // completed frame; geometry is presentation-only after the exact claim.
        invalidateLayout?.()
        repairInvalidate?.()
        setLayoutRevision((value) => value + 1)
      }
      const rendererLost = () => {
        if (repairOwner) loseRepair("Repair renderer was lost")
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
          if (repairOwner?.kind === "pending" || repairOwner?.kind === "deciding") {
            const captured = repairOwner.decision
            if (repairOwner.kind === "deciding" && !repairSelected())
              loseRepair("Repair root view changed before transfer")
            repairSelected()
            context.data.session.get(rootSessionID)
            const inbox = context.data.session.pending.list(rootSessionID)
            if (
              inbox.some(
                (item) =>
                  item.type !== "synthetic" ||
                  item.delivery !== "steer" ||
                  !captured.receipts.some((receipt) => receipt.id === item.id && receipt.text === item.payload.text),
              )
            )
              loseRepair("Unexpected pending input after Review")
            if (!same(snapshotLocation(context.location ?? context.data.location.default()), location))
              loseRepair("Repair location changed")
          }
          if (
            generation.revoked ||
            ownership.kind === "closed" ||
            ownership.kind === "transferred" ||
            (ownership.kind === "waiting" && !ownership.planning.revision)
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
      const dispose = () => {
        generation.revoked = true
        repairOwner = undefined
        repairUsable = undefined
        repairInvalidate = undefined
        closeAuthority()
        setPresentation(undefined)
        const remove = removePresentation
        removePresentation = undefined
        remove?.()
        pendingSurfaceUsable = undefined
        invalidateLayout = undefined
        disposeWatch()
        context.renderer.off("frame", decidingFrame)
        context.renderer.off("resize", resized)
        context.renderer.off("destroy", rendererLost)
        context.renderer.off("render:error", rendererLost)
        context.renderer.off("handler:error", rendererLost)
      }
      return {
        complete,
        eventReceived,
        owns: (sessionID: string) => sessionID === rootSessionID || sessionID === boundEvidence()?.planner.childID,
        dispose,
      }
    }
    const removeCreated = context.data.on("session.created", (event) => {
      if (
        revoked ||
        tombstones.has(event.data.sessionID) ||
        roots.has(event.data.sessionID) ||
        event.data.parentID ||
        event.data.agent !== "orchestrator"
      )
        return
      const observation = preparations.get(event.data.sessionID)
      if (!observation) return
      preparations.delete(event.data.sessionID)
      if (!same(snapshotLocation(event.data.location), observation.location)) return
      roots.set(event.data.sessionID, ownRoot(structuredClone(event), observation))
    })
    const removeCompleted = context.data.on("session.execution.succeeded", (event) => {
      roots.get(event.data.sessionID)?.complete(event)
    })
    const removeEvents = context.data.listen(({ details: event }) => {
      if (revoked) return
      if (event.type === "session.created" && event.data.parentID) {
        roots.get(event.data.parentID)?.eventReceived(event)
        return
      }
      const sessionID = "sessionID" in event.data ? event.data.sessionID : undefined
      if (typeof sessionID !== "string") return
      for (const root of roots.values()) if (root.owns(sessionID)) root.eventReceived(event)
    })
    return () => {
      revoked = true
      removeAgentModels()
      preparations.clear()
      tombstones.clear()
      disposeRollback()
      disposePreparation()
      removeCreated()
      removeCompleted()
      removeEvents()
      for (const root of roots.values()) root.dispose()
    }
  },
}
export default plugin
