# Bounded simplification review

## Local baseline

```text
git status --short        → no output; clean
git branch --show-current → main
git rev-parse HEAD        → 4e2dd875c007a186303b3ec12923791736fc4f77
```

HEAD matches the supplied remote baseline:

```text
4e2dd875c007a186303b3ec12923791736fc4f77
Update @opencode/plugin, @opencode/schema to 2.0.23
```

Both package dependencies are `2.0.23`. The investigation changed no files and did not launch OpenCode. This document records that review; production code and tests remain unchanged.

## Responsibility map

- **[`attempt.ts`](../src/attempt.ts):** activation eligibility; direct-versus-governed root-turn classification; Planner/Explorer provenance; frozen candidate construction; Plan publication and readback; currentness checks; human decision transfer. Pending ownership itself lives in the TUI. This file does **not** verify implementation results or construct review fingerprints.
- **[`native.ts`](../src/native.ts):** server admission hooks, sponsorship, executor wrapping, Planner admission receipts, Implementer/Reviewer execution binding, settlement, worktree exclusion, implementation/review verification, and receipt sequencing. Explorer uses native permissions and model preparation, with provenance checked before Plan publication; it has no separate sponsored execution state.
- Git observation/fingerprinting, proposal validation, model preparation, and review-result parsing are already separated appropriately.

Both files are substantially cohesive. Splitting them by role or size would mostly relocate complexity. The following two focused refactors are ranked by value versus risk.

## 1. Make verified implementation evidence the explicit input to review

**Current problem:** `verifyResult` in `src/native.ts` returns only a `ReviewTarget`. Review then reconstructs the frozen proposal and implementation identity through getters on the now-closed Implementer CAP. The trusted handoff is implicit across several functions. Verification also returns presentation strings: `verifyReview` renders a receipt, and implementation success/failure is distinguished using `typeof implementation === "string"`.

**Proposed change:** Have implementation verification return a private, frozen `VerifiedImplementation` record containing the frozen claim, exact implementation call/child identity, and review target. Pass that evidence explicitly into review. Return `ReviewResult` from review verification and render receipts in the accepted RPC’s orchestration path. Use an explicit success/failure union at the implementation-gate boundary while preserving the RPC’s existing string response.

**Likely files/modules:** `src/native.ts`, `src/review.ts`, and existing receipt helpers if needed. No new execution framework or module is necessary.

**Why this simplifies:** It replaces an implicit dependency on closed mutation authority with explicit verified evidence. It also removes presentation strings from internal verification contracts.

**Authority/invariants affected:** The implementation-to-review handoff, frozen proposal and identity binding, CAP closure, fingerprint verification, and receipt order.

**Why preserved:** Construct the record only after the existing trusted gate passes. Keep activation/current-location/path checks, CAP closure, separate Reviewer admission, and worktree exclusion independent of that record. Preserve the sequence: gate → implementation receipt publication attempt → Reviewer → post-settlement target verification → review receipt. The record grants no authority.

**Testing impact:** Preserve the existing sequencing, substituted-evidence, receipt-failure, drift, and exclusion tests. Add small evidence-construction/rendering tests only where they prove meaningful behavior; use existing trusted doubles without adding Git fixtures or production test seams.

**Implementation risk:** medium.

**Can safely implement in one focused pass:** yes.

## 2. Put publication expectations inside TUI ownership instead of parallel guard fields

**Current problem:** `AttemptGuard` in `src/attempt.ts` exposes independently mutable `bound?` and `publishing?` fields alongside the TUI’s existing `Ownership` union. Together they implicitly represent publication progress. Once published, the guard also retains evidence already available in `PublishedAttempt`. Correct combinations must be reconstructed from assignments and cleanup.

**Proposed change:** Represent the existing binding/publication stages explicitly in TUI ownership: binding underway, binding established, publication expected, and published ownership. Replace writable guard fields with narrow synchronous notifications that record binding and expected publication in that owner. After publication, derive notification expectations from the retained `PublishedAttempt`.

**Likely files/modules:** `src/attempt.ts`, `.opencode/plugins/opencode-agents/tui.tsx`, and affected attempt tests.

**Why this simplifies:** It removes parallel mutable bookkeeping and makes an expected publication without its corresponding binding unrepresentable. Ownership, notification handling, and cleanup consult one source.

**Authority/invariants affected:** Event invalidation during publication, exact pending candidate ownership, stale callbacks, and authorization transfer.

**Why preserved:** Record expectations synchronously **before** invoking the synthetic API, since notifications may arrive during the await. Preserve all independent publication/readback checks, exact object identity, readable-frame checks, and one-shot transfer. Keep current Planner-text/candidate equality unchanged.

**Testing impact:** Retain tests for notifications during publication, hydration drift, cancellation, route disposal/return, stale callbacks, and teardown. Publication tests should need less guard-field setup; no additional subprocesses are needed.

**Implementation risk:** medium.

**Can safely implement in one focused pass:** yes.

**#14 design test:** This gives future Plan replacement/invalidation one clear owner. It does not implement revision or introduce revision/version machinery.

## Intentional defense-in-depth

The apparent duplication below should remain:

- Initial Git eligibility, publication observations, decision freshness, server admission freshness, implementation scope verification, and review-target revalidation protect different boundaries. `git.ts` already supplies the appropriate shared observation primitives.
- Original published arguments, decoded arguments, and prepared executor input serve different purposes. Model preparation must remain before the final synchronous admission barrier.
- Progress-bound child identity proves settlement ownership; the structured completion receipt proves completed execution. A later valid receipt must not heal ambiguous progress identity.
- Root settlement and exact child settlement are separate. Likewise, closed authority does not prove settlement or permit releasing worktree exclusion.
- Planner, Implementer, and Reviewer admission semantics differ. Do not merge their wrappers or one-shot maps. Closed map entries remain activation-local replay barriers.
- Explorer provenance belongs to initial planning acceptance; reopening Explorer sessions during authorization would add an unnecessary lifecycle.

## Obsolete code and compatibility paths

No obsolete execution compatibility path was found. The bootstrap contract, optional TUI location fallback, and `session.creating()` type bridge remain relevant. Older version references in comments/docs are not evidence that those paths are obsolete.

One small deletion candidate is `planHash` in `src/attempt.ts`: it is emitted diagnostic metadata with no current production reader or verifier. The displayed binding uses `candidate.digest`. Delete it during refactor 2 if that diagnostic is no longer wanted; preserve the candidate digest, publication identity, and rendering checks.

## Validation

All **11 read-only native compatibility tests passed**. `git diff --check` passed and the working tree remained clean at the end of the investigation. These static checks do not constitute live OpenCode validation.

## Recommended implementation sequence

1. Introduce frozen verified implementation evidence and separate verification results from receipt rendering.
2. Consolidate publication expectations into TUI ownership; optionally remove unused `planHash`.
3. Finish each pass with `bun run format`, `bun run check`, and `git diff --check`.
