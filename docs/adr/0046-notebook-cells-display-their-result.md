# ADR-0046 — A notebook cell displays its last expression and its open figures, as a Jupyter cell does

- **Status:** Accepted
- **Date:** 2026-10-01
- **Decides:** how a notebook or interactive-window cell shows a bare
  trailing expression's value and any matplotlib figure left open, without
  an explicit file write
- **Amends:** [ADR-0014](0014-python-is-submitted-as-an-uploaded-file.md),
  for the notebook and interactive-window path only. There the user's file
  is still uploaded unmodified, but the interpreter compiles it through a
  project-owned cell runner instead of running it directly.
  [ADR-0015](0015-the-execution-backend-seam.md): `ExecuteOptions` gains
  one field.
  [ADR-0041](0041-startup-snippet-is-a-separate-step-in-the-same-job.md)'s
  job layout: a cell's job gains a step after the user's.
- **Constrained by:** [ADR-0019](0019-rich-output-is-captured-by-diffing-the-working-directory.md)
  (output leaves the session as files in the working directory) and
  [ADR-0036](0036-notebook-html-output-is-sanitized.md) (notebook HTML is
  sanitised)
- **Executed in:** Phase 13 slice 13f. Decided in 13e.
- **Evidence:** [`docs/phases/phase-13.md`](../phases/phase-13.md),
  Findings 13.13–13.15; [`docs/phases/phase-11.md`](../phases/phase-11.md),
  F10 and Finding 11.3

## Context

A cell whose last line is `df.head()`, or that draws a plot and calls
`plt.show()`, shows nothing today. Output appears only when the user's own
code writes a file, such as `fig.savefig(...)` or `df.to_html(...)`, or calls
`SAS.show()` (ADR-0019, ADR-0038). Jupyter users expect the opposite, and
11a's manual pass hit the gap. `phase-11.md`'s F10 has the design discussion.

Two separate things are missing:

1. **Open figures.** matplotlib runs on the non-interactive `agg` backend
   under `PROC PYTHON`, so `plt.show()` does nothing and the figure stays
   open (Finding 13.13). Nothing saves it.
2. **The trailing expression's value.** `PROC PYTHON infile=` runs a file
   as a script. A bare last expression is evaluated and thrown away, and
   nothing in the log records its value (Finding 11.3).

The first needs nothing from the user's code. Open figures outlive the
step that drew them: a later `proc python infile=` step in the same job sees
them and can save them (Finding 13.13). It fits beside the user's step, the
way ADR-0041's startup snippet does.

The second cannot be done beside the user's code. The value exists only
while the code runs, so something has to run the code and keep the last
statement's value. That is the shape ADR-0014 rules out project-wide: "the
bytes the editor holds are the bytes the interpreter reads, with nothing in
between". ADR-0014's reason was finding 33. Python inlined in a `SUBMIT`
block can end the block early and leave SAS's tokeniser inside an open
quote across later jobs. A runner that reads the user's file from disk and
passes it to `compile()` has no `SUBMIT` block and nothing to escape, so
that hazard does not return. What it does change is which frames a
traceback shows and which names the namespace holds. Finding 13.15 measured
both.

## Decision

**In a notebook or interactive-window cell, open figures are saved by a
step of their own after the user's step. A bare last expression is
evaluated by a project-owned cell runner that compiles the user's
unmodified file. Run File and Run Selection are unchanged.**

1. **`ExecuteOptions` gains `displayResults: boolean`.** The notebook
   controller passes `true`, and the interactive window shares its path.
   Run File and Run Selection pass `false`, and their jobs are exactly what
   they are today. A backend that cannot display results ignores the flag:
   displaying is best-effort and never fails a run.
2. **The user's bytes are still uploaded unmodified,** to their own
   `PYnnnnnn` fileref, as ADR-0014 decided. The transfer, the fidelity
   corpus, and `SYSCC` as the success signal are all unchanged.
3. **The runner is a fixed file, never containing user bytes.** It is
   uploaded once per connection to a fileref with a fixed name, the way
   `PYVSTART` is (ADR-0041 point 7 covers re-attach). The job names the
   cell's fileref in a macro variable, and the runner reads it with
   `SAS.symget()`. The runner then:
   - reads the cell's file as bytes and `ast.parse`s it. Python's own
     source-encoding rules apply, as they do today;
   - if the last top-level statement is a bare expression, splits it off;
   - `exec`s the rest in `__main__`'s globals, which are the globals an
     `infile=` step already runs in (Finding 13.15);
   - `eval`s the split-off expression in the same globals. It is compiled
     separately from the rest, so it is compiled with the module's
     `__future__` flags (`compile(..., flags=…, dont_inherit=True)`) to
     behave as it would in the module. Finding 13.15's `__future__` case
     did not exercise this; 13f tests it. A value that is
     not `None` is displayed through the IPython display protocol:
     `_repr_html_` is written to an `.html` file and `_repr_png_` to a
     `.png` file. Any other value is printed as its `repr()`, which reaches
     the run's output as `text/plain`;
   - removes its own names in a `finally`, so a cell that raises does not
     leave them in the user's namespace (Finding 13.15).
4. **A figure flush runs as its own step after the user's,** from a second
   fixed fileref. If `matplotlib.pyplot` has not been imported it does
   nothing. Otherwise it saves every open figure as a PNG and closes it.
   The step runs whether or not the user's step raised (Finding 13.13).
5. **`SYSCC` still describes the user's code alone.** The user's `SYSCC` is
   saved in a macro variable before the flush step and restored after it,
   the pattern ADR-0041 point 2 uses (Finding 13.14). A flush that fails
   adds one line to the run's output, the way a failing startup snippet
   does. Its traceback is never parsed as the user's: the log is split at
   the save's `source` echo, which relies on source echo staying on while
   ADR-0043 turns notes off, as ADR-0041 point 3's split already does.
6. **Captured files are named so no two runs collide.** Each name includes
   the run's id and a counter. ADR-0019 diffs the directory by name and
   size, so a reused name with an unchanged size would be missed (Finding
   13.13 overwrote one name with a different size). The job below passes
   only the cell's fileref, so 13f decides how the runner and the flush
   learn the run's id: a second macro variable, or a value derived from
   the cell's fileref. The working-directory
   diff, the whitelist, the size cap, fetch and delete are all unchanged,
   and so are `RichOutput`, the transport and `richOutput.ts`.
7. **Tracebacks look as they do today.** The runner adds two frames below
   the two `<stdin>` frames ADR-0014 already drops, and a `SyntaxError`
   raised while the runner parses the cell adds a frame from the standard
   library's `ast.py` (Finding 13.15). `tracebackDiagnostics.ts` and
   `parseTraceback` drop them too. The relabelling needs more than that.
   `tracebackDiagnostics.ts` maps only frames labelled `<string>`
   (`STRING_FRAME_FILE`), which today is the user's frame. Under the
   runner, `<string>` is the runner's own frame, and the user's frame is
   labelled with the cell's fileref name, such as `File "PYU4"` (Finding
   13.15). Left as it is, the mapper would place a cell's diagnostic at the
   runner's line. 13f picks one of two fixes so the user's frame and its
   line number stay correct against the cell, as finding 39 requires:
   - the mapper learns the cell's fileref name as the user's frame label;
     or
   - the runner compiles with `filename="<string>"`, which keeps today's
     mapping but loses the source line and caret Finding 13.15 saw.

A cell's job becomes:

```sas
<ADR-0039 recovery> <ADR-0043 notes off> <ADR-0038 ODS wrapper>
<ADR-0041 snippet step and capture, when seeding>
%let PYVIYA_CELL=PY000042;
proc python infile=PYVRUN;   run;       /* runner: the user's cell  */
%let PYVIYA_USERCC=&syscc;
proc python infile=PYVFLUSH; run;       /* open figures             */
%let syscc=&PYVIYA_USERCC;
<ODS close> <notes restored>
```

The fileref and macro variable names here are illustrative; 13f fixes
them.

## Why this narrows ADR-0014 rather than breaking it

ADR-0014 decided two things. **The transfer:** the editor's bytes reach the
compute node unmodified, as a file, and are never inlined into SAS code.
That still holds on every path. **The execution:** that file is the program
`PROC PYTHON` runs. That still holds for Run File and Run Selection. In a
notebook cell, the program `PROC PYTHON` runs is now the runner, and the
runner compiles the user's file unmodified. There is still no escaper and
no SAS tokeniser in the way: the runner reads the bytes from disk, and
`compile()` sees exactly what the editor held. The costs are in tracebacks
and in the namespace, which points 3 and 7 handle, not in fidelity.

## Alternatives considered

**Decline F10.** Keep `savefig`, `to_html` and `SAS.show()` as the only
ways to show output. Costs nothing, but leaves the most common notebook
habit, a bare `df` or a plot as a cell's last line, showing nothing. Not
taken (Sean, 2026-10-01).

**Figures only.** Point 4 alone, with ADR-0014 untouched. Shows plots, but
not a bare `df.head()`, and leaves 13g with no natural trigger for the
DataFrame grid. Not taken (Sean, 2026-10-01).

**Every run, not only notebooks.** Flush open figures after Run File and
Run Selection too. A script that saves a figure and does not close it
would show that figure twice, once from its own file and once from the
flush. A script has no "last expression" in the notebook sense either. Not
taken (Sean, 2026-10-01).

**Flush inside the runner, in a `finally`.** One step instead of two.
But an exception raised during the flush would replace the user's
exception, and the flush would share the user's `SYSCC`. Not taken.

**Read the value from the log.** Rejected by Finding 11.3: `PROC PYTHON`'s
`>>>` prompt is cosmetic, and a trailing expression's value never reaches
the log.

**Compile the last statement in `"single"` mode.** That makes Python call
`sys.displayhook`, which prints a `repr()` to stdout. It cannot produce
HTML or PNG output, so the runner calls the display protocol itself.

## Consequences

- **A notebook cell shows plots and a trailing value the way Jupyter
  does.** `plt.show()` and a plot left open both show the figure.
  `df.head()` shows the table as HTML. seaborn and pandas plotting draw
  into pyplot figures, so they should show too; no probe covered them, so
  13f's manual pass checks them.
- **A figure the cell saved and did not close is shown twice**: once from
  its own file and once from the flush. Jupyter's inline backend behaves
  the same. 13f documents it in `docs/notebooks.md`.
- **Plotly and other script-based HTML reprs do not render.** ADR-0036's
  sanitiser strips scripts. Their `_repr_png_`, where one exists, is not
  preferred over `_repr_html_`. 13f may revisit the order.
- **A trailing semicolon does not suppress the value yet.** Jupyter hides a
  value when the cell's last line ends in `;`. The AST does not record the
  semicolon, so 13f reads it from the source text, or records the gap.
- **13g has its trigger.** A DataFrame as a cell's last expression is the
  natural thing to send to the ag-grid viewer (ADR-0028), and 13g decides
  how.
- **A cell's job is two steps longer.** Finding 13.13 measured the flush
  step at 0–140 ms: 140 ms the first time, saving two figures, and 0–40 ms
  after that. The runner adds no step; it replaces the user's.
- **Two more reserved fileref names,** like `PYVSTART`. A user's own
  `filename` with either name would replace the runner or the flush for
  that session.
- **The seam grows by one field.** It is an option, not a new method, and
  `test/helpers/fake-backend.ts` honours it like any other.
- **Probed against one Viya 4 deployment (`verde`, Python 3.12.12).** A
  cell that never returns, a cancel during the flush, and figures from
  libraries that keep their own figure registry were not probed.
