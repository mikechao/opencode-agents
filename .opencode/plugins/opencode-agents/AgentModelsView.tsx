import type { Context } from "@opencode/plugin/tui/context"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createComponent, createSignal, ErrorBoundary, For, onCleanup, Show } from "solid-js"
import type { Role, RolePreference } from "../../../src/agent-models.ts"

export function displayRows(rows: readonly RolePreference[]) {
  return rows.map((row) => {
    const preference = row.preference
    const preferenceStatus =
      preference.kind === "override"
        ? preference.availability === "model-unavailable"
          ? "Model unavailable"
          : preference.availability === "variant-unavailable"
            ? "Variant unavailable"
            : ""
        : preference.kind === "invalid"
          ? `Invalid saved preference: ${preference.message}`
          : ""
    return {
      role: row.role,
      agent: row.label,
      model:
        preference.kind === "override"
          ? `${preference.model.providerID}/${preference.model.id}`
          : preference.kind === "native"
            ? "Native behavior"
            : "Invalid saved preference",
      variant: preference.kind === "override" ? (preference.model.variant ?? "default") : "—",
      status: [preferenceStatus, row.loaded ? "" : "Agent not loaded"].filter(Boolean).join(" · "),
      muted: preference.kind !== "override",
    }
  })
}
type DisplayRow = ReturnType<typeof displayRows>[number]

// Match the host's large (88-column) dialog, allowing smaller terminals to
// shrink the model column without stealing space from variant/status.
export function columnWidths(terminalWidth: number, showStatus: boolean) {
  const width = Math.max(1, Math.min(88, terminalWidth - 2) - 4)
  const agent = Math.max(8, Math.min(14, Math.floor(width * 0.2)))
  const variant = Math.max(8, Math.min(12, Math.floor(width * 0.16)))
  const status = showStatus ? Math.max(10, Math.min(14, Math.floor(width * 0.18))) : 0
  return { agent, variant, status, compact: showStatus && width < 66 }
}

export function selectAgentRole(context: Context, rows: readonly RolePreference[]): Promise<Role | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const done = (role: Role | undefined) => {
      if (settled) return
      settled = true
      resolve(role)
    }
    context.ui.dialog.show(
      () =>
        createComponent(AgentModelsDialog, {
          context,
          rows: displayRows(rows),
          onSelect: done,
          onDispose: () => done(undefined),
        }),
      () => done(undefined),
    )
  })
}

export function AgentModelsDialog(props: {
  context: Context
  rows: readonly DisplayRow[]
  onSelect: (role: Role) => void
  onDispose: () => void
}) {
  onCleanup(props.onDispose)
  props.context.ui.dialog.set({ size: "large", centered: true })
  return (
    <ErrorBoundary
      fallback={(error) => (
        <box paddingX={2} paddingBottom={1} gap={1} flexDirection="column">
          <text attributes={TextAttributes.BOLD}>Unable to render agent models</text>
          <text wrapMode="word">{error instanceof Error ? error.message : String(error)}</text>
          <text>esc to close · reopen /agent-models to retry</text>
        </box>
      )}
    >
      <AgentModelsView {...props} />
    </ErrorBoundary>
  )
}

function AgentModelsView(props: { context: Context; rows: readonly DisplayRow[]; onSelect: (role: Role) => void }) {
  const dimensions = useTerminalDimensions()
  const showStatus = () => props.rows.some((row) => row.status !== "")
  const widths = () => columnWidths(dimensions().width, showStatus())
  const theme = () => props.context.theme.surface("dialog")
  const [selected, setSelected] = createSignal(0)
  let scroll: ScrollBoxRenderable | undefined
  const move = (delta: number) => {
    if (!props.rows.length) return
    const index = (selected() + props.rows.length + delta) % props.rows.length
    setSelected(index)
    const row = scroll?.getChildren()[index + 1] // Header is the first child.
    if (!scroll || !row) return
    const offset = row.y - scroll.y
    if (offset < 0) scroll.scrollBy(offset)
    else if (offset + row.height > scroll.height) scroll.scrollBy(offset + row.height - scroll.height)
  }
  const choose = (index: number) => {
    const row = props.rows[index]
    if (!row) return
    props.onSelect(row.role)
    props.context.ui.dialog.clear()
  }
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      {
        id: "dialog.select.prev",
        title: "Previous agent",
        run: () => move(-1),
      },
      {
        id: "dialog.select.next",
        title: "Next agent",
        run: () => move(1),
      },
      { id: "dialog.select.submit", title: "Edit agent", run: () => choose(selected()) },
    ],
  }))

  return (
    <box paddingX={2} paddingBottom={1} flexDirection="column" gap={1}>
      <text fg={theme().text.base} attributes={TextAttributes.BOLD}>
        Agent models
      </text>
      <text fg={theme().text.muted} wrapMode="word">
        Preferences for future fresh subagents
      </text>
      <scrollbox
        ref={scroll}
        flexGrow={0}
        maxHeight={Math.max(3, dimensions().height - 10)}
        scrollX={false}
        wrapperOptions={{ flexGrow: 0 }}
        viewportOptions={{ flexGrow: 0 }}
        contentOptions={{ minHeight: 0 }}
      >
        <box flexDirection="row" flexShrink={0} paddingBottom={1}>
          <box width={widths().agent} flexShrink={0} paddingRight={1}>
            <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
              Agent
            </text>
          </box>
          <box flexGrow={1} flexBasis={0} minWidth={0} paddingRight={1}>
            <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
              Model
            </text>
          </box>
          <box width={widths().variant + (widths().compact ? 0 : widths().status)} flexShrink={0} flexDirection="row">
            <box width={widths().variant} flexShrink={0} paddingRight={1}>
              <text attributes={TextAttributes.BOLD} fg={theme().text.base} wrapMode="word">
                {widths().compact ? "Variant / Status" : "Variant"}
              </text>
            </box>
            <Show when={showStatus() && !widths().compact}>
              <box width={widths().status} flexShrink={0}>
                <text attributes={TextAttributes.BOLD} fg={theme().text.base}>
                  Status
                </text>
              </box>
            </Show>
          </box>
        </box>
        <For each={props.rows}>
          {(row, index) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI rows use the modal keyboard layer above, not DOM roles.
            <box
              id={`agent-models-row-${row.role}`}
              flexDirection="row"
              flexShrink={0}
              paddingY={1}
              backgroundColor={selected() === index() ? theme().background.raised.high : undefined}
              onMouseMove={() => setSelected(index())}
              onMouseUp={() => choose(index())}
            >
              <box width={widths().agent} flexShrink={0} paddingRight={1}>
                <text wrapMode="word" fg={theme().text.base} attributes={TextAttributes.BOLD}>
                  {row.agent}
                </text>
              </box>
              <box flexGrow={1} flexBasis={0} minWidth={0} paddingRight={1}>
                <text wrapMode="char" fg={row.muted ? theme().text.muted : theme().text.base}>
                  {row.model}
                </text>
              </box>
              <box
                flexDirection={widths().compact ? "column" : "row"}
                flexShrink={0}
                width={widths().variant + (widths().compact ? 0 : widths().status)}
              >
                <box width={widths().variant} flexShrink={0} paddingRight={1}>
                  <text wrapMode="word" fg={theme().text.base}>
                    {row.variant}
                  </text>
                </box>
                <Show when={showStatus()}>
                  <box width={widths().compact ? widths().variant : widths().status} flexShrink={0}>
                    <text wrapMode="word" fg={theme().text.muted}>
                      {row.status}
                    </text>
                  </box>
                </Show>
              </box>
            </box>
          )}
        </For>
      </scrollbox>
      <text fg={theme().text.muted} wrapMode="word">
        ↑/↓ to select · enter or click to edit · esc to close
      </text>
      <text fg={theme().text.muted} wrapMode="word">
        Reset restores OpenCode agent configuration / parent-model inheritance.
      </text>
    </box>
  )
}
