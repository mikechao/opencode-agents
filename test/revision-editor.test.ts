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

// Native primitive checks complement the plugin's JSX/host-double tests in
// attempt.test.ts. No OpenCode process or global key interception is involved.
test("revision textarea wraps narrow text without inserting newlines and scrolls within its height", async () => {
  const ui = await createTestRenderer({ width: 40, height: 24 })
  try {
    const box = new BoxRenderable(ui.renderer, { width: 38, paddingLeft: 2, paddingRight: 2 })
    const editor = new TextareaRenderable(ui.renderer, {
      width: "100%",
      minHeight: 4,
      maxHeight: 8,
      wrapMode: "word",
    })
    ui.renderer.root.add(box)
    box.add(editor)
    editor.focus()
    const text = ` \nA long paragraph with literal whitespace and Unicode ☃ wraps to multiple rows.\n\n${"long-token".repeat(18)}\n `
    await ui.mockInput.pasteBracketedText(text)
    await ui.renderOnce()
    expect(ui.renderer.currentFocusedEditor).toBe(editor)
    expect(editor.width).toBe(34)
    expect(editor.height).toBeLessThanOrEqual(8)
    expect(editor.virtualLineCount).toBeGreaterThan(editor.lineCount)
    expect(editor.scrollY).toBeGreaterThan(0)
    expect(editor.plainText).toBe(text)
    ui.resize(80, 24)
    box.width = 78
    await ui.renderOnce()
    expect(editor.plainText).toBe(text)
    ui.resize(40, 24)
    box.width = 38
    editor.gotoBufferHome()
    await ui.renderOnce()
    expect(editor.scrollY).toBe(0)
    expect(ui.captureCharFrame()).toContain("A long paragraph")
    expect(editor.plainText).toBe(text)
  } finally {
    ui.renderer.destroy()
  }
})

test("revision textarea supports editing existing lines and returns exact buffer text on submit", async () => {
  const ui = await createTestRenderer({ width: 40, height: 24 })
  try {
    let submitted: string | undefined
    const editor = new TextareaRenderable(ui.renderer, {
      width: 34,
      minHeight: 4,
      maxHeight: 8,
      wrapMode: "word",
      onSubmit: () => {
        submitted = editor.plainText
      },
    })
    ui.renderer.root.add(editor)
    editor.focus()
    await ui.mockInput.pasteBracketedText("First line\nSecond line\n")
    editor.gotoBufferHome()
    ui.mockInput.pressArrow("right")
    ui.mockInput.pressBackspace()
    await ui.mockInput.typeText("f")
    expect(editor.plainText).toBe("first line\nSecond line\n")
    editor.setCursor(1, 6)
    editor.newLine() // The host's configured input.newline action calls this.
    await ui.mockInput.typeText("literal ")
    expect(editor.plainText).toBe("first line\nSecond\nliteral  line\n")
    editor.submit() // The host's configured input.submit action calls this.
    expect(submitted).toBe("first line\nSecond\nliteral  line\n")
  } finally {
    ui.renderer.destroy()
  }
})
