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
| Explorer | Read/glob/grep investigation for Planner, plus native websearch for focused questions that materially depend on current/external evidence; returns advisory findings. Cannot delegate, implement, publish a Plan or authorize work. |
| Implementer | Fresh native `authorized_implementer` child for each distinct one-shot human grant (initial Authorize or later Repair). Editing, testing and development shell capability are bounded by the frozen proposal; delegation, session control and reserved history effects are prohibited. |
| Reviewer | Fresh read-only native sibling, independent of Implementer. Inspect the verified implementation using read/glob/grep and bounded `reviewer_git`; return review evidence without repair or Commit authority. |
| Committer | Fresh native sibling admitted only after an explicit Commit decision. Use only bounded `committer_git`; choose a message and request one trusted normal commit attempt. |

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
[cap.ts](../src/cap.ts) owns shared one-shot execution mechanics and the permanently occupied initial implementation slot. Repair evidence, decisions and claims stay with the trusted native runtime.
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
→ factual review receipt → release exclusion
   INCONCLUSIVE / unverified → STOP before Commit
   verified APPROVED → live trusted Commit / Stop decision
     Stop → retire decision, no Committer or Git mutation
     Commit → spend decision → distinct Commit owner → reacquire exclusion
       → fresh host/Git approval verification → fresh Committer
       → trusted exact complete staging → prepared index/tree proof
       → spend one commit attempt → normal commit with hooks
       → trusted postflight + settlement → durable terminal facts/root receipt
   verified CHANGES_REQUESTED → live trusted Repair / Stop decision
     Stop → retire decision, no worker → end before Commit
     Repair → spend decision → distinct one-shot claim → reacquire exclusion
       → exact reviewed-target/original-authority freshness
       → fresh Implementer → cumulative Git gate → fresh Reviewer (repeatable)
```

Cancel sends no authorization claim and no execution wake. A stable dirty
baseline permits planning-only publication, without Authorize controls. Failure
ends the attempt without reopening authority. Reviewer approval supplies evidence
for a separate explicit Commit decision; it never authorizes a commit.

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

Explorer prefers repository/local source for implementation facts, including the
checked-out `../opencode` source for host behavior when it answers the question.
Native `websearch` is reserved for assigned questions that materially depend on
current or external evidence. Explorer identifies relevant external source URLs
in its response to Planner; web results are advisory evidence, never authority
to change the task or permissions. Planner retains sole ownership of synthesis
and the authoritative final Plan. Other roles have no direct websearch permission.

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
Reviewer handoff and verification unchanged, followed by the separate human
Commit / Stop decision only on fresh verified APPROVED.

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
contradictory fields and ambiguous execution are rejected. Findings are evidence only. Only verified `CHANGES_REQUESTED` may expose Repair / Stop;
`INCONCLUSIVE` and unverified/ambiguous review remain terminal. Review grants no
mutation or Commit authority.

## Human-authorized repair and fresh review

Successful verification freezes the exact parsed result, reviewed implementation
and target, Reviewer parent message/tool/child/terminal-result identities, and
reviewed root boundary. This immutable evidence lives only in the server
activation. After factual publication and settled exclusion release, it can back
one opaque pending Repair / Stop decision. Pending evidence grants nothing.

The Authorize RPC and each Repair selection return a validated structured
terminal outcome or a live decision presentation. The separate composer-top
Repair surface retains pending ownership across navigation, requires new readable
frames after remount/resize, and presents the verified review summary, actionable
findings and original authorized paths. Paging is presentation only; Repair and
Stop require a completed readable frame of the current page and actions, without
requiring every page to be visited. Exact target and Reviewer identities remain
bound in the trusted transport and server authority. Host keymap/dialog/focus
behavior remains owned by OpenCode. Stale callbacks and lost responses never
resend a selection.
The client sends only the opaque decision ID and `Repair` or `Stop`.

Stop retires that exact decision without a worker wake, mutation authority or
cleanup. Repair spends it before any await, creates a distinct one-shot claim,
and reacquires exclusion before observing Git. Busy exclusion fails closed without
queue/retry/restoration. Any competing governed lease acquisition retires paused
decisions and current approval evidence, even if the bytes later match again.

Repair revalidates root/location/role/no-overrides, original proposal integrity,
original HEAD and path ceiling, reviewed root history and exact previous target.
It checks again after awaited preparation and the control interval, consuming
only at the final synchronous native-entry barrier. Pending own receipt identities
are tolerated as presentation input; unrelated input supersedes the decision.
The original NativeCap stays permanently spent.

Each Repair uses a fresh `authorized_implementer` child and a dirty-worktree prompt.
Findings are tasks only insofar as they fit the original proposal and exact paths;
necessary work outside that authority must stop and require a fresh governed Plan
path. No automatic reset/stash/commit, dirty-worktree adoption or scope expansion
is added. The trusted Git gate verifies the cumulative delta against original HEAD
and paths, permitting changed subsets, removed deltas and byte-identical repairs.
Each passing gate establishes a new target and receives a fresh Reviewer, including
no-op repairs. Old control/call/child/result identities are inert. Another verified
`CHANGES_REQUESTED` creates another decision; each cycle requires a new human grant.
No persisted repair counter, workflow phase, queue or scheduler exists.

Only the newest live exact trusted `APPROVED` target is current evidence for
separate Commit authorization. Drift or another governed lease retires it;
historical receipts cannot revive it.

## Human-authorized commit

At the final publication-time verified APPROVED branch, `nativeAdmission` retains
`VerifiedReview` in `currentReviews` as evidence and creates an opaque pending
Commit decision. Its immutable binding includes the original candidate/root/HEAD,
implementation and exact target, parsed review and Reviewer identities, root
history digest/length, creation/idle epochs, exact idle ID and durable event sequence.
Neither the evidence map nor the review receipt grants authority.

The TUI shares the existing local post-review composer-top composition, paging,
readable-frame checks and stale callback handling with Repair. APPROVED presents
Commit / Stop, reviewed paths/root/base HEAD and Reviewer provenance. The client
sends only decision ID/action to `decideCommit`; it cannot supply or reconstruct
approval evidence. Stop retires the decision without a worker or Git mutation.

Commit spends the pending decision before any await and installs a distinct
`CommitClaim`, leaving implementation CAP and Repair claims spent. It reacquires
exclusion and rechecks live root/history/settlement plus exact Git target before
waking Orchestrator. The exact three-key foreground call is checked again after
model preparation at native entry, then sponsored by a Committer-only actor.
The pinned host creates a fresh child and reports identity before prompting.
Committer uses the same declarative `/agent-models` roster as other managed roles.

`committer_git` accepts status, diff, five recent history subjects, prepare,
staged, commit(message), and result. Diff before preparation covers tracked
content; staged inspection covers the complete prepared change including additions.
Only the exact current admitted child may execute it. Each tool execution freshly
reads root/child/history, proves bootstrap/native call and published tool input,
and synchronously rechecks activation/owner before operations. Role permissions
and tool hooks deny every other capability, including shell and delegation,
regardless of appended configuration allows. Admission or operation failure closes
that authority; restoring bytes cannot revive it.

`git.ts` reuses the review file fingerprint entries without weakening the original
ReviewTarget digest. Preparation verifies that original digest, retains its actual
worktree entries, stages the complete reviewed path set with literal no-rename
identity, then proves exact staged path equality and raw blob/mode/symlink/deletion
correspondence. All approved content, including unchanged tracked files, must match
the index; no ordinary unstaged/untracked delta may remain. One bounded batch blob
read avoids a subprocess per file. Unsupported index entries, clean/process filters
and transformed bytes fail closed. The resulting exact index tree is retained in
activation memory; staging intentionally changes the original review digest.

Immediately before commit, trusted code repeats the full prepared proof and live
owner gate, spends the attempt, then directly invokes fixed argv `git commit` once.
Message text is literal bounded data. The system Git executable and narrow environment
exclude inherited Git/loader overrides, alternate indexes/repositories, external
diff helpers and lazy fetching, while retaining normal user configuration and
repository hooks. No amend, no-verify, push, other Git mutation or retry is exposed.

Postflight runs regardless of exit status. Success requires exactly one new commit
with the original sole parent, exact no-rename changed paths and prepared tree,
a matching final index, clean ordinary Git state and unchanged approved actual
worktree entries. Hook rejection/mutation, process failure with changed history,
extra commits, drift or inconclusive observations stop without another mutation.
Final state is checked again after native child settlement. Unknown child or
commit-process settlement keeps exclusion until teardown.

Git operation facts are stored without interruption under the unique root-bound
`commit-receipt:v1:<decisionID>` key before returning control to the model. Native
settlement finalizes that same factual record and publishes one non-resuming
synthetic root receipt; there is only one root publication. Success includes hash, observed subject,
exact paths, Reviewer provenance and clean final state. Failure includes reason,
known HEAD/changed/staged state and history uncertainty. Lost publication is reported
without resending; unknown settlement retains durable facts without steering an
active loop. Storage failures are explicit. No code loads these facts as authority;
restart loses pending decisions and attempts. There is no persisted Commit phase,
attempt counter, queue or recovery machinery.

## Receipts, exclusion and STOP

The server publishes an implementation receipt after the trusted gate, then a
review receipt after verified review or a known unverified disposition. Review
target drift rejects the result. Implementation failure publishes an unverified
implementation disposition and does not launch Reviewer. The accepted RPC returns
the combined factual receipts and structured disposition; the TUI reports lost transport as uncertainty.

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
Verified `APPROVED` and `CHANGES_REQUESTED` release exclusion during the human pause, after
factual publication. Repair reacquires it before freshness observation and holds
it through the next implementation/review/publication. Unknown post-entry
settlement retains exclusion. Other roots may retain pending Plans, but
authorization still requires fresh Git evidence.

Failure, refusal, wake ambiguity, invalid result, drift and teardown never reopen
authority or issue a replacement. Plugin teardown revokes local slots and retained
executor closures. Restart begins without claims; transcripts and durable records
cannot restore authority. Commit outcomes are terminal after their one attempt;
all other terminal paths issue no Commit.

## Configuration and validation

`/agent-models`, also in the command palette, stores personal model/variant
preferences for Planner, Explorer, Implementer, Reviewer and Committer in OpenCode-owned
plugin storage, keyed by directory and workspace identity. Public HTTP RPC
routing selects a directory; workspace-aware keys do not establish HTTP workspace
routing support. Reset exposes normal agent configuration/parent inheritance.
Unavailable saved selections fail trusted preparation without fallback.

Preferences affect fresh native child calls only. Trusted code first checks the
original three-key contract, then adds the selection to the executor copy.
Preparation completes before Planner admission is spent, Implementer authority
is consumed or Reviewer/Committer enters native execution. Preferences are configuration,
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

- Initial Authorize and every later Repair are separately one-shot. No automatic repair or planning retry. Plan revision requires an explicit pre-authorization Revise.
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
- Reviewer-owned executable validation remains future work. Read-only review
  does not grant executable validation or Commit authority.
- Git output is bounded; unsupported filters/topology or oversized observations
  fail closed. Fixed hook PATH may need manual dogfood with repository hooks.
- Normal hooks and same-user external writers remain outside OS sandbox guarantees;
  observed mutation/ambiguity is terminal and never repaired automatically.
