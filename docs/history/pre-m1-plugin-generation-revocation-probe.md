# Disposable Pre-M1 Plugin Generation Revocation Probe

**Historical evidence.** This document records investigation, design, or observed behavior at an earlier repository state. It is not current normative documentation. See [`../README.md`](../README.md) for the current documentation map.

This is a lifecycle-only dogfood probe. It has no CAP state, creates no grant,
and performs no privileged effect. The command opens one trusted TUI
confirmation and records whether an old activation resumes after its cleanup
has revoked it.

The probe completed and its plugin has been removed from the live plugin
surface. This page preserves the historical procedure and result; the steps
below are not runnable from the current checkout. The source remains in
[Git history](https://github.com/mikechao/opencode-agents/blob/bb739a993be156150482fd471c457386afff8fdc/.opencode/plugins/pre-m1-plugin-generation-revocation-probe/tui.js).

## Manual dogfood

1. Before starting OpenCode, clear the prior diagnostic log:

       : > /private/tmp/opencode-pre-m1-plugin-generation-revocation-probe.jsonl

2. From this checkout, start the ordinary local TUI:

       cd /Users/mike/projects/opencode-agents
       opencode

   Do not add --server. This project-local plugin is discovered from
   .opencode/plugins.

3. In the TUI, invoke /pre-m1-revocation-probe. Leave its confirmation
   pending; do not answer it yet.

4. From a second terminal, in the same checkout, append a harmless comment to
   the exact local TUI plugin entrypoint:

       cd /Users/mike/projects/opencode-agents
       printf '\n// reload-trigger-1\n' >> .opencode/plugins/pre-m1-plugin-generation-revocation-probe/tui.js

   OpenCode watches this local entrypoint's parent directory and filters file
   events by the entrypoint basename. A changed content fingerprint schedules
   reconciliation. Wait for replacement generation activation before
   answering the old confirmation.

5. While the TUI confirmation is still open, inspect the newest events from
   the second terminal:

       tail -n 8 /private/tmp/opencode-pre-m1-plugin-generation-revocation-probe.jsonl

   Confirm that generation A has generation-revoked and a different
   generation B has generation-activated. OpenCode's current source leaves
   the pending dialog in the shared TUI dialog manager during plugin
   deactivation, so it should remain usable. If it is still open, press its
   “Return true” button after B activates. Dismissing it is also useful if the
   host or another UI action has closed/replaced it.

6. Inspect the complete evidence:

       cat /private/tmp/opencode-pre-m1-plugin-generation-revocation-probe.jsonl

   Each JSONL record has a generation UUID used only to group log events.
   The first generation-activated is A; the later activation after A's
   generation-revoked is replacement B. Each setup call makes a fresh
   closure with revoked: false; the log does not initialize or restore that
   state.

## Expected evidence

PASS requires, in order:

- A: generation-activated, then confirm-started;
- A: generation-revoked before B: generation-activated;
- if A's dialog promise resumes after cleanup: A records
  stale-continuation-blocked after confirm-returned (or for a rejected
  promise), with no later A would-grant or would-use;
- B has a distinct generation UUID and its own activation-private state.

The dialog result may be true, false, or undefined; an error or a dialog
that never resumes is not itself a host gap. The stronger result is to answer
the still-open A dialog after B activates and observe A block the resumed
continuation. would-grant and would-use are diagnostic labels only.

A lifecycle gap would require source-supported evidence that deactivation
cannot run the cleanup revocation before replacement setup, or that a stale
continuation can pass the revoked check after cleanup. Normal dialog
dismissal is fail-closed and is not a gap.

## Observed dogfood result

On 2026-09-26, the manual reload produced the stronger late-affirmative case.
Generation A was:

    f397dfca-ab63-44b0-b334-22f7b2523d18
    generation-activated
    confirm-started
    generation-revoked

Generation B then activated:

    cde5b99f-c38c-4a54-aaea-4a837d5a3c0d
    generation-activated

After B was active, the original pending A dialog remained usable. Selecting
“Return true” produced:

    confirm-returned result=true
    stale-continuation-blocked result=true

A recorded no later would-grant or would-use event. This is a strong-form
**PASS**, not a dialog-cancellation result.

## Source basis

The authoritative local source reviewed was ../opencode at commit
00738c5b2d. packages/tui/src/plugin/context.tsx watches local plugin
sources, resolves changed modules, awaits deactivation/cleanup, then calls
replacement setup. The cleanup list is unwound in reverse order, so the
plugin's returned cleanup runs before context-owned unregister callbacks.
packages/tui/src/plugin/watch.ts watches the entrypoint's parent directory,
filtered to the basename; packages/tui/src/plugin/source.ts fingerprints
the entrypoint and imported local sources.

packages/tui/src/plugin/api.tsx implements ui.dialog.confirm through the
shared TUI dialog manager and resolves true, false, or undefined on confirm,
cancel, or close. Plugin deactivation does not clear that dialog;
packages/tui/src/ui/dialog.tsx clears it only on a dialog operation or close.
Therefore, source permits the pending old promise to resume later. The probe
does not depend on that stronger interaction succeeding: any stale
continuation checks its generation's local revoked flag before the
diagnostic grant/use steps.
