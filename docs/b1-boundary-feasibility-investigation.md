# B1 Boundary Feasibility Investigation

**Status:** Non-normative investigation artifact. This report explores implementation consequences of the current B1 formulation. Its Docker-backed recommendation has not been adopted; B1's minimum required authority property remains under architecture reassessment. `docs/coding-authority-protocol.md` remains authoritative for CAP semantics.

## 1. Executive Conclusion

**UNRESOLVED PENDING ONE TARGETED DOGFOOD EXPERIMENT.** The least-complex credible direction is **A: isolate model execution in a Docker-backed OpenCode workspace**. OpenCode’s current SDK has a provider hook, and Docker Desktop is installed here. However, OpenCode ships no Docker provider, the stock CLI/TUI cannot select one, and the complete tool and plugin-loading boundary has not been exercised.

A protected CAP service is also possible in principle, but it needs a separate OS identity and a host-authenticated path for carrying the trusted UI result. MCP supplies transport, not either protection. That adds service lifecycle and binding work.

Source claims below refer to the clean upstream checkout at commit `00738c5b2d2c3f0bce804b9e15107e3a02dd205d`, `v2.0.0-583-g00738c5b2d`, package version `2.0.17`.

## 2. Previously Established Facts

This investigation relies on these earlier findings:

- Repository-local CAP code or store fails B1.
- Moving them outside the repository does not protect them from ordinary same-user local shell execution.
- Generic OpenCode permissions are not a CAP security boundary.
- A same-user process, including a stdio MCP process, does not provide isolation by itself.
- A narrow MCP authority service remains plausible if it runs behind a real protection boundary.
- Stock local OpenCode does not establish the complete B1 boundary.

Milestone 0 remains PASS and settled.

## 3. Isolating Model Execution

### Existing OpenCode support

**ESTABLISHED FROM SOURCE.** The `WorkspaceDriver` interface defines lifecycle methods and returns an environment driver containing a process spawner and optional filesystem overrides. The default registry is empty; the interface defines no security guarantee. See `../opencode/packages/core/src/workspace/driver.ts`.

The only production default is the local environment: it uses a host process spawner and host `node:fs` operations. There is no shipped container, sandbox, SSH, remote-workspace, or VM provider. Memory and fake drivers are test facilities.

**ESTABLISHED FROM SOURCE.** The Effect SDK can accept host-supplied `workspaceProviders`; the Promise SDK excludes that option. The stock CLI/TUI does not register a provider or offer a `WorkspaceDriver` selection path. The server exposes workspace APIs, but the TUI does not use them to select a provider. See `../opencode/packages/sdk/src/internal/host.ts`, `../opencode/packages/sdk/src/effect/opencode.ts`, and `../opencode/packages/core/src/workspace.ts`.

So there is **no ready-to-use implementation in the current CLI/TUI**. A custom `opencode-agents` host can instantiate one through the SDK without modifying OpenCode itself.

### Concrete candidate: Docker Desktop-backed workspace

**ESTABLISHED FROM PLATFORM.** Docker Desktop is installed at `/Applications/Docker.app`, but its daemon is not running. This machine’s macOS version is 26.6.2. Docker Desktop runs containers in a Linux VM; Docker documents that container root is not Mac root, while host directories are exposed through explicit bind mounts. Bind mounts are writable by default, so the provider must mount only the repository read/write and must not expose a Docker socket or daemon credentials. Keep external citations: [Docker Desktop permissions and isolation](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/), [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

**ESTABLISHED FROM SOURCE.** OpenCode routes `write`, `edit`, and `patch` through `Environment.files`, and routes shell execution through `Environment.spawner`. A workspace driver can therefore route both file tools and shell into a container. See sibling paths:
`../opencode/packages/core/src/tool/plugin/write.ts`,
`../opencode/packages/core/src/tool/plugin/edit.ts`,
`../opencode/packages/core/src/tool/plugin/patch.ts`,
`../opencode/packages/core/src/tool/plugin/shell.ts`.

A container provider could implement the workspace lifecycle, then use a container-side spawner for both shell and OpenCode’s default filesystem operations. The default filesystem scripts require GNU coreutils and findutils, which a Linux image can provide. Reusing the local driver’s filesystem overrides would bypass the container, since those overrides call host `node:fs`. See:
`../opencode/packages/core/src/environment/index.ts`,
`../opencode/packages/core/src/environment/local.ts`,
`../opencode/packages/core/src/environment/exec-defaults.ts`.

**INFERENCE.** With a session bound to a workspace ID, a provider that mounts only the repository should keep ordinary repo edits and shell work functional while withholding host CAP paths. This is a concrete build path, not an existing guarantee.

### Other macOS option

**ESTABLISHED FROM PLATFORM.** `/usr/bin/sandbox-exec` exists, and the local `sandbox-exec(1)` manual marks it deprecated. The local `sandbox(7)` manual says child processes inherit sandbox restrictions and describes the facility as voluntary restriction rather than a replacement for OS access controls.

**UNVERIFIED.** It may be a lower-setup way to prototype the boundary, but the installed documentation does not establish a maintained, product-ready profile for this OpenCode use. I would not treat it as the selected B1 guarantee.

## 4. Isolating CAP

**ESTABLISHED FROM PLATFORM.** On macOS, a separate OS user with CAP code and SQLite owned by that account would prevent this user’s ordinary shell from modifying those files, assuming permissions and service setup keep them private.

**INFERENCE.** The service would need a controlled launch lifecycle, storage ownership, and a local or remote interface. More importantly, CAP’s trusted UI result would need a host-authenticated path to the service. A loopback URL or same-user bearer token alone does not establish that only the trusted plugin can report a UI decision.

OpenCode has no mechanism that gives a plugin or service a stronger filesystem identity than the local model shell. A service run as the current user inherits the same file authority.

**ESTABLISHED FROM SOURCE.** A normal stdio MCP server is spawned through the location’s `Environment`; under the default local environment, it runs with the host’s same user filesystem authority. So stdio MCP does not solve B1 by itself. See `../opencode/packages/core/src/mcp/client.ts` and `../opencode/packages/core/src/mcp/stdio.ts`.

OpenCode does support remote MCP over Streamable HTTP. That lets the host connect to a separately launched service, but the service’s protection must come from elsewhere: a separate account, remote system, or other actual boundary. See source path `../opencode/packages/core/src/v1/config/mcp.ts` and `../opencode/packages/core/src/mcp/client.ts`.

A protected service would need:
- **Service implementation and SQLite:** protected by its separate OS account or remote execution boundary.
- **Credentials and endpoint:** protected from the model shell and configured so shell access cannot impersonate the trusted host.
- **UI binding:** an authenticated host/plugin channel that binds a decision to the exact candidate. MCP transport does not provide this.

**UNVERIFIED.** No current OpenCode or macOS setup found here supplies that complete service-to-TUI binding. A separate-user service can protect files, but does not by itself complete B1.

App Sandbox is not a drop-in boundary for the stock OpenCode CLI; Apple’s documented approach uses an app sandbox entitlement in signed app code. [Apple App Sandbox documentation](https://developer.apple.com/documentation/xcode/configuring-the-macos-app-sandbox).

## 5. Repository Plugin Exclusion

### Server-side discovery

**ESTABLISHED FROM SOURCE.** Server plugin sources are derived from discovered config entries and watched for changes. The core `Instance.Options.discovery: false` path disables project/global filesystem config discovery and plugin-directory loading while preserving explicitly injected plugins. See `../opencode/packages/core/src/config/plugin/source.ts` and `../opencode/packages/core/src/instance.ts`.

The embedded SDK exposes `config.project`, so a custom host can disable project config discovery and supply CAP code through its host-controlled plugin registration. This is not a switch exposed by the stock CLI. The host must also point global config at a controlled source; project exclusion alone does not make arbitrary user-global plugin files trusted. See `../opencode/packages/server/src/options.ts` and `../opencode/packages/sdk/src/effect/opencode.ts`.

### TUI-side discovery

**ESTABLISHED FROM SOURCE.** The TUI computes plugin directories from its own `process.cwd()` and global config directory, scans them, and hot-reloads local sources. It also imports TUI plugins advertised by the server and plugins in the resolved config. There is no supported TUI setting to turn off project plugin discovery or its hot reload. See `../opencode/packages/tui/src/app.tsx`, `../opencode/packages/tui/src/plugin/discovery.ts`, and `../opencode/packages/tui/src/plugin/context.tsx`.

**Explicit answer:** stock OpenCode cannot disable project-controlled TUI plugin loading through a supported option. A controlled launcher can run the TUI from a neutral directory and attach it to the CAP host, which removes the repository from the TUI’s local plugin search paths. OpenCode supports attaching the TUI to a running backend. [CLI attach documentation](https://github.com/anomalyco/opencode/blob/00738c5b2d2c3f0bce804b9e15107e3a02dd205d/packages/web/src/content/docs/cli.mdx#L99).

That is a launch arrangement, not a TUI disable switch. It requires the CAP host to disable server project config and to launch the trusted TUI from that neutral directory on every start. If the TUI is launched normally from the repository, project plugins can load and hot-reload.

## 6. Concrete Boundary Comparison

### A. macOS sandbox profile around model execution

**Boundary:** OS sandbox around the model shell and filesystem helper processes.

**Existing support:** `sandbox-exec` is present and sandbox restrictions are inherited by child processes. The local manual marks the command deprecated.

**Custom work:** A custom workspace provider must wrap shell and file operations. It cannot reuse the local driver’s host `node:fs` overrides.

**Operational burden:** Lower than Docker or a separate service, but relies on a deprecated facility and unverified profile behavior.

**Protection achieved:** Potentially keeps model execution from host CAP paths while allowing the repository.

**Dogfoodability:** Possible, but not the candidate I would select as a B1 guarantee based on current documentation.

### A. Docker Desktop-backed `WorkspaceDriver`

**Boundary:** Model shell and file operations run in a Linux container with only the repository mounted read/write. CAP remains in the host.

**Existing support:** Effect SDK exposes workspace-provider registration; Docker Desktop is installed here. The daemon is currently inactive. Docker documents the VM and explicit bind-mount boundary. [Docker Desktop permissions and isolation](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/).

**Custom work:** Implement the workspace lifecycle and container spawner, bind the session to its workspace ID, host the SDK runtime behind a local HTTP endpoint, configure project discovery off, and launch the TUI from a neutral directory.

**Operational burden:** Start Docker Desktop and maintain a container image with Git, shell tools, and the GNU utilities OpenCode expects.

**B1 guarantee:** If every model-facing file and shell operation uses the provider, the model process sees the repository and its container filesystem, not the host CAP store or integration source. The provider must not mount Docker’s control socket or other host paths.

**Remaining weakness:** No provider exists today; the CLI/TUI do not select it directly. The neutral-directory TUI launch is mandatory because the TUI has no project-plugin disable switch.

**Dogfoodability:** Strong candidate for a small end-to-end experiment.

### B. Separate-user minimal CAP service

**Boundary:** Separate OS account owns CAP code and SQLite; OpenCode calls a narrow service interface.

**Existing support:** macOS account permissions; OpenCode remote HTTP MCP transport.

**Custom work:** Service, installer and lifecycle, separate-account setup, endpoint and credential protection, and authenticated host-to-service UI decision binding.

**Operational burden:** More than A: an additional service and OS identity, plus a secure interface.

**B1 guarantee:** Separate-user ownership can prevent model shell writes to the implementation and store. Full B1 depends on securing the UI result channel; MCP does not do that.

**Remaining weakness:** Without a host-authenticated decision channel, a same-user process could attempt to impersonate the OpenCode plugin at the service boundary.

**Dogfoodability:** Feasible as a separate project, but not as small as the workspace-provider experiment.

## 7. Simplest Credible Boundary

The simplest **credible boundary to build and dogfood** is A with a Docker-backed workspace provider. It reuses the current OpenCode host for CAP and adds one explicit execution boundary for model tools. Docker Desktop is already installed here, though it must be started.

A custom host is required: stock CLI/TUI alone cannot register or select the provider. Repository plugin exclusion also requires host wiring plus a neutral-directory TUI launch. Those are real costs, but they are smaller than adding a separate CAP service, service account, credential path, and trusted UI bridge.

The weaker approaches fail because they leave same-user execution able to write CAP paths or permit repository plugins into the trusted runtime. A separate service adds infrastructure that B1 does not require if A passes. No code signing or workflow machinery is required for the Docker candidate.

## 8. Minimal MCP Assessment

- **Does normal local stdio MCP solve B1?** No. It runs through the local environment spawner under the same user identity.
- **Can a protected minimal MCP service solve B1?** Yes, in principle, if its implementation and SQLite are protected by a separate account or remote execution boundary and its UI result channel authenticates the trusted host.
- **What provides its protection?** The OS account, VM, or remote-service boundary—not MCP.
- **Does MCP materially simplify the architecture?** No. HTTP MCP makes transport available, but the service boundary, credentials, lifecycle, and trusted UI binding still need implementation.
- **Does it require workflow machinery?** No. It can remain a narrow CAP kernel/store service. It must not add workflow phases, repair/recovery, continuation, worker-attempt bookkeeping, or generalized orchestration state.

## 9. Smallest Dogfood Experiment

Use a custom SDK host with a Docker-backed workspace provider, a project-discovery-disabled server, and a TUI launched from a neutral directory and attached to the host.

1. Confirm repository edits work through OpenCode `write`, `edit`, and `patch`.
2. Confirm repository shell commands run in the container and can inspect/change the mounted checkout.
3. Have each file tool attempt to alter a host-side sentinel beside the CAP store; verify denial and unchanged contents.
4. Have shell redirection and a script attempt to alter the same sentinel; verify denial and unchanged contents.
5. Put harmless server and TUI sentinel plugins under repository plugin directories. Confirm neither loads or hot-reloads in the trusted host/TUI.
6. Restart the host and TUI using the same controlled launcher and repeat the plugin and sentinel checks.

Also inspect the running container’s mounts to confirm the repository is its only host bind mount and that no Docker socket or daemon credential is available inside it.

## 10. Architecture Consequence

- **CAP semantics:** B1 does not require changing authorization semantics.
- **Implementation boundary:** B1 requires selecting and verifying the security boundary for model execution or CAP.
- **TCB wording:** Clarify the required execution boundary, the host-controlled CAP source, and the plugin-discovery launch requirements. A Docker implementation also makes the provider and Docker runtime part of the enforcement mechanism.
- **SQLite:** Still appropriate for durable authority state, provided only trusted host CAP code can write it.
- **MCP service:** Optional, not required.

## 11. Next Decision

Decide whether to target **A: a Docker-backed `WorkspaceDriver` in a custom OpenCode host** as the B1 implementation path. Current evidence favors it on total mechanism; the experiment above is the adoption gate. No files were changed during the investigation, and OpenCode was not run.
