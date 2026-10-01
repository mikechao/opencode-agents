# Coding Authority Protocol — V1

## Contract and implementation boundary

This document owns the normative coding-authority contract for
`opencode-agents`. **MUST**, **MUST NOT**, and **SHOULD** express requirements.
[Orchestration](v1-orchestration.md) owns actual host/runtime sequencing;
[the charter](charter.md) owns project goals and non-goals.

The live TUI publishes an exact trusted Plan, accepts only the direct local
human Authorize/Cancel decision, and on Authorize creates one empty authorized
implementation child before final one-use prompt admission. The result must
pass unchanged HEAD and exact changed-path scope checks and STOP before
Reviewer / Commit. Reviewer and Commit contracts below remain future obligations.

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

The trusted computing base is the installed OpenCode host/TUI, installed
integration and CAP kernel, trusted role/tool enforcement, and local
OS/user-account boundary. The supported topology is ordinary local OpenCode;
local worktree correspondence is not general same-machine or remote topology
attestation. V1 does not defend against compromised trusted components,
hostile code already inside them, deliberate same-user modification of them,
or OS/TCB-originated synthetic input. It does not require physical-human
attestation or general filesystem isolation.

Only the trusted UI decision bound by the kernel to its exact frozen candidate
may enter the authorization path. The UI presents and returns a decision;
the kernel constructs candidates, binds decisions, checks freshness, interprets
purpose, and creates and consumes authority. Agents may request presentation
but are not authority sources. Git and validation supply observations or
bounded effects, never grants.

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

## Human decision and process-local grant

Authorization requires an explicit affirmative trusted human decision for the
exact immutable candidate/scope, not a pre-existing worker identity. Before that
decision there MUST be no implementation child or Implementer native row. Cancel,
missing/ambiguous decisions, and stale or invalid decisions caught before
creation MUST create no implementation child and dispatch no prompt.

The live decision is a root-only unregistered local pointer closure for
Authorize/Cancel. It MUST require exact pending ownership, trusted revalidation,
and a fresh completed readable-frame proof. The Plan can publish while Planner
is inspected; exact-root return MUST prepare the same retained object once and
require a fresh root frame. Pending resize invalidates readiness until a fresh
valid frame. An exact positive claim synchronously removes decision callbacks;
post-claim resize is presentation-only, while route/location/evidence/liveness
guards remain enforced. Duplicate/stale callbacks MUST NOT admit another child.
Model-mediated affirmation, conversation replies, model-callable Form/Question
responses and generic permissions MUST NOT serve as CAP authorization.

All candidates, decision bindings and usable capabilities MUST remain in the
active installed TUI plugin generation's activation-private process state.
Cleanup MUST synchronously revoke that generation before other cleanup or
awaited work. Authority-bearing continuations MUST check revocation after
each await and immediately before grant creation, consumption or governed
effect. Reloaded, restarted or later generations MUST start with zero authority.

An intent grant binds the exact candidate digest and purpose `implement` and
permits one bounded attempt. Trusted state MUST consume it once at admission,
immediately before the exact implementation prompt. It cannot be reused,
reactivated or transferred to another purpose. Current grant objects are
ordinary trusted process objects: generation confinement and guarded callers
supply the boundary, not cryptographic generation attestation.

Durable/session/server/MCP records MAY support audit or diagnostics, but MUST
NOT create, restore, reactivate or substitute authority, a current UI result,
or fresh observations. A fake or corrupted record cannot grant anything.
A later attempt inherits no approval, review, validation or repair authority.

## Roles, bounded implementation and failure

Orchestrator, Planner and Implementer MUST have distinct role contexts;
handoffs use explicit artifacts and trusted references, not another role's
conversation or reasoning context. The root MUST make exactly one fresh native
Planner call and end its turn. It MUST NOT make an implementation call or be
resumed after trusted Plan publication. No Planner conversation is copied into
root or Implementer.

Trusted code MUST bind the exact child, admitted input and result; the
Implementer receives the frozen proposal directly without Planner context.

The Orchestrator MUST allow only the intended read-only native delegation
target (Planner) and MUST NOT create or continue an authorized Implementer or
expose model-callable mutation/session-control routes. Read-only roles MUST deny
mutation routes. The authorized Implementer MUST deny delegation, `execute`,
session-control and equivalent exposed tools that could admit another
model-controlled turn or switch roles. These role permissions do not grant
CAP authority or constitute a shell sandbox.

Planner, Implementer and eventual Reviewer instructions MUST prohibit
intentional reserved final commit/history effects. Implementer instructions
MUST require exact authorized-path scope and prohibit intentional manipulation
of Git configuration, index metadata, ignore rules, repository metadata or
other shell-accessible state to conceal changes or evade ordinary observation.
Permissions SHOULD deny obvious direct reserved operations as defense in
depth. Agent compliance is not trusted evidence; these controls are not an
adversarial shell containment boundary.

After exact positive claim and full pre-creation validation, trusted code MUST
invoke exactly one empty `context.client.session.import` directly as
`authorized_implementer`. This is the narrow experimental empty-child seam on
pinned OpenCode 2.0.21, whose public `session.create` cannot represent parenting.
It MUST use a fresh locally generated ID, exact root parent, frozen explicit
server-root-selected model/variant, exact supported local location/project/subpath,
trusted inherited family metadata, empty permission overrides, zero cost/tokens,
no terminal/idle/viewed/archive/fork/revert state, and `messages: []`.

Only ordinary local topology is supported. Workspace-bound attempts MUST fail
closed before creation with a precise reason: public create/import cannot
represent `workspaceID`. Trusted code MUST NOT cast away or partially compare
workspace/location identity. Root explicit model evidence MUST agree with root
assistant execution evidence, with host `default` variant normalization. Missing
or changed evidence MUST fail closed; no model fallback is allowed. Loaded
implementation role model overrides or policy drift MUST be rejected; trusted
catalog reads MUST establish availability and named variant support.

Response and independent host reads MUST verify exact child identity, parent,
role/model/location/project/subpath/metadata/permissions, fresh stable creation
identity, empty inbox/history and no active execution. Import `time.created` is
caller initialization evidence, not host timestamp attestation; host import
`time.updated` MUST be finite and at or after initialization. Created echoes
MUST match shared fields with exact host projection normalization (implicit
`default` variant and empty project-root subpath), without equating event commit
time with supplied creation time. Bounded worker evidence belongs to this claimed continuation,
not durable workflow state or the authority-bearing candidate.

After creation/readback, trusted code MUST fully revalidate root, Planner,
publication, candidate, model/policy, location and fresh clean Git, recheck the
empty child, and cross the final complete trusted barrier. Only then may it
consume the candidate-bound one-use grant immediately adjacent to the sole
exact child's prompt invocation, with no intervening await, host call or UI action.
Exact admitted input and complete successful result/model/identity evidence MUST
be independently verified and frozen across later evidence reads.

Implementation may use ordinary editing, testing and development shell capability;
CAP does not authorize every transient filesystem mutation. A direct-created
child may possess editing capability even if a later barrier fails while it is
still empty. That host capability is not surviving CAP authority: no trusted
prompt was dispatched, no grant may be reused, and no replacement may be created.
Persistent editing capability after an admitted turn likewise cannot restore
its consumed grant. A later manual/external prompt by a local human or trusted
client is outside the governed CAP admission.

HEAD MUST remain the bound baseline through implementation. After completion,
trusted code MUST independently verify canonical root and unchanged HEAD and
derive ordinary Git changed paths: staged, unstaged tracked and ordinary
untracked paths, excluding ignored untracked files. Every observed path MUST
exactly equal an authorized path, including concurrent/unattributed changes.
Both rename endpoints MUST be authorized when both are observable.

Changed HEAD, unverifiable root/observation or any out-of-scope path MUST end
the attempt without a passing gate. Scope MUST NOT be amended in place.
A passing gate stops before Review/Commit and does not establish semantic
satisfaction, an exact reviewed target, commit readiness or complete detection
of physical mutations. Ordinary shell access can conceal mutations or cause
unauthorized history effects; CAP claims neither exhaustive detection nor
physical prevention of those effects.

Ordinary failures terminate the claimed attempt irreversibly. Creation rejection,
timeout, transport ambiguity, collision, malformed/mismatched response, empty-
state failure, or later evidence drift MUST cause no trusted prompt and no retry,
same-ID replay, replacement, adoption, deletion, or role restoration. Discovery
of a child after ambiguous creation MUST NOT permit continuation. An unused
grant MUST NOT be resurrected. Final-barrier failure may leave one empty child
and zero trusted prompts. Prompt ambiguity MUST consume the grant and never
resend. Result/Git failure MUST admit no passing gate or retry.

Persistent trusted status MUST distinguish pre-creation failure (no child or
prompt), unknown creation outcome (child may remain, no prompt/no creation retry),
failed child admission (child may remain, no prompt/no creation retry), and
post-prompt ambiguity (implementation may have started, no resend). Status and
native child navigation MUST NOT fabricate a root Implementer tool row or resume
the root model. A later explicit attempt derives current repository reality and
requires a fresh Planner proposal and fresh trusted human authorization.

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
