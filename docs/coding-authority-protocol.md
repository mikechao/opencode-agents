# Coding Authority Protocol — V1

## Contract and implementation boundary

This document owns the normative coding-authority contract for
`opencode-agents`. **MUST**, **MUST NOT**, and **SHOULD** express requirements.
[Orchestration](v1-orchestration.md) owns actual host/runtime sequencing;
[the charter](charter.md) owns project goals and non-goals.

The TUI publishes an exact trusted Plan and claims one positive readable-frame
Authorize decision. It transfers the frozen claim to a local server RPC for
one native Implementer admission. Trusted native result binding and independent
unchanged-HEAD/exact-path verification must pass before automatic read-only
Reviewer admission. Trusted review result and exact-target revalidation precede
a separate trusted human Commit / Stop decision for verified APPROVED, or
Repair / Stop for verified CHANGES_REQUESTED. Commit admission and execution
require their own fresh explicit human grant.

Each eligible root has one permanently one-shot initial implementation CAP.
Each later Repair requires a distinct explicit human grant and one-shot claim.
Commit uses a distinct one-shot authority bound to exact verified approval.
Shared-worktree exclusion spans execution, verification and receipt publication,
and is released during the human pause. Repeated initial Authorize is rejected.

## Authority and trust

CAP authority is mechanical, never conversational. Ordinary OpenCode/model
capability is distinct from authority: agent selection, edit/shell permissions,
child relationships, session state and successful tool execution do not grant,
preserve or restore a CAP capability. Generic OpenCode permission approval
controls tool capability only.

Model output, prose, prompts, conversation, tool arguments, candidate IDs,
digests, hashes, prior approvals, lack of denial, repository-controlled state
and durable records MUST NOT create or enlarge authority. Trusted code MUST
independently recompute facts it can observe rather than accept agent claims.

The trusted computing base is the installed OpenCode host/TUI, integration,
CAP kernel, role/tool enforcement, and local OS/user-account boundary.
The trusted TUI is the intended producer of Authorize claims. Same-user local
processes and localhost OpenCode RPC access belong to the trusted host boundary;
RPC caller origin is not independently authenticated. CAP is not an OS/process
sandbox. It does not authenticate physical humans, defend against compromised
host components or hostile same-user modification, or attest remote topology.
Local canonical Git/location correspondence remains required.

Only the exact positive trusted UI claim is intended to enter authorization.
The TUI verifies initial Planner/publication evidence and readability; the
server copies/freezes that immutable claim and verifies integrity. It MUST NOT
reconstruct planning/publication history after transfer. No authentication,
handshake, credential, enrollment, status protocol or recovery store is added.
Agents are not authority sources. Git and validation supply observations,
never grants. Generic host recovery or externally issued same-user prompts
cannot restore consumed CAP authority.

## Exact Planner proposal and intent candidate

The Planner MUST return one JSON object with exactly `{ intent, plan, files }`.
`intent` and `plan` MUST be nonempty strings; unsafe control characters are
rejected (newline is permitted). Their original text MUST be preserved.
`files` MUST be a finite array of unique exact repository-relative file paths;
an empty scope is permitted. It lists all paths implementation may add,
modify or delete.

Scope MUST NOT use directories, subtrees, prefixes, globs, wildcards or implicit
expansion. Absolute paths, backslashes, NUL, empty/dot/traversal path segments,
`.git` segments and pattern syntax are rejected. Existing ancestors MUST be
actual directories, not symlinks or files. Missing ancestors/new files are
permitted. Existing final directories, dangling or otherwise unresolvable final
symlinks, and final symlinks resolving outside the worktree are rejected;
resolvable internal final symlinks are permitted.
The concrete validator is [proposal.ts](../src/proposal.ts).

Trusted code MUST validate and freeze the complete proposal intact. It MUST
NOT trim or normalize text, reorder files, silently add scope, infer missing
fields, or substitute an Orchestrator paraphrase. Scope membership uses exact
path equality; serialization preserves the original array order. The proposal
is an immutable artifact and grants nothing by itself.

An `IntentCandidate` binds that proposal to a trusted-derived canonical local
worktree root and observed `HEAD` commit. Candidate construction MUST retain
the initial root and HEAD rather than substitute later values. The current
deterministic encoding is the UTF-8 JSON serialization below, in this key order,
with a hexadecimal SHA-256 digest:

```ts
JSON.stringify({ kind: "intent", intent, plan, files, root, head })
```

The proposal, copied file array and candidate are frozen. Integrity checks
MUST recompute and compare both encoding and digest, binding exact strings,
file order, root and HEAD. A digest is an integrity identifier, not authority.
The full proposal and meaningful bounds MUST be understandable in trusted
authorization presentation. Admission consumes the capability, not the
proposal; the frozen artifact remains available for later review.

## Presentation is not authorization

The published Plan is a deterministic trusted human-readable projection of
the candidate. Synthetic `text` retains exact raw Planner P, including its
original JSON whitespace; synthetic `description` contains the readable Plan.
Rendering MUST NOT replace or alter the frozen authority-bearing contents.
Each exact filename MUST have a distinct, unambiguous trusted label. The current
Plan quotes paths as ASCII JSON strings, escaping control and Unicode formatting
characters without changing the authorized path bytes, and shows the file count.
Publication, conversation text, synthetic metadata, candidate IDs, digests,
hashes and prose MUST NOT authorize implementation.

Non-authoritative publication may accept a stable pre-existing ordinary Git
delta: its canonical root, HEAD and observed changed-path set must match the
activation baseline. This does not freeze file contents and does not satisfy
clean implementation admission. A retained candidate is not an approved one.

## Clean admission and freshness

For an authority-seeking implementation attempt, trusted code MUST establish
canonical root, current HEAD and a clean initial ordinary Git baseline
**before launching the Planner**. Clean means no staged changed paths, unstaged tracked changed paths, or ordinary untracked
paths; ignored untracked files are excluded. Observation MUST be read-only
with respect to repository content and Git history. CAP does not prescribe
snapshot, tree-construction or index-parsing machinery.

After planning and before authorization presentation, trusted
code MUST recheck the original root, HEAD and cleanliness. After the positive
human decision and immediately before implementation admission, it MUST
recheck candidate integrity, exact invocation/child binding, the same root and
HEAD, and continued cleanliness. No stale decision may be rebound to changed
evidence or a replacement candidate.

Current publication permits a stable dirty baseline for planning only. Initial
eligibility requires empty baseline paths and trusted root Created time strictly
after activation Git observation completed, rebound to exact root creation
identity. Dirty or ambiguous-initial attempts MUST create no implementation
child, expose no Authorize controls, and never become eligible by later cleaning.
Final fresh clean checks MUST remain independent of that initial proof.

## Human decision and server-owned claim

The root-only unregistered local pointer closure MUST require exact pending
ownership, current trusted evidence and a completed readable-frame proof.
The same retained or pending Plan MUST survive ordinary Planner inspection and
route-driven disposal of the root composer slot. Navigation MUST discard the
old readable-frame proof, not pending ownership; root return requires a fresh
root frame. The positive decision MUST revalidate exact Planner/publication,
candidate, HEAD and location evidence before claim transfer. Actual trusted-state
loss, or surface loss while the root remains selected, MUST fail closed.
Pending resize invalidates
readiness until a new valid frame. The positive click synchronously claims the
exact object and removes callbacks. Cancel MUST send no RPC and no wake.
Model replies, Form/Question answers and generic permissions MUST NOT authorize.

The TUI MUST preserve initial clean eligibility and verify the published Plan
and semantic native Planner binding before transferring its immutable claim.
Binding retains the original request, native call/child/input/final IDs, exact
proposal bytes, role/location/no-overrides and root creation evidence. Whole
transcript serialization, model selection and generic metadata are not authority
invariants. The visible store MUST contain the exact trusted Plan; unrelated
visible history need not match the complete server transcript. The claim
binds implementation purpose, candidate/proposal/exact ordered paths/canonical
root/HEAD, root session ID, location and publication identity. The server MUST
occupy its one private slot synchronously before any RPC await, copy/freeze the
claim, and check integrity. Once accepted, subsequent submissions MUST be
rejected for the entire activation, including after failure/success and after
lost responses. No retransmission may issue another wake.

After acceptance the server owns the authorized attempt. TUI navigation,
resize or disappearance cannot remotely restore or synchronously revoke it.
The RPC MUST await root settlement and return the trusted outcome. Lost
transport or verification MUST remain uncertain, never verified success.
Settlement, failure or plugin teardown MUST close unused authority; retained
executor closures MUST reject after teardown. Restart MUST begin with no CAP
claim and MUST NOT reconstruct authority from transcripts or durable records.

## Exact native admission

The server MUST send one deterministic synthetic control input with
`delivery:"steer", resume:true`, specifying exactly:

```ts
{
  agent: "authorized_implementer",
  description: "Implement the authorized plan",
  prompt: implementerPrompt(candidate)
}
```

The control text is a proposal instruction, not authority. Its exact ID/text
bind the continuation. The first authorized-root tool contender MUST reserve
its assistant-message/call IDs synchronously before awaits. Canonical `subagent`
and exactly these three own keys/values are required. Unexpected tools,
aliases, extras, reuse/session IDs, background/model keys (including empty or
false values), and transformed authority arguments MUST be rejected. Malformed
first contenders burn the claim; concurrent losers MUST NOT alter its owner.

Supported server `session.context` MUST inspect the actual published call and
preceding exact control input, including the first host-published tool contender
and failed tool parts that skip execution hooks. At final admission, original
published arguments MUST be compared with the frozen contract independently of
the decoded executor arguments: native repair/decoding can remove optional or
extra properties. The native input/output schemas and host decoder remain
unchanged. Missing, stale or ambiguous control/call evidence MUST fail closed.
Provider byte-level JSON validity is not a separate CAP invariant; a recovered
object still has to pass both exact authority comparisons. Whole
post-authorization planning histories and pending-Plan equality are not required;
initial verification stays in the TUI.

After all awaited admission reads, the final synchronous barrier MUST verify
current root role/location, absence of session permission elevation, intact
claim, exact reservation, valid paths, canonical Git root, unchanged HEAD and
continued cleanliness. Consumption MUST occur immediately before invoking
the original native executor. The server MUST use one hidden, nonselectable
sponsorship actor with deny-all plus only
`subagent:authorized_implementer=allow`. Only the execution actor is substituted;
parent/message/call/progress identities and native lifecycle remain intact.
Root static Implementer denial and session permissions MUST NOT be mutated.
OpenCode's later ConfigAgentPlugin can append global and configured rules.
A sponsor-only, deny-only permission hook MUST bound effective allows to the
exact Implementer delegation and reject effective ask rather than offer a
fallback permission dialog. Native effective deny MUST remain deny. Unrelated
rules and shadowed denies are judged by OpenCode's effective last-match policy;
whole sponsor arrays, visibility and mode are not admission fingerprints.
Correctly configured installed root/Planner/Implementer role and tool policies
are trusted deployment assumptions; CAP does not certify arbitrary configuration.

Sponsorship depends on a source-guarded internal OpenCode seam. Native
`subagent` MUST assert effective permission using the explicit execution actor,
real parent session and source message/call IDs before creating a child. Permission
MUST select the explicit actor ahead of the session agent, merge actual session
overrides, and reject configured effective deny before hooks. Child creation
MUST retain the real parent. CAP changes only the actor; no session runs as the
sponsor. The final root read follows independent awaited admission reads, then
synchronous path/Git checks and consumption. Freshness is an observation at
release, not a transactional lock on parent policy through later native work.

The original native executor MUST create/prompt/run the child and own native
progress, result projection and presentation. No imported child, caller child
or prompt IDs, empty-child barrier, import echo, usage/time initialization or
direct implementation prompt dispatch belongs to CAP.

Harmless root prose is allowed. Prose/refusal with no admitted call MUST close
unused authority at settlement. CAP MUST NOT introduce provider-request counts,
retry/compaction policing. Automatic read-only Reviewer admission is separate
from implementation authority. Consumed/closed claims
MUST reject new Implementer invocations. Reservation or execution ambiguity
MUST never permit reopening, another wake, replacement or direct prompt replay.

## Bounded implementation and trusted result

The installed bounded Implementer role remains distinct from the read-only
Planner and root. It MUST deny delegation, `execute`, session control and
equivalent exposed tools. The root retains only read-only tools and Planner delegation;
the trusted sponsor admits only the exact one implementation invocation.
General Orchestrator Reviewer and Committer authority remain denied. Only exact
trusted invocations receive their separate runtime sponsors.
No planning conversation is copied
to the Implementer; its deterministic prompt carries the frozen proposal.

Implementer instructions MUST require exact authorized paths, unchanged HEAD,
and no intentional reserved commit/history effects or manipulation of Git
configuration, index metadata, ignore rules, repository metadata or other
shell-accessible state to conceal changes. Direct obvious commit commands
SHOULD be denied as defense in depth. Ordinary editing, testing and development
shell access remain available. These controls are not adversarial containment.

CAP MUST forward native progress unchanged and capture the original structured
completion child ID/status before after hooks. The exact reserved message/call
and its persisted completed child ID/status MUST agree with that receipt and
the actual child's parent/role/location/authorized input/successful completion.
Root settlement must be successful for a verified outcome. Display wrappers,
content-item count, harmless metadata and host truncation are not authority
evidence; `outputPath` MUST NOT be followed as authority evidence. Nonempty
Implementer prose is not required. Ordinary recovery of the same admitted child
remains supported and grants no new admission. A recovered child's installed
editing capability is not surviving CAP authority.

Trusted code MUST independently observe canonical root and unchanged HEAD and
derive staged, unstaged tracked and ordinary untracked changed paths, excluding
ignored untracked files. Every observed path MUST exactly equal an authorized
path, including concurrent/unattributed changes and both observable rename
endpoints. Changed HEAD, invalid observation or an outside path MUST fail the
gate without amending scope or admitting a retry.

A passing implementation gate MUST close implementation authority and initiate
exactly one automatic read-only Reviewer attempt. It establishes neither
semantic satisfaction nor commit readiness, exhaustive detection of physical
mutations, or an atomic filesystem lock. Shell access can conceal changes or
perform unauthorized history effects; CAP does not claim physical prevention.
The native row/status/navigation is supplied by OpenCode. Trusted TUI status
reports the RPC verdict; uncertain results MUST NOT be labeled success.

## Automatic Reviewer contract

Reviewer MUST be a fresh native sibling under the same Orchestrator root, distinct
from Implementer. Trusted runtime MUST construct its exact task from the frozen
proposal, canonical root, unchanged authorized HEAD, exact accepted changed paths,
completed implementation identity, review-target digest and strict result schema.
Ordinary Orchestrator/Implementer prose MUST NOT initiate or authorize review.
Implementation authority MUST be closed before the sole Reviewer steer for that verified implementation cycle. A separate
one-shot admission and Reviewer-only sponsor MUST preserve original three-key
arguments, actual source IDs, fresh native execution, child identity, effective
host policy and absence of session-level overrides. No second human authorization
is needed for this bounded read-only continuation.

Reviewer MUST start from deny-all with only read/glob/grep and the bounded
read-only `reviewer_git` inspection tool. Its Git observations are advisory
review evidence and MUST NOT replace trusted scope or target revalidation.
Trusted hooks MUST prevent mutation, shell/execute, session control, delegation,
repair, staging, Commit, push or new authority even when configured policy appends allows.
Reviewer MUST NOT inherit, reopen or enlarge Implementer authority.

Trusted code MUST capture an immutable deterministic content fingerprint immediately
after implementation verification, binding root, HEAD, accepted paths, staged index
identities and actual tracked/ordinary-untracked bytes/types. The ordinary boundary
excludes ignored untracked content. Unmerged entries, Gitlinks and ambiguous or
unsupported observations MUST fail closed. It MUST independently re-observe and
compare that target after exact Reviewer settlement before accepting output.
Same HEAD and changed-path names alone MUST NOT establish target stability.

Successful review MUST bind the exact child role/parent/location/no-overrides,
bootstrap, one terminal assistant result, original structured receipt and published
parent call. Failed/interrupted or ambiguous execution MUST NOT be accepted.
The strict JSON result MUST have exactly status, nonempty bounded summary and
findings. APPROVED and INCONCLUSIVE MUST have empty findings; CHANGES_REQUESTED
MUST have 1–8 actionable blocking findings. Unknown/extra/duplicate keys, malformed
or contradictory results and target drift MUST be rejected. Reviewer findings and
approval are evidence, never Commit, repair, scope-change or implementation authority.

Worktree exclusion MUST remain held through Reviewer settlement, target
revalidation and terminal receipt publication. Previously proven Implementer
settlement MUST NOT release an unknown/running Reviewer. Unknown child settlement
MUST retain exclusion until activation teardown. Exactly one Reviewer attempt is
allowed per verified implementation cycle; failure MUST NOT launch a replacement,
retry, repair or another Implementer.
Review MUST NOT execute Commit. Only verified APPROVED MAY expose the separate
Commit / Stop decision below. No persisted review/workflow state or transcript
recovery grants authority.

## Human-authorized Repair / Stop

Only independently verified CHANGES_REQUESTED MAY create a live pending decision.
The server MUST freeze the exact result, reviewed implementation/target and
Reviewer parent message/tool, fresh child and verified terminal result identities.
Original root/location, frozen proposal, exact path ceiling and original HEAD
MUST remain transitively bound. Mutable attempts, receipt text and transcript
prose MUST NOT supply Repair authority.

After exact Reviewer settlement, target verification and factual publication,
exclusion MUST be released before the pending human decision becomes selectable.
The local Authorize transport MUST return a validated terminal-or-live-decision
outcome. The TUI MUST use a distinct post-review owner, readable exact evidence,
composer-top placement, fresh frame proof after navigation/remount/resize, and
stale-callback/surface-loss/lost-response rejection. Initial Plan ownership MUST
NOT reopen. A selection MUST carry only exact opaque decision ID plus Repair/Stop;
the client MUST NOT supply authoritative proposal, target, paths or findings.

Stop MUST retire the decision without a wake, mutation authority or filesystem
cleanup. Repair MUST spend the exact decision once before any await and create
a distinct one-shot claim. The initial NativeCap MUST remain permanently spent.
Stale, duplicate and losing selections MUST NOT close or replace a newer owner.

Repair MUST reacquire shared-worktree exclusion before its admission observations.
Busy exclusion MUST close the claim without queue, retry or restored eligibility.
Any competing governed acquisition MUST retire paused decisions and previous
current approval evidence, even when the eventual worktree is byte-identical.
Before wake and again immediately before native entry, trusted code MUST check
canonical root/location, original HEAD, exact previous target paths and digest,
original scope/integrity, root identity/role/no-overrides, exact claim/lease owner,
and supported root/control binding after awaited preparation. Existing Git scope
and ReviewTarget observations MUST be reused; names or HEAD alone are insufficient.
Unrelated pending input or root continuation MUST supersede the decision; exact
owned receipts remain non-authoritative presentation input.

The Repair claim MUST consume only at the final synchronous native-entry barrier.
Any pre-entry failure MUST launch no Implementer and restore no authority.
Unknown post-entry settlement MUST retain exclusion until safe teardown.
Each Repair MUST use a fresh authorized_implementer with the native three-key
contract, never a continuation session. Its trusted dirty-worktree prompt MUST
carry the original proposal/paths/root/HEAD and exact verified target/result/
provenance. Findings MUST NOT generate scope. Necessary unauthorized work MUST
stop and require a fresh governed Plan path, without same-root replanning,
automatic reset/stash/commit, adoption or scope expansion.

Repair verification MUST use cumulative changes from original HEAD within the
original exact path set. Changed subsets MAY differ, including new authorized
paths, removed deltas or no-op outcomes. Every verified repair MUST receive a
fresh Reviewer and new control/call/child/result identities. Prior reviews MUST
remain inert, even if target bytes match. Further CHANGES_REQUESTED MAY create
another decision, always requiring another explicit human Repair grant.
INCONCLUSIVE and unverified/ambiguous review MUST remain terminal with no Repair.

Review receipts MUST state factual target stability at verification and grant
no mutation/Commit authority. Pending decisions, unconsumed claims and retained
executors MUST be invalidated on teardown; restart MUST NOT reconstruct them from
history. Worker recovery of an already admitted child retains its existing
semantics and MUST NOT restore admission. No persisted repair count, workflow
phase, generalized retry machinery or automatic repair is introduced.

## Human-authorized Commit / Stop

Reviewer APPROVED MUST NOT imply Commit authority or Commit execution. Initial
implementation CAP, Repair grants, retained `currentReviews`, receipt text,
model prose and historical transcripts MUST NOT grant Commit. Only a fresh explicit
human Commit selection for one exact live verified APPROVED target may grant it.

After publication-time root/history/settlement and Git target revalidation, trusted
runtime MUST retain immutable approval evidence behind an opaque decision ID.
That evidence MUST bind the original frozen proposal/root/HEAD, exact implementation
identity, changed-path set and unchanged review digest, Reviewer result and
message/tool/child/result identities, and root history/settlement/event boundary.
Only the server owns that binding. The TUI presents Commit / Stop using the existing
composer-top readable-frame decision surface and sends only decision ID/action.
Stop MUST spend the decision, launch no Committer and issue no Git mutation.

Commit selection MUST spend the decision synchronously before any await, retire
retained approval eligibility, create a distinct Commit authority owner, and
reacquire shared-worktree exclusion before fresh observations. Busy, stale,
replaced or invalid authority MUST fail permanently closed. Fresh host reads MUST
recheck root creation/settlement, history, role/location/no-overrides and current
activation; fresh Git reads MUST prove original canonical root/HEAD and exact
approved target. Event invalidation and retained approval alone are insufficient.
These proofs MUST repeat after model preparation immediately before one fresh
native Committer admission. No continuation, optional model-authored keys,
background execution, new review or repair may substitute for that child.

Committer MUST be Git-only. Trusted runtime and permissions MUST deny editing,
arbitrary shell, delegation and all tools except `committer_git`, even when
configured policy appends allows. The structured tool MUST independently bind
execution to the exact live consumed Commit owner, root, approved review,
native call/control, fresh child bootstrap/history and exact published tool input.
It MUST accept only bounded operations and message text, never arbitrary command
text, paths, flags, environment, alternate repository/index or workdir.

Preparation MUST stage only the complete server-selected reviewed changed paths,
including additions/deletions, without rename-based scope expansion or hunk selection.
Before staging, the exact original ReviewTarget MUST remain fresh. Staging
intentionally changes its index component: the old digest MUST NOT be reused as
post-staging equality. Trusted code MUST instead prove the transition from approved
worktree bytes/types/modes/symlinks/deletions to exact index content and prepared tree.
All staged paths MUST equal the reviewed paths; unrelated staging, incomplete
staging, remaining ordinary untracked/unstaged delta, unsupported topology or
content transformation MUST block Commit. The full approved worktree content and
prepared tree MUST be checked again immediately before the history side effect.
Configured clean/process filters MUST fail closed before tool Git operations.

The message is bounded literal argv data; authority binds content, not one immutable
message. Trusted code MUST spend the commit attempt before spawning exactly one
normal `git commit` with fixed arguments and normal repository hooks. Amend,
no-verify, push, rebase, reset, checkout/switch, restore, stash, clean, arbitrary
Git flags and automatic retry MUST be unavailable. The fixed executable and narrow
environment MUST exclude inherited alternate Git repository/index/config variables.
Normal user configuration and hooks are preserved; hooks are external behavior.

Postflight MUST inspect actual Git state even after a nonzero process result.
Verified success MUST prove one new commit with exactly the original parent,
exact authorized changed paths, prepared tree/content, matching final index and
clean ordinary worktree plus unchanged actual approved bytes. Process exit zero
or Committer prose alone MUST NOT establish success. Hook mutation, nonzero exit,
interruption, extra history, unexpected final state or unverifiable outcome MUST
remain terminal. Failure with changed history MUST be reported as ambiguity.
No retry, amend, reset, restore, cleanup or second commit may follow. Unknown
process/child settlement MUST retain exclusion until activation teardown.

Observed Git operation facts MUST be stored before returning to interruptible
model/transport execution. One root-bound factual record MUST be finalized in
plugin storage, then published once as a non-resuming synthetic root receipt
after proven settlement. It MUST include the known commit outcome/hash/subject/paths,
Reviewer provenance and final observed state; failure MUST report a bounded reason,
known HEAD/index/worktree state and history uncertainty. Publication failure MUST
be reported without resending; unproven settlement withholds synthetic publication
while retaining durable facts. Storage failure MUST be explicit. Stored facts MUST
have no authority loader and MUST NOT restore decisions, workers or commit attempts.
No persisted Commit phase, attempt counter or recovery workflow is introduced.

Repair, competing governed acquisition, observed drift and teardown MUST retire
old approval/decisions permanently, even if bytes later match again. A repaired
implementation MUST receive a new fresh verified APPROVED review before Commit
is offered. Restart begins with zero Commit authority.
