import { expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import path from "node:path"
import type {} from "./fixtures/repair-layout.tsx"

test("Repair preserves exact boundaries through transfer and receipt events in the real OpenTUI layout", () => {
  // attempt.test.ts mocks the Solid reconciler globally for cheap handler tests.
  // Isolate this one headless rendering boundary so it uses the installed
  // reconciler/Yoga, with trusted host/Git doubles and no OpenCode process.
  const result = spawnSync(
    process.execPath,
    ["--preload", "@opentui/solid/preload", path.join(import.meta.dir, "fixtures/repair-layout.tsx")],
    { cwd: path.resolve(import.meta.dir, ".."), encoding: "utf8" },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(result.stdout.trim()).toBe("repair-layout-ok")
})
