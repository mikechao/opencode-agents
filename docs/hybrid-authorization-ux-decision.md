# Hybrid Plan / Authorization UX Decision

## Status

**Selected for further UX work; production transcript projection remains unresolved.** This decision records presentation direction only. It does not authorize an implementation change.

## Context

M0, M1, and M2 are complete and live-dogfooded PASS. M2 currently asks for authorization in a large `ui.dialog.confirm`. Live dogfood found that the modal blocks ordinary inspection and navigation, while the final result disappears when dismissed ([M2 live dogfood](milestone-2-live-dogfood.md)).

Native Form/Question is not CAP-compatible: a previously authorized shell-capable Implementer can enumerate and affirm a pending Form through supported OpenCode client/CLI APIs ([Form/Question reassessment](native-question-cap-reassessment.md)). A direct TUI-local callback in a small plugin-owned component remains a viable non-modal authorization primitive ([non-modal investigation](native-nonmodal-authorization-investigation.md)).

## Prototype A — Full Composer-Top Card

Prototype A put the full plan and candidate in a bounded, scrollable `session.composer.top` card with direct local **Authorize** and **Cancel** callbacks.

Manual dogfood found it clearly better than the blocking modal and made non-modal authorization usable. The full plan card still felt like a workflow widget added onto OpenCode, used a large part of the conversation surface, and felt less natural than the earlier `codex-agents` conversational experience.

## Prototype B — Hybrid Conversation + Compact Authorization

Prototype B showed the implementation plan as ordinary root conversation content and kept only a compact candidate identity plus direct local **Authorize** and **Cancel** callbacks in `session.composer.top`.

Manual dogfood found this substantially more natural and closer to the earlier `codex-agents` experience. The plan reads and scrolls as part of the conversation, the normal composer remains visually primary, and the compact strip stays associated with the plan without dominating the interface.

The prototype used public `session.create`, `session.export`, and `session.import` APIs to seed static conversation content. That was only a visual simulation. It does not establish `session.import` as a production mechanism or solve trusted transcript projection.

## Selected UX Direction

Carry forward this presentation flow:

```text
User request
→ Planner child
→ trusted candidate freeze
→ exact plan presented naturally in the root conversation
→ compact trusted authorization strip near the composer
→ TUI-local Authorize / Cancel callbacks
→ existing trusted liveness / binding / freshness checks
→ existing one-use CAP implementation admission
```

The selected layout is conversation-native plan presentation plus a compact `session.composer.top` authorization strip with direct TUI-local callbacks. The presentation should make the exact frozen candidate easy to read while keeping the composer visually primary.

## Security / Authority Boundary

> Conversation is presentation, not CAP authority.

Trusted code continues to own candidate identity and exact content; bound root, HEAD, and worktree facts; transcript and session bindings; activation-private authorization state; the single-use CAP grant; and freshness checks. Conversation text can display the plan, but cannot create or carry authority. The authorization result comes from the bound local callback and is followed by the existing trusted checks.

## Explicit Non-Decisions

This record does not decide:

- how trusted code projects or inserts the exact frozen candidate into the root transcript;
- whether OpenCode has a supported display-only transcript append API;
- whether a model-generated echo, `session.synthetic`, or `session.import` could be used in production;
- how final result or STOP is projected into the transcript;
- Reviewer UX or Commit UX.

In particular, the hybrid prototype has not solved trusted transcript projection, and its `session.import` fixture is not a production decision.

## Relationship to Prior Investigations

The [non-modal authorization investigation](native-nonmodal-authorization-investigation.md) preferred a full composer-top plan card based on source and runtime feasibility, before the manual UX comparison. The two disposable prototypes supplied new UX evidence. This record supersedes that investigation's **presentation-layout preference** only; it does not invalidate its CAP analysis of direct TUI-local callbacks. The earlier investigation remains unchanged as the historical record.

## Next Investigation

Determine the smallest production-compatible way to project the exact trusted frozen candidate into the root conversation without model-mediated copying, without making conversation authoritative, and without adding workflow state or storage.

## Prototype Provenance

- `~/projects/opencode-agents-ux-prototype` — full composer-top card.
- `~/projects/opencode-agents-hybrid-ux-prototype` — conversation plan with compact authorization strip.

These were disposable manual UX experiments outside this repository. They are not required for build, test, or runtime and are not normative implementation sources. Their local filesystem paths are included only to preserve the provenance of the manual comparison; repository documentation does not depend on those directories existing.
