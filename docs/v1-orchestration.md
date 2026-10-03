# V1 Orchestration

This document owns current host sequencing and implementation status.
[CAP](coding-authority-protocol.md) owns authority requirements;
[the charter](charter.md) owns purpose and scope.

## Native admission

The pinned host is OpenCode 2.0.22; live validation of this implementation on
that version remains a separate pass. The TUI keeps initial Git eligibility,
exact native Planner binding, trusted Plan publication, root return preparation,
and completed readable-frame Authorize/Cancel controls. Publication can happen
while Planner is inspected; a dirty or ambiguous initial baseline remains
planning-only. Publication uses `delivery:"steer", resume:false`.
Native Planner navigation changes the route and disposes the keyed SessionFrame
and composer slot. The TUI retains exact pending Plan ownership across this
normal disposal and requires a new readable root frame on return. Old callbacks
and frame proofs stay inert. Trusted-state invalidation and surface loss while
the root remains selected close the attempt; a positive decision still performs
all exact Planner/publication and fresh Git/location checks before transfer.

```text
clean initial Git observation → fresh Orchestrator → native read-only Planner
→ trusted frozen Plan → readable-frame positive decision
→ transfer immutable claim through local Authorize RPC
→ one synthetic control, delivery:steer, resume:true
→ first authorized-root tool contender reserves synchronously
→ canonical native subagent + exact original/decoded arguments
→ fresh root role/location/permissions + valid scope paths + Git root/HEAD/clean
→ consume → original native executor with private sponsorship actor
→ native child creation/prompt/progress/result/row/navigation
→ root settlement → trusted native receipt + child/result binding
→ unchanged HEAD + exact changed-path gate → STOP before Reviewer / Commit
```

The trusted TUI is the intended producer of Authorize claims. Same-user local
processes and localhost OpenCode RPC access belong to the trusted host boundary;
RPC caller origin is not independently authenticated. CAP is not an OS/process
sandbox. Authorize is a concrete local RPC, not a model tool; there is no
handshake, credential, enrollment, authentication, status protocol or recovery
store. The server copies/freezes the verified TUI claim and checks integrity;
it does not reconstruct the Planner or publication history after transfer.

Issue #9 preserves **one governed implementation attempt per plugin activation**.
Multiple sequential authorized attempts within an activation are out of scope.
The server occupies its only slot before any RPC await. Subsequent submissions,
including lost-response retransmission and submissions after successful or failed
completion, are rejected throughout that activation.

## Host boundaries

### Planner exploration

Planner may use zero, one, or multiple fresh native `explorer` children to
investigate existing mechanisms, viable approaches, constraints, and trade-offs.
Planner owns orchestration: independent foreground `subagent` calls may be
issued together in one response and execute through OpenCode's native tool
concurrency; dependent follow-ups may be issued after earlier findings return.
The host returns completed findings into Planner's ordinary tool-result/model
context and provides native child-session navigation. Project `opencode.json`
sets `experimental.subagent_depth: 2` for Orchestrator → Planner → Explorer.

Planner allows only read/glob/grep and `subagent:explorer`; Explorer allows only
read/glob/grep and cannot delegate or implement. Calls contain exactly `agent`,
`description`, and `prompt`, with no continuation, model override, or background
key. Background/running results and later synthetic notifications are unsupported.
There is no custom scheduler, join state, result store, or Explorer workflow state.

When accepting the planning execution before publication, trusted code verifies
completed calls against their unique fresh Explorer children, exact bootstrap,
role, parent, location/workspace, empty permission overrides, successful idle
history, and read-only tool allowlist. Complete native child listing must match
the call set exactly, and each Explorer must have no descendants. Verification
accepts multiple foreground calls in one response without execution-order
conditions. Malformed calls, incomplete/failed results, forbidden activity, or
unexpected children observed during this verification prevent publication.
Unsupported synthetic/system/compaction history still fails closed, including
native nested instruction injection; this does not expand supported histories.
Native result normalization/truncation need not match full child prose byte for
byte.

Explorer is advisory planning provenance. OpenCode captures its completed
foreground result and persists returned content in Planner's own tool history;
subsequent Planner model requests consume that content. Later child history or
policy changes cannot retroactively change that result without a separate
Planner-history mutation. Planner owns synthesis. Trusted code binds the exact
final Planner proposal, its input/final identities, and the existing root-request
and native Planner-call evidence; only that proposal becomes Plan authority.
No separate Explorer identity, findings, history, or topology evidence enters
`Bound`, the candidate, CAP state, or the Authorize RPC payload.

Publication severs ongoing Explorer session liveness from authorization authority.
The provenance reads are admission observations, not an atomic snapshot or a
promise that every advisory child stays idle and unchanged. Even between a child's
last verification read and publication, unrelated later child activity cannot
change the findings already returned to Planner or its accepted final proposal.
No Explorer watch, event synchronization, or freshness fence is required.

Authorization revalidates authority-bearing state: the exact root request and
Issue #11 effective-input receipt; root/Planner identity, location, supported
history, bootstrap and exact final proposal; candidate integrity; exact pending
Plan and displayed publication; repository root/HEAD and Git freshness; and the
existing one-shot decision ownership. Explorer sessions are not reopened.
Root/Planner task, policy, location, and direct history-mutation events continue
to close local authority before transfer. These notifications supplement trusted
reads; they do not create an Explorer lifecycle or a host-ordered freshness fence.

### Implementation admission

[`server.ts`](../.opencode/plugins/opencode-agents/server.ts) is the Effect entry.
[`authorize-rpc.ts`](../src/authorize-rpc.ts) defines the local Authorize RPC.
[`cap.ts`](../src/cap.ts) owns the private claim, control ID/text, phase,
message/call reservation, and native child/result receipt.
[`native.ts`](../src/native.ts) hosts the native admission adapter.

Cancel sends neither RPC nor wake. Before transfer, the exact TUI decision and
initial publication checks remain active. After acceptance the server owns the
attempt; route changes, resize and TUI disappearance cannot resend it or revoke
it synchronously from another process. The RPC awaits root settlement and
returns the trusted gate outcome. Lost responses remain uncertain in the TUI.

The before hook reserves the first root contender before reads. Unexpected tools,
aliases and malformed input burn it; concurrent losers cannot alter its owner.
Supported server `session.context` reads inspect the actual published tool input
and exact preceding control. The before hook performs early reservation/tool
veto; the executor compares both original published and host-decoded arguments
with the frozen contract in one final admission. Native schemas and validation
remain untouched, including for ordinary Planner calls. Parser-failed published
tool parts count as contenders even when they skip before hooks. Provider JSON
recovery alone is not an authority decision.

The TUI retains semantic request/call/child/proposal identities rather than full
serialized histories, selected models or generic metadata. Decision-time server
reads verify those facts and no added input. Its finite visible window must
contain the exact Plan, not duplicate full server history. Paths in the trusted
Plan use quoted ASCII JSON labels and a count; controls and Unicode formatting
characters cannot turn one filename into multiple scope entries. Dangling final
symlinks fail closed, including when path topology changes after transfer.
Initial, publication/presentation, decision, server release and result Git
observations remain independent; local ownership/revocation checks follow awaits.

Independent awaited admission reads finish before the final root observation
and synchronous local/path/Git checks and consumption. No session/root
permission is elevated. The installed root still denies Implementer. A hidden,
nonselectable sponsorship actor has deny-all plus only
`subagent:authorized_implementer=allow`. The wrapper substitutes the native
execution actor while preserving parent/message/call IDs and progress. The
original executor owns all child scheduling and lifecycle.

This composition is an explicitly pinned OpenCode 2.0.22 internal dependency:
native target permission is asserted before child creation using the explicit
actor and real parent/source IDs; permission selects that actor ahead of the
session agent, merges session overrides and rejects effective configured deny
before hooks. The sponsor-only deny hook bounds effective allows to the exact
target and turns ask into deny. Native effective deny/ask creates no child even
though the one-use claim has already been consumed. Whole sponsor-rule arrays
and unrelated metadata are not admission fingerprints. Installed role/tool
policies must remain correctly configured; this is a trusted deployment
assumption. Parent freshness is a late observation, not a lock through all native
operations after consumption.

OpenCode owns Implementer child creation, execution, lifecycle, row and
navigation. `opencode-agents` owns the narrow one-use CAP admission and the
independent Git/result gate. The pre-after-hook structured completion child
ID/status, exact reserved persisted call and actual successful child
parent/role/location/authorized input must agree. Display wrappers,
content-item count, harmless metadata, truncation
and nonempty Implementer prose do not decide authority. A separate fresh Git
observation verifies unchanged HEAD and exact changed-path membership.
The root must settle successfully before a verified outcome is returned. Harmless
prose is allowed; refusal/prose without admission closes unused authority.
There is no provider-request counting, retry/compaction policing, or follow-up
orchestration. If the required control/call evidence is no longer readable,
verification fails closed.

Failure, ambiguous wake/reservation/execution, settlement and teardown never
reopen authority, issue another wake, create a replacement, or replay a prompt.
Retained executor closures reject after server teardown. The installed bounded
Implementer role and ordinary recovery of the same admitted child remain native.
Restart cannot reconstruct a CAP claim from transcripts; recovery is not a new
CAP admission. Lost verification never becomes verified success. Reviewer and
Commit remain unauthorized.

Native creation inherits the root's full location, including workspace identity.
A supported attempt still needs proven canonical local Git/worktree
correspondence. This is not remote topology attestation, an external filesystem
lock, or exhaustive shell-effect detection.

## Validation and status

Issue #9 implementation is covered by trusted transport, host, executor,
Git-observer and JSX doubles. Coverage includes initial binding/publication and
readability, malformed-first calls, raw/decoded drift, stale evidence, concurrency,
replay, refusal, transport/execution ambiguity, teardown, result binding,
same-child recovery, and second-claim rejection after success and failure.
The read-only source guards in `test/native-compatibility.test.ts` require the
selected sibling `../opencode` checkout and check the pinned actor/permission
ordering seam. They complement effective-policy doubles and do not replace live
host validation.
Real Git tests remain confined to Git semantics in `test/git.test.ts`, using
immutable seeds and private copies. Production Git observations remain fresh.

The implementation validation commands are:

```sh
bun run typecheck
bun test test/cap.test.ts
bun test test/attempt.test.ts
bun test
git diff --check
```

### Live validation on OpenCode 2.0.21

The final live dogfood began with a clean Git baseline and a native Planner.
The trusted Plan preserved the exact `README.md` scope and bound HEAD. Navigating
into and out of Planner preserved pending authorization, while returning to the
root required a fresh readable frame. An explicit Authorize decision admitted
a genuine native `authorized_implementer` subagent row and session. The native
Implementer received the frozen proposal and exact path scope. Implementation
changed exactly `README.md`; HEAD stayed unchanged, the trusted Git gate passed,
and execution stopped before Reviewer / Commit. In a separate check after
Planner completion, Cancel admitted no Implementer and left the worktree clean.

Reviewer, reviewed-target construction and Commit are future work.

Historical OpenCode 2.0.20 dogfood and Issue #4 resize results describe prior
paths, not validation of this native path. See the retained
[Issue #4 dogfood](history/issue-4-live-dogfood.md),
[Issue #6 investigation](history/issue-6-post-authorization-implementer-creation-investigation.md),
and [Issue #9 investigation](history/issue-9-native-cap-minimum-investigation.md).
Issue #9's approved minimal scope supersedes its investigation's proposed
enrollment, scoped Implementer hosting and provider-request policing.
Issue #8's custom-row work is superseded by native presentation.
