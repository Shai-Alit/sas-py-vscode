# ADR-0042 — The MCP server for Claude Code is hand-written, off by default, loopback-only, and reads its per-start secret from a file

- **Status:** Accepted
- **Date:** 2026-09-28
- **Decides:** how slice 13l (built as Phase 12's 12o) builds the Option C
  server that 12c scoped: the protocol it speaks, when it runs, the secret,
  the port, the request checks, and the line that registers it with Claude
  Code
- **Amends:** 12c's token design and plan item 15 in
  [`docs/phases/phase-12.md`](../phases/phase-12.md). The secret is held in
  memory and in a file, not in `SecretStorage`, and the `headersHelper` is a
  `type`/`cat` command, not a generated script. Also
  [ADR-0003](0003-extension-host-target.md): two more Node-only files (its
  2026-09-28 amendment).
- **Executed in:** Phase 13 slice 13l (built as Phase 12's 12o, moved
  2026-09-29)
- **Evidence:** [`docs/phases/phase-13.md`](../phases/phase-13.md), the
  "13l built" Runbook entry (probes (a) to (c), the quoting runs) and the
  "13l picked up" entry (probe (a′), Claude Code 2.1.284)

## Context

[ADR-0037](0037-ai-agent-integration-approach.md) chose to spike Option C, an
MCP server inside the extension that Claude Code connects to. Spike 12b found
it viable. 12c scoped the build for the external Claude Code CLI only: a
`127.0.0.1` HTTP server, a per-start secret handed out through Claude Code's
`headersHelper`, a stable per-workspace port, and workspace trust gating the
start. 13l builds the server and its lifecycle. The read-only tools are 13m's.

Three things found while building it changed 12c's design:

1. **Claude Code reaches a legacy-era server.** MCP's 2026-07-28 revision
   is stateless and has no `initialize`; the revisions before it open with
   one. Claude Code 2.1.245 sent a bare `initialize` for `2025-11-25`, with
   no `MCP-Protocol-Version` header and no `Origin` (probe (a)). Claude
   Code 2.1.284 first sends a modern `server/discover` with
   `MCP-Protocol-Version: 2026-07-28`, and on this server's `400` falls
   back to the same `initialize` (probe (a′)). The 2026-07-28 revision's
   compatibility matrix has a dual-era client fall back whenever a modern
   request draws a 4xx without a modern error body.
2. **Nothing outside VS Code can read `SecretStorage`.** A `headersHelper` is
   a separate process that Claude Code starts, so it cannot serve a secret
   kept there.
3. **The helper's shell is not the user's.** On Windows Claude Code runs a
   `headersHelper` as `cmd.exe /d /s /c "<command>"`, even when the user's
   shell is Git Bash (probe (b)). The line that registers the server is
   pasted into the user's own shell, and each shell quotes its JSON argument
   differently.

## Decision

1. **Hand-written, legacy era only** (`src/agent/protocol.ts`). The server
   agrees `2025-11-25` or `2025-06-18` and replies with plain JSON: no
   session id and no event stream. It answers `initialize`, `ping`,
   `tools/list` (empty until 13m) and `tools/call` (always "Unknown tool").
   A notification or a client's response gets `202`, and any other method
   gets method-not-found. It adds no runtime dependency.
2. **Off by default.** `pythonOnViya.agentServer.enabled` defaults to
   `false` and is in `restrictedConfigurations`, so an untrusted folder's
   settings cannot turn it on. The server runs only when a folder is open,
   the workspace is trusted and the setting is on, and it starts or stops
   as any of those changes. **Python on Viya: Set Up Claude Code Access**
   offers to turn the setting on for the user, then copies the registration
   line.
3. **A per-start secret, in memory and in one file.** It is 32 random bytes
   in base64url, new at every start and never derived from the Viya token.
   The server writes `{"Authorization":"Bearer <secret>"}` to
   `mcp-headers-<port>.json` in the workspace's own extension storage
   (`ExtensionContext.storageUri`, under the user's profile). On POSIX the
   file is created exclusively with mode `0600`. On Windows it inherits the
   directory's ACL: the same access as the rest of the user's VS Code data,
   which in the default location admits the user, SYSTEM and Administrators.
   The file is removed when the server stops. Each start first clears any
   left behind, and so does each refresh that leaves the server off. The `headersHelper` is `type "<file>"` on Windows and
   `cat '<file>'` elsewhere. The helper is not a script and does not run
   Node. A path that cannot be quoted safely for the helper's shell (on
   Windows, one holding `%`, `!` or `"`; anywhere, one holding a control
   character) is refused, and the command says so instead of registering
   anything. The server hashes both the secret and the presented token, then
   compares them in constant time.
4. **An OS-assigned port, kept per workspace.** The first start binds port
   `0` and stores the port the OS chose in `workspaceState`. Later starts try
   that port again. If it is taken (`EADDRINUSE`) or reserved (`EACCES`),
   the server binds another port, stores it, and tells the user to register
   again.
5. **Loopback only.** The server binds the literal `127.0.0.1`, with
   `exclusive`. It does not use `localhost`, which can resolve to `::1`. The
   registration URL is `http://127.0.0.1:<port>/mcp`.
6. **Checks in a fixed order, before the body is used** (`src/agent/guard.ts`):
   1. `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (`403`).
   2. Any `Origin` at all (`403`).
   3. The bearer secret (`401`, with `WWW-Authenticate`).
   4. The path `/mcp` (`404`).
   5. `POST` only (`405`, with `Allow: POST`).
   6. `Content-Type: application/json` (`415`).
   7. An `MCP-Protocol-Version` header, if present, that the server supports
      (`400`).

   A caller without the secret learns only `401`. A body over 1 MiB gets
   `413`. Headers must arrive within 10 seconds, and the whole request
   within 30. Node checks both limits every second, not every 30 seconds
   as it does by default, so each holds to within a second.
7. **Every reply waits for the end of the request body.** A refused or
   oversized body is read and discarded, not kept. A reply sent earlier
   makes Node close the connection, and on Windows the client then loses the
   status to a reset. Losing a `401` would break the reload recovery below.
8. **The registration line is quoted for the user's default terminal
   shell** (`src/agent/registration.ts`). It is
   `claude mcp remove --scope local python-on-viya`, then
   `claude mcp add-json --scope local python-on-viya <json>`, so it also
   replaces an older registration:
   - A POSIX shell, Git Bash included: a single-quoted argument.
   - Command Prompt: a C-runtime-quoted argument.
   - PowerShell on Windows: the Command Prompt form inside `cmd /c '…'`.
   - PowerShell elsewhere: a single-quoted argument.

   The command copies the line and offers to paste it, without running it,
   into a new terminal in the workspace folder. Claude Code keys a
   `--scope local` registration to the directory it is run in.
9. **Nothing logs the secret or a request's headers.** A refused request is
   logged as its status and a fixed message, at debug level. Any local
   process can send requests, and every reload is followed by one refused
   request by design, so warnings would flood the log and alarm the user.

## Alternatives considered

- **The official MCP TypeScript SDK.** It serves both protocol eras, but it
  brings a dependency tree (`zod`, an HTTP framework and more) into the
  bundle for five methods. [ADR-0005](0005-supply-chain-policy.md) weighs
  every such dependency, and [ADR-0010](0010-compute-client-is-hand-written.md)
  hand-wrote the compute client on the same grounds.
- **The stateless 2026-07-28 revision only.** Claude Code 2.1.245 cannot
  connect to it. 2.1.284 tries it first, but serving it would add a second
  request shape for no client that needs one.
- **`SecretStorage` plus a helper that asks the extension for the secret.**
  The helper would need a channel to ask on, and that channel would need its
  own secret. This restates the problem.
- **The secret written into the registration as a static header.** 12b
  found that a static header cannot recover once the secret changes, and
  this secret changes at every start.
- **A fixed port, or one derived from the workspace path.** It can collide
  with another program that picked the same port, and nothing would say so.
  An OS-assigned port is free when it is chosen.
- **On by default in every trusted workspace.** Every user would get a
  listening socket in every window, for a feature few of them use.
- **An `Origin` allow-list.** Claude Code sends no `Origin`, so any `Origin`
  comes from a browser.

## Consequences

- **Nothing listens unless the user turns it on,** in a trusted workspace
  with a folder open. A window with no folder cannot use it.
- **A window reload makes a new secret without re-registering.** Claude
  Code's documentation says it runs the helper on every connection, and runs
  it again and retries once after a `401` or `403`. The helper reads the new
  file. Manual item 13.9 checks this with a real Claude Code.
- **A port change means registering again.** The old registration's helper
  names a file that no longer exists, so it cannot hand the new secret to
  whatever now holds the old port. A notification offers **Register Again**.
- **Whoever can read the user's profile can read the secret** while the
  server runs, the same as the rest of the user's VS Code state. Another
  local user or process that cannot is refused with `401`.
- **Claude Code does not check which server it reaches.** Where its own
  trust prompt has not been accepted, it skips the helper and connects to
  the registered port with no secret (probe (c)). So with this server off,
  whatever binds that port gets Claude Code's requests. That is harmless
  while the server lists no tools. From 13m, such a program could offer
  Claude Code its own tools, and 13m's security review weighs it. Manual
  item 13.11 records the same case in a trusted folder.
- **A remote window runs the server on the remote host.** The extension
  runs where the workspace is, so under Remote-SSH, WSL, a container or
  Codespaces the server listens on that host's loopback, and VS Code's
  automatic port forwarding can forward it to the user's machine. The secret
  and the `Host` check still apply there. `registerPortAttributesProvider`,
  which could mark the port as not for forwarding, is not in the stable API
  at VS Code 1.104. A user can set `remote.portsAttributes` for the port
  instead.
- **Settings Sync carries Turn On** to the user's other machines, since it
  writes a user setting. Each machine still needs a trusted folder, and
  makes its own secret.
- **Claude Code must trust the folder too.** A `--scope local` server's
  helper runs only after Claude Code's own trust prompt is accepted in that
  folder.
- **The web extension host has no sockets,** so a web build would leave the
  server out (ADR-0003's 2026-09-28 amendment).
- **13l's server lists no tools.** 13m adds the read-only ones. ADR-0037's
  security review, against 12c's checklist, runs on each slice's diff.
- **Every connection from a current Claude Code starts with one refused
  request.** Its `server/discover` draws the `400`, logged at debug level
  like any refusal (decision 9), before the fallback `initialize` succeeds.
- **The legacy era has an end date.** Its deprecation window runs to July
  2027. Revisit this decision before then, or sooner if Claude Code stops
  falling back to it. Claude Code already tries the stateless revision
  first (probe (a′)); keeping this server legacy-only was re-decided on
  2026-09-30, in 13l's pickup (Sean's call).
