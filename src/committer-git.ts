import { type Effect, Schema } from "effect"
import type { Tool } from "@opencode/schema/tool"
import {
  observeGit,
  observeReviewTarget,
  requireReviewTarget,
  requireNoCommitFilters,
  prepareCommit,
  requirePreparedCommit,
  trustedGit,
  verifyCommitted,
  type PreparedCommit,
  type ReviewTarget,
} from "./git.ts"

export const committerGitName = "committer_git"
const Input = Schema.Union([
  Schema.Struct({ operation: Schema.Literals(["status", "diff", "history", "prepare", "staged", "result"]) }),
  Schema.Struct({
    operation: Schema.Literal("commit"),
    message: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8000),
      Schema.makeFilter(
        (value) =>
          !!value.split("\n")[0]?.trim() &&
          ![...value].some((character) => {
            const code = character.charCodeAt(0)
            return (code < 32 && code !== 10) || (code >= 127 && code <= 159)
          }),
        {
          message: "Expected a nonempty subject and safe message text",
        },
      ),
    ),
  }),
])
export const decodeCommitterInput = Schema.decodeUnknownSync(Input, { onExcessProperty: "error" })
const standard = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Input, { parseOptions: { onExcessProperty: "error" } }),
)
export const committerGitInput = { "~standard": standard["~standard"] }

// Activation-local tool state. The authority owner supplies the synchronous
// live gate; this object never authorizes a caller or recovers from receipts.
export class CommitGit {
  private state:
    | { kind: "unprepared" }
    | { kind: "prepared"; prepared: PreparedCommit }
    | { kind: "spent"; prepared: PreparedCommit }
    | { kind: "closed" } = { kind: "unprepared" }
  processSettled = true
  private failureReason?: string
  private postflight?: Readonly<{ head: string; subject: string; tree: string }>
  receipt?: string
  constructor(readonly target: ReviewTarget) {}
  close() {
    if (this.state.kind !== "spent") this.state = { kind: "closed" }
  }
  final(): string {
    if (!this.receipt) {
      this.close()
      this.failureReason ??= "No commit attempt was completed"
    }
    if (this.state.kind === "spent") {
      try {
        const current = verifyCommitted(this.state.prepared)
        if (this.postflight !== undefined && current.head !== this.postflight.head)
          throw new Error(
            `HEAD changed after successful commit postflight verification; history uncertain. Expected ${this.postflight.head}, observed ${current.head}`,
          )
      } catch (error) {
        this.failureReason ??= String(error).slice(0, 2000)
      }
    }
    // Failure cause and postflight facts are immutable; terminal observations
    // are freshly read even when the tool closed before a commit attempt.
    if (this.failureReason !== undefined) this.receipt = this.failure(this.failureReason)
    return this.receipt!
  }
  private failure(reason: unknown): string {
    let state = "HEAD/index/worktree unknown; history may have changed."
    try {
      const head = trustedGit(this.target.root, ["rev-parse", "--verify", "HEAD^{commit}"]).toString("utf8").trim()
      if (/^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(head))
        state = `Known HEAD: ${head}. History may have changed. Index/worktree state unknown.`
      requireNoCommitFilters(this.target.root)
      const current = observeGit(this.target.root)
      state = `Known HEAD: ${current.head}. History may have changed.\nFinal ordinary changed paths: ${JSON.stringify(current.paths)}.`
      try {
        const staged = trustedGit(this.target.root, [
          "diff-index",
          "--cached",
          "--no-renames",
          "--name-only",
          "-z",
          current.head,
          "--",
        ]).toString("base64")
        state += `\nFinal staged paths (NUL bytes, base64): ${staged || "(empty)"}.`
      } catch {
        state += "\nFinal staged state unknown."
      }
    } catch {
      /* Unknown observations remain explicit facts. */
    }
    const postflight = this.postflight
      ? `\nKnown postflight commit: ${this.postflight.head}\nKnown postflight subject: ${JSON.stringify(this.postflight.subject)}\nVerified prepared approved tree at postflight: ${this.postflight.tree}\nTerminal history uncertain; the verified postflight mutation is a historical fact, not current verified success.`
      : ""
    return `Commit did not reach a verified successful terminal state.\nReason: ${String(reason).slice(0, 2000)}${postflight}\n${state}\nThis Commit authority is terminal. No retry, amend, reset, restore, cleanup, or push was issued.`
  }
  execute(value: unknown, gate: () => void): string {
    try {
      return this.run(value, gate)
    } catch (error) {
      if (this.state.kind !== "spent") {
        this.close()
        this.failureReason ??= String(error).slice(0, 2000)
        this.receipt = this.failure(this.failureReason)
      }
      throw error
    }
  }
  private requireInspectionTarget(): void {
    if (this.state.kind === "prepared") requirePreparedCommit(this.state.prepared)
    else requireReviewTarget(observeReviewTarget(this.target.root, this.target), this.target)
  }
  private run(value: unknown, gate: () => void): string {
    const input = decodeCommitterInput(value)
    gate()
    if (input.operation === "result") return this.receipt ? this.final() : "No commit attempt has completed."
    if (this.state.kind === "spent" || this.state.kind === "closed")
      throw new Error("Commit operation authority is spent or closed")
    requireNoCommitFilters(this.target.root)
    switch (input.operation) {
      case "status": {
        const current = observeGit(this.target.root, this.target)
        this.requireInspectionTarget()
        return JSON.stringify(current)
      }
      case "history":
        return trustedGit(this.target.root, [
          "log",
          "--no-show-signature",
          "-5",
          "--format=%h %s",
          this.target.head,
        ]).toString("utf8")
      case "diff": {
        this.requireInspectionTarget()
        const diff = trustedGit(this.target.root, [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--no-color",
          this.target.head,
          "--",
          ...this.target.paths,
        ]).toString("utf8")
        this.requireInspectionTarget()
        return diff
      }
      case "prepare": {
        if (this.state.kind !== "unprepared") throw new Error("Reviewed paths were already prepared")
        // Preparation failure also retires the tool. Never restage/retry.
        this.state = { kind: "closed" }
        const prepared = prepareCommit(this.target)
        gate()
        this.state = { kind: "prepared", prepared }
        return `Complete reviewed paths prepared: ${JSON.stringify(this.target.paths)}\nPrepared tree: ${prepared.tree}`
      }
      case "staged": {
        if (this.state.kind !== "prepared") throw new Error("Prepare reviewed paths first")
        requirePreparedCommit(this.state.prepared)
        const diff = trustedGit(this.target.root, [
          "diff",
          "--cached",
          "--no-ext-diff",
          "--no-textconv",
          "--no-renames",
          "--no-color",
          this.target.head,
          "--",
          ...this.target.paths,
        ]).toString("utf8")
        requirePreparedCommit(this.state.prepared)
        return diff
      }
      case "commit": {
        if (this.state.kind !== "prepared") throw new Error("Commit requires the exact prepared approved index")
        const { prepared } = this.state
        // The last content proof and owner check precede a synchronous spend and
        // direct fixed argv spawn. No hook/await/model step can intervene here.
        requirePreparedCommit(prepared)
        gate()
        this.state = { kind: "spent", prepared }
        let failure: unknown
        this.processSettled = false
        try {
          trustedGit(this.target.root, ["commit", "--cleanup=verbatim", "-m", input.message], 120_000)
          this.processSettled = true
        } catch (error) {
          failure = error
          this.processSettled =
            !!error && typeof error === "object" && "status" in error && typeof error.status === "number"
        }
        try {
          const final = verifyCommitted(prepared) // Inspect even when commit exits nonzero.
          this.postflight = Object.freeze({ head: final.head, subject: final.subject, tree: prepared.tree })
          if (failure) throw new Error(`Commit process failed although history changed: ${String(failure)}`)
          this.receipt = `Commit succeeded.\nCommit: ${final.head}\nSubject: ${JSON.stringify(final.subject)}\nExact committed paths: ${JSON.stringify(this.target.paths)}\nFinal staged/worktree state: clean.\nOne normal commit attempt completed; no push was issued.`
        } catch (error) {
          this.failureReason ??= String(failure ?? error).slice(0, 2000)
          this.receipt = this.failure(this.failureReason)
        }
        return this.receipt
      }
    }
  }
}

export function committerGitTool(
  execute: (input: unknown, invocation: Tool.Context) => Effect.Effect<Tool.Result, Tool.Error>,
): Tool.Info<typeof committerGitInput> {
  return {
    name: committerGitName,
    options: { codemode: false },
    input: committerGitInput,
    description:
      "Admitted Committer only. status, diff (reviewed tracked diff; untracked additions appear in staged after prepare), history (five subjects), prepare (complete server-selected reviewed paths), staged (verified staged diff), commit (one normal attempt with message), result. No command text, paths, flags, environment, workdir, partial staging, amend, no-verify, or push. Preparation and commit failures are terminal.",
    execute,
  }
}
