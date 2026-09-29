import { candidateIntact, type IntentCandidate } from "./proposal.ts"

export interface Generation {
  revoked: boolean
  busy: boolean
}

export interface IntentGrant {
  readonly digest: string
  readonly purpose: "implement"
  consumed: boolean
}

export function assertLive(generation: Generation): void {
  if (generation.revoked) throw new Error("TUI plugin generation was revoked")
}

export function grantIntent(candidate: IntentCandidate, confirmed: boolean | undefined, generation: Generation): IntentGrant {
  assertLive(generation)
  if (confirmed !== true || !candidateIntact(candidate)) throw new Error("Intent authorization was not granted")
  return { digest: candidate.digest, purpose: "implement", consumed: false }
}

export function consumeIntent(grant: IntentGrant, candidate: IntentCandidate, generation: Generation): void {
  assertLive(generation)
  if (grant.consumed || grant.purpose !== "implement" || grant.digest !== candidate.digest || !candidateIntact(candidate)) {
    throw new Error("Intent authorization is stale or already consumed")
  }
  grant.consumed = true
}
