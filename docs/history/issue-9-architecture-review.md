# Issue #9 architecture review against OpenCode 2.0.22

**Historical evidence.** This completed investigation is non-normative. Its
findings and recommendations describe the recorded revisions, not current
implementation status. See the [current documentation map](../README.md).

Date: 2026-10-02. Review baseline: project HEAD `a616fd1d4c294de038aeab3bf724d5c8ae7e7b8a`; local OpenCode `v2.0.22`, commit `527f0b931d1f9b3ebd34e106c51b31ce5db5b075`.

Inputs: [the compatibility check](https://github.com/mikechao/opencode-agents/blob/b213749fb3f80932df11bba6f4f9bda56fd78405/docs/issue-9-opencode-2.0.22-compatibility-check.md), [the original #9 investigation](issue-9-native-cap-minimum-investigation.md), [CAP](../coding-authority-protocol.md), [orchestration](../v1-orchestration.md), [the charter](../charter.md), implementation and tests. The investigation is historical: its enrollment, scoped writable role and provider policing proposals are not requirements of the approved implementation. The investigation now lives under `docs/history/`, rather than the path in the task description. The compatibility report describes an earlier project revision; this review reads the current files directly.

This is a static architecture/security review, not another release diff or live validation. No OpenCode or Docker was launched; no implementation, tests, configuration or dependency files were edited. Two small direct evaluations of `proposal.ts` confirmed the filename and dangling-symlink findings below; the latter used a temporary non-Git fixture that was removed. The test suite and typecheck were not run. Only this report was added.

Source citations give file, symbol and current line ranges. Host links refer to the read-only local checkout at the revision above. An exported API is classified as supported without implying a perpetual compatibility guarantee. Recommendations describe a future change; current normative wording remains in force until its owner document is updated.

## 1. Executive Verdict

**Correctness: the one-use native admission kernel is sound under the declared local TCB, but the complete architecture does not establish every claimed CAP property.** It mechanically binds a frozen proposal to at most one native invocation, leaves root/session authority unchanged, consumes before calling the native executor, and never reconstructs grants from durable history. Two confirmed gaps prevent an unconditional soundness verdict:

1. Accepted filenames do not have an unambiguous trusted human presentation. A newline in one authorized path can render as two scope entries.
2. An existing dangling final symlink can pass the path validator, including one targeting an absent file outside the worktree. This contradicts the intended distinction between a missing new file and a permitted resolvable internal symlink.

The freshness review also identifies a saved-root observation followed by a sponsor Effect read. The actual local sponsor lookup is synchronous: this is an ordering/contract concern, **not an established suspended-read bypass**. Do not add another validation barrier merely because an async test double can manufacture that state. Neither confirmed gap is caused by the 2.0.22 upgrade or repaired by stricter native wrappers/provider JSON rejection.

**Necessity: we would rebuild the same core design, with smaller adapters.** Keep trusted TUI authorization, a local one-shot claim transfer, a server-owned reservation/consume boundary, one native continuation and native executor sponsorship, followed by independent result/Git verification. Do not restore the historical imported-child, enrollment, recovery-store or provider-request machinery. The accepted always-installed Implementer/recovery behavior is materially narrower than the original investigation's proposed lifetime guarantee and must remain explicit.

**Simplicity: yes, the validation perimeter is over-engineered.** The overall orchestration choice is appropriately small. The excess lies in revalidating the same invocation at three input layers, replacing the host's decoder, exact presentation-wrapper/metadata equality, whole serialized and visible-history equality, sponsor policy-array fingerprints, and duplicate publication reconciliation. These freeze representations without providing additional scope or authorization integrity.

**Before live 2.0.22 dogfood, make the focused scope/presentation corrections and the boundary simplifications described below.** A wholesale rewrite is unnecessary. The core claim/reservation/Git boundaries should survive unchanged in meaning. Low-value state tidying can wait; eliminating the custom codec and structural sponsor read directly reduces fragile host dependencies and leaves less work after the final root observation.

This verdict assumes installed role/tool policy is trusted and correctly configured. It does not certify hostile shell containment, physical-human authentication, arbitrary local clients, or revocation of an already-running child on restart. Those are outside the current contract, not protections supplied by #9.

## 2. Security / CAP Invariant Review

### Exact scope and understandable authorization

Current enforcement: [proposal.ts](../../src/proposal.ts), `parseProposal`/`exactFile:20–76`, preserves exact strings and ordered unique paths; [git.ts](../../src/git.ts), `observeGit`/`requireInScope:35–72`, compares ordinary staged, unstaged and untracked changed paths by exact membership. The server revalidates paths immediately before consumption, independently of Git cleanliness. There is no scope widening, prefix matching or model-derived success allowance.

**Assessment:** exact path membership is sound for the observed Git delta; two pre-admission scope defects need correction.

*Presentation:* `exactFile` rejects NUL but accepts newline and other display-sensitive characters. `renderPlan:90–105` interpolates each path directly as `• ${file}`. Direct evaluation accepted the single path `review-example.txt\n• second.txt`, then displayed:

```text
Exact files
• review-example.txt
• second.txt
```

That is also the display of two separate ordinary paths. The presentation is not an injective rendering of the authorized scope. Stored candidate integrity and whole visible-store equality preserve the ambiguous text exactly; neither makes the decision informed. The unused production `candidateMessage:108–120` quotes paths, while its tests give the misleading impression that this is the active confirmation surface. The actual native synthetic notice displays `description`, not raw JSON `text` ([host session route](../../../opencode/packages/tui/src/routes/session/index.tsx), `SessionNoticeMessageV2:1947–1984`). Access to an expandable earlier Planner result is not a substitute for unambiguous trusted scope labels.

The smaller guarantee is to display an escaped, unambiguous representation of each exact path without changing its authorized bytes. Cover control and formatting characters, not just normal filenames. A file count helps, but does not replace escaping.

*Dangling symlink:* `exactFile:40–48` catches `ENOENT` from both `lstatSync` and `realpathSync` as if the final path did not exist. An existing final symlink with an absent outside target therefore passes. A temporary fixture with `root/dangling.txt` pointing to `absent-outside.txt` outside `root` confirmed acceptance. If a clean tracked dangling link is followed by development code, creation of its outside target need not change any observed repository path. This is ordinary path-resolution behavior, not an adversarial Git concealment technique. Separate a missing final entry from an existing link whose target cannot be proven internal; reject the latter. Retain the ancestor and final-link checks.

CAP remains an admission and observed-outcome boundary: broad shell/edit capability does not physically confine effects to the path array. The explicit limitations on ignored files, concurrent changes, shell concealment and atomic filesystem locking are honest. The two findings concern guarantees the validator/presentation actually undertakes, rather than adding sandbox requirements.

### Immutable intent and proposal identity

Current enforcement: exact proposal shape/text, frozen copies, canonical encoding/digest, original root/HEAD, deterministic implementation prompt; TUI retained-evidence checks; server `NativeCap.accept` and final exact-argument comparisons ([cap.ts](../../src/cap.ts), `57–100`; [native.ts](../../src/native.ts), `23–32,106–124`).

**Assessment:** sound. A digest is never used as a grant. Caller mutation cannot change the copied server claim. Prompt equality includes the whole frozen proposal, scope, root and HEAD. The original path order and proposal text remain intact.

Exact authorized text must survive. Exact enclosing transcript JSON, native XML-like wrappers, incidental metadata and an identical selected model are not the same invariant. Freeze once at each trust/transport crossing, retain integrity verification at transfer/admission, and compare the authority-bearing projection. Recomputing integrity repeatedly inside a trusted deeply frozen object adds little; path validity is different because the filesystem can change and must be reobserved.

### Explicit human authorization and transfer

Current enforcement: [tui.tsx](../../.opencode/plugins/opencode-agents/tui.tsx), `decide:140–173`, requires current pending-object identity, root view, completed frame proof and the pointer callback. It claims synchronously before asynchronous checks. Cancel sends no Authorize RPC or wake. `authorizePublishedAttempt:374–390` rechecks the trusted artifact and clean eligibility before transferring its claim.

**Assessment:** sound within the expressly declared trust boundary, subject to the filename presentation gap. The readable-frame proof measures the decision strip, worktree/binding/question/buttons; it does not prove that every line of the Plan has been seen. Human comprehension is not mechanically attested. The important achievable guarantee is an accessible exact trusted Plan and a readable, correctly bound explicit control.

Authorize RPC has object input/string output and **no independent TUI principal or credential**. `publicationID` is copied but not checked against server planning history; the server trusts the TUI's verified claim. A local caller can construct an integrity-valid candidate without clicking. That is not prevented by #9 and is outside the current TCB contract. Read-only root/Planner policy must prevent model-driven RPC/shell/session-control access; the RPC is not registered as a model tool. No secret handshake should be added to pretend to authenticate a hostile same-user process: the writable child's shell access already crosses that stronger boundary. A stronger threat model would require a different upstream/OS boundary.

The server need not reconstruct the TUI's planning and publication proof. Its job is to freeze the complete transferred candidate and enforce the exact native effect. A claim ID or publication hash alone would be insufficient.

### Freshness: root, HEAD, proposal, permissions and path topology

Current enforcement: initial read-only canonical Git observation before fresh-root creation; strict creation timestamp ordering; clean eligibility cannot be regained by later cleaning. Publication reobserves the original root/HEAD/path set. The click requires current clean state. Server acceptance and final execution each independently observe Git; final `local()` revalidates scope topology. Post-run observation independently requires unchanged HEAD and exact changed paths.

**Assessment:** Git/intent freshness is sound as observation, not an atomic repository lock. Keep initial eligibility, click freshness, server final freshness and post-run observations. Removing any of these permits a genuinely different stale baseline or outcome. Repeated observations after every unrelated TUI await are more frequent than these distinct security boundaries require; reducing them needs preservation of lifecycle invalidation and a final fresh check, never a cached production observation.

**Root observation ordering and its limit:** `execute:107–124` reads history, then `session.get(root)`, then yields `agent.get(sponsor)`. Its final `rootIdentity(root)` examines the saved root. The host [SessionStore](../../../opencode/packages/core/src/session/store.ts), `get:95–98`, returns a row-derived snapshot, not a live projection. However, the actual current-location [host agent adapter](../../../opencode/packages/core/src/plugin/host.ts), `93–94,121–138`, calls [Agent.get](../../../opencode/packages/core/src/agent.ts), `109–111`, which reads [State.get](../../../opencode/packages/core/src/state.ts), `172–192`, synchronously. The mere presence of `yield*` is not proof of an I/O suspension. A double that pauses the sponsor lookup cannot by itself prove an actual host race. No unconditional bypass is established here.

The supported APIs also do not promise transactional root/history immutability: [session operations](../../../opencode/packages/core/src/session/session.ts), `setPermissions`/`switchAgent:83–95`, permit changes without an idle-only guard. Native execution performs further parent/config/permission/create operations after CAP consumes. A later trusted host change may be inherited by the child and then fail the result gate. The architecture observes freshness at release; it does not lock root policy through all later native work. Correctly configured host/role enforcement is part of its TCB. The TUI intentionally stops invalidation after transfer.

The justified simplification is to remove the unnecessary sponsor read and keep independent reads ahead of the final root observation, then synchronous path/Git checks and consume. Do not describe snapshots as live state or claim atomicity through native prompting. The existing drift test mutates during root get, before its snapshot returns; retain that check and make any later-interval probe correspond to an actual host scheduling/mutation seam.

If a future requirement demands rechecking inherited child state before its first prompt despite post-consume host changes, the awaited native progress callback before `session.prompt` (`subagent.ts:200–213`) is a possible smaller boundary than imported-child orchestration. That would add a pinned ordering dependency and another read; it is **not recommended as an unconditional addition in this pass**. No new session lock, second admission or pre-prompt machinery is justified by the current evidence.

### One use, failure, concurrency and revocation

Current enforcement: `NativeCap` occupies once before copying or awaits; reservation binds session/actor/message/call; the first contender wins synchronously; malformed owners close; losers cannot replace it; the executor-entry latch blocks same-identity reentry; consumption is synchronous immediately before `original`; every terminal authorization path closes; teardown separately revokes captured closures.

**Assessment:** sound. Ambiguous RPC delivery, result failure, refusal and lost verification do not wake again or authorize a replacement. An earlier published parser-failed tool part is excluded from later admission even though it skipped the before hook. Successful native execution is not sufficient for a verified Git verdict.

Occupancy cannot be derived solely from a successful claim: malformed first submissions also burn the activation. Teardown cannot be represented merely by terminal claim phase: an old executor otherwise could still forward ordinary ungoverned calls. A compact discriminated state can absorb bookkeeping, but it must preserve these distinctions. Same-identity reentry protection can become a validating phase rather than a separate flag; do not lose failure isolation between an owner and concurrent losers.

### Role separation, sponsorship and native child identity

Current enforcement: installed root denies all except Planner delegation; Planner allows only read/search; installed Implementer allows edit/development shell and denies delegation/session-control by default. Native root/child session overrides must be empty. The wrapper changes only the execution actor to a private hidden sponsor. Native OpenCode still checks target policy/depth, creates the child, prefixes the prompt, schedules it and owns progress/results.

**Assessment:** the default installed roles and sponsor composition establish the intended separation. The implementation validates session overrides, but does **not** certify the final effective policy of all three installed roles. Host configuration can append broader allows; [ConfigAgentPlugin](../../../opencode/packages/core/src/config/plugin/agent.ts), `83–123`, and last-match evaluation make this concrete. The static role-file test is evidence for shipped defaults, not a guarantee for arbitrary config. Trusting correctly configured installed role/tool enforcement is an explicit supported-deployment assumption. Sponsor hardening does not make an otherwise writable Planner or delegating Implementer safe. Validate/document that assumption at the real loaded-policy boundary; do not copy the sponsor array-fingerprint machinery onto every role.

The exact native input excludes reuse and overrides, so the trusted native executor creates a fresh child. Its actual child ID, successful outcome, parent, role, location and prompt remain important semantic evidence. The fixed boilerplate prefix and output wrapper are not independent authority sources.

The Implementer is **always installed**, rather than scoped to the accepted claim. The gate blocks new native delegation to it without a claim, but does not gate all of its leaf editing tools by child ID. A recovered admitted child can keep editing after server/plugin restart, and trusted external prompting/agent selection can use its ordinary capability. Current CAP explicitly accepts native same-child recovery and distinguishes capability from renewed CAP authority. Consequently, “restart forgets the grant” means no new governed native admission; it does not mean stop all effects in a surviving child. Do not resurrect scoped role hosting unless the contract is deliberately strengthened. If immediate child-effect revocation becomes a requirement, the present architecture is insufficient.

### Trusted completion and independent outcome

Current enforcement: capture native progress/result before after hooks; wait for root settlement; read root/child/history; bind successful native completion, original receipt and persisted call; independently observe Git and STOP before Reviewer/Commit ([native.ts](../../src/native.ts), `126–198`).

**Assessment:** the independent outcome gate is sound within ordinary Git observation limits. `session.wait` alone does not assert success; keep outcome checks. Failed verification returns unverified STOP and grants nothing further.

Exact wrapper text, exactly one content item, precisely two receipt metadata fields, precisely `truncated:false` after normalization, and nonempty Implementer final prose are unnecessary acceptance restrictions. They reject valid long or empty-text completions and harmless additions. Captured structured native completion plus actual child outcome/prompt and fresh Git establish the same CAP verdict. If publishing a trusted verbatim Implementer result is required, compare its semantic text separately; do not use a display wrapper as its authority proof.

## 3. Complexity Inventory

Each row identifies the protected invariant, the trusted replacement or overlap, and the consequence of removal. **SIMPLIFY** means retain the stated guarantee while changing its mechanism. **REMOVE** applies only to the surplus check, not the underlying invariant.

### Proposal, eligibility and trusted presentation

| Mechanism | Classification | Invariant, overlap, removal consequence and smaller mechanism |
| --- | --- | --- |
| Exact proposal fields; JSON parse; nonempty intent/plan; control-character checks | **RETAIN** | Defines the artifact humans authorize. Host subagent schema validates a prompt string, not this proposal. Removal permits missing/implicit scope or unsafe presentation. Preserve exact text; do not trim it. |
| Unique ordered file array; lexical path checks; no globs/prefixes/traversal/`.git` | **RETAIN** | Exact finite scope. Neither host tools nor Git turn broad scope into an authorized file set. Removal broadens intent. |
| Ancestor `lstat`; final directory/symlink validation; repeated topology check at release | **RETAIN** | Local path correspondence. Host shell/edit is not an equivalent validator. Correct dangling-link handling; reobserve mutable filesystem topology even though the proposal is frozen. |
| Raw file interpolation in `renderPlan` | **SIMPLIFY** | Human-readable exact scope is not established for all accepted paths. Use an escaped path display; do not normalize/rewrite authorized names. No trusted renderer can recover boundaries lost in the input string. |
| Candidate encoding + SHA-256 + frozen proposal/array | **RETAIN** | Exact immutable intent/root/HEAD binding and a useful identifier. Hash is not authorization. Their modest duplication is explicit CAP artifact format; no new hashing/enrollment protocol is needed. |
| Integrity recomputation at every reservation/local/coherence call | **SIMPLIFY** | Transport/admission integrity is required; recursive freezing already prevents local mutation. Retain checks at crossings/final release, consolidate repeated in-process recomputation. Path freshness is not covered by freezing. |
| Two recursive copy/freezer helpers (`immutable`, `frozenCopy`) | **SIMPLIFY** | Same deep-copy guarantee, no separate invariant. Share one small helper if touched; no generalized serializer framework. |
| Primitive `snapshotLocation` and comparison of directory/workspace identity | **RETAIN** | Detaches reactive proxy and binds the actual execution location. Host's richer info object is not the identity contract. Removing the snapshot risks proxy drift; allowing harmless info fields is safe. |
| Initial clean baseline, observation-completion time, root Created event/time rebinding | **RETAIN** | Proves clean-before-planning eligibility. A later clean check cannot recover this fact. Equal/missing/buffered ambiguous timestamps must remain ineligible under current proof. |
| Stable dirty baseline publication | **RETAIN** | Planning-only UX; never a grant. Preserve inert controls and original root/HEAD/path set. No need to freeze dirty file contents for implementation, because implementation is ineligible. |
| Per-await TUI Git observations | **SIMPLIFY** | Many enforce the same publication freshness. Keep independent observations at initial, publication/presentation, decision, server release and result boundaries; keep post-await local ownership/revocation checks. Do not cache Git or delete a distinct boundary. |
| Unused `checks` policy `implemented`; unused production `candidateMessage` | **REMOVE** | No runtime path uses them; they establish no active invariant. Remove obsolete tests rather than confusing the dormant confirmation helper with actual UI. Reuse its safe path-display technique where needed. |
| Readable completed-frame proof; hidden/destroyed ancestry; viewport and button/text clipping checks | **RETAIN** | Prevents a stale/invisible control from claiming authority. Host click routing alone does not establish legible decision copy. Preserve fresh-frame invalidation on resize/remount and synchronous click recheck. |
| Fixed 80×24 minimum, approximate Unicode column calculation, exact expected row heights | **SIMPLIFY** | Geometry is necessary; these are sufficient-layout conventions, not CAP's definition of readability. Prefer measured complete label/path geometry; pin actual renderer behavior. Do not simply remove clipping checks or allow a stale proof. |
| Frame `surface.parent` identity and router-driven disposal behavior | **PINNED HOST DEPENDENCY** | Current proof needs mounted ancestry and complete-frame timing. Keep local proof outside pending ownership; test real mount/disposal on upgrades. Avoid claiming this is a public ancestry contract. |
| `retained` → `pending` → `deciding` → `transferred` ownership | **RETAIN** | Distinct preparation, human-claim and server ownership boundaries. Native route mount is not grant lifetime. Could encode as one local union, but those distinctions cannot vanish. |
| TUI `attempted`, `closed`, `generation.busy/revoked` | **SIMPLIFY** | Prevent duplicate publication, overlapping preparation and revival. Merge overlapping terminal/preparation state only if one-publication and stale-callback guarantees remain explicit. No persisted workflow state. |
| `rootSessionID` alongside creation/bound root ID | **SIMPLIFY** | Mostly derived before closure; retain one display identity after evidence cleanup so trusted terminal status still belongs to the right root. Do not erase it without preserving that purpose. |
| Local callback object identity and no registered model/Form/Question authorization | **RETAIN** | Positive explicit decision. Artifact hashes/transcript text do not substitute for the pointer ownership boundary. |

### Planner, publication and history evidence

| Mechanism | Classification | Invariant, overlap, removal consequence and smaller mechanism |
| --- | --- | --- |
| Fresh root/Planner IDs, parent/role/location, successful idle state, no fork/revert/archive/session overrides | **RETAIN** | Distinct native read-only planning invocation; no inherited session elevation or stale/forked attempt. Host can legitimately produce these alternative states, so they are not impossible-state defenses. |
| One plain initial request; one completed foreground Planner call; exact request-derived prompt; no new inputs | **RETAIN** | Supported bounded planning bootstrap and immutable request/result identity. Host allows attachments, continuation and other controls; it does not reject them for CAP. |
| Planner completed read/glob/grep-only history | **SIMPLIFY** | Defense in depth for read-only planning; configured host permissions already enforce shipped defaults. Keep focused detection of mutation/delegation and incomplete planning; do not treat an expanded harmless read-only tool vocabulary as a scope violation automatically. Loaded role policy is the primary boundary. |
| `parentHistory`/`plannerHistory` full JSON snapshots plus reparsing/rebinding | **SIMPLIFY** | Protects semantic request/call/input/final proposal from drift. Store those bound facts/IDs; reread and compare an authority projection, including added user/control input and relevant session changes. Raw key order, token/time fields and unrelated content metadata are not authorized intent. |
| `bound.request`, call prompt, child text, IDs and timestamps | **SIMPLIFY** | Keep original request, proposal bytes and root creation proof plus call/child identity. Derive deterministic prompt and other duplicates where useful; do not retain full serialized histories just to recompute them. Planner creation time is hardening beyond native fresh-ID/parent evidence. |
| Root selected-model/assistant-model equality; `projectID`, `subpath`, whole root metadata equality | **REMOVE** | No CAP proposal/model pin is being authorized; model is not even in the server claim. Canonical root/location is separately checked. Host enforces its own metadata policy at its leaves. Freeze a particular field only if an identified installed policy depends on it; currently whole-object equality protects no additional stated invariant. |
| Exactly one `finish:stop`, one successful idle row, nonempty root final prose | **SIMPLIFY** | Need completed successful planning and a final proposal, not exact turn serialization or informative root prose. Keep no continuation/extra input and unique bound result; rely on actual session settlement for lifecycle. |
| Planner native wrapper parse and exact reconstruction in `completedCall`/`resultMatches` | **REMOVE** | Child/result identity is required, XML-like formatting is not. Trusted native metadata supplies child ID/status; actual child input/final JSON supplies the proposal. Compare semantic child/call/result evidence, not the wrapper string. |
| Exact native prompt boilerplate prefix | **PINNED HOST DEPENDENCY** | Current readback needs to recognize the native bootstrap plus exact authorized payload. Isolate a small semantic adapter; prefix changes should not become changes to authorized intent. No fuzzy prompt matching. |
| Publication ID/root/text/readable description; pending-before-click and root idle | **RETAIN** | Binds the actual trusted presented artifact and prevents a racing different turn. Synthetic promotion is allowed only after transfer. Host permits other pending inputs, so reject unrelated authority-relevant input. |
| Exact publication own-key list, `time.created`, whole metadata `{source,planHash}` equality | **SIMPLIFY** | Keep identity and text/description meaning. Unknown non-authoritative fields and a changed observation timestamp do not change scope. `source` matters to actual rendering; `planHash` is a label, not a credential. Validate consumed renderer fields rather than every metadata field. |
| `publicationEcho`, exact event-envelope time and RPC/inbox/store reconciliation | **REMOVE** | Duplicate of trusted synthetic admission/readback and bound UI projection. Event echoes neither authorize nor guarantee freshness. Keep semantic returned identity, server inbox verification and local relevant-change invalidation. |
| Whole visible-store equality to full parent history plus synthetic materialization | **REMOVE** | Host visible store defaults to a finite message window. Presence of the exact Plan with bound payload/ownership is sufficient; absence must still disable/close controls. Server API checks enforce immutable semantic planning evidence. Do not turn unrelated visible history into authorization input. |
| Catch-all session-event rejection, completion-ID exception, registry-event invalidation | **SIMPLIFY** | Needed: invalidate ownership on deletion, relevant identity/policy/input changes and state loss. Rejecting every unknown event freezes the event vocabulary; duplicate completion can be suppressed by publication phase. Match semantic changed facts; keep immediate known-danger invalidation and authoritative decision-time reads. |
| Pagination loop/repeated-cursor/duplicate-ID guards | **RETAIN** | Required while using paginated reads to establish complete evidence. Without them, truncated/ambiguous evidence or infinite loops can pass or hang. A narrower direct lookup may remove the traversal, but current API use still needs these guards. |

### Server admission, sponsor and outcome

| Mechanism | Classification | Invariant, overlap, removal consequence and smaller mechanism |
| --- | --- | --- |
| RPC purpose/candidate/root/location validation, copy/freeze; no server planning reconstruction | **RETAIN** | Trusted full claim transfer. Generic RPC object schema does not validate CAP contents. Unknown envelope keys can be rejected cheaply; no security benefit requires accepting them. |
| Copied `publicationID` in server claim | **SIMPLIFY** | Preserves provenance/correlation from trusted TUI, but the server never independently uses it to admit the call. Label it as provenance; do not suggest it authenticates the decision. Do not add a second publication verifier solely to justify the field. |
| One activation slot; reservation tuple; closed/consumed distinctions; separate teardown revocation | **RETAIN** | Anti-reuse, concurrency, ambiguous first-submission burn and old-closure revocation. No host layer supplies CAP one-shot authority. Can be a small union; must not be derived from successful claim alone. |
| `executorEntered` bookkeeping | **SIMPLIFY** | Same-tuple concurrent entry and failure isolation. Atomic consume already limits effects, but a duplicate validation path must not close the owner's execution. Encode validating ownership explicitly or retain this inexpensive latch; a replay test should assert effects/owner survival, not the field. |
| Random control ID + deterministic control text; one steer/resume wake | **RETAIN** | Correlates the real post-decision native proposal without another grant or turn counter. Randomness is identity uniqueness, not authentication. Persisted control cannot reopen the private slot. |
| Synthetic returned ID/session/type/delivery/text echo | **RETAIN** | Cheap semantic admission confirmation, no retry on ambiguity. Exact ancillary metadata/time is unnecessary. Host's synthetic API supplies delivery semantics; preserve supported contract fields. |
| Before hook reserves all authorized-root tool contenders synchronously and vetoes unexpected tools | **RETAIN** | Prevents another root tool from executing after the claim and chooses one owner. A subagent wrapper alone cannot veto an unrelated tool. |
| Before-hook context read, original input check, then repeated executor context read | **SIMPLIFY** | One complete published-control/call/original-input verification in final admission suffices. Keep early cheap reservation/tool veto. Failure before native execution burns the owner. Duplicate history reads do not create an independent authority boundary. |
| Canonical tool name and exactly three own keys/values in published original and decoded executor input | **RETAIN** | Prevents aliases, extra overrides, reuse/background and prompt drift. Host's generic schema accepts optional fields and strips extras; it does not establish the CAP contract. Keep both representations' authority checks. |
| `strictNativeInput` Effect/Standard Schema adapter, detached AST/JSON schema, foreign-instance maker | **REMOVE** | Original persisted input check rejects deleted/extra keys; final decoded check rejects authority transforms before native body. Host runtime already validates/decodes the unchanged native schema. Removing this duplicate layer eliminates the foreign-parser and schema-representation dependency without permitting any broader invocation. |
| First post-control tool scan including failed/streaming parts | **RETAIN** | Parser failures can skip before hooks. Reservation alone would allow a later valid contender. Need ordered complete control-to-call evidence; unavailable evidence fails closed. |
| Exact control text/ID before call; no unrelated user/synthetic/control suffix | **RETAIN** | Binds proposal opportunity to this transfer and rejects changed input. Host permits later controls and retries, so cannot supply this CAP guarantee itself. No whole pre-authorization history comparison is necessary on server. |
| Only assistant/idle post-control vocabulary | **SIMPLIFY** | Reject changed intent and unreadable/compacted evidence, but not every newly added authority-neutral host marker by name. Interpret known semantic controls; unknown input-affecting records still fail closed. |
| Final root role/location/session-permission check + path/Git check + synchronous consume | **RETAIN** | Admission freshness and role separation. Keep the root observation late; do not replace final observations with cached TUI evidence or optimistic native success. Snapshot freshness is observation, not a lock through native prompting. |
| Hidden private sponsor with narrow installed rules; substitution of actor only | **PINNED HOST DEPENDENCY** | Necessary to preserve root static denial while invoking native executor. Public context field does not guarantee leaf permission semantics. Pin actual actor/source/parent behavior. |
| Sponsor deny-only permission hook | **RETAIN** | Bounds later configured allows. Host config can otherwise broaden sponsor policy. Make effective `ask` reject rather than allow generic permission UI to supply a fallback; never turn effective deny/ask into allow. |
| Final sponsor ID/hidden/mode/prefix fingerprint; every appended deny/ask rejected; exact browser-deny exception | **REMOVE** | Duplicates/overstates native leaf policy. Native asserts effective target permission before child creation. With narrow deny-only hook rejecting ask, unrelated denies are safe, effective denies stop, and hidden/mode are construction hygiene rather than call authority. Removing this read also removes its admission await. |
| Native progress forwarding and capture of one matching child ID | **SIMPLIFY** | Forward unchanged. Original native executor uses the same trusted `child.id` for progress and structured output, so extra equality is hardening, not independent proof. Child ID can derive from original structured receipt. Do not imply current capture checks inherited state or prevents prompting. |
| Full frozen result including wrapper and metadata | **SIMPLIFY** | Keep pre-after-hook semantic native completion receipt, with actual child ID/status. Full presentation object is unnecessary authority state; retain text only if exposing/verifying a verbatim result. |
| Scan completed calls by metadata child ID, then reconstruct reservation | **SIMPLIFY** | Reservation already stores message/call IDs. Look up that exact call and check semantic child ID/status; no ambiguous whole-history metadata scan is needed. |
| Root/child successful idle outcome; parent/role/location/no overrides; exact child authorized input/no attachments or later input | **RETAIN** | Detects mismatched lifecycle, inherited context and altered child task. Host allows continued sessions and injected input. Needed independently of Git and model prose. |
| Implementer nonempty final text and exact final-text/native-output agreement | **SIMPLIFY** | Nonempty prose is not CAP success. Native completed-without-text is valid. Use structured completion plus actual successful child; optionally compare semantic result text without wrapper assumptions. Preserve rejection of changed child task/outcome. |
| Exact receipt wrapper and metadata; one persisted content item; exact `{truncated:false}` whitelist | **REMOVE** | Protects original display format, not scope/intent/freshness. Keep persisted call identity/completed state and semantic child fields. Trusted host truncation/normalization/extra metadata cannot issue a grant. Do not follow `outputPath` as authority evidence. |
| `wait` plus separate outcome reads; independent final Git root/HEAD/exact scope | **RETAIN** | Wait only means settlement; tool success/model text is not repository outcome. No host layer proves unchanged HEAD or CAP scope. |
| Catch/interrupt/ensuring close; uncertain STOP; lost RPC response never resent | **RETAIN** | Failure cannot restore authority. Needed across asynchronous transport/native errors. Toast failure is safely non-authoritative because persistent status remains. |

The inventory favors semantic reductions, not blanket tolerance. Exact proposal values, exact arguments, location/HEAD, changed input, one-use ownership and real completion identity remain strict. Unknown fields that the renderer or executor consumes cannot be called harmless without evidence of their meaning.

## 4. Resolution of Compatibility-Report Questions

### A. Malformed provider JSON

**Reject malformed or non-exact invocations at the host object/event boundary; do not require rejection of every malformed provider byte stream.** Raw byte validity is not an independent CAP invariant.

The actual stages are:

1. Provider emits raw tool JSON. It has no authority.
2. The trusted provider adapter parses or recovers it. [Tool stream](../../../opencode/packages/ai/src/protocols/utils/tool-stream.ts), `toolCall:72–96`, can recover local partial JSON, falling back to an object. This is parsing, not authorization and not yet native tool-schema validation.
3. OpenCode durably publishes the resulting object as `Tool.Called` before execution. Failed parser events can instead publish failed tool parts without execution.
4. Built-in before hooks repair representations, including deleting empty native optional fields. `tool.execute.before` sees the potentially repaired object, not provider bytes and not necessarily the original published object.
5. Host runtime validates/decodes native schema, then the CAP executor wrapper sees the decoded invocation. Native execution occurs only after CAP's final comparisons and consumption.

The decisive trusted boundary is **the operation that the native executor will perform**, bound to the frozen human claim. Checking published original keys/values prevents native repair from turning a differently requested operation into an admitted exact call; checking decoded keys/values prevents a transform/default from changing what executes. If incomplete provider JSON deterministically recovers to exactly the authorized object, and both comparisons pass, scope, intent, target, freshness and one use are identical. Rejecting its missing delimiter adds no authority protection.

The current plugin does not reliably retain raw parse provenance: the projected tool input is replaced by the published object. Streaming bytes or a provider hint are neither a complete cross-provider provenance contract nor a grant. A byte-level rejection rule would require a new trusted host parse-provenance contract and provider policy for no identified CAP threat. Do not add it.

Retain the first-tool scan for genuine `tool-input-error` events; those are failed contenders under the current supported attempt policy. Phrase the contract as “first host-published tool contender, including failed tool parts; exact published and decoded authority arguments,” rather than “reject all malformed provider JSON.” Keep empty optionals/extras rejected: that is the explicit three-key invocation contract, not a parser purity rule.

### B. Exact wrapper, metadata and visible-history checks

**CAP invariants:** immutable proposal and display meaning; actual root/Planner/call/child IDs; native target/prompt; successful semantic outcomes; exact authorized implementation input; no intervening changed request; readable current decision surface; no permission overrides; unchanged canonical root/HEAD and observed exact scope.

**Useful hardening:** independent child prompt/outcome readback, progress/receipt child-ID agreement, rejecting Planner mutation history and known policy-change events. These corroborate trusted host behavior or detect supported lifecycle changes. Keep them small and semantic; do not promote every field in their source objects to an authority field.

**Compatibility assertions:** current native prompt prefix; current foreground structured output fields; publish-before-before-hook order; stable original input in completed tool state; complete ordered evidence between control and call; mounted frame/readable renderer semantics. Isolate/pin these only where the retained mechanism uses them.

**Incidental representation coupling:** exact XML-like output wrapper, exactly one text content item, all metadata keys equal, exact `truncated:false`, exact publication timestamp/envelope key list, raw whole-transcript serialization, whole root metadata/model equality, and full visible-store array equality. Loosening these to semantic checks does not authorize another target or task. The captured original executor receipt and actual child/Git evidence establish completion; the exact trusted Plan plus decision ownership establishes presentation identity. The host's finite TUI history window is not an authorization boundary.

Truncation changes what the native row displays, not the frozen claim or actual child completion. Accepting a semantically valid truncated row should not require parsing its wrapper, loading its output file or relabeling its text as a verbatim trusted result. If the tool identity, child/status, authorized input or evidence needed for completion is missing/changed, STOP remains required.

### C. Sponsorship actor seam

**The dependency is intentionally acceptable, but is a pinned internal seam, not a supported call-scoped authorization API.** Current documentation acknowledges the composition; this review makes the exact dependency explicit.

It depends on native `subagent` resolving its target, then calling `Permission.assert` with `Tool.Context.agent`, real parent session ID and source message/call IDs **before child creation**. Permission resolves the explicit actor ahead of `session.agent`, combines actor rules with actual session overrides, rejects configured effective denies before hooks, and evaluates the resulting effect. Child creation uses the actual parent ID, not the sponsor actor's identity. No session runs as the sponsor, and the CAP wrapper changes no root/session permission record.

`ToolEditor.update`, executor wrapping, agent transforms, permission hooks and `Tool.Context.agent` are exported contracts. Their composition into a different authorization actor for a built-in leaf is not promised by those types. A future host could bind actor to selected session agent or move permission earlier; the plugin would then require review even if it still typechecks.

**Smaller boundary:** retain the native executor wrapper and private actor, but move sponsor policy acceptance to native effective permission evaluation. Its deny-only hook should reject any action/resource outside the target and reject `ask`; native already stops effective deny. This eliminates structural prefix/suffix checks, the browser exception and final sponsor read without implementing a competing wildcard permission evaluator. A deny followed by a later allow is judged by OpenCode's effective last-match rules; accepting its effective allow is not overriding an effective host deny. Construction still sets hidden/nonselectable narrow defaults.

There is no existing more stable call-scoped sponsorship API identified in 2.0.22. Direct child orchestration, durable session allows, switching the root or using a broad built-in actor are larger/weaker alternatives. An upstream explicit call-scoped sponsorship facility could replace this seam later; no upstream project is required for this pass.

Future upgrade guard: source-check `subagent` permission-before-create, explicit actor/source/parent forwarding, `Permission.configured` actor precedence/session merge, effective-deny and hook/ask ordering, and preservation of the captured wrapped executor in snapshots. A host-bound focused test must show root remains denied, exactly the consumed invocation executes under sponsor policy, target deny/ask admits no child, unrelated rules cannot broaden sponsorship, and source IDs/parent/child identities remain real. Current doubles model these assumptions; they do not prove the upstream implementation satisfies them.

## 5. OpenCode Dependency Boundary

This covers the compatibility report's inventory and its retained subdependencies. Upgrade checks should test the accepted behavior, not repeat an exhaustive release diff or demand byte-identical host files.

| Dependency | Classification | Boundary and future check |
| --- | --- | --- |
| Directory server/TUI entries; Effect plugin scope/finalizer; `tool.transform`, before-hook typed veto; agent/permission/RPC registration | **Stable/supported host contract** | Exported plugin interfaces. Typecheck/registration smoke coverage and teardown failure behavior. An API declaration does not certify registration precedence. |
| Native `subagent` three required strings and optional reuse/model/background semantics | **Accepted pinned internal seam** | Built-in behavior rather than generic plugin API. Check absence of optionals really creates a fresh foreground child and decoded executor arguments do not silently add effect-bearing defaults. Keep rejection of any new authority option until reviewed. |
| Particular Effect Struct, `makeEffect`, AST rebuilding and Standard JSON Schema bridge | **Incidental dependency that should be removed** | Leave native schema untouched and let host runtime decode it; published-original and decoded-final checks supply CAP strictness. Drop foreign-instance codec pin after removal. |
| `tool.execute.before` invocation IDs, mutable input, awaited failure preventing body | **Stable/supported host contract** | Public hook/failure contract. Test canonical veto and owner reservation. |
| Tool publication before execution; persistence of original input despite repair; hooks before decoding/aliases; failed parser parts without hook | **Accepted pinned internal seam** | CAP original/first-contender proof relies on these specifics. Source-check runner step, publisher, updater and snapshot execution; probe extras/empty fields and failed-first→valid sequence through actual host path. |
| Provider raw JSON recovery details | **Incidental dependency that should be removed** | No CAP decision needs a particular repair algorithm. Assert exact admitted object behavior, not raw lexical purity or private parser provenance. |
| Native target permission, actor substitution, configured/session precedence and effective deny/ask semantics | **Accepted pinned internal seam** | Guard as described in §4C. Do not describe the public actor field as a supported sponsorship primitive. |
| Pre/external/post plugin transform order; ConfigAgent appending rules to sponsor | **Accepted pinned internal seam** | Currently needed for construction and structural verifier. With semantic leaf enforcement, check sponsor exists in final registry and its effective target policy is enforced; remove dependence on exact suffix order. |
| Browser's exact appended deny rule; sponsor original array prefix/mode fingerprint | **Incidental dependency that should be removed** | An unrelated deny cannot broaden target permission. No browser-specific rule should be needed for CAP admission. |
| Installed root/Planner/Implementer effective policies; host per-tool permission enforcement | **Stable/supported host contract**, with explicit trusted configuration prerequisite | Shipped files define defaults; config can alter them. Check actual loaded read-only/nondelegating policy at validation boundary. File tests alone cannot certify a user's final registry. |
| Fresh native child creation with real parent/role/location and inherited session permissions | **Accepted pinned internal seam** | Source-check native `create` and `Session.create` inheritance. Exact native input prohibits reuse; verify semantic child. Admission requires observed empty parent overrides; do not claim that observation locks later parent state. |
| Progress/result metadata transporting actual child ID/status | **Accepted pinned internal seam** | Retain semantic fields for native row/receipt identity. Current equality follows same `child.id` variable. Exact progress `status:running` is required only if used as a pre-prompt barrier. |
| Progress awaited before prompt admission | **Incidental dependency that should be removed** from the current authority claim | Current capture uses child ID, not a pre-prompt veto. No current CAP proof needs this timing. If a separately justified pre-prompt guard is introduced, reclassify/pin callback-before-prompt and failure preventing execution. |
| Native prompt prefix and foreground jobs/completion/recovery | **Accepted pinned internal seam** | Isolate bootstrap decoding; verify fresh context and exact payload, real foreground completion, errors/background unverified, accepted same-child recovery without renewed admission. No provider-request count requirement. |
| Native XML-like content wrapper; exact output metadata shape; string→one-text normalization; `truncated:false` | **Incidental dependency that should be removed** | Use structured receipt + semantic persisted identity/child outcome. Standard truncation and harmless extra metadata must not decide authority. |
| After hooks can change display results | **Stable/supported host contract** | Capture original completion before them and verify actual child. An after-hook display cannot replace the admitted task or mint success independently of native/child/Git evidence. |
| `session.synthetic` steer/resume/admit-only and location-routed APIs | **Stable/supported host contract** | Preserve one publication without wake and one post-claim wake. Verify returned identity/text and no resubmission. |
| Synthetic promotion order and exact projected control input; `session.wait` follows settlement rather than success | **Accepted pinned internal seam** | Check ordering/delivery semantics, outcome after wait, closure on refusal/failure. Do not assume one physical model request or require pending publication forever after transfer. |
| Server `session.context` compaction window/ordering | **Accepted pinned internal seam** | [History](../../../opencode/packages/core/src/session/history.ts), `78–108`, returns an ascending suffix starting at latest compaction; it does not omit arbitrary tool parts while preserving earlier control. Require complete control-to-call segment; missing control fails closed. Use paginated records if supporting longer evidence later, not a new recovery store. |
| Promise message pagination, SessionInfo and inbox APIs | **Stable/supported host contract** | Semantic record reads; cursor/duplicate guards where complete history traversal is used. |
| Public TUI slots, renderer access, router/data access | **Stable/supported host contract** | API availability and root ownership. Public access does not promise concrete component ancestry or complete-history cache shape. |
| Keyed `SessionFrame`, composer-slot disposal, root↔Planner navigation and remount | **Accepted pinned internal seam** | Native navigation must retain pending object but discard mounted frame proof. Check route departure/remount with real Solid/TUI, not only JSX doubles. |
| Router reactive store fields and store-backed pending/visible synthetic materialization | **Accepted pinned internal seam** | Current subscriptions must read route fields; Plan lookup must observe relevant payload loss/mutation. Retain supported store semantics without requiring its whole array equals paginated history. |
| Whole visible-store array, 20-message hydration window matching full frozen transcript | **Incidental dependency that should be removed** | Semantic Plan presence and server evidence suffice. Test long unrelated history with correct Plan, and missing/changed Plan separately. |
| Renderer completed-frame timing, measurement, Unicode width, pointer routing; project OpenTUI 0.5.12 vs host peers ≥0.5.14 | **Uncertain and requiring further evidence** | Source inspection and fake JSX cannot attest the installed module graph or terminal geometry. Compatibility report records unchanged version mismatch. Check actual installed 2.0.22 frame/readability/navigation; no speculative dependency edit in this review. |
| Authorize RPC definition, location routing, scoped register/handler lifetime | **Stable/supported host contract** | Object claim handler burns slot before awaits; teardown and lost response cannot retry. RPC provides no independent human/TUI authentication. Trust assumption belongs in CAP, not a hidden seam. |
| Host automatic recovery of same admitted writable child | **Accepted pinned internal seam** | Current contract accepts ordinary recovery, distinct from new CAP admission. Check restart does not restore root claim. Do not infer effect revocation from slot teardown. |

Relevant host source anchors beyond the table: [tool runtime](../../../opencode/packages/core/src/tool/runtime.ts), `execute/decodeInput:28–84`; [tool snapshot](../../../opencode/packages/core/src/tool.ts), `263–281`; [permission](../../../opencode/packages/core/src/permission.ts), `158–188,231–247`; [tool output](../../../opencode/packages/core/src/tool-output.ts), `65–115`; [host session adapter](../../../opencode/packages/core/src/plugin/host.ts), `545–568`. The compatibility report supplies the bounded unchanged-source evidence for TUI, RPC, registration ordering and synthetic promotion; this review did not repeat its diff.

## 6. Test Architecture Review

The substrate is appropriate: [attempt tests](../../test/attempt.test.ts) use test-scoped Git-observer, host/RPC/executor and JSX doubles; [Git tests](../../test/git.test.ts) alone use real Git semantics with immutable seeds/private copies. [CAP tests](../../test/cap.test.ts) and [proposal tests](../../test/proposal.test.ts) test primitives. Keep that separation. Do not replace production observations with caches, add DI/env switches or inflate real-Git fixtures to test host orchestration.

### Retain security/fail-closed coverage

* `cap.test.ts:19–88`: frozen-copy/caller mutation, occupied slot after malformed submission, reservation owner isolation, consume/replay, receipt identity and teardown. Prefer external effects/terminal behavior over inspecting exact private phase names.
* `proposal.test.ts:21–40,56–79,97–107`: exact fields/text/order, duplicates/globs/traversal/ancestor/final-link boundaries and candidate root/HEAD corruption. Add dangling outside-target and unambiguous unusual-path presentation cases; current symlink tests only cover resolved internal/escaping links.
* `git.test.ts:37–128`: staged/unstaged/untracked/deletion/rename endpoints, ignored-file policy, canonical root, HEAD drift and exact membership. These require real Git. No broader orchestration case needs its cost.
* `attempt.test.ts:434–478,518–545,621–658`: session overrides, extra input, location/root creation drift, immutable retained evidence and pagination failures. Replace full-record drift with relevant semantic drift where indicated below.
* TUI cases at `685–738,755–1100,1114–1389,1947–1993`: Cancel/no claim, single positive decision, no stale callbacks, navigation/remount, resize/readability, state loss, fresh ownership, cleanup and lost RPC response. Keep no-claim/no-wake/no-child outcomes; a mocked completed frame is evidence for callback logic only.
* Native cases at `1589–1611,1686–1731,1756–1939`: exact call/prompt/options, original-vs-decoded drift, parser-failed-first, concurrency/owner isolation, late Git/path/root/session drift, refusal, ambiguity, teardown, real child/task binding, scope/HEAD and no recovery grant. Keep executor count and no retry/replacement assertions.

Missing focused invariant cases: dangling final symlink and filename display collision. The freshness matrix (`1808–1838`) mutates during root get; it does not certify atomic parent state through native execution. A later-mutation compatibility probe must identify a real host suspension or mutation seam; an artificially paused sponsor double is insufficient because the local host lookup is synchronous. The present `serverFake` combines child creation, successful prompt/completion and progress into a simplified executor; it should not be treated as evidence for a pre-prompt guard or actual native scheduling.

### Weaken representation tests to semantic behavior

| Current tests | Recommendation |
| --- | --- |
| Planner child/wrapper mismatch matrix `368–389` | Keep missing/duplicate call, wrong child/prompt/role, reuse/overrides, added input and failed outcome. Replace display-wrapper rejection with semantic binding and authority-neutral formatting acceptance. |
| Synthetic admission/raw P checks `479–516`; exact pending fields `659–683` | Keep original Planner bytes, exact readable description, ID/root, unrelated pending input and unexpected pre-decision delivery. Allow harmless envelope/metadata additions and timestamp changes. Distinguish rendering-relevant metadata from cosmetic labels. |
| Retained coherence and full-transcript mutations `621–638,874–953,1317–1389` | Assert changed request/proposal/call/child/input/role/location and actual Plan loss stop. Add acceptance of harmless record-field/key-order and unrelated visible-window differences. Preserve exact authority text, not JSON serialization. |
| Root model/project/subpath/whole-metadata checks in `attempt.ts:232–242`, represented in test fixture records but without a dedicated drift matrix | Remove generic metadata/model stability as a CAP invariant; do not add a rejection matrix just to lock these checks. Keep canonical location, actual role and any concrete policy field that is independently justified. The `1101–1112` matrix separately tests Git drift across awaits and should retain that boundary coverage. |
| Exact `renderPlan`/`candidateMessage` expected strings `proposal.test.ts:42–54,81–95` | Test exact proposal preservation, unambiguous scope/root/HEAD and implementation-only meaning. Remove unused helper snapshots; use the actual production Plan/control path. Small rendering snapshots may remain UX tests, not security proofs. |
| Geometry matrices including 79-column/23-row rejection and precise row heights | Keep clipped/hidden/destroyed/stale proof cases. Treat fixed dimensions as layout tests; do not encode terminal thresholds as CAP security policy once measured readability suffices. |
| Result metadata whitelist `1733–1754` | Retain changed child ID/status, missing completion evidence and failed child rejection. Replace extra metadata, missing `truncated:false`, `outputPath` and benign truncation rejection with acceptance under valid semantic receipt/child/Git evidence. |
| Result binding matrix `1878–1915` | Keep wrong parent/role/location/permissions/outcome, altered task/attachments/later control, missing authoritative child evidence and Git drift. Wrapper/content-item shape belongs in optional presentation tests. |
| Sponsor structural-policy matrix `1650–1684` | Test **effective** target deny/ask blocks child, unrelated denies do not block valid target, appended broad allows cannot broaden sponsor, and root/session policy stays unchanged. Do not require rejection merely because a shadowed deny appears in an array or hidden/mode fields differ in a test double. |

### Pinned compatibility tests and tests to remove

The foreign bundled Effect test (`1535–1587`, [native-host fixture](https://github.com/mikechao/opencode-agents/blob/a616fd1d4c294de038aeab3bf724d5c8ae7e7b8a/test/fixtures/native-host.ts)) caught a real bug introduced by the custom codec. **Retain it while that adapter exists; remove the fixture and the maker/AST/descriptor assertions once the adapter is removed.** Replace with a direct test that ordinary Planner calls retain the original host-owned schema/executor path and governed original/decoded mismatches never reach `original`. No foreign-schema compilation should remain to be regression-tested.

Keep sponsorship/config/permission-order coverage (`1613–1684`) specifically labeled as a model of pinned host assumptions. The registration test (`1994–2029`) should check scoped lifetime, hook/RPC registration and narrow effective authority; exact registration counts/array layouts are secondary shape checks. The static role-file test (`391–431`) usefully protects shipped defaults, but exact instruction-substring assertions do not certify effective permissions or enforce shell containment. Prefer semantic role policy assertions and one loaded-host compatibility check.

Doubles cannot prove provider parsing, upstream permission ordering, progress-before-prompt, real truncation or SessionFrame/frame timing. Keep a small upgrade source checklist and focused host-path/live checks for those seams. Do not turn the whole double mutation matrix into an expensive live suite. Native same-child recovery test (`1917–1928`) intentionally allows an earlier errored assistant and later successful completion; it proves accepted recovery semantics, not child-effect revocation.

## 7. Recommended Minimal Architecture

The smallest design remains a TUI claim plus a server native-call gate:

```text
initial canonical Git/HEAD observation → fresh read-only native Planner
→ bind semantic request/call/child/final proposal
→ freeze candidate → publish exact unambiguous trusted Plan
→ current readable pointer Authorize → verify freshness → transfer once
→ server freezes full claim and occupies its only slot
→ one exact synthetic control → reserve first root tool contender
→ one admission verification:
    published original control/call/first-contender + decoded exact arguments
    late root/location/no-overrides + valid paths + fresh clean Git/HEAD
→ consume → original native executor with private sponsor actor
→ native effective permission denial/ask remains fail-closed
→ native child/progress/prompt/job/result
→ actual successful root/child/task + original semantic completion receipt
→ independent unchanged-HEAD/exact-path Git verdict → STOP
```

Keep the scope validator correct for existing unresolved links and make Plan paths unambiguous. These are corrections to promised invariants, not a broader sandbox. Keep parent-state freshness as a late observation at release; do not add pre-prompt machinery without a separately established requirement/evidence as discussed in §2.

Use one local TUI ownership state and one private server state. Server state needs occupied/unused distinction, frozen claim, control identity, reservation/validation ownership, consumed/terminal status and activation revocation; completion evidence can be one semantic receipt. TUI needs initial eligibility/root creation evidence, the frozen candidate, bound planning facts, publication identity/payload, local pending/claimed/transfer ownership and current mounted frame proof. Diagnostic IDs are not credentials. Do not persist a grant, add enrollment/status/reissue, copy planning conversations to implementation or count provider requests.

Leave native input/output schemas untouched. Before-hook work is early reservation and veto; final wrapper work is exact original/decoded invocation, evidence, freshness and consume. This collapses three input validation layers into two different necessary comparisons around the host's single validation layer. Keep the original native executor rather than reimplementing its scheduler or child lifecycle.

Install the private sponsor once; constrain its effective leaf authorization with a deny-only hook. Effective host deny remains deny and ask becomes rejection. Remove the final role-array fingerprint and browser exception. Obtain the actual root after independent awaited reads. This moves policy enforcement to the component that really decides whether child creation is permitted and removes the unnecessary later sponsor await.

For completion, preserve the actual managed call tuple and capture original structured child completion before after hooks. Read the actual successful child and exact authorized bootstrap/no added task; use its semantic identity and outcomes. Check the persisted managed call by its stored message/call IDs, with semantic child/status. Ignore native XML-like wrapper, harmless extra metadata and presentation truncation. Do not certify semantic implementation correctness or commit readiness from any of this: the verdict remains unchanged HEAD, observed paths and STOP.

Before authorization, compare meaningful planning/publication identity and no added input rather than frozen full JSON records. The visible store needs the exact trusted Plan, not an exact copy of complete paginated server history. Preserve independent decision-time evidence checks and immediate invalidation for relevant state loss. Route disposal invalidates only the mounted frame proof; accepted server ownership still outlives TUI navigation/disappearance.

This is smaller than the current architecture in host dependencies and duplicated proof, not a promised line-count reduction. It keeps the authority boundaries and accepted recovery model while removing representation policing. Whole-session transactional immutability, scoped writable-role lifetimes and hostile local-client authentication are deliberately not smuggled into this simplification.

## 8. Recommended Follow-up

1. In a separately authorized implementation pass, correct ambiguous scope presentation and dangling-link validation. Remove the custom input codec and structural sponsor-policy verifier, using the exact original/decoded comparisons and native effective-denial boundary described above, with the root observation kept late. Update CAP/orchestration wording alongside those changes, including object-level malformed input and the explicit sponsorship/recovery/observation assumptions.
2. Run focused primitive/CAP/host-double tests for the corrected invariants and simplified adapters, then the existing required checks. Replace wrapper/metadata/whole-visible-history rejection matrices with semantic assertions; retain pinned-host tests only for retained seams. Simplify full planning snapshots and event bookkeeping without deleting distinct freshness observations. Keep real Git tests confined to Git semantics.
3. Perform focused OpenCode 2.0.22 live dogfood: one clean exact-scope positive attempt with native row/navigation/resize and trusted Git verdict; a separate Cancel; controlled host-path probes for original/decoded input and sponsor effective deny/ask. Record the installed renderer/schema versions and accepted same-child recovery/observation limits. Escalate only concrete failures, not a broad new matrix.

No architecture adaptation was identified solely because of the 2.0.21 → 2.0.22 delta. These follow-ups address pre-existing correctness and unnecessary coupling. The docs' older pin wording and the project's renderer peer mismatch should be reconciled with actual installed validation evidence; neither warrants claiming live 2.0.22 success now.

**If Issue #9 were deleted and rebuilt today against OpenCode 2.0.22, we would keep the frozen readable human claim, one-shot server reservation/consume, private native sponsorship, fresh root/Git checks and independent child/Git verdict; remove the custom decoder, exact display/metadata/whole-history policing and duplicate reconciliation; and correct path presentation and dangling-link handling, because the smaller semantic boundary preserves authority without freezing incidental host representations.**
