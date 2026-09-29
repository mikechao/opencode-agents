# Historical evidence

Everything in this directory is **non-normative historical evidence**. Current
documentation is owned by the [documentation map](../README.md),
[charter](../charter.md), [CAP](../coding-authority-protocol.md), and
[orchestration](../v1-orchestration.md).

These files preserve investigations, rejected designs, probes, dogfood evidence,
and completed-transition audits. Old file paths, role names, milestone names,
API assumptions, and conclusions are intentionally preserved in their
historical context; they do not describe today's runtime by default.

## B1 / trusted kernel / CAP hosting

[Kernel/store isolation](b1-trusted-kernel-store-isolation-investigation.md),
[authority reassessment](b1-authority-integrity-reassessment.md),
[CAP hosting](cap-kernel-hosting-investigation.md),
[TUI/Git probe](pre-m1-tui-git-hosting-probe.md), and
[generation-revocation probe](pre-m1-plugin-generation-revocation-probe.md)
establish the local-process authority model, same-user limitations, hosting
choice, and live generation-revocation evidence. Durable-authority activation
prompted the earlier readiness review; stronger isolation and runtime-verifier
designs were not adopted.

## Milestone 0

[Investigation](milestone-0-investigation.md) and
[dogfood harness](milestone-0-dogfood-harness.md) preserve the final M0
decision-boundary evidence and harness/procedure, including PASS and its limits.

## M1 / Git boundary

[Commit-effect follow-up](m1-git-commit-effect-boundary-follow-up.md),
[target-derivation reassessment](m1-git-target-derivation-reassessment.md), and
[live dogfood](milestone-1-live-dogfood.md) preserve commit-effect limitations,
rejected stronger target-derivation designs, and live scope evidence.

## Native authority / same-child implementation

[CAP-gated native Implementer](milestone-2-cap-gated-native-implementer-investigation.md),
[native-child handoff](milestone-2-native-child-authority-handoff-investigation.md),
[threat-model reassessment](milestone-2-native-child-threat-model-reassessment.md), and
[live dogfood](milestone-2-live-dogfood.md) preserve the final distinction between
ordinary OpenCode capability and CAP admission, and the same-child live PASS.
Earlier contrary handoff analysis remains evidence of the rejected alternatives.

## Authorization UX

[Question/Form reassessment](native-question-cap-reassessment.md),
[non-modal investigation](native-nonmodal-authorization-investigation.md), and
[hybrid decision](hybrid-authorization-ux-decision.md) record rejection of
model-mediated Question/Form authorization, feasibility of local callbacks, and
the selected future compact local authorization surface now summarized in
current orchestration.

## Plan presentation / projection

[Transcript projection](trusted-transcript-projection-investigation.md),
[zero-click presentation](zero-click-stock-opencode-plan-presentation-investigation.md), and
[native subagent results](native-subagent-result-presentation-investigation.md)
preserve rejected/fallback presentation paths and host-rendering constraints
that preceded the current trusted synthetic Plan publication.

## Runtime simplification

[Investigation](m1-m2-runtime-simplification-investigation.md),
[reconciliation](m1-m2-runtime-simplification-reconciliation.md), and the
[documentation cleanup plan](documentation-cleanup-plan.md) preserve the
transition specification, closure evidence, and documentation disposition.
The reconciliation closed the milestone-named runtime simplification as
**COMPLETE — NO RUNTIME GAPS**.
