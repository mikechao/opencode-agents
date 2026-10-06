import type { Context } from "@opencode/plugin/tui/context"
import type { TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"

// Presentation only: the caller retains the exact Plan and owns all acceptance
// checks. Closing/disposal settles once, so obsolete callbacks cannot close a
// later dialog or return its text.
export function editRevision(context: Context, binding: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const settle = (text: string | undefined) => {
      if (settled) return false
      settled = true
      resolve(text)
      return true
    }
    const close = (text: string | undefined) => {
      if (settle(text)) context.ui.dialog.clear()
    }
    function RevisionEditor() {
      const dimensions = useTerminalDimensions()
      const theme = context.theme.surface("dialog")
      const [target, setTarget] = createSignal<TextareaRenderable>()
      const submit = () => {
        const editor = target()
        if (editor && !editor.isDestroyed) close(editor.plainText)
      }
      const shortcuts = (id: string) => context.keymap.shortcuts(id).join(" / ")
      const focus = () => {
        const editor = target()
        if (!settled && editor && !editor.isDestroyed) editor.focus()
      }
      context.ui.dialog.set({ size: "large", centered: true })
      onCleanup(() => settle(undefined))
      // Match DialogPrompt's focused modal command. All editing/newline keys
      // remain owned by the host's managed textarea layer and user keybinds.
      context.keymap.layer(() => ({
        mode: "modal",
        target,
        enabled: target() !== undefined && !settled,
        priority: 1,
        commands: [{ id: "dialog.prompt.submit", title: "Submit Plan revision", run: submit }],
      }))
      onMount(() => {
        // The host blurs the previous focus when replacing a dialog. Focus
        // after that pass, like DialogPrompt; the host restores focus on close.
        const timer = setTimeout(focus, 1)
        onCleanup(() => clearTimeout(timer))
      })
      return (
        <box
          paddingX={2}
          paddingBottom={1}
          gap={1}
          flexDirection="column"
          minWidth={0}
          maxHeight={Math.max(1, dimensions().height - 1)}
        >
          <box flexDirection="column" flexShrink={0}>
            <text wrapMode="word" fg={theme.text.base}>
              Revise Plan
            </text>
            <text wrapMode="char" fg={theme.text.muted}>
              {binding}
            </text>
          </box>
          <box
            title="Revision instructions"
            titleColor={theme.text.base}
            border
            borderStyle="single"
            borderColor={theme.border.base}
            backgroundColor={theme.background.formfield.base}
            paddingX={1}
            width="100%"
            minHeight={6}
            flexShrink={1}
          >
            <textarea
              ref={setTarget}
              width="100%"
              minHeight={4}
              maxHeight={Math.max(4, Math.min(10, Math.floor(dimensions().height / 3)))}
              flexShrink={1}
              wrapMode="word"
              placeholder="Revision instruction"
              placeholderColor={theme.text.muted}
              backgroundColor={theme.background.formfield.base}
              focusedBackgroundColor={theme.background.formfield.base}
              textColor={theme.text.formfield.base}
              focusedTextColor={theme.text.formfield.base}
              cursorColor={theme.text.base}
              onSubmit={submit}
              onMouseDown={(event) => {
                // OpenCode disables renderer autoFocus. Leave native mouse
                // selection/caret placement and wheel scrolling untouched.
                if (event.button === 0) focus()
              }}
            />
          </box>
          <box flexDirection="column" flexShrink={0}>
            <text wrapMode="word" fg={theme.text.muted}>
              Submitting permanently supersedes this Plan.
            </text>
            <text
              wrapMode="word"
              fg={theme.text.muted}
            >{`${shortcuts("dialog.prompt.submit")} submit · Esc cancel`}</text>
            <text wrapMode="word" fg={theme.text.muted}>{`${shortcuts("input.newline")} newline`}</text>
          </box>
          <box flexDirection="row" gap={2} flexShrink={0}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI mouse actions also have host keyboard bindings. */}
            <text
              fg={theme.text.base}
              onMouseUp={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                submit()
              }}
            >
              Submit revision
            </text>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape/click cancellation uses the host dialog lifecycle. */}
            <text
              fg={theme.text.base}
              onMouseUp={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                close(undefined)
              }}
            >
              Cancel
            </text>
          </box>
        </box>
      )
    }
    context.ui.dialog.show(RevisionEditor, () => settle(undefined))
  })
}
