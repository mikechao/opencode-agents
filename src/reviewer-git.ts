import { execFileSync } from "node:child_process"
import { Effect, Schema } from "effect"
import { Tool } from "@opencode/schema/tool"

export const reviewerGitName = "reviewer_git"

const repositoryPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1000),
  Schema.makeFilter(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      !value.includes(":") &&
      ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
      !value.split("/").some((part) => !part || [".", "..", ".git"].includes(part.toLowerCase())),
    { message: "Expected a literal repository-relative path outside Git metadata" },
  ),
)
const paths = Schema.Array(repositoryPath).check(Schema.isMinLength(1), Schema.isMaxLength(100))
const Input = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("rev-parse") }),
  Schema.Struct({ operation: Schema.Literal("status") }),
  Schema.Struct({ operation: Schema.Literal("diff"), paths }),
  Schema.Struct({ operation: Schema.Literal("show"), path: repositoryPath }),
  Schema.Struct({
    operation: Schema.Literal("grep"),
    pattern: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(2000),
      Schema.makeFilter((value) => !value.includes("\0"), { message: "Git patterns cannot contain NUL" }),
    ),
    paths,
  }),
])
const standard = Schema.toStandardJSONSchemaV1(
  Schema.toStandardSchemaV1(Input, { parseOptions: { onExcessProperty: "error" } }),
)
// OpenCode 2.0.22 recognizes Standard Schema only on objects. Detach the
// interface from the Effect schema function so validation uses our strict
// plugin-owned decoder instead of decoding a foreign AST in the host runtime.
export const reviewerGitInput = { "~standard": standard["~standard"] }
const decode = Schema.decodeUnknownSync(Input, { onExcessProperty: "error" })

export function reviewerGitArguments(value: unknown): readonly string[] {
  const input = decode(value)
  switch (input.operation) {
    case "rev-parse":
      return ["rev-parse", "--verify", "HEAD"]
    case "status":
      return ["status", "--short", "--untracked-files=all", "--ignore-submodules=all", "--no-renames"]
    case "diff":
      return [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--no-color",
        "--ignore-submodules=all",
        "HEAD",
        "--",
        ...input.paths,
      ]
    case "show":
      return ["show", "--no-ext-diff", "--no-textconv", `HEAD:${input.path}`]
    case "grep":
      return ["grep", "--no-recurse-submodules", "--no-textconv", "-n", "-F", "-e", input.pattern, "--", ...input.paths]
  }
}

export function reviewerGitTool(directory: string | undefined): Tool.Info<typeof reviewerGitInput> {
  return {
    name: reviewerGitName,
    options: { codemode: false },
    input: reviewerGitInput,
    description:
      "Read-only Reviewer Git evidence in the active worktree. Operations: rev-parse (HEAD), status (all ordinary changed/untracked paths), diff (HEAD to tracked worktree paths), show (HEAD content of one path), grep (fixed-string search of tracked worktree paths). Status/diff fail closed when repository clean/process filters are configured. Paths are literal repository-relative files or directories. Untracked content must be read with read. No command strings, flags, revisions, environment, workdir, or background execution are accepted. Observations cannot authorize mutation or replace trusted target verification.",
    execute: (input, invocation) =>
      Effect.try({
        try: () => {
          if (invocation.agent !== "reviewer") throw new Error("Git inspection is Reviewer-only")
          if (!directory) throw new Error("Git inspection requires an active worktree directory")
          const args = reviewerGitArguments(input)
          let bytes: Buffer
          try {
            // Git can run clean/process filters even without external diff or
            // textconv. Inspect effective config (including includes) afresh and
            // reject that unsupported repository feature before status or diff.
            if (args[0] === "status" || args[0] === "diff") {
              let filters: Buffer
              try {
                filters = readGit(directory, [
                  "config",
                  "--includes",
                  "--null",
                  "--name-only",
                  "--get-regexp",
                  "^filter\\..*\\.(clean|process)$",
                ])
              } catch (error) {
                if (!error || typeof error !== "object" || !("status" in error) || error.status !== 1) throw error
                filters = Buffer.alloc(0)
              }
              if (filters.length)
                throw new Error("Status/diff inspection does not support configured clean/process filters")
            }
            bytes = readGit(directory, args)
          } catch (error) {
            if (args[0] !== "grep" || !error || typeof error !== "object" || !("status" in error) || error.status !== 1)
              throw error
            return { content: "No matches found." }
          }
          const output = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
          return { content: output || "(empty Git output)" }
        },
        catch: (error) => new Tool.Error({ message: "Reviewer Git inspection failed", error }),
      }),
  }
}

function readGit(directory: string, args: readonly string[]): Buffer {
  // A fixed system executable and an isolated environment exclude PATH
  // wrappers, shell aliases, inherited Git overrides and loader injection.
  // No shell, pager, hooks, fsmonitor, diff/textconv helpers, submodule
  // recursion, optional index writes, replacement objects or lazy fetch.
  return execFileSync(
    "/usr/bin/git",
    [
      "--no-pager",
      "--no-optional-locks",
      // Older Git must reject this option, rather than ignore the environment
      // variable below and allow a missing promisor object to trigger fetching.
      "--no-lazy-fetch",
      "--literal-pathspecs",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "protocol.allow=never",
      ...args,
    ],
    {
      cwd: directory,
      shell: false,
      env: {
        PATH: "/usr/bin:/bin",
        LC_ALL: "C",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_NO_LAZY_FETCH: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      timeout: 10_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
}
