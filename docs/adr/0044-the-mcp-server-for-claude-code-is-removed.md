# ADR-0044 — The MCP server for Claude Code is removed before any release, and no MCP work replaces it

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decides:** whether this extension offers Claude Code (or any agent) a
  connection to its Viya session
- **Supersedes:** [ADR-0042](0042-a-local-mcp-server-for-claude-code.md) in
  full, and [ADR-0003](0003-extension-host-target.md)'s 2026-09-28 amendment
- **Amends:** [ADR-0037](0037-ai-agent-integration-approach.md) (its Option C
  line of work ends; no MCP work is planned), and plan items 10 (13j), 12 (13l) and 13 (13m) in
  [`docs/phases/phase-13.md`](../phases/phase-13.md), which are dropped
- **Executed in:** Phase 13, the "MCP server removed" Runbook entry
- **Evidence:** Sean's call, 2026-09-30, during 13m's manual pass

## Context

13l ([ADR-0042](0042-a-local-mcp-server-for-claude-code.md)) merged a local
MCP server as PR #233 on 2026-09-30. It was off by default, and no release
included it: `v0.1.5` was tagged before it merged. 13m (its read-only tools)
was built and reviewed but never merged. 13j (a tool that runs Python) was
not started.

To use the server, the user registers it with a `claude mcp add-json
--scope local` line copied from a command. Then they run the Claude Code
command-line tool in that folder, with the VS Code window that runs the
server open. 13l's manual pass (13.8) tested only that path. Writing 13m's
manual items made the cost plain. The feature reaches one Claude Code
surface, set up by hand at a command line. Sean judged that a regression
from what users expect of an editor feature.

SAS already ships an official Viya MCP server, `sassoftware/sas-mcp-server`
([research note](../research/ai-integration-2026-09-21.md), point 17). In
Sean's view, that leaves a second, narrower server in this extension with
no reason to exist.

## Decision

1. **The server is removed:** `src/agent/`, the
   `pythonOnViya.agentServer.enabled` setting, the **Set Up Claude Code
   Access** command, their tests, and `docs/claude-code.md`. Nothing
   replaces them.
2. **13j, 13l and 13m are dropped.** No MCP work is planned.
3. **The agent skill stays** ([`docs/agent-skill.md`](../agent-skill.md)).
   It gives an agent knowledge of how Python runs on Viya, not a
   connection. It needs no server.
4. **ADR-0003's allow-list goes back to five files.** `src/agent/server.ts`
   and `src/agent/headersFile.ts` were its sixth and seventh entries.

## Alternatives considered

- **Keep the server and finish 13m.** It would still reach only the command
  line, beside SAS's own server.
- **Reach more Claude Code surfaces.** Out of scope for this decision, and
  SAS's server already serves agents that want Viya.

## Consequences

- **No migration.** No release had the setting or the command.
- **Findings 13.4 and 13.5 (what a CAS `where=` evaluates) were never
  merged.** They were written for 13m and are not in this repository.
- **ADR-0042 and the 13l Runbook entries stay** as the record of what was
  built and why. The manual items 13.6–13.13 stay as the record of their
  pass and are not run again.
