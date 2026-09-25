# Milestone 0 — Trusted UI Authorization Boundary

## Status

Architecture proof / falsification milestone.

No production Coding Authority Protocol implementation should depend on an
authorization interaction until this milestone establishes that the OpenCode
UI can serve as a trusted decision boundary.

## 1. Objective

Evaluate `ui.dialog.confirm` as a trusted OpenCode UI decision boundary for
Coding Authority Protocol authorization.

The required host-side property is:

> The model may request that an exact authorization candidate be presented,
> but model output, tool arguments, conversation/session text, generic
> permission state, and supported non-interactive OpenCode APIs must not
> themselves be able to provide the positive authorization decision.

Programmatically opening an authorization dialog is allowed and expected.
The distinction is:

```text
model may REQUEST authorization
        !=
model may APPROVE authorization
```

A bypass exists only if an untrusted/model-accessible path can make the
pending trusted confirmation resolve positively without the trusted UI
confirmation action.

This milestone establishes the UI boundary, not the full Coding Authority
Protocol. Exact candidate binding, freshness checks, durable recording,
single consumption, replay prevention, and restart behavior remain system
requirements owned by the authority kernel and durable local state.

## 2. Why This Is Milestone 0

The `opencode-agents` architecture depends on two distinct authorization
boundaries:

1. approval of the exact intent and repository scope before implementation;
2. approval of the exact reviewed target before commit.

Neither authorization may be inferred from:

* conversation text or agent prose;
* model-supplied tool arguments, including an `authorized: true` field;
* prior authorization of a related operation;
* generic OpenCode permission state;
* a previous run or an earlier review;
* an automatically accepted interaction.

The protocol trusts the OpenCode host, OpenCode TUI, installed
`opencode-agents` plugin, authority kernel, durable local store, and local
OS/user-account boundary. It does not attempt in V1 to defend against
malicious code already executing inside the trusted OpenCode/TUI process,
compromised OpenCode, OS-level input injection, terminal or input-device
compromise, or an attacker synthesizing arbitrary local UI events inside the
trusted computing base.

The question to answer before designing broader workflow infrastructure is
whether the trusted UI decision can remain separate from model and supported
non-interactive authority paths.

## 3. Required Authorization Property

Trusted code constructs and freezes an authorization candidate, then asks the
OpenCode TUI to present its meaningful contents. The UI obtains and returns an
explicit Confirm, Cancel, or dismiss decision. Trusted plugin/kernel code
handles that result.

Conceptually, a frozen candidate contains:

```text
candidate
  identity
  kind
  exact authority-bearing contents
  canonical serialization and digest
```

The candidate may represent either of the protocol's authorization
boundaries:

```text
IntentAuthorizationCandidate
CommitAuthorizationCandidate
```

These names are conceptual only. Milestone 0 does not establish production
domain types.

The positive result from the trusted UI is an input to the authority kernel.
The kernel binds that result to the frozen candidate and applies the
candidate's authorization only after its own checks. The host confirmation
API is not required to attest the candidate digest, issue a cryptographic or
unforgeable receipt, record authorization durably, enforce single use, or
prove that a physical person generated the UI event.

### 3.1 OpenCode trusted UI owns

* displaying the meaningful authorization candidate supplied by trusted code;
* obtaining an explicit Confirm, Cancel, or dismiss decision;
* returning the UI decision to trusted plugin/kernel code;
* keeping generic permission `allow`, `always`, auto approval, session input,
  forms, and model tool arguments separate from the positive confirmation.

### 3.2 Authority kernel owns

* constructing and freezing the exact candidate;
* canonical serialization and digesting;
* binding the returned UI decision to that frozen candidate;
* distinguishing intent authorization from commit authorization;
* rechecking candidate and repository freshness before use;
* refusing a changed candidate.

### 3.3 Durable local state and kernel transaction own

* recording authorization durably;
* allowing single consumption;
* preventing replay;
* defining safe restart behavior for recorded and consumed authorization.

These are required Coding Authority properties. They are not properties that
`ui.dialog.confirm` itself must attest or provide.

### 3.4 Independent protections

The following must never independently satisfy the Coding Authority gate:

* a model saying `"I authorize"` or otherwise claiming user approval;
* a model supplying `authorized: true`;
* a model reproducing a candidate digest;
* OpenCode permission `allow`, `always`, an existing permission rule, or
  automatic permission behavior;
* session prompt/input, forms, or other model-accessible input surfaces;
* prior authorization, successful tool execution, or lack of a denial.

Cancel, dismiss, interruption, timeout, closure, crash, or an ambiguous result
must not create positive authorization. The UI result must be kept separate
from generic OpenCode permissions, which may remain useful as defense in
depth.

## 4. Trust Boundary Under Test

The V1 trusted computing base is:

* the OpenCode host;
* the OpenCode TUI and its `ui.dialog.confirm` interaction;
* the installed `opencode-agents` plugin;
* the authority kernel;
* its durable local store;
* the local OS/user-account boundary.

The protocol trusts these components to handle the UI decision and local
authority state correctly. It does not claim to distinguish a real physical
person from arbitrary input synthesized inside this trusted computing base.
No host-issued physical-user-provenance receipt is required.

The following remain untrusted as sources of authority:

* LLM/model output;
* model-supplied tool arguments;
* agent prose;
* session/chat transcript;
* generic OpenCode permissions;
* prior runs or prior authorization.

The experiment must establish that supported model-accessible and
non-interactive OpenCode paths cannot directly provide the positive result
for a pending trusted confirmation. Programmatic or model-triggered opening
of the dialog is expected behavior and is not itself a bypass.

## 5. Candidate OpenCode Seams

The primary seam for Milestone 0 is plugin-owned TUI interaction through
`ui.dialog.confirm`. Trusted plugin/kernel code supplies the frozen candidate
for display and receives the decision.

Other OpenCode-native interaction surfaces may be considered only if needed
to determine whether the trusted UI decision boundary exists. A candidate
surface must keep its positive decision separate from model output,
model-accessible arguments, session input, forms, and generic permission
behavior.

The existence of a visible confirmation dialog is not by itself proof. The
manual dogfood must confirm that the complete frozen candidate is displayed
clearly, the expected result is returned for each UI action, and supported
non-interactive routes cannot resolve the pending confirmation positively.
Opening the dialog through a command or model-requested flow is permitted.

## 6. Falsification Matrix

The investigation should actively try to defeat the UI decision boundary and
verify that kernel/store responsibilities have a credible implementation
boundary.

| Case | Required result |
| ---- | --------------- |
| Trusted code presents a frozen candidate and Confirm is selected in the TUI | Positive UI decision is returned to trusted plugin/kernel code |
| Cancel is selected | Negative decision; no positive authorization |
| Dialog is dismissed, closed, interrupted, or its result is ambiguous | No positive authorization is inferred |
| Programmatic or model-triggered flow opens the authorization UI | Allowed; opening alone grants no authority |
| Programmatic/model-accessible path resolves pending confirmation positively without trusted UI confirmation | Failure: the UI boundary is bypassable |
| Model says `"I authorize"` or claims the user approved | No authority |
| Model supplies `authorized: true` | No authority |
| Model reproduces the candidate digest | No authority without the trusted UI decision and kernel binding |
| OpenCode permission `allow` exists | Does not provide the positive confirmation |
| OpenCode permission `always` exists | Does not provide the positive confirmation |
| Automatic permission behavior is enabled | Does not provide the positive confirmation |
| Session input, prompt, form, or model tool arguments contain approval text | Does not provide the positive confirmation |
| Frozen candidate changes after it is displayed | Kernel refuses to bind/use the UI result for the changed candidate |
| Candidate B differs from candidate A by an authority-bearing value | A's UI decision cannot authorize B under kernel binding |
| Candidate/repository freshness changes before use | Kernel refuses the stale authorization |
| Authorization is consumed twice | Durable kernel/store transaction rejects the second consumption |
| Recorded or consumed authorization is encountered after restart | Kernel/store applies explicit safe restart behavior and prevents replay |
| Intent candidate is presented | Uses the same trusted-UI decision boundary as commit authorization |
| Reviewed-target commit candidate is presented | Uses the same trusted-UI decision boundary as intent authorization |

The UI-specific cases establish the host boundary. Candidate binding,
freshness, one-time consumption, replay resistance, and restart safety are
system-level obligations for the kernel and durable store; Milestone 0 should
assess whether that boundary is credible without requiring production
persistence to prove the UI behavior.

Additional adversarial cases should be added whenever investigation exposes
another plausible model-accessible or non-interactive bypass.

## 7. Intent and Commit Scenarios

Milestone 0 must demonstrate that the same trusted-UI decision boundary can
present both representative authorization scenarios. It does not require two
different host interaction primitives.

### Intent authorization

Present a candidate containing enough information for a person using the TUI
to understand the authority being granted, including at minimum:

* requested intent;
* exact repository scope;
* repository/worktree identity;
* bound baseline information relevant to approval.

The authority kernel constructs and freezes this candidate. Its exact
serialization, digest, binding, and later freshness check are kernel
responsibilities.

### Reviewed-target commit authorization

Present a candidate representing authority to commit an already reviewed
target. It should be capable of binding at least:

* the passing review identity/digest;
* the exact reviewed target or target digest;
* exact commit paths;
* relevant current Git baseline;
* human-readable commit intent/summary.

The authority kernel constructs and freezes this candidate and refuses it if
the reviewed target or relevant repository state changes before use. Intent
authorization must not substitute for commit authorization. Both scenarios
use the same OpenCode trusted-UI decision boundary.

## 8. Proof Method

Milestone 0 is an empirical investigation of the OpenCode UI boundary and a
small architectural check of the kernel/store responsibility split.

For `ui.dialog.confirm`:

1. identify the supported OpenCode API and version used;
2. construct the smallest experiment that presents a trusted-code-supplied,
   frozen candidate;
3. manually dogfood the dialog and observe its display and returned result;
4. exercise Confirm, Cancel, dismiss/close, interruption, and ambiguous
   outcomes;
5. try model-accessible and supported non-interactive paths against a pending
   confirmation, distinguishing opening the dialog from positively resolving
   it;
6. exercise generic permission `allow`, `always`, and automatic behavior and
   confirm that they are independent of the dialog result;
7. document which behavior is guaranteed by OpenCode and which is observed in
   the experiment.

Separately, outline or prototype the small kernel boundary that freezes a
candidate, binds a positive UI result to it, checks freshness, and hands the
authorization to a durable transaction for single-use consumption and replay
prevention. This check may use minimal temporary state. It need not build
production SQLite persistence or prove durable store behavior to establish
the UI boundary.

Disposable repositories and OpenCode sessions should be used where needed.
The purpose is to establish the trusted-UI decision boundary and a credible
responsibility split, not to make a polished UI or finish the protocol.

## 9. Evidence Standard

A claim should be classified as one of:

### Proven

Observed end-to-end with a focused experiment, with enough evidence to
reproduce the result. Manual dogfood evidence is material for the display,
Confirm, Cancel, dismiss/close, and bypass questions.

### Host contract

Explicitly guaranteed by the supported OpenCode API or documented behavior
relied upon by the design. Host contracts that are safety-critical should
also receive a focused runtime check where practical.

### Kernel/store design

An explicit responsibility and implementation boundary for candidate
construction, binding, freshness, durable recording, single consumption,
replay prevention, and restart behavior. These properties need not be
implemented in production as part of this milestone, but the boundary must be
credible enough to support the architecture.

### Assumption

Believed true but not mechanically or contractually established. An
assumption that supported model-accessible or non-interactive paths cannot
produce the positive result prevents M0 from passing.

### Rejected

Experimentation demonstrated that the UI decision boundary cannot satisfy
this milestone's host-side property.

The final M0 report should distinguish these categories and identify which
claims concern the UI boundary and which concern the kernel/store design.

## 10. Outcomes

Milestone 0 has three legitimate outcomes.

### PASS

OpenCode's trusted UI boundary demonstrates that:

* trusted code can display a frozen candidate clearly using the OpenCode TUI;
* Confirm returns the expected positive result, while Cancel and
  dismiss/close do not;
* supported model-accessible and non-interactive OpenCode paths cannot
  directly produce the positive result of a pending trusted confirmation;
* generic permission state cannot satisfy the authorization gate;
* intent and reviewed-target commit authorization can use the same decision
  boundary; and
* the architecture has a credible small kernel/store boundary for exact
  candidate binding, freshness checks, durable recording, single-use
  consumption, replay prevention, and restart safety.

A PASS does not require `ui.dialog.confirm` to attest a candidate digest,
provide durable storage, enforce atomic single consumption, prevent replay
after restart, or prove physical-user provenance. It does not require the
Milestone 0 probe to build production SQLite persistence. A PASS permits
architecture work on the Coding Authority Protocol to continue; it does not
prove the rest of the protocol.

### HOST GAP

OpenCode cannot provide a trusted UI decision surface that is separate from
model and supported non-interactive authority paths. For example, a
model-accessible route can resolve a pending confirmation positively without
the trusted UI confirmation action, or the supported UI surface does not
return a decision that trusted plugin/kernel code can distinguish from those
routes.

HOST GAP does not mean that OpenCode lacks candidate digest attestation,
durable authorization storage, atomic single-use consumption, or replay
protection after restart. Those are kernel/store responsibilities. A HOST
GAP should trigger a decision about whether a small OpenCode API enhancement
is reasonable; it should not automatically trigger construction of an MCP
server or separate authority daemon.

### FAIL

The proposed Coding Authority architecture cannot meet its required
authorization properties without granting authority to model/conversation
claims, generic permission state, replayable inputs, or infrastructure
comparable in complexity to the architecture `opencode-agents` is intended
to avoid. A FAIL requires architectural reconsideration before further
implementation.

## 11. Stop Conditions

Do not broaden Milestone 0 to solve adjacent problems. Specifically, stop
before designing:

* the complete run schema;
* workflow phases;
* implementation/review transitions;
* Git receipt formats;
* validation policy;
* repair behavior;
* recovery protocols;
* agent prompts;
* installation/distribution architecture.

Use only enough temporary code and state to evaluate the UI boundary and
demonstrate the kernel/store responsibility split. Do not build production
SQLite persistence merely to establish the host-side UI property. Keep
candidate binding, freshness, durable single-use consumption, replay
prevention, and restart safety as explicit system requirements for the
kernel/store design.

## 12. Milestone Deliverable

The milestone should end with a short evidence report containing:

* OpenCode version/API surface tested;
* mechanisms investigated;
* manual dogfood and adversarial experiments performed;
* Confirm, Cancel, dismiss/close, and interruption results;
* results of model-accessible and non-interactive bypass attempts;
* interaction with generic permission behaviors;
* relied-upon host guarantees;
* kernel/store boundary for candidate binding and later single-use
  consumption;
* unresolved assumptions;
* selected mechanism, if any;
* outcome: `PASS`, `HOST GAP`, or `FAIL`;
* architectural consequences.

If the outcome is `PASS`, the next architecture work should define the Coding
Authority Protocol around the proven UI decision boundary and kernel/store
responsibilities.

If the outcome is `HOST GAP` or `FAIL`, do not proceed as though the trusted
UI decision boundary has been established.
