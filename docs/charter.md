# opencode-agents Project Charter

`opencode-agents` is an OpenCode-only experiment in enforcing a small Coding
Authority Protocol (CAP) for AI-assisted repository changes. Its purpose is
to preserve useful safety invariants without a general workflow engine,
repair/recovery lifecycle, or large model-facing state protocol.

The [CAP document](coding-authority-protocol.md) owns the normative authority
contract. [Orchestration](v1-orchestration.md) owns runtime sequencing and
implementation status; the [documentation index](README.md) identifies the
current owners.

## Core principles

- Coding authority is mechanical and trusted. Model prose, conversation,
  tool capability, and previous approvals cannot grant it.
- The human should understand the exact proposed change before explicitly
  authorizing it. Trusted presentation and authorization are distinct.
- Trusted code independently observes facts it can verify. An agent's claim
  is not evidence of authorization, repository state, or a successful effect.
- Planning, implementation, and independent review have distinct
  contexts and explicit artifact handoffs. Role selection is not authority.
- Scope and authority remain bounded. Failure ends an attempt; later work
  starts from current repository reality with fresh authority.
- Add infrastructure only for an established need. The predecessor,
  `codex-agents`, is a source of invariants, failures and techniques, rather
  than an architecture or compatibility target.

## Trust assumptions

The supported topology is ordinary local OpenCode. The installed OpenCode
host/TUI, installed integration and authority kernel, role/tool enforcement,
and local OS/user-account boundary are trusted. Repository content, model
output, session records and durable records are not authority sources.

This is an authority-integrity contract within that local trust boundary.
It does not defend installed trusted components against deliberate same-user
modification. Ordinary development shell capability is not adversarial
filesystem or Git-history containment; trusted observation has explicit
limits defined by CAP. The trusted TUI is the intended producer of Authorize
claims; same-user local processes and localhost OpenCode RPC access belong to
the trusted host boundary. RPC caller origin is not independently authenticated.
CAP is not an OS/process sandbox.

## Current goals

- Keep a small, auditable authority contract and runtime with clear ownership.
- Require explicit human authorization of the exact published Plan, preserving
  clean initial eligibility, fresh evidence and one-shot implementation admission.
- Preserve readable bound Plans and native child-session visibility.
- Independently verify implementation provenance and Git scope, then automatically
  run a fresh read-only Reviewer against the exact verified target and revalidate
  that target before accepting review evidence.
- Stop each attempt before Commit, without repair or repeat review. Separate
  human-authorized Commit and Reviewer-owned executable validation remain future work.

## Non-goals

V1 excludes a general workflow engine, persisted workflow phases, repair or
retry/recovery protocols, finding adjudication, mutable scope, inherited
authority, arbitrary child or parallel workflows, and changed-HEAD recovery.
It also excludes predecessor protocol/database compatibility, multi-host
portability, an MCP authority server, and a separate orchestration service.

V1 does not require Docker, a general sandbox, a separate OS user, filesystem
isolation, runtime or physical-human attestation, a custom snapshot engine,
or exhaustive detection of concealed mutations through ordinary shell access.
