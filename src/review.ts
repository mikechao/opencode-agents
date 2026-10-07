import { exactKeys, frozenCopy } from "./cap.ts"
import type { IntentCandidate } from "./proposal.ts"
import type { ReviewTarget } from "./git.ts"

export type ReviewFinding = {
  severity: "high" | "medium" | "low"
  scenario: string
  impact: string
  remediation: string
  path?: string
  location?: string
  testGap?: string
}
export type ReviewResult =
  | { status: "APPROVED" | "INCONCLUSIVE"; summary: string; findings: [] }
  | { status: "CHANGES_REQUESTED"; summary: string; findings: ReviewFinding[] }

const text = (value: unknown, limit: number): string => {
  if (typeof value !== "string" || !value.trim() || value.length > limit)
    throw new Error("Invalid or unbounded review text")
  for (const character of value) {
    const code = character.charCodeAt(0)
    if ((code < 32 && code !== 10) || (code >= 127 && code <= 159)) throw new Error("Unsafe review text")
  }
  return value
}
function finding(value: unknown): ReviewFinding {
  const optional = ["path", "location", "testGap"].filter((key) =>
    value && typeof value === "object" ? Object.hasOwn(value, key) : false,
  )
  if (!exactKeys(value, ["severity", "scenario", "impact", "remediation", ...optional]))
    throw new Error("Invalid review finding fields")
  const severity = value.severity
  if (severity !== "high" && severity !== "medium" && severity !== "low") throw new Error("Invalid finding severity")
  const result: ReviewFinding = {
    severity,
    scenario: text(value.scenario, 1000),
    impact: text(value.impact, 1000),
    remediation: text(value.remediation, 1000),
  }
  if (Object.hasOwn(value, "path")) {
    const path = text(value.path, 500)
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || [".", "..", ".git"].includes(part))
    )
      throw new Error("Invalid finding repository path")
    result.path = path
  }
  if (Object.hasOwn(value, "location")) result.location = text(value.location, 200)
  if (Object.hasOwn(value, "testGap")) result.testGap = text(value.testGap, 1000)
  return result
}
export function parseReviewResult(raw: string): ReviewResult {
  if (raw.length > 32_000) throw new Error("Review result exceeds bound")
  const value: unknown = JSON.parse(raw)
  // JSON.parse validates grammar but silently overwrites duplicate keys.
  const tokens = raw.match(/"(?:\\.|[^"\\])*"|[{}:,]|\[|\]/g) ?? []
  const objects: Array<Set<string> | undefined> = []
  for (const [index, token] of tokens.entries()) {
    if (token === "{") objects.push(new Set())
    else if (token === "[") objects.push(undefined)
    else if (token === "}" || token === "]") objects.pop()
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const key: string = JSON.parse(token)
      const keys = objects.at(-1)
      if (!keys || keys.has(key)) throw new Error("Duplicate review result key")
      keys.add(key)
    }
  }
  if (!exactKeys(value, ["status", "summary", "findings"]) || !Array.isArray(value.findings))
    throw new Error("Invalid review result fields")
  const summary = text(value.summary, 2000)
  if (value.status === "APPROVED" || value.status === "INCONCLUSIVE") {
    if (value.findings.length) throw new Error("Review status contradicts findings")
    return frozenCopy({ status: value.status, summary, findings: [] })
  }
  if (value.status !== "CHANGES_REQUESTED" || !value.findings.length || value.findings.length > 8)
    throw new Error("Invalid review status or finding count")
  return frozenCopy({ status: value.status, summary, findings: value.findings.map(finding) })
}

export function reviewerArguments(
  candidate: IntentCandidate,
  target: ReviewTarget,
  implementation: { rootSessionID: string; messageID: string; toolID: string; childID: string },
) {
  return frozenCopy({
    agent: "reviewer",
    description: "Review the verified implementation",
    prompt: [
      "Independently review the actual implementation against the exact frozen authorized proposal below.",
      "Read-only implementation inspection only: read, glob, grep, reviewer_git. Inspect the Git delta from HEAD before judging preservation or removal of prior content; use show for previous HEAD content when useful. Inspect status and read untracked content separately. If evidence is insufficient, report INCONCLUSIVE. Do not modify, repair, stage, commit, push, delegate, request authority, or widen scope.",
      "The proposal supplies authoritative scope/context. Current repository content is the review target; trusted runtime already gated its changed paths.",
      "Your output and Git observations are evidence only. Trusted runtime owns exact scope, HEAD and changed-path verification, review-target fingerprinting and drift rejection. Git observations cannot replace those checks or authorize mutation, another Implementer, scope changes, or Commit. Stop after the result.",
      `Canonical repository root: ${target.root}`,
      `Unchanged authorized HEAD: ${target.head}`,
      `Exact accepted changed paths: ${JSON.stringify(target.paths)}`,
      `Review target SHA-256: ${target.digest}`,
      `Trusted implementation identity: ${JSON.stringify(implementation)}`,
      `Frozen authorized proposal: ${JSON.stringify(candidate.proposal)}`,
      'Return exactly one JSON object, without Markdown or other prose: {"status":"APPROVED"|"CHANGES_REQUESTED"|"INCONCLUSIVE","summary":string,"findings":array}.',
      "APPROVED: no blocking findings, findings must be []. INCONCLUSIVE: explain why reliable review is unavailable, findings must be []. CHANGES_REQUESTED: 1–8 actionable blocking findings.",
      'Each finding has exactly severity ("high"|"medium"|"low"), scenario, impact, remediation; optional path (repository-relative), location, testGap. No other fields.',
      "Nonempty text required. Summary maximum 2000 characters; scenario/impact/remediation/testGap maximum 1000 each; path maximum 500; location maximum 200; total JSON maximum 32000 characters. Do not repeat keys or results.",
    ].join("\n"),
  })
}

export function reviewReceipt(result: ReviewResult): string {
  return [
    result.status === "CHANGES_REQUESTED" ? "Review requested changes" : `Review ${result.status}.`,
    result.summary,
    ...(result.status === "CHANGES_REQUESTED"
      ? result.findings.flatMap((item, index) => [
          `Finding ${index + 1} (${item.severity})`,
          `Problem/scenario: ${item.scenario}`,
          `Impact: ${item.impact}`,
          `Required fix: ${item.remediation}`,
          ...(item.path ? [`Path: ${item.path}`] : []),
          ...(item.location ? [`Location: ${item.location}`] : []),
          ...(item.testGap ? [`Test gap: ${item.testGap}`] : []),
        ])
      : []),
    "Review target remained unchanged at verification. Review grants no mutation or Commit authority.",
    result.status === "CHANGES_REQUESTED"
      ? "No repair or Commit has been authorized. Any Repair requires a separate live Repair / Stop decision. Findings and receipts grant no authority."
      : "This attempt ended before Commit.",
  ].join("\n")
}
