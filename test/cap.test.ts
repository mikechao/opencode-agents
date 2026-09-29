import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { assertLive, consumeIntent, grantIntent, type Generation, type IntentGrant } from "../src/cap.ts"
import { candidateIntact, makeCandidate, parseProposal } from "../src/proposal.ts"

const roots: string[] = []
const HEAD = "1".repeat(40)
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-agents-primitives-")))
  roots.push(root)
  writeFileSync(path.join(root, "old.txt"), "initial\n")
  return root
}

test("candidate binds proposal and one-use grant stays private to live generation", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, HEAD)
  const generation: Generation = { revoked: false, busy: false }
  expect(() => assertLive(generation)).not.toThrow()
  expect(candidateIntact(candidate)).toBe(true)
  expect(() => grantIntent(candidate, false, generation)).toThrow()
  expect(() => grantIntent(candidate, undefined, generation)).toThrow()
  const grant = grantIntent(candidate, true, generation)
  expect(grant).toEqual({ digest: candidate.digest, purpose: "implement", consumed: false })
  consumeIntent(grant, candidate, generation)
  expect(grant.consumed).toBe(true)
  expect(() => consumeIntent(grant, candidate, generation)).toThrow()
  generation.revoked = true
  expect(() => assertLive(generation)).toThrow()
  expect(() => grantIntent(candidate, true, generation)).toThrow()
})

test("corrupted candidate encoding or digest cannot grant or consume authority", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, HEAD)
  const generation: Generation = { revoked: false, busy: false }
  for (const corrupted of [{ ...candidate, encoding: candidate.encoding + " " }, { ...candidate, digest: "0".repeat(64) }]) {
    expect(candidateIntact(corrupted)).toBe(false)
    expect(() => grantIntent(corrupted, true, generation)).toThrow()
    const grant = grantIntent(candidate, true, generation)
    expect(() => consumeIntent(grant, corrupted, generation)).toThrow()
    expect(grant.consumed).toBe(false)
  }
})

test("altered grant digest or purpose and a different intact candidate cannot consume", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, HEAD)
  const generation: Generation = { revoked: false, busy: false }
  const grant = grantIntent(candidate, true, generation)
  for (const altered of [{ ...grant, digest: "different" }, { ...grant, purpose: "commit" } as unknown as IntentGrant]) {
    expect(() => consumeIntent(altered, candidate, generation)).toThrow()
    expect(altered.consumed).toBe(false)
  }
  const different = makeCandidate({ ...candidate.proposal, plan: "different plan" }, candidate.root, candidate.head)
  expect(candidateIntact(different)).toBe(true)
  expect(() => consumeIntent(grant, different, generation)).toThrow()
  expect(grant.consumed).toBe(false)
})

test("revocation prevents consumption of an otherwise valid unused grant", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":["old.txt"]}', root), root, HEAD)
  const generation: Generation = { revoked: false, busy: false }
  const grant = grantIntent(candidate, true, generation)
  generation.revoked = true
  expect(() => consumeIntent(grant, candidate, generation)).toThrow("revoked")
  expect(grant.consumed).toBe(false)
})
