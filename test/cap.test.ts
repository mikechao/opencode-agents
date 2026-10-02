import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NativeCap, assertLive, type AuthorizeClaim } from "../src/cap.ts"
import { makeCandidate, parseProposal } from "../src/proposal.ts"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
function claim(): AuthorizeClaim {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "cap-primitives-")))
  roots.push(root)
  return { purpose: "implement", rootSessionID: "root", publicationID: "plan", location: { directory: root },
    candidate: makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, "1".repeat(40)) }
}
const call = { sessionID: "root", agent: "orchestrator", messageID: "message", id: "call" }
const control = () => "control"

test("copies and deeply freezes the exact claim; occupies one slot throughout activation", () => {
  const cap = new NativeCap()
  const input = structuredClone(claim()) as any
  cap.accept(input, control)
  input.candidate.proposal.files.push("other")
  input.rootSessionID = "other"
  expect(cap.claim.candidate.proposal.files).toEqual(["old.txt"])
  expect(cap.claim.rootSessionID).toBe("root")
  expect(Object.isFrozen(cap.claim.candidate.proposal.files)).toBe(true)
  expect(cap.control.text).toBe("control")
  expect(() => cap.accept(claim(), control)).toThrow("One governed")
  cap.close()
  expect(() => cap.accept(claim(), control)).toThrow("One governed")
})

test("malformed claims and corrupt candidate bytes burn the occupied slot", () => {
  for (const mutate of [
    (c: any) => c.candidate.encoding += " ",
    (c: any) => c.candidate.digest = "0".repeat(64),
    (c: any) => c.purpose = "commit",
    (c: any) => c.extra = true,
    (c: any) => c.candidate.kind = "other",
    (c: any) => c.location.workspaceID = false,
  ]) {
    const cap = new NativeCap(), input = structuredClone(claim())
    mutate(input)
    expect(() => cap.accept(input, control)).toThrow()
    expect(cap.phase).toBe("closed")
    expect(() => cap.accept(claim(), control)).toThrow("One governed")
  }
})

test("reservation selects one owner, losers cannot change it; consumption and closure reject replay", () => {
  const cap = new NativeCap()
  cap.accept(claim(), control)
  cap.reserve(call)
  for (const loser of [{ ...call, id: "other" }, { ...call, messageID: "other" }, { ...call, agent: "build" }]) {
    expect(() => cap.reserve(loser)).toThrow()
    expect(() => cap.assertReserved(loser)).toThrow()
    expect(() => cap.consume(loser)).toThrow()
    expect(() => cap.assertReserved(call)).not.toThrow()
  }
  cap.enter(call)
  expect(() => cap.enter(call)).toThrow("already entered")
  expect(() => cap.assertReserved(call)).not.toThrow()
  cap.consume(call)
  expect(cap.phase).toBe("consumed")
  expect(() => cap.consume(call)).toThrow()
  expect(() => cap.reserve(call)).toThrow()
  expect(() => cap.accept(claim(), control)).toThrow("One governed")
  cap.close()
  expect(() => cap.reserve(call)).toThrow()
  expect(() => cap.accept(claim(), control)).toThrow("One governed")
})

test("native receipts bind one child and teardown rejects retained authority", () => {
  const cap = new NativeCap()
  cap.accept(claim(), control)
  expect(() => cap.progress("child")).toThrow()
  cap.reserve(call); cap.consume(call); cap.progress("child"); cap.progress("child")
  expect(() => cap.progress("other")).toThrow()
  const result = { output: { sessionID: "child" } }
  cap.receipt(result)
  result.output.sessionID = "other"
  expect(cap.result).toEqual({ output: { sessionID: "child" } })
  expect(() => cap.receipt(result)).toThrow()
  cap.teardown()
  for (const run of [() => cap.live(), () => cap.reserve(call), () => cap.progress("child"), () => cap.accept(claim(), control)]) expect(run).toThrow("revoked")
  expect(() => assertLive({ revoked: true, busy: false })).toThrow("revoked")
})
