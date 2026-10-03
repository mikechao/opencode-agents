// Presentation only: never wakes execution or supplies CAP admission evidence.
export function receiptInput<ID extends string>(rootSessionID: ID, receipt: string) {
  return {
    sessionID: rootSessionID,
    delivery: "steer" as const,
    text: receipt,
    description: receipt,
    metadata: { source: "opencode-agents" },
    resume: false,
  }
}
