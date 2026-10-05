import { afterAll, afterEach, beforeAll, expect, spyOn, test } from "bun:test"
import * as childProcess from "node:child_process"
import { createHash } from "node:crypto"
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { reviewerGitArguments, reviewerGitInput, reviewerGitTool } from "../src/reviewer-git.ts"

// Only the buffer-returning execFileSync overload is used by this tool.
const bufferResult = (bytes: Buffer) =>
  ((_file: string, args: readonly string[]) =>
    args.includes("config") ? Buffer.alloc(0) : bytes) as unknown as typeof childProcess.execFileSync
const invocation = { agent: "reviewer" } as any
const run = (directory: string | undefined, input: unknown, agent = "reviewer") =>
  Effect.runPromise(reviewerGitTool(directory).execute(input as any, { ...invocation, agent }))

test("strict host input schema and direct execution reject extra fields and malformed shapes", async () => {
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(bufferResult(Buffer.from("unexpected")))
  try {
    for (const input of [
      null,
      [],
      "git diff HEAD",
      {},
      { operation: "diff" },
      { operation: "diff", paths: [] },
      { operation: "diff", paths: "README.md" },
      { operation: "show", paths: ["README.md"] },
      { operation: "grep", paths: ["README.md"], pattern: "" },
      { operation: "grep", paths: ["README.md"], pattern: "\0" },
      { operation: "diff", paths: Array(101).fill("README.md") },
      ...["command", "args", "options", "revision", "workdir", "env", "background", "timeout", "executable"].map(
        (field) => ({ operation: "status", [field]: field === "background" ? true : "malicious" }),
      ),
    ]) {
      const result = await reviewerGitInput["~standard"].validate(input)
      expect(result.issues).toBeDefined()
      expect(() => reviewerGitArguments(input)).toThrow()
      await expect(run("/unused", input)).rejects.toThrow("inspection failed")
    }
    expect(spawn).not.toHaveBeenCalled()
    const json = reviewerGitInput["~standard"].jsonSchema.input({ target: "draft-2020-12" })
    expect(JSON.stringify(json)).toContain('"additionalProperties":false')
  } finally {
    spawn.mockRestore()
  }
})

test("mutating Git commands and unsupported options fail closed before spawning", async () => {
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(bufferResult(Buffer.from("unexpected")))
  try {
    for (const operation of [
      "add",
      "am",
      "apply",
      "bisect",
      "branch",
      "checkout",
      "cherry-pick",
      "clean",
      "clone",
      "commit",
      "config",
      "fetch",
      "gc",
      "init",
      "merge",
      "mv",
      "pull",
      "push",
      "rebase",
      "reset",
      "restore",
      "revert",
      "rm",
      "stash",
      "switch",
      "tag",
      "update-index",
      "worktree",
      "log",
      "difftool",
      "help",
      "status --porcelain",
      "diff --output=README.md",
    ]) {
      await expect(run("/unused", { operation })).rejects.toThrow()
    }
    for (const args of [
      ["--output=README.md"],
      ["--ext-diff"],
      ["--textconv"],
      ["--cached"],
      ["--no-index"],
      ["--recurse-submodules"],
      ["--open-files-in-pager"],
      ["-c", "core.fsmonitor=evil"],
      ["--git-dir=/other"],
      ["--exec-path=/other"],
    ]) {
      for (const operation of ["status", "rev-parse", "diff", "show", "grep"]) {
        const base =
          operation === "show"
            ? { path: "README.md" }
            : operation === "grep"
              ? { pattern: "text", paths: ["README.md"] }
              : operation === "diff"
                ? { paths: ["README.md"] }
                : {}
        await expect(run("/unused", { operation, ...base, args })).rejects.toThrow()
      }
    }
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    spawn.mockRestore()
  }
})

test("shell command strings, composition, redirection, substitution and backgrounding have no admission", async () => {
  for (const command of [
    "touch README.md",
    "git diff HEAD; git reset --hard",
    "git status && git add .",
    "git status || git clean -fd",
    "git diff HEAD | tee README.md",
    "git diff HEAD > README.md",
    "git status >> README.md",
    "git show HEAD:$(touch marker)",
    "git grep `touch marker`",
    "git status &",
    "git status\ngit commit -am evil",
    "GIT_EXTERNAL_DIFF=evil git diff HEAD",
    "env PATH=/evil git status",
    "my-git-wrapper status",
  ]) {
    expect(() => reviewerGitArguments(command)).toThrow()
    expect(() => reviewerGitArguments({ operation: command })).toThrow()
    await expect(run("/unused", { operation: "status", command })).rejects.toThrow()
  }
  await expect(run("/unused", { operation: "status", background: true })).rejects.toThrow()
})

test("paths cannot traverse outside the repository, access Git metadata or introduce pathspec magic", () => {
  for (const name of [
    "",
    "/tmp/file",
    "../file",
    "a/../file",
    "./file",
    "a//file",
    "a/",
    ".git/config",
    "a/.GIT/config",
    "C:\\file",
    "a\\file",
    ":(glob)*",
    "HEAD:README.md",
    "file\nname",
    "file\0name",
  ]) {
    for (const input of [
      { operation: "show", path: name },
      { operation: "diff", paths: [name] },
      { operation: "grep", pattern: "text", paths: [name] },
    ])
      expect(() => reviewerGitArguments(input)).toThrow()
  }
})

test("all five operations use fixed argv, isolated environment and execFileSync without a shell", async () => {
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(bufferResult(Buffer.from("evidence")))
  try {
    const examples = [
      [{ operation: "rev-parse" }, ["rev-parse", "--verify", "HEAD"]],
      [
        { operation: "status" },
        ["status", "--short", "--untracked-files=all", "--ignore-submodules=all", "--no-renames"],
      ],
      [
        { operation: "diff", paths: ["README.md", "-output=marker"] },
        [
          "diff",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--ignore-submodules=all",
          "HEAD",
          "--",
          "README.md",
          "-output=marker",
        ],
      ],
      [
        { operation: "show", path: "semi;$(touch marker)&.md" },
        ["show", "--no-ext-diff", "--no-textconv", "HEAD:semi;$(touch marker)&.md"],
      ],
      [
        { operation: "grep", pattern: "--open-files-in-pager; $(touch marker) `evil` > file &", paths: ["README.md"] },
        [
          "grep",
          "--no-recurse-submodules",
          "--no-textconv",
          "-n",
          "-F",
          "-e",
          "--open-files-in-pager; $(touch marker) `evil` > file &",
          "--",
          "README.md",
        ],
      ],
    ] as const
    for (const [input, args] of examples) {
      expect((await run("/trusted/worktree", input)).content).toBe("evidence")
      expect(spawn.mock.calls.at(-1)).toEqual([
        "/usr/bin/git",
        [
          "--no-pager",
          "--no-optional-locks",
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
          cwd: "/trusted/worktree",
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
      ])
    }
  } finally {
    spawn.mockRestore()
  }
})

test("the tool itself rejects all other roles and absent worktree locations", async () => {
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(bufferResult(Buffer.from("unexpected")))
  try {
    for (const agent of ["orchestrator", "planner", "explorer", "authorized_implementer", "other"])
      await expect(run("/unused", { operation: "status" }, agent)).rejects.toThrow()
    await expect(run(undefined, { operation: "status" })).rejects.toThrow()
    expect(spawn).not.toHaveBeenCalled()
  } finally {
    spawn.mockRestore()
  }
})

test("status and diff reject effective clean/process filter configuration before executing the requested operation", async () => {
  const spawn = spyOn(childProcess, "execFileSync")
  try {
    for (const kind of ["clean", "process"]) {
      for (const input of [{ operation: "status" }, { operation: "diff", paths: ["README.md"] }]) {
        spawn.mockClear()
        spawn.mockImplementation(bufferResult(Buffer.from("unexpected")))
        // This preflight must return the configured names, unlike normal mock
        // results which model a repository with no filter commands.
        spawn.mockImplementationOnce((() =>
          Buffer.from(`filter.evil.${kind}\0`)) as unknown as typeof childProcess.execFileSync)
        await expect(run("/unused", input)).rejects.toThrow()
        expect(spawn).toHaveBeenCalledTimes(1)
        expect(spawn.mock.calls[0]![1]).toEqual([
          "--no-pager",
          "--no-optional-locks",
          "--no-lazy-fetch",
          "--literal-pathspecs",
          "-c",
          "core.fsmonitor=false",
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "protocol.allow=never",
          "config",
          "--includes",
          "--null",
          "--name-only",
          "--get-regexp",
          "^filter\\..*\\.(clean|process)$",
        ])
      }
    }
  } finally {
    spawn.mockRestore()
  }
})

test("Git errors and output limits fail closed; only grep no-match exit 1 is normal evidence", async () => {
  const spawn = spyOn(childProcess, "execFileSync")
  try {
    for (const status of [1, 128, null]) {
      spawn.mockImplementation(() => {
        throw Object.assign(new Error("Git failed"), { status })
      })
      await expect(run("/unused", { operation: "status" })).rejects.toThrow()
      const input = { operation: "grep", pattern: "missing", paths: ["README.md"] }
      if (status === 1) expect((await run("/unused", input)).content).toBe("No matches found.")
      else await expect(run("/unused", input)).rejects.toThrow()
    }
    spawn.mockImplementation(() => {
      throw new Error("maxBuffer exceeded")
    })
    await expect(run("/unused", { operation: "diff", paths: ["README.md"] })).rejects.toThrow()
    spawn.mockImplementation(bufferResult(Buffer.from([0xff])))
    await expect(run("/unused", { operation: "show", path: "README.md" })).rejects.toThrow()
  } finally {
    spawn.mockRestore()
  }
})

test("unsupported --no-lazy-fetch fails at the tool's actual process invocation instead of returning evidence", async () => {
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(((_file: string, args: readonly string[]) => {
    if (args.includes("--no-lazy-fetch"))
      throw Object.assign(new Error("unknown option: --no-lazy-fetch"), { status: 129 })
    return Buffer.from("unsafe fallback without lazy-fetch protection")
  }) as unknown as typeof childProcess.execFileSync)
  try {
    await expect(run("/unused", { operation: "show", path: "README.md" })).rejects.toThrow("inspection failed")
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toBe("/usr/bin/git")
    const args = spawn.mock.calls[0]![1] as readonly string[]
    expect(args.indexOf("--no-lazy-fetch")).toBeLessThan(args.indexOf("show"))
  } finally {
    spawn.mockRestore()
  }
})

let seed: string
const roots: string[] = []
const git = (root: string, ...args: string[]) =>
  childProcess.execFileSync("/usr/bin/git", ["-C", root, ...args], { encoding: "utf8" }).trimEnd()
beforeAll(() => {
  seed = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-review-git-seed-")))
  git(seed, "init", "-q")
  git(seed, "config", "user.name", "Reviewer Test")
  git(seed, "config", "user.email", "reviewer@example.invalid")
  writeFileSync(path.join(seed, "README.md"), "")
  writeFileSync(path.join(seed, ".gitattributes"), "README.md diff=evil filter=evil\n")
  writeFileSync(path.join(seed, "semi;$(touch marker)&.md"), "literal shell syntax\n")
  git(seed, "add", ".")
  git(seed, "commit", "-qm", "empty README baseline")
})
afterAll(() => rmSync(seed, { recursive: true, force: true }))
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// Include every worktree and .git file, its bytes/mode/mtime and directory names.
// Reading may change atime; it must not change index, refs, config or other files.
function repositoryState(root: string): string {
  const digest = createHash("sha256")
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name),
        stat = lstatSync(file, { bigint: true })
      digest.update(JSON.stringify([path.relative(root, file), String(stat.mode), String(stat.mtimeNs)]))
      if (stat.isDirectory()) visit(file)
      else digest.update(readFileSync(file))
    }
  }
  visit(root)
  return digest.digest("hex")
}

test("empty HEAD README gains one sentence: actual before/after evidence is available and every operation is read-only", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-review-git-")))
  roots.push(root)
  cpSync(seed, root, { recursive: true, preserveTimestamps: true })
  git(root, "update-index", "--refresh")
  const head = git(root, "rev-parse", "HEAD")
  const sentence = "This project coordinates authorized implementation and independent review.\n"
  writeFileSync(path.join(root, "README.md"), sentence)
  writeFileSync(path.join(root, "new.txt"), "untracked evidence\n")
  const helper = path.join(root, "evil-helper")
  writeFileSync(helper, "#!/bin/sh\ntouch marker\n", { mode: 0o755 })
  for (const key of ["core.fsmonitor", "core.pager", "diff.evil.command", "diff.evil.textconv", "pager.grep"])
    git(root, "config", key, helper)
  git(root, "config", "alias.diff", "!touch marker")
  const before = repositoryState(root)
  const inspect = async (input: unknown) => {
    const result = await run(root, input)
    expect(repositoryState(root)).toBe(before)
    return result.content
  }
  expect(await inspect({ operation: "rev-parse" })).toBe(`${head}\n`)
  const status = await inspect({ operation: "status" })
  expect(status).toContain(" M README.md")
  expect(status).toContain("?? new.txt")
  expect(await inspect({ operation: "show", path: "README.md" })).toBe("(empty Git output)")
  const diff = await inspect({ operation: "diff", paths: ["README.md"] })
  expect(diff).toContain("@@ -0,0 +1 @@")
  expect(diff).toContain(`+${sentence.trimEnd()}`)
  expect(
    typeof diff === "string" && diff.split("\n").some((line) => line.startsWith("-") && !line.startsWith("---")),
  ).toBe(false)
  expect(await inspect({ operation: "grep", pattern: "coordinates", paths: ["README.md"] })).toBe(
    `README.md:1:${sentence}`,
  )
  expect(await inspect({ operation: "grep", pattern: "not present", paths: ["README.md"] })).toBe("No matches found.")
  expect(await inspect({ operation: "show", path: "semi;$(touch marker)&.md" })).toBe("literal shell syntax\n")
  await expect(run(root, { operation: "show", path: "missing.md" })).rejects.toThrow()
  expect(repositoryState(root)).toBe(before)
  for (const kind of ["clean", "process"]) {
    git(root, "config", `filter.evil.${kind}`, helper)
    const configured = repositoryState(root)
    for (const input of [{ operation: "status" }, { operation: "diff", paths: ["README.md"] }]) {
      await expect(run(root, input)).rejects.toThrow()
      expect(repositoryState(root)).toBe(configured)
    }
    git(root, "config", "--unset", `filter.evil.${kind}`)
  }
})

test("missing promisor blob and protocol.ext.allow cannot execute a hostile helper or mutate state through the tool", async () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "opencode-review-promisor-")))
  roots.push(root)
  cpSync(seed, root, { recursive: true, preserveTimestamps: true })
  const blob = git(root, "rev-parse", "HEAD:README.md")
  const helper = path.join(root, "hostile-promisor")
  const marker = path.join(root, "promisor-helper-ran")
  writeFileSync(helper, "#!/bin/sh\n: > promisor-helper-ran\nexit 1\n", { mode: 0o755 })
  git(root, "config", "remote.hostile.url", `ext::${helper}`)
  git(root, "config", "remote.hostile.promisor", "true")
  git(root, "config", "extensions.partialClone", "hostile")
  git(root, "config", "protocol.ext.allow", "always")
  unlinkSync(path.join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)))
  const before = repositoryState(root)

  // Exercise the real /usr/bin/git boundary while making the environment-only
  // protection ineffective, as on Git versions that ignore that variable.
  const execute = childProcess.execFileSync
  const spawn = spyOn(childProcess, "execFileSync").mockImplementation(((
    file: string,
    args: readonly string[],
    options: childProcess.ExecFileSyncOptions,
  ) => {
    const env = { ...options.env }
    delete env.GIT_NO_LAZY_FETCH
    return execute(file, args, { ...options, env })
  }) as typeof childProcess.execFileSync)
  try {
    await expect(run(root, { operation: "show", path: "README.md" })).rejects.toThrow("inspection failed")
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn.mock.calls[0]![0]).toBe("/usr/bin/git")
    expect(spawn.mock.calls[0]![1]).toContain("--no-lazy-fetch")
    expect(existsSync(marker)).toBe(false)
    expect(repositoryState(root)).toBe(before)
  } finally {
    spawn.mockRestore()
  }

  // Control: the same fixture is capable of invoking the helper when both
  // suppression mechanisms are absent, despite the general protocol deny.
  expect(() =>
    execute("/usr/bin/git", ["--no-pager", "-c", "protocol.allow=never", "show", "HEAD:README.md"], {
      cwd: root,
      env: { PATH: "/usr/bin:/bin", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    }),
  ).toThrow()
  expect(existsSync(marker)).toBe(true)
})
