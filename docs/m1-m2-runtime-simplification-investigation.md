# M1/M2 Runtime Simplification Investigation

## 1. Executive conclusion

**Retire M1/M2 as runtime architectural concepts.** Keep their proven integrity behavior, remove the standalone `/m1` validation harness, and move the native attempt into milestone-free modules. M1 and M2 name experiments, not distinct authority kinds. Both use the same intent candidate, process-local single-use grant, and Git gate.

The provisional four files are a good fit: `cap.ts`, `git.ts`, `proposal.ts`, and `attempt.ts`. Keep native binding, publication, confirmation, switch, prompt admission, and result verification together in `attempt.ts`. No workflow framework or additional session abstraction is needed.

**Important baseline correction:** the current native TUI path stops after plan publication. It does not yet connect that published candidate to later human authorization. `runM2()` is disconnected from the plugin, but implements the previously live-dogfooded authorization/implementation path and must survive. Moving it must not silently reconnect it: it currently rejects the synthetic parent input introduced by publication. Connecting those two surfaces is a separate behavior/integration task, outside this cleanup.

### Verified baseline and investigation limits

| Item | Observed result |
| --- | --- |
| Expected and actual starting HEAD | `1e15ed431c964d16c47a6ce6550d9b582379e98c` — `Better presentation of plan` |
| Starting worktree | Clean: `git status --short` returned no output; full `git status --porcelain=v1 --untracked-files=all` also returned no output before writing this report |
| Discrepancies | None |
| `bun test` | Exit 0; 30 pass, 0 fail, 266 assertions, 2 files; Bun 1.3.13; 10.36 seconds |
| `bun run typecheck` | Exit 0; `tsc --noEmit` |
| Repository edits in this task | Only `docs/m1-m2-runtime-simplification-investigation.md` |

Inspection covered every source file, both test files, the TUI plugin, all four agent definitions, normative documents, relevant Git changes, and the selected sibling OpenCode source. No OpenCode or Docker process was launched. No cleanup, unrelated fixes, project commit, or push was performed. Tests use temporary Git fixture repositories and fake OpenCode contexts; their PASS does not establish a new live TUI result.

## 2. Current runtime dependency map

There are two registered entry paths, plus one retained implementation entry exercised only by tests:

```text
.opencode/plugins/opencode-agents/tui.ts — setup()
  creates activation-private Generation and observes activation Git baseline
  |
  +-- app slot -> keymap command opencode-agents.m1.run -> /m1
  |     -> src/m1/attempt.ts — runM1()
  |       -> selected TUI model -> fresh general Planner session
  |       -> exact proposal/candidate -> trusted confirm -> one-use grant
  |       -> distinct fresh general Implementer session -> trusted prompt
  |       -> Git HEAD / exact changed-path gate
  |
  +-- session.created: remember one fresh root opencode-agents session
        -> native role's foreground planner child, then implementer_slot child
        -> session.execution.succeeded: set attempted=true
        -> src/m2/attempt.ts — publishM2PlanDogfood()
          -> bind exact parent calls and both child histories/results
          -> parse/freeze exact Planner result; bind root and HEAD
          -> synthetic(text=raw P, description=renderPlan(candidate), resume=false)
          -> verify admission and immediate root inactivity
        -> plugin retains candidate and diagnostic planHash; no authorization callback

test/m2.test.ts only -> src/m2/attempt.ts — runM2()
  -> clean/fresh baseline -> bind exact native evidence -> frozen candidate
  -> trusted confirm -> rebind/check freshness -> grantIntent()
  -> same slot switch -> verify slot + parent + Planner -> reverify slot
  -> final freshness -> consumeIntent() -> exact one-shot trusted prompt
  -> wait / same-slot input and result verification -> Git HEAD / scope gate
```

Actual imports:

| Consumer | Dependencies |
| --- | --- |
| `src/m1/attempt.ts` | `./proposal.ts`, `./git.ts`, OpenCode types |
| `src/m2/attempt.ts` | M1 attempt's `assertLive`, `candidateFits`, `consumeIntent`, `grantIntent`, `implementerPrompt`, `Generation`; M1 Git and proposal primitives; OpenCode types |
| TUI plugin | `runM1`, `Generation`, `observeGit`, `publishM2PlanDogfood`, `IntentCandidate` |
| `test/m1.test.ts` | M1 primitive functions and `runM1` |
| `test/m2.test.ts` | Shared M1 primitives, both M2 entry functions and native prompt constants, TUI plugin |

The role Markdown files are loaded by OpenCode, not imported into TypeScript. `opencode-agents.md` permits only Planner and slot delegation; `planner.md` defines the isolated structured proposal; `implementer_slot.md` defines inert `READY`; `authorized_implementer.md` permits ordinary development capabilities only for the trusted frozen proposal.

`setup()` observes one activation baseline and one newly created root; `attempted` is set before publication and not reset. Existing roots are not adopted. Failed/interrupted root turns stop the attempt. These limitations remain outside the cleanup scope.

## 3. Reusable production primitives currently under M1

“Keep” includes behavior needed by the retained, proven native implementation path even where its entry point is currently disconnected from TUI registration.

| Current location | Symbol / behavior | Current consumers | Recommended home | Keep? |
| --- | --- | --- | --- | --- |
| `src/m1/attempt.ts:6–33` | `Generation`, `IntentGrant`, `assertLive`, `grantIntent`, `consumeIntent` | `runM1`; M2 publication/implementation through liveness and grants; plugin owns `Generation`; both test files | `src/cap.ts` | Yes. Require live generation, affirmative decision, intact exact candidate, purpose/digest matching, and single consumption. No host/session state substitutes for this authority. |
| `src/m1/attempt.ts:35` | `candidateFits` | `runM1`, `runM2`, primitive test | `src/attempt.ts` | Yes. The surviving modal must show the complete candidate; reject an undersized terminal and recheck after confirmation. It is trusted dialog admission logic. |
| `src/m1/attempt.ts:63` | `implementerPrompt` | `runM1`, `runM2`, native happy-path assertion | `src/attempt.ts` | Yes, removing only milestone parameter/wording. Supplies exact frozen proposal, canonical root, HEAD, exact scope, no commit/history authority, and no deliberate observation evasion. |
| `src/m1/git.ts:5–58` | `GitSnapshot`, private `git`/`line`/`paths`, `observeGit` | Both attempts; plugin activation baseline; primitive and native tests | `src/git.ts` | Yes. Canonical worktree root, verified commit HEAD, baseline equality, independent staged/unstaged/untracked observation, strict decoding, final root/HEAD rechecks. |
| `src/m1/git.ts:60` | `requireFresh` | Both attempts and primitive tests | `src/git.ts` | Yes. Current root/HEAD must match baseline and current ordinary changed-path set must be empty at implementation admission boundaries. |
| `src/m1/git.ts:66` | `requireInScope` | Both attempts and primitive tests | `src/git.ts` | Yes. Post-implementation root/HEAD equality and exact path membership; no prefix/glob expansion. |
| `src/m1/proposal.ts:5–18` | `Proposal`, `IntentCandidate` | Both attempts, plugin candidate retention, tests | `src/proposal.ts` | Yes. Exact `{ intent, plan, files }` plus frozen candidate root, HEAD, encoding and digest. |
| `src/m1/proposal.ts:20–77` | private `exactFile`, `parseProposal` | Both attempts through parsing; tests | `src/proposal.ts` | Yes. Reject expanded/malformed scope, unsafe text, duplicate paths, directories and escaping symlink paths; preserve exact proposal values and freeze object/file array. |
| `src/m1/proposal.ts:79–88` | `makeCandidate`, `candidateIntact` | Both attempts, CAP grant functions, tests | `src/proposal.ts` | Yes. Deterministic encoding/digest binds proposal, ordered files, root and HEAD; integrity rechecks before granting/consuming. |
| `src/m1/proposal.ts:90` | `renderPlan` | Live M2 publication and rendering/publication tests | `src/proposal.ts` | Yes. Trusted deterministic human-readable projection; never replace P or candidate encoding with rendered text. |
| `src/m1/proposal.ts:108` | `candidateMessage` | Both confirmation paths; tests | `src/proposal.ts` | Yes. Exact proposal, JSON-quoted scope/root, bound HEAD and implementation-only/no-commit explanation shown for trusted confirmation. |

Preserve the actual semantics, not just exported names:

- `observeGit()` uses `git --no-optional-locks`, `diff-index --cached --no-renames`, `diff-files --no-renames`, and `ls-files --others --exclude-standard`, with NUL-delimited fatal UTF-8 decoding. It unions, deduplicates and sorts pathnames without writing an index/tree or attributing edits to an agent. Both rename endpoints remain observable. Ignored untracked files remain excluded.
- `parseProposal()` preserves intent/plan whitespace and file order; an empty file array is supported. New paths with missing parents are allowed; existing non-directory/symlink parents are rejected, directories cannot be scope entries, and existing final symlinks must resolve inside the worktree. Do not silently normalize text, sort scope, widen paths, or tighten unrelated parsing policy while moving it.
- Grants are ordinary trusted process objects. `Generation` is passed by activation-private reference; `IntentGrant` contains digest/purpose/consumed, not a generation ID or durable token. Correct confinement and the caller's liveness guards provide the generation boundary. Moving exported functions must not introduce global grant/candidate state or claims of cryptographic generation attestation.

## 4. Obsolete M1 harness/scaffolding

`runM1` is still callable through `/m1`; it is obsolete as the recommended runtime architecture, not dead code today. The native path does not create `general` role sessions or depend on this harness's model/prompt/result collection. Its useful checks already exist in shared primitives and the stronger native binder.

| Symbol / file | Why it existed | Current consumers | Delete / move / retain |
| --- | --- | --- | --- |
| `src/m1/attempt.ts` — `runM1` | Prove one trusted Plan → Confirm → Implement → Git gate without native Orchestrator children | `/m1` command; six harness tests | Delete once shared functions are moved and native parity assertions retained. |
| `runM1` Planner `session.create`/prompt | Fresh isolated `general` Planner with edit/direct-commit denial | Only `runM1` | Delete. Native Planner is created through the Orchestrator's restricted native call; its agent file and transcript verifier replace this setup. |
| `runM1` Implementer `session.create` | Distinct fresh `general` implementation session | Only `runM1` | Delete. Native implementation must use the existing exact slot, not another session. |
| `selectedModel`, `modelReads` test plumbing, provider/model/variant copy | Bind harness-created sessions to selected TUI model; fix empty responses when model omitted | Only `runM1` and `fakeContext` tests | Delete. Native OpenCode child creation owns model inheritance; CAP does not depend on copied model identity. |
| private `plannerPrompt` | Encode proposal request for generic Planner role | Only `runM1` | Delete. `.opencode/agents/planner.md` and native `plannerInput` remain the surviving contracts. |
| private `collectMessages`, `completedText`, M1 `after` | Bind each generic role result to its sole prompt and successful final | Only `runM1` | Delete. Preserve M2 `messages`/`after`/identity/result verification, including pagination defenses absent in M1. No generic shared collector needed. |
| private `noDirectCommit` | Permissions supplied to harness-created sessions | Only `runM1` | Delete constant; retain equivalent direct-command denials in `authorized_implementer.md` and no-commit instruction/HEAD checks. |
| Plugin app slot/keymap block, `removeSlot` | Register `opencode-agents.m1.run`, slash `m1`, and harness PASS/STOP alerts | Only `/m1` UI | Delete whole registration and its cleanup call; retain all native event subscriptions and generation cleanup. |
| M1 prompts, titles, errors, report wording | Identify validation experiment | Harness and tests; shared Implementer prompt has surviving wording | Delete harness strings; move/reword shared prompt without deleting prohibitions. |
| `test/m1.test.ts` — first seven tests | Primitive integrity, Git semantics, dialog fit and grant consumption | Shared production primitives | Move and retain assertions; these are not harness-only. |
| `test/m1.test.ts` — last six tests and `fakeContext` | Exercise generic-role harness and selected-model behavior | Only `runM1` | Delete harness expectations after transferring remaining invariant assertions described below. |

History supports this distinction: `3a700dc` introduced M1; `3065d9b` specifically fixed the harness's role-model binding. `9eb91e5` introduced native M2 using the same primitive layer without calling `runM1`. The selected-model fix remains historical evidence, not a requirement to duplicate native host model handling.

## 5. Production path currently under M2

### Trusted native logic to retain

`src/m2/attempt.ts` contains the actual integrity boundary for native orchestration:

| Symbol(s) | Required behavior and consumers |
| --- | --- |
| `SLOT_PROMPT`, `plannerInput`, native bootstrap `prefix` | Exact role input contracts; parent/child verification and tests. Do not trim user request or prefix. |
| `Call`, `Child`, `Bound` | Attempt-local parent/user/tool/child/input/final IDs, exact texts, serialized transcript snapshots. Shared by publication and implementation binding; retain as private types. |
| `plain`, `sameLocation`, `requireActivationLocation` | No files/agents/skills attached to trusted plain role input; expected directory and current TUI location. Current session-location comparison is directory-based. |
| `after`, `messages`, `idle`, `successful` | Liveness after each await; pagination with repeated-cursor/duplicate-ID rejection; no execution or pending inbox; exact ID, parent, no fork, role, location, successful idle outcome and no session permission overrides. |
| `completedCall`, `parentCalls` | Exactly two sequential completed native calls with exact three-key input contract, unique tool/child/assistant-message IDs, exact Planner/slot prompts, completed metadata and exact wrapper. One plain parent user input, one successful turn and nonempty final. |
| `verifyChildHistory`, `oneFinal`, `finalText`, `resultMatches` | Each child has one exact prefixed bootstrap input and one successful final/idle; Planner tools only completed `read`/`glob`/`grep`; slot no tools and exactly `READY`; parent result equals exact child result. No model summary is trusted as P. |
| `bind` | Independently observe and freeze parent/Planner/slot evidence; compare complete histories and bound identities on rebinding. Used by both entry functions and again after confirmation. |
| `verifyParentPlanner`, `switchedSlot` | After switch, unchanged parent/Planner and exact prior slot bootstrap; exactly one `implementer_slot` → `authorized_implementer` switch; no pre-prompt input; one exact returned trusted user ID/text and successful authorized result in that same child. Used by `runM2`. |
| `runM2` admission tail | Final Git freshness/liveness, consume grant, one prompt dispatch, verify returned session/type/text/attachments/ID, wait, verify result, independently observe Git and enforce scope. No retries. |

These checks are not temporary ceremony. In particular, the two calls to `switchedSlot()` around awaited parent/Planner verification bracket a window in which slot state could change. Removing either because it appears repetitive would weaken admission.

### Live publication versus proven implementation

`publishM2PlanDogfood()` is the current live TUI entry. Its only production caller is `tui.ts — setup()` on root execution success; three direct publication tests and two plugin tests exercise it. It:

1. Guards generation/concurrency, activation location, canonical root and baseline observation.
2. Waits for root completion and binds exact native evidence while all sessions are idle with empty inboxes.
3. Parses/freezes exact raw Planner text P into a candidate, then renders a description from that candidate.
4. Rechecks root idle state and admits a synthetic message with **raw P in `text`**, **deterministic Plan in `description`**, and **`resume:false`**.
5. Checks returned admission type/session/text/description and immediately checks root inactivity. Returns candidate, diagnostic hash and synthetic ID. Plugin retains the candidate in activation-private state and clears it on cleanup.

Its `requireDogfoodBaseline()` checks root/HEAD through `observeGit(directory, baseline)` and compares changed-path arrays to the activation baseline. It permits pre-existing changes for presentation only. It does **not** check changed-file bytes or authorize those changes. Rename it `requirePublicationBaseline`, preserving this distinction from `requireFresh`.

`runM2()` has **no current plugin/role production caller**. Only native implementation tests call it. Nevertheless, `9eb91e5` wired it to root execution success, and `docs/milestone-2-live-dogfood.md` records the same-slot happy path and human dismissal on that revision. It is the existing proven implementation path, not obsolete disconnected scaffolding.

`7e6abb0` deliberately replaced that plugin call with `publishM2PlanDogfood()`, allowed a non-clean publication baseline, retained the published candidate, and added wake diagnostics. `1e15ed4` added `renderPlan()` and changed only synthetic `description`, keeping raw P in `text`. These commits explain why both functions exist.

The two functions are **not a composed workflow** today:

- `runM2()` constructs its own candidate from pre-publication evidence; it does not take the plugin's retained `boundCandidate` or a publication binding.
- `parentCalls()` rejects parent message types outside `user`, `assistant`, `idle`; `bind()` expects exact frozen transcripts; `idle()` also rejects pending inbox input. A published synthetic message conflicts with these assumptions. Do not solve this by ignoring arbitrary synthetic messages.
- The publication fake records the API call but does not append a synthetic message to parent history. Current tests do not exercise publication followed by implementation, and must not be presented as proving that integration.
- Retained candidate/digest, synthetic text/metadata, agent prose and a later ordinary root message grant no authority. There is no current trusted Authorize callback for the published candidate.

### Naming and genuinely temporary presentation

Rename entry points to `publishPlan()` and `runImplementationAttempt()`. Rename `stop()`'s `M2 binding failed` prefix and M2 dialog/report titles. Keep `planHash`, `syntheticID`, publication toasts and the root-wake event diagnostic initially, with plain terminology: they are non-authorizing observability, not reasons to build another module. Nothing substantial in the M2 binder or implementation path can be deleted outright. Diagnostic reduction is optional later and does not justify deleting publication admission checks.

### Current implementation/documentation differences

- `docs/charter.md`, `docs/v1-orchestration.md`, and `docs/coding-authority-protocol.md` describe a working native confirmation/implementation path. At this HEAD only publication is live. Their historical PASS remains valid; it is not evidence of current wiring.
- CAP §5.1 requires a clean initial baseline before native role bootstrap. Current plugin publication deliberately accepts a stable pre-existing path delta and reacts after native children are created. `runM2()` requires current cleanliness, but cannot retrospectively prove pre-bootstrap cleanliness: `requireFresh()` checks current paths, not `baseline.paths.length`. Its original plugin caller supplied a clean activation baseline. Keep this limitation explicit; neither weaken implementation admission nor restore wiring as part of renaming.
- `opencode-agents.md` says trusted code handles confirmation/admission, but current plugin has no such callback. It also instructs an exact final sentence; `parentCalls()` accepts any nonempty final text (the test fake uses different prose). That is an existing presentation-contract difference, not an authority source.
- `docs/hybrid-authorization-ux-decision.md` selects a future compact trusted authorization strip while recording transcript projection as unresolved. Current code has synthetic projection but no strip; retained `runM2()` still uses a modal. This cleanup should implement neither a new strip nor a replacement authorization decision mechanism.

## 6. Recommended milestone-free architecture

```text
src/
  cap.ts
  git.ts
  proposal.ts
  attempt.ts
.opencode/
  plugins/opencode-agents/tui.ts
  agents/
    opencode-agents.md
    planner.md
    implementer_slot.md
    authorized_implementer.md
test/
  cap.test.ts
  git.test.ts
  proposal.test.ts
  attempt.test.ts
```

- **`cap.ts`:** only `Generation`, `IntentGrant`, `assertLive`, `grantIntent`, `consumeIntent`. Imports candidate type/integrity from `proposal.ts`; no OpenCode calls, persistence, globals or grant registry. `busy` stays on the existing generation object; attempt code owns setting/resetting it.
- **`git.ts`:** move current Git implementation unchanged, including its private helpers. No proposal or session dependency.
- **`proposal.ts`:** move current proposal/candidate implementation unchanged, including validation, freezing, encoding/digest, `renderPlan`, and `candidateMessage`. It owns artifact semantics and deterministic presentation, not granting authority.
- **`attempt.ts`:** current M2 implementation plus shared `candidateFits` and milestone-free `implementerPrompt`. Own exact native evidence, activation/transcript freshness, publication, trusted confirmation/admission, same-slot switch, one-shot prompt/result binding and final Git gate. Keep native verification functions private. Use the one surviving native `after`/message collector; do not introduce a generic session API.
- **TUI plugin:** owns activation-private generation/baseline/candidate/event subscriptions and revokes first on cleanup. Remains a thin integration entry to `publishPlan`; removal of `/m1` eliminates the app slot/keymap layer. No new authorization or conversational routing is implied.

**Assessment of `cap.ts + git.ts + proposal.ts + attempt.ts`: agree.** This separates authority, observations, validated artifacts, and host admission without speculative abstractions. A three-file alternative could put the roughly 30-line CAP functions at the top of `attempt.ts`, but would mix directly auditable grant mechanics with OpenCode integration and force primitive tests to import that integration. Four files clarify a demonstrated trust boundary at negligible cost. More files for publication, dialogs, transcript snapshots or role switching would disperse the sequence auditors need to read together. Do not split merely for file length.

Minimal dependency direction:

```text
tui.ts -> cap.ts (generation type), git.ts, proposal.ts (candidate type), attempt.ts
attempt.ts -> cap.ts, git.ts, proposal.ts
cap.ts -> proposal.ts (candidate integrity)
git.ts and proposal.ts -> platform APIs only
```

No compatibility barrels or milestone aliases are needed: repository search finds all consumers locally. Preserve agent IDs (`opencode-agents`, `planner`, `implementer_slot`, `authorized_implementer`) and their permission ordering; these are meaningful roles and host bindings, not milestone names.

## 7. Exact deletions

### Delete outright after moving retained behavior

| Deletion | Why no surviving runtime path depends on it |
| --- | --- |
| `runM1`; private `plannerPrompt`, `collectMessages`, `completedText`, M1 `after`, `noDirectCommit` | Only the generic-role harness calls these. Native publication/implementation use their own exact role contracts and stronger native verification. Keep shared exports listed in §3 first. |
| Harness selected-model read/copy, Planner/Implementer `general` session creation, M1-only success/failure report construction | Native host creates Planner/slot children and implementation reuses the slot. No surviving path creates these generic sessions. |
| Plugin `context.ui.slot({ append:"app", ... })`, its keymap layer and `removeSlot` cleanup | This entire UI block exists to register `/m1`. Native event subscriptions do not depend on it. |
| Command ID `opencode-agents.m1.run`, slash command `m1` and its title/description/alerts | Sole entry point to deleted harness. Do not replace it with an alias or new command. |
| `test/m1.test.ts — fakeContext` and its model/session/role-result tracking | Only six deleted generic-role harness tests use it. Keep primitive fixtures/assertions. |
| Both selected-model tests at `test/m1.test.ts:239,249` | Assert only obsolete harness plumbing; native source handles inherited model selection. |
| Harness success test at `:218` | Delete separate-session/model assertions; first preserve no-commit/evasion assertions in native prompt/agent coverage and keep native same-slot success test. |
| Harness failure tests at `:260,276,285` | Delete generic-role machinery after preserving undefined dismissal and corresponding native freshness/input/HEAD/scope assertions (§8). The deleted “before creating Planner” harness assertion must not be relabeled as currently proven native pre-bootstrap enforcement. |

The last six M1 test titles, for unambiguous removal:

1. `one confirmed request admits one fresh Implementer and checks its resulting path`
2. `no selected TUI model stops before creating Planner`
3. `selected model without a variant omits variant from Planner session`
4. `dismissal, stale worktree, and late revocation never admit Implementer`
5. `dirty initial worktree stops before creating Planner`
6. `extra role input, out-of-scope delta, and changed HEAD cannot pass`

### Remove old paths/exports by relocation or rename, not by losing behavior

- `src/m1/git.ts` → `src/git.ts`; `src/m1/proposal.ts` → `src/proposal.ts`.
- Remove `src/m1/attempt.ts` after moving its five CAP exports/types, `candidateFits`, and `implementerPrompt` and deleting its harness.
- `src/m2/attempt.ts` → `src/attempt.ts`; `publishM2PlanDogfood` → `publishPlan`; `runM2` → `runImplementationAttempt`; private `requireDogfoodBaseline` → `requirePublicationBaseline`.
- Delete now-empty `src/m1/` and `src/m2/` directories.
- Delete old `test/m1.test.ts`/`test/m2.test.ts` paths only after moving the seven primitive tests and all seventeen M2 tests, plus parity assertions, to the four recommended test files. Do not delete M2 tests as “dogfood-only.”
- Remove `implementerPrompt`'s `"Milestone 1" | "Milestone 2"` parameter/default; retain one concrete trusted input template and its exact-input assertion.

### Runtime terminology that can disappear

- Harness-only `M1 Planner`, `M1 Implementer`, `Authorize M1 implementation`, `M1 PASS`, `M1 STOP`, usage/model/busy/cleanliness strings and Milestone 1 Planner introduction disappear with the harness.
- Rename `M2 binding failed`, `Authorize M2 implementation`, `M2 authorization was cancelled or dismissed`, `M2 implementation gate complete`, `M2 STOP`, `M2 plan dogfood`/root-woke titles, and the temporary-dogfood comment to plain attempt/publication terminology. Preserve stop conditions and diagnostic data.
- In trusted Implementer prompt and `authorized_implementer.md`, replace `ordinary M1 scope observation` with `ordinary Git changed-path scope observation`. Retain the entire prohibition on manipulating Git/configuration/index/ignore/repository state to conceal changes.
- In `opencode-agents.md`, replace `one M2 attempt` in its description with `one implementation attempt`. Preserve tool/prompt/role contracts.
- Rename test titles, fixture temporary-directory prefixes, Git fixture identity strings and expected completion text to milestone-free equivalents. These labels bind no runtime authority.

**Not deletion candidates:** `runM2` behavior; raw Planner P; any binding/freshness/liveness/scope check; `boundCandidate`; generation revocation; native event guards; agent files/role IDs; publication hashes/metadata/diagnostics in the minimal cleanup. No historical document is deleted or rewritten.

## 8. Invariants and regression coverage

References below are starting-HEAD file/line locations, not future line numbers. All seventeen tests in `test/m2.test.ts` survive; the first seven M1 tests survive. Multiple variants inside a test remain separately exercised. Titles sometimes overstate variants actually tested; the table distinguishes implementation checks from direct assertions.

| Invariant | Current test(s) | Required after cleanup | Recommended test location |
| --- | --- | --- | --- |
| Exact three-field proposal, no fence/extra field, frozen file array | `m1.test.ts:32` — `proposal must preserve three exact fields and reject expanded scope` | Preserve all assertions, exact values, freezing and rejection behavior | `proposal.test.ts` |
| Finite exact repository-relative paths | Same `:32`: duplicates, traversal, glob, dot, absolute, `.git`, escaping symlink parent | Retain every case. Direct tests do not cover every `exactFile` branch; preserve those branches too | `proposal.test.ts` |
| Candidate encoding/digest/root/HEAD integrity | `m1.test.ts:47`; M2 `:129` compares returned candidate; `:160` constructs exact candidate for confirmation/prompt | Preserve. Add targeted corrupted encoding/digest and mismatched-candidate grant assertions; `:47` currently only proves `candidateIntact` true, not corruption rejection | `proposal.test.ts`, `cap.test.ts` |
| Generation liveness/revocation | `m1:47`; `m2:203,241,339` | Keep initial, confirmation, switch and post-prompt revocation variants and their no-dispatch assertions | `cap.test.ts`, `attempt.test.ts` |
| Single-use intent grant, explicit purpose/digest | `m1:47` rejects false/undefined, consumes once, rejects second consumption | Preserve all; directly assert altered purpose/digest and revoked consume refusal without altering grant design | `cap.test.ts` |
| Complete readable trusted confirmation candidate | `m1:47` candidate message/large versus small terminal; `m2:160` exact confirmed message | Preserve `candidateFits` assertions when deleting harness; add resize-during-confirmation rejection because runtime explicitly rechecks | `proposal.test.ts` (message), `attempt.test.ts` (fit/admission) |
| Canonical Git root and bound HEAD | `m1:123,133`; native `m2:270` changed HEAD | Preserve subdirectory rejection, HEAD mismatch and candidate/prompt baseline facts. Add location/root substitution at native admission boundary | `git.test.ts`, `attempt.test.ts` |
| Staged, unstaged, ordinary untracked union; read-only index observation | `m1:65,89` | Preserve both tests, including divergent index/worktree edits and unchanged `ls-files --stage` output | `git.test.ts` |
| Ignored untracked semantics | `m1:110` | Preserve ignored-file exclusion and visible-file inclusion; no “all filesystem files” replacement | `git.test.ts` |
| Deletion and both rename paths | `m1:65` | Preserve deletion and staged rename endpoints; reject rename scope containing only destination | `git.test.ts` |
| Exact changed-path equality, unusual names | `m1:123,133` and `:65,89`; `m2:270` | Preserve `.bak` rejection, newline filename exactness, exact subset checks and native out-of-scope failure | `git.test.ts`, `attempt.test.ts` |
| Exact native parent call contract | `m2:160,183` — success and missing/duplicate/continued/incomplete evidence | Preserve each mutation. Add explicit `background`, `model`, changed prompt and same-message/child-ID cases: current grouped title does not directly exercise every forbidden input key | `attempt.test.ts` |
| Exact child/session/result and Planner isolation | `m2:160,183,255,325` | Preserve wrong parent, paraphrased wrapper, extra child input, wrong role/outcome; keep exact prefixed sole-input contracts, no fork/overrides and transcript identity. No Planner conversation passed to slot | `attempt.test.ts` |
| Planner permitted-tool constraint | `m2:172` allows a completed `read`; role rules at `:286` | Preserve; add completed `glob`/`grep` positive cases and forbidden/unfinished tool negatives. Current title does not independently test all tools | `attempt.test.ts` |
| Inert slot | `m2:160,183`; agent permissions at `:286` | Retain exact `READY`, pre-switch role and no early-switch tests. Add slot-tool and non-READY rejection cases; slot has read permissions but binder must reject any bootstrap tool use | `attempt.test.ts` |
| Transcript immutability across confirmation/switch | `m2:241,325` | Preserve extra parent/slot input and changed-slot-after-confirm/switch variants. Add changed existing Planner/parent content, not only appended messages | `attempt.test.ts` |
| Session permission overrides cannot bypass role rules | `m2:325` mutates slot permissions; `:286` checks role file rules | Preserve; all parent/Planner/slot checks must still require zero overrides. Extend variants to parent/Planner and after switch | `attempt.test.ts` |
| Explicit human Cancel and dismissal, no inferred grant | `m1:47` false/undefined; harness `m1:260` undefined dismissal; `m2:203` false cancellation; `m2:172` cancels after legal Planner read | Move undefined dismissal to native attempt coverage before deleting harness test. Assert no switch/prompt for both false and undefined | `cap.test.ts`, `attempt.test.ts` |
| Stale Git/session/candidate state before admission | `m2:203,241,325`; harness `m1:260` | Preserve dirty-before-confirm and dirty-after-confirm and transcript freshness variants. `:203`'s “changed candidate state” actually changes Git, not candidate fields. Add targeted candidate corruption in primitive coverage | `attempt.test.ts`, `cap.test.ts` |
| Same-slot authorized switch, no replacement session | `m2:160,255` | Exact switch ID, one prompt to that ID, result in same role/session. Fake has no session-create API, so a new child would fail | `attempt.test.ts` |
| No redispatch after ambiguous switch/prompt | `m2:226,241` | Keep throwing switch, transport error, payload text mismatch, returned-ID mismatch and post-prompt revocation; assert one switch and at most one prompt. No recovery wrapper | `attempt.test.ts` |
| Exact trusted implementation input and result | `m2:160,226,255` | Preserve entire prompt equality plus returned session/type/text/attachments/ID checks and sole successful result. Move old harness no-commit/evasion string assertions into native prompt coverage | `attempt.test.ts` |
| Post-implementation HEAD and scope gate | `m2:270`; shared Git tests | Preserve separate HEAD-change and out-of-scope variants, and successful exact-path result at `:160` | `attempt.test.ts`, `git.test.ts` |
| No implicit commit authority | Harness `m1:218` checks instruction/deny presence; `m2:160,270,286` provides prompt/HEAD/role support | Transfer direct commit-pattern deny and no-commit/evasion instruction assertions; keep HEAD gate. These are defense in depth, not full shell containment | `attempt.test.ts` |
| Deterministic human-readable Plan projection | `m2:115` | Keep exact multiline expected string, scope order, HEAD, no-authority notice, no literal escaped newline, intact candidate plan | `proposal.test.ts` |
| Exact synthetic raw Planner text; description remains presentation | `m2:129` | Keep whole synthetic call equality and returned candidate equality. Add pretty-printed/raw whitespace P and returned text/description mismatch variants; current fake only returns correct admission | `attempt.test.ts` |
| Publication uses `resume:false`; root stays idle | `m2:129,145,152` | Preserve exact false flag, refuse active root, reject immediate post-admission wake. Add pending-inbox refusal; do not claim continuous idleness against later human input | `attempt.test.ts` |
| Fresh root event activation; one publication; no authorization | `m2:354` | Preserve ignored completion before creation, completed fresh root publication and zero confirms/prompts; add duplicate completion / failed / interrupted variants without changing one-attempt behavior | `attempt.test.ts` |
| Stable dirty publication is non-authorizing | `m2:378` | Keep same observed pre-existing delta accepted for publication, no confirm/switch; add changed-path-set refusal. Do not reuse this weaker condition for implementation admission | `attempt.test.ts` |
| Plugin cleanup/revocation and replacement generation | `m2:354` checks event-handler removal; standalone generation tests cover revocation | Keep cleanup test; add deferred wait/synthetic or confirmation continuation with actual cleanup to verify revocation blocks subsequent actions, and fresh setup has zero authority. Current cleanup test does not prove cleanup during pending work | `attempt.test.ts` |
| Agent permission files and role separation | `m2:286` — ordered effective rules for all four files | Preserve mode, deny-first, narrow allow rules and denial of session/delegation/execute/MCP/question routes. Add both direct commit patterns and important instruction assertions formerly in M1 harness coverage | `attempt.test.ts` |

The four test files correspond to trust responsibilities; keep plugin/agent integration tests in `attempt.test.ts` to avoid another file boundary. Use local fixture helpers initially; there is no need to introduce a shared testing framework to remove a small fixture duplication.

Additional direct cases above address concrete gaps in advertised integrity coverage. They are targeted preservation/admission tests, not a reason to invent a new workflow. Do not turn runtime renaming into enforcement changes to make those tests pass. In particular, publication → later authorization and clean pre-bootstrap enforcement are known integration gaps requiring separate scope, not refactor acceptance claims.

## 9. Refactor sequencing

**Recommend three small, independently verifiable commits.** This keeps transfer of security-relevant coverage reviewable before deleting the harness. No commit in this sequence reconnects publication and implementation or adds authorization UX.

### Commit 1 — establish milestone-free primitive boundaries

Purpose: relocate Git/proposal intact and extract CAP functions from M1. Likely files: new `src/{cap,git,proposal}.ts`, old `src/m1/{attempt,git,proposal}.ts`, `src/m2/attempt.ts`, `tui.ts`, both tests. Update every import; delete old Git/proposal paths without compatibility barrels. Leave `runM1`, native function names, prompts and UI behavior in place temporarily; M1 imports/reuses CAP exports rather than duplicating them.

Behavior unchanged: candidate encoding/digests, exact path parser, Git commands, liveness/consumption order, harness registration and both native entry functions.

Verification:

```bash
bun test
bun run typecheck
git diff --check
rg -n 'm1/(git|proposal)' src test .opencode
```

The last search should return no runtime/test references. Review relocation diff for unchanged private helpers, command flags and serialization field order.

### Commit 2 — name and test the native attempt by responsibility

Purpose: move `src/m2/attempt.ts` to `src/attempt.ts`; move `candidateFits`/`implementerPrompt` there; rename publication/implementation and private publication-baseline functions; remove milestone parameter/wording while preserving full restrictions. Update plugin imports/titles, native test expectations, and the two agent files with milestone wording. Separate tests into `cap`, `git`, `proposal`, `attempt` files; keep any remaining M1 harness tests temporarily in `m1.test.ts`.

Likely files: both attempt sources, new attempt source, TUI plugin, `.opencode/agents/{opencode-agents,authorized_implementer}.md`, old/new test files. Transfer undefined dismissal, prompt no-commit/evasion assertions and commit permission assertions before deleting their harness sources. Add targeted integrity cases from §8 where necessary to make the preserved boundary directly reviewable.

Behavior unchanged: publication-only plugin wiring, retained callable/modal implementation path, raw P/description distinction, `resume:false`, baseline policies, exact native contracts, check order, one-shot dispatch, root/HEAD/scope checks, generation ownership. Only deliberate prompt/UI label substitutions change textual output; update full exact-prompt expectations together.

Verification:

```bash
bun test
bun run typecheck
git diff --check
rg -n 'runM2|publishM2PlanDogfood|Milestone 2|M2|m2/' src test .opencode
```

The last search should be empty after fixture/title changes. Compare native positive/failure variants to the original seventeen M2 tests and verify all still exist. Existing tests for a dirty initial worktree before a generic Planner remain harness-specific until commit 3.

### Commit 3 — remove the standalone M1 harness

Purpose: delete remaining `src/m1/attempt.ts`, M1-only tests/fake, `/m1` slot/keymap/cleanup, imports and labels; remove empty milestone source directories. Rename remaining fixture identities if needed. Likely files: M1 attempt/test, TUI plugin, native/primitive tests if final transferred assertions need adjustment.

Behavior unchanged: native plan publication and all retained implementation integrity behavior. Intended removal: `/m1`, its generic role sessions and selected-model copy. No new slash command and no native authorization reconnection. Confirm cleanup still revokes synchronously before clearing candidate/removing subscriptions.

Verification:

```bash
bun test
bun run typecheck
git diff --check
rg -n 'runM1|runM2|publishM2PlanDogfood|\bM[12]\b|Milestone [12]|m[12]/|opencode-agents\.m1\.run|name: "m1"' src test .opencode
git status --short
```

The runtime/test search should be empty; historical `docs/` are deliberately excluded. Minimum coverage inventory: all 7 original primitive tests and all 17 native tests remain, with harness parity assertions transferred; test count alone is not proof of invariant preservation. Full `bun test` and typecheck are inexpensive enough to run for each commit. No OpenCode/Docker execution is needed for this structural cleanup; later authorization integration would need separate evidence and authorization.

## 10. Risks / traps

1. **Deleting disconnected implementation:** current imports alone would wrongly classify `runM2` as disposable. History and dogfood establish its role; preserve it and its tests.
2. **Accidental reconnection:** `publishPlan(...).then(runImplementationAttempt)` is not a mechanical refactor. Publication changes parent transcript/inbox assumptions and does not return `Bound`; relaxing the binder broadly could admit forged or unrelated control input. Do not reconstruct authority from synthetic metadata or rendered Plan.
3. **Conflating publication freshness with authority freshness:** equal changed-path arrays permit dirty presentation and do not imply identical bytes. `requireFresh` must continue requiring zero current paths. Do not copy the publication policy into grant admission or pretend it establishes pre-bootstrap cleanliness.
4. **Changing exact P:** native `finalText` concatenates text parts without trimming, and `resultMatches` verifies exact wrapper bytes. Do not stringify the parsed object into synthetic `text`, echo Orchestrator prose as P, render the description into the grant, or normalize request whitespace. The historical trailing-space Planner-prompt mismatch stopped correctly before confirmation.
5. **Changing check placement during extraction:** promise arguments may initiate host calls before an `after` wrapper awaits them. Retain explicit `assertLive` immediately before switch/prompt/publication, checks after awaits, confirmation rebind, both switched-slot checks, and final Git/liveness guards. Keep `try/finally` busy release and set `attempted` before launching work.
6. **Treating role selection as a capability:** `switchAgent` records durable session state. The grant stays in trusted activation-local memory and is consumed before the single prompt. After revocation/ambiguous transport, never retry or create another implementation child. An admitted server turn may outlive TUI cleanup; that is not surviving CAP authority.
7. **Losing effective permission ordering:** upstream `Permission.evaluate()` uses the last matching rule; session rules merge after agent rules. Keep deny-first role rules, narrow allows, and `successful()`'s refusal of any session overrides. Slot read permissions do not permit bootstrap reads under the stricter transcript contract.
8. **Replacing Git observation with a superficially simpler command:** preserve staged/unstaged/untracked union, ignored-file semantics, deletion/rename endpoints, NUL handling, root and HEAD rechecks, read-only index behavior, and exact equality. Do not use prefix checks, diff statistics or model-reported changed files.
9. **Overstating the scope gate:** it checks ordinary Git-visible paths and unchanged HEAD, not an exact content target or adversarial filesystem sandbox. Ordinary shell permissions and direct-commit denials retain their documented limits. No Reviewer/Commit infrastructure belongs in the extraction.
10. **Changing exported prompt without full contract updates:** remove milestone words and parameter together with the exact trusted-input test; preserve baseline facts and every behavioral prohibition in both prompt and agent instructions. Do not change agent IDs or permission files' capabilities while rewording labels.
11. **Deleting harness tests too early:** undefined dismissal, candidate fit, no-commit/evasion instructions and direct-command permissions need explicit surviving assertions. Keep redundant failure variants where they exercise different authority boundaries.
12. **Expanding scope through event cleanup:** retaining `freshParent`, `attempted`, diagnostic wake subscription and stop handlers avoids slipping one-attempt/casual-message routing fixes into module moves. Candidate retention and revoke-first cleanup remain even though there is no current authorization consumer.

Relevant read-only upstream evidence:

- `../opencode/packages/core/src/tool/plugin/subagent.ts — Input` and execution: required agent/prompt/description; optional continuation/model/background; parent target permission check before continuation; fresh-child creation with parent relationship; exact bootstrap prefix and completed result wrapper; host model inheritance.
- `../opencode/packages/core/src/session/subagent-completion.ts — text()`: joins final assistant text parts without trimming. This agrees with native exact P handling.
- `../opencode/packages/core/src/session/session.ts — switchAgent()` and `synthetic()`: role selection event is durable session state; synthetic admits text/description/metadata and skips execution wake only with `resume:false`.
- `../opencode/packages/tui/src/routes/session/index.tsx — SystemMessage()`: synthetic presentation uses `description`. Presentation text and raw model-facing text are distinct.
- `../opencode/packages/core/src/permission.ts — evaluate()/merge()` and `session/context.ts — select()`: last matching rule, ordered agent/session rule merge. Session overrides are material integrity evidence.

These sources were inspected without modifying, building or running the upstream checkout. The predecessor repository was unnecessary for this investigation.

## 11. Documentation impact — later only

Do not edit these in this task or perform broad archival work in the runtime refactor:

| Document | Later reconciliation |
| --- | --- |
| `docs/charter.md` | Replace current runtime milestone/harness descriptions with actual module/entry boundaries; distinguish historical native PASS from current publication-only wiring; retain threat model and deferred Reviewer/Commit scope. |
| `docs/coding-authority-protocol.md` | Reconcile references to `/m1`, M1 observation and M2 admission names; retain all normative candidate/generation/freshness/scope requirements; explicitly account for publication versus pre-bootstrap clean implementation policy. |
| `docs/v1-orchestration.md` | Describe surviving native roles/entry functions and publication/authorization integration status; remove current-harness claims after deletion. Its open binding question is already answered by the existing binder. |
| `docs/hybrid-authorization-ux-decision.md` | If/when a subsequent UX decision is made, reconcile selected future authorization strip and earlier unresolved projection status with current synthetic description. The selected layout remains future work. |

Historical milestone plans, dogfood results, reassessments and investigations remain evidence at their recorded revisions. Keep them unchanged, including old file paths and milestone names. `README.md` is empty and supplies no competing runtime contract; do not create a documentation project as part of this task.

## 12. Final recommendation

Follow the three-commit extraction/naming/harness-removal sequence. Keep four concrete modules, all native publication and proven implementation behavior, all shared integrity primitives, and direct invariant tests. Remove `/m1` and generic-role/model scaffolding, rather than preserving milestone adapters.

The follow-up implementation task should expressly preserve **publication-only TUI wiring** and the **retained callable authorization/implementation path** while retiring milestone names. It should not claim that cleanup completes later authorization of a published plan. That integration needs its own narrowly scoped task to bind the exact retained P/candidate and native evidence across trusted publication, preserve the human decision boundary and clean/fresh admission checks, and account precisely for the added synthetic input. No new workflow engine, persisted state, retries, routing behavior, Reviewer or Commit work is necessary for the proposed cleanup.
