# CAP Kernel Hosting Investigation

## 1. Executive Conclusion

Pre-M1 CAP hosting validation is complete: both local TUI-to-worktree/Git hosting and plugin-generation revocation passed. **Candidate A is accepted for local V1:** the active installed `opencode-agents` TUI plugin generation in the local OpenCode TUI process is the CAP runtime. It owns candidate/result binding, process-local authority, trusted local Git observations, and eventually the bounded CAP effect.

The supported V1 topology is ordinary local OpenCode. Experiment 1 established that the TUI-provided location is locally addressable, that direct local Git and OpenCode identify the same worktree root, and that branch and status observations agree. The TUI plugin API does not expose a reliable general local-versus-remote or same-machine identity. These checks validate the supported configuration but are not general topology attestation. Remote/multi-host operation is out of scope; the lack of attestation is not a V1 blocker and requires no new transport or proof mechanism.

Usable authority lives only in ordinary activation-private state for the active TUI plugin generation. OpenCode `storage.memory()` survives plugin hot reload and `storage.store()` survives TUI restarts; neither may hold CAP authority. Experiment 2 confirmed that cleanup synchronously revokes an old generation before replacement activation and that its late affirmative dialog result is blocked. Server/session work may outlive the TUI generation, but it carries no CAP authority. No server-side or MCP-owned authority is required.

## 2. Current Required Kernel Responsibilities

The normative documents establish the following responsibilities; this investigation does not reopen B1, I1, I2, or M0:

- Construct, canonicalize, freeze, and retain each authorization candidate from trusted facts and validated request data.
- Present that candidate through the trusted `ui.dialog.confirm` call and bind only that invocation's affirmative result to its frozen candidate.
- Recheck candidate integrity and applicable repository, review, validation, and target freshness.
- Create and consume distinct, process-local, single-use intent and reviewed-target commit capabilities.
- Derive repository facts directly, including canonical repository/worktree identity, clean start, trusted `HEAD`, complete target delta, prepared paths, and post-effect outcome.
- Coordinate fresh Planner, Implementer, and Reviewer work while treating model output and agent prose as untrusted inputs or artifacts.
- Keep the final bounded commit effect unavailable to Planner, Implementer, and Reviewer and perform it only through the separately authorized trusted path.
- Lose all usable authority when the trusted CAP runtime ends, reloads, crashes, or restarts. Durable records remain optional and non-authorizing.

## 3. OpenCode Runtime Findings

The local `../opencode` source inspected for this report is at commit `00738c5b2d`. Source facts below describe that checkout. Architectural conclusions are marked as inference.

### TUI plugins and lifecycle

**Source facts.** TUI plugins define an asynchronous `setup(context)` and may return a cleanup callback (`packages/plugin/src/tui/plugin.ts`, `Definition`; `packages/plugin/src/tui/context.ts`, `Context`). `packages/tui/src/plugin/context.tsx` resolves the TUI entrypoint with `Host.resolve(target).tui`, imports it with `Host.load()`, calls `setup`, and records cleanups. Deactivation runs those cleanups; source/config generation changes deactivate and replace changed plugins. TUI provider disposal waits for its serialized lifecycle work, deactivates active plugins, clears registrations, and disposes source loaders (`PluginProvider`, `activate`, `deactivate`, `reconcile`, `dispose`).

`Context` does not expose the activation generation's lexical variables to a later generation. However, it explicitly offers two host stores with different lifetimes: `storage.memory()` shares a live in-memory store across plugin hot reloads until the TUI exits, while `storage.store()` is durable across hot reloads and TUI restarts (`packages/plugin/src/tui/context.ts`, `Storage`; `packages/tui/src/context/storage.tsx`, `createStorage`). These host stores are distinct from ordinary local variables and closure state in a plugin activation.

**Inference.** Ordinary activation-private state is the appropriate place for CAP capabilities. The host does not promise that every reference to an old closure is immediately garbage-collected: an asynchronous handler awaiting a dialog or API call can remain live after its listener is cleaned up. A generation-local active/revoked guard must therefore be set synchronously during cleanup and checked after awaits and immediately before capability use/effects. This is local lifecycle control, not durable recovery or a new cross-process protocol.

### Trusted TUI confirmation

**Source facts.** `Context.ui.dialog.confirm` accepts a title, message, and button labels and returns `Promise<boolean | undefined>` (`packages/plugin/src/tui/context.ts`, `DialogConfirmOptions`, `Dialog.confirm`). `packages/tui/src/plugin/api.tsx`, `createDialogApi`, binds the rendered Confirm callback to `true`, Cancel to `false`, and dialog close to `undefined`, with a settle-once wrapper. A plugin can freeze a local candidate, call `await context.ui.dialog.confirm(render(candidate))`, and retain the same candidate in that invocation's closure.

**Inference.** This is the shortest source-supported candidate/result binding path: candidate and result stay in the same TUI plugin activation. OpenCode does not bind a result to a CAP candidate automatically; the plugin must retain and recheck its own immutable candidate as the normative docs require. M0 remains the established UI decision boundary.

### Client, session, and agent orchestration

**Source facts.** TUI plugin `Context.client` is an `OpenCodeClient` and is populated from the TUI host client (`packages/plugin/src/tui/context.ts`, `Context`; `packages/tui/src/plugin/api.tsx`, `createPluginContext`). The client exposes session create, prompt, get, wait, and event APIs. `session.create` accepts an `agent` and optional session permission rules; `session.prompt` admits a request and returns its inbox identity; `session.wait` waits for the session loop to become idle (`packages/protocol/src/groups/session.ts`, `session.create`, `session.prompt`, `session.wait`; `packages/server/src/handlers/session.ts`, matching handlers). The resulting `Session.Info` includes a session ID and selected agent (`packages/schema/src/session.ts`, `Info`), and agent configuration has `mode: "subagent" | "primary" | "all"` (`packages/schema/src/agent.ts`, `Agent.Info`). TUI plugin `Context.data` also exposes session identity/status and message data (`packages/plugin/src/tui/context.ts`, `Data`).

The public `session.create` HTTP payload has no `parentID`. The internal session service supports parent-linked creation, and the native model-facing `subagent` tool uses it (`packages/core/src/session.ts`, `CreateInput`, `Session.create`; `packages/core/src/tool/plugin/subagent.ts`, `SubagentTool.Plugin`). The TUI plugin API can therefore create fresh, role-selected sessions and bind outputs to session/prompt IDs, but it does not expose the internal parent-child creation operation directly.

The TUI plugin can also register a keymap/slash command; the command API can pass raw slash-command arguments to its handler (`packages/plugin/src/tui/context.ts`, `KeymapCommand`, `Keymap.layer`). That gives a TUI-only integration a direct user request entrypoint. A request initiated as a model-callable tool would require a server-side request tool or other model-facing transport, which can remain request-only.

**Inference.** V1's fresh role contexts can be driven from the TUI through separate role sessions; their session ID, prompt ID, and configured agent ID provide invocation references. Fresh subagent-context semantics are settled by prior OpenCode work and are not being reopened or treated as a pre-M1 hosting blocker here. The public API's lack of a parentID remains a host API detail, not a change to the settled V1 role boundary.

### Filesystem, process, and Git access

**Source facts.** The TUI plugin SDK has no dedicated filesystem, child-process, Git-status, or Git-commit service. Its client can call the location-scoped VCS APIs, which expose info, base, status, branch-list, and diff routes but no commit effect (`packages/protocol/src/groups/vcs.ts`, `VcsGroup`; `packages/server/src/handlers/vcs.ts`, `VcsHandler`). The plugin module is loaded by dynamic `Host.load()` into the TUI plugin runtime (`packages/plugin/src/host.ts`, `load`; `packages/tui/src/plugin/context.tsx`, `resolvePlugin`). The TUI itself uses Node filesystem APIs, and OpenCode's plugin loaders support Node/Bun runtimes (`packages/tui/src/plugin/context.tsx`; `packages/plugin/src/source.node.ts`; `packages/plugin/src/source.bun.ts`).

**Inference.** An installed TUI plugin can import the runtime's ordinary `node:fs` and `node:child_process` APIs (or the supported Bun equivalent) and run Git as trusted code in the TUI process. This is available because plugin code runs in the host runtime and V1 trusts the installed integration; it is not a sandboxed or first-class Git API. In the supported ordinary local launch, the plugin checks that the OpenCode location is locally addressable and that its Git top-level corresponds to OpenCode's reported worktree root. The API cannot establish same-machine identity for an arbitrary remote connection, so remote/multi-host configurations are outside V1 rather than a case that receives new detection machinery. The VCS HTTP APIs are useful observations, but direct local Git is the simpler source for the exact clean-worktree, `HEAD`, complete delta, prepared effect, and result checks.

### Server plugins, lifecycle, and cross-runtime APIs

**Source facts.** Server plugins have `effect(context)` or Promise-style `setup(context)` APIs (`packages/plugin/src/effect/plugin.ts`, `Plugin`; `packages/plugin/src/promise/plugin.ts`, `Plugin`). Their context includes agent and tool transforms, session APIs, VCS/worktree APIs, MCP management, RPC registration, and event hooks; it has no TUI `ui.dialog` object (`packages/plugin/src/effect/plugin.ts`, `Context`; `packages/plugin/src/promise/plugin.ts`, `Context`). Server plugin activations are scoped generations. `packages/core/src/plugin.ts`, `Plugin.load` and `Plugin.activate`, creates an activation scope and closes replaced scopes. `packages/core/src/plugin/host.ts`, `PluginHost.make`, supplies host services including `Session`, `Vcs`, `Worktree`, and `Rpc`.

Server plugin code can orchestrate session APIs and register/transform tools and agents. The VCS API is observational and has no commit operation. As with TUI plugin code, server plugin modules run as installed code in the server runtime; direct filesystem/process use is technically available there for a local server. For non-local execution locations, OpenCode has an `Environment`-backed shell/process plane, but that is not a CAP-specific Git capability.

OpenCode supports server-plugin RPC registrations and events. RPC methods are served through the general `POST /api/rpc/:rpcID/:method` endpoint (`packages/protocol/src/groups/rpc.ts`, `RpcGroup`; `packages/server/src/handlers/rpc.ts`, `RpcHandler`). RPC events are published on the location-scoped event bus (`packages/core/src/rpc.ts`, `Rpc.register`, `Rpc.emit`). The TUI has the standard OpenCode client/event stream, so it can receive host events and call host APIs. The server RPC handler context supplies cancellation/error handling, not a `caller-is-TUI-plugin` identity or proof of which UI invocation occurred.

By default the CLI TUI connects to a managed background server; it can also connect to an explicitly supplied remote server (`packages/cli/src/commands/handlers/default.ts`, `default`; `packages/cli/src/services/server-connection.ts`, `resolve`). Thus a server plugin may remain alive after the TUI process or plugin activation ends. The host provides shared APIs and generic RPC/events, not a private authority channel between one TUI plugin activation and one server plugin activation.

OpenCode session execution has its own durable host lifecycle. For example, the session execution restart service can resume persisted background subagent jobs after server restart (`packages/core/src/session/execution/restart.ts`, `recoverSubagent`, `resumeSuspendedSessions`). This is OpenCode session behavior, not CAP authority: it reinforces the need for the final effect to be absent from agent tools and for a later TUI CAP activation to start with zero authority.

### MCP

**Source facts.** OpenCode configures local MCP services by command, optional working directory, and environment; it also supports remote MCP servers (`packages/schema/src/mcp.ts`, `LocalConfig`, `RemoteConfig`). The server can manage connections through configuration or MCP API routes (`packages/protocol/src/groups/mcp.ts`, `McpGroup`; `packages/core/src/config/plugin/mcp.ts`, config transform). Server plugins can add or transform MCP configuration (`packages/plugin/src/promise/mcp.ts`, `MCPDomain`). A local stdio MCP process is spawned through the location's `Environment` and acquired in the MCP connection scope; closing that scope terminates the process group (`packages/core/src/mcp/client.ts`, `connect`; `packages/core/src/mcp/stdio.ts`, `make`; `packages/core/src/mcp/index.ts`, `startServer`, `stopServer`).

OpenCode discovers MCP tools and registers them as OpenCode tools. Model tool execution calls `mcp.callTool` with the model-provided input after normal tool permission checks (`packages/core/src/tool/mcp.ts`, MCP tool registration and `execute`; `packages/core/src/mcp/index.ts`, `callTool`). Server plugin `MCPDomain` exposes list/transform/reload, not a separate trusted tool-call interface. The public MCP routes manage/list servers and expose resources; there is no host route for a TUI plugin to invoke an MCP tool outside the model-facing tool path.

OpenCode also supports MCP server-initiated elicitation. The MCP client converts it to an OpenCode form request and waits for a form answer (`packages/core/src/mcp/index.ts`, `elicitation.create`; `packages/server/src/handlers/session.ts`, form reply/cancel). That is a server-initiated form flow, not the TUI plugin's `ui.dialog.confirm` call and not a candidate/result binding mechanism for M0.

**Inference.** A configured MCP service can hold its own process-local state and run Git in its execution environment. It can be managed by OpenCode, but OpenCode's normal MCP tool invocation is model-facing. It has no built-in trusted path for receiving the exact result of a TUI plugin's `ui.dialog.confirm`. A service can add its own socket, RPC, or control interface, but that is new authority transport plumbing. If the TUI exits while the managed OpenCode server remains alive, the server-owned MCP connection and stdio process can remain live too; they are not tied to the TUI plugin lifecycle. A separately launched MCP service can outlive both unless its owner terminates it.

## 4. Candidate A — TUI Plugin Kernel

**Capabilities.** The TUI plugin API supplies the trusted confirm invocation/result and OpenCode client access. It can create fresh role sessions, send bounded inputs, wait for completion, and associate outputs with exact session and message identities. It can own candidate objects, freshness results, and single-use capabilities in activation-private memory. The same plugin process can run direct Git subprocesses against a locally addressable canonical worktree.

**Constraints.** There is no TUI SDK Git/process service; trusted plugin code uses ordinary runtime APIs for local Git observations. The plugin must not use host `storage.memory()` or durable `storage.store()` for authority. TUI `Context.client` can reach a remote server, but remote/multi-host operation is outside V1. Experiment 1's path/addressability and worktree-correspondence checks support the ordinary local topology without claiming general same-machine attestation. Experiment 2 confirms synchronous cleanup revocation and rejection of a stale continuation after a late affirmative result.

**Effect enforcement.** The plugin should not register a model-callable CAP commit tool. Its private code can run the bounded Git effect after consuming the capability. OpenCode's trusted role/session tool permissions must still deny Planner, Implementer, and Reviewer direct `git commit` through ordinary shell access. Implementing that role/effect denial remains an M1 obligation; hosting the kernel in the TUI does not remove it.

**Cost.** One host plugin generation owns the candidate, exact confirmation result, capability, observations, orchestration, and effect. Session work crosses the existing OpenCode client API, but no authority or result receipt crosses to the server.

## 5. Candidate B — Server Plugin Kernel

**Capabilities.** A server plugin can retain process-local state for its live plugin activation, access server session/agent/tool APIs, register model-facing tools, and obtain location-scoped VCS observations. It can run Git where the server process has the location's filesystem/process access. Plugin reload closes the plugin activation scope; server process restart clears its in-memory state. Its public session API has the same fresh-session and no-`parentID` limitation as the TUI client; the internal child-session operation is used by OpenCode's native subagent tool rather than exposed as a trusted plugin API.

**UI-result binding problem.** Server plugin context has no TUI UI API. It can register a generic RPC handler and the TUI client can call it, but OpenCode does not mark the call as originating from the plugin after a particular `ui.dialog.confirm` invocation. The generic route accepts ordinary RPC payloads; `RpcCallContext` has no TUI origin evidence. A server kernel that accepts an `approved: true` RPC value would be trusting a value without host proof of its origin. Adding a receipt/nonce protocol would be custom authority transport, not a built-in OpenCode bridge.

**Lifecycle fit.** The server can outlive TUI exit or TUI plugin reload, especially with OpenCode's managed-server model. That is a separate process boundary from the UI result. It could define server lifetime as the CAP runtime, but that would still not solve the trusted-result handoff and would make authority lifecycle independent of the TUI process.

**Cost.** Server hosting gives the natural repository execution plane in remote/workspace configurations, but V1 would need a new trusted result-binding channel to it. It should not be selected for the local V1 kernel.

## 6. Candidate C — CAP MCP Service

**Capabilities.** OpenCode can start/configure local stdio MCP processes, manage their connection lifecycle, and expose discovered tools to sessions. A service process can keep its own memory and run Git in its working/execution environment. OpenCode-managed connections close with their server-owned scopes.

**Trusted-vs-model-facing paths.** The normal `tools/call` route is surfaced as a model-facing OpenCode tool and carries model arguments. OpenCode's plugin MCP domain does not provide an independent server-to-service trusted call path; the public host API does not expose MCP `callTool` to TUI plugin code. MCP elicitation gives a separate form flow initiated by the service, not the exact M0 `ui.dialog.confirm` result.

**UI-result binding and lifecycle.** To deliver the TUI dialog result, the service would need a custom control channel or the TUI would need to send a value over a general RPC/MCP method. OpenCode supplies no MCP-specific caller provenance binding that makes such a value trusted. If TUI exits while its managed server remains live, the MCP process can remain live with any authority state it held. Linking its lifetime to the TUI would require additional lifecycle plumbing; persisting state to repair that gap would conflict with the current V1 contract.

**Cost.** MCP would add a process, an authority handoff, a lifecycle link, and likely separation between model-facing tools and trusted control. It does not prevent an actual unauthorized path under the current V1 trust model that keeping the kernel in the TUI cannot already prevent. Do not use MCP for the CAP kernel.

## 7. Candidate D — Minimal Split

A split can be useful for packaging, while keeping the **kernel itself in the TUI plugin**:

- The TUI entrypoint owns candidate construction/freezing, direct `ui.dialog.confirm` invocation and result binding, freshness, process-local capabilities, orchestration, Git observations, and the bounded effect.
- A server entrypoint may own role/agent configuration or, if a model-callable request tool is required, accept a request and publish a location-scoped OpenCode event. That input is only a request to start CAP; its intent/scope values remain untrusted until the TUI kernel validates them.
- The TUI plugin starts and observes role sessions through the standard OpenCode client APIs. It does not send the confirmation result or capability to the server plugin.

OpenCode supports separate `server`, `tui`, and `rpc` entrypoints for a plugin package (`packages/plugin/src/host.ts`, `Host.resolve`). Its RPC/event APIs can carry a request signal to TUI code, but RPC methods are general HTTP API calls and events are general location-scoped events. They do not create a trusted TUI-caller channel. For request transport, that distinction is acceptable: a forged or replayed request can at most ask CAP to construct a new candidate and seek a new dialog decision. The TUI still derives facts and owns all authority.

If the split instead puts Git observations/effects or capabilities in the server plugin, the TUI result must cross the boundary. OpenCode provides no existing trusted result binding for that transfer; a receipt, nonce, or private RPC protocol would be needed. That split fails the simplification test for local V1.

## 8. Comparison

| Criterion | A. TUI plugin kernel | B. Server plugin kernel | C. CAP MCP service | D. TUI kernel + optional server request/config |
| --- | --- | --- | --- | --- |
| Candidate/result binding | Direct dialog promise and frozen candidate can stay in one activation closure | No UI API; generic RPC does not identify the TUI invocation | No direct TUI confirm callback; MCP tool call is model-facing | TUI binds locally; server can send only an untrusted request |
| Process-local state | Yes; private activation state, with explicit revoke on cleanup | Yes, in server activation/process | Yes, in service process | Yes, authority remains only in TUI activation |
| Lifecycle fit | **Validated PASS:** cleanup revokes before replacement activation; a late affirmative continuation is blocked | Server may outlive TUI exit/reload | MCP process may outlive TUI exit while server remains | Strong for authority; server state is configuration/request only |
| Git access | Validated for the ordinary local launch; no general remote/multi-host support | Server VCS observations and local server process; host execution plane for remote locations | Direct subprocess in service execution plane | Same as A for the effect; server may supply roles/config only |
| Agent orchestration | OpenCode client session create/prompt/wait and event APIs | Server session API; internal subagent service available to server code | No natural host-session orchestration API | TUI drives sessions with existing client APIs |
| Bounded effect support | Direct private Git effect; role shell permissions still block bypass | Can perform effect directly but needs trusted UI result | Can perform effect, but result/control path is missing | Effect stays in TUI; no model-facing commit operation |
| New trusted transport required | None for authority | Yes, to bind TUI result to server grant | Yes, to bind TUI result to service grant | None for authority; optional request event is non-authorizing |
| New persistent state required | No | No, but server lifetime may exceed TUI lifetime | No, but service can outlive TUI; durable state would be extra | No |
| Implementation complexity | Lowest; direct Git subprocess and generation revocation need focused validation | Higher; custom cross-runtime authority handoff | Highest; separate service, tool/control split, and lifecycle coupling | Low-to-moderate if a server request/role entrypoint is actually needed |

## 9. Smallest Viable Architecture

Use an installed `opencode-agents` TUI plugin as the CAP runtime for local V1:

1. **Authority owner:** the current TUI plugin activation in the TUI process. The active generation owns immutable candidates, the pending confirmation invocation, current capabilities, consumption state, and any commit reconciliation needed while it remains live.
2. **UI binding:** the generation freezes a candidate, calls `context.ui.dialog.confirm()` directly, retains the candidate in that same invocation, and accepts only the promise result from that invocation. A synchronous revocation flag invalidates the generation on deactivation/reload before any cleanup wait.
3. **Repository facts/effects:** in the supported ordinary local setup, verify that the OpenCode location is locally addressable and that its Git top-level corresponds to OpenCode's reported worktree root, then run Git directly from trusted TUI plugin code. This path check is not general same-machine attestation. The OpenCode VCS API can help locate/status the worktree but does not perform the CAP commit.
4. **Orchestration:** use OpenCode client session APIs for fresh role sessions. Bind each prompt/completion to the session and prompt IDs plus the intended configured agent. Treat every output as untrusted until trusted code derives or verifies the repository/review/validation facts.
5. **Cross-process data:** session create/prompt/result traffic already crosses the OpenCode TUI-to-server API. It carries role inputs and artifacts, not the UI confirmation result, capability, or consumed bit. If a server plugin exposes a request tool, its event payload remains an untrusted request only.
6. **Reload/deactivation/TUI exit:** cleanup revokes local authority and makes any late result from an old generation unusable. TUI process exit removes its private memory. OpenCode's server may remain alive and an admitted session may continue; OpenCode may also resume its own durable background session work after server restart. Such work has no CAP authority and must remain unable to invoke the final commit effect. A later TUI activation starts with zero CAP authority and derives current repository reality. Server plugin in-memory state ends with that server plugin generation/process; OpenCode's session records and job lifecycle remain separate host state.
7. **Storage and MCP:** use no durable CAP state, no `storage.memory()` for capabilities, and no MCP service for the kernel. Optional audit rows may be added later only as non-authorizing records.

Planner, Implementer, and Reviewer must still be unable to call `git commit` through their normal shell permissions. The TUI plugin's private effect is not registered as an agent tool. Session/agent permission rules that block direct shell commit remain part of the settled role/effect obligation, not a reason to move authority to the server.

## 10. Completed Pre-M1 Hosting Validation

Both hosting experiments passed.

### Experiment 1 — Local TUI to worktree/Git

The committed dogfood on 2026-09-26 passed in the ordinary local OpenCode
launch. The TUI plugin obtained the target location from trusted plugin
context; the location was locally addressable; and OpenCode's reported
worktree root matched direct local Git's top-level. The plugin read the
current HEAD, branch, and status directly from Git without a model-supplied
path or authority value. Direct Git and OpenCode VCS branch/status
observations agreed.

This does not prove that a separately hosted server with a coincidentally
matching path is on the same machine. The TUI API exposes no reliable general
local-versus-remote identity. Local addressability and worktree correspondence
are checked in the supported ordinary local configuration; no general
same-machine/topology attestation is claimed or required. Remote/multi-host
operation is outside V1.

### Experiment 2 — Plugin-generation revocation

Manual dogfood on 2026-09-26 passed the stronger late-affirmative case.
Generation A activated and started a pending confirmation, then cleanup
recorded revocation. Replacement generation B activated afterward. The
original A dialog remained usable; selecting its affirmative action after B
was active resumed A's old continuation. A observed its revoked flag and
recorded that the continuation was blocked. It recorded no subsequent
would-grant or would-use event.

This validates the generation-local revocation guard. CAP authority belongs
in ordinary activation-private state for the active TUI plugin generation;
later generations start with zero authority. OpenCode storage, server state,
session state, MCP state, and diagnostic records do not carry or restore it.

## 11. M1 Boundary

The hosting decision is settled; the remaining items are M1 implementation
work, not additional pre-M1 blockers:

- Fresh subagent-context semantics are settled by prior OpenCode work and are
  not reopened here.
- Implementing CAP candidates, binding, freshness checks, process-local
  single-use capabilities, trusted Git observations, and the bounded effect
  belongs to M1.
- Preventing Planner, Implementer, and Reviewer from invoking the final
  CAP-governed commit effect through ordinary tools remains an M1
  implementation obligation.
- OpenCode server-side role/session work may outlive the TUI generation. It
  has no CAP authority; no lifecycle coupling is required, provided the
  reserved CAP commit effect remains unavailable to those roles.

## 12. Conclusion

This work does not reopen M0, B1, I1, or I2. The settled status is:

- M0: **PASS / settled**
- B1: **settled**
- I1: **settled**
- I2: **settled**
- Pre-M1 local TUI/Git hosting: **PASS**
- Pre-M1 plugin-generation revocation: **PASS**

**Pre-M1 CAP hosting validation is complete. The next step is M1.**
