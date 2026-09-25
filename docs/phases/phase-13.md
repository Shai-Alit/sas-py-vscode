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
    separately reviewed follow-up". After 12p. Needs its own ADR-0037
    security review, and a decision on confirmation and on which
    workspaces may use it.
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

**Order.** 13a–13d are independent. 13f needs 13e; 13g needs 13e/13f;
13i needs 13h; 13j needs Phase 12's 12p. 13k is independent.

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
  After 12p.
- [ ] **13k — Polish** (CSV progress, CAS table size, stub opt-out, F9
  checks). Added 2026-09-24. Not started.

### Scope extended, 2026-09-24

Slices 13a–13k added by the backlog sweep recorded in `phase-12.md`'s
"Backlog sweep" Runbook entry, which has the full source-to-slice table and
the reasoning for which items came here rather than to Phase 12. The
second-execution-backend text is unchanged and still does not gate v1.0.

---

## Probe findings

_No live-Viya probes recorded for this phase yet._
