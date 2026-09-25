# ADR-0039 — Every job switches SAS syntax-check mode off before anything else runs

- **Status:** Accepted
- **Date:** 2026-09-25
- **Decides:** how a compute session that one failed SAS step put into
  syntax-check mode gets back to running code, and how the next failure is
  kept from doing it again
- **Amends:** [ADR-0038](0038-every-run-is-wrapped-in-a-named-ods-destination.md)
  (its point 1 job layout, which now starts with the two lines below)
- **Constrained by:** [ADR-0014](0014-python-is-submitted-as-an-uploaded-file.md)
  (`Program.bytes` reaches the interpreter unmodified, and `SYSCC` is the
  success signal)
- **Executed in:** Phase 12 slice 12k (fixes B12.1)
- **Evidence:** [`docs/phases/phase-12.md`](../phases/phase-12.md), Findings
  12.5 and 12.19

## Context

A compute session on the SAS Studio compute context starts with the
`SYNTAXCHECK` system option set. Some SAS step errors then set `OBS=0` and
put the session in syntax-check mode. A DATA step writing to an unassigned
libref does this, whether it is submitted as its own job or through
`SAS.submit()` inside a run. From then on every step, in every later job,
is only syntax-checked. It reports `SYSCC=3`, and `SYSERRORTEXT` still holds
the first error. No Python runs at all. So every later Run File, cell and
Reset Python State reports the old error, and only a new session recovered
(B12.1, Findings 12.5 and 12.19).

Not every step error does this. A `set` from an unassigned libref fails
without entering syntax-check mode, which is why Finding 12.15 never saw it.

## Decision

**Every job `procPython.ts` submits begins with `SYNTAX_CHECK_RECOVERY`.**
That covers `execute()`, `reset()` and `probeRuntime()`:

```sas
options nosyntaxcheck;
%if %sysfunc(getoption(obs))=0 %then %do; options obs=max; %end;
```

Then comes the job's own code: ADR-0038's wrapper and the `proc python`
statement, the restart, or the environment probe.

- **`nosyntaxcheck`** lets a step run on a session already in syntax-check
  mode. Once set, a later step error still fails its own job
  (`SYSCC=1012`), but it no longer sets `OBS=0`, so the next job is
  unaffected (Finding 12.19).
- **The `%if`** undoes an `OBS=0` that SAS already set. Without it, a
  recovered run's `SAS.submit()` DATA step reads no rows. It resets `OBS`
  only when it is `0`, so a user's own `options obs=5;` survives.
- **No `%let syscc=0;`.** It is not needed, and on its own it does not
  recover the session (Findings 12.5 and 12.19).

Both lines arrive in the log typed `source`, which `logFilter.ts` already
drops. Adding them costs no extra request and no measurable job time.

## Why this does not break ADR-0014

The lines are SAS statements in the job's code array, the same kind of
addition as the trailing `run;` and ADR-0038's wrapper. The uploaded bytes
are unchanged. `SYSCC` is still read once per job and still means what
ADR-0014 says. Now it describes that job's own steps rather than an error
from several jobs earlier.

## Alternatives considered

**`NOSYNTAXCHECK` in the session-create options only.** This works for a
session this extension creates (Finding 12.19). It does nothing for a
session reattached after a window reload that was poisoned before this
change, nor for one where a user's code turns `SYNTAXCHECK` back on. It
would also be a second place to keep in step with a profile's own
`sasOptions`. Not taken.

**A separate clearing job only after a failed run.** It leaves SAS
semantics alone on healthy runs, but costs an extra job after every
failure and adds a code path. Not taken.

**Clear only on Reset Python State.** Every run after a failure would
still fail until the user thought to reset. Not taken.

## Consequences

- **A failed SAS step no longer affects later runs or Reset Python State.**
  The run that fails still reports its own error.
- **`SYNTAXCHECK` is off for the session.** A user who sets it on purpose,
  in a profile's `sasOptions` or through `SAS.submit()`, has it switched off
  again at the start of the next job. SAS's own extension does the same
  thing on its SSH connection, which starts SAS with `-nosyntaxcheck`.
- **A deliberate `OBS=0` does not survive a job boundary.** It is reset to
  `MAX` at the start of the next job. That is the price of recovering from
  the `OBS=0` that SAS itself sets, since the two look the same.
- **Other Viya releases are unverified.** Probed against one Viya 4
  deployment, where open-code `%if` ran as expected. A release that
  rejected it would log an error in every job, so manual testing on a new
  release would show it at once.
