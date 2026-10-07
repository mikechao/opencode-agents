# Issue #22 Commit Authority Inspection

> Historical, non-normative evidence from the bounded source inspection on
> 2026-10-07 at the repository and OpenCode revisions below. Current implementation,
> [CAP](../coding-authority-protocol.md) and [V1 orchestration](../v1-orchestration.md)
> supersede this record where later behavior differs. Issue #22 owns feature scope
> and acceptance criteria; this document preserves architectural reasoning.

Inspection baseline:

- Repository HEAD: `5429d94b7512fb231382b0df0673758f53a48796`,
  `[Fix]: Address Issue #32 review findings`; clean `main`.
- OpenCode/plugin: `2.0.24`, confirmed in pins, lockfile and installed packages.
  Selected sibling OpenCode source: `e7a34f09bfd9134dfade5a8ddb843f7030bc9a69`,
  `release: v2.0.24`.
- OpenTUI core/solid: pinned and installed `0.5.14`.

## Context and Question

The inspection asked whether separate Commit authority after APPROVED review
required cleanup of `src/native.ts` first, direct implementation, or one bounded
extraction alongside implementation. It examined current source, host seams,
architecture documents and characterization tests. Tests were inspected, not
executed; no OpenCode launch or live validation was performed. Older references
to OpenCode 2.0.22 did not supply host evidence.

## Decision

**B. Implement #22 directly.** A standalone `native.ts` cleanup was not justified.
The material new boundary is trusted Git preparation/commit verification, which
can extend existing Git ownership and use a narrow structured tool without first
splitting the runtime lifecycle.

## Current Trusted Runtime Ownership

[`src/native.ts`](../../src/native.ts), `nativeAdmission`, owns native admission,
authority consumption, exact child identity, worktree exclusion, execution
settlement and lifecycle transitions. `before` and `execute` bind the first
contender and native entry; `verifyImplementation` and `verifyReview` independently
check host lineage and Git evidence; `runCycle` owns automatic review and the
settled outcome. `eventReceived` and `teardown` retire stale or revoked state.

These responsibilities share a trusted boundary: closed authority or root idle
alone cannot release exclusion while an exact child may still be active.
Reviewer and Repair remain coherent within that owner. Git observation, result
parsing and stateless transcript proof already belong to separate modules,
including `src/git.ts`, `src/review.ts`, `src/planner-history.ts` and
`src/host-evidence.ts`. Native receipt publication is distinct from human
interaction and readable-frame ownership in the TUI.

## APPROVED Review Evidence and `currentReviews`

`currentReviews`, inside `nativeAdmission`, is an activation-local map keyed by
root session ID. Its immutable `VerifiedReview` retains the frozen proposal/candidate and
location, canonical root and original HEAD, implementation message/tool/child
identity, exact changed paths and review-target digest, exact parsed Reviewer
result and Reviewer message/tool/child/terminal-result identity. Its boundary
also binds root creation/settlement epochs, history length/digest, idle identity
and durable event sequence.

`runCycle` retains APPROVED evidence only after publication-time revalidation.
CHANGES_REQUESTED instead creates a separate pending Repair decision. Repair
spends that decision, reacquires exclusion and runs a fresh Implementer/Reviewer
cycle; a later approval identifies the latest cycle. `acquire` clears paused
decisions and current approvals, relevant activity invalidates them, and teardown
clears them. Historical receipts cannot revive approval after retirement.

`currentApproval` rechecks owner, candidate, location and fresh Git scope/target,
deleting evidence on failure. At this revision its consumers were tests, not a
Commit admission path. It does not independently reread current root history and
settlement. Commit admission therefore needs fresh host/settlement reads as well
as retained evidence and event invalidation.

**Reviewer APPROVED evidence != Commit authority.** `currentReviews` is the
evidence seam for constructing a new explicit decision, never permission to
mutate Git history.

## Commit / Stop Authority Seam

The natural attachment point is the final verified APPROVED branch of `runCycle`,
after publication, root/history/target revalidation and exact settlement:

```text
verified Reviewer APPROVED
→ retain exact review evidence
→ explicit Commit / Stop decision
→ only Commit may proceed toward Committer
```

The existing Repair pattern supplies useful mechanics: opaque trusted decision
identity, server-owned evidence, client selection of only an action against that
identity, one-shot spending, exclusion reacquisition and fresh verification
before worker admission. Repair and Commit remain separate authority grants;
neither findings nor initial implementation authorization substitutes for Commit.
Relevant owners are `src/authorize-rpc.ts` and the decision presentation in
`.opencode/plugins/opencode-agents/tui.tsx`.

## Committer Admission and OpenCode 2.0.24 Findings

The existing project native wrapper provides the basic worker seam. In the
selected `../opencode/packages/core/src/tool/plugin/subagent.ts`, omission of
`sessionID` creates a fresh child; native permission assertion precedes creation;
progress exposes child identity before prompting; foreground result/output
metadata identifies the child and completion status.

Project admission can reject continuation/background keys in the original
published call, prepare model settings, sponsor only the exact invocation, and
independently verify parent, role, location, bootstrap/history and settlement.
`test/native-compatibility.test.ts` guards these host assumptions.

The host's `Agent.Info` supplies no source-file provenance. A role name or
configurable agent definition alone does not prove safe project ownership.
Critical restrictions need trusted runtime/tool enforcement independent of
prompt obedience or appended configuration allows. Structured-tool execution
also needs the exact admitted child and live Commit owner; role checks and tool
visibility alone are insufficient.

## Why Commit Must Not Use Arbitrary Shell

OpenCode 2.0.24's `tool/plugin/shell.ts` and `shell/parse.ts` evaluate
scanner-produced command-text resources, not semantic Git operations. That
boundary alone cannot prove one ordinary commit, reject amend/no-verify, prove
exact staging scope/content, exclude shell composition or environment/repository/
index tricks, or perform the final trusted content gate immediately before
mutation. Shell execution also passes through environment, hooks and preparation
before spawning.

A strict shell dialect plus executor wrapping could add those controls, but
would require extra parsing and execution ownership. The smaller recommended
boundary is a project-owned structured Git tool with bounded operations and
trusted arguments. [`reviewer_git`](../../src/reviewer-git.ts) supplies a concrete
fixed-operation precedent. The tool still needs runtime binding to the exact
Committer and live authority; its existence grants nothing.

## Git Evidence and the Staging Transition

[`src/git.ts`](../../src/git.ts) already owns reusable evidence:

- `observeGit`: canonical root, verified HEAD and the union of staged, unstaged
  and ordinary untracked changed paths, including rename endpoints.
- `requireFresh` and `requireInScope`: clean initial admission and unchanged
  original HEAD/path-ceiling checks.
- `observeReviewTarget` and `requireReviewTarget`: exact target comparison using
  index identities and actual tracked/untracked bytes, types, executable bits,
  symlinks and deletions, with repeated observations.

`observeGit` currently merges path categories. `contentDigest` includes index
information, so staging changes the review digest even when implementation bytes
remain identical. `test/git.test.ts` explicitly characterizes that behavior.
The old digest cannot simply remain identical after staging or HEAD advancement.
The new proof is an intentional transition:

```text
Reviewer-approved worktree target
→ exact prepared index/tree
→ exactly one commit
→ verified committed/final state
```

Likely additions are exact staged-path/index observation, verified mapping from
approved content to prepared index/tree, proof that no approved implementation
delta remains outside the index, post-commit parent/tree/path verification and
final index/worktree verification. These extend existing evidence machinery;
they do not justify a parallel snapshot system or weakening the review fingerprint.

## Recommended Implementation Ownership

| Owner | Architectural responsibility |
| --- | --- |
| `src/native.ts` | Commit authority lifecycle, exact root/review binding, child admission/identity, exclusion, one-shot commit-attempt ownership and fail-closed lifecycle/teardown. |
| `src/git.ts` | Deterministic observations, staged-state proof, approved-target → prepared-index verification and post-commit verification. |
| Narrow structured Committer Git tool | Bounded Git execution with trusted arguments and gates tied to the live runtime owner. |
| Existing model configuration | Add Committer declaratively to `src/agent-models.ts`'s `managedRoles`; reuse fresh-call model preparation. |

No Workflow engine, generic manager/controller, persisted worker-attempt counter,
retry machinery or speculative Committer abstraction was supported by the evidence.

## Failure and Ambiguity Semantics

Once the actual commit attempt is admitted/spent, failed, interrupted,
hook-modified or otherwise ambiguous outcomes do not restore eligibility.
Trusted postflight inspects and reports resulting Git state; there is no automatic
retry, amend, reset, cleanup or second commit attempt. Model output and a lost
transport response cannot authorize another effect.

## Rejected Pre-Implementation Cleanup

Extracting Reviewer/Repair first would redistribute shared exclusion, child,
settlement and event-invalidation dependencies behind another coordinator.
It would mostly move code rather than remove cross-cutting invariants or clarify
authority ownership. Line count alone supplied no reason to do that. Small
deduplication of freshness checks likewise would not solve the staging transition.

## Implementation Consequences

Proceed directly within Issue #22's scope, retaining the runtime authority owner
and extending its existing Git evidence layer. Local decomposition needed for
new Git proofs is implementation work, not a prerequisite lifecycle refactor.

Two existing techniques need deliberate adaptation: `git.ts` inherits
PATH/environment, while Reviewer’s isolated read runner disables hooks; neither
is directly suitable unchanged for ordinary commit execution. Current
`publishReceipt` is best-effort synthetic inbox publication, so durable terminal
evidence needs explicit treatment without restoring mutation authority from
persisted facts. These observations explain design constraints, not additional
feature acceptance criteria.
