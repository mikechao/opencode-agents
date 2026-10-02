// Diagnostic preload only: calls the real Git observer and real subprocesses.
// Run in a separate Bun process; never use these timings for the wall-time budget.
// PERF_OUTPUT must name a writable JSON output file.
import * as testAPI from "bun:test"
import * as childProcess from "node:child_process"
import * as fsModule from "node:fs"
const fs = { ...fsModule }
import path from "node:path"
import { createHash } from "node:crypto"
const { mock } = testAPI
const runTest = testAPI.test
const events: any[] = []
let current = "<setup>"
const nativeExec = childProcess.execFileSync
const nativeWrite = fs.writeFileSync
const now = () => performance.now()
const stamp = (kind: string, data: any) => events.push({ kind, test: current, end: now(), ...data })
let syncGitMs = 0
let fingerprintMs = 0
const test = (name: string, fn: any, ...options: any[]) =>
  runTest(
    name,
    async () => {
      current = name
      const start = now()
      try {
        return await fn()
      } finally {
        stamp("test", { ms: now() - start })
      }
    },
    ...options,
  )
mock.module("bun:test", () => ({ ...testAPI, test }))
const rootStarts = new Map<string, number>()
const canon = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}
mock.module("node:fs", () => ({
  ...fs,
  mkdtempSync: (...args: any[]) => {
    const start = now()
    const root = (fs.mkdtempSync as any)(...args)
    rootStarts.set(canon(root), start)
    stamp("repo", { root, ms: now() - start })
    return root
  },
  rmSync: (...args: any[]) => {
    const start = now()
    try {
      return (fs.rmSync as any)(...args)
    } finally {
      stamp("cleanup", { root: args[0], ms: now() - start })
    }
  },
}))
mock.module("node:child_process", () => ({
  ...childProcess,
  execFileSync: (cmd: string, args: string[], ...options: any[]) => {
    if (cmd !== "git") return (nativeExec as any)(cmd, args, ...options)
    const stack = new Error().stack ?? ""
    const root = canon(args[args.indexOf("-C") + 1])
    const category = stack.includes("fixture") ? "fixture" : stack.includes("observeGit") ? "observe" : "test-action"
    const start = now()
    try {
      return (nativeExec as any)(cmd, args, ...options)
    } finally {
      const elapsed = now() - start
      syncGitMs += elapsed
      stamp("git", { args, root, category, ms: elapsed })
      if (category === "fixture" && args.includes("commit"))
        stamp("fixture", { root, ms: now() - (rootStarts.get(root) ?? start) })
    }
  },
}))
function fingerprint(root: string): string {
  const hash = createHash("sha256")
  function visit(dir: string) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name)
      const stat = fs.lstatSync(full)
      hash.update(path.relative(root, full)).update("\0")
      if (stat.isSymbolicLink()) hash.update("link").update(fs.readlinkSync(full))
      else if (stat.isDirectory()) visit(full)
      else {
        hash.update(String(stat.mode))
        hash.update(fs.readFileSync(full))
      }
    }
  }
  visit(root)
  return hash.digest("hex")
}
const modulePath = path.join(process.cwd(), "src/git.ts")
const originalGit = { ...(await import(modulePath)) }
const last = new Map<string, string>()
mock.module(modulePath, () => ({
  ...originalGit,
  observeGit: (location: string, baseline: any) => {
    const root = canon(location)
    const hashStart = now()
    const state = fingerprint(root)
    fingerprintMs += now() - hashStart
    const unchanged = last.get(root) === state
    const stack = new Error().stack ?? ""
    const site = stack
      .split("\n")
      .filter((s) => !s.includes("profile.ts") && /(?:src\/|test\/|\.opencode\/)/.test(s))
      .join("\n")
    const start = now()
    let ok = false
    try {
      const value = originalGit.observeGit(location, baseline)
      ok = true
      return value
    } finally {
      last.set(root, state)
      stamp("observe", { root, unchanged, ok, ms: now() - start, site })
    }
  },
}))
const nativeSleep = Bun.sleep.bind(Bun)
Bun.sleep = (async (ms: any) => {
  const start = now()
  const gitBefore = syncGitMs
  const hashBefore = fingerprintMs
  try {
    return await nativeSleep(ms)
  } finally {
    stamp("sleep", {
      requested: ms,
      ms: now() - start,
      overlappingGitMs: syncGitMs - gitBefore,
      overlappingFingerprintMs: fingerprintMs - hashBefore,
    })
  }
}) as any
const attemptPath = path.join(process.cwd(), "src/attempt.ts")
const originalAttempt = { ...(await import(attemptPath)) }
const wrappedContexts = new WeakSet<object>()
function wrapWait(context: any) {
  if (wrappedContexts.has(context)) return
  wrappedContexts.add(context)
  const wait = context.client.session.wait
  context.client.session.wait = async (...args: any[]) => {
    const start = now()
    try {
      return await wait(...args)
    } finally {
      stamp("wait", { sessionID: args[0]?.sessionID, ms: now() - start })
    }
  }
}
mock.module(attemptPath, () => ({
  ...originalAttempt,
  publishPlan: (...args: any[]) => {
    wrapWait(args[0])
    return (originalAttempt.publishPlan as any)(...args)
  },
  authorizePublishedAttempt: (...args: any[]) => {
    wrapWait(args[0])
    return (originalAttempt.authorizePublishedAttempt as any)(...args)
  },
}))
testAPI.afterAll(() => nativeWrite(process.env.PERF_OUTPUT!, JSON.stringify(events, null, 2)))
