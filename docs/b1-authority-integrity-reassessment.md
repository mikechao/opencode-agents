# B1 Authority-Integrity Reassessment

**Status:** Non-normative reassessment artifact. This report established the case for process-scoped authority and narrowing B1 away from general filesystem isolation. Subsequent architecture discussion additionally treats the installed OpenCode runtime and installed `opencode-agents` integration as trusted V1 TCB components, and uses trusted OpenCode role/tool enforcement for CAP-reserved effects. The report's stronger requirement for a separately protected runtime-selection verifier has therefore not been adopted. `docs/coding-authority-protocol.md` remains authoritative.

## 1. Executive Conclusion

**INFERENCE — B1 is directionally correct but over-specified.** V1 does not need to make every CAP-related byte physically unwritable by model execution. Durable records can be corrupted without creating authority, and an approval held only in trusted process state cannot be replayed after that process ends.

CAP still needs a trusted runtime-selection boundary. Model-controlled repository changes must not become the trusted CAP kernel or UI path on reload or restart. That requires verified code selection rooted outside the model’s writable files; it does not require a general filesystem sandbox.

The narrower statement—“model execution cannot manufacture, enlarge, replay, reuse, or substitute CAP authority”—is sufficient for **authority integrity** only when it includes trusted runtime selection and the bounded effect path. Taken literally, it misses a separate bypass: a model-controlled shell that can run `git commit` directly can bypass CAP without manufacturing a CAP grant.

**ESTABLISHED FROM CURRENT DOCS.** CAP currently makes durable store state authoritative, while also requiring that an unconsumed prior-process decision not resume after restart. Those choices are recorded in [CAP §§1–4 and 8](coding-authority-protocol.md:10) and the [pre-M1 review](pre-m1-documentation-readiness-review.md:103). The latter correctly identifies model-directed code and store changes as a risk, but its proposed remedy assumes durable grants are necessary.

**UNVERIFIED.** The inspected OpenCode setup does not yet establish an independent runtime-selection root for CAP. A model-writable plugin path, global config, or Git `HEAD` cannot serve as that root merely because it is outside the worktree.

## 2. Authority Property

**INFERENCE — The smallest authority property is:**

> CAP authority exists only as current, single-use state held by a trusted CAP runtime. It is created only after the trusted UI returns `true` for the exact frozen, fresh candidate presented by that invocation. It is bound to one intent attempt or one reviewed-target effect, and it expires when that runtime ends. Model-controlled inputs, files, database records, prior process output, and repository-controlled code cannot create, alter, restore, replay, or substitute it.

Four properties should remain distinct:

- **Authority integrity:** A current trusted UI result, exact candidate binding, freshness checks, and a one-use capability are fundamental. Durable persistence is not.
- **Runtime integrity:** CAP code loaded now must be trusted. On restart or reload, the host must select and verify the CAP runtime independently of repository-controlled files and exclude untrusted project plugins from the CAP/UI authority path.
- **Durable audit and reconciliation:** Records may help with audit or locating an ambiguous Git outcome. They must not restore authority. They may be treated as untrusted evidence.
- **Filesystem isolation:** Model execution need not be unable to write every CAP-related file. Writes may corrupt or delete audit data, or cause denial of service, provided they cannot change which code is trusted or make authority succeed.

**ESTABLISHED FROM SOURCE.** OpenCode has a server-side `discovery: false` option that suppresses filesystem config discovery while retaining host-injected plugins (`../opencode/packages/core/src/instance.ts:119`). The TUI separately finds plugin directories using its current working directory (`../opencode/packages/tui/src/plugin/discovery.ts:8`, `../opencode/packages/tui/src/app.tsx:212`). The B1 investigation reports that the stock TUI has no supported project-plugin disable switch, so a trusted launch arrangement must control its discovery paths ([B1 feasibility investigation](b1-boundary-feasibility-investigation.md:1)).

**INFERENCE — A separate effect-integrity requirement remains.** CAP says a commit occurs only through its bounded, separately authorized Git effect. If the model shell can invoke an equivalent `git commit` directly, CAP’s commit gate is bypassed even if no CAP grant was forged. The reviewed docs do not establish a hard control that prevents this. This is an effect-path question, not a reason to require general write isolation.

## 3. Current CAP Requirement Classification

**ESTABLISHED FROM CURRENT DOCS.** CAP requires durable grant recording and consumption, SQLite as an acceptable implementation, no authority resumption after restart, and no reuse of a consumed grant ([CAP §8](coding-authority-protocol.md:181)).

**INFERENCE — Classification:**

| Current requirement or concept | Classification | Correctness reason |
|---|---|---|
| Exact frozen candidate, trusted UI invocation binding, and freshness checks | **FUNDAMENTAL** | Without them, approval can be substituted, rebound, or used after the approved repository state changes. |
| Intent and commit authority are separate and bound to different purposes | **FUNDAMENTAL** | Intent approval cannot authorize a commit, and commit approval cannot authorize a different target. |
| One use per grant | **FUNDAMENTAL** | A grant cannot authorize a second attempt or effect. A process-local consumed state can enforce this while the run exists. |
| Grant and consumed state remain durably stored | **OVER-SPECIFIED** | CAP already forbids resuming old authority. Durable state adds no authority-integrity guarantee if a new process cannot use it. |
| Durable store is the source of truth for grant existence and consumption | **OVER-SPECIFIED** | The current verified process should be the source of current authority. A mutable database must never establish that authority. |
| Atomic one-time consumption through SQLite across restarts | **OVER-SPECIFIED** | Single consumption is fundamental; durable cross-restart consumption is not when all grants expire with the process. |
| Replay prevention after restart | **FUNDAMENTAL outcome; over-specified mechanism** | Old approvals must not work again. Destroying process-scoped authority and rejecting old UI results achieves this without a durable replay ledger. |
| No unconsumed prior-process decision resumes | **FUNDAMENTAL** | A new process must start without authority and request fresh approval against current repository reality. |
| A consumed grant is not reactivated | **FUNDAMENTAL within its process epoch** | A live consumed grant cannot be reused. After process death, there is no grant to reactivate; a permanent consumed marker is unnecessary. |
| SQLite as a possible local store | **OPTIONAL** | It can keep audit or reconciliation evidence, provided its contents never grant authority. |
| Durable candidate digest or grant identity | **OPTIONAL** | The live kernel needs an exact candidate binding. Persisting its digest is useful only for records or reconciliation. |
| Durable evidence for ambiguous commit reconciliation | **OPTIONAL** | It may help report what happened. It is unnecessary if restart simply ends the run and a later run derives current Git state. |
| Fail closed when authority state cannot be consumed unambiguously | **FUNDAMENTAL** | For process-scoped state, the kernel must not perform an effect if it cannot establish that the current capability was consumed exactly once. A database transaction is one possible implementation, not the requirement. |

## 4. Intent Authorization Lifetime

**INFERENCE.** Intent authority needs to last only inside the trusted process that received and bound the current UI result. The kernel holds the frozen candidate and one-use intent capability in process state, bound to the current run, worktree, baseline, scope, and UI invocation.

If the process crashes after approval but before implementation starts, authority is lost and the intent must be requested again. If it crashes during implementation, the attempt ends. A later process derives a new candidate from current repository reality and requires fresh approval. Existing worktree changes may remain, but they inherit no authority.

Durable intent grants add no correctness here. They cannot make stale work safe, and the next process is already required to reconstruct its candidate and freshness facts.

## 5. Commit Authorization Lifetime

**INFERENCE.** Commit authority can also be process-scoped. After the trusted UI result is bound and freshness is rechecked, the kernel marks the capability consumed in trusted process state immediately before invoking the bounded commit effect. It never retries that effect using the same grant.

If the process crashes before the effect begins, authority is lost; the user can authorize a fresh candidate. If the effect has an ambiguous result while the process remains alive, the kernel may do read-only reconciliation using its still-live candidate and must not retry. If the process dies, the run terminates. A later process derives actual Git state and requests fresh authority for any new effect.

No authority state must survive for that behavior. If the product keeps restart-time reconciliation, a durable record can carry non-authorizing hints such as the process epoch, candidate digest, prior Git state, prepared paths, and expected effect identity. Git observations must be checked independently; the record cannot authorize, retry, or prove on its own that the CAP-launched effect occurred. If causal proof against deliberate Git-state fabrication is required, the evidence needs a separately protected trust root. V1 can avoid that complexity by treating a crash as terminal and starting afresh from current Git state.

**INFERENCE — Separate caveat:** process-scoped grants do not prevent direct shell execution of Git. The “commit only through the bounded CAP effect” invariant needs an effect path the model shell cannot bypass. Generic permissions described as defense in depth do not establish that guarantee by themselves.

## 6. Durable State

**INFERENCE.** No authority state needs to remain authoritative across restart. SQLite must not be the source of truth for whether a usable grant exists or has been consumed. Current authority should be held only by the active verified kernel.

SQLite can remain useful for audit and reconciliation. Its contents must be treated as corruptible evidence:

- A row saying “approved” cannot create authority.
- A row saying “unconsumed” cannot revive an old grant.
- A row saying “commit succeeded” must not substitute for trusted Git observation.
- Corrupt or inconsistent evidence may be ignored, reported, or cause reconciliation to stop.

That makes fake grants and consumed-bit changes harmless to authority. They may damage audit quality or availability.

## 7. Runtime Integrity

**INFERENCE — Active process.** Editing source bytes on disk does not by itself replace code already loaded into a trusted process. That remains safe only while the process does not hot-reload the altered CAP source, dynamically load an unverified replacement, or admit repository-controlled code into the same CAP/UI authority path. The process must bind UI results and capabilities to its current runtime instance.

**INFERENCE — Restart/reload.** Repository-controlled code and configuration cannot select themselves as trusted CAP on the next launch. The loader must select or verify the full CAP runtime independently of mutable project files, and it must fail closed if verification fails. A project plugin must not impersonate the trusted CAP UI or reach the kernel’s internal authority path.

The root of trust must be explicit. A hash, runtime ID, signature, or manifest has no force by itself. The verifier and expected identity must come from a trusted host or OS installation boundary that model execution cannot rewrite. A runtime that checks a digest stored beside its own mutable source is self-verifying and can be replaced together with that digest. A globally installed plugin path is not automatically trusted if ordinary model shell execution can modify it.

**UNVERIFIED.** The local OpenCode source provides useful host-controlled plugin-discovery seams, but the reviewed evidence does not establish a selected, protected verifier and trusted CAP source for this project. A protected host/OS trust root is compatible with the stated exclusion of OS/account compromise; ordinary same-user execution must still be unable to replace that root.

## 8. `codex-agents` Prior-Art Assessment

**ESTABLISHED FROM PREDECESSOR IMPLEMENTATION.** The predecessor materializes a committed runtime closure, hashes its inputs, validates an external artifact cache, assigns a runtime ID, and uses launch attestations to route durable workflows to their owning runtime. Its bootstrap reads a committed Git revision selected through a host-supplied provider root (`../codex-agents/.codex/workflow-mcp/bootstrap.ts:26`, `../codex-agents/.codex/workflow-mcp/runtime-artifact.ts:150`, `../codex-agents/.codex/workflow-mcp/README.md:144`).

**INFERENCE — Techniques worth retaining as principles:**

| Technique | Problem solved and relevance to CAP | Small CAP reduction | What it proves; root and same-user risk |
|---|---|---|---|
| Committed runtime closure and digest | Kept a dirty checkout from changing the executing predecessor server and its local imports. CAP still has the restart/reload code-selection problem. | Verify the complete CAP executable closure at each process start against an independently trusted identity; reject mismatches. No historical runtime routing. | A digest detects changed bytes only if its expected value and verifier are trusted. Git `HEAD` from a model-controlled checkout is not that trust root. A shell can defeat a self-updated manifest, mutable provider, or mutable verifier. |
| Separate selected runtime from mutable worktree | Avoided loading active predecessor code directly from its changing worktree. CAP benefits from a trusted selection path, but does not require an external artifact cache as such. | Load a pinned/signed CAP bundle or other verified runtime, regardless of whether other copies remain writable. | Separation alone detects nothing. A same-user shell can change an external user-owned artifact unless an independent verifier rejects it. |
| Relaunch validation | Detected missing, changed, or corrupt predecessor artifacts when a child runtime had to be relaunched. CAP needs verification before every new process can accept authority. | Verify once before exposing CAP authority on startup or reload. | This is a useful fail-closed boundary when the verifier and identity pin are protected. CAP does not need per-request cache checks. |
| Runtime ID and HMAC launch attestation | Bound predecessor workflows to their runtime and supervisor launch. CAP has no historical workflow runtime affinity and should not resume grants across runs. | Use a fresh in-memory process epoch to bind current UI invocation and live capabilities; use runtime identity only to establish which verified code was loaded. | An ID is identity, not authority. An HMAC detects forgery only while its key and verifier are protected. A same-user shell can defeat a key stored in an accessible user-owned artifact. No durable workflow attestation is needed for CAP grants. |

The predecessor’s mutable-checkout separation technique does **not** mean “committed equals trusted.” If model execution can modify the provider repository or its selected `HEAD`, the model can introduce a malicious commit. The bootstrap’s provider-root setting must itself come from a trusted host configuration. The external artifact cache and HMAC key likewise do not create a trust root by themselves.

**INFERENCE.** The predecessor store’s durable workflow authority, runtime affinity, historical routing, promotion, repair/recovery, continuation, worker-attempt bookkeeping, migration, and phase machinery should not return. V1 CAP loses authority on restart and rederives work from current repository state.

## 9. Attack / Failure Matrix

**INFERENCE.** These outcomes assume process-scoped authority and a trusted runtime-selection path. Cases marked vulnerable remain open if the stated host/effect boundary is absent.

| Attempt | Outcome | Fail-closed response |
|---|---|---|
| Fake grant inserted into SQLite | **Irrelevant to authority** | Never read a database row as a grant. Ignore or report it as untrusted evidence. |
| Consumed grant changed back to unconsumed | **Irrelevant after restart; prevented in the live epoch** | Current in-memory consumed state controls the active grant. A new process has no old grant to reactivate. |
| Replay old approval after restart | **Prevented** | The old result and capability are bound to the ended process invocation. Start without grants and request fresh UI approval. |
| Crash after approval but before effect | **Authority destroyed** | Do not resume from a record. Request fresh approval against current repository state. |
| Crash during implementation | **Authority destroyed; worktree changes remain observations only** | End the run. Derive a new candidate and require new authorization. |
| Commit succeeds but process dies before recording success | **No grant replay; effect status may be uncertain** | Do not retry under the old grant. A later run reads current Git state and requires fresh authorization for any further effect. |
| Candidate digest or durable record swapped | **Prevented for current authority** | Bind the result to the frozen in-memory candidate and recheck freshness. A stored digest is never authoritative. |
| Stale UI result rebound to a new candidate | **Prevented** | Accept results only for the live invocation and exact candidate; require a new UI decision after any relevant change. |
| Repository replaces project CAP plugin or adds an impersonating plugin | **Detected and failed closed only with verified selection; otherwise vulnerable** | Startup must ignore repository-selected CAP code/plugins or reject the runtime. Stock discovery behavior is not enough to assume this. |
| Trusted source modified on disk after launch | **Prevented only if the active runtime cannot hot-reload unverified bytes** | Continue using the verified loaded runtime or terminate/reverify on reload. A watched replacement path remains vulnerable. |
| Untrusted process invokes authority API directly | **Prevented if the API requires the actual current trusted UI callback** | Never accept caller-supplied `true`, candidate ID, digest, or epoch as proof of UI approval. |
| Model shell invokes `git commit` outside CAP | **Vulnerable unless the effect path blocks it** | Ensure the CAP-governed commit cannot be performed through an unmediated model tool. This is an effect-integrity issue beyond database authority. |

## 10. Revised B1

**INFERENCE — Proposed behavior-only wording:**

> CAP authority MUST exist only as process-scoped state created by trusted CAP code after a current trusted-UI result for the exact frozen, fresh candidate. It MUST be bound to one bounded purpose, consumed once, and destroyed when that trusted runtime ends. Model-controlled execution, mutable records, prior process output, and repository-controlled code or configuration MUST NOT create, restore, alter, replay, or substitute authority, or trigger a CAP-governed effect outside its bounded trusted path. Each start or reload MUST select a trusted CAP runtime through an independently trusted verification path and exclude repository-controlled code from the CAP/UI authority path; uncertainty MUST fail closed. CAP-related files need not be unwritable when any tampering cannot satisfy these conditions.

This wording removes physical write isolation as a requirement. It retains a concrete integrity requirement for runtime selection and the bounded effect path.

## 11. CAP Changes Implied

**INFERENCE.** No edits were made. If this decision is adopted, the smallest reconsideration in [CAP](coding-authority-protocol.md) is:

- **§§1–2:** Remove the durable store as a condition for authority. Define current-process authority and its expiry.
- **§3:** Identify the trusted runtime selector/verifier and state that repository-controlled plugins are not trusted merely because OpenCode discovers them.
- **§4:** Replace durable store grant enforcement with trusted process state; keep SQLite optional for records.
- **§§6–7:** Replace “record and consume” with process-local single consumption. Fail closed on uncertain authority state, not on a nonessential audit write.
- **§8:** Replace the section with process-scoped lifetime, one-use consumption, restart invalidation, and non-authorizing durable evidence.
- **§§9–10:** Preserve scope, freshness, review, and bounded effect rules. Clarify that a commit effect cannot be invoked outside its CAP path. Decide whether restart-time reconciliation is optional or removed.
- **§13:** Remove the required durable grant transaction question; add trusted runtime-selection and effect-path verification.

[V1 orchestration §§7–8](v1-orchestration.md:175) and the charter also refer to the durable store as authority and would need matching terminology.

## 12. Implementation Consequence

**INFERENCE.**

- **Docker:** Not required. It enforces a stronger physical access boundary than authority integrity needs.
- **General sandbox:** Not required. Model writes can be tolerated when they cannot alter selected trusted code or grant authority.
- **Separate OS user:** Not required if the trusted runtime verifier and selection root are independently protected.
- **MCP authority service:** Not required. MCP is transport; a same-user service does not protect authority and complicates UI-result binding.
- **SQLite:** Still useful for audit or reconciliation, but optional and never authoritative.
- **Durable reusable grant state:** Not required; it conflicts with process-scoped authority and fresh authorization after restart.
- **Verified trusted-runtime mechanism:** Required. It prevents repository-controlled changes from silently becoming the next trusted CAP runtime. Hashes or signatures count only when verified by a host/OS trust root that model execution cannot change.

The bounded commit path also needs a non-bypass guarantee if CAP promises that commits occur only after CAP authorization. That guarantee does not imply Docker or filesystem isolation.

## 13. Pre-M1 Consequence

**UNVERIFIED.** The architecture no longer requires a general sandbox, but the selected OpenCode launch path has not been shown to provide a protected CAP runtime identity and project-plugin exclusion across restart. The source review identifies useful server and TUI seams; it does not establish the complete configured boundary.

**INFERENCE.** M1 needs one targeted technical experiment after choosing the host/launcher: modify model-writable project plugin/config and SQLite state, restart, and verify that only the independently verified CAP runtime enters the authority path, no prior grant resumes, and the bounded effect cannot be invoked through a direct model path. I did not run such an experiment; this reassessment was read-only, as requested. If the chosen host cannot provide an independent verification root, that specific runtime-selection boundary remains blocking.

## 14. Next Decision

Decide whether to replace durable reusable grant state with process-scoped, single-use authority and narrow B1 to verified runtime selection plus non-bypassable CAP effects.
