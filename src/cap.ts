import { randomUUID } from "node:crypto"
import type { LocationRef } from "@opencode/client"
import { candidateIntact, type IntentCandidate } from "./proposal.ts"

export interface Generation {
  revoked: boolean
  busy: boolean
}
export function assertLive(generation: Generation): void {
  if (generation.revoked) throw new Error("TUI plugin generation was revoked")
}
export interface AuthorizeClaim {
  readonly purpose: "implement"
  readonly candidate: IntentCandidate
  readonly rootSessionID: string
  readonly location: Readonly<LocationRef>
  readonly publicationID: string // TUI provenance, not an independently verified credential.
}
export interface Reservation {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
}
export function frozenCopy<T>(value: T): T {
  const copy = structuredClone(value)
  function freeze(item: unknown): void {
    if (!item || typeof item !== "object") return
    for (const child of Object.values(item)) freeze(child)
    Object.freeze(item)
  }
  freeze(copy)
  return copy
}
export function exactKeys(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Reflect.ownKeys(value).length === names.length &&
    names.every((name) => Object.hasOwn(value, name))
  )
}

// One slot for one root in the server plugin activation. Even a rejected/ambiguous
// submission occupies it forever; only phase changes, never the claim identity.
export class NativeCap {
  #occupied = false
  #revoked = false
  #phase: "available" | "reserved" | "consumed" | "closed" = "closed"
  #claim?: AuthorizeClaim
  #executorEntered = false
  #reservation?: Readonly<Reservation>
  #control?: Readonly<{ id: string; text: string }>
  #result?: Readonly<{ childID: string; status: "completed" }>

  get claim(): AuthorizeClaim {
    this.live()
    if (!this.#claim) throw new Error("No CAP claim")
    return this.#claim
  }
  get control(): Readonly<{ id: string; text: string }> {
    this.live()
    if (!this.#control) throw new Error("No CAP control")
    return this.#control
  }
  get phase() {
    return this.#phase
  }
  get rootSessionID() {
    return this.#claim?.rootSessionID
  }
  get childID() {
    return this.#result?.childID
  }
  get reservation() {
    this.live()
    if (!this.#reservation) throw new Error("No CAP reservation")
    return this.#reservation
  }
  get result() {
    return this.#result
  }

  accept(input: unknown, controlText: (candidate: IntentCandidate) => string): void {
    this.live()
    if (this.#occupied) throw new Error("One governed implementation attempt per root")
    this.#occupied = true // Before copying, validation, or any RPC await.
    try {
      if (!exactKeys(input, ["purpose", "candidate", "rootSessionID", "location", "publicationID"]))
        throw new Error("Malformed Authorize claim")
      const claim = frozenCopy(input) as unknown as AuthorizeClaim
      if (
        claim.purpose !== "implement" ||
        !claim.rootSessionID ||
        typeof claim.rootSessionID !== "string" ||
        !claim.publicationID ||
        typeof claim.publicationID !== "string" ||
        !exactKeys(
          claim.location,
          claim.location && Object.hasOwn(claim.location, "workspaceID") ? ["directory", "workspaceID"] : ["directory"],
        ) ||
        typeof claim.location.directory !== "string" ||
        !claim.location.directory ||
        (Object.hasOwn(claim.location, "workspaceID") &&
          (typeof claim.location.workspaceID !== "string" || !claim.location.workspaceID)) ||
        !exactKeys(claim.candidate, ["kind", "proposal", "root", "head", "encoding", "digest"]) ||
        claim.candidate.kind !== "intent" ||
        !candidateIntact(claim.candidate)
      )
        throw new Error("Invalid frozen claim integrity")
      this.#claim = claim
      this.#control = Object.freeze({ id: `msg_${randomUUID()}`, text: controlText(claim.candidate) })
      this.#phase = "available"
    } catch (error) {
      this.close()
      throw error
    }
  }
  live(): void {
    if (this.#revoked) throw new Error("Server CAP activation was revoked")
  }
  reserve(call: Reservation): void {
    this.live()
    if (this.#phase !== "available") throw new Error("CAP is reserved, consumed, or closed")
    this.#reservation = frozenCopy(call)
    this.#phase = "reserved" // Malformed owner burns authority; losers never alter it.
  }
  assertReserved(call: Reservation): void {
    this.live()
    const owner = this.#reservation
    if (
      this.#phase !== "reserved" ||
      !owner ||
      !exactKeys(call, ["sessionID", "agent", "messageID", "id"]) ||
      Object.keys(owner).some((key) => owner[key as keyof Reservation] !== call[key as keyof Reservation])
    )
      throw new Error("CAP reservation mismatch")
  }
  enter(call: Reservation): void {
    this.assertReserved(call)
    if (this.#executorEntered) throw new Error("Reserved native executor was already entered")
    this.#executorEntered = true
  }
  assertConsumed(call: Reservation): void {
    this.live()
    const owner = this.#reservation
    if (
      this.#phase !== "consumed" ||
      !owner ||
      Object.keys(owner).some((key) => owner[key as keyof Reservation] !== call[key as keyof Reservation])
    )
      throw new Error("Consumed call identity mismatch")
  }
  consume(call: Reservation): void {
    this.assertReserved(call)
    this.#phase = "consumed"
  }
  receipt(result: unknown): void {
    this.live()
    const output = (result as { output?: { sessionID?: unknown; status?: unknown } } | null)?.output
    if (
      this.#phase !== "consumed" ||
      this.#result ||
      typeof output?.sessionID !== "string" ||
      !output.sessionID ||
      output.status !== "completed"
    ) {
      throw new Error("Native completion receipt mismatch")
    }
    this.#result = Object.freeze({ childID: output.sessionID, status: "completed" })
  }
  close(): void {
    this.#phase = "closed"
  }
  teardown(): void {
    this.close()
    this.#revoked = true
  }
}
