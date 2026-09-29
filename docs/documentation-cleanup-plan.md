# Documentation Cleanup Plan

## 1. Executive recommendation

Keep **four current documents**: new README, short charter, normative CAP contract, and runtime architecture. Merge selected hybrid authorization UX into orchestration's future section; archive its prototype decision. Use one flat history directory/index and delete superseded intermediates whose conclusions survive elsewhere.

| Count | Recommendation |
| --- | --- |
| Top-level Markdown before / after this report | **36 / 37**; visible files, not 36 normative specifications |
| First-class current docs after cleanup | **4**: README plus three owners |
| Archive | **22 existing files + this plan = 23**; also create history README |
| Delete | **11**: nine redundant reports, one spent readiness audit, one merged reference note |

Starting HEAD: `bf8d5f34324f97f7c11be9437e50ae09fe167aaa`, matching checkpoint. Starting `git status --porcelain=v1 --untracked-files=all`: no output; no unrelated changes. The 36 files total approximately 788 KB; charter/CAP/orchestration/hybrid total approximately 76 KB.

Every file's question, status, findings/conclusions and relevant evidence were read. Runtime/roles/tests and both cleanup audits establish current truth. Git chronology resolves supersession: `de59dca` narrowed authority integrity; `cebddfd` removed physical commit-prevention claims; `9ebab47` adopted ordinary path observation; `1040267` adopted Candidate 1; `7e6abb0`/`1e15ed4` introduced/refined synthetic publication. Sibling OpenCode source was read-only. No OpenCode or Docker was launched.

**Current truth:** TUI calls only `publishPlan()`, ending at exact bound synthetic Plan publication and idle, without authority. Publication permits pre-existing Git changes if root, HEAD and observed path set remain unchanged; it does not freeze file contents. Tested `runImplementationAttempt()` has no production caller and rejects publication's synthetic parent extension. Published-plan authorization, cross-publication binding and pre-bootstrap clean enforcement remain future integration, followed by Reviewer/exact-target/Commit. **COMPLETE — NO RUNTIME GAPS** stands.

## 2. Current documentation inventory

Paths are relative to `docs/`. Every original appears once; the final row classifies this new report. Archive means `docs/<filename> → docs/history/<filename>` (§6).

- **A. CURRENT — KEEP AND RECONCILE**
- **B. CURRENT — MERGE THEN REMOVE**
- **C. HISTORICAL — ARCHIVE**
- **D. REDUNDANT HISTORICAL — DELETE**
- **E. TEMPORARY AUDIT ARTIFACT — ARCHIVE OR DELETE**

| File | Purpose | Classification | Destination / action |
| --- | --- | --- | --- |
| `b1-authority-integrity-reassessment.md` | Why process-local authority replaces durable grants. | C | Archive, same filename (§6) |
| `b1-boundary-feasibility-investigation.md` | Docker/service feasibility under abandoned isolation contract. | D | Delete (§7) |
| `b1-trusted-kernel-store-isolation-investigation.md` | Same-user shell and project-plugin kernel/store exposure. | C | Archive, same filename (§6) |
| `cap-kernel-hosting-investigation.md` | Why authority lives in the local TUI plugin generation. | C | Archive, same filename (§6) |
| `charter.md` | Purpose/principles/threat model; accumulated runtime detail. | A | Keep; reconcile in place |
| `coding-authority-protocol.md` | Normative authority, candidate, freshness and effect contract. | A | Keep; reconcile in place |
| `hybrid-authorization-ux-decision.md` | Selected compact local UX; manual prototype comparison. | B | Merge into orchestration; archive original |
| `legacy-reference.md` | Predecessor research-use boundaries. | B | Merge into charter; delete |
| `m1-git-commit-effect-boundary-follow-up.md` | Why shell deny patterns cannot reserve the commit effect. | C | Archive, same filename (§6) |
| `m1-git-target-derivation-reassessment.md` | Rejected snapshot/temporary-index designs and limits. | C | Archive, same filename (§6) |
| `m1-implementation-planning-investigation.md` | Initial M1 implementation/API plan and commit blocker. | D | Delete (§7) |
| `m1-m2-runtime-simplification-investigation.md` | Completed cleanup's preservation/deletion specification. | E | Archive, same filename (§6) |
| `m1-m2-runtime-simplification-reconciliation.md` | Cleanup closure, integrity/test mapping and doc drift. | E | Archive, same filename (§6) |
| `milestone-0-dogfood-harness.md` | Removed M0 harness procedure, IDs and source provenance. | C | Archive, same filename (§6) |
| `milestone-0-human-authorization.md` | Completed M0 objective/criteria; old durable-grant contract. | D | Delete (§7) |
| `milestone-0-investigation.md` | Final M0 PASS and actual decision/bypass evidence. | C | Archive, same filename (§6) |
| `milestone-1-intent-implementation.md` | Completed M1 contract; duplicate rules/deleted harness. | D | Delete (§7) |
| `milestone-1-live-dogfood.md` | Live M1 authorization, cancellation and scope evidence. | C | Archive, same filename (§6) |
| `milestone-2-cap-gated-native-implementer-investigation.md` | Why direct native model calls cannot consume TUI grants. | C | Archive, same filename (§6) |
| `milestone-2-implementation-plan.md` | Spent native binding/admission file and test plan. | D | Delete (§7) |
| `milestone-2-implementer-session-ux-investigation.md` | Unselected root-navigation fallback; probe never run. | D | Delete (§7) |
| `milestone-2-live-dogfood.md` | Final same-child live PASS, dismissal and non-results. | C | Archive, same filename (§6) |
| `milestone-2-native-child-authority-handoff-investigation.md` | Earlier child rejection, persistent-role/crash analysis. | C | Archive, same filename (§6) |
| `milestone-2-native-child-threat-model-reassessment.md` | Final Candidate 1 decision: capability differs from grant. | C | Archive, same filename (§6) |
| `milestone-2-native-orchestrator-investigation.md` | Early generalized host gap; superseded native design. | D | Delete (§7) |
| `native-dx-ux-investigation.md` | Initial UI/whitespace alternatives; later narrowed. | D | Delete (§7) |
| `native-nonmodal-authorization-investigation.md` | Local callback feasibility, visibility/lifecycle and fallback. | C | Archive, same filename (§6) |
| `native-question-cap-reassessment.md` | Final Form/Question rejection via permitted model shell. | C | Archive, same filename (§6) |
| `native-subagent-result-presentation-investigation.md` | Final native-result rendering and zero-click limits. | C | Archive, same filename (§6) |
| `pre-m1-documentation-readiness-review.md` | Spent readiness checklist; settled B1/I1/I2. | E | Delete (§7) |
| `pre-m1-plugin-generation-revocation-probe.md` | Live late-affirmative revocation and pinned source. | C | Archive, same filename (§6) |
| `pre-m1-tui-git-hosting-probe.md` | Live local Git correspondence; no remote attestation. | C | Archive, same filename (§6) |
| `stock-opencode-hybrid-ux-investigation.md` | Unselected expandable plan-tool/server design. | D | Delete (§7) |
| `trusted-transcript-projection-investigation.md` | Import/append/inbox analysis and earlier projection gap. | C | Archive, same filename (§6) |
| `v1-orchestration.md` | Runtime sequencing/roles; stale integrated-flow claims. | A | Keep; reconcile in place |
| `zero-click-stock-opencode-plan-presentation-investigation.md` | Tool/hook/final-output limits and full-card fallback. | C | Archive, same filename (§6) |
| `documentation-cleanup-plan.md` | This temporary transition plan. | E | Archive, same filename (§6) |

Baseline classification counts: A=3, B=2, C=19, D=9, E=3. Including this report, E=4. B disposition is explicit: preserve hybrid evidence in history; remove the merged legacy note.

## 3. Proposed final documentation tree

README is navigation; charter owns direction, CAP normative authority, orchestration runtime/status. History is non-normative evidence at recorded revisions.

```text
docs/
  README.md
  charter.md
  coding-authority-protocol.md
  v1-orchestration.md
  history/
    README.md
    b1-authority-integrity-reassessment.md
    b1-trusted-kernel-store-isolation-investigation.md
    cap-kernel-hosting-investigation.md
    hybrid-authorization-ux-decision.md
    m1-git-commit-effect-boundary-follow-up.md
    m1-git-target-derivation-reassessment.md
    m1-m2-runtime-simplification-investigation.md
    m1-m2-runtime-simplification-reconciliation.md
    milestone-0-dogfood-harness.md
    milestone-0-investigation.md
    milestone-1-live-dogfood.md
    milestone-2-cap-gated-native-implementer-investigation.md
    milestone-2-live-dogfood.md
    milestone-2-native-child-authority-handoff-investigation.md
    milestone-2-native-child-threat-model-reassessment.md
    native-nonmodal-authorization-investigation.md
    native-question-cap-reassessment.md
    native-subagent-result-presentation-investigation.md
    pre-m1-plugin-generation-revocation-probe.md
    pre-m1-tui-git-hosting-probe.md
    trusted-transcript-projection-investigation.md
    zero-click-stock-opencode-plan-presentation-investigation.md
    documentation-cleanup-plan.md
```

Filenames already carry context. No milestone/UX/foundations subdirectories are needed. The history index should fit roughly one page: final outcomes, retained evidence and pinned Git originals.

## 4. Current-document ownership

Duplication map: define rules once in current docs; historical copies remain evidence.

| Topic | Canonical owner | Remove duplication from |
| --- | --- | --- |
| Purpose/goals/non-goals; predecessor research | `charter.md` | CAP/orchestration product exclusions; merge legacy note |
| Threat model/TCB and ordinary-shell limits | `coding-authority-protocol.md` | Charter hosting/evasion detail; orchestration §2/roles |
| Exact proposal/candidate, immutable text/files/root/HEAD | `coding-authority-protocol.md` | Charter Git manual; orchestration Planner/Implementer/§5/§9; hybrid |
| Human decision/exact binding/fail-closed semantics | `coding-authority-protocol.md` | Charter; orchestration §§5/6/8/9; hybrid security restatement |
| Process-local purpose/single-use/revocation/no recovery | `coding-authority-protocol.md` | Charter lifecycle; orchestration §§2/6/7/8/9; hybrid |
| Initial/admission freshness; Git scope/rename/observation limits | `coding-authority-protocol.md` | Charter Git paragraphs; orchestration Implementer/§5/§9; milestone contracts |
| Role/context separation and authority limits | `coding-authority-protocol.md` | Charter/orchestration repeated MUST rules |
| Role IDs/permissions, native binding, plugin events/modules | `v1-orchestration.md` | Charter flow; CAP M2 tutorial |
| Actual flow: live publication versus retained implementation | `v1-orchestration.md` | Charter/CAP milestone status; hybrid “currently modal” claim |
| Selected future authorization UX/handoff | `v1-orchestration.md`, future section | Merge hybrid direction; archive prototype comparison |
| Reviewer/validation/Commit obligations | `coding-authority-protocol.md`, future contract | Charter six-fact promise; orchestration hypothetical pipeline |
| Reviewer/Commit priority/status | `v1-orchestration.md`, future section | Repeated “Reviewer is next” claims |
| Versioned host findings/history/evidence | `history/README.md` + artifacts | CAP §12; charter history; orchestration historical comparisons |
| Reading order and concise delivered/future status | `docs/README.md` | No other current index/roadmap |

Remove internal duplication too: CAP §§2/6/8/10 repeat lifetime/consumption; §§5/6/9/10 repeat freshness/scope. Define once and link from a checklist. Orchestration §§1/3/4/5/9 repeat the flow: use two diagrams, a role table and one binding explanation. Cross-owner summaries need only a sentence/link.

## 5. Exact reconcile/merge plan

### `docs/README.md` — create

One-screen entry: three owners/normative scope, “Implemented / retained but unwired / future” table, source/tests and history links. A published Plan grants no authority. Do not list all experiments or repeat CAP.

### `docs/charter.md` — shorten

Remove milestone status, /m1 availability, working-M2 claims, native navigation, Git/admission procedures, teardown/ambiguous-commit mechanics, historical M0 ending and six-fact passage implying future guarantees are delivered. Move runtime detail to orchestration, normative detail to CAP, chronology to history.

Retain purpose, mechanical authority/independent roles as principles, high-level local trust/shell limits, goals and explicit non-goals. Published-plan authorization precedes integrated Reviewer work. Merge legacy's small principle: predecessor is an invariant/failure/technique reference, never architecture/compatibility target. `AGENTS.md` already supports this and needs no edit.

### `docs/coding-authority-protocol.md` — reconcile

Remove §1 chronology, current M1/M2 names, §12 dogfood narrative and solved §13 questions. Remove SQLite technology suggestions/root-child historical comparisons; retain non-authorizing durable/session records.

Own authority versus host capability; exact proposal/candidate/result binding; trusted human decision; clean initial/admission freshness; process-local purpose/single-use/revocation; distinct roles; ordinary Git scope; fail-closed/no replay; separate commit authority.

Keep exactly `{intent, plan, files}`, immutable text/file order, finite unique exact repository-relative files, and current directory/pattern/escape/.git/unsafe-parent exclusions. No substituted fields. Scope uses equality; serialization preserves listed order. Trusted root/HEAD bind the candidate. Link `proposal.ts` for existing fixed-key JSON `kind,intent,plan,files,root,head` and SHA-256 instead of leaving intent encoding unresolved.

Distinguish publication from authority-seeking presentation. Preserve normative cleanliness **before native bootstrap**: dirty-but-stable publication does not satisfy it; post-bootstrap checks cannot prove it retrospectively. Future integration must enforce it, without weakening CAP or reopening cleanup.

Keep strict `true` for retained modal authorization; future local callbacks must meet the same candidate/decision/liveness/freshness requirements and remain marked unimplemented. Form/Question, prose, IDs/digests and generic permissions cannot authorize.

Keep unchanged HEAD, staged/unstaged/ordinary-untracked scope, both observable rename paths, ignored-untracked exclusion and ordinary-shell/evasion limits. Scope PASS does not certify semantics/exact review target/commit readiness. Role prohibitions/direct command denials are defense in depth, not containment.

Keep a short **future** reviewed-target commit contract: independent review/reviewer-owned validation, exact prepared target/paths, distinct fresh authorization, consumed bounded effect and verified Git outcome; read-only ambiguous-commit reconciliation/no replay. Move host sequencing to orchestration and rationale to history.

### `docs/v1-orchestration.md` — actual runtime

Replace milestone narratives/current /m1 diagram/integrated happy path with:

```text
LIVE
activation baseline → fresh root Orchestrator → Planner → implementer_slot
→ root completes → trusted binding → candidate + synthetic Plan publication
→ idle

RETAINED, TESTED; NOT WIRED FROM PUBLICATION
clean/fresh baseline + native binding → trusted modal authorization
→ same slot switches → consume once → exact implementation prompt/result
→ unchanged HEAD + ordinary Git scope gate → stop
```

Add four-module map (`attempt.ts`, `cap.ts`, `git.ts`, `proposal.ts`) and plugin's sole entry `publishPlan`. Explain one fresh eligible root/attempt per activation, completion trigger, exact two foreground calls, Planner read/search, inert READY slot, IDs/location/outcomes/permission overrides and immutable histories/results. One permissions table lists Orchestrator's two targets, read-only roles, authorized read/edit/shell and denied delegation/execute/session-control. Link CAP for rules; persistent role capability is not a grant. Bootstrap/implementation share a slot, separate from Planner context.

Explain raw Planner text versus deterministic Plan description, `resume:false`, returned payload checks and immediate root-wake check/diagnostic. Candidate digest differs from short raw-plan hash. Synthetic is an inbox input used for non-authorizing presentation, **not a general display-only append API**; later root turns can see it as model input. Implementation currently rejects this extra parent input.

Delete repeated CAP/Git/failure specifications, hypothetical review state and solved binding questions. Keep concrete attempt-local references, pagination validation and revoke-first/await guards as runtime facts.

Merge hybrid's selected future direction: readable bound Plan plus compact `session.composer.top` strip with direct TUI-local Authorize/Cancel. Archive layout/provenance/non-decisions. Projection exists; strip, handoff and result/STOP UX do not.

List future work once: retained candidate/history binding across publication; pre-bootstrap clean enforcement/admission freshness; positive callback/one-use dispatch; result/STOP; then exact review target, Reviewer/validation and distinct Commit. Keep stock unmodified OpenCode scope; reject abandoned presentation-tool/workflow machinery.

The agent claim that TUI “handles confirmation and admission” is also stale (reconciliation §14). Record discrepancy, but leave agents/plugins untouched; wording repair needs a separate scope.

## 6. Archive plan

Exact moves after merging decisions. Both columns are relative to `docs/`; prepend `docs/` to each:

| Source | Destination |
| --- | --- |
| `b1-authority-integrity-reassessment.md` | `history/b1-authority-integrity-reassessment.md` |
| `b1-trusted-kernel-store-isolation-investigation.md` | `history/b1-trusted-kernel-store-isolation-investigation.md` |
| `cap-kernel-hosting-investigation.md` | `history/cap-kernel-hosting-investigation.md` |
| `hybrid-authorization-ux-decision.md` | `history/hybrid-authorization-ux-decision.md` |
| `m1-git-commit-effect-boundary-follow-up.md` | `history/m1-git-commit-effect-boundary-follow-up.md` |
| `m1-git-target-derivation-reassessment.md` | `history/m1-git-target-derivation-reassessment.md` |
| `m1-m2-runtime-simplification-investigation.md` | `history/m1-m2-runtime-simplification-investigation.md` |
| `m1-m2-runtime-simplification-reconciliation.md` | `history/m1-m2-runtime-simplification-reconciliation.md` |
| `milestone-0-dogfood-harness.md` | `history/milestone-0-dogfood-harness.md` |
| `milestone-0-investigation.md` | `history/milestone-0-investigation.md` |
| `milestone-1-live-dogfood.md` | `history/milestone-1-live-dogfood.md` |
| `milestone-2-cap-gated-native-implementer-investigation.md` | `history/milestone-2-cap-gated-native-implementer-investigation.md` |
| `milestone-2-live-dogfood.md` | `history/milestone-2-live-dogfood.md` |
| `milestone-2-native-child-authority-handoff-investigation.md` | `history/milestone-2-native-child-authority-handoff-investigation.md` |
| `milestone-2-native-child-threat-model-reassessment.md` | `history/milestone-2-native-child-threat-model-reassessment.md` |
| `native-nonmodal-authorization-investigation.md` | `history/native-nonmodal-authorization-investigation.md` |
| `native-question-cap-reassessment.md` | `history/native-question-cap-reassessment.md` |
| `native-subagent-result-presentation-investigation.md` | `history/native-subagent-result-presentation-investigation.md` |
| `pre-m1-plugin-generation-revocation-probe.md` | `history/pre-m1-plugin-generation-revocation-probe.md` |
| `pre-m1-tui-git-hosting-probe.md` | `history/pre-m1-tui-git-hosting-probe.md` |
| `trusted-transcript-projection-investigation.md` | `history/trusted-transcript-projection-investigation.md` |
| `zero-click-stock-opencode-plan-presentation-investigation.md` | `history/zero-click-stock-opencode-plan-presentation-investigation.md` |
| `documentation-cleanup-plan.md` | `history/documentation-cleanup-plan.md` |

Move this plan only after execution. Keep paired runtime audits: investigation specifies preservation; reconciliation maps actual checks/tests and closes cleanup. Neither stays a current reading prerequisite.

One short index resolves chains:

| Chain | Final conclusion / retained evidence | Intermediates replaced by index |
| --- | --- | --- |
| B1/kernel | Adopted CAP after `de59dca`; hosting selection. Retain isolation exposure, authority reassessment, hosting and both live probes; mark stronger isolation/verifier unadopted. | Docker feasibility and spent readiness checklist |
| M0 | Investigation final PASS/limits; harness procedure/IDs/pinned source | Objective/specification; old durable-store claim superseded |
| M1 Git | CAP ordinary scope after `9ebab47`, M1 live evidence; retain commit-effect trace and rejected target/temporary-index reassessment | Initial file plan and duplicate contract |
| Native authority | Threat reassessment final Candidate 1; M2 live PASS. Retain direct-call gating and contrary handoff analysis: capability differs from admission. | General host-gap report, root-navigation fallback, implementation plan |
| Question/nonmodal/hybrid | Question rejects model affirmative route; nonmodal establishes local callbacks; hybrid records manual preference | Broad DX report; whitespace STOP survives M2 dogfood; extra Planner turn unselected |
| Projection/stock/zero-click/native result | Current publication/reconciliation supersede gap status. Retain import/inbox analysis, tool/hook limits and native renderer findings as rejected-path evidence. | Expandable stock-tool design; index explains fallbacks preceded synthetic publication |
| Runtime simplification | Reconciliation: **COMPLETE — NO RUNTIME GAPS** | Keep both transition audits; archive this plan after cleanup |

Preserve versions, failures and non-results. M2 reload command did not reload a generation; pre-M1 late-affirmative probe supplies that evidence. The index replaces repeated intermediate reasoning/navigation, not unique security traces or observed results.

## 7. Delete candidates

Paths below are exact; all are under `docs/`. The historical-index/current-owner preservation must precede deletion.

| File | Where the useful conclusion survives |
| --- | --- |
| `docs/b1-boundary-feasibility-investigation.md` | Isolation report preserves same-user/MCP boundary failures; authority reassessment and CAP preserve why physical isolation is unnecessary. Its Docker-provider experiment was never adopted or run. |
| `docs/m1-implementation-planning-investigation.md` | Commit-effect follow-up preserves the unique blocker/source trace; hosting probes preserve lifecycle facts; CAP/current runtime and M1 dogfood preserve proposal/admission/Git outcome. Initial file plan has no remaining evidence value. |
| `docs/milestone-0-human-authorization.md` | M0 investigation preserves the precise decision-boundary question, falsification matrix, PASS criteria/outcome and proof limits; harness preserves actual procedure. Old durable-grant requirement is superseded. |
| `docs/milestone-1-intent-implementation.md` | CAP preserves the exact proposal/freshness/scope contract; M1 dogfood preserves achievement and limits; runtime audits preserve harness retirement. No unique measured result is lost. |
| `docs/milestone-2-implementation-plan.md` | Threat-model reassessment preserves selected same-child admission ordering; M2 dogfood preserves observed behavior; cleanup investigation/reconciliation preserve native binding/test map and the initial-clean obligation. Proposed files/tests are spent. |
| `docs/milestone-2-implementer-session-ux-investigation.md` | Native-child handoff preserves the root-session fallback and navigation tradeoff; threat reassessment/M2 dogfood preserve why the selected child relationship works. The proposed root-navigation probe supplied no measured evidence. |
| `docs/milestone-2-native-orchestrator-investigation.md` | CAP-gated report preserves the missing direct-call/TUI gate and candidate alternatives; threat reassessment preserves the read-only-bootstrap resolution. Initial generalized HOST GAP adds no independent result. |
| `docs/native-dx-ux-investigation.md` | M2 dogfood preserves exact prompt-mismatch/whitespace STOP; Question reassessment corrects the actor boundary; non-modal and projection reports preserve UI/API limitations. Current binder preserves exact request equality. Unselected trusted Planner continuation is unnecessary history. |
| `docs/stock-opencode-hybrid-ux-investigation.md` | Zero-click report preserves generic-tool/hook rendering limits; native-result report preserves result visibility; projection report preserves import/append constraints. The extra presentation-tool/server design was not selected. |
| `docs/pre-m1-documentation-readiness-review.md` | B1 reassessment and final CAP preserve settled B1/I1/I2; future Review/Commit obligations retain I3. Historical index records that durable-authority activation prompted the review. Spent checklist is E-delete. |
| `docs/legacy-reference.md` | Merge its short principle into charter; `AGENTS.md` already carries the working repository boundary. B-merge-delete, not an experiment to archive. |

These are **recommendations**, not deletions performed by this audit. Git retains their complete text at the starting checkpoint. References needed for historical claims should resolve to pinned originals, e.g. `https://github.com/mikechao/opencode-agents/blob/bf8d5f34324f97f7c11be9437e50ae09fe167aaa/docs/<filename>`. A pinned original preserves context better than a link to a rewritten current contract when the archived claim concerned a different contract.

## 8. Link/reference impact

Root README is empty; `AGENTS.md` and agent/plugin Markdown have no docs navigation needing repair. Search literal paths as well as links.

| Affected references | Minimal repair |
| --- | --- |
| Charter/CAP/orchestration → M2 reassessment/dogfood | Replace milestone prose; evidence links become `history/<filename>` or index |
| Hybrid → dogfood/Question/nonmodal; M1 dogfood → M2; gating/handoff → reassessment; reconciliation → investigation | Basename links survive shared flat move |
| Archives → charter/CAP/orchestration | `../<current-file>`; pin old text for historical contract claims |
| B1 → deleted readiness/Docker; commit follow-up → deleted M1 plan/contract; target reassessment → deleted contract | Pin originals |
| M2 dogfood → deleted implementation plan | Pin original; retain reassessment |
| Question/nonmodal/projection/native-result → deleted DX; zero-click/native-result → deleted stock report | Pin precise evidence; navigation-only references can point to final retained report/index |
| Moved reports → repository `../src`, tests, agents, packages/declarations; sibling `../../opencode`/codex | Add parent level: repository `../../...`, siblings `../../../...` |
| Removed milestone source/tests/probes; `.md:10`; rewritten headings | Pin code to recorded revision; convert line suffix to GitHub `#L10`; check new anchors |
| Literal paths/this plan after move | Repair navigation; preserve quoted historical paths; local evidence/prototypes are provenance |

Add brief historical banners; preserve bodies/verdicts apart from banners/link repair. No stubs/symlinks/redirects. Host-source permalinks use recorded revision, not today's checkout. Do not substitute current code/contracts for different old implementations.

## 9. Cleanup sequence

Two proposed documentation-only commits; **this audit makes none**.

1. **Current ownership.** Create docs README; shorten/reconcile charter/CAP/orchestration; merge hybrid/legacy decisions. Verify publication-only wiring and normative clean-admission obligations against source/tests. Inspect changed paths for docs-only scope.
2. **Archive/prune/reference repair.** Execute §6/§7, create historical index/banners, repair links together. Move this plan when fulfilled. Preserve verdicts; pin deleted evidence. Check move/delete counts, inventories, local destinations and rewritten anchors.

For each commit run `bun test`, `bun run typecheck`, `git diff --check`, and `git diff --name-status`. Additional later checks:

```sh
find docs -maxdepth 1 -type f -name '*.md' -print | sort
find docs/history -maxdepth 1 -type f -name '*.md' -print | sort
rg -n '/m1|runM1|runM2|src/m[12]/|M1 PASS|M2 PASS' docs/*.md
rg -n 'milestone-|investigation|reassessment|legacy-reference|pre-m1' docs/*.md
rg -n '\]\(|docs/|src/m[12]/|test/m[12]\.test' docs README.md AGENTS.md
```

Searches are review aids: historical evidence links are valid, obsolete runtime claims are not. A read-only relative-link/anchor script should distinguish pinned URLs/provenance from local resources. No installed checker/OpenCode/Docker is needed.

**Audit verification:** `bun test` passed: 45 tests, 0 failures, 459 assertions across four files. `bun run typecheck` passed. `git diff --check` passed; the new untracked report was also checked explicitly with `git diff --no-index --check -- /dev/null docs/documentation-cleanup-plan.md`. Before/after inventories contain 36 → 37 top-level Markdown files. Inventory validation confirms 37 unique classified rows and all ten required sections. Starting HEAD is unchanged; the sole repository change is this report.

## 10. Final recommendation

**README + charter + CAP + orchestration** is the current set. Hybrid remains selected future UX within orchestration; its original is evidence. Archive 22 existing artifacts plus this plan; delete 11 after merges/reference preservation. One historical index prevents milestone reports becoming prerequisites for understanding today’s system.
