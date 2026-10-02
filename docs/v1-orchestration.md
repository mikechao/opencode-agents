# V1 Orchestration

This document owns current host sequencing and implementation status.
[CAP](coding-authority-protocol.md) owns authority requirements;
[the charter](charter.md) owns purpose and scope.

## Native admission

The pinned host is OpenCode 2.0.21. The TUI keeps initial Git eligibility,
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
and exact preceding control. Original input is checked before native decoding,
including optional empty fields that the native hook may remove. The schema
adapter preserves the native decoder and compares authority-bearing input before
it can drop extras; the executor makes a final comparison.
The pinned 2.0.21 input contains only validated data, without decode transforms or
constructor defaults. Its schema-owned public maker keeps validation within the
host's bundled Effect parser; the plugin must not compile that AST with its own
Effect instance. JSON-schema conversion uses a detached schema object. Ordinary
Planner calls retain native validation and invocation identities without sponsor
substitution or shared-schema mutation.

All awaited admission reads finish before synchronous local/path/Git checks and
consumption. No session/root permission is elevated. The installed root still
denies Implementer. A hidden, nonselectable sponsorship actor has deny-all plus
only `subagent:authorized_implementer=allow`. The wrapper substitutes the native
execution actor and forwards progress while preserving real parent, message and
call identities. The original executor owns all child scheduling and lifecycle.
ConfigAgentPlugin runs after external plugin registration and appends rules to
existing agents. Admission reads the final sponsor definition before consumption;
appended denies/asks or changes to its original policy, hidden status or mode
close admission (the built-in browser deny is harmless). A sponsor-only deny hook
constrains appended allows to the exact Implementer target and never overrides
a host deny or ask. Root/session permissions remain untouched.

OpenCode owns Implementer child creation, execution, lifecycle, row and
navigation. `opencode-agents` owns the narrow one-use CAP admission and the
independent Git/result gate. The returned native output, progress child ID,
metadata, persisted call result, and actual successful child
parent/role/location/input/result must agree. A separate fresh Git observation
verifies unchanged HEAD and exact changed-path membership.
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
[Issue #4 dogfood](issue-4-live-dogfood.md),
[Issue #6 investigation](issue-6-post-authorization-implementer-creation-investigation.md),
and [Issue #9 investigation](issue-9-native-cap-minimum-investigation.md).
Issue #9's approved minimal scope supersedes its investigation's proposed
enrollment, scoped Implementer hosting and provider-request policing.
Issue #8's custom-row work is superseded by native presentation.
