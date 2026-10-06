import { expect, test } from "bun:test"
import { BoxRenderable, TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

test("populated revision dialog keeps Plan identity and actions visible at 30, 40 and 80 columns", () => {
  // attempt.test.ts mocks the Solid JSX renderer process-wide. Use a private
  // Bun process for this one real component/layout check, without OpenCode.
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--preload",
      "@opentui/solid/preload",
      "--eval",
      `
        import { BoxRenderable } from "@opentui/core"
        import { testRender, useRenderer } from "@opentui/solid"
        import { editRevision } from "./.opencode/plugins/opencode-agents/revision-editor.tsx"
        const text = " \\n" + "A long instruction. ".repeat(50) + "\\n\\nLiteral last line\\n "
        const frames = []
        for (const width of [30, 40, 80]) {
          let content
          const context = {
            theme: { surface: () => ({ text: { base: "white", muted: "gray", formfield: { base: "white" } } }) },
            ui: { dialog: { show: (render) => { content = render }, set: () => {}, clear: () => {} } },
            keymap: {
              layer: () => {},
              shortcuts: (id) => id === "dialog.prompt.submit" ? ["enter"] : ["shift+enter", "ctrl+enter", "alt+enter", "ctrl+j"],
            },
          }
          void editRevision(context, "Plan 123456789abc · HEAD abcdef123456")
          const ui = await testRender(() => {
            // Match the host's large dialog width clamp and top padding.
            const shell = new BoxRenderable(useRenderer(), { width: Math.min(88, width - 2), paddingTop: 1 })
            shell.add(content())
            return shell
          }, { width, height: 24 })
          await ui.renderOnce()
          await Bun.sleep(5)
          await ui.mockInput.pasteBracketedText(text)
          await ui.renderOnce()
          frames.push({ width, frame: ui.captureCharFrame(), text: ui.renderer.currentFocusedEditor?.plainText })
          ui.renderer.destroy()
        }
        console.log(JSON.stringify({ text, frames }))
      `,
    ],
    { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" },
  )
  expect(result.stderr.toString()).toBe("")
  expect(result.exitCode).toBe(0)
  const output = JSON.parse(result.stdout.toString())
  expect(output.frames.map((entry: any) => entry.width)).toEqual([30, 40, 80])
  for (const entry of output.frames) {
    expect(entry.frame).toContain("Revise Plan")
    expect(entry.frame).toContain("Plan 123456789abc")
    expect(entry.frame).toContain("supersedes")
    expect(entry.frame).toContain("submit · Esc")
    expect(entry.frame).toContain("newline")
    expect(entry.frame).toContain("Submit revision  Cancel")
    expect(entry.text).toBe(output.text)
  }
})
