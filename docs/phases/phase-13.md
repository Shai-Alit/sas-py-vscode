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
   snippets are the obvious ones) and where the view lives.
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

- [x] **13a — SAS Content upload/download.** Added 2026-09-24. Built
  2026-09-30 on `feat/13a-content-upload-download`. Merged 2026-10-01 as
  [PR #235](https://github.com/Shai-Alit/sas-py-vscode/pull/235), squash
  `ace92ea`. See "13a built" below.
- [x] **13b — SAS Content Copy/Paste.** Added 2026-09-24. Built
  2026-10-01 on `feat/13b-content-copy-paste`
  ([ADR-0045](../adr/0045-content-copy-paste.md)). Merged 2026-10-01 as
  [PR #236](https://github.com/Shai-Alit/sas-py-vscode/pull/236), squash
  `c5c2512`. See "13b built" below.
- [ ] **13c — F6, common-commands panel.** Added 2026-09-24. Built
  2026-10-02 on `feat/13c-commands-panel`: a state-aware **Commands** view,
  first in the sidebar (manual items 13.75–13.80). See "13c built" below.
- [ ] **13d — F11, snippet library.** Added 2026-09-24. Not started.
- [x] **13e — F10, the ADR-0014 decision.** Added 2026-09-24. Decided
  2026-10-01: a notebook cell displays its last expression and its open
  figures ([ADR-0046](../adr/0046-notebook-cells-display-their-result.md),
  Findings 13.13–13.15). See "13e decided" below.
- [x] **13f — F10, build.** Added 2026-09-24. Built 2026-10-01 on
  `feat/13f-cell-display`: the cell runner, the figure flush,
  `displayResults` on `ExecuteOptions`, and dropping the runner's traceback
  frames (ADR-0046, Findings 13.16–13.19). Merged 2026-10-01 as
  [PR #238](https://github.com/Shai-Alit/sas-py-vscode/pull/238), squash
  `e42decb`. See "13f built" below.
- [x] **13g — F8, DataFrame grid.** Added 2026-09-24. Built 2026-10-01 on
  `feat/13g-dataframe-grid`: a trailing DataFrame shows as a sortable grid
  inline in a notebook or interactive-window cell, from a payload the cell
  runner writes (ADR-0048, Finding 13.35). Review answered and manual
  items 13.63–13.74 passed. Merged 2026-10-01 as
  [PR #241](https://github.com/Shai-Alit/sas-py-vscode/pull/241), squash
  `a8a6365`. See "13g built" below.
- [x] **13h — F1, spike.** Added 2026-09-24. Done 2026-10-01 on
  `docs/13h-f1-spike` (Findings 13.36–13.41). Recommends declining F1 as
  written and building a native-SQL snippet command in 13i. Merged
  2026-10-01 as [PR #242](https://github.com/Shai-Alit/sas-py-vscode/pull/242),
  squash `13a77ab`. See "13h done" below.
- [x] **13i — F1, build or decline.** Added 2026-09-24. **Moved to Phase
  14 on 2026-10-01**, unstarted, and no longer gates 1.0. See "F1 moved to
  Phase 14" below.
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
- [x] **13o — The SAS Server view: review, scoping and probes.** Added
  2026-09-30. Done 2026-10-01: upstream read, Findings 13.20–13.26, scope
  agreed with Sean. Merged with 13p-i, the code
  that relies on it. See "13o done" below.
- [x] **13p — The SAS Server view: build.** Added 2026-09-30. Split by 13o
  into two slices, both merged:
  - [x] **13p-i — The view, read-only, plus open and save.**
    [ADR-0047](../adr/0047-sas-server-view-composes-file-paths.md), root
    settings, the tree, open/save, Copy Path. Built 2026-10-01 on
    `feat/13p-i-server-view`; merged 2026-10-01 as [PR #239](https://github.com/Shai-Alit/sas-py-vscode/pull/239),
    squash `902f455`; manual items 13.43–13.52 passed
    2026-10-01; adversarial review answered; manual item 13.53, which it
    added, passed 2026-10-01. See "13p-i built" below.
  - [x] **13p-ii — Changing files.** New File/Folder, Rename, Move, Delete,
    Upload/Download. Built 2026-10-01 on `feat/13p-ii-server-changes`
    (Findings 13.30–13.34, manual items 13.54–13.62). Merged 2026-10-01 as
    [PR #240](https://github.com/Shai-Alit/sas-py-vscode/pull/240), squash
    `453cb84`. See "13p-ii built" below.

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

**AI review on PR #235, 2026-09-30.** Four findings.

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
- **A download of a folder tree with no files ended silently.** Its folders
  were created, but no summary appeared and there was no **Show in
  Folder**. It now says the item has no files, so only its folders were
  created, and offers **Show in Folder**.

Not changed: the messages say "100 MB" for a 100 MiB limit, which only
errs toward refusing less; the progress bar's last increment lands as the
last file starts; and `planDownload`'s own unsafe-name check on the chosen
item, unreachable from `download()`, stays for other callers. **Follow-up,
not this slice:** in `createFile`, a cancel landing during `addMember` after
the server has linked the file makes the client delete the file resource,
which may leave a dangling member entry. New File has the same window;
uploads make it likelier.

**AI review on PR #235, second round, 2026-09-30.** Three findings, none
blocking. All are fixed in one commit, with the gaps a read ahead of the
next round turned up.

- **Download... was offered in the Recycle Bin.** The menu rule matched
  `.recycled` items, which nothing documented and no probe covered.
  Upstream does not offer it there: its `SAS.content.downloadResource`
  rule needs the `update` or `createChild` action
  ([`package.json`](https://github.com/sassoftware/vscode-sas-extension/blob/009bc9a380de51649100bd67e8c15ea6beb7a8e8/package.json#L1023-L1027)),
  and `ContextMenuProvider` gives a recycled item neither
  ([`utils.ts`](https://github.com/sassoftware/vscode-sas-extension/blob/009bc9a380de51649100bd67e8c15ea6beb7a8e8/client/src/components/ContentNavigator/utils.ts#L213-L216)).
  The rule now leaves recycled items out, and the user guide says to
  restore an item first.
- **The folder-cycle guard relied on an href without saying so.** A comment
  in `planDownload` now says why every folder has one: a listed member
  through `uri`, and a delegate or root folder through its `self` link.
- **A cancel during folder creation still made the folders.** The loop now
  checks for a cancel before each folder and stops before the next one. A
  folder already being created is finished, since `createDirectory` cannot
  be aborted. A cancel that lands before the first folder creates nothing,
  and the message says only that the download was cancelled.

Also fixed:

- **Download... on a data flow** planned nothing but its own skip, then said
  it downloaded 0 files and offered a **Show in Folder** with nothing to
  show. `isDownloadable` in `transfer.ts` now refuses anything but a folder
  or a file with a resource address, before any dialog.
- **A local folder that could not be created** gave "Downloaded 0 of N
  files… Could not download…", because the file count was set before the
  folders existed. It is now set only after they do.
- **A download with a failed file** dropped the "items were left out"
  count. The error and cancel summaries now add it too.
- **Cancelling a single file** said "0 of 1 files were uploaded" (or
  downloaded). With one file it now says only that it was cancelled.
- **Unreachable code.** The upload's silent return when nothing was
  uploaded, failed or cancelled could not be reached, and is gone.
- **`COM¹`–`COM³` and `LPT¹`–`LPT³`** are Windows device names too, per
  Microsoft's "Naming Files, Paths, and Namespaces". `isSafeLocalName` now
  refuses them.
- **Reports and jobs** in a folder are filtered out of the listing, so a
  download never sees them. The `transfer.ts` header and the user guide now
  say so.

Tests: unit, `isDownloadable` and the superscript device names;
integration, the data-flow refusal, the left-out count beside a failure
and on a cancel, a cancel before folder creation, and a single-file cancel
each way. The test of a local folder that cannot be created now plans two
files and a data flow, so it fails against a count taken too early. Manual
item 13.21 covers the Recycle Bin menu and the data-flow refusal.

**Adversarial review of these fixes, 2026-09-30,** before the push.
Nothing blocking. Folded in: the folder-creation test, which with one file
passed against the old code too; the left-out count on a cancel; the
cancel wording; and the upstream citation.

The "Not changed" list and the follow-up above stand. **Follow-up, not
this slice:** **Download...** still shows on a data flow and is then
refused, because leaves that are not files share the `sasContent:file`
context value. Hiding it needs a context value of their own, which every
content menu rule would then have to account for.

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
and `npm run test:integration` green (567 passing). After the second
round, from a clean `out/`: prettier and ESLint on the touched files,
`npm run typecheck` and `npm run coverage` green (2,038 unit; coverage
96.28/96.12/96.00/96.28; `transfer.ts` 100%), and the integration tests
green (575 passing). After the adversarial review's fixes, which touch no
unit-tier code: the same file checks, `npm run typecheck` and the
integration tests green again (575 passing).

**Manual items** 13.14–13.20 in `docs/dev/manual-tests/phase-13.md`,
all passed 2026-09-30 (Sean, against a `.vsix` built after the review
fixes). 13.21, added in the second review round, passed 2026-10-01
(Sean, against a `.vsix` built after that round's fixes).

**AI review on PR #235, third round, 2026-10-01.** One finding, not
blocking, and not fixed in the PR (Sean's call). **Follow-up, not this
slice:** after a failed call, the transfer commands read `signal.aborted`
to tell a cancel from a failure. A genuine failure that lands as the user
clicks **Cancel** is reported as a cancel, and its technical sentence
never reaches the log. Three checks follow a failed call: an upload's
create, a download's plan and a download's fetch. The checks before a call
starts are not affected. The outcome is still right either way: the
transfer stops and reports how far it got. The reviewer suggested a
failure that says itself it was aborted, but `ContentFailure.reason` is
free text, and the content client reports an abort as
`content-unreachable`, the same as a host it cannot reach. Only the
integration tests' `abortedResult` stub writes `"aborted"` there. A fix
needs the client to mark an abort itself, which every content caller
would then see.

**Merged** 2026-10-01 as
[PR #235](https://github.com/Shai-Alit/sas-py-vscode/pull/235), squash
`ace92ea`.

### 13b built, 2026-10-01

**What it does.** A **Copy** command on the SAS Content view's right-click
menu, beside **Cut**. **Paste** on a folder or My Folder then copies the
item there. A file is copied on the server. A folder is copied with
everything below it. Data flows are left out and counted, as a download
leaves them out. When the target already has an item of that name, the
copy is named `{base}_Copy{n}{ext}`, so a paste into the item's own folder
works. A folder copy runs behind a cancellable notification, keeps going
past a failed file, and ends with a count.

**Probes first.** Findings 13.9 and 13.10, against `verde`. Sean approved
the mutating probe. `innov` did not resolve, so neither finding is
confirmed on Stable 2026.06.

**Decisions (Sean's, 2026-10-01, after the probe),** recorded as
[ADR-0045](../adr/0045-content-copy-paste.md), which amends ADR-0032:

- Folders are copied too, by recreating them, since the Folders service has
  no copy (Finding 13.10).
- A taken name gets upstream's `{base}_Copy{n}{ext}`, with no prompt and no
  overwrite.
- Copy shares Cut's one clipboard slot. A copy stays after a paste, and a
  cut is cleared by its paste.

**The code.**

- `src/content/adapter.ts`: `copyFile` reads the file resource for its
  `copyFile` link, then `POST`s it with `?parentFolderUri=` and the name in
  `Content-Disposition` (Finding 13.9). It returns the new file's address.
  It uses the bulk transfer timeout, since a large copy's duration was not
  probed. `types.ts` gains `COPY_FILE_REL`.
- `src/content/copy.ts` (new, `vscode`-free): `freeCopyName`, `isCopyable`,
  `copyObjection`, and `copyItem`. `copyItem` lists the target for a free
  name, lists the whole source before creating anything, then makes the
  folders and copies the files.
- `src/content/contentCopy.ts` (new, the shell): progress, the log, the
  summary, and revealing the copy. It reuses 13a's `withTransferProgress`
  (now generic, returning the work's value), `transferProblemMessage` and
  `withLeftOut`, now exported from `contentTransfer.ts`.
- `src/content/contentCommands.ts`: the clipboard holds a mode. There is a
  new `copy` command, and `paste` sends a copied item to `pasteCopy`. The
  slot's names changed: `clearContentClipboard`, and the context key
  `pythonOnViya.hasContentClipboard`.
- `reportNoTarget` moved to `messages.ts`, so `contentCommands.ts` →
  `contentCopy.ts` → `contentTransfer.ts` has no import cycle.
  `contentMove.ts` exports `canReceiveMembers`, the target check move and
  copy now share.
- `package.json`: the command, hidden from the palette, at `7_modify@4`
  between Cut and Paste.

**Tests.** `test/unit/content-copy.test.ts` (new) runs the real adapter
against a scripted Folders/Files service. It covers names, objections, a
file and a folder copy, every failure and every cancel point (`copy.ts`
100%). `test/unit/content-adapter.test.ts` adds `copyFile`'s wire shape and
failures. `test/integration/content/copyPaste.test.ts` (new) covers the
clipboard and every message. `cutPaste.test.ts` and `explorer.test.ts`
follow the renamed slot and the third menu entry.

**Verify, 2026-10-01,** from a clean `out/`, after the review fixes below:
`npm run verify`'s steps green (2,082 unit; coverage
96.34/96.23/96.09/96.34; `copy.ts` 100%), with
`format:check` leaving out the gitignored `.claude/worktrees/`. `npm run
test:integration` is green (593 passing).

**Adversarial review, 2026-10-01** (the manual pass, not a PR review): no
blocking findings. Five minor ones, each checked against the code and
handled:

- Two quick Pastes of one copy into one folder could both choose the same
  free name, and the second failed. Now `copyItem` retries the copy's own
  file or folder once under the next free name, when the service refused it
  and a fresh listing shows the name taken (ADR-0045 decision 4). A raced
  folder create is refused `409`, and two folders of one name never exist
  (Finding 13.11, probed after the review). A call with no answer is not
  retried, since it may have copied.
- `copyFile` joined `?parentFolderUri=` onto the link blindly. It now uses
  `&` when the link already has a query. The probed link has none.
- **Copy** shows on a data flow and on a top-level folder and then refuses.
  Documented in `browsing-sas-content.md` and ADR-0045 rather than giving
  them their own context value, which would touch every file and folder
  menu entry.
- A cancel during a single file's copy call may not stop the copy. Cosmetic,
  as for an upload; documented in `browsing-sas-content.md` and ADR-0045,
  and 13.28's expectation allows for it.
- ADR-0032's body still used the slot's old names. Swept, with a note of
  the rename.

Seven unit tests were added (six for the retry, one for the query join).
The manual items were rewritten with an exact starting tree, exact counts
and exact messages, and 13.29 (two pastes at once) was added.

**Manual items** 13.22–13.29 in `docs/dev/manual-tests/phase-13.md`
passed, 2026-10-01, against a `.vsix` built from this branch. On 13.27 a
paste directly into `Public` worked. That is intended: Viya lets any
signed-in user add there (Finding 13.12).

**Not built.** Multi-select Copy. Copying a favourite from under My
Favorites, which Cut refuses too. **Copy** still shows on a data flow and
is then refused, for the reason **Download...** does (the 13a follow-up),
and on a top-level folder, which Cut refuses too.

**Merged** 2026-10-01 as
[PR #236](https://github.com/Shai-Alit/sas-py-vscode/pull/236), squash
`c5c2512`, with every check passing. Codex and the Claude reviewer found
nothing to fix. The Claude reviewer's one flag, two Pastes of one copy into
one folder at once, is the race `copyItem`'s single retry covers (ADR-0045
decision 4, Finding 13.11), and manual item 13.29 passed on it.

### 13e decided, 2026-10-01

F10 (a notebook cell shows a trailing value and an open plot, the way
Jupyter does) needed a decision against ADR-0014 before 13f could build it.
Decided as [ADR-0046](../adr/0046-notebook-cells-display-their-result.md).
Docs only: the ADR, Findings 13.13–13.15, and amendment notes on ADR-0014,
ADR-0015 and ADR-0041.

**Probes first.** Findings 13.13–13.15, against `verde`, in one throwaway
session that Sean approved, deleted afterwards and read back as `404`. They
settled the three questions the design rested on: whether open figures
survive into a later step and can be saved there (they do), whether a later
step's failure changes the user's `SYSCC` (it does, unless `SYSCC` is saved
and restored around it), and what a runner that compiles the user's file
does to the namespace and to tracebacks.

**Sean's decisions,** 2026-10-01:

1. **Figures and the trailing expression,** not figures only. The trailing
   expression needs a runner between `PROC PYTHON` and the user's file,
   which is why ADR-0046 amends ADR-0014.
2. **Notebook and interactive-window cells only.** Run File and Run
   Selection keep today's job exactly. A script that saves a figure and
   leaves it open would otherwise show it twice.

**For 13f.** ADR-0046's decision points 1–7 are the build. Its
decision points and Consequences name what 13f still decides or documents:
how the user's frame is mapped once the runner relabels it (point 7: teach
the mapper the cell's fileref name, or compile with `filename="<string>"`),
how the runner and the flush learn the run's id (point 6), passing the
module's `__future__` flags to the trailing expression's `compile()`
(point 3), the trailing
semicolon, the display order for objects with both `_repr_html_` and
`_repr_png_`, the fixed fileref and macro variable names, the double display
of a figure saved and left open (`docs/notebooks.md`), and a manual pass
that covers seaborn and pandas plotting, which no probe did. 13g's
DataFrame grid takes the trailing expression as its trigger.

### 13f built, 2026-10-01

**What it does.** A notebook or interactive-window cell now shows its
trailing expression's value and its open matplotlib figures, as a Jupyter
cell does. A value with `_repr_html_` shows as HTML, then `_repr_png_` as
an image, and anything else as its `repr()`. A trailing `;` hides it. Each
open figure is saved as a PNG after the cell and closed. Run File and Run
Selection are unchanged.

**Probes first.** Findings 13.16–13.19, against `verde`, in throwaway
sessions Sean approved, each deleted afterwards (`204`) and read back as
`404`. They ran the runner and flush end to end, measured `SYSCC` in all
four pass/fail combinations, checked where the log can be split, and found
that a relative output path breaks after the cell calls `os.chdir`.

**What 13f decided** (ADR-0046's open points, recorded in the ADR's "Resolved
in 13f" section):

- The runner compiles the cell under the name `<string>`, so
  `tracebackDiagnostics.ts` maps the user's frame unchanged. It parses with
  `compile(..., ast.PyCF_ONLY_AST)`, so a syntax error gains no `ast.py`
  frame (Finding 13.16).
- The job passes the cell file's absolute path, from
  `%sysfunc(pathname())`, in `PYVIYA_CELL` (Finding 13.19). The run's id
  is that file's own name, the last part of the path (`PY000001` in
  Finding 13.16). Output is named `pyviya_<fileref>_out.html` or `.png`,
  and `pyviya_<fileref>_plot001.png` onward.
- The fixed names are `PYVRUN`, `PYVFLUSH`, `PYVIYA_CELL`, `PYVIYA_USERCC`
  and `PYVIYA_FLUSHCC`.
- The trailing `;` is read from the source after the expression's end.

**The code.**

- `src/backend/cellRunner.ts` (new, `vscode`-free): the runner and flush
  sources, the job statements, `FIGURE_FLUSH_STEP` with the `SYSCC` save
  and restore (Finding 13.17), and `isFlushBoundary` (Finding 13.18).
- `src/backend/procPython.ts`: with `displayResults`, `runProgram` uploads
  both helpers once per connection (re-attach rewrites them in place, as
  for `PYVSTART`). The user's step becomes the runner's plus the flush's.
  The flush's log lines are kept apart after its boundary, and its result is
  read only when that boundary was seen. A failed flush adds one line to the
  output and logs the details. A helper upload that fails runs the cell
  plainly and logs why; only a cancel or a lost session fails the cell.
  `parseTraceback` drops the runner's two frames, only when both are there
  in order. `uploadStartup`'s fileref logic is now shared as
  `uploadFixedFileref`, and `readStartupResult` became `readStepResult`
  for both steps.
- `src/backend/backend.ts`: `ExecuteOptions.displayResults`.
  `notebookController.ts` passes `true` (the interactive window runs
  through it); `run/commands.ts` passes `false`.

**Tests.** `test/unit/proc-python-backend.test.ts` gains a block of 22
tests: the exact job and uploaded bytes, upload once per connection, false
and absent unchanged, restart, the startup snippet, the flush's log kept out, a
drop among the flush's lines kept out, a failing flush reported after the
cell's traceback, both steps failing, a syntax error, the frame-dropping edge
cases, a missing boundary, a boundary before the snippet's, a printed copy
of the boundary, a failed `PYVIYA_FLUSHCC` read, each helper's upload
failing, retry, a lost session, a cancel during the upload, and re-attach.
The router gains `flushSyscc`, `heldFilerefs`, `assignReplyFor` and
`laterLogPages`.

**Docs.** `docs/notebooks.md`, `docs/faq.md` and `docs/troubleshooting.md`
no longer say a cell shows nothing without an explicit call.

**Adversarial review, 2026-10-01**, of the local branch: nothing
blocking; six minor findings, each checked against the code.

1. `SYSERRORTEXT` is not saved around the flush, so a SAS-side cell error
   followed by a failing flush reports the flush's text. **Accepted**
   (Sean's call). Fixing it needed a mutating probe of whether
   `SYSERRORTEXT` takes a `%let` and how `%superq` reads back, for a case
   that needs a cell failing in SAS and a figure failing to save. The
   cell's own `ERROR` line still shows. `FIGURE_FLUSH_STEP`'s comment says
   so.
2. A dropped-lines notice after the flush's boundary still reached the
   cell's output. **Fixed:** it is kept apart with the flush's lines, and
   a test covers it (checked to fail without the fix).
3. A `_repr_html_` or `_repr_png_` that raised was skipped silently.
   **Fixed:** one `stderr` line names it. A local check of the first
   version found that it also reported a merely missing `_repr_png_`,
   which nearly every value lacks, and a class value, whose repr methods
   need an instance. A missing method is now skipped silently, and a class
   goes straight to `repr()`, as in IPython.
4. A failed flush's line came before the cell's traceback. **Fixed:** it
   now comes after, and the both-fail test asserts the order.
5. `isFlushBoundary`'s `?? ""` fallback would have matched every echo if
   the step were reordered. **Fixed:** `FLUSH_BOUNDARY_STATEMENT` is the
   one constant both use.
6. `%sysfunc(pathname())` is not macro-quoted. **Accepted:** the server
   chooses that path. A quoting function is a change that would need its
   own probe of `SAS.symget`. `cellRunnerStatements`'s comment says so.

At the reviewer's request, manual items 13.41 (`from __future__`) and
13.42 (a raising `_repr_html_`) were added. Items 13.31 and 13.37 already
cover a trailing `;` and `os.chdir`.

`npm run verify` green with the fixes folded in: 2104 unit tests, coverage
96.39/96.27/96.13/96.39 (statements/branches/functions/lines).

**Manual pass, 2026-10-01:** items 13.30–13.42 all passed. `verde` has no
seaborn, so 13.33's seaborn half could not run; its `df.plot` half passed.

**Merged** 2026-10-01 as
[PR #238](https://github.com/Shai-Alit/sas-py-vscode/pull/238), squash
`e42decb`, with every check passing. The first review round raised three
findings. Codex's one blocker, that the helpers were not re-uploaded after
a reconnect, was wrong on inspection: `backendCache.ts` builds a new
`ProcPythonBackend` for every new connection, so `cellHelpersUploaded`
starts `false` for each session, as `startupUploaded` does, and manual item
13.40 passed on that path. The Claude reviewer's two were fixed in one
commit: a `CHANGELOG.md` entry, and `cellRunner.ts`'s comment now says the
runner's name is in the cell's `globals()` while the cell runs. The second
round found nothing.

### 13o done, 2026-10-01 — the SAS Server view, scoped

**Upstream, read.** `RestServerAdapter.ts`, `ContentAdapterFactory.ts`,
`ContentNavigator/index.ts` and the view's `package.json` contribution
(`serverdataprovider`, commands `SAS.server.*`). The view reads the
**compute session's** `/compute/sessions/{id}/files/…` API, not the Files
service SAS Content uses. Expanding it calls `session.setup()`, so it starts
a session. It composes every URL itself, writing `/` as `~fs~`. It sends
the same root, `~fs~`, for `USER` and `SYSTEM`; only `CUSTOM` changes the
path. Administrators can override the profile's root through the compute
context's `fileNavigationRoot` and `fileNavigationCustomRootPath`
attributes, and gate Download with `allowDownload`. A `404` on a custom
root gets one of two messages, depending on who set the root. Delete and
rename send `If-Match: ""`. Favourites are a `TODO` upstream. Its context
menu: New File, New Folder, Rename, Delete, Copy Path, Download, Upload
Files, Upload Folders, plus drag-and-drop move.

**Probed.** Findings 13.20–13.26, `verde`, three runs, all approved by
Sean. Every session and scratch item was deleted and read back as `404`.

**Decisions (Sean's, 2026-10-01).**

1. **The view borrows the active profile's run session**, as the Library
   view does (ADR-0027). It never starts a session or signs anyone in.
   With no session, it shows a welcome with a Connect button. A listing
   does not wait behind a running job (Finding 13.23), so reads need no
   busy guard.
2. **A new ADR allows composing a session's files URL from a server
   path** ([ADR-0047](../adr/0047-sas-server-view-composes-file-paths.md)),
   encoded as Finding 13.22 describes. No link reaches `/` or a custom path
   (Finding 13.20), so without this the view could not be built. It is the
   project's third composed URL, after the two `src/compute/session.ts`
   names (ADR-0010). First agreed for the root only. **Widened the same
   day (Sean's call)** to an open file too: a file's own links name the
   session they were read from, so an editor could not save after a
   reconnect. The editor URI carries the profile id and the server path.
   Below the root, the tree still follows each item's links.
3. **Every upstream action is in**: browse and open/save; New File, New
   Folder, Rename, Move and Delete; Upload and Download.
4. **Split in two.** 13p-i: the ADR, root settings, the read-only tree,
   open/save, Copy Path. 13p-ii: everything that changes files.

**Where this departs from upstream, from the probes.**

- **A write sends the item's real `ETag`, never `""`.** An empty
  `If-Match` skips the server's check entirely, and deletes a non-empty
  folder with everything in it (Finding 13.26). A save that finds the file
  changed gets `412` and says so.
- **Every rename sends `If-Match`.** Without it the server answers `200`
  with an error body, and nothing is renamed (Finding 13.25). The reply's
  body is checked, not just its status.
- **`USER` and `SYSTEM` both root at `~fs~`, as upstream does.** On
  `verde` the session's `HOME` is `/` (Finding 13.21), so they are the same
  folder. The root's label follows upstream: **Home**, or a custom root's
  last path segment.

**13p-i's scope.**

- A **SAS Server** view in the existing container, shown with a profile.
- Profile fields `fileNavigationRoot` (`USER`/`SYSTEM`/`CUSTOM`, default
  `USER`) and `fileNavigationCustomRootPath`. The compute context's
  attributes override them when set. A `404` at a custom root says whether
  the profile or the administrator set it, as upstream does.
- A tree that pages by `next`, sorts folders first, and hides dot-files
  unless a `showHiddenItems` setting is on (Finding 13.22).
- Open and save through a `pythonOnViyaServer:` `FileSystemProvider`
  (ADR-0040), with the real `ETag` on save.
- **Copy Path**, and refresh and collapse-all on the view title.
- Refresh on `onDidChangeConnection` and on sign-out, as the Library view
  does.

**13p-ii's scope.** New File, New Folder, Rename and drag-and-drop Move
(one `PUT` with a new `path`, Finding 13.25), and Delete with a
confirmation that says it is permanent. Upload and Download reuse 13a by
generalising `src/content/transfer.ts`'s planner over an adapter interface
both views implement. Download is hidden when the context sets
`allowDownload` to `false`. **Probe first:** whether a create, rename or
delete waits behind a running job (Findings 13.23 and 13.27 measured reads
and a content write only).

### 13p-i built, 2026-10-01 — the SAS Server view, read-only, with open and save

**What it does.** A **SAS Server** view, below SAS Content, lists the
compute server's files through the active profile's session. One top
folder, **Home** (`/`), or a custom root labelled by its last segment,
expanded; folders first, then files, each by name. A click opens a file in
an editor through the `pythonOnViyaServer:` `FileSystemProvider`, and a
save writes it back. **Copy Path** is on the context menu. Refresh is on
the view title, and collapse-all comes from `showCollapseAll`. Dot-files
show only with the new setting `pythonOnViya.sasServer.showHiddenFiles`.
With no session, the view shows a **Connect** welcome.

**Profile.** `fileNavigationRoot` (`USER`, `SYSTEM` or `CUSTOM`) and
`fileNavigationCustomRootPath`, upstream's names, read strictly (a root
outside the three rejects the profile), kept on **Edit Connection
Profile**, and carried by **Import Connection Profiles**. A compute
context's attributes override them, read once per session by following the
context summary's `self` link to its detail (a summary has no
`attributes`, checked on `verde`).

**Code.** `src/server/`: `path.ts` (the root, the encoding, the one
composed URL, the editor URI), `types.ts`, `problems.ts`, `adapter.ts`,
`editorFiles.ts` (the save's `ETag` guard) (`vscode`-free); `messages.ts`, `serverTree.ts`, `serverFileSystem.ts`,
`serverExplorer.ts` (the shell, excluded from unit coverage as ADR-0009
requires). Wired in `src/extension.ts` beside the Library view. User page
`docs/browsing-sas-server.md`; profile fields in
`docs/connection-profiles.md`.

**Decisions made while building.**

- **The editor URI's query values are base64url.** `vscode.Uri`
  percent-decodes a query before `uri.query` returns it, so a file name's
  `&` or `+` would split the query or turn into a space. A hand-written
  profile's id is its name, which can hold anything too.
- **A save reads the file's properties first**, for its `createFile` link,
  and sends the `ETag` the editor's read returned, not the fresh one.
- **Open and save both use `application/octet-stream`**, as Finding
  13.24 measured, although the file's `getFile` and `createFile` links
  advertise `text/plain`.
- **The editor cap is 10 MiB**, SAS Content's.

**More probes**, approved by Sean, the same day: Findings 13.27–13.29.

**Not built.** Everything that changes files (13p-ii). Favourites and
folder shortcuts (upstream has neither working for this view). Run from the
tree's context menu: a server `.py` file runs from its editor like any
other, since Run is not gated by scheme.

**Adversarial review, 2026-10-01** (the local pass only; no other reviewer
has seen it). Nothing blocking. Seven findings, each checked against the
code, all real and all fixed before the push:

1. Open asked for the link's `text/plain`, not the `application/octet-stream`
   Finding 13.24 names. The probe had in fact read the same bytes back under
   `text/plain` too (now recorded in 13.24), so nothing was corrupted, but
   the code now matches the finding, and the test checks the header.
2. The save's `ETag` guard sat in the `FileSystemProvider`, which the unit
   tier cannot reach, with no test. It moved to `editorFiles.ts`, with
   `server-editor-files.test.ts`.
3. A tree node listed under one profile, expanded after a switch to another
   before the refresh, followed its links with the new profile's client. It
   now lists nothing until the refresh.
4. A folder past `MAX_MEMBER_PAGES` was cut short silently. The listing is
   now marked `truncated`, and the tree logs a warning.
5. The session check a `404` makes did not get the caller's signal. It does
   now.
6. A `CUSTOM` root of `/` showed the unlocalised `Home`. It now shows
   `l10n.t("Home")`, as `USER` and `SYSTEM` do.
7. `SESSION_SELF_REL` was also used for a context's `self` link; renamed
   `SELF_REL`.

**Verify, 2026-10-01,** after the review fixes, from a clean `out/`:
`npm run verify`'s steps green (2,149 unit; coverage 96.48/96.16/96.34/96.48), `format:check` leaving out
`.claude/worktrees/`; `npm run check:docs` green; `npm run
test:integration` green (593 passing). **Manual items** 13.43–13.52:
passed 2026-10-01. 13.49 first came back partial, and both parts were
the item's wording, not the code: it sent the reader to **Python on
Viya: Output** for the profile warning, which is written to the **Python
on Viya** log, and it did not say that refusing the only profile leaves
every view showing its *add a connection profile* message, as
`docs/connection-profiles.md` documents. The item was reworded and the
step passed on a re-run.

**Re-verified, 2026-10-01,** after reconciling with 13f's merge (the
renumbering below), from a clean `out/`: `npm run verify`'s steps green
(2,171 unit; coverage 96.52/96.2/96.37/96.52), `npm run check:docs` green,
`npm run test:integration` green (593 passing).

**Adversarial review, 2026-10-01** (Sean's pass, by hand, on the
uncommitted tree): no blocking defects. Three points, each checked
against the code:

1. **The save tag is per file, not per editor.** Real: any read, such as
   **Compare with Saved**, replaces the tag the next save sends, so the
   module's comment claimed more than it does. Reworded; VS Code's own
   `stat` check before a save is the protection then, and new manual item
   13.53 checks it; it passed 2026-10-01. A per-editor tag would need the vscode layer to track
   editors, a design change left out of this slice.
2. **An unprobed claim.** Real: `normaliseServerPath`'s comment said the
   server resolves `..`, which no finding shows. Reworded to say only
   that `..` is sent as written.
3. **One failed context read empties the view.** Deliberate and tested:
   the view shows an error rather than guess a root. Kept.

**Renumbered twice, 2026-10-01,** as slices merged to `main` while this
branch was open. 13e ([PR #237](https://github.com/Shai-Alit/sas-py-vscode/pull/237))
took ADR-0046 and Findings 13.13–13.15, so this branch's ADR became
ADR-0047 and its findings moved from 13.13–13.22 to 13.16–13.25. 13f
([PR #238](https://github.com/Shai-Alit/sas-py-vscode/pull/238)) then took
Findings 13.16–13.19 and manual items 13.30–13.42, so its findings moved
again, to 13.20–13.29, and its manual items from 13.30–13.40 to
13.43–13.53, everywhere they are cited.

**Merged** 2026-10-01 as [PR #239](https://github.com/Shai-Alit/sas-py-vscode/pull/239), squash
`902f455`, in one commit, with every check passing. Codex found nothing
blocking. The Claude reviewer's one finding was real: the slice had no
`CHANGELOG.md` entry, unlike its sibling slices. It was added in this
post-merge note on `main`.

### 13p-ii built, 2026-10-01 — the SAS Server view changes files

**What it does.** The SAS Server view's context menu gains **New Folder**,
**New File**, **Rename**, **Delete**, **Upload Files...** and
**Download...**, and a file or folder dragged onto a folder moves there.
Delete is permanent, behind a modal that says the server has no recycle
bin. The root is never renamed, moved or deleted, and a folder the
server marks `readOnly` (the root `/` among them) offers nothing that
creates in it. **Download...** is hidden when the compute context's
`allowDownload` attribute is `false`, as upstream reads it, and the command
checks again.

**Probed first**, approved by Sean, the same day: Findings 13.30–13.34.
Every scratch item and both sessions were deleted and read back as `404`.
Two results shaped the code: a rename's `200` can carry an error, and is
empty without `Accept` (13.32), so the reply's body is read; and a rename
without `path` moves the item into the session's working directory (13.32),
so `path` is always sent.

**Decisions (Sean's, 2026-10-01).**

1. **13a's whole transfer path is generalised, not just its planner.**
   `src/content/transfer.ts`'s planner is `planTreeDownload` over a
   `DownloadTree`, and `contentTransfer.ts`'s upload and download shell is
   `uploadFiles` and `downloadItem` over a `TransferEndpoint`. SAS Content's
   `upload`, `download` and `planDownload` keep their signatures as thin
   wrappers, so 13a's tests needed only `href` renamed to `source`.
2. **A failed upload deletes the empty file it made**, with the create's own
   `ETag`, so it removes only that file. If the delete fails too, the
   message says an empty file was left (`left-empty`). Upstream leaves it.
3. **Create entries are hidden on a `readOnly` folder.** A create in `/`
   fails with a `404` for a doubled `//` path (Finding 13.34). Rename and
   Delete stay on `readOnly` items, since on Unix they depend on the
   parent folder.
4. **A download walks at most 32 folders deep** (`too-deep`, left out and
   counted like any other skip). The listing does not say which folders are
   symbolic links, and links were not probed. SAS Content's downloads have
   no limit.

**Code.** `src/server/`: `move.ts` (the move rule and name check),
`transfer.ts` (the server's `DownloadTree`), and in `adapter.ts`
`createFolder`, `createFile` (with bytes), `rename`, `move`, `delete` and
`downloadFile` (`vscode`-free); `serverCommands.ts` and
`serverDragAndDrop.ts` (the shells, excluded from unit coverage as ADR-0009
requires). Every rename, move and delete reads the item's `ETag` from its
`self` link just before sending it. Uploads and downloads are capped at
100 MiB, SAS Content's limit, not the server's (Finding 13.34).

**Known gap.** An editor open on a file that is then renamed or moved still
points at the old path, so its save fails with *not available*. The user
page says to reopen the file.

**Tests.** Unit: `server-move.test.ts`, `server-transfer.test.ts`, and new
blocks in `server-adapter.test.ts`. Integration (new):
`test/integration/server/commands.test.ts`, the commands and drag-and-drop
shells with a stub adapter.

**Verify, 2026-10-01,** from a clean `out/`: `npm run verify`'s steps
green (2,221 unit; coverage 96.6/96.26/96.53/96.6), `format:check` leaving
out `.claude/worktrees/`; `npm run check:docs` green; `npm run
test:integration` green (618 passing).

**Review, 2026-10-01.** The pre-push adversarial pass (the developer's
independent reviewer, run against the local branch) found one finding worth
fixing and three minor ones. All four checked out on inspection; three were
fixed, one left as a note:

1. **A download of a folder whose listing was cut short reported success.**
   `transfer.ts` dropped `MemberListing.truncated`, so a folder past the
   adapter's page limit was downloaded in part with no word of it,
   contradicting the planner's own rule that a download missing an unknown
   part of the tree must say so. Fixed: `DownloadTree.listChildren` may now
   return `truncated`, and the planner reports such a folder as a new skip
   reason, `listing-truncated`, so the summary counts it and the log says
   the rest of the folder was left out. Unit-tested in
   `server-transfer.test.ts`; not manually testable without a folder past
   the page limit.
2. **Dragging a folder with something inside it showed a spurious error.**
   The folder moved first, taking the inner item with it, and the inner
   item's own move then failed on stale links. Fixed: `handleDrop` drops any
   dragged item whose folder is dragged with it (`isWithinServerPath`).
   Integration-tested, and added to manual test 13.57.
3. **Rename and Delete did not refuse the root themselves**; only the menu
   `when` clauses kept them off it. Fixed: both refuse a node with a
   `rootLabel`, as Download re-checks `allowDownload`. Integration-tested.
4. **A refused drop gives no feedback** (onto a file, the root's
   read-only folder, or the item's own folder). Left as is: it matches the
   SAS Content controller, and the reviewer raised it as a note. Treating a
   drop onto a file as a drop into its folder would be new behaviour, not a
   fix, so it was not taken up.

**Verify after the review's fixes, 2026-10-01,** from a clean `out/`:
typecheck and eslint on the touched files clean; `npm run test:unit` green
(2,222 passing); `npm run test:integration` green (621 passing). Coverage
was not re-run: the one new `vscode`-free branch is unit-tested.

**Manual pass, 2026-10-01.** Sean ran 13.54–13.62 against a `.vsix` built
from this branch; all passed except 13.57's step 5, where `Home` could
still be dragged. The code was right and the step was wrong: VS Code's
`TreeDragAndDropController` has no way to keep one item from starting a
drag, only to leave it out of the drag's data. `handleDrag` already leaves
the root out, so a drop of `Home` alone carries nothing and does nothing
(unit-tested: "drags everything but the root"). The step now drags `Home`
onto `made` and expects nothing to happen; the "or dragged" claim above and
in `serverDragAndDrop.ts`'s header was corrected to match. No code changed.
Sean re-ran the rewritten step the same day and it passed, so 13.57 and
every 13p-ii manual item is ticked.

### 13g built, 2026-10-01 — a trailing DataFrame is a sortable grid

**What it does.** A notebook or interactive-window cell whose last
expression is a pandas DataFrame shows it as a sortable grid, inline in the
cell, instead of 13f's static HTML table. Clicking a column header sorts
the rows shown. A summary line above the grid gives the rows and columns
shown out of the DataFrame's own. When rows were left out, it says
"sorting applies to the rows shown". **Change Presentation** offers pandas'
HTML, which is also what a saved `.ipynb` shows in Jupyter or on GitHub.
Two settings, `pythonOnViya.notebook.dataFrameGrid.maxRows` (default 100,
at most 5,000) and `.maxColumns` (default 20, at most 200), set the caps;
0 in either turns the grid off. A Series, a Styler and every other value
take 13f's path unchanged. Recorded in
[ADR-0048](../adr/0048-a-trailing-dataframe-is-a-sortable-grid.md), which
amends ADR-0046, ADR-0019 and ADR-0015.

**Sean's choices, 2026-10-01.**

- The grid sits inline in the cell, not in the data viewer panel.
- It shows first, with the HTML under Change Presentation.
- It covers notebook and interactive-window cells.
- Sorting is over the captured rows only, and the summary line says so,
  rather than re-querying the session.

**Probe.** Approved by Sean, the same day: Finding 13.35. pandas'
`to_json` loses precision and information on ordinary data, and raises on a
column of `bytes`, so the cell runner writes its own encoding. Both probe
sessions were deleted and read back as `404`.

**Code.**

- `src/backend/dataFrameGrid.ts` (new, imports nothing at run time) holds:
  - the mime and the payload types;
  - the limits and their settings' fallback;
  - the one parser the host and the renderer share.

  The parser bounds every count by the payload's stated counts and the
  settings' maximums. It also caps index levels at 32 and every string at
  2,002 UTF-16 units.
- `src/backend/cellRunner.ts`: the runner tries a grid before the display
  protocol when two things hold:
  - the value is a `pandas.DataFrame`, checked against `sys.modules` and
    never imported;
  - both caps are above 0.

  Any failure, or a payload over 10 MiB, removes the partial file, writes
  one `stderr` line, and falls back to 13f's order. The job passes the caps
  as `PYVIYA_GRID_ROWS` and `PYVIYA_GRID_COLS`, written as 0 when invalid.
- `src/backend/richOutput.ts` and `procPython.ts`: the whitelist admits
  `pyviya_<id>_grid.json`; the file is parsed before it becomes a
  `RichOutput`. `ExecuteOptions` gains `dataFrameGrid` (`backend.ts`).
- `src/notebook/notebookRender.ts` and `notebookController.ts`: a grid
  output carries two items:
  - the grid JSON, with the localised summary line;
  - the HTML, sanitised under ADR-0036.
- `src/notebook/dataFrameGridModel.ts` (new): columns, rows, cell text, and
  the sort comparator. The comparator puts missing values first, orders big
  integers and infinities by value, and orders text by code unit, as Python
  compares `str`.
- `src/webview/dataFrameGridRenderer.ts` (new): the ESM
  `notebookRenderer`, ag-grid 36 with VS Code's theme variables, built to
  `dist/renderer/dataFrameGrid.js` with `requiresMessaging: "never"`.
  Excluded from coverage by ADR-0009's browser-only rule.
- The output channel gets ADR-0019's placeholder and the result panel the
  HTML (`src/run/render.ts`, `resultPanelModel.ts`); neither path sets the
  caps today.
- `package.json`, `package.nls.json`, `esbuild.mjs`,
  `tsconfig.webview.json`, `.c8rc.json`, `scripts/check-package.mjs`: the
  renderer contribution, the two settings, the bundle and its package
  check.

**Decisions made while building.**

- **The payload's version field is `format`**, not `version`. The lint rule
  that confines version comparisons to `src/dialects/` caught the first
  name, and a payload format is not a Viya version.
- **A grid file that fails to parse is left in place**, like any other
  skipped file. The first build deleted it.
- **The settings-to-job wiring is unit-tested, not integration-tested.** The
  recorded-connection helper does not record job code, and extending it was
  out of scope. Manual item 13.66 covers the wiring end to end.

**Tests.**

- New: `test/unit/dataframe-grid.test.ts` and
  `dataframe-grid-model.test.ts`.
- Grid cases added to `backend-rich-output`, `notebook-render`,
  `run-render`, `result-panel-model` and `proc-python-backend`.
- Two integration tests in `test/integration/notebook/execution.test.ts`.

**Docs.**

- `docs/notebooks.md`: "A DataFrame as a grid", and the two new reserved
  names.
- `docs/reference/settings.md`, regenerated.
- `CHANGELOG.md`.

**Adversarial review, 2026-10-01** (VS Code window, before any push).
Five findings, each checked here:

1. **"VS Code shows the HTML first."** Wrong on inspection. VS Code's
   `MimeTypeDisplayOrder.sort` (`notebookCommon.ts` on `main`, read
   2026-10-01) sorts the mime types the user's `notebook.displayOrder`
   does not list by their index in `NOTEBOOK_DISPLAY_ORDER`. A type
   missing from that list has index -1, so it sorts ahead of `text/html`
   (index 2). The claim it raised was loosely worded, though: ADR-0048,
   `notebookRender.ts` and `docs/notebooks.md` now say that the setting,
   or a Change Presentation choice earlier in the window, can put the
   HTML first. Manual item 13.63 checks it on a real window.
2. **A long `MultiIndex` label lost the value.** Real. The runner cut
   each part of a tuple label but not the joined label, so three long
   parts made a name the host's parser refuses, after the runner had
   already written the grid and skipped the fallback. The runner now
   cuts the joined label, and fails the grid on more than
   `MAX_DATAFRAME_INDEX_LEVELS` (32) index levels, now shared with the
   parser, so it never writes a grid the host rejects. A host-side
   fallback to the file's `html` was not added: it would change
   ADR-0048's point 5, and the runner fix removes the cause. Manual item
   13.72 checks a long label.
3. **The don't-delete check leaned on `text/plain`.** Real, minor.
   `procPython.ts` now leaves a file in place only when it was a grid
   candidate that did not decode as a grid. Leaving it in place is
   kept: every other skipped file is, too.
4. **Missing ag-grid modules.** Checked against ag-grid 36.0.2's
   source: `ClientSideRowModelModule` depends on the sort module,
   `cellClass` and `cellStyle` need `CellStyleModule`, and
   `autoSizeStrategy` needs `ColumnAutoSizeModule`. All three are
   registered; `headerClass` and `enableCellTextSelection` need none.
   No change. Manual item 13.63 watches the console.
5. **A number column's sort could be inconsistent** with a
   non-numeric string, which only a hand-edited notebook holds. Real,
   harmless. Such a string now sorts after every number.

Found while checking them: the summary line is above the grid, not
under it, and a Series shows as text, not HTML. `docs/notebooks.md`,
this entry and the manual items are corrected.

**Status.** Built 2026-10-01 on `feat/13g-dataframe-grid`. Before the
review, `npm run verify` was green (2,212 unit tests; coverage 96.59%
statements, 96.29% branches, 96.47% functions, 96.59% lines) and
`npm run test:integration` was green (595 passing). After the review's
fixes, `npm run verify` is green again (2,212 unit tests; coverage 96.59%
statements, 96.30% branches, 96.47% functions, 96.59% lines); the
integration suite was not re-run, since no fix touches a path it drives.

**Manual pass, 2026-10-01.** Sean ran 13.63–13.74 against a `.vsix` built
from this branch. All passed. On 13.63's step 3 the Console showed no
ag-grid error. On 13.67, the dates and times showed as expected; see the
"Since settled" note under Finding 13.35. On 13.73's step 4, the saved
notebook held both mime types for each grid. Whether a Jupyter or GitHub
preview was checked was not recorded.

**Renumbered, 2026-10-01,** when 13p-ii merged to `main` as
[PR #240](https://github.com/Shai-Alit/sas-py-vscode/pull/240) while this
branch was open. 13p-ii took Findings 13.30–13.34 and manual items
13.54–13.62, so this branch's finding moved from 13.30 to 13.35, and its
manual items from 13.54–13.65 to 13.63–13.74, everywhere they are cited.

**Verify after reconciling PR #240, 2026-10-01:** `npm run verify` green
(2,263 unit tests; coverage 96.67% statements, 96.36% branches, 96.62%
functions, 96.67% lines); `npm run test:integration` green (623 passing);
`npm run check:docs` green.

**Merged** 2026-10-01 as [PR #241](https://github.com/Shai-Alit/sas-py-vscode/pull/241), squash
`a8a6365`, in one commit, with every check passing. Neither Codex nor the
Claude reviewer found anything blocking. The Claude reviewer re-derived the
two issues the pre-push review had already raised (the long MultiIndex
label and the don't-delete check) and confirmed both fixes were present.

### 13h done, 2026-10-01 — F1 spike: a native-SQL helper, not interception

**The question.** F1 (`phase-11.md`) asked for two things: a UI for
defining SAS libnames, and Python calls against such a library
"intercepted and rewritten" as a database pass-through query. Asked which
Python calls he meant, Sean chose a **native-SQL helper**: given a libref
and the database's own SQL, return a DataFrame. Nothing in the user's
Python is rewritten.

`verde` has no compute libname that reaches a database (Finding 13.36).
So, Sean's call, the probes went through CAS instead, with a CAS libref onto
the Snowflake caslib `SNOWLIB` that Finding 11.2 used.

**What the probes showed.**

- **Rewriting pandas calls into SQL is out of reach anyway.** The server's
  Python has no SQL compiler (Finding 13.37), so it would mean uploading a
  translator into every session. Sean's narrowing takes it out of scope.
- **`SAS.sd2df` already takes dataset options** such as `where=`, `keep=`
  and `obs=` (Finding 13.38). SAS documents that a SAS/ACCESS engine sends
  such a `where=` on to the database. That is not probed.
- **The CAS route cannot answer that question.** A CAS libref sees only
  tables already loaded into CAS, and `connect using` refuses a CAS libref.
  `proc fedsql sessref=` with `connection to` the caslib does work
  (Finding 13.39). For a caslib, F9's **Insert CAS SQL Passthrough
  Snippet** already does this from Python through `swat`.
- **The native SQL has to travel inside SAS source,** where the SAS
  tokenizer and macro processor see it first (Finding 13.40). Quotes and a
  `;` inside a single-quoted literal pass through. An `&` or `%` inside a
  double-quoted identifier is resolved as a macro reference. `%superq`
  stops that, but then a `;` anywhere splits the statement.
- **Every result column must be a valid SAS name.** A column named
  `Has Space` cannot be read, and `sd2df` then freezes the session
  (Finding 13.41).
- **Failures are quiet.** `sd2df` returns `None` for a missing table, and
  `SAS.submit` returns `0` after errors (Findings 13.38, 13.40). Code built
  on them has to check `SYSCC` itself.

**What the helper would be.** For a SAS/ACCESS libref, the mechanism is
explicit pass-through over the libref's own connection, then a read:

```sas
proc sql;
  connect using MYLIB;
  create table work.pyviya_sql as
    select * from connection to MYLIB (
      select ...
    );
  disconnect from MYLIB;
quit;
```

followed by `SAS.sd2df("work.pyviya_sql")`. It could ship in two shapes:

1. **A snippet command**, like F9's CAS snippet and the SAS Libraries
   drag-and-drop's **Filter with PROC SQL first**. The user edits the
   inserted code. It needs no architecture change. The edge cases in
   Findings 13.40 and 13.41 are documented, not handled.
2. **A function in every session**, for example `sas_sql("MYLIB", "...")`.
   It could check `SYSCC` and raise, drop its temporary table, and deal
   with the edge cases. But it composes code into the interpreter beyond
   ADR-0046's cell runner, so it needs its own ADR, as 13e did.

**Recommendation.** **Decline F1 as written.** Do not intercept pandas
calls, and do not build a libname UI. A profile's `autoExec` already runs
SAS code, such as a `LIBNAME` statement, when each session starts
([connection profiles](../connection-profiles.md)). A site's auth domains
already hold database credentials. A UI of our own would add a credential
store this project does not otherwise need. **Build the helper as shape 1,
a snippet command, in 13i.** Move to shape 2 only if the snippet proves too
fragile in use.

**Before 13i builds anything:** probe against a real compute libname to a
database, which Sean would need to supply, through an auth domain so that
no password is seen. The probe should settle:

- `connect using` and explicit pass-through on a SAS/ACCESS libref;
- whether `sd2df`'s `where=` reaches the database (`options sastrace`);
- how PROC SQL, rather than PROC FEDSQL, tokenizes `;`, `&` and `%` in
  the native SQL;
- whether `options validvarname=any` lets `sd2df` read Finding 13.41's
  columns;
- a large result.

**Probe hygiene.** Every probe ran in a throwaway compute session on the
SAS Studio compute context, deleted afterwards (`204`). CAS tables were
session-scoped in `CASUSER`. A read-only `casManagement` check afterwards
found no leftover CAS session. One round was discarded: it put
`proc python; submit;` on one line, and one job's `sd2df` callback code
ran inside the next job.

### F1 moved to Phase 14, 2026-10-01

Sean's call, on reading the spike above: the native-SQL helper needs more
work and thought than a Phase 13 slice. It is not built in Phase 13, and it
no longer gates 1.0 (`PRODUCTION_PLAN.md` §8, amended the same day). F1 is
to be revisited in a Phase 14, which is not yet planned. When it is, the
spike above is its starting point: the recommendation, the two shapes, and
the probe listed under "Before 13i builds anything", which needs a compute
libname to a database. 13i is closed here unstarted. 13h's findings stay in
this file.

**Merged** 2026-10-01, with 13h's write-up, as
[PR #242](https://github.com/Shai-Alit/sas-py-vscode/pull/242), squash
`13a77ab`, in one commit, with every check passing. Neither Codex nor the
Claude reviewer found anything.

### 13c built, 2026-10-02 — the Commands view

**What it does.** A **Commands** view, first in the Python on Viya sidebar,
lists common commands so a user need not remember their palette names
(F6). Three expanded groups, then **Show Log**:

- **Connection**: Sign In, Connect to SAS Viya *or* Disconnect from SAS
  Viya, Switch Connection Profile, Add Connection Profile.
- **Run**: Run File, New Interactive Window, Cancel, Reset Python State,
  Select Run Target, Refresh CAS Token.
- **Snippets**: Insert CAS Connection Snippet, Insert CAS SQL Passthrough
  Snippet. 13d's snippets will join this group.

Clicking an entry runs the command; labels are the palette titles without
the category.

**Sean's choices, 2026-10-02** (the design pass the Plan item asks for):

- A grouped tree view, not `viewsWelcome` buttons.
- State-aware: Connect or Disconnect, never both; Sign In only while
  no account is signed in; Cancel only while a run is going. With no profile, the
  Connection group holds only Add Connection Profile. Everything else is
  always shown, and a command that cannot act says why, as from the
  palette.
- First in the sidebar, above SAS Content (F6 had suggested under CAS).
- Connection, Run, and Snippets + Log. The environment commands (Show,
  Search, Refresh Environment) were left out.
- The state comes from a shared context-key mirror, not from events
  threaded out of each module (below).

**Code.**

- `src/contextKeys.ts` (new): `setContextKey` records a context key's
  value, fires `onDidChangeContextKey` when it changes, and calls
  `setContext` as before. VS Code cannot read a context key back, so the
  four modules that set the keys the view follows now set them through it:
  `pythonOnViya.hasProfiles` (`profile/commands.ts`, whose constant is now
  exported as `HAS_PROFILES_CONTEXT_KEY`), `.authorized`
  (`auth/authProvider.ts`'s default `setContext`), `.connected`
  (`compute/commands.ts`) and `.running` (`run/commands.ts`). The view
  reads the same values the palette's `enablement` clauses read, so the two
  cannot disagree. Other context keys are unchanged.
- One deliberate difference: `pythonOnViya.authorized` is set from "any
  account is signed in" (`publish()` in `auth/authProvider.ts`), and Sign
  In's `enablement` does not read it. Signed in with profile A and
  switched to B, the view hides Sign In while the palette offers it. The
  sidebar's welcome views test `!authorized` the same way, and Connect on B
  still leads to sign-in (manual item 13.76, step 7).
- `src/commandsView/model.ts` (new, no `vscode`): which entries show for a
  state. An entry's id is its command id without `pythonOnViya.`.
- `src/commandsView/commandsView.ts` (new): the tree provider, labels and
  codicons, `readCommandsViewState`, and `followContextKeys`, which
  refreshes the tree only for the four keys. Group items carry stable ids,
  so a collapsed group stays collapsed across a refresh.
- `package.json`: the view `pythonOnViya.commandsView`, first in the
  container; `package.nls.json`: its name. No welcome content: the tree
  always has entries.
- `docs/getting-started.md`: a "The Commands view" section.

**No probe.** Nothing here crosses the wire.

**Tests.** `test/unit/commands-view-model.test.ts` covers every state's
entries and checks each entry names a command in `package.json`.
`test/integration/commandsView/commands-view.test.ts` covers the tree
items (registered command, label, icon, group ids), the state read, the
key filter, and the mirror. Those tests import `out/src`, a different copy
of `contextKeys.ts` from the running extension's bundle, so that the real
registrars feed the view is left to manual items 13.75–13.80. The unit test
also reads the four registrars' source and fails if any of them sets its key
with a raw `setContext` instead of `setContextKey`, so a regression there
cannot leave the view quietly stale.

**Not built.** The view does not follow workspace trust: in an untrusted
folder it still offers Sign In and Connect, which explain that the folder
must be trusted (manual item 13.80), where the palette hides them.

**Adversarial review, 2026-10-02.** Nothing blocking; four low findings,
all taken. (1) "Sign In only while signed out" overstated what
`authorized` means: reworded to "while no account is signed in" in
`model.ts`, here and in `getting-started.md`, and 13.76 gained a
two-profile step; the behaviour is unchanged, matching the welcome views.
(2) No guard that the registrars use the mirror: the unit test above. (3)
13.80 now clicks Sign In as well as Connect. (4) A comment in
`setContextKey` on why the value is recorded before `setContext` resolves.

**Worktree ignore, folded into 13c (Sean, 2026-10-02).** Stray
`.claude/worktrees/` copies made `prettier --check .` fail and slowed
`eslint .` in nearly every verify run, and earlier slices' verify notes had
to leave them out by hand. First planned as its own PR after 13c; Sean moved
it into this slice once it failed 13c's verify again. `.prettierignore` now
lists `.claude/worktrees/` and `eslint.config.mjs`'s `ignores` lists
`".claude/worktrees/**"`, scoped to `worktrees/` only, since
`.claude/hooks/` and `.claude/settings.json` are tracked and stay linted.

**Verify, 2026-10-02.** `npm run verify` green with the review fixes and
the worktree ignore in: 2276 unit tests; coverage 96.68/96.36/96.64/96.68
lines/branches/functions/statements.

**Manual tests, 2026-10-02.** Items 13.75–13.80 all passed. Sean asked for
one change: **Refresh CAS Token** moves from Snippets to the end of Run,
since it inserts nothing into the editor and acts on the run's Python
session. `model.ts`, both test tiers, 13.75 and the list above are updated.
Sean ruled the move needs no new manual test or adversarial pass.

---

## Probe findings

Numbered phase-scoped as `13.x` (`CLAUDE.md`'s 2026-09-09 rule), starting at
13.1; nothing here continues another phase's sequence. **13.4 and 13.5 are
reserved:** they were written for 13m, which never merged (see the "MCP
server removed" Runbook entry), and are cited by that name. The next new
finding is 13.42.

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

### Finding 13.9 — A file is copied on the server, into a folder, in one call (2026-10-01)

**Documented:** the Files service's reference lists `POST /files/{fileId}/copy`,
"Copy an existing file", for a user with Read access to it. Upstream
`vscode-sas-extension`'s client, generated from SAS's OpenAPI, gives it an
optional `parentFolderUri` query ("the folder in which to add the file"),
an `expirationTimeStamp` query and a `Content-Disposition` header. Upstream
never calls it. Nothing found on a name clash.

**Observed (`verde`, Viya 4 LTS 2026.03, 2026-10-01).** Read-only first: a
file resource carries `copyFile` (`POST`, `/files/files/{id}/copy`,
`responseType: application/vnd.sas.file`, no `type`). The member record a
folder listing returns for the same file does not. Then, approved by Sean,
in a throwaway `probe13b-<ts>` folder under My Folder with sub-folders `A`
and `B`. Everything was deleted afterwards and read back as `404`, and a
sweep found nothing left:

- `x.py` (29 bytes, `text/x-python`, `typeDefName: file`), copied with
  `?parentFolderUri=/folders/folders/{B}` and no body → `201` in 0.29 s,
  with the new file resource as the body and no `Location` header. `B`
  listed it at once as a `child` member named `x.py`; no `addMember` was
  sent. `GET …/content` returned the same bytes. The copy kept
  `contentType`, `typeDefName` and `encoding`, and had its own `copyFile`
  link.
- A 64 KiB `.png` holding every byte value (`image/png`, `file_png`) →
  `201`, with the same bytes, `image/png` and `file_png`.
- Into `A`, which already held `x.py` → `409`, `message`: *File with name
  "x.py" already exists in folder "{id}".* `details` held only `path:`. The
  number of files named `x.py` was the same before and after, so nothing
  was left behind.
- Into `A` with `Content-Disposition: attachment; filename="x_copy.py"` →
  `201`, named `x_copy.py`. With `filename*=UTF-8''<percent-encoded>`, the
  form `createFile` sends → `201`, and names with `é`, `ó` and a space read
  back unchanged. The member took the same name.
- With no `parentFolderUri` → `201`, and the copy was in no folder (deleted
  at once).

**What this establishes.** A file is copied with two calls: `GET` the file
resource for its `copyFile` link, then `POST` it with `parentFolderUri` and
the name. The service adds the copy to the folder, so unlike a create there
is nothing to roll back, as long as `parentFolderUri` is sent.

**Not settled:** Stable 2026.06 (`innov` did not resolve that day); a copy
near 100 MiB, and how long it takes; whether names clash ignoring case; a
target folder the account cannot write to; `expirationTimeStamp`.

### Finding 13.10 — The Folders service has no copy (2026-10-01)

**Documented:** SAS's Folders documentation says a child member has one
parent, so it cannot be copied or duplicated to another folder, only moved.

**Observed (`verde`, 2026-10-01, read-only).** No relation that copies: not
on the Folders service root (18 relations), My Folder, a sub-folder or a
file's member record. The Files service root offers `create` and
`bulkFiles`, and no copy.

**What this establishes.** The documentation is right. A folder is copied by
the client: a new folder for each folder, and each file copied with Finding
13.9's call.

**Not settled:** other releases.

### Finding 13.11 — A folder create refuses a taken name with `409`, even racing another (2026-10-01)

Probed after 13b's adversarial review, which asked what happens when two
Pastes of one copy into one folder choose the same free name.

**Documented:** nothing found on a create racing another. Finding 6.6
covers only the `validateNewMemberName` check a client runs first, which
answers `200` with `valid:false`, `httpStatusCode: 409` and `errorCode
11552`.

**Observed (`verde`, Viya 4 LTS 2026.03, 2026-10-01).** Approved by Sean.
`POST /folders/folders?parentFolderUri=…` with `{name}` and no name check
first, in a throwaway `probe13b-race-<ts>` folder under My Folder.
Everything was deleted afterwards, read back as `404`, and a sweep found
nothing left:

- `dup`, then `dup` again → `201`, then `409` in 0.3 s, `errorCode 11552`,
  *An item named "dup" of type "Folder" already exists in the folder
  "…".* `details`: `Existing member: `, the winner's `/folders/folders/{id}`,
  `Suggestion: dup (1)`, `path:` and `correlator:`. The same envelope the
  name check carries (finding 6.6), now as the HTTP status.
- `DUP` after `dup` → the same `409`, naming the existing `dup` folder.
  Folder names clash ignoring case.
- Five rounds of two creates of one name, released together from two
  threads → in every round exactly one `201` and one `409`, either thread
  winning. The listing then held each name once.

**What this establishes.** The Folders service enforces unique names,
ignoring case, at the create itself, so two racing creates never make two
folders of one name. A copy that loses the race gets `content-rejected`
`409`, which `copyItem`'s retry treats as a refusal. `freeCopyName`
comparing names ignoring case matches the service for folders.

**Not settled:** Stable 2026.06; whether a file copy's name clash ignores
case (Finding 13.9 leaves it open); more than two creates at once.

### Finding 13.12 — Any signed-in user may add to `Public` (2026-10-01)

Probed after manual-test item 13.27, where a file pasted directly into
`Public` was accepted, to ask whether the paste had gone around a Viya
control.

**Documented:** SAS's default authorization rules describe `Public` as
shared content that every signed-in user can read and add to.

**Observed (`verde`, 2026-10-01, read-only).** `GET /authorization/rules`
filtered on `objectUri` for the `Public` root folder: no rule on
`/folders/folders/{id}` itself; one enabled `grant` to
`authenticatedUsers` of `read`, `add` and `remove` on
`/folders/folders/{id}/**`, which covers the folder's members.

**What this establishes.** The documentation is right. A paste into
`Public` is allowed by the deployment's own rules, not by the tester being
an administrator, and not by anything the extension does. The extension
never decides a permission: a paste is a create call under the user's own
token, and the authorization service decides it. `canReceiveMembers`
accepting a top-level folder is intended.

**Not settled:** a paste by a user who is not an administrator; a
deployment whose administrators changed these rules (the call would then
fail with the server's refusal, which the paste reports).

### Finding 13.13 — Open matplotlib figures survive into a later step, which can save them (2026-10-01)

Probed for 13e, to ask whether open figures can be shown without touching
the user's code.

**Documented:** matplotlib's documentation says `plt.show()` does nothing
on a non-interactive backend such as `agg`, and a figure stays open until
it is closed. SAS's `PROC PYTHON` documentation says the Python state
persists between `PROC PYTHON` steps in one session.

**Observed (`verde`, Python 3.12.12, 2026-10-01).** Approved by Sean. One
throwaway session in the SAS Studio compute context, its files uploaded
to filerefs, and each job prefixed with ADR-0039's recovery lines. The
session was deleted afterwards (`204`) and read back as `404`:

- The backend is `agg`. Open figures before `plt.show()` were `[1]`, and
  after it still `[1]`: `plt.show()` closed nothing.
- In one job, a second `proc python infile=` step after the user's step
  found both open figures (`NOTE: Resuming Python state from previous PROC
  PYTHON invocation.`), saved each as a PNG into the working directory
  (25,589 and 13,029 bytes) and closed them. Both files appeared in the
  working directory's member listing.
- When the user's step raised `ZeroDivisionError`, the following step
  still ran and saved the figure the user's step had opened.
- With `matplotlib.pyplot` imported and no figure open, the flush step
  found `[]` and saved nothing.
- Saving over an earlier figure's file name changed its size (25,589 to
  19,261 bytes).
- The flush step took 0.14 s the first time, saving two figures, and
  0.00–0.04 s after that. Whole jobs took about 500 ms, and about 5.2 s
  with `restart`.

**What this establishes.** Open figures can be saved by a step of the
project's own, after the user's, with nothing added to the user's code.
The working-directory diff (ADR-0019) sees the saved files like any other.
A reused file name is caught only when its size changes, which is why
ADR-0046 names each file uniquely.

**Not settled:** other releases and Python versions; figures from seaborn
or pandas plotting; libraries with their own figure registry; a cancel
during the flush.

### Finding 13.14 — A later step's failure sets `SYSCC` unless it is saved and restored (2026-10-01)

**Documented:** SAS's documentation says `SYSCC` holds the highest
condition code so far, and that `%let syscc=` may set it.

**Observed (`verde`, 2026-10-01, same session as Finding 13.13):**

- The user's step raises, the flush step succeeds → job state `error`,
  `SYSCC=1012`.
- The user's step succeeds, the flush step raises → job state `error`,
  `SYSCC=1012`.
- The same, with `%let PV_USERCC=&syscc;` before the flush step and
  `%let syscc=&PV_USERCC;` after it → job state `completed`, `SYSCC=0`.

**What this establishes.** A failing flush would otherwise report the
user's cell as failed. Saving `SYSCC` before the flush step and restoring
it after keeps `SYSCC` about the user's code alone, as ADR-0041 does for
the startup snippet.

**Not settled:** a flush step that ends in a SAS `ERROR` rather than a
Python exception.

### Finding 13.15 — A runner that compiles the cell keeps its namespace, and adds traceback frames (2026-10-01)

**Documented:** Python's documentation says `exec` and `eval` run code in
the globals they are given, and that a file passed to `compile()` keeps
its name and line numbers in tracebacks.

**Observed (`verde`, Python 3.12.12, 2026-10-01, same session as Finding
13.13).** A runner, uploaded to its own fileref, read the cell's fileref
name with `SAS.symget()`, `ast.parse`d the cell's file, split off a
trailing bare expression, `exec`ed the rest and `eval`ed the expression:

- In a `proc python infile=` step, `globals() is __main__.__dict__` is
  `True`.
- A cell ending in `df.head()`: the value came back, and its
  `_repr_html_()` returned 565 characters of HTML. `x = 41` and `df`
  were still defined in a later, plain `infile=` step.
- `from __future__ import annotations` with an undefined annotation
  worked, and a trailing `"done"` came back as the value.
- A cell raising on line 3: the traceback ran `File "<stdin>", line 5`,
  `File "<stdin>", line 2`, then two runner frames (`File "<string>"`, in
  `<module>`, and `in _pyviya_run`), then
  `File "PYU4", line 3, in <module>`. That last frame showed the source line and a caret, because
  the cell's file sits in the working directory under that name.
- A `SyntaxError` on line 2 added a frame in the standard library's
  `ast.py`, `in parse`, before `File "PYU6", line 2` with its caret. Run
  directly, the same file reports `File "<string>", line 2`.
- Without a `try`/`finally`, the runner's own function was left in the
  user's globals after the cell raised. With `try`/`finally` deleting it,
  nothing was left.

**What this establishes.** A cell run through the runner keeps the
namespace a direct `infile=` step has, so variables persist between cells
as they do today. Tracebacks keep the user's line numbers but gain the
runner's frames and, for a `SyntaxError`, an `ast.py` frame, which the
traceback parser must drop. The runner must clean up its own names in a
`finally`.

**Not settled:** other Python versions; a cell that never returns; a
cell that changes `sys.displayhook` or `__main__`.

### Finding 13.16 — The cell runner and the figure flush work end to end, and the runner adds exactly two frames (2026-10-01)

Probed for 13f, with the runner and flush 13f ships.

**Documented:** `compile()` with `ast.PyCF_ONLY_AST` returns the AST
without the extra `ast.parse` frame. A `from __future__` import sets
compiler flags on the code object it compiles. `end_col_offset` counts
UTF-8 bytes.

**Observed (`verde`, Python 3.12.12, 2026-10-01).** Approved by Sean. Two
throwaway sessions, each deleted afterwards (`204`) and read back as `404`.
Each cell ran as ADR-0046's job, with the recovery and notes lines and
without the ODS wrapper. Round one passed the fileref name in
`PYVIYA_CELL`; round two passed the absolute path that 13f ships (Finding
13.19), and re-ran a plot, a value, a table and a raise:

- A cell that raises on its own line 3 gives these frames, the middle two
  the runner's (their line numbers depend on the runner's revision):

  ```text
  File "<stdin>", line 5, in <module>
  File "<stdin>", line 2, in <module>
  File "<string>", line …, in <module>
  File "<string>", line …, in _pyviya_run_cell
  File "<string>", line 3, in <module>
  ```

  That holds both when the body raises and when the trailing expression
  raises. The `ERROR: Unhandled Python exception.` line is
  typed `error`, and the traceback lines are typed `normal`.
- A syntax error on line 2 gives the first four frames above, then
  `File "<string>", line 2` with no `, in`, the source line, a caret, and
  `SyntaxError: '(' was never closed`. No `ast.py` frame appears.
- A trailing `x + 1` with `x = 41` printed `42` as one `normal` line.
  `x + 1;` printed nothing.
- `from __future__ import annotations` with an undefined annotation, then
  a trailing `f.__annotations__`, printed `{'a': 'Missing', 'return':
  'int'}`. The trailing expression is compiled with the module's flags.
- A cell ending in a DataFrame wrote a 514-byte `pyviya_PY000001_out.html`.
  A figure drawn in that cell and shown with `plt.show()` was still saved,
  by the flush, as `pyviya_PY000001_plot001.png` (17,356 bytes).
- Afterwards a check step found no `_pyviya_` names in `globals()`, `x`
  still `41`, and no open figures.

The two final changes to the runner were checked with a local CPython 3
and a stub `SAS`, not on Viya: accepting IPython's `(data, metadata)` tuple
form, and skipping a `_repr_html_` that raises (a class value) or returns
the wrong type. After 13f's adversarial review, two more were checked the
same way, on CPython 3.14: a repr method that raises now prints one
`stderr` line naming it, and a class value skips the repr methods for its
`repr()`. That line reaches the log as the traceback's `stderr` lines do
above; manual item 13.42 checks it on Viya.

**What this establishes.** The runner keeps the namespace and line numbers
a direct step has. It adds exactly two `<string>` frames, `<module>` then
`_pyviya_run_cell`, directly below the `<stdin>` frames, and nothing else.
So `parseTraceback` drops those two, and `tracebackDiagnostics.ts`'s
`<string>` mapping is unchanged. A syntax error's message carries its
location, as a plain run's does (Finding 13.15).

**Not settled:** other Python versions; a cell that never returns; a cell
that redefines `_pyviya_run_cell`, `SAS` or `globals`; seaborn and pandas
plotting (13f's manual pass).

### Finding 13.17 — `SYSCC` describes the cell alone, and `PYVIYA_FLUSHCC` the flush (2026-10-01)

**Documented:** as Finding 13.14.

**Observed (same sessions as Finding 13.16),** with `FIGURE_FLUSH_STEP`'s
save, reset and restore around the flush:

| Cell | Flush | Job state | `SYSCC` | `PYVIYA_USERCC` | `PYVIYA_FLUSHCC` |
|---|---|---|---|---|---|
| succeeds | succeeds | `completed` | `0` | `0` | `0` |
| raises | succeeds | `error` | `1012` | `1012` | `0` |
| succeeds | raises | `completed` | `0` | `0` | `1012` |
| raises | raises | `error` | `1012` | `1012` | `1012` |

`SYSERRORTEXT` kept `Unhandled Python exception.` from an earlier failure
in later successful jobs.

**What this establishes.** After the job, `SYSCC` and the job's state are
the cell's alone, and `PYVIYA_FLUSHCC` is the flush's alone. Resetting
`SYSCC` to `0` before the flush is what makes `PYVIYA_FLUSHCC` the flush's
own result when the cell has already failed. A stale `SYSERRORTEXT` is
harmless, since it is read only when `SYSCC` is not `0`.

**Not settled:** a flush that ends in a SAS `ERROR` rather than a Python
exception (as Finding 13.14).

### Finding 13.18 — The flush's log starts at the `PYVIYA_USERCC` echo (2026-10-01)

**Documented:** nothing found. Finding 13.2 measured the startup capture's
echo as `source` with notes off.

**Observed (same sessions as Finding 13.16).** In every job, the cell's
output and traceback came first, then `%let PYVIYA_USERCC=&syscc;` typed
`source` with SAS's line number in front, then the flush step's lines. A
failing flush's traceback ran the `<stdin>` frames, then the flush's two
`<string>` frames (`<module>` at line 14, `_pyviya_flush_figures` at line
10), then the frame that raised. `title` lines (a page header) came in at arbitrary points, once
between two traceback frames. That probe ran without the ODS wrapper's
`PAGESIZE MAX`, and `logFilter.ts` drops `title` lines anyway.

**What this establishes.** The `source` echo of `FIGURE_FLUSH_STEP`'s first
line splits the log as ADR-0041's capture echo does: the lines before it
are the cell's, those after it the flush's. A line the cell prints is
typed `normal`, so it cannot be taken for the boundary.

**Not settled:** other releases.

### Finding 13.19 — After `os.chdir`, a relative write lands outside the listed directory (2026-10-01)

Probed for 13f when round one's runner wrote output by relative path.

**Documented:** the Compute service's `files/cwd` lists the session's
working directory. Nothing found on whether it follows the Python process.

**Observed (`verde`, 2026-10-01, a third throwaway session, deleted
afterwards and read back as `404`; the file written to `/tmp` was removed):**

- A cell ran `os.chdir("/tmp")`, then wrote one file by relative name and
  one by the original directory's absolute path. The Files API listing
  (`getFiles`, then `getDirectoryMembers`) then held the absolute-path file
  and not the relative one.
- In a later step, Python's working directory was still `/tmp`, and the
  directory of `%sysfunc(pathname(<fileref>))` was not the working
  directory.
- In round two of Finding 13.16, a cell that ran `os.chdir("/tmp")` and
  drew a figure, and the next cell, which ended in a DataFrame, both had
  their output written to the listed directory.

**What this establishes.** The listing ADR-0019 diffs does not follow
Python's working directory, and a `chdir` lasts across cells. So the runner
and the flush write beside the cell's file, by the absolute path
`%sysfunc(pathname())` gives, never by a relative name.

**Not settled:** a cell that deletes or replaces the cell's file while it
runs.

### Finding 13.20 — No link reaches the server's root; it has to be composed (2026-10-01)

**Documented:** the Compute API's `/files` endpoint lists, creates,
deletes, renames, copies, uploads and downloads files on the compute
server's file system. A path is written with `~fs~` for `/`. Upstream
composes every such URL.

**Observed (`verde`, Viya 4 LTS 2026.03, 2026-10-01).** A session on *SAS
Job Execution compute context*, created and deleted by the probe:

- The session's `getFiles` relation (`GET`, `type`
  `application/vnd.sas.compute.file.properties`) resolves to the session's
  **working directory**, a per-session folder under
  `/opt/sas/viya/config/var/run/compsrv/default/`. It was empty.
- The session's `files` relation is not files: it is the `filerefs`
  collection (`itemType` `…compute.fileref.summary`).
- No directory or item carries a parent link. A directory's relations are
  `self`, `getDirectoryProperties`, `getDirectoryMembers`, `makeDirectory`,
  `createFile`, `renameDirectory`, `deleteDirectory` and `copyDirectory`.
- `GET /compute/sessions/{id}/files/~fs~` → `200`, the root's properties:
  `name: ""`, `isDirectory: true`, **`readOnly: true`**, with an `ETag`.
  Its relations are only `self`, `getDirectoryProperties`,
  `getDirectoryMembers`, `makeDirectory` and `copyDirectory`.

**What this establishes.** Following links from the session reaches only
the working directory. The root, and any custom root, can only be reached
by composing `/compute/sessions/{id}/files/{encoded path}`. Below a root,
every item carries the links a view needs. `src/compute/files.ts` already
follows `getFiles` (Findings 61 and 68).

**Not settled:** other compute contexts; Stable 2026.06.

### Finding 13.21 — On `verde`, `HOME` is `/`, and the root shows only some folders (2026-10-01)

**Documented:** `fileNavigationRoot` is `USER` (the user's login
directory, the default), `SYSTEM` (the server's root) or `CUSTOM` (with
`fileNavigationCustomRootPath`). An administrator can set both as compute
context attributes. Upstream's REST adapter sends `~fs~` for both `USER`
and `SYSTEM`.

**Observed (`verde`, 2026-10-01).**

- No compute context on `verde` sets `fileNavigationRoot`,
  `fileNavigationCustomRootPath` or `allowDownload` (read-only, all 13
  contexts).
- In a session, `%sysget(HOME)` is `/`.
- `~fs~`'s members (`count: 9`): `config`, `mnt`, `opt`, `rdutil`,
  `sashelp`, `sasuser`, `security`, `tmp`, `usr`. Not `etc`, `bin` or
  `root`.
- `~fs~root`'s members → `404`, `errorCode 5436`, *The path requested is
  not available or does not represent a directory.* A path that does not
  exist → `404`, `errorCode 5437`, *The path requested "…" is not
  available.* A refused path is not a `403`.

**What this establishes.** On this deployment `USER` and `SYSTEM` are the
same folder, so upstream's single `~fs~` root loses nothing here. A
folder the server will not show is a `404`, as a missing one is.

**Not settled:** why the root shows only those nine (SAS's lockdown path
list is the likely reason, not checked); a deployment where users have a
home directory, where `USER` and `SYSTEM` may differ; a context that sets
the attributes.

### Finding 13.22 — A listing's shape, paging, hidden files and path encoding (2026-10-01)

**Documented:** upstream's generated client: `GET …/files/{path}/members`
with `start`, `limit`, `showAll`; `FileProperties` has `name`, `path`,
`isDirectory`, `readOnly`, `size`, `modifiedTimeStamp`.

**Observed (`verde`, 2026-10-01).**

- `getDirectoryMembers` returns `application/vnd.sas.collection+json`,
  `version: 2`, `name: "Directory listing"`, `accept:
  application/vnd.sas.compute.file.properties`. **`count` is populated.**
- With `limit=2`, the envelope carries `self`, `collection`, `next` and
  `last`; `next` is `…?limit=2&start=2`. **`next` drops `showAll`**: the
  page was asked for with `showAll=true`, and its `next` carries no
  `showAll`, so following it as-is lists page 2 without hidden files.
- Each item has `name`, `path`, `isDirectory`, `readOnly`, `size`,
  `modifiedTimeStamp` (ISO 8601) and `version: 1`. **`path` is the parent
  directory**, not the item's own path.
- A file's relations: `self`, `getFileProperties`, `getFile` (`GET
  …/content`, `type text/plain`), `createFile` (**`PUT` …/content**, the
  write), `renameFile`, `deleteFile`, `copyFile` (`href`
  `{destinationFile}`, a template).
- `showAll` defaults to `false`, which hides names starting with `.`;
  `showAll=true` lists them.
- A file named `x;y~z#q.txt` comes back in its `self` href as
  `x~sc~y~~z%23q.txt`: `/` → `~fs~`, `;` → `~sc~`, `~` → `~~`, then
  percent-encoding.

**What this establishes.** The tree pages by following `next`, adding
`showAll` back to each page, reads type and size from the listing alone,
and hides dot-files unless asked. A custom root is encoded as above.

**Not settled:** a directory of more than a few hundred entries; how the
listing sorts; whether `count` is ever `null` here.

### Finding 13.23 — A listing does not wait behind a running job (2026-10-01)

**Documented:** nothing found. Finding 7.3: a data-access read blocks at
the SAS kernel behind a running job.

**Observed (`verde`, 2026-10-01).** A job running `rc=sleep(15,1)`; 1.5 s
in, a directory listing → `200` in **0.3 s**, and a properties read →
`200` in about 0.5 s. Both jobs then completed.

**What this establishes.** The files API is served outside the SAS kernel.
The view can read while a run is in progress, so reads need no busy guard,
unlike the Library view.

A content write during a run is Finding 13.27; a create, rename or
delete during a run is Finding 13.30.

### Finding 13.24 — Create, write and read file content (2026-10-01)

**Documented:** upstream: create is a `POST` to the parent's path with
`application/vnd.sas.compute.file.properties+json` and `{name,
isDirectory}`; content is `PUT …/content`, `application/octet-stream`,
with `If-Match`.

**Observed (`verde`, 2026-10-01).** In a throwaway `/tmp/probe13o_<ts>`
(the root and `HOME` are read-only):

- `POST` to a directory's `makeDirectory` (or `createFile`) link with
  `{name, isDirectory}` → `201`, the new item's properties, a `Location`
  and an `ETag`. A taken name → `409`, `errorCode 5451`, *The file or
  directory "…" already exists.*
- `PUT …/content` with no `If-Match` → `428`; with a stale one → `412`;
  with the current `ETag` → `200`, the file's properties as the body, and
  a new `ETag`.
- `GET …/content` → the same 1,024 bytes (every byte value). Its
  `Content-Type` follows `Accept`: `application/octet-stream` when asked,
  otherwise `text/plain`. Asked with `Accept: text/plain`, or with no
  `Accept`, the bytes were the same 1,024, unchanged. The `ETag` matches
  the properties'.

**What this establishes.** Open reads `…/content` with `Accept:
application/octet-stream`; save reads the `ETag` from the properties, then
`PUT`s with it, the pattern `src/compute/fileref.ts` uses.

A large file is Finding 13.34.

### Finding 13.25 — Rename and move are one `PUT`, and a missing `If-Match` fails with `200` (2026-10-01)

**Documented:** upstream: `PUT` on the item with `{name, path}`;
`moveItem` sends a new `path`.

**Observed (`verde`, 2026-10-01).**

- `PUT` on a file's `renameFile` link, `{name: "renamed.txt", path:
  <a different directory>}`, with the current `ETag` → `200`. The file was
  renamed **and moved**: `path` is the destination directory. The `ETag`
  did not change.
- The same with **no `If-Match`** → **`200`**, with an error as the body:
  `httpStatusCode: 0`, `errorCode 5033`, and an inner error with
  `httpStatusCode: 428`, *An If-Match header containing the current entity
  tag of this resource is required.* The file kept its old name.

**What this establishes.** One call renames and moves. A client that
checks only the status would report a rename that did not happen, so the
reply's body is checked for an error.

A move onto a taken name, and a directory move, are Finding 13.31.

### Finding 13.26 — An empty `If-Match` skips the check, even for a non-empty folder (2026-10-01)

**Documented:** nothing found. Upstream sends `If-Match: ""` on delete and
rename.

**Observed (`verde`, 2026-10-01).**

- `If-Match: ""` → content `PUT` `200`; rename `200`; file `DELETE` `204`.
- `If-Match: "*"` → `412`.
- A file `DELETE` with no `If-Match` → `428`; with a stale one → `412`.
- A directory holding a file and a sub-directory: `DELETE` with no
  `If-Match` → `428`; with `""` → **`204`**, the directory and everything
  in it gone.

**What this establishes.** An empty `If-Match` turns the server's
concurrency check off. A delete with it removes a whole folder at once,
and nothing goes to a recycle bin. This extension sends the real `ETag`.

Whether a directory's `ETag` changes when its contents do is Finding
13.33.

### Finding 13.27 — A content write does not wait behind a running job (2026-10-01)

**Documented:** nothing found.

**Observed (`verde`, 2026-10-01).** Approved by Sean. A job running
`rc=sleep(15,1)`; 1.5 s in, `PUT …/content` with the file's current `ETag`
→ `200` in **0.24 s**, the job still `running` straight after. Reading the
content back gave the new bytes. A properties read took 0.22 s.

**What this establishes.** An editor save need not wait for a run, or be
refused during one. A create, rename or delete during a run is Finding
13.30.

### Finding 13.28 — A composed path matches the server's href for spaces and non-ASCII names (2026-10-01)

**Documented:** nothing found beyond `~fs~` for `/`.

**Observed (`verde`, 2026-10-01).** A file created as `a b é.py` in
`/tmp/probe13p_<ts>` came back with the `self` href
`…~fs~tmp~fs~probe13p_<ts>~fs~a%20b%20%C3%A9.py`. Composing the same path
with Finding 13.22's encoding (UTF-8 percent-encoding, `%20` for a space)
gave the identical string, and a `GET` on it → `200` with that file's
properties.

**What this establishes.** `src/server/path.ts`'s encoding addresses names
with spaces and non-ASCII characters correctly.

**Not settled:** names with characters outside those tested (`;`, `~`,
`#`, space, `é`).

### Finding 13.29 — On a session that is gone, a files request is a plain `404` (2026-10-01)

**Documented:** nothing found.

**Observed (`verde`, 2026-10-01).** After the probe deleted its session,
`GET …/files/~fs~tmp`, `GET …/files/~fs~tmp/members` and `GET …/state`
each → `404`, `errorCode 5837`, *A session with the ID "…" could not be
found.* A missing path on a live session is also `404`, with `errorCode`
5436 or 5437 (Finding 13.21).

**What this establishes.** The status alone cannot tell a missing path from
a gone session. The view reads the session's `state` link on a `404`: a
`404` there means the session is gone. It does not branch on `errorCode`
(`src/wire/viyaError.ts`).

**Not settled:** a session that ends between the two requests.

### Finding 13.30 — Create, rename and delete do not wait behind a running job (2026-10-01)

**Documented:** nothing found.

**Observed (`verde`, 2026-10-01).** Approved by Sean. A job running
`rc=sleep(15,1)`; 1.5 s in, in a throwaway `/tmp/probe13pii_<ts>`: a folder
create → `201` in 0.23 s, a file create → `201` in 0.22 s, a rename → `200`
in 0.45 s, a file delete → `204` in 0.53 s, and a folder delete → `204` in
0.46 s (each including the properties read for its `ETag`). The job was
still `running` after each, and then completed.

**What this establishes.** With Findings 13.23 and 13.27, no files call the
view makes waits for a run, so none needs a busy guard.

### Finding 13.31 — A rename or move onto a taken name is `409`; a folder moves with its contents (2026-10-01)

**Documented:** upstream sends `{name, path}` for both a rename and a move.

**Observed (`verde`, 2026-10-01).**

- Renaming a file to a name its folder holds, as a file or as a folder →
  `409`, `errorCode 5451`, *The file or directory "…" already exists.*
  Nothing changed. Moving a file into a folder that holds its name → the
  same `409`. Renaming a folder to a taken folder name → the same.
- A case-only rename (`a.txt` → `A.txt`) → `200`, renamed.
- Moving a file into a folder that does not exist → `404`, `errorCode
  5437`, naming the missing folder.
- Renaming a folder → `200`, its members with it; its `ETag` did not
  change. Moving it into another folder → `200`, members intact.
- Moving a folder into its own child → `404`, `errorCode 5437`, *The path
  requested "" is not available*, with an inner `400`, `errorCode 5455`,
  *Host level error*. Nothing moved.

**What this establishes.** A `409` on a create, rename or move means the
name is taken. A move's `404` does not say whether the item or the target
folder is missing; the error's detail does. A folder into itself is refused
before sending (`src/server/move.ts`), since the server's answer names no
path.

### Finding 13.32 — A rename's `200` can be a failure, and a rename without `path` moves the item (2026-10-01)

**Documented:** nothing found. Finding 13.25 saw a missing `If-Match`
answer `200` with an error body.

**Observed (`verde`, 2026-10-01).**

- A rename with a **stale** `If-Match` → `200`, with an error as the body:
  `httpStatusCode: 0`, `errorCode 5034`, and inside `errors[0]`
  `httpStatusCode: 412`, *The given If-Match header does not match the
  current ETag for the resource.* Nothing renamed. The same with `Accept:
  application/json`.
- A rename with no `If-Match` **and no `Accept`** → `200` with an **empty
  body**. Nothing renamed. With a current `If-Match` and no `Accept` →
  `200`, the properties, renamed.
- A rename whose body has `name` but **no `path`** → `200`, and the file
  was moved into the session's working directory
  (`/opt/sas/viya/config/var/run/compsrv/default/<id>`).

**What this establishes.** A rename or move is a success only when the
reply's body is the item's properties at the new path. The adapter sends
`Accept`, reads an error body by its inner status, treats an empty or
mismatched body as malformed, and always sends `path`.

### Finding 13.33 — A folder's `ETag` changes when a member is added, not when a member's bytes change (2026-10-01)

**Documented:** nothing found.

**Observed (`verde`, 2026-10-01).**

- A folder's `ETag` changed after a file was created in it.
- It did not change after a member file's content was rewritten.
- A rename kept the item's `ETag` (a file, Finding 13.25, and a folder).
- `DELETE` on a non-empty folder with its current `ETag` → `204`, the
  folder and everything in it gone (read back `404`).

**What this establishes.** A folder delete with its current `ETag` guards
against members being added in the moment before it, not against their
bytes changing. The delete's confirmation, which says the folder goes with
everything in it, is the guard that matters.

### Finding 13.34 — An upload is a create and a write; 110 MiB is accepted; a create in `/` fails (2026-10-01)

**Documented:** upstream creates the file, then writes its bytes.

**Observed (`verde`, 2026-10-01).**

- A file create → `201` with an `ETag`, `size: 0`. Its content reads back
  as 0 bytes. A `PUT …/content` with **the create's own `ETag`** → `200`, a
  new `ETag`, and the bytes read back unchanged.
- A 110 MiB `PUT …/content` → `200` in 4.1 s; the properties' `size` was
  115,343,360, and a `GET` returned the same bytes in 3.4 s. (The Files
  service resets the connection past 100 MiB, Finding 13.7; the compute
  server did not.)
- A folder create in the root `/` (`readOnly: true`, Finding 13.20) →
  `404`, `errorCode 5437`, *The path requested `"//probe13pii_<ts>_root"` is
  not available.* Nothing was created.

**What this establishes.** An upload is two calls with one `ETag`, so an
upload whose write fails leaves an empty file unless it is deleted. The
view's 100 MiB cap is its own, matching SAS Content's. A create in a
read-only folder gets a misleading `404`, so the view does not offer one.

**Not settled:** where between 110 MiB and anything larger the compute
server stops; a `readOnly` folder other than `/`.

### Finding 13.35 — pandas' `to_json` rounds, merges and drops; the runner needs its own encoding (2026-10-01)

**Documented:** `DataFrame.to_json(orient="split")` writes `columns`,
`index` and `data`. `NaN` and `None` are written as `null`. With
`date_format="iso"`, dates are ISO 8601 at `date_unit` precision (default
`"ms"`). `default_handler` is called for an object `to_json` cannot
otherwise convert.

**Observed (`verde`, pandas 3.0.5, numpy 2.5.3, Python 3.12.12,
2026-10-01).** A probe job ran
`to_json(orient="split", date_format="iso", default_handler=str)` on test
frames:

- **Large integers.** An `int64` column holding `9007199254740993`
  (2^53 + 1) and `-4611686018427387904` was written as those exact digits.
  Python's `json.loads` reads them back exactly. JavaScript's `JSON.parse`
  would round 2^53 + 1: that is how the language works, not something the
  probe observed.
- **Missing and infinite values.** A float column of `NaN` and one holding
  `-inf` were both written `null`, so `NaN`, `inf` and `-inf` become
  indistinguishable.
- **Bytes.** A column holding `b"\x00\xff"` raised `UnicodeDecodeError`.
- **Nanoseconds.** A datetime with nanoseconds was written
  `2026-01-02T03:04:05.123`.
- **Index names.** An index named `id`, and a two-level index named `k` and
  `n`, were written without their names.
- **Column labels.** A tuple column label became the array `[1, 2]`.
  Duplicate labels were accepted.
- **Dtypes.** Column dtypes printed as `datetime64[us]`,
  `datetime64[us, America/New_York]` and `timedelta64[us]`.
- **Styler.** `df.style` is not a `DataFrame`. `isinstance` against
  `sys.modules["pandas"].DataFrame` tells them apart.
- **An unexplained empty result.** A frame holding a naive datetime, a
  time-zoned one and a timedelta printed nothing for its `to_json` line.
- **The first session.** It failed before reaching the frames: pandas 3's
  strict format inference rejected a datetime string the probe had built.
  The second session built the dates directly.

**What this establishes.** `to_json` is not a safe encoder for a grid. It
silently merges missing and infinite values, cuts precision, drops index
names, and raises on ordinary data.

So the cell runner writes its own encoding (ADR-0048, point 2):

- missing values are `null`;
- in a number column, big integers and infinities are strings;
- every other value is `str()`.

The runner tells a Styler from a DataFrame with `isinstance`, without
importing pandas.

**Not settled:**

- Why the datetime frame printed nothing.

**Since settled, 2026-10-01:** whether the runner's own encoder works on
Viya, which this finding first left open because it had run only against a
local pandas 3.0.3 harness. Manual items 13.67 and 13.70, on `verde`, saved
grid payloads holding `2026-01-02 03:04:05.123456789`,
`2026-01-02 03:04:05-05:00` and `1 days 02:03:04`, with `null` for each
missing value, and `"9007199254740993"`, `"inf"` and `"-inf"` as strings,
with `null` for `NaN`. A frame with the same three column kinds as the
unexplained one encoded without error.

### Finding 13.36 — No compute libname reaches a database; the database sources are caslibs (2026-10-01)

**Probe (`verde`, SAS Studio compute context).** A job listed every libref
in `sashelp.vlibnam`, and `proc setinit` listed the licensed products. A
read-only `GET` on `casManagement` listed the caslibs.

**Observed.**

- Every libref the context assigns uses the `V9` engine. None reaches a
  database.
- SAS/ACCESS engines are licensed in compute, Snowflake, Postgres, ODBC,
  Oracle and SQL Server among them.
- The database sources that exist are caslibs of type `snowflake`
  (`SNOWLIB`, `SF`, `SFCAS`, `HAL_SNOW`). `SNOWLIB`'s attributes hold its
  own `uid` and `pwd`, not an auth domain. Reusing them for a compute
  libname would mean copying a credential, so the probe did not.

**What this establishes.** A probe of SAS/ACCESS behaviour from compute
needs a libname this deployment does not have.

### Finding 13.37 — The server's Python has no SQL compiler (2026-10-01)

**Probe.** A `PROC PYTHON` step printed its versions and tried to import
some packages.

**Observed.** Python 3.12.12 and pandas 3.0.5. `sqlglot`, `ibis`,
`sqlalchemy`, `duckdb` and `polars` are not installed. `pyarrow` 25.0.1,
`saspy` 5.108.7 and `swat` 1.18.1 are.

**What this establishes.** Turning pandas calls into SQL would mean
uploading a translator into the session. Nothing on the server does it.

### Finding 13.38 — `sd2df` takes dataset options, and a missing table is `None` (2026-10-01)

**Documented.** `SAS.sd2df`'s own docstring, printed on `verde`: "the
'libref.table(optional dataset options)' name of the SAS Data Set". Its
signature is `sd2df(dataset, rowsep, colsep, rowrep, colrep, **kwargs)`.
`SAS.submit(code: str) -> int`.

**Observed.**

- `SAS.sd2df("sashelp.class(where=(age>13) keep=name age obs=3)")`
  returned 3 rows and the 2 kept columns. A quoted `where=(name='Alfred')`
  also worked.
- It reads a PROC SQL view.
- `SAS.sd2df("sashelp.nosuch")` printed "Data Set sashelp.nosuch does not
  exist" and returned `None`. It raised nothing, and the job ended with
  code 0.

**Not settled.** Whether a SAS/ACCESS engine sends the `where=` on to the
database. SAS documents that it does (implicit pass-through, visible with
`options sastrace`), but this deployment has no such libname (Finding
13.36).

### Finding 13.39 — Through CAS, only `proc fedsql` reaches the database (2026-10-01)

**Probe.** A compute job started a CAS session and assigned
`libname sl cas caslib="SNOWLIB"`. `SNOWLIB` is Sean's own Snowflake
sandbox, the caslib Finding 11.2 used.

**Observed.**

- `SAS.sd2df("sl.CARS_TESTING(obs=2)")` returned `None` ("does not
  exist"), although `table.fileInfo` lists `CARS_TESTING`.
  `table.tableInfo` on the caslib reported "No tables are available": a
  CAS libref sees only tables loaded into CAS.
- `proc sql; connect using sl;` failed: "A Connection to the CAS DBMS is
  not currently supported". `SQLRC` was 8.
- `proc fedsql sessref=mysess; create table casuser.t {options
  replace=true} as select * from connection to SNOWLIB (select 1 as X,
  'Audi' as M); quit;` created the table in Snowflake's answer. It logged
  Finding 11.2's `numReadNodes=1` warning. A CAS libref on `CASUSER` then
  read it with `sd2df`: `[{'X': 1.0, 'M': 'Audi'}]`.

**What this establishes.** For a caslib, native SQL from compute works
through `proc fedsql`, and from Python through F9's `swat` snippet. A
helper for SAS/ACCESS librefs needs `connect using`, which a CAS libref
does not support. The two kinds of libref need different mechanisms.

### Finding 13.40 — Native SQL in SAS source meets the tokenizer and the macro processor (2026-10-01)

**Probe.** From Python, `SAS.submit` ran
`proc fedsql sessref=… create table … as select * from connection to
SNOWLIB (<native SQL>); quit;` with the native SQL written in a few ways.

**Observed.**

- **Plain text, single-quoted literals.**
  `select 'a;b' as S, '50%' as P, 'x&y' as Q, 'it''s' as R, '%put HI;' as M`
  ran with `SYSCC` 0. The `;`, `%` and `&` inside single quotes were left
  alone.
- **Plain text, double-quoted identifiers.** `select 1 as "X&Y", 2 as
  "A%B"` ran, but logged "Apparent symbolic reference Y not resolved" and
  "Apparent invocation of macro B not resolved", and set `SYSCC` to 4. A
  macro variable named `Y` would have been substituted.
- **Through `%superq`.** The SQL was stored with `SAS.symput` and written
  as `%superq(pyviya_q)`. Without a `;`, quotes, `%` and `&` all passed
  with no warning. With `'a;b'` in it, the `;` split the PROC FEDSQL
  statement: "Syntax error at or near "select 'a"", then two "Unsupported
  SQL statement" errors for the rest.
- **`SAS.submit`'s return value** was 0 after that failure, with `SYSCC`
  at 1012.

**What this establishes.** No single way of writing the SQL is safe for all
of it. Plain text breaks on macro triggers in double quotes. `%superq`
breaks on a `;`. A helper has to choose, and has to check `SYSCC` rather
than `SAS.submit`'s return value.

**Not settled.**

- How PROC SQL handles the same text. Only PROC FEDSQL was probed.
- A `--` comment holding an apostrophe. Its round was discarded (see "13h
  done").

### Finding 13.41 — A result column that is not a valid SAS name freezes `sd2df` (2026-10-01)

**Probe.** `proc fedsql` created a `CASUSER` table from Snowflake with
columns `"lower"`, `UPPERX` and `"Has Space"`. A second job in the same
session was to copy it with `validvarname=v7` and read the copy.

**Observed.**

- `proc contents` on the table failed: "The value 'Has Space'n is not a
  valid SAS name".
- `SAS.sd2df` on it started its usual `proc printto` redirect, and the log
  stopped there. The job ended in error with code 1012.
- The second job in the same session ended in error with an empty log.
- An earlier round, whose result table had columns `X&Y` and `A%B`, stopped
  at the same point.

**What this establishes.** A database's column names, which can hold
spaces or mixed case, must be made valid SAS names before `sd2df` reads
them, for example with `as` aliases in the native SQL. Otherwise the run
hangs, and so does every later run in that session.

**Not settled.** Whether `options validvarname=any` avoids it.
