import { expect, test } from "bun:test"
import { TextareaRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

// The component's focus handler is covered by attempt.test.ts. Check the
// native mouse behavior it must preserve, with OpenCode's autoFocus setting.
test("revision textarea natively places the caret, selects and scrolls with renderer autoFocus disabled", async () => {
  const ui = await createTestRenderer({ width: 40, height: 24, autoFocus: false })
  try {
    const text = "first line\nsecond line\n" + "another line\n".repeat(10)
    const editor = new TextareaRenderable(ui.renderer, {
      width: 30,
      height: 4,
      wrapMode: "word",
      initialValue: text,
    })
    ui.renderer.root.add(editor)
    await ui.renderOnce()
    await ui.mockMouse.click(editor.screenX + 3, editor.screenY + 1)
    expect(editor.focused).toBe(false)
    expect(editor.logicalCursor).toMatchObject({ row: 1, col: 3 })
    await ui.mockMouse.drag(editor.screenX, editor.screenY, editor.screenX + 5, editor.screenY)
    expect(editor.getSelectedText()).toBe("first ")
    ui.renderer.clearSelection()
    await ui.mockMouse.scroll(editor.screenX + 1, editor.screenY + 1, "down")
    expect(editor.scrollY).toBeGreaterThan(0)
    expect(editor.plainText).toBe(text)
  } finally {
    ui.renderer.destroy()
  }
})
