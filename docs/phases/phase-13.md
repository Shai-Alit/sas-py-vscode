# Phase 13 — Feature completion

Bundled for this phase: plan section, runbook punch list, and probe
findings. See `STATUS.md` for where this fits in the overall project,
and the trimmed `PRODUCTION_PLAN.md` / `RUNBOOK.md` at the repo root
for cross-cutting material (architecture, quality gates, the per-slice
loop, conventions).

> **Renumbered from Phase 12 to Phase 13, 2026-09-22 (Sean's own call).**
> Phase 12 was repurposed the same day for AI-agent integration
> (`docs/phases/phase-12.md`,
> [ADR-0037](../adr/0037-ai-agent-integration-approach.md)) — a body of work
> that did not exist when this phase was first numbered, and had no work of
> its own against this number yet (no punch list, no probe findings). This
> phase's own content — a second execution backend — is unchanged; only its
> number and file path moved. Every cross-reference to "Phase 12" meaning
> this topic (`docs/adr/0007-connection-profile-storage.md`,
> `docs/phases/phase-3.md`, `PRODUCTION_PLAN.md` §8,
> `docs/dev/manual-tests/`) was updated to Phase 13 in the same change.

> **Scope extended and retitled, 2026-09-24 (Sean's own call).** A sweep of
> Phases 11 and 12 found researched, deferred and flagged work that had no
> slice (`phase-12.md`'s "Backlog sweep" Runbook entry). What was ready to
> build went to Phase 12. What still needs a design pass, a probe or an
> architecture decision came here, as slices 13a–13k. **v1.0 now waits for
> this phase** (`PRODUCTION_PLAN.md` §8's 2026-09-24 amendment), **except**
> the second-execution-backend section at the end of the Plan, which keeps
> its original "only if warranted" status and does not gate anything. The
> title changed from "Second execution backend" to match; that section's
> text is unchanged.

> **The MCP server work moved here from Phase 12, 2026-09-29 (Sean's own
> call).** Phase 12's 12o (the MCP server for Claude Code) and 12p (its
> read-only tools) are now **13l** and **13m**. 12o was already built and
> part-way through its manual pass, and **its code is on the unmerged branch
> `feat/12o-mcp-server`**, pushed with no PR and ready to pick up. Start
> 13l from that branch, not from scratch. The Runbook's "12o and 12p moved
> here" entry has what is on it and the pickup steps.

> **The MCP server is removed, and 13j, 13l and 13m are dropped,
> 2026-09-30 (Sean's own call).** Plan items 10, 12 and 13 below stand as
> written, as the record of what was planned; none of them will be built.
> See [ADR-0044](../adr/0044-the-mcp-server-for-claude-code-is-removed.md)
> and the Runbook's "MCP server removed" entry.

> **Scope extended: the SAS Server view, 2026-09-30 (Sean's own call).**
> Upstream `vscode-sas-extension` has a **SAS Server** view, which browses
> files on the SAS server. Nothing in this project's parity work picked it
> up. It is added as **13o** (review, scoping and probes) and **13p** (the
> build). See the Runbook's "Scope extended, 2026-09-30" entry.

---

## Plan

### Phase 13 — Feature completion

Every slice below links the write-up it comes from. Those write-ups stay
where they are and are not copied here, so there is one place to read each
design. Slices that change an architecture decision start with a decision
step Sean reviews, per `CLAUDE.md`'s "Treat architecture-level changes as a
deliberate event".

1. **13a — SAS Content: upload from and download to local disk.** From
   Phase 6, carried in `phase-11.md` ("Upload/download to local disk").
   Sean: a feature developers will expect. Upload a local file into a SAS
   Content folder, and download a SAS Content file (and, if cheap, a folder)
   to disk: the two directions Phase 6's `sasContent:` provider did not
   cover. Probe the Files service's upload media types and the size
   behaviour first, and check how upstream `vscode-sas-extension` does it.
2. **13b — SAS Content: Copy/Paste.** From `phase-11.md` ("Copy/Paste for
   SAS Content items"). Cut already works (ADR-0032). Probe whether the
   Folders/Files services can copy a member server-side. If not, copy is
   read-then-create, which is real extra work. Decide which after the probe.
3. **13c — F6: a panel of common commands.** From `phase-11.md` (F6). A
   small view so users do not have to remember palette names. Design pass
   first: which commands earn a place (connect/disconnect, environment,
   snippets, Run File are the obvious ones) and where the view lives.
4. **13d — F11: a snippet library for common Viya patterns.** From
   `phase-11.md` (F11). Start with a candidate list (connection setup,
   common `PROC PYTHON` and `SAS` bridge idioms, 7d's data-exchange
   patterns) and keep only what a user would really reach for. Contributed
   as VS Code snippets unless a pattern needs live values, like 11b's
   command.
5. **13e — F10, decision: auto-display without an explicit file write.**
   From `phase-11.md` (F10), whose write-up has the whole mechanism: a
   project-owned cell runner that evaluates a trailing expression and
   flushes open matplotlib figures to files. It composes what reaches the
   interpreter, which
   [ADR-0014](../adr/0014-python-is-submitted-as-an-uploaded-file.md)
   forbids project-wide. **This slice decides**, with Sean, whether to amend
   ADR-0014 for the notebook and interactive-window path only, and writes
   the ADR either way. Account for 12j's ODS wrapper and 12m's startup
   snippet, which touch the same submission path. No build here.
6. **13f — F10, build.** If 13e says yes: the cell runner, dropping its
   wrapper frame from tracebacks, keeping its helpers out of the user's
   namespace, and collision-safe names for captured files (all listed in
   F10's write-up). If 13e says no, this slice closes with that decision
   recorded.
7. **13g — F8: a sortable DataFrame grid.** From `phase-11.md` (F8). Show
   a DataFrame produced during a run or in a cell in the existing ag-grid
   viewer (ADR-0028), with Sean's default cap of 100 rows × 20 columns,
   configurable. Its trigger depends on 13e/13f: F10's display step, if it
   exists, is the natural feed. Otherwise decide an explicit trigger.
8. **13h — F1, spike: a SQL-passthrough bridge for SAS libnames.** From
   `phase-11.md` (F1): intercepting Python calls against a SAS library and
   rewriting them as database passthrough, plus a UI to manage libname
   definitions. Architecture-level and, in Sean's words, "probably
   extremely complicated". A hands-on spike answering whether it can work
   and what it would cost. It ends in a go or no-go recommendation for
   Sean.
9. **13i — F1, build or decline.** Builds 13h's design if Sean says go.
   Otherwise it closes with the decision recorded, and F1 leaves the
   backlog on the record rather than silently.
10. **13j — An MCP tool that runs Python.** From 12c: running Python
    through `ExecutionBackend` is a different order of risk from reading
    metadata, so 12c kept it out of v1's tool surface as "a separate,
    separately reviewed follow-up". After 13m (12p until 2026-09-29).
    Needs its own ADR-0037 security review, and a decision on confirmation
    and on which workspaces may use it.
11. **13k — Polish.** Small items from `phase-11.md`, each needing a probe
    or a small design choice:
    - Progress during CSV export (11d, "Not built / carried": the row count
      is known but the notification is indeterminate).
    - A table's size on the CAS Table Properties panel (11d's manual pass).
      Probe whether CAS reports a byte size first.
    - A `pythonOnViya.*` setting to opt out of Pylance stub generation
      (10b's review, carried in `phase-11.md`).
    - F9 passthrough on a non-Snowflake connector and with a large result
      set, both untested (Finding 11.2). Probe if such a caslib exists;
      correct `docs/cas-python-connection.md` if the behaviour differs.
12. **13l — The MCP server for Claude Code (was 12o).** Moved from Phase
    12, 2026-09-29. **Already built, on the unmerged branch
    `feat/12o-mcp-server`**: a loopback-only MCP server in the extension
    host, off by default, trusted workspaces with a folder only, answering
    only a client holding a per-start secret read from a file. It has no
    tools. The design is `phase-12.md`'s Plan item 15 (12o), as amended by
    that branch's ADR-0042. What is left is finishing the pickup steps in
    this file's "12o and 12p moved here" Runbook entry, then its PR.
13. **13m — The MCP server's read-only tools (was 12p).** Moved from Phase
    12, 2026-09-29. Not started. The scope is unchanged from `phase-12.md`'s
    Plan item 16 (12p): the `LibraryAdapter` and `CasAdapter` browse-and-page
    operations 12c listed, each `readOnlyHint`, with ADR-0037's security
    review before its PR. Also weigh what the branch's ADR-0042 leaves to
    this slice: Claude Code connects to whatever program holds a registered
    port, without sending `Authorization` when its helper cannot run, so
    once tools exist a program on that port could offer Claude Code its own
    (probe (c) in the branch's "12o built" Runbook entry). After 13l.
14. **13o — The SAS Server view: review, scoping and probes.** Added
    2026-09-30 (Sean). Upstream's **SAS Server** view
    (`views.SAS.serverExplorer`, `RestServerAdapter.ts`) browses files on
    the SAS server itself rather than in SAS Content. Its root is set per
    profile (`fileNavigationRoot`: `USER`, `SYSTEM` or `CUSTOM`, with
    `fileNavigationCustomRootPath`), and an administrator can set it for
    everyone. Its context menu has create, delete, rename, copy path and
    download. This project has no such view. This slice reads upstream's
    implementation. It probes the endpoints the view would use: what serves
    the listing, how a root resolves, and what a Viya 4 deployment returns
    for each root setting. Then it writes the scope with Sean: which actions
    earn a place, whether it reuses 13a's upload and download, how it
    relates to the SAS Content view and to the compute session this
    extension already holds, and whether any of that is an architecture
    decision needing an ADR. No build here.
15. **13p — The SAS Server view: build.** Builds what 13o scoped. After 13o.

**Order.** 13a–13d are independent. 13f needs 13e; 13g needs 13e/13f;
13i needs 13h; 13m needs 13l; 13j needs 13m. 13k is independent. 13p needs
13o, and may reuse 13a's upload and download.

### Second execution backend (does not gate v1.0)

Only if warranted. The `ExecutionBackend` seam exists so this is additive. Revisit
native Python runtimes (SAS Workbench, batch/job execution) once real usage shows
where `PROC PYTHON` actually hurts.

---

## Runbook

### Punch list

- [ ] **13a — SAS Content upload/download.** Added 2026-09-24. Built
  2026-09-30 on `feat/13a-content-upload-download`, not yet merged. See
  "13a built" below.
- [ ] **13b — SAS Content Copy/Paste.** Added 2026-09-24. Not started.
  Probe server-side copy first.
- [ ] **13c — F6, common-commands panel.** Added 2026-09-24. Not started.
- [ ] **13d — F11, snippet library.** Added 2026-09-24. Not started.
- [ ] **13e — F10, the ADR-0014 decision.** Added 2026-09-24. Not started.
- [ ] **13f — F10, build (or closed by 13e).** Added 2026-09-24. Not started.
- [ ] **13g — F8, DataFrame grid.** Added 2026-09-24. Not started.
- [ ] **13h — F1, spike.** Added 2026-09-24. Not started.
- [ ] **13i — F1, build or decline.** Added 2026-09-24. Not started.
- [x] **13j — MCP tool that runs Python.** Added 2026-09-24. **Dropped
  2026-09-30**, never started. See "MCP server removed" below.
- [ ] **13k — Polish** (CSV progress, CAS table size, stub opt-out, F9
  checks). Added 2026-09-24. Not started.
- [x] **13l — The MCP server for Claude Code (was 12o).** Moved here
  2026-09-29. Built and parked on `feat/12o-mcp-server`. Picked up
  2026-09-30 on `feat/13l-mcp-server`; reviewed, and manual items
  13.6–13.13 passed. Merged 2026-09-30 as
  [PR #233](https://github.com/Shai-Alit/sas-py-vscode/pull/233), squash
  `5acb03a`. See "13l picked up" below. **Removed 2026-09-30**, before any
  release. See "MCP server removed" below.
- [x] **13m — The MCP server's read-only tools (was 12p).** Moved here
  2026-09-29. Built and reviewed 2026-09-30, never merged. **Dropped
  2026-09-30.** See "MCP server removed" below.
- [x] **13n — Output lost after a `SAS.submit()` graph.** Added 2026-09-30
  from v0.1.4's release smoke test. Every run turns SAS notes off
  ([ADR-0043](../adr/0043-every-run-turns-sas-notes-off.md)). See "13n
  built" below.
- [ ] **13o — The SAS Server view: review, scoping and probes.** Added
  2026-09-30. Not started.
- [ ] **13p — The SAS Server view: build.** Added 2026-09-30. Not started.

### Scope extended, 2026-09-24

Slices 13a–13k added by the backlog sweep recorded in `phase-12.md`'s
"Backlog sweep" Runbook entry, which has the full source-to-slice table and
the reasoning for which items came here rather than to Phase 12. The
second-execution-backend text is unchanged and still does not gate v1.0.

### 12o and 12p moved here, 2026-09-29

**Decision (Sean's).** Partway through 12o's manual pass, Sean decided the
MCP work is too much for Phase 12 and moved it here: 12o becomes 13l and
12p becomes 13m. Phase 12 goes on with 12n and 12q, and the preview release
that follows Phase 12 ships without the MCP server (`PRODUCTION_PLAN.md`
§8's 2026-09-29 amendment). Both slices still gate v1.0, as every Phase 13
slice does.

**Where the code is.** Branch `feat/12o-mcp-server`, commit `0506824`,
pushed 2026-09-29. It branches from `main` at `0ce7334` (12m's merge). No PR
was opened, so no CI or AI reviewer has run on it; CI runs only on PRs and
on pushes to `main`. The branch holds:

- `src/agent/`: `protocol.ts` (JSON-RPC), `guard.ts` (what a request must
  carry), `registration.ts` (the `claude mcp` line, quoted per shell),
  `headersFile.ts`, `server.ts` (`node:http`) and `agentServer.ts` (the VS
  Code side), wired in from `src/extension.ts`.
- Tests: `test/unit/agent-{protocol,guard,registration,headers-file,server}.test.ts`
  and `test/integration/agent/agentServer.test.ts`.
- The `pythonOnViya.agentServer.enabled` setting and the **Set Up Claude
  Code Access** command (`package.json`, `package.nls.json`), with
  `docs/reference/` updated.
- ADR-0042 (the server's design, amending 12o's plan text), an ADR-0003
  amendment for the two Node-only files, the `.c8rc.json` and
  `eslint.config.mjs` changes for them, and a `CHANGELOG.md` entry.
- User docs: a new `docs/claude-code.md` (in the VitePress nav) and
  `docs/agent-skill.md` updated.
- In that branch's `docs/phases/phase-12.md`: the "12o built" Runbook entry
  (probes, reviews, test list, Sean's four design calls) and a "Parked and
  moved to Phase 13" entry. Its manual items are in its
  `docs/dev/manual-tests/phase-12.md` under "12o".

**State when parked.** `npm run verify` and `npm run test:integration` were
green on the tree merged with 12m (2,096 unit, one pending; 549
integration). The adversarial review and ADR-0037's security review both
ran and are folded in. Manual items 12.41–12.44 passed; 12.45–12.48 (each
Windows shell's line, turning it off, a taken port, refusals) did not run.

**Pickup steps for 13l**, in order:

1. Rebase `feat/12o-mcp-server` onto `main`. Expect conflicts in
   `STATUS.md`, `docs/phases/phase-12.md`, `docs/dev/manual-tests/phase-12.md`,
   `CHANGELOG.md`, `package.json`, `package.nls.json` and
   `src/extension.ts`.
2. Move the branch's Phase 12 records here. Its "12o built" and "Parked"
   Runbook entries come into this file as 13l entries, and its `STATUS.md`
   paragraph and punch-list line become 13l's. `main`'s `phase-12.md`
   keeps only the "moved" notes.
3. Renumber its manual items. 12n claimed 12.41–12.48 on its own branch, so
   the "12o" section moves to `docs/dev/manual-tests/phase-13.md` with
   `13.x` numbers. Run all eight against a build of the rebased branch: the
   four that passed ran before the rebase.
4. Check that ADR-0042 is still free on `main`. If not, renumber it, as 12o
   already did once when 12m took ADR-0041. Change its "12o"/"12p" wording
   to 13l/13m.
5. Move its `CHANGELOG.md` entry to whatever section is unreleased at that
   point. It must not appear under the Phase 12 preview release.
6. Re-run the branch's probe (a) against the current Claude Code. The
   server speaks the legacy MCP protocol era only, because Claude Code
   2.1.245 sent nothing newer. If Claude Code has moved to the 2026-07-28
   stateless revision, that design call needs revisiting before merge.
7. Look into an observation from manual item 12.43. After running `claude`
   and `/mcp` in the setup terminal, Sean had to sign in to Claude Code in
   VS Code again. It may be unrelated.
8. `npm run verify` and `npm run test:integration`, then the pre-PR steps
   in `CLAUDE.md`. Both reviews are done, so the adversarial pass covers
   what the rebase and the steps above changed. Then the PR.

### 13l built, 2026-09-28 — a local MCP server for Claude Code, off by default

> Built as Phase 12's 12o on `feat/12o-mcp-server` and moved here
> 2026-09-30 from that branch's `phase-12.md`, with the slice names
> changed to 13l/13m and the manual items renumbered 12.41–12.48 →
> 13.6–13.13. Otherwise as written then.

**What it is.** An MCP server in the extension host that the Claude Code
command-line tool connects to over `127.0.0.1`
([ADR-0042](../adr/0042-a-local-mcp-server-for-claude-code.md)). It has no
tools; 13m adds the read-only ones. It is off by default. The setting
`pythonOnViya.agentServer.enabled` turns it on, and the command **Python on
Viya: Set Up Claude Code Access** offers to do so. It runs only in a trusted
workspace with a folder open. The code is in `src/agent/`: `protocol.ts`
(JSON-RPC), `guard.ts` (what a request must carry), `registration.ts` (the
command line), `headersFile.ts`, `server.ts` (`node:http`) and
`agentServer.ts` (the VS Code side).

**Sean's calls, 2026-09-28.** Four questions went to Sean before any code,
and he took the recommended option each time:

- A hand-written server for the legacy protocol era, not the MCP SDK.
- Off by default, behind a setting and the setup command.
- The secret in a file per server start, not in `SecretStorage`.
- An OS-assigned port, kept per workspace.

**Probes.** These are Claude Code and Windows behaviour, not Viya, so they
are recorded here and not as findings. Each ran on the developer's machine
against a throwaway local listener or registration, removed afterwards.

- **(a) What Claude Code sends.** Claude Code 2.1.245 was registered against
  a listener that logged each request and answered `400`. It sent one `POST`
  with a legacy `initialize` for `protocolVersion` `2025-11-25`, client
  capabilities `roots` and `elicitation`, and headers `Accept:
  application/json, text/event-stream`, `Content-Type: application/json`,
  `Host: 127.0.0.1:<port>` and `Authorization`. It sent no
  `MCP-Protocol-Version` and no `Origin`, and made no attempt at the
  2026-07-28 stateless revision. So the server speaks the legacy era only,
  and `guard.ts` refuses any `Origin`.
- **(b) How the helper runs.** A `headersHelper` that printed its parent
  process ran as `C:\Windows\system32\cmd.exe /d /s /c "<command>"`, though
  the user's `SHELL` was Git Bash. For a user-scope registration its working
  directory was the user's `.claude` folder. So the Windows helper is
  `type "<file>"`, quoted for `cmd.exe`. `type` on a quoted path with a space printed the JSON and
  exited `0`; on a missing file it printed nothing and exited `1`.
- **`add-json` and `remove`.** `claude mcp add-json` on a name already
  registered exits `1` with "already exists". `claude mcp remove` of a name
  not registered writes to stderr and exits `1`. So the line runs `remove`
  first, discards its stderr, and does not stop on its failure.
- **Quoting.** Each registration form was run through an npm-style
  `claude.cmd` shim, with a space in the helper's path. The Command Prompt,
  Windows PowerShell 5.1 (`cmd /c '…'`) and Git Bash forms each arrived as
  the one JSON argument they started as. Command Prompt carried on past the
  shim when chained with `&`. PowerShell 7 is not installed there. Its
  documentation says it passes arguments to `cmd.exe` and `.cmd` files the
  legacy way on Windows, which the `cmd /c` wrapper handles either way.
- **The storage ACL.** `workspaceStorage` inherits an ACL that admits the
  user, SYSTEM and Administrators only. A headers file written there on
  Windows gets the same.
- **(c) A folder Claude Code has not trusted.** Found during the security
  review. A `--scope local` registration was added in a folder whose Claude
  Code trust prompt had not been accepted, with a dummy listener on its
  port. `claude mcp list` (2.1.245) reported "headersHelper not run — this
  workspace has no persisted trust", then connected anyway. It sent
  `initialize`, `notifications/initialized`, `tools/list` and `GET /mcp`,
  none with `Authorization`. So Claude Code does not check which server
  holds a registered port. Manual item 13.11 records the trusted case, where
  the helper runs and fails because the file is gone. The registration was
  removed afterwards.

Claude Code's MCP documentation (fetched for 12b on 2026-09-22, and again
for 12o) says a `headersHelper` runs on every connection with a 10-second limit,
and runs again with one retry after a `401` or `403`. A `--scope local`
server's helper runs only once Claude Code's own trust prompt is accepted
for the folder. Manual items 13.8 and 13.9 check both with a real Claude
Code.

**Every reply waits for the request body.** The first `413` test failed
with `ECONNRESET` on Windows. A reply sent while the client is still sending
makes Node close the connection, and the client loses the status to the
reset. Draining the body with `Connection: close` still reset. So every
reply, refusals included, is now sent on the request's `end` event. A
refused or oversized body is read and discarded, bounded by the 30-second
request timeout. This matters most for `401`, which is what starts Claude
Code's retry after a reload.

**Plan text amended.** Plan item 15 and 12c's token design (`phase-12.md`) said the secret
is held in `SecretStorage` and served by a generated `headersHelper` script.
Nothing outside VS Code can read `SecretStorage`, so ADR-0042 amends both.
The secret is in memory and in a file, and the helper is a `type` or `cat`
command. 12c's port question is settled as an OS-assigned port kept in
`workspaceState`. ADR-0003 has an amendment for the two new Node-only files,
`server.ts` and `headersFile.ts`.

**Tests.** Unit: `agent-protocol`, `agent-guard`, `agent-registration`
(including a round trip through the C runtime's argument-splitting rules),
`agent-headers-file` and `agent-server`, which runs on a real loopback port.
`agentServer.ts` is excluded from coverage, like the other VS Code-facing
shells, and the integration tier covers it. The integration tests cover:

- start and stop as the setting, trust and folder change;
- a reused port with a new secret;
- a taken port, with its notice;
- a failed headers-file write;
- stale files cleared, and disposal during a start;
- a port that cannot be stored, and a start that throws, neither of which
  stops later starts and stops;
- a file a crash left behind, cleared while the server stays off;
- each branch of the setup command;
- the manifest entries.

`npx tsc`, ESLint and Prettier on the changed files, and the
`scripts/check-*.mjs` gates, are clean. The agent unit files pass (122, and
one POSIX-only case pending on Windows), with 100% coverage of the modules
under test. `npm run verify` is green (2,054 unit, one pending; coverage
96.6/96.1/96.52/96.6), as is `npm run test:integration` (546 passing).

**Adversarial review, 2026-09-28.** It found nothing blocking. Six of its
findings were real and are fixed on the branch:

- One failure could jam the start/stop queue. `refresh` now catches and
  logs, and a port that cannot be stored is a warning, not a failure.
- The listening server had no `'error'` listener. It now reports through
  `onError`. No loopback test can make a listening server emit one, so that
  listener is the one `c8 ignore` path.
- Node checks its time limits every 30 seconds by default, so the 10- and
  30-second limits could run to about 40 and 60. It now checks every
  second.
- Anything on the machine could flood the log with warnings, and every
  reload causes one refused request. Refusals are now logged at debug
  level, and manual item 13.13 sets that level first.
- The queue-failure path had no test. It has two now. The wiring in
  `registerAgentServer` stays with manual items 13.8, 13.11 and 13.12,
  because a fake `ExtensionContext` would register the command twice.
- The indent of probe (b) above.

**Sean's call:** **Turn On** stays global, so once it is on, every trusted
folder gets its own loopback socket and secret. A per-workspace switch could
not be turned off from Settings. The review's `vscode.window` cast matches
four other integration tests and was left. Its reload race, where the new
host might find the old port still bound, is a watch item for manual item
13.9.

**ADR-0037's security review, 2026-09-28,** against 12c's checklist. All
four items pass: loopback-only binding, a secret nothing network-visible
reveals, no operations exposed, and trust gating the start. Folded in:

- PowerShell also reads the curly single quotes U+2018 to U+201B as quotes
  (`about_Quoting_Rules`), and `powerShellQuote` doubled only `'`. A
  storage path holding one would have ended the string early. It now
  doubles all four. A new test pins that a path's `&`, `^` and `(` add
  nothing outside `cmd.exe`'s quoted regions.
- A file a crash left behind was cleared only by the next start. A refresh
  that leaves the server off now clears it too.
- The Windows ACL wording. The headers file has the same access as the rest
  of the user's VS Code data. The user, SYSTEM and Administrators is what
  the default location gives, not a guarantee.
- A remote window runs the server on the remote host, where VS Code may
  forward its port. ADR-0042 and the user page say so, and name
  `remote.portsAttributes`. `registerPortAttributesProvider`, which could
  stop the forwarding, is not in the stable API at VS Code 1.104.
- Probe (c) above. ADR-0042 records it as 13m's to weigh, since from 13m a
  program on the port could offer Claude Code its own tools.
- Settings Sync carries **Turn On** to the user's other machines. The user
  page says so.
- Manual item 13.8 now checks the bound address with `netstat`. 13.11
  records the trusted-folder case of probe (c), and checks that revoking
  trust stops the server.

Accepted: a fish user's line would mangle a path holding a backslash. That
is not injection, and no default storage path has one.

**Brought up to date with 12m, 2026-09-28.** 12m (PR #222) merged while
this branch was open and took ADR-0041 and manual items 12.33–12.40. This
slice's ADR became ADR-0042 and its manual items 12.41–12.48 (13.6–13.13
here). The two
slices share no source file; `package.json` and `package.nls.json` merged
without overlap. `npm run verify` is green on the merged tree (2,096 unit, one
pending; coverage 96.66/96.11/96.57/96.66), as is `npm run test:integration`
(549 passing).

### 13l parked, 2026-09-29

Sean's call, partway through the manual pass: the MCP work is too much for
Phase 12, so 12o and 12p move to Phase 13 as 13l and 13m. This branch was
committed as it stood and pushed, with no PR, so no CI or AI review ran on
it. The decision and the pickup steps are recorded on `main`, in the "12o
and 12p moved here" entry above.

State when parked:

- Built; `npm run verify` and `npm run test:integration` green on the tree
  merged with 12m (above). The adversarial review and ADR-0037's security
  review are done and folded in.
- Manual items 13.6–13.9 passed 2026-09-29. 13.10–13.13 were not run.
- During 13.8, Sean had to sign in to Claude Code in VS Code again after
  running `claude` and `/mcp` in the terminal. Not investigated; it may be
  unrelated to this server.
- 12n took manual items 12.41–12.48 on its own branch, so this slice's items
  needed new numbers when picked up (13.6–13.13, "13l picked up").

### 13l picked up, 2026-09-30

The pickup steps from "12o and 12p moved here", in order.

1. **Rebased.** `feat/13l-mcp-server` is a new branch from `main` at
   `6789cb0`, with the parked commit `0506824` cherry-picked onto it. The
   pushed `feat/12o-mcp-server` was not rebased, so it stays as the parked
   record and needs no force-push. The expected files conflicted, plus
   `docs/adr/README.md` and the generated `docs/reference/settings.md`,
   each because 12n or 13n had added a row in the same place.
   `src/extension.ts` merged cleanly.
2. **Records moved.** The branch's "12o built" and "Parked" entries are
   above as "13l built" and "13l parked". `main`'s `phase-12.md` keeps its
   "moved" notes. It also gets the branch's three notes that ADR-0042
   supersedes 12c's token design, its port question and plan item 15's
   `SecretStorage` wording, because a superseded claim is swept out in the
   change that supersedes it. `STATUS.md`'s Phase 13 paragraph and row, and
   the punch list above, carry 13l now.
3. **Manual items renumbered** 12.41–12.48 → 13.6–13.13, in
   `docs/dev/manual-tests/phase-13.md`, all unticked. All eight run against
   a build of this branch. 13.8 now notes the refused request from probe
   (a′) below.
4. **ADR-0042 kept its number.** It is still free on `main`: 13n took
   ADR-0043. Its wording, ADR-0003's amendment heading, and the source and
   test comments that named "12o built" or 12p now name 13l and 13m.
5. **`CHANGELOG.md`.** The entry is under `[Unreleased]` › Added, not under
   any released version.
6. **Probe (a′): Claude Code has changed.** The installed Claude Code is
   2.1.284, not 2.1.245. As in probe (a), it was registered with
   `--scope local` in a throwaway folder, with a static dummy
   `Authorization` header, and `claude mcp list` was run. The registration
   was removed afterwards. Two runs:
   - **Against a listener that logs and answers `400`.** The first request
     is now a modern `POST` of `server/discover`, with headers
     `MCP-Protocol-Version: 2026-07-28` and `Mcp-Method: server/discover`
     and client metadata in `params._meta`. On the `400` it sent the same
     legacy `initialize` for `2025-11-25` as 2.1.245, then `GET /mcp`.
     Still no `Origin`.
   - **Against this branch's own `startAgentServer`,** compiled and behind
     a logging proxy. `server/discover` drew `checkRequest`'s `400`
     "Unsupported MCP-Protocol-Version" (`text/plain`), `initialize` got
     `200` agreeing `2025-11-25`, `notifications/initialized` `202`,
     `GET /mcp` `405` and `tools/list` `200` with `[]`. `claude mcp list`
     showed it **connected**.

   **Documented:** the 2026-07-28 revision's versioning page ("Backward
   Compatibility with Initialization-Based Versions") has a dual-era
   client, over Streamable HTTP, fall back to `initialize` when a modern
   request draws a `4xx` without a recognized modern error body. That is
   what the probe saw.

   **Decision (Sean's, 2026-09-30): the server stays legacy-only.** It works
   through the documented fallback. Speaking the 2026-07-28 revision is left
   for later. ADR-0042's context, its rejected alternative and its
   consequences now say this. One new consequence: every connection from a
   current Claude Code starts with one refused request, logged at debug
   level. `protocol.ts`'s header comment says the same.
7. **The sign-in observation from 12.43 (now 13.8)** was not investigated
   this session. Nothing in `src/agent/` reads or writes Claude Code's
   sign-in. The only Claude Code state it touches is the MCP registration
   that the user's own pasted line changes. Re-running 13.8 will show
   whether the sign-in prompt comes back.
8. **Verify, 2026-09-30,** from a clean `out/`: `npm run verify`'s steps
   green (2,142 unit, one pending; coverage 96.36/96.22/96.2/96.36), with
   `format:check` run leaving out `.claude/worktrees/` as 13n did.
   `npm run test:integration` green (568 passing) and `npm run check:docs`
   green. **Not yet done:** the adversarial pass over what this pickup
   changed, and manual items 13.6–13.13. Then the PR.
9. **Review, 2026-09-30.** The pre-push adversarial pass (the developer's
   independent reviewer, reading `git diff --cached origin/main` without
   running the suite) found nothing blocking and left six notes. All six
   are addressed on the branch:
   - `removeHeadersFile`'s warning branch had no test. An integration case
     now points the storage directory at a regular file with the server
     off, so the listing fails and the warning is logged.
   - `isRebindable`'s `EACCES` case had no test: it cannot be caused
     portably on a real socket. `isRebindable` is now exported and
     unit-tested directly.
   - `wsl.exe` as a local Windows window's default shell gets a line that
     cannot work (the helper is Windows' `type "C:\…"`). Documented as
     unsupported in `docs/claude-code.md` and in `shellKindFor`'s comment,
     rather than refused in code.
   - A dispose during `start`'s port write could still show "Register
     Again". `start` now returns after that write when disposed; an
     integration case disposes from inside the write.
   - A failed write of `pythonOnViya.agentServer.enabled` (for example an
     unparseable user `settings.json`) escaped the setup command as VS
     Code's generic failure. It is now caught, logged, and shown as its
     own error, with a new `setting-not-saved` result and a test.
   - `extension.ts`'s comment said activation "reads one setting"; it now
     also names the listing of the storage directory.

   The reviewer also noted that the PowerShell `cmd /c '…'` wrapper rests
   on the 2026-09-28 manual runs, not on unit tests, so manual items for
   Windows PowerShell 5.1 and 7.x must pass before the PR is opened.

   **Verify after the fixes,** from a clean `out/`: `npm run verify`'s
   steps green (2,144 unit, one pending; coverage 96.36/96.23/96.2/96.36),
   `format:check` again leaving out `.claude/worktrees/`;
   `npm run test:integration` green (571 passing); `npm run check:docs`
   green.
10. **Manual items** 13.6–13.13 in `docs/dev/manual-tests/phase-13.md`.
    Sean ran all eight against a `.vsix` built from this branch with the
    review fixes on 2026-09-30, before the push, and all passed —
    including 13.10's Windows PowerShell 5.1 and 7.x lines.
11. **Merged** 2026-09-30 as
    [PR #233](https://github.com/Shai-Alit/sas-py-vscode/pull/233), squash
    `5acb03a`.

### 13n built, 2026-09-30

**What was wrong.** Sean ran a new release smoke test (`test/smoke/`)
against the installed v0.1.4. Run File printed nothing but the banner, and
a failing run showed only "Finished with an error." with no traceback and
no Problems entry. The probe found the cause (Finding 13.1). When the last
step a `SAS.submit()` runs is `PROC SGPLOT` or `PROC SGPANEL`, SAS types
the `PROC PYTHON` step's whole stdout and traceback `note`, and
`logFilter.ts` drops `note` lines. The smoke test's `PROC SGPLOT` check hid
every other check's output.

**The fix.** `runProgram`'s job saves the session's `NOTES` setting and
turns notes off after the syntax-check prefix, and restores the setting as
its last statement (`QUIET_NOTES_BEFORE` and `QUIET_NOTES_AFTER` in
`src/backend/procPython.ts`, ADR-0043). Under `NONOTES` the same lines
arrive `normal` (Finding 13.2). The filter is unchanged: keeping `note`
lines between the `>>>` markers would be the text scan Findings 52, 74 and
93 rule out. `reset()` and `probeRuntime()` are not wrapped.

**Tests.** The three job-layout tests in
`test/unit/proc-python-backend.test.ts` (no restart, restart, and the
startup-snippet job) now assert the new lines' positions. The existing
exact-array tests for `reset()` and `probeRuntime()` pass unchanged, which
shows neither is wrapped.

**Smoke test.** `test/smoke/` is new in this slice: `release_smoke.py`,
`release_smoke.ipynb`, `release_smoke_traceback.py`,
`release_smoke_cancel.py`, `release_smoke_sgplot.py` and a `README.md`.
Nothing in `npm test` reads it. `release_smoke_sgplot.py` is the
reproduction for this slice.

**Streaming check.** The 13n probes also saw a step's printed output arrive
only when the step ended, which contradicted `docs/running-python.md` and
the smoke test's own section 3. A dedicated probe settled it (Finding 13.3):
`PROC PYTHON` holds stdout until the step ends. The docs and the smoke test
that claimed line-by-line streaming were corrected in this slice. No source
change: `logStream.ts` streams whatever the log holds.

**Verify.** `npm run verify`'s steps green on 2026-09-30 (2,018 unit;
coverage 96.25/96.07/95.96/96.25). `format:check` was run with
`.claude/worktrees/` left out: an agent worktree there, excluded from git,
holds two fixtures Prettier flags.

**Review.** The pre-push adversarial pass (the developer's independent
reviewer, reading the source and test diffs, without running the suite)
found nothing blocking and left three notes:

- A cancel loses the session's `NOTES` setting for the rest of the session.
  Already in ADR-0043's consequences; that bullet now also says when it
  would matter and what would fix it. No code change (Sean's scope).
- No unit test covers the restore after an exception or a cancel. The job's
  code array is static, so a unit test cannot show either. Finding 13.2
  records both from the probe.
- `PYVIYA_NOTES` stays in the session's global scope. ADR-0043 now says so.

Reading the doc diffs afterwards found one wrong phrase: ADR-0038's and
ADR-0041's amendment notes, and ADR-0041's index row, said notes are turned
"back on". The job restores the session's setting, which may be `NONOTES`.
All three are corrected.

**Manual items** 13.1–13.5 in `docs/dev/manual-tests/phase-13.md`. Sean ran
all five against a `.vsix` built from this branch on 2026-09-30, before the
push, and all passed.

**Merged** 2026-09-30 as
[PR #230](https://github.com/Shai-Alit/sas-py-vscode/pull/230), squash
`4622508`. Released the same day in `v0.1.5` (release PR
[#231](https://github.com/Shai-Alit/sas-py-vscode/pull/231), squash
`ee2fa9e`), cut ahead of the rest of the phase because v0.1.4 users had no
workaround (Sean's call).

**Not reproduced.** Two things Sean saw on v0.1.4 did not recur on the
probe. A traceback stayed lost until a disconnect and reconnect: the probe
never saw the `note` typing outlast its job. A notebook cell's `SAS.show()`
output did not render: the server's ODS body and the sanitizer were both
fine. Each was during runs that the `note` typing had already hidden, so
both may be the same bug. Manual items 13.3 and 13.5 cover them.

### MCP server removed, 2026-09-30

Sean's call, during 13m's manual pass. The feature reached only the Claude
Code command line: a user registered it by hand with a `claude mcp` line and
ran `claude` in the folder. SAS already ships an official Viya MCP server.
Recorded in [ADR-0044](../adr/0044-the-mcp-server-for-claude-code-is-removed.md),
which supersedes ADR-0042.

- **Removed from `main`:** `src/agent/`, the
  `pythonOnViya.agentServer.enabled` setting, the **Set Up Claude Code
  Access** command, their unit and integration tests,
  `docs/claude-code.md` and its sidebar entry, the two reference-table rows,
  the ESLint and c8 entries, and the CHANGELOG's Unreleased lines. No
  release had any of it, so there is no migration.
- **13m** was built on `feat/13m-mcp-read-tools` and had its adversarial
  pass, but was never committed or pushed. Its work, including Findings
  13.4 and 13.5 (what a CAS `where=` evaluates), is kept only in a local
  `git stash` on Sean's machine. The branch is deleted.
- **13j** is dropped unstarted.
- **Kept:** the agent skill; ADR-0042 and the 13l entries above, as the
  record; the 13l manual items, marked retired.

**Verify, 2026-09-30,** from a clean `out/`: `npm run verify`'s steps green
(2,018 unit; coverage 96.25/96.07/95.96/96.25), `format:check` leaving out
`.claude/worktrees/`; `npm run check:docs` green; `npm run
test:integration` green (544 passing).

### Scope extended, 2026-09-30 — the SAS Server view

Sean's call, while 13a was being built: upstream's **SAS Server** view was
missed when this project's views were planned, and belongs in this phase.
Added as 13o and 13p (Plan items 14 and 15). Docs only; nothing is built
yet. 13o starts with a read of upstream's `RestServerAdapter.ts` and the
view's contribution in its `package.json`, then probes before any scope is
written. No wire behaviour of that view has been probed yet, and none is
claimed here.

### 13a built, 2026-09-30

**What it does.** Two new commands on the SAS Content view's right-click
menu. **Upload Files...** on a folder or My Folder picks local files and
creates each in the folder with its bytes. **Download...** on a file, a
folder or My Folder picks a local folder and writes the item into it,
folders recursively. Both run behind a cancellable notification, keep going
past a failed file, and end with a count. Upstream uploads folders too;
this slice uploads files only.

**Probes first.** Findings 13.6–13.8, against `verde`. `innov` did not
resolve that day, so none of the three is confirmed on Stable 2026.06.

**The code.**

- `src/content/adapter.ts`: `createFile` takes the file's bytes as an
  optional fourth argument and sends them in the create `POST` (Finding
  13.6). New File still sends none. A non-empty body gets a five-minute
  timeout. `downloadFileContent` is `readFileContent` with a 100 MiB cap
  (`MAX_TRANSFER_BYTES`, Finding 13.6's `maxFileSizeMB`) in place of the
  editor's 10 MiB.
- `src/content/transfer.ts` (new, `vscode`-free): `planDownload` walks a
  file or folder into folders to create and files to fetch. It leaves out
  and reports members that are not files (data flows), names that cannot be
  a Windows file name (a `\`, `:`, `..`, `CON`, a trailing dot), and a
  second sibling whose name differs only in case. The Windows rules apply on
  every platform, so a download behaves the same everywhere.
- `src/content/contentTransfer.ts` (new, the `vscode` shell): the dialogs,
  the local reads and writes through `vscode.workspace.fs`, the progress
  and the summary. An upload over 100 MiB is refused before it is sent,
  because the service answers one only with a connection reset (Finding
  13.7). A blocked-type refusal quotes the service's own sentence, which it
  sends in `message` rather than `details` (Finding 13.8). A download asks
  before replacing a local item of the same name.
- `package.json`: the two commands, hidden from the palette, in a new
  `3_transfer` menu group.

**Tests.** `test/unit/content-adapter.test.ts`: the bytes, media type and
timeout on an upload, an untyped extension, a blocked-type refusal, and the
download cap and timeout. `test/unit/content-transfer.test.ts` (new):
`isSafeLocalName` and `planDownload`.
`test/integration/content/transfer.test.ts` (new): both commands against a
stub adapter and a real temporary folder.

**Adversarial review, 2026-09-30,** before any push. Nothing blocking.
Folded in:

- **A cancel read as a finished job.** Cancelling after some files left
  the summary as `Uploaded 3 files…`. Both commands now track a cancel and
  say `Upload to "X" cancelled. 3 of 10 files were uploaded.` (or the
  download equivalent, with no **Show in Folder**). A download cancelled
  while its folders are still being listed says only that it was cancelled.
  The progress wrapper also aborts at once on a token that is already
  cancelled. Manual item 13.20 now expects the message, for both
  directions.
- **Untested error paths.** Integration tests now cover the too-large
  upload (a sparse local file just over the limit), more than one failure
  in each direction, a local folder that cannot be created and a local file
  that cannot be written (each made by putting a file or folder in the way),
  cancelling each direction partway and during the folder walk, and
  **Show in Folder**.
- **`exists()` swallowed every `stat` error.** It now answers "not there"
  only for `FileSystemError` `FileNotFound` and rethrows anything else,
  which the download reports as the chosen folder not being checkable.
- **The exact 100 MiB boundary is unprobed.** A file of exactly
  `MAX_TRANSFER_BYTES` is let through. The constant's comment now says
  Finding 13.7 saw 99 MiB accepted and 101 MiB reset, and nothing between.

**AI review on PR #235, 2026-09-30.** Three findings.

- **A folder reached twice vanished from the summary.** `planDownload`
  walked it once, as intended, but recorded nothing for its second path,
  so a download could say it finished while part of the tree was missing.
  The second path is now skipped with reason `already-listed`, and it is
  counted and logged like the other skips.
- **"Upload names a file percent-encoded" was not a bug.** `Uri.path` is
  the decoded path. Only `toString()` encodes. A new integration test
  uploads `My résumé 100%.py` through VS Code's own `Uri` and gets that
  name back unchanged.
- **"1 items were left out."** The download summary never used the
  singular, and the integration test asserted the plural for one item,
  against manual item 13.19's "1 item was left out". It now says "1 item
  was left out", and a second integration test checks the plural.

Not changed: the messages say "100 MB" for a 100 MiB limit, which only
errs toward refusing less; the progress bar's last increment lands as the
last file starts; and `planDownload`'s own unsafe-name check on the chosen
item, unreachable from `download()`, stays for other callers. **Follow-up,
not this slice:** in `createFile`, a cancel landing during `addMember` after
the server has linked the file makes the client delete the file resource,
which may leave a dangling member entry. New File has the same window;
uploads make it likelier.

**Not built.** Folder upload. Multi-select download. Reading a deployment's
own `maxFileSizeMB`, since whether an ordinary account may read it was not
probed. A deployment set below 100 MB resets the connection on a smaller
file, and the user sees "could not reach SAS Viya".

**Verify, 2026-09-30,** from a clean `out/`: `npm run verify`'s steps
green (2,036 unit; coverage 96.28/96.11/96.00/96.28; `transfer.ts` 100%),
`format:check` leaving out `.claude/worktrees/`; `npm run
test:integration` green (558 passing). After the review fixes:
the same steps green again (2,036 unit; coverage unchanged at
96.28/96.11/96.00/96.28; `contentTransfer.ts` is outside coverage scope),
and `npm run test:integration` green (567 passing).

**Manual items** 13.14–13.20 in `docs/dev/manual-tests/phase-13.md`,
all passed 2026-09-30 (Sean, against a `.vsix` built after the review
fixes).

---

## Probe findings

Numbered phase-scoped as `13.x` (`CLAUDE.md`'s 2026-09-09 rule), starting at
13.1; nothing here continues another phase's sequence. **13.4 and 13.5 are
reserved:** they were written for 13m, which never merged (see the "MCP
server removed" Runbook entry), and are cited by that name. The next new
finding is 13.9.

### Finding 13.1 — After a `SAS.submit()` graph, the step's stdout and traceback arrive typed `note` (2026-09-30)

**Documented:** nothing found. SAS's `PROC PYTHON` documentation does not
say how the log types a program's output; Findings 39 and 52 measured
stdout and the traceback as `normal`.

**Observed (Viya 4, the test deployment, 2026-09-30).** Throwaway sessions
with v0.1.4's job shape (recovery prefix, ODS wrapper, `PAGESIZE MAX`),
each deleted afterwards and read back as `404`:

- When the last step a `SAS.submit()` runs is `PROC SGPLOT` or
  `PROC SGPANEL`, **every** stdout line of that `PROC PYTHON` step arrives
  typed `note`, including lines printed before the submit. So does the
  traceback. The `ERROR: Unhandled Python exception.` line stays `error`,
  and `SYSCC` is still `1012`.
- A later SAS step inside the same `PROC PYTHON` step (`data _null_; run;`,
  `PROC MEANS`) puts the typing back to `normal`. A `%put` does not.
- The next job is not affected.
- Not triggered by `SAS.sd2df`, `SAS.df2sd`, `SAS.show`, `SAS.symput`,
  `SAS.symget`, `SAS.sasfnc`, `PROC PRINT`, `PROC MEANS`, a
  `PROC UNIVARIATE` histogram or `PROC REG` plots.
- The ODS wrapper, `LINESIZE`, `PAGESIZE MAX` and `ods listing close` make
  no difference.

**Not settled:** other `SG` procedures (`SGSCATTER`, `SGRENDER`), other
releases and deployments, and why these two procedures do it. Under
ADR-0043 none of these matters, since notes are off for every procedure.

### Finding 13.2 — With `options nonotes` around the step, the same lines arrive `normal` (2026-09-30)

**Documented:** the `NOTES` system option controls whether notes are
written to the log. Nothing found about its effect on `PROC PYTHON` output.

**Observed (same deployment and day, same throwaway-session method),**
with ADR-0043's lines around the step
(`%let PYVIYA_NOTES=%sysfunc(getoption(notes)); options nonotes;` after
the recovery prefix, `options &PYVIYA_NOTES;` last):

- `release_smoke.py`, as it stood that day, gives all 30 of its
  `[PASS]`/`[SKIP]`/`[LOOK]`/`===` lines typed `normal`, with no `FAIL`. A traceback after `PROC SGPLOT` arrives `normal`, with `SYSCC`
  `1012`. The same holds without a restart, and after `PROC SGPANEL`.
- The restore runs after a Python exception, and a session already set to
  `NONOTES` is still `NONOTES` afterwards.
- With a startup snippet step inside the wrapper (ADR-0041), the source echo
  of `%let PYVIYA_STARTCC=&syscc;` still arrives typed `source`. A snippet
  traceback after `PROC SGPLOT` arrives `normal`, `PYVIYA_STARTCC` is
  `1012`, `SYSCC` is `0`, and the user step's lines arrive `normal`.
- `SAS.hideLOG()` / `SAS.printLOG()` behave the same as with notes on.
- `SAS.logMessage()` at its default `NOTE` level writes nothing.
  `WARNING` and `ERROR` messages are still written.
- A `SAS.submit()` DATA step that fails on a missing input logs one extra
  line: `WARNING: Data set WORK._X was not replaced because this step was
  stopped.`, typed `warning`.
- `SAS.submit("options notes;")` followed by `PROC SGPLOT` brings the
  `note` typing back for that run.
- A job cancelled while `PROC PYTHON` runs (`PUT …/state?value=canceled`
  answered `200`, state `canceled`) never reaches the restore: the session
  reads `NONOTES` afterwards, and after the next completed run too.
- Nothing in `src/` reads a `note` line except `logFilter.ts`, which drops
  it (checked in the source, not probed).

**Not settled:** a cancel during the snippet step, and other deployments.

### Finding 13.3 — A `PROC PYTHON` step's stdout reaches the job log only when the step ends (2026-09-30)

**Documented:** nothing in SAS's `PROC PYTHON` documentation says when printed
output reaches the log. A WUSS 2025 paper on `PROC PYTHON` says print output
"will come out in one area at the bottom of the log", without timing it. This
project's own docs said the opposite: `docs/running-python.md` had stdout
streaming in "as it arrives, line by line", and `release_smoke.py`'s section 3
asked a tester to see its lines appear one at a time. No earlier finding
measured it. Finding 48 (`phase-2b.md`) timed the log's long poll against "a
job printing one line per second" but did not record the program. Its
one-line-per-poll arrivals match the DATA step control below, not
`PROC PYTHON`. The probes behind Findings 13.1 and 13.2 saw the same holding
back in passing and did not record it.

**Observed (Viya 4, the test deployment, Python 3.12.12, 2026-09-30).** Two
throwaway sessions on the SAS Studio compute context, each deleted afterwards
and read back as `404`. Each job's log was long-polled the way `logStream.ts`
polls it (`?start=<cursor>&limit=200&timeout=10`), and every line was
timestamped on arrival. Each Python program prints a line, sleeps 3 s, and
repeats five times, then prints `done`, with its own elapsed time in every line:

| Job | Printed at | Arrived at |
|---|---|---|
| A: inline `submit`/`endsubmit`, `flush=True` | +0, 3, 6, 9, 12, 15 s | all at +18.7 s, with the step's closing `NOTE` |
| B: v0.1.4's job shape (recovery prefix, ODS wrapper, `proc python restart infile=…; run;`), `flush=True` | the same | all at +17.2 s |
| E: as B without `restart` (a notebook cell's shape), plain `print` | the same | all at +15.4 s |
| D: as A, with a `SAS.submit()` DATA step after each print | the same | all at +15.3 s |
| C: control, `data _null_` with `put` and `sleep(3, 1)` | one line every 3 s | one line per poll, 3 s apart |

- During a `PROC PYTHON` step each poll either blocked its full 10 s and came
  back empty or was released only when the step ended. In C the same poll
  released on every new line. So the holding happens in `PROC PYTHON`, not in
  the log endpoint and not in the poll.
- `flush=True` (A, B, D) and a plain `print` (E) behave the same.
- In D, each `SAS.submit()` step's own log (its `source` echo, its `put`
  output typed `normal`, its `NOTE`s) arrived mid-step, 3 s apart. The Python
  `print` lines around it still arrived only at the end.
- Volume does not force an early flush. Three bursts of 300 lines, 5 s apart
  (about 85 KB), and 5,000 lines followed by an 8 s sleep (about 500 KB) both
  arrived entirely after the step ended.

These jobs ran without ADR-0043's `options nonotes` lines; the 13n probes saw
the same holding back with them.

**What this establishes.** A Run File's, or a notebook cell's, printed output
arrives in one piece when the program finishes, not line by line, and a long
run shows nothing from the program before then. `logStream.ts` does stream the
log; the lines are not in it until the step ends. Corrected in the same
change: `docs/running-python.md`, `docs/notebooks.md`, `docs/diagnostics.md`,
`docs/getting-started.md`, and in `test/smoke/` the section 3 check of
`release_smoke.py` and of the notebook, the notebook's interrupt instructions,
`release_smoke_cancel.py`'s header, and the README's table.

**Not settled:** whether the hold is per step or per `submit` block. A step
with two `submit` blocks could not show it, because the second block raised a
`NameError` for a name the first block defined; not pursued, since this
extension submits one `infile=` step. Also unsettled: output beyond about
500 KB, `stderr`, other releases and deployments, and why.

### Finding 13.6 — A file's bytes go in the create `POST`, and come back unchanged (2026-09-30)

**Documented:** the Files service's `POST /files/files` takes the file's
content as the request body, with its name in `Content-Disposition`.
Finding 6.4 created only empty files that way. Finding 6.2 noted in passing
that a raw body also returns `201`, without reading it back.

**Observed (`verde`, Viya 4 LTS 2026.03, 2026-09-30).** Read-only first:

- `GET /configuration/configurations?definitionName=sas.files` returned
  `maxFileSizeMB: 100`, `maxFileSize: 0` and `blockedTypes:
  "application/x-msdownload, application/x-ms-installer"`. Read with the
  developer's own token; whether an ordinary account may read it was not
  checked.
- `GET /types/types?filter=contains('extensions','<ext>')` resolves `.txt`
  and `.log` to `file_text` (`text/plain`), `.csv` to `file_csv`
  (`text/csv`), and `.json`, `.ipynb`, `.png`, `.jpg`, `.xlsx`, `.zip`,
  `.html`, `.sas7bdat` and `.exe` each to a `file_<ext>` type with its own
  media type (`.exe` to `application/x-msdownload`). `.md` and `.parquet`
  find nothing.

Then, approved by Sean, in a throwaway `probe13a-<ts>` folder under My
Folder, everything deleted afterwards and read back as `404`, with a sweep
finding nothing left:

- `POST /files/files?typeDefName=file_png`, `Content-Type: image/png`, a
  64 KiB body holding every byte value → `201`, `size: 65536`,
  `contentType: image/png`, an `ETag` header. `addMember` → `201`. `GET
  …/content` returned the same 65,536 bytes, with `Content-Type:
  image/png;charset=UTF-8`, `Content-Length: 65536` and
  `Content-Disposition: filename*=UTF-8''probe.png`. `HEAD …/content` gave
  the same length.
- `.md` with `typeDefName=file` and `Content-Type:
  application/octet-stream` → `201`, stored as `application/octet-stream`.

**What this establishes.** An upload is one create `POST` carrying the
bytes, then `addMember`: the same two calls as New File. The media type
recorded is the one sent, so the Types lookup's media type is the one to
send.

**Not settled:** Stable 2026.06 (`innov` did not resolve that day), text
encodings other than UTF-8, and whether an ordinary account can read
`sas.files`.

### Finding 13.7 — Past 100 MiB, the Files service resets the connection (2026-09-30)

**Documented:** `maxFileSizeMB` is the Files service's largest file.
Nothing found on how it refuses a larger one.

**Observed (`verde`, 2026-09-30).** Random bytes as `file_zip`, each
created file deleted and read back as `404`:

| Body | Result |
|---|---|
| 20 MiB | `201` in 1.9 s |
| 99 MiB (103,809,024 bytes, over 100 decimal MB) | `201` in 16.7 s |
| 101 MiB | the connection reset partway through the body; no HTTP status |

**What this establishes.** `maxFileSizeMB: 100` means 100 MiB, and a
client cannot tell a too-large upload from a network failure by the
response. So the extension checks the size before sending.

**Not settled:** where the reset comes from (the service or the ingress in
front of it), the exact boundary between 99 and 101 MiB, other deployments,
and a deployment configured below 100.

### Finding 13.8 — A blocked type is decided by the request's `Content-Type`, not the name (2026-09-30)

**Documented:** `blockedTypes` lists media types the Files service refuses.

**Observed (`verde`, 2026-09-30).** In the Finding 13.6 folder:

- `probe.exe` with `Content-Type: application/x-msdownload` → `400`,
  `errorCode 124007`, `message`: *The file "probe.exe" has a file type of
  "application/x-msdownload", which is blocked.* `details` held only the
  `path:` entry.
- The same bytes and name with `Content-Type: application/octet-stream`
  → `201`.

**What this establishes.** The service checks the media type it is sent.
The Types lookup sends `application/x-msdownload` for a `.exe`, so the
extension's upload is refused cleanly, and nothing tries to get around it.
The refusal's sentence is in `message`, which `readViyaError` keeps but
`localiseContentProblem` does not show, so the upload quotes it itself.

**Not settled:** `application/x-ms-installer` (`.msi`), and a deployment
with a different `blockedTypes`.
