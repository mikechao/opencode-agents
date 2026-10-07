import { expect, test } from "bun:test"
import { repairProse } from "../.opencode/plugins/opencode-agents/repair-prose.ts"
import { displayPath } from "../src/proposal.ts"

test("Repair prose reads naturally while paths retain their separate escaping", () => {
  const text = repairProse("The file ends after “Dogfood repair line one.” It’s incomplete. café 界 😀")
  expect(text).toBe('The file ends after "Dogfood repair line one." It\'s incomplete. café 界 😀')
  expect(text).not.toContain("\\u201c")
  expect(text).not.toContain("\\u201d")
  expect(repairProse("cafe\u0301\u00a0text")).toBe("café text")
  expect(displayPath("“path”")).toBe('"\\u201cpath\\u201d"')
})

test("Repair prose renders terminal controls and formatting characters as visible safe text", () => {
  for (const character of [
    "\x00",
    "\x1b",
    "\x7f",
    "\x9b",
    "\n",
    "\t",
    "\r",
    "\u202e",
    "\u2066",
    "\u200d",
    "\u2028",
    "\u2029",
    "\u0301",
  ]) {
    const text = repairProse(`before ${character} after`)
    expect(text).not.toContain(character)
    expect(text).toStartWith("before ")
    expect(text).toEndWith(" after")
    expect(text).toMatch(/^before \\(?:u[0-9a-f]{4}|[ntr]) after$/)
  }
  expect(repairProse("\x1b[31mred\x1b[0m")).toBe("\\u001b[31mred\\u001b[0m")
})
