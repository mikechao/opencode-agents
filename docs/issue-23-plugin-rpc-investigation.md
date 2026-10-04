# Issue #23 — OpenCode 2.0.22 Plugin RPC investigation

## 1. Executive conclusion

**B — Correct seam with bounded conventions.** Plugin RPC is the appropriate public seam for the existing TUI-to-server authorization and model-settings operations. OpenCode 2.0.22 supplies location-selected activation, scoped registration, server-side codecs, and visible failures. Correct use requires portable schemas, distinct RPC IDs, explicit directory routing, application-owned authorization checks, and conservative treatment of reload and transport ambiguity.

No implementation correctness fix is established for the current directory-scoped uses. Keep the Issue #20 Standard-Schema-only fix and the two existing RPC definitions. A small compatibility-test follow-up is justified; a generic RPC abstraction or lifecycle manager is not.

Investigation baseline:

- `opencode-agents` HEAD: `ff54046cc83957e205040311b68a263f6afaf421`; initially clean.
- Read-only upstream checkout: `../opencode`, exact tag `v2.0.22`, commit `527f0b931d1f9b3ebd34e106c51b31ce5db5b075`; plugin/schema package versions both `2.0.22`.
- Upstream catalog and this repository both select Effect `4.0.0-rc.112`.
- Current online documentation read on 2026-10-04. It is supplementary, not version-pinned authority.
- No OpenCode launch, live dogfood, upgrade, implementation edits, test edits, or commits. A bounded pure-codec diagnostic used installed dependencies and a temporary independently bundled Effect Schema module; it imported no upstream host implementation and removed its temporary output.

The three transformation layers are distinct throughout this document:

1. **RPC transport/schema:** JSON serialization, host contract decoding/encoding, and client response handling.
2. **Application handler projection:** `parseSelection`, role/catalog checks, preference row construction, authorization admission, and executor input construction.
3. **Plugin KV serialization:** plugin namespace, repository preference key, and database JSON storage.

## 2. Documentation vs. OpenCode 2.0.22

Primary reference: [Effect client, Plugin RPC](https://opencode.ai/v2/docs/build/client/effect/#plugin-rpc). Its linked [Effect plugin RPC](https://opencode.ai/v2/docs/build/plugins/effect/rpc) supplies the definition and registration details missing from the client section.

The tables distinguish documented API intent from verified implementation. Unstated behavior is **not provable from documentation alone**, rather than a promise that the source violates.

| Documented behavior | 2.0.22 source behavior | Classification | Architectural significance |
| --- | --- | --- | --- |
| Shared contract; `client.rpc(definition)` infers method arguments/results. | Effect and Promise adapters select the definition ID/method; neither runs the method input schema before HTTP. | Matches 2.0.22 | Type inference is not client input validation. |
| Per-call options carry location, signal, headers; omitted location uses request defaults. | Directory query wins over directory header, then server cwd. `LocationQuery` has no workspace ID. | Matches for directory; workspace isolation not provable from documentation alone | Always send the intended directory. |
| Declared errors use their data schemas; reserved `rpc.*` errors identify framework failures. | Effect clients decode Effect error schemas; Standard/JSON data pass through. Promise clients remove the wrapper without contract decoding. | Differs from an unqualified all-schema decoding reading | Portable errors are validated by the server; Promise rejection is a plain failure object. |
| Effect events are Streams across locations, with location and prefixed type; server handles are location-fixed. | HTTP event feed is global; local subclients filter by ambient location. | Matches 2.0.22 | Consumers would need explicit location filtering. |
| Shared event connection is lazy; subscriptions end without replay/retry after source loss. | `SharedEvents.make`, Effect/Promise adapters, and the ephemeral server feed implement this. | Matches 2.0.22 | Events cannot be authority or durable work delivery. |

| Linked plugin documentation behavior | 2.0.22 source behavior | Classification | Architectural significance |
| --- | --- | --- | --- |
| Define ID, methods, schemas, errors, events with `Rpc.define`; Effect, Standard, JSON schemas are supported. | `define` returns the same object, checking reserved error names only. Core chooses Effect before Standard before JSON. | Matches supported forms; precedence not provable from documentation alone | A hybrid Effect/Standard object is still handled as Effect. |
| Effect Schema validates values. | Foreign Effect ASTs can mix parser sentinels and silently lose the optional model variant. | Differs from an unconditional cross-runtime validation expectation | Use the portable validator-only wrapper. |
| Leave input/output out when there is no value. | `Rpc.Method` requires both; core unconditionally parses/encodes them. No omitted-schema normalization exists. | Differs from 2.0.22 | Current explicit portable `Schema.Void` contracts are correct. |
| Register handlers in the plugin Effect; call after registration, including from another plugin. | Scope owns registration; newest registration for an ID wins as a whole. Local calls directly use the location registry. | Matches registration API; collision behavior not provable from documentation alone | Separate IDs prevent accidental shadowing. |
| Expected errors use the method error map and `context.error`. | Host requires its own private `DeclaredError` instance and validates its declared data. | Matches 2.0.22 | Keep using the supplied factory. |
| Events have object data; subscriptions are live and close with consumption. | Emit encodes data into ephemeral bus events; subscription ownership follows its consuming scope/iterator. | Matches 2.0.22 | No current feature needs this API. |
| Registration makes calls possible. | HTTP waits for announced activation work; success of every plugin setup and generation continuity are not guaranteed. | Lifecycle details not provable from documentation alone | Readiness is not an authorization or generation lease. |

These are the relevant differences and qualifications. Current documentation does not specify same-ID merging, checkout freshness, principal authentication, or atomic handler execution across reload.

## 3. RPC execution path

The **current TUI uses the Promise client**, even though its server plugin uses Effect. The Effect client is a separate public path and must not be substituted when reasoning about current response validation.

```text
TUI context.client.rpc(definition).method(input, { location })
  → Promise makeRpc (definition.id + method; unchanged input)
  → generated rpc.call (directory query + JSON { input })
  → HTTP API envelope decoding + LocationMiddleware
  → location service graph / plugin readiness
  → Rpc.call (latest registry entry for RPC ID)
  → parse(method.input)
  → handler(parsed, { error })
  → encode(method.output)
  → HTTP { output } envelope encoding
  → generated JSON response parsing
  → Promise makeRpc returns result.output
```

Every upstream path below is relative to the verified `../opencode` root.

| Stage | OpenCode 2.0.22 path and symbol | Operation |
| --- | --- | --- |
| TUI context | `packages/tui/src/plugin/api.tsx`, `createPluginContext`; `packages/tui/src/context/client.tsx`, `ClientProvider` | Plugin receives `host.client.api`; location getter reads the TUI's current server-synced location. |
| Promise RPC access | `packages/client/src/promise/client.ts`, `OpenCode.make`; `packages/client/src/promise/rpc.ts`, `makeRpc` | Builds a typed subclient over raw HTTP operations. Input is not validated/transformed by the method schema. |
| Promise request | `packages/client/src/promise/generated/client.ts`, `make`, `prepare`, `appendQuery`, `rpc.call` | POST `/api/rpc/:rpcID/:method`; percent-encodes path parts, recursively emits `location[directory]`, and `JSON.stringify`s `{ input }`. |
| Effect RPC access | `packages/client/src/effect/client.ts`, `OpenCode.make`; `packages/client/src/effect/rpc.ts`, `make` | Same RPC envelope, ID, method, location; optional headers and signal; Effect interruption follows the caller. No method-schema input encoding. |
| Effect request adapter | `packages/client/src/effect/generated/client.ts`, `EndpointRpcCall` | Supplies params, query, payload to `HttpApiClient` using the native API contract. |
| HTTP contract | `packages/protocol/src/groups/rpc.ts`, `RpcGroup`, `RpcInput`, `RpcOutput`; `packages/protocol/src/api.ts`, `makeApi` | Native request schema is an optional **unknown** `input`, not the plugin method schema. Applies location middleware to RPC routes. Success is optional unknown `output`. |
| Location selection | `packages/server/src/location.ts`, `requestRef`, `LocationMiddleware.layer` | Directory query/header/cwd selects `LocationServiceMap.get(ref)` before execution of the group handler. |
| Location graph | `packages/core/src/location-services.ts`, `buildLocationServiceMap`; `packages/core/src/location-service-map.ts`, `canonical`; `packages/core/src/instance.ts`, `layer` | Caches a location graph, including its RPC registry and plugin supervisor. First access builds it. |
| Activation gate | `packages/server/src/handlers/rpc.ts`, `RpcHandler`; `packages/core/src/plugin/service.ts`, `awaitActivation` | Waits for the selected graph's announced activation/update work, then obtains `Rpc.Service`. |
| Registry and input | `packages/core/src/rpc.ts`, `layer`, `call`, `parse` | Chooses newest registration by ID, checks method and handler presence, decodes input. |
| Handler | `packages/core/src/rpc.ts`, `call`, `callContext.error`, `encodeError` | Invokes under `Effect.suspend`; recognizes host-created declared errors; normalizes handler defects; races handler execution with location closure. |
| Method result | `packages/core/src/rpc.ts`, `encode` | Effect schema encodes; Standard Schema validates forward; JSON Schema decodes using a reconstructed codec. |
| HTTP result/error | `packages/server/src/handlers/rpc.ts`, `RpcHandler`; `packages/protocol/src/errors.ts`, `RpcError`, `RpcInternalError` | Undefined output becomes `{}`; other output becomes `{ output }`. Maps normal RPC failures to declared HTTP errors. |
| Promise response | `packages/client/src/promise/generated/client.ts`, `request`, `json`, `declared`; `packages/client/src/promise/rpc.ts`, `makeRpc` | Parses JSON, returns `output`, strips the RPC error wrapper. No method result/error schema validation. |
| Effect response | `packages/client/src/rpc-runtime.ts`, `read`, `readError`; `packages/client/src/effect/rpc.ts`, `make` | After native response-envelope decoding, decodes method results only for Effect schemas. Standard/JSON results pass through. Removes the generic RPC wrapper. |
| Server-local subclient | `packages/core/src/plugin/host.ts`, `PluginHost.make`; `packages/core/src/rpc.ts`, `client` | `context.rpc(definition)` directly calls this activation's registry, without HTTP, request defaults, or the HTTP readiness gate. |

The selected Effect dependency's `src/unstable/httpapi/HttpApiClient.ts` request encoders and response decoders, and `HttpApiBuilder.ts` `handlerToRoute`/`decodePayload`, implement the native envelope encoding/decoding. They do not receive plugin method schemas. HTTP JSON behavior is another layer beyond the method codec.

## 4. Schema findings

### Accepted forms and internal representation

`packages/schema/src/tool.ts` defines `Tool.ValueSchema<A = unknown>` as `Schema.Codec<A, any> | StandardSchemaV1<any, A> | JsonSchema.JsonSchema`. `packages/schema/src/rpc.ts` uses those values directly in required `Method.input`, `Method.output`, and optional `errors`. `Rpc.define` neither compiles nor serializes the definition. Schemas remain runtime objects in the plugin's registered definition; the client definition is not sent to the server.

Server `parse` selects, in this order:

1. `Schema.isSchema(schema)` → host `Schema.decodeUnknownEffect(schema)(value)`.
2. `"~standard" in schema` → invoke `schema["~standard"].validate(value)`; await a native Promise if returned; fail on `issues`, otherwise use `result.value`.
3. JSON Schema → convert draft 2020-12 through `JsonSchema.fromSchemaDraft2020_12` and `SchemaRepresentation.fromJsonSchemaDocument`, construct an Effect codec, cache by schema object in a WeakMap, and decode.

Server `encode` uses `Schema.encodeUnknownEffect` for Effect schemas, otherwise the same forward `parse`. Standard Schema transformations are therefore **forward validators/parsers**, not bidirectional Effect codecs. Output/error/event values supplied to a Standard Schema must be appropriate inputs to its validator. The current model contracts use JSON-compatible shapes without value-changing transformations, so this asymmetry is harmless.

Client and server codecs are **not symmetrical**:

| Boundary | Effect contract | Standard-only contract | JSON Schema contract |
| --- | --- | --- | --- |
| HTTP client method input | Passed unchanged as the schema's encoded input type | Passed unchanged | Passed unchanged |
| Host input | Decode | Validate forward | Reconstruct codec and decode |
| Host output | Encode | Validate forward | Decode |
| Effect client method output | Decode | Trust server result; no validator call | Trust server result; no validator call |
| Promise/TUI method output | Return parsed JSON `output`; no contract codec | Same | Same |
| Local Effect subclient output | Decode; decoding failure becomes a defect | Pass through | Pass through |

This is why “schemas validate on both sides” is too broad if it means client plus server. The current portable contract validates **host input and host output**. Clients do not revalidate it.

### Nested values and object keys

For the current portable contracts, the validator closes over the runtime owning the Effect schema. `Model.Ref` is a Struct of branded strings `providerID`, `id`, and OpenCode's custom `optional(VariantID)`. See `packages/schema/src/model.ts`, `Ref`, and `packages/schema/src/schema.ts`, `optional`.

| Value/case | Supported behavior at the current model RPC boundary |
| --- | --- |
| Nested `variant: "high"` present | Preserved through input validation, handler selection parsing, output rows, and JSON transport. |
| Nested variant omitted | Accepted; remains omitted. Application displays native model default when appropriate. |
| Explicit `variant: undefined` | HTTP JSON serialization omits this object property before validation. Direct owning-runtime validation rejects a present undefined encoded variant: the custom optional has an optional string key on its encoded side. Effect encoding of the decoded optional can omit undefined. These are different operations. |
| Unknown object key | Effect Struct default decoding strips excess keys, including nested keys. The Standard wrapper uses that default. It does not reject every original wire key. |
| Invalid nested variant, e.g. `3` | Validator reports nested `model.variant` issue; handler does not run; caller receives `rpc.invalid_input`. Empty/whitespace strings pass branded-string schema checks but are rejected by application `parseSelection`. |
| Nested object | Struct recursively parses named fields and validates their types; it does not flatten the object. |
| Array | Array schema validates each element. `list` validates an array of role rows, including nested models. An object supplied where Array is required, or an invalid element, fails. Undefined array entries become JSON null, not omitted entries. |
| Union | The owning parser selects a matching member; `Preference` validates `native`, `override`, or `invalid` rows and their branch fields. Nonmatching values fail; Struct members strip their excess fields. |

These are properties of the selected schemas, not universal promises of Standard Schema: another validator can preserve keys, reject them, or transform values differently. A raw foreign Effect AST has no reliable general cross-runtime shape-preservation guarantee here.

Authorization's `{ type: "object" }` follows the JSON Schema path. The JSON importer represents unrestricted additional properties with a string-key record of Unknown, preserving the claim's named keys and nested JSON values rather than projecting a fixed Struct. It rejects arrays, primitives, and null. The string output is validated. Detailed claim validity and exactness remain application responsibilities.

### Why Issue #20 lost the variant

`Schema.toStandardSchemaV1()` in Effect rc.112 returns **the original schema augmented with `~standard`**, typed as `StandardSchemaV1 & S`. Its implementation returns the existing object or `Object.assign(self, { "~standard": ... })`. It retains its Effect schema marker, AST, and methods. The marker is the string `"~effect/Schema/Schema"`; `Schema.isSchema` checks that property/value rather than ownership of a runtime.

Therefore the exact problematic source branch is:

```ts
// OpenCode 2.0.22 packages/core/src/rpc.ts, parse
if (Schema.isSchema(schema)) return Schema.decodeUnknownEffect(schema)(value)
// Standard Schema is considered only afterwards.
```

Giving the host the complete conversion result makes that first branch true even when the schema belongs to a separately loaded Effect runtime. The host ignores its portable validator and compiles the foreign AST with its own parser.

The selected dependency explains the actual silent loss, beyond merely “different Effect copies”:

- `SchemaParser.ts`, `makeParser`, invokes `ast.getParser(compile, ...)`: AST methods still belong to the schema-owning runtime, while the compiler/transformation orchestration belongs to the host runtime.
- `internal/schema/parser.ts` allocates `missing = Symbol()` and the identity sentinel `sameExit = succeed(missing)` separately in each runtime.
- `SchemaAST.ts`, `fromRefinement`, returns the owning runtime's `sameExit` for a valid string. Host `SchemaParser.applyTransformation` compares by identity with its own `sameExit` and can read the foreign missing sentinel as a value rather than preserve the original string.
- The `Model.Ref.variant` custom optional has a decode/encode transformation. Its downstream foreign AST parser recognizes that foreign missing value; `SchemaAST.stepProperty` deletes a missing optional field without reporting a required-key error.

That source composition explains the observed sequence: the outgoing JSON contains `variant: "high"`; host **method-input decoding** removes it; the handler receives an already modified model. Neither the TUI selection projection nor KV serialization caused that loss. This explanation is specific to the selected Effect implementation, not a claim that every foreign Effect schema loses every optional field.

The bounded diagnostic reproduced it using this repository's installed pinned schema and an independently bundled rc.112 Schema parser:

```text
full conversion: host.isSchema = true
host decode: { role: "planner", model: { id: "chosen", providerID: "test" } }

validator-only wrapper: host.isSchema = false
validate: { role: "planner", model: { id: "chosen", providerID: "test", variant: "high" } }
```

The diagnostic also confirmed omission, explicit undefined before/after JSON, nested invalid values, excess-key stripping, and authorization's unrestricted object behavior. It corroborates the source trace; it is not a live host integration test.

The current `src/agent-models-rpc.ts` wrapper exposes only:

```ts
{ "~standard": Schema.toStandardSchemaV1(schema)["~standard"] }
```

This fresh outer object has no Effect marker or AST. The host takes the Standard Schema branch, calling the owning runtime's validator closure. It fixes the actual input path and similarly protects output/error schema selection. Its safety depends on retaining this outer wrapper; merely calling `toStandardSchemaV1` is insufficient.

The existing repository comment is directionally correct, but incomplete: the host does not test for “an AST” directly; it tests the retained Effect marker. The underlying loss involves mixed parser identity/missing sentinels, not JSON serialization. The documentation's support for Effect and Standard Schema does not specify this precedence or guarantee cross-runtime Effect interoperability.

### Application and KV are separate

`src/agent-models.ts` `parseSelection` redecodes with the owning `Model.Ref` and `onExcessProperty: "error"`, checks nonempty values and format/parse round-trip equality, and returns the selected model. This strictness applies to what reaches that helper: RPC may already have discarded unknown wire keys. It is not proof that the original HTTP input had no extras. Current settings correctness does not require rejecting those original extra keys.

`agentModels.set` verifies managed role, loaded agent, and current catalog variant before storage. `list` constructs `RolePreference` rows; `prepare` constructs executor-only `model: "provider/id#variant"`. Those projections are application behavior.

Host `PluginHost.storage` prefixes keys with a hex-encoded **plugin ID**, then delegates to global `KV.Service`. `KV.set` stores into `KVTable.value`, a SQLite text column configured with Drizzle `mode: "json"`. `preferenceKey` adds exact directory, workspace ID or null, and role. Plugin storage is not inherently location-scoped: the repository's key supplies that distinction. JSON storage cannot preserve undefined object properties, but it preserves a valid string variant; there is no KV schema decode that explains Issue #20's pre-handler loss.

## 5. Registration and lifecycle findings

### Registry key and collisions

`packages/core/src/rpc.ts` `layer` creates a **location-local** `Map<string, Array<entry>>`. `register` appends `{ definition, handlers }` under `definition.id` using `Effect.acquireRelease`. `call` selects `registrations.get(rpcID)?.at(-1)`.

- Definition ID is the registry key. Plugin ID is not another registry namespace or dispatch selector.
- Same-ID RPC registration succeeds. It does not merge methods, and does not permanently erase the earlier entry.
- The newest whole definition/handler set shadows earlier entries. A method present only in an older entry returns `rpc.method_not_found`; there is no search through older entries.
- Disposal removes precisely its own entry. Disposing the top entry reveals any earlier entry; removing the last entry deletes the key. Repeated disposal is harmless.
- Two plugins at one location can collide on an RPC ID. Duplicate **plugin** IDs are separately handled by the plugin supervisor/activation logic; that does not mean duplicate RPC IDs are rejected.

The existing IDs `opencode-agents` and `opencode-agents.models` are the safest supported arrangement for these unrelated domains. The API does not require separate domain IDs, but combining two independent registrations under one ID would break access to the shadowed methods. No shared ID abstraction is needed.

### Activation and teardown

`PluginHost.make` exposes `rpc: Object.assign(rpc.client, { register: rpc.register })`. `Plugin.load` runs the plugin Effect with its activation scope. Server setup installs both RPC registrations after its existing transformations/hooks; successful setup leaves that scope alive. Failed setup closes its scope and releases registrations acquired before the failure.

An HTTP call to a cold directory builds its location graph, whose `PluginSupervisor.layer` holds readiness and starts activation. `RpcHandler` waits on `Plugin.awaitActivation`. This waits for announced work to settle, not for the requested RPC to exist or every plugin to succeed. Missing/failed registration then fails visibly. A call does not load a plugin selected by RPC ID: it uses the configured plugins for the selected location.

`Plugin.activate` preserves the unchanged activation prefix, closes changed suffix scopes in reverse order, then loads replacements in order. Healthy old registrations are released. Failed replacement setup can deliberately reload the prior healthy definition as a fallback; module load failure can also retain a previous generation. “Readiness settled” is consequently not “latest requested source successfully activated.” Failed revisions are not continually retried merely because RPC is called.

Ordinary scoped registration does not leave permanently stale registry entries after successful disposal. This is a cleanup guarantee, not generation pinning: calls have no plugin revision token, and readiness is not held as a lock for the duration of dispatch. An update announced after a caller passes readiness can still race with lookup/execution.

### Reactivation versus location reload

| Situation | Source-supported behavior |
| --- | --- |
| Plugin replacement in the same live location graph | Future calls choose the current top entry. A call that already selected an entry retains its handler reference. Registration disposal alone does not interrupt its request fiber. The handler may continue and encounter application teardown/revocation. |
| Full location invalidation/reload | `LocationServiceMap.invalidate` detaches routing, then `LocationLifecycle.shutdown` calls `rpc.close`. `Rpc.call` checks closure at entry and races **handler execution** against the close Deferred, yielding `rpc.unavailable` if closure wins. |
| Decode/output encode already in progress | The close race does not encompass every codec operation or HTTP serialization. A result can win before closure; reload is not an atomic transaction barrier and cannot roll back completed side effects. |
| Future call using the same stale HTTP subclient | Subclient stores ID/method, not an activation handle. It sends a new request to the supplied directory and can reach a rebuilt/replaced activation. |
| Retained server-local subclient from a closed location | It is bound to its original service; calls fail `rpc.unavailable`. It does not migrate itself to a replacement graph. |

The repository must not assume that RPC cancellation, Promise rejection, or reload proves that a handler did nothing. Existing authorization ownership transfer and no-retry behavior remain necessary. `nativeAdmission` owns revocation through its activation finalizer; RPC does not replace those checks.

## 6. Location-routing findings

### Origin and identity

Internal `Location.Ref` (`packages/schema/src/location.ts`, `Ref`) contains `directory` and optional `workspaceID`. It contains no project ID, session ID, TUI ID, principal, or activation generation. `Location.boundNode` preserves these placement fields and separately resolves project metadata with `Project.resolve`.

The TUI's `LocationProvider` tracks a requested ref and obtains current info through its data layer. `createPluginContext` exposes the current location; repository callers snapshot it or fall back to `context.data.location.default()`. No RPC subclient implicitly follows this reactive getter: each invocation must pass its own options or use HTTP request defaults.

For HTTP in 2.0.22, `requestRef` constructs a ref with **directory only**, chosen from:

1. A nonempty `location[directory]` URL query value.
2. `x-opencode-directory`, URI-decoded with a fallback to the original header.
3. The server process's cwd.

The public query schema accepts only optional directory. A Promise caller can physically serialize an extra `workspaceID` query field at runtime, but the server ignores it for routing. Effect native query encoding also uses that directory-only schema. Sending an internal `Location.Ref` does not extend this public transport contract.

Internal cache identity is the canonical ref's directory and optional workspace ID; Effect's resource map uses structural keys. `canonical` normalizes Windows path separators through `path.normalize`; on other platforms it retains the supplied directory string. It does not merge placements by project ID, resolve symlinks, establish Git identity, or check freshness. The `AbsolutePath` schema here is a branded string, not a filesystem/path-security validator.

### Exact isolation guarantee and limits

**For valid explicit directory requests, the HTTP call uses that directory's workspace-less location graph and its RPC registry. Different canonical directory keys do not dispatch through one another's registry simply because they share a project ID or RPC ID.** The routing choice is made per request; it does not depend on whichever TUI most recently navigated somewhere.

This provides the needed separation for ordinary distinct worktree/checkout directory paths. It is not a Git root/head check, a guarantee that a path still identifies the same checkout, a realpath guarantee, or an authenticated-process boundary. The application retains all freshness and authorization checks.

| Scenario | Guarantee / failure behavior |
| --- | --- |
| Two worktrees/clones with distinct directory keys | Separate location registries/activations, even if project identity is shared. Application preference keys also separate directories. |
| Multiple TUIs using the same directory | Share that server's location graph and registry. RPC provides no per-TUI ownership or mutual exclusion. Authorization admission owns its exclusion. |
| Multiple TUIs using different directories | Their explicit calls route independently. Omitted location can use a common server default and defeats the caller's intended separation. |
| Multiple internal workspaces | Internal location services distinguish workspace IDs. HTTP RPC cannot select separate workspace placements with the same directory in 2.0.22. Do not claim that capability. |
| Navigation during a call | The request retains the supplied directory. Results are not automatically discarded when UI location changes. `agent-models-ui.current()` and authorization evidence checks provide the repository's stale-view rejection. |
| Stale directory/ref after plugin replacement | Can call the replacement or fallback generation at that directory; no generation rejection is intrinsic to HTTP RPC. |
| Stale directory after location invalidation | A subsequent request can rebuild it. Healthy graphs are retained indefinitely until invalidation; routing does not probe checkout freshness on every call. |
| Invalid/unavailable filesystem placement | Location graph construction may fail before `RpcHandler` executes. No universal `rpc.*` error is promised for failures in location middleware. It cannot silently select a different directory because registration is missing. |
| Empty/omitted directory | Defaults to header/cwd through `requestRef`; it is not an explicit stale-location rejection. |

Current authorization embeds the location in the claim and checks it against server context and session identity, so a workspace-bearing claim routed to a workspace-less graph fails closed. Model settings carry location only in call options; they have no analogous server check of a requested workspace ID. They are safe for the current public directory-scoped use, **not evidence of workspace-ID-scoped HTTP settings support**. If that becomes an actual feature requirement, open a focused follow-up against this exact missing public routing invariant before using it. No such new feature is implemented in this pass.

## 7. Error findings

Declared errors are created by the host-supplied `rpc.error` factory. The private `DeclaredError` class in `packages/core/src/rpc.ts` is checked with `instanceof`; an arbitrary `{ type, message }`, thrown Error, or plugin-defined Effect error is not a declared RPC error. Its type must also appear in the selected method's error map. `Rpc.define` reserves `rpc.*` names for framework failures.

| Category | Host / HTTP behavior | Current Promise/TUI receives; Effect distinction |
| --- | --- | --- |
| Declared error from `rpc.error` | `encodeError` validates/encodes declared data, preserves type and message, fails with structured `Rpc.Failure`. HTTP `RpcError`, status 400. | Rejected Promise with plain `{ type, message, data? }`. Effect typed subclient removes wrapper; decodes data only for Effect schemas. |
| Input schema failure | `parse` failure maps to `rpc.invalid_input`, retaining Error/string message or fallback. Handler is not invoked. HTTP 400. | Plain structured failure object with validation message. Effect error channel gets corresponding system failure. |
| Ordinary handler Effect failure without declared factory | `encodeError` turns it into a defect; handler defect normalization logs it and emits `rpc.internal`, `"RPC call failed"`. HTTP 500. | Structured generic failure, not the original failure class/message. |
| Handler defect / unexpected synchronous throw | Suspended handler execution and `catchDefect` log and normalize to `rpc.internal`. HTTP 500. | Same generic rejection. Defects within this host execution boundary are recoverable framework failures for both client styles. |
| Undeclared error name or invalid declared error data | Becomes a defect in `encodeError`, normalized as handler failure. HTTP 500. | `rpc.internal`; no malformed typed error is delivered as though valid. |
| Normal method output validation/encoding failure | Maps to `rpc.invalid_output` with useful schema message. HTTP `RpcInternalError`, status 500. | Structured failure preserving that message. |
| Codec defect outside handler execution | HTTP handler's outer `catchDefect` logs and emits generic `rpc.internal`. Direct local calls do not have this additional HTTP catch. | Generic HTTP rejection; local callers can still see a defect. Failures in later native envelope/JSON encoding are outside this catch. |
| Transport/abort, unexpected HTTP status, malformed JSON/content type | Generated Promise transport throws `ClientError` categories such as Transport, UnexpectedStatus, MalformedResponse, UnsupportedContentType; RPC adapter leaves non-RPC errors alone. | Rejected Promise with that client Error. Effect generated client wraps native HTTP/envelope Schema errors in its `ClientError`; interruption stays interruption. |
| Effect client method output decode failure | `RpcRuntime.read` decodes an Effect output schema after native response decode; failure remains a Schema error through `readError`. | Current Promise client has no such method-contract decoding step. |
| Effect client declared error data decode failure | `readError` promotes invalid Effect error-data decoding to a defect. | Current portable Promise error data is not client-redecoded. |
| Missing/closed RPC registration | `rpc.unavailable`, descriptive RPC ID, HTTP 400. | Plain structured rejection. Missing method/handler similarly gives `rpc.method_not_found`. |
| Stale/invalid location | Closed selected registry can yield unavailable; a stale valid directory can rebuild; location boot/middleware failures precede RPC mapping. | No guaranteed single stale-location error type. Failure is visible; location freshness must be application-checked. |

Structured Promise RPC failures are **not Error instances**. Model UI checks an object's `message` and presents it correctly. Authorization TUI `terminate`/`admissionFailed` use `error instanceof Error ? error.message : String(error)`, so a framework failure can be displayed as `[object Object]`. The host supplied a useful message; the loss is a local presentation projection. It still produces STOP and does not retry. That is a possible small diagnostic improvement, not a correctness failure requiring an error framework.

Authorization also intentionally projects many admission/settlement failures into an **unverified outcome string** through `nativeAdmission.authorize`/`unverified`; these are successful RPC results describing a failed/unverified application outcome. Model handlers instead convert expected `ModelSettingsError`s into declared `settings` errors with Void data. KV database defects are not ordinary expected settings failures and can still become `rpc.internal`.

Fail-visible handling is sufficient for current callers. RPC provides neither exactly-once completion nor proof of nonexecution after transport failure. Preserve the existing authorization no-resend rule.

## 8. Events recommendation

**No — continue avoiding RPC events unless a concrete feature requires them.** Both current definitions have empty event maps; request/result behavior meets their needs.

Verified support in `packages/schema/src/rpc.ts` and `packages/core/src/rpc.ts`:

- Define `{ events: { name: { schema } } }`; the public type constrains event data to an object.
- `register(...).events.emit(name, data)` applies the output codec rules, then publishes an ephemeral event named `rpc.<definition.id>.<name>` with the emitter's location.
- Local `context.rpc(definition).events.subscribe(name)` uses the location-scoped Bus subscription and `logicalEvent`; HTTP clients filter the global event feed by prefixed type and receive events from all locations.
- `packages/core/src/bus.ts` `subscribe` filters with directory and workspace ID when an ambient location exists. `packages/server/src/event-feed.ts` and `handlers/event.ts` expose live SSE, with bounded subscriber queues and failure/overflow termination.
- `packages/client/src/shared-events.ts`, Promise RPC async iterators/listeners, and Effect RPC Streams own connection/subscription cleanup through consumption. RPC events are not durable, replayed work.

Registration disposal removes callable methods; it does **not** install an active-registration check in the retained emit closure or close every subscription to that event type. A stale retained emit handle is not an authority-revocation primitive. Scope the producer and consumer normally if events are ever needed. No event-based authorization or settings workflow is warranted.

## 9. Current repository assessment

### `authorizeRpc`: conditionally safe

The conditions are already part of the current design:

- Public local-host transport is within the host TCB, not independently authenticated human/TUI identity. Its source comment accurately states that limit. The HTTP request carries no RPC-specific permission or principal proof.
- `authorizePublishedAttempt` uses the immutable activation location as the per-call route and embeds the same location in the claim. Server `nativeAdmission.local` and `rootIdentity` validate server/session identity and retain fresh Git checks. Directory routing supports this; shared project identity never replaces those checks.
- JSON object input preserves claim fields; detailed runtime claim validation remains in CAP admission. String output is host-validated and additionally checked by the caller.
- Registration is activation-scoped; the admission finalizer revokes local state. There is no assumption that registration disposal alone cancels already-running requests.
- `authorize` returns explicit unverified outcome text for many failures. Framework/transport failure also closes the TUI's authority visibly. Post-transfer uncertainty never resends the claim or wake.

The small diagnostic weakness is structured framework failures becoming `[object Object]` in local presentation. No unsafe grant follows from it. Workspace-bearing HTTP claims are not supported routing; existing comparisons fail closed rather than authorize a different placement.

### `agentModelsRpc`: conditionally safe

For current directory-scoped public calls, its supported use is correct:

- Distinct ID prevents whole-definition shadowing of authorization.
- Standard-only wrappers on every input/output/error force the owning validator path; nested optional variants survive.
- Explicit captured location options apply to `list`, `set`, and `reset`. UI compares current directory/workspace values after awaits before continuing stale dialogs/actions. A write already sent can still finish at its captured directory after navigation, which is consistent with request routing.
- Application checks role, loaded agent, valid model/variant, and availability before storage. Every executor use reads and validates its own setting. Preference keys separate exact placements inside plugin-global KV.
- `settings` uses the actual host error factory and a portable Void data schema. UI extracts its message; no retry/error abstraction is required.

The condition is that **HTTP routing is directory-only**. The repository's workspace-aware key helper and tests do not establish that HTTP calls can reach workspace-bearing activations. Unknown original RPC keys are stripped, not rejected; that is acceptable for current settings input, but must not be generalized to an authority-bearing exact-wire-input invariant.

### Existing coverage and its limits

`test/agent-models.test.ts` uses local trusted doubles at the cheapest useful layer. Its `hostParse` matches the actual Effect-first/Standard-second branch and forward Standard output validation. The independent-runtime test bundles the installed pinned Schema module, proves parser independence, verifies wrapper schemas are not detected as Effect, and checks variant preservation through selection, handler, stored setting, reopened rows, and injected execution model. This accurately models the codec-selection boundary implicated in #20.

It is not a complete host RPC test: it uses sync Effect parsing, a plain error-factory double, no actual registry/activation/middleware, and a `structuredClone` storage double rather than SQLite JSON. It validates host output, not client-side Standard decoding. It currently has no negative control proving the unwrapped hybrid drops the variant and no source guard ensuring its `hostParse` ordering still matches selected upstream. Its positive assertions remain useful.

`test/native-compatibility.test.ts` is a read-only host source-guard suite for native execution/policy/projection. It does not currently pin the RPC codec order, registry stack semantics, HTTP directory routing, or RPC cleanup. Existing comments and tests inform where protection belongs; the conclusions above are based on host source, not those tests.

The TUI plugin's cleanup and generation checks, `src/attempt.ts` location snapshots and transfer, and model UI's captured call options are application safeguards. No shared runtime framework is missing.

## 10. Bounded conventions

1. **Expose portable Standard Schema only across separately loaded Effect RPC boundaries.** Retain the fresh `~standard`-only wrapper; keep outputs/error data JSON-compatible and suitable for forward validation. Plain JSON Schema remains appropriate for authorization's broad input and string result.
2. **Use distinct IDs for independently registered RPC domains.** Keep the two current IDs; assume same-ID registration shadows the whole definition and can reveal an earlier one on disposal.
3. **Pass an explicit captured directory on every TUI method call.** Keep UI staleness checks. Do not infer workspace routing, Git identity, or checkout freshness from the HTTP location option.
4. **Register within the plugin activation scope.** Use host disposal/reactivation directly; assume readiness settles announced work rather than proving setup success or pinning a generation.
5. **Keep trust and completion decisions in the application.** Use the supplied declared-error factory, fail visibly, and preserve no retry after authorization transfer ambiguity. Registration teardown and request interruption are not rollback or proof of nonexecution.

These conventions do not require a new abstraction, lifecycle manager, event bus, or changes to Plan → human authorization → Implement → Review → Commit authorization → Commit.

## 11. Compatibility-test recommendations

Recommend three narrow protection areas, using the existing source-guard and trusted-double approach. Do not initialize Git repositories, launch OpenCode, or add production test seams for them.

### 1. Portable schema selection and nested variant preservation — needed

**Invariant:** Current boundary schemas expose only Standard Schema; a selected optional variant remains present, invalid nested values fail before handler use, and nested output rows preserve it.

**Why repository correctness depends on it:** Losing the variant silently changes the model setting/executor selection, as #20 demonstrated.

**Exact 2.0.22 behavior it pins:** `core/rpc.ts` `parse` checks `Schema.isSchema` before `~standard`; `encode` forward-validates Standard output. The wrapper avoids foreign AST parsing. Promise clients do not decode portable results again.

**Best existing test file:** Keep the existing independent-runtime behavior coverage in `test/agent-models.test.ts`; add a short selected-upstream source guard to `test/native-compatibility.test.ts` that protects the codec order/output choice modeled by `hostParse`. A focused negative control for the hybrid schema is useful only as version-specific diagnostic protection; do not require all future Effect versions to reproduce the bug after it is fixed upstream. No duplicate large end-to-end fixture is needed.

### 2. Distinct definitions and scoped dispatch — needed, one compact guard

**Invariant:** Independently registered authorization and settings definitions are both callable by their distinct IDs; removed registration entries cannot remain dispatchable as current entries.

**Why repository correctness depends on it:** Whole-definition shadowing can remove authorization or settings methods. Cleanup prevents new calls from entering disposed handler state after activation replacement.

**Exact 2.0.22 behavior it pins:** Map keyed by definition ID, append on acquire, lookup through `.at(-1)`, removal by entry identity on release; plugin setup uses activation Scope and closes changed activation scopes. It must not imply automatic interruption of in-flight calls.

**Best existing test file:** `test/native-compatibility.test.ts` for a compact host source guard linked to the existing distinct-ID/method-map assertions in `test/agent-models.test.ts`. Preserve the existing repository assertions. A separate exhaustive duplicate-stack or plugin-fallback suite would test host implementation beyond the current need.

### 3. Explicit directory routing — needed

**Invariant:** Calls carry their captured directory, and HTTP dispatch selects that directory's location graph rather than a project-wide registry or another TUI's location.

**Why repository correctness depends on it:** Authorization and preferences must apply to the intended checkout placement; a project-wide registry would invalidate the admission/isolation assumptions.

**Exact 2.0.22 behavior it pins:** `makeRpc` forwards location, generated transport emits its directory query, `requestRef` prefers that query, middleware provides `locations.get(ref)`, and `Rpc.node` is location-scoped. The public route has no workspace selector.

**Best existing test file:** `test/native-compatibility.test.ts` for the source path; retain model UI call-option checks in `test/agent-models.test.ts` and authorization captured-location checks in the existing attempt tests. Use small trusted doubles for navigation/stale-response behavior. Do not turn preference-key workspace tests into claims about host HTTP routing.

### Explicit decisions on the remaining candidates

| Candidate | Recommendation |
| --- | --- |
| Duplicate/distinct RPC ID registration | Keep distinct-ID assertions and the compact dispatch guard above. No standalone exhaustive duplicate-registration test is needed. |
| Registration disposal/reactivation | Include basic scoped removal in the dispatch guard. Do not add a general reactivation harness or assert that disposal cancels requests; source disproves the latter. Existing application revocation tests protect authorization itself. |
| Declared error propagation | No standalone host integration suite warranted now. Existing settings-handler conversion/UI error coverage protects current behavior; the real factory path is source-verified here. If changing error data or adopting an Effect HTTP client later, add a focused data-schema test then. |

## 12. Recommended repository action

**Next action: compatibility tests only**, bounded to the three protection areas above. Preserve the current implementation and RPC definitions. This investigation document is the durable architectural clarification for #23.

A later comment/diagnostic cleanup may replace “host prefers AST” with the precise marker check, describe host input/output validation accurately, and extract plain-object RPC messages in authorization's STOP presentation. Those are optional local clarifications; none requires a correctness fix, generic abstraction, or an error framework.

Workspace-ID-selected HTTP calls would require a **separate follow-up issue** if they become a concrete requirement. 2.0.22 does not supply that selector. Do not silently treat directory-scoped results as proof of workspace isolation.

User-run live dogfood can confirm deployed behavior later; this source investigation does not claim a live activation/reload exercise. No findings are implemented in this pass.

### Source-backed simplification assessment

The follow-up simplification question establishes two optional syntax-level cleanups. Neither removes a trust check or changes the RPC design, and neither is implemented here.

1. **Use `Effect.mapError` for the three settings-handler error conversions.** `src/agent-models-rpc.ts` currently catches an expected failure only to immediately fail with `rpc.error("settings", error.message)`. Each can become:

   ```ts
   Effect.mapError((error) => rpc.error("settings", error.message))
   ```

   Effect rc.112 `src/internal/effect.ts` implements `mapError` as `catch_(self, error => failSync(() => f(error)))`. For this synchronous host factory, it preserves the same failure conversion, declared-error instance, message, defects, interruption, and handler success value. This removes unnecessary recovery-shaped code while retaining declared errors. Removing the conversion entirely would instead make expected settings failures generic `rpc.internal`, because core `encodeError` requires its private `DeclaredError` instance.

2. **Optionally consolidate setup's two `Effect.orDie` applications at the outer plugin Effect.** Both registration yields in `.opencode/plugins/opencode-agents/server.ts` currently apply it separately. They can be direct yields with a single `.pipe(Effect.orDie)` on the surrounding `Effect.gen`. The current other setup yields have no typed failure channel; registration exposes `unknown`, while `packages/plugin/src/effect/plugin.ts` requires `Plugin.effect` to return `Effect<void, never, R>`. Effect `orDie` catches typed failures and dies with them; `Plugin.load` closes failed activation scopes for either placement. Setup order, first-failure short circuit, and acquired-registration cleanup are unchanged. This is purely optional style consolidation: the failure conversion itself cannot be deleted based on the current public type, and no manual dispose routine should be added.

No removal of current boundary checks is justified by this investigation:

| Candidate | Why it should remain |
| --- | --- |
| Standard-only wrapper | It selects the safe codec branch; the full conversion demonstrably loses the variant across runtimes. |
| Explicit Void schemas / settings error map | 2.0.22 requires input/output schemas, and the declared factory path requires the error map. |
| Distinct RPC IDs | Two independent same-ID registrations shadow each other's whole definitions. |
| Explicit per-call location and captured snapshots | Subclients do not capture a UI location; defaults can route elsewhere. Primitive snapshots also exclude project metadata/proxies from authority claims. |
| Location in authorization payload plus routing options | Routing selects a service; payload/session/context comparisons bind authority to the claimed placement. A caller can supply a mismatched payload even with a valid route. |
| Workspace-aware comparisons and storage keys | Public HTTP cannot route workspace IDs, but comparisons fail closed for unsupported refs and keys protect settings used by internal contexts. Dropping these fields would weaken that behavior rather than add HTTP workspace support. |
| UI checks after awaits | A completed request does not track navigation, dialog ownership, or plugin disposal. |
| Server admission finalizer / generation and revocation checks | Registration disposal does not cancel an in-flight handler or establish human authority. |
| Application `parseSelection` after RPC validation | It also validates persisted/direct inputs and enforces nonempty/round-trip constraints absent from the branded-string RPC schema. |
| Authorization result `typeof` check | The current Promise client only parses JSON and returns `output`; it has no method-contract response validator. The cheap check retains the current runtime boundary. |
| No-resend / ambiguous-outcome handling | Neither HTTP failure nor reload proves nonexecution or provides exactly-once behavior. |

The existing plain-object error-message issue should be corrected locally if diagnostic work is undertaken: use the same structural `message` extraction already present in the model UI. It is a presentation correction, not a reason to add an error abstraction. There is no source-backed reason to replace Promise calls with Effect calls, preflight RPC registration/activation, cache a separate readiness flag, manually manage registrations, or add events.

## 13. Evidence index

Paths and symbols identify the decisive evidence. Upstream links resolve into the read-only checkout at the exact commit recorded above. Effect links identify the installed dependency selected by upstream's rc.112 catalog; they are dependency evidence, not a substitute for the pinned OpenCode dispatch implementation.

### Current OpenCode documentation

| Source / section | What it establishes |
| --- | --- |
| [Effect client, Plugin RPC](https://opencode.ai/v2/docs/build/client/effect/#plugin-rpc), plus Headers and requests / Stream events | Shared client contract, per-call options, declared/framework errors, all-location HTTP event streams, shared connection semantics. Current intended public usage only. |
| [Effect plugin RPC](https://opencode.ai/v2/docs/build/plugins/effect/rpc), Define / Validation / Input and output / Errors / Events / Implement / Call / Subscribe | Contract forms, handler registration, error factory, local calls, events; omitted-schema statement that differs from 2.0.22. |

### Pinned OpenCode 2.0.22 source

| Path | Symbol / section | What it proves |
| --- | --- | --- |
| [packages/plugin/package.json](../../opencode/packages/plugin/package.json), [packages/schema/package.json](../../opencode/packages/schema/package.json), [package.json](../../opencode/package.json) | Versions, Effect catalog | Exact package/runtime selection; tag/commit separately verified with Git. |
| [packages/schema/src/rpc.ts](../../opencode/packages/schema/src/rpc.ts) | `Method`, `PortableDefinition`, `define`, `HandlerOutput`, `SystemError`, event types | Required schemas, uncompiled definitions, reserved error names, type-level codec asymmetry, public event shape. |
| [packages/schema/src/tool.ts](../../opencode/packages/schema/src/tool.ts) | `ValueSchema` | Accepted Effect/Standard/JSON forms. |
| [packages/plugin/src/effect/rpc.ts](../../opencode/packages/plugin/src/effect/rpc.ts) | `RpcHandlers`, `RpcDomain.register`, `RpcRegistration` | Handler/factory interface and registration scope requirement. |
| [packages/client/src/promise/client.ts](../../opencode/packages/client/src/promise/client.ts) | `make` | Current Promise RPC adapter installation. |
| [packages/client/src/promise/rpc.ts](../../opencode/packages/client/src/promise/rpc.ts) | `makeRpc`, `RpcCallOptions`, `RpcClient` | Unchanged method input; location/options; no portable result decoding; plain error rejection; event iteration/cleanup. |
| [packages/client/src/promise/generated/client.ts](../../opencode/packages/client/src/promise/generated/client.ts) | `make`, `prepare`, `request`, `rpc.call`, `appendQuery`, `json`, `declared` | Exact URL/body serialization, response parsing, error statuses and ClientError handling. |
| [packages/client/src/effect/client.ts](../../opencode/packages/client/src/effect/client.ts) | `make`, `CurrentHeaders` | Effect client RPC/headers and shared stream installation. |
| [packages/client/src/effect/rpc.ts](../../opencode/packages/client/src/effect/rpc.ts) | `make`, `aborted` | Effect calls, cancellation, prefixed-event filtering. |
| [packages/client/src/effect/generated/client.ts](../../opencode/packages/client/src/effect/generated/client.ts) | `EndpointRpcCall`, `mapClientError`, `make` | Native request envelope and native error wrapping. |
| [packages/client/src/rpc-runtime.ts](../../opencode/packages/client/src/rpc-runtime.ts) | `read`, `readError`, `event` | Effect-only result/error/event decoding; Standard/JSON pass-through. |
| [packages/protocol/src/groups/rpc.ts](../../opencode/packages/protocol/src/groups/rpc.ts), [packages/protocol/src/api.ts](../../opencode/packages/protocol/src/api.ts) | `RpcInput`, `RpcOutput`, `RpcGroup`, `makeApi` | Unknown input/output envelopes and application of location middleware. |
| [packages/server/src/handlers/rpc.ts](../../opencode/packages/server/src/handlers/rpc.ts) | `RpcHandler` | Activation wait, dispatch, HTTP failure mapping, undefined output omission, outer defect catch. |
| [packages/protocol/src/errors.ts](../../opencode/packages/protocol/src/errors.ts) | `RpcError`, `RpcInternalError` | Structured HTTP failures, statuses 400/500. |
| [packages/core/src/rpc.ts](../../opencode/packages/core/src/rpc.ts) | `layer`, `register`, `call`, `parse`, `encode`, `read`, `encodeError`, `DeclaredError`, `eventDefinition`, `logicalEvent` | Registry stack and cleanup; codec precedence; handler normalization/close race; declared errors; local clients and ephemeral events. |
| [packages/core/src/plugin/host.ts](../../opencode/packages/core/src/plugin/host.ts) | `make`, `storage` | Local RPC service access, registration exposure, plugin-global KV namespace. |
| [packages/core/src/plugin.ts](../../opencode/packages/core/src/plugin.ts) | `load`, `activate`, `close`, readiness holds | Activation scopes, prefix/suffix replacement, cleanup on setup failure, healthy fallback, readiness without generation lease. |
| [packages/core/src/plugin/service.ts](../../opencode/packages/core/src/plugin/service.ts) | `awaitActivation`, `Interface` | Announced activation readiness gate. |
| [packages/core/src/plugin/supervisor.ts](../../opencode/packages/core/src/plugin/supervisor.ts), [packages/core/src/plugin/module.ts](../../opencode/packages/core/src/plugin/module.ts) | `layer`, `activate`, `resolve`, `load` | Cold activation, update holds, failed revision retention, module loading rather than RPC-ID-based activation. |
| [packages/server/src/location.ts](../../opencode/packages/server/src/location.ts) | `requestRef`, `LocationMiddleware.layer` | Directory query/header/cwd precedence and directory-only HTTP selection. |
| [packages/protocol/src/groups/location.ts](../../opencode/packages/protocol/src/groups/location.ts) | `LocationQuery` | Public query has directory only. |
| [packages/schema/src/location.ts](../../opencode/packages/schema/src/location.ts), [packages/core/src/location.ts](../../opencode/packages/core/src/location.ts) | `Ref`, `PublicRef`, `boundNode` | Internal directory/workspace fields; public ref omits workspace; project is metadata outside placement key. |
| [packages/core/src/location-services.ts](../../opencode/packages/core/src/location-services.ts), [packages/core/src/location-service-map.ts](../../opencode/packages/core/src/location-service-map.ts) | `buildLocationServiceMap`, `canonical`, `reload` | Location cache, retention, key normalization, routing detachment, replacement builds. |
| [packages/core/src/instance.ts](../../opencode/packages/core/src/instance.ts), [packages/core/src/location-lifecycle.ts](../../opencode/packages/core/src/location-lifecycle.ts) | `graph`, `layer`, `shutdown` | RPC/plugin services belong to each location graph; shutdown closes RPC and publishes location shutdown. |
| [packages/tui/src/plugin/api.tsx](../../opencode/packages/tui/src/plugin/api.tsx), [packages/tui/src/context/client.tsx](../../opencode/packages/tui/src/context/client.tsx), [packages/tui/src/context/location.tsx](../../opencode/packages/tui/src/context/location.tsx) | `createPluginContext`, `ClientProvider`, `LocationProvider` | Actual TUI Promise client and current/requested location origins. |
| [packages/schema/src/model.ts](../../opencode/packages/schema/src/model.ts), [packages/schema/src/schema.ts](../../opencode/packages/schema/src/schema.ts) | `Model.Ref`, `optional` | Nested model shape and transformed optional variant semantics. |
| [packages/core/src/kv.ts](../../opencode/packages/core/src/kv.ts), [packages/core/src/kv/sql.ts](../../opencode/packages/core/src/kv/sql.ts) | `KV.Service`, `set`, `KVTable` | Global KV and JSON text serialization, distinct from RPC decoding. |
| [packages/core/src/bus.ts](../../opencode/packages/core/src/bus.ts), [packages/server/src/event-feed.ts](../../opencode/packages/server/src/event-feed.ts), [packages/server/src/handlers/event.ts](../../opencode/packages/server/src/handlers/event.ts) | `publish`, `subscribe`, `local`, `EventFeed.make`, `EventHandler` | Live location filtering, global HTTP feed, SSE lifecycle and overflow failure. |
| [packages/client/src/shared-events.ts](../../opencode/packages/client/src/shared-events.ts) | `make` | Shared lazy client event connection and consumer cleanup. |

### Selected Effect dependency evidence

| Source path under `node_modules/effect` | Symbol / section | What it proves |
| --- | --- | --- |
| [src/Schema.ts](../node_modules/effect/src/Schema.ts), [src/internal/schema/schema.ts](../node_modules/effect/src/internal/schema/schema.ts) | `toStandardSchemaV1`, `isSchema`, `TypeId`, `SchemaProto` | Conversion retains original schema; runtime detection uses a shared string marker. |
| [src/SchemaParser.ts](../node_modules/effect/src/SchemaParser.ts), [src/internal/schema/parser.ts](../node_modules/effect/src/internal/schema/parser.ts) | `makeParser`, `applyTransformation`, `missing`, `sameExit`, `toOption`, `fromOptionExit` | Foreign AST methods mixed with host compilation; per-runtime sentinel identities explaining optional-value loss. |
| [src/SchemaAST.ts](../node_modules/effect/src/SchemaAST.ts) | `Objects.getParser`, `stepProperty`, `fromRefinement`, `Arrays.getParser`, `Union.getParser` | Recursive schema parsing, excess-key behavior, optional deletion, array/union checking. |
| [src/internal/schema/fromJsonSchemaDocument.ts](../node_modules/effect/src/internal/schema/fromJsonSchemaDocument.ts), [src/internal/schema/fromRepresentation.ts](../node_modules/effect/src/internal/schema/fromRepresentation.ts) | `lowerObject`, `collectObjectScope`, Objects reconstruction | Unrestricted JSON object contract retains additional keys rather than fixed-Struct stripping. |
| [src/unstable/httpapi/HttpApiClient.ts](../node_modules/effect/src/unstable/httpapi/HttpApiClient.ts), [src/unstable/httpapi/HttpApiBuilder.ts](../node_modules/effect/src/unstable/httpapi/HttpApiBuilder.ts) | Request encoders / response decoders, `handlerToRoute`, `decodePayload` | Native HTTP envelope codecs are separate from plugin method codecs. |
| [src/MutableHashMap.ts](../node_modules/effect/src/MutableHashMap.ts), [src/Equal.ts](../node_modules/effect/src/Equal.ts), [src/RcMap.ts](../node_modules/effect/src/RcMap.ts) | `get`, `set`, `equals`, resource-map lookups | Structural location resource keys rather than RPC client object identity. |
| [src/internal/effect.ts](../node_modules/effect/src/internal/effect.ts), [src/Effect.ts](../node_modules/effect/src/Effect.ts) | `mapError`, `orDie` | Equivalent local settings failure mapping and optional setup failure-conversion consolidation. |

### opencode-agents repository source

| Path | Symbol / section | What it proves |
| --- | --- | --- |
| [src/authorize-rpc.ts](../src/authorize-rpc.ts) | `authorizeRpc` | Broad JSON object/string contract and explicit host-TCB comment. |
| [src/agent-models-rpc.ts](../src/agent-models-rpc.ts) | `portable`, `agentModelsRpc`, `agentModelsHandlers` | Wrapper on every schema, distinct ID, declared settings error factory use. |
| [src/agent-models.ts](../src/agent-models.ts) | `parseSelection`, `preferenceKey`, `set`, `list`, `prepare` | Application validation/projections and exact placement storage key. |
| [.opencode/plugins/opencode-agents/server.ts](../.opencode/plugins/opencode-agents/server.ts) | Plugin Effect / registrations / admission finalizer | Both definitions installed in activation scope and local authorization teardown. |
| [.opencode/plugins/opencode-agents/tui.tsx](../.opencode/plugins/opencode-agents/tui.tsx) | `terminate`, `admissionFailed`, authorization invocation, cleanup | Visible STOP/no resend and plain-object message presentation limitation. |
| [.opencode/plugins/opencode-agents/agent-models-ui.ts](../.opencode/plugins/opencode-agents/agent-models-ui.ts) | `registerAgentModels`, `current`, per-call `options`, catch | Captured location, stale UI checks, correct structured-message presentation. |
| [src/attempt.ts](../src/attempt.ts) | `snapshotLocation`, `checks`, `authorizePublishedAttempt` | Primitive identity snapshot, explicit RPC routing, ownership transfer/no retry. |
| [src/native.ts](../src/native.ts) | `nativeAdmission`, `local`, `rootIdentity`, `authorize`, `teardown`, `unverified` | Application admission/freshness/revocation and failure-to-outcome-string projection. |
| [test/agent-models.test.ts](../test/agent-models.test.ts) | `hostParse`, `uiFixture`, independent-runtime regression, storage fixture | Existing codec/double coverage and its limits; not proof of host routing or real declared error encoding. |
| [test/native-compatibility.test.ts](../test/native-compatibility.test.ts) | Read-only selected-host source guards | Appropriate existing home for narrow RPC compatibility assertions. |

The setup simplification also relies on pinned [packages/plugin/src/effect/plugin.ts](../../opencode/packages/plugin/src/effect/plugin.ts), `Plugin.effect`, which requires a never error channel, and `packages/core/src/plugin.ts`, `load`, whose failed-scope cleanup is indexed above.

**Final classification: B — Correct seam with bounded conventions.**
