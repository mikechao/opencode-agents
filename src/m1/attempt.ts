import type { Context } from "@opencode/plugin/tui/context"
import type { SessionMessageInfo } from "@opencode/client"
import { assertLive, consumeIntent, grantIntent, type Generation } from "../cap.ts"
import { candidateMessage, makeCandidate, parseProposal, type IntentCandidate } from "../proposal.ts"
import { observeGit, requireFresh, requireInScope } from "../git.ts"

export function candidateFits(message: string, terminalWidth: number, terminalHeight: number): boolean {
  const width = Math.min(116, terminalWidth - 2) - 4
  const height = Math.floor(terminalHeight * 0.75) - 6
  if (width < 30 || height < 8) return false
  const lines = message.split("\n").reduce((total, line) => {
    const columns = [...line].reduce((size, character) => size + (character.charCodeAt(0) > 127 ? 2 : 1), 0)
    return total + Math.max(1, Math.ceil(columns / width))
  }, 0)
  return lines <= height
}

const noDirectCommit = [
  { action: "shell", resource: "git commit", effect: "deny" as const },
  { action: "shell", resource: "git commit *", effect: "deny" as const },
]

function plannerPrompt(request: string): string {
  return [
    "You are the Planner for one Milestone 1 implementation attempt.",
    "Read and reason about the request. Do not edit files or intentionally perform Git commit or history effects.",
    "Return exactly one JSON object with only these fields: intent (nonempty human-readable text), plan (nonempty human-readable text), files (an array of exact repository-relative file paths).",
    "List every file the Implementer may add, modify, or delete. Do not use directories, globs, wildcard or implicit scope.",
    "Do not include a Markdown code fence or commentary around the JSON.",
    "",
    `User request:\n${request}`,
  ].join("\n")
}

export function implementerPrompt(candidate: IntentCandidate, milestone: "Milestone 1" | "Milestone 2" = "Milestone 1"): string {
  return [
    `You are the Implementer for one authorized ${milestone} attempt.`,
    "Implement the frozen proposal below. Modify only its exact authorized repository paths; do not add, edit, or delete any other repository path.",
    "Do not intentionally perform Git commit or other history effects reserved for the trusted CAP path.",
    "Do not intentionally manipulate Git configuration, index metadata, ignore rules, repository metadata, or other shell-accessible state to conceal changes or evade ordinary M1 scope observation.",
    "You may read, edit, test, and use ordinary development shell commands. Do not alter scope or seek another approval.",
    "The worktree was clean when the intent was authorized. Leave HEAD unchanged.",
    `Canonical worktree root: ${candidate.root}`,
    `Bound HEAD: ${candidate.head}`,
    "Frozen proposal:",
    JSON.stringify(candidate.proposal),
  ].join("\n")
}

async function after<T>(generation: Generation, operation: Promise<T>): Promise<T> {
  const result = await operation
  assertLive(generation)
  return result
}

async function collectMessages(context: Context, sessionID: string, generation: Generation): Promise<SessionMessageInfo[]> {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined
  do {
    const page = await after(generation, context.client.message.list({ sessionID, limit: 200, ...(cursor ? { cursor } : { order: "asc" }) }))
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)
  return messages
}

async function completedText(
  context: Context,
  sessionID: string,
  promptID: string,
  generation: Generation,
): Promise<string> {
  await after(generation, context.client.session.wait({ sessionID }))
  const session = await after(generation, context.client.session.get({ sessionID }))
  if (session.id !== sessionID || session.agent !== "general" || session.outcome !== "succeeded") {
    throw new Error("Role session did not complete successfully with the expected agent")
  }
  const messages = await collectMessages(context, sessionID, generation)
  const inputs = messages.filter((message) => message.type === "user")
  if (inputs.length !== 1 || inputs[0]?.id !== promptID) throw new Error("Role result is not bound to its sole prompt")
  if (messages.some((message) => message.type === "synthetic" || message.type === "shell")) {
    throw new Error("Role session received an unexpected additional input")
  }
  const finals = messages.filter((message) => message.type === "assistant" && message.finish === "stop")
  if (finals.length !== 1 || finals[0]?.type !== "assistant" || finals[0].agent !== "general" || finals[0].error) {
    throw new Error("Role final response is missing or ambiguous")
  }
  const content = finals[0].content.filter((part) => part.type === "text").map((part) => part.text).join("").trim()
  if (!content) throw new Error("Role final response is empty")
  return content
}

export async function runM1(context: Context, generation: Generation, rawRequest: string): Promise<string> {
  assertLive(generation)
  const request = rawRequest.trim()
  if (!request) throw new Error("Usage: /m1 <implementation request>")
  if (generation.busy) throw new Error("An M1 attempt is already running in this TUI generation")
  generation.busy = true
  try {
    const selectedModel = context.ui.model.current()
    if (!selectedModel) throw new Error("M1 requires a selected TUI model")
    const model = {
      providerID: selectedModel.providerID,
      id: selectedModel.modelID,
      ...(selectedModel.variant === undefined ? {} : { variant: selectedModel.variant }),
    }
    const location = context.location ?? context.data.location.default()
    if (!location.directory) throw new Error("OpenCode did not provide a worktree directory")
    const baseline = observeGit(location.directory)
    assertLive(generation)
    if (baseline.paths.length) throw new Error("M1 requires a clean initial worktree")

    const planner = await after(generation, context.client.session.create({
      agent: "general", model, location, title: "M1 Planner", permissions: [
        { action: "edit", resource: "*", effect: "deny" },
        ...noDirectCommit,
      ],
    }))
    const plannerID = planner.id
    const plannerInput = await after(generation, context.client.session.prompt({ sessionID: plannerID, text: plannerPrompt(request) }))
    const plannerText = await completedText(context, plannerID, plannerInput.id, generation)

    const afterPlanner = observeGit(location.directory, baseline)
    assertLive(generation)
    requireFresh(afterPlanner, baseline)
    const proposal = parseProposal(plannerText, baseline.root)
    const candidate = makeCandidate(proposal, baseline.root, baseline.head)
    const message = candidateMessage(candidate)
    if (!candidateFits(message, context.renderer.terminalWidth, context.renderer.terminalHeight)) {
      throw new Error("The full authorization candidate will not fit in this terminal; enlarge it and start a new attempt")
    }

    const confirmation = context.ui.dialog.confirm({
      title: "Authorize M1 implementation",
      message,
      label: { confirm: "Authorize", cancel: "Cancel" },
    })
    assertLive(generation)
    context.ui.dialog.set({ size: "xlarge" })
    const confirmed = await after(generation, confirmation)
    if (confirmed !== true) throw new Error("M1 authorization was cancelled or dismissed")
    if (!candidateFits(message, context.renderer.terminalWidth, context.renderer.terminalHeight)) {
      throw new Error("Authorization candidate became unreadable before confirmation")
    }
    requireFresh(observeGit(location.directory, baseline), baseline)
    assertLive(generation)
    const grant = grantIntent(candidate, confirmed, generation)

    const implementer = await after(generation, context.client.session.create({
      agent: "general", model, location, title: "M1 Implementer", permissions: noDirectCommit,
    }))
    const implementerID = implementer.id
    if (implementerID === plannerID) throw new Error("Implementer did not receive a distinct fresh session")
    requireFresh(observeGit(location.directory, baseline), baseline)
    assertLive(generation)
    consumeIntent(grant, candidate, generation)
    const implementerInput = await after(generation, context.client.session.prompt({
      sessionID: implementerID, text: implementerPrompt(candidate),
    }))
    await completedText(context, implementerID, implementerInput.id, generation)

    const result = observeGit(location.directory, baseline)
    assertLive(generation)
    const paths = requireInScope(result, baseline, proposal.files)
    assertLive(generation)
    return `M1 PASS: HEAD ${baseline.head} unchanged. Resulting paths (${paths.length}): ${paths.join(", ") || "(none)"}. No review or commit was performed.`
  } finally {
    generation.busy = false
  }
}
