import { expect, test } from "bun:test"
import { parseReviewResult, reviewReceipt, type ReviewFinding, type ReviewResult } from "../src/review.ts"

const finding: ReviewFinding = {
  severity: "high",
  path: "src/app.ts",
  location: "load()",
  scenario: "An empty input is supplied",
  impact: "The request crashes",
  remediation: "Handle empty input",
  testGap: "Add an empty-input test",
}
const valid: ReviewResult[] = [
  { status: "APPROVED", summary: "No blocking findings", findings: [] },
  { status: "CHANGES_REQUESTED", summary: "One blocking failure", findings: [finding] },
  { status: "INCONCLUSIVE", summary: "Source is insufficient to conclude", findings: [] },
]
for (const value of valid)
  test(`strict review accepts ${value.status}`, () => {
    const result = parseReviewResult(JSON.stringify(value))
    expect(result).toEqual(value)
    expect(Object.isFrozen(result)).toBe(true)
    expect(reviewReceipt(result)).toContain(`Review ${value.status}.`)
    expect(reviewReceipt(result)).toContain("Review grants no mutation or Commit authority")
  })

test("review rejects malformed, contradictory, ambiguous and unbounded results", () => {
  const good = { status: "APPROVED", summary: "Good", findings: [] }
  for (const raw of [
    "{",
    `\`\`\`json\n${JSON.stringify(good)}\n\`\`\``,
    JSON.stringify(good) + JSON.stringify(good),
    '{"status":"APPROVED","status":"INCONCLUSIVE","summary":"Good","findings":[]}',
    '{"status":"APPROVED","sta\\u0074us":"INCONCLUSIVE","summary":"Good","findings":[]}',
    '{"status":"CHANGES_REQUESTED","summary":"Problem","findings":[{"severity":"high","severity":"low","scenario":"Fail","impact":"Crash","remediation":"Fix"}]}',
    JSON.stringify(null),
    JSON.stringify([]),
    ...[
      { ...good, status: "UNKNOWN" },
      { status: "APPROVED", findings: [] },
      { ...good, extra: true },
      { ...good, summary: " " },
      { ...good, summary: "x".repeat(2001) },
      { ...good, summary: "bad\u0000" },
      { ...good, findings: [finding] },
      { ...good, status: "INCONCLUSIVE", findings: [finding] },
      { ...good, status: "CHANGES_REQUESTED" },
      { ...good, status: "CHANGES_REQUESTED", findings: Array(9).fill(finding) },
      ...[
        null,
        {},
        { ...finding, severity: "critical" },
        { ...finding, scenario: "" },
        { ...finding, extra: true },
        { ...finding, path: "../other" },
        { ...finding, remediation: "x".repeat(1001) },
      ].map((item) => ({ ...good, status: "CHANGES_REQUESTED", findings: [item] })),
    ].map((value) => JSON.stringify(value)),
    " ".repeat(32001),
  ])
    expect(() => parseReviewResult(raw)).toThrow()
})
