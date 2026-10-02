import { afterEach, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtempSync, realpathSync, rmSync, writeFileSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { candidateIntact, displayPath, makeCandidate, parseProposal, renderPlan } from "../src/proposal.ts"

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

test("proposal must preserve three exact fields and reject expanded scope", () => {
  const root = fixture()
  const text = JSON.stringify({ intent: "change", plan: "edit", files: ["old.txt", "new.txt"] })
  const proposal = parseProposal(text, root)
  expect(proposal.files).toEqual(["old.txt", "new.txt"])
  expect(Object.isFrozen(proposal.files)).toBe(true)
  symlinkSync(tmpdir(), path.join(root, "outside"))
  for (const files of [["old.txt", "old.txt"], ["../outside"], ["*.txt"], ["."], ["/tmp/file"], [".git/config"]]) {
    expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files }), root)).toThrow()
  }
  expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files: ["old.txt"], extra: true }), root)).toThrow()
  expect(() => parseProposal(JSON.stringify({ intent: "change", plan: "edit", files: ["outside/file.txt"] }), root)).toThrow()
  expect(() => parseProposal("```json\n" + text + "\n```", root)).toThrow()
})

const proposal = JSON.stringify({
  intent: "Change old file",
  plan: "Update its contents\nCheck the result",
  files: ["old.txt", "new.txt", "nested/three.txt"],
})

test("trusted plan rendering preserves multiline text and exact candidate scope", () => {
  const root = fixture()
  const candidate = makeCandidate(parseProposal(proposal, root), root, HEAD)
  const expected = [
    "Plan", "", "Change old file", "", "Update its contents", "Check the result", "",
    "Exact files (3)", '• "old.txt"', '• "new.txt"', '• "nested/three.txt"', "",
    "Bound HEAD", candidate.head, "", "No implementation has been authorized.",
  ].join("\n")
  expect(renderPlan(candidate)).toBe(expected)
  expect(renderPlan(candidate)).not.toContain("\\n")
  expect(renderPlan(candidate)).not.toBe(proposal)
  expect(candidate.proposal.plan).toBe("Update its contents\nCheck the result")
})

test("exact intent, plan, file order, root and HEAD bind candidate encoding and digest", () => {
  const root = fixture()
  const exact = { intent: "  exact intent\n ", plan: "  1. Edit\n2. Test\n ", files: ["new.txt", "old.txt"] }
  const parsed = parseProposal(JSON.stringify(exact), root)
  expect(parsed).toEqual(exact)
  expect(Object.isFrozen(parsed)).toBe(true)
  expect(Object.isFrozen(parsed.files)).toBe(true)
  const head = HEAD
  const candidate = makeCandidate(parsed, root, head)
  const encoding = JSON.stringify({ kind: "intent", intent: exact.intent, plan: exact.plan, files: exact.files, root, head })
  expect(candidate.encoding).toBe(encoding)
  expect(candidate.digest).toBe(createHash("sha256").update(encoding).digest("hex"))
  expect(Object.isFrozen(candidate)).toBe(true)
  expect(candidateIntact(candidate)).toBe(true)
  for (const altered of [
    { ...candidate, root: root + "/other" },
    { ...candidate, head: "0".repeat(40) },
    { ...candidate, encoding: encoding + " " },
    { ...candidate, digest: "0".repeat(64) },
    { ...candidate, proposal: { ...parsed, intent: exact.intent.trim() } },
    { ...candidate, proposal: { ...parsed, plan: exact.plan.trim() } },
    { ...candidate, proposal: { ...parsed, files: [...parsed.files].reverse() } },
  ]) expect(candidateIntact(altered)).toBe(false)
})

test("trusted scope labels quote and escape every display-sensitive path without changing bytes", () => {
  const root = fixture()
  const files = ['review-example.txt\n• second.txt', 'line\rreturn', 'tab\tfile', 'escape\x1bfile', 'del\x7ffile',
    'bidi\u202efile', 'zero\u200bwidth', 'line\u2028separator', 'paragraph\u2029separator', 'quote"file', 'é.txt', '😀.txt']
  const candidate = makeCandidate(parseProposal(JSON.stringify({ intent: "i", plan: "p", files }), root), root, HEAD)
  const labels = renderPlan(candidate).split("\n").filter((line) => line.startsWith("• ")).map((line) => line.slice(2))
  expect(labels).toHaveLength(files.length)
  expect(labels.map((label) => JSON.parse(label))).toEqual(files)
  expect(labels.every((label) => /^[\x20-\x7e]+$/.test(label))).toBe(true)
  expect(new Set(labels).size).toBe(files.length)
  expect(candidate.proposal.files).toEqual(files)
  const separate = makeCandidate(parseProposal(JSON.stringify({ intent: "i", plan: "p", files: ['review-example.txt', 'second.txt'] }), root), root, HEAD)
  expect(renderPlan(candidate)).not.toBe(renderPlan(separate))
  expect(displayPath('review-example.txt\n• second.txt')).toBe('"review-example.txt\\n\\u2022 second.txt"')
  const empty = makeCandidate(parseProposal('{"intent":"i","plan":"p","files":[]}', root), root, HEAD)
  expect(renderPlan(empty)).toContain("Exact files (0)\n(none)")
})

test("existing dangling final symlinks fail closed for internal and outside missing targets", () => {
  const root = fixture(), outside = fixture()
  for (const [name, target] of [['internal-dangling', path.join(root, 'absent')], ['outside-dangling', path.join(outside, 'absent')]]) {
    symlinkSync(target!, path.join(root, name!))
    expect(() => parseProposal(JSON.stringify({ intent: 'i', plan: 'p', files: [name] }), root)).toThrow()
  }
  expect(parseProposal('{"intent":"i","plan":"p","files":["new.txt"]}', root).files).toEqual(['new.txt'])
})

test("exact scope permits internal final symlinks and rejects escaping symlinks and malformed paths", () => {
  const root = realpathSync(fixture())
  symlinkSync(path.join(root, "old.txt"), path.join(root, "internal.txt"))
  const outside = fixture()
  symlinkSync(path.join(outside, "old.txt"), path.join(root, "escaping.txt"))
  expect(parseProposal(JSON.stringify({ intent: "i", plan: "p", files: ["internal.txt", "missing/parent/new.txt"] }), root).files)
    .toEqual(["internal.txt", "missing/parent/new.txt"])
  for (const file of ["escaping.txt", "old.txt/child", "a//b", "a/./b", "a/../b", "a\\b", "a\0b", "a?b", "a[b]", "a{b}", ""]) {
    expect(() => parseProposal(JSON.stringify({ intent: "i", plan: "p", files: [file] }), root)).toThrow()
  }
})
