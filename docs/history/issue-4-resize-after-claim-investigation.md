# Issue #4 — Terminal Resize After Authorization Claim

## Scope and baseline

This investigation uses repository baseline `9ddb7b632dbe6a6291cc96d0ef84366aacca6799`. It makes no implementation changes and does not address issues #5 or #6.

The relevant implementation is the activation-local TUI closure in [tui.tsx](../../.opencode/plugins/opencode-agents/tui.tsx), the guarded admission sequence in [attempt.ts](../../src/attempt.ts), its host-double and renderer-layout tests in [attempt.test.ts](../../test/attempt.test.ts), and the current status and normative contract in [v1-orchestration.md](../v1-orchestration.md) and [coding-authority-protocol.md](../coding-authority-protocol.md).

## 1. Current behavior

### Pending surface and frame evidence

After trusted Plan publication and its final verification, `tui.tsx` stores the exact `PublishedAttempt` in `pending` and renders `DecisionStrip`. The strip starts with `ready === false`. Its `completedFrame` handler calls `checkLayout()` on the renderer's `frame` event.

`checkLayout()` currently:

1. Requires the strip to remain the exact pending object and to have a present, visible, non-destroyed surface.
2. Sets `frame` to the surface parent (or surface) and records the current terminal dimensions in `layoutViewport`.
3. Requires the root session route, a live renderer, minimum 80×24 dimensions, matching viewport dimensions, a visible ancestor chain, and enough frame width for the root, binding, and question.
4. If the measured frame width differs from the width used for wrapping, clears `ready`, updates that width, and waits for another frame.
5. Checks actual screen position, viewport clipping, expected row heights, root wrapping, and minimum Authorize/Cancel button widths. Only then sets `ready(true)`.

Thus the intended click proof is a completed frame plus both the surface-level and per-child geometry checks. `layoutViewport` is set early in `checkLayout()`, before all detailed checks; the current invalid-layout branch terminates immediately, so it cannot leave an invalid pending surface eligible today. A recoverable design should publish the viewport proof only after every geometry check succeeds.

The `onMouseUp` handlers accept only button 0 and check `ready()`. `decide()` then verifies that the attempt is still open, that `pending === captured`, and that there is no competing decision or busy generation. Before changing ownership, it calls `guard.assertCurrent()`. While the attempt is pending, that assertion checks the current root route/location, `surfaceUsable()`, mounted state, and published projection. It then synchronously sets `pending = undefined` and `deciding = captured`; only afterward does it replace the strip with persistent in-progress status and invoke `authorizePublishedAttempt()`. There is no await before the exact object is claimed. Cancel follows the same synchronous claim boundary, then closes authority without creating a grant.

### Admission after the claim

`authorizePublishedAttempt()` in `src/attempt.ts` first requires `owner.assertDecision(published)`, which checks `deciding === captured` through the TUI owner. Its `checks()` closure runs generation liveness, `guard.assertCurrent()`, exact TUI location, fresh Git observation, and another owner/liveness check. The clean policy requires the worktree to remain clean and HEAD/root to match. These checks run around the awaited native reads and operations.

The existing sequence then verifies the exact published Plan and native parent/Planner/slot evidence, creates the one-use intent grant, switches the retained slot, records and verifies the exact switch, performs the final full read barrier and fresh clean Git check, consumes the grant, and immediately invokes the exact frozen prompt. It binds the returned input and completed result and applies the unchanged-HEAD/exact-path scope gate before returning the persistent success status. Transport ambiguity does not retry. This work is already independent of renderer geometry except for the TUI-provided owner assertions.

### Every current resize-to-STOP path

Resize currently terminates a pending or claimed pre-dispatch attempt in several connected places:

- `resized()` synchronously clears `layoutViewport`, then calls `terminate("Authorization layout invalidated by terminal resize")` whenever `pending || deciding` and `!guard.dispatched` (`tui.tsx`, lines 304–309). This directly terminates both states named in issue #4.
- `guard.assertCurrent()` treats `pending ?? deciding` alike. Before dispatch it calls `surfaceUsable(retained)`, so clearing `layoutViewport` makes the claimed continuation fail even if the direct resize termination is removed (`tui.tsx`, lines 105–115).
- The global `decidingFrame` listener calls `guard.assertCurrent()` on each renderer frame while `deciding` and before dispatch (`tui.tsx`, lines 312–316). It therefore re-applies the same layout rejection after claim.
- The reactive watcher is invalidated by the resize handler's `layoutRevision` update. With a mounted strip it calls `guard.assertCurrent()`; after claim it always calls `guard.assertCurrent()`. Both paths encounter the same invalidated layout (`tui.tsx`, lines 321–334).
- `DecisionStrip` cleanup sets `mounted = false`. Its explicit `pending === captured` check already prevents cleanup caused by replacing a claimed strip from directly terminating that claim (`tui.tsx`, lines 207–214). However, the global frame listener and reactive watcher can still call `assertCurrent()` against `deciding` and the old surface geometry. So that cleanup guard alone does not remove the coupling.

Before claim, resize also clears `layoutViewport` before descendant layout updates, which correctly makes `surfaceUsable()` false even while `frame.width` and child geometry are stale. But the click path turns that safe rejection into permanent STOP. `ready` is not synchronously cleared by `resized()`, so a stale captured handler may still enter `decide()`; the missing viewport proof makes `guard.assertCurrent()` throw and `decide()` terminates the attempt. Resizing back does not restore `layoutViewport` until a later frame, but by then `closeAuthority()` has cleared `pending`. The current implementation therefore permanently ends a still-pending attempt on resize as well.

The resize event's stale-geometry ordering must remain fail-closed: old `frame.width`, child widths, positions, visibility, and the old viewport snapshot cannot be accepted after the event. The pending attempt should remain inert until a completed frame remeasures all required content against the current terminal. Resizing back without such a frame must remain insufficient.

## 2. Architectural finding

The safe boundary is the synchronous local decision callback:

- **Pending:** a current completed-frame proof that the exact trusted authorization surface is readable is a prerequisite to either local decision. Resize immediately invalidates that proof. Pending resize should be recoverable: a later fresh completed frame may establish a new proof; a too-small or clipped frame remains non-authorizing.
- **Claimed:** the exact `PublishedAttempt` has been claimed by the valid local pointer callback, and the decision controls are functionally gone because `pending` is cleared before the status presentation update. Renderer dimensions and the old surface are now presentation facts. Resize alone does not revoke this continuation.

This leaves the human click as a decision only. It does not create a grant. The same captured object remains bound to the continuation; generic liveness/freshness checks and the grant/switch/barrier/consume/dispatch sequence continue unchanged.

The current synchronous callback already has the right claim ordering: validate its current pending owner, synchronously transition `pending` to `deciding`, then replace controls and begin async admission. The minimum correction is to make the callback's pending-layout proof explicit and stop requiring that proof from continuation-wide `assertCurrent()` calls. A stale callback after resize should be inert and leave the attempt pending for a future valid frame, rather than fail the whole attempt.

## 3. Smallest correct change

### Keep the change in the TUI

No change to `src/attempt.ts` is required. `DecisionOwner.assertDecision(published)` already binds the exact claimed object, and the `AttemptGuard` interface does not encode presentation lifecycle. `authorizePublishedAttempt()`, `checks()`, `verifyPublishedAttempt()`, `executeBoundImplementation()`, and `consumeIntent()` contain no terminal-layout logic. Keep their existing contracts and order.

In `tui.tsx`, separate two responsibilities:

1. Keep `guard.assertCurrent()` responsible for activation/generation liveness, root-route and TUI-location identity while required, published projection integrity, and switch/publication echo identity. Keep those checks active for pending and claimed states as they are today.
2. Add a narrow pending-decision surface assertion/proof used synchronously in `decide()` before the ownership transition. It must require the exact pending object, a proof from the latest completed frame, matching current viewport dimensions, and the complete readable/unclipped surface. Layout invalidity should return without claiming or terminating; the current callback is simply not authorized to proceed.

This is an explicit distinction in the TUI owner semantics: layout is required at decision capture, not as continuation liveness. It does not require a new method on the `src/attempt.ts` `DecisionOwner` interface. `assertDecision()` continues to check the exact `deciding` object and then run only the non-layout current-owner checks.

### Layout proof and resize branches

- In `DecisionStrip`, keep `ready` false until a completed `frame` validates the root binding, Plan/HEAD binding, question, both controls, all ancestor visibility, row/column bounds, and clipping.
- Clear the shared layout proof and synchronously disable the pending decision on every resize before returning to the renderer. Keep the proof absent while layout is being recomputed, while the wrap-width follow-up frame is pending, and when any geometry check fails. Publish a new viewport/frame proof only after all checks pass.
- A stale callback must check that proof again at the authority boundary; it cannot depend solely on a previously true local `ready` value. Invalid geometry leaves `pending` intact and both handlers non-authorizing. A later resize plus valid completed frame can recover. A too-small or clipped completed frame does not authorize.
- Preserve terminal destruction/render/handler errors, true pending-surface loss, route/location loss, projection mutation, and other non-layout invalidations as terminal. `DecisionStrip` cleanup remains fail-closed when `pending === captured`; cleanup after claim remains harmless because `pending` is already `undefined`.
- Remove the `pending || deciding` resize-to-`terminate()` branch. Resize should invalidate layout presentation evidence and wake the existing watcher, not close authority.
- Remove layout requirements from the claimed branch of `guard.assertCurrent()` (preferably from generic `assertCurrent()` entirely, with the dedicated pending callback assertion above). Otherwise `decidingFrame`, async `checks()`, or the reactive watcher would still reject a resize.
- Keep `decidingFrame` and the reactive route/projection watchers. After the layout split, they still run current-owner checks for route/location, projection, and echo identity; they are not renderer geometry checks. For a pending but not-yet-mounted strip, the watcher must not treat a sub-80×24 viewport by itself as a terminal authority failure. It should continue non-layout checks and leave authorization unavailable until the surface is mounted and a valid frame is measured.

The status state remains `status` with trusted text only. It must not restore decision controls or retain a new `PublishedAttempt`. A narrower viewport after claim may wrap or clip that status, but it cannot affect CAP admission; the authorization-only 80×24/readability rule is no longer applicable after the click has been captured.

## 4. Invariants preserved

The proposed separation changes only whether terminal geometry is required after the synchronous callback. It preserves these existing boundaries:

- Only the trusted local left-pointer handler can decide. No keyboard, model message, permission prompt, RPC, or conversation path is added.
- The callback requires the exact currently pending `PublishedAttempt` and a current full-surface proof, then claims that same immutable object synchronously before any await. Duplicate/stale handlers remain inert.
- `guard.assertCurrent()` continues to reject generation/activation closure, root navigation before dispatch, TUI location/workspace identity drift, changed published projection, and mismatched publication/switch echoes.
- `checks()` and the read barriers continue to enforce canonical root/location, unchanged HEAD, clean Git before prompt admission, exact immutable candidate and published Plan, exact parent/Planner/native transcript binding, inactive root and expected inbox, exact retained slot identity, slot creation/parent/role, no permission overrides, and exact switch evidence.
- The one-use grant remains created only in trusted orchestration after the callback has claimed. It is consumed immediately before the sole exact frozen-prompt invocation; no UI grant path is introduced.
- Prompt transport ambiguity still stops without retry, replacement slot, or replay. Exact prompt admission/result binding and result transcript checks remain unchanged.
- The post-implementation gate still requires unchanged HEAD and exact changed-path scope and stops before Reviewer/Commit. There is no Reviewer, Commit, rollback, or retry work added.
- Plugin cleanup still revokes the generation synchronously. A post-claim resize does not bypass the per-await owner, generation, location, and fresh Git checks.

Relevant existing coverage includes the same-slot exact prompt and result tests, `claimed authorization still stops on view or Git drift during awaited switch`, publication/authorization boundary tests, native event and late switch-echo tests, permission mutation coverage, cleanup/revocation tests, ambiguous prompt transport tests, and changed-HEAD/out-of-scope Git gate tests. These should remain as regression protection rather than being rewritten around resize.

## 5. Regression test plan

Use the existing `attempt.test.ts` plugin setup, test-scoped host doubles, captured pointer callback, and fake renderer. Resize cases do not need real Git or a new renderer integration harness.

### Modify existing tests

- **`TUI pointer authorization claims synchronously and dispatches one exact retained slot`** (around line 902): retain its synchronous status, one same-slot switch, one exact prompt, and duplicate-click assertions. Add a post-claim frame/cleanup assertion or cover that more directly in the resize continuation test below.
- **`pointer controls wait for completed layout and reject clipped decision copy or hidden surfaces`** (around line 1275): preserve the no-click-before-frame and clipped/hidden non-authorization checks. If geometry-only failure becomes recoverable, expect controls to remain inert rather than requiring a terminal STOP; keep actual unmount/loss terminal in its separate regression.
- **`lost view, navigation, resize, projection mutation, and cleanup cannot restore controls`** (around line 1048): keep navigation, location, projection, wake, and cleanup failures. Change its resize case to emit a resize, prove the stale handler is inert without dispatch, and then require a fresh valid frame before any decision can be admitted. Do not let a resize-back alone restore readiness.
- **`resize during an awaited post-switch read invalidates stale layout before prompt admission`** (around line 1093): reverse the claimed-resize expectation. Pause at the existing awaited `session.get()` after the switch, resize below the authorization minimum and back wider before release, emit frames with stale and then current geometry, and require the same continuation to complete with one switch and exactly one prompt. Assert no authorization controls return and persistent in-progress status is not replaced by a second decision surface.

### Add focused layout regressions

1. **Pending resize invalidates stale click evidence:** start from a valid completed frame, emit resize, leave descendant geometry unchanged, and invoke the previously captured Authorize callback. Require zero switches, zero prompts, and no claim/STOP. This proves the prior frame and its child geometry cannot authorize.
2. **Pending resize requires a fresh valid frame:** after resize, verify no decision without a frame. Complete a frame at invalid geometry (below 80×24 and/or clipped) and verify it remains non-authorizing. Resize back without completing a frame and verify it still remains non-authorizing. Then update the test double's current geometry, emit a valid completed frame, and verify Authorize becomes usable. This proves recovery comes from fresh layout evidence, not matching dimensions or stale descendants.
3. **Claimed resize and replacement cleanup are harmless:** hold admission at the existing awaited read after the click has claimed `deciding`; confirm persistent in-progress status replaced the strip, emit a renderer frame, resize narrower than the authorization minimum and wider again, then release. Require one retained slot, one switch, one prompt, and the normal successful implementation gate. This exercises `DecisionStrip` cleanup plus both global frame and resize paths.
4. **Pending surface loss remains fail-closed:** retain or sharpen the current unmount case. Dispose the pending surface before a click, invoke any captured handler afterward, and require terminal/inert behavior with zero switches and zero prompts. A later mount or resize cannot restore that attempt.

### Keep as regression protection

Keep the route/location, Git HEAD/dirty, projection, generation cleanup, native/session mutation, permission, switch identity, prompt ambiguity, exact result, changed-path scope, and no-second-dispatch tests. Where a currently existing case proves only pre-decision or post-dispatch mutation, do not claim that it covers claimed pre-dispatch invalidation; extend the existing `claimed authorization still stops on view or Git drift during awaited switch` cases only if a claimed projection/native/permission mutation lacks a pre-prompt assertion.

## 6. Documentation changes

In a later implementation pass, update `docs/v1-orchestration.md` in **Local decision and lifetime** (currently around lines 158–170): state that resize while pending synchronously invalidates the prior frame proof; no decision is available until a fresh completed frame proves the complete current surface readable; invalid geometry remains non-authorizing and may recover after a later valid frame; actual surface loss still terminates. Replace the current statement that a claimed pre-admission resize stops the attempt with the new rule that post-claim geometry is presentation-only and resize alone does not cancel the continuation. Keep the following non-layout watcher, per-await freshness, and cleanup claims intact.

Update the issue #4 dogfood/follow-up paragraph (around lines 288–293) to distinguish the baseline observation from the implemented policy and record the post-fix live verification when it is performed. Do not rewrite the historical baseline evidence as if it never happened.

Do **not** change `docs/coding-authority-protocol.md` for this fix. Its complete-candidate readability requirement and direct-callback readability requirement can naturally be read as decision-time prerequisites: the current surface must be readable when the human decision is captured, including if the terminal has resized before that point. Neither sentence requires the already-captured decision's continuation to maintain the same terminal geometry. The implementation must preserve full readability immediately before claim. If CAP owners later intend the wording to impose perpetual post-decision readability, that would be a normative decision outside this narrow implementation change.

## 7. Proposed implementation diff plan

1. In `tui.tsx`, keep layout proof local to the pending surface. Make resize synchronously invalidate that proof/readiness before descendant reflow; do not terminate solely for resize.
2. Make `DecisionStrip.checkLayout()` validate the whole current surface from a completed frame and publish proof only after every check succeeds. Keep invalid geometry inert and allow a later completed valid frame to recover. Preserve terminal failure for true pending surface loss and non-layout invalidation.
3. Add a narrow pre-claim check in `decide()` for exact pending ownership plus the current valid completed-frame proof. A stale/unreadable surface returns without claiming; the same current pending attempt can wait for a fresh frame.
4. Remove surface geometry from the claimed continuation's `assertCurrent()` path. Keep root-route/location, projection, switch/publication echo, generation, server-read, Git freshness, and all `src/attempt.ts` barriers unchanged. Retain the global frame listener for its non-layout checks.
5. Change the layout-revision watcher so pending resize or a too-small viewport does not terminate an otherwise live attempt. Preserve its route/projection reads and terminate on their actual invalidation.
6. Preserve `DecisionStrip` cleanup's exact `pending === captured` fail-closed rule. Ensure the global frame listener and reactive watcher do not inspect the disposed strip's geometry once `deciding` owns the attempt.
7. Update the focused `attempt.test.ts` cases above using the current fake renderer and callback capture. Keep existing non-layout CAP regressions intact; do not add a production test hook or generalized harness.
8. Reconcile `docs/v1-orchestration.md` as described. Leave the normative CAP document unchanged unless a later explicit contract review resolves its decision-time wording differently.

## Unresolved review risks

- Confirm against the pinned OpenCode/OpenTUI runtime that the `frame` event used here is emitted after the complete descendant layout pass for a resize. The current implementation already relies on that event; the fake renderer can prove invalidation ordering but cannot independently establish host scheduling semantics. The implementation review should validate that callback ordering locally and retain the live 80×24/clipping dogfood case for the later implementation pass.
- The CAP sentence “including after terminal resizing” is slightly broad. This plan treats it as requiring readability at decision capture, including any resize before the click. That is the natural reading under the documented UI/kernel boundary, but a different normative interpretation would require CAP-owner review before changing policy.
- Preserve the current pre-dispatch root-only route policy. Issue #5's Planner-inspection/publication behavior and issue #6's retained-slot root presentation are explicitly out of scope.
