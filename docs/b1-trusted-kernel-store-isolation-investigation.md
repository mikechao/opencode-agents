# B1 Trusted Kernel/Store Isolation Investigation

**Status:** Historical, non-normative investigation artifact preserving the earlier kernel/store isolation analysis. The current normative CAP adopts process-scoped authority, optional non-authorizing durable records, and the trusted OpenCode role/effect boundary; see `docs/coding-authority-protocol.md`.

## 1. Executive Conclusion

**The result is unresolved pending selection and verification of the model-tool execution boundary.** OpenCode’s stock local plugin/runtime setup does not satisfy B1: putting CAP code and SQLite outside the repository does not prevent local model-directed shell commands or repository-loaded plugins from reaching them.

The least-complex **plausible** OpenCode-native direction is to keep CAP in the trusted OpenCode host while routing model-facing file and shell tools into an execution environment that cannot access host CAP files. It must also prevent repository-controlled plugins from loading into the trusted server or TUI runtime. OpenCode has source-level seams for a host-configured workspace environment and, on the server side, an instance that disables project discovery. But the default workspace-provider registry is empty, and the TUI separately discovers and hot-reloads project plugins. The source does not establish a complete, ready-made boundary.

The inspected OpenCode checkout is commit `00738c5b2d2c3f0bce804b9e15107e3a02dd205d`, described as `v2.0.0-583-g00738c5b2d`; root package metadata is `2.0.17`. M0 remains PASS and is not reopened. I did not run OpenCode or modify repository files.

## 2. Current Exposure

| CAP placement | Model-controlled route |
|---|---|
| Repository-local plugin or kernel | OpenCode discovers server and TUI plugins from project configuration/directories. A model can edit those sources or configuration; server sources are watched and reloaded, and TUI local sources are hot-reloaded. Restart also rediscovers configured sources. |
| Repository-local SQLite store | File tools can address worktree paths; shell commands run with the local environment’s filesystem reach. A model can alter grant records directly. |
| External plugin or store | Absolute paths are accepted by file tools subject to ordinary `external_directory` permission checks. Local shell execution runs with the OpenCode user’s filesystem access, so it can target user-level plugin, config, cache, and data paths. |
| External code while project plugins remain enabled | Project-controlled plugin code can be loaded into the OpenCode server or TUI runtime. That code can reach host files under the same user account, even if the CAP package and database themselves are outside the repository. |

The default global paths are user-level paths: `$XDG_CONFIG_HOME/opencode`, `$XDG_DATA_HOME/opencode`, and `$XDG_CACHE_HOME/opencode`, defaulting to `~/.config/opencode`, `~/.local/share/opencode`, and `~/.cache/opencode`. These locations are outside the worktree, but the default local agent shell runs as the same user. Location alone is not isolation.

## 3. Relevant OpenCode Mechanisms

### Version and scope

The version facts above come from local Git metadata and the package manifest. The source review was limited to plugin loading, model-facing file and shell tools, permissions, state paths, subagent configuration, MCP launching, and the workspace execution seam.

### Plugin loading and code origin

**Established from source:**

- Server config discovery includes global config and project `.opencode` directories. The server plugin scanner also accepts configured relative, absolute, and `file://` paths, as well as package targets. See [ConfigDiscovery](../../opencode/packages/core/src/config/discovery.ts:23) and [ConfigPluginSource.scan](../../opencode/packages/core/src/config/plugin/source.ts:122).
- Plugin discovery looks under `plugin` and `plugins` directories and accepts JavaScript/TypeScript sources and plugin directories. See [PluginSourceDirectory.discover](../../opencode/packages/core/src/plugin/source-directory.ts:7).
- Server plugin modules are loaded as modules and activated by the server plugin supervisor. Config and local source changes trigger reactivation; project config operations are applied after global entries. See [PluginModule.load](../../opencode/packages/core/src/plugin/module.ts:80) and [PluginSupervisor](../../opencode/packages/core/src/plugin/supervisor.ts:116).
- The TUI has a separate loader. It discovers plugin directories from the global config root and project config directories, merges configured plugins, and watches local plugin sources for changes. See [localPluginDirectories](../../opencode/packages/tui/src/plugin/discovery.ts:8), [TUI reconciliation](../../opencode/packages/tui/src/plugin/context.tsx:252), and [TUI plugin import](../../opencode/packages/tui/src/plugin/context.tsx:652). The normal TUI startup derives these directories from `process.cwd()` and the global config path in [Tui.run](../../opencode/packages/tui/src/app.tsx:204).
- User-level plugin code can live outside the repository: global plugin directories are under the global config root, configured paths may be absolute, and package plugins are resolved from OpenCode’s npm cache. See [global roots](../../opencode/packages/util/src/global-roots.ts:4), [Npm cache location](../../opencode/packages/util/src/npm.ts:134), and [plugin add](../../opencode/packages/cli/src/commands/handlers/plugin/add.ts:14).

**Inference:** A model that can edit project plugin/config contents can cause repository code to load into the server or TUI runtime, including after restart. If CAP itself is repository-configured, that can replace its implementation directly. Even if CAP is installed globally, an additional project-loaded plugin runs in the same runtime and can attack external CAP files. The source does not make project-loaded plugins a sandboxed or separate-process execution class.

### Model-facing file mutation

**Established from source:** `FileAccess.resolve` resolves absolute paths and distinguishes internal from external paths; it does not confine all tool requests to the worktree. External paths go through `external_directory` permission checks. Write, edit, and patch use that path resolution and then the environment’s file operations. See [FileAccess.resolve and authorizeExternal](../../opencode/packages/core/src/file-access.ts:72), [write](../../opencode/packages/core/src/tool/plugin/write.ts:64), [edit](../../opencode/packages/core/src/tool/plugin/edit.ts:144), and [patch](../../opencode/packages/core/src/tool/plugin/patch.ts:102).

**B1 relevance:** The external-directory check is ordinary permission policy, not a filesystem sandbox. It can ask for or accept permission to use an external location. It does not establish that model tools are unable to write there.

### Shell execution

**Established from source:** The shell tool accepts a model-supplied working directory and runs the command through the location’s environment spawner. In a local location, that environment uses the local filesystem and spawner. See [shell preparation](../../opencode/packages/core/src/tool/plugin/shell.ts:116), [Shell.create](../../opencode/packages/core/src/shell.ts:254), [Environment selection](../../opencode/packages/core/src/environment/environment.ts:18), and [local driver](../../opencode/packages/core/src/environment/local.ts:17).

The shell scanner checks command text for shell permissions and identifies working-directory changes such as `cd`; it does not provide a filesystem effect sandbox for arbitrary commands or scripts. See [ShellParse.scanLegacy](../../opencode/packages/core/src/shell/parse.ts:173) and [directory argument handling](../../opencode/packages/core/src/shell/parse.ts:283).

**Inference:** With local execution, a permitted command such as a script or interpreter can write a user-level CAP file even when the shell’s working directory is the repository. Absolute-path checks in `write` alone cannot close this route.

### Tool and subagent permissions

**Established from source:** OpenCode enforces `Permission.assert` on the host, using ordered wildcard rules. The default agent permissions allow general actions and ask for external directories. See [default agent rules](../../opencode/packages/schema/src/agent.ts:38), [OpenCode agent defaults](../../opencode/packages/core/src/agent.ts:54), and [permission evaluation/assertion](../../opencode/packages/core/src/permission.ts:87).

Agent permissions are built from configured agent data and session permissions. The subagent tool resolves a selected agent and creates or continues a child session; the child uses its own selected agent configuration. The agent config schema contains permission rules but no per-call immutable tool allowlist. See [agent config](../../opencode/packages/schema/src/config/agent.ts:11), [permission projection](../../opencode/packages/core/src/permission.ts:158), and [subagent creation](../../opencode/packages/core/src/tool/plugin/subagent.ts:134).

**Inference:** These are host-enforced policy checks, but they are not a trusted CAP boundary. A child can be configured to deny particular paths or all shell use, but project-controlled configuration can change those rules, and allowing general shell execution still permits indirect filesystem writes. A trusted caller has no existing subagent argument that imposes an uneditable CAP-path restriction while retaining arbitrary local shell capability.

### Durable state and native isolation seams

**Established from source:** OpenCode’s global data path follows XDG conventions. A plugin’s `storage` API is namespaced by plugin ID but backed by OpenCode’s global KV/database; that is a logical namespace, not isolation from the local shell. See [Global paths](../../opencode/packages/util/src/global.ts:12) and [plugin storage](../../opencode/packages/core/src/plugin/host.ts:584).

OpenCode can bind a location to a `WorkspaceDriver`; file operations and shell execution use the location’s `Environment`. The default workspace-driver registry is empty. See [Environment selection](../../opencode/packages/core/src/environment/environment.ts:18) and [WorkspaceDriver registry](../../opencode/packages/core/src/workspace/driver.ts:26).

Server instances also have a `discovery: false` option that suppresses global/project config discovery and plugin-directory loading, while allowing host-supplied instance plugins. However, normal location services call `Instance.layer` without that option, and the TUI’s separate project plugin discovery remains. See [Instance options](../../opencode/packages/core/src/instance.ts:119) and [default location service construction](../../opencode/packages/core/src/location-services.ts:21).

**Unverified:** No selected WorkspaceDriver was provided, and the interface itself does not promise that a driver prevents access to host files, credentials, or services.

### MCP process behavior

**Established from source:** OpenCode’s stdio MCP client launches through the location’s `Environment`, so a local MCP process runs on the local execution plane and a workspace MCP process runs on that workspace’s plane. See [MCP client](../../opencode/packages/core/src/mcp/client.ts:117) and [stdio spawn](../../opencode/packages/core/src/mcp/stdio.ts:34).

**B1 relevance:** A same-user local MCP process is still exposed to local shell writes. MCP provides a transport and process lifecycle, not filesystem isolation by itself.

## 4. Candidate Boundaries

### Candidate A — Repository-local plugin and store

**Layout**

```text
repo/.opencode/plugins/cap.ts
repo/.cap/authority.sqlite
```

**What is trusted**

The project plugin and its store would have to be treated as trusted.

**What model tools can mutate**

Both files are in the worktree. File tools and shell can modify them. OpenCode can load or reload project plugin code.

**Why B1 holds or fails**

Fails. Repository contents are explicitly controlled by the Implementer, so neither active code nor grant state has the required protection.

**New infrastructure required**

None.

**Remaining verification**

None; source establishes the relevant exposure.

### Candidate B — External plugin and store

**Layout**

```text
$XDG_CONFIG_HOME/opencode/plugins/cap/
$XDG_DATA_HOME/opencode/cap/authority.sqlite
```

**What is trusted**

The external code and SQLite file.

**What model tools can mutate**

A local shell command runs with the same user’s access to these paths. File tools can address absolute external paths through generic permission checks.

**Why B1 holds or fails**

Fails by itself. External placement separates files from the repository, not from local model-directed shell execution or other project plugin code loaded into the OpenCode runtime.

**New infrastructure required**

None for placement.

**Remaining verification**

None; placement alone is insufficient under the stated local threat model.

### Candidate C — Same process with a trusted CAP API and existing OpenCode restrictions

**Layout**

```text
OpenCode process
  ├── CAP plugin/kernel API
  └── model tools: edit/write/patch/shell
host user data directory
```

**What is trusted**

The CAP plugin API and store.

**What model tools can mutate**

The local shell can target the same host filesystem directly, without going through the CAP API. Project plugins can also load into the same runtime.

**Why B1 holds or fails**

Fails as stated. Host permission checks do not make every shell side effect pass through the CAP API, and generic rules can be changed or approved.

**New infrastructure required**

A real execution boundary or a change to OpenCode host/tool behavior that prevents model-controlled tools and project code from reaching CAP paths.

**Remaining verification**

No experiment is needed to reject the existing local-permission-only arrangement.

### Candidate D — Minimal MCP authority service

**Layout**

```text
OpenCode trusted UI/plugin bridge
        │ narrow authority requests/results
        ▼
protected MCP authority service ── host-owned SQLite store
```

**What is trusted**

The service, its code/store, and the trusted bridge that binds the TUI result to the exact candidate.

**What model tools can mutate**

A service running as the same local user remains reachable by local shell writes. If its MCP mutation surface is exposed directly to the model, that surface must accept requests but must not accept a model-supplied approval result as authority.

**Why B1 holds or fails**

A deliberately small service can support B1 if its code and store are inaccessible to model execution and the bridge/API preserves CAP’s existing authority semantics. A separate process or MCP transport alone does not provide that protection.

**New infrastructure required**

At least a service lifecycle and narrow bridge/API. Stronger isolation may require a distinct execution security domain. It needs no workflow phases, retry/recovery state, or continuation machinery.

**Remaining verification**

The service’s actual process identity, storage access, and API exposure would need verification if this candidate is selected.

### Candidate E — Separate trusted process/service

**Layout**

```text
OpenCode host/UI
  ├── model tools in an isolated execution domain
  └── narrow trusted IPC
        └── protected CAP process and SQLite
```

**What is trusted**

The CAP process, its protected store, and the trusted IPC/UI bridge.

**What model tools can mutate**

A process running under the same local account can still have the same filesystem access as the model’s local shell. A service running in a distinct protected environment can deny those writes, provided the model cannot call an unrestricted authority API.

**Why B1 holds or fails**

A distinct security domain can prevent direct kernel/store writes. “Another process” without that access distinction does not solve B1.

**New infrastructure required**

Process/service startup, IPC, and whatever OS-backed access boundary protects its files.

**Remaining verification**

The chosen access-control mechanism and IPC caller restrictions.

### Candidate F — OpenCode host with an isolated WorkspaceDriver and controlled plugin discovery

**Layout**

```text
trusted OpenCode host
  ├── host-supplied CAP server/UI integration
  ├── SQLite under host XDG data
  └── model tools routed through an isolated WorkspaceDriver
        └── repository/worktree, file tools, shell
```

**What is trusted**

The OpenCode host, host-supplied CAP integration, store, and selected workspace provider.

**What model tools can mutate**

Only the workspace, if the selected driver actually denies host filesystem access and the TUI/server do not load repository-controlled plugins into the trusted runtime.

**Why B1 holds or fails**

This is the smallest plausible direction that keeps CAP inside the OpenCode host without relying on location alone. It is **conditional**: the default driver registry is empty, normal server instance construction does not disable project discovery, and the TUI separately discovers project plugins. The host must close those code-loading routes as well as isolate file and shell execution.

**New infrastructure required**

A host-supplied isolated WorkspaceDriver and host integration that suppresses project-controlled plugin discovery in both runtimes while loading CAP from a trusted source. The source provides relevant seams, but not this complete configuration as the normal CLI/TUI default.

**Remaining verification**

Inspect the exact provider and host wiring. If their exclusion guarantees are not explicit, perform the narrow runtime check in Section 9.

## 5. Simplest Viable Boundary

The minimum required property is: **model-controlled repository tools and repository-controlled code must have no write path to the active CAP kernel/store and no way to become the trusted CAP runtime on restart.**

For the existing local OpenCode setup, weaker options fail for concrete reasons:

- Repository-local placement exposes both code and store to model edits and shell.
- External placement leaves them reachable to same-user local shell commands and project-loaded plugin code.
- Existing permission patterns and the CAP API do not mediate arbitrary shell effects.
- A separate process or MCP transport under the same local execution identity still leaves the files writable.

The least-complex plausible boundary is Candidate F: trusted CAP code/store in the OpenCode host, with model tools in an isolated workspace execution plane and repository plugin discovery excluded from trusted server and TUI runtimes. This avoids a new authority daemon if the host can supply and verify that boundary. **OpenCode’s inspected defaults do not establish it**, so the investigation cannot yet claim a selected implementation satisfies B1.

## 6. Restart / Replacement Analysis

Under the plausible host/workspace boundary, restart safety would depend on each new OpenCode instance loading CAP from a host-supplied trusted integration, not from project plugin paths or project-controlled configuration. The host must also keep repository-controlled server and TUI plugins out of the trusted runtimes. The durable store would remain in host app data, inaccessible from the model execution environment.

Without those conditions, restart is unsafe: server config can discover and reload local plugins, and the TUI independently discovers and hot-reloads project plugins. An external path by itself does not prevent local shell modification. Source does not show a code-signing requirement or a mechanism that pins CAP code across arbitrary host/plugin configuration.

## 7. SQLite Placement

The natural host location is a dedicated CAP file under OpenCode’s user data root, for example:

```text
$XDG_DATA_HOME/opencode/cap/authority.sqlite
```

The default root is `~/.local/share/opencode`. A plugin-private OpenCode KV namespace is another storage API, but it is backed by the same host database and is not a filesystem security boundary.

The store is protected only if model tools cannot reach the host data directory. In the normal local execution environment, they can.

## 8. Required M1 Invariant

> Only trusted CAP kernel code may mutate CAP authority state. Model/agent-directed tools and repository-controlled code or configuration MUST NOT modify the active authority kernel/store or cause unreviewed code to become the trusted CAP runtime, including across restart.

This states required behavior without choosing a mechanism.

## 9. Targeted Verification Before M1

No runtime experiment was needed to reject repository-local storage, external-path placement alone, or existing generic permissions.

Before relying on Candidate F:

1. **Question:** Does the selected WorkspaceDriver keep its file operations and spawned shell outside the host CAP code/data paths?
   
   **Why source inspection of OpenCode core is insufficient:** Core delegates this behavior to the configured driver; the default registry is empty and the interface states no security guarantee.
   
   **Smallest check:** Inspect the selected provider’s `connect` and environment implementation. If it does not make the boundary explicit, run one targeted OpenCode dogfood session that attempts to write a sentinel beside the host CAP store through `write`, `patch`, shell redirection, and a script, while confirming ordinary repository edits still work.

2. **Question:** Can project-controlled server or TUI plugins load or reload in the CAP-enabled host?
   
   **Why stock-source inspection is insufficient:** The normal server path enables discovery, and the TUI computes project plugin directories separately. The actual host wiring must show those sources are excluded.
   
   **Smallest check:** Inspect the chosen host configuration. If it relies on runtime behavior rather than explicit source wiring, place a harmless sentinel plugin in the project plugin directory and verify it is not activated or hot-reloaded, including after restart.

These are conditional checks for a selected host/provider; there is no useful OpenCode runtime experiment to run before that choice exists.

## 10. Complexity Check

- **Can a minimal MCP authority service satisfy B1 without workflow machinery?** Yes, if it runs in a protected execution domain, exposes only narrow CAP operations, and has a trusted UI bridge. It needs no workflow phases or recovery state.
- **Is MCP required, merely viable, or unnecessary?** **Merely viable.** It is an optional service/transport choice, not the missing isolation property.
- **Is another separate daemon/process required?** No, if the OpenCode host can isolate model execution and exclude repository plugin code. A same-user process alone is insufficient.
- **Does B1 require another OS user?** No in principle; an isolated workspace or equivalent filesystem boundary could provide the needed distinction. Under the current local same-user shell, some effective access boundary is required.
- **Does B1 require persisted workflow state beyond CAP’s durable grants?** No.
- **Does B1 require cryptographic code signing?** No. It requires a trusted loading path that repository-controlled tools/configuration cannot replace.
- **Does B1 require per-edit CAP mediation?** No. It requires protecting the kernel/store paths; CAP can continue checking the complete resulting repository delta at its existing gate.

## 11. Recommendation for the Next Architecture Decision

Decide whether M1 will require a host-controlled execution boundary that isolates model tools from host CAP files and excludes repository-controlled plugins from the trusted server and TUI runtimes. That boundary is the prerequisite to choosing between an in-host kernel/store and an optional narrow service.
