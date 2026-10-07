import { Rpc } from "@opencode/plugin/effect"
import { exactKeys, frozenCopy } from "./cap.ts"
import { candidateIntact, parseProposal, type IntentCandidate } from "./proposal.ts"
import { parseReviewResult, type ReviewResult } from "./review.ts"
import type { ReviewTarget } from "./git.ts"

export type RepairDecision = Readonly<{
  id: string
  rootSessionID: string
  rootIdleID: string
  rootEventSeq: number
  candidate: IntentCandidate
  target: ReviewTarget
  result: Extract<ReviewResult, { status: "CHANGES_REQUESTED" }>
  receipts: ReadonlyArray<Readonly<{ id: string; text: string }>>
  reviewer: Readonly<{ messageID: string; toolID: string; childID: string; resultID: string }>
}>
export type CycleOutcome =
  | { kind: "terminal"; receipt: string }
  | { kind: "repair"; receipt: string; decision: RepairDecision }

export function checkedCycleOutcome(value: unknown): CycleOutcome {
  if (!exactKeys(value, ["kind", "receipt"]) && !exactKeys(value, ["kind", "receipt", "decision"]))
    throw new Error("Invalid cycle outcome")
  if (
    !exactKeys(value, value.kind === "terminal" ? ["kind", "receipt"] : ["kind", "receipt", "decision"]) ||
    typeof value.receipt !== "string"
  )
    throw new Error("Invalid cycle outcome")
  if (value.kind === "terminal") return frozenCopy({ kind: "terminal", receipt: value.receipt })
  const decision = value.decision as RepairDecision
  if (
    value.kind !== "repair" ||
    !exactKeys(decision, [
      "id",
      "rootSessionID",
      "rootIdleID",
      "rootEventSeq",
      "candidate",
      "target",
      "result",
      "reviewer",
      "receipts",
    ]) ||
    typeof decision.id !== "string" ||
    !decision.id ||
    typeof decision.rootSessionID !== "string" ||
    !decision.rootSessionID ||
    typeof decision.rootIdleID !== "string" ||
    !decision.rootIdleID.startsWith("msg_") ||
    !Number.isSafeInteger(decision.rootEventSeq) ||
    decision.rootEventSeq < 0 ||
    !exactKeys(decision.candidate, ["kind", "proposal", "root", "head", "encoding", "digest"]) ||
    decision.candidate.kind !== "intent" ||
    !candidateIntact(decision.candidate) ||
    JSON.stringify(parseProposal(JSON.stringify(decision.candidate.proposal), decision.candidate.root)) !==
      JSON.stringify(decision.candidate.proposal) ||
    !exactKeys(decision.target, ["root", "head", "paths", "digest"]) ||
    decision.target.root !== decision.candidate.root ||
    decision.target.head !== decision.candidate.head ||
    !Array.isArray(decision.target.paths) ||
    decision.target.paths.some(
      (path) => typeof path !== "string" || !decision.candidate.proposal.files.includes(path),
    ) ||
    JSON.stringify([...new Set(decision.target.paths)].sort()) !== JSON.stringify(decision.target.paths) ||
    !/^[a-f0-9]{64}$/.test(decision.target.digest) ||
    !Array.isArray(decision.receipts) ||
    decision.receipts.some(
      (item) =>
        !exactKeys(item, ["id", "text"]) || typeof item.id !== "string" || !item.id || typeof item.text !== "string",
    ) ||
    !exactKeys(decision.reviewer, ["messageID", "toolID", "childID", "resultID"]) ||
    Object.values(decision.reviewer).some((id) => typeof id !== "string" || !id) ||
    parseReviewResult(JSON.stringify(decision.result)).status !== "CHANGES_REQUESTED"
  )
    throw new Error("Invalid Repair decision")
  return frozenCopy(value) as CycleOutcome
}

// Only a trusted session-log position proves an event predates verification.
// Missing, malformed, or foreign envelopes confer no historical exemption.
export function sessionEventSeq(
  event: { id?: string; data: Record<string, unknown>; durable?: unknown },
  rootSessionID: string,
): number | undefined {
  const durable = event.durable
  if (
    typeof event.id === "string" &&
    event.id.startsWith("evt_") &&
    event.data.sessionID === rootSessionID &&
    exactKeys(durable, ["aggregateID", "seq", "version"]) &&
    durable.aggregateID === rootSessionID &&
    typeof durable.seq === "number" &&
    Number.isSafeInteger(durable.seq) &&
    durable.seq >= 0 &&
    typeof durable.version === "number" &&
    Number.isSafeInteger(durable.version) &&
    durable.version > 0
  )
    return durable.seq
  return undefined
}

export function historicalReviewEvent(
  event: { id?: string; data: Record<string, unknown>; durable?: unknown },
  boundary: Pick<RepairDecision, "rootSessionID" | "rootEventSeq">,
): boolean {
  const seq = sessionEventSeq(event, boundary.rootSessionID)
  return seq !== undefined && seq <= boundary.rootEventSeq
}

// Portable Standard Schema: avoid passing an Effect AST to the host's separate
// Effect runtime. Both host transport and the receiving TUI validate the union.
const cycleSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "opencode-agents",
    validate: (value: unknown) => {
      try {
        return { value: checkedCycleOutcome(value) }
      } catch (error) {
        return { issues: [{ message: String(error) }] }
      }
    },
  },
}
// Local trusted transport; the client selects a server-owned decision only.
export const authorizeRpc = Rpc.define({
  id: "opencode-agents",
  methods: {
    authorize: { input: { type: "object" } as const, output: cycleSchema },
    decideRepair: { input: { type: "object" } as const, output: cycleSchema },
    revise: { input: { type: "object" } as const, output: { type: "null" } as const },
  },
  events: {},
})
