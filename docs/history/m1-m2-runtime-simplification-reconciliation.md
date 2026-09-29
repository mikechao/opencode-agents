# M1/M2 Runtime Simplification Reconciliation

**Historical evidence.** This document records investigation, design, or observed behavior at an earlier repository state. It is not current normative documentation. See [`../README.md`](../README.md) for the current documentation map.

## 1. Executive conclusion

**COMPLETE — NO RUNTIME GAPS**

The current local runtime faithfully implements the simplification selected in [the investigation](m1-m2-runtime-simplification-investigation.md). It has four milestone-free modules, preserves the native integrity sequence, removes the standalone M1 harness and its only registered entry, and keeps publication separate from implementation authority. No required runtime check was lost, weakened, or unexpectedly replaced. No obsolete harness or milestone compatibility layer was found.

The live TUI publishes a bound plan only. `runImplementationAttempt()` survives as a callable, tested implementation boundary, without a production caller. This separation is required by the investigation, not an incomplete refactor. Publication still permits a stable ordinary Git delta; implementation admission still requires current cleanliness. Neither a retained candidate nor a synthetic publication authorizes implementation.

Normative documentation contains stale current-runtime statements. Those are documentation drift, not runtime gaps. Some individual defensive branches lack direct negative tests, as detailed in §11; no required invariant group or original preservation assertion was lost. There is no blocker to closing this runtime simplification. This conclusion establishes source reconciliation and regression verification, not a new live OpenCode dogfood result.

## 2. Reconciliation baseline

Inspection began with the requested commands, before reading implementation files or writing this report:

```text
git rev-parse HEAD
a5e2e8119ff0c1c32dfd9951d59d5569f9e492fb

git status --porcelain=v1 --untracked-files=all
(no output)
```

HEAD exactly matches the expected checkpoint. The starting worktree was clean; there were no unrelated changes to preserve or checkpoint discrepancies to assess.

| Baseline / verification | Actual result |
| --- | --- |
| Investigation source baseline | `1e15ed431c964d16c47a6ce6550d9b582379e98c`, as recorded in the investigation; historical source inspected with `git show` / `git diff` |
| Investigation document commit | `45bf8e5` |
| Separate dependency update | `80802ce`: `@opencode/plugin` changed from `2.0.19` to `2.0.20` before the three simplification phases |
| Phase 1 | `b0dd193` — primitive relocation and CAP extraction |
| Phase 2 | `29d2ce5` — native promotion, naming, coverage and test split |
| Phase 3 / current HEAD | `a5e2e81` — remaining harness and registration removal |
| Current OpenCode plugin dependency | `package.json`, `bun.lock`, and installed `node_modules/@opencode/plugin/package.json` agree on `2.0.20`; installed plugin depends on `@opencode/client` `2.0.20` |
| Selected read-only upstream reference | `../opencode` HEAD `84c9be93a56304a108f1a22df0c5d62c26d5b6ca`; its plugin package version is `2.0.20` |
| `bun test` | Exit 0; Bun `1.3.13 (bf2e2cec)`; **45 pass, 0 fail, 459 expect() calls**, 4 files, **17.49s** |
| `bun run typecheck` | Exit 0; `tsc --noEmit`; no diagnostics |
| `git diff --check` | Exit 0; no output, before and after report creation |
| Repository changes from this task | Only `docs/m1-m2-runtime-simplification-reconciliation.md` |

The dependency update is a recorded, intentional difference from the investigation baseline, not a hidden part of the module extraction. Current types and selected upstream source agree with the relied-upon native contracts. No live compatibility result is inferred from that agreement.

`package.json` retains only the test and typecheck scripts. `tsconfig.json` includes the plugin, all source modules and tests; strict checking and `noEmit` remain enabled. Verification uses fake OpenCode contexts and temporary Git fixture repositories. No OpenCode or Docker was launched; no upstream checkout was modified, built, or run; no commit or push was performed. Historical investigation and dogfood documents remain unchanged.

## 3. Final runtime architecture

The complete source and test inventories are:

```text
src/                         test/
  cap.ts                       cap.test.ts
  git.ts                       git.test.ts
  proposal.ts                  proposal.test.ts
  attempt.ts                   attempt.test.ts

.opencode/plugins/opencode-agents/tui.ts
.opencode/agents/{opencode-agents,planner,implementer_slot,authorized_implementer}.md
```

Actual local import direction:

```text
tui.ts
  -> cap.ts       (Generation type)
  -> git.ts       (activation observation)
  -> proposal.ts  (IntentCandidate type)
  -> attempt.ts   (publishPlan only)

attempt.ts
  -> cap.ts       (liveness, grant creation/consumption)
  -> git.ts       (observation, clean freshness, exact scope)
  -> proposal.ts  (validation, candidate integrity, presentation)

cap.ts -> proposal.ts (candidate integrity and type)
git.ts -> Node child-process/filesystem APIs only
proposal.ts -> Node crypto/filesystem/path APIs only
```

The plugin and attempt module also import OpenCode types; `attempt.ts` uses Node crypto and filesystem APIs. The graph is the investigation's intended fan-out, not a serial chain between independent primitives. There is no cycle, unexpected coupling, generic session abstraction, workflow framework, barrel, milestone alias, `src/m1/`, or `src/m2/`. Both old directories were checked for filesystem existence and are absent.

`attempt.ts` exports exactly the expected responsibilities: `candidateFits`, `implementerPrompt`, `SLOT_PROMPT`, `plannerInput`, `publishPlan`, and `runImplementationAttempt`. Native binding and switching helpers remain private and cohesive in that file. Agent Markdown remains host-loaded configuration, not a TypeScript dependency.

## 4. Investigation recommendation reconciliation

Evidence locations below refer to the inspected current checkpoint unless an old revision is stated.

| Investigation recommendation | Current implementation | Status | Evidence |
| --- | --- | --- | --- |
| Four-module runtime | Only `cap.ts`, `git.ts`, `proposal.ts`, `attempt.ts`; intended import graph | MATCH | Source inventory; imports in `attempt.ts:1–8`, `tui.ts:1–5` |
| CAP extraction | Five intended types/functions only; definitions unchanged apart from their import/home | MATCH | `cap.ts:1–30`; byte comparison with baseline M1 definitions |
| Git relocation | Entire file preserved byte-for-byte | MATCH | `git diff 1e15ed4:src/m1/git.ts HEAD:src/git.ts` is empty; direct byte comparison agrees |
| Proposal relocation | Entire file preserved byte-for-byte, including serialization field order | MATCH | `git diff 1e15ed4:src/m1/proposal.ts HEAD:src/proposal.ts` is empty; direct byte comparison agrees |
| Native attempt promotion | Original native binder and both entry paths in `src/attempt.ts`; fit/prompt moved from M1 | MATCH | Cross-path baseline diff; `attempt.ts:10–334` |
| Publication rename | `publishM2PlanDogfood` becomes `publishPlan` | MATCH | `attempt.ts:245`; only plugin entry call at `tui.ts:29` |
| Implementation rename | `runM2` becomes `runImplementationAttempt` | MATCH | `attempt.ts:279`; callers confined to `test/attempt.test.ts` |
| Publication baseline rename | `requireDogfoodBaseline` becomes private `requirePublicationBaseline`, same policy | MATCH | `attempt.ts:60–63,254,257` |
| M1 harness deletion | `runM1`, generic sessions, model copying, collector and harness reports removed | MATCH | Runtime/test residue search (§12); historical-to-current diff |
| `/m1` deletion | App slot, keymap/slash registration and `removeSlot` removed; no replacement entry | MATCH | Entire current `tui.ts`; search for registration and slash plumbing |
| Test split and parity transfer | Four test files; original seven primitive and seventeen native groups retained; added cases survive | MATCH | §11; old tests read at `1e15ed4` and compared with current suite |
| Agent wording only | Orchestrator description and Implementer observation wording updated; IDs/permissions unchanged | MATCH | Baseline diff for `.opencode/agents`; §10 |
| Milestone terminology removal | Required runtime/test/agent search produces no matches | MATCH | Exact command and exit recorded in §12 |
| Publication-only TUI | Success event calls only `publishPlan`; no authorization callback | MATCH | `tui.ts:26–42`; plugin tests at `attempt.test.ts:371,394,589,618` |
| Retained implementation path | Full modal-confirm / same-slot / one-prompt / Git-gate path remains tested | MATCH | `attempt.ts:279–334`; native success and rejection tests |
| Do not reconnect publication/authorization | Published candidate/hash is not passed to implementation; synthetic input still fails binder | MATCH | `attempt.ts:123–143,279–290`; `attempt.test.ts:535–546` |
| Preserve generation and diagnostics | Activation-local state, attempted-before-async, revoke-first cleanup, wake diagnostic | MATCH | `tui.ts:10–61`; §9 |
| Three independently verifiable phases | Commits establish primitives, promote/test native attempt, then delete harness | MATCH | `b0dd193`, `29d2ce5`, `a5e2e81`; phase diffs and current regression run |
| Baseline dependency context | Plugin version advanced separately from `2.0.19` to `2.0.20` | INTENTIONAL DIFFERENCE | `80802ce`, `package.json`, `bun.lock`, installed package and selected upstream |
| Later normative-doc reconciliation | Current-harness and live-authorization claims remain stale; runtime is already simplified | STALE DOCUMENTATION ONLY | Exact locations in §14 |

No recommendation is classified as a runtime `GAP`. The sequencing assessment describes the actual commit contents; it does not claim to have rerun every historical phase checkpoint.

## 5. CAP and proposal integrity

`cap.ts` contains only `Generation`, `IntentGrant`, `assertLive`, `grantIntent`, and `consumeIntent`. Its extracted definitions are byte-identical to the investigation baseline. `Generation` remains a passed process object with `revoked` and `busy`; attempt code owns busy acquisition/release. No ID, phase, registry, durable grant, session-derived authority, or global candidate state was introduced.

`grantIntent()` first rejects revoked generations, requires confirmation strictly equal to `true`, and requires `candidateIntact()`. The grant is an ordinary trusted object containing candidate digest, purpose `implement`, and an initially false consumed bit. `consumeIntent()` again checks liveness, exact purpose and digest, candidate integrity and non-consumption, then marks it consumed. False and undefined decisions grant nothing. Confinement and the caller's generation reference supply the generation boundary; grants do not cryptographically attest a generation or independently prevent transfer by trusted code. That is the investigation's stated trust model.

`proposal.ts` is unchanged, including every private validation helper:

- Parsed objects must have exactly `{ intent, plan, files }`. Intent/plan must be nonempty after testing whitespace, but their original strings are retained. Existing unsafe-control checks reject the same characters and continue permitting newline.
- Scope is a finite array with duplicate rejection. Entries must be exact repository-relative file paths: no absolute path, backslash, NUL, empty segment, dot/traversal segment, `.git` segment, directory, or glob syntax. No implicit directory scope or prefix expansion is introduced.
- Existing ancestor entries must be actual directories and cannot be symlinks. Missing ancestors/new files remain allowed. Existing final symlinks resolving within the worktree remain allowed; escaping final symlinks remain rejected. The original ENOENT behavior, including missing targets, is unchanged.
- No trimming, normalization, scope sorting, or reordering occurs. Parsed proposal and copied file array are frozen; the produced candidate is frozen.
- Encoding remains `JSON.stringify({ kind: "intent", intent, plan, files, root, head })` in precisely that field order. SHA-256 hashes that encoding. Canonical root, bound HEAD, exact strings and original file order therefore remain bound. Integrity recomputes the encoding/digest and compares both.
- `renderPlan()` remains the deterministic multiline presentation, preserves plan text and scope order, includes bound HEAD, and explicitly says no implementation has been authorized. `candidateMessage()` remains the complete trusted confirmation text, with JSON-quoted exact paths/root and implementation-only/no-commit notice.

The validated proposal and trusted candidate are the artifact source; rendering is a projection. Publication's raw P hash is a separate truncated diagnostic hash, not the candidate digest and not a grant. Exact encoding, root/HEAD and order mutation cases are directly asserted in `proposal.test.ts:65–88`, while corrupt candidate/grant and revocation checks are in `cap.test.ts:30–84`.

## 6. Git boundary integrity

No Git observation behavior drift was found. Byte-identical relocation preserves:

| Boundary | Preserved implementation |
| --- | --- |
| Canonical root | `realpathSync(location)` must equal canonical `rev-parse --show-toplevel`; subdirectories are rejected |
| Bound HEAD | `rev-parse --verify HEAD^{commit}` and 40/64-character hexadecimal validation; supplied baseline root/HEAD must match |
| Read-only invocation | Every subprocess uses `git --no-optional-locks`; observer never writes an index/tree, refreshes/stages files, resets, or commits |
| Staged paths | `diff-index --cached --no-renames --name-only -z <head> --` |
| Unstaged tracked paths | `diff-files --no-renames --name-only -z --` |
| Ordinary untracked paths | `ls-files --others --exclude-standard -z --`; ignored untracked files excluded |
| Exact parsing | Required final NUL, fatal UTF-8 decoding, invalid/empty/absolute/dot/traversal/`.git` segment rejection; newline filenames remain exact |
| Combined result | Union, deduplication and sorting of all three observations; frozen snapshot/path array |
| Final rechecks | Location/root canonicalization and verified HEAD rechecked after observing paths |
| Fresh implementation | `requireFresh()` requires same root, same HEAD, **zero current ordinary changed paths** |
| Result scope | `requireInScope()` requires same root/HEAD and exact membership in the authorized file set; no prefixes/globs; all observed paths are checked regardless of attribution |

`--no-renames` preserves visibility of both rename endpoints. An authorization containing only the destination fails when the source is also observed. The suite retains staged/unstaged/untracked, deletion, rename, divergent staged/worktree union, unchanged index listing, ignored files, `.bak` scope rejection, root rejection, HEAD change and newline filename assertions (`git.test.ts:29–117`).

Publication deliberately uses a different private policy (`attempt.ts:60–63`): root/HEAD are still enforced by `observeGit(directory, baseline)`, and the current sorted changed-path array must equal the activation array. Stable pre-existing ordinary changes can be presented. This neither compares file bytes nor grants authority. It is not implemented with `requireFresh()` and is never reused for implementation admission.

Implementation rechecks current cleanliness at entry, after binding/before confirmation, after confirmation/rebinding and immediately before its trusted prompt (`attempt.ts:286,289,306,314`). As already recorded in the investigation, `requireFresh()` does not demand `baseline.paths.length === 0` and cannot retrospectively prove cleanliness before native bootstrap. That known integration limitation is unchanged, not a lost simplification requirement or a new runtime gap.

## 7. Native attempt integrity

Comparing baseline `src/m2/attempt.ts` to current `src/attempt.ts` shows relocation/import changes, moved fit/prompt helpers, required entry/helper renames, and milestone-free text. The native verifier bodies and admission order are preserved. No substantive native check was merged, weakened, deleted or moved outside the cohesive attempt sequence.

| Integrity responsibility | Current evidence and behavior |
| --- | --- |
| Exact parent identity | `successful()` / `bind()` (`90–94`, `170–196`): exact ID, root role, no parent/fork, expected directory, succeeded idle outcome, zero session overrides |
| Exact parent input/calls | `parentCalls()` (`123–143`): one first plain user input, one successful completed turn, only expected message kinds, nonempty final, exactly two distinct native calls in Planner-then-slot order |
| Fixed native arguments | `completedCall()` (`107–122`): exactly agent/description/prompt; completed tool and metadata; no continuation, model or background key; distinct call/child/assistant-message IDs and exact prompts checked by `parentCalls()` |
| Exact native result wrapper | `completedCall()` validates shape; `resultMatches()` (`161–168`) compares the full wrapper against exact child text. Child final text is concatenated without trimming |
| Message defenses | `messages()` (`69–82`) follows pages, rejects repeated cursors and duplicate message IDs |
| Planner/slot identity | `bind()` requires exact child ID, parent ID, role, location, successful idle outcome, no fork/overrides; each child receives exactly one plain prefixed bootstrap input |
| Planner isolation | `verifyChildHistory()` (`144–160`) allows only completed `read`, `glob`, `grep`; exact result is independently read and bound to the parent wrapper |
| Inert slot | Same verifier rejects every bootstrap tool and any result other than exact `READY`; no Planner conversation is passed to the slot |
| Idle / inbox | `idle()` (`83–89`) independently rejects active execution or pending inbox for bound sessions |
| Transcript snapshot/rebinding | `bind()` saves complete serialized parent/Planner/slot histories and invocation/result identities; post-confirmation rebinding compares all of them |
| Human confirmation/readability | Full `candidateMessage()` must fit before showing the modal; only `true` passes; location, candidate integrity and fit are checked again afterward (`291–305`) |
| Freshness / process grant | Clean Git checks bracket binding/confirmation; only after rebinding and freshness does `grantIntent()` run (`286–307`) |
| Same-slot role switch | One `switchAgent()` targets the bound slot, never a replacement child (`308–309`); same parent/location/zero overrides required in the authorized role |
| Both pre-prompt switched-slot checks | `switchedSlot()` at `310` and `312` brackets awaited parent/Planner verification. It checks exact unchanged bootstrap, exactly one slot→authorized switch, and no input after switch |
| Parent/Planner immutability after switch | `verifyParentPlanner()` (`198–216`) rechecks identity, idle/inbox and full histories, native calls and result wrappers |
| Liveness around awaits | `after()` checks after host promises; entry/confirmation/switch/publication/prompt boundaries retain explicit liveness guards; final observation/scope checks also guard. Busy releases in `finally` |
| Consumption / exactly one trusted prompt | `consumeIntent()` executes at `317` before the sole `session.prompt()` at `319`. Returned session/type/text/attachments/nonempty ID are checked; no retry or replacement session follows ambiguous switch or prompt |
| Authorized result | Wait followed by `switchedSlot(..., input)` (`324–325`) requires exact returned input ID/text, no attachments or extra control/input, one successful authorized final and successful idle outcome in the exact same slot |
| Final HEAD / exact scope | Independent `observeGit()` then `requireInScope()` (`326–329`) checks unchanged root/HEAD and exact resulting path membership |

`candidateFits()` retains the original width/height and conservative character-width policy. `implementerPrompt()` loses only its milestone parameter/labels; exact frozen proposal, root/HEAD, authorized file restriction, no history effects, no observation evasion, no new approval/scope change and unchanged HEAD instructions all remain. The success test independently spells out the full expected prompt (`attempt.test.ts:147–170`).

The parent role's exact final sentence remains an instruction rather than an enforced binder equality: the binder requires a nonempty final. The fake uses different prose. The investigation explicitly identified this existing presentation difference; no authority is obtained from that prose. Directory-only session-location comparison is likewise unchanged and makes no broader host attestation claim.

## 8. Publication/authority separation

The live path remains:

```text
fresh root opencode-agents session
  -> foreground native Planner child
  -> foreground native implementer_slot child, exact READY
  -> root completes and becomes idle
  -> TUI success event -> publishPlan(...)
  -> wait + independently bind exact parent/children/results
  -> parse/freeze exact raw Planner P with activation root/HEAD
  -> render deterministic human-readable description
  -> idle/inbox recheck
  -> synthetic(text=P, description=renderPlan(candidate), resume:false)
  -> verify returned admission and immediate root inactivity
  -> retain candidate/hash locally; no implementation authority
```

`publishPlan()` (`attempt.ts:245–277`) still places **the exact untrimmed Planner result P** in synthetic `text`; it neither reserializes P nor substitutes Orchestrator output. Only `description` uses the deterministic projection. `resume:false` remains explicit. Returned admission must have synthetic type, exact parent session, exact P and exact description. Immediate root execution is rejected; the later wake subscription provides diagnostics rather than a guarantee against future human input.

Publication creates no intent grant, never calls confirmation/switch/prompt, and returns no authorization result. The plugin stores only the frozen candidate and diagnostic plan hash. Root messages, model prose, synthetic metadata, hashes and retained candidates cannot enter the CAP grant path on their own.

The plugin neither imports nor calls `runImplementationAttempt()`. That function does not accept the plugin's retained candidate or a publication binding: it constructs its own candidate from freshly bound pre-publication evidence. `parentCalls()` still rejects synthetic/control input and extra ordinary user messages, and inbox checks remain strict. A test now explicitly appends synthetic publication evidence and proves implementation stops before confirmation/switch/prompt (`attempt.test.ts:535–546`). It proves rejection of composition, not successful publication→authorization integration.

Selected upstream source corroborates the host assumptions: native completion joins text without trimming; `session.synthetic()` wakes only when `resume !== false`; TUI synthetic presentation selects `description`; native subagent calls supply the expected prefix/wrapper and host model inheritance. Sources were inspected read-only in `../opencode/packages/core/src/{tool/plugin/subagent.ts,session/subagent-completion.ts,session/session.ts}` and `../opencode/packages/tui/src/routes/session/index.tsx`.

## 9. Plugin-generation lifecycle

The complete plugin is 66 lines and has no app slot, keymap, slash command, or replacement legacy registration.

- `setup()` creates one activation-private `Generation` (`tui.ts:10`) and captures the directory/Git baseline at activation (`11–16`). An invalid baseline prevents root adoption/publication.
- Only a newly delivered `session.created` event for a root `opencode-agents` session at the activation directory is adopted. Existing roots, native children, wrong roles/locations and later roots cannot replace it (`21–25`).
- `attempted` is set synchronously before asynchronous publication starts (`26–29`) and is not reset on success/failure. Failed/interrupted root events also set it before alerting (`47–53`). Duplicate success cannot launch another attempt.
- Candidate and plan hash are closure-local; success retention checks revocation first (`30–34`). Publication failure alerts are suppressed after revocation. Root-start diagnostics remain tied to the adopted root and published diagnostic hash (`43–46`).
- Cleanup's **first statement is `generation.revoked = true`** (`55`). It then clears `boundCandidate` and removes all five subscriptions (`56–61`). No old M1 cleanup/registration remains.

The diagnostic hash, baseline and root ID are not explicitly zeroed in the revoked closure; this is unchanged from the baseline. They are not authority-bearing, have no surviving subscription consumer, and all late retention/actions remain guarded. Pending attempt locals can remain reachable until their promise settles, but revocation blocks further trusted admission. No grant is ever created by the production publication path. Replacement setup starts with a new generation and no adopted root/candidate/authority.

Direct tests cover completion-before-creation rejection, one publication, later root-wake diagnostic, duplicate/failed/interrupted events, subscription removal, real plugin cleanup while root wait is pending, and a replacement activation that ignores completion of the old root (`attempt.test.ts:371–409,589–651`).

## 10. Role/permission reconciliation

All four role IDs and host-loading paths remain intact. Historical-to-current agent diffs contain only the two recommended wording substitutions; there are no permission changes.

| Role ID | Effective intended capabilities and restrictions |
| --- | --- |
| `opencode-agents` | Primary; deny-all first, then allow only native delegation to `planner` and `implementer_slot`. No mutation/shell/execute/session/MCP/question or authorized-Implementer delegation. Instructions require two fresh foreground calls with exact prompts and prohibit model/background/sessionID options |
| `planner` | Subagent; deny-all then read/glob/grep only. No edit/shell/execute/delegation/session/MCP/question. Exact three-field proposal and no history effects remain instructed |
| `implementer_slot` | Subagent; same read/search permissions, no mutation/delegation routes. Bootstrap instruction and verifier require no tool use and exact READY; slot creation carries no implementation authority |
| `authorized_implementer` | Hidden subagent; deny-all then read/glob/grep/edit/shell. Later explicit `git commit` and `git commit *` shell denials remain. Execute, sessions, delegation, MCP and question stay denied. Exact scope/no history/no observation-evasion instructions preserved |

Deny/allow ordering remains correct under selected upstream `Permission.evaluate()` (last matching rule) and `merge()` (ordered flattening). Session context merges agent rules before session rules, so `successful()`'s zero-session-overrides requirement remains material. Direct role tests verify effective ordering and both explicit commit patterns (`attempt.test.ts:296–338`); baseline diff additionally establishes that all permission entries were preserved.

The role tests use a small evaluator for the literal resources they assert, not a full wildcard implementation. The host's wildcard semantics were checked in upstream source. Direct commit denials are defense in depth; ordinary development shell access is not an adversarial Git-history or filesystem containment boundary. No stronger guarantee or widened permission was introduced.

The Orchestrator prose still says trusted TUI handles confirmation/admission. That statement describes the retained intended authority boundary but overstates current live wiring; §14 records it as associated documentation drift. Agent files were not modified in this task.

## 11. Regression coverage reconciliation

The passing suite has 4 CAP tests, 5 proposal tests, 6 Git tests and 30 attempt/plugin/role tests. Counts corroborate execution but are not the preservation argument. Original files at `1e15ed4` were read and their assertions/variants compared with current bodies.

### Original seven primitive groups

| Investigation primitive group | Surviving evidence |
| --- | --- |
| 1. Exact schema/proposal/scope | `proposal.test.ts:30–43,65–88,106–116`: original rejection set, exact strings/order/freezing, extra field/fence, paths and symlink behavior |
| 2. Candidate/grant/liveness and readable candidate | `cap.test.ts:30–84`; `proposal.test.ts:90–104`; `attempt.test.ts:411–434`: all original assertions plus corruption, altered purpose/digest, revoked consume, exact message and resizing |
| 3. Staged/unstaged/untracked/deletion/rename | `git.test.ts:29–51`, including both endpoints and destination-only scope rejection |
| 4. Staged+unstaged union/read-only index | `git.test.ts:53–72`: divergent index/worktree versions, exact union, unchanged stage listing |
| 5. Ignored untracked | `git.test.ts:74–85`: ignored exclusion, visible inclusion, freshness result |
| 6. Exact scope and canonical root | `git.test.ts:87–95,108–117`: `.bak` rejection, subdirectory rejection, substituted root/HEAD; native location substitution at `attempt.test.ts:580–587` |
| 7. HEAD binding/unusual filenames | `git.test.ts:97–106`: bound HEAD change rejected, newline filename preserved; native final Git gate at `attempt.test.ts:280–294` |

### All seventeen original native groups

The original native inventory includes one rendering group now correctly housed in `proposal.test.ts`. The other sixteen groups remain in `attempt.test.ts`.

| Original native group (baseline test line) | Current location / preservation |
| --- | --- |
| 1. Deterministic Plan rendering (115) | `proposal.test.ts:51–63`; full multiline projection, exact scope, bound HEAD and no-authority notice |
| 2. Post-idle exact P publication (129) | `attempt.test.ts:116–130`; entire synthetic call, exact candidate, wait ordering, zero confirm/switch/prompt |
| 3. Active-root publication refusal (145) | `132–137`; no synthetic admission |
| 4. Immediate root wake refusal (152) | `139–145`; one admitted synthetic, no prompt |
| 5. Native confirmed same-slot success (160) | `147–170`; exact confirmation, one switch, independently specified exact one prompt and in-scope result |
| 6. Legal Planner read/search with inert slot (172) | `172–183`; expanded from read to direct completed read/glob/grep variants |
| 7. Missing/duplicate/continued/substituted native evidence (183) | `185–209`; every original variant plus extra arguments, changed prompts and child/message identities |
| 8. Dirty/dismissed/stale/revoked admission (203) | `211–234`; original cases plus explicit undefined dismissal, no switch/prompt |
| 9. Ambiguous switch/prompt, no redispatch (226) | `236–249`; switch throw, transport error, returned text and input-ID mismatch; one switch and at most one prompt |
| 10. Confirmation/switch staleness and post-prompt revocation (241) | `251–263`; no new prompt or retry after uncertainty/revocation |
| 11. Exact authorized-slot result (255) | `265–278`; extra input, wrong role and failed outcome all reject after one prompt |
| 12. Final HEAD/exact scope gate (270) | `280–294`; separate changed-HEAD and out-of-scope effects reject |
| 13. Agent effective permissions (286) | `296–338`; original permissions plus transferred direct commit and instruction assertions |
| 14. Overrides/changed bound transcripts (325) | `340–354`; original cases plus parent/Planner overrides |
| 15. Revocation after confirm/switch (339) | `356–369`; no trusted prompt |
| 16. Newly observed root activation (354) | `371–392`; pre-create completion ignored, one publication, no authorization, wake diagnostic and cleanup |
| 17. Stable dirty publication remains non-authorizing (378) | `394–409`; stable pre-existing diff accepted, no confirmation or switch |

The old harness's undefined dismissal, fit checks, no-commit/no-evasion prompt assertions and direct-commit permission assertions survive in native/primitive coverage. Generic-session/model tests and the harness's pre-Planner cleanliness test were intentionally deleted; they were not relabeled as proof of native pre-bootstrap enforcement.

### Added Phase 2 admission and lifecycle cases

| Added case requested for reconciliation | Direct current coverage |
| --- | --- |
| Corrupt candidate encoding/digest | `cap.test.ts:48–59`; `proposal.test.ts:65–88` |
| Altered grant digest/purpose, different candidate | `cap.test.ts:61–74` |
| Revoked consumption | `cap.test.ts:76–84` |
| Undefined confirmation dismissal | `attempt.test.ts:219–229`; `cap.test.ts:36–37` |
| Terminal resize after confirmation begins | `attempt.test.ts:424–434`, confirm hook shrinks the terminal and rejects admission |
| Pagination/repeated cursor/duplicate IDs | Happy fake returns multiple pages; `456–471` rejects cursor loops and duplicate IDs across pages |
| Forbidden/unfinished Planner tools | `436–454`: completed edit and running read reject; legal read/glob/grep at `172–183` |
| Slot bootstrap tools/non-READY | `436–454`: read/glob reject, READY with extra newline rejects |
| Existing transcript mutation | `473–485`: parent and Planner content changed at confirmation and switch; appended slot inputs at `251–263` |
| Permission overrides | Parent/Planner/slot before switch at `340–354`, all three after switch at `497–506` |
| Both switched-slot verification points | Switch-time slot input at `251–263`; late slot mutation during awaited parent verification at `487–495` exercises the second check |
| Synthetic admission tampering | `508–533`: returned raw text/description mutation rejects |
| Raw P vs presentation | `116–130,508–546`: exact pretty-printed/whitespace P, deterministic description, synthetic evidence does not relax implementation binding |
| Location substitution | `580–587`: activation directory changes during confirmation; no switch/prompt |
| Trusted prompt input/attachment mutation | `236–249,562–578`: returned text/ID mismatch, wrong session/type, empty ID, files/agents/skills all reject without redispatch |
| Duplicate/failing/interrupted root events | `589–616`: exactly one publication or one STOP, zero authorization actions |
| Cleanup during pending publication | `618–651`: actual plugin cleanup revokes deferred root wait, blocks publication and removes handlers; replacement activation inherits no authority |
| Pending inbox / changed publication path set | `548–560`: no synthetic admission |

All requested groups have surviving direct coverage. A few concrete branch-level coverage gaps remain; passing group titles should not imply exhaustive mutation coverage:

- Proposal tests do not directly supply empty/whitespace-only intent/plan, unsafe-control text, a non-object top-level value, a non-array `files` value, or an existing directory as the final scope entry. Their rejecting code is unchanged and inspected.
- Git tests do not inject malformed NUL output or invalid UTF-8, or change root/HEAD inside the observer between its first and final observations. Those defensive branches are unchanged; fixture tests cover ordinary exact-name and before-observation HEAD rejection.
- Native tests do not isolate every identity/wrapper branch: for example, forked session rejection, a session's directory changing independently of TUI location, a well-formed wrapper with substituted inner text, and two native calls in one uniquely identified assistant message. The same-message mutation in `185–209` instead creates duplicate message IDs and is rejected by the collector before reaching the distinct-call-message guard.
- Synthetic tests mutate returned text/description but do not separately mutate returned type/session; cleanup is directly exercised during pending wait, not during an already admitted pending synthetic call. Source checks remain intact for those cases.

These are test-specific limits, not evidence of weakened runtime behavior, missing original assertions, or blockers to this simplification. No tests establish successful publication→later authorization, retrospective pre-bootstrap cleanliness, continuous root idleness, adversarial shell containment, or a new live host result.

## 12. Obsolete runtime residue search

The requested search was run exactly over runtime, tests and agents/plugin, excluding historical docs:

```bash
rg -n 'runM1|runM2|publishM2PlanDogfood|\bM[12]\b|Milestone [12]|m[12]/|opencode-agents\.m1\.run|name: "m1"' src test .opencode
```

Result: **no output, exit 1 (no matches)**.

An additional harness/entry/plumbing search was run:

```bash
rg -n 'selectedModel|modelReads|collectMessages|completedText|noDirectCommit|session\.create\(|ui\.slot|keymap|slash|/m1|M1 Planner|M1 Implementer|M1 PASS|M1 STOP|\bgeneral\b' src test .opencode
```

Result: **no output, exit 1 (no matches)**. Source inventory and directory existence checks also confirm old source/test paths and compatibility layers are absent. The remaining `session.created` event subscription and fake root/child histories are native observation/test fixtures, not session-creation harness code. Native prompt/switch calls are confined to the retained implementation function and its fake test API. No alternate slash command or generic Planner/Implementer creation path exists.

Historical `docs/` intentionally retains milestone names and old paths. It was not included in residue searches.

## 13. Remaining runtime gaps

**None found.**

No selected simplification invariant, deletion or authority boundary is missing. The known publication-to-authorization integration and pre-bootstrap cleanliness questions are outside the simplification's selected end state; they are not refactor gaps. Branch-level test limits are recorded in §11 without asserting a runtime defect.

## 14. Normative documentation drift

These documents were inspected in full and were not edited. The locations below distinguish stale factual descriptions from valid historical evidence, preserved normative requirements and unresolved future work. Later reconciliation should update descriptions without retrospectively rewriting milestone results or weakening CAP.

### `docs/charter.md`

| Exact section / lines | Later documentation reconciliation |
| --- | --- |
| “Milestone status and direction”, 9–13 | “The current `/m1` command is the working M1 harness and reference implementation” is factually stale: command/harness are deleted. Preserve historical M1 PASS and its scope |
| Same section, 15–23 | “The selected … flow is the working M2 path” overstates live confirmation/implementation. Describe live publication and retained tested implementation separately. “Reviewer … is next” must account for unresolved published-plan authorization integration before treating the intended live sequence as complete |
| Same section, 25–46 | Same-slot confirmation/consumption/prompt sequence remains intended and preserved in callable code, but should not be read as current TUI wiring; add the exact-P synthetic publication boundary and disconnected entry status |
| 52–77 | M1/M2 as current architecture/gate names should be reconciled to the milestone-free boundaries. Ordinary clean admission, unchanged HEAD, exact observed path membership and deferred review-target limits remain correct; retain milestone wording where describing historical achievements |
| 79–83 | Activation-private authority, revoke-first cleanup, zero authority after replacement, ordinary local topology and TCB limits remain correct. Clarify that current publication retains a candidate without obtaining confirmation or creating a grant |
| 85–105 | “ordinary M1 observation” is stale current terminology; runtime/agent wording is now ordinary Git changed-path scope observation. Exact scope, no history/evasion, ordinary-shell limits, direct-command defense in depth and no generic-permission authority remain correct |

The M0/M1/M2 PASS evidence, predecessor-as-research rule, no-workflow threat model, and future reviewed-target/Commit requirements remain valid. They do not establish current plugin wiring.

### `docs/coding-authority-protocol.md`

| Exact section / lines | Later documentation reconciliation |
| --- | --- |
| §1, 10–15; “Milestone status and M2 boundary”, 24–42 | Current `/m1` availability is stale; live native modal/implementation wording needs to distinguish historical dogfood and retained `runImplementationAttempt()` from publication-only TUI. `ui.dialog.confirm` remains the retained trusted implementation mechanism, not a current publication callback |
| §2, 73–85 | Native bootstrap/switch and persistent editing capability remain correct semantics of the retained implementation path. Comparison with M1's root Implementer should be historical, not a current alternate path |
| §5.1, 191–210 | Pre-bootstrap clean initial baseline is a normative requirement, not a demonstrated current guarantee. Activation observation can be dirty; publication intentionally accepts stable path deltas. Callable implementation checks current cleanliness after bootstrap and cannot retrospectively prove the required earlier state. Explicitly separate non-authorizing presentation from implementation admission and leave the earlier enforcement question for integration; do not weaken this requirement |
| §6, 239–272; §7 | Confirmation/strict-true/result binding, exact child, final freshness, single consumption and no retry remain correct for retained implementation. Identify synthetic publication as a separate non-authorizing operation, not lifecycle step 3 authorization presentation by itself |
| §4 role row at 151; §6 at 254,267–269; §9 at 339–392; §10 invariants 9–10 at 430–447; §11 at 469–472 | M1/M2 gate/admission vocabulary is stale as current runtime nomenclature. Preserve ordinary observation limits, exact scope, unchanged HEAD, no evasion/history authority and no review-target claim |
| §13, 496–504 | Historical native implementation/dogfood and earlier modal binding achievements remain true, but “remaining questions … beyond the completed M2 boundary” needs current publication/authorization integration status |
| §13 questions, 506–523 | Intent encoding/digest is already concrete (`kind,intent,plan,files,root,head` and SHA-256); modal candidate/result association is implemented/tested; current role instructions/direct denials and intent stale/single-use/replacement-generation tests are answered. Separate those from future published-candidate callback binding and reviewed-target/validation/commit questions |

§§2–4's non-conversational authority and TCB, §5's immutable exact candidate, §§6–8's strict decision/single-use/revocation rules, and §9's stronger implementation freshness/scope requirements remain valid. Reviewed-target authorization/commit and Reviewer validation remain future obligations, not missing features of the simplification. §12's versioned M0 dogfood evidence remains historical and should retain its recorded versions.

### `docs/v1-orchestration.md`

| Exact section / lines | Later documentation reconciliation |
| --- | --- |
| §1 “Current milestone boundary”, 19–56 | `/m1` “remains” available and “working M2 path” claims are stale. Current orchestration ends with trusted exact-P publication; modal implementation is retained/disconnected. Preserve historical PASS and intended same-slot sequence |
| §3 context boundary, 99–105; Implementer/permission/Orchestrator sections, 126–181,200–209 | Separate historical M1 generic sessions from surviving native roles. Same-slot and permission rules remain correct, but later authorization is conditional/future wiring; replace current milestone labels without altering role IDs or permissions |
| §4 “Happy-path sequence”, 214–242 | Current `/m1` diagram is obsolete. The native initial-clean→confirm→implementation diagram describes intended/historical execution, not live plugin behavior. Add actual activation-baseline→native bootstrap→idle synthetic publication→stop sequence and identify retained implementation separately; Reviewer/Commit stay deferred |
| §5 handoff 1, 259–278 | Before-either-child clean check remains a normative obligation that current publication does not enforce. Distinguish stable dirty presentation and current clean implementation checks; document the unresolved pre-bootstrap enforcement boundary without relaxing it |
| §5 handoff 2, 279–294; §9 invariants 3,6–8, 388–418 | Exact observed scope/HEAD/no-commit behavior remains correct for retained implementation; M1/M2 names and PASS wording are stale as runtime names |
| §7, 346–355 | Current retained proposal is frozen but **not authorized**. Planner/slot references remain attempt-local. Reviewed-target and Reviewer references describe future coordination; do not imply they exist in the current plugin |
| §11, 437–442 | Exact native Planner/slot binding and intent invocation/result references are already implemented by the binder; remove their status as unanswered questions for that path. Cross-publication binding remains a separate unresolved question |
| §11, 447–449 | Existing role instructions and two direct commit denials already answer the current intent-path portion. Reviewer and later effects remain future work |

§§2,6,8 and the core invariants remain correct on authority confinement, context separation, termination, no inherited authority and CAP's ownership. §11's exact reviewed target and reviewer-owned validation questions at 443–446 remain unresolved future work. No documentary reconciliation should claim that the Git scope gate constructs an exact review target.

### `docs/hybrid-authorization-ux-decision.md`

| Exact section / lines | Later documentation reconciliation |
| --- | --- |
| Status, 5 | “production transcript projection remains unresolved” is stale as a description of current plan publication: exact P plus deterministic description is now admitted through synthetic with `resume:false`. Authorization/result/STOP integration remains unresolved |
| Context, 9 | “M2 currently asks for authorization in a large `ui.dialog.confirm`” is stale live wiring. That modal exists only in retained tested implementation; earlier modal dogfood remains valid evidence |
| Explicit Non-Decisions, 54–60; Next Investigation, 66–68 | This decision historically did not settle projection. Preserve that historical fact, but add current implementation status: `session.synthetic` is used for non-authorizing plan publication. It does not complete a trusted callback or decide final result/STOP projection |
| Selected UX Direction, 29–42 | Compact `session.composer.top` strip and direct TUI-local Authorize/Cancel callbacks remain selected **future UX**, absent from runtime. Their absence is intentional, not a simplification gap |
| Security / Authority Boundary, 44–48 | Conversation as presentation, trusted candidate ownership and exact callback/freshness/grant checks remain correct requirements for later integration |

Prototype A/B observations, `session.import` being only a simulation, Form/Question reassessment, prior-investigation relationship and prototype provenance remain historical evidence. This report does not decide or implement future authorization UX.

Associated agent prose at `.opencode/agents/opencode-agents.md:12` also claims trusted TUI “handles confirmation and admission.” A later explicitly scoped wording reconciliation should account for current publication-only wiring; it was already identified by the investigation and is not permission drift. This task leaves all agents unchanged.

## 15. Final disposition

The **M1/M2 runtime simplification can be considered closed**. Architecture, deletions, preserved integrity checks, test transfer, generation lifecycle, agent permissions and non-reconnection match the selected end state. Verification passes and no genuine runtime gap was found.

The next separate architectural problem is **trusted human authorization of the exact published candidate across the publication boundary**. It must bind retained P/candidate and native evidence across synthetic admission, preserve positive trusted human decision and process-local one-use authority, and establish the required clean/fresh implementation boundaries, including the known pre-bootstrap cleanliness obligation. It must not derive authorization from conversation, metadata, hashes or role selection. The selected compact authorization UX remains future work; Reviewer/exact-target and Commit remain later problems.

Normative documentation reconciliation is a separate documentation-only task using §14. Historical milestone/dogfood/investigation documents must remain historical evidence.

Final repository change inventory for this task: **only `docs/m1-m2-runtime-simplification-reconciliation.md`**. Starting HEAD and existing tracked files were preserved; no runtime, test, agent, investigation or normative document was changed.
