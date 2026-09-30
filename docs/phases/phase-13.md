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

**Order.** 13a–13d are independent. 13f needs 13e; 13g needs 13e/13f;
13i needs 13h; 13m needs 13l; 13j needs 13m. 13k is independent.

### Second execution backend (does not gate v1.0)

Only if warranted. The `ExecutionBackend` seam exists so this is additive. Revisit
native Python runtimes (SAS Workbench, batch/job execution) once real usage shows
where `PROC PYTHON` actually hurts.

---

## Runbook

### Punch list

- [ ] **13a — SAS Content upload/download.** Added 2026-09-24. Not started.
- [ ] **13b — SAS Content Copy/Paste.** Added 2026-09-24. Not started.
  Probe server-side copy first.
- [ ] **13c — F6, common-commands panel.** Added 2026-09-24. Not started.
- [ ] **13d — F11, snippet library.** Added 2026-09-24. Not started.
- [ ] **13e — F10, the ADR-0014 decision.** Added 2026-09-24. Not started.
- [ ] **13f — F10, build (or closed by 13e).** Added 2026-09-24. Not started.
- [ ] **13g — F8, DataFrame grid.** Added 2026-09-24. Not started.
- [ ] **13h — F1, spike.** Added 2026-09-24. Not started.
- [ ] **13i — F1, build or decline.** Added 2026-09-24. Not started.
- [ ] **13j — MCP tool that runs Python.** Added 2026-09-24. Not started.
  After 13m.
- [ ] **13k — Polish** (CSV progress, CAS table size, stub opt-out, F9
  checks). Added 2026-09-24. Not started.
- [ ] **13l — The MCP server for Claude Code (was 12o).** Moved here
  2026-09-29. Built and parked on `feat/12o-mcp-server`; manual items 4 of 8
  passed. See "12o and 12p moved here" below for the pickup steps.
- [ ] **13m — The MCP server's read-only tools (was 12p).** Moved here
  2026-09-29. Not started. After 13l.
- [x] **13n — Output lost after a `SAS.submit()` graph.** Added 2026-09-30
  from v0.1.4's release smoke test. Every run turns SAS notes off
  ([ADR-0043](../adr/0043-every-run-turns-sas-notes-off.md)). See "13n
  built" below.

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
`4622508`. Not yet in a release.

**Not reproduced.** Two things Sean saw on v0.1.4 did not recur on the
probe. A traceback stayed lost until a disconnect and reconnect: the probe
never saw the `note` typing outlast its job. A notebook cell's `SAS.show()`
output did not render: the server's ODS body and the sanitizer were both
fine. Each was during runs that the `note` typing had already hidden, so
both may be the same bug. Manual items 13.3 and 13.5 cover them.

---

## Probe findings

Numbered phase-scoped as `13.x` (`CLAUDE.md`'s 2026-09-09 rule), starting at
13.1; nothing here continues another phase's sequence.

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

