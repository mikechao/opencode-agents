import { createHash } from "node:crypto"
import { lstatSync, realpathSync } from "node:fs"
import path from "node:path"

export interface Proposal {
  readonly intent: string
  readonly plan: string
  readonly files: readonly string[]
}

export interface IntentCandidate {
  readonly kind: "intent"
  readonly proposal: Proposal
  readonly root: string
  readonly head: string
  readonly encoding: string
  readonly digest: string
}

function exactFile(value: unknown, root: string): asserts value is string {
  if (typeof value !== "string" || !value || value.includes("\\") || value.includes("\0")) {
    throw new Error("Scope must contain exact repository-relative file paths")
  }
  if (path.posix.isAbsolute(value) || value.includes("//") || /[*?\[\]{}]/.test(value)) {
    throw new Error(`Invalid scope path: ${value}`)
  }
  const parts = value.split("/")
  if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) {
    throw new Error(`Invalid scope path: ${value}`)
  }
  for (let length = 1; length < parts.length; length++) {
    const ancestor = path.join(root, ...parts.slice(0, length))
    try {
      const info = lstatSync(ancestor)
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Scope path has an invalid parent: ${value}`)
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    }
  }
  const full = path.join(root, value)
  let info
  try { info = lstatSync(full) } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error
    return // Only an absent final entry is an ordinary new file.
  }
  if (info.isDirectory()) throw new Error(`Scope path is a directory: ${value}`)
  // An existing symlink must resolve; ENOENT here is not an absent entry.
  if (info.isSymbolicLink() && !realpathSync(full).startsWith(`${root}${path.sep}`)) {
    throw new Error(`Scope path leaves the worktree: ${value}`)
  }
}

export function parseProposal(text: string, root: string): Proposal {
  let input: unknown
  try {
    input = JSON.parse(text)
  } catch {
    throw new Error("Planner did not return one JSON proposal")
  }
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Planner proposal must be an object")
  }
  const value = input as Record<string, unknown>
  if (Object.keys(value).sort().join(",") !== "files,intent,plan") {
    throw new Error("Planner proposal must have exactly intent, plan, and files")
  }
  if (typeof value.intent !== "string" || !value.intent.trim() || typeof value.plan !== "string" || !value.plan.trim()) {
    throw new Error("Planner intent and plan must be nonempty text")
  }
  if (/[\x00-\x09\x0b-\x1f\x7f]/.test(value.intent) || /[\x00-\x09\x0b-\x1f\x7f]/.test(value.plan)) {
    throw new Error("Planner intent and plan contain unsafe control characters")
  }
  if (!Array.isArray(value.files) || new Set(value.files).size !== value.files.length) {
    throw new Error("Planner file scope must be a finite set without duplicates")
  }
  for (const file of value.files) exactFile(file, root)
  return Object.freeze({ intent: value.intent, plan: value.plan, files: Object.freeze([...value.files]) })
}

export function makeCandidate(proposal: Proposal, root: string, head: string): IntentCandidate {
  const encoding = JSON.stringify({ kind: "intent", intent: proposal.intent, plan: proposal.plan, files: proposal.files, root, head })
  const digest = createHash("sha256").update(encoding).digest("hex")
  return Object.freeze({ kind: "intent", proposal, root, head, encoding, digest })
}

export function candidateIntact(candidate: IntentCandidate): boolean {
  const current = makeCandidate(candidate.proposal, candidate.root, candidate.head)
  return current.encoding === candidate.encoding && current.digest === candidate.digest
}

// Quoted ASCII JSON is injective and keeps controls, bidi/formatting characters
// and Unicode separators from changing the terminal's path presentation.
export const displayPath = (value: string): string => JSON.stringify(value).replace(/[\u007f-\uffff]/g,
  (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`)

export function renderPlan(candidate: IntentCandidate): string {
  return [
    "Plan",
    "",
    candidate.proposal.intent,
    "",
    candidate.proposal.plan,
    "",
    `Exact files (${candidate.proposal.files.length})`,
    ...(candidate.proposal.files.length ? candidate.proposal.files.map((file) => `• ${displayPath(file)}`) : ["(none)"]),
    "",
    "Bound HEAD",
    candidate.head,
    "",
    "No implementation has been authorized.",
  ].join("\n")
}
