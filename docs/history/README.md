# Historical evidence

Everything here is **non-normative evidence at recorded revisions**, including
completed investigations, rejected alternatives, probes and live validation.
Start with the [current documentation map](../README.md) for project purpose,
authority requirements and runtime architecture. Old roles, versions, paths and
recommendations describe their historical context, not today's implementation.
Intentionally deferred decisions live under [investigations](../investigations/).

Use the following groups to find evidence; this is not an exhaustive file index.

- **Native admission and trust checks:** [native CAP investigation](issue-9-native-cap-minimum-investigation.md)
  and [architecture review](issue-9-architecture-review.md) preserve the admission
  rationale, concrete path/presentation defects and why semantic verification
  replaced incidental representation checks. Findings and proposed fixes are
  historical; current code owns their implemented resolution.
- **Planning and host transport:** [Explorer investigation](issue-13-explorer-investigation.md)
  records native foreground result flow and the corrected boundary between advisory
  child provenance and Plan authority. [Plugin RPC investigation](issue-23-plugin-rpc-investigation.md)
  preserves the foreign Effect parser/optional-variant failure trace, portable
  schema decision and directory routing/lifecycle limits.
- **Local trust boundary:** the `b1-*`, `cap-kernel-hosting-*` and `pre-m1-*`
  reports preserve same-user limitations, authority/kernel decisions and hosting
  and revocation probes. Stronger isolation alternatives were not adopted.
- **Git and native child boundaries:** the `m1-git-*` and `milestone-*` reports
  preserve observed outcomes, rejected target/commit designs and the distinction
  between ordinary child capability and CAP admission. Old dogfood reports apply
  only to their recorded implementation and host versions.
  [Issue #22 Commit authority inspection](issue-22-commit-authority-inspection.md)
  records why direct implementation, separate Commit authority and structured Git
  enforcement fit the existing runtime, including the staging fingerprint transition.
- **Authorization and presentation:** [published-Plan authorization](published-plan-authorization-investigation.md),
  the `native-*` UX reports, [hybrid decision](hybrid-authorization-ux-decision.md),
  [transcript projection](trusted-transcript-projection-investigation.md) and
  [zero-click presentation](zero-click-stock-opencode-plan-presentation-investigation.md)
  preserve human-decision and rendering seam evidence. The `issue-4-*` through
  `issue-6-*` reports cover observed resize, navigation, publication and admission
  failures; the Issue #8 custom-row proposal is superseded by native presentation.
- **Completed runtime transition:** [investigation](m1-m2-runtime-simplification-investigation.md)
  and [reconciliation](m1-m2-runtime-simplification-reconciliation.md) retain
  preservation requirements and closure evidence for the old milestone runtime.
- **Test performance:** [historical audit](test-performance-audit.md) and its
  [measurements](test-performance/) preserve the old 45-test baseline, attribution
  and fixture methodology. Their counts and budgets are not current requirements.
  Operational measurement tooling remains under [scripts](../../scripts/).

Completed implementation checklists and redundant version-delta reports are
pruned rather than archived indefinitely. Git history retains deleted originals;
retained reports may link to a pinned original where it supplies historical context.
