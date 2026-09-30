# ADR-0041 — The Python startup snippet runs as its own `PROC PYTHON` step, in the same job as the restart it survives

- **Status:** Accepted — amended 2026-09-30 by
  [ADR-0043](0043-every-run-turns-sas-notes-off.md): a run's job turns SAS
  notes off before the wrapper and restores the session's setting after
  it; Reset Python State's job is unchanged
- **Date:** 2026-09-28
- **Decides:** how a profile's Python startup snippet reaches the
  interpreter, and how it survives the restart that every Run File and
  Reset Python State performs
- **Amends:** [ADR-0038](0038-every-run-is-wrapped-in-a-named-ods-destination.md)
  and [ADR-0039](0039-every-job-switches-syntax-check-mode-off.md) (their job
  layout gains a step between the wrapper and the user's `proc python`)
- **Constrained by:** [ADR-0014](0014-python-is-submitted-as-an-uploaded-file.md)
  (`Program.bytes` reaches the interpreter unmodified, and `SYSCC` is the
  success signal). This ADR does **not** amend it.
- **Executed in:** Phase 12 slice 12m
- **Evidence:** [`docs/phases/phase-12.md`](../phases/phase-12.md), Findings
  12.4, 12.10, 12.22 and 12.23

## Context

11e gave a profile SAS `autoExec` lines. 12m adds the Python equivalent: a
profile's startup snippet, Python lines inline or from a local file, run
before the user's own code so its imports and variables are already there.

A snippet run once when the session starts does not last. Every Run File
sends `proc python restart infile=<fileref>;` (`src/run/commands.ts` sets
`freshNamespace: true` for every whole-file run), and Reset Python State
sends `proc python restart;`. Both destroy the interpreter, and with it
everything the snippet defined (Finding 12.4). Run File is the most common
first action after connecting, so a snippet seeded only at startup would be
gone before most users saw it work.

12d recommended adding the snippet's lines to the front of the uploaded
file on every restart. That changes the bytes the interpreter reads, which
ADR-0014 forbids, and it has two costs of its own:

- **It breaks `from __future__` imports.** Python accepts one only at the
  top of a module, so any user file that starts with one would fail with a
  `SyntaxError` once a snippet was configured.
- **It shifts every traceback line number.** ADR-0014 relies on the user's
  frame, `<string>`, carrying line numbers that are correct against the
  user's own file (finding 39). A prefix would need an offset map, and a
  snippet error would be reported as an error in the user's file.

## Decision

**The snippet is uploaded once per connection to a fileref with a fixed
name, `PYVSTART`, and runs as its own `PROC PYTHON` step, in the same job
as the restart.** A restarting job becomes:

```sas
options nosyntaxcheck;                                  /* ADR-0039 */
%if %sysfunc(getoption(obs))=0 %then %do; options obs=max; %end;
<ADR-0038's ODS wrapper>
proc python restart infile=PYVSTART; run;               /* snippet */
%let PYVIYA_STARTCC=&syscc; %let syscc=0;
proc python infile=PY000042;         run;               /* user    */
ods html5(id=vscode) close;
```

Reset Python State's job is the same, ending after the `%let` line.

1. **The user's step does not restart.** It reuses the interpreter the
   snippet step just started, so the snippet's names are there
   (Finding 12.22).
2. **The two `%let`s keep the snippet's result apart from the user's.**
   `SYSCC` does not drop back when a later step succeeds. Without the reset,
   a failing snippet makes every run report `1012` even when the user's
   code succeeded. With it, `SYSCC` after the job is the user's step alone,
   as ADR-0014 requires, and `PYVIYA_STARTCC` holds the snippet's result,
   which the backend reads as a second variable (Finding 12.22).
3. **The snippet's log lines are not the run's output.** Everything before
   the source echo of the user's own `proc python infile=…;` statement comes
   from the snippet (Finding 12.22). The backend splits one statement
   earlier, at the source echo of `%let PYVIYA_STARTCC=&syscc;`, which
   arrives as a `source` line after the snippet's last line, with only the
   second `%let`'s echo before the user statement's (Finding 12.24). What comes before is not relayed and not given
   to the traceback parser, so a snippet traceback is never reported as the
   user's. If that echo is not seen, because it never arrives or log lines
   were dropped before it, every line is shown instead and the snippet's
   result is not read: hiding the user's output would be worse, and
   `PYVIYA_STARTCC` could still hold an earlier job's value.
4. **A failing snippet does not stop the run.** The user's step still runs
   (`nosyntaxcheck` is already set), against whatever the snippet managed to
   define. A SAS step error in the snippet's `SAS.submit()` leaves `OBS`
   alone for the same reason, so the user's SAS reads still see every row
   (Finding 12.24). The run's output gains one line saying the startup snippet failed,
   with its exception, and the snippet's log goes to the extension's log. A
   Reset Python State whose snippet fails reports that as its failure. Its
   restart shares the snippet's step, so a failed restart is reported the
   same way, and the message names both.
5. **The first seeding in a new session happens at the session's first
   job, not in a job of its own.** The backend knows from its connection
   whether the session was just created or re-attached. In a created
   session, the first job it submits carries the snippet step even when it
   does not restart: a Run Selection, a cell or the interactive window gets
   `proc python infile=PYVSTART; run;` and the two `%let`s ahead of its own
   step. A re-attached session keeps the namespace it had, so it is not
   seeded again.
6. **With no snippet configured, nothing changes.** No fileref is created,
   and every job is exactly what it is today.
7. **A re-attached session already holds `PYVSTART`, and it is rewritten in
   place.** `assign` answers `400` with `errorCode` 5402 (Finding 12.10). The
   fileref is then found in the session's fileref list, whose items carry no
   `upload` link, so the item's `self` is read for the full representation
   before the write (Finding 12.23). Nothing is deassigned.

The snippet is read when the profile connects, the same way `autoExec` is.
A snippet file that cannot be read is skipped and reported the way an
`autoExec` file is. An edit takes effect at the next connect.

## Why this does not break ADR-0014

The user's bytes still reach the interpreter through their own fileref,
unmodified. The snippet's bytes do the same through theirs. The additions
are SAS statements in the job's code array, the same kind as the trailing
`run;`, ADR-0038's wrapper and ADR-0039's recovery lines. `SYSCC` is still
read once per job and still describes the user's code. `__future__`
imports and traceback line numbers are unaffected (Finding 12.22).

## Alternatives considered

**Add the snippet's lines to the front of the uploaded file** (12d's
recommendation). Breaks `from __future__` imports, shifts every traceback
line number, reports snippet errors as the user's, and needs an ADR-0014
amendment. Not taken.

**A separate seeding job after each restart.** Leaves user bytes alone,
but costs a second job on every Run File: a job create, a log stream and a
`SYSCC` read, plus a second path to cancel. The same-job step measured no
extra time at all (Finding 12.22). Not taken.

**A seeding job of its own at session creation**, the shape 12d probed.
Puts the interpreter's start-up time, about four seconds, into every
connect, including connects that never run Python, and adds a job whose
failure the connect has to report. Point 5 seeds on the first job instead,
at no extra request. Not taken.

**Upload the snippet on every restarting job.** Picks up an edited snippet
without reconnecting, but costs three requests per Run File. Not taken; an
edit takes effect at the next connect, as `autoExec` does.

## Consequences

- **A snippet survives Run File and Reset Python State.** Every restart
  re-runs it, in the same job, with no measurable cost (Finding 12.22).
- **A broken snippet is reported on every restart until it is fixed.**
  Each Run File carries the one-line note, which is the intent: a silent
  partial namespace is worse.
- **Reset Python State can fail because of the snippet.** Its restart and
  the snippet share one step, so its error names both.
- **`SYSERRORTEXT` is not cleared by the `%let`.** It keeps the last error
  SAS set, which was already true across jobs. It is read only when
  `SYSCC` is non-zero, so it is read only after the user's step has set its
  own error.
- **The snippet's `print` output is not shown.** It runs on every restart,
  and repeating it above every run would be noise. It is in the extension's
  log when the snippet fails.
- **The snippet's figures and files are shown as the run's.** Its step sits
  inside ADR-0038's ODS wrapper and ADR-0019's working-directory diff, so a
  `SAS.show()` figure, ODS output from its `SAS.submit()`, or a `.png` or
  `.html` file it writes is captured with the user's output, and the file is
  deleted. The log can be split; these cannot. Moving the step ahead of the
  wrapper would still capture its files, and a job of its own would cost a
  second job on every Run File. A snippet is for imports and definitions,
  so the limit is documented instead (PR #222's review, 2026-09-28).
- **`PYVSTART` is reserved.** A user's own `filename PYVSTART …;` would
  replace the snippet for that session. It is outside the `PYnnnnnn` range
  `procPython.ts` counts, so the fileref counter is unaffected.
- **Probed against one Viya 4 deployment.** A long-running snippet and a
  cancel landing during the snippet step were not probed; a cancel
  interrupts the job as it does today.
