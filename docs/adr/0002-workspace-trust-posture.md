# ADR-0002 — Workspace trust posture: limited

- **Status:** Accepted
- **Date:** 2026-08-12
- **Decides:** Open decision #3 in `PRODUCTION_PLAN.md` §6
- **Executed in:** slice 0b (`capabilities.untrustedWorkspaces` in `package.json`)

## Context

VS Code's workspace trust feature exists because opening a folder should not be
equivalent to running its contents. An extension declares how it behaves in an
untrusted folder: full support, limited support, or none.

This extension is close to the worst case the feature was designed for. It holds
OAuth tokens for a live SAS Viya deployment and executes arbitrary code on it. A
malicious repository that could induce a connection or a run would be executing
code inside someone's enterprise analytics environment, under their identity, with
their data in reach. Settings are an attack surface too: a checked-in
`.vscode/settings.json` can supply a workspace-scoped connection profile pointing
at a host the attacker controls, which is a credential-harvesting path if we act
on it automatically.

Against that, refusing to function at all in untrusted folders is genuinely
annoying. Reading code, browsing a repository, and fixing a syntax error are safe
activities, and a trust prompt on every casual clone trains people to click
"trust" reflexively — which makes the whole mechanism worse, not better.

## Decision

**Declare limited support in untrusted workspaces**
(`capabilities.untrustedWorkspaces.supported: "limited"`).

Available untrusted: opening and editing files, syntax and editing intelligence,
viewing and editing connection profiles, and all read-only UI.

Requires trust: establishing a connection, acquiring or reading tokens from
`SecretStorage`, executing any code, and honouring **workspace-scoped**
connection-profile settings. Profiles defined at user scope remain visible but are
not connectable until the folder is trusted.

Workspace-scoped settings that gate this are listed in
`untrustedWorkspaces.restrictedConfigurations` so VS Code ignores them itself
rather than relying on us to remember a check at every call site.

## Alternatives considered

**Require full trust (`supported: false`).** Simplest to reason about and
impossible to get subtly wrong — the extension is inert until trusted, so there is
no partially-enabled state to audit. Rejected because it degrades the common, safe
case of reading an unfamiliar repository, and because a trust prompt that fires
before the user has asked for anything is the kind that gets dismissed without
reading.

**Full support (`supported: true`).** Rejected outright. It would let a workspace
trigger remote execution against a live deployment, which is precisely the risk
workspace trust exists to gate.

**Limited support, but allow connections and block only execution.** Considered
and rejected: connecting is where the token is acquired, and a workspace-supplied
profile pointing at an attacker-controlled host harvests credentials without ever
running a line of Python. The token boundary is the right place to draw the line,
not the execution boundary.

## Consequences

**Good.** The dangerous operations sit behind an explicit user decision, and the
prompt appears when the user asks to connect — the moment it is most likely to be
read and understood rather than dismissed.

**Costs.** Two code paths to maintain and test, and every new feature must decide
which side of the line it falls on. This is a standing review question, not a
one-time setup: it is easy to add a command in Phase 6 that quietly works
untrusted because nobody thought about it. Integration tests must cover the
untrusted path, or the restriction will rot.

**Depends on ADR-0001** only for the namespace used in
`restrictedConfigurations`.
