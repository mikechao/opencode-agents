# Coding Authority Protocol — V1

## Contract and implementation boundary

This document owns the normative coding-authority contract for
`opencode-agents`. **MUST**, **MUST NOT**, and **SHOULD** express requirements.
[Orchestration](v1-orchestration.md) owns actual host/runtime sequencing;
[the charter](charter.md) owns project goals and non-goals.

The TUI publishes an exact trusted Plan and claims one positive readable-frame
Authorize decision. It transfers the frozen claim to a local server RPC for
one native Implementer admission. Trusted native result binding and independent
unchanged-HEAD/exact-path verification must pass before STOP. Reviewer and
Commit remain future obligations.

Issue #9 preserves **one governed implementation attempt per plugin activation**.
Multiple sequential authorized attempts within an activation are out of scope.

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
permitted. Existing final directories and final symlinks resolving outside
the worktree are rejected; resolvable internal final symlinks are permitted.
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
The same retained Plan may publish while Planner is inspected; root return
MUST revalidate it and require a fresh root frame. Pending resize invalidates
readiness until a new valid frame. The positive click synchronously claims the
exact object and removes callbacks. Cancel MUST send no RPC and no wake.
Model replies, Form/Question answers and generic permissions MUST NOT authorize.

The TUI MUST preserve initial clean eligibility and verify the published Plan
and native Planner binding before transferring its immutable claim. The claim
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
preceding exact control input. Original arguments MUST be checked before native
decoding because native normalization can remove empty optional properties.
A strict input adapter and final executor comparison MUST retain the exact
contract. Missing, stale or ambiguous control/call evidence MUST fail closed.
Whole post-authorization planning histories and pending-Plan equality are not
required; initial verification stays in the TUI.

After all awaited admission reads, the final synchronous barrier MUST verify
current root role/location, absence of session permission elevation, intact
claim, exact reservation, valid paths, canonical Git root, unchanged HEAD and
continued cleanliness. Consumption MUST occur immediately before invoking
the original native executor. The server MUST use one hidden, nonselectable
sponsorship actor with deny-all plus only
`subagent:authorized_implementer=allow`. Only the execution actor is substituted;
parent/message/call/progress identities and native lifecycle remain intact.
Root static Implementer denial and session permissions MUST NOT be mutated.
OpenCode's later ConfigAgentPlugin appends global and configured rules to existing
agents. The server MUST inspect the final sponsor definition before consumption.
A sponsor-only, deny-only permission hook bounds appended allows to the exact
Implementer delegation; it MUST NOT elevate a host deny or ask. Appended denies
or asks fail closed before consumption, except the host's unrelated browser deny.
Changed sponsor identity, visibility, mode or original rule prefix also fails
closed. No root/session permission override or additional permission lifecycle
is introduced.

The original native executor MUST create/prompt/run the child and own native
progress, result projection and presentation. No imported child, caller child
or prompt IDs, empty-child barrier, import echo, usage/time initialization or
direct implementation prompt dispatch belongs to CAP.

Harmless root prose is allowed. Prose/refusal with no admitted call MUST close
unused authority at settlement. CAP MUST NOT introduce provider-request counts,
retry/compaction policing or follow-up orchestration. Consumed/closed claims
MUST reject new Implementer invocations. Reservation or execution ambiguity
MUST never permit reopening, another wake, replacement or direct prompt replay.

## Bounded implementation and trusted result

The installed bounded Implementer role remains distinct from the read-only
Planner and root. It MUST deny delegation, `execute`, session control and
equivalent exposed tools. The root retains deny-all except Planner delegation;
the trusted sponsor admits only the exact one implementation invocation.
Reviewer and Commit remain unauthorized. No planning conversation is copied
to the Implementer; its deterministic prompt carries the frozen proposal.

Implementer instructions MUST require exact authorized paths, unchanged HEAD,
and no intentional reserved commit/history effects or manipulation of Git
configuration, index metadata, ignore rules, repository metadata or other
shell-accessible state to conceal changes. Direct obvious commit commands
SHOULD be denied as defense in depth. Ordinary editing, testing and development
shell access remain available. These controls are not adversarial containment.

CAP MUST forward native progress and capture the original result. Native child
ID, progress receipt, output, metadata, persisted call result and actual child
parent/role/location/input/successful completion MUST agree. Root settlement
must be successful for a verified outcome. Ordinary recovery of the same
admitted child remains supported and grants no new admission. A recovered
child's installed editing capability is not surviving CAP authority.

Trusted code MUST independently observe canonical root and unchanged HEAD and
derive staged, unstaged tracked and ordinary untracked changed paths, excluding
ignored untracked files. Every observed path MUST exactly equal an authorized
path, including concurrent/unattributed changes and both observable rename
endpoints. Changed HEAD, invalid observation or an outside path MUST fail the
gate without amending scope or admitting a retry.

A passing gate MUST STOP before Reviewer / Commit. It establishes neither
semantic satisfaction nor commit readiness, exhaustive detection of physical
mutations, or an atomic filesystem lock. Shell access can conceal changes or
perform unauthorized history effects; CAP does not claim physical prevention.
The native row/status/navigation is supplied by OpenCode. Trusted TUI status
reports the RPC verdict; uncertain results MUST NOT be labeled success.

## Future Reviewer and separate Commit contract

Reviewer, exact reviewed-target construction, validation integration and Commit
are not implemented. A future Reviewer MUST be a fresh invocation distinct
from Implementer and Orchestrator, receiving explicit bounded artifacts rather
than inherited Implementer context. Independence does not require a separate
process or model family. Trusted code MUST bind passing independent review
and successful Reviewer-owned validation to that invocation and exact target.

Reviewed-target commit authority MUST be distinct from intent authority. Its
candidate MUST bind passing review, exact reviewed target or unambiguous digest,
Reviewer-owned validation, exact prepared paths, relevant Git baseline and
readable commit intent. It authorizes neither edits nor a substitute target.
The candidate MUST be frozen and digested, and the fresh trusted human decision
MUST be bound to that exact candidate.
Trusted code MUST verify those facts, recheck freshness immediately before the
effect, consume separate one-use commit authority, perform only the bounded
commit and verify the resulting Git outcome independently of agent claims.

Ambiguous commit completion permits only read-only reconciliation while the
trusted process remains alive; the consumed capability MUST NOT be replayed.
Process death ends the run. Later work starts with zero authority, inspects
current Git reality and requires fresh authorization for any further effect.
Subsystem design and host sequencing remain future work in orchestration.
