# ADR-0043 — Every run turns SAS notes off while it runs, and puts the session's setting back after

- **Status:** Accepted
- **Date:** 2026-09-30
- **Decides:** how a run's printed output and traceback survive a
  `SAS.submit()` whose last step is `PROC SGPLOT` or `PROC SGPANEL`
- **Amends:** [ADR-0038](0038-every-run-is-wrapped-in-a-named-ods-destination.md)
  and [ADR-0041](0041-startup-snippet-is-a-separate-step-in-the-same-job.md)
  (their job layout gains one pair of lines before the ODS wrapper and one
  line after it)
- **Constrained by:** [ADR-0014](0014-python-is-submitted-as-an-uploaded-file.md)
  (`Program.bytes` reaches the interpreter unmodified, and `SYSCC` is the
  success signal), and Findings 52, 74 and 93 (the log filter trusts a
  line's `type` and never scans its text). This ADR amends neither.
- **Executed in:** Phase 13 slice 13n
- **Evidence:** [`docs/phases/phase-13.md`](../phases/phase-13.md), Findings
  13.1 and 13.2

## Context

The log filter drops every line typed `note` (`logFilter.ts`). A program's
stdout and its traceback normally arrive typed `normal`, so the filter shows
them.

v0.1.4 users saw Run File print nothing, and a failing run report only
"Finished with an error." with no traceback and no Problems entry. Finding
13.1 found the cause. When the last step a `SAS.submit()` runs is
`PROC SGPLOT` or `PROC SGPANEL`, SAS types the `PROC PYTHON` step's whole
stdout and its traceback `note`. That includes lines printed before the
submit. The filter then drops all of it. A later SAS step inside the same
`PROC PYTHON` step, such as a `DATA _NULL_`, puts the typing back to
`normal`. The next job is not affected.

## Decision

**`execute()`'s job saves the session's `NOTES` setting and turns notes off
right after ADR-0039's recovery prefix. Its last statement puts the saved
setting back.** A Run File job becomes:

```sas
options nosyntaxcheck;                                  /* ADR-0039 */
%if %sysfunc(getoption(obs))=0 %then %do; options obs=max; %end;
%let PYVIYA_NOTES=%sysfunc(getoption(notes));           /* this ADR */
options nonotes;                                        /* this ADR */
<ADR-0038's ODS wrapper>
<ADR-0041's snippet step, when there is one>
proc python restart infile=PY000042; run;
ods html5(id=vscode) close;
options &PYVIYA_NOTES;                                  /* this ADR */
```

1. **With `NONOTES` the same lines arrive `normal`** (Finding 13.2). That
   holds after `PROC SGPLOT` and `PROC SGPANEL`, with and without a
   restart, and for a traceback.
2. **The session's own setting is kept.** `getoption(notes)` returns
   `NOTES` or `NONOTES`. A session a profile's `sasOptions` started with
   `NONOTES` is still `NONOTES` after the run (Finding 13.2).
3. **The restore runs after a Python exception.** The step fails, and the
   statement after it still runs (Finding 13.2).
4. **`reset()` and `probeRuntime()` are not wrapped**, as with ADR-0038.
   Neither shows any output. A startup snippet can still lose its traceback
   in `reset()` if it ends with a `SAS.submit()` graph and then raises.
   That is too narrow a case to add to every reset.

## Why not filter the markers instead

In the failing runs every lost line sits between the `>>>` line that
follows the SAS log of the step's callbacks and the `>>> ` that follows
the traceback. A filter could keep `note` lines found in that range. It
would have to find the range by reading the text of lines, which is the
text scan Findings 52 and 74 rule out. Finding 93 settled on 2026-09-09 not
to strip the `>>>` markers, for the same reason. This ADR changes what SAS
sends, and the filter is left alone. `PAGESIZE MAX` (Finding 11.7) fixed
the page-break banner the same way.

## Alternatives considered

**Keep `note` lines in the `>>>` range.** A text scan, as above. Not taken.

**Add a `DATA _NULL_` step after every `SAS.submit()`.** That puts the
typing back to `normal`, but it would mean changing the code the user
submits, or the `SAS` object's own methods. Not taken.

**Show every `note` line.** Brings back the procedure notes the filter
exists to drop. Not taken.

**Set `NONOTES` once when the session starts.** One statement fewer per
run, but a user's `SAS.submit("options notes;")` would then bring the
problem back for every later run, not just one. Setting it per run also
keeps the session's own setting in force for anything else that uses the
session. Not taken.

## Consequences

- **A run's output and traceback survive a `SAS.submit()` graph.** This
  covers Run File, Run Selection, a notebook cell and the interactive
  window.
- **`SAS.logMessage()` at its default `NOTE` level shows nothing.** It
  showed nothing before either: the filter dropped the line. `WARNING` and
  `ERROR` messages are still shown (Finding 13.2).
- **A failed `SAS.submit()` DATA step logs one extra warning.** "Data set
  … was not replaced because this step was stopped." It is typed `warning`,
  so it is shown (Finding 13.2).
- **A user can bring the problem back for one run.** If the code runs
  `SAS.submit("options notes;")` and then a graph, that run's output is
  typed `note` again. The next run turns notes off again (Finding 13.2).
- **A cancelled run leaves the session `NONOTES`.** The restore never
  runs, and each later run then saves and restores `NONOTES`, so the
  session's own `NOTES` setting is lost until the session ends. That only
  changes the session's log, and nothing in this extension reads a `note`
  line except to drop it (Finding 13.2). It would matter if the extension
  later showed the raw SAS log, or ran a user's SAS step outside this
  wrapper. Saving the setting once per session, not once per run, would
  fix it then.
- **`PYVIYA_NOTES` is reserved.** A user's own macro variable of that name
  is overwritten at the start of each run. It is a global macro variable
  and is not deleted after the run.
- **Probed against one Viya 4 deployment.** Other `SG` procedures
  (`SGSCATTER`, `SGRENDER`) and other releases were not probed. Under this
  ADR it does not matter which procedures cause the typing, since notes
  are off for all of them.
