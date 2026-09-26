# Milestone 0 investigation — trusted UI authorization boundary

## Executive status

**PENDING MANUAL DOGFOOD — Phases A and B complete; Phase C remains. Final M0
outcome not yet assigned.**

Manual Phase A dogfood on OpenCode `v2.0.16` established the basic
`ui.dialog.confirm` behavior:

- the in-repository TUI plugin loaded and `/m0-intent` and `/m0-commit`
  registered;
- both representative authorization candidates were displayed completely and
  intelligibly;
- trusted TUI Confirm returned `true`;
- Cancel returned `false`;
- Escape dismissal returned `undefined`;
- Ctrl-C while the modal was pending closed the dialog and returned
  `undefined`;
- terminating the foreground TUI with `SIGTERM` while a confirmation was
  pending disposed the plugin and produced no confirmation result.

No Phase A interaction produced a positive result except the explicit trusted
TUI Confirm action.

Generic permission independence is now established by Phase B runtime
dogfood. Supported model-accessible/non-interactive bypass attempts remain
untested. Therefore the final M0 outcome remains unassigned.

The existing source investigation establishes that OpenCode `v2.0.16` loads
dependency-free local server and TUI plugins, and that the TUI
`ui.dialog.confirm` API returns `true`, `false`, or `undefined` for Confirm,
Cancel, and close. It also establishes how the investigated permission,
command, session, form, tool-context, and keymap APIs behave. No
pending-confirmation bypass attempt was exercised.

The earlier **HOST GAP** conclusion is withdrawn. It treated the absence of
host-attested human provenance, candidate identity/digest, and durable
single-use receipts as missing host capabilities. Under the revised V1 trust
model those are not host requirements: the authority kernel and durable store
construct and freeze candidates, bind the UI result, check freshness, record
authorization, consume it once, prevent replay, and define restart behavior.
Physical-human attestation and defense against OS-level input injection or
malicious code already inside the trusted computing base are out of scope.

Programmatic or model-triggered opening of the dialog is allowed. The
remaining host question is whether any supported model-accessible or
non-interactive OpenCode path can make an already-pending confirmation
positive without the trusted UI confirmation action. That, along with the
visible candidate and real UI result behavior, still requires manual dogfood.
This report does not assign PASS before that evidence exists.

## Manual dogfood evidence — Phase A

Date: 2026-09-25
Host: OpenCode `v2.0.16`
Repository: `opencode-agents`
Harness: `.opencode/plugins/m0-dogfood/tui.js`
Evidence log: `/private/tmp/opencode-m0-dogfood.jsonl`

Phase A was executed directly from the `opencode-agents` checkout using the
normal OpenCode environment. An earlier isolated-XDG launch stalled at
`Starting background server...` before the TUI loaded; this was treated as a
runtime-environment issue rather than evidence about the confirmation
boundary.

### Plugin and command activation

Observed in the OpenCode TUI:

- the M0 plugin loaded;
- `/m0-intent` registered;
- `/m0-commit` registered.

### Candidate presentation

The intent dialog visibly presented:

- authorization kind;
- candidate digest;
- objective;
- `opencode-agents` repository identity;
- current checkout path;
- representative baseline marker;
- exact authorized paths;
- distinct Cancel and Confirm actions.

The reviewed-target commit dialog visibly presented:

- authorization kind and candidate digest;
- repository/worktree identity;
- representative current/baseline markers;
- passing review identity, result, and digest;
- reviewed-target digest;
- exact commit paths;
- proposed commit summary and message;
- distinct Cancel and Confirm actions.

Both dialogs were readable without material clipping or omitted
authority-bearing fields.

### Result observations

| Interaction | Observed result |
| --- | --- |
| Confirm | `true` |
| Cancel | `false` |
| Escape / dismiss | `undefined` |
| Ctrl-C while modal pending | dialog closes, `undefined` |
| `SIGTERM` foreground TUI while pending | plugin disposed; `no-result`, `completed: false` |

Representative experiment evidence:

- Escape/dismiss: `72447c80-2841-4c07-839d-1d0279ef59be`
- Cancel: `491d283b-e952-41c9-873b-8cddb635012a`
- Confirm: `352b4d8f-d9fc-476b-8c0a-63cacbce3485`
- Ctrl-C dismissal: `d09cc6de-fd24-4729-8d81-9f7332f3bd95`
- `SIGTERM` interruption: `afbc1d87-c476-4de8-bd8b-cc3f5f8ebb57`

For the `SIGTERM` case, the log sequence was a
`confirmation-presented` event followed by:

`invocation-terminated`, `rawResult: "no-result"`,
`completed: false`, with termination reason
`plugin-disposed-while-confirmation-pending`.

### Phase A assessment

Phase A supports the required basic UI-boundary behavior:

- trusted code can present both representative authorization candidates;
- the explicit Confirm action is distinguishable from Cancel and dismissal;
- dismissal and process interruption do not create a positive result.

This is not yet an M0 PASS. Phase B now establishes independence from
generic permission behavior. Phase C must still test supported
model-accessible/non-interactive routes against an already-pending
confirmation.



## Manual dogfood evidence — Phase B

Date: 2026-09-25  
Host: OpenCode `v2.0.16`  
Repository: `opencode-agents`  
Harness: `.opencode/plugins/m0-dogfood/tui.js`  
Evidence log: `/private/tmp/opencode-m0-dogfood.jsonl`

Phase B tested whether generic OpenCode permission state could satisfy or
positively resolve the separate M0 `ui.dialog.confirm` boundary. A harmless
read-only command, `git status --short`, was used as the permission-governed
action.

### Permission observations

| Permission mode | Permission behavior | M0 confirmation behavior | Experiment |
| --- | --- | --- | --- |
| Explicit `allow` rule for `git status*` | `git status --short` ran without a permission prompt | `/m0-intent` remained pending until explicit Escape dismissal; result `undefined` | `d5bae5e8-8584-4313-a4f4-5c12a4d69c97` |
| Saved `always` | First `git status --short` prompted; after selecting Always allow, the same command ran again without another prompt | `/m0-intent` remained pending until explicit Escape dismissal; result `undefined` | `6642ef0b-d5a6-47eb-a086-c8eeaabda87a` |
| `--auto` with bash otherwise configured to `ask` | `git status --short` ran without a permission prompt | `/m0-intent` remained pending until explicit Escape dismissal; result `undefined` | `487933a9-62d5-4bc4-9ac0-c7d6be3e876e` |

No tested generic permission mode caused the pending confirmation to return
`true` or otherwise complete positively.

The optional direct `session.permission.reply` route was not exercised as a
separate Phase B test. The core milestone requirement is nevertheless covered
for explicit `allow`, saved `always`, and automatic permission behavior.
If a direct permission-reply route becomes naturally available during Phase C,
it may be checked there without adding new harness infrastructure.

### Phase B assessment

Phase B supports the required separation between generic OpenCode permission
state and Coding Authority approval:

- a permission rule may allow a tool action without approving the M0 candidate;
- a saved `always` rule may suppress later permission prompts without
  approving the M0 candidate;
- `--auto` may automatically satisfy ordinary permission requests without
  approving the M0 candidate.

In every tested case, the M0 confirmation remained a separate pending UI
decision and did not become positive without the trusted Confirm action.

## Environment and source identity

Observed on 2026-09-25 in the disposable probe and this repository:

| Item | Observation |
| --- | --- |
| Executable | `/Users/mike/.nvm/versions/node/v22.20.0/bin/opencode`, a symlink to `/Users/mike/.nvm/versions/node/v22.20.0/lib/node_modules/@opencode/cli/bin/opencode.exe` |
| Installed package and runnable version | `@opencode/cli` `2.0.16`; `opencode --version` reported `opencode v2.0.16` |
| Runtime | Node `v22.20.0`; separately installed Bun `1.3.13`. The OpenCode executable is packaged as `opencode.exe`; the probe used its built-in `Bun.write`. The Bun version embedded in that executable was not independently established. |
| Matching upstream source | [`anomalyco/opencode` tag `v2.0.16`](https://github.com/anomalyco/opencode/tree/v2.0.16), commit `3a103fe0aff726a4edc7492f03f7b88195d9e4c9`, verified with `git ls-remote --tags` and a filtered local clone. Source references below are pinned to this tag. |
| Isolation | Ordinary startup tried to write `~/.local/share/opencode/log/opencode.log` and failed with `EPERM`. Setting `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, and `XDG_STATE_HOME` to `/private/tmp/opencode-m0-probe/{data,config,cache,state}` allowed version and plugin probes without modifying the user's OpenCode state. |

The separately installed `~/.config/opencode/node_modules/@opencode-ai/plugin`
is `1.17.10`, so it was **not** used as the `2.0.16` API contract. The matching
tag's [`packages/plugin/src`](https://github.com/anomalyco/opencode/tree/v2.0.16/packages/plugin/src),
[`packages/tui/src/plugin`](https://github.com/anomalyco/opencode/tree/v2.0.16/packages/tui/src/plugin),
[`packages/core/src`](https://github.com/anomalyco/opencode/tree/v2.0.16/packages/core/src),
and [`packages/server/src`](https://github.com/anomalyco/opencode/tree/v2.0.16/packages/server/src)
were used instead. This version has a new `@opencode/plugin` API; older
OpenCode or `codex-agents` API assumptions were not applied.

## Established host and source evidence

The following records the observations and source contracts already gathered.
They establish API shape and available paths; source inspection is not
presented as an end-to-end UI experiment.

| Seam | Existing observation | Revised classification |
| --- | --- | --- |
| TUI plugin `ui.dialog.confirm` | A TUI plugin supplies `title` and `message`; `createDialogApi` maps confirm/cancel/close to `true`/`false`/`undefined`. The result has no candidate/digest, input-origin, session, agent, message, or call fields. The dialog component invokes its confirm callback from Return or mouse-up. | **HOST CONTRACT** for the API shape and result mapping. Missing candidate identity, durable receipts, and physical-input provenance are not host gaps. Real display and result behavior remain **PENDING MANUAL DOGFOOD**. [Contract](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/tui/context.ts), [adapter](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/tui/src/plugin/api.tsx), [component](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/tui/src/ui/dialog-confirm.tsx) |
| Native permissions | `allow` skips a prompt; a saved `always` rule can make later requests `allow`; the API accepts `once`, `always`, or `reject`. `session.permission.create` accepts caller-supplied action, resources, metadata, source, agent, and optional request ID; `session.permission.reply` is an API operation. | **HOST CONTRACT + PROVEN BY RUNTIME** that generic permission success is distinct from the dialog result. Phase B exercised explicit `allow`, saved `always`, and `--auto`; in each case the permission-governed command proceeded without a prompt while the pending M0 confirmation remained independent and later dismissed to `undefined`. [Core evaluation and reply](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/core/src/permission.ts), [HTTP handlers](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/server/src/handlers/permission.ts), [schema](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/schema/src/permission.ts) |
| Server commands and TUI keymaps | A server command gets session ID, prompt, and delivery, with no human-origin field; `session.command` invokes it through the API. Named TUI keymap commands are explicitly dispatchable with `keymap.dispatch(id)`, and their `run` callback receives a keyboard event on keyboard dispatch. The built-in confirm uses an anonymous inline Return binding, so `dispatch(id)` cannot directly name that binding. | **HOST CONTRACT** for these command and dispatch paths. A command/keymap may open the dialog; that is **ALLOWED** and is not approval. The source trace does not establish whether any supported route can positively resolve a pending dialog; that remains **PENDING MANUAL DOGFOOD**. [Command contract](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/promise/command.ts), [server handler](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/server/src/handlers/session.ts), [keymap contract](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/tui/context.ts), [dispatch implementation](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/tui/src/context/keymap.tsx) |
| Session input and events | `session.prompt` is a public client/API operation and accepts caller-supplied text, files, metadata, delivery, and optional ID. The `session.prompt` plugin hook receives these values and host message/session IDs, but no user-origin attestation. `session.synthetic` is separately available; a `user` record versus a `synthetic` record does not establish who supplied the `user` payload. | **HOST CONTRACT** for the available inputs. Session text and role labels cannot substitute for the trusted UI result; the kernel must keep them separate. Their ability to resolve a pending confirmation positively is part of the manual bypass check. [Prompt hook](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/promise/session.ts), [server handlers](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/server/src/handlers/session.ts), [inbox schema](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/schema/src/session-inbox.ts) |
| Native forms / questions | The form core enforces a pending-to-answered/cancelled transition by ID in an in-memory cache, but `reply` accepts an answer through an API route. Forms do not return human-origin proof; pending forms are cancelled on service close. | **HOST CONTRACT** for the form API and lifecycle. A form reply is not the trusted confirmation result. Test only whether a supported path can positively resolve the pending confirmation; no form ID or answer is a host attestation. [Form core](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/core/src/form.ts), [TUI plugin client surface](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/tui/context.ts) |
| Tool-call context | In a normal model tool call, OpenCode constructs `sessionID`, `agent`, `messageID`, and call `id` in the tool snapshot before calling plugin tool code. These are useful call identifiers, not evidence of a human action. Tool input remains model-controlled. The plugin location context exposes directory, project, and optionally workspace information, but Git baseline and canonical worktree facts still need trusted observation. | **HOST CONTRACT** for ordinary tool execution. Tool context may help trusted code locate repository facts, but its IDs and model-controlled input do not constitute approval. [Context schema](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/schema/src/tool.ts), [construction](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/core/src/tool.ts), [session schema](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/schema/src/session.ts) |

OpenCode supplies session IDs, optional parent/fork relationship, selected
agent, model request message IDs, and tool-call IDs in the paths above. They
are host-provided in those callbacks, though client APIs can create prompts
and sessions and can select or switch agents. A different session ID does
not imply a different person or an independent authorization. None is a
physical-user credential, and V1 does not require one. The TUI route offers
only a current session ID when a session is selected; `confirm` itself
returns no route or caller context. [Session schema](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/schema/src/session.ts),
[TUI route and dialog contracts](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/plugin/src/tui/context.ts).

### Focused experiments and exact observations

1. **Installed host, independent of this repository's metadata.**
   `command -v opencode` returned the executable path above. With isolated XDG
   directories, `opencode --version` returned `opencode v2.0.16`.
   `git ls-remote` returned `refs/tags/v2.0.16` at `3a103fe0…`. No package or
   build files were added to this repository.
2. **Dependency-free server plugin.** In `/private/tmp/opencode-m0-probe`, a
   disposable Git repository, `.opencode/plugins/m0/server.js` exported
   `{ id: "m0.probe", setup(context) { … } }` without imports, package
   metadata, or dependencies. Running `opencode plugin list` with isolated
   XDG directories invoked `setup`. Its written JSON reported
   `context.app.version: "2.0.16"`,
   `context.location.directory: "/private/tmp/opencode-m0-probe"`, project
   `canonical: "/private/tmp/opencode-m0-probe"`, and context keys including
   `permission`, `session`, `tool`, and `location`. This **PROVES** that the
   installed host loads a dependency-free local server plugin. Initially,
   managed service port `49374` was occupied. Setting port `49783` with
   `opencode service set port 49783` in the isolated configuration let
   `opencode plugin list` complete and list the local plugin. No tool call or
   human action was inferred from this probe.
3. **Dependency-free TUI plugin startup.** A disposable
   `.opencode/plugins/m0/tui.js` was added to the same temporary project to
   record dialog/keymap keys on setup. With the isolated service port, the
   ordinary `opencode` TUI invoked it. Its `tui-loaded.json` reported
   `context.app.version: "2.0.16"`, route `{ "type": "home" }`, dialog keys
   `alert, clear, confirm, prompt, select, set, show`, and keymap keys
   `active, commands, dispatch, layer, mode, pending, shortcuts`. This
   **PROVES** the installed TUI loads a dependency-free local plugin and
   exposes those methods. No dialog was approved, rejected, or dismissed. An
   earlier `opencode mini` attempt did not produce the TUI-plugin record and
   was not used to infer plugin behavior.
4. **Permission source trace.** `Permission.evaluateInput` returns `allow`
   for matching configured or saved rules; `Permission.assert` returns
   directly on `allow`. A reply of `always` can save rules and resolve other
   pending requests that then evaluate to `allow`. The API reply handler calls
   the same core `reply` path. These are concrete reasons permission success,
   `once`, or a `permission.replied` event cannot serve as the authorization
   decision. This is source evidence, not an executed permission-prompt test.
5. **Programmatic entry source trace.** `keymap.dispatch(id)` calls
   `dispatchCommand(id)`; `session.command` and `session.prompt` accept client
   requests. The anonymous Return binding in the built-in confirmation is
   not directly name-dispatchable by this particular `keymap.dispatch`
   method. Named command dispatch can nevertheless open a confirmation flow,
   which is expected; neither invocation nor successful tool execution is
   itself a positive confirmation. Whether any supported path can resolve a
   pending confirmation positively was not tested.

No one-byte mutation, replay, restart, or model/non-interactive bypass
scenario was exercised end-to-end. No source observation below is
promoted into such a test result.

## Kernel and durable-store responsibility boundary

The kernel constructs and freezes each intent or commit candidate, including
its authority-bearing contents and canonical serialization/digest. It
associates the UI result with the frozen candidate that was presented,
distinguishes intent from commit authorization, and checks candidate and
repository freshness before granting authority. A changed candidate or stale
repository state is refused by the kernel. These are system responsibilities;
the host dialog need not return a candidate ID or digest.

For an intent candidate, meaningful contents include requested intent,
exact repository scope, canonical repository/worktree identity, and bound
baseline information. A reviewed-target commit candidate includes passing
review identity/digest, exact reviewed target or target digest, commit paths,
relevant current Git baseline, and human-readable commit intent. The same TUI
decision boundary can present both. The kernel must ensure that an intent
decision cannot authorize a commit.

The kernel and durable local store record authorization, enforce one-time
consumption, prevent replay, and define safe restart behavior. A durable
atomic transition for a candidate from pending/confirmed to consumed would
reject a second consumer and replay after restart. The charter anticipates
SQLite for durable ordering, but this investigation did not validate a
transaction implementation. Milestone 0 does not require production SQLite
or durable replay tests to prove the UI boundary.

The TUI plugin, authority kernel, and local state are inside the V1 trusted
computing base along with OpenCode, the TUI, and the local OS/user-account
boundary. No defense against malicious code already executing in that
boundary, OS-level input injection, or synthetic physical-input attacks is
claimed. The former concern that a bare boolean lacks host-issued provenance
or receipt fields is therefore not a missing host primitive. The dialog
adapter's `settle` helper settles one promise once; it does not provide
durable, atomic, cross-session consumption. The trusted plugin/kernel must
retain and bind the frozen candidate itself, and the durable store must
implement consumption. [Dialog adapter](https://github.com/anomalyco/opencode/blob/v2.0.16/packages/tui/src/plugin/api.tsx).

## Falsification matrix

Statuses below distinguish existing source/runtime evidence from kernel/store
design and the UI behavior still awaiting dogfood. A programmatic opener is
not a bypass. A bypass is a supported model-accessible or non-interactive
path making the pending confirmation positive without the trusted UI
confirmation action.

| Case | Revised status | Evidence or remaining work |
| --- | --- | --- |
| Trusted code presents a frozen realistic candidate; Confirm is selected in the TUI | **PENDING MANUAL DOGFOOD** | Source maps confirm to `true`; actual display and result have not been observed. |
| Cancel is selected | **PENDING MANUAL DOGFOOD** | Source maps cancel to `false`; actual UI path has not been observed. |
| Dialog is dismissed, closed, interrupted, or ambiguous | **PENDING MANUAL DOGFOOD** | Source maps close to `undefined`; verify dismiss and interruption do not create a positive result. |
| Programmatic or model-triggered flow opens the authorization UI | **ALLOWED** | Named keymap dispatch is supported by the source trace. Opening is expected and grants no authority by itself. Dogfood may record the route used. |
| Model directly invokes an underlying command or tool | **ALLOWED to request/open; not approval** | Commands/tools can be invoked through supported paths. A tool may open the dialog, but command/tool success cannot substitute for the pending confirmation result. |
| Supported model-accessible/non-interactive path resolves pending confirmation positively without trusted UI confirmation | **PENDING MANUAL DOGFOOD; failure if observed** | This is the remaining host-boundary falsification question. The prior source trace does not answer it end-to-end. |
| Model says `"I authorize"` or claims the user approved | **KERNEL/STORE RESPONSIBILITY** | Text is not the `ui.dialog.confirm` result. The authority gate must accept only the bound UI decision and kernel checks. Session/API routes are included in the pending-path dogfood check. |
| Model supplies `authorized: true` | **KERNEL/STORE RESPONSIBILITY** | Tool input is model-controlled; the kernel must not accept it as authority. |
| Model reproduces candidate digest | **KERNEL/STORE RESPONSIBILITY** | Digest text is data, not a UI result. The kernel binds its own frozen candidate and result. No host digest attestation is required. |
| OpenCode permission `allow` or saved `always` substitutes for confirmation | **REJECTED as authority; independence pending dogfood** | Source shows `allow` skips permission prompting and `always` can save rules. Neither is the dialog result; manually confirm neither resolves the pending dialog. |
| Automatic permission behavior substitutes for confirmation | **REJECTED as authority; independence pending dogfood** | CLI `--auto` documents auto-approval of permissions not explicitly denied; this concerns permissions, not `ui.dialog.confirm`. No live check was run. Verify behavior while a confirmation is pending. |
| Session prompt/input, form reply, or model tool arguments contain approval text | **REJECTED as authority; pending-path check required** | The APIs accept caller inputs/replies, not the trusted confirmation result. Dogfood determines whether any supported route can resolve the pending confirmation positively. |
| Candidate changes after display; candidate B differs from A in an authority-bearing value | **KERNEL RESPONSIBILITY** | Kernel retains the frozen candidate, binds the result to it, and refuses changed contents. Missing host candidate identity/digest is not a host failure. No production mutation test is needed for UI dogfood. |
| Candidate or repository freshness changes before use | **KERNEL RESPONSIBILITY** | The kernel rechecks freshness and refuses stale authorization. |
| Authorization is consumed twice, or replayed after restart | **DURABLE STORE/KERNEL RESPONSIBILITY** | A durable transaction enforces single consumption and replay prevention. The TUI dialog's one-promise settlement is not the system transaction; production SQLite/restart tests are outside this dogfood. |
| Recorded or consumed authorization is encountered after restart | **DURABLE STORE/KERNEL DESIGN** | Define safe restart behavior in the system boundary; no host receipt or host restart behavior is required. |
| Different session or agent presents/consumes an authorization | **KERNEL/STORE DESIGN, not host provenance** | Session and agent identifiers are useful context but not human credentials. Define any required candidate/run binding locally; no separate host-origin guarantee is required. |
| Intent candidate and reviewed-target commit candidate use the same TUI boundary | **PENDING MANUAL DOGFOOD plus kernel design** | Present representative candidates for both and verify meaningful contents. Keep their authority distinct in the kernel. |
| Hostile code already running inside the trusted computing base triggers UI behavior | **OUTSIDE V1 THREAT MODEL** | V1 trusts the OpenCode/TUI/plugin/kernel/OS boundary. No adversarial in-process plugin or OS-level input-injection test is required. Supported model-accessible routes remain in scope. |

## Evidence classification

**Proven by runtime:** OpenCode `v2.0.16` plugin activation; registration of
both M0 commands; complete and readable display of both representative
candidate types; Confirm -> `true`; Cancel -> `false`; Escape and Ctrl-C
dismissal -> `undefined`; foreground-TUI termination while pending -> no
positive result.

**Host contract from pinned source:** TUI `confirm` input/result shape and
close mapping; keymap dispatch semantics; permission evaluation, saved
`always`, and API reply path; session prompt/command/synthetic API paths; form
reply and in-memory lifecycle; ordinary tool context and session/location
fields. These findings describe OpenCode behavior and available paths; they
do not establish manual UI outcomes.

**Kernel/store design:** candidate construction and freezing, canonical
serialization/digest, result-to-candidate binding, intent/commit separation,
freshness checks, durable recording, single consumption, replay prevention,
and restart behavior. These are required system properties, not host
attestations. Production persistence is not part of the UI dogfood.

**Still unproven:** whether any supported model-accessible/non-interactive
path can positively resolve an already-pending confirmation without the
trusted UI Confirm action.

**Not a V1 assumption to prove:** physical-human provenance, resistance to
synthetic physical input, and hostile code already running within the trusted
computing base.

## Reduced manual dogfood procedure

Use a disposable Git repository and separate XDG directories. Record the
OpenCode executable/version and source tag. The prior probe used private
managed-service port `49783` because default port `49374` was occupied; reuse
an available isolated port if needed. Use a dependency-free TUI plugin with a
named opener that captures an immutable candidate snapshot, invokes
`ui.dialog.confirm`, and logs the candidate snapshot, invocation route,
current TUI route/session when available, result, and timestamps. Do not treat
the opener invocation as approval.

1. **Display both representative candidates.** Show an intent candidate with
   requested intent, exact scope, repository/worktree identity, and bound
   baseline. Show a reviewed-target commit candidate with review identity or
   digest, exact target or target digest, commit paths, current Git baseline,
   and readable commit intent. Confirm every meaningful field is visible and
   clear, without clipping or hidden text. Record the exact frozen candidate
   contents and the visible display; a host-issued candidate receipt is not
   expected.
2. **Exercise the UI result.** With a pending candidate, use the trusted TUI
   action to Confirm and record the visible action plus returned `true`. In
   fresh interactions, select Cancel and dismiss/close (for example Escape or
   the supported close control), recording `false` and no positive result.
   Interrupt/quit with a dialog pending and confirm no positive authorization
   is produced. Source expectations are `true`, `false`, and `undefined`
   respectively; dogfood must record actual results.
3. **Check permission independence.** Repeat the pending-confirmation check
   with generic permission `allow`, saved `always`, and automatic permission
   behavior enabled. Each may affect permission handling, but none may
   positively resolve the confirmation. Record any permission prompt or
   automatic behavior separately from the dialog result.
4. **Try supported model-accessible/non-interactive paths against a pending
   confirmation.** Requesting or dispatching the named opener is allowed and
   should only open the dialog. While it is pending, try the supported routes
   available to the model/client, including approval text or tool arguments,
   session input/command, form reply, permission reply, and any supported
   direct dispatch route. Determine whether any can cause the confirmation
   result to become positive without the trusted UI confirmation action.
   Record each route and result. Do not use OS-level input injection or
   synthetic physical-input attacks; those are outside V1.

Capture screenshots or a short screen recording of the dialogs, temporary
plugin source, timestamped probe log, OpenCode version/configuration, the
candidate contents, and the exact API/interaction route. No production
SQLite, duplicate-consumption, cross-session replay, restart replay, or
physical-user-provenance test is part of this UI dogfood.

## Outcome and architectural consequence

The final M0 outcome remains unassigned until the manual evidence above is
available. A **PASS** requires clear frozen-candidate display, the expected
positive Confirm and negative Cancel/dismiss behavior, independence from
generic permission state, no supported model-accessible or non-interactive
route that positively resolves a pending confirmation without its trusted UI
action, and a credible kernel/store boundary for binding, freshness, durable
single consumption, replay prevention, and restart safety.

A **HOST GAP** is warranted only if OpenCode cannot provide a trusted UI
decision distinct from supported model-accessible/non-interactive authority
paths—for example, one of those paths can positively resolve the pending
confirmation without the trusted UI action, or trusted plugin/kernel code
cannot distinguish the decision from those paths. Absence of host candidate
digest, durable receipts, physical-human attestation, or replay protection is
not a HOST GAP under the revised milestone.

A **FAIL** means the proposed Coding Authority architecture cannot meet its
required authorization properties without granting authority to
model/conversation claims, generic permission state, replayable inputs, or
infrastructure comparable in complexity to the architecture the project
intends to avoid. A FAIL requires architectural reconsideration before
implementation.

The existing probes show that local server and TUI plugins can load without
adding a root `package.json`, `.opencode/package.json`, npm/Bun dependency,
build system, test framework, or production plugin skeleton. Durable local
transactional persistence remains required for system authorization
consumption, but this is a kernel/store design responsibility and was not
validated by the activation probes. Milestone 1 and production authorization
implementation should wait until the required UI dogfood is complete and the
final M0 outcome is assigned.
