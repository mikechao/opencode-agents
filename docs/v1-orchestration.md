# V1 Orchestration

This document owns current runtime architecture and sequencing.
[CAP](coding-authority-protocol.md) owns normative authority requirements;
[the charter](charter.md) owns purpose and scope. The implementation remains
authoritative for exact behavior. Dependency versions are selected in
[package.json](../package.json), with host assumptions checked against the
selected read-only OpenCode source checkout.

## Roles and ownership

| Role | Responsibility and capability |
| --- | --- |
| Orchestrator | Answer ordinary conversation and read-only questions; delegate change planning to Planner. Read/glob/grep and Planner delegation only. Propose exact trusted implementation/review control calls when requested; ordinary role policy still denies those targets. |
| Planner | Read-only exploration and synthesis of one exact `{ intent, plan, files }` proposal. May delegate focused questions to fresh Explorer children. |
| Explorer | Read/glob/grep investigation for Planner; returns advisory findings. Cannot delegate, implement, publish a Plan or authorize work. |
| Implementer | Fresh native `authorized_implementer` child admitted once after explicit human authorization. Editing, testing and development shell capability are bounded by the frozen proposal; delegation, session control and reserved history effects are prohibited. |
| Reviewer | Fresh read-only native sibling, independent of Implementer. Inspect the verified implementation using read/glob/grep and bounded `reviewer_git`; return review evidence without repair or Commit authority. |

The [TUI entry](../.opencode/plugins/opencode-agents/tui.tsx) owns root creation
correlation, Plan publication lifecycle, retained Plan presentation and the local
human decision. [attempt.ts](../src/attempt.ts) verifies planning and publication
evidence and transfers the immutable claim through the
[Authorize RPC](../src/authorize-rpc.ts). It has no separate publication lifecycle
store.

The [Effect server entry](../.opencode/plugins/opencode-agents/server.ts) installs
native admission, permission hooks, model settings and Reviewer Git inspection.
[native.ts](../src/native.ts) owns admission, native evidence capture, settlement,
implementation/review verification and post-transfer receipts.
[cap.ts](../src/cap.ts) owns the one-shot implementation claim and reservation.
[proposal.ts](../src/proposal.ts), [git.ts](../src/git.ts),
[review.ts](../src/review.ts) and [receipt.ts](../src/receipt.ts) own their bounded
artifacts and observations.

OpenCode owns native child creation, scheduling, progress, tool-result delivery,
rows and navigation. The integration wraps the original native executor and
leaves its schemas and decoder intact. Installed host and role/tool policy are
trusted deployment inputs. The intended Authorize producer is the trusted TUI;
same-user processes and localhost RPC access are within the local host trust
boundary. RPC does not independently authenticate caller origin. CAP is not an
OS/process sandbox.

## Delivered lifecycle

```text
original Git baseline → fresh Orchestrator root
→ optional direct conversational/read-only turns
→ initial successfully admitted native Planner execution
→ bind final proposal → freeze candidate → publish trusted Plan
→ optional human Revise → permanently supersede → fresh trusted Planner → new Plan (repeatable)
→ explicit human Authorize on a completed readable root frame
→ transfer exact one-shot claim → fresh native Implementer
→ trusted native provenance + unchanged HEAD + exact changed-path verification
→ immutable verified implementation evidence and review target
→ implementation receipt → automatic fresh read-only Reviewer
→ trusted review provenance/result verification + post-settlement target revalidation
→ review receipt → STOP before Commit
```

Cancel sends no authorization claim and no execution wake. A stable dirty
baseline permits planning-only publication, without Authorize controls. Failure
ends the attempt without reopening authority. Committer and Commit authorization
are not implemented; Reviewer approval cannot authorize a commit.

## Planning and publication

Each eligible root retains its original Git baseline and exact creation evidence.
The TUI correlates a home-route observation with the host's pending root creation
ID, then consumes only that matching creation event. Missing correlation,
rollback or uncertain creation ordering cannot acquire eligibility; returning
to an existing root never refreshes its baseline. Initial implementation
eligibility requires a clean ordinary Git baseline observed before root creation.
Later cleaning cannot repair an originally dirty or ambiguous baseline.

Before governance, Orchestrator may answer directly or use read/glob/grep. These
successful direct turns publish no Plan or workflow receipt, add no Git
observation and preserve the original eligibility. Completion inspection binds
exact native idle boundaries and distinguishes direct turns, governed planning
and invalid evidence. Failed or denied calls before trusted admission may be
corrected; they supply no authority. Successful mutation-capable activity,
compaction or missing supported boundaries fail closed.

Each trusted planning grant admits at most one native Planner execution. The
initial grant comes from the verified root user turn; subsequent grants require
the trusted TUI revision RPC and an exact synthetic revision control. Arbitrary
model Planner calls remain denied after admission. Pre-admission syntax, policy
or settings failures do not spend the initial grant. The server records the exact
invocation and trusted effective-input receipt synchronously before native
execution and projects that receipt through progress and terminal success/failure
metadata. This admission evidence grants no implementation authority.

Trusted code constructs the effective Planner input from the exact persisted
user request in the governed turn plus fixed project-owned exploration guidance.
The model-proposed prompt cannot substitute a request. The receipt binds the user,
preceding idle/root start and assistant/tool invocation; later verification
independently checks the Planner bootstrap and final proposal against those facts.
Publication reads paginated raw history rather than deriving eligibility from
conversation prose or restoring it from a previous activation.

### Explorer findings are advisory

Planner decides whether zero, one or multiple focused Explorer investigations
are useful. Its instructions require already-known independent questions to be
issued together in one assistant response before consuming results; dependent
follow-ups use fresh calls after the prerequisite findings. OpenCode owns native
foreground concurrency and joining. There is no custom scheduler, result store
or Explorer workflow state. Project [opencode.json](../opencode.json) enables
native subagent depth 2 for Orchestrator → Planner → Explorer.

Each Explorer call has exactly `agent`, `description` and `prompt`, without
continuation, background or model-override keys. Completed findings enter
Planner's normal tool-result context. Planner compares the findings, investigates
targeted gaps and synthesizes the final proposal; Explorer cannot supply the
authoritative Plan.

Before publication, trusted code verifies exact Explorer delegation identities,
fresh children, bootstraps, successful supported histories and native completion
evidence. Complete child listing must match the calls, with no Explorer descendants.
Planner/Explorer synthetic instruction, system and compaction history remains
unsupported. Native result truncation need not reproduce full child prose.
Ordinary advisory tool observations rely on trusted native permission enforcement;
publication does not replay a historical tool-policy allowlist as authorization.

Only the final Planner proposal crosses into the candidate and authorization
claim. Explorer history, findings and topology are transient planning-provenance
observations. Authorization revalidates the authority-bearing root/Planner/Plan
facts; it does not reopen Explorer sessions or require continued Explorer liveness.

### TUI publication and the human decision

TUI ownership is the sole Plan publication lifecycle owner. Binding and expected
publication identity/payload are recorded together before awaiting synthetic
publication, so notifications arriving inside that call can be checked against
the same owner. The returned immutable `PublishedAttempt` retains activation,
Planner binding, candidate and admitted publication evidence.

The Plan uses synthetic `delivery: "steer", resume: false`. Its text preserves
raw Planner JSON; its description is the deterministic readable projection,
including an unambiguous quoted label for each exact path. Publication and
hydration supply presentation, never authority. Verification checks the retained
publication, exact root/Planner/request/proposal and fresh original Git evidence.

Pending ownership survives normal Planner navigation and route-driven composer
unmounting. Navigation discards the old readable-frame proof. Root return
requires a fresh completed frame before Authorize/Cancel/Revise can act. Relevant
trusted-state loss or surface loss while the root remains selected closes the
attempt; resize invalidates readiness until a new valid frame.

The positive pointer callback synchronously claims the exact pending object and
removes callbacks. Decision-time reads revalidate the exact evidence, candidate,
location, original HEAD and continued cleanliness before one RPC transfer.
Model prose, Question/Form answers and generic permission approvals cannot
replace this decision. After transfer the server owns the attempt; TUI navigation,
resize, disappearance or a lost response cannot resend or reconstruct the claim.

### Revising a pending Plan

Revision is available only before authorization is claimed. Revise opens the
native `dialog.prompt()` to collect literal human text. Opening or cancelling
that dialog leaves the current Plan unchanged; empty input is rejected. On
submission, trusted code rechecks the exact captured pending `PublishedAttempt`
and its readable frame, then synchronously and permanently removes its decision
authority before any replanning await.

Trusted revision input contains the original authoritative request/user binding,
the exact frozen proposal selected by ownership, and the accepted instruction
without trimming or paraphrasing. After supersession, the TUI registers one
trusted planning grant, retires the old pending Plan by its inbox identity, and
admits the expected synthetic control. The native foreground subagent path
creates a fresh Planner child; the old Planner session is never continued.

Multiple revisions are supported: A → Revise → B → Revise → C. Only the latest
published candidate can be authorized or cancelled. The root owner retains the
original creation/Git baseline and captures an in-memory planning identity in
asynchronous operations. Retired callbacks, results, failure handlers and known
historical notifications cannot replace or close a newer generation. Unknown
state and changed current projections still fail closed. Grant, inbox retirement,
wake, Planner, verification or publication failure closes the attempt; no failure
restores a superseded candidate or automatically retries planning.

Authorization of the latest verified Plan uses the existing Implementer and
Reviewer handoff, verification and receipt behavior unchanged, ending before Commit.

## Native implementation admission and verification

The server occupies each root's private slot before any RPC await and freezes
the transferred claim. Repeated submissions remain rejected after failure,
success or lost responses for the entire activation. It does not reconstruct
planning/publication history after transfer.

One deterministic synthetic steer with `resume: true` requests the exact
three-key Implementer call. The first root tool contender reserves synchronously.
The before hook rejects unexpected tools and malformed owners; the executor
checks both the original published arguments and host-decoded arguments against
the frozen contract. Host normalization cannot make extra authority-bearing
keys acceptable. Missing or ambiguous control/call evidence fails closed.

After independent awaited reads, the final synchronous barrier verifies current
root role/location, empty session overrides, exact reservation, candidate and
path integrity, canonical Git root, unchanged HEAD and cleanliness. It consumes
implementation authority immediately before invoking the original native executor
with a private Implementer-only sponsorship actor. Real parent/message/call
identities and progress remain intact. Root policy and session permissions are
not elevated; native effective deny remains deny and sponsor ask is rejected.
The source-guarded internal seam is actor-based leaf permission evaluation before
child creation. Freshness is a release observation, not an atomic host-policy lock.

The server waits for root and exact child settlement and verifies original
structured native completion, the persisted call, actual child role/parent/location,
bootstrap and successful outcome. Display wrappers, harmless metadata, truncation
and Implementer prose do not establish success. Ordinary native recovery of the
same admitted child is supported; it grants no new CAP admission.

Fresh trusted Git observation requires unchanged authorized HEAD and exact
membership of every staged, unstaged tracked and ordinary untracked changed path
in the frozen scope, including observable rename endpoints. Ignored untracked
content is outside this ordinary Git boundary. Passing the gate does not prove
semantic correctness or physical containment of shell effects.

Successful verification produces explicit immutable `VerifiedImplementation`
evidence: the frozen candidate/root/location, verified implementation invocation
and child identity, and content-bound review target. Reviewer consumes those
verified facts rather than reading closed Implementer CAP getters. Evidence
grants no authority and cannot replace later admission, freshness or settlement checks.
Implementation authority closes before the implementation receipt and review transition.

## Automatic independent review

The accepted authorization RPC automatically initiates one fresh native Reviewer
under the same root after trusted implementation verification. Reviewer is a
sibling of Planner and Implementer, with a separate one-shot admission slot,
control and Reviewer-only sponsor. Its deterministic task binds the frozen
proposal, canonical root, unchanged HEAD, exact accepted paths, implementation
identity, review-target digest and strict result schema. There is no second human
authorization and no model-owned choice of review target or launch decision.

The review target fingerprints staged index identities and actual bytes/types
of tracked and ordinary untracked content, including executable bits, symlink
text and deletions. Repeated collections and fresh Git observations must agree;
unmerged entries, Gitlinks and unsupported or unstable observations fail closed.
This is immutable evidence, not a filesystem snapshot or external lock.

Reviewer has read/glob/grep and dedicated [reviewer_git](../src/reviewer-git.ts)
inspection: current HEAD, status, tracked worktree diff from HEAD, previous HEAD
content and fixed-string tracked search. Untracked content must be read separately.
The tool accepts bounded operations and literal paths, without shell command
strings or arbitrary flags/revisions. Trusted hooks deny mutation, shell/execute,
session control and delegation even if configured policy appends broader allows.
Reviewer Git output is advisory evidence; trusted runtime owns scope and target identity.

After exact root/Reviewer settlement, trusted verification binds native completion,
child identity/bootstrap, supported history and one terminal result. It then
independently re-observes scope and content after the final host reads and rejects
target drift before accepting the strict JSON result:

| Status | Accepted evidence |
| --- | --- |
| `APPROVED` | No blocking findings; empty findings array |
| `CHANGES_REQUESTED` | 1–8 actionable blocking findings |
| `INCONCLUSIVE` | Reliable review unavailable; empty findings array |

Every result requires a nonempty bounded summary. Malformed, extra, duplicate or
contradictory fields and ambiguous execution are rejected. Findings are evidence
only: there is no repair loop, automatic second review, new Implementer or Commit authority.

## Receipts, exclusion and STOP

The server publishes an implementation receipt after the trusted gate, then a
review receipt after verified review or a known unverified disposition. Review
target drift rejects the result. Implementation failure publishes an unverified
implementation disposition and does not launch Reviewer. The accepted RPC returns
the combined outcome; the TUI reports lost transport as uncertainty.

Before transfer, the TUI owns receipts for explicit cancellation, planning-only
eligibility rejection and definitive local operation failures. Render, mount,
navigation and teardown callbacks do not publish receipts. Post-transfer receipts
belong to the accepted server RPC; losing duplicate calls do not publish.

Receipts use synthetic `delivery: "steer", resume: false` after safe root settlement,
with factual historical text and description. They persist visibly while pending.
A later normal user continuation delivers them as user-role model context; this
is not a native display-only transcript append. Receipt failures affect
presentation, preserve the governed result and never retry publication or execution.
Unreadable settlement withholds publication rather than steering a possibly active loop.

Worktree execution exclusion is separate from root-local CAP slots. It spans
implementation, verification, review, revalidation and receipt publication. Root
idle or closed CAP alone cannot release it: exact native child settlement must be
proven. Failed/interrupted exact settlement can release exclusion without verified
success; unknown or ambiguous child settlement holds it until server teardown.
Other roots may retain pending Plans, but authorization still requires fresh Git evidence.

Failure, refusal, wake ambiguity, invalid result, drift and teardown never reopen
authority or issue a replacement. Plugin teardown revokes local slots and retained
executor closures. Restart begins without claims; transcripts and durable records
cannot restore authority. Every terminal path ends before Commit.

## Configuration and validation

`/agent-models`, also in the command palette, stores personal model/variant
preferences for Planner, Explorer, Implementer and Reviewer in OpenCode-owned
plugin storage, keyed by directory and workspace identity. Public HTTP RPC
routing selects a directory; workspace-aware keys do not establish HTTP workspace
routing support. Reset exposes normal agent configuration/parent inheritance.
Unavailable saved selections fail trusted preparation without fallback.

Preferences affect fresh native child calls only. Trusted code first checks the
original three-key contract, then adds the selection to the executor copy.
Preparation completes before Planner admission is spent, Implementer authority
is consumed or Reviewer enters native execution. Preferences are configuration,
not CAP or scope authority; existing children retain their selections.

Automated checks use trusted host/transport/Git-observer/TUI doubles for orchestration
and authority behavior. Real Git tests cover production Git boundaries with
immutable seeds and private copies. Read-only source guards in
[test/native-compatibility.test.ts](../test/native-compatibility.test.ts) check
retained assumptions against the selected sibling OpenCode checkout. Doubles and
source guards do not establish deployed model behavior, terminal rendering or
live validation of the complete lifecycle. Historical implementation-only dogfood
is not evidence that the delivered Reviewer lifecycle has been live-validated.

Run `bun run check`, then `git diff --check`, for repository validation.
[Historical evidence](history/README.md) is separate from this runtime description.

## Current limitations

- One implementation authorization per root; no repair, automatic planning retry
  or automatic repeat review. Plan revision requires an explicit pre-authorization Revise.
- Dirty or ambiguous initial baselines may plan but cannot authorize implementation.
  Earlier pre-Planner rejection is [deferred](investigations/issue-25-planner-admission.md).
- Supported history is deliberately conservative. Planner/Explorer instruction
  synthetics, system messages and compaction do not pass trusted publication;
  supported native read-instruction records in direct root turns and Reviewer
  history are informational only.
- Ordinary Git observation and transient content fingerprints do not lock external
  writers or exhaustively detect concealed shell effects.
- Synthetic Plan/receipt publication is model-facing pending input. A supported
  native display-only transcript API remains a host gap.
- Separate Commit authorization, Committer and Reviewer-owned executable validation
  remain future work. Read-only review does not grant any of them.
