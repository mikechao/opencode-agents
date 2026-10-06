import type { LocationRef, SessionMessageInfo } from "@opencode/client"
import type { SessionMessage } from "@opencode/schema/session-message"
import { exactKeys } from "./cap.ts"

// Both the server's decoded schema and the TUI's encoded API expose these
// structural fields. No timestamps or model representations bind authority.
export type RootMessage = SessionMessageInfo | SessionMessage.Info
// Pinned native bootstrap; authorized payload remains exact.
export const nativeBootstrap = (prompt: string): string => `You are a subagent spawned by another session.\n${prompt}`

// OpenCode's TUI supplies reactive location info, including project metadata.
// Retain only Location.Ref's primitive identity fields, never the host proxy.
export function snapshotLocation(location: LocationRef): Readonly<LocationRef> {
  const { directory, workspaceID } = location
  return Object.freeze({ directory, ...(workspaceID === undefined ? {} : { workspaceID }) })
}
// Canonical JSON comparisons preserve every JSON field and array position, not key insertion order.
export function exactEvidence(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  )
}
export const directRootTool = (name: string): boolean => ["read", "glob", "grep"].includes(name)
export function nativeReadInstruction(message: RootMessage): boolean {
  if (message.type !== "synthetic" || !message.text.trim() || !exactKeys(message.metadata, ["instruction"]))
    return false
  const instruction = message.metadata.instruction
  return (
    exactKeys(instruction, ["paths"]) &&
    Array.isArray(instruction.paths) &&
    instruction.paths.length > 0 &&
    instruction.paths.every((item) => typeof item === "string" && item.startsWith("/")) &&
    new Set(instruction.paths).size === instruction.paths.length
  )
}
